"""Unpack the SD Card Menu's channels for /wii-forwarders.

These are cmyksoda's channel mods rather than forwarders, so each comes from a WAD named below
instead of a GitHub release. Per channel this writes the icon and banner exactly as stored in the
channel, and the banner sound decoded by convert_channel_sound.py (its sound.bin stays in project-data):

    public/wii-forwarders/sd-channels/<TITLE ID>/icon.bin
    public/wii-forwarders/sd-channels/<TITLE ID>/banner.bin
    public/wii-forwarders/sd-channels/<TITLE ID>/sound.flac   with sound.json

plus public/wii-forwarders/sd-channels.json, in SD Card Menu order. The WADs are copies taken
from the SD card of Jaxi's Wii. Download opens each WAD's Internet Archive page.

usage: python3 tools/wii/sync_sd_channels.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from convert_channel_sound import convert
from sync_channels import CACHE, ENGLISH, OUTPUT, ROOT, channel_names, read_u8, read_wad, unwrap

WADS = ROOT / "project-data/sd-channels-src/sd-card"
# A channel without a download link waits for its WAD to be published.
CHANNELS = [
    {
        "wad": WADS / "Super Mario Bros. 25th Anniversary (NTSC 60Hz) - FFXP [cmyksoda].wad",
        "download": "https://archive.org/details/super-mario-bros.-25th-anniversary-en-banner-ntsc-60-hz",
    },
    {
        "wad": WADS / "Internet Channel (NetSurf) - HADE [cmyksoda].wad",
        "download": "https://archive.org/details/internet-channel-netsurf",
    },
    {
        "wad": WADS / "Forecast Channel (Japanese Symbols) - HAFE [cmyksoda].wad",
        "download": "https://archive.org/details/forecast-channel-japanese-symbols-wiilink",
    },
]


def main():
    target = OUTPUT / "sd-channels"
    listing = []
    for channel in CHANNELS:
        title_id, banner = read_wad(channel["wad"].read_bytes())
        imet, names = channel_names(banner)
        archive = read_u8(banner[imet - 0x40 + 0x600:])
        folder = target / title_id
        folder.mkdir(parents=True, exist_ok=True)
        for name in ("icon.bin", "banner.bin"):
            unwrap(archive[f"meta/{name}"])
            (folder / name).write_bytes(archive[f"meta/{name}"])
        sound = CACHE / "sounds" / title_id / "sound.bin"
        sound.parent.mkdir(parents=True, exist_ok=True)
        sound.write_bytes(archive["meta/sound.bin"])
        convert(sound, out_dir=folder)
        listing.append({"id": title_id, "name": names[ENGLISH], "download": channel["download"]})
        print(f"{title_id}  {names[ENGLISH]!r}")
    (OUTPUT / "sd-channels.json").write_text(json.dumps(listing, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(listing)} channels to {target.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.exit(main())
