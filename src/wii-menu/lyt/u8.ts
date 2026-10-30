import { Reader } from './binary';

/** Parses a U8 archive into a map of full paths (without the leading dot) to file bytes. */
export function parseU8(bytes: Uint8Array): Map<string, Uint8Array> {
  const reader = new Reader(bytes);
  if (reader.u32(0) !== 0x55aa382d) throw new Error('Not a U8 archive');
  const root = reader.u32(4);
  const count = reader.u32(root + 8);
  const strings = root + count * 12;
  const files = new Map<string, Uint8Array>();
  const ends: number[] = [];
  const names: string[] = [];

  for (let i = 1; i < count; i++) {
    while (ends.length && ends[ends.length - 1] <= i) {
      ends.pop();
      names.pop();
    }
    const node = root + i * 12;
    const word = reader.u32(node);
    const name = reader.string(strings + (word & 0xffffff));
    const offset = reader.u32(node + 4);
    const size = reader.u32(node + 8);
    if (word >>> 24) {
      names.push(name);
      ends.push(size);
    } else {
      files.set([...names, name].join('/'), bytes.subarray(offset, offset + size));
    }
  }
  return files;
}
