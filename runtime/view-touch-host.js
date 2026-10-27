import { createHostRegistry, bitsFloat, floatBits } from './host-contract.js?v=eb9e6b7c0103';

// The classic View touch pipeline: View.dispatchTouchEvent / onTouchEvent, ViewGroup.dispatchTouchEvent / onInterceptTouchEvent / requestDisallowInterceptTouchEvent and
// View.setOnTouchListener, following android-13.0.0_r1 View.java and ViewGroup.java for a single pointer (the browser delivers one pointer per gesture). A real MotionEvent
// reaches a classic View from a Compose AndroidView (AndroidViewHolder.dispatchTouchEvent), from an app's own dispatch code, or from a host that injects pointer events.
// Not modelled: long-press detection (CheckForLongPress), multi-touch target splitting, hover/generic motion, the scrolling-container tap delay and TouchDelegate.
const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', MOTION = 'Landroid/view/MotionEvent;', LISTENER = 'Landroid/view/View$OnTouchListener;';
const DOWN = 0, UP = 1, MOVE = 2, CANCEL = 3;

export function createViewTouchHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const event = (r, ev, name, result = 'I', parameters = [], args = []) => call(r, ev, MOTION, name, parameters, result, args);
  const flag = value => value === true || value === 1 || value === 0xffffffff || value === -1;
  const state = (r, ref) => r.object(ref).touch ??= { target: null, disallow: false };
  const visible = (r, ref) => (r.object(ref).visibility ?? 0) === 0;
  const num = (r, ref, name) => bitsFloat(call(r, ref, VIEW, name, [], 'F'));

  /** View.pointInView through the child's transform: the point in the child's coordinates, or null when it misses (ViewGroup.isTransformedTouchPointInView). */
  const childPoint = (r, parent, child, x, y) => {
    const view = r.object(child), bounds = view.bounds ?? { left: 0, top: 0, right: Infinity, bottom: Infinity };   // window-level frames (decor, content parent) carry no bounds: they fill their parent
    const scrollX = r.object(parent).fields.get(`${VIEW}->mScrollX:I`) ?? 0, scrollY = r.object(parent).fields.get(`${VIEW}->mScrollY:I`) ?? 0;
    let px = x + scrollX - bounds.left, py = y + scrollY - bounds.top;
    const tx = num(r, child, 'getTranslationX'), ty = num(r, child, 'getTranslationY'), sx = num(r, child, 'getScaleX'), sy = num(r, child, 'getScaleY'), rotation = num(r, child, 'getRotation');
    if (tx || ty || sx !== 1 || sy !== 1 || rotation) {
      // View.getMatrix(): translate(-pivot), scale, rotate, translate(pivot + translation); the touch point maps through its inverse.
      const pivotX = num(r, child, 'getPivotX'), pivotY = num(r, child, 'getPivotY');
      px -= tx + pivotX; py -= ty + pivotY;
      if (rotation) { const a = -rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); [px, py] = [px * c - py * s, px * s + py * c]; }
      if (sx === 0 || sy === 0) return null;
      px = px / sx + pivotX; py = py / sy + pivotY;
    }
    const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
    return px >= 0 && py >= 0 && px < width && py < height ? { x: px, y: py } : null;
  };
  const orderedChildren = (r, group) => {
    const children = [...(r.object(group).children ?? [])];
    const z = child => num(r, child, 'getElevation') + num(r, child, 'getTranslationZ');
    const keyed = children.map((child, index) => ({ child, index, z: z(child) })); if (keyed.some(item => item.z !== 0)) keyed.sort((a, b) => a.z - b.z || a.index - b.index);   // buildOrderedChildList: stable by Z
    return keyed.map(item => item.child).reverse();
  };

  // ---- View
  def(VIEW, 'setOnTouchListener', `(${LISTENER})V`, (r, _m, [self, listener]) => { r.object(self).touchListener = listener ?? null; });
  // View.performClick: the OnClickListener of the host View model (a CompoundButton toggles first); true when a listener ran.
  def(VIEW, 'performClick', '()Z', (r, _m, [self]) => {
    if (platform.performClick(r, self) === true) return 1;
    const listener = r.object(self).listener; if (listener === null || listener === undefined || listener === 0) return 0;
    r.dispatch({ owner: r.object(listener).type, name: 'onClick', parameters: [VIEW], result: 'V', signature: `(${VIEW})V` }, [listener, self], 'virtual'); return 1;
  });
  // System gesture exclusion (View.setSystemGestureExclusionRects): the rects are kept per View and read back; the web window has no system back gesture to exclude from.
  def(VIEW, 'setSystemGestureExclusionRects', '(Ljava/util/List;)V', (r, _m, [self, rects]) => { if (rects === null || rects === 0) r.throwJava('Ljava/lang/NullPointerException;', null); r.object(self).gestureExclusionRects = rects; });
  def(VIEW, 'getSystemGestureExclusionRects', '()Ljava/util/List;', (r, _m, [self]) => {
    const kept = r.object(self).gestureExclusionRects; if (kept) return kept;
    return r.dispatch({ owner: 'Ljava/util/Collections;', name: 'emptyList', parameters: [], result: 'Ljava/util/List;', signature: '()Ljava/util/List;' }, [], 'static');
  });
  // Haptic feedback: View asks the window session, which asks the system vibrator; the virtual device has no vibrator motor (src/hardware-services-host.js), so nothing is performed.
  def(VIEW, 'setHapticFeedbackEnabled', '(Z)V', (r, _m, [self, enabled]) => { r.object(self).hapticFeedbackDisabled = !flag(enabled); });
  def(VIEW, 'isHapticFeedbackEnabled', '()Z', (r, _m, [self]) => r.object(self).hapticFeedbackDisabled ? 0 : 1);
  def(VIEW, 'performHapticFeedback', '(I)Z', () => 0);
  def(VIEW, 'performHapticFeedback', '(II)Z', () => 0);
  def(VIEW, 'onFilterTouchEventForSecurity', `(${MOTION})Z`, () => 1);
  const viewDispatch = (r, self, ev) => {
    let handled = false;
    const view = r.object(self), listener = view.touchListener;
    if (flag(call(r, self, VIEW, 'onFilterTouchEventForSecurity', [MOTION], 'Z', [ev]))) {
      if (listener && view.enabled !== false && flag(call(r, listener, LISTENER, 'onTouch', [VIEW, MOTION], 'Z', [self, ev]))) handled = true;
      if (!handled && flag(call(r, self, VIEW, 'onTouchEvent', [MOTION], 'Z', [ev]))) handled = true;
    }
    return handled;
  };
  def(VIEW, 'dispatchTouchEvent', `(${MOTION})Z`, (r, _m, [self, ev]) => viewDispatch(r, self, ev) ? 1 : 0);
  def(VIEW, 'onTouchEvent', `(${MOTION})Z`, (r, _m, [self, ev]) => {
    const view = r.object(self), action = event(r, ev, 'getAction');
    const clickable = flag(call(r, self, VIEW, 'isClickable', [], 'Z')) || flag(call(r, self, VIEW, 'isLongClickable', [], 'Z'));
    const pressed = () => flag(call(r, self, VIEW, 'isPressed', [], 'Z')), setPressed = value => call(r, self, VIEW, 'setPressed', ['Z'], 'V', [value ? 1 : 0]);
    if (view.enabled === false) { if (action === UP && pressed()) setPressed(false); return clickable ? 1 : 0; }
    if (!clickable) return 0;
    switch (action) {
      case DOWN: setPressed(true); view.touchWasPressed = true; break;
      case UP: {
        if (pressed() || view.touchWasPressed) {
          let focusTaken = false;
          if (flag(call(r, self, VIEW, 'isFocusable', [], 'Z')) && flag(call(r, self, VIEW, 'isFocusableInTouchMode', [], 'Z')) && !flag(call(r, self, VIEW, 'isFocused', [], 'Z'))) focusTaken = flag(call(r, self, VIEW, 'requestFocus', [], 'Z'));
          if (!focusTaken) call(r, self, VIEW, 'performClick', [], 'Z');
          setPressed(false);
        }
        view.touchWasPressed = false; break;
      }
      case CANCEL: setPressed(false); view.touchWasPressed = false; break;
      case MOVE: {
        const x = bitsFloat(event(r, ev, 'getX', 'F')), y = bitsFloat(event(r, ev, 'getY', 'F')), b = view.bounds;
        if (b && (x < 0 || y < 0 || x >= b.right - b.left || y >= b.bottom - b.top) && pressed()) { setPressed(false); view.touchWasPressed = false; }
        break;
      }
      default: break;
    }
    return 1;
  });

  // ---- ViewGroup
  def(GROUP, 'onInterceptTouchEvent', `(${MOTION})Z`, () => 0);
  def(GROUP, 'requestDisallowInterceptTouchEvent', '(Z)V', (r, _m, [self, disallow]) => {
    const touch = state(r, self), value = flag(disallow);
    if (touch.disallow === value) return; touch.disallow = value;
    const parent = r.object(self).parent; if (parent) call(r, parent, GROUP, 'requestDisallowInterceptTouchEvent', ['Z'], 'V', [disallow]);
  });
  const dispatchTransformed = (r, group, ev, cancel, child) => {
    const oldAction = event(r, ev, 'getAction');
    if (cancel || oldAction === CANCEL) {
      event(r, ev, 'setAction', 'V', ['I'], [CANCEL]);
      const handled = child === null ? viewDispatch(r, group, ev) : flag(call(r, child, VIEW, 'dispatchTouchEvent', [MOTION], 'Z', [ev]));
      event(r, ev, 'setAction', 'V', ['I'], [oldAction]); return handled;
    }
    if (child === null) return viewDispatch(r, group, ev);                  // super.dispatchTouchEvent: the group's own listener / onTouchEvent
    // The event as the child sees it: translated by the child's position and scroll, through the inverse of its transform when it has one.
    const x = bitsFloat(event(r, ev, 'getX', 'F')), y = bitsFloat(event(r, ev, 'getY', 'F')), point = childPoint(r, group, child, x, y) ?? { x, y };
    const dx = point.x - x, dy = point.y - y;
    event(r, ev, 'offsetLocation', 'V', ['F', 'F'], [floatBits(dx), floatBits(dy)]);
    try { return flag(call(r, child, VIEW, 'dispatchTouchEvent', [MOTION], 'Z', [ev])); }
    finally { event(r, ev, 'offsetLocation', 'V', ['F', 'F'], [floatBits(-dx), floatBits(-dy)]); }
  };
  def(GROUP, 'dispatchTouchEvent', `(${MOTION})Z`, (r, _m, [self, ev]) => {
    if (event(r, ev, 'getPointerCount') > 1) r.throwJava('Ljava/lang/UnsupportedOperationException;', 'Multi-touch dispatch is not supported by the browser VM');
    const touch = state(r, self), action = event(r, ev, 'getAction'), masked = action & 0xff;
    let handled = false;
    if (masked === DOWN) { if (touch.target !== null) dispatchTransformed(r, self, ev, true, touch.target); touch.target = null; touch.disallow = false; }   // cancelAndClearTouchTargets + resetTouchState
    let intercepted;
    if (masked === DOWN || touch.target !== null) {
      if (!touch.disallow) { intercepted = flag(call(r, self, GROUP, 'onInterceptTouchEvent', [MOTION], 'Z', [ev])); event(r, ev, 'setAction', 'V', ['I'], [action]); }
      else intercepted = false;
    } else intercepted = true;
    const canceled = masked === CANCEL;
    if (!canceled && !intercepted && masked === DOWN) {
      const x = bitsFloat(event(r, ev, 'getX', 'F')), y = bitsFloat(event(r, ev, 'getY', 'F'));
      for (const child of orderedChildren(r, self)) {
        if (!visible(r, child) || !childPoint(r, self, child, x, y)) continue;
        if (dispatchTransformed(r, self, ev, false, child)) { touch.target = child; handled = true; break; }
      }
    }
    if (!handled) {
      if (touch.target === null) handled = dispatchTransformed(r, self, ev, canceled, null);
      else {
        const cancelChild = canceled || intercepted, target = touch.target;
        if (masked !== DOWN || !handled) handled = dispatchTransformed(r, self, ev, cancelChild, target) || handled;
        if (cancelChild) touch.target = null;
      }
    }
    if (canceled || masked === UP) { touch.target = null; touch.disallow = false; }
    return handled ? 1 : 0;
  });
  return registry;
}
