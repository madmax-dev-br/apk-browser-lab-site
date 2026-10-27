import { APKError } from './apk-error.js?v=7268006482d0';
import { Blocked, QUANTUM } from './scheduler.js?v=7268006482d0';
import { compileMethod, EXIT, YIELD, CALL, RET, MAX_COMPILED_UNITS } from './baseline-compiler.js?v=7268006482d0';

// Frame-based DEX interpreter.
//
// A Java thread owns an explicit stack of Frames (method, registers, pc). invoke instructions that resolve to DEX code push a frame and keep running in the same
// JS loop instead of recursing, so a thread's whole Java state lives in heap objects and can be parked and resumed by the scheduler. Calls that go through the
// host (natives, SHIM/platform bridges, reflection, class initializers, JNI callbacks) are ordinary JS calls; when they call back into Java they start a nested
// run loop on the same thread (runNested), which returns before the host call does. Only a thread whose frames all belong to the outermost run loop can be
// switched out; blocking inside a nested run is reported by the scheduler (see scheduler.js).
// The value helpers live in apk-runtime.js (which imports this module); it hands them over once through bindSupport() so the two modules need no import cycle.
let fail, isNull, int, wide, narrow, narrowVariant, equal, signed8, signed16, floatNumber, floatBits, doubleNumber, doubleBits, javaInt, javaLong, defaultValue, wordCount, methodKey, WIDE_HIGH, longArithmetic, arithmetic, JavaException;
export function bindSupport(support) {
  ({ fail, isNull, int, wide, narrow, narrowVariant, equal, signed8, signed16, floatNumber, floatBits, doubleNumber, doubleBits, javaInt, javaLong, defaultValue, wordCount, methodKey, WIDE_HIGH, longArithmetic, arithmetic, JavaException } = support);
}
const H = {
  getWide(regs, n) { if (regs[n + 1] !== WIDE_HIGH) fail(`Invalid wide high register v${n + 1}`); return wide(regs[n]); },
  putWide(regs, n, value) { regs[n] = BigInt.asIntN(64, value); regs[n + 1] = WIDE_HIGH; },
};

/** A resolved DEX body that dispatch() hands back to the run loop instead of executing recursively. */
export class PendingCall { constructor(method, code, args, definition = null) { this.method = method; this.code = code; this.args = args; this.definition = definition; } }

/**
 * A host step that needs Java code to run and then continues: a native returns `new Invoke(method, args, mode, then, onError)`. The interpreter runs the call as ordinary
 * frames (so it can park and resume) and feeds the result to then(value); then() may return a value (the native's result), another Invoke, or a Blocked. onError(error)
 * may handle an exception thrown by the callee. This is how host code orchestrates Java without nesting a run loop.
 */
export class Invoke { constructor(method, args, mode = 'virtual', then = null, onError = null) { this.method = method; this.args = args; this.mode = mode; this.then = then; this.onError = onError; } }
/** Marker frame under the callee of an Invoke; holds the continuation. It has no registers or code. */
class ContFrame { constructor(invoke) { this.cont = invoke; this.method = null; this.code = null; } }
const OUT_FRAME = 1, OUT_BLOCKED = 2, DRIVE = { kind: 'drive' };

export class Frame {
  constructor(method, code, regs, prog) {
    this.method = method; this.code = code; this.prog = prog; this.regs = regs; this.pc = 0; this.callPc = 0; this.cur = -1; this.rv = undefined; this.result = undefined; this.pendingException = null;
  }
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
/** Per-method decoded state: the code units as a Uint16Array, lazily resolved operands per pc, and the decoded exception table. */
function prepare(rt, method, code) {
  let progs = code.progs; if (progs === undefined) progs = code.progs = new WeakMap();   // DEX code objects can be shared by several runtimes: decoded state is per runtime
  const existing = progs.get(rt); if (existing !== undefined) return existing;
  const dex = method.dex ?? rt.dex;
  if (!dex.reader) fail(`Method has no originating DEX reader: ${methodKey(method)}`);
  const reader = dex.reader, byteStart = reader.bytes.byteOffset + code.offset;
  reader.check(code.offset, code.units * 2);
  // Code units are little-endian 16-bit words; a view avoids copying when the code item is 2-byte aligned (always, in a well-formed DEX, unless the input buffer is offset oddly).
  const units = (byteStart & 1) === 0 && LITTLE_ENDIAN ? new Uint16Array(reader.bytes.buffer, byteStart, code.units) : Uint16Array.from({ length: code.units }, (_, i) => reader.view.getUint16(code.offset + i * 2, true));
  const origin = rt.methodOrigin(method);
  const prog = { dex, units, refs: new Array(code.units), tries: null, stats: rt.executionByOrigin[origin], key: method.key, filename: dex.filename ?? 'DEX', calls: 0, loops: 0, fn: null, method, code, getter: detectGetter(code, units) };
  progs.set(rt, prog); return prog;
}

/**
 * A trivial getter -- `iget* vA, p0, field; return* vA` on a method taking only the receiver -- is described by its iget opcode (and null otherwise). The invoke instruction runs such a callee
 * without creating a frame (see the cached-call path in runLoop) when every precondition of the ordinary path holds, and keeps all of its bookkeeping.
 */
function detectGetter(code, units) {
  if (code.units !== 3 || code.incoming !== 1 || code.tries) return null;
  const w0 = units[0], op0 = w0 & 255, destination = (w0 >> 8) & 15, objectRegister = w0 >> 12, w2 = units[2], op2 = w2 & 255;
  if (op0 < 0x52 || op0 > 0x58 || op0 === 0x53 || (op2 !== 0x0f && op2 !== 0x11) || (op0 === 0x54) !== (op2 === 0x11)) return null;
  if (objectRegister !== code.registers - 1 || destination !== (w2 >> 8)) return null;
  return op0;
}

/** Creates the frame for a call and, when the method has been called twice, compiles it (see baseline-compiler.js). */
export const JIT_THRESHOLD = Number((typeof process !== 'undefined' && process.env?.APKWEB_JIT_THRESHOLD) || 5000);   // calls before a method is compiled; V8 runs fresh generated code in its slow tiers, so only really hot methods pay off
export const JIT_LOOPS = Number((typeof process !== 'undefined' && process.env?.APKWEB_JIT_LOOPS) || 50000);           // backward branches executed by the interpreter before a loop-heavy method is compiled
function makeFrame(rt, method, code, args, known = null) {
  const prog = known ?? prepare(rt, method, code);
  if (++prog.calls === rt.jitThreshold) compileHot(rt, prog);
  const regs = new Array(code.registers), base = code.registers - code.incoming;
  for (let i = 0; i < args.length; i++) regs[base + i] = args[i];
  return new Frame(method, code, regs, prog);
}
/** Static description of an invoke instruction, built on first execution: the callee reference, the invoke mode and where its arguments live. */
function makeInvokeSite(dex, u, pc, op, a, hi) {
  const target = dex.methods[u[pc + 1]]; if (!target) fail('Invalid method index');
  const range = op >= 0x74, mode = op === 0x71 || op === 0x77 ? 'static' : op === 0x6f || op === 0x75 ? 'super' : op === 0x6e || op === 0x72 || op === 0x74 || op === 0x78 ? 'virtual' : 'direct';
  const argc = range ? a : hi;
  if (!range && hi > 5) fail('Invalid invoke register count');
  if (argc !== wordCount(target.parameters) + (mode === 'static' ? 0 : 1)) fail('Invalid invoke argument shape');
  return { target, mode, virtual: mode === 'virtual', isStatic: mode === 'static', argc, first: range ? u[pc + 2] : -1, definition: null, type: null, callee: null, calleeProg: null, poly: null, initialized: false, bridge: null, bridgeEpoch: -1, bridgeType: null };
}
function fieldSiteFor(rt, reference, type) {
  if (!reference || !rt.isSubtype(type, reference.owner)) fail('Invalid field/receiver');
  const field = rt.resolveField(reference);
  return { type, key: field.key, def: defaultValue(field.type) };
}

/** Compiles the method of `frame` now (a loop in it has run long enough in the interpreter). Always returns false. */
function compileHot(rt, prog, frame = null) {
  const code = prog.code, method = prog.method;
  if (prog.fn === null && rt.jit && rt.instructionProbe === undefined && code.units <= MAX_COMPILED_UNITS) {
    const tries = prog.tries ??= decodeTries(rt, code, prog.dex);
    prog.fn = compileMethod(rt, method, code, prog, tries, jitSupport(rt));
    if (prog.fn !== null) rt.jitCompiled++;
  }
  return false;
}

let support = null;
function jitSupport(rt) {
  if (support !== null) return support;
  const cmp = (kind, gt, x, y) => {
    if (kind === 'long') return x < y ? -1 : x > y ? 1 : 0;
    const a = kind === 'float' ? floatNumber(x) : doubleNumber(x), b = kind === 'float' ? floatNumber(y) : doubleNumber(y);
    return Number.isNaN(a) || Number.isNaN(b) ? gt : a < b ? -1 : a > b ? 1 : 0;
  };
  /** A compiled caller enters a cached callee: the callee frame is created and pushed; the caller then runs the callee's compiled body directly or returns to the loop. */
  const prepareCall = (rt, f, site, args, returnPc, pcOfCall) => {
    const callee = site.callee; rt.callStats.cached++;
    if (site.isStatic && rt.initialized.get(callee.method.owner)?.status !== 'initialized') rt.initialize(callee.method.owner);
    rt.recordMethod(callee.method);
    const frames = rt.thread.frames;
    if (frames.length + rt.depth >= rt.maxCallDepth) rt.throwJava('Ljava/lang/StackOverflowError;', 'stack size 1MB');
    f.pc = returnPc; f.callPc = pcOfCall;
    if (frames.length + rt.depth + 1 > rt.peakCallDepth) rt.peakCallDepth = frames.length + rt.depth + 1;
    const frame = makeFrame(rt, callee.method, callee.code, args, site.calleeProg); frames.push(frame);
    return frame;
  };
  return support = { QUANTUM, WIDE_HIGH, makeInvokeSite, helpers: {
    prepareCall, receiverType: (rt, receiver) => receiver !== null && typeof receiver === 'object' ? (rt.heap.list[receiver.ref]?.type ?? rt.typeOf(receiver)) : rt.typeOf(receiver),
    arith: arithmetic, long: (op, x, y) => longArithmetic(op, x, y), num: (kind, op, x, y) => numericBinary(kind === 'float' ? 2 : 3, op, x, y), cmp, same: equal,
    floatBits, floatNumber, doubleBits, doubleNumber, javaInt, javaLong,
    fuse(max) { throw new APKError(`Instruction budget (${max}/event) exceeded`); },
    castFail(rt, value, type) { rt.throwJava('Ljava/lang/ClassCastException;', `Cannot cast ${rt.typeOf(value)} to ${type}`); },
    fieldSite(rt, site, reference, object) {
      if (!reference || !rt.isSubtype(object.type, reference.owner)) fail('Invalid field/receiver');
      const field = rt.resolveField(reference); site.key = field.key; site.def = defaultValue(field.type); site.type = object.type;
    },
    staticSite(rt, site, reference, afterWrite = false) {
      let value;
      if (!afterWrite) value = rt.readStatic(reference);
      const field = rt.resolveField(reference); site.key = field.key;
      site.ready = rt.initialized.get(field.owner)?.status === 'initialized' && rt.staticFields.has(field.key);
      return value;
    },
  } };
}

function decodeTries(rt, code, dex) {
  const out = [];
  if (!code.tries) return out;
  const b = dex.reader, start = code.offset + code.units * 2 + (code.units & 1 ? 2 : 0);
  b.check(start, code.tries * 8);
  const handlers = start + code.tries * 8;
  for (let i = 0; i < code.tries; i++) {
    const entry = start + i * 8, from = b.u32(entry), count = b.u16(entry + 4);
    const cursor = { p: handlers + b.u16(entry + 6) }, size = b.sleb(cursor);
    if (Math.abs(size) > 10000) fail('Exception handler limit exceeded');
    const catches = [];
    for (let j = 0; j < Math.abs(size); j++) {
      const type = dex.types[b.uleb(cursor)], address = b.uleb(cursor);
      if (!type || address >= code.units) fail('Malformed DEX exception handler');
      catches.push({ type, address });
    }
    let catchAll = null;
    if (size <= 0) { const address = b.uleb(cursor); if (address >= code.units) fail('Invalid catch-all address'); catchAll = address; }
    out.push({ from, to: from + count, catches, catchAll });
  }
  return out;
}

/** The handler address for `exception` thrown at `pc` (first matching try range, as the original catchTarget). */
function catchTarget(rt, frame, pc, exception) {
  const code = frame.code, prog = frame.prog;
  if (!code.tries) return null;
  const tries = prog.tries ??= decodeTries(rt, code, prog.dex);
  for (const entry of tries) {
    if (pc < entry.from || pc >= entry.to) continue;
    const type = rt.typeOf(exception);
    for (const handler of entry.catches) if (rt.isSubtype(type, handler.type)) return handler.address;
    return entry.catchAll;
  }
  return null;
}

function numericBinary(group, operation, x, y) {
  if (group === 0) return arithmetic(operation, int(x), int(y));
  if (group === 1) return longArithmetic(operation, wide(x), operation >= 8 ? int(y) : wide(y));
  const a = group === 2 ? floatNumber(x) : doubleNumber(x), b = group === 2 ? floatNumber(y) : doubleNumber(y);
  const value = operation === 0 ? a + b : operation === 1 ? a - b : operation === 2 ? a * b : operation === 3 ? a / b : a % b;
  return group === 2 ? floatBits(value) : doubleBits(value);
}


/**
 * Advances a host step (see Invoke) or a thread driver. `input` is {kind: 'start', invoke} | 'drive' | 'result' | 'returned' | 'calleeResult' | 'error'. Returns OUT_FRAME (a Java
 * frame was pushed on top), OUT_BLOCKED (thread.blocked is set), {done} (the thread's driver finished), {value} (deliver to the DEX frame on top, or the thread's driver when
 * the stack is empty) or {error} (raise at the DEX frame on top, or in the driver). It does not throw, except for fatal uncaught-thread errors.
 */
function pump(rt, thread, input) {
  const frames = thread.frames;
  for (;;) {
    switch (input.kind) {
      case 'start': frames.push(new ContFrame(input.invoke)); input = { kind: 'call' }; continue;
      case 'drive': {
        const driver = thread.driver; if (driver === null) return { done: true };
        let R;
        try { R = driver(rt, thread); }
        catch (error) { try { rt.threadUncaught(thread, error); } catch (fatal) { fatal.vmFatal = true; throw fatal; } return { done: true }; }
        if (R === undefined) return { done: true };
        input = { kind: 'result', R, fresh: true }; continue;
      }
      case 'result': {
        const R = input.R;
        if (R instanceof Blocked) { thread.blocked = R; thread.blockKind = input.fresh ? 'site' : 'step'; thread.state = 'blocked'; return OUT_BLOCKED; }
        if (R instanceof PendingCall) { frames.push(makeFrame(rt, R.method, R.code, R.args)); return OUT_FRAME; }
        if (R instanceof Invoke) {
          if (input.fresh) frames.push(new ContFrame(R)); else frames[frames.length - 1].cont = R;
          input = { kind: 'call' }; continue;
        }
        if (!input.fresh) frames.pop();                              // the step is over: its marker frame goes
        input = { kind: 'returned', value: R }; continue;
      }
      case 'call': {
        const inv = frames[frames.length - 1].cont; let R;
        try { R = rt.dispatch(inv.method, inv.args, inv.mode, null, true); } catch (error) { input = { kind: 'error', error }; continue; }
        if (R instanceof PendingCall) { frames.push(makeFrame(rt, R.method, R.code, R.args)); return OUT_FRAME; }
        if (R instanceof Blocked) { thread.blocked = R; thread.blockKind = 'callee'; thread.state = 'blocked'; return OUT_BLOCKED; }
        if (R instanceof Invoke) { frames.push(new ContFrame(R)); continue; }
        input = { kind: 'returned', value: R }; continue;
      }
      case 'calleeResult': {                                        // a callee native finished its wait with another wait or call
        const R = input.R;
        if (R instanceof Blocked) { thread.blocked = R; thread.blockKind = 'callee'; thread.state = 'blocked'; return OUT_BLOCKED; }
        frames.push(new ContFrame(R)); input = { kind: 'call' }; continue;
      }
      case 'returned': {
        const top = frames[frames.length - 1];
        if (top === undefined || top.cont === undefined) return { value: input.value };
        let R;
        try { R = top.cont.then === null ? input.value : top.cont.then(input.value); } catch (error) { frames.pop(); input = { kind: 'error', error }; continue; }
        input = { kind: 'result', R, fresh: false }; continue;
      }
      case 'error': {
        const top = frames[frames.length - 1];
        if (top === undefined || top.cont === undefined) return { error: input.error };
        if (top.cont.onError !== null) {
          let R;
          try { R = top.cont.onError(input.error); } catch (error) { frames.pop(); input = { kind: 'error', error }; continue; }
          input = { kind: 'result', R, fresh: false }; continue;
        }
        frames.pop(); continue;
      }
      default: fail(`Unknown host-step input ${input.kind}`);
    }
  }
}

/** The pump input for a thread whose Blocked has been satisfied: runs Blocked.finish and classifies what it returned for the kind of wait. */
function wakeInput(thread) {
  const blocked = thread.blocked, kind = thread.blockKind; thread.blocked = null;
  let R;
  try { R = blocked.finish(thread.timedOut === true); } catch (error) { return { kind: 'error', error }; }
  if (kind === 'callee') return R instanceof Blocked || R instanceof Invoke ? { kind: 'calleeResult', R } : { kind: 'returned', value: R };
  return { kind: 'result', R, fresh: kind === 'site' };
}

/** The thread the interpreter is currently running (the scheduler switches it at safepoints). */
export function currentThread(rt) { return rt.thread ?? rt.scheduler.mainThread(); }

/** Runs `method` to completion on the current thread; the entry point behind APKRuntime.execute(). */
const EMPTY_MONITORS = Symbol('no monitors held');
export function runNested(rt, method, code, args) {
  if (rt.nestedRuns === 0) rt.thread = rt.scheduler.mainThread();   // host events (UI, Looper) run on the main thread
  const thread = rt.thread, base = thread.frames.length;
  if (args.length !== code.incoming) fail(`Argument/register mismatch: ${method.key}`);
  if (base >= rt.maxCallDepth) rt.throwJava('Ljava/lang/StackOverflowError;', 'stack size 1MB');
  if (++rt.nestedRuns > rt.maxNestedRuns) { rt.nestedRuns--; rt.throwJava('Ljava/lang/StackOverflowError;', 'native re-entry depth exceeded'); }
  thread.frames.push(makeFrame(rt, method, code, args));
  thread.nestedDepth++;
  // A non-Java failure that escapes the outermost run leaves monitors in an undefined state; reset them to what they were when the event began.
  const checkpoint = rt.nestedRuns === 1 ? (rt.monitors?.size ? new Map(rt.monitors) : EMPTY_MONITORS) : null;
  try { return runLoop(rt, thread, base); }
  catch (error) { if (checkpoint && !(error instanceof JavaException)) rt.monitors = checkpoint === EMPTY_MONITORS ? new Map() : checkpoint; throw error; }
  finally { thread.frames.length = base; thread.nestedDepth--; rt.nestedRuns--; rt.thread = thread; }
}

/** One scheduling slice with no owner: runs whichever thread the scheduler picks until it blocks, ends or uses its quantum (used by drainEvents and nested waits). */
export function runSlice(rt) {
  if (++rt.nestedRuns > rt.maxNestedRuns) { rt.nestedRuns--; rt.throwJava('Ljava/lang/StackOverflowError;', 'native re-entry depth exceeded'); }
  const previous = rt.thread;
  try { return runLoop(rt, null, 0); } finally { rt.nestedRuns--; rt.thread = previous; }
}

/**
 * The interpreter loop. `owner` is the thread whose base frame (index `base`) ends this run -- or null for a pure scheduling slice. Other threads run inside this loop as
 * guests whenever the scheduler switches to them; a guest that ends is terminated, and an uncaught exception in a guest is fatal like on Android.
 */
function runLoop(rt, owner, base) {
  const sched = rt.scheduler;
  let thread = owner, frames = null, f = null, regs = null, prog = null, u = null, dex = null, stats = null, pc = 0, start = 0, returnValue, returning = false;
  let need = owner === null, quantum = QUANTUM, ran = false, input = null;
  const max = rt.maxInstructionsPerEvent, heapList = rt.heap.list, fastCalls = rt.fastCallPaths !== false; let probe = rt.instructionProbe;
  if (owner !== null) { frames = owner.frames; f = frames[frames.length - 1]; regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats; pc = f.pc; start = pc; }
  for (;;) {
    probe = rt.instructionProbe;
    try {
      // ---- host steps and thread drivers: advance them until a Java frame is on top again, the thread blocks, or a value/error reaches a DEX frame
      while (input !== null) {
        const res = pump(rt, thread, input); input = null;
        if (res === OUT_FRAME) { f = frames[frames.length - 1]; regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats; pc = 0; start = 0; }
        else if (res === OUT_BLOCKED) need = true;
        else if (res.done === true) { sched.terminate(thread); need = true; }
        else if (frames.length === 0) { thread.lastOutcome = res; input = DRIVE; }   // the driver sees how its last step ended
        else {
          f = frames[frames.length - 1]; regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats; pc = f.pc; start = f.callPc;
          if ('error' in res) throw res.error;                         // raised at the call site of the DEX frame now on top
          f.result = res.value; start = pc;
        }
      }
      if (need) {
        need = false;
        if (owner === null && ran) return undefined;               // a scheduling slice ends when the thread it ran stops
        // ---- thread switch: pick a runnable thread (waiting for events/timers while the owner is blocked), then resume it
        let picked = null;
        for (;;) {
          const choice = sched.pick(thread, owner);
          if (choice.thread !== null) { picked = choice.thread; break; }
          if (owner === null) return undefined;                         // nothing runnable: this slice is over
          if (sched.nestedReady()) return undefined;
          rt.thread = sched.mainThread();
          sched.idle(choice.earliest, `${owner.name} is blocked (${owner.blocked?.reason ?? 'unknown'})`);
          rt.thread = thread ?? owner;
        }
        thread = picked; rt.thread = thread; frames = thread.frames; quantum = QUANTUM; rt.q = QUANTUM; ran = true;
        const top = frames[frames.length - 1];
        if (thread.blocked !== null) {                                  // a parked thread woke up: finish the wait it was in
          if (thread.blocked.retry && top !== undefined && top.cont === undefined) {            // monitor contention: run the monitor-enter again
            thread.blocked = null; f = top; regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats; pc = f.pc; start = pc;
          } else input = wakeInput(thread);
        } else if (top === undefined) input = DRIVE;                    // a new thread, or a driver thread between steps
        else if (top.cont !== undefined) fail('Thread resumed on a host continuation without a pending step');
        else { f = top; regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats; pc = f.pc; start = pc; }   // preempted: resume where it stopped
        if (input !== null) continue;
      }
      inner: for (;;) {
       interp: {
        if (prog.fn !== null) {
          // Compiled code runs until an instruction it leaves to this loop (a call it has not cached, throw, monitor), a call it entered, a return, or a preemption point.
          f.pc = pc; f.cur = -1;
          const status = prog.fn(f);
          if (status === RET) { returnValue = f.rv; returning = true; break interp; }
          if (status === CALL) {
            f = frames[frames.length - 1]; regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats; pc = f.pc;
            if (rt.q <= 0) { rt.q = QUANTUM; if (rt.multiThreaded && sched.hasOtherRunnable(thread, owner)) { need = true; break inner; } }
            continue inner;
          }
          pc = f.pc;
          if (status === YIELD) { if (rt.multiThreaded && sched.hasOtherRunnable(thread, owner)) { need = true; break inner; } rt.q = QUANTUM; continue inner; }
        }
        start = pc;
        if (++rt.steps > max) fail(`Instruction budget (${max}/event) exceeded`);
        stats.instructions++;
        const w = u[pc], op = w & 255, a = w >> 8, lo = a & 15, hi = a >> 4;
        if (probe) probe(f.method, dex, pc, op, probeWord(u, pc));
        switch (op) {
          case 0x00: if (w) fail('Attempted to execute a DEX data payload'); pc++; break;
          case 0x01: case 0x07: regs[lo] = regs[hi]; pc++; break;
          case 0x02: case 0x08: regs[a] = regs[u[pc + 1]]; pc += 2; break;
          case 0x03: case 0x09: regs[u[pc + 1]] = regs[u[pc + 2]]; pc += 3; break;
          case 0x0a: case 0x0c: if (f.result === undefined) fail('move-result without result'); regs[a] = f.result; f.result = undefined; pc++; break;
          case 0x0b: if (typeof f.result !== 'bigint') fail('move-result-wide without wide result'); regs[a] = BigInt.asIntN(64, f.result); regs[a + 1] = WIDE_HIGH; f.result = undefined; pc++; break;
          case 0x0d: if (!f.pendingException) fail('move-exception without caught exception'); regs[a] = f.pendingException; f.pendingException = null; pc++; break;
          case 0x0e: returnValue = undefined; returning = true; break;
          case 0x0f: { const v = regs[a]; if (v === undefined) fail(`Invalid/uninitialized register v${a}`); returnValue = v; returning = true; break; }
          case 0x11: { const v = regs[a]; if (v === undefined) fail(`Invalid/uninitialized register v${a}`); returnValue = isNull(v) ? null : v; returning = true; break; }
          case 0x10: { if (regs[a + 1] !== WIDE_HIGH) fail(`Invalid wide high register v${a + 1}`); returnValue = wide(regs[a]); returning = true; break; }
          case 0x12: regs[lo] = hi >= 8 ? hi - 16 : hi; pc++; break;
          case 0x13: regs[a] = (u[pc + 1] << 16) >> 16; pc += 2; break;
          case 0x14: regs[a] = u[pc + 1] | (u[pc + 2] << 16); pc += 3; break;
          case 0x15: regs[a] = u[pc + 1] << 16; pc += 2; break;
          case 0x1a: case 0x1b: {
            const index = op === 0x1a ? u[pc + 1] : u[pc + 1] + u[pc + 2] * 65536;
            if (index >= dex.strings.length) fail('Invalid string index');
            regs[a] = dex.strings[index]; pc += op === 0x1a ? 2 : 3; break;
          }
          case 0x1d: case 0x1e: {
            const value = regs[a]; if (isNull(value)) rt.throwJava('Ljava/lang/NullPointerException;', 'null monitor');
            if (op === 0x1d) {
              if (!rt.monitorTryEnter(value, thread)) {
                // Another thread owns the monitor: park, and run this monitor-enter again when it is released.
                f.pc = pc; thread.blocked = monitorWait(rt, value); thread.blockKind = 'site'; thread.state = 'blocked'; need = true; break inner;
              }
            } else rt.monitorExit(value, thread);
            pc++; break;
          }
          case 0x1f: {
            const type = dex.types[u[pc + 1]], value = regs[a]; if (!type) fail('Invalid type index');
            if (!isNull(value) && !rt.isSubtype(rt.typeOf(value), type)) rt.throwJava('Ljava/lang/ClassCastException;', `Cannot cast ${rt.typeOf(value)} to ${type}`);
            pc += 2; break;
          }
          case 0x20: { const type = dex.types[u[pc + 1]], value = regs[hi]; if (!type) fail('Invalid instanceof type'); regs[lo] = !isNull(value) && rt.isSubtype(rt.typeOf(value), type) ? 1 : 0; pc += 2; break; }
          case 0x21: regs[lo] = rt.array(regs[hi]).elements.length; pc++; break;
          case 0x22: { const type = dex.types[u[pc + 1]]; if (!type) fail('Invalid allocation type'); if (rt.initialized.get(type)?.status !== 'initialized') { const gate = rt.initStep(type); if (gate !== undefined) { f.pc = start; f.callPc = start; if (gate instanceof Blocked) { thread.blocked = gate; thread.blockKind = 'site'; thread.state = 'blocked'; need = true; } else input = { kind: 'start', invoke: gate }; break inner; } } regs[a] = rt.allocate(type); pc += 2; break; }
          case 0x23: { const type = dex.types[u[pc + 1]]; if (!type) fail('Invalid array type'); regs[lo] = rt.newArray(type, int(regs[hi])); pc += 2; break; }
          case 0x27: { const value = regs[a]; if (isNull(value)) rt.throwJava('Ljava/lang/NullPointerException;', 'throw null'); throw new JavaException(value, rt.object(value).message ?? rt.typeOf(value), rt.object(value).exceptionDetails); }
          case 0x28: { const target = pc + ((a << 24) >> 24); if (target < 0 || target >= f.code.units) fail('Branch target outside method'); pc = target; if (target <= start && --quantum <= 0) { quantum = QUANTUM; if (rt.multiThreaded && sched.hasOtherRunnable(thread, owner)) { f.pc = pc; need = true; break inner; } } break; }
          case 0x29: { const target = pc + ((u[pc + 1] << 16) >> 16); if (target < 0 || target >= f.code.units) fail('Branch target outside method'); pc = target; if (target <= start && --quantum <= 0) { quantum = QUANTUM; if (rt.multiThreaded && sched.hasOtherRunnable(thread, owner)) { f.pc = pc; need = true; break inner; } } break; }
          case 0x2a: { const target = pc + (u[pc + 1] | (u[pc + 2] << 16)); if (target < 0 || target >= f.code.units) fail('Branch target outside method'); pc = target; if (target <= start && --quantum <= 0) { quantum = QUANTUM; if (rt.multiThreaded && sched.hasOtherRunnable(thread, owner)) { f.pc = pc; need = true; break inner; } } break; }
          case 0x32: case 0x33: case 0x34: case 0x35: case 0x36: case 0x37: {
            const x = regs[lo], y = regs[hi];
            const match = op === 0x32 ? (x === y || equal(x, y)) : op === 0x33 ? (x !== y && !equal(x, y)) : op === 0x34 ? x < y : op === 0x35 ? x >= y : op === 0x36 ? x > y : x <= y;
            if (match) { const t = pc + ((u[pc + 1] << 16) >> 16); pc = t; if (t <= start && ((++prog.loops === rt.jitLoops && rt.jit) ? compileHot(rt, prog) : false, --quantum <= 0)) { quantum = QUANTUM; if (rt.multiThreaded && sched.hasOtherRunnable(thread, owner)) { f.pc = pc; need = true; break inner; } } } else pc += 2;
            break;
          }
          case 0x38: case 0x39: case 0x3a: case 0x3b: case 0x3c: case 0x3d: {
            const x = regs[a];
            const match = op === 0x38 ? (x === null || x === 0) : op === 0x39 ? (x !== null && x !== 0) : op === 0x3a ? x < 0 : op === 0x3b ? x >= 0 : op === 0x3c ? x > 0 : x <= 0;
            if (match) { const t = pc + ((u[pc + 1] << 16) >> 16); pc = t; if (t <= start && ((++prog.loops === JIT_LOOPS && rt.jit) ? compileHot(rt, f, prog) : false, --quantum <= 0)) { quantum = QUANTUM; if (rt.multiThreaded && sched.hasOtherRunnable(thread, owner)) { f.pc = pc; need = true; break inner; } } } else pc += 2;
            break;
          }
          case 0x44: case 0x45: case 0x46: case 0x47: case 0x48: case 0x49: case 0x4a: {
            const packed = u[pc + 1], index = regs[packed >> 8], arrayRef = regs[packed & 255]; let array; if (arrayRef !== null && typeof arrayRef === 'object') array = heapList[arrayRef.ref];
            if (array === undefined || array.elements === undefined || !(index >= 0 && index < array.elements.length)) array = rt.array(arrayRef, index);
            const variant = op - 0x44, e = array.elements[index];
            if (variant === 1) { regs[a] = e; regs[a + 1] = WIDE_HIGH; } else regs[a] = variant === 3 ? e & 1 : variant === 4 ? (e << 24) >> 24 : variant === 5 ? e & 65535 : variant === 6 ? (e << 16) >> 16 : e;
            pc += 2; break;
          }
          case 0x4b: case 0x4c: case 0x4d: case 0x4e: case 0x4f: case 0x50: case 0x51: {
            const packed = u[pc + 1], index = regs[packed >> 8], arrayRef = regs[packed & 255]; let array; if (arrayRef !== null && typeof arrayRef === 'object') array = heapList[arrayRef.ref];
            if (array === undefined || array.elements === undefined || !(index >= 0 && index < array.elements.length)) array = rt.array(arrayRef, index);
            const variant = op - 0x4b, v = regs[a];
            const value = variant === 3 ? v & 1 : variant === 4 ? (v << 24) >> 24 : variant === 5 ? v & 65535 : variant === 6 ? (v << 16) >> 16 : v;
            if (variant === 2) rt.checkArrayValue(array, value);
            array.elements[index] = value;
            pc += 2; break;
          }
          case 0x52: case 0x53: case 0x54: case 0x55: case 0x56: case 0x57: case 0x58: {
            const objectRef = regs[hi]; let obj; if (objectRef !== null && typeof objectRef === 'object') obj = heapList[objectRef.ref]; if (obj === undefined) obj = rt.object(objectRef);
            let site = prog.refs[pc]; if (site === undefined || site.type !== obj.type) site = prog.refs[pc] = fieldSiteFor(rt, dex.fields[u[pc + 1]], obj.type);
            let v = obj.fields.get(site.key); if (v === undefined) v = site.def;
            const variant = op - 0x52;
            if (variant === 0 || variant === 2) regs[lo] = v;
            else if (variant === 1) { regs[lo] = v; regs[lo + 1] = WIDE_HIGH; } else regs[lo] = variant === 3 ? v & 1 : variant === 4 ? (v << 24) >> 24 : variant === 5 ? v & 65535 : (v << 16) >> 16;
            pc += 2; break;
          }
          case 0x59: case 0x5a: case 0x5b: case 0x5c: case 0x5d: case 0x5e: case 0x5f: {
            const objectRef = regs[hi]; let obj; if (objectRef !== null && typeof objectRef === 'object') obj = heapList[objectRef.ref]; if (obj === undefined) obj = rt.object(objectRef);
            let site = prog.refs[pc]; if (site === undefined || site.type !== obj.type) site = prog.refs[pc] = fieldSiteFor(rt, dex.fields[u[pc + 1]], obj.type);
            const variant = op - 0x59, v = regs[lo], value = variant <= 2 ? v : variant === 3 ? v & 1 : variant === 4 ? (v << 24) >> 24 : variant === 5 ? v & 65535 : (v << 16) >> 16;
            const fields = obj.fields; if (fields.has(site.key)) fields.set(site.key, value); else rt.storeField(fields, site.key, value);
            pc += 2; break;
          }
          case 0x60: case 0x61: case 0x62: case 0x63: case 0x64: case 0x65: case 0x66: {
            const reference = dex.fields[u[pc + 1]]; if (!reference) fail('Invalid static field index');
            let site = prog.refs[pc], v;
            if (site !== undefined && site.ready) { v = rt.staticFields.get(site.key); if (v === undefined) v = rt.readStatic(reference); }
            else { const field = rt.resolveField(reference); if (rt.initialized.get(field.owner)?.status !== 'initialized') { const gate = rt.initStep(field.owner); if (gate !== undefined) { f.pc = start; f.callPc = start; if (gate instanceof Blocked) { thread.blocked = gate; thread.blockKind = 'site'; thread.state = 'blocked'; need = true; } else input = { kind: 'start', invoke: gate }; break inner; } } v = rt.readStatic(reference); prog.refs[pc] = { ready: rt.initialized.get(field.owner)?.status === 'initialized' && rt.staticFields.has(field.key), key: field.key }; }
            const variant = op - 0x60;
            if (variant === 1) { regs[a] = v; regs[a + 1] = WIDE_HIGH; } else regs[a] = variant === 3 ? v & 1 : variant === 4 ? (v << 24) >> 24 : variant === 5 ? v & 65535 : variant === 6 ? (v << 16) >> 16 : v;
            pc += 2; break;
          }
          case 0x67: case 0x68: case 0x69: case 0x6a: case 0x6b: case 0x6c: case 0x6d: {
            const reference = dex.fields[u[pc + 1]]; if (!reference) fail('Invalid static field index');
            const variant = op - 0x67, v = regs[a], value = variant === 3 ? v & 1 : variant === 4 ? (v << 24) >> 24 : variant === 5 ? v & 65535 : variant === 6 ? (v << 16) >> 16 : v;
            const site = prog.refs[pc];
            if (site !== undefined && site.ready && rt.staticFields.has(site.key)) rt.staticFields.set(site.key, value);
            else { const field = rt.resolveField(reference); if (rt.initialized.get(field.owner)?.status !== 'initialized') { const gate = rt.initStep(field.owner); if (gate !== undefined) { f.pc = start; f.callPc = start; if (gate instanceof Blocked) { thread.blocked = gate; thread.blockKind = 'site'; thread.state = 'blocked'; need = true; } else input = { kind: 'start', invoke: gate }; break inner; } } rt.writeStatic(reference, value); prog.refs[pc] = { ready: rt.initialized.get(field.owner)?.status === 'initialized' && rt.staticFields.has(field.key), key: field.key }; }
            pc += 2; break;
          }
          case 0x6e: case 0x6f: case 0x70: case 0x71: case 0x72:
          case 0x74: case 0x75: case 0x76: case 0x77: case 0x78: {
            let site = prog.refs[pc]; if (site === undefined) site = prog.refs[pc] = makeInvokeSite(dex, u, pc, op, a, hi);
            // Inline cache: the DEX callee a call site resolved to is remembered (per receiver class for virtual calls) and entered without going through dispatch().
            // The callee's register file is filled straight from this frame's registers; no argument array is built on a hit.
            let cached = site.callee, calleeProg = site.calleeProg;
            if (cached !== null) {
              let hit = true;
              if (site.virtual) {
                const receiver = regs[site.first >= 0 ? site.first : u[pc + 2] & 15];
                const receiverType = receiver !== null && typeof receiver === 'object' ? (rt.heap.list[receiver.ref]?.type ?? rt.typeOf(receiver)) : rt.typeOf(receiver);
                if (receiverType !== site.type) {
                  // Polymorphic inline cache: the other receiver classes this site has resolved to a DEX body (the first one stays in site.callee, which compiled code reads).
                  hit = false; const poly = site.poly;
                  if (poly !== null) { const entry = poly.get(receiverType); if (entry !== undefined) { cached = entry.callee; calleeProg = entry.prog; hit = true; } }
                }
              }
              if (hit) {
                rt.callStats.cached++;
                if (site.isStatic && !site.initialized) { { const gate = rt.initStep(cached.method.owner); if (gate !== undefined) { f.pc = start; f.callPc = start; if (gate instanceof Blocked) { thread.blocked = gate; thread.blockKind = 'site'; thread.state = 'blocked'; need = true; } else input = { kind: 'start', invoke: gate }; break inner; } } site.initialized = rt.initialized.get(cached.method.owner)?.status === 'initialized'; }
                // APKRuntime.recordMethod / record, inlined for the steady state (counters known, trace ring past its fixed head): per-method counters, evidence row, ring entry.
                const calleeMethod = cached.method, info = calleeMethod.recordInfo, ring = rt.traceRing;
                if (!fastCalls || info === undefined || rt.traceMuted || ring == null || ring.head.length < 128) rt.recordMethod(calleeMethod);
                else {
                  info.stats.methods++; const evidence = info.evidence; if (evidence !== undefined && evidence.calls < Number.MAX_SAFE_INTEGER) evidence.calls++;
                  if (ring.length === 384) { ring.tail[ring.start] = info.entry; ring.start = ring.start === 383 ? 0 : ring.start + 1; rt.traceDropped = (rt.traceDropped ?? 0) + 1; }
                  else ring.tail[(ring.start + ring.length++) % 384] = info.entry;
                }
                if (frames.length + rt.depth >= rt.maxCallDepth) rt.throwJava('Ljava/lang/StackOverflowError;', 'stack size 1MB');
                const calleeCode = cached.code, argc = site.argc, nregs = calleeCode.registers, nr = new Array(nregs), at = nregs - argc;
                if (site.first >= 0) { const first = site.first; for (let j = 0; j < argc; j++) nr[at + j] = regs[first + j]; }
                else { const packed = u[pc + 2]; switch (argc) { case 5: nr[at + 4] = regs[lo]; case 4: nr[at + 3] = regs[(packed >> 12) & 15]; case 3: nr[at + 2] = regs[(packed >> 8) & 15]; case 2: nr[at + 1] = regs[(packed >> 4) & 15]; case 1: nr[at] = regs[packed & 15]; } }
                f.pc = pc + 3; f.callPc = start; if (frames.length + rt.depth + 1 > rt.peakCallDepth) rt.peakCallDepth = frames.length + rt.depth + 1;
                if (++calleeProg.calls === rt.jitThreshold) compileHot(rt, calleeProg);
                const getter = calleeProg.getter;
                if (getter !== null && fastCalls && quantum > 1 && rt.steps + 2 <= max && !probe) {
                  // Frameless trivial getter: the two instructions the callee would run (iget, return) are executed here, with their effects on the instruction budget and counters.
                  const receiver = regs[site.first >= 0 ? site.first : u[pc + 2] & 15]; let target; if (receiver !== null && typeof receiver === 'object') target = heapList[receiver.ref];
                  if (target !== undefined) {
                    const fieldSite = calleeProg.refs[0];
                    if (fieldSite !== undefined && fieldSite.type === target.type) {
                      let v = target.fields.get(fieldSite.key); if (v === undefined) v = fieldSite.def;
                      if (getter === 0x55) v &= 1; else if (getter === 0x56) v = (v << 24) >> 24; else if (getter === 0x57) v &= 65535; else if (getter === 0x58) v = (v << 16) >> 16;
                      rt.steps += 2; calleeProg.stats.instructions += 2; quantum--;
                      f.result = getter === 0x54 && (v === 0 || v === null) ? null : v; pc += 3; break;
                    }
                  }
                }
                f = new Frame(cached.method, calleeCode, nr, calleeProg); frames.push(f);
                regs = nr; prog = calleeProg; u = prog.units; dex = prog.dex; stats = prog.stats; pc = 0;
                if (--quantum <= 0) { quantum = QUANTUM; if (rt.multiThreaded && sched.hasOtherRunnable(thread, owner)) { f.pc = 0; need = true; break inner; } }
                break;
              }
            }
            if (site.isStatic && !site.initialized) { const owner = rt.staticOwner(site.target); if (rt.initialized.get(owner)?.status !== 'initialized') { const gate = rt.initStep(owner); if (gate !== undefined) { f.pc = start; f.callPc = start; if (gate instanceof Blocked) { thread.blocked = gate; thread.blockKind = 'site'; thread.state = 'blocked'; need = true; } else input = { kind: 'start', invoke: gate }; break inner; } } else site.initialized = true; }
            const argc = site.argc, args = new Array(argc);
            if (site.first >= 0) { const first = site.first; for (let j = 0; j < argc; j++) args[j] = regs[first + j]; }
            else { const packed = u[pc + 2]; switch (argc) { case 5: args[4] = regs[lo]; case 4: args[3] = regs[(packed >> 12) & 15]; case 3: args[2] = regs[(packed >> 8) & 15]; case 2: args[1] = regs[(packed >> 4) & 15]; case 1: args[0] = regs[packed & 15]; } }
            // Calls that resolve to a SHIM/platform bridge are cached too: the resolution is reused for the same call site (and receiver class) without re-walking dispatch().
            let outcome;
            const bridge = site.bridge;
            if (bridge !== null && site.bridgeEpoch === rt.resolveEpoch && (!site.virtual || (typeof args[0] !== 'string' && args[0] !== null && args[0] !== 0 && rt.typeOf(args[0]) === site.bridgeType && rt.heap.list[args[0].ref].annotationValues === undefined))) {
              rt.callStats.bridged++; rt.record(bridge.text);
              outcome = rt.bridge(bridge.selected, args, site.mode, bridge.key, bridge);
            } else {
              rt.callStats.dispatched++; rt.lastBridge = null; const depthBefore = rt.depth;
              outcome = rt.dispatch(site.target, args, site.mode, f.method.owner, true);
              if (rt.lastBridge !== null && rt.lastBridgeDepth === depthBefore + 1) {
                const annotationProxy = site.virtual && typeof args[0] !== 'string' && rt.object(args[0]).annotationValues !== undefined;
                if (!annotationProxy) { site.bridge = rt.lastBridge; site.bridgeEpoch = rt.resolveEpoch; site.bridgeType = site.virtual ? rt.typeOf(args[0]) : null; }
              }
              rt.lastBridge = null;
            }
            if (outcome instanceof PendingCall) {
              if (outcome.definition !== null && !(site.virtual && typeof args[0] !== 'string' && rt.object(args[0]).annotationValues)) {
                if (fastCalls && site.callee !== null && site.virtual) {
                  const type = rt.typeOf(args[0]), poly = site.poly ??= new Map();
                  if (type !== site.type && poly.size < 16) poly.set(type, { callee: outcome.definition, prog: prepare(rt, outcome.method, outcome.code) });
                } else { site.callee = outcome.definition; site.type = site.virtual ? rt.typeOf(args[0]) : null; site.calleeProg = prepare(rt, outcome.method, outcome.code); }
              }
              if (frames.length + rt.depth >= rt.maxCallDepth) rt.throwJava('Ljava/lang/StackOverflowError;', 'stack size 1MB');
              if (outcome.args.length !== outcome.code.incoming) fail(`Argument/register mismatch: ${outcome.method.key}`);
              f.pc = pc + 3; f.callPc = start; if (frames.length + rt.depth + 1 > rt.peakCallDepth) rt.peakCallDepth = frames.length + rt.depth + 1;
              f = makeFrame(rt, outcome.method, outcome.code, outcome.args); frames.push(f);
              regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats; pc = 0;
              if (--quantum <= 0) { quantum = QUANTUM; if (rt.multiThreaded && sched.hasOtherRunnable(thread, owner)) { f.pc = 0; need = true; break inner; } }
              break;
            }
            if (outcome instanceof Blocked) {
              // A blocking native: park this thread; the call finishes when the scheduler wakes it (see Scheduler.wake and the switch-in code above).
              f.pc = outcome.retry ? start : pc + 3; f.callPc = start; thread.blocked = outcome; thread.blockKind = 'site'; thread.state = 'blocked'; need = true; break inner;
            }
            if (outcome instanceof Invoke) {
              // A host step that needs Java to run (see Invoke): its callee runs as ordinary frames on this thread.
              f.pc = pc + 3; f.callPc = start; input = { kind: 'start', invoke: outcome }; break inner;
            }
            f.result = outcome; pc += 3; break;
          }
          // 32-bit integer arithmetic (the common forms; long, float and double arithmetic is in stepRare): operands are validated as before, add/sub/mul are inline.
          case 0x90: case 0x91: case 0x92: case 0x93: case 0x94: case 0x95: case 0x96: case 0x97: case 0x98: case 0x99: case 0x9a: {
            const packed = u[pc + 1]; let x = regs[packed & 255], y = regs[packed >> 8];
            if (typeof x !== 'number' || (x | 0) !== x) x = int(x);
            if (typeof y !== 'number' || (y | 0) !== y) y = int(y);
            const o = op - 0x90; regs[a] = o === 0 ? (x + y) | 0 : o === 1 ? (x - y) | 0 : o === 2 ? Math.imul(x, y) : arithmetic(o, x, y); pc += 2; break;
          }
          case 0xb0: case 0xb1: case 0xb2: case 0xb3: case 0xb4: case 0xb5: case 0xb6: case 0xb7: case 0xb8: case 0xb9: case 0xba: {
            let x = regs[lo], y = regs[hi];
            if (typeof x !== 'number' || (x | 0) !== x) x = int(x);
            if (typeof y !== 'number' || (y | 0) !== y) y = int(y);
            const o = op - 0xb0; regs[lo] = o === 0 ? (x + y) | 0 : o === 1 ? (x - y) | 0 : o === 2 ? Math.imul(x, y) : arithmetic(o, x, y); pc++; break;
          }
          case 0xd0: case 0xd1: case 0xd2: case 0xd3: case 0xd4: case 0xd5: case 0xd6: case 0xd7: {
            let x = regs[hi]; if (typeof x !== 'number' || (x | 0) !== x) x = int(x);
            const y = (u[pc + 1] << 16) >> 16, o = op - 0xd0;
            regs[lo] = o === 0 ? (x + y) | 0 : o === 1 ? (y - x) | 0 : o === 2 ? Math.imul(x, y) : arithmetic(o, x, y); pc += 2; break;
          }
          case 0xd8: case 0xd9: case 0xda: case 0xdb: case 0xdc: case 0xdd: case 0xde: case 0xdf: case 0xe0: case 0xe1: case 0xe2: {
            const packed = u[pc + 1]; let x = regs[packed & 255]; if (typeof x !== 'number' || (x | 0) !== x) x = int(x);
            const y = ((packed >> 8) << 24) >> 24, o = op - 0xd8;
            regs[a] = o === 0 ? (x + y) | 0 : o === 1 ? (y - x) | 0 : o === 2 ? Math.imul(x, y) : arithmetic(o, x, y); pc += 2; break;
          }
          default: pc = stepRare(rt, f, regs, u, dex, pc, op, a, lo, hi); break;
        }
       }
        if (returning) {
          // return from this frame to its caller (or out of the run loop at its base)
          returning = false; frames.pop();
          if (thread === owner && frames.length <= base) return returnValue;
          const caller = frames[frames.length - 1];
          if (caller === undefined) { thread.lastOutcome = { value: returnValue }; input = DRIVE; break inner; }   // a thread's run() finished
          if (caller.cont !== undefined) { input = { kind: 'returned', value: returnValue }; break inner; }       // a host step was waiting for this callee
          f = caller; regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats; pc = f.pc;
          f.result = returnValue;
        }
      }
    } catch (error) {
      returning = false; input = null;
      if (error?.vmFatal === true || f === null) throw error;
      f = frames[frames.length - 1];                                // compiled code may have entered callees directly: the failing frame is the top one
      regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats;
      if (f.cur >= 0) { start = f.cur; f.cur = -1; }               // thrown by compiled code: the instruction it was executing
      // Unwind: the frame that failed handles it, then its callers (and any host step waiting on them) until the run's base frame.
      let current = error, innermost = true;
      for (;;) {
        if (current instanceof APKError && /^(Integer|Long) (divide|remainder) by zero/.test(current.message)) {
          try { rt.throwJava('Ljava/lang/ArithmeticException;', current.message); } catch (converted) { current = converted; }
        }
        if (current instanceof JavaException) {
          const target = catchTarget(rt, f, start, current.value);
          if (target !== null) { f.pendingException = current.value; pc = target; rt.record(`CATCH ${rt.typeOf(current.value)} in ${f.method.key}`); regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats; break; }
          current.message = `${f.method.key} [${prog.filename}] at PC 0x${start.toString(16).padStart(4, '0')}: ${current.message}`;
        } else {
          // A register-type error names the failing opcode and the last host bridge the VM called, which is usually where the bad value came from.
          const where = innermost && /^Expected (int|long|wide|object|reference)/.test(current.message ?? '') ? ` [opcode 0x${(u[start] & 0xff).toString(16).padStart(2, '0')}${rt.lastHostCall ? `; last host call ${rt.lastHostCall}` : ''}]` : '';
          current = new APKError(`${f.method.key} [${prog.filename}] at PC 0x${start.toString(16).padStart(4, '0')}: ${current.message ?? current}${where}`, current.details);
        }
        innermost = false;
        frames.pop();
        if (thread === owner && frames.length <= base) throw current;
        const below = frames[frames.length - 1];
        if (below === undefined) { thread.lastOutcome = { error: current }; input = DRIVE; break; }         // uncaught in a thread: its driver decides (handler, fatal)
        if (below.cont !== undefined) { input = { kind: 'error', error: current }; break; }                 // a host step was waiting for the callee that failed
        f = below; regs = f.regs; prog = f.prog; u = prog.units; dex = prog.dex; stats = prog.stats; start = f.callPc; pc = f.pc;
      }
    }
  }
}

/** Opcodes that are rare or large (wide moves/constants, filled arrays, switches, comparisons, conversions, wide and mixed arithmetic), kept out of runLoop so its bytecode, register file and
 *  deoptimization surface stay small. Executes the instruction at `pc` and returns the next pc; it neither blocks nor switches frames. */
function stepRare(rt, f, regs, u, dex, pc, op, a, lo, hi) {
  switch (op) {
      case 0x04: { if (regs[hi + 1] !== WIDE_HIGH) fail(`Invalid wide high register v${hi + 1}`); regs[lo] = wide(regs[hi]); regs[lo + 1] = WIDE_HIGH; pc++; break; }
      case 0x05: { const s = u[pc + 1]; if (regs[s + 1] !== WIDE_HIGH) fail(`Invalid wide high register v${s + 1}`); regs[a] = wide(regs[s]); regs[a + 1] = WIDE_HIGH; pc += 2; break; }
      case 0x06: { const d = u[pc + 1], s = u[pc + 2]; if (regs[s + 1] !== WIDE_HIGH) fail(`Invalid wide high register v${s + 1}`); regs[d] = wide(regs[s]); regs[d + 1] = WIDE_HIGH; pc += 3; break; }
      case 0x16: regs[a] = BigInt((u[pc + 1] << 16) >> 16); regs[a + 1] = WIDE_HIGH; pc += 2; break;
      case 0x17: regs[a] = BigInt(u[pc + 1] | (u[pc + 2] << 16)); regs[a + 1] = WIDE_HIGH; pc += 3; break;
      case 0x18: regs[a] = BigInt.asIntN(64, BigInt(u[pc + 1]) | BigInt(u[pc + 2]) << 16n | BigInt(u[pc + 3]) << 32n | BigInt(u[pc + 4]) << 48n); regs[a + 1] = WIDE_HIGH; pc += 5; break;
      case 0x19: regs[a] = BigInt.asIntN(64, BigInt(u[pc + 1]) << 48n); regs[a + 1] = WIDE_HIGH; pc += 2; break;
      case 0x1c: { const type = dex.types[u[pc + 1]]; if (!type) fail('Invalid class type'); regs[a] = rt.classObject(type); pc += 2; break; }
      case 0x24: case 0x25: {
        const type = dex.types[u[pc + 1]]; if (!type?.startsWith('[') || ['J', 'D'].includes(type.slice(1))) fail('Invalid filled-new-array type');
        const registers = invokeRegisters(u, pc, regs, op, a, lo, hi), value = rt.newArray(type, registers.length), array = rt.object(value);
        for (let i = 0; i < registers.length; i++) { const entry = regs[registers[i]]; rt.checkArrayValue(array, entry); array.elements[i] = narrow(entry, type.slice(1)); }
        f.result = value; pc += 3; break;
      }
      case 0x26: {
        const array = rt.array(regs[a]), payload = pc + (u[pc + 1] | (u[pc + 2] << 16)), tag = u[payload], width = u[payload + 1];
        const size = u[payload + 2] + u[payload + 3] * 65536;
        const expected = { Z: 1, B: 1, C: 2, S: 2, I: 4, F: 4, J: 8, D: 8 }[array.type.slice(1)];
        if (tag !== 0x0300 || !expected || width !== expected || size > array.elements.length || payload + 4 + Math.ceil(size * width / 2) > f.code.units) fail('Malformed fill-array-data payload');
        const type = array.type.slice(1);
        for (let i = 0; i < size; i++) {
          const p = payload + 4 + (i * width >> 1);
          let value;
          if (width === 1) value = (i & 1) ? u[p] >> 8 : u[p] & 255;
          else if (width === 2) value = u[p];
          else if (width === 4) value = (u[p] | (u[p + 1] << 16)) | 0;
          else value = BigInt.asIntN(64, BigInt(u[p] | (u[p + 1] << 16)) & 0xffffffffn | BigInt(u[p + 2] | (u[p + 3] << 16)) << 32n);
          array.elements[i] = narrow(value, type);
        }
        pc += 3; break;
      }
      case 0x2b: case 0x2c: {
        const value = int(regs[a]), payload = pc + (u[pc + 1] | (u[pc + 2] << 16)), expected = op === 0x2b ? 0x0100 : 0x0200;
        if (u[payload] !== expected) fail('Malformed switch payload');
        const size = u[payload + 1]; if (size > 65535) fail('Switch size exceeds limit');
        let target = null;
        if (op === 0x2b) { const index = value - (u[payload + 2] | (u[payload + 3] << 16)); if (index >= 0 && index < size) { const at = payload + 4 + index * 2; target = u[at] | (u[at + 1] << 16); } }
        else {
          let low = 0, high = size - 1;
          while (low <= high) {
            const middle = (low + high) >>> 1, keyAt = payload + 2 + middle * 2, key = u[keyAt] | (u[keyAt + 1] << 16);
            if (key === value) { const at = payload + 2 + size * 2 + middle * 2; target = u[at] | (u[at + 1] << 16); break; }
            if (key < value) low = middle + 1; else high = middle - 1;
          }
        }
        if (target === null) pc += 3; else { const t = pc + target; if (t < 0 || t >= f.code.units) fail('Branch target outside method'); pc = t; }
        break;
      }
      case 0x2d: case 0x2e: case 0x2f: case 0x30: case 0x31: {
        const packed = u[pc + 1], left = packed & 255, right = packed >> 8;
        let x, y;
        if (op === 0x31) { x = H.getWide(regs, left); y = H.getWide(regs, right); }
        else if (op <= 0x2e) { x = floatNumber(regs[left]); y = floatNumber(regs[right]); }
        else { x = doubleNumber(H.getWide(regs, left)); y = doubleNumber(H.getWide(regs, right)); }
        regs[a] = Number.isNaN(x) || Number.isNaN(y) ? (op === 0x2e || op === 0x30 ? 1 : -1) : x < y ? -1 : x > y ? 1 : 0; pc += 2; break;
      }
      case 0x7b: regs[lo] = (-int(regs[hi])) | 0; pc++; break;
      case 0x7c: regs[lo] = ~int(regs[hi]); pc++; break;
      case 0x7d: H.putWide(regs, lo, -H.getWide(regs, hi)); pc++; break;
      case 0x7e: H.putWide(regs, lo, ~H.getWide(regs, hi)); pc++; break;
      case 0x7f: regs[lo] = floatBits(-floatNumber(regs[hi])); pc++; break;
      case 0x80: H.putWide(regs, lo, doubleBits(-doubleNumber(H.getWide(regs, hi)))); pc++; break;
      case 0x81: H.putWide(regs, lo, BigInt(int(regs[hi]))); pc++; break;
      case 0x82: regs[lo] = floatBits(int(regs[hi])); pc++; break;
      case 0x83: H.putWide(regs, lo, doubleBits(int(regs[hi]))); pc++; break;
      case 0x84: regs[lo] = Number(BigInt.asIntN(32, H.getWide(regs, hi))); pc++; break;
      case 0x85: regs[lo] = floatBits(Number(H.getWide(regs, hi))); pc++; break;
      case 0x86: H.putWide(regs, lo, doubleBits(Number(H.getWide(regs, hi)))); pc++; break;
      case 0x87: regs[lo] = javaInt(floatNumber(regs[hi])); pc++; break;
      case 0x88: H.putWide(regs, lo, javaLong(floatNumber(regs[hi]))); pc++; break;
      case 0x89: H.putWide(regs, lo, doubleBits(floatNumber(regs[hi]))); pc++; break;
      case 0x8a: regs[lo] = javaInt(doubleNumber(H.getWide(regs, hi))); pc++; break;
      case 0x8b: H.putWide(regs, lo, javaLong(doubleNumber(H.getWide(regs, hi)))); pc++; break;
      case 0x8c: regs[lo] = floatBits(doubleNumber(H.getWide(regs, hi))); pc++; break;
      case 0x8d: regs[lo] = signed8(int(regs[hi])); pc++; break;
      case 0x8e: regs[lo] = int(regs[hi]) & 65535; pc++; break;
      case 0x8f: regs[lo] = signed16(int(regs[hi])); pc++; break;
    default: {
        if (op >= 0x90 && op <= 0xcf) {
          const two = op >= 0xb0, relative = op - (two ? 0xb0 : 0x90);
          const group = relative < 11 ? 0 : relative < 22 ? 1 : relative < 27 ? 2 : 3;
          const operation = relative - (group === 0 ? 0 : group === 1 ? 11 : group === 2 ? 22 : 27);
          const packed = two ? 0 : u[pc + 1], destination = two ? lo : a, left = two ? lo : packed & 255, right = two ? hi : packed >> 8;
          const wideLeft = group === 1 || group === 3, wideRight = group === 3 || (group === 1 && operation < 8);
          const x = wideLeft ? H.getWide(regs, left) : regs[left], y = wideRight ? H.getWide(regs, right) : regs[right];
          const value = numericBinary(group, operation, x, y);
          if (wideLeft) H.putWide(regs, destination, value); else regs[destination] = value;
          pc += two ? 1 : 2;
        } else if (op >= 0xd0 && op <= 0xd7) {
          const x = int(regs[hi]), y = (u[pc + 1] << 16) >> 16, operation = op - 0xd0;
          regs[lo] = operation === 1 ? (y - x) | 0 : arithmetic(operation, x, y); pc += 2;
        } else if (op >= 0xd8 && op <= 0xe2) {
          const packed = u[pc + 1], x = int(regs[packed & 255]), y = ((packed >> 8) << 24) >> 24, operation = op - 0xd8;
          regs[a] = operation === 1 ? (y - x) | 0 : arithmetic(operation, x, y); pc += 2;
        } else fail(`Unsupported opcode 0x${op.toString(16).padStart(2, '0')}`);
      }
  }
  return pc;
}

// Closures live outside runLoop: a function that creates closures over its locals keeps them in a heap context, which slows every instruction.
function probeWord(u, pc) { return offset => u[pc + (offset ?? 0)]; }
function monitorWait(rt, value) { return new Blocked({ ready: () => rt.monitorFree(value), reason: 'monitor', retry: true }); }

function invokeRegisters(u, pc, regs, op, a, lo, hi) {
  if (op === 0x24 || op === 0x6e || op === 0x6f || op === 0x70 || op === 0x71 || op === 0x72) {
    if (hi > 5) fail('Invalid invoke register count');
    const packed = u[pc + 2];
    if (hi === 0) return [];
    const list = [packed & 15, (packed >> 4) & 15, (packed >> 8) & 15, (packed >> 12) & 15, lo];
    return list.slice(0, hi);
  }
  const first = u[pc + 2]; if (first + a > regs.length) fail('Invalid invoke-range registers');
  const out = new Array(a); for (let j = 0; j < a; j++) out[j] = first + j; return out;
}
