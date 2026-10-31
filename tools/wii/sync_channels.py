"""Fetch cmyksoda's public forwarder channels and unpack their banners for /wii-forwarders.

For every public repo tagged `wii-forwarder`, this downloads the latest release's Wii WAD,
decrypts its banner content (opening.bnr) and writes, per channel:

    public/wii-forwarders/channels/<TITLE ID>/icon.bin     the Wii Menu tile
    public/wii-forwarders/channels/<TITLE ID>/banner.bin   the preview banner
    public/wii-forwarders/channels/<TITLE ID>/sound.flac   the banner sound, with sound.json

the first two exactly as stored in the channel (IMD5-wrapped, usually LZ77-compressed), which keeps
them small. The sound is decoded by convert_channel_sound.py; its sound.bin stays in project-data.

plus public/wii-forwarders/channels.json, in Wii Menu slot order.

usage: python3 tools/wii/sync_channels.py
"""

import hashlib
import json
import struct
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from convert_channel_sound import convert

try:
    from Cryptodome.Cipher import AES
except ModuleNotFoundError:
    from Crypto.Cipher import AES

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public/wii-forwarders"
CACHE = ROOT / "project-data/channels-src"
OWNER = "cmyksoda"
COMMON_KEY = bytes.fromhex("ebe42a225e8593e448d9c5457381aaf7")
ENGLISH = 1

# The Empty Slot release ships only its Creator app, so its channel comes from Jaxi's own build.
# It takes the Disc Channel's place in the top-left slot.
LOCAL_WADS = {
    "empty-slot-creator": Path.home()
    / "Documents/Dev/wii-homebrew/Empty-Slot-Forwarder/Empty Slot - ESLT [cmyksoda].wad",
}
# Jaxi's slot order, from the top left; channels not listed follow, oldest first.
ORDER = ["empty-slot-creator", "hbc-upside-down", "mgba-gx-forwarder-channel", "vboy-color-gx-forwarder-channel"]


def gh(*args):
    return json.loads(subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout)


def align(n, a=64):
    return (n + a - 1) // a * a


def read_wad(data):
    """Returns (title id, decrypted content 0), the banner content of a channel WAD."""
    header, _, cert_size, crl_size, tik_size, tmd_size = struct.unpack(">IIIIII", data[:24])
    offset = align(header) + align(cert_size) + align(crl_size)
    tik = data[offset:offset + tik_size]
    tmd = data[offset + align(tik_size):offset + align(tik_size) + tmd_size]
    contents = offset + align(tik_size) + align(tmd_size)

    title_id = tik[0x1DC:0x1E4]
    title_key = AES.new(COMMON_KEY, AES.MODE_CBC, title_id + bytes(8)).decrypt(tik[0x1BF:0x1CF])
    index, size = struct.unpack(">H", tmd[0x1E8:0x1EA])[0], struct.unpack(">Q", tmd[0x1EC:0x1F4])[0]
    iv = struct.pack(">H", index) + bytes(14)
    blob = data[contents:contents + align(size, 16)]
    banner = AES.new(title_key, AES.MODE_CBC, iv).decrypt(blob)[:size]
    if hashlib.sha1(banner).digest() != tmd[0x1F4:0x208]:
        raise ValueError("banner content failed its TMD hash")
    return tmd[0x190:0x194].decode("ascii"), banner


def read_u8(data):
    root = struct.unpack(">I", data[4:8])[0]
    count = struct.unpack(">I", data[root + 8:root + 12])[0]
    strings = root + count * 12
    files, ends, names = {}, [], []
    for i in range(1, count):
        while ends and ends[-1] <= i:
            ends.pop()
            names.pop()
        word, offset, size = struct.unpack(">III", data[root + i * 12:root + i * 12 + 12])
        name = data[strings + (word & 0xFFFFFF):data.index(b"\0", strings + (word & 0xFFFFFF))].decode()
        if word >> 24:
            names.append(name)
            ends.append(size)
        else:
            files["/".join(names + [name])] = data[offset:offset + size]
    return files


def lz77(data):
    """Nintendo LZ77 type 0x10: 12-bit distances, lengths 3..18."""
    size = int.from_bytes(data[1:4], "little")
    out, pos = bytearray(), 4
    while len(out) < size:
        flags = data[pos]
        pos += 1
        for bit in range(8):
            if len(out) >= size:
                break
            if flags & (0x80 >> bit):
                length = (data[pos] >> 4) + 3
                distance = ((data[pos] & 15) << 8 | data[pos + 1]) + 1
                pos += 2
                for _ in range(length):
                    out.append(out[-distance])
            else:
                out.append(data[pos])
                pos += 1
    return bytes(out)


def unwrap(data):
    """Checks that a banner.bin or icon.bin really holds a U8 archive (IMD5-wrapped, often LZ77)."""
    if data[:4] == b"IMD5":
        body = data[32:32 + struct.unpack(">I", data[4:8])[0]]
        if hashlib.md5(body).digest() != data[16:32]:
            raise ValueError("IMD5 checksum mismatch")
        data = body
    if data[:4] == b"LZ77":
        data = lz77(data[4:])
    if data[:4] != b"\x55\xaa\x38\x2d":
        raise ValueError("expected a U8 archive")
    return data


def channel_names(banner):
    imet = banner.index(b"IMET")
    names = []
    for i in range(10):
        raw = banner[imet + 0x1C + i * 84:imet + 0x1C + (i + 1) * 84]
        names.append(raw.decode("utf-16-be").split("\0")[0])
    return imet, names


def release_wad(repo):
    release = gh("api", f"repos/{OWNER}/{repo}/releases/latest")
    if repo in LOCAL_WADS:
        return release, None, LOCAL_WADS[repo].read_bytes()
    asset = next(a for a in release["assets"] if a["name"].endswith(".zip") and not a["name"].startswith("vWii"))
    cached = CACHE / repo / asset["name"]
    if not cached.exists():
        cached.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(asset["browser_download_url"], cached)
    # Read the WAD straight from the zip so nothing from the download touches the filesystem.
    with zipfile.ZipFile(cached) as archive:
        wads = [n for n in archive.namelist() if n.lower().endswith(".wad") and "vwii" not in n.lower()]
        if len(wads) != 1:
            raise ValueError(f"{repo}: expected one Wii WAD in {asset['name']}, found {wads}")
        return release, asset, archive.read(wads[0])


def main():
    repos = gh("repo", "list", OWNER, "--topic", "wii-forwarder", "--visibility", "public",
               "--json", "name,createdAt,url")
    repos.sort(key=lambda r: (ORDER.index(r["name"]) if r["name"] in ORDER else len(ORDER), r["createdAt"]))
    channels = []
    for repo in repos:
        release, asset, wad = release_wad(repo["name"])
        title_id, banner = read_wad(wad)
        imet, names = channel_names(banner)
        archive = read_u8(banner[imet - 0x40 + 0x600:])
        folder = OUTPUT / "channels" / title_id
        folder.mkdir(parents=True, exist_ok=True)
        for name in ("icon.bin", "banner.bin"):
            unwrap(archive[f"meta/{name}"])
            (folder / name).write_bytes(archive[f"meta/{name}"])
        sound = CACHE / "sounds" / title_id / "sound.bin"
        sound.parent.mkdir(parents=True, exist_ok=True)
        sound.write_bytes(archive["meta/sound.bin"])
        convert(sound, out_dir=folder)
        channels.append({
            "id": title_id,
            "name": names[ENGLISH],
            "repo": repo["url"],
            "release": release["html_url"],
            "version": release["tag_name"],
            "download": asset["browser_download_url"] if asset else release["html_url"],
        })
        print(f"{title_id}  {names[ENGLISH]!r:42} {release['tag_name']:8} {repo['name']}")
    (OUTPUT / "channels.json").write_text(json.dumps(channels, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(channels)} channels to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
