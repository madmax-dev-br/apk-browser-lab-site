// Recomposition counts of the Compose screen, for the page's "Layout" panel (src/compose-inspector-panel.js). Off by default and costing nothing while off: nothing is intercepted.
//
// What is counted. The Compose compiler gives every restartable composable a restart group, and Compose keeps one RecomposeScopeImpl per restart group for as long as the group is in
// the composition. ComposerImpl.startRestartGroup calls RecomposeScopeImpl.start(int) each time a composition reaches the group, and skipToGroupEnd calls scopeSkipped() when the
// composable is skipped. This is the same thing Android Studio's Layout Inspector counts (it hooks startRestartGroup and skipToGroupEnd and keys by the scope's identity): a group
// composed for the first time counts 0, each later start that is not skipped is one recomposition, a skipped one is a skip. Compose has had these three methods since 1.0.
// (A scope whose very first composition is skipped -- a pausable composition that paused there -- has not been composed yet: its next start is still its first composition.)
//
// How. The methods are observed with the runtime's method interceptors (src/method-overrides.js setMethodInterceptor), which the interpreter, its compiled code and the WebAssembly
// core all honor (a call site that had cached the callee forgets it; the core routes the method's calls to the host): the interceptor reads the receiver's id and the original body
// runs. It calls no app code and changes no argument or result. Counts are keyed by the scope's object id, which is never reused, and hold no reference: the collector frees a
// scope as before, and entries of freed scopes are dropped.
//
// Per composable. The entry of every restartable composable is observed as well (src/compose-composables.js), so each group has the name of its composable and the inputs of each
// composition. What was not skipped is sorted by evidence, an indication of what to analyse and never a verdict:
//   needed       a state the composable reads changed (RecomposeScopeImpl.invalidateForResult), an input has another value, a CompositionLocal above changed, the slot was reused
//   avoidable    it ran because an input is another instance with the same class and content (a recreated lambda, List or unstable class)
//   unnecessary  it ran although no input changed and nothing it reads was invalidated
//   unknown      the evidence is missing (its previous composition was not seen, an input changed in place or is too large to compare, something else invalidated it)
// "Needs review" and "frequent" follow the constants below. Snapshots of the inputs hold values and object ids (never reused), no references.
//
// Not available (said, never guessed): the app has no RecomposeScopeImpl under that name (no Compose, or a minifier renamed it), the class lacks start/scopeSkipped (a minifier
// inlined them), or a method change the user made already replaces one of them.
import { RUN_BODY, setMethodInterceptors } from './method-overrides.js?v=28012a33f717';
import { RECOMPOSE_SCOPE, composeOwnerViews, rootComposition, vmCaller, walkComposition } from './compose-compositions.js?v=28012a33f717';
import { compareInputs, composableOfLambda, composableOfMethod, composableOfScope, composerArgument, fieldOf, isComposableLambda, lambdaBlock, restartableMethods, snapshotInputs } from './compose-composables.js?v=28012a33f717';

const NODE = 'Landroidx/compose/ui/node/LayoutNode;', COORDS = 'Landroidx/compose/ui/layout/LayoutCoordinates;', COORDS_KT = 'Landroidx/compose/ui/layout/LayoutCoordinatesKt;', RECT = 'Landroidx/compose/ui/geometry/Rect;';
const START = 'start(I)V', SKIPPED = 'scopeSkipped()V', INVALIDATED = 'setRequiresRecompose(Z)V', END = 'end(I)', STATE = 'invalidateForResult(Ljava/lang/Object;)', EXPLICIT = 'invalidate()V', RESTART = 'compose(Landroidx/compose/runtime/Composer;)V';
export const MAX_CHANGED = 400;   // elements of one update; the rest are counted in the total and in the next capture
export const MAX_COMPOSABLES = 1000, MAX_REASONS = 6;   // rows of the table in one message (by recompositions); reasons kept per composable
// "Needs review": at least REVIEW_MIN recompositions without a needed cause (unnecessary or likely avoidable) that are at least REVIEW_SHARE of the ones whose cause is known.
export const REVIEW_MIN = 3, REVIEW_SHARE = 0.5;
// "Frequent" (not a fault by itself: an animation is frequent): one instance recomposed FREQUENT_PER_SECOND times in one second of the app's clock, or twice in one frame.
export const FREQUENT_PER_SECOND = 10, FREQUENT_PER_FRAME = 2;
const states = new WeakMap();   // runtime -> the counting state (outside what the collector walks: it holds ids, never objects)
const floats = new DataView(new ArrayBuffer(4));
const float = bits => { floats.setInt32(0, bits, true); return floats.getFloat32(0, true); };
const round = value => Math.round(value * 100) / 100;

/** Why the counts cannot be taken in this runtime, or null. */
function unavailable(runtime) {
  const cls = runtime.classes?.get?.(RECOMPOSE_SCOPE);
  if (!cls?.methods) return 'this app has no androidx.compose.runtime.RecomposeScopeImpl (it does not use Compose, or a minifier renamed the Compose runtime)';
  const missing = [START, SKIPPED].filter(name => !cls.methods.get(name)?.code); if (missing.length) return `RecomposeScopeImpl has no ${missing.join(' and ')} in this build (a minifier removed or inlined it)`;
  const changed = [START, SKIPPED].find(name => runtime.methodOverrides?.has(`${RECOMPOSE_SCOPE}->${name}`)); if (changed) return `RecomposeScopeImpl.${changed} has a method change of its own (Method returns or a plugin)`;
  return null;
}

/** { counting, available, reason, total, skips, unjoined, groups, review, evidence }: total and skips since counting started or was reset, over every composition of the app; unjoined: those
 * of the total that belong to a composable with no element of its own on the screen (as of the last update); groups: the restart groups seen; review: the composables that need review;
 * evidence: what this build does not let the counter tell (null: everything). */
export function recompositionStatus(runtime) {
  const state = states.get(runtime), off = { counting: false, available: null, reason: null, total: null, skips: null, unjoined: null, groups: 0, review: 0, evidence: null };
  if (!state) return off;
  if (!state.on) return { ...off, available: false, reason: state.reason };
  let review = 0; for (const item of state.composables.values()) if (reviewOf(item).length) review++;
  return { counting: true, available: true, reason: null, total: state.total, skips: state.skips, unjoined: state.unjoined, groups: state.counts.size, review, evidence: state.evidence };
}

const UNIDENTIFIED = Object.freeze({ key: 'unidentified', name: 'not identified', kind: 'unknown', declaredIn: '', source: 'none', detail: 'the composable of these restart groups is not in the APK under a form the lab can read', obfuscated: false, library: false });
/** Starts counting (again harmless while on). `onChange` is called when the first change of a batch arrives (the Worker schedules its update then). Returns the status. */
export function startRecompositionCounting(runtime, { onChange = null } = {}) {
  const known = states.get(runtime); if (known?.on) { known.onChange = onChange; return recompositionStatus(runtime); }
  const reason = unavailable(runtime);
  if (reason !== null) { if (known?.reason !== reason) runtime.record(`COMPOSE recomposition counting not available: ${reason}`); states.set(runtime, { on: false, reason }); return recompositionStatus(runtime); }
  const state = { on: true, reason: null, onChange, counts: new Map(), fresh: new Set(), batch: new Map(), dirty: new Set(), composables: new Map(), total: 0, skips: 0, keys: [], unjoined: 0, evidence: null, methods: new Map(), names: new Map() };
  const entryOf = id => { let entry = state.counts.get(id); if (entry === undefined) state.counts.set(id, entry = newEntry()); return entry; };
  const touch = (id, recomposed) => { const first = state.batch.size === 0; state.batch.set(id, (state.batch.get(id) ?? 0) + recomposed); if (first) state.onChange?.(); };
  const observe = (keys, fn) => { const free = keys.filter(key => !runtime.methodInterceptors?.has(key)); state.keys.push(...free); setMethodInterceptors(runtime, free, (rt, definition, args) => { fn(args, definition); return RUN_BODY; }); };
  const methods = runtime.classes.get(RECOMPOSE_SCOPE).methods, scoped = (test, fn) => { const keys = [...methods.keys()].filter(test).map(nameSig => `${RECOMPOSE_SCOPE}->${nameSig}`); observe(keys, args => { const id = args[0]?.ref; if (id !== undefined) fn(id, args); }); return keys.length > 0; };
  // the composable being entered: its startRestartGroup is the first thing it does, so the next start of the same thread is its group's
  const entered = { definition: null, args: null, thread: null };
  state.methods = restartableMethods(runtime);
  observe([...state.methods.keys()], (args, definition) => { entered.definition = definition; entered.args = args; entered.thread = runtime.thread; });
  scoped(nameSig => nameSig.startsWith('<init>('), id => { state.fresh.add(id); });
  const sees = { invalidated: scoped(nameSig => nameSig === INVALIDATED, (id, args) => { entryOf(id).invalidated = !!args[1]; }), end: scoped(nameSig => nameSig.startsWith(END), id => { const entry = state.counts.get(id); if (entry?.running) finish(runtime, state, entry); }),
    state: scoped(nameSig => nameSig.startsWith(STATE), (id, args) => { const entry = entryOf(id); entry.byState = stateName(runtime, args[1]) ?? entry.byState ?? 'a state'; }) };
  sees.restart = scoped(nameSig => nameSig === RESTART, id => { entryOf(id).restarted = true; });   // the Recomposer restarts an invalidated scope through its block (the invalidation is off the list by then)
  scoped(nameSig => nameSig === EXPLICIT, id => { entryOf(id).byCall = true; });
  scoped(nameSig => nameSig === START, id => {
    const entry = entryOf(id); entry.initial = state.fresh.delete(id); begin(runtime, state, entry, entered);
    if (entry.initial) return;
    entry.recompositions++; state.total++; composableItem(state, entry).recompositions++; touch(id, 1);
  });
  scoped(nameSig => nameSig === SKIPPED, id => {
    const entry = state.counts.get(id); if (entry === undefined) return; entry.running = null;
    if (entry.initial) { state.fresh.add(id); return; }   // paused before its first composition
    entry.recompositions--; entry.skips++; state.total--; state.skips++; const item = composableItem(state, entry); item.recompositions--; item.skips++; touch(id, -1);
  });
  if (!state.methods.size) state.evidence = 'the composables of this build are not recognized (no method with a Composer calls startRestartGroup): no names and no inputs';
  else if (!sees.invalidated || !sees.end || !sees.state || !sees.restart) state.evidence = 'this Compose build has no setRequiresRecompose, compose, end or invalidateForResult: what invalidated a composable is not known';
  state.sees = state.evidence === null;
  states.set(runtime, state);
  runtime.record(`COMPOSE recomposition counting on (Layout panel): RecomposeScopeImpl and the entries of ${state.methods.size} restartable composables are observed; their own code runs`);
  return recompositionStatus(runtime);
}
/** A restart group's entry: its counts, its composable, the inputs of its last composition, what invalidated it since, and the composition in progress. */
const newEntry = () => ({ recompositions: 0, skips: 0, initial: false, composable: null, inputs: null, invalidated: false, restarted: false, byState: null, byCall: false, running: null, second: 0, inSecond: 0, frame: -1, inFrame: 0 });
/** A state's class, for the reason: 'mutableIntStateOf' objects are SnapshotMutableIntStateImpl ... */
function stateName(runtime, value) { try { const type = value?.ref !== undefined ? runtime.vmObject(value).type : null; return type ? type.slice(type.lastIndexOf('/') + 1, -1).replace(/^Parcelable/, '') : null; } catch { return null; } }
/** A group starts composing: its composable, its inputs, and what Compose knows about why. Nothing here can fail the app: what cannot be read is unknown. */
function begin(runtime, state, entry, entered) {
  const { definition, args } = entered, seen = definition !== null && entered.thread === runtime.thread; entered.definition = null; entered.args = null;
  const run = { inputs: null, lambda: false, invalidated: entry.invalidated || entry.restarted, byState: entry.byState, byCall: entry.byCall, locals: false, reusing: false, forced: false };
  entry.byState = null; entry.byCall = false; entry.restarted = false; entry.running = run;
  if (!seen) { entry.composable ??= UNIDENTIFIED.key; return; }
  try {
    run.lambda = isComposableLambda(definition);
    if (run.lambda) { const block = lambdaBlock(runtime, args[0]), type = block?.ref !== undefined ? runtime.vmObject(block).type : null; entry.composable = type ? named(state, `lambda:${type}`, () => composableOfLambda(runtime, type)) : UNIDENTIFIED.key; }
    else entry.composable = named(state, definition.method.key, () => composableOfMethod(definition.method));
    const composer = composerArgument(definition, args);
    if (composer?.ref !== undefined) { const record = runtime.vmObject(composer), flag = name => fieldOf(record, `->${name}:Z`) === 1; run.locals = flag('providersInvalid'); run.reusing = flag('reusing'); run.forced = flag('forciblyRecompose'); }
    run.inputs = snapshotInputs(runtime, definition, args, entry.inputs);
  } catch { run.inputs = null; }
}
const named = (state, key, make) => { if (!state.names.has(key)) state.names.set(key, make()); return key; };
function composableItem(state, entry) {
  const key = entry.composable ?? UNIDENTIFIED.key; let item = state.composables.get(key);
  if (item === undefined) state.composables.set(key, item = { ...(state.names.get(key) ?? UNIDENTIFIED), recompositions: 0, skips: 0, needed: 0, avoidable: 0, unnecessary: 0, unknown: 0, reasons: new Map(), perSecond: 0, perFrame: 0 });
  state.dirty.add(key); return item;
}
/** A group that was not skipped ends: what its recomposition was for, by evidence. */
function finish(runtime, state, entry) {
  const run = entry.running, before = entry.inputs; entry.running = null; if (run.inputs) entry.inputs = run.inputs;
  if (entry.initial) return;
  const item = composableItem(state, entry); frequency(runtime, entry, item);
  const { verdict, reason } = causeOf(runtime, state, run, before);
  item[verdict]++; const key = `${verdict}: ${reason}`; if (item.reasons.has(key) || item.reasons.size < MAX_REASONS) item.reasons.set(key, (item.reasons.get(key) ?? 0) + 1);
}
function causeOf(runtime, state, run, before) {
  if (!state.sees) return { verdict: 'unknown', reason: 'what invalidated it is not known in this Compose build' };
  if (run.reusing) return { verdict: 'needed', reason: 'its slot was reused for another item' };
  if (run.invalidated && run.byState) return { verdict: 'needed', reason: `a state it reads changed (${run.byState})` };
  if (run.locals) return { verdict: 'needed', reason: 'a CompositionLocal above it changed' };
  if (run.forced) return { verdict: 'unknown', reason: 'Compose was told to recompose everything' };
  const inputs = compareInputs(runtime, before, run.inputs);
  if (!run.invalidated || inputs.verdict === 'needed') return inputs;
  if (run.lambda && run.byCall) return inputs.verdict === 'unnecessary' ? { verdict: 'unknown', reason: 'the content lambda was invalidated with the same captured values' } : inputs;   // ComposableLambdaImpl.update: its parent created the lambda again
  return { verdict: 'unknown', reason: run.byCall ? 'it was invalidated by a call, not by a state it reads' : 'it was invalidated before counting started' };
}
/** How often one instance recomposes: the most in one second of the app's clock, and in one frame. */
function frequency(runtime, entry, item) {
  let second = 0, frame = 0; try { second = Math.floor(runtime.platform.clock.now() / 1000); frame = runtime.platform.viewWindowHost?.frameState?.().framesRun ?? 0; } catch { return; }
  if (second !== entry.second) { entry.second = second; entry.inSecond = 0; }
  if (frame !== entry.frame) { entry.frame = frame; entry.inFrame = 0; }
  item.perSecond = Math.max(item.perSecond, ++entry.inSecond); item.perFrame = Math.max(item.perFrame, ++entry.inFrame);
}
/** Why a composable needs review: [] when it does not. */
function reviewOf(item) {
  if (item.detail.startsWith('Landroidx/compose/runtime/')) return [];   // Compose's own plumbing (CompositionLocalProvider takes a new ProvidedValue every time by design): counted, not flagged
  const needless = item.unnecessary + item.avoidable, known = needless + item.needed;
  return needless >= REVIEW_MIN && needless >= known * REVIEW_SHARE ? [...item.reasons].filter(([reason]) => /^(?:unnecessary|avoidable)/.test(reason)).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })) : [];
}
const frequentOf = item => [...(item.perSecond >= FREQUENT_PER_SECOND ? [`${item.perSecond} times in one second`] : []), ...(item.perFrame >= FREQUENT_PER_FRAME ? [`${item.perFrame} times in one frame`] : [])];
/** One row of the table. */
function composableRow(item, instances) {
  const review = reviewOf(item);
  return { key: item.key, name: item.name, kind: item.kind, declaredIn: item.declaredIn, source: item.source, detail: item.detail, obfuscated: item.obfuscated, library: item.library, recompositions: item.recompositions, skips: item.skips, instances,
    needed: item.needed, avoidable: item.avoidable, unnecessary: item.unnecessary, unknown: item.unknown, reasons: [...item.reasons].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })), review, frequent: frequentOf(item) };
}
/** The composables that recomposed or were skipped since counting started or was reset, most recomposed first; `only`: the keys to report. instances: their restart groups in memory. */
export function composableRows(runtime, only = null) {
  const state = states.get(runtime); if (!state?.on) return [];
  const instances = new Map(); for (const entry of state.counts.values()) if (entry.composable !== null) instances.set(entry.composable, (instances.get(entry.composable) ?? 0) + 1);
  const items = [...state.composables.values()].filter(item => (only === null || only.has(item.key)) && (only !== null || item.recompositions > 0 || item.skips > 0));
  return items.sort((a, b) => b.recompositions - a.recompositions || b.skips - a.skips || (a.key < b.key ? -1 : 1)).slice(0, MAX_COMPOSABLES).map(item => composableRow(item, instances.get(item.key) ?? 0));
}

/** Stops counting: the methods run as if never observed, and the counts are dropped. */
export function stopRecompositionCounting(runtime) {
  const state = states.get(runtime); states.delete(runtime);
  if (!state?.on) return recompositionStatus(runtime);
  setMethodInterceptors(runtime, state.keys, null);
  state.on = false; state.onChange = null;
  runtime.record(`COMPOSE recomposition counting off: ${state.total} recompositions and ${state.skips} skips in ${state.counts.size} restart groups`);
  return recompositionStatus(runtime);
}

/** The counters go back to 0, the causes and the flags with them; counting goes on (the inputs of the last compositions stay, to compare the next ones with). */
export function resetRecompositionCounts(runtime) {
  const state = states.get(runtime);
  if (state?.on) {
    for (const entry of state.counts.values()) { entry.recompositions = 0; entry.skips = 0; entry.inSecond = 0; entry.inFrame = 0; }
    state.total = 0; state.skips = 0; state.unjoined = 0; state.batch.clear(); state.composables.clear(); state.dirty.clear(); runtime.record('COMPOSE recomposition counts reset');
  }
  return recompositionStatus(runtime);
}

/** A restart group's counts: one that was not composed since counting started has 0. */
const countsOf = (state, id) => { const entry = state.counts.get(id); return { recompositions: entry?.recompositions ?? 0, skips: entry?.skips ?? 0 }; };
/** The composable of a restart group ({ key, name, ... }), or null. */
function composableOf(runtime, state, id) {
  const known = state.counts.get(id)?.composable; if (known && known !== UNIDENTIFIED.key) return state.names.get(known) ?? null;
  try { const found = composableOfScope(runtime, state.methods, id); if (found) named(state, found.key, () => found); return found; } catch { return null; }
}
/**
 * The restart groups of an element's row: the composables it is written as -- the functions between the app's last content lambda and the first library one ("ElevatedCard › Card",
 * "Text › BasicText"; Compose's own plumbing is left out) -- and the group that emits it. { ids, label }; label is the emitter's name when there are no such functions, null when nothing is known.
 */
function rowOf(runtime, state, groups) {
  const found = groups.own.map(id => ({ id, item: composableOf(runtime, state, id) })), known = found.filter(value => value.item), emitter = groups.own.length ? found.at(-1).item : composableOf(runtime, state, groups.emitter);
  const from = known.findLastIndex(({ item }) => item.kind === 'lambda' && !item.library) + 1, rest = known.slice(from), to = rest.findIndex(({ item }) => item.kind === 'lambda');
  const written = (to < 0 ? rest : rest.slice(0, to)).filter(({ item }) => !item.detail.startsWith('Landroidx/compose/runtime/')), names = written.map(({ item }) => item.name);
  return { ids: new Set([...written.map(({ id }) => id), groups.emitter]), label: names.filter((name, i) => name !== names[i - 1]).join(' › ') || emitter?.name || null, emitter, own: found.map(({ item }) => item) };
}
/**
 * The counts of one LayoutNode from its slot-table groups (walkComposition), those of the restart groups of its row (rowOf): recompositions is the count of the one that recomposed most
 * (a wrapper and what it wraps recompose together, so a sum would count the same recomposition twice), skips the sum (once one is skipped the ones inside are not reached). `shared`: no
 * restart group starts between its parent node and it, so the counts are those of a group above the parent node (an inline layout such as Column has none of its own). `groups`: the groups
 * between, outermost first, each with its composable when known. `composable`: the one that emits the node; `label`: the composables the element is written as. null when not known.
 */
export function nodeRecomposition(runtime, groups, note) {
  const state = states.get(runtime);
  if (!state?.on || groups === null || groups.emitter === null) return { available: false, reason: note ?? 'no restart group of the slot table emits this node' };
  const row = rowOf(runtime, state, groups), short = found => found ? { key: found.key, name: found.name, kind: found.kind, obfuscated: found.obfuscated } : null, counts = [...row.ids].map(id => countsOf(state, id));
  return { available: true, recompositions: Math.max(...counts.map(value => value.recompositions)), skips: counts.reduce((sum, value) => sum + value.skips, 0), shared: groups.own.length === 0,
    groups: groups.own.map((id, i) => ({ ...countsOf(state, id), composable: short(row.own[i]) })), composable: short(row.emitter), label: row.label };
}

/**
 * The status and what changed since the last update, joined to the elements on the screen: { ...status, changed: [{ ownerViewId, semanticsId, recompositions, skips, shared, groups,
 * composable, recomposed (in this update), bounds (visible, px in the owner, when it recomposed) }], composables: the table's rows that changed, changedGroups, note }. A changed group whose composable emits no
 * element of its own on the screen (only other composables, effects, or a composition below a modal window) is in the total, in the table and in `unjoined`, with no box to show.
 */
export function recompositionUpdate(runtime, { maxChanged = MAX_CHANGED } = {}) {
  const state = states.get(runtime); if (!state?.on) return null;
  const batch = state.batch, dirty = state.dirty; state.batch = new Map(); state.dirty = new Set();
  for (const id of state.counts.keys()) if (!runtime.heap.has(id)) state.counts.delete(id);   // scopes the collector freed
  for (const id of state.fresh) if (!runtime.heap.has(id)) state.fresh.delete(id);
  const out = { ...recompositionStatus(runtime), changed: [], composables: composableRows(runtime, dirty), changedGroups: batch.size, note: null };
  if (!batch.size) return out;
  const call = vmCaller(runtime), emitted = new Set();
  const rect = value => { const r = {}; for (const side of ['left', 'top', 'right', 'bottom']) r[side] = round(float(call(value, RECT, 'get' + side[0].toUpperCase() + side.slice(1), '()F'))); return r; };
  const bounds = node => {
    try {
      if (!call(node, NODE, 'isAttached', '()Z') || !call(node, NODE, 'isPlaced', '()Z')) return null;
      const coords = call(node, NODE, 'getCoordinates', `()${COORDS}`);
      return coords && call(coords, COORDS, 'isAttached', '()Z') ? rect(call(null, COORDS_KT, 'boundsInRoot', `(${COORDS})${RECT}`, [coords], 'static')) : null;
    } catch { return null; }
  };
  for (const { view } of composeOwnerViews(runtime)) {
    let table = null; try { table = rootComposition(runtime, view); } catch (error) { out.note = `slot table unreadable: ${String(error?.message ?? error).slice(0, 160)}`; }
    if (!table) { out.note ??= 'composition of an AndroidComposeView not found'; continue; }
    const { groupsByNode, stats } = walkComposition(runtime, table, { names: false, scopes: true });
    if (stats.limited) out.note = 'limit of slot table groups reached: some elements were not joined';
    for (const groups of groupsByNode.values()) {
      if (groups.emitter === null || (!batch.has(groups.emitter) && !groups.own.some(id => batch.has(id)))) continue;
      let recomposed = 0; for (const id of rowOf(runtime, state, groups).ids) if (batch.get(id) > 0) { recomposed = Math.max(recomposed, batch.get(id)); emitted.add(id); }
      if (out.changed.length >= maxChanged) { out.note = `more than ${maxChanged} elements changed at once: the others are updated by the next capture`; continue; }
      out.changed.push({ ownerViewId: view.ref, semanticsId: call(groups.node, NODE, 'getSemanticsId', '()I'), ...nodeRecomposition(runtime, groups, null), recomposed, bounds: recomposed > 0 ? bounds(groups.node) : null });
    }
  }
  for (const [id, recomposed] of batch) if (recomposed > 0 && !emitted.has(id)) state.unjoined += recomposed;
  out.unjoined = state.unjoined;
  return out;
}
