// Signals inside the ARM64 process (docs/ARM64-NATIVE.md "Signals"): the dispositions (signal, sigaction), each thread's mask (sigprocmask, pthread_sigmask), the sigset_t
// functions, and the signals the process sends itself (raise, kill and tgkill of its own pid, pthread_kill), delivered as Linux and bionic deliver them:
//  - every thread starts with SIGPIPE, SIGQUIT and SIGUSR1 blocked, as ART's Runtime::BlockSignals leaves an app's threads (art/runtime/runtime.cc); a thread inherits its creator's mask;
//  - a signal goes to the thread it names, or (sent to the process) to the current thread when it does not block it, else to another thread that does not; a signal no thread
//    accepts stays pending, and a thread that unblocks it takes it then. SIGQUIT and SIGUSR1 blocked everywhere go to ART's "Signal Catcher" thread, which waits for them
//    (sigwait): SIGQUIT is its thread dump (recorded), SIGUSR1 a collection request;
//  - a handler runs on the receiving thread with (signo, siginfo, ucontext): at once on the thread that is running, at the start of its next slice on another one;
//    SIG_IGN drops the signal; SIG_DFL ignores SIGCHLD, SIGCONT, SIGURG and SIGWINCH and ends the process for the rest (the named error the run reports).
// bionic's LP64 layouts: sigset_t is 64 bits (bit n-1 is signal n); struct sigaction is { int sa_flags; handler at 8; sa_mask at 16; sa_restorer at 24 }.
import { APKError } from '../apk-error.js?v=728b804e603a';
import { BLOCKED as BLOCKED_CALL } from './cpu.js?v=728b804e603a';

const SIG_DFL = 0, SIG_IGN = 1, SA_SIGINFO = 4, SIG_BLOCK = 0, SIG_UNBLOCK = 1, SIG_SETMASK = 2, EINVAL = 22, ESRCH = 3, EINTR = 4;
const SIGQUIT = 3, SIGUSR1 = 10, SIGPIPE = 13, SIGKILL = 9, SIGSTOP = 19, SI_USER = 0, SI_TKILL = -6, SI_TIMER = -2, SI_KERNEL = 0x80;
const DEFAULT_IGNORED = new Set([17, 18, 23, 28]);   // SIGCHLD, SIGCONT, SIGURG, SIGWINCH
const bitOf = sig => 1n << BigInt(sig - 1);
export const ART_BLOCKED = bitOf(SIGPIPE) | bitOf(SIGQUIT) | bitOf(SIGUSR1);
const UNBLOCKABLE = bitOf(SIGKILL) | bitOf(SIGSTOP);

export function addSignals(lib, { runtime } = {}) {
  const n = (c, i) => Number(c.x[i]), s32 = (c, i) => Number(BigInt.asIntN(32, c.x[i]));
  const errno = (p, value) => { p.memory.writeU32(p.errnoAddress, value); return -1; };
  const state = p => p.signals ??= { actions: new Map(), pending: [], deliver: (process, t) => deliverIfAny(process, t), deliverable: (process, t) => deliverable(process, t) };
  const valid = sig => Number.isInteger(sig) && sig >= 1 && sig <= 64;
  const maskOf = t => t.sigmask ??= ART_BLOCKED;
  const record = line => runtime?.record?.(line);
  // ---- sigset_t
  lib.sigemptyset = lib.sigemptyset64 = (p, c) => { p.memory.write64(n(c, 0), 0n); return 0; };
  lib.sigfillset = lib.sigfillset64 = (p, c) => { p.memory.write64(n(c, 0), 0xffffffffffffffffn); return 0; };
  lib.sigaddset = lib.sigaddset64 = (p, c) => { const sig = s32(c, 1); if (!valid(sig)) return errno(p, EINVAL); p.memory.write64(n(c, 0), p.memory.read64(n(c, 0)) | bitOf(sig)); return 0; };
  lib.sigdelset = lib.sigdelset64 = (p, c) => { const sig = s32(c, 1); if (!valid(sig)) return errno(p, EINVAL); p.memory.write64(n(c, 0), p.memory.read64(n(c, 0)) & ~bitOf(sig)); return 0; };
  lib.sigismember = lib.sigismember64 = (p, c) => { const sig = s32(c, 1); if (!valid(sig)) return errno(p, EINVAL); return p.memory.read64(n(c, 0)) & bitOf(sig) ? 1 : 0; };
  // ---- dispositions
  const actionOf = (p, sig) => state(p).actions.get(sig) ?? { handler: SIG_DFL, flags: 0, mask: 0n };
  lib.signal = lib.bsd_signal = lib.sysv_signal = (p, c) => { const sig = s32(c, 0); if (!valid(sig) || sig === SIGKILL || sig === SIGSTOP) return errno(p, EINVAL); const old = actionOf(p, sig); state(p).actions.set(sig, { handler: n(c, 1), flags: 0x10000000, mask: 0n }); return old.handler; };   // SA_RESTART
  lib.sigaction = lib.sigaction64 = (p, c) => {
    const sig = s32(c, 0), act = n(c, 1), old = n(c, 2), mem = p.memory; if (!valid(sig)) return errno(p, EINVAL);
    if (old) { const a = actionOf(p, sig); mem.writeU32(old, a.flags); mem.writeU32(old + 4, 0); mem.writePtr(old + 8, a.handler); mem.write64(old + 16, a.mask); mem.writePtr(old + 24, 0); }
    if (act) { if (sig === SIGKILL || sig === SIGSTOP) return errno(p, EINVAL); state(p).actions.set(sig, { flags: mem.readU32(act), handler: mem.readPtr(act + 8), mask: mem.read64(act + 16) }); }
    return 0;
  };
  // ---- masks
  const setMask = (p, t, how, set, old) => {
    const mem = p.memory, current = maskOf(t); if (old) mem.write64(old, current);
    if (!set) return 0;
    const bits = mem.read64(set);
    t.sigmask = (how === SIG_BLOCK ? current | bits : how === SIG_UNBLOCK ? current & ~bits : how === SIG_SETMASK ? bits : null);
    if (t.sigmask === null) { t.sigmask = current; return EINVAL; }
    t.sigmask &= ~UNBLOCKABLE;
    deliverPending(p, t);
    return 0;
  };
  lib.pthread_sigmask = lib.pthread_sigmask64 = (p, c) => setMask(p, p.threads.current, s32(c, 0), n(c, 1), n(c, 2));   // returns the error number
  lib.sigprocmask = lib.sigprocmask64 = (p, c) => { const r = setMask(p, p.threads.current, s32(c, 0), n(c, 1), n(c, 2)); return r ? errno(p, r) : 0; };
  // ---- delivery
  // The signal frame, as the arm64 kernel builds it (arch/arm64/kernel/signal.c setup_rt_frame): below the interrupted stack pointer, 16-byte aligned, a siginfo_t (128 bytes)
  // and a ucontext_t whose uc_mcontext (struct sigcontext, at ucontext + 176) holds the interrupted context: fault_address, regs[0..30], sp, pc and pstate (NZCV in bits 31-28).
  // The handler runs on the interrupted thread's own state; when it returns, the context comes back from the frame (rt_sigreturn: restore_sigframe), so a handler that changes
  // uc_mcontext changes where and with what the thread resumes, and one that does not leaves the thread exactly as it was. The registers the frame does not hold (the vector
  // registers, FPCR/FPSR) are kept aside and put back; the exclusive monitor is cleared, as an exception return clears it. A signal taken at the start of a slice interrupts
  // the thread at any instruction (a preempted computation, a call whose arguments are half set up): without the whole context back, the handler's own register values
  // leaked into the interrupted code.
  const FRAME = 128 + 1024, UC = 128, MC = UC + 176, MC_REGS = MC + 8, MC_SP = MC + 256, MC_PC = MC + 264, MC_PSTATE = MC + 272, UC_SIGMASK = 40;
  // Linux's siginfo_t: si_signo @0, si_code @8, then the union @16: { si_pid, si_uid } of a sent signal, { si_tid, si_overrun, si_value @24 } of a POSIX timer (SI_TIMER)
  const writeSiginfo = (p, at, sig, code, extra) => {
    const mem = p.memory; mem.writeU32(at, sig); mem.writeU32(at + 8, code >>> 0);
    if (code === SI_TIMER) { mem.writeU32(at + 16, extra?.timerId ?? 0); mem.writeU32(at + 20, extra?.overrun ?? 0); mem.write64(at + 24, BigInt(extra?.value ?? 0n)); }
    else if (code !== SI_KERNEL) mem.writeU32(at + 16, extra?.pid ?? lib.getpid(p));
  };
  const pushFrame = (p, cpu, t, sig, code, extra) => {
    const mem = p.memory, at = Math.floor((Number(cpu.sp) - FRAME) / 16) * 16;
    mem.fill(at, 0, FRAME); writeSiginfo(p, at, sig, code, extra);
    mem.write64(at + UC + UC_SIGMASK, maskOf(t));
    for (let i = 0; i < 31; i++) mem.write64(at + MC_REGS + 8 * i, cpu.x[i]);
    mem.write64(at + MC_SP, cpu.sp); mem.write64(at + MC_PC, BigInt(cpu.pc)); mem.write64(at + MC_PSTATE, BigInt(cpu.nzcv()) << 28n);
    return at;
  };
  const popFrame = (p, cpu, at, kept) => {
    const mem = p.memory;
    for (let i = 0; i < 31; i++) cpu.x[i] = mem.read64(at + MC_REGS + 8 * i);
    cpu.sp = mem.read64(at + MC_SP); cpu.pc = Number(mem.read64(at + MC_PC)); cpu.setNzcv(Number((mem.read64(at + MC_PSTATE) >> 28n) & 15n));
    cpu.vbuf.set(kept.v); cpu.fpcr = kept.fpcr; cpu.fpsr = kept.fpsr; cpu.exclusive = null;
  };
  const run = (p, t, sig, code, extra) => {
    const a = actionOf(p, sig);
    if (a.handler === SIG_IGN) return;
    if (a.handler === SIG_DFL) {
      if (DEFAULT_IGNORED.has(sig)) return;
      throw new APKError(`ARM64 native code raised signal ${sig} in its own process with no handler: the run ends here, as on a device`, { kind: 'arm64-abort', signal: sig });
    }
    const cpu = p.activeCpu, saved = maskOf(t), kept = { v: cpu.vbuf.slice(), fpcr: cpu.fpcr, fpsr: cpu.fpsr }, frame = pushFrame(p, cpu, t, sig, code, extra);
    t.sigmask = saved | a.mask | ((a.flags & 0x40000000) ? 0n : bitOf(sig));   // the handler runs with its sa_mask and (without SA_NODEFER) its own signal blocked
    record(`DEVICE ARM64 signal ${sig} delivered to native thread ${t.tid}: handler 0x${a.handler.toString(16)}`);
    t.handlerRuns = (t.handlerRuns ?? 0) + 1;   // a blocking call of this thread returns EINTR (pause, sleep: src/arm64/libc.js)
    cpu.sp = frame;   // the handler's stack starts below the frame
    try { p.call(a.handler, [sig, a.flags & SA_SIGINFO ? frame : 0, a.flags & SA_SIGINFO ? frame + UC : 0]); } finally { popFrame(p, cpu, frame, kept); t.sigmask = saved; }
  };
  const deliverTo = (p, t, sig, code, extra) => {
    if (t === p.threads.current) return run(p, t, sig, code, extra);
    (t.pendingSignals ??= []).push({ sig, code, extra }); p.threads.wake?.();   // handled when that thread runs again (src/arm64/threads.js slice)
  };
  function deliverPending(p, t) {
    const own = t.pendingSignals; if (own?.length && t === p.threads.current) { for (const item of own.splice(0)) { if (maskOf(t) & bitOf(item.sig)) { own.push(item); continue; } run(p, t, item.sig, item.code, item.extra); } }
    const shared = state(p).pending; if (!shared.length) return;
    for (const item of shared.splice(0)) { if (maskOf(t) & bitOf(item.sig)) shared.push(item); else deliverTo(p, t, item.sig, item.code, item.extra); }
  }
  const deliverIfAny = (p, t) => { p.checkTimers?.(); if (t.pendingSignals?.length || state(p).pending.length) deliverPending(p, t); };
  // a waiting thread that has a signal it does not block (its own or the process's) runs again for the handler (src/arm64/threads.js), then retries the call it waits in
  const deliverable = (p, t) => (t.pendingSignals ?? []).concat(state(p).pending).some(item => !(maskOf(t) & bitOf(item.sig)));   // src/arm64/threads.js: at the start of a slice and of a Java thread's native call
  const toProcess = (p, sig, code = SI_USER, extra = null) => {
    const threads = p.threads, current = threads.current;
    if (current && !(maskOf(current) & bitOf(sig))) return deliverTo(p, current, sig, code, extra);
    for (const t of threads.threads.values()) if (t.state !== 'done' && !(maskOf(t) & bitOf(sig))) return deliverTo(p, t, sig, code, extra);
    if (sig === SIGQUIT) { record('DEVICE ARM64 SIGQUIT to the process: ART\'s Signal Catcher thread takes it (a thread dump on a device)'); return; }
    if (sig === SIGUSR1) { record('DEVICE ARM64 SIGUSR1 to the process: ART\'s Signal Catcher thread takes it (a collection request)'); return; }
    state(p).pending.push({ sig, code, extra });   // blocked everywhere: pending until a thread unblocks it
  };
  const toThread = (p, t, sig) => { if (maskOf(t) & bitOf(sig)) { if (sig === SIGQUIT || sig === SIGUSR1) return toProcess(p, sig); (t.pendingSignals ??= []).push({ sig, code: SI_TKILL }); return; } deliverTo(p, t, sig, SI_TKILL); };
  const ownPid = (p, pid) => pid === 0 || pid === lib.getpid(p) || pid === -lib.getpid(p);
  lib.raise = (p, c) => { const sig = s32(c, 0); if (!valid(sig)) return errno(p, EINVAL); toThread(p, p.threads.current, sig); return 0; };
  lib.kill = (p, c) => { const pid = s32(c, 0), sig = s32(c, 1); if (sig !== 0 && !valid(sig)) return errno(p, EINVAL); if (!ownPid(p, pid)) return errno(p, ESRCH); if (sig) toProcess(p, sig); return 0; };
  lib.tgkill = (p, c) => {
    const pid = s32(c, 0), tid = s32(c, 1), sig = s32(c, 2); if (sig !== 0 && !valid(sig)) return errno(p, EINVAL);
    const t = p.threads.byTid(tid); if (!ownPid(p, pid) || !t || t.state === 'done') return errno(p, ESRCH);
    if (sig) toThread(p, t, sig); return 0;
  };
  // a signal from outside the running code: a timer (src/arm64/timers.js) or the process kernel (src/process-kernel.js, a forked child). `queued`: no native code runs
  // now (a VM-clock task), so the signal waits as pending for the next thread that runs and does not block it, which is how a thread takes an asynchronous signal
  lib.__signalProcess = (p, sig, code = SI_USER, extra = null, { queued = false } = {}) => {
    state(p);
    if (queued || !p.threads?.current) { state(p).pending.push({ sig, code, extra }); p.threads?.wake?.(); return; }
    toProcess(p, sig, code, extra);
  };
  lib.__signalState = p => state(p);
  // pause / sigsuspend: the thread waits until a handler has run on it, then returns -1 with EINTR; sigsuspend waits with the given mask, and the thread's own mask is back after
  const suspend = (p, c, mask) => {
    const t = p.threads.current;
    if (t.pauseFrom === undefined) { t.pauseFrom = t.handlerRuns ?? 0; if (mask !== null) { t.pauseMask = maskOf(t); t.sigmask = mask & ~UNBLOCKABLE; } }
    const got = p.threads.wait(c, () => (t.handlerRuns ?? 0) > t.pauseFrom, { what: mask === null ? 'pause' : 'sigsuspend' });
    if (got === BLOCKED_CALL) return BLOCKED_CALL;
    t.pauseFrom = undefined; if (t.pauseMask !== undefined) { t.sigmask = t.pauseMask; t.pauseMask = undefined; }
    return errno(p, EINTR);
  };
  lib.pause = (p, c) => suspend(p, c, null);
  lib.sigsuspend = lib.sigsuspend64 = (p, c) => suspend(p, c, p.memory.read64(n(c, 0)));
  lib.tkill = (p, c) => lib.tgkill(p, { x: [BigInt(lib.getpid(p)), c.x[0], c.x[1]] });
  lib.pthread_kill = (p, c) => { const t = p.threads.byPthread(n(c, 0)), sig = s32(c, 1); if (!t || t.state === 'done') return ESRCH; if (sig !== 0 && !valid(sig)) return EINVAL; if (sig) toThread(p, t, sig); return 0; };
  return lib;
}
