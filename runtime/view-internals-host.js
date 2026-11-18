import { createHostRegistry } from './host-contract.js?v=529b25fb80f8';
import { APKError } from './apk-error.js?v=529b25fb80f8';
import { installViewXmlAttributes } from './view-xml-attributes.js?v=529b25fb80f8';
import { installTextViewXmlAttributes } from './textview-xml-attributes.js?v=529b25fb80f8';

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

  // ---- ViewGroup hooks the original layouts override (android-13.0.0_r1 ViewGroup.java). The host calls them on a parent whose class overrides them; these are ViewGroup's own bodies.
  const LP = 'Landroid/view/ViewGroup$LayoutParams;';
  def(GROUP, 'onSetLayoutParams', `(${VIEW}${LP})V`, (r, _m, [self]) => { call(r, self, VIEW, 'requestLayout'); });
  def(GROUP, 'onChildVisibilityChanged', `(${VIEW}II)V`, (r, _m, [self, child, oldVisibility, newVisibility]) => platform.viewGroupApi.childVisibilityChanged(r, self, child, oldVisibility, newVisibility));   // LayoutTransition.showChild / hideChild (viewgroup-api-host.js)
  // ViewGroup.requestChildFocus: the focus path goes up through every parent (HorizontalScrollView / ScrollView scroll the focused descendant into view there). The lab keeps the focused
  // view per window, so this body only forwards to the parent.
  def(GROUP, 'requestChildFocus', `(${VIEW}${VIEW})V`, (r, _m, [self, , focused]) => { const parent = r.object(self).parent; if (isGroup(r, parent)) call(r, parent, GROUP, 'requestChildFocus', [VIEW, VIEW], 'V', [self, focused]); });
  // ViewGroup.LayoutParams.sizeToString (hidden, used by the debug(String) of every LayoutParams class)
  def(LP, 'sizeToString', '(I)Ljava/lang/String;', (r, _m, [size]) => size === -2 ? 'wrap-content' : size === -1 ? 'match-parent' : String(size), { static: true });

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
  // ViewRootImpl.isLayoutRequested and the rest of its ViewParent surface: src/popup-window-needs.js

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
  def(VIEW, 'resolveRtlPropertiesIfNeeded', '()V', () => {});   // left-to-right: start / end are left / right
  // View.resetPaddingToInitialValues / resolvePadding (android-13.0.0_r1): the left and right padding go back to what setPadding, the XML or the background gave, or to
  // the start / end padding for the view's layout direction, then internalSetPadding() and onRtlPropertiesChanged() run on the receiver's class, where a widget adds its own (CheckedTextView's check mark).
  const initialPadding = (r, view) => {   // the one state View.java keeps: mUserPaddingLeftInitial / RightInitial and mUserPaddingStart / End (view-xml-attributes.js)
    const left = view.userPaddingLeftInitial ?? view.padding?.left ?? 0, right = view.userPaddingRightInitial ?? view.padding?.right ?? 0;
    if (platform.viewXmlAttributes.rtlCompatibility(r, view.context)) return { left, right };
    const rtl = view.layoutDirection === 1, start = view.userPaddingStart, end = view.userPaddingEnd, onLeft = rtl ? end : start, onRight = rtl ? start : end;
    return { left: onLeft >= 0 ? onLeft : left, right: onRight >= 0 ? onRight : right };   // a start / end padding wins on the edge it resolves to
  };
  def(VIEW, 'resetPaddingToInitialValues', '()V', (r, _m, [self]) => { const view = r.object(self), initial = initialPadding(r, view); if (!view.padding) view.padding = { left: 0, top: 0, right: 0, bottom: 0 }; view.padding.left = initial.left; view.padding.right = initial.right; });
  def(VIEW, 'resolvePadding', '()V', (r, _m, [self]) => {
    const view = r.object(self), initial = initialPadding(r, view), padding = view.padding ?? {};
    call(r, self, VIEW, 'internalSetPadding', ['I', 'I', 'I', 'I'], 'V', [initial.left, padding.top ?? 0, initial.right, padding.bottom ?? 0]);
    call(r, self, VIEW, 'onRtlPropertiesChanged', ['I'], 'V', [view.layoutDirection === 1 ? 1 : 0]);
  });
  def(VIEW, 'isLayoutRtl', '()Z', (r, _m, [self]) => r.object(self).layoutDirection === 1 ? 1 : 0);
  def(VIEW, 'internalSetPadding', '(IIII)V', (r, _m, [self, left, top, right, bottom]) => {   // setPadding without the layout request: the padding fields, plus the scroll bar's size for an inset scroll bar style; the user padding "initial" values stay
    const inset = platform.viewXmlAttributes.scrollbarInsets(r, self); platform.viewXmlAttributes.writePadding(r, self, { left: left + inset.left, top, right: right + inset.right, bottom: bottom + inset.bottom });
  });
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
  // ---- what PopupWindow / ListPopupWindow / Spinner / Gallery / AdapterViewAnimator / GridView use beyond the list widgets -------------------------------------------------
  const WMG = 'Landroid/view/WindowManagerGlobal;', POINTF = 'Landroid/graphics/PointF;', WLP = 'Landroid/view/WindowManager$LayoutParams;', ACTIVITY = 'Landroid/app/Activity;';
  // WindowManagerGlobal.getInstance().getWindowView(token): the root view of the window that owns the token (PopupWindow.getAppRootView asks for the anchor's application window)
  def(WMG, 'getInstance', `()${WMG}`, r => platform.windowManagerGlobal.instance(r), { static: true });   // the singleton with the real fields (mViews, mRoots, mParams ...): src/window-manager-global.js
  def(WMG, 'getWindowViews', '()Ljava/util/ArrayList;', r => platform.windowManagerGlobal.windowViews(r));   // a copy of mViews, the window roots in the order they were added
  def(WMG, 'getWindowView', `(Landroid/os/IBinder;)${VIEW}`, (r, _m, [, token]) => {
    const owner = nullish(token) ? null : r.object(token).windowOwner ?? null; if (owner === null) return null;
    if (r.isSubtype(r.object(owner).type, VIEW)) return owner;
    if (!r.isSubtype(r.object(owner).type, ACTIVITY)) return null;
    const window = call(r, owner, ACTIVITY, 'getWindow', [], 'Landroid/view/Window;'); return nullish(window) ? null : call(r, window, 'Landroid/view/Window;', 'getDecorView', [], VIEW);
  });
  def(VIEW, 'setTagInternal', '(ILjava/lang/Object;)V', (r, _m, [self, key, tag]) => { (r.object(self).keyedTags ||= new Map()).set(key, tag); });   // setTag(key, tag) without the application-id check: framework keys (Scene's current scene)
  def(VIEW, 'setIsRootNamespace', '(Z)V', (r, _m, [self, on]) => { r.object(self).rootNamespace = flag(on); });
  // View.getWindowDisplayFrame, View.getAccessibilityViewId and WindowManager.LayoutParams.setSurfaceInsets: src/popup-window-needs.js
  def(VIEW, 'requestKeyboardShortcuts', '(Ljava/util/List;I)V', () => {});   // the original View body is empty
  // View.isVisibleToUser(): attached, shown up to the root, not fully transparent, and some part of it inside its ancestors' clips
  def(VIEW, 'isVisibleToUser', '()Z', (r, _m, [self]) => {
    if (!flag(call(r, self, VIEW, 'isAttachedToWindow', [], 'Z')) || !flag(call(r, self, VIEW, 'isShown', [], 'Z'))) return 0;
    const rect = r.allocate(RECT); call(r, rect, RECT, '<init>'); return flag(call(r, self, VIEW, 'getGlobalVisibleRect', [RECT], 'Z', [rect])) ? 1 : 0;
  });
  // View.toGlobalMotionEvent / toLocalMotionEvent: the event moved between the view's coordinates and the screen's. Views with a transformation matrix (rotation, scale) are not handled.
  const offsetEvent = (r, self, event, sign) => {
    if (!flag(call(r, self, VIEW, 'isAttachedToWindow', [], 'Z'))) return 0;
    const matrix = call(r, self, VIEW, 'getMatrix', [], 'Landroid/graphics/Matrix;');
    if (!flag(call(r, matrix, 'Landroid/graphics/Matrix;', 'isIdentity', [], 'Z'))) throw new APKError('View.toGlobalMotionEvent / toLocalMotionEvent for a view with a transformation matrix is not implemented', { kind: 'unsupported-api' });
    const at = r.newArray('[I', 2); call(r, self, VIEW, 'getLocationOnScreen', ['[I'], 'V', [at]); const [x, y] = r.array(at).elements;
    call(r, event, MOTION, 'offsetLocation', ['F', 'F'], 'V', [f2i(sign * x), f2i(sign * y)]); return 1;
  };
  def(VIEW, 'toGlobalMotionEvent', `(${MOTION})Z`, (r, _m, [self, event]) => offsetEvent(r, self, event, 1));
  def(VIEW, 'toLocalMotionEvent', `(${MOTION})Z`, (r, _m, [self, event]) => offsetEvent(r, self, event, -1));
  // ViewGroup.isTransformedTouchPointInView: the point in the child's coordinates and whether the child contains it
  def(GROUP, 'isTransformedTouchPointInView', `(FF${VIEW}${POINTF})Z`, (r, _m, [self, x, y, child, out]) => {
    const group = r.object(self), view = r.object(child), matrix = call(r, child, VIEW, 'getMatrix', [], 'Landroid/graphics/Matrix;');
    if (!flag(call(r, matrix, 'Landroid/graphics/Matrix;', 'isIdentity', [], 'Z'))) throw new APKError('ViewGroup.isTransformedTouchPointInView for a child with a transformation matrix is not implemented', { kind: 'unsupported-api' });
    const px = i2f(x) + (group.scrollX || 0) - (view.bounds?.left ?? 0), py = i2f(y) + (group.scrollY || 0) - (view.bounds?.top ?? 0);
    const inside = px >= 0 && py >= 0 && px < (view.bounds?.right ?? 0) - (view.bounds?.left ?? 0) && py < (view.bounds?.bottom ?? 0) - (view.bounds?.top ?? 0);   // child.pointInView(x, y)
    if (inside && !nullish(out)) call(r, out, POINTF, 'set', ['F', 'F'], 'V', [f2i(px), f2i(py)]);
    return inside ? 1 : 0;
  });
  // ViewGroup.showContextMenuForChild: asks up the parent chain. At the window's root (DecorView.showContextMenuForChild) Android builds a ContextMenu, lets the original view and
  // every ancestor populate it (View.createContextMenu) and shows it when it has items. The lab has no context menu window: with nobody to populate the menu the answer is false, as
  // on Android for an empty menu; with an OnCreateContextMenuListener on the original view or an ancestor (Activity.registerForContextMenu sets one) it fails naming what is missing,
  // as View.showContextMenu does, instead of a long press that silently does nothing.
  const showAtRoot = (r, original) => {
    for (let current = original, depth = 0; isView(r, current) && depth < 4096; current = r.object(current).parent, depth++)
      if (!nullish(r.object(current).createContextMenuListener)) throw new APKError('ViewGroup.showContextMenuForChild with an OnCreateContextMenuListener in the view chain needs a popup context-menu surface, which the virtual window does not have', { kind: 'context-menu-unsupported' });
    return 0;
  };
  for (const [signature, parameters] of [[`(${VIEW})Z`, [VIEW]], [`(${VIEW}FF)Z`, [VIEW, 'F', 'F']]])
    def(GROUP, 'showContextMenuForChild', signature, (r, _m, [self, ...args]) => { const parent = r.object(self).parent; return isGroup(r, parent) ? call(r, parent, GROUP, 'showContextMenuForChild', parameters, 'Z', args) : showAtRoot(r, args[0]); });
  // SoundEffectConstants.getContantForFocusDirection: the navigation sound of a focus direction
  def('Landroid/view/SoundEffectConstants;', 'getContantForFocusDirection', '(I)I', (r, _m, [direction]) => {
    const constant = name => r.readStatic({ owner: 'Landroid/view/SoundEffectConstants;', name, type: 'I' }), focus = name => r.readStatic({ owner: VIEW, name, type: 'I' });
    if (direction === focus('FOCUS_RIGHT')) return constant('NAVIGATION_RIGHT');
    if (direction === focus('FOCUS_FORWARD') || direction === focus('FOCUS_DOWN')) return constant('NAVIGATION_DOWN');
    if (direction === focus('FOCUS_LEFT')) return constant('NAVIGATION_LEFT');
    if (direction === focus('FOCUS_BACKWARD') || direction === focus('FOCUS_UP')) return constant('NAVIGATION_UP');
    r.throwJava('Ljava/lang/IllegalArgumentException;', 'direction must be one of {FOCUS_UP, FOCUS_DOWN, FOCUS_LEFT, FOCUS_RIGHT, FOCUS_FORWARD, FOCUS_BACKWARD}.');
  }, { static: true });

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
  installViewXmlAttributes(platform, registry);   // the View / ViewGroup / MarginLayoutParams constructor attribute passes and the framework members they need
  installTextViewXmlAttributes(platform);   // the TextView and CompoundButton constructor passes
  platform.viewXmlAttributes.addSubclassPass((r, self, node, context) => platform.progressBarApi?.applyAttributes(r, self, node, context) ?? null);   // the ProgressBar constructor pass (progress-bar-api-host.js)
  return registry;
}
