// The "Logcat" panel of the lab page: the app's log lines (src/logcat.js batches from the Worker) in `logcat -v threadtime` format, coloured by level, with a text filter,
// a minimum level, autoscroll, "Limpar" and "Salvar". The formatting and filter functions are pure (tested without a DOM); createLogcatPanel() wires them to the page.
import { LEVELS, MAX_LINES, formatThreadtime, rowToEntry } from './logcat.js?v=c6940189447d';

export const RENDER_MAX = 2000;   // rows kept in the DOM; the whole buffer is still saved by "Salvar"
export const LEVEL_NAMES = { V: 'Verbose', D: 'Debug', I: 'Info', W: 'Warning', E: 'Error', A: 'Assert' };

/** The entry passes when its level is at or above `minLevel` and `text` (case-insensitive) is part of its tag or message. */
export function matchesFilter(entry, { text = '', minLevel = 'V' } = {}) {
  if (LEVELS.indexOf(entry.level) < LEVELS.indexOf(minLevel)) return false;
  const needle = String(text).trim().toLowerCase(); if (!needle) return true;
  return entry.tag.toLowerCase().includes(needle) || entry.message.toLowerCase().includes(needle);
}

export const formatEntry = entry => formatThreadtime(entry);

const stamp = date => { const p = (v, n = 2) => String(v).padStart(n, '0'); return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`; };
/** logcat-<package>-<timestamp>.txt */
export const exportFileName = (packageName, date = new Date()) => `logcat-${String(packageName || 'app').replace(/[^A-Za-z0-9._-]+/g, '_')}-${stamp(date)}.txt`;

/** The text "Salvar" writes: one threadtime line per entry, preceded by a note when older lines were discarded. */
export function buildExport(entries, { dropped = 0 } = {}) {
  const lines = []; if (dropped > 0) lines.push(`--------- ${dropped} linhas anteriores descartadas (buffer cheio) ---------`);
  for (const entry of entries) lines.push(formatEntry(entry));
  return lines.join('\n') + (lines.length ? '\n' : '');
}

/** Page-side store: applies the Worker's batches (reset, rows, dropped), bounded like the Worker's buffer. */
export function createLogcatStore({ maxLines = MAX_LINES } = {}) {
  let entries = [], lost = 0, trimmed = 0, lastTotal = 0;
  return {
    /** A Worker batch. `dropped` on the page = lines the Worker could not deliver + lines trimmed from this store. */
    apply(message) {
      if (message.reset) { entries = []; lost = 0; trimmed = 0; lastTotal = 0; }
      const rows = (message.rows ?? []).map(rowToEntry); entries.push(...rows);
      if (entries.length > maxLines) { trimmed += entries.length - maxLines; entries = entries.slice(entries.length - maxLines); }
      if (message.total !== undefined) { lost += Math.max(0, message.total - lastTotal - rows.length); lastTotal = message.total; }
      return rows;
    },
    clear() { entries = []; lost = 0; trimmed = 0; },
    get entries() { return entries; },
    get dropped() { return lost + trimmed; },
  };
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * root: the <details id="logcat"> element (see index.html). Returns { push(message), reset(), store }.
 * setStreaming(open): tells the Worker that the panel opened or closed (src/logcat.js setStreaming). While the panel is closed the Worker keeps the lines in its ring and only posts
 * a counter, and the page keeps no lines and does no DOM work; opening asks for the ring's recent lines, then the panel streams. Without setStreaming the panel always streams.
 */
export function createLogcatPanel({ root, getPackage = () => 'app', save = download, setStreaming = null } = {}) {
  const q = selector => root.querySelector(selector), out = q('.logcat-lines'), count = q('.logcat-count'), filterInput = q('.logcat-filter'), levelSelect = q('.logcat-level'), scopeSelect = q('.logcat-scope'), auto = q('.logcat-autoscroll');
  const store = createLogcatStore(); let lastSeq = -1, timer = null, visibleCount = 0, workerTotal = 0, waiting = false;
  const gated = typeof setStreaming === 'function', live = () => !gated || !!root.open;
  const filter = () => ({ text: filterInput.value, minLevel: levelSelect.value });
  const row = entry => { const div = document.createElement('div'); div.className = `logcat-row level-${entry.level}`; div.textContent = formatEntry(entry); return div; };
  const updateCount = () => {
    if (!live()) { count.textContent = `${workerTotal} linhas`; return; }
    const text = `${store.entries.length} linhas${visibleCount !== store.entries.length ? ` · ${visibleCount} exibidas` : ''}${store.dropped ? ` · ${store.dropped} descartadas` : ''}`;
    count.textContent = text;
  };
  const scroll = () => { if (auto.checked) out.scrollTop = out.scrollHeight; };
  const renderAll = () => {
    if (!live()) { out.replaceChildren(); visibleCount = 0; updateCount(); return; }
    const f = filter(), visible = store.entries.filter(entry => matchesFilter(entry, f)); visibleCount = visible.length;
    const rows = visible.slice(-RENDER_MAX).map(row);
    if (store.dropped > 0) { const note = document.createElement('div'); note.className = 'logcat-dropped'; note.textContent = `${store.dropped} linhas anteriores descartadas`; rows.unshift(note); }
    out.replaceChildren(...rows); lastSeq = store.entries.at(-1)?.seq ?? -1; updateCount(); scroll();
    if (!visible.length) { const empty = document.createElement('div'); empty.className = 'logcat-empty'; empty.textContent = waiting ? 'Carregando as linhas recentes…' : store.entries.length ? 'Nenhuma linha passa pelo filtro.' : 'O logcat do app aparecerá aqui (Log.*, System.out/err, exceções).'; out.append(empty); }
  };
  const renderNew = () => {
    timer = null; if (!live()) return;
    let from = store.entries.length; while (from > 0 && store.entries[from - 1].seq > lastSeq) from--;   // entries are in seq order: the new ones are the tail
    const f = filter(), fresh = store.entries.slice(from).filter(entry => matchesFilter(entry, f)); lastSeq = store.entries.at(-1)?.seq ?? lastSeq;
    if (out.querySelector('.logcat-empty')) { renderAll(); return; }
    visibleCount += fresh.length; if (fresh.length) out.append(...fresh.map(row));
    while (out.childElementCount > RENDER_MAX) out.firstElementChild.remove();
    updateCount(); scroll();
  };
  const schedule = () => { if (timer === null) timer = setTimeout(renderNew, 60); };
  filterInput.addEventListener('input', renderAll); levelSelect.addEventListener('change', renderAll);
  out.addEventListener('scroll', () => { auto.checked = out.scrollHeight - out.scrollTop - out.clientHeight < 24; });   // scrolling up pauses, reaching the bottom resumes
  auto.addEventListener('change', scroll);
  q('.logcat-clear').addEventListener('click', () => { store.clear(); renderAll(); });
  q('.logcat-save').addEventListener('click', () => {
    const f = filter(), entries = scopeSelect.value === 'filtered' ? store.entries.filter(entry => matchesFilter(entry, f)) : store.entries;
    save(exportFileName(getPackage()), buildExport(entries, { dropped: store.dropped }));
  });
  if (gated) root.addEventListener('toggle', () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    store.apply({ reset: true, rows: [], dropped: 0 });
    if (root.open) {
      waiting = true; renderAll();
      const done = () => { if (waiting) { waiting = false; renderAll(); } };
      try { Promise.resolve(setStreaming(true)).then(done, done); } catch { done(); }
    } else {
      waiting = false; renderAll();   // closed: no lines kept on the page, no DOM
      try { Promise.resolve(setStreaming(false)).catch(() => {}); } catch { /* no Worker */ }
    }
  });
  renderAll();
  return {
    store,
    push(message) {
      if (Number.isFinite(message.total)) workerTotal = message.total;
      if (!live()) { if (message.reset && !message.count) store.apply({ reset: true, rows: [] }); updateCount(); return; }   // closed: only the counter
      if (message.count) return;   // a counter that crossed the opening: the rows follow
      if (message.reset) waiting = false;
      store.apply(message); if (message.reset) renderAll(); else schedule();
    },
    reset() { workerTotal = 0; store.apply({ reset: true, rows: [], dropped: 0, total: 0 }); renderAll(); },
    /** Whether the Worker should stream rows (the panel is open, or the panel is not gated). */
    get streaming() { return live(); },
    flushNow() { if (timer !== null) { clearTimeout(timer); renderNew(); } },
  };
}
