"""Typeset the screen /wii-forwarders shows a phone held upright: the Wii's Health and Safety screen, reworded.

The System Menu's health.ash supplies the layout and its fade clips, kept exactly as they are. Its two
text pictures are set again with the WORDS below in the Wii's own WiiNTLG font, which the console's
pictures use heavier, so each glyph is grown to match. The sizes, weights, spacing and baselines in STYLES
and LINES were fitted against the originals, and the warning sign is redrawn from a fit to its pixels.
The pictures are PNGs at twice the console's resolution, so they stay sharp on a phone's screen:

    public/wii-forwarders/menu/rotate.u8    layout, clips and pictures in one uncompressed U8 archive

usage: python3 tools/wii/build_rotate_screen.py [NAND]   (default: Dolphin's NAND, read only)

Needs Pillow 11.2 or newer. To change the wording, edit WORDS and run this again.
"""

import io
import struct
import sys
from pathlib import Path
from typing import NamedTuple

from PIL import Image, ImageDraw, ImageFont

import wii_formats as wii
from build_menu_assets import find_u8

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "public/wii-forwarders/menu/rotate.u8"

# The original's lines, in the same shape: a heading, three lines, an address and a last line.
WORDS = {
    "heading": "WARNING-SCREEN ORIENTATION",
    "body": ["BEFORE BROWSING, ROTATE YOUR DEVICE", "SIDEWAYS IF YOU WOULD PREFER NOT TO", "VIEW THE WII MENU LETTERBOXED."],
    "online": "Or view from your desktop at:",
    "address": "cmyksoda.cc/wii-forwarders/",
    "last": "Rotate your device to continue.",
}

SCREEN = (608, 456)  # the layout's size in units; the main picture covers it
LAST_SIZE = (608, 88)  # the last line's picture, along the bottom of the screen
SCALE = 2  # picture pixels per unit; the console's pictures have 1
SUPER = 4  # lines are drawn this many times larger again, then averaged down
DRAW = SCALE * SUPER
MARGIN = 24  # units a line keeps clear of each side
PGOTHIC = 1  # the proportional face of the font collection


class Style(NamedTuple):
    size: float  # em, in units
    stroke: float  # how far each glyph grows on every side, in units
    tracking: float  # added after every glyph, in units
    space: float  # a space's advance, in ems
    kerning: dict = {}  # pairs drawn closer, in ems


# Fitted to how the engine draws the originals (smoothly sampled, then squared), so they match in weight, not in pixels.
STYLES = {
    "heading": Style(22.735, 1.46, 4.12, 0.288, {"LT": -0.067, "TA": -0.076, "AT": -0.067}),
    "body": Style(18.87, 0.69, 2.00, 0.311, {"TA": -0.066, "AT": -0.058, "LT": -0.058}),
    "online": Style(16.66, 0.48, 1.52, 0.285),
    "address": Style(19.87, 0.68, 2.03, 0.332),
    "last": Style(20.36, 1.12, 3.49, 0.223),
}

# Where each line sits: its style, the baseline of its outlines and the middle of its ink, in units.
LINES = {
    "heading": ("heading", 81.91, 299.0),
    "body": [("body", 160.25, 303.17), ("body", 197.25, 303.17), ("body", 234.25, 303.17)],
    "online": ("online", 300.51, 304.0),
    "address": ("address", 335.90, 304.0),
    "last": ("last", 26.93, 304.5),
}

# The warning sign, which the font lacks: a rounded triangle with an exclamation mark cut out of it.
SIGN = {
    "apex": (67.47, 55.84), "base": 87.67, "half": 18.21, "corner": 1.03,
    "bar": (67.50, 64.95, 79.46, 2.45, 1.06), "dot": (67.50, 83.44, 2.39, 2.22, 0.60),
}
SIGN_TO_TEXT = 23.79  # from the sign's middle to where the heading's first glyph starts


class Face:
    """The font at any size, with every glyph's advance in ems."""

    def __init__(self, data):
        self.data = data
        self.advances = {}
        self.reference = self.at(1000)

    def at(self, px):
        return ImageFont.truetype(io.BytesIO(self.data), px, index=PGOTHIC, layout_engine=ImageFont.Layout.BASIC)

    def advance(self, char):
        if char not in self.advances:
            self.advances[char] = self.reference.getlength(char) / 1000
        return self.advances[char]


def set_line(face, text, style):
    """A line's coverage at DRAW pixels per unit, its pen starting MARGIN units in, and its baseline's row."""
    font = face.at(style.size * DRAW)
    width = sum(face.advance(char) * style.size + style.tracking for char in text) + 2 * MARGIN
    ascent = round(style.size * 1.2)
    line = Image.new("L", (round(width * DRAW), (ascent + round(style.size * 0.6)) * DRAW))
    draw = ImageDraw.Draw(line)
    pen = MARGIN
    for i, char in enumerate(text):
        if char != " ":
            draw.text((round(pen * DRAW), ascent * DRAW), char, font=font, fill=255, anchor="ls",
                      stroke_width=style.stroke * DRAW)
        pen += (style.space if char == " " else face.advance(char)) * style.size + style.tracking
        pen += style.kerning.get(text[i:i + 2], 0) * style.size
    return line, ascent


def draw_sign(canvas, shift):
    """The sign `shift` units to the right of where the original has it."""
    draw = ImageDraw.Draw(canvas)
    apex, base, half, corner = SIGN["apex"], SIGN["base"], SIGN["half"], SIGN["corner"]
    points = [(apex[0] + shift, apex[1]), (apex[0] + shift - half, base), (apex[0] + shift + half, base)]

    def px(*units):
        return [round(unit * DRAW) for unit in units]

    draw.polygon([tuple(px(x, y)) for x, y in points], fill=255)
    # Rounded corners: each edge and each corner is grown by the corner radius.
    for i, (x, y) in enumerate(points):
        draw.line(px(x, y, *points[(i + 1) % 3]), fill=255, width=round(2 * corner * DRAW))
        draw.ellipse(px(x - corner, y - corner, x + corner, y + corner), fill=255)
    x, top, bottom, half_width, radius = SIGN["bar"]
    draw.rounded_rectangle(px(x + shift - half_width, top, x + shift + half_width, bottom), radius * DRAW, fill=0)
    x, y, half_width, half_height, radius = SIGN["dot"]
    draw.rounded_rectangle(px(x + shift - half_width, y - half_height, x + shift + half_width, y + half_height),
                           radius * DRAW, fill=0)


def place(canvas, text, style, baseline, center, face, sign=None):
    """Sets a line with its ink centered on `center` (`sign` is how far left of its pen the sign's ink reaches)."""
    line, ascent = set_line(face, text, STYLES[style])
    left, _, right, _ = line.getbbox()
    left, right = left / DRAW, right / DRAW
    if sign is not None:
        left = min(left, MARGIN - sign)
    x = center - (left + right) / 2
    if x + left < MARGIN or x + right > canvas.width / DRAW - MARGIN:
        raise SystemExit(f"'{text}' is too wide for its picture: {right - left:.0f} units")
    canvas.paste(255, (round(x * DRAW), round((baseline - ascent) * DRAW)), line)
    return x + MARGIN  # where its pen started


def typeset(face):
    """The two pictures, as 8-bit coverage: the main text and the last line."""
    main = Image.new("L", (SCREEN[0] * DRAW, SCREEN[1] * DRAW))
    style, baseline, center = LINES["heading"]
    reach = SIGN_TO_TEXT + SIGN["half"] + SIGN["corner"]
    pen = place(main, WORDS["heading"], style, baseline, center, face, sign=reach)
    draw_sign(main, pen - SIGN_TO_TEXT - SIGN["apex"][0])
    for text, (style, baseline, center) in zip(WORDS["body"], LINES["body"]):
        place(main, text, style, baseline, center, face)
    for key in ("online", "address"):
        style, baseline, center = LINES[key]
        place(main, WORDS[key], style, baseline, center, face)
    last = Image.new("L", (LAST_SIZE[0] * DRAW, LAST_SIZE[1] * DRAW))
    style, baseline, center = LINES["last"]
    place(last, WORDS["last"], style, baseline, center, face)
    return [picture.resize((picture.width // SUPER, picture.height // SUPER), Image.Resampling.BOX)
            for picture in (main, last)]


def png(image):
    """A gray ramp as a palette rather than as a gray PNG, which browsers color-manage on their own terms."""
    indexed = image.convert("P")
    indexed.putpalette([level for level in range(256) for _ in range(3)])
    out = io.BytesIO()
    indexed.save(out, "PNG", optimize=True)
    return out.getvalue()


def u8_archive(files):
    """An uncompressed U8 archive of {path: bytes}: a header, a node per folder and file, their names, then the data."""
    tree = {}
    for path, data in files.items():
        *folders, name = path.split("/")
        folder = tree
        for part in folders:
            folder = folder.setdefault(part, {})
        folder[name] = data

    nodes = [{"name": "", "folder": True, "parent": 0}]  # node 0 is the root

    def add(folder, parent):
        for name, item in sorted(folder.items()):
            if isinstance(item, dict):
                node = {"name": name, "folder": True, "parent": parent}
                nodes.append(node)
                add(item, len(nodes) - 1)
                node["end"] = len(nodes)  # the first node after everything inside it
            else:
                nodes.append({"name": name, "folder": False, "data": item})

    add(tree, 0)
    nodes[0]["end"] = len(nodes)
    names = b"".join(node["name"].encode() + b"\0" for node in nodes)
    table = 0x20
    start = -(-(table + 12 * len(nodes) + len(names)) // 0x40) * 0x40  # the files start on a 0x40 boundary

    records, body, name_at = [], b"", 0
    for node in nodes:
        if node["folder"]:
            first, second = node["parent"], node["end"]
        else:
            first, second = start + len(body), len(node["data"])
            body += node["data"] + b"\0" * (-len(node["data"]) % 0x20)
        records.append(struct.pack(">III", node["folder"] << 24 | name_at, first, second))
        name_at += len(node["name"]) + 1
    header = struct.pack(">4s3I16x", b"\x55\xaa\x38\x2d", table, 12 * len(nodes) + len(names), start)
    head = header + b"".join(records) + names
    return head + b"\0" * (start - len(head)) + body


def main(nand):
    menu = find_u8(nand / "title/00000001/00000002/content", "layout/common/health.ash")
    health = wii.u8_files(wii.ash0(menu["layout/common/health.ash"]))
    face = Face(find_u8(nand / "shared1", "WiiNTLG-Regular.ttc")["WiiNTLG-Regular.ttc"])

    clips = (f"arc/anim/it_Has_a_{clip}.brlan" for clip in ("SeenIn", "Push", "SeenOut"))
    files = {path: health[path] for path in ("arc/blyt/it_Has_a.brlyt", *clips)}
    main_picture, last_picture = typeset(face)
    files["arc/timg/it_Has_a_US_ENG.png"] = png(main_picture)
    files["arc/timg/it_Has_b_US_ENG.png"] = png(last_picture)
    # The same words as text, for screen readers, which can't read the pictures.
    lines = [WORDS["heading"], *WORDS["body"], WORDS["online"], WORDS["address"], WORDS["last"]]
    files["arc/words.txt"] = "\n".join(lines).encode()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(u8_archive(files))
    for path, data in files.items():
        print(f"{path}  {len(data):7,} bytes")
    print(f"{OUTPUT.relative_to(ROOT)}  {OUTPUT.stat().st_size:,} bytes")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / ".local/share/dolphin-emu/Wii")
