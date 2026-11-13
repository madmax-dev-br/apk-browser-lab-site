// "Abrir" group of the Controles panel, DOM-free: the Intent request built from the form, the recent-links history (kept in localStorage, every access guarded) and the
// wording of the result. app.js owns the elements; src/deep-link-host.js (Worker) does the resolution and the start.
export const HISTORY_KEY = 'apk-lab-deeplinks-v1';
export const HISTORY_LIMIT = 10;
export const DEFAULT_ACTION = 'android.intent.action.VIEW';

const text = value => typeof value === 'string' ? value.trim() : '';
const sameEntry = (a, b) => a.link === b.link && a.action === b.action && a.component === b.component;

/** An Intent that names neither a link nor a component is still resolvable by its action (SEND, a custom action), with the MIME type when it has one: `am start -a ACTION -t TYPE`. */
const implicitByAction = (act, type) => !!text(type) || (!!act && act !== DEFAULT_ACTION);
/**
 * The Intent description the Worker's `intent` request takes. A link needs a scheme ("meuapp://x", "https://host/p"); a component alone (explicit Intent) needs no link; an action other
 * than VIEW, or a MIME type (`type`, which the caller adds to the request), is an implicit Intent resolved by the manifest's filters without either.
 */
export function buildDeepLinkRequest({ link = '', action = DEFAULT_ACTION, component = '', type = '' } = {}) {
  const data = text(link), cmp = text(component), act = text(action);
  if (!data && !cmp && !implicitByAction(act, type)) throw new Error('Informe um link (meuapp://caminho ou https://host/caminho), um componente ou uma ação diferente de VIEW (Intent implícito, como SEND com um tipo).');
  if (data && !/^[A-Za-z][A-Za-z0-9+.-]*:\S*$/.test(data)) throw new Error(`"${data}" não é um URI com esquema. Exemplo: meuapp://caminho?id=1 ou https://exemplo.com/p/1.`);
  if (cmp && !/^(?:[\w.$]+\/)?[\w.$]+$/.test(cmp)) throw new Error(`Componente inválido: "${cmp}". Use pacote/.Activity ou pacote/pacote.Activity.`);
  const request = {};
  if (act) request.action = act;
  if (data) request.data = data;
  if (cmp) request.component = cmp;
  return request;
}

/** Newest first, no duplicates, at most HISTORY_LIMIT entries. Returns a new list; the input is untouched. */
export function addToHistory(list, entry) {
  const clean = { link: text(entry?.link), action: text(entry?.action), component: text(entry?.component) };
  if (!clean.link && !clean.component && !implicitByAction(clean.action)) return [...list];
  return [clean, ...list.filter(item => !sameEntry(item, clean))].slice(0, HISTORY_LIMIT);
}

/** What the history row shows: the link (or the component) with a short action prefix when it is not the default VIEW. */
export function historyLabel(entry) {
  const action = entry.action && entry.action !== DEFAULT_ACTION ? `${entry.action.replace(/^android\.intent\.action\./, '')} ` : '';
  return `${action}${entry.link || entry.component || ''}${entry.link && entry.component ? `  → ${entry.component}` : ''}`.trim();
}

export function parseHistory(raw) {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter(item => item && typeof item === 'object').map(item => ({ link: text(item.link), action: text(item.action), component: text(item.component) })).filter(item => item.link || item.component || implicitByAction(item.action)).slice(0, HISTORY_LIMIT);
  } catch { return []; }
}
export function loadHistory(storage = globalThis.localStorage) { try { return parseHistory(storage?.getItem(HISTORY_KEY) ?? '[]'); } catch { return []; } }
export function saveHistory(list, storage = globalThis.localStorage) { try { storage?.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT))); return true; } catch { return false; } }

const shortName = name => String(name ?? '').split('.').pop();
/** The inline result for a Worker `deepLink` outcome: { state: 'ok' | 'error', message, detail }. */
export function describeDeepLink(outcome) {
  if (!outcome) return { state: 'error', message: 'O Worker não respondeu ao link.', detail: '' };
  if (!outcome.ok) return { state: 'error', message: outcome.error || 'Nenhuma Activity resolve este link.', detail: '' };
  const lead = outcome.launched ? 'App iniciado com este Intent' : 'Activity iniciada';
  const alternatives = outcome.alternatives?.length ? `Também combinam: ${outcome.alternatives.map(entry => shortName(entry.activity)).join(', ')} (usada a primeira).` : '';
  return { state: 'ok', message: `${lead}: ${shortName(outcome.activity)}`, detail: [outcome.filter ? `Filtro: ${outcome.filter}` : 'Componente explícito', alternatives].filter(Boolean).join('\n') };
}
