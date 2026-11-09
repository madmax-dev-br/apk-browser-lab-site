import { APKError } from './apk-error.js?v=a76ada5ef6c6';
import { lookup } from './libcore-io-native.js?v=a76ada5ef6c6';

// The natives under java.lang.ProcessBuilder / Process (libcore ojluni UNIXProcess.java, ProcessEnvironment.java; UNIXProcess_md.c semantics for the child that fails before exec):
// the virtual device's file system holds no executables, so starting a program fails the way a device does when it cannot run one, with the errno text the child reports:
//   not found anywhere on the search path   IOException "error=2, No such file or directory"   (ProcessBuilder.start adds: Cannot run program "x": ...)
//   a directory, or a file without an x bit  IOException "error=13, Permission denied"
//   a missing or non-directory working dir  "error=2, ..." / "error=20, Not a directory"
// A file that exists and is marked executable would need a CPU to run on: that is an explicit VM error, never a pretended success. Nothing here fakes su, sh or any other binary.
const ENV_NATIVE = 'Ljava/lang/ProcessEnvironment;->environ()[[B', FORK = 'Ljava/lang/UNIXProcess;->forkAndExec([B[BI[BI[B[IZ)I', WAIT = 'Ljava/lang/UNIXProcess;->waitForProcessExit(I)I';
const ERRNO_TEXT = { 2: 'No such file or directory', 13: 'Permission denied', 20: 'Not a directory' };
const C_STRING = bytes => { const text = []; for (const value of bytes) { if ((value & 255) === 0) break; text.push(value & 255); } return new TextDecoder().decode(Uint8Array.from(text)); };

export function createProcessNativeBindings() {
  const bindings = new Map();
  bindings.set(ENV_NATIVE, runtime => {   // alternating name, value byte arrays: the process environment (the one System.getenv() reports)
    const entries = Object.entries(runtime.platform.environment ?? {}), encoder = new TextEncoder();
    const outer = runtime.newArray('[[B', entries.length * 2);
    runtime.array(outer).elements = entries.flatMap(([name, value]) => [name, String(value)].map(text => { const array = runtime.newArray('[B', 0); runtime.array(array).elements = Array.from(encoder.encode(text), v => (v << 24) >> 24); return array; }));
    return outer;
  });
  bindings.set(FORK, (runtime, [, prog, , , , , dir]) => {
    const fail = errno => runtime.throwJava('Ljava/io/IOException;', `error=${errno}, ${ERRNO_TEXT[errno]}`);
    const fs = runtime.platform.javaIo.fs(), program = C_STRING(runtime.array(prog).elements);
    let cwd = '/';
    if (dir !== null && dir !== 0) {
      cwd = C_STRING(runtime.array(dir).elements); const found = lookup(fs, cwd);
      if (!found.node) fail(found.error === 'ENOTDIR' ? 20 : 2);
      if (found.node.type !== 'dir') fail(20);
    }
    const candidates = program.includes('/') ? [program.startsWith('/') ? program : `${cwd.replace(/\/$/, '')}/${program}`]
      : String(runtime.platform.environment?.PATH ?? '').split(':').filter(Boolean).map(entry => `${entry.replace(/\/$/, '')}/${program}`);
    let denied = false;
    for (const candidate of candidates) {
      const found = lookup(fs, candidate);
      if (!found.node) continue;
      if (found.node.type === 'dir' || !(found.node.mode & 0o111)) { denied = true; continue; }
      throw new APKError(`Cannot execute ${found.path}: the virtual device has no CPU to run a native executable (java.lang.ProcessBuilder / Runtime.exec)`, { kind: 'exec-unsupported', path: found.path });
    }
    return fail(denied ? 13 : 2);
  });
  bindings.set('Ljava/lang/UNIXProcess;->initIDs()V', () => {});   // caches JNI field ids; nothing to cache
  bindings.set(WAIT, () => { throw new APKError('UNIXProcess.waitForProcessExit: no process was ever started in the virtual device', { kind: 'exec-unsupported' }); });
  return bindings;
}
