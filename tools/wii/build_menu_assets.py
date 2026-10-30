"""Unpack the Wii Menu resources that /wii-forwarders draws, from a decrypted Wii NAND.

Copies the menu's own ASH0-compressed layout archives unchanged, subsets its bitmap fonts to the
characters the page can show, and exports the English UI strings:

    public/wii-forwarders/menu/<archive>.ash
    public/wii-forwarders/menu/fonts/<font>.png + <font>.json
    public/wii-forwarders/menu/messages.json

usage: python3 tools/wii/build_menu_assets.py [NAND]   (default: Dolphin's NAND, read only)
"""

import json
import struct
import sys
import zlib
from pathlib import Path

import wii_formats as wii

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public/wii-forwarders/menu"
ARCHIVES = ["chanSel", "chanTtl", "cmnBtn", "cursor", "balloon", "board", "letter", "calendar", "dlgWdw"]

# Layouts name their fonts; the menu binds those names to the console's shared system fonts.
SHARED_FONTS = {
    "RevoIpl_RodinNTLGPro_DB_32_I4": "wbf1.brfna",
    "RevoIpl_UtrilloProGrecoStd_M_32_I4": "wbf2.brfna",
}
MENU_FONT = "RevoIpl_RodinNTLGPro_DB_48_IA4"

# Latin text, typographic punctuation, arrows and symbols; everything else comes from the strings.
EXTRA_RANGES = [(0x20, 0x250), (0x2000, 0x2070), (0x2100, 0x2200), (0x2190, 0x2200), (0x25A0, 0x2700),
                (0xE000, 0xF900)]
COLUMNS = 16


def find_u8(folder, member):
    for path in sorted(folder.glob("*.app")):
        data = path.read_bytes()
        if data[:4] == b"\x55\xaa\x38\x2d":
            files = wii.u8_files(data)
            if member in files:
                return files
    raise SystemExit(f"no content in {folder} holds {member}")


def png_gray_alpha(width, height, pixels):
    """8-bit gray+alpha PNG; browsers decode it as (gray, gray, gray, alpha), like GX samples I4/IA4."""
    def chunk(kind, payload):
        return (struct.pack(">I", len(payload)) + kind + payload
                + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF))

    rows = b"".join(b"\0" + pixels[y * width * 2:(y + 1) * width * 2] for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 4, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def subset_font(font, codes):
    """Repacks the wanted glyph cells, keeping NW4R's 1-pixel gutter so sampling matches the sheets."""
    cell_w, cell_h = font["cellWidth"] + 1, font["cellHeight"] + 1
    chars = {c: font["characters"][str(c)] for c in sorted(codes) if str(c) in font["characters"]}
    rows = (len(chars) + COLUMNS - 1) // COLUMNS
    width, height = COLUMNS * cell_w + 1, rows * cell_h + 1
    atlas = bytearray(width * height * 2)
    glyphs = {}
    for slot, (code, index) in enumerate(chars.items()):
        metric = font["glyphs"][str(index)]
        sheet = font["sheets"][metric["sheet"]]
        dx, dy = (slot % COLUMNS) * cell_w + 1, (slot // COLUMNS) * cell_h + 1
        for y in range(font["cellHeight"]):
            for x in range(font["cellWidth"]):
                at = ((metric["y"] + y) * sheet["width"] + metric["x"] + x) * 4
                gray, alpha = sheet["pixels"][at], sheet["pixels"][at + 3]
                out = ((dy + y) * width + dx + x) * 2
                atlas[out:out + 2] = bytes((gray, alpha))
        glyphs[code] = [dx, dy, metric["left"], metric["width"], metric["advance"]]
    metrics = {key: font[key] for key in ("cellWidth", "cellHeight", "baseline", "lineFeed", "width", "height",
                                          "ascent")}
    default = font["glyphs"][str(font["defaultGlyph"])]
    metrics["defaultWidths"] = [default["left"], default["width"], default["advance"]]
    metrics["atlas"] = [width, height]
    metrics["glyphs"] = glyphs
    return png_gray_alpha(width, height, bytes(atlas)), metrics


def layout_strings(archive):
    """Default text in every textbox, so the fonts keep whatever glyphs the layouts print themselves."""
    text = ""
    for name, data in archive.items():
        if not name.endswith(".brlyt"):
            continue
        offset = 0x10
        for _ in range(struct.unpack(">H", data[14:16])[0]):
            kind, size = data[offset:offset + 4], struct.unpack(">I", data[offset + 4:offset + 8])[0]
            if kind == b"txt1":
                length = struct.unpack(">H", data[offset + 78:offset + 80])[0]
                start = offset + struct.unpack(">I", data[offset + 88:offset + 92])[0]
                text += data[start:start + length].decode("utf-16-be", "replace")
            offset += size
    return text


def main(nand):
    menu = find_u8(nand / "title/00000001/00000002/content", "layout/common/chanSel.ash")
    shared = find_u8(nand / "shared1", "wbf1.brfna")
    OUTPUT.joinpath("fonts").mkdir(parents=True, exist_ok=True)

    strings = ""
    for name in ARCHIVES:
        packed = menu[f"layout/common/{name}.ash"]
        (OUTPUT / f"{name}.ash").write_bytes(packed)
        strings += layout_strings(wii.u8_files(wii.ash0(packed)))
        print(f"{name}.ash  {len(packed):8,} bytes")

    messages = {}
    for record in wii.bmg(menu["message/eng/ipl_common.bmg"])["records"]:
        # Control packets (inserted values, colors) stay in place as {hex} so the page can fill them in.
        parts = [t["value"] if t["type"] == "text" else "{%s}" % t["rawHex"] for t in record["tokens"]]
        messages[str(record["id"])] = "".join(parts)
        strings += record["text"]
    (OUTPUT / "messages.json").write_text(json.dumps(messages, indent=1, ensure_ascii=False) + "\n")
    print(f"messages.json  {len(messages)} messages")

    codes = {ord(c) for c in strings if ord(c) >= 0x20}
    for start, end in EXTRA_RANGES:
        codes.update(range(start, end))
    fonts = {name: shared[source] for name, source in SHARED_FONTS.items()}
    fonts[MENU_FONT] = wii.u8_files(wii.ash0(menu["font/font.ash"]))[f"arc/font/{MENU_FONT}.brfnt"]
    for name, data in fonts.items():
        image, metrics = subset_font(wii.font(data), codes)
        (OUTPUT / "fonts" / f"{name}.png").write_bytes(image)
        (OUTPUT / "fonts" / f"{name}.json").write_text(json.dumps(metrics, separators=(",", ":")) + "\n")
        print(f"{name}  {len(metrics['glyphs'])} glyphs, {len(image):,} byte atlas")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / ".local/share/dolphin-emu/Wii")
