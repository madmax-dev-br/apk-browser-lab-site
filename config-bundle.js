// The ONE export / import of the Controls panel's configuration: a single versioned JSON document with what the user has set, and its strict validation. DOM-free and no process.*:
// the page (src/app.js) reads each panel into a document and applies a validated one; the MCP tools (export_config / import_config) go through the same functions.
//
// Document (version 1):
//   { format: 'apkweb-lab-configuration', version: 1, exportedAt: ISO text (information only),
//     device?:  the device settings as the page keeps them (src/device-settings.js sanitizeSettings): screen, orientation, locale, battery, connectivity, navigation, font and
//               animation scales, custom screen, custom device identity, microG option and its services, the simulated location, engine, renderer and the other Execution options,
//               and network: { allowedHosts, proxyUrl, hostMap (Redirect hosts), clientCertHosts, clientCertAuto, relayChannel },
//     plugins?: [{ id?, name, code, enabled?, packageFilter?, updates?, height? }]   -- the page plugins (global, JavaScript the page runs): each one replaces the plugin of the same id or name, else is added;
//               plugins the file does not carry are left alone. Never applied silently: the page asks first, MCP needs allowPlugins,
//     package?: { name, mocks?: [endpoint mock], blockedCalls?: [blocked call rule], methodReturns?: [{ method, value, enabled }], ignoredActivities?: [{ name, enabled }],
//                 permissions?: { states: { 'android.permission.X': 'ask' | 'allow' | 'deny' } } }   -- what the Controls keep per app, for the app that is open }
// A part that is in the document replaces the same part on the page; a part that is not in it is left alone.
//
// Left out on purpose (never configuration, or a secret the page holds while it runs): the app's own data (SharedPreferences, databases, files), account sessions and cookies, the
// credentials typed into an app or into microG's login, the files added to the device's shared storage, the debugger's breakpoints, what a plugin produced or stored while it ran (its
// output, console, errors), the method changes plugins and MCP make with lab.hook (they belong to a plugin's session), the denial counters of the permission dialog, and the
// viewer's own preferences (theme, zoom, panel sizes, the MCP connection fields, the launcher icon's Activity).
import { sanitizeSettings } from './device-settings.js?v=88e579518234';
import { validateMock, normalizeMock, MAX_MOCKS } from './endpoint-mocks.js?v=88e579518234';
import { validateBlock, normalizeBlock, MAX_BLOCKS, BLOCK_SCOPES } from './blocked-calls.js?v=88e579518234';
import { parseMethodSpec, parseReturnValue } from './method-overrides.js?v=88e579518234';
import { validatePlugin, normalizePlugin, blockHeight, MAX_PLUGINS } from './plugin-store.js?v=88e579518234';

export const CONFIG_FORMAT = 'apkweb-lab-configuration';
export const CONFIG_VERSION = 1;
export const CONFIG_PARTS = ['device', 'plugins', 'mocks', 'blockedCalls', 'methodReturns', 'ignoredActivities', 'permissions'];
export const PACKAGE_PARTS = ['mocks', 'blockedCalls', 'methodReturns', 'ignoredActivities', 'permissions'];
export const MAX_RETURNS = 50, MAX_IGNORED = 50;
/** What a document never carries, for the page's note and the docs. */
export const NOT_INCLUDED = 'the app\'s data and files, account sessions and cookies, credentials typed into an app, the files added to shared storage, breakpoints, what plugins produced or stored while they ran (output, console), the method changes plugins make, permission-dialog counters and the viewer\'s own preferences (plugin code and settings ARE included, and the page asks before it runs imported ones)';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (key, item) => isObject(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item);
const DEVICE_KEYS = new Set(Object.keys(sanitizeSettings({})));
const MOCK_KEYS = new Set(['id', 'enabled', 'name', 'method', 'url', 'query', 'bodyContains', 'status', 'reason', 'headers', 'body', 'bodyBase64', 'bodyFile', 'delayMs']);
const BLOCK_KEYS = new Set(['id', 'enabled', 'scope', 'name', 'method', 'url', 'query', 'host']);
const PERMISSION_STATES = ['ask', 'allow', 'deny'];
const fail = error => ({ ok: false, error });
const unknownKeys = (object, allowed) => Object.keys(object).filter(key => !allowed.has(key));

/** `<name>-<timestamp>` file name of the export. */
export function configFileName(packageName, date = new Date()) {
  const pad = value => String(value).padStart(2, '0'), stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `lab-config-${String(packageName || 'device').replace(/[^A-Za-z0-9._-]+/g, '_')}-${stamp}.json`;
}

/**
 * The document of what the page holds. `device`: the device settings (sanitized here); `pkg`: null (no app open) or { name, mocks, blockedCalls, methodReturns, ignoredActivities,
 * permissions } as the panels list them; a part left undefined is not written. `parts` (optional list of 'device' | 'mocks' | ...) limits what goes in. A row the panel holds that is not
 * valid yet (a rule still being typed) is not written, so the document always reads back; `skipped` (an array) gets one line for each.
 */
export function buildConfigDocument({ device, pkg = null, plugins = null, parts = null, now = new Date(), skipped = [] } = {}) {
  const wanted = name => !parts || parts.includes(name), doc = { format: CONFIG_FORMAT, version: CONFIG_VERSION, exportedAt: now.toISOString() };
  const valid = (list, check, label) => list.filter((item, index) => { const problem = check([item]); if (problem) skipped.push(`${label} ${index + 1} (${problem.replace(/^package\.\w+\[0\]:?\s*/, '').slice(0, 100)})`); return !problem; });
  if (device && wanted('device')) { const { version, ...settings } = sanitizeSettings(device); doc.device = settings; }
  if (plugins && wanted('plugins')) doc.plugins = valid(plugins.map(plugin => ({ id: plugin.id, name: plugin.name, code: plugin.code, enabled: plugin.enabled === true, packageFilter: plugin.packageFilter ?? '', updates: plugin.updates ?? 'auto', height: plugin.height ?? 'wrap' })), checkPlugins, 'plugin');
  if (pkg?.name) {
    const out = { name: String(pkg.name) };
    if (pkg.mocks !== undefined && wanted('mocks')) out.mocks = valid(pkg.mocks.map(normalizeMock).map(({ bodyRef, ...mock }) => mock), checkMocks, 'mock');
    if (pkg.blockedCalls !== undefined && wanted('blockedCalls')) out.blockedCalls = valid(pkg.blockedCalls.map(normalizeBlock), checkBlocks, 'blocked call rule');
    if (pkg.methodReturns !== undefined && wanted('methodReturns')) out.methodReturns = valid(pkg.methodReturns.map(row => ({ method: String(row.method ?? ''), value: String(row.value ?? ''), enabled: row.enabled !== false })), checkReturns, 'method return');
    if (pkg.ignoredActivities !== undefined && wanted('ignoredActivities')) out.ignoredActivities = valid(pkg.ignoredActivities.map(row => ({ name: String(row.name ?? ''), enabled: row.enabled !== false })), checkIgnored, 'ignored Activity');
    if (pkg.permissions !== undefined && wanted('permissions')) out.permissions = { states: { ...(pkg.permissions.states ?? {}) } };
    if (Object.keys(out).length > 1 || !parts) doc.package = out;
  }
  return doc;
}
export const serializeConfig = doc => JSON.stringify(doc, null, 2);

function checkDevice(device) {
  if (!isObject(device)) return 'device must be an object (the device settings).';
  const { version, ...settings } = device, unknown = unknownKeys(settings, DEVICE_KEYS);
  if (unknown.length) return `device has settings this lab does not know: ${unknown.slice(0, 5).join(', ')}.`;
  const clean = sanitizeSettings(settings);
  for (const key of Object.keys(settings)) if (canonical(clean[key]) !== canonical(settings[key])) return `device.${key} is not valid (${canonical(settings[key]).slice(0, 80)}): it is not a value the Controls accept.`;
  return null;
}
const PLUGIN_KEYS = new Set(['id', 'name', 'code', 'enabled', 'packageFilter', 'updates', 'height']);
function checkPlugins(list) {
  if (!Array.isArray(list)) return 'plugins must be a list.';
  if (list.length > MAX_PLUGINS) return `plugins has ${list.length} entries; at most ${MAX_PLUGINS}.`;
  const ids = new Set(), names = new Set();
  for (const [index, item] of list.entries()) {
    const where = `plugins[${index}]`;
    if (!isObject(item)) return `${where} must be an object.`;
    const unknown = unknownKeys(item, PLUGIN_KEYS); if (unknown.length) return `${where} has fields that are not a plugin's: ${unknown.slice(0, 5).join(', ')}.`;
    if (typeof item.name !== 'string' || typeof item.code !== 'string') return `${where} needs a name and its code, both text.`;
    if (item.id !== undefined && (typeof item.id !== 'string' || !/^[\w-]{1,64}$/.test(item.id))) return `${where}.id is not a valid id.`;
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') return `${where}.enabled must be true or false.`;
    if (item.packageFilter !== undefined && (typeof item.packageFilter !== 'string' || item.packageFilter.length > 400)) return `${where}.packageFilter must be text (at most 400 characters).`;
    if (item.updates !== undefined && item.updates !== 'auto' && item.updates !== 'manual') return `${where}.updates must be "auto" or "manual".`;
    if (item.height !== undefined && !(item.height === 'auto' || item.height === 'wrap' || (Number.isFinite(item.height) && blockHeight(item.height) === Math.round(item.height)))) return `${where}.height must be "auto", "wrap" or a number of px (80 to 2000).`;
    const { errors } = validatePlugin(item); if (errors.length) return `${where}${item.name ? ` "${item.name.slice(0, 60)}"` : ''}: ${errors.map(e => e.message).join(' ')}`;
    if (item.name.trim().length > 120) return `${where}: the name is longer than 120 characters.`;
    if (item.id !== undefined) { if (ids.has(item.id)) return `${where}: the id "${item.id}" is used twice.`; ids.add(item.id); }
    const key = item.name.trim().toLowerCase(); if (names.has(key)) return `${where}: the name "${item.name.trim().slice(0, 60)}" is used twice.`; names.add(key);
  }
  return null;
}
function checkMocks(list) {
  if (!Array.isArray(list)) return 'package.mocks must be a list.';
  if (list.length > MAX_MOCKS) return `package.mocks has ${list.length} entries; at most ${MAX_MOCKS}.`;
  const ids = new Set();
  for (const [index, item] of list.entries()) {
    const where = `package.mocks[${index}]`;
    if (!isObject(item)) return `${where} must be an object.`;
    const unknown = unknownKeys(item, MOCK_KEYS); if (unknown.length) return `${where} has fields that are not a mock's: ${unknown.slice(0, 5).join(', ')}.`;
    const { errors } = validateMock(item); if (errors.length) return `${where}${item.name ? ` "${String(item.name).slice(0, 60)}"` : ''}: ${errors.map(e => e.message).join(' ')}`;
    if (typeof item.id === 'string') { if (ids.has(item.id)) return `${where}: the id "${item.id}" is used twice.`; ids.add(item.id); }
  }
  return null;
}
function checkBlocks(list) {
  if (!Array.isArray(list)) return 'package.blockedCalls must be a list.';
  if (list.length > MAX_BLOCKS) return `package.blockedCalls has ${list.length} entries; at most ${MAX_BLOCKS}.`;
  const ids = new Set();
  for (const [index, item] of list.entries()) {
    const where = `package.blockedCalls[${index}]`;
    if (!isObject(item)) return `${where} must be an object.`;
    const unknown = unknownKeys(item, BLOCK_KEYS); if (unknown.length) return `${where} has fields that are not a rule's: ${unknown.slice(0, 5).join(', ')}.`;
    if (!BLOCK_SCOPES.includes(item.scope)) return `${where}: scope must be "endpoint" or "host".`;
    const { errors } = validateBlock(item); if (errors.length) return `${where}${item.name ? ` "${String(item.name).slice(0, 60)}"` : ''}: ${errors.map(e => e.message).join(' ')}`;
    if (typeof item.id === 'string') { if (ids.has(item.id)) return `${where}: the id "${item.id}" is used twice.`; ids.add(item.id); }
  }
  return null;
}
function checkReturns(list) {
  if (!Array.isArray(list)) return 'package.methodReturns must be a list.';
  if (list.length > MAX_RETURNS) return `package.methodReturns has ${list.length} entries; at most ${MAX_RETURNS}.`;
  for (const [index, row] of list.entries()) {
    const where = `package.methodReturns[${index}]`;
    if (!isObject(row) || typeof row.method !== 'string' || typeof row.value !== 'string' || (row.enabled !== undefined && typeof row.enabled !== 'boolean') || unknownKeys(row, new Set(['method', 'value', 'enabled'])).length) return `${where} must be { method, value, enabled }.`;
    if (row.method.length > 600 || row.value.length > 2000) return `${where} is too long.`;
    const spec = parseMethodSpec(row.method); if (!spec.ok) return `${where}: ${spec.error}`;
    if (spec.result !== null) { if (spec.name === '<clinit>') return `${where}: the static initializer (<clinit>) cannot be overridden.`; const value = parseReturnValue(spec.result, row.value); if (!value.ok) return `${where}: ${value.error}`; }
  }
  return null;
}
function checkIgnored(list) {
  if (!Array.isArray(list)) return 'package.ignoredActivities must be a list.';
  if (list.length > MAX_IGNORED) return `package.ignoredActivities has ${list.length} entries; at most ${MAX_IGNORED}.`;
  for (const [index, row] of list.entries()) if (!isObject(row) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 300 || (row.enabled !== undefined && typeof row.enabled !== 'boolean') || unknownKeys(row, new Set(['name', 'enabled'])).length) return `package.ignoredActivities[${index}] must be { name, enabled } with the Activity's name.`;
  return null;
}
function checkPermissions(value) {
  if (!isObject(value) || !isObject(value.states) || unknownKeys(value, new Set(['states'])).length) return 'package.permissions must be { states: { "android.permission.X": "ask" | "allow" | "deny" } }.';
  const entries = Object.entries(value.states);
  if (entries.length > 500) return 'package.permissions.states has more than 500 entries.';
  for (const [name, state] of entries) if (typeof name !== 'string' || !name || name.length >= 200 || !PERMISSION_STATES.includes(state)) return `package.permissions.states["${String(name).slice(0, 60)}"] must be "ask", "allow" or "deny".`;
  return null;
}

/**
 * Parses and validates the text of a document. Nothing is applied here: the answer is { ok: true, doc, parts } (parts: the names present, 'device' and the package parts) or
 * { ok: false, error } naming the first problem. A document with an unknown format or version, an unknown key, or any malformed part is refused whole.
 */
export function parseConfigDocument(input) {
  let doc;
  if (typeof input === 'string') { try { doc = JSON.parse(input); } catch (error) { return fail(`The file is not valid JSON: ${String(error?.message ?? error).slice(0, 120)}`); } } else doc = input;
  if (!isObject(doc)) return fail('The file is not a configuration of this lab (a JSON object was expected).');
  if (doc.format !== CONFIG_FORMAT) return fail(`This is not a configuration of this lab: format "${String(doc.format).slice(0, 60)}", expected "${CONFIG_FORMAT}".`);
  if (!Number.isInteger(doc.version) || doc.version < 1) return fail(`The configuration has no valid version (${String(doc.version).slice(0, 20)}).`);
  if (doc.version > CONFIG_VERSION) return fail(`The configuration is version ${doc.version}, written by a newer lab; this one reads version ${CONFIG_VERSION}. Nothing was changed.`);
  if (doc.version !== CONFIG_VERSION) return fail(`Unknown configuration version ${doc.version}: this lab reads version ${CONFIG_VERSION}. Nothing was changed.`);
  const unknown = unknownKeys(doc, new Set(['format', 'version', 'exportedAt', 'device', 'plugins', 'package'])); if (unknown.length) return fail(`The configuration has parts this lab does not know: ${unknown.slice(0, 5).join(', ')}. Nothing was changed.`);
  const parts = [];
  if (doc.device !== undefined) { const error = checkDevice(doc.device); if (error) return fail(error); parts.push('device'); }
  if (doc.plugins !== undefined) { const error = checkPlugins(doc.plugins); if (error) return fail(error); parts.push('plugins'); }
  if (doc.package !== undefined) {
    if (!isObject(doc.package)) return fail('package must be an object.');
    const pkg = doc.package; if (typeof pkg.name !== 'string' || !pkg.name.trim() || pkg.name.length > 200) return fail('package.name must be the package id of the app.');
    const extra = unknownKeys(pkg, new Set(['name', ...PACKAGE_PARTS])); if (extra.length) return fail(`package has parts this lab does not know: ${extra.slice(0, 5).join(', ')}. Nothing was changed.`);
    const checks = { mocks: checkMocks, blockedCalls: checkBlocks, methodReturns: checkReturns, ignoredActivities: checkIgnored, permissions: checkPermissions };
    for (const name of PACKAGE_PARTS) if (pkg[name] !== undefined) { const error = checks[name](pkg[name]); if (error) return fail(error); parts.push(name); }
  }
  if (!parts.length) return fail('The configuration has nothing to apply (no device settings, plugins or per-app part).');
  return { ok: true, doc, parts };
}

/** What a validated document will set, in words (the page's status and the MCP answer). */
export function describeConfigDocument(doc, parts = null) {
  const have = name => parts ? parts.includes(name) : (name === 'device' ? doc.device !== undefined : name === 'plugins' ? doc.plugins !== undefined : doc.package?.[name] !== undefined), count = (name, one, many) => `${doc.package[name].length} ${doc.package[name].length === 1 ? one : many}`;
  const lines = [];
  if (have('device')) lines.push('device settings');
  if (have('plugins')) lines.push(`${doc.plugins.length} ${doc.plugins.length === 1 ? 'plugin' : 'plugins'} (JavaScript code)`);
  if (have('mocks')) lines.push(count('mocks', 'endpoint mock', 'endpoint mocks'));
  if (have('blockedCalls')) lines.push(count('blockedCalls', 'blocked call rule', 'blocked call rules'));
  if (have('methodReturns')) lines.push(count('methodReturns', 'method return', 'method returns'));
  if (have('ignoredActivities')) lines.push(count('ignoredActivities', 'ignored Activity', 'ignored Activities'));
  if (have('permissions')) lines.push(`${Object.keys(doc.package.permissions.states).length} permission choices`);
  return lines;
}

/**
 * What an import of the plugins part would do, for the confirmation the page shows before anything is applied: one row per plugin of the file { name, chars, replaces (the name of the
 * plugin it replaces, or null), enabled } and `total` (the list after the import; over MAX_PLUGINS the import is refused whole). `existing`: the page's plugins [{ id, name }].
 * A plugin replaces the one with the same id, else the one with the same name.
 */
export function planPluginImport(plugins, existing) {
  const taken = new Set(), rows = (plugins ?? []).map(item => {
    const at = existing.findIndex((plugin, index) => !taken.has(index) && ((item.id !== undefined && plugin.id === item.id) || String(plugin.name).trim().toLowerCase() === String(item.name).trim().toLowerCase()));
    if (at >= 0) taken.add(at);
    return { name: String(item.name).trim(), chars: String(item.code).length, replaces: at >= 0 ? existing[at].name : null, at, enabled: item.enabled !== false };
  });
  return { rows, total: existing.length + rows.filter(row => row.at < 0).length };
}
