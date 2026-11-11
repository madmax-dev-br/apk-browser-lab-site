// vmcore threads, the JavaScript side (vmcore/threads.h has the design): laying out ThreadsState, the linker's request slot (the owner serves, Workers ask), the drivers that
// take a thread's run to its end through the statuses the core returns (OUT_OF_MEMORY: a collection with the world stopped; THREAD_BLOCKED: wait for the word, then resume;
// INTERRUPTED on the owner: serve the linker, then resume), the green scheduler of several Thread records in one JavaScript thread, and the reports a deadlock gets.
//
// What a java.lang.Thread bridge calls (phase 4): setupThreads once; per Java thread a Thread record (its stacks), thr_attach(t, flags) and
// gc_register_thread; a Worker per thread running runBlocking (the env.resolve of its instance is remoteResolver); Thread.interrupt -> thr_interrupt(t); host code that holds a
// Java monitor -> mon_enter/mon_exit exports; a host call that may take long -> thr_host_enter/thr_host_leave around it; the owner's JavaScript (the linker, the hosts) ->
// LinkerServer plus runOwner, or the GreenScheduler where there is no shared memory.

export const STATUS = { OK: 0, BUDGET: 1, OUT_OF_MEMORY: 5, INTERRUPTED: 7, UNCAUGHT: 48, HOST_STOPPED: 64, HOST_FAILED: 65, THREAD_BLOCKED: 80, YIELDED: 81 };
export const THREAD_FIELDS = { tid: 2152, state: 2156, flags: 2160, blockWord: 2164, blockValue: 2168, blockedOn: 2172, waitNext: 2176, waitState: 2180, waitMonitor: 2184,
  waitCount: 2188, waitPhase: 2192, interrupted: 2196, gcSeen: 2200, waitMillis: 2204 };
const T = { ...THREAD_FIELDS, status: 12, detail: 16, interrupt: 20, steps: 32, frame: 2132 };
export const TS = { stop: 0, ackSeq: 4, nextTid: 8, initLock: 12, poolLock: 16, monitors: 20, monitorCap: 24, freeMonitors: 28, monitorsInUse: 32, stops: 36, inflations: 40,
  deflations: 44, contended: 48, vm: 52, reqLock: 56, reqState: 60, reqThread: 64, reqMethod: 68, reqWhat: 72, reqStatus: 76, owner: 80, served: 84, parks: 88, tids: 96, SIZE: 96 + 4 * 1024 };
export const FLAGS = { NO_BLOCK: 1, GREEN: 2 };
export const STATES = ['outside', 'running', 'safe', 'parked'];
export const MONITOR_BYTES = 48, MONITORS = 4096;
const GC_COLLECTIONS = 124, WAIT_LISTED = 1;
const RESOLVE_CODE = 0xffffffff, RESOLVE_WELL_KNOWN = 0xffffff00, METHOD_KIND = 12, METHOD_UNLINKED = 0x7fff0001;

/** ThreadsState and its monitor pool in the linker's metaspace; every Thread record attached in blocking mode. */
export function setupThreads({ exports, linker, threadAt, count }) {
  const ts = linker.alloc(TS.SIZE), poolBytes = MONITORS * MONITOR_BYTES, pool = linker.alloc(poolBytes);
  exports.thr_init(ts, linker.vm, pool, poolBytes);
  for (let i = 0; i < count; i++) {
    if (!exports.thr_attach(threadAt(i), 0)) throw new Error('vmcore threads: no tid left');
  }
  return { ts, pool, monitors: MONITORS };
}

const words = memory => new Int32Array(memory.buffer);
const now = () => performance.now();

// ---- the linker's request slot
/**
 * The owner's side: serves the requests Workers post in ThreadsState (serveOnce), from an idle loop on Atomics.waitAsync (start/stop) or when the owner's own run stops for it.
 * `owner` is the owner's Thread record (no-block): serving enters RUNNING on it, so no collection overlaps the linker (which allocates interned String records).
 */
export class LinkerServer {
  constructor({ memory, exports, linker, ts, owner }) {
    Object.assign(this, { memory, exports, linker, ts, owner }); this.i32 = words(memory); this.active = false; this.served = 0; this.errors = [];
    this.i32[(ts + TS.owner) >> 2] = owner;
  }
  get pending() { return Atomics.load(this.i32, (this.ts + TS.reqState) >> 2) === 1; }
  /** Serves the pending request, if any: true when one was served (false: none, or the world is stopped and the owner cannot enter RUNNING now). */
  serveOnce() {
    const i32 = this.i32, at = name => (this.ts + TS[name]) >> 2;
    if (Atomics.load(i32, at('reqState')) !== 1) return false;
    if (this.exports.thr_enter(this.owner)) return false;
    const t = i32[at('reqThread')] >>> 0, method = i32[at('reqMethod')] >>> 0, what = i32[at('reqWhat')] >>> 0;
    let status;
    try { status = this.alreadyResolved(method, what) ? 0 : this.linker.resolve(t, method, what); }
    catch (error) { status = 34; this.linker.error = String(error?.message ?? error); }
    finally { this.exports.thr_leave(this.owner); }
    if (status) this.errors.push(this.linker.error);
    i32[at('reqStatus')] = status; this.served++; Atomics.add(i32, at('served'), 1);
    Atomics.store(i32, at('reqState'), 2); Atomics.notify(i32, at('reqState'));
    return true;
  }
  /** Two threads may ask for the same constant or code before either is published: the second request finds it done. */
  alreadyResolved(method, what) {
    if (what >= RESOLVE_WELL_KNOWN && what !== RESOLVE_CODE) return false;
    if (what === RESOLVE_CODE) return (Atomics.load(this.i32, (method + METHOD_KIND) >> 2) >>> 0) !== METHOD_UNLINKED;
    const mi = this.linker.methodsAt.get(method);
    return !!mi?.poolAddress && Atomics.load(this.i32, (mi.poolAddress + 16 * what) >> 2) !== 0;
  }
  start() { if (!this.active) { this.active = true; this.done = this.loop(); } return this; }
  async stop() { this.active = false; Atomics.notify(this.i32, (this.ts + TS.reqState) >> 2); await this.done; }
  async loop() {
    const i32 = this.i32, state = (this.ts + TS.reqState) >> 2, stop = (this.ts + TS.stop) >> 2;
    while (this.active) {
      const value = Atomics.load(i32, state);
      if (value === 1) {
        if (this.serveOnce()) continue;
        const s = Atomics.load(i32, stop); const w = Atomics.waitAsync(i32, stop, s, 50); if (w.async) await w.value;   // a stop of the world: serve after it
        continue;
      }
      const w = Atomics.waitAsync(i32, state, value, 200); if (w.async) await w.value;
    }
  }
}

/** A Worker's env.resolve: the request goes to the owner through the slot; the thread is THREAD_SAFE while it waits (its stack top is published by the core before it asks). */
export function remoteResolver({ memory, exports, ts }) {
  const i32 = words(memory), at = name => (ts + TS[name]) >> 2;
  return (t, method, what) => {
    t >>>= 0;
    exports.thr_host_enter(t);
    const tid = i32[(t + T.tid) >> 2];
    for (;;) { const holder = Atomics.compareExchange(i32, at('reqLock'), 0, tid); if (holder === 0) break; Atomics.wait(i32, at('reqLock'), holder, 5); }
    i32[at('reqThread')] = t; i32[at('reqMethod')] = method; i32[at('reqWhat')] = what;
    Atomics.store(i32, at('reqState'), 1); Atomics.notify(i32, at('reqState'));
    const owner = Atomics.load(i32, at('owner')); if (owner) Atomics.store(i32, (owner + T.interrupt) >> 2, 1);   // the doorbell, should the owner be running Java
    while (Atomics.load(i32, at('reqState')) !== 2) Atomics.wait(i32, at('reqState'), 1, 50);
    const status = i32[at('reqStatus')];
    Atomics.store(i32, at('reqState'), 0); Atomics.store(i32, at('reqLock'), 0); Atomics.notify(i32, at('reqLock'), 1);
    exports.thr_host_leave(t);
    return status;
  };
}

// ---- drivers
/**
 * A blocking thread (a Worker) runs method `id` to its end: OUT_OF_MEMORY collects with the world stopped (or waits for the thread that does) and resumes; three stops in a row
 * without progress after collections throw OutOfMemoryError (throw_oom). `pauses` (an array) gets { stopMs, collectMs } for every collection this thread ran. Returns the status, the
 * collections it ran, its OUT_OF_MEMORY stops and the time it spent outside its run for them (collecting, or waiting for another thread's collection).
 */
export function runBlocking({ memory, exports, ts, h }, t, id, args, { pauses = null } = {}) {
  const i32 = words(memory), view = new DataView(memory.buffer);
  const steps = () => view.getBigUint64(t + T.steps, true);
  let status = exports.run(t, id, args), lastSteps = -1n, stuck = 0, collections = 0, stops = 0, outsideMs = 0;
  for (;;) {
    if (status === STATUS.THREAD_BLOCKED && !i32[(t + T.frame) >> 2]) { status = exports.run(t, id, args); continue; }   // cannot happen to a blocking thread; kept for symmetry
    if (status !== STATUS.OUT_OF_MEMORY || !i32[(t + T.frame) >> 2]) return { status, collections, stops, outsideMs };
    const at = steps(), started = now();
    stuck = at === lastSteps ? stuck + 1 : 0; lastSteps = at; stops++;
    if (stuck >= 3) { status = exports.throw_oom(t); stuck = 0; continue; }
    if (collectAsStopper({ memory, exports, ts, h }, t, pauses)) collections++;
    outsideMs += now() - started;
    status = exports.resume(t);
  }
}
/** thr_collect with the phases timed: true if this thread collected. */
export function collectAsStopper({ memory, exports, ts, h }, t, pauses) {
  const i32 = words(memory), seen = () => i32[(t + T.gcSeen) >> 2] >>> 0, collections = () => Atomics.load(i32, (h + GC_COLLECTIONS) >> 2) >>> 0;
  for (;;) {
    if (collections() !== seen()) return false;
    if (exports.thr_stop_begin(t)) break;
    const s = Atomics.load(i32, (ts + TS.stop) >> 2); if (s) Atomics.wait(i32, (ts + TS.stop) >> 2, s);
  }
  if (collections() !== seen()) { exports.thr_stop_end(t); return false; }
  const t0 = now(); exports.thr_stop_wait(t); const t1 = now(); exports.thr_collect_now(t); const t2 = now(); exports.thr_stop_end(t);
  pauses?.push({ stopMs: t1 - t0, collectMs: t2 - t1 });
  return true;
}
/** A no-block thread's collection (it may not block): stop, poll until every other thread left RUNNING, collect, release. */
export async function collectNoBlock({ memory, exports, ts, h }, t) {
  const i32 = words(memory), collections = () => Atomics.load(i32, (h + GC_COLLECTIONS) >> 2) >>> 0, seen = i32[(t + T.gcSeen) >> 2] >>> 0;
  while (!exports.thr_stop_begin(t)) {
    if (collections() !== seen) return false;
    const s = Atomics.load(i32, (ts + TS.stop) >> 2); if (s) { const w = Atomics.waitAsync(i32, (ts + TS.stop) >> 2, s, 50); if (w.async) await w.value; }
  }
  if (collections() !== seen) { exports.thr_stop_end(t); return false; }
  while (exports.thr_stop_pending(t)) { const seq = Atomics.load(i32, (ts + TS.ackSeq) >> 2); const w = Atomics.waitAsync(i32, (ts + TS.ackSeq) >> 2, seq, 1); if (w.async) await w.value; }
  exports.thr_collect_now(t); exports.thr_stop_end(t);
  return true;
}
/**
 * The owner's own run (a no-block thread in the thread that owns the linker): INTERRUPTED (the doorbell) serves the linker; THREAD_BLOCKED waits for its word asynchronously
 * (the server keeps serving meanwhile); OUT_OF_MEMORY collects with collectNoBlock.
 */
export async function runOwner(core, server, t, id, args) {
  const { memory, exports } = core, i32 = words(memory);
  let status = exports.run(t, id, args);
  for (;;) {
    if (status === STATUS.INTERRUPTED) { Atomics.store(i32, (t + T.interrupt) >> 2, 0); server.serveOnce(); status = exports.resume(t); continue; }
    if (status === STATUS.THREAD_BLOCKED) {
      const word = i32[(t + T.blockWord) >> 2] >>> 0, value = i32[(t + T.blockValue) >> 2];
      if (Atomics.load(i32, word >> 2) === value) { const w = Atomics.waitAsync(i32, word >> 2, value, 20); if (w.async) await w.value; }
      if (i32[(t + T.waitPhase) >> 2] === WAIT_LISTED) { /* a timed wait of the owner: not used by the tests (no clock here) */ }
      status = i32[(t + T.frame) >> 2] ? exports.resume(t) : exports.run(t, id, args); continue;
    }
    if (status === STATUS.OUT_OF_MEMORY && i32[(t + T.frame) >> 2]) { await collectNoBlock({ memory, exports, ts: core.threads.ts, h: core.h }, t); status = exports.resume(t); continue; }
    return status;
  }
}

/**
 * Green threads: several Thread records run by one JavaScript thread (no shared memory needed; the same core, every thread THREAD_NO_BLOCK | THREAD_GREEN), round robin,
 * a quantum each (YIELDED). A blocked thread is ready again once its word differs from the value it waited on, or its Object.wait timed out (thr_wait_timeout, by the real clock).
 * Collections are the caller's (`collect`, with every thread OUTSIDE). run() returns when every thread ended, or reports a deadlock: every thread left blocked and none can move.
 */
export class GreenScheduler {
  constructor({ memory, exports, collect }) { Object.assign(this, { memory, exports, collect }); this.threads = []; this.switches = 0; }
  spawn(t, id, args) { this.exports.thr_set_flags(t, FLAGS.NO_BLOCK | FLAGS.GREEN); const thread = { t, id, args, state: 'new', status: null, deadline: 0 }; this.threads.push(thread); return thread; }
  ready(thread) {
    const u32 = new Uint32Array(this.memory.buffer), t = thread.t;
    if (thread.state === 'new' || thread.state === 'runnable') return true;
    if (thread.state !== 'blocked') return false;
    if (u32[u32[(t + T.blockWord) >> 2] >> 2] !== u32[(t + T.blockValue) >> 2]) return true;
    if (thread.deadline && now() >= thread.deadline) { this.exports.thr_wait_timeout(t); thread.deadline = 0; return true; }
    return false;
  }
  step(thread) {
    const { exports } = this, u32 = new Uint32Array(this.memory.buffer), t = thread.t, view = new DataView(this.memory.buffer);
    let status = thread.state === 'new' || (thread.state === 'blocked' && !u32[(t + T.frame) >> 2]) ? exports.run(t, thread.id, thread.args) : exports.resume(t);
    this.switches++;
    for (let stuck = 0, last = -1n; status === STATUS.OUT_OF_MEMORY && u32[(t + T.frame) >> 2];) {
      const steps = view.getBigUint64(t + T.steps, true); stuck = steps === last ? stuck + 1 : 0; last = steps;
      if (stuck >= 2) { status = exports.throw_oom(t); continue; }
      this.collect(); status = exports.resume(t);
    }
    thread.status = status;
    if (status === STATUS.YIELDED) thread.state = 'runnable';
    else if (status === STATUS.THREAD_BLOCKED) {
      thread.state = 'blocked';
      const millis = u32[(t + T.waitMillis) >> 2];
      if (!thread.deadline && u32[(t + T.waitPhase) >> 2] === WAIT_LISTED && millis) thread.deadline = now() + millis;
      if (u32[(t + T.waitPhase) >> 2] !== WAIT_LISTED) thread.deadline = 0;
    } else thread.state = 'done';
  }
  /** Runs until every thread is done; { deadlock: report } if they all wait for each other. */
  async run({ timeoutMs = 60000 } = {}) {
    const started = now();
    for (let i = 0; ; i = (i + 1) % this.threads.length) {
      if (this.threads.every(th => th.state === 'done')) return { deadlock: null, switches: this.switches };
      const thread = this.threads[i];
      if (this.ready(thread)) { this.step(thread); continue; }
      if (this.threads.some(th => this.ready(th))) continue;
      const timed = this.threads.filter(th => th.state === 'blocked' && th.deadline);
      if (!timed.length) return { deadlock: describeThreads(this.memory, this.exports, this.threads.filter(th => th.state !== 'done').map(th => th.t)), switches: this.switches };
      if (now() - started > timeoutMs) throw new Error('green scheduler: timed out');
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(...timed.map(th => th.deadline)) - now())));
    }
  }
}

/** What each thread is doing, and the monitors they hold or wait for: { threads: [{ t, tid, state, blockedOn, owner, ownerTid }], cycle: [tids] | null }. */
export function describeThreads(memory, exports, threads) {
  const u32 = new Uint32Array(memory.buffer), byTid = new Map();
  const rows = threads.map(t => {
    const tid = u32[(t + T.tid) >> 2], blockedOn = u32[(t + T.blockedOn) >> 2], ownerTid = blockedOn ? exports.mon_owner(blockedOn, 0) : 0;
    const row = { t, tid, state: STATES[u32[(t + T.state) >> 2]] ?? '?', status: u32[(t + T.status) >> 2], blockedOn, ownerTid };
    byTid.set(tid, row); return row;
  });
  let cycle = null;
  for (const start of rows) {
    const seen = []; let row = start;
    while (row && row.blockedOn && row.ownerTid && !seen.includes(row.tid)) { seen.push(row.tid); row = byTid.get(row.ownerTid); }
    if (row && seen.includes(row.tid)) { cycle = seen.slice(seen.indexOf(row.tid)); break; }
  }
  return { threads: rows, cycle };
}
