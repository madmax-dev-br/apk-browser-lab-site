// The VM's clock. The browser VM is a deterministic single-threaded simulation of a device: when every Java thread is waiting (Thread.sleep, LockSupport.parkNanos, timed
// Object.wait/Future.get) and no scheduled task is due, nothing can happen until the earliest deadline, so the clock *advances* to it instead of stalling the worker in real
// time. Every clock the app can observe (System.currentTimeMillis/nanoTime, SystemClock, Date, java.time.Clock, Handler/Looper deadlines) reads this clock, so the skipped
// interval is visible to the app exactly as if it had slept. Real time keeps flowing as well; skipping only ever adds to it.
export class VMClock {
  constructor() { this.skew = 0; this.frozenAt = null; this.reads = 0; }
  /** Monotonic milliseconds (performance.now() timeline). While a Choreographer frame is dispatched (freeze/thaw) the clock is the frame's start time, advanced one microsecond
   *  per read and never past real time: a simulated device runs a frame's callbacks in no time, so work that checks "how much of this frame is left"
   *  (Compose's prefetch scheduler against the vsync deadline) sees the budget a fast device would, not the host interpreter's slowness. A spin on nanoTime still ends. */
  /** Deterministic mode (tests, recorded runs): the host's elapsed time is not part of the clock. Time stands still while code runs and moves only by skip() (a sleep, a timed wait or a
   *  timer the scheduler jumps to), so the position of anything driven by the clock (an audio track's playback head, an animation, a timeout) depends on the program alone. System.nanoTime
   *  still moves one microsecond per read, so a spin on it ends. */
  makeDeterministic() { this.base = performance.now(); this.nanoReads = 0; return this; }
  now() {
    if (this.base !== undefined) return this.base + this.skew + this.nanoReads * 0.001;
    if (this.frozenAt === null) return performance.now() + this.skew;
    this.reads++; return Math.min(performance.now(), this.frozenAt + this.reads * 0.001) + this.skew;
  }
  /** now() for the VM's own bookkeeping (the runtime's GC statistics): the same timeline, without the per-read tick of a frozen frame, so reading it does not move the app's clock. */
  peek() {
    if (this.base !== undefined) return this.base + this.skew + this.nanoReads * 0.001;
    if (this.frozenAt === null) return performance.now() + this.skew;
    return Math.min(performance.now(), this.frozenAt + this.reads * 0.001) + this.skew;
  }
  /** Starts an event: time stands still (apart from per-read ticks) until thaw(). Nested calls keep the outer start. */
  freeze() { if (this.frozenAt === null) { this.frozenAt = performance.now(); this.reads = 0; return true; } return false; }
  thaw() { this.frozenAt = null; this.reads = 0; }
  /** Wall-clock milliseconds since the epoch. */
  wall() { return Math.floor(performance.timeOrigin + this.now()); }   // the same timeline as now(): wall = origin + monotonic, so a frozen frame or a skip moves both together (Date.now() could drift from performance.now())
  /** The clocks side by side, for the report: all derived from one timeline. */
  readings() { const now = this.now(), wall = this.wall(), nano = Number(this.nanos()) / 1e6; return { uptime: now, elapsedRealtime: now, nanoMinusUptimeUs: Math.round((nano - this.now()) * 1000), wallMinusTimelineMs: Math.round(wall - (performance.timeOrigin + this.now())), skippedMs: Math.round(this.skew), realMs: Math.round(performance.now()) }; }
  /** Monotonic nanoseconds as a BigInt. */
  nanos() { if (this.base !== undefined) this.nanoReads++; return BigInt(Math.floor(this.now() * 1000)) * 1000n; }
  /** Wall-clock nanoseconds since the epoch as a BigInt. */
  wallNanos() { return BigInt(Math.round((performance.timeOrigin + this.now()) * 1000)) * 1000n; }
  /**
   * The debugger suspended every thread (src/debugger.js): the host time until debugResume is taken out of the clock, as a device's clocks do not see the time a JDWP
   * debugger holds the VM... in the sense that matters to the app -- nothing it scheduled comes due, and no interval it measures includes the pause. The pause is subtracted
   * from the skew when it ends (a frame's frozen start moves with it), so reading the clock costs nothing extra. A deterministic clock does not follow host time: nothing to do.
   */
  debugPause() {
    if (this.debugPausedAt !== undefined && this.debugPausedAt !== null) return;
    this.debugPausedAt = performance.now();
    this.debugFroze = this.base === undefined && this.frozenAt === null;   // while paused the clock reads as a frozen frame does (one microsecond per read): monotonic, never past the pause
    if (this.debugFroze) { this.frozenAt = this.debugPausedAt; this.reads = 0; }
  }
  debugResume() {
    const at = this.debugPausedAt; if (at === undefined || at === null) return 0;
    this.debugPausedAt = null;
    if (this.base !== undefined) return 0;
    const pause = Math.max(0, performance.now() - at);
    if (this.debugFroze) { const ticks = this.reads * 0.001; this.frozenAt = null; this.reads = 0; this.skew -= Math.max(0, pause - ticks); }
    else { this.skew -= pause; if (this.frozenAt !== null) this.frozenAt += pause; }
    this.debugFroze = false;
    this.debugPausedMs = (this.debugPausedMs ?? 0) + pause;
    return pause;
  }
  /** Advances the clock by `ms` (no real waiting). */
  skip(ms) { if (ms > 0) this.skew += ms; }
}
