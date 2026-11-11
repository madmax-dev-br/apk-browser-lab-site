import { Blocked } from './scheduler.js?v=346cde125f88';

// Native methods of the original android.os.MessageQueue (frameworks/base/core/jni/android_os_MessageQueue.cpp, android-13.0.0_r1), bound to the VM scheduler.
//
// The C++ NativeMessageQueue wraps a native Looper (system/core/libutils/Looper.cpp) whose poll is an epoll_wait on a wake eventfd plus the descriptors registered with
// nativeSetFileDescriptorEvents. Only the part MessageQueue.java uses is reproduced, with the same control flow:
//   nativeInit      new NativeMessageQueue(): a poller with a wake eventfd that is not readable; the pointer handed to Java is the key of that poller
//   nativeWake      Looper::wake(): the eventfd becomes readable (writing to it again before it is read changes nothing)
//   nativePollOnce  Looper::pollOnce(timeoutMillis): epoll_wait. A readable eventfd ends the wait at once and is drained (awoken()); timeout 0 never waits, a negative timeout waits for
//                   a wake only, a positive one for a wake or for that many milliseconds of the VM clock (clock.now(), the clock SystemClock.uptimeMillis reads)
//   nativeIsPolling Looper::isPolling(): true while the thread is inside epoll_wait
//   nativeDestroy   releases the poller
// "Inside epoll_wait" is a parked Java thread: the native returns a Blocked, the scheduler runs the other threads and skips the virtual clock to the deadline when all of them wait.
// The main thread is the one exception in mechanics, not in meaning: it is driven by the Worker's host event loop (see looper-host.js), so a main-thread poll that has to wait ends the
// call with a LooperYield, which unwinds the Java frames of that call and returns control to the host event loop; the loop re-enters MessageQueue.next() when the wake or the deadline
// arrives (the message that ended the wait is found by the first iteration of next()).
const QUEUE = 'Landroid/os/MessageQueue;';

/** Control-flow signal, not an error: the main thread's MessageQueue.next() has nothing to do and returns control to the host event loop. Recognised by the interpreter (it passes through every frame untouched). */
export class LooperYield {
  constructor(state) { this.looperYield = true; this.vmFatal = false; this.queue = state; }
}

export function createMessageQueueNativeBindings() {
  const bindings = new Map();
  const bind = (name, signature, fn) => bindings.set(`${QUEUE}->${name}${signature}`, fn);
  const host = runtime => runtime.platform.looperHost;

  bind('nativeInit', '()J', runtime => host(runtime).createPoller(runtime.thread ?? runtime.scheduler.mainThread()));
  bind('nativeDestroy', '(J)V', (runtime, [ptr]) => { host(runtime).destroyPoller(ptr); });
  bind('nativeWake', '(J)V', (runtime, [ptr]) => {
    const poller = host(runtime).poller(runtime, ptr);
    poller.awoken = true;
    // A wake from outside the thread that polls (another Java thread posting to the main queue) must reach the host event loop, which may be waiting on a timer for something else.
    if (poller.thread === runtime.scheduler.main && (runtime.thread ?? runtime.scheduler.mainThread()) !== poller.thread) runtime.platform.onExternalActivity?.();
  });
  bind('nativeIsPolling', '(J)Z', (runtime, [ptr]) => host(runtime).poller(runtime, ptr).polling);
  bind('nativePollOnce', '(JI)V', (runtime, [, ptr, timeoutMillis]) => {
    const poller = host(runtime).poller(runtime, ptr), scheduler = runtime.scheduler;
    poller.polling = false;
    if (poller.awoken) { poller.awoken = false; return undefined; }   // Looper::pollInner: the readable wake eventfd is drained and the poll returns
    if (timeoutMillis === 0) return undefined;                         // pollOnce(0) is a non-blocking check
    const thread = runtime.thread ?? scheduler.mainThread(), deadline = timeoutMillis < 0 ? Infinity : runtime.platform.clock.now() + timeoutMillis;
    poller.polling = true; poller.deadline = deadline;
    if (thread === scheduler.main) throw new LooperYield(poller);
    return new Blocked({
      ready: () => poller.awoken, deadline, reason: 'MessageQueue.next (nativePollOnce)',
      finish: () => { poller.polling = false; poller.awoken = false; return undefined; },
    });
  });
  bind('nativeSetFileDescriptorEvents', '(JII)V', runtime => {
    runtime.throwJava('Ljava/lang/UnsupportedOperationException;', 'MessageQueue.nativeSetFileDescriptorEvents: file descriptor event listeners need a pollable descriptor table, which the VM does not have');
  });
  return bindings;
}
