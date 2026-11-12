import { APKError } from './apk-error.js?v=6152edcf6e9b';

// Java primitive arrays live in the VM heap as typed arrays: the storage of a byte[] of n elements is n bytes, not n boxed JavaScript numbers.
//
//   [Z [B  -> ByteCells  (Int8Array; a boolean is 0/1, a byte is sign-extended on read as aget-byte does)
//   [C     -> CharCells  (Uint16Array)
//   [S     -> ShortCells (Int16Array)
//   [I [F  -> IntCells   (Int32Array; a float register carries its IEEE-754 bit pattern as an int, so float[] stores the same 32 bits)
//   [J [D  -> LongCells  (BigInt64Array; long and double registers are BigInts, double = its IEEE-754 bits)
//   [L.. [[.. -> a plain JavaScript Array of references (null or { ref })
//
// Semantics are those of Dalvik: a store narrows to the element width (aput into byte[] keeps the low 8 bits, sign-extended on read; char[] is unsigned 16-bit;
// int[] is 32-bit two's complement), the default value is 0, the length is fixed.
//
// Compatibility: host code that reads a Java array as a plain JavaScript array keeps working: indexing, .length, for...of, slice/subarray (same kind), fill, indexOf,
// includes, join, forEach, some/every, reduce and sort are the typed-array methods; map, filter-to-objects, concat, flat and flatMap answer with a plain Array (they
// produce values of another kind: floats decoded from bits, strings, references); splice replaces a same-length range in place (a Java array cannot change length);
// push/pop/shift/unshift fail loudly. Assigning a plain array to record.elements converts it (see cellsFrom).
const plainMap = function (fn, thisArg) { const n = this.length, out = new Array(n); for (let i = 0; i < n; i++) out[i] = fn.call(thisArg, this[i], i, this); return out; };
const plainConcat = function (...rest) { return Array.prototype.concat.apply(Array.from(this), rest); };
const plainFlat = function (depth) { return Array.prototype.flat.call(Array.from(this), depth); };
const plainFlatMap = function (fn, thisArg) { return Array.prototype.flatMap.call(Array.from(this), fn, thisArg); };
const fixedSplice = function (start, deleteCount, ...items) {
  const n = this.length; let from = start | 0; if (from < 0) from = Math.max(0, n + from); if (from > n) from = n;
  const count = deleteCount === undefined ? n - from : Math.max(0, Math.min(deleteCount | 0, n - from));
  if (items.length !== count) throw new APKError(`A Java array has a fixed length: splice(${start}, ${deleteCount}) with ${items.length} replacement value(s) on ${n} elements`, { kind: 'java-array-fixed-length' });
  const removed = this.slice(from, from + count); for (let i = 0; i < count; i++) this[from + i] = items[i]; return removed;
};
const noGrowth = name => function () { throw new APKError(`A Java array has a fixed length: ${name} is not available on its elements`, { kind: 'java-array-fixed-length' }); };
const compat = { map: plainMap, concat: plainConcat, flat: plainFlat, flatMap: plainFlatMap, splice: fixedSplice, push: noGrowth('push'), pop: noGrowth('pop'), shift: noGrowth('shift'), unshift: noGrowth('unshift') };
const adopt = klass => { for (const [name, value] of Object.entries(compat)) Object.defineProperty(klass.prototype, name, { value, writable: true, configurable: true, enumerable: false }); return klass; };
export const ByteCells = adopt(class ByteCells extends Int8Array {});
export const CharCells = adopt(class CharCells extends Uint16Array {});
export const ShortCells = adopt(class ShortCells extends Int16Array {});
export const IntCells = adopt(class IntCells extends Int32Array {});
export const LongCells = adopt(class LongCells extends BigInt64Array {});

/** Bytes per element of a primitive array type's storage; a reference costs one JavaScript slot. */
export const ELEMENT_BYTES = { Z: 1, B: 1, C: 2, S: 2, I: 4, F: 4, J: 8, D: 8 };
/** The typed-array class that stores arrays of `type` ('[B', '[I', ...), or null for a reference array. */
export function cellsClassOf(type) {
  if (type.length !== 2 || type.charCodeAt(0) !== 91) return null;
  switch (type.charCodeAt(1)) {
    case 90: case 66: return ByteCells;      // Z B
    case 67: return CharCells;               // C
    case 83: return ShortCells;              // S
    case 73: case 70: return IntCells;       // I F
    case 74: case 68: return LongCells;      // J D
    default: return null;
  }
}
export const isPrimitiveArrayType = type => cellsClassOf(type) !== null;
/** Fresh zeroed storage for a Java array of `type` and `length`. */
export function newCells(type, length) {
  const klass = cellsClassOf(type);
  return klass === null ? new Array(length).fill(null) : new klass(length);
}
/** Storage of `type` holding `values` (a typed array of the right kind is adopted without copying; another typed array or a plain array is converted and narrowed). */
export function cellsFrom(type, values) {
  const klass = cellsClassOf(type);
  if (klass === null) return Array.isArray(values) ? values : Array.from(values);
  if (values instanceof klass) return values;
  if (ArrayBuffer.isView(values) && values.BYTES_PER_ELEMENT === klass.BYTES_PER_ELEMENT) return new klass(values.buffer, values.byteOffset, values.length);   // same width: a view over the same bytes (a Float32Array's bytes are the float bits an [F stores; a Float64Array's are the [D bits)
  if (klass === LongCells) { const n = values.length, out = new LongCells(n); for (let i = 0; i < n; i++) { const v = values[i]; out[i] = typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)) || 0); } return out; }
  if (ArrayBuffer.isView(values)) { const out = new klass(values.length); out.set(values); return out; }
  const n = values.length, out = new klass(n); for (let i = 0; i < n; i++) { const v = values[i]; out[i] = typeof v === 'number' ? v : v === true ? 1 : v === false || v == null ? 0 : Number(v); } return out;
}
/** Copies `values` into typed storage `cells` of the same length: bit-exact from a typed array of the same element width (a Uint8Array into byte[], a Float32Array into float[]),
 *  narrowed element by element otherwise (an Int32Array into byte[] keeps the low 8 bits, as a (byte) cast does; booleans become 0/1). */
export function copyCells(cells, values) {
  const n = cells.length;
  if (ArrayBuffer.isView(values)) {
    if (values.BYTES_PER_ELEMENT === cells.BYTES_PER_ELEMENT) { new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength).set(new Uint8Array(values.buffer, values.byteOffset, Math.min(values.byteLength, cells.byteLength))); return cells; }
    if (cells instanceof BigInt64Array) { for (let i = 0; i < n; i++) cells[i] = BigInt(Math.trunc(Number(values[i])) || 0); return cells; }
    cells.set(values.length > n ? values.subarray(0, n) : values); return cells;
  }
  if (cells instanceof BigInt64Array) { for (let i = 0; i < n; i++) { const v = values[i]; cells[i] = typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v)) || 0); } return cells; }
  for (let i = 0; i < n; i++) { const v = values[i]; cells[i] = typeof v === 'number' ? v : v === true ? 1 : v === false || v == null ? 0 : Number(v); }
  return cells;
}
/** The storage's byte count: exact for typed storage, 8 per reference slot. */
export const cellBytes = cells => ArrayBuffer.isView(cells) ? cells.byteLength : cells.length * 8;
/** The underlying bytes of a byte[]/boolean[]'s storage as an unsigned view, without copying (a sub-range when from/to are given). */
export function unsignedBytes(cells, from = 0, to = cells.length) {
  if (ArrayBuffer.isView(cells)) return new Uint8Array(cells.buffer, cells.byteOffset + from, to - from);
  return Uint8Array.from(cells.slice(from, to), v => v & 255);   // a view backed by a plain array (a Proxy-backed view)
}

/** A Map that cannot hold anything: the `fields` of an array record (a Java array has no instance fields; writing one is a VM bug, never silent). */
export const NO_FIELDS = new (class NoFields extends Map { set(key) { throw new APKError(`A Java array has no instance fields (storing ${String(key)})`, { kind: 'java-array-no-fields' }); } })();
Object.freeze(NO_FIELDS);
