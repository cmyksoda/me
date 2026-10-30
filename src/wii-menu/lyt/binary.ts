/** Big-endian reader over a byte range; every Wii resource format here is big-endian. */
export class Reader {
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(offset: number): number {
    return this.view.getUint8(offset);
  }

  s8(offset: number): number {
    return this.view.getInt8(offset);
  }

  u16(offset: number): number {
    return this.view.getUint16(offset);
  }

  s16(offset: number): number {
    return this.view.getInt16(offset);
  }

  u32(offset: number): number {
    return this.view.getUint32(offset);
  }

  f32(offset: number): number {
    return this.view.getFloat32(offset);
  }

  /** Reads a NUL-terminated (or fixed-width, NUL-padded) Latin-1 string. */
  string(offset: number, maxLength = Infinity): string {
    let text = '';
    for (let i = offset; i < this.bytes.length && i - offset < maxLength; i++) {
      const code = this.bytes[i];
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text;
  }

  fourcc(offset: number): string {
    return String.fromCharCode(...this.bytes.subarray(offset, offset + 4));
  }

  slice(offset: number, length: number): Uint8Array {
    return this.bytes.subarray(offset, offset + length);
  }
}

export type RGBA = [number, number, number, number];

export function readRGBA(reader: Reader, offset: number): RGBA {
  return [reader.u8(offset), reader.u8(offset + 1), reader.u8(offset + 2), reader.u8(offset + 3)];
}

/** Walks the section list shared by RLYT, RLAN and RFNT files. */
export function* sections(reader: Reader, magic: string): Generator<[string, number, number]> {
  if (reader.fourcc(0) !== magic) throw new Error(`Expected ${magic}, found ${reader.fourcc(0)}`);
  const headerSize = reader.u16(12);
  const count = reader.u16(14);
  let offset = headerSize;
  for (let i = 0; i < count && offset + 8 <= reader.bytes.length; i++) {
    const size = reader.u32(offset + 4);
    yield [reader.fourcc(offset), offset, size];
    offset += size;
  }
}
