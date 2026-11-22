// A smali disassembler for one class of a DEX file (the Code browser, docs/CODE-BROWSER.md): the text baksmali 2.5 writes with its default options (register names pN for
// the parameters, debug information, labels named after the code address in hex, `.registers`), with --accessor-comments off and no resource-id comments. Every opcode of
// DEX 035-039 is decoded, invoke-polymorphic / invoke-custom / const-method-handle / const-method-type included, with packed and sparse switch and fill-array-data payloads,
// try/catch ranges, `.line`, `.local`, `.end local`, `.restart local`, `.prologue`, `.epilogue`, `.source`, `.param`, annotations and static field values.
//
// The text comes with its map: for each line, the dex pc of the instruction written on it (-1 for a line that is no instruction), and for each method its first and last
// line and its pc -> line table, so a breakpoint gutter can be added on top (src/code-browser-api.js).
//
// It reads through the lab's DexFile (src/apk-runtime.js) and its BinaryReader: the ids are the DexFile's own (decoded on demand), the class data, code items, debug
// information, annotations and encoded values are read here, from the bytes, without building the VM's class records. Pure module: no DOM, no process.*.

const NO_INDEX = 0xffffffff;
export const ACC = Object.freeze({ PUBLIC: 0x1, PRIVATE: 0x2, PROTECTED: 0x4, STATIC: 0x8, FINAL: 0x10, SYNCHRONIZED: 0x20, VOLATILE: 0x40, BRIDGE: 0x40, TRANSIENT: 0x80, VARARGS: 0x80, NATIVE: 0x100,
  INTERFACE: 0x200, ABSTRACT: 0x400, STRICT: 0x800, SYNTHETIC: 0x1000, ANNOTATION: 0x2000, ENUM: 0x4000, CONSTRUCTOR: 0x10000, DECLARED_SYNCHRONIZED: 0x20000 });
// dexlib2's AccessFlags, in its order: [name, bit, valid for class / method / field]
const FLAGS = [['public', 0x1, 'cmf'], ['private', 0x2, 'cmf'], ['protected', 0x4, 'cmf'], ['static', 0x8, 'cmf'], ['final', 0x10, 'cmf'], ['synchronized', 0x20, 'm'], ['volatile', 0x40, 'f'],
  ['bridge', 0x40, 'm'], ['transient', 0x80, 'f'], ['varargs', 0x80, 'm'], ['native', 0x100, 'm'], ['interface', 0x200, 'c'], ['abstract', 0x400, 'cm'], ['strictfp', 0x800, 'm'],
  ['synthetic', 0x1000, 'cmf'], ['annotation', 0x2000, 'c'], ['enum', 0x4000, 'cf'], ['constructor', 0x10000, 'm'], ['declared-synchronized', 0x20000, 'm']];
/** The access flags of a class ('c'), method ('m') or field ('f') as smali writes them, each followed by a space. */
export function accessFlagsText(flags, kind) { let out = ''; for (const [name, bit, valid] of FLAGS) if ((flags & bit) && valid.includes(kind)) out += name + ' '; return out; }

// ---- opcodes ---------------------------------------------------------------------------------------------------------------------------------------------------------
// reference kinds: s string, t type, f field, m method, p proto, h method handle, c call site
export const OPCODES = new Array(256).fill(null);
{
  const def = (op, name, fmt, ref = null) => { OPCODES[op] = { op, name, fmt, ref }; };
  [[0x00, 'nop', '10x'], [0x01, 'move', '12x'], [0x02, 'move/from16', '22x'], [0x03, 'move/16', '32x'], [0x04, 'move-wide', '12x'], [0x05, 'move-wide/from16', '22x'], [0x06, 'move-wide/16', '32x'],
    [0x07, 'move-object', '12x'], [0x08, 'move-object/from16', '22x'], [0x09, 'move-object/16', '32x'], [0x0a, 'move-result', '11x'], [0x0b, 'move-result-wide', '11x'], [0x0c, 'move-result-object', '11x'],
    [0x0d, 'move-exception', '11x'], [0x0e, 'return-void', '10x'], [0x0f, 'return', '11x'], [0x10, 'return-wide', '11x'], [0x11, 'return-object', '11x'],
    [0x12, 'const/4', '11n'], [0x13, 'const/16', '21s'], [0x14, 'const', '31i'], [0x15, 'const/high16', '21h'], [0x16, 'const-wide/16', '21s'], [0x17, 'const-wide/32', '31i'], [0x18, 'const-wide', '51l'],
    [0x19, 'const-wide/high16', '21h'], [0x1a, 'const-string', '21c', 's'], [0x1b, 'const-string/jumbo', '31c', 's'], [0x1c, 'const-class', '21c', 't'], [0x1d, 'monitor-enter', '11x'], [0x1e, 'monitor-exit', '11x'],
    [0x1f, 'check-cast', '21c', 't'], [0x20, 'instance-of', '22c', 't'], [0x21, 'array-length', '12x'], [0x22, 'new-instance', '21c', 't'], [0x23, 'new-array', '22c', 't'], [0x24, 'filled-new-array', '35c', 't'],
    [0x25, 'filled-new-array/range', '3rc', 't'], [0x26, 'fill-array-data', '31t'], [0x27, 'throw', '11x'], [0x28, 'goto', '10t'], [0x29, 'goto/16', '20t'], [0x2a, 'goto/32', '30t'], [0x2b, 'packed-switch', '31t'],
    [0x2c, 'sparse-switch', '31t'], [0x2d, 'cmpl-float', '23x'], [0x2e, 'cmpg-float', '23x'], [0x2f, 'cmpl-double', '23x'], [0x30, 'cmpg-double', '23x'], [0x31, 'cmp-long', '23x'],
    [0xfa, 'invoke-polymorphic', '45cc', 'm'], [0xfb, 'invoke-polymorphic/range', '4rcc', 'm'], [0xfc, 'invoke-custom', '35c', 'c'], [0xfd, 'invoke-custom/range', '3rc', 'c'],
    [0xfe, 'const-method-handle', '21c', 'h'], [0xff, 'const-method-type', '21c', 'p']].forEach(args => def(...args));
  ['eq', 'ne', 'lt', 'ge', 'gt', 'le'].forEach((c, i) => { def(0x32 + i, `if-${c}`, '22t'); def(0x38 + i, `if-${c}z`, '21t'); });
  ['', '-wide', '-object', '-boolean', '-byte', '-char', '-short'].forEach((s, i) => { def(0x44 + i, `aget${s}`, '23x'); def(0x4b + i, `aput${s}`, '23x'); def(0x52 + i, `iget${s}`, '22c', 'f'); def(0x59 + i, `iput${s}`, '22c', 'f'); def(0x60 + i, `sget${s}`, '21c', 'f'); def(0x67 + i, `sput${s}`, '21c', 'f'); });
  ['virtual', 'super', 'direct', 'static', 'interface'].forEach((k, i) => { def(0x6e + i, `invoke-${k}`, '35c', 'm'); def(0x74 + i, `invoke-${k}/range`, '3rc', 'm'); });
  ['neg-int', 'not-int', 'neg-long', 'not-long', 'neg-float', 'neg-double', 'int-to-long', 'int-to-float', 'int-to-double', 'long-to-int', 'long-to-float', 'long-to-double', 'float-to-int', 'float-to-long',
    'float-to-double', 'double-to-int', 'double-to-long', 'double-to-float', 'int-to-byte', 'int-to-char', 'int-to-short'].forEach((name, i) => def(0x7b + i, name, '12x'));
  const ints = ['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'ushr'], fl = ['add', 'sub', 'mul', 'div', 'rem'];
  [...ints.map(n => `${n}-int`), ...ints.map(n => `${n}-long`), ...fl.map(n => `${n}-float`), ...fl.map(n => `${n}-double`)].forEach((name, i) => { def(0x90 + i, name, '23x'); def(0xb0 + i, `${name}/2addr`, '12x'); });
  ['add-int/lit16', 'rsub-int', 'mul-int/lit16', 'div-int/lit16', 'rem-int/lit16', 'and-int/lit16', 'or-int/lit16', 'xor-int/lit16'].forEach((name, i) => def(0xd0 + i, name, '22s'));
  ['add-int', 'rsub-int', 'mul-int', 'div-int', 'rem-int', 'and-int', 'or-int', 'xor-int', 'shl-int', 'shr-int', 'ushr-int'].forEach((name, i) => def(0xd8 + i, `${name}/lit8`, '22b'));
}
export const FORMAT_UNITS = { '10x': 1, '12x': 1, '11n': 1, '11x': 1, '10t': 1, '20t': 2, '22x': 2, '21t': 2, '21s': 2, '21h': 2, '21c': 2, '23x': 2, '22b': 2, '22t': 2, '22s': 2, '22c': 2,
  '30t': 3, '32x': 3, '31i': 3, '31t': 3, '31c': 3, '35c': 3, '3rc': 3, '45cc': 4, '4rcc': 4, '51l': 5 };
const WIDE_CONST = new Set([0x16, 0x17, 0x18, 0x19]);
const s16 = n => (n << 16) >> 16;

/** The size in code units of the instruction (or payload) at `pc`. */
export function instructionUnits(u, pc) {
  const w = u[pc], op = w & 0xff;
  if (op === 0) {
    const ident = w >> 8;
    if (ident === 1) return (u[pc + 1] ?? 0) * 2 + 4;
    if (ident === 2) return (u[pc + 1] ?? 0) * 4 + 2;
    if (ident === 3) { const width = u[pc + 1] ?? 0, size = ((u[pc + 2] ?? 0) | ((u[pc + 3] ?? 0) << 16)) >>> 0; return Math.floor((size * width + 1) / 2) + 4; }
    return 1;
  }
  const o = OPCODES[op]; return o ? FORMAT_UNITS[o.fmt] : 1;
}

/** Decodes the instruction at `pc` of the code units `u`: { pc, units, op, name, fmt, regs, range?, lit?, target?, ref?, proto?, payload? } (an unused opcode: { unused: true }). */
export function decodeInstruction(u, pc) {
  const w = u[pc], opv = w & 0xff, n = u.length;
  if (opv === 0 && (w >> 8) >= 1 && (w >> 8) <= 3) {
    const ident = w >> 8, units = instructionUnits(u, pc);
    if (pc + units > n) return { pc, units: n - pc, op: 0, name: 'payload', fmt: 'payload', bad: true, regs: [] };
    const i32 = at => (u[at] | (u[at + 1] << 16)) | 0;
    if (ident === 1) { const size = u[pc + 1], first = i32(pc + 2), targets = []; for (let i = 0; i < size; i++) targets.push(i32(pc + 4 + i * 2)); return { pc, units, op: 0, name: 'packed-switch-payload', fmt: 'payload', regs: [], payload: { kind: 'packed', first, targets } }; }
    if (ident === 2) { const size = u[pc + 1], keys = [], targets = []; for (let i = 0; i < size; i++) { keys.push(i32(pc + 2 + i * 2)); targets.push(i32(pc + 2 + size * 2 + i * 2)); } return { pc, units, op: 0, name: 'sparse-switch-payload', fmt: 'payload', regs: [], payload: { kind: 'sparse', keys, targets } }; }
    const width = u[pc + 1], size = (u[pc + 2] | (u[pc + 3] << 16)) >>> 0, values = [];
    const byteAt = k => { const unit = u[pc + 4 + (k >> 1)]; return k & 1 ? unit >> 8 : unit & 0xff; };
    for (let i = 0; i < size; i++) {
      let v = 0n; for (let b = width - 1; b >= 0; b--) v = (v << 8n) | BigInt(byteAt(i * width + b));
      values.push(BigInt.asIntN(width * 8, v));
    }
    return { pc, units, op: 0, name: 'array-payload', fmt: 'payload', regs: [], payload: { kind: 'array', width, values } };
  }
  const o = OPCODES[opv];
  if (!o) return { pc, units: 1, op: opv, name: `unused-${opv.toString(16)}`, fmt: '10x', regs: [], unused: true };
  const units = FORMAT_UNITS[o.fmt], out = { pc, units, op: opv, name: o.name, fmt: o.fmt, ref: undefined, regs: [] };
  if (pc + units > n) return { ...out, units: n - pc, bad: true };
  const A = (w >> 8) & 0xff, a4 = (w >> 8) & 0xf, b4 = w >> 12, u1 = u[pc + 1], u2 = u[pc + 2];
  switch (o.fmt) {
    case '10x': break;
    case '12x': out.regs = [a4, b4]; break;
    case '11n': out.regs = [a4]; out.lit = BigInt((b4 << 28) >> 28); break;
    case '11x': out.regs = [A]; break;
    case '10t': out.target = pc + ((A << 24) >> 24); break;
    case '20t': out.target = pc + s16(u1); break;
    case '22x': out.regs = [A, u1]; break;
    case '21t': out.regs = [A]; out.target = pc + s16(u1); break;
    case '21s': out.regs = [A]; out.lit = BigInt(s16(u1)); break;
    case '21h': out.regs = [A]; out.lit = opv === 0x15 ? BigInt((u1 << 16) | 0) : BigInt.asIntN(64, BigInt(u1) << 48n); break;
    case '21c': out.regs = [A]; out.ref = u1; break;
    case '23x': out.regs = [A, u1 & 0xff, u1 >> 8]; break;
    case '22b': out.regs = [A, u1 & 0xff]; out.lit = BigInt(((u1 >> 8) << 24) >> 24); break;
    case '22t': out.regs = [a4, b4]; out.target = pc + s16(u1); break;
    case '22s': out.regs = [a4, b4]; out.lit = BigInt(s16(u1)); break;
    case '22c': out.regs = [a4, b4]; out.ref = u1; break;
    case '30t': out.target = pc + ((u1 | (u2 << 16)) | 0); break;
    case '32x': out.regs = [u1, u2]; break;
    case '31i': out.regs = [A]; out.lit = BigInt((u1 | (u2 << 16)) | 0); break;
    case '31t': out.regs = [A]; out.target = pc + ((u1 | (u2 << 16)) | 0); break;
    case '31c': out.regs = [A]; out.ref = (u1 | (u2 << 16)) >>> 0; break;
    case '35c': case '45cc': { const count = b4; out.ref = u1; out.regs = [u2 & 0xf, (u2 >> 4) & 0xf, (u2 >> 8) & 0xf, u2 >> 12, a4].slice(0, Math.min(count, 5)); if (count > 5) out.bad = true; if (o.fmt === '45cc') out.proto = u[pc + 3]; break; }
    case '3rc': case '4rcc': out.ref = u1; out.range = { first: u2, count: A }; out.regs = Array.from({ length: A }, (_, i) => u2 + i); if (o.fmt === '4rcc') out.proto = u[pc + 3]; break;
    case '51l': { out.regs = [A]; let v = 0n; for (let i = 4; i >= 1; i--) v = (v << 16n) | BigInt(u[pc + i]); out.lit = BigInt.asIntN(64, v); break; }
  }
  return out;
}

// ---- number and string rendering (baksmali's renderers) -------------------------------------------------------------------------------------------------------------
const hexOf = v => (v < 0n ? -v : v).toString(16);
/** LongRenderer.writeSignedIntOrLongTo: 0x1, -0x1, 0x80000000L (an L only outside the int range). */
export function signedIntOrLong(v) { v = BigInt(v); return v < 0n ? `-0x${hexOf(v)}${v < -2147483648n ? 'L' : ''}` : `0x${hexOf(v)}${v > 2147483647n ? 'L' : ''}`; }
const intText = v => { v = BigInt(v); return v < 0n ? `-0x${hexOf(v)}` : `0x${hexOf(v)}`; };   // IntegerRenderer
const longText = v => `${intText(v)}L`;   // LongRenderer.writeTo
/** StringUtils.writeEscapedString. */
export function escapeSmaliString(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x20 && c < 0x7f) { const ch = text[i]; out += ch === "'" || ch === '"' || ch === '\\' ? '\\' + ch : ch; continue; }
    if (c === 10) { out += '\\n'; continue; } if (c === 13) { out += '\\r'; continue; } if (c === 9) { out += '\\t'; continue; }
    out += '\\u' + c.toString(16).padStart(4, '0');
  }
  return out;
}
const quoted = text => `"${escapeSmaliString(text)}"`;
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer), F64 = new Float64Array(1), U64 = new BigUint64Array(F64.buffer);
export const floatOfBits = bits => { U32[0] = Number(BigInt.asUintN(32, BigInt(bits))); return F32[0]; };
export const doubleOfBits = bits => { U64[0] = BigInt.asUintN(64, BigInt(bits)); return F64[0]; };
/** [digits, exponent] of the shortest decimal (of at least two digits) that reads back as `x` (a float when `single`): x = d.ddd x 10^exponent. */
function shortestDigits(x, single) {
  let text = null;
  if (single) { for (let p = 1; p <= 9; p++) { const t = x.toExponential(p - 1); if (Math.fround(Number(t)) === x) { text = t; break; } } }
  text ??= x.toExponential();
  // Java writes at least two significant digits, the closest pair when one would do (Float.MIN_VALUE is 1.4E-45, Double.MIN_VALUE 4.9E-324); a trailing zero goes
  if (!text.split('e')[0].includes('.')) text = x.toExponential(1);
  const [mantissa, exponent] = text.split('e'), digits = mantissa.replace('-', '').replace('.', '');
  return [digits.length > 1 ? digits.replace(/0+$/, '') || '0' : digits, Number(exponent)];
}
/** Java's Double.toString / Float.toString (shortest digits; plain from 10^-3 to 10^7, else d.dddE±n). */
function javaNumberText(x, single) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity'; if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '', a = Math.abs(x), [digits, e] = shortestDigits(a, single);
  if (a >= 1e-3 && a < 1e7) {
    if (e >= 0) { const whole = digits.slice(0, e + 1).padEnd(e + 1, '0'), frac = digits.slice(e + 1) || '0'; return `${sign}${whole}.${frac}`; }
    return `${sign}0.${'0'.repeat(-e - 1)}${digits}`;
  }
  return `${sign}${digits[0]}.${digits.slice(1) || '0'}E${e}`;
}
export const javaFloatText = f => javaNumberText(Math.fround(f), true);
export const javaDoubleText = d => javaNumberText(d, false);
/** java.text.DecimalFormat("0.####################E0") of an integer (BigInt) or a double. */
function sciInteger(v) { if (v === 0n) return '0E0'; const neg = v < 0n, s = (neg ? -v : v).toString(), kept = s.replace(/0+$/, ''); return `${neg ? '-' : ''}${kept[0]}${kept.length > 1 ? '.' + kept.slice(1) : ''}E${s.length - 1}`; }
function sciDouble(d) {
  if (d === Infinity) return '∞'; if (d === -Infinity) return '-∞';
  if (d === 0) return Object.is(d, -0) ? '-0E0' : '0E0';
  const [digits, e] = shortestDigits(Math.abs(d), false), kept = digits.replace(/0+$/, '') || '0';
  return `${d < 0 ? '-' : ''}${kept[0]}${kept.length > 1 ? '.' + kept.slice(1) : ''}E${e}`;
}
function trimImprecision(text) {
  const point = text.indexOf('.'), exponent = text.indexOf('E'), zeros = text.indexOf('000');
  if (zeros > point && zeros < exponent) return text.slice(0, zeros) + text.slice(exponent);
  const nines = text.indexOf('999');
  if (nines > point && nines < exponent) return text.slice(0, nines) + text.slice(exponent);
  return text;
}
const FLOAT_NAN = 0x7fc00000, FLOAT_MAX = 0x7f7fffff, FLOAT_PI = 0x40490fdb, FLOAT_E = 0x402df854;
const DOUBLE_NAN = 0x7ff8000000000000n, DOUBLE_MAX = 0x7fefffffffffffffn, DOUBLE_PI = 0x400921fb54442d18n, DOUBLE_E = 0x4005bf0a8b145769n;
/** NumberUtils.isLikelyFloat (an int literal that reads better as a float). */
export function isLikelyFloat(value) {
  value |= 0;
  if (value === FLOAT_NAN || value === FLOAT_MAX || value === FLOAT_PI || value === FLOAT_E) return true;
  if (value === 2147483647 || value === -2147483648) return false;
  const pkg = value >> 24, type = (value >> 16) & 0xff, id = value & 0xffff;
  if ((pkg === 0x7f || pkg === 1) && type < 0x1f && id < 0xfff) return false;
  const f = floatOfBits(value); if (Number.isNaN(f)) return false;
  return trimImprecision(sciDouble(f)).length < sciInteger(BigInt(value)).length;
}
/** NumberUtils.isLikelyDouble. */
export function isLikelyDouble(value) {
  value = BigInt.asIntN(64, BigInt(value));
  const bits = BigInt.asUintN(64, value);
  if (bits === DOUBLE_NAN || bits === DOUBLE_MAX || bits === DOUBLE_PI || bits === DOUBLE_E) return true;
  if (value === 0x7fffffffffffffffn || value === -0x8000000000000000n) return false;
  const d = doubleOfBits(value); if (Number.isNaN(d)) return false;
  return trimImprecision(sciDouble(d)).length < sciInteger(value).length;
}
function floatComment(value) {
  if (!isLikelyFloat(value)) return '';
  const f = floatOfBits(value);
  const text = f === Infinity ? 'Float.POSITIVE_INFINITY' : f === -Infinity ? 'Float.NEGATIVE_INFINITY' : Number.isNaN(f) ? 'Float.NaN' : f === floatOfBits(FLOAT_MAX) ? 'Float.MAX_VALUE'
    : f === Math.fround(Math.PI) ? '(float)Math.PI' : f === Math.fround(Math.E) ? '(float)Math.E' : javaFloatText(f) + 'f';
  return `    # ${text}`;
}
function doubleComment(value) {
  if (!isLikelyDouble(value)) return '';
  const d = doubleOfBits(value);
  const text = d === Infinity ? 'Double.POSITIVE_INFINITY' : d === -Infinity ? 'Double.NEGATIVE_INFINITY' : Number.isNaN(d) ? 'Double.NaN' : d === Number.MAX_VALUE ? 'Double.MAX_VALUE'
    : d === Math.PI ? 'Math.PI' : d === Math.E ? 'Math.E' : javaDoubleText(d);
  return `    # ${text}`;
}

// ---- an indenting writer that counts lines ---------------------------------------------------------------------------------------------------------------------------
class Writer {
  constructor() { this.lines = []; this.current = ''; this.indent = 0; this.fresh = true; }
  write(text) {
    const parts = String(text).split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) { this.lines.push(this.current); this.current = ''; this.fresh = true; }
      const part = parts[i]; if (!part) continue;
      if (this.fresh) { this.current += ' '.repeat(this.indent); this.fresh = false; }
      this.current += part;
    }
  }
  get line() { return this.lines.length; }   // the 0-based line the next character goes on
  text() { return this.lines.join('\n') + (this.lines.length ? '\n' : '') + this.current; }
}

// ---- the DEX structures this needs beyond the DexFile's ids -------------------------------------------------------------------------------------------------------
const VISIBILITY = ['build', 'runtime', 'system'];
const HANDLE_TYPES = ['static-put', 'static-get', 'instance-put', 'instance-get', 'invoke-static', 'invoke-instance', 'invoke-constructor', 'invoke-direct', 'invoke-interface'];
/** Per-DEX lookups read once: the map list's call sites and method handles. */
function dexExtras(dex) {
  if (dex.smaliExtras) return dex.smaliExtras;
  const b = dex.reader, extras = { callSites: [], methodHandles: [] };
  try {
    const mapOff = b.u32(52);
    if (mapOff) {
      const size = b.u32(mapOff);
      for (let i = 0; i < size && i < 64; i++) {
        const p = mapOff + 4 + i * 12, type = b.u16(p), count = b.u32(p + 4), offset = b.u32(p + 8);
        if (type === 0x0007) for (let k = 0; k < count; k++) extras.callSites.push(b.u32(offset + k * 4));
        if (type === 0x0008) for (let k = 0; k < count; k++) extras.methodHandles.push({ type: b.u16(offset + k * 8), member: b.u16(offset + k * 8 + 4) });
      }
    }
  } catch { /* a DEX without a readable map: no call sites or method handles */ }
  Object.defineProperty(dex, 'smaliExtras', { value: extras, configurable: true });
  return extras;
}
/** An encoded_value, kept with its kind: { t, v }. */
function readValue(dex, c, depth = 0) {
  if (depth > 32) throw new Error('encoded value nesting too deep');
  const b = dex.reader, header = b.u8(c.p++), type = header & 31, arg = header >> 5;
  const raw = (signed) => { let v = 0n; for (let i = 0; i <= arg; i++) v |= BigInt(b.u8(c.p++)) << BigInt(i * 8); return signed ? BigInt.asIntN((arg + 1) * 8, v) : v; };
  switch (type) {
    case 0x00: return { t: 'byte', v: raw(true) };
    case 0x02: return { t: 'short', v: raw(true) };
    case 0x03: return { t: 'char', v: raw(false) };
    case 0x04: return { t: 'int', v: raw(true) };
    case 0x06: return { t: 'long', v: raw(true) };
    case 0x10: return { t: 'float', v: raw(false) << BigInt((3 - arg) * 8) };
    case 0x11: return { t: 'double', v: raw(false) << BigInt((7 - arg) * 8) };
    case 0x15: return { t: 'methodType', v: Number(raw(false)) };
    case 0x16: return { t: 'methodHandle', v: Number(raw(false)) };
    case 0x17: return { t: 'string', v: Number(raw(false)) };
    case 0x18: return { t: 'type', v: Number(raw(false)) };
    case 0x19: return { t: 'field', v: Number(raw(false)) };
    case 0x1a: return { t: 'method', v: Number(raw(false)) };
    case 0x1b: return { t: 'enum', v: Number(raw(false)) };
    case 0x1c: { const n = b.uleb(c), values = []; for (let i = 0; i < n; i++) values.push(readValue(dex, c, depth + 1)); return { t: 'array', v: values }; }
    case 0x1d: return { t: 'annotation', v: readAnnotationBody(dex, c, depth + 1) };
    case 0x1e: return { t: 'null', v: null };
    case 0x1f: return { t: 'boolean', v: arg === 1 };
    default: throw new Error(`unknown encoded value type 0x${type.toString(16)}`);
  }
}
function readAnnotationBody(dex, c, depth = 0) {
  const b = dex.reader, type = dex.type(b.uleb(c)), size = b.uleb(c), elements = [];
  for (let i = 0; i < size; i++) { const name = dex.string(b.uleb(c)); elements.push({ name, value: readValue(dex, c, depth) }); }
  return { type, elements };
}
function annotationSet(dex, offset) {
  if (!offset) return [];
  const b = dex.reader, size = b.u32(offset), out = [];
  for (let i = 0; i < size; i++) { const p = b.u32(offset + 4 + i * 4), visibility = b.u8(p); out.push({ visibility: VISIBILITY[visibility] ?? `visibility-${visibility}`, ...readAnnotationBody(dex, { p: p + 1 }) }); }
  return out;
}
function annotationsDirectory(dex, offset) {
  const out = { classSet: [], fields: new Map(), methods: new Map(), params: new Map() };
  if (!offset) return out;
  const b = dex.reader, fields = b.u32(offset + 4), methods = b.u32(offset + 8), params = b.u32(offset + 12);
  out.classSet = annotationSet(dex, b.u32(offset));
  let p = offset + 16;
  for (let i = 0; i < fields; i++, p += 8) out.fields.set(b.u32(p), b.u32(p + 4));
  for (let i = 0; i < methods; i++, p += 8) out.methods.set(b.u32(p), b.u32(p + 4));
  for (let i = 0; i < params; i++, p += 8) out.params.set(b.u32(p), b.u32(p + 4));
  return out;
}
function parameterAnnotations(dex, offset) {
  if (!offset) return [];
  const b = dex.reader, size = b.u32(offset), out = [];
  for (let i = 0; i < size; i++) out.push(annotationSet(dex, b.u32(offset + 4 + i * 4)));
  return out;
}
function protoText(dex, index) { const p = dex.proto(index); return `(${p.parameters.join('')})${p.result}`; }
function fieldText(dex, index) { const f = dex.field(index); return `${f.owner}->${f.name}:${f.type}`; }
function methodText(dex, index) { const m = dex.method(index); return `${m.owner}->${m.name}(${m.parameters.join('')})${m.result}`; }
function methodHandleText(dex, index) {
  const handle = dexExtras(dex).methodHandles[index]; if (!handle) return `method_handle_${index}`;
  const name = HANDLE_TYPES[handle.type] ?? `handle-${handle.type}`;
  return `${name}@${handle.type <= 3 ? fieldText(dex, handle.member) : methodText(dex, handle.member)}`;
}
/** ReferenceFormatter.writeCallSite: call_site_N("name", (proto), extra...)@Lbootstrap;->method(...) */
function callSiteText(dex, index) {
  const offset = dexExtras(dex).callSites[index]; if (offset === undefined) return `call_site_${index}`;
  const c = { p: offset }, n = dex.reader.uleb(c), values = []; for (let i = 0; i < n; i++) values.push(readValue(dex, c));
  const [handle, name, type, ...extra] = values, linker = dexExtras(dex).methodHandles[handle?.v];
  let out = `call_site_${index}(${quoted(dex.string(name.v))}, ${protoText(dex, type.v)}`;
  for (const value of extra) { const w = new Writer(); writeValue(w, dex, value); out += `, ${w.text()}`; }
  return `${out})@${linker ? methodText(dex, linker.member) : `method_handle_${handle?.v}`}`;
}
/** EncodedValueAdaptor.writeTo */
function writeValue(w, dex, value) {
  const { t, v } = value;
  switch (t) {
    case 'byte': w.write(`${intText(v)}t`); return;
    case 'short': w.write(`${intText(v)}s`); return;
    case 'char': w.write(`'${escapeSmaliString(String.fromCharCode(Number(v)))}'`); return;
    case 'int': w.write(intText(v)); return;
    case 'long': w.write(longText(v)); return;
    case 'float': w.write(`${javaFloatText(floatOfBits(v))}f`); return;
    case 'double': w.write(javaDoubleText(doubleOfBits(v))); return;
    case 'methodType': w.write(protoText(dex, v)); return;
    case 'methodHandle': w.write(methodHandleText(dex, v)); return;
    case 'string': w.write(quoted(dex.string(v))); return;
    case 'type': w.write(dex.type(v)); return;
    case 'field': w.write(fieldText(dex, v)); return;
    case 'method': w.write(methodText(dex, v)); return;
    case 'enum': w.write(`.enum ${fieldText(dex, v)}`); return;
    case 'null': w.write('null'); return;
    case 'boolean': w.write(v ? 'true' : 'false'); return;
    case 'array': {
      w.write('{'); if (!v.length) { w.write('}'); return; }
      w.write('\n'); w.indent += 4;
      v.forEach((item, i) => { if (i) w.write(',\n'); writeValue(w, dex, item); });
      w.indent -= 4; w.write('\n}'); return;
    }
    case 'annotation': w.write(`.subannotation ${v.type}\n`); writeElements(w, dex, v.elements); w.write('.end subannotation'); return;
  }
}
function writeElements(w, dex, elements) { w.indent += 4; for (const element of elements) { w.write(`${element.name} = `); writeValue(w, dex, element.value); w.write('\n'); } w.indent -= 4; }
function writeAnnotations(w, dex, annotations) {
  annotations.forEach((annotation, i) => { if (i) w.write('\n'); w.write(`.annotation ${annotation.visibility} ${annotation.type}\n`); writeElements(w, dex, annotation.elements); w.write('.end annotation\n'); });
}
/** A value as plain text (a field's initial value in the Java outline, classInfo). */
export function valueText(dex, value) { const w = new Writer(); writeValue(w, dex, value); return w.text(); }
const isDefaultValue = ({ t, v }) => t === 'null' || (t === 'boolean' && !v) || (['byte', 'short', 'char', 'int', 'long', 'float', 'double'].includes(t) && BigInt(v) === 0n);

// ---- the class model ------------------------------------------------------------------------------------------------------------------------------------------------
/**
 * The class `descriptor` of `dex` as smali sees it: { type, flags, superclass, interfaces, source, annotations, staticFields, instanceFields, directMethods, virtualMethods }.
 * Fields: { index, name, type, flags, value (encoded, or null), annotations }; methods: { index, name, parameters, result, flags, code (or null), annotations, parameterAnnotations }.
 * Returns null when the DEX has no such class.
 */
export function readClassModel(dex, descriptor) {
  const index = dex.classes?.names?.get(descriptor); if (index === undefined) return null;
  const b = dex.reader, p = dex.classDefsOffset + index * 32;
  const parent = b.u32(p + 8), sourceIndex = b.u32(p + 16), annotationsOff = b.u32(p + 20), dataOff = b.u32(p + 24), staticValuesOff = b.u32(p + 28);
  const directory = annotationsDirectory(dex, annotationsOff);
  const model = { dex, type: descriptor, flags: b.u32(p + 4), superclass: parent === NO_INDEX ? null : dex.type(parent), interfaces: dex.typeList(b.u32(p + 12)).slice(),
    source: sourceIndex === NO_INDEX ? null : dex.string(sourceIndex), annotations: directory.classSet, staticFields: [], instanceFields: [], directMethods: [], virtualMethods: [] };
  if (dataOff) {
    const c = { p: dataOff }, ns = b.uleb(c), ni = b.uleb(c), nd = b.uleb(c), nv = b.uleb(c);
    for (const [count, list] of [[ns, model.staticFields], [ni, model.instanceFields]]) {
      let idx = 0;
      for (let i = 0; i < count; i++) { idx += b.uleb(c); const flags = b.uleb(c), f = dex.field(idx); list.push({ index: idx, name: f.name, type: f.type, flags, value: null, annotations: annotationSet(dex, directory.fields.get(idx) ?? 0) }); }
    }
    for (const [count, list] of [[nd, model.directMethods], [nv, model.virtualMethods]]) {
      let idx = 0;
      for (let i = 0; i < count; i++) {
        idx += b.uleb(c); const flags = b.uleb(c), codeOff = b.uleb(c), m = dex.method(idx);
        list.push({ index: idx, name: m.name, parameters: m.parameters, result: m.result, flags, code: codeOff ? readCodeItem(dex, codeOff) : null,
          annotations: annotationSet(dex, directory.methods.get(idx) ?? 0), parameterAnnotations: parameterAnnotations(dex, directory.params.get(idx) ?? 0) });
      }
    }
  }
  if (staticValuesOff) {
    const c = { p: staticValuesOff }, n = b.uleb(c);
    for (let i = 0; i < n && i < model.staticFields.length; i++) model.staticFields[i].value = readValue(dex, c);
  }
  return model;
}
export function readCodeItem(dex, offset) {
  const b = dex.reader, registers = b.u16(offset), ins = b.u16(offset + 2), outs = b.u16(offset + 4), triesSize = b.u16(offset + 6), debugOff = b.u32(offset + 8), size = b.u32(offset + 12);
  b.check(offset + 16, size * 2);
  const units = new Uint16Array(size); for (let i = 0; i < size; i++) units[i] = b.u16(offset + 16 + i * 2);
  const tries = [];
  if (triesSize) {
    const triesAt = offset + 16 + size * 2 + (size & 1 ? 2 : 0), handlersAt = triesAt + triesSize * 8;
    for (let i = 0; i < triesSize; i++) {
      const t = triesAt + i * 8, start = b.u32(t), count = b.u16(t + 4), handlerOff = b.u16(t + 6), c = { p: handlersAt + handlerOff }, n = b.sleb(c), handlers = [];
      for (let k = 0; k < Math.abs(n); k++) { const type = dex.type(b.uleb(c)); handlers.push({ type, address: b.uleb(c) }); }
      if (n <= 0) handlers.push({ type: null, address: b.uleb(c) });
      tries.push({ start, count, handlers });
    }
  }
  return { offset, registers, ins, outs, debugOff, units, tries };
}
const wordsOf = types => types.reduce((n, t) => n + (t === 'J' || t === 'D' ? 2 : 1), 0);
const isWide = t => t === 'J' || t === 'D';
/** The debug information of a method: { parameterNames, items: [{ address, kind, ... }] } as dexlib2's DebugInfo yields it (locals tracked for .end local / .restart local). */
export function readDebugInfo(dex, method, code) {
  if (!code?.debugOff) return { parameterNames: [], items: [] };
  const b = dex.reader, c = { p: code.debugOff }, items = [];
  let line = b.uleb(c); const count = b.uleb(c), parameterNames = [];
  const nameAt = () => { const i = b.uleb(c) - 1; return i < 0 ? null : dex.string(i); };
  const typeAt = () => { const i = b.uleb(c) - 1; return i < 0 ? null : dex.type(i); };
  for (let i = 0; i < count; i++) parameterNames.push(nameAt());
  const registers = code.registers, locals = Array.from({ length: registers }, () => ({ name: null, type: null, signature: null }));
  let at = 0;
  if (!(method.flags & ACC.STATIC)) locals[at++] = { name: 'this', type: method.owner, signature: null };
  method.parameters.forEach((type, i) => { if (at < registers) locals[at] = { name: parameterNames[i] ?? null, type, signature: null }; at += isWide(type) ? 2 : 1; });
  if (at < registers) {   // the parameters sit at the end of the frame
    let local = registers - 1;
    while (--at > -1) {
      const current = locals[at];
      if (current.type && isWide(current.type)) { local--; if (local === at) break; }
      locals[local] = current; locals[at] = { name: null, type: null, signature: null }; local--;
    }
  }
  let address = 0;
  for (let guard = 0; guard < 1_000_000; guard++) {
    const op = b.u8(c.p++);
    if (op === 0x00) break;
    if (op === 0x01) { address += b.uleb(c); continue; }
    if (op === 0x02) { line += b.sleb(c); continue; }
    if (op === 0x03 || op === 0x04) {
      const register = b.uleb(c), name = nameAt(), type = typeAt(), signature = op === 0x04 ? nameAt() : null, local = { name, type, signature };
      items.push({ address, kind: 'local', register, ...local }); if (register < registers) locals[register] = local; continue;
    }
    if (op === 0x05) {
      const register = b.uleb(c); let info = locals[register] ?? { name: null, type: null, signature: null }, replace = true;
      if (info.ended) { info = { name: null, type: null, signature: null }; replace = false; }
      items.push({ address, kind: 'end-local', register, name: info.name, type: info.type, signature: info.signature });
      if (replace && register < registers) locals[register] = { ...info, ended: true };
      continue;
    }
    if (op === 0x06) {
      const register = b.uleb(c), info = locals[register] ?? { name: null, type: null, signature: null };
      items.push({ address, kind: 'restart-local', register, name: info.name, type: info.type, signature: info.signature });
      if (register < registers) locals[register] = { name: info.name, type: info.type, signature: info.signature };
      continue;
    }
    if (op === 0x07) { items.push({ address, kind: 'prologue' }); continue; }
    if (op === 0x08) { items.push({ address, kind: 'epilogue' }); continue; }
    if (op === 0x09) { items.push({ address, kind: 'source', name: nameAt() }); continue; }
    const adjusted = op - 0x0a; line += -4 + (adjusted % 15); address += Math.floor(adjusted / 15);
    items.push({ address, kind: 'line', line });
  }
  return { parameterNames, items };
}

// ---- method bodies --------------------------------------------------------------------------------------------------------------------------------------------------
const localText = ({ name, type, signature }) => `${name !== null ? quoted(name) : 'null'}:${type ?? 'V'}${signature !== null ? `, ${quoted(signature)}` : ''}`;
function writeParameters(w, dex, method, parameterNames) {
  let register = method.flags & ACC.STATIC ? 0 : 1;
  method.parameters.forEach((type, i) => {
    const name = parameterNames[i] ?? null, annotations = method.parameterAnnotations[i] ?? [];
    if (name !== null || annotations.length) {
      w.write(`.param p${register}${name !== null ? `, ${quoted(name)}` : ''}    # ${type}\n`);
      if (annotations.length) { w.indent += 4; writeAnnotations(w, dex, annotations); w.indent -= 4; w.write('.end param\n'); }
    }
    register += isWide(type) ? 2 : 1;
  });
}
function signatureOf(method) { return `(${method.parameters.join('')})${method.result}`; }
/**
 * Writes one method. Records on `map`: map.pcLines (line -> pc, for this method's instruction lines) and returns { name, signature, startLine, endLine, pcToLine, ... }.
 */
function writeMethod(w, dex, owner, method, pcOfLine) {
  const startLine = w.line, signature = signatureOf(method), info = { name: method.name, signature, key: `${owner}->${method.name}${signature}`, flags: method.flags, startLine,
    hasCode: !!method.code, registers: method.code?.registers ?? 0, units: method.code?.units.length ?? 0, pcToLine: [] };
  const withOwner = { ...method, owner }, debug = readDebugInfo(dex, withOwner, method.code);
  w.write(`.method ${accessFlagsText(method.flags, 'm')}${method.name}${signature}\n`);
  w.indent += 4;
  if (!method.code) {
    writeParameters(w, dex, method, debug.parameterNames);
    writeAnnotations(w, dex, method.annotations);
    w.indent -= 4; w.write('.end method\n');
    info.endLine = w.line - 1; return info;
  }
  const code = method.code, u = code.units, paramRegs = wordsOf(method.parameters) + (method.flags & ACC.STATIC ? 0 : 1), firstParam = code.registers - paramRegs;
  w.write(`.registers ${code.registers}\n`);
  writeParameters(w, dex, method, debug.parameterNames);
  writeAnnotations(w, dex, method.annotations);
  w.write('\n');
  const reg = r => r >= firstParam ? `p${r - firstParam}` : `v${r}`;
  const range = (first, last) => first >= firstParam ? `{p${first - firstParam} .. p${last - firstParam}}` : `{v${first} .. v${last}}`;
  // instructions
  const instructions = []; for (let pc = 0; pc < u.length;) { const ins = decodeInstruction(u, pc); instructions.push(ins); pc += Math.max(1, ins.units); }
  const starts = new Map(instructions.map((ins, i) => [ins.pc, i]));
  const labels = new Map(), items = []; let seq = 0;
  const label = (address, prefix, order = 0, nameAddress = address) => {
    const key = `${prefix}@${address}`; let l = labels.get(key);
    if (!l) { l = { address, prefix, name: `:${prefix}${nameAddress.toString(16)}`, order, seq: 0 }; labels.set(key, l); }
    return l;
  };
  const add = (address, order, render) => items.push({ address, order, seq: seq++, render });
  const switchBase = new Map();   // payload address -> address of the switch that uses it
  for (const ins of instructions) if ((ins.op === 0x2b || ins.op === 0x2c) && !ins.bad) switchBase.set(ins.target, ins.pc);
  const ref = (kind, index) => {
    try {
      switch (kind) {
        case 's': return quoted(dex.string(index));
        case 't': return dex.type(index);
        case 'f': return fieldText(dex, index);
        case 'm': return methodText(dex, index);
        case 'p': return protoText(dex, index);
        case 'h': return methodHandleText(dex, index);
        case 'c': return callSiteText(dex, index);
      }
    } catch { /* an index outside its table */ }
    return `${{ s: 'string', t: 'type', f: 'field', m: 'method', p: 'proto', h: 'method_handle', c: 'call_site' }[kind]}@${index}`;
  };
  instructions.forEach((ins, i) => {
    const text = instructionText(ins, { reg, range, ref, label, switchBase, starts, u });
    add(ins.pc, 100, () => text);
    items.at(-1).pc = ins.pc;
    if (i !== instructions.length - 1) add(ins.pc, Number.MAX_VALUE, () => '');
  });
  // try / catch
  if (code.tries.length && instructions.length) {
    const last = instructions.at(-1), codeSize = last.pc + last.units;
    for (const t of code.tries) {
      const end = t.start + t.count; if (t.start >= codeSize || end > codeSize) continue;
      let lastCovered = 0; for (const ins of instructions) { if (ins.pc <= end - 1) lastCovered = ins.pc; else break; }
      for (const handler of t.handlers) {
        if (handler.address >= codeSize) continue;
        const start = label(t.start, 'try_start_'), endLabel = label(lastCovered, 'try_end_', 101, end), target = label(handler.address, handler.type === null ? 'catchall_' : 'catch_');
        add(lastCovered, 102, () => `${handler.type === null ? '.catchall' : `.catch ${handler.type}`} {${start.name} .. ${endLabel.name}} ${target.name}`);
      }
    }
  }
  // debug information
  for (const item of debug.items) {
    switch (item.kind) {
      case 'line': add(item.address, -2, () => `.line ${item.line}`); break;
      case 'local': add(item.address, -1, () => `.local ${reg(item.register)}${item.name !== null || item.type !== null || item.signature !== null ? `, ${localText(item)}` : ''}`); break;
      case 'end-local': add(item.address, -1, () => `.end local ${reg(item.register)}${item.name !== null || item.type !== null || item.signature !== null ? `    # ${localText(item)}` : ''}`); break;
      case 'restart-local': add(item.address, -1, () => `.restart local ${reg(item.register)}${item.name !== null || item.type !== null || item.signature !== null ? `    # ${localText(item)}` : ''}`); break;
      case 'prologue': add(item.address, -4, () => '.prologue'); break;
      case 'epilogue': add(item.address, -4, () => '.epilogue'); break;
      case 'source': add(item.address, -3, () => `.source${item.name !== null ? ` ${quoted(item.name)}` : ''}`); break;
    }
  }
  for (const l of labels.values()) add(l.address, l.order, () => l.name);
  items.sort((a, b) => a.address - b.address || a.order - b.order || a.seq - b.seq);
  for (const item of items) {
    const line = w.line, text = item.render();
    w.write(text); w.write('\n');
    if (item.pc !== undefined) { info.pcToLine.push([item.pc, line]); pcOfLine[line] = item.pc; }
  }
  w.indent -= 4; w.write('.end method\n');
  info.endLine = w.line - 1;
  return info;
}
function instructionText(ins, { reg, range, ref, label, switchBase, starts, u }) {
  const name = ins.name;
  if (ins.unused) return `# unused opcode 0x${ins.op.toString(16).padStart(2, '0')}`;
  if (ins.bad) return `# truncated instruction ${name}`;
  if (ins.fmt === 'payload') {
    const p = ins.payload;
    if (p.kind === 'array') {
      const suffix = p.width === 1 ? 't' : p.width === 2 ? 's' : '';
      const lines = p.values.map(v => `    ${signedIntOrLong(v)}${suffix}${p.width === 8 ? doubleComment(v) : p.width === 4 ? floatComment(Number(v)) : ''}`);
      return [`.array-data ${p.width}`, ...lines, '.end array-data'].join('\n');
    }
    const base = switchBase.get(ins.pc);
    const target = (offset, prefix) => base === undefined ? `${offset >= 0 ? '+' : ''}${offset}` : label(base + offset, prefix).name;
    if (p.kind === 'packed') {
      const body = [`.packed-switch ${intText(p.first)}`, ...p.targets.map(offset => `    ${target(offset, 'pswitch_')}`), '.end packed-switch'];
      return (base === undefined ? body.map(line => `#${line}`) : body).join('\n');
    }
    const body = ['.sparse-switch', ...p.keys.map((key, i) => `    ${intText(key)} -> ${target(p.targets[i], 'sswitch_')}`), '.end sparse-switch'];
    return (base === undefined ? body.map(line => `#${line}`) : body).join('\n');
  }
  const r = ins.regs.map(reg), o = OPCODES[ins.op];
  const literal = () => {
    const text = signedIntOrLong(ins.lit);
    if (ins.fmt === '11n' || ins.fmt === '22b' || ins.fmt === '22s') return text;
    return text + (WIDE_CONST.has(ins.op) ? doubleComment(ins.lit) : floatComment(Number(BigInt.asIntN(32, ins.lit))));
  };
  const branch = prefix => starts.has(ins.target) || (ins.target >= 0 && ins.target < u.length) ? label(ins.target, prefix).name : `+${ins.target - ins.pc}`;
  switch (ins.fmt) {
    case '10x': return name;
    case '11x': return `${name} ${r[0]}`;
    case '12x': case '22x': case '32x': return `${name} ${r[0]}, ${r[1]}`;
    case '11n': case '21s': case '21h': case '31i': case '51l': return `${name} ${r[0]}, ${literal()}`;
    case '10t': case '20t': case '30t': return `${name} ${branch('goto_')}`;
    case '21t': return `${name} ${r[0]}, ${branch('cond_')}`;
    case '22t': return `${name} ${r[0]}, ${r[1]}, ${branch('cond_')}`;
    case '31t': return `${name} ${r[0]}, ${branch(ins.op === 0x26 ? 'array_' : ins.op === 0x2b ? 'pswitch_data_' : 'sswitch_data_')}`;
    case '21c': case '31c': return `${name} ${r[0]}, ${ref(o.ref, ins.ref)}`;
    case '22c': return `${name} ${r[0]}, ${r[1]}, ${ref(o.ref, ins.ref)}`;
    case '23x': return `${name} ${r[0]}, ${r[1]}, ${r[2]}`;
    case '22b': case '22s': return `${name} ${r[0]}, ${r[1]}, ${literal()}`;
    case '35c': return `${name} {${r.join(', ')}}, ${ref(o.ref, ins.ref)}`;
    case '3rc': return `${name} ${ins.range.count ? range(ins.range.first, ins.range.first + ins.range.count - 1) : '{}'}, ${ref(o.ref, ins.ref)}`;
    case '45cc': return `${name} {${r.join(', ')}}, ${ref('m', ins.ref)}, ${ref('p', ins.proto)}`;
    case '4rcc': return `${name} ${ins.range.count ? range(ins.range.first, ins.range.first + ins.range.count - 1) : '{}'}, ${ref('m', ins.ref)}, ${ref('p', ins.proto)}`;
  }
  return `# ${name}`;
}

// ---- the class --------------------------------------------------------------------------------------------------------------------------------------------------------
function fieldsSetInClinit(model) {
  const out = new Set(), clinit = model.directMethods.find(m => m.name === '<clinit>'); if (!clinit?.code) return out;
  const u = clinit.code.units;
  for (let pc = 0; pc < u.length;) {
    const ins = decodeInstruction(u, pc); pc += Math.max(1, ins.units);
    if (ins.op >= 0x67 && ins.op <= 0x6d && !ins.bad) { try { const f = model.dex.field(ins.ref); if (f.owner === model.type) out.add(`${f.name}:${f.type}`); } catch { /* an invalid index */ } }
  }
  return out;
}
function writeField(w, dex, field, setInClinit) {
  let value = field.value;
  if (setInClinit && (field.flags & ACC.STATIC) && (field.flags & ACC.FINAL) && value !== null) {
    if (!isDefaultValue(value)) w.write('# The value of this static final field might be set in the static constructor\n');
    else value = null;
  }
  w.write(`.field ${accessFlagsText(field.flags, 'f')}${field.name}:${field.type}`);
  if (value !== null) { w.write(' = '); writeValue(w, dex, value); }
  w.write('\n');
  if (field.annotations.length) { w.indent += 4; writeAnnotations(w, dex, field.annotations); w.indent -= 4; w.write('.end field\n'); }
}
/**
 * The smali of one class: { text, lineCount, pcOfLine (Int32Array: the dex pc of each line's instruction, -1 elsewhere), methodOfLine (Int32Array: index into methods, -1),
 * methods: [{ name, signature, key, flags, startLine, endLine, hasCode, registers, units, pcToLine: [[pc, line]] }] } (lines are 0-based). `only`: { name, signature } to write
 * that method alone (the text the method editor starts from).
 */
export function disassembleClass(dex, descriptor, { only = null } = {}) {
  const model = typeof descriptor === 'string' ? readClassModel(dex, descriptor) : descriptor;
  if (!model) return null;
  const w = new Writer(), pcs = [], methods = [];
  const writeMethods = (list, header, skip = null) => {
    let wrote = false; const written = new Set();
    for (const method of list) {
      const sig = method.name + signatureOf(method);
      if (only && (only.name !== method.name || only.signature !== signatureOf(method))) continue;
      if (!only) { if (!wrote) { w.write(`\n\n# ${header}`); wrote = true; } w.write('\n'); }
      if (written.has(sig) || skip?.has(sig)) w.write('# duplicate method ignored\n');
      written.add(sig);
      const info = writeMethod(w, model.dex, model.type, method, pcs);
      info.direct = list === model.directMethods; methods.push(info);
    }
    return written;
  };
  if (!only) {
    w.write(`.class ${accessFlagsText(model.flags, 'c')}${model.type}\n`);
    if (model.superclass) w.write(`.super ${model.superclass}\n`);
    if (model.source !== null) w.write(`.source ${quoted(model.source)}\n`);
    if (model.interfaces.length) { w.write('\n# interfaces\n'); for (const name of model.interfaces) w.write(`.implements ${name}\n`); }
    if (model.annotations.length) { w.write('\n\n# annotations\n'); writeAnnotations(w, model.dex, model.annotations); }
    const clinit = fieldsSetInClinit(model);
    for (const [list, header] of [[model.staticFields, 'static fields'], [model.instanceFields, 'instance fields']]) {
      let wrote = false;
      for (const field of list) { if (!wrote) { w.write(`\n\n# ${header}`); wrote = true; } w.write('\n'); writeField(w, model.dex, field, list === model.staticFields && clinit.has(`${field.name}:${field.type}`)); }
    }
  }
  const direct = writeMethods(model.directMethods, 'direct methods');
  writeMethods(model.virtualMethods, 'virtual methods', direct);
  const text = w.text(), lineCount = text.split('\n').length;
  const pcOfLine = new Int32Array(lineCount).fill(-1), methodOfLine = new Int32Array(lineCount).fill(-1);
  for (const [line, pc] of pcs.entries()) if (pc !== undefined && line < lineCount) pcOfLine[line] = pc;
  methods.forEach((m, i) => { for (let line = m.startLine; line <= m.endLine && line < lineCount; line++) methodOfLine[line] = i; });
  return { text, lineCount, pcOfLine, methodOfLine, methods, model };
}
/** The smali of one method record ({ name, parameters, result, flags, code, annotations, parameterAnnotations }, as readClassModel gives it, or with a code item from readCodeItem). */
export function smaliOfMethod(dex, owner, method) {
  const w = new Writer(), pcs = [], info = writeMethod(w, dex, owner, { annotations: [], parameterAnnotations: [], ...method }, pcs);
  return { text: w.text(), info };
}
