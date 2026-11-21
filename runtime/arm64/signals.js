// Signals inside the ARM64 process (docs/ARM64-NATIVE.md "Signals"): the dispositions (signal, sigaction), each thread's mask (sigprocmask, pthread_sigmask), the sigset_t
// functions, and the signals the process sends itself (raise, kill and tgkill of its own pid, pthread_kill), delivered as Linux and bionic deliver them:
//  - every thread starts with SIGPIPE, SIGQUIT and SIGUSR1 blocked, as ART's Runtime::BlockSignals leaves an app's threads (art/runtime/runtime.cc); a thread inherits its creator's mask;
//  - a signal goes to the thread it names, or (sent to the process) to the current thread when it does not block it, else to another thread that does not; a signal no thread
//    accepts stays pending, and a thread that unblocks it takes it then. SIGQUIT and SIGUSR1 blocked everywhere go to ART's "Signal Catcher" thread, which waits for them
//    (sigwait): SIGQUIT is its thread dump (recorded), SIGUSR1 a collection request;
//  - a handler runs on the receiving thread with (signo, siginfo, ucontext): at once on the thread that is running, at the start of its next slice on another one;
//    SIG_IGN drops the signal; SIG_DFL ignores SIGCHLD, SIGCONT, SIGURG and SIGWINCH and ends the process for the rest (the named error the run reports).
// bionic's LP64 layouts: sigset_t is 64 bits (bit n-1 is signal n); struct sigaction is { int sa_flags; handler at 8; sa_mask at 16; sa_restorer at 24 }.
import { APKError } from '../apk-error.js?v=6954cacca256';

const SIG_DFL = 0, SIG_IGN = 1, SA_SIGINFO = 4, SIG_BLOCK = 0, SIG_UNBLOCK = 1, SIG_SETMASK = 2, EINVAL = 22, ESRCH = 3;
const SIGQUIT = 3, SIGUSR1 = 10, SIGPIPE = 13, SIGKILL = 9, SIGSTOP = 19, SI_USER = 0, SI_TKILL = -6;
const DEFAULT_IGNORED = new Set([17, 18, 23, 28]);   // SIGCHLD, SIGCONT, SIGURG, SIGWINCH
const bitOf = sig => 1n << BigInt(sig - 1);
export const ART_BLOCKED = bitOf(SIGPIPE) | bitOf(SIGQUIT) | bitOf(SIGUSR1);
const UNBLOCKABLE = bitOf(SIGKILL) | bitOf(SIGSTOP);

export function addSignals(lib, { runtime } = {}) {
  const n = (c, i) => Number(c.x[i]), s32 = (c, i) => Number(BigInt.asIntN(32, c.x[i]));
  const errno = (p, value) => { p.memory.writeU32(p.errnoAddress, value); return -1; };
  const state = p => p.signals ??= { actions: new Map(), pending: [], deliver: (process, t) => deliverIfAny(process, t) };
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
  const siginfo = (p, t, sig, code) => { const mem = p.memory, at = t.siginfo ??= p.malloc(128 + 1024); mem.fill(at, 0, 128 + 1024); mem.writeU32(at, sig); mem.writeU32(at + 8, code >>> 0); mem.writeU32(at + 16, lib.getpid(p)); return at; };
  const run = (p, t, sig, code) => {
    const a = actionOf(p, sig);
    if (a.handler === SIG_IGN) return;
    if (a.handler === SIG_DFL) {
      if (DEFAULT_IGNORED.has(sig)) return;
      throw new APKError(`ARM64 native code raised signal ${sig} in its own process with no handler: the run ends here, as on a device`, { kind: 'arm64-abort', signal: sig });
    }
    const saved = maskOf(t), info = siginfo(p, t, sig, code);
    t.sigmask = saved | a.mask | ((a.flags & 0x40000000) ? 0n : bitOf(sig));   // the handler runs with its sa_mask and (without SA_NODEFER) its own signal blocked
    record(`DEVICE ARM64 signal ${sig} delivered to native thread ${t.tid}: handler 0x${a.handler.toString(16)}`);
    try { p.call(a.handler, [sig, a.flags & SA_SIGINFO ? info : 0, a.flags & SA_SIGINFO ? info + 128 : 0]); } finally { t.sigmask = saved; }
  };
  const deliverTo = (p, t, sig, code) => {
    if (t === p.threads.current) return run(p, t, sig, code);
    (t.pendingSignals ??= []).push({ sig, code });   // handled when that thread runs again (src/arm64/threads.js slice)
  };
  function deliverPending(p, t) {
    const own = t.pendingSignals; if (own?.length && t === p.threads.current) { for (const item of own.splice(0)) { if (maskOf(t) & bitOf(item.sig)) { own.push(item); continue; } run(p, t, item.sig, item.code); } }
    const shared = state(p).pending; if (!shared.length) return;
    for (const item of shared.splice(0)) { if (maskOf(t) & bitOf(item.sig)) shared.push(item); else deliverTo(p, t, item.sig, item.code); }
  }
  const deliverIfAny = (p, t) => { if (t.pendingSignals?.length || state(p).pending.length) deliverPending(p, t); };   // src/arm64/threads.js: at the start of a slice and of a Java thread's native call
  const toProcess = (p, sig) => {
    const threads = p.threads, current = threads.current;
    if (!(maskOf(current) & bitOf(sig))) return deliverTo(p, current, sig, SI_USER);
    for (const t of threads.threads.values()) if (t.state !== 'done' && !(maskOf(t) & bitOf(sig))) return deliverTo(p, t, sig, SI_USER);
    if (sig === SIGQUIT) { record('DEVICE ARM64 SIGQUIT to the process: ART\'s Signal Catcher thread takes it (a thread dump on a device)'); return; }
    if (sig === SIGUSR1) { record('DEVICE ARM64 SIGUSR1 to the process: ART\'s Signal Catcher thread takes it (a collection request)'); return; }
    state(p).pending.push({ sig, code: SI_USER });   // blocked everywhere: pending until a thread unblocks it
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
  lib.tkill = (p, c) => lib.tgkill(p, { x: [BigInt(lib.getpid(p)), c.x[0], c.x[1]] });
  lib.pthread_kill = (p, c) => { const t = p.threads.byPthread(n(c, 0)), sig = s32(c, 1); if (!t || t.state === 'done') return ESRCH; if (sig !== 0 && !valid(sig)) return EINVAL; if (sig) toThread(p, t, sig); return 0; };
  return lib;
}
