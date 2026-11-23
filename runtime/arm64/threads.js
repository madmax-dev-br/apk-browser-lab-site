// Native threads of the ARM64 process (docs/ARM64-NATIVE.md "Threads"). pthread_create gives the start routine its own interpreter state (registers), stack and
// TLS block over the shared memory; threads run in slices of instructions, interleaved by a pump on the VM's event loop and by any thread that waits.
// Waiting is real: a mutex held by another thread, a condition variable, a futex word, pthread_join and sleeping park the thread until the condition holds.
// A thread at the top of its own run is suspended (its pc stays on the waiting call, retried later); code called synchronously from Java (a native method, a
// JNI_OnLoad) cannot suspend the Java thread, so its wait runs the other native threads itself until the condition holds. When every thread waits and nothing
// can wake one, the run fails naming the wait (a deadlock or a missing waker), never silently.
import { APKError } from '../apk-error.js?v=728b804e603a';
import { Arm64Cpu, BLOCKED, RETURN_SENTINEL } from './cpu.js?v=728b804e603a';
import { ART_BLOCKED } from './signals.js?v=728b804e603a';

const SLICE = 20000;   // instructions a thread runs before the next one is given a turn
const PUMP_MS = 4;   // the delay of the next background pump while native threads can run
export const JAVA_NATIVE_QUANTUM = 1 << 18;   // instructions a Java thread's parkable native call runs before the thread is preempted (continueFromJava)
// bionic's pthread_internal_t (android-13.0.0_r1 bionic/libc/bionic/pthread_internal.h, arm64): pthread_t is the address of this record, and TLS_SLOT_THREAD_ID (tp + 8) holds it.
// The fields the lab fills: tid, the cached pid, pthread_attr_t (flags, stack_base, stack_size, guard_size, sched_policy, sched_priority), start_routine and its argument, and
// alternate_signal_stack (the mapping bionic gives every thread for its signal handlers: SIGNAL_STACK_SIZE with a guard page at its bottom, installed with sigaltstack).
// The record has a page to itself, as in bionic (it sits in the thread's own mapping), so code that reads past the fields it knows stays in readable memory.
export const PTHREAD_INTERNAL = Object.freeze({ tid: 0x10, cachedPid: 0x14, attrFlags: 0x18, stackBase: 0x20, stackSize: 0x28, guardSize: 0x30, schedPolicy: 0x38, schedPriority: 0x3c, joinState: 0x50, startRoutine: 0x60, startArg: 0x68, alternateSignalStack: 0x80, stackTop: 0x90 });
export const SIGNAL_STACK_SIZE = 0x4000 + 0x1000, GUARD_SIZE = 0x1000;   // SIGNAL_STACK_SIZE_WITHOUT_GUARD (16 KiB) + PTHREAD_GUARD_SIZE

export class NativeThreads {
  constructor(process, { queueTask = null, now = () => performance.now(), log = () => {} } = {}) {
    this.process = process; this.queueTask = queueTask; this.now = now; this.log = log;
    const main = { tid: process.pid, cpu: process.cpu, state: 'running', tp: process.tp, errno: process.errnoAddressMain, keys: new Map(), main: true };
    this.threads = new Map([[main.tid, main]]); this.current = main; this.nextTid = process.pid + 1; this.pumpQueued = false;
    this.exitEntry = process.hostEntry('pthread:exit', (p, cpu) => { this.finish(this.current, cpu.x[0]); cpu.exited = true; });
  }
  get running() { return this.current; }
  /** The thread's pthread_t: the address of its pthread_internal_t (made on first use for the main and the Java threads), with its alternate signal stack. */
  selfOf(record = this.current) {
    if (record.self) return record.self;
    const p = this.process, mem = p.memory, self = p.mapRegion(0x1000, 0x1000, `[anon:stack_and_tls:${record.tid}]`), alt = p.mapRegion(SIGNAL_STACK_SIZE, 0x1000, '[anon:thread signal stack]'), F = PTHREAD_INTERNAL;
    const stack = record.stack ?? { base: p.mainStack?.base ?? 0, size: p.mainStack?.size ?? 0 };
    mem.writeU32(self + F.tid, record.tid); mem.writeU32(self + F.cachedPid, p.pid);
    mem.writeU32(self + F.attrFlags, 0); mem.writePtr(self + F.stackBase, stack.base); mem.write64(self + F.stackSize, BigInt(stack.size)); mem.write64(self + F.guardSize, BigInt(GUARD_SIZE));
    if (record.start !== undefined) { mem.writePtr(self + F.startRoutine, record.start); mem.writePtr(self + F.startArg, record.arg ?? 0); }
    mem.writePtr(self + F.alternateSignalStack, alt); mem.writePtr(self + F.stackTop, stack.base + stack.size);
    record.self = self; record.altStack = { sp: alt + GUARD_SIZE, size: SIGNAL_STACK_SIZE - GUARD_SIZE, flags: 0 };
    if (record.tp) mem.writePtr(record.tp + 8, self);   // TLS_SLOT_THREAD_ID
    (this.bySelf ??= new Map()).set(self, record);
    return self;
  }
  /** The thread a pthread_t names (the address pthread_create / pthread_self gave), or undefined. */
  byPthread(value) { const key = Number(value); return this.bySelf?.get(key) ?? this.threads.get(key); }
  /** The native thread with kernel thread id `tid` (a created thread, the main thread or a Java thread that called native code). */
  byTid(tid) { return this.threads.get(tid) ?? this.javaByTid?.get(tid); }
  /**
   * The native identity of a Java thread that calls into native code (a JNI native method, JNI_OnLoad): on a device each Java thread is its own native thread, with its
   * own tid, TLS block (pthread keys, errno, the thread-local storage of every library) and stack. Here the call runs on the calling CPU's stack, synchronously, but as
   * that thread: `javaThread` is the VM's thread record (null or the scheduler's main thread: the process's main thread).
   */
  asJavaThread(javaThread, fn) {
    const p = this.process, isMain = !javaThread || javaThread === this.javaMain?.();
    let record = isMain ? this.threads.get(p.pid) : (this.javaRecords ??= new WeakMap()).get(javaThread);
    if (!record) {
      // its own interpreter state and stack (as a created thread): a native call of this Java thread can park it in a wait (callFromJava) while other Java threads call native code
      const stackSize = 512 * 1024, region = p.mapRegion(stackSize + 0x10000, 0x10000, `[anon:stack_and_tls:${this.nextTid}]`), tp = region + stackSize + 0x100; p.initThreadTls(tp);
      const cpu = new Arm64Cpu(p.memory, { host: (c, index) => p.dispatchHost(c, index), maxSteps: p.cpu.maxSteps });
      cpu.describe = p.cpu.describe; cpu.progress = p.cpu.progress; cpu.watched = p.cpu.watched; cpu.threadLabel = p.cpu.threadLabel; cpu.sp = region + stackSize; cpu.tpidr = BigInt(tp); cpu.nested = 0;
      record = { tid: this.nextTid++, cpu, ownCpu: true, state: 'running', tp, errno: tp - 0xf0, keys: new Map(), java: true, name: javaThread.name ?? null, stack: { base: region, size: stackSize } };
      record.sigmask = ART_BLOCKED; (this.javaByTid ??= new Map()).set(record.tid, record);
      this.javaRecords.set(javaThread, record); this.log(`ARM64 native thread ${record.tid} is Java thread "${record.name ?? '?'}"`);
    }
    if (record === this.current) { p.signals?.deliver(p, record); return fn(); }
    const previous = this.current, previousTp = p.cpu.tpidr, previousCpu = p.activeCpu;
    this.current = record; if (record.ownCpu) p.activeCpu = record.cpu; else { p.activeCpu = p.cpu; p.cpu.tpidr = BigInt(record.tp); }
    try { p.signals?.deliver(p, record); return fn(); } finally { this.current = previous; p.activeCpu = previousCpu; if (!record.ownCpu) p.cpu.tpidr = previousTp; }
  }
  /**
   * A native method called by a Java thread other than the main thread. At the top of that thread's native calls it runs on the thread's own interpreter state, and a wait that
   * cannot be satisfied yet parks the Java thread instead of holding the whole VM: `park({ ready, delayMs, what, resume })` makes the VM's Blocked (src/arm64/jni.js), and
   * resume() continues the native code where it waited (another park, or the raw result). A call nested in a JNI callback, and the main thread's calls, run synchronously.
   */
  callFromJava(javaThread, address, args, options, park) {
    return this.asJavaThread(javaThread, () => {
      const record = this.current, cpu = record.cpu;
      if (!park || !record.ownCpu || (cpu.nested ?? 0) > 0 || record.inCall) return this.process.call(address, args, options);
      const saved = cpu.beginCall(address, args, options);
      return this.continueFromJava(javaThread, record, saved, options, park);
    });
  }
  // The call runs in quanta of JAVA_NATIVE_QUANTUM instructions: at the end of one the Java thread parks, ready at once, so the scheduler gives the other threads, the events
  // and the page their turn and resumes it, as a device's scheduler preempts a thread that computes; a long native computation on a background Java thread never holds the VM.
  continueFromJava(javaThread, record, saved, options, park) {
    const cpu = record.cpu; let outcome;
    record.inCall = true; record.parkable = true; record.state = 'running'; cpu.parked = false;
    try { outcome = cpu.run(RETURN_SENTINEL, JAVA_NATIVE_QUANTUM); } catch (error) { record.inCall = false; throw error; } finally { record.parkable = false; }
    if (outcome === 'done') { record.inCall = false; record.state = 'running'; return cpu.endCall(saved, options.returns); }
    cpu.parked = true;   // preempted or waiting: a call made on this CPU before it resumes keeps its context (src/arm64/cpu.js call)
    if (outcome === 'yield') {
      record.preemptions = (record.preemptions ?? 0) + 1;
      return park({ ready: () => true, delayMs: 0, what: 'a native call preempted at the end of its quantum', preempted: true,
        resume: () => this.asJavaThread(javaThread, () => this.continueFromJava(javaThread, record, saved, options, park)) });
    }
    if (outcome !== 'blocked') { record.inCall = false; throw new APKError(`ARM64 interpreter: a native call of Java thread "${record.name ?? '?'}" ended as '${outcome}' (pc 0x${cpu.pc.toString(16)})`, { kind: 'arm64-threads' }); }
    const until = Math.min(record.deadline ?? Infinity, record.wakeAt?.() ?? Infinity);
    return park({ ready: () => record.ready?.() === true || this.now() >= until, delayMs: until - this.now(), what: record.what ?? 'a native wait',
      resume: () => this.asJavaThread(javaThread, () => this.continueFromJava(javaThread, record, saved, options, park)) });
  }
  create(start, arg) {
    const p = this.process, stackSize = 512 * 1024, region = p.mapRegion(stackSize + 0x10000, 0x10000, `[anon:stack_and_tls:${this.nextTid}]`), tp = region + stackSize + 0x100;
    p.initThreadTls(tp);
    const cpu = new Arm64Cpu(p.memory, { host: (c, index) => p.dispatchHost(c, index), maxSteps: p.cpu.maxSteps });
    cpu.describe = p.cpu.describe; cpu.progress = p.cpu.progress; cpu.watched = p.cpu.watched; cpu.threadLabel = p.cpu.threadLabel; cpu.sp = region + stackSize; cpu.tpidr = BigInt(tp); cpu.x[0] = BigInt(arg); cpu.x[30] = BigInt(this.exitEntry); cpu.pc = Number(start); cpu.nested = 0;
    const thread = { tid: this.nextTid++, cpu, state: 'runnable', tp, errno: tp - 0xf0, keys: new Map(), waiters: [], result: 0n, stack: { base: region, size: stackSize }, start: Number(start), arg: Number(arg), sigmask: this.current.sigmask ?? ART_BLOCKED, parent: this.current };   // a new thread inherits its creator's signal mask
    this.threads.set(thread.tid, thread); this.log(`ARM64 native thread ${thread.tid} started at 0x${Number(start).toString(16)}`);
    const self = this.selfOf(thread);
    this.schedulePump();
    return self;
  }
  finish(thread, value) { thread.state = 'done'; thread.result = value; this.log(`ARM64 native thread ${thread.tid} ended`); this.wake(); }
  /** Can the thread that is running now be suspended at this call (true), or must its wait be driven synchronously (false)? */
  canSuspend(cpu) { const t = this.current; return !t.main && (!t.java || t.parkable === true) && t.cpu === cpu && (cpu.nested ?? 0) === 0; }
  /** The waiting primitive for host functions: returns BLOCKED (the call is retried when the thread runs again) or, for a synchronous caller, runs the other threads until `ready()`. */
  // `wakeAt()`: the earliest time the condition may turn true by time alone (a timer), when it does not wait for another thread
  wait(cpu, ready, { what, deadline = Infinity, wakeAt = null } = {}) {
    if (ready()) return true;
    // a thread that waits is not a runaway: a long-lived thread (an event loop, a garbage collector's worker) gets the whole instruction budget again for its next stretch of
    // work, as an outermost native call does (src/arm64/cpu.js beginCall); the budget still ends a thread that computes without ever waiting
    if (this.canSuspend(cpu)) { Object.assign(this.current, { state: 'waiting', ready, deadline, what, wakeAt }); return BLOCKED; }   // a suspended thread is preemptible: no instruction budget counts it (src/arm64/cpu.js runaway)
    const caller = this.current;
    for (;;) {
      if (ready()) return true;
      if (this.now() >= deadline) return false;
      if (this.signalFor(caller)) { this.process.signals.deliver(this.process, caller); if (ready()) return true; }   // a timer or a signal for the waiting thread: its handler runs inside the wait, as a signal interrupts a blocking call
      const progressed = this.runOthers(caller);
      if (ready()) return true;
      if (!progressed) {
        const timer = Math.min(wakeAt?.() ?? Infinity, this.nextTimer(caller));
        if (timer < deadline && timer !== Infinity) { while (this.now() < timer) { /* the caller cannot be suspended: wait for the timer that wakes a thread */ } continue; }
        if (deadline !== Infinity) return false;
        throw new APKError(`ARM64 native code waits on ${what} and no other native thread can make progress (deadlock, or a waker the lab does not run)`, { kind: 'arm64-threads', wait: what });
      }
    }
  }
  /** The earliest time a waiting thread other than `caller` is woken by time alone (its deadline or timer). */
  nextTimer(caller) { let at = Math.min(this.process.kernelNextTimer?.() ?? Infinity, this.process.timerDeadline?.() ?? Infinity); for (const t of this.threads.values()) if (t !== caller && !t.main && t.state === 'waiting') at = Math.min(at, t.deadline, t.wakeAt?.() ?? Infinity); return at; }
  /** Runs one slice of every other thread that can run; true when any of them ran. */
  runOthers(caller) {
    let progressed = this.process.kernelPump?.() === true;   // the other processes (src/process-kernel.js): a child this thread waits for, or that writes the pipe it reads
    for (const thread of [...this.threads.values()]) {
      if (thread === caller || thread.main || thread.state === 'done') continue;
      if (thread.state === 'waiting') { if (thread.ready() || this.now() >= thread.deadline || this.now() >= (thread.wakeAt?.() ?? Infinity) || this.signalFor(thread)) thread.state = 'runnable'; else continue; }
      progressed = this.slice(thread) || progressed;
    }
    return progressed;
  }
  /** A timer of the process is due, or a signal waits that this thread takes (src/arm64/timers.js, src/arm64/signals.js): it runs for the handler. */
  signalFor(thread) { const p = this.process; return this.now() >= (p.timerDeadline?.() ?? Infinity) || p.signals?.deliverable?.(p, thread) === true; }
  slice(thread) {
    const previous = this.current, p = this.process; this.current = thread; p.activeCpu = thread.cpu; thread.state = 'running';
    try {
      p.signals?.deliver(p, thread);   // a signal sent to this thread while it was not running: its handler runs first (src/arm64/signals.js)
      const outcome = thread.cpu.run(-1, SLICE);
      if (outcome === 'exited' || thread.state === 'done') { thread.state = 'done'; return true; }
      if (outcome === 'blocked') return true;   // state set to 'waiting' by wait()
      thread.state = 'runnable'; return true;
    } catch (error) {
      thread.state = 'done'; this.log(`ARM64 native thread ${thread.tid} stopped: ${error.message}`);
      throw error;   // a fault in any thread ends the process, as SIGSEGV / abort do on a device
    } finally { this.current = previous; p.activeCpu = previous.cpu; }
  }
  /**
   * Background progress: while native threads can run, the VM's event loop gives them slices between its own events (a host task every PUMP_MS). While every thread waits,
   * the next pump is due when the earliest of their deadlines and timers is (a thread waiting with neither runs again when a waker asks: wake()), so a native thread that
   * sleeps or waits with a timeout is not polled every PUMP_MS until then. Polling while the main thread was parked made the Java scheduler skip the VM clock PUMP_MS at a
   * time and run the poll again, millions of times in one wait.
   * `delay` is the delay of the pump asked for: a sooner request replaces a later queued one.
   */
  schedulePump(delay = PUMP_MS) {
    if (!this.queueTask) return;
    if (this.pumpQueued && (this.pumpShort || (delay > PUMP_MS && this.now() + delay >= this.pumpAt))) return;
    this.pumpQueued = true; this.pumpShort = delay <= PUMP_MS; this.pumpAt = this.now() + delay;
    const token = this.pumpToken = (this.pumpToken ?? 0) + 1;
    this.queueTask(() => {
      if (token !== this.pumpToken) return;   // replaced by a sooner pump
      this.pumpQueued = false;
      const caller = this.current; let active = false;
      for (let round = 0; round < 8; round++) { if (!this.runOthers(caller)) break; active = true; }
      const next = this.pumpDelay(active);
      if (next !== null) this.schedulePump(next);
    }, delay);
  }
  /** The delay of the next pump: PUMP_MS while a thread can run (or ran in this pump), the time to the earliest deadline or timer while all wait, null when none of them has one. */
  pumpDelay(active) {
    let earliest = Infinity, waiting = false;
    for (const t of this.threads.values()) {
      if (t.main || t.state === 'done') continue;
      if (active || t.state !== 'waiting' || this.signalFor(t)) return PUMP_MS;
      waiting = true; earliest = Math.min(earliest, t.deadline ?? Infinity, t.wakeAt?.() ?? Infinity, this.process.timerDeadline?.() ?? Infinity);
    }
    if (!waiting || earliest === Infinity) return null;
    return Math.max(PUMP_MS, Math.ceil(earliest - this.now()));
  }
  /** A thread may have been made ready by what the running code did (a signal, an unlock, a futex wake, a thread that ended): its next turn comes within PUMP_MS. */
  wake() { if (this.threads.size > 1) this.schedulePump(); }
  // ---- primitives used by libc
  mutexLock(cpu, m) {
    const mem = this.process.memory, type = (mem.readU32(m) >> 14) & 3, me = this.current.tid, owner = () => mem.readU32(m + 4);
    if (owner() === me) { if (type === 1) { mem.writeU32(m + 8, mem.readU32(m + 8) + 1); return 0; } if (type === 2) return 35; }   // recursive / EDEADLK
    const held = this.lockSites?.get(m), javaThread = this.javaThreadName?.() ?? null;
    const got = this.wait(cpu, () => owner() === 0, { what: `a pthread mutex at 0x${m.toString(16)} held by thread ${owner()}${held ? ` (locked from ${held.where}${held.java ? ` on Java thread "${held.java}"` : ''})` : ''}${owner() === me ? `; this thread already holds it (non-recursive), now from ${cpu.where(Number(cpu.x[30]))}${javaThread ? ` on Java thread "${javaThread}"` : ''}` : ''}` });
    if (got === BLOCKED) return BLOCKED;
    mem.writeU32(m + 4, me); mem.writeU32(m + 8, 1); (this.lockSites ??= new Map()).set(m, { where: cpu.where(Number(cpu.x[30])), java: javaThread }); return 0;
  }
  mutexTrylock(m) { const mem = this.process.memory, me = this.current.tid, owner = mem.readU32(m + 4); if (owner === 0) { mem.writeU32(m + 4, me); mem.writeU32(m + 8, 1); return 0; } if (owner === me && ((mem.readU32(m) >> 14) & 3) === 1) { mem.writeU32(m + 8, mem.readU32(m + 8) + 1); return 0; } return 16; }   // EBUSY
  mutexUnlock(m) { const mem = this.process.memory; if (mem.readU32(m + 4) !== this.current.tid) return 1; const count = mem.readU32(m + 8) - 1; if (count > 0) { mem.writeU32(m + 8, count); return 0; } mem.writeU32(m + 4, 0); mem.writeU32(m + 8, 0); this.wake(); return 0; }   // EPERM when not the owner
  condWait(cpu, cond, m, deadline = Infinity) {
    const mem = this.process.memory, t = this.current;
    if (t.condWait?.cond !== cond) { t.condWait = { cond, seq: mem.readU32(cond), mutex: m, deadline }; this.mutexUnlock(m); }   // first entry: remember the sequence and the deadline, release the mutex
    deadline = t.condWait.deadline ?? Infinity;   // a retried call (the thread was suspended in it) keeps the deadline of its first entry: a relative timeout does not start again
    const signalled = () => mem.readU32(cond) !== t.condWait.seq;
    const got = this.wait(cpu, () => signalled() || this.now() >= deadline, { what: `a condition variable at 0x${cond.toString(16)}`, deadline });
    if (got === BLOCKED) return BLOCKED;
    const timedOut = !signalled(); t.condWait = null;
    const relock = this.mutexLock(cpu, m); if (relock === BLOCKED) { t.condWait = { cond, seq: -1, mutex: m, relocking: true }; return BLOCKED; }
    return timedOut ? 110 : 0;   // ETIMEDOUT
  }
  condSignal(cond) { const mem = this.process.memory; mem.writeU32(cond, (mem.readU32(cond) + 1) >>> 0); this.wake(); return 0; }
  join(cpu, pthread, out) {
    const thread = this.byPthread(pthread); if (!thread || thread.main) return 3;   // ESRCH
    const tid = thread.tid;
    const got = this.wait(cpu, () => thread.state === 'done', { what: `pthread_join of thread ${tid}` });
    if (got === BLOCKED) return BLOCKED;
    if (out) this.process.memory.write64(out, thread.result);
    return 0;
  }
  futex(cpu, address, op, value, timeoutPtr) {
    const mem = this.process.memory, cmd = op & 0x7f;
    if (cmd === 0 || cmd === 9) {   // FUTEX_WAIT / FUTEX_WAIT_BITSET
      const t = this.current;
      // the deadline is fixed at the first entry (a suspended wait is retried when the thread runs again: a relative timeout computed again would never expire). FUTEX_WAIT's
      // timeout is relative; FUTEX_WAIT_BITSET's is absolute, on CLOCK_MONOTONIC (the native threads' clock) or with FUTEX_CLOCK_REALTIME (256) on the wall clock
      if (!t.futex || t.futex.address !== address) {
        if (mem.readU32(address) !== (value >>> 0)) { mem.writeU32(this.process.errnoAddress, 11); return -1; }
        const span = timeoutPtr ? Number(mem.read64(timeoutPtr)) * 1000 + Number(mem.read64(timeoutPtr + 8)) / 1e6 : null, wall = this.process.hostLibrary?.__wallMs;
        const deadline = span === null ? Infinity : cmd === 0 ? this.now() + span : op & 256 ? this.now() + (span - (wall ? wall() : Date.now())) : span;
        t.futex = { address, woken: false, deadline }; (this.futexWaiters ??= []).push(t);
      }
      const deadline = t.futex.deadline;
      const changed = () => t.futex.woken || mem.readU32(address) !== (value >>> 0);
      const got = this.wait(cpu, () => changed() || this.now() >= deadline, { what: `a futex at 0x${address.toString(16)}`, deadline });
      if (got === BLOCKED) return BLOCKED;
      const woken = changed(); this.futexWaiters = this.futexWaiters.filter(w => w !== t); t.futex = null;
      if (!woken) { mem.writeU32(this.process.errnoAddress, 110); return -1; }   // ETIMEDOUT
      return 0;
    }
    if (cmd === 1 || cmd === 10) {   // FUTEX_WAKE / FUTEX_WAKE_BITSET
      let woken = 0; for (const t of this.futexWaiters ?? []) if (woken < value && t.futex?.address === address && !t.futex.woken) { t.futex.woken = true; woken++; }
      if (woken) this.wake();
      return woken;
    }
    throw new APKError(`ARM64 native code: futex operation ${cmd} is not supported`, { kind: 'arm64-syscall' });
  }
}
