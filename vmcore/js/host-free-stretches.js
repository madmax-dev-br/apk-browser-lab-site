// A measurement instrument, off by default: how long the core runs Java without calling JavaScript. A "host-free stretch" is what one thread executes between two consecutive
// crossings out of core.wasm: from the return of a host call (env.bridge, env.field) or the start of a run (the run / run_nested / resume / resume_host exports) to the next
// host call or to the run's return (a quantum's end, a monitor or Object.wait, a collection, the run's end). Each stretch is measured in instructions (Thread.steps, which
// interp.c publishes before every host call and at every return: deterministic) and in wall milliseconds (noisy, and a little inflated by this instrument's two clock reads per
// crossing). It only observes: nothing here writes to the core's memory or to the scheduler.
//
// Switched on by attachWasmEngine(runtime, { hostFreeStretches: true }) or, for a script that attaches the core through a helper, globalThis.__apkwebHostFreeStretches = true
// before the core is attached (scripts/validation/host-free-stretches.mjs is a Node preload that does it and prints the report). The engine then has `engine.stretches` and its
// imports and run exports are wrapped by the functions below. Off (the default), WasmEngine.instantiate installs exactly the functions it installed before: no branch, no
// counter and no clock read is added to a call.
//
// What is kept, per thread class (the main thread; every other thread together):
//   strict   every stretch as defined above
//   joined   the same with quantum ends not counted as ends: a run that returned YIELDED and was resumed continues its stretch (the time between the two is not counted). This
//            is the distance between two points where JavaScript was really needed
//   ends     what ended the strict stretches: `host` (a host call that returned a value, an exception or a DEX frame), `host-wait` (a host call that parked the thread:
//            sleep, park, join, a queue's poll...), `host-invoke` (a host call that continues in Java), `host-stop`, `field` (a host field), `yield`, `core-block` (a
//            monitor, Object.wait, a class being initialized by another thread), `collection`, `run-end`, `debug`, `stop`
//   hosts    for the other threads: the host methods and fields that ended stretches, by count. Only names of the platform's own namespaces are kept (PLATFORM); anything else
//            is counted as "other"
// env.resolve (the linker: a method's code or a constant on first use) and env.exception are JavaScript too, but interp.c does not publish the instruction count there, so they
// cannot end a stretch: they are counted (`links`, `exceptionEvents`), their time is taken out of the stretch, and a stretch with one inside is counted as `linked` (its real
// host-free length is shorter than recorded). The shares over a duration are given for all stretches and for the ones with no such call inside.
import { Blocked } from '../../runtime/scheduler.js?v=e0932d3cf1f5';

const THREAD_STEPS = 32, CALL_CALLER = 4, CALL_CONSTANT = 8;   // abi.h Thread.steps (u64); host.h HostCall.caller, .constant
const OK = 0, OUT_OF_MEMORY = 5, UNCAUGHT = 48, HOST_STOPPED = 64, HOST_FAILED = 65, HOST_BLOCKED = 66, THREAD_BLOCKED = 80, YIELDED = 81, BREAKPOINT = 96, EXCEPTION_EVENT = 98;
const RUNS = ['run', 'run_nested', 'resume', 'resume_host'];
const PLATFORM = /^L(?:java|javax|sun|jdk|libcore|dalvik|android|com\/android|org\/json|org\/xml|org\/xmlpull|org\/w3c|org\/apache\/harmony)\//;
const SUB = 4, BUCKETS = 1 + 48 * SUB;   // log buckets, four per octave: bucket 0 holds 0, bucket 1 + floor(4 log2 v) holds v >= 1 (up to 2^48)
export const STRETCH_MS_MARKS = Object.freeze([0.2, 1, 5]);

const bucketOf = value => value < 1 ? 0 : Math.min(BUCKETS - 1, 1 + Math.floor(Math.log2(value) * SUB));
/** The value a bucket stands for: the geometric middle of its bounds (within 9 % of every value in it). */
const bucketValue = index => index === 0 ? 0 : 2 ** ((index - 0.5) / SUB);

/** One distribution of stretches: histograms of instructions and of nanoseconds, totals, maxima, and the instructions held by stretches longer than each mark. */
class Distribution {
  constructor() {
    this.count = 0; this.instructions = 0; this.ms = 0; this.maxInstructions = 0; this.maxMs = 0;
    this.byInstructions = new Float64Array(BUCKETS); this.byNs = new Float64Array(BUCKETS);
    this.over = STRETCH_MS_MARKS.map(() => ({ count: 0, instructions: 0, cleanCount: 0, cleanInstructions: 0 }));
    this.linked = { count: 0, instructions: 0 };
  }
  add(instructions, ms, linked) {
    this.count++; this.instructions += instructions; this.ms += ms;
    if (instructions > this.maxInstructions) this.maxInstructions = instructions;
    if (ms > this.maxMs) this.maxMs = ms;
    this.byInstructions[bucketOf(instructions)]++; this.byNs[bucketOf(ms * 1e6)]++;
    if (linked) { this.linked.count++; this.linked.instructions += instructions; }
    for (let i = 0; i < STRETCH_MS_MARKS.length && ms > STRETCH_MS_MARKS[i]; i++) {
      const over = this.over[i]; over.count++; over.instructions += instructions;
      if (!linked) { over.cleanCount++; over.cleanInstructions += instructions; }
    }
  }
  /** The value at quantile q of a histogram (the bucket's middle; the last bucket's is capped by the exact maximum). */
  static quantile(histogram, count, q, max) {
    if (count === 0) return 0;
    let left = Math.max(1, Math.ceil(count * q));
    for (let i = 0; i < BUCKETS; i++) { left -= histogram[i]; if (left <= 0) return Math.min(bucketValue(i), max); }
    return max;
  }
  summary() {
    const of = (histogram, max, scale) => Object.fromEntries([['p50', 0.5], ['p90', 0.9], ['p99', 0.99]].map(([key, q]) => [key, Distribution.quantile(histogram, this.count, q, max / scale) * scale]));
    const share = value => this.instructions > 0 ? value / this.instructions : 0;
    return {
      stretches: this.count, instructions: this.instructions, ms: this.ms,
      perStretchInstructions: { ...of(this.byInstructions, this.maxInstructions, 1), max: this.maxInstructions },
      perStretchMs: { ...of(this.byNs, this.maxMs, 1e-6), max: this.maxMs },
      // of all the instructions of this distribution, the share executed in stretches longer than each mark; `clean`: counting only stretches with no linker or exception call inside
      longerThanMs: Object.fromEntries(STRETCH_MS_MARKS.map((mark, i) => [mark, { stretches: this.over[i].count, instructionShare: share(this.over[i].instructions), cleanStretches: this.over[i].cleanCount, cleanInstructionShare: share(this.over[i].cleanInstructions) }])),
      linked: { stretches: this.linked.count, instructionShare: share(this.linked.instructions) },
    };
  }
}

class ThreadClass {
  constructor() { this.strict = new Distribution(); this.joined = new Distribution(); this.ends = new Map(); this.hosts = new Map(); this.links = 0; this.exceptionEvents = 0; }
}

export class HostFreeStretches {
  constructor(engine, { now = () => performance.now() } = {}) {
    this.engine = engine; this.now = now; this.stack = []; this.carried = new Map(); this.names = new Map(); this.fieldNames = new Map();
    this.main = new ThreadClass(); this.background = new ThreadClass();
  }
  reset() { this.main = new ThreadClass(); this.background = new ThreadClass(); this.carried.clear(); }
  stepsOf(t) { const u32 = this.engine.u32, at = (t + THREAD_STEPS) >>> 2; return u32[at] + u32[at + 1] * 4294967296; }
  classNow() { const rt = this.engine.runtime, thread = rt.thread; return thread === undefined || thread === null || thread === rt.scheduler?.main ? this.main : this.background; }

  /** A stretch of `frame` ended now: `instructions` and `ms` since it began. */
  record(frame, kind, instructions, ms, name) {
    const group = frame.group, linked = frame.linked;
    group.strict.add(instructions, ms, linked); group.ends.set(kind, (group.ends.get(kind) ?? 0) + 1);
    if (name !== null && group === this.background) group.hosts.set(name, (group.hosts.get(name) ?? 0) + 1);
    if (kind === 'yield') { frame.carry = { group, instructions: frame.carry.instructions + instructions, ms: frame.carry.ms + ms, linked: frame.carry.linked || linked }; return; }
    group.joined.add(frame.carry.instructions + instructions, frame.carry.ms + ms, frame.carry.linked || linked);
    frame.carry = NO_CARRY;
  }
  begin(frame) { frame.open = true; frame.linked = false; frame.inner = 0; frame.steps = this.stepsOf(frame.t); frame.at = this.now(); }

  /** The name a host method or field is counted under: its own when it belongs to the platform's namespaces, "other" otherwise. */
  static label(key, prefix = '') { return typeof key === 'string' && PLATFORM.test(key) ? prefix + key.slice(1).replace(/\(.*$/, '').replace(';->', '.').replaceAll('/', '.') : 'other'; }
  hostName(siteKey) {
    let name = this.names.get(siteKey);
    if (name === undefined) {
      const site = this.engine.sites.get(siteKey); if (site === undefined) return 'other';
      const key = site.bridge?.key ?? site.key; name = HostFreeStretches.label(key);
      if (site.bridge !== null) this.names.set(siteKey, name);   // until the site knows the host it selected, the reference's own name stands in and is asked again
    }
    return name;
  }
  fieldName(siteKey) {
    let name = this.fieldNames.get(siteKey);
    if (name === undefined) { const site = this.engine.fieldSites.get(siteKey); if (site === undefined) return 'other'; name = HostFreeStretches.label(site.key, 'field '); this.fieldNames.set(siteKey, name); }
    return name;
  }

  /** The imports with the stretch accounting around them (the originals are called with the same arguments and their results returned unchanged). */
  wrapImports({ bridge, field, resolve, exception }) {
    const probe = this, stack = this.stack;
    const crossing = (frame) => { if (frame === undefined || !frame.open) return -1; const at = probe.now(); frame.open = false; frame.endedAt = at; return probe.stepsOf(frame.t) - frame.steps; };
    return {
      bridge(methodId, call, thread) {
        const frame = stack[stack.length - 1], instructions = crossing(frame);
        if (instructions < 0) return bridge(methodId, call, thread);
        const ms = frame.endedAt - frame.at - frame.inner, u32 = probe.engine.u32, siteKey = u32[((call >>> 0) + CALL_CALLER) >>> 2] * 65536 + u32[((call >>> 0) + CALL_CONSTANT) >>> 2];
        let status = HOST_FAILED;
        try { return status = bridge(methodId, call, thread); }
        finally {
          status >>>= 0;
          const stopped = status === HOST_BLOCKED || status === HOST_STOPPED || status === HOST_FAILED;   // the run returns at once with this status: no stretch follows the call
          const kind = status === HOST_BLOCKED ? (probe.engine.parked?.step instanceof Blocked ? 'host-wait' : 'host-invoke') : stopped ? 'host-stop' : 'host';
          probe.record(frame, kind, instructions, ms, probe.hostName(siteKey));
          if (!stopped) probe.begin(frame);
        }
      },
      field(thread, object, caller, constant, op, reg) {
        const frame = stack[stack.length - 1], instructions = crossing(frame);
        if (instructions < 0) return field(thread, object, caller, constant, op, reg);
        const ms = frame.endedAt - frame.at - frame.inner;
        try { return field(thread, object, caller, constant, op, reg); }
        finally { probe.record(frame, 'field', instructions, ms, probe.fieldName((caller >>> 0) * 65536 + (constant >>> 0))); probe.begin(frame); }
      },
      resolve(thread, method, what) {
        const frame = stack[stack.length - 1]; if (frame === undefined || !frame.open) return resolve(thread, method, what);
        const at = probe.now(); frame.group.links++; frame.linked = true;
        try { return resolve(thread, method, what); } finally { frame.inner += probe.now() - at; }
      },
      exception(...args) {
        const frame = stack[stack.length - 1]; if (frame === undefined || !frame.open) return exception(...args);
        const at = probe.now(); frame.group.exceptionEvents++; frame.linked = true;
        try { return exception(...args); } finally { frame.inner += probe.now() - at; }
      },
    };
  }
  /** The core's exports with the runs that execute Java wrapped: a run's start begins a stretch of its Thread record, its return ends it. */
  wrapExports(exports) {
    const probe = this, stack = this.stack, wrapped = {};
    for (const name of Object.keys(exports)) {
      const original = exports[name];
      if (!RUNS.includes(name)) { wrapped[name] = original; continue; }
      const resumes = name === 'resume';
      wrapped[name] = (t, ...rest) => {
        t >>>= 0;
        const carry = resumes ? probe.carried.get(t) : undefined; if (carry !== undefined || name === 'run') probe.carried.delete(t);
        const frame = { t, group: probe.classNow(), open: false, linked: false, inner: 0, steps: 0, at: 0, endedAt: 0, carry: carry ?? NO_CARRY };
        stack.push(frame); probe.begin(frame);
        let status = HOST_FAILED;
        try { return status = original(t, ...rest); }
        finally {
          stack.pop(); status >>>= 0;
          if (frame.open) {
            const at = probe.now(), kind = status === YIELDED ? 'yield' : status === THREAD_BLOCKED ? 'core-block' : status === OUT_OF_MEMORY ? 'collection' : status === OK || status === UNCAUGHT ? 'run-end' : status >= BREAKPOINT && status <= EXCEPTION_EVENT ? 'debug' : 'stop';
            probe.record(frame, kind, probe.stepsOf(t) - frame.steps, at - frame.at - frame.inner, null);
          }
          if (frame.carry !== NO_CARRY) probe.carried.set(t, frame.carry);   // a quantum's end: the resume of this record continues the joined stretch
        }
      };
    }
    return wrapped;
  }

  /** What was measured, as plain data: per thread class the strict and joined distributions, what ended the stretches and (other threads) the hosts that ended them. */
  summary({ top = 10 } = {}) {
    const of = (group, hosts) => ({
      strict: group.strict.summary(), joined: group.joined.summary(), links: group.links, exceptionEvents: group.exceptionEvents,
      ends: Object.fromEntries([...group.ends].sort((a, b) => b[1] - a[1])),
      ...(hosts ? { hosts: [...group.hosts].sort((a, b) => b[1] - a[1]).slice(0, top), distinctHosts: group.hosts.size } : {}),
    });
    // joined stretches still going on (the last return of their record was a quantum's end): not in `joined` yet. A thread that computes without ever calling a host is only here
    const open = group => { let stretches = 0, instructions = 0, ms = 0, maxInstructions = 0, maxMs = 0; for (const carry of this.carried.values()) if (carry.group === group) { stretches++; instructions += carry.instructions; ms += carry.ms; maxInstructions = Math.max(maxInstructions, carry.instructions); maxMs = Math.max(maxMs, carry.ms); } return { stretches, instructions, ms, maxInstructions, maxMs }; };
    return { marksMs: [...STRETCH_MS_MARKS], main: { ...of(this.main, false), openJoined: open(this.main) }, background: { ...of(this.background, true), openJoined: open(this.background) } };
  }
  /** The summary as text lines (a report's part). */
  format(options) {
    const s = this.summary(options), n = value => value >= 100 ? String(Math.round(value)) : value >= 1 ? value.toFixed(1) : value.toPrecision(2), pct = value => (value * 100).toFixed(1) + ' %';
    const line = (label, d) => `  ${label}: ${d.stretches} stretches, ${(d.instructions / 1e6).toFixed(3)} M instructions, ${n(d.ms)} ms; instructions p50 ${n(d.perStretchInstructions.p50)} p90 ${n(d.perStretchInstructions.p90)} p99 ${n(d.perStretchInstructions.p99)} max ${d.perStretchInstructions.max}; ms p50 ${n(d.perStretchMs.p50)} p90 ${n(d.perStretchMs.p90)} p99 ${n(d.perStretchMs.p99)} max ${n(d.perStretchMs.max)}; `
      + `instructions in stretches longer than ${s.marksMs.map(mark => `${mark} ms ${pct(d.longerThanMs[mark].instructionShare)} (${d.longerThanMs[mark].stretches}; without linking inside ${pct(d.longerThanMs[mark].cleanInstructionShare)})`).join(', ')}; with linking inside ${d.linked.stretches} stretches, ${pct(d.linked.instructionShare)} of the instructions`;
    const out = ['Host-free stretches (measurement on; instructions and wall ms between two crossings from the core into JavaScript):'];
    for (const [label, group] of [['main thread', s.main], ['background threads', s.background]]) {
      out.push(` ${label}: linker calls ${group.links}, exception events ${group.exceptionEvents}`, line('strict', group.strict), line('joined (quantum ends do not end a stretch)', group.joined),
        `  ended by: ${Object.entries(group.ends).map(([kind, count]) => `${kind} ${count}`).join(', ') || 'nothing'}`);
      if (group.openJoined.stretches) out.push(`  joined stretches not ended yet: ${group.openJoined.stretches}, ${(group.openJoined.instructions / 1e6).toFixed(3)} M instructions, ${n(group.openJoined.ms)} ms (longest ${group.openJoined.maxInstructions} instructions, ${n(group.openJoined.maxMs)} ms)`);
      if (group.hosts) out.push(`  top hosts ending stretches (${group.distinctHosts} distinct): ${group.hosts.map(([name, count]) => `${name} ${count}`).join(', ') || 'none'}`);
    }
    return out;
  }
}
const NO_CARRY = Object.freeze({ group: null, instructions: 0, ms: 0, linked: false });
