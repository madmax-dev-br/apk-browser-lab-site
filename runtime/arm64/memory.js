// The flat address space of the ARM64 native process (src/arm64/): one little-endian buffer from address 0. Libraries are mapped by src/arm64/elf.js, the heap
// (malloc) and the thread stacks by src/arm64/process.js. An access outside it is a segmentation fault: it stops the run with an error naming the address and
// the instruction, as SIGSEGV would end the process.
import { APKError } from '../apk-error.js?v=fef4a080c36e';

export class Arm64Memory {
  // The address space is one resizable ArrayBuffer grown in place: the operating system backs its pages only when they are touched, so a large reservation (a runtime that
  // maps gigabytes PROT_NONE and commits pieces, as the Dart VM does) costs what is used, not what is reserved. Where an engine refuses a resizable buffer that large, the
  // address space is a plain buffer copied on growth, limited to 1 GiB.
  constructor(bytes = 64 * 1024 * 1024, { maxBytes = 16 * 1024 * 1024 * 1024 } = {}) {
    this.cpu = null;   // set by the process: names the faulting instruction
    for (const limit of [maxBytes, 4 * 1024 ** 3, 2 * 1024 ** 3]) {
      try { const buffer = new ArrayBuffer(bytes, { maxByteLength: limit }); if (buffer.resizable) { this.maxBytes = limit; this.resizable = buffer; this.u8 = new Uint8Array(buffer); this.dv = new DataView(buffer); this.size = bytes; return; } } catch { /* the next, smaller reservation */ }
    }
    this.maxBytes = 1024 ** 3; this.resize(bytes);
  }
  resize(bytes) {
    if (bytes > this.maxBytes) throw new APKError(`ARM64 native memory would exceed ${this.maxBytes / 1048576} MiB of address space`, { kind: 'arm64-out-of-memory' });
    if (this.resizable) { this.resizable.resize(bytes); this.size = bytes; return; }   // in place: u8 and dv track the length
    const next = new Uint8Array(bytes); if (this.u8) next.set(this.u8);
    this.u8 = next; this.dv = new DataView(next.buffer); this.size = bytes;
  }
  ensure(end) { if (end > this.size) { let size = this.size; while (size < end) size *= 2; this.resize(Math.min(size, Math.max(end, this.maxBytes))); } }
  fault(address, length, kind) {
    const cpu = this.activeCpu?.() ?? this.cpu, pc = !cpu || cpu.pc < 4 ? ' (in a lab function called from Java)' : cpu.pc >= 0x7f0000000000 ? ` (in ${cpu.where?.(cpu.pc) ?? 'a lab function'} called from ${cpu.where?.(Number(cpu.x[30])) ?? 'native code'})` : ` (pc ${cpu.where?.(cpu.pc - 4) ?? '0x' + (cpu.pc - 4).toString(16)}, x30 ${cpu.where?.(Number(cpu.x[30])) ?? '0x' + Number(cpu.x[30]).toString(16)})`;
    const recent = this.recentCalls?.() ?? [];
    throw new APKError(`ARM64 native code: segmentation fault, ${kind} of ${length} bytes at 0x${Number(address).toString(16)}${pc}${recent.length ? `; last lab functions called: ${recent.join(', ')}` : ''}`, { kind: 'arm64-segfault', address: Number(address) });
  }
  check(address, length, kind) { if (length !== 0 && !(address >= 4096 && address + length <= this.size)) this.fault(address, length, kind); }   // a zero-length access touches nothing (write(fd, NULL, 0) is valid)
  fetch32(address) { this.check(address, 4, 'instruction fetch'); return this.dv.getUint32(address, true); }
  read(address, bytes) {
    this.check(address, bytes, 'read');
    switch (bytes) {
      case 1: return BigInt(this.u8[address]); case 2: return BigInt(this.dv.getUint16(address, true)); case 4: return BigInt(this.dv.getUint32(address, true));
      case 8: return this.dv.getBigUint64(address, true); default: return this.dv.getBigUint64(address, true) | (this.dv.getBigUint64(address + 8, true) << 64n);
    }
  }
  write(address, value, bytes) {
    this.check(address, bytes, 'write');
    switch (bytes) {
      case 1: this.u8[address] = Number(value & 0xffn); return; case 2: this.dv.setUint16(address, Number(value & 0xffffn), true); return;
      case 4: this.dv.setUint32(address, Number(value & 0xffffffffn), true); return; case 8: this.dv.setBigUint64(address, BigInt.asUintN(64, value), true); return;
      default: this.dv.setBigUint64(address, BigInt.asUintN(64, value), true); this.dv.setBigUint64(address + 8, BigInt.asUintN(64, value >> 64n), true);
    }
  }
  read64(address) { return this.read(address, 8); } write64(address, value) { this.write(address, BigInt(value), 8); }
  readU32(address) { this.check(address, 4, 'read'); return this.dv.getUint32(address, true); } writeU32(address, value) { this.check(address, 4, 'write'); this.dv.setUint32(address, value >>> 0, true); }
  readPtr(address) { return Number(this.read(address, 8)); } writePtr(address, value) { this.write(address, BigInt(value), 8); }
  bytes(address, length) { this.check(address, length, 'read'); return this.u8.subarray(address, address + length); }
  copyIn(address, data) { this.check(address, data.length, 'write'); this.u8.set(data, address); }
  fill(address, value, length) { this.check(address, length, 'write'); this.u8.fill(value, address, address + length); }
  cString(address, limit = 1 << 20) { this.check(address, 1, 'read'); let end = address; while (this.u8[end] !== 0) { end++; if (end - address > limit || end >= this.size) this.fault(address, end - address, 'unterminated string read'); } return this.u8.subarray(address, end); }
}
