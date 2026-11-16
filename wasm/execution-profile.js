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
  reset() { this.active = false; this.samples = 0; this.self = new Map(); this.stacks = new Map(); this.baseline = null; this.hostCalls = new Map(); this.startSteps = 0; }
  /** Called at every scheduling tick of the running thread. */
  tick() {
    if (!this.active) { if (this.rt.steps >= Math.min(PROFILE_AFTER, Math.floor(this.rt.maxInstructionsPerEvent / 10))) this.#start(); return; }
    const frames = this.rt.thread?.frames; if (!frames || frames.length === 0) return;
    const top = frames[frames.length - 1]?.method?.key; if (top === undefined) return;
    this.samples++; this.self.set(top, (this.self.get(top) ?? 0) + 1);
    let signature = short(top); for (let at = frames.length - 2, depth = 0; at >= 0 && depth < 3; at--, depth++) signature += ' < ' + short(frames[at]?.method?.key);
    if (this.stacks.size < 512 || this.stacks.has(signature)) this.stacks.set(signature, (this.stacks.get(signature) ?? 0) + 1);
  }
  #start() {
    this.active = true; this.startSteps = this.rt.steps; this.baseline = new Map();
    for (const evidence of this.rt.methodEvidence?.values() ?? []) this.baseline.set(evidence, evidence.calls);
  }
  /** A call that reached a host bridge (SHIM/platform) while the profile is active. */
  host(key) { this.hostCalls.set(key, (this.hostCalls.get(key) ?? 0) + 1); }
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
