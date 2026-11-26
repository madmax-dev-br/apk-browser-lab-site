// The I/O yield of the Worker's scheduled pumps (src/apk-worker.js drainReadyEvents; docs/INTERACTION-PERFORMANCE.md section 25). The Worker is one JavaScript thread: while a
// pump runs the app's threads, the browser cannot hand it anything, not even the bytes of an HTTP answer its own fetch already has. A decode on one background thread on a
// still screen kept the pump going until it was over (up to the 1.5 s settle window), and every other answer that arrived meanwhile waited in the browser: five small
// answers that arrived during a 270 ms decode reached their threads 66-244 ms late, where a device decodes them in parallel. So a scheduled pump in which only background
// threads are due (no main-thread event, which keeps the pump going as before) returns to the event loop after `ioYieldMs` while exchanges are in flight whose progress
// comes only through that event loop (this realm's fetch: NetworkBridge.pendingInRealm; the network worker's answers are in shared memory and need no turn), and is re-armed
// at once. Never before the first frame (a launch drains as it did), never in a page request (input first has its own rule). DOM-free, no process.*.

// Which page requests are answered with their first new frame (src/apk-worker.js drainReadyEvents { framePaced }; docs/INTERACTION-PERFORMANCE.md section 34). Input in motion
// (a pointer sample, a wheel step, a semantics ScrollBy) always was. With `inputFrame` (on by default) so is every other input the app answers on the screen: a click, a press,
// a focus, a text or check change, a semantics action, an action-bar item, a scroll position, the keyboard. A navigation the page asks for (launch, an Intent, back, home, a
// task brought back, an Activity reloaded) settles as before: its reply is the screen it leads to.
const FRAME_PACED_INPUT = new Set(['click', 'press', 'focus', 'input', 'check', 'compose-action', 'action-item', 'scroll', 'ime']);
export function framePacedRequest(type, data = null, inputFrame = true) {
  return type === 'pointer' || type === 'scrollby' || (type === 'compose-action' && data?.action === 'ScrollBy') || (inputFrame === true && FRAME_PACED_INPUT.has(type));
}

/** True when a scheduled pump should return to the event loop now so that answers in flight can reach the VM. */
export function ioYieldDue({ input = false, ioYieldMs = 0, elapsedMs = 0, eventDelay = null, pendingInRealm = 0, framesRun = 0 }) {
  return !input && ioYieldMs > 0 && eventDelay !== 0 && elapsedMs >= ioYieldMs && pendingInRealm > 0 && framesRun > 0;
}
/** The host budget to ask drainEvents for, so that it returns near the yield's moment (null: its own bound). */
export function ioYieldBudget({ input = false, ioYieldMs = 0, elapsedMs = 0, pendingInRealm = 0, framesRun = 0, ownBudgetMs = 30 }) {
  if (input || ioYieldMs <= 0 || pendingInRealm <= 0 || framesRun <= 0) return null;
  return Math.min(ownBudgetMs, Math.max(1, ioYieldMs - elapsedMs));
}
