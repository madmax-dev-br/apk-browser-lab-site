// The "Retornos de métodos" section of the Controles panel: a debugging tool that replaces the return value of methods of the running VM (src/method-overrides.js). Rows are saved per package
// in localStorage (key with the package name, every access guarded) and applied live to the Worker; hit counts come back with every snapshot.
import { parseMethodSpec, parseReturnValue, smaliTypeToJava } from './method-overrides.js?v=eed27b762f3e';

const KEY_PREFIX = 'apkweb-overrides-v1:';
const MAX_ROWS = 50;
function loadRows(pkg) {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(KEY_PREFIX + pkg) ?? '[]');
    return Array.isArray(list) ? list.slice(0, MAX_ROWS).map(row => ({ method: String(row?.method ?? '').slice(0, 600), value: String(row?.value ?? '').slice(0, 2000), enabled: row?.enabled !== false })) : [];
  } catch { return []; }
}
function saveRows(pkg, rows) { try { globalThis.localStorage?.setItem(KEY_PREFIX + pkg, JSON.stringify(rows)); } catch { /* storage unavailable: the rows last for this page only */ } }
const defaultValueFor = result => result === 'Z' ? 'false' : result === 'V' ? '' : /^[BSCIJFD]$/.test(result) ? '0' : 'null';

export function createOverridesPanel({ $, vm }) {
  const S = { pkg: null, rows: [], statuses: [], hits: new Map(), timer: null, searchTimer: null, sequence: 0 };
  const list = () => $('ov-list');

  /** Local check of a row: { key, result, error } (error is the reason shown under the row). */
  function inspect(row) {
    if (!row.method.trim()) return { error: null, empty: true };
    const spec = parseMethodSpec(row.method);
    if (!spec.ok) return { error: spec.error };
    if (spec.result === null) return { error: null, needsReturnType: spec };
    if (spec.name === '<clinit>') return { error: 'O inicializador estático (<clinit>) não pode ser substituído.' };
    const value = parseReturnValue(spec.result, row.value);
    return value.ok ? { key: spec.key, result: spec.result } : { key: spec.key, result: spec.result, error: value.error };
  }
  function meta(row, index) {
    const local = inspect(row), status = S.statuses[index];
    if (local.empty) return ['', ''];
    if (local.error) return [local.error, 'error'];
    if (local.needsReturnType) return ['Java sem tipo de retorno: o tipo será buscado nas classes do APK (ou escreva pacote.Classe.nome(tipos): boolean).', ''];
    if (status?.state === 'invalid') return [status.error, 'error'];
    if (status?.state === 'refused' || status?.state === 'missing') return [status.error, 'error'];
    const hits = S.hits.get(local.key) ?? status?.hits ?? 0, type = smaliTypeToJava(local.result);
    if (!row.enabled) return [`desligado · retorna ${type}`, ''];
    return [`${hits} ${hits === 1 ? 'chamada substituída' : 'chamadas substituídas'} · retorna ${type}`, 'ok'];
  }
  function updateMeta() {
    [...list().children].forEach((li, index) => { const [text, state] = meta(S.rows[index], index), element = li.querySelector('.ov-meta'); element.textContent = text; element.dataset.state = state; element.hidden = !text; });
    const active = S.rows.filter((row, index) => row.enabled && S.statuses[index]?.state === 'active'), calls = active.reduce((sum, row) => sum + (S.hits.get(inspect(row).key) ?? 0), 0);
    $('ov-summary').textContent = `${active.length} ${active.length === 1 ? 'ativo' : 'ativos'}`;
    $('ov-status').textContent = active.length ? `Retornos substituídos: ${active.length} ${active.length === 1 ? 'método' : 'métodos'}, ${calls} ${calls === 1 ? 'chamada' : 'chamadas'}. Os corpos desses métodos não executam; o relatório e o Resumo avisam.` : 'Nenhum retorno substituído.';
  }
  function render() {
    list().replaceChildren(...S.rows.map((row, index) => {
      const li = document.createElement('li'); li.className = 'ov-row';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = row.enabled; check.setAttribute('aria-label', `Ativar o retorno substituído ${index + 1}`);
      const method = document.createElement('input'); method.type = 'text'; method.className = 'ov-method'; method.value = row.method; method.spellcheck = false; method.autocomplete = 'off'; method.autocapitalize = 'off'; method.placeholder = 'Lpkg/Classe;->nome(Params)Ret  ou  pkg.Classe.nome(tipos)'; method.setAttribute('aria-label', `Método ${index + 1}`);
      const value = document.createElement('input'); value.type = 'text'; value.className = 'ov-value'; value.value = row.value; value.spellcheck = false; value.autocomplete = 'off'; value.placeholder = 'valor de retorno'; value.setAttribute('aria-label', `Valor de retorno ${index + 1}`);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'cp-button ov-remove'; remove.textContent = 'Remover'; remove.setAttribute('aria-label', `Remover o retorno substituído ${index + 1}`);
      const info = document.createElement('span'); info.className = 'ov-meta'; info.setAttribute('role', 'status');
      check.addEventListener('change', () => { row.enabled = check.checked; changed(true); });
      method.addEventListener('input', () => { row.method = method.value; changed(); });
      value.addEventListener('input', () => { row.value = value.value; changed(); });
      remove.addEventListener('click', () => { S.rows.splice(index, 1); S.statuses.splice(index, 1); render(); changed(true); });
      li.append(check, method, value, remove, info); return li;
    }));
    updateMeta();
  }
  function changed(now = false) { if (S.pkg) saveRows(S.pkg, S.rows); updateMeta(); clearTimeout(S.timer); S.timer = setTimeout(apply, now ? 0 : 250); }

  /** Sends the rows to the VM. A Java-form row without a return type is completed from the APK's own methods first (exactly one candidate, else the reason is shown). */
  async function apply() {
    const token = ++S.sequence, send = [], map = [];
    for (const [index, row] of S.rows.entries()) {
      const local = inspect(row); if (local.empty) { S.statuses[index] = undefined; continue; }
      let method = row.method;
      if (local.needsReturnType) {
        try {
          const { returnTypes } = await vm.searchMethods({ owner: local.needsReturnType.owner, name: local.needsReturnType.name, parameters: local.needsReturnType.parameters });
          if (returnTypes.length !== 1) { S.statuses[index] = { state: 'invalid', error: returnTypes.length ? `Mais de um retorno possível (${returnTypes.map(smaliTypeToJava).join(', ')}): escreva o tipo, ex.: ${row.method.trim()}: ${smaliTypeToJava(returnTypes[0])}` : 'Nenhum método com este nome e parâmetros nas classes do APK.' }; continue; }
          const spec = local.needsReturnType; method = `${spec.owner}->${spec.name}(${spec.parameters.join('')})${returnTypes[0]}`;
        } catch (error) { S.statuses[index] = { state: 'invalid', error: error?.message ?? String(error) }; continue; }
      }
      send.push({ method, value: row.value, enabled: row.enabled }); map.push(index);
    }
    if (token !== S.sequence) return;
    try {
      const statuses = vm.worker ? await vm.setMethodOverrides(send) : [];
      if (token !== S.sequence) return;
      statuses.forEach((status, i) => { S.statuses[map[i]] = status; S.hits.set(status.key, status.hits); });
    } catch (error) { for (const index of map) S.statuses[index] = { state: 'invalid', error: `A VM não aplicou: ${error?.message ?? error}` }; }
    updateMeta();
  }

  // ---- search in the APK's DEX ----
  function renderResults(methods, message) {
    const results = $('ov-results'); results.replaceChildren();
    if (message) { const li = document.createElement('li'); li.className = 'ov-empty'; li.textContent = message; results.append(li); }
    for (const method of methods) {
      const li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.textContent = `${method.key}${method.abstract ? '  (abstrato)' : method.native ? '  (native)' : ''}`;
      button.disabled = !!(method.abstract || method.native); button.title = method.abstract ? 'Método abstrato: não tem corpo para substituir' : method.native ? 'Método native: não é substituído' : method.key;
      button.addEventListener('click', () => { addRow({ method: method.key, value: defaultValueFor(method.result), enabled: false }); $('ov-search').value = ''; $('ov-results').hidden = true; });
      li.append(button); results.append(li);
    }
    results.hidden = !methods.length && !message;
  }
  $('ov-search').addEventListener('input', () => {
    clearTimeout(S.searchTimer); const query = $('ov-search').value.trim();
    if (!query) { $('ov-results').hidden = true; return; }
    S.searchTimer = setTimeout(async () => {
      if (!vm.worker || !S.pkg) { renderResults([], 'Abra um APK para buscar métodos.'); return; }
      try { const { methods } = await vm.searchMethods({ query }); renderResults(methods, methods.length ? (methods.length >= 40 ? '' : '') : 'Nenhum método encontrado. Use partes do nome da classe e do método.'); }
      catch (error) { renderResults([], `Busca indisponível: ${error?.message ?? error}`); }
    }, 200);
  });
  function addRow(row) {
    if (S.rows.length >= MAX_ROWS) { $('ov-status').textContent = `No máximo ${MAX_ROWS} retornos substituídos.`; return; }
    S.rows.push(row); render(); changed(true); const inputs = list().querySelectorAll('.ov-method'); inputs[inputs.length - 1]?.focus();
  }
  $('ov-add').addEventListener('click', () => addRow({ method: '', value: '', enabled: true }));

  return {
    /** The APK was inspected: load this package's rows and give them to the VM before the app runs. */
    async attach(inventory) {
      S.pkg = inventory?.packageName ?? null; S.rows = S.pkg ? loadRows(S.pkg) : []; S.statuses = []; S.hits = new Map(); render();
      if (S.pkg && S.rows.length) { clearTimeout(S.timer); await apply(); }
    },
    detach() { S.pkg = null; S.rows = []; S.statuses = []; S.hits = new Map(); clearTimeout(S.timer); render(); },
    /** Live hit counts of the Worker's snapshot ([{ key, hits, value, enabled }]). */
    hits(entries) { if (!Array.isArray(entries)) return; for (const entry of entries) S.hits.set(entry.key, entry.hits); updateMeta(); },
    /** How many overrides the VM reports as active (for the report header). */
    activeCount() { return S.rows.filter((row, index) => row.enabled && S.statuses[index]?.state === 'active').length; },
    get state() { return S; },
  };
}
