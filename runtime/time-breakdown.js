// Where the host time of an operation goes, with exclusive attribution: the bucket on top of the stack owns the clock. Rare, long phases (method decoding, JIT compilation, class initialization,
// garbage collection) and host calls switch the bucket; everything else is the interpreter (and compiled code). The per-thread split counts interpreter time by the thread that ran.
export const BUCKET = { INTERP: 0, HOST: 1, DECODE: 2, COMPILE: 3, INIT: 4, GC: 5 };
const NAMES = ['interpreter and compiled code', 'host calls', 'method decoding (first run)', 'JIT compilation', 'class loading/initialization', 'garbage collection'];
export class TimeBreakdown {
  constructor() { this.reset(); }
  reset() {
    // what the breakdown of each operation drops is kept in the lifetime totals (src/warmup.js reads them)
    this.lifeMs ??= new Float64Array(6); this.lifeCounts ??= new Float64Array(6); if (this.ms) for (let i = 0; i < 6; i++) { this.lifeMs[i] += this.ms[i]; this.lifeCounts[i] += this.counts[i]; }
    this.ms = new Float64Array(6); this.counts = new Float64Array(6); this.cur = BUCKET.INTERP; this.last = this.startedAt = performance.now(); this.threads = new Map(); this.acc = this.accumulatorFor('main'); this.host = new Map(); this.event ??= null;
  }
  accumulatorFor(name) { let acc = this.threads.get(name); if (acc === undefined) this.threads.set(name, acc = { name, ms: 0, calls: 0, hosts: new Map() }); return acc; }
  /** The running thread changed (scheduler): interpreter time from now on counts for `name`. */
  thread(name) { this.charge(performance.now()); this.acc = this.accumulatorFor(name); }
  charge(now) { const d = now - this.last; this.last = now; this.ms[this.cur] += d; if (this.cur === 0) this.acc.ms += d; }
  enter(bucket) { const now = performance.now(); this.charge(now); const previous = this.cur; this.cur = bucket; this.counts[bucket]++; return previous; }
  leave(previous) { this.charge(performance.now()); this.cur = previous; }
  /** One bridged host call finished: its key, and its inclusive time (host code that runs Java inside counts that Java). */
  hostCall(key, ms) {
    const event = this.event; if (event !== null && this.acc.name === 'main') { const own = event.host.get(key); if (own === undefined) { if (event.host.size < 512) event.host.set(key, { n: 1, ms }); } else { own.n++; own.ms += ms; } }
    let entry = this.host.get(key); if (entry === undefined) { if (this.host.size >= 4000) return; this.host.set(key, entry = { n: 0, ms: 0 }); }
    entry.n++; entry.ms += ms;
    const acc = this.acc; acc.calls++; acc.hosts.set(key, (acc.hosts.get(key) ?? 0) + 1);   // per thread: a loop that issues the same one or two calls over and over is polling
  }
  /** A main-thread event starts (android-platform.js runEvent, while an interaction is measured): its own buckets and host calls are collected until eventEnd. Nested events stack. */
  eventBegin() { const now = performance.now(); this.charge(now); const event = { parent: this.event, ms: Float64Array.from(this.ms), host: new Map() }; this.event = event; return event; }
  /** -> { buckets: [[name, ms]], hosts: [[key, n, ms]] } of the event `eventBegin` returned (the host calls the main thread made, inclusive time; WebAssembly host calls are timed by sample). */
  eventEnd(event) {
    const now = performance.now(); this.charge(now); this.event = event.parent ?? null;
    const short = key => String(key).replace(/^L/, '').replace(/;->/, '.').replace(/\(.*$/, '');
    return { buckets: NAMES.map((name, i) => [name, Math.round(this.ms[i] - event.ms[i])]).filter(row => row[1] > 0),
      hosts: [...event.host].sort((a, b) => b[1].ms - a[1].ms || b[1].n - a[1].n).slice(0, 6).map(([key, v]) => [short(key), v.n, Math.round(v.ms)]) };
  }
  /** The event's work without its details (an event that is not the longest): pops it. */
  eventDrop(event) { this.event = event.parent ?? null; }
  snapshot() {
    const copy = new Float64Array(this.ms), now = performance.now(); copy[this.cur] += now - this.last;
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
  static text(snapshot) {
    if (!snapshot) return '';
    const total = snapshot.ms.reduce((a, b) => a + b, 0) || 1;
    return `Host time: ${snapshot.ms.map((v, i) => `${NAMES[i]} ${v} ms (${Math.round(100 * v / total)}%${snapshot.counts[i] ? ', ' + snapshot.counts[i] + '×' : ''})`).join('; ')}; ${(snapshot.pollers ?? []).map(p => `; thread ${p.thread} is polling (${p.perSecond} host calls/s): ${p.calls.map(([key, n]) => `${key} ${n}×`).join(', ')}`).join('')}; interpreter by thread: ${snapshot.threads.map(([name, ms]) => `${name} ${ms} ms`).join(', ') || '-'}; most frequent host calls: ${(snapshot.hostByCount ?? []).map(([key, n, ms]) => `${key} ${n}× (${ms} ms)`).join(', ') || '-'}; slowest (inclusive time): ${(snapshot.hostByTime ?? []).map(([key, n, ms]) => `${key} ${ms} ms (${n}×)`).join(', ') || '-'}`;
  }
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
