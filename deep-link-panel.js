// An Intent request from a link, an action and a component (the MCP tool open_link), and the wording of the result. DOM-free; src/deep-link-host.js (Worker) does the
// resolution and the start. (The Controles panel had an "Abrir" form built on this; links are now opened from the adb terminal: adb shell am start -a VIEW -d <link>.)
export const DEFAULT_ACTION = 'android.intent.action.VIEW';

const text = value => typeof value === 'string' ? value.trim() : '';

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

const shortName = name => String(name ?? '').split('.').pop();
/** The inline result for a Worker `deepLink` outcome: { state: 'ok' | 'error', message, detail }. */
export function describeDeepLink(outcome) {
  if (!outcome) return { state: 'error', message: 'O Worker não respondeu ao link.', detail: '' };
  if (!outcome.ok) return { state: 'error', message: outcome.error || 'Nenhuma Activity resolve este link.', detail: '' };
  const lead = outcome.launched ? 'App iniciado com este Intent' : 'Activity iniciada';
  const alternatives = outcome.alternatives?.length ? `Também combinam: ${outcome.alternatives.map(entry => shortName(entry.activity)).join(', ')} (usada a primeira).` : '';
  return { state: 'ok', message: `${lead}: ${shortName(outcome.activity)}`, detail: [outcome.filter ? `Filtro: ${outcome.filter}` : 'Componente explícito', alternatives].filter(Boolean).join('\n') };
}
