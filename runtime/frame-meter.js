// "Show frame rate" (Controls > Appearance, next to "Show layout bounds"): the statistics behind the on-screen graph modeled on Android's "Profile HWUI rendering > On screen as bars".
// Two halves, both DOM-free and free of process.*:
//  - FrameProbe, in the VM Worker: while the option is on it adds one small `frameTiming` object to each snapshot (what the Worker measured for that frame). Off, nothing is created,
//    nothing is read and no timer runs: the snapshot has no extra field.
//  - FrameMeter, on the page: the frames the page drew (with the page's own draw time and the Worker's numbers), the idle periods, the FPS samples, the janky-frame counts.
// Only measured numbers are kept. A stage the lab could not measure for a frame is null and is not drawn (never an estimate).
export const FRAME_BUDGET_MS = 1000 / 60;      // the green line: one frame at 60 Hz
export const SLOW_FRAME_MS = 2 * FRAME_BUDGET_MS;   // two missed refreshes (the "over 33 ms" count)
export const JITTER_MS = 1.5;                  // the page's frames are drawn on the display's own animation frame, whose timestamps wobble by about a millisecond: a frame is janky above budget + this
export const IDLE_DELAY_MS = 100;              // the VM's next scheduled event is at least this far away (or there is none): the screen is waiting, not slow
export const BUSY_GRACE_MS = 50;              // an idle screen whose Worker has been working for less than this is still idle (a timer woke it)
export const BAR_FRAMES = 90;                  // bars kept (the last ~1.5 s of a 60 fps animation)
export const SAMPLE_MS = 250;                  // FPS sampling period
export const FPS_WINDOW_MS = 1000;             // an FPS sample counts the frames drawn in the last second (less at the start of a burst)
export const SAMPLES_KEPT = 80;                // 80 samples = 20 s of FPS line
// The stages of one frame, in the order the work happens. Each is measured: `vm` and `raster`/`snapshot` by the Worker, `transfer` from the Worker's post to the page's receipt,
// `page` and `put` by the page. The VM's frame work (input, animation, measure/layout, record) is not split further: the lab does not time those callbacks apart.
export const FRAME_STAGES = [
  { key: 'vm', label: 'VM events', color: '#5b9cf6', detail: 'VM events run for this frame: input, animation, measure/layout and the app\'s own drawing code (not separable)' },
  { key: 'raster', label: 'Raster', color: '#f5a623', detail: 'Replay of the drawing commands into pixels (CPU or GPU), including the encode for the page' },
  { key: 'snapshot', label: 'Snapshot', color: '#b07cf0', detail: 'Reading the View and semantics trees into the frame message' },
  { key: 'transfer', label: 'Transfer', color: '#2fc4b2', detail: 'Worker postMessage until the page receives it (frames that answer an input have none)' },
  { key: 'page', label: 'Page', color: '#e8d44d', detail: 'The page updating the DOM for the frame' },
  { key: 'put', label: 'Put', color: '#ef6f6c', detail: 'The page putting the rasters on its canvases' },
];
const round1 = value => Math.round(value * 10) / 10;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The Worker's side. */
export class FrameProbe {
  constructor() { this.enabled = false; this.eventsMs = 0; }
  setEnabled(on) { this.enabled = on === true; this.eventsMs = 0; }
  /** A drain of VM events took `ms` (every drain, scheduled or answering an input). */
  addEvents(ms) { if (this.enabled) this.eventsMs += ms; }
  /** The snapshot just built: `snapshotMs` is the whole of its construction and `rasterMs` the part spent rasterizing. -> the object that travels with the snapshot, and restarts the events count. */
  take(snapshotMs, rasterMs) {
    const raster = Math.min(Math.max(0, rasterMs), Math.max(0, snapshotMs));
    const timing = { vm: round1(this.eventsMs), raster: round1(raster), snapshot: round1(Math.max(0, snapshotMs - raster)), postedAt: null };
    this.eventsMs = 0; return timing;
  }
}

/** The page's side. `now` is a monotonic clock in ms. */
export class FrameMeter {
  constructor({ now = () => performance.now() } = {}) { this.now = now; this.enabled = false; this.onChange = null; this.reset(); }   // onChange: the page redraws its graph
  setEnabled(on) { const wanted = on === true; if (wanted === this.enabled) return; this.enabled = wanted; this.reset(); }
  reset() {
    this.frames = []; this.samples = []; this.drawn = [];   // frames: the bars; drawn: timestamps of the last FPS window
    this.last = null; this.boundary = true; this.busy = false; this.busySince = 0; this.burstStart = null; this.lastReceived = null;
    this.total = { frames: 0, over16: 0, over33: 0, idleMs: 0 }; this.since = this.now();
  }
  /** The Worker started (true) or finished (false) a scheduled VM event; finishing with nothing to show is how it says "idle" (src/apk-worker.js). */
  busyChanged(busy, at = this.now()) { if (!this.enabled) return; const on = busy === true; if (on && !this.busy) this.busySince = at; this.busy = on; if (!on) this.boundary = true; }
  /** A frame message reached the page (before it waits for the display frame). */
  received(snapshot, at = this.now()) { if (!this.enabled) return; this.lastReceived = { snapshot, at }; this.busy = false; }   // the frame ends the Worker's work (it sends no runtime-idle then)
  /**
   * The page drew a frame at `at`. `snapshot` is what was drawn (carries frameTiming and pendingEventDelay), `drawMs` how long the page took to draw it and `putMs` the part of that spent
   * putting rasters on canvases. A frame is the first of a burst when the screen was idle since the one before: its frame time is its own work, not an interval.
   */
  frame(snapshot, { at = this.now(), drawMs = 0, putMs = 0 } = {}) {
    if (!this.enabled) return null;
    const timing = snapshot?.frameTiming ?? null, got = this.lastReceived?.snapshot === snapshot ? this.lastReceived : null;
    const stage = value => finite(value) ? value : null;
    const page = finite(drawMs) ? Math.max(0, drawMs - (finite(putMs) ? Math.min(putMs, drawMs) : 0)) : null;
    const bar = { at, vm: stage(timing?.vm), raster: stage(timing?.raster), snapshot: stage(timing?.snapshot),
      transfer: got && finite(timing?.postedAt) ? Math.max(0, got.at - timing.postedAt) : null, page, put: finite(putMs) ? Math.min(putMs, drawMs) : null };
    bar.work = FRAME_STAGES.reduce((sum, { key }) => sum + (bar[key] ?? 0), 0);
    const burstStart = this.last === null || this.boundary;
    bar.interval = burstStart ? null : at - this.last; bar.burstStart = burstStart;
    bar.frameTime = bar.interval ?? bar.work;
    bar.janky = bar.frameTime > FRAME_BUDGET_MS + JITTER_MS; bar.slow = bar.frameTime > SLOW_FRAME_MS + JITTER_MS;
    if (burstStart) this.burstStart = at;
    this.total.frames++; if (bar.janky) this.total.over16++; if (bar.slow) this.total.over33++;
    this.frames.push(bar); if (this.frames.length > BAR_FRAMES) this.frames.shift();
    this.drawn.push(at); while (this.drawn.length && this.drawn[0] < at - FPS_WINDOW_MS - SAMPLE_MS) this.drawn.shift();
    this.last = at; this.lastReceived = null;
    // the VM says when its next event is: a far one (or none) means the screen is waiting for something that is not due, so the next frame starts a burst instead of being late
    const delay = snapshot?.pendingEventDelay; this.boundary = delay === null || delay === undefined ? true : (finite(delay) && delay >= IDLE_DELAY_MS);
    this.onChange?.(); return bar;
  }
  /** Whether the screen is idle now: nothing drawn yet, or the last frame said nothing is due soon (or the Worker found nothing to do) and the Worker is not working on something. */
  isIdle(at = this.now()) { return (this.last === null || this.boundary) && (!this.busy || at - this.busySince < BUSY_GRACE_MS); }
  /** One FPS sample at `at` (call every SAMPLE_MS): { at, fps } with fps null while idle. */
  sample(at = this.now()) {
    if (!this.enabled) return null;
    let fps = null;
    if (!this.isIdle(at)) {
      const from = Math.max(this.burstStart ?? at, at - FPS_WINDOW_MS), span = Math.max(SAMPLE_MS, at - from);
      let count = 0; for (const t of this.drawn) if (t > at - span && t <= at) count++;
      fps = round1(count * 1000 / span);
    } else this.total.idleMs += SAMPLE_MS;
    const entry = { at, fps }; this.samples.push(entry); if (this.samples.length > SAMPLES_KEPT) this.samples.shift();
    this.onChange?.(); return entry;
  }
  /** What the graph writes: the current, average and minimum FPS over the samples kept (idle samples do not count), the janky counts since the option was turned on, and idle. */
  summary(at = this.now()) {
    const live = this.samples.filter(sample => sample.fps !== null).map(sample => sample.fps), latest = this.samples.at(-1) ?? null;
    return {
      idle: this.isIdle(at), currentFps: latest && latest.fps !== null ? latest.fps : null,
      averageFps: live.length ? round1(live.reduce((a, b) => a + b, 0) / live.length) : null, minFps: live.length ? Math.min(...live) : null,
      frames: this.total.frames, jankyOver16: this.total.over16, jankyOver33: this.total.over33, idleShare: this.samples.length ? round1(100 * this.samples.filter(s => s.fps === null).length / this.samples.length) : null,
      windowSeconds: this.samples.length * SAMPLE_MS / 1000,
    };
  }
  /** Read-only copy for the player API / MCP: the summary, the last bars and the FPS samples. */
  snapshot(at = this.now()) { return { enabled: this.enabled, ...this.summary(at), bars: this.frames.map(bar => ({ ...bar })), samples: this.samples.map(sample => ({ ...sample })) }; }
}
