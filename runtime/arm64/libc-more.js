// A further part of bionic for the ARM64 process (src/arm64/libc.js, libc-extra.js): stdio data pointers, POSIX semaphores, vectored I/O, stream helpers, string
// helpers, time parsing, network-interface queries, floating-point environment and the *_chk wrappers. fork, POSIX
// timers and inotify are not provided by the lab and fail by name.
import { deviceMemory, bootUptimeMs } from '../process-memory.js?v=0feec282e5a9';
import { APKError } from '../apk-error.js?v=0feec282e5a9';
import { BLOCKED } from './cpu.js?v=0feec282e5a9';
import { formatC, variadic } from './libc.js?v=0feec282e5a9';
import { lookup, deviceInterfaces } from '../libcore-io-native.js?v=0feec282e5a9';
import { restrictedNetlink } from './netlink.js?v=0feec282e5a9';
import { utf8 } from './text.js?v=0feec282e5a9';

export function addMoreLibc(lib, { runtime } = {}) {
  const x = (c, i) => c.x[i], n = (c, i) => Number(c.x[i]), s32 = (c, i) => Number(BigInt.asIntN(32, c.x[i]));
  const decoder = utf8, encoder = new TextEncoder(), str = (p, ptr) => decoder.decode(p.memory.cString(Number(ptr)));
  const fail = (p, errno) => { p.memory.writeU32(p.errnoAddress, errno); return 0xffffffffffffffffn; };
  const notProvided = what => () => { throw new APKError(`ARM64 native code called ${what}: the lab does not provide it`, { kind: 'arm64-missing-symbol', symbol: what }); };
  // stdin / stdout / stderr: FILE* variables bionic exports since API 23, pointing into __sF
  const sf = p => { p.hostData ??= new Map(); if (!p.hostData.has('__sF')) p.hostData.set('__sF', lib.__data.__sF(p)); return p.hostData.get('__sF'); };
  for (const [name, index] of [['stdin', 0], ['stdout', 1], ['stderr', 2]]) lib.__data[name] = p => { const holder = p.malloc(8); p.memory.writePtr(holder, sf(p) + 152 * index); return holder; };
  // _ctype_: bionic's `const char* _ctype_` (OpenBSD ctype_.c: a pointer variable to _C_ctype_), so the symbol is a pointer to the 1 + 256 entry table; isalnum and friends
  // read (_ctype_ + 1)[c] through it
  lib.__data._ctype_ = p => { const table = p.malloc(257); for (let i = 0; i < 256; i++) { const ch = String.fromCharCode(i); p.memory.setByte(table + 1 + i, (/[A-Z]/.test(ch) ? 1 : 0) | (/[a-z]/.test(ch) ? 2 : 0) | (/[0-9]/.test(ch) ? 4 : 0) | (/[ \t\n\v\f\r]/.test(ch) ? 8 : 0) | (/[!-\/:-@\[-`{-~]/.test(ch) ? 16 : 0) | (i < 32 || i === 127 ? 32 : 0) | (/[0-9A-Fa-f]/.test(ch) ? 64 : 0) | (ch === ' ' ? 128 : 0)); } const holder = p.malloc(8); p.memory.writePtr(holder, table); return holder; };
  lib.__data.tzname = p => { const a = p.malloc(16); p.memory.writePtr(a, p.allocString('GMT')); p.memory.writePtr(a + 8, p.allocString('GMT')); return a; };
  lib.__data.timezone = p => { const a = p.malloc(8); p.memory.write64(a, 0n); return a; };
  // ---- POSIX semaphores (sem_t: the count in the first word) waiting as native threads do
  lib.sem_init = (p, c) => { p.memory.writeU32(n(c, 0), n(c, 2)); return 0; };
  lib.sem_destroy = () => 0;
  lib.sem_post = (p, c) => { p.memory.writeU32(n(c, 0), p.memory.readU32(n(c, 0)) + 1); p.threads.schedulePump(); return 0; };
  lib.sem_trywait = (p, c) => { const v = p.memory.readU32(n(c, 0)); if (!v) return fail(p, 11); p.memory.writeU32(n(c, 0), v - 1); return 0; };
  const semWait = (p, c, deadline) => { const sem = n(c, 0), r = p.threads.wait(c, () => p.memory.readU32(sem) > 0, { what: `a semaphore at 0x${sem.toString(16)}`, deadline }); if (r === BLOCKED) return BLOCKED; if (r === false) return fail(p, 110); p.memory.writeU32(sem, p.memory.readU32(sem) - 1); return 0; };
  lib.sem_wait = (p, c) => semWait(p, c, Infinity);
  lib.sem_timedwait = (p, c) => semWait(p, c, p.threads.now() + Math.max(0, Number(p.memory.read64(n(c, 1))) * 1000 + Number(p.memory.read64(n(c, 1) + 8)) / 1e6 - Date.now()));
  lib.sem_getvalue = (p, c) => { p.memory.writeU32(n(c, 1), p.memory.readU32(n(c, 0))); return 0; };
  // ---- vectored I/O over read/write (struct iovec { void* base; size_t len; })
  const vector = (p, c, op) => { const fd = c.x[0], iov = n(c, 1), count = n(c, 2); let total = 0; for (let i = 0; i < count; i++) { const base = p.memory.readPtr(iov + 16 * i), len = p.memory.readPtr(iov + 16 * i + 8); if (!len) continue; c.x[0] = fd; c.x[1] = BigInt(base); c.x[2] = BigInt(len); const r = op(p, c); if (r === BLOCKED) return BLOCKED; const k = Number(BigInt.asIntN(64, BigInt(r))); if (k < 0) return total || r; total += k; if (k < len) break; } return total; };
  lib.readv = (p, c) => vector(p, c, lib.read); lib.writev = (p, c) => vector(p, c, lib.write);
  lib.__pread_chk = lib.__pread64_chk = (p, c) => lib.pread(p, c); lib.__pwrite_chk = lib.__pwrite64_chk = lib.pwrite64 ? (p, c) => lib.pwrite64(p, c) : notProvided('pwrite');
  // bionic's __fgets_chk(dst, supplied_size, stream, dst_len): fgets(dst, supplied_size, stream), its arguments already in place; aborts when supplied_size exceeds the buffer
  lib.__fgets_chk = (p, c) => {
    const size = Number(BigInt.asIntN(32, c.x[1])), length = n(c, 3);
    if (size < 0) throw new APKError(`FORTIFY: fgets: buffer size ${size} < 0 (bionic aborts the process here)`, { kind: 'arm64-abort' });
    if (size > length) throw new APKError(`FORTIFY: fgets: prevented ${size}-byte write into ${length}-byte buffer (bionic aborts the process here)`, { kind: 'arm64-abort' });
    return lib.fgets(p, c);
  };
  lib.__umask_chk = lib.umask = () => 0o022;
  lib.__FD_SET_chk = (p, c) => { const fd = s32(c, 0), set = n(c, 1); p.memory.setByte(set + (fd >> 3), p.memory.byte(set + (fd >> 3)) | (1 << (fd & 7))); };
  lib.__FD_CLR_chk = (p, c) => { const fd = s32(c, 0), set = n(c, 1); p.memory.setByte(set + (fd >> 3), p.memory.byte(set + (fd >> 3)) & (~(1 << (fd & 7)))); };
  lib.__FD_ISSET_chk = (p, c) => { const fd = s32(c, 0), set = n(c, 1); return (p.memory.byte(set + (fd >> 3)) >> (fd & 7)) & 1; };
  // ---- streams
  lib.ungetc = (p, c) => { const ch = s32(c, 0); if (ch < 0) return 0xffffffffffffffffn; p.unget ??= new Map(); p.unget.set(n(c, 1), ch); return ch; };
  lib.getline = lib.__getline = (p, c) => { const lineptr = n(c, 0), sizePtr = n(c, 1); let out = []; for (;;) { c.x[0] = c.x[2]; const ch = Number(BigInt.asIntN(32, BigInt(lib.fgetc(p, { x: [x(c, 2)] })))); if (ch < 0) break; out.push(ch); if (ch === 10) break; } if (!out.length) return 0xffffffffffffffffn; let buf = p.memory.readPtr(lineptr), size = Number(p.memory.read64(sizePtr)); if (!buf || size < out.length + 1) { buf = p.malloc(out.length + 1); p.memory.writePtr(lineptr, buf); p.memory.write64(sizePtr, BigInt(out.length + 1)); } p.memory.copyIn(buf, Uint8Array.from(out)); p.memory.setByte(buf + out.length, 0); return out.length; };
  lib.vprintf = (p, c) => lib.vfprintf(p, { ...c, x: [BigInt(sf(p) + 152), c.x[0], c.x[1], ...c.x.slice(3)], getD: i => c.getD(i), sp: c.sp, mem: c.mem });
  lib.__android_log_buf_print = (p, c) => { runtime?.record?.(`LOG ${'VVVDIWEFS'[n(c, 1)] ?? 'I'} ${str(p, x(c, 2))}: ${formatC(p.memory, str(p, x(c, 3)), variadic(c, 4))}`); return 1; };
  lib.tmpfile = (p, c) => { const path = `/data/local/tmp/native-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; c.x[0] = BigInt(p.allocString(path)); c.x[1] = BigInt(p.allocString('w+')); return lib.fopen(p, c); };
  // ---- strings
  lib.memmem = (p, c) => { const hay = p.memory.bytes(n(c, 0), n(c, 1)), needle = p.memory.bytes(n(c, 2), n(c, 3)); if (!needle.length) return n(c, 0); outer: for (let i = 0; i + needle.length <= hay.length; i++) { for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer; return n(c, 0) + i; } return 0; };
  lib.strsep = (p, c) => { const holder = n(c, 0), s = p.memory.readPtr(holder); if (!s) return 0; const delims = new Set(p.memory.cString(n(c, 1))); let e = s; while (p.memory.byte(e) && !delims.has(p.memory.byte(e))) e++; if (p.memory.byte(e)) { p.memory.setByte(e, 0); p.memory.writePtr(holder, e + 1); } else p.memory.writePtr(holder, 0); return s; };
  lib.fnmatch = (p, c) => { const pattern = str(p, x(c, 0)), name = str(p, x(c, 1)), re = new RegExp('^' + pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'); return re.test(name) ? 0 : 1; };
  lib.wcschr = (p, c) => { for (let i = 0; ; i++) { const v = p.memory.readU32(n(c, 0) + 4 * i); if (v === n(c, 1)) return n(c, 0) + 4 * i; if (!v) return 0; } };
  lib.wcsncmp = (p, c) => { for (let i = 0; i < n(c, 2); i++) { const a = p.memory.readU32(n(c, 0) + 4 * i), b = p.memory.readU32(n(c, 1) + 4 * i); if (a !== b) return a < b ? 0xffffffffffffffffn : 1; if (!a) return 0; } return 0; };
  lib.ldiv = lib.lldiv = (p, c) => { const a = BigInt.asIntN(64, x(c, 0)), b = BigInt.asIntN(64, x(c, 1)); c.x[1] = BigInt.asUintN(64, a % b); return BigInt.asUintN(64, a / b); };
  lib.getprogname = p => p.allocString('app_process64');
  lib.inet_aton = (p, c) => { const parts = str(p, x(c, 0)).split('.').map(Number); if (parts.length !== 4 || parts.some(v => !(v >= 0 && v <= 255))) return 0; parts.forEach((b, i) => { p.memory.setByte(n(c, 1) + i, b); }); return 1; };
  lib.inet_ntoa = (p, c) => p.allocString([0, 8, 16, 24].map(s => (n(c, 0) >>> s) & 255).join('.'));
  lib.getnameinfo = (p, c) => { const ip = [...p.memory.bytes(n(c, 0) + 4, 4)].join('.'), port = p.memory.uint16(n(c, 0) + 2, false); if (n(c, 2)) { const b = encoder.encode(ip); p.memory.copyIn(n(c, 2), b); p.memory.setByte(n(c, 2) + b.length, 0); } if (n(c, 4)) { const b = encoder.encode(String(port)); p.memory.copyIn(n(c, 4), b); p.memory.setByte(n(c, 4) + b.length, 0); } return 0; };
  // getifaddrs as bionic builds it from the kernel's netlink answers (src/arm64/netlink.js) over the device's interfaces: for an app targeting API 30+ only the address
  // entries (RTM_GETLINK is denied: no AF_PACKET entries, no hardware addresses), the flags as SIOCGIFFLAGS gives them; below API 30 an AF_PACKET entry per interface first.
  // struct ifaddrs (arm64): ifa_next @0, ifa_name @8, ifa_flags @16, ifa_addr @24, ifa_netmask @32, ifa_broadaddr @40, ifa_data @48; one malloc block per entry.
  lib.getifaddrs = (p, c) => {
    const entries = [], restricted = restrictedNetlink(runtime);
    const inet = bytes => { if (!bytes) return null; const v4 = bytes.length === 4, b = new Uint8Array(v4 ? 16 : 28); b[0] = v4 ? 2 : 10; b.set(bytes, v4 ? 4 : 8); return b; };
    const packet = (face, mac) => { const b = new Uint8Array(20); b[0] = 17; new DataView(b.buffer).setInt32(4, face.index, true); new DataView(b.buffer).setUint16(8, face.name === 'lo' ? 772 : 1, true); b[11] = 6; b.set(mac, 12); return b; };   // struct sockaddr_ll
    for (const face of deviceInterfaces(runtime)) {
      if (!restricted) entries.push({ face, addr: packet(face, face.mac), mask: null, broadcast: face.name === 'lo' ? null : packet(face, [255, 255, 255, 255, 255, 255]) });
      for (const a of face.addresses) entries.push({ face, addr: inet(a.addr), mask: inet(a.mask), broadcast: inet(a.broadcast) });
    }
    let head = 0;
    for (const entry of entries.reverse()) {
      const name = encoder.encode(entry.face.name), parts = [entry.addr, entry.mask, entry.broadcast], size = 56 + 32 + parts.reduce((k, b) => k + (b ? 32 : 0), 0), at = p.malloc(size);
      p.memory.fill(at, 0, size); p.memory.writePtr(at, head); p.memory.writePtr(at + 8, at + 56); p.memory.copyIn(at + 56, name); p.memory.writeU32(at + 16, entry.face.flags);
      let next = at + 88; parts.forEach((b, i) => { if (!b) return; p.memory.copyIn(next, b); p.memory.writePtr(at + 24 + 8 * i, next); next += 32; });
      head = at;
    }
    p.memory.writePtr(n(c, 0), head); return 0;
  };
  lib.freeifaddrs = (p, c) => { for (let at = n(c, 0); at; ) { const next = p.memory.readPtr(at); p.free(at); at = next; } };
  lib.android_get_application_target_sdk_version = () => Number(runtime?.targetSdkVersion ?? 33);
  // ---- time
  lib.ctime = (p, c) => { const d = new Date(Number(BigInt.asIntN(64, p.memory.read64(n(c, 0)))) * 1000); return p.allocString(d.toUTCString() + '\n'); };
  lib.strptime = (p, c) => { const s = str(p, x(c, 0)), f = str(p, x(c, 1)), tm = n(c, 2); const re = f.replace(/%([YmdHMSjy%])/g, (_, k) => k === 'Y' ? '(\\d{4})' : k === '%' ? '%' : k === 'j' ? '(\\d{1,3})' : '(\\d{1,2})').replace(/%[a-zA-Z]/g, '(\\S+)'); const m = new RegExp('^' + re).exec(s); if (!m) return 0; const keys = [...f.matchAll(/%([a-zA-Z%])/g)].map(k => k[1]).filter(k => k !== '%'); keys.forEach((k, i) => { const v = Number(m[i + 1]); const at = { S: 0, M: 1, H: 2, d: 3, m: 4, Y: 5, y: 5, j: 7 }[k]; if (at === undefined) return; p.memory.writeU32(tm + 4 * at, k === 'm' ? v - 1 : k === 'Y' ? v - 1900 : k === 'y' ? (v < 69 ? v + 100 : v) : k === 'j' ? v - 1 : v); }); return n(c, 0) + encoder.encode(m[0]).length; };
  // sysinfo: uptime (the VM clock since boot), totalram / freeram (the device's memory and what the app's process does not hold of it: src/process-memory.js, as
  // ActivityManager.getMemoryInfo and /proc/meminfo give them), procs (this one process), mem_unit 1; no shared, buffer or swap memory, no load averages kept
  lib.sysinfo = (p, c) => {
    const at = n(c, 0), memory = deviceMemory(runtime); p.memory.fill(at, 0, 112);
    p.memory.write64(at, BigInt(Math.floor(bootUptimeMs(runtime?.platform) / 1000))); p.memory.write64(at + 32, BigInt(memory.total)); p.memory.write64(at + 40, BigInt(memory.available));
    p.memory.setUint16(at + 80, 1); p.memory.writeU32(at + 104, 1); return 0;
  };
  // ---- floating-point environment (round to nearest, no traps, no flags kept)
  lib.feclearexcept = lib.fetestexcept = lib.feraiseexcept = lib.fegetround = () => 0; lib.fesetround = (p, c) => n(c, 0) === 0 ? 0 : 1; lib.fegetenv = lib.fesetenv = lib.feholdexcept = lib.feupdateenv = (p, c) => { if (n(c, 0)) p.memory.fill(n(c, 0), 0, 8); return 0; };
  lib.lrint = lib.llrint = (p, c) => BigInt.asUintN(64, BigInt(Math.round(c.getD(0)))); lib.lrintf = lib.llrintf = (p, c) => BigInt.asUintN(64, BigInt(Math.round(c.getS(0))));
  lib.ilogb = (p, c) => { const v = Math.abs(c.getD(0)); return v === 0 ? 0x80000000n : BigInt(Math.floor(Math.log2(v))); }; lib.ilogbf = (p, c) => { const v = Math.abs(c.getS(0)); return v === 0 ? 0x80000000n : BigInt(Math.floor(Math.log2(v))); };
  lib.logb = (p, c) => ({ double: Math.floor(Math.log2(Math.abs(c.getD(0)))) });
  // ---- process, scheduling, files
  lib.sched_getcpu = () => 0; lib.pthread_gettid_np = (p, c) => p.threads.byPthread(n(c, 0))?.tid ?? -1; lib.pthread_attr_setscope = lib.pthread_attr_setguardsize = lib.sched_getscheduler = lib.sched_getparam = () => 0; lib.nice = () => 0; lib.setsid = () => 1; lib.setpgid = () => 0;
  lib.__libc_current_sigrtmin = () => 34; lib.__libc_current_sigrtmax = () => 64;
  lib.sigwait = () => 0;   // the sigset_t functions, sigaction64 and sigprocmask64: src/arm64/signals.js
  lib.posix_fadvise = lib.mlock = lib.munlock = () => 0;   // mincore: src/arm64/libc.js (residency of mapped pages)
  lib.mremap = (p, c) => { const old = n(c, 0), oldSize = n(c, 1), size = n(c, 2), at = p.mapRegion(size, 0x1000); p.memory.copyIn(at, p.memory.bytes(old, Math.min(oldSize, size)).slice()); return at; };
  // memfd_create: an anonymous file, held in the VM file system under /memfd (the directory is made on first use: without it the file was never created, and the
  // descriptor read and mapped as empty)
  lib.memfd_create = (p, c) => { const path = `/memfd/${str(p, x(c, 0))}-${Date.now()}-${(p.memfds = (p.memfds ?? 0) + 1)}`; lib['memfd-dir']?.(); c.x[0] = BigInt(p.allocString(path)); c.x[1] = 0o102n; return lib.open(p, c); };
  lib.truncate = (p, c) => { c.x[0] = BigInt(lib.open(p, { x: [x(c, 0), 2n] })); return lib.ftruncate(p, c); };
  lib.fstatat = lib.fstatat64 = lib.newfstatat = (p, c) => { c.x[0] = c.x[1]; c.x[1] = c.x[2]; return lib.stat(p, c); };
  lib.faccessat = (p, c) => { c.x[0] = c.x[1]; return lib.access(p, c); };
  lib.chdir = lib.fchdir = () => 0; lib.dirfd = () => 3; lib.rewinddir = () => {};
  lib.renameat = (p, c) => { c.x[0] = c.x[1]; c.x[1] = c.x[3]; return lib.rename(p, c); };
  lib.link = lib.symlink = lib.symlinkat = lib.linkat = (p) => fail(p, 1);   // EPERM: the app's data directory does not take links here

  // ---- running another program: the definitions below are replaced by src/arm64/processes.js (fork, the exec family, system, posix_spawn over the lab's process kernel and the
  // device's /system/bin programs); they stay for a libc made without it.
  const ENV_PATH = () => String(runtime?.platform?.environment?.PATH ?? '/system/bin:/system/xbin');
  const programErrno = program => {
    const fs = runtime?.platform?.javaIo?.fs?.(); if (!fs) return 2;
    const candidates = program.includes('/') ? [program] : ENV_PATH().split(':').filter(Boolean).map(dir => `${dir.replace(/\/$/, '')}/${program}`);
    let denied = false;
    for (const candidate of candidates) {
      const found = lookup(fs, candidate); if (!found.node) continue;
      if (found.node.type === 'dir' || !(found.node.mode & 0o111)) { denied = true; continue; }
      throw new APKError(`ARM64 native code started ${found.path}: the virtual device has no CPU to run a native executable`, { kind: 'exec-unsupported', path: found.path });
    }
    return denied ? 13 : 2;
  };
  const record = (what, command, errno) => runtime?.record?.(`PROCESS native ${what} ${JSON.stringify(command)} failed: ${errno === 2 ? 'ENOENT' : 'EACCES'} (no executable on the virtual device)`);
  lib.popen = (p, c) => { const command = str(p, x(c, 0)), errno = programErrno('/system/bin/sh'); record('popen', command, errno); p.memory.writeU32(p.errnoAddress, errno); return 0; };
  lib.system = (p, c) => { if (!n(c, 0)) return 0; const command = str(p, x(c, 0)), errno = programErrno('/system/bin/sh'); record('system', command, errno); return fail(p, errno); };   // system(NULL): no shell is available
  lib.execv = lib.execve = lib.execl = lib.execle = (p, c) => { const path = str(p, x(c, 0)), errno = programErrno(path.includes('/') ? path : `./${path}`); record('exec', path, errno); return fail(p, errno); };
  lib.execvp = lib.execvpe = lib.execlp = (p, c) => { const path = str(p, x(c, 0)), errno = programErrno(path); record('exec', path, errno); return fail(p, errno); };
  lib.posix_spawn = (p, c) => { const path = str(p, x(c, 1)), errno = programErrno(path.includes('/') ? path : `./${path}`); record('posix_spawn', path, errno); return errno; };   // returns the error number
  lib.posix_spawnp = (p, c) => { const path = str(p, x(c, 1)), errno = programErrno(path); record('posix_spawnp', path, errno); return errno; };
  for (const name of ['posix_spawnattr_init', 'posix_spawnattr_destroy', 'posix_spawnattr_setflags', 'posix_spawnattr_setsigmask', 'posix_spawnattr_setsigdefault', 'posix_spawn_file_actions_init', 'posix_spawn_file_actions_destroy', 'posix_spawn_file_actions_adddup2', 'posix_spawn_file_actions_addclose', 'posix_spawn_file_actions_addopen']) lib[name] = () => 0;
  for (const name of ['inotify_init1', 'inotify_add_watch', 'splice', 'sendfile', 'sendfile64']) lib[name] = notProvided(name);
  // ---- libz.so checksums (zlib crc32.c / adler32.c): crc32 / crc32_z (the reflected CRC-32, polynomial 0xedb88320), adler32 / adler32_z, and their _combine forms. A NULL buffer
  // answers the initial value (0 for crc32, 1 for adler32), as zlib does. zlib's stream functions (inflate, deflate ...) are not provided by the lab and fail by name.
  const CRC_TABLE = new Uint32Array(256).map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (crc, bytes) => { let c = (crc ^ 0xffffffff) >>> 0; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const adler32 = (adler, bytes) => { let a = adler & 0xffff, b = (adler >>> 16) & 0xffff; for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; };
  lib.crc32 = lib.crc32_z = (p, c) => { const buf = n(c, 1); if (!buf) return 0; return crc32(Number(c.x[0] & 0xffffffffn), p.memory.bytes(buf, n(c, 2))); };
  lib.adler32 = lib.adler32_z = (p, c) => { const buf = n(c, 1); if (!buf) return 1; return adler32(Number(c.x[0] & 0xffffffffn), p.memory.bytes(buf, n(c, 2))); };
  // crc32_combine(crc1, crc2, len2): the CRC of the concatenation, by the GF(2) matrix method of zlib's crc32_combine_
  const gf2Times = (mat, vec) => { let sum = 0; for (let i = 0; vec; i++, vec >>>= 1) if (vec & 1) sum ^= mat[i]; return sum >>> 0; };
  const gf2Square = (square, mat) => { for (let i = 0; i < 32; i++) square[i] = gf2Times(mat, mat[i]); };
  lib.crc32_combine = lib.crc32_combine64 = (p, c) => {
    let crc1 = Number(c.x[0] & 0xffffffffn), len2 = Number(BigInt.asIntN(64, c.x[2])); const crc2 = Number(c.x[1] & 0xffffffffn);
    if (len2 <= 0) return crc1;
    const even = new Array(32), odd = new Array(32); odd[0] = 0xedb88320; let row = 1; for (let i = 1; i < 32; i++) { odd[i] = row; row <<= 1; }
    gf2Square(even, odd); gf2Square(odd, even);
    do { gf2Square(even, odd); if (len2 & 1) crc1 = gf2Times(even, crc1); len2 = Math.floor(len2 / 2); if (!len2) break; gf2Square(odd, even); if (len2 & 1) crc1 = gf2Times(odd, crc1); len2 = Math.floor(len2 / 2); } while (len2);
    return (crc1 ^ crc2) >>> 0;
  };
  lib.adler32_combine = lib.adler32_combine64 = (p, c) => {   // zlib adler32_combine_
    const adler1 = Number(c.x[0] & 0xffffffffn), adler2 = Number(c.x[1] & 0xffffffffn), len2 = Number(BigInt.asIntN(64, c.x[2])), BASE = 65521;
    if (len2 < 0) return 0xffffffff;
    const rem = len2 % BASE; let sum1 = adler1 & 0xffff, sum2 = (rem * sum1) % BASE;
    sum1 += (adler2 & 0xffff) + BASE - 1; sum2 += ((adler1 >>> 16) & 0xffff) + ((adler2 >>> 16) & 0xffff) + BASE - rem;
    if (sum1 >= BASE) sum1 -= BASE; if (sum1 >= BASE) sum1 -= BASE; if (sum2 >= (BASE << 1)) sum2 -= (BASE << 1); if (sum2 >= BASE) sum2 -= BASE;
    return ((sum2 << 16) | sum1) >>> 0;
  };
  return lib;
}
