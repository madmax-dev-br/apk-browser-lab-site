// A small WebAssembly binary writer for the ARM64 translation tier (src/arm64/translate.js): opcodes, LEB128 immediates, structured control with label depths, and
// the module around one function. Only what the tier emits; the encodings are the WebAssembly core specification's (binary format), memory64, multi-memory and SIMD.

export const T = { i32: 0x7f, i64: 0x7e, f64: 0x7c, v128: 0x7b, void: 0x40 };
export const OP = {
  unreachable: 0x00, block: 0x02, loop: 0x03, if: 0x04, else: 0x05, end: 0x0b, br: 0x0c, br_if: 0x0d, br_table: 0x0e, return: 0x0f, drop: 0x1a, select: 0x1b,
  local_get: 0x20, local_set: 0x21, local_tee: 0x22, global_get: 0x23,
  i32_load: 0x28, i64_load: 0x29, f64_load: 0x2b, i32_load8_s: 0x2c, i32_load8_u: 0x2d, i32_load16_s: 0x2e, i32_load16_u: 0x2f,
  i64_load8_s: 0x30, i64_load8_u: 0x31, i64_load16_s: 0x32, i64_load16_u: 0x33, i64_load32_s: 0x34, i64_load32_u: 0x35,
  i32_store: 0x36, i64_store: 0x37, f64_store: 0x39, i32_store8: 0x3a, i32_store16: 0x3b, i64_store8: 0x3c, i64_store16: 0x3d, i64_store32: 0x3e,
  i32_const: 0x41, i64_const: 0x42, f64_const: 0x44,
  i32_eqz: 0x45, i32_eq: 0x46, i32_ne: 0x47, i32_lt_s: 0x48, i32_lt_u: 0x49, i32_gt_s: 0x4a, i32_gt_u: 0x4b, i32_le_s: 0x4c, i32_le_u: 0x4d, i32_ge_s: 0x4e, i32_ge_u: 0x4f,
  i64_eqz: 0x50, i64_eq: 0x51, i64_ne: 0x52, i64_lt_s: 0x53, i64_lt_u: 0x54, i64_gt_s: 0x55, i64_gt_u: 0x56, i64_le_s: 0x57, i64_le_u: 0x58, i64_ge_s: 0x59, i64_ge_u: 0x5a,
  f64_eq: 0x61,
  i32_clz: 0x67, i32_add: 0x6a, i32_sub: 0x6b, i32_mul: 0x6c, i32_div_s: 0x6d, i32_div_u: 0x6e, i32_and: 0x71, i32_or: 0x72, i32_xor: 0x73, i32_shl: 0x74, i32_shr_s: 0x75, i32_shr_u: 0x76, i32_rotr: 0x78,
  i64_clz: 0x79, i64_add: 0x7c, i64_sub: 0x7d, i64_mul: 0x7e, i64_div_s: 0x7f, i64_div_u: 0x80, i64_and: 0x83, i64_or: 0x84, i64_xor: 0x85, i64_shl: 0x86, i64_shr_s: 0x87, i64_shr_u: 0x88, i64_rotr: 0x8a,
  i32_wrap_i64: 0xa7, i64_extend_i32_s: 0xac, i64_extend_i32_u: 0xad, f64_convert_i64_u: 0xba,
  i32_extend8_s: 0xc0, i32_extend16_s: 0xc1, i64_extend8_s: 0xc2, i64_extend16_s: 0xc3, i64_extend32_s: 0xc4,
};
export const SIMD = { v128_load: 0x00, v128_store: 0x0b, v128_const: 0x0c };
// SIMD operators by lane size (8, 16, 32, 64 bits); null where WebAssembly has none
export const V = {
  not: 77, and: 78, andnot: 79, or: 80, xor: 81, bitselect: 82,
  splat: [15, 16, 17, 18], extract: [22, 25, 27, 29], replace: [23, 26, 28, 30],
  eq: [35, 45, 55, 214], gt_s: [39, 49, 59, 217], ge_s: [43, 53, 63, 219], le_s: [41, 51, 61, 218], lt_s: [37, 47, 57, 216], gt_u: [40, 50, 60, null], ge_u: [44, 54, 64, null], lt_u: [38, 48, 58, null],
  abs: [96, 128, 160, 192], neg: [97, 129, 161, 193], popcnt: [98, null, null, null],
  shl: [107, 139, 171, 203], shr_s: [108, 140, 172, 204], shr_u: [109, 141, 173, 205],
  add: [110, 142, 174, 206], sub: [113, 145, 177, 209], mul: [null, 149, 181, null],
  add_sat_s: [111, 143, null, null], add_sat_u: [112, 144, null, null], sub_sat_s: [114, 146, null, null], sub_sat_u: [115, 147, null, null],
  min_s: [118, 150, 182, null], min_u: [119, 151, 183, null], max_s: [120, 152, 184, null], max_u: [121, 153, 185, null], avgr_u: [123, 155, null, null],
  swizzle: 14,
};

export function uleb(out, value) {
  let v = BigInt(value);
  do { let byte = Number(v & 0x7fn); v >>= 7n; if (v !== 0n) byte |= 0x80; out.push(byte); } while (v !== 0n);
}
export function sleb(out, value) {
  let v = BigInt(value);
  for (;;) { const byte = Number(v & 0x7fn); v >>= 7n; const done = (v === 0n && !(byte & 0x40)) || (v === -1n && (byte & 0x40)); out.push(done ? byte : byte | 0x80); if (done) return; }
}
const f64Bytes = value => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, value, true); return [...b]; };

/** A function body under construction: bytes, plus the open structured blocks (for br depths). */
export class Code {
  constructor() { this.b = []; this.level = 0; }
  op(...codes) { for (const c of codes) this.b.push(c); return this; }
  i32(value) { this.b.push(OP.i32_const); sleb(this.b, BigInt.asIntN(32, BigInt(value))); return this; }
  i64(value) { this.b.push(OP.i64_const); sleb(this.b, BigInt.asIntN(64, BigInt(value))); return this; }
  f64(value) { this.b.push(OP.f64_const, ...f64Bytes(value)); return this; }
  get(local) { this.b.push(OP.local_get); uleb(this.b, local); return this; }
  set(local) { this.b.push(OP.local_set); uleb(this.b, local); return this; }
  tee(local) { this.b.push(OP.local_tee); uleb(this.b, local); return this; }
  global(index) { this.b.push(OP.global_get); uleb(this.b, index); return this; }
  /** A load or store with an explicit memory index (multi-memory memarg: bit 6 of the alignment field). */
  mem(code, memory, offset, align = 0) { this.b.push(code); if (memory === 0) uleb(this.b, align); else { uleb(this.b, align | 0x40); uleb(this.b, memory); } uleb(this.b, offset); return this; }
  simd(code, memory, offset, align = 0) { this.b.push(0xfd); uleb(this.b, code); if (memory === 0) uleb(this.b, align); else { uleb(this.b, align | 0x40); uleb(this.b, memory); } uleb(this.b, offset); return this; }
  simdOp(code) { this.b.push(0xfd); uleb(this.b, code); return this; }   // a SIMD instruction without immediates
  lane(code, index) { this.b.push(0xfd); uleb(this.b, code); this.b.push(index); return this; }   // extract_lane / replace_lane
  v128(bytes) { this.b.push(0xfd); uleb(this.b, SIMD.v128_const); for (let i = 0; i < 16; i++) this.b.push(bytes[i] & 255); return this; }
  shuffle(indices) { this.b.push(0xfd); uleb(this.b, 13); for (let i = 0; i < 16; i++) this.b.push(indices[i]); return this; }
  open(kind, type = T.void) { this.b.push(kind, type); return this.level++; }   // returns the label's position (0 = outermost)
  else() { this.b.push(OP.else); return this; }
  end() { this.b.push(OP.end); this.level--; return this; }
  br(position) { this.b.push(OP.br); uleb(this.b, this.level - 1 - position); return this; }
  brTable(depths, fallback) { this.b.push(OP.br_table); uleb(this.b, depths.length); for (const d of depths) uleb(this.b, d); uleb(this.b, fallback); return this; }
  get length() { return this.b.length; }
  truncate(length, level) { this.b.length = length; this.level = level; }
}

const section = (out, id, content) => { out.push(id); uleb(out, content.length); for (let i = 0; i < content.length; i++) out.push(content[i]); };
const name = (out, text) => { const bytes = new TextEncoder().encode(text); uleb(out, bytes.length); for (const b of bytes) out.push(b); };

/**
 * One module: imports m.g (the guest memory, memory64), m.s (the tier's state memory, memory32), m.z (the guest size, mutable i64 global), and one exported function `f`
 * of type (i32 i32 i32) -> f64 with `locals` ([count, type] groups) and `body` (a Code or bytes, without the final end).
 */
export function moduleBytes(locals, body) {
  const out = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  section(out, 1, [1, 0x60, 3, T.i32, T.i32, T.i32, 1, T.f64]);
  const imports = [3]; name(imports, 'm'); name(imports, 'g'); imports.push(0x02, 0x04, 0x00); name(imports, 'm'); name(imports, 's'); imports.push(0x02, 0x00, 0x00); name(imports, 'm'); name(imports, 'z'); imports.push(0x03, T.i64, 0x01);
  section(out, 2, imports);
  section(out, 3, [1, 0]);
  const exports = [1]; name(exports, 'f'); exports.push(0x00, 0x00); section(out, 7, exports);
  const fn = []; uleb(fn, locals.length); for (const [count, type] of locals) { uleb(fn, count); fn.push(type); }
  const bytes = body instanceof Code ? body.b : body; for (let i = 0; i < bytes.length; i++) fn.push(bytes[i]); fn.push(OP.end);
  const code = [1]; uleb(code, fn.length); for (let i = 0; i < fn.length; i++) code.push(fn[i]);
  section(out, 10, code);
  return new Uint8Array(out);
}
