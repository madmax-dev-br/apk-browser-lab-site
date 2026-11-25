// What the VM Worker did, task by task, in the last few seconds: a ring of the Worker's own tasks (a scheduled batch of VM events, the snapshot sent to the page, a page request, a
// slice of a background job such as the API-gap estimate), each with its wall time and how that time split between the runtime's buckets (src/time-breakdown.js: the core, bridge glue,
// host code, first-time work, the collector and its JavaScript scan, raster, snapshot, other Worker JavaScript) plus the semantics time the Worker measures itself. Tasks are the Worker's
// busy periods: what lies between two tasks is idle and belongs to no bucket of a task (the log begins and ends the breakdown's task clock, TimeBreakdown.taskBegin/taskEnd). A gap between
// two frames the page received is attributed to the tasks that ran inside it (scripts/validation/profile-smoothness.mjs --hitches): first-time work, the collector, raster, snapshot, host
// code, glue, the core, other JavaScript, a background job. Cheap: a few numbers copied per task, a fixed ring, nothing while no task ends.
// DOM-free, no process.*.

export const TASK_LOG_CAPACITY = 4096;   // about 20 s of a busy screen (a pump, a snapshot and an input reply per frame); pumps that found nothing to run are not kept
import { BUCKET, BUCKET_COUNT as BUCKETS } from './time-breakdown.js?v=2e0bd04dc9d5';

/** The cumulative bucket times of a runtime (the per-operation breakdown plus what earlier resets moved to the lifetime totals, derived buckets settled), into `out`. */
function bucketTotals(runtime, out) {
  const tb = runtime?.tb;
  if (tb?.ms && tb.cumulative) return tb.cumulative(out);
  out.fill(0); return out;
}
function counterTotals(runtime, out) {
  const tb = runtime?.tb;
  for (let i = 0; i < BUCKETS; i++) out[i] = tb?.counts ? tb.counts[i] + (tb.lifeCounts ? tb.lifeCounts[i] : 0) : 0;
  return out;
}
export const rasterMs = runtime => { const s = runtime?.rasterStats; return s ? (s.keyMs ?? 0) + (s.replayMs ?? 0) + (s.encodeMs ?? 0) : 0; };

export class WorkerTaskLog {
  // `detail` (off by default; a measurement tool turns it on): each task also records its four costliest host-call keys (inclusive ms), at the price of copying the runtime's host
  // table (up to 4000 keys) at every task start
  constructor(capacity = TASK_LOG_CAPACITY) { this.capacity = capacity; this.ring = []; this.next = 0; this.open = null; this.seq = 0; this.detail = false; this.traceSlices = false; }
  /** A task starts (`kind`: 'events', 'snapshot', 'request:<type>', 'api-gap-scan', ...). Tasks do not nest: a task begun while another is open ends that one first. */
  begin(kind, runtime) {
    if (this.open) this.end(runtime);
    if (this.traceSlices && runtime && runtime.sliceLog !== this) runtime.sliceLog = this;   // a measurement tool asked for the background slices (sliceBegin / sliceEnd)
    const at = performance.now(), tb = runtime?.tb; if (tb) { tb.precise = this.detail; tb.taskBegin?.(kind, at); }   // `detail` (a measurement run) also times every bridged call
    const ms = bucketTotals(runtime, new Float64Array(BUCKETS)), counts = counterTotals(runtime, new Float64Array(BUCKETS));
    this.open = { kind, at, ms, counts, raster: rasterMs(runtime), gcCollections: runtime?.gcStats?.collections ?? 0, frames: runtime?.platform?.viewWindowHost?.frameState?.().framesRun ?? 0,
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
      s.top.push({ ms: Math.round(ms * 10) / 10, thread: String(thread ?? '?').slice(0, 40), credit: !!credit, core: d(BUCKET.CORE), glue: d(BUCKET.GLUE), host: d(BUCKET.HOST), first: Math.round((d(2) + d(3) + d(4)) * 10) / 10, gc: Math.round((d(BUCKET.GC) + d(BUCKET.SCAN)) * 10) / 10, lastHost: runtime?.lastHostCall ? String(runtime.lastHostCall).replace(/^L/, '').replace(/;->/, '.').replace(/\(.*$/, '') : null });
      s.top.sort((a, b) => b.ms - a.ms); if (s.top.length > 3) s.top.length = 3;
    }
  }
  /** Something measured inside the open task that the runtime does not bucket itself (the Worker's semantics walk, ms). */
  note(field, ms) { if (this.open) this.open[field] = (this.open[field] ?? 0) + ms; }
  /** The open task ends: it is recorded with its deltas. */
  end(runtime) {
    const task = this.open; if (!task) return null; this.open = null;
    const now = performance.now(); runtime?.tb?.taskEnd?.(now);
    const ms = bucketTotals(runtime, new Float64Array(BUCKETS)), counts = counterTotals(runtime, new Float64Array(BUCKETS));
    const d = i => Math.round((ms[i] - task.ms[i]) * 10) / 10, n = i => counts[i] - task.counts[i];
    const entry = { seq: ++this.seq, kind: task.kind, at: Math.round((performance.timeOrigin + task.at) * 10) / 10, ms: Math.round((now - task.at) * 10) / 10,
      core: d(BUCKET.CORE), glue: d(BUCKET.GLUE), host: d(BUCKET.HOST), decode: d(BUCKET.DECODE), compile: d(BUCKET.COMPILE), init: d(BUCKET.INIT), gc: d(BUCKET.GC), scan: d(BUCKET.SCAN), raster: d(BUCKET.RASTER), snapshot: d(BUCKET.SNAPSHOT), other: d(BUCKET.OTHER), native: d(BUCKET.NATIVE),
      decodes: n(2), inits: n(4), hostCalls: n(1), rasterMeasured: Math.round((rasterMs(runtime) - task.raster) * 10) / 10, collections: (runtime?.gcStats?.collections ?? 0) - task.gcCollections,
      frames: (runtime?.platform?.viewWindowHost?.frameState?.().framesRun ?? 0) - task.frames, semantics: task.semantics ? Math.round(task.semantics * 10) / 10 : 0 };
    // what no bucket owned (a task that began before the runtime existed, such as the load of an APK: its JavaScript is the Worker's own) is other Worker JavaScript
    { const owned = entry.core + entry.glue + entry.host + entry.decode + entry.compile + entry.init + entry.gc + entry.scan + entry.raster + entry.snapshot + entry.other + entry.native; if (entry.ms > owned) entry.other = Math.round((entry.other + entry.ms - owned) * 10) / 10; }
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
 * the overlapping time: 'first-time' (method preparation, compilation, class initialization), 'collector' (the core's collection), 'scan' (the collector's JavaScript scan), 'raster', 'snapshot' (the
 * screen's snapshot and its transport), 'background' (a task that is not VM events, a snapshot or a page request: the API-gap scan, a plugin query), 'host' (host calls: image decodes,
 * text layout, ...), 'native' (JNI native code: the ARM64 interpreter, WebAssembly libraries), 'glue' (the bridge between the core and the hosts), 'core' (the interpreter) or 'other' (other Worker JavaScript). `idle`: the part of the gap no task covered
 * (the Worker waited: a timer, the page, the frame pacing); idle is never one of the shares.
 */
export function attributeGap(tasks, from, to) {
  const inside = tasks.filter(task => task.at < to && task.at + task.ms > from);
  const share = { 'first-time': 0, collector: 0, scan: 0, raster: 0, snapshot: 0, background: 0, host: 0, native: 0, glue: 0, core: 0, other: 0 }; let covered = 0;
  for (const task of inside) {
    const overlap = Math.min(to, task.at + task.ms) - Math.max(from, task.at), scale = task.ms > 0 ? overlap / task.ms : 0; covered += overlap;
    if (task.kind !== 'events' && task.kind !== 'snapshot' && !task.kind.startsWith('request:')) { share.background += overlap; continue; }
    share['first-time'] += ((task.decode ?? 0) + (task.compile ?? 0) + (task.init ?? 0)) * scale; share.collector += (task.gc ?? 0) * scale; share.scan += (task.scan ?? 0) * scale; share.raster += (task.raster ?? 0) * scale;
    share.snapshot += (task.snapshot ?? 0) * scale; share.host += (task.host ?? 0) * scale; share.glue += (task.glue ?? 0) * scale; share.core += (task.core ?? 0) * scale; share.other += (task.other ?? 0) * scale; share.native += (task.native ?? 0) * scale;
  }
  const cause = Object.entries(share).sort((a, b) => b[1] - a[1])[0];
  return { from, to, ms: Math.round(to - from), idle: Math.max(0, Math.round(to - from - covered)), cause: covered < (to - from) / 2 ? 'idle' : cause[0], share: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, Math.round(v)])), tasks: inside };
}
