// The list of page plugins of the "Plugins" section (src/plugins-panel.js): global (not per package; each plugin has an optional package filter), kept in localStorage with every
// access guarded (without storage the list lasts for the page), exported and imported as JSON. Pure functions: tested without a DOM.
import { PLUGIN_TEMPLATES } from './plugin-runtime.js?v=aaaa8db990e6';

export const STORAGE_KEY = 'apkweb.plugins.v1', EXPORT_FORMAT = 'apk-web-lab-plugins', MAX_PLUGINS = 32, MAX_CODE_CHARS = 200000, MAX_NAME_CHARS = 120;
let counter = 0;
export const newPluginId = () => `pl-${Date.now().toString(36)}-${(++counter).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
export function normalizePlugin(raw = {}) {
  const item = raw && typeof raw === 'object' ? raw : {};
  return { id: typeof item.id === 'string' && /^[\w-]{1,64}$/.test(item.id) ? item.id : newPluginId(), name: String(item.name ?? '').trim().slice(0, MAX_NAME_CHARS) || 'Plugin sem nome',
    code: String(item.code ?? '').slice(0, MAX_CODE_CHARS), enabled: item.enabled === true, packageFilter: String(item.packageFilter ?? '').trim().slice(0, 400),
    updates: item.updates === 'manual' ? 'manual' : 'auto', height: blockHeight(item.height) };
}
/** Height of the output blocks of a plugin's card: 'wrap' (up to 320 px, then a scroll: the default), 'auto' (whole content) or a number of px (80–2000, fixed with a scroll). */
export function blockHeight(value) {
  if (value === 'auto' || value === 'wrap') return value;
  const n = Math.round(Number(value)); return Number.isFinite(n) && n > 0 ? Math.max(80, Math.min(2000, n)) : 'wrap';
}
export function validatePlugin(plugin) {
  const errors = [];
  if (!String(plugin.name ?? '').trim()) errors.push({ field: 'name', message: 'Dê um nome ao plugin.' });
  if (String(plugin.code ?? '').length > MAX_CODE_CHARS) errors.push({ field: 'code', message: `O código passa de ${MAX_CODE_CHARS} caracteres.` });
  if (!String(plugin.code ?? '').trim()) errors.push({ field: 'code', message: 'Escreva o código do plugin (ou escolha um modelo).' });
  return { errors };
}
export function loadPlugins(storage = undefined) {
  try { const store = storage === undefined ? globalThis.localStorage : storage; const list = JSON.parse(store?.getItem(STORAGE_KEY) ?? '[]'); return Array.isArray(list) ? list.slice(0, MAX_PLUGINS).map(normalizePlugin) : []; } catch { return []; }
}
export function savePlugins(list, storage = undefined) {
  try { const store = storage === undefined ? globalThis.localStorage : storage; if (!store) return false; store.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_PLUGINS).map(normalizePlugin))); return true; } catch { return false; }
}
export const exportPlugins = list => JSON.stringify({ format: EXPORT_FORMAT, version: 1, plugins: list.map(normalizePlugin).map(({ id, ...rest }) => rest) }, null, 2);
/** An exported file (or a bare array) -> { plugins, error? }; imported plugins get fresh ids and start switched off (the code is someone's: look at it first). */
export function importPlugins(text) {
  let data; try { data = JSON.parse(String(text)); } catch (error) { return { plugins: [], error: `O arquivo não é JSON válido: ${String(error?.message ?? error).slice(0, 120)}` }; }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray(data.plugins) ? data.plugins : null;
  if (!list) return { plugins: [], error: `O arquivo não tem uma lista de plugins (esperado {"format":"${EXPORT_FORMAT}","plugins":[...]}).` };
  return { plugins: list.slice(0, MAX_PLUGINS).filter(item => item && typeof item === 'object').map(item => ({ ...normalizePlugin({ ...item, id: undefined }), enabled: false })), ...(list.length > MAX_PLUGINS ? { error: `Só os primeiros ${MAX_PLUGINS} plugins foram importados.` } : {}) };
}
export const BLANK_TEMPLATE = { id: 'blank', name: 'Em branco', description: 'Um plugin vazio.', code: "// Escreva aqui. Exemplo:\nlab.on('screen', tela => lab.ui.text(tela.activity ?? '—', { id: 'tela' }));\n" };
export const templates = () => [BLANK_TEMPLATE, ...PLUGIN_TEMPLATES];
export function fromTemplate(id) { const template = templates().find(item => item.id === id) ?? BLANK_TEMPLATE; return normalizePlugin({ name: template.id === 'blank' ? 'Novo plugin' : template.name, code: template.code, enabled: true }); }
