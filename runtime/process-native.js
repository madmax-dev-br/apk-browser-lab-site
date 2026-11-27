import { APKError } from './apk-error.js?v=df19921e3eea';
import { lookup, allocateFd, state as libcoreState } from './libcore-io-native.js?v=df19921e3eea';
import { processKernel, newPipe, E as KERNEL_ERRNO, SIG } from './process-kernel.js?v=df19921e3eea';

// The natives under java.lang.ProcessBuilder / Process (libcore ojluni UNIXProcess.java, ProcessEnvironment.java, UNIXProcess_md.c):
//   forkAndExec   starts a program of the device's /system/bin (src/system-image.js: toybox, mksh as sh, toolbox) as a process of the lab's kernel (src/process-kernel.js), a
//                 child of the app with its own pid, the app's uid and SELinux domain, and the app's environment (or the one ProcessBuilder gives). The program is searched on
//                 the parent's PATH as UNIXProcess_md.c does (a name with '/' is used as it is). Its stdin, stdout and stderr are pipes whose other ends are the descriptors
//                 Process's streams read and write (or the files a Redirect opened); redirectErrorStream makes stderr the stdout pipe.
//   waitForProcessExit  waits for the process to end (the "process reaper" thread): its exit status, or 0x80 + the signal that ended it.
//   destroyProcess      SIGTERM (Process.destroy).
// A program that does not exist fails as the child does before exec on a device, with the errno text it reports:
//   not found anywhere on the search path   IOException "error=2, No such file or directory"   (ProcessBuilder.start adds: Cannot run program "x": ...)
//   a directory, or a file without an x bit  IOException "error=13, Permission denied"
//   a missing or non-directory working dir  "error=2, ..." / "error=20, Not a directory"
//   a file that is neither a program nor a "#!" script: run by /system/bin/sh with the inherited environment (bionic's execvp), else "error=2" (there is no /bin/sh)
// There is no su: /system/bin has what a production image has, and /system/xbin is empty. An ELF executable the app wrote needs a CPU the virtual device does not have: that
// is an explicit VM error, never a pretended success. The trace has one EXEC line per start: the program, its arguments, and how it ended (exit status or signal) or failed.
const ENV_NATIVE = 'Ljava/lang/ProcessEnvironment;->environ()[[B', FORK = 'Ljava/lang/UNIXProcess;->forkAndExec([B[BI[BI[B[IZ)I', WAIT = 'Ljava/lang/UNIXProcess;->waitForProcessExit(I)I';
const DESTROY = 'Ljava/lang/UNIXProcess;->destroyProcess(I)V';
const ERRNO_TEXT = { 2: 'No such file or directory', 8: 'Exec format error', 13: 'Permission denied', 20: 'Not a directory' };
const LINUX_ERRNO = { [KERNEL_ERRNO.NOENT]: 2, [KERNEL_ERRNO.ACCES]: 13, [KERNEL_ERRNO.NOTDIR]: 20, [KERNEL_ERRNO.NOEXEC]: 8, [KERNEL_ERRNO.LOOP]: 40 };
const C_STRING = bytes => { const text = []; for (const value of bytes) { if ((value & 255) === 0) break; text.push(value & 255); } return new TextDecoder().decode(Uint8Array.from(text)); };
const BLOCK = (runtime, block) => block === null || block === 0 ? null : new TextDecoder().decode(Uint8Array.from(runtime.array(block).elements, v => v & 255)).split('\0');

export function createProcessNativeBindings() {
  const bindings = new Map();
  bindings.set(ENV_NATIVE, runtime => {   // alternating name, value byte arrays: the process environment (the one System.getenv() reports)
    const entries = Object.entries(runtime.platform.environment ?? {}), encoder = new TextEncoder();
    const outer = runtime.newArray('[[B', entries.length * 2), cells = runtime.array(outer).elements;
    entries.flatMap(([name, value]) => [name, String(value)]).forEach((text, i) => {
      const bytes = encoder.encode(text), array = runtime.newArray('[B', bytes.length), target = runtime.array(array).elements;
      for (let j = 0; j < bytes.length; j++) target[j] = (bytes[j] << 24) >> 24;
      cells[i] = array;
    });
    return outer;
  });
  bindings.set(FORK, (runtime, [, prog, argBlock, argc, envBlock, envc, dir, fdArray, redirectErrorStream]) => {
    const fs = runtime.platform.javaIo.fs(), program = C_STRING(runtime.array(prog).elements);
    // UNIXProcess passes the arguments after argv[0] as one NUL-separated block of argc strings, and the environment as envc "NAME=value" strings (null: inherit)
    const args = (BLOCK(runtime, argBlock) ?? []).slice(0, argc), label = `${program}${args.length ? ' ' + args.join(' ').slice(0, 200) : ''}`;
    const fail = errno => { runtime.record?.(`EXEC ${label}: error=${errno}, ${ERRNO_TEXT[errno] ?? 'failed'}`); return runtime.throwJava('Ljava/io/IOException;', `error=${errno}, ${ERRNO_TEXT[errno] ?? 'failed'}`); };
    let cwd = '/';
    if (dir !== null && dir !== 0) {
      cwd = C_STRING(runtime.array(dir).elements); const found = lookup(fs, cwd);
      if (!found.node) fail(found.error === 'ENOTDIR' ? 20 : 2);
      if (found.node.type !== 'dir') fail(20);
      cwd = found.path;
    }
    const kernel = processKernel(runtime), app = { ...kernel.app, cwd };
    const environment = envBlock === null || envBlock === 0 ? Object.entries(runtime.platform.environment ?? {}).map(([name, value]) => `${name}=${value}`) : (BLOCK(runtime, envBlock) ?? []).slice(0, envc);
    const candidates = program.includes('/') ? [program] : String(runtime.platform.environment?.PATH ?? '').split(':').filter(Boolean).map(entry => `${entry.replace(/\/$/, '')}/${program}`);
    // A file the kernel cannot exec (ENOEXEC: no "#!", not a program) is retried as a shell script, as the child does: with the inherited environment (envBlock null) bionic's
    // execvp runs it with /system/bin/sh (__exec_as_script); with an environment of its own, UNIXProcess_md.c's JDK_execvpe tries /bin/sh, which Android does not have (ENOENT).
    const inherited = envBlock === null || envBlock === 0;
    let found = null, error = KERNEL_ERRNO.NOENT;
    for (const candidate of candidates) {
      let exec = kernel.resolveExec(app, candidate, [program, ...args]);
      if (exec.error === KERNEL_ERRNO.NOEXEC) exec = inherited ? kernel.resolveExec(app, '/system/bin/sh', ['/system/bin/sh', candidate, ...args]) : { error: KERNEL_ERRNO.NOENT };
      if (exec.error) { if (exec.error === KERNEL_ERRNO.ACCES) error = exec.error; if (program.includes('/')) { error = exec.error; break; } continue; }
      if (exec.elf) throw new APKError(`Cannot execute ${exec.path}: the virtual device has no CPU to run a native executable (java.lang.ProcessBuilder / Runtime.exec)`, { kind: 'exec-unsupported', path: exec.path });
      found = { ...exec, file: candidate }; break;
    }
    if (!found) return fail(LINUX_ERRNO[error] ?? 2);
    if (!kernel.available()) throw new APKError(`Runtime.exec ${label}: the system programs of /system/bin (vendor/system-programs) are not loaded in this VM`, { kind: 'exec-unsupported', path: found.path });
    // the three standard streams: a pipe where UNIXProcess passed -1 (its end goes back in fds[]), else the descriptor it passed (a Redirect's file)
    const fds = runtime.array(fdArray).elements, io = libcoreState(runtime), stdio = [];
    for (let n = 0; n < 3; n++) {
      if (n === 2 && redirectErrorStream) { stdio.push(stdio[1]); fds[2] = -1; continue; }
      if (fds[n] === -1) {
        const pipe = newPipe(), childEnd = kernel.pipeEnd(pipe, n === 0 ? 'r' : 'w');
        n === 0 ? pipe.writers++ : pipe.readers++;
        const javaEnd = { kind: 'pipe', pipe, acc: n === 0 ? 1 : 0, offset: 0, append: false, ownerTag: 0n, refs: 0, nonblock: false, onLastClose: () => { if (n === 0) pipe.writers--; else pipe.readers--; } };
        fds[n] = allocateFd(runtime, javaEnd, 0, true);
        stdio.push(childEnd);
      } else {
        const entry = io.table.get(fds[n]); if (!entry) fail(9);
        const desc = entry.desc; desc.refs++;
        stdio.push({ kind: 'java', desc, flags: desc.acc ?? 2, refs: 0, release: () => { desc.refs--; if (desc.refs === 0) desc.onLastClose?.(); } });
        fds[n] = -1;
      }
    }
    const proc = kernel.spawn({ exec: found, argv: found.argv, env: environment, cwd, stdio, label });
    return proc.pid;
  });
  bindings.set('Ljava/lang/UNIXProcess;->initIDs()V', () => {});   // caches JNI field ids; nothing to cache
  bindings.set(WAIT, (runtime, [, pid]) => {
    const kernel = runtime.platform.processKernel;
    if (!kernel) throw new APKError(`UNIXProcess.waitForProcessExit(${pid}): no process was ever started in the virtual device`, { kind: 'exec-unsupported' });
    return kernel.waitJava(pid);
  });
  bindings.set(DESTROY, (runtime, [pid]) => { const kernel = runtime.platform.processKernel; const proc = kernel?.process(pid); if (proc) kernel.signal(proc, SIG.TERM); });
  return bindings;
}
