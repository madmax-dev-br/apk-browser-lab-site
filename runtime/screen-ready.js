// "Screen ready" (screenReady): a flag that says the current Activity, and the fragments on it, finished loading and the screen is still, so a plugin, the player or a
// backend can take a screenshot or read the screen at the right moment. It is derived from what the VM already knows, read-only, and costs a few field reads per snapshot:
//   - the Activity on top is resumed and its window drew at least one frame;
//   - no androidx fragment on the screen is between states (each added, visible fragment is RESUMED);
//   - nothing is about to change the screen: no Choreographer frame pending (animations, transitions, recomposition), no layout pass pending, no main-Looper message due now,
//     no network exchange in flight (endpoint mocks answer without the network and do not count);
// and all of that held for READY_QUIET_MS (a short quiet period, so a response that triggers the next request or a postDelayed of a few frames is not "ready" in between).
// A screen that keeps animating forever (a progress spinner, a blinking cursor of a focused field) never becomes ready: `waitingFor` names why. The Worker attaches the result
// to every snapshot (snapshot.screenReady) and wakes once the quiet period ends so the flip to ready is posted even when nothing else happens. DOM-free, no process.*.
import { runPluginQuery } from './plugin-queries.js?v=5abc89d1cc06';

export const READY_QUIET_MS = 300;
const FRAGMENT_RESUMED = 7;   // androidx.fragment.app.Fragment.RESUMED (INITIALIZING -1 … AWAITING_ENTER_EFFECTS 6, RESUMED 7)

/** The fragments on the screen, flattened (children included), as { className, state, hidden }. Empty when the app has no androidx fragments or the query cannot read them. */
function fragmentsOf(runtime) {
  let list; try { list = runPluginQuery(runtime, 'fragments', {}); } catch { return []; }
  const out = [], visit = (items, depth) => { for (const item of Array.isArray(items) ? items : []) { if (out.length >= 64 || depth > 8) return; out.push({ className: item.className ?? null, state: Number.isFinite(item.state) ? item.state : null, hidden: !!item.hidden }); visit(item.children, depth + 1); } };
  visit(list, 0); return out;
}

/** What the VM says about the screen right now (no waiting): the inputs of the readiness rule. */
export function readinessProbe(runtime) {
  const platform = runtime?.platform; if (!platform || !runtime.activity) return { activity: null, activityRef: null, resumed: false, firstFrame: false, pendingFrames: 0, layoutPending: false, dueEvents: false, network: 0, fragments: [] };
  let frame = null; try { frame = platform.frame(runtime); } catch { frame = null; }
  const frames = platform.viewWindowHost?.frameState?.() ?? null;
  let layout = null; try { layout = platform.viewLayoutHost?.detail?.(runtime) ?? null; } catch { layout = null; }
  let network = 0; for (const source of platform.externalSources ?? []) { try { network += source.pending?.() ?? 0; } catch { /* a source that cannot tell is not busy */ } }
  let dueEvents = false; try { dueEvents = platform.looperHost?.nextDelay?.(platform.clock.now()) === 0; } catch { dueEvents = false; }
  // layoutPending: only an attached root counts; a detached one (a destroyed Activity's view) is never laid out again and does not hold the screen
  return {
    activity: runtime.activityType ? runtime.activityType.slice(1, -1).replaceAll('/', '.') : null, activityRef: runtime.activity?.ref ?? null,
    resumed: frame?.lifecycleStage === 4, firstFrame: !!runtime.root && ((frames?.framesRun ?? 0) > 0 || (platform.lastFrameMs ?? 0) > 0),
    pendingFrames: frames?.pendingFrames ?? 0, layoutPending: !!layout?.pending && (layout.roots ?? []).some(root => root.attached), dueEvents, network, fragments: fragmentsOf(runtime),
  };
}

/** Why the screen is not settled (English, for the page and the report), empty when it is. */
export function waitingFor(probe) {
  const reasons = [];
  if (!probe.activity) return ['no Activity running'];
  if (!probe.resumed) reasons.push('the Activity has not reached onResume yet');
  if (!probe.firstFrame) reasons.push('the first frame has not been drawn yet');
  const loading = probe.fragments.filter(fragment => !fragment.hidden && fragment.state !== null && fragment.state < FRAGMENT_RESUMED);
  if (loading.length) reasons.push(`${loading.length === 1 ? 'one fragment still loading' : `${loading.length} fragments still loading`} (${loading.slice(0, 3).map(fragment => String(fragment.className ?? '?').split('.').pop()).join(', ')})`);
  if (probe.pendingFrames > 0) reasons.push('frame pending (animation, transition or recomposition)');
  if (probe.layoutPending) reasons.push('layout pass pending');
  if (probe.dueEvents) reasons.push('main-thread messages to process');
  if (probe.network > 0) reasons.push(`${probe.network === 1 ? 'one network request' : `${probe.network} network requests`} in flight`);
  return reasons;
}

/** Follows the probes over time: ready once the screen was settled for `quietMs` without a break; a new Activity instance starts over. */
export class ScreenReadyTracker {
  constructor({ quietMs = READY_QUIET_MS } = {}) { this.quietMs = quietMs; this.reset(); }
  reset() { this.activityRef = null; this.settledSince = null; this.readySince = null; this.state = null; this.lastSettled = false; }
  /** Records a probe; returns the public state { ready, activity, readySince, settledForMs, quietMs, waitingFor, network, onlyNetwork, fragments }. `network`: exchanges in
   *  flight; `onlyNetwork`: they are the one thing the screen waits for (it is drawn and still), which is how a caller tells a slow or hanging endpoint from a screen that loads. */
  observe(probe, now) {
    if (probe.activityRef !== this.activityRef) { this.activityRef = probe.activityRef; this.settledSince = null; this.readySince = null; }
    const reasons = waitingFor(probe), settled = reasons.length === 0;
    if (!settled) { this.settledSince = null; this.readySince = null; }
    else if (this.settledSince === null) this.settledSince = now;
    const ready = settled && now - this.settledSince >= this.quietMs;
    if (ready && this.readySince === null) this.readySince = now;
    this.lastSettled = settled;
    this.state = { ready, activity: probe.activity, readySince: ready ? Date.now() - Math.round(now - this.readySince) : null, settledForMs: settled ? Math.round(now - this.settledSince) : 0, quietMs: this.quietMs,
      waitingFor: settled && !ready ? [`screen still for ${Math.round(now - this.settledSince)} ms (ready after ${this.quietMs} ms)`] : reasons,
      network: probe.network ?? 0, onlyNetwork: (probe.network ?? 0) > 0 && waitingFor({ ...probe, network: 0 }).length === 0,
      fragments: probe.fragments.map(fragment => ({ className: fragment.className, state: fragment.state, hidden: fragment.hidden, ready: fragment.hidden || fragment.state === null || fragment.state >= FRAGMENT_RESUMED })) };
    return this.state;
  }
  /** ms until the quiet period ends (the Worker wakes then to post the flip to ready), or null when not settled or already ready. */
  /** The quiet period ended since the last probe: a fresh probe (the next snapshot) would turn the screen ready. */
  flipDue(now) { return this.lastSettled && this.settledSince !== null && !this.state?.ready && now - this.settledSince >= this.quietMs; }
  wakeDelay(now) { return this.lastSettled && this.settledSince !== null && !this.state?.ready ? Math.max(1, Math.ceil(this.settledSince + this.quietMs - now)) : null; }
}
