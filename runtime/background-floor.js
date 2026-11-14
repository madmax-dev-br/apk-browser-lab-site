// A floor for the app's background threads while they have work (src/android-platform.js drainEvents). The event pump gives the main thread's due events and frames the processor
// first, as Android does for a foreground app's UI thread; on a device the background pools then run on other cores, here they share one Worker. Once frames reach the page at the
// rate they are produced, a large app's start-up coroutines (the work that produces its first content) got only what the frames left: its first full screen came 0.5-1 s later
// than when frames were throttled by delivery. So while some background thread stays runnable, it is owed BACKGROUND_FLOOR_SHARE of the wall time, measured over a window of about
// BACKGROUND_FLOOR_WINDOW_MS (exponential decay), and the pump runs what is owed between two main-thread events (never inside one: the main thread's run is not preempted or
// resized, and nothing is reordered within a thread). Time when no background thread was runnable counts for nothing: with nothing pending the UI keeps the whole Worker.
// Tuned on example-mega (6 interleaved runs each, 6 s from the first frame): share 0.2 -> first full screen 1.0 s after the first frame (0.8-1.2) for ~3 % of the frames drawn;
// 0.3 -> 0.8 s for ~11 % and more gaps above 50 ms; 0.4 -> 0.6 s for ~16 % and twice the gaps (3 runs); none -> 1.3 s (0.8-1.5). The window: a few frames.
// DOM-free, no process.*.
export const BACKGROUND_FLOOR_SHARE = 0.2, BACKGROUND_FLOOR_WINDOW_MS = 200, BACKGROUND_FLOOR_SLICE_MAX_MS = 8;

export class BackgroundFloor {
  constructor({ share = BACKGROUND_FLOOR_SHARE, windowMs = BACKGROUND_FLOOR_WINDOW_MS } = {}) { this.share = share; this.windowMs = windowMs; this.at = null; this.pending = false; this.wall = 0; this.ran = 0; }
  /** Time passed until `now`; `pending` says whether a background thread is runnable from now on (the interval just ended counts as pending if it was at its start). */
  observe(now, pending) {
    if (this.at !== null && now > this.at) {
      const dt = now - this.at, keep = Math.exp(-dt / this.windowMs);
      this.wall = this.wall * keep + (this.pending ? this.windowMs * (1 - keep) : 0); this.ran *= keep;   // the decayed integral of pending time
    }
    this.at = now; this.pending = pending;
  }
  /** `ms` of background slices ran. */
  record(ms) { if (ms > 0) this.ran += ms; }
  /** The background time owed now (ms), 0 when the share is met or nothing was pending. */
  owed() { return Math.max(0, this.share * this.wall - this.ran); }
}
