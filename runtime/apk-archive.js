// The APK's ZIP container (central directory, bounded entry expansion with CRC checks), apart from the loader so the page can open an archive (an App Bundle's
// base module, src/aab-bundle.js) without loading the VM. src/apk-loader.js re-exports it. Imports only the light ZIP helpers and APKError.
import { APKError } from './apk-error.js?v=fef4a080c36e';
import { BinaryReader } from './binary-reader.js?v=fef4a080c36e';
import { inflateRaw } from './inflate.js?v=fef4a080c36e';
import { crc32, inflateEntry } from './zip-entry.js?v=fef4a080c36e';

const fail = message => { throw new APKError(message); };
const utf8 = new TextDecoder('utf-8', { fatal: true });
const MAX_APK = 1024 * 1024 * 1024;
// The ZIP end record counts entries in 16 bits; this accepts every non-ZIP64 APK.
const MAX_ZIP_ENTRIES = 65535;

/** Central-directory ZIP reader. Entries are expanded on demand with explicit bounds. */
export class APKArchive {
  constructor(input) {
    const b = this.reader = new BinaryReader(input);
    if (b.length < 22 || b.length > MAX_APK) fail('Invalid APK size: expected a ZIP from 22 bytes to 1 GiB');
    let end = -1;
    for (let p = b.length - 22; p >= Math.max(0, b.length - 65557); p--)
      if (b.u32(p) === 0x06054b50 && p + 22 + b.u16(p + 20) === b.length) { end = p; break; }
    if (end < 0) fail('Invalid APK: ZIP central directory not found');
    const count = b.u16(end + 10), directorySize = b.u32(end + 12), start = b.u32(end + 16);
    if (b.u16(end + 4) || b.u16(end + 6) || b.u16(end + 8) !== count || !count || count > MAX_ZIP_ENTRIES || start + directorySize > end)
      fail('Unsupported APK ZIP layout: ZIP64, multiple volumes or excessive entries');
    this.entries = new Map(); this.centralDirectoryOffset = start;
    let p = start, filenameBytes = 0;
    for (let i = 0; i < count; i++) {
      if (b.u32(p) !== 0x02014b50) fail('Malformed APK central directory entry');
      const flags = b.u16(p + 8), method = b.u16(p + 10), crc = b.u32(p + 16), compressed = b.u32(p + 20), size = b.u32(p + 24);
      const nameSize = b.u16(p + 28), extra = b.u16(p + 30), comment = b.u16(p + 32), offset = b.u32(p + 42);
      filenameBytes += nameSize;
      if (!nameSize || nameSize > 4096 || filenameBytes > 8 * 1024 * 1024) fail('APK ZIP filenames exceed bounds');
      const name = utf8.decode(b.slice(p + 46, nameSize));
      if (this.entries.has(name)) fail(`Duplicate APK ZIP entry: ${name}`);
      if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) fail('ZIP64 APK entries are unsupported');
      this.entries.set(name, { name, flags, method, crc, compressed, size, offset });
      p += 46 + nameSize + extra + comment;
      if (p > start + directorySize || p > end) fail('Malformed APK central directory size');
    }
    if (p !== start + directorySize) fail('Malformed APK central directory length');
    this.directoryStart = start;
    // The prepared file (.apklab: the APK's entries stored decompressed under apk/) was withdrawn: it saved about 0.1 s of a load, weighed up to 2.5 times the APK and
    // gave the app a different base.apk. It is refused by name instead of failing as a damaged APK.
    if (this.entries.has('apklab.json') && !this.entries.has('AndroidManifest.xml')) fail('Prepared files (.apklab) are no longer accepted: open the original APK.');
  }
  payload(name) {
    const e = this.entries.get(name), b = this.reader;
    if (!e) fail(`APK is missing ${name}`);
    if (e.flags & 1) fail(`Encrypted APK entry is unsupported: ${name}`);
    if (![0, 8].includes(e.method)) fail(`Unsupported ZIP compression ${e.method}: ${name}`);
    if (b.u32(e.offset) !== 0x04034b50 || b.u16(e.offset + 8) !== e.method || (b.u16(e.offset + 6) & 1))
      fail(`Malformed APK local entry: ${name}`);
    const nameSize = b.u16(e.offset + 26), extra = b.u16(e.offset + 28);
    if (utf8.decode(b.slice(e.offset + 30, nameSize)) !== name) fail(`APK local filename mismatch: ${name}`);
    const start = e.offset + 30 + nameSize + extra;
    if (start + e.compressed > this.directoryStart) fail(`APK entry overlaps central directory: ${name}`);
    return { entry: e, compressed: b.slice(start, e.compressed), start };
  }
  /** Where an entry's data sits in the archive file: { stored, start, length }. A stored (uncompressed) entry can be read in place, which is what a file descriptor over it needs (AssetManager.openFd). */
  entryRange(name) { const { entry, start } = this.payload(name); return { stored: entry.method === 0, start, length: entry.compressed }; }
  /** Synchronous variant for the run-time VM (Class.getResource, AssetManager.open): same bounds and CRC checks as extract(). */
  /** Bounded read for load-time inspection (profile selection): the same checks as extractSync, not counted as resource preparation. */
  inspectSync(name, limit) { return this.readEntrySync(name, limit); }
  extractSync(name, limit) { return this.readEntrySync(name, limit); }
  readEntrySync(name, limit) {
    const e = this.entries.get(name);
    if (!e) fail(`APK is missing ${name}`);
    if (!Number.isSafeInteger(limit) || limit < 0) fail('APK extraction requires a nonnegative byte limit');
    if (e.size > limit) fail(`${name} exceeds ${Math.round(limit / 1024 / 1024)} MiB limit`);
    const { compressed } = this.payload(name);
    let data;
    if (e.method === 0) data = compressed.slice();
    else { try { data = inflateRaw(compressed, e.size); } catch (error) { fail(`Unable to decompress ${name}: ${error.message}`); } }
    if (data.length !== e.size || crc32(data) !== e.crc) fail(`APK entry size/CRC mismatch: ${name}`);
    return data;
  }
  /** Starts expanding `names` (deflated entries within `limit`) in the helper Workers of `pool` (src/zip-inflate-pool.js); extract() then takes the result instead of expanding
   *  on this thread. Nothing is checked or reported here: extract() does every check, and an entry whose helper failed is expanded again by extract() itself. */
  prefetch(names, limit, pool) {
    if (!pool) return;
    this.prefetched ??= new Map();
    for (const name of names) {
      const e = this.entries.get(name);
      if (!e || e.method !== 8 || !Number.isSafeInteger(limit) || e.size > limit || this.prefetched.has(name)) continue;
      let compressed; try { ({ compressed } = this.payload(name)); } catch { continue; }   // a malformed entry fails in extract(), with its own message
      this.prefetched.set(name, { limit, job: pool.inflate({ compressed, name, size: e.size, limit }).catch(() => null) });
    }
  }
  async extract(name, limit) {
    const e = this.entries.get(name);
    if (!Number.isSafeInteger(limit) || limit < 0) fail('APK extraction requires a nonnegative byte limit');
    if (e?.size > limit) fail(`${name} exceeds ${Math.round(limit / 1024 / 1024)} MiB limit`);
    const { compressed } = this.payload(name);
    let data, crc = null;
    if (e.method === 0) data = compressed.slice();
    else {
      const ahead = this.prefetched?.get(name); if (ahead) this.prefetched.delete(name);
      const done = ahead && ahead.limit === limit ? await ahead.job : null;   // a helper's result, or null: expand here (a helper error is reproduced with this thread's message)
      if (done) { data = done.bytes; crc = done.crc; }
      else data = await inflateEntry(compressed, { name, size: e.size, limit });
    }
    if (data.length !== e.size || (crc ?? crc32(data)) !== e.crc) fail(`APK entry size/CRC mismatch: ${name}`);
    return data;
  }
  /** Header-only probe: bounded output, deliberately does not claim full-entry CRC validation. */
  async extractPrefix(name, limit = 64) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 65536) fail('APK prefix probe limit must be 0–65536 bytes');
    const { entry, compressed } = this.payload(name);
    if (entry.method === 0) return compressed.subarray(0, Math.min(limit, entry.size));
    if (typeof DecompressionStream !== 'function') fail('Header probe requires deflate-raw decompression');
    let cursor = 0;
    const stream = new ReadableStream({ pull(controller) {
      if (cursor >= compressed.length) { controller.close(); return; }
      const end = Math.min(cursor + 1024, compressed.length);
      controller.enqueue(compressed.subarray(cursor, end)); cursor = end;
    } });
    const reader = stream.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const result = new Uint8Array(Math.min(limit, entry.size));
    let length = 0;
    try {
      while (length < result.length) {
        const { value, done } = await reader.read();
        if (done) break;
        const amount = Math.min(value.length, result.length - length);
        result.set(value.subarray(0, amount), length); length += amount;
      }
    } finally { await reader.cancel(); }
    return result.subarray(0, length);
  }
}
