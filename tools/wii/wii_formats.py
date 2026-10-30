"""Wii resource decoders used by the build tools: U8, ASH0, BMG messages, GX textures and RFNT/RFNA fonts.

Vendored from Tomoeko's Wii_Menu_HTML (tools/assets/formats.py, CC0 1.0): https://github.com/Tomoeko/Wii_Menu_HTML
"""

import binascii
import struct
import unicodedata
import zlib
from pathlib import PurePosixPath


def unpack(data, fmt, offset=0):
    return struct.unpack_from(">" + fmt, data, offset)


def string(data, offset=0, size=None):
    return data[offset : offset + size if size else len(data)].split(b"\0", 1)[0].decode("utf-8")


def bmg(data):
    """Read UTF-16 message tables while retaining opaque control packets."""
    if len(data) < 32 or data[:8] != b"MESGbmg1" or data[16] != 2:
        raise ValueError("Expected big-endian UTF-16 BMG messages")
    total, count = unpack(data, "II", 8)
    if total > len(data):
        raise ValueError("Truncated BMG file")
    offset, blocks = 32, {}
    for _ in range(count):
        if offset + 8 > total:
            raise ValueError("Truncated BMG section")
        (length,) = unpack(data, "I", offset + 4)
        if length < 8 or offset + length > total:
            raise ValueError("Invalid BMG section size")
        blocks[data[offset : offset + 4]] = data[offset + 8 : offset + length]
        offset += length
    info, strings = blocks.get(b"INF1", b""), blocks.get(b"DAT1", b"")
    if len(info) < 8:
        raise ValueError("Missing BMG message table")
    count, stride = unpack(info, "HH")
    if stride < 4 or 8 + count * stride > len(info):
        raise ValueError("Invalid BMG message records")
    records = []
    for index in range(count):
        (start,) = unpack(info, "I", 8 + index * stride)
        cursor, plain, tokens, text = start, bytearray(), [], ""
        while cursor + 2 <= len(strings):
            value = strings[cursor : cursor + 2]
            if value == b"\0\0":
                break
            if value == b"\0\x1a":
                if plain:
                    part = plain.decode("utf-16-be")
                    text += part
                    tokens.append({"type": "text", "value": part})
                    plain.clear()
                length = strings[cursor + 2] if cursor + 2 < len(strings) else 0
                if length < 4 or cursor + length > len(strings):
                    raise ValueError("Invalid BMG control packet")
                tokens.append(
                    {"type": "control", "rawHex": strings[cursor : cursor + length].hex()}
                )
                cursor += length
            else:
                plain.extend(value)
                cursor += 2
        else:
            raise ValueError("Unterminated BMG message")
        if plain:
            part = plain.decode("utf-16-be")
            text += part
            tokens.append({"type": "text", "value": part})
        records.append(
            {
                "id": index,
                "text": text,
                "tokens": tokens,
                "attributes": info[12 + index * stride : 8 + (index + 1) * stride].hex(),
            }
        )
    return {
        "encoding": "utf-16-be",
        "messages": {str(r["id"]): r["text"] for r in records},
        "records": records,
    }


def u8_files(data):
    if len(data) < 32 or data[:4] != b"U\xaa8-":
        raise ValueError("Expected U8 archive")
    root, header_size, data_offset = unpack(data, "III", 4)
    if root < 32 or root + 12 > len(data):
        raise ValueError("Invalid U8 root node")
    root_kind, root_parent, count = unpack(data, "III", root)
    if root_kind >> 24 != 1 or root_parent != 0 or count < 1:
        raise ValueError("Invalid U8 root node")
    strings = root + count * 12
    names_end = root + header_size
    if strings > names_end or names_end > data_offset or data_offset > len(data):
        raise ValueError("Invalid U8 archive table")
    stack = [(count, "")]
    result = {}
    seen = set()
    for i in range(1, count):
        while stack[-1][0] <= i:
            stack.pop()
        kind_name, offset, size = unpack(data, "III", root + i * 12)
        kind = kind_name >> 24
        start = strings + (kind_name & 0xFFFFFF)
        end = data.find(b"\0", start, names_end) if start < names_end else -1
        if kind not in (0, 1) or end < 0 or end - start > 255:
            raise ValueError("Invalid U8 entry")
        try:
            name = data[start:end].decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError("Invalid U8 entry name") from error
        if (
            not name or name in (".", "..") or name.endswith((".", " "))
            or any(ord(character) < 32 or ord(character) == 127
                   or character in '/\\:*?"<>|' for character in name)
            or name.split(".", 1)[0].upper() in {
                "CON", "PRN", "AUX", "NUL",
                *(f"COM{number}" for number in range(1, 10)),
                *(f"LPT{number}" for number in range(1, 10)),
            }
        ):
            raise ValueError("Invalid U8 entry name")
        path = str(PurePosixPath(stack[-1][1]) / name)
        portable_path = unicodedata.normalize("NFC", path).casefold()
        if portable_path in seen:
            raise ValueError("Duplicate U8 entry path")
        seen.add(portable_path)
        if kind == 1:
            if size <= i or size > stack[-1][0]:
                raise ValueError("Invalid U8 directory boundary")
            stack.append((size, path))
        else:
            if offset + size > len(data):
                raise ValueError("Truncated U8 file")
            result[path] = data[offset : offset + size]
    return result


class Bits:
    def __init__(self, data, offset):
        self.data, self.position = data, offset * 8

    def read(self, count):
        value = 0
        for _ in range(count):
            if self.position >= len(self.data) * 8:
                raise ValueError("Truncated ASH bitstream")
            value = value * 2 + ((self.data[self.position // 8] >> (7 - self.position % 8)) & 1)
            self.position += 1
        return value


def ash0(data):
    if data[:4] != b"ASH0":
        return data
    size, offset = unpack(data, "II", 4)
    size &= 0xFFFFFF
    a, b = Bits(data, 12), Bits(data, offset)

    def tree(bits, count):
        if bits.read(1):
            return (tree(bits, count), tree(bits, count))
        return bits.read(count)

    ta, tb = tree(a, 9), tree(b, 11)

    def symbol(bits, node):
        while isinstance(node, tuple):
            node = node[bits.read(1)]
        return node

    out = bytearray()
    while len(out) < size:
        value = symbol(a, ta)
        if value < 256:
            out.append(value)
        else:
            distance = symbol(b, tb) + 1
            if distance > len(out):
                raise ValueError("ASH back-reference before output")
            for _ in range(min(value - 0xFD, size - len(out))):
                out.append(out[-distance])
    return bytes(out)


def sections(data, signature):
    if data[:4] != signature or data[4:6] != b"\xfe\xff":
        raise ValueError("Expected big-endian " + signature.decode())
    size, offset, count = unpack(data, "IHH", 8)
    if size > len(data):
        raise ValueError("Truncated NW4R file")
    for _ in range(count):
        (length,) = unpack(data, "I", offset + 4)
        if length < 8 or offset + length > size:
            raise ValueError("Invalid NW4R section size")
        yield data[offset : offset + 4].decode(), data[offset : offset + length]
        offset += length


def rgb565(value):
    r, g, b = value >> 11, (value >> 5) & 63, value & 31
    return [r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2, 255]


def rgb5a3(value):
    if value & 0x8000:
        channels = [(value >> shift) & 31 for shift in (10, 5, 0)]
        return [c << 3 | c >> 2 for c in channels] + [255]
    alpha = (value >> 12) & 7
    return [((value >> shift) & 15) * 17 for shift in (8, 4, 0)] + [
        alpha << 5 | alpha << 2 | alpha >> 1
    ]


def decode_texture(data, width, height, fmt, palette=None):
    shapes = {
        0: (8, 8, 32),
        1: (8, 4, 32),
        2: (8, 4, 32),
        3: (4, 4, 32),
        4: (4, 4, 32),
        5: (4, 4, 32),
        6: (4, 4, 64),
        8: (8, 8, 32),
        9: (8, 4, 32),
        10: (4, 4, 32),
        14: (8, 8, 32),
    }
    if fmt not in shapes:
        raise ValueError(f"Unsupported GX texture format {fmt}")
    bw, bh, size = shapes[fmt]
    output, offset = bytearray(width * height * 4), 0
    for by in range(0, height, bh):
        for bx in range(0, width, bw):
            tile = data[offset : offset + size]
            offset += size
            if len(tile) < size:
                raise ValueError("Truncated texture tile")
            for y in range(bh):
                for x in range(bw):
                    i = y * bw + x
                    if fmt in (0, 8):
                        value = (tile[i // 2] >> (0 if i & 1 else 4)) & 15
                        color = [value * 17] * 4 if fmt == 0 else palette[value]
                    elif fmt in (1, 2, 9):
                        value = tile[i]
                        color = (
                            [value] * 4
                            if fmt == 1
                            else (
                                [value % 16 * 17] * 3 + [value // 16 * 17]
                                if fmt == 2
                                else palette[value]
                            )
                        )
                    elif fmt in (3, 4, 5, 10):
                        (value,) = unpack(tile, "H", i * 2)
                        color = (
                            [value & 255] * 3 + [value >> 8]
                            if fmt == 3
                            else (
                                rgb565(value)
                                if fmt == 4
                                else rgb5a3(value) if fmt == 5 else palette[value & 0x3FFF]
                            )
                        )
                    elif fmt == 6:
                        color = [tile[i * 2 + 1], tile[32 + i * 2], tile[33 + i * 2], tile[i * 2]]
                    else:
                        sub = (y // 4 * 2 + x // 4) * 8
                        c0, c1 = unpack(tile, "2H", sub)
                        a, b = rgb565(c0), rgb565(c1)
                        if c0 > c1:
                            colors = [
                                a,
                                b,
                                [(5 * a[t] + 3 * b[t]) >> 3 for t in range(3)] + [255],
                                [(3 * a[t] + 5 * b[t]) >> 3 for t in range(3)] + [255],
                            ]
                        else:
                            colors = [
                                a,
                                b,
                                [(a[t] + b[t]) // 2 for t in range(3)] + [255],
                                [(a[t] + b[t]) // 2 for t in range(3)] + [0],
                            ]
                        color = colors[(tile[sub + 4 + y % 4] >> (6 - 2 * (x % 4))) & 3]
                    if bx + x < width and by + y < height:
                        loc = ((by + y) * width + bx + x) * 4
                        output[loc : loc + 4] = bytes(color)
    return bytes(output)


def png(width, height, pixels):
    def chunk(kind, payload):
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
        )

    scanlines = b"".join(b"\0" + pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines, 9))
        + chunk(b"IEND", b"")
    )


def huffman(data):
    """Nintendo CX Huffman (4/8-bit symbols), as used by RFNA glyph sheets."""
    if not data or data[0] not in (0x24, 0x28):
        raise ValueError("Expected Nintendo 4/8-bit Huffman stream")
    depth, size = data[0] & 15, int.from_bytes(data[1:4], "little")
    table = 4
    if not size:
        size, table = int.from_bytes(data[4:8], "little"), 8
    start = table + (data[table] + 1) * 2
    node, output, nibble = table + 1, bytearray(), None
    while len(output) < size:
        if start + 4 > len(data):
            raise ValueError("Truncated Huffman bits")
        word = int.from_bytes(data[start : start + 4], "little")
        start += 4
        for shift in range(31, -1, -1):
            bit, descriptor = (word >> shift) & 1, data[node]
            node = (node & ~1) + ((descriptor & 63) + 1) * 2 + bit
            if node >= table + (data[table] + 1) * 2:
                raise ValueError("Huffman tree reference outside table")
            if descriptor & (0x80 >> bit):
                symbol, node = data[node], table + 1
                if depth == 8:
                    output.append(symbol)
                elif nibble is None:
                    nibble = symbol & 15
                else:
                    output.append(nibble | ((symbol & 15) << 4))
                    nibble = None
                if len(output) == size:
                    break
    return bytes(output)


def font(data):
    """Export RFNT/RFNA sheets and original glyph metrics; load all glyph groups."""
    signature = data[:4]
    if signature not in (b"RFNT", b"RFNA"):
        raise ValueError("Expected RFNT or RFNA font")
    blocks = dict(sections(data, signature))
    info = blocks["FINF"]
    glyph_offset, width_offset, map_offset = unpack(info, "3I", 16)
    (
        cell_width,
        cell_height,
        baseline,
        max_width,
        sheet_size,
        count,
        fmt,
        columns,
        rows,
        width,
        height,
        image,
    ) = unpack(data, "BBbBIHHHHHHI", glyph_offset)
    metrics, char_map = {}, {}
    pos = width_offset
    seen = set()
    while pos:
        if pos in seen:
            raise ValueError("Circular RFNT width chain")
        seen.add(pos)
        begin, end, nxt = unpack(data, "HHI", pos)
        for index in range(begin, end + 1):
            left, glyph_width, advance = unpack(data, "bBb", pos + 8 + (index - begin) * 3)
            cell = index % (columns * rows)
            metrics[str(index)] = {
                "sheet": index // (columns * rows),
                "x": (cell % columns) * (cell_width + 1) + 1,
                "y": (cell // columns) * (cell_height + 1) + 1,
                "width": glyph_width,
                "height": cell_height,
                "left": left,
                "advance": advance,
            }
        pos = nxt
    pos, seen = map_offset, set()
    while pos:
        if pos in seen:
            raise ValueError("Circular RFNT character map")
        seen.add(pos)
        begin, end, method, _, nxt = unpack(data, "4HI", pos)
        if method == 0:
            (start,) = unpack(data, "H", pos + 12)
            char_map.update({str(c): start + c - begin for c in range(begin, end + 1)})
        elif method == 1:
            for c in range(begin, end + 1):
                (index,) = unpack(data, "H", pos + 12 + (c - begin) * 2)
                if index != 0xFFFF:
                    char_map[str(c)] = index
        elif method == 2:
            (count_entries,) = unpack(data, "H", pos + 12)
            for i in range(count_entries):
                code, index = unpack(data, "2H", pos + 14 + i * 4)
                char_map[str(code)] = index
        else:
            raise ValueError(f"Unknown RFNT map method {method}")
        pos = nxt
    sheets, cursor = [], image
    for i in range(count):
        if fmt & 0x8000:
            (compressed_size,) = unpack(data, "I", cursor)
            pixels = huffman(data[cursor + 4 : cursor + 4 + compressed_size])
            cursor += 4 + compressed_size
            if len(pixels) != sheet_size:
                raise ValueError("RFNA expanded sheet size mismatch")
        else:
            pixels = data[cursor : cursor + sheet_size]
            cursor += sheet_size
        sheets.append(
            {
                "width": width,
                "height": height,
                "format": fmt & 0x7FFF,
                "pixels": decode_texture(pixels, width, height, fmt & 0x7FFF),
            }
        )
    return {
        "cellWidth": cell_width,
        "cellHeight": cell_height,
        "baseline": baseline,
        "lineFeed": unpack(info, "b", 9)[0],
        "height": info[28],
        "width": info[29],
        "ascent": info[30],
        "encoding": info[15],
        "defaultGlyph": unpack(info, "H", 10)[0],
        "glyphs": metrics,
        "characters": char_map,
        "sheets": sheets,
    }
