import { createHostRegistry } from './host-contract.js?v=2f0501505dc8';
import { GC_ROOTS } from './heap-gc.js?v=2f0501505dc8';
import { LooperYield } from './message-queue-native.js?v=2f0501505dc8';
import { APKError } from './apk-error.js?v=2f0501505dc8';

// The main thread's Looper, MessageQueue, Handler and Message are the original android-13.0.0_r1 classes in framework.dex. This file is what surrounds them on the host side.
//
// How the main thread runs. The Worker's host event loop is the body of the main thread (it always was: lifecycle callbacks, clicks and frames are Java calls made from host code on the main
// thread). Looper.loop() is not run there; each iteration of its loop -- the private Looper.loopOnce(Looper, long, int), which is the original body of loop() -- is called by the pump
// (AndroidPlatform.drainEvents) whenever the original queue has something due, and once more when the thread would go idle so that MessageQueue.next() runs its IdleHandlers. When
// next() has nothing to do it calls nativePollOnce with a timeout; the main thread cannot park inside it (the Worker has to get back to its own event loop to serve the page, timers and
// the network), so message-queue-native.js ends that call with a LooperYield, the Java frames of the call are unwound and control returns here. The state left behind is exactly that of a
// thread blocked in epoll_wait (mBlocked is set, nativeIsPolling is true). Every other thread (HandlerThread, Looper.prepare()/loop() in app code) runs the original Looper.loop() as an
// ordinary green thread and parks in nativePollOnce through the scheduler.
//
// Why not Looper.loop() as the main thread's body (ActivityThread style): the main thread has no persistent Java frames in this VM. Host events are nested calls on it, and its watchdog
// (operation-monitor), sampling profiler, per-event budgets, clock freezing for Choreographer frames and fairness against background threads are all per event; a Looper.loop() that never
// returns would move every one of them inside a single endless Java call.
//
// Host events (a click, a frame, a platform timer, a network completion) become Messages of the main queue: the Runnable of each is a HostTask whose run() calls the JavaScript closure.
// They are sent through Handler.sendMessageAtTime like any other message and ordered by the original MessageQueue; frame and UI work is asynchronous, as ViewRootImpl's is, so it passes
// sync barriers.
const OBJECT = 'Ljava/lang/Object;', RUNNABLE = 'Ljava/lang/Runnable;', HOST_TASK = 'Lapkweb/bridge/HostTask;';
const LOOPER = 'Landroid/os/Looper;', QUEUE = 'Landroid/os/MessageQueue;', HANDLER = 'Landroid/os/Handler;', MESSAGE = 'Landroid/os/Message;';
const MESSAGES_LIMIT = 1024, FLAG_ASYNCHRONOUS = 2;
const key = (owner, name, type) => `${owner}->${name}:${type}`;
const K = {
  messages: key(QUEUE, 'mMessages', MESSAGE), target: key(MESSAGE, 'target', HANDLER), callback: key(MESSAGE, 'callback', RUNNABLE), next: key(MESSAGE, 'next', MESSAGE),
  when: key(MESSAGE, 'when', 'J'), flags: key(MESSAGE, 'flags', 'I'), queue: key(LOOPER, 'mQueue', QUEUE),
};
const isNull = value => value === null || value === undefined || value === 0;

export function createLooperHost(platform) {
  const registry = createHostRegistry(), { type, def } = registry;
  type(HOST_TASK, OBJECT, [RUNNABLE], { allocatable: true });
  const pending = new Set();   // the host events currently in the main queue (JavaScript records: closure, roots, metadata)
  def(HOST_TASK, 'run', '()V', (r, _m, [self]) => { const event = r.object(self).event; pending.delete(event); return event.platformTask(); });

  const pollers = new Map();
  let nextPointer = 1n, main = null, starting = false, deferred = [];
  const get = (runtime, ref, fieldKey) => runtime.object(ref).fields.get(fieldKey);
  const call = (runtime, owner, name, parameters, result, args, receiver) => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` },
    runtime.argumentWords(parameters, args, receiver === undefined ? {} : { receiver }), receiver === undefined ? 'static' : 'virtual');
  const uptime = now => Math.floor(now);   // SystemClock.uptimeMillis()

  const host = {
    ...registry, interfaces: registry.interfacesOf,
    armed: true,
    // ---- the native half of MessageQueue (message-queue-native.js) ----
    createPoller(thread) { const pointer = nextPointer++; pollers.set(pointer, { awoken: false, polling: false, thread, deadline: Infinity }); return pointer; },
    destroyPoller(pointer) { pollers.delete(pointer); },
    poller(runtime, pointer) {
      const poller = pollers.get(pointer);
      if (poller === undefined) runtime.throwJava('Ljava/lang/IllegalStateException;', `MessageQueue native pointer ${pointer} is not a live NativeMessageQueue (already disposed)`);
      return poller;
    },
    // ---- the main Looper ----
    /** Process start (ActivityThread.main): Looper.prepareMainLooper() on the main thread, plus the Handler the host posts its events with. Idempotent. */
    /** Called before the first Java call of a process: ActivityThread.main() has prepared the main Looper before any component runs (a runtime without the framework DEX has no Looper to prepare). */
    autoStart(runtime) { if (main === null && !starting && runtime.classes.has(LOOPER)) host.ensureMain(runtime); },
    ensureMain(runtime) {
      if (main !== null) return main;
      if (starting) throw new APKError('The main Looper is being prepared: Java code that needs it cannot run yet', { kind: 'looper-starting' });
      starting = true; platform.vmRuntime ??= runtime;
      const scheduler = runtime.scheduler, previous = runtime.thread, muted = runtime.traceMuted;
      runtime.thread = scheduler.mainThread(); runtime.traceMuted = true;   // process-start plumbing must not evict the APK-visible head of the trace
      try {
        call(runtime, LOOPER, 'prepareMainLooper', [], 'V', []);
        const looper = call(runtime, LOOPER, 'getMainLooper', [], LOOPER, []), handler = runtime.allocate(HANDLER);
        runtime.dispatch({ owner: HANDLER, name: '<init>', parameters: [LOOPER], result: 'V', signature: `(${LOOPER})V` }, [handler, looper], 'direct');
        main = { looper, queue: get(runtime, looper, K.queue), handler, ident: call(runtime, 'Landroid/os/Binder;', 'clearCallingIdentity', [], 'J', []) };
        host.flushDeferred(runtime);
      } finally { starting = false; runtime.thread = previous; runtime.traceMuted = muted; }
      return main;
    },
    started: () => main !== null,
    mainLooper(runtime) { return host.ensureMain(runtime).looper; },
    mainHandler(runtime) { return host.ensureMain(runtime).handler; },
    /** A host event ran Java code on the main thread outside the queue (a lifecycle callback): the Looper thread would be back in MessageQueue.next() afterwards, which runs the IdleHandlers once. */
    hostEventRan(runtime) { if (main !== null && !runtime.diagnosticDepth) host.armed = true; },

    // ---- host events as messages ----
    /** Sends `event` ({platformTask, roots?, ui?, windowFrameTime?, ...}) to the main queue at uptime `when` (ms, absolute). Asynchronous messages (UI and frame work) pass sync barriers. */
    postAt(runtime, event, when, { asynchronous = false } = {}) {
      if (pending.size >= MESSAGES_LIMIT) throw new APKError('Framework event queue exceeds 1024', { kind: 'messagequeue-limit' });
      const { handler } = host.ensureMain(runtime), task = runtime.allocate(HOST_TASK);
      runtime.object(task).event = event; event.task = task; event.when ??= when;
      const message = call(runtime, MESSAGE, 'obtain', [HANDLER, RUNNABLE], MESSAGE, [handler, task]);
      if (asynchronous) call(runtime, MESSAGE, 'setAsynchronous', ['Z'], 'V', [1], message);
      pending.add(event);
      try { call(runtime, HANDLER, 'sendMessageAtTime', [MESSAGE, 'J'], 'Z', [message, BigInt(when)], handler); }
      catch (error) { pending.delete(event); throw error; }
    },
    /** Same, for a host event that must not touch Java now (a collection is running, or no runtime exists yet): it is sent at the next pump. */
    defer(event, delay) { deferred.push({ event, delay, since: platform.clock.now() }); },
    flushDeferred(runtime) {
      if (main === null || deferred.length === 0) return;
      const list = deferred; deferred = [];
      for (const { event, delay, since } of list) host.postAt(runtime, event, delay > 0 ? Math.ceil(since + delay) : uptime(since), { asynchronous: !!(event.ui || event.windowFrameTime !== undefined) });
    },
    /** Removes the pending host events `matches(event)` accepts (Handler.removeCallbacks of their Runnable). */
    cancel(runtime, matches) {
      for (const event of [...pending]) if (matches(event)) { pending.delete(event); call(runtime, HANDLER, 'removeCallbacks', [RUNNABLE], 'V', [event.task], main.handler); }
      deferred = deferred.filter(entry => !matches(entry.event));
    },
    pendingEvents: () => pending,

    // ---- reading the queue (the selection MessageQueue.next() makes, without taking anything) ----
    /** The message next() would hand out first: the head, or with a sync barrier at the head the first asynchronous message behind it. null when there is none. */
    peek(runtime) {
      if (main === null) return null;
      let message = get(runtime, main.queue, K.messages);
      if (isNull(message)) return null;
      if (isNull(get(runtime, message, K.target))) {
        do { message = get(runtime, message, K.next); } while (!isNull(message) && !((get(runtime, message, K.flags) ?? 0) & FLAG_ASYNCHRONOUS));
        if (isNull(message)) return null;
      }
      return message;
    },
    /** A diagnostic view of one queued message: the JavaScript record of a host event, or { when, handler, message } for an ordinary Handler message. */
    view(runtime, message) {
      const target = get(runtime, message, K.target), callback = get(runtime, message, K.callback), when = Number(get(runtime, message, K.when) ?? 0n);
      const event = isNull(callback) ? undefined : runtime.object(callback).event;
      if (event !== undefined) { event.handler = target; event.message = message; event.messageWhen = when; return event; }   // event.when stays the exact time the host asked for; the queue orders by the whole millisecond (Message.when)
      return { when, front: when === 0, handler: isNull(target) ? null : target, message, barrier: isNull(target) };
    },
    callbackOf(runtime, message) { const callback = get(runtime, message, K.callback); return isNull(callback) ? null : callback; },
    whatOf(runtime, message) { return get(runtime, message, key(MESSAGE, 'what', 'I')) ?? 0; },
    /** Every queued message, in queue order. */
    snapshot(runtime) {
      const out = [];
      if (main === null || !runtime) return out;
      for (let message = get(runtime, main.queue, K.messages), guard = 0; !isNull(message) && guard < 200000; message = get(runtime, message, K.next), guard++) out.push(host.view(runtime, message));
      return out;
    },
    count(runtime) { return host.snapshot(runtime).length + deferred.length; },
    /** Milliseconds until the queue has something to deliver: 0 if due now, null if it is empty (or only held back by a sync barrier). */
    nextDelay(now) {
      if (deferred.length) return 0;
      const runtime = platform.vmRuntime, message = runtime ? host.peek(runtime) : null;
      if (message === null) return null;
      const when = Number(get(runtime, message, K.when));
      return when <= uptime(now) ? 0 : when - now;
    },
    /**
     * The next event the pump should run at `now`: the due head ({ event }), or -- once the head is overdue by more than `behindMs`, a flood -- a due UI event queued behind it
     * ({ event, direct: true }: ViewRootImpl's traversal and frame run before ordinary work). null when nothing is due.
     */
    nextDue(runtime, now, behindMs) {
      const message = host.peek(runtime);
      if (message === null) return null;
      const limit = uptime(now), when = Number(get(runtime, message, K.when));
      if (when > limit) return null;
      const event = host.view(runtime, message);
      if (!event.ui && when < now - behindMs) for (const candidate of host.snapshot(runtime)) if (candidate.ui && candidate.messageWhen <= limit) return { event: candidate, direct: true };
      return { event, direct: false };
    },
    // ---- running ----
    /** One iteration of Looper.loop(): MessageQueue.next() (which runs the IdleHandlers and, with nothing due, ends the call with a LooperYield), dispatchMessage, recycleUnchecked. */
    loopOnce(runtime) {
      const { looper, ident } = main;
      try { const more = call(runtime, LOOPER, 'loopOnce', [LOOPER, 'J', 'I'], 'Z', [looper, ident, 0]); host.armed = true; return more; }
      catch (error) {
        if (error?.looperYield !== true) throw error;
        runtime.hostCall = null; host.armed = false;   // the thread is blocked in the poll: next() is only entered again for a message that is due
        return false;
      }
    },
    /** Runs a queued host event ahead of the queue order (see nextDue): it is taken out of the queue and its Runnable called, as dispatchMessage would. */
    runDirect(runtime, event) {
      call(runtime, HANDLER, 'removeCallbacks', [RUNNABLE], 'V', [event.task], main.handler);
      call(runtime, RUNNABLE, 'run', [], 'V', [], event.task);
    },
    [GC_ROOTS](visit) { if (main !== null) { visit(main.looper); visit(main.queue); visit(main.handler); } for (const event of pending) visit(event); for (const entry of deferred) visit(entry.event); },
  };
  return host;
}
