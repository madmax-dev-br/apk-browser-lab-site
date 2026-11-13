// "Dados do app" in the Controles panel: the running app's SharedPreferences files and SQLite databases (read and edited in the Worker by src/app-storage.js, through the app's own
// Editor and the framework's SQLiteDatabase). Each opens a modal (src/lab-modal.js): a SharedPreferences file as a table of typed keys to edit, remove and add; a database as its
// tables, a page of rows whose cells are edited in place (by rowid), rows added and removed, and a SQL console. A change answers a fresh snapshot, which the page renders.
import { formatBytes } from './shared-files-panel.js?v=0ed57297cd19';

export const PREF_TYPES = ['string', 'int', 'long', 'float', 'boolean', 'set'];
const PAGE = 100;

/** A cell value for display: null, numbers, 64-bit integers ({ long }), blobs ({ blob: size, hex }) and text. */
export function cellText(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object' && value.long !== undefined) return value.long;
  if (typeof value === 'object' && value.blob !== undefined) return `BLOB ${value.blob} B${value.hex ? ` · ${value.hex}${value.blob > 64 ? '…' : ''}` : ''}`;
  return String(value);
}
/** What the page typed into a cell, as the value to bind: "NULL" is null, an integer or a number in a numeric column is a number, anything else is text. */
export function cellValue(textValue, columnType = '') {
  if (textValue === 'NULL') return null;
  if (/INT|REAL|FLOA|DOUB|NUM|DEC/i.test(columnType) && /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(textValue.trim())) { const n = Number(textValue); return Number.isSafeInteger(n) || !Number.isInteger(n) ? n : { long: textValue.trim() }; }
  return textValue;
}

export function createAppDataPanel({ $, doc = globalThis.document, vm, modals, ready = () => true, render = () => {}, report = () => {} }) {
  const list = $('appdata-list'), note = $('appdata-note'), summary = $('appdata-summary'), refreshButton = $('appdata-refresh');
  let overview = null, loading = null;
  const el = (tag, props = {}, ...children) => { const node = doc.createElement(tag); for (const [key, value] of Object.entries(props)) { if (key === 'class') node.className = value; else if (key === 'text') node.textContent = value; else if (key.startsWith('on')) node.addEventListener(key.slice(2), value); else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value === true ? '' : value); } node.append(...children.filter(Boolean)); return node; };
  const setNote = text => { if (note) note.textContent = text; };
  /** A request to the Worker; a change's snapshot is rendered. Errors become the note (and the modal's message). */
  const ask = async payload => { const { appData, snapshot } = await vm.appStorage(payload); if (snapshot) render(snapshot); return appData; };

  async function refresh() {
    if (!list) return null;
    if (!ready()) { list.replaceChildren(); summary.textContent = '—'; setNote('Abra e inicie um app para ver os dados que ele guardou.'); refreshButton.disabled = true; return null; }
    refreshButton.disabled = false;
    return loading ??= (async () => {
      try {
        overview = await ask({ op: 'overview' });
        const items = [];
        for (const prefs of overview.prefs) items.push(el('li', {}, el('button', { type: 'button', class: 'appdata-item', onclick: () => openPrefs(prefs.name) }, el('span', { class: 'appdata-kind', text: 'Prefs' }), el('strong', { text: prefs.name }), el('small', { text: prefs.error ? prefs.error : `${prefs.entries.length} ${prefs.entries.length === 1 ? 'chave' : 'chaves'}` }))));
        for (const db of overview.databases) items.push(el('li', {}, el('button', { type: 'button', class: 'appdata-item', onclick: () => openDatabase(db.name) }, el('span', { class: 'appdata-kind db', text: 'SQLite' }), el('strong', { text: db.name }), el('small', { text: db.error ? db.error : `${db.tables.filter(t => t.type === 'table').length} tabelas${db.size !== null ? ` · ${formatBytes(db.size)}` : ''}` }))));
        list.replaceChildren(...items);
        summary.textContent = `${overview.prefs.length} prefs · ${overview.databases.length} bancos`;
        setNote(items.length ? 'Toque para ver e editar. As mudanças passam pelo próprio app: SharedPreferences pelo Editor dele (com os listeners), SQLite por uma segunda conexão ao banco.' : 'O app ainda não guardou SharedPreferences nem bancos SQLite.');
        return overview;
      } catch (error) { setNote(String(error?.message ?? error)); return null; }
      finally { loading = null; }
    })();
  }
  refreshButton?.addEventListener('click', () => refresh());

  // ---- SharedPreferences modal
  async function openPrefs(name) {
    const status = el('p', { class: 'appdata-status', role: 'status', 'aria-live': 'polite' }), body = el('div', { class: 'appdata-modal' }), table = el('table', { class: 'appdata-table' });
    const modal = modals.open({ title: `SharedPreferences · ${name}`, size: 'full', content: body, label: 'Dados do app' });
    const typeSelect = value => el('select', { 'aria-label': 'Tipo' }, ...PREF_TYPES.map(type => el('option', { value: type, text: type, selected: type === value })));
    const valueInput = (type, value) => type === 'boolean' ? el('select', { 'aria-label': 'Valor' }, el('option', { value: 'true', text: 'true', selected: value === true }), el('option', { value: 'false', text: 'false', selected: value === false }))
      : type === 'set' ? el('textarea', { rows: Math.min(6, Math.max(2, (value?.length ?? 0) + 1)), 'aria-label': 'Valores, um por linha' }, (value ?? []).join('\n')) : Object.assign(el('input', { type: 'text', 'aria-label': 'Valor', spellcheck: 'false' }), { value: value === null || value === undefined ? '' : String(value) });
    const readValue = (type, input) => type === 'set' ? input.value.split('\n').filter(line => line !== '') : input.value;
    const apply = async (changes, done) => {
      status.textContent = 'Salvando…';
      try { const result = await ask({ op: 'edit-prefs', name, changes }); paint(result.entries); status.textContent = result.committed ? done : 'O commit() do app devolveu false: nada foi gravado.'; refresh(); }
      catch (error) { status.textContent = String(error?.message ?? error); }
    };
    const paint = entries => {
      const rows = entries.map(entry => {
        let type = entry.type; const typeBox = typeSelect(type), valueBox = el('td'); let input = valueInput(type, entry.value); valueBox.append(input);
        typeBox.addEventListener('change', () => { type = typeBox.value; const next = valueInput(type, type === 'set' ? [] : type === 'boolean' ? false : ''); input.replaceWith(next); input = next; });
        const save = el('button', { type: 'button', class: 'cp-button', text: 'Salvar', onclick: () => apply([{ key: entry.key, type, value: readValue(type, input) }], `${entry.key} salvo.`) });
        const remove = el('button', { type: 'button', class: 'cp-button danger', text: 'Excluir', onclick: () => { if (confirm(`Excluir a chave ${entry.key}?`)) apply([{ key: entry.key, remove: true }], `${entry.key} excluída.`); } });
        return el('tr', {}, el('th', { scope: 'row', text: entry.key }), el('td', {}, typeBox), valueBox, el('td', { class: 'appdata-actions' }, save, remove));
      });
      const newKey = el('input', { type: 'text', placeholder: 'nova chave', 'aria-label': 'Nova chave', spellcheck: 'false' }); let newType = 'string'; const newTypeBox = typeSelect(newType), newValueCell = el('td'); let newInput = valueInput(newType, ''); newValueCell.append(newInput);
      newTypeBox.addEventListener('change', () => { newType = newTypeBox.value; const next = valueInput(newType, newType === 'set' ? [] : newType === 'boolean' ? false : ''); newInput.replaceWith(next); newInput = next; });
      const add = el('button', { type: 'button', class: 'cp-button primary', text: 'Adicionar', onclick: () => { if (!newKey.value.trim()) { status.textContent = 'Escreva a chave.'; return; } apply([{ key: newKey.value.trim(), type: newType, value: readValue(newType, newInput) }], `${newKey.value.trim()} adicionada.`); } });
      table.replaceChildren(el('thead', {}, el('tr', {}, el('th', { text: 'Chave' }), el('th', { text: 'Tipo' }), el('th', { text: 'Valor' }), el('th', { text: '' }))), el('tbody', {}, ...rows, el('tr', { class: 'appdata-new' }, el('td', {}, newKey), el('td', {}, newTypeBox), newValueCell, el('td', { class: 'appdata-actions' }, add))));
    };
    body.append(el('p', { class: 'cp-note', text: 'Cada mudança é um Editor do próprio app: putX ou remove, depois commit(). O app vê o valor novo na próxima leitura, e os listeners que ele registrou são avisados.' }), table, status);
    try { paint((await ask({ op: 'prefs', name })).entries); } catch (error) { status.textContent = String(error?.message ?? error); }
    return modal;
  }

  // ---- SQLite modal
  async function openDatabase(name) {
    const body = el('div', { class: 'appdata-modal appdata-db' }), tables = el('ul', { class: 'appdata-tables', 'aria-label': 'Tabelas' }), grid = el('div', { class: 'appdata-grid' }), status = el('p', { class: 'appdata-status', role: 'status', 'aria-live': 'polite' });
    const pager = el('div', { class: 'appdata-pager' }), sqlBox = el('textarea', { rows: 3, spellcheck: 'false', 'aria-label': 'Comando SQL', placeholder: 'SELECT * FROM tabela WHERE …   (um comando; ? com parâmetros não é usado aqui)' }), sqlOut = el('div', { class: 'appdata-grid' });
    const modal = modals.open({ title: `SQLite · ${name}`, size: 'full', content: body, label: 'Dados do app' });
    let current = null, offset = 0, info = [];
    const resultTable = (result, editable) => {
      const columns = result.columns, head = el('tr', {}, ...columns.map(c => el('th', { text: c })), editable ? el('th', { text: '' }) : null);
      const rows = result.rows.map(row => {
        const tr = el('tr');
        row.forEach((value, i) => {
          const td = el('td', { text: cellText(value), class: value === null ? 'null' : null, title: typeof value === 'string' && value.length > 80 ? value : null });
          const column = columns[i], meta = current?.columns.find(c => c.name === column);
          if (editable && column !== 'rowid' && !(value && typeof value === 'object' && value.blob !== undefined)) td.addEventListener('dblclick', () => editCell(td, row, column, value, meta));
          tr.append(td);
        });
        if (editable) tr.append(el('td', { class: 'appdata-actions' }, el('button', { type: 'button', class: 'cp-button danger', text: 'Excluir', onclick: () => removeRow(row) })));
        return tr;
      });
      return el('table', { class: 'appdata-table' }, el('thead', {}, head), el('tbody', {}, ...rows));
    };
    const rowKey = row => current.rowid ? { rowid: row[0] } : { key: Object.fromEntries(current.columns.filter(c => c.primaryKey).map(c => [c.name, row[(current.rowid ? 1 : 0) + current.columns.indexOf(c)]])) };
    function editCell(td, row, column, value, meta) {
      const input = Object.assign(el('input', { type: 'text', 'aria-label': `Novo valor de ${column}`, spellcheck: 'false' }), { value: value === null ? 'NULL' : cellText(value) });
      td.replaceChildren(input); input.focus(); input.select();
      const finish = async save => {
        input.remove(); td.textContent = cellText(value);
        if (!save || input.value === (value === null ? 'NULL' : cellText(value))) return;
        status.textContent = 'Salvando…';
        try { const result = await ask({ op: 'edit-row', db: name, table: current.name, change: { ...rowKey(row), set: { [column]: cellValue(input.value, meta?.type ?? '') } } }); status.textContent = `${result.changes} linha alterada.`; await showTable(current.name); }
        catch (error) { status.textContent = String(error?.message ?? error); }
      };
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finish(true); } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); } });
      input.addEventListener('blur', () => finish(false), { once: true });
    }
    async function removeRow(row) {
      if (!confirm('Excluir esta linha?')) return;
      try { const result = await ask({ op: 'edit-row', db: name, table: current.name, change: { ...rowKey(row), remove: true } }); status.textContent = `${result.changes} linha excluída.`; await load(); await showTable(current.name); }
      catch (error) { status.textContent = String(error?.message ?? error); }
    }
    async function showTable(table) {
      try {
        const page = await ask({ op: 'rows', db: name, table, offset, limit: PAGE }); current = page.table;
        for (const item of tables.querySelectorAll('button')) item.setAttribute('aria-current', item.dataset.table === table ? 'true' : 'false');
        grid.replaceChildren(resultTable(page, current.type === 'table'));
        const total = current.rows ?? 0;
        pager.replaceChildren(el('span', { text: `${total ? offset + 1 : 0}–${offset + page.rows.length} de ${total}` }),
          el('button', { type: 'button', class: 'cp-button', text: 'Anteriores', disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - PAGE); showTable(table); } }),
          el('button', { type: 'button', class: 'cp-button', text: 'Próximas', disabled: !page.more && offset + page.rows.length >= total, onclick: () => { offset += PAGE; showTable(table); } }),
          current.type === 'table' ? el('button', { type: 'button', class: 'cp-button', text: 'Nova linha', onclick: addRow }) : null,
          el('small', { text: current.type === 'table' ? 'Duplo clique numa célula para editar (Enter salva, Esc cancela; NULL é nulo).' : 'Visão: só leitura.' }));
      } catch (error) { status.textContent = String(error?.message ?? error); }
    }
    async function addRow() {
      const values = {};
      for (const column of current.columns) { if (column.primaryKey && /INT/i.test(column.type)) continue; const typed = prompt(`${column.name} (${column.type || 'sem tipo'})${column.notNull ? ', obrigatório' : ''} — vazio deixa o padrão, NULL é nulo`, ''); if (typed === null) return; if (typed !== '') values[column.name] = cellValue(typed, column.type); }
      try { const result = await ask({ op: 'edit-row', db: name, table: current.name, change: { insert: values } }); status.textContent = `Linha adicionada${result.rowid !== undefined ? ` (rowid ${result.rowid})` : ''}.`; await load(); offset = Math.max(0, (current.rows ?? 1) - PAGE); await showTable(current.name); }
      catch (error) { status.textContent = String(error?.message ?? error); }
    }
    async function load() {
      const view = await ask({ op: 'overview' }); info = view.databases.find(db => db.name === name)?.tables ?? [];
      tables.replaceChildren(...info.map(t => el('li', {}, el('button', { type: 'button', 'data-table': t.name, onclick: () => { offset = 0; showTable(t.name); } }, el('strong', { text: t.name }), el('small', { text: `${t.type === 'view' ? 'visão · ' : ''}${t.rows ?? '?'} linhas` })))));
    }
    const run = el('button', { type: 'button', class: 'cp-button primary', text: 'Executar', onclick: async () => {
      status.textContent = 'Executando…';
      try { const result = await ask({ op: 'sql', db: name, sql: sqlBox.value, limit: 200 }); sqlOut.replaceChildren(result.kind === 'rows' ? resultTable(result, false) : el('p', { text: result.changes === null ? 'Comando executado.' : `${result.changes} linha(s) alterada(s).` })); status.textContent = result.kind === 'rows' ? `${result.rows.length}${result.more ? '+' : ''} linha(s).` : 'Pronto.'; if (result.kind !== 'rows') { await load(); if (current) await showTable(current.name); } }
      catch (error) { status.textContent = String(error?.message ?? error); }
    } });
    body.append(el('div', { class: 'appdata-db-main' }, el('nav', { class: 'appdata-side' }, el('h3', { text: 'Tabelas' }), tables), el('div', { class: 'appdata-content' }, pager, grid)),
      el('div', { class: 'appdata-sql' }, el('h3', { text: 'SQL' }), sqlBox, el('div', { class: 'em-actions' }, run), sqlOut), status,
      el('p', { class: 'cp-note', text: 'Uma segunda conexão ao banco do app (como o sqlite3 do adb): o app vê as mudanças na próxima consulta; observadores que ele mantém na própria conexão (Room) não são avisados — use Reabrir para recarregar a tela.' }));
    try { await load(); const first = info.find(t => t.type === 'table' && t.name !== 'android_metadata') ?? info[0]; if (first) await showTable(first.name); else status.textContent = 'Banco sem tabelas.'; } catch (error) { status.textContent = String(error?.message ?? error); }
    return modal;
  }

  return { refresh, openPrefs, openDatabase, reset() { overview = null; list?.replaceChildren(); if (summary) summary.textContent = '—'; setNote('Abra e inicie um app para ver os dados que ele guardou.'); } };
}
