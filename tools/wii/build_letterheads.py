"""Pack the channel stationery the Message Board letters use on /wii-forwarders.

A channel's letter could carry its own envelope (thumbnail_LZ.bin) and paper (letter_LZ.bin). These come
from RiiConnect24's WMB-Letterhead collection of Nintendo's originals. Each Wii Shop Channel envelope gets
a filled star from the Wii's system font on its stamp. Per letterhead this writes:

    public/wii-forwarders/menu/letterheads/<name>.u8    the envelope, img/my_LetterS_b.tpl, and the paper,
                                                        letter_LZ.bin, exactly as the channel sent it

usage: python3 tools/wii/build_letterheads.py [NAND]   (default: Dolphin's NAND, read only)
"""

import struct
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import wii_formats as wii
from build_menu_assets import find_u8
from build_rotate_screen import u8_archive
from sync_channels import lz77

COLLECTION = "https://raw.githubusercontent.com/RiiConnect24/WMB-Letterhead/624f4329193e8ea89276c05be02a17bd17dbb613/Letterhead/"
# Each envelope's stamp gets its symbol in the color of the envelope's ribbon.
LETTERHEADS = {
    "wii-shop-gift": ("Wii Shop Channel/Wii Shop Channel - Gift.arc", "★", (255, 99, 99)),
    "wii-shop-returned": ("Wii Shop Channel/Wii Shop Channel - Returned.arc", "★", (33, 156, 222)),
}
STAMP_BLUE = (206, 239, 255)
OUTPUT = Path(__file__).resolve().parents[2] / "public/wii-forwarders/menu/letterheads"


def glyph(font, char):
    """A character's coverage in a Wii font, cropped to its ink."""
    found = font["glyphs"][str(font["characters"][str(ord(char))])]
    sheet = font["sheets"][found["sheet"]]
    image = Image.frombytes("RGBA", (sheet["width"], sheet["height"]), bytes(sheet["pixels"]))
    cell = image.crop((found["x"], found["y"], found["x"] + font["cellWidth"], found["y"] + font["cellHeight"]))
    coverage = cell.getchannel("A")
    return coverage.crop(coverage.getbbox())


def draw_on_stamp(tpl, mark, color):
    """Draws `mark` in `color` over the middle of the stamp on an RGB5A3 envelope TPL, postmark included."""
    tpl = bytearray(tpl)
    header = struct.unpack(">I", tpl[12:16])[0]
    height, width, fmt, data = struct.unpack(">HHII", tpl[header : header + 12])
    if fmt != 5:
        raise SystemExit(f"expected an RGB5A3 envelope, got format {fmt}")
    pixels = wii.decode_texture(bytes(tpl[data:]), width, height, fmt)
    stamp = [(i % width, i // width) for i in range(width * height) if tuple(pixels[i * 4 : i * 4 + 3]) == STAMP_BLUE]
    left = round((min(x for x, _ in stamp) + max(x for x, _ in stamp) + 1 - mark.width) / 2)
    top = round((min(y for _, y in stamp) + max(y for _, y in stamp) + 1 - mark.height) / 2)
    for y in range(mark.height):
        for x in range(mark.width):
            if not (alpha := mark.getpixel((x, y)) / 255):
                continue
            px, py = left + x, top + y
            under = pixels[(py * width + px) * 4 : (py * width + px) * 4 + 3]
            r, g, b = (round(c * (1 - alpha) + k * alpha) for c, k in zip(under, color))
            at = data + ((py // 4) * (width // 4) + px // 4) * 32 + ((py % 4) * 4 + px % 4) * 2
            tpl[at : at + 2] = struct.pack(">H", 0x8000 | (r >> 3) << 10 | (g >> 3) << 5 | b >> 3)
    return bytes(tpl)


def main(nand):
    font = wii.font(find_u8(nand / "shared1", "wbf2.brfna")["wbf2.brfna"])
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, (path, symbol, color) in LETTERHEADS.items():
        with urllib.request.urlopen(COLLECTION + urllib.parse.quote(path), timeout=60) as response:
            attachment = wii.u8_files(response.read())
        thumbnail = wii.u8_files(lz77(attachment["thumbnail_LZ.bin"]))
        envelope = next(data for inner, data in thumbnail.items() if inner.endswith("/my_LetterS_b.tpl"))
        files = {
            "img/my_LetterS_b.tpl": draw_on_stamp(envelope, glyph(font, symbol), color),
            "letter_LZ.bin": attachment["letter_LZ.bin"],
        }
        (OUTPUT / f"{name}.u8").write_bytes(u8_archive(files))
        print(f"{name}.u8: {symbol} on the stamp")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / ".local/share/dolphin-emu/Wii")
