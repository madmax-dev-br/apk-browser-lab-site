// Green threads of the WebAssembly core, driven by the JavaScript VM's own scheduler (src/scheduler.js), in one Worker (docs/WASM-CORE-PLANO.md, phase 2; vmcore/threads.h has
// the core's side). The smallest adapter that lets the Scheduler class drive core threads instead of JavaScript frame stacks:
//
//   - Every Java thread is a VMThread of the Scheduler (the JavaScript VM's: java.lang.Thread's host, Looper, executors... create and start them unchanged) with a core Thread
//     record of its own (`thread.core.t`: its Java stack, its tid in the lock words). The main thread has the engine's first record; a thread gets one when it starts, and gives it
//     back when it ends. Every record is THREAD_NO_BLOCK (the core never waits: it returns THREAD_BLOCKED with the word to watch); started threads are also THREAD_GREEN (they
//     return YIELDED at the end of every quantum, where the JavaScript interpreter asks the scheduler whether another thread should run). The main thread never yields, as in the
//     JavaScript VM (Scheduler.hasOtherRunnable: main runs host events and gives the processor up only by blocking).
//   - A run of a record stops in one of three resumable ways, and the thread is parked the way the JavaScript interpreter parks one, with a Blocked the scheduler's wake() tests:
//       THREAD_BLOCKED  a monitor, Object.wait (the core's natives), a class another thread initializes: ready when the watched word changed (Thread.blockWord/blockValue); a
//                       timed Object.wait has the virtual clock's deadline and is timed out with thr_wait_timeout. Resumed with resume().
//       HOST_BLOCKED    a host answered a step that is not over at the call site -- a wait (a Blocked: Thread.sleep/join, LockSupport.park, Future.get,
//                       MessageQueue.nativePollOnce...) or a call into Java with a continuation (an Invoke): the invoke is complete but for its value. The thread takes
//                       the step on its own record (pump()): a callee runs above the stopped frames, a wait parks the thread, and the value or the exception the step
//                       ends with is delivered with resume_host (vmcore/host.h).
//       YIELDED         the quantum ended and another thread is runnable.
//   - Who runs, and when, is the Scheduler's: pick(), wake(), idle() (events, the virtual clock skipped to the earliest deadline, deadlocks reported with its own message),
//     hasOtherRunnable(), switching(), serviceEvents(), resolveNested(). A run that host code starts (APKRuntime.execute -> WasmEngine.runNested) is the JavaScript VM's run loop with
//     an owner (interpreter.js runLoop): while its owner is parked, other threads run inside it as guests, until the owner can go on. runtime.runThreads() (the event pump's
//     background slices, Scheduler.resolveNested) is the loop without an owner: one slice of one thread.
//   - A started thread's work is its driver (Scheduler.start), as in the JavaScript VM's pump: what it hands back (a PendingCall, an Invoke, a Blocked, a value) is a host
//     step like a call site's, and its outcome (value or exception) is the driver's lastOutcome; an exception that escapes the driver goes to the thread's uncaught handler.
//   - Host steps never nest a run on the JavaScript stack (the JavaScript interpreter keeps them as continuation frames of the thread; here they are thread.core.steps): a
//     thread in the middle of one waits, yields and resumes like any other, in any order. A run nested on the stack would have to end before the run below it could go on: a
//     thread that waited for good inside one held every thread under it, and two threads waiting for each other's work in the wrong order never met.
//   - What stays a nested wait (Scheduler.resolveNested, other threads running on top of the JavaScript stack, as in the JavaScript VM): the waits of host code that called
//     Java itself and needs the answer before it returns (APKRuntime.execute from a host: View.measure calling onMeasure, a Comparator called by a sort), and the waits of host
//     code itself (APKRuntime.monitorEnter, executors' helpUntil).
//   - One flag and one set of monitors: Thread.interrupted of a VMThread is the record's word (thr_interrupt also takes the thread out of Object.wait); the runtime's monitor
//     entry points used by host code (monitorTryEnter, monitorExit, monitorFree, monitorEnter, ownsMonitor) are the core's lock words; a thread that ends wakes whoever waits on
//     its Thread object (ART's notifyAll at thread exit).
import { Blocked } from '../../runtime/scheduler.js?v=0d5a397ebb41';
const MAX_LIVE_THREADS = 1000;   // threads.h: tids 1..1022, the collector's thread table holds 1024 (host-bridge.js)
import { PendingCall, Invoke } from '../../runtime/interpreter.js?v=0d5a397ebb41';
import { APKError, JavaException } from '../../runtime/apk-runtime.js?v=0d5a397ebb41';

export const CORE_STATUS = Object.freeze({ OK: 0, OUT_OF_MEMORY: 5, UNCAUGHT: 48, HOST_STOPPED: 64, HOST_FAILED: 65, HOST_BLOCKED: 66, THREAD_BLOCKED: 80, YIELDED: 81, HOST_THROW: 0x7fff0110 });
const S = CORE_STATUS;
const T = { status: 12, detail: 16, steps: 32, result: 48, calls: 56, stackTop: 2128, frame: 2132, pc: 2136, depth: 2140, throwing: 2144, maxDepth: 2148,
  tid: 2152, state: 2156, flags: 2160, blockWord: 2164, blockValue: 2168, blockedOn: 2172, waitNext: 2176, waitState: 2180, waitMonitor: 2184, waitCount: 2188, waitPhase: 2192,
  interrupted: 2196, gcSeen: 2200, waitMillis: 2204 };
export const THREADS_STATE_BYTES = 96 + 4 * 1024, MONITOR_BYTES = 48, MONITORS = 4096;
const FLAG_NO_BLOCK = 1, FLAG_GREEN = 2, WAIT_LISTED = 1, WAIT_REACQUIRE = 2;
const PARKED = -1, YIELD = -2, DONE = -3;   // advance(): the thread is parked, yielded, or its work is done
const STEP_WAIT = Object.freeze({ kind: 'step' }), DRIVE_STEP = Object.freeze({ kind: 'wait', wait: Object.freeze({ kind: 'drive' }) });

export class CoreThreads {
  /** `engine`: the WasmEngine; `records`: { main, guestBase, guestSpan, guestCount, javaStack } (vmcore/js/host-bridge.js LAYOUT). */
  constructor(engine, records) {
    this.engine = engine; this.rt = engine.runtime; this.sched = engine.runtime.scheduler; this.x = engine.x; this.records = records;
    this.free = []; this.nextGuest = 0; this.last = null; this.retired = { steps: 0, calls: 0 };
    this.stats = { started: 0, ended: 0, slices: 0, parks: 0, hostParks: 0, yields: 0, auxRuns: 0 };
  }
  get u32() { return this.engine.u32; }

  /** ThreadsState and its monitor pool in metaspace; the main thread's record attached (no-block, never yields); the runtime's thread entry points redirected. */
  setup() {
    const { engine, x, rt, sched } = this, linker = engine.linker;
    const ts = this.ts = linker.alloc(THREADS_STATE_BYTES), pool = linker.alloc(MONITORS * MONITOR_BYTES + 8);
    x.thr_init(ts, linker.vm, pool, MONITORS * MONITOR_BYTES);
    if (!x.thr_attach(this.records.main, FLAG_NO_BLOCK)) throw new APKError('vmcore: no tid for the main thread');
    const main = sched.mainThread(); this.bind(main, this.records.main);
    const start = sched.start.bind(sched), terminate = sched.terminate.bind(sched);
    sched.start = (thread, driver) => { if (thread.core === undefined) this.bind(thread, this.allocate(), FLAG_NO_BLOCK | FLAG_GREEN); this.stats.started++; return start(thread, driver); };
    sched.terminate = thread => { terminate(thread); this.ended(thread); };
    rt.runThreads = () => this.slice();
    // the collector's roots (Scheduler.enumerateRoots): what the host steps in progress keep, as the JavaScript VM's continuation frames -- an Invoke's arguments and declared
    // roots -- and the wait a run on a parked thread set aside (WasmEngine.runNested)
    const enumerate = sched.enumerateRoots;
    sched.enumerateRoots = function (visit) {
      enumerate.call(this, visit);
      const each = values => { if (values) for (const value of values) if (value !== undefined && value !== null && typeof value === 'object') visit(value); };
      for (const thread of this.threads) {
        const steps = thread.core?.steps; if (steps === undefined) continue;
        for (const step of steps) { if (step.kind === 'invoke') { each(step.invoke.args); each(step.invoke.roots); } else if (step.kind === 'own' && step.parked) each(step.parked.blocked?.roots); }
      }
    };
    // monitors of host code: the core's lock words, owned by the current thread's tid
    const word = value => { const address = engine.refWord(value); if (!address) rt.throwJava('Ljava/lang/NullPointerException;', 'null monitor'); return address; };
    const recordOf = thread => (thread ?? rt.thread ?? sched.mainThread()).core?.t ?? engine.t;
    rt.monitorTryEnter = (value, thread) => x.mon_enter(recordOf(thread), word(value)) === S.OK;
    rt.monitorFree = value => x.mon_owner(word(value) + 4, 0) === 0;
    rt.monitorEnter = value => { while (!rt.monitorTryEnter(value)) sched.resolveNested(new Blocked({ ready: () => rt.monitorFree(value), reason: 'monitor' })); };
    rt.monitorExit = (value, thread) => { if (x.mon_exit(recordOf(thread), word(value)) !== S.OK) rt.throwJava('Ljava/lang/IllegalMonitorStateException;', 'monitor not owned'); };
    rt.ownsMonitor = (value, thread) => { const t = recordOf(thread); return x.mon_owner(word(value) + 4, 0) === this.u32[(t + T.tid) >> 2]; };
  }

  /** A record for a started thread: a recycled one, or the next of the guest region. */
  allocate() {
    let t = this.free.pop();
    if (t === undefined) {
      // One record per thread the layout was sized for (src/core-memory.js `threads`, at most the core's thread ids: threads.h THREAD_MAX_TID); past them the start fails by name.
      const limit = Math.min(MAX_LIVE_THREADS, this.records.guestCount);
      if (this.nextGuest >= limit) throw new APKError(`vmcore: ${this.nextGuest} threads are alive or parked in the core; ${limit < MAX_LIVE_THREADS ? `it was sized for ${limit} (raise "threads" in Controles › Execução › Memória do núcleo Wasm, up to ${MAX_LIVE_THREADS})` : 'no thread id is left for another'}`, { kind: 'vmcore-threads' });
      t = this.records.guestBase + this.records.guestSpan * this.nextGuest;
      this.nextGuest++;
      this.engine.initRecord(t, t + this.records.javaStack, t + this.records.guestSpan);
    }
    return t;
  }
  /** Gives VMThread `thread` record `t` in mode `flags`: a tid, and its interrupt flag over the record's word. */
  bind(thread, t, flags = FLAG_NO_BLOCK) {
    const { x } = this, u32 = () => this.u32, pending = thread.interrupted === true;
    if (thread.core === undefined) {
      thread.core = { t, deadline: undefined, steps: [] };
      Object.defineProperty(thread, 'interrupted', { configurable: true, enumerable: true,
        get: () => u32()[(thread.core.t + T.interrupted) >> 2] !== 0, set: value => x.thr_set_interrupted(thread.core.t, value ? 1 : 0) });
    } else thread.core.t = t;
    if (!x.thr_attach(t, flags)) throw new APKError('vmcore: no thread id left in the core');
    if (pending) x.thr_set_interrupted(t, 1);
  }
  /** A thread ended: whoever waits on its Thread object wakes (ART's Thread exit: notifyAll), and its record is recycled. */
  ended(thread) {
    const core = thread.core; if (core === undefined || core.t === this.records.main) return;
    this.stats.ended++;
    const object = thread.javaObject; if (object !== null && object !== undefined) { const address = this.engine.refWord(object); if (address) this.x.mon_notify_all_unowned(address); }
    const t = core.t, view = this.engine.view;
    this.retired.steps += Number(view.getBigUint64(t + T.steps, true)); this.retired.calls += Number(view.getBigUint64(t + T.calls, true));
    this.engine.resetRecord(t); this.free.push(t);
  }
  /** Instructions and calls of every record (the ended threads' included). */
  totals() {
    const view = this.engine.view; let steps = this.retired.steps, calls = this.retired.calls;
    for (const thread of new Set([this.sched.mainThread(), ...this.sched.threads])) { const t = thread.core?.t; if (t !== undefined) { steps += Number(view.getBigUint64(t + T.steps, true)); calls += Number(view.getBigUint64(t + T.calls, true)); } }
    return { steps, calls };
  }

  // ---- parking
  /** THREAD_BLOCKED: wait until the record's watched word changes (a timed Object.wait until its deadline on the virtual clock). */
  parkCore(thread) {
    const t = thread.core.t, u32 = this.u32, word = u32[(t + T.blockWord) >> 2] >>> 2, value = u32[(t + T.blockValue) >> 2], phase = u32[(t + T.waitPhase) >> 2], on = u32[(t + T.blockedOn) >> 2];
    const millis = u32[(t + T.waitMillis) >> 2];
    let deadline = Infinity;
    if (phase === WAIT_LISTED && millis) deadline = thread.core.deadline ??= this.sched.clock.now() + millis;
    const reason = on ? 'monitor' : phase === WAIT_LISTED ? 'Object.wait' : phase === WAIT_REACQUIRE ? 'Object.wait (reacquire)' : 'class initialization';
    let blocker = null;
    if (on) blocker = this.engine.refValue(on - 4);
    else if (phase !== 0) { const monitor = u32[(t + T.waitMonitor) >> 2]; if (monitor) blocker = this.engine.refValue(u32[monitor >> 2] - 4); }
    thread.blocked = new Blocked({ ready: () => this.u32[word] !== value, deadline, reason, blocker, roots: blocker === null ? [] : [blocker] });
    thread.state = 'blocked'; thread.coreWait = { kind: 'core' }; this.stats.parks++;
  }
  /** A host's Blocked, met by a host step of the thread (`thread.core.steps` says where its value goes). */
  parkHost(thread, blocked) { thread.blocked = blocked; thread.state = 'blocked'; thread.coreWait = STEP_WAIT; this.stats.hostParks++; }

  /** Continues a parked or preempted thread: a run status, PARKED (it waits again), or null (its driver's step is over: drive it). */
  resume(thread) {
    const wait = thread.coreWait, t = thread.core.t, x = this.x; thread.coreWait = null;
    if (wait === null || wait === undefined) return null;
    if (wait.kind === 'yield') return x.resume(t) >>> 0;
    const blocked = thread.blocked, timedOut = thread.timedOut === true; thread.blocked = null; thread.state = 'runnable';
    if (wait.kind === 'core') {
      thread.core.deadline = undefined;
      if (timedOut && this.u32[(t + T.waitPhase) >> 2] === WAIT_LISTED) x.thr_wait_timeout(t);
      return x.resume(t) >>> 0;
    }
    return this.pump(thread, typeof blocked.coreRetry === 'function' ? blocked.coreRetry : () => blocked.finish(timedOut));
  }
  /**
   * The host steps of `thread`, as the JavaScript interpreter's pump takes them (interpreter.js pump): nothing here nests a run on the JavaScript stack, so the thread can park,
   * yield and be resumed in the middle of any of them. `thread.core.steps` is what the interpreter keeps in the thread's frame stack between DEX frames:
   *   { kind: 'wait', wait }      a host step began here: its value goes to the core's invoke (`wait.kind` 'host': resume_host, the call site's result type) or to the thread's
   *                               driver ('drive': lastOutcome);
   *   { kind: 'invoke', invoke }  an Invoke whose callee is in progress (the interpreter's ContFrame): the callee's value goes to then(), its exception to onError();
   *   { kind: 'run', saved, .. }  a DEX body in progress on the thread's record, above the frames that were live (their registers of the record are in `saved`);
   *   { kind: 'own' }             the base of a run host code started and waits for on the JavaScript stack (WasmEngine.runOn): its end is that caller's.
   * `produce` gives the outcome to go on from (a value, an Invoke, a PendingCall or a Blocked, or it throws). Returns the status of the run it started or resumed, PARKED (the
   * thread waits: a Blocked), or null (the driver's step is over).
   */
  pump(thread, produce) {
    const engine = this.engine, rt = this.rt, steps = thread.core.steps, mark = engine.pins.length;
    let action, value, error, failed = false;
    try {
      try { value = produce(); } catch (thrown) { failed = true; error = thrown; }
      for (;;) {
        if (failed) {
          if (error?.vmFatal === true || error?.name === 'CoreStop') throw error;   // the process-ending crash, or a stop of the core, is not an exception a continuation may take
          const top = steps[steps.length - 1];
          if (top !== undefined && top.kind === 'invoke') {
            steps.pop();
            if (top.invoke.onError !== null) { try { value = top.invoke.onError(error); failed = false; } catch (thrown) { error = thrown; } }
            continue;
          }
          if (top === undefined || top.kind !== 'wait') throw error;
          steps.pop();
          if (top.wait.kind === 'drive') { thread.lastOutcome = { error }; action = null; break; }
          const address = error instanceof JavaException || error?.name === 'JavaException' ? engine.refWord(error.value) : 0;
          if (!address) throw error;
          engine.view.setBigUint64(thread.core.t + T.result, BigInt(address), true); action = { how: S.HOST_THROW }; break;
        }
        if (value instanceof Blocked) { this.parkHost(thread, value); action = PARKED; break; }
        if (value instanceof PendingCall) { action = this.enter(thread, value); break; }
        if (value instanceof Invoke) {
          steps.push({ kind: 'invoke', invoke: value });
          try { value = rt.dispatch(value.method, value.args, value.mode, null, true); } catch (thrown) { failed = true; error = thrown; }
          continue;
        }
        const top = steps[steps.length - 1];
        if (top !== undefined && top.kind === 'invoke') {
          steps.pop();
          if (top.invoke.then !== null) { try { value = top.invoke.then(value); } catch (thrown) { failed = true; error = thrown; } }
          continue;
        }
        if (top === undefined || top.kind !== 'wait') throw new APKError(`vmcore: a host step of ${thread.name} ended with nothing waiting for its value`);
        steps.pop();
        if (top.wait.kind === 'drive') { thread.lastOutcome = { value }; action = null; break; }
        const t = thread.core.t;
        engine.writeValue(t + T.result, top.wait.result, value); if (top.wait.result !== 'J' && top.wait.result !== 'D') this.u32[(t + T.result + 4) >> 2] = 0;
        action = { how: S.OK }; break;
      }
    } finally { if (engine.pins.length > mark) engine.pins.length = mark; }   // what the steps keep is in thread.core.steps, the record or thread.blocked (roots)
    if (action === null || action === PARKED) return action;
    return (action.how !== undefined ? this.x.resume_host(thread.core.t, action.how) : this.x.run_nested(thread.core.t, action.id, thread.core.t + engine.argsOffset, 0)) >>> 0;
  }
  /** A DEX body a host step handed back: a run on the thread's record above its live frames (whose registers of the record come back when it ends: leave()). */
  enter(thread, pending) {
    const engine = this.engine, mi = engine.methodInfo(pending.method), t = thread.core.t, u32 = this.u32, view = engine.view;
    if (!mi) throw new APKError(`vmcore: a host step selected ${pending.method.key}, which the core's linker does not know`);
    const words = engine.wordsOf(pending.args);
    if (words.length > 440) throw new APKError(`vmcore: ${words.length} argument words`);
    thread.core.steps.push({ kind: 'run', t, result: pending.method.result ?? pending.method.signature.slice(pending.method.signature.indexOf(')') + 1),
      saved: { frame: u32[(t + T.frame) >> 2], pc: u32[(t + T.pc) >> 2], depth: u32[(t + T.depth) >> 2], stackTop: u32[(t + T.stackTop) >> 2], throwing: u32[(t + T.throwing) >> 2],
        status: u32[(t + T.status) >> 2], detail: u32[(t + T.detail) >> 2], result: view.getBigUint64(t + T.result, true) } });
    words.forEach((w, i) => { u32[((t + engine.argsOffset) >> 2) + i] = w >>> 0; });
    return { id: mi.id };
  }
  /** The run of the thread's top step ended with `status`: the record is the caller's again, and the value or the exception goes on through the steps below. */
  leave(thread, status) {
    const engine = this.engine, t = thread.core.t, view = engine.view, u32 = this.u32, entry = thread.core.steps.pop();
    if (entry === undefined || entry.kind !== 'run' || entry.t !== t) throw new APKError(`vmcore: a run of ${thread.name} ended (status ${status}) and no host step started it`);
    const raw = view.getBigUint64(t + T.result, true), detail = u32[(t + T.detail) >> 2], saved = entry.saved;
    u32[(t + T.frame) >> 2] = saved.frame; u32[(t + T.pc) >> 2] = saved.pc; u32[(t + T.depth) >> 2] = saved.depth; u32[(t + T.stackTop) >> 2] = saved.stackTop;
    u32[(t + T.throwing) >> 2] = saved.throwing; u32[(t + T.status) >> 2] = saved.status; u32[(t + T.detail) >> 2] = saved.detail; view.setBigUint64(t + T.result, saved.result, true);
    if (status === S.OK) return this.pump(thread, () => engine.valueOf(entry.result, raw));
    if (status === S.UNCAUGHT) return this.pump(thread, () => { const address = Number(raw & 0xffffffffn); throw new JavaException(engine.refValue(address), engine.messageOf(address)); });
    throw engine.stopError(status, detail);
  }
  /** The thread's work (Scheduler.start's driver, as the JavaScript interpreter's pump asks it): DONE, PARKED, null (ask again), or the status of the run it started. */
  drive(thread) {
    const driver = thread.driver; if (driver === null || driver === undefined) return DONE;
    let R;
    try { R = driver(this.rt, thread); }
    catch (error) {
      let handler;
      try { handler = this.rt.threadUncaught(thread, error); } catch (fatal) { fatal.vmFatal = true; this.rt.noteThreadFailure(thread, fatal); throw fatal; }
      if (!(handler instanceof Invoke)) return DONE;
      thread.driver = null; R = handler;   // the handler runs as the thread's last work; what it throws is ignored
    }
    if (R === undefined) return DONE;
    thread.core.steps.push(DRIVE_STEP);
    return this.pump(thread, () => R);
  }

  /**
   * Takes `thread`'s run on from `status` until it parks (PARKED), yields (YIELD) or its work is done (DONE) -- or, for the owner of a run host code waits for (the base of its
   * steps is 'own'), until that run is over: its final status.
   */
  advance(thread, owner, status) {
    const x = this.x, engine = this.engine, steps = thread.core.steps;
    for (let stuck = -1; ;) {
      if (status === PARKED) return PARKED;
      if (status === null) { status = this.drive(thread); if (status === DONE) { this.sched.terminate(thread); return DONE; } continue; }
      const t = thread.core.t;
      switch (status) {
        case S.OUT_OF_MEMORY: {
          if (!this.u32[(t + T.frame) >> 2]) break;
          const count = Number(engine.view.getBigUint64(t + T.steps, true));
          if (count === stuck) { status = x.throw_oom(t) >>> 0; stuck = -1; continue; }   // a collection did not help: OutOfMemoryError into the run
          stuck = count; engine.collect('run'); status = x.resume(t) >>> 0; continue;
        }
        case S.YIELDED:
          if (this.mustYield(thread, owner)) { thread.coreWait = { kind: 'yield' }; thread.state = 'runnable'; this.stats.yields++; return YIELD; }
          status = x.resume(t) >>> 0; continue;
        case S.THREAD_BLOCKED:
          if (!this.u32[(t + T.frame) >> 2]) break;   // run() did not start (a stopped world: never in green threads)
          this.parkCore(thread); return PARKED;
        case S.HOST_BLOCKED: {   // a host answered a step at a call site (a wait, a call into Java): the invoke is complete but for its value
          const parked = engine.takeParked();
          steps.push({ kind: 'wait', wait: { kind: 'host', result: parked.result } });
          status = this.pump(thread, () => parked.step); continue;
        }
      }
      if (steps.length !== 0 && steps[steps.length - 1].kind === 'own') return status;   // the end of a run host code waits for
      status = this.leave(thread, status);
    }
  }
  mustYield(thread, owner) {
    const rt = this.rt;
    return (rt.multiThreaded && this.sched.hasOtherRunnable(thread, owner)) || (owner === null && rt.sliceDeadline !== 0 && rt.sliceDeadline !== undefined && performance.now() > rt.sliceDeadline);
  }

  /** WasmEngine.runNested's loop: `owner`'s run from `status` to its final status, the other threads running whenever the owner is parked or yields. */
  finish(owner, status) {
    for (;;) {
      status = this.advance(owner, owner, status);
      if (status !== PARKED && status !== YIELD) return status;
      this.waitFor(owner);
      status = this.resume(owner);
    }
  }
  /** The run loop with an owner, while the owner cannot go on (interpreter.js runLoop's thread switch). */
  waitFor(owner) {
    const sched = this.sched, rt = this.rt;
    for (;;) {
      if (owner.state === 'blocked' || sched.starved) sched.serviceEvents();
      const choice = sched.pick(this.last ?? owner, owner);
      if (choice.thread === owner) { if (this.last !== owner) sched.switching(rt, this.last, owner); this.last = owner; rt.thread = owner; return; }
      if (choice.thread !== null) { this.guest(choice.thread, owner); continue; }
      rt.thread = sched.mainThread();
      try { sched.idle(choice.earliest, `${owner.name} is blocked (${owner.blocked?.reason ?? 'unknown'})`); } finally { rt.thread = owner; }
    }
  }
  /** One slice of `thread` (not the owner): it runs until it parks, yields, or its work is done. */
  guest(thread, owner) {
    const rt = this.rt, previous = rt.thread;
    if (thread !== this.last) this.sched.switching(rt, this.last, thread);
    this.last = thread; rt.thread = thread; this.stats.slices++;
    try { return this.advance(thread, owner, this.resume(thread)); }
    catch (error) { if (thread !== this.sched.mainThread()) rt.noteThreadFailure(thread, error); throw error; }   // a lab error on a background thread: recorded where it happens, whoever catches it
    finally { rt.thread = previous; }
  }
  /** runtime.runThreads(): one scheduling slice without an owner (the event pump's background work, Scheduler.resolveNested). */
  slice() {
    const rt = this.rt;
    if (rt.nestedRuns >= rt.maxNestedRuns) rt.throwJava('Ljava/lang/StackOverflowError;', 'native re-entry depth exceeded');
    if (++rt.nestedRuns === 1) this.sched.beginEvent(rt);   // as interpreter.js runSlice: a run is in progress (host code it calls is not a new event on main)
    try {
      const choice = this.sched.pick(this.last, null);
      if (choice.thread !== null) this.guest(choice.thread, null);
      return undefined;
    } finally { rt.nestedRuns--; }
  }

  /**
   * A run started by host code on a thread whose record is parked in the core (the JavaScript VM serves main-Looper messages on the main thread while it waits): the record's
   * frames and wait (an Object.wait listed on a monitor) must stay as they are, so the run gets a record of its own with the same tid (the same owner of every lock) for as long
   * as it lasts. Returns the function that puts the thread's own record back.
   */
  borrow(thread) {
    const core = thread.core; if (core === undefined || !thread.coreWait) return null;
    const own = core.t, aux = this.allocate(), tid = this.u32[(own + T.tid) >> 2], auxTid = this.u32[(aux + T.tid) >> 2];
    this.u32[(aux + T.tid) >> 2] = tid; this.u32[(aux + T.flags) >> 2] = this.u32[(own + T.flags) >> 2]; this.u32[(aux + T.state) >> 2] = 0;
    core.t = aux; this.stats.auxRuns++;
    return () => {
      const view = this.engine.view;
      view.setBigUint64(own + T.steps, view.getBigUint64(own + T.steps, true) + view.getBigUint64(aux + T.steps, true), true);
      view.setBigUint64(own + T.calls, view.getBigUint64(own + T.calls, true) + view.getBigUint64(aux + T.calls, true), true);
      core.t = own; this.engine.resetRecord(aux); this.u32[(aux + T.tid) >> 2] = auxTid; this.free.push(aux);
    };
  }
}
