// The "Retornos de métodos" section of the Controles panel: a debugging tool that replaces the return value of methods of the running VM (src/method-overrides.js). Rows are saved per package
// in localStorage (key with the package name, every access guarded) and applied live to the Worker; hit counts come back with every snapshot.
import { parseMethodSpec, parseReturnValue, smaliTypeToJava } from './method-overrides.js?v=ebd42d0a624c';

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
    if (spec.name === '<clinit>') return { error: 'The static initializer (<clinit>) cannot be overridden.' };
    const value = parseReturnValue(spec.result, row.value);
    return value.ok ? { key: spec.key, result: spec.result } : { key: spec.key, result: spec.result, error: value.error };
  }
  function meta(row, index) {
    const local = inspect(row), status = S.statuses[index];
    if (local.empty) return ['', ''];
    if (local.error) return [local.error, 'error'];
    if (local.needsReturnType) return ['Java without a return type: the type will be looked up in the APK classes (or write package.Class.name(types): boolean).', ''];
    if (status?.state === 'invalid') return [status.error, 'error'];
    if (status?.state === 'refused' || status?.state === 'missing') return [status.error, 'error'];
    const hits = S.hits.get(local.key) ?? status?.hits ?? 0, type = smaliTypeToJava(local.result);
    if (!row.enabled) return [`off · returns ${type}`, ''];
    return [`${hits} ${hits === 1 ? 'call overridden' : 'calls overridden'} · returns ${type}`, 'ok'];
  }
  function updateMeta() {
    [...list().children].forEach((li, index) => { const [text, state] = meta(S.rows[index], index), element = li.querySelector('.ov-meta'); element.textContent = text; element.dataset.state = state; element.hidden = !text; });
    const active = S.rows.filter((row, index) => row.enabled && S.statuses[index]?.state === 'active'), calls = active.reduce((sum, row) => sum + (S.hits.get(inspect(row).key) ?? 0), 0);
    $('ov-summary').textContent = `${active.length} active`;
    $('ov-status').textContent = active.length ? `Overridden returns: ${active.length} ${active.length === 1 ? 'method' : 'methods'}, ${calls} ${calls === 1 ? 'call' : 'calls'}. The bodies of these methods do not run; the report and the Summary say so.` : 'No overridden returns.';
  }
  function render() {
    list().replaceChildren(...S.rows.map((row, index) => {
      const li = document.createElement('li'); li.className = 'ov-row';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = row.enabled; check.setAttribute('aria-label', `Turn on overridden return ${index + 1}`);
      const method = document.createElement('input'); method.type = 'text'; method.className = 'ov-method'; method.value = row.method; method.spellcheck = false; method.autocomplete = 'off'; method.autocapitalize = 'off'; method.placeholder = 'Lpkg/Class;->name(Params)Ret  or  pkg.Class.name(types)'; method.setAttribute('aria-label', `Method ${index + 1}`);
      const value = document.createElement('input'); value.type = 'text'; value.className = 'ov-value'; value.value = row.value; value.spellcheck = false; value.autocomplete = 'off'; value.placeholder = 'return value'; value.setAttribute('aria-label', `Return value ${index + 1}`);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'cp-button ov-remove'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove overridden return ${index + 1}`);
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
          if (returnTypes.length !== 1) { S.statuses[index] = { state: 'invalid', error: returnTypes.length ? `More than one possible return (${returnTypes.map(smaliTypeToJava).join(', ')}): write the type, e.g.: ${row.method.trim()}: ${smaliTypeToJava(returnTypes[0])}` : 'No method with this name and parameters in the APK classes.' }; continue; }
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
    } catch (error) { for (const index of map) S.statuses[index] = { state: 'invalid', error: `The VM did not apply it: ${error?.message ?? error}` }; }
    updateMeta();
  }

  // ---- search in the APK's DEX ----
  function renderResults(methods, message) {
    const results = $('ov-results'); results.replaceChildren();
    if (message) { const li = document.createElement('li'); li.className = 'ov-empty'; li.textContent = message; results.append(li); }
    for (const method of methods) {
      const li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.textContent = `${method.key}${method.abstract ? '  (abstract)' : method.native ? '  (native)' : ''}`;
      button.disabled = !!(method.abstract || method.native); button.title = method.abstract ? 'Abstract method: it has no body to replace' : method.native ? 'Native method: it is not replaced' : method.key;
      button.addEventListener('click', () => { addRow({ method: method.key, value: defaultValueFor(method.result), enabled: false }); $('ov-search').value = ''; $('ov-results').hidden = true; });
      li.append(button); results.append(li);
    }
    results.hidden = !methods.length && !message;
  }
  $('ov-search').addEventListener('input', () => {
    clearTimeout(S.searchTimer); const query = $('ov-search').value.trim();
    if (!query) { $('ov-results').hidden = true; return; }
    S.searchTimer = setTimeout(async () => {
      if (!vm.worker || !S.pkg) { renderResults([], 'Open an APK to search for methods.'); return; }
      try { const { methods } = await vm.searchMethods({ query }); renderResults(methods, methods.length ? (methods.length >= 40 ? '' : '') : 'No method found. Use parts of the class and method names.'); }
      catch (error) { renderResults([], `Search unavailable: ${error?.message ?? error}`); }
    }, 200);
  });
  function addRow(row) {
    if (S.rows.length >= MAX_ROWS) { $('ov-status').textContent = `At most ${MAX_ROWS} overridden returns.`; return; }
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
    /** "App modified" (src/method-hooks-panel.js) removed the change of `key` (smali form): its rows leave the list and the VM is told. Returns whether a row went. */
    removeKey(key) {
      const keep = S.rows.map((row, index) => inspect(row).key !== key && S.statuses[index]?.key !== key);
      if (keep.every(Boolean)) return false;
      S.rows = S.rows.filter((_, index) => keep[index]); S.statuses = S.statuses.filter((_, index) => keep[index]); render(); changed(true); return true;
    },
    /** How many overrides the VM reports as active (for the report header). */
    activeCount() { return S.rows.filter((row, index) => row.enabled && S.statuses[index]?.state === 'active').length; },
    get state() { return S; },
  };
}
