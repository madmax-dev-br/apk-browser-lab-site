// A sampling profiler that is always on and does not depend on any event or operation boundary: about every 50 ms of wall time (checked at the scheduling tick the interpreter already makes every
// QUANTUM instructions) it records, for each thread that is running or runnable, its innermost 6 Java frames as "Class.method" (or the host call it is inside, or "ocioso no looper" for the main
// thread between events). Frames are the VM's own per-thread frame stacks, which interpreted, JIT-compiled and nested-host-call code all push, so the samples are the same in every mode.
// The last 30 s are kept in one-second buckets; the Resumo prints the three busiest threads with their three most frequent stacks. Cost: one performance.now() per tick, one sample per 50 ms.
const WINDOW_MS = 30000, INTERVAL_MS = 50, DEPTH = 6;
const simple = owner => { const name = String(owner ?? '?').replace(/^L|;$/g, ''); return name.slice(name.lastIndexOf('/') + 1); };
const short = key => String(key ?? '?').replace(/^L/, '').replace(/;->/, '.');

export class SamplingProfiler {
  constructor(runtime) { this.rt = runtime; this.last = 0; this.buckets = []; this.samples = 0; this.intervalMs = INTERVAL_MS; this.windowMs = WINDOW_MS; }
  /** Called at every scheduling tick of the running thread. */
  tick() { const now = performance.now(); if (now - this.last >= this.intervalMs) { this.last = now; this.sample(now); } }
  signature(thread) {
    const rt = this.rt, frames = thread.frames ?? [], parts = [];
    for (let at = frames.length - 1; at >= 0 && parts.length < DEPTH; at--) {
      const frame = frames[at], method = frame?.method;
      if (method) parts.push(`${simple(method.owner)}.${method.name}`);
      else if (frame?.cont) parts.push(thread === rt.thread && rt.hostCall ? `host ${short(rt.hostCall)}` : '(chamada do host)');
    }
    if (parts.length) return parts.join(' < ');
    if (thread === rt.scheduler?.main) return thread === rt.thread && rt.hostCall ? `ocioso no looper (host ${short(rt.hostCall)})` : 'ocioso no looper';
    return thread === rt.thread && rt.hostCall ? `host ${short(rt.hostCall)}` : '(sem frames)';
  }
  sample(now) {
    const rt = this.rt, threads = rt.scheduler?.threads; if (!threads?.length) return;
    const second = Math.floor(now / 1000); let bucket = this.buckets.at(-1);
    if (!bucket || bucket.second !== second) { bucket = { second, counts: new Map() }; this.buckets.push(bucket); const oldest = second - Math.ceil(this.windowMs / 1000); while (this.buckets.length && this.buckets[0].second <= oldest) this.buckets.shift(); }
    for (const thread of threads) {
      if (thread !== rt.thread && (thread.state !== 'runnable' || !thread.started)) continue;
      const key = thread.name + '\u0000' + this.signature(thread); bucket.counts.set(key, (bucket.counts.get(key) ?? 0) + 1); this.samples++;
    }
  }
  /** Lines of the Resumo: the three busiest threads of the last 30 s with their three most frequent stacks. */
  lines() {
    const perThread = new Map(); let first = Infinity, last = -Infinity;
    for (const bucket of this.buckets) { first = Math.min(first, bucket.second); last = Math.max(last, bucket.second); for (const [key, count] of bucket.counts) { const at = key.indexOf('\u0000'), name = key.slice(0, at), stack = key.slice(at + 1); let mine = perThread.get(name); if (!mine) perThread.set(name, mine = { n: 0, stacks: new Map() }); mine.n += count; mine.stacks.set(stack, (mine.stacks.get(stack) ?? 0) + count); } }
    if (!perThread.size) return [];
    const total = [...perThread.values()].reduce((sum, mine) => sum + mine.n, 0), span = Math.max(1, last - first + 1);
    const busiest = [...perThread].filter(([, mine]) => mine.n > 0).sort((a, b) => b[1].n - a[1].n).slice(0, 3);
    return [`perfil amostrado (${span} s, ${total} amostras): ${busiest.map(([name, mine]) => `${name}: ${[...mine.stacks].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([stack, count]) => `${Math.round(100 * count / mine.n)}% ${stack}`).join('; ')}`).join(' | ')}`];
  }
}
