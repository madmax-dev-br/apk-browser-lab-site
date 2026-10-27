import { APKError } from './apk-error.js?v=f1c4bcc7c53e';
import { createHostRegistry } from './host-contract.js?v=f1c4bcc7c53e';
import { Blocked, VMThread } from './scheduler.js?v=f1c4bcc7c53e';
import { Invoke } from './interpreter.js?v=f1c4bcc7c53e';
import { GC_ROOTS } from './heap-gc.js?v=f1c4bcc7c53e';

// Cooperative threads for the single-threaded VM.
//
// Model (documented limits, not hidden): a Thread or a pool worker is a *task on the VM event loop*. start()/execute() never run user code
// synchronously: the body is queued (platform.queueTask) and runs to completion after the current event, with Thread.currentThread() set to
// the Thread object that owns it (distinct object, id and name; named by the ThreadFactory). There is no preemption: a task that must wait
// for another one (Thread.join, Future.get, CountDownLatch.await, awaitTermination, sleep) runs the queued tasks inline until its condition
// holds ("help scheduling"); if nothing can make progress it fails with an explicit deadlock error instead of hanging. Pool workers never
// block on their queue: an idle worker is a parked Thread that the pool re-schedules when work arrives.
// Contract references: java.util.concurrent.ThreadPoolExecutor / FutureTask / Executors / BlockingQueue, java.lang.Thread (android-13.0.0_r1 libcore).

const THREAD = 'Ljava/lang/Thread;', RUNNABLE = 'Ljava/lang/Runnable;', CALLABLE = 'Ljava/util/concurrent/Callable;', OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', THROWABLE = 'Ljava/lang/Throwable;';
const TPE = 'Ljava/util/concurrent/ThreadPoolExecutor;', STPE = 'Ljava/util/concurrent/ScheduledThreadPoolExecutor;', FUTURE_TASK = 'Ljava/util/concurrent/FutureTask;', SCHEDULED_TASK = 'Ljava/util/concurrent/ScheduledThreadPoolExecutor$ScheduledFutureTask;';
const FACTORY = 'Ljava/util/concurrent/ThreadFactory;', UNIT = 'Ljava/util/concurrent/TimeUnit;', QUEUE = 'Ljava/util/concurrent/BlockingQueue;', HANDLER = 'Ljava/util/concurrent/RejectedExecutionHandler;';
const UEH = 'Ljava/lang/Thread$UncaughtExceptionHandler;', EXECUTORS = 'Ljava/util/concurrent/Executors;', DEFAULT_FACTORY = 'Ljava/util/concurrent/Executors$DefaultThreadFactory;', WORKER = 'Ljava/util/concurrent/ThreadPoolExecutor$Worker;';
const COLLECTION = 'Ljava/util/Collection;', LIST = 'Ljava/util/List;';

export function createConcurrencyHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const vcall = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const scall = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const newObject = (r, owner, parameters, args) => { const ref = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: ref }), 'direct'); return ref; };
  const jtype = (r, ref) => r.object(ref).type;
  const throwNew = (r, owner, message = null) => r.throwJava(owner, message);
  const isThrowable = (r, error, owner) => error?.value && r.isSubtype(r.typeOf(error.value), owner);

  // ---- waiting ------------------------------------------------------------------------------------------------------------------------------
  // Blocking natives that an interpreter call site can park return a Blocked (see scheduler.js). The host-side helpers below are for code that waits from inside a
  // JavaScript call: they let the other threads and the event queue run until the condition holds (or the timeout passes), and report a deadlock when nothing can.
  let nextThreadNumber = 0, nextId = 2n, poolNumber = 0;
  /** Waits (bounded by `timeoutMs`) for done(); false = timeout. A wait that nothing can ever end raises the scheduler's deadlock error. */
  function helpUntil(r, done, timeoutMs = Infinity, reason = 'host wait') {
    if (done()) return true;
    const deadline = timeoutMs === Infinity ? Infinity : platform.clock.now() + timeoutMs;
    r.scheduler.resolveNested(new Blocked({ ready: done, deadline, reason }));
    return done();
  }
  const waitFor = (r, what, done, timeoutMs = Infinity) => {
    if (helpUntil(r, done, timeoutMs, what)) return true;
    if (timeoutMs !== Infinity) return false;
    throw new APKError(`Deadlock: ${what} can never complete -- no runnable task remains in the scheduler`, { kind: 'cooperative-deadlock' });
  };
  const block = (r, { reason, ready, timeoutMs = Infinity, interruptible = true, finish }) => new Blocked({ reason, ready, deadline: timeoutMs === Infinity ? Infinity : platform.clock.now() + timeoutMs, interruptible, finish });

  // ---- java.lang.Thread ---------------------------------------------------------------------------------------------------------------------
  type(THREAD, OBJECT, [RUNNABLE], { allocatable: true });
  type('Ljava/lang/ThreadGroup;', OBJECT, [], { allocatable: true }); type('Ljava/lang/IllegalThreadStateException;', 'Ljava/lang/IllegalArgumentException;'); type(UEH, OBJECT); registry.interfaces.set(UEH, []);
  let defaultHandler = null, current = null;
  const mainThread = r => {
    r.mainThread ??= r.makeObject(THREAD); const o = r.object(r.mainThread);
    if (!o.thread) { const t = r.scheduler.mainThread(); t.javaObject = r.mainThread; o.thread = t; }
    return r.mainThread;
  };
  const state = (r, ref) => {
    const o = r.object(ref);
    if (!o.thread) {
      if (ref.ref === mainThread(r).ref) return o.thread;
      o.thread = new VMThread(`Thread-${nextThreadNumber++}`, ref, nextId++);
    }
    return o.thread;
  };
  // Thread.currentThread(): the green thread being run, or the pool thread a host executor task is running on behalf of.
  const currentThread = r => {
    const running = r.thread;
    if (running && running !== r.scheduler.main && running.javaObject) return running.javaObject;
    return current ?? mainThread(r);
  };
  const init = (r, self, target, name) => { const st = state(r, self); st.target = target ?? null; if (name !== undefined && name !== null) st.name = r.stringCharacters(name); };
  def(THREAD, '<init>', '()V', (r, _m, [self]) => init(r, self, null));
  def(THREAD, '<init>', `(${RUNNABLE})V`, (r, _m, [self, t]) => init(r, self, t));
  def(THREAD, '<init>', `(${RUNNABLE}${STRING})V`, (r, _m, [self, t, n]) => init(r, self, t, n ?? r.throwJava('Ljava/lang/NullPointerException;', 'name == null')));
  def(THREAD, '<init>', `(${STRING})V`, (r, _m, [self, n]) => init(r, self, null, n ?? r.throwJava('Ljava/lang/NullPointerException;', 'name == null')));
  def(THREAD, '<init>', `(Ljava/lang/ThreadGroup;${RUNNABLE}${STRING})V`, (r, _m, [self, , t, n]) => init(r, self, t, n));
  def(THREAD, '<init>', `(Ljava/lang/ThreadGroup;${RUNNABLE}${STRING}J)V`, (r, _m, [self, , t, n]) => init(r, self, t, n));
  def(THREAD, '<init>', `(Ljava/lang/ThreadGroup;${STRING})V`, (r, _m, [self, , n]) => init(r, self, null, n));
  def(THREAD, '<init>', `(Ljava/lang/ThreadGroup;${RUNNABLE})V`, (r, _m, [self, , t]) => init(r, self, t));
  def(THREAD, 'run', '()V', (r, _m, [self]) => { const t = state(r, self).target; if (t !== null) vcall(r, t, RUNNABLE, 'run', [], 'V'); });
  function runThread(r, ref) {
    const st = state(r, ref), previous = current; current = ref;
    try { vcall(r, ref, THREAD, 'run', [], 'V'); }
    catch (error) { if (!(error instanceof Object) || !error.value) throw error; uncaught(r, ref, error.value); }
    finally { current = previous; if (!st.keepAlive) { st.finished = true; } }
  }
  function uncaught(r, ref, throwable) {
    const handler = state(r, ref).handler ?? defaultHandler;
    if (handler) { vcall(r, handler, UEH, 'uncaughtException', [THREAD, THROWABLE], 'V', [ref, throwable]); return; }
    r.record(`LOG E AndroidRuntime: FATAL EXCEPTION: ${state(r, ref).name}: ${r.typeOf(throwable)}: ${r.object(throwable).message ?? ''}`);
    throw new APKError(`Uncaught exception in thread "${state(r, ref).name}": ${r.typeOf(throwable)}${r.object(throwable).message ? ': ' + r.object(throwable).message : ''}`, { kind: 'uncaught-thread-exception' });
  }
  // Thread.start(): a real green thread. Its first frame is the DEX run() (a Thread subclass override, or the Runnable target) so the body can park and resume.
  const THREAD_RUN = { owner: THREAD, name: 'run', parameters: [], result: 'V', signature: '()V' }, RUNNABLE_RUN = { owner: RUNNABLE, name: 'run', parameters: [], result: 'V', signature: '()V' };
  def(THREAD, 'start', '()V', (r, _m, [self]) => {
    const st = state(r, self); if (st.started) throwNew(r, 'Ljava/lang/IllegalThreadStateException;');
    st.javaObject = self;
    r.uncaughtHook ??= (thread, error) => { if (!error?.value) throw error; uncaught(r, thread.javaObject, error.value); };
    r.scheduler.start(st, (rt, thread) => {
      if (thread.began) { if (thread.lastOutcome?.error) throw thread.lastOutcome.error; return undefined; }   // run() ended: an exception reaches the uncaught handler
      thread.began = true;
      const override = rt.resolveInvoke(THREAD_RUN, [self], 'virtual', null);
      if (override.kind === 'definition' && override.definition.code) return rt.dispatch(THREAD_RUN, [self], 'virtual', null, true);
      return st.target === null ? undefined : rt.dispatch(RUNNABLE_RUN, [st.target], 'virtual', null, true);
    });
  });
  def(THREAD, 'currentThread', `()${THREAD}`, r => currentThread(r), { static: true });
  def(THREAD, 'getName', `()${STRING}`, (r, _m, [self]) => state(r, self).name);
  def(THREAD, 'setName', `(${STRING})V`, (r, _m, [self, n]) => { state(r, self).name = n === null ? throwNew(r, 'Ljava/lang/NullPointerException;', 'name == null') : r.stringCharacters(n); });
  def(THREAD, 'getId', '()J', (r, _m, [self]) => state(r, self).id); def(THREAD, 'threadId', '()J', (r, _m, [self]) => state(r, self).id);
  def(THREAD, 'isAlive', '()Z', (r, _m, [self]) => { const st = state(r, self); return st.started && !st.finished ? 1 : 0; });
  // Runtime.addShutdownHook/removeShutdownHook (libcore ApplicationShutdownHooks): same argument checks; hooks are held (GC-rooted) but never
  // started, because this VM has no process exit. Android itself does not promise to run them when an app process is killed.
  const RUNTIME = 'Ljava/lang/Runtime;', shutdownHooks = new Map();
  def(RUNTIME, 'addShutdownHook', `(${THREAD})V`, (r, _m, [, hook]) => {
    if (hook === null) throwNew(r, 'Ljava/lang/NullPointerException;', 'hook');
    const st = state(r, hook);
    if (st.started) throwNew(r, 'Ljava/lang/IllegalArgumentException;', 'Hook already running');
    if (shutdownHooks.has(hook.ref)) throwNew(r, 'Ljava/lang/IllegalArgumentException;', 'Hook previously registered');
    shutdownHooks.set(hook.ref, hook); r.record(`RUNTIME shutdown hook registered: ${st.name} (held; this VM has no process exit to run it)`);
  });
  def(RUNTIME, 'removeShutdownHook', `(${THREAD})Z`, (r, _m, [, hook]) => {
    if (hook === null) throwNew(r, 'Ljava/lang/NullPointerException;', 'hook');
    return shutdownHooks.delete(hook.ref) ? 1 : 0;
  });
  def(THREAD, 'isDaemon', '()Z', (r, _m, [self]) => state(r, self).daemon ? 1 : 0);
  def(THREAD, 'setDaemon', '(Z)V', (r, _m, [self, d]) => { const st = state(r, self); if (st.started && !st.finished) throwNew(r, 'Ljava/lang/IllegalThreadStateException;'); st.daemon = !!d; });
  def(THREAD, 'getPriority', '()I', (r, _m, [self]) => state(r, self).priority);
  def(THREAD, 'setPriority', '(I)V', (r, _m, [self, p]) => { if (p < 1 || p > 10) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); state(r, self).priority = p; }); // recorded, never enforced: there is no preemptive scheduler
  // Thread.interrupt() (libcore Thread.java): when a java.nio channel operation is in progress its Interruptible blocker is told, which closes the channel
  // (ClosedByInterruptException) -- AbstractInterruptibleChannel.begin()/end() register it through the hidden Thread.blockedOn.
  def(THREAD, 'interrupt', '()V', (r, _m, [self]) => {
    const st = state(r, self), blocker = st.blocker ?? null; st.interrupted = true;
    if (blocker !== null && blocker !== 0) r.dispatch({ owner: 'Lsun/nio/ch/Interruptible;', name: 'interrupt', parameters: [THREAD], result: 'V', signature: `(${THREAD})V` }, [blocker, self], 'virtual');
  });
  def(THREAD, 'blockedOn', '(Lsun/nio/ch/Interruptible;)V', (r, _m, [self, blocker]) => { state(r, self).blocker = blocker; });
  def(THREAD, 'isInterrupted', '()Z', (r, _m, [self]) => state(r, self).interrupted ? 1 : 0);
  def(THREAD, 'interrupted', '()Z', r => { const st = state(r, currentThread(r)), was = st.interrupted; st.interrupted = false; return was ? 1 : 0; }, { static: true });
  def(THREAD, 'setUncaughtExceptionHandler', `(${UEH})V`, (r, _m, [self, h]) => { state(r, self).handler = h; });
  def(THREAD, 'getUncaughtExceptionHandler', `()${UEH}`, (r, _m, [self]) => state(r, self).handler);
  def(THREAD, 'setDefaultUncaughtExceptionHandler', `(${UEH})V`, (r, _m, [h]) => { defaultHandler = h; }, { static: true });
  def(THREAD, 'getDefaultUncaughtExceptionHandler', `()${UEH}`, () => defaultHandler, { static: true });
  // ---- java.util.concurrent.locks.LockSupport over the cooperative scheduler: park() runs the other queued tasks until unpark()/interrupt (or, with a timeout, the
  // deadline); a park that no task can ever end raises the cooperative-deadlock error instead of hanging.
  const LOCK_SUPPORT = 'Ljava/util/concurrent/locks/LockSupport;';
  // park returns a Blocked: the thread leaves the processor until unpark(), an interrupt or the deadline (the permit is consumed on return, like LockSupport.park).
  const parkUntil = (r, ms) => {
    const st = state(r, currentThread(r));     if (st.permit || st.interrupted) { st.permit = false; return undefined; }
    return block(r, { reason: 'LockSupport.park', ready: () => st.permit, timeoutMs: ms, finish: () => { st.permit = false; } });
  };
  def(LOCK_SUPPORT, 'park', '()V', r => parkUntil(r, Infinity), { static: true });
  def(LOCK_SUPPORT, 'park', `(${OBJECT})V`, r => parkUntil(r, Infinity), { static: true });
  def(LOCK_SUPPORT, 'parkNanos', '(J)V', (r, _m, [n]) => n > 0n ? parkUntil(r, Number(n) / 1e6) : undefined, { static: true });
  def(LOCK_SUPPORT, 'parkNanos', `(${OBJECT}J)V`, (r, _m, [, n]) => n > 0n ? parkUntil(r, Number(n) / 1e6) : undefined, { static: true });
  def(LOCK_SUPPORT, 'parkUntil', '(J)V', (r, _m, [t]) => parkUntil(r, Math.max(0, Number(t) - platform.clock.wall())), { static: true });
  def(LOCK_SUPPORT, 'parkUntil', `(${OBJECT}J)V`, (r, _m, [, t]) => parkUntil(r, Math.max(0, Number(t) - platform.clock.wall())), { static: true });
  def(LOCK_SUPPORT, 'unpark', `(${THREAD})V`, (r, _m, [thread]) => { if (thread !== null) state(r, thread).permit = true; }, { static: true });

  // Thread.getContextClassLoader/setContextClassLoader: a thread starts with its creator's context loader, which for the VM's first thread is the system (app) class loader.
  const CLASS_LOADER = 'Ljava/lang/ClassLoader;';
  def(THREAD, 'getContextClassLoader', `()${CLASS_LOADER}`, (r, _m, [self]) => { const st = state(r, self); if (!('contextLoader' in st)) st.contextLoader = r.dispatch({ owner: CLASS_LOADER, name: 'getSystemClassLoader', parameters: [], result: CLASS_LOADER, signature: `()${CLASS_LOADER}` }, [], 'static'); return st.contextLoader; });
  def(THREAD, 'setContextClassLoader', `(${CLASS_LOADER})V`, (r, _m, [self, loader]) => { state(r, self).contextLoader = loader; });
  def(THREAD, 'holdsLock', `(${OBJECT})Z`, (r, _m, [object]) => { if (object === null) throwNew(r, 'Ljava/lang/NullPointerException;'); return r.ownsMonitor(object) ? 1 : 0; }, { static: true });
  def(THREAD, 'yield', '()V', r => { if (r.multiThreaded) return new Blocked({ ready: () => true, reason: 'Thread.yield' }); platform.drainEvents(r, { maxEvents: 1 }); }, { static: true });
  // Thread.getState(): derived from the scheduler state (NEW, RUNNABLE, BLOCKED on a monitor, WAITING / TIMED_WAITING, TERMINATED).
  const STATE = 'Ljava/lang/Thread$State;', STATE_NAMES = ['NEW', 'RUNNABLE', 'BLOCKED', 'WAITING', 'TIMED_WAITING', 'TERMINATED'];
  type(STATE, 'Ljava/lang/Enum;', [], { allocatable: true });
  const stateConstant = (r, name) => { r.threadStates ??= new Map(); if (!r.threadStates.has(name)) { const value = r.allocate(STATE), o = r.object(value); o.enumName = name; o.enumOrdinal = STATE_NAMES.indexOf(name); r.threadStates.set(name, value); } return r.threadStates.get(name); };
  for (const name of STATE_NAMES) registry.staticField(STATE, name, STATE, r => stateConstant(r, name));
  def(STATE, 'values', `()[${STATE}`, r => { const array = r.newArray(`[${STATE}`, STATE_NAMES.length); r.array(array).elements = STATE_NAMES.map(name => stateConstant(r, name)); return array; }, { static: true });
  def(STATE, 'valueOf', `(${STRING})${STATE}`, (r, _m, [name]) => { const text = r.stringCharacters(name); if (!STATE_NAMES.includes(text)) throwNew(r, 'Ljava/lang/IllegalArgumentException;', `No enum constant java.lang.Thread.State.${text}`); return stateConstant(r, text); }, { static: true });
  def(THREAD, 'getState', `()${STATE}`, (r, _m, [self]) => {
    const st = state(r, self);
    if (st.finished) return stateConstant(r, 'TERMINATED');
    if (!st.started) return stateConstant(r, 'NEW');
    if (st.state === 'blocked' && st.blocked) return stateConstant(r, st.blocked.reason === 'monitor' ? 'BLOCKED' : st.blocked.deadline === Infinity ? 'WAITING' : 'TIMED_WAITING');
    return stateConstant(r, 'RUNNABLE');
  });
  def(THREAD, 'getThreadGroup', '()Ljava/lang/ThreadGroup;', () => null);
  const checkInterrupt = r => { const st = state(r, currentThread(r)); if (st.interrupted) { st.interrupted = false; throwNew(r, 'Ljava/lang/InterruptedException;'); } };
  const sleep = (r, ms) => {
    checkInterrupt(r);
    const st = state(r, currentThread(r));
    return block(r, { reason: 'Thread.sleep', ready: () => false, timeoutMs: Math.max(0, ms), finish: () => { if (st.interrupted) { st.interrupted = false; throwNew(r, 'Ljava/lang/InterruptedException;'); } } });
  };
  def(THREAD, 'sleep', '(J)V', (r, _m, [ms]) => { if (ms < 0n) throwNew(r, 'Ljava/lang/IllegalArgumentException;', 'millis < 0: ' + ms); return sleep(r, Number(ms)); }, { static: true });
  def(THREAD, 'sleep', '(JI)V', (r, _m, [ms]) => sleep(r, Number(ms)), { static: true });
  const join = (r, self, ms) => {
    const st = state(r, self); if (!st.started || st.finished) return;
    if (self.ref === currentThread(r).ref) throw new APKError('Thread.join() on the running thread can never complete', { kind: 'cooperative-deadlock' });
    checkInterrupt(r);
    const me = state(r, currentThread(r));
    return block(r, { reason: `Thread.join(${st.name})`, ready: () => st.finished, timeoutMs: ms === 0 ? Infinity : ms, finish: () => { if (me.interrupted) { me.interrupted = false; throwNew(r, 'Ljava/lang/InterruptedException;'); } } });
  };
  def(THREAD, 'join', '()V', (r, _m, [self]) => join(r, self, 0)); def(THREAD, 'join', '(J)V', (r, _m, [self, ms]) => join(r, self, Number(ms)));

  // ---- futures -------------------------------------------------------------------------------------------------------------------------------
  const FUTURE = 'Ljava/util/concurrent/Future;';
  for (const name of ['ExecutionException', 'TimeoutException']) type(`Ljava/util/concurrent/${name};`, 'Ljava/lang/Exception;');
  type('Ljava/util/concurrent/CancellationException;', 'Ljava/lang/IllegalStateException;'); type('Ljava/util/concurrent/RejectedExecutionException;', 'Ljava/lang/RuntimeException;');
  type(FUTURE, OBJECT); registry.interfaces.set(FUTURE, []);
  type(FUTURE_TASK, OBJECT, ['Ljava/util/concurrent/RunnableFuture;', 'Ljava/util/concurrent/Future;', RUNNABLE], { allocatable: true });
  const ft = (r, ref) => r.object(ref).future ?? throwNew(r, 'Ljava/lang/IllegalStateException;', 'FutureTask used before construction');
  def(FUTURE_TASK, '<init>', `(${CALLABLE})V`, (r, _m, [self, c]) => { if (c === null) throwNew(r, 'Ljava/lang/NullPointerException;'); r.object(self).future = { callable: c, runnable: null, result: null, state: 'new' }; });
  def(FUTURE_TASK, '<init>', `(${RUNNABLE}${OBJECT})V`, (r, _m, [self, run, result]) => { if (run === null) throwNew(r, 'Ljava/lang/NullPointerException;'); r.object(self).future = { callable: null, runnable: run, result, value: result, state: 'new' }; });
  const finish = (r, self, f, state, extra) => { Object.assign(f, extra, { state }); vcall(r, self, FUTURE_TASK, 'done', [], 'V'); };
  def(FUTURE_TASK, 'done', '()V', () => {});
  // FutureTask.run(): the callable/runnable executes as Java frames (an Invoke), so a task that blocks parks its worker thread instead of the whole run loop.
  def(FUTURE_TASK, 'run', '()V', (r, _m, [self]) => {
    const f = ft(r, self); if (f.state !== 'new') return; f.runner = currentThread(r);
    const complete = value => { if (f.state === 'new') finish(r, self, f, 'normal', { value }); return undefined; };
    const failed = error => { if (!error?.value) throw error; if (f.state === 'new') finish(r, self, f, 'failed', { failure: error.value }); return undefined; };
    if (f.callable !== null) return new Invoke({ owner: CALLABLE, name: 'call', parameters: [], result: OBJECT, signature: `()${OBJECT}` }, [f.callable], 'virtual', complete, failed);
    return new Invoke({ owner: RUNNABLE, name: 'run', parameters: [], result: 'V', signature: '()V' }, [f.runnable], 'virtual', () => complete(f.result), failed);
  });
  const isDone = f => f.state !== 'new';
  def(FUTURE_TASK, 'isDone', '()Z', (r, _m, [self]) => isDone(ft(r, self)) ? 1 : 0);
  def(FUTURE_TASK, 'isCancelled', '()Z', (r, _m, [self]) => ft(r, self).state === 'cancelled' ? 1 : 0);
  def(FUTURE_TASK, 'cancel', '(Z)Z', (r, _m, [self, interrupt]) => {
    const f = ft(r, self); if (f.state !== 'new') return 0;
    if (interrupt && f.runner) state(r, f.runner).interrupted = true;
    finish(r, self, f, 'cancelled', {}); return 1;
  });
  const report = (r, f) => {
    if (f.state === 'normal') return f.value;
    if (f.state === 'cancelled') throwNew(r, 'Ljava/util/concurrent/CancellationException;');
    const e = newObject(r, 'Ljava/util/concurrent/ExecutionException;', [THROWABLE], [f.failure]); r.throwJavaReference(e, r.object(e).message ?? null);
  };
  // Future.get parks the calling green thread (a Blocked) until the task is done; a thread that is interrupted while waiting gets InterruptedException.
  const waitInterrupted = r => { const st = state(r, currentThread(r)); if (st.interrupted) { st.interrupted = false; throwNew(r, 'Ljava/lang/InterruptedException;'); } };
  def(FUTURE_TASK, 'get', `()${OBJECT}`, (r, _m, [self]) => {
    const f = ft(r, self); if (isDone(f)) return report(r, f);
    checkInterrupt(r);
    return block(r, { reason: 'Future.get()', ready: () => isDone(f), finish: () => { waitInterrupted(r); return report(r, f); } });
  });
  def(FUTURE_TASK, 'get', `(J${UNIT})${OBJECT}`, (r, _m, [self, t, unit]) => {
    const f = ft(r, self); if (isDone(f)) return report(r, f);
    checkInterrupt(r);
    const millis = Number(vcall(r, unit, UNIT, 'toMillis', ['J'], 'J', [t]));
    return block(r, { reason: 'Future.get(timeout)', ready: () => isDone(f), timeoutMs: Math.max(0, millis), finish: () => { waitInterrupted(r); if (!isDone(f)) throwNew(r, 'Ljava/util/concurrent/TimeoutException;'); return report(r, f); } });
  });
  def(FUTURE_TASK, 'toString', `()${STRING}`, (r, _m, [self]) => `java.util.concurrent.FutureTask@${self.ref.toString(16)}[${({ new: 'Not completed', normal: 'Completed normally', failed: 'Completed exceptionally', cancelled: 'Cancelled' })[ft(r, self).state]}]`);

  // ---- BlockingQueue family (capacity + FIFO/priority; blocking ops that cannot complete fail explicitly) ----------------------------------------
  const queueTypes = { 'Ljava/util/concurrent/LinkedBlockingQueue;': Infinity, 'Ljava/util/concurrent/ArrayBlockingQueue;': null, 'Ljava/util/concurrent/LinkedBlockingDeque;': Infinity, 'Ljava/util/concurrent/PriorityBlockingQueue;': Infinity, 'Ljava/util/concurrent/SynchronousQueue;': 0, 'Ljava/util/concurrent/ConcurrentLinkedQueue;': Infinity, 'Ljava/util/concurrent/ConcurrentLinkedDeque;': Infinity };
  type(QUEUE, OBJECT); registry.interfaces.set(QUEUE, []);
  const q = (r, ref) => r.object(ref).bqueue ?? throwNew(r, 'Ljava/lang/IllegalStateException;', 'queue used before construction');
  const sameRef = (a, b) => a === b || (a && b && typeof a === 'object' && typeof b === 'object' && a.ref === b.ref);
  const insert = (r, queue, item) => {
    if (queue.comparator !== undefined) { // PriorityBlockingQueue: stable insertion by comparator / natural order
      let i = queue.items.length;
      const compare = (a, b) => queue.comparator ? vcall(r, queue.comparator, 'Ljava/util/Comparator;', 'compare', [OBJECT, OBJECT], 'I', [a, b]) : vcall(r, a, 'Ljava/lang/Comparable;', 'compareTo', [OBJECT], 'I', [b]);
      while (i > 0 && compare(queue.items[i - 1], item) > 0) i--; queue.items.splice(i, 0, item);
    } else queue.items.push(item);
  };
  for (const [owner, capacity] of Object.entries(queueTypes)) {
    const priority = owner.endsWith('PriorityBlockingQueue;');
    type(owner, OBJECT, [QUEUE, 'Ljava/util/Queue;', COLLECTION, 'Ljava/lang/Iterable;'], { allocatable: true });
    const make = (comparator) => ({ items: [], capacity, ...(priority ? { comparator } : {}) });
    def(owner, '<init>', '()V', (r, _m, [self]) => { r.object(self).bqueue = make(null); });
    if (capacity === null) { def(owner, '<init>', '(I)V', (r, _m, [self, n]) => { if (n <= 0) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); r.object(self).bqueue = { items: [], capacity: n }; }); def(owner, '<init>', '(IZ)V', (r, _m, [self, n]) => { if (n <= 0) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); r.object(self).bqueue = { items: [], capacity: n }; }); }
    else if (owner.endsWith('SynchronousQueue;')) def(owner, '<init>', '(Z)V', (r, _m, [self]) => { r.object(self).bqueue = make(null); });
    else if (priority) { def(owner, '<init>', '(I)V', (r, _m, [self]) => { r.object(self).bqueue = make(null); }); def(owner, '<init>', '(ILjava/util/Comparator;)V', (r, _m, [self, , c]) => { r.object(self).bqueue = make(c); }); }
    else if (!owner.includes('Concurrent')) def(owner, '<init>', '(I)V', (r, _m, [self, n]) => { if (n <= 0) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); r.object(self).bqueue = { items: [], capacity: n }; });
  }
  for (const owner of Object.keys(queueTypes)) {
    const offer = (r, _m, [self, item]) => { if (item === null) throwNew(r, 'Ljava/lang/NullPointerException;'); const queue = q(r, self); if (queue.items.length >= queue.capacity) return 0; insert(r, queue, item); return 1; };
    def(owner, 'offer', `(${OBJECT})Z`, offer);
    def(owner, 'add', `(${OBJECT})Z`, (r, m, a) => offer(r, m, a) ? 1 : throwNew(r, 'Ljava/lang/IllegalStateException;', 'Queue full'));
    def(owner, 'put', `(${OBJECT})V`, (r, m, a) => {
      if (a[1] === null) throwNew(r, 'Ljava/lang/NullPointerException;'); const queue = q(r, a[0]);
      if (queue.items.length < queue.capacity) { insert(r, queue, a[1]); return undefined; }
      const again = () => block(r, { reason: 'BlockingQueue.put()', ready: () => queue.items.length < queue.capacity, finish: () => { waitInterrupted(r); if (queue.items.length < queue.capacity) { insert(r, queue, a[1]); return undefined; } return again(); } });
      return again();
    });
    def(owner, 'poll', `()${OBJECT}`, (r, _m, [self]) => q(r, self).items.shift() ?? null);
    def(owner, 'poll', `(J${UNIT})${OBJECT}`, (r, _m, [self, t, unit]) => {
      const queue = q(r, self); if (queue.items.length) return queue.items.shift();
      checkInterrupt(r);
      const millis = Number(vcall(r, unit, UNIT, 'toMillis', ['J'], 'J', [t]));
      return block(r, { reason: 'BlockingQueue.poll(timeout)', ready: () => queue.items.length > 0, timeoutMs: Math.max(0, millis), finish: () => { waitInterrupted(r); return queue.items.shift() ?? null; } });
    });
    def(owner, 'take', `()${OBJECT}`, (r, _m, [self]) => {
      const queue = q(r, self); if (queue.items.length) return queue.items.shift();
      checkInterrupt(r);
      const again = () => block(r, { reason: 'BlockingQueue.take()', ready: () => queue.items.length > 0, finish: () => { waitInterrupted(r); return queue.items.length ? queue.items.shift() : again(); } });
      return again();
    });
    def(owner, 'remove', `()${OBJECT}`, (r, _m, [self]) => q(r, self).items.length ? q(r, self).items.shift() : throwNew(r, 'Ljava/util/NoSuchElementException;'));
    def(owner, 'remove', `(${OBJECT})Z`, (r, _m, [self, item]) => { const queue = q(r, self), i = queue.items.findIndex(x => sameRef(x, item)); if (i < 0) return 0; queue.items.splice(i, 1); return 1; });
    def(owner, 'peek', `()${OBJECT}`, (r, _m, [self]) => q(r, self).items[0] ?? null);
    def(owner, 'element', `()${OBJECT}`, (r, _m, [self]) => q(r, self).items[0] ?? throwNew(r, 'Ljava/util/NoSuchElementException;'));
    def(owner, 'size', '()I', (r, _m, [self]) => q(r, self).items.length);
    def(owner, 'isEmpty', '()Z', (r, _m, [self]) => q(r, self).items.length ? 0 : 1);
    def(owner, 'clear', '()V', (r, _m, [self]) => { q(r, self).items.length = 0; });
    def(owner, 'contains', `(${OBJECT})Z`, (r, _m, [self, item]) => q(r, self).items.some(x => sameRef(x, item)) ? 1 : 0);
    def(owner, 'remainingCapacity', '()I', (r, _m, [self]) => { const queue = q(r, self); return queue.capacity === Infinity ? 2147483647 : queue.capacity - queue.items.length; });
    def(owner, 'drainTo', `(${COLLECTION})I`, (r, _m, [self, target]) => { const queue = q(r, self), n = queue.items.length; for (const item of queue.items.splice(0)) vcall(r, target, COLLECTION, 'add', [OBJECT], 'Z', [item]); return n; });
    def(owner, 'toArray', '()[Ljava/lang/Object;', (r, _m, [self]) => { const items = q(r, self).items, array = r.newArray('[Ljava/lang/Object;', items.length); r.array(array).elements = items.slice(); return array; });
    def(owner, 'iterator', '()Ljava/util/Iterator;', (r, _m, [self]) => { const ref = r.allocate('Ljava/util/concurrent/QueueIterator;'); r.object(ref).iteration = { items: q(r, self).items.slice(), index: 0 }; return ref; });
  }
  type('Ljava/util/concurrent/QueueIterator;', OBJECT, ['Ljava/util/Iterator;'], { allocatable: true });
  def('Ljava/util/concurrent/QueueIterator;', 'hasNext', '()Z', (r, _m, [self]) => { const it = r.object(self).iteration; return it.index < it.items.length ? 1 : 0; });
  def('Ljava/util/concurrent/QueueIterator;', 'next', `()${OBJECT}`, (r, _m, [self]) => { const it = r.object(self).iteration; if (it.index >= it.items.length) throwNew(r, 'Ljava/util/NoSuchElementException;'); return it.items[it.index++]; });

  // ---- ThreadFactory / ThreadPoolExecutor ------------------------------------------------------------------------------------------------------
  type(FACTORY, OBJECT); registry.interfaces.set(FACTORY, []); type(HANDLER, OBJECT); registry.interfaces.set(HANDLER, []);
  type(DEFAULT_FACTORY, OBJECT, [FACTORY], { allocatable: true });
  def(DEFAULT_FACTORY, 'newThread', `(${RUNNABLE})${THREAD}`, (r, _m, [self, runnable]) => {
    const o = r.object(self); o.factory ??= { prefix: `pool-${++poolNumber}-thread-`, count: 0 };
    const thread = newObject(r, THREAD, [RUNNABLE, STRING], [runnable, `${o.factory.prefix}${++o.factory.count}`]); // non-daemon, NORM_PRIORITY, like DefaultThreadFactory
    return thread;
  });
  const defaultFactory = r => { const f = r.allocate(DEFAULT_FACTORY); r.object(f).factory = { prefix: `pool-${++poolNumber}-thread-`, count: 0 }; return f; };
  for (const [name, abort] of [['AbortPolicy', true], ['CallerRunsPolicy', false], ['DiscardPolicy', false], ['DiscardOldestPolicy', false]]) {
    const owner = `Ljava/util/concurrent/ThreadPoolExecutor$${name};`;
    type(owner, OBJECT, [HANDLER], { allocatable: true }); def(owner, '<init>', '()V', () => {});
    def(owner, 'rejectedExecution', `(${RUNNABLE}${TPE})V`, (r, _m, [, task, executor]) => {
      if (name === 'AbortPolicy') throwNew(r, 'Ljava/util/concurrent/RejectedExecutionException;', `Task ${describe(r, task)} rejected from ${describe(r, executor)}`);
      if (name === 'CallerRunsPolicy') { if (!pool(r, executor).shutdown) vcall(r, task, RUNNABLE, 'run', [], 'V'); }
      if (name === 'DiscardOldestPolicy' && !pool(r, executor).shutdown) { pool(r, executor).queue.shift(); vcall(r, executor, TPE, 'execute', [RUNNABLE], 'V', [task]); }
    });
    void abort;
  }
  const describe = (r, ref) => { try { return r.stringCharacters(vcall(r, ref, OBJECT, 'toString', [], STRING)); } catch { return jtype(r, ref); } };
  type(TPE, OBJECT, ['Ljava/util/concurrent/ExecutorService;', 'Ljava/util/concurrent/Executor;', 'Ljava/util/concurrent/AbstractExecutorService;'], { allocatable: true });
  type(STPE, TPE, ['Ljava/util/concurrent/ScheduledExecutorService;'], { allocatable: true });
  const pool = (r, ref) => r.object(ref).pool ?? throwNew(r, 'Ljava/lang/IllegalStateException;', 'executor used before construction');
  const configure = (r, self, core, max, keepAlive, unit, queue, factory, handler) => {
    if (core < 0 || max <= 0 || max < core || keepAlive < 0n) throwNew(r, 'Ljava/lang/IllegalArgumentException;');
    if (queue === null) throwNew(r, 'Ljava/lang/NullPointerException;');
    r.object(self).pool = { core, max, queue: q(r, queue).items, queueRef: queue, capacity: q(r, queue).capacity, factory: factory ?? defaultFactory(r), handler: handler ?? newObject(r, 'Ljava/util/concurrent/ThreadPoolExecutor$AbortPolicy;', [], []), workers: [], shutdown: false, completed: 0, allowCoreTimeout: false, keepAlive: Number(keepAlive), keepAliveMs: unit === null ? Number(keepAlive) : Number(vcall(r, unit, UNIT, 'toMillis', ['J'], 'J', [keepAlive])), submitted: 0 };
  };
  const ctor = (extra) => (r, _m, args) => { const [self, core, max, keep, unit, queue] = args; configure(r, self, core, max, keep, unit, queue, extra.includes('F') ? args[6] : null, extra.includes('H') ? args[extra.startsWith('F') ? 7 : 6] : null); };
  def(TPE, '<init>', `(IIJ${UNIT}${QUEUE})V`, ctor('')); def(TPE, '<init>', `(IIJ${UNIT}${QUEUE}${FACTORY})V`, ctor('F')); def(TPE, '<init>', `(IIJ${UNIT}${QUEUE}${HANDLER})V`, ctor('H')); def(TPE, '<init>', `(IIJ${UNIT}${QUEUE}${FACTORY}${HANDLER})V`, ctor('FH'));

  const live = p => p.workers.length;
  function reject(r, self, task) { const p = pool(r, self); vcall(r, p.handler, HANDLER, 'rejectedExecution', [RUNNABLE, TPE], 'V', [task, self]); }
  function addWorker(r, self, firstTask) {
    const p = pool(r, self), worker = { thread: null, first: firstTask, idle: false, runnable: null };
    const runnable = r.allocate(WORKER); r.object(runnable).worker = { pool: self, worker }; worker.runnable = runnable;
    const thread = vcall(r, p.factory, FACTORY, 'newThread', [RUNNABLE], THREAD, [runnable]);
    if (thread === null) return false; // factory refused: execute() then falls through to the queue / rejection like the JDK
    worker.thread = thread; p.workers.push(worker); startWorker(r, self, worker); return true;
  }
  // A pool worker is a green thread whose driver runs one step at a time: take a task, run it as Java frames (an Invoke), and come back for the next. An idle worker blocks
  // until work arrives, the pool shuts down, or a non-core worker's keep-alive time passes.
  function startWorker(r, self, worker) {
    const p = pool(r, self), st = state(r, worker.thread); st.javaObject = worker.thread; st.keepAlive = true;
    r.uncaughtHook ??= (thread, error) => { if (!error?.value) throw error; uncaught(r, thread.javaObject, error.value); };
    r.scheduler.start(st, (rt, thread) => {
      if (thread.lastOutcome?.error) throw thread.lastOutcome.error;     // the previous task's exception already ran afterExecute; the worker dies and the handler sees it
      if (worker.expired) { retire(r, self, worker); return undefined; }
      let task = worker.first; worker.first = null;
      if (task === null) task = p.queue.shift() ?? null;
      if (task === null) {
        if (p.shutdown) { retire(r, self, worker); return undefined; }
        worker.idle = true;
        const nonCore = live(p) > p.core || p.allowCoreTimeout, keep = nonCore && p.keepAliveMs > 0 ? p.keepAliveMs : Infinity;
        return block(r, { reason: 'ThreadPoolExecutor idle worker', ready: () => p.queue.length > 0 || p.shutdown, timeoutMs: keep, interruptible: false,
          finish: () => { if (!p.queue.length && !p.shutdown && keep !== Infinity) worker.expired = true; } });   // keep-alive elapsed: a surplus worker retires
      }
      worker.idle = false;
      vcall(r, self, TPE, 'beforeExecute', [THREAD, RUNNABLE], 'V', [worker.thread, task]);
      return new Invoke({ owner: RUNNABLE, name: 'run', parameters: [], result: 'V', signature: '()V' }, [task], 'virtual',
        () => { vcall(r, self, TPE, 'afterExecute', [RUNNABLE, THROWABLE], 'V', [task, null]); p.completed++; return undefined; },
        error => { if (!error?.value) throw error; vcall(r, self, TPE, 'afterExecute', [RUNNABLE, THROWABLE], 'V', [task, error.value]); p.completed++; retire(r, self, worker); throw error; });
    });
  }
  type(WORKER, OBJECT, [RUNNABLE], { allocatable: true });
  def(WORKER, 'run', '()V', (r, _m, [self]) => { const o = r.object(self); if (o.periodic) o.periodic(); else throw new APKError('A ThreadPoolExecutor worker is driven by its green thread, not run directly', { kind: 'worker-run' }); });
  function retire(r, self, worker) {
    const p = pool(r, self), i = p.workers.indexOf(worker); if (i >= 0) p.workers.splice(i, 1);
    state(r, worker.thread).keepAlive = false; state(r, worker.thread).finished = true;
    // ThreadPoolExecutor.processWorkerExit: a replacement is started only when fewer than `min` workers remain, min = allowCoreThreadTimeOut ? 0 : corePoolSize, raised to 1 while tasks are
    // queued. (Replacing an expired core worker unconditionally spun an endless create/expire cycle on the virtual clock for pools with allowCoreThreadTimeOut(true).)
    let min = p.allowCoreTimeout ? 0 : p.core; if (min === 0 && p.queue.length > 0) min = 1;
    if (!p.shutdown && live(p) < min) addWorker(r, self, null);
    if (p.shutdown && !live(p)) vcall(r, self, TPE, 'terminated', [], 'V');
  }
  def(TPE, 'beforeExecute', `(${THREAD}${RUNNABLE})V`, () => {}); def(TPE, 'afterExecute', `(${RUNNABLE}${THROWABLE})V`, () => {}); def(TPE, 'terminated', '()V', () => {});
  def(TPE, 'execute', `(${RUNNABLE})V`, (r, _m, [self, task]) => {
    if (task === null) throwNew(r, 'Ljava/lang/NullPointerException;');
        const p = pool(r, self);
    if (p.shutdown) return reject(r, self, task);
    if (live(p) < p.core && addWorker(r, self, task)) return;
    if (p.queue.length < p.capacity) {
      p.queue.push(task);
      if (live(p) === 0) addWorker(r, self, null);   // idle workers see the new task through their wait condition
      return;
    }
    if (live(p) < p.max && addWorker(r, self, task)) return;
    reject(r, self, task);
  });
  const submitTask = (r, self, futureTask) => { vcall(r, self, TPE, 'execute', [RUNNABLE], 'V', [futureTask]); return futureTask; };
  def(TPE, 'submit', `(${RUNNABLE})${FUTURE}`, (r, _m, [self, t]) => { if (t === null) throwNew(r, 'Ljava/lang/NullPointerException;'); return submitTask(r, self, newObject(r, FUTURE_TASK, [RUNNABLE, OBJECT], [t, null])); });
  def(TPE, 'submit', `(${RUNNABLE}${OBJECT})${FUTURE}`, (r, _m, [self, t, v]) => { if (t === null) throwNew(r, 'Ljava/lang/NullPointerException;'); return submitTask(r, self, newObject(r, FUTURE_TASK, [RUNNABLE, OBJECT], [t, v])); });
  def(TPE, 'submit', `(${CALLABLE})${FUTURE}`, (r, _m, [self, t]) => { if (t === null) throwNew(r, 'Ljava/lang/NullPointerException;'); return submitTask(r, self, newObject(r, FUTURE_TASK, [CALLABLE], [t])); });
  const elements = (r, collection) => { const it = vcall(r, collection, COLLECTION, 'iterator', [], 'Ljava/util/Iterator;'), out = []; while (vcall(r, it, 'Ljava/util/Iterator;', 'hasNext', [], 'Z')) out.push(vcall(r, it, 'Ljava/util/Iterator;', 'next', [], OBJECT)); return out; };
  const listOf = (r, items) => { const list = newObject(r, 'Ljava/util/ArrayList;', [], []); for (const i of items) vcall(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [i]); return list; };
  def(TPE, 'invokeAll', `(${COLLECTION})${LIST}`, (r, _m, [self, tasks]) => {
    const futures = elements(r, tasks).map(t => submitTask(r, self, newObject(r, FUTURE_TASK, [CALLABLE], [t])));
    for (const f of futures) { const st = ft(r, f); waitFor(r, 'invokeAll', () => isDone(st)); }
    return listOf(r, futures);
  });
  def(TPE, 'shutdown', '()V', (r, _m, [self]) => {
    const p = pool(r, self); p.shutdown = true;
    for (const w of [...p.workers]) if (w.idle) retire(r, self, w);
    if (!live(p)) vcall(r, self, TPE, 'terminated', [], 'V');
  });
  def(TPE, 'shutdownNow', `()${LIST}`, (r, _m, [self]) => {
    const p = pool(r, self); p.shutdown = true; const pending = p.queue.splice(0);
    for (const w of [...p.workers]) { state(r, w.thread).interrupted = true; if (w.idle) retire(r, self, w); }
    return listOf(r, pending);
  });
  const terminated = p => p.shutdown && p.workers.every(w => w.idle) && p.queue.length === 0;
  def(TPE, 'isShutdown', '()Z', (r, _m, [self]) => pool(r, self).shutdown ? 1 : 0);
  def(TPE, 'isTerminated', '()Z', (r, _m, [self]) => terminated(pool(r, self)) ? 1 : 0);
  def(TPE, 'isTerminating', '()Z', (r, _m, [self]) => { const p = pool(r, self); return p.shutdown && !terminated(p) ? 1 : 0; });
  def(TPE, 'awaitTermination', `(J${UNIT})Z`, (r, _m, [self, t, unit]) => { const p = pool(r, self); checkInterrupt(r); return helpUntil(r, () => terminated(p), Number(vcall(r, unit, UNIT, 'toMillis', ['J'], 'J', [t]))) ? 1 : 0; });
  def(TPE, 'getPoolSize', '()I', (r, _m, [self]) => live(pool(r, self))); def(TPE, 'getActiveCount', '()I', (r, _m, [self]) => pool(r, self).workers.filter(w => !w.idle).length);
  def(TPE, 'getCorePoolSize', '()I', (r, _m, [self]) => pool(r, self).core); def(TPE, 'getMaximumPoolSize', '()I', (r, _m, [self]) => pool(r, self).max);
  def(TPE, 'setCorePoolSize', '(I)V', (r, _m, [self, n]) => { if (n < 0) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); pool(r, self).core = n; });
  def(TPE, 'setMaximumPoolSize', '(I)V', (r, _m, [self, n]) => { if (n <= 0 || n < pool(r, self).core) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); pool(r, self).max = n; });
  def(TPE, 'getCompletedTaskCount', '()J', (r, _m, [self]) => BigInt(pool(r, self).completed)); def(TPE, 'getTaskCount', '()J', (r, _m, [self]) => { const p = pool(r, self); return BigInt(p.completed + p.workers.filter(w => !w.idle).length + p.queue.length); });
  def(TPE, 'getQueue', `()${QUEUE}`, (r, _m, [self]) => pool(r, self).queueRef);
  def(TPE, 'getThreadFactory', `()${FACTORY}`, (r, _m, [self]) => pool(r, self).factory); def(TPE, 'setThreadFactory', `(${FACTORY})V`, (r, _m, [self, f]) => { if (f === null) throwNew(r, 'Ljava/lang/NullPointerException;'); pool(r, self).factory = f; });
  def(TPE, 'getRejectedExecutionHandler', `()${HANDLER}`, (r, _m, [self]) => pool(r, self).handler); def(TPE, 'setRejectedExecutionHandler', `(${HANDLER})V`, (r, _m, [self, h]) => { if (h === null) throwNew(r, 'Ljava/lang/NullPointerException;'); pool(r, self).handler = h; });
  def(TPE, 'allowCoreThreadTimeOut', '(Z)V', (r, _m, [self, v]) => { pool(r, self).allowCoreTimeout = !!v; }); def(TPE, 'allowsCoreThreadTimeOut', '()Z', (r, _m, [self]) => pool(r, self).allowCoreTimeout ? 1 : 0);
  def(TPE, 'setKeepAliveTime', `(J${UNIT})V`, (r, _m, [self, t, unit]) => { const p = pool(r, self); p.keepAlive = Number(t); p.keepAliveMs = Number(vcall(r, unit, UNIT, 'toMillis', ['J'], 'J', [t])); });
  def(TPE, 'prestartAllCoreThreads', '()I', (r, _m, [self]) => { const p = pool(r, self); let n = 0; while (live(p) < p.core && addWorker(r, self, null)) n++; return n; });
  def(TPE, 'remove', `(${RUNNABLE})Z`, (r, _m, [self, t]) => { const p = pool(r, self), i = p.queue.findIndex(x => sameRef(x, t)); if (i < 0) return 0; p.queue.splice(i, 1); return 1; });
  def(TPE, 'purge', '()V', () => {});
  def(TPE, 'toString', `()${STRING}`, (r, _m, [self]) => { const p = pool(r, self); return `${jtype(r, self).slice(1, -1).replaceAll('/', '.')}@${self.ref.toString(16)}[${p.shutdown ? (terminated(p) ? 'Terminated' : 'Shutting down') : 'Running'}, pool size = ${live(p)}, active threads = ${p.workers.filter(w => !w.idle).length}, queued tasks = ${p.queue.length}, completed tasks = ${p.completed}]`; });

  // ---- ScheduledThreadPoolExecutor (schedule/scheduleAtFixedRate/scheduleWithFixedDelay on the event loop's timers) ---------------------------------
  type(SCHEDULED_TASK, FUTURE_TASK, ['Ljava/util/concurrent/ScheduledFuture;', 'Ljava/util/concurrent/Delayed;'], { allocatable: true });
  def(STPE, '<init>', '(I)V', (r, _m, [self, core]) => configure(r, self, core, 2147483647, 10n, null, newObject(r, 'Ljava/util/concurrent/LinkedBlockingQueue;', [], []), null, null));
  def(STPE, '<init>', `(I${FACTORY})V`, (r, _m, [self, core, f]) => configure(r, self, core, 2147483647, 10n, null, newObject(r, 'Ljava/util/concurrent/LinkedBlockingQueue;', [], []), f, null));
  // ScheduledThreadPoolExecutor policies (API 21; kotlinx.coroutines sets removeOnCancel by reflection). The values are kept and
  // readable with Java's defaults; the timer queue here never runs a cancelled task, and shutdown keeps its existing behaviour.
  for (const [policy, slot, initial] of [['RemoveOnCancelPolicy', 'removeOnCancel', false], ['ContinueExistingPeriodicTasksAfterShutdownPolicy', 'continuePeriodicAfterShutdown', false], ['ExecuteExistingDelayedTasksAfterShutdownPolicy', 'executeDelayedAfterShutdown', true]]) {
    def(STPE, 'set' + policy, '(Z)V', (r, _m, [self, value]) => { pool(r, self)[slot] = !!value; });
    def(STPE, 'get' + policy, '()Z', (r, _m, [self]) => (pool(r, self)[slot] ?? initial) ? 1 : 0);
  }
  const scheduled = (r, self, task, delayMs, periodMs, wrap) => {
    if (task === null) throwNew(r, 'Ljava/lang/NullPointerException;');
    const p = pool(r, self); if (p.shutdown) { reject(r, self, task); return null; }
    const futureTask = r.allocate(SCHEDULED_TASK); r.object(futureTask).future = wrap(futureTask); r.object(futureTask).schedule = { due: platform.clock.now() + delayMs, period: periodMs };
    const fire = () => {
      const f = ft(r, futureTask); if (isDone(f) || p.shutdown) return;
      vcall(r, self, TPE, 'execute', [RUNNABLE], 'V', [runnableFor(r, futureTask, f, self, fire)]);
    };
    platform.queueTask(fire, delayMs, [futureTask, self]); return futureTask;
  };
  // A recurring task runs its body, then re-arms itself; a one-shot is the FutureTask itself.
  const runnableFor = (r, futureTask, f, self, fire) => { const s = r.object(futureTask).schedule; if (s.period === 0) return futureTask; const task = r.allocate(WORKER); r.object(task).periodic = () => { const wasNew = f.state === 'new'; if (!wasNew) return; try { vcall(r, f.runnable, RUNNABLE, 'run', [], 'V'); } catch (error) { if (!error?.value) throw error; f.state = 'failed'; f.failure = error.value; return; } if (f.state === 'new' && !pool(r, self).shutdown) platform.queueTask(fire, s.period > 0 ? s.period : -s.period); }; return task; };
  const ms = (r, t, unit) => Number(vcall(r, unit, UNIT, 'toMillis', ['J'], 'J', [t]));
  def(STPE, 'schedule', `(${RUNNABLE}J${UNIT})Ljava/util/concurrent/ScheduledFuture;`, (r, _m, [self, c, t, u]) => scheduled(r, self, c, ms(r, t, u), 0, () => ({ callable: null, runnable: c, result: null, value: null, state: 'new' })));
  def(STPE, 'schedule', `(${CALLABLE}J${UNIT})Ljava/util/concurrent/ScheduledFuture;`, (r, _m, [self, c, t, u]) => scheduled(r, self, c, ms(r, t, u), 0, () => ({ callable: c, runnable: null, state: 'new' })));
  def(STPE, 'scheduleAtFixedRate', `(${RUNNABLE}JJ${UNIT})Ljava/util/concurrent/ScheduledFuture;`, (r, _m, [self, c, init, period, u]) => { if (period <= 0n) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); return scheduled(r, self, c, ms(r, init, u), ms(r, period, u), () => ({ callable: null, runnable: c, state: 'new' })); });
  def(STPE, 'scheduleWithFixedDelay', `(${RUNNABLE}JJ${UNIT})Ljava/util/concurrent/ScheduledFuture;`, (r, _m, [self, c, init, delay, u]) => { if (delay <= 0n) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); return scheduled(r, self, c, ms(r, init, u), -ms(r, delay, u), () => ({ callable: null, runnable: c, state: 'new' })); });
  def(SCHEDULED_TASK, 'getDelay', `(${UNIT})J`, (r, _m, [self, unit]) => BigInt(Math.max(0, Math.round(r.object(self).schedule.due - platform.clock.now()))));

  // ---- Executors -------------------------------------------------------------------------------------------------------------------------------
  const build = (r, core, max, keepMs, queue, factory) => {
    const executor = r.allocate(TPE); configure(r, executor, core, max, BigInt(keepMs), null, queue, factory, null); return executor;
  };
  const linked = r => newObject(r, 'Ljava/util/concurrent/LinkedBlockingQueue;', [], []), synchronous = r => newObject(r, 'Ljava/util/concurrent/SynchronousQueue;', [], []);
  const poolSize = (r, n) => { if (n <= 0) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); return n; };
  def(EXECUTORS, 'newFixedThreadPool', `(I)Ljava/util/concurrent/ExecutorService;`, (r, _m, [n]) => build(r, poolSize(r, n), n, 0, linked(r), null), { static: true });
  def(EXECUTORS, 'newFixedThreadPool', `(I${FACTORY})Ljava/util/concurrent/ExecutorService;`, (r, _m, [n, f]) => build(r, poolSize(r, n), n, 0, linked(r), f), { static: true });
  def(EXECUTORS, 'newSingleThreadExecutor', '()Ljava/util/concurrent/ExecutorService;', r => build(r, 1, 1, 0, linked(r), null), { static: true });
  def(EXECUTORS, 'newSingleThreadExecutor', `(${FACTORY})Ljava/util/concurrent/ExecutorService;`, (r, _m, [f]) => build(r, 1, 1, 0, linked(r), f), { static: true });
  def(EXECUTORS, 'newCachedThreadPool', '()Ljava/util/concurrent/ExecutorService;', r => build(r, 0, 2147483647, 60000, synchronous(r), null), { static: true });
  def(EXECUTORS, 'newCachedThreadPool', `(${FACTORY})Ljava/util/concurrent/ExecutorService;`, (r, _m, [f]) => build(r, 0, 2147483647, 60000, synchronous(r), f), { static: true });
  def(EXECUTORS, 'newScheduledThreadPool', '(I)Ljava/util/concurrent/ScheduledExecutorService;', (r, _m, [n]) => newObject(r, STPE, ['I'], [n]), { static: true });
  def(EXECUTORS, 'newScheduledThreadPool', `(I${FACTORY})Ljava/util/concurrent/ScheduledExecutorService;`, (r, _m, [n, f]) => newObject(r, STPE, ['I', FACTORY], [n, f]), { static: true });
  def(EXECUTORS, 'newSingleThreadScheduledExecutor', '()Ljava/util/concurrent/ScheduledExecutorService;', r => newObject(r, STPE, ['I'], [1]), { static: true });
  def(EXECUTORS, 'newSingleThreadScheduledExecutor', `(${FACTORY})Ljava/util/concurrent/ScheduledExecutorService;`, (r, _m, [f]) => newObject(r, STPE, ['I', FACTORY], [1, f]), { static: true });
  // unconfigurable*: the JDK wraps the executor to hide its configuration methods; here the same pool object is returned (a documented difference: a cast to ThreadPoolExecutor would succeed).
  def(EXECUTORS, 'unconfigurableExecutorService', '(Ljava/util/concurrent/ExecutorService;)Ljava/util/concurrent/ExecutorService;', (r, _m, [e]) => e ?? throwNew(r, 'Ljava/lang/NullPointerException;'), { static: true });
  def(EXECUTORS, 'unconfigurableScheduledExecutorService', '(Ljava/util/concurrent/ScheduledExecutorService;)Ljava/util/concurrent/ScheduledExecutorService;', (r, _m, [e]) => e ?? throwNew(r, 'Ljava/lang/NullPointerException;'), { static: true });
  def(EXECUTORS, 'defaultThreadFactory', `()${FACTORY}`, r => defaultFactory(r), { static: true });
  def(EXECUTORS, 'callable', `(${RUNNABLE}${OBJECT})${CALLABLE}`, (r, _m, [task, result]) => { const c = r.allocate('Ljava/util/concurrent/Executors$RunnableAdapter;'); r.object(c).adapter = { task, result }; return c; }, { static: true });
  type('Ljava/util/concurrent/Executors$RunnableAdapter;', OBJECT, [CALLABLE], { allocatable: true });
  def('Ljava/util/concurrent/Executors$RunnableAdapter;', 'call', `()${OBJECT}`, (r, _m, [self]) => { const a = r.object(self).adapter; vcall(r, a.task, RUNNABLE, 'run', [], 'V'); return a.result; });

  // ---- CountDownLatch --------------------------------------------------------------------------------------------------------------------------
  const LATCH = 'Ljava/util/concurrent/CountDownLatch;'; type(LATCH, OBJECT, [], { allocatable: true });
  def(LATCH, '<init>', '(I)V', (r, _m, [self, n]) => { if (n < 0) throwNew(r, 'Ljava/lang/IllegalArgumentException;', 'count < 0'); r.object(self).latch = { count: n }; });
  def(LATCH, 'countDown', '()V', (r, _m, [self]) => { const l = r.object(self).latch; if (l.count > 0) l.count--; });
  def(LATCH, 'getCount', '()J', (r, _m, [self]) => BigInt(r.object(self).latch.count));
  def(LATCH, 'await', '()V', (r, _m, [self]) => {
    const l = r.object(self).latch; checkInterrupt(r); if (l.count === 0) return undefined;
    return block(r, { reason: 'CountDownLatch.await()', ready: () => l.count === 0, finish: () => { waitInterrupted(r); return undefined; } });
  });
  def(LATCH, 'await', `(J${UNIT})Z`, (r, _m, [self, t, u]) => {
    const l = r.object(self).latch; checkInterrupt(r); if (l.count === 0) return 1;
    return block(r, { reason: 'CountDownLatch.await(timeout)', ready: () => l.count === 0, timeoutMs: Math.max(0, ms(r, t, u)), finish: () => { waitInterrupted(r); return l.count === 0 ? 1 : 0; } });
  });

  // ---- Semaphore: permits are a counter; acquire parks until enough are available (fair semaphores grant in arrival order because parked threads are woken in order). -----------------
  const SEMAPHORE = 'Ljava/util/concurrent/Semaphore;'; type(SEMAPHORE, OBJECT, ['Ljava/io/Serializable;'], { allocatable: true });
  const sem = (r, ref) => r.object(ref).semaphore ?? throwNew(r, 'Ljava/lang/IllegalStateException;', 'Semaphore used before construction');
  def(SEMAPHORE, '<init>', '(I)V', (r, _m, [self, permits]) => { r.object(self).semaphore = { permits, fair: false }; });
  def(SEMAPHORE, '<init>', '(IZ)V', (r, _m, [self, permits, fair]) => { r.object(self).semaphore = { permits, fair: !!fair }; });
  const acquireN = (r, self, n, { interruptible = true, timeoutMs = Infinity, timed = false } = {}) => {
    if (n < 0) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); const s = sem(r, self); if (interruptible) checkInterrupt(r);
    const take = () => { s.permits -= n; return timed ? 1 : undefined; };
    if (s.permits >= n) return take();
    if (timed && timeoutMs <= 0) return 0;
    return block(r, { reason: 'Semaphore.acquire', ready: () => s.permits >= n, timeoutMs, interruptible, finish: () => { if (interruptible) waitInterrupted(r); return s.permits >= n ? take() : timed ? 0 : undefined; } });
  };
  def(SEMAPHORE, 'acquire', '()V', (r, _m, [self]) => acquireN(r, self, 1)); def(SEMAPHORE, 'acquire', '(I)V', (r, _m, [self, n]) => acquireN(r, self, n));
  def(SEMAPHORE, 'acquireUninterruptibly', '()V', (r, _m, [self]) => acquireN(r, self, 1, { interruptible: false })); def(SEMAPHORE, 'acquireUninterruptibly', '(I)V', (r, _m, [self, n]) => acquireN(r, self, n, { interruptible: false }));
  def(SEMAPHORE, 'tryAcquire', '()Z', (r, _m, [self]) => { const s = sem(r, self); if (s.permits >= 1) { s.permits--; return 1; } return 0; });
  def(SEMAPHORE, 'tryAcquire', '(I)Z', (r, _m, [self, n]) => { if (n < 0) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); const s = sem(r, self); if (s.permits >= n) { s.permits -= n; return 1; } return 0; });
  def(SEMAPHORE, 'tryAcquire', `(J${UNIT})Z`, (r, _m, [self, t, u]) => acquireN(r, self, 1, { timed: true, timeoutMs: Math.max(0, ms(r, t, u)) }));
  def(SEMAPHORE, 'tryAcquire', `(IJ${UNIT})Z`, (r, _m, [self, n, t, u]) => acquireN(r, self, n, { timed: true, timeoutMs: Math.max(0, ms(r, t, u)) }));
  def(SEMAPHORE, 'release', '()V', (r, _m, [self]) => { sem(r, self).permits++; }); def(SEMAPHORE, 'release', '(I)V', (r, _m, [self, n]) => { if (n < 0) throwNew(r, 'Ljava/lang/IllegalArgumentException;'); sem(r, self).permits += n; });
  def(SEMAPHORE, 'availablePermits', '()I', (r, _m, [self]) => sem(r, self).permits); def(SEMAPHORE, 'isFair', '()Z', (r, _m, [self]) => sem(r, self).fair ? 1 : 0);
  def(SEMAPHORE, 'drainPermits', '()I', (r, _m, [self]) => { const s = sem(r, self), n = s.permits; s.permits = 0; return n; });
  def(SEMAPHORE, 'hasQueuedThreads', '()Z', () => 0); def(SEMAPHORE, 'getQueueLength', '()I', () => 0);

  // ---- ReentrantLock.newCondition (AbstractQueuedSynchronizer.ConditionObject): await releases the lock fully, parks until signalled (or interrupted / timed out), then
  // reacquires the lock with its previous hold count before returning. The lock state is the ReentrantLock bridge's (obj.lockState: owner thread, holds).
  const CONDITION = 'Ljava/util/concurrent/locks/Condition;', CONDITION_OBJECT = 'Ljava/util/concurrent/locks/AbstractQueuedSynchronizer$ConditionObject;', LOCK_CLASS = 'Ljava/util/concurrent/locks/ReentrantLock;';
  type(CONDITION_OBJECT, OBJECT, [CONDITION], { allocatable: true }); registry.parents.set(CONDITION, OBJECT); registry.interfaces.set(CONDITION, []);
  def(LOCK_CLASS, 'newCondition', `()${CONDITION}`, (r, _m, [lock]) => { const c = r.allocate(CONDITION_OBJECT); r.object(c).condition = { lock: r.object(lock).lockState, waiters: [] }; return c; });
  const conditionAwait = (r, self, { timeoutMs = Infinity, uninterruptible = false, result }) => {
    const c = r.object(self).condition, thread = r.thread ?? r.scheduler.mainThread(), lock = c.lock;
    if (lock.owner !== thread) throwNew(r, 'Ljava/lang/IllegalMonitorStateException;');
    if (!uninterruptible && thread.interrupted) { thread.interrupted = false; throwNew(r, 'Ljava/lang/InterruptedException;'); }
    const waiter = { signalled: false }, holds = lock.holds; c.waiters.push(waiter); lock.owner = null; lock.holds = 0;
    const reacquire = outcome => lock.owner === null ? (lock.owner = thread, lock.holds = holds, outcome()) : new Blocked({ reason: 'Condition.await (reacquiring the lock)', ready: () => lock.owner === null, finish: () => reacquire(outcome) });
    return new Blocked({ reason: 'Condition.await', ready: () => waiter.signalled, interruptible: !uninterruptible, deadline: timeoutMs === Infinity ? Infinity : platform.clock.now() + timeoutMs, finish: timedOut => {
      const index = c.waiters.indexOf(waiter); if (index >= 0) c.waiters.splice(index, 1);
      return reacquire(() => { if (!uninterruptible && !waiter.signalled && thread.interrupted) { thread.interrupted = false; throwNew(r, 'Ljava/lang/InterruptedException;'); } return result(waiter.signalled, timedOut); });
    } });
  };
  def(CONDITION_OBJECT, 'await', '()V', (r, _m, [self]) => conditionAwait(r, self, { result: () => undefined }));
  def(CONDITION_OBJECT, 'awaitUninterruptibly', '()V', (r, _m, [self]) => conditionAwait(r, self, { uninterruptible: true, result: () => undefined }));
  def(CONDITION_OBJECT, 'await', `(J${UNIT})Z`, (r, _m, [self, t, u]) => conditionAwait(r, self, { timeoutMs: Math.max(0, ms(r, t, u)), result: signalled => signalled ? 1 : 0 }));
  def(CONDITION_OBJECT, 'awaitNanos', '(J)J', (r, _m, [self, nanos]) => { const start = platform.clock.now(); return conditionAwait(r, self, { timeoutMs: Math.max(0, Number(nanos) / 1e6), result: () => nanos - BigInt(Math.round((platform.clock.now() - start) * 1e6)) }); });
  def(CONDITION_OBJECT, 'signal', '()V', (r, _m, [self]) => { const c = r.object(self).condition; if (c.lock.owner !== (r.thread ?? r.scheduler.mainThread())) throwNew(r, 'Ljava/lang/IllegalMonitorStateException;'); const w = c.waiters.shift(); if (w) w.signalled = true; });
  def(CONDITION_OBJECT, 'signalAll', '()V', (r, _m, [self]) => { const c = r.object(self).condition; if (c.lock.owner !== (r.thread ?? r.scheduler.mainThread())) throwNew(r, 'Ljava/lang/IllegalMonitorStateException;'); for (const w of c.waiters.splice(0)) w.signalled = true; });

  // ---- AtomicMarkableReference / AtomicStampedReference (a single thread runs at a time, so compare-and-set is a plain compare + assign) ------------------------
  for (const [owner, code, getter] of [['Ljava/util/concurrent/atomic/AtomicMarkableReference;', 'Z', 'isMarked'], ['Ljava/util/concurrent/atomic/AtomicStampedReference;', 'I', 'getStamp']]) {
    type(owner, OBJECT, [], { allocatable: true });
    const a = (r, ref) => r.object(ref).atomic ?? throwNew(r, 'Ljava/lang/IllegalStateException;', 'atomic used before construction');
    const field = code === 'Z' ? 'mark' : 'stamp', norm = v => code === 'Z' ? (v ? 1 : 0) : v | 0;
    def(owner, '<init>', `(${OBJECT}${code})V`, (r, _m, [self, ref, v]) => { r.object(self).atomic = { ref, [field]: norm(v) }; });
    def(owner, 'getReference', `()${OBJECT}`, (r, _m, [self]) => a(r, self).ref); def(owner, getter, `()${code}`, (r, _m, [self]) => a(r, self)[field]);
    def(owner, 'get', `([${code})${OBJECT}`, (r, _m, [self, holder]) => { r.array(holder).elements[0] = a(r, self)[field]; return a(r, self).ref; });
    const same = (x, y) => x === y || (x && y && typeof x === 'object' && typeof y === 'object' && x.ref === y.ref);
    const cas = (r, _m, [self, expected, next, expectedV, nextV]) => { const st = a(r, self); if (same(st.ref, expected) && st[field] === norm(expectedV)) { st.ref = next; st[field] = norm(nextV); return 1; } return 0; };
    def(owner, 'compareAndSet', `(${OBJECT}${OBJECT}${code}${code})Z`, cas); def(owner, 'weakCompareAndSet', `(${OBJECT}${OBJECT}${code}${code})Z`, cas);
    def(owner, 'set', `(${OBJECT}${code})V`, (r, _m, [self, ref, v]) => { const st = a(r, self); st.ref = ref; st[field] = norm(v); });
    def(owner, code === 'Z' ? 'attemptMark' : 'attemptStamp', `(${OBJECT}${code})Z`, (r, _m, [self, expected, v]) => { const st = a(r, self); if (!same(st.ref, expected)) return 0; st[field] = norm(v); return 1; });
  }

  // ---- type bookkeeping for interfaces implemented by host types ----------------------------------------------------------------------------------
  const hierarchy = { 'Ljava/util/concurrent/Executor;': [], 'Ljava/util/concurrent/ExecutorService;': ['Ljava/util/concurrent/Executor;'], 'Ljava/util/concurrent/ScheduledExecutorService;': ['Ljava/util/concurrent/ExecutorService;'],
    'Ljava/util/concurrent/RunnableFuture;': [RUNNABLE, FUTURE], 'Ljava/util/concurrent/Delayed;': ['Ljava/lang/Comparable;'], 'Ljava/util/concurrent/ScheduledFuture;': ['Ljava/util/concurrent/Delayed;', FUTURE], 'Ljava/util/concurrent/RunnableScheduledFuture;': ['Ljava/util/concurrent/RunnableFuture;', 'Ljava/util/concurrent/ScheduledFuture;'],
    'Ljava/util/concurrent/AbstractExecutorService;': ['Ljava/util/concurrent/ExecutorService;'], 'Ljava/util/Queue;': [COLLECTION], [QUEUE]: ['Ljava/util/Queue;'], 'Ljava/util/concurrent/BlockingDeque;': [QUEUE] };
  for (const [iface, parents] of Object.entries(hierarchy)) { if (!registry.parents.has(iface)) registry.parents.set(iface, OBJECT); registry.interfaces.set(iface, parents); }
  registry.interfaces.set(TPE, ['Ljava/util/concurrent/ExecutorService;', 'Ljava/util/concurrent/Executor;']);
  // ---- android.os.Looper on non-main threads (HandlerThread, Looper.prepare()/loop()). The main Looper is the platform event queue; another thread's Looper owns a message queue of its
  // own (Looper object .looperQueue, filled by Handler.enqueue) that its thread drains inside Looper.loop(): the thread parks until the first message is due, dispatches it as an
  // ordinary Java call, and continues. quit() drops everything pending; quitSafely() lets the messages that are already due run first. ---------------------------------------------
  const LOOPER = 'Landroid/os/Looper;', HANDLER_CLASS = 'Landroid/os/Handler;', MESSAGE = 'Landroid/os/Message;';
  type(LOOPER, OBJECT);
  const prepare = r => {
    const thread = r.thread ?? r.scheduler.mainThread();
    if (thread === r.scheduler.main) throw new APKError('Looper.prepare() on the main thread: its Looper already exists', { kind: 'looper-main' });
    if (thread.looper) r.throwJava('Ljava/lang/RuntimeException;', 'Only one Looper may be created per thread');
    const looper = r.makeObject(LOOPER); Object.assign(r.object(looper), { looperQueue: [], thread, quitting: false, safeQuit: false });
    thread.looper = looper;
  };
  // Activity.runOnUiThread (android-13.0.0_r1 Activity.java): run now when already on the UI thread, otherwise post to the main Looper's Handler.
  def('Landroid/app/Activity;', 'runOnUiThread', `(${RUNNABLE})V`, (r, _m, [, action]) => {
    if (action === null) throwNew(r, 'Ljava/lang/NullPointerException;');
    if ((r.thread ?? r.scheduler.mainThread()) === r.scheduler.main) return vcall(r, action, RUNNABLE, 'run', [], 'V');
    const handler = r.allocate(HANDLER_CLASS), looper = scall(r, LOOPER, 'getMainLooper', [], LOOPER);
    r.dispatch({ owner: HANDLER_CLASS, name: '<init>', parameters: [LOOPER], result: 'V', signature: `(${LOOPER})V` }, [handler, looper], 'direct');
    vcall(r, handler, HANDLER_CLASS, 'post', [RUNNABLE], 'Z', [action]);
  });
  def(LOOPER, 'prepare', '()V', prepare, { static: true }); def(LOOPER, 'prepare', '(Z)V', prepare, { static: true });
  const dueFirst = looper => { const queue = looper.looperQueue; return queue.length && (queue[0].front || queue[0].when <= platform.clock.now()) ? queue[0] : null; };
  def(LOOPER, 'loop', '()V', r => {
    const thread = r.thread, looper = thread?.looper;
    if (!looper) r.throwJava('Ljava/lang/RuntimeException;', "No Looper; Looper.prepare() wasn't called on this thread.");
    const state = r.object(looper);
    const step = () => {
      const event = dueFirst(state);
      if (event) {
        state.looperQueue.shift(); const message = r.object(event.message);
        const done = () => { message.inUse = false; message.recycled = true; };
        return new Invoke({ owner: HANDLER_CLASS, name: 'dispatchMessage', parameters: [MESSAGE], result: 'V', signature: `(${MESSAGE})V` }, [event.handler, event.message], 'virtual', () => { done(); return step(); }, error => { done(); throw error; });
      }
      if (state.quitting && (!state.safeQuit || !state.looperQueue.length)) { state.looperQueue.length = 0; return undefined; }          // loop() returns once the queue is quit
      return new Blocked({ ready: () => state.quitting || dueFirst(state) !== null, deadline: state.looperQueue.length ? Math.min(...state.looperQueue.map(item => item.when)) : Infinity, reason: 'Looper.loop', roots: [looper], finish: () => step() });
    };
    return step();
  }, { static: true });
  def(LOOPER, 'quit', '()V', (r, _m, [self]) => { const state = r.object(self); if (state === r.object(r.mainLooper ?? self) && !state.looperQueue) r.throwJava('Ljava/lang/IllegalStateException;', 'Main thread not allowed to quit.'); state.quitting = true; state.safeQuit = false; for (const event of state.looperQueue) { const message = r.object(event.message); message.inUse = false; message.recycled = true; } state.looperQueue.length = 0; platform.onExternalActivity?.(); });
  def(LOOPER, 'quitSafely', '()V', (r, _m, [self]) => { const state = r.object(self); if (!state.looperQueue) r.throwJava('Ljava/lang/IllegalStateException;', 'Main thread not allowed to quit.'); state.quitting = true; state.safeQuit = true; platform.onExternalActivity?.(); });
  def(LOOPER, 'getQueue', '()Landroid/os/MessageQueue;', () => { throw new APKError('Looper.getQueue(): MessageQueue is not modelled (use Handler.hasMessages / removeCallbacks)', { kind: 'messagequeue-unsupported' }); });
  return { ...registry, interfaces: registry.interfacesOf, helpUntil, currentThread, mainThread, [GC_ROOTS](visit) { for (const hook of shutdownHooks.values()) visit(hook); } };
}
