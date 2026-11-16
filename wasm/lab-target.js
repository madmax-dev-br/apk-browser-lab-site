// One component of the screen named by its id (lab.find, lab.highlight, lab.capture, lab.screenshot({ target }); docs/PLUGINS.md "Componente por id"): a Compose testTag or
// semantics node id, a View's android:id (by resource name or number), a key of lab.layoutBounds(), or what the component shows (text, contentDescription, role, name).
// The elements are the ones of lab.layoutBounds() (src/plugin-host.js layoutBoundsElementOut). Pure and DOM-free; the resource names are resolved by the caller (the VM has
// the APK's resource table) and given back here as numbers. No process.*.

export const TARGET_KEYS = Object.freeze(['id', 'key', 'testTag', 'viewId', 'nodeId', 'text', 'contentDescription', 'name', 'role', 'kind']);
const MAX_VALUE = 400;
const fail = (code, message) => Object.assign(new Error(message), { code });
const given = value => value !== undefined && value !== null && value !== '';
const text = value => String(value).slice(0, MAX_VALUE);
const integer = value => (typeof value === 'number' && Number.isInteger(value)) || (typeof value === 'string' && /^(0x[0-9a-f]+|\d+)$/i.test(value)) ? Number(value) : null;
const LAYOUT_KEY = /^[cv]:\d/;

/**
 * What a caller passes -> { id, key, testTag, viewId, nodeId, text, contentDescription, name, role, kind, index } (null where not given).
 * A string or a number is `id`: whatever identifies the component (testTag, android:id, layoutBounds key, node id). An element of lab.layoutBounds() is its key.
 * Also the MCP spelling (element_key, test_tag, view_id, node_id, content_description). Throws bad-args.
 */
export function targetSelector(raw) {
  if (!given(raw)) throw fail('bad-args', 'Diga qual componente: um id (testTag, android:id ou chave de layoutBounds) ou { testTag }, { viewId }, { nodeId }, { key }, { text }, { contentDescription }, { name }, { role }.');
  if (typeof raw === 'string' || typeof raw === 'number') return blank({ id: typeof raw === 'number' ? raw : text(raw) });
  if (typeof raw !== 'object') throw fail('bad-args', 'O alvo é um id ou um objeto como { testTag: "…" }.');
  const pick = (...names) => { for (const name of names) if (given(raw[name])) return raw[name]; return null; };
  const key = pick('key', 'element_key');
  if (key !== null && raw.bounds && typeof raw.bounds === 'object') return blank({ key: text(key) });   // an element of lab.layoutBounds() / lab.find(): the same element again
  const out = blank({ id: pick('id'), key, testTag: pick('testTag', 'test_tag'), viewId: pick('viewId', 'view_id'), nodeId: pick('nodeId', 'node_id'), text: pick('text'), contentDescription: pick('contentDescription', 'content_description'),
    name: pick('name'), role: pick('role'), kind: pick('kind'), index: pick('index') });
  for (const name of ['key', 'testTag', 'text', 'contentDescription', 'name', 'role', 'kind']) if (out[name] !== null) out[name] = text(out[name]);
  if (out.id !== null && typeof out.id !== 'number') out.id = text(out.id);
  if (out.viewId !== null && typeof out.viewId !== 'number') out.viewId = text(out.viewId);
  if (out.nodeId !== null) { const n = integer(out.nodeId); if (n === null) throw fail('bad-args', 'nodeId é o número do nó de semântica do Compose (o `id` de um elemento de lab.layoutBounds()).'); out.nodeId = n; }
  if (out.kind !== null && out.kind !== 'compose' && out.kind !== 'view') throw fail('bad-args', "kind é 'compose' ou 'view'.");
  if (out.index !== null) { const n = Number(out.index); if (!(Number.isInteger(n) && n >= 0)) throw fail('bad-args', 'index precisa ser um inteiro >= 0.'); out.index = n; }
  if (!TARGET_KEYS.some(name => name !== 'kind' && out[name] !== null)) throw fail('bad-args', `O alvo precisa de ao menos um de: ${TARGET_KEYS.filter(name => name !== 'kind').join(', ')}.`);
  return out;
}
const blank = values => ({ id: null, key: null, testTag: null, viewId: null, nodeId: null, text: null, contentDescription: null, name: null, role: null, kind: null, index: null, ...values });

/** The resource names an android:id may be written as: 'titulo', 'id/titulo', '@id/titulo', '@+id/titulo', 'pacote:id/titulo' -> the names the APK's table is asked for. */
export function resourceNameCandidates(value) {
  if (typeof value !== 'string') return [];
  const name = value.trim().replace(/^@\+?/, '');
  if (!name || /\s/.test(name) || integer(name) !== null || LAYOUT_KEY.test(name)) return [];
  return name.includes('/') ? [name] : [`id/${name}`];
}
/** Every resource name a selector needs resolved (its viewId and, for a generic id, the same string read as an android:id). */
export const selectorResourceNames = selector => [...new Set([...resourceNameCandidates(selector.viewId), ...resourceNameCandidates(selector.id)])];

/** The selector with its resource names turned into numbers: `ids` is { 'id/titulo': 0x7f0a0012 | null }. Adds viewIds / idViewIds (arrays of numbers) and `unknownViewId`. */
export function resolveSelector(selector, ids = {}) {
  const numbers = value => { const n = integer(value); if (n !== null) return [n >>> 0]; return resourceNameCandidates(value).map(name => ids?.[name]).filter(Number.isFinite).map(id => id >>> 0); };
  const viewIds = selector.viewId === null ? null : numbers(selector.viewId);
  return { ...selector, viewIds, idViewIds: selector.id === null ? null : numbers(selector.id), unknownViewId: viewIds !== null && !viewIds.length ? String(selector.viewId) : null };
}

const lower = value => String(value ?? '').toLowerCase();
const shown = element => [...(element.texts ?? []), ...(element.editableText ? [element.editableText] : [])];
/** Elements whose strings hold `wanted`: the ones that are exactly it when there are any, else the ones that contain it (case-insensitive). */
function byText(elements, wanted, strings) {
  const needle = lower(wanted), exact = elements.filter(element => strings(element).some(value => value === wanted));
  return exact.length ? exact : elements.filter(element => strings(element).some(value => lower(value).includes(needle)));
}
/**
 * The elements of lab.layoutBounds() a resolved selector names, in drawing order (every given field has to match).
 * A generic `id` matches a layoutBounds key, a testTag, a View whose android:id is that resource, and (a number) a Compose semantics node id or a View's android:id.
 */
export function matchTargets(elements, selector) {
  if (!Array.isArray(elements) || !selector) return [];
  let list = elements.filter(element => element && element.bounds);
  if (selector.kind !== null) list = list.filter(element => element.kind === selector.kind);
  if (selector.key !== null) list = list.filter(element => element.key === selector.key);
  if (selector.testTag !== null) list = list.filter(element => element.testTag === selector.testTag);
  if (selector.nodeId !== null) list = list.filter(element => element.kind === 'compose' && element.id === selector.nodeId);
  if (selector.viewIds) list = list.filter(element => element.kind === 'view' && Number.isFinite(element.viewId) && selector.viewIds.includes(element.viewId >>> 0));
  if (selector.role !== null) list = list.filter(element => element.role === selector.role);
  if (selector.name !== null) list = list.filter(element => element.name === selector.name);
  if (selector.text !== null) list = byText(list, selector.text, shown);
  if (selector.contentDescription !== null) list = byText(list, selector.contentDescription, element => element.contentDescriptions ?? []);
  if (selector.id !== null) {
    const id = selector.id, number = integer(id), views = selector.idViewIds ?? [];
    list = list.filter(element => element.key === id || (typeof id === 'string' && element.testTag === id)
      || (element.kind === 'view' && Number.isFinite(element.viewId) && views.includes(element.viewId >>> 0))
      || (number !== null && element.kind === 'compose' && element.id === number));
  }
  return list;
}
/** The one element a selector means among its matches: the `index`-th (the first by default), or null. */
export const chooseTarget = (matches, selector) => matches[selector?.index ?? 0] ?? null;

/** A selector in a few words, for messages: 'testTag "salvar"', 'android:id titulo', 'id "salvar"'. */
export function describeSelector(selector) {
  const parts = [];
  if (selector.id !== null) parts.push(`id ${JSON.stringify(selector.id)}`);
  if (selector.key !== null) parts.push(`a chave ${selector.key}`);
  if (selector.testTag !== null) parts.push(`testTag "${selector.testTag}"`);
  if (selector.viewId !== null) parts.push(`android:id ${selector.viewId}`);
  if (selector.nodeId !== null) parts.push(`nó ${selector.nodeId}`);
  if (selector.text !== null) parts.push(`texto "${selector.text}"`);
  if (selector.contentDescription !== null) parts.push(`contentDescription "${selector.contentDescription}"`);
  if (selector.name !== null) parts.push(`nome ${selector.name}`);
  if (selector.role !== null) parts.push(`papel ${selector.role}`);
  if (selector.kind !== null) parts.push(selector.kind === 'view' ? 'View' : 'Compose');
  return parts.join(', ').slice(0, 240);
}
/** The not-found error for a selector (says when the APK has no such resource id). */
export function targetNotFound(selector) {
  const unknown = selector.unknownViewId ? ` O APK não tem o id de recurso ${String(selector.unknownViewId).slice(0, 80)}.` : '';
  return fail('not-found', `Nenhum componente na tela com ${describeSelector(selector)}.${unknown} Veja lab.layoutBounds() para os ids e chaves atuais.`);
}
