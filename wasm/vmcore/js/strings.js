// java.lang.String records at the boundary (docs/WASM-CORE-PLANO.md, decision 4): the layout of vmcore/strings.h, the decoder RecordSpace's StringCache uses, and the literal
// records the linker writes. Inside the core a String is a heap record with its UTF-16 units inline; hosts keep seeing JavaScript strings. Both directions copy the code units
// (no transcoding: both sides are UTF-16) and are cached per record address, since strings are immutable (vmcore/js/record-facade.js StringCache).
export const STRING_LAYOUT = Object.freeze({ length: 8, hash: 12, units: 16 });
export const CLASS_STRING = 32;   // abi.h: the String class's flag (sized like an array, not an array)

/** String.hashCode() of a JavaScript string (the JavaScript VM's stringHash). */
export const stringHash = text => { let h = 0; for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0; return h; };

/** The text of the String record at `address` (space: anything with current u32/u16 views of the memory). */
export function stringText(space, address) {
  const length = space.u32[(address + STRING_LAYOUT.length) >>> 2], start = (address + STRING_LAYOUT.units) >>> 1, units = space.u16.subarray(start, start + length);
  if (length < 4096) return String.fromCharCode.apply(null, units);
  let text = ''; for (let i = 0; i < length; i += 4096) text += String.fromCharCode.apply(null, units.subarray(i, Math.min(length, i + 4096)));   // TextDecoder refuses views of shared memory
  return text;
}
/** Copies `text`'s code units into the record at `address` (its header and length already written by vm_string_new). */
export function writeStringUnits(space, address, text) {
  const start = (address + STRING_LAYOUT.units) >>> 1, u16 = space.u16;
  for (let i = 0; i < text.length; i++) u16[start + i] = text.charCodeAt(i);
}
/** Bytes of a literal record (strings.h StringLiteral: u32 length, u32 hash, u16 units). */
export const literalBytes = text => 8 + 2 * text.length;
/** Writes the StringLiteral of `text` at `address` (u32 views `u32`, u16 view `u16`). */
export function writeLiteral(u32, u16, address, text) {
  u32[address >>> 2] = text.length; u32[(address + 4) >>> 2] = stringHash(text) >>> 0;
  const start = (address + 8) >>> 1; for (let i = 0; i < text.length; i++) u16[start + i] = text.charCodeAt(i);
}
