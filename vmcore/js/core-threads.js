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
import { Blocked } from '../../runtime/scheduler.js?v=5abc89d1cc06';
const MAX_LIVE_THREADS = 1000;   // threads.h: tids 1..1022, the collector's thread table holds 1024 (host-bridge.js)
import { PendingCall, Invoke } from '../../runtime/interpreter.js?v=5abc89d1cc06';
import { APKError, JavaException } from '../../runtime/apk-runtime.js?v=5abc89d1cc06';
import { CLASS } from './linker.js?v=5abc89d1cc06';
const CLASS_INIT_STATE = CLASS.initState, CLASS_INITIALIZING = 1;   // vmcore/abi.h CLASS_INITIALIZING

export const CORE_STATUS = Object.freeze({ OK: 0, OUT_OF_MEMORY: 5, UNCAUGHT: 48, HOST_STOPPED: 64, HOST_FAILED: 65, HOST_BLOCKED: 66, THREAD_BLOCKED: 80, YIELDED: 81, BREAKPOINT: 96, STEPPED: 97, EXCEPTION_EVENT: 98, HOST_THROW: 0x7fff0110 });
const S = CORE_STATUS, CORE_UNSUPPORTED = 6;   // vmcore/abi.h: also what resume/resume_host answer for a record with nothing to resume (detail 0)
const T = { status: 12, detail: 16, steps: 32, result: 48, calls: 56, stackTop: 2128, frame: 2132, pc: 2136, depth: 2140, throwing: 2144, maxDepth: 2148,
  tid: 2152, state: 2156, flags: 2160, blockWord: 2164, blockValue: 2168, blockedOn: 2172, waitNext: 2176, waitState: 2180, waitMonitor: 2184, waitCount: 2188, waitPhase: 2192,
  interrupted: 2196, gcSeen: 2200, waitMillis: 2204, quantum: 76 };
// A background thread's quantum during a slice of the event pump (android-platform.js drainEvents): the slice's deadline is seen only where a quantum ends (YIELDED), and a
// quantum of 20 000 polls lasts well under a millisecond in plain Java but 20-70 ms when most calls link a method on first use or cross to a host. The scheduler sizes each
// background thread's quantum (Thread.quantum, abi.h) from how long its last one took, toward QUANTUM_TARGET_MS, within [QUANTUM_MIN, QUANTUM_MAX]: a slice then ends near its
// deadline, as a preemptive scheduler would end it, and a thread in plain Java yields at most every few hundred microseconds. Nothing the thread runs changes, only where it is
// preempted. The main thread and runs outside a slice keep the core's own quantum (0).
const QUANTUM_TARGET_MS = 1, QUANTUM_MIN = 256, QUANTUM_MAX = 20000;
const LONG_WAIT_MS = 1000;   // host time the main thread's suspendable event may wait nested in the pump before it is suspended (waitFor)
export const THREADS_STATE_BYTES = 96 + 4 * 1024, MONITOR_BYTES = 48, MONITORS = 4096;
const FLAG_NO_BLOCK = 1, FLAG_GREEN = 2, WAIT_LISTED = 1, WAIT_REACQUIRE = 2;
const PARKED = -1, YIELD = -2, DONE = -3;   // advance(): the thread is parked, yielded, or its work is done
const STEP_WAIT = Object.freeze({ kind: 'step' }), DRIVE_STEP = Object.freeze({ kind: 'wait', wait: Object.freeze({ kind: 'drive' }) });
/**
 * What waitFor throws when the main thread's event suspends (WasmEngine.suspendable): the run of a main-Looper message waits for something only the browser's event loop can
 * bring (a network exchange, an asynchronous host job), and the JavaScript frames between the event pump and the run are the pump's own. The main thread's frames stay in its
 * record, parked like any other thread's; the JavaScript frames unwind to the pump (no catch on the way takes it: it is not an Error, a JavaException or a LooperYield), and
 * the pump resumes the run when the wait is over (WasmEngine.resumeSuspended).
 */
export const MAIN_SUSPEND = Object.freeze({ name: 'MainSuspend', mainSuspend: true, message: 'the main thread\'s event is suspended until its wait ends' });

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
    rt.monitorEnter = value => { while (!rt.monitorTryEnter(value)) sched.resolveNested(Object.assign(new Blocked({ ready: () => rt.monitorFree(value), reason: 'monitor' }), { holder: () => rt.monitorOwnerThread(value)?.thread ?? null })); };
    rt.monitorExit = (value, thread) => { if (x.mon_exit(recordOf(thread), word(value)) !== S.OK) rt.throwJava('Ljava/lang/IllegalMonitorStateException;', 'monitor not owned'); };
    rt.ownsMonitor = (value, thread) => { const t = recordOf(thread); return x.mon_owner(word(value) + 4, 0) === this.u32[(t + T.tid) >> 2]; };
    // Diagnostics (src/report-summary.js): the thread whose tid the lock word names, or null when nobody holds it; { tid, thread: null } for a tid no live thread has
    rt.monitorOwnerThread = value => {
      const address = value === null || value === undefined ? 0 : engine.refWord(value); if (!address) return null;
      const tid = x.mon_owner(address + 4, 0); if (!tid) return null;
      for (const thread of new Set([sched.mainThread(), ...sched.threads])) { const t = thread.core?.t; if (t !== undefined && this.u32[(t + T.tid) >> 2] === tid) return { tid, thread }; }
      return { tid, thread: null };
    };
  }

  /** A record for a started thread: a recycled one, or the next of the guest region. */
  allocate() {
    let t = this.free.pop();
    if (t === undefined) {
      // One record per thread the layout was sized for (src/core-memory.js `threads`, at most the core's thread ids: threads.h THREAD_MAX_TID); past them the start fails by name.
      const limit = Math.min(MAX_LIVE_THREADS, this.records.guestCount);
      if (this.nextGuest >= limit) throw new APKError(`vmcore: ${this.nextGuest} threads are alive or parked in the core; ${limit < MAX_LIVE_THREADS ? `it was sized for ${limit} (raise "threads" in Controls › Execution › Wasm core memory, up to ${MAX_LIVE_THREADS})` : 'no thread id is left for another'}`, { kind: 'vmcore-threads' });
      if (this.records.take) {   // a dynamic memory: the record comes from the area the heap also grows in
        t = this.records.take();
        if (!t) throw new APKError(`vmcore: ${this.nextGuest} threads are alive or parked in the core and its memory has no room for another thread's record (in the dynamic mode the heap and the threads share what is above the metaspace, up to 2 GiB)`, { kind: 'vmcore-threads' });
      } else t = this.records.guestBase + this.records.guestSpan * this.nextGuest;
      this.nextGuest++;
      this.engine.initRecord(t, t + this.records.javaStack, t + this.records.guestSpan);
    }
    return t;
  }
  /** Gives VMThread `thread` record `t` in mode `flags`: a tid, and its interrupt flag over the record's word. */
  bind(thread, t, flags = FLAG_NO_BLOCK) {
    const { x } = this, u32 = () => this.u32, pending = thread.interrupted === true;
    if (thread.core === undefined) thread.core = { t, deadline: undefined, steps: [] }; else thread.core.t = t;
    if (Object.getOwnPropertyDescriptor(thread, 'interrupted')?.get === undefined) Object.defineProperty(thread, 'interrupted', { configurable: true, enumerable: true,
      get: () => u32()[(thread.core.t + T.interrupted) >> 2] !== 0, set: value => x.thr_set_interrupted(thread.core.t, value ? 1 : 0) });
    if (!x.thr_attach(t, flags)) throw new APKError('vmcore: no thread id left in the core');
    if (pending) x.thr_set_interrupted(t, 1);
    this.rt.debugger?.adapter?.bound?.(thread);   // the debugger's flags for a new record (src/debugger.js: exceptions it watches)
  }
  /** A thread ended: whoever waits on its Thread object wakes (ART's Thread exit: notifyAll), and its record is recycled. */
  ended(thread) {
    const core = thread.core; if (core === undefined || core.t === this.records.main) return;
    this.stats.ended++;
    const object = thread.javaObject; if (object !== null && object !== undefined) { const address = this.engine.refWord(object); if (address) this.x.mon_notify_all_unowned(address); }
    const t = core.t, view = this.engine.view;
    this.retired.steps += Number(view.getBigUint64(t + T.steps, true)); this.retired.calls += Number(view.getBigUint64(t + T.calls, true));
    this.engine.resetRecord(t); this.free.push(t);
    // the record goes to the next thread: the flag stops being read from (and written to) it; a dead thread is never interrupted (Scheduler.terminate)
    Object.defineProperty(thread, 'interrupted', { configurable: true, enumerable: true, writable: true, value: false });
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
    if (reason === 'class initialization') this.engine.noteInitWait?.(t, u32[(t + T.blockWord) >> 2] - CLASS_INIT_STATE);   // the watched word is the Class's initState
    let blocker = null;
    if (on) blocker = this.engine.refValue(on - 4);
    else if (phase !== 0) { const monitor = u32[(t + T.waitMonitor) >> 2]; if (monitor) blocker = this.engine.refValue(u32[monitor >> 2] - 4); }
    thread.blocked = new Blocked({ ready: () => this.u32[word] !== value, deadline, reason, blocker, roots: blocker === null ? [] : [blocker] });
    // the thread that can end this wait, when one thread can (the one running the class's <clinit>, the monitor's owner): CoreThreads.waitFor reports a wait for a thread
    // whose run is suspended beneath this one on the JavaScript stack instead of serving events and threads on top of it for ever
    if (reason === 'class initialization') { const klass = u32[(t + T.blockWord) >> 2] - CLASS_INIT_STATE; thread.blocked.holder = () => this.initializer(klass); thread.blocked.what = () => this.className(klass); }
    else if (on || phase === WAIT_REACQUIRE) { const lock = on || (u32[(t + T.waitMonitor) >> 2] ? u32[u32[(t + T.waitMonitor) >> 2] >> 2] : 0); if (lock) thread.blocked.holder = () => this.threadOfTid(this.x.mon_owner(lock, 0)); }
    thread.state = 'blocked'; thread.coreWait = { kind: 'core' }; this.stats.parks++;
  }
  /** The thread running the <clinit> of the class at `klass` (null when none runs it now). */
  initializer(klass) { const u32 = this.u32; if (u32[(klass + CLASS.initState) >> 2] !== CLASS_INITIALIZING) return null; return this.threadOfRecord(u32[(klass + CLASS.initThread) >> 2]); }
  // (asked at every turn of a wait: no allocation)
  threadOfRecord(t) { if (!t) return null; const main = this.sched.mainThread(); if (main.core?.t === t) return main; for (const thread of this.sched.threads) if (thread.core?.t === t) return thread; return null; }
  threadOfTid(tid) {
    if (!tid) return null; const u32 = this.u32, main = this.sched.mainThread(), of = thread => { const t = thread.core?.t; return t !== undefined && u32[(t + T.tid) >> 2] === tid; };
    if (of(main)) return main; for (const thread of this.sched.threads) if (of(thread)) return thread; return null;
  }
  className(klass) { for (const [type, info] of this.engine.linker?.classes ?? []) if (info?.address === klass) return type; return `the class at 0x${(klass >>> 0).toString(16)}`; }
  /**
   * x.run_nested of method `id` on `thread`'s record with argument words `words` (written to the record's argument area), class `init` to initialize first (0: the method's
   * own, for a static one). `stackTop`/`depth`: the record's live stack and call depth the run starts above (what the caller published). Remembered in thread.core.entry: a run
   * whose entry needs a class another thread is initializing -- the method's class or one of its superclasses -- stops before its first frame (THREAD_BLOCKED with Thread.frame
   * 0, vmcore/abi.h: "call run() again"), and advance() parks the thread until that class is ready and then starts the run again (parkEntry).
   */
  runEntry(thread, id, words, init, stackTop, depth) {
    const t = thread.core.t, u32 = this.u32, args = (t + this.engine.argsOffset) >> 2;
    for (let i = 0; i < words.length; i++) u32[args + i] = words[i] >>> 0;
    const entry = thread.core.entry ??= { method: 0, words: null, init: 0, stackTop: 0, depth: 0 };   // one per thread, reused (a few thousand nested runs a frame); parkEntry takes it. No key the host root walk reads as an object id (heap-gc.js ID_KEY): `method`, not `id`
    entry.method = id; entry.words = words; entry.init = init; entry.stackTop = stackTop; entry.depth = depth;
    const status = this.x.run_nested(t, id, t + this.engine.argsOffset, init) >>> 0;
    if (status !== S.THREAD_BLOCKED) entry.words = null;   // only a run that may start again keeps its argument words (no stale words outlive the run they were for)
    return status;
  }
  /**
   * The run of thread.core.entry stopped before its first frame: the class it initializes first (or a superclass of it) is being initialized by another thread. The thread waits
   * for that class like a thread at an invoke-static waits in the core (parkCore: the class's initState word, the thread running its <clinit> as the holder), and resume()
   * starts the run again. Meanwhile the record's stack covers the frames below the run and the entry frame, whose registers hold the arguments (the collector scans
   * [stackBase, stackTop) conservatively); the run's own start (finish) had dropped both.
   */
  parkEntry(thread) {
    const entry = thread.core.entry, t = thread.core.t, u32 = this.u32; thread.core.entry = null;
    const base = entry.stackTop !== 0 && entry.stackTop !== u32[(t + 4) >> 2] ? entry.stackTop : u32[(t + 4) >> 2];   // abi.h Thread.stackBase (+4); run_nested's base frame
    const registers = this.engine.linker.methodList[entry.method]?.registers ?? 0;
    u32[(t + T.stackTop) >> 2] = Math.min(base + 4 * (3 + registers), u32[(t + 8) >> 2]); u32[(t + T.depth) >> 2] = entry.depth;   // FRAME_WORDS = 3; Thread.stackEnd (+8)
    this.parkCore(thread);
    thread.coreWait = { kind: 'entry', entry };
  }
  /** A host's Blocked, met by a host step of the thread (`thread.core.steps` says where its value goes). */
  parkHost(thread, blocked) { thread.blocked = blocked; thread.waitSite = this.rt.lastHostCall ?? null; thread.state = 'blocked'; thread.coreWait = STEP_WAIT; this.stats.hostParks++; }

  /** Continues a parked or preempted thread: a run status, PARKED (it waits again), or null (its driver's step is over: drive it). */
  resume(thread) {
    const wait = thread.coreWait, t = thread.core.t, x = this.x; thread.coreWait = null;
    if (wait === null || wait === undefined) return null;
    if (wait.kind === 'yield') return x.resume(t) >>> 0;
    const blocked = thread.blocked, timedOut = thread.timedOut === true; thread.blocked = null; thread.state = 'runnable';
    if (wait.kind === 'debug') return this.debugContinue(thread, wait.status);   // held by the debugger at a breakpoint, a step or an exception: go on past it
    if (wait.kind === 'entry') {   // parkEntry: the class is ready (or its initializer failed): the run starts again from the same stack
      const entry = wait.entry; thread.core.deadline = undefined;
      this.u32[(t + T.stackTop) >> 2] = entry.stackTop; this.u32[(t + T.depth) >> 2] = entry.depth;
      return this.runEntry(thread, entry.method, entry.words, entry.init, entry.stackTop, entry.depth);
    }
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
          try { value = value.body !== null ? value.body : rt.dispatch(value.method, value.args, value.mode, null, true); } catch (thrown) { failed = true; error = thrown; }   // a BodyInvoke (src/interpreter.js) names its body
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
    return action.how !== undefined ? this.x.resume_host(thread.core.t, action.how) >>> 0 : this.runEntry(thread, action.id, action.words, 0, action.stackTop, action.depth);
  }
  /** A DEX body a host step handed back: a run on the thread's record above its live frames (whose registers of the record come back when it ends: leave()). */
  enter(thread, pending) {
    const engine = this.engine, mi = engine.bodyInfo(pending.method), t = thread.core.t, u32 = this.u32, view = engine.view;
    if (!mi) throw new APKError(`vmcore: a host step selected ${pending.method.key}, which the core's linker does not know`);
    const words = engine.wordsOf(pending.args);
    if (words.length > 440) throw new APKError(`vmcore: ${words.length} argument words`);
    thread.core.steps.push({ kind: 'run', t, result: pending.method.result ?? pending.method.signature.slice(pending.method.signature.indexOf(')') + 1),
      saved: { frame: u32[(t + T.frame) >> 2], pc: u32[(t + T.pc) >> 2], depth: u32[(t + T.depth) >> 2], stackTop: u32[(t + T.stackTop) >> 2], throwing: u32[(t + T.throwing) >> 2],
        status: u32[(t + T.status) >> 2], detail: u32[(t + T.detail) >> 2], result: view.getBigUint64(t + T.result, true) } });
    const saved = thread.core.steps[thread.core.steps.length - 1].saved;
    return { id: mi.id, words, stackTop: saved.stackTop, depth: saved.depth };   // runEntry writes the words
  }
  /** The run of the thread's top step ended with `status`: the record is the caller's again, and the value or the exception goes on through the steps below. */
  leave(thread, status) {
    const engine = this.engine, t = thread.core.t, view = engine.view, u32 = this.u32, entry = thread.core.steps.pop();
    if (entry === undefined || entry.kind !== 'run' || entry.t !== t) {
      if (entry !== undefined) thread.core.steps.push(entry);
      throw new APKError(`vmcore: a run of ${thread.name} ended, but no run of a host step was in progress on its record to take the outcome (${this.describeStop(thread, status, entry)})`);
    }
    const raw = view.getBigUint64(t + T.result, true), detail = u32[(t + T.detail) >> 2], saved = entry.saved;
    u32[(t + T.frame) >> 2] = saved.frame; u32[(t + T.pc) >> 2] = saved.pc; u32[(t + T.depth) >> 2] = saved.depth; u32[(t + T.stackTop) >> 2] = saved.stackTop;
    u32[(t + T.throwing) >> 2] = saved.throwing; u32[(t + T.status) >> 2] = saved.status; u32[(t + T.detail) >> 2] = saved.detail; view.setBigUint64(t + T.result, saved.result, true);
    if (status === S.OK) return this.pump(thread, () => engine.valueOf(entry.result, raw));
    if (status === S.UNCAUGHT) return this.pump(thread, () => { const address = Number(raw & 0xffffffffn); throw new JavaException(engine.refValue(address), engine.messageOf(address)); });
    throw engine.stopError(status, detail);
  }
  /** What a run that ended with nothing to take its outcome says: the status (the stop error a run gives, with its last calls), the record, and the thread's steps (top last). */
  describeStop(thread, status, entry) {
    const t = thread.core.t, u32 = this.u32, frame = u32[(t + T.frame) >> 2], detail = u32[(t + T.detail) >> 2];
    let what;
    if (status === S.OK) what = 'it returned normally';
    else if (status === S.UNCAUGHT) what = 'it threw';
    else if (status === CORE_UNSUPPORTED && detail === 0 && frame === 0) what = 'the core was asked to resume a record with no frame (unsupported, nothing to resume)';
    else { try { what = this.engine.stopError(status, detail).message; } catch (error) { what = `status ${status}, detail ${detail} (${error?.message ?? error})`; } }
    const steps = thread.core.steps.map(step => step.kind === 'wait' ? `wait:${step.wait.kind}` : step.kind === 'run' && step.t !== t ? `run(record ${step.t})` : step.kind);
    return `${what}; record ${t}, frame ${frame ? 'live' : 'none'}, wait ${thread.coreWait?.kind ?? 'none'}, state ${thread.state}; steps ${steps.join(' > ') || 'none'}${entry !== undefined && entry.kind === 'run' ? `; the run on top belongs to record ${entry.t}` : ''}`;
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
          if (count === stuck) {   // a collection did not help: a dynamic memory grows by what the allocation asked for, else OutOfMemoryError into the run
            if (engine.makeRoomForRun()) { status = x.resume(t) >>> 0; continue; }
            status = x.throw_oom(t) >>> 0; stuck = -1; continue;
          }
          stuck = count; engine.collect('run'); status = x.resume(t) >>> 0; continue;
        }
        case S.YIELDED:
          if (thread.coreQuantum !== 0) this.sizeQuantum(thread, t);
          if (this.mustYield(thread, owner)) { thread.coreWait = { kind: 'yield' }; thread.state = 'runnable'; this.stats.yields++; return YIELD; }
          status = x.resume(t) >>> 0; continue;
        case S.THREAD_BLOCKED:
          if (!this.u32[(t + T.frame) >> 2]) { if (thread.core.entry === null || thread.core.entry === undefined) break; this.parkEntry(thread); return PARKED; }   // the run did not start: it starts again (parkEntry)
          this.parkCore(thread); return PARKED;
        case S.BREAKPOINT: case S.STEPPED: case S.EXCEPTION_EVENT: {   // the debugger's stops (vmcore/abi.h; src/debugger.js, vmcore/js/core-debug.js): frames kept at the instruction
          const dbg = this.rt.debugger;
          if (dbg !== null && dbg !== undefined && dbg.adapter.coreStop(thread, owner, status)) { thread.blocked = dbg.parkBlocked(thread, 'core', null); thread.state = 'blocked'; thread.coreWait = { kind: 'debug', status }; this.stats.parks++; return PARKED; }
          status = this.debugContinue(thread, status); continue;
        }
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
  /** Past a debugger stop: the debugger's adapter resumes it (a breakpoint's instruction runs once); with no debugger left, the record's debug state is cleared and it resumes. */
  debugContinue(thread, status) {
    const dbg = this.rt.debugger;
    if (dbg !== null && dbg !== undefined) return dbg.adapter.continueFrom(thread, status);
    const t = thread.core.t; this.u32[(t + 2208) >> 2] = 0; this.engine.view.setBigUint64(t + T.steps + 8, 1n << 60n, true);   // abi.h Thread.debugFlags, maxSteps
    return this.x.resume(t) >>> 0;
  }
  /** A quantum of a background thread in a slice ended: the next one is sized from how long this one took (the geometric mean of its size and the size that would have taken QUANTUM_TARGET_MS). */
  sizeQuantum(thread, t) {
    const now = performance.now(), took = now - thread.coreQuantumAt, size = thread.coreQuantum; thread.coreQuantumAt = now;
    const wanted = took > 0 ? Math.min(QUANTUM_MAX, Math.max(QUANTUM_MIN, size * QUANTUM_TARGET_MS / took)) : QUANTUM_MAX, mean = Math.round(Math.sqrt(size * wanted)), next = Math.abs(mean - wanted) <= 1 ? Math.round(wanted) : mean;
    if (next !== size) { thread.coreQuantum = thread.coreQuantumSize = next; this.u32[(t + T.quantum) >> 2] = next; }
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
    const sched = this.sched, rt = this.rt, engine = this.engine, mark = engine.pins.length, since = performance.now();
    for (;;) {
      // Each turn of this loop is finished work (events served, a slice of another thread, a clock skip): the handles it made were pinned until the host call this wait is
      // nested in returns, which a long wait never does -- a main thread parked for minutes while the pump served millions of host tasks grew the pins past what a JavaScript
      // array can hold ("RangeError: Invalid array length"). What a turn keeps is in a rooted table, a record or a thread's steps, as at a bridge call's return.
      if (engine.pins.length > mark) engine.pins.length = mark;
      // The debugger parked the main thread in the event that may suspend (src/debugger.js): it is suspended at once, the event pump returns and the Worker stays free.
      if (owner.blocked?.debugHold === true && engine.maySuspend(owner)) { engine.noteSuspend(owner, null, null, 'the debugger suspended it'); throw MAIN_SUSPEND; }
      // The main thread's event that may suspend (WasmEngine.suspendable) and has waited LONG_WAIT_MS of host time here: the wait is suspended as a network wait is, so the
      // event pump returns to the browser's event loop (the page, its watchdog and a driver's wall clock see the wait) and resumes the event once the wait is over. Waits
      // that end in less (most: a skip of the VM clock, another thread's short work) keep the nested path.
      if (owner.state === 'blocked' && performance.now() - since >= LONG_WAIT_MS && engine.maySuspend(owner)) { engine.noteSuspend(owner, null, Math.round(performance.now() - since)); throw MAIN_SUSPEND; }
      // A wait only a thread suspended beneath this run on the JavaScript stack can end (it runs the <clinit> this thread needs, or owns the monitor it enters): that thread
      // goes on only once this run returns, and this run returns only once it goes on. Serving events and other threads on top of it never ends (a pump that never returned,
      // seen as a background thread's host call waiting for a class another background thread initialized in a host call of its own): it is reported by name instead.
      if (owner.state === 'blocked') sched.checkNestedDeadlock(owner);
      // the operation's wall budget and heartbeat (src/operation-monitor.js) see every turn of a long wait, also one that serves no event
      if (rt.monitor?.active) rt.monitor.tick();
      if (owner.state === 'blocked' || sched.starved) sched.serviceEvents();
      const choice = sched.pick(this.last ?? owner, owner);
      if (choice.thread === owner) { if (this.last !== owner) sched.switching(rt, this.last, owner); this.last = owner; rt.thread = owner; return; }
      if (choice.thread !== null) { this.guest(choice.thread, owner); continue; }
      rt.thread = sched.mainThread();
      try { sched.idle(choice.earliest, `${owner.name} is blocked (${owner.blocked?.reason ?? 'unknown'})`); }
      catch (error) {
        // Nothing here can wake the owner without the browser's event loop (network-would-block). The main thread's event that may suspend (WasmEngine.suspendable) does, as a
        // main thread blocked on a device does: its frames stay parked in its record and the event pump returns; the pump resumes it once its wait is over.
        if (error?.details?.kind === 'network-would-block' && this.engine.maySuspend(owner)) { this.engine.noteSuspend(owner, error); throw MAIN_SUSPEND; }
        throw error;
      }
      finally { rt.thread = owner; }
    }
  }
  /** The quantum `thread` runs with: sized for a background thread in a slice with a deadline (QUANTUM_TARGET_MS), the core's own otherwise. */
  quantumFor(thread, sliced) {
    const core = thread.core; if (core === undefined || thread === this.sched.mainThread()) return;
    const size = sliced ? (thread.coreQuantumSize ||= QUANTUM_MAX) : 0;
    thread.coreQuantum = size; this.u32[(core.t + T.quantum) >> 2] = size;   // written every time: a nested run may have lent the thread another record (borrow)
    if (sliced) thread.coreQuantumAt = performance.now();
  }
  /** One slice of `thread` (not the owner): it runs until it parks, yields, or its work is done. */
  guest(thread, owner) {
    const rt = this.rt, previous = rt.thread;
    if (thread !== this.last) this.sched.switching(rt, this.last, thread);
    this.last = thread; rt.thread = thread; this.stats.slices++;
    const sliced = owner === null && rt.sliceDeadline !== 0 && rt.sliceDeadline !== undefined, cut = rt.coreCut;
    this.quantumFor(thread, sliced); rt.coreCut = sliced && thread.coreQuantum > 0;   // host-bridge.js cuts the quantum at the deadline only here, where the yield it causes ends the slice
    try { return this.advance(thread, owner, this.resume(thread)); }
    catch (error) { if (thread !== this.sched.mainThread()) rt.noteThreadFailure(thread, error); throw error; }   // a lab error on a background thread: recorded where it happens, whoever catches it
    finally { rt.thread = previous; rt.coreCut = cut; }
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
    this.u32[(aux + T.interrupted) >> 2] = this.u32[(own + T.interrupted) >> 2];   // one thread, one interrupt status: the run sees the thread's flag, not the recycled record's
    core.t = aux; this.stats.auxRuns++;
    return () => {
      const view = this.engine.view, flag = this.u32[(aux + T.interrupted) >> 2];
      // what the run did to the flag is the thread's: an interrupt set during it reaches the parked wait (thr_interrupt takes it out of Object.wait), one it consumed is gone
      if (flag !== this.u32[(own + T.interrupted) >> 2]) this.x.thr_set_interrupted(own, flag ? 1 : 0);
      view.setBigUint64(own + T.steps, view.getBigUint64(own + T.steps, true) + view.getBigUint64(aux + T.steps, true), true);
      view.setBigUint64(own + T.calls, view.getBigUint64(own + T.calls, true) + view.getBigUint64(aux + T.calls, true), true);
      core.t = own; this.engine.resetRecord(aux); this.u32[(aux + T.tid) >> 2] = auxTid; this.free.push(aux);
    };
  }
}
