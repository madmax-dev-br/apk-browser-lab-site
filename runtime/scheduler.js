import { APKError } from './apk-error.js?v=32afb2a18437';

// Green-thread scheduler for the VM.
//
// Every Java thread is a VMThread: an explicit frame stack (see interpreter.js) plus scheduling state. The interpreter's run loop executes one thread at a time and
// switches threads at safepoints: a thread blocks (a native returned a Blocked), ends, or exhausts its instruction quantum while another thread is runnable. Blocking
// natives (Object.wait, LockSupport.park, Thread.sleep/join, contended monitors, ...) do not wait in JavaScript; they return a Blocked describing the wake-up condition and
// the interpreter parks the thread. Host code that cannot be suspended (a native that called back into Java, a class initializer) waits through runUntil(), which lets
// the *other* threads run on top of the waiting JavaScript stack and reports a deadlock when the thread that would wake it is itself stuck below that stack.
//
// Time is the VM clock (vm-clock.js): when every thread waits, the clock jumps to the earliest deadline instead of sleeping in real time.

/** What a blocking native returns (`roots`: the Java values its closures keep alive while the thread is parked, so a collector can see them): park the calling thread until ready() or the deadline; finish(timedOut) then produces the call's result (or throws, or blocks again). */
export class Blocked {
  constructor({ ready, deadline = Infinity, finish = () => undefined, reason = 'blocked', retry = false, interruptible = false, roots = [] }) { this.roots = roots; this.ready = ready; this.deadline = deadline; this.finish = finish; this.reason = reason; this.retry = retry; this.interruptible = interruptible; }
}

let nextThreadId = 2;
export class VMThread {
  constructor(name = `Thread-${nextThreadId}`, javaObject = null, id = BigInt(nextThreadId++)) {
    this.id = id; this.name = name; this.javaObject = javaObject; this.frames = []; this.state = 'new';   // new | runnable | blocked | terminated
    this.blocked = null; this.blockKind = 'site'; this.nestedDepth = 0; this.nestedBlock = false; this.driver = null; this.lastOutcome = null; this.began = false; this.daemon = false; this.priority = 5;
    this.interrupted = false; this.permit = false; this.waitingOn = null; this.finished = false; this.started = false; this.handler = null; this.target = null;
    this.contextLoader = undefined; this.idleParks = 0; this.blocker = null; this.uncaught = null;
  }
}

export const QUANTUM = 20000;   // instructions a thread runs before another runnable thread gets the processor

export class Scheduler {
  constructor(rt) { this.rt = rt; this.threads = []; this.main = null; this.cursor = 0; this.waitingNested = new Set(); this.stats = { idles: 0, skippedMs: 0, events: 0 }; }
  get clock() { return this.rt.platform.clock; }

  /** The thread that runs host events (Looper/main). */
  mainThread() {
    if (!this.main) { this.main = new VMThread('main', null, 1n); this.main.state = 'runnable'; this.main.started = true; this.threads.push(this.main); this.rt.thread = this.main; }
    return this.main;
  }
  add(thread) { if (!this.threads.includes(thread)) this.threads.push(thread); }
  /** Makes a started thread runnable. `driver(rt, thread)` supplies its work: a PendingCall (run this Java method), an Invoke, a Blocked, or undefined when the thread is done. */
  start(thread, driver) { thread.driver = driver; thread.started = true; thread.state = 'runnable'; this.add(thread); this.rt.multiThreaded = true; }
  terminate(thread) {
    thread.state = 'terminated'; thread.finished = true; thread.blocked = null;
    this.threads = this.threads.filter(candidate => candidate !== thread);
    if (this.cursor >= this.threads.length) this.cursor = 0;
    if (this.rt.monitors) for (const [id, monitor] of this.rt.monitors) if (monitor.owner === thread) this.rt.monitors.delete(id);
  }

  /** Marks blocked threads whose condition holds (or whose deadline passed) runnable again; returns the earliest pending deadline. */
  wake() {
    const now = this.clock.now(); let earliest = Infinity;
    for (const thread of this.threads) {
      if (thread.state !== 'blocked') continue;
      const blocked = thread.blocked;
      if (thread.interrupted && blocked.interruptible) { thread.timedOut = false; thread.state = 'runnable'; continue; }
      if (blocked.ready()) { thread.timedOut = false; thread.state = 'runnable'; }
      else if (blocked.deadline <= now) { thread.timedOut = true; thread.state = 'runnable'; }
      else if (blocked.deadline < earliest) earliest = blocked.deadline;
    }
    return earliest;
  }
  /** True when `thread` (blocked inside a nested host wait) can continue. */
  nestedReady() { for (const thread of this.waitingNested) if (thread.state === 'runnable') return true; return false; }

  /**
   * The next thread for `loop` to run, round robin after `current`: a runnable guest that is not stuck in a nested host call, or the loop owner. Returns null when nothing
   * can run, and `earliest` is the next timed wake-up.
   */
  pick(current, owner) {
    const earliest = this.wake(), n = this.threads.length;
    for (let i = 1; i <= n; i++) {
      const thread = this.threads[(this.threads.indexOf(current) + i + n) % n];
      if (!thread || thread.state !== 'runnable') continue;
      if (thread !== owner && thread.nestedDepth > 0) continue;   // suspended under the JavaScript stack of an outer run: only that run can resume it
      return { thread, earliest };
    }
    return { thread: null, earliest };
  }
  /** True when some free thread can run now (after waking those whose wait is over). */
  hasRunnable() { this.wake(); return this.threads.some(thread => thread.state === 'runnable' && thread.nestedDepth === 0 && thread !== this.rt.thread); }
  /** Milliseconds until a thread needs the processor again: 0 if one is runnable, the earliest timed wait otherwise, null if none. */
  threadDelay() {
    if (!this.rt.multiThreaded) return null;
    const earliest = this.wake();
    if (this.threads.some(thread => thread.state === 'runnable' && thread.nestedDepth === 0 && thread !== this.main)) return 0;
    return earliest === Infinity ? null : Math.max(0, earliest - this.clock.now());
  }
  hasOtherRunnable(current, owner) {
    // The main thread runs host events (UI, Looper callbacks) that assume they are not interleaved with other Java threads mid-event: it yields only by blocking or finishing.
    if (current === this.main) return false;
    this.wake();                                   // timers and conditions that came due while `current` ran
    for (const thread of this.threads) if (thread !== current && thread.state === 'runnable' && (thread === owner || thread.nestedDepth === 0)) return true;
    return false;
  }

  /** What to do when nothing is runnable: run due platform events, skip the clock to the earliest deadline, or report the deadlock. `owner` is the blocked loop owner. */
  idle(earliest, why) {
    const platform = this.rt.platform;
    // Readiness can change asynchronously now (a network worker thread writes shared memory while this run loop is deciding): look once more before concluding that nothing can run.
    this.wake(); if (this.threads.some(thread => thread.state === 'runnable' && (thread.nestedDepth === 0 || this.waitingNested.has(thread)))) return;
    const processed = platform.drainEvents?.(this.rt)?.processed ?? 0;
    if (processed) { this.stats.events += processed; return; }
    const network = this.rt.network;
    if (network && network.pending > 0) {
      // Exchanges are in flight but this run loop sits on the JavaScript stack of host code (a class initializer, a native that called back into Java): it cannot return to the
      // event loop to let the response arrive. A synchronous network worker can wait here; without one the situation is reported instead of skipping time.
      if (network.syncWait?.(this)) return;
      throw new APKError(`Network wait in a frame that cannot suspend: ${why}. ${network.pending} exchange(s) are in flight and the VM is inside a nested host call, so it cannot yield to the browser event loop (threads: ${this.describe()})`, { kind: 'network-would-block' });
    }
    this.wake(); if (this.threads.some(thread => thread.state === 'runnable' && thread.nestedDepth === 0)) return;   // same race, after the platform events ran
    const delay = platform.nextEventDelay?.() ?? null, now = this.clock.now();
    const next = Math.min(earliest === Infinity ? Infinity : Math.max(0, earliest - now), delay === null ? Infinity : delay);
    if (next === Infinity) throw new APKError(`Deadlock: ${why}; no thread is runnable and no timer or event is pending (threads: ${this.describe()})`, { kind: 'cooperative-deadlock' });
    this.stats.idles++; this.stats.skippedMs += next; this.clock.skip(next);
  }
  /**
   * Garbage-collector roots held by the scheduler: calls visit(value) for every Java value a thread keeps alive that is not in the heap's own tables -- thread objects,
   * handler/target/uncaught-handler/context-loader references, every frame's registers, return value, result and pending exception, the `args` of host continuations
   * (Invoke), and the `roots` a parked Blocked declares. Monitors (rt.monitors: id -> {owner}) and Object.wait waiter lists live on heap objects and are not repeated here.
   * Host closures (Invoke.then/onError, Blocked.finish) cannot be inspected: a native that captures a Java value in one must list it in `roots` / the Invoke args.
   */
  enumerateRoots(visit) {
    const each = values => { for (const value of values) if (value !== undefined && value !== null && typeof value === 'object') visit(value); };
    for (const thread of this.threads) {
      each([thread.javaObject, thread.target, thread.handler, thread.uncaught, thread.contextLoader, thread.blocker, thread.looper]);
      if (thread.blocked) each(thread.blocked.roots ?? []);
      for (const frame of thread.frames) {
        if (frame.cont) { each(frame.cont.args ?? []); each(frame.cont.roots ?? []); continue; }
        each(frame.regs); each([frame.rv, frame.result, frame.pendingException]);
      }
    }
  }
  describe() { return JSON.stringify(this.stats) + ' ' + this.threads.map(thread => `${thread.name}:${thread.state}${thread.blocked ? '(' + thread.blocked.reason + ')' : ''}${thread.nestedDepth ? '@host' : ''}`).join(', '); }

  /**
   * A native returned Blocked to a caller that cannot suspend (host code on the JavaScript stack). Waits by running other threads and events until it is ready; a wait
   * whose waker is stuck beneath this stack raises the deadlock error instead of hanging.
   */
  resolveNested(blocked) {
    for (;;) {
      const thread = this.rt.thread;
      thread.blocked = blocked; thread.state = 'blocked'; thread.nestedBlock = true; this.waitingNested.add(thread);
      let timedOut = false;
      try {
        let idleRounds = 0;
        for (;;) {
          const earliest = this.wake();
          if (thread.state === 'runnable') { timedOut = thread.timedOut; break; }
          const { thread: next } = this.pick(thread, null);
          if (next) { this.rt.runThreads(); idleRounds = 0; continue; }
          this.idle(earliest, `${thread.name} is waiting (${blocked.reason}) and cannot be woken: the threads that could do it are suspended below this host call`);
          if (++idleRounds > 100000) throw new APKError(`Deadlock: ${thread.name} waited ${idleRounds} idle rounds (${blocked.reason})`, { kind: 'cooperative-deadlock' });
        }
      } finally { this.waitingNested.delete(thread); thread.nestedBlock = false; this.rt.thread = thread; }
      thread.state = 'runnable'; thread.blocked = null;
      const result = blocked.finish(timedOut);
      if (!(result instanceof Blocked)) return result;
      blocked = result;
    }
  }
}
