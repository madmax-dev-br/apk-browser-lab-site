// The Code browser (docs/CODE-BROWSER.md): a tool of the bottom dock (src/tool-dock.js) to search the running APK, read its classes as smali and as decompiled Java (with the
// class information) and its files, and change them -- a method body through the method changes of src/method-hooks.js (lab.hook { smali }: listed as "App modified",
// counted, traced, removable, in effect from the next call), an APK file through src/code-service.js editFile (read by the app from its next read). Both are re-applied
// when the APK is opened again.
//
// Responsiveness: every list and the viewer are virtualized (only the rows in view are in the DOM, painted per frame); the search runs in the Worker in steps of about
// 30 ms with a cursor; the page never loops over a whole class or result set on an event. DOM only through `root` (index.html #code-browser) and its document.
// The debugger UI and the plugin / MCP APIs build on src/code-browser-api.js (open, reveal, gutter clicks, markers, selection), not on this module's internals.
import { tokenizeSmaliLine, smaliReferences, lineDiff } from './smali-tools.js?v=cbf1579510f6';
import { createCodeEditor } from './code-editor.js?v=cbf1579510f6';
import { CODE_BROWSER } from './method-hooks-panel.js?v=cbf1579510f6';
import { createCodePanes } from './code-panes.js?v=cbf1579510f6';

const LINE_H = 18, ROW_H = 24, OVERSCAN = 12, MAX_RESULTS = 3000, AUTO_RESULTS = 400, CHECK_MS = 500;
const KIND_LABEL = { class: 'Classes', method: 'Methods', field: 'Fields', string: 'Strings', file: 'Files' };
const dotted = d => d.startsWith('L') && d.endsWith(';') ? d.slice(1, -1).replaceAll('/', '.') : d;
const simpleName = d => { const n = dotted(d); return n.slice(n.lastIndexOf('.') + 1); };
const JAVA_KEYWORDS = new Set('abstract boolean byte char class double else enum extends final float for if implements import int interface long native new null package private protected public return short static strictfp super synchronized this throw throws transient true false try void volatile while'.split(' '));

/** [[start, end, kind]] of a line of the Java view, an XML file or plain text (the viewer's colours; smali has its own tokenizer). */
export function tokenizeViewLine(line, language) {
  if (language === 'smali') return tokenizeSmaliLine(line);
  const out = [];
  if (language === 'java') {
    const comment = line.indexOf('//'); const code = comment < 0 ? line : line.slice(0, comment);
    for (const m of code.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b[A-Za-z_$][\w$]*\b|-?\b\d[\w.]*\b|@\w+/g)) {
      const t = m[0], kind = t[0] === '"' || t[0] === "'" ? 'string' : /^-?\d/.test(t) ? 'number' : t[0] === '@' ? 'literal' : JAVA_KEYWORDS.has(t) ? 'keyword' : null;
      if (kind) out.push([m.index, m.index + t.length, kind]);
    }
    if (comment >= 0) out.push([comment, line.length, 'comment']);
    return out;
  }
  if (language === 'xml') {
    for (const m of line.matchAll(/<\/?[\w:.-]+|\/?>|"[^"]*"|[\w:.-]+(?==)|<!--.*?-->|<\?.*?\?>/g)) {
      const t = m[0], kind = t.startsWith('<!--') || t.startsWith('<?') ? 'comment' : t[0] === '"' ? 'string' : t[0] === '<' || t.endsWith('>') ? 'keyword' : 'key';
      out.push([m.index, m.index + t.length, kind]);
    }
    return out;
  }
  if (language === 'hex') { const m = /^([0-9a-f]{8})/.exec(line); if (m) out.push([0, 8, 'comment']); return out; }
  return out;
}

const VIEW_KEY = 'apkweb.code.view.v1';   // the view the user reads classes in: 'smali' or 'java' (the debugger follows it)
/**
 * root: the dock's <details id="code-browser">. vm: the Worker client (codeService, methodHooks via `hooks`). hooks: the "App modified" panel (src/method-hooks-panel.js),
 * through which method edits are made. debugging(): true while a debugger session is attached (the Java view's results are kept then when the tool closes).
 */
export function createCodeBrowser({ root, vm, hooks, trace = () => {}, getPackage = () => null, debugging = () => false, storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })(), win = globalThis.window, doc = globalThis.document }) {
  const savedView = (() => { try { return storage?.getItem?.(VIEW_KEY) === 'java' ? 'java' : 'smali'; } catch { return 'smali'; } })();
  const h = (tag, props = {}, ...children) => {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) { if (v === undefined || v === null || v === false) continue; if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : String(v)); }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child);
    return el;
  };
  const S = {
    attached: false, packageName: null, inited: false, side: 'classes', query: '', framework: false, search: null, searchSeq: 0, tree: [], treeLoaded: new Map(), expanded: new Set(), files: null, fileExpanded: new Set(),
    doc: null, tab: savedView, views: new Map(), javaUsed: false, history: [], selection: { line: -1 }, markers: new Map(), gutterListeners: new Set(), openListeners: new Set(), find: { query: '', hits: [], at: -1 },
    edit: null, modified: new Map(), fileEdits: new Map(), checkTimer: null, stale: false,
  };
  const countNode = root.querySelector('.cb-count');
  // ---- markup ------------------------------------------------------------------------------------------------------------------------------------------------------------
  const query = h('input', { class: 'cb-query', type: 'search', placeholder: 'Search code and files', title: 'Classes, methods, fields, string constants and APK files', 'aria-label': 'Search the code and files of the app', spellcheck: 'false', autocomplete: 'off' });
  const frameworkBox = h('input', { type: 'checkbox', class: 'cb-framework' });
  const modeButtons = ['classes', 'files'].map(mode => h('button', { type: 'button', class: 'cb-mode', role: 'tab', 'data-mode': mode, 'aria-selected': String(mode === 'classes'), text: mode === 'classes' ? 'Classes' : 'Files' }));
  const list = h('div', { class: 'cb-list', role: 'listbox', tabindex: '0', 'aria-label': 'Classes' }), listSpacer = h('div', { class: 'cb-spacer' }), listRows = h('div', { class: 'cb-rows' });
  list.append(listSpacer, listRows);
  const sideStatus = h('p', { class: 'cb-side-status', role: 'status' });
  const side = h('div', { class: 'cb-side' }, h('div', { class: 'cb-search' }, query, h('label', { class: 'cb-check', title: 'Also search the framework (the AOSP classes the lab runs from DEX)' }, frameworkBox, ' Framework')),
    h('div', { class: 'cb-modes', role: 'tablist', 'aria-label': 'Browse' }, ...modeButtons), list, sideStatus);
  const title = h('div', { class: 'cb-title' }), meta = h('div', { class: 'cb-meta' });
  const tabs = ['smali', 'java', 'info'].map(tab => h('button', { type: 'button', class: 'cb-tab', role: 'tab', 'data-tab': tab, 'aria-selected': String(tab === savedView), text: tab === 'smali' ? 'Smali' : tab === 'java' ? 'Java' : 'Info', title: tab === 'java' ? 'Decompiled Java (readable, not the original source): breakpoints and steps work on its lines' : null }));
  const backButton = h('button', { type: 'button', class: 'cb-button cb-back', title: 'Back (Alt+Left)', disabled: true, text: 'Back' });
  const findButton = h('button', { type: 'button', class: 'cb-button', title: 'Find in this file (Ctrl+F)', text: 'Find' });
  const editButton = h('button', { type: 'button', class: 'cb-button cb-edit-button', disabled: true, text: 'Edit method' });
  const revertButton = h('button', { type: 'button', class: 'cb-button cb-revert-button', hidden: true, text: 'Revert' });
  const head = h('div', { class: 'cb-head' }, backButton, h('div', { class: 'cb-heading' }, title, meta), h('div', { class: 'cb-tabs', role: 'tablist', 'aria-label': 'View' }, ...tabs), h('div', { class: 'cb-actions' }, findButton, revertButton, editButton));
  const findInput = h('input', { class: 'cb-find-input', type: 'search', placeholder: 'Find in file', 'aria-label': 'Find in this file', spellcheck: 'false' });
  const findCount = h('span', { class: 'cb-find-count', 'aria-live': 'polite' });
  const findBar = h('div', { class: 'cb-find', hidden: true }, findInput, h('button', { type: 'button', class: 'cb-button', title: 'Previous (Shift+Enter)', 'aria-label': 'Previous match', text: '↑', onclick: () => findStep(-1) }),
    h('button', { type: 'button', class: 'cb-button', title: 'Next (Enter)', 'aria-label': 'Next match', text: '↓', onclick: () => findStep(1) }), findCount, h('button', { type: 'button', class: 'cb-button', 'aria-label': 'Close find', text: 'Close', onclick: () => closeFind() }));
  const view = h('div', { class: 'cb-view', tabindex: '0', role: 'document', 'aria-label': 'Code' }), viewSpacer = h('div', { class: 'cb-spacer' }), viewRows = h('div', { class: 'cb-rows cb-code' });
  view.append(viewSpacer, viewRows);
  const info = h('div', { class: 'cb-info', hidden: true });
  const image = h('div', { class: 'cb-image', hidden: true });
  const empty = h('div', { class: 'cb-empty' }, h('p', { class: 'cb-empty-title', text: 'Open an APK to read its code.' }), h('p', { text: 'Then search for a class, a method, a string or a file, or open a package on the left.' }));
  // the editor of a method body or of a file
  const editTitle = h('div', { class: 'cb-edit-title' }), editNote = h('p', { class: 'cb-edit-note' }), editErrors = h('ul', { class: 'cb-errors', hidden: true });
  const applyButton = h('button', { type: 'button', class: 'cb-button cb-primary', text: 'Apply' }), diffButton = h('button', { type: 'button', class: 'cb-button', 'aria-pressed': 'false', text: 'Diff' });
  const cancelButton = h('button', { type: 'button', class: 'cb-button', text: 'Close' });
  const editorBox = h('div', { class: 'ce cb-editor', 'data-lang': 'smali' },
    h('div', { class: 'ce-gutter', 'aria-hidden': 'true' }, h('div', { id: 'cb-editor-gutter', class: 'ce-gutter-lines' })),
    h('div', { class: 'ce-main' }, h('pre', { class: 'ce-hl', 'aria-hidden': 'true' }, h('code', { id: 'cb-editor-hl' })), h('textarea', { id: 'cb-editor', class: 'ce-input', wrap: 'off', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', 'aria-label': 'Smali of the method' })));
  const editorBar = h('div', { class: 'ce-bar' }, h('span', { id: 'cb-editor-status', class: 'ce-status', role: 'status', 'aria-live': 'polite' }), h('span', { id: 'cb-editor-pos', class: 'ce-pos', 'aria-hidden': 'true' }));
  const diffPane = h('div', { class: 'cb-diff', hidden: true, role: 'region', 'aria-label': 'Original and modified' });
  const editPane = h('div', { class: 'cb-edit', hidden: true }, h('div', { class: 'cb-edit-head' }, editTitle, h('div', { class: 'cb-actions' }, diffButton, cancelButton, applyButton)), editNote,
    h('div', { class: 'cb-edit-body' }, h('div', { class: 'cb-edit-code' }, editorBox, editorBar, editErrors), diffPane));
  const main = h('div', { class: 'cb-main' }, head, findBar, h('div', { class: 'cb-stage' }, view, info, image, empty, editPane));
  const body = root.querySelector('.cb-body') ?? root.appendChild(h('div', { class: 'cb-body' }));
  body.replaceChildren(side, main);
  const panes = createCodePanes({ body, side, doc, win });   // drag handles between the list, the code and the debugger column (src/code-panes.js)
  const byId = id => doc.getElementById(id);
  const editor = createCodeEditor({ $: byId, id: 'cb-editor', language: 'smali', label: 'smali', tokenizers: { smali: tokenizeSmaliLine }, onChange: () => { scheduleCheck(); }, onStatus: () => {} });

  // ---- virtual rows ------------------------------------------------------------------------------------------------------------------------------------------------------
  const raf = typeof win?.requestAnimationFrame === 'function' ? fn => win.requestAnimationFrame(fn) : fn => setTimeout(fn, 16);
  // closed tool (the Code tab not shown): nothing is painted; what changed is painted when it opens (the toggle handler below)
  let listFrame = false, viewFrame = false;
  const scheduleList = () => { if (!root.open) return; if (!listFrame) { listFrame = true; raf(paintList); } };
  const scheduleView = () => { if (!root.open) return; if (!viewFrame) { viewFrame = true; raf(paintView); } };
  list.addEventListener('scroll', () => { scheduleList(); maybeMoreResults(); });
  view.addEventListener('scroll', scheduleView);
  if (typeof win?.ResizeObserver === 'function') { new win.ResizeObserver(() => { scheduleList(); scheduleView(); }).observe(list); new win.ResizeObserver(scheduleView).observe(view); }

  // ---- side list: tree, files, results ---------------------------------------------------------------------------------------------------------------------------------
  function sideRows() {
    if (S.query) return S.search?.rows ?? [];
    return S.side === 'files' ? fileRows() : S.tree;
  }
  function paintList() {
    listFrame = false;
    const rows = sideRows(), top = list.scrollTop || 0, height = list.clientHeight || 400;
    listSpacer.style.height = `${rows.length * ROW_H}px`;
    const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN), last = Math.min(rows.length, Math.ceil((top + height) / ROW_H) + OVERSCAN);
    listRows.style.transform = `translateY(${first * ROW_H}px)`;
    const out = [];
    for (let i = first; i < last; i++) out.push(sideRow(rows[i], i));
    listRows.replaceChildren(...out);
  }
  function sideRow(row, index) {
    const el = h('div', { class: `cb-row cb-row-${row.type}${row.current ? ' is-current' : ''}`, role: row.type === 'header' ? 'presentation' : 'option', 'data-index': index, style: `padding-left:${8 + (row.depth ?? 0) * 14}px` });
    if (row.type === 'header') { el.append(h('span', { class: 'cb-row-name', text: row.label }), h('span', { class: 'cb-row-meta', text: row.meta ?? '' })); return el; }
    if (row.type === 'package' || row.type === 'folder' || row.type === 'root') el.append(h('span', { class: 'cb-twist', 'aria-hidden': 'true', text: row.open ? '▾' : '▸' }));
    else el.append(h('span', { class: 'cb-twist', 'aria-hidden': 'true' }));
    el.append(h('span', { class: 'cb-row-name', text: row.label }));
    if (row.meta) el.append(h('span', { class: 'cb-row-meta', text: row.meta }));
    if (row.badge) el.append(h('span', { class: `cb-badge cb-badge-${row.badge}`, text: row.badge === 'modified' ? 'modified' : row.badge === 'edited' ? 'edited' : 'framework' }));
    if (row.title) el.title = row.title;
    return el;
  }
  list.addEventListener('click', event => { const row = event.target.closest?.('.cb-row'); if (!row) return; activateRow(sideRows()[Number(row.dataset.index)]); });
  list.addEventListener('keydown', event => {
    const rows = sideRows(); if (!rows.length) return;
    let at = rows.findIndex(r => r.current); if (at < 0) at = Math.floor((list.scrollTop || 0) / ROW_H) - 1;
    const move = d => { let i = at; do { i = Math.max(0, Math.min(rows.length - 1, i + d)); } while (rows[i]?.type === 'header' && i > 0 && i < rows.length - 1); rows.forEach(r => { r.current = false; }); rows[i].current = true; revealRow(i); scheduleList(); };
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter' && at >= 0) { event.preventDefault(); activateRow(rows[at]); }
  });
  function revealRow(i) { const top = i * ROW_H; if (top < list.scrollTop) list.scrollTop = top; else if (top + ROW_H > list.scrollTop + list.clientHeight) list.scrollTop = top + ROW_H - list.clientHeight; }
  async function activateRow(row) {
    if (!row || row.type === 'header') return;
    sideRows().forEach(r => { r.current = r === row; }); scheduleList();
    if (row.type === 'package' || row.type === 'root') { await togglePackage(row); return; }
    if (row.type === 'folder') { if (S.fileExpanded.has(row.path)) S.fileExpanded.delete(row.path); else S.fileExpanded.add(row.path); scheduleList(); return; }
    if (row.type === 'more') { continueSearch(true); return; }
    if (row.type === 'class') return open(row.descriptor);
    if (row.type === 'method') return open(row.descriptor, { method: { name: row.name, signature: row.signature } });
    if (row.type === 'field') return open(row.descriptor, { field: row.name });
    if (row.type === 'string') return open(row.descriptor, { method: { name: row.method, signature: row.signature }, pc: row.pc });
    if (row.type === 'file') return open(row.path);
  }
  // the class tree: flat rows of the expanded packages, loaded package by package from the Worker
  async function loadPackage(path, framework) {
    const key = `${framework ? 'f' : 'a'}:${path}`;
    if (!S.treeLoaded.has(key)) S.treeLoaded.set(key, await vm.codeService('class-tree', { package: path, framework }));
    return S.treeLoaded.get(key);
  }
  async function rebuildTree() {
    const rows = [];
    const add = async (path, framework, depth) => {
      const node = await loadPackage(path, framework);
      for (const p of node.packages) {
        // a package with one sub-package and no class is shown joined with it (dev.apkweb.probe), as IDEs do
        let label = p.name, at = p.path, inner = await loadPackage(at, framework);
        while (inner.packages.length === 1 && !inner.classes.length) { label += '.' + inner.packages[0].name; at = inner.packages[0].path; inner = await loadPackage(at, framework); }
        const open = S.expanded.has(`${framework ? 'f' : 'a'}:${at}`);
        rows.push({ type: 'package', label, path: at, framework, depth, open, meta: String(p.count) });
        if (open) await add(at, framework, depth + 1);
      }
      for (const c of node.classes) rows.push({ type: 'class', label: c.name.replaceAll('$', '.'), descriptor: c.descriptor, depth, title: dotted(c.descriptor), badge: [...S.modified.keys()].some(k => k.startsWith(c.descriptor + '->')) ? 'modified' : null });
    };
    await add('', false, 0);
    const frameworkOpen = S.expanded.has('f:');
    rows.push({ type: 'root', label: 'Framework (AOSP classes the lab runs from DEX)', path: '', framework: true, depth: 0, open: frameworkOpen });
    if (frameworkOpen) await add('', true, 1);
    S.tree = rows; scheduleList();
  }
  async function togglePackage(row) {
    const key = `${row.framework ? 'f' : 'a'}:${row.path}`;
    if (S.expanded.has(key)) S.expanded.delete(key); else S.expanded.add(key);
    await rebuildTree().catch(error => setSideStatus(error.message));
  }
  // the files: a tree built here from the entry list (a few thousand entries at most in an APK)
  function fileRows() {
    if (!S.files) return [];
    const rows = [], seen = new Set();
    for (const file of S.files) {
      const parts = file.path.split('/'); let visible = true;
      for (let i = 0; i < parts.length - 1 && visible; i++) {
        const path = parts.slice(0, i + 1).join('/');
        if (!seen.has(path)) { seen.add(path); rows.push({ type: 'folder', label: parts[i], path, depth: i, open: S.fileExpanded.has(path) }); }
        visible = S.fileExpanded.has(path);
      }
      if (visible) rows.push({ type: 'file', label: parts.at(-1), path: file.path, depth: parts.length - 1, meta: file.size !== null ? sizeText(file.size) : '', badge: S.fileEdits.has(file.path) || file.edited ? 'edited' : null, title: file.aliases?.length ? `${file.path} (${file.aliases.join(', ')})` : file.path });
    }
    return rows;
  }
  const sizeText = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
  async function loadFiles() { if (!S.files) { S.files = (await vm.codeService('files')).files; } scheduleList(); }
  // search: Worker steps with a cursor; results appended in kind groups
  let searchTimer = null;
  query.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => startSearch(query.value.trim()), 180); });
  query.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); list.focus(); } if (event.key === 'Escape') { query.value = ''; startSearch(''); } });
  frameworkBox.addEventListener('change', () => { S.framework = frameworkBox.checked; if (S.query) startSearch(S.query); });
  function startSearch(text) {
    S.query = text; const seq = ++S.searchSeq;
    list.scrollTop = 0;
    if (!text) { S.search = null; setSideStatus(''); list.setAttribute('aria-label', S.side === 'files' ? 'Files' : 'Classes'); scheduleList(); return; }
    list.setAttribute('aria-label', 'Search results');
    S.search = { seq, rows: [], cursor: undefined, count: 0, lastKind: null, ms: 0, running: false };
    scheduleList(); continueSearch(false);
  }
  async function continueSearch(user) {
    const search = S.search; if (!search || search.running || search.cursor === null) return;
    search.running = true; setSideStatus(search.count ? `${search.count} found, searching…` : 'Searching…');
    try {
      while (search === S.search && search.cursor !== null && (user || search.count < AUTO_RESULTS) && search.count < MAX_RESULTS) {
        const step = await vm.codeService('search', { query: S.query, cursor: search.cursor ?? null, limit: 200, framework: S.framework });
        if (search !== S.search) return;
        search.ms += step.ms ?? 0;
        search.rows = search.rows.filter(r => r.type !== 'more');
        for (const result of step.results) {
          if (result.kind !== search.lastKind) { search.rows.push({ type: 'header', label: KIND_LABEL[result.kind] ?? result.kind, kind: result.kind }); search.lastKind = result.kind; }
          search.rows.push(resultRow(result)); search.count++;
        }
        search.cursor = step.cursor;
        updateHeaders(search); scheduleList();
        if (!user && search.count >= AUTO_RESULTS) break;
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (search.cursor !== null && search.count < MAX_RESULTS) search.rows.push({ type: 'more', label: 'Search more…', depth: 0 });
      setSideStatus(search.count ? `${search.count}${search.cursor !== null ? '+' : ''} found` : `Nothing matches “${S.query}”${S.framework ? '' : '. Tick Framework to search the AOSP classes too.'}`);
      scheduleList();
    } catch (error) { setSideStatus(error.code === 'no-apk' ? 'Open an APK first.' : `Search failed: ${error.message}`); }
    finally { search.running = false; }
  }
  function updateHeaders(search) { const counts = new Map(); for (const r of search.rows) if (r.type !== 'header' && r.kind) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1); for (const r of search.rows) if (r.type === 'header') r.meta = String(counts.get(r.kind) ?? 0); }
  function resultRow(r) {
    const badge = r.framework ? 'framework' : r.edited ? 'edited' : null;
    switch (r.kind) {
      case 'class': { const cut = r.name.lastIndexOf('.'); return { type: 'class', kind: 'class', label: r.name.slice(cut + 1).replaceAll('$', '.'), meta: cut > 0 ? r.name.slice(0, cut) : '', descriptor: r.descriptor, badge, title: `${r.name} (${r.file})` }; }
      case 'method': return { type: 'method', kind: 'method', label: `${simpleName(r.descriptor)}.${r.name}${r.signature}`, descriptor: r.descriptor, name: r.name, signature: r.signature, badge, title: r.key };
      case 'field': return { type: 'field', kind: 'field', label: `${simpleName(r.descriptor)}.${r.name}:${r.type}`, descriptor: r.descriptor, name: r.name, badge, title: r.key };
      case 'string': return { type: 'string', kind: 'string', label: JSON.stringify(r.value.length > 120 ? r.value.slice(0, 120) + '…' : r.value), meta: `${simpleName(r.descriptor)}.${r.method}`, descriptor: r.descriptor, method: r.method, signature: r.signature, pc: r.pc, badge, title: `${r.key} @ pc ${r.pc}` };
      default: return { type: 'file', kind: 'file', label: r.path, path: r.path, meta: r.aliases?.length ? r.aliases.join(', ') : (r.size !== null && r.size !== undefined ? sizeText(r.size) : ''), badge };
    }
  }
  function maybeMoreResults() { const s = S.search; if (s && !s.running && s.cursor !== null && list.scrollTop + list.clientHeight > (s.rows.length - 20) * ROW_H) continueSearch(true); }
  const setSideStatus = text => { sideStatus.textContent = text; };
  for (const button of modeButtons) button.addEventListener('click', () => setSide(button.dataset.mode));
  function setSide(mode) {
    S.side = mode; for (const b of modeButtons) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    if (S.query) { query.value = ''; startSearch(''); }
    list.setAttribute('aria-label', mode === 'files' ? 'Files' : 'Classes'); list.scrollTop = 0;
    if (mode === 'files') loadFiles().catch(error => setSideStatus(error.message)); else scheduleList();
  }

  // ---- the viewer -------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The document on screen: { kind: 'class' | 'file', descriptor?, path?, lines, language, pcOfLine?, methodOfLine?, methods?, ... } for the current tab. */
  function showStage(which) { view.hidden = which !== 'view'; info.hidden = which !== 'info'; image.hidden = which !== 'image'; empty.hidden = which !== 'empty'; editPane.hidden = which !== 'edit'; }
  function currentText() { const d = S.doc; if (!d) return null; return d.kind === 'file' ? d.file : S.tab === 'java' ? d.java ?? d.javaWait ?? null : d.smali; }
  function paintView() {
    viewFrame = false;
    const t = currentText(); if (!t || view.hidden) return;
    const lines = t.lines, top = view.scrollTop || 0, height = view.clientHeight || 400;
    viewSpacer.style.height = `${lines.length * LINE_H + 8}px`;
    const first = Math.max(0, Math.floor(top / LINE_H) - OVERSCAN), last = Math.min(lines.length, Math.ceil((top + height) / LINE_H) + OVERSCAN);
    viewRows.style.transform = `translateY(${first * LINE_H}px)`;
    view.style.setProperty('--cb-digits', String(Math.max(3, String(lines.length).length)));
    const out = [], find = S.find, hitLines = find.hitsByLine;
    for (let n = first; n < last; n++) out.push(viewLine(t, n, hitLines?.get(n)));
    viewRows.replaceChildren(...out);
  }
  function viewLine(t, n, hits) {
    const line = t.lines[n], pc = t.pcOfLine ? t.pcOfLine[n] : -1, marker = S.markers.get(n), selected = S.selection.line === n;
    const row = h('div', { class: `cb-line${selected ? ' is-selected' : ''}${marker ? ` cb-marker-${marker}` : ''}${t.modifiedLines?.has(n) ? ' is-modified' : ''}`, 'data-line': n });
    const gutter = h('span', { class: 'cb-gutter', 'data-line': n, title: pc >= 0 ? `line ${n + 1}, dex pc ${pc} (0x${pc.toString(16)})${t.language === 'java' && t.pcsOfLine?.[n]?.length > 3 ? `, ${t.pcsOfLine[n].length - 2} instructions` : ''}` : `line ${n + 1}` },
      h('span', { class: 'cb-mark', 'aria-hidden': 'true' }), h('span', { class: 'cb-ln', text: String(n + 1) }), h('span', { class: 'cb-pc', text: pc >= 0 ? pc.toString(16).padStart(4, '0') : '' }));
    const code = h('code', { class: 'cb-text' });
    paintText(code, line, tokenizeViewLine(line, t.language), referencesOf(t, line), hits, n);
    row.append(gutter, code);
    return row;
  }
  function paintText(el, line, tokens, refs, hits, n) {
    if (line.length > 4000) { el.textContent = line.slice(0, 4000) + ' …'; return; }
    const kinds = new Array(line.length).fill(''), refAt = new Int16Array(line.length).fill(-1), hitAt = new Uint8Array(line.length);
    for (const [s, e, k] of tokens) for (let i = s; i < e && i < line.length; i++) kinds[i] = k;
    refs.forEach((r, ri) => { for (let i = r.start; i < r.end && i < line.length; i++) if (refAt[i] < 0 || (refs[refAt[i]].end - refs[refAt[i]].start) > (r.end - r.start)) refAt[i] = ri; });
    for (const [s, e, current] of hits ?? []) for (let i = s; i < e && i < line.length; i++) hitAt[i] = current ? 2 : 1;
    let start = 0;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && kinds[i] === kinds[start] && refAt[i] === refAt[start] && hitAt[i] === hitAt[start]) continue;
      const text = line.slice(start, i), cls = [kinds[start] && `t-${kinds[start]}`, refAt[start] >= 0 && 'cb-ref', hitAt[start] && (hitAt[start] === 2 ? 'cb-hit is-current' : 'cb-hit')].filter(Boolean).join(' ');
      if (cls) { const span = h('span', { class: cls, text }); if (refAt[start] >= 0) { span.dataset.ref = String(refAt[start]); span.dataset.line = String(n); } el.append(span); } else el.append(text);
      start = i;
    }
    if (!line.length) el.append(' ');
  }
  view.addEventListener('click', event => {
    const gutter = event.target.closest?.('.cb-gutter');
    const lineEl = event.target.closest?.('.cb-line'); if (!lineEl) return;
    const n = Number(lineEl.dataset.line);
    if (gutter) { emitGutter(n, event); return; }
    const ref = event.target.closest?.('.cb-ref');
    if (ref && !(win?.getSelection?.()?.toString?.())) { const t = currentText(), r = referencesOf(t, t.lines[n])[Number(ref.dataset.ref)]; if (r) { goToDefinition(r); return; } }
    select(n);
  });
  /** The references a line of the open text links to: smali's members and types; in the Java view, the class names the decompiler resolved. */
  function referencesOf(t, line) {
    if (t.language === 'smali') return smaliReferences(line);
    if (t.language !== 'java' || !t.typeRefs) return [];
    const out = [], comment = line.indexOf('//'), code = comment < 0 ? line : line.slice(0, comment);
    for (const m of code.matchAll(/"(?:[^"\\]|\\.)*"|\b[A-Z][\w$]*\b/g)) { const d = m[0][0] !== '"' ? t.typeRefs[m[0]] : null; if (d) out.push({ kind: 'class', descriptor: d, start: m.index, end: m.index + m[0].length }); }
    return out;
  }
  function select(n) {
    S.selection = { line: n }; updateEditButton(); scheduleView();
    if (S.tab === 'java' && S.doc?.java?.methodOfLine?.[n] >= 0) { /* a line of a method's outline: the Smali tab opens on that method */ }
  }
  view.addEventListener('dblclick', event => {
    const n = Number(event.target.closest?.('.cb-line')?.dataset.line); if (!(n >= 0)) return;
    if (S.tab === 'java') { const j = S.doc?.java, index = j?.methodOfLine?.[n], m = index >= 0 ? j.methods[index] : null; if (m) { const pc = j.pcOfLine?.[n]; setTab('smali').then(() => revealMethod(m.name, m.signature, pc >= 0 ? pc : null)); } }
  });
  function emitGutter(n, event) {
    const t = currentText(), d = S.doc, pc = t?.pcOfLine ? t.pcOfLine[n] : -1, method = methodAtLine(n);
    const detail = { line: n + 1, pc: pc >= 0 ? pc : null, descriptor: d?.descriptor ?? null, path: d?.path ?? null, method: method ? { key: method.key, name: method.name, signature: method.signature } : null, tab: S.tab, shiftKey: !!event?.shiftKey, altKey: !!event?.altKey };
    select(n);
    for (const fn of S.gutterListeners) { try { fn(detail); } catch (error) { trace(`Code browser: a gutter listener failed: ${error?.message ?? error}`); } }
  }
  function methodAtLine(n) { const d = S.doc; if (!d || d.kind !== 'class' || (S.tab !== 'smali' && S.tab !== 'java')) return null; const t = S.tab === 'java' ? d.java : d.smali; const i = t?.methodOfLine?.[n] ?? -1; return i >= 0 ? t.methods[i] : null; }
  async function goToDefinition(ref) {
    if (ref.kind === 'class') return open(ref.descriptor).catch(() => {});
    // a member: its class, or the first superclass that declares it
    let owner = ref.descriptor;
    for (let depth = 0; depth < 12 && owner; depth++) {
      let info; try { info = await vm.codeService('class-info', { descriptor: owner }); } catch { break; }
      const found = ref.kind === 'method' ? info.methods.find(m => m.name === ref.name && m.signature === ref.signature) : info.fields.find(f => f.name === ref.name && f.type === ref.type);
      if (found) return open(owner, ref.kind === 'method' ? { method: { name: ref.name, signature: ref.signature } } : { field: ref.name });
      owner = info.superclass;
    }
    setNote(`${dotted(ref.descriptor)}.${ref.name} is not in the DEX files of the app or the framework: the lab implements it in JavaScript, so it has no smali to show.`);
  }
  let noteTimer = null;
  function setNote(text) { meta.dataset.note = text; meta.textContent = text; clearTimeout(noteTimer); noteTimer = setTimeout(() => { delete meta.dataset.note; renderHead(); }, 6000); }

  function renderHead() {
    const d = S.doc;
    backButton.disabled = S.history.length === 0;
    if (!d) { title.textContent = 'Code'; meta.textContent = S.attached ? 'Pick a class or a file on the left.' : ''; for (const t of tabs) t.hidden = true; editButton.hidden = true; revertButton.hidden = true; return; }
    if (meta.dataset.note) return;
    if (d.kind === 'class') {
      title.textContent = d.name; meta.textContent = `${d.file}${d.framework ? ' · framework' : ''}${d.smali ? ` · ${d.smali.methods.length} methods` : ''}`;
      for (const t of tabs) { t.hidden = false; t.setAttribute('aria-selected', String(t.dataset.tab === S.tab)); }
      editButton.hidden = false; editButton.textContent = 'Edit method';
    } else {
      title.textContent = d.path; meta.textContent = `${sizeText(d.size)}${d.edited ? ' · edited' : ''}${d.refusal ? ` · read-only: ${d.refusal}` : ''}`;
      for (const t of tabs) t.hidden = true; editButton.hidden = !d.editable; editButton.textContent = 'Edit file';
    }
    updateEditButton();
  }
  function updateEditButton() {
    const d = S.doc; if (!d) return;
    if (d.kind === 'file') { editButton.disabled = !d.editable; revertButton.hidden = !S.fileEdits.has(d.path) && !d.edited; return; }
    const m = methodForEdit();
    editButton.disabled = !m || d.framework || !m.hasCode;
    editButton.title = d.framework ? 'Framework methods take a fixed return or observed calls (plugins), not a new body' : !m ? 'Click a line of a method first' : !m.hasCode ? `${m.name} has no code (native or abstract)` : `Edit ${m.name}${m.signature}`;
    revertButton.hidden = !(m && S.modified.has(m.key));
  }
  function methodForEdit() {
    const d = S.doc; if (!d || d.kind !== 'class' || !d.smali) return null;
    let n = S.selection.line; if (n < 0) n = Math.floor((view.scrollTop || 0) / LINE_H) + 2;
    if (S.tab === 'java') { const i = d.java?.methodOfLine?.[n] ?? -1; const jm = i >= 0 ? d.java.methods[i] : null; return jm ? d.smali.methods.find(m => m.name === jm.name && m.signature === jm.signature) ?? null : null; }
    if (S.tab !== 'smali') return null;
    const i = d.smali.methodOfLine?.[n] ?? -1; return i >= 0 ? d.smali.methods[i] : null;
  }
  for (const t of tabs) t.addEventListener('click', () => { if (t.dataset.tab !== 'info') { try { storage?.setItem?.(VIEW_KEY, t.dataset.tab); } catch { /* not kept */ } } setTab(t.dataset.tab).catch(error => { if (error?.code !== 'left') setNote(error.message); }); });
  /** Shows a tab of the open class; `keep`: leave the scroll position and the selection (the caller places them). Resolves once the Java view is there (or failed). */
  async function setTab(tab, { keep = false } = {}) {
    S.tab = tab; const d = S.doc; renderHead(); closeFind(true);
    if (!d || d.kind !== 'class') return;
    if (tab === 'info') { renderInfo(); showStage('info'); return; }
    if (tab === 'java' && !d.java) {
      showStage('view'); d.javaWait = { lines: ['// Decompiling…'], language: 'java' }; scheduleView();
      try { await loadJava(d); }
      catch (error) { if (S.doc === d && S.tab === 'java' && error?.code !== 'left') { d.javaWait = { lines: [`// The Java view is not available: ${error?.message ?? error}`, '// The Smali tab has the code.'], language: 'java' }; scheduleView(); } throw error; }
      if (S.doc !== d || S.tab !== tab) return;
    }
    showStage('view'); if (!keep) { view.scrollTop = 0; S.selection = { line: -1 }; } scheduleView(); updateEditButton(); renderHead();
  }
  /**
   * The class's Java view, from the Worker's decompiler (src/java-decompiler.js through src/code-service.js 'decompile'): asked for step by step (the VM runs between two
   * steps), and no longer once the user left this class or its Java tab, or closed the tool (unless the debugger needs the view: `force`).
   */
  function loadJava(d, { force = false } = {}) {
    if (d.java) return Promise.resolve(d.java);
    if (d.javaLoading) return d.javaLoading;
    S.javaUsed = true;
    d.javaLoading = (async () => {
      for (;;) {
        const out = await vm.codeService('decompile', { descriptor: d.descriptor });
        if (S.doc !== d) throw Object.assign(new Error('the class is no longer open'), { code: 'left' });
        if (out.done) {
          const pcOfLine = new Int32Array(out.lineCount).fill(-1); out.pcsOfLine.forEach((map, i) => { if (map) pcOfLine[i] = map[1]; });
          const modifiedLines = new Set(); out.methods.forEach(m => { if (m.modified || S.modified.has(m.key)) for (let n = m.startLine; n <= m.endLine; n++) modifiedLines.add(n); });
          d.java = { lines: out.text.split('\n'), language: 'java', pcOfLine, pcsOfLine: out.pcsOfLine, lineOfPc: out.lineOfPc, methodOfLine: out.methodOfLine, methods: out.methods, typeRefs: out.typeRefs ?? null, stats: out.stats, modifiedLines };
          d.javaWait = null;
          return d.java;
        }
        if (!force && (S.tab !== 'java' || !root.open)) throw Object.assign(new Error('the Java tab was left'), { code: 'left' });
        d.javaWait = { lines: [`// Decompiling… ${out.progress?.done ?? 0} of ${out.progress?.total ?? '?'} methods`], language: 'java' }; scheduleView();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    })().finally(() => { d.javaLoading = null; });
    return d.javaLoading;
  }
  function renderInfo() {
    const d = S.doc, i = d.info; if (!i) { info.replaceChildren(h('p', { text: 'Loading…' })); return; }
    const link = (descriptor) => h('button', { type: 'button', class: 'cb-link', text: dotted(descriptor), onclick: () => open(descriptor).catch(() => {}) });
    const rows = (pairs) => h('dl', { class: 'cb-dl' }, ...pairs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', {}, v)]));
    const methodRows = i.methods.map(m => h('tr', { class: m.modified ? 'is-modified' : '' }, h('td', {}, h('button', { type: 'button', class: 'cb-link', text: `${m.name}${m.signature}`, onclick: () => { setTab('smali'); revealMethod(m.name, m.signature); } })),
      h('td', { text: m.flags }), h('td', { text: m.hasCode ? `${m.units} units, ${m.registers} regs${m.tries ? `, ${m.tries} tries` : ''}` : m.native ? 'native' : 'abstract' }), h('td', { text: m.modified ? `modified (${m.modified})` : '' })));
    info.replaceChildren(
      rows([['Class', `${i.flags} ${i.name}`], ['Superclass', i.superclass ? link(i.superclass) : '—'], ['Interfaces', i.interfaces.length ? h('span', {}, ...i.interfaces.flatMap((x, k) => [k ? ', ' : '', link(x)])) : '—'],
        ['Source file', i.source ?? '—'], ['DEX file', `${i.file}${i.framework ? ' (framework)' : i.dynamic ? ' (loaded at run time)' : ''}`], ['Annotations', i.annotations.length ? i.annotations.join('\n') : '—']]),
      h('h4', { text: `Fields (${i.fields.length})` }),
      h('table', { class: 'cb-table' }, h('tbody', {}, ...i.fields.map(f => h('tr', {}, h('td', { text: `${f.name}:${f.type}` }), h('td', { text: f.flags }), h('td', { text: f.value ?? '' }))))),
      h('h4', { text: `Methods (${i.methods.length})` }),
      h('table', { class: 'cb-table' }, h('tbody', {}, ...methodRows)));
  }
  function revealMethod(name, signature, pc = null) {
    const d = S.doc; if (!d?.smali) return false;
    if (S.tab === 'java' && d.java) {
      const m = d.java.methods.find(x => x.name === name && (!signature || x.signature === signature)); if (!m) return false;
      const line = pc !== null && pc !== undefined ? javaLineOfPc(d.java, m.key, pc) : null;
      reveal(line ?? m.startLine); return true;
    }
    const m = d.smali.methods.find(x => x.name === name && (!signature || x.signature === signature)); if (!m) return false;
    let line = m.startLine;
    if (pc !== null && pc !== undefined) { const hit = m.pcToLine.find(([p]) => p === pc); if (hit) line = hit[1]; }
    reveal(line); return true;
  }
  /** The Java line (0-based) of `pc` in method `key`: its own line, else the line of the closest pc before it (a jump or a constant the Java text folded away). */
  function javaLineOfPc(j, key, pc) {
    const map = j.lineOfPc?.[key]; if (!map) return null;
    if (map[pc] !== undefined) return map[pc];
    let best = -1; for (const p of Object.keys(map)) { const n = Number(p); if (n <= pc && n > best) best = n; }
    return best >= 0 ? map[best] : null;
  }
  /** Scrolls 0-based line `n` into view (a third from the top) and selects it. */
  function reveal(n) {
    const t = currentText(); if (!t) return;
    n = Math.max(0, Math.min(t.lines.length - 1, n));
    viewSpacer.style.height = `${t.lines.length * LINE_H + 8}px`;   // the scroll range before the first paint of this document
    const height = view.clientHeight || 400, top = n * LINE_H;
    if (top < view.scrollTop || top > view.scrollTop + height - LINE_H * 2) view.scrollTop = Math.max(0, top - Math.round(height / 3));
    S.selection = { line: n }; updateEditButton(); scheduleView();
  }

  // ---- opening ------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** Opens a class (descriptor or dotted name) or an APK file (a path with a '/' or an extension); `method`, `pc`, `field`, `line` (0-based) place the view. */
  async function open(target, { method = null, pc = null, field = null, line = null, tab = null, push = true } = {}) {
    if (!S.attached) throw Object.assign(new Error('No APK is running.'), { code: 'no-apk' });
    const text = String(target ?? '').trim(); if (!text) throw new Error('open: name a class or a file');
    const isClass = text.startsWith('L') && text.endsWith(';') || (!text.includes('/') && /^[\w$]+(?:\.[\w$]+)+$/.test(text) && !/\.(xml|txt|json|png|jpg|webp|dex|arsc|so|properties|html|js|css)$/i.test(text));
    const descriptor = isClass ? (text.startsWith('L') ? text : `L${text.replaceAll('.', '/')};`) : null;
    if (push && S.doc) S.history.push({ target: S.doc.kind === 'class' ? S.doc.descriptor : S.doc.path, line: S.selection.line, tab: S.tab });
    if (S.history.length > 100) S.history.shift();
    root.open = true; closeEditor(true);
    if (descriptor) {
      const known = S.doc?.kind === 'class' && S.doc.descriptor === descriptor ? S.doc : null;
      if (!known) {
        title.textContent = dotted(descriptor); meta.textContent = 'Reading…';
        const out = await vm.codeService('disassemble', { descriptor });
        S.doc = { kind: 'class', descriptor: out.descriptor, name: out.name, file: out.file, framework: out.framework, smali: { lines: out.text.split('\n'), language: 'smali', pcOfLine: out.pcOfLine, methodOfLine: out.methodOfLine, methods: out.methods }, java: null, info: null };
        markModifiedLines();
        vm.codeService('class-info', { descriptor: out.descriptor }).then(i => { if (S.doc?.descriptor === out.descriptor) { S.doc.info = i; if (S.tab === 'info') renderInfo(); } }).catch(() => {});
        S.markers.clear();
      }
      const wantTab = tab ?? (S.tab === 'info' ? 'smali' : S.tab);
      S.tab = wantTab === 'java' || wantTab === 'info' ? wantTab : 'smali';
      if (S.tab !== 'smali') { try { await setTab(S.tab, { keep: true }); } catch (error) { if (error?.code === 'left') return S.doc; S.tab = 'smali'; showStage('view'); renderHead(); setNote(`Java view: ${error?.message ?? error}`); } }
      else { showStage('view'); renderHead(); }
      view.scrollTop = 0; S.selection = { line: -1 };
      if (method && S.tab !== 'info') revealMethod(method.name ?? String(method), method.signature ?? null, pc);
      else if (field && S.tab === 'smali') { const n = S.doc.smali.lines.findIndex(l => l.startsWith('.field ') && l.includes(` ${field}:`)); if (n >= 0) reveal(n); }
      else if (field && S.tab === 'java') { const n = S.doc.java?.lines.findIndex(l => /^ {4}\S/.test(l) && new RegExp(`\\b${field.replace(/[$]/g, '\\$')}( =|;)`).test(l)) ?? -1; if (n >= 0) reveal(n); }
      else if (line !== null) reveal(line);
      scheduleView(); renderHead(); notifyOpen();
      return S.doc;
    }
    title.textContent = text; meta.textContent = 'Reading…';
    const file = await vm.codeService('read-file', { path: text });
    S.doc = { kind: 'file', path: file.path, size: file.size, edited: file.edited, editable: file.editable, refusal: file.refusal, fileKind: file.kind,
      file: { lines: (file.text ?? '').split('\n'), language: file.kind === 'xml' ? 'xml' : file.kind === 'hex' ? 'hex' : file.path.endsWith('.xml') || file.path.endsWith('.html') ? 'xml' : 'text' } };
    S.markers.clear(); S.selection = { line: -1 };
    if (file.kind === 'image') {
      const url = URL.createObjectURL(new Blob([file.bytes], { type: file.mime }));
      image.replaceChildren(h('img', { src: url, alt: file.path, onload: () => URL.revokeObjectURL(url) }), h('p', { class: 'cb-image-meta', text: `${file.mime}, ${sizeText(file.size)}` }));
      showStage('image');
    } else { showStage('view'); view.scrollTop = 0; if (line !== null) reveal(line); scheduleView(); }
    renderHead(); notifyOpen();
    return S.doc;
  }
  function notifyOpen() { const sel = selection(); for (const fn of S.openListeners) { try { fn(sel); } catch { /* a listener's failure stays its own */ } } }
  backButton.addEventListener('click', () => back());
  async function back() { const last = S.history.pop(); if (!last) return; await open(last.target, { line: last.line >= 0 ? last.line : null, tab: last.tab, push: false }).catch(error => setNote(error.message)); }
  root.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'f' && !editPane.contains(event.target)) { event.preventDefault(); openFind(); }
    else if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); back(); }
    else if (event.key === 'Escape' && !findBar.hidden && findBar.contains(event.target)) { event.preventDefault(); closeFind(); }
  });
  function markModifiedLines() {
    const d = S.doc; if (!d || d.kind !== 'class') return;
    const lines = new Set();
    for (const m of d.smali.methods) if (S.modified.has(m.key) || m.modified) for (let n = m.startLine; n <= m.endLine; n++) lines.add(n);
    d.smali.modifiedLines = lines;
  }

  // ---- find in file -----------------------------------------------------------------------------------------------------------------------------------------------------
  findButton.addEventListener('click', () => openFind());
  function openFind() { findBar.hidden = false; findInput.focus(); findInput.select(); }
  function closeFind(keepOpen = false) { if (!keepOpen) findBar.hidden = true; S.find = { query: '', hits: [], at: -1, hitsByLine: null }; findCount.textContent = ''; if (!keepOpen) findInput.value = ''; else if (findInput.value) runFind(findInput.value); scheduleView(); }
  let findTimer = null;
  findInput.addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(() => runFind(findInput.value), 120); });
  findInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); findStep(event.shiftKey ? -1 : 1); } });
  function runFind(text) {
    const t = currentText(); S.find = { query: text, hits: [], at: -1, hitsByLine: new Map() };
    if (!t || !text) { findCount.textContent = ''; scheduleView(); return; }
    const needle = text.toLowerCase();
    for (let n = 0; n < t.lines.length && S.find.hits.length < 10000; n++) {
      const hay = t.lines[n].toLowerCase(); let at = hay.indexOf(needle);
      while (at >= 0) { S.find.hits.push([n, at, at + needle.length]); at = hay.indexOf(needle, at + needle.length); }
    }
    findStep(1, true);
  }
  function findStep(delta, fromStart = false) {
    const f = S.find; if (!f.hits.length) { findCount.textContent = f.query ? 'No matches' : ''; f.hitsByLine = new Map(); scheduleView(); return; }
    if (fromStart) { const from = Math.max(0, Math.floor((view.scrollTop || 0) / LINE_H)); f.at = f.hits.findIndex(([n]) => n >= from); if (f.at < 0) f.at = 0; }
    else f.at = (f.at + delta + f.hits.length) % f.hits.length;
    f.hitsByLine = new Map();
    for (let i = 0; i < f.hits.length; i++) { const [n, s, e] = f.hits[i]; let list = f.hitsByLine.get(n); if (!list) f.hitsByLine.set(n, list = []); list.push([s, e, i === f.at]); }
    findCount.textContent = `${f.at + 1} of ${f.hits.length}${f.hits.length >= 10000 ? '+' : ''}`;
    reveal(f.hits[f.at][0]);
  }

  // ---- editing -----------------------------------------------------------------------------------------------------------------------------------------------------------
  editButton.addEventListener('click', () => { startEdit().catch(error => setNote(error.message)); });
  revertButton.addEventListener('click', () => { revertCurrent().catch(error => setNote(error.message)); });
  cancelButton.addEventListener('click', () => closeEditor());
  applyButton.addEventListener('click', () => { applyEdit().catch(error => showErrors([{ line: 0, column: 1, message: error.message }])); });
  diffButton.addEventListener('click', () => { const on = diffButton.getAttribute('aria-pressed') !== 'true'; diffButton.setAttribute('aria-pressed', String(on)); renderDiff(); });
  async function startEdit(target = null) {
    const d = S.doc; if (!d) return;
    if (d.kind === 'file') {
      if (!d.editable) throw new Error(`${d.path} cannot be edited: ${d.refusal}`);
      const original = S.fileEdits.has(d.path) || d.edited ? (await vm.codeService('read-file', { path: d.path, original: true })).text : d.file.lines.join('\n');
      S.edit = { kind: 'file', path: d.path, original, start: d.file.lines.join('\n') };
      editTitle.textContent = d.path;
      editNote.textContent = 'The app reads the edited file the next time it opens it (AssetManager, Resources.openRawResource, ClassLoader.getResource). Data it already read stays as it was: reload the Activity or reopen the APK to see it everywhere. The change is listed as "App modified" and is applied again when the APK is reopened.';
      editor.setLanguage('text');
    } else {
      const m = target ?? methodForEdit(); if (!m) throw new Error('Click a line of the method to edit first.');
      if (d.framework) throw new Error('Framework methods cannot take a new body here (a fixed return or observed calls are made by plugins).');
      const out = await vm.codeService('disassemble', { descriptor: d.descriptor, method: { name: m.name, signature: m.signature } });
      const mod = S.modified.get(m.key);
      S.edit = { kind: 'method', key: m.key, name: m.name, signature: m.signature, original: out.method.text, start: mod?.text ?? out.method.text };
      editTitle.textContent = `${d.name}.${m.name}${m.signature}`;
      editNote.textContent = 'Apply replaces the body of this method in the running app from its next call (a smali body, as a plugin\'s lab.hook makes it): it is checked first, listed as "App modified", counted, recorded in the trace and removable with Revert. Debug lines (.line, .local) are not kept.';
      editor.setLanguage('smali');
    }
    editor.setValue(S.edit.start); diffButton.setAttribute('aria-pressed', 'false'); diffPane.hidden = true; showErrors([]);
    showStage('edit'); editor.refresh(); editor.focus(); scheduleCheck();
  }
  function closeEditor(silent = false) {
    if (!S.edit) { if (!silent && S.doc) showStage(S.doc.fileKind === 'image' ? 'image' : S.tab === 'info' ? 'info' : 'view'); return; }
    S.edit = null; clearTimeout(S.checkTimer);
    if (!silent) { showStage(S.doc?.fileKind === 'image' ? 'image' : S.tab === 'info' ? 'info' : 'view'); scheduleView(); }
  }
  function scheduleCheck() {
    clearTimeout(S.checkTimer); if (S.edit?.kind !== 'method') { renderDiff(); return; }
    S.checkTimer = setTimeout(async () => {
      const edit = S.edit, version = editor.version, text = editor.value; if (!edit || edit.kind !== 'method') return;
      try {
        const out = await vm.codeService('check-smali', { method: edit.key, smali: text });
        if (S.edit !== edit) return;
        const first = out.ok ? null : out.errors[0];
        editor.setError(first ? { line: first.line, col: first.column, message: first.message } : null, version);
        showErrors(out.ok ? [] : out.errors, out.ok ? `Checked: ${out.instructions} instructions, ${out.units} code units, ${out.registers} registers.` : null);
      } catch (error) { showErrors([{ line: 0, column: 1, message: error.message }]); }
    }, CHECK_MS);
    renderDiff();
  }
  function showErrors(errors, okText = null) {
    editErrors.hidden = !errors.length && !okText;
    editErrors.replaceChildren(...(errors.length ? errors.slice(0, 50).map(e => h('li', {}, h('button', { type: 'button', class: 'cb-link cb-error', text: `${e.line ? `${e.line}:${e.column}` : '—'}  ${e.message}`, onclick: () => { if (e.line) editor.reveal(e.line, e.column); } })))
      : okText ? [h('li', { class: 'cb-ok', text: okText })] : []));
  }
  function renderDiff() {
    const on = diffButton.getAttribute('aria-pressed') === 'true' && S.edit; diffPane.hidden = !on; if (!on) return;
    const diff = lineDiff(S.edit.original, editor.value, { limit: 1500 });
    const rows = diff.map(d => h('div', { class: `cb-diff-line cb-diff-${d.op === '+' ? 'add' : d.op === '-' ? 'del' : 'same'}` }, h('span', { class: 'cb-diff-ln', text: d.a ?? '' }), h('span', { class: 'cb-diff-ln', text: d.b ?? '' }), h('span', { class: 'cb-diff-op', text: d.op }), h('code', { text: d.text || ' ' })));
    diffPane.replaceChildren(h('p', { class: 'cb-diff-head', text: diff.changes ? `${diff.changes} changed line${diff.changes === 1 ? '' : 's'} (original ← → modified)${diff.truncated ? '; too long to align, shown as removed then added' : ''}` : 'No change from the original.' }), ...rows);
  }
  async function applyEdit() {
    const edit = S.edit; if (!edit) return;
    const text = editor.value;
    if (edit.kind === 'file') {
      const out = await vm.codeService('edit-file', { path: edit.path, text, by: CODE_BROWSER.name });
      S.fileEdits.set(edit.path, text); fileEditsOf(S.packageName).set(edit.path, text);
      hooks?.setFiles?.(out.edits); trace(`Code browser: app modified, ${edit.path} edited (${out.edit?.bytes ?? text.length} bytes): the app reads it from its next read`);
      markFileEdited(edit.path, true);
      closeEditor(); await open(edit.path, { push: false }); return;
    }
    applyButton.disabled = true;
    try {
      const previous = S.modified.get(edit.key);
      let hook;
      try { hook = await hooks.add(CODE_BROWSER, { method: edit.key, kind: 'smali', smali: text, persist: true }); }
      catch (error) {
        const errors = Array.isArray(error.errors) && error.errors.length ? error.errors.map(e => ({ line: e.line ?? 0, column: e.column ?? columnOf(text, e), message: e.message })) : [{ line: 0, column: 1, message: error.message }];
        const first = errors[0]; if (first.line) editor.setError({ line: first.line, col: first.column, message: first.message });
        showErrors(errors); return;
      }
      if (previous && previous.hookId !== hook.id) hooks.forget?.(previous.hookId);
      S.modified.set(edit.key, { text, original: edit.original, hookId: hook.id, packageName: S.packageName });
      const d = S.doc; if (d?.kind === 'class') { const m = d.smali.methods.find(x => x.key === edit.key); if (m) m.modified = 'smali'; markModifiedLines(); }
      closeEditor(); renderHead(); rebuildTree().catch(() => {});
    } finally { applyButton.disabled = false; }
  }
  const columnOf = (text, e) => { const line = String(text).split('\n')[(e.line ?? 1) - 1] ?? ''; const first = line.search(/\S/); return first < 0 ? 1 : first + 1; };
  async function revertCurrent() {
    const d = S.doc; if (!d) return;
    if (d.kind === 'file') { await revertFile(d.path); await open(d.path, { push: false }); return; }
    const m = methodForEdit(); if (!m) return;
    await revertMethod(m.key);
  }
  async function revertMethod(key) {
    const mod = S.modified.get(key);
    if (mod) await hooks.remove(mod.hookId);
    S.modified.delete(key);
    trace(`Code browser: the original body of ${key} restored`);
    const d = S.doc; if (d?.kind === 'class') { const m = d.smali.methods.find(x => x.key === key); if (m) m.modified = null; markModifiedLines(); }
    renderHead(); scheduleView(); rebuildTree().catch(() => {});
  }
  async function revertFile(path) {
    const out = await vm.codeService('revert-file', { path });
    S.fileEdits.delete(path); fileEditsOf(S.packageName).delete(path); hooks?.setFiles?.(out.edits); markFileEdited(path, false);
    trace(`Code browser: ${path} restored to the APK's bytes`);
    if (S.doc?.kind === 'file' && S.doc.path === path) S.doc.edited = false;
    renderHead(); return out;
  }
  function markFileEdited(path, on) { const f = S.files?.find(x => x.path === path); if (f) f.edited = on; scheduleList(); }
  // file edits are kept per package for this page session and applied again when the APK is opened again
  const editsByPackage = new Map();
  const fileEditsOf = pkg => { let m = editsByPackage.get(pkg ?? ''); if (!m) editsByPackage.set(pkg ?? '', m = new Map()); return m; };

  // ---- lifecycle --------------------------------------------------------------------------------------------------------------------------------------------------------
  function setCount(text) { if (countNode) countNode.textContent = text; }
  async function attach(inventory) {
    S.attached = true; S.packageName = inventory?.packageName ?? getPackage() ?? null;
    S.treeLoaded.clear(); S.tree = []; S.files = null; S.doc = null; S.history = []; S.search = null; S.fileEdits = new Map();
    // the method edits of this package came back with the persistent changes (src/method-hooks-panel.js attach); the ones of another package are not in effect
    for (const [key, mod] of S.modified) if (mod.packageName !== S.packageName) S.modified.delete(key);
    const reapplied = [];
    for (const [path, text] of fileEditsOf(S.packageName)) {
      try { const out = await vm.codeService('edit-file', { path, text, by: CODE_BROWSER.name }); hooks?.setFiles?.(out.edits); S.fileEdits.set(path, text); reapplied.push(path); }
      catch (error) { trace(`Code browser: the edit of ${path} was not applied again: ${error?.message ?? error}`); fileEditsOf(S.packageName).delete(path); }
    }
    if (reapplied.length) trace(`Code browser: ${reapplied.length} edited file${reapplied.length === 1 ? '' : 's'} applied again before the app started (${reapplied.join(', ')})`);
    const classes = inventory?.classCount ?? inventory?.classes ?? null;
    setCount(typeof classes === 'number' ? `${classes} classes` : 'ready');
    showStage('empty'); empty.firstChild.textContent = 'Search the app, or open a package on the left.'; empty.lastChild.textContent = 'Smali is exact (baksmali syntax); Java is decompiled from it (readable, not the original source). The debugger works on both.';
    renderHead();
    if (root.open) await init();
  }
  async function init() { if (!S.attached) return; S.inited = true; try { await rebuildTree(); if (S.side === 'files') await loadFiles(); } catch (error) { setSideStatus(error.message); } }
  // the tool's work runs while it is open: on opening, the class tree of a new APK is read, a file someone else edited meanwhile is read again, and the rows are painted
  root.addEventListener('toggle', () => {
    if (!root.open) {
      if (S.javaUsed && !debugging()) {   // nothing of the Java view is kept for a closed tool: the Worker forgets its classes, the page its texts
        S.javaUsed = false; if (S.doc?.kind === 'class') { S.doc.java = null; S.doc.javaWait = null; }
        if (S.attached) vm.codeService('decompile-drop').catch(() => {});
      }
      return;
    }
    if (S.attached && !S.tree.length) init();
    if (S.doc?.kind === 'class' && S.tab === 'java' && !S.doc.java && !S.edit) setTab('java', { keep: true }).catch(() => {});
    if (S.stale) { S.stale = false; if (S.doc?.kind === 'file' && !S.edit) open(S.doc.path, { push: false }).catch(() => {}); }
    scheduleList(); scheduleView(); editor.refresh();
  });
  function vmEnded() {
    S.attached = false; S.doc = null; S.tree = []; S.files = null; S.search = null; S.treeLoaded.clear(); closeEditor(true);
    setCount('no app'); showStage('empty'); empty.firstChild.textContent = 'Open an APK to read its code.'; renderHead(); scheduleList();
  }
  showStage('empty'); renderHead(); setCount('no app');

  // ---- the surface for src/code-browser-api.js ---------------------------------------------------------------------------------------------------------------------------
  function selection() {
    const d = S.doc; if (!d) return null;
    const t = currentText(), n = S.selection.line, m = methodAtLine(n >= 0 ? n : 0);
    return { kind: d.kind, descriptor: d.descriptor ?? null, path: d.path ?? null, tab: d.kind === 'class' ? S.tab : 'file', line: n >= 0 ? n + 1 : null, pc: n >= 0 && t?.pcOfLine ? (t.pcOfLine[n] >= 0 ? t.pcOfLine[n] : null) : null,
      method: n >= 0 && m ? { key: m.key, name: m.name, signature: m.signature } : null, text: n >= 0 && t ? t.lines[n] : null, selectedText: win?.getSelection?.()?.toString?.() || '' };
  }
  return {
    open, back, reveal, revealMethod, attach, vmEnded, startEdit, revertMethod, revertFile, setTab, selection,
    setMarkers(markers) { S.markers = new Map((markers ?? []).filter(m => Number.isInteger(m?.line) && m.line >= 1).map(m => [m.line - 1, String(m.kind ?? 'mark').replace(/[^\w-]/g, '').slice(0, 32) || 'mark'])); scheduleView(); },
    onGutterClick(fn) { S.gutterListeners.add(fn); return () => S.gutterListeners.delete(fn); },
    onOpen(fn) { S.openListeners.add(fn); return () => S.openListeners.delete(fn); },
    /**
     * The document on screen, for the API: { kind, descriptor, path, tab, lineCount, methods: [{ key, name, signature, startLine, endLine, pcToLine }] } (lines 1-based). On the
     * Java tab the lines are the Java view's: pcToLine has every pc a Java line covers.
     */
    document() {
      const d = S.doc; if (!d) return null; const t = currentText();
      const java = d.kind === 'class' && S.tab === 'java' && d.java ? d.java : null;
      const methods = java ? java.methods.map(m => ({ key: m.key, name: m.name, signature: m.signature, startLine: m.startLine + 1, endLine: m.endLine + 1, hasCode: m.hasCode, modified: S.modified.has(m.key) || !!m.modified,
          pcToLine: Object.entries(java.lineOfPc[m.key] ?? {}).map(([pc, line]) => [Number(pc), line + 1]).sort((a, b) => a[0] - b[0]) }))
        : d.kind === 'class' && d.smali && S.tab !== 'java' ? d.smali.methods.map(m => ({ key: m.key, name: m.name, signature: m.signature, startLine: m.startLine + 1, endLine: m.endLine + 1, hasCode: m.hasCode, modified: S.modified.has(m.key) || !!m.modified, pcToLine: m.pcToLine.map(([pc, line]) => [pc, line + 1]) })) : [];
      return { kind: d.kind, descriptor: d.descriptor ?? null, path: d.path ?? null, tab: d.kind === 'class' ? S.tab : 'file', lineCount: t?.lines.length ?? 0, methods };
    },
    /** { key, pc, line } where a breakpoint on 1-based `line` goes: the Java line's first pc, or the smali instruction on (or after, in the same method) that line; null elsewhere. */
    locationAt(line) {
      const d = S.doc; if (!d || d.kind !== 'class') return null;
      if (S.tab === 'java') { const map = d.java?.pcsOfLine?.[line - 1]; return map ? { key: map[0], pc: map[1], line } : null; }
      if (S.tab !== 'smali') return null;
      for (const m of d.smali.methods) { if (line < m.startLine + 1 || line > m.endLine + 1 || !m.hasCode) continue; const hit = m.pcToLine.find(([, l]) => l + 1 >= line); return hit ? { key: m.key, pc: hit[0], line: hit[1] + 1 } : null; }
      return null;
    },
    /** The Java statement around `pc` of method `key` when the Java view of its class is on screen: { line, pcs, stops } (stops: the first pc of every Java line of the method), else null. */
    javaStatement(key, pc) {
      const d = S.doc, j = d?.kind === 'class' && S.tab === 'java' ? d.java : null; if (!j || !key?.startsWith(`${d.descriptor}->`)) return null;
      const line = javaLineOfPc(j, key, Number(pc)); if (line === null) return null;
      const stops = [...new Set(Object.values(j.lineOfPc[key] ?? {}))].map(l => j.pcsOfLine[l]?.[1]).filter(p => p !== undefined);
      return { line: line + 1, pcs: j.pcsOfLine[line].slice(2), stops };
    },
    /** Loads the decompiler in the Worker ahead of a stop (a debugger attached while the user reads Java: the Worker cannot import it while a thread is held). */
    prepareJava() { if (S.tab === 'java' && S.attached) return vm.codeService('decompile-load').catch(() => null); return Promise.resolve(null); },
    /** The line of `pc` in method `key` on the open tab (1-based), the closest earlier pc's line when it has none. */
    lineForPc(key, pc) {
      const d = S.doc; if (!d || d.kind !== 'class') return null;
      if (S.tab === 'java') { const n = d.java ? javaLineOfPc(d.java, key, Number(pc)) : null; return n === null ? null : n + 1; }
      const m = d.smali?.methods.find(x => x.key === key); if (!m) return null;
      let best = null; for (const [p, l] of m.pcToLine) { if (p === Number(pc)) return l + 1; if (p < Number(pc)) best = l + 1; }
      return best;
    },
    lineText(line) { const t = currentText(); return t?.lines[line - 1] ?? null; },
    /** An APK file edited or restored by someone else (a plugin's lab.code.editFile, MCP code_edit_file): its badge, and the open file read again. */
    noteFileEdit(path, edited) { markFileEdited(path, !!edited); if (S.doc?.kind === 'file' && S.doc.path === path && !S.edit) { if (root.open) open(path, { push: false }).catch(() => {}); else S.stale = true; } },
    get state() { return S; },
    get root() { return root; },
  };
}
