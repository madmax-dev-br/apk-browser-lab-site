// JavaScript for the plugin code editor (src/code-editor.js, src/plugins-panel.js): a tokenizer for highlighting that carries its state from line to line (block comments and
// template literals span lines), the brackets of a text (matching and the unbalanced ones, with their positions), and a syntax check that compiles the code the way the plugin
// runtime does (src/plugin-runtime.js: new AsyncFunction('lab', code)) without running it. The engine's SyntaxError has no position in V8, so the check finds it: the first
// prefix of the code (by line, then by column) that fails with the same message is where the error is. DOM-free and no process.*: tested in Node.

export const KEYWORDS = new Set(['await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function',
  'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'async', 'get', 'set']);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'this', 'NaN', 'Infinity']);
const BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
const ID_START = /[A-Za-z_$À-￿]/, ID_PART = /[\w$À-￿]/;
const PUNCT = '{}[]();,.<>+-*/%&|^!~?:=@#';

/** The state at the start of the first line. States are small plain objects: { mode: 'code' | 'comment' | 'template', braces: [n...], prev } (copied, never shared). */
export const START_STATE = Object.freeze({ mode: 'code', braces: [], prev: '' });
const copy = state => ({ mode: state.mode, braces: state.braces.slice(), prev: state.prev });

/**
 * One line's tokens: [[start, end, kind]] with kind 'keyword' | 'literal' | 'string' | 'template' | 'number' | 'comment' | 'regex' | 'punct' | 'bracket' | 'name', and the state
 * the next line starts with. Lenient: any text tokenizes.
 */
export function tokenizeJsLine(line, state = START_STATE) {
  const s = copy(state), tokens = [], length = line.length;
  let i = 0;
  const push = (start, end, kind) => { if (end > start) tokens.push([start, end, kind]); };
  // the text of a template literal from `scan` (the token starts at `start`): up to its closing ` (back to code), a ${ (code until the matching }), or the end of the line
  const template = (start, scan) => {
    let j = scan;
    while (j < length) {
      const d = line[j];
      if (d === '\\') { j += 2; continue; }
      if (d === '`') { push(start, j + 1, 'template'); s.mode = 'code'; s.prev = 'value'; return j + 1; }
      if (d === '$' && line[j + 1] === '{') { push(start, j, 'template'); push(j, j + 2, 'punct'); s.mode = 'code'; s.braces.push(0); s.prev = 'punct'; return j + 2; }
      j++;
    }
    push(start, length, 'template'); return length;
  };
  while (i < length) {
    if (s.mode === 'comment') { const close = line.indexOf('*/', i); const end = close < 0 ? length : close + 2; push(i, end, 'comment'); i = end; if (close >= 0) s.mode = 'code'; continue; }
    if (s.mode === 'template') { i = template(i, i); continue; }
    const c = line[i], start = i;
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && line[i + 1] === '/') { push(i, length, 'comment'); i = length; break; }
    if (c === '/' && line[i + 1] === '*') { const close = line.indexOf('*/', i + 2); const end = close < 0 ? length : close + 2; push(i, end, 'comment'); i = end; if (close < 0) s.mode = 'comment'; continue; }
    if (c === '"' || c === "'") { i++; while (i < length && line[i] !== c) i += line[i] === '\\' ? 2 : 1; i = Math.min(length, i + 1); push(start, i, 'string'); s.prev = 'value'; continue; }
    if (c === '`') { s.mode = 'template'; i = template(i, i + 1); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(line[i + 1] ?? ''))) { i++; while (i < length && /[\w.]/.test(line[i])) i++; push(start, i, 'number'); s.prev = 'value'; continue; }
    if (ID_START.test(c)) {
      i++; while (i < length && ID_PART.test(line[i])) i++;
      const word = line.slice(start, i), member = s.prev === '.';
      const kind = member ? 'name' : LITERALS.has(word) ? 'literal' : KEYWORDS.has(word) ? 'keyword' : 'name';
      push(start, i, kind); s.prev = kind === 'keyword' && BEFORE_REGEX.has(word) ? 'punct' : 'value'; continue;
    }
    if (c === '/' && s.prev !== 'value') {   // a regular expression literal where a value may start
      let j = i + 1, inClass = false, ok = false;
      while (j < length) { const d = line[j]; if (d === '\\') { j += 2; continue; } if (d === '[') inClass = true; else if (d === ']') inClass = false; else if (d === '/' && !inClass) { ok = true; break; } j++; }
      if (ok) { j++; while (j < length && /[a-z]/.test(line[j])) j++; push(i, j, 'regex'); i = j; s.prev = 'value'; continue; }
    }
    if (c === '{' || c === '(' || c === '[') { if (c === '{' && s.braces.length) s.braces[s.braces.length - 1]++; push(i, i + 1, 'bracket'); i++; s.prev = 'punct'; continue; }
    if (c === '}' && s.braces.length && s.braces[s.braces.length - 1] === 0) { s.braces.pop(); push(i, i + 1, 'punct'); i++; s.mode = 'template'; continue; }   // the end of a ${ } in a template
    if (c === '}' || c === ')' || c === ']') { if (c === '}' && s.braces.length) s.braces[s.braces.length - 1]--; push(i, i + 1, 'bracket'); i++; s.prev = 'value'; continue; }
    if (PUNCT.includes(c)) { push(i, i + 1, 'punct'); i++; s.prev = c === '.' && line[i] !== '.' ? '.' : 'punct'; continue; }
    i++;   // anything else (a stray character): plain text
  }
  return { tokens, state: s };
}

/** The state at the start of every line of `text` (index 0: START_STATE): the editor tokenizes only the lines it shows, each from its own state. */
export function lineStates(text) {
  const states = [START_STATE];
  let state = START_STATE, from = 0;
  for (;;) {
    const end = text.indexOf('\n', from), line = text.slice(from, end < 0 ? text.length : end);
    if (end < 0) break;
    state = tokenizeJsLine(line, state).state; states.push(state); from = end + 1;
  }
  return states;
}

/**
 * The brackets of a JS text outside strings, comments and regular expressions: { pairs: Map(offset -> offset), errors: [{ offset, line, col, message }] } (a closer without its
 * opener, a closer of the wrong kind, an opener never closed, an unterminated comment or template).
 */
export function jsBrackets(text) {
  const pairs = new Map(), errors = [], stack = [];
  let state = START_STATE, from = 0, lineNo = 1, lastState = state;
  for (;;) {
    const end = text.indexOf('\n', from), line = text.slice(from, end < 0 ? text.length : end), result = tokenizeJsLine(line, state);
    for (const [start, , kind] of result.tokens) {
      if (kind !== 'bracket') continue;
      const ch = line[start], offset = from + start, where = { offset, line: lineNo, col: start + 1 };
      if (ch === '{' || ch === '(' || ch === '[') { stack.push({ ch, ...where }); continue; }
      const want = { '}': '{', ')': '(', ']': '[' }[ch], top = stack[stack.length - 1];
      if (!top) { errors.push({ ...where, message: `'${ch}' has no matching '${want}'` }); continue; }
      if (top.ch !== want) { errors.push({ ...where, message: `'${ch}' does not close the '${top.ch}' opened at ${top.line}:${top.col}` }); stack.pop(); continue; }
      stack.pop(); pairs.set(top.offset, offset); pairs.set(offset, top.offset);
    }
    lastState = result.state;
    if (end < 0) break;
    state = result.state; from = end + 1; lineNo++;
  }
  const eof = { offset: text.length, line: lineNo, col: text.length - from + 1 };
  if (lastState.mode === 'comment') errors.push({ ...eof, message: 'Unterminated comment: the closing */ is missing' });
  if (lastState.mode === 'template') errors.push({ ...eof, message: 'Unterminated template literal: the closing ` is missing' });
  for (const open of stack) errors.push({ offset: open.offset, line: open.line, col: open.col, message: `'${open.ch}' opened here is never closed` });
  errors.sort((a, b) => a.offset - b.offset);
  return { pairs, errors };
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
/** Compiles the plugin code as the runtime does, without calling it: null when it compiles, else the SyntaxError's message. */
export function compileError(code) { try { new AsyncFunction('lab', String(code ?? '')); return null; } catch (error) { return String(error?.message ?? error); } }

/**
 * Checks plugin code, in steps (one compile per step, so a long search never blocks the page). step() -> { done }; `result` is { ok: true } or
 * { ok: false, message, line, col } (line/col null when the position cannot be found). `compile` is injectable (tests).
 */
export function createJsCheck(code, { compile = compileError } = {}) {
  const text = String(code ?? ''), lines = text.split('\n'), starts = [0];
  for (let i = 0; i < lines.length - 1; i++) starts.push(starts[i] + lines[i].length + 1);
  let phase = 'full', message = null, lo = 0, hi = 0, line = 0, steps = 0;
  const prefixOfLines = n => text.slice(0, n >= lines.length ? text.length : starts[n] - 1);
  const done = result => { check.result = result; return { done: true }; };
  const check = {
    result: null,
    get progress() { return check.result ? 1 : Math.min(0.99, steps / 64); },
    step() {
      if (check.result) return { done: true };
      steps++;
      if (phase === 'full') {
        message = compile(text);
        if (message === null) return done({ ok: true });
        if (/Unexpected end of input/.test(message)) {   // the code stops too early: the useful place is what is left open (a bracket, a comment, a template), not the end
          const errors = jsBrackets(text).errors, open = errors.filter(error => /never closed|Unterminated/.test(error.message)), wrong = errors.find(error => !open.includes(error));
          const pick = wrong ?? open[open.length - 1];
          if (pick) return done({ ok: false, message: `${pick.message} (${message})`, line: pick.line, col: pick.col });
          const last = lines.length; return done({ ok: false, message, line: last, col: lines[last - 1].length + 1 });
        }
        phase = 'lines'; lo = 1; hi = lines.length; return { done: false };
      }
      if (phase === 'lines') {   // the smallest number of lines whose text fails with the same message
        if (lo < hi) { const mid = (lo + hi) >> 1; if (compile(prefixOfLines(mid)) === message) hi = mid; else lo = mid + 1; return { done: false }; }
        line = lo; phase = 'cols'; lo = 1; hi = lines[line - 1].length; return { done: false };
      }
      // phase 'cols': within that line, the smallest prefix that fails with the same message
      const base = starts[line - 1];
      if (lo < hi) { const mid = (lo + hi) >> 1; if (compile(text.slice(0, base + mid)) === message) hi = mid; else lo = mid + 1; return { done: false }; }
      if (compile(text.slice(0, base + lo)) !== message) return done({ ok: false, message, line, col: null });
      // the column is certain when the message names a token and that token ends there; else only the line is
      const token = /'([^']+)'/.exec(message)?.[1] ?? '', found = !!token && lines[line - 1].slice(Math.max(0, lo - token.length), lo) === token;
      if (found) return done({ ok: false, message, line, col: lo - token.length + 1 });
      if (/^Invalid or unexpected token/.test(message)) return done({ ok: false, message, line, col: lo });   // the bad token starts where the failing prefix ends
      if (/^[)}\]]$/.test(token)) {   // a closer the code does not have: the runtime's own wrapper closes the function, so something the code opened is still open
        const open = jsBrackets(text).errors.filter(error => /never closed/.test(error.message)).pop();
        if (open) return done({ ok: false, message: `${open.message} (${message})`, line: open.line, col: open.col });
      }
      return done({ ok: false, message, line, col: null });
    },
  };
  return check;
}
/** The whole check at once (tests). */
export function checkJs(code, options) { const check = createJsCheck(code, options); while (!check.step().done) { /* next compile */ } return check.result; }
