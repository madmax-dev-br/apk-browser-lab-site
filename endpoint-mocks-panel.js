// The "Endpoint mocks" section of the Controls panel (src/endpoint-mocks.js): the list of mocked endpoints of the open package, one line each (switch, method, URL pattern,
// status, hits; details on expand; Edit / Duplicate / Move / Remove in the row's menu), the dialog that configures one mock, and export / import as JSON. The list is kept per
// package in localStorage, large bodies in IndexedDB (src/mock-body-store.js); every access guarded, a failed save is said. Applied live to the Worker; hit counts come back
// with every snapshot.
//
// Responsiveness (a large pasted body froze the page, 2026-11-21): the body editor (src/code-editor.js) checks JSON in slices after a pause in typing and keeps a text of
// many megabytes out of the textarea; the dialog's own validation never encodes or parses the body (validateMock checkBody false); the list caches each mock's validation
// (a snapshot arrives many times a second); storage is written after a pause, and a large body only when it changed.
import { MOCK_METHODS, MAX_MOCKS, MAX_BODY_BYTES, defaultMock, normalizeMock, validateMock, loadMocks, saveMocks, exportMocks, importMocks, bytesToBase64, mockLabel } from './endpoint-mocks.js?v=8afe13eb0890';
import { createCodeEditor, formatBytes } from './code-editor.js?v=8afe13eb0890';
import { createBodyStore, splitForStorage } from './mock-body-store.js?v=8afe13eb0890';
import { listRow, detailList } from './list-rows.js?v=8afe13eb0890';
import { checkJson } from './json-tools.js?v=8afe13eb0890';

const FIELD_ERROR = { method: 'em-err-method', url: 'em-err-url', query: 'em-err-query', status: 'em-err-status', reason: 'em-err-status', headers: 'em-err-headers', body: 'em-err-body', delayMs: 'em-err-delay' };
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const SAVE_DELAY_MS = 300;
const pad = value => String(value).padStart(2, '0');
const stamp = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
/** mocks-<package>-<timestamp>.json */
export const mocksFileName = (packageName, date = new Date()) => `mocks-${String(packageName || 'app').replace(/[^A-Za-z0-9._-]+/g, '_')}-${stamp(date)}.json`;

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** A file's bytes as the mock body: UTF-8 text goes into the editor, anything else (a .gz, an image) is kept as bytes. */
export function bodyFromFile(name, bytes) {
  if (bytes.length > MAX_BODY_BYTES) return { error: `The file is larger than ${MAX_BODY_BYTES / 1048576} MiB.` };
  let text = null; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = null; }
  if (text !== null && !text.includes('\0')) return { body: text, bodyBase64: null, bodyFile: name };
  return { body: '', bodyBase64: bytesToBase64(bytes), bodyFile: name, bytes: bytes.length };
}
/** Header rows as a JSON object (the headers editor's JSON view) and back. A repeated name becomes an array of values. */
export function headersToJson(rows) {
  const out = {};
  for (const { name, value } of rows) { if (!name.trim() && !value.trim()) continue; const key = name.trim(); if (key in out) out[key] = [].concat(out[key], value); else out[key] = value; }
  return JSON.stringify(out, null, 2);
}
export function headersFromJson(text) {
  const checked = checkJson(text); if (!checked.valid) return { error: checked.error };
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: { line: 1, col: 1, message: 'Write an object: {"Header-Name": "value"}' } };
  const rows = [];
  for (const [name, value] of Object.entries(data)) for (const item of Array.isArray(value) ? value : [value]) rows.push({ name, value: typeof item === 'string' ? item : JSON.stringify(item) });
  return { rows };
}
const isJsonType = contentType => /json/i.test(contentType);

export function createEndpointMocksPanel({ $, vm, save = download, bodyStore = createBodyStore() }) {
  const S = { pkg: null, mocks: [], statuses: new Map(), hits: new Map(), sequence: 0, timer: null, saveTimer: null, editing: null, draft: null, opener: null, touched: new Set(), submitted: false,
    expanded: new Set(), checks: new WeakMap(), savedBodies: new Map(), storageNote: '', headersJson: false };
  const doc = $('em-list').ownerDocument ?? document;
  const el = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  /** The list's validation of a mock, cached per mock object (a mock is replaced, never mutated, when edited; `enabled` does not change the result). */
  const checkOf = mock => { let result = S.checks.get(mock); if (!result) { result = validateMock(mock, { checkBody: false }); S.checks.set(mock, result); } return result; };
  const isActive = mock => mock.enabled && !checkOf(mock).errors.length && S.statuses.get(mock.id)?.state !== 'invalid';

  // ---- the list -------------------------------------------------------------------------------------------------------------------------------------------------------------
  function problem(mock) {
    const status = S.statuses.get(mock.id);
    if (status?.state === 'invalid') return status.error;
    const errors = checkOf(mock).errors; return errors.length ? errors.map(e => e.message).join(' ') : '';
  }
  const hitsOf = mock => S.hits.get(mock.id) ?? S.statuses.get(mock.id)?.hits ?? 0;
  const headerCount = mock => { const n = mock.headers.filter(h => h.name.trim()).length; return `${n} ${n === 1 ? 'header' : 'headers'}`; };
  const hitText = hits => `${hits} ${hits === 1 ? 'hit' : 'hits'}`;
  function details(mock) {
    const bytes = mock.bodyBase64 ? Math.floor(mock.bodyBase64.length * 3 / 4) : checkOf(mock).bodyBytes ?? 0, error = problem(mock);
    const rows = detailList(doc, [
      ['Name', mock.name],
      ['Matches', `${mock.method === 'ANY' ? 'Any method' : mock.method} ${mock.url || '(no URL)'}${mock.query === 'exact' ? ', exact query' : ''}${mock.bodyContains ? `, body contains "${mock.bodyContains.slice(0, 60)}"` : ''}`],
      ['Answers', `${mock.status}${mock.reason ? ` ${mock.reason}` : ''}, ${headerCount(mock)}, ${bytes ? formatBytes(bytes) : 'empty'} body${mock.bodyFile ? ` (${mock.bodyFile})` : ''}${Number(mock.delayMs) > 0 ? `, after ${mock.delayMs} ms` : ''}`],
      ['Used', `${hitText(hitsOf(mock))} since the app started`],
    ]);
    const nodes = [rows];
    if (error) { const note = el('p', 'lr-problem', error); note.dataset.state = 'error'; nodes.push(note); }
    const edit = el('button', 'cp-button lr-edit', 'Edit mock'); edit.type = 'button'; edit.addEventListener('click', event => openDialog(mock, event.currentTarget));
    nodes.push(edit);
    return nodes;
  }
  function row(mock, index) {
    const n = index + 1, label = `mock ${n}: ${mockLabel(mock)}`, error = problem(mock);
    const method = el('b', 'lr-tag em-method', mock.method), url = el('code', 'lr-text em-url', mock.url || '(no URL)');
    if (mock.name) url.title = mock.name;
    const code = el('span', 'lr-code em-code', String(mock.status)); code.title = 'Response status';
    const hits = el('span', 'lr-count em-hits', String(hitsOf(mock))); hits.title = hitText(hitsOf(mock)); hits.hidden = !hitsOf(mock);
    const state = el('span', 'lr-dot em-meta'); state.dataset.state = error ? 'error' : isActive(mock) ? 'ok' : '';
    state.textContent = error ? '!' : ''; state.title = error || (mock.enabled ? 'Active' : 'Off'); state.setAttribute('role', 'status');
    const li = listRow({
      doc, key: `em-${mock.id}`, label, switchLabel: `Turn on ${label}`, checked: mock.enabled, state: error ? 'error' : '',
      onToggle: on => { mock.enabled = on; changed(); },
      main: [method, url], trail: [code, hits, state], expanded: S.expanded.has(mock.id),
      onExpand: open => { if (open) S.expanded.add(mock.id); else S.expanded.delete(mock.id); },
      details: () => details(mock),
      menu: () => [
        { label: 'Edit…', run: () => openDialog(mock, li.querySelector('.lr-more')) },
        { label: 'Duplicate', run: () => duplicate(index), disabled: S.mocks.length >= MAX_MOCKS },
        { label: 'Move up', run: () => move(index, -1), disabled: index === 0 },
        { label: 'Move down', run: () => move(index, 1), disabled: index === S.mocks.length - 1 },
        { label: 'Remove', danger: true, run: () => remove(index) },
      ],
    });
    li.classList.add('em-row'); li.dataset.id = mock.id;
    return li;
  }
  function updateMeta() {
    [...$('em-list').children].forEach((li, index) => {
      const mock = S.mocks[index]; if (!mock) return;
      const hits = li.querySelector('.em-hits'), count = hitsOf(mock); if (hits && hits.textContent !== String(count)) { hits.textContent = String(count); hits.title = hitText(count); } if (hits) hits.hidden = !count;
      const error = problem(mock), state = li.querySelector('.em-meta');
      if (state) { state.dataset.state = error ? 'error' : isActive(mock) ? 'ok' : ''; state.textContent = error ? '!' : ''; state.title = error || (mock.enabled ? 'Active' : 'Off'); }
      li.dataset.state = error ? 'error' : '';
    });
    const active = S.mocks.filter(isActive), hits = active.reduce((sum, mock) => sum + hitsOf(mock), 0);
    $('em-summary').textContent = `${active.length} active`;
    $('em-status').textContent = S.storageNote || (!S.mocks.length ? (S.pkg ? 'No mocks yet. A mock answers a matching request of the app with a response you write, without the network.' : 'Open an APK: mocks are kept per app.')
      : active.length ? (hits ? `${hits} ${hits === 1 ? 'request' : 'requests'} answered by mocks.` : '') : 'No mock is on.');
    $('em-status').dataset.empty = String(!S.mocks.length);
    $('em-list').hidden = !S.mocks.length;
    $('em-export').hidden = !S.mocks.length; $('em-export').disabled = !S.mocks.length;
  }
  function render() { $('em-list').replaceChildren(...S.mocks.map(row)); updateMeta(); }
  function move(index, by) {
    const to = index + by; if (to < 0 || to >= S.mocks.length) return;
    const [item] = S.mocks.splice(index, 1); S.mocks.splice(to, 0, item); render(); changed();
    $('em-list').children[to]?.querySelector('.lr-more')?.focus();
  }
  function duplicate(index) {
    if (S.mocks.length >= MAX_MOCKS) return;
    const copy = normalizeMock({ ...S.mocks[index], id: undefined, name: S.mocks[index].name ? `${S.mocks[index].name} (copy)` : '' });
    S.mocks.splice(index + 1, 0, copy); render(); changed(); $('em-list').children[index + 1]?.querySelector('.lr-main')?.focus();
  }
  function remove(index) {
    const [gone] = S.mocks.splice(index, 1); S.expanded.delete(gone?.id); render(); changed();
    ($('em-list').children[Math.min(index, S.mocks.length - 1)]?.querySelector('.lr-main') ?? $('em-add')).focus();
  }
  function changed() { scheduleSave(); updateMeta(); clearTimeout(S.timer); S.timer = setTimeout(apply, 0); }
  async function apply() {
    const token = ++S.sequence;
    try {
      const statuses = vm.worker ? await vm.setEndpointMocks(S.mocks.map(normalizeMock)) : [];
      if (token !== S.sequence) return;
      S.statuses = new Map(statuses.map(status => [status.id, status])); for (const status of statuses) S.hits.set(status.id, status.hits);
    } catch (error) { for (const mock of S.mocks) S.statuses.set(mock.id, { id: mock.id, state: 'invalid', error: `The VM did not apply it: ${error?.message ?? error}` }); }
    updateMeta();
  }

  // ---- storage --------------------------------------------------------------------------------------------------------------------------------------------------------------
  function scheduleSave() { clearTimeout(S.saveTimer); if (S.pkg) S.saveTimer = setTimeout(persist, SAVE_DELAY_MS); }
  async function persist() {
    S.saveTimer = null; const pkg = S.pkg; if (!pkg) return;
    const { stored, large } = bodyStore ? splitForStorage(S.mocks) : { stored: S.mocks, large: [] };
    let note = '';
    if (!saveMocks(pkg, stored)) note = 'The browser storage is full or unavailable: these mocks last until the page closes. Export them to keep them.';
    if (bodyStore) {
      try {
        for (const item of large) { const key = item.bodyBase64 ?? item.body; if (S.savedBodies.get(item.id) === key) continue; await bodyStore.put(pkg, item.id, item); S.savedBodies.set(item.id, key); }
        await bodyStore.keep(pkg, large.map(item => item.id));
      } catch (error) { note = `A large body could not be stored (${error?.message ?? error}): it lasts until the page closes. Export the mocks to keep them.`; }
    }
    if (pkg === S.pkg && note !== S.storageNote) { S.storageNote = note; updateMeta(); }
  }
  async function hydrate(pkg, mocks) {
    if (!bodyStore) return mocks;
    return Promise.all(mocks.map(async mock => {
      if (!mock.bodyRef) return mock;
      try { const stored = await bodyStore.get(pkg, mock.id); if (stored) { S.savedBodies.set(mock.id, stored.bodyBase64 ?? stored.body); return normalizeMock({ ...mock, body: stored.body, bodyBase64: stored.bodyBase64, bodyRef: false }); } } catch { /* reported by validateMock: the body is missing */ }
      return mock;
    }));
  }

  // ---- the dialog -----------------------------------------------------------------------------------------------------------------------------------------------------------
  const field = id => $(id);
  const contentType = () => (S.headersJson ? headersFromJson(headersEditor.value).rows ?? [] : headerRows()).find(h => h.name.trim().toLowerCase() === 'content-type')?.value ?? '';
  const bodyEditor = createCodeEditor({ $, id: 'em-body', language: 'json', label: 'body', onChange: () => { S.touched.add('body'); refreshDialog(); }, onStatus: () => refreshDialog() });
  const headersEditor = createCodeEditor({ $, id: 'em-headers-json', language: 'json', label: 'headers', onChange: () => { S.touched.add('headers'); refreshDialog(); } });
  function headerRow(row = { name: '', value: '' }) {
    const li = el('li', 'em-header'), list = $('em-headers'), n = () => [...list.children].indexOf(li) + 1;
    const name = el('input', 'em-header-name'); name.type = 'text'; name.value = row.name; name.placeholder = 'Name'; name.spellcheck = false; name.autocomplete = 'off'; name.setAttribute('aria-label', 'Header name');
    const value = el('input', 'em-header-value'); value.type = 'text'; value.value = row.value; value.placeholder = 'Value'; value.spellcheck = false; value.autocomplete = 'off'; value.setAttribute('aria-label', 'Header value');
    const remove = el('button', 'cp-button em-header-remove', '×'); remove.type = 'button';
    remove.addEventListener('click', () => { const next = li.nextElementSibling ?? li.previousElementSibling; li.remove(); S.touched.add('headers'); refreshDialog(); (next?.querySelector('input') ?? $('em-header-add')).focus(); });
    for (const input of [name, value]) input.addEventListener('input', () => { S.touched.add('headers'); refreshDialog(); });
    li.append(name, value, remove); list.append(li);
    remove.setAttribute('aria-label', `Remove header ${n()}`);
    return li;
  }
  const headerRows = () => [...$('em-headers').children].map(li => ({ name: li.querySelector('.em-header-name').value, value: li.querySelector('.em-header-value').value }));
  /** Switches the headers between rows and a JSON object; false (and a message) when the JSON cannot become rows. */
  function setHeadersJson(on) {
    if (on === S.headersJson) return true;
    if (on) headersEditor.setValue(headersToJson(headerRows()), { silent: true });
    else {
      const parsed = headersFromJson(headersEditor.value);
      if (parsed.error) { $('em-err-headers').textContent = `Fix the JSON to go back to rows: line ${parsed.error.line}, column ${parsed.error.col}: ${parsed.error.message}`; $('em-err-headers').hidden = false; return false; }
      $('em-headers').replaceChildren(); for (const item of parsed.rows) headerRow(item);
    }
    S.headersJson = on; $('em-headers').hidden = on; $('em-header-add').hidden = on; $('em-headers-json-box').hidden = !on;
    $('em-headers-mode').textContent = on ? 'Edit as rows' : 'Edit as JSON'; $('em-headers-mode').setAttribute('aria-pressed', String(on));
    if (on) headersEditor.refresh(); refreshDialog(); return true;
  }
  /** The mock the dialog describes. The body is the editor's text as is (never copied or encoded here). */
  function collect() {
    const draft = S.draft, parsed = S.headersJson ? headersFromJson(headersEditor.value) : null;
    return normalizeMock({
      ...draft, name: field('em-name').value, method: field('em-method').value, url: field('em-url').value, query: field('em-query').value, bodyContains: field('em-body-contains').value,
      status: field('em-status-code').value, reason: field('em-reason').value, delayMs: field('em-delay').value,
      headers: parsed ? parsed.rows ?? draft.headers : headerRows(),
      body: draft.bodyBase64 ? '' : bodyEditor.value, bodyRef: false,
    });
  }
  function showFile() {
    const draft = S.draft, binary = !!draft.bodyBase64;
    field('em-body').disabled = binary;
    if (binary && bodyEditor.value) bodyEditor.setValue('', { silent: true });
    $('em-body-file-info').textContent = draft.bodyFile ? `${binary ? 'Binary file' : 'Loaded from'} ${draft.bodyFile}${binary ? ` (${formatBytes(Math.floor(draft.bodyBase64.length * 3 / 4))}); the body is sent byte for byte` : ''}` : '';
    $('em-body-file-clear').hidden = !binary;
  }
  /** Validation messages next to each field: errors once the field was touched (or Save was pressed), warnings always. Light: the body is only measured by its editor. */
  function refreshDialog() {
    if (!S.draft) return { errors: [], warnings: [] };
    const status = bodyEditor.status, known = bodyEditor.checked && !S.draft.bodyBase64;
    const result = validateMock(collect(), { checkBody: false, bodyBytes: known ? status.bytes : bodyEditor.value.length });
    if (S.headersJson) { const parsed = headersFromJson(headersEditor.value); if (parsed.error) result.errors.push({ field: 'headers', message: `Headers JSON, line ${parsed.error.line}, column ${parsed.error.col}: ${parsed.error.message}` }); }
    const shown = new Map();
    for (const error of result.errors) {
      const key = error.field.startsWith('header-') ? 'headers' : error.field;
      if (!S.submitted && !S.touched.has(key)) continue;
      const id = FIELD_ERROR[key] ?? 'em-err-form'; shown.set(id, [...(shown.get(id) ?? []), error.message]);
    }
    for (const id of new Set(Object.values(FIELD_ERROR))) { const node = $(id); node.textContent = (shown.get(id) ?? []).join(' '); node.hidden = !node.textContent; }
    for (const [key, input] of [['method', 'em-method'], ['url', 'em-url'], ['query', 'em-query'], ['status', 'em-status-code'], ['delayMs', 'em-delay']]) {
      if (shown.has(FIELD_ERROR[key]) && result.errors.some(e => e.field === key)) field(input).setAttribute('aria-invalid', 'true'); else field(input).removeAttribute('aria-invalid');
    }
    const json = isJsonType(contentType()) || (!contentType() && /^\s*[[{]/.test(bodyEditor.large ? '{' : bodyEditor.value.slice(0, 64)));
    bodyEditor.setLanguage(S.draft.bodyBase64 ? 'text' : json ? 'json' : 'text');
    const warnings = result.warnings.map(w => w.message);
    if (json && known && status.state === 'error' && bodyEditor.value.trim()) warnings.push('The body is not valid JSON: it will be sent as written.');
    const hint = $('em-body-hint'); hint.textContent = warnings.join(' '); hint.dataset.state = warnings.length ? 'warn' : '';
    for (const id of ['em-body-format', 'em-body-minify']) $(id).hidden = !json || !!S.draft.bodyBase64;
    $('em-body-download').hidden = !bodyEditor.large; $('em-body-clear').hidden = !bodyEditor.value && !bodyEditor.large;
    $('em-err-form').textContent = S.submitted && result.errors.length ? `Fix ${result.errors.length === 1 ? 'the marked field' : `the ${result.errors.length} marked problems`} to save.` : '';
    $('em-err-form').hidden = !$('em-err-form').textContent;
    return result;
  }
  function openDialog(mock, opener, prefill = null) {
    S.editing = mock ? mock.id : null; S.draft = normalizeMock(mock ?? (prefill ? { ...defaultMock(), ...prefill } : defaultMock())); S.opener = opener ?? document.activeElement; S.touched = new Set(); S.submitted = false;
    const draft = S.draft;
    $('em-dialog-title').textContent = mock ? 'Edit mock' : 'Add mock';
    field('em-name').value = draft.name; field('em-method').value = MOCK_METHODS.includes(draft.method) ? draft.method : 'ANY'; field('em-url').value = draft.url; field('em-query').value = draft.query === 'exact' ? 'exact' : 'ignore';
    field('em-body-contains').value = draft.bodyContains; field('em-status-code').value = String(draft.status); field('em-reason').value = draft.reason; field('em-delay').value = String(draft.delayMs ?? 0);
    S.headersJson = false; $('em-headers').replaceChildren(); for (const item of draft.headers) headerRow(item);
    $('em-headers').hidden = false; $('em-header-add').hidden = false; $('em-headers-json-box').hidden = true; $('em-headers-mode').textContent = 'Edit as JSON'; $('em-headers-mode').setAttribute('aria-pressed', 'false');
    bodyEditor.setValue(draft.bodyBase64 ? '' : draft.body, { silent: true });
    showFile(); refreshDialog();
    $('em-dialog').hidden = false; document.body.classList.add('em-modal-open');
    for (const node of document.querySelectorAll('main, header')) node.inert = true;   // the page behind the dialog is out of reach (focus, pointer, screen readers)
    bodyEditor.refresh(); field('em-url').focus();
  }
  function closeDialog() {
    if ($('em-dialog').hidden) return;
    $('em-dialog').hidden = true; document.body.classList.remove('em-modal-open');
    for (const node of document.querySelectorAll('main, header')) node.inert = false;
    const opener = S.opener; S.editing = null; S.draft = null; S.opener = null;
    bodyEditor.setValue('', { silent: true });   // a large body leaves memory with the dialog
    if (opener?.isConnected) opener.focus(); else $('em-add').focus();
  }
  async function submit(event) {
    event?.preventDefault?.(); S.submitted = true;
    let result = refreshDialog();
    if (result.errors.length) return focusError(result);
    const saveButton = $('em-save'); saveButton.disabled = true; saveButton.textContent = 'Checking…';
    let status; try { status = await bodyEditor.whenChecked(); } finally { saveButton.disabled = false; saveButton.textContent = 'Save'; }
    if (!S.draft) return;
    result = refreshDialog();
    if (!S.draft.bodyBase64 && status.bytes > MAX_BODY_BYTES) result.errors.push({ field: 'body', message: `The body is ${formatBytes(status.bytes)}: at most ${MAX_BODY_BYTES / 1048576} MB.` });
    if (result.errors.length) { refreshErrors(result); return focusError(result); }
    const mock = collect(), at = S.mocks.findIndex(item => item.id === S.editing);
    if (at >= 0) S.mocks[at] = mock;
    else { if (S.mocks.length >= MAX_MOCKS) { $('em-err-form').textContent = `At most ${MAX_MOCKS} mocks.`; $('em-err-form').hidden = false; return; } S.mocks.push(mock); }
    render(); changed(); closeDialog();
  }
  function refreshErrors(result) { const body = result.errors.filter(e => e.field === 'body').map(e => e.message).join(' '); $('em-err-body').textContent = body; $('em-err-body').hidden = !body; $('em-err-form').textContent = 'Fix the marked problems to save.'; $('em-err-form').hidden = false; }
  function focusError(result) {
    const first = result.errors[0].field, target = { method: 'em-method', url: 'em-url', query: 'em-query', status: 'em-status-code', reason: 'em-reason', delayMs: 'em-delay', body: 'em-body' }[first];
    (target ? field(target) : (S.headersJson ? $('em-headers-json') : $('em-headers').querySelector('input')) ?? $('em-header-add')).focus();
  }
  // focus trap and Esc
  $('em-dialog').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const items = [...$('em-dialog').querySelectorAll(FOCUSABLE)].filter(node => !node.hidden && node.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  $('em-dialog').addEventListener('mousedown', event => { if (event.target === $('em-dialog')) event.preventDefault(); });   // a click on the backdrop keeps the edits and the focus inside
  $('em-form').addEventListener('submit', submit);
  $('em-cancel').addEventListener('click', closeDialog);
  $('em-close').addEventListener('click', closeDialog);
  for (const [id, key] of [['em-method', 'method'], ['em-url', 'url'], ['em-query', 'query'], ['em-status-code', 'status'], ['em-reason', 'reason'], ['em-delay', 'delayMs'], ['em-body-contains', 'bodyContains'], ['em-name', 'name']]) {
    field(id).addEventListener('input', () => { S.touched.add(key); refreshDialog(); });
    field(id).addEventListener('change', () => { S.touched.add(key); refreshDialog(); });
  }
  $('em-header-add').addEventListener('click', () => { if ($('em-headers').children.length >= 64) return; headerRow().querySelector('input').focus(); refreshDialog(); });
  $('em-headers-mode').addEventListener('click', () => { if (setHeadersJson(!S.headersJson)) (S.headersJson ? $('em-headers-json') : $('em-headers').querySelector('input') ?? $('em-header-add')).focus(); });
  const runFormat = async indent => {
    const button = $(indent ? 'em-body-format' : 'em-body-minify'), text = button.textContent; button.disabled = true; button.textContent = indent ? 'Formatting…' : 'Minifying…';
    try { const result = await bodyEditor.format({ indent }); if (!result.ok) { S.touched.add('body'); $('em-body-status').textContent = `Cannot ${indent ? 'format' : 'minify'}: line ${result.error.line}, column ${result.error.col}: ${result.error.message}`; } }
    finally { button.disabled = false; button.textContent = text; }
  };
  $('em-body-format').addEventListener('click', () => runFormat(2));
  $('em-body-minify').addEventListener('click', () => runFormat(0));
  $('em-body-clear').addEventListener('click', () => { bodyEditor.clear(); refreshDialog(); });
  $('em-body-download').addEventListener('click', () => save(`body-${stamp(new Date())}.${bodyEditor.language === 'json' ? 'json' : 'txt'}`, bodyEditor.value, bodyEditor.language === 'json' ? 'application/json' : 'text/plain'));
  $('em-body-file-button').addEventListener('click', () => $('em-body-file').click());
  $('em-body-file').addEventListener('change', async () => {
    const file = $('em-body-file').files?.[0]; $('em-body-file').value = ''; if (!file) return;
    try {
      const loaded = bodyFromFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (loaded.error) { $('em-body-file-info').textContent = loaded.error; return; }
      Object.assign(S.draft, { bodyBase64: loaded.bodyBase64, bodyFile: loaded.bodyFile }); if (!loaded.bodyBase64) bodyEditor.setValue(loaded.body, { silent: true });
      S.touched.add('body'); showFile(); refreshDialog();
    } catch (error) { $('em-body-file-info').textContent = `The file could not be read: ${error?.message ?? error}`; }
  });
  $('em-body-file-clear').addEventListener('click', () => { Object.assign(S.draft, { bodyBase64: null, bodyFile: '' }); showFile(); refreshDialog(); field('em-body').focus(); });

  // ---- section buttons ------------------------------------------------------------------------------------------------------------------------------------------------------
  $('em-add').addEventListener('click', event => {
    if (S.mocks.length >= MAX_MOCKS) { $('em-status').textContent = `At most ${MAX_MOCKS} mocks.`; return; }
    openDialog(null, event.currentTarget);
  });
  $('em-export').addEventListener('click', () => { if (S.mocks.length) save(mocksFileName(S.pkg), exportMocks(S.mocks, S.pkg ?? ''), 'application/json'); });
  $('em-import').addEventListener('click', () => $('em-import-file').click());
  $('em-import-file').addEventListener('change', async () => {
    const file = $('em-import-file').files?.[0]; $('em-import-file').value = ''; if (!file) return;
    let text; try { text = await file.text(); } catch (error) { $('em-status').textContent = `The file could not be read: ${error?.message ?? error}`; return; }
    const { mocks, error } = importMocks(text), room = MAX_MOCKS - S.mocks.length, added = mocks.slice(0, Math.max(0, room));
    S.mocks.push(...added); render(); changed();
    $('em-status').textContent = `${added.length} ${added.length === 1 ? 'mock' : 'mocks'} imported from ${file.name}.${error ? ' ' + error : ''}${mocks.length > added.length ? ` The list reached the maximum of ${MAX_MOCKS}.` : ''}`;
  });
  field('em-method').replaceChildren(...MOCK_METHODS.map(method => Object.assign(document.createElement('option'), { value: method, textContent: method === 'ANY' ? 'Any (ANY)' : method })));
  render();

  return {
    /** The APK was inspected: load this package's mocks (large bodies from IndexedDB) and give them to the VM before the app runs. */
    async attach(inventory) {
      const pkg = inventory?.packageName ?? null;
      S.pkg = pkg; S.mocks = pkg ? loadMocks(pkg) : []; S.statuses = new Map(); S.hits = new Map(); S.savedBodies = new Map(); S.storageNote = ''; render();
      if (S.mocks.some(mock => mock.bodyRef)) { const hydrated = await hydrate(pkg, S.mocks); if (S.pkg !== pkg) return; S.mocks = hydrated; render(); }
      if (S.mocks.length) { clearTimeout(S.timer); await apply(); }
    },
    detach() { closeDialog(); S.pkg = null; S.mocks = []; S.statuses = new Map(); S.hits = new Map(); clearTimeout(S.timer); clearTimeout(S.saveTimer); render(); },
    /** Live counts of the Worker's snapshot ([{ id, hits, active }]). */
    hits(entries) { if (!Array.isArray(entries)) return; let changed = false; for (const entry of entries) if (S.hits.get(entry.id) !== entry.hits) { S.hits.set(entry.id, entry.hits); changed = true; } if (changed) updateMeta(); },
    activeCount() { return S.mocks.filter(isActive).length; },
    open: openDialog,
    /** "Create mock" from a request of the Network panel: the dialog opens filled with that request's method, URL and response (nothing is saved until Save). */
    openPrefilled(values, opener) { openDialog(null, opener, values); },
    /** A plugin's lab.mock: adds or replaces (same id) a mock in this package's list, saved and applied like one typed in the dialog. -> { id, errors } */
    upsert(raw) {
      if (!S.pkg) return { id: null, errors: [{ field: 'pkg', message: 'Open an APK: mocks are stored per package.' }] };
      const mock = normalizeMock({ ...raw, bodyRef: false }), { errors } = validateMock(mock); if (errors.length) return { id: null, errors };
      const at = S.mocks.findIndex(item => item.id === mock.id);
      if (at >= 0) S.mocks[at] = mock; else { if (S.mocks.length >= MAX_MOCKS) return { id: null, errors: [{ field: 'list', message: `At most ${MAX_MOCKS} mocks.` }] }; S.mocks.push(mock); }
      render(); changed(); return { id: mock.id, errors: [] };
    },
    remove(id) { const at = S.mocks.findIndex(item => item.id === id); if (at < 0) return false; S.mocks.splice(at, 1); render(); changed(); return true; },
    list() { return S.mocks.map(mock => ({ id: mock.id, name: mock.name, enabled: mock.enabled, method: mock.method, url: mock.url, status: mock.status, hits: S.hits.get(mock.id) ?? 0 })); },
    /** Writes the list now (tests; the page writes after a pause). */
    flush: () => { clearTimeout(S.saveTimer); return persist(); },
    get editor() { return bodyEditor; },
    get state() { return S; },
  };
}
