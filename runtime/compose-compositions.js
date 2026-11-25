// The compositions on the screen, read through Compose's own public tooling API (CompositionData / CompositionGroup: getSourceInfo, getNode, getData), for the Layout panel
// (src/compose-inspector.js: names and recomposition counts) and the recomposition counter (src/compose-recompositions.js). Read-only, only when asked for; no DOM, no process.*.
// Two things live in the slot table next to the LayoutNodes: the source information of each composable call (only when the composition recorded it) and, as the first slot of each
// restart group, its RecomposeScopeImpl. A subcomposition (SubcomposeLayout, lazy lists, Scaffold) has a table of its own: the parent's table holds its CompositionContextHolder,
// whose composers give their compositionData.
const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', OWNER_VIEW = 'Landroidx/compose/ui/platform/AndroidComposeView;', NODE = 'Landroidx/compose/ui/node/LayoutNode;';
const COMPOSITION_GROUP = 'Landroidx/compose/runtime/tooling/CompositionGroup;', COMPOSITION_DATA = 'Landroidx/compose/runtime/tooling/CompositionData;', COMPOSITION_IMPL = 'Landroidx/compose/runtime/CompositionImpl;';
const WRAPPED = 'Landroidx/compose/ui/platform/WrappedComposition;', COMPOSER = 'Landroidx/compose/runtime/Composer;';
export const RECOMPOSE_SCOPE = 'Landroidx/compose/runtime/RecomposeScopeImpl;';
const HOLDER = /\$CompositionContextHolder;$/, OBSERVER_HOLDER = /\/RememberObserverHolder;$/;
const DATA_SLOTS = 4;   // a restart group's scope is its first slot; a composition context's holder follows the group's object key (and an aux slot): nothing looked for comes later
const params = signature => signature.slice(1, signature.indexOf(')')).match(/\[*L[^;]+;|\[*[ZBCSIFJD]/g) || [];
/** A call on the VM's own dispatch: (receiver, owner, name, signature, values, mode). */
export const vmCaller = runtime => (receiver, owner, name, signature, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, signature, parameters: params(signature), result: signature.slice(signature.indexOf(')') + 1) }, mode === 'static' ? values : [receiver, ...values], mode);
/** "C(Button)P(...)…", "CC(Column)…" -> 'Button' / 'Column'; null for lambdas ("C") and groups without a name. */
export function composableName(sourceInfo) {
  const m = /^C{1,2}\(([^)]+)\)/.exec(String(sourceInfo ?? '')); return m ? m[1] : null;
}

/** The roots of the reachable windows: the topmost modal window and the ones above it (as src/compose-semantics.js), bottom to top: [{ root, window }]. */
export function reachableRoots(runtime) {
  const all = runtime.platform?.viewRoots?.(runtime) ?? (runtime.root ? [{ root: runtime.root, window: null }] : []);
  let floor = 0; all.forEach((value, index) => { if (value.window && value.window.visible !== false && value.window.modal) floor = index; });
  return all.slice(floor);
}
/** The AndroidComposeViews under `roots`: [{ view, window }]. */
export function composeOwnerViews(runtime, roots = reachableRoots(runtime)) {
  const call = vmCaller(runtime), ownerViews = [];
  for (const entry of roots) {
    const seen = new Set();
    const visit = (ref, depth) => {
      if (!ref || depth > 64 || seen.size >= 4096 || seen.has(ref.ref)) return; seen.add(ref.ref);
      const type = runtime.object(ref).type;
      if (runtime.isSubtype(type, OWNER_VIEW)) ownerViews.push({ view: ref, window: entry.window });
      if (runtime.isSubtype(type, GROUP)) { const count = call(ref, GROUP, 'getChildCount', '()I'); for (let i = 0; i < Math.min(count, 4096); i++) visit(call(ref, GROUP, 'getChildAt', '(I)Landroid/view/View;', [i]), depth + 1); }
    };
    visit(entry.root, 0);
  }
  return ownerViews;
}
/** The root composition's slot table of an AndroidComposeView (a CompositionData), or null. */
export function rootComposition(runtime, view) {
  const call = vmCaller(runtime), typeOf = ref => ref ? runtime.object(ref).type : null, tagId = runtime.resources?.table?.findId?.('id/wrapped_composition_tag');
  const wrapped = tagId ? call(view, VIEW, 'getTag', '(I)Ljava/lang/Object;', [tagId]) : null;
  const original = wrapped && runtime.isSubtype(typeOf(wrapped), WRAPPED) ? call(wrapped, WRAPPED, 'getOriginal', '()Landroidx/compose/runtime/Composition;') : null;
  return original && runtime.isSubtype(typeOf(original), COMPOSITION_IMPL) ? call(original, COMPOSITION_IMPL, 'getSlotTable$runtime_release', '()Landroidx/compose/runtime/SlotTable;') : null;
}

/**
 * Walks a composition's groups. Fills, per LayoutNode (by ref): callsByNode (with `names`: the composable calls that emitted it, outermost first, since the node above it) and, with
 * `scopes`, groupsByNode: { node, emitter: the ref of the RecomposeScopeImpl of the nearest restart group around the node (the code that emits it), null when there is none in its
 * composition; own: the scopes between the node above it and it, outermost first }. With `scopes` the subcompositions are walked too, and `stats.subcompositions` counts them.
 */
export function walkComposition(runtime, table, { names = true, scopes = false, maxGroups = 60000, callsByNode = new Map(), groupsByNode = new Map() } = {}) {
  const call = vmCaller(runtime), typeOf = ref => ref && ref.ref !== undefined ? runtime.object(ref).type : null, stats = { groups: 0, named: 0, subcompositions: 0, scopes: 0, limited: false }, seen = new Set();
  const kinds = new Map();   // slot type -> what it is: one class test per class
  const slotKind = type => {
    if (type === null) return null;
    let kind = kinds.get(type);
    if (kind === undefined) kinds.set(type, kind = runtime.isSubtype(type, RECOMPOSE_SCOPE) ? 'scope' : HOLDER.test(type) ? 'context' : OBSERVER_HOLDER.test(type) ? 'observer' : null);
    return kind;
  };
  const groupsOf = data => call(data, COMPOSITION_DATA, 'getCompositionGroups', '()Ljava/lang/Iterable;');
  const slotsOf = group => {
    const out = [], iterator = call(call(group, COMPOSITION_GROUP, 'getData', '()Ljava/lang/Iterable;'), 'Ljava/lang/Iterable;', 'iterator', '()Ljava/util/Iterator;');
    for (let i = 0; i < DATA_SLOTS && call(iterator, 'Ljava/util/Iterator;', 'hasNext', '()Z'); i++) {
      let value = call(iterator, 'Ljava/util/Iterator;', 'next', '()Ljava/lang/Object;'), kind = slotKind(typeOf(value));
      if (kind === 'observer') { value = call(value, typeOf(value), 'getWrapped', '()Landroidx/compose/runtime/RememberObserver;'); kind = slotKind(typeOf(value)); }
      if (kind === 'scope' || kind === 'context') out.push({ kind, value });
      if (kind === 'scope') break;   // the first slot of a restart group: its other slots are the app's remembered values
    }
    return out;
  };
  const subcompositions = holder => {
    const type = typeOf(holder), impl = type.replace('$CompositionContextHolder;', '$CompositionContextImpl;');
    const context = call(holder, type, 'getRef', `()${impl}`), composers = context ? call(context, impl, 'getComposers', '()Ljava/util/Set;') : null; if (!composers) return [];
    const out = [], iterator = call(composers, 'Ljava/util/Set;', 'iterator', '()Ljava/util/Iterator;');
    while (out.length < 4096 && call(iterator, 'Ljava/util/Iterator;', 'hasNext', '()Z')) out.push(call(call(iterator, 'Ljava/util/Iterator;', 'next', '()Ljava/lang/Object;'), COMPOSER, 'getCompositionData', `()${COMPOSITION_DATA}`));
    return out;
  };
  const walk = (iterable, chain, emitter, own, depth) => {
    if (depth > 512) return;
    const iterator = call(iterable, 'Ljava/lang/Iterable;', 'iterator', '()Ljava/util/Iterator;');
    while (stats.groups < maxGroups && call(iterator, 'Ljava/util/Iterator;', 'hasNext', '()Z')) {
      const group = call(iterator, 'Ljava/util/Iterator;', 'next', '()Ljava/lang/Object;'); stats.groups++;
      let next = chain, scope = emitter, mine = own; const contexts = [];
      if (names) {
        const info = call(group, COMPOSITION_GROUP, 'getSourceInfo', '()Ljava/lang/String;'), name = info == null ? null : composableName(runtime.javaString(info, 'Ljava/lang/String;'));
        if (name) { stats.named++; next = [...chain, name]; }
      }
      if (scopes) for (const { kind, value } of slotsOf(group)) { if (kind === 'scope') { stats.scopes++; scope = value.ref; mine = [...own, scope]; } else contexts.push(value); }
      const node = call(group, COMPOSITION_GROUP, 'getNode', '()Ljava/lang/Object;');
      if (node && runtime.isSubtype(typeOf(node), NODE)) { callsByNode.set(node.ref, next); next = []; if (scopes) { groupsByNode.set(node.ref, { node, emitter: scope, own: mine }); mine = []; } }   // calls and restart groups after a node belong to its children
      walk(groupsOf(group), next, scope, mine, depth + 1);
      for (const context of contexts) for (const data of subcompositions(context)) if (data && !seen.has(data.ref)) { seen.add(data.ref); stats.subcompositions++; walk(groupsOf(data), [], null, [], depth + 1); }
    }
  };
  seen.add(table.ref); walk(groupsOf(table), [], null, [], 0);
  if (stats.groups >= maxGroups) stats.limited = true;
  return { callsByNode, groupsByNode, stats };
}
