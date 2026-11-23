// Decoded-instruction cache of the ARM64 interpreter (src/arm64/cpu.js). Decoding an instruction and building its BigInt constants on every execution dominated the
// interpreter's time; here each address is decoded once into a closure `step(cpu)` that the run loop calls after it has advanced pc past the instruction. The most
// frequent forms get their own closures with the constants precomputed (ADD/SUB immediate without flags, MOVZ/MOVN/MOVK, MOV between registers, B/BL/B.cond/CBZ/CBNZ,
// LDR/STR with an unsigned offset, LDP/STP of general registers); every other instruction gets a closure that calls the full decoder with its word, which also saves
// the fetch. The semantics are the decoder's: each closure does what cpu.execute does for that word.
//
// The cache lives on the process's memory (every thread of the process shares it). A write into a 4 KiB page holding a cached instruction drops that page's entries, so
// code a library writes, decrypts or patches at run time is decoded again before it runs. The same pages carry the translation tier's regions (src/arm64/translate.js):
// dropping a page drops its translations.

import { decodeBitMasks, ror, ones } from './cpu.js?v=728b804e603a';

const M64 = (1n << 64n) - 1n, M32 = 0xffffffffn;
const bit = (word, n) => (word >>> n) & 1, field = (word, lo, width) => (word >>> lo) & ((1 << width) - 1);
const signExtend = (value, bits) => (value << (32 - bits)) >> (32 - bits);
const PAGE = 4096;

export class DecodeCache {
  // Keys are offsets from the process's base (src/arm64/memory.js): small integers, which the maps hash and compare faster than the window's large addresses.
  constructor(memory) { this.memory = memory; this.base = memory.base ?? 0; this.steps = new Map(); this.pages = new Map(); this.low = Infinity; this.high = -Infinity; }
  /** The step of the instruction at `at` (decoded now when it is not cached yet). */
  get(cpu, at) {
    const key = at - this.base;
    let step = this.steps.get(key);
    if (step === undefined) {
      const word = this.memory.fetch32(at);
      step = compile(word, at) ?? ((c) => c.execute(word, at));
      this.steps.set(key, step);
      this.track(key).push(key);
    }
    return step;
  }
  /** The page of the instruction at offset `key` holds code: its list of cached instructions (a write to it drops them, and the tier's translations of it). */
  track(key) {
    const page = Math.floor(key / PAGE); let list = this.pages.get(page);
    if (!list) { this.pages.set(page, list = []); this.memory.tier?.mark(page); }   // the translation tier's code-page map (src/arm64/translate.js): translated stores there leave first
    if (key < this.low) this.low = key; if (key + 4 > this.high) this.high = key + 4;
    return list;
  }
  /** A write of `length` bytes at `address`: drops the cached instructions of the pages it touches. */
  written(address, length) { this.writtenAt(address - this.base, length); }
  /** The same for a write at offset `address` from the process's base (what src/arm64/memory.js has at hand). */
  writtenAt(address, length) {
    if (address >= this.high || address + length <= this.low) return;
    for (let page = Math.floor(Math.max(address, this.low) / PAGE), last = Math.floor((Math.min(address + Math.max(length, 1), this.high) - 1) / PAGE); page <= last; page++) {   // only the pages that can hold code
      const list = this.pages.get(page); if (!list) continue;
      for (const at of list) this.steps.delete(at);
      this.pages.delete(page); this.memory.tier?.dropPage(page);
    }
  }
}

export function compile(word, at) {
  // ADD / SUB (immediate) without flags: Xd|SP = Xn|SP +/- imm
  if ((word & 0x1f800000) === 0x11000000 && !bit(word, 29)) {
    const sf = bit(word, 31), rd = word & 31, rn = field(word, 5, 5), imm = BigInt(field(word, 10, 12)) << (bit(word, 22) ? 12n : 0n), mask = sf ? M64 : M32;
    return bit(word, 30) ? (c) => { c.x[rd] = (c.x[rn] - imm) & mask; } : (c) => { c.x[rd] = (c.x[rn] + imm) & mask; };
  }
  // ADDS / SUBS (immediate): CMP / CMN and their flag-setting forms
  if ((word & 0x1f800000) === 0x11000000) {
    const sf = bit(word, 31), width = sf ? 64 : 32, rd = word & 31, rn = field(word, 5, 5), imm = BigInt(field(word, 10, 12)) << (bit(word, 22) ? 12n : 0n), sub = bit(word, 30), b = sub ? ~imm : imm;
    return (c) => { const result = c.addWithCarry(c.x[rn], b, sub, width, true); if (rd !== 31) c.x[rd] = result; };
  }
  // logical (immediate): AND / ORR / EOR / ANDS
  if ((word & 0x1f800000) === 0x12000000) {
    const sf = bit(word, 31), width = sf ? 64 : 32, mask = ones(width), opc = field(word, 29, 2), rd = word & 31, rn = field(word, 5, 5);
    if (!sf && bit(word, 22)) return null;
    const masks = decodeBitMasks(bit(word, 22), field(word, 10, 6), field(word, 16, 6), true, width); if (!masks) return null;
    const imm = masks.wmask, top = BigInt(width - 1);
    return (c) => {
      const a = rn === 31 ? 0n : c.x[rn] & mask, result = opc === 0 || opc === 3 ? a & imm : opc === 1 ? a | imm : a ^ imm;
      if (opc === 3) { c.n = (result >> top) === 1n; c.z = result === 0n; c.c = false; c.v = false; if (rd !== 31) c.x[rd] = result; } else c.x[rd] = result;
    };
  }
  // bitfield (immediate): SBFM / BFM / UBFM (LSL, LSR, ASR, UXTB/UXTH, SXTB/SXTH/SXTW, BFI, BFXIL ...)
  if ((word & 0x1f800000) === 0x13000000) {
    const sf = bit(word, 31), width = sf ? 64 : 32, mask = ones(width), opc = field(word, 29, 2), rd = word & 31, rn = field(word, 5, 5), immr = field(word, 16, 6), imms = field(word, 10, 6);
    if (opc === 3) return null;
    const masks = decodeBitMasks(bit(word, 22), imms, immr, false, width); if (!masks) return null;
    const { wmask, tmask } = masks, notW = ~wmask, notT = ~tmask, sign = BigInt(imms);
    return (c) => {
      const src = rn === 31 ? 0n : c.x[rn] & mask, dst = opc === 1 ? (rd === 31 ? 0n : c.x[rd] & mask) : 0n, bot = (dst & notW) | (ror(src, immr, width) & wmask);
      let result;
      if (opc === 0) { const t = ((src >> sign) & 1n) ? mask : 0n; result = ((t & notT) | (bot & tmask)) & mask; }
      else if (opc === 1) result = ((dst & notT) | (bot & tmask)) & mask;
      else result = bot & tmask;
      if (rd !== 31) c.x[rd] = result;
    };
  }
  // logical (shifted register): AND / BIC / ORR / ORN / EOR / EON / ANDS / BICS (TST)
  if ((word & 0x1f000000) === 0x0a000000) {
    const sf = bit(word, 31), width = sf ? 64 : 32, mask = ones(width), opc = field(word, 29, 2), invert = bit(word, 21), type = field(word, 22, 2), amount = field(word, 10, 6), rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5);
    if (!sf && amount > 31) return null;
    const plain = type === 0 && amount === 0, top = BigInt(width - 1);
    return (c) => {
      const raw = rm === 31 ? 0n : c.x[rm]; let b = plain ? raw & mask : c.shifted(raw, type, amount, width); if (invert) b = ~b & mask;
      const a = rn === 31 ? 0n : c.x[rn] & mask, result = opc === 0 || opc === 3 ? a & b : opc === 1 ? a | b : a ^ b;
      if (opc === 3) { c.n = (result >> top) === 1n; c.z = result === 0n; c.c = false; c.v = false; }
      if (rd !== 31) c.x[rd] = result;
    };
  }
  // ADD / SUB / ADDS / SUBS (shifted register), CMP / CMN / NEG
  if ((word & 0x1f200000) === 0x0b000000) {
    const sf = bit(word, 31), width = sf ? 64 : 32, sub = bit(word, 30), flags = !!bit(word, 29), type = field(word, 22, 2), amount = field(word, 10, 6), rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5);
    if (type === 3 || (!sf && amount > 31)) return null;
    return (c) => {
      const a = rn === 31 ? 0n : c.x[rn], b = c.shifted(rm === 31 ? 0n : c.x[rm], type, amount, width), result = c.addWithCarry(a, sub ? ~b : b, sub, width, flags);
      if (rd !== 31) c.x[rd] = result;
    };
  }
  // CSEL / CSINC / CSINV / CSNEG (CSET, CINC, CNEG ...)
  if ((word & 0x3fe00800) === 0x1a800000) {
    const sf = bit(word, 31), mask = sf ? M64 : M32, opc = (bit(word, 30) << 1) | bit(word, 10), cond = field(word, 12, 4), rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5);
    return (c) => {
      let result;
      if (c.cond(cond)) result = rn === 31 ? 0n : c.x[rn] & mask;
      else { const b = rm === 31 ? 0n : c.x[rm] & mask; result = opc === 0 ? b : opc === 1 ? (b + 1n) & mask : opc === 2 ? ~b & mask : (-b) & mask; }
      if (rd !== 31) c.x[rd] = result;
    };
  }
  // MOVN / MOVZ / MOVK
  if ((word & 0x1f800000) === 0x12800000) {
    const sf = bit(word, 31), opc = field(word, 29, 2), hw = field(word, 21, 2), rd = word & 31;
    if (opc === 1 || (!sf && hw > 1)) return null;
    const imm = BigInt(field(word, 5, 16)) << BigInt(hw * 16), mask = sf ? M64 : M32;
    if (rd === 31) return () => {};   // XZR
    if (opc === 2) return (c) => { c.x[rd] = imm; };
    if (opc === 0) { const value = ~imm & mask; return (c) => { c.x[rd] = value; }; }
    const keep = ~(0xffffn << BigInt(hw * 16)) & mask; return (c) => { c.x[rd] = (c.x[rd] & keep) | imm; };
  }
  // MOV (register): ORR Xd, XZR, Xm with no shift
  if ((word & 0x7fe0ffe0) === 0x2a0003e0) {
    const sf = bit(word, 31), rd = word & 31, rm = field(word, 16, 5); if (rd === 31) return () => {};
    if (rm === 31) return (c) => { c.x[rd] = 0n; };
    return sf ? (c) => { c.x[rd] = c.x[rm]; } : (c) => { c.x[rd] = c.x[rm] & M32; };
  }
  // B / BL
  if ((word & 0x7c000000) === 0x14000000) {
    const target = at + signExtend(word & 0x3ffffff, 26) * 4;
    if (bit(word, 31)) { const link = BigInt(at + 4); return (c) => { c.x[30] = link; c.pc = target; }; }
    return (c) => { c.pc = target; };
  }
  // B.cond
  if ((word & 0xff000010) === 0x54000000) {
    const target = at + signExtend(field(word, 5, 19), 19) * 4, cond = word & 15;
    return (c) => { if (c.cond(cond)) c.pc = target; };
  }
  // CBZ / CBNZ
  if ((word & 0x7e000000) === 0x34000000) {
    const sf = bit(word, 31), rt = word & 31, target = at + signExtend(field(word, 5, 19), 19) * 4, nonzero = !!bit(word, 24);
    if (rt === 31) return nonzero ? () => {} : (c) => { c.pc = target; };
    return sf ? (c) => { if ((c.x[rt] === 0n) !== nonzero) c.pc = target; } : (c) => { if (((c.x[rt] & M32) === 0n) !== nonzero) c.pc = target; };
  }
  // LDR / STR (immediate, unsigned offset) of a general register: byte, half, word, doubleword; loads zero-extend
  if ((word & 0x3f000000) === 0x39000000) {
    const size = field(word, 30, 2), opc = field(word, 22, 2), rn = field(word, 5, 5), rt = word & 31, bytes = 1 << size, offset = field(word, 10, 12) * bytes;
    if (opc === 1) return rt === 31 ? (c) => { c.mem.read(Number(c.x[rn]) + offset, bytes); } : (c) => { c.x[rt] = c.mem.read(Number(c.x[rn]) + offset, bytes); };
    if (opc === 0) return rt === 31 ? (c) => { c.mem.write(Number(c.x[rn]) + offset, 0n, bytes); } : (c) => { c.mem.write(Number(c.x[rn]) + offset, c.x[rt], bytes); };
    return null;   // signed loads and prefetch: the decoder
  }
  // LDP / STP of 64-bit general registers: post-index (01), signed offset (10), pre-index (11)
  if (((word & 0xfe000000) >>> 0) === 0xa8000000 && field(word, 23, 2) !== 0) {
    const mode = field(word, 23, 2), load = bit(word, 22), rt2 = field(word, 10, 5), rn = field(word, 5, 5), rt = word & 31, offset = signExtend(field(word, 15, 7), 7) * 8;
    const pre = mode === 1 ? 0 : offset, writeback = mode !== 2;
    if (load) return (c) => {
      const base = Number(c.x[rn]), address = base + pre, a = c.mem.read(address, 8), b = c.mem.read(address + 8, 8);
      if (rt !== 31) c.x[rt] = a; if (rt2 !== 31) c.x[rt2] = b; if (writeback) c.x[rn] = BigInt(base + offset);
    };
    return (c) => {
      const base = Number(c.x[rn]), address = base + pre;
      c.mem.write(address, rt === 31 ? 0n : c.x[rt], 8); c.mem.write(address + 8, rt2 === 31 ? 0n : c.x[rt2], 8); if (writeback) c.x[rn] = BigInt(base + offset);
    };
  }
  return null;
}
