// Synchronous raw DEFLATE (RFC 1951) decoder. The browser's DecompressionStream is asynchronous, but the DEX VM is a
// synchronous interpreter (Class.getResource, AssetManager.open, ... must return in-line), so entries read at run time
// use this canonical-Huffman implementation. Output size is bounded by the ZIP central-directory size.
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function huffman(lengths) {
  const count = new Uint16Array(16), symbols = new Uint16Array(lengths.length);
  for (const length of lengths) count[length]++;
  count[0] = 0;
  const offsets = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + count[i - 1];
  for (let symbol = 0; symbol < lengths.length; symbol++) if (lengths[symbol]) symbols[offsets[lengths[symbol]]++] = symbol;
  return { count, symbols };
}
let fixedLiteral = null, fixedDistance = null;

export function inflateRaw(input, expectedSize) {
  let position = 0, bitBuffer = 0, bitCount = 0;
  const out = new Uint8Array(expectedSize); let outPosition = 0;
  const bits = (need) => {
    while (bitCount < need) { if (position >= input.length) throw new Error('Unexpected end of deflate stream'); bitBuffer |= input[position++] << bitCount; bitCount += 8; }
    const value = bitBuffer & ((1 << need) - 1); bitBuffer >>>= need; bitCount -= need; return value;
  };
  const decode = (table) => {
    let code = 0, first = 0, index = 0;
    for (let length = 1; length < 16; length++) {
      code |= bits(1); const count = table.count[length];
      if (code - count < first) return table.symbols[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error('Invalid Huffman code');
  };
  for (let last = 0; !last;) {
    last = bits(1); const type = bits(2);
    if (type === 0) {
      bitBuffer = 0; bitCount = 0;
      if (position + 4 > input.length) throw new Error('Truncated stored block');
      const length = input[position] | input[position + 1] << 8; position += 4;
      if (position + length > input.length || outPosition + length > out.length) throw new Error('Stored block exceeds bounds');
      out.set(input.subarray(position, position + length), outPosition); position += length; outPosition += length;
    } else if (type === 1 || type === 2) {
      let literal, distance;
      if (type === 1) {
        if (!fixedLiteral) { const lengths = new Uint8Array(288); lengths.fill(8, 0, 144); lengths.fill(9, 144, 256); lengths.fill(7, 256, 280); lengths.fill(8, 280, 288); fixedLiteral = huffman(lengths); fixedDistance = huffman(new Uint8Array(30).fill(5)); }
        literal = fixedLiteral; distance = fixedDistance;
      } else {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4, lengths = new Uint8Array(320);
        for (let i = 0; i < ncode; i++) lengths[CODE_ORDER[i]] = bits(3);
        const codeTable = huffman(lengths.subarray(0, 19)); const all = new Uint8Array(nlen + ndist);
        for (let index = 0; index < nlen + ndist;) {
          const symbol = decode(codeTable);
          if (symbol < 16) all[index++] = symbol;
          else {
            let repeat, value = 0;
            if (symbol === 16) { if (!index) throw new Error('Repeat without previous length'); value = all[index - 1]; repeat = 3 + bits(2); }
            else if (symbol === 17) repeat = 3 + bits(3); else repeat = 11 + bits(7);
            if (index + repeat > nlen + ndist) throw new Error('Too many code lengths');
            while (repeat--) all[index++] = value;
          }
        }
        literal = huffman(all.subarray(0, nlen)); distance = huffman(all.subarray(nlen));
      }
      for (;;) {
        const symbol = decode(literal);
        if (symbol < 256) { if (outPosition >= out.length) throw new Error('Inflated data exceeds declared size'); out[outPosition++] = symbol; }
        else if (symbol === 256) break;
        else {
          const lengthIndex = symbol - 257; if (lengthIndex >= 29) throw new Error('Invalid length symbol');
          const length = LENGTH_BASE[lengthIndex] + bits(LENGTH_EXTRA[lengthIndex]), distSymbol = decode(distance);
          if (distSymbol >= 30) throw new Error('Invalid distance symbol');
          const dist = DIST_BASE[distSymbol] + bits(DIST_EXTRA[distSymbol]);
          if (dist > outPosition || outPosition + length > out.length) throw new Error('Invalid back-reference');
          for (let i = 0; i < length; i++, outPosition++) out[outPosition] = out[outPosition - dist];
        }
      }
    } else throw new Error('Invalid deflate block type');
  }
  if (outPosition !== expectedSize) throw new Error('Inflated size mismatch');
  return out;
}
