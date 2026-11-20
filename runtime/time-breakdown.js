// Where the Worker's time goes, in buckets that match a CPU profile of the Worker (scripts/validation/cpu-breakdown.mjs prints the two side by side). Exclusive attribution: the bucket on top of
// the stack owns the clock, and the Worker is in exactly one bucket at every moment, idle included (idle is never work).
//   core      the WebAssembly interpreter and its C (a VM run: the core's run / resume exports)           glue     vmcore/js under a core run (the bridge between the core and the hosts)
//   host      src/ under a core run (the Android classes written in JavaScript)                           gc       the core's collector (C and the glue of a collection)
//   scan      the collector's scan of JavaScript host state                                               raster   display lists replayed to pixels (outside the VM runs)
//   snapshot  the snapshot of the screen and its transport to the page                                    other    every other piece of Worker JavaScript (the scheduler, requests, the API-gap scan)
//   (what the accounting itself costs, the clock reads and counters, is not a bucket: it runs inside whichever bucket owns the clock, mostly core; cpu-breakdown.mjs measures it from the profile)
//   decode, compile, init: first-time work of the JavaScript VM and of the linker (method preparation, JIT, class initialization)      idle   the Worker is not running anything
//   native    JNI native code: a native method or JNI_OnLoad (src/jni-host.js), the app's arm64-v8a code in the lab's ARM64 interpreter (src/arm64/) or a WebAssembly library, and the
//             slices of the ARM64 process's own threads; Java it calls back is a core run, the JNI functions it calls are in it
// What is cheap and what is not: the owner of the clock changes only at coarse boundaries (a task of the Worker, a VM run, a collection, a first-time phase); the bridge's glue and host time are
// sampled (one crossing in SAMPLE reads the clock; the others are counted) and extrapolated at read time; a raster owns the clock for its duration (src/skia-canvas-host.js). `precise` (the survey
// flag, WorkerTaskLog.detail) times every bridged call. Before the first task of a Worker is begun (node tests, drivers) there is no idle: `base` owns the clock.
// The accounting reads the platform's clock as it was when this module loaded: code that pins or replaces performance.now (a test that makes time deterministic) must not see the accounting's reads.
export const clockNow = (() => { const clock = globalThis.performance; const read = clock.now.bind(clock); return () => read(); })();
export const BUCKET = { CORE: 0, INTERP: 0, HOST: 1, DECODE: 2, COMPILE: 3, INIT: 4, GC: 5, GLUE: 6, SCAN: 7, RASTER: 8, SNAPSHOT: 9, OTHER: 10, IDLE: 11, NATIVE: 12 };   // INTERP: the old name of CORE
export const BUCKET_COUNT = 13;
export const BUCKET_KEYS = ['core', 'host', 'decode', 'compile', 'init', 'gc', 'glue', 'scan', 'raster', 'snapshot', 'other', 'idle', 'native'];
// the plain words of the diagnostics (first-time work is the sum of decode, compile and init)
const WORDS = [[[BUCKET.CORE], 'the Java interpreter (WebAssembly core)'], [[BUCKET.GLUE], 'bridge glue (JavaScript between the core and the hosts)'], [[BUCKET.HOST], 'host code (Android classes in JavaScript)'], [[BUCKET.NATIVE], 'native code (JNI: ARM64 interpreter, WebAssembly libraries)'],
  [[BUCKET.DECODE, BUCKET.COMPILE, BUCKET.INIT], 'first-time work (method preparation, compilation, class initialization)'], [[BUCKET.GC], 'the core collector'], [[BUCKET.SCAN], 'the collector\'s JavaScript scan'],
  [[BUCKET.RASTER], 'raster'], [[BUCKET.SNAPSHOT], 'snapshot and transport to the page'], [[BUCKET.OTHER], 'other Worker JavaScript']];
/** `body` with `bucket` owning the clock (a phase entered from outside the hot paths: a native call, a slice of the ARM64 process's threads); without a breakdown it just runs. */
export function inBucket(tb, bucket, body) { if (!tb) return body(); const previous = tb.enter(bucket); try { return body(); } finally { tb.leave(previous); } }
/** One plain line for an array of bucket milliseconds: shares of the busy time; idle on its own (it is not work). */
export function bucketsText(ms, label = 'Worker time', extra = []) {
  let busy = 0; for (let b = 0; b < BUCKET_COUNT; b++) if (b !== BUCKET.IDLE) busy += ms[b] ?? 0;
  for (const [value] of extra) busy += value;
  const idle = ms[BUCKET.IDLE] ?? 0, parts = [...WORDS.map(([list, words]) => [list.reduce((total, b) => total + (ms[b] ?? 0), 0), words]), ...extra].filter(([value]) => value >= 1).sort((a, b) => b[0] - a[0])
    .map(([value, words]) => `${words} ${Math.round(100 * value / Math.max(1, busy))}% (${Math.round(value)} ms)`);
  return `${label}: ${Math.round(busy)} ms busy${idle >= 1 ? `, ${Math.round(idle)} ms idle (not counted)` : ''}: ${parts.join(', ') || 'nothing measured'}`;
}
const LEARN_CALLS = 4;   // a call site is timed on each of its first calls, and on every call once one took 50 µs or more and three clock steps (a decode, a layout: rare, and worth the clock)
export const TIME_SAMPLE_CROSSINGS = 32;   // one bridged crossing in this many reads the clock (the core's import wrapper, vmcore/js/core-timing.js)
// What the measurement itself costs, measured once: a sampled crossing spends `glue` ms on its own clock reads and bookkeeping outside the host call it times, and each timed call carries `host` ms
// of its enter/leave in its span. The calibration runs the same calls on a scratch breakdown with an empty body; the extrapolation subtracts these, so the estimate does not multiply the measurement.
let overhead = null;   // until the calibration has run (scheduled when a core is attached, vmcore/js/core-timing.js), estimates stand in
const ESTIMATE = { glue: 0.0002, host: 0.0001, clockMs: 0.00005, resolutionMs: 0.1, slowMs: 0.3, calibrated: false };
export const overheadNow = () => overhead !== null && overhead.calibrated ? overhead : ESTIMATE;
// The calibration runs on the coarse clock (steps of 100 us), so every loop spans at least 1.5 ms (a step is then 7 % of it): the sampled path first, doubling its count from 1000 (this is also
// the warm-up), then the bare call and the clock read for 8 times that count, then the sampled path again at the count found.
export function measurementOverhead() {
  if (overhead !== null && overhead.calibrated === true) return overhead;
  overhead = { glue: 0, host: 0, calibrated: false };   // while it is measured
  const tb = new TimeBreakdown(); tb.precise = true; tb.cur = BUCKET.CORE; let sink = 0;
  // 128 distinct call sites, as a real run has: the per-key tables and the holders' own fields are not one hot cache line
  const holders = Array.from({ length: 128 }, () => ({})), keys = Array.from({ length: 128 }, (_, i) => `Lcalibration/Site${i};->call${i}()V`);
  const empty = () => { sink++; };
  const full = n => {   // the sampled path of vmcore/js/core-timing.js around a host call with an empty body
    for (let i = 0; i < n; i++) {
      const holder = holders[i & 127], t0 = clockNow(); tb.charge(t0); tb.sampling = true;
      const previous = tb.callBegin(holder, keys[i & 127]), startedAt = tb.last, runs = tb.runs; empty(); tb.callEnd(holder, previous, startedAt, runs); tb.sampling = false;
      const t1 = clockNow(); tb.charge(t1); tb.settleDeferred();
    }
  };
  let n = 1000; for (; n < 1 << 22; n *= 2) { const t0 = clockNow(); full(n); if (clockNow() - t0 >= 1.5) break; }
  const time = (count, fn) => { const t0 = clockNow(); fn(count); return (clockNow() - t0) / count; };
  const median = values => values.sort((x, y) => x - y)[values.length >> 1], runs = [[], [], [], []];   // 3 repetitions, the median of each: one run's error is a step of the coarse clock over its length
  for (let rep = 0; rep < 3; rep++) {
    runs[0].push(time(n * 8, count => { for (let i = 0; i < count; i++) { holders[i & 127]; empty(); } }));
    runs[1].push(time(n * 8, count => { for (let i = 0; i < count; i++) sink += clockNow() > 0 ? 1 : 0; }));
    tb.nonCore = 0; runs[2].push(time(n, full)); runs[3].push(tb.nonCore / n);   // the last: what the breakdown itself charged to the host span of the empty call (its own enter/leave stamps)
  }
  const bare = median(runs[0]), now = median(runs[1]), withSpan = median(runs[2]), span = median(runs[3]);
  // Inside a sampled crossing's span (t0 .. t1) lies what the path costs over the bare call except the halves of the two outer clock reads (one clock read in all): less what the host span holds.
  const glue = Math.max(0, withSpan - bare - now - span), host = Math.max(0, span);
  void sink;
  // The clock's resolution: a Worker that is not cross-origin isolated reads clockNow() in steps of 100 us. A single span is then 0 or one step, and only the mean of many spans is
  // meaningful (the browser dithers the steps so that the mean is unbiased), which is what the sampling and the extrapolation use. A call is "slow" only when it spans several steps.
  let resolution = Infinity;
  for (let i = 0; i < 12; i++) { const a = clockNow(); let b = a; for (let spin = 0; b === a && spin < 2e6; spin++) b = clockNow(); if (b > a && b - a < resolution) resolution = b - a; }
  const step = Number.isFinite(resolution) ? resolution : 0;
  return overhead = { glue, host, clockMs: now, resolutionMs: step, slowMs: Math.max(0.05, 3 * step), calibrated: true };
}
export class TimeBreakdown {
  constructor(base = BUCKET.CORE) { this.base = base; this.precise = false; this.tracking = false; this.cur = base; this.depth = 0; this.excl = new Float64Array(64); this.exclAt = new Float64Array(64); this.dOwn = 0; this.crossings = 0; this.timedCalls = 0; this.countedCalls = 0; this.nestCalls = 0; this.slowCalls = 0; this.lifeTimed = 0; this.lifeCounted = 0; this.glueSum = 0; this.glueN = 0; this.sampling = false; this.sampleTimed = false; this.glueHist = new Uint32Array(7); this.sampleHolder = null; this.dHolder = null; this.dPrevious = 0; this.dRaw = 0; this.pendingHolders = []; this.reset(); }
  reset() {
    // what the breakdown of each operation drops is kept in the lifetime totals (src/warmup.js reads them); the derived buckets (glue, raster) are settled first
    this.lifeMs ??= new Float64Array(BUCKET_COUNT); this.lifeCounts ??= new Float64Array(BUCKET_COUNT); if (this.pendingHolders.length) this.flushPending();
    if (this.ms) { this.charge(clockNow()); const settled = this.derive(new Float64Array(this.ms)); for (let i = 0; i < BUCKET_COUNT; i++) { this.lifeMs[i] += settled[i]; this.lifeCounts[i] += this.counts[i]; } }
    this.lifeCrossings = (this.lifeCrossings ?? 0) + this.crossings; this.crossings = 0; this.lifeTimed += this.timedCalls; this.lifeCounted += this.countedCalls; this.timedCalls = 0; this.countedCalls = 0;
    this.ms = new Float64Array(BUCKET_COUNT); this.counts = new Float64Array(BUCKET_COUNT); this.last = this.startedAt = clockNow(); this.nonCore = 0; this.runs = 0; this.threads = new Map(); this.acc = this.accumulatorFor('main'); this.host = new Map(); this.event ??= null;
  }
  accumulatorFor(name) { let acc = this.threads.get(name); if (acc === undefined) this.threads.set(name, acc = { name, ms: 0, calls: 0, hosts: new Map() }); return acc; }
  /** The running thread changed (scheduler): core time from now on counts for `name`. */
  thread(name) { if (this.pendingHolders.length) this.flushPending(); this.charge(clockNow()); this.acc = this.accumulatorFor(name); }
  charge(now) { const d = now - this.last; this.last = now; const cur = this.cur; this.ms[cur] += d; this.excl[this.depth & 63] += d; if (cur === 0) this.acc.ms += d; else this.nonCore += d; }
  enter(bucket) { const now = clockNow(); this.charge(now); const previous = this.cur; this.cur = bucket; this.depth++; this.counts[bucket]++; if (bucket === 0) this.runs++; return previous; }
  leave(previous) { this.charge(clockNow()); this.cur = previous; this.depth--; }
  /** The engine that owns the clock outside VM runs and tasks: the core's host code (OTHER), or the JavaScript VM, whose interpreter is JavaScript (CORE). */
  setBase(bucket) { const was = this.base; this.base = bucket; if (this.cur === was && !this.tracking) { this.charge(clockNow()); this.cur = bucket; } }
  /** A Worker task starts / ends (src/worker-task-log.js): between tasks the Worker waits, and waiting is idle. `now` is the clock the task log read anyway. */
  taskBegin(kind, now) { this.charge(now); this.tracking = true; this.cur = kind === 'snapshot' ? BUCKET.SNAPSHOT : this.base; }
  taskEnd(now) { this.charge(now); this.cur = BUCKET.IDLE; }
  /** The glue of one sampled crossing, in ms (vmcore/js/core-timing.js): the mean of these, times the crossings counted, is the glue time the core bucket holds. */
  noteGlue(ms) { this.glueSum += ms; this.glueN++; const us = ms * 1000; this.glueHist[us < 0.25 ? 0 : us < 0.5 ? 1 : us < 1 ? 2 : us < 2 ? 3 : us < 5 ? 4 : us < 20 ? 5 : 6]++; }   // the histogram is for the measurement tool

  /** The bucket the clock does not read directly, settled into `arr` (the milliseconds of the current operation): glue is moved out of core by the calibrated cost per crossing, clamped to what core holds. */
  derive(arr) {
    if (this.glueN > 0 && this.crossings > 0) { const glue = Math.min(this.crossings * (this.glueSum / this.glueN), Math.max(0, arr[BUCKET.CORE])); arr[BUCKET.CORE] -= glue; arr[BUCKET.GLUE] += glue; }
    return arr;
  }
  /** Cumulative milliseconds per bucket since the Worker's runtime began (lifetime plus the current operation, the open bucket included), into `out`. */
  cumulative(out) {
    const now = clockNow(), cur = new Float64Array(this.ms); cur[this.cur] += now - this.last; this.derive(cur);
    for (let i = 0; i < BUCKET_COUNT; i++) out[i] = cur[i] + this.lifeMs[i];
    return out;
  }
  /**
   * A host call of `holder` (a bridge, a resolved native: any object the call site keeps) begins. Every call counts; the clock is read for the first calls of a holder, for each call of one
   * that has run Java inside or took 50 µs or more, for the crossing the core's import wrapper chose to sample (vmcore/js/core-timing.js), for one call in 32 of the holder otherwise, and
   * for every call in precise mode. Returns the bucket to hand back to callEnd (the host bucket is entered), or -1 for a counted call: the time of those is the mean of the timed ones.
   */
  callBegin(holder, key) {
    let timed = this.precise === true || holder.vmSlow === true || holder.vmNests === true;
    if (!timed) { const n = holder.vmCalls = (holder.vmCalls | 0) + 1; timed = n <= LEARN_CALLS || this.sampling === true || (n & 31) === 0; }
    if (this.sampling === true && timed) { this.sampling = false; this.sampleTimed = true; this.sampleHolder = holder; }
    if (holder.vmKey === undefined) holder.vmKey = key;
    if (timed) { ++this.timedCalls; if (holder.vmSlow === true) ++this.slowCalls; const previous = this.enter(BUCKET.HOST), at = this.depth & 63; this.exclAt[at] = this.excl[at]; return previous; }
    this.counts[BUCKET.HOST]++; ++this.countedCalls; holder.vmPending = (holder.vmPending | 0) + 1; holder.vmUntimed = (holder.vmUntimed | 0) + 1;   // vmPending: counted calls not yet in the key tables; vmUntimed: calls since the last timed one (the weight of its time)
    if (holder.vmListed !== true) { holder.vmListed = true; this.pendingHolders.push(holder); }
    return -1;
  }
  /** The call callBegin started ends (`previous`: what it returned; `startedAt`: tb.last read right after it; `runs`: tb.runs read right after it). */
  callEnd(holder, previous, startedAt, runs) {
    if (this.runs !== runs) holder.vmNests = true;   // a core run happened inside (the glue of a crossing that did is not measured)
    if (previous < 0) return;
    // `own`: the time this call itself was on top of the bucket stack: the host code of a call that runs Java inside, without that Java and what it called (the stack depth owns it)
    this.charge(clockNow()); const at = this.depth & 63, own = this.excl[at] - this.exclAt[at]; this.cur = previous; this.depth--;
    // the call a sampled crossing chose is settled after the crossing's last clock read (settleDeferred), so that its bookkeeping is not part of the span the glue is measured over
    if (holder === this.sampleHolder && this.dHolder === null) { this.dHolder = holder; this.dPrevious = previous; this.dRaw = this.last - startedAt; this.dOwn = own; this.sampleHolder = null; return; }
    this.settleCall(holder, previous, this.last - startedAt, own);
  }
  settleDeferred() { const holder = this.dHolder; this.dHolder = null; if (holder !== null) this.settleCall(holder, this.dPrevious, this.dRaw, this.dOwn); }
  /** The bookkeeping of a timed call that ended: its host time (what the measurement itself cost taken off), extrapolated over the counted calls of its holder since the last timed one. */
  settleCall(holder, previous, raw, own) {
    const cost = overheadNow(), ms = own - cost.host, pending = holder.vmUntimed | 0; holder.vmUntimed = 0;
    if (pending > 0) {   // its own host time stands for the counted calls of the holder since the last timed one
      const others = Math.min(pending * ms, Math.max(0, this.ms[previous]));
      this.ms[BUCKET.HOST] += others; this.ms[previous] -= others; if (previous === 0) this.acc.ms -= others;
      this.hostCall(holder.vmKey, raw - cost.host + pending * ms);   // the time of a key is inclusive: what the Java a call ran counts, for the timed call
    } else this.hostCall(holder.vmKey, raw - cost.host);
    if (holder.vmPending > 0) this.flushHolder(holder);
    if (ms >= cost.slowMs) { holder.vmSlow = true; holder.vmFast = 0; } else if (holder.vmSlow === true && ++holder.vmFast >= 32) holder.vmSlow = false;   // a holder that was slow is timed on every call until 32 timed calls in a row were not
  }
  /** Adds the counted calls of `holder` to the per-key and per-thread host counts, as hostCall would have one by one. */
  flushHolder(holder) {
    const n = holder.vmPending | 0; holder.vmPending = 0; if (!n) return;
    const key = holder.vmKey; let entry = this.host.get(key);
    if (entry === undefined) { if (this.host.size < 4000) this.host.set(key, entry = { n: 0, ms: 0 }); }
    if (entry !== undefined) entry.n += n;
    const acc = this.acc; acc.calls += n; acc.hosts.set(key, (acc.hosts.get(key) ?? 0) + n);
    const event = this.event; if (event !== null && acc.name === 'main') { const own = event.host.get(key); if (own !== undefined) own.n += n; else if (event.host.size < 512) event.host.set(key, { n, ms: 0 }); }
  }
  flushPending() { for (const holder of this.pendingHolders) { this.flushHolder(holder); holder.vmListed = false; } this.pendingHolders.length = 0; }
  /** One bridged host call finished: its key, and its inclusive time (host code that runs Java inside counts that Java). */
  hostCall(key, ms) {
    const event = this.event; if (event !== null && this.acc.name === 'main') { const own = event.host.get(key); if (own === undefined) { if (event.host.size < 512) event.host.set(key, { n: 1, ms }); } else { own.n++; own.ms += ms; } }
    let entry = this.host.get(key); if (entry === undefined) { if (this.host.size >= 4000) return; this.host.set(key, entry = { n: 0, ms: 0 }); }
    entry.n++; entry.ms += ms;
    const acc = this.acc; acc.calls++; acc.hosts.set(key, (acc.hosts.get(key) ?? 0) + 1);   // per thread: a loop that issues the same one or two calls over and over is polling
  }
  /** A main-thread event starts (android-platform.js runEvent, while an interaction is measured): its own buckets and host calls are collected until eventEnd. Nested events stack. */
  eventBegin() { const now = clockNow(); this.charge(now); const event = { parent: this.event, ms: Float64Array.from(this.ms), crossings: this.crossings, host: new Map() }; this.event = event; return event; }
  /** -> { buckets: [[words, ms]], hosts: [[key, n, ms]] } of the event `eventBegin` returned, in the words of bucketsText (the host calls the main thread made, inclusive time; host calls are timed by sample). */
  eventEnd(event) {
    const now = clockNow(); this.charge(now); this.event = event.parent ?? null;
    if (this.pendingHolders.length) this.flushPending();
    const delta = new Float64Array(BUCKET_COUNT); for (let i = 0; i < BUCKET_COUNT; i++) delta[i] = this.ms[i] - event.ms[i];
    if (this.glueN > 0) { const glue = Math.min(Math.max(0, this.crossings - event.crossings) * (this.glueSum / this.glueN), Math.max(0, delta[BUCKET.CORE])); delta[BUCKET.CORE] -= glue; delta[BUCKET.GLUE] += glue; }   // derive, over the event's crossings
    const short = key => String(key).replace(/^L/, '').replace(/;->/, '.').replace(/\(.*$/, '');
    return { buckets: WORDS.map(([list, words]) => [words, Math.round(list.reduce((total, b) => total + delta[b], 0))]).filter(row => row[1] > 0),
      hosts: [...event.host].sort((a, b) => b[1].ms - a[1].ms || b[1].n - a[1].n).slice(0, 6).map(([key, v]) => [short(key), v.n, Math.round(v.ms)]) };
  }
  /** The event's work without its details (an event that is not the longest): pops it. */
  eventDrop(event) { this.event = event.parent ?? null; }
  /** The buckets and counts of the current operation; `full` (default) adds the host-call tables, the thread split and the polling threads. */
  snapshot(full = true) {
    if (this.pendingHolders.length) this.flushPending();
    const copy = new Float64Array(this.ms), now = clockNow(); copy[this.cur] += now - this.last; this.derive(copy);
    if (!full) return { pollers: [], hostByCount: [], hostByTime: [], ms: Array.from(copy, v => Math.round(v)), counts: Array.from(this.counts, v => Math.round(v)), threads: [] };
    const threads = [...this.threads].map(([name, acc]) => [name, acc.ms]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (threads.length) { const live = this.acc; for (const row of threads) if (this.threads.get(row[0]) === live && this.cur === 0) row[1] += now - this.last; }
    const short = key => String(key).replace(/^L/, '').replace(/;->/, '.').replace(/\(.*$/, '');
    const hostRows = [...this.host]; const top = (field) => hostRows.sort((a, b) => b[1][field] - a[1][field]).slice(0, 5).map(([key, v]) => [short(key), v.n, Math.round(v.ms)]);
    const seconds = Math.max(0.05, (now - this.startedAt) / 1000), pollers = [];
    for (const acc of this.threads.values()) {
      if (acc.calls / seconds < 50000) continue;
      const rows = [...acc.hosts].sort((a, b) => b[1] - a[1]), two = rows.slice(0, 2); if (two.reduce((sum, row) => sum + row[1], 0) < acc.calls * 0.9) continue;
      pollers.push({ thread: acc.name, perSecond: Math.round(acc.calls / seconds), calls: two.map(([key, n]) => [short(key), n]) });
    }
    return { pollers, hostByCount: top('n'), hostByTime: top('ms'), ms: Array.from(copy, v => Math.round(v)), counts: Array.from(this.counts, v => Math.round(v)), threads: threads.map(([name, ms]) => [name, Math.round(ms)]) };
  }
  /** The rest of the text of an operation (polling threads, core time by thread, the host calls), after the buckets line. */
  static details(snapshot) {
    if (!snapshot) return '';
    return `${(snapshot.pollers ?? []).map(p => `; thread ${p.thread} is polling (${p.perSecond} host calls/s): ${p.calls.map(([key, n]) => `${key} ${n}×`).join(', ')}`).join('')}; core time by thread: ${snapshot.threads.map(([name, ms]) => `${name} ${ms} ms`).join(', ') || '-'}; most frequent host calls: ${(snapshot.hostByCount ?? []).map(([key, n, ms]) => `${key} ${n}× (${ms} ms)`).join(', ') || '-'}; slowest (inclusive time): ${(snapshot.hostByTime ?? []).map(([key, n, ms]) => `${key} ${ms} ms (${n}×)`).join(', ') || '-'}`.replace(/^; /, '');
  }
  static text(snapshot) {
    if (!snapshot) return '';
    return `${bucketsText(snapshot.ms)}; ${TimeBreakdown.details(snapshot)}`;
  }
}

/** The measurement aid behind the Worker's debug-time request (scripts/validation/cpu-breakdown.mjs): cumulative milliseconds and counts of every bucket, the crossings, the glue samples and the calibrated costs. */
export function timeReport(tb) {
  const totals = tb?.cumulative ? tb.cumulative(new Float64Array(BUCKET_COUNT)) : null, cost = tb ? measurementOverhead() : null;
  return { keys: BUCKET_KEYS, ms: totals ? Array.from(totals) : null, counts: tb?.counts ? Array.from(tb.counts, (v, i) => v + (tb.lifeCounts?.[i] ?? 0)) : null,
    crossings: tb ? { total: (tb.lifeCrossings ?? 0) + tb.crossings, timedCalls: tb.lifeTimed + tb.timedCalls, countedCalls: tb.lifeCounted + tb.countedCalls, nestCalls: tb.nestCalls, slowCalls: tb.slowCalls, glueSamples: tb.glueN,
      glueMeanUs: tb.glueN ? Math.round(1e6 * tb.glueSum / tb.glueN) / 1000 : null, glueHistogramUs: tb.glueHist ? Array.from(tb.glueHist) : null, clockResolutionUs: Math.round(cost.resolutionMs * 1e5) / 100,
      overheadUs: Object.fromEntries(Object.entries(cost).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, Math.round(v * 1e6) / 1000])) } : null };
}

/**
 * Where the time of one APK load went: mark(phase) says a phase starts (the loader's progress phases, then 'core' and what follows); the time until the next mark is that
 * phase's. finish() -> { totalMs, phases: [[phase, ms], ...] } with the longest first (at most 16).
 */
export function createLoadTiming(now = () => performance.now()) {
  const started = now(), phases = new Map(); let current = 'start', last = started;
  const close = () => { const at = now(); phases.set(current, (phases.get(current) ?? 0) + (at - last)); last = at; };
  return {
    mark(phase) { close(); current = typeof phase === 'string' && phase ? phase.slice(0, 40) : 'other'; },
    finish() { close(); return { totalMs: Math.round(last - started), phases: [...phases].map(([phase, ms]) => [phase, Math.round(ms)]).filter(row => row[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 16) }; },
  };
}
/** 'APK load: 2140 ms (framework 900 ms, dex 500 ms, ...)' for the diagnostic summary. */
export const loadTimingText = timing => timing ? `APK load: ${timing.totalMs} ms (${timing.phases.slice(0, 8).map(([phase, ms]) => `${phase} ${ms} ms`).join(', ')})` : '';
