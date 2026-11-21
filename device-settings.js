import { coreMemorySetting } from './core-memory.js?v=7233e918dcc9';
import { isMemoryStep } from './memory-budget.js?v=7233e918dcc9';
import { EVENT_SECONDS_STEPS } from './time-limits.js?v=7233e918dcc9';
import { sanitizeHostMap } from './host-map.js?v=7233e918dcc9';
import { DEFAULT_DEVICE, SCREEN_PRESETS, DEFAULT_CUSTOM_SCREEN, checkCustomScreen, resolveDevice } from './device-profile.js?v=7233e918dcc9';
import { sanitizeLocation } from './runtime-permissions.js?v=7233e918dcc9';
import { sanitizeRendererSetting } from './gpu-raster.js?v=7233e918dcc9';
import { sanitizeMicrogServices } from './microg-services.js?v=7233e918dcc9';
import { RELAY_AUTO_BASE, RELAY_AUTO_PROXY, RELAY_DEFAULT_PORT } from './relay-detect.js?v=7233e918dcc9';
import { tunnelEndpoint } from './tcp-tunnel.js?v=7233e918dcc9';
// Per-viewer virtual-device settings, kept in localStorage (every access guarded: private windows / blocked storage must not break the page).
const KEY = 'apk-lab-device-v1';
const ALLOWED = { screen: [...SCREEN_PRESETS.map(p => p.id), 'custom'], orientation: ['portrait', 'landscape'], connectivity: ['online', 'offline', 'metered'], navigation: ['gesture', 'buttons'] };
const HOST_PATTERN = /^(?:\*|(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?|\[[0-9a-f:.]+\](?::\d{1,5})?|[0-9a-f:]+:[0-9a-f:.]*)$/;
/** Allowlist entries: "host", "*.suffix", "host:port", an IP literal or "*". Malformed entries are dropped (never guessed), the list is de-duplicated and bounded. */
export function sanitizeHosts(list) {
  const entries = Array.isArray(list) ? list : typeof list === 'string' ? list.split(/[\s,]+/) : [], out = [];
  for (const raw of entries) { const host = typeof raw === 'string' ? raw.trim().toLowerCase() : ''; if (host && host.length <= 253 && HOST_PATTERN.test(host) && !out.includes(host)) out.push(host); if (out.length >= 64) break; }
  return out;
}
/** Optional relay: an https URL (or http on loopback). "{url}" in it marks where the encoded target goes; without it the encoded target is appended. */
export function sanitizeProxyUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return '';
  try { const url = new URL(value.trim().replace('{url}', 'TARGET')); const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return value.trim(); } catch { /* not a URL */ }
  return '';
}
/**
 * What the "Proxy" field of Device says (pure): { state: 'off' | 'on' | 'auto' | 'checking' | 'refused', text }. An empty field means "find the APK Lab Relay by itself"
 * (src/relay-detect.js): `detection` is the detector's state; `inUse` (optional) the proxy the running app was given ({ url, source }), when it differs from what the line
 * describes. A refused value is not kept: without this line the app would go on without a proxy and nothing on the page would say why.
 */
export function proxyState(raw, detection = null, { inUse = null } = {}) {
  const typed = String(raw ?? '').trim(), auto = RELAY_AUTO_BASE.replace(/^https?:\/\//, '');
  const running = wanted => inUse && inUse.url !== wanted ? ` The app open now still uses ${inUse.url ? (inUse.source === 'auto' ? `the relay at ${auto}` : `the proxy ${hostOfProxy(inUse.url) ?? inUse.url}`) : 'no proxy'}; it changes when the app is opened again.` : '';
  if (!typed) {
    const status = detection?.status ?? 'unknown';
    if (detection?.found) return { state: 'auto', text: `Relay found at ${auto} (automatic)${detection.version ? `: APK Lab Relay ${detection.version}` : ''}. The app's requests go through it; in Network they show the PROXY badge. Type an address here only for a custom proxy.${running(RELAY_AUTO_PROXY)}` };
    if (status === 'checking' || status === 'unknown') return { state: 'checking', text: `Looking for the APK Lab Relay on ${auto}…` };
    if (status === 'needs-permission') return { state: 'off', text: `No relay looked for yet: this browser asks before a page reaches your computer. "Look for the relay" asks once; until then the browser fetches directly (CORS applies).${running('')}`, action: 'look' };
    if (status === 'blocked') return { state: 'off', text: `No relay: this browser blocks the page from reaching your computer (site settings › Local network access), so the browser fetches directly (CORS applies).${running('')}`, action: 'look' };
    return { state: 'off', text: `No relay running: the browser fetches directly (CORS applies). Start the APK Lab Relay on this computer (node cors-relay.mjs, port ${RELAY_DEFAULT_PORT}) and the lab uses it by itself, or type a custom proxy here.${running('')}`, action: 'look' };
  }
  const kept = sanitizeProxyUrl(typed), host = kept ? hostOfProxy(kept) : null;
  if (kept && host) return { state: 'on', text: `Custom proxy: the app's requests go through ${host}${kept.includes('{url}') ? '' : ' (the target URL is appended at the end)'}. In Network they show the PROXY badge. Empty the field to use the APK Lab Relay found on this computer.${running(kept)}` };
  return { state: 'refused', text: `Proxy refused, not used: use https://… (or http:// only on localhost / 127.0.0.1), for example https://relay.example.com/?url={url}. Meanwhile ${detection?.found ? `the relay found at ${auto} is used` : 'the browser fetches directly (CORS applies)'}; empty, the field means "find the APK Lab Relay by itself".` };
}
const hostOfProxy = url => { try { return new URL(String(url).replace('{url}', 'x')).host; } catch { return null; } };
/** What the line under "Parallel relay channel" says (pure): { state: 'off' | 'on' | 'idle' | 'warn', text }. The channel exists only through the APK Lab Relay (tcp-tunnel.js tunnelEndpoint). */
export function relayChannelState(on, proxyRaw, detection = null) {
  if (!on) return { state: 'off', text: 'Parallel relay channel off: every exchange through the relay is a separate browser request (a preflight for most, about 6 at a time).' };
  const typed = String(proxyRaw ?? '').trim(), kept = typed ? sanitizeProxyUrl(typed) : (detection?.found ? RELAY_AUTO_PROXY : '');
  if (!kept) return { state: 'idle', text: 'Parallel relay channel on: it applies to exchanges through the APK Lab Relay, and no relay is in use now.' };
  if (!tunnelEndpoint({ proxyUrl: kept })) return { state: 'warn', text: 'Parallel relay channel on, but the custom Proxy is not an APK Lab Relay address (http://127.0.0.1:<port>/?url={url}): exchanges go as separate requests.' };
  return { state: 'on', text: 'Parallel relay channel on: the app\'s exchanges share one WebSocket to the relay, all at once. A relay without it (older than 0.4.0) gets separate requests, as before; Network shows CHANNEL or NO CHANNEL on each entry.' };
}
// The engine a load uses when nothing names one: the WebAssembly core. `?engine=js` (the page) and `engine: 'js'` (the player) select the JavaScript VM;
// scripts/build-web.mjs rewrites the next line for APKWEB_DEFAULT_ENGINE=js: a build whose default is the JavaScript VM.
export const DEFAULT_ENGINE = 'wasm';
export function sanitizeSettings(input = {}) {
  const out = { ...DEFAULT_DEVICE, battery: { ...DEFAULT_DEVICE.battery }, network: { allowedHosts: [], proxyUrl: '', hostMap: [], clientCertHosts: [], relayChannel: false }, memoryMiB: 0, eventSeconds: 0, location: sanitizeLocation(null) };   // memoryMiB: Java heap budget of the VM in MiB, 0 = automatic; applies at the next load
  if (input.network && typeof input.network === 'object') { out.network.allowedHosts = sanitizeHosts(input.network.allowedHosts); out.network.proxyUrl = sanitizeProxyUrl(input.network.proxyUrl); out.network.hostMap = sanitizeHostMap(input.network.hostMap); out.network.clientCertHosts = sanitizeHosts(input.network.clientCertHosts).filter(host => host !== '*'); out.network.relayChannel = input.network.relayChannel === true; }   // clientCertHosts: where the device presents the app's client certificate (mTLS) through the relay; never every host. relayChannel: "Parallel relay channel" (src/relay-mux.js): off here (embedders), on in the lab page's defaults
  for (const [name, values] of Object.entries(ALLOWED)) if (values.includes(input[name])) out[name] = input[name];
  { const custom = checkCustomScreen(input.customScreen); out.customScreen = custom.value ?? DEFAULT_CUSTOM_SCREEN; if (out.screen === 'custom' && !custom.value) out.screen = DEFAULT_DEVICE.screen; }   // "Personalizado" { width, height, unit: 'dp' | 'px' } (device-profile.js checkCustomScreen); kept while a preset is selected so switching back restores it
  if (Number.isFinite(Number(input.fontScale))) out.fontScale = Math.min(2, Math.max(0.85, Number(input.fontScale)));
  if (Number.isFinite(Number(input.animatorScale))) out.animatorScale = Math.min(10, Math.max(0, Number(input.animatorScale)));
  if (Number.isFinite(Number(input.statusBarHeightDp)) && input.statusBarHeightDp !== null && input.statusBarHeightDp !== '') out.statusBarHeightDp = Math.min(64, Math.max(16, Number(input.statusBarHeightDp)));   // dp; null = the framework's status_bar_height
  if (isMemoryStep(Number(input.memoryMiB)) && input.memoryMiB !== null && input.memoryMiB !== '' && input.memoryMiB !== true) out.memoryMiB = Number(input.memoryMiB);
  if (EVENT_SECONDS_STEPS.includes(Number(input.eventSeconds)) && input.eventSeconds !== null && input.eventSeconds !== '' && input.eventSeconds !== true) out.eventSeconds = Number(input.eventSeconds);   // src/time-limits.js; 0 = the defaults
  if (typeof input.darkTheme === 'boolean') out.darkTheme = input.darkTheme;
  if (typeof input.hour24 === 'boolean') out.hour24 = input.hour24;
  out.location = sanitizeLocation(input.location);   // simulated device location ("Permissions" section): page-only, sent to the VM through the permission channel, never as part of the device model
  out.raster = { motionScale: [1, 0.75, 0.5, 0.35, 0.25].includes(Number(input.raster?.motionScale)) ? Number(input.raster.motionScale) : 1, navigation: input.raster?.navigation === true, stillScale: [1, 0.9, 0.8].includes(Number(input.raster?.stillScale)) ? Number(input.raster.stillScale) : 1 };   // "Resolution in motion" / "New screen in low resolution" (src/motion-raster.js MOTION_SCALE_STEPS)
  out.renderer = sanitizeRendererSetting(input.renderer);   // "Rendering": 'gpu' (default: WebGL replay in the Worker, src/gpu-raster.js, falling back to CPU by itself) or 'cpu'; applied live, never part of the device model the app sees
  out.engine = input.engine === 'wasm' || input.engine === 'js' ? input.engine : DEFAULT_ENGINE;   // the VM engine: 'wasm' (default: the WebAssembly core, docs/WASM-CORE-PLANO.md) or 'js' (the JavaScript VM); applies at the next load, never part of the device model the app sees
  out.coreMemory = coreMemorySetting(input.coreMemory);   // "Wasm core memory" { mode, heapMiB, metaMiB, threads } (src/core-memory.js): the mode (dynamic by default, or fixed) and the sizes of the WebAssembly core's memory; applies at the next load, only with engine 'wasm', never part of the device model the app sees
  out.layoutBounds = input.layoutBounds === true;   // page-only developer option ("Show layout bounds"); the VM never sees it
  out.frameGraph = input.frameGraph === true;   // page-only developer option ("Show frame rate": the FPS line and the frame-time bars, src/frame-meter.js); off by default, applied live, the VM never sees it
  out.arm64Native = input.arm64Native === true;
  out.arm64Translate = input.arm64Translate !== false;   // "Translate hot ARM64 code" (src/arm64/translate.js): on by default; read by the next load   // "Run ARM64 native code" (src/arm64/, docs/ARM64-NATIVE.md): off by default; read by the next load, recorded in the trace
  out.loadImage = input.loadImage === true;   // "Load image" (src/load-image.js): off by default (docs/PERFORMANCE-STRATEGY.md, step 1: it did not pay on the large examples); read by the next load, never part of the device model the app sees
  out.microg = input.microg === true;   // "Com microG" (src/microg-device.js, docs/MICROG.md): off by default; read by the next load (the Worker installs the microG packages), never applied live
  out.microgServices = sanitizeMicrogServices(input.microgServices);   // "microG services" (src/microg-services.js): each online service of microG off by default; read by the next load and sent live to a VM that runs microG (vm.setMicrogServices), never part of the device model
  if (typeof input.locale === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(input.locale)) out.locale = input.locale;
  if (typeof input.timeZone === 'string' && input.timeZone.length < 64) { try { if (input.timeZone) new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }); out.timeZone = input.timeZone; } catch { /* unknown zone: keep default */ } }
  if (input.battery && typeof input.battery === 'object') { out.battery.level = Math.min(100, Math.max(0, Math.round(Number(input.battery.level) || 0))); out.battery.charging = !!input.battery.charging; }
  return out;
}
/** A new user's device reaches every host (allowedHosts = ['*']); sanitizeSettings({}) alone stays the closed policy so embedders that pass no network config keep it. */
/** The lab page's defaults: every host allowed, animations at 1× (as a device ships), every frame drawn at full resolution, moving or new (raster: motionScale 1, navigation off). */
/** The parallel relay channel is on (it applies only through the APK Lab Relay; the 2026-11-20 default). */
export function defaultDeviceSettings() { return sanitizeSettings({ network: { allowedHosts: ['*'], relayChannel: true }, animatorScale: 1 }); }
/** Stored-settings format: 2 since the "allow every host" option became the default; a record without the marker was saved by a page that only knew the closed allow list.
 * 3 since the engine and the renderer are choices of the Execução panel with new defaults (the WebAssembly core, the GPU): an older record held the old defaults, not a choice.
 * 4 since animations are off and the moving screen is drawn at 35% by default: an older record held the old defaults (1× and 50%), not a choice.
 * 5 since every frame is drawn at full resolution by default (moving screens at 100%, a new screen not started at the motion resolution): an older record held 35% and the reduced
 *   first frame as defaults, not a choice.
 * 6 since animations are back at 1× by default: an older record held 0 (off) as the default, not a choice.
 * 7 since the parallel relay channel is on by default and the relay has no token (2026-11-20): an older record held the channel off as the default, not a choice, and a Proxy
 *   holding the APK Lab Relay's old token address on the default port (http://127.0.0.1:8787/<token>/?url={url}) is emptied, so the relay is found by itself. */
export const SETTINGS_VERSION = 7;
/** The address an older relay printed for the default port, with its token: the relay the page now finds by itself. */
const OLD_DEFAULT_RELAY = /^http:\/\/(?:127\.0\.0\.1|localhost):8787\/[A-Za-z0-9_-]{8,128}\/\?url=\{url\}$/;
export function loadDeviceSettings() {
  try {
    const text = globalThis.localStorage?.getItem(KEY); if (!text) return defaultDeviceSettings();
    const stored = JSON.parse(text);
    // A record saved before the allow-every-host default (no version marker) with no host of its own keeps that user on the closed policy for good ("16 requests, 16 refused" with the
    // option shown as the default): it takes the default, like a new user; a list the user typed is kept.
    if (stored && typeof stored === 'object' && !(stored.version >= 2) && !sanitizeHosts(stored.network?.allowedHosts).length) stored.network = { ...(stored.network ?? {}), allowedHosts: ['*'] };
    if (stored && typeof stored === 'object' && !(stored.version >= 3)) { delete stored.engine; delete stored.renderer; }   // the old defaults were stored with every record: the new ones apply
    if (stored && typeof stored === 'object' && !(stored.version >= 6)) stored.animatorScale = 1;   // the defaults of each version apply once; what the user picks afterwards is kept
    if (stored && typeof stored === 'object' && !(stored.version >= 5)) stored.raster = { ...(stored.raster ?? {}), motionScale: 1, navigation: false };
    if (stored && typeof stored === 'object' && !(stored.version >= 7)) { const network = { ...(stored.network ?? {}), relayChannel: true }; if (OLD_DEFAULT_RELAY.test(String(network.proxyUrl ?? '').trim())) network.proxyUrl = ''; stored.network = network; }
    return sanitizeSettings(stored);
  } catch { return defaultDeviceSettings(); }
}
export function saveDeviceSettings(settings) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...settings, version: SETTINGS_VERSION })); return true; } catch { return false; } }
export { resolveDevice, checkCustomScreen };

/** The device model the VM gets: the page-only blocks (simulated location) are left out so they never count as a device change. */
/** The part of the settings the running app's Configuration/device model reads (src/device-profile.js resolveDevice): a change of anything else (motion/still
 * resolution, renderer, time per event: side calls; memory, core memory, engine: next load) needs no exclusive 'device' VM operation. */
export function vmDeviceModel(settings) { const { raster, eventSeconds, memoryMiB, coreMemory, engine, ...device } = deviceForVM(settings); return device; }
export function deviceForVM(settings) { const { location, renderer, microg, microgServices, arm64Native, arm64Translate, layoutBounds, frameGraph, ...device } = settings; return device; }   // layoutBounds and frameGraph: page overlays, the app never sees them (turning one on is not a Configuration change); microg: a load option (the installed packages), not part of the device model
