// Pacing of the Compose semantics snapshot that the Worker attaches to the snapshot of every scheduled VM event (src/apk-worker.js).
// Walking the semantics tree runs original Compose Java for every node (config, bounds, placement; about 9k VM instructions and 0.3 ms per node), which is as much work as a
// frame of a small screen. A scheduled event batch is usually one Choreographer frame, and the page only needs the accessibility layer to follow the screen, not every frame of it.
// The walk is therefore paced by its own measured cost: after a walk that took `cost` ms, the next scheduled event may reuse that tree until RATIO x cost ms (at most MAX_GAP_MS)
// have passed, which bounds the share of the Worker's time spent on semantics to about 1/(1+RATIO). A reused tree is always followed by a fresh one: the Worker schedules a
// refresh when the gap ends, even if no VM event is due, so the last state of the screen is never left out. Replies to page requests (launch, click, action, back, ...)
// always carry a fresh tree.
export const RATIO = 8, MAX_GAP_MS = 400;
export class SemanticsPacer {
  constructor(now = () => performance.now()) { this.now = now; this.cost = 0; this.at = -Infinity; this.stale = false; }
  /** Milliseconds until a fresh tree is due (0 when it is due now or has never been taken). */
  wait() { return this.at === -Infinity ? 0 : Math.max(0, this.at + Math.min(MAX_GAP_MS, RATIO * this.cost) - this.now()); }
  /** True when the tree of this scheduled event must be fresh; otherwise the caller reuses the last one and the pacer remembers that a refresh is owed. */
  take() { if (this.wait() <= 0) return true; this.stale = true; return false; }
  /** A walk of the tree finished (any reason): its cost sets the next gap and nothing is owed. */
  taken(startedAt) { const end = this.now(); this.cost = end - startedAt; this.at = end; this.stale = false; }
  /** Milliseconds until a refresh is owed and due, or null when nothing is owed. */
  refreshDelay() { return this.stale ? this.wait() : null; }
}
