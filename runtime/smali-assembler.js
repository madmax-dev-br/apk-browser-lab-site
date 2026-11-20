// A smali assembler for one method body (CLAUDE.md, "method changes chosen by the user": a plugin's lab.hook(method, { smali }), src/method-hooks.js). It turns the text the
// user wrote -- the body as baksmali prints it: `.registers N` (or `.locals N`), instructions, labels, `.catch` / `.catchall`, `.packed-switch` / `.sparse-switch` /
// `.array-data` payloads, debug directives (ignored) -- into Dalvik code units, verifies them and writes a minimal DEX file (no class definition: the string, type, proto,
// field and method ids the body names, the hooked method's own id, and one code item) that both engines read as they read any DEX: the JavaScript interpreter decodes
// the code item through the DEX's reader (src/interpreter.js prepare) and the WebAssembly core's linker copies it into its metaspace (vmcore/js/linker.js linkCode).
//
// Verification, every error with the line it comes from (a SmaliError carries all of them, in line order):
//   - structure: one `.registers`/`.locals`; register numbers within the frame and within the instruction's operand width (v0-v15 for 4-bit forms, v0-v255 for 8-bit ones);
//     pN within the parameters; literals within their instruction's range; branch targets that are instructions; payloads used by the right instruction; tries and handlers;
//   - flow and kinds (the part of the Dalvik verifier that needs no class model): every path assigns a register before reading it; a register read as an int/float holds a
//     32-bit primitive, as a long/double a wide pair, as an object a reference (or the constant 0 = null); an object made by new-instance is used only after its constructor;
//     move-result follows a call that returns that kind; move-exception starts a handler; return matches the method's return type; execution never runs off the end of the
//     code or into a payload; field access forms match the field's type; a call passes the registers its signature takes;
//   - references: the classes, methods and fields the body names resolve in the running VM (`resolver`, given by src/method-hooks.js from the runtime).
// What it does not check (the class model the core verifier needs): assignability between reference types (an argument of the wrong class fails at run time, as on a
// device without verification would), access flags. Not supported (an explicit error): invoke-polymorphic, invoke-custom, const-method-handle, const-method-type (DEX 038+).
// Pure module: no DOM, no process.*.

export class SmaliError extends Error {
  constructor(errors) {
    const sorted = [...errors].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    super(`smali: ${sorted.slice(0, 8).map(e => e.line ? `line ${e.line}: ${e.message}` : e.message).join('; ')}${sorted.length > 8 ? `; and ${sorted.length - 8} more` : ''}`);
    this.name = 'SmaliError'; this.code = 'verify'; this.errors = sorted;
  }
}

// ---- opcodes ---------------------------------------------------------------------------------------------------------------------------------------------------------
// [opcode, name, format, reference kind]; reference kinds: s string, t type, f field, m method.
const TABLE = [
  [0x00, 'nop', '10x'], [0x01, 'move', '12x'], [0x02, 'move/from16', '22x'], [0x03, 'move/16', '32x'], [0x04, 'move-wide', '12x'], [0x05, 'move-wide/from16', '22x'], [0x06, 'move-wide/16', '32x'],
  [0x07, 'move-object', '12x'], [0x08, 'move-object/from16', '22x'], [0x09, 'move-object/16', '32x'], [0x0a, 'move-result', '11x'], [0x0b, 'move-result-wide', '11x'], [0x0c, 'move-result-object', '11x'],
  [0x0d, 'move-exception', '11x'], [0x0e, 'return-void', '10x'], [0x0f, 'return', '11x'], [0x10, 'return-wide', '11x'], [0x11, 'return-object', '11x'],
  [0x12, 'const/4', '11n'], [0x13, 'const/16', '21s'], [0x14, 'const', '31i'], [0x15, 'const/high16', '21h'], [0x16, 'const-wide/16', '21s'], [0x17, 'const-wide/32', '31i'], [0x18, 'const-wide', '51l'],
  [0x19, 'const-wide/high16', '21h'], [0x1a, 'const-string', '21c', 's'], [0x1b, 'const-string/jumbo', '31c', 's'], [0x1c, 'const-class', '21c', 't'], [0x1d, 'monitor-enter', '11x'], [0x1e, 'monitor-exit', '11x'],
  [0x1f, 'check-cast', '21c', 't'], [0x20, 'instance-of', '22c', 't'], [0x21, 'array-length', '12x'], [0x22, 'new-instance', '21c', 't'], [0x23, 'new-array', '22c', 't'], [0x24, 'filled-new-array', '35c', 't'],
  [0x25, 'filled-new-array/range', '3rc', 't'], [0x26, 'fill-array-data', '31t'], [0x27, 'throw', '11x'], [0x28, 'goto', '10t'], [0x29, 'goto/16', '20t'], [0x2a, 'goto/32', '30t'], [0x2b, 'packed-switch', '31t'],
  [0x2c, 'sparse-switch', '31t'], [0x2d, 'cmpl-float', '23x'], [0x2e, 'cmpg-float', '23x'], [0x2f, 'cmpl-double', '23x'], [0x30, 'cmpg-double', '23x'], [0x31, 'cmp-long', '23x'],
  ...['eq', 'ne', 'lt', 'ge', 'gt', 'le'].map((c, i) => [0x32 + i, `if-${c}`, '22t']), ...['eqz', 'nez', 'ltz', 'gez', 'gtz', 'lez'].map((c, i) => [0x38 + i, `if-${c}`, '21t']),
  ...['', '-wide', '-object', '-boolean', '-byte', '-char', '-short'].flatMap((s, i) => [[0x44 + i, `aget${s}`, '23x'], [0x4b + i, `aput${s}`, '23x'], [0x52 + i, `iget${s}`, '22c', 'f'], [0x59 + i, `iput${s}`, '22c', 'f'], [0x60 + i, `sget${s}`, '21c', 'f'], [0x67 + i, `sput${s}`, '21c', 'f']]),
  ...['virtual', 'super', 'direct', 'static', 'interface'].flatMap((k, i) => [[0x6e + i, `invoke-${k}`, '35c', 'm'], [0x74 + i, `invoke-${k}/range`, '3rc', 'm']]),
  ...['neg-int', 'not-int', 'neg-long', 'not-long', 'neg-float', 'neg-double', 'int-to-long', 'int-to-float', 'int-to-double', 'long-to-int', 'long-to-float', 'long-to-double', 'float-to-int', 'float-to-long',
    'float-to-double', 'double-to-int', 'double-to-long', 'double-to-float', 'int-to-byte', 'int-to-char', 'int-to-short'].map((name, i) => [0x7b + i, name, '12x']),
  ...BINOPS().flatMap(([name], i) => [[0x90 + i, name, '23x'], [0xb0 + i, `${name}/2addr`, '12x']]),
  ...['add-int', 'rsub-int', 'mul-int', 'div-int', 'rem-int', 'and-int', 'or-int', 'xor-int'].map((name, i) => [0xd0 + i, i === 1 ? 'rsub-int' : `${name}/lit16`, '22s']),
  ...['add-int', 'rsub-int', 'mul-int', 'div-int', 'rem-int', 'and-int', 'or-int', 'xor-int', 'shl-int', 'shr-int', 'ushr-int'].map((name, i) => [0xd8 + i, `${name}/lit8`, '22b']),
];
/** The 32 binary operations 0x90-0xaf in order: [name, operand kind ('i' int, 'w' long, 'f' float, 'd' double), shift (the second operand of a long shift is an int)]. */
function BINOPS() {
  const ints = ['add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'ushr'], fl = ['add', 'sub', 'mul', 'div', 'rem'];
  return [...ints.map(n => [`${n}-int`, 'i', false]), ...ints.map(n => [`${n}-long`, 'w', n.endsWith('shl') || n.endsWith('shr')]), ...fl.map(n => [`${n}-float`, 'f', false]), ...fl.map(n => [`${n}-double`, 'd', false])];
}
const OPS = new Map(TABLE.map(([op, name, fmt, ref]) => [name, { op, name, fmt, ref: ref ?? null }]));
const UNSUPPORTED = new Set(['invoke-polymorphic', 'invoke-polymorphic/range', 'invoke-custom', 'invoke-custom/range', 'const-method-handle', 'const-method-type']);
const UNITS = { '10x': 1, '12x': 1, '11n': 1, '11x': 1, '10t': 1, '20t': 2, '22x': 2, '21t': 2, '21s': 2, '21h': 2, '21c': 2, '23x': 2, '22b': 2, '22t': 2, '22s': 2, '22c': 2, '30t': 3, '32x': 3, '31i': 3, '31t': 3, '31c': 3, '35c': 3, '3rc': 3, '51l': 5 };
const BINOP_INFO = BINOPS();

// ---- types and literals ----------------------------------------------------------------------------------------------------------------------------------------------
const TYPE_RE = /^\[*(?:[ZBSCIJFD]|L[^;\s()]+;)$/;
const isType = t => TYPE_RE.test(t);
/** A smali method signature `(Params)Ret` -> { parameters, result } or null. */
export function parseSignature(text) {
  const m = /^\(([^)]*)\)(V|\[*(?:[ZBSCIJFD]|L[^;\s()]+;))$/.exec(text); if (!m) return null;
  const parameters = []; let rest = m[1];
  while (rest.length) { const t = /^\[*(?:[ZBSCIJFD]|L[^;\s()]+;)/.exec(rest); if (!t) return null; parameters.push(t[0]); rest = rest.slice(t[0].length); }
  return { parameters, result: m[2] };
}
const wordsOf = parameters => parameters.reduce((n, t) => n + (t === 'J' || t === 'D' ? 2 : 1), 0);
const isWideType = t => t === 'J' || t === 'D';
const isRefType = t => t[0] === 'L' || t[0] === '[';
const shortyChar = t => isRefType(t) ? 'L' : t;
const F32 = new Float32Array(1), I32 = new Int32Array(F32.buffer), F64 = new Float64Array(1), I64 = new BigInt64Array(F64.buffer);
const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '0': '\0', '"': '"', "'": "'", '\\': '\\' };
/** The text of a smali string or char literal (between its quotes) with its escapes resolved, or null for a malformed escape. */
function unescapeLiteral(body) {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i]; if (c !== '\\') { out += c; continue; }
    const n = body[++i];
    if (n === 'u') { const hex = body.slice(i + 1, i + 5); if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null; out += String.fromCharCode(parseInt(hex, 16)); i += 4; continue; }
    if (n in ESCAPES) { out += ESCAPES[n]; continue; }
    return null;
  }
  return out;
}
/**
 * A literal operand -> { int: BigInt (an integral value, as written) } | { float: number, double: boolean } | null. Integers: decimal or 0x hex, a sign, suffix L (long),
 * t (byte), s (short); floats: 1.5, 1.5f, 2e3, NaN, Infinity (suffix f = float, d or none = double); chars 'a', '\n', 'A'; true / false.
 */
function parseLiteral(text) {
  const t = text.trim();
  if (t === 'true') return { int: 1n }; if (t === 'false') return { int: 0n };
  if (/^'.*'$/.test(t)) { const s = unescapeLiteral(t.slice(1, -1)); return s !== null && s.length === 1 ? { int: BigInt(s.charCodeAt(0)) } : null; }
  let m = /^([+-]?)(0x[0-9a-fA-F]+|\d+)([LlTtSs]?)$/.exec(t);
  if (m && !(m[2].length > 1 && m[2][0] === '0' && !m[2].startsWith('0x') && /[89]/.test(m[2]))) {
    const magnitude = m[2].startsWith('0x') ? BigInt(m[2]) : m[2].length > 1 && m[2][0] === '0' ? BigInt('0o' + m[2].slice(1)) : BigInt(m[2]);
    return { int: m[1] === '-' ? -magnitude : magnitude, suffix: m[3].toLowerCase() };
  }
  m = /^([+-]?)(NaN|Infinity)([fFdD]?)$/.exec(t);
  if (m) return { float: m[2] === 'NaN' ? NaN : (m[1] === '-' ? -Infinity : Infinity), double: !/[fF]/.test(m[3]) };
  m = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?([fFdD]?)$/.exec(t);
  if (m && (/[.eE]/.test(t) || m[1])) return { float: Number(t.replace(/[fFdD]$/, '')), double: !/[fF]/.test(m[1]) };
  return null;
}
const floatBits = n => { F32[0] = n; return BigInt(I32[0]); };
const doubleBits = n => { F64[0] = n; return I64[0]; };

// ---- lexing a line ---------------------------------------------------------------------------------------------------------------------------------------------------
/** The line without its comment (`#` outside a string or char literal). */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c; else if (c === '#') return line.slice(0, i);
  }
  return line;
}
/** Operands separated by commas outside braces and literals. */
function splitOperands(text) {
  const out = []; let depth = 0, quote = null, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c; else if (c === '{') depth++; else if (c === '}') depth--;
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim(); if (last || out.length) out.push(last);
  return out;
}

/**
 * Assembles and verifies `text` as the body of `target` ({ owner, name, parameters, result, isStatic }). `resolver`: { classExists(type) -> boolean,
 * method(owner, name, signature, kind: 'virtual'|'super'|'direct'|'static'|'interface') -> null | error text, field(owner, name, type, isStatic) -> null | error text }
 * (null resolver: no reference check). Returns { bytes (the DEX file), units, registers, ins, outs, tries, selfMethodIndex, codeOffset (of the code item's instructions),
 * instructions } or throws SmaliError.
 */
export function assembleSmali(text, target, { resolver = null, maxUnits = 65535, maxLines = 20000 } = {}) {
  const errors = [], err = (line, message) => { errors.push({ line, message }); };
  const lines = String(text ?? '').split(/\r?\n/);
  if (lines.length > maxLines) throw new SmaliError([{ line: 0, message: `more than ${maxLines} lines` }]);
  const ins = wordsOf(target.parameters) + (target.isStatic ? 0 : 1);
  let registers = null, registersLine = 0, locals = false;
  const items = [], labels = new Map(), catches = [];
  let pendingLabels = [];
  // ---- pass 1: lines -> items (instructions and payloads) ----
  let block = null;   // an open .packed-switch / .sparse-switch / .array-data / .annotation / .param block
  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1, line = stripComment(lines[index]).trim();
    if (!line) continue;
    if (block) {
      if (block.kind === 'skip') { if (line === block.end) block = null; continue; }
      if (line === `.end ${block.kind}`) { items.push(block.item); for (const label of block.labels) labels.set(label.name, { item: block.item, line: label.line }); block = null; continue; }
      if (block.kind === 'packed-switch') { if (!/^:[\w$-]+$/.test(line)) err(lineNo, `a .packed-switch entry is a label (:name), not "${line}"`); else block.item.targets.push({ label: line.slice(1), line: lineNo }); continue; }
      if (block.kind === 'sparse-switch') {
        const m = /^(\S+)\s*->\s*:([\w$-]+)$/.exec(line), key = m ? parseLiteral(m[1]) : null;
        if (!m || !key || key.int === undefined) err(lineNo, `a .sparse-switch entry is "KEY -> :label", not "${line}"`);
        else if (key.int < -(2n ** 31n) || key.int > 2n ** 32n - 1n) err(lineNo, `sparse-switch key ${m[1]} is not a 32-bit int`);
        else block.item.entries.push({ key: Number(BigInt.asIntN(32, key.int)), label: m[2], line: lineNo });
        continue;
      }
      if (block.kind === 'array-data') {
        for (const piece of line.split(/\s+/)) {
          const value = parseLiteral(piece);
          if (!value) { err(lineNo, `an .array-data element is a literal, not "${piece}"`); continue; }
          const width = block.item.width, bits = value.int !== undefined ? value.int : width === 4 ? floatBits(value.float) : width === 8 ? doubleBits(value.float) : null;
          if (bits === null) { err(lineNo, `a ${width}-byte .array-data element cannot be the floating-point literal ${piece}`); continue; }
          const min = -(2n ** BigInt(width * 8 - 1)), max = 2n ** BigInt(width * 8) - 1n;
          if (bits < min || bits > max) { err(lineNo, `${piece} does not fit in ${width} byte${width > 1 ? 's' : ''}`); continue; }
          block.item.values.push(BigInt.asUintN(width * 8, bits));
        }
        continue;
      }
    }
    if (line.startsWith(':')) {
      const name = line.slice(1);
      if (!/^[\w$-]+$/.test(name)) { err(lineNo, `invalid label ${line}`); continue; }
      if (labels.has(name) || pendingLabels.some(label => label.name === name)) { err(lineNo, `label :${name} defined twice`); continue; }
      pendingLabels.push({ name, line: lineNo }); continue;
    }
    if (line.startsWith('.')) {
      const space = line.search(/\s/), directive = space < 0 ? line : line.slice(0, space), rest = space < 0 ? '' : line.slice(space + 1).trim();
      switch (directive) {
        case '.registers': case '.locals': {
          const n = parseLiteral(rest);
          if (registers !== null) { err(lineNo, `${directive} given twice (first on line ${registersLine})`); break; }
          if (!n || n.int === undefined || n.int < 0n || n.int > 65535n) { err(lineNo, `${directive} needs a register count from 0 to 65535`); break; }
          locals = directive === '.locals'; registers = Number(n.int) + (locals ? ins : 0); registersLine = lineNo;
          if (registers > 65535) err(lineNo, `.locals ${n.int} plus the ${ins} parameter registers is more than 65535`);
          break;
        }
        case '.method': {
          const m = /(\S+)\((.*)$/.exec(rest), flags = rest.split(/\s+/);
          const sig = m ? `(${m[2]}` : '';
          if (!m || m[1] !== target.name || sig !== `(${target.parameters.join('')})${target.result}`) err(lineNo, `.method names ${m ? m[1] + sig : rest || '(nothing)'}, but the hooked method is ${target.name}(${target.parameters.join('')})${target.result}`);
          else if (flags.includes('static') !== !!target.isStatic) err(lineNo, `.method says ${flags.includes('static') ? 'static' : 'instance'}, but the hooked method is ${target.isStatic ? 'static' : 'an instance method'}`);
          break;
        }
        case '.end': if (!/^method$/.test(rest) && !/^(param|local|annotation)\b/.test(rest)) err(lineNo, `unexpected .end ${rest}`); break;
        case '.line': case '.prologue': case '.epilogue': case '.local': case '.restart': case '.source': case '.param': break;   // debug information: not needed to run the body
        case '.annotation': block = { kind: 'skip', end: '.end annotation' }; break;
        case '.catch': case '.catchall': {
          const m = directive === '.catch' ? /^(\S+)\s*\{\s*:([\w$-]+)\s*\.\.\s*:([\w$-]+)\s*\}\s*:([\w$-]+)$/.exec(rest) : /^\{\s*:([\w$-]+)\s*\.\.\s*:([\w$-]+)\s*\}\s*:([\w$-]+)$/.exec(rest);
          if (!m) { err(lineNo, `${directive} is "${directive === '.catch' ? 'Ltype; ' : ''}{:start .. :end} :handler"`); break; }
          const [type, start, end, handler] = directive === '.catch' ? m.slice(1) : [null, ...m.slice(1)];
          if (type !== null && !(isType(type) && type[0] === 'L')) { err(lineNo, `.catch needs a class type (Lpkg/Name;), not ${type}`); break; }
          catches.push({ type, start, end, handler, line: lineNo }); break;
        }
        case '.packed-switch': {
          const first = parseLiteral(rest || '0');
          if (!first || first.int === undefined || first.int < -(2n ** 31n) || first.int > 2n ** 32n - 1n) { err(lineNo, '.packed-switch needs its first key, a 32-bit int'); break; }
          block = { kind: 'packed-switch', item: { payload: 'packed', first: Number(BigInt.asIntN(32, first.int)), targets: [], line: lineNo }, labels: takeLabels() }; break;
        }
        case '.sparse-switch': block = { kind: 'sparse-switch', item: { payload: 'sparse', entries: [], line: lineNo }, labels: takeLabels() }; break;
        case '.array-data': {
          const width = parseLiteral(rest);
          if (!width || ![1n, 2n, 4n, 8n].includes(width.int)) { err(lineNo, '.array-data needs the element width: 1, 2, 4 or 8'); break; }
          block = { kind: 'array-data', item: { payload: 'array', width: Number(width.int), values: [], line: lineNo }, labels: takeLabels() }; break;
        }
        default: err(lineNo, `unknown directive ${directive}`);
      }
      continue;
    }
    const space = line.search(/\s/), mnemonic = space < 0 ? line : line.slice(0, space), operandText = space < 0 ? '' : line.slice(space + 1).trim();
    if (UNSUPPORTED.has(mnemonic)) { err(lineNo, `${mnemonic} is not supported (method handles and call sites, DEX 038+)`); continue; }
    const op = OPS.get(mnemonic);
    if (!op) { err(lineNo, `unknown instruction "${mnemonic}"`); continue; }
    const item = { op, line: lineNo, operands: splitOperands(operandText) };
    for (const label of takeLabels()) labels.set(label.name, { item, line: label.line });
    items.push(item);
  }
  function takeLabels() { const out = pendingLabels; pendingLabels = []; return out; }
  if (block && block.kind !== 'skip') err(block.item.line, `.${block.kind} without .end ${block.kind}`);
  const endLabels = takeLabels();   // labels after the last item stand for the end of the code (a try range may end there)
  if (registers === null) { err(0, 'the body needs .registers N (or .locals N)'); throw new SmaliError(errors); }
  if (registers < ins) err(registersLine, `.registers ${registers} is less than the ${ins} registers the parameters take (${target.isStatic ? '' : 'this, '}${target.parameters.join(', ') || 'no parameters'})`);
  const firstParam = registers - ins;

  // ---- operands ----
  const reg = (item, text, bits) => {
    const m = /^([vp])(\d+)$/.exec(text ?? '');
    if (!m) { err(item.line, `${item.op.name}: "${text ?? ''}" is not a register (vN or pN)`); return 0; }
    let n = Number(m[2]);
    if (m[1] === 'p') { if (n >= ins) { err(item.line, `p${n} does not exist: the method has ${ins} parameter register${ins === 1 ? '' : 's'} (p0-p${ins - 1})`); return 0; } n += firstParam; }
    if (n >= registers) { err(item.line, `${text} is outside the frame (.registers ${registers}: v0-v${registers - 1})`); return 0; }
    if (n >= 2 ** bits) { err(item.line, `${item.op.name} takes registers v0-v${2 ** bits - 1} in this operand, not ${text}${m[1] === 'p' ? ` (v${n})` : ''}${bits === 4 ? ' (use the /from16 or /range form, or a lower register)' : ''}`); return 0; }
    return n;
  };
  const lit = (item, text, min, max, { floatBitsOf = null } = {}) => {
    const value = parseLiteral(text ?? '');
    if (!value) { err(item.line, `${item.op.name}: "${text ?? ''}" is not a literal`); return 0n; }
    let n = value.int;
    if (n === undefined) { if (!floatBitsOf) { err(item.line, `${item.op.name}: ${text} is not an integer`); return 0n; } n = floatBitsOf === 'auto' ? (value.double ? doubleBits(value.float) : floatBits(value.float)) : floatBitsOf === 'double' ? doubleBits(value.float) : floatBits(value.float); }
    if (n < min || n > max) { err(item.line, `${item.op.name}: ${text} is out of range (${min} to ${max})`); return 0n; }
    return n;
  };
  const target_ = (item, text) => { if (!/^:[\w$-]+$/.test(text ?? '')) { err(item.line, `${item.op.name}: "${text ?? ''}" is not a label (:name)`); return null; } return text.slice(1); };
  const regList = (item, text, range) => {
    const body = /^\{(.*)\}$/.exec(text ?? '')?.[1]?.trim();
    if (body === undefined) { err(item.line, `${item.op.name}: the registers go between braces: {v0, v1}${range ? ' or {v0 .. v3}' : ''}`); return []; }
    if (!body) return [];
    if (range) {
      const m = /^(\S+)\s*\.\.\s*(\S+)$/.exec(body), one = /^[vp]\d+$/.test(body);
      if (!m && !one) { err(item.line, `${item.op.name}: a range is {vFirst .. vLast}`); return []; }
      const first = reg(item, one ? body : m[1], 16), last = one ? first : reg(item, m[2], 16);
      if (last < first) { err(item.line, `${item.op.name}: the range ends before it starts`); return []; }
      if (last - first + 1 > 255) { err(item.line, `${item.op.name}: at most 255 registers in a range`); return []; }
      return Array.from({ length: last - first + 1 }, (_, i) => first + i);
    }
    const list = body.split(',').map(s => s.trim()); if (list.length > 5) { err(item.line, `${item.op.name}: at most 5 registers; use the /range form`); return []; }
    return list.map(s => reg(item, s, 4));
  };
  const ref = (item, text) => {
    const kind = item.op.ref;
    if (kind === 's') { const m = /^"(.*)"$/.exec(text ?? ''); const s = m ? unescapeLiteral(m[1]) : null; if (s === null) { err(item.line, `${item.op.name}: "${text ?? ''}" is not a string literal`); return null; } return { kind, value: s }; }
    if (kind === 't') { if (!isType(text ?? '')) { err(item.line, `${item.op.name}: "${text ?? ''}" is not a type (Lpkg/Name;, [I ...)`); return null; } return { kind, type: text }; }
    if (kind === 'f') {
      const m = /^(\[*L[^;\s]+;)->([^:\s]+):(\S+)$/.exec(text ?? '');
      if (!m || !isType(m[3])) { err(item.line, `${item.op.name}: "${text ?? ''}" is not a field (Lpkg/Owner;->name:Type)`); return null; }
      return { kind, owner: m[1], name: m[2], type: m[3] };
    }
    const m = /^(\[*L[^;\s]+;|\[+[ZBSCIJFD])->([^(\s]+)(\(.*)$/.exec(text ?? ''), sig = m ? parseSignature(m[3]) : null;
    if (!m || !sig) { err(item.line, `${item.op.name}: "${text ?? ''}" is not a method (Lpkg/Owner;->name(Params)Return)`); return null; }
    return { kind, owner: m[1], name: m[2], signature: m[3], parameters: sig.parameters, result: sig.result };
  };
  const want = (item, n) => { if (item.operands.length !== n) { err(item.line, `${item.op.name} takes ${n} operand${n === 1 ? '' : 's'}, not ${item.operands.length}`); return false; } return true; };
  const I32MIN = -(2n ** 31n), U32MAX = 2n ** 32n - 1n, I64MIN = -(2n ** 63n), U64MAX = 2n ** 64n - 1n;
  for (const item of items) {
    if (item.payload) continue;
    const { op } = item, o = item.operands; item.regs = []; item.lit = 0n; item.label = null; item.ref = null;
    switch (op.fmt) {
      case '10x': want(item, 0); break;
      case '12x': if (want(item, 2)) item.regs = [reg(item, o[0], 4), reg(item, o[1], 4)]; break;
      case '11n': if (want(item, 2)) { item.regs = [reg(item, o[0], 4)]; item.lit = lit(item, o[1], -8n, 7n); } break;
      case '11x': if (want(item, 1)) item.regs = [reg(item, o[0], 8)]; break;
      case '10t': case '20t': case '30t': if (want(item, 1)) item.label = target_(item, o[0]); break;
      case '22x': if (want(item, 2)) item.regs = [reg(item, o[0], 8), reg(item, o[1], 16)]; break;
      case '32x': if (want(item, 2)) item.regs = [reg(item, o[0], 16), reg(item, o[1], 16)]; break;
      case '21t': if (want(item, 2)) { item.regs = [reg(item, o[0], 8)]; item.label = target_(item, o[1]); } break;
      case '21s': if (want(item, 2)) { item.regs = [reg(item, o[0], 8)]; item.lit = lit(item, o[1], -32768n, 32767n); } break;
      case '21h': if (want(item, 2)) {
        item.regs = [reg(item, o[0], 8)];
        const wide = op.op === 0x19, value = lit(item, o[1], wide ? I64MIN : I32MIN, wide ? U64MAX : U32MAX, { floatBitsOf: wide ? 'double' : 'float' }), shift = wide ? 48n : 16n;
        if (BigInt.asUintN(Number(shift), value) !== 0n) err(item.line, `${op.name}: ${o[1]} has bits below the top 16 (use ${wide ? 'const-wide' : 'const'})`);
        item.lit = BigInt.asIntN(16, BigInt.asUintN(wide ? 64 : 32, value) >> shift);
      } break;
      case '21c': case '31c': if (want(item, 2)) { item.regs = [reg(item, o[0], 8)]; item.ref = ref(item, o[1]); } break;
      case '23x': if (want(item, 3)) item.regs = [reg(item, o[0], 8), reg(item, o[1], 8), reg(item, o[2], 8)]; break;
      case '22b': if (want(item, 3)) { item.regs = [reg(item, o[0], 8), reg(item, o[1], 8)]; item.lit = lit(item, o[2], -128n, 127n); } break;
      case '22t': if (want(item, 3)) { item.regs = [reg(item, o[0], 4), reg(item, o[1], 4)]; item.label = target_(item, o[2]); } break;
      case '22s': if (want(item, 3)) { item.regs = [reg(item, o[0], 4), reg(item, o[1], 4)]; item.lit = lit(item, o[2], -32768n, 32767n); } break;
      case '22c': if (want(item, 3)) { item.regs = [reg(item, o[0], 4), reg(item, o[1], 4)]; item.ref = ref(item, o[2]); } break;
      case '31i': if (want(item, 2)) { item.regs = [reg(item, o[0], 8)]; item.lit = BigInt.asIntN(32, lit(item, o[1], I32MIN, U32MAX, { floatBitsOf: op.op === 0x14 ? 'float' : null })); } break;
      case '31t': if (want(item, 2)) { item.regs = [reg(item, o[0], 8)]; item.label = target_(item, o[1]); } break;
      case '35c': case '3rc': if (want(item, 2)) { item.regs = regList(item, o[0], op.fmt === '3rc'); item.ref = ref(item, o[1]); } break;
      case '51l': if (want(item, 2)) { item.regs = [reg(item, o[0], 8)]; item.lit = BigInt.asIntN(64, lit(item, o[1], I64MIN, U64MAX, { floatBitsOf: 'double' })); } break;
    }
  }

  // ---- layout: addresses (payloads 4-byte aligned, a nop before one that would not be) ----
  let address = 0; const layout = [];
  for (const item of items) {
    if (item.payload) {
      if (address & 1) { const pad = { op: OPS.get('nop'), line: layout.at(-1)?.line ?? item.line, regs: [], operands: [], padding: true, address, size: 1, label: null, ref: null }; layout.push(pad); address += 1; }   // reached only by falling through the instruction before it
      item.address = address;
      item.size = item.payload === 'packed' ? 4 + 2 * item.targets.length : item.payload === 'sparse' ? 2 + 4 * item.entries.length : 4 + Math.ceil(item.width * item.values.length / 2);
    } else { item.address = address; item.size = UNITS[item.op.fmt]; }
    layout.push(item); address += item.size;
  }
  const size = address;
  if (size === 0) err(registersLine, 'the body has no instructions');
  if (size > maxUnits) err(0, `the body has ${size} code units (at most ${maxUnits})`);
  const labelAddress = name => { const at = labels.get(name); if (at) return at.item.address; if (endLabels.some(label => label.name === name)) return size; return undefined; };
  const labelItem = name => labels.get(name)?.item ?? null;

  // ---- references, branch targets, payload links ----
  for (const item of layout) {
    if (item.payload || item.padding) continue;
    if (item.label !== null) {
      const target = labelItem(item.label);
      if (!labels.has(item.label) && !endLabels.some(label => label.name === item.label)) err(item.line, `label :${item.label} is not defined`);
      else if (item.op.fmt === '31t') {
        const wanted = item.op.op === 0x2b ? 'packed' : item.op.op === 0x2c ? 'sparse' : 'array';
        if (!target || target.payload !== wanted) err(item.line, `${item.op.name} needs a label on ${wanted === 'packed' ? '.packed-switch' : wanted === 'sparse' ? '.sparse-switch' : '.array-data'}`);
        else (target.users ??= []).push(item);
      } else if (!target || target.payload) err(item.line, `${item.op.name}: :${item.label} is not on an instruction`);
      else {
        const offset = target.address - item.address, bits = item.op.fmt === '10t' ? 8 : item.op.fmt === '30t' ? 32 : 16;
        if (offset === 0 && item.op.fmt !== '30t') err(item.line, `${item.op.name} to itself is not allowed (use goto/32 for an endless loop)`);
        else if (offset < -(2 ** (bits - 1)) || offset >= 2 ** (bits - 1)) err(item.line, `${item.op.name}: :${item.label} is ${offset} code units away, beyond its ${bits}-bit offset${bits < 32 ? ` (use ${bits === 8 ? 'goto/16 or ' : ''}${item.op.fmt.startsWith('2') && bits === 16 && item.op.name.startsWith('goto') ? 'goto/32' : bits === 8 ? 'goto/32' : 'a goto/32 around it'})` : ''}`);
      }
    }
  }
  for (const item of layout) if (item.payload) {
    if (item.payload !== 'array') for (const entry of item.payload === 'packed' ? item.targets : item.entries) { const t = labelItem(entry.label); if (!t || t.payload) err(entry.line, `switch target :${entry.label} is not on an instruction`); else entry.item = t; }
    if (item.payload === 'sparse') { const keys = item.entries.map(e => e.key); for (let i = 1; i < keys.length; i++) if (keys[i] <= keys[i - 1]) { err(item.entries[i].line, `.sparse-switch keys must increase (${keys[i]} after ${keys[i - 1]})`); break; } }
    if (item.payload === 'packed' && item.first + item.targets.length - 1 > 2147483647) err(item.line, '.packed-switch keys pass the int range');
    if ((item.users ?? []).length > 1 && item.payload !== 'array') err(item.line, 'a switch payload is used by one switch only');
  }
  // tries: [start, end) by address; the handlers of the ranges that cover each piece, in declaration order (a catch-all last)
  const tries = [];
  for (const c of catches) {
    const start = labelAddress(c.start), end = labelAddress(c.end), handler = labelItem(c.handler);
    if (start === undefined) { err(c.line, `label :${c.start} is not defined`); continue; }
    if (end === undefined) { err(c.line, `label :${c.end} is not defined`); continue; }
    if (!handler || handler.payload) { err(c.line, `handler :${c.handler} is not on an instruction`); continue; }
    if (end <= start) { err(c.line, `the try range :${c.start} .. :${c.end} is empty`); continue; }
    c.from = start; c.to = end; c.address = handler.address; c.handlerItem = handler;
  }
  const ranges = catches.filter(c => c.from !== undefined);
  if (ranges.length) {
    const points = [...new Set(ranges.flatMap(c => [c.from, c.to]))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i], to = points[i + 1], covering = ranges.filter(c => c.from <= from && c.to >= to);
      if (!covering.length) continue;
      const handlers = [], seenTypes = new Set(); let catchAll = null;
      for (const c of covering) { if (c.type === null) { catchAll ??= c.address; continue; } if (catchAll === null && !seenTypes.has(c.type)) { seenTypes.add(c.type); handlers.push({ type: c.type, address: c.address }); } }
      const key = JSON.stringify([handlers, catchAll]), last = tries.at(-1);
      if (last && last.to === from && last.key === key) last.to = to; else tries.push({ from, to, handlers, catchAll, key });
    }
    for (const t of tries) if (t.to - t.from > 65535) err(0, 'a try range covers more than 65535 code units');
  }

  // ---- references: resolvable in the running VM (their errors are reported with the flow's: neither depends on the other) ----
  if (errors.length) throw new SmaliError(errors);
  const parameterTypes = target.parameters;
  for (const item of layout) {
    if (item.payload || item.padding || !item.ref) continue;
    const r = item.ref;
    if (r.kind === 't' || r.kind === 'f' || r.kind === 'm') {
      const types = r.kind === 't' ? [r.type] : r.kind === 'f' ? [r.owner, r.type] : [r.owner, ...r.parameters, r.result];
      for (const type of types) { const base = type.replace(/^\[+/, ''); if (base[0] === 'L' && resolver && !resolver.classExists(base)) err(item.line, `class ${base} is not in the APK, its DEX files or the lab's framework`); }
    }
    if (r.kind === 't') {
      const op = item.op.op;
      if (op === 0x22 && r.type[0] !== 'L') err(item.line, `new-instance needs a class type, not ${r.type}`);
      if ((op === 0x23 || op === 0x24 || op === 0x25) && r.type[0] !== '[') err(item.line, `${item.op.name} needs an array type, not ${r.type}`);
      if ((op === 0x24 || op === 0x25) && isWideType(r.type.slice(1))) err(item.line, `${item.op.name} cannot make a long[] or double[] (use new-array and fill-array-data)`);
    }
    if (r.kind === 'f') {
      const variant = (item.op.op - 0x52) % 7, wantKind = ['I', 'W', 'L', 'Z', 'B', 'C', 'S'][variant], type = r.type;
      const fits = wantKind === 'I' ? type === 'I' || type === 'F' : wantKind === 'W' ? isWideType(type) : wantKind === 'L' ? isRefType(type) : type === wantKind;
      if (!fits) err(item.line, `${item.op.name} cannot access ${r.name}, a field of type ${type} (use ${fieldOp(item.op.name, type)})`);
      if (resolver) { const problem = resolver.field(r.owner, r.name, r.type, item.op.op >= 0x60); if (problem) err(item.line, problem); }
    }
    if (r.kind === 'm') {
      const kindName = item.op.name.replace(/^invoke-/, '').replace('/range', '');
      if (r.name === '<clinit>') err(item.line, 'a static initializer cannot be called');
      if (r.name === '<init>' && kindName !== 'direct') err(item.line, 'a constructor is called with invoke-direct');
      const words = wordsOf(r.parameters) + (kindName === 'static' ? 0 : 1);
      if (item.regs.length !== words) err(item.line, `${item.op.name} ${r.owner}->${r.name}${r.signature} passes ${item.regs.length} register${item.regs.length === 1 ? '' : 's'}; the method takes ${words} (${kindName === 'static' ? '' : 'the receiver, '}${r.parameters.map(t => isWideType(t) ? `${t} (2)` : t).join(', ') || 'no parameters'})`);
      if (resolver) { const problem = resolver.method(r.owner, r.name, r.signature, kindName); if (problem) err(item.line, problem); }
    }
  }
  for (const c of ranges) if (c.type && resolver && !resolver.classExists(c.type)) err(c.line, `class ${c.type} is not in the APK, its DEX files or the lab's framework`);

  verifyFlow({ layout, size, registers, ins, firstParam, parameterTypes, target, tries, labels, err });
  if (errors.length) throw new SmaliError(errors);

  // ---- encoding ----
  const units = new Uint16Array(size);
  const offsetTo = (item, name) => labelItem(name).address - item.address;
  for (const item of layout) {
    const at = item.address;
    if (item.payload) { encodePayload(units, item); continue; }
    const { op } = item, r = item.regs, l = item.lit;
    const w = (...values) => values.forEach((v, i) => { units[at + i] = Number(v) & 0xffff; });
    switch (op.fmt) {
      case '10x': w(op.op); break;
      case '12x': w(op.op | (r[0] << 8) | (r[1] << 12)); break;
      case '11n': w(op.op | (r[0] << 8) | ((Number(l) & 15) << 12)); break;
      case '11x': w(op.op | (r[0] << 8)); break;
      case '10t': w(op.op | ((offsetTo(item, item.label) & 255) << 8)); break;
      case '20t': w(op.op, offsetTo(item, item.label)); break;
      case '30t': { const off = offsetTo(item, item.label); w(op.op, off, off >> 16); break; }
      case '22x': w(op.op | (r[0] << 8), r[1]); break;
      case '32x': w(op.op, r[0], r[1]); break;
      case '21t': w(op.op | (r[0] << 8), offsetTo(item, item.label)); break;
      case '21s': case '21h': w(op.op | (r[0] << 8), Number(BigInt.asUintN(16, l))); break;
      case '21c': w(op.op | (r[0] << 8), 0); break;   // the index is written once the pools are sorted (below)
      case '23x': w(op.op | (r[0] << 8), r[1] | (r[2] << 8)); break;
      case '22b': w(op.op | (r[0] << 8), r[1] | ((Number(l) & 255) << 8)); break;
      case '22t': w(op.op | (r[0] << 8) | (r[1] << 12), offsetTo(item, item.label)); break;
      case '22s': w(op.op | (r[0] << 8) | (r[1] << 12), Number(BigInt.asUintN(16, l))); break;
      case '22c': w(op.op | (r[0] << 8) | (r[1] << 12), 0); break;
      case '31i': { const v = Number(BigInt.asUintN(32, l)); w(op.op | (r[0] << 8), v & 0xffff, v >>> 16); break; }
      case '31t': { const off = offsetTo(item, item.label); w(op.op | (r[0] << 8), off, off >> 16); break; }
      case '31c': w(op.op | (r[0] << 8), 0, 0); break;
      case '35c': { const n = r.length, g = n === 5 ? r[4] : 0; w(op.op | (g << 8) | (n << 12), 0, (r[0] ?? 0) | ((r[1] ?? 0) << 4) | ((r[2] ?? 0) << 8) | ((r[3] ?? 0) << 12)); break; }
      case '3rc': w(op.op | (r.length << 8), 0, r[0] ?? 0); break;
      case '51l': { const v = BigInt.asUintN(64, l); w(op.op | (r[0] << 8), v & 0xffffn, (v >> 16n) & 0xffffn, (v >> 32n) & 0xffffn, (v >> 48n) & 0xffffn); break; }
    }
  }
  const outs = layout.reduce((n, item) => item.op?.ref === 'm' ? Math.max(n, item.regs.length) : n, 0);
  const dex = writeDex({ layout, units, registers, ins, outs, tries, target });
  return { ...dex, units, registers, ins, outs, tries: tries.length, instructions: layout.filter(item => !item.payload && !item.padding).length };
}
function fieldOp(name, type) {
  const base = name.replace(/-(wide|object|boolean|byte|char|short)$/, '');
  const suffix = type === 'I' || type === 'F' ? '' : isWideType(type) ? '-wide' : isRefType(type) ? '-object' : { Z: '-boolean', B: '-byte', C: '-char', S: '-short' }[type];
  return base + suffix;
}
function encodePayload(units, item) {
  const at = item.address;
  if (item.payload === 'packed') {
    const n = item.targets.length, user = item.users?.[0];
    units[at] = 0x0100; units[at + 1] = n; units[at + 2] = item.first & 0xffff; units[at + 3] = (item.first >>> 16) & 0xffff;
    item.targets.forEach((t, i) => { const off = user ? t.item.address - user.address : 0; units[at + 4 + 2 * i] = off & 0xffff; units[at + 5 + 2 * i] = (off >>> 16) & 0xffff; });
  } else if (item.payload === 'sparse') {
    const n = item.entries.length, user = item.users?.[0];
    units[at] = 0x0200; units[at + 1] = n;
    item.entries.forEach((e, i) => { units[at + 2 + 2 * i] = e.key & 0xffff; units[at + 3 + 2 * i] = (e.key >>> 16) & 0xffff; const off = user ? e.item.address - user.address : 0; units[at + 2 + 2 * n + 2 * i] = off & 0xffff; units[at + 3 + 2 * n + 2 * i] = (off >>> 16) & 0xffff; });
  } else {
    const n = item.values.length, bytes = new Uint8Array(Math.ceil(item.width * n / 2) * 2);
    item.values.forEach((v, i) => { for (let b = 0; b < item.width; b++) bytes[i * item.width + b] = Number((v >> BigInt(8 * b)) & 0xffn); });
    units[at] = 0x0300; units[at + 1] = item.width; units[at + 2] = n & 0xffff; units[at + 3] = n >>> 16;
    for (let i = 0; i < bytes.length / 2; i++) units[at + 4 + i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  }
}

// ---- flow and register kinds -------------------------------------------------------------------------------------------------------------------------------------
// Kinds: U unset, Z the constant 0 (an int or null), I a 32-bit primitive, R a reference, WL / WH the halves of a long or double, X different kinds from different paths;
// an object new-instance made and whose constructor has not run yet is UNINIT + the index of that new-instance.
const U = 0, Z = 1, I = 2, R = 3, WL = 4, WH = 5, X = 6, UNINIT = 100;
const KIND_TEXT = { [U]: 'is read before it is assigned on some path', [X]: 'holds different kinds of value on the paths that reach here', [R]: 'holds a reference', [I]: 'holds a 32-bit primitive', [Z]: 'holds the constant 0', [WL]: 'holds the first half of a long/double', [WH]: 'holds the second half of a long/double' };
const merge = (a, b) => a === b ? a : a === U || b === U ? U : (a === Z && (b === I || b === R)) || (b === Z && (a === I || a === R)) ? (a === Z ? b : a) : X;
function verifyFlow({ layout, size, registers, ins, firstParam, parameterTypes, target, tries, labels, err }) {
  const code = layout.filter(item => !item.payload), byAddress = new Map(code.map((item, index) => { item.index = index; return [item.address, item]; }));
  const payloadAt = new Set(layout.filter(item => item.payload).map(item => item.address));
  const initial = new Array(registers).fill(U); let p = firstParam;
  if (!target.isStatic) initial[p++] = R;
  for (const t of parameterTypes) { if (isWideType(t)) { initial[p] = WL; initial[p + 1] = WH; p += 2; } else initial[p++] = isRefType(t) ? R : I; }
  const states = new Array(code.length).fill(null), work = [], reported = new Set();
  const report = (item, message) => { const key = `${item.line}:${message}`; if (!reported.has(key)) { reported.add(key); err(item.line, message); } };
  const enqueue = (index, regs, res, exc) => {
    const known = states[index];
    if (!known) { states[index] = { regs: regs.slice(), res, exc }; work.push(index); return; }
    let changed = false;
    for (let i = 0; i < registers; i++) { const m = merge(known.regs[i], regs[i]); if (m !== known.regs[i]) { known.regs[i] = m; changed = true; } }
    const r = known.res === res ? res : null; if (r !== known.res) { known.res = r; changed = true; }
    const e = known.exc && exc; if (e !== known.exc) { known.exc = e; changed = true; }
    if (changed) work.push(index);
  };
  const handlersOf = address => { const out = []; for (const t of tries) if (address >= t.from && address < t.to) { for (const h of t.handlers) out.push(h.address); if (t.catchAll !== null) out.push(t.catchAll); } return out; };
  const flowTo = (item, address, regs, res, exc = false) => {
    if (payloadAt.has(address)) { report(item, 'execution runs into a switch or array-data payload'); return; }
    const next = byAddress.get(address);
    if (!next) { if (address >= size) report(item, 'execution runs off the end of the code (end it with a return, throw or goto)'); return; }
    enqueue(next.index, regs, res, exc);
  };
  if (code.length) enqueue(0, initial, null, false);
  while (work.length) {
    const index = work.pop(), item = code[index], state = states[index], regs = state.regs.slice();
    if (item.padding) { flowTo(item, item.address + 1, regs, null); continue; }
    const before = regs.slice();
    let res = null, continues = true;
    const kind = r => regs[r];
    const describe = (r, k) => `v${r}${r >= firstParam ? ` (p${r - firstParam})` : ''} ${k >= UNINIT ? 'holds an object whose constructor has not run yet' : KIND_TEXT[k] ?? 'holds an unexpected value'}`;
    const need1 = (r, what = 'a 32-bit primitive') => { const k = kind(r); if (k !== I && k !== Z) report(item, `${item.op.name}: ${describe(r, k)}; ${what} is expected`); };
    const needRef = (r, { uninit = false } = {}) => { const k = kind(r); if (k !== R && k !== Z && !(uninit && k >= UNINIT)) report(item, `${item.op.name}: ${describe(r, k)}; a reference is expected`); };
    const needWide = r => { if (r + 1 >= registers) { report(item, `${item.op.name}: v${r} is the last register; a long/double takes two (v${r}, v${r + 1})`); return; } if (kind(r) !== WL || kind(r + 1) !== WH) report(item, `${item.op.name}: v${r}/v${r + 1} do not hold a long or double (${describe(r, kind(r))})`); };
    const clobber = r => { if (regs[r] === WH && r > 0 && regs[r - 1] === WL) regs[r - 1] = X; if (regs[r] === WL && r + 1 < registers && regs[r + 1] === WH) regs[r + 1] = X; };
    const set = (r, k) => { clobber(r); regs[r] = k; };
    const setWide = r => { if (r + 1 >= registers) { report(item, `${item.op.name}: v${r} is the last register; a long/double takes two (v${r}, v${r + 1})`); return; } clobber(r); clobber(r + 1); regs[r] = WL; regs[r + 1] = WH; };
    const byType = (r, type) => { if (isWideType(type)) needWide(r); else if (isRefType(type)) needRef(r); else need1(r); };
    const setByType = (r, type) => { if (isWideType(type)) setWide(r); else set(r, isRefType(type) ? R : I); };
    const { op } = item, o = op.op, g = item.regs;
    if (o >= 0x0a && o <= 0x0c) {   // move-result*
      const want = o === 0x0a ? 'a primitive' : o === 0x0b ? 'a long/double' : 'an object';
      let rt = state.res;
      if (rt === null || rt === undefined) report(item, `${op.name} must follow the call (or filled-new-array) whose result it takes, on every path`);
      else if (rt === 'V') report(item, `${op.name} after a call that returns void`);
      else if ((o === 0x0a && (isWideType(rt) || isRefType(rt))) || (o === 0x0b && !isWideType(rt)) || (o === 0x0c && !isRefType(rt))) report(item, `${op.name} takes ${want}, but the call returns ${rt}`);
      else { setByType(g[0], rt); rt = 'ok'; }
      if (rt !== 'ok') setByType(g[0], o === 0x0a ? 'I' : o === 0x0b ? 'J' : 'Ljava/lang/Object;');   // reported once: the register still holds that kind for what follows
    } else if (o === 0x0d) {
      if (!state.exc) report(item, 'move-exception must be the first instruction of a handler');
      set(g[0], R);
    } else switch (true) {
      case o === 0x00: break;
      case o === 0x01 || o === 0x02 || o === 0x03: need1(g[1]); set(g[0], kind(g[1]) === Z ? Z : I); break;
      case o === 0x04 || o === 0x05 || o === 0x06: needWide(g[1]); setWide(g[0]); break;
      case o === 0x07 || o === 0x08 || o === 0x09: { needRef(g[1], { uninit: true }); const k = kind(g[1]); set(g[0], k === Z || k >= UNINIT ? k : R); break; }
      case o === 0x0e: if (target.result !== 'V') report(item, `return-void in a method that returns ${target.result}`); continues = false; break;
      case o === 0x0f || o === 0x10 || o === 0x11: {
        const t = target.result, fits = o === 0x0f ? t !== 'V' && !isWideType(t) && !isRefType(t) : o === 0x10 ? isWideType(t) : isRefType(t);
        if (!fits) report(item, `${op.name} in a method that returns ${t} (use ${t === 'V' ? 'return-void' : isWideType(t) ? 'return-wide' : isRefType(t) ? 'return-object' : 'return'})`);
        else byType(g[0], t);
        continues = false; break;
      }
      case o === 0x12 || o === 0x13 || o === 0x14 || o === 0x15: set(g[0], item.lit === 0n ? Z : I); break;
      case o >= 0x16 && o <= 0x19: setWide(g[0]); break;
      case o === 0x1a || o === 0x1b || o === 0x1c: set(g[0], R); break;
      case o === 0x1d || o === 0x1e: needRef(g[0]); break;
      case o === 0x1f: needRef(g[0]); if (kind(g[0]) !== Z) set(g[0], R); break;
      case o === 0x20: needRef(g[1]); set(g[0], I); break;
      case o === 0x21: needRef(g[1]); set(g[0], I); break;
      case o === 0x22: set(g[0], UNINIT + item.index); break;
      case o === 0x23: need1(g[1], 'an int (the length)'); set(g[0], R); break;
      case o === 0x24 || o === 0x25: { const element = item.ref?.type?.slice(1) ?? 'I'; for (const r of g) byType(r, element); res = item.ref?.type ?? null; break; }
      case o === 0x26: needRef(g[0]); break;
      case o === 0x27: needRef(g[0]); continues = false; break;
      case o >= 0x28 && o <= 0x2a: continues = false; break;
      case o === 0x2b || o === 0x2c: need1(g[0], 'an int (the key)'); break;
      case o === 0x2d || o === 0x2e: need1(g[1]); need1(g[2]); set(g[0], I); break;
      case o >= 0x2f && o <= 0x31: needWide(g[1]); needWide(g[2]); set(g[0], I); break;
      case o === 0x32 || o === 0x33: { const a = kind(g[0]), b = kind(g[1]); const refs = (a === R || a === Z) && (b === R || b === Z), prims = (a === I || a === Z) && (b === I || b === Z); if (!refs && !prims) report(item, `${op.name}: v${g[0]} and v${g[1]} are not both 32-bit primitives or both references (${describe(g[0], a)}; ${describe(g[1], b)})`); break; }
      case o >= 0x34 && o <= 0x37: need1(g[0]); need1(g[1]); break;
      case o === 0x38 || o === 0x39: { const k = kind(g[0]); if (k !== I && k !== Z && k !== R) report(item, `${op.name}: ${describe(g[0], k)}; a 32-bit primitive or a reference is expected`); break; }
      case o >= 0x3a && o <= 0x3d: need1(g[0]); break;
      case o >= 0x44 && o <= 0x4a: { needRef(g[1]); need1(g[2], 'an int (the index)'); const v = o - 0x44; if (v === 1) setWide(g[0]); else set(g[0], v === 2 ? R : I); break; }
      case o >= 0x4b && o <= 0x51: { needRef(g[1]); need1(g[2], 'an int (the index)'); const v = o - 0x4b; if (v === 1) needWide(g[0]); else if (v === 2) needRef(g[0]); else need1(g[0]); break; }
      case o >= 0x52 && o <= 0x58: needRef(g[1]); if (item.ref) setByType(g[0], item.ref.type); break;
      case o >= 0x59 && o <= 0x5f: needRef(g[1]); if (item.ref) byType(g[0], item.ref.type); break;
      case o >= 0x60 && o <= 0x66: if (item.ref) setByType(g[0], item.ref.type); break;
      case o >= 0x67 && o <= 0x6d: if (item.ref) byType(g[0], item.ref.type); break;
      case (o >= 0x6e && o <= 0x72) || (o >= 0x74 && o <= 0x78): {
        const r = item.ref; if (!r) break;
        const isStatic = o === 0x71 || o === 0x77, ctor = r.name === '<init>' && (o === 0x70 || o === 0x76);
        let at = 0;
        if (!isStatic) { needRef(g[0], { uninit: ctor }); at = 1; }
        for (const t of r.parameters) {
          if (at >= g.length) break;
          if (isWideType(t)) { if (g[at + 1] !== g[at] + 1) report(item, `${op.name}: the ${t === 'J' ? 'long' : 'double'} argument takes two consecutive registers (v${g[at]}, v${g[at] + 1})`); else needWide(g[at]); at += 2; }
          else { byType(g[at], t); at++; }
        }
        if (ctor && kind(g[0]) >= UNINIT) { const made = kind(g[0]); for (let i = 0; i < registers; i++) if (regs[i] === made) regs[i] = R; }
        res = r.result; break;
      }
      case o >= 0x7b && o <= 0x8f: {
        const shapes = ['II', 'II', 'WW', 'WW', 'II', 'WW', 'IW', 'II', 'IW', 'WI', 'WI', 'WW', 'II', 'IW', 'IW', 'WI', 'WW', 'WI', 'II', 'II', 'II'], [from, to] = shapes[o - 0x7b];
        if (from === 'W') needWide(g[1]); else need1(g[1]);
        if (to === 'W') setWide(g[0]); else set(g[0], I);
        break;
      }
      case o >= 0x90 && o <= 0xaf: { const [, k, shift] = BINOP_INFO[o - 0x90]; if (k === 'w' || k === 'd') { needWide(g[1]); if (shift) need1(g[2]); else needWide(g[2]); setWide(g[0]); } else { need1(g[1]); need1(g[2]); set(g[0], I); } break; }
      case o >= 0xb0 && o <= 0xcf: { const [, k, shift] = BINOP_INFO[o - 0xb0]; if (k === 'w' || k === 'd') { needWide(g[0]); if (shift) need1(g[1]); else needWide(g[1]); setWide(g[0]); } else { need1(g[0]); need1(g[1]); set(g[0], I); } break; }
      case o >= 0xd0 && o <= 0xe2: need1(g[1]); set(g[0], I); break;
    }
    // successors: the next instruction, the branch / switch targets, and the handlers of a try range (with the registers as they were before the instruction)
    for (const h of handlersOf(item.address)) flowTo(item, h, before, null, true);
    if (item.label !== null && item.op.fmt !== '31t') { const t = labels.get(item.label)?.item; if (t) flowTo(item, t.address, regs, null); }
    if (o === 0x2b || o === 0x2c) { const payload = labels.get(item.label)?.item; for (const entry of payload?.targets ?? payload?.entries ?? []) if (entry.item) flowTo(item, entry.item.address, regs, null); }
    if (continues) flowTo(item, item.address + item.size, regs, res);
  }
}

// ---- the DEX file ------------------------------------------------------------------------------------------------------------------------------------------------
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function mutf8(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c !== 0 && c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function uleb(out, value) { do { let b = value & 127; value >>>= 7; if (value) b |= 128; out.push(b); } while (value); }
function sleb(out, value) { for (;;) { const b = value & 127; value >>= 7; if ((value === 0 && !(b & 64)) || (value === -1 && (b & 64))) { out.push(b); return; } out.push(b | 128); } }
function adler32(bytes, from) { let a = 1, b = 0; for (let i = from; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }
/** A minimal DEX 035 file: the ids the body names plus the hooked method's own id, and one code item (no class definition). */
function writeDex({ layout, units, registers, ins, outs, tries, target }) {
  const strings = new Set(), types = new Set(), protos = new Map(), fields = new Map(), methods = new Map();
  const addType = t => { types.add(t); strings.add(t); };
  const addProto = (parameters, result) => { const key = `(${parameters.join('')})${result}`; if (!protos.has(key)) { const shorty = shortyChar(result) + parameters.map(shortyChar).join(''); protos.set(key, { parameters, result, shorty }); strings.add(shorty); addType(result); parameters.forEach(addType); } return key; };
  const addMethod = (owner, name, parameters, result) => { addType(owner); strings.add(name); const proto = addProto(parameters, result), key = `${owner}->${name}${proto}`; if (!methods.has(key)) methods.set(key, { owner, name, proto }); return key; };
  const selfKey = addMethod(target.owner, target.name, target.parameters, target.result);
  for (const item of layout) {
    const r = item.ref; if (!r) continue;
    if (r.kind === 's') strings.add(r.value);
    else if (r.kind === 't') addType(r.type);
    else if (r.kind === 'f') { addType(r.owner); addType(r.type); strings.add(r.name); const key = `${r.owner}->${r.name}:${r.type}`; if (!fields.has(key)) fields.set(key, { owner: r.owner, name: r.name, type: r.type }); }
    else if (r.kind === 'm') r.key = addMethod(r.owner, r.name, r.parameters, r.result);
  }
  for (const t of tries) for (const h of t.handlers) addType(h.type);
  const stringList = [...strings].sort(cmp), stringIndex = new Map(stringList.map((s, i) => [s, i]));
  const typeList = [...types].sort((a, b) => stringIndex.get(a) - stringIndex.get(b)), typeIndex = new Map(typeList.map((t, i) => [t, i]));
  const protoList = [...protos.entries()].sort(([, a], [, b]) => typeIndex.get(a.result) - typeIndex.get(b.result) || compareLists(a.parameters.map(t => typeIndex.get(t)), b.parameters.map(t => typeIndex.get(t)))), protoIndex = new Map(protoList.map(([key], i) => [key, i]));
  const fieldList = [...fields.entries()].sort(([, a], [, b]) => typeIndex.get(a.owner) - typeIndex.get(b.owner) || stringIndex.get(a.name) - stringIndex.get(b.name) || typeIndex.get(a.type) - typeIndex.get(b.type)), fieldIndex = new Map(fieldList.map(([key], i) => [key, i]));
  const methodList = [...methods.entries()].sort(([, a], [, b]) => typeIndex.get(a.owner) - typeIndex.get(b.owner) || stringIndex.get(a.name) - stringIndex.get(b.name) || protoIndex.get(a.proto) - protoIndex.get(b.proto)), methodIndex = new Map(methodList.map(([key], i) => [key, i]));
  // the indexes of the instructions
  for (const item of layout) {
    const r = item.ref; if (!r) continue;
    const index = r.kind === 's' ? stringIndex.get(r.value) : r.kind === 't' ? typeIndex.get(r.type) : r.kind === 'f' ? fieldIndex.get(`${r.owner}->${r.name}:${r.type}`) : methodIndex.get(r.key);
    if (item.op.fmt === '31c') { units[item.address + 1] = index & 0xffff; units[item.address + 2] = index >>> 16; }
    else { if (index > 0xffff) throw new SmaliError([{ line: item.line, message: `${item.op.name}: more than 65536 ${r.kind === 's' ? 'strings (use const-string/jumbo)' : 'ids'}` }]); units[item.address + 1] = index; }
  }
  // layout of the file
  const HEADER = 0x70, align4 = n => (n + 3) & ~3;
  let at = HEADER;
  const stringIdsOff = at; at += 4 * stringList.length;
  const typeIdsOff = at; at += 4 * typeList.length;
  const protoIdsOff = at; at += 12 * protoList.length;
  const fieldIdsOff = at; at += 8 * fieldList.length;
  const methodIdsOff = at; at += 8 * methodList.length;
  const dataOff = at = align4(at);
  // code item
  const codeOff = at, triesBytes = [], handlerBytes = [];
  if (tries.length) {   // encoded_catch_handler_list: its size, then one encoded_catch_handler per distinct handler list (a try_item's handler_off counts from the list's start)
    const lists = new Map();
    for (const t of tries) if (!lists.has(t.key)) {
      const bytes = []; sleb(bytes, t.catchAll !== null ? -t.handlers.length : t.handlers.length);
      for (const h of t.handlers) { uleb(bytes, typeIndex.get(h.type)); uleb(bytes, h.address); }
      if (t.catchAll !== null) uleb(bytes, t.catchAll);
      lists.set(t.key, { bytes, offset: 0 });
    }
    uleb(handlerBytes, lists.size);
    for (const list of lists.values()) { list.offset = handlerBytes.length; handlerBytes.push(...list.bytes); }
    for (const t of tries) triesBytes.push(t.from, t.to - t.from, lists.get(t.key).offset);
  }
  const insnsBytes = units.length * 2, pad = tries.length && (units.length & 1) ? 2 : 0;
  at = codeOff + 16 + insnsBytes + pad + 8 * tries.length + handlerBytes.length;
  // type lists (of the protos with parameters)
  const typeListOffsets = new Map(); at = align4(at);
  const typeListAt = at;
  for (const [key, proto] of protoList) if (proto.parameters.length) { at = align4(at); typeListOffsets.set(key, at); at += 4 + 2 * proto.parameters.length; }
  const typeListCount = typeListOffsets.size;
  // string data
  const stringDataAt = at, stringData = stringList.map(s => { const bytes = []; uleb(bytes, s.length); bytes.push(...mutf8(s), 0); return bytes; });
  const stringOffsets = []; for (const bytes of stringData) { stringOffsets.push(at); at += bytes.length; }
  // map list
  at = align4(at); const mapOff = at;
  const mapItems = [[0x0000, 1, 0], [0x0001, stringList.length, stringIdsOff], [0x0002, typeList.length, typeIdsOff], [0x0003, protoList.length, protoIdsOff], [0x0004, fieldList.length, fieldIdsOff],
    [0x0005, methodList.length, methodIdsOff], [0x2001, 1, codeOff], ...(typeListCount ? [[0x1001, typeListCount, typeListAt]] : []), [0x2002, stringList.length, stringDataAt], [0x1000, 1, mapOff]].filter(([, n]) => n > 0);
  at += 4 + 12 * mapItems.length;
  const fileSize = at, bytes = new Uint8Array(fileSize), view = new DataView(bytes.buffer);
  const u32 = (p, v) => view.setUint32(p, v >>> 0, true), u16 = (p, v) => view.setUint16(p, v & 0xffff, true);
  bytes.set([0x64, 0x65, 0x78, 0x0a, 0x30, 0x33, 0x35, 0x00], 0);
  u32(32, fileSize); u32(36, HEADER); u32(40, 0x12345678); u32(44, 0); u32(48, 0); u32(52, mapOff);
  u32(56, stringList.length); u32(60, stringList.length ? stringIdsOff : 0); u32(64, typeList.length); u32(68, typeList.length ? typeIdsOff : 0);
  u32(72, protoList.length); u32(76, protoList.length ? protoIdsOff : 0); u32(80, fieldList.length); u32(84, fieldList.length ? fieldIdsOff : 0);
  u32(88, methodList.length); u32(92, methodList.length ? methodIdsOff : 0); u32(96, 0); u32(100, 0); u32(104, fileSize - dataOff); u32(108, dataOff);
  stringOffsets.forEach((off, i) => u32(stringIdsOff + 4 * i, off));
  typeList.forEach((t, i) => u32(typeIdsOff + 4 * i, stringIndex.get(t)));
  protoList.forEach(([key, proto], i) => { const p = protoIdsOff + 12 * i; u32(p, stringIndex.get(proto.shorty)); u32(p + 4, typeIndex.get(proto.result)); u32(p + 8, typeListOffsets.get(key) ?? 0); });
  fieldList.forEach(([, f], i) => { const p = fieldIdsOff + 8 * i; u16(p, typeIndex.get(f.owner)); u16(p + 2, typeIndex.get(f.type)); u32(p + 4, stringIndex.get(f.name)); });
  methodList.forEach(([, m], i) => { const p = methodIdsOff + 8 * i; u16(p, typeIndex.get(m.owner)); u16(p + 2, protoIndex.get(m.proto)); u32(p + 4, stringIndex.get(m.name)); });
  u16(codeOff, registers); u16(codeOff + 2, ins); u16(codeOff + 4, outs); u16(codeOff + 6, tries.length); u32(codeOff + 8, 0); u32(codeOff + 12, units.length);
  for (let i = 0; i < units.length; i++) u16(codeOff + 16 + 2 * i, units[i]);
  let p = codeOff + 16 + insnsBytes + pad;
  for (let i = 0; i < tries.length; i++) { u32(p, triesBytes[3 * i]); u16(p + 4, triesBytes[3 * i + 1]); u16(p + 6, triesBytes[3 * i + 2]); p += 8; }
  bytes.set(handlerBytes, p);
  for (const [key, proto] of protoList) { const off = typeListOffsets.get(key); if (off === undefined) continue; u32(off, proto.parameters.length); proto.parameters.forEach((t, i) => u16(off + 4 + 2 * i, typeIndex.get(t))); }
  stringData.forEach((data, i) => bytes.set(data, stringOffsets[i]));
  u32(mapOff, mapItems.length); mapItems.forEach(([type, size, offset], i) => { const q = mapOff + 4 + 12 * i; u16(q, type); u16(q + 2, 0); u32(q + 4, size); u32(q + 8, offset); });
  u32(8, adler32(bytes, 12));
  return { bytes, selfMethodIndex: methodIndex.get(selfKey), codeOffset: codeOff + 16, triesCount: tries.length };
}
function compareLists(a, b) { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
