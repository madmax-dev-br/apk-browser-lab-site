// Interval timers and POSIX timers of an ARM64 process (the app's and a forked child), on the VM clock:
//   alarm(seconds)                                   ITIMER_REAL in whole seconds: SIGALRM when it expires; the previous timer's remaining seconds, rounded up
//   setitimer / getitimer(ITIMER_REAL)              struct itimerval { it_interval, it_value } of struct timeval; ITIMER_VIRTUAL and ITIMER_PROF count the process's CPU time,
//                                                    which the lab does not measure, and fail with EINVAL naming them in the trace
//   timer_create / timer_settime / timer_gettime / timer_getoverrun / timer_delete
//                                                    CLOCK_REALTIME, CLOCK_MONOTONIC and CLOCK_BOOTTIME; struct sigevent { sigev_value @0, sigev_signo @8, sigev_notify @12,
//                                                    sigev_notify_function @16, sigev_notify_attributes @24 }; SIGEV_SIGNAL sends the signal (si_code SI_TIMER, si_value),
//                                                    SIGEV_NONE nothing, SIGEV_THREAD calls the function with sigev_value on a new native thread (as bionic's timer thread does);
//                                                    an interval timer counts the expirations it missed (timer_getoverrun)
// Expirations are checked when the process's threads run (each slice, each native call from Java, each turn of a forked child) and by a VM-clock task while the process is
// idle; a fork does not inherit the parent's timers, as on Linux. Signals go through src/arm64/signals.js, so handlers, masks and default actions apply.
import { APKError } from '../apk-error.js?v=728b804e603a';

const SIGALRM = 14, SI_TIMER = -2, EINVAL = 22, EFAULT = 14;
const SIGEV_SIGNAL = 0, SIGEV_NONE = 1, SIGEV_THREAD = 2, SIGEV_THREAD_ID = 4, TIMER_ABSTIME = 1;
const CLOCKS = new Set([0, 1, 7]);   // CLOCK_REALTIME, CLOCK_MONOTONIC, CLOCK_BOOTTIME

export function addTimers(lib, { runtime, clock = () => Date.now() } = {}) {
  const n = (c, i) => Number(c.x[i]), s32 = (c, i) => Number(BigInt.asIntN(32, c.x[i]));
  const errno = (p, value) => { p.memory.writeU32(p.errnoAddress, value); return -1; };
  const now = p => p.threads?.now() ?? performance.now();
  const readSpec = (mem, at, usec) => Number(mem.read64(at)) * 1000 + Number(mem.read64(at + 8)) / (usec ? 1000 : 1e6);   // timeval (usec) or timespec (nsec) -> ms
  const writeSpec = (mem, at, ms, usec) => { const whole = Math.floor(ms / 1000), part = ms - whole * 1000; mem.write64(at, BigInt(whole)); mem.write64(at + 8, BigInt(Math.round(part * (usec ? 1000 : 1e6)))); };
  const state = p => {
    if (!p.timers) {
      lib.__signalState?.(p);   // expirations are checked where signals are delivered
      p.timers = { list: new Map(), nextId: 1, real: null };
      p.checkTimers = () => fire(p);
      p.timerDeadline = () => { let at = p.timers.real?.deadline ?? Infinity; for (const t of p.timers.list.values()) if (t.deadline !== null) at = Math.min(at, t.deadline); return at; };
    }
    return p.timers;
  };
  // an idle process still gets its expirations: a task on the VM clock (the app's process; a forked child is turned by the kernel at its deadline, src/arm64/processes.js)
  const schedule = p => {
    const queue = p.threads?.queueTask; if (!queue || p.forkedChild) return;
    const at = p.timerDeadline(); if (at === Infinity) return;
    const token = p.timers.token = (p.timers.token ?? 0) + 1;
    queue(() => { if (p.timers.token === token) fire(p, true); }, Math.max(0, at - now(p)));
    p.threads?.wake?.();
  };
  const expire = (p, timer, queued) => {
    if (timer.notify === SIGEV_NONE) return;
    if (timer.notify === SIGEV_THREAD) {
      if (p.forkedChild) throw new APKError('ARM64 native code in a forked child: a SIGEV_THREAD timer expired, and the lab does not start threads in a forked child', { kind: 'arm64-fork' });
      p.threads.create(timer.fn, timer.value); return;
    }
    lib.__signalProcess(p, timer.signo, SI_TIMER, { overrun: timer.overrun, value: timer.value, timerId: timer.id }, { queued });
  };
  function fire(p, queued = false) {   // queued: from a VM-clock task, while no native code runs (the signal waits for a thread, src/arm64/signals.js)
    const timers = p.timers; if (!timers) return;
    const t = now(p);
    const due = timer => {
      if (timer.deadline === null || timer.deadline > t) return false;
      if (timer.interval > 0) { const missed = Math.floor((t - timer.deadline) / timer.interval); timer.overrun = missed; timer.deadline += (missed + 1) * timer.interval; }
      else { timer.overrun = 0; timer.deadline = null; }
      return true;
    };
    if (timers.real && due(timers.real)) { if (timers.real.deadline === null) timers.real = null; lib.__signalProcess(p, SIGALRM, 0x80, {}, { queued }); }   // SI_KERNEL: the kernel's itimer
    for (const timer of [...timers.list.values()]) if (due(timer)) expire(p, timer, queued);
    schedule(p);
  }
  // ---- alarm / setitimer / getitimer
  const remaining = (p, timer) => timer && timer.deadline !== null ? Math.max(0, timer.deadline - now(p)) : 0;
  const setReal = (p, valueMs, intervalMs) => { const timers = state(p); timers.real = valueMs > 0 ? { deadline: now(p) + valueMs, interval: intervalMs, overrun: 0 } : null; schedule(p); };
  lib.alarm = (p, c) => {
    const timers = state(p), before = remaining(p, timers.real), seconds = n(c, 0) >>> 0;
    setReal(p, seconds * 1000, 0);
    return before ? Math.ceil(before / 1000) : 0;
  };
  const itimer = (p, which, name) => {
    if (which === 0) return true;
    runtime?.record?.(`DEVICE ARM64 ${name}(${which === 1 ? 'ITIMER_VIRTUAL' : which === 2 ? 'ITIMER_PROF' : which}): the lab does not measure a process's CPU time, so only ITIMER_REAL exists here (EINVAL)`);
    return false;
  };
  lib.getitimer = (p, c) => {
    const which = s32(c, 0), out = n(c, 1); if (!itimer(p, which, 'getitimer')) return errno(p, EINVAL); if (!out) return errno(p, EFAULT);
    const real = state(p).real; writeSpec(p.memory, out, real?.interval ?? 0, true); writeSpec(p.memory, out + 16, remaining(p, real), true); return 0;
  };
  lib.setitimer = (p, c) => {
    const which = s32(c, 0), value = n(c, 1), old = n(c, 2); if (!itimer(p, which, 'setitimer')) return errno(p, EINVAL);
    const real = state(p).real; if (old) { writeSpec(p.memory, old, real?.interval ?? 0, true); writeSpec(p.memory, old + 16, remaining(p, real), true); }
    if (!value) return errno(p, EFAULT);
    setReal(p, readSpec(p.memory, value + 16, true), readSpec(p.memory, value, true)); return 0;
  };
  // ---- POSIX timers (timer_t is an int id in bionic's kernel timers; the lab hands out small ids)
  lib.timer_create = (p, c) => {
    const clockId = s32(c, 0), event = n(c, 1), out = n(c, 2), mem = p.memory;
    if (!CLOCKS.has(clockId)) return errno(p, EINVAL);
    const timers = state(p), id = timers.nextId++;
    const timer = { id, clockId, deadline: null, interval: 0, overrun: 0, notify: SIGEV_SIGNAL, signo: SIGALRM, value: BigInt(id), fn: 0 };
    if (event) {
      timer.value = mem.read64(event); timer.signo = mem.int32(event + 8); timer.notify = mem.int32(event + 12); timer.fn = mem.readPtr(event + 16);
      if (![SIGEV_SIGNAL, SIGEV_NONE, SIGEV_THREAD].includes(timer.notify)) { runtime?.record?.(`DEVICE ARM64 timer_create: sigev_notify ${timer.notify}${timer.notify === SIGEV_THREAD_ID ? ' (SIGEV_THREAD_ID)' : ''} is not provided by the lab (EINVAL)`); return errno(p, EINVAL); }
      if (timer.notify === SIGEV_SIGNAL && !(timer.signo >= 1 && timer.signo <= 64)) return errno(p, EINVAL);
    }
    timers.list.set(id, timer); mem.writePtr(out, id); return 0;
  };
  const timerOf = (p, c) => state(p).list.get(n(c, 0)) ?? null;
  lib.timer_settime = (p, c) => {
    const timer = timerOf(p, c), flags = s32(c, 1), value = n(c, 2), old = n(c, 3), mem = p.memory; if (!timer) return errno(p, EINVAL); if (!value) return errno(p, EFAULT);
    if (old) { writeSpec(mem, old, timer.interval, false); writeSpec(mem, old + 16, remaining(p, timer), false); }
    const interval = readSpec(mem, value, false); let ms = readSpec(mem, value + 16, false);
    if (ms === 0) { timer.deadline = null; timer.interval = interval; schedule(p); return 0; }   // it_value 0 disarms
    if (flags & TIMER_ABSTIME) ms = timer.clockId === 0 ? ms - clock() : ms - now(p);   // an absolute time of the timer's clock
    timer.deadline = now(p) + Math.max(0, ms); timer.interval = interval; timer.overrun = 0; schedule(p); return 0;
  };
  lib.timer_gettime = (p, c) => { const timer = timerOf(p, c), out = n(c, 1); if (!timer) return errno(p, EINVAL); writeSpec(p.memory, out, timer.interval, false); writeSpec(p.memory, out + 16, remaining(p, timer), false); return 0; };
  lib.timer_getoverrun = (p, c) => { const timer = timerOf(p, c); return timer ? timer.overrun : errno(p, EINVAL); };
  lib.timer_delete = (p, c) => { const timers = state(p); if (!timers.list.delete(n(c, 0))) return errno(p, EINVAL); schedule(p); return 0; };
  return lib;
}
