// The ARM64 translation tier (docs/ARM64-NATIVE.md "Translation tier"): hot code of the app's arm64-v8a libraries is compiled into WebAssembly functions that run over the
// interpreter's own memory and register file, with the interpreter (src/arm64/cpu.js) as the fallback for everything not translated. It changes how fast the library's
// instructions run, never what they do: every translated instruction does exactly what Arm64Cpu.execute does for that word, and the differential tests
// (tests/arm64-translate.test.mjs) run the same code both ways and compare registers, flags and memory.
//
// Shape (the design of browser x86 emulators that emit WebAssembly per hot region):
//  - The guest memory (src/arm64/memory.js) is a WebAssembly memory64 seen by JavaScript through a resizable buffer, so a translated load or store is one WebAssembly access;
//    the tier's own "state" memory holds each CPU's register file slot (X0-X30, SP, V0-V31, NZCV, the instruction count, the exit reason, TPIDR_EL0, the exclusive monitor)
//    and a byte per 4 KiB guest page that marks pages holding decoded or translated code. A CPU's vector registers live in its slot permanently (cpu.vbuf is a view of it);
//    the general registers and flags are copied in when translated code is entered and back when it returns to the interpreter.
//  - A region is the set of basic blocks reachable by direct branches from a hot branch target (a target the interpreter reached `threshold` times), within a window,
//    compiled into one function: a loop over a br_table, so branches inside the region are WebAssembly branches and only a branch out of it returns (a call to a callee
//    in the window, and a return to the instruction after such a call, stay inside). Every basic block start is an entry. Registers are WebAssembly locals inside the function, loaded at its start and stored at its exits.
//  - Exits are precise: an instruction the tier does not translate, an access outside the memory (a segmentation fault), a store into a page holding code, an exhausted
//    budget: the function stores the state as it was before that instruction and returns its address with reason 1, and the interpreter executes it (and faults there, with
//    its usual report). Nothing in a translated function can trap.
//  - Preemption is exact: the caller gives each call the number of instructions it may run (the scheduler's budget, and no further than the instruction where the
//    interpreter's 2^20-instruction heartbeat falls), each block checks it on entry, and the count of executed instructions is added to cpu.steps. Translated code returns
//    to the scheduler exactly where the interpreter would have.
//  - Invalidation: a page's translations and decoded instructions go when the page is written by the interpreter or a lab function (src/arm64/decode-cache.js), when it is
//    mprotect'ed or unmapped, and translated stores to such a page leave the translated code before storing, so the interpreter's write drops them first. Code written or
//    unpacked at run time is decoded again before it runs.
import { decodeBitMasks } from './cpu.js?v=88e579518234';
import { DecodeCache } from './decode-cache.js?v=88e579518234';
import { Code, OP, SIMD, T, V, moduleBytes } from './wasm-emit.js?v=88e579518234';

const PAGE = 4096, SLOT = 1024, MAX_SLOTS = 4096;
// slot layout (bytes from the slot's start)
const SX = 0, SV = 256, SN = 768, SZ = 772, SC = 776, SVF = 780, SCNT = 784, SREASON = 788, STPIDR = 792, SEXCL = 800, SEXCLV = 808, SLAST = 816;
// function locals: params S (slot), entry (block index), allowed (instructions); X0..X30 and SP; i64 temps; flags; count; reason; i32 temps; next pc
const P_S = 0, P_ENTRY = 1, P_ALLOWED = 2, X = n => 3 + n, T0 = 35, T1 = 36, T2 = 37, T3 = 38, T4 = 39, T5 = 40, T6 = 41, TO = 42;
const LN = 43, LZ = 44, LC = 45, LV = 46, CNT = 47, REASON = 48, U0 = 49, U1 = 50, U2 = 51, NPC = 53;
const LOCALS = [[40, T.i64], [10, T.i32], [1, T.f64]];
const EXIT = 0, TOP = 1;   // label positions
const M32 = 0xffffffffn, M64 = (1n << 64n) - 1n, MIN64 = -(1n << 63n);
const WINDOW = 32 * 1024, MAX_INSNS = 1500, MAX_BLOCKS = 160;

const bit = (word, n) => (word >>> n) & 1, field = (word, lo, width) => (word >>> lo) & ((1 << width) - 1);
const signExtend = (value, bits) => (value << (32 - bits)) >> (32 - bits);

/** Does this engine run the tier's modules (memory64, multi-memory, SIMD, resizable buffers of a WebAssembly memory)? Checked once. */
let supported;
export function tierSupported() {
  if (supported !== undefined) return supported;
  try {
    const g = new WebAssembly.Memory({ address: 'i64', initial: 1n, maximum: 2n }), s = new WebAssembly.Memory({ initial: 1, maximum: 1 }), z = new WebAssembly.Global({ value: 'i64', mutable: true }, 65536n);
    if (typeof g.toResizableBuffer !== 'function') return (supported = false);
    const c = new Code(); c.get(P_S).i64(0).simd(SIMD.v128_load, 0, 16).simd(SIMD.v128_store, 1, 0).f64(1.5);
    const f = new WebAssembly.Instance(new WebAssembly.Module(moduleBytes([[1, T.i64]], c)), { m: { g, s, z } }).exports.f;
    supported = f(0, 0, 0) === 1.5;
  } catch { supported = false; }
  return supported;
}

// ---- the emitter of one region
class Emitter extends Code {
  constructor(base) { super(); this.base = base; this.reads = new Uint8Array(32); this.writes = new Uint8Array(32); this.flagsUsed = false; this.flagsWritten = false; this.k = 0; this.pc = 0; }
  x(n) { if (n === 31) return this.i64(0); this.reads[n] = 1; return this.get(X(n)); }          // Xn / XZR
  xsp(n) { this.reads[n] = 1; return this.get(X(n)); }                                           // Xn / SP
  setx(n) { if (n === 31) return this.op(OP.drop); this.writes[n] = 1; return this.set(X(n)); }
  setxsp(n) { this.writes[n] = 1; return this.set(X(n)); }
  x32(n) { return this.x(n).op(OP.i32_wrap_i64); }
  setx32(n) { return this.op(OP.i64_extend_i32_u).setx(n); }
  flag(local) { this.flagsUsed = true; return this.get(local); }
  setFlag(local) { this.flagsUsed = this.flagsWritten = true; return this.set(local); }
  /** Leaves through the exit: the state before the current instruction, which the interpreter then executes (reason 1). */
  bail() { return this.get(CNT).i32(this.k).op(OP.i32_add).set(CNT).f64(this.pc).set(NPC).i32(1).set(REASON).br(EXIT); }
  bailIf() { this.open(OP.if); this.bail(); return this.end(); }   // on an i32 condition
  /** The condition `code` (Arm ARM ConditionHolds) as an i32 0/1. */
  cond(code) {
    const base = code >> 1, invert = (code & 1) && code !== 15;
    switch (base) {
      case 0: this.flag(LZ); break; case 1: this.flag(LC); break; case 2: this.flag(LN); break; case 3: this.flag(LV); break;
      case 4: this.flag(LC).flag(LZ).op(OP.i32_eqz, OP.i32_and); break;
      case 5: this.flag(LN).flag(LV).op(OP.i32_eq); break;
      case 6: this.flag(LN).flag(LV).op(OP.i32_eq).flag(LZ).op(OP.i32_eqz, OP.i32_and); break;
      default: return this.i32(1);
    }
    if (invert) this.op(OP.i32_eqz);
    return this;
  }
  /** a + b + carry at `width` from the two values in (i64 T0, T1) or (i32 U0, U1); result in T2 / U2; NZCV when `flags`. carry: 0, 1 or 'c' (the C flag). */
  addWithCarry(width, carry, flags) {
    const w64 = width === 64, A = w64 ? T0 : U0, B = w64 ? T1 : U1, R = w64 ? T2 : U2, add = w64 ? OP.i64_add : OP.i32_add, xor = w64 ? OP.i64_xor : OP.i32_xor, and = w64 ? OP.i64_and : OP.i32_and;
    this.get(A).get(B).op(add);
    if (carry === 1) { if (w64) this.i64(1); else this.i32(1); this.op(add); } else if (carry === 'c') { this.flag(LC); if (w64) this.op(OP.i64_extend_i32_u); this.op(add); }
    this.set(R);
    if (!flags) return this;
    const lt = w64 ? OP.i64_lt_u : OP.i32_lt_u, le = w64 ? OP.i64_le_u : OP.i32_le_u;
    if (carry === 0) this.get(R).get(A).op(lt); else if (carry === 1) this.get(R).get(A).op(le); else this.get(R).get(A).op(le).get(R).get(A).op(lt).flag(LC).op(OP.select);
    this.setFlag(LC);
    this.top(R, width).setFlag(LN);
    this.get(R); if (w64) this.op(OP.i64_eqz); else this.op(OP.i32_eqz); this.setFlag(LZ);
    this.get(A).get(R).op(xor).get(B).get(R).op(xor).op(and); this.topOfStack(width).setFlag(LV);
    return this;
  }
  /** The top bit (the sign) of local `r` at `width`, as i32. */
  top(r, width) { this.get(r); return this.topOfStack(width); }
  topOfStack(width) { if (width === 64) return this.i64(63).op(OP.i64_shr_u, OP.i32_wrap_i64); return this.i32(31).op(OP.i32_shr_u); }
  /** N and Z from the result in local `r` (i64 at 64, i32 at 32), C and V clear: the logical instructions' flags. */
  logicFlags(r, width) {
    this.top(r, width).setFlag(LN); this.get(r).op(width === 64 ? OP.i64_eqz : OP.i32_eqz).setFlag(LZ); this.i32(0).setFlag(LC); this.i32(0).setFlag(LV);
    return this;
  }
  /** Xm shifted (type 0 LSL, 1 LSR, 2 ASR, 3 ROR) by a constant, as i64 (64) or i32 (32). */
  shifted(rm, type, amount, width) {
    if (width === 64) { this.x(rm); if (amount) this.i64(amount).op([OP.i64_shl, OP.i64_shr_u, OP.i64_shr_s, OP.i64_rotr][type]); }
    else { this.x32(rm); if (amount) this.i32(amount).op([OP.i32_shl, OP.i32_shr_u, OP.i32_shr_s, OP.i32_rotr][type]); }
    return this;
  }
  /** Xm extended (option: UXTB..SXTX) and shifted left, as i64. */
  extended(rm, option, shift) {
    this.x(rm);
    switch (option) { case 0: this.i64(0xff).op(OP.i64_and); break; case 1: this.i64(0xffff).op(OP.i64_and); break; case 2: this.i64(M32).op(OP.i64_and); break; case 4: this.op(OP.i64_extend8_s); break; case 5: this.op(OP.i64_extend16_s); break; case 6: this.op(OP.i64_extend32_s); break; default: break; }
    if (shift) this.i64(shift).op(OP.i64_shl);
    return this;
  }
  // ---- guest memory
  /** The address (i64) on the stack is checked for an access of `n` bytes (a store when `store`): outside the memory, or a store into a page holding code, leaves
   *  through the exit; otherwise TO holds address - base - 4096, which the access uses with offset 4096. */
  access(n, store) {
    this.i64(this.base + 4096n).op(OP.i64_sub).tee(TO).global(0).i64(4096 + n).op(OP.i64_sub, OP.i64_gt_u).bailIf();
    if (store) {
      this.get(TO).i64(12).op(OP.i64_shr_u, OP.i32_wrap_i64).mem(OP.i32_load8_u, 1, 1);
      if (n > 1) this.get(TO).i64(n - 1).op(OP.i64_add).i64(12).op(OP.i64_shr_u, OP.i32_wrap_i64).mem(OP.i32_load8_u, 1, 1).op(OP.i32_or);
      this.bailIf();
    }
    return this;
  }
  load(bytes, signed, offset = 0) {   // from the checked address, as i64 (zero- or sign-extended to 64 bits)
    this.get(TO);
    const code = bytes === 8 ? OP.i64_load : bytes === 4 ? (signed ? OP.i64_load32_s : OP.i64_load32_u) : bytes === 2 ? (signed ? OP.i64_load16_s : OP.i64_load16_u) : (signed ? OP.i64_load8_s : OP.i64_load8_u);
    return this.mem(code, 0, 4096 + offset);
  }
  storeOp(bytes, offset = 0) { return this.mem(bytes === 8 ? OP.i64_store : bytes === 4 ? OP.i64_store32 : bytes === 2 ? OP.i64_store16 : OP.i64_store8, 0, 4096 + offset); }
  /** Vt <- `bytes` bytes at the checked address (+offset), the rest of the register zeroed (as the interpreter's vWriteBig). */
  loadVector(t, bytes, offset = 0) {
    const at = SV + 16 * t;
    if (bytes === 16) return this.get(P_S).get(TO).simd(SIMD.v128_load, 0, 4096 + offset).simd(SIMD.v128_store, 1, at);
    this.get(P_S).load(bytes, false, offset).mem(OP.i64_store, 1, at);
    return this.get(P_S).i64(0).mem(OP.i64_store, 1, at + 8);
  }
  storeVector(t, bytes, offset = 0) {
    const at = SV + 16 * t;
    if (bytes === 16) return this.get(TO).get(P_S).simd(SIMD.v128_load, 1, at).simd(SIMD.v128_store, 0, 4096 + offset);
    this.get(TO).get(P_S).mem(bytes === 8 ? OP.i64_load : bytes === 4 ? OP.i64_load32_u : bytes === 2 ? OP.i64_load16_u : OP.i64_load8_u, 1, at);
    return this.storeOp(bytes, offset);
  }
  /** T0 = Xn|SP, T1 = T0 + imm (the effective address); an address that wraps around 2^64 leaves through the exit (the interpreter adds without wrapping and faults). */
  baseImm(rn, imm) {
    this.xsp(rn).tee(T0);
    if (imm) this.i64(imm).op(OP.i64_add);
    this.set(T1);
    if (imm > 0) this.get(T1).get(T0).op(OP.i64_lt_u).bailIf(); else if (imm < 0) this.get(T1).get(T0).op(OP.i64_gt_u).bailIf();
    return this;
  }
}

// ---- instructions. Each returns null (not translated: nothing emitted) or { kind } with kind 'op' (straight-line), 'jump' / 'call' (target), 'cond' (target; the
// condition is left on the stack), 'indirect' (NPC set). Validation comes before emission.
function emitInsn(e, word, at) {
  const op0 = field(word, 25, 4);
  if ((op0 & 0b1110) === 0b1000) return dataImmediate(e, word, at);
  if ((op0 & 0b1110) === 0b1010) return branchSystem(e, word, at);
  if ((op0 & 0b0101) === 0b0100) return loadStore(e, word, at);
  if ((op0 & 0b0111) === 0b0101) return dataRegister(e, word);
  if ((op0 & 0b0111) === 0b0111) return simdData(e, word);
  return null;
}
const OK = { kind: 'op' };

function dataImmediate(e, word, at) {
  const op = field(word, 23, 3), sf = bit(word, 31), width = sf ? 64 : 32, rd = word & 31, rn = field(word, 5, 5);
  switch (op) {
    case 0b000: case 0b001: {   // ADR / ADRP
      const imm = BigInt(signExtend(field(word, 5, 19), 19) * 4 + field(word, 29, 2));
      e.i64(BigInt.asUintN(64, bit(word, 31) ? (BigInt(at) & ~0xfffn) + (imm << 12n) : BigInt(at) + imm)).setx(rd); return OK;
    }
    case 0b010: {   // ADD / SUB (immediate), with or without flags
      const sub = bit(word, 30), flags = bit(word, 29), imm = BigInt(field(word, 10, 12)) << (bit(word, 22) ? 12n : 0n);
      if (width === 64) {
        if (!flags) { e.xsp(rn).i64(imm).op(sub ? OP.i64_sub : OP.i64_add).setxsp(rd); return OK; }
        e.xsp(rn).set(T0).i64(sub ? ~imm : imm).set(T1).addWithCarry(64, sub ? 1 : 0, true).get(T2).setx(rd); return OK;
      }
      if (!flags) { e.xsp(rn).op(OP.i32_wrap_i64).i32(Number(imm)).op(sub ? OP.i32_sub : OP.i32_add, OP.i64_extend_i32_u).setxsp(rd); return OK; }
      e.xsp(rn).op(OP.i32_wrap_i64).set(U0).i32(Number(sub ? ~imm & M32 : imm)).set(U1).addWithCarry(32, sub ? 1 : 0, true).get(U2).setx32(rd); return OK;
    }
    case 0b100: {   // logical (immediate)
      const opc = field(word, 29, 2), n = bit(word, 22);
      if (!sf && n) return null;
      const masks = decodeBitMasks(n, field(word, 10, 6), field(word, 16, 6), true, width); if (!masks) return null;
      const imm = masks.wmask;
      e.x(rn); if (width === 32) e.i64(M32).op(OP.i64_and);
      e.i64(imm).op(opc === 0 || opc === 3 ? OP.i64_and : opc === 1 ? OP.i64_or : OP.i64_xor);
      if (opc === 3) { e.set(T2); if (width === 64) e.logicFlags(T2, 64); else { e.get(T2).op(OP.i32_wrap_i64).set(U2).logicFlags(U2, 32); } e.get(T2).setx(rd); }
      else e.setxsp(rd);
      return OK;
    }
    case 0b101: {   // MOVN / MOVZ / MOVK
      const opc = field(word, 29, 2), hw = field(word, 21, 2);
      if (opc === 1 || (!sf && hw > 1)) return null;
      const shift = BigInt(hw * 16), imm = BigInt(field(word, 5, 16)) << shift, mask = sf ? M64 : M32;
      if (opc === 2) e.i64(imm).setx(rd);
      else if (opc === 0) e.i64(~imm & mask).setx(rd);
      else e.x(rd).i64(~(0xffffn << shift) & mask).op(OP.i64_and).i64(imm).op(OP.i64_or).setx(rd);
      return OK;
    }
    case 0b110: {   // SBFM / BFM / UBFM
      const opc = field(word, 29, 2), n = bit(word, 22), immr = field(word, 16, 6), imms = field(word, 10, 6);
      if (opc === 3 || n !== sf || (!sf && (immr > 31 || imms > 31))) return null;
      const masks = decodeBitMasks(n, imms, immr, false, width); if (!masks) return null;
      const mask = sf ? M64 : M32, { wmask, tmask } = masks;
      // src = Xn & mask (T0); rotated (T1); bot = (dst & ~wmask) | (rotated & wmask)
      e.x(rn); if (!sf) e.i64(M32).op(OP.i64_and); e.set(T0);
      if (immr === 0) e.get(T0); else if (sf) e.get(T0).i64(immr).op(OP.i64_rotr); else e.get(T0).i64(immr).op(OP.i64_shr_u).get(T0).i64(32 - immr).op(OP.i64_shl).op(OP.i64_or).i64(M32).op(OP.i64_and);
      e.i64(wmask).op(OP.i64_and);
      if (opc === 1) { e.x(rd).i64(~wmask & mask).op(OP.i64_and).op(OP.i64_or); }   // BFM: the destination's other bits
      e.set(T1);   // bot
      if (opc === 0) {   // SBFM: top = replicated bit imms of src
        e.i64(0).get(T0).i64(imms).op(OP.i64_shr_u).i64(1).op(OP.i64_and).op(OP.i64_sub).i64(~tmask & mask).op(OP.i64_and).get(T1).i64(tmask).op(OP.i64_and).op(OP.i64_or);
      } else if (opc === 1) e.x(rd).i64(~tmask & mask).op(OP.i64_and).get(T1).i64(tmask).op(OP.i64_and).op(OP.i64_or);
      else e.get(T1).i64(tmask).op(OP.i64_and);
      e.setx(rd); return OK;
    }
    case 0b111: {   // EXTR
      const n = bit(word, 22), rm = field(word, 16, 5), lsb = field(word, 10, 6);
      if (field(word, 29, 2) !== 0 || bit(word, 21) || n !== sf || (!sf && lsb > 31)) return null;
      if (sf) { if (lsb === 0) e.x(rm); else e.x(rm).i64(lsb).op(OP.i64_shr_u).x(rn).i64(64 - lsb).op(OP.i64_shl).op(OP.i64_or); e.setx(rd); }
      else { if (lsb === 0) e.x32(rm); else e.x32(rm).i32(lsb).op(OP.i32_shr_u).x32(rn).i32(32 - lsb).op(OP.i32_shl).op(OP.i32_or); e.setx32(rd); }
      return OK;
    }
    default: return null;
  }
}

function branchSystem(e, word, at) {
  if ((word & 0x7c000000) === 0x14000000) {   // B / BL
    const target = at + signExtend(word & 0x3ffffff, 26) * 4;
    if (bit(word, 31)) { e.i64(at + 4).setx(30); return { kind: 'call', target }; }
    return { kind: 'jump', target };
  }
  if ((word & 0xff000000) === 0x54000000) {   // B.cond (and BC.cond)
    e.cond(word & 15); return { kind: 'cond', target: at + signExtend(field(word, 5, 19), 19) * 4 };
  }
  if ((word & 0x7e000000) === 0x34000000) {   // CBZ / CBNZ
    const sf = bit(word, 31), rt = word & 31;
    if (sf) e.x(rt).op(OP.i64_eqz); else e.x32(rt).op(OP.i32_eqz);
    if (bit(word, 24)) e.op(OP.i32_eqz);
    return { kind: 'cond', target: at + signExtend(field(word, 5, 19), 19) * 4 };
  }
  if ((word & 0x7e000000) === 0x36000000) {   // TBZ / TBNZ
    const b = (bit(word, 31) << 5) | field(word, 19, 5), rt = word & 31;
    e.x(rt).i64(b).op(OP.i64_shr_u).i64(1).op(OP.i64_and, OP.i32_wrap_i64); if (!bit(word, 24)) e.op(OP.i32_eqz);
    return { kind: 'cond', target: at + signExtend(field(word, 5, 14), 14) * 4 };
  }
  const indirect = (word & 0xfffffc1f) >>> 0;
  if (indirect === 0xd61f0000 || indirect === 0xd63f0000 || indirect === 0xd65f0000) {   // BR / BLR / RET
    const rn = field(word, 5, 5);
    e.x(rn).op(OP.f64_convert_i64_u).set(NPC);
    e.get(P_S).f64(at).mem(OP.f64_store, 1, SLAST);   // the last indirect branch (named in fault reports)
    if (indirect === 0xd63f0000) e.i64(at + 4).setx(30);
    return { kind: 'indirect' };
  }
  if (((word & 0xffc00000) >>> 0) === 0xd5000000) return system(e, word);
  return null;   // SVC, BRK, HLT, ERET, pointer-authenticated branches: the interpreter
}
function system(e, word) {
  const l = bit(word, 21), op0 = field(word, 19, 2), op1 = field(word, 16, 3), crn = field(word, 12, 4), crm = field(word, 8, 4), op2 = field(word, 5, 3), rt = word & 31;
  if (op0 === 0 && crn === 2 && l === 0 && rt === 31) return OK;   // hints (NOP, YIELD, PACIASP, BTI ...): as the interpreter, no effect
  if (op0 === 0 && crn === 3 && l === 0) {   // barriers; CLREX clears the exclusive monitor
    if (op2 === 2) e.get(P_S).i32(0).mem(OP.i32_store, 1, SEXCLV);
    return OK;
  }
  if (op0 === 3 && op1 === 3 && crn === 13 && crm === 0 && op2 === 2) {   // TPIDR_EL0
    if (l) e.get(P_S).mem(OP.i64_load, 1, STPIDR).setx(rt); else e.get(P_S).x(rt).mem(OP.i64_store, 1, STPIDR);
    return OK;
  }
  if (op0 === 3 && op1 === 3 && crn === 4 && crm === 2 && op2 === 0) {   // NZCV
    if (l) { e.flag(LN).i32(31).op(OP.i32_shl).flag(LZ).i32(30).op(OP.i32_shl).op(OP.i32_or).flag(LC).i32(29).op(OP.i32_shl).op(OP.i32_or).flag(LV).i32(28).op(OP.i32_shl).op(OP.i32_or).op(OP.i64_extend_i32_u).setx(rt); return OK; }
    e.x(rt).i64(28).op(OP.i64_shr_u, OP.i32_wrap_i64).set(U0);
    for (const [local, b] of [[LN, 3], [LZ, 2], [LC, 1], [LV, 0]]) e.get(U0).i32(b).op(OP.i32_shr_u).i32(1).op(OP.i32_and).setFlag(local);
    return OK;
  }
  if (op0 === 1 && crn === 7 && l === 0 && !(op1 === 3 && crm === 4 && op2 === 1)) return OK;   // cache maintenance (DC / IC) other than DC ZVA: no effect on this memory
  return null;
}

function dataRegister(e, word) {
  const sf = bit(word, 31), width = sf ? 64 : 32, rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5), op1 = bit(word, 28), op2 = field(word, 21, 4);
  if (!op1 && !(op2 & 8)) {   // logical (shifted register)
    const opc = field(word, 29, 2), n = bit(word, 21), type = field(word, 22, 2), amount = field(word, 10, 6);
    if (!sf && amount > 31) return null;
    const w64 = width === 64;
    e.shifted(rm, type, amount, width); if (n) { if (w64) e.i64(-1).op(OP.i64_xor); else e.i32(-1).op(OP.i32_xor); }
    if (w64) e.set(T1).x(rn).get(T1); else e.set(U1).x32(rn).get(U1);
    e.op(w64 ? [OP.i64_and, OP.i64_or, OP.i64_xor, OP.i64_and][opc] : [OP.i32_and, OP.i32_or, OP.i32_xor, OP.i32_and][opc]);
    if (opc === 3) { e.set(w64 ? T2 : U2).logicFlags(w64 ? T2 : U2, width).get(w64 ? T2 : U2); }
    if (w64) e.setx(rd); else e.setx32(rd);
    return OK;
  }
  if (!op1 && (op2 & 8)) {   // add / sub, shifted or extended register
    const sub = bit(word, 30), flags = bit(word, 29), w64 = width === 64;
    if (!bit(word, 21)) {   // shifted
      const type = field(word, 22, 2), amount = field(word, 10, 6);
      if (type === 3 || (!sf && amount > 31)) return null;
      if (w64) { e.x(rn).set(T0).shifted(rm, type, amount, 64); if (sub) e.i64(-1).op(OP.i64_xor); e.set(T1).addWithCarry(64, sub ? 1 : 0, flags).get(T2).setx(rd); }
      else { e.x32(rn).set(U0).shifted(rm, type, amount, 32); if (sub) e.i32(-1).op(OP.i32_xor); e.set(U1).addWithCarry(32, sub ? 1 : 0, flags).get(U2).setx32(rd); }
      return OK;
    }
    const option = field(word, 13, 3), shift = field(word, 10, 3);   // extended
    if (shift > 4 || field(word, 22, 2) !== 0) return null;
    if (w64) { e.xsp(rn).set(T0).extended(rm, option, shift); if (sub) e.i64(-1).op(OP.i64_xor); e.set(T1).addWithCarry(64, sub ? 1 : 0, flags).get(T2); }
    else { e.xsp(rn).op(OP.i32_wrap_i64).set(U0).extended(rm, option, shift).op(OP.i32_wrap_i64); if (sub) e.i32(-1).op(OP.i32_xor); e.set(U1).addWithCarry(32, sub ? 1 : 0, flags).get(U2).op(OP.i64_extend_i32_u); }
    if (flags) e.setx(rd); else e.setxsp(rd);
    return OK;
  }
  const op = field(word, 21, 4);
  if (op === 0b0000) {   // ADC / ADCS / SBC / SBCS
    if (field(word, 10, 6) !== 0) return null;
    const sub = bit(word, 30), flags = bit(word, 29);
    if (width === 64) { e.x(rn).set(T0).x(rm); if (sub) e.i64(-1).op(OP.i64_xor); e.set(T1).addWithCarry(64, 'c', flags).get(T2).setx(rd); }
    else { e.x32(rn).set(U0).x32(rm); if (sub) e.i32(-1).op(OP.i32_xor); e.set(U1).addWithCarry(32, 'c', flags).get(U2).setx32(rd); }
    return OK;
  }
  if (op === 0b0010) {   // CCMP / CCMN (register, immediate)
    if (bit(word, 10) || bit(word, 4) || !bit(word, 29)) return null;
    const sub = bit(word, 30), imm = bit(word, 11), nzcv = word & 15, w64 = width === 64;
    e.cond(field(word, 12, 4)).open(OP.if);
    if (w64) { e.x(rn).set(T0); if (imm) e.i64(rm); else e.x(rm); if (sub) e.i64(-1).op(OP.i64_xor); e.set(T1).addWithCarry(64, sub ? 1 : 0, true); }
    else { e.x32(rn).set(U0); if (imm) e.i32(rm); else e.x32(rm); if (sub) e.i32(-1).op(OP.i32_xor); e.set(U1).addWithCarry(32, sub ? 1 : 0, true); }
    e.else().i32((nzcv >> 3) & 1).setFlag(LN).i32((nzcv >> 2) & 1).setFlag(LZ).i32((nzcv >> 1) & 1).setFlag(LC).i32(nzcv & 1).setFlag(LV).end();
    return OK;
  }
  if (op === 0b0100) {   // CSEL / CSINC / CSINV / CSNEG
    if (bit(word, 11) || bit(word, 29)) return null;
    const opc = (bit(word, 30) << 1) | bit(word, 10), mask = sf ? M64 : M32;
    e.x(rn); if (!sf) e.i64(M32).op(OP.i64_and);
    e.x(rm);
    if (opc === 1) e.i64(1).op(OP.i64_add); else if (opc === 2) e.i64(-1).op(OP.i64_xor); else if (opc === 3) e.set(T0).i64(0).get(T0).op(OP.i64_sub);
    if (!sf || opc !== 0) e.i64(mask).op(OP.i64_and);
    e.cond(field(word, 12, 4)).op(OP.select).setx(rd);
    return OK;
  }
  if (op === 0b0110) {
    if (bit(word, 29)) return null;
    if (bit(word, 30)) return oneSource(e, word, sf, rd, rn);
    const opcode = field(word, 10, 6), w64 = width === 64;   // two source
    if (opcode === 2 || opcode === 3) {   // UDIV / SDIV: division by zero is 0, the most negative value / -1 is itself
      if (w64) {
        e.x(rm).tee(T1).op(OP.i64_eqz).open(OP.if, T.i64); e.i64(0).else();
        if (opcode === 2) e.x(rn).get(T1).op(OP.i64_div_u);
        else { e.x(rn).tee(T0).i64(MIN64).op(OP.i64_eq).get(T1).i64(-1).op(OP.i64_eq, OP.i32_and).open(OP.if, T.i64); e.i64(MIN64).else().get(T0).get(T1).op(OP.i64_div_s).end(); }
        e.end().setx(rd);
      } else {
        e.x32(rm).tee(U1).op(OP.i32_eqz).open(OP.if, T.i32); e.i32(0).else();
        if (opcode === 2) e.x32(rn).get(U1).op(OP.i32_div_u);
        else { e.x32(rn).tee(U0).i32(-0x80000000).op(OP.i32_eq).get(U1).i32(-1).op(OP.i32_eq, OP.i32_and).open(OP.if, T.i32); e.i32(-0x80000000).else().get(U0).get(U1).op(OP.i32_div_s).end(); }
        e.end().setx32(rd);
      }
      return OK;
    }
    if (opcode >= 8 && opcode <= 11) {   // LSLV / LSRV / ASRV / RORV: the amount is Rm modulo the width, as WebAssembly's shifts take it
      if (w64) e.x(rn).x(rm).op([OP.i64_shl, OP.i64_shr_u, OP.i64_shr_s, OP.i64_rotr][opcode - 8]).setx(rd);
      else e.x32(rn).x32(rm).op([OP.i32_shl, OP.i32_shr_u, OP.i32_shr_s, OP.i32_rotr][opcode - 8]).setx32(rd);
      return OK;
    }
    return null;   // CRC32, PAC
  }
  if (op1 && (op2 & 8)) {   // data processing (3 source)
    const op31 = field(word, 21, 3), o0 = bit(word, 15), ra = field(word, 10, 5);
    if (field(word, 29, 2) !== 0) return null;
    if (op31 === 0) {   // MADD / MSUB
      if (sf) { e.x(rn).x(rm).op(OP.i64_mul).set(T0); if (o0) e.x(ra).get(T0).op(OP.i64_sub); else e.x(ra).get(T0).op(OP.i64_add); e.setx(rd); }
      else { e.x32(rn).x32(rm).op(OP.i32_mul).set(U0); if (o0) e.x32(ra).get(U0).op(OP.i32_sub); else e.x32(ra).get(U0).op(OP.i32_add); e.setx32(rd); }
      return OK;
    }
    if (!sf) return null;
    if (op31 === 1 || op31 === 5) {   // SMADDL / SMSUBL / UMADDL / UMSUBL
      const ext = op31 === 1 ? OP.i64_extend_i32_s : OP.i64_extend_i32_u;
      e.x32(rn).op(ext).x32(rm).op(ext).op(OP.i64_mul).set(T0); if (o0) e.x(ra).get(T0).op(OP.i64_sub); else e.x(ra).get(T0).op(OP.i64_add); e.setx(rd);
      return OK;
    }
    if ((op31 === 2 || op31 === 6) && !o0) {   // SMULH / UMULH: the high half of the 128-bit product, from 32-bit limbs
      e.x(rn).set(T0).x(rm).set(T1); umulh(e);   // T2 = high (unsigned)
      if (op31 === 2) {   // signed: subtract b when a < 0 and a when b < 0
        e.get(T2).get(T1).i64(0).get(T0).i64(0).op(OP.i64_lt_s).op(OP.select).op(OP.i64_sub).get(T0).i64(0).get(T1).i64(0).op(OP.i64_lt_s).op(OP.select).op(OP.i64_sub).set(T2);
      }
      e.get(T2).setx(rd); return OK;
    }
    return null;
  }
  return null;
}
/** T2 = high 64 bits of T0 * T1 (unsigned); T3..T6 scratch. */
function umulh(e) {
  const lo = l => e.get(l).i64(M32).op(OP.i64_and), hi = l => e.get(l).i64(32).op(OP.i64_shr_u);
  lo(T0); lo(T1); e.op(OP.i64_mul).i64(32).op(OP.i64_shr_u).set(T3);                                                   // k = (aL*bL) >> 32
  hi(T0); lo(T1); e.op(OP.i64_mul).get(T3).op(OP.i64_add).set(T4);                                                    // t = aH*bL + k
  e.get(T4).i64(32).op(OP.i64_shr_u).set(T5);                                                                         // w2 = t >> 32
  lo(T0); hi(T1); e.op(OP.i64_mul).get(T4).i64(M32).op(OP.i64_and).op(OP.i64_add).i64(32).op(OP.i64_shr_u).set(T6);    // k2 = (aL*bH + (t & M32)) >> 32
  hi(T0); hi(T1); e.op(OP.i64_mul).get(T5).op(OP.i64_add).get(T6).op(OP.i64_add).set(T2);                              // aH*bH + w2 + k2
}
const BSWAP = [[8, 0x00ff00ff00ff00ffn], [16, 0x0000ffff0000ffffn]];
/** Swaps adjacent `size`-bit fields of the i64 in T0 (mask selects the low fields). */
function swapFields(e, size, mask) { e.get(T0).i64(size).op(OP.i64_shr_u).i64(mask).op(OP.i64_and).get(T0).i64(mask).op(OP.i64_and).i64(size).op(OP.i64_shl).op(OP.i64_or).set(T0); }
function oneSource(e, word, sf, rd, rn) {
  const opcode = field(word, 10, 6);
  if (field(word, 16, 5) !== 0 || opcode > 5 || (!sf && opcode === 3)) return null;
  if (opcode === 4 || opcode === 5) {   // CLZ / CLS (CLS = CLZ(x ^ (x >> 1, arithmetic)) - 1)
    if (sf) { if (opcode === 4) e.x(rn).op(OP.i64_clz); else e.x(rn).tee(T0).get(T0).i64(1).op(OP.i64_shr_s).op(OP.i64_xor, OP.i64_clz).i64(1).op(OP.i64_sub); e.setx(rd); }
    else { if (opcode === 4) e.x32(rn).op(OP.i32_clz); else e.x32(rn).tee(U0).get(U0).i32(1).op(OP.i32_shr_s).op(OP.i32_xor, OP.i32_clz).i32(1).op(OP.i32_sub); e.setx32(rd); }
    return OK;
  }
  e.x(rn); if (!sf) e.i64(M32).op(OP.i64_and); e.set(T0);
  if (opcode === 0) {   // RBIT: swap bits, pairs, nibbles, then the bytes
    swapFields(e, 1, 0x5555555555555555n); swapFields(e, 2, 0x3333333333333333n); swapFields(e, 4, 0x0f0f0f0f0f0f0f0fn);
    for (const [s, m] of BSWAP) swapFields(e, s, m); e.get(T0).i64(32).op(OP.i64_rotr).set(T0);
    if (!sf) e.get(T0).i64(32).op(OP.i64_shr_u).set(T0);
  } else if (opcode === 1) swapFields(e, 8, 0x00ff00ff00ff00ffn);   // REV16
  else if (opcode === 2) { for (const [s, m] of BSWAP) swapFields(e, s, m); }   // REV32 (64-bit) / REV (32-bit): the bytes of each word
  else { for (const [s, m] of BSWAP) swapFields(e, s, m); e.get(T0).i64(32).op(OP.i64_rotr).set(T0); }   // REV (64-bit)
  e.get(T0).setx(rd); return OK;
}

function loadStore(e, word, at) {
  const cls = field(word, 27, 3), v = bit(word, 26);
  if (cls === 0b001 && !v) return exclusiveOrdered(e, word);
  if (cls === 0b011 && !bit(word, 24)) return literal(e, word, at);
  if (cls === 0b101) return pair(e, word);
  if (cls === 0b111) return single(e, word);
  if (cls === 0b001 && v && (word & 0xbf000000) === 0x0c000000) return structures(e, word);
  return null;   // single-structure SIMD loads and stores, LDAPR/STLUR, memory tagging: the interpreter
}
function literal(e, word, at) {
  const opc = field(word, 30, 2), v = bit(word, 26), rt = word & 31, address = at + signExtend(field(word, 5, 19), 19) * 4;
  if (v) { if (opc === 3) return null; const bytes = [4, 8, 16][opc]; e.i64(BigInt.asUintN(64, BigInt(address))).access(bytes, false).loadVector(rt, bytes); return OK; }
  if (opc === 3) return OK;   // PRFM (literal): no effect
  const bytes = opc === 1 ? 8 : 4;
  e.i64(BigInt.asUintN(64, BigInt(address))).access(bytes, false).load(bytes, opc === 2).setx(rt);
  return OK;
}
function pair(e, word) {
  const opc = field(word, 30, 2), v = bit(word, 26), mode = field(word, 23, 2), l = bit(word, 22), rt2 = field(word, 10, 5), rn = field(word, 5, 5), rt = word & 31;
  if (opc === 3 || (!v && opc === 1 && !l)) return null;
  const bytes = v ? 4 << opc : opc === 2 ? 8 : 4, signed = !v && opc === 1, offset = signExtend(field(word, 15, 7), 7) * bytes;
  e.baseImm(rn, mode === 1 ? 0 : offset).get(T1).access(2 * bytes, !l);
  if (l) {
    if (v) e.loadVector(rt, bytes).loadVector(rt2, bytes, bytes);
    else e.load(bytes, signed).set(T2).load(bytes, signed, bytes).set(T3).get(T2).setx(rt).get(T3).setx(rt2);
  } else if (v) e.storeVector(rt, bytes).storeVector(rt2, bytes, bytes);
  else e.get(TO).x(rt).storeOp(bytes).get(TO).x(rt2).storeOp(bytes, bytes);
  if (mode === 1 || mode === 3) { e.get(T0); if (offset) e.i64(offset).op(OP.i64_add); e.setxsp(rn); }
  return OK;
}
function single(e, word) {
  const size = field(word, 30, 2), v = bit(word, 26), opc = field(word, 22, 2), rn = field(word, 5, 5), rt = word & 31;
  if (!bit(word, 24) && bit(word, 21) && field(word, 10, 2) === 0b00 && !v) return atomic(e, word);   // bits 23:22 are the atomics' acquire / release
  if (v && (opc & 2) && size !== 0) return null;
  const scale = v ? (opc & 2 ? 16 : 1 << size) : 1 << size;
  // the operation, decided first: vector load/store, store, load (zero / sign to 64 / sign to 32), prefetch
  let kind;
  if (v) kind = opc & 1 ? 'vload' : 'vstore';
  else if (opc === 0) kind = 'store'; else if (opc === 1) kind = 'load';
  else if (opc === 2) kind = size === 3 ? 'prfm' : 'load64s';
  else if (size < 2) kind = 'load32s'; else return null;
  let writeback = null;   // the value to write back to Xn|SP (an emitter of i64), after the access
  if (bit(word, 24)) {   // unsigned immediate
    if (kind === 'prfm') return OK;
    e.baseImm(rn, field(word, 10, 12) * scale);
  } else if (bit(word, 21)) {
    if (field(word, 10, 2) !== 0b10) return null;
    const option = field(word, 13, 3); if (!(option & 2)) return null;   // UXTW, LSL (UXTX), SXTW, SXTX
    if (kind === 'prfm') return OK;
    e.xsp(rn).extended(field(word, 16, 5), option, bit(word, 12) ? Math.log2(scale) : 0).op(OP.i64_add).set(T1);
  } else {
    const imm9 = signExtend(field(word, 12, 9), 9), mode = field(word, 10, 2);
    if (kind === 'prfm') { if (mode === 0) return OK; return null; }   // PRFUM; other prefetch forms are unallocated
    if (mode === 1) { e.baseImm(rn, 0); writeback = imm9; }
    else if (mode === 3) { e.baseImm(rn, imm9); writeback = imm9; }
    else e.baseImm(rn, imm9);
  }
  const bytes = v ? (opc & 2 ? 16 : 1 << size) : 1 << size;
  e.get(T1).access(bytes, kind === 'store' || kind === 'vstore');
  switch (kind) {
    case 'vload': e.loadVector(rt, bytes); break;
    case 'vstore': e.storeVector(rt, bytes); break;
    case 'store': e.get(TO).x(rt).storeOp(bytes); break;
    case 'load': e.load(bytes, false).setx(rt); break;
    case 'load64s': e.load(bytes, true).setx(rt); break;
    default: e.load(bytes, true).i64(M32).op(OP.i64_and).setx(rt);   // sign-extended to 32 bits, zero above
  }
  if (writeback !== null) { e.get(T0); if (writeback) e.i64(writeback).op(OP.i64_add); e.setxsp(rn); }
  return OK;
}
function exclusiveOrdered(e, word) {
  const size = field(word, 30, 2), o2 = bit(word, 23), l = bit(word, 22), o1 = bit(word, 21), rs = field(word, 16, 5), rt2 = field(word, 10, 5), rn = field(word, 5, 5), rt = word & 31, bytes = 1 << size;
  const monitorHere = () => e.get(P_S).mem(OP.i32_load, 1, SEXCLV).get(P_S).mem(OP.i64_load, 1, SEXCL).get(T1).op(OP.i64_eq, OP.i32_and);
  const arm = () => { e.get(P_S).i32(1).mem(OP.i32_store, 1, SEXCLV); e.get(P_S).get(T1).mem(OP.i64_store, 1, SEXCL); };
  const clear = () => e.get(P_S).i32(0).mem(OP.i32_store, 1, SEXCLV);
  if (o2 === 0 && o1 === 0) {   // LDXR / LDAXR / STXR / STLXR
    e.xsp(rn).set(T1);
    if (l) { e.get(T1).access(bytes, false).load(bytes, false).setx(rt); arm(); return OK; }
    monitorHere(); e.tee(U0).open(OP.if); e.get(T1).access(bytes, true).get(TO).x(rt).storeOp(bytes); e.end();
    e.get(U0).op(OP.i32_eqz, OP.i64_extend_i32_u).setx(rs); clear(); return OK;
  }
  if (o2 === 0 && o1 === 1) {   // LDXP / LDAXP / STXP / STLXP
    if (size < 2) return null;
    e.xsp(rn).set(T1);
    if (l) { e.get(T1).access(2 * bytes, false).load(bytes, false).set(T2).load(bytes, false, bytes).set(T3).get(T2).setx(rt).get(T3).setx(rt2); arm(); return OK; }
    monitorHere(); e.tee(U0).open(OP.if); e.get(T1).access(2 * bytes, true).get(TO).x(rt).storeOp(bytes).get(TO).x(rt2).storeOp(bytes, bytes); e.end();
    e.get(U0).op(OP.i32_eqz, OP.i64_extend_i32_u).setx(rs); clear(); return OK;
  }
  if (o2 === 1 && o1 === 0) {   // LDAR / STLR / LDLAR / STLLR
    e.xsp(rn).access(bytes, !l);
    if (l) e.load(bytes, false).setx(rt); else e.get(TO).x(rt).storeOp(bytes);
    return OK;
  }
  if (rt2 !== 31) return null;
  // CAS / CASA / CASL / CASAL: the old value to Rs; the new one stored when the old one equals Rs
  e.xsp(rn).access(bytes, true).load(bytes, false).set(T2);
  e.get(T2).x(rs); if (bytes < 8) e.i64((1n << BigInt(8 * bytes)) - 1n).op(OP.i64_and); e.op(OP.i64_eq).open(OP.if); e.get(TO).x(rt).storeOp(bytes); e.end();
  e.get(T2).setx(rs);
  return OK;
}
function atomic(e, word) {   // LSE: LDADD, LDCLR, LDEOR, LDSET, LDSMAX, LDSMIN, LDUMAX, LDUMIN, SWP, LDAPR
  const size = field(word, 30, 2), rs = field(word, 16, 5), o3 = bit(word, 15), opc = field(word, 12, 3), rn = field(word, 5, 5), rt = word & 31, bytes = 1 << size;
  if (o3 && opc !== 0 && opc !== 4) return null;
  const mask = bytes < 8 ? (1n << BigInt(8 * bytes)) - 1n : M64, signExt = [OP.i64_extend8_s, OP.i64_extend16_s, OP.i64_extend32_s][size];
  const store = !(o3 && opc === 4);
  e.xsp(rn).access(bytes, store).load(bytes, false).set(T2);   // old
  e.x(rs); if (bytes < 8) e.i64(mask).op(OP.i64_and); e.set(T3);   // operand
  if (store) {
    e.get(TO);
    if (o3) e.get(T3);
    else switch (opc) {
      case 0: e.get(T2).get(T3).op(OP.i64_add); break; case 1: e.get(T2).get(T3).i64(-1).op(OP.i64_xor).op(OP.i64_and); break;
      case 2: e.get(T2).get(T3).op(OP.i64_xor); break; case 3: e.get(T2).get(T3).op(OP.i64_or); break;
      default: {
        const signed = opc === 4 || opc === 5, max = opc === 4 || opc === 6, cmp = signed ? (max ? OP.i64_gt_s : OP.i64_lt_s) : (max ? OP.i64_gt_u : OP.i64_lt_u);
        e.get(T2).get(T3).get(T2); if (signed && size < 3) e.op(signExt); e.get(T3); if (signed && size < 3) e.op(signExt); e.op(cmp, OP.select);
      }
    }
    e.storeOp(bytes);
  }
  e.get(T2).setx(rt);
  return OK;
}

// ---- FMOV (general): a bit copy between a general register and a vector register (no rounding, no NaN handling: exact in WebAssembly). Code that keeps doubles NaN-boxed in
// general registers (a JavaScript engine's values) moves them through these at every arithmetic step. To a vector register the rest of the register is cleared (S, D forms);
// the D[1] forms read or write the upper half only. Register 31 is XZR, as for the interpreter.
function fmovGeneral(e, word) {
  const rd = word & 31, rn = field(word, 5, 5), base = (word & 0xfffffc00) >>> 0;
  if (base === 0x1e260000) { e.get(P_S).mem(OP.i64_load32_u, 1, vreg(rn)).setx(rd); return OK; }   // FMOV Wd, Sn
  if (base === 0x9e660000) { e.get(P_S).mem(OP.i64_load, 1, vreg(rn)).setx(rd); return OK; }   // FMOV Xd, Dn
  if (base === 0x9eae0000) { e.get(P_S).mem(OP.i64_load, 1, vreg(rn) + 8).setx(rd); return OK; }   // FMOV Xd, Vn.D[1]
  if (base === 0x1e270000 || base === 0x9e670000) {   // FMOV Sd, Wn / FMOV Dd, Xn
    e.get(P_S).v128(ZERO).simd(SIMD.v128_store, 1, vreg(rd));
    e.get(P_S).x(rn); if (base === 0x1e270000) e.i64(M32).op(OP.i64_and); e.mem(OP.i64_store, 1, vreg(rd)); return OK;
  }
  if (base === 0x9eaf0000) { e.get(P_S).x(rn).mem(OP.i64_store, 1, vreg(rd) + 8); return OK; }   // FMOV Vd.D[1], Xn
  return undefined;
}

// ---- Advanced SIMD: the integer vector forms with an exact WebAssembly SIMD counterpart (src/arm64/neon.js and Arm64Cpu.simdVector are the reference). Vector
// registers live in the CPU's slot of the state memory; a 64-bit (Q = 0) result clears the upper half, as the interpreter's setLanes and vWriteBig do. Floating
// point, scalar forms, widening / narrowing / pairwise / across-lanes forms and the rest return null: the interpreter.
const LOW = [255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 0], ZERO = new Array(16).fill(0);
const vreg = n => SV + 16 * n;
/** Vd <- the v128 that `value()` pushes (its upper half cleared for a 64-bit form). */
function vwrite(e, rd, q, value) { e.get(P_S); value(); if (!q) e.v128(LOW).simdOp(V.and); e.simd(SIMD.v128_store, 1, vreg(rd)); return OK; }
const vread = (e, n) => e.get(P_S).simd(SIMD.v128_load, 1, vreg(n));
const elemShift = imm5 => imm5 & 1 ? 0 : imm5 & 2 ? 1 : imm5 & 4 ? 2 : 3;
const bytesOf = big => { const out = []; for (let i = 0; i < 16; i++) out.push(Number((big >> BigInt(8 * i)) & 0xffn)); return out; };
const replicate = (value, esize) => { let out = 0n; for (let i = 0; i < 64; i += esize) out |= value << BigInt(i); return out & M64; };
const THREE_SAME = {   // `${u}${opcode}`: the operator by lane size
  '016': V.add, '116': V.sub, '117': V.eq, '06': V.gt_s, '07': V.ge_s, '16': V.gt_u, '17': V.ge_u, '019': V.mul,
  '012': V.max_s, '112': V.max_u, '013': V.min_s, '113': V.min_u, '01': V.add_sat_s, '11': V.add_sat_u, '05': V.sub_sat_s, '15': V.sub_sat_u, '12': V.avgr_u,
};
function simdData(e, word) {
  const top = field(word, 24, 8);
  const fmov = fmovGeneral(e, word); if (fmov !== undefined) return fmov;
  if ((top & 0b01011111) === 0b00011110 || (top & 0b01011111) === 0b00011111) return null;   // scalar floating point: the interpreter
  const q = bit(word, 30), u = bit(word, 29), rd = word & 31, rn = field(word, 5, 5), rm = field(word, 16, 5), top5 = field(word, 24, 5);
  if (bit(word, 31)) return null;
  if (top5 === 0b01110) {
    if (bit(word, 21) && bit(word, 10)) return threeSameV(e, word, q, u, rd, rn, rm);
    if (bit(word, 21) && field(word, 10, 2) === 0b10 && field(word, 17, 4) === 0) return twoRegMiscV(e, word, q, u, rd, rn);
    if (bit(word, 21)) return null;
    if (bit(word, 10) && field(word, 11, 4) === 0 && !u && !bit(word, 15)) {   // DUP (element)
      const imm5 = field(word, 16, 5), shift = elemShift(imm5), index = imm5 >> (shift + 1);
      if ((imm5 & 15) === 0 || (shift === 3 && !q)) return null;
      return vwrite(e, rd, q, () => { vread(e, rn).lane(V.extract[shift], index).simdOp(V.splat[shift]); });
    }
    if (field(word, 10, 2) === 0b10 && !u) return permuteV(e, word, q, rd, rn, rm);
    if (!bit(word, 10) && u && field(word, 22, 2) === 0) {   // EXT
      const index = field(word, 11, 4); if (bit(word, 15) || (!q && index > 7)) return null;
      const lanes = []; for (let i = 0; i < 16; i++) { const k = index + i; lanes.push(q ? k : k < 8 ? k : k < 16 ? 16 + k - 8 : 0); }
      return vwrite(e, rd, q, () => { vread(e, rn); vread(e, rm); e.shuffle(lanes); });
    }
    if (!bit(word, 10) && !u && field(word, 22, 2) === 0 && field(word, 10, 2) === 0) return tableV(e, word, q, rd, rn, rm);
    if (bit(word, 10) && u && q && !bit(word, 15)) {   // INS (element)
      const imm5 = field(word, 16, 5), imm4 = field(word, 11, 4), shift = elemShift(imm5), eb = 1 << shift; if ((imm5 & 15) === 0) return null;
      const dst = imm5 >> (shift + 1), src = imm4 >> shift, at = vreg(rd) + dst * eb, from = vreg(rn) + src * eb;
      const [ld, st] = [[OP.i32_load8_u, OP.i32_store8], [OP.i32_load16_u, OP.i32_store16], [OP.i32_load, OP.i32_store], [OP.i64_load, OP.i64_store]][shift];
      e.get(P_S).get(P_S).mem(ld, 1, from).mem(st, 1, at); return OK;
    }
    if (((word & 0xbfe0fc00) >>> 0) === 0x0e000c00) {   // DUP (general)
      const imm5 = field(word, 16, 5), shift = elemShift(imm5); if ((imm5 & 15) === 0 || (shift === 3 && !q)) return null;
      return vwrite(e, rd, q, () => { e.x(rn); if (shift < 3) e.op(OP.i32_wrap_i64); e.simdOp(V.splat[shift]); });
    }
    if (((word & 0xbfe0fc00) >>> 0) === 0x0e002c00) {   // SMOV
      const imm5 = field(word, 16, 5), shift = imm5 & 1 ? 0 : imm5 & 2 ? 1 : 2, index = imm5 >> (shift + 1); if ((imm5 & 7) === 0 || (shift === 2 && !q)) return null;
      e.get(P_S).mem([OP.i64_load8_s, OP.i64_load16_s, OP.i64_load32_s][shift], 1, vreg(rn) + index * (1 << shift)); if (!q) e.i64(M32).op(OP.i64_and); e.setx(rd); return OK;
    }
    if (((word & 0xffe0fc00) >>> 0) === 0x4e001c00) {   // INS (general)
      const imm5 = field(word, 16, 5), shift = elemShift(imm5), index = imm5 >> (shift + 1); if ((imm5 & 15) === 0) return null;
      e.get(P_S).x(rn).mem([OP.i64_store8, OP.i64_store16, OP.i64_store32, OP.i64_store][shift], 1, vreg(rd) + index * (1 << shift)); return OK;
    }
    if (((word & 0xbfe0fc00) >>> 0) === 0x0e003c00) {   // UMOV
      const imm5 = field(word, 16, 5), shift = elemShift(imm5), index = imm5 >> (shift + 1); if ((imm5 & 15) === 0 || (shift === 3) !== !!q) return null;
      e.get(P_S).mem([OP.i64_load8_u, OP.i64_load16_u, OP.i64_load32_u, OP.i64_load][shift], 1, vreg(rn) + index * (1 << shift)).setx(rd); return OK;
    }
    return null;
  }
  if (top5 === 0b01111 && bit(word, 10)) {
    if (field(word, 19, 4) !== 0) return shiftImmediateV(e, word, q, u, rd, rn);
    if (((word & 0x9ff80400) >>> 0) === 0x0f000400 && !bit(word, 11)) return modifiedImmediate(e, word, q, rd);
  }
  return null;
}
function threeSameV(e, word, q, u, rd, rn, rm) {
  const size = field(word, 22, 2), opcode = field(word, 11, 5);
  if (opcode === 0b00011) {   // AND BIC ORR ORN EOR BSL BIT BIF
    const op = u * 4 + size;
    return vwrite(e, rd, q, () => {
      if (op === 5) { vread(e, rn); vread(e, rm); vread(e, rd); e.simdOp(V.bitselect); return; }   // BSL: (n & d) | (m & ~d)
      if (op === 6) { vread(e, rn); vread(e, rd); vread(e, rm); e.simdOp(V.bitselect); return; }   // BIT: (n & m) | (d & ~m)
      if (op === 7) { vread(e, rd); vread(e, rn); vread(e, rm); e.simdOp(V.bitselect); return; }   // BIF: (d & m) | (n & ~m)
      vread(e, rn); vread(e, rm);
      if (op === 3) e.simdOp(V.not).simdOp(V.or); else e.simdOp([V.and, V.andnot, V.or, null, V.xor][op]);
    });
  }
  if (size === 3 && !q) return null;
  const key = `${u}${opcode}`;
  if (key === '017') { const eq = V.eq[size]; return vwrite(e, rd, q, () => { vread(e, rn); vread(e, rm); e.simdOp(V.and).v128(ZERO).simdOp(eq).simdOp(V.not); }); }   // CMTST
  if (key === '018' || key === '118') {   // MLA / MLS
    const mul = V.mul[size]; if (!mul) return null;
    return vwrite(e, rd, q, () => { vread(e, rd); vread(e, rn); vread(e, rm); e.simdOp(mul).simdOp(key === '018' ? V.add[size] : V.sub[size]); });
  }
  const code = THREE_SAME[key]?.[size]; if (!code) return null;
  return vwrite(e, rd, q, () => { vread(e, rn); vread(e, rm); e.simdOp(code); });
}
function twoRegMiscV(e, word, q, u, rd, rn) {
  const size = field(word, 22, 2), opcode = field(word, 12, 5), key = `${u}${opcode}`;
  if (size === 3 && !q) return null;
  const reverse = { '00': 8, '10': 4, '01': 2 }[key];   // REV64 / REV32 / REV16: the elements of each container, reversed
  if (reverse) {
    const eb = 1 << size; if (eb >= reverse) return null;
    const lanes = []; for (let k = 0; k < 16; k++) { const base = k - (k % reverse), o = k % reverse, i = Math.floor(o / eb), j = o % eb; lanes.push(base + (reverse / eb - 1 - i) * eb + j); }
    return vwrite(e, rd, q, () => { vread(e, rn); vread(e, rn); e.shuffle(lanes); });
  }
  if (key === '05') { if (size) return null; return vwrite(e, rd, q, () => { vread(e, rn).simdOp(V.popcnt[0]); }); }   // CNT
  if (key === '15') { if (size) return null; return vwrite(e, rd, q, () => { vread(e, rn).simdOp(V.not); }); }         // NOT (MVN)
  if (key === '111' || key === '011') return vwrite(e, rd, q, () => { vread(e, rn).simdOp(key === '111' ? V.neg[size] : V.abs[size]); });   // NEG / ABS
  const zero = { '09': V.eq, '08': V.gt_s, '18': V.ge_s, '19': V.le_s, '010': V.lt_s }[key];   // CMEQ / CMGT / CMGE / CMLE / CMLT against zero
  if (zero) return vwrite(e, rd, q, () => { vread(e, rn).v128(ZERO).simdOp(zero[size]); });
  return null;
}
function permuteV(e, word, q, rd, rn, rm) {   // UZP1/2, TRN1/2, ZIP1/2 as byte shuffles of the interpreter's lane lists
  const size = field(word, 22, 2), opcode = field(word, 12, 3);
  if (bit(word, 15) || (size === 3 && !q) || opcode === 0 || opcode === 4) return null;
  const eb = 1 << size, count = (q ? 16 : 8) / eb, half = count / 2, src = [];   // src: [register (0 = n, 1 = m), lane] per output lane
  if (opcode === 1 || opcode === 5) { const part = opcode === 5 ? 1 : 0; for (let i = 0; i < count; i++) { const k = 2 * i + part; src.push(k < count ? [0, k] : [1, k - count]); } }
  else if (opcode === 2 || opcode === 6) { const part = opcode === 6 ? 1 : 0; for (let i = 0; i < half; i++) src.push([0, 2 * i + part], [1, 2 * i + part]); }
  else { const base = opcode === 7 ? half : 0; for (let i = 0; i < half; i++) src.push([0, base + i], [1, base + i]); }
  const lanes = new Array(16).fill(0); src.forEach(([reg, lane], i) => { for (let j = 0; j < eb; j++) lanes[i * eb + j] = reg * 16 + lane * eb + j; });
  return vwrite(e, rd, q, () => { vread(e, rn); vread(e, rm); e.shuffle(lanes); });
}
function tableV(e, word, q, rd, rn, rm) {   // TBL / TBX with 1-4 table registers: a swizzle per table register, the index rebased by 16 for each
  const len = field(word, 13, 2) + 1, tbx = bit(word, 12); if (bit(word, 15)) return null;
  return vwrite(e, rd, q, () => {
    for (let k = 0; k < len; k++) { vread(e, (rn + k) % 32); vread(e, rm); if (k) e.v128(new Array(16).fill(16 * k)).simdOp(V.sub[0]); e.simdOp(V.swizzle); if (k) e.simdOp(V.or); }
    if (tbx) { vread(e, rd); vread(e, rm).v128(new Array(16).fill(16 * len)).simdOp(V.lt_u[0]); e.simdOp(V.bitselect); }   // TBX: the old byte where the index is out of range
  });
}
function shiftImmediateV(e, word, q, u, rd, rn) {   // SHL, SSHR, USHR, SSRA, USRA
  const immh = field(word, 19, 4), immhb = (immh << 3) | field(word, 16, 3), opcode = field(word, 11, 5), size = immh & 8 ? 3 : immh & 4 ? 2 : immh & 2 ? 1 : 0, esize = 8 << size;
  if (size === 3 && !q) return null;
  const left = immhb - esize, right = 2 * esize - immhb, key = `${u}${opcode}`;
  const shifted = signed => { if (signed) vread(e, rn).i32(Math.min(right, esize - 1)).simdOp(V.shr_s[size]); else if (right >= esize) e.v128(ZERO); else vread(e, rn).i32(right).simdOp(V.shr_u[size]); };
  if (key === '010') return vwrite(e, rd, q, () => { vread(e, rn).i32(left).simdOp(V.shl[size]); });
  if (key === '00' || key === '10') return vwrite(e, rd, q, () => shifted(key === '00'));
  if (key === '02' || key === '12') return vwrite(e, rd, q, () => { vread(e, rd); shifted(key === '02'); e.simdOp(V.add[size]); });
  return null;
}
function modifiedImmediate(e, word, q, rd) {   // MOVI / MVNI / ORR / BIC (vector, immediate), FMOV (vector, immediate): Arm64Cpu.simdVector's constants
  const op = bit(word, 29), cmode = field(word, 12, 4), imm8 = (field(word, 16, 3) << 5) | field(word, 5, 5), rep = (v, esize) => replicate(BigInt(v >>> 0), esize);
  const shifted32 = cmode < 8, shifted16 = cmode >= 8 && cmode < 12;
  if ((shifted32 || shifted16) && (cmode & 1)) {
    const mask = shifted32 ? rep(imm8 << (8 * (cmode >> 1)), 32) : rep(imm8 << (8 * ((cmode >> 1) & 1)), 16), wide = bytesOf(mask | (mask << 64n));
    return vwrite(e, rd, q, () => { vread(e, rd).v128(wide).simdOp(op ? V.andnot : V.or); });
  }
  let imm64;
  if (shifted32) imm64 = rep(imm8 << (8 * (cmode >> 1)), 32);
  else if (shifted16) imm64 = rep(imm8 << (8 * ((cmode >> 1) & 1)), 16);
  else if (cmode === 12) imm64 = rep((imm8 << 8) | 0xff, 32);
  else if (cmode === 13) imm64 = rep((imm8 << 16) | 0xffff, 32);
  else if (cmode === 14 && !op) imm64 = rep(imm8, 8);
  else if (cmode === 14) { imm64 = 0n; for (let i = 0; i < 8; i++) if ((imm8 >> i) & 1) imm64 |= 0xffn << BigInt(8 * i); }
  else {
    const a = (imm8 >> 7) & 1, b = (imm8 >> 6) & 1, cdefgh = imm8 & 0x3f;
    if (!op) imm64 = rep((a << 31) | ((b ? 0b011111 : 0b100000) << 25) | (cdefgh << 19), 32);
    else { if (!q) return null; imm64 = (BigInt(a) << 63n) | (BigInt(b ? 0xff : 0x100) << 54n) | (BigInt(cdefgh) << 48n); }
    return vwrite(e, rd, q, () => { e.v128(bytesOf(imm64 | (imm64 << 64n))); });
  }
  if (op && cmode !== 14) imm64 = ~imm64 & M64;
  return vwrite(e, rd, q, () => { e.v128(bytesOf(imm64 | (imm64 << 64n))); });
}
function structures(e, word) {   // LD1-LD4 / ST1-ST4 (multiple structures), with post-index
  const q = bit(word, 30), l = bit(word, 22), post = bit(word, 23), rm = field(word, 16, 5), opcode = field(word, 12, 4), size = field(word, 10, 2), rn = field(word, 5, 5), rt = word & 31;
  const forms = { 0b0000: [4, 4], 0b0010: [4, 1], 0b0100: [3, 3], 0b0110: [3, 1], 0b0111: [1, 1], 0b1000: [2, 2], 0b1010: [2, 1] }[opcode];
  if (!forms || bit(word, 21) || (!post && rm !== 0) || (forms[1] > 1 && size === 3 && !q)) return null;
  const [regs, interleave] = forms, regBytes = q ? 16 : 8, total = regs * regBytes, eb = 1 << size;
  e.xsp(rn).tee(T1).access(total, !l);
  if (interleave === 1) { for (let r = 0; r < regs; r++) if (l) e.loadVector((rt + r) % 32, regBytes, r * regBytes); else e.storeVector((rt + r) % 32, regBytes, r * regBytes); }
  else {
    if (l) for (let r = 0; r < regs; r++) e.get(P_S).v128(ZERO).simd(SIMD.v128_store, 1, vreg((rt + r) % 32));
    const [load, store] = [[OP.i64_load8_u, OP.i64_store8], [OP.i64_load16_u, OP.i64_store16], [OP.i64_load32_u, OP.i64_store32], [OP.i64_load, OP.i64_store]][size];
    let offset = 0;
    for (let k = 0; k < regBytes / eb; k++) for (let r = 0; r < regs; r++, offset += eb) {
      const lane = vreg((rt + r) % 32) + k * eb;
      if (l) e.get(P_S).get(TO).mem(load, 0, 4096 + offset).mem(store, 1, lane); else e.get(TO).get(P_S).mem(load, 1, lane).mem(store, 0, 4096 + offset);
    }
  }
  if (post) {
    if (rm === 31) e.get(T1).i64(total).op(OP.i64_add);
    else { e.x(rm).i64(1n << 52n).op(OP.i64_ge_u).bailIf(); e.get(T1).x(rm).op(OP.i64_add); }   // the interpreter adds Numbers: exact below 2^52
    e.setxsp(rn);
  }
  return OK;
}

// ---- regions
/** Classifies the instruction `word` at `at` for a region: the result of emitInsn into a scratch emitter (null: not translated). */
function classify(base, word, at) { const e = new Emitter(base); return emitInsn(e, word, at); }
/** Does the tier translate this instruction word (at address `at`)? The tests' coverage measure. */
export function translatable(word, at = 0x10000) { return classify(0n, word >>> 0, at) !== null; }

function discover(tier, entry) {
  const mem = tier.memory, scanned = new Map(), leaders = new Set([entry]), work = [entry], near = pc => Math.abs(pc - entry) <= WINDOW;
  while (work.length && scanned.size < MAX_INSNS) {
    let pc = work.pop();
    for (;;) {
      if (scanned.has(pc) || !mem.contains(pc, 4) || scanned.size >= MAX_INSNS) break;
      const word = mem.fetch32(pc), info = classify(tier.base, word, pc);
      scanned.set(pc, { word, info });
      if (!info) break;
      if (info.kind === 'op') { pc += 4; continue; }
      const next = [];
      if (info.kind === 'jump') next.push(info.target); else if (info.kind === 'cond') next.push(info.target, pc + 4); else if (info.kind === 'call') next.push(info.target, pc + 4);   // a call: the callee and the return point
      for (const t of next) if (near(t) && !leaders.has(t)) { leaders.add(t); work.push(t); }
      break;
    }
  }
  // blocks: from each leader that starts with a translated instruction, up to a terminator, an untranslated instruction or the next leader
  let starts = [...leaders].filter(pc => scanned.get(pc)?.info);
  if (starts.length > MAX_BLOCKS) starts = starts.sort((a, b) => Math.abs(a - entry) - Math.abs(b - entry)).slice(0, MAX_BLOCKS);   // the blocks nearest the entry
  starts.sort((a, b) => a - b);
  const isStart = new Set(starts), blocks = [];
  for (const start of starts) {
    const insns = []; let pc = start, end;
    for (;;) {
      const s = scanned.get(pc);
      if (!s) { end = { kind: 'fall', target: pc }; break; }
      if (!s.info) { end = { kind: 'bail', pc }; break; }
      insns.push({ pc, word: s.word });
      if (s.info.kind !== 'op') { end = { kind: 'term' }; break; }
      pc += 4;
      if (isStart.has(pc)) { end = { kind: 'fall', target: pc }; break; }
    }
    blocks.push({ start, insns, end });
  }
  return blocks;
}

function compileRegion(tier, blocks) {
  const e = new Emitter(tier.base), index = new Map(blocks.map((b, i) => [b.start, i])), n = blocks.length;
  // return points: the instruction after a call inside the region, where a RET (any indirect branch) lands without leaving the function (at most 24, the nearest first)
  const returns = blocks.filter(b => b.end.kind === 'term' && b.insns.length && bit(b.insns[b.insns.length - 1].word, 31) && (b.insns[b.insns.length - 1].word & 0x7c000000) === 0x14000000)
    .map(b => b.insns[b.insns.length - 1].pc + 4).filter(pc => index.has(pc)).slice(0, 24);
  e.open(OP.block); e.open(OP.loop);
  for (let i = 0; i < n; i++) e.open(OP.block);
  e.get(P_ENTRY).brTable(blocks.map((_, i) => i), 0);
  const goto = (target, len, k, inIf) => {
    e.get(CNT).i32(len).op(OP.i32_add).set(CNT);
    const j = index.get(target);
    if (j === undefined) { e.f64(target).set(NPC).i32(0).set(REASON).br(EXIT); return; }
    if (!inIf && j === k + 1) return;   // the next block follows
    e.i32(j).set(P_ENTRY).br(TOP);
  };
  blocks.forEach((block, k) => {
    e.end();   // block k's label: its code follows
    const len = block.insns.length;
    e.get(CNT).i32(len).op(OP.i32_add).get(P_ALLOWED).op(OP.i32_gt_u).open(OP.if); e.f64(block.start).set(NPC).i32(1).set(REASON).br(EXIT); e.end();
    let info = null;
    block.insns.forEach(({ pc, word }, i) => { e.k = i; e.pc = pc; info = emitInsn(e, word, pc); if (!info) throw new Error(`ARM64 tier: 0x${word.toString(16)} at 0x${pc.toString(16)} classified but not emitted`); });
    const last = block.insns[len - 1];
    if (block.end.kind === 'bail') { e.k = len; e.pc = block.end.pc; e.bail(); return; }
    if (block.end.kind === 'fall') { goto(block.end.target, len, k, false); return; }
    switch (info.kind) {
      case 'jump': goto(info.target, len, k, false); break;
      case 'call': goto(info.target, len, k, false); break;   // X30 is set: a callee in the region is entered directly
      case 'cond': e.open(OP.if); goto(info.target, len, k, true); e.end(); goto(last.pc + 4, len, k, false); break;
      case 'indirect':
        e.get(CNT).i32(len).op(OP.i32_add).set(CNT);
        for (const pc of returns) { e.get(NPC).f64(pc).op(OP.f64_eq).open(OP.if); e.i32(index.get(pc)).set(P_ENTRY).br(TOP); e.end(); }
        e.i32(0).set(REASON).br(EXIT); break;
      default: throw new Error('ARM64 tier: a block ends with a straight-line instruction');
    }
  });
  e.end(); e.end();   // loop, exit block
  // prologue (loads) and epilogue (stores) around the body
  const pro = new Code(), epi = new Code();
  let writeMask = 0;
  for (let r = 0; r < 32; r++) {
    if (e.reads[r] || e.writes[r]) pro.get(P_S).mem(OP.i64_load, 1, SX + 8 * r).set(X(r));
    if (e.writes[r]) { epi.get(P_S).get(X(r)).mem(OP.i64_store, 1, SX + 8 * r); writeMask |= 1 << r; }
  }
  if (e.flagsUsed) for (const [local, at] of [[LN, SN], [LZ, SZ], [LC, SC], [LV, SVF]]) pro.get(P_S).mem(OP.i32_load, 1, at).set(local);
  if (e.flagsWritten) for (const [local, at] of [[LN, SN], [LZ, SZ], [LC, SC], [LV, SVF]]) epi.get(P_S).get(local).mem(OP.i32_store, 1, at);
  epi.get(P_S).get(CNT).mem(OP.i32_store, 1, SCNT).get(P_S).get(REASON).mem(OP.i32_store, 1, SREASON).get(NPC);
  const body = [...pro.b]; for (let i = 0; i < e.b.length; i++) body.push(e.b[i]); for (const b of epi.b) body.push(b);
  return { bytes: moduleBytes(LOCALS, body), writeMask };
}

// ---- the tier of one process memory
export class Arm64Tier {
  /** The tier of `memory` (src/arm64/memory.js), or null when the memory or the engine cannot run it. */
  static create(memory, options = {}) { if (!memory.wasmMemory || !tierSupported()) return null; return new Arm64Tier(memory, options); }
  constructor(memory, { threshold = 32 } = {}) {
    this.memory = memory; this.base = BigInt(memory.base); this.threshold = threshold;
    this.bitmapBytes = Math.ceil(memory.maxBytes / PAGE) + 16; this.slotsAt = Math.ceil(this.bitmapBytes / SLOT) * SLOT;
    const pages = Math.ceil((this.slotsAt + MAX_SLOTS * SLOT) / 65536);
    this.state = new WebAssembly.Memory({ initial: pages, maximum: pages });
    const buffer = this.state.buffer; this.bytes = new Uint8Array(buffer); this.i32 = new Int32Array(buffer); this.big = new BigUint64Array(buffer); this.f64 = new Float64Array(buffer);
    this.sizeGlobal = new WebAssembly.Global({ value: 'i64', mutable: true }, BigInt(memory.size));
    this.imports = { m: { g: memory.wasmMemory, s: this.state, z: this.sizeGlobal } };
    this.entries = new Map(); this.heat = new Map(); this.pages = new Map(); this.free = []; this.nextSlot = 0; this.bailWords = new Map(); this.watchedPages = new Set();
    this.released = new FinalizationRegistry(index => this.free.push(index));
    this.counters = { regions: 0, blocks: 0, instructions: 0, failed: 0, compileMs: 0, bytes: 0, entries: 0, executed: 0, invalidated: 0 };
    const cache = memory.decodeCache; if (cache) for (const page of cache.pages.keys()) this.mark(page);
    for (const [first, end] of memory.watchedPages ?? []) this.watch(first, end);
  }
  /** A register-file slot for `cpu` (its vector registers become a view of it), or -1 when every slot is taken. */
  attach(cpu) {
    const index = this.free.length ? this.free.pop() : this.nextSlot < MAX_SLOTS ? this.nextSlot++ : -1;
    if (index < 0) return -1;
    const S = this.slotsAt + index * SLOT; this.bytes.fill(0, S, S + SLOT);
    this.released.register(cpu, index);   // a CPU that is gone (a native thread that ended) gives its slot back
    const vbuf = new Uint8Array(this.state.buffer, S + SV, 512); vbuf.set(cpu.vbuf); cpu.vbuf = vbuf; cpu.vview = new DataView(this.state.buffer, S + SV, 512); cpu.vwords = undefined;
    return S;
  }
  resized() { this.sizeGlobal.value = BigInt(this.memory.size); }
  mark(page) { if (page >= 0 && page < this.bitmapBytes - 16) this.bytes[page] = 1; }
  /** Pages whose stores the interpreter must see (src/arm64/memory.js watch): translated stores to them leave first, whether or not they hold code. */
  watch(first, end) { for (let page = first; page < end; page++) { this.watchedPages.add(page); this.mark(page); } }
  /** The page's decoded instructions were dropped (a write, mprotect, munmap): its translations go too. */
  dropPage(page) {
    if (page >= 0 && page < this.bitmapBytes - 16) this.bytes[page] = this.watchedPages.has(page) ? 1 : 0;
    const regions = this.pages.get(page); if (!regions) return;
    for (const region of [...regions]) this.kill(region);
    this.pages.delete(page);
  }
  kill(region) {
    if (!region.alive) return; region.alive = false; this.counters.invalidated++;
    for (const pc of region.starts) if (this.entries.get(pc)?.region === region) this.entries.delete(pc);
    for (const page of region.pages) this.pages.get(page)?.delete(region);
  }
  stats() { return { ...this.counters, live: this.entries.size }; }
  /** Where translated code handed over to the interpreter (an instruction not translated, a fault, a store to a code page, the budget), by instruction word: the
   *  tier's coverage report (`top` most frequent). */
  noteBail(pc) { this.counters.bails = (this.counters.bails ?? 0) + 1; if (this.memory.contains(pc, 4)) { const word = this.memory.fetch32(pc); this.bailWords.set(word, (this.bailWords.get(word) ?? 0) + 1); if (this.bailWords.size > 4096) this.bailWords.clear(); } }
  bailReport(top = 10) { return [...this.bailWords].sort((a, b) => b[1] - a[1]).slice(0, top).map(([word, count]) => ({ word: '0x' + (word >>> 0).toString(16).padStart(8, '0'), count })); }

  /** The entry at `pc`: a translation (fn set), a failed one (fn null), or undefined while the address is not hot yet. */
  entryAt(cpu, pc) {
    const e = this.entries.get(pc); if (e !== undefined) return e;
    if (!this.memory.contains(pc, 4)) return undefined;   // a lab function, the call sentinel, an unmapped address: the interpreter's
    const h = (this.heat.get(pc) ?? 0) + 1;
    if (h < this.threshold) { if (this.heat.size > 200000) this.heat.clear(); this.heat.set(pc, h); return undefined; }
    this.heat.delete(pc);
    return this.translate(pc);
  }
  translate(entry) {
    const started = performance.now(), mem = this.memory, cache = mem.decodeCache ??= new DecodeCache(mem);
    let blocks = [];
    try { blocks = discover(this, entry); } catch { blocks = []; }   // an instruction fetch that faults: no region (the interpreter faults there)
    const region = { alive: true, starts: [], pages: new Set(), fn: null, writeMask: 0 };
    const pageOf = pc => Math.floor((pc - mem.base) / PAGE);
    if (!blocks.some(block => block.start === entry)) {   // the hot address does not start with an instruction the tier translates
      region.starts.push(entry); region.pages.add(pageOf(entry)); cache.track(entry - mem.base);
      this.register(region, null); this.counters.failed++; return this.entries.get(entry);
    }
    const { bytes, writeMask } = compileRegion(this, blocks);
    region.fn = new WebAssembly.Instance(new WebAssembly.Module(bytes), this.imports).exports.f; region.writeMask = writeMask;
    for (const block of blocks) { region.starts.push(block.start); for (const { pc } of block.insns) { region.pages.add(pageOf(pc)); cache.track(pc - mem.base); } }
    this.register(region, blocks);
    const c = this.counters; c.regions++; c.blocks += blocks.length; c.instructions += blocks.reduce((s, b) => s + b.insns.length, 0); c.bytes += bytes.length; c.compileMs += performance.now() - started;
    return this.entries.get(entry);
  }
  register(region, blocks) {
    region.starts.forEach((pc, index) => this.entries.set(pc, { region, fn: region.fn, index, pc }));
    for (const page of region.pages) { let set = this.pages.get(page); if (!set) this.pages.set(page, set = new Set()); set.add(region); }
    void blocks;
  }

  /**
   * Runs translated code from cpu.pc while it can: returns the number of instructions executed (0 when there is no translation there yet). cpu.pc, the registers,
   * flags, TPIDR_EL0, the exclusive monitor and cpu.steps are the interpreter's again when it returns. `left`: the instructions the caller's budget still allows.
   */
  enter(cpu, stopAt, left) {
    let e = this.entryAt(cpu, cpu.pc);
    if (e === undefined || e.fn === null || cpu.pc === stopAt || left <= 0 || (cpu.steps & 0xfffff) === 0xfffff) return 0;
    const S = cpu.tierSlot, i32 = this.i32, cntAt = (S + SCNT) >> 2, reasonAt = (S + SREASON) >> 2;
    let total = 0, mask = 0;
    this.syncIn(cpu, S); this.counters.entries++;
    try {
      for (;;) {
        const allowed = Math.min(left - total, 0xfffff - (cpu.steps & 0xfffff), 0x3fffffff);   // never past the instruction where the heartbeat falls
        if (allowed <= 0) break;
        const npc = e.fn(S, e.index, allowed), n = i32[cntAt];
        total += n; cpu.steps += n; mask |= e.region.writeMask; cpu.pc = npc;
        if (i32[reasonAt] !== 0) { this.noteBail(npc); break; }
        if (npc === stopAt) break;
        e = this.entryAt(cpu, npc);
        if (e === undefined || e.fn === null) break;
      }
    } finally { this.syncOut(cpu, S, mask); }
    this.counters.executed += total;
    return total;
  }
  syncIn(cpu, S) {
    const big = this.big, i32 = this.i32, b = S >> 3, w = S >> 2, x = cpu.x;
    for (let i = 0; i < 32; i++) big[b + i] = x[i];
    i32[w + (SN >> 2)] = cpu.n ? 1 : 0; i32[w + (SZ >> 2)] = cpu.z ? 1 : 0; i32[w + (SC >> 2)] = cpu.c ? 1 : 0; i32[w + (SVF >> 2)] = cpu.v ? 1 : 0;
    big[b + (STPIDR >> 3)] = cpu.tpidr;
    if (cpu.exclusive === null || cpu.exclusive === undefined) i32[w + (SEXCLV >> 2)] = 0; else { i32[w + (SEXCLV >> 2)] = 1; big[b + (SEXCL >> 3)] = BigInt(cpu.exclusive); }
    this.f64[b + (SLAST >> 3)] = -1;
  }
  syncOut(cpu, S, mask) {
    const big = this.big, i32 = this.i32, b = S >> 3, w = S >> 2, x = cpu.x;
    for (let i = 0; i < 32; i++) if (mask & (1 << i)) x[i] = big[b + i];
    cpu.n = i32[w + (SN >> 2)] !== 0; cpu.z = i32[w + (SZ >> 2)] !== 0; cpu.c = i32[w + (SC >> 2)] !== 0; cpu.v = i32[w + (SVF >> 2)] !== 0;
    const tpidr = big[b + (STPIDR >> 3)]; if (tpidr !== cpu.tpidr) cpu.tpidr = tpidr;
    cpu.exclusive = i32[w + (SEXCLV >> 2)] ? Number(big[b + (SEXCL >> 3)]) : null;
    const last = this.f64[b + (SLAST >> 3)]; if (last !== -1) cpu.lastIndirect = last;
  }
}
