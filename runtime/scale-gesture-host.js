import { createHostRegistry, floatBits, bitsFloat } from './host-contract.js?v=dfac552890d0';

// android.view.ScaleGestureDetector (android-13.0.0_r1 core/java/android/view/ScaleGestureDetector.java): the span / focus arithmetic of onTouchEvent, the begin / scale / end
// protocol with the listener, and the two anchored modes (double-tap-and-drag "quick scale", on by default for targetSdk > 19, and stylus-button scale, on for targetSdk > 22).
// The double tap that starts a quick scale is recognised here by GestureDetector's rule (a second DOWN between 40 ms and 300 ms after the first UP, within the double-tap slop),
// instead of through an inner GestureDetector. The lab's pointer is a single mouse or finger, so two-finger spans only occur when a test injects multi-pointer MotionEvents.
const DETECTOR = 'Landroid/view/ScaleGestureDetector;', LISTENER = 'Landroid/view/ScaleGestureDetector$OnScaleGestureListener;', SIMPLE = 'Landroid/view/ScaleGestureDetector$SimpleOnScaleGestureListener;';
const CONTEXT = 'Landroid/content/Context;', HANDLER = 'Landroid/os/Handler;', EVENT = 'Landroid/view/MotionEvent;', CONFIG = 'Landroid/view/ViewConfiguration;', OBJECT = 'Ljava/lang/Object;';
const ACTION = { DOWN: 0, UP: 1, MOVE: 2, CANCEL: 3, POINTER_DOWN: 5, POINTER_UP: 6 }, BUTTON_STYLUS_PRIMARY = 0x20;
const MODE = { NONE: 0, DOUBLE_TAP: 1, STYLUS: 2 }, SCALE_FACTOR = 0.5, DOUBLE_TAP_TIMEOUT = 300, DOUBLE_TAP_MIN_TIME = 40;
const nullish = value => value === null || value === undefined || value === 0;

export function createScaleGestureHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  type(DETECTOR, OBJECT, [], { allocatable: true }); type(LISTENER, OBJECT); type(SIMPLE, OBJECT, [LISTENER], { allocatable: true });
  def(SIMPLE, '<init>', '()V', () => {}); def(SIMPLE, 'onScale', `(${DETECTOR})Z`, () => 0); def(SIMPLE, 'onScaleBegin', `(${DETECTOR})Z`, () => 1); def(SIMPLE, 'onScaleEnd', `(${DETECTOR})V`, () => {});
  const state = (r, self) => r.object(self).scaleGesture;
  const init = (r, self, context, listener) => {
    if (nullish(listener)) r.throwJava('Ljava/lang/NullPointerException;', null);
    const config = r.dispatch({ owner: CONFIG, name: 'get', parameters: [CONTEXT], result: CONFIG, signature: `(${CONTEXT})${CONFIG}` }, [context], 'static'), targetSdk = Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1);
    r.object(self).scaleGesture = {
      listener, spanSlop: call(r, config, CONFIG, 'getScaledTouchSlop', [], 'I') * 2, minSpan: call(r, config, CONFIG, 'getScaledMinimumScalingSpan', [], 'I'), doubleTapSlop: call(r, config, CONFIG, 'getScaledDoubleTapSlop', [], 'I'),
      quickScale: targetSdk > 19, stylusScale: targetSdk > 22, inProgress: false, mode: MODE.NONE, anchorX: 0, anchorY: 0, above: false,
      focusX: 0, focusY: 0, currSpan: 0, prevSpan: 0, initialSpan: 0, currSpanX: 0, currSpanY: 0, prevSpanX: 0, prevSpanY: 0, currTime: 0, prevTime: 0, tap: null,
    };
  };
  def(DETECTOR, '<init>', `(${CONTEXT}${LISTENER})V`, (r, _m, [self, context, listener]) => init(r, self, context, listener));
  def(DETECTOR, '<init>', `(${CONTEXT}${LISTENER}${HANDLER})V`, (r, _m, [self, context, listener]) => init(r, self, context, listener));
  const tell = (r, self, s, name, result) => call(r, s.listener, LISTENER, name, [DETECTOR], result, [self]);
  const anchored = s => s.mode !== MODE.NONE;
  def(DETECTOR, 'onTouchEvent', `(${EVENT})Z`, (r, _m, [self, event]) => {
    const s = state(r, self), f = Math.fround, num = (name, args = [], parameters = []) => bitsFloat(call(r, event, EVENT, name, parameters, 'F', args));
    const action = call(r, event, EVENT, 'getActionMasked', [], 'I'), count = call(r, event, EVENT, 'getPointerCount', [], 'I'), time = Number(call(r, event, EVENT, 'getEventTime', [], 'J'));
    s.currTime = time;
    if (s.quickScale) {   // the double tap an inner GestureDetector would report to onDoubleTap
      const x = num('getX'), y = num('getY'), tap = s.tap;
      if (action === ACTION.DOWN) {
        if (tap?.upTime !== undefined && time - tap.upTime >= DOUBLE_TAP_MIN_TIME && time - tap.upTime <= DOUBLE_TAP_TIMEOUT && (x - tap.x) ** 2 + (y - tap.y) ** 2 < s.doubleTapSlop ** 2) { s.anchorX = x; s.anchorY = y; s.mode = MODE.DOUBLE_TAP; s.tap = null; }
        else s.tap = { x, y };
      } else if (action === ACTION.UP && tap && tap.upTime === undefined) tap.upTime = time;
      else if (action === ACTION.CANCEL || action === ACTION.POINTER_DOWN) s.tap = null;
    }
    const stylusDown = (call(r, event, EVENT, 'getButtonState', [], 'I') & BUTTON_STYLUS_PRIMARY) !== 0, anchoredCancelled = s.mode === MODE.STYLUS && !stylusDown;
    const streamComplete = action === ACTION.UP || action === ACTION.CANCEL || anchoredCancelled;
    if (action === ACTION.DOWN || streamComplete) {
      if (s.inProgress) { tell(r, self, s, 'onScaleEnd', 'V'); s.inProgress = false; s.initialSpan = 0; s.mode = MODE.NONE; }
      else if (anchored(s) && streamComplete) { s.inProgress = false; s.initialSpan = 0; s.mode = MODE.NONE; }
      if (streamComplete) return 1;
    }
    if (!s.inProgress && s.stylusScale && !anchored(s) && !streamComplete && stylusDown) { s.anchorX = num('getX'); s.anchorY = num('getY'); s.mode = MODE.STYLUS; s.initialSpan = 0; }
    const configChanged = action === ACTION.DOWN || action === ACTION.POINTER_UP || action === ACTION.POINTER_DOWN || anchoredCancelled, pointerUp = action === ACTION.POINTER_UP;
    const skip = pointerUp ? call(r, event, EVENT, 'getActionIndex', [], 'I') : -1, div = pointerUp ? count - 1 : count;
    const xs = [], ys = []; for (let i = 0; i < count; i++) if (i !== skip) { xs.push(num('getX', [i], ['I'])); ys.push(num('getY', [i], ['I'])); }
    let focusX, focusY;
    if (anchored(s)) { focusX = s.anchorX; focusY = s.anchorY; s.above = num('getY') < focusY; }
    else { focusX = f(xs.reduce((a, b) => f(a + b), 0) / div); focusY = f(ys.reduce((a, b) => f(a + b), 0) / div); }
    const devX = f(xs.reduce((a, x) => f(a + Math.abs(f(x - focusX))), 0) / div), devY = f(ys.reduce((a, y) => f(a + Math.abs(f(y - focusY))), 0) / div);
    const spanX = f(devX * 2), spanY = f(devY * 2), span = anchored(s) ? spanY : f(Math.hypot(spanX, spanY)), wasInProgress = s.inProgress;
    s.focusX = focusX; s.focusY = focusY;
    if (!anchored(s) && s.inProgress && (span < s.minSpan || configChanged)) { tell(r, self, s, 'onScaleEnd', 'V'); s.inProgress = false; s.initialSpan = span; }
    if (configChanged) { s.prevSpanX = s.currSpanX = spanX; s.prevSpanY = s.currSpanY = spanY; s.initialSpan = s.prevSpan = s.currSpan = span; }
    const minSpan = anchored(s) ? s.spanSlop : s.minSpan;
    if (!s.inProgress && span >= minSpan && (wasInProgress || Math.abs(span - s.initialSpan) > s.spanSlop)) {
      s.prevSpanX = s.currSpanX = spanX; s.prevSpanY = s.currSpanY = spanY; s.prevSpan = s.currSpan = span; s.prevTime = s.currTime; s.inProgress = !!tell(r, self, s, 'onScaleBegin', 'Z');
    }
    if (action === ACTION.MOVE) {
      s.currSpanX = spanX; s.currSpanY = spanY; s.currSpan = span;
      const updatePrev = s.inProgress ? !!tell(r, self, s, 'onScale', 'Z') : true;
      if (updatePrev) { s.prevSpanX = s.currSpanX; s.prevSpanY = s.currSpanY; s.prevSpan = s.currSpan; s.prevTime = s.currTime; }
    }
    return 1;
  });
  def(DETECTOR, 'getScaleFactor', '()F', (r, _m, [self]) => {
    const s = state(r, self);
    if (anchored(s)) { const up = (s.above && s.currSpan < s.prevSpan) || (!s.above && s.currSpan > s.prevSpan), diff = Math.fround(Math.abs(1 - Math.fround(s.currSpan / s.prevSpan)) * SCALE_FACTOR); return floatBits(s.prevSpan <= s.spanSlop ? 1 : up ? 1 + diff : 1 - diff); }
    return floatBits(s.prevSpan > 0 ? s.currSpan / s.prevSpan : 1);
  });
  for (const [name, key] of [['getFocusX', 'focusX'], ['getFocusY', 'focusY'], ['getCurrentSpan', 'currSpan'], ['getCurrentSpanX', 'currSpanX'], ['getCurrentSpanY', 'currSpanY'], ['getPreviousSpan', 'prevSpan'], ['getPreviousSpanX', 'prevSpanX'], ['getPreviousSpanY', 'prevSpanY']]) def(DETECTOR, name, '()F', (r, _m, [self]) => floatBits(state(r, self)[key]));
  def(DETECTOR, 'isInProgress', '()Z', (r, _m, [self]) => (state(r, self).inProgress ? 1 : 0));
  def(DETECTOR, 'getTimeDelta', '()J', (r, _m, [self]) => BigInt(state(r, self).currTime - state(r, self).prevTime));
  def(DETECTOR, 'getEventTime', '()J', (r, _m, [self]) => BigInt(state(r, self).currTime));
  def(DETECTOR, 'setQuickScaleEnabled', '(Z)V', (r, _m, [self, enabled]) => { state(r, self).quickScale = !!enabled; });
  def(DETECTOR, 'isQuickScaleEnabled', '()Z', (r, _m, [self]) => (state(r, self).quickScale ? 1 : 0));
  def(DETECTOR, 'setStylusScaleEnabled', '(Z)V', (r, _m, [self, enabled]) => { state(r, self).stylusScale = !!enabled; });
  def(DETECTOR, 'isStylusScaleEnabled', '()Z', (r, _m, [self]) => (state(r, self).stylusScale ? 1 : 0));
  return { ...registry, interfaces: registry.interfacesOf };
}
