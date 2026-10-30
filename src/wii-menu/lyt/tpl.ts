import { Reader } from './binary';

export interface Texture {
  width: number;
  height: number;
  /** Straight (non-premultiplied) RGBA8 pixels. */
  rgba: Uint8Array;
  /** Sampler settings from the TPL header: wrap 0 clamp, 1 repeat, 2 mirror; filter 0 nearest. */
  wrapS: number;
  wrapT: number;
  minFilter: number;
  magFilter: number;
}

const enum Format {
  I4 = 0, I8 = 1, IA4 = 2, IA8 = 3, RGB565 = 4, RGB5A3 = 5, RGBA8 = 6,
  CI4 = 8, CI8 = 9, CI14 = 10, CMPR = 14,
}

// Block width, block height and bytes per block, from the GX texture tiling rules.
const TILES: Record<number, [number, number, number]> = {
  [Format.I4]: [8, 8, 32], [Format.I8]: [8, 4, 32], [Format.IA4]: [8, 4, 32],
  [Format.IA8]: [4, 4, 32], [Format.RGB565]: [4, 4, 32], [Format.RGB5A3]: [4, 4, 32],
  [Format.RGBA8]: [4, 4, 64], [Format.CI4]: [8, 8, 32], [Format.CI8]: [8, 4, 32],
  [Format.CI14]: [4, 4, 32], [Format.CMPR]: [8, 8, 32],
};

function expand(value: number, bits: number): number {
  return bits === 3 ? (value << 5) | (value << 2) | (value >> 1)
    : bits === 4 ? value * 17
    : bits === 5 ? (value << 3) | (value >> 2)
    : (value << 2) | (value >> 4);
}

function rgb565(value: number, out: Uint8Array, at: number): void {
  out[at] = expand(value >> 11, 5);
  out[at + 1] = expand((value >> 5) & 63, 6);
  out[at + 2] = expand(value & 31, 5);
  out[at + 3] = 255;
}

function rgb5a3(value: number, out: Uint8Array, at: number): void {
  if (value & 0x8000) {
    out[at] = expand((value >> 10) & 31, 5);
    out[at + 1] = expand((value >> 5) & 31, 5);
    out[at + 2] = expand(value & 31, 5);
    out[at + 3] = 255;
  } else {
    out[at] = expand((value >> 8) & 15, 4);
    out[at + 1] = expand((value >> 4) & 15, 4);
    out[at + 2] = expand(value & 15, 4);
    out[at + 3] = expand((value >> 12) & 7, 3);
  }
}

function decodePalette(reader: Reader, offset: number, count: number, format: number): Uint8Array {
  const palette = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const value = reader.u16(offset + i * 2);
    if (format === 0) {
      palette.set([value & 255, value & 255, value & 255, value >> 8], i * 4);
    } else if (format === 1) {
      rgb565(value, palette, i * 4);
    } else {
      rgb5a3(value, palette, i * 4);
    }
  }
  return palette;
}

/** Decodes a tiled GX image into straight RGBA8. */
function decodeImage(reader: Reader, offset: number, width: number, height: number,
  format: number, palette: Uint8Array | null): Uint8Array {
  const [bw, bh, blockSize] = TILES[format] ?? [];
  if (!bw) throw new Error(`Unsupported GX texture format ${format}`);
  const out = new Uint8Array(width * height * 4);
  const px = new Uint8Array(4);
  const cmpr = new Uint8Array(16);
  let block = offset;

  for (let by = 0; by < height; by += bh) {
    for (let bx = 0; bx < width; bx += bw) {
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const i = y * bw + x;
          switch (format) {
            case Format.I4: {
              const v = expand((reader.u8(block + (i >> 1)) >> (i & 1 ? 0 : 4)) & 15, 4);
              px.set([v, v, v, v]);
              break;
            }
            case Format.I8: {
              const v = reader.u8(block + i);
              px.set([v, v, v, v]);
              break;
            }
            case Format.IA4: {
              const v = reader.u8(block + i);
              const intensity = expand(v & 15, 4);
              px.set([intensity, intensity, intensity, expand(v >> 4, 4)]);
              break;
            }
            case Format.IA8: {
              const v = reader.u16(block + i * 2);
              px.set([v & 255, v & 255, v & 255, v >> 8]);
              break;
            }
            case Format.RGB565:
              rgb565(reader.u16(block + i * 2), px, 0);
              break;
            case Format.RGB5A3:
              rgb5a3(reader.u16(block + i * 2), px, 0);
              break;
            case Format.RGBA8:
              px.set([
                reader.u8(block + i * 2 + 1), reader.u8(block + 32 + i * 2),
                reader.u8(block + 33 + i * 2), reader.u8(block + i * 2),
              ]);
              break;
            case Format.CI4:
            case Format.CI8:
            case Format.CI14: {
              const index = format === Format.CI4
                ? (reader.u8(block + (i >> 1)) >> (i & 1 ? 0 : 4)) & 15
                : format === Format.CI8 ? reader.u8(block + i) : reader.u16(block + i * 2) & 0x3fff;
              px.set(palette!.subarray(index * 4, index * 4 + 4));
              break;
            }
            case Format.CMPR: {
              // An 8x8 CMPR block is four 4x4 DXT1-style sub-blocks in Z order.
              const sub = block + ((y >> 2) * 2 + (x >> 2)) * 8;
              const c0 = reader.u16(sub);
              const c1 = reader.u16(sub + 2);
              rgb565(c0, cmpr, 0);
              rgb565(c1, cmpr, 4);
              for (let c = 0; c < 3; c++) {
                if (c0 > c1) {
                  cmpr[8 + c] = (5 * cmpr[c] + 3 * cmpr[4 + c]) >> 3;
                  cmpr[12 + c] = (3 * cmpr[c] + 5 * cmpr[4 + c]) >> 3;
                } else {
                  cmpr[8 + c] = (cmpr[c] + cmpr[4 + c]) >> 1;
                  cmpr[12 + c] = cmpr[8 + c];
                }
              }
              cmpr[11] = 255;
              cmpr[15] = c0 > c1 ? 255 : 0;
              const code = (reader.u8(sub + 4 + (y & 3)) >> (6 - 2 * (x & 3))) & 3;
              px.set(cmpr.subarray(code * 4, code * 4 + 4));
              break;
            }
          }
          if (bx + x < width && by + y < height) out.set(px, ((by + y) * width + bx + x) * 4);
        }
      }
      block += blockSize;
    }
  }
  return out;
}

export function parseTPL(bytes: Uint8Array): Texture[] {
  const reader = new Reader(bytes);
  if (reader.u32(0) !== 0x0020af30) throw new Error('Not a TPL file');
  const count = reader.u32(4);
  const table = reader.u32(8);
  const textures: Texture[] = [];
  for (let i = 0; i < count; i++) {
    const header = reader.u32(table + i * 8);
    const paletteHeader = reader.u32(table + i * 8 + 4);
    const height = reader.u16(header);
    const width = reader.u16(header + 2);
    const format = reader.u32(header + 4);
    const data = reader.u32(header + 8);
    let palette: Uint8Array | null = null;
    if (paletteHeader) {
      palette = decodePalette(reader, reader.u32(paletteHeader + 8), reader.u16(paletteHeader),
        reader.u32(paletteHeader + 4));
    }
    textures.push({
      width,
      height,
      rgba: decodeImage(reader, data, width, height, format, palette),
      wrapS: reader.u32(header + 12),
      wrapT: reader.u32(header + 16),
      minFilter: reader.u32(header + 20),
      magFilter: reader.u32(header + 24),
    });
  }
  return textures;
}

/** Decodes a raw GX image (as in font glyph sheets) without a TPL header. */
export function decodeGX(bytes: Uint8Array, width: number, height: number, format: number): Uint8Array {
  return decodeImage(new Reader(bytes), 0, width, height, format, null);
}
