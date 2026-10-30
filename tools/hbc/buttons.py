#!/usr/bin/env -S python3 -I
"""Draws the page's info and grid/list buttons from HBC's own round arrow button.

Usage: tools/hbc/buttons.py   (writes src/hbc/assets/{info,view_grid,view_list}{,_hover}.png)

Needs Pillow. The arrow is painted out of apps_previous.png and its hover twin,
and a new glyph is drawn in the arrow's colors, then the result is scaled to 32 x 32
to sit where the USB Gecko and network icons were.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ASSETS = Path(__file__).resolve().parents[2] / "src" / "hbc" / "assets"
SCALE = 4
SIZE = 32


def remove_arrow(button):
    """Each row inside the circle is nearly flat, so the arrow is bridged row by row."""
    button = button.copy()
    pixels = button.load()
    for y in range(17, 47):
        left, right = pixels[16, y], pixels[49, y]
        for x in range(17, 49):
            t = (x - 16) / 33
            pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(left, right))
    return button


def glyph_mask(kind):
    mask = Image.new("L", (64 * SCALE, 64 * SCALE))
    draw = ImageDraw.Draw(mask)

    def box(x0, y0, x1, y1):
        draw.rounded_rectangle([v * SCALE for v in (x0, y0, x1, y1)], radius=SCALE, fill=255)

    if kind == "info":
        draw.ellipse([v * SCALE for v in (28, 15, 36, 23)], fill=255)
        box(28, 27, 36, 48)
    if kind == "view_list":
        for row in range(3):
            y = 19 + row * 10
            box(18, y, 46, y + 7)
    elif kind == "view_grid":
        for y in (18.5, 34.5):
            box(18, y, 30, y + 12)
            box(34, y, 46, y + 12)
    return mask


def glyph(kind):
    """The arrow's look: a light grey vertical gradient over a soft dark shadow."""
    mask = glyph_mask(kind)
    side = mask.width
    shade = Image.new("L", (side, side))
    for y in range(side):
        t = min(1, max(0, (y / SCALE - 15) / 33))
        shade.paste(round(0xE6 - (0xE6 - 0xAE) * t), (0, y, side, y + 1))
    fill = Image.merge("RGBA", (shade, shade, shade, mask))

    shadow_alpha = mask.point(lambda a: a * 150 // 255).filter(ImageFilter.GaussianBlur(SCALE * 0.6))
    shadow = Image.new("RGBA", (side, side))
    shadow.paste((0, 0, 0, 255), (SCALE, SCALE), shadow_alpha.crop((0, 0, side - SCALE, side - SCALE)))
    return Image.alpha_composite(shadow, fill)


def main():
    for source, suffix in (("apps_previous.png", ""), ("apps_previous_hover.png", "_hover")):
        button = remove_arrow(Image.open(ASSETS / source).convert("RGBA"))
        large = button.resize((64 * SCALE, 64 * SCALE), Image.BICUBIC)
        for kind in ("info", "view_grid", "view_list"):
            drawn = Image.alpha_composite(large, glyph(kind))
            small = drawn.convert("RGBa").resize((SIZE, SIZE), Image.LANCZOS).convert("RGBA")
            small.save(ASSETS / f"{kind}{suffix}.png", optimize=True)


if __name__ == "__main__":
    main()
