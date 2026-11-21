// The system libraries an app's ARM64 library links against (bionic's libc / libm / libdl, liblog), as host functions of the ARM64 process
// (src/arm64/process.js): each one reads its AAPCS64 arguments from the interpreter's registers and returns its result in X0 (or D0/S0).
// Files go through the VM's file system (the same one Java's FileInputStream uses), logs to the VM log as android.util.Log does, properties to the device's
// SystemProperties. A function this table does not have is bound to an entry that fails naming it when called (process.missingSymbol); pthread_create fails the
// same way, because the lab runs no native threads.
import { APKError } from '../apk-error.js?v=ebd42d0a624c';
import { BLOCKED } from './cpu.js?v=ebd42d0a624c';
import { extendLibc } from './libc-extra.js?v=ebd42d0a624c';
import { utf8 } from './text.js?v=ebd42d0a624c';

const EINVAL = 22, ENOENT = 2, EBADF = 9, ENOMEM = 12, EAGAIN = 11, ENOSYS = 38, ERANGE = 34;
const text = bytes => utf8.decode(bytes);   // memory views: src/arm64/text.js

/** Argument cursor of a variadic call (AAPCS64: GP args continue in X registers then the stack, FP args in V registers then the stack) or of a va_list. */
export function variadic(cpu, fixedGp, fixedFp = 0) {
  let gp = fixedGp, fp = fixedFp, stack = Number(cpu.sp);
  return {
    int() { if (gp < 8) return cpu.x[gp++]; const v = cpu.mem.read64(stack); stack += 8; return v; },
    double() { if (fp < 8) return cpu.getD(fp++); const v = cpu.mem.dv.getFloat64(stack, true); stack += 8; return v; },
  };
}
export function vaList(mem, ptr) {
  let stack = mem.readPtr(ptr); const grTop = mem.readPtr(ptr + 8), vrTop = mem.readPtr(ptr + 16); let grOffs = mem.dv.getInt32(ptr + 24, true), vrOffs = mem.dv.getInt32(ptr + 28, true);
  return {
    int() { if (grOffs < 0) { const v = mem.read64(grTop + grOffs); grOffs += 8; return v; } const v = mem.read64(stack); stack += 8; return v; },
    double() { if (vrOffs < 0) { const v = mem.dv.getFloat64(vrTop + vrOffs, true); vrOffs += 16; return v; } const v = mem.dv.getFloat64(stack, true); stack += 8; return v; },
  };
}
/** printf-family formatting of a C format string with a variadic cursor. */
export function formatC(mem, format, args) {
  let out = '', i = 0;
  while (i < format.length) {
    const ch = format[i++];
    if (ch !== '%') { out += ch; continue; }
    const m = /^([-+ #0]*)(\*|\d+)?(?:\.(\*|\d+))?(hh|h|ll|l|j|z|t|L|q)?([diouxXcspfFeEgGaAn%])/.exec(format.slice(i));
    if (!m) { out += '%'; continue; }
    i += m[0].length;
    const [, flags, widthRaw, precRaw, length, conv] = m;
    const width = widthRaw === '*' ? Number(BigInt.asIntN(32, args.int())) : widthRaw ? Number(widthRaw) : 0, precision = precRaw === '*' ? Number(BigInt.asIntN(32, args.int())) : precRaw !== undefined ? Number(precRaw) : undefined;
    let s;
    const bits = length === 'll' || length === 'l' || length === 'j' || length === 'z' || length === 't' || length === 'q' ? 64 : length === 'h' ? 16 : length === 'hh' ? 8 : 32;
    switch (conv) {
      case '%': s = '%'; break;
      case 'd': case 'i': { const v = BigInt.asIntN(bits, args.int()); s = (v < 0n ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + (v < 0n ? -v : v).toString(); if (precision !== undefined) s = s.replace(/\d+/, d => d.padStart(precision, '0')); break; }
      case 'u': s = BigInt.asUintN(bits, args.int()).toString(); break;
      case 'o': s = (flags.includes('#') ? '0' : '') + BigInt.asUintN(bits, args.int()).toString(8); break;
      case 'x': case 'X': { const v = BigInt.asUintN(bits, args.int()); s = v.toString(16); if (precision !== undefined) s = s.padStart(precision, '0'); if (flags.includes('#') && v !== 0n) s = '0x' + s; if (conv === 'X') s = s.toUpperCase(); break; }
      case 'c': s = String.fromCharCode(Number(args.int() & 0xffn)); break;
      case 's': { const p = Number(args.int()); s = p === 0 ? '(null)' : text(mem.cString(p)); if (precision !== undefined) s = s.slice(0, precision); break; }
      case 'p': s = '0x' + BigInt.asUintN(64, args.int()).toString(16); break;
      case 'f': case 'F': s = args.double().toFixed(precision ?? 6); break;
      case 'e': case 'E': { s = args.double().toExponential(precision ?? 6).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); break; }
      case 'g': case 'G': { const v = args.double(), p = precision === 0 ? 1 : precision ?? 6; s = Number(v.toPrecision(p)).toString(); if (conv === 'G') s = s.toUpperCase(); break; }
      case 'a': case 'A': s = args.double().toString(); break;
      case 'n': args.int(); s = ''; break;
    }
    if (s.length < width) s = flags.includes('-') ? s.padEnd(width) : flags.includes('0') && /[diouxXfFeEgG]/.test(conv) ? s.replace(/^([-+ ]?(?:0x)?)/, p => p).padStart(width, '0') : s.padStart(width);
    out += s;
  }
  return out;
}

export function createLibc({ runtime, properties = () => null, fs = () => null, clock = () => Date.now(), assets = null } = {}) {
  const lib = {};
  const str = (p, ptr) => text(p.memory.cString(Number(ptr)));
  const setErrno = (p, value) => { p.memory.writeU32(p.errnoAddress, value); return -1; };
  const write = (p, ptr, s) => { const bytes = new TextEncoder().encode(s); p.memory.copyIn(Number(ptr), bytes); p.memory.u8[Number(ptr) + bytes.length] = 0; return bytes.length; };
  const bounded = (p, dst, size, s) => { const bytes = new TextEncoder().encode(s), n = Number(size); if (n > 0) { const k = Math.min(bytes.length, n - 1); p.memory.copyIn(Number(dst), bytes.subarray(0, k)); p.memory.u8[Number(dst) + k] = 0; } return bytes.length; };
  const log = (priority, tag, message) => { const letter = 'VVVDIWEFS'[Number(priority)] ?? 'I'; runtime?.record?.(`LOG ${letter} ${tag}: ${message}`); };
  const x = (cpu, i) => cpu.x[i];
  const n = (cpu, i) => Number(cpu.x[i]);
  const s32 = (cpu, i) => Number(BigInt.asIntN(32, cpu.x[i]));
  // ---- memory
  lib.malloc = (p, c) => p.malloc(n(c, 0));
  lib.calloc = (p, c) => { const size = n(c, 0) * n(c, 1), ptr = p.malloc(size); p.memory.fill(ptr, 0, size); return ptr; };
  lib.realloc = (p, c) => { const old = n(c, 0), size = n(c, 1); if (!old) return p.malloc(size); if (!size) { p.free(old); return 0; } const ptr = p.malloc(size), keep = Math.min(p.usableSize(old), size); p.memory.copyIn(ptr, p.memory.bytes(old, keep).slice()); p.free(old); return ptr; };
  lib.free = (p, c) => { p.free(n(c, 0)); };
  lib.malloc_usable_size = (p, c) => p.usableSize(n(c, 0));
  lib.posix_memalign = (p, c) => { const align = n(c, 1), size = n(c, 2); p.memory.writePtr(n(c, 0), align > 16 ? p.mapRegion(size, align) : p.malloc(size)); return 0; };
  lib.memalign = (p, c) => n(c, 0) > 16 ? p.mapRegion(n(c, 1), n(c, 0)) : p.malloc(n(c, 1));
  lib.aligned_alloc = lib.memalign;
  // ---- string.h
  lib.memcpy = lib.memmove = (p, c) => { const d = n(c, 0), s = n(c, 1), len = n(c, 2); if (len) p.memory.copyIn(d, p.memory.bytes(s, len).slice()); return d; };
  lib.__memcpy_chk = lib.memcpy; lib.__memmove_chk = lib.memmove;
  lib.memset = (p, c) => { const d = n(c, 0), len = n(c, 2); if (len) p.memory.fill(d, Number(x(c, 1) & 0xffn), len); return d; };
  lib.__memset_chk = lib.memset;
  lib.memcmp = (p, c) => { const a = p.memory.bytes(n(c, 0), n(c, 2)), b = p.memory.bytes(n(c, 1), n(c, 2)); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  lib.bcmp = lib.memcmp;
  lib.memchr = (p, c) => { const a = n(c, 0), b = p.memory.bytes(a, n(c, 2)), at = b.indexOf(Number(x(c, 1) & 0xffn)); return at < 0 ? 0 : a + at; };
  lib.memrchr = (p, c) => { const a = n(c, 0), b = p.memory.bytes(a, n(c, 2)), at = b.lastIndexOf(Number(x(c, 1) & 0xffn)); return at < 0 ? 0 : a + at; };
  lib.strlen = lib.__strlen_chk = (p, c) => p.memory.cString(n(c, 0)).length;
  lib.strnlen = (p, c) => { const a = n(c, 0), max = n(c, 1); let i = 0; while (i < max && p.memory.u8[a + i]) i++; return i; };
  const cmp = (a, b, max = Infinity, fold = false) => { for (let i = 0; i < max; i++) { let x1 = a[i] ?? 0, y1 = b[i] ?? 0; if (fold) { if (x1 >= 65 && x1 <= 90) x1 += 32; if (y1 >= 65 && y1 <= 90) y1 += 32; } if (x1 !== y1) return x1 - y1; if (!x1) return 0; } return 0; };
  const bytesOf = (p, ptr) => p.memory.cString(Number(ptr));
  lib.strcmp = (p, c) => cmp(bytesOf(p, x(c, 0)), bytesOf(p, x(c, 1)));
  lib.strncmp = (p, c) => cmp(bytesOf(p, x(c, 0)), bytesOf(p, x(c, 1)), n(c, 2));
  lib.strcasecmp = (p, c) => cmp(bytesOf(p, x(c, 0)), bytesOf(p, x(c, 1)), Infinity, true);
  lib.strncasecmp = (p, c) => cmp(bytesOf(p, x(c, 0)), bytesOf(p, x(c, 1)), n(c, 2), true);
  lib.strcpy = lib.__strcpy_chk = (p, c) => { const src = bytesOf(p, x(c, 1)).slice(); p.memory.copyIn(n(c, 0), src); p.memory.u8[n(c, 0) + src.length] = 0; return n(c, 0); };
  lib.stpcpy = (p, c) => { const src = bytesOf(p, x(c, 1)).slice(); p.memory.copyIn(n(c, 0), src); p.memory.u8[n(c, 0) + src.length] = 0; return n(c, 0) + src.length; };
  lib.strncpy = lib.__strncpy_chk = lib.__strncpy_chk2 = (p, c) => { const src = bytesOf(p, x(c, 1)), len = n(c, 2), d = n(c, 0); p.memory.fill(d, 0, len); p.memory.copyIn(d, src.subarray(0, Math.min(src.length, len))); return d; };
  lib.strlcpy = lib.__strlcpy_chk = (p, c) => { const src = bytesOf(p, x(c, 1)), size = n(c, 2), d = n(c, 0); if (size) { const k = Math.min(src.length, size - 1); p.memory.copyIn(d, src.subarray(0, k)); p.memory.u8[d + k] = 0; } return src.length; };
  lib.strcat = lib.__strcat_chk = (p, c) => { const d = n(c, 0), end = d + bytesOf(p, d).length, src = bytesOf(p, x(c, 1)).slice(); p.memory.copyIn(end, src); p.memory.u8[end + src.length] = 0; return d; };
  lib.strncat = lib.__strncat_chk = (p, c) => { const d = n(c, 0), end = d + bytesOf(p, d).length, src = bytesOf(p, x(c, 1)).slice(0, n(c, 2)); p.memory.copyIn(end, src); p.memory.u8[end + src.length] = 0; return d; };
  lib.strlcat = lib.__strlcat_chk = (p, c) => { const d = n(c, 0), size = n(c, 2), dlen = bytesOf(p, d).length, src = bytesOf(p, x(c, 1)); if (dlen < size) { const k = Math.min(src.length, size - dlen - 1); p.memory.copyIn(d + dlen, src.subarray(0, k)); p.memory.u8[d + dlen + k] = 0; } return dlen + src.length; };
  lib.strchr = lib.__strchr_chk = (p, c) => { const a = n(c, 0), b = bytesOf(p, a), ch = Number(x(c, 1) & 0xffn); if (ch === 0) return a + b.length; const at = b.indexOf(ch); return at < 0 ? 0 : a + at; };
  lib.strrchr = lib.__strrchr_chk = (p, c) => { const a = n(c, 0), b = bytesOf(p, a), ch = Number(x(c, 1) & 0xffn); if (ch === 0) return a + b.length; const at = b.lastIndexOf(ch); return at < 0 ? 0 : a + at; };
  lib.strstr = (p, c) => { const a = n(c, 0), hay = str(p, a), needle = str(p, x(c, 1)), at = hay.indexOf(needle); return at < 0 ? 0 : a + new TextEncoder().encode(hay.slice(0, at)).length; };
  lib.strdup = (p, c) => p.allocString(str(p, x(c, 0)));
  lib.strndup = (p, c) => { const b = bytesOf(p, x(c, 0)).slice(0, n(c, 1)), ptr = p.malloc(b.length + 1); p.memory.copyIn(ptr, b); p.memory.u8[ptr + b.length] = 0; return ptr; };
  lib.strspn = (p, c) => { const s = bytesOf(p, x(c, 0)), set = new Set(bytesOf(p, x(c, 1))); let i = 0; while (i < s.length && set.has(s[i])) i++; return i; };
  lib.strcspn = (p, c) => { const s = bytesOf(p, x(c, 0)), set = new Set(bytesOf(p, x(c, 1))); let i = 0; while (i < s.length && !set.has(s[i])) i++; return i; };
  lib.strpbrk = (p, c) => { const a = n(c, 0), s = bytesOf(p, a), set = new Set(bytesOf(p, x(c, 1))); for (let i = 0; i < s.length; i++) if (set.has(s[i])) return a + i; return 0; };
  lib.strerror = (p, c) => p.allocString(`errno ${n(c, 0)}`);
  lib.strerror_r = (p, c) => { bounded(p, x(c, 1), x(c, 2), `errno ${n(c, 0)}`); return 0; };
  const parseInt64 = (p, c, unsigned) => { const s = str(p, x(c, 0)), base = n(c, 2), m = /^\s*([+-]?)(0x|0X)?([0-9a-zA-Z]*)/.exec(s), radix = base || (m[2] ? 16 : m[3].startsWith('0') && m[3].length > 1 ? 8 : 10); let digits = ''; for (const ch of m[3]) { if (parseInt(ch, 36) < radix) digits += ch; else break; } let v = 0n; for (const ch of digits) v = v * BigInt(radix) + BigInt(parseInt(ch, 36)); if (m[1] === '-') v = -v; if (n(c, 1)) p.memory.writePtr(n(c, 1), n(c, 0) + (digits.length ? m[0].length - (m[3].length - digits.length) : 0)); return unsigned ? BigInt.asUintN(64, v) : BigInt.asIntN(64, v); };
  lib.strtol = lib.strtoll = lib.strtoimax = (p, c) => parseInt64(p, c, false);
  lib.strtoul = lib.strtoull = lib.strtoumax = (p, c) => parseInt64(p, c, true);
  lib.atoi = lib.atol = lib.atoll = (p, c) => { const v = parseInt(str(p, x(c, 0)), 10); return BigInt.asUintN(64, BigInt(isNaN(v) ? 0 : v)); };
  lib.strtod = lib.strtof = lib.strtold = (p, c) => { const s = str(p, x(c, 0)), m = /^\s*[+-]?(?:inf(?:inity)?|nan|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/i.exec(s); if (n(c, 1)) p.memory.writePtr(n(c, 1), n(c, 0) + (m ? m[0].length : 0)); const v = m ? parseFloat(m[0].replace(/inf(inity)?/i, 'Infinity')) : 0; return { double: v }; };
  lib.atof = (p, c) => ({ double: parseFloat(str(p, x(c, 0))) || 0 });
  for (const [name, fn] of Object.entries({ isalnum: ch => /[A-Za-z0-9]/.test(ch), isalpha: ch => /[A-Za-z]/.test(ch), isdigit: ch => /[0-9]/.test(ch), isspace: ch => /[ \t\n\v\f\r]/.test(ch), isupper: ch => /[A-Z]/.test(ch), islower: ch => /[a-z]/.test(ch), isxdigit: ch => /[0-9a-fA-F]/.test(ch), isprint: ch => ch >= ' ' && ch <= '~', ispunct: ch => /[!-\/:-@\[-`{-~]/.test(ch) })) lib[name] = (p, c) => fn(String.fromCharCode(n(c, 0) & 0xff)) ? 1 : 0;
  lib.toupper = (p, c) => { const v = n(c, 0); return v >= 97 && v <= 122 ? v - 32 : v; };
  lib.tolower = (p, c) => { const v = n(c, 0); return v >= 65 && v <= 90 ? v + 32 : v; };
  // ---- stdio / log
  lib.snprintf = (p, c) => bounded(p, x(c, 0), x(c, 1), formatC(p.memory, str(p, x(c, 2)), variadic(c, 3)));
  lib.__snprintf_chk = (p, c) => bounded(p, x(c, 0), x(c, 1), formatC(p.memory, str(p, x(c, 4)), variadic(c, 5)));
  lib.sprintf = (p, c) => write(p, x(c, 0), formatC(p.memory, str(p, x(c, 1)), variadic(c, 2)));
  lib.__sprintf_chk = (p, c) => write(p, x(c, 0), formatC(p.memory, str(p, x(c, 3)), variadic(c, 4)));
  lib.vsnprintf = (p, c) => bounded(p, x(c, 0), x(c, 1), formatC(p.memory, str(p, x(c, 2)), vaList(p.memory, n(c, 3))));
  lib.__vsnprintf_chk = (p, c) => bounded(p, x(c, 0), x(c, 1), formatC(p.memory, str(p, x(c, 4)), vaList(p.memory, n(c, 5))));
  lib.vsprintf = (p, c) => write(p, x(c, 0), formatC(p.memory, str(p, x(c, 1)), vaList(p.memory, n(c, 2))));
  lib.vasprintf = (p, c) => { const s = formatC(p.memory, str(p, x(c, 1)), vaList(p.memory, n(c, 2))), ptr = p.allocString(s); p.memory.writePtr(n(c, 0), ptr); return new TextEncoder().encode(s).length; };
  lib.asprintf = (p, c) => { const s = formatC(p.memory, str(p, x(c, 1)), variadic(c, 2)), ptr = p.allocString(s); p.memory.writePtr(n(c, 0), ptr); return new TextEncoder().encode(s).length; };
  lib.printf = (p, c) => { const s = formatC(p.memory, str(p, x(c, 0)), variadic(c, 1)); log(4, 'stdout', s.replace(/\n$/, '')); return s.length; };
  lib.puts = (p, c) => { log(4, 'stdout', str(p, x(c, 0))); return 1; };
  lib.fprintf = (p, c) => { const s = formatC(p.memory, str(p, x(c, 1)), variadic(c, 2)); log(6, 'stderr', s.replace(/\n$/, '')); return s.length; };
  lib.vfprintf = (p, c) => { const s = formatC(p.memory, str(p, x(c, 1)), vaList(p.memory, n(c, 2))); log(6, 'stderr', s.replace(/\n$/, '')); return s.length; };
  lib.fputs = (p, c) => { log(6, 'stderr', str(p, x(c, 0)).replace(/\n$/, '')); return 1; };
  lib.fputc = lib.putc = (p, c) => n(c, 0);
  lib.fflush = () => 0;
  lib.fwrite = (p, c) => { log(6, 'stderr', text(p.memory.bytes(n(c, 0), n(c, 1) * n(c, 2))).replace(/\n$/, '')); return n(c, 2); };
  lib.__android_log_print = (p, c) => { log(n(c, 0), str(p, x(c, 1)), formatC(p.memory, str(p, x(c, 2)), variadic(c, 3))); return 1; };
  lib.__android_log_vprint = (p, c) => { log(n(c, 0), str(p, x(c, 1)), formatC(p.memory, str(p, x(c, 2)), vaList(p.memory, n(c, 3)))); return 1; };
  lib.__android_log_write = (p, c) => { log(n(c, 0), str(p, x(c, 1)), str(p, x(c, 2))); return 1; };
  lib.__android_log_buf_write = (p, c) => { log(n(c, 1), str(p, x(c, 2)), str(p, x(c, 3))); return 1; };
  lib.__android_log_is_loggable = () => 1;
  lib.__android_log_assert = (p, c) => { const message = n(c, 2) ? formatC(p.memory, str(p, x(c, 2)), variadic(c, 3)) : str(p, x(c, 0)); throw new APKError(`ARM64 native code aborted (__android_log_assert): ${message}`, { kind: 'arm64-abort' }); };
  // ---- process
  lib.abort = () => { throw new APKError('ARM64 native code called abort()', { kind: 'arm64-abort' }); };
  lib.__assert2 = (p, c) => { throw new APKError(`ARM64 native assertion failed: ${str(p, x(c, 3))} (${str(p, x(c, 0))}:${n(c, 1)} ${str(p, x(c, 2))})`, { kind: 'arm64-abort' }); };
  lib.__stack_chk_fail = () => { throw new APKError('ARM64 native code: stack corruption detected (__stack_chk_fail)', { kind: 'arm64-abort' }); };
  lib.exit = lib._exit = (p, c) => { throw new APKError(`ARM64 native code called exit(${s32(c, 0)})`, { kind: 'arm64-exit' }); };
  lib.__errno = p => p.errnoAddress;
  lib.__cxa_atexit = (p, c) => { p.atexit.push([n(c, 0), n(c, 1), n(c, 2)]); return 0; };
  lib.atexit = (p, c) => { p.atexit.push([n(c, 0), 0, 0]); return 0; };
  lib.__cxa_finalize = () => {};
  lib.__register_atfork = lib.pthread_atfork = () => 0;
  // AT_HWCAP names what the CPU executes: here the interpreter's own set, fp | asimd | atomics (LSE). Crypto (AES, PMULL, SHA1/2) and CRC32 are not advertised because
  // src/arm64/cpu.js does not execute them; libraries that check (BoringSSL, zlib, codecs) then take their portable paths, as on a core without those extensions.
  lib.getauxval = (p, c) => ({ 16: 0x103n, 26: 0n, 6: 4096n, 23: 0n }[n(c, 0)] ?? 0n);
  lib.sysconf = (p, c) => ({ 39: 4096, 40: 4096, 96: 8, 97: 8, 84: 8, 83: 8, 3: 1024, 0: 2097152, 2: 100 }[n(c, 0)] ?? (setErrno(p, EINVAL)));
  lib.getpagesize = () => 4096;
  lib.getpid = () => runtime?.platform?.virtualProcess?.pid ?? 4321;
  lib.getuid = lib.geteuid = lib.getgid = lib.getegid = () => runtime?.platform?.virtualProcess?.uid ?? 10123;
  lib.getppid = () => 1;
  lib.isatty = () => 0;
  lib.prctl = () => 0;
  lib.getenv = (p, c) => { const name = str(p, x(c, 0)), value = { ANDROID_ROOT: '/system', ANDROID_DATA: '/data', EXTERNAL_STORAGE: '/sdcard', BOOTCLASSPATH: '' }[name]; return value === undefined ? 0 : p.allocString(value); };
  lib.setenv = lib.unsetenv = () => 0;
  lib.__system_property_get = (p, c) => { const value = properties(str(p, x(c, 0))) ?? ''; return bounded(p, x(c, 1), 92, value); };
  // bionic's prop_info records over the same properties: { u32 serial; char value[92]; char name[]; }, one per property name, made on first use
  const propInfos = new Map(), infoNames = new Map();
  const propInfo = (p, name) => { const value = properties(name); if (value === null || value === undefined) return 0; let at = propInfos.get(name); if (!at) { const nameBytes = new TextEncoder().encode(name); at = p.malloc(96 + nameBytes.length + 1); p.memory.fill(at, 0, 96 + nameBytes.length + 1); p.memory.copyIn(at + 96, nameBytes); propInfos.set(name, at); infoNames.set(at, name); } const bytes = new TextEncoder().encode(String(value)).subarray(0, 91); p.memory.fill(at + 4, 0, 92); p.memory.copyIn(at + 4, bytes); return at; };
  const infoName = (p, at) => infoNames.get(at) ?? (() => { throw new APKError(`ARM64 native code used prop_info 0x${at.toString(16)} that __system_property_find did not return`, { kind: 'arm64-properties' }); })();
  lib.__system_property_find = (p, c) => propInfo(p, str(p, x(c, 0)));
  lib.__system_property_read = (p, c) => { const at = n(c, 0), name = infoName(p, at), value = properties(name) ?? ''; if (n(c, 1)) bounded(p, x(c, 1), 32, name); return bounded(p, x(c, 2), 92, value); };   // name buffer is PROP_NAME_MAX (32), value PROP_VALUE_MAX (92)
  lib.__system_property_read_callback = (p, c) => { const at = n(c, 0), callback = n(c, 1), cookie = n(c, 2), name = infoName(p, at), value = properties(name) ?? '', np = p.allocString(name), vp = p.allocString(value); try { p.call(callback, [cookie, np, vp, p.memory.readU32(at)]); } finally { p.free(np); p.free(vp); } };
  lib.__system_property_foreach = (p, c) => { const callback = n(c, 0), cookie = n(c, 1); for (const name of properties.names?.() ?? []) { const at = propInfo(p, name); if (at) p.call(callback, [at, cookie]); } return 0; };   // arguments read once: each callback clobbers the argument registers
  lib.__system_property_find_nth = (p, c) => { const name = (properties.names?.() ?? [])[n(c, 0)]; return name === undefined ? 0 : propInfo(p, name); };
  lib.__system_property_serial = (p, c) => p.memory.readU32(n(c, 0));
  // ---- time
  lib.time = (p, c) => { const t = Math.floor(clock() / 1000); if (n(c, 0)) p.memory.write64(n(c, 0), BigInt(t)); return t; };
  lib.gettimeofday = (p, c) => { const ms = clock(); if (n(c, 0)) { p.memory.write64(n(c, 0), BigInt(Math.floor(ms / 1000))); p.memory.write64(n(c, 0) + 8, BigInt(Math.floor((ms % 1000) * 1000))); } return 0; };
  lib.clock_gettime = (p, c) => { const id = n(c, 0), ms = id === 0 ? clock() : performance.now(), ptr = n(c, 1); p.memory.write64(ptr, BigInt(Math.floor(ms / 1000))); p.memory.write64(ptr + 8, BigInt(Math.floor((ms % 1000) * 1e6))); return 0; };
  lib.clock = () => BigInt(Math.floor(performance.now() * 1000));
  // ---- threads (src/arm64/threads.js): pthread_create runs the start routine as a native thread; locks, conditions, joins and futexes wait for real
  const T = p => p.threads, BLOCK = r => r; let nextKey = 1;
  lib.pthread_create = (p, c) => { const tid = T(p).create(n(c, 2), n(c, 3)); p.memory.write64(n(c, 0), BigInt(tid)); return 0; };
  lib.pthread_join = (p, c) => BLOCK(T(p).join(c, n(c, 0), n(c, 1)));
  lib.pthread_detach = () => 0;
  // pthread_cleanup_push / pop (bionic's __pthread_cleanup_t { prev; routine; arg; } on the caller's stack, a per-thread chain): pop runs the routine when asked, pthread_exit runs every pushed routine
  lib.__pthread_cleanup_push = (p, c) => { const t = T(p).current, record = n(c, 0); p.memory.writePtr(record, t.cleanup ?? 0); p.memory.writePtr(record + 8, n(c, 1)); p.memory.writePtr(record + 16, n(c, 2)); t.cleanup = record; };
  lib.__pthread_cleanup_pop = (p, c) => { const t = T(p).current, record = n(c, 0), execute = s32(c, 1); t.cleanup = p.memory.readPtr(record) || 0; if (execute) p.call(p.memory.readPtr(record + 8), [p.memory.readPtr(record + 16)]); };
  lib.pthread_exit = (p, c) => { const t = T(p).current, value = x(c, 0); if (t.main) throw new APKError('ARM64 native code called pthread_exit on the thread that runs Java', { kind: 'arm64-threads' }); while (t.cleanup) { const record = t.cleanup; t.cleanup = p.memory.readPtr(record) || 0; p.call(p.memory.readPtr(record + 8), [p.memory.readPtr(record + 16)]); } T(p).finish(t, value); c.exited = true; };
  lib.pthread_self = p => T(p).current.tid;
  lib.gettid = p => T(p).current.tid;
  lib.pthread_equal = (p, c) => x(c, 0) === x(c, 1) ? 1 : 0;
  lib.pthread_mutex_init = (p, c) => { const m = n(c, 0), type = n(c, 1) ? p.memory.readU32(n(c, 1)) & 3 : 0; p.memory.writeU32(m, type << 14); p.memory.writeU32(m + 4, 0); p.memory.writeU32(m + 8, 0); return 0; };
  lib.pthread_mutex_destroy = () => 0;
  lib.pthread_mutex_lock = (p, c) => BLOCK(T(p).mutexLock(c, n(c, 0)));
  lib.pthread_mutex_trylock = (p, c) => T(p).mutexTrylock(n(c, 0));
  lib.pthread_mutex_unlock = (p, c) => T(p).mutexUnlock(n(c, 0));
  lib.pthread_mutexattr_init = (p, c) => { p.memory.writeU32(n(c, 0), 0); return 0; };
  lib.pthread_mutexattr_settype = (p, c) => { p.memory.writeU32(n(c, 0), n(c, 1) & 3); return 0; };
  lib.pthread_mutexattr_gettype = (p, c) => { p.memory.writeU32(n(c, 1), p.memory.readU32(n(c, 0)) & 3); return 0; };
  lib.pthread_mutexattr_destroy = () => 0;
  lib.pthread_cond_init = (p, c) => { p.memory.writeU32(n(c, 0), 0); return 0; };
  lib.pthread_cond_destroy = () => 0;
  lib.pthread_cond_wait = (p, c) => BLOCK(T(p).condWait(c, n(c, 0), n(c, 1)));
  const absDeadline = (p, ptr) => T(p).now() + (Number(p.memory.read64(ptr)) * 1000 + Number(p.memory.read64(ptr + 8)) / 1e6 - clock());
  lib.pthread_cond_timedwait = (p, c) => BLOCK(T(p).condWait(c, n(c, 0), n(c, 1), absDeadline(p, n(c, 2))));
  lib.pthread_cond_timedwait_monotonic_np = lib.pthread_cond_timedwait_relative_np = (p, c) => BLOCK(T(p).condWait(c, n(c, 0), n(c, 1), T(p).now() + Number(p.memory.read64(n(c, 2))) * 1000 + Number(p.memory.read64(n(c, 2) + 8)) / 1e6));
  lib.pthread_cond_signal = lib.pthread_cond_broadcast = (p, c) => T(p).condSignal(n(c, 0));
  lib.pthread_rwlock_rdlock = lib.pthread_rwlock_wrlock = (p, c) => BLOCK(T(p).mutexLock(c, n(c, 0)));
  lib.pthread_rwlock_tryrdlock = lib.pthread_rwlock_trywrlock = (p, c) => T(p).mutexTrylock(n(c, 0));
  lib.pthread_rwlock_unlock = (p, c) => T(p).mutexUnlock(n(c, 0));
  for (const name of ['pthread_rwlock_init', 'pthread_rwlock_destroy', 'pthread_attr_init', 'pthread_attr_destroy', 'pthread_attr_setstacksize', 'pthread_attr_setdetachstate', 'pthread_attr_getstacksize', 'pthread_attr_setschedparam', 'pthread_attr_setschedpolicy', 'pthread_setname_np', 'pthread_getname_np', 'pthread_condattr_init', 'pthread_condattr_setclock', 'pthread_condattr_destroy', 'pthread_setschedparam', 'pthread_sigmask', 'sigaction', 'sigemptyset', 'sigaddset', 'sigfillset', 'sigprocmask', 'setpriority']) lib[name] = () => 0;
  lib.pthread_kill = () => 0;
  const sleepFor = (p, c, ms) => { if (!T(p).canSuspend(c)) return 0; const t = T(p).current; if (t.sleepUntil === undefined) t.sleepUntil = T(p).now() + ms; const deadline = t.sleepUntil, r = T(p).wait(c, () => T(p).now() >= deadline, { what: 'sleep', deadline }); if (r === BLOCKED) return BLOCKED; t.sleepUntil = undefined; return 0; };
  lib.nanosleep = (p, c) => { const ptr = n(c, 0), r = sleepFor(p, c, Number(p.memory.read64(ptr)) * 1000 + Number(p.memory.read64(ptr + 8)) / 1e6); return r; };
  lib.usleep = (p, c) => sleepFor(p, c, n(c, 0) / 1000);
  lib.sleep = (p, c) => sleepFor(p, c, n(c, 0) * 1000);
  lib.sched_yield = (p, c) => { if (!T(p).canSuspend(c)) return 0; const t = T(p).current; if (t.yielded) { t.yielded = false; return 0; } t.yielded = true; t.state = 'waiting'; t.ready = () => true; t.deadline = Infinity; return BLOCKED; };
  lib.pthread_once = (p, c) => { const control = n(c, 0); if (p.memory.readU32(control) === 0) { p.memory.writeU32(control, 1); p.call(n(c, 1), []); p.memory.writeU32(control, 2); } return 0; };
  lib.pthread_key_create = (p, c) => { const key = nextKey++; p.memory.writeU32(n(c, 0), key); return 0; };
  lib.pthread_key_delete = () => 0;
  lib.pthread_getspecific = (p, c) => T(p).current.keys.get(n(c, 0)) ?? 0;
  lib.pthread_setspecific = (p, c) => { T(p).current.keys.set(n(c, 0), n(c, 1)); return 0; };
  lib.pthread_getattr_np = () => 0; lib.pthread_attr_getstack = (p, c) => { p.memory.writePtr(n(c, 1), Number(c.sp) - 0x70000); p.memory.write64(n(c, 2), 0x80000n); return 0; };
  // ---- dlfcn
  lib.dlopen = (p, c) => { const name = n(c, 0) ? str(p, x(c, 0)) : null; if (!name) return 0x7e0000000001; try { const soname = name.slice(name.lastIndexOf('/') + 1); const handle = p.load(soname); return p.order.indexOf(handle) + 0x7e0000000100; } catch (error) { p.dlerror = error.message; return 0; } };
  lib.dlsym = (p, c) => { const handle = n(c, 0), name = str(p, x(c, 1)), lib0 = handle >= 0x7e0000000100 ? p.order[handle - 0x7e0000000100] : null; const address = lib0 ? lib0.exports.get(name) : p.resolve(name, null); if (address === undefined || address === null) { p.dlerror = `undefined symbol: ${name}`; return 0; } return address; };
  lib.dlclose = () => 0;
  lib.dlerror = p => { const message = p.dlerror; p.dlerror = null; return message ? p.allocString(message) : 0; };
  lib.dladdr = (p, c) => { const lib0 = p.libraryAt(n(c, 0)); if (!lib0) return 0; const info = n(c, 1); p.memory.writePtr(info, p.allocString(lib0.name)); p.memory.writePtr(info + 8, lib0.base); p.memory.writePtr(info + 16, 0); p.memory.writePtr(info + 24, 0); return 1; };
  lib.dl_iterate_phdr = (p, c) => {   // dl_phdr_info: addr, name, phdr, phnum (the C++ unwinder finds .eh_frame_hdr this way)
    const callback = n(c, 0), data = n(c, 1);
    for (const lib0 of p.order) {
      const info = p.malloc(64), phdrs = p.malloc(lib0.elf.segments.length * 56);
      lib0.elf.segments.forEach((s, i) => { const o = phdrs + 56 * i; p.memory.writeU32(o, s.type); p.memory.writeU32(o + 4, s.flags); p.memory.write64(o + 8, BigInt(s.offset)); p.memory.write64(o + 16, BigInt(s.vaddr)); p.memory.write64(o + 24, BigInt(s.vaddr)); p.memory.write64(o + 32, BigInt(s.filesz)); p.memory.write64(o + 40, BigInt(s.memsz)); p.memory.write64(o + 48, BigInt(s.align)); });
      p.memory.writePtr(info, lib0.base); p.memory.writePtr(info + 8, p.allocString(lib0.name)); p.memory.writePtr(info + 16, phdrs); p.memory.dv.setUint16(info + 24, lib0.elf.segments.length, true);
      const result = Number(BigInt.asIntN(32, p.call(callback, [info, 64, data])));
      if (result !== 0) return result;
    }
    return 0;
  };
  // ---- files over the VM's file system
  const fds = new Map(); let nextFd = 100;
  lib.__ownsFd = fd => fds.has(fd);   // the process's descriptors, for Java code handed one (src/arm64/glue.js)
  const vfs = () => fs() ?? (() => { throw new APKError('ARM64 native code opened a file but the VM file system is not available here', { kind: 'arm64-files' }); })();
  // the character devices a process reads directly: random bytes, the null and zero devices
  const randomBytes = length => { const bytes = new Uint8Array(length); for (let i = 0; i < length; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(length, i + 65536))); return bytes; };
  const DEVICES = { '/dev/urandom': randomBytes, '/dev/random': randomBytes, '/dev/zero': length => new Uint8Array(length), '/dev/null': () => new Uint8Array(0) };
  const deviceOf = path => DEVICES[path] ? { device: path, read: DEVICES[path] } : null;
  lib.open = lib.__open_2 = lib.open64 = (p, c) => { const path = str(p, x(c, 0)), flags = n(c, 1); { const dev = deviceOf(path); if (dev) { const fd = nextFd++; fds.set(fd, { ...dev, path, offset: 0 }); return fd; } } const files = vfs(); const exists = files.stat(path)?.type === 'file'; if (!exists && !(flags & 0o100)) return setErrno(p, ENOENT); if (!exists) files.setBytes(path, new Uint8Array(0)); if (flags & 0o1000) files.setBytes(path, new Uint8Array(0)); const fd = nextFd++; fds.set(fd, { path, offset: 0, append: !!(flags & 0o2000) }); return fd; };
  lib.openat = (p, c) => { c.x[0] = c.x[1]; c.x[1] = c.x[2]; c.x[2] = c.x[3]; return lib.open(p, c); };
  lib.close = (p, c) => { if (!fds.delete(n(c, 0))) return setErrno(p, EBADF); return 0; };
  const fileBytes = path => vfs().bytes(path) ?? new Uint8Array(0);
  // a MAP_SHARED mapping and the file are one: a write to the file shows in every live mapping of it, and msync / munmap write a writable mapping back
  const store = (p, path, data) => { vfs().setBytes(path, data); for (const m of p.sharedMappings ?? []) if (m.path === path) p.memory.copyIn(m.at, data.subarray(m.offset, m.offset + m.length).length === m.length ? data.subarray(m.offset, m.offset + m.length) : (() => { const b = new Uint8Array(m.length); b.set(data.subarray(m.offset, m.offset + m.length)); return b; })()); };
  const writeBack = (p, at, length) => { for (const m of p.sharedMappings ?? []) if (m.writable && at < m.at + m.length && at + length > m.at) { const data = fileBytes(m.path), next = new Uint8Array(Math.max(data.length, m.offset + m.length)); next.set(data); next.set(p.memory.bytes(m.at, m.length), m.offset); vfs().setBytes(m.path, next); } };
  lib.read = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); if (f.device) { const chunk = f.read(n(c, 2)); p.memory.copyIn(n(c, 1), chunk); return chunk.length; } const data = fileBytes(f.path), chunk = data.subarray(f.offset, f.offset + n(c, 2)); p.memory.copyIn(n(c, 1), chunk); f.offset += chunk.length; return chunk.length; };
  lib.pread = lib.pread64 = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); const data = fileBytes(f.path), at = n(c, 3), chunk = data.subarray(at, at + n(c, 2)); p.memory.copyIn(n(c, 1), chunk); return chunk.length; };
  lib.write = (p, c) => { const fd = n(c, 0), bytes = p.memory.bytes(n(c, 1), n(c, 2)).slice(); if (fd === 1 || fd === 2) { log(fd === 1 ? 4 : 6, fd === 1 ? 'stdout' : 'stderr', text(bytes).replace(/\n$/, '')); return bytes.length; } const f = fds.get(fd); if (!f) return setErrno(p, EBADF); if (f.device) return bytes.length; const data = fileBytes(f.path), at = f.append ? data.length : f.offset, next = new Uint8Array(Math.max(data.length, at + bytes.length)); next.set(data); next.set(bytes, at); store(p, f.path, next); f.offset = at + bytes.length; return bytes.length; };
  lib.pwrite = lib.pwrite64 = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); const bytes = p.memory.bytes(n(c, 1), n(c, 2)).slice(), at = n(c, 3), data = fileBytes(f.path), next = new Uint8Array(Math.max(data.length, at + bytes.length)); next.set(data); next.set(bytes, at); store(p, f.path, next); return bytes.length; };
  lib.lseek = lib.lseek64 = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); const whence = n(c, 2), off = Number(BigInt.asIntN(64, x(c, 1))); f.offset = whence === 0 ? off : whence === 1 ? f.offset + off : fileBytes(f.path).length + off; return f.offset; };
  lib.ftruncate = lib.ftruncate64 = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); const size = n(c, 1), data = fileBytes(f.path), next = new Uint8Array(size); next.set(data.subarray(0, size)); store(p, f.path, next); return 0; };
  const statInto = (p, path, out) => { if (deviceOf(path)) { p.memory.fill(out, 0, 128); p.memory.writeU32(out + 16, 0o20666); return 0; } const st = vfs().stat(path); if (!st) return setErrno(p, ENOENT); p.memory.fill(out, 0, 128); p.memory.writeU32(out + 16, st.type === 'dir' ? 0o40755 : 0o100644); p.memory.write64(out + 48, BigInt(st.type === 'file' ? fileBytes(path).length : 4096)); return 0; };
  lib.stat = lib.stat64 = lib.lstat = (p, c) => statInto(p, str(p, x(c, 0)), n(c, 1));
  lib.fstat = lib.fstat64 = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); if (f.device) { const out = n(c, 1); p.memory.fill(out, 0, 128); p.memory.writeU32(out + 16, 0o20666); return 0; } return statInto(p, f.path, n(c, 1)); };
  lib.access = (p, c) => deviceOf(str(p, x(c, 0))) || vfs().stat(str(p, x(c, 0))) ? 0 : setErrno(p, ENOENT);
  lib.unlink = lib.remove = (p, c) => { const path = str(p, x(c, 0)); if (!vfs().stat(path)) return setErrno(p, ENOENT); vfs().delete(path); return 0; };
  lib.mkdir = (p, c) => { vfs().mkdirs?.(str(p, x(c, 0))); return 0; };
  lib.fsync = lib.fdatasync = () => 0;
  lib.fcntl = () => 0; lib.flock = () => 0; lib.ioctl = (p) => setErrno(p, ENOSYS);
  // mmap: anonymous regions come from the address space; a file mapping copies the file (MAP_PRIVATE semantics; writes are not reflected back)
  lib.mmap = lib.mmap64 = (p, c) => { const length = n(c, 1), flags = n(c, 3), fd = s32(c, 4), offset = n(c, 5); if (length >= 64 * 1048576) runtime?.record?.(`ARM64 mmap of ${Math.round(length / 1048576)} MiB (prot ${n(c, 2)}, flags 0x${flags.toString(16)}) from ${c.where?.(Number(c.x[30])) ?? 'native code'}: reserved in the process address space (pages are backed only when touched)`); const at = p.mapRegion(length, 0x1000); if (!(flags & 0x20) && fd >= 0) { const f = fds.get(fd); if (!f) return setErrno(p, EBADF); const data = fileBytes(f.path).subarray(offset, offset + length); p.memory.copyIn(at, data); if (flags & 1) p.sharedMappings = [...(p.sharedMappings ?? []), { at, length, path: f.path, offset, writable: !!(n(c, 2) & 2) }]; } return at; };
  lib.msync = (p, c) => { writeBack(p, n(c, 0), n(c, 1)); return 0; };
  lib.munmap = (p, c) => { const at = n(c, 0), length = n(c, 1); writeBack(p, at, length); p.sharedMappings = (p.sharedMappings ?? []).filter(m => !(m.at >= at && m.at < at + length)); return 0; };
  lib.mprotect = lib.madvise = () => 0;
  // ---- C++ ABI helpers that bionic exports
  lib.__cxa_thread_atexit_impl = () => 0;
  lib.android_set_abort_message = (p, c) => { runtime?.record?.(`LOG F libc: abort message: ${str(p, x(c, 0))}`); };
  lib.android_get_device_api_level = () => 33;
  // ---- libm (double args in D0, D1; float variants in S0)
  const m1 = f => (p, c) => ({ double: f(c.getD(0)) }), m2 = f => (p, c) => ({ double: f(c.getD(0), c.getD(1)) });
  const f1 = f => (p, c) => ({ float: f(c.getS(0)) }), f2 = f => (p, c) => ({ float: f(c.getS(0), c.getS(1)) });
  for (const [name, fn] of Object.entries({ sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, expm1: Math.expm1, log: Math.log, log2: Math.log2, log10: Math.log10, log1p: Math.log1p, sqrt: Math.sqrt, cbrt: Math.cbrt, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, round: v => v < 0 ? -Math.round(-v) : Math.round(v), fabs: Math.abs, exp2: v => 2 ** v })) { lib[name] = m1(fn); lib[name + 'f'] = f1(fn); }
  for (const [name, fn] of Object.entries({ pow: Math.pow, atan2: Math.atan2, fmod: (a, b) => a % b, hypot: Math.hypot, fmin: Math.min, fmax: Math.max, copysign: (a, b) => Math.sign(b) === -1 || Object.is(b, -0) ? -Math.abs(a) : Math.abs(a) })) { lib[name] = m2(fn); lib[name + 'f'] = f2(fn); }
  lib.lround = lib.llround = (p, c) => BigInt.asUintN(64, BigInt(Math.round(c.getD(0))));
  lib.lroundf = (p, c) => BigInt.asUintN(64, BigInt(Math.round(c.getS(0))));
  lib.pthread_mutexattr_setpshared = lib.pthread_mutexattr_getpshared = lib.pthread_condattr_setpshared = lib.pthread_mutexattr_setprotocol = () => 0;
  // ---- FILE streams: fopen'ed files over the VM file system, funopen'ed streams over the caller's callbacks, and stdin/stdout/stderr (bionic's __sF)
  const streams = new Map();
  const stream = (p, ptr) => streams.get(Number(ptr)) ?? (() => { throw new APKError(`ARM64 native code used FILE* 0x${Number(ptr).toString(16)} that fopen/funopen did not return`, { kind: 'arm64-files' }); })();
  const newStream = (p, record) => { const ptr = p.malloc(152); streams.set(ptr, { eof: false, error: false, ...record }); return ptr; };
  lib.fopen = lib.fopen64 = (p, c) => { const path = str(p, x(c, 0)), mode = str(p, x(c, 1)); { const dev = deviceOf(path); if (dev) return newStream(p, { ...dev, offset: 0 }); } const files = vfs(), exists = files.stat(path)?.type === 'file'; if (!exists && mode.startsWith('r')) return setErrno(p, ENOENT) && 0; if (mode.startsWith('w') || !exists) files.setBytes(path, new Uint8Array(0)); return newStream(p, { path, offset: mode.startsWith('a') ? fileBytes(path).length : 0, append: mode.startsWith('a') }); };
  lib.fdopen = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF) && 0; return newStream(p, f.device ? { device: f.device, read: f.read, offset: 0 } : { path: f.path, offset: f.offset }); };
  lib.funopen = (p, c) => newStream(p, { cookie: n(c, 0), readfn: n(c, 1), writefn: n(c, 2), seekfn: n(c, 3), closefn: n(c, 4), offset: 0 });
  const streamRead = (p, s, dst, length) => {
    if (s.readfn) { let done = 0; while (done < length) { const got = Number(BigInt.asIntN(32, p.call(s.readfn, [s.cookie, dst + done, length - done]))); if (got <= 0) { if (got === 0) s.eof = true; else s.error = true; break; } done += got; } return done; }
    if (s.device) { const chunk = s.read(length); p.memory.copyIn(dst, chunk); if (chunk.length < length) s.eof = true; return chunk.length; }
    if (s.path === undefined) { s.eof = true; return 0; }
    const data = fileBytes(s.path), chunk = data.subarray(s.offset, s.offset + length); p.memory.copyIn(dst, chunk); s.offset += chunk.length; if (chunk.length < length) s.eof = true; return chunk.length;
  };
  const streamWrite = (p, s, src, length) => {
    if (s.writefn) return Number(BigInt.asIntN(32, p.call(s.writefn, [s.cookie, src, length])));
    if (s.device) return length;
    if (s.log) { log(s.log === 1 ? 4 : 6, s.log === 1 ? 'stdout' : 'stderr', text(p.memory.bytes(src, length)).replace(/\n$/, '')); return length; }
    const bytes = p.memory.bytes(src, length).slice(), data = fileBytes(s.path), at = s.append ? data.length : s.offset, next = new Uint8Array(Math.max(data.length, at + length)); next.set(data); next.set(bytes, at); store(p, s.path, next); s.offset = at + length; return length;
  };
  lib.fread = (p, c) => { const size = n(c, 1), count = n(c, 2); if (!size || !count) return 0; return Math.floor(streamRead(p, stream(p, x(c, 3)), n(c, 0), size * count) / size); };
  lib.fwrite = (p, c) => { const size = n(c, 1), count = n(c, 2); if (!size || !count) return 0; return Math.floor(streamWrite(p, stream(p, x(c, 3)), n(c, 0), size * count) / size); };
  lib.fgets = (p, c) => { const dst = n(c, 0), max = s32(c, 1), s = stream(p, x(c, 2)); let i = 0; while (i < max - 1) { const tmp = p.malloc(1), got = streamRead(p, s, tmp, 1), ch = p.memory.u8[tmp]; p.free(tmp); if (!got) break; p.memory.u8[dst + i++] = ch; if (ch === 10) break; } if (!i) return 0; p.memory.u8[dst + i] = 0; return dst; };
  lib.fgetc = lib.getc = (p, c) => { const tmp = p.malloc(1), got = streamRead(p, stream(p, x(c, 0)), tmp, 1), ch = p.memory.u8[tmp]; p.free(tmp); return got ? ch : 0xffffffffffffffffn; };
  lib.fputs = (p, c) => { const bytes = bytesOf(p, x(c, 0)), ptr = p.malloc(bytes.length + 1); p.memory.copyIn(ptr, bytes); streamWrite(p, stream(p, x(c, 1)), ptr, bytes.length); p.free(ptr); return 1; };
  lib.fputc = lib.putc = (p, c) => { const ptr = p.malloc(1); p.memory.u8[ptr] = n(c, 0) & 0xff; streamWrite(p, stream(p, x(c, 1)), ptr, 1); p.free(ptr); return n(c, 0) & 0xff; };
  lib.fseek = lib.fseeko = lib.fseeko64 = (p, c) => { const s = stream(p, x(c, 0)), off = Number(BigInt.asIntN(64, x(c, 1))), whence = n(c, 2); if (s.seekfn) { const r = Number(BigInt.asIntN(64, p.call(s.seekfn, [s.cookie, BigInt.asUintN(64, BigInt(off)), whence]))); if (r < 0) return -1; s.offset = r; s.eof = false; return 0; } if (s.path === undefined) return setErrno(p, 29); s.offset = whence === 0 ? off : whence === 1 ? s.offset + off : fileBytes(s.path).length + off; s.eof = false; return 0; };
  lib.ftell = lib.ftello = lib.ftello64 = (p, c) => stream(p, x(c, 0)).offset;
  lib.rewind = (p, c) => { const s = stream(p, x(c, 0)); s.offset = 0; s.eof = false; };
  lib.feof = (p, c) => stream(p, x(c, 0)).eof ? 1 : 0;
  lib.ferror = (p, c) => stream(p, x(c, 0)).error ? 1 : 0;
  lib.clearerr = (p, c) => { const s = stream(p, x(c, 0)); s.eof = false; s.error = false; };
  lib.fileno = (p, c) => { const s = stream(p, x(c, 0)); if (s.log) return s.log; const fd = nextFd++; fds.set(fd, { path: s.path, offset: s.offset }); return fd; };
  lib.fclose = (p, c) => { const ptr = n(c, 0), s = stream(p, ptr); let r = 0; if (s.closefn) r = Number(BigInt.asIntN(32, p.call(s.closefn, [s.cookie]))); streams.delete(ptr); p.free(ptr); return r; };
  lib.fflush = () => 0; lib.setvbuf = lib.setbuf = () => 0;
  lib.fprintf = (p, c) => { const s = formatC(p.memory, str(p, x(c, 1)), variadic(c, 2)), ptr = p.allocString(s); streamWrite(p, stream(p, x(c, 0)), ptr, new TextEncoder().encode(s).length); p.free(ptr); return s.length; };
  lib.vfprintf = (p, c) => { const s = formatC(p.memory, str(p, x(c, 1)), vaList(p.memory, n(c, 2))), ptr = p.allocString(s); streamWrite(p, stream(p, x(c, 0)), ptr, new TextEncoder().encode(s).length); p.free(ptr); return s.length; };
  // syscall(2) and raw svc #0: src/arm64/syscalls.js
  lib.getrandom = (p, c) => { const ptr = n(c, 0), length = n(c, 1), bytes = new Uint8Array(length); for (let i = 0; i < length; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(length, i + 65536))); p.memory.copyIn(ptr, bytes); return length; };
  lib.arc4random = () => BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
  lib.arc4random_buf = (p, c) => { const length = n(c, 1), bytes = new Uint8Array(length); crypto.getRandomValues(bytes.subarray(0, Math.min(length, 65536))); p.memory.copyIn(n(c, 0), bytes); };
  lib.arc4random_uniform = (p, c) => BigInt(crypto.getRandomValues(new Uint32Array(1))[0] % Math.max(1, n(c, 0)));
  // data the library reads directly (bionic exports): stdin/stdout/stderr (__sF), the stack guard, environ
  lib.__data = {
    __sF: p => { const base = p.malloc(152 * 3); [0, 1, 2].forEach(i => streams.set(base + 152 * i, { log: i, eof: false, error: false })); return base; },
    __stack_chk_guard: p => { const ptr = p.malloc(8); p.memory.write64(ptr, p.memory.read64(p.tp + 40)); return ptr; },
    environ: p => { const ptr = p.malloc(16); p.memory.write64(ptr, 0n); const holder = p.malloc(8); p.memory.writePtr(holder, ptr); return holder; },
    __progname: p => { const holder = p.malloc(8); p.memory.writePtr(holder, p.allocString('app_process64')); return holder; },
  };
  lib.__errno_location = lib.__errno;
  void ENOMEM; void EAGAIN; void ERANGE;
  return extendLibc(lib, { runtime, fs, clock, assets });
}
