// The "Activities ignoradas" section of the Controles panel (src/ignored-activities.js): a debugging tool that drops the starts of the Activities on the list. The section previews the
// Activities the manifest declares (click one to add it), keeps N rows per package in localStorage (every access guarded) and applies them live to the Worker; counts come back with
// every snapshot.
import { activityDescriptor } from './ignored-activities.js?v=07ce22d2e253';

const KEY_PREFIX = 'apkweb-ignored-activities-v1:';
const MAX_ROWS = 50;
function loadRows(pkg) {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(KEY_PREFIX + pkg) ?? '[]');
    return Array.isArray(list) ? list.slice(0, MAX_ROWS).map(row => ({ name: String(row?.name ?? '').slice(0, 300), enabled: row?.enabled !== false })) : [];
  } catch { return []; }
}
function saveRows(pkg, rows) { try { globalThis.localStorage?.setItem(KEY_PREFIX + pkg, JSON.stringify(rows)); } catch { /* storage unavailable: the rows last for this page only */ } }

export function createIgnoredActivitiesPanel({ $, vm }) {
  const S = { pkg: null, activities: [], launcher: null, rows: [], statuses: [], hits: new Map(), timer: null, sequence: 0 };
  const list = () => $('ia-list');
  const descriptorOf = name => activityDescriptor(name, S.pkg ?? '');

  function meta(row, index) {
    if (!row.name.trim()) return ['', ''];
    const descriptor = descriptorOf(row.name), status = S.statuses[index];
    if (!descriptor) return ['Nome inválido: use pacote.Classe, .Classe ou Lpacote/Classe;.', 'error'];
    if (status?.state === 'invalid' || status?.state === 'missing') return [status.error, 'error'];
    const hits = S.hits.get(descriptor) ?? status?.hits ?? 0, launcher = descriptor === S.launcher ? ' · é a Activity de abertura: o lançamento do app não é afetado, só as aberturas que o app pedir' : '';
    if (!row.enabled) return [`desligada${launcher}`, ''];
    return [`${hits} ${hits === 1 ? 'abertura descartada' : 'aberturas descartadas'}${launcher}`, 'ok'];
  }
  function updateMeta() {
    [...list().children].forEach((li, index) => { const [text, state] = meta(S.rows[index], index), element = li.querySelector('.ia-meta'); element.textContent = text; element.dataset.state = state; element.hidden = !text; });
    const active = S.rows.filter((row, index) => row.enabled && S.statuses[index]?.state === 'active'), starts = active.reduce((sum, row) => sum + (S.hits.get(descriptorOf(row.name)) ?? 0), 0);
    $('ia-summary').textContent = `${active.length} ${active.length === 1 ? 'ativa' : 'ativas'}`;
    $('ia-status').textContent = active.length ? `Activities ignoradas: ${active.length}, ${starts} ${starts === 1 ? 'abertura descartada' : 'aberturas descartadas'}. O relatório, o Resumo e o Logcat avisam.` : 'Nenhuma Activity ignorada.';
    renderAvailable();
  }
  function render() {
    list().replaceChildren(...S.rows.map((row, index) => {
      const li = document.createElement('li'); li.className = 'ia-row';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = row.enabled; check.setAttribute('aria-label', `Ativar a Activity ignorada ${index + 1}`);
      const name = document.createElement('input'); name.type = 'text'; name.className = 'ia-name'; name.value = row.name; name.spellcheck = false; name.autocomplete = 'off'; name.autocapitalize = 'off'; name.placeholder = 'pacote.NomeActivity'; name.setAttribute('list', 'ia-options'); name.setAttribute('aria-label', `Activity ignorada ${index + 1}`);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'cp-button ia-remove'; remove.textContent = 'Remover'; remove.setAttribute('aria-label', `Remover a Activity ignorada ${index + 1}`);
      const info = document.createElement('span'); info.className = 'ia-meta'; info.setAttribute('role', 'status');
      check.addEventListener('change', () => { row.enabled = check.checked; changed(true); });
      name.addEventListener('input', () => { row.name = name.value; changed(); });
      remove.addEventListener('click', () => { S.rows.splice(index, 1); S.statuses.splice(index, 1); render(); changed(true); });
      li.append(check, name, remove, info); return li;
    }));
    updateMeta();
  }
  /** The manifest's Activities, filtered by the search box, as buttons that add a row (already listed ones are marked). */
  function renderAvailable() {
    const container = $('ia-available'), query = $('ia-filter').value.trim().toLowerCase(), listed = new Set(S.rows.map(row => descriptorOf(row.name)).filter(Boolean));
    if (!S.pkg) { container.replaceChildren(Object.assign(document.createElement('li'), { className: 'ia-empty', textContent: 'Abra um APK para ver as Activities dele.' })); return; }
    const matches = S.activities.filter(activity => !query || activity.name.toLowerCase().includes(query));
    if (!matches.length) { container.replaceChildren(Object.assign(document.createElement('li'), { className: 'ia-empty', textContent: S.activities.length ? 'Nenhuma Activity com esse nome.' : 'O manifesto não declara Activities.' })); return; }
    container.replaceChildren(...matches.map(activity => {
      const li = document.createElement('li'), button = document.createElement('button'), descriptor = descriptorOf(activity.name), already = listed.has(descriptor);
      button.type = 'button'; button.disabled = already; button.title = already ? 'Já está na lista' : `Ignorar as aberturas de ${activity.name}`;
      const label = activity.name.startsWith(S.pkg + '.') ? activity.name.slice(S.pkg.length) : activity.name;
      button.textContent = `${label}${activity.launcher ? '  · abertura' : ''}${already ? '  · na lista' : ''}`;
      button.addEventListener('click', () => addRow({ name: activity.name, enabled: true }));
      li.append(button); return li;
    }));
  }
  function changed(now = false) { if (S.pkg) saveRows(S.pkg, S.rows); updateMeta(); clearTimeout(S.timer); S.timer = setTimeout(apply, now ? 0 : 250); }
  async function apply() {
    const token = ++S.sequence, send = [], map = [];
    for (const [index, row] of S.rows.entries()) { if (!row.name.trim()) { S.statuses[index] = undefined; continue; } send.push({ name: row.name, enabled: row.enabled }); map.push(index); }
    try {
      const statuses = vm.worker ? await vm.setIgnoredActivities(send) : [];
      if (token !== S.sequence) return;
      statuses.forEach((status, i) => { S.statuses[map[i]] = status; if (status.descriptor) S.hits.set(status.descriptor, status.hits); });
    } catch (error) { for (const index of map) S.statuses[index] = { state: 'invalid', error: `A VM não aplicou: ${error?.message ?? error}` }; }
    updateMeta();
  }
  function addRow(row) {
    if (S.rows.length >= MAX_ROWS) { $('ia-status').textContent = `No máximo ${MAX_ROWS} Activities ignoradas.`; return; }
    S.rows.push(row); render(); changed(true);
  }
  $('ia-filter').addEventListener('input', renderAvailable);
  $('ia-add').addEventListener('click', () => { addRow({ name: '', enabled: true }); const inputs = list().querySelectorAll('.ia-name'); inputs[inputs.length - 1]?.focus(); });
  renderAvailable();

  return {
    /** The APK was inspected: list its Activities, load this package's rows and give them to the VM before the app runs. */
    async attach(inventory) {
      S.pkg = inventory?.packageName ?? null;
      S.activities = (inventory?.activities ?? []).map(activity => typeof activity === 'string' ? { name: activity, launcher: false } : { name: activity.name, launcher: !!activity.launcher }).filter(activity => activity.name).sort((a, b) => (b.launcher - a.launcher) || a.name.localeCompare(b.name));
      S.launcher = inventory?.launcherActivity ? descriptorOf(inventory.launcherActivity) : null;
      $('ia-options').replaceChildren(...S.activities.map(activity => Object.assign(document.createElement('option'), { value: activity.name })));
      S.rows = S.pkg ? loadRows(S.pkg) : []; S.statuses = []; S.hits = new Map(); render();
      if (S.pkg && S.rows.length) { clearTimeout(S.timer); await apply(); }
    },
    detach() { S.pkg = null; S.activities = []; S.launcher = null; S.rows = []; S.statuses = []; S.hits = new Map(); clearTimeout(S.timer); $('ia-options').replaceChildren(); render(); },
    /** Live counts of the Worker's snapshot ([{ descriptor, hits, active }]). */
    hits(entries) { if (!Array.isArray(entries)) return; for (const entry of entries) S.hits.set(entry.descriptor, entry.hits); updateMeta(); },
    activeCount() { return S.rows.filter((row, index) => row.enabled && S.statuses[index]?.state === 'active').length; },
    get state() { return S; },
  };
}
