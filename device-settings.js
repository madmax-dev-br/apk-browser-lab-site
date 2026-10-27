import { DEFAULT_DEVICE, SCREEN_PRESETS, resolveDevice } from './device-profile.js?v=58b0147dafd8';
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
  const out = { ...DEFAULT_DEVICE, battery: { ...DEFAULT_DEVICE.battery }, network: { allowedHosts: [], proxyUrl: '' } };
  if (input.network && typeof input.network === 'object') { out.network.allowedHosts = sanitizeHosts(input.network.allowedHosts); out.network.proxyUrl = sanitizeProxyUrl(input.network.proxyUrl); }
  for (const [name, values] of Object.entries(ALLOWED)) if (values.includes(input[name])) out[name] = input[name];
  if (Number.isFinite(Number(input.fontScale))) out.fontScale = Math.min(2, Math.max(0.85, Number(input.fontScale)));
  if (Number.isFinite(Number(input.animatorScale))) out.animatorScale = Math.min(10, Math.max(0, Number(input.animatorScale)));
  if (Number.isFinite(Number(input.statusBarHeightDp)) && input.statusBarHeightDp !== null && input.statusBarHeightDp !== '') out.statusBarHeightDp = Math.min(64, Math.max(16, Number(input.statusBarHeightDp)));   // dp; null = the framework's status_bar_height
  if (typeof input.darkTheme === 'boolean') out.darkTheme = input.darkTheme;
  if (typeof input.hour24 === 'boolean') out.hour24 = input.hour24;
  if (typeof input.locale === 'string' && /^[a-z]{2}-[A-Z]{2}$/.test(input.locale)) out.locale = input.locale;
  if (typeof input.timeZone === 'string' && input.timeZone.length < 64) { try { if (input.timeZone) new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }); out.timeZone = input.timeZone; } catch { /* unknown zone: keep default */ } }
  if (input.battery && typeof input.battery === 'object') { out.battery.level = Math.min(100, Math.max(0, Math.round(Number(input.battery.level) || 0))); out.battery.charging = !!input.battery.charging; }
  return out;
}
export function loadDeviceSettings() { try { const text = globalThis.localStorage?.getItem(KEY); return sanitizeSettings(text ? JSON.parse(text) : {}); } catch { return sanitizeSettings({}); } }
export function saveDeviceSettings(settings) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(settings)); return true; } catch { return false; } }
export { resolveDevice };
