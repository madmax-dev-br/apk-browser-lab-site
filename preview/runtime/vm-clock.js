// The VM's clock. The browser VM is a deterministic single-threaded simulation of a device: when every Java thread is waiting (Thread.sleep, LockSupport.parkNanos, timed
// Object.wait/Future.get) and no scheduled task is due, nothing can happen until the earliest deadline, so the clock *advances* to it instead of stalling the worker in real
// time. Every clock the app can observe (System.currentTimeMillis/nanoTime, SystemClock, Date, java.time.Clock, Handler/Looper deadlines) reads this clock, so the skipped
// interval is visible to the app exactly as if it had slept. Real time keeps flowing as well; skipping only ever adds to it.
export class VMClock {
  constructor() { this.skew = 0; this.frozenAt = null; this.reads = 0; }
  /** Monotonic milliseconds (performance.now() timeline). While an event is dispatched (freeze/thaw) the clock is the event's start time, advanced one microsecond
   *  per read and never past real time: a simulated device executes a message or frame callback in no time, so work that checks "how much of this frame is left"
   *  (Compose's prefetch scheduler against the vsync deadline) sees the budget a fast device would, not the host interpreter's slowness. A spin on nanoTime still ends. */
  now() {
    if (this.frozenAt === null) return performance.now() + this.skew;
    this.reads++; return Math.min(performance.now(), this.frozenAt + this.reads * 0.001) + this.skew;
  }
  /** Starts an event: time stands still (apart from per-read ticks) until thaw(). Nested calls keep the outer start. */
  freeze() { if (globalThis.process?.env?.NOFREEZE) return false; if (this.frozenAt === null) { this.frozenAt = performance.now(); this.reads = 0; return true; } return false; }
  thaw() { this.frozenAt = null; this.reads = 0; }
  /** Wall-clock milliseconds since the epoch. */
  wall() { return Date.now() + this.skew; }
  /** Monotonic nanoseconds as a BigInt. */
  nanos() { return BigInt(Math.floor(this.now() * 1000)) * 1000n; }
  /** Wall-clock nanoseconds since the epoch as a BigInt. */
  wallNanos() { return BigInt(Math.round((performance.timeOrigin + this.now()) * 1000)) * 1000n; }
  /** Advances the clock by `ms` (no real waiting). */
  skip(ms) { if (ms > 0) this.skew += ms; }
}
