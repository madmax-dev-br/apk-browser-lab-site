// JSON for the page's editors (src/code-editor.js: the mock body and headers): a line tokenizer for highlighting, and a validator, a formatter and a minifier that work in
// bounded steps, so a body of many megabytes is checked or reformatted in slices between which the page keeps answering (runSteps). DOM-free and no process.*: tested in Node.
//
// The validator follows RFC 8259 (what JSON.parse accepts) and reports the first error with its position: { offset, line, col, message } (line and col start at 1; col counts
// UTF-16 units, like the editor's caret). It also counts the document's lines and its UTF-8 size (what TextEncoder would produce: a lone surrogate is 3 bytes), so a caller learns
// the body size without encoding it.

const WS = c => c === 32 || c === 10 || c === 13 || c === 9;
const DIGIT = c => c >= 48 && c <= 57;
const HEX = c => DIGIT(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const ESCAPES = new Set([34, 92, 47, 98, 102, 110, 114, 116]);   // " \ / b f n r t
const LITERALS = { t: 'true', f: 'false', n: 'null' };
const shown = c => c === 10 ? 'a line break' : c === 13 ? 'a carriage return' : c === 9 ? 'a tab' : c < 32 ? `control character U+${c.toString(16).padStart(4, '0').toUpperCase()}` : `'${String.fromCharCode(c)}'`;

/** UTF-8 size of text[from, to) as TextEncoder encodes it (a lone surrogate becomes U+FFFD: 3 bytes). */
export function utf8Length(text, from = 0, to = text.length) {
  let bytes = 0;
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { bytes += 4; i++; }
    else bytes += 3;
  }
  return bytes;
}

/**
 * A stepper over `text` that counts its lines and UTF-8 bytes and, when `json` is true, validates it as JSON. step(budget) looks at no more than `budget` characters and
 * answers { done, error }; `result` holds { valid, error, bytes, lines, chars } once done. The work is linear and never backtracks.
 */
export function createJsonScanner(text, { json = true } = {}) {
  const source = String(text ?? ''), length = source.length;
  let i = 0, line = 1, lineStart = 0, bytes = 0;
  // parser state: 'value' (a value must come), 'value-or-end' (after '['), 'key-or-end' (after '{'), 'key' (after ',' in an object), 'colon', 'after' (after a value), 'done'
  let state = 'value', mode = null, sub = 0, word = '', error = null, lastComma = null, commaLine = 1, commaLineStart = 0;
  const stack = [];   // [{ ch: '{' | '[', line, col }]
  const at = offset => ({ offset, line, col: offset - lineStart + 1 });
  const fail = (offset, message) => { error = { ...at(offset), message }; return false; };
  const afterValue = () => { state = stack.length ? 'after' : 'done'; };

  function charStep(c, k) {
    if (mode === 'string') {
      if (sub === 1) { if (ESCAPES.has(c)) sub = 0; else if (c === 117) { sub = 2; word = ''; } else return fail(k, `Invalid escape '\\${String.fromCharCode(c)}' in a string (use \\" \\\\ \\/ \\b \\f \\n \\r \\t or \\uXXXX)`); return true; }
      if (sub >= 2) { if (!HEX(c)) return fail(k, `Invalid \\u escape: expected 4 hex digits, found ${shown(c)}`); if (++sub === 6) sub = 0; return true; }
      if (c === 34) { mode = null; if (word === 'key') state = 'colon'; else afterValue(); return true; }
      if (c === 92) { sub = 1; return true; }
      if (c < 32) return fail(k, c === 10 ? 'Unterminated string: a line break inside a string (write it as \\n)' : `Invalid ${shown(c)} inside a string (escape it)`);
      return true;
    }
    if (mode === 'number') {
      // sub: 1 after '-', 2 after a leading 0, 3 in the integer, 4 after '.', 5 in the fraction, 6 after e/E, 7 after the exponent sign, 8 in the exponent
      if (sub === 1) { if (c === 48) sub = 2; else if (DIGIT(c)) sub = 3; else return fail(k, `Invalid number: expected a digit after '-', found ${shown(c)}`); return true; }
      if ((sub === 2 || sub === 3) && c === 46) { sub = 4; return true; }
      if ((sub === 2 || sub === 3 || sub === 5) && (c === 101 || c === 69)) { sub = 6; return true; }
      if (sub === 2 && DIGIT(c)) return fail(k, 'Invalid number: a leading zero must not be followed by digits');
      if (sub === 3 && DIGIT(c)) return true;
      if (sub === 4) { if (DIGIT(c)) { sub = 5; return true; } return fail(k, `Invalid number: expected a digit after '.', found ${shown(c)}`); }
      if (sub === 5 && DIGIT(c)) return true;
      if (sub === 6) { if (c === 43 || c === 45) { sub = 7; return true; } if (DIGIT(c)) { sub = 8; return true; } return fail(k, `Invalid number: expected the exponent's digits, found ${shown(c)}`); }
      if (sub === 7) { if (DIGIT(c)) { sub = 8; return true; } return fail(k, `Invalid number: expected the exponent's digits, found ${shown(c)}`); }
      if (sub === 8 && DIGIT(c)) return true;
      mode = null; afterValue();   // the number ended: this character belongs to what follows
      return structural(c, k);
    }
    if (mode === 'literal') {
      if (c !== word.charCodeAt(sub)) return fail(k - sub, `Unexpected text: expected '${word}'`);
      if (++sub === word.length) { mode = null; afterValue(); }
      return true;
    }
    return structural(c, k);
  }

  function structural(c, k) {
    if (WS(c)) return true;
    if (state === 'done') return fail(k, `Unexpected ${shown(c)} after the end of the JSON value`);
    if (state === 'colon') { if (c === 58) { state = 'value'; return true; } return fail(k, `Expected ':' after the key, found ${shown(c)}`); }
    if (state === 'after') {
      const top = stack[stack.length - 1];
      if (c === 44) { state = top.ch === '{' ? 'key' : 'value'; lastComma = k; commaLine = line; commaLineStart = lineStart; return true; }
      if ((c === 125 && top.ch === '{') || (c === 93 && top.ch === '[')) { stack.pop(); afterValue(); return true; }
      if (c === 125 || c === 93) return fail(k, `'${String.fromCharCode(c)}' does not close the '${top.ch}' opened at ${top.line}:${top.col}`);
      return fail(k, `Expected ',' or '${top.ch === '{' ? '}' : ']'}', found ${shown(c)}`);
    }
    if (state === 'key-or-end' || state === 'key') {
      if (c === 34) { mode = 'string'; sub = 0; word = 'key'; return true; }
      if (c === 125 && state === 'key-or-end') { stack.pop(); afterValue(); return true; }
      if (c === 125) { error = { offset: lastComma, line: commaLine, col: lastComma - commaLineStart + 1, message: "Trailing comma: a ',' before '}' (remove it)" }; return false; }
      return fail(k, `Expected a key in double quotes, found ${shown(c)}`);
    }
    // a value (state 'value' or 'value-or-end')
    if (c === 93 && state === 'value-or-end') { stack.pop(); afterValue(); return true; }
    if (c === 93 && stack.length && stack[stack.length - 1].ch === '[' && lastComma !== null) { error = { offset: lastComma, line: commaLine, col: lastComma - commaLineStart + 1, message: "Trailing comma: a ',' before ']' (remove it)" }; return false; }
    if (c === 123 || c === 91) { stack.push({ ch: c === 123 ? '{' : '[', ...at(k) }); state = c === 123 ? 'key-or-end' : 'value-or-end'; lastComma = null; return true; }
    if (c === 34) { mode = 'string'; sub = 0; word = 'value'; return true; }
    if (c === 45) { mode = 'number'; sub = 1; return true; }
    if (c === 48) { mode = 'number'; sub = 2; return true; }
    if (DIGIT(c)) { mode = 'number'; sub = 3; return true; }
    const literal = LITERALS[String.fromCharCode(c)];
    if (literal) { mode = 'literal'; word = literal; sub = 1; return true; }
    if (c === 39) return fail(k, "Strings need double quotes (\"), not single quotes (')");
    return fail(k, `Expected a value, found ${shown(c)}`);
  }

  function finish() {
    if (!json) return;
    if (mode === 'string') { fail(length, word === 'key' ? 'Unterminated key: the closing " is missing' : 'Unterminated string: the closing " is missing'); return; }
    if (mode === 'number') { if (sub === 1 || sub === 4 || sub === 6 || sub === 7) { fail(length, 'Invalid number: it ends too early'); return; } mode = null; afterValue(); }
    if (mode === 'literal') { fail(length - sub, `Unexpected end: expected '${word}'`); return; }
    if (stack.length) { const top = stack[stack.length - 1]; fail(length, `Unexpected end: the '${top.ch}' opened at ${top.line}:${top.col} is not closed`); return; }
    if (state !== 'done') fail(length, 'The document is empty: expected a JSON value');
  }

  const scanner = {
    result: null,
    get progress() { return length ? i / length : 1; },
    step(budget = 262144) {
      if (scanner.result) return { done: true, error: scanner.result.error };
      const end = Math.min(length, i + Math.max(1, budget));
      for (; i < end; i++) {
        let c = source.charCodeAt(i);
        if (mode === 'string' && sub === 0 && !error) {   // fast path: the plain characters of a string (most of a large body)
          while (c !== 34 && c !== 92 && c >= 32 && c < 0xd800) { bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : 3; if (++i >= end) break; c = source.charCodeAt(i); }
          if (i >= end) break;
        }
        // size: one UTF-8 count per character (a surrogate pair is counted on its first half)
        if (c < 0x80) bytes += 1; else if (c < 0x800) bytes += 2;
        else if (c >= 0xd800 && c <= 0xdbff && i + 1 < length && (source.charCodeAt(i + 1) & 0xfc00) === 0xdc00) bytes += 4;
        else if (c >= 0xdc00 && c <= 0xdfff && i > 0 && (source.charCodeAt(i - 1) & 0xfc00) === 0xd800) bytes += 0;
        else bytes += 3;
        if (json && !error && !charStep(c, i)) { /* error recorded; keep counting the size and the lines */ }
        if (c === 10) { line++; lineStart = i + 1; }
      }
      if (i >= length) {
        if (!error) finish();
        scanner.result = { valid: json ? !error : null, error, bytes, lines: line, chars: length };
        return { done: true, error };
      }
      return { done: false, error };
    },
  };
  return scanner;
}

/** The whole check at once (tests, small texts): { valid, error, bytes, lines, chars }. */
export function checkJson(text, options) { const scanner = createJsonScanner(text, options); while (!scanner.step(1 << 20).done) { /* next slice */ } return scanner.result; }

/**
 * Reformats valid JSON in steps: indent > 0 pretty-prints (two spaces by default, empty {} and [] stay on one line), indent 0 minifies. Strings are copied unchanged.
 * step(budget) -> { done }; `result` is the new text once done. Call it on valid JSON (createJsonScanner first): it does not validate.
 */
export function createJsonFormatter(text, { indent = 2 } = {}) {
  const source = String(text ?? ''), length = source.length, out = [], unit = ' '.repeat(Math.max(0, indent));
  let i = 0, depth = 0, inString = false, escape = false, pending = null, piece = [];
  const newline = () => '\n' + unit.repeat(depth);
  const formatter = {
    result: null,
    get progress() { return length ? i / length : 1; },
    step(budget = 262144) {
      if (formatter.result !== null) return { done: true };
      const end = Math.min(length, i + Math.max(1, budget));
      let runStart = inString ? i : -1;   // a run of string characters is copied in one slice (a string begun in an earlier slice continues here)
      for (; i < end; i++) {
        let c = source.charCodeAt(i);
        if (inString && !escape) { while (c !== 34 && c !== 92) { if (++i >= end) break; c = source.charCodeAt(i); } if (i >= end) break; }
        if (inString) {
          if (escape) escape = false; else if (c === 92) escape = true; else if (c === 34) { inString = false; piece.push(source.slice(runStart, i + 1)); runStart = -1; }
          continue;
        }
        if (WS(c)) continue;
        if (pending !== null) {   // an opener waits to see whether its container is empty
          if ((pending === 123 && c === 125) || (pending === 91 && c === 93)) { piece.push(String.fromCharCode(pending, c)); pending = null; continue; }
          depth++; piece.push(String.fromCharCode(pending) + (indent ? newline() : '')); pending = null;
        }
        if (c === 34) { inString = true; runStart = i; continue; }
        if (c === 123 || c === 91) { pending = c; continue; }
        if (c === 125 || c === 93) { depth--; piece.push((indent ? newline() : '') + String.fromCharCode(c)); continue; }
        if (c === 44) { piece.push(indent ? ',' + newline() : ','); continue; }
        if (c === 58) { piece.push(indent ? ': ' : ':'); continue; }
        piece.push(source[i]);
      }
      if (inString && runStart >= 0) piece.push(source.slice(runStart, i));   // the string continues in the next slice
      if (piece.length) { out.push(piece.join('')); piece = []; }   // one flat string per slice: a rope of many small pieces would be flattened later in one long task
      if (i >= length) { if (pending !== null) out.push(String.fromCharCode(pending)); if (indent) out.push('\n'); formatter.result = out.join(''); return { done: true }; }
      return { done: false };
    },
  };
  return formatter;
}
export function formatJson(text, options) { const formatter = createJsonFormatter(text, options); while (!formatter.step(1 << 20).done) { /* next slice */ } return formatter.result; }

const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
/**
 * Runs a stepper (createJsonScanner, createJsonFormatter, a JS check) to the end in slices of `chunk` characters, yielding between slices so no task of the page runs long.
 * `isCancelled()` stops it (resolves null); `onSlice(processed)` lets tests count the work of each slice. Resolves the stepper's result.
 */
export async function runSteps(stepper, { chunk = 131072, yieldTask = nextTask, isCancelled = () => false, onSlice = null } = {}) {
  for (;;) {
    if (isCancelled()) return null;
    const before = stepper.progress, state = stepper.step(chunk);
    onSlice?.({ before, after: stepper.progress, chunk });
    if (state.done) return stepper.result;
    await yieldTask();
  }
}

// ---- highlighting ---------------------------------------------------------------------------------------------------------------------------------------------------------------
/**
 * The tokens of one line of JSON for the editor's colours: [[start, end, kind]] with kind 'key' | 'string' | 'number' | 'literal' | 'punct' | 'bad'. Lenient: it never fails,
 * whatever the text (an unterminated string runs to the end of the line). Whitespace is not a token.
 */
export function tokenizeJsonLine(line) {
  const tokens = [], length = line.length;
  let i = 0;
  while (i < length) {
    const c = line.charCodeAt(i);
    if (WS(c)) { i++; continue; }
    const start = i;
    if (c === 34) {
      i++; while (i < length) { const d = line.charCodeAt(i); if (d === 92) i += 2; else if (d === 34) { i++; break; } else i++; }
      i = Math.min(i, length);
      let j = i; while (j < length && WS(line.charCodeAt(j))) j++;
      tokens.push([start, i, line.charCodeAt(j) === 58 ? 'key' : 'string']); continue;
    }
    if (c === 45 || DIGIT(c)) { i++; while (i < length && /[0-9.eE+-]/.test(line[i])) i++; tokens.push([start, i, 'number']); continue; }
    if (c === 123 || c === 125 || c === 91 || c === 93 || c === 44 || c === 58) { tokens.push([start, i + 1, 'punct']); i++; continue; }
    if (/[a-z]/i.test(line[i])) { while (i < length && /[A-Za-z0-9_$]/.test(line[i])) i++; const word = line.slice(start, i); tokens.push([start, i, word === 'true' || word === 'false' || word === 'null' ? 'literal' : 'bad']); continue; }
    tokens.push([start, i + 1, 'bad']); i++;
  }
  return tokens;
}

/** The offset of the bracket that matches the one at `offset` ({ [ ( and their closers), skipping strings; -1 when it has none. */
export function matchBracketJson(text, offset) {
  const c = text[offset], open = '{[(', close = '}])';
  if (!c || (!open.includes(c) && !close.includes(c))) return -1;
  const pairs = bracketPairs(text);
  return pairs.get(offset) ?? -1;
}
let pairCache = { text: null, pairs: null };
function bracketPairs(text) {
  if (pairCache.text === text) return pairCache.pairs;
  const pairs = new Map(), stack = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) { if (c === 92) i++; else if (c === 34 || c === 10) inString = false; continue; }
    if (c === 34) { inString = true; continue; }
    if (c === 123 || c === 91 || c === 40) stack.push(i);
    else if (c === 125 || c === 93 || c === 41) { const from = stack.pop(); if (from !== undefined && '{[('.indexOf(text[from]) === '}])'.indexOf(text[i])) { pairs.set(from, i); pairs.set(i, from); } }
  }
  pairCache = { text, pairs };
  return pairs;
}

/** A position (offset in the text) as { line, col }, both from 1. */
export function positionOf(text, offset) {
  let line = 1, start = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) { line++; start = i + 1; }
  return { line, col: offset - start + 1 };
}
