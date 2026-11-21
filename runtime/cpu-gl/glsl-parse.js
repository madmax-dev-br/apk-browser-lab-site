// The front end of the lab's GLSL ES compiler (docs/OPENGL-ES-ON-CPU.md): the preprocessor of The OpenGL ES Shading Language 1.00 (section 3.4) and 3.00 (section 3.4), its lexer
// and a recursive-descent parser of the grammar of both versions (1.00 section 9 / 3.00 section 9) into a plain AST. Errors are thrown as GlslError with the line, and become the
// shader's info log ("ERROR: 0:<line>: <message>"), as a driver's compiler reports them. No process.*.

export class GlslError extends Error { constructor(message, line = 0) { super(message); this.name = 'GlslError'; this.line = line; } }
const fail = (message, line) => { throw new GlslError(message, line); };

// ---- lexer --------------------------------------------------------------------------------------------------------------------------------------------------------------------
const PUNCT = ['<<=', '>>=', '...', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '^^', '+=', '-=', '*=', '/=', '%=', '&=', '^=', '|=', '##',
  '(', ')', '[', ']', '{', '}', '.', ',', ':', '=', ';', '!', '-', '~', '+', '*', '/', '%', '<', '>', '|', '^', '&', '?', '#'];
/** The pp-tokens of one line: { t: 'id' | 'num' | 'op', v, line, space (whitespace before it) }. */
function lexLine(text, line) {
  const out = []; let i = 0, space = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { i++; space = true; continue; }
    if (/[A-Za-z_]/.test(ch)) { let j = i + 1; while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++; out.push({ t: 'id', v: text.slice(i, j), line, space }); i = j; space = false; continue; }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      let j = i;
      if (ch === '0' && /[xX]/.test(text[i + 1] ?? '')) { j = i + 2; while (j < text.length && /[0-9A-Fa-f]/.test(text[j])) j++; }
      else {
        while (j < text.length && /[0-9]/.test(text[j])) j++;
        if (text[j] === '.') { j++; while (j < text.length && /[0-9]/.test(text[j])) j++; }
        if (/[eE]/.test(text[j] ?? '')) { let k = j + 1; if (/[+-]/.test(text[k] ?? '')) k++; if (/[0-9]/.test(text[k] ?? '')) { j = k; while (j < text.length && /[0-9]/.test(text[j])) j++; } }
      }
      while (j < text.length && /[uUfF]/.test(text[j])) j++;
      if (j < text.length && /[A-Za-z_0-9]/.test(text[j])) { let k = j; while (k < text.length && /[A-Za-z_0-9.]/.test(text[k])) k++; fail(`'${text.slice(i, k)}' : invalid number`, line); }
      out.push({ t: 'num', v: text.slice(i, j), line, space }); i = j; space = false; continue;
    }
    const p = PUNCT.find(op => text.startsWith(op, i));
    if (!p) fail(`'${ch}' : invalid character`, line);
    out.push({ t: 'op', v: p, line, space }); i += p.length; space = false;
  }
  return out;
}
/** Comments become spaces (newlines kept, so lines keep their numbers); a backslash before a newline joins the lines (ES 3.00 3.2), counted as the first line. */
function stripComments(source) {
  let out = '', i = 0;
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; out += ' '; continue; }
    if (source[i] === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); const body = end < 0 ? source.slice(i) : source.slice(i, end + 2); out += ' ' + body.replace(/[^\n]/g, ''); i += body.length; if (end < 0) break; continue; }
    out += source[i++];
  }
  return out;
}

// ---- preprocessor -------------------------------------------------------------------------------------------------------------------------------------------------------------
/** Extensions the lab's compiler implements, by shading-language version (their macros are defined; #extension for any other with "require" is an error). */
export const GLSL_EXTENSIONS = { 100: ['GL_OES_standard_derivatives', 'GL_EXT_shader_texture_lod', 'GL_EXT_frag_depth', 'GL_EXT_draw_buffers'], 300: [] };
/**
 * Runs the preprocessor: returns { version (100 | 300), tokens (language tokens, each with its line), extensions (name -> behavior), pragmas }.
 * `defines`: extra macros (name -> replacement text).
 */
export function preprocess(source, { defines = {} } = {}) {
  const lines = stripComments(String(source)).replace(/\\\r?\n/g, ' ').split('\n');
  let version = 100, sawCode = false;
  const macros = new Map(), extensions = new Map(), pragmas = [], tokens = [];
  const define = (name, body, params = null, line = 0) => {
    if (/^GL_/.test(name) || name.includes('__')) fail(`'${name}' : macro names containing "__" or starting with "GL_" are reserved`, line);
    macros.set(name, { body, params });
  };
  const builtin = (name, value) => macros.set(name, { body: [{ t: 'num', v: String(value), line: 0 }], params: null });
  // the version first: it decides the predefined macros
  for (let n = 0; n < lines.length; n++) {
    const text = lines[n].trim(); if (!text) continue;
    const m = /^#\s*version\s+(\d+)(?:\s+(\w+))?\s*$/.exec(text);
    if (m) { version = Number(m[1]); if (version === 300 && m[2] !== 'es') fail(`'${m[2] ?? ''}' : #version 300 needs "es"`, n + 1); if (version !== 100 && version !== 300) fail(`'${version}' : version number not supported`, n + 1); lines[n] = ''; }
    break;
  }
  builtin('GL_ES', 1); builtin('__VERSION__', version); builtin('GL_FRAGMENT_PRECISION_HIGH', 1);
  for (const name of GLSL_EXTENSIONS[version] ?? []) builtin(name, 1);
  for (const [name, text] of Object.entries(defines)) macros.set(name, { body: lexLine(String(text), 0), params: null });

  const stack = [];   // { active, taken, sawElse } per open #if
  const active = () => stack.every(s => s.active);
  let pending = [];   // text tokens not yet expanded (a function-like macro call may span lines)
  const flush = () => { if (pending.length) { for (const token of expand(pending, new Set(), macros)) tokens.push(token); pending = []; } };
  for (let n = 0; n < lines.length; n++) {
    const line = n + 1, raw = lines[n], trimmed = raw.trim();
    if (trimmed.startsWith('#')) {
      flush();
      const parts = lexLine(trimmed.slice(1), line), directive = parts[0]?.v ?? '', rest = parts.slice(1);
      if (['if', 'ifdef', 'ifndef'].includes(directive)) {
        const parentActive = active(); let value = false;
        if (parentActive) {
          if (directive === 'if') value = evalCondition(rest, macros, line) !== 0;
          else { if (rest[0]?.t !== 'id') fail(`'#${directive}' : expected a macro name`, line); value = macros.has(rest[0].v) === (directive === 'ifdef'); }
        }
        stack.push({ active: parentActive && value, taken: value, parentActive, sawElse: false }); continue;
      }
      if (directive === 'elif') {
        const top = stack.at(-1); if (!top || top.sawElse) fail("'#elif' : unexpected", line);
        if (top.taken || !top.parentActive) top.active = false; else { const value = evalCondition(rest, macros, line) !== 0; top.active = value; top.taken = value; }
        continue;
      }
      if (directive === 'else') { const top = stack.at(-1); if (!top || top.sawElse) fail("'#else' : unexpected", line); top.sawElse = true; top.active = top.parentActive && !top.taken; top.taken = true; continue; }
      if (directive === 'endif') { if (!stack.length) fail("'#endif' : unexpected", line); stack.pop(); continue; }
      if (!active()) continue;
      if (directive === '') continue;   // the null directive
      if (directive === 'define') {
        const name = rest[0]; if (name?.t !== 'id') fail("'#define' : expected a macro name", line);
        let body = rest.slice(1), params = null;
        if (body[0]?.v === '(' && !body[0].space) {
          params = []; let i = 1;
          if (body[i]?.v !== ')') for (;;) { const p = body[i]; if (p?.t !== 'id') fail(`'${name.v}' : bad macro parameter list`, line); params.push(p.v); i++; if (body[i]?.v === ',') { i++; continue; } if (body[i]?.v === ')') break; fail(`'${name.v}' : bad macro parameter list`, line); }
          body = body.slice(i + 1);
        }
        const previous = macros.get(name.v);
        if (previous && JSON.stringify(previous.body.map(t => t.v)) !== JSON.stringify(body.map(t => t.v))) { if (['GL_ES', '__VERSION__', '__LINE__', '__FILE__'].includes(name.v)) fail(`'${name.v}' : predefined macro redefined`, line); }
        define(name.v, body, params, line); continue;
      }
      if (directive === 'undef') { const name = rest[0]; if (name?.t !== 'id') fail("'#undef' : expected a macro name", line); if (['GL_ES', '__VERSION__', '__LINE__', '__FILE__'].includes(name.v)) fail(`'${name.v}' : predefined macro cannot be undefined`, line); macros.delete(name.v); continue; }
      if (directive === 'error') fail(`'#error' : ${rest.map(t => t.v).join(' ')}`, line);
      if (directive === 'pragma') { pragmas.push(rest.map(t => t.v).join(' ')); continue; }
      if (directive === 'extension') {
        const [name, colon, behavior] = rest; if (name?.t !== 'id' || colon?.v !== ':' || behavior?.t !== 'id') fail("'#extension' : syntax error", line);
        if (!['require', 'enable', 'warn', 'disable'].includes(behavior.v)) fail(`'${behavior.v}' : behavior not supported`, line);
        const known = name.v === 'all' || (GLSL_EXTENSIONS[version] ?? []).includes(name.v);
        if (name.v === 'all' && (behavior.v === 'require' || behavior.v === 'enable')) fail("'all' : extension 'all' can only be warn or disable", line);
        if (!known && behavior.v === 'require') fail(`'${name.v}' : extension is not supported`, line);
        if (sawCode && version === 300) { /* ES 3.00 allows it only before code; drivers warn */ }
        extensions.set(name.v, behavior.v); continue;
      }
      if (directive === 'version') fail("'#version' : must occur first in the shader", line);
      if (directive === 'line') continue;
      fail(`'#${directive}' : invalid directive`, line);
    }
    if (!active()) continue;
    const lexed = lexLine(raw, line); if (lexed.length) sawCode = true;
    for (const token of lexed) { if (token.t === 'id' && token.v === '__LINE__') pending.push({ t: 'num', v: String(line), line }); else if (token.t === 'id' && token.v === '__FILE__') pending.push({ t: 'num', v: '0', line }); else pending.push(token); }
  }
  flush();
  if (stack.length) fail("'#if' : unterminated conditional", lines.length);
  return { version, tokens: tokens.map(classify), extensions, pragmas };
}
/** Expands macros in a token list (C 6.10.3, without # and ##: GLSL ES has neither stringizing nor pasting... ES 3.00 reserves ##). */
function expand(list, hidden, macros) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    if (token.t !== 'id' || hidden.has(token.v) || token.noExpand || !macros.has(token.v)) { out.push(token); continue; }
    const macro = macros.get(token.v);
    if (!macro.params) { const inner = new Set(hidden).add(token.v); for (const t of expand(macro.body.map(b => ({ ...b, line: token.line })), inner, macros)) out.push(t); continue; }
    if (list[i + 1]?.v !== '(') { out.push(token); continue; }
    // arguments
    const args = [[]]; let depth = 0, j = i + 2;
    for (; j < list.length; j++) {
      const t = list[j];
      if (t.v === '(') depth++; else if (t.v === ')') { if (depth === 0) break; depth--; } else if (t.v === ',' && depth === 0) { args.push([]); continue; }
      args.at(-1).push(t);
    }
    if (j >= list.length) fail(`'${token.v}' : unterminated macro invocation`, token.line);
    if (macro.params.length === 0 && args.length === 1 && args[0].length === 0) args.length = 0;
    if (args.length !== macro.params.length) fail(`'${token.v}' : wrong number of macro arguments`, token.line);
    const expandedArgs = args.map(a => expand(a, hidden, macros)), body = [];
    for (const b of macro.body) { const at = b.t === 'id' ? macro.params.indexOf(b.v) : -1; if (at >= 0) body.push(...expandedArgs[at]); else body.push({ ...b, line: token.line }); }
    const inner = new Set(hidden).add(token.v);
    for (const t of expand(body, inner, macros)) out.push(t);
    i = j;
  }
  return out;
}
/** #if / #elif: `defined`, then macro expansion, then a C integer constant expression. */
function evalCondition(tokens, macros, line) {
  const resolved = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].t === 'id' && tokens[i].v === 'defined') {
      let name = tokens[i + 1], skip = 1;
      if (name?.v === '(') { name = tokens[i + 2]; if (tokens[i + 3]?.v !== ')') fail("'defined' : missing ')'", line); skip = 3; }
      if (name?.t !== 'id') fail("'defined' : expected a macro name", line);
      resolved.push({ t: 'num', v: macros.has(name.v) ? '1' : '0', line }); i += skip; continue;
    }
    resolved.push(tokens[i]);
  }
  const list = expand(resolved, new Set(), macros); let at = 0;
  const peek = () => list[at]?.v, next = () => list[at++];
  const primary = () => {
    const t = next(); if (!t) fail("'#if' : unexpected end of expression", line);
    if (t.v === '(') { const v = ternary(); if (next()?.v !== ')') fail("'#if' : missing ')'", line); return v; }
    if (t.v === '-') return -unary(); if (t.v === '+') return unary(); if (t.v === '!') return unary() ? 0 : 1; if (t.v === '~') return ~unary();
    if (t.t === 'num') { const s = t.v.replace(/[uU]$/, ''); if (/[.eEfF]/.test(s) && !/^0[xX]/.test(s)) fail("'#if' : floating-point in a preprocessor expression", line); return /^0[xX]/.test(s) ? parseInt(s, 16) : /^0[0-7]+$/.test(s) ? parseInt(s, 8) : parseInt(s, 10); }
    if (t.t === 'id') fail(`'${t.v}' : undefined identifier in a preprocessor expression`, line);
    fail(`'${t.v}' : syntax error in a preprocessor expression`, line);
  };
  const unary = () => primary();
  const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  const binary = level => {
    if (level === LEVELS.length) return unary();
    let left = binary(level + 1);
    while (LEVELS[level].includes(peek())) {
      const op = next().v;
      if (op === '||' || op === '&&') { const right = binary(level + 1); left = op === '||' ? (left || right ? 1 : 0) : (left && right ? 1 : 0); continue; }
      const right = binary(level + 1);
      switch (op) {
        case '|': left |= right; break; case '^': left ^= right; break; case '&': left &= right; break; case '==': left = left === right ? 1 : 0; break; case '!=': left = left !== right ? 1 : 0; break;
        case '<': left = left < right ? 1 : 0; break; case '>': left = left > right ? 1 : 0; break; case '<=': left = left <= right ? 1 : 0; break; case '>=': left = left >= right ? 1 : 0; break;
        case '<<': left <<= right; break; case '>>': left >>= right; break; case '+': left = (left + right) | 0; break; case '-': left = (left - right) | 0; break; case '*': left = Math.imul(left, right); break;
        case '/': if (!right) fail("'#if' : division by zero", line); left = (left / right) | 0; break; case '%': if (!right) fail("'#if' : division by zero", line); left %= right; break;
      }
    }
    return left;
  };
  const ternary = () => { const c = binary(0); if (peek() === '?') { next(); const a = ternary(); if (next()?.v !== ':') fail("'#if' : missing ':'", line); const b = ternary(); return c ? a : b; } return c; };
  if (!list.length) fail("'#if' : missing expression", line);
  const value = ternary(); if (at < list.length) fail(`'${list[at].v}' : unexpected token in a preprocessor expression`, line);
  return value;
}

// ---- language tokens ----------------------------------------------------------------------------------------------------------------------------------------------------------
export const BASIC_TYPES = new Set(['void', 'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'bvec2', 'bvec3', 'bvec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
  'mat2', 'mat3', 'mat4', 'mat2x2', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4',
  'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DShadow', 'samplerCubeShadow', 'sampler2DArray', 'sampler2DArrayShadow', 'isampler2D', 'isampler3D', 'isamplerCube', 'isampler2DArray',
  'usampler2D', 'usampler3D', 'usamplerCube', 'usampler2DArray', 'samplerExternalOES']);
const TYPES_100 = new Set(['void', 'bool', 'int', 'float', 'vec2', 'vec3', 'vec4', 'bvec2', 'bvec3', 'bvec4', 'ivec2', 'ivec3', 'ivec4', 'mat2', 'mat3', 'mat4', 'sampler2D', 'samplerCube', 'samplerExternalOES']);
const KEYWORDS_100 = new Set(['attribute', 'const', 'uniform', 'varying', 'break', 'continue', 'do', 'for', 'while', 'if', 'else', 'in', 'out', 'inout', 'true', 'false', 'lowp', 'mediump', 'highp', 'precision', 'invariant', 'discard', 'return', 'struct']);
const KEYWORDS_300 = new Set([...KEYWORDS_100, 'layout', 'centroid', 'flat', 'smooth', 'switch', 'case', 'default']);
const RESERVED_100 = new Set(['asm', 'class', 'union', 'enum', 'typedef', 'template', 'this', 'packed', 'goto', 'switch', 'default', 'inline', 'noinline', 'volatile', 'public', 'static', 'extern', 'external', 'interface', 'flat', 'long', 'short', 'double', 'half', 'fixed', 'unsigned', 'superp', 'input', 'output', 'hvec2', 'hvec3', 'hvec4', 'dvec2', 'dvec3', 'dvec4', 'fvec2', 'fvec3', 'fvec4', 'sampler1D', 'sampler3D', 'sampler1DShadow', 'sampler2DShadow', 'sampler2DRect', 'sampler3DRect', 'sampler2DRectShadow', 'sizeof', 'cast', 'namespace', 'using']);
const RESERVED_300 = new Set(['attribute', 'varying', 'coherent', 'volatile', 'restrict', 'readonly', 'writeonly', 'resource', 'atomic_uint', 'noperspective', 'patch', 'sample', 'subroutine', 'common', 'partition', 'active', 'asm', 'class', 'union', 'enum', 'typedef', 'template', 'this', 'goto', 'inline', 'noinline', 'public', 'static', 'extern', 'external', 'interface', 'long', 'short', 'double', 'half', 'fixed', 'unsigned', 'superp', 'input', 'output', 'hvec2', 'hvec3', 'hvec4', 'dvec2', 'dvec3', 'dvec4', 'fvec2', 'fvec3', 'fvec4', 'sampler3DRect', 'filter', 'image1D', 'image2D', 'image3D', 'imageCube', 'iimage1D', 'iimage2D', 'iimage3D', 'iimageCube', 'uimage1D', 'uimage2D', 'uimage3D', 'uimageCube', 'image1DArray', 'image2DArray', 'iimage1DArray', 'iimage2DArray', 'uimage1DArray', 'uimage2DArray', 'imageBuffer', 'iimageBuffer', 'uimageBuffer', 'sampler1D', 'sampler1DShadow', 'sampler1DArray', 'sampler1DArrayShadow', 'isampler1D', 'isampler1DArray', 'usampler1D', 'usampler1DArray', 'sampler2DRect', 'sampler2DRectShadow', 'isampler2DRect', 'usampler2DRect', 'samplerBuffer', 'isamplerBuffer', 'usamplerBuffer', 'sampler2DMS', 'isampler2DMS', 'usampler2DMS', 'sampler2DMSArray', 'isampler2DMSArray', 'usampler2DMSArray', 'sizeof', 'cast', 'namespace', 'using']);
function classify(token) {
  if (token.t === 'num') {
    const s = token.v, line = token.line;
    if (/^0[xX]/.test(s) || (/^[0-9]+[uU]?$/.test(s))) {
      const unsigned = /[uU]$/.test(s), digits = s.replace(/[uU]$/, '');
      const value = /^0[xX]/.test(digits) ? parseInt(digits.slice(2), 16) : /^0[0-7]*$/.test(digits) && digits.length > 1 ? parseInt(digits, 8) : /^0\d/.test(digits) ? fail(`'${s}' : invalid octal number`, line) : Number(digits);
      if (!Number.isFinite(value)) fail(`'${s}' : invalid integer`, line);
      return { t: unsigned ? 'uintconst' : 'intconst', v: value, text: s, line };
    }
    if (/[uU]/.test(s)) fail(`'${s}' : invalid number`, line);
    return { t: 'floatconst', v: Number(s.replace(/[fF]$/, '')), text: s, line };
  }
  return token;
}

// ---- parser -------------------------------------------------------------------------------------------------------------------------------------------------------------------
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);
const BINARY = [['||'], ['^^'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
/** Parses preprocessed tokens: { version, decls } with the AST nodes described in docs/OPENGL-ES-ON-CPU.md. */
export function parse({ version, tokens }) {
  let at = 0;
  const keywords = version === 300 ? KEYWORDS_300 : KEYWORDS_100, reserved = version === 300 ? RESERVED_300 : RESERVED_100, typeNames = version === 300 ? BASIC_TYPES : TYPES_100;
  const structs = [new Set()];   // struct type names in scope
  const peek = (k = 0) => tokens[at + k], lineOf = () => (tokens[at] ?? tokens[at - 1])?.line ?? 0;
  const is = (v, k = 0) => { const t = tokens[at + k]; return !!t && (t.t === 'op' || t.t === 'id') && t.v === v; };
  const accept = v => { if (is(v)) { at++; return true; } return false; };
  const expect = (v, what = v) => { if (!accept(v)) { const t = peek(); fail(`'${t ? t.text ?? t.v : 'end of shader'}' : syntax error, expected ${what}`, lineOf()); } };
  const isStructName = name => structs.some(s => s.has(name));
  const isTypeName = t => !!t && t.t === 'id' && (typeNames.has(t.v) || isStructName(t.v));
  const identifier = () => {
    const t = peek(); if (!t || t.t !== 'id') fail(`'${t ? t.text ?? t.v : 'end of shader'}' : syntax error, expected an identifier`, lineOf());
    if (keywords.has(t.v) || typeNames.has(t.v)) fail(`'${t.v}' : syntax error, a keyword is not an identifier`, t.line);
    if (reserved.has(t.v)) fail(`'${t.v}' : reserved keyword`, t.line);
    if (t.v.startsWith('gl_')) { /* gl_ names: redeclaration checks happen in the checker */ }
    if (t.v.includes('__')) { /* reserved for future use; drivers accept it */ }
    at++; return t.v;
  };
  const node = (kind, props) => ({ kind, line: props.line ?? lineOf(), ...props });

  // types and qualifiers
  const PRECISIONS = new Set(['lowp', 'mediump', 'highp']);
  function layoutQualifier() {
    const layout = {}; expect('(');
    for (;;) { const name = identifier(); if (accept('=')) { const t = peek(); if (t?.t !== 'intconst' && t?.t !== 'uintconst') fail(`'${name}' : layout value must be an integer`, lineOf()); layout[name] = t.v; at++; } else layout[name] = true; if (accept(',')) continue; expect(')'); break; }
    return layout;
  }
  function qualifiers() {
    const q = { storage: null, interp: null, invariant: false, centroid: false, precision: null, layout: null, line: lineOf() };
    for (;;) {
      const t = peek(); if (!t || t.t !== 'id') break;
      if (t.v === 'layout' && version === 300) { at++; q.layout = { ...(q.layout ?? {}), ...layoutQualifier() }; continue; }
      if (['const', 'uniform', 'attribute', 'varying'].includes(t.v) || (t.v === 'in' || t.v === 'out' || t.v === 'inout')) {
        if (t.v === 'attribute' && version === 300 || t.v === 'varying' && version === 300) fail(`'${t.v}' : reserved in GLSL ES 3.00`, t.line);
        if (q.storage) fail(`'${t.v}' : too many storage qualifiers`, t.line);
        q.storage = t.v; at++; continue;
      }
      if (t.v === 'invariant') { q.invariant = true; at++; continue; }
      if (version === 300 && (t.v === 'flat' || t.v === 'smooth')) { q.interp = t.v; at++; continue; }
      if (version === 300 && t.v === 'centroid') { q.centroid = true; at++; continue; }
      if (PRECISIONS.has(t.v)) { q.precision = t.v; at++; continue; }
      break;
    }
    return q;
  }
  /** A type specifier: a basic type, a struct name, or a struct definition; ES 3.00 allows array brackets after it. */
  function typeSpecifier(precision = null) {
    const line = lineOf(); let spec;
    if (accept('struct')) {
      const name = peek()?.t === 'id' && !is('{') ? identifier() : null; expect('{');
      const fields = [];
      structs.push(new Set());
      while (!accept('}')) {
        const fq = qualifiers(); if (fq.storage || fq.invariant || fq.interp || fq.layout) fail("'struct' : qualifiers not allowed on struct members", lineOf());
        const ft = typeSpecifier(fq.precision);
        if (ft.struct && ft.struct.inline) { /* nested struct definition */ }
        do { const fname = identifier(); const array = arraySuffix(); fields.push({ name: fname, type: ft, array, line: lineOf() }); } while (accept(','));
        expect(';');
      }
      structs.pop();
      if (!fields.length) fail("'struct' : a struct must have at least one member", line);
      if (name) structs.at(-1).add(name);
      spec = { name: name ?? `__anon${line}_${at}`, struct: { name, fields, line }, precision, line };
    } else {
      const t = peek(); if (!isTypeName(t)) fail(`'${t ? t.text ?? t.v : 'end of shader'}' : syntax error, expected a type`, line);
      at++; spec = { name: t.v, precision, line };
    }
    if (version === 300 && is('[')) spec.array = arraySuffix();
    return spec;
  }
  function arraySuffix() {
    if (!accept('[')) return null;
    if (accept(']')) { if (is('[')) fail("'[' : arrays of arrays are not allowed", lineOf()); return { size: null }; }
    const size = expression(); expect(']');
    if (is('[')) fail("'[' : arrays of arrays are not allowed in GLSL ES", lineOf());
    return { size };
  }

  // expressions
  function primary() {
    const t = peek(), line = lineOf();
    if (!t) fail("'end of shader' : syntax error", line);
    if (t.t === 'intconst' || t.t === 'uintconst' || t.t === 'floatconst') { at++; if (t.t === 'uintconst' && version !== 300) fail(`'${t.text}' : unsigned integers need GLSL ES 3.00`, line); return node('Num', { type: t.t === 'intconst' ? 'int' : t.t === 'uintconst' ? 'uint' : 'float', value: t.v, line }); }
    if (t.v === 'true' || t.v === 'false') { at++; return node('Num', { type: 'bool', value: t.v === 'true' ? 1 : 0, line }); }
    if (accept('(')) { const e = expression(); expect(')'); return e; }
    if (isTypeName(t) && (is('(', 1) || (version === 300 && is('[', 1)))) {   // a constructor
      const type = typeSpecifier();
      expect('('); const args = [];
      if (!accept(')')) { do args.push(assignment()); while (accept(',')); expect(')'); }
      return node('Call', { ctor: type, args, line });
    }
    if (t.t === 'id') {
      if (keywords.has(t.v) && !['true', 'false'].includes(t.v)) fail(`'${t.v}' : syntax error`, line);
      const name = identifier();
      if (accept('(')) {
        const args = [];
        if (accept('void')) { expect(')'); } else if (!accept(')')) { do args.push(assignment()); while (accept(',')); expect(')'); }
        return node('Call', { name, args, line });
      }
      return node('Ident', { name, line });
    }
    fail(`'${t.text ?? t.v}' : syntax error`, line);
  }
  function postfix() {
    let e = primary();
    for (;;) {
      const line = lineOf();
      if (accept('[')) { const index = expression(); expect(']'); e = node('Index', { e, index, line }); continue; }
      if (accept('.')) {
        const t = peek(); if (!t || t.t !== 'id') fail("'.' : syntax error, expected a field name", line); at++;
        if (t.v === 'length' && accept('(')) { expect(')'); e = node('Length', { e, line }); continue; }
        e = node('Field', { e, name: t.v, line }); continue;
      }
      if (is('++') || is('--')) { const op = peek().v; at++; e = node('Postfix', { op, e, line }); continue; }
      return e;
    }
  }
  function unary() {
    const line = lineOf();
    for (const op of ['++', '--']) if (accept(op)) return node('Prefix', { op, e: unary(), line });
    for (const op of ['+', '-', '!', '~']) if (accept(op)) { if (op === '~' && version !== 300) fail("'~' : reserved in GLSL ES 1.00", line); return node('Unary', { op, e: unary(), line }); }
    return postfix();
  }
  function binary(level) {
    if (level === BINARY.length) return unary();
    let l = binary(level + 1);
    for (;;) {
      const t = peek(); if (!t || t.t !== 'op' || !BINARY[level].includes(t.v)) return l;
      if (version !== 300 && ['%', '<<', '>>', '&', '|', '^'].includes(t.v)) fail(`'${t.v}' : reserved in GLSL ES 1.00`, t.line);
      at++; l = node('Binary', { op: t.v, l, r: binary(level + 1), line: t.line });
    }
  }
  function conditional() {
    const c = binary(0); const line = lineOf();
    if (accept('?')) { const a = expression(); expect(':'); const b = assignment(); return node('Ternary', { c, a, b, line }); }
    return c;
  }
  function assignment() {
    const start = at, l = conditional(), t = peek();
    if (t && t.t === 'op' && ASSIGN.has(t.v)) {
      if (version !== 300 && ['%=', '<<=', '>>=', '&=', '^=', '|='].includes(t.v)) fail(`'${t.v}' : reserved in GLSL ES 1.00`, t.line);
      at++; return node('Assign', { op: t.v, l, r: assignment(), line: t.line });
    }
    void start; return l;
  }
  function expression() { let e = assignment(); while (is(',')) { const line = lineOf(); at++; e = node('Comma', { l: e, r: assignment(), line }); } return e; }

  // declarations
  function initDeclarators(q, type, first, line) {
    const vars = [];
    let name = first;
    for (;;) {
      const array = arraySuffix(); let init = null;
      if (accept('=')) init = assignment();
      vars.push({ name, array, init, line });
      if (!accept(',')) break;
      name = identifier();
    }
    return node('VarDecl', { q, type, vars, line });
  }
  /** A declaration after its qualifiers: struct-only, block, function, precision, or variables. Returns a node; `top` for external declarations. */
  function declaration(top) {
    const line = lineOf();
    if (accept('precision')) {
      const p = peek(); if (!p || !PRECISIONS.has(p.v)) fail("'precision' : expected a precision qualifier", line); at++;
      const type = typeSpecifier(); expect(';'); return node('Precision', { precision: p.v, type, line });
    }
    const q = qualifiers();
    // `invariant gl_Position;` / `invariant varName;`
    if (q.invariant && peek()?.t === 'id' && !isTypeName(peek()) && (is(';', 1) || is(',', 1))) { const names = [identifier()]; while (accept(',')) names.push(identifier()); expect(';'); return node('Invariant', { names, line }); }
    // `layout(std140) uniform;` default layouts
    if (q.layout && q.storage && is(';')) { at++; return node('DefaultLayout', { q, line }); }
    // ES 3.00 interface (uniform) blocks: `uniform Name { ... } instance;`
    if (version === 300 && q.storage === 'uniform' && peek()?.t === 'id' && !isTypeName(peek()) && is('{', 1)) {
      const blockName = identifier(); expect('{'); const members = [];
      while (!accept('}')) {
        const mq = qualifiers(); const mt = typeSpecifier(mq.precision);
        do { const name = identifier(); members.push({ name, type: mt, array: arraySuffix(), layout: mq.layout, line: lineOf() }); } while (accept(','));
        expect(';');
      }
      let instance = null, array = null;
      if (peek()?.t === 'id') { instance = identifier(); array = arraySuffix(); }
      expect(';'); return node('Block', { q, blockName, members, instance, array, line });
    }
    const type = typeSpecifier(q.precision);
    if (accept(';')) return node('VarDecl', { q, type, vars: [], line });   // a struct definition alone (or `float;`)
    const name = identifier();
    if (is('(')) {
      if (!top) fail(`'${name}' : function definitions are not allowed here`, line);
      at++; const params = [];
      if (accept('void') && is(')')) { /* (void) */ } else if (is('void')) { /* void as a type below */ }
      if (!accept(')')) {
        for (;;) {
          const pq = qualifiers(); const pt = typeSpecifier(pq.precision);
          let pname = null, parray = null; if (peek()?.t === 'id' && !is(',', 0)) { pname = identifier(); parray = arraySuffix(); }
          if (pt.name === 'void' && !pname && params.length === 0) { /* f(void) */ } else params.push({ name: pname, type: pt, array: parray, q: pq, line: lineOf() });
          if (accept(',')) continue; expect(')'); break;
        }
      }
      if (accept(';')) return node('Function', { name, ret: type, q, params, body: null, line });
      if (!is('{')) fail(`'${name}' : syntax error, expected a function body`, lineOf());
      structs.push(new Set()); const body = compound(); structs.pop();
      return node('Function', { name, ret: type, q, params, body, line });
    }
    const decl = initDeclarators(q, type, name, line); expect(';'); return decl;
  }
  const startsDeclaration = () => {
    const t = peek(); if (!t || t.t !== 'id') return false;
    if (['const', 'uniform', 'attribute', 'varying', 'in', 'out', 'inout', 'invariant', 'precision', 'struct', 'lowp', 'mediump', 'highp', 'flat', 'smooth', 'centroid', 'layout'].includes(t.v)) return true;
    if (isTypeName(t)) { if (is('(', 1)) return false; if (version === 300 && is('[', 1)) { let k = 1, depth = 0; for (; peek(k); k++) { if (is('[', k)) depth++; else if (is(']', k)) { depth--; if (!depth) break; } } return peek(k + 1)?.t === 'id'; } return true; }
    return false;
  };

  // statements
  function compound() { const line = lineOf(); expect('{'); structs.push(new Set()); const stmts = []; while (!accept('}')) { if (!peek()) fail("'end of shader' : syntax error, missing '}'", lineOf()); stmts.push(statement()); } structs.pop(); return node('Compound', { stmts, line }); }
  function statement() {
    const line = lineOf(), t = peek();
    if (is('{')) return compound();
    if (accept(';')) return node('Empty', { line });
    if (t.t === 'id') switch (t.v) {
      case 'if': { at++; expect('('); const c = expression(); expect(')'); const a = scoped(); const b = accept('else') ? scoped() : null; return node('If', { c, a, b, line }); }
      case 'while': { at++; expect('('); structs.push(new Set()); const c = conditionOrDecl(); expect(')'); const body = scopedNoNew(); structs.pop(); return node('While', { c, body, line }); }
      case 'do': { at++; const body = scoped(); expect('while'); expect('('); const c = expression(); expect(')'); expect(';'); return node('DoWhile', { body, c, line }); }
      case 'for': {
        at++; expect('('); structs.push(new Set());
        const init = accept(';') ? null : startsDeclaration() ? declaration(false) : (() => { const e = expression(); expect(';'); return node('Expr', { e, line }); })();
        const c = is(';') ? null : conditionOrDecl(); expect(';');
        const inc = is(')') ? null : expression(); expect(')');
        const body = scopedNoNew(); structs.pop();
        return node('For', { init, c, inc, body, line });
      }
      case 'switch': if (version !== 300) break; { at++; expect('('); const e = expression(); expect(')'); const body = compound(); return node('Switch', { e, body, line }); }
      case 'case': if (version !== 300) break; { at++; const e = expression(); expect(':'); return node('Case', { e, line }); }
      case 'default': if (version !== 300) break; { at++; expect(':'); return node('Default', { line }); }
      case 'break': at++; expect(';'); return node('Break', { line });
      case 'continue': at++; expect(';'); return node('Continue', { line });
      case 'discard': at++; expect(';'); return node('Discard', { line });
      case 'return': { at++; if (accept(';')) return node('Return', { e: null, line }); const e = expression(); expect(';'); return node('Return', { e, line }); }
    }
    if (startsDeclaration()) return node('DeclStmt', { decl: declaration(false), line });
    const e = expression(); expect(';'); return node('Expr', { e, line });
  }
  function scoped() { if (is('{')) return compound(); structs.push(new Set()); const s = statement(); structs.pop(); return s; }
  function scopedNoNew() { if (is('{')) { const line = lineOf(); expect('{'); const stmts = []; while (!accept('}')) { if (!peek()) fail("'end of shader' : syntax error", lineOf()); stmts.push(statement()); } return node('Compound', { stmts, line, sameScope: true }); } return statement(); }
  /** A loop condition: an expression or `type name = init` (1.00 / 3.00 condition grammar). */
  function conditionOrDecl() {
    if (startsDeclaration()) { const line = lineOf(); const q = qualifiers(); const type = typeSpecifier(q.precision); const name = identifier(); expect('='); const init = assignment(); return node('CondDecl', { q, type, name, init, line }); }
    return expression();
  }

  const decls = [];
  while (at < tokens.length) { if (accept(';')) continue; decls.push(declaration(true)); }
  return { version, decls };
}
