// What the VM Worker did, task by task, in the last few seconds: a ring of the Worker's own tasks (a scheduled batch of VM events, the snapshot sent to the page, a page request, a
// slice of a background job such as the API-gap estimate), each with its wall time and how that time split between the runtime's buckets (src/time-breakdown.js: interpreter and
// compiled code, host calls, method preparation on first execution, JIT compilation, class loading and initialization, garbage collection) plus the raster and semantics time the
// Worker measures itself. A gap between two frames the page received is then attributed to the tasks that ran inside it (scripts/validation/profile-smoothness.mjs --hitches):
// first-time work, a collection, an image decode in a host call, a background job, or plain Java. Cheap: a few numbers copied per task, a fixed ring, nothing while no task ends.
// DOM-free, no process.*.

export const TASK_LOG_CAPACITY = 4096;   // about 20 s of a busy screen (a pump, a snapshot and an input reply per frame); pumps that found nothing to run are not kept
const BUCKETS = 6;   // time-breakdown.js BUCKET: INTERP, HOST, DECODE, COMPILE, INIT, GC

/** The cumulative bucket times of a runtime (the per-operation breakdown plus what earlier resets moved to the lifetime totals), into `out`. */
function bucketTotals(runtime, out) {
  const tb = runtime?.tb;
  for (let i = 0; i < BUCKETS; i++) out[i] = tb?.ms ? tb.ms[i] + (tb.lifeMs ? tb.lifeMs[i] : 0) : 0;
  if (tb?.ms && tb.cur !== undefined) out[tb.cur] += performance.now() - tb.last;   // the bucket that owns the clock right now
  return out;
}
function counterTotals(runtime, out) {
  const tb = runtime?.tb;
  for (let i = 0; i < BUCKETS; i++) out[i] = tb?.counts ? tb.counts[i] + (tb.lifeCounts ? tb.lifeCounts[i] : 0) : 0;
  return out;
}
const rasterMs = runtime => { const s = runtime?.rasterStats; return s ? (s.keyMs ?? 0) + (s.replayMs ?? 0) + (s.encodeMs ?? 0) : 0; };

export class WorkerTaskLog {
  // `detail` (off by default; a measurement tool turns it on): each task also records its four costliest host-call keys (inclusive ms), at the price of copying the runtime's host
  // table (up to 4000 keys) at every task start
  constructor(capacity = TASK_LOG_CAPACITY) { this.capacity = capacity; this.ring = []; this.next = 0; this.open = null; this.seq = 0; this.detail = false; this.traceSlices = false; }
  /** A task starts (`kind`: 'events', 'snapshot', 'request:<type>', 'api-gap-scan', ...). Tasks do not nest: a task begun while another is open ends that one first. */
  begin(kind, runtime) {
    if (this.open) this.end(runtime);
    if (this.traceSlices && runtime && runtime.sliceLog !== this) runtime.sliceLog = this;   // a measurement tool asked for the background slices (sliceBegin / sliceEnd)
    const ms = bucketTotals(runtime, new Float64Array(BUCKETS)), counts = counterTotals(runtime, new Float64Array(BUCKETS));
    this.open = { kind, at: performance.now(), ms, counts, raster: rasterMs(runtime), gcCollections: runtime?.gcStats?.collections ?? 0, frames: runtime?.platform?.viewWindowHost?.frameState?.().framesRun ?? 0,
      hosts: this.detail && runtime?.tb?.host ? new Map([...runtime.tb.host].map(([key, value]) => [key, value.ms])) : null };
    return this.open;
  }
  /** A background slice of green threads starts inside the open task (src/android-platform.js drainEvents calls these through runtime.sliceLog while a measurement tool has
   *  `detail` on): the slice's wall time, the thread it ran and how its time split between the runtime's buckets; each task keeps its count, total and three longest slices. */
  sliceBegin(runtime) { if (!this.open) return null; return { at: performance.now(), ms: bucketTotals(runtime, new Float64Array(BUCKETS)) }; }
  sliceEnd(runtime, mark, thread, credit) {
    const task = this.open; if (!task || !mark) return;
    const ms = performance.now() - mark.at, now = bucketTotals(runtime, new Float64Array(BUCKETS)), d = i => Math.round((now[i] - mark.ms[i]) * 10) / 10;
    const s = task.slices ??= { n: 0, ms: 0, top: [] }; s.n++; s.ms += ms;
    if (s.top.length < 3 || ms > s.top[s.top.length - 1].ms) {
      s.top.push({ ms: Math.round(ms * 10) / 10, thread: String(thread ?? '?').slice(0, 40), credit: !!credit, interp: d(0), host: d(1), first: Math.round((d(2) + d(3) + d(4)) * 10) / 10, gc: d(5), lastHost: runtime?.lastHostCall ? String(runtime.lastHostCall).replace(/^L/, '').replace(/;->/, '.').replace(/\(.*$/, '') : null });
      s.top.sort((a, b) => b.ms - a.ms); if (s.top.length > 3) s.top.length = 3;
    }
  }
  /** Something measured inside the open task that the runtime does not bucket itself (the Worker's semantics walk, ms). */
  note(field, ms) { if (this.open) this.open[field] = (this.open[field] ?? 0) + ms; }
  /** The open task ends: it is recorded with its deltas. */
  end(runtime) {
    const task = this.open; if (!task) return null; this.open = null;
    const now = performance.now(), ms = bucketTotals(runtime, new Float64Array(BUCKETS)), counts = counterTotals(runtime, new Float64Array(BUCKETS));
    const d = i => Math.round((ms[i] - task.ms[i]) * 10) / 10, n = i => counts[i] - task.counts[i];
    const entry = { seq: ++this.seq, kind: task.kind, at: Math.round((performance.timeOrigin + task.at) * 10) / 10, ms: Math.round((now - task.at) * 10) / 10,
      interp: d(0), host: d(1), decode: d(2), compile: d(3), init: d(4), gc: d(5), decodes: n(2), inits: n(4), hostCalls: n(1),
      raster: Math.round((rasterMs(runtime) - task.raster) * 10) / 10, collections: (runtime?.gcStats?.collections ?? 0) - task.gcCollections,
      frames: (runtime?.platform?.viewWindowHost?.frameState?.().framesRun ?? 0) - task.frames, semantics: task.semantics ? Math.round(task.semantics * 10) / 10 : 0 };
    if (task.slices) entry.slices = { n: task.slices.n, ms: Math.round(task.slices.ms * 10) / 10, top: task.slices.top };
    if (task.hosts) entry.topHosts = [...runtime.tb.host].map(([key, value]) => [String(key).replace(/^L/, '').replace(/;->/, '.').replace(/\(.*$/, ''), Math.round((value.ms - (task.hosts.get(key) ?? 0)) * 10) / 10]).filter(row => row[1] >= 1).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (entry.ms < 0.5 && entry.frames === 0 && entry.decodes === 0 && entry.inits === 0) { this.skipped = (this.skipped ?? 0) + 1; return entry; }   // a wake that found nothing due: not a cause of anything
    if (this.ring.length < this.capacity) this.ring.push(entry); else { this.ring[this.next] = entry; this.next = (this.next + 1) % this.capacity; }
    return entry;
  }
  /** Runs `fn` as one task of `kind` (the previous open task, if any, is ended first and not resumed). */
  run(kind, runtime, fn) { this.begin(kind, runtime); try { return fn(); } finally { this.end(runtime); } }
  /** The recorded tasks that ended after `sinceEpochMs` (epoch ms, as Date.now()), oldest first. */
  since(sinceEpochMs = 0) {
    const ordered = this.ring.length < this.capacity ? this.ring : [...this.ring.slice(this.next), ...this.ring.slice(0, this.next)];
    return ordered.filter(entry => entry.at + entry.ms >= sinceEpochMs);
  }
}

/**
 * The tasks behind one gap between two frames the page received ([from, to], epoch ms): every task that overlaps it, and a one-word cause for the gap, by the largest share of
 * the overlapping time: 'first-time' (method preparation, compilation, class initialization), 'gc', 'raster', 'semantics', 'background' (a task that is not VM events nor a
 * snapshot), 'host' (host calls: image decodes, text layout, ...) or 'java' (the interpreter and compiled code). `idle`: the part of the gap no task covered (the Worker waited:
 * a timer, the page, the frame pacing).
 */
export function attributeGap(tasks, from, to) {
  const inside = tasks.filter(task => task.at < to && task.at + task.ms > from);
  const share = { 'first-time': 0, gc: 0, raster: 0, semantics: 0, background: 0, host: 0, java: 0 }; let covered = 0;
  for (const task of inside) {
    const overlap = Math.min(to, task.at + task.ms) - Math.max(from, task.at), scale = task.ms > 0 ? overlap / task.ms : 0; covered += overlap;
    if (task.kind !== 'events' && task.kind !== 'snapshot' && !task.kind.startsWith('request:')) { share.background += overlap; continue; }
    // the raster replay runs where the snapshot reads it: in a host call (a draw) or outside any (the interpreter bucket owns the clock then); the semantics walk is Java
    const firstTime = task.decode + task.compile + task.init, javaRoom = Math.max(0, task.interp - task.semantics), rasterInJava = Math.min(task.raster, javaRoom), rasterInHost = Math.min(task.raster - rasterInJava, task.host);
    share['first-time'] += firstTime * scale; share.gc += task.gc * scale; share.raster += (rasterInJava + rasterInHost) * scale; share.semantics += task.semantics * scale;
    share.host += (task.host - rasterInHost) * scale; share.java += (javaRoom - rasterInJava) * scale;
  }
  const cause = Object.entries(share).sort((a, b) => b[1] - a[1])[0];
  return { from, to, ms: Math.round(to - from), idle: Math.max(0, Math.round(to - from - covered)), cause: covered < (to - from) / 2 ? 'idle' : cause[0], share: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, Math.round(v)])), tasks: inside };
}
