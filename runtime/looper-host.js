import { createHostRegistry } from './host-contract.js?v=5fccdbc9ed78';
import { GC_ROOTS } from './heap-gc.js?v=5fccdbc9ed78';
import { LooperYield } from './message-queue-native.js?v=5fccdbc9ed78';
import { APKError } from './apk-error.js?v=5fccdbc9ed78';

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
const LOOP_ONCE = `${LOOPER}->loopOnce(${LOOPER}JI)Z`;   // the call of loopOnce below that may suspend (vmcore/js/host-bridge.js suspendable)
const key = (owner, name, type) => `${owner}->${name}:${type}`;
const K = {
  messages: key(QUEUE, 'mMessages', MESSAGE), target: key(MESSAGE, 'target', HANDLER), callback: key(MESSAGE, 'callback', RUNNABLE), next: key(MESSAGE, 'next', MESSAGE),
  when: key(MESSAGE, 'when', 'J'), flags: key(MESSAGE, 'flags', 'I'), queue: key(LOOPER, 'mQueue', QUEUE),
};
const isNull = value => value === null || value === undefined || value === 0;
/**
 * A host task that may run while main is parked (see nextDueWhileParked): the lab's own work (a network result, a service answer, a timer). App work for the main thread that the
 * lab also queues as host tasks is not: a layout pass or the window's draw (ui), a Choreographer frame (windowFrameTime) and a View.post Runnable (windowCallback) run only once
 * main is back in its Looper.
 */
export const hostOnly = event => !!event.platformTask && !event.ui && event.windowFrameTime === undefined && event.windowCallback === undefined;

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

  // The lab has one main Looper for every installed package, where a device has one per process. While the main thread is parked (a Java wait inside the message it dispatches) the
  // messages that a companion package's own code posted to it -- that package's main thread, as in a process of its own -- may run: a Handler message whose Runnable (or Handler) is
  // code of a companion package other than the one that owns the message being dispatched. A callee that waits for an answer that its own main Looper delivers (Volley's
  // ExecutorDelivery) across a Binder call from another package would otherwise wait for the main thread that is blocked in that very call. Single-package apps are not affected
  // (no companions: the predicate is false), and the app's own messages never run this way.
  const messageOwner = (runtime, message) => {
    const registry = platform.packages;
    if (!registry?.multi || isNull(message)) return null;
    const callback = host.callbackOf(runtime, message), receiver = callback !== null ? callback : get(runtime, message, K.target);
    return isNull(receiver) ? null : registry.entryOfClass(runtime, runtime.typeOf(receiver));
  };
  let dispatching = null;   // the package that owns the message the main thread is dispatching now (null: the app's or the platform's own)
  let suspendedOwner = null;   // the same, for a message whose run is suspended (loopOnce): main is still dispatching it
  const otherProcess = runtime => {
    if (!platform.packages?.multi) return () => false;
    const current = dispatching ?? suspendedOwner;
    return candidate => {
      if (candidate.platformTask || candidate.message === undefined || isNull(candidate.message)) return false;
      const owner = messageOwner(runtime, candidate.message);
      return !!owner && !owner.main && owner !== current;
    };
  };
  // A query that only returns numbers reads queued messages through handles; on the WebAssembly core every handle made while host code runs is pinned until that host call
  // returns, and these queries run again and again inside one long call while main is parked. Nothing they read outlives them, so their pins are dropped when they return.
  const transient = (runtime, query) => { const pins = runtime?.wasm?.pins, mark = pins?.length; try { return query(); } finally { if (pins && pins.length > mark) pins.length = mark; } };
  /** Takes `message` out of the main queue's list (mMessages / Message.next), as MessageQueue.next() does with the message it returns; false when it is not queued. */
  const unlink = (runtime, message) => {
    const queue = runtime.object(main.queue).fields, head = queue.get(K.messages);
    if (head === message) { runtime.storeField(queue, K.messages, get(runtime, message, K.next) ?? null); runtime.storeField(runtime.object(message).fields, K.next, null); return true; }
    for (let previous = head, guard = 0; !isNull(previous) && guard < 200000; guard++) {
      const next = get(runtime, previous, K.next);
      if (next === message) { runtime.storeField(runtime.object(previous).fields, K.next, get(runtime, message, K.next) ?? null); runtime.storeField(runtime.object(message).fields, K.next, null); return true; }
      previous = next;
    }
    return false;
  };
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
    /**
     * MessageQueue.next() for one given message: unlinked from the main queue (mMessages / next) and marked in use, under the queue's monitor. false when another thread holds that
     * monitor (it is inside enqueueMessage or removeMessages: the list is not to be touched now) or the message is no longer queued.
     */
    takeMessage(runtime, message) {
      const queue = main?.queue; if (!queue || !runtime.monitorTryEnter(queue)) return false;
      try {
        const id = ref => runtime.object(ref).id, wanted = id(message);
        let previous = null;
        for (let at = get(runtime, queue, K.messages), guard = 0; !isNull(at) && guard < 200000; previous = at, at = get(runtime, at, K.next), guard++) {
          if (id(at) !== wanted) continue;
          const next = get(runtime, at, K.next);
          runtime.object(previous === null ? queue : previous).fields.set(previous === null ? K.messages : K.next, isNull(next) ? null : next);
          runtime.object(at).fields.set(K.next, null);
          call(runtime, MESSAGE, 'markInUse', [], 'V', [], at);
          return true;
        }
        return false;
      } finally { runtime.monitorExit(queue); }
    },
    callbackOf(runtime, message) { const callback = get(runtime, message, K.callback); return isNull(callback) ? null : callback; },
    /** Takes `message` out of the main queue's list (what MessageQueue.next() does with the message it hands out); false when it is no longer queued. */
    unlink(runtime, message) {
      if (main === null) return false;
      const same = (a, b) => a === b || (!isNull(a) && !isNull(b) && typeof a === 'object' && typeof b === 'object' && a.ref === b.ref);
      let previous = null, current = get(runtime, main.queue, K.messages);
      while (!isNull(current) && !same(current, message)) { previous = current; current = get(runtime, current, K.next); }
      if (isNull(current)) return false;
      const next = get(runtime, current, K.next), rest = isNull(next) ? null : next;
      runtime.storeField(runtime.object(previous === null ? main.queue : previous).fields, previous === null ? K.messages : K.next, rest);
      runtime.storeField(runtime.object(current).fields, K.next, null);
      return true;
    },
    whatOf(runtime, message) { return get(runtime, message, key(MESSAGE, 'what', 'I')) ?? 0; },
    /** Every queued message, in queue order. */
    snapshot(runtime) {
      const out = [];
      if (main === null || !runtime) return out;
      for (let message = get(runtime, main.queue, K.messages), guard = 0; !isNull(message) && guard < 200000; message = get(runtime, message, K.next), guard++) out.push(host.view(runtime, message));
      return out;
    },
    count(runtime) { return transient(runtime, () => host.snapshot(runtime).length + deferred.length); },
    /** Milliseconds until the queue has something to deliver: 0 if due now, null if it is empty (or only held back by a sync barrier). */
    nextDelay(now) {
      if (deferred.length) return 0;
      const runtime = platform.vmRuntime;
      return transient(runtime, () => {
        const message = runtime ? host.peek(runtime) : null;
        if (message === null) return null;
        const when = Number(get(runtime, message, K.when));
        return when <= uptime(now) ? 0 : when - now;
      });
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
    /**
     * The next event that may run while the main thread is parked in a Java wait (a monitor, a class another thread initializes, Future.get, a latch): only a due host task that
     * is not UI work ({ event, direct: true }). On a device a blocked main thread runs nothing: its Handler messages, its frames and its traversals wait for it to return to the
     * Looper. The lab keeps its own host tasks flowing (they stand for what other processes and threads do on a device: a network result, a service answer, a timer), because
     * the thread main waits for may need one; app work queued for the main thread is not among them.
     */
    nextDueWhileParked(runtime, now) {
      const limit = uptime(now), other = otherProcess(runtime);
      // found with the pins of the walk dropped (see transient), then the one message it returns read again, so only what the caller keeps stays pinned
      const index = transient(runtime, () => { let i = 0; for (const candidate of host.snapshot(runtime)) { const when = candidate.messageWhen ?? candidate.when; if (when > limit) return -1; if (hostOnly(candidate) || other(candidate)) return i; i++; } return -1; });
      if (index < 0) return null;
      let message = get(runtime, main.queue, K.messages); for (let i = 0; i < index && !isNull(message); i++) message = get(runtime, message, K.next);
      return isNull(message) ? null : { event: host.view(runtime, message), direct: true };
    },
    /** Milliseconds until the first host task that may run while main is parked (see nextDueWhileParked): 0 when one is due, null when none is queued. */
    nextDelayWhileParked(runtime, now) {
      return transient(runtime, () => {
        const limit = uptime(now);
        const other = otherProcess(runtime);
        for (const candidate of host.snapshot(runtime)) { if (!hostOnly(candidate) && !other(candidate)) continue; const when = candidate.messageWhen ?? candidate.when; return when <= limit ? 0 : when - now; }
        return null;
      });
    },
    // ---- running ----
    /** One iteration of Looper.loop(): MessageQueue.next() (which runs the IdleHandlers and, with nothing due, ends the call with a LooperYield), dispatchMessage, recycleUnchecked. */
    loopOnce(runtime) {
      const { looper, ident } = main, outer = dispatching, owner = platform.packages?.multi ? messageOwner(runtime, host.peek(runtime)) : null;
      dispatching = owner;
      const settle = outcome => {
        if (!('error' in outcome)) { host.armed = true; return outcome.value; }
        if (outcome.error?.looperYield !== true) throw outcome.error;
        runtime.hostCall = null; host.armed = false;   // the thread is blocked in the poll: next() is only entered again for a message that is due
        return false;
      };
      const once = () => call(runtime, LOOPER, 'loopOnce', [LOOPER, 'J', 'I'], 'Z', [looper, ident, 0]);
      try {
        // On the WebAssembly core the message may suspend at the top of the pump (vmcore/js/host-bridge.js suspendable): a main thread that waits there for the network
        // keeps its frames parked while the pump returns to the browser's event loop; `settle` then runs when the pump resumes it and it ends (with `owner` dispatching again).
        const engine = runtime.nestedRuns === 0 && !runtime.diagnosticDepth ? runtime.wasm : null;
        if (engine?.suspendable) {
          const ran = engine.suspendable(LOOP_ONCE, once, outcome => { const previous = dispatching; dispatching = owner; suspendedOwner = null; try { return settle(outcome); } finally { dispatching = previous; } });
          if (ran.suspended) { suspendedOwner = owner; return false; }
          return settle({ value: ran.value });
        }
        return settle({ value: once() });
      } catch (error) { return settle({ error }); }
      finally { dispatching = outer; }
    },
    /** Runs a queued host event ahead of the queue order (see nextDue): it is taken out of the queue and its Runnable called, as dispatchMessage would. */
    runDirect(runtime, event) {
      if (event.task === undefined && event.message !== undefined) {   // an ordinary Handler message of another process's main thread (otherProcess): its Runnable runs, as dispatchMessage would
        const callback = host.callbackOf(runtime, event.message), outer = dispatching;
        if (callback === null && !host.takeMessage(runtime, event.message)) return;   // a message without a Runnable: taken out of the queue as next() takes it (not now if another thread is inside the queue)
        dispatching = messageOwner(runtime, event.message);
        try {
          if (callback === null) {   // Looper.loopOnce: target.dispatchMessage(msg) (handleMessage, or the Handler's Callback), then recycleUnchecked
            call(runtime, HANDLER, 'dispatchMessage', [MESSAGE], 'V', [event.message], event.handler);
            call(runtime, MESSAGE, 'recycleUnchecked', [], 'V', [], event.message);
            return;
          }
          call(runtime, HANDLER, 'removeCallbacks', [RUNNABLE], 'V', [callback], event.handler);
          call(runtime, RUNNABLE, 'run', [], 'V', [], callback);
        } finally { dispatching = outer; }
        return;
      }
      call(runtime, HANDLER, 'removeCallbacks', [RUNNABLE], 'V', [event.task], main.handler);
      call(runtime, RUNNABLE, 'run', [], 'V', [], event.task);
    },
    [GC_ROOTS](visit) { if (main !== null) { visit(main.looper); visit(main.queue); visit(main.handler); } for (const event of pending) visit(event); for (const entry of deferred) visit(entry.event); },
  };
  return host;
}
