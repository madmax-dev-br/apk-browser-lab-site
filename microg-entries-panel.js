// The "Pontos de entrada" list inside the Dispositivo section (src/index.html #dev-microg-entries), shown only while the "com microG" option is on: one row per entry point of the
// forbidden features (src/microg-entry-points.js) with its label, method in smali form, live hit count and, for a value-returning entry point, a text field for a constant mock value.
// The rows come from the Worker snapshot (deviceOptions.microg.entryPoints); the mock values are sent with vm.setMicrogMocks([{ id, value }]). The lab ships no mock; this only lets a
// user supply one. Richer values than a constant (a Bundle, a byte[], a built object) are the Node API's platform.microg.mock(id, handler) only.

export function createMicrogEntriesPanel({ $, vm }) {
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
      hits.textContent = row.mocked ? `mock: ${row.mockHits} ${row.mockHits === 1 ? 'chamada' : 'chamadas'}` : row.hits ? `${row.hits} ${row.hits === 1 ? 'chamada' : 'chamadas'} sem mock` : 'sem chamadas';
      head.append(name, hits);
      const method = document.createElement('code'); method.className = 'cp-microg-entry-method'; method.textContent = row.method;
      const field = document.createElement('div'); field.className = 'cp-microg-entry-field';
      const input = document.createElement('input'); input.type = 'text'; input.spellcheck = false; input.autocomplete = 'off'; input.className = 'cp-microg-entry-value';
      input.placeholder = `valor (${row.returnType})`; input.value = S.values.get(row.id) ?? ''; input.setAttribute('aria-label', `Valor de mock para ${row.label}`);
      input.disabled = row.resolved === false;
      input.addEventListener('input', () => { const text = input.value; if (text.trim() === '') S.values.delete(row.id); else S.values.set(row.id, text); schedule(); });
      const meta = document.createElement('span'); meta.className = 'cp-microg-entry-meta'; meta.setAttribute('role', 'status');
      const message = S.errors.get(row.id) ?? (row.valueless ? 'Entrega por callback/corrotina: o mock de valor é contado, mas não alimenta o resultado do app.' : row.resolved === false ? 'Alcance o microG uma vez para resolver o ponto de entrada.' : '');
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
