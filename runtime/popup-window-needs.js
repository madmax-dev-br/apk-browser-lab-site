// Platform members the original android.widget.PopupWindow / ListPopupWindow / menu popups of the framework DEX call on classes the lab hosts (android-13.0.0_r1 semantics).
// The popup's own logic (positioning, the decor and background views, transitions, dismissal) is the original code; a popup's window is a root added through WindowManager.addView.
const RECT = 'Landroid/graphics/Rect;';
const WM_PARAMS = 'Landroid/view/WindowManager$LayoutParams;';
const VIEW = 'Landroid/view/View;';

export function definePopupWindowMembers(registry, platform) {
  const { def } = registry;
  // WindowManagerGlobal.getInstance().getWindowView(token) (PopupWindow.getAppRootView), View.setIsRootNamespace / isRootNamespace, View.setTagInternal: src/view-internals-host.js,
  // with the view lookup that reads the root-namespace flag.
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  // View.getWindowDisplayFrame(Rect): the display frame of the View's window without insets (ViewRootImpl.getDisplayFrame; the display size for a detached View). Every window of the
  // virtual device is laid out against the whole display.
  def(VIEW, 'getWindowDisplayFrame', `(${RECT})V`, (r, _m, [, outRect]) => { call(r, outRect, RECT, 'set', ['I', 'I', 'I', 'I'], 'V', [0, 0, platform.device.widthDp, platform.device.heightDp]); });
  // WindowManager.LayoutParams.setSurfaceInsets(view, manual, preservePrevious): room around the window's surface for the view's shadow, ceil(view.getZ() * 2) on every side
  // (never shrinking once non-zero).
  const bitsFloat = bits => { const data = new DataView(new ArrayBuffer(4)); data.setInt32(0, bits, true); return data.getFloat32(0, true); };
  def(WM_PARAMS, 'setSurfaceInsets', `(${VIEW}ZZ)V`, (r, _m, [self, view, manual, preserve]) => {
    const fields = r.object(self).fields, key = `${WM_PARAMS}->surfaceInsets:${RECT}`;
    let insets = fields.get(key) ?? null;
    if (insets === null || insets === 0) { insets = r.allocate(RECT); r.dispatch({ owner: RECT, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [insets], 'direct'); r.storeField(fields, key, insets); }
    const inset = Math.ceil(bitsFloat(call(r, view, VIEW, 'getZ', [], 'F')) * 2), read = side => r.object(insets).fields.get(`${RECT}->${side}:I`) ?? 0;
    call(r, insets, RECT, 'set', ['I', 'I', 'I', 'I'], 'V', inset === 0 ? [0, 0, 0, 0] : ['left', 'top', 'right', 'bottom'].map(side => Math.max(inset, read(side))));
    r.storeField(fields, `${WM_PARAMS}->hasManualSurfaceInsets:Z`, manual ? 1 : 0); r.storeField(fields, `${WM_PARAMS}->preservePreviousSurfaceInsets:Z`, preserve ? 1 : 0);
  });
  // View.getRawLayoutDirection (the direction as it was set, not the resolved one) is with the layout direction itself: src/view-xml-attributes.js
  // View.getAccessibilityViewId: a process-unique id, assigned on first use (View.sNextAccessibilityViewId).
  def(VIEW, 'getAccessibilityViewId', '()I', (r, _m, [self]) => r.object(self).accessibilityViewId ??= (r.nextAccessibilityViewId = (r.nextAccessibilityViewId ?? 0) + 1));
  // WindowOnBackInvokedDispatcher.isOnBackInvokedCallbackEnabled(context): android:enableOnBackInvokedCallback of the application (the same rule src/back-dispatcher-host.js applies to
  // a registration). PopupWindow's decor registers its dismiss-on-back callback only then; otherwise BACK reaches it as a key event.
  def('Landroid/window/WindowOnBackInvokedDispatcher;', 'isOnBackInvokedCallbackEnabled', '(Landroid/content/Context;)Z', () => { const value = (platform.manifest?.application ?? {}).enableOnBackInvokedCallback; return value === true || value === 'true' || value === 1 ? 1 : 0; }, { static: true });
  // android.view.ViewRootImpl as the ViewParent of a window root (View.getParent() of a root added through WindowManager.addView: a Dialog's or PopupWindow's decor, a plain
  // addView): the whole ViewParent interface with the bodies of ViewRootImpl.java (android-13.0.0_r1), so code that walks getParent() and calls a ViewParent method on what it finds
  // (nested-scroll dispatch, focus and accessibility walkers, requestDisallowInterceptTouchEvent loops) ends at the root as it does on a device. Where ViewRootImpl only schedules
  // a traversal the lab requests the root's layout or draw; the window does not pan, has no context menu or action mode of its own, and is in touch mode.
  // The root View of an Activity window keeps getParent() == null: it is the Activity's content view, whose parent on a device is the decor's content FrameLayout (a ViewGroup the
  // lab does not build), not a ViewRootImpl.
  const ROOT_IMPL = 'Landroid/view/ViewRootImpl;', PARENT = 'Landroid/view/ViewParent;', POINT = 'Landroid/graphics/Point;', GROUP = 'Landroid/view/ViewGroup;', FOCUS_FINDER = 'Landroid/view/FocusFinder;';
  const ACTION_MODE = 'Landroid/view/ActionMode;', ACTION_MODE_CALLBACK = 'Landroid/view/ActionMode$Callback;', A11Y_EVENT = 'Landroid/view/accessibility/AccessibilityEvent;';
  const rootViewOf = (r, self) => r.object(self).windowRootView ?? null;
  const nothing = (name, signature) => def(ROOT_IMPL, name, signature, () => {}), answer = (name, signature, value) => def(ROOT_IMPL, name, signature, () => value);
  const layoutRoot = (r, self) => { const root = rootViewOf(r, self); if (root) call(r, root, VIEW, 'requestLayout'); };
  const drawRoot = (r, self) => { const root = rootViewOf(r, self); if (root) platform.requestDraw(r, root); };
  answer('getParent', `()${PARENT}`, null);
  def(ROOT_IMPL, 'requestLayout', '()V', (r, _m, [self]) => layoutRoot(r, self));
  // isLayoutRequested: mLayoutRequested of this window; a ViewRootImpl reached without its window (View.getViewRootImpl of a View that is not a window root) answers for the device:
  // some root has a layout pass queued.
  def(ROOT_IMPL, 'isLayoutRequested', '()Z', (r, _m, [self]) => { const root = rootViewOf(r, self); return root ? call(r, root, VIEW, 'isLayoutRequested', [], 'Z') : platform.viewLayoutHost.state().pending ? 1 : 0; });
  def(ROOT_IMPL, 'requestTransparentRegion', `(${VIEW})V`, (r, _m, [self, child]) => { const root = rootViewOf(r, self); if (root && child && root.ref === child.ref) layoutRoot(r, self); });   // "if (mView == child) ... requestLayout()"
  def(ROOT_IMPL, 'onDescendantInvalidated', `(${VIEW}${VIEW})V`, (r, _m, [self]) => drawRoot(r, self));
  def(ROOT_IMPL, 'invalidateChild', `(${VIEW}${RECT})V`, (r, _m, [self]) => drawRoot(r, self));
  def(ROOT_IMPL, 'invalidateChildInParent', `([I${RECT})${PARENT}`, (r, _m, [self]) => { drawRoot(r, self); return null; });
  nothing('requestChildFocus', `(${VIEW}${VIEW})V`); nothing('clearChildFocus', `(${VIEW})V`); nothing('recomputeViewAttributes', `(${VIEW})V`);   // checkThread(); scheduleTraversals()
  // getChildVisibleRect: "child is not mine, honey!" for any other View; else the rectangle clipped to the window
  def(ROOT_IMPL, 'getChildVisibleRect', `(${VIEW}${RECT}${POINT})Z`, (r, _m, [self, child, rect]) => {
    const root = rootViewOf(r, self); if (!root || !child || root.ref !== child.ref) r.throwJava('Ljava/lang/RuntimeException;', 'child is not mine, honey!');
    return call(r, rect, RECT, 'intersect', ['I', 'I', 'I', 'I'], 'Z', [0, 0, call(r, root, VIEW, 'getWidth', [], 'I'), call(r, root, VIEW, 'getHeight', [], 'I')]);
  });
  // focusSearch / keyboardNavigationClusterSearch: FocusFinder over the root when it is a ViewGroup
  def(ROOT_IMPL, 'focusSearch', `(${VIEW}I)${VIEW}`, (r, _m, [self, focused, direction]) => {
    const root = rootViewOf(r, self); if (!root || !r.isSubtype(r.typeOf(root), GROUP)) return null;
    const finder = r.dispatch({ owner: FOCUS_FINDER, name: 'getInstance', parameters: [], result: FOCUS_FINDER, signature: `()${FOCUS_FINDER}` }, [], 'static');
    return call(r, finder, FOCUS_FINDER, 'findNextFocus', [GROUP, VIEW, 'I'], VIEW, [root, focused, direction]);
  });
  def(ROOT_IMPL, 'keyboardNavigationClusterSearch', `(${VIEW}I)${VIEW}`, (r, _m, [self, current, direction]) => {
    const root = rootViewOf(r, self); if (!root) return null;
    const finder = r.dispatch({ owner: FOCUS_FINDER, name: 'getInstance', parameters: [], result: FOCUS_FINDER, signature: `()${FOCUS_FINDER}` }, [], 'static');
    return call(r, finder, FOCUS_FINDER, 'findNextKeyboardNavigationCluster', [VIEW, VIEW, 'I'], VIEW, [root, current, direction]);
  });
  nothing('bringChildToFront', `(${VIEW})V`);
  nothing('focusableViewAvailable', `(${VIEW})V`);   // gives focus only outside touch mode; the virtual device is always in touch mode
  answer('showContextMenuForChild', `(${VIEW})Z`, 0); answer('showContextMenuForChild', `(${VIEW}FF)Z`, 0); nothing('createContextMenu', '(Landroid/view/ContextMenu;)V');
  answer('startActionModeForChild', `(${VIEW}${ACTION_MODE_CALLBACK})${ACTION_MODE}`, null); answer('startActionModeForChild', `(${VIEW}${ACTION_MODE_CALLBACK}I)${ACTION_MODE}`, null);
  nothing('childDrawableStateChanged', `(${VIEW})V`);
  nothing('requestDisallowInterceptTouchEvent', '(Z)V');   // "ViewAncestor never intercepts touch event, so this can be a no-op"
  answer('requestChildRectangleOnScreen', `(${VIEW}${RECT}Z)Z`, 0);   // scrollToRectOrFocus: the window is never panned
  // requestSendAccessibilityEvent: true while the window has its root (the event goes to AccessibilityManager, which is disabled in the virtual device)
  def(ROOT_IMPL, 'requestSendAccessibilityEvent', `(${VIEW}${A11Y_EVENT})Z`, (r, _m, [self]) => rootViewOf(r, self) ? 1 : 0);
  nothing('childHasTransientStateChanged', `(${VIEW}Z)V`);
  def(ROOT_IMPL, 'requestFitSystemWindows', '()V', (r, _m, [self]) => layoutRoot(r, self));   // mApplyInsetsRequested; scheduleTraversals()
  answer('getParentForAccessibility', `()${PARENT}`, null);
  nothing('notifySubtreeAccessibilityStateChanged', `(${VIEW}${VIEW}I)V`);
  answer('canResolveLayoutDirection', '()Z', 1); answer('isLayoutDirectionResolved', '()Z', 1); answer('getLayoutDirection', '()I', 0);   // View.LAYOUT_DIRECTION_RESOLVED_DEFAULT (LTR)
  answer('canResolveTextDirection', '()Z', 1); answer('isTextDirectionResolved', '()Z', 1); answer('getTextDirection', '()I', 1);          // View.TEXT_DIRECTION_RESOLVED_DEFAULT (FIRST_STRONG)
  answer('canResolveTextAlignment', '()Z', 1); answer('isTextAlignmentResolved', '()Z', 1); answer('getTextAlignment', '()I', 1);          // View.TEXT_ALIGNMENT_RESOLVED_DEFAULT (GRAVITY)
  answer('onStartNestedScroll', `(${VIEW}${VIEW}I)Z`, 0); nothing('onNestedScrollAccepted', `(${VIEW}${VIEW}I)V`); nothing('onStopNestedScroll', `(${VIEW})V`);
  nothing('onNestedScroll', `(${VIEW}IIII)V`); nothing('onNestedPreScroll', `(${VIEW}II[I)V`);
  answer('onNestedFling', `(${VIEW}FFZ)Z`, 0); answer('onNestedPreFling', `(${VIEW}FF)Z`, 0); answer('onNestedPrePerformAccessibilityAction', `(${VIEW}ILandroid/os/Bundle;)Z`, 0);
  nothing('onDescendantUnbufferedRequested', '()V');
}
