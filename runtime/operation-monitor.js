import { TimeBreakdown } from './time-breakdown.js?v=eb9f345313a7';
import { APKError } from './apk-error.js?v=eb9f345313a7';
import { gcBlockReason } from './heap-gc.js?v=eb9f345313a7';
import { Blocked } from './scheduler.js?v=eb9f345313a7';

// What the VM is doing during one page request (launch, click, back, ...) and during the scheduled pumps in between, seen from inside the Worker:
//  - a heartbeat posted to the page every ~250 ms of wall time at the scheduler tick, and at the entry of the host calls that can run long (zip/inflate, class loading, regex/ICU, Skia, image decode,
//    SQLite, crypto, file mapping, wasm, sleep/park). postMessage from a synchronous loop reaches the page at once, so the page knows what the VM last did even if the Worker never answers;
//  - an operation wall budget (host time of the whole operation, not of one event): a pump that keeps scheduling short events (a self-rescheduling Handler loop, a polling thread, a Timer) restarts
//    the per-event watchdog every time, so only this budget ends it, with the execution profile and the list of what kept being scheduled.
const SLOW_HOST = /Inflater|Deflater|java\/util\/zip|ZipFile|ZipEntry|DexFile|DexClassLoader|PathClassLoader|ClassLoader;->(?:loadClass|defineClass|findClass)|regex\/|Pattern;|Matcher;|\/icu\/|Icu|Collator|BreakIterator|Normalizer|Skia|Paragraph|Bitmap|ImageDecoder|sqlite|SQLite|Cipher|MessageDigest|Mac;|Signature;|KeyStore|Crypto|conscrypt|Thread;->sleep|LockSupport|MappedByteBuffer|FileChannel|Linux;|Hermes|NativeLibrary|System;->load|Runtime;->load|AssetManager|XmlBlock|ApkAssets|Resources;->(?:getValue|obtain)|Typeface|FontFamily|Gzip|Zlib|ObjectInputStream|MessageFormat|NumberFormat|DateFormat|URLConnection|HttpURLConnection/;
// Host calls a busy-wait loop makes and that hold no host state while other threads run (spinCheck): atomic reads and CAS, Thread.yield/onSpinWait, the clocks.
const SPIN_SAFE = /\/atomic\/Atomic[A-Za-z]*;->(?:get|compareAndSet|weakCompareAndSet)|Thread;->(?:yield|onSpinWait)\(|System;->(?:nanoTime|currentTimeMillis)\(|SystemClock;->(?:uptimeMillis|elapsedRealtime)|Unsafe;->get[A-Za-z]*Volatile/;
const SPIN_SAMPLES = 4, SPIN_AFTER_MS = 50, SPIN_SLICE_MS = 8;
const safe = fn => { try { return fn(); } catch { return null; } };   // a heartbeat never fails the VM
const short = key => String(key ?? '?').replace(/^L/, '').replace(/;->/, '.');
const typeName = type => String(type ?? '?').replace(/^L/, '').replace(/;$/, '').replaceAll('/', '.');

export class OperationMonitor {
  constructor(runtime) {
    this.rt = runtime; this.mainEvent = null; this.mainBusy = null; this.mainBusyReportMs = 10000; this.mainEventCapMs = 120000; this.hardCapMs = 180000; this.backgroundBudgetMs = 120000; this.sink = null; this.intervalMs = 250; this.budgetMs = 0; this.op = null; this.lastBeat = 0; this.beats = 0; this.hostCount = 0; this.active = false;
  }
  /** sink(message) posts a heartbeat; budgetMs = wall budget per operation (0 = none); intervalMs = heartbeat period. */
  configure({ sink = null, budgetMs = 0, intervalMs = 250 } = {}) { this.sink = sink; this.budgetMs = budgetMs; this.intervalMs = intervalMs; this.active = sink !== null || budgetMs > 0; return this; }
  begin(name) {
    const now = performance.now();
    this.op = { name, start: now, events: 0, pump: new Map(), slices: new Map(), wakes: new Map(), expired: false, startInstructions: this.instructions() };
    this.lastBeat = now; this.rt.hostCall = null; this.rt.tb?.reset();
    if (this.sink) this.beat(now, 'begin');
  }
  end() { this.lastWakes = this.op?.wakes ?? this.lastWakes; if (this.op !== null) this.lastBreakdown = { operation: this.op.name, wallMs: Math.round(performance.now() - this.op.start), instructions: this.instructions() - this.op.startInstructions, events: this.op.events, ...this.rt.tb.snapshot() }; if (this.lastBreakdown && this.lastBreakdown.wallMs > (this.biggestBreakdown?.wallMs ?? -1)) this.biggestBreakdown = this.lastBreakdown; this.op = null; this.rt.hostCall = null; }
  instructions() { const by = this.rt.executionByOrigin; return (by?.apk?.instructions ?? 0) + (by?.framework?.instructions ?? 0); }

  /** Cheap check at the scheduler tick, thread switches, idle rounds and event dispatch: heartbeat when due, operation budget. */
  /** A host event is about to run on the main thread (a Handler message, a posted task): the watchdog below measures how long it keeps the main thread without returning to the looper. */
  mainEventBegin(what) { this.mainEvent = { start: performance.now(), what, captured: 0, capturedAt: 0, parent: this.mainEvent }; }
  mainEventEnd() {
    const event = this.mainEvent; if (!event) return; this.mainEvent = event.parent ?? null;
    if (event?.captured && this.mainBusy) { this.mainBusy.endedAfterMs = Math.round(performance.now() - event.start); this.mainBusy.ended = true; }   // the report keeps the last long episode
  }
  /** Main thread busy for more than 10 s inside one event: remember its frames, hottest methods of the last seconds and the host call in progress (every 2 s), and end it with a named error at the hard cap. */
  watchMain(now) {
    const event = this.mainEvent; if (event === null || event === undefined) return;
    const busyMs = now - event.start;
    if (busyMs >= this.mainBusyReportMs && now - event.capturedAt >= 2000) this.captureMainBusy(event, now);
    if (busyMs >= this.mainEventCapMs && this.rt.thread === this.rt.scheduler.main) {
      this.captureMainBusy(event, now); this.mainBusy.ended = true; this.mainBusy.endedAfterMs = Math.round(busyMs); this.mainBusy.capped = true; this.mainEvent = event.parent ?? null;
      throw new APKError(`The main thread stayed ${Math.round(busyMs / 1000)} s inside a single event (${event.what}) without returning to the looper; limit ${Math.round(this.mainEventCapMs / 1000)} s. ${this.mainBusyText()}`, { kind: 'main-event-hard-cap', busyMs: Math.round(busyMs), event: event.what, mainBusy: this.mainBusy });
    }
  }
  captureMainBusy(event, now) {
    const rt = this.rt, main = rt.scheduler?.main, frames = [];
    for (let at = (main?.frames?.length ?? 0) - 1; at >= 0 && frames.length < 8; at--) { const key = main.frames[at]?.method?.key; if (key !== undefined) frames.push(short(key)); }
    event.captured++; event.capturedAt = now;
    let hot = []; try { hot = rt.profile.recentTopOf('main', 3); if (!hot.length) hot = rt.profile.topOf('main', 3); } catch { /* profile not collecting yet */ }
    const inside = main?.nestedDepth > 0 || rt.thread !== main;
    this.mainBusy = { event: event.what, busyMs: Math.round(now - event.start), frames, hot, hostCall: rt.hostCall ? short(rt.hostCall) : null, resourceCall: typeof rt.lastResourceCall === 'function' ? rt.lastResourceCall() : rt.lastResourceCall ?? null, thread: rt.thread?.name ?? null, nested: !!inside, ended: false, overdue: this.overdueMessages() };
  }
  overdueMessages() { const platform = this.rt.platform, queue = platform?.eventQueue ?? [], clock = platform?.clock?.now?.() ?? 0, late = queue.filter(event => !event.front && Number.isFinite(event.when) && event.when < clock - 50); return { count: late.length, oldestMs: late.length ? Math.round(Math.max(...late.map(event => clock - event.when))) : 0 }; }
  mainBusyText() { const b = this.mainBusy; return b ? `Main thread loop: ${b.hot.join(', ') || '(no samples)'}; frames: ${b.frames.join(' <- ') || '(none)'}${b.hostCall ? `; inside the host call ${b.hostCall}` : ''}${b.resourceCall ? ` [${b.resourceCall}]` : ''}.` : ''; }
  tick() {
    if (this.mainEvent) this.watchMain(performance.now());
    if (!this.active) return;
    const now = performance.now();
    if (this.sink !== null && now - this.lastBeat >= this.intervalMs) this.beat(now, 'tick');
    const op = this.op;
    if (op !== null && this.budgetMs > 0 && !op.expired && now - op.start > this.budgetMs) {
      // Only main-thread work fails the operation. A background thread that overruns is preempted (its slice ends at the next quantum and it keeps running in later rounds), never the reason the app dies.
      const rt = this.rt, main = rt.scheduler.main, background = rt.thread !== null && rt.thread !== main, mainWaiting = main?.state === 'blocked';
      if (background || mainWaiting) {   // the main thread is waiting for (or the budget ran out inside) other threads' work: it is not what overran
        op.overrun ??= { thread: rt.thread?.name ?? null, atMs: Math.round(now - op.start), mainWaiting };
        if (background && rt.sliceDeadline !== 0) { rt.sliceDeadline = 1; op.backgroundOverruns = (op.backgroundOverruns ?? 0) + 1; return; }
        if (now - op.start <= this.backgroundBudgetMs) return;   // a nested wait cannot be unwound; the heartbeat keeps the page informed, the extended budget bounds it
      }
      if (this.progressing(op, now)) return;   // the soft limit passed but the operation is advancing: it keeps running until the hard cap, and the page is told it is still working
      this.expire(now);
    }
  }
  /**
   * Past the soft wall budget (budgetMs): an operation whose instruction count keeps advancing -- a first composition in the browser runs at hundreds of ns per instruction, so a big app needs
   * far more than 20 s -- is not killed. It is checked every 2 s of host time: at least 20k instructions since the previous check is progress. The hard cap (hardCapMs) still ends it.
   */
  progressing(op, now) {
    if (now - op.start > this.hardCapMs) return false;
    const instructions = this.instructions();
    if (op.soft === undefined && op.events * 1000 / Math.max(1, now - op.start) > 100) return false;   // thousands of tiny events per second: a pump that spins, not a long event that works
    if (op.soft === undefined) { op.soft = { checkAt: now + 2000, instructions, events: op.events, stalls: 0 }; this.beat(now, 'soft'); return true; }
    if (now < op.soft.checkAt) return true;
    // Progress is long-running events that execute instructions (a first composition: tens of events in 20 s). A pump that runs thousands of tiny events (a self-rescheduling loop) is spinning, not progressing.
    const advanced = instructions - op.soft.instructions, events = op.events - op.soft.events;
    op.soft.instructions = instructions; op.soft.events = op.events; op.soft.checkAt = now + 2000;
    if (advanced >= 100000 && events < 400) { op.soft.stalls = 0; this.beat(now, 'soft'); return true; }
    return ++op.soft.stalls < 2;   // two windows (4 s) of no real progress: expire with the report
  }
  /** A host call is starting: remember it (the page sees it in the next heartbeat) and, for the calls known to run long, post a heartbeat right away so a hang inside names its culprit. */
  hostEnter(key, holder) {
    this.rt.hostCall = key;
    if (this.sink === null) { if ((++this.hostCount & 255) === 0 && this.mainEvent !== null) this.spinCheck(key, performance.now()); return; }
    let slow = holder.slowHost;
    if (slow === undefined) slow = holder.slowHost = SLOW_HOST.test(key);
    if (slow) { const now = performance.now(); if (now - this.lastBeat >= 50) this.beat(now, 'host'); return; }
    // The WebAssembly core runs the main thread without quanta (it never returns to the scheduler tick inside an event): its host calls are where a long main-thread event can
    // still be seen. Every 256th one checks the clock: the heartbeat when due, and the main-thread watchdog (report after 10 s, the named error at the hard cap).
    if ((++this.hostCount & 255) !== 0) return;
    const now = performance.now();
    if (this.mainEvent) { this.watchMain(now); this.spinCheck(key, now); }
    if (now - this.lastBeat >= this.intervalMs) this.beat(now, 'host');
  }
  /**
   * A main thread that busy-waits for another thread (it re-reads an atomic field, the clock or yields, in a loop, until a background thread changes the value) would never end here:
   * on a device the other thread runs on another core meanwhile, but the lab's main thread keeps the processor for the whole event. When the same spin-safe host call is the main
   * thread's every sampled call (every 256th) for SPIN_SAMPLES samples, and the event has run longer than SPIN_AFTER_MS, the other threads get a slice of up to SPIN_SLICE_MS right
   * there, as a nested wait whose reason (spin-wait) lets no main-thread message run: the parallelism of a device, not a reordering of the main thread's own work.
   */
  spinCheck(key, now) {
    const rt = this.rt, scheduler = rt.scheduler, main = scheduler?.main;
    if (!main || rt.thread !== main || !SPIN_SAFE.test(key)) { this.spinKey = null; this.spinRun = 0; return; }
    if (key !== this.spinKey) { this.spinKey = key; this.spinRun = 1; return; }
    if (++this.spinRun < SPIN_SAMPLES || now - this.mainEvent.start < SPIN_AFTER_MS || this.spinning) return;
    const others = () => scheduler.threads.some(thread => thread !== main && thread.state === 'runnable' && thread.nestedDepth === 0 && !scheduler.waitingNested.has(thread));
    scheduler.wake(); if (!others()) return;
    const until = now + SPIN_SLICE_MS; this.spinning = true; this.spinYields = (this.spinYields ?? 0) + 1;
    try { scheduler.resolveNested(new Blocked({ reason: `spin-wait (${short(key)})`, ready: () => performance.now() >= until || !others() })); }
    finally { this.spinning = false; }
  }
  /** A long host-side phase (a collection) reports progress: heartbeat when due, labelled, without the operation-budget check (the phase cannot be abandoned half way). */
  pulse(label) {
    if (this.sink === null) return;
    const now = performance.now(); if (now - this.lastBeat < this.intervalMs) return;
    this.rt.hostCall = label; this.beat(now, 'gc');
  }
  /** The VM context of an internal error: operation, thread, innermost Java frames, host call in progress. */
  context() {
    const rt = this.rt;
    try { return { operation: this.op?.name ?? null, thread: rt.thread?.name ?? null, stack: rt.profile.currentStack(6), hostCall: rt.hostCall ? short(rt.hostCall) : null }; } catch { return { operation: this.op?.name ?? null }; }
  }
  snapshot(now, reason) {
    const rt = this.rt, op = this.op, thread = rt.thread, profile = rt.profile;
    let nextDelay = null, queueDepth = null;
    try { queueDepth = rt.platform?.eventQueue?.length ?? null; nextDelay = rt.platform?.nextEventDelay?.() ?? null; } catch { /* a heartbeat never fails the VM */ }
    return {
      type: 'heartbeat', reason, soft: op?.soft !== undefined, gc: { count: op?.gcCount ?? 0, ms: Math.round(op?.gcMs ?? 0), total: rt.gcStats?.collections ?? 0 }, operation: op?.name ?? null, wallMs: op ? Math.round(now - op.start) : null, instructions: this.instructions(), events: op?.events ?? 0, thread: thread?.name ?? null,
      stack: profile.currentStack(6), hostCall: rt.hostCall ? short(rt.hostCall) : null, queueDepth, nextDelay, busiest: profile.top(3), heartbeat: ++this.beats,
      vm: { objects: rt.heap?.size ?? null, limit: rt.maxHeapObjects ?? null, collections: rt.gcStats?.collections ?? 0, gcMs: Math.round(rt.gcStats?.totalMs ?? 0), activity: rt.activityType ?? null, gcEnabled: !!rt.gcEnabled, gcBlocked: safe(() => gcBlockReason(rt)), gcSkips: { ...(rt.gcSkips ?? {}) }, nestedRuns: rt.nestedRuns ?? 0, gcFloor: rt.gcSafepointFloor ?? null },   // what the page can still show when the Worker is too busy to answer a request
    };
  }
  beat(now, reason) {
    this.lastBeat = now;
    if (this.sink === null) return;
    try { this.sink(this.snapshot(now, reason)); } catch { /* a heartbeat never fails the VM */ }
  }

  /** A queued event is about to run (Handler message or host task): count it and what it is. */
  eventRan(event) {
    const op = this.op; if (op === null) return;
    op.events++;
    const rt = this.rt; let key;
    try {
      if (event.platformTask) key = `host task ${event.platformTask.name || '(anonymous)'}`;
      else {
        const handler = typeName(rt.typeOf(event.handler)), host = rt.platform.looperHost, callback = host.callbackOf(rt, event.message), what = callback ? 0 : host.whatOf(rt, event.message);
        key = `Handler ${handler} → ${callback ? typeName(rt.typeOf(callback)) : 'what=' + what}`;
      }
    } catch { key = 'evento'; }
    let entry = op.pump.get(key);
    if (entry === undefined) { if (op.pump.size >= 256) return; op.pump.set(key, entry = { count: 0, first: event.when ?? 0, last: event.when ?? 0 }); }
    entry.count++; entry.last = event.when ?? entry.last;
  }
  /** A blocked thread became runnable again (signal/unpark/notify, timeout or interrupt): counted per thread, wait primitive and cause, so a spin made of instant wake-ups is visible. */
  noteWake(thread, blocked, cause) {   // cause: 0 interrupt, 1 signal, 2 timeout -- counters only: no strings or stacks on the scheduler's hot path
    const op = this.op; if (op === null) return;
    let row = op.wakes.get(thread); if (row === undefined) op.wakes.set(thread, row = { reason: blocked.reason, counts: [0, 0, 0] });
    row.reason = blocked.reason; row.counts[cause]++;
  }
  /** An unpark: who woke whom, from which Java frame -- a storm (unparks of a thread that parks again at once) shows up as one very large row. */
  noteUnpark(targetState, unparker) {   // counters keyed by objects; the names and the top frame are rendered only when a report is built
    const op = this.op; if (op === null) return;
    const byTarget = (op.unparks ??= new Map()).get(unparker ?? 'host') ?? op.unparks.set(unparker ?? 'host', new Map()).get(unparker ?? 'host');
    byTarget.set(targetState, (byTarget.get(targetState) ?? 0) + 1);
  }
  /** Threads that are about to get a slice of the processor. */
  sliceRan() {
    const op = this.op; if (op === null) return;
    for (const thread of this.rt.scheduler.threads) if (thread.state === 'runnable' && thread.nestedDepth === 0) op.slices.set(thread.name, (op.slices.get(thread.name) ?? 0) + 1);
  }
  /** Where execution stands: which thread runs, the main thread's state, how many runs are nested on the JavaScript stack and whether slices can be preempted right now. */
  executionLine() {
    const rt = this.rt, main = rt.scheduler.main, thread = rt.thread;
    return `${this.gcLine()}\n${this.schedulerLine()}\nExecution: current thread ${thread?.name ?? 'none'}${thread === main ? ' [main]' : ''}; main thread ${main ? `${main.state}${main.blocked ? ` (${main.blocked.reason ?? 'waiting'})` : ''}` : '?'}; nested runs on the JavaScript stack: ${rt.nestedRuns}; dispatch depth: ${rt.depth}; time-limited background slice: ${rt.sliceDeadline !== 0 ? 'yes' : 'no (main event or nested wait: it cannot be interrupted)'}${rt.hostCall ? `; host call: ${short(rt.hostCall)}` : ''}`;
  }
  wakeRows(op, limit) {
    const CAUSES = ['interrupt', 'signal', 'timed out'];
    return [...op.wakes].map(([thread, row]) => ({ thread, total: row.counts[0] + row.counts[1] + row.counts[2], row })).sort((a, b) => b.total - a.total).slice(0, limit)
      .map(({ thread, total, row }) => ({ count: total, key: `${thread.name} · ${row.reason ?? 'waiting'} · ${row.counts.map((n, i) => n ? `${n} ${CAUSES[i]}` : '').filter(Boolean).join(', ')}` }));
  }
  unparkRows(op, limit) {
    const rows = [];
    for (const [unparker, targets] of op.unparks) {
      const frames = unparker?.frames, top = frames?.length ? short(frames.at(-1).method?.key) : 'host code';
      for (const [target, count] of targets) rows.push({ count, key: `${unparker?.name ?? 'host'} (${top}) woke ${target.name ?? target.threadName ?? 'a thread'}` });
    }
    return rows.sort((a, b) => b.count - a.count).slice(0, limit);
  }
  /** Scheduler cost counters for the reports: rounds (thread picks) and wake-ups, with per-second rates over the operation. */
  /** GC attribution: collections and time in this operation, the share of the operation's wall time, and the phases of the last collections. */
  gcLine() {
    const rt = this.rt, op = this.op, phases = rt.gcPhases ?? [];
    const share = op && op.gcMs ? ` (${Math.round(100 * op.gcMs / Math.max(1, op.gcMs + performance.now() - op.start))}% of the operation time)` : '';
    const tries = rt.gcSafepointTries ?? { calls: 0, notDue: 0, disabled: 0 }, skips = Object.entries(rt.gcSkips ?? {}).map(([why, n]) => `${why} ${n}x`).join(', ') || 'none';
    let blocked = null; try { blocked = gcBlockReason(rt); } catch { blocked = '?'; }
    const gate = `\n  collector: ${rt.gcEnabled ? 'on' : 'OFF'}; safepoints that asked for a collection ${tries.calls} (not due ${tries.notDue}, deferred by motion ${tries.deferred ?? 0}, collector off ${tries.disabled}); skipped collections: ${skips}; now ${blocked ? `blocked by "${blocked}"` : 'free'}; allocated since the last ${Math.max(0, (rt.nextId ?? 0) - (rt.gcLastNextId ?? 0))}, minimum wait ${rt.gcMinAlloc ?? 0}, next from ${rt.gcNextAt ?? '?'} live, floor ${rt.gcSafepointFloor ?? '?'}, pressure ${rt.gcPressure ? 'yes' : 'no'}, the last took ${Math.round(rt.gcLastMs ?? 0)} ms`;
    // Collections deferred while the screen was in motion (heap-gc.js deferral): episodes closed at an idle moment or forced by a ceiling, and the one still open.
    const d = rt.gcDeferralStats, open = rt.gcDeferral, motion = (() => { try { return rt.platform?.mainThreadMotion?.() ?? null; } catch { return '?'; } })();
    const deferrals = `\n  deferrals during motion: ${d ? `${d.episodes} (${d.idle} collected at rest, ${d.forced} forced by the ceiling${d.forced ? ': ' + Object.entries(d.forcedBy).map(([why, n]) => `${why} ${n}x`).join(', ') : ''}${d.absorbed ? `, ${d.absorbed} absorbed by another collection` : ''}; longest wait ${d.maxMs} ms, ${d.maxAllocated} objects)` : 'none'}; now ${open ? `deferred for ${Math.round(performance.now() - open.since)} ms (${open.held} checks: ${Object.entries(open.reasons).map(([why, n]) => `${why} ${n}x`).join(', ')}; ceiling ${open.ceiling} live or ${Math.max(0, Math.round(open.until - performance.now()))} ms)` : `none deferred; main thread ${motion ? `in motion (${motion})` : 'idle'}`}`;
    // Generations (heap-gc.js, "Young generation"): how many collections were minor ones, their pauses and what they rescan.
    const m = rt.gcMinorStats, gen = rt.gcGenerational === false ? '\n  generations: off (every collection marks the whole heap)' : m ? `\n  generations: ${m.collections} minor collections (${Math.round(m.totalMs)} ms, longest pause ${Math.round(m.maxMs)} ms; the last ${m.recent.at(-1)?.ms ?? 0} ms ${m.recent.at(-1)?.motion ? 'in motion' : 'at rest'}), ${m.freed} freed, young generation ${Math.round(rt.gcNurseryNow ?? 0) || '-'} objects; old objects rescanned: remembered ${rt.gcRemList?.length ?? 0}, touched by the host ${rt.gcTouchList?.length ?? 0}, with host state ${rt.gcHostful?.length ?? 0}` : '';
    const head = `Garbage collection: ${op?.gcCount ?? 0} collections / ${Math.round(op?.gcMs ?? 0)} ms in this operation${share}; in total ${rt.gcStats?.collections ?? 0} collections, ${Math.round(rt.gcTotalMs ?? 0)} ms${gate}${deferrals}${gen}`;
    const last = phases[0], census = last ? [
      last.survivorsByCount?.length ? `\n  survivors (by count): ${last.survivorsByCount.slice(0, 12).map(c => `${c.n} ${c.type}`).join(', ')}` : '',
      last.survivorsByBytes?.length ? `\n  survivors (by estimated bytes): ${last.survivorsByBytes.slice(0, 12).map(c => `${Math.round(c.bytes / 1024)} KiB ${c.type}`).join(', ')}` : '',
      last.allocated ? `\n  allocated since the last collection: ${last.allocated.count}${last.allocated.sites?.length ? ', main ones: ' + last.allocated.sites.join(' | ') : ''}` : '',
      rt.gcRetention?.paths?.length ? `\n  retention example (${String(rt.gcRetention.type).replace(/^L|;$/g, '').replaceAll('/', '.')}):${rt.gcRetention.paths.map(path => '\n    ' + path).join('')}` : '',
    ].join('') : '';
    return phases.length ? `${head}${census}\n  latest: ${phases.map(p => `${p.reason}${p.motion ? ` in motion (${p.motion})` : ' at rest'}${p.deferral ? ` after deferring ${p.deferral.ms} ms / ${p.deferral.allocated} objects` : ''}: ${p.before}→${p.after} live [roots ${p.rootsMs} ms (${p.nodes} JS nodes; largest: ${p.worstRoot.key} ${p.worstRoot.ms} ms/${p.worstRoot.nodes}; pruned ${p.pruned ?? 0}; by nodes: ${(p.topByNodes ?? []).map(r => `${r.key} ${r.nodes}${r.kind ? ' ' + r.kind : ''}${r.size !== undefined ? '[' + r.size + ']' : ''}`).join(', ') || '-'}; by time: ${(p.topByMs ?? []).map(r => `${r.key} ${r.ms} ms`).join(', ') || '-'}), marking ${p.markMs} ms, sweep ${p.sweepMs} ms, recount ${p.rebuildMs} ms, ids ${p.idRange} in ${p.blocksInUse} blocks]`).join(' | ')}` : head;
  }
  schedulerLine() {
    const stats = this.rt.scheduler.stats, op = this.op, seconds = op ? Math.max(0.001, (performance.now() - op.start) / 1000) : 0;
    return `Scheduler: ${stats.rounds} rounds, ${stats.wakeups} wakeups${op ? ` (${Math.round(stats.wakeups / seconds)}/s, ${Math.round(stats.rounds / seconds)} rounds/s in this operation)` : ''}, ${this.rt.scheduler.threads.length} threads`;
  }
  pumpReport(limit = 5) {
    const op = this.op; if (op === null) return { text: '', recurring: [], threads: [] };
    const wakes = this.wakeRows(op, limit);
    const recurring = [...op.pump].sort((a, b) => b[1].count - a[1].count).slice(0, limit).map(([key, e]) => ({ target: key, count: e.count, periodMs: e.count > 1 ? Math.round((e.last - e.first) / (e.count - 1)) : null }));
    const threads = [...op.slices].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, slices: count }));
    const lines = [this.executionLine(), `What the VM kept scheduling in this operation (${op.events} events):`,
      ...(op.overrun ? [`Warning: the operation time went over budget while ${op.overrun.mainWaiting ? 'the main thread was waiting for other threads' : 'a background thread'} was running (${op.overrun.thread ?? 'no thread'}, at ${op.overrun.atMs} ms)${op.backgroundOverruns ? `; ${op.backgroundOverruns} slices were interrupted` : ''}`] : []),
      ...recurring.map(row => `  ${row.count}×${row.periodMs === null ? '' : ` every ~${row.periodMs} ms (virtual time)`}  ${row.target}`),
      ...(recurring.length ? [] : ['  (no queued event)']),
      'Thread wakeups (thread · primitive · cause):', ...this.wakeRows(op, limit).map(row => `  ${row.count}× ${row.key}`), ...(op.wakes.size ? [] : ['  (none)']),
      ...(op.unparks?.size ? ['Who woke whom (LockSupport.unpark):', ...this.unparkRows(op, limit).map(row => `  ${row.count}× ${row.key}`)] : []),
      'Threads that received processor time:', ...threads.map(row => `  ${row.slices}× ${row.name}`), ...(threads.length ? [] : ['  (none)'])];
    return { text: lines.join('\n'), recurring, threads, wakes, events: op.events };
  }
  expire(now) {
    const op = this.op; op.expired = true;
    const rt = this.rt, profile = rt.profile.report(), pump = this.pumpReport(), ms = Math.round(now - op.start);
    this.beat(now, 'expired'); const breakdown = rt.tb.snapshot();
    throw new APKError(`The ${op.name} operation used ${ms} ms of host time (limit ${this.budgetMs} ms${op.soft ? `, extended while there was progress up to ${this.hardCapMs} ms` : ''}) without finishing; ${op.events} events and ${this.instructions() - op.startInstructions} instructions in this operation${rt.hostCall ? `; host call in progress: ${short(rt.hostCall)}` : ''}.${rt.profile.summary()}`,
      { kind: 'operation-wall-budget', operation: op.name, wallMs: ms, limitMs: this.budgetMs, events: op.events, pump, timeBreakdown: breakdown, profile: { ...profile, text: `${profile.text}\n${pump.text}\n${TimeBreakdown.text(breakdown)}` } });
  }
}
