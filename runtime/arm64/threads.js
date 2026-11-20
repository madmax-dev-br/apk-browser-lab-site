// Native threads of the ARM64 process (docs/ARM64-NATIVE.md "Threads"). pthread_create gives the start routine its own interpreter state (registers), stack and
// TLS block over the shared memory; threads run in slices of instructions, interleaved by a pump on the VM's event loop and by any thread that waits.
// Waiting is real: a mutex held by another thread, a condition variable, a futex word, pthread_join and sleeping park the thread until the condition holds.
// A thread at the top of its own run is suspended (its pc stays on the waiting call, retried later); code called synchronously from Java (a native method, a
// JNI_OnLoad) cannot suspend the Java thread, so its wait runs the other native threads itself until the condition holds. When every thread waits and nothing
// can wake one, the run fails naming the wait (a deadlock or a missing waker), never silently.
import { APKError } from '../apk-error.js?v=8a2b0d58d249';
import { Arm64Cpu, BLOCKED } from './cpu.js?v=8a2b0d58d249';

const SLICE = 20000;   // instructions a thread runs before the next one is given a turn

export class NativeThreads {
  constructor(process, { queueTask = null, now = () => performance.now(), log = () => {} } = {}) {
    this.process = process; this.queueTask = queueTask; this.now = now; this.log = log;
    const main = { tid: process.pid, cpu: process.cpu, state: 'running', tp: process.tp, errno: process.errnoAddressMain, keys: new Map(), main: true };
    this.threads = new Map([[main.tid, main]]); this.current = main; this.nextTid = process.pid + 1; this.pumpQueued = false;
    this.exitEntry = process.hostEntry('pthread:exit', (p, cpu) => { this.finish(this.current, cpu.x[0]); cpu.exited = true; });
  }
  get running() { return this.current; }
  create(start, arg) {
    const p = this.process, stackSize = 512 * 1024, region = p.mapRegion(stackSize + 0x10000, 0x10000), tp = region + stackSize + 0x100;
    p.initThreadTls(tp);
    const cpu = new Arm64Cpu(p.memory, { host: (c, index) => p.dispatchHost(c, index), maxSteps: p.cpu.maxSteps });
    cpu.describe = p.cpu.describe; cpu.sp = region + stackSize; cpu.tpidr = BigInt(tp); cpu.x[0] = BigInt(arg); cpu.x[30] = BigInt(this.exitEntry); cpu.pc = Number(start); cpu.nested = 0;
    const thread = { tid: this.nextTid++, cpu, state: 'runnable', tp, errno: tp - 0xf0, keys: new Map(), waiters: [], result: 0n };
    this.threads.set(thread.tid, thread); this.log(`ARM64 native thread ${thread.tid} started at 0x${Number(start).toString(16)}`);
    this.schedulePump();
    return thread.tid;
  }
  finish(thread, value) { thread.state = 'done'; thread.result = value; this.log(`ARM64 native thread ${thread.tid} ended`); }
  /** Can the thread that is running now be suspended at this call (true), or must its wait be driven synchronously (false)? */
  canSuspend(cpu) { const t = this.current; return !t.main && t.cpu === cpu && (cpu.nested ?? 0) === 0; }
  /** The waiting primitive for host functions: returns BLOCKED (the call is retried when the thread runs again) or, for a synchronous caller, runs the other threads until `ready()`. */
  // `wakeAt()`: the earliest time the condition may turn true by time alone (a timer), when it does not wait for another thread
  wait(cpu, ready, { what, deadline = Infinity, wakeAt = null } = {}) {
    if (ready()) return true;
    if (this.canSuspend(cpu)) { Object.assign(this.current, { state: 'waiting', ready, deadline, what, wakeAt }); return BLOCKED; }
    const caller = this.current;
    for (;;) {
      if (ready()) return true;
      if (this.now() >= deadline) return false;
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
  nextTimer(caller) { let at = Infinity; for (const t of this.threads.values()) if (t !== caller && !t.main && t.state === 'waiting') at = Math.min(at, t.deadline, t.wakeAt?.() ?? Infinity); return at; }
  /** Runs one slice of every other thread that can run; true when any of them ran. */
  runOthers(caller) {
    let progressed = false;
    for (const thread of [...this.threads.values()]) {
      if (thread === caller || thread.main || thread.state === 'done') continue;
      if (thread.state === 'waiting') { if (thread.ready() || this.now() >= thread.deadline || this.now() >= (thread.wakeAt?.() ?? Infinity)) thread.state = 'runnable'; else continue; }
      progressed = this.slice(thread) || progressed;
    }
    return progressed;
  }
  slice(thread) {
    const previous = this.current, p = this.process; this.current = thread; p.activeCpu = thread.cpu; thread.state = 'running';
    try {
      const outcome = thread.cpu.run(-1, SLICE);
      if (outcome === 'exited' || thread.state === 'done') { thread.state = 'done'; return true; }
      if (outcome === 'blocked') return true;   // state set to 'waiting' by wait()
      thread.state = 'runnable'; return true;
    } catch (error) {
      thread.state = 'done'; this.log(`ARM64 native thread ${thread.tid} stopped: ${error.message}`);
      throw error;   // a fault in any thread ends the process, as SIGSEGV / abort do on a device
    } finally { this.current = previous; p.activeCpu = previous.cpu; }
  }
  /** Background progress: while native threads can run, the VM's event loop gives them slices between its own events. */
  schedulePump() {
    if (this.pumpQueued || !this.queueTask) return;
    this.pumpQueued = true;
    this.queueTask(() => {
      this.pumpQueued = false;
      const caller = this.current; let active = false;
      for (let round = 0; round < 8; round++) { if (!this.runOthers(caller)) break; active = true; }
      if ([...this.threads.values()].some(t => !t.main && t.state !== 'done' && (t.state === 'runnable' || t.deadline !== Infinity || (t.wakeAt?.() ?? Infinity) !== Infinity || active))) this.schedulePump();
    }, 4);
  }
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
  mutexUnlock(m) { const mem = this.process.memory; if (mem.readU32(m + 4) !== this.current.tid) return 1; const count = mem.readU32(m + 8) - 1; if (count > 0) { mem.writeU32(m + 8, count); return 0; } mem.writeU32(m + 4, 0); mem.writeU32(m + 8, 0); return 0; }   // EPERM when not the owner
  condWait(cpu, cond, m, deadline = Infinity) {
    const mem = this.process.memory, t = this.current;
    if (t.condWait?.cond !== cond) { t.condWait = { cond, seq: mem.readU32(cond), mutex: m }; this.mutexUnlock(m); }   // first entry: remember the sequence and release the mutex
    const signalled = () => mem.readU32(cond) !== t.condWait.seq;
    const got = this.wait(cpu, () => signalled() || this.now() >= deadline, { what: `a condition variable at 0x${cond.toString(16)}`, deadline });
    if (got === BLOCKED) return BLOCKED;
    const timedOut = !signalled(); t.condWait = null;
    const relock = this.mutexLock(cpu, m); if (relock === BLOCKED) { t.condWait = { cond, seq: -1, mutex: m, relocking: true }; return BLOCKED; }
    return timedOut ? 110 : 0;   // ETIMEDOUT
  }
  condSignal(cond) { const mem = this.process.memory; mem.writeU32(cond, (mem.readU32(cond) + 1) >>> 0); return 0; }
  join(cpu, tid, out) {
    const thread = this.threads.get(tid); if (!thread || thread.main) return 3;   // ESRCH
    const got = this.wait(cpu, () => thread.state === 'done', { what: `pthread_join of thread ${tid}` });
    if (got === BLOCKED) return BLOCKED;
    if (out) this.process.memory.write64(out, thread.result);
    return 0;
  }
  futex(cpu, address, op, value, timeoutPtr) {
    const mem = this.process.memory, cmd = op & 0x7f;
    if (cmd === 0 || cmd === 9) {   // FUTEX_WAIT / FUTEX_WAIT_BITSET
      const t = this.current;
      if (!t.futex || t.futex.address !== address) { if (mem.readU32(address) !== (value >>> 0)) { mem.writeU32(this.process.errnoAddress, 11); return -1; } t.futex = { address, woken: false }; (this.futexWaiters ??= []).push(t); }
      const deadline = timeoutPtr ? this.now() + Number(mem.read64(timeoutPtr)) * 1000 + Number(mem.read64(timeoutPtr + 8)) / 1e6 : Infinity;
      const got = this.wait(cpu, () => t.futex.woken || mem.readU32(address) !== (value >>> 0), { what: `a futex at 0x${address.toString(16)}`, deadline });
      if (got === BLOCKED) return BLOCKED;
      const woken = t.futex.woken; this.futexWaiters = this.futexWaiters.filter(w => w !== t); t.futex = null;
      if (!woken && got === false) { mem.writeU32(this.process.errnoAddress, 110); return -1; }
      return 0;
    }
    if (cmd === 1 || cmd === 10) {   // FUTEX_WAKE / FUTEX_WAKE_BITSET
      let woken = 0; for (const t of this.futexWaiters ?? []) if (woken < value && t.futex?.address === address && !t.futex.woken) { t.futex.woken = true; woken++; }
      return woken;
    }
    throw new APKError(`ARM64 native code: futex operation ${cmd} is not supported`, { kind: 'arm64-syscall' });
  }
}
