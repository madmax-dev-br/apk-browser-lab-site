// The VM's clock. The browser VM is a deterministic single-threaded simulation of a device: when every Java thread is waiting (Thread.sleep, LockSupport.parkNanos, timed
// Object.wait/Future.get) and no scheduled task is due, nothing can happen until the earliest deadline, so the clock *advances* to it instead of stalling the worker in real
// time. Every clock the app can observe (System.currentTimeMillis/nanoTime, SystemClock, Date, java.time.Clock, Handler/Looper deadlines) reads this clock, so the skipped
// interval is visible to the app exactly as if it had slept. Real time keeps flowing as well; skipping only ever adds to it.
export class VMClock {
  constructor() { this.skew = 0; }
  /** Monotonic milliseconds (performance.now() timeline). */
  now() { return performance.now() + this.skew; }
  /** Wall-clock milliseconds since the epoch. */
  wall() { return Date.now() + this.skew; }
  /** Monotonic nanoseconds as a BigInt. */
  nanos() { return BigInt(Math.floor(this.now() * 1000)) * 1000n; }
  /** Wall-clock nanoseconds since the epoch as a BigInt. */
  wallNanos() { return BigInt(Math.round((performance.timeOrigin + this.now()) * 1000)) * 1000n; }
  /** Advances the clock by `ms` (no real waiting). */
  skip(ms) { if (ms > 0) this.skew += ms; }
}
