import { APKError } from './apk-error.js?v=2dd890abb01e';
import { createHostRegistry } from './host-contract.js?v=2dd890abb01e';
import { ANDROID_IDS } from './android-ids-data.js?v=2dd890abb01e';

// The rest of android.os.Process over the browser VM's single virtual process (frameworks/base/core/java/android/os/Process.java and its JNI half
// core/jni/android_util_Process.cpp, android-13.0.0_r1). The uid arithmetic is the Java code verbatim; the natives follow the C++ control flow against the VM's
// one process: its pid/uid (platform.virtualProcess), a parent pid of 1 (the Os.getppid() binding), no other app processes, no scheduler and no cgroups.
// The pieces that need a kernel the VM does not have (/proc readers, pidfds, process groups, freezer, Zygote start) stay unbound and fail by their exact name.
const PROCESS = 'Landroid/os/Process;', STRING = 'Ljava/lang/String;';
const FIRST_APPLICATION_UID = 10000, FIRST_SDK_SANDBOX_UID = 20000, LAST_SDK_SANDBOX_UID = 29999, FIRST_APP_ZYGOTE_ISOLATED_UID = 90000, LAST_APP_ZYGOTE_ISOLATED_UID = 98999,
  FIRST_ISOLATED_UID = 99000, LAST_ISOLATED_UID = 99999;
const PER_USER_RANGE = 100000, SIGNAL_QUIT = 3, SIGNAL_KILL = 9, SIGNAL_USR1 = 10;
const SP_DEFAULT = -1, SP_CNT = 8, SP_FOREGROUND = 1, SP_TOP_APP = 5, SP_BACKGROUND = 0;
const EPERM = 1, ESRCH = 3, EINVAL = 22;
// Signals whose default action ends a process that installed no handler. ART takes SIGQUIT (thread dump) and SIGUSR1 (GC) for itself; SIGPIPE, SIGCHLD, SIGCONT and
// SIGWINCH are ignored or harmless on Android; stop signals need a scheduler the VM does not have.
const TERMINATING = new Set([1, 2, 4, 6, 7, 8, 9, 11, 12, 14, 15, 24, 25, 26, 27, 30, 31]);

export function createProcessHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const proc = () => platform.virtualProcess;
  const appId = uid => uid % PER_USER_RANGE;                       // UserHandle.getAppId
  const userId = uid => Math.trunc(uid / PER_USER_RANGE);          // UserHandle.getUserId
  const text = (r, value) => (value === null || value === undefined ? null : r.stringCharacters(value));
  const errnoException = (r, err, tid) => {                        // signalExceptionForError
    if (err === EINVAL) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid argument: ${tid}`);
    if (err === ESRCH) r.throwJava('Ljava/lang/IllegalArgumentException;', `Given thread ${tid} does not exist`);
    if (err === EPERM) r.throwJava('Ljava/lang/SecurityException;', `No permission to modify given thread ${tid}`);
    r.throwJava('Ljava/lang/RuntimeException;', 'Unknown error');
  };
  const statics = (name, signature, fn) => def(PROCESS, name, signature, fn, { static: true });

  statics('myPpid', '()I', () => 1);
  statics('isCoreUid', '(I)Z', (_r, _m, [uid]) => (uid >= 0 && appId(uid) < FIRST_APPLICATION_UID ? 1 : 0));   // UserHandle.isCore
  const isIsolated = uid => { uid = appId(uid); return (uid >= FIRST_ISOLATED_UID && uid <= LAST_ISOLATED_UID) || (uid >= FIRST_APP_ZYGOTE_ISOLATED_UID && uid <= LAST_APP_ZYGOTE_ISOLATED_UID) ? 1 : 0; };
  const isSdkSandboxUid = uid => { uid = appId(uid); return uid >= FIRST_SDK_SANDBOX_UID && uid <= LAST_SDK_SANDBOX_UID ? 1 : 0; };
  statics('isIsolated', '()Z', () => isIsolated(proc().uid));
  statics('isIsolated', '(I)Z', (_r, _m, [uid]) => isIsolated(uid));
  statics('isSdkSandboxUid', '(I)Z', (_r, _m, [uid]) => isSdkSandboxUid(uid));
  statics('getAppUidForSdkSandboxUid', '(I)I', (_r, _m, [uid]) => (uid - (FIRST_SDK_SANDBOX_UID - FIRST_APPLICATION_UID)) | 0);
  statics('toSdkSandboxUid', '(I)I', (_r, _m, [uid]) => (uid + (FIRST_SDK_SANDBOX_UID - FIRST_APPLICATION_UID)) | 0);
  statics('isSdkSandbox', '()Z', () => isSdkSandboxUid(proc().uid));
  statics('supportsProcesses', '()Z', () => 1);                     // "This method always returns true"

  // getpwnam / getgrnam as bionic answers them: the AID_ friendly names, u<user>_a<app> / u<user>_i<id> per-user names and oem_<N> for the OEM ranges.
  const named = (name, group) => {
    if (ANDROID_IDS.has(name)) return ANDROID_IDS.get(name);
    let match = /^u(\d+)_a(\d+)$/.exec(name);
    if (match && Number(match[2]) <= 9999) return Number(match[1]) * PER_USER_RANGE + FIRST_APPLICATION_UID + Number(match[2]);
    match = /^u(\d+)_i(\d+)$/.exec(name);
    if (match && Number(match[2]) <= 9999) return Number(match[1]) * PER_USER_RANGE + FIRST_APP_ZYGOTE_ISOLATED_UID + Number(match[2]);
    match = /^u(\d+)_a(\d+)_(cache|ext|ext_cache)$/.exec(name);
    if (group && match && Number(match[2]) <= 9999) return Number(match[1]) * PER_USER_RANGE + { cache: 20000, ext: 30000, ext_cache: 40000 }[match[3]] + Number(match[2]);
    match = /^all_a(\d+)$/.exec(name);
    if (group && match && Number(match[1]) <= 9999) return 50000 + Number(match[1]);
    match = /^oem_(\d+)$/.exec(name);
    if (match) { const id = Number(match[1]); if ((id >= 2900 && id <= 2999) || (id >= 5000 && id <= 5999)) return id; }
    return -1;
  };
  const lookup = group => (r, _m, [name]) => {                      // android_os_Process_getUidForName / getGidForName
    if (name === null || name === undefined) r.throwJava('Ljava/lang/NullPointerException;', null);
    const value = text(r, name);
    if (value.length === 0) return -1;
    if (/^[0-9]+$/.test(value)) return Number.parseInt(value, 10) | 0;   // all digits: atoi
    return named(value, group);
  };
  statics('getUidForName', `(${STRING})I`, lookup(false)); statics('getGidForName', `(${STRING})I`, lookup(true));

  // /proc/<pid>/status readers: the VM has one process, so these answer for it and report -1 (the value they start from) for every other pid.
  statics('getUidForPid', '(I)I', (_r, _m, [pid]) => (pid === proc().pid ? proc().uid : -1));
  statics('getParentPid', '(I)I', (_r, _m, [pid]) => (pid === proc().pid ? 1 : -1));
  statics('getThreadGroupLeader', '(I)I', (_r, _m, [tid]) => (tid === proc().pid ? proc().pid : -1));

  // Signals: sendSignal(pid, sig) is kill(pid, sig) for pid > 0 and ignores failures. The only process there is the app's own; a default-action terminating signal ends it
  // the way killProcess does, SIGQUIT / SIGUSR1 are the runtime's thread dump and GC requests, signal 0 and the rest change nothing.
  const sendSignal = (r, pid, signal, quiet) => {
    if (pid <= 0) return;
    if (!quiet) r.record(`SIGNAL pid=${pid} sig=${signal} [Process.sendSignal]`);
    if (pid !== proc().pid) return;                                  // ESRCH, ignored by the native
    if (signal === SIGNAL_QUIT) { r.record('SIGNAL SIGQUIT: thread dump requested [runtime signal catcher; no trace file in the browser VM]'); return; }
    if (signal === SIGNAL_USR1) { r.record('SIGNAL SIGUSR1: garbage collection requested [runtime signal catcher]'); return; }
    if (TERMINATING.has(signal)) throw new APKError(`Process.sendSignal(${pid}, ${signal}): the app terminated its own virtual process`, { kind: 'process-killed', pid, signal });
  };
  statics('sendSignal', '(II)V', (r, _m, [pid, signal]) => sendSignal(r, pid, signal, false));
  statics('sendSignalQuiet', '(II)V', (r, _m, [pid, signal]) => sendSignal(r, pid, signal, true));
  statics('killProcessQuiet', '(I)V', (r, _m, [pid]) => sendSignal(r, pid, SIGNAL_KILL, true));

  // Memory: the device profile the ActivityManager reports (4 GiB, half available); Pss is the VM heap's own footprint, 0 where no such process exists.
  const TOTAL = 4n * 1024n * 1024n * 1024n;
  statics('getTotalMemory', '()J', () => TOTAL); statics('getFreeMemory', '()J', () => TOTAL / 2n);
  statics('getPss', '(I)J', (r, _m, [pid]) => (pid === proc().pid ? BigInt(Math.floor((r.heap?.size ?? 0) * 64)) : 0n));

  // Scheduling: one thread, SCHED_OTHER at nice 0; anything needing privilege the app does not hold is refused as the C++ reports EPERM.
  const verifyGroup = (r, group) => { if (group < SP_DEFAULT || group >= SP_CNT) errnoException(r, EINVAL, group); };
  statics('setCanSelfBackground', '(Z)V', () => {});
  statics('getThreadScheduler', '(I)I', (r, _m, [tid]) => { if (tid !== proc().pid) errnoException(r, ESRCH, tid); return 0; });
  statics('setThreadScheduler', '(III)V', (r, _m, [tid, policy, priority]) => {
    if (tid !== proc().pid) errnoException(r, ESRCH, tid);
    if (policy !== 0 || priority !== 0) errnoException(r, EPERM, tid);   // SCHED_FIFO / SCHED_RR need CAP_SYS_NICE
  });
  statics('setThreadGroup', '(II)V', (r, _m, [tid, group]) => { verifyGroup(r, group); errnoException(r, EPERM, tid); });             // cgroup writes are denied to an app
  statics('setThreadGroupAndCpuset', '(II)V', (r, _m, [tid, group]) => { verifyGroup(r, group); errnoException(r, EPERM, tid); });
  statics('setProcessGroup', '(II)V', (r, _m, [pid, group]) => { verifyGroup(r, group); if (group === SP_FOREGROUND) errnoException(r, EINVAL, pid); errnoException(r, EPERM, pid); });
  statics('getProcessGroup', '(I)I', (r, _m, [pid]) => { if (pid !== proc().pid) errnoException(r, ESRCH, pid); return proc().foreground ? SP_TOP_APP : SP_BACKGROUND; });
  statics('getExclusiveCores', '()[I', r => r.newArray('[I', 0));   // no cpuset reserves cores for the top app: the native returns the empty set
  // pidfd_open does not exist in the VM (supportsPidFd would see ENOSYS): the Java fallbacks apply, kill(pid, 0) polling and /proc/<tid>/task/<pid> access for the one process.
  statics('supportsPidFd', '()Z', () => 0);
  statics('openPidFd', '(II)Ljava/io/FileDescriptor;', () => null);
  statics('isThreadInProcess', '(II)Z', (_r, _m, [tid, pid]) => (tid === proc().pid && pid === proc().pid ? 1 : 0));
  statics('waitForProcessDeath', '(II)V', (r, _m, [pid, timeout]) => {
    if (pid !== proc().pid) return;                                  // kill(pid, 0) answers ESRCH at once: the process is already gone
    if (timeout < 0) throw new APKError(`Process.waitForProcessDeath(${pid}, ${timeout}): waiting without a timeout for the app's own process can never finish in the single-threaded VM`, { kind: 'process-wait-forever', pid });
    r.throwJava('Ljava/util/concurrent/TimeoutException;', null);    // the process is alive for the whole timeout
  });
  statics('setUid', '(I)I', () => EPERM); statics('setGid', '(I)I', () => EPERM);   // setuid / setgid fail for an unprivileged process and the native returns errno
  return { ...registry };
}
