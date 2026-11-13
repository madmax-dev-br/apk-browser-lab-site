import { foldDirectCalls } from './interpreter.js?v=07ce22d2e253';
// What a long-running event was doing, for the error report of an instruction-budget or wall-clock failure (and for "Copiar diagnóstico"): a cheap sampling profile that starts only once an event has run
// PROFILE_AFTER instructions on one thread, or a tenth of the per-event budget when that is smaller (so ordinary short events pay one comparison per scheduling quantum). From then on, at every scheduling tick (QUANTUM instructions) the running thread's innermost
// methods are sampled (self share and the distinct stacks), the per-method invocation counters the VM already keeps (methodEvidence) are compared with a snapshot taken at the start, and host-bridge calls
// (System.arraycopy, stream reads, ...) are counted by name. It tells an endless loop (the same few methods, a stream that never returns -1) from legitimate heavy work (a wide spread of methods).
export const PROFILE_AFTER = 1_000_000;
const short = key => String(key ?? '?').replace(/^L/, '').replace(/;->/, '.');
const pct = (count, total) => `${Math.round(1000 * count / Math.max(1, total)) / 10}%`;

export class ExecutionProfile {
  constructor(runtime) { this.rt = runtime; this.active = false; this.reset(); }
  /** A new host event begins: drop what the previous one collected. */
  reset() {
    this.active = false; this.samples = 0; this.baseline = null; this.startSteps = 0;
    // beginEvent resets it for every host event and every nested run of the core (thousands a second while a page walks the semantics tree): an empty profile keeps its maps
    if (this.byThread?.size === 0 && this.self.size === 0 && this.stacks.size === 0 && this.hostCalls.size === 0) return;
    this.byThread = new Map(); this.self = new Map(); this.stacks = new Map(); this.hostCalls = new Map();
  }
  /** Called at every scheduling tick of the running thread. */
  tick() {
    if (!this.active) { if (this.rt.steps >= Math.min(PROFILE_AFTER, Math.floor(this.rt.maxInstructionsPerEvent / 10))) this.#start(); return; }
    const frames = this.rt.thread?.frames; if (!frames || frames.length === 0) return;
    const top = frames[frames.length - 1]?.method?.key; if (top === undefined) return;
    this.samples++; this.self.set(top, (this.self.get(top) ?? 0) + 1);
    { const name = this.rt.thread?.name ?? '?'; let mine = this.byThread.get(name); if (mine === undefined && this.byThread.size < 40) this.byThread.set(name, mine = { samples: 0, self: new Map() }); if (mine) { mine.samples++; mine.self.set(top, (mine.self.get(top) ?? 0) + 1); const now = performance.now(); if (!mine.win) mine.win = { at: now, self: new Map() }; else if (now - mine.win.at > 10000) { mine.prev = mine.win; mine.win = { at: now, self: new Map() }; } mine.win.self.set(top, (mine.win.self.get(top) ?? 0) + 1); } }   // per thread: the hottest methods of a thread that runs for a long time
    let signature = short(top); for (let at = frames.length - 2, depth = 0; at >= 0 && depth < 3; at--, depth++) signature += ' < ' + short(frames[at]?.method?.key);
    if (this.stacks.size < 512 || this.stacks.has(signature)) this.stacks.set(signature, (this.stacks.get(signature) ?? 0) + 1);
  }
  #start() {
    this.active = true; this.startSteps = this.rt.steps; this.baseline = new Map();
    foldDirectCalls(this.rt);   // the calls direct code counted on its own so far (interpreter.js)
    for (const evidence of this.rt.methodEvidence?.values() ?? []) this.baseline.set(evidence, evidence.calls);
  }
  /** A call that reached a host bridge (SHIM/platform) while the profile is active. */
  host(key) { this.hostCalls.set(key, (this.hostCalls.get(key) ?? 0) + 1); }
  /** The hottest methods of one thread in this window, as `name share`. */
  topOf(threadName, limit = 3) { const mine = this.byThread.get(threadName); return mine?.samples ? [...mine.self].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => `${short(key)} ${pct(count, mine.samples)}`) : []; }
  /** The hottest methods of one thread in roughly the last 10-20 s (two rotating 10 s windows), as `name share`. */
  recentTopOf(threadName, limit = 3) {
    const mine = this.byThread.get(threadName); if (!mine?.win) return [];
    const merged = new Map(), add = window => { for (const [key, count] of window?.self ?? []) merged.set(key, (merged.get(key) ?? 0) + count); }; add(mine.prev); add(mine.win);
    const total = [...merged.values()].reduce((sum, count) => sum + count, 0);
    return [...merged].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => `${short(key)} ${pct(count, total)}`);
  }
  /** The `limit` methods with the most own-instruction samples so far (empty until the profile started), as `name share`. */
  top(limit = 3) { return this.active && this.samples ? [...this.self].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => `${short(key)} ${pct(count, this.samples)}`) : []; }
  /** The innermost frames of the running thread, innermost first. */
  currentStack(limit = 12) {
    const frames = this.rt.thread?.frames ?? [], out = [];
    for (let at = frames.length - 1; at >= 0 && out.length < limit; at--) { const key = frames[at]?.method?.key; if (key !== undefined) out.push(short(key)); }
    return out;
  }
  /** { text, ... } for the failure report; `limit` rows per list. */
  report(limit = 10) {
    const stack = this.currentStack();
    if (!this.active) return { active: false, stack, text: `Perfil do evento: não coletado (o evento rodou poucas instruções numa thread).\nPilha na falha (mais interna primeiro):\n${stack.map(line => '  ' + line).join('\n')}` };
    const bySelf = [...this.self].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => ({ method: short(key), samples: count, share: count / Math.max(1, this.samples) }));
    const byCalls = [];
    foldDirectCalls(this.rt);
    for (const evidence of this.rt.methodEvidence?.values() ?? []) { const delta = evidence.calls - (this.baseline.get(evidence) ?? 0); if (delta > 0) byCalls.push({ method: short(evidence.key), calls: delta }); }
    byCalls.sort((a, b) => b.calls - a.calls); byCalls.length = Math.min(byCalls.length, limit);
    const hosts = [...this.hostCalls].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, count]) => ({ call: short(key), count }));
    const stacks = [...this.stacks].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([signature, count]) => ({ stack: signature, share: count / Math.max(1, this.samples) }));
    const lines = [
      `Perfil do evento (amostra a cada tick de agendamento, ${this.samples} amostras, a partir da instrução ${this.startSteps} da thread):`,
      `Por instruções próprias (fatia das amostras):\n${bySelf.map(row => `  ${pct(row.samples, this.samples)} ${row.method}`).join('\n') || '  (nenhuma)'}`,
      `Por chamadas desde o início do perfil:\n${byCalls.map(row => `  ${row.calls} ${row.method}`).join('\n') || '  (nenhuma)'}`,
      `Chamadas à ponte do host, por nome:\n${hosts.map(row => `  ${row.count} ${row.call}`).join('\n') || '  (nenhuma)'}`,
      `Pilhas distintas mais amostradas (interna < chamadores):\n${stacks.map(row => `  ${pct(row.share, 1)} ${row.stack}`).join('\n') || '  (nenhuma)'}`,
      `Pilha na falha (mais interna primeiro):\n${stack.map(line => '  ' + line).join('\n')}`,
    ];
    return { active: true, samples: this.samples, bySelf, byCalls, hostCalls: hosts, stacks, stack, text: lines.join('\n') };
  }
  /** A one-line summary for the error message itself. */
  summary() {
    if (!this.active || this.samples === 0) return '';
    const top = [...this.self].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, count]) => `${short(key)} ${pct(count, this.samples)}`);
    return `; mais ocupados: ${top.join(', ')}`;
  }
}
