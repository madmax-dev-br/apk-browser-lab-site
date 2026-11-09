// The "Permissões" section of the Controles panel and the permission dialog shown over the phone screen. State per package lives in localStorage (key with the package name, every access
// guarded); the simulated location lives in the device settings. The rules (what a request does, rationale, "don't ask again") are src/runtime-permissions.js, shared with the VM.
import { answerDialog, computeGranted, emptyConfig, listRuntimePermissions, sanitizeConfig, setState } from './runtime-permissions.js?v=27f6f95f2fc8';
export { DEFAULT_LOCATION, sanitizeLocation } from './runtime-permissions.js?v=27f6f95f2fc8';

const KEY_PREFIX = 'apkweb-permissions-v1:';
export const PERMISSION_ICONS = {
  LOCATION: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
  MICROPHONE: 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  CAMERA: 'M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z',
  OTHER: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
};
const shortName = name => name.replace(/^android\.permission\./, '').replace(/^com\.android\./, '');

const storageKey = pkg => KEY_PREFIX + pkg;
function loadConfig(pkg) { try { const text = globalThis.localStorage?.getItem(storageKey(pkg)); return text ? { ...sanitizeConfig(JSON.parse(text)), once: [] } : emptyConfig(); } catch { return emptyConfig(); } }
function saveConfig(pkg, config) { try { globalThis.localStorage?.setItem(storageKey(pkg), JSON.stringify({ states: config.states, denials: config.denials })); } catch { /* storage unavailable: the state lasts for this page only */ } }
function clearConfig(pkg) { try { globalThis.localStorage?.removeItem(storageKey(pkg)); } catch { /* storage unavailable */ } }

/**
 * @param $            document.getElementById
 * @param vm           the APKWorkerClient (setPermissions, permissionResponse, onPermissionRequest)
 * @param location     { get(): the saved location block, set(block): save it in the device settings }
 */
export function createPermissionsPanel({ $, vm, location }) {
  const S = { pkg: null, manifest: null, list: [], config: emptyConfig(), queue: [], open: null, revokedNote: '' };
  const SELECT_LABELS = [['ask', 'Perguntar'], ['allow', 'Permitir'], ['deny', 'Negar']];
  const push = payload => { if (!vm.worker) return Promise.resolve(); return vm.setPermissions({ dialogs: true, ...payload }).catch(() => { /* the VM is busy or gone: the state is re-sent when the APK is opened again */ }); };

  function stateNote(entry) {
    const state = S.config.states[entry.name] ?? 'ask', denials = S.config.denials[entry.name] ?? 0, granted = computeGranted(S.config, S.manifest).has(entry.name);
    if (!entry.applicable) return entry.note;
    if (S.config.once.includes(entry.name)) return 'concedida só desta vez (até o app encerrar)';
    if (state === 'ask' && denials >= 2) return 'negada 2 vezes: o Android não mostra mais o diálogo (o pedido é negado na hora)';
    if (state === 'ask' && denials === 1) return 'negada 1 vez: o app pode mostrar uma explicação antes de pedir de novo';
    if (state === 'ask' && granted) return entry.note;
    return entry.note || '';
  }
  function render() {
    const list = $('perms-list'), empty = $('perms-empty'); list.replaceChildren();
    empty.hidden = S.list.length > 0; list.hidden = S.list.length === 0;
    if (!S.pkg) empty.textContent = 'Abra um APK para ver as permissões de execução (perigosas) que o app pede no manifesto.';
    else if (!S.list.length) empty.textContent = 'O manifesto deste app não pede permissões de execução (perigosas). As permissões normais são concedidas na instalação.';
    const granted = S.pkg ? computeGranted(S.config, S.manifest) : new Set();
    $('perms-summary').textContent = !S.pkg ? 'sem app' : S.list.length ? `${S.list.filter(item => granted.has(item.name)).length} de ${S.list.length} concedidas` : 'nenhuma pedida';
    $('perms-reset').disabled = !S.pkg;
    let currentLabel = null, group = null;
    for (const entry of S.list) {
      if (entry.label !== currentLabel) {
        currentLabel = entry.label; group = document.createElement('div'); group.className = 'perm-group'; const title = document.createElement('h4'); title.className = 'perm-group-title'; title.textContent = entry.label; group.append(title); list.append(group);
      }
      const row = document.createElement('div'); row.className = 'perm-row';
      const name = document.createElement('span'); name.className = 'perm-name'; name.title = entry.name; name.textContent = shortName(entry.name);
      const select = document.createElement('select'); select.id = 'perm-' + entry.name.replace(/[^A-Za-z0-9]+/g, '-'); select.setAttribute('aria-label', `${entry.label}: ${shortName(entry.name)}`);
      for (const [value, label] of SELECT_LABELS) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
      select.value = S.config.states[entry.name] ?? 'ask'; select.disabled = !entry.applicable;
      select.addEventListener('change', () => change(entry, select.value));
      row.append(name, select);
      const note = stateNote(entry); if (note) { const small = document.createElement('span'); small.className = 'perm-state'; small.textContent = note; row.append(small); }
      group.append(row);
    }
  }
  function change(entry, state) {
    const before = computeGranted(S.config, S.manifest).has(entry.name);
    S.config = setState(S.config, entry.name, state);
    const after = computeGranted(S.config, S.manifest).has(entry.name);
    if (before && !after) $('perms-note').textContent = `${shortName(entry.name)} revogada. No Android o processo do app seria encerrado agora; aqui a revogação vale na hora e o app continua rodando. Reabra o APK para vê-lo recomeçar sem a permissão.`;
    else if (!before && after) $('perms-note').textContent = `${shortName(entry.name)} concedida: vale já na próxima verificação do app (checkSelfPermission).`;
    commit();
  }
  function commit() { if (S.pkg) saveConfig(S.pkg, S.config); render(); push({ config: S.config }); }

  // ---- the dialog over the phone ----
  const scrim = () => $('permission-dialog');
  function closeDialog() {
    const dialog = scrim(); dialog.hidden = true; $('perm-allow').onclick = $('perm-once').onclick = $('perm-deny').onclick = null; dialog.onkeydown = null;
    const content = $('android-content'), layer = $('android-window-layer'); if (S.open?.inertBefore) { content.inert = S.open.inertBefore.content; layer.inert = S.open.inertBefore.layer; }
    const focusBack = S.open?.focusBack; S.open = null; try { focusBack?.focus?.(); } catch { /* the element is gone */ }
  }
  function showNext() {
    if (S.open || !S.queue.length) return;
    const item = S.queue[0], { request, index } = item, dialog = request.dialogs[index], dialogEl = scrim();
    const content = $('android-content'), layer = $('android-window-layer');
    S.open = { item, focusBack: document.activeElement, inertBefore: { content: content.inert, layer: layer.inert } }; content.inert = true; layer.inert = true;   // modal: the app below does not take input
    dialogEl.classList.toggle('dark', !!document.getElementById('dev-dark')?.checked);
    $('perm-question').textContent = dialog.question.replace('%s', request.appLabel);
    $('perm-detail').textContent = dialog.permissions.map(shortName).join(', ');
    $('perm-icon').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PERMISSION_ICONS[dialog.group] ?? PERMISSION_ICONS.OTHER}"/></svg>`;
    $('perm-allow').textContent = dialog.oneTime ? 'Enquanto o app está em uso' : 'Permitir'; $('perm-once').hidden = !dialog.oneTime;
    const answer = choice => { const taken = S.open; closeDialog(); finish(taken.item, choice); };
    $('perm-allow').onclick = () => answer('allow'); $('perm-once').onclick = () => answer('once'); $('perm-deny').onclick = () => answer('deny');
    dialogEl.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); const taken = S.open; closeDialog(); finish(taken.item, null); return; }   // dismissed
      if (event.key !== 'Tab') return;
      const buttons = ['perm-allow', 'perm-once', 'perm-deny'].map($).filter(button => !button.hidden), first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialogEl.hidden = false; $('perm-allow').focus();
  }
  function finish(item, choice) {
    const { request, index } = item;
    if (choice === null) { S.queue.shift(); vm.permissionResponse(request.id, null); showNext(); return; }   // dismissed: the VM treats it as a denial
    S.config = answerDialog(S.config, S.manifest, request.dialogs[index], choice);
    if (index + 1 < request.dialogs.length) item.index = index + 1;
    else { S.queue.shift(); vm.permissionResponse(request.id, S.config); }
    saveConfig(S.pkg, S.config); render(); showNext();
  }
  vm.onPermissionRequest = request => {
    if (!S.pkg) { vm.permissionResponse(request.id, null); return; }
    S.config = sanitizeConfig(request.config ?? S.config);   // the VM's copy is the newest (it may have counted a denial)
    S.queue.push({ request, index: 0 }); showNext();
  };
  vm.onPermissionConfig = config => { S.config = sanitizeConfig(config); if (S.pkg) saveConfig(S.pkg, S.config); render(); };

  // ---- the simulated location ----
  function writeLocation() {
    const block = location.get(); $('loc-enabled').checked = block.enabled;
    for (const [id, value] of [['loc-lat', block.latitude], ['loc-lon', block.longitude], ['loc-acc', block.accuracy]]) if (document.activeElement !== $(id)) { $(id).value = String(value); $(id).removeAttribute('aria-invalid'); }
  }
  function readLocation() {
    const fields = [['loc-lat', -90, 90, 'Latitude'], ['loc-lon', -180, 180, 'Longitude'], ['loc-acc', 0, 100000, 'Precisão']], values = [];
    for (const [id, lo, hi, label] of fields) {
      const text = $(id).value.trim().replace(',', '.'), n = Number(text), valid = text !== '' && Number.isFinite(n) && n >= lo && n <= hi;
      if (valid) $(id).removeAttribute('aria-invalid'); else { $(id).setAttribute('aria-invalid', 'true'); $('loc-note').textContent = `${label}: informe um número entre ${lo} e ${hi}. O valor anterior continua valendo.`; return null; }
      values.push(n);
    }
    return { enabled: $('loc-enabled').checked, latitude: values[0], longitude: values[1], accuracy: values[2] };
  }
  function onLocationInput() {
    const block = readLocation(); if (!block) return;
    $('loc-note').textContent = block.enabled ? 'Localização ligada: LocationManager entrega esta posição ao app (com a permissão concedida) e avisa os listeners quando ela muda.' : 'Localização desligada: isLocationEnabled e isProviderEnabled são falsos, sem posição para o app.';
    location.set(block); push({ location: block });
  }
  for (const id of ['loc-enabled', 'loc-lat', 'loc-lon', 'loc-acc']) $(id).addEventListener('input', onLocationInput);
  $('perms-reset').addEventListener('click', () => { if (!S.pkg) return; clearConfig(S.pkg); S.config = emptyConfig(); $('perms-note').textContent = 'Permissões deste app restauradas para "Perguntar".'; render(); push({ config: S.config }); });

  return {
    /** The APK was inspected: list its runtime permissions, load the saved state and give both (and the location) to the VM before the app runs. */
    async attach(inventory) {
      if (S.open) closeDialog(); S.queue.length = 0;
      S.pkg = inventory?.packageName ?? null; S.manifest = inventory ? { usesSdk: inventory.usesSdk, usesPermissions: inventory.usesPermissions ?? [], declaredPermissions: inventory.declaredPermissions ?? [] } : null;
      S.list = S.manifest ? listRuntimePermissions(S.manifest) : []; S.config = S.pkg ? loadConfig(S.pkg) : emptyConfig(); render(); writeLocation();
      if (S.pkg) await push({ config: S.config, location: location.get() });
    },
    /** The VM went away (reopen, stop): a dialog that waited for it has nothing to answer. */
    detach() { if (S.open) closeDialog(); S.queue.length = 0; },
    refreshLocation: writeLocation,
    get state() { return S; },
  };
}
