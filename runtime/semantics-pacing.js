// Pacing of the Compose semantics snapshot that the Worker attaches to the snapshot of every scheduled VM event (src/apk-worker.js).
// Walking the semantics tree runs original Compose Java for every node (config, bounds, placement; about 9k VM instructions and 0.3 ms per node), which is as much work as a
// frame of a small screen. A scheduled event batch is usually one Choreographer frame, and the page only needs the accessibility layer to follow the screen, not every frame of it.
// The walk is therefore paced by its own measured cost: after a walk that took `cost` ms, the next scheduled event may reuse that tree until RATIO x cost ms (at most MAX_GAP_MS)
// have passed, which bounds the share of the Worker's time spent on semantics to about 1/(1+RATIO). A reused tree is always followed by a fresh one: the Worker schedules a
// refresh when the gap ends, even if no VM event is due, so the last state of the screen is never left out. Replies to page requests (launch, click, action, back, ...)
// always carry a fresh tree.
// While the screen moves (a frame pending, a gesture live, a wheel step or a drag's MOVE) the walk is spaced by at least MOTION_GAP_MS: walking at the rate of the frames cost
// about a tenth of a core while a list scrolled and most of the Worker's garbage (every node is several nested runs of Java code); the accessibility layer lags the moving screen
// by at most that much and the tree is exact again once it stops (the owed refresh).
// A walk that is due still waits for room before the app's next main-thread event (`room`: ms until it is due, as AndroidPlatform.nextEventDelay; null or Infinity when none is
// scheduled). The walk is the page's, not the app's: on a device nothing of the kind runs on the main thread, and a Choreographer frame runs at its vsync. Taken a few ms before a
// frame was due (or after: a held snapshot is sent by a timer, at any phase of the vsync), a 10 ms walk plus the re-armed pump's timer made that frame more than one vsync late,
// which Choreographer counts as a skipped frame: an app that only posts a frame callback lost about one frame in a hundred at rest (13 of 1187 in 20 s, every one of them behind
// a walk). So a walk that would overrun the next event by more than LATE_OK_MS is left to a snapshot with room for it, which is the one that follows the event (the next frame
// is then a whole vsync away), for at most DEFER_MAX_MS: a walk longer than a frame, or an app whose main thread always has something due, still gets its tree.
export const RATIO = 8, MAX_GAP_MS = 400, MOTION_GAP_MS = 200, LATE_OK_MS = 6, DEFER_MAX_MS = 200;
export class SemanticsPacer {
  constructor(now = () => performance.now()) { this.now = now; this.cost = 0; this.at = -Infinity; this.stale = false; }
  gap(motion = false) { return Math.min(MAX_GAP_MS, Math.max(motion ? MOTION_GAP_MS : 0, RATIO * this.cost)); }
  /** Milliseconds until a fresh tree is due (0 when it is due now or has never been taken). */
  wait(motion = false) { return this.at === -Infinity ? 0 : Math.max(0, this.at + this.gap(motion) - this.now()); }
  /** Milliseconds a due walk still waits because it would overrun the next main-thread event (`room` ms away); 0 when it has room, none is scheduled, or it has waited DEFER_MAX_MS. */
  deferral(motion = false, room = Infinity) { return this.at === -Infinity || room === null || this.cost <= room + LATE_OK_MS ? 0 : Math.max(0, this.at + this.gap(motion) + DEFER_MAX_MS - this.now()); }
  /** True when the tree of this scheduled event must be fresh (`motion`: the screen is moving, see MOTION_GAP_MS; `room`: ms until the next main-thread event, see DEFER_MAX_MS); otherwise the caller reuses the last one and the pacer remembers that a refresh is owed. */
  take(motion = false, room = Infinity) { if (this.wait(motion) <= 0 && this.deferral(motion, room) <= 0) return true; this.stale = true; return false; }
  /** A walk of the tree finished (any reason): its cost sets the next gap and nothing is owed. */
  taken(startedAt) { const end = this.now(); this.cost = end - startedAt; this.at = end; this.stale = false; }
  /** Milliseconds until a refresh is owed and due, or null when nothing is owed. */
  refreshDelay(motion = false, room = Infinity) { if (!this.stale) return null; const wait = this.wait(motion); return wait > 0 ? wait : this.deferral(motion, room); }
}
