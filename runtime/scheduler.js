import { APKError } from './apk-error.js?v=ebd42d0a624c';

// Green-thread scheduler for the VM.
//
// Every Java thread is a VMThread: an explicit frame stack (see interpreter.js) plus scheduling state. The interpreter's run loop executes one thread at a time and
// switches threads at safepoints: a thread blocks (a native returned a Blocked), ends, or exhausts its instruction quantum while another thread is runnable. Blocking
// natives (Object.wait, LockSupport.park, Thread.sleep/join, contended monitors, ...) do not wait in JavaScript; they return a Blocked describing the wake-up condition and
// the interpreter parks the thread. Host code that cannot be suspended (a native that called back into Java, a class initializer) waits through runUntil(), which lets
// the *other* threads run on top of the waiting JavaScript stack and reports a deadlock when the thread that would wake it is itself stuck below that stack.
//
// Time is the VM clock (vm-clock.js): when every thread waits, the clock jumps to the earliest deadline instead of sleeping in real time.

/** What a blocking native returns (`roots`: the Java values its closures keep alive while the thread is parked, so a collector can see them): park the calling thread until ready() or the deadline; finish(timedOut) then produces the call's result (or throws, or blocks again).
 *  `io`: the wait is for the network (a socket read, an HTTP exchange's head or body), whose wake-up may give the thread an I/O boost (Scheduler.ioBoostMs); a function gives
 *  the size in bytes of the answer the thread wakes up to (the boost serves the smallest first). */
export class Blocked {
  constructor({ ready, deadline = Infinity, finish = () => undefined, reason = 'blocked', retry = false, interruptible = false, roots = [], blocker = null, io = false }) { this.roots = roots; this.blocker = blocker; this.ready = ready; this.deadline = deadline; this.finish = finish; this.reason = reason; this.retry = retry; this.interruptible = interruptible; this.io = io; }
}

let nextThreadId = 2;
export class VMThread {
  constructor(name = `Thread-${nextThreadId}`, javaObject = null, id = BigInt(nextThreadId++)) {
    this.id = id; this.name = name; this.javaObject = javaObject; this.frames = []; this.state = 'new';   // new | runnable | blocked | terminated
    this.blocked = null; this.blockKind = 'site'; this.nestedDepth = 0; this.nestedBlock = false; this.driver = null; this.lastOutcome = null; this.began = false; this.daemon = false; this.priority = 5;
    this.coreQuantum = 0; this.coreQuantumSize = 0; this.coreQuantumAt = 0;   // the core's quantum for this thread in a slice (vmcore/js/core-threads.js quantumFor / sizeQuantum)
    this.interrupted = false; this.permit = false; this.waitingOn = null; this.finished = false; this.started = false; this.handler = null; this.target = null;
    this.contextLoader = undefined; this.idleParks = 0; this.blocker = null; this.uncaught = null;
    this.boostAt = 0; this.boostUsed = 0; this.boostSize = 0;   // the I/O boost (Scheduler.ioBoostMs): declared here so a thread keeps one shape when it is on
  }
}

export const QUANTUM = 20000;   // instructions a thread runs before another runnable thread gets the processor

// I/O boost (off unless ioBoostMs > 0; docs/INTERACTION-PERFORMANCE.md section 25): on a phone the threads that just got a network answer decode it in parallel, each on a core of
// its own; here they share one Worker, and round robin between them made every one of them finish as late as the last (five 150 ms decodes: each result after ~750 ms). A thread
// whose network wait ended (a Blocked with io) is served before the threads that stayed runnable, until it parks again or has run ioBoostMs of background slices since that
// wake-up; then it is an ordinary thread again. Among boosted threads the one whose answer is the smallest goes first (it will be done soonest: small answers that arrive
// while a large one is decoded are not held behind it), and of equal answers the one woken first (each decode runs to its end in turn instead of all of them ending last).
// Main-thread events keep their priority (they run between slices whatever the order of the background threads), a thread that never waits for the network never gets a
// boost, and nothing is reordered within a thread. The boost orders only the event pump's background slices (a slice with a deadline and no owner): a run some thread waits
// for on the JavaScript stack (the main thread in a nested wait, host code that called Java) keeps the plain round robin, so the thread that would wake it is never held
// behind a boosted decode. One slice in IO_BOOST_SHARE goes to the round robin while a boost is on, so a thread the boosted one spins on (a CAS loop, onSpinWait) moves on.
const IO_BOOST_WALL_FACTOR = 8;   // a boost also ends this many times ioBoostMs of wall time after its wake-up
const IO_BOOST_SHARE = 4;
const EVENT_GRACE_MS = 50;   // host time a due host event may wait for a run that cannot return to the event pump before that run yields to it (hostEventsStarved)
const QUIET_IDLE_LIMIT = 50000;  // consecutive clock skips with no host event in between
export class Scheduler {
  constructor(rt) { this.rt = rt; this.threads = []; this.main = null; this.cursor = 0; this.parkedServing = 0; this.waitingNested = new Set(); this.stats = { idles: 0, skippedMs: 0, events: 0, wakeups: 0, rounds: 0, boosts: 0 }; this.quietIdles = 0; this.fairTick = 0; this.eventTotal = 0; this.lastSteps = 0; this.starved = false; this.dueSince = 0; this.ioBoostMs = 0; this.boosted = []; this.boostTurn = 0; this.suspendedMain = null; }   // suspendedMain: the main thread's event suspended in its wait (vmcore/js/host-bridge.js suspendable)
  get clock() { return this.rt.platform.clock; }

  /** The thread that runs host events (Looper/main). */
  mainThread() {
    if (!this.main) { this.main = new VMThread('main', null, 1n); this.main.state = 'runnable'; this.main.started = true; this.threads.push(this.main); this.rt.thread = this.main; }
    return this.main;
  }
  /**
   * Instruction budget accounting. `rt.steps` is the budget of the thread that is running: the instructions it has executed since it last blocked (waiting for a lock, a future, a timer or
   * an event is progress, and resets it; preemption by the scheduler is not). A runaway thread therefore trips the per-thread fuse (maxInstructionsPerEvent) wherever it is preempted, while
   * a startup that runs many threads, none of them spinning, does not pool their work into one thread's budget. The sum over all threads for one host event is capped separately
   * (maxEventInstructions) so threads that keep waking each other cannot run forever.
   */
  beginEvent(rt) { if (rt.steps === 0) { rt.profile.reset(); rt.eventWallStart = performance.now(); this.eventTotal = 0; this.lastSteps = 0; for (const thread of this.threads) thread.budget = 0; } }
  switching(rt, previous, next) {
    rt.tb?.thread(next?.name ?? 'main');
    const steps = rt.steps; if (steps > (rt.peakThreadSteps ?? 0)) rt.peakThreadSteps = steps;
    this.eventTotal += steps >= this.lastSteps ? steps - this.lastSteps : steps;
    if (previous) previous.budget = previous.state === 'runnable' ? steps : 0;
    this.stats.rounds++;
    if (this.eventTotal > (rt.peakEventTotal ?? 0)) rt.peakEventTotal = this.eventTotal;
    if (this.eventTotal > rt.maxEventInstructions) rt.budgetExceeded(`Instruction budget (${rt.maxEventInstructions} across all threads of one event) exceeded; threads: ${this.describe()}`, { kind: 'event-instruction-budget' });
    rt.steps = this.lastSteps = next.budget ?? 0;
  }
  add(thread) { if (!this.threads.includes(thread)) this.threads.push(thread); }
  /** Makes a started thread runnable. `driver(rt, thread)` supplies its work: a PendingCall (run this Java method), an Invoke, a Blocked, or undefined when the thread is done. */
  start(thread, driver) { thread.driver = driver; thread.started = true; thread.state = 'runnable'; this.add(thread); this.rt.multiThreaded = true; }
  terminate(thread) {
    thread.state = 'terminated'; thread.finished = true; thread.blocked = null;
    this.threads = this.threads.filter(candidate => candidate !== thread);
    if (this.cursor >= this.threads.length) this.cursor = 0;
    if (this.rt.monitors) for (const [id, monitor] of this.rt.monitors) if (monitor.owner === thread) this.rt.monitors.delete(id);
    // ART's Thread exit does notifyAll() on the Thread object: whoever waits on it (HandlerThread.getLooper's `while (isAlive() && mLooper == null) wait()`, an Object.wait-based join) re-checks isAlive().
    const ref = thread.javaObject;
    if (ref !== undefined && ref !== null) { const waiters = this.rt.heap.get(ref.ref ?? ref)?.waiters; if (waiters) for (const waiter of waiters) waiter.notified = true; }
  }

  /** Marks blocked threads whose condition holds (or whose deadline passed) runnable again; returns the earliest pending deadline. */
  wake() {
    const now = this.clock.now(); let earliest = Infinity;
    for (const thread of this.threads) {
      if (thread.state !== 'blocked') continue;
      const blocked = thread.blocked;
      const monitor = this.rt.monitor, stats = this.stats;
      if (thread.interrupted && blocked.interruptible) { thread.timedOut = false; thread.state = 'runnable'; stats.wakeups++; monitor?.noteWake(thread, blocked, 0); this.noteWake(thread, false); continue; }
      if (blocked.ready()) { thread.timedOut = false; thread.state = 'runnable'; stats.wakeups++; monitor?.noteWake(thread, blocked, 1); this.noteWake(thread, blocked.io); }
      else if (blocked.deadline <= now) { thread.timedOut = true; thread.state = 'runnable'; stats.wakeups++; monitor?.noteWake(thread, blocked, 2); this.noteWake(thread, false); }
      else if (blocked.deadline < earliest) earliest = blocked.deadline;
    }
    return earliest;
  }
  /** A parked thread became runnable: a network wait that ended (`io`: true, or the size of its answer) gives it an I/O boost (ioBoostMs), any other wake-up ends the one it had. */
  noteWake(thread, io) {
    if (this.ioBoostMs <= 0) { if (thread.boostAt) thread.boostAt = 0; return; }
    if (!io) { if (thread.boostAt) { thread.boostAt = 0; this.boosted = this.boosted.filter(other => other !== thread); } return; }
    if (!thread.boostAt) this.boosted.push(thread);   // a boosted thread woken again keeps its place, with a fresh budget
    let size = 0; if (typeof io === 'function') { try { size = Number(io()) || 0; } catch { size = 0; } }
    thread.boostAt = performance.now(); thread.boostUsed = 0; thread.boostSize = size; this.stats.boosts++;
  }
  /** `ms` of a background slice ran `thread` (drainEvents): charged to its boost. */
  charge(thread, ms) { if (thread?.boostAt && ms > 0) thread.boostUsed = (thread.boostUsed ?? 0) + ms; }
  /** The boosted thread to run now (of those that may run under `owner`, the one with the smallest answer, then the earliest woken), or null; boosts that are over are dropped. */
  boostHead(owner) {
    if (!this.boosted.length) return null;
    const now = performance.now(), budget = this.ioBoostMs; let head = null;
    for (let i = 0; i < this.boosted.length; i++) {
      const thread = this.boosted[i];
      const over = !thread.boostAt || thread.state === 'terminated' || thread.state === 'blocked' || (thread.boostUsed ?? 0) >= budget || now - thread.boostAt > budget * IO_BOOST_WALL_FACTOR || !this.threads.includes(thread);
      if (over) { thread.boostAt = 0; this.boosted.splice(i--, 1); continue; }
      if (thread.state === 'runnable' && (head === null || (thread.boostSize ?? 0) < (head.boostSize ?? 0)) && this.eligible(thread, owner)) head = thread;
    }
    return head;
  }
  /** A background slice of the event pump (drainEvents: no owner, a deadline): the only runs the I/O boost orders. */
  pumpSlice(owner) { return owner === null && this.rt.sliceDeadline > 0; }
  /** May `thread` run in a run owned by `owner` (pick's rules)? */
  eligible(thread, owner) {
    if (thread !== owner && thread.nestedDepth > 0) return false;
    if (thread !== owner && this.waitingNested.has(thread)) return false;
    if (thread === this.main && thread !== owner && thread.frames.length === 0) return false;
    return true;
  }
  /** True when `thread` (blocked inside a nested host wait) can continue. */
  nestedReady() { for (const thread of this.waitingNested) if (thread.state === 'runnable') return true; return false; }

  /**
   * The next thread for `loop` to run, round robin after `current`: a runnable guest that is not stuck in a nested host call, or the loop owner. Returns null when nothing
   * can run, and `earliest` is the next timed wake-up.
   */
  pick(current, owner) {
    const earliest = this.wake(), n = this.threads.length;
    // A scheduling slice without an owner (runThreads from a nested host wait or the event pump) runs one thread and ends, and the next slice picks again: starting the round robin at the
    // head of the list every time let the first runnable threads monopolize the processor while a thread created later (a HandlerThread whose getLooper() the main thread waits for) never
    // ran. The cursor remembers where the last pick left off, so consecutive slices go around the whole list.
    const from = current !== null && current !== undefined ? this.threads.indexOf(current) : this.cursor;
    if (this.boosted.length && this.pumpSlice(owner)) {   // a thread that just got its network answer goes first (ioBoostMs), but for one slice in IO_BOOST_SHARE
      const boosted = this.boostHead(owner);
      if (boosted !== null && ++this.boostTurn % IO_BOOST_SHARE !== 0) { this.lastPicked = boosted; return { thread: boosted, earliest }; }
    }
    for (let i = 1; i <= n; i++) {
      const at = (from + i + n) % n, thread = this.threads[at];
      if (!thread || thread.state !== 'runnable') continue;
      if (thread !== owner && thread.nestedDepth > 0) continue;   // suspended under the JavaScript stack of an outer run: only that run can resume it
      if (thread !== owner && this.waitingNested.has(thread)) continue;   // parked in a nested host wait (resolveNested) on the JavaScript stack: its own wait loop resumes it when wake() made it runnable, never a slice as a guest (that ran its frames twice and ended in a false deadlock)
      if (thread === this.main && thread !== owner && thread.frames.length === 0) continue;   // the main thread between events has no frames and no driver: it is the host event loop, not a guest to resume (running it ends it)
      this.cursor = at; this.lastPicked = thread;   // the thread a slice ran last (measurement: the Worker's task log names it)
      return { thread, earliest };
    }
    return { thread: null, earliest };
  }
  /** True when some free thread can run now (after waking those whose wait is over). */
  hasRunnable() { this.wake(); return this.threads.some(thread => thread.state === 'runnable' && thread.nestedDepth === 0 && thread !== this.rt.thread && !this.idleMain(thread)); }
  /** The main thread while the host event loop runs: runnable on paper, but with no frames and no driver there is nothing to resume. */
  idleMain(thread) { return thread === this.main && thread.frames.length === 0 && thread.driver === null; }
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
    // Asked once per scheduling quantum (20000 loop iterations or calls: microseconds to milliseconds), so the O(threads) scan is cheap. It used to be sampled every 4th call, which
    // multiplied the time a thread woken at its deadline waited for the processor by four; a woken thread must get it within one quantum.
    this.wake();                                   // timers and conditions that came due while `current` ran
    if (owner && owner.state === 'blocked' && this.servableEventDelay() === 0) return true;   // host events are due while the run owner waits: switch so that they run
    // A slice with no owner (runThreads, called from a nested host wait or the event pump) is not a thread of its own: the thread whose host wait this slice serves is parked on the JavaScript stack
    // below it. When its wait is over (woken by its deadline, notify or unpark) the slice must end so that it can continue, however many other threads are runnable -- or whether `current` is the only one.
    if (owner === null && this.waitingNested.size && this.innermostNestedReady()) return true;
    if (this.hostEventsStarved(owner)) return true;
    if (this.boosted.length && this.pumpSlice(owner)) { const head = this.boostHead(owner); if (head !== null) return head !== current; }   // boosted threads first, the smallest answer (then the earliest woken) until its boost is over
    for (const thread of this.threads) if (thread !== current && thread.state === 'runnable' && (thread === owner || thread.nestedDepth === 0)) return true;
    return false;
  }
  /**
   * Host events (main-Looper messages, posted tasks) that stay due while the running code cannot return to the event pump. The pump normally runs between scheduling slices, but two runs sit on the
   * JavaScript stack above it and end only when their own work does: a slice that serves a nested host wait (`owner === null` with waiters on the stack), and a nested run owned by a background
   * thread (host code called back into Java: toString() from String.valueOf, ...). Neither is preempted by an idle main thread, which is not a thread with frames to resume. Android's main thread
   * runs a due message at once, so after EVENT_GRACE_MS of host time the run yields (sets `starved`) and the caller serves the events (serviceEvents). The grace keeps short callbacks from being
   * interleaved with main-thread work that might contend for a monitor the buried thread holds. The main thread's own runs never yield (host events assume they are not interleaved mid-event).
   */
  hostEventsStarved(owner) {
    if (owner === null ? this.waitingNested.size === 0 : (owner === this.main || owner.state === 'blocked')) return false;
    const delay = this.servableEventDelay();
    if (delay !== 0) { this.dueSince = 0; return false; }
    const now = performance.now();
    if (!this.dueSince) { this.dueSince = now; return false; }
    return (this.starved = now - this.dueSince >= EVENT_GRACE_MS);
  }
  /** True when the innermost nested host wait (the only one whose JavaScript stack is on top) can continue. */
  innermostNestedReady() { let innermost = null; for (const thread of this.waitingNested) innermost = thread; return innermost !== null && innermost.state === 'runnable'; }

  /**
   * Fairness for the host event queue. A run whose owner is blocked (a wait inside an event, a nested host call) keeps switching between the threads that can run; the queued host events
   * (main-looper messages, posted tasks) used to be served only when NO thread was runnable, so one thread that never stops running starved them for good. At each thread switch the events that
   * are already due run, the same way the idle path runs them (a runnable thread is preempted for them: see hasOtherRunnable).
   */
  serviceEvents() {
    this.starved = false; this.dueSince = 0;
    const platform = this.rt.platform, delay = this.servableEventDelay();
    if (delay === null || delay === undefined || delay > 0) return;
    if (!this.mayServeEvents()) return;
    const previous = this.rt.thread; this.rt.thread = this.mainThread();
    try { const processed = this.serveEvents(platform); if (processed) { this.stats.events += processed; this.quietIdles = 0; } } finally { this.rt.thread = previous; }
  }
  /**
   * Main is parked in a wait: a contended monitor, a class another thread initializes, Object.wait, park, sleep, join, a latch, Future.get, runBlocking. On Android a waiting main
   * thread runs nothing; its Handler messages, coroutine continuations on Dispatchers.Main, View.post Runnables, frames and traversals wait until it is back in its Looper. The
   * lab serves only its own host tasks on top of it (looper-host.js hostOnly: what other processes and threads do on a device, such as a network result or a service answer).
   * It used to serve every main-Looper message during an explicit wait, and frames during any wait: a Handler message or a frame then composed again in the middle of a
   * composition that waited (Compose: ComposeRuntimeError from CompositionImpl.drainPendingModificationsForCompositionLocked in composeInitial, "pending composition has not
   * been applied"), drew during a measure ("performMeasureAndLayout called during measure layout") and re-entered a View's draw (RenderNode "Recording currently in progress").
   * One level only: a host task served that way that blocks parks main again, and the queue waits until main is back in its Looper (serving the next one on top of it nested one
   * JavaScript run per queued task until the stack overflowed: "RangeError: Maximum call stack size exceeded" in the event pump).
   */
  mainParked() { const main = this.main; return main !== null && (main.state === 'blocked' || this.waitingNested.has(main) || this.suspendedMain !== null); }   // a suspended event is main's until it resumes, even once its wait is over
  /** The delay until an event that may be served now: while main is parked only the lab's host tasks count. */
  servableEventDelay() { const platform = this.rt.platform; return this.mainParked() && platform.nextParkedEventDelay ? platform.nextParkedEventDelay() : platform.nextEventDelay?.(); }
  mayServeEvents() { return !(this.parkedServing > 0 && this.mainParked()); }
  serveEvents(platform) {
    const parked = this.mainParked(); if (parked) this.parkedServing = (this.parkedServing ?? 0) + 1;
    try { return platform.drainEvents?.(this.rt)?.processed ?? 0; } finally { if (parked) this.parkedServing--; }
  }
  /** What to do when nothing is runnable: run due platform events, skip the clock to the earliest deadline, or report the deadlock. `owner` is the blocked loop owner. */
  idle(earliest, why) {
    const platform = this.rt.platform;
    if (this.rt.monitor?.active) this.rt.monitor.tick();   // a nested wait that keeps skipping the virtual clock and running events still ends with the operation budget
    // Readiness can change asynchronously now (a network worker thread writes shared memory while this run loop is deciding): look once more before concluding that nothing can run.
    // A wake-up seen here returns to the caller's loop, whoever it woke: the loop's own owner (parked in a run loop with an owner, nestedDepth > 0 and not a nested wait) is not
    // in the checks below, and a network read whose response ended during this wake() (its ready() refreshes the exchange) left network.pending at 0 -- concluding "deadlock"
    // then was a race the response's timing decided (seen with the synchronous bridge under load).
    let woken = this.stats.wakeups;
    this.wake(); if (this.stats.wakeups !== woken || this.threads.some(thread => thread.state === 'runnable' && !this.idleMain(thread) && (thread.nestedDepth === 0 || this.waitingNested.has(thread)))) return;
    const serve = this.mayServeEvents();
    const processed = serve ? this.serveEvents(platform) : 0;
    if (processed) { this.stats.events += processed; this.quietIdles = 0; return; }
    const network = this.rt.network;
    if (network && network.pending > 0) {
      // Exchanges are in flight but this run loop sits on the JavaScript stack of host code (a class initializer, a native that called back into Java): it cannot return to the
      // event loop to let the response arrive. A synchronous network worker can wait here; without one the situation is reported instead of skipping time.
      if (network.syncWait?.(this)) return;
      throw new APKError(`Network wait in a frame that cannot suspend: ${why}. ${network.pending} exchange(s) are in flight and the VM is inside a nested host call, so it cannot yield to the browser event loop (threads: ${this.describe()})`, { kind: 'network-would-block' });
    }
    woken = this.stats.wakeups;
    this.wake(); if (this.stats.wakeups !== woken || this.threads.some(thread => thread.state === 'runnable' && thread.nestedDepth === 0 && !this.idleMain(thread))) return;   // same race, after the platform events ran
    const delay = serve ? (this.servableEventDelay() ?? null) : null, now = this.clock.now();   // queued messages that may not run now (see mayServeEvents) are no wake-up for this wait
    const next = Math.min(earliest === Infinity ? Infinity : Math.max(0, earliest - now), delay === null ? Infinity : delay);
    if (next === Infinity) throw new APKError(`Deadlock: ${why}; no thread is runnable and no timer or event is pending${serve ? '' : ' (main-Looper messages are queued, but the main thread is blocked inside a message that ran during its own wait: they run only when main is back in its Looper)'} (threads: ${this.describe()})`, { kind: 'cooperative-deadlock' });
    // Time may only be skipped to a wake-up that can lead somewhere. Threads that merely re-park on a timer (an idle pool worker's keep-alive) wake, find nothing and sleep again
    // forever; when that is all that happens, virtual time advances without end while the waiter never gets what it needs. That is a deadlock, reported as one.
    if (++this.quietIdles > QUIET_IDLE_LIMIT) throw new APKError(`Deadlock: ${why}; ${this.quietIdles} consecutive idle rounds advanced the clock by ${Math.round(this.stats.skippedMs - (this.quietSkipStart ?? 0))} ms without an event, a network response or a thread completing a wait (threads: ${this.describe()})`, { kind: 'cooperative-deadlock' });
    if (this.quietIdles === 1) this.quietSkipStart = this.stats.skippedMs;
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
      each([thread.javaObject, thread.target, thread.handler, thread.uncaught, thread.contextLoader, thread.blocker, thread.looper, thread.guardPolicy, thread.lastOutcome, thread.waitingOn, thread.driver]);
      if (thread.blocked) each(thread.blocked.roots ?? []);
      for (const frame of thread.frames) {
        if (frame.cont) { each(frame.cont.args ?? []); each(frame.cont.roots ?? []); continue; }
        each(frame.regs); each([frame.rv, frame.result, frame.pendingException]);
      }
    }
  }
  describe() { return JSON.stringify(this.stats) + ' ' + this.threads.map(thread => `${thread.name}:${thread.state}${thread.blocked ? '(' + thread.blocked.reason + (Number.isFinite(thread.blocked.deadline) ? ', prazo em ' + Math.round(thread.blocked.deadline - this.clock.now()) + ' ms' : ', sem prazo') + (thread.blocker ? ', espera ' + String(this.rt.typeOf(thread.blocker)).replace(/^L|;$/g, '') : '') + ')' : ''}${thread.nestedDepth ? '@host' : ''}`).join(', '); }

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
          if (next) { this.rt.runThreads(); this.serviceEvents(); idleRounds = 0; continue; }
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
