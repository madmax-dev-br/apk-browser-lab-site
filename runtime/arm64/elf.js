// ELF64 (AArch64) shared-object loader for the ARM64 native process (src/arm64/process.js): what Android's dynamic linker does for an app library.
// It maps the PT_LOAD segments at a page-aligned base, reads the dynamic section (DT_NEEDED, SONAME, symbol and string tables, init/fini arrays), and applies
// the relocations in their three encodings: plain RELA (DT_RELA, DT_JMPREL), Android's packed APS2 (DT_ANDROID_RELA) and RELR (DT_RELR / DT_ANDROID_RELR).
// Symbols are resolved by the process (other libraries first, then the lab's libc); a relocation type it does not know stops the load naming it.
import { APKError } from '../apk-error.js?v=28012a33f717';
import { utf8 } from './text.js?v=28012a33f717';

const fail = (message, details = {}) => { throw new APKError(message, { kind: 'arm64-elf', ...details }); };
const PT_LOAD = 1, PT_DYNAMIC = 2, PT_TLS = 7, PT_GNU_RELRO = 0x6474e552;
const DT = { NEEDED: 1, PLTRELSZ: 2, HASH: 4, STRTAB: 5, SYMTAB: 6, RELA: 7, RELASZ: 8, STRSZ: 10, INIT: 12, FINI: 13, SONAME: 14, JMPREL: 23, INIT_ARRAY: 25, FINI_ARRAY: 26, INIT_ARRAYSZ: 27, FINI_ARRAYSZ: 28, RELRSZ: 35, RELR: 36, GNU_HASH: 0x6ffffef5, ANDROID_RELA: 0x60000011, ANDROID_RELASZ: 0x60000012, ANDROID_RELR: 0x6fffe000, ANDROID_RELRSZ: 0x6fffe001, FLAGS_1: 0x6ffffffb };
export const R = { ABS64: 257, GLOB_DAT: 1025, JUMP_SLOT: 1026, RELATIVE: 1027, TLS_DTPMOD64: 1028, TLS_DTPREL64: 1029, TLS_TPREL64: 1030, TLSDESC: 1031, IRELATIVE: 1032, NONE: 0 };

export function parseElf(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 64 || dv.getUint32(0, false) !== 0x7f454c46) fail('Not an ELF file');
  if (bytes[4] !== 2 || bytes[5] !== 1) fail('Not a little-endian ELF64 file');
  const machine = dv.getUint16(18, true); if (machine !== 183) fail(`ELF machine ${machine} is not AArch64 (183)`, { machine });
  if (dv.getUint16(16, true) !== 3) fail('Not a shared object (ET_DYN)');
  const phoff = Number(dv.getBigUint64(32, true)), phentsize = dv.getUint16(54, true), phnum = dv.getUint16(56, true), segments = [];
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    segments.push({ type: dv.getUint32(o, true), flags: dv.getUint32(o + 4, true), offset: Number(dv.getBigUint64(o + 8, true)), vaddr: Number(dv.getBigUint64(o + 16, true)), filesz: Number(dv.getBigUint64(o + 32, true)), memsz: Number(dv.getBigUint64(o + 40, true)), align: Number(dv.getBigUint64(o + 48, true)) });
  }
  return { bytes, dv, segments };
}

function sleb128Reader(mem, start) {
  let at = start;
  return () => { let result = 0n, shift = 0n, byte; do { byte = mem.byte(at++); result |= BigInt(byte & 0x7f) << shift; shift += 7n; } while (byte & 0x80); if (byte & 0x40 && shift < 64n) result -= 1n << shift; return result; };
}

/**
 * Maps `elf` into `process.memory` and returns the library record. `resolve(name, lib)` -> address of an imported symbol (or null when absent).
 * Relocation and initialization are separate steps (relocate, then the process runs DT_INIT / DT_INIT_ARRAY once every DT_NEEDED is ready).
 */
export function mapLibrary(process, elf, name) {
  const loads = elf.segments.filter(s => s.type === PT_LOAD);
  if (!loads.length) fail(`${name}: no PT_LOAD segment`);
  if (elf.segments.some(s => s.type === PT_TLS)) process.noteTls?.(name);
  const low = Math.min(...loads.map(s => s.vaddr)) & ~0xfff, high = Math.max(...loads.map(s => s.vaddr + s.memsz));
  const base = process.mapRegion(high - low, 0x10000, null) - low, mem = process.memory;   // /proc/self/maps lists a library by its segments
  for (const s of loads) { mem.fill(base + s.vaddr, 0, s.memsz); mem.copyIn(base + s.vaddr, elf.bytes.subarray(s.offset, s.offset + s.filesz)); }
  const dynamic = elf.segments.find(s => s.type === PT_DYNAMIC); if (!dynamic) fail(`${name}: no dynamic section`);
  const dyn = new Map(), needed = [];
  for (let at = base + dynamic.vaddr; ; at += 16) {
    const tag = Number(mem.read64(at)), value = Number(mem.read64(at + 8));
    if (tag === 0) break;
    if (tag === DT.NEEDED) needed.push(value); else if (!dyn.has(tag)) dyn.set(tag, value);
  }
  const strtab = base + (dyn.get(DT.STRTAB) ?? fail(`${name}: no DT_STRTAB`)), symtab = base + (dyn.get(DT.SYMTAB) ?? fail(`${name}: no DT_SYMTAB`));
  const str = offset => utf8.decode(mem.cString(strtab + offset));
  const lib = { name, soname: dyn.has(DT.SONAME) ? str(dyn.get(DT.SONAME)) : name, base, end: base + high, needed: needed.map(str), dyn, strtab, symtab, exports: new Map(), elf };
  // the symbol count: DT_HASH's nchain, else the highest index the GNU hash chains reach
  let count = 0;
  if (dyn.has(DT.HASH)) count = mem.readU32(base + dyn.get(DT.HASH) + 4);
  else if (dyn.has(DT.GNU_HASH)) {
    const h = base + dyn.get(DT.GNU_HASH), nbuckets = mem.readU32(h), symoffset = mem.readU32(h + 4), bloomSize = mem.readU32(h + 8), buckets = h + 16 + bloomSize * 8, chains = buckets + nbuckets * 4;
    let max = 0; for (let i = 0; i < nbuckets; i++) max = Math.max(max, mem.readU32(buckets + 4 * i));
    if (max >= symoffset) { while (!(mem.readU32(chains + 4 * (max - symoffset)) & 1)) max++; }
    count = max + 1;
  }
  lib.symbolCount = count;
  lib.symbol = index => {
    const at = symtab + index * 24, nameOff = mem.readU32(at), info = mem.byte(at + 4), shndx = mem.uint16(at + 6), value = Number(mem.read64(at + 8));
    return { name: str(nameOff), bind: info >> 4, type: info & 15, defined: shndx !== 0, value: shndx === 0xfff1 ? value : base + value };
  };
  for (let i = 1; i < count; i++) { const s = lib.symbol(i); if (s.defined && s.name && (s.bind === 1 || s.bind === 2 || s.bind === 10) && !lib.exports.has(s.name)) lib.exports.set(s.name, s.value); }
  return lib;
}

export function relocate(process, lib, resolve) {
  const mem = process.memory, base = lib.base, dyn = lib.dyn, unresolved = new Set();
  const symbolAddress = index => {
    if (index === 0) return 0;
    const s = lib.symbol(index);
    if (s.defined) return s.value;
    const found = resolve(s.name, lib);
    if (found === null || found === undefined) { if (s.bind === 2) return 0; unresolved.add(s.name); return process.missingSymbol(s.name, lib); }   // a weak undefined symbol is 0, as the linker leaves it
    return found;
  };
  const apply = (offset, info, addend) => {
    const type = Number(info & 0xffffffffn), sym = Number(info >> 32n), where = base + Number(offset);
    switch (type) {
      case R.NONE: return;
      case R.RELATIVE: mem.write64(where, BigInt(base) + addend); return;
      case R.ABS64: case R.GLOB_DAT: mem.write64(where, BigInt(symbolAddress(sym)) + addend); return;
      case R.JUMP_SLOT: mem.write64(where, BigInt(symbolAddress(sym)) + addend); return;
      case R.IRELATIVE: mem.write64(where, BigInt(process.callResolver(base + Number(addend)))); return;
      case R.TLS_TPREL64: case R.TLSDESC: case R.TLS_DTPMOD64: case R.TLS_DTPREL64: return process.tlsRelocation(lib, type, where, sym === 0 ? null : lib.symbol(sym), addend);
      default: fail(`${lib.name}: relocation type ${type} is not supported`, { relocationType: type });
    }
  };
  const rela = (start, size) => { for (let at = base + start; at < base + start + size; at += 24) apply(mem.read64(at), mem.read64(at + 8), BigInt.asIntN(64, mem.read64(at + 16))); };
  if (dyn.has(DT.RELA)) rela(dyn.get(DT.RELA), dyn.get(DT.RELASZ) ?? 0);
  if (dyn.has(DT.ANDROID_RELA)) {   // APS2: sleb128 stream of grouped relocations (bionic linker_reloc_iterators.h)
    const at = base + dyn.get(DT.ANDROID_RELA);
    if (utf8.decode(mem.bytes(at, 4)) !== 'APS2') fail(`${lib.name}: DT_ANDROID_RELA without the APS2 signature`);
    const next = sleb128Reader(mem, at + 4); let count = Number(next()), offset = next(), info = 0n, addend = 0n;
    while (count > 0) {
      const groupSize = Number(next()), flags = Number(next()), byInfo = flags & 1, byOffset = flags & 2, byAddend = flags & 4, hasAddend = flags & 8;
      const offsetDelta = byOffset ? next() : 0n;
      if (byInfo) info = next();
      if (hasAddend && byAddend) addend += next(); else if (!hasAddend) addend = 0n;
      for (let i = 0; i < groupSize; i++) {
        offset += byOffset ? offsetDelta : next();
        if (!byInfo) info = next();
        if (hasAddend && !byAddend) addend += next();
        apply(BigInt.asUintN(64, offset), info, addend);
      }
      count -= groupSize;
    }
  }
  const relr = dyn.get(DT.RELR) ?? dyn.get(DT.ANDROID_RELR), relrSize = dyn.get(DT.RELRSZ) ?? dyn.get(DT.ANDROID_RELRSZ) ?? 0;
  if (relr !== undefined) {   // RELR: an address entry relocates one word, a bitmap entry the next 63 words it marks
    let where = 0;
    for (let at = base + relr; at < base + relr + relrSize; at += 8) {
      const entry = mem.read64(at);
      if (!(entry & 1n)) { where = base + Number(entry); mem.write64(where, mem.read64(where) + BigInt(base)); where += 8; }
      else { for (let i = 1n; i < 64n; i++) if ((entry >> i) & 1n) { const w = where + Number(i - 1n) * 8; mem.write64(w, mem.read64(w) + BigInt(base)); } where += 63 * 8; }
    }
  }
  if (dyn.has(DT.JMPREL)) rela(dyn.get(DT.JMPREL), dyn.get(DT.PLTRELSZ) ?? 0);
  lib.unresolved = [...unresolved];
  return lib;
}

/** The constructors to run after relocation, in order: DT_INIT, then each DT_INIT_ARRAY entry (0 and -1 entries skipped, as bionic does). */
export function initializers(process, lib) {
  const mem = process.memory, out = [];
  if (lib.dyn.has(DT.INIT)) out.push(lib.base + lib.dyn.get(DT.INIT));
  if (lib.dyn.has(DT.INIT_ARRAY)) for (let i = 0; i < (lib.dyn.get(DT.INIT_ARRAYSZ) ?? 0) / 8; i++) { const f = mem.readPtr(lib.base + lib.dyn.get(DT.INIT_ARRAY) + 8 * i); if (f !== 0 && f !== -1 && f < 2 ** 63) out.push(f); }
  return out;
}
export { PT_GNU_RELRO };
