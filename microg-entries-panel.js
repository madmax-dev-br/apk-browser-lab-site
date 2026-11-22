// The "Pontos de entrada" list inside the Dispositivo section (src/index.html #dev-microg-entries), shown only while the "com microG" option is on: one row per entry point of the
// forbidden features (src/microg-entry-points.js) with its label, method in smali form, live hit count and, for a value-returning entry point, a text field for a constant mock value.
// The rows come from the Worker snapshot (deviceOptions.microg.entryPoints); the mock values are sent with vm.setMicrogMocks([{ id, value }]). The lab ships no mock; this only lets a
// user supply one. Richer values than a constant (a Bundle, a byte[], a built object) are the Node API's platform.microg.mock(id, handler) only.

import { MICROG_APIS, MICROG_API_STATE_LABELS } from './microg-apis.js?v=5fccdbc9ed78';

/** The static list of what microG answers on this device (src/microg-apis.js), in the "With microG" box. */
export function renderMicrogApis(list) {
  if (!list) return;
  list.replaceChildren(...MICROG_APIS.map(row => {
    const li = document.createElement('li'); li.className = 'cp-microg-api'; li.dataset.state = row.state;
    const state = document.createElement('span'); state.className = 'cp-microg-api-state'; state.textContent = MICROG_API_STATE_LABELS[row.state];
    const name = document.createElement('span'); name.className = 'cp-microg-api-name'; name.textContent = row.api;
    const note = document.createElement('span'); note.className = 'cp-microg-api-note'; note.textContent = row.note;
    li.append(state, name, note); return li;
  }));
}

export function createMicrogEntriesPanel({ $, vm }) {
  renderMicrogApis($('dev-microg-api-list'));
  const S = { values: new Map(), errors: new Map(), rows: [], timer: null };
  const container = () => $('dev-microg-entries');
  const list = () => $('dev-microg-entry-list');

  function render(entryPoints) {
    const box = container(); if (!box) return;
    const rows = Array.isArray(entryPoints) ? entryPoints : [];
    S.rows = rows;
    box.hidden = rows.length === 0;
    if (!rows.length) { list()?.replaceChildren(); return; }
    list().replaceChildren(...rows.map(row => {
      const li = document.createElement('li'); li.className = 'cp-microg-entry';
      const head = document.createElement('div'); head.className = 'cp-microg-entry-head';
      const name = document.createElement('span'); name.className = 'cp-microg-entry-label'; name.textContent = row.label;
      const hits = document.createElement('span'); hits.className = 'cp-microg-entry-hits';
      hits.textContent = row.mocked ? `mock: ${row.mockHits} ${row.mockHits === 1 ? 'call' : 'calls'}` : row.hits ? `${row.hits} ${row.hits === 1 ? 'call' : 'calls'} without mock` : 'no calls';
      head.append(name, hits);
      const method = document.createElement('code'); method.className = 'cp-microg-entry-method'; method.textContent = row.method;
      const field = document.createElement('div'); field.className = 'cp-microg-entry-field';
      const input = document.createElement('input'); input.type = 'text'; input.spellcheck = false; input.autocomplete = 'off'; input.className = 'cp-microg-entry-value';
      input.placeholder = `value (${row.returnType})`; input.value = S.values.get(row.id) ?? ''; input.setAttribute('aria-label', `Mock value for ${row.label}`);
      input.disabled = row.resolved === false;
      input.addEventListener('input', () => { const text = input.value; if (text.trim() === '') S.values.delete(row.id); else S.values.set(row.id, text); schedule(); });
      const meta = document.createElement('span'); meta.className = 'cp-microg-entry-meta'; meta.setAttribute('role', 'status');
      const message = S.errors.get(row.id) ?? (row.valueless ? 'Delivered by callback/coroutine: the value mock is counted, but it does not feed the app result.' : row.resolved === false ? 'Reach microG once to resolve the entry point.' : '');
      meta.textContent = message; meta.dataset.state = S.errors.has(row.id) ? 'error' : ''; meta.hidden = !message;
      field.append(input, meta);
      li.append(head, method, field); return li;
    }));
  }

  function schedule() { clearTimeout(S.timer); S.timer = setTimeout(apply, 300); }
  async function apply() {
    if (!vm.worker) return;
    const specs = [...S.values.entries()].map(([id, value]) => ({ id, value }));
    try {
      const rows = await vm.setMicrogMocks(specs);
      S.errors = new Map(rows.filter(row => row.error).map(row => [row.id, row.error]));
      render(rows);
    } catch (error) { /* the VM is between events; the next snapshot re-renders */ }
  }

  return {
    /** Live rows from the Worker snapshot (deviceOptions.microg.entryPoints); null/absent when the option is off. */
    update(entryPoints) { if (document.activeElement?.classList?.contains('cp-microg-entry-value')) return; render(entryPoints); },
    /** The APK was closed or reopened with the option off. */
    reset() { S.values = new Map(); S.errors = new Map(); clearTimeout(S.timer); render([]); },
  };
}
