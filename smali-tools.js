// Smali text helpers of the Code browser and its method editor (src/code-browser.js, src/code-editor.js): the colours of one line, the class / method / field references
// a line names (go to definition), and a line diff of two texts (original vs modified). Pure functions over strings: no DOM, no process.*.

const DIRECTIVE = /^\.[a-z-]+/, LABEL = /^:[\w$-]+/, REGISTER = /^[vp]\d+\b/, NUMBER = /^-?(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)[LlTtSsFfDd]?\b/;
const REF = /^(?:\[*L[^;\s(){},]+;)(?:->[^\s(:,]+(?:\([^)\s]*\)\[*(?:[ZBSCIJFDV]|L[^;\s]+;)|:\[*(?:[ZBSCIJFD]|L[^;\s]+;)))?/;
/** [[start, end, kind]] of a smali line. Kinds (CSS t-<kind>): keyword (directives), key (the opcode), reg, label, string, number, ref, comment, punct. */
export function tokenizeSmaliLine(line) {
  const out = []; let i = 0, first = true;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    const rest = line.slice(i);
    if (c === '#') { out.push([i, n, 'comment']); break; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && line[j] !== c) j += line[j] === '\\' ? 2 : 1; out.push([i, Math.min(n, j + 1), 'string']); i = j + 1; first = false; continue; }
    let m;
    if ((m = DIRECTIVE.exec(rest))) { out.push([i, i + m[0].length, 'keyword']); i += m[0].length; first = false; continue; }
    if ((m = LABEL.exec(rest))) { out.push([i, i + m[0].length, 'label']); i += m[0].length; first = false; continue; }
    if ((m = REF.exec(rest))) { out.push([i, i + m[0].length, 'ref']); i += m[0].length; first = false; continue; }
    if ((m = REGISTER.exec(rest))) { out.push([i, i + m[0].length, 'reg']); i += m[0].length; first = false; continue; }
    if ((m = NUMBER.exec(rest))) { out.push([i, i + m[0].length, 'number']); i += m[0].length; first = false; continue; }
    if ('{}(),.=>@'.includes(c) || c === '-') { out.push([i, i + 1, 'punct']); i++; continue; }
    const word = /^[\w/$<>.-]+/.exec(rest);
    if (word) { if (first) out.push([i, i + word[0].length, 'key']); i += word[0].length; first = false; continue; }
    i++;
  }
  return out;
}
/**
 * The references of a smali line: [{ start, end, kind: 'class' | 'method' | 'field', descriptor, name?, signature?, type? }] (a type inside an array is its element class;
 * primitive arrays are left out). A method reference's descriptor and the class part of it are separate entries, so a click on the class opens the class.
 */
export function smaliReferences(line) {
  const out = []; let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#') break;
    if (c !== 'L' && c !== '[') continue;
    if (i > 0 && /[\w/$]/.test(line[i - 1])) continue;
    const m = REF.exec(line.slice(i)); if (!m) continue;
    const text = m[0], arrow = text.indexOf('->'), classText = arrow < 0 ? text : text.slice(0, arrow), dims = /^\[*/.exec(classText)[0].length;
    const descriptor = classText.slice(dims);
    if (arrow < 0) { out.push({ start: i + dims, end: i + text.length, kind: 'class', descriptor }); i += text.length - 1; continue; }
    out.push({ start: i + dims, end: i + arrow, kind: 'class', descriptor });
    const member = text.slice(arrow + 2), paren = member.indexOf('(');
    if (paren >= 0) out.push({ start: i + arrow + 2, end: i + text.length, kind: 'method', descriptor, name: member.slice(0, paren), signature: member.slice(paren) });
    else { const colon = member.indexOf(':'); out.push({ start: i + arrow + 2, end: i + text.length, kind: 'field', descriptor, name: member.slice(0, colon), type: member.slice(colon + 1) }); }
    // classes named inside the signature or type
    const tail = member.slice(paren >= 0 ? paren : member.indexOf(':') + 1), tailAt = i + arrow + 2 + (paren >= 0 ? paren : member.indexOf(':') + 1);
    for (const t of tail.matchAll(/L[^;\s()]+;/g)) out.push({ start: tailAt + t.index, end: tailAt + t.index + t[0].length, kind: 'class', descriptor: t[0] });
    i += text.length - 1;
  }
  return out.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
}
/** The innermost reference at column `col` (0-based) of a line. */
export function referenceAt(line, col) {
  let best = null;
  for (const ref of smaliReferences(line)) if (col >= ref.start && col < ref.end && (!best || ref.end - ref.start < best.end - best.start)) best = ref;
  return best;
}
/**
 * A line diff of `a` and `b` (strings): [{ op: ' ' | '-' | '+', text, a (line in a, 1-based, or null), b }]. Longest common subsequence after the common head and tail are
 * set aside; the middle is limited to `limit` lines on each side (beyond it the rest is shown as removed then added, and `truncated` is set on the result).
 */
export function lineDiff(a, b, { limit = 2000 } = {}) {
  const x = String(a).split('\n'), y = String(b).split('\n'), out = [];
  let head = 0; while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0; while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  for (let i = 0; i < head; i++) out.push({ op: ' ', text: x[i], a: i + 1, b: i + 1 });
  const xm = x.slice(head, x.length - tail), ym = y.slice(head, y.length - tail);
  let truncated = false;
  if (xm.length > limit || ym.length > limit) {
    truncated = true;
    xm.forEach((text, i) => out.push({ op: '-', text, a: head + i + 1, b: null }));
    ym.forEach((text, i) => out.push({ op: '+', text, a: null, b: head + i + 1 }));
  } else {
    const n = xm.length, m = ym.length, table = new Uint32Array((n + 1) * (m + 1)), at = (i, j) => i * (m + 1) + j;
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[at(i, j)] = xm[i] === ym[j] ? table[at(i + 1, j + 1)] + 1 : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && xm[i] === ym[j]) { out.push({ op: ' ', text: xm[i], a: head + i + 1, b: head + j + 1 }); i++; j++; }
      else if (i < n && (j >= m || table[at(i + 1, j)] >= table[at(i, j + 1)])) { out.push({ op: '-', text: xm[i], a: head + i + 1, b: null }); i++; }
      else { out.push({ op: '+', text: ym[j], a: null, b: head + j + 1 }); j++; }
    }
  }
  for (let k = tail; k > 0; k--) out.push({ op: ' ', text: x[x.length - k], a: x.length - k + 1, b: y.length - k + 1 });
  out.truncated = truncated;
  out.changes = out.filter(line => line.op !== ' ').length;
  return out;
}
