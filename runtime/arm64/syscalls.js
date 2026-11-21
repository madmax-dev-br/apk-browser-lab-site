// Raw Linux system calls of the ARM64 native process (docs/ARM64-NATIVE.md "System calls"). Some libraries enter the kernel themselves (an `svc #0` with the
// number in X8 and the arguments in X0-X5, or bionic's syscall(3)) instead of calling libc. Both reach the same lab implementations as the libc functions: the
// arm64 (asm-generic) numbers below map to the libc function whose arguments the call has in the same order. A raw call returns -errno, as the kernel does;
// syscall(3) returns -1 and sets errno, as bionic does. A number the lab does not provide fails naming it, never a silent 0.
import { APKError } from '../apk-error.js?v=ea49b2bd6e79';

// number -> libc function taking the same arguments in the same registers
const SAME = {
  17: 'getcwd', 23: 'dup', 24: 'dup3', 25: 'fcntl', 29: 'ioctl', 34: 'mkdirat', 35: 'unlinkat', 48: 'faccessat', 56: 'openat', 57: 'close', 62: 'lseek',
  63: 'read', 64: 'write', 65: 'readv', 66: 'writev', 67: 'pread64', 68: 'pwrite64', 79: 'fstatat', 80: 'fstat', 82: 'fsync', 83: 'fdatasync', 101: 'nanosleep',
  113: 'clock_gettime', 114: 'clock_getres', 124: 'sched_yield', 129: 'kill', 130: 'tkill', 131: 'tgkill', 132: 'sigaltstack', 160: 'uname', 167: 'prctl', 169: 'gettimeofday',
  172: 'getpid', 173: 'getppid', 174: 'getuid', 175: 'geteuid', 176: 'getgid', 177: 'getegid', 179: 'sysinfo', 215: 'munmap', 216: 'mremap', 222: 'mmap',
  226: 'mprotect', 233: 'madvise', 261: 'prlimit64', 278: 'getrandom', 279: 'memfd_create', 93: '_exit', 94: '_exit',
};
const NAMES = { 78: 'readlinkat', 96: 'set_tid_address', 98: 'futex', 134: 'rt_sigaction', 135: 'rt_sigprocmask', 178: 'gettid', 220: 'clone', 221: 'execve', 260: 'wait4', 435: 'clone3' };
const EINVAL = 22;

export function addSyscalls(lib) {
  /** Runs system call `number` with its arguments already in X0-X5; returns the libc-convention result (-1 and errno on failure). */
  const run = (p, c, number) => {
    switch (number) {
      case 78: c.x[0] = c.x[1]; c.x[1] = c.x[2]; c.x[2] = c.x[3]; return lib.readlink(p, c);   // readlinkat(dirfd, path, buf, size)
      case 96: case 178: return p.threads ? p.threads.current.tid : lib.getpid(p, c);          // set_tid_address / gettid
      case 98: return p.futex(c, Number(c.x[0]), Number(c.x[1]) & 0x7f, Number(BigInt.asIntN(32, c.x[2])), Number(c.x[3]));
      case 134: return 0;   // rt_sigaction: the kernel's struct (handler, flags, restorer, mask) is not bionic's; the libc sigaction keeps the dispositions (src/arm64/signals.js)
      case 135: return lib.sigprocmask(p, c);   // rt_sigprocmask(how, set, old, sigsetsize): the 64-bit set is bionic's sigset_t
    }
    const name = SAME[number], fn = name && (lib[name] ?? lib[name.replace(/64$/, '')]);
    if (typeof fn === 'function') return fn(p, c);
    throw new APKError(`ARM64 native code made system call ${number}${NAMES[number] ? ` (${NAMES[number]})` : ''}: not provided by the lab`, { kind: 'arm64-syscall', syscall: number });
  };
  const shiftDown = c => { for (let i = 0; i < 6; i++) c.x[i] = c.x[i + 1]; };
  lib.syscall = (p, c) => { const number = Number(c.x[0]); shiftDown(c); return run(p, c, number); };
  /** `svc #0`: the kernel convention (X8 number, result or -errno in X0). */
  lib.__svc = (p, c) => {
    const result = run(p, c, Number(c.x[8]));
    if (typeof result === 'symbol' || result === undefined || typeof result === 'object') return result;
    const value = BigInt.asIntN(64, BigInt(result));
    if (value === -1n) { const errno = p.memory.readU32(p.errnoAddress) || EINVAL; return BigInt(-errno); }
    return value;
  };
  return lib;
}
