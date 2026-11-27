// The Java view of the Code browser (docs/CODE-BROWSER.md "Java"): a decompiler from a class's DEX code to readable Java source, as a decompiler such as jadx shows it, with
// every line mapped to the dex pcs it covers so the debugger works on the Java view (breakpoints by line, the current line, stepping by Java statement).
//
// Per method: the instructions (src/smali-disassembler.js) are cut into basic blocks (branch targets, try ranges, handlers); the registers are split into variables by their
// reaching definitions (webs: the definitions that reach a common use are one variable), named from the DEX debug information when the method has it (.local, .param) and
// by type otherwise (i, str, stringBuilder, ...); a temporary defined and used once in the same block is folded into the expression that uses it, keeping the order of
// side effects (a call, a field or array read, a store or a throwing operation is never moved past another); short-circuit conditions are rebuilt from chains of if
// instructions (&&, ||); the control flow is structured with dominators and post-dominators into if / else, while, do-while, for (with continue through the update),
// switch (packed and sparse, with fall-through), try / catch (from the try items, nested by coverage) and synchronized (monitor-enter with its catch-all that exits the
// monitor); StringBuilder chains become string concatenation and x = x + 1 becomes x++.
//
// Nothing is faked: a method whose flow cannot be structured is shown with a comment saying why, then its statements with labels and goto pseudo-statements (not valid
// Java, every line still mapped to its pcs); a method whose instructions cannot be read into statements is shown as its smali in a comment. A whole class always renders.
// What javac would have written differently stays as the DEX has it: a finally block is its copies plus a catch-all that rethrows, a lambda is the synthetic class d8 wrote,
// a string switch is its hashCode switch. The methods are the textbook ones (dominators by Cooper, Harvey and Kennedy; structuring in the manner of jadx, Apache-2.0); no code of any decompiler is copied. Pure module: no DOM, no process.*.
import { ACC, decodeInstruction, OPCODES, readDebugInfo, valueText, javaFloatText, javaDoubleText, floatOfBits, doubleOfBits, smaliOfMethod } from './smali-disassembler.js?v=d20881b83aa7';

export const DECOMPILER_LIMITS = Object.freeze({ sliceMs: 30, structureUnits: 40000, maxBlocks: 6000 });
const now = () => globalThis.performance?.now?.() ?? Date.now();
class Unstructurable extends Error {}
const giveUp = why => { throw new Unstructurable(why); };

// ---- types and names --------------------------------------------------------------------------------------------------------------------------------------------------
const PRIMITIVES = { V: 'void', Z: 'boolean', B: 'byte', S: 'short', C: 'char', I: 'int', J: 'long', F: 'float', D: 'double' };
const isWide = t => t === 'J' || t === 'D';
const isRef = t => !!t && (t[0] === 'L' || t[0] === '[');
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', SB_TYPES = new Set(['Ljava/lang/StringBuilder;', 'Ljava/lang/StringBuffer;']);
const KEYWORDS = new Set('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null var'.split(' '));

/** Simple names for the types a class's text mentions, with the imports they need (a simple name taken by another class stays fully qualified). */
class TypeNamer {
  constructor(self) {
    this.self = self; const slash = self.lastIndexOf('/'); this.pkg = slash > 0 ? self.slice(1, slash).replaceAll('/', '.') : '';
    this.taken = new Map(); this.imports = new Set();
    this.claim(this.topOf(self));
  }
  topOf(descriptor) { const body = descriptor.slice(1, -1); const dollar = body.indexOf('$', body.lastIndexOf('/') + 1); return `L${dollar > 0 ? body.slice(0, dollar) : body};`; }
  claim(top) {
    const body = top.slice(1, -1), simple = body.slice(body.lastIndexOf('/') + 1), dotted = body.replaceAll('/', '.');
    const owner = this.taken.get(simple); if (owner !== undefined) return owner === dotted ? simple : null;
    this.taken.set(simple, dotted);
    const pkg = dotted.includes('.') ? dotted.slice(0, dotted.lastIndexOf('.')) : '';
    if (pkg && pkg !== this.pkg && pkg !== 'java.lang') this.imports.add(dotted);
    return simple;
  }
  /** A descriptor as this class's text writes it: int[], String, Map.Entry, java.util.Date (a clash). */
  name(descriptor) {
    if (!descriptor) return 'Object';
    let dims = 0; while (descriptor[dims] === '[') dims++;
    const base = descriptor.slice(dims);
    let text = PRIMITIVES[base];
    if (!text) {
      if (!(base.startsWith('L') && base.endsWith(';'))) text = base;
      else {
        const top = this.topOf(base), simple = this.claim(top), rest = base.slice(top.length - 1, -1);
        const parts = rest.split('$').slice(1), nested = parts.every(p => /^[A-Za-z_][\w]*$/.test(p));   // Outer$Inner is Outer.Inner; Outer$1 and Outer$$Lambda stay as named
        text = (simple ?? top.slice(1, -1).replaceAll('/', '.')) + (nested ? parts.map(p => `.${p}`).join('') : rest);
      }
    }
    return text + '[]'.repeat(dims);
  }
}
const simpleOf = descriptor => { const body = descriptor.replace(/^\[+/, '').replace(/^L|;$/g, ''); const s = body.slice(body.lastIndexOf('/') + 1); return s.slice(s.lastIndexOf('$') + 1) || s; };
/** The name a variable of type `t` gets without debug information (as jadx names them). */
function nameForType(t) {
  if (!t) return 'obj';
  if (t[0] === '[') { const base = nameForType(t.replace(/^\[+/, '')); return `${base}Arr`; }
  const p = { Z: 'z', B: 'b', S: 's', C: 'c', I: 'i', J: 'j', F: 'f', D: 'd' }[t]; if (p) return p;
  switch (t) { case STRING: return 'str'; case OBJECT: return 'obj'; case 'Ljava/lang/Class;': return 'cls'; case 'Ljava/lang/Integer;': return 'num'; case 'Ljava/lang/Throwable;': return 'th'; }
  let simple = simpleOf(t).replace(/[^\w$]/g, ''); if (/^\d/.test(simple) || !simple) simple = 'obj';
  if (/Exception$|Error$/.test(simple)) return 'e';
  const name = simple[0].toLowerCase() + simple.slice(1);
  return KEYWORDS.has(name) ? `${name}2` : name;
}

// ---- literals ---------------------------------------------------------------------------------------------------------------------------------------------------------
export function javaString(text) {
  let out = '"';
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (ch === '"') out += '\\"'; else if (ch === '\\') out += '\\\\'; else if (c === 10) out += '\\n'; else if (c === 13) out += '\\r'; else if (c === 9) out += '\\t'; else if (c === 8) out += '\\b'; else if (c === 12) out += '\\f';
    else if (c < 0x20 || (c >= 0x7f && c < 0xa0) || c === 0x2028 || c === 0x2029 || (c >= 0xd800 && c < 0xe000) || c === 0xfeff) out += `\\u${c.toString(16).padStart(4, '0')}`;
    else out += ch;
  }
  return out + '"';
}
function charLiteral(c) {
  c &= 0xffff;
  const esc = { 10: '\\n', 13: '\\r', 9: '\\t', 8: '\\b', 12: '\\f', 39: "\\'", 92: '\\\\' }[c];
  if (esc) return `'${esc}'`;
  return c >= 0x20 && c < 0x7f ? `'${String.fromCharCode(c)}'` : `'\\u${c.toString(16).padStart(4, '0')}'`;
}
function floatLiteral(bits) {
  const f = floatOfBits(bits);
  if (Number.isNaN(f)) return 'Float.NaN'; if (f === Infinity) return 'Float.POSITIVE_INFINITY'; if (f === -Infinity) return 'Float.NEGATIVE_INFINITY';
  if (f === floatOfBits(0x7f7fffff)) return 'Float.MAX_VALUE'; if (f === floatOfBits(1)) return 'Float.MIN_VALUE';
  return `${javaFloatText(f)}f`;
}
function doubleLiteral(bits) {
  const d = doubleOfBits(bits);
  if (Number.isNaN(d)) return 'Double.NaN'; if (d === Infinity) return 'Double.POSITIVE_INFINITY'; if (d === -Infinity) return 'Double.NEGATIVE_INFINITY';
  if (d === Number.MAX_VALUE) return 'Double.MAX_VALUE'; if (d === Number.MIN_VALUE) return 'Double.MIN_VALUE';
  return javaDoubleText(d);
}
function intLiteral(v) {
  v = Number(BigInt.asIntN(32, BigInt(v)));
  if (v === 2147483647) return 'Integer.MAX_VALUE'; if (v === -2147483648) return 'Integer.MIN_VALUE';
  const u = v >>> 0, pkg = u >>> 24, type = (u >>> 16) & 0xff;
  if ((pkg === 0x7f || pkg === 0x01) && type > 0 && type < 0x20) return `0x${u.toString(16)}`;   // a resource id reads as one
  return String(v);
}
function longLiteral(v) {
  v = BigInt.asIntN(64, BigInt(v));
  if (v === 0x7fffffffffffffffn) return 'Long.MAX_VALUE'; if (v === -0x8000000000000000n) return 'Long.MIN_VALUE';
  return `${v}L`;
}
/** A constant (its raw bits) as a literal of type `t`. */
function literalText(value, t, wide) {
  const v = BigInt(value);
  switch (t) {
    case 'Z': return v === 0n ? 'false' : 'true';
    case 'C': return charLiteral(Number(v));
    case 'F': return floatLiteral(Number(BigInt.asIntN(32, v)));
    case 'D': return doubleLiteral(v);
    case 'J': return longLiteral(v);
    case 'B': case 'S': case 'I': return intLiteral(v);
  }
  if (isRef(t)) return v === 0n ? 'null' : intLiteral(v);
  return wide ? longLiteral(v) : intLiteral(v);
}

// ---- instruction semantics --------------------------------------------------------------------------------------------------------------------------------------------
const NON_THROWING = new Set([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19,
  0x20, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d]);
for (let op = 0x7b; op <= 0x8f; op++) NON_THROWING.add(op);
const DIVISIONS = new Set([0x93, 0x94, 0x9e, 0x9f, 0xb3, 0xb4, 0xbe, 0xbf, 0xd3, 0xd4, 0xdb, 0xdc]);
for (let op = 0x90; op <= 0xe2; op++) if (!DIVISIONS.has(op)) NON_THROWING.add(op);
export const canThrow = op => !NON_THROWING.has(op);
const BIN_OPS = ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '>>>'];
const UNARY = [['-', 'I', 'I'], ['~', 'I', 'I'], ['-', 'J', 'J'], ['~', 'J', 'J'], ['-', 'F', 'F'], ['-', 'D', 'D'], ['cast', 'I', 'J'], ['cast', 'I', 'F'], ['cast', 'I', 'D'], ['cast', 'J', 'I'], ['cast', 'J', 'F'],
  ['cast', 'J', 'D'], ['cast', 'F', 'I'], ['cast', 'F', 'J'], ['cast', 'F', 'D'], ['cast', 'D', 'I'], ['cast', 'D', 'J'], ['cast', 'D', 'F'], ['cast', 'I', 'B'], ['cast', 'I', 'C'], ['cast', 'I', 'S']];
const IF_OPS = ['==', '!=', '<', '>=', '>', '<='];
const NEGATE = { '==': '!=', '!=': '==', '<': '>=', '>=': '<', '>': '<=', '<=': '>' };
const AGET_TYPES = [null, null, OBJECT, 'Z', 'B', 'C', 'S'];   // aget, aget-wide, aget-object, aget-boolean, -byte, -char, -short

/** What an instruction reads and writes: { reads: [register], def: register | -1, wide, kind }. The invoke result is the pseudo-register `res`. */
function classify(ins, dex, res, method) {
  const op = ins.op, r = ins.regs ?? [], out = { reads: [], def: -1, wide: false, kind: 'plain' };
  if (ins.fmt === 'payload') { out.kind = 'payload'; return out; }
  if (ins.unused || ins.bad) { out.kind = 'bad'; return out; }
  if (op === 0x00) { out.kind = 'nop'; return out; }
  if (op <= 0x09) { out.reads = [r[1]]; out.def = r[0]; out.wide = op >= 0x04 && op <= 0x06; out.kind = 'move'; return out; }
  if (op <= 0x0c) { out.reads = [res]; out.def = r[0]; out.wide = op === 0x0b; out.kind = 'move-result'; return out; }
  if (op === 0x0d) { out.def = r[0]; out.kind = 'move-exception'; return out; }
  if (op === 0x0e) { out.kind = 'return'; return out; }
  if (op <= 0x11) { out.reads = [r[0]]; out.kind = 'return'; return out; }
  if (op <= 0x19) { out.def = r[0]; out.wide = op >= 0x16; out.kind = 'const'; return out; }
  if (op <= 0x1c || op === 0xfe || op === 0xff) { out.def = r[0]; out.kind = 'const'; return out; }
  if (op <= 0x1e) { out.reads = [r[0]]; out.kind = 'monitor'; return out; }
  if (op === 0x1f) { out.reads = [r[0]]; out.def = r[0]; return out; }
  if (op <= 0x21) { out.reads = [r[1]]; out.def = r[0]; return out; }
  if (op === 0x22) { out.def = r[0]; out.kind = 'new-instance'; return out; }
  if (op === 0x23) { out.reads = [r[1]]; out.def = r[0]; return out; }
  if (op <= 0x25) { out.reads = r.slice(); out.def = res; return out; }
  if (op === 0x26) { out.reads = [r[0]]; out.def = r[0]; return out; }
  if (op === 0x27) { out.reads = [r[0]]; out.kind = 'throw'; return out; }
  if (op <= 0x2a) { out.kind = 'goto'; return out; }
  if (op <= 0x2c) { out.reads = [r[0]]; out.kind = 'switch'; return out; }
  if (op <= 0x31) { out.reads = [r[1], r[2]]; out.def = r[0]; return out; }
  if (op <= 0x37) { out.reads = [r[0], r[1]]; out.kind = 'if'; return out; }
  if (op <= 0x3d) { out.reads = [r[0]]; out.kind = 'if'; return out; }
  if (op >= 0x44 && op <= 0x4a) { out.reads = [r[1], r[2]]; out.def = r[0]; out.wide = op === 0x45; return out; }
  if (op >= 0x4b && op <= 0x51) { out.reads = [r[1], r[2], r[0]]; out.kind = 'store'; return out; }
  if (op >= 0x52 && op <= 0x58) { out.reads = [r[1]]; out.def = r[0]; out.wide = op === 0x53; return out; }
  if (op >= 0x59 && op <= 0x5f) { out.reads = [r[1], r[0]]; out.kind = 'store'; return out; }
  if (op >= 0x60 && op <= 0x66) { out.def = r[0]; out.wide = op === 0x61; return out; }
  if (op >= 0x67 && op <= 0x6d) { out.reads = [r[0]]; out.kind = 'store'; return out; }
  if ((op >= 0x6e && op <= 0x72) || (op >= 0x74 && op <= 0x78) || op === 0xfa || op === 0xfb) {
    const m = dex.method(ins.ref), isStatic = op === 0x71 || op === 0x77, regs = [];
    let at = 0;
    if (!isStatic) regs.push(r[at++]);
    for (const t of m.parameters) { regs.push(r[at]); at += isWide(t) ? 2 : 1; }
    out.reads = regs; out.kind = 'invoke';
    const result = op === 0xfa || op === 0xfb ? dex.proto(ins.proto).result : m.result;
    if (m.name === '<init>' && (op === 0x70 || op === 0x76)) {
      out.kind = 'init';
      const thisReg = method.thisReg;
      if (!(method.isConstructor && regs[0] === thisReg)) { out.def = regs[0]; }
    } else if (result !== 'V') { out.def = res; out.wide = isWide(result); }
    return out;
  }
  if (op === 0xfc || op === 0xfd) { out.reads = r.slice(); out.kind = 'invoke'; out.def = res; return out; }   // invoke-custom: every register is an argument (wide ones counted twice: a lambda's bootstrap arguments are rare there)
  if (op >= 0x7b && op <= 0x8f) { const [, , to] = UNARY[op - 0x7b]; out.reads = [r[1]]; out.def = r[0]; out.wide = isWide(to); return out; }
  if (op >= 0x90 && op <= 0xaf) { out.reads = [r[1], r[2]]; out.def = r[0]; out.wide = (op >= 0x9b && op <= 0xa5) || op >= 0xab; return out; }
  if (op >= 0xb0 && op <= 0xcf) { out.reads = [r[0], r[1]]; out.def = r[0]; out.wide = (op >= 0xbb && op <= 0xc5) || op >= 0xcb; return out; }
  if (op >= 0xd0 && op <= 0xe2) { out.reads = [r[1]]; out.def = r[0]; return out; }
  out.kind = 'bad'; return out;
}
const binInfo = op => {
  let k = op >= 0xb0 && op <= 0xcf ? op - 0xb0 : op - 0x90;
  if (k < 11) return { sym: BIN_OPS[k], t: 'I' };
  if (k < 22) return { sym: BIN_OPS[k - 11], t: 'J' };
  if (k < 27) return { sym: BIN_OPS[k - 22], t: 'F' };
  return { sym: BIN_OPS[k - 27], t: 'D' };
};

// ---- expressions ------------------------------------------------------------------------------------------------------------------------------------------------------
// Nodes: lit { v, wide, t? } str { s } cls { t } var { v } bin { op, a, b, t } un { op, a, t } cast { t, a, from } inst { a, t } alen { a } aget { a, i, t } iget { o, f }
// sget { f } call { kind, m, recv, args } new { t, m, args } ctor { which, m, args } newarr { t, len } arrlit { t, items } cmp { a, b, fp, bias } rel { op, a, b, fp } relz { op, a }
// not { a } and { a, b } or { a, b } caught { t } uninit { t } raw { text, args }
const PURE = new Set(['lit', 'str', 'cls', 'var', 'un', 'inst', 'cmp', 'rel', 'relz', 'not', 'and', 'or', 'uninit']);   // uninit: new-instance, which Java evaluates before the arguments anyway
/** True when the node itself (not counting its operands) neither has an effect nor reads memory nor throws. */
function selfPure(e) {
  if (e.k === 'bin') return !(e.op === '/' || e.op === '%') || e.t === 'F' || e.t === 'D';
  if (e.k === 'cast') return !isRef(e.t);
  if (e.k === 'new') return SB_TYPES.has(e.t) && (!e.args.length || e.m.parameters[0] === STRING);
  if (e.k === 'call') return SB_TYPES.has(e.m.owner) && ((e.m.name === 'append' && e.args.length === 1 && !!(PRIMITIVES[e.m.parameters[0]] || e.m.parameters[0] === STRING)) || (e.m.name === 'toString' && !e.args.length));
  return PURE.has(e.k);
}
function isPure(e) {
  if (e.k === 'bin') return !(e.op === '/' || e.op === '%') || e.t === 'F' || e.t === 'D' ? isPure(e.a) && isPure(e.b) : false;
  if (e.k === 'cast') return isRef(e.t) ? false : isPure(e.a);
  // string building: a StringBuilder made and appended with values (no object whose toString could run code) has no effect outside itself
  if (e.k === 'new' && SB_TYPES.has(e.t) && (!e.args.length || e.m.parameters[0] === STRING)) return e.args.every(isPure);
  if (e.k === 'call' && SB_TYPES.has(e.m.owner) && ((e.m.name === 'append' && e.args.length === 1 && (PRIMITIVES[e.m.parameters[0]] || e.m.parameters[0] === STRING)) || (e.m.name === 'toString' && !e.args.length))) return isPure(e.recv) && e.args.every(isPure);
  if (!PURE.has(e.k)) return false;
  for (const child of children(e)) if (!isPure(child)) return false;
  return true;
}
function children(e) {
  switch (e.k) {
    case 'bin': case 'rel': case 'cmp': case 'and': case 'or': return [e.a, e.b];
    case 'un': case 'cast': case 'inst': case 'alen': case 'not': case 'relz': return [e.a];
    case 'aget': return [e.a, e.i];
    case 'iget': return [e.o];
    case 'call': return e.recv ? [e.recv, ...e.args] : e.args;
    case 'new': case 'ctor': case 'raw': return e.args ?? [];
    case 'newarr': return [e.len];
    case 'arrlit': return e.items.filter(x => typeof x === 'object');
    default: return [];
  }
}
function varsOf(e, into = new Set()) { if (!e) return into; if (e.k === 'var') into.add(e.v); else for (const c of children(e)) varsOf(c, into); return into; }

// ---- the method decompiler --------------------------------------------------------------------------------------------------------------------------------------------
/**
 * Decompiles one method of `model` (src/smali-disassembler.js readClassModel). Returns { lines: [{ indent, text, pcs }], ok, fallback: null | 'goto' | 'smali', reason,
 * params: [{ name, type }] }. `namer`: the class's TypeNamer.
 */
export function decompileMethod(model, method, namer, { gotoForm = false } = {}) {
  const owner = model.type, dex = model.dex;
  const m = { ...method, owner, isStatic: !!(method.flags & ACC.STATIC), isConstructor: method.name === '<init>' };
  if (!method.code) return { lines: [], ok: true, fallback: null, reason: null, params: defaultParams(m, null) };
  let ir;
  try { ir = buildIr(dex, m); }
  catch (error) { return smaliFallback(dex, m, `its instructions could not be read into statements (${error?.message ?? error})`); }
  if (gotoForm) return gotoFallback(ir, namer, 'the goto form was asked for');
  if (ir.unitCount > DECOMPILER_LIMITS.structureUnits || ir.blocks.length > DECOMPILER_LIMITS.maxBlocks) return gotoFallback(ir, namer, `it is too large to structure here (${ir.unitCount} code units)`);
  let body;
  try { body = structure(ir); }
  catch (error) { return gotoFallback(ir, namer, error instanceof Unstructurable ? error.message : `the structuring failed (${error?.message ?? error})`); }
  try {
    const endPcs = tidy(body, ir); placeDeclarations(body, ir); nameVariables(ir, body);
    const lines = []; emitStatements(lines, body, 0, makeRenderer(ir, namer), ir);
    return { lines, ok: true, fallback: null, reason: null, params: ir.params.map(p => ({ name: p.var.name, type: p.var.type })), endPcs };
  } catch (error) { return gotoFallback(ir, namer, `the output failed (${error?.message ?? error})`); }
}
function defaultParams(m, debug) {
  const names = debug?.parameterNames ?? [], used = new Set();
  return m.parameters.map((t, i) => { let name = names[i] ?? nameForType(t); if (KEYWORDS.has(name)) name += '2'; let n = name, k = 2; while (used.has(n)) n = `${name}${k++}`; used.add(n); return { name: n, type: t }; });
}

// ---- IR: instructions, blocks, webs, statements ---------------------------------------------------------------------------------------------------------------------
function buildIr(dex, m) {
  const code = m.code, u = code.units, registers = code.registers, res = registers, insCount = code.ins;
  m.thisReg = m.isStatic ? -1 : registers - insCount;
  const instructions = [], indexOf = new Map();
  for (let pc = 0; pc < u.length;) { const ins = decodeInstruction(u, pc); indexOf.set(pc, instructions.length); instructions.push(ins); pc += Math.max(1, ins.units); }
  const cls = instructions.map(ins => classify(ins, dex, res, m));
  const debug = readDebugInfo(dex, m, code);
  // the try constructs: handlers grouped by the ranges they cover (one Java try statement each), ranges merged over gaps that cannot throw
  const constructs = tryConstructs(code, instructions, indexOf, cls);
  // blocks
  const leader = new Uint8Array(instructions.length + 1); leader[0] = 1;
  const markPc = pc => { const i = indexOf.get(pc); if (i !== undefined) leader[i] = 1; };
  instructions.forEach((ins, i) => {
    const c = cls[i];
    if (c.kind === 'payload') { leader[i] = 1; leader[i + 1] = 1; return; }
    if (ins.target !== undefined && ins.op !== 0x26) markPc(ins.target);
    if (['goto', 'if', 'switch', 'return', 'throw'].includes(c.kind) || c.kind === 'bad') leader[i + 1] = 1;
    if (c.kind === 'switch') { const payload = payloadAt(instructions, indexOf, ins.target); for (const off of payload?.targets ?? []) markPc(ins.pc + off); }
  });
  for (const t of code.tries) for (const h of t.handlers) markPc(h.address);
  for (const c of constructs) for (const [s, e] of c.ranges) { markPc(s); markPc(e); }
  const blocks = [], blockOfIns = new Int32Array(instructions.length).fill(-1);
  for (let i = 0; i < instructions.length;) {
    if (cls[i].kind === 'payload') { i++; continue; }
    let j = i; while (j + 1 < instructions.length && !leader[j + 1] && cls[j + 1].kind !== 'payload') j++;
    const b = { id: blocks.length, first: i, last: j, pc: instructions[i].pc, succ: [], preds: [], exc: [], stmts: [], term: null, pcs: [] };
    for (let k = i; k <= j; k++) blockOfIns[k] = b.id;
    blocks.push(b); i = j + 1;
  }
  const blockAtPc = pc => { const i = indexOf.get(pc); return i === undefined ? -1 : blockOfIns[i]; };
  // edges
  for (const b of blocks) {
    const ins = instructions[b.last], c = cls[b.last], next = b.last + 1 < instructions.length ? blockOfIns[b.last + 1] : -1;
    if (c.kind === 'goto') b.succ = [blockAtPc(ins.target)];
    else if (c.kind === 'if') b.succ = [blockAtPc(ins.target), next];
    else if (c.kind === 'switch') { const payload = payloadAt(instructions, indexOf, ins.target); b.succ = [...(payload?.targets ?? []).map(off => blockAtPc(ins.pc + off)), next]; }
    else if (c.kind === 'return' || c.kind === 'throw' || c.kind === 'bad') b.succ = [];
    else b.succ = next >= 0 ? [next] : [];
    if (b.succ.some(s => s < 0)) throw new Error(`a branch of pc ${ins.pc} leaves the code`);
    // exception edges: the handlers of every try item a throwing instruction of the block is in
    const seen = new Set();
    for (let k = b.first; k <= b.last; k++) {
      if (!canThrow(instructions[k].op)) continue;
      const pc = instructions[k].pc;
      for (const t of code.tries) if (pc >= t.start && pc < t.start + t.count) for (const h of t.handlers) { const hb = blockAtPc(h.address); if (hb >= 0 && !seen.has(hb)) { seen.add(hb); b.exc.push(hb); } }
    }
  }
  for (const b of blocks) { for (const s of new Set(b.succ)) blocks[s].preds.push(b.id); }
  const ir = { dex, m, code, instructions, indexOf, cls, debug, constructs, blocks, blockOfIns, res, registers, unitCount: u.length, blockAtPc, vars: [], params: [] };
  for (const c of constructs) { c.entryBlock = blockAtPc(c.ranges[0][0]); c.handlerBlocks = c.handlers.map(h => blockAtPc(h.address)); }
  reachingDefinitions(ir);
  buildStatements(ir);
  inferTypes(ir);
  return ir;
}
function payloadAt(instructions, indexOf, pc) { const i = indexOf.get(pc); const ins = i === undefined ? null : instructions[i]; return ins?.payload ?? null; }

/** [{ handlers: [{ type, address }], ranges: [[start, end)] }]: the Java try statements of the method, outermost ranges first by size. */
function tryConstructs(code, instructions, indexOf, cls) {
  const cover = new Map(), order = [];
  code.tries.forEach((t, i) => { for (const h of t.handlers) { const key = `${h.type ?? '*'}@${h.address}`; if (!cover.has(key)) { cover.set(key, { h, items: [] }); order.push(key); } cover.get(key).items.push(i); } });
  const groups = new Map();
  for (const key of order) { const { h, items } = cover.get(key), id = items.join(','); if (!groups.has(id)) groups.set(id, { handlers: [], items }); groups.get(id).handlers.push(h); }
  // a gap between two ranges of one handler belongs to its try when nothing there can throw to an outer handler: it cannot throw, or an inner catch-all (a finally, a
  // synchronized block) takes what it throws first (d8 leaves the outer handler out of the inner ranges then)
  const innerCatchAll = pc => code.tries.some(t => pc >= t.start && pc < t.start + t.count && t.handlers.some(h => h.type === null));
  const nonThrowingBetween = (a, b) => { for (let pc = a; pc < b;) { const i = indexOf.get(pc); if (i === undefined) return false; if (canThrow(instructions[i].op) && cls[i].kind !== 'payload' && !innerCatchAll(pc)) return false; pc += Math.max(1, instructions[i].units); } return true; };
  const out = [];
  for (const g of groups.values()) {
    const ranges = g.items.map(i => [code.tries[i].start, code.tries[i].start + code.tries[i].count]).sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const r of ranges) { const last = merged.at(-1); if (last && (r[0] <= last[1] || nonThrowingBetween(last[1], r[0]))) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
    for (const r of merged) {
      // a move-result after the last call of a range belongs with it; a catch block's move-exception just before a range (a finally around the catch) too
      let i = indexOf.get(r[1]); while (i !== undefined && i < instructions.length && cls[i].kind === 'move-result') { r[1] += instructions[i].units; i++; }
      const before = (indexOf.get(r[0]) ?? 0) - 1; if (before >= 0 && cls[before].kind === 'move-exception') r[0] = instructions[before].pc;
    }
    out.push({ handlers: g.handlers, ranges: merged, size: merged.reduce((n, r) => n + r[1] - r[0], 0) });
  }
  out.sort((a, b) => b.size - a.size);
  return out;
}

// reaching definitions over the registers, then webs (union-find of the definitions that reach a common use)
function reachingDefinitions(ir) {
  const { blocks, instructions, cls, registers, m, code } = ir, R = registers + 1;
  const defs = [];   // { ins: index | -1, reg, wide, kind, param? }
  const defOfIns = new Int32Array(instructions.length).fill(-1);
  // parameters at the end of the frame
  let reg = registers - code.ins;
  const paramDefs = [];
  if (!m.isStatic) { paramDefs.push(defs.length); defs.push({ ins: -1, reg, wide: false, kind: 'this', type: m.owner }); reg++; }
  m.parameters.forEach((t, i) => { paramDefs.push(defs.length); defs.push({ ins: -1, reg, wide: isWide(t), kind: 'param', type: t, index: i }); reg += isWide(t) ? 2 : 1; });
  instructions.forEach((ins, i) => { const c = cls[i]; if (c.def >= 0) { defOfIns[i] = defs.length; defs.push({ ins: i, reg: c.def, wide: c.wide, kind: c.kind }); } });
  const parent = Int32Array.from({ length: defs.length + instructions.length * 3 + 8 }, (_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  const entry = new Array(R).fill(null).map(() => []);
  for (const d of paramDefs) entry[defs[d].reg] = [d];
  const inState = blocks.map(() => null); inState[0] = entry;
  const merge = (target, state) => {
    if (!inState[target]) { inState[target] = state.map(x => x.slice()); return true; }
    let changed = false; const cur = inState[target];
    for (let r = 0; r < R; r++) { const a = cur[r], b = state[r]; for (const d of b) if (!a.includes(d)) { a.push(d); changed = true; } }
    return changed;
  };
  const apply = (state, i) => {
    const c = cls[i], d = defOfIns[i]; if (d < 0) return;
    const r = c.def; state[r] = [d];
    if (c.wide && r + 1 < R) state[r + 1] = [];
    if (r > 0) { const prev = state[r - 1]; if (prev.some(x => defs[x].wide)) state[r - 1] = prev.filter(x => !defs[x].wide); }
  };
  const work = [0], queued = new Uint8Array(blocks.length); queued[0] = 1;
  for (const c of ir.constructs) for (const hb of c.handlerBlocks) if (hb >= 0 && !inState[hb]) inState[hb] = new Array(R).fill(null).map(() => []);
  let guard = 0;
  while (work.length) {
    if (++guard > 2_000_000) throw new Error('the data flow does not settle');
    const bi = work.pop(); queued[bi] = 0;
    const b = blocks[bi], state = inState[bi].map(x => x.slice());
    for (let i = b.first; i <= b.last; i++) {
      if (b.exc.length && canThrow(instructions[i].op)) for (const h of b.exc) if (merge(h, state) && !queued[h]) { queued[h] = 1; work.push(h); }
      apply(state, i);
    }
    for (const s of b.succ) if (merge(s, state) && !queued[s]) { queued[s] = 1; work.push(s); }
  }
  // uses
  const useWeb = instructions.map(() => null);
  let phantom = defs.length;
  for (const b of blocks) {
    if (!inState[b.id]) continue;   // unreachable code
    const state = inState[b.id].map(x => x.slice());
    for (let i = b.first; i <= b.last; i++) {
      const c = cls[i];
      useWeb[i] = c.reads.map(r => {
        const list = state[r] ?? [];
        if (!list.length) { const d = phantom++; defs[d] = { ins: -1, reg: r, wide: false, kind: 'phantom' }; return d; }
        for (let k = 1; k < list.length; k++) union(list[0], list[k]);
        return list[0];
      });
      apply(state, i);
    }
  }
  // webs
  const webs = new Map();
  const webOf = d => { const root = find(d); let w = webs.get(root); if (!w) webs.set(root, w = { id: root, defs: [], uses: [], named: null, var: null }); return w; };
  defs.forEach((d, i) => { if (d) webOf(i).defs.push(i); });
  ir.useWebs = useWeb.map((list, i) => list ? list.map((d, slot) => { const w = webOf(d); w.uses.push({ ins: i, slot }); return w; }) : null);
  ir.defWeb = Array.from(defOfIns, d => d >= 0 ? webOf(d) : null);
  ir.defs = defs; ir.webs = webs; ir.reachable = inState.map(Boolean);
  // debug-info names: a definition whose next instruction is inside a .local range of its register, or a use inside one
  const locals = localRanges(ir);
  const nameAt = (r, pc) => { for (const l of locals.get(r) ?? []) if (pc >= l.start && pc < l.end) return l; return null; };
  for (const w of webs.values()) {
    for (const d of w.defs) {
      const def = defs[d]; if (def.ins < 0) continue;
      const ins = instructions[def.ins], l = nameAt(def.reg, ins.pc + ins.units); if (l && def.reg < registers) { w.named ??= l; }
    }
    if (!w.named) for (const use of w.uses) { const r = cls[use.ins].reads[use.slot]; if (r >= registers) continue; const l = nameAt(r, instructions[use.ins].pc); if (l) { w.named = l; break; } }
  }
  // variables
  const parameterNames = ir.debug.parameterNames ?? [];
  for (const w of webs.values()) {
    const v = { id: w.id, web: w, name: null, type: null, debugType: w.named?.type ?? null, debugName: w.named?.name ?? null, isThis: false, isParam: false, isCatch: false, uninit: false, defTypes: [], expect: [] };
    for (const d of w.defs) {
      const def = defs[d];
      if (def.kind === 'this') { v.isThis = true; v.type = m.owner; }
      if (def.kind === 'param') { v.isParam = true; v.paramIndex = def.index; v.paramType = def.type; v.debugName ??= parameterNames[def.index] ?? null; }
      if (def.kind === 'move-exception') v.isCatch = true;
    }
    w.var = v; ir.vars.push(v);
  }
  for (const d of paramDefs) { const w = webOf(d); if (!ir.params.some(p => p.var === w.var) && defs[d].kind === 'param') ir.params.push({ var: w.var, type: defs[d].type }); }
}
function localRanges(ir) {
  const out = new Map(), open = new Map(), end = ir.code.units.length;
  for (const item of ir.debug.items) {
    if (item.kind !== 'local' && item.kind !== 'end-local' && item.kind !== 'restart-local') continue;
    const prev = open.get(item.register);
    if (prev) { prev.end = item.address; open.delete(item.register); }
    if ((item.kind === 'local' || item.kind === 'restart-local') && item.name) {
      const l = { start: item.address, end, name: item.name, type: item.type }; open.set(item.register, l);
      if (!out.has(item.register)) out.set(item.register, []); out.get(item.register).push(l);
    }
  }
  return out;
}

// statements of each block, with the single-use temporaries folded in
function buildStatements(ir) {
  const { blocks, instructions, cls, dex, m } = ir;
  const inlinable = (w, defIns, blockId) => {
    if (!w || w.named || w.defs.length !== 1 || w.uses.length !== 1) return false;
    const def = ir.defs[w.defs[0]]; if (def.ins !== defIns || def.kind === 'move-exception') return false;
    const use = w.uses[0]; return ir.blockOfIns[use.ins] === blockId && use.ins > defIns;
  };
  // constants: a register set once to a literal (not a named local) is that literal at each of its uses
  for (const w of ir.webs.values()) {
    if (w.named || w.defs.length !== 1 || !w.uses.length) continue;
    const def = ir.defs[w.defs[0]]; if (def.ins < 0 || def.kind !== 'const') continue;
    const ins = instructions[def.ins];
    if (ins.op >= 0x12 && ins.op <= 0x19) w.constant = { k: 'lit', v: ins.lit, wide: cls[def.ins].wide };
    else if (ins.op === 0x1a || ins.op === 0x1b) w.constant = { k: 'str', s: dex.string(ins.ref) };
  }
  for (const b of blocks) {
    if (!ir.reachable[b.id]) { b.unreachable = true; continue; }
    const pending = new Map(); let order = 0;
    // pcs that run before statements written ahead of the one they are folded into (a new-instance before the arguments of its constructor that became statements of
    // their own): they belong to the first statement written after them, so a step by Java line and a stop there follow the order the code runs in
    const moved = [];
    const stmts = b.stmts;
    const flushEntry = (w) => {
      const p = pending.get(w); if (!p) return; pending.delete(w);
      if (p.e.k === 'uninit') { w.var.uninit = true; w.var.type = p.e.t; moved.push({ at: p.at, pcs: p.pcs }); return; }   // new-instance: the object is shown where its constructor runs
      stmts.push({ k: 'assign', v: w.var, e: p.e, pcs: p.pcs }); w.var.materialized = true;
    };
    // Order: every operation with an effect or a read of memory (a call, a field or array read, a store, a throwing operation) gets a number as it is met; a folded
    // expression evaluates its numbers in its operands' order, and they must come out increasing. A statement written here must not pass a folded one either.
    const minAtom = p => p.atoms.length ? p.atoms[0] : Infinity;
    const flushImpure = () => { for (const [w, p] of [...pending].sort((x, y) => minAtom(x[1]) - minAtom(y[1]))) if (p.atoms.length) flushEntry(w); };
    const flushReaders = (web) => { for (const [w, p] of [...pending]) if (p.reads.has(web.var)) flushEntry(w); };
    for (let i = b.first; i <= b.last; i++) {
      const ins = instructions[i], c = cls[i], webs = ir.useWebs[i] ?? [];
      if (c.kind === 'nop' || c.kind === 'payload') continue;
      if (c.kind === 'bad') throw new Error(`an unknown instruction at pc ${ins.pc}`);
      const willPend = c.def >= 0 && inlinable(ir.defWeb[i], i, b.id);
      const impureHere = !willPend && (['invoke', 'init', 'store', 'monitor', 'throw', 'return', 'if', 'switch', 'move-exception'].includes(c.kind) || canThrow(ins.op));
      const consumed = webs.map(w => w.constant ? null : pending.get(w) ?? null);
      const atomsIn = consumed.flatMap(p => p?.atoms ?? []);
      let ordered = true;
      for (let k = 1; k < atomsIn.length; k++) if (atomsIn[k] <= atomsIn[k - 1]) ordered = false;
      if (impureHere) for (const p of pending.values()) if (p.atoms.length && !consumed.includes(p)) ordered = false;
      if (!ordered) flushImpure();
      const atoms = [], pcs = [ins.pc];
      const operand = (slot, expectType = null) => {
        const w = webs[slot], p = pending.get(w);
        let e;
        if (w.constant) e = { ...w.constant };
        else if (p) { pending.delete(w); if (p.at < stmts.length) moved.push({ at: p.at, pcs: p.pcs }); else pcs.push(...p.pcs); atoms.push(...p.atoms); e = p.e; }
        else e = { k: 'var', v: w.var };
        if (expectType) expect(e, expectType);
        return e;
      };
      const built = semantics(ir, ins, c, operand, b);
      if (built.term) { b.term = { ...built.term, pcs }; continue; }
      if (built.stmt) { stmts.push({ ...built.stmt, pcs }); continue; }
      if (built.def) {
        const w = ir.defWeb[i]; if (!w || w.constant) continue;
        flushReaders(w);
        if (built.def.k === 'uninit' && !inlinable(w, i, b.id)) { w.var.uninit = true; moved.push({ at: stmts.length, pcs }); w.var.type = built.def.t; continue; }
        noteDefType(w.var, built.def);
        if (inlinable(w, i, b.id)) { if (!selfPure(built.def)) atoms.push(order++); pending.set(w, { e: built.def, pcs, atoms, reads: varsOf(built.def), at: stmts.length }); continue; }
        if (!w.uses.length && !isPure(built.def) && built.def.k !== 'caught' && built.def.k !== 'new') { stmts.push({ k: 'expr', e: built.def, pcs }); continue; }
        if (built.def.k === 'caught') { stmts.push({ k: 'catch-var', v: w.var, e: built.def, pcs }); continue; }
        stmts.push({ k: 'assign', v: w.var, e: built.def, pcs });
      }
    }
    for (const w of [...pending.keys()].sort((x, y) => minAtom(pending.get(x)) - minAtom(pending.get(y)))) flushEntry(w);
    if (!b.term) {
      const c = cls[b.last];
      if (c.kind === 'return' || c.kind === 'throw') b.term = { k: 'end', pcs: [] };
      else b.term = { k: 'goto', to: b.succ[0] ?? -1, pcs: [], implicit: true };
    }
    for (const m of moved) (m.at < stmts.length ? stmts[m.at] : b.term).pcs.push(...m.pcs);
  }
}
function expect(e, t) {
  if (!t || !e) return;
  if (e.k === 'lit' && !e.t) e.t = t;
  else if (e.k === 'var') e.v.expect.push(t);
}
function noteDefType(v, e) { if (e.k === 'aget' && !e.t) return; const t = staticTypeOf(e); if (t) v.defTypes.push(t); }
/** The type of an expression as far as it is known when built (vars resolve later). */
function staticTypeOf(e) {
  switch (e.k) {
    case 'str': return STRING;
    case 'cls': return 'Ljava/lang/Class;';
    case 'call': return e.m.result === 'V' ? null : e.m.result;
    case 'new': case 'newarr': case 'arrlit': case 'cast': return e.t;
    case 'iget': case 'sget': return e.f.type;
    case 'aget': { if (e.t) return e.t; const at = staticTypeOf(e.a); return at?.[0] === '[' ? at.slice(1) : e.variant === 1 ? 'J' : e.variant === 2 ? OBJECT : e.variant === 0 ? 'I' : null; }
    case 'inst': return 'Z';
    case 'alen': case 'cmp': return 'I';
    case 'bin': return e.t;
    case 'un': return e.t;
    case 'caught': return e.t;
    case 'lit': return e.t ?? null;
    case 'raw': return e.t ?? null;
    case 'var': return e.v.type ?? null;
    case 'not': case 'rel': case 'relz': case 'and': case 'or': return 'Z';
    default: return null;
  }
}

/** One instruction as { def: expr } | { stmt } | { term }; `operand(slot, expectedType)` takes the operand (a folded temporary or a variable). */
function semantics(ir, ins, c, operand, block) {
  const dex = ir.dex, op = ins.op, m = ir.m;
  const field = () => dex.field(ins.ref), method = () => dex.method(ins.ref);
  switch (c.kind) {
    case 'move': case 'move-result': return { def: operand(0) };
    case 'move-exception': {
      const types = []; for (const con of ir.constructs) con.handlers.forEach((h, k) => { if (con.handlerBlocks[k] === block.id) types.push(h.type ?? 'Ljava/lang/Throwable;'); });
      return { def: { k: 'caught', t: types.length === 1 ? types[0] : 'Ljava/lang/Throwable;' } };
    }
    case 'return': return op === 0x0e ? { term: { k: 'return', e: null } } : { term: { k: 'return', e: operand(0, m.result) } };
    case 'throw': return { term: { k: 'throw', e: operand(0, 'Ljava/lang/Throwable;') } };
    case 'goto': return { term: { k: 'goto', to: ir.blockAtPc(ins.target) } };
    case 'monitor': return { stmt: { k: 'monitor', enter: op === 0x1d, e: operand(0, OBJECT) } };
    case 'const': {
      if (op === 0x1a || op === 0x1b) return { def: { k: 'str', s: dex.string(ins.ref) } };
      if (op === 0x1c) return { def: { k: 'cls', t: dex.type(ins.ref) } };
      if (op === 0xfe) return { def: { k: 'raw', text: `/* method handle ${valueText(dex, { t: 'methodHandle', v: ins.ref })} */ null`, t: 'Ljava/lang/invoke/MethodHandle;' } };
      if (op === 0xff) return { def: { k: 'raw', text: `/* method type ${valueText(dex, { t: 'methodType', v: ins.ref })} */ null`, t: 'Ljava/lang/invoke/MethodType;' } };
      return { def: { k: 'lit', v: ins.lit, wide: c.wide } };
    }
    case 'new-instance': return { def: { k: 'uninit', t: dex.type(ins.ref) } };
    case 'init': {
      const mm = method(), recv = operand(0), args = mm.parameters.map((t, k) => operand(k + 1, t));
      if (recv.k === 'uninit' || (recv.k === 'var' && recv.v.uninit)) return c.def >= 0 ? { def: { k: 'new', t: mm.owner, m: mm, args } } : { stmt: { k: 'expr', e: { k: 'new', t: mm.owner, m: mm, args } } };
      if (c.def < 0) return { stmt: { k: 'expr', e: { k: 'ctor', which: mm.owner === m.owner ? 'this' : 'super', m: mm, args } } };
      return { def: { k: 'call', kind: 'direct', m: mm, recv, args } };
    }
    case 'invoke': {
      if (op === 0xfc || op === 0xfd) {
        const regs = c.reads.map((_, k) => operand(k)), label = `call_site_${ins.ref}`;
        return c.def >= 0 ? { def: { k: 'raw', text: `/* invoke-custom ${label} */ invokeCustom`, args: regs, t: null } } : { stmt: { k: 'expr', e: { k: 'raw', text: `/* invoke-custom ${label} */ invokeCustom`, args: regs } } };
      }
      const mm = method(), isStatic = op === 0x71 || op === 0x77;
      const kind = op === 0x6f || op === 0x75 ? 'super' : op === 0x72 || op === 0x78 ? 'interface' : isStatic ? 'static' : op === 0x70 || op === 0x76 ? 'direct' : 'virtual';
      const recv = isStatic ? null : operand(0, mm.owner);
      const args = mm.parameters.map((t, k) => operand(k + (isStatic ? 0 : 1), t));
      const call = { k: 'call', kind, m: mm, recv, args };
      if (op === 0xfa || op === 0xfb) call.poly = dex.proto(ins.proto);
      return c.def >= 0 ? { def: call } : { stmt: { k: 'expr', e: call } };
    }
    case 'store': {
      if (op >= 0x4b && op <= 0x51) { const a = operand(0), i = operand(1, 'I'); const elem = arrayElemType(a, op - 0x4b); const v = operand(2, elem); return { stmt: { k: 'store', target: { k: 'aget', a, i, t: elem, variant: op - 0x4b }, e: v } }; }
      if (op >= 0x59 && op <= 0x5f) { const f = field(), o = operand(0, f.owner), v = operand(1, f.type); return { stmt: { k: 'store', target: { k: 'iget', o, f }, e: v } }; }
      const f = field(); return { stmt: { k: 'store', target: { k: 'sget', f }, e: operand(0, f.type) } };
    }
    case 'if': {
      const target = ir.blockAtPc(ins.target);
      if (op <= 0x37) { const a = operand(0), b = operand(1); return { term: { k: 'if', cond: { k: 'rel', op: IF_OPS[op - 0x32], a, b, fp: false }, t: target, f: block.succ[1] } }; }
      const a = operand(0), sym = IF_OPS[op - 0x38];
      if (a.k === 'cmp') return { term: { k: 'if', cond: cmpCondition(a, sym), t: target, f: block.succ[1] } };
      return { term: { k: 'if', cond: { k: 'relz', op: sym, a }, t: target, f: block.succ[1] } };
    }
    case 'switch': {
      const payload = payloadAt(ir.instructions, ir.indexOf, ins.target), e = operand(0, 'I');
      const keys = payload?.kind === 'packed' ? payload.targets.map((_, k) => payload.first + k) : payload?.keys ?? [];
      const cases = (payload?.targets ?? []).map((off, k) => ({ key: keys[k], to: ir.blockAtPc(ins.pc + off) }));
      return { term: { k: 'switch', e, cases, dflt: block.succ.at(-1) } };
    }
    default: break;
  }
  // value instructions
  if (op === 0x1f) { const t = dex.type(ins.ref); return { def: { k: 'cast', t, a: operand(0) } }; }
  if (op === 0x20) return { def: { k: 'inst', a: operand(0), t: dex.type(ins.ref) } };
  if (op === 0x21) return { def: { k: 'alen', a: operand(0) } };
  if (op === 0x23) { const t = dex.type(ins.ref); return { def: { k: 'newarr', t, len: operand(0, 'I') } }; }
  if (op === 0x24 || op === 0x25) { const t = dex.type(ins.ref); return { def: { k: 'arrlit', t, items: c.reads.map((_, k) => operand(k, t.slice(1))) } }; }
  if (op === 0x26) {
    const arr = operand(0), payload = payloadAt(ir.instructions, ir.indexOf, ins.target);
    if (arr.k === 'newarr' && arr.len.k === 'lit' && payload && Number(arr.len.v) === payload.values.length) return { def: { k: 'arrlit', t: arr.t, items: payload.values.map(v => ({ k: 'lit', v, wide: payload.width === 8, t: arr.t.slice(1) })) } };
    throw new Error(`fill-array-data at pc ${ins.pc} does not follow its new-array`);
  }
  if (op >= 0x2d && op <= 0x31) { const fp = op <= 0x30, t = op <= 0x2e ? 'F' : op <= 0x30 ? 'D' : 'J'; return { def: { k: 'cmp', a: operand(0, t), b: operand(1, t), fp, bias: op === 0x2d || op === 0x2f ? -1 : 1 } }; }
  if (op >= 0x44 && op <= 0x4a) { const a = operand(0), i = operand(1, 'I'); return { def: { k: 'aget', a, i, t: arrayElemType(a, op - 0x44), variant: op - 0x44 } }; }
  if (op >= 0x52 && op <= 0x58) { const f = field(); return { def: { k: 'iget', o: operand(0, f.owner), f } }; }
  if (op >= 0x60 && op <= 0x66) return { def: { k: 'sget', f: field() } };
  if (op >= 0x7b && op <= 0x8f) {
    const [sym, from, to] = UNARY[op - 0x7b], a = operand(0, from);
    if (sym === 'cast') return { def: { k: 'cast', t: to, a, from } };
    return { def: { k: 'un', op: sym, a, t: to } };
  }
  if ((op >= 0x90 && op <= 0xaf) || (op >= 0xb0 && op <= 0xcf)) {
    const { sym, t } = binInfo(op), shift = sym === '<<' || sym === '>>' || sym === '>>>';
    const a = operand(0, t), b = operand(1, shift ? 'I' : t);
    return { def: { k: 'bin', op: sym, a, b, t } };
  }
  if (op >= 0xd0 && op <= 0xe2) {
    const lit = { k: 'lit', v: ins.lit, wide: false, t: 'I' }, a = operand(0, 'I');
    const idx = op <= 0xd7 ? op - 0xd0 : op - 0xd8, names = op <= 0xd7 ? ['+', 'rsub', '*', '/', '%', '&', '|', '^'] : ['+', 'rsub', '*', '/', '%', '&', '|', '^', '<<', '>>', '>>>'];
    const sym = names[idx];
    if (sym === 'rsub') return { def: { k: 'bin', op: '-', a: lit, b: a, t: 'I' } };
    return { def: { k: 'bin', op: sym, a, b: lit, t: 'I' } };
  }
  throw new Error(`unsupported instruction ${ins.name} at pc ${ins.pc}`);
}
/** The element type of an aget / aput: the array's type when known now, the opcode's (boolean, byte, char, short) otherwise, or null (int or float, long or double,
 *  which object: known once the variables have their types; staticTypeOf asks again then). */
function arrayElemType(a, variant) {
  const at = staticTypeOf(a);
  if (at && at[0] === '[') return at.slice(1);
  return variant >= 3 ? AGET_TYPES[variant] : null;
}
/** cmp(a, b) OP 0 as a condition: a OP b when NaN gives the same answer, else !(a INV b). */
function cmpCondition(cmp, sym) {
  if (!cmp.fp) return { k: 'rel', op: sym, a: cmp.a, b: cmp.b, fp: false };
  const n = cmp.bias, nanResult = { '==': n === 0, '!=': n !== 0, '<': n < 0, '>=': n >= 0, '>': n > 0, '<=': n <= 0 }[sym];
  if (nanResult === (sym === '!=')) return { k: 'rel', op: sym, a: cmp.a, b: cmp.b, fp: true };
  return { k: 'not', a: { k: 'rel', op: NEGATE[sym], a: cmp.a, b: cmp.b, fp: true } };
}
function negate(c) {
  switch (c.k) {
    case 'not': return c.a;
    case 'rel': return c.fp ? { k: 'not', a: c } : { ...c, op: NEGATE[c.op] };
    case 'relz': return { ...c, op: NEGATE[c.op] };
    case 'and': return { k: 'or', a: negate(c.a), b: negate(c.b) };
    case 'or': return { k: 'and', a: negate(c.a), b: negate(c.b) };
    default: return { k: 'not', a: c };
  }
}

// ---- the control-flow graph: collapse, short-circuit conditions, dominators, loops, try regions ------------------------------------------------------------------------
function succOf(b) {
  const t = b.term; if (!t) return [];
  switch (t.k) {
    case 'if': return [t.t, t.f];
    case 'goto': return t.to >= 0 ? [t.to] : [];
    case 'switch': return [...t.cases.map(c => c.to), t.dflt];
    default: return [];
  }
}
function retarget(b, from, to) {
  const t = b.term; if (!t) return;
  if (t.k === 'if') { if (t.t === from) t.t = to; if (t.f === from) t.f = to; }
  else if (t.k === 'goto') { if (t.to === from) t.to = to; }
  else if (t.k === 'switch') { for (const c of t.cases) if (c.to === from) c.to = to; if (t.dflt === from) t.dflt = to; }
}
function prepareGraph(ir) {
  const { blocks, constructs } = ir;
  const live = new Set(blocks.filter(b => !b.unreachable).map(b => b.id));
  const protectedBlocks = new Set([0]);
  for (const c of constructs) { protectedBlocks.add(c.entryBlock); for (const h of c.handlerBlocks) protectedBlocks.add(h); }
  const inConstructs = b => constructs.filter(c => c.ranges.some(([s, e]) => blocks[b].pc >= s && blocks[b].pc < e)).map(c => constructs.indexOf(c)).join(',');
  const recomputePreds = () => { for (const id of live) blocks[id].preds = []; for (const id of live) for (const s of new Set(succOf(blocks[id]))) if (live.has(s)) blocks[s].preds.push(id); };
  // 1. blocks that only jump: their predecessors jump to the target
  for (const id of [...live]) {
    const b = blocks[id];
    if (protectedBlocks.has(id) || b.stmts.length || b.term?.k !== 'goto' || b.term.to === id || b.term.to < 0) continue;
    let target = b.term.to, hops = 0;
    while (!protectedBlocks.has(target) && blocks[target].term?.k === 'goto' && !blocks[target].stmts.length && blocks[target].term.to !== target && blocks[target].term.to >= 0 && hops++ < 64) target = blocks[target].term.to;
    if (target === id) continue;
    for (const p of live) retarget(blocks[p], id, target);
    live.delete(id); b.collapsed = target;
  }
  recomputePreds();
  // 2. chains of ifs that are one condition: a && b, a || b
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...live].sort((a, b) => b - a)) {
      const A = blocks[id]; if (!live.has(id) || A.term?.k !== 'if') continue;
      for (const which of ['f', 't']) {
        const bid = A.term[which], B = blocks[bid];
        if (bid === id || !live.has(bid) || protectedBlocks.has(bid) || B.stmts.length || B.term?.k !== 'if' || B.preds.length !== 1 || inConstructs(bid) !== inConstructs(id)) continue;
        const a = A.term, bt = B.term; let cond = null, t, f;
        if (which === 'f') {   // A false -> B
          if (bt.t === a.t) { cond = { k: 'or', a: a.cond, b: bt.cond }; t = a.t; f = bt.f; }
          else if (bt.f === a.t) { cond = { k: 'or', a: a.cond, b: negate(bt.cond) }; t = a.t; f = bt.t; }
        } else {               // A true -> B
          if (bt.f === a.f) { cond = { k: 'and', a: a.cond, b: bt.cond }; t = bt.t; f = a.f; }
          else if (bt.t === a.f) { cond = { k: 'and', a: a.cond, b: negate(bt.cond) }; t = bt.f; f = a.f; }
        }
        if (!cond || t === bid || f === bid) continue;
        A.term = { k: 'if', cond, t, f, pcs: [...a.pcs, ...bt.pcs] };
        live.delete(bid); B.merged = id; changed = true; recomputePreds(); break;
      }
    }
  }
  recomputePreds();
  const ids = [...live].sort((a, b) => a - b);
  // dominators (normal and exception edges), post-dominators (normal edges, to a virtual exit)
  const allSucc = id => [...succOf(blocks[id]), ...blocks[id].exc].filter(s => live.has(s));
  const idom = dominators(ids, 0, allSucc);
  const EXIT = -2, normalSucc = id => succOf(blocks[id]).filter(s => live.has(s));
  const rev = new Map(ids.map(id => [id, []])); rev.set(EXIT, []);
  for (const id of ids) { const s = normalSucc(id); if (!s.length) rev.get(EXIT).push(id); for (const x of s) rev.get(x).push(id); }
  const ipdom = dominators([EXIT, ...ids], EXIT, id => rev.get(id) ?? []);
  const dominates = (a, b) => { for (let x = b, guard = 0; x !== undefined && guard < 100000; guard++) { if (x === a) return true; const up = idom.get(x); if (up === x) break; x = up; } return false; };
  // loops
  const order = rpo(ids, 0, allSucc), rank = new Map(order.map((id, i) => [id, i]));
  const excPreds = new Map(); for (const id of ids) for (const h of blocks[id].exc) if (live.has(h)) { if (!excPreds.has(h)) excPreds.set(h, []); excPreds.get(h).push(id); }
  const loops = new Map();
  for (const u of ids) for (const h of normalSucc(u)) {
    if (!rank.has(u) || !rank.has(h) || rank.get(h) > rank.get(u)) continue;
    if (!dominates(h, u)) giveUp(`a loop has two entries (irreducible flow at pc ${blocks[h].pc})`);
    let L = loops.get(h); if (!L) loops.set(h, L = { header: h, body: new Set([h]), latches: [] });
    L.latches.push(u);
    const stack = [u];
    while (stack.length) { const x = stack.pop(); if (L.body.has(x)) continue; L.body.add(x); for (const p of blocks[x].preds) stack.push(p); for (const p of excPreds.get(x) ?? []) stack.push(p); }
  }
  for (const L of loops.values()) {
    const exits = new Map();
    for (const x of L.body) for (const s of normalSucc(x)) if (!L.body.has(s)) exits.set(s, (exits.get(s) ?? 0) + (x === L.header ? 100 : L.latches.includes(x) ? 60 : 10));
    for (const [s] of exits) if (!normalSucc(s).length && blocks[s].stmts.length <= 2) exits.set(s, exits.get(s) - 50);
    L.follow = exits.size ? [...exits].sort((a, b) => b[1] - a[1] || blocks[a[0]].pc - blocks[b[0]].pc)[0][0] : null;
    const latch = L.latches.length === 1 ? L.latches[0] : null, lb = latch === null ? null : blocks[latch];
    L.continueTarget = lb && latch !== L.header && lb.term?.k === 'goto' && lb.term.to === L.header && lb.stmts.length && lb.stmts.every(s => s.k === 'assign' || s.k === 'expr' || s.k === 'store') && !protectedBlocks.has(latch) ? latch : null;
  }
  // try regions
  for (const c of constructs) {
    c.handlerRegions = c.handlerBlocks.map(h => new Set(live.has(h) ? ids.filter(x => dominates(h, x)) : []));
    const handlerAll = new Set(c.handlerRegions.flatMap(r => [...r]));
    c.region = new Set(ids.filter(x => !handlerAll.has(x) && c.ranges.some(([s, e]) => blocks[x].pc >= s && blocks[x].pc < e)));
    if (!live.has(c.entryBlock) || !c.region.has(c.entryBlock)) { c.dead = true; continue; }
    // code that cannot throw between covered code (a loop's i++ and jump back, which d8 leaves out of the range) belongs to the try
    const throwsIn = x => { const b = blocks[x]; for (let i = b.first; i <= b.last; i++) if (canThrow(ir.instructions[i].op)) return true; return false; };
    const queue = [...c.region].flatMap(x => normalSucc(x));
    while (queue.length) {
      const x = queue.pop();
      if (c.region.has(x) || handlerAll.has(x) || !blocks[x].preds.length || throwsIn(x) || !blocks[x].preds.every(p => c.region.has(p)) || !normalSucc(x).length || !normalSucc(x).every(s => c.region.has(s))) continue;
      c.region.add(x); queue.push(...normalSucc(x));
    }
    for (const x of c.region) if (x !== c.entryBlock) for (const p of blocks[x].preds) if (!c.region.has(p)) giveUp(`a try block is entered in its middle (pc ${blocks[x].pc})`);
    const exits = new Map(), add = s => exits.set(s, (exits.get(s) ?? 0) + 1);
    for (const x of c.region) for (const s of normalSucc(x)) if (!c.region.has(s) && (!handlerAll.has(s) || c.handlerBlocks.includes(s))) add(s);   // an empty catch whose block is also where the try goes on
    if (!exits.size) for (const r of c.handlerRegions) for (const x of r) for (const s of normalSucc(x)) if (!r.has(s)) add(s);
    c.follow = exits.size ? [...exits].sort((a, b) => b[1] - a[1] || blocks[a[0]].pc - blocks[b[0]].pc)[0][0] : null;
  }
  const liveConstructs = constructs.filter(c => !c.dead);
  for (const a of liveConstructs) for (const b of liveConstructs) {
    if (a === b) continue;
    let inter = 0; for (const x of a.region) if (b.region.has(x)) inter++;
    if (inter && inter !== a.region.size && inter !== b.region.size) giveUp('two try blocks overlap without nesting');
  }
  return { live, ids, idom, ipdom, loops, constructs: liveConstructs, dominates, normalSucc, EXIT, rank };
}
function rpo(ids, entry, succ) {
  const seen = new Set([entry]), out = [], stack = [[entry, 0]];
  while (stack.length) {
    const top = stack.at(-1), list = succ(top[0]);
    if (top[1] < list.length) { const n = list[top[1]++]; if (!seen.has(n)) { seen.add(n); stack.push([n, 0]); } }
    else { out.push(top[0]); stack.pop(); }
  }
  return out.reverse();
}
/** Immediate dominators (Cooper, Harvey and Kennedy's iteration): Map node -> idom (the entry maps to itself; unreachable nodes are absent). */
function dominators(ids, entry, succ) {
  const order = rpo(ids, entry, succ), index = new Map(order.map((n, i) => [n, i])), preds = new Map(order.map(n => [n, []]));
  for (const n of order) for (const s of succ(n)) if (index.has(s)) preds.get(s).push(n);
  const idom = new Map([[entry, entry]]);
  const intersect = (a, b) => { while (a !== b) { while (index.get(a) > index.get(b)) a = idom.get(a); while (index.get(b) > index.get(a)) b = idom.get(b); } return a; };
  let changed = true, guard = 0;
  while (changed && guard++ < 1000) {
    changed = false;
    for (const n of order) {
      if (n === entry) continue;
      let next = null; for (const p of preds.get(n)) if (idom.has(p)) next = next === null ? p : intersect(p, next);
      if (next !== null && idom.get(n) !== next) { idom.set(n, next); changed = true; }
    }
  }
  return idom;
}

// ---- structuring ------------------------------------------------------------------------------------------------------------------------------------------------------
function structure(ir) {
  const G = prepareGraph(ir), blocks = ir.blocks;
  const S = { emitted: new Set(), entered: new Set(), opened: new Set() };
  const ipdomOf = id => { const p = G.ipdom.get(id); return p === undefined || p === G.EXIT ? null : p; };
  const tryAt = id => G.constructs.find(c => c.entryBlock === id && !S.opened.has(c)) ?? null;
  const throws = id => { const b = blocks[id]; for (let i = b.first; i <= b.last; i++) if (canThrow(ir.instructions[i].op)) return true; return false; };
  const duplicable = id => { const b = blocks[id]; return b.term?.k === 'return' && b.stmts.length <= 2 && !throws(id); };
  const innermost = (ctx, kind) => { for (let k = ctx.stack.length - 1; k >= 0; k--) if (ctx.stack[k].kind === kind) return ctx.stack[k]; return null; };
  /** The jump that reaching block `id` means here (continue, break), or null. `probe`: only ask, record nothing. */
  function jumpFor(id, ctx, probe = false) {
    for (let k = ctx.stack.length - 1; k >= 0; k--) {
      const f = ctx.stack[k], inner = ctx.stack.slice(k + 1);
      const anyBreakable = inner.some(x => x.kind === 'loop' || x.kind === 'switch'), anyLoop = inner.some(x => x.kind === 'loop');
      if (f.kind === 'loop') {
        if (id === f.continueTarget || id === f.header) {
          if (!probe) { if (id === f.header && f.continueTarget !== null) f.headerContinue = true; else if (id === f.continueTarget) f.continues++; if (anyLoop) f.label = true; }
          return { k: 'continue', frame: f, labeled: anyLoop };
        }
        if (id === f.follow) { if (!probe && anyBreakable) f.label = true; return { k: 'break', frame: f, labeled: anyBreakable }; }
      } else if (f.kind === 'switch' && id === f.follow && id !== null) { if (!probe && anyBreakable) f.label = true; return { k: 'break', frame: f, labeled: anyBreakable }; }
    }
    return null;
  }
  const insideRegion = (id, ctx) => {
    const loop = innermost(ctx, 'loop'); if (loop && !loop.body.has(id)) return false;
    const t = innermost(ctx, 'try'); if (t && !t.region.has(id)) return false;
    return true;
  };
  /** Where the branches of block `id` meet again: its post-dominator, or (when returns make every block's post-dominator the exit) the first block, in flow order, that two
   *  branches reach without leaving the current loop or passing a jump. */
  const joinOf = (id, ctx) => {
    const heads = [...new Set(G.normalSucc(id))]; if (heads.length < 2) return null;
    const loop = innermost(ctx, 'loop'), stop = new Set([id]);
    for (const f of ctx.stack) { if (f.kind === 'loop') { stop.add(f.header); if (f.continueTarget !== null) stop.add(f.continueTarget); if (f.follow !== null) stop.add(f.follow); } if (f.kind === 'switch' && f.follow !== null) stop.add(f.follow); }
    const count = new Map();
    for (const h of heads) {
      if (stop.has(h)) continue;
      const seen = new Set([h]), queue = [h];
      while (queue.length) { const x = queue.pop(); for (const s of G.normalSucc(x)) if (!seen.has(s) && !stop.has(s) && (!loop || loop.body.has(s))) { seen.add(s); queue.push(s); } }
      for (const x of seen) count.set(x, (count.get(x) ?? 0) + 1);
    }
    let best = null;
    for (const [x, n] of count) if (n >= 2 && (best === null || n > count.get(best) || (n === count.get(best) && G.rank.get(x) < G.rank.get(best)))) best = x;
    return best;
  };
  const mergeOf = (id, succ, ctx) => {
    const m = ipdomOf(id) ?? joinOf(id, ctx);
    if (m === null || m === succ || jumpFor(m, ctx, true) || !insideRegion(m, ctx) || S.emitted.has(m)) return null;
    return m;
  };
  function seq(start, succ, ctx, first = false) {
    const out = [];
    let cur = start, isFirst = first, jumpPcs = [];
    while (cur !== null && cur !== undefined && cur >= 0) {
      if (!isFirst) {
        if (cur === succ) { out.reachedSucc = true; break; }
        const j = jumpFor(cur, ctx);
        if (j) { out.push({ k: j.k, frame: j.frame, labeled: j.labeled, pcs: jumpPcs }); break; }
      }
      isFirst = false; jumpPcs = [];
      const loop = G.loops.get(cur), t = tryAt(cur);
      if (loop && !S.entered.has(cur) && !(t && [...loop.body].every(x => t.region.has(x) || t.handlerRegions.some(r => r.has(x))))) { const r = structureLoop(loop, ctx); out.push(r.stmt); cur = r.next; continue; }
      if (t) { const r = structureTry(t, ctx, out); out.push(r.stmt); cur = r.next; continue; }
      const b = blocks[cur];
      if (S.emitted.has(cur)) {
        if (duplicable(cur)) { out.push(...b.stmts.map(s => ({ ...s })), { k: 'return', e: b.term.e, pcs: b.term.pcs }); break; }
        giveUp(`the code at pc ${b.pc} is reached from two places that the structure cannot express`);
      }
      const tf = innermost(ctx, 'try');
      if (tf && !tf.region.has(cur) && throws(cur)) giveUp(`code after a try block (pc ${b.pc}) is reached from inside it`);
      S.emitted.add(cur);
      out.push(...b.stmts);
      const term = b.term;
      if (term.k === 'return' || term.k === 'throw') { out.push({ k: term.k, e: term.e, pcs: term.pcs }); break; }
      if (term.k === 'end') break;
      if (term.k === 'goto') { cur = term.to; jumpPcs = term.pcs; continue; }
      if (term.k === 'if') {
        const m = mergeOf(cur, succ, ctx), bsucc = m ?? succ;
        const thenS = seq(term.f, bsucc, ctx), elseS = seq(term.t, bsucc, ctx);
        out.push({ k: 'if', cond: negate(term.cond), then: thenS, else: elseS, pcs: term.pcs });
        cur = m; continue;
      }
      if (term.k === 'switch') {
        const m = mergeOf(cur, succ, ctx), follow = m ?? succ, frame = { kind: 'switch', follow, label: null };
        const groups = new Map();
        for (const c of term.cases) { if (!groups.has(c.to)) groups.set(c.to, { keys: [], isDefault: false, block: c.to }); groups.get(c.to).keys.push(c.key); }
        if (term.dflt !== follow) { if (!groups.has(term.dflt)) groups.set(term.dflt, { keys: [], isDefault: true, block: term.dflt }); else groups.get(term.dflt).isDefault = true; }
        const cases = [...groups.values()].sort((a, b) => blocks[a.block].pc - blocks[b.block].pc);
        const inner = { stack: [...ctx.stack, frame] };
        let fallsThrough = false;
        cases.forEach((c, i) => {
          const next = i + 1 < cases.length ? cases[i + 1].block : follow;
          if (c.block === follow) { c.body = [{ k: 'break', frame, labeled: false, pcs: [] }]; return; }
          c.body = seq(c.block, next, inner);
          if (c.body.reachedSucc) { if (i + 1 < cases.length) fallsThrough = true; else c.body.push({ k: 'break', frame, labeled: false, pcs: [] }); }
        });
        // no case falls into the next: in key order, the default last, as written (a case that ends at the end of the switch says break)
        if (!fallsThrough) cases.sort((a, b) => (a.isDefault - b.isDefault) || (Math.min(...a.keys) - Math.min(...b.keys)));
        const lastCase = cases.at(-1);
        if (lastCase && lastCase.body.length && lastCase.body.at(-1).k === 'break' && lastCase.body.at(-1).frame === frame && !lastCase.body.at(-1).pcs.length) lastCase.body.pop();
        out.push({ k: 'switch', e: term.e, cases, frame, pcs: term.pcs });
        cur = m; continue;
      }
      giveUp(`an unknown block end at pc ${b.pc}`);
    }
    return out;
  }
  function structureLoop(L, ctx) {
    S.entered.add(L.header);
    const frame = { kind: 'loop', header: L.header, follow: L.follow, continueTarget: L.continueTarget, body: L.body, label: null, continues: 0, headerContinue: false };
    const body = seq(L.header, L.continueTarget ?? L.header, { stack: [...ctx.stack, frame] }, true);
    let update = [], updatePcs = [];
    if (L.continueTarget !== null) {
      if (S.emitted.has(L.continueTarget)) giveUp('a loop update is reached from outside its loop');
      S.emitted.add(L.continueTarget); update = blocks[L.continueTarget].stmts; updatePcs = blocks[L.continueTarget].term?.pcs ?? [];
      if (frame.headerContinue) giveUp('a loop continues both through its update and around it');
    }
    return { stmt: { k: 'loop', kind: 'while', cond: null, body, update, frame, pcs: [], backPcs: updatePcs }, next: L.follow };
  }
  function structureTry(c, ctx, before) {
    S.opened.add(c);
    const body = seq(c.entryBlock, c.follow, { stack: [...ctx.stack, { kind: 'try', region: c.region, follow: c.follow }] }, true);
    const byBlock = new Map();
    c.handlers.forEach((h, k) => { const hb = c.handlerBlocks[k]; if (!byBlock.has(hb)) byBlock.set(hb, { types: [], hb, region: c.handlerRegions[k] }); byBlock.get(hb).types.push(h.type); });
    const catches = [...byBlock.values()].map(g => {
      if (g.hb === c.follow) return { types: g.types, v: null, body: [], pcs: [] };
      if (S.emitted.has(g.hb)) giveUp(`a catch block (pc ${blocks[g.hb].pc}) is shared by two try blocks`);
      let hs = seq(g.hb, c.follow, { stack: [...ctx.stack, { kind: 'try', region: g.region, follow: c.follow }] }, true);
      let v = null, pcs = [];
      if (hs[0]?.k === 'catch-var') { v = hs[0].v; pcs = hs[0].pcs; hs = hs.slice(1); }
      return { types: g.types, v, body: hs, pcs };
    });
    let stmt = { k: 'try', body, catches, pcs: [] };
    // synchronized: monitor-enter x; try { ...; monitor-exit x } catch-all { monitor-exit x; throw }
    const enter = before.at(-1);
    if (enter?.k === 'monitor' && enter.enter && catches.length === 1 && catches[0].types.length === 1 && catches[0].types[0] === null) {
      const h = catches[0].body, lock = enter.e;
      if (h.length === 2 && h[0].k === 'monitor' && !h[0].enter && sameExpr(h[0].e, lock) && h[1].k === 'throw' && h[1].e?.k === 'var' && h[1].e.v === catches[0].v) {
        const exits = [];
        const strip = list => list.filter(s => { if (s.k === 'monitor' && !s.enter && sameExpr(s.e, lock)) { exits.push(...s.pcs); return false; } forEachChildList(s, strip); return true; });
        before.pop();
        stmt = { k: 'sync', e: lock, body: strip(body), pcs: enter.pcs, endPcs: [...exits, ...catches[0].pcs, ...h[0].pcs, ...h[1].pcs] };
      }
    }
    return { stmt, next: c.follow };
  }
  const body = seq(0, null, { stack: [] }, true);
  for (const id of G.live) if (!S.emitted.has(id)) giveUp(`the code at pc ${blocks[id].pc} is not reached by the structure`);
  return body;
}
function sameExpr(a, b) { return a === b || (a?.k === 'var' && b?.k === 'var' && a.v === b.v); }
/** Calls fn(list) for each statement list inside `s` and stores what fn returns back in place. */
function forEachChildList(s, fn) {
  switch (s.k) {
    case 'if': s.then = fn(s.then); s.else = fn(s.else); break;
    case 'loop': s.body = fn(s.body); break;
    case 'switch': for (const c of s.cases) c.body = fn(c.body); break;
    case 'try': s.body = fn(s.body); for (const c of s.catches) c.body = fn(c.body); break;
    case 'sync': s.body = fn(s.body); break;
  }
}
const childLists = s => s.k === 'if' ? [s.then, s.else] : s.k === 'loop' ? [s.body] : s.k === 'switch' ? s.cases.map(c => c.body) : s.k === 'try' ? [s.body, ...s.catches.map(c => c.body)] : s.k === 'sync' ? [s.body] : [];

// ---- tidying: while / do-while / for, empty branches, the last return ------------------------------------------------------------------------------------------------
function hasJumpTo(list, frame, kind) {
  for (const s of list) { if (s.k === kind && s.frame === frame) return true; for (const l of childLists(s)) if (hasJumpTo(l, frame, kind)) return true; }
  return false;
}
function tidy(body, ir) {
  const isVoid = ir.m.result === 'V';
  const tidyList = list => {
    for (const s of list) forEachChildList(s, tidyList);
    for (const s of list) {
      if (s.k === 'if' && !s.then.length && s.else.length) { s.cond = negate(s.cond); s.then = s.else; s.else = []; }
      if (s.k === 'loop') tidyLoop(s);
    }
    // if (c) { ...; return; } else { rest }  ->  if (c) { ...; return; } rest   (and the shorter exiting branch first: a guard)
    const exits = l => ['return', 'throw', 'break', 'continue'].includes(l.at(-1)?.k);
    for (let i = 0; i < list.length; i++) {
      const s = list[i]; if (s.k !== 'if' || !s.else.length) continue;
      if (exits(s.else) && (!exits(s.then) || s.else.length < s.then.length) && s.else.length <= s.then.length) { s.cond = negate(s.cond); [s.then, s.else] = [s.else, s.then]; }
      if (exits(s.then) && !(s.else.length === 1 && s.else[0].k === 'if')) { list.splice(i + 1, 0, ...s.else); s.else = []; }
    }
    // for (init; cond; update) from i = 0; while (cond) { ...; i++; }
    for (let i = list.length - 1; i > 0; i--) {
      const s = list[i], prev = list[i - 1];
      if (s.k !== 'loop' || s.kind !== 'while' || !s.cond || prev.k !== 'assign' || hasJumpTo(s.body, s.frame, 'continue')) continue;
      const last = s.body.at(-1), v = prev.v;
      if (last?.k !== 'assign' || last.v !== v || !varsOf(s.cond).has(v) || varsOf(prev.e).has(v)) continue;
      s.kind = 'for'; s.init = [prev]; s.update = [s.body.pop()]; list.splice(i - 1, 1); i--;
    }
    return list;
  };
  const tidyLoop = s => {
    const f = s.frame, isBreak = l => l.length === 1 && l[0].k === 'break' && l[0].frame === f;
    let body = s.body;
    while (body.length && body.at(-1).k === 'continue' && body.at(-1).frame === f) s.backPcs = [...(s.backPcs ?? []), ...body.pop().pcs];
    const first = body[0];
    if (first?.k === 'if') {
      if (isBreak(first.else)) { s.cond = first.cond; s.condPcs = first.pcs; body = [...first.then, ...body.slice(1)]; }
      else if (isBreak(first.then)) { s.cond = negate(first.cond); s.condPcs = first.pcs; body = [...first.else, ...body.slice(1)]; }
    }
    if (!s.cond && !s.update.length && !hasJumpTo(body, f, 'continue')) {
      const last = body.at(-1);
      if (last?.k === 'if' && isBreak(last.then) && !last.else.length) { s.kind = 'do'; s.cond = negate(last.cond); s.condPcs = last.pcs; body = body.slice(0, -1); }
      else if (last?.k === 'if' && isBreak(last.else) && !last.then.length) { s.kind = 'do'; s.cond = last.cond; s.condPcs = last.pcs; body = body.slice(0, -1); }
    }
    s.body = body;
    if (s.update.length) {
      if (hasJumpTo(body, f, 'continue') || f.continues > 0) { s.kind = 'for'; s.init = []; }
      else { s.body.push(...s.update); s.update = []; }
    }
  };
  tidyList(body);
  // if (c) { x = true; } else { x = false; }  ->  x = c;   if (c) { return true; } else { return false; }  ->  return c;
  const isBool = (s, kind, value) => s?.k === kind && s.e?.k === 'lit' && BigInt(s.e.v) === BigInt(value) && (kind === 'return' ? ir.m.result === 'Z' : s.v.type === 'Z');
  const booleans = list => {
    for (const s of list) forEachChildList(s, booleans);
    for (let i = 0; i < list.length; i++) {
      const s = list[i]; if (s.k !== 'if' || s.then.length !== 1 || s.else.length !== 1) continue;
      const [a] = s.then, [b] = s.else;
      for (const kind of ['assign', 'return']) {
        if (kind === 'assign' && !(a.k === 'assign' && b.k === 'assign' && a.v === b.v)) continue;
        if (isBool(a, kind, 1) && isBool(b, kind, 0)) list[i] = { ...a, e: s.cond, pcs: [...s.pcs, ...a.pcs, ...b.pcs] };
        else if (isBool(a, kind, 0) && isBool(b, kind, 1)) list[i] = { ...a, e: negate(s.cond), pcs: [...s.pcs, ...a.pcs, ...b.pcs] };
      }
    }
    return list;
  };
  booleans(body);
  // a temporary the structure had to keep in a variable, used right after: folded back (x = e; return x;  /  lock = this.lock; synchronized (lock) { ... })
  const counts = new Map(), count = e => { for (const v of varsOfAll(e)) counts.set(v, (counts.get(v) ?? 0) + 1); };
  const walkCount = list => { for (const s of list) { if (s.k === 'assign') counts.set(s.v, (counts.get(s.v) ?? 0) + 1); if (s.k === 'try') for (const c of s.catches) if (c.v) counts.set(c.v, 99); for (const e of stmtExprs(s)) count(e); for (const l of childLists(s)) walkCount(l); } };
  walkCount(body);
  const fold = list => {
    for (const s of list) forEachChildList(s, fold);
    for (let i = list.length - 2; i >= 0; i--) {
      const a = list[i], b = list[i + 1];
      if (a.k !== 'assign' || a.v.debugName || a.v.isParam || counts.get(a.v) !== 2) continue;
      const target = (b.k === 'return' || b.k === 'throw' || b.k === 'sync') && b.e?.k === 'var' && b.e.v === a.v ? 'e' : b.k === 'assign' && b.e?.k === 'var' && b.e.v === a.v ? 'e' : null;
      if (!target) continue;
      list[i + 1] = { ...b, e: a.e, pcs: [...a.pcs, ...b.pcs] }; list.splice(i, 1);
    }
    return list;
  };
  fold(body);
  // the last return of a void method is the closing brace (its pc stays mapped there)
  const last = body.at(-1);
  if (isVoid && last?.k === 'return' && !last.e) return body.pop().pcs;
  if (isVoid && last?.k === 'sync' && last.body.at(-1)?.k === 'return' && !last.body.at(-1).e) return last.body.pop().pcs;
  return [];
}
/** Every variable an expression reads, with repeats. */
function varsOfAll(e, out = []) { if (!e) return out; if (e.k === 'var') out.push(e.v); else for (const c of children(e)) varsOfAll(c, out); return out; }
/** The expressions a statement evaluates itself (not those of the statements inside it). */
function stmtExprs(s) {
  switch (s.k) {
    case 'assign': case 'expr': case 'return': case 'throw': case 'monitor': case 'sync': case 'switch': return s.e ? [s.e] : [];
    case 'store': return [s.target, s.e];
    case 'if': return [s.cond];
    case 'loop': return [s.cond, ...[...(s.init ?? []), ...s.update].flatMap(stmtExprs), ...[...(s.init ?? []), ...s.update].filter(x => x.k === 'assign').map(x => ({ k: 'var', v: x.v }))].filter(Boolean);
    default: return [];
  }
}

// ---- types --------------------------------------------------------------------------------------------------------------------------------------------------------
function inferTypes(ir) {
  const assigns = new Map();
  for (const b of ir.blocks) for (const s of b.stmts) if (s.k === 'assign' || s.k === 'catch-var') { if (!assigns.has(s.v)) assigns.set(s.v, []); assigns.get(s.v).push(s.e); }
  const wideVar = v => v.web.defs.some(d => ir.defs[d]?.wide);
  for (let round = 0; round < 3; round++) {
    for (const v of ir.vars) {
      if (v.debugType) { v.type = v.debugType; continue; }
      if (v.isThis) { v.type = ir.m.owner; continue; }
      if (v.isParam) { v.type = v.paramType; continue; }
      if (v.uninit && v.type) continue;
      const cands = [...v.defTypes, ...(assigns.get(v) ?? []).map(staticTypeOf)].filter(Boolean);
      const refs = cands.filter(isRef), prims = cands.filter(t => !isRef(t));
      let t = null;
      if (refs.length) t = refs.find(x => x !== OBJECT) ?? refs[0];
      else if (prims.length) t = prims.find(x => x === 'J' || x === 'D' || x === 'F') ?? (prims.every(x => x === 'Z') ? 'Z' : prims.find(x => x !== 'Z') ?? prims[0]);
      else {
        const ex = v.expect, exRefs = ex.filter(isRef);
        if (exRefs.length) t = exRefs.find(x => x !== OBJECT) ?? OBJECT;
        else if (ex.includes('Z')) t = 'Z';
        else if (ex.length) t = ex.find(x => x === 'J' || x === 'D' || x === 'F' || x === 'C') ?? ex[0];
        else t = wideVar(v) ? 'J' : 'I';
      }
      if (wideVar(v) && !(t === 'J' || t === 'D')) t = 'J';
      v.type = t;
    }
  }
}

// ---- declarations: each variable where its uses meet ----------------------------------------------------------------------------------------------------------------
function stmtVars(s) {
  const out = new Set();
  const add = e => varsOf(e, out);
  switch (s.k) {
    case 'assign': out.add(s.v); add(s.e); break;
    case 'expr': case 'return': case 'throw': case 'monitor': add(s.e); break;
    case 'store': add(s.target); add(s.e); break;
    case 'if': add(s.cond); break;
    case 'loop': add(s.cond); for (const x of [...(s.init ?? []), ...s.update]) for (const v of stmtVars(x)) out.add(v); break;
    case 'switch': add(s.e); break;
    case 'sync': add(s.e); break;
    case 'catch-var': out.add(s.v); break;
  }
  return out;
}
function placeDeclarations(body, ir) {
  const chains = new Map();
  const walk = (list, chain) => list.forEach((s, i) => {
    const here = [...chain, { list, index: i }];
    for (const v of stmtVars(s)) { if (!chains.has(v)) chains.set(v, []); chains.get(v).push(here); }
    for (const l of childLists(s)) walk(l, here);
  });
  walk(body, []);
  const inserts = new Map();
  for (const [v, list] of chains) {
    if (v.isThis || v.isParam || v.uninit || (v.isCatch && v.web.defs.length === 1)) continue;
    let k = 0, at = null;
    for (;; k++) {
      const first = list[0][k];
      if (!first || list.some(c => !c[k] || c[k].list !== first.list)) break;
      const min = Math.min(...list.map(c => c[k].index));
      at = { list: first.list, index: min };
      if (list.some(c => c[k].index !== first.index) || list.some(c => c.length === k + 1)) break;
    }
    if (!at) continue;
    const s = at.list[at.index];
    if (s.k === 'assign' && s.v === v && !varsOf(s.e).has(v) && !s.decl) { s.decl = true; continue; }
    if (s.k === 'loop' && s.kind === 'for' && s.init?.[0]?.k === 'assign' && s.init[0].v === v && list.every(c => c.length > k && c[k].list === at.list && c[k].index === at.index) && !varsOf(s.init[0].e).has(v)) { s.init[0].decl = true; continue; }
    if (!inserts.has(at.list)) inserts.set(at.list, []);
    inserts.get(at.list).push({ index: at.index, v });
  }
  for (const [list, items] of inserts) for (const item of items.sort((a, b) => b.index - a.index)) list.splice(item.index, 0, { k: 'decl', v: item.v, pcs: [] });
}

// ---- names --------------------------------------------------------------------------------------------------------------------------------------------------------
function nameVariables(ir, body) {
  const used = new Set(['this']), named = [];
  const take = (v, base) => {
    let name = String(base || 'v').replace(/[^\w$]/g, '_'); if (/^\d/.test(name)) name = `v${name}`; if (KEYWORDS.has(name)) name += '2';
    let n = name, k = 2; while (used.has(n)) n = `${name}${k++}`;
    used.add(n); v.name = n; named.push(v);
  };
  for (const v of ir.vars) if (v.isThis) v.name = 'this';
  const params = ir.vars.filter(v => v.isParam).sort((a, b) => a.paramIndex - b.paramIndex);
  for (const v of params) take(v, v.debugName ?? nameForType(v.type));
  const order = [];
  if (body) {
    const seen = new Set(), visit = list => { for (const s of list) { for (const v of stmtVars(s)) if (!seen.has(v)) { seen.add(v); order.push(v); } if (s.k === 'try') for (const c of s.catches) if (c.v && !seen.has(c.v)) { seen.add(c.v); order.push(c.v); } for (const l of childLists(s)) visit(l); } };
    visit(body);
  }
  for (const v of ir.vars) if (!order.includes(v)) order.push(v);
  for (const v of order) if (!v.name && !v.isThis) take(v, v.debugName ?? nameForType(v.type));
  ir.params.forEach(p => { p.name = p.var.name; });
}

// ---- rendering ----------------------------------------------------------------------------------------------------------------------------------------------------
const PREC = { '*': 12, '/': 12, '%': 12, '+': 11, '-': 11, '<<': 10, '>>': 10, '>>>': 10, '<': 9, '>': 9, '<=': 9, '>=': 9, '==': 8, '!=': 8, '&': 7, '^': 6, '|': 5 };
const SB = new Set(['Ljava/lang/StringBuilder;', 'Ljava/lang/StringBuffer;']);
function makeRenderer(ir, namer) {
  const self = ir.m.owner, T = t => namer.name(t);
  const typeOf = e => staticTypeOf(e);
  const paren = (r, min) => r.p < min ? `(${r.s})` : r.s;
  const varNames = () => new Set(ir.vars.map(v => v.name));
  let names = null;
  const argList = (args, types) => args.map((a, i) => ex(a, types?.[i] ?? null).s).join(', ');
  /** The parts of new StringBuilder(...).append(a)...toString(), or null. */
  function concatParts(e) {
    const parts = [];
    let c = e.recv;
    while (c?.k === 'call' && c.m.name === 'append' && SB.has(c.m.owner) && c.args.length === 1) { parts.unshift({ e: c.args[0], t: c.m.parameters[0] }); c = c.recv; }
    if (c?.k !== 'new' || !SB.has(c.t)) return null;
    if (c.args.length === 1 && c.m.parameters[0] === STRING) parts.unshift({ e: c.args[0], t: STRING });
    else if (c.args.length) return null;
    return parts.length ? parts : null;
  }
  function ex(e, ctx = null) {
    switch (e.k) {
      case 'lit': { const s = literalText(e.v, e.t ?? ctx, e.wide); return { s, p: s.startsWith('-') ? 14 : 16 }; }
      case 'str': return { s: javaString(e.s), p: 16 };
      case 'cls': return { s: `${T(e.t)}.class`, p: 16 };
      case 'var': return { s: e.v.isThis ? 'this' : e.v.name ?? 'v', p: 16 };
      case 'caught': return { s: '/* caught exception */ null', p: 16 };
      case 'uninit': return { s: `/* new ${T(e.t)}, not yet constructed */ null`, p: 16 };
      case 'raw': return { s: e.args ? `${e.text}(${argList(e.args)})` : e.text, p: 16 };
      case 'bin': {
        const ta = typeOf(e.a), boolOp = (e.op === '&' || e.op === '|' || e.op === '^') && (ta === 'Z' || typeOf(e.b) === 'Z');
        if (e.op === '^' && boolOp && e.b.k === 'lit' && BigInt(e.b.v) === 1n) { const r = ex(e.a, 'Z'); return { s: `!${paren(r, 14)}`, p: 14 }; }
        const ctxT = boolOp ? 'Z' : e.t;
        if ((e.op === '+' || e.op === '-') && e.b.k === 'lit' && (e.t === 'I' || e.t === 'J')) {   // x + -1 is x - 1
          const v = e.t === 'J' ? BigInt.asIntN(64, BigInt(e.b.v)) : BigInt.asIntN(32, BigInt(e.b.v));
          if (v < 0n && v !== -0x80000000n && v !== -0x8000000000000000n) return ex({ ...e, op: e.op === '+' ? '-' : '+', b: { ...e.b, v: -v } }, ctx);
        }
        const p = PREC[e.op], bitwise = p <= 7 || p === 10, a = ex(e.a, ctxT), b = ex(e.b, e.op === '<<' || e.op === '>>' || e.op === '>>>' ? 'I' : ctxT);
        const need = r => bitwise && r.p >= 10 && r.p <= 12 && r.p !== p ? 99 : 0;   // (n - 1) & hash, as people write it
        return { s: `${paren(a, Math.max(p, need(a)))} ${e.op} ${paren(b, Math.max(p + 1, need(b)))}`, p };
      }
      case 'un': { const a = ex(e.a, e.t); return { s: `${e.op}${paren(a, 14)}`.replace(/^--/, '- -'), p: 14 }; }
      case 'cast': { const a = ex(e.a, e.from ?? null); return { s: `(${T(e.t)}) ${paren(a, 14)}`, p: 13 }; }
      case 'inst': return { s: `${paren(ex(e.a), 9)} instanceof ${T(e.t)}`, p: 9 };
      case 'alen': return { s: `${paren(ex(e.a), 16)}.length`, p: 16 };
      case 'aget': return { s: `${paren(ex(e.a), 16)}[${ex(e.i, 'I').s}]`, p: 16 };
      case 'iget': return { s: `${paren(ex(e.o), 16)}.${e.f.name}`, p: 16 };
      case 'sget': { names ??= varNames(); return { s: e.f.owner === self && !names.has(e.f.name) ? e.f.name : `${T(e.f.owner)}.${e.f.name}`, p: 16 }; }
      case 'call': {
        if (e.m.name === 'toString' && SB.has(e.m.owner) && !e.args.length) {
          const parts = concatParts(e);
          if (parts) {
            const texts = parts.map((part, i) => { const r = ex(part.e, part.t); return i === 0 ? paren(r, 11) : paren(r, 12); });
            const stringy = part => part.t === STRING || typeOf(part.e) === STRING || part.e.k === 'str';
            if (!(stringy(parts[0]) || (parts[1] && stringy(parts[1])))) texts.unshift('""');
            if (texts.length === 1) texts.unshift('""');
            return { s: texts.join(' + '), p: 11 };
          }
        }
        const args = argList(e.args, e.m.parameters);
        if (e.kind === 'static') return { s: `${e.m.owner === self ? '' : `${T(e.m.owner)}.`}${e.m.name}(${args})`, p: 16 };
        if (e.kind === 'super') return { s: `super.${e.m.name}(${args})`, p: 16 };
        if (e.recv?.k === 'var' && e.recv.v.isThis) return { s: `${e.m.name}(${args})`, p: 16 };
        return { s: `${paren(ex(e.recv), 16)}.${e.m.name}(${args})`, p: 16 };
      }
      case 'new': return { s: `new ${T(e.t)}(${argList(e.args, e.m.parameters)})`, p: 16 };
      case 'ctor': return { s: `${e.which}(${argList(e.args, e.m.parameters)})`, p: 16 };
      case 'newarr': { const base = T(e.t.slice(1)), extra = base.match(/(\[\])*$/)[0]; return { s: `new ${base.slice(0, base.length - extra.length)}[${ex(e.len, 'I').s}]${extra}`, p: 16 }; }
      case 'arrlit': return { s: `new ${T(e.t)}{${e.items.map(x => ex(x, e.t.slice(1)).s).join(', ')}}`, p: 16 };
      case 'cmp': {
        const a = ex(e.a), b = ex(e.b);
        if (!e.fp) return { s: `Long.compare(${a.s}, ${b.s})`, p: 16 };
        return e.bias < 0 ? { s: `${paren(a, 10)} > ${paren(b, 10)} ? 1 : ${paren(a, 9)} == ${paren(b, 9)} ? 0 : -1`, p: 2 } : { s: `${paren(a, 10)} < ${paren(b, 10)} ? -1 : ${paren(a, 9)} == ${paren(b, 9)} ? 0 : 1`, p: 2 };
      }
      case 'rel': {
        const ta = typeOf(e.a), tb = typeOf(e.b), p = PREC[e.op];
        const a = ex(e.a, tb ?? ta), b = ex(e.b, ta ?? tb);
        return { s: `${paren(a, p)} ${e.op} ${paren(b, p + 1)}`, p };
      }
      case 'relz': {
        const t = typeOf(e.a);
        if (t === 'Z' && (e.op === '==' || e.op === '!=')) { const a = ex(e.a, 'Z'); return e.op === '!=' ? a : { s: `!${paren(a, 14)}`, p: 14 }; }
        const a = ex(e.a, t), zero = isRef(t) ? 'null' : t === 'C' ? "'\\u0000'" : t === 'Z' ? 'false' : '0', p = PREC[e.op];
        return { s: `${paren(a, p)} ${e.op} ${zero}`, p };
      }
      case 'not': {
        if (e.a.k === 'relz' || (e.a.k === 'rel' && !e.a.fp)) return ex(negate(e.a), ctx);
        return { s: `!${paren(ex(e.a), 14)}`, p: 14 };
      }
      case 'and': return { s: `${paren(ex(e.a), 4)} && ${paren(ex(e.b), 5)}`, p: 4 };
      case 'or': return { s: `${paren(ex(e.a), 3)} || ${paren(ex(e.b), 4)}`, p: 3 };
    }
    return { s: `/* ${e.k} */`, p: 16 };
  }
  return { ex: (e, ctx) => ex(e, ctx).s, T, typeOf };
}

/** One statement as `{ text, pcs }` (a simple statement) for the emitter and the for-loop header. */
function simpleText(s, R, ir) {
  const ex = R.ex;
  switch (s.k) {
    case 'assign': {
      const name = s.v.name;
      if (s.decl) return `${R.T(s.v.type)} ${name} = ${ex(s.e, s.v.type)}`;
      const e = s.e;
      if (e.k === 'bin' && e.a.k === 'var' && e.a.v === s.v && !['Z'].includes(s.v.type) && !isRef(s.v.type)) {
        if ((e.op === '+' || e.op === '-') && e.b.k === 'lit' && BigInt(e.b.v) === 1n) return `${name}${e.op}${e.op}`;
        if ((e.op === '+' || e.op === '-') && e.b.k === 'lit' && BigInt.asIntN(32, BigInt(e.b.v)) === -1n && !e.b.wide) return `${name}${e.op === '+' ? '--' : '++'}`;
        return `${name} ${e.op}= ${ex(e.b, e.op === '<<' || e.op === '>>' || e.op === '>>>' ? 'I' : s.v.type)}`;
      }
      return `${name} = ${ex(e, s.v.type)}`;
    }
    case 'expr': return ex(s.e);
    case 'store': {
      const t = R.typeOf(s.target), e = s.e;
      const same = (x, y) => x.k === y.k && (x.k === 'sget' ? x.f.key === y.f.key : x.k === 'iget' ? x.f.key === y.f.key && sameExpr(x.o, y.o) && x.o.k === 'var' : false);
      if (e.k === 'bin' && same(e.a, s.target) && !isRef(t) && t !== 'Z' && PREC[e.op]) {
        if ((e.op === '+' || e.op === '-') && e.b.k === 'lit' && BigInt(e.b.v) === 1n) return `${ex(s.target)}${e.op}${e.op}`;
        return `${ex(s.target)} ${e.op}= ${ex(e.b, e.op === '<<' || e.op === '>>' || e.op === '>>>' ? 'I' : t)}`;
      }
      return `${ex(s.target)} = ${ex(e, t)}`;
    }
    case 'decl': return `${R.T(s.v.type)} ${s.v.name}`;
    case 'catch-var': return `${R.T(s.v.type)} ${s.v.name} = /* the caught exception */ null`;
    default: return null;
  }
}
function emitStatements(lines, list, indent, R, ir) {
  const ex = R.ex, put = (text, pcs = [], first = null) => lines.push({ indent, text, pcs: [...new Set(pcs)].sort((a, b) => a - b), first: first ?? (pcs.length ? Math.min(...pcs) : null) });
  const sub = (l, extra = 1) => emitStatements(lines, l, indent + extra, R, ir);
  let labels = 0;
  const labelOf = frame => { if (frame.label === true) frame.label = `${frame.kind === 'switch' ? 'switch' : 'loop'}${++ir.labelSeq}`; return frame.label; };
  ir.labelSeq ??= 0;
  for (const s of list) {
    const simple = simpleText(s, R, ir);
    if (simple !== null) { put(`${simple};`, s.pcs); continue; }
    switch (s.k) {
      case 'return': put(s.e ? `return ${ex(s.e, ir.m.result)};` : 'return;', s.pcs); break;
      case 'throw': put(`throw ${ex(s.e)};`, s.pcs); break;
      case 'monitor': put(`// monitor-${s.enter ? 'enter' : 'exit'} ${ex(s.e)}`, s.pcs); break;
      case 'break': case 'continue': put(`${s.k}${s.labeled ? ` ${labelOf(s.frame)}` : ''};`, s.pcs); break;
      case 'if': {
        let cur = s, first = true;
        for (;;) {
          put(`${first ? '' : '} else '}if (${ex(cur.cond)}) {`, cur.pcs); sub(cur.then);
          first = false;
          if (cur.else.length === 1 && cur.else[0].k === 'if') { cur = cur.else[0]; continue; }
          if (cur.else.length) { put('} else {'); sub(cur.else); }
          break;
        }
        put('}'); break;
      }
      case 'loop': {
        const label = s.frame.label ? `${labelOf(s.frame)}: ` : '';
        const condPcs = s.condPcs ?? [];
        if (s.kind === 'do') { put(`${label}do {`); sub(s.body); put(`} while (${ex(s.cond)});`, [...condPcs, ...(s.backPcs ?? [])]); break; }
        if (s.kind === 'for') {
          const init = (s.init ?? []).map(x => simpleText(x, R, ir)).join(', '), update = s.update.map(x => simpleText(x, R, ir)).join(', ');
          const pcs = [...(s.init ?? []).flatMap(x => x.pcs), ...condPcs, ...s.update.flatMap(x => x.pcs), ...(s.backPcs ?? [])];
          put(`${label}for (${init}; ${s.cond ? ex(s.cond) : ''}; ${update}) {`, pcs, condPcs.length ? Math.min(...condPcs) : null);
          sub(s.body); put('}'); break;
        }
        put(`${label}while (${s.cond ? ex(s.cond) : 'true'}) {`, condPcs); sub(s.body); put('}', s.backPcs ?? []); break;
      }
      case 'switch': {
        const label = s.frame.label ? `${labelOf(s.frame)}: ` : '', t = R.typeOf(s.e);
        put(`${label}switch (${ex(s.e, 'I')}) {`, s.pcs);
        for (const c of s.cases) {
          for (const key of c.keys) lines.push({ indent: indent + 1, text: `case ${literalText(key, t === 'C' ? 'C' : 'I', false)}:`, pcs: [], first: null });
          if (c.isDefault) lines.push({ indent: indent + 1, text: 'default:', pcs: [], first: null });
          sub(c.body, 2);
        }
        put('}'); break;
      }
      case 'try': {
        put('try {'); sub(s.body);
        for (const c of s.catches) {
          const types = c.types.map(t => t === null ? 'Throwable' : R.T(t)).join(' | ');
          put(`} catch (${types} ${c.v?.name ?? 'ignored'}) {`, c.pcs); sub(c.body);
        }
        put('}'); break;
      }
      case 'sync': put(`synchronized (${ex(s.e)}) {`, s.pcs); sub(s.body); put('}', s.endPcs); break;
      case 'comment': put(`// ${s.text}`, s.pcs ?? []); break;
      default: put(`/* ${s.k} */`, s.pcs ?? []);
    }
  }
  return labels;
}

// ---- when the structure cannot be built: goto form, or the smali ----------------------------------------------------------------------------------------------------
function gotoFallback(ir, namer, reason) {
  const lines = [], put = (indent, text, pcs = []) => lines.push({ indent, text, pcs: [...new Set(pcs)].sort((a, b) => a - b), first: pcs.length ? Math.min(...pcs) : null });
  try {
    // the variables in the order the statements use them (the goto form's own body)
    const live = ir.blocks.filter(b => !b.unreachable && b.collapsed === undefined && b.merged === undefined);
    nameVariables(ir, live.flatMap(b => [...b.stmts, ...(b.term?.cond || b.term?.e ? [{ k: 'expr', e: b.term.cond ?? b.term.e }] : [])]));
    const R = makeRenderer(ir, namer), ex = R.ex, blocks = ir.blocks.filter(b => !b.unreachable && b.collapsed === undefined && b.merged === undefined);
    const label = id => { let b = ir.blocks[id]; for (let guard = 0; b && (b.collapsed !== undefined || b.merged !== undefined) && guard < 64; guard++) b = ir.blocks[b.collapsed ?? b.merged]; return `L_${(b?.pc ?? 0).toString(16)}`; };
    put(0, `// Not decompiled into structured Java: ${reason}.`);
    put(0, '// Below: its statements in DEX order with labels and goto pseudo-statements (not valid Java); the Smali tab has the exact code.');
    for (const c of ir.constructs) put(0, `// try ${c.ranges.map(([s, e]) => `pc ${s}..${e}`).join(', ')}: ${c.handlers.map(h => `catch (${h.type === null ? 'Throwable' : R.T(h.type)}) goto ${label(ir.blockAtPc(h.address))}`).join(', ')}`);
    const declared = new Set();
    for (const v of ir.vars) if (!v.isThis && !v.isParam && !v.uninit && v.name && (v.materialized || v.web.defs.some(d => { const s = ir.defs[d]; return s.ins >= 0; }))) {
      const used = blocks.some(b => b.stmts.some(s => stmtVars(s).has(v)) || (b.term && termVars(b.term).has(v)));
      if (used && !declared.has(v)) { declared.add(v); put(0, `${R.T(v.type)} ${v.name};`); }
    }
    blocks.forEach((b, i) => {
      put(0, `${label(b.id)}:`);
      for (const s of b.stmts) { const t = s.k === 'catch-var' ? `${s.v.name} = /* the caught exception */;` : simpleText(s, R, ir); put(1, t === null ? `/* ${s.k} */` : t.endsWith(';') ? t : `${t};`, s.pcs); }
      const t = b.term, next = blocks[i + 1]?.id;
      if (!t) return;
      if (t.k === 'return') put(1, t.e ? `return ${ex(t.e, ir.m.result)};` : 'return;', t.pcs);
      else if (t.k === 'throw') put(1, `throw ${ex(t.e)};`, t.pcs);
      else if (t.k === 'goto') { if (t.to !== next || t.pcs.length) put(1, `goto ${label(t.to)};`, t.pcs); }
      else if (t.k === 'if') { put(1, `if (${ex(t.cond)}) goto ${label(t.t)};`, t.pcs); if (t.f !== next) put(1, `goto ${label(t.f)};`); }
      else if (t.k === 'switch') {
        put(1, `switch (${ex(t.e, 'I')}) {`, t.pcs);
        for (const c of t.cases) put(2, `case ${c.key}: goto ${label(c.to)};`);
        put(2, `default: goto ${label(t.dflt)};`); put(1, '}');
      }
    });
    return { lines, ok: false, fallback: 'goto', reason, params: ir.params.map(p => ({ name: p.var.name, type: p.var.type })) };
  } catch (error) { return smaliFallback(ir.dex, ir.m, `${reason}; the goto form failed too (${error?.message ?? error})`); }
}
function termVars(t) { const out = new Set(); if (t.cond) varsOf(t.cond, out); if (t.e) varsOf(t.e, out); return out; }
function smaliFallback(dex, m, reason) {
  const lines = [{ indent: 0, text: `// Not decompiled: ${reason}. Its smali:`, pcs: [], first: null }];
  try {
    const { text, info } = smaliOfMethod(dex, m.owner, m), pcOf = new Map(info.pcToLine.map(([pc, line]) => [line, pc])), all = text.split('\n');
    all.forEach((line, i) => { if (i === 0 || line.trim() === '.end method' || !line.trim()) return; const pc = pcOf.get(i); lines.push({ indent: 0, text: `//${line}`, pcs: pc === undefined ? [] : [pc], first: pc ?? null }); });
  } catch (error) { lines.push({ indent: 0, text: `// (the smali could not be written either: ${error?.message ?? error})`, pcs: [], first: null }); }
  return { lines, ok: false, fallback: 'smali', reason, params: defaultParams(m, null) };
}

// ---- the class -----------------------------------------------------------------------------------------------------------------------------------------------------
const classFlags = (flags, isInterface) => [flags & ACC.PUBLIC && 'public', flags & ACC.PRIVATE && 'private', flags & ACC.PROTECTED && 'protected', flags & ACC.STATIC && 'static',
  !isInterface && flags & ACC.ABSTRACT && !(flags & ACC.ANNOTATION) && 'abstract', flags & ACC.FINAL && !(flags & ACC.ENUM) && 'final'].filter(Boolean);
const memberFlags = (flags, kind) => [flags & ACC.PUBLIC && 'public', flags & ACC.PRIVATE && 'private', flags & ACC.PROTECTED && 'protected', flags & ACC.STATIC && 'static',
  flags & ACC.FINAL && 'final', kind === 'm' && flags & ACC.ABSTRACT && 'abstract', kind === 'm' && (flags & (ACC.SYNCHRONIZED | ACC.DECLARED_SYNCHRONIZED)) && 'synchronized',
  kind === 'm' && flags & ACC.NATIVE && 'native', kind === 'f' && flags & ACC.VOLATILE && 'volatile', kind === 'f' && flags & ACC.TRANSIENT && 'transient'].filter(Boolean);
function fieldValue(dex, value, type, namer) {
  if (!value) return null;
  switch (value.t) {
    case 'boolean': return value.v ? 'true' : 'false';
    case 'byte': case 'short': case 'int': return literalText(value.v, type === 'C' ? 'C' : 'I', false);
    case 'char': return charLiteral(Number(value.v));
    case 'long': return longLiteral(value.v);
    case 'float': return floatLiteral(Number(BigInt.asIntN(32, BigInt(value.v))));
    case 'double': return doubleLiteral(value.v);
    case 'string': return javaString(dex.string(value.v));
    case 'null': return 'null';
    case 'type': return `${namer.name(dex.type(value.v))}.class`;
    default: return `/* ${valueText(dex, value).replace(/\s+/g, ' ').slice(0, 120)} */ null`;
  }
}
const annotationLine = (dex, a, namer) => `@${namer.name(a.type)}${a.elements.length ? `(${a.elements.map(e => `${e.name} = ${valueText(dex, e.value).replace(/\s+/g, ' ')}`).join(', ')})` : ''}`;
const sigOf = method => `(${method.parameters.join('')})${method.result}`;

/**
 * A decompilation of the class `model` done in steps: { total, done, step(budgetMs) -> done, result() }. `modified`: the keys of methods whose body the user replaced
 * (their Java is the APK's, and says so); `gotoForm`: every method in the unstructured form (the tests check its line map). result(): { text, lines, lineCount, pcsOfLine (per line: null or [methodKey, firstPc, ...pcs]), lineOfPc ({ methodKey: { pc: line } }),
 * methods: [{ key, name, signature, startLine, endLine, ok, fallback, reason }], stats } (lines 0-based).
 */
export function createDecompileJob(model, { modified = new Set(), gotoForm = false } = {}) {
  const dex = model.dex, namer = new TypeNamer(model.type);
  const list = [...model.directMethods, ...model.virtualMethods];
  const outs = []; let at = 0, ms = 0;
  const isInterface = !!(model.flags & ACC.INTERFACE), isAnnotation = !!(model.flags & ACC.ANNOTATION), isEnum = !!(model.flags & ACC.ENUM);
  // the declarations claim their simple names first
  const superText = model.superclass && model.superclass !== OBJECT && !(isEnum && model.superclass === 'Ljava/lang/Enum;') ? namer.name(model.superclass) : null;
  const interfaces = model.interfaces.filter(i => !(isAnnotation && i === 'Ljava/lang/annotation/Annotation;')).map(i => namer.name(i));
  const fieldLines = [...model.staticFields, ...model.instanceFields].map(f => {
    const value = (f.flags & ACC.STATIC) ? fieldValue(dex, f.value, f.type, namer) : null;
    return [...f.annotations.filter(a => a.visibility !== 'system').map(a => annotationLine(dex, a, namer)),
      `${[...memberFlags(f.flags, 'f'), namer.name(f.type), f.name].join(' ')}${value !== null ? ` = ${value}` : ''};${f.flags & ACC.SYNTHETIC ? ' /* synthetic */' : ''}`];
  });
  const job = {
    total: list.length,
    get done() { return at >= list.length; },
    get progress() { return { done: at, total: list.length }; },
    step(budgetMs = DECOMPILER_LIMITS.sliceMs) {
      const start = now();
      while (at < list.length) {
        const method = list[at], t0 = now();
        let out; try { out = decompileMethod(model, method, namer, { gotoForm }); } catch (error) { out = smaliFallback(dex, { ...method, owner: model.type }, `the decompiler failed (${error?.message ?? error})`); }
        out.ms = now() - t0; outs.push(out); at++;
        if (now() - start >= budgetMs) break;
      }
      ms += now() - start;
      return at >= list.length;
    },
    result() {
      while (!job.done) job.step(1e9);
      const lines = [], pcsOfLine = [], lineOfPc = {}, methods = [];
      const put = (text, map = null) => { lines.push(text); pcsOfLine.push(map); };
      const pkgSlash = model.type.lastIndexOf('/'), pkg = pkgSlash > 0 ? model.type.slice(1, pkgSlash).replaceAll('/', '.') : '';
      const simple = namer.name(model.type).split('.').pop();
      // method texts first (they claim more names), then the header with the imports
      const bodies = list.map((method, i) => {
        const out = outs[i], key = `${model.type}->${method.name}${sigOf(method)}`, mlines = [];
        const isClinit = method.name === '<clinit>', isInit = method.name === '<init>';
        for (const a of method.annotations) if (a.visibility !== 'system') mlines.push({ text: annotationLine(dex, a, namer) });
        const throwsA = method.annotations.find(a => a.type === 'Ldalvik/annotation/Throws;');
        const throwsList = throwsA?.elements?.[0]?.value?.t === 'array' ? throwsA.elements[0].value.v.filter(v => v.t === 'type').map(v => namer.name(dex.type(v.v))) : [];
        const varargs = !!(method.flags & ACC.VARARGS) && method.parameters.at(-1)?.startsWith('[');
        const params = (out.params ?? []).map((p, k) => varargs && k === out.params.length - 1 ? `${namer.name(p.type.slice(1))}... ${p.name}` : `${namer.name(p.type)} ${p.name}`).join(', ');
        const flags = memberFlags(method.flags, 'm').filter(f => !(isInterface && (f === 'public' || f === 'abstract')));
        let decl;
        if (isClinit) decl = 'static';
        else if (isInit) decl = [...flags.filter(f => f !== 'static'), `${simple}(${params})`].join(' ');
        else decl = [...(isInterface && method.code && !(method.flags & ACC.STATIC) && !(method.flags & ACC.PRIVATE) ? ['default'] : []), ...flags, namer.name(method.result), `${method.name}(${params})`].join(' ');
        if (throwsList.length) decl += ` throws ${throwsList.join(', ')}`;
        const notes = [method.flags & ACC.SYNTHETIC && 'synthetic', method.flags & ACC.BRIDGE && 'bridge'].filter(Boolean);
        if (modified.has(key)) mlines.push({ text: '// App modified: this method\'s body was replaced (Edit method or a plugin); the code below is the APK\'s.' });
        if (!method.code) { mlines.push({ text: `${decl};${notes.length ? ` /* ${notes.join(', ')} */` : ''}` }); return { key, method, mlines, out }; }
        mlines.push({ text: `${decl} {${notes.length ? ` /* ${notes.join(', ')} */` : ''}` });
        for (const l of out.lines) mlines.push({ text: `${'    '.repeat(l.indent + 1)}${l.text}`, pcs: l.pcs, first: l.first });
        const endPcs = out.endPcs ?? [];
        mlines.push({ text: '}', pcs: endPcs, first: endPcs.length ? Math.min(...endPcs) : null });
        return { key, method, mlines, out };
      });
      put('// Decompiled by the lab from the DEX code (src/java-decompiler.js): readable Java, not the original source. The Smali tab has the exact code.');
      if (model.source) put(`// Source file: ${model.source}`);
      if (pkg) { put(`package ${pkg};`); put(''); }
      const imports = [...namer.imports].sort();
      if (imports.length) { for (const i of imports) put(`import ${i};`); put(''); }
      for (const a of model.annotations) if (a.visibility !== 'system') put(annotationLine(dex, a, namer));
      const kind = isAnnotation ? '@interface' : isInterface ? 'interface' : isEnum ? 'enum' : 'class';
      let header = [...classFlags(model.flags, isInterface), kind, simple].join(' ');
      if (superText) header += ` extends ${superText}`;
      if (interfaces.length) header += ` ${isInterface ? 'extends' : 'implements'} ${interfaces.join(', ')}`;
      put(`${header} {`);
      for (const f of fieldLines) for (const text of f) put(`    ${text}`);
      for (const b of bodies) {
        if (lines.at(-1) !== `${header} {`) put('');
        const startLine = lines.length;
        for (const l of b.mlines) {
          if (!l.pcs?.length) { put(`    ${l.text}`); continue; }
          const line = lines.length;
          put(`    ${l.text}`, [b.key, l.first ?? l.pcs[0], ...l.pcs]);
          const map = lineOfPc[b.key] ??= {};
          for (const pc of l.pcs) if (map[pc] === undefined) map[pc] = line;
        }
        methods.push({ key: b.key, name: b.method.name, signature: sigOf(b.method), startLine, endLine: lines.length - 1, hasCode: !!b.method.code, ok: b.out.ok, fallback: b.out.fallback, reason: b.out.reason, ms: Math.round(b.out.ms * 10) / 10 });
      }
      put('}');
      const methodOfLine = new Int32Array(lines.length).fill(-1);
      methods.forEach((m, i) => { for (let l = m.startLine; l <= m.endLine; l++) methodOfLine[l] = i; });
      const failed = methods.filter(m => m.fallback);
      const typeRefs = {}; for (const [simple, dotted] of namer.taken) typeRefs[simple] = `L${dotted.replaceAll('.', '/')};`;
      return { text: lines.join('\n'), lines, lineCount: lines.length, pcsOfLine, lineOfPc, methodOfLine, methods, typeRefs,
        stats: { methods: methods.length, structured: methods.length - failed.length, goto: failed.filter(m => m.fallback === 'goto').length, smali: failed.filter(m => m.fallback === 'smali').length, ms: Math.round(ms * 10) / 10 } };
    },
  };
  return job;
}
/** The whole class at once (tests, small classes): createDecompileJob(...).result(). */
export function decompileClass(model, options) { return createDecompileJob(model, options).result(); }
