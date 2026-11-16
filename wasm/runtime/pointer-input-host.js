// Real touch/mouse input for Compose content: the page's pointer events become original android.view.MotionEvent objects delivered to the AndroidComposeView
// (original Compose DEX: hit testing, press/tap/drag/fling gesture detectors, Slider thumb dragging, scroll fling with the VelocityTracker).
// The page sends coordinates relative to the Compose owner View it touched; one pointer, one gesture at a time (DOWN ... MOVE* ... UP/CANCEL). Each sample enters the
// owner's window at its root View in window coordinates, as Android's input dispatcher delivers it (so parents intercept and clickable parents get unconsumed touches).
export const ACTION_DOWN = 0, ACTION_UP = 1, ACTION_MOVE = 2, ACTION_CANCEL = 3, ACTION_SCROLL = 8;
const MOTION = 'Landroid/view/MotionEvent;', OWNER = 'Landroidx/compose/ui/platform/AndroidComposeView;', P = ['J', 'J', 'I', 'F', 'F', 'I'];
const VIEW = 'Landroid/view/View;';
/** The root View of the owner's window (View.getRootView: the DecorView of an Activity or Dialog window), or null when the owner is not attached to a window. */
function rootOf(runtime, ownerViewId) {
  const dispatch = (name, signature, result) => runtime.dispatch({ owner: VIEW, name, parameters: [], result, signature }, [{ ref: ownerViewId }], 'virtual');
  if (!dispatch('isAttachedToWindow', '()Z', 'Z')) return null;
  const root = dispatch('getRootView', '()Landroid/view/View;', VIEW);
  return root && root.ref !== undefined ? root : null;
}
const ACTIVITY = 'Landroid/app/Activity;';
/** The foreground Activity when `root` is the root of its window (the owner sits in the Activity's views), else null (a Dialog or popup window of its own). */
function activityOf(runtime, root) {
  const activity = runtime.activity; if (!activity || !runtime.heap.has(activity.ref) || !runtime.root) return null;
  const activityRoot = rootOf(runtime, runtime.root.ref ?? runtime.root);
  return activityRoot && activityRoot.ref === root.ref ? activity : null;
}
function windowOffset(runtime, ownerViewId) {
  const out = runtime.newArray('[I', 2);
  runtime.dispatch({ owner: 'Landroid/view/View;', name: 'getLocationInWindow', parameters: ['[I'], result: 'V', signature: '([I)V' }, [{ ref: ownerViewId }, out], 'virtual');
  const [ox = 0, oy = 0] = runtime.array(out).elements; return [ox, oy];
}
const bits = value => { const view = new DataView(new ArrayBuffer(4)); view.setFloat32(0, value, true); return view.getInt32(0, true); };

/** Delivers one pointer sample. Returns { handled, dropped?: reason }. Samples outside a gesture (MOVE/UP without DOWN, a different owner) are dropped like Android's input dispatcher does. */
export function dispatchPointer(runtime, { ownerViewId, action, x, y, t = 0, dx = 0, dy = 0 }) {
  runtime.platform?.noteInput?.();   // the collector treats the main thread as in motion while input keeps arriving (heap-gc.js deferral)
  if (action === ACTION_SCROLL) return dispatchWheel(runtime, { ownerViewId, x, y, t, dx, dy });
  if (![ACTION_DOWN, ACTION_UP, ACTION_MOVE, ACTION_CANCEL].includes(action) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(t)) throw new TypeError('Invalid pointer sample');
  if (!runtime.heap.has(ownerViewId) || !runtime.isSubtype(runtime.object({ ref: ownerViewId }).type, OWNER)) return { handled: false, dropped: 'not-a-compose-view' };
  let gesture = runtime.pointerGesture;
  // Event times are uptime milliseconds and strictly increase across gestures (the VM clock only moves when the VM is idle, so two quick taps could share a time).
  if (action === ACTION_DOWN) gesture = runtime.pointerGesture = { owner: ownerViewId, downTime: BigInt(Math.max(Math.floor(runtime.platform.clock.now()), (runtime.lastPointerTime ?? -1) + 1)), pageStart: t, last: null };
  else if (!gesture || gesture.owner !== ownerViewId) return { handled: false, dropped: 'no-active-gesture' };
  if (action === ACTION_MOVE && gesture.last && gesture.last.x === x && gesture.last.y === y) return { handled: true, dropped: 'unchanged' };
  gesture.last = { x, y };
  const eventTime = gesture.downTime + BigInt(Math.max(0, Math.round(t - gesture.pageStart))); runtime.lastPointerTime = Number(eventTime);
  const call = (owner, name, signature, parameters, result, values, mode = 'virtual') => runtime.dispatch({ owner, name, signature, parameters, result }, values, mode);
  // As the input dispatcher does: the sample enters the window at its root View, in window coordinates (DecorView -> Window.Callback, i.e. Activity.dispatchTouchEvent for an
  // Activity window -> the view tree). The tree decides what a device decides: a parent may intercept (a list scrolling under the finger), the Compose content may consume the
  // touch, or a clickable parent gets it when the content does not. Delivering to the AndroidComposeView directly would skip all of that.
  const root = rootOf(runtime, ownerViewId), activity = root ? activityOf(runtime, root) : null;
  const [ox, oy] = root ? windowOffset(runtime, ownerViewId) : [0, 0];
  const event = call(MOTION, 'obtain', '(JJIFFI)Landroid/view/MotionEvent;', P, MOTION, runtime.argumentWords(P, [gesture.downTime, eventTime, action, bits(x + ox), bits(y + oy), 0]), 'static');
  let handled;
  try {
    handled = activity ? call(ACTIVITY, 'dispatchTouchEvent', `(${MOTION})Z`, [MOTION], 'Z', [activity, event])   // the Activity window's callback: onUserInteraction, the app's overrides, then the window's views
      : root ? call(VIEW, 'dispatchTouchEvent', `(${MOTION})Z`, [MOTION], 'Z', [root, event])                          // another window (Dialog, popup): its root View
      : call(OWNER, 'dispatchTouchEvent', `(${MOTION})Z`, [MOTION], 'Z', [{ ref: ownerViewId }, event]);
  }
  finally { try { call(MOTION, 'recycle', '()V', [], 'V', [event]); } catch { /* the app may have recycled it */ } if (action === ACTION_UP || action === ACTION_CANCEL) runtime.pointerGesture = null; }
  return { handled: !!handled };
}

const PROPERTIES = 'Landroid/view/MotionEvent$PointerProperties;', COORDS = 'Landroid/view/MotionEvent$PointerCoords;', AXIS_X = 0, AXIS_Y = 1, AXIS_VSCROLL = 9, AXIS_HSCROLL = 10, SOURCE_MOUSE = 0x2002, TOOL_TYPE_MOUSE = 3, WHEEL_DP_PER_NOTCH = 64;
/**
 * A mouse wheel / trackpad scroll as ACTION_SCROLL (a generic motion event from SOURCE_MOUSE), like the Android input dispatcher: Compose's `scrollable` turns the
 * AXIS_VSCROLL/AXIS_HSCROLL values into scroll offsets (64 dp per notch). `dx`, `dy` are the wheel deltas in dp (positive = content moves up/left, as in the DOM).
 */
function dispatchWheel(runtime, { ownerViewId, x, y, t, dx, dy }) {
  if (!runtime.heap.has(ownerViewId) || !runtime.isSubtype(runtime.object({ ref: ownerViewId }).type, OWNER)) return { handled: false, dropped: 'not-a-compose-view' };
  if (![x, y, dx, dy].every(Number.isFinite)) throw new TypeError('Invalid scroll sample');
  const call = (owner, name, signature, parameters, result, values, mode = 'virtual') => runtime.dispatch({ owner, name, signature, parameters, result }, values, mode);
  const properties = runtime.allocate(PROPERTIES); call(PROPERTIES, '<init>', '()V', [], 'V', [properties], 'direct'); call(PROPERTIES, 'clear', '()V', [], 'V', [properties]);
  runtime.storeField(runtime.object(properties).fields, `${PROPERTIES}->toolType:I`, TOOL_TYPE_MOUSE);
  const coords = runtime.allocate(COORDS); call(COORDS, '<init>', '()V', [], 'V', [coords], 'direct');
  const axis = (id, value) => call(COORDS, 'setAxisValue', '(IF)V', ['I', 'F'], 'V', [coords, id, bits(value)]);
  axis(AXIS_X, x); axis(AXIS_Y, y); axis(AXIS_VSCROLL, -dy / WHEEL_DP_PER_NOTCH); axis(AXIS_HSCROLL, dx / WHEEL_DP_PER_NOTCH);
  const propertiesArray = runtime.newArray(`[${PROPERTIES}`, 1), coordsArray = runtime.newArray(`[${COORDS}`, 1); runtime.object(propertiesArray).elements[0] = properties; runtime.object(coordsArray).elements[0] = coords;
  const time = BigInt(Math.max(Math.floor(runtime.platform.clock.now()), (runtime.lastPointerTime ?? -1) + 1)); runtime.lastPointerTime = Number(time);
  const parameters = ['J', 'J', 'I', 'I', `[${PROPERTIES}`, `[${COORDS}`, 'I', 'I', 'F', 'F', 'I', 'I', 'I', 'I'];
  const event = call(MOTION, 'obtain', `(JJII[${PROPERTIES}[${COORDS}IIFFIIII)${MOTION}`, parameters, MOTION, runtime.argumentWords(parameters, [time, time, ACTION_SCROLL, 1, propertiesArray, coordsArray, 0, 0, bits(1), bits(1), 0, 0, SOURCE_MOUSE, 0]), 'static');
  let handled;
  try { handled = call(OWNER, 'dispatchGenericMotionEvent', `(${MOTION})Z`, [MOTION], 'Z', [{ ref: ownerViewId }, event]); }
  finally { try { call(MOTION, 'recycle', '()V', [], 'V', [event]); } catch { /* recycled by the app */ } }
  return { handled: !!handled };
}
