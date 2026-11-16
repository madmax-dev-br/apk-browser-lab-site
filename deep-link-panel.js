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
  if (!data && !cmp && !implicitByAction(act, type)) throw new Error('Enter a link (myapp://path or https://host/path), a component or an action other than VIEW (implicit Intent, such as SEND with a type).');
  if (data && !/^[A-Za-z][A-Za-z0-9+.-]*:\S*$/.test(data)) throw new Error(`"${data}" is not a URI with a scheme. Example: myapp://path?id=1 or https://example.com/p/1.`);
  if (cmp && !/^(?:[\w.$]+\/)?[\w.$]+$/.test(cmp)) throw new Error(`Invalid component: "${cmp}". Use package/.Activity or package/package.Activity.`);
  const request = {};
  if (act) request.action = act;
  if (data) request.data = data;
  if (cmp) request.component = cmp;
  return request;
}

const shortName = name => String(name ?? '').split('.').pop();
/** The inline result for a Worker `deepLink` outcome: { state: 'ok' | 'error', message, detail }. */
export function describeDeepLink(outcome) {
  if (!outcome) return { state: 'error', message: 'The Worker did not answer the link.', detail: '' };
  if (!outcome.ok) return { state: 'error', message: outcome.error || 'No Activity resolves this link.', detail: '' };
  const lead = outcome.launched ? 'App started with this Intent' : 'Activity started';
  const alternatives = outcome.alternatives?.length ? `Also matching: ${outcome.alternatives.map(entry => shortName(entry.activity)).join(', ')} (the first one is used).` : '';
  return { state: 'ok', message: `${lead}: ${shortName(outcome.activity)}`, detail: [outcome.filter ? `Filter: ${outcome.filter}` : 'Explicit component', alternatives].filter(Boolean).join('\n') };
}
