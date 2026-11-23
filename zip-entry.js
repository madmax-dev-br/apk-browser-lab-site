// What expands one deflated (or stored) APK ZIP entry and checks it: CRC-32 and the bounded deflate-raw expansion. Shared by APKArchive (src/apk-loader.js) and by the helper
// Workers that expand an APK's DEX files in parallel (src/zip-inflate-pool.js, src/zip-inflate-worker.js), so both run the same code. It imports nothing but APKError: a helper
// Worker loads this module and nothing of the VM.
import { APKError } from './apk-error.js?v=cbf1579510f6';

const fail = message => { throw new APKError(message); };
// CRC-32 (ZIP, reflected 0xEDB88320), slicing-by-8: eight tables, eight bytes per step (an APK's entries are checked as they are extracted; byte at a time this was
// about 45 ms of every launch in the browser Worker for a few megabytes of DEX).
const CRC_TABLES = (() => {
  const t = new Uint32Array(8 * 256);
  for (let n = 0; n < 256; n++) { let c = n; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  for (let n = 0; n < 256; n++) for (let k = 1; k < 8; k++) t[k * 256 + n] = (t[(k - 1) * 256 + n] >>> 8) ^ t[t[(k - 1) * 256 + n] & 255];
  return t;
})();
/** CRC-32 of `bytes`; `previous` continues a CRC over consecutive pieces (crc32(b, crc32(a)) is the CRC of a followed by b). */
export function crc32(bytes, previous = 0) {
  const t = CRC_TABLES, n = bytes.length; let crc = ~previous, i = 0;
  for (const end = n - (n & 7); i < end; i += 8) {
    const a = crc ^ (bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16 | bytes[i + 3] << 24);
    crc = t[1792 + (a & 255)] ^ t[1536 + ((a >>> 8) & 255)] ^ t[1280 + ((a >>> 16) & 255)] ^ t[1024 + (a >>> 24)]
      ^ t[768 + bytes[i + 4]] ^ t[512 + bytes[i + 5]] ^ t[256 + bytes[i + 6]] ^ t[bytes[i + 7]];
  }
  for (; i < n; i++) crc = t[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return ~crc >>> 0;
}
/** Runs crc32 over a scratch buffer: idle-time work toward optimized code before the first real entry (src/zip-inflate-worker.js runs it in rounds; cold, crc32 runs at about
 *  0.4 times its optimized speed). The load image's checksum (below) is warmed with it. */
export function warmCrc32(bytes = 1 << 20) { const scratch = new Uint8Array(bytes); for (let i = 0; i < 3; i++) { crc32(scratch); contentSum(scratch); } }

/** Checksum of a load image's stored bytes (src/load-image.js: storage damage, truncation): two 32-bit Fletcher lanes over little-endian words, and the length. About ten times
 *  faster than CRC-32 once optimized; fed in pieces whose lengths are multiples of 4 (the last one free). Which bytes belong to the APK is not this checksum's job: an image's
 *  entries were checked against the APK's CRC-32 when it was written, and its source hash ties it to the APK. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;   // Int32Array words, not Uint32Array: a word above 2^31 read from a Uint32Array is a double, and the loop then ran at ~1 GB/s instead of ~10
export class ContentSum {
  constructor() { this.a = 1; this.b = 0; this.length = 0; }
  update(bytes) {
    let a = this.a, b = this.b; const n = bytes.length, whole = n & ~3;
    if (whole) {
      if (LITTLE_ENDIAN && (bytes.byteOffset & 3) === 0) { const words = new Int32Array(bytes.buffer, bytes.byteOffset, whole >>> 2); for (let i = 0; i < words.length; i++) { a = (a + words[i]) | 0; b = (b + a) | 0; } }
      else { const view = new DataView(bytes.buffer, bytes.byteOffset, whole); for (let i = 0; i < whole; i += 4) { a = (a + view.getInt32(i, true)) | 0; b = (b + a) | 0; } }
    }
    if (n & 3) { let tail = 0; for (let i = whole; i < n; i++) tail |= bytes[i] << ((i - whole) * 8); a = (a + tail) | 0; b = (b + a) | 0; }
    this.a = a; this.b = b; this.length += n; return this;
  }
  hex() { return `${(this.a >>> 0).toString(16).padStart(8, '0')}${(this.b >>> 0).toString(16).padStart(8, '0')}-${this.length.toString(16)}`; }
}
export const contentSum = bytes => new ContentSum().update(bytes).hex();

/** deflate-raw expansion of `compressed` (one entry's data) with DecompressionStream, refused past the entry's declared `size` or the caller's `limit`; `name` is the entry name the
 *  messages carry. Throws APKError('Unable to decompress <name>: ...') as APKArchive always has. */
export async function inflateEntry(compressed, { name, size, limit }) {
  if (typeof DecompressionStream !== 'function') fail('This browser requires DecompressionStream with deflate-raw support');
  let decompressor;
  try { decompressor = new DecompressionStream('deflate-raw'); }
  catch { fail('This browser does not support local ZIP deflate-raw decompression; use a recent Chromium browser'); }
  const stream = new ReadableStream({ start(controller) { controller.enqueue(compressed); controller.close(); } });
  const reader = stream.pipeThrough(decompressor).getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > size || length > limit) { await reader.cancel(); fail(`ZIP expansion exceeds declared size/limit: ${name}`); }
      chunks.push(value);
    }
  } catch (error) { fail(`Unable to decompress ${name}: ${error.message ?? error}`); }
  const data = new Uint8Array(length);
  let p = 0;
  for (const chunk of chunks) { data.set(chunk, p); p += chunk.length; }
  return data;
}
