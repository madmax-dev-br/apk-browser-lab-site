// core.wasm imports a shared memory (it is linked with --shared-memory, for a Java thread per Worker). Where every Java thread is a green thread of one Worker, the memory does not have
// to be shared, and must not be: the web platform refuses views of a SharedArrayBuffer in most of its APIs (TextDecoder, crypto.subtle, Blob, ImageData, WebGL uploads, fetch bodies), and
// hosts hand such views of Java arrays to them. This returns the module's bytes with the memory import declared unshared (the flags byte of its limits: 0x03, maximum and shared, to 0x01).
// Atomic instructions are valid on an unshared memory; memory.atomic.wait32 would trap, and is only reached when another Worker holds a lock.
const NEEDLE = [3, 0x65, 0x6e, 0x76, 6, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79];   // "env" "memory", each with its length
export function unsharedCore(source) {
  const bytes = new Uint8Array(source.byteLength); bytes.set(new Uint8Array(source instanceof ArrayBuffer ? source : source.buffer, source.byteOffset ?? 0, source.byteLength));
  let at = -1;
  for (let i = 0; i + NEEDLE.length + 2 <= bytes.length && at < 0; i++) { let j = 0; while (j < NEEDLE.length && bytes[i + j] === NEEDLE[j]) j++; if (j === NEEDLE.length) at = i; }
  if (at < 0 || bytes[at + 11] !== 2 || bytes[at + 12] !== 3) throw new Error('vmcore: the memory import of core.wasm is not where the unshared patch expects it');
  bytes[at + 12] = 1;
  if (!WebAssembly.validate(bytes)) throw new Error('vmcore: core.wasm with an unshared memory import is not valid');
  return bytes;
}
