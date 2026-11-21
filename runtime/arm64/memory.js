// The flat address space of the ARM64 native process (src/arm64/): one little-endian buffer that holds the addresses [base, base + size). The process places it at
// a fixed window of the 64-bit address space (src/unsafe-native.js ARM64_WINDOW), apart from the wasm32 libraries' memory (below 4 GiB) and the lab's other native
// ranges, as a device's mmap regions are, so a pointer either side hands to Java names one memory. Libraries are mapped by src/arm64/elf.js, the heap (malloc) and
// the thread stacks by src/arm64/process.js. An access outside it (the first page of the window included, so NULL plus a small offset) is a segmentation fault: it
// stops the run with an error naming the address and the instruction, as SIGSEGV would end the process.
// `u8` and `dv` are views of the buffer itself, indexed by address - base: code outside this file uses the methods, which take addresses.
import { APKError } from '../apk-error.js?v=af8ff7411a95';
import { Arm64Tier, tierSupported } from './translate.js?v=af8ff7411a95';

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
      case 1: this.u8[at] = Number(value & 0xffn); return; case 2: this.dv.setUint16(at, Number(value & 0xffffn), true); return;
      case 4: this.dv.setUint32(at, Number(value & 0xffffffffn), true); return; case 8: this.dv.setBigUint64(at, BigInt.asUintN(64, value), true); return;
      default: this.dv.setBigUint64(at, BigInt.asUintN(64, value), true); this.dv.setBigUint64(at + 8, BigInt.asUintN(64, value >> 64n), true);
    }
  }
  read64(address) { return this.read(address, 8); } write64(address, value) { this.write(address, BigInt(value), 8); }
  readU32(address) { return this.dv.getUint32(this.check(address, 4, 'read'), true); } writeU32(address, value) { const at = this.check(address, 4, 'write'); if (this.decodeCache !== undefined) this.decodeCache.writtenAt(at, 4); this.dv.setUint32(at, value >>> 0, true); }
  readPtr(address) { return Number(this.read(address, 8)); } writePtr(address, value) { this.write(address, BigInt(value), 8); }
  // single values for the lab's own functions (libc and the rest): typed reads and writes at an address, little-endian unless `little` is false (network byte order)
  byte(address) { return this.u8[this.check(address, 1, 'read')]; } setByte(address, value) { const at = this.check(address, 1, 'write'); this.written(address, 1); this.u8[at] = value; }
  int16(address) { return this.dv.getInt16(this.check(address, 2, 'read'), true); } setInt16(address, value) { const at = this.check(address, 2, 'write'); this.written(address, 2); this.dv.setInt16(at, value, true); }
  uint16(address, little = true) { return this.dv.getUint16(this.check(address, 2, 'read'), little); } setUint16(address, value, little = true) { const at = this.check(address, 2, 'write'); this.written(address, 2); this.dv.setUint16(at, value, little); }
  int32(address) { return this.dv.getInt32(this.check(address, 4, 'read'), true); } setInt32(address, value) { const at = this.check(address, 4, 'write'); this.written(address, 4); this.dv.setInt32(at, value, true); }
  float32(address) { return this.dv.getFloat32(this.check(address, 4, 'read'), true); } setFloat32(address, value) { const at = this.check(address, 4, 'write'); this.written(address, 4); this.dv.setFloat32(at, value, true); }
  float64(address) { return this.dv.getFloat64(this.check(address, 8, 'read'), true); } setFloat64(address, value) { const at = this.check(address, 8, 'write'); this.written(address, 8); this.dv.setFloat64(at, value, true); }
  written(address, length) { if (this.decodeCache !== undefined) this.decodeCache.writtenAt(address - this.base, length); }
  bytes(address, length) { const at = this.check(address, length, 'read'); return this.u8.subarray(at, at + length); }
  copyIn(address, data) { const at = this.check(address, data.length, 'write'); if (this.decodeCache !== undefined) this.decodeCache.writtenAt(at, data.length); this.u8.set(data, at); }
  fill(address, value, length) { const at = this.check(address, length, 'write'); if (this.decodeCache !== undefined) this.decodeCache.writtenAt(at, length); this.u8.fill(value, at, at + length); }
  cString(address, limit = 1 << 20) { const at = this.check(address, 1, 'read'); let end = at; while (this.u8[end] !== 0) { end++; if (end - at > limit || end >= this.size) this.fault(address, end - at, 'unterminated string read'); } return this.u8.subarray(at, end); }
}
