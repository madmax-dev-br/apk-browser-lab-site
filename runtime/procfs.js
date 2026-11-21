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
//     status, task/<tid>/status   Name, Umask, State, Tgid, Ngid, Pid, PPid, TracerPid, Uid, Gid, Threads (when the native process says how many), NoNewPrivs, Seccomp;
//                                 lines for state the VM does not model (memory counters, signal masks, capabilities, cpus) are left out rather than invented
//     cmdline                     the process name and its NUL (zygote renames the app process to its package)
//     comm, task/<tid>/comm       the thread's name (the kernel's 16-byte comm: zygote's / ART's SetThreadName rule, or what pthread_setname_np / PR_SET_NAME set)
//     task/                       one directory per thread: the main thread, the Java threads that called native code and the threads native code created (the ARM64
//                                 process's threads, src/arm64/threads.js); the main thread alone when there is no native process
//     fd/, fd/<n>, task/<tid>/fd  links to the files the process's descriptors have open, Java's (libcore's table) and the native code's; opening a link opens the file,
//                                 an unlinked one included ("<path> (deleted)")
//     exe                         a link to the zygote's executable, /system/bin/app_process64
//     maps, mem                   the ARM64 process's mappings (each library's segments, stacks, heap, ART's LinearAlloc and DEX mappings, mmap regions) and its memory at
//                                 offset = address. They exist when the app has its ARM64 native process; without one the lab has no native address space to list
// Anything else under the app's process directory is ENOENT, and the trace says the lab does not model it (once per path).
import { ZYGOTE_EXECUTABLE } from './virtual-pids.js?v=af8ff7411a95';

const encoder = new TextEncoder();
const text = value => encoder.encode(value);

/** The kernel comm of a thread named by zygote / ART (com_android_internal_os_Zygote.cpp and libartbase SetThreadName): a name of 15 characters or more that has a '.' and
 *  no '@' keeps its LAST 15 characters (com.android.systemui -> "ndroid.systemui"); any other name its first 15 (the 16-byte task comm). */
export function processComm(name) {
  const value = String(name ?? '');
  return value.length >= 15 && value.includes('.') && !value.includes('@') ? value.slice(-15) : value.slice(0, 15);
}

export function procStatus({ name, pid, tid = pid, ppid, uid, threads = null }) {
  return [`Name:\t${name}`, 'Umask:\t0077', 'State:\tR (running)', `Tgid:\t${pid}`, 'Ngid:\t0', `Pid:\t${tid}`, `PPid:\t${ppid}`, 'TracerPid:\t0',
    `Uid:\t${uid}\t${uid}\t${uid}\t${uid}`, `Gid:\t${uid}\t${uid}\t${uid}\t${uid}`, ...(threads ? [`Threads:\t${threads}`] : []), 'NoNewPrivs:\t0', 'Seccomp:\t2', 'Seccomp_filters:\t1', ''].join('\n');
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
  /** The entries of /proc itself the app can see (hidepid): its own process, by pid and as self / thread-self. */
  rootNames() { return ['self', 'thread-self', String(this.process.pid)]; }
  fdFile(n) { return this.java?.file(n) ?? this.native?.fdFile(n) ?? null; }
  fdNames() { return [...new Set([...(this.java?.list() ?? []), ...(this.native?.fdList() ?? [])])].sort((a, b) => a - b).map(String); }
  lookup(path) {
    const rel = this.relative(path); if (rel === null) return null;
    const { pid, ppid, uid } = this.process, threads = this.threads(), main = threads.find(t => t.tid === pid) ?? { tid: pid, main: true, synthetic: true };
    const status = t => text(procStatus({ name: this.commOf(t), pid, tid: t.tid, ppid, uid, threads: this.native ? threads.length : null }));
    if (rel === '') return { dir: ['cmdline', 'comm', 'exe', 'fd', ...(this.native ? ['maps', 'mem'] : []), 'status', 'task'] };
    if (rel === 'status') return { file: () => status(main) };
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
      this.record(`PROCFS /proc/self/${rel}: not modelled by the lab (ENOENT); /proc/self has status, cmdline, comm, exe, fd/, task/<tid>/{comm,status}${this.native ? ', maps and mem' : ' (maps and mem with the ARM64 native process)'}`);
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
  fs.procfs = new Procfs({ platform });   // the app's /proc/self, /proc/<pid>, /proc/thread-self: read through fs.node / list (its trace lines go to the runtime that attaches)
  for (const prefix of ['/dev', '/sys', '/proc']) fs.readOnly.add(prefix);
  return fs.procfs;
}
