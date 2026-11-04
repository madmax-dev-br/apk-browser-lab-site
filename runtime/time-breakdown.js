// Where the host time of an operation goes, with exclusive attribution: the bucket on top of the stack owns the clock. Rare, long phases (method decoding, JIT compilation, class initialization,
// garbage collection) and host calls switch the bucket; everything else is the interpreter (and compiled code). The per-thread split counts interpreter time by the thread that ran.
export const BUCKET = { INTERP: 0, HOST: 1, DECODE: 2, COMPILE: 3, INIT: 4, GC: 5 };
const NAMES = ['interpretador e código compilado', 'chamadas do host', 'decodificação de métodos (primeira execução)', 'compilação JIT', 'carga/inicialização de classes', 'coleta de lixo'];
export class TimeBreakdown {
  constructor() { this.reset(); }
  reset() {
    this.ms = new Float64Array(6); this.counts = new Float64Array(6); this.cur = BUCKET.INTERP; this.last = performance.now(); this.threads = new Map(); this.acc = this.accumulatorFor('main');
  }
  accumulatorFor(name) { let acc = this.threads.get(name); if (acc === undefined) this.threads.set(name, acc = { ms: 0 }); return acc; }
  /** The running thread changed (scheduler): interpreter time from now on counts for `name`. */
  thread(name) { this.charge(performance.now()); this.acc = this.accumulatorFor(name); }
  charge(now) { const d = now - this.last; this.last = now; this.ms[this.cur] += d; if (this.cur === 0) this.acc.ms += d; }
  enter(bucket) { const now = performance.now(); this.charge(now); const previous = this.cur; this.cur = bucket; this.counts[bucket]++; return previous; }
  leave(previous) { this.charge(performance.now()); this.cur = previous; }
  snapshot() {
    const copy = new Float64Array(this.ms), now = performance.now(); copy[this.cur] += now - this.last;
    const threads = [...this.threads].map(([name, acc]) => [name, acc.ms]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (threads.length) { const live = this.acc; for (const row of threads) if (this.threads.get(row[0]) === live && this.cur === 0) row[1] += now - this.last; }
    return { ms: Array.from(copy, v => Math.round(v)), counts: Array.from(this.counts, v => Math.round(v)), threads: threads.map(([name, ms]) => [name, Math.round(ms)]) };
  }
  static text(snapshot) {
    if (!snapshot) return '';
    const total = snapshot.ms.reduce((a, b) => a + b, 0) || 1;
    return `Tempo do host: ${snapshot.ms.map((v, i) => `${NAMES[i]} ${v} ms (${Math.round(100 * v / total)}%${snapshot.counts[i] ? ', ' + snapshot.counts[i] + '×' : ''})`).join('; ')}; interpretador por thread: ${snapshot.threads.map(([name, ms]) => `${name} ${ms} ms`).join(', ') || '-'}`;
  }
}
