// Runtime ("dangerous") permissions of the virtual device: the model shared by the page (the "Permissões" section and the permission dialog) and the VM (checkSelfPermission,
// requestPermissions, shouldShowRequestPermissionRationale). DOM-free, no process.*: it runs in the Worker and the page.
//
// Per permission the tester chooses a state, like Settings > Apps > Permissions:  ask (Android's default: not granted, requestPermissions shows a dialog), allow, deny.
// The config is   { states: { [permission]: 'ask' | 'allow' | 'deny' }, denials: { [permission]: n }, once: [permission, ...] }
//   denials: how many times the user tapped "Não permitir" in a dialog; the second denial is "don't ask again" (Android 11+: the dialog is no longer shown, the answer is denied at once).
//   once: permissions granted with "Só desta vez": they last until the app process ends (the VM reload), never stored.
// Rules implemented (AOSP android-13.0.0_r1 behaviour, device SDK_INT 33):
//   - only permissions the manifest requests (and whose maxSdkVersion allows API 33) can be granted; a request for any other permission is denied without a dialog;
//   - normal permissions are granted at install; signature/privileged ones never reach a third-party app;
//   - an app with targetSdk < 23 gets its runtime permissions at install (state "ask" means granted, the dialog never shows; "deny" revokes);
//   - ACCESS_BACKGROUND_LOCATION is only grantable while a foreground location permission is held, and (targetSdk >= 30) cannot be requested in the same call as the foreground ones;
//   - READ_EXTERNAL_STORAGE has no effect for targetSdk >= 33 (use READ_MEDIA_*): never granted;
//   - requests that need a dialog are asked per permission group; the dialog's answer ("Permitir", "Só desta vez", "Não permitir") updates the config.
import { FRAMEWORK_PERMISSIONS } from './permission-data.js?v=f0166ffeffb5';
import { PERMISSION_GROUPS } from './permission-groups-data.js?v=f0166ffeffb5';

export const DEVICE_SDK = 33;
const P = 'android.permission.';
export const BACKGROUND_LOCATION = P + 'ACCESS_BACKGROUND_LOCATION', FINE_LOCATION = P + 'ACCESS_FINE_LOCATION', COARSE_LOCATION = P + 'ACCESS_COARSE_LOCATION';
const FOREGROUND_LOCATION = [FINE_LOCATION, COARSE_LOCATION];

/** Settings-style sections: platform permission group -> the label the page shows and the dialog's question ("%s" is the app label). */
export const SECTIONS = Object.freeze({
  LOCATION: { id: 'location', label: 'Localização', question: 'Permitir que %s acesse o local deste dispositivo?', order: 0 },
  CAMERA: { id: 'camera', label: 'Câmera', question: 'Permitir que %s tire fotos e grave vídeos?', order: 1 },
  MICROPHONE: { id: 'microphone', label: 'Microfone', question: 'Permitir que %s grave áudio?', order: 2 },
  CONTACTS: { id: 'contacts', label: 'Contatos', question: 'Permitir que %s acesse seus contatos?', order: 3 },
  NOTIFICATIONS: { id: 'notifications', label: 'Notificações', question: 'Permitir que %s envie notificações?', order: 4 },
  STORAGE: { id: 'files', label: 'Arquivos e mídia', question: 'Permitir que %s acesse fotos, mídia e arquivos no seu dispositivo?', order: 5 },
  READ_MEDIA_AURAL: { id: 'files', label: 'Arquivos e mídia', question: 'Permitir que %s acesse músicas e outros arquivos de áudio no seu dispositivo?', order: 5 },
  READ_MEDIA_VISUAL: { id: 'files', label: 'Arquivos e mídia', question: 'Permitir que %s acesse fotos e vídeos no seu dispositivo?', order: 5 },
  PHONE: { id: 'phone', label: 'Telefone', question: 'Permitir que %s faça e gerencie ligações telefônicas?', order: 6 },
  CALL_LOG: { id: 'calllog', label: 'Registro de chamadas', question: 'Permitir que %s leia e grave o registro de chamadas do telefone?', order: 7 },
  SMS: { id: 'sms', label: 'SMS', question: 'Permitir que %s envie e veja mensagens SMS?', order: 8 },
  CALENDAR: { id: 'calendar', label: 'Agenda', question: 'Permitir que %s acesse sua agenda?', order: 9 },
  SENSORS: { id: 'sensors', label: 'Sensores', question: 'Permitir que %s acesse os dados de sensor sobre seus sinais vitais?', order: 10 },
  NEARBY_DEVICES: { id: 'nearby', label: 'Dispositivos próximos', question: 'Permitir que %s encontre, conecte-se e determine a posição relativa de dispositivos por perto?', order: 11 },
  ACTIVITY_RECOGNITION: { id: 'activity', label: 'Atividade física', question: 'Permitir que %s acesse sua atividade física?', order: 12 },
});
export const OTHER_SECTION = Object.freeze({ id: 'other', label: 'Outras', question: 'Permitir que %s use esta permissão?', order: 99 });
export const sectionOf = group => SECTIONS[group] ?? OTHER_SECTION;
/** Platform group of a runtime permission (UNDEFINED / unknown / app-defined: null). */
export const groupOf = permission => { const group = PERMISSION_GROUPS[permission]; return group && SECTIONS[group] ? group : null; };

export const levelOf = permission => String(FRAMEWORK_PERMISSIONS[permission] ?? '').split('|')[0];
const targetSdkOf = manifest => { const value = Number(manifest?.usesSdk?.targetSdkVersion); return Number.isFinite(value) && value > 0 ? value : 1; };
/** The manifest's request for `permission` that applies on API 33 (maxSdkVersion honoured), or undefined. */
export const requestOf = (manifest, permission) => (manifest?.usesPermissions ?? []).find(entry => entry.name === permission && (entry.maxSdkVersion === null || entry.maxSdkVersion === undefined || Number(entry.maxSdkVersion) >= DEVICE_SDK));

/**
 * The runtime permissions the manifest requests, for the page: [{ name, group, section, label, applicable, note }] sorted by section. Permissions with maxSdkVersion < 33 and the ones
 * Android 13 ignores for this targetSdk are listed with applicable: false and the reason, never hidden. Normal and signature permissions are not runtime permissions and are not listed.
 */
export function listRuntimePermissions(manifest) {
  const targetSdk = targetSdkOf(manifest), seen = new Set(), out = [];
  for (const entry of manifest?.usesPermissions ?? []) {
    const name = entry.name; if (seen.has(name)) continue;
    const declared = (manifest.declaredPermissions ?? []).some(own => own.name === name);
    if (!declared && levelOf(name) !== 'dangerous') continue;
    seen.add(name);
    const group = groupOf(name), section = sectionOf(group);
    let applicable = true, note = '';
    if (!(entry.maxSdkVersion === null || entry.maxSdkVersion === undefined || Number(entry.maxSdkVersion) >= DEVICE_SDK)) { applicable = false; note = `maxSdkVersion ${entry.maxSdkVersion}: não vale no Android ${DEVICE_SDK}`; }
    else if (name === P + 'READ_EXTERNAL_STORAGE' && targetSdk >= 33) { applicable = false; note = 'sem efeito com targetSdk 33 ou maior: use READ_MEDIA_*'; }
    else if (name === P + 'WRITE_EXTERNAL_STORAGE' && targetSdk >= 30) note = 'sem acesso extra com armazenamento com escopo (targetSdk 30 ou maior)';
    else if (name === BACKGROUND_LOCATION) note = 'só pode ser concedida depois da localização em primeiro plano';
    else if (targetSdk < 23) note = 'app antigo (targetSdk menor que 23): concedida na instalação, sem diálogo';
    out.push({ name, group, section: section.id, label: section.label, applicable, note, order: section.order });
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export const emptyConfig = () => ({ states: {}, denials: {}, once: [] });
const STATES = ['ask', 'allow', 'deny'];
export function sanitizeConfig(input) {
  const out = emptyConfig(); if (!input || typeof input !== 'object') return out;
  for (const [name, state] of Object.entries(input.states ?? {})) if (typeof name === 'string' && name.length < 200 && STATES.includes(state) && Object.keys(out.states).length < 500) out.states[name] = state;
  for (const [name, count] of Object.entries(input.denials ?? {})) if (typeof name === 'string' && name.length < 200 && Number.isInteger(count) && count > 0 && Object.keys(out.denials).length < 500) out.denials[name] = Math.min(count, 99);
  if (Array.isArray(input.once)) out.once = input.once.filter(name => typeof name === 'string' && name.length < 200).slice(0, 200);
  return out;
}
export const stateOf = (config, permission) => config?.states?.[permission] ?? 'ask';
const fixed = (config, permission) => (config?.denials?.[permission] ?? 0) >= 2;

/** Whether a permission that is a runtime permission for this app can be granted by the user at all. */
function grantable(manifest, permission) {
  const targetSdk = targetSdkOf(manifest);
  if (!requestOf(manifest, permission)) return false;
  if (permission === P + 'READ_EXTERNAL_STORAGE' && targetSdk >= 33) return false;
  return true;
}
const isRuntime = (manifest, permission) => levelOf(permission) === 'dangerous' && !(manifest?.declaredPermissions ?? []).some(own => own.name === permission);

/** The runtime permissions the app holds right now: the set `platform.grantedPermissions` carries (holdsPermission adds the install-time normal ones). */
export function computeGranted(config, manifest) {
  const targetSdk = targetSdkOf(manifest), granted = new Set();
  for (const entry of manifest?.usesPermissions ?? []) {
    const name = entry.name; if (granted.has(name) || !isRuntime(manifest, name) || !grantable(manifest, name)) continue;
    const state = stateOf(config, name);
    if (state === 'allow' || config.once?.includes(name) || (state === 'ask' && targetSdk < 23 && !fixed(config, name))) granted.add(name);
  }
  if (granted.has(BACKGROUND_LOCATION) && !FOREGROUND_LOCATION.some(name => granted.has(name))) granted.delete(BACKGROUND_LOCATION);   // background location only on top of a foreground grant
  return granted;
}

/** Activity.shouldShowRequestPermissionRationale: true after one denial that did not become "don't ask again"; false for granted, never asked, denied twice or denied in Settings. */
export function rationale(config, manifest, permission) {
  if (!isRuntime(manifest, permission) || !grantable(manifest, permission)) return false;
  if (computeGranted(config, manifest).has(permission)) return false;
  if (stateOf(config, permission) !== 'ask') return false;
  const denials = config?.denials?.[permission] ?? 0;
  return denials === 1;
}

/**
 * The plan for one requestPermissions call: { results: { [permission]: true | false | null }, dialogs: [{ group, section, permissions }] }.
 * results: true granted, false denied, null decided by the dialogs. A call that is not valid on Android 11+ (background location with foreground ones) is denied as a whole.
 */
export function planRequest(config, manifest, names) {
  const targetSdk = targetSdkOf(manifest), granted = computeGranted(config, manifest), results = {}, groups = new Map();
  const mixedBackground = targetSdk >= 30 && names.includes(BACKGROUND_LOCATION) && names.some(name => FOREGROUND_LOCATION.includes(name));
  for (const name of names) {
    if (name in results) continue;
    if (mixedBackground) { results[name] = false; continue; }
    if (!requestOf(manifest, name)) { results[name] = false; continue; }                  // not requested in the manifest: denied without a dialog
    if (!isRuntime(manifest, name)) { results[name] = holdsInstallTime(manifest, name); continue; }
    if (!grantable(manifest, name)) { results[name] = false; continue; }
    if (granted.has(name)) { results[name] = true; continue; }
    const state = stateOf(config, name);
    if (state === 'deny' || fixed(config, name)) { results[name] = false; continue; }
    if (name === BACKGROUND_LOCATION && !FOREGROUND_LOCATION.some(other => granted.has(other))) { results[name] = false; continue; }   // the dialog needs the foreground grant first
    if (targetSdk < 23) { results[name] = true; continue; }
    results[name] = null;
    const group = groupOf(name) ?? 'OTHER'; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(name);
  }
  return { results, dialogs: [...groups].map(([group, permissions]) => ({ group, section: sectionOf(group === 'OTHER' ? null : group), permissions })) };
}
function holdsInstallTime(manifest, name) {
  const own = (manifest?.declaredPermissions ?? []).find(entry => entry.name === name);
  return own ? true : levelOf(name) === 'normal';
}

/**
 * The config after the user answered a dialog of `group`: answer 'allow' | 'once' | 'deny'. Allowing grants the requested permissions of the group and, like the platform's group grant,
 * the other manifest-requested permissions of the same group (never background location, which is its own step). Denying counts one denial per requested permission.
 */
export function answerDialog(config, manifest, dialog, answer) {
  const next = sanitizeConfig(config), names = dialog.permissions;
  if (answer === 'allow') {
    for (const name of names) { next.states[name] = 'allow'; delete next.denials[name]; }
    for (const entry of manifest?.usesPermissions ?? []) if (isRuntime(manifest, entry.name) && groupOf(entry.name) === dialog.group && entry.name !== BACKGROUND_LOCATION && grantable(manifest, entry.name) && stateOf(next, entry.name) === 'ask') next.states[entry.name] = 'allow';
  } else if (answer === 'once') {
    for (const name of names) if (!next.once.includes(name)) next.once.push(name);
  } else {
    for (const name of names) next.denials[name] = Math.min(99, (next.denials[name] ?? 0) + 1);
  }
  return next;
}
/** The Settings-style change of one permission by the tester: allow / deny / ask. Going back to "ask" forgets the denials (and a one-time grant), like resetting the permission. */
export function setState(config, permission, state) {
  const next = sanitizeConfig(config);
  if (!STATES.includes(state)) return next;
  next.states[permission] = state; delete next.denials[permission]; next.once = next.once.filter(name => name !== permission);
  return next;
}
/** The final answer of a request once every dialog was answered: { [permission]: boolean }. */
export function settleRequest(config, manifest, names) {
  const granted = computeGranted(config, manifest), out = {};
  for (const name of names) out[name] = isRuntime(manifest, name) ? granted.has(name) : holdsInstallTime(manifest, name) && !!requestOf(manifest, name);
  return out;
}

export const DEFAULT_LOCATION = Object.freeze({ enabled: false, latitude: -23.5505, longitude: -46.6333, accuracy: 10 });
/** The location block of the device settings: finite values in range, anything else falls back to the default. */
export function sanitizeLocation(input) {
  const out = { ...DEFAULT_LOCATION }; if (!input || typeof input !== 'object') return out;
  out.enabled = input.enabled === true;
  const latitude = Number(input.latitude), longitude = Number(input.longitude), accuracy = Number(input.accuracy);
  if (input.latitude !== '' && input.latitude !== null && latitude >= -90 && latitude <= 90) out.latitude = latitude;
  if (input.longitude !== '' && input.longitude !== null && longitude >= -180 && longitude <= 180) out.longitude = longitude;
  if (input.accuracy !== '' && input.accuracy !== null && accuracy >= 0 && accuracy <= 100000) out.accuracy = accuracy;
  return out;
}
