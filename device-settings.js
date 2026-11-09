import { isMemoryStep } from './memory-budget.js?v=17907d82f3e8';
import { EVENT_SECONDS_STEPS } from './time-limits.js?v=17907d82f3e8';
import { sanitizeHostMap } from './host-map.js?v=17907d82f3e8';
import { DEFAULT_DEVICE, SCREEN_PRESETS, resolveDevice } from './device-profile.js?v=17907d82f3e8';
import { sanitizeLocation } from './runtime-permissions.js?v=17907d82f3e8';
// Per-viewer virtual-device settings, kept in localStorage (every access guarded: private windows / blocked storage must not break the page).
const KEY = 'apk-lab-device-v1';
const ALLOWED = { screen: SCREEN_PRESETS.map(p => p.id), orientation: ['portrait', 'landscape'], connectivity: ['online', 'offline', 'metered'], navigation: ['gesture', 'buttons'] };
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
export function sanitizeSettings(input = {}) {
  const out = { ...DEFAULT_DEVICE, battery: { ...DEFAULT_DEVICE.battery }, network: { allowedHosts: [], proxyUrl: '', hostMap: [] }, memoryMiB: 0, eventSeconds: 0, location: sanitizeLocation(null) };   // memoryMiB: Java heap budget of the VM in MiB, 0 = automatic; applies at the next load
  if (input.network && typeof input.network === 'object') { out.network.allowedHosts = sanitizeHosts(input.network.allowedHosts); out.network.proxyUrl = sanitizeProxyUrl(input.network.proxyUrl); out.network.hostMap = sanitizeHostMap(input.network.hostMap); }
  for (const [name, values] of Object.entries(ALLOWED)) if (values.includes(input[name])) out[name] = input[name];
  if (Number.isFinite(Number(input.fontScale))) out.fontScale = Math.min(2, Math.max(0.85, Number(input.fontScale)));
  if (Number.isFinite(Number(input.animatorScale))) out.animatorScale = Math.min(10, Math.max(0, Number(input.animatorScale)));
  if (Number.isFinite(Number(input.statusBarHeightDp)) && input.statusBarHeightDp !== null && input.statusBarHeightDp !== '') out.statusBarHeightDp = Math.min(64, Math.max(16, Number(input.statusBarHeightDp)));   // dp; null = the framework's status_bar_height
  if (isMemoryStep(Number(input.memoryMiB)) && input.memoryMiB !== null && input.memoryMiB !== '' && input.memoryMiB !== true) out.memoryMiB = Number(input.memoryMiB);
  if (EVENT_SECONDS_STEPS.includes(Number(input.eventSeconds)) && input.eventSeconds !== null && input.eventSeconds !== '' && input.eventSeconds !== true) out.eventSeconds = Number(input.eventSeconds);   // src/time-limits.js; 0 = the defaults
  if (typeof input.darkTheme === 'boolean') out.darkTheme = input.darkTheme;
  if (typeof input.hour24 === 'boolean') out.hour24 = input.hour24;
  out.location = sanitizeLocation(input.location);   // simulated device location ("Permissões" section): page-only, sent to the VM through the permission channel, never as part of the device model
  out.layoutBounds = input.layoutBounds === true;   // page-only developer option ("Mostrar limites de layout"); the VM never sees it
  if (typeof input.locale === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(input.locale)) out.locale = input.locale;
  if (typeof input.timeZone === 'string' && input.timeZone.length < 64) { try { if (input.timeZone) new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }); out.timeZone = input.timeZone; } catch { /* unknown zone: keep default */ } }
  if (input.battery && typeof input.battery === 'object') { out.battery.level = Math.min(100, Math.max(0, Math.round(Number(input.battery.level) || 0))); out.battery.charging = !!input.battery.charging; }
  return out;
}
/** A new user's device reaches every host (allowedHosts = ['*']); sanitizeSettings({}) alone stays the closed policy so embedders that pass no network config keep it. */
export function defaultDeviceSettings() { return sanitizeSettings({ network: { allowedHosts: ['*'] } }); }
/** Stored-settings format: 2 since the "allow every host" option became the default; a record without the marker was saved by a page that only knew the closed allow list. */
export const SETTINGS_VERSION = 2;
export function loadDeviceSettings() {
  try {
    const text = globalThis.localStorage?.getItem(KEY); if (!text) return defaultDeviceSettings();
    const stored = JSON.parse(text);
    // A record saved before the allow-every-host default (no version marker) with no host of its own keeps that user on the closed policy for good ("16 requests, 16 refused" with the
    // option shown as the default): it takes the default, like a new user; a list the user typed is kept.
    if (stored && typeof stored === 'object' && !(stored.version >= SETTINGS_VERSION) && !sanitizeHosts(stored.network?.allowedHosts).length) stored.network = { ...(stored.network ?? {}), allowedHosts: ['*'] };
    return sanitizeSettings(stored);
  } catch { return defaultDeviceSettings(); }
}
export function saveDeviceSettings(settings) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...settings, version: SETTINGS_VERSION })); return true; } catch { return false; } }
export { resolveDevice };

/** The device model the VM gets: the page-only blocks (simulated location) are left out so they never count as a device change. */
export function deviceForVM(settings) { const { location, ...device } = settings; return device; }
