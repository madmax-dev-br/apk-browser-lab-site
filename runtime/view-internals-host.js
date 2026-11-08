import { createHostRegistry } from './host-contract.js?v=ca7b5e864afd';
import { APKError } from './apk-error.js?v=ca7b5e864afd';

// Hidden (non-SDK) View / ViewGroup members of android-13.0.0_r1 that the original list widgets (AdapterView, AbsListView, ListView, FastScroller, CheckedTextView; compiled in the layouts
// profile against framework-aosp/compile-contracts/list-widgets.txt) call on the lab's View model. Each has the semantics of View.java / ViewGroup.java for the virtual device: no
// accessibility service, no scroll-bar drawing, no context menus, left-to-right layout. findViewById goes through findViewTraversal, so an original subclass (ListView looks into its header and
// footer views) takes part exactly as in Android.
const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', ROOT = 'Landroid/view/ViewRootImpl;', RECT = 'Landroid/graphics/Rect;', MOTION = 'Landroid/view/MotionEvent;', EVENT = 'Landroid/view/accessibility/AccessibilityEvent;';
const SPEC = 'Landroid/view/View$MeasureSpec;', PREDICATE = 'Ljava/util/function/Predicate;', INFO = 'Landroid/view/accessibility/AccessibilityNodeInfo;', ENCODER = 'Landroid/view/ViewHierarchyEncoder;';
const nullish = v => v === null || v === undefined || v === 0;
const flag = v => v === true || v === 1 || v === 0xffffffff || v === -1;
const bits = new DataView(new ArrayBuffer(4)), i2f = n => { bits.setInt32(0, n | 0, true); return bits.getFloat32(0, true); }, f2i = n => { bits.setFloat32(0, n, true); return bits.getInt32(0, true); };

export function createViewInternalsHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const isView = (r, v) => !nullish(v) && typeof v === 'object' && r.isSubtype(r.object(v).type, VIEW);
  const isGroup = (r, v) => !nullish(v) && typeof v === 'object' && r.isSubtype(r.object(v).type, GROUP);
  const targetSdk = () => Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 24);

  // ---- accessibility internals: no accessibility focus, no a11y state changes to report (the manager is disabled in the virtual device) ----------------------------------------------------
  def(VIEW, 'clearAccessibilityFocus', '()V', () => {});
  def(VIEW, 'requestAccessibilityFocus', '()Z', () => 0);   // false while accessibility / touch exploration is off
  def(VIEW, 'notifyViewAccessibilityStateChangedIfNeeded', '(I)V', () => {});
  def(GROUP, 'notifySubtreeAccessibilityStateChangedIfNeeded', '()V', () => {});
  def(VIEW, 'dispatchPopulateAccessibilityEventInternal', `(${EVENT})Z`, () => 0);
  def(VIEW, 'onRequestSendAccessibilityEventInternal', `(${VIEW}${EVENT})Z`, () => 1);
  def(VIEW, 'resetSubtreeAutofillIds', '()V', () => {});   // autofill ids are never assigned (no autofill session)
  def(VIEW, 'onProvideStructure', `(Landroid/view/ViewStructure;II)V`, () => { throw new APKError('View.onProvideStructure (assist / autofill / content-capture structure) needs the ViewStructure services, which the virtual device does not run', { kind: 'view-structure-unsupported' }); });
  def(ROOT, 'getAccessibilityFocusedHost', `()${VIEW}`, () => null);
  def(ROOT, 'getAccessibilityFocusedVirtualView', `()${INFO}`, () => null);
  def(ROOT, 'isLayoutRequested', '()Z', () => (platform.viewLayoutHost.state().pending ? 1 : 0));   // some root has a layout pass queued

  // ---- debug encoding (Layout Inspector): nothing consumes it in the lab ----------------------------------------------------------------------------------------------------------------
  def(VIEW, 'encodeProperties', `(${ENCODER})V`, () => {}); def(VIEW, 'encode', `(${ENCODER})V`, () => {});
  def('Landroid/view/ViewGroup$LayoutParams;', 'encodeProperties', `(${ENCODER})V`, () => {});

  // ---- scrolling / context-menu internals: scroll bars are not drawn and there is no pointer-driven context menu ------------------------------------------------------------------------------
  def(VIEW, 'initializeScrollbarsInternal', '(Landroid/content/res/TypedArray;)V', () => {});
  def(VIEW, 'isVerticalScrollBarHidden', '()Z', () => 0);
  def(VIEW, 'handleScrollBarDragging', `(${MOTION})Z`, () => 0);
  def(VIEW, 'hasOpaqueScrollbars', '()Z', () => 0);
  def(VIEW, 'isShowingContextMenuWithCoords', '()Z', () => 0);
  def(VIEW, 'performButtonActionOnTouchDown', `(${MOTION})Z`, () => 0);   // only a mouse's secondary button opens a context menu
  def(VIEW, 'isInScrollingContainer', '()Z', (r, _m, [self]) => {
    let parent = r.object(self).parent;
    for (let depth = 0; isView(r, parent) && depth < 4096; depth++) { if (isGroup(r, parent) && flag(call(r, parent, GROUP, 'shouldDelayChildPressedState', [], 'Z'))) return 1; parent = r.object(parent).parent; }
    return 0;
  });

  // ---- direction, padding, frame -----------------------------------------------------------------------------------------------------------------------------------------------------------
  def(VIEW, 'resolveRtlPropertiesIfNeeded', '()V', () => {}); def(VIEW, 'resolvePadding', '()V', () => {}); def(VIEW, 'resetPaddingToInitialValues', '()V', () => {});   // left-to-right: start / end are left / right
  def(VIEW, 'isLayoutRtl', '()Z', (r, _m, [self]) => r.object(self).layoutDirection === 1 ? 1 : 0);
  def(VIEW, 'internalSetPadding', '(IIII)V', (r, _m, [self, left, top, right, bottom]) => { r.object(self).padding = { left, top, right, bottom }; });   // setPadding without the layout request
  def(VIEW, 'invalidateParentCaches', '()V', () => {});   // drawing caches are not kept
  def(VIEW, 'invalidateParentIfNeeded', '()V', (r, _m, [self]) => { const parent = r.object(self).parent; if (isView(r, parent)) platform.requestDraw?.(r, parent); });
  def(VIEW, 'pointInView', '(FFF)Z', (r, _m, [self, x, y, slop]) => {
    const b = r.object(self).bounds ?? { left: 0, top: 0, right: 0, bottom: 0 }, lx = i2f(x), ly = i2f(y), s = i2f(slop);
    return lx >= -s && ly >= -s && lx < (b.right - b.left) + s && ly < (b.bottom - b.top) + s ? 1 : 0;
  });
  def(VIEW, 'transformPointToViewLocal', `([F${VIEW})V`, (r, _m, [self, point, child]) => {
    const p = r.array(point).elements, c = r.object(child).bounds ?? { left: 0, top: 0 };
    const sx = r.object(self).fields.get(`${VIEW}->mScrollX:I`) ?? 0, sy = r.object(self).fields.get(`${VIEW}->mScrollY:I`) ?? 0;
    p[0] = f2i(i2f(p[0]) + sx - c.left); p[1] = f2i(i2f(p[1]) + sy - c.top);
    if (!flag(call(r, child, VIEW, 'hasIdentityMatrix', [], 'Z'))) call(r, call(r, child, VIEW, 'getMatrix', [], 'Landroid/graphics/Matrix;'), 'Landroid/graphics/Matrix;', 'mapPoints', ['[F'], 'V', [point]);
  });
  def(GROUP, 'offsetChildrenTopAndBottom', '(I)V', (r, _m, [self, offset]) => { for (const child of [...(r.object(self).children ?? [])]) call(r, child, VIEW, 'offsetTopAndBottom', ['I'], 'V', [offset]); });
  def(SPEC, 'makeSafeMeasureSpec', '(II)I', (r, _m, [size, mode]) => (targetSdk() < 23 && mode === 0) ? 0 : callStatic(r, SPEC, 'makeMeasureSpec', ['I', 'I'], 'I', [size, mode]));   // sUseZeroUnspecifiedMeasureSpec (target < M)

  // ---- view lookup: findViewById / findViewWithTag / findViewByPredicate walk through the overridable *Traversal methods --------------------------------------------------------------------
  const childrenOf = (r, self) => [...(r.object(self).children ?? [])];
  const rootNamespace = (r, v) => !isView(r, r.object(v).parent) || r.object(v).rootNamespace === true;
  def(VIEW, 'isRootNamespace', '()Z', (r, _m, [self]) => (rootNamespace(r, self) ? 1 : 0));
  def(VIEW, 'findViewTraversal', '(I)Landroid/view/View;', (r, _m, [self, id]) => (r.object(self).androidId === (id >>> 0) ? self : null));
  def(GROUP, 'findViewTraversal', '(I)Landroid/view/View;', (r, _m, [self, id]) => {
    if (r.object(self).androidId === (id >>> 0)) return self;
    for (const child of childrenOf(r, self)) if (!r.object(child).rootNamespace) { const found = call(r, child, VIEW, 'findViewById', ['I'], VIEW, [id]); if (!nullish(found)) return found; }
    return null;
  });
  const sameTag = (r, a, b) => !nullish(a) && flag(call(r, b, 'Ljava/lang/Object;', 'equals', ['Ljava/lang/Object;'], 'Z', [a]));
  def(VIEW, 'findViewWithTagTraversal', '(Ljava/lang/Object;)Landroid/view/View;', (r, _m, [self, tag]) => (sameTag(r, tag, call(r, self, VIEW, 'getTag', [], 'Ljava/lang/Object;')) ? self : null));
  def(GROUP, 'findViewWithTagTraversal', '(Ljava/lang/Object;)Landroid/view/View;', (r, _m, [self, tag]) => {
    if (!nullish(tag) && sameTag(r, tag, call(r, self, VIEW, 'getTag', [], 'Ljava/lang/Object;'))) return self;
    for (const child of childrenOf(r, self)) if (!r.object(child).rootNamespace) { const found = call(r, child, VIEW, 'findViewWithTag', ['Ljava/lang/Object;'], VIEW, [tag]); if (!nullish(found)) return found; }
    return null;
  });
  def(VIEW, 'findViewByPredicate', `(${PREDICATE})${VIEW}`, (r, _m, [self, predicate]) => call(r, self, VIEW, 'findViewByPredicateTraversal', [PREDICATE, VIEW], VIEW, [predicate, null]));
  def(VIEW, 'findViewByPredicateTraversal', `(${PREDICATE}${VIEW})${VIEW}`, (r, _m, [self, predicate]) => (flag(call(r, predicate, PREDICATE, 'test', ['Ljava/lang/Object;'], 'Z', [self])) ? self : null));
  def(GROUP, 'findViewByPredicateTraversal', `(${PREDICATE}${VIEW})${VIEW}`, (r, _m, [self, predicate, skip]) => {
    if (flag(call(r, predicate, PREDICATE, 'test', ['Ljava/lang/Object;'], 'Z', [self]))) return self;
    for (const child of childrenOf(r, self)) {
      if (!nullish(skip) && child.ref === skip.ref) continue;
      if (r.object(child).rootNamespace) continue;
      const found = call(r, child, VIEW, 'findViewByPredicate', [PREDICATE], VIEW, [predicate]); if (!nullish(found)) return found;
    }
    return null;
  });
  void RECT;
  return registry;
}
