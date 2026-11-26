// The kernel-provided files an Android app sees for its own process and for the platform: ONE model that Java (open, stat, readdir, readlink through the virtual file
// system, src/virtual-fs.js and src/libcore-io-native.js) and the app's ARM64 native code (src/arm64/libc.js) both read, with the same content.
//
// What exists and what the app's SELinux domain (untrusted_app, android-13.0.0_r1 system/sepolicy) may do with it:
// - /dev: the device directory (search and getattr for every domain). Its device nodes the native libc opens itself (src/arm64/libc.js DEVICES).
// - /sys/fs/selinux/enforce: selinuxfs, "allow domain selinuxfs:dir search; allow domain selinuxfs:file getattr;" (public/domain.te) and no read rule for app domains:
//   stat() works, open() is EACCES. The content is the enforcing state of a production device ("1"), never readable by the app.
// - /proc: mounted with hidepid=invisible on Android (system/core/rootdir/init.rc), so an app sees its own processes only: /proc/self, /proc/thread-self and
//   /proc/<its pid>. Every other pid (init's 1, zygote's, system_server's) does not exist for it.
//   Under the app's process directory, generated when opened (stat reports size 0, as procfs does):
//     status, task/<tid>/status   Name, Umask, State, Tgid, Ngid, Pid, PPid, TracerPid, Uid, Gid, the memory lines (VmPeak .. VmSwap), Threads (when the native process says
//                                 how many), NoNewPrivs, Seccomp; lines for state the VM does not model (signal masks, capabilities, cpus) are left out rather than invented
//     statm, smaps_rollup         the process's memory (src/process-memory.js: the native process's mappings and the VM's Java heap and native memory), the same figures as
//                                 status and Debug.MemoryInfo
//     cmdline                     the process name and its NUL (zygote renames the app process to its package)
//     comm, task/<tid>/comm       the thread's name (the kernel's 16-byte comm: zygote's / ART's SetThreadName rule, or what pthread_setname_np / PR_SET_NAME set)
//     task/                       one directory per thread: the main thread, the Java threads that called native code and the threads native code created (the ARM64
//                                 process's threads, src/arm64/threads.js); the main thread alone when there is no native process
//     fd/, fd/<n>, task/<tid>/fd  links to the files the process's descriptors have open, Java's (libcore's table) and the native code's; opening a link opens the file,
//                                 an unlinked one included ("<path> (deleted)")
//     exe                         a link to the zygote's executable, /system/bin/app_process64
//     maps, mem                   the ARM64 process's mappings (each library's segments, stacks, heap, ART's LinearAlloc and DEX mappings, mmap regions) and its memory at
//                                 offset = address. They exist when the app has its ARM64 native process; without one the lab has no native address space to list
//     stat                        the 52 fields of proc(5) (statLine below): each from the virtual process, or 0 where the lab keeps no such quantity (named there)
// - /proc/meminfo: MemTotal, MemFree, MemAvailable (the device's memory and what the app's process does not hold of it, as ActivityManager.getMemoryInfo reports them);
//   Buffers, Cached, SwapCached, SwapTotal and SwapFree are 0 (the virtual device has no page cache and no swap); the kernel's other counters are left out
// Anything else under the app's process directory is ENOENT, and the trace says the lab does not model it (once per path).
import { ZYGOTE_EXECUTABLE } from './virtual-pids.js?v=109fde337e64';
import { ART_BLOCKED } from './arm64/signals.js?v=109fde337e64';
import { mountsText, procVersionText, appSecurityContext } from './system-image.js?v=109fde337e64';
import { processMappings, smapsRollupText, statmText, statusMemoryLines, processMemory, deviceMemory, processCpuMs, PAGE_SIZE } from './process-memory.js?v=109fde337e64';

const encoder = new TextEncoder();
const text = value => encoder.encode(value);

/** The kernel comm of a thread named by zygote / ART (com_android_internal_os_Zygote.cpp and libartbase SetThreadName): a name of 15 characters or more that has a '.' and
 *  no '@' keeps its LAST 15 characters (com.android.systemui -> "ndroid.systemui"); any other name its first 15 (the 16-byte task comm). */
export function processComm(name) {
  const value = String(name ?? '');
  return value.length >= 15 && value.includes('.') && !value.includes('@') ? value.slice(-15) : value.slice(0, 15);
}

const CLK_TCK = 100;   // sysconf(_SC_CLK_TCK) of the lab's libc (src/arm64/libc.js)
const ticks = ms => Math.floor(Math.max(0, ms) / (1000 / CLK_TCK));
const signalBits = mask => BigInt.asUintN(64, mask ?? 0n) & 0x7fffffffn;   // do_task_stat prints sig[0] & 0x7fffffff

/**
 * /proc/self/stat (proc(5), fs/proc/array.c do_task_stat). From the virtual process: pid, comm, state (R: the process is running when it reads its own stat), ppid; pgrp and
 * session (zygote's, which the app inherits: the ARM64 libc's getpgrp / getsid); utime (the process's CPU time, src/process-memory.js processCpuMs, the figure
 * Process.getElapsedCpuTime gives; the lab keeps no user/system split, so stime is 0); priority 20 + nice and nice (Process.setThreadPriority of the main thread,
 * 0 by default); num_threads (task/'s threads); starttime (the VM clock when the process started, Process.getStartElapsedRealtime, in clock ticks since boot); vsize and rss
 * (statm's size and resident); rsslim (RLIMIT_RSS, unlimited: the lab's getrlimit); startstack (the main thread's stack top, with the ARM64 process); the signal bitmaps
 * (pending, blocked: the main thread's mask, ignored and caught: the ARM64 process's dispositions; ART blocks SIGPIPE, SIGQUIT and SIGUSR1 in every thread);
 * exit_signal 17 (SIGCHLD: zygote forked the process); processor 0 and policy 0 (sched_getcpu, sched_getscheduler).
 * 0 because the lab keeps no such quantity: flags (the kernel's PF_ flags), minflt / cminflt / majflt / cmajflt (no paging), startcode / endcode / start_data / end_data /
 * start_brk / arg_start / arg_end / env_start / env_end (no executable, argv or environment is mapped); 0 as Linux reports them for a live task of this kind: tty_nr (no
 * controlling terminal; tpgid -1), cutime / cstime (no child waited for), itrealvalue, kstkesp / kstkeip, wchan, nswap / cnswap, rt_priority, delayacct_blkio_ticks,
 * guest_time / cguest_time, exit_code.
 */
export function statLine(f) {
  const fields = [f.pid, `(${f.comm})`, f.state ?? 'R', f.ppid, f.pgrp, f.session, 0, -1, 0, 0, 0, 0, 0, ticks(f.cpuMs), 0, 0, 0, 20 + f.nice, f.nice, f.threads, 0, ticks(f.startMs),
    f.vsize, f.rss, '18446744073709551615', 0, 0, f.startStack ?? 0, 0, 0, signalBits(f.signals?.pending), signalBits(f.signals?.blocked), signalBits(f.signals?.ignored), signalBits(f.signals?.caught),
    0, 0, 0, 17, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return fields.join(' ') + '\n';
}
/** /proc/meminfo's lines (meminfo_proc_show: the name padded to 16 columns, the kB value right-aligned in 8). */
export function meminfoText({ total, available }) {
  const kb = bytes => Math.floor(bytes / 1024), line = (name, value) => `${(name + ':').padEnd(16)}${String(value).padStart(8)} kB`;
  return [line('MemTotal', kb(total)), line('MemFree', kb(available)), line('MemAvailable', kb(available)), line('Buffers', 0), line('Cached', 0), line('SwapCached', 0),
    line('SwapTotal', 0), line('SwapFree', 0), ''].join('\n');
}

export function procStatus({ name, pid, tid = pid, ppid, uid, threads = null, memory = [] }) {
  return [`Name:\t${name}`, 'Umask:\t0077', 'State:\tR (running)', `Tgid:\t${pid}`, 'Ngid:\t0', `Pid:\t${tid}`, `PPid:\t${ppid}`, 'TracerPid:\t0',
    `Uid:\t${uid}\t${uid}\t${uid}\t${uid}`, `Gid:\t${uid}\t${uid}\t${uid}\t${uid}`, ...memory, ...(threads ? [`Threads:\t${threads}`] : []), 'NoNewPrivs:\t0', 'Seccomp:\t2', 'Seccomp_filters:\t1', ''].join('\n');
}

/**
 * The /proc of the app's process. Providers attach as they come to exist: `attachJava({ file(n), list() })` (Java's descriptor table, src/libcore-io-native.js) and
 * `attachNative({ maps(), threads(), currentTid(), commOf(thread), fdFile(n), fdList() })` (the ARM64 process, src/arm64/libc.js).
 * `lookup(path)` answers for a path of the app's process: { dir: names } | { file: () => bytes } | { link: { path, deleted, node?, bytes() } } | { mem: true } | { missing: true },
 * or null for a path that is not one (another pid, or not under /proc).
 */
export class Procfs {
  constructor({ platform, record = () => {} }) { this.platform = platform; this.record = record; this.java = null; this.native = null; this.reported = new Set(); }
  attachJava(provider, record = null) { this.java = provider; if (record) this.record = record; }
  attachNative(provider, record = null) { this.native = provider; if (record) this.record = record; }
  /** The VM whose Java heap and native memory count in the process's memory (src/process-memory.js). */
  attachRuntime(runtime) { this.runtime = runtime; }
  /** The process's mappings: the native process's and the VM's (src/process-memory.js), the one source of status, statm, smaps_rollup and Debug.MemoryInfo. */
  memoryMappings() { return processMappings(this.runtime ?? this.platform.vmRuntime ?? null, this.native?.mappings ?? null); }
  /** The process kernel (src/process-kernel.js): its processes are the app's children, visible in /proc (same uid). */
  attachKernel(kernel) { this.kernel = kernel; }
  mountsText() { return text(mountsText()); }
  versionText() { return text(procVersionText(this.kernel?.runtime ?? null)); }
  context() { const p = this.platform.virtualProcess; return appSecurityContext(p.uid, Number(this.platform.manifest?.usesSdk?.targetSdkVersion ?? 33) || 33); }
  get process() { const p = this.platform.virtualProcess; return { pid: p.pid, ppid: p.ppid, uid: p.uid, name: this.platform.packageName ?? 'app_process' }; }
  /** The threads of the process: the native process's when there is one, else the main thread. */
  threads() { return this.native?.threads() ?? [{ tid: this.process.pid, main: true }]; }
  commOf(thread) { return this.native && !thread.synthetic ? this.native.commOf(thread) : processComm(this.process.name); }
  /** The process directory's relative path ("", "status", "task/123/comm"), or null when `path` is not under the app's /proc/self, /proc/thread-self or /proc/<pid>. */
  relative(path) {
    const parts = String(path).split('/').filter(part => part && part !== '.');
    if (parts[0] !== 'proc' || parts.length < 2) return null;
    const { pid } = this.process;
    if (parts[1] === 'thread-self') return ['task', String(this.native?.currentTid() ?? pid), ...parts.slice(2)].join('/');
    if (parts[1] === 'self' || parts[1] === String(pid)) return parts.slice(2).join('/');
    return null;
  }
  /** The entries of /proc itself the app can see (hidepid): its own process, by pid and as self / thread-self (and the processes it started). */
  rootNames() { return ['self', 'thread-self', String(this.process.pid), ...(this.kernel?.visiblePids().slice(1).map(String) ?? [])]; }
  /** The runtime the platform runs (its heap, its native process, its CPU time), or null before it exists. */
  /** The signal state of the process's main thread for stat: the ARM64 process's dispositions and masks, or ART's mask alone without one. */
  signalState() {
    const runtime = this.runtime ?? this.platform.vmRuntime ?? null, p = runtime?.arm64?.process ?? null, main = p?.threads?.threads.get(p.pid);
    if (!p) return { pending: 0n, blocked: ART_BLOCKED, ignored: 0n, caught: 0n };
    const bit = sig => 1n << BigInt(sig - 1); let pending = 0n, ignored = 0n, caught = 0n;
    for (const item of [...(p.signals?.pending ?? []), ...(main?.pendingSignals ?? [])]) pending |= bit(item.sig);
    for (const [sig, action] of p.signals?.actions ?? []) { if (action.handler === 1) ignored |= bit(sig); else if (action.handler > 1) caught |= bit(sig); }
    return { pending, blocked: main?.sigmask ?? ART_BLOCKED, ignored, caught };
  }
  stat(main, threads) {
    const { pid, ppid } = this.process, runtime = this.runtime ?? this.platform.vmRuntime ?? null, memory = processMemory(runtime, this.memoryMappings()), p = runtime?.arm64?.process ?? null;
    return statLine({ pid, comm: this.commOf(main), state: 'R', ppid, pgrp: ppid, session: ppid, cpuMs: processCpuMs(runtime), nice: this.platform.threadPriorities?.get(pid) ?? 0, threads: threads.length,
      startMs: this.platform.processStartMs ?? 0, vsize: memory.size * PAGE_SIZE, rss: memory.resident, startStack: p?.mainStack ? p.mainStack.base + p.mainStack.size : 0, signals: this.signalState() });
  }
  fdFile(n) { return this.java?.file(n) ?? this.native?.fdFile(n) ?? null; }
  fdNames() { return [...new Set([...(this.java?.list() ?? []), ...(this.native?.fdList() ?? [])])].sort((a, b) => a - b).map(String); }
  lookup(path) {
    const rel = this.relative(path); if (rel === null) return null;
    const { pid, ppid, uid } = this.process, threads = this.threads(), main = threads.find(t => t.tid === pid) ?? { tid: pid, main: true, synthetic: true };
    const status = t => text(procStatus({ name: this.commOf(t), pid, tid: t.tid, ppid, uid, threads: this.native ? threads.length : null, memory: statusMemoryLines(this.memoryMappings()) }));
    if (rel === '') return { dir: ['attr', 'cmdline', 'comm', 'exe', 'fd', ...(this.native ? ['maps', 'mem'] : []), 'mounts', 'smaps_rollup', 'stat', 'statm', 'status', 'task', 'wchan'] };
    if (rel === 'stat') return { file: () => text(this.stat(main, threads)) };
    if (rel === 'mounts') return { file: () => this.mountsText() };
    if (rel === 'wchan') return { file: () => text('0') };   // no kernel symbol for a task the VM runs (the kernel prints 0 without one)
    if (rel === 'attr') return { dir: ['current', 'prev'] };
    if (rel === 'attr/current' || rel === 'attr/prev') return { file: () => text(this.context() + '\0') };
    if (rel === 'status') return { file: () => status(main) };
    if (rel === 'statm') return { file: () => text(statmText(this.memoryMappings())) };
    if (rel === 'smaps_rollup') return { file: () => { const all = this.memoryMappings(), placed = all.filter(m => m.start !== undefined); return text(smapsRollupText(all, placed[0]?.start ?? 0, placed.at(-1)?.end ?? 0)); } };
    if (rel === 'cmdline') return { file: () => text(`${this.process.name}\0`) };
    if (rel === 'comm') return { file: () => text(this.commOf(main) + '\n') };
    if (rel === 'exe') return { link: { path: ZYGOTE_EXECUTABLE, deleted: false, bytes: () => null } };
    if (rel === 'maps' && this.native) return { file: () => text(this.native.maps()) };
    if (rel === 'mem' && this.native) return { mem: true };
    if (rel === 'task') return { dir: threads.map(t => String(t.tid)) };
    const fd = /^(?:task\/\d+\/)?fd(?:\/(\d+))?$/.exec(rel);
    if (fd) { if (fd[1] === undefined) return { dir: this.fdNames() }; const target = this.fdFile(Number(fd[1])); if (target) return { link: target }; }
    const task = /^task\/(\d+)(?:\/(comm|status|fd))?$/.exec(rel), thread = task && threads.find(t => t.tid === Number(task[1]));
    if (thread && task[2] === undefined) return { dir: ['comm', 'fd', 'status'] };
    if (thread && task[2] === 'comm') return { file: () => text(this.commOf(thread) + '\n') };
    if (thread && task[2] === 'status') return { file: () => status(thread) };
    if (!this.reported.has(rel)) {
      this.reported.add(rel);
      this.record(`PROCFS /proc/self/${rel}: not modelled by the lab (ENOENT); /proc/self has status, stat, statm, smaps_rollup, cmdline, comm, exe, fd/, task/<tid>/{comm,status}${this.native ? ', maps and mem' : ' (maps and mem with the ARM64 native process)'}`);
    }
    return { missing: true };
  }
  /** readlink of a /proc link (fd/<n>, exe): its target, " (deleted)" for an unlinked file; null when the path is not a link. */
  readlink(path) { const entry = this.lookup(path); return entry?.link ? `${entry.link.path}${entry.link.deleted ? ' (deleted)' : ''}` : null; }
}

export function installProcfs(fs, platform) {
  const dir = (path, mode = 0o555) => { if (!fs.node(path)) fs.put(path, { ...fs.directory(), mode }); };
  dir('/dev', 0o755); dir('/sys', 0o755); dir('/sys/fs', 0o755); dir('/sys/fs/selinux', 0o755);
  fs.put('/sys/fs/selinux/enforce', { type: 'file', buf: text('1'), size: 1, mtime: fs.now(), mode: 0o644, denyOpen: 'EACCES' });
  fs.procfs = new Procfs({ platform });
  // /proc's own files: /proc/mounts is a link to self/mounts (fs/proc/root.c), /proc/version the kernel (src/system-image.js), /proc/uptime the VM clock since boot
  fs.put('/proc/mounts', { type: 'link', target: 'self/mounts', mtime: fs.now(), mode: 0o777, uid: 0, gid: 0 });
  fs.put('/proc/version', { type: 'file', buf: new Uint8Array(0), size: 0, mtime: fs.now(), mode: 0o444, uid: 0, gid: 0, generate: () => fs.procfs.versionText() });
  fs.put('/proc/meminfo', { type: 'file', buf: new Uint8Array(0), size: 0, mtime: fs.now(), mode: 0o444, uid: 0, gid: 0, generate: () => text(meminfoText(deviceMemory(platform.vmRuntime ?? null))) });
  fs.put('/proc/uptime', { type: 'file', buf: new Uint8Array(0), size: 0, mtime: fs.now(), mode: 0o444, uid: 0, gid: 0, generate: () => { const up = (platform.clock?.now() ?? 0) / 1000; return text(`${up.toFixed(2)} 0.00\n`); } });   // the app's /proc/self, /proc/<pid>, /proc/thread-self: read through fs.node / list (its trace lines go to the runtime that attaches)
  for (const prefix of ['/dev', '/sys', '/proc']) fs.readOnly.add(prefix);
  return fs.procfs;
}
