// The process model of the virtual device: the programs of /system/bin (src/system-image.js, vendor/system-programs) run as processes of their own, children of the app.
//
// A process is one WebAssembly instance of its program (toybox, mksh or toolbox, built by scripts/build-system-programs.sh) with argv, envp, a descriptor table, a working
// directory, a uid and a pid (src/virtual-pids.js: after the app's, so they are the app's children). Its C library's system calls (scripts/wasm/system-programs/lab-kernel.c)
// come here and run over the virtual device's own state: the file system (src/virtual-fs.js) with the image's files, the app's /proc (src/procfs.js) and the processes' own,
// the property table SystemProperties reads (src/device-identity.js), the identity's uname, the mount table (src/system-image.js), the app's uid and SELinux domain.
//
// Scheduling: each process runs as a thread of the VM's scheduler (src/scheduler.js), with no Java frames; its driver runs the instance until it waits or ends. A process
// that waits (a read on an empty pipe, wait4, sigsuspend, a sleep, a write to a full pipe) unwinds its WebAssembly stack with Asyncify and parks; when the wait is over the
// stack is rewound and the system call is made again. fork() copies the instance: a new instance of the same module receives the parent's memory and stack pointer, and both
// rewind from the fork, the parent with the child's pid, the child with 0. execve() replaces the instance with the new program's. Descriptors are open file descriptions
// shared between processes (fork, dup) with reference counts; pipes are the byte queues Java's own pipes use (src/libcore-io-native.js), so the app's Process streams and the
// processes' descriptors are the two ends of one pipe.
//
// What an untrusted_app's processes may not do fails as it fails on a device: no write to the read-only partitions (EROFS), no listing of /data or another app's data
// (EACCES), no other uid's processes in /proc (hidepid=invisible: ENOENT), no mount, module, reboot, time or hostname changes (EPERM), no relabeling (EACCES).
// What the lab does not model fails naming it (ENOSYS and a trace line): sockets, inotify, timers.
import { Blocked, VMThread } from './scheduler.js?v=a737601fbbdf';
import { APP_PID, ZYGOTE_PID, INIT_PID } from './virtual-pids.js?v=a737601fbbdf';
import { deviceProperty, devicePropertyNames } from './device-identity.js?v=a737601fbbdf';
import { ANDROID_IDS } from './android-ids-data.js?v=a737601fbbdf';
import { installSystemImage, SEARCH_ONLY, mountOf, mountTable, unameFields, appSecurityContext, IMAGE_TIME_MS } from './system-image.js?v=a737601fbbdf';
import { processComm } from './procfs.js?v=a737601fbbdf';
import { inode, state as libcoreState } from './libcore-io-native.js?v=a737601fbbdf';
import { runForkedChild } from './arm64/processes.js?v=a737601fbbdf';

// errno as the programs' C library numbers them (Emscripten's libc uses WASI's numbering; strerror gives the usual text)
export const E = { ACCES: 2, AFNOSUPPORT: 5, AGAIN: 6, BADF: 8, BUSY: 10, CHILD: 12, EXIST: 20, FAULT: 21, INTR: 27, INVAL: 28, IO: 29, ISDIR: 31, LOOP: 32, MFILE: 33, NAMETOOLONG: 37,
  NODATA: 61, NODEV: 43, NOENT: 44, NOEXEC: 45, NOMEM: 48, NOSPC: 51, NOSYS: 52, NOTDIR: 54, NOTEMPTY: 55, NOTSUP: 58, NOTTY: 59, NXIO: 60, PERM: 63, PIPE: 64, RANGE: 68, ROFS: 69,
  SPIPE: 70, SRCH: 71, XDEV: 75 };
const ERRNO_BY_NAME = { EACCES: E.ACCES, ENOENT: E.NOENT, ENOTDIR: E.NOTDIR, EISDIR: E.ISDIR, EEXIST: E.EXIST, ENOTEMPTY: E.NOTEMPTY, EINVAL: E.INVAL, EROFS: E.ROFS, EPERM: E.PERM, EBUSY: E.BUSY };
// Linux's signals (the programs' signal.h numbers them as Linux does)
export const SIG = { HUP: 1, INT: 2, QUIT: 3, ILL: 4, TRAP: 5, ABRT: 6, BUS: 7, FPE: 8, KILL: 9, USR1: 10, SEGV: 11, USR2: 12, PIPE: 13, ALRM: 14, TERM: 15, CHLD: 17, CONT: 18, STOP: 19, TSTP: 20, SYS: 31 };
const O = { ACCMODE: 3, RDONLY: 0, WRONLY: 1, RDWR: 2, CREAT: 0o100, EXCL: 0o200, NOCTTY: 0o400, TRUNC: 0o1000, APPEND: 0o2000, NONBLOCK: 0o4000, DIRECTORY: 0o200000, NOFOLLOW: 0o400000, CLOEXEC: 0o2000000, PATH: 0o10000000 };
const AT_FDCWD = -100, AT_SYMLINK_NOFOLLOW = 0x100, AT_REMOVEDIR = 0x200, AT_EMPTY_PATH = 0x1000;
const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFREG = 0o100000, S_IFLNK = 0o120000, S_IFIFO = 0o010000, S_IFCHR = 0o020000;
const WNOHANG = 1, PIPE_CAPACITY = 65536, ASYNC_BYTES = 1 << 20, SLICE_MS = 25;
const UNWINDING = 1, REWINDING = 2;
/** st_dev of a mount (src/system-image.js mountTable): dm-N is 253:N, loopN 7:N, the FUSE mount 0:43, the others anonymous devices 0:N in table order. */
const deviceOf = mount => { if (!mount) return 1; const [source] = mount; if (source.startsWith('/dev/block/dm-')) return (253 << 8) | Number(source.slice(14)); if (source.startsWith('/dev/block/loop')) return (7 << 8) | Number(source.slice(15)); if (source === '/dev/fuse') return 43; return 20 + mountIndex(mount); };
const mountIndex = mount => mountTable().findIndex(entry => entry[1] === mount[1]);
const encoder = new TextEncoder(), decoder = new TextDecoder();
const text = value => encoder.encode(value);
/** Character devices of /dev a process may open (devices.cpp ueventd permissions: 0666 for these). */
const DEVICES = { '/dev/null': { rdev: 0x103 }, '/dev/zero': { rdev: 0x105 }, '/dev/full': { rdev: 0x107 }, '/dev/random': { rdev: 0x108 }, '/dev/urandom': { rdev: 0x109 }, '/dev/tty': { rdev: 0x500, noctty: true } };
const random = length => { const out = new Uint8Array(length); for (let at = 0; at < length; at += 65536) globalThis.crypto.getRandomValues(out.subarray(at, Math.min(length, at + 65536))); return out; };

/** How a process ended: { code } (exit status) or { signal }. */
class ProcessEnd extends Error { constructor(status) { super(status.signal ? `killed by signal ${status.signal}` : `exit ${status.code}`); this.status = status; } }
/** A system call that has to wait: the process unwinds and parks until ready() (or the deadline, in VM clock milliseconds). */
class Wait { constructor(ready, reason, deadline = Infinity) { this.ready = ready; this.reason = reason; this.deadline = deadline; } }

/** A pipe: the same byte queue shape as Java's pipes (src/libcore-io-native.js pipe2), with reader and writer counts over every holder. */
export function newPipe() { return { chunks: [], size: 0, readers: 0, writers: 0 }; }
function pipeTake(pipe, count) {
  const taken = []; let need = Math.min(count, pipe.size);
  while (need > 0) { const chunk = pipe.chunks[0]; if (chunk.length <= need) { taken.push(chunk); need -= chunk.length; pipe.chunks.shift(); } else { taken.push(chunk.subarray(0, need)); pipe.chunks[0] = chunk.subarray(need); need = 0; } }
  const out = new Uint8Array(taken.reduce((n, c) => n + c.length, 0)); let at = 0; for (const c of taken) { out.set(c, at); at += c.length; }
  pipe.size -= out.length; return out;
}

/** The process kernel of a runtime (one per virtual device), created on first use. `programs`: { modules: { toybox, mksh, toolbox }: WebAssembly.Module, bytes }. */
export function processKernel(runtime) {
  const platform = runtime.platform;
  return platform.processKernel ??= new ProcessKernel(runtime);
}

export class ProcessKernel {
  constructor(runtime) {
    this.runtime = runtime; this.platform = runtime.platform; this.processes = new Map(); this.nextPid = APP_PID + 64; this.reported = new Set(); this.locks = new Map();
    this.programs = runtime.systemPrograms ?? this.platform.systemPrograms ?? null;
    installSystemImage(this.fs, this.programs);
    this.fs.procfs?.attachKernel?.(this);
  }
  get fs() { return this.platform.javaIo.fs(); }
  get clock() { return this.platform.clock; }
  record(line) { this.runtime.record?.(line); }
  note(key, line) { if (!this.reported.has(key)) { this.reported.add(key); this.record(line); } }
  /** The app's own process as the kernel's processes see it (their parent). */
  get app() {
    const p = this.platform.virtualProcess;
    return { pid: p.pid, ppid: p.ppid ?? ZYGOTE_PID, uid: p.uid, gid: p.uid, pgid: p.pid, sid: p.pid, comm: processComm(this.platform.packageName ?? 'app_process'), app: true, cwd: '/', groups: this.groupsOf(p.uid) };
  }
  appTargetSdk() { return Number(this.platform.manifest?.usesSdk?.targetSdkVersion ?? 33) || 33; }
  context() { return appSecurityContext(this.platform.virtualProcess.uid, this.appTargetSdk()); }
  /** The supplementary groups zygote gives an app: its own gid, inet with INTERNET (platform.xml), everybody, its cache gid and its shared gid (Process.java, ZygoteProcess). */
  groupsOf(uid) {
    const appId = uid % 100000, user = Math.floor(uid / 100000), permissions = this.platform.manifest?.usesPermissions ?? [];
    const names = (Array.isArray(permissions) ? permissions : []).map(p => typeof p === 'string' ? p : p?.name);
    return [uid, ...(names.includes('android.permission.INTERNET') ? [3003] : []), 9997, user * 100000 + 20000 + (appId - 10000), 50000 + (appId - 10000)].filter((g, i, all) => all.indexOf(g) === i);
  }
  available() { return !!this.programs?.modules; }
  /** The pids the app's processes may see in /proc (hidepid=invisible: the processes of its own uid), the app's own first. */
  visiblePids() { return [this.app.pid, ...[...this.processes.values()].filter(p => p.state !== 'X').map(p => p.pid)]; }
  process(pid) { return this.processes.get(pid) ?? null; }

  // ---- paths ------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** Resolves `path` for `proc` (relative to `dirfd` or its cwd), following symbolic links (the last one only when `follow`). { path, node } or { error }. */
  walk(proc, path, { dirfd = AT_FDCWD, follow = true } = {}) {
    if (typeof path !== 'string') return { error: E.FAULT };
    if (path === '') return { error: E.NOENT };
    if (path.length > 4095) return { error: E.NAMETOOLONG };
    let base = proc.cwd ?? '/';
    if (!path.startsWith('/') && dirfd !== AT_FDCWD) { const entry = proc.fds?.get(dirfd); if (!entry) return { error: E.BADF }; if (entry.ofd.kind !== 'dir') return { error: E.NOTDIR }; base = entry.ofd.path; }
    let parts = (path.startsWith('/') ? path : `${base}/${path}`).split('/').filter(Boolean), out = [], hops = 0;
    while (parts.length) {
      const part = parts.shift();
      if (part === '.') continue;
      if (part === '..') { out.pop(); continue; }
      out.push(part);
      const p = this.canonical(proc, '/' + out.join('/')), node = this.lnode(proc, p);
      if (node?.type === 'link' && (parts.length || follow)) {
        if (++hops > 40) return { error: E.LOOP };
        out.pop(); const target = node.target;
        if (target.startsWith('/')) out = []; else { const at = p.lastIndexOf('/'); out = p.slice(1, at > 0 ? at : 1).split('/').filter(Boolean); }
        parts = [...target.split('/').filter(Boolean), ...parts]; continue;
      }
      if (parts.length) { if (!node) return { error: E.NOENT }; if (node.type !== 'dir') return { error: E.NOTDIR }; }
      if (parts.length && out.length === 1 && p === '/proc') continue;
    }
    const p = this.canonical(proc, '/' + out.join('/'));
    return { path: p, node: this.lnode(proc, p) };
  }
  canonical(proc, p) {
    const c = this.fs.canonical(p);
    if (c === '/proc/self' || c.startsWith('/proc/self/')) return `/proc/${proc.pid}${c.slice(10)}`;
    if (c === '/proc/thread-self' || c.startsWith('/proc/thread-self/')) return `/proc/${proc.pid}/task/${proc.pid}${c.slice(17)}`;
    return c;
  }
  /** The node at canonical path `p` without following a final link: the processes' /proc, the device nodes, then the file system. */
  lnode(proc, p) {
    if (p === '/proc' || p.startsWith('/proc/')) { const node = this.procNode(proc, p); if (node !== undefined) return node; }
    const device = DEVICES[p]; if (device) return { type: 'chr', mode: 0o666, rdev: device.rdev, mtime: IMAGE_TIME_MS, uid: 0, gid: 0, device: p, ino: 0x1000 + device.rdev };
    return this.fs.nodes.get(p) ?? null;
  }
  ownerOf(path, node) {
    if (node?.uid !== undefined) return { uid: node.uid, gid: node.gid ?? node.uid };
    const uid = this.platform.virtualProcess.uid, pkg = this.platform.packageName ?? '', codePath = this.fs.codePath ?? '';
    if (path.startsWith(`/data/user/0/${pkg}`) || path.startsWith('/storage/emulated/0')) return { uid, gid: uid };
    if (codePath && path.startsWith(codePath)) return { uid: 1000, gid: 1000 };
    if (path === '/data/local/tmp') return { uid: 2000, gid: 2000 };
    if (path === '/data' || path === '/data/user' || path === '/data/user/0' || path === '/data/app') return { uid: 1000, gid: 1000 };
    return { uid: 0, gid: 0 };
  }
  /** DAC permission check (`want`: 4 read, 2 write, 1 search/execute) of `node` at `path` for `proc`. */
  permits(proc, path, node, want) {
    const { uid, gid } = this.ownerOf(path, node), mode = node.mode ?? 0o755;
    const bits = proc.uid === uid ? (mode >> 6) & 7 : (proc.groups ?? []).includes(gid) || proc.gid === gid ? (mode >> 3) & 7 : mode & 7;
    return (bits & want) === want;
  }
  /** Why `proc` may not write under `path`: EROFS on a read-only mount, EACCES for the kernel's file systems and for files of another owner; 0 when it may. */
  writeDenied(proc, path, node = null) {
    const mount = mountOf(path); if (mount && mount[3].startsWith('ro')) return E.ROFS;
    if (path === '/proc' || path.startsWith('/proc/') || path.startsWith('/sys') || path.startsWith('/dev')) return E.ACCES;
    if (this.fs.isReadOnly(path)) return E.ACCES;
    if (node && !this.permits(proc, path, node, 2)) return E.ACCES;
    return 0;
  }

  // ---- /proc of the processes ----------------------------------------------------------------------------------------------------------------------------------------------
  /** The /proc node at `p` for `proc`: undefined when the app's model (src/procfs.js, through the file system) answers, null when it does not exist for this viewer. */
  procNode(proc, p) {
    const fs = this.fs, parts = p.split('/').filter(Boolean);
    if (parts.length === 1) return { type: 'dir', mode: 0o555, mtime: this.bootTime(), names: () => this.procRootNames(), uid: 0, gid: 0, ino: 1 };
    if (parts[1] === 'self') return { type: 'link', target: String(proc.pid), mode: 0o777, uid: 0, gid: 0, mtime: this.bootTime() };
    if (parts[1] === 'thread-self') return { type: 'link', target: `${proc.pid}/task/${proc.pid}`, mode: 0o777, uid: 0, gid: 0, mtime: this.bootTime() };
    if (!/^\d+$/.test(parts[1])) return fs.nodes.get(p) ?? null;
    const pid = Number(parts[1]);
    if (pid === this.app.pid) return this.appProcNode(p, parts);   // the app's own process: the model Java reads (src/procfs.js)
    const target = this.processes.get(pid);
    if (!target || target.state === 'X' || target.uid !== proc.uid) return null;   // hidepid=invisible
    return this.procOf(target, parts.slice(2));
  }
  /** A path of the app's own /proc/<pid> as its child processes see it: src/procfs.js's model, with fd/<n> as the links they are (a pipe, a socket, a file, an unlinked one). */
  appProcNode(p, parts) {
    const fs = this.fs, uid = this.app.uid, entry = fs.procfs?.lookup(p), mtime = this.bootTime();
    const fd = parts[2] === 'fd' && parts.length === 4 ? Number(parts[3]) : (parts[2] === 'task' && parts[4] === 'fd' && parts.length === 6 ? Number(parts[5]) : null);
    if (fd !== null) {
      const desc = libcoreState(this.runtime).table.get(fd)?.desc, link = entry?.link;
      const target = link ? `${link.path}${link.deleted ? ' (deleted)' : ''}` : desc ? this.javaFdName(desc) : this.runtime.nativeOwnsFd?.(fd) ? `anon_inode:[native ${fd}]` : null;
      if (!target) return null;
      const access = desc ? (desc.acc ?? 2) & O.ACCMODE : O.RDWR;
      return { type: 'link', target, mode: (access !== O.WRONLY ? 0o500 : 0) | (access !== O.RDONLY ? 0o300 : 0), size: 64, uid, gid: uid, mtime, procLink: true, fdNode: link?.node ?? null };
    }
    if (!entry || entry.missing) return null;
    if (entry.dir) return { type: 'dir', mode: parts[2] === 'fd' ? 0o500 : 0o555, uid, gid: uid, mtime, names: () => fs.procfs.lookup(p)?.dir ?? [], ino: this.app.pid * 64 + parts.length };
    if (entry.file) return { type: 'file', mode: 0o444, uid, gid: uid, size: 0, mtime, generate: entry.file };
    if (entry.link) return { type: 'link', target: entry.link.path, mode: 0o777, uid, gid: uid, mtime, procLink: true };
    if (entry.mem) return { type: 'file', mode: 0o600, uid, gid: uid, size: 0, mtime, denyOpen: 'EACCES' };   // /proc/<pid>/mem of another process: ptrace access mode, which a child does not have
    return null;
  }
  /** What /proc/<pid>/fd/<n> names for a descriptor of the app's Java side (src/libcore-io-native.js). */
  javaFdName(desc) {
    if (desc.node) return desc.node.path ?? '/dev/null';
    const ino = desc.ino ??= 4000 + (this.pipeCounter = (this.pipeCounter ?? 0) + 1);
    if (desc.kind === 'pipe') return `pipe:[${desc.pipe.ino ??= ino}]`;
    if (desc.kind === 'socket') return `socket:[${ino}]`;
    if (desc.kind === 'std') return '/dev/null';   // an app's standard streams (zygote redirects them to /dev/null)
    return `anon_inode:[${desc.kind}]`;
  }
  procRootNames() { return [...new Set([...(this.fs.list('/proc') ?? []).filter(name => !/^\d+$/.test(name) && name !== 'self' && name !== 'thread-self'), 'self', 'thread-self', ...this.visiblePids().map(String)])]; }
  /** A /proc path of one of the kernel's processes as Java reads it (src/virtual-fs.js procNode): its files and directories (links resolved by name). */
  javaProcNode(p) {
    const parts = p.split('/').filter(Boolean); if (parts.length < 2 || !/^\d+$/.test(parts[1])) return null;
    const target = this.processes.get(Number(parts[1])); if (!target || target.state === 'X' || target.uid !== this.app.uid) return null;
    const node = this.procOf(target, parts.slice(2)); if (!node) return null;
    if (node.type === 'dir') return { ...node, procNames: node.names(), path: p };
    if (node.type === 'file') return { ...node, buf: new Uint8Array(0), path: p };
    return node.fdOfd?.node ?? null;
  }
  bootTime() { return this.clock.wall() - this.clock.now(); }
  procOf(target, rest) {
    const file = (generate, mode = 0o444) => ({ type: 'file', mode, uid: target.uid, gid: target.uid, size: 0, mtime: target.startWall, generate });
    const dir = names => ({ type: 'dir', mode: 0o555, uid: target.uid, gid: target.uid, mtime: target.startWall, names: typeof names === 'function' ? names : () => names, ino: target.pid * 64 + 7 });
    const link = (to, deleted = false) => ({ type: 'link', target: to, mode: 0o777, uid: target.uid, gid: target.uid, mtime: target.startWall, procLink: true, deleted });
    const tid = String(target.pid);
    if (rest.length === 0) return dir(['attr', 'cmdline', 'comm', 'cwd', 'environ', 'exe', 'fd', 'mounts', 'stat', 'statm', 'status', 'task', 'wchan']);
    const [name, ...more] = rest;
    if (name === 'task') { if (more.length === 0) return dir([tid]); if (more[0] !== tid) return null; return more.length === 1 ? dir(['comm', 'stat', 'status']) : this.procOf(target, more.slice(1)); }
    if (more.length && name !== 'fd' && name !== 'attr') return null;
    switch (name) {
      case 'stat': return file(() => text(this.statLine(target)));
      case 'statm': { return file(() => { const pages = Math.ceil((target.x?.memory.buffer.byteLength ?? 0) / 4096); return text(`${pages} ${pages} 0 0 0 ${pages} 0\n`); }); }
      case 'status': return file(() => text(this.statusText(target)));
      case 'cmdline': return file(() => text(target.argv.map(a => a + '\0').join('')));
      case 'environ': return file(() => text(target.env.map(a => a + '\0').join('')), 0o400);
      case 'comm': return file(() => text(target.comm + '\n'), 0o644);
      case 'wchan': return file(() => text('0'));
      case 'mounts': return file(() => this.fs.procfs?.mountsText?.() ?? text(''));
      case 'exe': return link(target.exe);
      case 'cwd': return link(target.cwd);
      case 'attr': if (more.length === 0) return dir(['current', 'prev']); if (more.length === 1 && (more[0] === 'current' || more[0] === 'prev')) return file(() => text(this.context() + '\0'), 0o666); return null;
      case 'fd': {
        if (more.length === 0) return { ...dir(() => [...target.fds.keys()].sort((a, b) => a - b).map(String)), mode: 0o500 };
        const entry = target.fds.get(Number(more[0])); if (!entry || more.length > 1) return null;
        const access = (entry.ofd.flags ?? 2) & O.ACCMODE;   // fs/proc/fd.c: r-x for a reading description, -wx for a writing one, both for read-write; st_size 64
        return { ...link(this.ofdName(entry.ofd)), mode: (access !== O.WRONLY ? 0o500 : 0) | (access !== O.RDONLY ? 0o300 : 0), size: 64, fdOfd: entry.ofd };
      }
    }
    return null;
  }
  ofdName(ofd) {
    if (ofd.kind === 'pipe') return `pipe:[${ofd.pipe.ino ??= 4000 + (this.pipeCounter = (this.pipeCounter ?? 0) + 1)}]`;
    if (ofd.kind === 'npipe') return `pipe:[${ofd.o.pipe.ino ??= 4000 + (this.pipeCounter = (this.pipeCounter ?? 0) + 1)}]`;
    if (ofd.kind === 'java') return ofd.desc.node?.path ?? (ofd.desc.kind === 'pipe' ? `pipe:[${ofd.desc.pipe.ino ??= 4000 + (this.pipeCounter = (this.pipeCounter ?? 0) + 1)}]` : '/dev/null');
    return ofd.path;
  }
  statLine(p) {
    const state = p.state === 'Z' ? 'Z' : p.wait ? 'S' : 'R', ticks = ms => Math.floor(ms / 10), memory = p.x?.memory.buffer.byteLength ?? 0;
    const fields = [p.pid, `(${p.comm})`, state, p.ppid, p.pgid, p.sid, 0, -1, 0x400000, 0, 0, 0, 0, ticks(p.cpuMs), 0, ticks(p.childCpuMs), 0, 20, 0, 1, 0, ticks(p.startMs), memory, Math.ceil(memory / 4096),
      '18446744073709551615', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, SIG.CHLD, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, p.state === 'Z' ? this.waitStatus(p.status) : 0];
    return fields.join(' ') + '\n';
  }
  statusText(p) {
    const state = p.state === 'Z' ? 'Z (zombie)' : p.wait ? 'S (sleeping)' : 'R (running)', kb = Math.ceil((p.x?.memory.buffer.byteLength ?? 0) / 1024);
    return [`Name:\t${p.comm}`, `Umask:\t${p.umask.toString(8).padStart(4, '0')}`, `State:\t${state}`, `Tgid:\t${p.pid}`, 'Ngid:\t0', `Pid:\t${p.pid}`, `PPid:\t${p.ppid}`, 'TracerPid:\t0',
      `Uid:\t${p.uid}\t${p.uid}\t${p.uid}\t${p.uid}`, `Gid:\t${p.gid}\t${p.gid}\t${p.gid}\t${p.gid}`, `FDSize:\t${Math.max(64, 2 ** Math.ceil(Math.log2(p.fds.size + 1)))}`, `Groups:\t${p.groups.join(' ')} `,
      `VmSize:\t${String(kb).padStart(8)} kB`, `VmRSS:\t${String(kb).padStart(8)} kB`, 'Threads:\t1', 'NoNewPrivs:\t0', 'Seccomp:\t2', 'Seccomp_filters:\t1', ''].join('\n');
  }

  // ---- descriptors --------------------------------------------------------------------------------------------------------------------------------------------------------
  ref(ofd) { ofd.refs = (ofd.refs ?? 0) + 1; return ofd; }
  unref(ofd) {
    if (--ofd.refs > 0) return;
    if (ofd.kind === 'pipe') { if (ofd.end === 'r') ofd.pipe.readers--; else ofd.pipe.writers--; }
    if (ofd.kind === 'java' || ofd.kind === 'npipe') ofd.release?.();
    if (ofd.lock) this.unlock(ofd);
  }
  allocate(proc, ofd, minimum = 0, cloexec = false) {
    let n = minimum; while (proc.fds.has(n)) n++;
    if (n >= 32768) return -E.MFILE;
    proc.fds.set(n, { ofd: this.ref(ofd), cloexec }); return n;
  }
  close(proc, fd) { const entry = proc.fds.get(fd); if (!entry) return -E.BADF; proc.fds.delete(fd); this.unref(entry.ofd); return 0; }
  pipeEnd(pipe, end, flags = 0) { if (end === 'r') pipe.readers++; else pipe.writers++; return { kind: 'pipe', pipe, end, flags: (end === 'r' ? O.RDONLY : O.WRONLY) | (flags & O.NONBLOCK), refs: 0 }; }

  // ---- processes --------------------------------------------------------------------------------------------------------------------------------------------------------
  newPid() { while (this.processes.has(this.nextPid)) this.nextPid++; return this.nextPid++; }
  newProcess(parent, { argv, env, cwd, comm }) {
    const now = this.clock.now(), proc = { pid: this.newPid(), ppid: parent.pid, pgid: parent.pgid, sid: parent.sid, uid: parent.uid, gid: parent.gid, groups: parent.groups, cwd: cwd ?? parent.cwd, umask: parent.umask ?? 0o077,
      argv, env, comm, exe: null, fds: new Map(), pending: [], state: 'R', wait: null, action: null, rewind: false, status: null, x: null, module: null, children: new Set(), startMs: now, startWall: this.clock.wall(),
      cpuMs: 0, childCpuMs: 0, thread: null, label: null };
    this.processes.set(proc.pid, proc);
    if (!parent.app) parent.children.add(proc.pid);
    return proc;
  }
  /**
   * Starts a program for the app (Runtime.exec / ProcessBuilder, src/process-native.js): `stdio` are three open file descriptions (or null for /dev/null), `exec` the
   * resolved program. Returns the process.
   */
  spawn({ exec, argv, env, cwd, stdio, label, parent = this.app }) {
    const proc = this.newProcess(parent, { argv, env, cwd, comm: processComm(exec.file.slice(exec.file.lastIndexOf('/') + 1)) });
    proc.label = label;
    // the trace's EXEC line says what the program wrote (the first 300 bytes of its stdout and stderr) next to how it ended
    proc.captures = stdio.slice(1).map(ofd => { if (!ofd || ofd.kind === 'java') return null; ofd.capture ??= { bytes: [], size: 0 }; return ofd.capture; });
    stdio.forEach((ofd, n) => proc.fds.set(n, { ofd: this.ref(ofd ?? { kind: 'dev', device: '/dev/null', path: '/dev/null', flags: O.RDWR, refs: 0 }), cloexec: false }));
    this.load(proc, { ...exec, argv: exec.argv ?? argv, env });
    this.start(proc);
    return proc;
  }
  start(proc) {
    const thread = proc.thread = new VMThread(`pid ${proc.pid}`, null); thread.daemon = true; thread.process = proc;
    this.runtime.scheduler.start(thread, () => {
      let outcome;
      if (proc.state !== 'R') return undefined;   // ended in a turn another wait gave it (pump)
      try { outcome = this.run(proc); }
      catch (error) { this.record(`PROCESS ${proc.pid} (${proc.comm}): the lab's kernel failed: ${error?.message ?? error}`); this.finish(proc, { signal: SIG.SYS }); return undefined; }
      if (outcome === 'exited') return undefined;
      const wait = proc.wait;
      return new Blocked({ ready: () => proc.state !== 'R' || proc.killed !== undefined || proc.pending.length > 0 || (proc.wait ?? wait).ready(), deadline: wait.deadline, reason: `process ${proc.pid} (${proc.comm}): ${wait.reason}` });
    });
  }
  /** Loads `program` into `proc` (a new instance: exec, or the first start): the descriptors marked close-on-exec close, the arguments and environment are the new ones. */
  load(proc, { program, path, argv, env, file = null }) {
    const module = this.programs.modules[program]; if (!module) throw new Error(`no module for ${program}`);
    for (const [fd, entry] of [...proc.fds]) if (entry.cloexec) this.close(proc, fd);
    proc.module = module; proc.program = program; proc.exe = path; proc.argv = argv; proc.env = env; proc.comm = processComm((file ?? path).slice((file ?? path).lastIndexOf('/') + 1));   // the kernel's comm is the name exec was given (a link's name)
    proc.x = new WebAssembly.Instance(module, this.imports(proc)).exports; proc.rewind = false;
    proc.asyncData = proc.x.malloc(ASYNC_BYTES + 8);
  }
  /** Runs `proc` until it waits ('blocked') or ends ('exited'). */
  run(proc) {
    if (proc.state !== 'R') return 'exited';
    if (proc.running) return 'blocked';
    const began = performance.now(); proc.sliceStart = began; proc.running = true;
    try {
      for (;;) {
        if (proc.killed !== undefined) { this.finish(proc, { signal: proc.killed }); return 'exited'; }
        if (proc.kind === 'arm64') {   // a forked child of the ARM64 native code (src/arm64/processes.js)
          // a signal sent to the child goes to its own signal state (src/arm64/signals.js): its handler runs at the start of its next turn, SIG_IGN drops it, and a default
          // action that ends a process ends it with that signal (runForkedChild)
          if (proc.pending.length) { const child = proc.native; for (const sig of proc.pending.splice(0)) child.hostLibrary.__signalProcess(child, sig, 0, null, { queued: true }); }
          const turn = runForkedChild(this, proc);
          if (turn.exit) { this.finish(proc, turn.exit); return 'exited'; }
          if (turn.wait) { proc.wait = new Wait(turn.wait.ready, turn.wait.reason, turn.wait.deadline); return 'blocked'; }
          this.execFromNative(proc); continue;
        }
        const x = proc.x;
        try {
          if (proc.rewind) { proc.rewind = false; x.asyncify_start_rewind(proc.asyncData); }
          else if (proc.pending.length) this.deliver(proc);   // a signal sent before the program first ran: its default disposition applies (a forked child rewinds instead)
          x._start();
        } catch (error) {
          if (error instanceof ProcessEnd) { this.finish(proc, error.status); return 'exited'; }
          if (error instanceof WebAssembly.RuntimeError) {
            const signal = /unreachable/.test(error.message) ? SIG.ABRT : SIG.SEGV;
            this.record(`PROCESS ${proc.pid} (${proc.comm}): WebAssembly trap "${error.message}" (signal ${signal})`);
            this.finish(proc, { signal }); return 'exited';
          }
          throw error;
        }
        if (x.asyncify_get_state() !== UNWINDING) { this.finish(proc, { code: 0 }); return 'exited'; }
        x.asyncify_stop_unwind();
        const action = proc.action; proc.action = null;
        if (action.kind === 'wait') { proc.rewind = true; return 'blocked'; }
        if (action.kind === 'fork') { this.completeFork(proc); proc.rewind = true; continue; }
        if (action.kind === 'exec') { this.load(proc, action); continue; }
      }
    } finally { proc.cpuMs += performance.now() - began; proc.running = false; }
  }
  /** Turns other processes that can run (a synchronous wait of the app's native code: src/arm64/threads.js); true when one ran. */
  pump() {
    let progressed = false;
    for (const proc of [...this.processes.values()]) {
      if (proc.state !== 'R' || proc.running) continue;
      const wait = proc.wait;
      if (wait && !(proc.pending.length || proc.killed !== undefined || wait.ready() || this.clock.now() >= wait.deadline)) continue;
      this.run(proc); progressed = true;
    }
    return progressed;
  }
  /** The earliest deadline of a waiting process (Infinity when none). */
  nextDeadline() { let at = Infinity; for (const proc of this.processes.values()) if (proc.state === 'R' && proc.wait) at = Math.min(at, proc.wait.deadline); return at; }
  /** execve in a forked ARM64 child: its descriptors become the kernel's (files, devices, the native pipes), close-on-exec ones closed, and the program is loaded. */
  execFromNative(proc) {
    const exec = proc.pendingExec, child = proc.native, host = child.hostLibrary; proc.pendingExec = null;
    const files = host.__fileTable?.().fds ?? new Map(), sockets = host.__socketTable?.().objects ?? new Map();
    for (const [fd, entry] of files) {
      if (entry.cloexec) continue;
      const node = entry.path ? this.fs.node(entry.path) : null;
      if (entry.device) proc.fds.set(fd, { ofd: this.ref({ kind: 'dev', device: entry.device, path: entry.device, flags: O.RDWR, refs: 0 }), cloexec: false });
      else if (node?.type === 'file') proc.fds.set(fd, { ofd: this.ref({ kind: 'file', node, path: entry.path, flags: entry.append ? O.RDWR | O.APPEND : O.RDWR, offset: entry.offset ?? 0, refs: 0 }), cloexec: false });
    }
    for (const [fd, o] of sockets) {
      const release = () => { if ((o.refs ?? 1) > 1) o.refs--; else o.pipe.closed = true; };
      if (o.cloexec || (o.kind !== 'pipe-read' && o.kind !== 'pipe-write')) { if (!o.cloexec) this.note(`exec-native-${o.kind}`, `PROCESS ${proc.pid}: a ${o.kind} descriptor of the forked ARM64 child is not carried into ${exec.path} by the lab (closed)`); if (o.kind === 'pipe-read' || o.kind === 'pipe-write') release(); else if ((o.refs ?? 1) > 1) o.refs--; continue; }
      proc.fds.set(fd, { ofd: this.ref({ kind: 'npipe', o, flags: o.kind === 'pipe-read' ? O.RDONLY : O.WRONLY, path: 'pipe', refs: 0, release }), cloexec: false });
    }
    for (const fd of [0, 1, 2]) if (!proc.fds.has(fd)) proc.fds.set(fd, { ofd: this.ref({ kind: 'dev', device: '/dev/null', path: '/dev/null', flags: O.RDWR, refs: 0 }), cloexec: false });   // an app's standard streams are /dev/null
    proc.kind = 'wasm'; proc.native = null;
    this.load(proc, { program: exec.program, path: exec.path, argv: exec.argv, env: exec.env, file: exec.file });
  }
  unwind(proc, action) {
    const view = new DataView(proc.x.memory.buffer); view.setUint32(proc.asyncData, proc.asyncData + 8, true); view.setUint32(proc.asyncData + 4, proc.asyncData + 8 + ASYNC_BYTES, true);
    proc.action = action; proc.x.asyncify_start_unwind(proc.asyncData);
  }
  completeFork(parent) {
    const child = this.newProcess(parent, { argv: parent.argv, env: parent.env, cwd: parent.cwd, comm: parent.comm });
    child.pgid = parent.pgid; child.sid = parent.sid; child.umask = parent.umask; child.exe = parent.exe; child.program = parent.program; child.module = parent.module; 
    for (const [fd, entry] of parent.fds) child.fds.set(fd, { ofd: this.ref(entry.ofd), cloexec: entry.cloexec });
    child.x = new WebAssembly.Instance(parent.module, this.imports(child)).exports;
    const from = parent.x.memory, to = child.x.memory, grow = (from.buffer.byteLength - to.buffer.byteLength) / 65536;
    if (grow > 0) to.grow(grow);
    new Uint8Array(to.buffer).set(new Uint8Array(from.buffer));
    child.x.__stack_pointer.value = parent.x.__stack_pointer.value;
    child.asyncData = parent.asyncData; child.forkResult = 0; child.rewind = true; parent.forkResult = child.pid;
    this.start(child);
  }
  /** The end of a process: its descriptors close, it is a zombie until its parent reaps it, the parent gets SIGCHLD; its children go to init. */
  finish(proc, status) {
    if (proc.state === 'Z' || proc.state === 'X') return;
    proc.state = 'Z'; proc.status = status; proc.wait = null; proc.endMs = this.clock.now();
    for (const fd of [...proc.fds.keys()]) this.close(proc, fd);
    if (proc.native) {   // a forked ARM64 child: its C library's descriptors close (a pipe end it held, a socket), as the kernel closes a process's files at exit
      const host = proc.native.hostLibrary;
      for (const fd of [...(host.__socketTable?.().objects.keys() ?? [])]) try { host.close(proc.native, { x: [BigInt(fd)] }); } catch { /* a descriptor whose close fails: gone with the process */ }
      proc.native = null;
    }
    for (const pid of proc.children) { const child = this.processes.get(pid); if (!child) continue; child.ppid = INIT_PID; if (child.state === 'Z') this.reap(child); }
    proc.children.clear();
    const parent = this.processes.get(proc.ppid);
    if (parent) { parent.childCpuMs += proc.cpuMs + proc.childCpuMs; this.signal(parent, SIG.CHLD); }
    else if (proc.ppid === INIT_PID) this.reap(proc);   // init reaps its children
    if (proc.label) {
      const shown = capture => { if (!capture?.size) return null; const bytes = new Uint8Array(capture.bytes.flatMap(b => [...b])).subarray(0, 300); return JSON.stringify(decoder.decode(bytes)) + (capture.size > 300 ? `…(${capture.size} bytes)` : ''); };
      const [out, err] = (proc.captures ?? []).map(shown);
      this.record(`EXEC ${proc.label}: ${status.signal ? `killed by signal ${status.signal}` : `exit status ${status.code}`}${out ? `; stdout ${out}` : ''}${err ? `; stderr ${err}` : ''}`);
    }
    proc.x = proc.x ? { memory: proc.x.memory } : null;   // the instance is gone; its memory size stays for /proc until it is reaped
  }
  reap(proc) { proc.state = 'X'; this.processes.delete(proc.pid); this.processes.get(proc.ppid)?.children.delete(proc.pid); }
  waitStatus(status) { return status.signal ? status.signal & 0x7f : (status.code & 0xff) << 8; }
  /** Sends `sig` to `proc` (a process of the kernel). SIGKILL ends it at once; others are delivered at its next system call boundary (or end its wait). */
  signal(proc, sig) {
    if (!proc || proc.state === 'Z' || proc.state === 'X' || sig === 0) return;
    if (sig === SIG.KILL) { proc.killed = SIG.KILL; if (proc.wait === null && !proc.running) this.finish(proc, { signal: SIG.KILL }); return; }
    if (!proc.pending.includes(sig)) proc.pending.push(sig);
  }
  /** Delivers `proc`'s pending signals (inside one of its system calls). True when a handler ran; throws ProcessEnd when the default action ends it. */
  deliver(proc) {
    let handled = false;
    while (proc.pending.length) {
      const sig = proc.pending.shift(), code = proc.x.lab_signal(sig);
      if (code === 0) handled = true;
      else if (code === 1) throw new ProcessEnd({ signal: sig });
    }
    return handled;
  }
  kill(from, pid, sig) {
    if (sig < 0 || sig > 64) return -E.INVAL;
    const targets = pid > 0 ? [pid] : pid === 0 ? [...this.processes.values()].filter(p => p.pgid === from.pgid).map(p => p.pid) : pid === -1 ? [...this.processes.keys()] : [...this.processes.values()].filter(p => p.pgid === -pid).map(p => p.pid);
    let sent = 0, denied = false;
    for (const target of targets) {
      if (target === this.app.pid) { if (sig === 0) { sent++; continue; } this.note(`kill-app-${sig}`, `PROCESS ${from.pid} (${from.comm}) sent signal ${sig} to the app's process: not delivered by the lab (the app's runtime has no signal handlers to run)`); denied = true; continue; }
      const proc = this.processes.get(target);
      if (!proc || proc.state === 'X') continue;
      if (proc.uid !== from.uid) { denied = true; continue; }
      sent++; this.signal(proc, sig);
    }
    // init, the kernel threads and the services that start at boot have low pids and another uid: EPERM (kill_ok_by_cred); a pid no process has: ESRCH
    if (!sent) return denied || (pid > 0 && pid <= 1000) ? -E.PERM : -E.SRCH;
    return 0;
  }
  /** wait4 for `parent` (a process, or the app): the pid and status of a matching child that ended, 0 (WNOHANG, none yet), -ECHILD, or a Wait. */
  wait4(parent, pid, options) {
    const children = [...this.processes.values()].filter(p => p.ppid === parent.pid && (pid === -1 || (pid > 0 ? p.pid === pid : pid === 0 ? p.pgid === parent.pgid : p.pgid === -pid)));
    if (!children.length) return { error: E.CHILD };
    const done = children.find(p => p.state === 'Z');
    if (done) { this.reap(done); return { pid: done.pid, status: this.waitStatus(done.status) }; }
    if (options & WNOHANG) return { pid: 0, status: 0 };
    return { wait: new Wait(() => children.some(p => p.state === 'Z'), `wait4(${pid})`) };
  }
  /** UNIXProcess.waitForProcessExit for the app: the exit code (0x80 + signal for a signal, UNIXProcess_md.c WaitForProcessExit) or a Blocked. */
  waitJava(pid) {
    const proc = this.processes.get(pid);
    if (!proc) return -1;
    if (proc.state === 'Z') { const status = proc.status; this.reap(proc); return status.signal ? 0x80 + status.signal : status.code; }
    return new Blocked({ ready: () => proc.state === 'Z', reason: `Process.waitFor: process ${pid} (${proc.comm})`, retry: true });
  }

  // ---- exec ----------------------------------------------------------------------------------------------------------------------------------------------------------
  /**
   * What exec of `path` runs, as the kernel decides: { program, path, argv } for a program of the image (a "#!" script runs its interpreter, binfmt_script), or
   * { error } (ENOENT, EACCES for a directory or a file without an x bit, ENOEXEC for a file the device cannot run), or { elf, path } for an ELF executable.
   */
  resolveExec(proc, path, argv, depth = 0) {
    const found = this.walk(proc, path); if (found.error) return { error: found.error };
    const node = found.node; if (!node) return { error: E.NOENT };
    if (node.type === 'dir' || !this.permits(proc, found.path, node, 1) || !(node.mode & 0o111)) return { error: E.ACCES };
    if (node.program) return { program: node.program, path: found.path, argv };
    if (node.type !== 'file') return { error: E.ACCES };
    const head = this.fs.refresh(node)?.buf?.subarray(0, Math.min(node.size, 256)) ?? new Uint8Array(0);
    if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return { elf: true, path: found.path };
    if (head[0] === 0x23 && head[1] === 0x21 && depth < 4) {   // #!interpreter [one argument]
      const line = decoder.decode(head.subarray(2)).split('\n')[0].trim(); if (!line) return { error: E.NOEXEC };
      const space = line.search(/[ \t]/), interpreter = space < 0 ? line : line.slice(0, space), arg = space < 0 ? '' : line.slice(space).trim();
      return this.resolveExec(proc, interpreter, [interpreter, ...(arg ? [arg] : []), path, ...argv.slice(1)], depth + 1);
    }
    return { error: E.NOEXEC };
  }

  // ---- the system calls -----------------------------------------------------------------------------------------------------------------------------------------------
  imports(proc) {
    const k = this, fs = this.fs;
    const u8 = () => new Uint8Array(proc.x.memory.buffer), dv = () => new DataView(proc.x.memory.buffer);
    const cstr = at => { if (!at) return null; const m = u8(); let end = at; while (m[end]) end++; return decoder.decode(m.subarray(at, end)); };
    const putStr = (at, size, value, nul = true) => { const bytes = text(value); const n = Math.min(bytes.length, nul ? size - 1 : size); u8().set(bytes.subarray(0, n), at); if (nul && size > 0) u8()[at + n] = 0; return bytes.length; };
    const ptrs = at => { const list = []; if (!at) return list; for (let i = 0; ; i += 4) { const p = dv().getUint32(at + i, true); if (!p) break; list.push(cstr(p)); } return list; };
    const fd = n => proc.fds.get(n)?.ofd ?? null;
    // a system call that may wait: the rewound call delivers what arrived (a handler that ran makes it EINTR), then tries again
    const waiting = attempt => {
      const x = proc.x;
      if (x.asyncify_get_state() === REWINDING) { x.asyncify_stop_rewind(); proc.wait = null; if (k.deliver(proc)) return -E.INTR; }
      const r = attempt();
      if (r instanceof Wait) { proc.wait = r; k.unwind(proc, { kind: 'wait' }); return 0; }
      return r;
    };
    // a wait's deadline is fixed when the call is first made (a rewound call keeps it)
    const timeoutDeadline = timeout => { if (proc.x.asyncify_get_state() !== REWINDING) proc.callDeadline = timeout < 0 ? Infinity : k.clock.now() + timeout; return proc.callDeadline; };
    const yieldNow = () => performance.now() - proc.sliceStart > SLICE_MS;   // a long-running program lets the others run
    const unsupported = (name, detail = '') => { k.note(`sys-${name}`, `PROCESS ${proc.pid} (${proc.comm}): ${name}${detail ? ` (${detail})` : ''} is not provided by the lab (ENOSYS)`); return -E.NOSYS; };

    // reading and writing an open file description: a count, -errno, or a Wait
    const readOfd = (ofd, length, position = null) => {
      if ((ofd.flags & O.ACCMODE) === O.WRONLY) return -E.BADF;
      switch (ofd.kind) {
        case 'dir': return -E.ISDIR;
        case 'dev': return ofd.device === '/dev/zero' ? new Uint8Array(length) : ofd.device === '/dev/random' || ofd.device === '/dev/urandom' ? random(length) : new Uint8Array(0);
        case 'pipe': case 'java': {
          const pipe = ofd.pipe ?? ofd.desc?.pipe;
          if (!pipe) { const desc = ofd.desc; if (desc.kind !== 'file') return new Uint8Array(0); return readNode(desc, length, position); }
          if (position !== null) return -E.SPIPE;
          if (length === 0) return new Uint8Array(0);
          if (pipe.size === 0) { if (pipe.writers === 0) return new Uint8Array(0); if (ofd.flags & O.NONBLOCK) return -E.AGAIN; return new Wait(() => pipe.size > 0 || pipe.writers === 0, 'read(pipe)'); }
          return pipeTake(pipe, length);
        }
        case 'file': return readNode(ofd, length, position);
        case 'npipe': {   // a pipe of the ARM64 native code (src/arm64/sockets.js), carried into a program by exec
          const pipe = ofd.o.pipe; if (position !== null) return -E.SPIPE;
          if (pipe.bytes.length === 0) { if (pipe.closed) return new Uint8Array(0); if (ofd.o.nonblocking) return -E.AGAIN; return new Wait(() => pipe.bytes.length > 0 || pipe.closed, 'read(pipe)'); }
          const take = pipe.bytes.slice(0, length); pipe.bytes = pipe.bytes.slice(take.length); return take;
        }
      }
      return -E.BADF;
    };
    const readNode = (ofd, length, position) => {
      const node = ofd.node, at = position ?? ofd.offset; if (at >= node.size) return new Uint8Array(0);
      const out = new Uint8Array(Math.min(length, node.size - at)); out.set(node.buf.subarray(at, at + out.length));
      if (position === null) ofd.offset += out.length; return out;
    };
    const writeOfd = (ofd, bytes, position = null) => {
      if ((ofd.flags & O.ACCMODE) === O.RDONLY) return -E.BADF;
      switch (ofd.kind) {
        case 'dev': return ofd.device === '/dev/full' ? -E.NOSPC : bytes.length;
        case 'pipe': case 'java': {
          const pipe = ofd.pipe ?? ofd.desc?.pipe;
          if (!pipe) { const desc = ofd.desc; if (desc.kind !== 'file') return bytes.length; return writeNode(desc, bytes, position); }
          if (pipe.readers === 0) { k.signal(proc, SIG.PIPE); k.deliver(proc); return -E.PIPE; }
          if (bytes.length === 0) return 0;
          if (pipe.size >= PIPE_CAPACITY) { if (ofd.flags & O.NONBLOCK) return -E.AGAIN; return new Wait(() => pipe.readers === 0 || pipe.size < PIPE_CAPACITY, 'write(pipe): pipe buffer full (64 KiB)'); }
          const n = Math.min(bytes.length, PIPE_CAPACITY - pipe.size); pipe.chunks.push(bytes.slice(0, n)); pipe.size += n;
          if (ofd.capture && ofd.capture.size < 300) ofd.capture.bytes.push(bytes.slice(0, Math.min(n, 300 - ofd.capture.size)));
          if (ofd.capture) ofd.capture.size += n;
          return n;
        }
        case 'file': return writeNode(ofd, bytes, position);
        case 'npipe': {
          const pipe = ofd.o.pipe; if (pipe.closed) { k.signal(proc, SIG.PIPE); k.deliver(proc); return -E.PIPE; }
          const next = new Uint8Array(pipe.bytes.length + bytes.length); next.set(pipe.bytes); next.set(bytes, pipe.bytes.length); pipe.bytes = next; return bytes.length;
        }
      }
      return -E.BADF;
    };
    const writeNode = (ofd, bytes, position) => {
      if (ofd.node.generate) return -E.ACCES;
      const at = position ?? ((ofd.flags ?? 0) & O.APPEND || ofd.append ? ofd.node.size : ofd.offset);
      try { fs.writeAt(ofd.node, at, bytes, 0, bytes.length); } catch (error) { if (error instanceof RangeError) return -E.NOSPC; throw error; }
      if (position === null) ofd.offset = at + bytes.length; return bytes.length;
    };
    const iovs = (at, count) => { const out = []; const v = dv(); for (let i = 0; i < count; i++) out.push({ base: v.getUint32(at + 8 * i, true), length: v.getUint32(at + 8 * i + 4, true) }); return out; };
    const statOf = (path, node) => {
      const owner = k.ownerOf(path, node), type = node.type, size = type === 'file' && !node.generate ? node.size : type === 'link' ? (node.size ?? node.target.length) : type === 'dir' && !path.startsWith('/proc') ? 4096 : 0;
      const mode = (type === 'dir' ? S_IFDIR : type === 'link' ? S_IFLNK : type === 'fifo' ? S_IFIFO : type === 'chr' ? S_IFCHR : S_IFREG) | ((node.mode ?? 0o644) & 0o7777);
      const ms = node.mtime ?? 0, whole = Math.floor(ms / 1000), sec = BigInt(whole), nsec = BigInt(Math.floor((ms - whole * 1000) * 1e6));
      const dev = type === 'chr' ? 6n : BigInt(deviceOf(mountOf(path)));
      return [dev, BigInt(node.ino ?? inode(node)), BigInt(mode), type === 'dir' ? 2n : 1n, BigInt(owner.uid), BigInt(owner.gid), BigInt(node.rdev ?? 0), BigInt(size), 4096n, BigInt(Math.ceil(size / 512)), sec, nsec, sec, nsec, sec, nsec];
    };
    const ofdStat = ofd => {
      if (ofd.kind === 'npipe') return statOf('pipe', { type: 'fifo', mode: 0o600, size: 0, mtime: k.clock.wall(), uid: proc.uid, gid: proc.uid, ino: ofd.o.pipe.ino ??= 4000 + (k.pipeCounter = (k.pipeCounter ?? 0) + 1) });
      if (ofd.kind === 'pipe' || (ofd.kind === 'java' && ofd.desc.kind === 'pipe')) { const pipe = ofd.pipe ?? ofd.desc.pipe; return statOf('pipe', { type: 'fifo', mode: 0o600, size: 0, mtime: k.clock.wall(), uid: proc.uid, gid: proc.uid, ino: pipe.ino ??= 4000 + (k.pipeCounter = (k.pipeCounter ?? 0) + 1) }); }
      if (ofd.kind === 'java') return ofd.desc.node ? statOf(ofd.desc.node.path ?? '/', ofd.desc.node) : statOf('/dev/null', k.lnode(proc, '/dev/null'));
      if (ofd.kind === 'dev') return statOf(ofd.path, k.lnode(proc, ofd.path));
      return statOf(ofd.path, ofd.node);
    };
    const writeStat = (at, values) => { const v = dv(); values.forEach((value, i) => v.setBigInt64(at + 8 * i, value, true)); };
    const open = (dirfd, path, flags, mode) => {
      const found = k.walk(proc, path, { dirfd, follow: !(flags & O.NOFOLLOW) }); if (found.error) return -found.error;
      let { node } = found; const p = found.path, access = flags & O.ACCMODE, writing = access !== O.RDONLY || (flags & O.TRUNC);
      if (node?.type === 'link') return -E.LOOP;
      if (!node) {
        if (!(flags & O.CREAT)) return -E.NOENT;
        const parent = k.lnode(proc, fs.parentOf(p)); if (!parent) return -E.NOENT;
        const denied = k.writeDenied(proc, p, null) || (parent.type === 'dir' && !k.permits(proc, fs.parentOf(p), parent, 3) ? E.ACCES : 0); if (denied) return -denied;
        const made = fs.createFile(p); if (made !== 'ok') return -(ERRNO_BY_NAME[made] ?? E.IO);
        node = fs.nodes.get(p); node.mode = mode & ~proc.umask & 0o7777;
      } else if ((flags & O.CREAT) && (flags & O.EXCL)) return -E.EXIST;
      if (node.denyOpen) return -(ERRNO_BY_NAME[node.denyOpen] ?? E.ACCES);
      if (node.type === 'chr') { if (DEVICES[p]?.noctty) return -E.NXIO; return k.allocate(proc, { kind: 'dev', device: p, path: p, flags, refs: 0 }, 0, !!(flags & O.CLOEXEC)); }
      if (node.type === 'dir') {
        if (access !== O.RDONLY) return -E.ISDIR;
        if (!k.permits(proc, p, node, 4) && !(flags & O.PATH)) return -E.ACCES;
        return k.allocate(proc, { kind: 'dir', node, path: p, flags, pos: 0, names: null, refs: 0 }, 0, !!(flags & O.CLOEXEC));
      }
      if (flags & O.DIRECTORY) return -E.NOTDIR;
      if (writing) { const denied = k.writeDenied(proc, p, node); if (denied) return -denied; }
      if (access !== O.WRONLY && !k.permits(proc, p, node, 4)) return -E.ACCES;
      if (node.generate) { fs.refresh(node); }
      else if (node.system && node.size === 0 && (node.program || node.imageFile) && !k.programs?.bytes) return -E.ACCES;
      if ((flags & O.TRUNC) && access !== O.RDONLY && !node.generate) { node.size = 0; node.mtime = k.clock.wall(); node.rev = (node.rev ?? 0) + 1; }
      return k.allocate(proc, { kind: 'file', node, path: p, flags, offset: 0, refs: 0 }, 0, !!(flags & O.CLOEXEC));
    };
    const dirNames = ofd => {
      const node = ofd.node, names = node.names ? node.names() : (k.lnode(proc, ofd.path)?.names?.() ?? fs.list(ofd.path) ?? []);
      const extra = ofd.path === '/dev' ? Object.keys(DEVICES).map(d => d.slice(5)) : [];
      return ['.', '..', ...new Set([...names, ...extra])];
    };

    const lab = {
      openat: (dirfd, path, flags, mode) => waiting(() => (yieldNow() ? new Wait(() => true, 'yield') : open(dirfd, cstr(path), flags, mode))),
      fcntl: (n, cmd, arg) => {
        const entry = proc.fds.get(n); if (!entry) return -E.BADF;
        switch (cmd) {
          case 0: case 1030: return k.allocate(proc, entry.ofd, arg, cmd === 1030);   // F_DUPFD, F_DUPFD_CLOEXEC
          case 1: return entry.cloexec ? 1 : 0;
          case 2: entry.cloexec = !!(arg & 1); return 0;
          case 3: return entry.ofd.flags ?? O.RDWR;
          case 4: entry.ofd.flags = (entry.ofd.flags & ~(O.APPEND | O.NONBLOCK)) | (arg & (O.APPEND | O.NONBLOCK)); return 0;
          case 5: case 6: case 7: case 12: case 13: case 14: if (cmd === 5 || cmd === 12) dv().setInt16(arg, 2, true); return 0;   // record locks: one writer per file in the lab's processes; F_GETLK reports F_UNLCK
          case 1031: case 1032: return PIPE_CAPACITY;   // F_SETPIPE_SZ / F_GETPIPE_SZ
        }
        return -E.INVAL;
      },
      ioctl: (n, op, arg) => {
        const ofd = fd(n); if (!ofd) return -E.BADF;
        if (op === 0x541B) { const pipe = ofd.pipe ?? ofd.desc?.pipe; dv().setInt32(arg, pipe ? pipe.size : ofd.kind === 'file' ? Math.max(0, ofd.node.size - ofd.offset) : 0, true); return 0; }   // FIONREAD
        if (op === 0x5451) { proc.fds.get(n).cloexec = true; return 0; }   // FIOCLEX
        if (op === 0x5450) { proc.fds.get(n).cloexec = false; return 0; }  // FIONCLEX
        if (op === 0x5421) { if (dv().getInt32(arg, true)) ofd.flags |= O.NONBLOCK; else ofd.flags &= ~O.NONBLOCK; return 0; }   // FIONBIO
        return -E.NOTTY;   // no descriptor of an app's process is a terminal (TCGETS, TIOCGWINSZ, ...)
      },
      stat: (dirfd, path, flags, out) => {
        if (flags & AT_EMPTY_PATH) { const s = cstr(path); if (!s) { const ofd = fd(dirfd); if (!ofd) return -E.BADF; writeStat(out, ofdStat(ofd)); return 0; } }
        const found = k.walk(proc, cstr(path), { dirfd, follow: !(flags & AT_SYMLINK_NOFOLLOW) }); if (found.error) return -found.error; if (!found.node) return -E.NOENT;
        writeStat(out, statOf(found.path, found.node)); return 0;
      },
      getdents: (n, buf, count) => {
        const ofd = fd(n); if (!ofd) return -E.BADF; if (ofd.kind !== 'dir') return -E.NOTDIR;
        if (SEARCH_ONLY.has(ofd.path) || !k.permits(proc, ofd.path, ofd.node, 4)) return -E.ACCES;
        ofd.names ??= dirNames(ofd);
        let at = 0; const m = u8(), v = dv();
        while (ofd.pos < ofd.names.length) {
          const name = ofd.names[ofd.pos], bytes = text(name), reclen = (19 + bytes.length + 1 + 7) & ~7;
          if (at + reclen > count) { if (at === 0) return -E.INVAL; break; }
          const childPath = name === '.' ? ofd.path : name === '..' ? fs.parentOf(ofd.path) : `${ofd.path === '/' ? '' : ofd.path}/${name}`, child = k.lnode(proc, childPath);
          const type = !child ? 0 : child.type === 'dir' ? 4 : child.type === 'link' ? 10 : child.type === 'chr' ? 2 : child.type === 'fifo' ? 1 : 8;
          v.setBigUint64(buf + at, BigInt(child ? (child.ino ?? inode(child)) : 0), true); v.setBigInt64(buf + at + 8, BigInt(ofd.pos + 1), true); v.setUint16(buf + at + 16, reclen, true); m[buf + at + 18] = type;
          m.set(bytes, buf + at + 19); m.fill(0, buf + at + 19 + bytes.length, buf + at + reclen);
          at += reclen; ofd.pos++;
        }
        return at;
      },
      dup: (n, to, flags) => {
        const entry = proc.fds.get(n); if (!entry) return -E.BADF;
        if (to < 0) return k.allocate(proc, entry.ofd);
        if (flags & 0x40000000 && n === to) return -E.INVAL;   // dup3
        if (n === to) return to;
        if (proc.fds.has(to)) k.close(proc, to);
        proc.fds.set(to, { ofd: k.ref(entry.ofd), cloexec: !!(flags & O.CLOEXEC) }); return to;
      },
      pipe: (out, flags) => {
        const pipe = newPipe(), r = k.allocate(proc, k.pipeEnd(pipe, 'r', flags), 0, !!(flags & O.CLOEXEC)); if (r < 0) return r;
        const w = k.allocate(proc, k.pipeEnd(pipe, 'w', flags), 0, !!(flags & O.CLOEXEC)); if (w < 0) { k.close(proc, r); return w; }
        dv().setInt32(out, r, true); dv().setInt32(out + 4, w, true); return 0;
      },
      getcwd: (buf, size) => { const cwd = proc.cwd; if (text(cwd).length + 1 > size) return -E.RANGE; putStr(buf, size, cwd); return text(cwd).length + 1; },
      chdir: (path, n) => {
        let p, node;
        if (path) { const found = k.walk(proc, cstr(path)); if (found.error) return -found.error; p = found.path; node = found.node; }
        else { const ofd = fd(n); if (!ofd) return -E.BADF; p = ofd.path; node = ofd.node; }
        if (!node) return -E.NOENT; if (node.type !== 'dir') return -E.NOTDIR; if (!k.permits(proc, p, node, 1)) return -E.ACCES;
        proc.cwd = p; return 0;
      },
      readlink: (dirfd, path, buf, size) => {
        const found = k.walk(proc, cstr(path), { dirfd, follow: false }); if (found.error) return -found.error;
        const node = found.node; if (!node) return -E.NOENT; if (node.type !== 'link') return -E.INVAL;
        const target = node.target + (node.deleted ? ' (deleted)' : ''); return Math.min(putStr(buf, size, target, false), size);
      },
      access: (dirfd, path, mode, flags) => {
        const found = k.walk(proc, cstr(path), { dirfd, follow: !(flags & AT_SYMLINK_NOFOLLOW) }); if (found.error) return -found.error; if (!found.node) return -E.NOENT;
        if (mode & 2) { const denied = k.writeDenied(proc, found.path, found.node); if (denied) return -denied; }
        if ((mode & 4) && !k.permits(proc, found.path, found.node, 4)) return -E.ACCES;
        if ((mode & 1) && (!k.permits(proc, found.path, found.node, 1) || (found.node.type !== 'dir' && !(found.node.mode & 0o111)))) return -E.ACCES;
        return 0;
      },
      mkdir: (dirfd, path, mode) => {
        const found = k.walk(proc, cstr(path), { dirfd, follow: false }); if (found.error) return -found.error; if (found.node) return -E.EXIST;
        const denied = k.writeDenied(proc, found.path, null) || (k.lnode(proc, fs.parentOf(found.path)) && !k.permits(proc, fs.parentOf(found.path), k.lnode(proc, fs.parentOf(found.path)), 3) ? E.ACCES : 0); if (denied) return -denied;
        if (S_IFIFO === (mode & S_IFMT)) { fs.put(found.path, { type: 'fifo', mode: mode & 0o777 & ~proc.umask, mtime: k.clock.wall(), pipe: newPipe() }); return 0; }
        const r = fs.mkdir(found.path); if (r !== 'ok') return -(ERRNO_BY_NAME[r] ?? E.IO);
        fs.nodes.get(found.path).mode = mode & 0o7777 & ~proc.umask; return 0;
      },
      unlink: (dirfd, path, flags) => {
        const found = k.walk(proc, cstr(path), { dirfd, follow: false }); if (found.error) return -found.error; if (!found.node) return -E.NOENT;
        const denied = k.writeDenied(proc, found.path, null) || (!k.permits(proc, fs.parentOf(found.path), k.lnode(proc, fs.parentOf(found.path)) ?? {}, 3) ? E.ACCES : 0); if (denied) return -denied;
        if (flags & AT_REMOVEDIR) { if (found.node.type !== 'dir') return -E.NOTDIR; } else if (found.node.type === 'dir') return -E.ISDIR;
        if (found.node.type === 'link' || found.node.type === 'fifo') { fs.nodes.delete(found.path); return 0; }
        const r = fs.delete(found.path); return r === 'ok' ? 0 : -(ERRNO_BY_NAME[r] ?? E.IO);
      },
      rename: (olddirfd, oldpath, newdirfd, newpath) => {
        const a = k.walk(proc, cstr(oldpath), { dirfd: olddirfd, follow: false }), b = k.walk(proc, cstr(newpath), { dirfd: newdirfd, follow: false });
        if (a.error) return -a.error; if (b.error) return -b.error; if (!a.node) return -E.NOENT;
        const denied = k.writeDenied(proc, a.path, null) || k.writeDenied(proc, b.path, null); if (denied) return -denied;
        if (mountOf(a.path)?.[1] !== mountOf(b.path)?.[1]) return -E.XDEV;
        const r = fs.rename(a.path, b.path); return r === 'ok' ? 0 : -(ERRNO_BY_NAME[r] ?? E.IO);
      },
      link: (target, dirfd, path, symbolic) => {
        const found = k.walk(proc, cstr(path), { dirfd, follow: false }); if (found.error) return -found.error; if (found.node) return -E.EXIST;
        const denied = k.writeDenied(proc, found.path, null); if (denied) return -denied;
        if (!k.lnode(proc, fs.parentOf(found.path))) return -E.NOENT;
        if (!symbolic) return -E.PERM;   // hard links: not provided by the lab's file system (one node per path); an untrusted_app may not link_file across labels either
        const value = cstr(target); fs.put(found.path, { type: 'link', target: value, mode: 0o777, mtime: k.clock.wall(), size: text(value).length }); return 0;
      },
      chmod: (dirfd, path, mode, n) => {
        let p, node;
        if (path) { const found = k.walk(proc, cstr(path), { dirfd }); if (found.error) return -found.error; p = found.path; node = found.node; } else { const ofd = fd(n); if (!ofd) return -E.BADF; p = ofd.path; node = ofd.node; }
        if (!node) return -E.NOENT; const mount = mountOf(p); if (mount?.[3].startsWith('ro')) return -E.ROFS;
        if (k.ownerOf(p, node).uid !== proc.uid) return -E.PERM;
        node.mode = mode & 0o7777; return 0;
      },
      chown: (dirfd, path, uid, gid, n) => {
        let p, node;
        if (path) { const found = k.walk(proc, cstr(path), { dirfd }); if (found.error) return -found.error; p = found.path; node = found.node; } else { const ofd = fd(n); if (!ofd) return -E.BADF; p = ofd.path; node = ofd.node; }
        if (!node) return -E.NOENT; if (mountOf(p)?.[3].startsWith('ro')) return -E.ROFS;
        const owner = k.ownerOf(p, node); if ((uid !== -1 && uid !== owner.uid) || (gid !== -1 && !proc.groups.includes(gid))) return -E.PERM;   // CAP_CHOWN
        if (gid !== -1) node.gid = gid; return 0;
      },
      utimens: (dirfd, path, times, flags) => {
        const found = path ? k.walk(proc, cstr(path), { dirfd, follow: !(flags & AT_SYMLINK_NOFOLLOW) }) : { node: fd(dirfd)?.node, path: fd(dirfd)?.path };
        if (found.error) return -found.error; if (!found.node) return -E.NOENT;
        const denied = k.writeDenied(proc, found.path, found.node); if (denied) return -denied;
        let ms = k.clock.wall();
        if (times) { const v = dv(), sec = Number(v.getBigInt64(times + 16, true)), nsec = v.getInt32(times + 24, true); if (nsec !== 0x3ffffffe) ms = nsec === 0x3fffffff ? ms : sec * 1000 + Math.floor(nsec / 1e6); else return 0; }
        found.node.mtime = ms; return 0;
      },
      truncate: (path, n, length) => {
        let p, node, ofd = null;
        if (path) { const found = k.walk(proc, cstr(path)); if (found.error) return -found.error; p = found.path; node = found.node; } else { ofd = fd(n); if (!ofd) return -E.BADF; if (ofd.kind !== 'file') return -E.INVAL; p = ofd.path; node = ofd.node; if ((ofd.flags & O.ACCMODE) === O.RDONLY) return -E.INVAL; }
        if (!node) return -E.NOENT; if (node.type === 'dir') return -E.ISDIR;
        const denied = k.writeDenied(proc, p, node); if (denied) return -denied;
        const size = Number(length); if (size < 0) return -E.INVAL;
        if (size < node.size) node.size = size; else if (size > node.size) fs.writeAt(node, size, new Uint8Array(0), 0, 0);
        node.mtime = k.clock.wall(); node.rev = (node.rev ?? 0) + 1; return 0;
      },
      statfs: (path, n, out) => {
        let p; if (path) { const found = k.walk(proc, cstr(path)); if (found.error) return -found.error; if (!found.node) return -E.NOENT; p = found.path; } else { const ofd = fd(n); if (!ofd) return -E.BADF; p = ofd.path ?? '/'; }
        const mount = mountOf(p) ?? ['', '/', 'ext4', 'ro'], magic = { ext4: 0xEF53, f2fs: 0xF2F52010, tmpfs: 0x01021994, proc: 0x9fa0, sysfs: 0x62656572, selinuxfs: 0xf97cff8c, devpts: 0x1cd1, fuse: 0x65735546 }[mount[2]] ?? 0;
        const big = ['f2fs', 'fuse'].includes(mount[2]), pseudo = ['proc', 'sysfs', 'selinuxfs', 'devpts'].includes(mount[2]), blocks = pseudo ? 0 : big ? 1468006 * 4 : 262144, free = big ? 1468006 : 0;   // /data's numbers are java.io.File's (src/libcore-io-native.js statvfs)
        [magic, 4096, blocks, free, free, 65536, big ? 60000 : 0, 255, 4096, mount[3].startsWith('ro') ? 1 : 0].forEach((value, i) => dv().setBigInt64(out + 8 * i, BigInt(value), true)); return 0;
      },
      uname: buf => {
        const u = unameFields(k.runtime);
        ['sysname', 'nodename', 'release', 'version', 'machine', 'domainname'].forEach((field, i) => putStr(buf + 65 * i, 65, u[field])); return 0;
      },
      ids: which => [proc.pid, proc.ppid, proc.uid, proc.uid, proc.gid, proc.gid, proc.pgid, proc.sid][which] ?? -E.INVAL,
      getpgid: pid => { if (pid === 0) return proc.pgid; if (pid === k.app.pid) return k.app.pgid; const target = k.processes.get(pid); return target ? target.pgid : -E.SRCH; },
      setpgid: (pid, pgid) => { const target = pid === 0 ? proc : k.processes.get(pid); if (!target || (target !== proc && target.ppid !== proc.pid)) return -E.SRCH; target.pgid = pgid === 0 ? target.pid : pgid; return 0; },
      setsid: () => { if (proc.pgid === proc.pid) return -E.PERM; proc.sid = proc.pgid = proc.pid; return proc.sid; },
      getsid: pid => { if (pid === 0) return proc.sid; if (pid === k.app.pid) return k.app.sid; const target = k.processes.get(pid); return target ? target.sid : -E.SRCH; },
      groups: (size, list) => { if (size === 0) return proc.groups.length; if (size < proc.groups.length) return -E.INVAL; proc.groups.forEach((g, i) => dv().setUint32(list + 4 * i, g, true)); return proc.groups.length; },
      setid: (which, a, b, c) => {   // set*id to the ids a process already has is allowed; any other change needs CAP_SETUID / CAP_SETGID
        const mine = which % 2 === 0 ? proc.uid : proc.gid;
        if (which === 6) return -E.PERM;
        return [a, b, c].every(v => v === -1 || v === mine) ? 0 : -E.PERM;
      },
      umask: mask => { const old = proc.umask; proc.umask = mask & 0o777; return old; },
      wait4: (pid, status, options, rusage) => waiting(() => {
        const r = k.wait4(proc, pid, options); if (r.error) return -r.error; if (r.wait) return r.wait;
        if (r.pid > 0 && status) dv().setInt32(status, r.status, true);
        if (rusage) for (let i = 0; i < 4; i++) dv().setBigInt64(rusage + 8 * i, 0n, true);
        return r.pid;
      }),
      poll: (fds, nfds, timeout) => {
        const deadline = timeoutDeadline(timeout);
        return waiting(() => {
          const v = dv(); let ready = 0;
          const check = () => { ready = 0; for (let i = 0; i < nfds; i++) { const n = v.getInt32(fds + 8 * i, true), events = v.getInt16(fds + 8 * i + 4, true); const r = n < 0 ? 0 : readiness(fd(n), events); v.setInt16(fds + 8 * i + 6, r, true); if (r) ready++; } return ready; };
          if (check() || timeout === 0 || k.clock.now() >= deadline) return ready;
          return new Wait(() => { const vv = dv(); for (let i = 0; i < nfds; i++) { const n = vv.getInt32(fds + 8 * i, true); if (n >= 0 && readiness(fd(n), vv.getInt16(fds + 8 * i + 4, true))) return true; } return false; }, 'poll', deadline);
        });
      },
      select: (nfds, r, w, e, timeout) => {
        const deadline = timeoutDeadline(timeout), sets = [r, w].map(set => set ? new Uint8Array(u8().slice(set, set + 128)) : null);
        const test = () => { let n = 0; const results = sets.map((set, kind) => { const out = new Uint8Array(128); if (!set) return out; for (let i = 0; i < nfds; i++) if (set[i >> 3] & (1 << (i & 7))) { if (readiness(fd(i), kind ? 4 : 1)) { out[i >> 3] |= 1 << (i & 7); n++; } } return out; }); return { n, results }; };
        return waiting(() => {
          const { n, results } = test();
          if (n || timeout === 0 || k.clock.now() >= deadline) { if (r) u8().set(results[0], r); if (w) u8().set(results[1], w); if (e) u8().fill(0, e, e + 128); return n; }
          return new Wait(() => test().n > 0, 'select', deadline);
        });
      },
      rlimit: (resource, set, old) => {   // the limits zygote's children have (bionic defaults and Zygote's RLIMIT_NOFILE 32768); setting them lower is allowed
        const limits = proc.limits ??= { 0: [-1n, -1n], 1: [-1n, -1n], 2: [-1n, -1n], 3: [8388608n, -1n], 4: [0n, -1n], 5: [-1n, -1n], 6: [-1n, -1n], 7: [32768n, 32768n], 8: [65536n, 65536n], 9: [-1n, -1n], 13: [40n, 40n] };
        const now = limits[resource] ?? [-1n, -1n];
        if (old) { dv().setBigInt64(old, now[0], true); dv().setBigInt64(old + 8, now[1], true); }
        if (set) { const soft = dv().getBigInt64(set, true), hard = dv().getBigInt64(set + 8, true); if ((now[1] !== -1n && (hard === -1n || hard > now[1]))) return -E.PERM; limits[resource] = [soft, hard]; }
        return 0;
      },
      rusage: (who, out) => {
        const ms = who === -1 ? proc.childCpuMs : proc.cpuMs, v = dv();
        [Math.floor(ms / 1000), Math.floor((ms % 1000) * 1000), 0, 0].forEach((value, i) => v.setBigInt64(out + 8 * i, BigInt(value), true)); return 0;
      },
      priority: (set, which, who, value) => { if (set) return value < 0 ? -E.ACCES : 0; return 20; },   // getpriority returns 20 - nice (nice 0); a lower nice needs CAP_SYS_NICE
      fork: () => {
        const x = proc.x;
        if (x.asyncify_get_state() === REWINDING) { x.asyncify_stop_rewind(); return proc.forkResult; }
        if (k.processes.size >= 256) return -E.AGAIN;
        k.unwind(proc, { kind: 'fork' }); return 0;
      },
      execve: (path, argv, envp) => {
        const x = proc.x;
        if (x.asyncify_get_state() === REWINDING) { x.asyncify_stop_rewind(); return -E.IO; }   // not reached: a successful exec never returns
        const file = cstr(path), args = ptrs(argv), env = ptrs(envp), resolved = k.resolveExec(proc, file, args);
        if (resolved.error) return -resolved.error;
        if (resolved.elf) { k.record(`PROCESS ${proc.pid} (${proc.comm}): execve ${resolved.path}: an ELF executable needs a CPU the virtual device does not have (ENOEXEC)`); return -E.NOEXEC; }
        k.unwind(proc, { kind: 'exec', program: resolved.program, path: resolved.path, file, argv: resolved.argv, env }); return 0;
      },
      kill: (pid, sig) => { const r = k.kill(proc, pid, sig); if (r === 0 && (pid === proc.pid || pid === 0 || pid === -proc.pgid || pid === -1)) k.deliver(proc); return r; },
      sigsuspend: () => {
        const x = proc.x;
        if (x.asyncify_get_state() === REWINDING) { x.asyncify_stop_rewind(); proc.wait = null; }
        while (proc.pending.length) { if (k.deliver(proc)) return 0; }
        proc.wait = new Wait(() => false, 'sigsuspend'); k.unwind(proc, { kind: 'wait' }); return 0;
      },
      sleep: (ns, remaining) => {
        if (proc.x.asyncify_get_state() !== REWINDING) proc.sleepUntil = k.clock.now() + Number(ns) / 1e6;
        const until = proc.sleepUntil;
        const r = waiting(() => (k.clock.now() >= until ? 0 : new Wait(() => k.clock.now() >= until, 'nanosleep', until)));
        if (r === -E.INTR && remaining) dv().setBigInt64(remaining, BigInt(Math.max(0, Math.round((until - k.clock.now()) * 1e6))), true);
        return r;
      },
      socket: (domain, type) => unsupported('socket', `domain ${domain}, type ${type}`),
      passwd: (byname, name, id, buf, size, out) => { const entry = byname ? k.userByName(cstr(name)) : k.userById(id); if (!entry) return -E.NOENT; putStr(buf, size, entry.name); dv().setInt32(out, entry.id, true); return 0; },
      group: (byname, name, id, buf, size, out) => { const entry = byname ? k.userByName(cstr(name)) : k.userById(id); if (!entry) return -E.NOENT; putStr(buf, size, entry.name); dv().setInt32(out, entry.id, true); return 0; },
      prop_find: (name, value, size, serial) => { const v = deviceProperty(k.runtime, cstr(name)); if (v === null) return -E.NOENT; putStr(value, size, v); dv().setInt32(serial, 0, true); return 0; },
      prop_index: (index, name, nameSize, value, valueSize) => {
        const names = proc.propertyNames ??= devicePropertyNames(k.runtime); if (index >= names.length) return -E.NOENT;
        putStr(name, nameSize, names[index]); putStr(value, valueSize, deviceProperty(k.runtime, names[index]) ?? ''); return 0;
      },
      prop_set: (name, value) => { k.record(`PROCESS ${proc.pid} (${proc.comm}): setprop ${cstr(name)}=${cstr(value)}: denied (an untrusted_app may not set system properties: property_service, system/sepolicy)`); return -1; },
      selinux: (what, path, n, buf, size) => {
        if (what === 0) return 1;
        if (what === 1 || what === 5) { if (what === 5 && n !== proc.pid && n !== k.app.pid && !k.processes.has(n)) return -E.SRCH; putStr(buf, size, k.context()); return 0; }
        let node;
        if (what === 4) { const ofd = fd(n); if (!ofd) return -E.BADF; node = ofd.node ?? null; } else { const found = k.walk(proc, cstr(path), { follow: what === 2 }); if (found.error) return -found.error; node = found.node; if (!node) return -E.NOENT; }
        const label = node?.label ?? (node?.system ? 'u:object_r:system_file:s0' : null);
        if (!label) return -E.NODATA;
        putStr(buf, size, label); return 0;
      },
      log: (priority, tag, message) => { k.record(`LOG ${'??VDIWEFS'[priority] ?? 'I'} ${cstr(tag)}: ${cstr(message)}`); return 1; },
      flock: (n, operation) => { const ofd = fd(n); if (!ofd) return -E.BADF; return waiting(() => k.flock(ofd, operation)); },
      syscall: (number, a, b, c, d, e, f) => k.rawSyscall(proc, Number(number), [a, b, c, d, e, f], { cstr, dv, unsupported }),
    };
    const readiness = (ofd, events) => {   // POLLIN 1, POLLOUT 4, POLLHUP 16, POLLNVAL 32
      if (!ofd) return 32;
      if (ofd.kind === 'npipe') { const pipe = ofd.o.pipe; return ((events & 1) && pipe.bytes.length ? 1 : 0) | (pipe.closed ? 16 : 0) | ((events & 4) && ofd.o.kind === 'pipe-write' && !pipe.closed ? 4 : 0); }
      const pipe = ofd.pipe ?? ofd.desc?.pipe;
      if (!pipe) return events & 5;
      let r = 0;
      if ((events & 1) && (pipe.size > 0)) r |= 1;
      if (pipe.writers === 0 && (ofd.end === 'r' || (ofd.flags & O.ACCMODE) === O.RDONLY)) r |= 16;
      if ((events & 4) && pipe.size < PIPE_CAPACITY && pipe.readers > 0) r |= 4;
      return r;
    };
    const wasi = {
      args_sizes_get: (count, size) => { dv().setUint32(count, proc.argv.length, true); dv().setUint32(size, proc.argv.reduce((n, a) => n + text(a).length + 1, 0), true); return 0; },
      args_get: (argv, buf) => { let at = buf; proc.argv.forEach((a, i) => { dv().setUint32(argv + 4 * i, at, true); at += putStr(at, text(a).length + 1, a) + 1; }); return 0; },
      environ_sizes_get: (count, size) => { dv().setUint32(count, proc.env.length, true); dv().setUint32(size, proc.env.reduce((n, a) => n + text(a).length + 1, 0), true); return 0; },
      environ_get: (env, buf) => { let at = buf; proc.env.forEach((a, i) => { dv().setUint32(env + 4 * i, at, true); at += putStr(at, text(a).length + 1, a) + 1; }); return 0; },
      proc_exit: code => { throw new ProcessEnd({ code: code & 0xff }); },
      fd_close: n => { const r = k.close(proc, n); return r < 0 ? -r : 0; },
      fd_read: (n, iov, count, nread) => {
        const r = waiting(() => {
          const ofd = fd(n); if (!ofd) return -E.BADF;
          const list = iovs(iov, count), total = list.reduce((s, v) => s + v.length, 0), got = readOfd(ofd, total);
          if (got instanceof Wait || typeof got === 'number') return got;
          let at = 0; const m = u8(); for (const v of list) { const take = Math.min(v.length, got.length - at); if (at >= got.length) break; if (take > 0) { m.set(got.subarray(at, at + take), v.base); at += take; } }
          dv().setUint32(nread, got.length, true); return 0;
        });
        return r < 0 ? -r : r;
      },
      fd_pread: (n, iov, count, offset, nread) => {
        const ofd = fd(n); if (!ofd) return E.BADF; if (ofd.kind !== 'file') return E.SPIPE;
        const list = iovs(iov, count), total = list.reduce((s, v) => s + v.length, 0), got = readOfd(ofd, total, Number(offset)); if (typeof got === 'number') return -got;
        let at = 0; const m = u8(); for (const v of list) { const take = Math.min(v.length, got.length - at); if (at >= got.length) break; if (take > 0) { m.set(got.subarray(at, at + take), v.base); at += take; } }
        dv().setUint32(nread, got.length, true); return 0;
      },
      fd_write: (n, iov, count, nwritten) => {
        const r = waiting(() => {
          const ofd = fd(n); if (!ofd) return -E.BADF;
          const list = iovs(iov, count), m = u8(), bytes = new Uint8Array(list.reduce((s, v) => s + v.length, 0)); let at = 0;
          for (const v of list) { bytes.set(m.subarray(v.base, v.base + v.length), at); at += v.length; }
          const put = writeOfd(ofd, bytes); if (put instanceof Wait || put < 0) return put;
          dv().setUint32(nwritten, put, true); return 0;
        });
        return r < 0 ? -r : r;
      },
      fd_pwrite: (n, iov, count, offset, nwritten) => {
        const ofd = fd(n); if (!ofd) return E.BADF; if (ofd.kind !== 'file') return E.SPIPE;
        const list = iovs(iov, count), m = u8(), bytes = new Uint8Array(list.reduce((s, v) => s + v.length, 0)); let at = 0;
        for (const v of list) { bytes.set(m.subarray(v.base, v.base + v.length), at); at += v.length; }
        const put = writeOfd(ofd, bytes, Number(offset)); if (put < 0) return -put; dv().setUint32(nwritten, put, true); return 0;
      },
      fd_seek: (n, offset, whence, out) => {
        const ofd = fd(n); if (!ofd) return E.BADF;
        if (ofd.kind === 'pipe' || (ofd.kind === 'java' && ofd.desc.kind === 'pipe')) return E.SPIPE;
        const target = ofd.kind === 'java' ? ofd.desc : ofd;
        if (ofd.kind === 'dir') { if (Number(offset) === 0 && whence === 0) { ofd.pos = 0; ofd.names = null; } dv().setBigInt64(out, 0n, true); return 0; }
        if (ofd.kind === 'dev') { dv().setBigInt64(out, 0n, true); return 0; }
        const base = whence === 0 ? 0 : whence === 1 ? target.offset : (target.node?.size ?? 0), next = base + Number(offset);
        if (next < 0) return E.INVAL;
        target.offset = next; dv().setBigInt64(out, BigInt(next), true); return 0;
      },
      fd_sync: n => (fd(n) ? 0 : E.BADF),
      fd_fdstat_get: (n, out) => {
        const ofd = fd(n); if (!ofd) return E.BADF;
        const type = ofd.kind === 'dir' ? 3 : ofd.kind === 'dev' ? 2 : ofd.kind === 'pipe' || ofd.desc?.kind === 'pipe' ? 0 : 4;
        const v = dv(); v.setUint8(out, type); v.setUint16(out + 2, (ofd.flags & O.APPEND ? 1 : 0) | (ofd.flags & O.NONBLOCK ? 4 : 0), true); v.setBigUint64(out + 8, -1n & 0xffffffffffffffffn, true); v.setBigUint64(out + 16, -1n & 0xffffffffffffffffn, true); return 0;
      },
      clock_time_get: (id, precision, out) => {
        const ns = id === 0 ? BigInt(Math.round(k.clock.wall() * 1e6)) : id === 2 || id === 3 ? BigInt(Math.round((proc.cpuMs + performance.now() - proc.sliceStart) * 1e6)) : BigInt(Math.round(k.clock.now() * 1e6));
        dv().setBigUint64(out, ns, true); return 0;
      },
      clock_res_get: (id, out) => { dv().setBigUint64(out, 1000n, true); return 0; },
      random_get: (buf, length) => { u8().set(random(length), buf); return 0; },
      sched_yield: () => 0,
    };
    // setjmp / longjmp of the programs (Emscripten's JavaScript-based scheme): invoke_* calls a function of the table and turns the longjmp's exception into setThrew
    const LONGJMP = k.longjmpTag ??= Symbol('longjmp');
    const env = {
      _emscripten_throw_longjmp: () => { throw LONGJMP; },
      emscripten_notify_memory_growth: () => {},
      _emscripten_lookup_name: () => 0,
      getaddrinfo: () => { unsupported('getaddrinfo'); return -11; },   // EAI_SYSTEM
      getnameinfo: () => { unsupported('getnameinfo'); return -11; },
    };
    for (const name of ['accept4', 'bind', 'connect', 'getsockname', 'listen', 'recvfrom', 'recvmsg', 'sendto', 'socketpair', 'getpeername', 'shutdown', 'setsockopt', 'getsockopt', 'sendmsg'])
      env[`__syscall_${name}`] = () => unsupported(name);
    const invoke = (index, args) => {
      const sp = proc.x.emscripten_stack_get_current();
      try { return proc.x.__indirect_function_table.get(index)(...args); }
      catch (error) { if (error !== LONGJMP) throw error; proc.x._emscripten_stack_restore(sp); proc.x.setThrew(1, 0); return 0; }
    };
    return new Proxy({ lab, wasi_snapshot_preview1: wasi, env }, {
      get(target, module) {
        const table = target[module] ?? {};
        return new Proxy(table, { get(t, name) {
          if (name in t) return t[name];
          if (module === 'env' && typeof name === 'string' && name.startsWith('invoke_')) return (t[name] = (index, ...args) => invoke(index, args));
          return (t[name] = () => { const errno = unsupported(`${module}.${String(name)}`); return module === 'wasi_snapshot_preview1' ? -errno : errno; });
        } });
      },
    });
  }
  /** Raw system calls by number (asm-generic, include/sys/syscall.h): what a device answers an untrusted_app for each one the programs make. */
  rawSyscall(proc, number, args, { cstr, dv, unsupported }) {
    const a = args.map(Number);
    switch (number) {
      case 179: {   // sysinfo: uptime, no load figures (the lab has none), the memory ActivityManager.getMemoryInfo reports (4 GiB, half available), in pages
        const v = dv(), at = a[0], up = Math.floor(this.clock.now() / 1000), pages = 4 * 1024 * 1024 / 4;
        new Uint8Array(v.buffer).fill(0, at, at + 64);
        v.setInt32(at, up, true); v.setUint32(at + 16, pages, true); v.setUint32(at + 20, pages / 2, true); v.setUint16(at + 40, this.visiblePids().length, true); v.setUint32(at + 52, 4096, true);
        return 0;
      }
      case 116: return -E.PERM;   // syslog (klogctl): kernel.dmesg_restrict=1 on Android, and untrusted_app has no syslog_read
      case 40: case 39: case 224: case 225: case 161: case 162: case 142: case 105: case 273: case 106: case 41: case 165: case 112: case 170: case 171:   // mount umount2 swapon swapoff sethostname setdomainname reboot init_module finit_module delete_module pivot_root ...
        return -E.PERM;
      case 404: return -E.PERM;   // clock_settime64
      case 26: case 27: case 28: return unsupported('inotify', 'inotify_init1 / inotify_add_watch / inotify_rm_watch');
      case 107: case 409: case 408: case 111: return unsupported('POSIX timers', 'timer_create / timer_settime / timer_gettime / timer_delete');
      case 5: case 6: case 7: return -E.ACCES;   // setxattr family: relabeling and xattrs on system files are denied to an untrusted_app
      case 14: case 15: case 16: return -E.ACCES;
      case 8: case 9: case 10: {   // getxattr lgetxattr fgetxattr: security.selinux of the image's files
        const name = cstr(a[1]); let node;
        if (number === 10) node = proc.fds.get(a[0])?.ofd.node; else { const found = this.walk(proc, cstr(a[0]), { follow: number === 8 }); if (found.error) return -found.error; node = found.node; if (!node) return -E.NOENT; }
        const label = name === 'security.selinux' ? node?.label ?? (node?.system ? 'u:object_r:system_file:s0' : null) : null;
        if (!label) return -E.NODATA;
        const bytes = text(label + '\0'); if (a[3] === 0) return bytes.length; if (a[3] < bytes.length) return -E.RANGE;
        new Uint8Array(dv().buffer).set(bytes, a[2]); return bytes.length;
      }
      case 11: case 12: case 13: {   // listxattr family
        let node; if (number === 13) node = proc.fds.get(a[0])?.ofd.node; else { const found = this.walk(proc, cstr(a[0]), { follow: number === 11 }); if (found.error) return -found.error; node = found.node; }
        if (!node) return -E.NOENT;
        const list = node.label || node.system ? text('security.selinux\0') : new Uint8Array(0);
        if (a[2] === 0) return list.length; if (a[2] < list.length) return -E.RANGE; new Uint8Array(dv().buffer).set(list, a[1]); return list.length;
      }
      case 118: case 119: case 120: case 121: case 122: case 123: case 125: case 126: case 127: return number === 119 || number === 118 ? -E.PERM : 0;   // sched_*: SCHED_FIFO/RR need CAP_SYS_NICE; getters answer SCHED_OTHER / priority 0
      case 30: case 31: return number === 31 ? 0 : -E.PERM;   // ioprio_set (a better class needs CAP_SYS_ADMIN) / ioprio_get
      case 117: return -E.PERM;   // ptrace: an untrusted_app's processes may not trace (seccomp and SELinux)
      case 178: return proc.pid;  // gettid
    }
    return unsupported(`system call ${number}`);
  }
  flock(ofd, operation) {   // LOCK_SH 1, LOCK_EX 2, LOCK_NB 4, LOCK_UN 8
    const node = ofd.node ?? ofd.desc?.node; if (!node) return 0;
    const holders = this.locks.get(node) ?? new Map();
    if (operation & 8) { holders.delete(ofd); if (!holders.size) this.locks.delete(node); ofd.lock = null; return 0; }
    const exclusive = !!(operation & 2), conflict = () => [...holders].some(([other, kind]) => other !== ofd && (exclusive || kind === 'ex'));
    if (conflict()) return operation & 4 ? -E.AGAIN : new Wait(() => !conflict(), 'flock');
    holders.set(ofd, exclusive ? 'ex' : 'sh'); this.locks.set(node, holders); ofd.lock = node; return 0;
  }
  unlock(ofd) { const holders = this.locks.get(ofd.lock); holders?.delete(ofd); if (holders && !holders.size) this.locks.delete(ofd.lock); ofd.lock = null; }

  // ---- users and groups as bionic names them (libc/bionic/grp_pwd.cpp: android_ids, then the app id ranges) ------------------------------------------------------------
  userById(id) {
    const appId = id % 100000, user = Math.floor(id / 100000);
    if (appId < 10000) { for (const [name, value] of ANDROID_IDS) if (value === appId) return { name: user ? `u${user}_${name}` : name, id }; return null; }
    if (appId >= 99000 && appId <= 99999) return { name: `u${user}_i${appId - 99000}`, id };
    if (appId >= 50000 && appId <= 59999) return { name: `all_a${appId - 50000}`, id };
    if (appId >= 20000 && appId <= 29999) return { name: `u${user}_a${appId - 20000}_cache`, id };
    if (appId >= 10000 && appId <= 19999) return { name: `u${user}_a${appId - 10000}`, id };
    return null;
  }
  userByName(name) {
    if (ANDROID_IDS.has(name)) return { name, id: ANDROID_IDS.get(name) };
    let m = /^u(\d+)_a(\d+)(_cache)?$/.exec(name); if (m) return { name, id: Number(m[1]) * 100000 + (m[3] ? 20000 : 10000) + Number(m[2]) };
    m = /^all_a(\d+)$/.exec(name); if (m) return { name, id: 50000 + Number(m[1]) };
    m = /^u(\d+)_i(\d+)$/.exec(name); if (m) return { name, id: Number(m[1]) * 100000 + 99000 + Number(m[2]) };
    return null;
  }
}
