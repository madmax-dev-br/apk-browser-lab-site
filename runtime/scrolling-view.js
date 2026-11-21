// Which Views scroll themselves: the class (from the app's DEX or a framework original) handles touch itself and has a scroll range of its own, as the scrolling
// containers of Android and its libraries do (ScrollView, HorizontalScrollView, AbsListView, a RecyclerView, a NestedScrollView, a ViewPager and any app class that extends
// one, minified or not). Decided from the class hierarchy only, never from a class name: the class or a superclass in DEX overrides onTouchEvent(MotionEvent) or
// onInterceptTouchEvent(MotionEvent), and one of computeVerticalScrollRange(), computeHorizontalScrollRange(), canScrollVertically(int) or canScrollHorizontally(int).
// The host View / ViewGroup of the lab declares none of them in DEX, so a plain View, a layout or a widget the lab models in JS is not one.
//
// The page sends such a View the user's pointer as real MotionEvents (a drag: ACTION_DOWN / MOVE / UP through the window, src/pointer-input-host.js) and the wheel as
// ACTION_SCROLL generic motion events, and shows its children moved by its scroll position (mScrollX / mScrollY). A Compose owner has its own input path and is not one.
// DOM-free, no process.*.
import { isComposeOwner } from './compose-owner.js?v=e3ff4f2e305f';

const VIEW = 'Landroid/view/View;', MOTION = 'Landroid/view/MotionEvent;';
const TOUCH = [`onTouchEvent(${MOTION})Z`, `onInterceptTouchEvent(${MOTION})Z`];
const RANGE = ['computeVerticalScrollRange()I', 'computeHorizontalScrollRange()I', 'canScrollVertically(I)Z', 'canScrollHorizontally(I)Z'];
const verdicts = new WeakMap();

/** Whether instances of `type` scroll themselves (see above). Memoized per runtime and class. */
export function scrollsItself(runtime, type) {
  if (!type || !runtime?.objectOverride) return false;
  let known = verdicts.get(runtime); if (!known) verdicts.set(runtime, known = new Map());
  let verdict = known.get(type);
  if (verdict === undefined) {
    verdict = runtime.isSubtype(type, VIEW) && TOUCH.some(signature => runtime.objectOverride(type, signature)) && RANGE.some(signature => runtime.objectOverride(type, signature)) && !isComposeOwner(runtime, type);
    known.set(type, verdict);
  }
  return verdict;
}
