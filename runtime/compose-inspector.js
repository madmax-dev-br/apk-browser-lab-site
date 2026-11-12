// One-shot inspection of the Compose layout tree on the screen, for the page's "Compose" panel (src/compose-inspector-panel.js). It runs in the Worker (no DOM, no process.*)
// only when the panel asks for it, and reads the original androidx.compose.ui code through its own methods: AndroidComposeView.getRoot, LayoutNode.getChildren$ui_release,
// getCoordinates + LayoutCoordinatesKt.boundsInRoot/positionInRoot, getMeasurePolicy, getModifierInfo, getZIndex, isPlaced, getSemanticsId, and the unmerged semantics tree of
// src/compose-semantics.js (joined by semantics id). Nothing is constructed or kept in the VM: the objects the calls allocate (iterators, Rects) are garbage afterwards.
//
// Element names. Compose has no View classes; a composable's name exists at run time only in the slot table's source information, which the composition records when tooling
// asked for it (Layout Inspector's inspection tables, ComposerImpl.collectParameterInformation). The root composition's slot table is read through its public tooling API
// (CompositionData / CompositionGroup.getSourceInfo / getNode); when it carries "C(Name)" markers the LayoutNode gets that name (source 'composable'). Otherwise the name is
// built from what the node really has: the semantics Role, an editable text, the semantics text, and the measure policy class (source 'semantics' or 'layout'). Never invented.
import { createComposeSemanticsDriver } from './compose-semantics.js?v=e0bbabac13b9';

const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', OWNER_VIEW = 'Landroidx/compose/ui/platform/AndroidComposeView;', NODE = 'Landroidx/compose/ui/node/LayoutNode;';
const COORDS = 'Landroidx/compose/ui/layout/LayoutCoordinates;', COORDS_KT = 'Landroidx/compose/ui/layout/LayoutCoordinatesKt;', RECT = 'Landroidx/compose/ui/geometry/Rect;';
const MODIFIER_INFO = 'Landroidx/compose/ui/layout/ModifierInfo;', DENSITY = 'Landroidx/compose/ui/unit/Density;';
const COMPOSITION_GROUP = 'Landroidx/compose/runtime/tooling/CompositionGroup;', COMPOSITION_DATA = 'Landroidx/compose/runtime/tooling/CompositionData;';
export const MAX_NODES = 2000, MAX_DEPTH = 256, MAX_GROUPS = 60000, MAX_MODIFIERS = 48;
// Compose's own layout primitives: a composable chain ends in one of them before the LayoutNode is emitted; the name shown is the nearest call that is not one of these.
const PRIMITIVES = new Set(['Layout', 'ReusableComposeNode', 'ComposeNode', 'SubcomposeLayout', 'MultiMeasureLayout', 'LayoutNode']);

const params = signature => signature.slice(1, signature.indexOf(')')).match(/\[*L[^;]+;|\[*[ZBCSIFJD]/g) || [];
const floats = new DataView(new ArrayBuffer(4));
const float = bits => { floats.setInt32(0, bits, true); return floats.getFloat32(0, true); };
const round = value => Math.round(value * 100) / 100;
/** 'Landroidx/compose/foundation/layout/RowColumnMeasurePolicy;' -> 'RowColumnMeasurePolicy' (an obfuscated class stays as the APK names it). */
export const simpleName = type => { const name = String(type ?? '').replace(/^L|;$/g, '').replaceAll('/', '.'); return name.slice(name.lastIndexOf('.') + 1) || name; };
/** A modifier element class -> the modifier it is written as: 'PaddingElement' -> 'padding', 'BackgroundElement' -> 'background'; other names are returned unchanged. */
export const modifierLabel = name => { const m = /^([A-Z][A-Za-z0-9]*?)(?:Node)?Element$/.exec(name); return m ? m[1][0].toLowerCase() + m[1].slice(1) : name; };
/** "C(Button)P(...)…", "CC(Column)…" -> 'Button' / 'Column'; null for lambdas ("C") and groups without a name. */
export function composableName(sourceInfo) {
  const m = /^C{1,2}\(([^)]+)\)/.exec(String(sourceInfo ?? '')); return m ? m[1] : null;
}

/** The best honest name for one element: { name, source, kind }. `semantics` is the unmerged semantics node of the LayoutNode (or null); `innerText` is the first text of its
 * subtree, used for a node with a role or a click action that has no text of its own (a Button's label is a child Text, as the merged semantics tree reports it). */
export function elementName({ calls = [], semantics = null, measurePolicy = null, modifiers = [], innerText = null } = {}) {
  const quote = text => `"${text.length > 40 ? text.slice(0, 39) + '…' : text}"`;
  const own = ownText(semantics), actions = (semantics?.actions ?? []).map(action => action.name ?? action);
  const interactive = !!semantics?.role || actions.includes('OnClick');
  const label = own ?? (interactive ? innerText : null), tag = semantics?.testTag ? `#${semantics.testTag}` : '';
  const suffix = [label ? quote(label) : '', tag].filter(Boolean).join(' '), named = calls.filter(call => !PRIMITIVES.has(call)), join = kind => suffix ? `${kind} ${suffix}` : kind;
  if (named.length) return { name: join(named.at(-1)), source: 'composable', kind: named.at(-1) };
  if (semantics?.role) return { name: join(semantics.role), source: 'semantics', kind: semantics.role };
  if (actions.includes('SetText')) return { name: join('Campo de texto'), source: 'semantics', kind: 'Campo de texto' };
  if (semantics?.texts?.length) return { name: join('Texto'), source: 'semantics', kind: 'Texto' };
  if (interactive) return { name: join('Clicável'), source: 'semantics', kind: 'Clicável' };
  const policy = measurePolicy ? simpleName(measurePolicy) : null, mods = modifiers.slice(0, 3).map(modifier => modifier.label).join(', ');
  return { name: join(['Layout', policy, mods].filter(Boolean).join(' · ')), source: 'layout', kind: 'Layout' };
}
const ownText = semantics => semantics ? (semantics.editableText || semantics.texts?.find(Boolean) || semantics.contentDescriptions?.find(Boolean) || null) : null;

/**
 * @returns {{ schemaVersion, source, density, owners: [{ ownerViewId, window, width, height, locationInWindow, names: { source, groups, named, note }, truncated, nodes: [...] }], totalNodes, truncated, notes }}
 * Node: { id, semanticsId, parentId, depth, index, childCount, name, nameSource, calls, bounds (unclipped, px in the owner), visibleBounds (clipped by the ancestors, px in the owner),
 *         boundsInWindow, placed, attached, zIndex, measurePolicy, modifiers: [{ className, label }], semantics }
 */
export function inspectCompose(runtime, { maxNodes = MAX_NODES, maxDepth = MAX_DEPTH, maxGroups = MAX_GROUPS, childReads = null } = {}) {   // childReads: the names tried for a LayoutNode's children (tests pass none to exercise the discovery below)
  const call = (receiver, owner, name, signature, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, signature, parameters: params(signature), result: signature.slice(signature.indexOf(')') + 1) }, mode === 'static' ? values : [receiver, ...values], mode);
  const string = value => value == null ? null : runtime.javaString(value, 'Ljava/lang/String;');
  const typeOf = ref => ref ? runtime.object(ref).type : null;
  const list = (value, limit) => {
    if (!value) return []; const count = call(value, 'Ljava/util/List;', 'size', '()I');
    if (!Number.isInteger(count) || count < 0) return [];
    return Array.from({ length: Math.min(count, limit) }, (_, index) => call(value, 'Ljava/util/List;', 'get', '(I)Ljava/lang/Object;', [index]));
  };
  const rect = value => { const out = {}; for (const side of ['left', 'top', 'right', 'bottom']) out[side] = round(float(call(value, RECT, 'get' + side[0].toUpperCase() + side.slice(1), '()F'))); return out; };
  const offset = packed => { const big = BigInt.asIntN(64, BigInt(packed)); return { x: float(Number(BigInt.asIntN(32, big >> 32n))), y: float(Number(BigInt.asIntN(32, big))) }; };
  const notes = [];

  // AndroidComposeViews of the reachable windows (the topmost modal window and the ones above it, as src/compose-semantics.js), bottom to top.
  const all = runtime.platform?.viewRoots?.(runtime) ?? (runtime.root ? [{ root: runtime.root, window: null }] : []);
  let floor = 0; all.forEach((value, index) => { if (value.window && value.window.visible !== false && value.window.modal) floor = index; });
  const ownerViews = [];
  for (const entry of all.slice(floor)) {
    const seen = new Set();
    const visit = (ref, depth) => {
      if (!ref || depth > 64 || seen.size >= 4096 || seen.has(ref.ref)) return; seen.add(ref.ref);
      const type = typeOf(ref);
      if (runtime.isSubtype(type, OWNER_VIEW)) ownerViews.push({ view: ref, window: entry.window });
      if (runtime.isSubtype(type, GROUP)) { const count = call(ref, GROUP, 'getChildCount', '()I'); for (let i = 0; i < Math.min(count, 4096); i++) visit(call(ref, GROUP, 'getChildAt', '(I)Landroid/view/View;', [i]), depth + 1); }
    };
    visit(entry.root, 0);
  }

  // Semantics (text, role, testTag, actions...) from the unmerged tree, read by a driver of its own so the page driver's node references and mode stay as they are.
  const semanticsById = new Map(), semanticsByOwner = new Map();
  // Reads that a minified build may have renamed (the LayoutNode members are internal API of Compose): each one fails alone, noted once, instead of ending the inspection.
  const failedReads = new Map();
  const optional = (label, fn, fallback = null) => { try { return fn(); } catch (error) { if (!failedReads.has(label)) failedReads.set(label, String(error?.message ?? error).slice(0, 120)); return fallback; } };
  const CHILD_READS = childReads ?? ['getChildren$ui_release', 'getFoldedChildren$ui_release', 'get_children$ui_release'];
  let childRead = null, childReadsMissing = false;
  // A build whose LayoutNode has none of those names (minified, or another Compose version): the children are found by shape -- a method of LayoutNode without parameters that
  // returns a List whose elements are LayoutNodes; among several (children, folded children, z-sorted children) the one that answers the most nodes. A node without children
  // decides nothing, so the choice is made at the first node that has some.
  const discoverChildren = ref => {
    const cls = runtime.classes?.get?.(NODE); if (!cls?.methods) return null;
    let best = null, callable = 0;
    for (const nameSig of cls.methods.keys()) {
      if (!nameSig.endsWith('()Ljava/util/List;')) continue; const name = nameSig.slice(0, nameSig.indexOf('('));
      let items; try { items = list(call(ref, NODE, name, '()Ljava/util/List;'), 4096); } catch { continue; }
      callable++;
      if (items.length > 0 && items.every(item => item && runtime.isSubtype(typeOf(item), NODE)) && (best === null || items.length > best.items.length)) best = { name, items };
    }
    return { best, callable };
  };
  const childrenOf = ref => {
    if (childRead) return list(call(ref, NODE, childRead, '()Ljava/util/List;'), 4096);
    let last = null;
    if (!childReadsMissing) for (const name of CHILD_READS) { try { const value = list(call(ref, NODE, name, '()Ljava/util/List;'), 4096); childRead = name; return value; } catch (error) { last = error; } }
    childReadsMissing = true;
    const discovery = discoverChildren(ref), found = discovery?.best ?? null; if (found) { childRead = found.name; if (!failedReads.has('filhos')) failedReads.set('filhos', `nomes conhecidos ausentes; filhos lidos por ${found.name}()`); return found.items; }
    if (discovery && discovery.callable > 0) return [];   // methods answered, none with LayoutNodes: a node without children
    throw last ?? new Error('LayoutNode children unavailable');
  };
  if (ownerViews.length) {
    const driver = createComposeSemanticsDriver(runtime);
    try {
      const tree = driver.snapshot({ roots: all.slice(floor).map(value => value.root), merged: false, maxNodes: 4096 });
      for (const owner of tree.owners) { semanticsByOwner.set(owner.ownerViewId, owner.nodes); for (const node of owner.nodes) semanticsById.set(`${owner.ownerViewId}:${node.nodeId}`, node); }
    } catch (error) { notes.push(`semântica indisponível: ${String(error?.message ?? error).slice(0, 160)}`); }
    finally { runtime.gcExtraRoots?.delete(driver); }
  }

  let density = null, totalNodes = 0, truncated = false; const owners = [];
  for (const { view, window } of ownerViews) {
    const ownerWindow = window ? { id: window.id ?? null, kind: window.kind ?? 'activity', modal: !!window.modal } : { id: null, kind: 'activity', modal: true };
    const counted = totalNodes;
    try { inspectOwner(view, window, ownerWindow); }
    catch (error) {
      totalNodes = counted;   // the LayoutNode walk is not readable in this build: the public semantics tree of the same owner (what the layout bounds use) still describes the screen
      const fallback = semanticsOwnerTree(view, ownerWindow);
      notes.push(`árvore de LayoutNode ilegível (${String(error?.message ?? error).slice(0, 140)}): ${fallback ? `mostrando a árvore de semântica do Compose (${fallback.nodes.length} nós, sem modificadores nem política de medida)` : 'sem árvore de semântica também'}`);
      if (fallback) { owners.push(fallback); totalNodes += fallback.nodes.length; }
    }
  }
  function semanticsOwnerTree(view, ownerWindow) {
    const list = semanticsByOwner.get(view.ref); if (!list?.length) return null;
    let locationInWindow = null; try { const location = runtime.newArray('[I', 2); call(view, VIEW, 'getLocationInWindow', '([I)V', [location]); const at = runtime.array(location).elements; locationInWindow = { x: at[0], y: at[1] }; } catch { locationInWindow = null; }
    const depthOf = new Map(), childCount = new Map(), nodes = [];
    for (const item of list.slice(0, maxNodes)) {
      const id = `${view.ref}:${item.nodeId}`, parentId = item.parentId === null || item.parentId === undefined ? null : `${view.ref}:${item.parentId}`, depth = parentId === null ? 0 : (depthOf.get(parentId) ?? 0) + 1;
      depthOf.set(id, depth); if (parentId !== null) childCount.set(parentId, (childCount.get(parentId) ?? 0) + 1);
      const raw = item.boundsInRoot ?? item.bounds ?? null, b = raw ? { left: round(raw.left), top: round(raw.top), right: round(raw.right), bottom: round(raw.bottom) } : null;
      nodes.push({ id, semanticsId: item.nodeId, parentId, depth, index: 0, childCount: 0, name: null, nameSource: null, calls: [], bounds: b, visibleBounds: b,
        boundsInWindow: b && locationInWindow ? { left: round(b.left + locationInWindow.x), top: round(b.top + locationInWindow.y), right: round(b.right + locationInWindow.x), bottom: round(b.bottom + locationInWindow.y) } : null,
        width: b ? round(b.right - b.left) : 0, height: b ? round(b.bottom - b.top) : 0, attached: true, placed: item.placed !== false, zIndex: 0, measurePolicy: null, modifiers: [],
        semantics: { texts: item.texts, editableText: item.editableText, contentDescriptions: item.contentDescriptions, testTag: item.testTag, role: item.role, actions: (item.actions ?? []).map(action => action.name), focused: item.focused,
          enabled: !item.disabled, selected: item.selected, toggleState: item.toggleState, textSelection: item.textSelection, invisibleToUser: item.invisibleToUser, properties: item.propertyNames } });
    }
    const innerText = new Map();
    for (let i = nodes.length - 1; i >= 0; i--) { const node = nodes[i], text = ownText(semanticsById.get(node.id)) ?? innerText.get(node.id) ?? null; innerText.set(node.id, text); if (text && node.parentId !== null) innerText.set(node.parentId, text); node.childCount = childCount.get(node.id) ?? 0; }
    for (const node of nodes) { const { name, source } = elementName({ semantics: semanticsById.get(node.id), innerText: innerText.get(node.id) }); node.name = name; node.nameSource = source; }
    if (list.length > maxNodes) truncated = true;
    return { ownerViewId: view.ref, window: ownerWindow, width: optional('View.getWidth', () => call(view, VIEW, 'getWidth', '()I'), 0), height: optional('View.getHeight', () => call(view, VIEW, 'getHeight', '()I'), 0), attached: true, locationInWindow,
      names: { source: 'semantics', groups: 0, named: 0, note: 'árvore de semântica: só os nós com semântica (texto, papel, ação, testTag) e seus contêineres' }, source: 'semantics', nodes };
  }
  function inspectOwner(view, window, ownerWindow) {
    const root = call(view, OWNER_VIEW, 'getRoot', `()${NODE}`); if (!root) return;
    if (density === null) { try { density = round(float(call(call(root, NODE, 'getDensity', `()${DENSITY}`), DENSITY, 'getDensity', '()F'))); } catch { density = null; } }
    let locationInWindow = null;
    try { const location = runtime.newArray('[I', 2); call(view, VIEW, 'getLocationInWindow', '([I)V', [location]); const at = runtime.array(location).elements; locationInWindow = { x: at[0], y: at[1] }; } catch { locationInWindow = null; }

    // Composable names from the root composition's slot table, when it holds source information (a LayoutNode -> the composable calls that emitted it, outermost first).
    const callsByNode = new Map(), names = { source: 'none', groups: 0, named: 0, note: null };
    try {
      const tagId = runtime.resources?.table?.findId?.('id/wrapped_composition_tag');
      const wrapped = tagId ? call(view, VIEW, 'getTag', '(I)Ljava/lang/Object;', [tagId]) : null;
      const original = wrapped && runtime.isSubtype(typeOf(wrapped), 'Landroidx/compose/ui/platform/WrappedComposition;') ? call(wrapped, 'Landroidx/compose/ui/platform/WrappedComposition;', 'getOriginal', '()Landroidx/compose/runtime/Composition;') : null;
      const table = original && runtime.isSubtype(typeOf(original), 'Landroidx/compose/runtime/CompositionImpl;') ? call(original, 'Landroidx/compose/runtime/CompositionImpl;', 'getSlotTable$runtime_release', '()Landroidx/compose/runtime/SlotTable;') : null;
      if (table) {
        const walk = (iterable, chain, depth) => {
          if (depth > 512) return;
          const iterator = call(iterable, 'Ljava/lang/Iterable;', 'iterator', '()Ljava/util/Iterator;');
          while (names.groups < maxGroups && call(iterator, 'Ljava/util/Iterator;', 'hasNext', '()Z')) {
            const group = call(iterator, 'Ljava/util/Iterator;', 'next', '()Ljava/lang/Object;'); names.groups++;
            const name = composableName(string(call(group, COMPOSITION_GROUP, 'getSourceInfo', '()Ljava/lang/String;')));
            if (name) names.named++;
            let next = name ? [...chain, name] : chain;
            const node = call(group, COMPOSITION_GROUP, 'getNode', '()Ljava/lang/Object;');
            if (node && runtime.isSubtype(typeOf(node), NODE)) { callsByNode.set(node.ref, next); next = []; }   // calls after a node belong to its children
            walk(call(group, COMPOSITION_DATA, 'getCompositionGroups', '()Ljava/lang/Iterable;'), next, depth + 1);
          }
        };
        walk(table, [], 0);
        names.source = names.named ? 'slot-table' : 'none';
        if (names.groups >= maxGroups) names.note = `limite de ${maxGroups} grupos do slot table atingido`;
        else if (!names.named) names.note = 'a composição não registrou informação de fonte (o Compose só a grava com ferramentas de inspeção ativas): nomes derivados da semântica e do layout';
      } else names.note = 'composição do AndroidComposeView não encontrada';
    } catch (error) { names.note = `slot table ilegível: ${String(error?.message ?? error).slice(0, 160)}`; callsByNode.clear(); }

    const nodes = [], raw = new Map();
    const visit = (ref, parentId, depth, index) => {
      if (totalNodes >= maxNodes) { truncated = true; return; }
      if (depth > maxDepth) { truncated = true; return; }
      const semanticsId = optional('LayoutNode.getSemanticsId', () => call(ref, NODE, 'getSemanticsId', '()I'), null), id = semanticsId === null ? `${view.ref}:n${totalNodes}` : `${view.ref}:${semanticsId}`;
      const attached = optional('LayoutNode.isAttached', () => !!call(ref, NODE, 'isAttached', '()Z'), true), placed = attached && optional('LayoutNode.isPlaced', () => !!call(ref, NODE, 'isPlaced', '()Z'), true);
      const width = optional('LayoutNode.getWidth', () => call(ref, NODE, 'getWidth', '()I'), 0), height = optional('LayoutNode.getHeight', () => call(ref, NODE, 'getHeight', '()I'), 0);
      let bounds = null, visibleBounds = null;
      if (attached) optional('LayoutNode.getCoordinates', () => {
        const coords = call(ref, NODE, 'getCoordinates', `()${COORDS}`);
        if (coords && call(coords, COORDS, 'isAttached', '()Z')) {
          const at = offset(call(null, COORDS_KT, 'positionInRoot', `(${COORDS})J`, [coords], 'static'));
          bounds = { left: round(at.x), top: round(at.y), right: round(at.x + width), bottom: round(at.y + height) };
          visibleBounds = rect(call(null, COORDS_KT, 'boundsInRoot', `(${COORDS})${RECT}`, [coords], 'static'));
        }
      });
      const policy = optional('LayoutNode.getMeasurePolicy', () => call(ref, NODE, 'getMeasurePolicy', '()Landroidx/compose/ui/layout/MeasurePolicy;'));
      const modifiers = optional('LayoutNode.getModifierInfo', () => list(call(ref, NODE, 'getModifierInfo', '()Ljava/util/List;'), MAX_MODIFIERS), []).map(info => {
        const element = optional('ModifierInfo.getModifier', () => call(info, MODIFIER_INFO, 'getModifier', '()Landroidx/compose/ui/Modifier;')), className = typeOf(element)?.replace(/^L|;$/g, '').replaceAll('/', '.') ?? null;
        return { className, label: modifierLabel(simpleName(typeOf(element))) };
      });
      const semantics = semanticsById.get(id) ?? null, calls = callsByNode.get(ref.ref) ?? [];
      const measurePolicy = policy ? typeOf(policy).replace(/^L|;$/g, '').replaceAll('/', '.') : null;
      const children = childrenOf(ref);
      const node = { id, ref: ref.ref, semanticsId, parentId, depth, index, childCount: children.length, name: null, nameSource: null, calls, bounds, visibleBounds,
        boundsInWindow: visibleBounds && locationInWindow ? { left: round(visibleBounds.left + locationInWindow.x), top: round(visibleBounds.top + locationInWindow.y), right: round(visibleBounds.right + locationInWindow.x), bottom: round(visibleBounds.bottom + locationInWindow.y) } : null,
        width, height, attached, placed, zIndex: optional('LayoutNode.getZIndex', () => round(float(call(ref, NODE, 'getZIndex', '()F'))), 0), measurePolicy, modifiers,
        semantics: semantics ? { texts: semantics.texts, editableText: semantics.editableText, contentDescriptions: semantics.contentDescriptions, testTag: semantics.testTag, role: semantics.role,
          actions: semantics.actions.map(action => action.name), focused: semantics.focused, enabled: !semantics.disabled, selected: semantics.selected, toggleState: semantics.toggleState,
          textSelection: semantics.textSelection, invisibleToUser: semantics.invisibleToUser, properties: semantics.propertyNames } : null };
      nodes.push(node); raw.set(id, semantics); totalNodes++;
      children.forEach((child, i) => visit(child, id, depth + 1, i));
    };
    visit(root, null, 0, 0);
    // Names, once the subtree texts are known: nodes are in pre-order, so walking backwards sees every child before its parent; a parent keeps its first child's text.
    const innerText = new Map();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i], text = ownText(raw.get(node.id)) ?? innerText.get(node.id) ?? null; innerText.set(node.id, text);
      if (text && node.parentId !== null) innerText.set(node.parentId, text);
    }
    for (const node of nodes) { const { name, source } = elementName({ calls: node.calls, semantics: raw.get(node.id), measurePolicy: node.measurePolicy, modifiers: node.modifiers, innerText: innerText.get(node.id) }); node.name = name; node.nameSource = source; }
    owners.push({ ownerViewId: view.ref, window: ownerWindow,
      width: call(view, VIEW, 'getWidth', '()I'), height: call(view, VIEW, 'getHeight', '()I'), attached: !!call(view, VIEW, 'isAttachedToWindow', '()Z'), locationInWindow, names, source: 'layout-nodes', nodes });
  }
  if (failedReads.size) notes.push(`leituras indisponíveis neste build (o minificador pode ter renomeado membros internos do Compose): ${[...failedReads.keys()].join(', ')}`);
  if (truncated) notes.push(`limite de ${maxNodes} elementos (ou profundidade ${maxDepth}) atingido: a lista está incompleta`);
  return { schemaVersion: 1, source: 'original-Compose-DEX/LayoutNode', density, owners, totalNodes, truncated, notes };
}
