/** Reads bits most-significant first, as ASH0's two Huffman streams are packed. */
class BitReader {
  private position: number;

  constructor(private readonly bytes: Uint8Array, offset: number) {
    this.position = offset * 8;
  }

  read(count: number): number {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const byte = this.bytes[this.position >> 3];
      value = (value << 1) | ((byte >> (7 - (this.position & 7))) & 1);
      this.position++;
    }
    return value;
  }
}

type HuffmanNode = number | [HuffmanNode, HuffmanNode];

function readTree(bits: BitReader, width: number): HuffmanNode {
  return bits.read(1) ? [readTree(bits, width), readTree(bits, width)] : bits.read(width);
}

function readSymbol(bits: BitReader, node: HuffmanNode): number {
  while (typeof node !== 'number') node = node[bits.read(1)];
  return node;
}

/** ASH0, the Wii Menu's archive compression: Huffman-coded LZ with separate length and distance trees. */
export function decompressASH(bytes: Uint8Array): Uint8Array {
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'ASH0') return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(4) & 0xffffff;
  const symbols = new BitReader(bytes, 12);
  const distances = new BitReader(bytes, view.getUint32(8));
  const symbolTree = readTree(symbols, 9);
  const distanceTree = readTree(distances, 11);
  const out = new Uint8Array(size);
  let length = 0;
  while (length < size) {
    const symbol = readSymbol(symbols, symbolTree);
    if (symbol < 256) {
      out[length++] = symbol;
      continue;
    }
    const distance = readSymbol(distances, distanceTree) + 1;
    for (let i = Math.min(symbol - 0xfd, size - length); i > 0; i--, length++) out[length] = out[length - distance];
  }
  return out;
}

/** Nintendo LZ77 type 0x10, used inside channel banner and icon archives. */
export function decompressLZ77(bytes: Uint8Array): Uint8Array {
  const size = bytes[1] | (bytes[2] << 8) | (bytes[3] << 16);
  const out = new Uint8Array(size);
  let length = 0;
  let position = 4;
  while (length < size) {
    const flags = bytes[position++];
    for (let bit = 0; bit < 8 && length < size; bit++) {
      if (flags & (0x80 >> bit)) {
        const run = (bytes[position] >> 4) + 3;
        const distance = (((bytes[position] & 15) << 8) | bytes[position + 1]) + 1;
        position += 2;
        for (let i = 0; i < run; i++, length++) out[length] = out[length - distance];
      } else {
        out[length++] = bytes[position++];
      }
    }
  }
  return out;
}

/** Strips a channel file's IMD5 header and LZ77 wrapper, leaving the U8 archive or raw data. */
export function unwrapChannelFile(bytes: Uint8Array): Uint8Array {
  let data = bytes;
  if (String.fromCharCode(...data.subarray(0, 4)) === 'IMD5') {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    data = data.subarray(32, 32 + view.getUint32(4));
  }
  if (String.fromCharCode(...data.subarray(0, 4)) === 'LZ77') data = decompressLZ77(data.subarray(4));
  return data;
}
