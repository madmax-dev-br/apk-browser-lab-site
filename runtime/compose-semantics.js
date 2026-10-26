import { APKError } from './apk-runtime.js?v=38ea11051357';
const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', OWNER_VIEW = 'Landroidx/compose/ui/platform/AndroidComposeView;';
const OWNER = 'Landroidx/compose/ui/semantics/SemanticsOwner;', NODE = 'Landroidx/compose/ui/semantics/SemanticsNode;', CONFIG = 'Landroidx/compose/ui/semantics/SemanticsConfiguration;', KEY = 'Landroidx/compose/ui/semantics/SemanticsPropertyKey;';
const ACTION = 'Landroidx/compose/ui/semantics/AccessibilityAction;', ANNOTATED = 'Landroidx/compose/ui/text/AnnotatedString;', RECT = 'Landroidx/compose/ui/geometry/Rect;';
const ACTION_TYPES = new Map([['OnClick', []], ['OnLongClick', []], ['RequestFocus', []], ['Dismiss', []], ['Expand', []], ['Collapse', []], ['CopyText', []], ['CutText', []], ['PasteText', []], ['SetText', ['text']], ['InsertTextAtCursor', ['text']], ['ScrollBy', ['float', 'float']], ['ScrollToIndex', ['int']], ['SetProgress', ['float']], ['SetSelection', ['int', 'int', 'boolean']]]);
const params = signature => signature.slice(1, signature.indexOf(')')).match(/\[*L[^;]+;|\[*[ZBCSIFJD]/g) || [];
const floats = new DataView(new ArrayBuffer(4));
const float = bits => { floats.setInt32(0, bits, true); return floats.getFloat32(0, true); };
const bits = value => { floats.setFloat32(0, value, true); return floats.getInt32(0, true); };
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'compose-semantics-unsupported', ...details }); };
// A tap on a node that vanished (navigation/recomposition race) is harmless on a device; callers drop it instead of ending the session.
export const STALE_NODE_KIND = 'compose-semantics-stale-node';
const stale = (message, details = {}) => fail(message, { ...details, kind: STALE_NODE_KIND });

/** Accessibility adapter over public, original Compose DEX methods. This never
 * constructs a SemanticsOwner/Node or reads an application's private model.
 * Node and action references remain private; callers receive serializable data.
 */
export function createComposeSemanticsDriver(runtime) {
  const refs = new Map(); let lastRoots = null, lastMerged = true;
  // Real WindowManager roots, bottom to top. The topmost modal window (the Activity window is the base) and every window above it are
  // reachable; roots below a modal window are blocked exactly like touch/accessibility dispatch on Android.
  const windowRoots = () => runtime.platform?.viewRoots?.(runtime) ?? (runtime.root ? [{ root: runtime.root, window: null }] : []);
  const reachable = all => {
    let floor = 0; all.forEach((value, index) => { if (value.window && value.window.visible !== false && value.window.modal) floor = index; });
    return all.slice(floor);
  };
  // The Activity root may sit below framework-owned decor Views, so the owning window is the nearest ancestor-or-self that is a registered root.
  const windowOf = (all, view) => { const seen = new Set(); let ref = view; while (ref && !seen.has(ref.ref) && seen.size < 4096) { const found = all.find(value => value.root.ref === ref.ref); if (found) return found; seen.add(ref.ref); ref = runtime.object(ref).parent; } return null; };
  const call = (receiver, owner, name, signature, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, signature, parameters: params(signature), result: signature.slice(signature.indexOf(')') + 1) }, mode === 'static' ? values : [receiver, ...values], mode);
  const string = value => value == null ? null : runtime.javaString(value, 'Ljava/lang/String;');
  const list = (value, limit = 1024) => {
    if (!value) return []; const count = call(value, 'Ljava/util/List;', 'size', '()I');
    if (!Number.isInteger(count) || count < 0 || count > limit) fail('Excessive Compose semantics collection', { count, limit });
    return Array.from({ length: count }, (_, index) => call(value, 'Ljava/util/List;', 'get', '(I)Ljava/lang/Object;', [index]));
  };
  const boolean = value => !!call(value, 'Ljava/lang/Boolean;', 'booleanValue', '()Z');
  const annotatedText = value => string(call(value, ANNOTATED, 'getText', '()Ljava/lang/String;'));
  const ownerViews = roots => {
    const result = [], seen = new Set();
    const visit = (ref, depth) => {
      if (!ref) return; if (depth > 64 || seen.size >= 4096 || seen.has(ref.ref)) fail('Cyclic/excessive native View hierarchy while locating Compose owners');
      seen.add(ref.ref); const type = runtime.object(ref).type;
      if (!runtime.isSubtype(type, VIEW)) fail('Compose semantics roots must be actual Android Views', { type });
      if (runtime.isSubtype(type, OWNER_VIEW)) result.push(ref);
      if (runtime.isSubtype(type, GROUP)) {
        const count = call(ref, GROUP, 'getChildCount', '()I'); if (count < 0 || count > 4096) fail('Invalid native ViewGroup child count');
        for (let i = 0; i < count; i++) visit(call(ref, GROUP, 'getChildAt', '(I)Landroid/view/View;', [i]), depth + 1);
      }
    };
    for (const root of roots) visit(root, 0); return result;
  };
  const properties = config => {
    const iterator = call(config, CONFIG, 'iterator', '()Ljava/util/Iterator;'), values = new Map();
    while (call(iterator, 'Ljava/util/Iterator;', 'hasNext', '()Z')) {
      if (values.size >= 256) fail('Compose semantics property limit exceeded');
      const entry = call(iterator, 'Ljava/util/Iterator;', 'next', '()Ljava/lang/Object;');
      const key = call(entry, 'Ljava/util/Map$Entry;', 'getKey', '()Ljava/lang/Object;');
      const name = string(call(key, KEY, 'getName', '()Ljava/lang/String;'));
      values.set(name, call(entry, 'Ljava/util/Map$Entry;', 'getValue', '()Ljava/lang/Object;'));
    }
    return values;
  };
  /** ProgressBarRangeInfo (Slider, progress indicators): current value, [start, end] and the number of discrete steps. */
  const rangeInfo = value => {
    const RANGE_INFO = 'Landroidx/compose/ui/semantics/ProgressBarRangeInfo;', RANGE = 'Lkotlin/ranges/ClosedFloatingPointRange;', COMPARABLE = 'Ljava/lang/Comparable;';
    const range = call(value, RANGE_INFO, 'getRange', `()${RANGE}`), unbox = box => call(box, 'Ljava/lang/Float;', 'floatValue', '()F');
    return { current: float(call(value, RANGE_INFO, 'getCurrent', '()F')), start: float(unbox(call(range, 'Lkotlin/ranges/ClosedRange;', 'getStart', `()${COMPARABLE}`))), end: float(unbox(call(range, 'Lkotlin/ranges/ClosedRange;', 'getEndInclusive', `()${COMPARABLE}`))), steps: call(value, RANGE_INFO, 'getSteps', '()I') };
  };
  const normalize = (viewId, ref, parentId) => {
    const nodeId = call(ref, NODE, 'getId', '()I'), config = call(ref, NODE, 'getConfig', `()${CONFIG}`), values = properties(config);
    const rect = call(ref, NODE, 'getBoundsInRoot', `()${RECT}`), bounds = {};
    for (const side of ['left', 'top', 'right', 'bottom']) bounds[side] = float(call(rect, RECT, 'get' + side[0].toUpperCase() + side.slice(1), '()F'));
    if (Object.values(bounds).some(value => !Number.isFinite(value))) fail('Non-finite bounds returned by original Compose semantics');
    const actions = [], actionRefs = new Map();
    for (const [name] of ACTION_TYPES) if (values.has(name)) {
      const value = values.get(name), fn = call(value, ACTION, 'getAction', '()Lkotlin/Function;');
      if (fn) { actions.push({ name, label: string(call(value, ACTION, 'getLabel', '()Ljava/lang/String;')) }); actionRefs.set(name, fn); }
    }
    refs.set(`${viewId}:${nodeId}`, { ref, config, actionRefs, disabled: values.has('Disabled') });
    return { nodeId, parentId, testTag: values.has('TestTag') ? string(values.get('TestTag')) : null,
      texts: values.has('Text') ? list(values.get('Text')).map(annotatedText) : [],
      editableText: values.has('EditableText') ? annotatedText(values.get('EditableText')) : null,
      contentDescriptions: values.has('ContentDescription') ? list(values.get('ContentDescription')).map(string) : [],
      disabled: values.has('Disabled'), invisibleToUser: values.has('InvisibleToUser'), focused: values.has('Focused') ? boolean(values.get('Focused')) : null,
      selected: values.has('Selected') ? boolean(values.get('Selected')) : null,
      toggleState: values.has('ToggleableState') ? string(call(values.get('ToggleableState'), 'Ljava/lang/Enum;', 'name', '()Ljava/lang/String;')) : null,
      role: values.has('Role') ? runtime.javaString(values.get('Role')) : null,
      rangeInfo: values.has('ProgressBarRangeInfo') ? rangeInfo(values.get('ProgressBarRangeInfo')) : null,
      isDialog: values.has('IsDialog'), isPopup: values.has('IsPopup'), boundsInRoot: bounds,
      placed: bounds.right > bounds.left && bounds.bottom > bounds.top,
      propertyNames: [...values.keys()], actions };
  };
  const snapshot = ({ roots: explicitRoots, merged = true, maxNodes = 1024 } = {}) => {
    if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 4096) fail('Invalid semantics node limit');
    const all = windowRoots(), roots = explicitRoots ?? reachable(all).map(value => value.root);
    refs.clear(); lastRoots = explicitRoots ?? null; lastMerged = merged;
    const owners = []; let totalNodes = 0;
    for (const view of ownerViews(roots)) {
      const owner = call(view, OWNER_VIEW, 'getSemanticsOwner', `()${OWNER}`);
      if (!owner) fail('AndroidComposeView has no initialized SemanticsOwner', { ownerViewId: view.ref });
      const root = call(owner, OWNER, merged ? 'getRootSemanticsNode' : 'getUnmergedRootSemanticsNode', `()${NODE}`), nodes = [], seen = new Set();
      const visit = (ref, parentId = null, depth = 0) => {
        if (depth > 128 || totalNodes >= maxNodes) fail('Compose semantics node limit exceeded', { maxNodes });
        const value = normalize(view.ref, ref, parentId); if (seen.has(value.nodeId)) fail('Duplicate/cyclic Compose semantics node ID', { nodeId: value.nodeId });
        seen.add(value.nodeId); nodes.push(value); totalNodes++;
        for (const child of list(call(ref, NODE, 'getChildren', '()Ljava/util/List;'))) visit(child, value.nodeId, depth + 1);
      };
      visit(root); owners.push({ ownerViewId: view.ref, window: (w => w ? { id: w.window?.id ?? null, kind: w.window?.kind ?? 'activity', modal: w.window ? !!w.window.modal : true } : null)(windowOf(all, view)), rootNodeId: nodes[0].nodeId, attached: !!call(view, VIEW, 'isAttachedToWindow', '()Z'), width: call(view, VIEW, 'getWidth', '()I'), height: call(view, VIEW, 'getHeight', '()I'), merged, nodes });
    }
    return { schemaVersion: 1, source: 'original-Compose-DEX/public-SemanticsOwner', owners, totalNodes, merged };
  };
  const box = (kind, value) => {
    if (kind === 'text') {
      if (typeof value !== 'string' || value.length > 65536) fail('Invalid bounded semantics text');
      const empty = call(null, 'Ljava/util/Collections;', 'emptyList', '()Ljava/util/List;', [], 'static'), ref = runtime.allocate(ANNOTATED);
      call(ref, ANNOTATED, '<init>', '(Ljava/lang/String;Ljava/util/List;Ljava/util/List;)V', [value, empty, empty], 'direct'); return ref;
    }
    if (kind === 'boolean') { if (typeof value !== 'boolean') fail('Semantics action expects boolean'); return call(null, 'Ljava/lang/Boolean;', 'valueOf', '(Z)Ljava/lang/Boolean;', [value ? 1 : 0], 'static'); }
    if (kind === 'int') { if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) fail('Semantics action expects Java int'); return call(null, 'Ljava/lang/Integer;', 'valueOf', '(I)Ljava/lang/Integer;', [value], 'static'); }
    if (!Number.isFinite(value)) fail('Semantics action expects finite float');
    return call(null, 'Ljava/lang/Float;', 'valueOf', '(F)Ljava/lang/Float;', [bits(value)], 'static');
  };
  const driver = {
    // Garbage collector roots (src/heap-gc.js): the node references kept between a snapshot and the actions performed on it.
    [Symbol.for('apkweb.gc.roots')](visit) { for (const node of refs.values()) visit(node); },
    snapshot,
    performAction({ ownerViewId, nodeId, action, args = [] }) {
      if (!ACTION_TYPES.has(action)) fail('Unsupported standard semantics action', { action });
      const current = snapshot({ roots: lastRoots ?? undefined, merged: lastMerged });
      const owner = current.owners.find(value => value.ownerViewId === ownerViewId);
      if (!owner) { const all = windowRoots(), hidden = all.find(value => !reachable(all).includes(value) && ownerViews([value.root]).some(view => view.ref === ownerViewId)); if (hidden) stale('Compose semantics owner belongs to a window blocked by a modal window', { ownerViewId }); }
      if (!owner?.attached) stale('Compose semantics owner is detached or no longer present', { ownerViewId });
      const node = refs.get(`${ownerViewId}:${nodeId}`); if (!node) stale('Compose semantics node is no longer present', { ownerViewId, nodeId });
      if (node.disabled) return { handled: false, reason: 'disabled' };
      const fn = node.actionRefs.get(action); if (!fn) fail('The real semantics node does not expose this action', { ownerViewId, nodeId, action });
      const kinds = ACTION_TYPES.get(action); if (!Array.isArray(args) || args.length !== kinds.length) fail('Incorrect semantics action argument count', { action, expected: kinds.length });
      const boxed = kinds.map((kind, i) => box(kind, args[i])), signature = '(' + boxed.map(() => 'Ljava/lang/Object;').join('') + ')Ljava/lang/Object;';
      const result = call(fn, `Lkotlin/jvm/functions/Function${boxed.length};`, 'invoke', signature, boxed);
      return { handled: result ? boolean(result) : false };
    },
  };
  (runtime.gcExtraRoots ??= new Set()).add(driver);   // the heap collector (src/heap-gc.js) finds the node references through the runtime
  return driver;
}
