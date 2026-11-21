// Which element of the page sends a pointer gesture to the VM. On Android only the window's root dispatches a touch (ViewRootImpl -> DecorView.dispatchTouchEvent): the
// tree decides who scrolls or clicks. The page binds real pointer input on several elements (a Compose owner, an original list, every View that scrolls itself), and
// they nest (a horizontal RecyclerView inside a NestedScrollView, a ComposeView in a list row); each sample enters the window at its root anyway
// (src/pointer-input-host.js), so one element must send the gesture, never two: the outermost bound element that takes it.
//
// What an element takes ('direct', 'deferred' or null):
//  - with the semantic pointer mode (?pointerClicks=semantic), a press on a page control stays the control's own semantic click: null for every element;
//  - an element bound with skipControls (a list, a View that scrolls itself) leaves a press on a View control inside it (a button, a field, a check, a clickable View the
//    page clicks through its own element) to that control, 'deferred': the control's click stays the page's semantic click, and the pointer becomes a gesture only when
//    it moves past DRAG_SLOP before it lifts (a drag that starts on a list row scrolls the list, as the list's onInterceptTouchEvent takes it from the row on Android);
//  - a control inside a nested element that takes every pointer itself (a Compose owner, bound without skipControls) is that element's content: 'direct';
//  - anything else: 'direct' (the gesture starts at once as MotionEvents).
// DOM-free (works on any object with closest / contains / parentElement), no process.*.

export const CONTROL_SELECTOR = 'button,input,[data-kind="check"],[data-clickable="true"]';
export const SEMANTIC_CONTROL_SELECTOR = 'button,textarea,input,[role=button],[role=switch],[role=checkbox]';
/** How far (in the View's own px) a deferred press moves before it becomes a gesture: less than ViewConfiguration's touch slop (8 dp), so the app's own slop decides a drag. */
export const DRAG_SLOP = 4;

/** What `host` (a bound element: host._pointerOptions = { skipControls }) takes of a press on `target`: 'direct', 'deferred' or null. */
export function claimKind(host, target, { pointerClicks = true } = {}) {
  if (!target?.closest) return 'direct';
  if (!pointerClicks && target.closest(SEMANTIC_CONTROL_SELECTOR)) return null;
  if (!host._pointerOptions?.skipControls) return 'direct';
  const control = target.closest(CONTROL_SELECTOR);
  if (!control || control === host || !host.contains(control)) return 'direct';
  for (let node = control; node && node !== host; node = node.parentElement) if (node._pointerBound && !node._pointerOptions?.skipControls) return 'direct';
  return 'deferred';
}

/** The bound element, from `host` outwards, that sends the gesture of a press on `target`: the outermost one that takes it, or null. */
export function gestureHost(host, target, options) {
  let chosen = null;
  for (let node = host; node; node = node.parentElement) if (node._pointerBound && claimKind(node, target, options)) chosen = node;
  return chosen;
}
