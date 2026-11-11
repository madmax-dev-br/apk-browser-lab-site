// Where the host time of an operation goes, with exclusive attribution: the bucket on top of the stack owns the clock. Rare, long phases (method decoding, JIT compilation, class initialization,
// garbage collection) and host calls switch the bucket; everything else is the interpreter (and compiled code). The per-thread split counts interpreter time by the thread that ran.
export const BUCKET = { INTERP: 0, HOST: 1, DECODE: 2, COMPILE: 3, INIT: 4, GC: 5 };
const NAMES = ['interpretador e código compilado', 'chamadas do host', 'decodificação de métodos (primeira execução)', 'compilação JIT', 'carga/inicialização de classes', 'coleta de lixo'];
export class TimeBreakdown {
  constructor() { this.reset(); }
  reset() {
    this.ms = new Float64Array(6); this.counts = new Float64Array(6); this.cur = BUCKET.INTERP; this.last = this.startedAt = performance.now(); this.threads = new Map(); this.acc = this.accumulatorFor('main'); this.host = new Map();
  }
  accumulatorFor(name) { let acc = this.threads.get(name); if (acc === undefined) this.threads.set(name, acc = { name, ms: 0, calls: 0, hosts: new Map() }); return acc; }
  /** The running thread changed (scheduler): interpreter time from now on counts for `name`. */
  thread(name) { this.charge(performance.now()); this.acc = this.accumulatorFor(name); }
  charge(now) { const d = now - this.last; this.last = now; this.ms[this.cur] += d; if (this.cur === 0) this.acc.ms += d; }
  enter(bucket) { const now = performance.now(); this.charge(now); const previous = this.cur; this.cur = bucket; this.counts[bucket]++; return previous; }
  leave(previous) { this.charge(performance.now()); this.cur = previous; }
  /** One bridged host call finished: its key, and its inclusive time (host code that runs Java inside counts that Java). */
  hostCall(key, ms) {
    let entry = this.host.get(key); if (entry === undefined) { if (this.host.size >= 4000) return; this.host.set(key, entry = { n: 0, ms: 0 }); }
    entry.n++; entry.ms += ms;
    const acc = this.acc; acc.calls++; acc.hosts.set(key, (acc.hosts.get(key) ?? 0) + 1);   // per thread: a loop that issues the same one or two calls over and over is polling
  }
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
    return `Tempo do host: ${snapshot.ms.map((v, i) => `${NAMES[i]} ${v} ms (${Math.round(100 * v / total)}%${snapshot.counts[i] ? ', ' + snapshot.counts[i] + '×' : ''})`).join('; ')}; ${(snapshot.pollers ?? []).map(p => `; thread ${p.thread} está em polling (${p.perSecond} chamadas do host/s): ${p.calls.map(([key, n]) => `${key} ${n}×`).join(', ')}`).join('')}; interpretador por thread: ${snapshot.threads.map(([name, ms]) => `${name} ${ms} ms`).join(', ') || '-'}; chamadas do host mais frequentes: ${(snapshot.hostByCount ?? []).map(([key, n, ms]) => `${key} ${n}× (${ms} ms)`).join(', ') || '-'}; mais lentas (tempo inclusivo): ${(snapshot.hostByTime ?? []).map(([key, n, ms]) => `${key} ${ms} ms (${n}×)`).join(', ') || '-'}`;
  }
}
