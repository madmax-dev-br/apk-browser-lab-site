// Versioned host <-> frame message schema and the <apk-player> configuration model. No DOM: shared by the host script, the frame and the tests.
import { sanitizeSettings } from '../device-settings.js?v=af3232247547';
export const PROTOCOL = 'apk-player';
export const VERSION = 1;
export const MAX_APK_BYTES = 1024 * 1024 * 1024;
/** Public config keys (camelCase) <-> element attributes (kebab-case). The values go through the lab's own sanitizer (device-settings.js). */
export const CONFIG_KEYS = Object.freeze(['device', 'orientation', 'locale', 'theme', 'fontScale', 'animatorScale', 'hour24', 'timeZone', 'battery', 'charging', 'connectivity', 'navigation', 'allowedHosts', 'proxyUrl']);
export const ATTRIBUTES = Object.freeze({ device: 'device', orientation: 'orientation', locale: 'locale', theme: 'theme', 'font-scale': 'fontScale', 'animator-scale': 'animatorScale', 'hour-24': 'hour24', 'time-zone': 'timeZone', battery: 'battery', charging: 'charging', connectivity: 'connectivity', navigation: 'navigation', 'allowed-hosts': 'allowedHosts', 'proxy-url': 'proxyUrl' });
const bool = value => value === true || value === 'true' || value === '' || value === '1' ? true : value === false || value === 'false' || value === '0' ? false : undefined;
/** Parse attribute strings (or a loosely typed config object) into a typed public config; unknown or malformed values are reported, never guessed. */
export function parseConfig(input = {}) {
  const config = {}, rejected = [];
  for (const [key, raw] of Object.entries(input)) {
    if (raw === undefined || raw === null) continue;
    if (!CONFIG_KEYS.includes(key)) { rejected.push(key); continue; }
    if (key === 'fontScale' || key === 'animatorScale' || key === 'battery') { const number = Number(raw); if (Number.isFinite(number)) config[key] = number; else rejected.push(key); }
    else if (key === 'allowedHosts') { if (Array.isArray(raw) && raw.every(item => typeof item === 'string')) config[key] = raw.slice(); else if (typeof raw === 'string') config[key] = raw.split(/[\s,]+/).filter(Boolean); else rejected.push(key); }
    else if (key === 'hour24' || key === 'charging') { const value = bool(raw); if (value === undefined) rejected.push(key); else config[key] = value; }
    else if (typeof raw === 'string') config[key] = raw;
    else rejected.push(key);
  }
  return { config, rejected };
}
export function configFromAttributes(getAttribute) {
  const raw = {}; for (const [attribute, key] of Object.entries(ATTRIBUTES)) { const value = getAttribute(attribute); if (value !== null && value !== undefined) raw[key] = value; }
  return parseConfig(raw);
}
const ALLOWED_THEMES = ['light', 'dark'];
/** Public config -> the VM/lab device settings. Values the sanitizer would silently drop are listed in `rejected`. */
export function configToSettings(config = {}) {
  const input = {}, rejected = [];
  if (config.device !== undefined) input.screen = config.device;
  for (const key of ['orientation', 'locale', 'fontScale', 'animatorScale', 'hour24', 'timeZone', 'connectivity', 'navigation']) if (config[key] !== undefined) input[key] = config[key];
  if (config.theme !== undefined) { if (ALLOWED_THEMES.includes(config.theme)) input.darkTheme = config.theme === 'dark'; else rejected.push('theme'); }
  if (config.battery !== undefined || config.charging !== undefined) input.battery = { level: config.battery ?? 80, charging: !!config.charging };
  if (config.allowedHosts !== undefined || config.proxyUrl !== undefined) input.network = { allowedHosts: config.allowedHosts ?? [], proxyUrl: config.proxyUrl ?? '' };
  const settings = sanitizeSettings(input);
  if (config.allowedHosts !== undefined) { const dropped = config.allowedHosts.filter(host => !settings.network.allowedHosts.includes(String(host).trim().toLowerCase())); if (dropped.length) rejected.push(`allowedHosts (dropped: ${dropped.join(', ')})`); }
  if (config.proxyUrl !== undefined && config.proxyUrl !== '' && !settings.network.proxyUrl) rejected.push('proxyUrl');
  const effective = { screen: settings.screen, orientation: settings.orientation, locale: settings.locale, fontScale: settings.fontScale, animatorScale: settings.animatorScale, hour24: settings.hour24, timeZone: settings.timeZone, connectivity: settings.connectivity, navigation: settings.navigation };
  for (const [key, field] of [['device', 'screen'], ['orientation', 'orientation'], ['locale', 'locale'], ['fontScale', 'fontScale'], ['animatorScale', 'animatorScale'], ['hour24', 'hour24'], ['timeZone', 'timeZone'], ['connectivity', 'connectivity'], ['navigation', 'navigation']]) {
    if (config[key] === undefined) continue;
    const wanted = key === 'device' || key === 'orientation' || key === 'locale' || key === 'timeZone' || key === 'connectivity' || key === 'navigation' || key === 'hour24' ? config[key] : Number(config[key]);
    if (effective[field] !== wanted && !['fontScale', 'animatorScale'].includes(key)) rejected.push(key);
    if (['fontScale', 'animatorScale'].includes(key) && effective[field] !== wanted) rejected.push(key + ' (clamped to ' + effective[field] + ')');
  }
  return { settings, rejected };
}
/** Effective public config back from settings (what `config-applied` reports). */
export function settingsToConfig(settings) {
  return { device: settings.screen, orientation: settings.orientation, locale: settings.locale, theme: settings.darkTheme ? 'dark' : 'light', fontScale: settings.fontScale, animatorScale: settings.animatorScale, hour24: settings.hour24, timeZone: settings.timeZone, battery: settings.battery.level, charging: settings.battery.charging, connectivity: settings.connectivity, navigation: settings.navigation, allowedHosts: settings.network.allowedHosts.slice(), proxyUrl: settings.network.proxyUrl };
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value, max = 4096) => typeof value === 'string' && value.length <= max;
const HOST_TYPES = {
  init: message => {
    if (!isObject(message.config)) return 'init.config must be an object';
    if (message.apk !== undefined && !(message.apk instanceof ArrayBuffer)) return 'init.apk must be an ArrayBuffer';
    if (message.apk && message.apk.byteLength > MAX_APK_BYTES) return 'init.apk exceeds 1 GiB';
    if (message.url !== undefined && !str(message.url, 8192)) return 'init.url must be a string';
    if ((message.apk === undefined) === (message.url === undefined)) return 'init needs exactly one of apk or url';
    if (message.name !== undefined && !str(message.name, 256)) return 'init.name must be a short string';
    if (message.activity !== undefined && !str(message.activity, 512)) return 'init.activity must be a string';
    return null;
  },
  config: message => (isObject(message.config) ? null : 'config.config must be an object'),
  back: () => null, restart: () => null, destroy: () => null,
};
const FRAME_TYPES = {
  hello: () => null,
  ready: message => (str(message.activity, 512) && isObject(message.inventory) ? null : 'ready needs activity and inventory'),
  'activity-changed': message => (str(message.activity, 512) && typeof message.canGoBack === 'boolean' ? null : 'activity-changed needs activity and canGoBack'),
  'config-applied': message => (isObject(message.config) && Array.isArray(message.rejected) && typeof message.live === 'boolean' ? null : 'config-applied needs config, rejected and live'),
  closed: () => null,
  error: message => (str(message.message, 16384) && str(message.kind, 128) && (message.frontier === null || isObject(message.frontier)) && str(message.phase, 64) ? null : 'error needs kind, message, phase and frontier'),
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
/** The Worker/VM error carries `kind`/`details` when it is a known frontier; the player passes them to the embedding page unchanged. */
export function describeError(error, phase) {
  const details = error?.details && typeof error.details === 'object' ? error.details : null;
  const frontier = details ? JSON.parse(JSON.stringify(details, (key, value) => (typeof value === 'bigint' ? String(value) : value))) : null;
  return { kind: String(details?.kind || error?.kind || error?.name || 'error').slice(0, 128), message: String(error?.message || error).slice(0, 16000), phase, frontier };
}
