// Bounded little-endian reader over the bytes of a DEX file or a ZIP archive. It imports nothing but APKError, so the page can read an archive (src/apk-archive.js)
// without loading the VM.
import { APKError } from './apk-error.js?v=c2aef97d559f';

const fail = message => { throw new APKError(message); };

export class BinaryReader {
  constructor(input) {
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.length = this.bytes.length;
  }
  check(offset, size = 1) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > this.length - size)
      fail(`Malformed input: range ${offset}+${size} exceeds ${this.length}`);
  }
  u8(p) { this.check(p); return this.view.getUint8(p); }
  u16(p) { this.check(p, 2); return this.view.getUint16(p, true); }
  u32(p) { this.check(p, 4); return this.view.getUint32(p, true); }
  slice(p, n) { this.check(p, n); return this.bytes.subarray(p, p + n); }
  // The table must fit in the file; ART has no separate entry-count cap.
  table(n, p, width) { this.check(p, n * width); }
  uleb(cursor) {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const b = this.u8(cursor.p++);
      if (shift === 28 && b > 15) fail('Malformed ULEB128');
      value += (b & 127) * 2 ** shift;
      if (!(b & 128)) return value;
    }
    fail('Malformed ULEB128');
  }
  sleb(cursor) {
    let value = 0, shift = 0, byte;
    do {
      if (shift >= 35) fail('Malformed SLEB128');
      byte = this.u8(cursor.p++); value |= (byte & 127) << shift; shift += 7;
    } while (byte & 128);
    if (shift < 32 && byte & 64) value |= -1 << shift;
    return value | 0;
  }
}
