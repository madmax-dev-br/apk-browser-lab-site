// The "Mock de endpoints" section of the Controles panel (src/endpoint-mocks.js): the list of mocked endpoints of the open package (method, URL pattern, status, on/off, hits, edit,
// remove, order), the dialog that configures one mock, and export / import as JSON. The list is kept per package in localStorage (every access guarded; without storage it lasts for
// the page), and applied live to the Worker; hit counts come back with every snapshot.
import { MOCK_METHODS, MAX_MOCKS, MAX_BODY_BYTES, defaultMock, normalizeMock, validateMock, loadMocks, saveMocks, exportMocks, importMocks, bytesToBase64, mockLabel } from './endpoint-mocks.js?v=f6a892d62d6e';

const FIELD_ERROR = { method: 'em-err-method', url: 'em-err-url', query: 'em-err-query', status: 'em-err-status', reason: 'em-err-status', headers: 'em-err-headers', body: 'em-err-body', delayMs: 'em-err-delay' };
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
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
  if (bytes.length > MAX_BODY_BYTES) return { error: `O arquivo passa de ${MAX_BODY_BYTES / 1048576} MiB.` };
  let text = null; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = null; }
  if (text !== null && !text.includes('\0')) return { body: text, bodyBase64: null, bodyFile: name };
  return { body: '', bodyBase64: bytesToBase64(bytes), bodyFile: name, bytes: bytes.length };
}

export function createEndpointMocksPanel({ $, vm, save = download }) {
  const S = { pkg: null, mocks: [], statuses: new Map(), hits: new Map(), sequence: 0, timer: null, editing: null, draft: null, opener: null, touched: new Set(), submitted: false };
  const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const button = (text, className, label, onClick) => { const node = el('button', `cp-button ${className}`, text); node.type = 'button'; if (label) node.setAttribute('aria-label', label); node.addEventListener('click', onClick); return node; };

  // ---- the list -------------------------------------------------------------------------------------------------------------------------------------------------------------------
  function meta(mock) {
    const status = S.statuses.get(mock.id), hits = S.hits.get(mock.id) ?? status?.hits ?? 0;
    if (status?.state === 'invalid') return [status.error, 'error'];
    const errors = validateMock(mock).errors; if (errors.length) return [errors.map(e => e.message).join(' '), 'error'];
    if (!mock.enabled) return [`desligado · ${hits} ${hits === 1 ? 'resposta' : 'respostas'}`, ''];
    return [`${hits} ${hits === 1 ? 'resposta' : 'respostas'}${mock.delayMs > 0 ? ` · atraso ${mock.delayMs} ms` : ''}${mock.bodyContains ? ' · corpo contém' : ''}${mock.query === 'exact' ? ' · query exata' : ''}`, 'ok'];
  }
  function updateMeta() {
    [...$('em-list').children].forEach((li, index) => { const mock = S.mocks[index]; if (!mock) return; const [text, state] = meta(mock), info = li.querySelector('.em-meta'); info.textContent = text; info.dataset.state = state; });
    const active = S.mocks.filter(mock => mock.enabled && !validateMock(mock).errors.length), hits = active.reduce((sum, mock) => sum + (S.hits.get(mock.id) ?? 0), 0);
    $('em-summary').textContent = `${active.length} ${active.length === 1 ? 'ativo' : 'ativos'}`;
    $('em-status').textContent = !S.pkg && !S.mocks.length ? 'Abra um APK: os mocks são guardados por pacote.'
      : active.length ? `${active.length} ${active.length === 1 ? 'mock ativo' : 'mocks ativos'}, ${hits} ${hits === 1 ? 'resposta' : 'respostas'}. O primeiro que casar, na ordem da lista, responde. O painel Rede, o Resumo e o Logcat avisam.` : S.mocks.length ? 'Nenhum mock ativo.' : 'Nenhum mock.';
    $('em-export').disabled = !S.mocks.length;
  }
  function render() {
    $('em-list').replaceChildren(...S.mocks.map((mock, index) => {
      const li = el('li', 'em-row'), n = index + 1, label = mockLabel(mock);
      const check = el('input'); check.type = 'checkbox'; check.checked = mock.enabled; check.setAttribute('aria-label', `Ativar o mock ${n}: ${label}`);
      check.addEventListener('change', () => { mock.enabled = check.checked; changed(); });
      const what = el('span', 'em-what'); what.append(el('b', 'em-method', mock.method), el('code', 'em-url', mock.url || '(sem URL)'));
      if (mock.name) what.append(el('span', 'em-name', mock.name));
      const code = el('span', 'em-code', String(mock.status)); code.title = 'Status da resposta';
      const actions = el('span', 'em-row-actions');
      actions.append(
        button('↑', 'em-up', `Subir o mock ${n} (prioridade maior)`, () => move(index, -1)),
        button('↓', 'em-down', `Descer o mock ${n}`, () => move(index, 1)),
        button('Editar', 'em-edit', `Editar o mock ${n}: ${label}`, event => openDialog(mock, event.currentTarget)),
        button('Remover', 'em-remove', `Remover o mock ${n}: ${label}`, () => { S.mocks.splice(index, 1); render(); changed(); $('em-add').focus(); }),
      );
      actions.children[0].disabled = index === 0; actions.children[1].disabled = index === S.mocks.length - 1;
      const info = el('span', 'em-meta'); info.setAttribute('role', 'status');
      li.append(check, what, code, actions, info); return li;
    }));
    updateMeta();
  }
  function move(index, by) {
    const to = index + by; if (to < 0 || to >= S.mocks.length) return;
    const [item] = S.mocks.splice(index, 1); S.mocks.splice(to, 0, item); render(); changed();
    $('em-list').children[to]?.querySelector(by < 0 ? '.em-up' : '.em-down')?.focus();
  }
  function changed() { if (S.pkg) saveMocks(S.pkg, S.mocks); updateMeta(); clearTimeout(S.timer); S.timer = setTimeout(apply, 0); }
  async function apply() {
    const token = ++S.sequence;
    try {
      const statuses = vm.worker ? await vm.setEndpointMocks(S.mocks.map(normalizeMock)) : [];
      if (token !== S.sequence) return;
      S.statuses = new Map(statuses.map(status => [status.id, status])); for (const status of statuses) S.hits.set(status.id, status.hits);
    } catch (error) { for (const mock of S.mocks) S.statuses.set(mock.id, { id: mock.id, state: 'invalid', error: `A VM não aplicou: ${error?.message ?? error}` }); }
    updateMeta();
  }

  // ---- the dialog -----------------------------------------------------------------------------------------------------------------------------------------------------------------
  const field = id => $(id);
  function headerRow(row = { name: '', value: '' }) {
    const li = el('li', 'em-header'), list = $('em-headers'), n = () => [...list.children].indexOf(li) + 1;
    const name = el('input', 'em-header-name'); name.type = 'text'; name.value = row.name; name.placeholder = 'Nome'; name.spellcheck = false; name.autocomplete = 'off'; name.setAttribute('aria-label', 'Nome do cabeçalho');
    const value = el('input', 'em-header-value'); value.type = 'text'; value.value = row.value; value.placeholder = 'Valor'; value.spellcheck = false; value.autocomplete = 'off'; value.setAttribute('aria-label', 'Valor do cabeçalho');
    const remove = button('×', 'em-header-remove', 'Remover o cabeçalho', () => { const next = li.nextElementSibling ?? li.previousElementSibling; li.remove(); S.touched.add('headers'); refreshDialog(); (next?.querySelector('input') ?? $('em-header-add')).focus(); });
    for (const input of [name, value]) input.addEventListener('input', () => { S.touched.add('headers'); refreshDialog(); });
    li.append(name, value, remove); list.append(li);
    remove.setAttribute('aria-label', `Remover o cabeçalho ${n()}`);
    return li;
  }
  function collect() {
    const draft = S.draft;
    return normalizeMock({
      ...draft, name: field('em-name').value, method: field('em-method').value, url: field('em-url').value, query: field('em-query').value, bodyContains: field('em-body-contains').value,
      status: field('em-status-code').value, reason: field('em-reason').value, delayMs: field('em-delay').value,
      headers: [...$('em-headers').children].map(li => ({ name: li.querySelector('.em-header-name').value, value: li.querySelector('.em-header-value').value })),
      body: draft.bodyBase64 ? '' : field('em-body').value,
    });
  }
  function showFile() {
    const draft = S.draft, binary = !!draft.bodyBase64;
    field('em-body').disabled = binary; field('em-body').placeholder = binary ? '' : 'Corpo da resposta (texto, JSON, XML…)';
    if (binary) field('em-body').value = '';
    $('em-body-file-info').textContent = draft.bodyFile ? `${binary ? 'Arquivo binário' : 'Carregado de'} ${draft.bodyFile}${binary ? ` (${Math.floor(draft.bodyBase64.length * 3 / 4)} bytes aprox.); o corpo é enviado byte a byte` : ''}` : '';
    $('em-body-file-clear').hidden = !binary;
  }
  /** Validation messages next to each field: errors once the field was touched (or Salvar was pressed), warnings (JSON hint) always. */
  function refreshDialog() {
    const result = validateMock(collect()), shown = new Map();
    for (const error of result.errors) {
      const key = error.field.startsWith('header-') ? 'headers' : error.field;
      if (!S.submitted && !S.touched.has(key)) continue;
      const id = FIELD_ERROR[key] ?? 'em-err-form'; shown.set(id, [...(shown.get(id) ?? []), error.message]);
    }
    for (const id of new Set(Object.values(FIELD_ERROR))) { const node = $(id); node.textContent = (shown.get(id) ?? []).join(' '); node.hidden = !node.textContent; }
    for (const [key, input] of [['method', 'em-method'], ['url', 'em-url'], ['query', 'em-query'], ['status', 'em-status-code'], ['delayMs', 'em-delay']]) {
      if (shown.has(FIELD_ERROR[key]) && result.errors.some(e => e.field === key)) field(input).setAttribute('aria-invalid', 'true'); else field(input).removeAttribute('aria-invalid');
    }
    const warnings = result.warnings.map(w => w.message), hint = $('em-body-hint');
    const contentType = collect().headers.find(h => h.name.trim().toLowerCase() === 'content-type')?.value ?? '';
    const jsonOk = /json/i.test(contentType) && !S.draft.bodyBase64 && field('em-body').value.trim() && !result.warnings.some(w => w.field === 'body' && /JSON/.test(w.message));
    hint.textContent = warnings.length ? warnings.join(' ') : jsonOk ? 'JSON válido.' : '';
    hint.dataset.state = warnings.length ? 'warn' : jsonOk ? 'ok' : '';
    $('em-body-format').hidden = !/json/i.test(contentType) || !!S.draft.bodyBase64;
    $('em-err-form').textContent = S.submitted && result.errors.length ? `Corrija ${result.errors.length === 1 ? 'o campo marcado' : `os ${result.errors.length} problemas marcados`} para salvar.` : '';
    $('em-err-form').hidden = !$('em-err-form').textContent;
    return result;
  }
  function openDialog(mock, opener, prefill = null) {
    S.editing = mock ? mock.id : null; S.draft = normalizeMock(mock ?? (prefill ? { ...defaultMock(), ...prefill } : defaultMock())); S.opener = opener ?? document.activeElement; S.touched = new Set(); S.submitted = false;
    const draft = S.draft;
    $('em-dialog-title').textContent = mock ? 'Editar mock' : 'Adicionar mock';
    field('em-name').value = draft.name; field('em-method').value = MOCK_METHODS.includes(draft.method) ? draft.method : 'ANY'; field('em-url').value = draft.url; field('em-query').value = draft.query === 'exact' ? 'exact' : 'ignore';
    field('em-body-contains').value = draft.bodyContains; field('em-status-code').value = String(draft.status); field('em-reason').value = draft.reason; field('em-delay').value = String(draft.delayMs ?? 0);
    field('em-body').value = draft.body; $('em-headers').replaceChildren(); for (const row of draft.headers) headerRow(row);
    showFile(); refreshDialog();
    $('em-dialog').hidden = false; document.body.classList.add('em-modal-open');
    for (const node of document.querySelectorAll('main, header')) node.inert = true;   // the page behind the dialog is out of reach (focus, pointer, screen readers)
    field('em-url').focus();
  }
  function closeDialog() {
    if ($('em-dialog').hidden) return;
    $('em-dialog').hidden = true; document.body.classList.remove('em-modal-open');
    for (const node of document.querySelectorAll('main, header')) node.inert = false;
    const opener = S.opener; S.editing = null; S.draft = null; S.opener = null;
    if (opener?.isConnected) opener.focus(); else $('em-add').focus();
  }
  function submit(event) {
    event?.preventDefault?.(); S.submitted = true;
    const result = refreshDialog();
    if (result.errors.length) { const first = result.errors[0].field, target = { method: 'em-method', url: 'em-url', query: 'em-query', status: 'em-status-code', reason: 'em-reason', delayMs: 'em-delay', body: 'em-body' }[first]; (target ? field(target) : $('em-headers').querySelector('input') ?? $('em-header-add')).focus(); return; }
    const mock = collect(), at = S.mocks.findIndex(item => item.id === S.editing);
    if (at >= 0) S.mocks[at] = mock;
    else { if (S.mocks.length >= MAX_MOCKS) { $('em-err-form').textContent = `No máximo ${MAX_MOCKS} mocks.`; $('em-err-form').hidden = false; return; } S.mocks.push(mock); }
    render(); changed(); closeDialog();
  }
  // focus trap and Esc
  $('em-dialog').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return; }
    if (event.key !== 'Tab') return;
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
  for (const [id, key] of [['em-method', 'method'], ['em-url', 'url'], ['em-query', 'query'], ['em-status-code', 'status'], ['em-reason', 'reason'], ['em-delay', 'delayMs'], ['em-body', 'body'], ['em-body-contains', 'bodyContains'], ['em-name', 'name']]) {
    field(id).addEventListener('input', () => { S.touched.add(key); refreshDialog(); });
    field(id).addEventListener('change', () => { S.touched.add(key); refreshDialog(); });
  }
  $('em-header-add').addEventListener('click', () => { if ($('em-headers').children.length >= 64) return; headerRow().querySelector('input').focus(); refreshDialog(); });
  $('em-body-format').addEventListener('click', () => { try { field('em-body').value = JSON.stringify(JSON.parse(field('em-body').value), null, 2); refreshDialog(); } catch { S.touched.add('body'); refreshDialog(); } });
  $('em-body-file-button').addEventListener('click', () => $('em-body-file').click());
  $('em-body-file').addEventListener('change', async () => {
    const file = $('em-body-file').files?.[0]; $('em-body-file').value = ''; if (!file) return;
    try {
      const loaded = bodyFromFile(file.name, new Uint8Array(await file.arrayBuffer()));
      if (loaded.error) { $('em-body-file-info').textContent = loaded.error; return; }
      Object.assign(S.draft, { bodyBase64: loaded.bodyBase64, bodyFile: loaded.bodyFile }); if (!loaded.bodyBase64) field('em-body').value = loaded.body;
      S.touched.add('body'); showFile(); refreshDialog();
    } catch (error) { $('em-body-file-info').textContent = `O arquivo não pôde ser lido: ${error?.message ?? error}`; }
  });
  $('em-body-file-clear').addEventListener('click', () => { Object.assign(S.draft, { bodyBase64: null, bodyFile: '' }); showFile(); refreshDialog(); field('em-body').focus(); });

  // ---- section buttons ------------------------------------------------------------------------------------------------------------------------------------------------------------
  $('em-add').addEventListener('click', event => {
    if (S.mocks.length >= MAX_MOCKS) { $('em-status').textContent = `No máximo ${MAX_MOCKS} mocks.`; return; }
    openDialog(null, event.currentTarget);
  });
  $('em-export').addEventListener('click', () => { if (S.mocks.length) save(mocksFileName(S.pkg), exportMocks(S.mocks, S.pkg ?? ''), 'application/json'); });
  $('em-import').addEventListener('click', () => $('em-import-file').click());
  $('em-import-file').addEventListener('change', async () => {
    const file = $('em-import-file').files?.[0]; $('em-import-file').value = ''; if (!file) return;
    let text; try { text = await file.text(); } catch (error) { $('em-status').textContent = `O arquivo não pôde ser lido: ${error?.message ?? error}`; return; }
    const { mocks, error } = importMocks(text), room = MAX_MOCKS - S.mocks.length, added = mocks.slice(0, Math.max(0, room));
    S.mocks.push(...added); render(); changed();
    $('em-status').textContent = `${added.length} ${added.length === 1 ? 'mock importado' : 'mocks importados'} de ${file.name}.${error ? ' ' + error : ''}${mocks.length > added.length ? ` A lista chegou ao máximo de ${MAX_MOCKS}.` : ''}`;
  });
  field('em-method').replaceChildren(...MOCK_METHODS.map(method => Object.assign(document.createElement('option'), { value: method, textContent: method === 'ANY' ? 'Qualquer (ANY)' : method })));
  render();

  return {
    /** The APK was inspected: load this package's mocks and give them to the VM before the app runs. */
    async attach(inventory) {
      S.pkg = inventory?.packageName ?? null; S.mocks = S.pkg ? loadMocks(S.pkg) : []; S.statuses = new Map(); S.hits = new Map(); render();
      if (S.mocks.length) { clearTimeout(S.timer); await apply(); }
    },
    detach() { closeDialog(); S.pkg = null; S.mocks = []; S.statuses = new Map(); S.hits = new Map(); clearTimeout(S.timer); render(); },
    /** Live counts of the Worker's snapshot ([{ id, hits, active }]). */
    hits(entries) { if (!Array.isArray(entries)) return; let changed = false; for (const entry of entries) if (S.hits.get(entry.id) !== entry.hits) { S.hits.set(entry.id, entry.hits); changed = true; } if (changed) updateMeta(); },
    activeCount() { return S.mocks.filter(mock => mock.enabled && !validateMock(mock).errors.length).length; },
    open: openDialog,
    /** "Criar mock" from a request of the Rede panel: the dialog opens filled with that request's method, URL and response (nothing is saved until Salvar). */
    openPrefilled(values, opener) { openDialog(null, opener, values); },
    /** A plugin's lab.mock: adds or replaces (same id) a mock in this package's list, saved and applied like one typed in the dialog. -> { id, errors } */
    upsert(raw) {
      if (!S.pkg) return { id: null, errors: [{ field: 'pkg', message: 'Abra um APK: os mocks são guardados por pacote.' }] };
      const mock = normalizeMock(raw), { errors } = validateMock(mock); if (errors.length) return { id: null, errors };
      const at = S.mocks.findIndex(item => item.id === mock.id);
      if (at >= 0) S.mocks[at] = mock; else { if (S.mocks.length >= MAX_MOCKS) return { id: null, errors: [{ field: 'list', message: `No máximo ${MAX_MOCKS} mocks.` }] }; S.mocks.push(mock); }
      render(); changed(); return { id: mock.id, errors: [] };
    },
    remove(id) { const at = S.mocks.findIndex(item => item.id === id); if (at < 0) return false; S.mocks.splice(at, 1); render(); changed(); return true; },
    list() { return S.mocks.map(mock => ({ id: mock.id, name: mock.name, enabled: mock.enabled, method: mock.method, url: mock.url, status: mock.status, hits: S.hits.get(mock.id) ?? 0 })); },
    get state() { return S; },
  };
}
