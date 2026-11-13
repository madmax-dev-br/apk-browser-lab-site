// Versioned host <-> frame message schema and the <apk-player> configuration model. No DOM: shared by the host script, the frame and the tests.
import { checkCoreMemory } from '../core-memory.js?v=92e21e72be68';
import { sanitizeSettings, checkCustomScreen } from '../device-settings.js?v=92e21e72be68';
import { buildDiagnosticReport } from '../diagnostic-report.js?v=92e21e72be68';
import { parseRule } from '../host-map.js?v=92e21e72be68';
import { EVENT_SECONDS_STEPS } from '../time-limits.js?v=92e21e72be68';
import { isMemoryStep } from '../memory-budget.js?v=92e21e72be68';
export const PROTOCOL = 'apk-player';
/** Envelope version: every message carries it; a frame or host of another version is refused. Unchanged since the first release, so old hosts keep working. */
export const VERSION = 1;
/** Feature revision inside version 1, announced by the frame in `hello` ({ revision, capabilities }). Revision 2 added `config` ids, the `call`/`reply` pair, streams,
 *  plugins, permission dialogs, screen events and the lab-feature config keys; a host checks `capabilities` before using them (a revision-1 frame sends a bare hello). */
export const REVISION = 2;
export const CAPABILITIES = Object.freeze(['config-id', 'lab-config', 'call', 'streams', 'plugins', 'permission-dialog', 'screen-events']);
/** The methods of the `call` message (revision 2). Each one's arguments are validated again in the frame (src/player/frame-controller.js). */
export const CALL_METHODS = Object.freeze(['reloadActivity', 'openIntent', 'inspectCompose', 'layoutBounds', 'screenshot', 'screenState', 'diagnostic', 'status', 'answerPermission', 'subscribe', 'pluginsSet', 'pluginsStop', 'pluginsRestart', 'pluginsList', 'stop']);
export const STREAMS = Object.freeze(['logcat', 'network']);
export const PERMISSION_DIALOG = Object.freeze(['none', 'frame', 'host']);
export const MAX_OVERRIDES = 200, MAX_IGNORED = 100, MAX_HOST_RULES = 50, MAX_MOCK_ENTRIES = 50, MAX_MOCK_TEXT = 6 * 1024 * 1024, MAX_PERMISSION_ENTRIES = 500;
export const MAX_APK_BYTES = 1024 * 1024 * 1024;
/** Public config keys (camelCase) <-> element attributes (kebab-case). The values go through the lab's own sanitizer (device-settings.js). */
/** Keys that change the device model the VM sees (delivered live through setDevice, Android Configuration semantics). */
export const DEVICE_KEYS = Object.freeze(['device', 'orientation', 'locale', 'theme', 'fontScale', 'animatorScale', 'hour24', 'timeZone', 'battery', 'charging', 'connectivity', 'navigation', 'statusBarHeight', 'allowedHosts', 'proxyUrl', 'hostMap']);
/** The lab's debugging features (the "Controles" of the test page), revision 2: the same lists the panels keep, validated in the frame by the panels' own sanitizers. */
export const LAB_KEYS = Object.freeze(['hostMap', 'eventSeconds', 'memoryMiB', 'strictCrash', 'layoutBounds', 'methodOverrides', 'ignoredActivities', 'endpointMocks', 'permissions', 'location', 'permissionDialog', 'renderer', 'engine', 'coreMemory']);
export const CONFIG_KEYS = Object.freeze(['device', 'orientation', 'locale', 'theme', 'fontScale', 'animatorScale', 'hour24', 'timeZone', 'battery', 'charging', 'connectivity', 'navigation', 'statusBarHeight', 'allowedHosts', 'proxyUrl', 'tolerateMissing', 'webview', ...LAB_KEYS]);
export const ATTRIBUTES = Object.freeze({ device: 'device', orientation: 'orientation', locale: 'locale', theme: 'theme', 'font-scale': 'fontScale', 'animator-scale': 'animatorScale', 'hour-24': 'hour24', 'time-zone': 'timeZone', battery: 'battery', charging: 'charging', connectivity: 'connectivity', navigation: 'navigation', 'status-bar-height': 'statusBarHeight', 'allowed-hosts': 'allowedHosts', 'proxy-url': 'proxyUrl', 'tolerate-missing': 'tolerateMissing', webview: 'webview',
  'host-map': 'hostMap', 'event-seconds': 'eventSeconds', 'memory-mib': 'memoryMiB', 'strict-crash': 'strictCrash', 'layout-bounds': 'layoutBounds', 'ignored-activities': 'ignoredActivities', 'permission-dialog': 'permissionDialog', renderer: 'renderer', engine: 'engine' });
/** Missing-API policy of the VM (apk-runtime tolerateMissing). 'off' (the player default) stops at the first unsupported API; embedders opt in to stubs. Applies at the next launch. */
export const TOLERATE_MISSING = Object.freeze(['off', 'void', 'primitives', 'all']);
const bool = value => value === true || value === 'true' || value === '' || value === '1' ? true : value === false || value === 'false' || value === '0' ? false : undefined;
/** Parse attribute strings (or a loosely typed config object) into a typed public config; unknown or malformed values are reported, never guessed. */
export function parseConfig(input = {}) {
  const config = {}, rejected = [];
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined || (raw === null && key !== 'location')) continue;   // location: null clears the simulated location
    if (!CONFIG_KEYS.includes(key)) { rejected.push(key); continue; }
    if (key === 'fontScale' || key === 'animatorScale' || key === 'battery' || key === 'statusBarHeight') { const number = Number(raw); if (Number.isFinite(number)) config[key] = number; else rejected.push(key); }
    else if (key === 'allowedHosts') { if (Array.isArray(raw) && raw.every(item => typeof item === 'string')) config[key] = raw.slice(); else if (typeof raw === 'string') config[key] = raw.split(/[\s,]+/).filter(Boolean); else rejected.push(key); }
    else if (key === 'hour24' || key === 'charging') { const value = bool(raw); if (value === undefined) rejected.push(key); else config[key] = value; }
    else if (key === 'webview') { if (raw === 'on' || raw === 'off') config[key] = raw; else rejected.push(key); }   // android.webkit.WebView content in sandboxed iframes: off unless the embedder opts in
    else if (key === 'tolerateMissing') { if (TOLERATE_MISSING.includes(raw)) config[key] = raw; else rejected.push(key); }
    else if (LAB_KEYS.includes(key)) { const value = parseLabValue(key, raw); if (value === undefined) rejected.push(key); else config[key] = value; }
    else if (key === 'device' && (plain(raw) || (typeof raw === 'string' && SCREEN_SIZE.test(raw)))) {   // a custom size is checked here, so an invalid one never replaces the device in effect
      const parsed = parseDeviceValue(raw); if (parsed.error) rejected.push(`device (${parsed.error})`); else config[key] = plain(raw) ? { width: parsed.customScreen.width, height: parsed.customScreen.height, unit: parsed.customScreen.unit } : raw;
    }
    else if (typeof raw === 'string') config[key] = raw;
    else rejected.push(key);
  }
  return { config, rejected };
}
const SCREEN_SIZE = /^\s*(\d{1,5})\s*[x×]\s*(\d{1,5})\s*(dp|px)?\s*$/i;
/**
 * The `device` config value: a preset id ('phone', 'tablet', ...), a size string "360x640" / "360x640dp" / "1080x2400px", or { width, height, unit: 'dp' | 'px' }.
 * A size is a custom screen ("Personalizado"): width and height of the portrait screen, px = dp x density, 120 to 4096 px a side. -> { screen, customScreen? } or { error }.
 */
export function parseDeviceValue(value) {
  let custom = null;
  if (plain(value)) custom = value;
  else if (typeof value === 'string') { const match = SCREEN_SIZE.exec(value); if (!match) return { screen: value }; custom = { width: Number(match[1]), height: Number(match[2]), unit: (match[3] ?? 'dp').toLowerCase() }; }
  else return { error: 'not a preset id or a size' };
  const checked = checkCustomScreen(custom);
  return checked.value ? { screen: 'custom', customScreen: checked.value } : { error: checked.error };
}
/** The `device` value reported back: the preset id, or "WIDTHxHEIGHTunit" for a custom screen. */
export function deviceValueOf(settings) { return settings.screen === 'custom' ? `${settings.customScreen.width}x${settings.customScreen.height}${settings.customScreen.unit}` : settings.screen; }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const shortString = (value, max) => (typeof value === 'string' && value.length <= max ? value : undefined);
/** Shape and size of one lab-feature value (bounded lists of plain data). The contents are checked in the frame with the panels' validators; undefined = rejected. */
export function parseLabValue(key, raw) {
  switch (key) {
    case 'eventSeconds': case 'memoryMiB': {
      const number = Number(raw); if (raw === '' || typeof raw === 'boolean' || raw === null || !Number.isFinite(number)) return undefined;
      return key === 'eventSeconds' ? (number === 0 || EVENT_SECONDS_STEPS.includes(number) ? number : undefined) : isMemoryStep(number) ? number : undefined;
    }
    case 'strictCrash': case 'layoutBounds': return bool(raw);
    case 'permissionDialog': return PERMISSION_DIALOG.includes(raw) ? raw : undefined;
    case 'renderer': return raw === 'cpu' || raw === 'gpu' ? raw : undefined;   // 'gpu' (default: WebGL replay in the Worker, src/gpu-raster.js, falling back to CPU by itself) or 'cpu'; applied live
    case 'coreMemory': { if (!raw || typeof raw !== 'object') return undefined; const checked = checkCoreMemory(raw); return checked.error ? undefined : checked.value; }   // { heapMiB, metaMiB, threads }: the sizes of the WebAssembly core's memory (src/core-memory.js); only with engine 'wasm', applies at the next launch
    case 'engine': return raw === 'js' || raw === 'wasm' ? raw : undefined;   // 'wasm' (default: the Java heap, frames and interpreter in vmcore/core.wasm, docs/WASM-CORE-PLANO.md) or 'js' (the JavaScript VM); applies at the next launch
    case 'hostMap': {   // [{ from, to, enabled }] or, as an attribute, "api.example.com -> localhost:8080, *.cdn.example.com -> 127.0.0.1:9000"
      const list = typeof raw === 'string' ? raw.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean).map(item => { const at = item.indexOf('->'); return at < 0 ? { from: item, to: '' } : { from: item.slice(0, at).trim(), to: item.slice(at + 2).trim() }; }) : raw;
      if (!Array.isArray(list) || list.length > MAX_HOST_RULES || !list.every(rule => plain(rule) && shortString(rule.from ?? '', 300) !== undefined && shortString(rule.to ?? '', 300) !== undefined && (rule.enabled === undefined || typeof rule.enabled === 'boolean'))) return undefined;
      return list.map(rule => ({ from: String(rule.from ?? '').trim(), to: String(rule.to ?? '').trim(), enabled: rule.enabled !== false }));
    }
    case 'methodOverrides': {   // [{ method: 'Lpkg/C;->m()Z' | 'pkg.C.m(int): boolean' | 'pkg.C.m(int)', value: 'true', enabled }]
      if (!Array.isArray(raw) || raw.length > MAX_OVERRIDES) return undefined;
      const out = [];
      for (const item of raw) {
        const valueOk = item?.value === undefined || item?.value === null || ['string', 'number', 'boolean'].includes(typeof item?.value);
        if (!plain(item) || shortString(item.method, 2048) === undefined || !valueOk || String(item.value ?? '').length > 4096 || (item.enabled !== undefined && typeof item.enabled !== 'boolean')) return undefined;
        out.push({ method: item.method, value: item.value === null || item.value === undefined ? 'null' : String(item.value), enabled: item.enabled !== false });
      }
      return out;
    }
    case 'ignoredActivities': {   // ['pkg.SplashActivity', { name: '.Promo', enabled: false }] or, as an attribute, "pkg.A, .B"
      const list = typeof raw === 'string' ? raw.split(/[\s,]+/).filter(Boolean) : raw;
      if (!Array.isArray(list) || list.length > MAX_IGNORED) return undefined;
      const out = [];
      for (const item of list) {
        const name = typeof item === 'string' ? item : plain(item) ? item.name : undefined;
        if (shortString(name, 512) === undefined || (plain(item) && item.enabled !== undefined && typeof item.enabled !== 'boolean')) return undefined;
        out.push({ name: name.trim(), enabled: !(plain(item) && item.enabled === false) });
      }
      return out;
    }
    case 'endpointMocks': {   // the "Mock de endpoints" entries (src/endpoint-mocks.js shape); normalizeMock / validateMock run in the frame
      if (!Array.isArray(raw) || raw.length > MAX_MOCK_ENTRIES) return undefined;
      for (const item of raw) { if (!plain(item)) return undefined; for (const field of ['body', 'bodyBase64']) if (item[field] !== undefined && item[field] !== null && shortString(item[field], MAX_MOCK_TEXT) === undefined) return undefined; }
      return raw.map(item => ({ ...item }));
    }
    case 'permissions': {   // { 'android.permission.CAMERA': 'allow' } or the panel's { states, denials }
      if (!plain(raw)) return undefined;
      const states = plain(raw.states) ? raw.states : raw, entries = Object.entries(states);
      if (entries.length > MAX_PERMISSION_ENTRIES || !entries.every(([name, value]) => name.length < 200 && ['ask', 'allow', 'deny'].includes(value))) return undefined;
      const denials = plain(raw.denials) ? Object.fromEntries(Object.entries(raw.denials).filter(([name, count]) => name.length < 200 && Number.isInteger(count) && count > 0).slice(0, MAX_PERMISSION_ENTRIES)) : {};
      return { states: Object.fromEntries(entries), denials };
    }
    case 'location': {   // the simulated device location ({ enabled, latitude, longitude, accuracy (m) }); null = none
      if (raw === null) return null;
      if (!plain(raw)) return undefined;
      const latitude = Number(raw.latitude), longitude = Number(raw.longitude), accuracy = Number(raw.accuracy ?? 10);
      if (!(latitude >= -90 && latitude <= 90) || !(longitude >= -180 && longitude <= 180) || !(accuracy >= 0 && accuracy <= 100000) || (raw.enabled !== undefined && typeof raw.enabled !== 'boolean')) return undefined;
      return { enabled: raw.enabled !== false, latitude, longitude, accuracy };
    }
    default: return undefined;
  }
}
/** `{ network: { allowedHosts, proxyUrl, hostMap } }` (the nested shape configure() also takes) -> the flat config keys; flat keys win. */
export function flattenConfig(input = {}) {
  if (!plain(input)) return {};
  const { network, ...rest } = input; if (!plain(network)) return input;
  const out = {}; for (const key of ['allowedHosts', 'proxyUrl', 'hostMap']) if (network[key] !== undefined) out[key] = network[key];
  return { ...out, ...rest };
}
export function configFromAttributes(getAttribute) {
  const raw = {}; for (const [attribute, key] of Object.entries(ATTRIBUTES)) { const value = getAttribute(attribute); if (value !== null && value !== undefined) raw[key] = value; }
  return parseConfig(raw);
}
const ALLOWED_THEMES = ['light', 'dark'];
/** Public config -> the VM/lab device settings. Values the sanitizer would silently drop are listed in `rejected`. */
export function configToSettings(config = {}) {
  const input = {}, rejected = [];
  let deviceRejected = null;
  if (config.device !== undefined) { const parsed = parseDeviceValue(config.device); if (parsed.error) deviceRejected = `device (${parsed.error})`; else { input.screen = parsed.screen; if (parsed.customScreen) input.customScreen = parsed.customScreen; } }
  for (const key of ['orientation', 'locale', 'fontScale', 'animatorScale', 'hour24', 'timeZone', 'connectivity', 'navigation']) if (config[key] !== undefined) input[key] = config[key];
  if (config.theme !== undefined) { if (ALLOWED_THEMES.includes(config.theme)) input.darkTheme = config.theme === 'dark'; else rejected.push('theme'); }
  if (config.statusBarHeight !== undefined) input.statusBarHeightDp = config.statusBarHeight;
  if (config.battery !== undefined || config.charging !== undefined) input.battery = { level: config.battery ?? 80, charging: !!config.charging };
  if (config.allowedHosts !== undefined || config.proxyUrl !== undefined || config.hostMap !== undefined) input.network = { allowedHosts: config.allowedHosts ?? [], proxyUrl: config.proxyUrl ?? '', hostMap: config.hostMap ?? [] };
  for (const key of ['eventSeconds', 'memoryMiB', 'layoutBounds', 'renderer', 'engine', 'coreMemory']) if (config[key] !== undefined) input[key] = config[key];
  const settings = sanitizeSettings(input);
  (config.hostMap ?? []).forEach((rule, index) => { const parsed = parseRule(rule); if (parsed.error) rejected.push(`hostMap[${index}] (${parsed.error})`); });   // kept in the list (as the panel keeps them), ignored by the redirect
  if (config.allowedHosts !== undefined) { const dropped = config.allowedHosts.filter(host => !settings.network.allowedHosts.includes(String(host).trim().toLowerCase())); if (dropped.length) rejected.push(`allowedHosts (dropped: ${dropped.join(', ')})`); }
  if (config.proxyUrl !== undefined && config.proxyUrl !== '' && !settings.network.proxyUrl) rejected.push('proxyUrl');
  if (deviceRejected) rejected.push(deviceRejected);
  const effective = { screen: settings.screen, orientation: settings.orientation, locale: settings.locale, fontScale: settings.fontScale, animatorScale: settings.animatorScale, hour24: settings.hour24, timeZone: settings.timeZone, connectivity: settings.connectivity, navigation: settings.navigation };
  for (const [key, field] of [['device', 'screen'], ['orientation', 'orientation'], ['locale', 'locale'], ['fontScale', 'fontScale'], ['animatorScale', 'animatorScale'], ['hour24', 'hour24'], ['timeZone', 'timeZone'], ['connectivity', 'connectivity'], ['navigation', 'navigation']]) {
    if (config[key] === undefined || (key === 'device' && (deviceRejected || input.screen === 'custom'))) continue;   // a custom size was checked by parseDeviceValue
    const wanted = key === 'device' || key === 'orientation' || key === 'locale' || key === 'timeZone' || key === 'connectivity' || key === 'navigation' || key === 'hour24' ? config[key] : Number(config[key]);
    if (effective[field] !== wanted && !['fontScale', 'animatorScale'].includes(key)) rejected.push(key);
    if (['fontScale', 'animatorScale'].includes(key) && effective[field] !== wanted) rejected.push(key + ' (clamped to ' + effective[field] + ')');
  }
  return { settings, rejected };
}
/** The lab-feature part of the effective config (revision 2), reported by `config-applied` next to settingsToConfig. Mocks are summarized (their bodies are not echoed). */
export function labConfigOf(config, settings) {
  return { hostMap: settings.network.hostMap.map(rule => ({ ...rule })), eventSeconds: settings.eventSeconds ?? 0, memoryMiB: settings.memoryMiB ?? 0, layoutBounds: !!settings.layoutBounds, strictCrash: config.strictCrash === true, permissionDialog: config.permissionDialog ?? 'none', renderer: settings.renderer ?? 'cpu', engine: settings.engine ?? 'js', coreMemory: { ...settings.coreMemory },
    methodOverrides: (config.methodOverrides ?? []).map(item => ({ ...item })), ignoredActivities: (config.ignoredActivities ?? []).map(item => ({ ...item })),
    endpointMocks: (config.endpointMocks ?? []).map(mock => ({ id: mock.id ?? null, name: String(mock.name ?? ''), method: String(mock.method ?? 'ANY'), url: String(mock.url ?? ''), enabled: mock.enabled !== false })),
    permissions: config.permissions ? { states: { ...config.permissions.states } } : null, location: config.location ?? null };
}
/** Effective public config back from settings (what `config-applied` reports). */
export function settingsToConfig(settings) {
  return { device: deviceValueOf(settings), orientation: settings.orientation, locale: settings.locale, theme: settings.darkTheme ? 'dark' : 'light', fontScale: settings.fontScale, animatorScale: settings.animatorScale, hour24: settings.hour24, timeZone: settings.timeZone, statusBarHeight: settings.statusBarHeightDp ?? null, battery: settings.battery.level, charging: settings.battery.charging, connectivity: settings.connectivity, navigation: settings.navigation, allowedHosts: settings.network.allowedHosts.slice(), proxyUrl: settings.network.proxyUrl };
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value, max = 4096) => typeof value === 'string' && value.length <= max;
const isList = (value, max) => Array.isArray(value) && value.length <= max;
const isStubLists = value => isObject(value) && ['void', 'returns', 'classes'].every(key => Array.isArray(value[key]) && value[key].length <= 2000 && value[key].every(item => typeof item === 'string' && item.length <= 1024));
const HOST_TYPES = {
  init: message => {
    if (!isObject(message.config)) return 'init.config must be an object';
    if (message.apk !== undefined && !(message.apk instanceof ArrayBuffer)) return 'init.apk must be an ArrayBuffer';
    if (message.apk && message.apk.byteLength > MAX_APK_BYTES) return 'init.apk exceeds 1 GiB';
    if (message.url !== undefined && !str(message.url, 8192)) return 'init.url must be a string';
    if ((message.apk === undefined) === (message.url === undefined)) return 'init needs exactly one of apk or url';
    if (message.name !== undefined && !str(message.name, 256)) return 'init.name must be a short string';
    if (message.activity !== undefined && !str(message.activity, 512)) return 'init.activity must be a string';
    for (const key of ['keepData', 'clearData']) if (message[key] !== undefined && typeof message[key] !== 'boolean') return `init.${key} must be a boolean`;
    return null;
  },
  config: message => (!isObject(message.config) ? 'config.config must be an object' : message.id !== undefined && !Number.isSafeInteger(message.id) ? 'config.id must be an integer' : null),
  call: message => (!Number.isSafeInteger(message.id) ? 'call needs an integer id' : !CALL_METHODS.includes(message.method) ? `unknown call method ${String(message.method).slice(0, 64)}` : message.args !== undefined && !isObject(message.args) ? 'call.args must be an object' : null),
  back: () => null, restart: () => null, destroy: () => null, 'clear-data': () => null,
  diagnostics: message => (Number.isSafeInteger(message.id) ? null : 'diagnostics needs an integer id'),
};
const FRAME_TYPES = {
  hello: message => (message.revision !== undefined && !Number.isSafeInteger(message.revision) ? 'hello.revision must be an integer' : message.capabilities !== undefined && !(Array.isArray(message.capabilities) && message.capabilities.length <= 64 && message.capabilities.every(item => str(item, 64))) ? 'hello.capabilities must be a list of names' : null),
  ready: message => (str(message.activity, 512) && isObject(message.inventory) ? null : 'ready needs activity and inventory'),
  'activity-changed': message => (str(message.activity, 512) && typeof message.canGoBack === 'boolean' ? null : 'activity-changed needs activity and canGoBack'),
  'config-applied': message => (isObject(message.config) && Array.isArray(message.rejected) && typeof message.live === 'boolean' && (message.id === undefined || Number.isSafeInteger(message.id)) && (message.statuses === undefined || isObject(message.statuses)) ? null : 'config-applied needs config, rejected and live'),
  reply: message => (Number.isSafeInteger(message.id) && typeof message.ok === 'boolean' && (message.ok || (isObject(message.error) && str(message.error.code, 64) && str(message.error.message, 4096))) ? null : 'reply needs id, ok and, when not ok, error { code, message }'),
  screen: message => (isObject(message.screen) && (message.screen.activity === null || str(message.screen.activity, 512)) ? null : 'screen needs screen { activity }'),
  logcat: message => (isList(message.entries, 5000) && Number.isSafeInteger(message.total) ? null : 'logcat needs entries and total'),
  network: message => (isList(message.entries, 5000) && Number.isSafeInteger(message.total) ? null : 'network needs entries and total'),
  'plugin-output': message => (isObject(message.plugin) && str(message.plugin.id, 64) && isList(message.plugin.blocks, 500) ? null : 'plugin-output needs plugin { id, blocks }'),
  'permission-request': message => (isObject(message.request) && Number.isSafeInteger(message.request.id) && isList(message.request.dialogs, 32) ? null : 'permission-request needs request { id, dialogs }'),
  'permission-config': message => (isObject(message.config) ? null : 'permission-config needs config'),
  stopped: () => null,
  closed: () => null,
  'data-status': message => (isObject(message.status) ? null : 'data-status needs status'),
  'data-cleared': message => (isObject(message.status) ? null : 'data-cleared needs status'),
  error: message => (str(message.message, 16384) && str(message.kind, 128) && (message.frontier === null || isObject(message.frontier)) && str(message.phase, 64) && (message.cause === undefined || str(message.cause, 16384)) && (message.report === undefined || str(message.report, 65536)) && (message.stubs === undefined || isStubLists(message.stubs)) ? null : 'error needs kind, message, phase and frontier (cause, report and stubs are optional but typed)'),
  diagnostics: message => (Number.isSafeInteger(message.id) && isStubLists(message.stubs) && str(message.tolerateMissing, 16) && str(message.packageName, 512) && str(message.report, 65536) ? null : 'diagnostics needs id, stubs, tolerateMissing, packageName and report'),
};
function validate(table, data) {
  if (!isObject(data)) return { ok: false, error: 'message is not an object' };
  if (data.protocol !== PROTOCOL) return { ok: false, error: 'wrong protocol' };
  if (data.version !== VERSION) return { ok: false, error: `unsupported protocol version ${String(data.version)} (expected ${VERSION})` };
  const check = Object.hasOwn(table, data.type) ? table[data.type] : null;
  if (!check) return { ok: false, error: `unknown message type ${String(data.type).slice(0, 64)}` };
  const error = check(data); return error ? { ok: false, error } : { ok: true, message: data };
}
export const validateHostMessage = data => validate(HOST_TYPES, data);
export const validateFrameMessage = data => validate(FRAME_TYPES, data);
export const envelope = (type, payload = {}) => ({ protocol: PROTOCOL, version: VERSION, type, ...payload });
/** The stub lists of a run as plain strings: `key xN` per stubbed void method, primitive-returning method and class (runtime.missingVoid/missingReturns/missingClasses, as {key,count} in a snapshot). */
export function stubListsFromSnapshot(snapshot) {
  const format = list => (Array.isArray(list) ? list.map(item => `${item.key} x${item.count}`).slice(0, 2000) : []);
  return { void: format(snapshot?.missingVoid), returns: format(snapshot?.missingReturns), classes: format(snapshot?.missingClasses) };
}
/** The Worker/VM error carries `kind`/`details` when it is a known frontier; the player passes them to the embedding page unchanged. `context` = { packageName, tolerateMissing } adds the shared report (cause, text, stubs). */
export function describeError(error, phase, context = {}) {
  const details = error?.details && typeof error.details === 'object' ? error.details : null;
  const frontier = details ? JSON.parse(JSON.stringify(details, (key, value) => (typeof value === 'bigint' ? String(value) : value))) : null;
  const message = String(error?.message || error).slice(0, 16000);
  const { cause, text } = buildDiagnosticReport({ error: Object.assign(Object.create(null), { message, trace: error?.trace, stubs: error?.stubs }), product: 'APK Player', packageName: context.packageName || 'APK', tolerateMissing: context.tolerateMissing || 'off' });
  return { kind: String(details?.kind || error?.kind || error?.name || 'error').slice(0, 128), message, cause: cause.slice(0, 16000), phase, frontier, report: text.slice(0, 65000), stubs: stubsFromError(error) };
}
const EMPTY_STUBS = () => ({ void: [], returns: [], classes: [] });
function stubsFromError(error) { const lists = error?.stubLists; return isStubLists(lists) ? { void: lists.void.slice(), returns: lists.returns.slice(), classes: lists.classes.slice() } : EMPTY_STUBS(); }
