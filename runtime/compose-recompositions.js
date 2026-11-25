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
// Not available (said, never guessed): the app has no RecomposeScopeImpl under that name (no Compose, or a minifier renamed it), the class lacks start/scopeSkipped (a minifier
// inlined them), or a method change the user made already replaces one of them.
import { RUN_BODY, setMethodInterceptor } from './method-overrides.js?v=8411deb8def1';
import { RECOMPOSE_SCOPE, composeOwnerViews, rootComposition, vmCaller, walkComposition } from './compose-compositions.js?v=8411deb8def1';

const NODE = 'Landroidx/compose/ui/node/LayoutNode;', COORDS = 'Landroidx/compose/ui/layout/LayoutCoordinates;', COORDS_KT = 'Landroidx/compose/ui/layout/LayoutCoordinatesKt;', RECT = 'Landroidx/compose/ui/geometry/Rect;';
const START = 'start(I)V', SKIPPED = 'scopeSkipped()V';
export const MAX_CHANGED = 400;   // elements of one update; the rest are counted in the total and in the next capture
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

/** { counting, available, reason, total, skips, unjoined, groups }: total and skips since counting started or was reset, over every composition of the app; unjoined: those of the total
 * that belong to a composable with no element of its own on the screen (as of the last update); groups: the restart groups seen. */
export function recompositionStatus(runtime) {
  const state = states.get(runtime);
  if (!state) return { counting: false, available: null, reason: null, total: null, skips: null, unjoined: null, groups: 0 };
  if (!state.on) return { counting: false, available: false, reason: state.reason, total: null, skips: null, unjoined: null, groups: 0 };
  return { counting: true, available: true, reason: null, total: state.total, skips: state.skips, unjoined: state.unjoined, groups: state.counts.size };
}

/** Starts counting (again harmless while on). `onChange` is called when the first change of a batch arrives (the Worker schedules its update then). Returns the status. */
export function startRecompositionCounting(runtime, { onChange = null } = {}) {
  const known = states.get(runtime); if (known?.on) { known.onChange = onChange; return recompositionStatus(runtime); }
  const reason = unavailable(runtime);
  if (reason !== null) { if (known?.reason !== reason) runtime.record(`COMPOSE recomposition counting not available: ${reason}`); states.set(runtime, { on: false, reason }); return recompositionStatus(runtime); }
  const state = { on: true, reason: null, onChange, counts: new Map(), fresh: new Set(), batch: new Map(), total: 0, skips: 0, keys: [], unjoined: 0 };
  const entryOf = id => { let entry = state.counts.get(id); if (entry === undefined) state.counts.set(id, entry = { recompositions: 0, skips: 0, initial: false }); return entry; };
  const touch = (id, recomposed) => { const first = state.batch.size === 0; state.batch.set(id, (state.batch.get(id) ?? 0) + recomposed); if (first) state.onChange?.(); };
  const observe = (nameSig, fn) => { const key = `${RECOMPOSE_SCOPE}->${nameSig}`; state.keys.push(key); setMethodInterceptor(runtime, key, (rt, definition, args) => { const id = args[0]?.ref; if (id !== undefined) fn(id); return RUN_BODY; }); };
  for (const nameSig of runtime.classes.get(RECOMPOSE_SCOPE).methods.keys()) if (nameSig.startsWith('<init>(')) observe(nameSig, id => { state.fresh.add(id); });
  observe(START, id => {
    const entry = entryOf(id); entry.initial = state.fresh.delete(id); if (entry.initial) return;
    entry.recompositions++; state.total++; touch(id, 1);
  });
  observe(SKIPPED, id => {
    const entry = state.counts.get(id); if (entry === undefined) return;
    if (entry.initial) { state.fresh.add(id); return; }   // paused before its first composition
    entry.recompositions--; entry.skips++; state.total--; state.skips++; touch(id, -1);
  });
  states.set(runtime, state);
  runtime.record('COMPOSE recomposition counting on (Layout panel): RecomposeScopeImpl.start and scopeSkipped are observed; their own code runs');
  return recompositionStatus(runtime);
}

/** Stops counting: the methods run as if never observed, and the counts are dropped. */
export function stopRecompositionCounting(runtime) {
  const state = states.get(runtime); states.delete(runtime);
  if (!state?.on) return recompositionStatus(runtime);
  for (const key of state.keys) setMethodInterceptor(runtime, key, null);
  state.on = false; state.onChange = null;
  runtime.record(`COMPOSE recomposition counting off: ${state.total} recompositions and ${state.skips} skips in ${state.counts.size} restart groups`);
  return recompositionStatus(runtime);
}

/** The counters go back to 0; counting goes on. */
export function resetRecompositionCounts(runtime) {
  const state = states.get(runtime);
  if (state?.on) {
    for (const entry of state.counts.values()) { entry.recompositions = 0; entry.skips = 0; }
    state.total = 0; state.skips = 0; state.unjoined = 0; state.batch.clear(); runtime.record('COMPOSE recomposition counts reset');
  }
  return recompositionStatus(runtime);
}

/** A restart group's counts: one that was not composed since counting started has 0. */
const countsOf = (state, id) => { const entry = state.counts.get(id); return { recompositions: entry?.recompositions ?? 0, skips: entry?.skips ?? 0 }; };
/**
 * The counts of one LayoutNode from its slot-table groups (walkComposition). Recompositions: those of the nearest restart group around it, the composable that emits it. Skips: those of
 * the restart groups between its parent node and it (once one is skipped the ones inside are not reached). `shared`: there is none between, so the counts are those of a group above the
 * parent node (an inline layout such as Column has no restart group of its own). `groups`: the groups between, outermost first.
 */
export function nodeRecomposition(runtime, groups, note) {
  const state = states.get(runtime);
  if (!state?.on || groups === null || groups.emitter === null) return { available: false, reason: note ?? 'no restart group of the slot table emits this node' };
  const own = groups.own.map(id => countsOf(state, id)), { recompositions, skips } = countsOf(state, groups.emitter);
  return { available: true, recompositions, skips: own.length ? own.reduce((sum, group) => sum + group.skips, 0) : skips, shared: own.length === 0, groups: own };
}

/**
 * The status and what changed since the last update, joined to the elements on the screen: { ...status, changed: [{ ownerViewId, semanticsId, recompositions, skips, shared, groups,
 * recomposed (in this update), bounds (visible, px in the owner, when it recomposed) }], changedGroups, note }. A changed group whose composable emits no element of its own on the
 * screen (only other composables, effects, or a composition below a modal window) is in the total and in `unjoined`, with no box to show.
 */
export function recompositionUpdate(runtime, { maxChanged = MAX_CHANGED } = {}) {
  const state = states.get(runtime); if (!state?.on) return null;
  const batch = state.batch; state.batch = new Map();
  for (const id of state.counts.keys()) if (!runtime.heap.has(id)) state.counts.delete(id);   // scopes the collector freed
  for (const id of state.fresh) if (!runtime.heap.has(id)) state.fresh.delete(id);
  const out = { ...recompositionStatus(runtime), changed: [], changedGroups: batch.size, note: null };
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
      const own = groups.own.some(id => batch.has(id)), emitter = groups.emitter !== null && batch.has(groups.emitter);
      if (emitter && batch.get(groups.emitter) > 0) emitted.add(groups.emitter);
      if (!own && !emitter) continue;
      if (out.changed.length >= maxChanged) { out.note = `more than ${maxChanged} elements changed at once: the others are updated by the next capture`; continue; }
      const recomposed = emitter ? Math.max(0, batch.get(groups.emitter)) : 0;
      out.changed.push({ ownerViewId: view.ref, semanticsId: call(groups.node, NODE, 'getSemanticsId', '()I'), ...nodeRecomposition(runtime, groups, null), recomposed, bounds: recomposed > 0 ? bounds(groups.node) : null });
    }
  }
  for (const [id, recomposed] of batch) if (recomposed > 0 && !emitted.has(id)) state.unjoined += recomposed;
  out.unjoined = state.unjoined;
  return out;
}
