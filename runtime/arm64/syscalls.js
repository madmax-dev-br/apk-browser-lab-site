// Raw Linux system calls of the ARM64 native process (docs/ARM64-NATIVE.md "System calls"). Some libraries enter the kernel themselves (an `svc #0` with the
// number in X8 and the arguments in X0-X5, or bionic's syscall(3)) instead of calling libc. Both reach the same lab implementations as the libc functions: the
// arm64 (asm-generic) numbers below map to the libc function whose arguments the call has in the same order. A raw call returns -errno, as the kernel does;
// syscall(3) returns -1 and sets errno, as bionic does. A number the lab does not provide fails naming it, never a silent 0.
import { APKError } from '../apk-error.js?v=e0932d3cf1f5';
import { BLOCKED } from './cpu.js?v=e0932d3cf1f5';

// number -> libc function taking the same arguments in the same registers
const SAME = {
  5: 'setxattr', 6: 'lsetxattr', 7: 'fsetxattr', 8: 'getxattr', 9: 'lgetxattr', 10: 'fgetxattr', 11: 'listxattr', 12: 'llistxattr', 13: 'flistxattr', 14: 'removexattr', 15: 'lremovexattr', 16: 'fremovexattr',
  17: 'getcwd', 61: 'getdents64', 23: 'dup', 45: 'truncate', 46: 'ftruncate', 47: 'fallocate', 24: 'dup3', 25: 'fcntl', 29: 'ioctl', 34: 'mkdirat', 35: 'unlinkat', 48: 'faccessat', 56: 'openat', 57: 'close', 62: 'lseek',
  63: 'read', 64: 'write', 65: 'readv', 66: 'writev', 67: 'pread64', 68: 'pwrite64', 79: 'fstatat', 80: 'fstat', 82: 'fsync', 83: 'fdatasync', 101: 'nanosleep',
  102: 'getitimer', 103: 'setitimer', 107: 'timer_create', 108: 'timer_gettime', 109: 'timer_getoverrun', 110: 'timer_settime', 111: 'timer_delete',
  122: 'sched_setaffinity', 123: '__sched_getaffinity',   // the raw sched_getaffinity returns the bytes copied (the kernel's), libc's wrapper 0
  113: 'clock_gettime', 114: 'clock_getres', 124: 'sched_yield', 129: 'kill', 130: 'tkill', 131: 'tgkill', 132: 'sigaltstack', 160: 'uname', 167: 'prctl', 169: 'gettimeofday',
  155: 'getpgid', 156: 'getsid', 172: 'getpid', 173: 'getppid', 174: 'getuid', 175: 'geteuid', 176: 'getgid', 177: 'getegid', 179: 'sysinfo', 215: 'munmap', 216: 'mremap', 222: 'mmap',
  226: 'mprotect', 232: 'mincore', 233: 'madvise', 261: 'prlimit64', 278: 'getrandom', 279: 'memfd_create', 93: '_exit', 94: '_exit',
  // descriptors that wait and wake (src/arm64/sockets.js): ppoll and pselect6 take a struct timespec as their libc functions do; the signal mask argument is not used
  19: 'eventfd', 20: 'epoll_create1', 21: 'epoll_ctl', 22: 'epoll_pwait', 59: 'pipe2', 72: 'pselect', 73: 'ppoll', 85: 'timerfd_create', 86: 'timerfd_settime', 87: 'timerfd_gettime',
  // sockets (src/arm64/sockets.js, src/arm64/netlink.js)
  198: 'socket', 199: 'socketpair', 200: 'bind', 201: 'listen', 202: 'accept', 203: 'connect', 204: 'getsockname', 205: 'getpeername', 206: 'sendto', 207: 'recvfrom',
  208: 'setsockopt', 209: 'getsockopt', 210: 'shutdown', 211: 'sendmsg', 212: 'recvmsg', 242: 'accept4', 243: 'recvmmsg', 269: 'sendmmsg',
  // the process's own memory through iovecs (below)
  270: 'process_vm_readv', 271: 'process_vm_writev',
};
const NAMES = { 78: 'readlinkat', 96: 'set_tid_address', 98: 'futex', 134: 'rt_sigaction', 135: 'rt_sigprocmask', 178: 'gettid', 220: 'clone', 221: 'execve', 260: 'wait4', 435: 'clone3' };
const EINVAL = 22;

export function addSyscalls(lib) {
  /** Runs system call `number` with its arguments already in X0-X5; returns the libc-convention result (-1 and errno on failure). */
  const run = (p, c, number, from = null) => {
    switch (number) {
      case 78: c.x[0] = c.x[1]; c.x[1] = c.x[2]; c.x[2] = c.x[3]; return lib.readlink(p, c);   // readlinkat(dirfd, path, buf, size)
      case 96: case 178: return p.threads ? p.threads.current.tid : lib.getpid(p, c);          // set_tid_address / gettid
      case 98: return p.futex(c, Number(c.x[0]), Number(c.x[1]) & 0x7f, Number(BigInt.asIntN(32, c.x[2])), Number(c.x[3]));
      case 134: return 0;   // rt_sigaction: the kernel's struct (handler, flags, restorer, mask) is not bionic's; the libc sigaction keeps the dispositions (src/arm64/signals.js)
      case 135: return lib.sigprocmask(p, c);   // rt_sigprocmask(how, set, old, sigsetsize): the 64-bit set is bionic's sigset_t
      case 220: return lib.__clone(p, c);       // clone: a new process without CLONE_VM (src/arm64/processes.js); a thread fails there by name
      case 435: return lib.__clone3(p, c);
      case 221: return lib.execve(p, c);        // execve(path, argv, envp)
      case 260: return lib.wait4(p, c);         // wait4(pid, status, options, rusage)
      case 117: return lib.ptrace(p, c);
      case 168: { const cpu = Number(c.x[0]), node = Number(c.x[1]); if (cpu) p.memory.writeU32(cpu, lib.sched_getcpu(p, c)); if (node) p.memory.writeU32(node, 0); return 0; }   // getcpu(cpu*, node*, unused): the device's one CPU on NUMA node 0
    }
    const name = SAME[number], fn = name && (lib[name] ?? lib[name.replace(/64$/, '')]);
    if (typeof fn === 'function') return fn(p, c);
    const detail = number === 220 ? ` with flags 0x${(Number(c.x[0]) >>> 0).toString(16)}${Number(c.x[0]) & 0x100 ? ' (a thread: CLONE_VM)' : ' (a new process: fork)'}` : '';
    throw new APKError(`ARM64 native code made system call ${number}${NAMES[number] ? ` (${NAMES[number]})` : ''}${detail}${from ? ` (${from})` : ''}: not provided by the lab`, { kind: 'arm64-syscall', syscall: number });
  };
  // process_vm_readv / process_vm_writev(pid, local_iov, liovcnt, remote_iov, riovcnt, flags) (Linux mm/process_vm_access.c): the bytes of the remote iovecs, in order, into (or from)
  // the local ones; the result is the number of bytes moved, which stops short at the first remote range that is not mapped (EFAULT when nothing moved). The virtual device has
  // one process per app and no ptrace access between them: only the calling process's own pid is a target (ESRCH for another one, as for a pid that does not exist); flags must be 0.
  const EFAULT = 14, ESRCH = 3;
  const setErrno = (p, value) => { p.memory.writeU32(p.errnoAddress, value); return -1; };
  const iovecs = (p, at, count) => { const out = []; for (let i = 0; i < count; i++) out.push({ base: p.memory.readPtr(at + 16 * i), length: p.memory.readPtr(at + 16 * i + 8) }); return out; };
  const transfer = write => (p, c) => {
    const pid = Number(BigInt.asIntN(32, c.x[0])), local = Number(c.x[1]), localCount = Number(c.x[2]), remote = Number(c.x[3]), remoteCount = Number(c.x[4]), flags = Number(c.x[5]);
    if (flags !== 0 || localCount > 1024 || remoteCount > 1024) return setErrno(p, EINVAL);
    if (pid !== lib.getpid(p, c)) return setErrno(p, ESRCH);
    if ((localCount && !p.memory.contains(local, 16 * localCount)) || (remoteCount && !p.memory.contains(remote, 16 * remoteCount))) return setErrno(p, EFAULT);
    const locals = iovecs(p, local, localCount), remotes = iovecs(p, remote, remoteCount);
    let moved = 0, li = 0, lo = 0;
    for (const range of remotes) {
      let done = 0;
      while (done < range.length && li < locals.length) {
        const take = Math.min(range.length - done, locals[li].length - lo);
        if (take > 0) {
          const from = write ? locals[li].base + lo : range.base + done, to = write ? range.base + done : locals[li].base + lo;
          if (!p.memory.contains(write ? to : from, take)) return moved ? moved : setErrno(p, EFAULT);   // the remote side is not mapped: a partial transfer stops here
          if (!p.memory.contains(write ? from : to, take)) return moved ? moved : setErrno(p, EFAULT);
          p.memory.copyIn(to, p.memory.bytes(from, take).slice()); moved += take; done += take; lo += take;
        }
        if (lo >= locals[li].length) { li++; lo = 0; }
      }
      if (li >= locals.length) break;
    }
    return moved;
  };
  lib.process_vm_readv = transfer(false); lib.process_vm_writev = transfer(true);
  const shiftDown = c => { for (let i = 0; i < 6; i++) c.x[i] = c.x[i + 1]; };
  const where = (c, address) => Number.isFinite(address) && c.where ? c.where(address) ?? `0x${address.toString(16)}` : null;   // the instruction that made the call, for the report of a call the lab does not provide
  // syscall(number, ...): the arguments move down one register for the call; a call that waits (FUTEX_WAIT) is retried from the registers it was made with, which
  // src/arm64/process.js dispatchHost puts back for every lab function that blocks (shifted, the retry read the futex address as the system call number)
  lib.syscall = (p, c) => { const number = Number(c.x[0]); shiftDown(c); return run(p, c, number, (at => at && `syscall() called from ${at}`)(where(c, Number(c.x[30])))); };
  /** `svc #0`: the kernel convention (X8 number, result or -errno in X0). */
  lib.__svc = (p, c) => {
    const result = run(p, c, Number(c.x[8]), (at => at && `svc #0 at ${at}`)(where(c, c.pc - 4)));
    if (typeof result === 'symbol' || result === undefined || typeof result === 'object') return result;
    const value = BigInt.asIntN(64, BigInt(result));
    if (value === -1n) { const errno = p.memory.readU32(p.errnoAddress) || EINVAL; return BigInt(-errno); }
    return value;
  };
  return lib;
}
