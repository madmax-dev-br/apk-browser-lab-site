// The code editors of the page's dialogs: the mock body and headers (JSON, src/endpoint-mocks-panel.js) and the plugin code (JavaScript, src/plugins-panel.js). In-house and
// small on purpose: the text stays in a native <textarea> (typing, selection, undo, IME, spell-check off, screen readers), and a <pre> under it (aria-hidden) paints the colours,
// the bracket match and the error mark of the lines in view only, so the cost of a frame does not grow with the text. A gutter shows the line numbers in view.
//
// Responsiveness rules (a large paste froze the page before, 2026-11-21):
//   - nothing proportional to the text runs on a keystroke: the check (JSON validation or the JS syntax check) waits for a pause in typing and then runs in slices
//     (src/json-tools.js runSteps), the colours and the gutter cover the visible lines only;
//   - a text over LARGE_CHARS is never put in the textarea (the browser's own text box takes seconds to lay out many megabytes and ~100 ms per keystroke after): the editor keeps
//     it in memory, shows its first PREVIEW_CHARS read-only and says so; Paste replaces it, Format / Minify / Clear / Download work on the whole text in slices.
// Markup (index.html), for an editor with id X: textarea#X.ce-input inside .ce-main next to pre.ce-hl > code#X-hl, a gutter #X-gutter, and optional #X-status (role=status),
// #X-pos (caret line and column) and #X-large (the banner of a large text, with #X-large-text).
import { tokenizeJsonLine, createJsonScanner, createJsonFormatter, runSteps, matchBracketJson } from './json-tools.js?v=88e579518234';
import { tokenizeJsLine, lineStates, jsBrackets, createJsCheck } from './js-tools.js?v=88e579518234';

export const LARGE_CHARS = 512 * 1024, PREVIEW_CHARS = 64 * 1024, LONG_LINE = 2000, CHECK_DELAY_MS = 300, SLICE_CHARS = 131072;
const INDENT = '  ', OPENERS = '{[(', CLOSERS = '}])';

/** "1.2 MB", "34.5 KB", "980 bytes" (1 KB = 1024 bytes). */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} ${n === 1 ? 'byte' : 'bytes'}`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/** Replaces text[start, end) of a textarea, keeping the browser's undo history when it can (execCommand insertText), and selects [selStart, selEnd]. */
function replaceRange(area, start, end, text, selStart = start + text.length, selEnd = selStart) {
  const doc = area.ownerDocument, before = area.value;
  let done = false;
  if (typeof doc?.execCommand === 'function' && typeof area.setSelectionRange === 'function') {
    area.setSelectionRange(start, end);
    try { done = doc.execCommand('insertText', false, text) && area.value !== before; } catch { done = false; }
    if (!done && text === '' && area.value !== before) done = true;
  }
  if (!done) area.value = before.slice(0, start) + text + before.slice(end);
  area.selectionStart = selStart; area.selectionEnd = selEnd;
  if (!done) area.dispatchEvent?.(new (globalThis.Event ?? class { constructor(type) { this.type = type; } })('input', { bubbles: true }));
}

/**
 * The editing keys of a code textarea; returns whether the key was handled. Tab indents (the selected lines, or two spaces at the caret), Shift+Tab removes up to two spaces
 * from the start of the line(s), Enter keeps the line's indent (and opens a block after { [ or (). `tabMoves` leaves Tab to the focus order (Ctrl+M switches it).
 */
export function editKey(area, event, { tabMoves = false, autoIndent = true } = {}) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
  const value = area.value, start = area.selectionStart ?? value.length, end = area.selectionEnd ?? start;
  if (event.key === 'Tab' && !tabMoves) {
    event.preventDefault?.();
    const lineStart = value.lastIndexOf('\n', start - 1) + 1, multi = value.slice(start, end).includes('\n');
    if (event.shiftKey || multi) {
      const blockEnd = (() => { const at = value.indexOf('\n', end - (end > start && value[end - 1] === '\n' ? 1 : 0)); return at < 0 ? value.length : at; })();
      const lines = value.slice(lineStart, blockEnd).split('\n');
      let removedFirst = 0;
      const next = lines.map((line, index) => {
        if (!event.shiftKey) return INDENT + line;
        const cut = /^ {1,2}|^\t/.exec(line)?.[0].length ?? 0; if (index === 0) removedFirst = cut; return line.slice(cut);
      }).join('\n');
      if (next === value.slice(lineStart, blockEnd)) return true;
      const caret = Math.max(lineStart, start - removedFirst);   // one line: the caret follows its text; several: the indented lines stay selected
      replaceRange(area, lineStart, blockEnd, next, multi ? lineStart : caret, multi ? lineStart + next.length : caret);
      return true;
    }
    replaceRange(area, start, end, INDENT);
    return true;
  }
  if (event.key === 'Enter' && autoIndent && !event.shiftKey) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1, indent = /^[ \t]*/.exec(value.slice(lineStart, start))[0];
    let k = start - 1; while (k >= lineStart && value[k] === ' ') k--;
    const before = value[k], after = value[end], opens = k >= lineStart && OPENERS.includes(before);
    if (!opens && !indent) return false;   // nothing to keep: the textarea's own Enter
    event.preventDefault?.();
    if (opens && after && CLOSERS.indexOf(after) === OPENERS.indexOf(before)) { const inner = '\n' + indent + INDENT; replaceRange(area, start, end, inner + '\n' + indent, start + inner.length); return true; }
    replaceRange(area, start, end, '\n' + indent + (opens ? INDENT : ''));
    return true;
  }
  return false;
}

/**
 * Wires one editor. `language`: 'json' (colours, JSON check, Format / Minify), 'js' (colours, syntax check of plugin code) or 'text' (size only). Answers the editor's API:
 * value (the whole text, large or not), setValue, setLanguage, large, status, whenChecked(), format({ indent }), clear(), focus().
 * `tokenizers`: { [language]: line => [[start, end, kind]] } for a language its caller brings (the Code browser passes smali), so this module never loads them itself.
 * `onChange(editor)` after each edit; `onStatus(status)` when a check finishes: { state: 'idle' | 'checking' | 'ok' | 'error', bytes, lines, error: { line, col, message } | null }.
 */
export function createCodeEditor({ $, id, language = 'json', onChange = () => {}, onStatus = () => {}, largeChars = LARGE_CHARS, previewChars = PREVIEW_CHARS, checkDelay = CHECK_DELAY_MS, label = 'text', yieldTask, tokenizers = {} }) {
  const area = $(id), code = $(`${id}-hl`), gutter = $(`${id}-gutter`), statusNode = $(`${id}-status`), posNode = $(`${id}-pos`), largeNode = $(`${id}-large`), largeText = $(`${id}-large-text`);
  const doc = area.ownerDocument ?? globalThis.document, view = doc?.defaultView ?? globalThis;
  const raf = typeof view.requestAnimationFrame === 'function' ? fn => view.requestAnimationFrame(fn) : fn => setTimeout(fn, 16);
  const S = { language, full: null, version: 0, starts: null, states: null, statesVersion: -1, pairs: null, pairsVersion: -1, frame: false, checkTimer: null, checkToken: 0,
    status: { state: 'idle', bytes: 0, lines: 1, error: null }, checkedVersion: -1, waiters: [], tabMoves: false, metrics: null, busy: false };
  const text = () => S.full ?? area.value;

  // ---- geometry ------------------------------------------------------------------------------------------------------------------------------------------------------------
  function metrics() {
    if (S.metrics) return S.metrics;
    const style = view.getComputedStyle?.(area), lh = parseFloat(style?.lineHeight) || 18, top = parseFloat(style?.paddingTop) || 0;
    let cw = 7.2;
    try { const probe = doc.createElement('span'); probe.textContent = 'x'.repeat(100); code.append(probe); cw = (probe.getBoundingClientRect?.().width || 720) / 100; probe.remove(); } catch { /* keep the estimate */ }
    return (S.metrics = { lh, top, cw: cw || 7.2 });
  }
  function lineStarts() {
    if (S.starts) return S.starts;
    const value = area.value, starts = [0];
    for (let at = value.indexOf('\n'); at >= 0; at = value.indexOf('\n', at + 1)) starts.push(at + 1);
    return (S.starts = starts);
  }
  const lineOf = offset => { const starts = lineStarts(); let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; } return lo; };

  // ---- painting ------------------------------------------------------------------------------------------------------------------------------------------------------------
  function tokensOf(line, n) {
    if (S.language === 'json') return tokenizeJsonLine(line);
    if (S.language === 'js') {
      if (S.statesVersion !== S.version) { S.states = lineStates(area.value); S.statesVersion = S.version; }
      return tokenizeJsLine(line, S.states[n]).tokens;
    }
    return tokenizers[S.language]?.(line) ?? [];   // a language its user brings (the Code browser's smali: src/smali-tools.js, loaded with it)
  }
  function bracketMarks() {
    if (S.language === 'text' || S.language === 'smali' || area.selectionStart !== area.selectionEnd || doc.activeElement !== area) return [];
    const value = area.value, caret = area.selectionStart ?? 0;
    const pairOf = offset => {
      if (S.language === 'json') return matchBracketJson(value, offset);
      if (S.pairsVersion !== S.version) { S.pairs = jsBrackets(value).pairs; S.pairsVersion = S.version; }
      return S.pairs.get(offset) ?? -1;
    };
    for (const at of [caret - 1, caret]) {
      if (at < 0 || !(OPENERS + CLOSERS).includes(value[at] ?? '')) continue;
      const other = pairOf(at); if (other >= 0) return [at, other];
    }
    return [];
  }
  function paintLine(frag, line, n, lineStart, marks, left, width) {
    let from = 0, to = line.length;
    if (line.length > LONG_LINE) {   // a long line: only the columns in view (and a margin), after a spacer as wide as the hidden part
      const { cw } = metrics(); from = Math.max(0, Math.floor(left / cw) - 200); to = Math.min(line.length, from + Math.ceil(width / cw) + 400);
      if (from > 0) { const pad = doc.createElement('span'); pad.className = 'ce-pad'; pad.style.width = `${from * cw}px`; frag.append(pad); }
    }
    const kinds = new Array(to - from).fill('');
    for (const [start, end, kind] of tokensOf(line, n)) { if (end <= from || start >= to) continue; for (let k = Math.max(start, from); k < Math.min(end, to); k++) kinds[k - from] = `t-${kind}`; }
    for (const [offset, cls] of marks) { const k = offset - lineStart - from; if (k >= 0 && k < kinds.length) kinds[k] += ` ${cls}`; else if (cls === 'ce-errmark' && k === kinds.length) kinds.push(cls); }
    let runStart = 0;
    for (let k = 1; k <= kinds.length; k++) {
      if (k < kinds.length && kinds[k] === kinds[runStart]) continue;
      const piece = k - runStart > 0 ? (line.slice(from + runStart, from + k) || ' ') : '';
      if (kinds[runStart]) { const span = doc.createElement('span'); span.className = kinds[runStart].trim(); span.textContent = piece; frag.append(span); } else frag.append(doc.createTextNode?.(piece) ?? piece);
      runStart = k;
    }
  }
  function render() {
    S.frame = false;
    if (!code || !gutter) return;
    const { lh, top: padTop } = metrics(), starts = lineStarts(), value = area.value;
    const scrollTop = area.scrollTop || 0, scrollLeft = area.scrollLeft || 0, height = area.clientHeight || 0, width = area.clientWidth || 0;
    const first = Math.max(0, Math.floor((scrollTop - padTop) / lh)), last = Math.min(starts.length - 1, first + Math.ceil(height / lh) + 1);
    const marks = bracketMarks().map(offset => [offset, 'ce-match']);
    const error = S.checkedVersion === S.version && !S.full ? S.status.error : null;
    if (error?.offset !== undefined) marks.push([Math.min(error.offset, value.length), 'ce-errmark']);
    const frag = doc.createDocumentFragment?.() ?? doc.createElement('div'), numbers = [];
    for (let n = first; n <= last && height > 0; n++) {
      const start = starts[n], end = n + 1 < starts.length ? starts[n + 1] - 1 : value.length;
      paintLine(frag, value.slice(start, end), n, start, marks, scrollLeft, width);
      frag.append(doc.createTextNode?.('\n') ?? '\n');
      numbers.push(n + 1);
    }
    code.replaceChildren(frag);
    code.style.transform = `translate(${-scrollLeft}px, ${first * lh - scrollTop}px)`;
    const errorLine = error ? error.line : -1;
    const rows = numbers.map(number => { const row = doc.createElement('span'); row.className = number === errorLine ? 'ce-ln ce-ln-err' : 'ce-ln'; row.textContent = String(number); return row; });
    gutter.replaceChildren(...rows);
    gutter.style.transform = `translateY(${first * lh - scrollTop}px)`;
    gutter.parentElement?.style?.setProperty?.('--ce-digits', String(Math.max(2, String(starts.length).length)));
    if (posNode) { const caret = area.selectionStart ?? 0, n = lineOf(caret); posNode.textContent = S.full ? '' : `Ln ${n + 1}, Col ${caret - starts[n] + 1}`; }
  }
  const schedule = () => { if (S.frame) return; S.frame = true; raf(render); };

  // ---- the check -----------------------------------------------------------------------------------------------------------------------------------------------------------
  function statusText(status) {
    const size = `${status.lines.toLocaleString?.('en') ?? status.lines} ${status.lines === 1 ? 'line' : 'lines'}, ${formatBytes(status.bytes)}`;
    if (status.state === 'checking') return S.language === 'js' ? 'Checking the syntax…' : `Checking ${formatBytes(status.bytes || utf8Estimate())}…`;
    if (status.state === 'error') return `${status.error.line ? `Line ${status.error.line}${status.error.col ? `, column ${status.error.col}` : ''}: ` : ''}${status.error.message}`;
    if (S.language === 'js') return status.state === 'ok' ? 'No syntax errors.' : '';
    if (S.language === 'json') return status.state === 'ok' ? (status.empty ? 'Empty.' : `Valid JSON, ${size}`) : '';
    return status.state === 'ok' ? size : '';
  }
  const utf8Estimate = () => text().length;
  function showStatus() {
    if (statusNode) { statusNode.textContent = statusText(S.status); statusNode.dataset.state = S.status.state === 'error' ? 'error' : S.status.state === 'ok' && S.language !== 'text' && !S.status.empty ? 'ok' : ''; statusNode.title = S.status.state === 'error' ? 'Go to the error' : ''; }
  }
  function settle() { const waiters = S.waiters; S.waiters = []; for (const resolve of waiters) resolve(S.status); }
  async function check() {
    clearTimeout(S.checkTimer); S.checkTimer = null;
    const token = ++S.checkToken, version = S.version, value = text(), cancelled = () => token !== S.checkToken;
    if (S.language === 'json' && !value.trim()) {
      S.status = { state: 'ok', bytes: value.length, lines: lineStarts().length, error: null, empty: true }; S.checkedVersion = version; showStatus(); schedule(); onStatus(S.status); settle(); return S.status;
    }
    S.status = { ...S.status, state: 'checking' }; if (value.length > SLICE_CHARS || S.language === 'js') showStatus();
    let status;
    if (S.language === 'js') {
      const result = await runSteps(createJsCheck(value), { chunk: 1, isCancelled: cancelled, yieldTask });
      if (result === null) return null;
      const error = result.ok ? null : { line: result.line, col: result.col, message: result.message, offset: result.line && result.col ? offsetOf(result.line, result.col) : undefined };
      status = { state: result.ok ? 'ok' : 'error', bytes: value.length, lines: lineStarts().length, error };
    } else {
      const result = await runSteps(createJsonScanner(value, { json: S.language === 'json' }), { chunk: SLICE_CHARS, isCancelled: cancelled, yieldTask });
      if (result === null) return null;
      status = { state: result.error ? 'error' : 'ok', bytes: result.bytes, lines: result.lines, error: result.error };
    }
    if (cancelled()) return null;
    if (S.language === 'smali' && S.external?.version === version) status = { ...status, state: S.external.error ? 'error' : 'ok', error: S.external.error };   // the Worker's verdict on this text (setError)
    S.status = status; S.checkedVersion = version; showStatus(); schedule(); onStatus(status); settle();
    return status;
  }
  const offsetOf = (line, col) => { const starts = lineStarts(); return Math.min(area.value.length, (starts[line - 1] ?? 0) + col - 1); };
  function scheduleCheck(delay = checkDelay) { clearTimeout(S.checkTimer); S.checkToken++; S.checkTimer = setTimeout(check, delay); }

  // ---- large texts ---------------------------------------------------------------------------------------------------------------------------------------------------------
  function preview(value) { const cut = value.lastIndexOf('\n', previewChars); return value.slice(0, cut > previewChars / 2 ? cut : previewChars); }
  function showLarge() {
    const on = S.full !== null;
    area.readOnly = on; if (largeNode) largeNode.hidden = !on;
    area.closest?.('.ce')?.classList?.toggle('is-large', on);
    if (largeText) largeText.textContent = on ? `This ${label} is large (${S.full.length.toLocaleString?.('en') ?? S.full.length} characters), so only its first ${formatBytes(previewChars)} are shown and it is read-only here: the page stays responsive. Paste replaces it; Format, Minify, Download and Clear work on all of it.` : '';
  }
  function setValue(value, { silent = false } = {}) {
    const next = String(value ?? '');
    if (next.length > largeChars) { S.full = next; area.value = preview(next); } else { S.full = null; area.value = next; }
    area.scrollTop = 0; area.scrollLeft = 0;
    changed(true, silent);
  }
  function changed(now = false, silent = false) {
    S.version++; S.starts = null; showLarge(); schedule();
    S.status = { ...S.status, state: 'checking' };
    if (now) scheduleCheck(0); else scheduleCheck();
    if (!silent) onChange(api);
  }

  // ---- events --------------------------------------------------------------------------------------------------------------------------------------------------------------
  area.addEventListener('input', () => { if (S.full !== null) return; changed(); });
  area.addEventListener('scroll', schedule);
  for (const type of ['keyup', 'mouseup', 'focus', 'blur', 'select']) area.addEventListener(type, schedule);
  area.addEventListener('keydown', event => {
    if (event.key === 'm' && event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault?.(); S.tabMoves = !S.tabMoves; if (statusNode) statusNode.textContent = S.tabMoves ? 'Tab now moves the focus (Ctrl+M: Tab indents again).' : 'Tab indents (Ctrl+M: Tab moves the focus).'; return; }
    if (S.full !== null) return;
    if (editKey(area, event, { tabMoves: S.tabMoves })) schedule();
  });
  area.addEventListener('paste', event => {
    const pasted = event.clipboardData?.getData?.('text/plain') ?? event.clipboardData?.getData?.('text');
    if (typeof pasted !== 'string') return;
    if (S.full !== null) { event.preventDefault?.(); setValue(pasted); return; }   // a large text: the paste replaces it
    const start = area.selectionStart ?? 0, end = area.selectionEnd ?? start;
    if (area.value.length - (end - start) + pasted.length <= largeChars) return;   // the textarea's own paste
    event.preventDefault?.(); setValue(area.value.slice(0, start) + pasted + area.value.slice(end));
  });
  statusNode?.addEventListener?.('click', () => { const error = S.status.error; if (S.status.state !== 'error' || !error?.line || S.full !== null) return; const at = offsetOf(error.line, error.col ?? 1); area.focus?.(); area.setSelectionRange?.(at, at); const { lh } = metrics(); area.scrollTop = Math.max(0, (error.line - 3) * lh); schedule(); });
  if (typeof view.ResizeObserver === 'function') new view.ResizeObserver(schedule).observe(area);
  if (typeof doc?.fonts?.ready?.then === 'function') doc.fonts.ready.then(() => { S.metrics = null; schedule(); }, () => {});

  const api = {
    get value() { return text(); },
    set value(next) { setValue(next); },
    setValue,
    get large() { return S.full !== null; },
    get language() { return S.language; },
    setLanguage(next) { if (next === S.language) return; S.language = next; area.closest?.('.ce')?.setAttribute?.('data-lang', next); changed(true, true); },
    get status() { return S.status; },
    get checked() { return S.checkedVersion === S.version && S.status.state !== 'checking'; },
    /** The status of the current text once its check finished. */
    whenChecked() { if (S.checkedVersion === S.version && S.status.state !== 'checking') return Promise.resolve(S.status); if (!S.checkTimer) scheduleCheck(0); else { clearTimeout(S.checkTimer); S.checkTimer = setTimeout(check, 0); } return new Promise(resolve => S.waiters.push(resolve)); },
    /** Reformats valid JSON in slices (indent 0: minify). -> { ok, error? } */
    async format({ indent = 2 } = {}) {
      const status = await api.whenChecked();
      if (status.state === 'error') return { ok: false, error: status.error };
      if (status.empty) return { ok: true };
      const version = S.version, result = await runSteps(createJsonFormatter(text(), { indent }), { chunk: SLICE_CHARS, isCancelled: () => version !== S.version, yieldTask });
      if (result === null) return { ok: false, error: { message: 'The text changed while it was being formatted.' } };
      setValue(result); return { ok: true };
    },
    clear() { setValue(''); area.focus?.(); },
    focus() { area.focus?.(); },
    /** The version of the text (it grows with every edit): setError applies to the version it was computed for. */
    get version() { return S.version; },
    /** An error found outside the editor (the smali verifier of the Worker): { line, col, message } or null for "no error", for the text of `version`; the status and the
     *  line mark show it until the text changes. */
    setError(error, version = S.version) {
      if (version !== S.version) return false;
      const mark = error ? { line: error.line || 0, col: error.col || 1, message: String(error.message ?? ''), offset: error.line ? offsetOf(error.line, error.col || 1) : undefined } : null;
      S.external = { version, error: mark };
      if (S.checkedVersion === version) { S.status = { ...S.status, state: mark ? 'error' : 'ok', error: mark }; showStatus(); schedule(); }
      return true;
    },
    /** Puts the caret at line:col (1-based) and scrolls it into view. */
    reveal(line, col = 1) { const at = offsetOf(line, col); area.focus?.(); area.setSelectionRange?.(at, at); const { lh } = metrics(); area.scrollTop = Math.max(0, (line - 3) * lh); schedule(); },
    /** Repaints (the dialog opened: sizes are known now). */
    refresh() { S.metrics = null; schedule(); },
    get state() { return S; },
  };
  area.closest?.('.ce')?.setAttribute?.('data-lang', language);
  return api;
}
