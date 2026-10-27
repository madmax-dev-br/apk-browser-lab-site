import { createHostRegistry } from './host-contract.js?v=d50f2f368405';
import { APKError } from './apk-error.js?v=d50f2f368405';

// android.view.ViewGroup public API (API 33) that the platform ViewGroup model (child array, add/remove, clip flags, focus, nested scrolling) did not carry, with the semantics of
// android-13.0.0_r1 ViewGroup.java: the group flags (states from children, drawing-cache flags, motion-event splitting, children drawing order, static transformations,
// touchscreen-blocks-focus, transition group), layout mode, layout suppression, layout animation (LayoutAnimationController, original), disappearing children and
// start/endViewTransition, layout-params conversion, rect offsetting between a descendant and the group, and the hooks apps override (onRequestFocusInDescendants,
// onRequestSendAccessibilityEvent, onInterceptHoverEvent, getChildDrawingOrder, getChildStaticTransformation, shouldDelayChildPressedState).
// Not available in the virtual device and failing explicitly: ViewGroup.getOverlay (ViewGroupOverlay is not in the framework build), LayoutTransition (android.animation.LayoutTransition is
// not in the framework build) and LAYOUT_MODE_OPTICAL_BOUNDS (the optical-insets pass of measure/layout).
const GROUP = 'Landroid/view/ViewGroup;', VIEW = 'Landroid/view/View;', LP = 'Landroid/view/ViewGroup$LayoutParams;', RECT = 'Landroid/graphics/Rect;', MOTION = 'Landroid/view/MotionEvent;';
const CONTROLLER = 'Landroid/view/animation/LayoutAnimationController;', ANIMATION = 'Landroid/view/animation/Animation;', LISTENER = 'Landroid/view/animation/Animation$AnimationListener;';
const TRANSFORMATION = 'Landroid/view/animation/Transformation;', A11Y_EVENT = 'Landroid/view/accessibility/AccessibilityEvent;', DELEGATE = 'Landroid/view/View$AccessibilityDelegate;';
const PARAMS = 'Landroid/view/animation/LayoutAnimationController$AnimationParameters;';
const nullish = v => v === null || v === undefined || v === 0;
const flag = v => v === true || v === 1 || v === 0xffffffff || v === -1;
const same = (a, b) => !nullish(a) && !nullish(b) && (a === b || a.ref === b.ref);

export function createViewGroupApiHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const direct = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'direct');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters = [], args = []) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };
  const targetSdk = () => Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 24);
  const st = (r, self) => r.object(self).vg ??= {
    addStates: false, animationCache: true, alwaysDrawnWithCache: true, childrenDrawnWithCache: false, persistentCache: 2, split: targetSdk() >= 11, drawingOrder: false,
    staticTransforms: false, layoutMode: -1, transitionGroupSet: false, transitionGroup: false, suppressed: false, calledWhileSuppressed: false,
    controller: null, animationListener: null, runAnimation: false, animationDone: true, notifyPending: false, transitioning: [], disappearing: [] };
  const redraw = (r, self) => platform.requestDraw?.(r, self);
  const childrenOf = (r, self) => [...(r.object(self).children ?? [])];
  const isGroup = (r, ref) => !nullish(ref) && typeof ref === 'object' && r.isSubtype(r.object(ref).type, GROUP);
  const boolean = (name, key, { after } = {}) => {
    const cap = name[0].toUpperCase() + name.slice(1);
    def(GROUP, `is${cap}`, '()Z', (r, _m, [self]) => st(r, self)[key] ? 1 : 0);
    def(GROUP, `set${cap}`, '(Z)V', (r, _m, [self, on]) => { st(r, self)[key] = flag(on); after?.(r, self); });
  };

  // ---- group flags ----------------------------------------------------------------------------------------------------------------------------------
  def(GROUP, 'addStatesFromChildren', '()Z', (r, _m, [self]) => st(r, self).addStates ? 1 : 0);
  def(GROUP, 'setAddStatesFromChildren', '(Z)V', (r, _m, [self, on]) => { st(r, self).addStates = flag(on); call(r, self, VIEW, 'refreshDrawableState'); });
  // ViewGroup.onCreateDrawableState / childDrawableStateChanged: a group that adds states from children merges every child's drawable state into its own
  def(GROUP, 'onCreateDrawableState', '(I)[I', (r, _m, [self, extra]) => {
    const kids = childrenOf(r, self);
    if (!st(r, self).addStates) return direct(r, self, VIEW, 'onCreateDrawableState', ['I'], '[I', [extra]);
    const states = kids.map(child => call(r, child, VIEW, 'getDrawableState', [], '[I')).filter(s => !nullish(s));
    const need = states.reduce((sum, s) => sum + r.array(s).elements.length, 0);
    let state = direct(r, self, VIEW, 'onCreateDrawableState', ['I'], '[I', [extra + need]);
    for (const child of states) state = call(r, self, VIEW, 'mergeDrawableStates', ['[I', '[I'], '[I', [state, child]);
    return state;
  });
  def(GROUP, 'childDrawableStateChanged', `(${VIEW})V`, (r, _m, [self]) => { if (st(r, self).addStates) call(r, self, VIEW, 'refreshDrawableState'); });
  boolean('animationCacheEnabled', 'animationCache');
  boolean('alwaysDrawnWithCacheEnabled', 'alwaysDrawnWithCache', { after: redraw });
  boolean('childrenDrawnWithCacheEnabled', 'childrenDrawnWithCache', { after: redraw });
  def(GROUP, 'setChildrenDrawingCacheEnabled', '(Z)V', (r, _m, [self, enabled]) => {
    if (flag(enabled) || (st(r, self).persistentCache & 3) !== 3) for (const child of childrenOf(r, self)) call(r, child, VIEW, 'setDrawingCacheEnabled', ['Z'], 'V', [enabled]);
  });
  def(GROUP, 'getPersistentDrawingCache', '()I', (r, _m, [self]) => st(r, self).persistentCache);
  def(GROUP, 'setPersistentDrawingCache', '(I)V', (r, _m, [self, mode]) => { st(r, self).persistentCache = mode & 3; });
  boolean('motionEventSplittingEnabled', 'split');
  def(GROUP, 'isChildrenDrawingOrderEnabled', '()Z', (r, _m, [self]) => st(r, self).drawingOrder ? 1 : 0);
  def(GROUP, 'setChildrenDrawingOrderEnabled', '(Z)V', (r, _m, [self, on]) => { const s = st(r, self); if (s.drawingOrder !== flag(on)) { s.drawingOrder = flag(on); redraw(r, self); } });
  def(GROUP, 'getChildDrawingOrder', '(II)I', (r, _m, [, , i]) => i);
  def(GROUP, 'getChildDrawingOrder', '(I)I', (r, _m, [self, i]) => call(r, self, GROUP, 'getChildDrawingOrder', ['I', 'I'], 'I', [r.object(self).children?.length ?? 0, i]));
  def(GROUP, 'setStaticTransformationsEnabled', '(Z)V', (r, _m, [self, on]) => { st(r, self).staticTransforms = flag(on); redraw(r, self); });
  def(GROUP, 'getChildStaticTransformation', `(${VIEW}${TRANSFORMATION})Z`, () => 0);
  def(GROUP, 'getTouchscreenBlocksFocus', '()Z', (r, _m, [self]) => r.object(self).touchscreenBlocksFocus ? 1 : 0);
  def(GROUP, 'setTouchscreenBlocksFocus', '(Z)V', (r, _m, [self, on]) => { r.object(self).touchscreenBlocksFocus = flag(on); });
  def(GROUP, 'isTransitionGroup', '()Z', (r, _m, [self]) => {
    const s = st(r, self); if (s.transitionGroupSet) return s.transitionGroup ? 1 : 0;
    const view = r.object(self); return !nullish(view.backgroundDrawable) || (view.background !== undefined && view.background !== null) || !nullish(call(r, self, VIEW, 'getTransitionName', [], 'Ljava/lang/String;')) ? 1 : 0;
  });
  def(GROUP, 'setTransitionGroup', '(Z)V', (r, _m, [self, on]) => { const s = st(r, self); s.transitionGroupSet = true; s.transitionGroup = flag(on); });
  def(GROUP, 'shouldDelayChildPressedState', '()Z', () => 1);
  def(VIEW, 'shouldDelayChildPressedState', '()Z', () => 1);   // the compile-only View of the layouts profile declares it (ViewGroup's method, called from ScrollView-like subclasses); resolution lands on the declaring class

  // ---- layout mode / suppression ---------------------------------------------------------------------------------------------------------------------
  def(GROUP, 'getLayoutMode', '()I', (r, _m, [self]) => {
    const s = st(r, self); if (s.layoutMode !== -1) return s.layoutMode;
    const parent = r.object(self).parent; return isGroup(r, parent) ? call(r, parent, GROUP, 'getLayoutMode', [], 'I') : 0;   // LAYOUT_MODE_CLIP_BOUNDS
  });
  def(GROUP, 'setLayoutMode', '(I)V', (r, _m, [self, mode]) => {
    if (mode === 1) unsupported('ViewGroup.setLayoutMode(LAYOUT_MODE_OPTICAL_BOUNDS) needs the optical-insets pass of measure/layout, which the lab does not run', 'optical-bounds-unsupported');
    if (mode !== -1 && mode !== 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid layout mode ${mode}`);
    const s = st(r, self); if (s.layoutMode !== mode) { s.layoutMode = mode; call(r, self, VIEW, 'requestLayout'); }
  });
  def(GROUP, 'isLayoutSuppressed', '()Z', (r, _m, [self]) => st(r, self).suppressed ? 1 : 0);
  def(GROUP, 'suppressLayout', '(Z)V', (r, _m, [self, suppress]) => {
    const s = st(r, self); s.suppressed = flag(suppress);
    if (!s.suppressed && s.calledWhileSuppressed) { call(r, self, VIEW, 'requestLayout'); s.calledWhileSuppressed = false; }
  });
  /** ViewGroup.layout while suppressed only records that a layout was asked for; the layout host consults this before laying a group out. */
  registry.layoutSuppressed = (r, self) => { const s = r.object(self).vg; if (s?.suppressed) { s.calledWhileSuppressed = true; return true; } return false; };
  def(GROUP, 'cleanupLayoutState', `(${VIEW})V`, (r, _m, [, child]) => { r.object(child).layoutRequested = false; });   // clears PFLAG_FORCE_LAYOUT
  def(GROUP, 'setLayoutTransition', '(Landroid/animation/LayoutTransition;)V', (r, _m, [self, transition]) => {
    if (nullish(transition)) { r.object(self).fields.delete(`${GROUP}->mTransition:Landroid/animation/LayoutTransition;`); return; }
    unsupported('ViewGroup.setLayoutTransition needs android.animation.LayoutTransition, which is not part of the framework build yet', 'layout-transition-unsupported');
  });
  def(GROUP, 'getOverlay', '()Landroid/view/ViewGroupOverlay;', () => unsupported('ViewGroup.getOverlay needs ViewOverlay / ViewGroupOverlay, which are not part of the framework build', 'view-overlay-unsupported'));

  // ---- layout params conversion (addView calls these) ------------------------------------------------------------------------------------------------
  def(GROUP, 'checkLayoutParams', `(${LP})Z`, (r, _m, [, params]) => nullish(params) ? 0 : 1);
  def(GROUP, 'generateLayoutParams', `(${LP})${LP}`, (r, _m, [, params]) => params);
  def(GROUP, 'addView', `(${VIEW}II)V`, (r, _m, [self, child, width, height]) => {
    const params = call(r, self, GROUP, 'generateDefaultLayoutParams', [], LP);
    if (nullish(params)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'generateDefaultLayoutParams() cannot return null');
    r.storeField(r.object(params).fields, `${LP}->width:I`, width); r.storeField(r.object(params).fields, `${LP}->height:I`, height);
    call(r, self, GROUP, 'addView', [VIEW, 'I', LP], 'V', [child, -1, params]);
  });

  // ---- rect offsetting ------------------------------------------------------------------------------------------------------------------------------
  const offsetBetween = (r, self, descendant, rect, toParent) => {
    if (same(descendant, self)) return;
    const geometry = view => ({ left: call(r, view, VIEW, 'getLeft', [], 'I'), top: call(r, view, VIEW, 'getTop', [], 'I'), sx: call(r, view, VIEW, 'getScrollX', [], 'I'), sy: call(r, view, VIEW, 'getScrollY', [], 'I') });
    const shift = view => { const g = geometry(view), dx = toParent ? g.left - g.sx : g.sx - g.left, dy = toParent ? g.top - g.sy : g.sy - g.top; call(r, rect, RECT, 'offset', ['I', 'I'], 'V', [dx, dy]); };
    let view = descendant, parent = r.object(view).parent;
    while (!nullish(parent) && r.isSubtype(r.object(parent).type, VIEW) && !same(parent, self)) { shift(view); view = parent; parent = r.object(view).parent; }
    if (same(parent, self)) shift(view); else r.throwJava('Ljava/lang/IllegalArgumentException;', 'parameter must be a descendant of this view');
  };
  def(GROUP, 'offsetDescendantRectToMyCoords', `(${VIEW}${RECT})V`, (r, _m, [self, descendant, rect]) => offsetBetween(r, self, descendant, rect, true));
  def(GROUP, 'offsetRectIntoDescendantCoords', `(${VIEW}${RECT})V`, (r, _m, [self, descendant, rect]) => offsetBetween(r, self, descendant, rect, false));

  // ---- hooks apps override ---------------------------------------------------------------------------------------------------------------------------
  def(GROUP, 'onRequestFocusInDescendants', `(I${RECT})Z`, (r, _m, [self, direction, rect]) => {
    const kids = childrenOf(r, self), forward = (direction & 2) !== 0;
    for (const child of forward ? kids : kids.reverse()) if ((r.object(child).visibility ?? 0) === 0 && flag(call(r, child, VIEW, 'requestFocus', ['I', RECT], 'Z', [direction, rect]))) return 1;
    return 0;
  });
  def(GROUP, 'onRequestSendAccessibilityEvent', `(${VIEW}${A11Y_EVENT})Z`, (r, _m, [self, child, event]) => {
    const delegate = r.object(self).fields.get(`${VIEW}->mAccessibilityDelegate:${DELEGATE}`);
    return nullish(delegate) ? 1 : call(r, delegate, DELEGATE, 'onRequestSendAccessibilityEvent', [GROUP, VIEW, A11Y_EVENT], 'Z', [self, child, event]);
  });
  def(GROUP, 'onInterceptHoverEvent', `(${MOTION})Z`, () => 0);   // ViewGroup only intercepts a mouse hover over its own scroll bar thumb; the lab draws no scroll bars
  def(GROUP, 'debug', '(I)V', (r, _m, [self, depth]) => {
    direct(r, self, VIEW, 'debug', ['I'], 'V', [depth]);
    const log = text => callStatic(r, 'Landroid/util/Log;', 'd', ['Ljava/lang/String;', 'Ljava/lang/String;'], 'I', ['View', text]);
    const indent = d => '  '.repeat(d * 2 + 3), kids = childrenOf(r, self), focused = call(r, self, GROUP, 'getFocusedChild', [], VIEW);
    if (!nullish(focused)) log(indent(depth) + 'mFocused');
    if (kids.length) log(indent(depth) + '{');
    for (const child of kids) call(r, child, VIEW, 'debug', ['I'], 'V', [depth + 1]);
    if (kids.length) log(indent(depth) + '}');
  });

  // ---- removal range without a layout request ---------------------------------------------------------------------------------------------------------
  def(GROUP, 'removeViewsInLayout', '(II)V', (r, _m, [self, start, count]) => {
    const kids = childrenOf(r, self);
    if (start < 0 || count < 0 || start + count > kids.length) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'Invalid ViewGroup child range');
    for (const child of kids.slice(start, start + count)) platform.invoke(r, { owner: GROUP, name: 'removeViewInLayout' }, [self, child]);
  });

  // ---- layout animation (LayoutAnimationController is the original; the group binds an Animation to every child on the first draw after startLayoutAnimation) --------------
  def(GROUP, 'setLayoutAnimation', `(${CONTROLLER})V`, (r, _m, [self, controller]) => { const s = st(r, self); s.controller = nullish(controller) ? null : controller; if (s.controller) s.runAnimation = true; });
  def(GROUP, 'getLayoutAnimation', `()${CONTROLLER}`, (r, _m, [self]) => st(r, self).controller);
  def(GROUP, 'canAnimate', '()Z', (r, _m, [self]) => st(r, self).controller ? 1 : 0);
  def(GROUP, 'scheduleLayoutAnimation', '()V', (r, _m, [self]) => { st(r, self).runAnimation = true; });
  def(GROUP, 'startLayoutAnimation', '()V', (r, _m, [self]) => { const s = st(r, self); if (s.controller) { s.runAnimation = true; call(r, self, VIEW, 'requestLayout'); } });
  def(GROUP, 'setLayoutAnimationListener', `(${LISTENER})V`, (r, _m, [self, listener]) => { st(r, self).animationListener = nullish(listener) ? null : listener; });
  def(GROUP, 'getLayoutAnimationListener', `()${LISTENER}`, (r, _m, [self]) => st(r, self).animationListener);
  def(GROUP, 'attachLayoutAnimationParameters', `(${VIEW}${LP}II)V`, (r, _m, [, , params, index, count]) => {
    const fields = r.object(params).fields, key = `${LP}->layoutAnimationParameters:${PARAMS}`;
    let animationParams = fields.get(key); if (nullish(animationParams)) { animationParams = construct(r, PARAMS); r.storeField(fields, key, animationParams); }
    r.storeField(r.object(animationParams).fields, `${PARAMS}->count:I`, count); r.storeField(r.object(animationParams).fields, `${PARAMS}->index:I`, index);
  });
  /** The first draw after startLayoutAnimation: bind each visible child's Animation, start the controller, tell the listener (ViewGroup.dispatchDraw). */
  registry.beforeDispatchDraw = (r, self) => {
    const s = st(r, self); s.more = false;
    if (!s.runAnimation || !s.controller) return;
    const kids = childrenOf(r, self), count = kids.length;
    kids.forEach((child, i) => {
      if ((r.object(child).visibility ?? 0) !== 0) return;
      let params = r.object(child).layoutParams;
      if (nullish(params)) return;
      call(r, self, GROUP, 'attachLayoutAnimationParameters', [VIEW, LP, 'I', 'I'], 'V', [child, params, i, count]);
      call(r, child, VIEW, 'setAnimation', [ANIMATION], 'V', [call(r, s.controller, CONTROLLER, 'getAnimationForView', [VIEW], ANIMATION, [child])]);
    });
    call(r, s.controller, CONTROLLER, 'start');
    s.runAnimation = false; s.animationDone = false;
    if (!nullish(s.animationListener)) call(r, s.animationListener, LISTENER, 'onAnimationStart', [ANIMATION], 'V', [call(r, s.controller, CONTROLLER, 'getAnimation', [], ANIMATION)]);
  };
  registry.afterDispatchDraw = (r, self) => {
    const s = r.object(self).vg; if (!s?.controller || s.animationDone || s.notifyPending) return;
    if (!flag(call(r, s.controller, CONTROLLER, 'isDone', [], 'Z')) || s.more) return;
    s.notifyPending = true;
    platform.queueTask(() => {   // after the next frame: the animation listener hears onAnimationEnd
      s.notifyPending = false; s.animationDone = true;
      if (!nullish(s.animationListener)) call(r, s.animationListener, LISTENER, 'onAnimationEnd', [ANIMATION], 'V', [call(r, s.controller, CONTROLLER, 'getAnimation', [], ANIMATION)]);
      redraw(r, self);
    }, 0, [self]);
  };
  registry.noteMoreAnimation = (r, self) => { const s = r.object(self).vg; if (s) s.more = true; };

  // ---- drawing order, static transformations, disappearing children ----------------------------------------------------------------------------------------
  /** The children in drawing order: the natural order, or getChildDrawingOrder(count, i) when the subclass enabled custom order (ViewGroup.getAndVerifyPreorderedIndex). */
  registry.drawOrder = (r, self) => {
    const kids = childrenOf(r, self), s = r.object(self).vg; if (!s?.drawingOrder) return kids;
    return kids.map((_, i) => {
      const index = call(r, self, GROUP, 'getChildDrawingOrder', ['I', 'I'], 'I', [kids.length, i]);
      if (index >= kids.length) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', `getChildDrawingOrder() returned invalid index ${index} (child count is ${kids.length})`);
      return kids[index];
    });
  };
  registry.disappearing = (r, self) => [...(r.object(self).vg?.disappearing ?? [])];
  /** View.draw(Canvas, ViewGroup, long): a child without an Animation still gets the parent's static transformation when the group asked for them. */
  registry.staticTransformation = (r, parentRef, childRef) => {
    const s = r.object(parentRef).vg; if (!s?.staticTransforms) return null;
    const group = r.object(parentRef), t = group.childTransformation ??= construct(r, TRANSFORMATION);
    call(r, t, TRANSFORMATION, 'clear');
    if (!flag(call(r, parentRef, GROUP, 'getChildStaticTransformation', [VIEW, TRANSFORMATION], 'Z', [childRef, t]))) return null;
    const type = call(r, t, TRANSFORMATION, 'getTransformationType', [], 'I');
    if (type === 0) return null;
    const bits = new DataView(new ArrayBuffer(4));
    return { matrix: (type & 2) !== 0 ? call(r, t, TRANSFORMATION, 'getMatrix', [], 'Landroid/graphics/Matrix;') : null,
      alpha: (type & 1) !== 0 ? (bits.setInt32(0, call(r, t, TRANSFORMATION, 'getAlpha', [], 'F') | 0, true), bits.getFloat32(0, true)) : 1 };
  };
  /** ViewGroup.removeViewInternal: a child with a running Animation, or one inside a view transition, stays attached and drawn (as a disappearing child) until it finishes. */
  registry.keepsDisappearing = (r, self, child) => {
    const s = st(r, self);
    return !nullish(r.object(child).currentAnimation) || s.transitioning.some(v => same(v, child));
  };
  registry.addDisappearing = (r, self, child) => {
    const s = st(r, self); if (!s.disappearing.some(v => same(v, child))) s.disappearing.push(child);
    redraw(r, self);
  };
  const detach = (r, child) => { if (r.object(child).attached) platform.attachTree(r, child, false); };
  /** ViewGroup.finishAnimatingView: the Animation of a disappearing child is over. */
  registry.finishAnimatingView = (r, self, child) => {
    const s = r.object(self).vg; if (!s) return;
    const at = s.disappearing.findIndex(v => same(v, child)); if (at < 0) return;
    s.disappearing.splice(at, 1); detach(r, child); call(r, child, VIEW, 'clearAnimation'); redraw(r, self);
  };
  def(GROUP, 'startViewTransition', `(${VIEW})V`, (r, _m, [self, view]) => { if (same(r.object(view).parent, self)) st(r, self).transitioning.push(view); });
  def(GROUP, 'endViewTransition', `(${VIEW})V`, (r, _m, [self, view]) => {
    const s = st(r, self), at = s.transitioning.findIndex(v => same(v, view)); if (at >= 0) s.transitioning.splice(at, 1);
    const gone = s.disappearing.findIndex(v => same(v, view));
    if (gone >= 0) { s.disappearing.splice(gone, 1); detach(r, view); if (!nullish(r.object(view).parent)) r.object(view).parent = null; redraw(r, self); }
  });
  def(GROUP, 'clearDisappearingChildren', '()V', (r, _m, [self]) => {
    const s = st(r, self); for (const child of s.disappearing.splice(0)) { detach(r, child); call(r, child, VIEW, 'clearAnimation'); }
    redraw(r, self);
  });
  return registry;
}
