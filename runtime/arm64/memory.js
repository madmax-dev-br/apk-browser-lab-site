// The flat address space of the ARM64 native process (src/arm64/): one little-endian buffer that holds the addresses [base, base + size). The process places it at
// a fixed window of the 64-bit address space (src/unsafe-native.js ARM64_WINDOW), apart from the wasm32 libraries' memory (below 4 GiB) and the lab's other native
// ranges, as a device's mmap regions are, so a pointer either side hands to Java names one memory. Libraries are mapped by src/arm64/elf.js, the heap (malloc) and
// the thread stacks by src/arm64/process.js. An access outside it (the first page of the window included, so NULL plus a small offset) is a segmentation fault: it
// stops the run with an error naming the address and the instruction, as SIGSEGV would end the process.
// `u8` and `dv` are views of the buffer itself, indexed by address - base: code outside this file uses the methods, which take addresses.
import { APKError } from '../apk-error.js?v=e3ff4f2e305f';
import { Arm64Tier, tierSupported } from './translate.js?v=e3ff4f2e305f';

export class Arm64Memory {
  // The address space is one resizable ArrayBuffer grown in place: the operating system backs its pages only when they are touched, so a large reservation (a runtime that
  // maps gigabytes PROT_NONE and commits pieces, as the Dart VM does) costs what is used, not what is reserved. Where an engine refuses a resizable buffer that large, the
  // address space is a plain buffer copied on growth, limited to 1 GiB.
  // With the translation tier (src/arm64/translate.js, `translate` true, the default) the buffer is a WebAssembly memory64's resizable view: the same buffer, grown in
  // place, that translated code reads and writes directly. Where the engine lacks memory64 or resizable views of it, the memory is a plain resizable buffer and the
  // interpreter runs alone.
  constructor(bytes = 64 * 1024 * 1024, { maxBytes = 16 * 1024 * 1024 * 1024, base = 0, translate = true } = {}) {
    this.cpu = null;   // set by the process: names the faulting instruction
    this.base = base;   // the lowest address the buffer holds (the process's window, src/arm64/process.js; 0 for a bare memory)
    this.tier = undefined;   // the translation tier, made by the first CPU that asks (translationTier)
    this.watchLow = Infinity; this.watchHigh = -Infinity;   // the span of the watched ranges (watch)
    if (translate && bytes % 65536 === 0 && tierSupported()) {
      for (const limit of [maxBytes, 4 * 1024 ** 3, 2 * 1024 ** 3]) {
        try {
          const memory = new WebAssembly.Memory({ address: 'i64', initial: BigInt(bytes / 65536), maximum: BigInt(Math.floor(limit / 65536)) }), buffer = memory.toResizableBuffer();
          this.wasmMemory = memory; this.maxBytes = Math.floor(limit / 65536) * 65536; this.resizable = buffer; this.u8 = new Uint8Array(buffer); this.dv = new DataView(buffer); this.size = bytes; return;
        } catch { /* the next, smaller reservation */ }
      }
    }
    for (const limit of [maxBytes, 4 * 1024 ** 3, 2 * 1024 ** 3]) {
      try { const buffer = new ArrayBuffer(bytes, { maxByteLength: limit }); if (buffer.resizable) { this.maxBytes = limit; this.resizable = buffer; this.u8 = new Uint8Array(buffer); this.dv = new DataView(buffer); this.size = bytes; return; } } catch { /* the next, smaller reservation */ }
    }
    this.maxBytes = 1024 ** 3; this.resize(bytes);
  }
  resize(bytes) {
    if (bytes > this.maxBytes) throw new APKError(`ARM64 native memory would exceed ${this.maxBytes / 1048576} MiB of address space`, { kind: 'arm64-out-of-memory' });
    if (this.wasmMemory) {   // a WebAssembly memory grows by whole 64 KiB pages, with memory.grow (its resizable view follows; resizing the view past 4 GiB is not reliable in every engine)
      bytes = Math.ceil(bytes / 65536) * 65536;
      if (bytes > this.resizable.byteLength) this.wasmMemory.grow(BigInt((bytes - this.resizable.byteLength) / 65536));
      if (this.resizable.byteLength !== bytes) throw new APKError(`ARM64 native memory could not grow to ${bytes / 1048576} MiB`, { kind: 'arm64-out-of-memory' });
      this.size = bytes; this.tier?.resized(); return;
    }
    if (this.resizable) { this.resizable.resize(bytes); this.size = bytes; return; }   // in place: u8 and dv track the length
    const next = new Uint8Array(bytes); if (this.u8) next.set(this.u8);
    this.u8 = next; this.dv = new DataView(next.buffer); this.size = bytes;
  }
  get buffer() { return this.u8.buffer; }   // the live buffer (offset = address - base)
  /** The translation tier of this memory (src/arm64/translate.js), made once; null when the memory or the engine cannot run it. */
  translationTier() { if (this.tier === undefined) this.tier = Arm64Tier.create(this); return this.tier; }
  /** `length` bytes at `address` may hold code that changed by other means than a write (mprotect, munmap): their decoded and translated instructions go. */
  invalidateCode(address, length) { this.decodeCache?.writtenAt(address - this.base, length); }
  /** The buffer covers the addresses up to `end` (an address, not a length). */
  ensure(end) { end -= this.base; if (end > this.size) { let size = this.size; while (size < end) size *= 2; this.resize(Math.min(size, Math.max(end, this.maxBytes))); } }
  fault(address, length, kind) {
    const cpu = this.activeCpu?.() ?? this.cpu, pc = !cpu || cpu.pc < 4 ? ' (in a lab function called from Java)' : cpu.pc >= 0x7f0000000000 ? ` (in ${cpu.where?.(cpu.pc) ?? 'a lab function'} called from ${cpu.where?.(Number(cpu.x[30])) ?? 'native code'})` : ` (pc ${cpu.where?.(cpu.pc - 4) ?? '0x' + (cpu.pc - 4).toString(16)}, x30 ${cpu.where?.(Number(cpu.x[30])) ?? '0x' + Number(cpu.x[30]).toString(16)})`;
    const recent = this.recentCalls?.() ?? [], explained = this.explainAddress?.(Number(address));
    throw new APKError(`ARM64 native code: segmentation fault, ${kind} of ${length} bytes at 0x${Number(address).toString(16)}${pc}${explained ? `; ${explained}` : ''}${recent.length ? `; last lab functions called: ${recent.join(', ')}` : ''}`, { kind: 'arm64-segfault', address: Number(address), ...(explained ? { cause: explained } : {}) });
  }
  /** The buffer offset of `length` bytes at `address`, or a segmentation fault. */
  check(address, length, kind) { const at = address - this.base; if (length !== 0 && !(at >= 4096 && at + length <= this.size)) this.fault(address, length, kind); return at; }   // a zero-length access touches nothing (write(fd, NULL, 0) is valid)
  /** Does the process memory hold `length` bytes at `address`? */
  contains(address, length = 1) { const at = address - this.base; return at >= 4096 && at + length <= this.size; }
  fetch32(address) { return this.dv.getUint32(this.check(address, 4, 'instruction fetch'), true); }
  read(address, bytes) {
    const at = this.check(address, bytes, 'read');
    switch (bytes) {
      case 1: return BigInt(this.u8[at]); case 2: return BigInt(this.dv.getUint16(at, true)); case 4: return BigInt(this.dv.getUint32(at, true));
      case 8: return this.dv.getBigUint64(at, true); default: return this.dv.getBigUint64(at, true) | (this.dv.getBigUint64(at + 8, true) << 64n);
    }
  }
  write(address, value, bytes) {
    const at = this.check(address, bytes, 'write'); if (this.decodeCache !== undefined) this.decodeCache.writtenAt(at, bytes);
    switch (bytes) {
      case 1: this.u8[at] = Number(value & 0xffn); break; case 2: this.dv.setUint16(at, Number(value & 0xffffn), true); break;
      case 4: this.dv.setUint32(at, Number(value & 0xffffffffn), true); break; case 8: this.dv.setBigUint64(at, BigInt.asUintN(64, value), true); break;
      default: this.dv.setBigUint64(at, BigInt.asUintN(64, value), true); this.dv.setBigUint64(at + 8, BigInt.asUintN(64, value >> 64n), true);
    }
    if (at < this.watchHigh && at + bytes > this.watchLow) this.watched(at, bytes);
  }
  read64(address) { return this.read(address, 8); } write64(address, value) { this.write(address, BigInt(value), 8); }
  readU32(address) { return this.dv.getUint32(this.check(address, 4, 'read'), true); } writeU32(address, value) { const at = this.check(address, 4, 'write'); if (this.decodeCache !== undefined) this.decodeCache.writtenAt(at, 4); this.dv.setUint32(at, value >>> 0, true); this.after(at, 4); }
  readPtr(address) { return Number(this.read(address, 8)); } writePtr(address, value) { this.write(address, BigInt(value), 8); }
  // single values for the lab's own functions (libc and the rest): typed reads and writes at an address, little-endian unless `little` is false (network byte order)
  byte(address) { return this.u8[this.check(address, 1, 'read')]; } setByte(address, value) { const at = this.check(address, 1, 'write'); this.written(address, 1); this.u8[at] = value; this.after(at, 1); }
  int16(address) { return this.dv.getInt16(this.check(address, 2, 'read'), true); } setInt16(address, value) { const at = this.check(address, 2, 'write'); this.written(address, 2); this.dv.setInt16(at, value, true); this.after(at, 2); }
  uint16(address, little = true) { return this.dv.getUint16(this.check(address, 2, 'read'), little); } setUint16(address, value, little = true) { const at = this.check(address, 2, 'write'); this.written(address, 2); this.dv.setUint16(at, value, little); this.after(at, 2); }
  int32(address) { return this.dv.getInt32(this.check(address, 4, 'read'), true); } setInt32(address, value) { const at = this.check(address, 4, 'write'); this.written(address, 4); this.dv.setInt32(at, value, true); this.after(at, 4); }
  float32(address) { return this.dv.getFloat32(this.check(address, 4, 'read'), true); } setFloat32(address, value) { const at = this.check(address, 4, 'write'); this.written(address, 4); this.dv.setFloat32(at, value, true); this.after(at, 4); }
  float64(address) { return this.dv.getFloat64(this.check(address, 8, 'read'), true); } setFloat64(address, value) { const at = this.check(address, 8, 'write'); this.written(address, 8); this.dv.setFloat64(at, value, true); this.after(at, 8); }
  written(address, length) { if (this.decodeCache !== undefined) this.decodeCache.writtenAt(address - this.base, length); }
  // Watched ranges (MAP_SHARED mappings, src/arm64/libc.js): a write into one is reported to onWrite(address, length) once it is done, so the file and the other mappings of
  // it see it at once, as one page of memory mapped twice does on a device. The translation tier's stores to watched pages leave to the interpreter, which reports them.
  watch(address, length) {
    const at = address - this.base; this.watchLow = Math.min(this.watchLow, at); this.watchHigh = Math.max(this.watchHigh, at + length);
    (this.watchedPages ??= []).push([Math.floor(at / 4096), Math.ceil((at + length) / 4096)]); this.tier?.watch(Math.floor(at / 4096), Math.ceil((at + length) / 4096));
  }
  after(at, length) { if (at < this.watchHigh && at + length > this.watchLow) this.watched(at, length); }
  watched(at, length) { this.onWrite?.(at + this.base, length); }
  /** Bytes written into a watched range on behalf of another mapping of the same file: no report back (the caller is the report). */
  mirror(address, bytes) { const at = this.check(address, bytes.length, 'write'); if (this.decodeCache !== undefined) this.decodeCache.writtenAt(at, bytes.length); this.u8.set(bytes, at); }
  bytes(address, length) { const at = this.check(address, length, 'read'); return this.u8.subarray(at, at + length); }
  copyIn(address, data) { const at = this.check(address, data.length, 'write'); if (this.decodeCache !== undefined) this.decodeCache.writtenAt(at, data.length); this.u8.set(data, at); this.after(at, data.length); }
  /**
   * Zero-fills `length` bytes at `address` (a fresh anonymous mapping over existing pages: MAP_FIXED, MADV_DONTNEED). Pages that were never written already read as zero and are
   * left untouched, so zeroing a large reserved range does not back it: only the 64 KiB chunks that hold a nonzero byte are cleared.
   */
  zero(address, length) {
    const at = this.check(address, length, 'write'); if (this.decodeCache !== undefined) this.decodeCache.writtenAt(at, length);
    const CHUNK = 65536, end = at + length;
    let i = at;
    for (; i < end && i % 8; i++) this.u8[i] = 0;
    for (; i + 8 <= end; i += CHUNK) {
      const words = Math.min(CHUNK, end - i) >>> 3, view = new BigUint64Array(this.u8.buffer, i, words);
      let dirty = false; for (let k = 0; k < words; k++) if (view[k] !== 0n) { dirty = true; break; }
      if (dirty) view.fill(0n);
      if (words * 8 < CHUNK) { i += words * 8; break; }
    }
    for (; i < end; i++) this.u8[i] = 0;
    this.after(at, length);
  }
  fill(address, value, length) { const at = this.check(address, length, 'write'); if (this.decodeCache !== undefined) this.decodeCache.writtenAt(at, length); this.u8.fill(value, at, at + length); this.after(at, length); }
  cString(address, limit = 1 << 20) { const at = this.check(address, 1, 'read'); let end = at; while (this.u8[end] !== 0) { end++; if (end - at > limit || end >= this.size) this.fault(address, end - at, 'unterminated string read'); } return this.u8.subarray(at, end); }
}
