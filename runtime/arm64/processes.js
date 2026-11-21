// Processes of the ARM64 native code (docs/ARM64-NATIVE.md): fork, vfork and clone without CLONE_VM (bionic's fork is clone(SIGCHLD | CLONE_CHILD_SETTID |
// CLONE_CHILD_CLEARTID)), wait4 / waitpid / wait / waitid, kill of a child, the exec family in a forked child, system and posix_spawn, over the lab's process kernel
// (src/process-kernel.js), the same process table Runtime.exec uses.
//
// fork: the child is a process of its own (a pid after the app's, its parent the app, the app's uid), with a copy of the parent's address space (every mapping: the
// libraries, the heap, the stacks, the mmap regions; a PROT_NONE reservation stays unbacked), the calling thread only (its registers, its TLS, its signal mask), the
// parent's descriptors (the same open descriptions: a pipe or socket is shared, a file's offset too), the parent's signal dispositions. It runs concurrently, as a thread of
// the VM's scheduler, and returns 0 from the fork where the parent returns its pid. A child that writes memory writes its own copy. An execve in the child runs a program of
// /system/bin (src/system-image.js) in the same process, its descriptors carried over (close-on-exec ones closed); a path that is not one fails as on a device (ENOENT,
// EACCES, ENOEXEC for an ELF the device cannot run here, named in the trace).
// What a forked child cannot do in the lab fails by name: JNI and ART calls (the child has no Java runtime: on a device it has a copy of ART but no other thread), returning
// from the native frames into the managed caller; ptrace, which a device's seccomp filter for apps and SELinux deny an untrusted_app's processes, fails with EPERM.
import { APKError } from '../apk-error.js?v=efe50e99a19d';
import { Arm64Cpu, BLOCKED, RETURN_SENTINEL } from './cpu.js?v=efe50e99a19d';
import { Arm64Memory } from './memory.js?v=efe50e99a19d';
import { NativeThreads } from './threads.js?v=efe50e99a19d';
import { processKernel, SIG } from '../process-kernel.js?v=efe50e99a19d';

const CLONE_VM = 0x100, CLONE_VFORK = 0x4000, CLONE_THREAD = 0x10000, CLONE_PARENT_SETTID = 0x100000, CLONE_CHILD_CLEARTID = 0x200000, CLONE_CHILD_SETTID = 0x1000000;
const WNOHANG = 1, ECHILD = 10, EINVAL = 22, EPERM = 1, ENOSYS = 38, EAGAIN = 11;
const LINUX_ERRNO = { 2: 13, 44: 2, 54: 20, 45: 8, 32: 40, 12: 10, 71: 3, 63: 1 };   // the kernel's errno numbering (src/process-kernel.js E) -> Linux's (bionic's)

export class ChildExit extends Error { constructor(status) { super(status.signal ? `killed by signal ${status.signal}` : `exit ${status.code}`); this.status = status; } }

export function addProcesses(lib, { runtime, childLibc }) {
  const n = (c, i) => Number(c.x[i]), s32 = (c, i) => Number(BigInt.asIntN(32, c.x[i]));
  const fail = (p, errno) => { p.memory.writeU32(p.errnoAddress, errno); return -1; };
  const kernel = () => processKernel(runtime);
  const child = p => p.forkedChild ?? null;   // the kernel's record of a forked child process (null in the app's own process)
  const decoder = new TextDecoder(), str = (p, at) => decoder.decode(p.memory.cString(at, 4096));
  const strings = (p, at) => { const out = []; if (!at) return out; for (let i = 0; i < 4096; i++) { const ptr = p.memory.readPtr(at + 8 * i); if (!ptr) break; out.push(str(p, ptr)); } return out; };

  /** fork in process `p` from the thread `cpu` runs: `resume` is where the child continues (the caller of the libc function, or after the svc). */
  const fork = (p, cpu, { resume, flags = 0x11, ctid = 0, ptid = 0, what = 'called fork' }) => {
    const k = runtime?.platform?.javaIo ? kernel() : null;
    if (!k?.available()) throw new APKError(`ARM64 native code ${what}: the lab's process kernel and the system programs are not loaded in this VM`, { kind: 'arm64-fork' });
    attachPump(p, k);
    if (k.processes.size >= 256) return fail(p, EAGAIN);
    const parentRecord = child(p) ?? k.app;
    const proc = k.newProcess(parentRecord, { argv: parentRecord.argv ?? [runtime.platform?.packageName ?? 'app_process'], env: parentRecord.env ?? Object.entries(runtime.platform?.environment ?? {}).map(([a, b]) => `${a}=${b}`), cwd: parentRecord.cwd ?? '/', comm: parentRecord.comm });
    proc.kind = 'arm64'; proc.exe = parentRecord.exe ?? '/system/bin/app_process64';
    const copy = copyProcess(p, cpu, proc.pid, { resume, childLibc });
    copy.forkedChild = proc; proc.native = copy;
    if ((flags & CLONE_CHILD_SETTID) && ctid) copy.memory.writeU32(ctid, proc.pid);
    if ((flags & CLONE_PARENT_SETTID) && ptid) p.memory.writeU32(ptid, proc.pid);
    if (flags & CLONE_CHILD_CLEARTID) proc.clearTid = ctid;
    runtime.record?.(`PROCESS ${p.pid} forked ${proc.pid} (ARM64 native code, ${resume === cpu.pc ? 'clone system call' : 'fork'}; a copy of ${Math.round(copy.copiedBytes / 1024)} KiB of mapped memory)`);
    k.start(proc);
    return proc.pid;
  };
  lib.fork = lib.vfork = lib.__fork = (p, c) => fork(p, c, { resume: Number(c.x[30]) });   // vfork: the child runs on a copy as well (the parent does not wait: it is not suspended, CLONE_VFORK below)
  // clone(flags, stack, parent_tid, tls, child_tid) as the arm64 system call takes it; with CLONE_VM it is a thread (pthread_create's path), not provided this way
  lib.__clone = (p, c) => {
    const flags = n(c, 0);
    if (flags & (CLONE_VM | CLONE_THREAD)) throw new APKError(`ARM64 native code made system call 220 (clone) with flags 0x${(flags >>> 0).toString(16)} (a thread: CLONE_VM): not provided by the lab (pthread_create is)`, { kind: 'arm64-syscall', syscall: 220 });
    if (n(c, 1)) throw new APKError(`ARM64 native code made system call 220 (clone) of a process on a stack of its own (0x${n(c, 1).toString(16)}): not provided by the lab`, { kind: 'arm64-syscall', syscall: 220 });
    const viaSvc = c.pc < 0x7f0000000000;   // an svc instruction (pc is past it) or bionic's syscall(3) (a lab function: the caller's return address)
    return fork(p, c, { resume: viaSvc ? c.pc : Number(c.x[30]), flags: flags & ~CLONE_VFORK, ptid: n(c, 2), ctid: n(c, 4), what: `made system call 220 (clone) with flags 0x${(flags >>> 0).toString(16)} (a new process: fork)` });
  };
  lib.__clone3 = (p, c) => {   // clone3(struct clone_args *, size): flags @0, child_tid @16, parent_tid @24, stack @40
    const at = n(c, 0), flags = Number(p.memory.read64(at)), stack = Number(p.memory.read64(at + 40));
    return lib.__clone(p, { ...c, x: [BigInt(flags), BigInt(stack), p.memory.read64(at + 24), 0n, p.memory.read64(at + 16), 0n, ...c.x.slice(6)], pc: c.pc });
  };

  // ---- wait4 / waitpid / wait / waitid: the children of this process (the app's: the ones Runtime.exec started too, as on a device)
  const wait4 = (p, c, pid, statusPtr, options) => {
    const k = kernel(), self = child(p) ?? k.app, r = k.wait4(self, pid, options); attachPump(p, k);
    if (r.error) return fail(p, LINUX_ERRNO[r.error] ?? ECHILD);
    if (r.wait) {
      const got = p.threads.wait(c, () => r.wait.ready() || k.processes.size === 0, { what: `waitpid(${pid})` });
      if (got === BLOCKED) return BLOCKED;
      return wait4(p, c, pid, statusPtr, options);
    }
    if (r.pid > 0 && statusPtr) p.memory.writeU32(statusPtr, r.status);
    return r.pid;
  };
  lib.wait4 = (p, c) => wait4(p, c, s32(c, 0), n(c, 1), n(c, 2));
  lib.waitpid = (p, c) => wait4(p, c, s32(c, 0), n(c, 1), n(c, 2));
  lib.wait = (p, c) => wait4(p, c, -1, n(c, 0), 0);
  lib.waitid = (p, c) => {   // waitid(idtype, id, siginfo_t *, options): P_ALL 0, P_PID 1, P_PGID 2; WEXITED 4 is the only state the lab's processes report
    const type = n(c, 0), id = n(c, 1), info = n(c, 2), options = n(c, 3), pid = type === 1 ? id : type === 2 ? -id : -1, status = p.malloc(8);
    const r = wait4(p, c, pid, status, options & WNOHANG); if (r === BLOCKED || r < 0) return r;
    if (info) { p.memory.fill(info, 0, 128); if (r > 0) { const s = p.memory.readU32(status); p.memory.writeU32(info, SIG.CHLD); p.memory.writeU32(info + 8, (s & 0x7f) ? 2 : 1); p.memory.writeU32(info + 16, r); p.memory.writeU32(info + 24, (s & 0x7f) || (s >> 8)); } }
    return 0;
  };
  // ---- kill of another process (a child, a process group); the process's own pid stays with src/arm64/signals.js
  { const own = lib.kill;
    lib.kill = (p, c) => {
      const pid = s32(c, 0), sig = s32(c, 1), self = child(p)?.pid ?? lib.getpid(p);
      if (pid === self || pid === 0 || pid === -self) return own(p, c);
      const r = kernel().kill(child(p) ?? kernel().app, pid, sig);
      return r < 0 ? fail(p, LINUX_ERRNO[-r] ?? EPERM) : 0;
    };
  }
  // ---- the exec family: in a forked child, the program replaces the child; in the app's own process, replacing the app is not provided
  const exec = (p, path, argv, envp, search) => {
    const k = kernel(), proc = child(p);
    if (!proc) throw new APKError(`ARM64 native code called execve(${JSON.stringify(path)}) in the app's own process: replacing the app's process image is not provided by the lab (fork first)`, { kind: 'exec-unsupported', path });
    const candidates = !search || path.includes('/') ? [path] : String(envOf(p, proc, envp).find(e => e.startsWith('PATH='))?.slice(5) ?? runtime.platform?.environment?.PATH ?? '').split(':').filter(Boolean).map(d => `${d.replace(/\/$/, '')}/${path}`);
    let error = 44;
    for (const candidate of candidates) {
      const resolved = k.resolveExec(proc, candidate, argv);
      if (resolved.elf) { runtime.record?.(`PROCESS ${proc.pid}: execve ${resolved.path}: an ELF executable needs a CPU the virtual device does not have (ENOEXEC)`); error = 45; break; }
      if (resolved.error) { if (resolved.error === 2) error = 2; if (!search || path.includes('/')) error = resolved.error; continue; }
      proc.pendingExec = { ...resolved, file: candidate, env: envOf(p, proc, envp) };
      p.activeCpu.exited = true;   // the interpreter stops here; the kernel loads the program (src/process-kernel.js runNative)
      return 0;
    }
    return fail(p, LINUX_ERRNO[error] ?? 2);
  };
  const envOf = (p, proc, envp) => envp ? strings(p, envp) : proc.env;
  lib.execve = (p, c) => exec(p, str(p, n(c, 0)), strings(p, n(c, 1)), n(c, 2), false);
  lib.execv = (p, c) => exec(p, str(p, n(c, 0)), strings(p, n(c, 1)), 0, false);
  lib.execvp = (p, c) => exec(p, str(p, n(c, 0)), strings(p, n(c, 1)), 0, true);
  lib.execvpe = (p, c) => exec(p, str(p, n(c, 0)), strings(p, n(c, 1)), n(c, 2), true);
  const listArgs = (p, c, first) => { const out = []; for (let i = first; i < 8; i++) { const ptr = n(c, i); if (!ptr) return out; out.push(str(p, ptr)); } let sp = Number(c.sp); for (let i = 0; i < 64; i++) { const ptr = p.memory.readPtr(sp + 8 * i); if (!ptr) break; out.push(str(p, ptr)); } return out; };
  lib.execl = (p, c) => exec(p, str(p, n(c, 0)), listArgs(p, c, 1), 0, false);
  lib.execlp = (p, c) => exec(p, str(p, n(c, 0)), listArgs(p, c, 1), 0, true);
  // ---- system(3) and posix_spawn: a child process of this one running the program, as bionic does them (system: /system/bin/sh -c, the caller waits)
  const spawn = (p, path, argv, search, stdio = [null, null, null], how = null) => {
    const k = kernel(), parent = child(p) ?? k.app; attachPump(p, k);
    if (!k.available()) throw new APKError(`ARM64 native code started ${path}: the system programs of /system/bin are not loaded in this VM`, { kind: 'exec-unsupported', path });
    const candidates = !search || path.includes('/') ? [path] : String(runtime.platform?.environment?.PATH ?? '').split(':').filter(Boolean).map(d => `${d.replace(/\/$/, '')}/${path}`);
    let error = 44;
    for (const candidate of candidates) {
      const resolved = k.resolveExec(parent, candidate, argv);
      if (resolved.elf) throw new APKError(`ARM64 native code started ${resolved.path}: the virtual device has no CPU to run a native executable`, { kind: 'exec-unsupported', path: resolved.path });
      if (resolved.error) { if (!search || path.includes('/')) error = resolved.error; continue; }
      const env = Object.entries(runtime.platform?.environment ?? {}).map(([a, b]) => `${a}=${b}`);
      return k.spawn({ exec: { ...resolved, file: candidate }, argv: resolved.argv, env, cwd: '/', stdio, label: `${argv.join(' ')} (native ${how ?? (search ? 'posix_spawnp' : 'system')})`, parent });
    }
    return { error };
  };
  lib.system = (p, c) => {
    if (!n(c, 0)) return 1;   // system(NULL): a shell is available
    const command = str(p, n(c, 0)), started = p.pendingSystem ?? spawn(p, '/system/bin/sh', ['sh', '-c', command], false);
    if (started.error) return fail(p, LINUX_ERRNO[started.error] ?? 2);
    p.pendingSystem = started;
    const got = p.threads.wait(c, () => started.state === 'Z', { what: `system(${JSON.stringify(command)})` });
    if (got === BLOCKED) return BLOCKED;
    p.pendingSystem = null;
    return kernel().wait4(child(p) ?? kernel().app, started.pid, 0).status;
  };
  const posixSpawn = search => (p, c) => {
    const path = str(p, n(c, 1)), argv = strings(p, n(c, 4)), started = spawn(p, path, argv.length ? argv : [path], search);
    if (started.error) return LINUX_ERRNO[started.error] ?? 2;
    if (n(c, 0)) p.memory.writeU32(n(c, 0), started.pid);
    return 0;
  };
  lib.posix_spawn = posixSpawn(false); lib.posix_spawnp = posixSpawn(true);
  // popen(command, "r" | "w" [+ "e"]) / pclose: bionic's, over the kernel: a pipe, a child running /system/bin/sh -c command with its stdout (r) or stdin (w) on the pipe, and a
  // FILE* on this process's end; pclose closes the stream and waits for the child, answering its wait status
  lib.popen = (p, c) => {
    const command = str(p, n(c, 0)), mode = str(p, n(c, 1)), reading = mode[0] === 'r';
    if (!/^[rw]e?$/.test(mode)) return fail(p, EINVAL) && 0;
    const pair = p.malloc(8), saved = [c.x[0], c.x[1]];
    c.x[0] = BigInt(pair); c.x[1] = BigInt(mode.includes('e') ? 0x80000 : 0); const made = p.hostLibrary.pipe2(p, c); [c.x[0], c.x[1]] = saved;
    if (Number(BigInt.asIntN(64, BigInt(made))) < 0) { p.free(pair); return 0; }
    const readEnd = p.memory.int32(pair), writeEnd = p.memory.int32(pair + 4); p.free(pair);
    const objects = p.hostLibrary.__socketTable().objects, childEnd = reading ? writeEnd : readEnd, parentEnd = reading ? readEnd : writeEnd, o = objects.get(childEnd);
    o.refs = (o.refs ?? 1) + 1;   // the child's descriptor (released when it ends)
    const ofd = { kind: 'npipe', o, flags: reading ? 1 : 0, path: 'pipe', refs: 0, release: () => { if ((o.refs ?? 1) > 1) o.refs--; else o.pipe.closed = true; } };
    const started = spawn(p, '/system/bin/sh', ['sh', '-c', command], false, reading ? [null, ofd, null] : [ofd, null, null], 'popen');
    const closeFd = fd => { const keep = c.x[0]; c.x[0] = BigInt(fd); p.hostLibrary.close(p, c); c.x[0] = keep; };
    closeFd(childEnd);   // this process keeps only its end
    if (started.error) { closeFd(parentEnd); return fail(p, LINUX_ERRNO[started.error] ?? 2) && 0; }
    const keepFd = c.x[0], keepMode = c.x[1], modePtr = p.allocString(reading ? 'r' : 'w'); c.x[0] = BigInt(parentEnd); c.x[1] = BigInt(modePtr);
    const stream = p.hostLibrary.fdopen(p, c); c.x[0] = keepFd; c.x[1] = keepMode; p.free(modePtr);
    (p.popened ??= new Map()).set(Number(stream), started);
    return stream;
  };
  lib.pclose = (p, c) => {
    const ptr = Number(c.x[0]), started = p.popened?.get(ptr); if (!started) return fail(p, ECHILD);
    if (!started.streamClosed) { started.streamClosed = true; p.hostLibrary.fclose(p, c); }
    const got = p.threads.wait(c, () => started.state === 'Z', { what: 'pclose' });
    if (got === BLOCKED) return BLOCKED;
    p.popened.delete(ptr);
    return kernel().wait4(child(p) ?? kernel().app, started.pid, 0).status;
  };
  lib.ptrace = (p) => fail(p, EPERM);   // an untrusted_app's processes may not trace (the app seccomp filter and SELinux: no ptrace permission)
  return lib;
}

/** A wait of this process's native code that cannot suspend (src/arm64/threads.js) turns the kernel's other processes while it waits. */
function attachPump(p, k) { p.kernelPump ??= () => k.pump(); p.kernelNextTimer ??= () => k.nextDeadline(); }

/** The child of a fork: a copy of process `p` as the thread running on `cpu` sees it, with pid `pid`. */
function copyProcess(p, cpu, pid, { resume, childLibc }) {
  const child = Object.create(Object.getPrototypeOf(p));
  const memory = new Arm64Memory(p.memory.size, { base: p.memory.base, translate: !!p.memory.wasmMemory });
  // every mapping of the parent (its libraries, the regions of /proc/self/maps, the host stubs); an inaccessible reservation stays unbacked
  let copied = 0;
  const copyRange = (start, end) => { const from = Math.max(start, p.memory.base + 4096), to = Math.min(end, p.memory.base + p.memory.size); if (to <= from) return; memory.copyIn(from, p.memory.bytes(from, to - from)); copied += to - from; };
  for (const lib of p.order) copyRange(lib.base, lib.end);
  for (const r of p.regions) if (!r.perms.startsWith('---')) copyRange(r.start, r.end);
  if (p.stubs) copyRange(p.stubs.base, p.stubs.base + 16 * 65536);
  for (const t of p.threads.threads.values()) if (t.stack) copyRange(t.stack.base, t.stack.base + t.stack.size + 0x10000);
  copyRange(p.mainStack.base, p.mainStack.base + p.mainStack.size + 0x10000);
  Object.assign(child, {
    memory, readLibrary: p.readLibrary, log: p.log, hostIndex: new Map(p.hostIndex), hostNames: [...p.hostNames], recentHost: new Array(8).fill(null), recentAt: 0,
    libraries: new Map(p.libraries), order: [...p.order], nextMap: p.nextMap, heap: { free: new Map([...p.heap.free].map(([size, list]) => [size, [...list]])), sizes: new Map(p.heap.sizes) },
    atexit: [...p.atexit], tlsModules: [...(p.tlsModules ?? [])], tlsSize: p.tlsSize, regions: p.regions.map(r => ({ ...r })), mainStack: p.mainStack, tlsBase: p.tlsBase,
    pid, stubs: p.stubs ? { base: p.stubs.base, written: new Set(p.stubs.written) } : undefined, hostData: p.hostData ? new Map(p.hostData) : undefined, libraryPath: p.libraryPath,
    sharedMappings: p.sharedMappings ? [...p.sharedMappings] : undefined, copiedBytes: copied,
  });
  memory.recentCalls = () => []; memory.activeCpu = () => child.activeCpu;
  // the calling thread, as the child's only thread: its registers, its TLS and errno, returning 0 from the fork
  const thread = p.threads.current, c2 = new Arm64Cpu(memory, { host: (c, index) => child.dispatchHost(c, index), maxSteps: cpu.maxSteps });
  c2.x = [...cpu.x]; c2.vbuf.set(cpu.vbuf); c2.n = cpu.n; c2.z = cpu.z; c2.c = cpu.c; c2.v = cpu.v; c2.tpidr = cpu.tpidr; c2.fpcr = cpu.fpcr; c2.fpsr = cpu.fpsr;
  c2.x[0] = 0n; c2.pc = resume; c2.nested = 0; c2.describe = cpu.describe; c2.progress = cpu.progress; c2.watched = cpu.watched; c2.threadLabel = cpu.threadLabel; c2.budgetFrom = c2.steps;
  child.cpu = c2; child.activeCpu = c2; memory.cpu = c2;
  child.tp = thread.tp; child.errnoAddressMain = thread.errno;
  // the child's C library: its own descriptor table (the parent's descriptions), its own pid, its own processes (src/arm64/processes.js in the child)
  const host = childLibc(); host.__adoptFiles?.(p.hostLibrary); host.__adoptSockets?.(p.hostLibrary);
  host.getpid = () => pid; host.getppid = () => p.forkedChild?.pid ?? p.pid; host.getpgrp = () => host.getppid();
  host.exit = host._exit = (q, c) => { throw new ChildExit({ code: Number(BigInt.asIntN(32, c.x[0])) & 0xff }); };
  host.abort = () => { throw new ChildExit({ signal: 6 }); };
  host.__procfs?.attach?.(child);
  child.hostLibrary = host;
  child.signals = p.signals ? { actions: new Map(p.signals.actions), pending: [], deliver: p.signals.deliver, deliverable: p.signals.deliverable } : undefined;   // the dispositions are inherited, pending signals and timers are not
  host.__signalState?.(child);
  child.threads = new NativeThreads(child, { queueTask: null, log: p.log, now: p.threads.now });
  const main = child.threads.threads.get(pid); main.main = false; main.sigmask = thread.sigmask; main.forked = true; main.comm = thread.comm;   // a thread the kernel's driver suspends in a wait
  main.stack = thread.stack ?? p.mainStack;
  // the lab functions by index (the stubs in the copied memory name them): the child's libc, the per-process entries rebuilt, the Java runtime's missing in the child
  child.hostFns = child.hostNames.map((name, index) => {
    if (name === 'pthread:exit') return (q, c) => { q.threads.finish(q.threads.current, c.x[0]); c.exited = true; };
    if (name.startsWith('missing:') || name === 'tlsdesc:static') return p.hostFns[index];
    if (/^(jni|jnivm|libart|jni-wasm32):/.test(name)) return () => { throw new APKError(`ARM64 native code in a forked child called ${name}: the child has no Java runtime in the lab (JNI and ART calls of a forked child are not provided)`, { kind: 'arm64-fork', symbol: name }); };
    const fn = host[name];
    return typeof fn === 'function' ? fn : () => { throw new APKError(`ARM64 native code in a forked child called ${name}: not provided by the lab in a child process`, { kind: 'arm64-fork', symbol: name }); };
  });
  return child;
}

/** One turn of a forked ARM64 child for the kernel's driver (src/process-kernel.js): 'blocked' (proc.wait set), 'exited', or 'exec' (proc.pendingExec set). */
export function runForkedChild(kernel, proc) {
  const child = proc.native, t = child.threads.threads.get(proc.pid), cpu = t.cpu;
  for (let round = 0; round < 64; round++) {
    let outcome;
    child.activeCpu = cpu; child.threads.current = t;
    try { child.signals?.deliver?.(child, t); outcome = cpu.run(RETURN_SENTINEL, 20000); }
    catch (error) {
      if (error instanceof ChildExit) return { exit: error.status };
      const kind = error?.details?.kind, signal = kind === 'arm64-segv' || /segmentation fault/.test(error?.message ?? '') ? SIG.SEGV : kind === 'arm64-abort' ? (error.details.signal ?? SIG.ABRT) : SIG.SYS;
      kernel.record(`PROCESS ${proc.pid} (forked ARM64 child): ${error?.message ?? error} (signal ${signal})`);
      return { exit: { signal } };
    }
    if (proc.pendingExec) return { exec: true };
    if (outcome === 'blocked') {
      // a timer of the child (alarm, setitimer, timer_create) or a signal sent to it also ends the wait: its handler runs at the next turn, then the call is retried
      const now = () => child.threads.now(), timer = () => child.timerDeadline?.() ?? Infinity, deadline = Math.min(t.deadline ?? Infinity, t.wakeAt?.() ?? Infinity, timer());
      return { wait: { ready: () => t.ready?.() === true || now() >= deadline || now() >= timer() || child.signals?.deliverable?.(child, t) === true, reason: t.what ?? 'a native wait', deadline } };
    }
    if (outcome === 'exited' || t.state === 'done') return { exit: { code: 0 } };   // pthread_exit of the only thread: the process ends
    if (outcome === 'done') {
      kernel.record(`PROCESS ${proc.pid} (forked ARM64 child) returned from its native frames into the managed code that called them: a forked child runs native code only in the lab (signal ${SIG.SYS})`);
      return { exit: { signal: SIG.SYS } };
    }
  }
  return { wait: { ready: () => true, reason: 'yield', deadline: Infinity } };
}
