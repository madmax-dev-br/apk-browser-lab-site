// AArch64 (A64) user-mode interpreter for the app's own arm64-v8a native libraries (src/arm64/, docs/ARM64-NATIVE.md).
//
// It executes the library's machine code instruction by instruction over a flat little-endian memory (src/arm64/memory.js); it never translates, patches or skips
// code. General registers are BigInt (X0..X30, SP), the 32 vector registers are 16 bytes each, NZCV are booleans. An address at or above HOST_BASE is a host
// entry (a libc or JNI function the lab provides, src/arm64/libc.js, src/arm64/jni.js): branching there calls the JavaScript body with the AAPCS64 argument
// registers and returns to X30. An encoding this interpreter does not implement stops the run with an Arm64Unsupported error naming the encoding: nothing is
// emulated by approximation.
import { APKError } from '../apk-error.js?v=8a2b0d58d249';
import { executeNeon } from './neon.js?v=8a2b0d58d249';

export const M64 = (1n << 64n) - 1n, M32 = 0xffffffffn;
export const HOST_BASE = 0x7f0000000000;   // host entries: HOST_BASE + 16 * index (never mapped memory)
export const RETURN_SENTINEL = 0x7effffff0000;
export const BLOCKED = Symbol('arm64-blocked');   // a host function's answer when the calling native thread must wait (src/arm64/threads.js)   // X30 of a call made from JavaScript: reaching it ends Arm64Cpu.call

export class Arm64Unsupported extends APKError {
  constructor(message, details = {}) { super(message, { kind: 'arm64-unsupported', ...details }); }
}

const sx = (value, bits) => BigInt.asIntN(bits, value);
const ux = (value, bits) => BigInt.asUintN(bits, value);
const bit = (word, n) => (word >>> n) & 1;
const field = (word, lo, width) => (word >>> lo) & ((1 << width) - 1);
const signExtendInt = (value, bits) => (value << (32 - bits)) >> (32 - bits);
const hex = n => '0x' + (n >>> 0).toString(16).padStart(8, '0');

function ones(n) { return (1n << BigInt(n)) - 1n; }
function ror(value, shift, width) { const w = BigInt(width), s = BigInt(shift % width); if (s === 0n) return value; return ((value >> s) | (value << (w - s))) & ones(width); }
function replicate(value, esize, width) { let out = 0n; for (let i = 0; i < width; i += esize) out |= value << BigInt(i); return out & ones(width); }
/** DecodeBitMasks (Arm ARM): the wmask and tmask of a logical immediate / bitfield instruction. */
function decodeBitMasks(n, imms, immr, immediate, width) {
  const combined = (n << 6) | (~imms & 0x3f), len = 31 - Math.clz32(combined);
  if (len < 1) return null;
  const levels = (1 << len) - 1;
  if (immediate && (imms & levels) === levels) return null;
  const s = imms & levels, r = immr & levels, diff = (s - r) & levels, esize = 1 << len;
  const welem = ones(s + 1), telem = ones(diff + 1);
  return { wmask: replicate(ror(welem, r, esize), esize, width), tmask: replicate(telem, esize, width) };
}

export class Arm64Cpu {
  constructor(memory, { host = () => { throw new Error('no host'); }, maxSteps = 2e9 } = {}) {
    this.mem = memory; this.host = host; this.maxSteps = maxSteps;
    this.x = new Array(32).fill(0n);   // x[31] is SP
    this.vbuf = new Uint8Array(32 * 16); this.vview = new DataView(this.vbuf.buffer);
    this.n = false; this.z = false; this.c = false; this.v = false;
    this.pc = 0; this.tpidr = 0n; this.fpcr = 0n; this.fpsr = 0n; this.steps = 0; this.exclusive = null;
  }
  // ---- registers
  r(n) { return n === 31 ? 0n : this.x[n]; }                  // Xn / XZR
  rsp(n) { return this.x[n]; }                                  // Xn / SP
  w(n, value) { if (n !== 31) this.x[n] = value & M64; }
  wsp(n, value) { this.x[n] = value & M64; }
  r32(n) { return this.r(n) & M32; }
  setWide(n, value, wide) { this.w(n, wide ? value : value & M32); }
  get sp() { return this.x[31]; } set sp(v) { this.x[31] = BigInt(v) & M64; }
  // vector registers: little-endian bytes, Vn[0] is the low element
  vReadBig(n, bytes) { const o = n * 16; return bytes === 8 ? this.vview.getBigUint64(o, true) : bytes === 4 ? BigInt(this.vview.getUint32(o, true)) : bytes === 2 ? BigInt(this.vview.getUint16(o, true)) : bytes === 1 ? BigInt(this.vbuf[o]) : this.vview.getBigUint64(o, true) | (this.vview.getBigUint64(o + 8, true) << 64n); }
  vWriteBig(n, value, bytes) { const o = n * 16; this.vbuf.fill(0, o, o + 16); if (bytes === 16) { this.vview.setBigUint64(o, value & M64, true); this.vview.setBigUint64(o + 8, (value >> 64n) & M64, true); } else if (bytes === 8) this.vview.setBigUint64(o, value & M64, true); else if (bytes === 4) this.vview.setUint32(o, Number(value & M32), true); else if (bytes === 2) this.vview.setUint16(o, Number(value & 0xffffn), true); else this.vbuf[o] = Number(value & 0xffn); }
  getD(n) { return this.vview.getFloat64(n * 16, true); } setD(n, value) { const o = n * 16; this.vbuf.fill(0, o, o + 16); this.vview.setFloat64(o, value, true); }
  getS(n) { return this.vview.getFloat32(n * 16, true); } setS(n, value) { const o = n * 16; this.vbuf.fill(0, o, o + 16); this.vview.setFloat32(o, value, true); }
  // ---- flags
  nzcv() { return (this.n ? 8 : 0) | (this.z ? 4 : 0) | (this.c ? 2 : 0) | (this.v ? 1 : 0); }
  setNzcv(f) { this.n = !!(f & 8); this.z = !!(f & 4); this.c = !!(f & 2); this.v = !!(f & 1); }
  cond(code) {
    let result;
    switch (code >> 1) {
      case 0: result = this.z; break; case 1: result = this.c; break; case 2: result = this.n; break; case 3: result = this.v; break;
      case 4: result = this.c && !this.z; break; case 5: result = this.n === this.v; break; case 6: result = this.n === this.v && !this.z; break; default: result = true;
    }
    return (code & 1) && code !== 15 ? !result : result;
  }
  addWithCarry(a, b, carry, width, setFlags) {
    const mask = ones(width), ua = a & mask, ub = b & mask, unsigned = ua + ub + BigInt(carry), result = unsigned & mask;
    if (setFlags) { const signed = sx(ua, width) + sx(ub, width) + BigInt(carry); this.n = (result >> BigInt(width - 1)) === 1n; this.z = result === 0n; this.c = unsigned !== result; this.v = sx(result, width) !== signed; }
    return result;
  }

  // ---- running
  /** Calls the function at `address` with integer arguments in X0..X7 (and doubles in D0..D7 when `floats` gives them) and returns X0 (and D0/S0 on request). */
  call(address, args = [], { floats = [], returns = 'x' } = {}) {
    const saved = { lr: this.x[30], pc: this.pc, sp: this.sp };   // sp too: stack-passed arguments lower it, and the interrupted caller's frame must be where it left it
    for (let i = 0; i < 8; i++) if (i < args.length) this.x[i] = BigInt.asUintN(64, BigInt(args[i]));
    floats.forEach((value, i) => { if (value.kind === 'float') this.setS(i, value.value); else this.setD(i, value.value ?? value); });
    if (args.length > 8) { const extra = args.slice(8); let sp = Number(this.sp) - 8 * extra.length; sp -= sp % 16; this.sp = sp; extra.forEach((value, i) => this.mem.write64(sp + 8 * i, BigInt.asUintN(64, BigInt(value)))); }
    this.x[30] = BigInt(RETURN_SENTINEL); this.pc = Number(address);
    this.nested = (this.nested ?? 0) + 1;   // inside a call made from JavaScript a wait cannot suspend the thread: the waiting host function runs the other threads itself
    let outcome; try { outcome = this.run(RETURN_SENTINEL); } finally { this.nested--; }
    if (outcome !== 'done') throw new APKError(`ARM64 interpreter: a native call ended as '${outcome}' (pc 0x${this.pc.toString(16)})`, { kind: 'arm64-threads' });
    const result = returns === 'd' ? this.getD(0) : returns === 's' ? this.getS(0) : this.x[0];
    this.x[30] = saved.lr; this.pc = saved.pc; this.sp = saved.sp;
    return result;
  }
  /** Runs until `stopAt` ('done'), or `budget` instructions ('yield'), or a host function that must wait for another thread ('blocked': pc stays on that call to retry it). */
  run(stopAt, budget = Infinity) {
    const mem = this.mem; let left = budget;
    while (this.pc !== stopAt) {
      if (this.pc >= HOST_BASE) { const returnTo = Number(this.x[30]); if (this.host(this, (this.pc - HOST_BASE) / 16) === BLOCKED) return 'blocked'; if (this.exited) return 'exited'; if (this.jumpTo !== undefined) { this.pc = this.jumpTo; this.jumpTo = undefined; } else this.pc = returnTo; continue; }   // jumpTo: longjmp's target
      if (--left < 0) return 'yield';
      if (++this.steps > this.maxSteps) throw new APKError(`ARM64 interpreter: instruction budget (${this.maxSteps}) exceeded at pc 0x${this.pc.toString(16)}`, { kind: 'arm64-budget' });
      const word = mem.fetch32(this.pc), at = this.pc;
      this.pc += 4;
      this.execute(word, at);
      if (this.svcBlocked) { this.svcBlocked = false; return 'blocked'; }
    }
    return 'done';
  }
  /** `address` as library+offset when the process can name it (Arm64Cpu.describe is set by src/arm64/process.js). */
  where(address) { return this.describe?.(address) ?? `0x${address.toString(16)}`; }
  unsupported(word, at, what) { const from = this.lastIndirect; throw new Arm64Unsupported(`ARM64 interpreter: ${what} (instruction ${hex(word)} at ${this.where(at)}) is not implemented${from !== undefined ? `; the last indirect branch was at ${this.where(from)} (x30 ${this.where(Number(this.x[30]))})` : ''}`, { word, pc: at, lastIndirect: from }); }

  execute(word, at) {
    const op0 = field(word, 25, 4);
    if ((op0 & 0b1110) === 0b1000) return this.dataImmediate(word, at);
    if ((op0 & 0b1110) === 0b1010) return this.branchSystem(word, at);
    if ((op0 & 0b0101) === 0b0100) return this.loadStore(word, at);
    if ((op0 & 0b0111) === 0b0101) return this.dataRegister(word, at);
    if ((op0 & 0b0111) === 0b0111) return this.simdFp(word, at);
    return this.unsupported(word, at, 'an unallocated or reserved encoding');
  }

  // ---- data processing, immediate
  dataImmediate(word, at) {
    const op = field(word, 23, 3), sf = bit(word, 31), width = sf ? 64 : 32, rd = word & 31, rn = field(word, 5, 5);
    switch (op) {
      case 0b000: case 0b001: {   // ADR / ADRP
        const immlo = field(word, 29, 2), immhi = signExtendInt(field(word, 5, 19), 19), imm = BigInt((immhi * 4) + immlo);
        if (bit(word, 31)) this.w(rd, (BigInt(at) & ~0xfffn) + (imm << 12n)); else this.w(rd, BigInt(at) + imm);
        return;
      }
      case 0b010: {   // ADD/SUB immediate
        const isSub = bit(word, 30), setFlags = bit(word, 29), shift = bit(word, 22), imm = BigInt(field(word, 10, 12)) << (shift ? 12n : 0n);
        const a = this.rsp(rn), b = isSub ? ~imm : imm, result = this.addWithCarry(a, b, isSub ? 1 : 0, width, setFlags);
        if (setFlags) this.w(rd, result); else this.wsp(rd, result);
        return;
      }
      case 0b100: {   // logical immediate
        const opc = field(word, 29, 2), masks = decodeBitMasks(bit(word, 22), field(word, 10, 6), field(word, 16, 6), true, width);
        if (!masks || (!sf && bit(word, 22))) return this.unsupported(word, at, 'a reserved logical immediate');
        const a = this.r(rn) & ones(width), imm = masks.wmask;
        let result = opc === 0 || opc === 3 ? a & imm : opc === 1 ? a | imm : a ^ imm;
        if (opc === 3) { this.n = (result >> BigInt(width - 1)) === 1n; this.z = result === 0n; this.c = false; this.v = false; this.w(rd, result); }
        else this.wsp(rd, result);
        return;
      }
      case 0b101: {   // move wide
        const opc = field(word, 29, 2), hw = field(word, 21, 2), imm = BigInt(field(word, 5, 16)) << BigInt(hw * 16);
        if (opc === 0) this.w(rd, ~imm & ones(width));
        else if (opc === 2) this.w(rd, imm);
        else if (opc === 3) { const mask = 0xffffn << BigInt(hw * 16); this.w(rd, ((this.r(rd) & ~mask) | imm) & ones(width)); }
        else return this.unsupported(word, at, 'a reserved move-wide encoding');
        return;
      }
      case 0b110: {   // bitfield: SBFM / BFM / UBFM
        const opc = field(word, 29, 2), immr = field(word, 16, 6), imms = field(word, 10, 6), masks = decodeBitMasks(bit(word, 22), imms, immr, false, width);
        if (!masks) return this.unsupported(word, at, 'a reserved bitfield encoding');
        const src = this.r(rn) & ones(width), dst = opc === 1 ? this.r(rd) & ones(width) : 0n, rotated = ror(src, immr, width);
        let bot = (dst & ~masks.wmask) | (rotated & masks.wmask);
        if (opc === 0) { const top = ((src >> BigInt(imms)) & 1n) ? ones(width) : 0n; this.w(rd, ((top & ~masks.tmask) | (bot & masks.tmask)) & ones(width)); }
        else if (opc === 1) this.w(rd, ((dst & ~masks.tmask) | (bot & masks.tmask)) & ones(width));
        else if (opc === 2) this.w(rd, bot & masks.tmask);
        else return this.unsupported(word, at, 'a reserved bitfield opc');
        return;
      }
      case 0b111: {   // EXTR
        const rm = field(word, 16, 5), lsb = field(word, 10, 6), hi = this.r(rn) & ones(width), lo = this.r(rm) & ones(width);
        const concat = (hi << BigInt(width)) | lo; this.w(rd, (concat >> BigInt(lsb)) & ones(width));
        return;
      }
      default: return this.unsupported(word, at, 'an add/sub-with-tags immediate');
    }
  }

  // ---- branches, exception generation, system
  branchSystem(word, at) {
    const op0 = field(word, 29, 3);
    if ((op0 & 3) === 0 && field(word, 26, 3) === 0b101) {   // B / BL
      const offset = signExtendInt(word & 0x3ffffff, 26) * 4;
      if (bit(word, 31)) this.x[30] = BigInt(at + 4);
      this.pc = at + offset; return;
    }
    if (op0 === 0b010 && !bit(word, 25)) {   // B.cond
      const offset = signExtendInt(field(word, 5, 19), 19) * 4; if (this.cond(word & 15)) this.pc = at + offset; return;
    }
    if ((op0 & 3) === 1 && !bit(word, 25)) {   // CBZ / CBNZ
      const sf = bit(word, 31), rt = word & 31, value = sf ? this.r(rt) : this.r32(rt), offset = signExtendInt(field(word, 5, 19), 19) * 4;
      if ((value === 0n) !== !!bit(word, 24)) this.pc = at + offset; return;
    }
    if ((op0 & 3) === 1 && bit(word, 25)) {   // TBZ / TBNZ
      const b = (bit(word, 31) << 5) | field(word, 19, 5), rt = word & 31, offset = signExtendInt(field(word, 5, 14), 14) * 4;
      if ((((this.r(rt) >> BigInt(b)) & 1n) === 1n) === !!bit(word, 24)) this.pc = at + offset; return;
    }
    if (op0 === 0b110 && field(word, 25, 4) === 0b1011) {   // unconditional branch (register): BR / BLR / RET and their PAC forms
      const opc = field(word, 21, 4), op2 = field(word, 16, 5), op3 = field(word, 10, 6), rn = field(word, 5, 5);
      if (op2 !== 31) return this.unsupported(word, at, 'a branch-register encoding');
      const target = Number(this.r(rn)); this.lastIndirect = at;   // where the last BR / BLR / RET was: names the jump in a fault report
      if (op3 !== 0) return this.unsupported(word, at, 'a pointer-authenticated branch (BRAA/BLRAA/RETAA)');
      if (opc === 0) { this.pc = target; return; }                              // BR
      if (opc === 1) { this.x[30] = BigInt(at + 4); this.pc = target; return; } // BLR
      if (opc === 2) { this.pc = target; return; }                              // RET
      return this.unsupported(word, at, 'ERET/DRPS');
    }
    if (op0 === 0b110 && field(word, 24, 2) === 0b00) {   // exception generation
      const opc = field(word, 21, 3), ll = word & 3;
      if (opc === 0 && ll === 1) { if (this.host(this, 'svc') === BLOCKED) { this.pc = at; this.svcBlocked = true; } return; }   // a waiting system call is retried
      if (opc === 1 && ll === 0) throw new APKError(`ARM64 native code executed BRK #${field(word, 5, 16)} at 0x${at.toString(16)} (an abort or a trap in the library)`, { kind: 'arm64-brk' });
      return this.unsupported(word, at, 'an exception-generation instruction');
    }
    if (op0 === 0b110 && field(word, 22, 4) === 0b0100) return this.system(word, at);
    return this.unsupported(word, at, 'a branch/system encoding');
  }
  system(word, at) {
    const l = bit(word, 21), op0 = field(word, 19, 2), op1 = field(word, 16, 3), crn = field(word, 12, 4), crm = field(word, 8, 4), op2 = field(word, 5, 3), rt = word & 31;
    if (op0 === 0 && crn === 2 && l === 0 && rt === 31) return;   // hints: NOP, YIELD, WFE, WFI, SEV, PACIASP/AUTIASP (no PAC keys: the pointer is unchanged and the check is the identity), BTI, ...
    if (op0 === 0 && crn === 3 && l === 0) return;               // barriers: CLREX, DSB, DMB, ISB, SB (one thread of memory at a time)
    if (op0 === 0 && crn === 4 && l === 0) return this.unsupported(word, at, 'an MSR (immediate) to PSTATE');
    if (op0 >= 2) {   // MRS / MSR (register)
      const key = `${op0}.${op1}.${crn}.${crm}.${op2}`;
      if (key === '3.3.13.0.2') { if (l) this.w(rt, this.tpidr); else this.tpidr = this.r(rt); return; }   // TPIDR_EL0
      if (key === '3.3.4.2.0') { if (l) this.w(rt, BigInt(this.nzcv()) << 28n); else this.setNzcv(Number((this.r(rt) >> 28n) & 15n)); return; }   // NZCV
      if (key === '3.3.4.4.0') { if (l) this.w(rt, this.fpcr); else this.fpcr = this.r(rt); return; }      // FPCR
      if (key === '3.3.4.4.1') { if (l) this.w(rt, this.fpsr); else this.fpsr = this.r(rt); return; }      // FPSR
      if (key === '3.3.14.0.2' && l) { this.w(rt, BigInt(Math.floor(performance.now() * 19200)) & M64); return; }   // CNTVCT_EL0 at 19.2 MHz
      if (key === '3.3.14.0.0' && l) { this.w(rt, 19200000n); return; }                                           // CNTFRQ_EL0
      if (key === '3.3.0.0.7' && l) { this.w(rt, 0x0004n << 16n | 4n); return; }                                  // DCZID_EL0: DC ZVA permitted, 64-byte blocks
      if (key === '3.3.0.0.1' && l) { this.w(rt, 0x8444c004n); return; }                                         // CTR_EL0: 64-byte lines
      if (op0 === 3 && op1 === 0 && crn === 0 && l) { this.w(rt, 0n); return; }                                   // ID_* registers read from EL0 (as the kernel emulates them: no optional features)
      return this.unsupported(word, at, `system register ${key}`);
    }
    if (op0 === 1 && crn === 7 && l === 0) {   // DC / IC: ZVA zeroes a block; cache maintenance has no effect on this memory
      if (op1 === 3 && crm === 4 && op2 === 1) { const addr = Number(this.r(rt)) & ~63; this.mem.fill(addr, 0, 64); }
      return;
    }
    return this.unsupported(word, at, 'a system instruction');
  }

  // ---- data processing, register
  shifted(value, type, amount, width) {
    const mask = ones(width), v = value & mask, s = BigInt(amount);
    switch (type) { case 0: return (v << s) & mask; case 1: return v >> s; case 2: return ux(sx(v, width) >> s, width); default: return ror(v, amount, width); }
  }
  extended(value, option, shift, width) {
    const len = [8, 16, 32, 64][option & 3], signed = option & 4;
    let v = ux(value, len); if (signed) v = ux(sx(v, len), 64);
    return (v << BigInt(shift)) & ones(width);
  }
  dataRegister(word, at) {
    const sf = bit(word, 31), width = sf ? 64 : 32, rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5), op1 = bit(word, 28), op2 = field(word, 21, 4);
    if (!op1 && !(op2 & 8)) {   // logical (shifted register)
      const opc = field(word, 29, 2), n = bit(word, 21), type = field(word, 22, 2), amount = field(word, 10, 6);
      if (!sf && amount > 31) return this.unsupported(word, at, 'a 32-bit shift amount above 31');
      let b = this.shifted(this.r(rm), type, amount, width); if (n) b = ~b & ones(width);
      const a = this.r(rn) & ones(width), result = opc === 0 || opc === 3 ? a & b : opc === 1 ? a | b : a ^ b;
      if (opc === 3) { this.n = (result >> BigInt(width - 1)) === 1n; this.z = result === 0n; this.c = false; this.v = false; }
      this.w(rd, result); return;
    }
    if (!op1 && (op2 & 8)) {   // add/sub shifted or extended register
      const isSub = bit(word, 30), setFlags = bit(word, 29);
      let a, b;
      if (!bit(word, 21)) { a = this.r(rn); b = this.shifted(this.r(rm), field(word, 22, 2), field(word, 10, 6), width); }
      else { a = this.rsp(rn); b = this.extended(this.r(rm), field(word, 13, 3), field(word, 10, 3), width); }
      const result = this.addWithCarry(a, isSub ? ~b : b, isSub ? 1 : 0, width, setFlags);
      if (bit(word, 21) && !setFlags) this.wsp(rd, result); else this.w(rd, result);
      return;
    }
    const op = field(word, 21, 4);
    if (op === 0b0000) {   // ADC / ADCS / SBC / SBCS
      const isSub = bit(word, 30), setFlags = bit(word, 29), b = this.r(rm);
      this.w(rd, this.addWithCarry(this.r(rn), isSub ? ~b : b, this.c ? 1 : 0, width, setFlags)); return;
    }
    if (op === 0b0010) {   // conditional compare (register / immediate)
      const isSub = bit(word, 30), imm = bit(word, 11), b = imm ? BigInt(rm) : this.r(rm);
      if (this.cond(field(word, 12, 4))) this.addWithCarry(this.r(rn), isSub ? ~b : b, isSub ? 1 : 0, width, true); else this.setNzcv(word & 15);
      return;
    }
    if (op === 0b0100) {   // CSEL / CSINC / CSINV / CSNEG
      const opc = (bit(word, 30) << 1) | bit(word, 10);
      if (this.cond(field(word, 12, 4))) { this.w(rd, this.r(rn) & ones(width)); return; }
      let b = this.r(rm) & ones(width);
      if (opc === 1) b = (b + 1n) & ones(width); else if (opc === 2) b = ~b & ones(width); else if (opc === 3) b = (-b) & ones(width);
      this.w(rd, b); return;
    }
    if (op === 0b0110) {
      if (bit(word, 30)) {   // data processing (1 source)
        const opcode = field(word, 10, 6), v = this.r(rn) & ones(width);
        if (field(word, 16, 5) !== 0) return this.unsupported(word, at, 'a pointer-authentication instruction');
        let result;
        if (opcode === 0) { result = 0n; for (let i = 0; i < width; i++) if ((v >> BigInt(i)) & 1n) result |= 1n << BigInt(width - 1 - i); }          // RBIT
        else if (opcode === 1) result = this.reverseBytes(v, width, 16);                                                                                   // REV16
        else if (opcode === 2) result = width === 64 ? this.reverseBytes(v, 64, 32) : this.reverseBytes(v, 32, 32);                                       // REV32 / REV (32)
        else if (opcode === 3) result = this.reverseBytes(v, 64, 64);                                                                                       // REV (64)
        else if (opcode === 4) { let c = 0; for (let i = width - 1; i >= 0 && !((v >> BigInt(i)) & 1n); i--) c++; result = BigInt(c); }                 // CLZ
        else if (opcode === 5) { const top = (v >> BigInt(width - 1)) & 1n; let c = 0; for (let i = width - 2; i >= 0 && ((v >> BigInt(i)) & 1n) === top; i--) c++; result = BigInt(c); }   // CLS
        else return this.unsupported(word, at, 'a data-processing (1 source) opcode');
        this.w(rd, result); return;
      }
      const opcode = field(word, 10, 6), a = this.r(rn) & ones(width), b = this.r(rm) & ones(width);   // data processing (2 source)
      if (opcode === 2 || opcode === 3) {   // UDIV / SDIV (division by zero is 0)
        if (b === 0n) { this.w(rd, 0n); return; }
        if (opcode === 2) { this.w(rd, a / b); return; }
        const q = sx(a, width) / sx(b, width); this.w(rd, ux(q, width)); return;
      }
      if (opcode >= 8 && opcode <= 11) { const amount = Number(b % BigInt(width)); this.w(rd, this.shifted(a, opcode - 8, amount, width)); return; }   // LSLV / LSRV / ASRV / RORV
      return this.unsupported(word, at, 'a data-processing (2 source) opcode (CRC32 / PAC)');
    }
    if (op1 && (op2 & 8)) {   // data processing (3 source)
      const op31 = field(word, 21, 3), o0 = bit(word, 15), ra = field(word, 10, 5);
      if (op31 === 0) { const p = (this.r(rn) * this.r(rm)) & ones(width), acc = this.r(ra) & ones(width); this.w(rd, (o0 ? acc - p : acc + p) & ones(width)); return; }   // MADD / MSUB
      if (op31 === 1 || op31 === 5) { const signed = op31 === 1, p = signed ? sx(this.r(rn), 32) * sx(this.r(rm), 32) : ux(this.r(rn), 32) * ux(this.r(rm), 32); this.w(rd, ux(o0 ? this.r(ra) - p : this.r(ra) + p, 64)); return; }   // SMADDL/SMSUBL/UMADDL/UMSUBL
      if (op31 === 2) { this.w(rd, ux((sx(this.r(rn), 64) * sx(this.r(rm), 64)) >> 64n, 64)); return; }   // SMULH
      if (op31 === 6) { this.w(rd, ((this.r(rn) * this.r(rm)) >> 64n) & M64); return; }                  // UMULH
      return this.unsupported(word, at, 'a data-processing (3 source) opcode');
    }
    return this.unsupported(word, at, 'a data-processing (register) encoding');
  }
  reverseBytes(v, width, container) {
    let out = 0n;
    for (let c = 0; c < width; c += container) { const chunk = (v >> BigInt(c)) & ones(container); let r = 0n; for (let i = 0; i < container; i += 8) r |= ((chunk >> BigInt(i)) & 0xffn) << BigInt(container - 8 - i); out |= r << BigInt(c); }
    return out;
  }

  // ---- loads and stores
  loadStore(word, at) {
    const cls = field(word, 27, 3), v = bit(word, 26);   // bits [29:27]
    if (cls === 0b001 && !v) return this.exclusiveOrdered(word, at);                 // load/store exclusive, ordered, compare-and-swap
    if (cls === 0b011 && !bit(word, 24)) return this.literal(word, at);              // load register (literal)
    if (cls === 0b101) return this.pair(word, at);                                   // load/store pair
    if (cls === 0b111) return this.single(word, at);                                 // load/store register (all other forms)
    if (cls === 0b001 && v) { if (executeNeon(this, word, at)) return; return this.unsupported(word, at, 'an Advanced SIMD structure load/store form'); }   // LD1-4 / ST1-4 / LD1R, src/arm64/neon.js
    return this.unsupported(word, at, 'a load/store encoding (LDAPR/STLUR or memory tagging)');
  }
  load(address, bytes, signed, destWidth) {
    const value = this.mem.read(address, bytes);
    return signed ? ux(sx(value, bytes * 8), destWidth) : value;
  }
  literal(word, at) {
    const opc = field(word, 30, 2), v = bit(word, 26), rt = word & 31, address = at + signExtendInt(field(word, 5, 19), 19) * 4;
    if (v) { const bytes = [4, 8, 16][opc]; this.vWriteBig(rt, this.mem.read(address, bytes), bytes); return; }
    if (opc === 0) this.w(rt, this.mem.read(address, 4)); else if (opc === 1) this.w(rt, this.mem.read(address, 8)); else if (opc === 2) this.w(rt, ux(sx(this.mem.read(address, 4), 32), 64));
    // opc 3: PRFM (literal), no effect
  }
  pair(word, at) {
    const opc = field(word, 30, 2), v = bit(word, 26), mode = field(word, 23, 2), l = bit(word, 22), rt2 = field(word, 10, 5), rn = field(word, 5, 5), rt = word & 31;
    const bytes = v ? 4 << opc : opc === 2 ? 8 : 4, signed = !v && opc === 1, offset = signExtendInt(field(word, 15, 7), 7) * bytes;
    const base = Number(this.rsp(rn)), address = mode === 1 ? base : base + offset;
    if (l) {
      if (v) { this.vWriteBig(rt, this.mem.read(address, bytes), bytes); this.vWriteBig(rt2, this.mem.read(address + bytes, bytes), bytes); }
      else { const a = this.load(address, bytes, signed, 64), b = this.load(address + bytes, bytes, signed, 64); this.w(rt, a); this.w(rt2, b); }
    } else {
      if (v) { this.mem.write(address, this.vReadBig(rt, bytes), bytes); this.mem.write(address + bytes, this.vReadBig(rt2, bytes), bytes); }
      else { this.mem.write(address, this.r(rt), bytes); this.mem.write(address + bytes, this.r(rt2), bytes); }
    }
    if (mode === 1 || mode === 3) this.wsp(rn, BigInt(base + offset));
  }
  single(word, at) {
    const size = field(word, 30, 2), v = bit(word, 26), opc = field(word, 22, 2), rn = field(word, 5, 5), rt = word & 31;
    let address, writeback = null;
    if (bit(word, 24)) address = Number(this.rsp(rn)) + field(word, 10, 12) * (v ? (opc & 2 ? 16 : 1 << size) : 1 << size);   // unsigned immediate
    else if (bit(word, 21)) {
      const sub = field(word, 10, 2);
      if (sub === 0b10) {   // register offset
        const option = field(word, 13, 3), s = bit(word, 12), scale = v ? (opc & 2 ? 4 : size) : size;
        address = Number(BigInt.asUintN(64, this.rsp(rn) + this.extended(this.r(field(word, 16, 5)), option, s ? scale : 0, 64)));
      } else if (sub === 0b00 && !v) return this.atomic(word, at);
      else return this.unsupported(word, at, 'a load/store with pointer authentication');
    } else {
      const imm9 = signExtendInt(field(word, 12, 9), 9), mode = field(word, 10, 2), base = Number(this.rsp(rn));
      if (mode === 0 || mode === 2) address = base + imm9;            // unscaled (LDUR/STUR), unprivileged
      else if (mode === 1) { address = base; writeback = base + imm9; } // post-index
      else { address = base + imm9; writeback = address; }             // pre-index
    }
    if (v) {
      const bytes = opc & 2 ? 16 : 1 << size;
      if (opc & 1) this.vWriteBig(rt, this.mem.read(address, bytes), bytes); else this.mem.write(address, this.vReadBig(rt, bytes), bytes);
    } else {
      const bytes = 1 << size;
      if (opc === 0) this.mem.write(address, this.r(rt), bytes);
      else if (opc === 1) this.w(rt, this.mem.read(address, bytes));
      else if (size === 3 && opc === 2) { /* PRFM */ }
      else if (opc === 2) this.w(rt, this.load(address, bytes, true, 64));
      else if (opc === 3 && size < 2) this.w(rt, this.load(address, bytes, true, 32));
      else return this.unsupported(word, at, 'a reserved load/store opc');
    }
    if (writeback !== null) this.wsp(rn, BigInt(writeback));
  }
  exclusiveOrdered(word, at) {
    const size = field(word, 30, 2), o2 = bit(word, 23), l = bit(word, 22), o1 = bit(word, 21), rs = field(word, 16, 5), o0 = bit(word, 15), rt2 = field(word, 10, 5), rn = field(word, 5, 5), rt = word & 31;
    const bytes = 1 << size, address = Number(this.rsp(rn));
    if (o2 === 0 && o1 === 0) {   // LDXR / LDAXR / STXR / STLXR (one thread of memory at a time: the monitor is the address)
      if (l) { this.w(rt, this.mem.read(address, bytes)); this.exclusive = address; }
      else { const ok = this.exclusive === address; if (ok) this.mem.write(address, this.r(rt), bytes); this.w(rs, ok ? 0n : 1n); this.exclusive = null; }
      return;
    }
    if (o2 === 0 && o1 === 1) {   // LDXP / LDAXP / STXP / STLXP
      if (size < 2) return this.unsupported(word, at, 'a CASP encoding');
      if (l) { this.w(rt, this.mem.read(address, bytes)); this.w(rt2, this.mem.read(address + bytes, bytes)); this.exclusive = address; }
      else { const ok = this.exclusive === address; if (ok) { this.mem.write(address, this.r(rt), bytes); this.mem.write(address + bytes, this.r(rt2), bytes); } this.w(rs, ok ? 0n : 1n); this.exclusive = null; }
      return;
    }
    if (o2 === 1 && o1 === 0) {   // LDAR / STLR / LDLAR / STLLR
      if (l) this.w(rt, this.mem.read(address, bytes)); else this.mem.write(address, this.r(rt), bytes);
      return;
    }
    if (o2 === 1 && o1 === 1) {   // CAS / CASA / CASL / CASAL
      const expected = this.r(rs) & ones(bytes * 8), current = this.mem.read(address, bytes);
      if (current === expected) this.mem.write(address, this.r(rt), bytes);
      this.w(rs, current); void o0; return;
    }
    return this.unsupported(word, at, 'a load/store exclusive encoding');
  }
  atomic(word, at) {   // LSE atomic memory operations (LDADD, LDCLR, LDEOR, LDSET, LDSMAX, LDSMIN, LDUMAX, LDUMIN, SWP, LDAPR)
    const size = field(word, 30, 2), rs = field(word, 16, 5), o3 = bit(word, 15), opc = field(word, 12, 3), rn = field(word, 5, 5), rt = word & 31;
    const bytes = 1 << size, width = bytes * 8, address = Number(this.rsp(rn)), old = this.mem.read(address, bytes), operand = this.r(rs) & ones(width);
    if (o3) { if (opc === 0) { this.mem.write(address, operand, bytes); this.w(rt, old); return; } if (opc === 4) { this.w(rt, old); return; } return this.unsupported(word, at, 'an atomic encoding'); }
    let next;
    switch (opc) {
      case 0: next = (old + operand) & ones(width); break; case 1: next = old & ~operand; break; case 2: next = old ^ operand; break; case 3: next = old | operand; break;
      case 4: next = sx(old, width) > sx(operand, width) ? old : operand; break; case 5: next = sx(old, width) < sx(operand, width) ? old : operand; break;
      case 6: next = old > operand ? old : operand; break; default: next = old < operand ? old : operand;
    }
    this.mem.write(address, next, bytes); this.w(rt, old);
  }

  // ---- floating point and Advanced SIMD (the scalar FP set and the vector moves compilers emit for copies)
  simdFp(word, at) {
    const top = field(word, 24, 8);
    if ((top & 0b01011111) === 0b00011110 && bit(word, 21)) return this.fpScalar(word, at);
    if ((top & 0b01011111) === 0b00011111) return this.fpThreeSource(word, at);
    if ((top & 0b01011111) === 0b00011110 && !bit(word, 21)) return this.fpFixedConvert(word, at);
    return this.simdVector(word, at);
  }
  fpType(word, at) { const type = field(word, 22, 2); if (type === 0) return 's'; if (type === 1) return 'd'; return this.unsupported(word, at, 'a half-precision floating-point encoding'); }
  fget(t, n) { return t === 'd' ? this.getD(n) : this.getS(n); }
  fset(t, n, value) { if (t === 'd') this.setD(n, value); else this.setS(n, Math.fround(value)); }
  fpScalar(word, at) {
    const rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5), bits10 = field(word, 10, 2);
    if (field(word, 10, 6) === 0) return this.fpIntConvert(word, at);
    const t = this.fpType(word, at);
    if (bits10 === 0b01) {   // FCCMP / FCCMPE
      if (this.cond(field(word, 12, 4))) this.fcompare(this.fget(t, rn), this.fget(t, rm)); else this.setNzcv(word & 15); return;
    }
    if (bits10 === 0b10) {   // 2 source
      const a = this.fget(t, rn), b = this.fget(t, rm), op = field(word, 12, 4);
      const r = [a * b, a / b, a + b, a - b, Math.max(a, b), Math.min(a, b), isNaN(a) ? b : isNaN(b) ? a : Math.max(a, b), isNaN(a) ? b : isNaN(b) ? a : Math.min(a, b), -(a * b)][op];
      if (r === undefined) return this.unsupported(word, at, 'a floating-point 2-source opcode');
      this.fset(t, rd, r); return;
    }
    if (bits10 === 0b11) { this.fset(t, rd, this.fget(t, this.cond(field(word, 12, 4)) ? rn : rm)); return; }   // FCSEL
    if (field(word, 10, 3) === 0b100) {   // FMOV (immediate)
      const imm8 = field(word, 13, 8), sign = imm8 >> 7, exp = ((imm8 >> 4) & 7), frac = imm8 & 15;
      const e = (exp & 4) ? exp - 7 : exp + 1, value = (1 + frac / 16) * Math.pow(2, e - 1) * (sign ? -1 : 1);   // VFPExpandImm
      this.fset(t, rd, value); return;
    }
    if (field(word, 10, 4) === 0b1000) {   // FCMP / FCMPE
      const b = (word & 8) ? 0 : this.fget(t, rm); this.fcompare(this.fget(t, rn), b); return;
    }
    if (field(word, 10, 5) === 0b10000) {   // 1 source
      const opcode = field(word, 15, 6), a = this.fget(t, rn);
      switch (opcode) {
        case 0: this.fset(t, rd, a); return; case 1: this.fset(t, rd, Math.abs(a)); return; case 2: this.fset(t, rd, -a); return; case 3: this.fset(t, rd, Math.sqrt(a)); return;
        case 4: this.setS(rd, Math.fround(a)); return; case 5: this.setD(rd, a); return;   // FCVT to single / double
        case 8: this.fset(t, rd, roundTiesEven(a)); return; case 9: this.fset(t, rd, Math.ceil(a)); return; case 10: this.fset(t, rd, Math.floor(a)); return;
        case 11: this.fset(t, rd, Math.trunc(a)); return; case 12: this.fset(t, rd, a < 0 ? -Math.round(-a) : Math.round(a)); return; case 14: case 15: this.fset(t, rd, roundTiesEven(a)); return;
        default: return this.unsupported(word, at, 'a floating-point 1-source opcode');
      }
    }
    return this.unsupported(word, at, 'a floating-point data-processing encoding');
  }
  fcompare(a, b) { if (isNaN(a) || isNaN(b)) this.setNzcv(0b0011); else if (a === b) this.setNzcv(0b0110); else if (a < b) this.setNzcv(0b1000); else this.setNzcv(0b0010); }
  fpThreeSource(word, at) {
    const t = this.fpType(word, at), rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5), ra = field(word, 10, 5), o1 = bit(word, 21), o0 = bit(word, 15);
    const a = this.fget(t, ra), n = this.fget(t, rn), m = this.fget(t, rm), p = n * m;
    this.fset(t, rd, !o1 && !o0 ? a + p : !o1 && o0 ? a - p : o1 && !o0 ? -a - p : -a + p);
  }
  fpIntConvert(word, at) {
    const sf = bit(word, 31), type = field(word, 22, 2), rmode = field(word, 19, 2), opcode = field(word, 16, 3), rd = word & 31, rn = field(word, 5, 5), width = sf ? 64 : 32;
    if (opcode === 6 || opcode === 7) {   // FMOV between general and FP registers
      if (type === 2 && rmode === 1) { if (opcode === 7) { const o = rd * 16 + 8; this.vview.setBigUint64(o, this.r(rn), true); } else this.w(rd, this.vview.getBigUint64(rn * 16 + 8, true)); return; }   // FMOV Vd.D[1]
      const bytes = type === 1 ? 8 : type === 0 ? 4 : this.unsupported(word, at, 'an FMOV with a half-precision register');
      if (opcode === 7) this.vWriteBig(rd, this.r(rn) & ones(bytes * 8), bytes); else this.w(rd, this.vReadBig(rn, bytes));
      return;
    }
    const t = type === 1 ? 'd' : type === 0 ? 's' : this.unsupported(word, at, 'a half-precision conversion');
    if (opcode === 2 || opcode === 3) {   // SCVTF / UCVTF
      const raw = this.r(rn) & ones(width), value = opcode === 2 ? Number(sx(raw, width)) : Number(raw);
      this.fset(t, rd, value); return;
    }
    if (opcode <= 1 || opcode === 4 || opcode === 5) {   // FCVT{N,P,M,Z}{S,U} (opcode 0/1) and FCVTA{S,U} (4/5)
      const a = this.fget(t, rn), signed = opcode === 0 || opcode === 4;
      let rounded = opcode >= 4 ? (a < 0 ? -Math.round(-a) : Math.round(a)) : rmode === 0 ? roundTiesEven(a) : rmode === 1 ? Math.ceil(a) : rmode === 2 ? Math.floor(a) : Math.trunc(a);
      let result;
      if (isNaN(rounded)) result = 0n;
      else {
        const min = signed ? -(2 ** (width - 1)) : 0, max = signed ? 2 ** (width - 1) - 1 : 2 ** width - 1;
        if (rounded <= min) result = BigInt(min); else if (rounded >= max) result = signed ? (1n << BigInt(width - 1)) - 1n : ones(width); else result = BigInt(rounded);
      }
      this.w(rd, ux(result, width)); return;
    }
    return this.unsupported(word, at, 'a floating-point/integer conversion');
  }
  /** SCVTF / UCVTF (scalar, fixed-point): integer / 2^fbits; FCVTZS / FCVTZU (scalar, fixed-point): value * 2^fbits truncated toward zero and saturated. */
  fpFixedConvert(word, at) {
    const sf = bit(word, 31), type = field(word, 22, 2), rmode = field(word, 19, 2), opcode = field(word, 16, 3), fbits = 64 - field(word, 10, 6), rd = word & 31, rn = field(word, 5, 5), width = sf ? 64 : 32;
    if (!sf && fbits > 32) return this.unsupported(word, at, 'a fixed-point conversion with a reserved scale');
    const t = type === 1 ? 'd' : type === 0 ? 's' : this.unsupported(word, at, 'a half-precision fixed-point conversion');
    if (rmode === 0 && (opcode === 2 || opcode === 3)) { const raw = this.r(rn) & ones(width), value = opcode === 2 ? Number(sx(raw, width)) : Number(raw); this.fset(t, rd, value / 2 ** fbits); return; }
    if (rmode === 3 && (opcode === 0 || opcode === 1)) {
      const signed = opcode === 0, scaled = Math.trunc(this.fget(t, rn) * 2 ** fbits), min = signed ? -(2 ** (width - 1)) : 0, max = signed ? 2 ** (width - 1) - 1 : 2 ** width - 1;
      const result = isNaN(scaled) ? 0n : scaled <= min ? BigInt(min) : scaled >= max ? (signed ? (1n << BigInt(width - 1)) - 1n : ones(width)) : BigInt(scaled);
      this.w(rd, ux(result, width)); return;
    }
    return this.unsupported(word, at, 'a fixed-point conversion');
  }
  simdVector(word, at) {
    if (executeNeon(this, word, at)) return;   // src/arm64/neon.js: the Advanced SIMD groups
    const q = bit(word, 30), rd = word & 31, rn = field(word, 5, 5), bytes = q ? 16 : 8;
    // MOVI / MVNI / ORR / BIC (vector, immediate)
    if ((word & 0x9ff80400) === 0x0f000400) {
      const op = bit(word, 29), cmode = field(word, 12, 4), abc = field(word, 16, 3), defgh = field(word, 5, 5), imm8 = (abc << 5) | defgh;
      let imm64;
      const rep = (v, esize) => replicate(BigInt(v >>> 0), esize, 64);   // >>> 0: imm8 << 24 is negative as a JS int
      const shifted32 = cmode < 8, shifted16 = cmode >= 8 && cmode < 12;
      if ((shifted32 || shifted16) && (cmode & 1)) {   // ORR / BIC (vector, immediate): OR in, or clear, the shifted byte in every 32- or 16-bit lane
        const mask = shifted32 ? rep(imm8 << (8 * (cmode >> 1)), 32) : rep(imm8 << (8 * ((cmode >> 1) & 1)), 16), wide = q ? mask | (mask << 64n) : mask, old = this.vReadBig(rd, 16);
        this.vWriteBig(rd, op ? old & ~wide & ((1n << 128n) - 1n) : old | wide, bytes); return;
      }
      if (shifted32) imm64 = rep(imm8 << (8 * (cmode >> 1)), 32);
      else if (shifted16) imm64 = rep(imm8 << (8 * ((cmode >> 1) & 1)), 16);
      else if (cmode === 12) imm64 = rep((imm8 << 8) | 0xff, 32);
      else if (cmode === 13) imm64 = rep((imm8 << 16) | 0xffff, 32);
      else if (cmode === 14 && !op) imm64 = rep(imm8, 8);
      else if (cmode === 14 && op) { imm64 = 0n; for (let i = 0; i < 8; i++) if ((imm8 >> i) & 1) imm64 |= 0xffn << BigInt(8 * i); }
      else {   // cmode 15: FMOV (vector, immediate), single precision (op 0) or double (op 1, Q 1)
        const a = (imm8 >> 7) & 1, b = (imm8 >> 6) & 1, cdefgh = imm8 & 0x3f;
        if (!op) { const bits = (a << 31) | ((b ? 0b011111 : 0b100000) << 25) | (cdefgh << 19); imm64 = rep(bits >>> 0, 32); }
        else { if (!q) return this.unsupported(word, at, 'FMOV (vector, immediate) with op 1 and Q 0'); imm64 = (BigInt(a) << 63n) | (BigInt(b ? 0xff : 0x100) << 54n) | (BigInt(cdefgh) << 48n); }
        this.vWriteBig(rd, q ? imm64 | (imm64 << 64n) : imm64, bytes); return;
      }
      if (op && cmode !== 14) imm64 = ~imm64 & M64;
      this.vWriteBig(rd, q ? imm64 | (imm64 << 64n) : imm64, bytes); return;
    }
    // ORR (vector, register): MOV Vd, Vn when Rm == Rn
    if ((word & 0xbfe0fc00) === 0x0ea01c00) { const rm = field(word, 16, 5); this.vWriteBig(rd, this.vReadBig(rn, 16) | this.vReadBig(rm, 16), bytes); return; }
    // DUP (general): replicate a general register
    if ((word & 0xbfe0fc00) === 0x0e000c00) {
      const imm5 = field(word, 16, 5), esize = imm5 & 1 ? 8 : imm5 & 2 ? 16 : imm5 & 4 ? 32 : 64, value = this.r(rn) & ones(esize), full = replicate(value, esize, 64);
      this.vWriteBig(rd, q ? full | (full << 64n) : full, bytes); return;
    }
    // INS (general) and UMOV / MOV (to general)
    if ((word & 0xbfe0fc00) === 0x0e002c00) {   // SMOV: sign-extend a vector element into a general register
      const imm5 = field(word, 16, 5), shift = imm5 & 1 ? 0 : imm5 & 2 ? 1 : 2, index = imm5 >> (shift + 1), ebytes = 1 << shift; let v = 0n;
      for (let i = 0; i < ebytes; i++) v |= BigInt(this.vbuf[rn * 16 + index * ebytes + i]) << BigInt(8 * i);
      const value = BigInt.asIntN(8 * ebytes, v); this.w(rd, bit(word, 30) ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value)); return;
    }
    if ((word & 0xffe0fc00) === 0x4e001c00 || (word & 0xbfe0fc00) === 0x0e003c00) {
      const imm5 = field(word, 16, 5), shift = imm5 & 1 ? 0 : imm5 & 2 ? 1 : imm5 & 4 ? 2 : 3, index = imm5 >> (shift + 1), ebytes = 1 << shift, o = index * ebytes;
      if (bit(word, 13) === 0 && bit(word, 30)) { const off = rd * 16 + o; const v = this.r(rn); for (let i = 0; i < ebytes; i++) this.vbuf[off + i] = Number((v >> BigInt(8 * i)) & 0xffn); return; }   // INS Vd.T[i], Xn
      let v = 0n; for (let i = 0; i < ebytes; i++) v |= BigInt(this.vbuf[rn * 16 + o + i]) << BigInt(8 * i); this.w(rd, v); return;
    }
    return this.unsupported(word, at, 'an Advanced SIMD vector instruction');
  }
}

function roundTiesEven(a) { if (!isFinite(a)) return a; const f = Math.floor(a), d = a - f; if (d > 0.5) return f + 1; if (d < 0.5) return f; return f % 2 === 0 ? f : f + 1; }
