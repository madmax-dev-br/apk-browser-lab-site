// "Mostrar limites de layout" for Compose: the rectangles Compose itself draws when the owner's showLayoutBounds is on, read from the original LayoutNode tree in the Worker.
// It runs only while the page's overlay is on (src/apk-worker.js `layoutExport`); with the overlay off nothing here is called. The app never sees it: nothing is written to the
// app's objects, no system property changes, and the Owner's showLayoutBounds stays false (the page draws the overlay, src/layout-bounds.js).
//
// The rule, as androidx.compose.ui.node draws it (read in the DEX of the Compose fixtures):
//  - InnerNodeCoordinator.performDraw draws the LayoutNode's placed children (zSortedChildren, `isPlaced`) and then, with showLayoutBounds, drawBorder(innerBoundsPaint): Color.Red;
//  - LayoutModifierNodeCoordinator.performDraw draws the coordinator it wraps and then drawBorder(modifierBoundsPaint): Color.Blue, one per layout modifier (padding, size, offset...);
//  - drawBorder is drawRect(0.5, 0.5, measuredWidth - 0.5, measuredHeight - 0.5) with a 1 px stroke, in the coordinator's own space: after its position and its layer's
//    transform (graphicsLayer rotation, scale...), inside the clips of its own layer and of the layers above it. A layer with alpha 0 is not drawn, nor anything in it.
// So one LayoutNode gives one red rectangle and one blue rectangle per layout modifier; nothing depends on semantics.
//
// Reads: LayoutNode.isPlaced, getOuterCoordinator / getInnerCoordinator, getSemanticsId, the children list, NodeCoordinator.getWrapped, getPosition, getLayer,
// Placeable.getMeasuredSize and, for a coordinator with a layer, isTransparent, OwnedLayer.getUnderlyingMatrix and NodeCoordinator.rectInParent (the layer's clip): getters,
// no walk to the root per node. A build where those internal members have other names (a minified app) is read through the public API instead (LayoutInfo children and
// modifier coordinates, LayoutCoordinates.localToRoot and boundsInRoot: the same rectangles, slower); when neither can be read the owner is reported without rectangles and
// the page keeps the semantics boxes for it.
const GROUP = 'Landroid/view/ViewGroup;', OWNER_VIEW = 'Landroidx/compose/ui/platform/AndroidComposeView;';
const NODE = 'Landroidx/compose/ui/node/LayoutNode;', COORD = 'Landroidx/compose/ui/node/NodeCoordinator;', PLACEABLE = 'Landroidx/compose/ui/layout/Placeable;', LAYER = 'Landroidx/compose/ui/node/OwnedLayer;';
const INFO = 'Landroidx/compose/ui/layout/LayoutInfo;', COORDS = 'Landroidx/compose/ui/layout/LayoutCoordinates;', MODIFIER_INFO = 'Landroidx/compose/ui/layout/ModifierInfo;';
const COORDS_KT = 'Landroidx/compose/ui/layout/LayoutCoordinatesKt;', RECT = 'Landroidx/compose/ui/geometry/Rect;', MUTABLE_RECT = 'Landroidx/compose/ui/geometry/MutableRect;';
export const MAX_COMPOSE_RECTS = 8000;
const HUGE = 1e9, ONE_BITS = 0x3f800000;

const params = signature => signature.slice(1, signature.indexOf(')')).match(/\[*L[^;]+;|\[*[ZBCSIFJD]/g) || [];
const floats = new DataView(new ArrayBuffer(4));
const float = bits => { floats.setInt32(0, bits, true); return floats.getFloat32(0, true); };
const floatBits = value => { floats.setFloat32(0, value, true); return floats.getInt32(0, true); };
const round = value => Math.round(value * 100) / 100;
/** A packed pair of 32-bit halves (IntOffset, IntSize) -> [high, low]. */
const ints = packed => { const big = BigInt.asIntN(64, BigInt(packed)); return [Number(BigInt.asIntN(32, big >> 32n)), Number(BigInt.asIntN(32, big))]; };
/** A packed Offset (two floats) -> [x, y], and back. */
const offsetOf = packed => { const [x, y] = ints(packed); return [float(x), float(y)]; };
const packOffset = (x, y) => BigInt.asIntN(64, (BigInt(floatBits(x) >>> 0) << 32n) | BigInt(floatBits(y) >>> 0));

// Affine maps as [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f.
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
const multiply = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const translate = (m, x, y) => x === 0 && y === 0 ? m : [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const intersect = (a, b) => !a ? b : !b ? a : { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
const boxOf = q => ({ left: Math.min(q[0], q[2], q[4], q[6]), top: Math.min(q[1], q[3], q[5], q[7]), right: Math.max(q[0], q[2], q[4], q[6]), bottom: Math.max(q[1], q[3], q[5], q[7]) });
const quadOf = (m, width, height) => [...apply(m, 0, 0), ...apply(m, width, 0), ...apply(m, width, height), ...apply(m, 0, height)];

/** One coordinator's rectangle in the owner's px: its box, its four corners when the map rotates or skews it, and the clip when it cuts the box. */
export function composeRect(kind, quad, clip = null, node = null) {
  const box = boxOf(quad), out = { kind, left: round(box.left), top: round(box.top), right: round(box.right), bottom: round(box.bottom) };
  if (!(Math.abs(quad[1] - quad[3]) < 1e-3 && Math.abs(quad[0] - quad[6]) < 1e-3)) out.quad = quad.map(round);   // corners: top-left, top-right, bottom-right, bottom-left
  if (clip && (clip.left > box.left + 1e-3 || clip.top > box.top + 1e-3 || clip.right < box.right - 1e-3 || clip.bottom < box.bottom - 1e-3)) out.clip = { left: round(clip.left), top: round(clip.top), right: round(clip.right), bottom: round(clip.bottom) };
  if (node !== null && node !== undefined) out.node = node;
  return out;
}

/**
 * The layout-bounds rectangles of every AndroidComposeView in every window (bottom to top), in each owner's px.
 * @returns {{ owners: [{ ownerViewId, source: 'layout-nodes' | 'public-api' | null, rects: [{ kind: 'compose' | 'modifier', left, top, right, bottom, quad?, clip?, node? }], note? }], truncated, ms }}
 * kind 'compose' is the LayoutNode's own rectangle (red; `node` is its semanticsId), 'modifier' a layout modifier's (blue).
 */
export function composeLayoutBounds(runtime, { maxRects = MAX_COMPOSE_RECTS, publicOnly = false } = {}) {   // publicOnly: the public-API path alone (tests)
  const startedAt = performance.now();
  const call = (receiver, owner, name, signature, values = [], mode = 'virtual') => { const types = params(signature); return runtime.dispatch({ owner, name, signature, parameters: types, result: signature.slice(signature.indexOf(')') + 1) }, runtime.argumentWords(types, values, mode === 'static' ? {} : { receiver }), mode); };
  const typeOf = ref => ref ? runtime.object(ref).type : null;
  const listOf = value => { if (!value) return []; const count = call(value, 'Ljava/util/List;', 'size', '()I'); return Number.isInteger(count) && count > 0 ? Array.from({ length: Math.min(count, 4096) }, (_, i) => call(value, 'Ljava/util/List;', 'get', '(I)Ljava/lang/Object;', [i])) : []; };
  const floatField = (ref, owner, name) => { const value = runtime.object(ref).fields.get(`${owner}->${name}:F`) ?? 0; return Number.isInteger(value) ? float(value) : value; };
  // Every AndroidComposeView of every window (hwui draws every window), and the ones nested in an AndroidView holder of another owner.
  const ownerViews = [], seen = new Set();
  const visit = (ref, depth) => {
    if (!ref || depth > 96 || seen.size >= 8192 || seen.has(ref.ref)) return; seen.add(ref.ref);
    const type = typeOf(ref);
    if (runtime.isSubtype(type, OWNER_VIEW)) ownerViews.push(ref);
    if (runtime.isSubtype(type, GROUP)) { const count = call(ref, GROUP, 'getChildCount', '()I'); for (let i = 0; i < Math.min(count, 4096); i++) visit(call(ref, GROUP, 'getChildAt', '(I)Landroid/view/View;', [i]), depth + 1); }
  };
  for (const entry of runtime.platform?.viewRoots?.(runtime) ?? (runtime.root ? [{ root: runtime.root }] : [])) visit(entry.root, 0);

  let total = 0, truncated = false;
  const owners = [];
  for (const view of ownerViews) {
    const rects = [], room = () => { if (total + rects.length >= maxRects) { truncated = true; return false; } return true; };
    let source = null, note = null, root = null;
    try { root = call(view, OWNER_VIEW, 'getRoot', `()${NODE}`); } catch (error) { note = `AndroidComposeView.getRoot unreadable (${String(error?.message ?? error).slice(0, 120)})`; }
    if (root) {
      try { if (publicOnly) throw new Error('public API requested'); walkInternal(root, rects, room); source = 'layout-nodes'; }
      catch (error) {
        rects.length = 0; note = `LayoutNode internals unreadable (${String(error?.message ?? error).slice(0, 120)})`;
        try { walkPublic(root, rects, room); source = 'public-api'; } catch (inner) { rects.length = 0; note += `; public layout API unreadable (${String(inner?.message ?? inner).slice(0, 120)})`; }
      }
    }
    total += rects.length;
    owners.push({ ownerViewId: view.ref, source, rects, ...(note ? { note } : {}) });
  }
  return { owners, truncated, ms: Math.round((performance.now() - startedAt) * 10) / 10 };

  // The fast path: the coordinator chain of each LayoutNode, outer to inner, with the map and the clip carried down from the parent's inner coordinator.
  function walkInternal(root, rects, room) {
    let scratch = null, matrix = null;
    const node = (ref, map, clip, depth) => {
      if (depth > 512 || !room() || !call(ref, NODE, 'isPlaced', '()Z')) return;
      const inner = call(ref, NODE, 'getInnerCoordinator$ui_release', `()${COORD}`), id = call(ref, NODE, 'getSemanticsId', '()I');
      let coordinator = call(ref, NODE, 'getOuterCoordinator$ui_release', `()${COORD}`);
      for (let guard = 0; coordinator && guard < 256; guard++) {
        const [x, y] = ints(call(coordinator, COORD, 'getPosition-nOcc-ac', '()J')), layer = call(coordinator, COORD, 'getLayer', `()${LAYER}`);
        const parentMap = map; map = translate(map, x, y);
        if (layer) {
          if (call(coordinator, COORD, 'isTransparent', '()Z')) return;   // alpha 0: the layer and everything in it are not drawn
          // OwnedLayer.transform(matrix) multiplies the layer's matrix into the one given: an identity comes back as the layer's own. Compose's 4x4 Matrix is column-major:
          // [0] scaleX, [1] skewY, [4] skewX, [5] scaleY, [12] translateX, [13] translateY (a perspective row is ignored). A float[] holds the float bits.
          matrix ??= runtime.newArray('[F', 16); const cells = runtime.array(matrix).elements; for (let i = 0; i < 16; i++) cells[i] = i % 5 === 0 ? ONE_BITS : 0;
          call(layer, LAYER, 'transform-58bKbWc', '([F)V', [matrix]);
          const values = Array.from(cells, float);
          map = multiply(map, [values[0], values[1], values[4], values[5], values[12], values[13]]);
          // The layer's clip: a huge rectangle mapped into the parent with clipBounds comes back cut to the layer's (transformed) bounds when the layer clips.
          scratch ??= runtime.allocate(MUTABLE_RECT);
          call(scratch, MUTABLE_RECT, '<init>', '(FFFF)V', [floatBits(-HUGE), floatBits(-HUGE), floatBits(HUGE), floatBits(HUGE)], 'direct');
          call(coordinator, COORD, 'rectInParent$ui_release', `(${MUTABLE_RECT}ZZ)V`, [scratch, 1, 0]);
          const cut = { left: floatField(scratch, MUTABLE_RECT, 'left'), top: floatField(scratch, MUTABLE_RECT, 'top'), right: floatField(scratch, MUTABLE_RECT, 'right'), bottom: floatField(scratch, MUTABLE_RECT, 'bottom') };
          if (cut.right - cut.left < HUGE) clip = intersect(clip, boxOf([...apply(parentMap, cut.left, cut.top), ...apply(parentMap, cut.right, cut.top), ...apply(parentMap, cut.right, cut.bottom), ...apply(parentMap, cut.left, cut.bottom)]));
        }
        const [width, height] = ints(call(coordinator, PLACEABLE, 'getMeasuredSize-YbymL2g', '()J')), isInner = coordinator.ref === inner.ref;
        if (width > 0 && height > 0) { if (!room()) return; rects.push(composeRect(isInner ? 'compose' : 'modifier', quadOf(map, width, height), clip, isInner ? id : null)); }
        if (isInner) break;
        coordinator = call(coordinator, COORD, 'getWrapped$ui_release', `()${COORD}`);
      }
      for (const child of listOf(call(ref, NODE, 'getChildren$ui_release', '()Ljava/util/List;'))) node(child, map, clip, depth + 1);
    };
    node(root, IDENTITY, null, 0);
  }

  // The public API: LayoutInfo.getChildrenInfo, the coordinates of each modifier (one per layout modifier, plus the inner one), localToRoot and boundsInRoot.
  function walkPublic(root, rects, room) {
    const corner = (coords, x, y) => offsetOf(call(coords, COORDS, 'localToRoot-MK-Hz9U', '(J)J', [packOffset(x, y)]));
    const add = (coords, kind, id) => {
      const [width, height] = ints(call(coords, COORDS, 'getSize-YbymL2g', '()J')); if (!(width > 0 && height > 0)) return;
      const quad = [...corner(coords, 0, 0), ...corner(coords, width, 0), ...corner(coords, width, height), ...corner(coords, 0, height)];
      const bounds = call(null, COORDS_KT, 'boundsInRoot', `(${COORDS})${RECT}`, [coords], 'static');
      rects.push(composeRect(kind, quad, { left: floatField(bounds, RECT, 'left'), top: floatField(bounds, RECT, 'top'), right: floatField(bounds, RECT, 'right'), bottom: floatField(bounds, RECT, 'bottom') }, id));
    };
    const node = (ref, depth) => {
      if (depth > 512 || !room() || !call(ref, INFO, 'isPlaced', '()Z')) return;
      const inner = call(ref, INFO, 'getCoordinates', `()${COORDS}`), seen = new Set([inner.ref]), id = call(ref, INFO, 'getSemanticsId', '()I');
      for (const info of listOf(call(ref, INFO, 'getModifierInfo', '()Ljava/util/List;'))) {
        const coords = call(info, MODIFIER_INFO, 'getCoordinates', `()${COORDS}`); if (!coords || seen.has(coords.ref)) continue;
        seen.add(coords.ref); if (!room()) return; add(coords, 'modifier', null);
      }
      if (!room()) return; add(inner, 'compose', id);
      for (const child of childrenOf(ref)) node(child, depth + 1);
    };
    // LayoutInfo.getChildrenInfo (Compose 1.8); before it, the LayoutNode's children list under its known names or, renamed, the no-argument method that answers a List of LayoutNodes.
    let childRead = null;
    const childrenOf = ref => {
      if (childRead) return listOf(call(ref, childRead.owner, childRead.name, '()Ljava/util/List;'));
      for (const [owner, name] of [[INFO, 'getChildrenInfo'], [NODE, 'getChildren$ui_release'], [NODE, 'getFoldedChildren$ui_release']]) { try { const items = listOf(call(ref, owner, name, '()Ljava/util/List;')); childRead = { owner, name }; return items; } catch { /* not in this build */ } }
      let best = null;
      for (const key of runtime.classes?.get?.(NODE)?.methods?.keys?.() ?? []) {
        if (!key.endsWith('()Ljava/util/List;')) continue; const name = key.slice(0, key.indexOf('('));
        let items; try { items = listOf(call(ref, NODE, name, '()Ljava/util/List;')); } catch { continue; }
        if (items.length && items.every(item => item && runtime.isSubtype(typeOf(item), NODE)) && (!best || items.length > best.items.length)) best = { name, items };
      }
      if (best) { childRead = { owner: NODE, name: best.name }; return best.items; }
      return [];   // a node without children decides nothing: the next one with children chooses
    };
    node(root, 0);
  }
}
