// The system libraries an app's ARM64 library links against (bionic's libc / libm / libdl, liblog), as host functions of the ARM64 process
// (src/arm64/process.js): each one reads its AAPCS64 arguments from the interpreter's registers and returns its result in X0 (or D0/S0).
// Files go through the VM's file system (the same one Java's FileInputStream uses), logs to the VM log as android.util.Log does, properties to the device's
// SystemProperties. A function this table does not have is bound to an entry that fails naming it when called (process.missingSymbol); pthread_create fails the
// same way, because the lab runs no native threads.
import { parseCFloat, roundBinary, bitsToNumber, BINARY32, BINARY64, BINARY128 } from './strtod.js?v=858dc45125cc';
import { addProcesses } from './processes.js?v=858dc45125cc';
import { APKError } from '../apk-error.js?v=858dc45125cc';
import { BLOCKED } from './cpu.js?v=858dc45125cc';
import { extendLibc } from './libc-extra.js?v=858dc45125cc';
import { addGles } from './gles.js?v=858dc45125cc';
import { utf8 } from './text.js?v=858dc45125cc';
import { createProcfs } from './procfs.js?v=858dc45125cc';
import { APP_PID, ZYGOTE_PID } from '../virtual-pids.js?v=858dc45125cc';
import { release } from '../libcore-io-native.js?v=858dc45125cc';

const EISDIR = 21, ENOTDIR = 20, EACCES = 13, EINVAL = 22, ENOENT = 2, EBADF = 9, ENOMEM = 12, EAGAIN = 11, ENOSYS = 38, ERANGE = 34;
const text = bytes => utf8.decode(bytes);   // memory views: src/arm64/text.js

/** Argument cursor of a variadic call (AAPCS64: GP args continue in X registers then the stack, FP args in V registers then the stack) or of a va_list. */
export function variadic(cpu, fixedGp, fixedFp = 0) {
  let gp = fixedGp, fp = fixedFp, stack = Number(cpu.sp);
  return {
    int() { if (gp < 8) return cpu.x[gp++]; const v = cpu.mem.read64(stack); stack += 8; return v; },
    double() { if (fp < 8) return cpu.getD(fp++); const v = cpu.mem.float64(stack); stack += 8; return v; },
  };
}
export function vaList(mem, ptr) {
  let stack = mem.readPtr(ptr); const grTop = mem.readPtr(ptr + 8), vrTop = mem.readPtr(ptr + 16); let grOffs = mem.int32(ptr + 24), vrOffs = mem.int32(ptr + 28);
  return {
    int() { if (grOffs < 0) { const v = mem.read64(grTop + grOffs); grOffs += 8; return v; } const v = mem.read64(stack); stack += 8; return v; },
    double() { if (vrOffs < 0) { const v = mem.float64(vrTop + vrOffs); vrOffs += 16; return v; } const v = mem.float64(stack); stack += 8; return v; },
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
  const write = (p, ptr, s) => { const bytes = new TextEncoder().encode(s); p.memory.copyIn(Number(ptr), bytes); p.memory.setByte(Number(ptr) + bytes.length, 0); return bytes.length; };
  const bounded = (p, dst, size, s) => { const bytes = new TextEncoder().encode(s), n = Number(size); if (n > 0) { const k = Math.min(bytes.length, n - 1); p.memory.copyIn(Number(dst), bytes.subarray(0, k)); p.memory.setByte(Number(dst) + k, 0); } return bytes.length; };
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
  // mallinfo() (bionic malloc.h: struct mallinfo of ten size_t, returned through the indirect-result register X8 as AAPCS64 does for a struct over 16 bytes): the lab heap's own
  // figures -- arena the bytes taken for blocks (headers included), ordblks the free blocks, uordblks the bytes in use, fordblks the free bytes; the other fields are 0
  lib.mallinfo = (p, c) => {
    const at = Number(c.x[8]); let used = 0, free = 0, freeBlocks = 0;
    for (const size of p.heap.sizes.values()) used += size;
    for (const [size, blocks] of p.heap.free) { free += size * blocks.length; freeBlocks += blocks.length; }
    const blocks = p.heap.sizes.size + freeBlocks, fields = [used + free + 16 * blocks, freeBlocks, 0, 0, 0, 0, 0, used, free, 0];
    fields.forEach((value, i) => p.memory.write64(at + 8 * i, BigInt(value)));
    return at;
  };
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
  lib.strnlen = (p, c) => { const a = n(c, 0), max = n(c, 1); let i = 0; while (i < max && p.memory.byte(a + i)) i++; return i; };
  const cmp = (a, b, max = Infinity, fold = false) => { for (let i = 0; i < max; i++) { let x1 = a[i] ?? 0, y1 = b[i] ?? 0; if (fold) { if (x1 >= 65 && x1 <= 90) x1 += 32; if (y1 >= 65 && y1 <= 90) y1 += 32; } if (x1 !== y1) return x1 - y1; if (!x1) return 0; } return 0; };
  const bytesOf = (p, ptr) => p.memory.cString(Number(ptr));
  lib.strcmp = (p, c) => cmp(bytesOf(p, x(c, 0)), bytesOf(p, x(c, 1)));
  lib.strncmp = (p, c) => cmp(bytesOf(p, x(c, 0)), bytesOf(p, x(c, 1)), n(c, 2));
  lib.strcasecmp = (p, c) => cmp(bytesOf(p, x(c, 0)), bytesOf(p, x(c, 1)), Infinity, true);
  lib.strncasecmp = (p, c) => cmp(bytesOf(p, x(c, 0)), bytesOf(p, x(c, 1)), n(c, 2), true);
  lib.strcpy = lib.__strcpy_chk = (p, c) => { const src = bytesOf(p, x(c, 1)).slice(); p.memory.copyIn(n(c, 0), src); p.memory.setByte(n(c, 0) + src.length, 0); return n(c, 0); };
  lib.stpcpy = (p, c) => { const src = bytesOf(p, x(c, 1)).slice(); p.memory.copyIn(n(c, 0), src); p.memory.setByte(n(c, 0) + src.length, 0); return n(c, 0) + src.length; };
  lib.strncpy = lib.__strncpy_chk = lib.__strncpy_chk2 = (p, c) => { const src = bytesOf(p, x(c, 1)), len = n(c, 2), d = n(c, 0); p.memory.fill(d, 0, len); p.memory.copyIn(d, src.subarray(0, Math.min(src.length, len))); return d; };
  lib.strlcpy = lib.__strlcpy_chk = (p, c) => { const src = bytesOf(p, x(c, 1)), size = n(c, 2), d = n(c, 0); if (size) { const k = Math.min(src.length, size - 1); p.memory.copyIn(d, src.subarray(0, k)); p.memory.setByte(d + k, 0); } return src.length; };
  lib.strcat = lib.__strcat_chk = (p, c) => { const d = n(c, 0), end = d + bytesOf(p, d).length, src = bytesOf(p, x(c, 1)).slice(); p.memory.copyIn(end, src); p.memory.setByte(end + src.length, 0); return d; };
  lib.strncat = lib.__strncat_chk = (p, c) => { const d = n(c, 0), end = d + bytesOf(p, d).length, src = bytesOf(p, x(c, 1)).slice(0, n(c, 2)); p.memory.copyIn(end, src); p.memory.setByte(end + src.length, 0); return d; };
  lib.strlcat = lib.__strlcat_chk = (p, c) => { const d = n(c, 0), size = n(c, 2), dlen = bytesOf(p, d).length, src = bytesOf(p, x(c, 1)); if (dlen < size) { const k = Math.min(src.length, size - dlen - 1); p.memory.copyIn(d + dlen, src.subarray(0, k)); p.memory.setByte(d + dlen + k, 0); } return dlen + src.length; };
  lib.strchr = lib.__strchr_chk = (p, c) => { const a = n(c, 0), b = bytesOf(p, a), ch = Number(x(c, 1) & 0xffn); if (ch === 0) return a + b.length; const at = b.indexOf(ch); return at < 0 ? 0 : a + at; };
  lib.strrchr = lib.__strrchr_chk = (p, c) => { const a = n(c, 0), b = bytesOf(p, a), ch = Number(x(c, 1) & 0xffn); if (ch === 0) return a + b.length; const at = b.lastIndexOf(ch); return at < 0 ? 0 : a + at; };
  lib.strstr = (p, c) => { const a = n(c, 0), hay = str(p, a), needle = str(p, x(c, 1)), at = hay.indexOf(needle); return at < 0 ? 0 : a + new TextEncoder().encode(hay.slice(0, at)).length; };
  lib.strdup = (p, c) => p.allocString(str(p, x(c, 0)));
  lib.strndup = (p, c) => { const b = bytesOf(p, x(c, 0)).slice(0, n(c, 1)), ptr = p.malloc(b.length + 1); p.memory.copyIn(ptr, b); p.memory.setByte(ptr + b.length, 0); return ptr; };
  lib.strspn = (p, c) => { const s = bytesOf(p, x(c, 0)), set = new Set(bytesOf(p, x(c, 1))); let i = 0; while (i < s.length && set.has(s[i])) i++; return i; };
  lib.strcspn = (p, c) => { const s = bytesOf(p, x(c, 0)), set = new Set(bytesOf(p, x(c, 1))); let i = 0; while (i < s.length && !set.has(s[i])) i++; return i; };
  lib.strpbrk = (p, c) => { const a = n(c, 0), s = bytesOf(p, a), set = new Set(bytesOf(p, x(c, 1))); for (let i = 0; i < s.length; i++) if (set.has(s[i])) return a + i; return 0; };
  lib.strerror = (p, c) => p.allocString(`errno ${n(c, 0)}`);
  lib.strerror_r = (p, c) => { bounded(p, x(c, 1), x(c, 2), `errno ${n(c, 0)}`); return 0; };
  // __gnu_strerror_r (bionic, the GNU strerror_r that _GNU_SOURCE code links against): strerror_r into the buffer, and the buffer is the result
  lib.__gnu_strerror_r = (p, c) => { bounded(p, x(c, 1), x(c, 2), `errno ${n(c, 0)}`); return x(c, 1); };
  const parseInt64 = (p, c, unsigned) => { const s = str(p, x(c, 0)), base = n(c, 2), m = /^\s*([+-]?)(0x|0X)?([0-9a-zA-Z]*)/.exec(s), radix = base || (m[2] ? 16 : m[3].startsWith('0') && m[3].length > 1 ? 8 : 10); let digits = ''; for (const ch of m[3]) { if (parseInt(ch, 36) < radix) digits += ch; else break; } let v = 0n; for (const ch of digits) v = v * BigInt(radix) + BigInt(parseInt(ch, 36)); if (m[1] === '-') v = -v; if (n(c, 1)) p.memory.writePtr(n(c, 1), n(c, 0) + (digits.length ? m[0].length - (m[3].length - digits.length) : 0)); return unsigned ? BigInt.asUintN(64, v) : BigInt.asIntN(64, v); };
  lib.strtol = lib.strtoll = lib.strtoimax = (p, c) => parseInt64(p, c, false);
  lib.strtoul = lib.strtoull = lib.strtoumax = (p, c) => parseInt64(p, c, true);
  lib.atoi = lib.atol = lib.atoll = (p, c) => { const v = parseInt(str(p, x(c, 0)), 10); return BigInt.asUintN(64, BigInt(isNaN(v) ? 0 : v)); };
  // strtof / strtod / strtold (src/arm64/strtod.js): one rounding from the exact value; the result in S0, D0 or Q0 (AArch64's long double is binary128); ERANGE out of range
  const strtoFloat = format => (p, c) => {
    const parsed = parseCFloat(str(p, x(c, 0))), { bits, erange } = roundBinary(parsed, format);
    if (n(c, 1)) p.memory.writePtr(n(c, 1), n(c, 0) + parsed.length);   // the end of the number, or the string itself when there is none
    if (erange) p.memory.writeU32(p.errnoAddress, ERANGE);
    if (format === BINARY128) { c.vWriteBig(0, bits, 16); return undefined; }
    return format === BINARY32 ? { float: bitsToNumber(bits, BINARY32) } : { double: bitsToNumber(bits, BINARY64) };
  };
  lib.strtof = strtoFloat(BINARY32); lib.strtod = strtoFloat(BINARY64); lib.strtold = strtoFloat(BINARY128);
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
  lib.getpid = () => runtime?.platform?.virtualProcess?.pid ?? APP_PID;
  lib.getuid = lib.geteuid = lib.getgid = lib.getegid = () => runtime?.platform?.virtualProcess?.uid ?? 10123;
  lib.getppid = () => runtime?.platform?.virtualProcess?.ppid ?? ZYGOTE_PID;   // zygote, the parent of every app process (src/virtual-pids.js)
  // Process group and session (POSIX): an app process is forked by zygote, which ZygoteInit.main puts in its own process group (Os.setpgid(0, 0)) under the session init
  // started it in; the app inherits both, so its pgid and sid are its parent zygote's pid (getppid, src/virtual-pids.js). getpgid/getsid of another pid the VM has (only the parent) answer the
  // same; any other pid is ESRCH. setpgid/setsid are not provided (they fail by name).
  const ESRCH = 3, parentGroup = pid => (pid === 0 || pid === lib.getpid() || pid === lib.getppid() ? lib.getppid() : null);
  lib.getpgid = lib.getsid = (p, c) => parentGroup(Number(BigInt.asIntN(32, c.x[0]))) ?? setErrno(p, ESRCH);
  lib.getpgrp = () => lib.getppid();
  lib.isatty = () => 0;
  // prctl: PR_SET_NAME / PR_GET_NAME name the calling thread (its /proc comm); the other options change nothing the lab models and answer 0
  lib.prctl = (p, c) => {
    const option = Number(BigInt.asIntN(32, c.x[0])), t = p.threads?.current;
    if (option === 15 && t) { t.comm = text(p.memory.cString(Number(c.x[1]), 64)).slice(0, 15); return 0; }
    if (option === 16 && t) { const bytes = new TextEncoder().encode(lib.__procfs.commOf(p, t)); p.memory.fill(Number(c.x[1]), 0, 16); p.memory.copyIn(Number(c.x[1]), bytes.subarray(0, 15)); return 0; }
    return 0;
  };
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
  // CLOCK_REALTIME(_COARSE) is the wall clock; CLOCK_MONOTONIC, _RAW, _COARSE and BOOTTIME the native threads' clock (the VM clock, whose deadlines every native wait uses);
  // the CPU-time clocks (PROCESS/THREAD_CPUTIME_ID) the host's time
  lib.__wallMs = () => clock();   // CLOCK_REALTIME in milliseconds (an absolute FUTEX_CLOCK_REALTIME deadline, src/arm64/threads.js)
  lib.clock_gettime = (p, c) => { const id = n(c, 0), ms = id === 0 || id === 5 ? clock() : id === 2 || id === 3 ? performance.now() : (p.threads?.now() ?? performance.now()), ptr = n(c, 1); p.memory.write64(ptr, BigInt(Math.floor(ms / 1000))); p.memory.write64(ptr + 8, BigInt(Math.floor((ms % 1000) * 1e6))); return 0; };
  lib.clock = () => BigInt(Math.floor(performance.now() * 1000));
  // ---- threads (src/arm64/threads.js): pthread_create runs the start routine as a native thread; locks, conditions, joins and futexes wait for real
  const T = p => p.threads, BLOCK = r => r; let nextKey = 1;
  lib.pthread_create = (p, c) => { const self = T(p).create(n(c, 2), n(c, 3)); p.memory.writePtr(n(c, 0), self); return 0; };   // pthread_t: the address of the new thread's pthread_internal_t
  lib.pthread_join = (p, c) => BLOCK(T(p).join(c, n(c, 0), n(c, 1)));
  lib.pthread_detach = () => 0;
  // pthread_cleanup_push / pop (bionic's __pthread_cleanup_t { prev; routine; arg; } on the caller's stack, a per-thread chain): pop runs the routine when asked, pthread_exit runs every pushed routine
  lib.__pthread_cleanup_push = (p, c) => { const t = T(p).current, record = n(c, 0); p.memory.writePtr(record, t.cleanup ?? 0); p.memory.writePtr(record + 8, n(c, 1)); p.memory.writePtr(record + 16, n(c, 2)); t.cleanup = record; };
  lib.__pthread_cleanup_pop = (p, c) => { const t = T(p).current, record = n(c, 0), execute = s32(c, 1); t.cleanup = p.memory.readPtr(record) || 0; if (execute) p.call(p.memory.readPtr(record + 8), [p.memory.readPtr(record + 16)]); };
  lib.pthread_exit = (p, c) => { const t = T(p).current, value = x(c, 0); if (t.main) throw new APKError('ARM64 native code called pthread_exit on the thread that runs Java', { kind: 'arm64-threads' }); while (t.cleanup) { const record = t.cleanup; t.cleanup = p.memory.readPtr(record) || 0; p.call(p.memory.readPtr(record + 8), [p.memory.readPtr(record + 16)]); } T(p).finish(t, value); c.exited = true; };
  lib.pthread_self = p => T(p).selfOf();
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
  const spanMs = (p, ptr) => Number(p.memory.read64(ptr)) * 1000 + Number(p.memory.read64(ptr + 8)) / 1e6;
  lib.pthread_cond_timedwait_monotonic_np = (p, c) => BLOCK(T(p).condWait(c, n(c, 0), n(c, 1), spanMs(p, n(c, 2))));   // an absolute CLOCK_MONOTONIC time: the native threads' clock
  lib.pthread_cond_timedwait_relative_np = (p, c) => BLOCK(T(p).condWait(c, n(c, 0), n(c, 1), T(p).now() + spanMs(p, n(c, 2))));   // relative: from the first call (condWait keeps the deadline while the call is retried)
  lib.pthread_cond_signal = lib.pthread_cond_broadcast = (p, c) => T(p).condSignal(n(c, 0));
  lib.pthread_rwlock_rdlock = lib.pthread_rwlock_wrlock = (p, c) => BLOCK(T(p).mutexLock(c, n(c, 0)));
  lib.pthread_rwlock_tryrdlock = lib.pthread_rwlock_trywrlock = (p, c) => T(p).mutexTrylock(n(c, 0));
  lib.pthread_rwlock_unlock = (p, c) => T(p).mutexUnlock(n(c, 0));
  for (const name of ['pthread_rwlock_init', 'pthread_rwlock_destroy', 'pthread_attr_init', 'pthread_attr_destroy', 'pthread_attr_setstacksize', 'pthread_attr_setdetachstate', 'pthread_attr_getstacksize', 'pthread_attr_setschedparam', 'pthread_attr_setschedpolicy', 'pthread_condattr_init', 'pthread_condattr_setclock', 'pthread_condattr_destroy', 'pthread_setschedparam', 'setpriority']) lib[name] = () => 0;
  // pthread_setname_np / pthread_getname_np: the thread's comm (/proc/self/task/<tid>/comm), 15 bytes at most (ERANGE beyond, as bionic)
  lib.pthread_setname_np = (p, c) => { const t = p.threads?.byPthread?.(n(c, 0)); if (!t) return 3; const name = text(p.memory.cString(n(c, 1), 64)); if (new TextEncoder().encode(name).length > 15) return ERANGE; t.comm = name; return 0; };
  lib.pthread_getname_np = (p, c) => { const t = p.threads?.byPthread?.(n(c, 0)); if (!t) return 3; const bytes = new TextEncoder().encode(lib.__procfs.commOf(p, t)); if (n(c, 2) < bytes.length + 1) return ERANGE; p.memory.copyIn(n(c, 1), bytes); p.memory.setByte(n(c, 1) + bytes.length, 0); return 0; };
  // a thread that cannot be suspended (native code called from Java) sleeps by running the other native threads until the time has passed, as they run meanwhile on a device
  // A signal handler that runs on the sleeping thread ends the sleep early (src/arm64/signals.js): the result is the time left in ms (0 when the whole time passed)
  const sleepFor = (p, c, ms) => {
    const t = T(p).current, suspend = T(p).canSuspend(c);
    if (!suspend || t.sleepUntil === undefined) { t.sleepUntil = T(p).now() + ms; t.sleepRuns = t.handlerRuns ?? 0; }
    const deadline = t.sleepUntil, interrupted = () => (t.handlerRuns ?? 0) > t.sleepRuns;
    const r = T(p).wait(c, () => T(p).now() >= deadline || interrupted(), { what: 'sleep', deadline });
    if (r === BLOCKED) return BLOCKED;
    t.sleepUntil = undefined; return interrupted() ? Math.max(0, deadline - T(p).now()) : 0;
  };
  lib.nanosleep = (p, c) => {   // EINTR with the time left in *rem
    const ptr = n(c, 0), rem = n(c, 1), left = sleepFor(p, c, Number(p.memory.read64(ptr)) * 1000 + Number(p.memory.read64(ptr + 8)) / 1e6); if (left === BLOCKED) return BLOCKED;
    if (!left) return 0;
    if (rem) { const whole = Math.floor(left / 1000); p.memory.write64(rem, BigInt(whole)); p.memory.write64(rem + 8, BigInt(Math.round((left - whole * 1000) * 1e6))); }
    return setErrno(p, 4);
  };
  lib.usleep = (p, c) => { const left = sleepFor(p, c, n(c, 0) / 1000); return left === BLOCKED ? BLOCKED : left ? setErrno(p, 4) : 0; };
  lib.sleep = (p, c) => { const left = sleepFor(p, c, n(c, 0) * 1000); return left === BLOCKED ? BLOCKED : Math.ceil(left / 1000); };   // the seconds left
  lib.sched_yield = (p, c) => { if (!T(p).canSuspend(c)) { T(p).runOthers(T(p).current); return 0; } const t = T(p).current; if (t.yielded) { t.yielded = false; return 0; } t.yielded = true; t.state = 'waiting'; t.ready = () => true; t.deadline = Infinity; return BLOCKED; };
  lib.pthread_once = (p, c) => { const control = n(c, 0); if (p.memory.readU32(control) === 0) { p.memory.writeU32(control, 1); p.call(n(c, 1), []); p.memory.writeU32(control, 2); } return 0; };
  lib.pthread_key_create = (p, c) => { const key = nextKey++; p.memory.writeU32(n(c, 0), key); return 0; };
  lib.pthread_key_delete = () => 0;
  lib.pthread_getspecific = (p, c) => T(p).current.keys.get(n(c, 0)) ?? 0;
  lib.pthread_setspecific = (p, c) => { T(p).current.keys.set(n(c, 0), n(c, 1)); return 0; };
  // pthread_getattr_np: the thread's own pthread_attr_t (bionic: flags, stack_base, stack_size, guard_size, sched_policy, sched_priority, 16 reserved bytes); pthread_attr_getstack reads one back
  lib.pthread_getattr_np = (p, c) => { const t = T(p).byPthread(n(c, 0)); if (!t) return 3; const self = T(p).selfOf(t); p.memory.copyIn(n(c, 1), p.memory.bytes(self + 0x18, 56).slice()); return 0; };   // ESRCH
  lib.pthread_attr_getstack = (p, c) => { const attr = n(c, 0), size = p.memory.read64(attr + 16); if (size === 0n) { p.memory.writePtr(n(c, 1), Number(c.sp) - 0x70000); p.memory.write64(n(c, 2), 0x80000n); return 0; } p.memory.writePtr(n(c, 1), p.memory.readPtr(attr + 8)); p.memory.write64(n(c, 2), size); return 0; };
  // ---- dlfcn
  // dlopen of a path loads that file (a library the app unpacked or downloaded into its own directories), of a bare name the library of that soname; a library already
  // loaded under the same soname is that one, as the linker's soname match does
  const isElf = b => b && b.length > 64 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46;
  const fileImage = path => { if (!path.includes('/')) return null; try { const b = fs()?.bytes?.(path); return isElf(b) ? b : null; } catch { return null; } };
  const openLibrary = (p, name, bytes = null) => { try { const soname = name.slice(name.lastIndexOf('/') + 1); const handle = p.load(soname, { bytes: bytes ?? fileImage(name) }); return p.order.indexOf(handle) + 0x7e0000000100; } catch (error) { p.dlerror = error.message; return 0; } };
  lib.dlopen = (p, c) => { const name = n(c, 0) ? str(p, x(c, 0)) : null; if (!name) return 0x7e0000000001; return openLibrary(p, name); };
  // android_dlopen_ext(filename, flags, const android_dlextinfo*): { u64 flags; void* reserved_addr; size_t reserved_size; int relro_fd; int library_fd; off64_t library_fd_offset;
  // android_namespace_t* library_namespace }. Loading from a descriptor (USE_LIBRARY_FD, with USE_LIBRARY_FD_OFFSET) reads the image from that file; a reserved-address hint and
  // a namespace (the lab has one) do not change where or how it loads; a required reserved address and RELRO sharing fail naming the flag.
  lib.android_dlopen_ext = (p, c) => {
    const name = n(c, 0) ? str(p, x(c, 0)) : null, info = n(c, 2), flags = info ? Number(p.memory.read64(info) & 0xffffffffn) : 0;
    if (!info || !flags) return name ? openLibrary(p, name) : 0x7e0000000001;
    const unsupported = [[0x1, 'ANDROID_DLEXT_RESERVED_ADDRESS'], [0x4, 'ANDROID_DLEXT_WRITE_RELRO'], [0x8, 'ANDROID_DLEXT_USE_RELRO']].find(([bit]) => flags & bit);
    if (unsupported) { p.dlerror = `android_dlopen_ext: ${unsupported[1]} is not supported by the lab's loader`; return 0; }
    if (flags & 0x10) {   // ANDROID_DLEXT_USE_LIBRARY_FD
      const f = fds.get(p.memory.int32(info + 28)), offset = flags & 0x20 ? Number(p.memory.read64(info + 32)) : 0, image = f?.path ? fileBytes(f.path).subarray(offset) : null;
      if (!isElf(image)) { p.dlerror = `android_dlopen_ext: descriptor ${p.memory.int32(info + 28)} does not hold an ELF image`; return 0; }
      return openLibrary(p, name ?? f.path, image);
    }
    return name ? openLibrary(p, name) : 0x7e0000000001;
  };
  // the dynamic linker's own entry points (ld-android.so, reached through libdl.so's dependencies: dlsym on libdl finds them); the caller address picks a namespace, and the
  // lab has one
  lib.__loader_dlopen = (p, c) => lib.dlopen(p, c);
  lib.__loader_android_dlopen_ext = (p, c) => lib.android_dlopen_ext(p, c);
  lib.dlsym = (p, c) => { const handle = n(c, 0), name = str(p, x(c, 1)), lib0 = handle >= 0x7e0000000100 ? p.order[handle - 0x7e0000000100] : null; const address = lib0 ? lib0.exports.get(name) : p.resolve(name, null); if (address === undefined || address === null) { p.dlerror = `undefined symbol: ${name}`; return 0; } return address; };
  lib.dlclose = lib.__loader_dlclose = () => 0;
  lib.dlerror = p => { const message = p.dlerror; p.dlerror = null; return message ? p.allocString(message) : 0; };
  lib.dladdr = (p, c) => { const lib0 = p.libraryAt(n(c, 0)); if (!lib0) return 0; const info = n(c, 1); p.memory.writePtr(info, p.allocString(lib0.path ?? lib0.name)); p.memory.writePtr(info + 8, lib0.base); p.memory.writePtr(info + 16, 0); p.memory.writePtr(info + 24, 0); return 1; };
  lib.__loader_dlsym = (p, c) => lib.dlsym(p, c); lib.__loader_dlerror = p => lib.dlerror(p); lib.__loader_dladdr = (p, c) => lib.dladdr(p, c);   // (the caller-address argument names a namespace)
  lib.dl_iterate_phdr = (p, c) => {   // dl_phdr_info: addr, name, phdr, phnum (the C++ unwinder finds .eh_frame_hdr this way)
    const callback = n(c, 0), data = n(c, 1);
    for (const lib0 of p.order) {
      const info = p.malloc(64), phdrs = lib0.phdr ?? p.malloc(lib0.elf.segments.length * 56);   // libart's image holds its own program headers
      if (!lib0.phdr) lib0.elf.segments.forEach((s, i) => { const o = phdrs + 56 * i; p.memory.writeU32(o, s.type); p.memory.writeU32(o + 4, s.flags); p.memory.write64(o + 8, BigInt(s.offset)); p.memory.write64(o + 16, BigInt(s.vaddr)); p.memory.write64(o + 24, BigInt(s.vaddr)); p.memory.write64(o + 32, BigInt(s.filesz)); p.memory.write64(o + 40, BigInt(s.memsz)); p.memory.write64(o + 48, BigInt(s.align)); });
      p.memory.writePtr(info, lib0.base); p.memory.writePtr(info + 8, p.allocString(lib0.path ?? lib0.name)); p.memory.writePtr(info + 16, phdrs); p.memory.setUint16(info + 24, lib0.elf.segments.length);
      const result = Number(BigInt.asIntN(32, p.call(callback, [info, 64, data])));
      if (result !== 0) return result;
    }
    return 0;
  };
  // ---- files over the VM's file system
  const fds = new Map(); let nextFd = 100;
  // fork (src/arm64/processes.js): a child process's libc starts with the parent's descriptors (the same open file descriptions: one offset for both, as after fork(2))
  lib.__fileTable = () => ({ fds, nextFd });
  lib.__adoptFiles = from => { const table = from.__fileTable(); for (const [fd, entry] of table.fds) fds.set(fd, entry); nextFd = table.nextFd; };
  lib.__ownsFd = fd => fds.has(fd);
  lib.__fdPath = fd => fds.get(fd)?.path ?? null;   // also the target of a native descriptor for Java's view of /proc/self/fd (runtime.nativeFdPath, src/arm64/glue.js)   // /proc/self/fd/<n>   // the process's descriptors, for Java code handed one (src/arm64/glue.js)
  const vfs = () => fs() ?? (() => { throw new APKError('ARM64 native code opened a file but the VM file system is not available here', { kind: 'arm64-files' }); })();
  // the character devices a process reads directly: random bytes, the null and zero devices
  const randomBytes = length => { const bytes = new Uint8Array(length); for (let i = 0; i < length; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(length, i + 65536))); return bytes; };
  const DEVICES = { '/dev/urandom': randomBytes, '/dev/random': randomBytes, '/dev/zero': length => new Uint8Array(length), '/dev/null': () => new Uint8Array(0) };
  const deviceOf = path => DEVICES[path] ? { device: path, read: DEVICES[path] } : null;
  // /proc of the app's own process (src/arm64/procfs.js): generated files and directories; directories of the VM file system open as directory descriptors (getdents64, fdopendir)
  // the app's /proc (src/procfs.js, the model Java reads too); this process adds its maps, mem, threads and descriptors (src/arm64/procfs.js)
  const procfs = lib.__procfs = createProcfs({ runtime, fs, fdFile: fd => { const f = fds.get(fd); return f?.path ? { path: f.path, deleted: false, node: fs()?.node?.(f.path) ?? null, bytes: () => contentOf(f) } : null; }, fdList: () => [...fds.keys()] });
  const linked = (p, path) => { const proc = procOf(p, path); return proc?.link && !proc.deleted ? proc.link : path; };   // a /proc/self/fd/<n> link opens (stats, reads) the file it names
  const procOf = (p, path) => procfs.lookup(p, String(path).replace(/\/+/g, '/'));
  const dirNames = (p, path) => { const proc = procOf(p, path); if (proc?.names) return proc.names; if (proc) return null; return fs()?.stat(path)?.type === 'dir' ? fs().list(path).map(name => String(name).split('/').pop()) : null; };
  lib.__dirNames = dirNames; lib.__dirFd = fd => { const f = fds.get(fd); return f?.dir ? f : null; };
  const contentOf = f => f.data ?? fileBytes(f.path);
  lib.open = lib.__open_2 = lib.open64 = (p, c) => { const path = linked(p, str(p, x(c, 0))), flags = n(c, 1); { const dev = deviceOf(path); if (dev) { const fd = nextFd++; fds.set(fd, { ...dev, path, offset: 0 }); return fd; } }
    { const proc = procOf(p, path); if (proc) { if (proc.missing) return setErrno(p, ENOENT); if (proc.link) { const fd = nextFd++; fds.set(fd, { path: proc.link, data: proc.bytes() ?? new Uint8Array(0), offset: 0 }); return fd; } if (proc.mem) { const fd = nextFd++; fds.set(fd, { path, mem: true, offset: 0 }); return fd; } if (flags & 3) return setErrno(p, EACCES); if (proc.names) { const fd = nextFd++; fds.set(fd, { path, dir: true, names: proc.names, index: 0, offset: 0 }); return fd; } if (flags & 0o40000) return setErrno(p, ENOTDIR); const fd = nextFd++; fds.set(fd, { path, data: proc.data, offset: 0, proc: true }); return fd; } }
    if (fs()?.stat(path)?.type === 'dir') { if (flags & 3) return setErrno(p, EISDIR); const fd = nextFd++; fds.set(fd, { path, dir: true, names: dirNames(p, path), index: 0, offset: 0 }); return fd; }   // a directory opens read-only (O_DIRECTORY or not)
    if (flags & 0o40000) return setErrno(p, fs()?.stat(path) ? ENOTDIR : ENOENT);
    if (flags & 3 && fs()?.isReadOnly(path)) return setErrno(p, fs().stat(path) || flags & 0o100 ? EACCES : ENOENT);   // /system, the installed package: nothing there is the app's to write (src/libcore-io-native.js open)
    const files = vfs(); const exists = files.stat(path)?.type === 'file'; if (!exists && !(flags & 0o100)) return setErrno(p, ENOENT); if (exists && files.denied?.(path)) return setErrno(p, EACCES); if (!exists) files.setBytes(path, new Uint8Array(0)); if (flags & 0o1000) files.setBytes(path, new Uint8Array(0)); const fd = nextFd++; fds.set(fd, { path, offset: 0, append: !!(flags & 0o2000) }); return fd; };
  lib.openat = (p, c) => { c.x[0] = c.x[1]; c.x[1] = c.x[2]; c.x[2] = c.x[3]; return lib.open(p, c); };
  lib.close = (p, c) => { if (!fds.delete(n(c, 0))) return setErrno(p, EBADF); return 0; };
  // extended attributes (getxattr / setxattr / listxattr / removexattr and their l- and f- forms): the VM file system keeps none, so they fail with EOPNOTSUPP, as on a file
  // system without xattr support (ENOENT for a missing path, EBADF for a closed descriptor)
  const EOPNOTSUPP = 95;
  for (const op of ['getxattr', 'setxattr', 'listxattr', 'removexattr']) {
    lib[op] = lib['l' + op] = (p, c) => { const path = linked(p, str(p, x(c, 0))); return setErrno(p, deviceOf(path) || procOf(p, path) || fs()?.stat(path) ? EOPNOTSUPP : ENOENT); };
    lib['f' + op] = (p, c) => setErrno(p, fds.has(n(c, 0)) || n(c, 0) <= 2 ? EOPNOTSUPP : EBADF);
  }
  // getdents64(fd, dirp, count): linux_dirent64 records { d_ino u64, d_off s64, d_reclen u16, d_type u8, d_name[] } padded to 8 bytes, "." and ".." first; 0 at the end
  lib.getdents64 = (p, c) => {
    const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); if (!f.dir) return setErrno(p, ENOTDIR);
    const names = ['.', '..', ...(f.names ?? [])], out = n(c, 1), count = n(c, 2), encoder = new TextEncoder(); let used = 0;
    while (f.index < names.length) {
      const name = encoder.encode(names[f.index]), reclen = Math.ceil((19 + name.length + 1) / 8) * 8;
      if (used + reclen > count) { if (used === 0) return setErrno(p, EINVAL); break; }
      const at = out + used, isDir = f.index < 2 || dirNames(p, `${f.path}/${names[f.index]}`) !== null;
      p.memory.fill(at, 0, reclen); p.memory.write64(at, BigInt(f.index + 1)); p.memory.write64(at + 8, BigInt(f.index + 1)); p.memory.setUint16(at + 16, reclen); p.memory.setByte(at + 18, isDir ? 4 : 8); p.memory.copyIn(at + 19, name);
      used += reclen; f.index++;
    }
    return used;
  };
  const fileBytes = path => vfs().bytes(path) ?? new Uint8Array(0);
  // a MAP_SHARED mapping and the file are one: a write to the file shows in every live mapping of it, and msync / munmap write a writable mapping back
  const store = (p, path, data) => { vfs().setBytes(path, data); for (const m of p.sharedMappings ?? []) if (m.path === path) p.memory.copyIn(m.at, data.subarray(m.offset, m.offset + m.length).length === m.length ? data.subarray(m.offset, m.offset + m.length) : (() => { const b = new Uint8Array(m.length); b.set(data.subarray(m.offset, m.offset + m.length)); return b; })()); };
  // MAP_SHARED: the mapping, the file and every other mapping of the file are the same bytes (one page mapped twice, as code that writes a trampoline through a
  // writable view of a memfd and runs it through an executable view of the same memfd relies on). A write into a mapped range (by native code, translated or not, or by a
  // lab function) goes to the file at once and to the other mappings of it, whose decoded instructions are dropped. Writes past the file's end are not carried (a device
  // raises SIGBUS there).
  const coherent = (p, address, length) => {
    const maps = p.sharedMappings ?? [], files = vfs();
    for (const m of maps) {
      const start = Math.max(address, m.at), end = Math.min(address + length, m.at + m.length); if (start >= end) continue;
      const node = m.node ?? files.node?.(m.path), fileOffset = m.offset + (start - m.at), size = node?.size ?? fileBytes(m.path).length, count = Math.min(end - start, size - fileOffset); if (count <= 0) continue;
      const bytes = p.memory.bytes(start, count).slice();
      if (node?.type === 'file') files.writeAt(node, fileOffset, bytes, 0, count); else { const data = fileBytes(m.path).slice(); data.set(bytes, fileOffset); files.setBytes(m.path, data); }
      for (const o of maps) {
        if (o === m || (m.node || o.node ? (o.node ?? files.node?.(o.path)) !== node : o.path !== m.path)) continue;   // the same file: its node (a memfd has no name in the tree)
        const from = Math.max(fileOffset, o.offset), to = Math.min(fileOffset + count, o.offset + o.length); if (from < to) p.memory.mirror(o.at + (from - o.offset), bytes.subarray(from - fileOffset, to - fileOffset));
      }
    }
  };
  lib['memfd-dir'] = () => { const files = vfs(); if (files.stat('/memfd')?.type !== 'dir') files.mkdirs('/memfd'); };   // (src/arm64/libc-more.js memfd_create)
  lib['shared-mapping'] = (p, mapping) => { p.sharedMappings = [...(p.sharedMappings ?? []), mapping]; p.memory.onWrite ??= (address, length) => coherent(p, address, length); p.memory.watch?.(mapping.at, mapping.length); };   // (not a C identifier: never a symbol)
  const writeBack = (p, at, length) => { for (const m of p.sharedMappings ?? []) if (m.writable && at < m.at + m.length && at + length > m.at) { const data = fileBytes(m.path), next = new Uint8Array(Math.max(data.length, m.offset + m.length)); next.set(data); next.set(p.memory.bytes(m.at, m.length), m.offset); vfs().setBytes(m.path, next); } };
  const memRead = (p, f, dst, length, at) => { if (!p.isMapped(at) || !p.isMapped(at + Math.max(0, length - 1))) return setErrno(p, 5); p.memory.copyIn(dst, p.memory.bytes(at, length).slice()); return length; };   // EIO for an unmapped address
  const memWrite = (p, f, src, length, at) => { if (!p.isMapped(at) || !p.isMapped(at + Math.max(0, length - 1))) return setErrno(p, 5); p.memory.copyIn(at, p.memory.bytes(src, length).slice()); return length; };
  lib.read = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); if (f.dir) return setErrno(p, EISDIR); if (f.mem) { const got = memRead(p, f, n(c, 1), n(c, 2), f.offset); if (got > 0) f.offset += got; return got; } if (f.device) { const chunk = f.read(n(c, 2)); p.memory.copyIn(n(c, 1), chunk); return chunk.length; } const data = contentOf(f), chunk = data.subarray(f.offset, f.offset + n(c, 2)); p.memory.copyIn(n(c, 1), chunk); f.offset += chunk.length; return chunk.length; };
  lib.pread = lib.pread64 = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); if (f.mem) return memRead(p, f, n(c, 1), n(c, 2), Number(BigInt.asUintN(64, x(c, 3)))); const data = contentOf(f), at = n(c, 3), chunk = data.subarray(at, at + n(c, 2)); p.memory.copyIn(n(c, 1), chunk); return chunk.length; };
  lib.write = (p, c) => { const fd = n(c, 0); { const f = fds.get(fd); if (f?.mem) { const put = memWrite(p, f, n(c, 1), n(c, 2), f.offset); if (put > 0) f.offset += put; return put; } } const bytes = p.memory.bytes(n(c, 1), n(c, 2)).slice(); if (fd === 1 || fd === 2) { log(fd === 1 ? 4 : 6, fd === 1 ? 'stdout' : 'stderr', text(bytes).replace(/\n$/, '')); return bytes.length; } const f = fds.get(fd); if (!f) return setErrno(p, EBADF); if (f.device) return bytes.length; const data = contentOf(f), at = f.append ? data.length : f.offset, next = new Uint8Array(Math.max(data.length, at + bytes.length)); next.set(data); next.set(bytes, at); store(p, f.path, next); f.offset = at + bytes.length; return bytes.length; };
  lib.pwrite = lib.pwrite64 = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); if (f.mem) return memWrite(p, f, n(c, 1), n(c, 2), Number(BigInt.asUintN(64, x(c, 3)))); const bytes = p.memory.bytes(n(c, 1), n(c, 2)).slice(), at = n(c, 3), data = contentOf(f), next = new Uint8Array(Math.max(data.length, at + bytes.length)); next.set(data); next.set(bytes, at); store(p, f.path, next); return bytes.length; };
  lib.lseek = lib.lseek64 = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); if (f.mem) { const off = Number(BigInt.asIntN(64, x(c, 1))), whence = n(c, 2); f.offset = whence === 0 ? Number(BigInt.asUintN(64, x(c, 1))) : whence === 1 ? f.offset + off : setErrno(p, EINVAL); return f.offset; } const whence = n(c, 2), off = Number(BigInt.asIntN(64, x(c, 1))); f.offset = whence === 0 ? off : whence === 1 ? f.offset + off : contentOf(f).length + off; return f.offset; };
  // fallocate(fd, mode, offset, len) / posix_fallocate(fd, offset, len), as on a filesystem with the common modes (ext4, f2fs): mode 0 makes the file at least offset + len
  // bytes long (zeros); FALLOC_FL_KEEP_SIZE (1) alone reserves space without changing the size; PUNCH_HOLE (2, with KEEP_SIZE) and ZERO_RANGE (0x10) zero the range (ZERO_RANGE
  // without KEEP_SIZE also extends the file); collapse, insert and unshare fail with EOPNOTSUPP. A pipe or socket is ESPIPE, a device ENODEV. Returns 0 or the error number.
  const allocate = (p, fd, mode, offset, len) => {
    const f = fds.get(fd); if (!f) return lib.__ownsFd?.(fd) ? 29 : EBADF;
    if (f.device) return 19;
    if (offset < 0 || len <= 0) return EINVAL;
    const KEEP = 1, PUNCH = 2, ZERO = 0x10;
    if (mode & ~(KEEP | PUNCH | ZERO) || ((mode & PUNCH) && (mode & ZERO))) return 95;
    if ((mode & PUNCH) && !(mode & KEEP)) return 95;
    const data = contentOf(f), end = offset + len, size = data.length;
    if (mode === KEEP) return 0;
    if (mode & (PUNCH | ZERO)) {
      const grow = !(mode & KEEP) && end > size, next = new Uint8Array(grow ? end : size); next.set(data); next.fill(0, Math.min(offset, next.length), Math.min(end, next.length)); store(p, f.path, next); return 0;
    }
    if (end > size) { const next = new Uint8Array(end); next.set(data); store(p, f.path, next); }
    return 0;
  };
  const off = (c, i) => Number(BigInt.asIntN(64, c.x[i]));
  lib.fallocate = lib.fallocate64 = (p, c) => { const error = allocate(p, n(c, 0), s32(c, 1), off(c, 2), off(c, 3)); return error ? setErrno(p, error) : 0; };
  lib.posix_fallocate = lib.posix_fallocate64 = (p, c) => allocate(p, n(c, 0), 0, off(c, 1), off(c, 2));   // POSIX: the error number is the result, errno is untouched
  lib.ftruncate = lib.ftruncate64 = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); const size = n(c, 1), data = contentOf(f), next = new Uint8Array(size); next.set(data.subarray(0, size)); store(p, f.path, next); return 0; };
  const statInto = (p, path, out) => { path = linked(p, path); if (deviceOf(path)) { p.memory.fill(out, 0, 128); p.memory.writeU32(out + 16, 0o20666); return 0; } { const proc = procOf(p, path); if (proc) { if (proc.missing) return setErrno(p, ENOENT); p.memory.fill(out, 0, 128); p.memory.writeU32(out + 16, proc.names ? 0o40555 : 0o100444); return 0; } }   // procfs files report size 0, as the kernel's do
  const st = vfs().stat(path); if (!st) return setErrno(p, ENOENT); p.memory.fill(out, 0, 128); p.memory.writeU32(out + 16, st.type === 'dir' ? 0o40755 : 0o100644); p.memory.write64(out + 48, BigInt(st.type === 'file' ? fileBytes(path).length : 4096)); return 0; };
  lib.stat = lib.stat64 = lib.lstat = lib.lstat64 = (p, c) => statInto(p, str(p, x(c, 0)), n(c, 1));
  lib.fstat = lib.fstat64 = (p, c) => { const f = fds.get(n(c, 0)); if (!f) return setErrno(p, EBADF); if (f.device) { const out = n(c, 1); p.memory.fill(out, 0, 128); p.memory.writeU32(out + 16, 0o20666); return 0; } return statInto(p, f.path, n(c, 1)); };
  lib.access = (p, c) => { const path = linked(p, str(p, x(c, 0))), proc = procOf(p, path); if (proc) return proc.missing ? setErrno(p, ENOENT) : 0; if (deviceOf(path)) return 0; if (!vfs().stat(path)) return setErrno(p, ENOENT); return n(c, 1) & 2 && vfs().isReadOnly(path) ? setErrno(p, EACCES) : 0; };
  lib.unlink = lib.remove = (p, c) => { const path = str(p, x(c, 0)); if (!vfs().stat(path)) return setErrno(p, ENOENT); vfs().delete(path); return 0; };
  lib.mkdir = (p, c) => { vfs().mkdirs?.(str(p, x(c, 0))); return 0; };
  lib.fsync = lib.fdatasync = () => 0;
  lib.fcntl = () => 0; lib.flock = () => 0; lib.ioctl = (p) => setErrno(p, ENOSYS);
  // mmap: anonymous regions come from the address space; a file mapping copies the file: MAP_PRIVATE keeps its writes, MAP_SHARED is one with the file (coherent above)
  lib.mmap = lib.mmap64 = (p, c) => { const length = n(c, 1), flags = n(c, 3), fd = s32(c, 4), offset = n(c, 5); if (length >= 64 * 1048576) runtime?.record?.(`ARM64 mmap of ${Math.round(length / 1048576)} MiB (prot ${n(c, 2)}, flags 0x${flags.toString(16)}) from ${c.where?.(Number(c.x[30])) ?? 'native code'}: reserved in the process address space (pages are backed only when touched)`); const prot = n(c, 2), perms = `${prot & 1 ? 'r' : '-'}${prot & 2 ? 'w' : '-'}${prot & 4 ? 'x' : '-'}${flags & 1 ? 's' : 'p'}`, file = !(flags & 0x20) && fd >= 0 ? fds.get(fd) : null; const at = p.placeMapping(n(c, 0), length, flags, file?.path ?? '', perms); if (at < 0) return setErrno(p, -at); if (!(flags & 0x20) && fd >= 0) { const f = fds.get(fd); if (!f) return setErrno(p, EBADF); const data = contentOf(f).subarray(offset, offset + length); p.memory.copyIn(at, data); if (flags & 1) lib['shared-mapping'](p, { at, length, path: f.path, offset, writable: !!(n(c, 2) & 2) }); } return at; };
  lib.msync = (p, c) => { writeBack(p, n(c, 0), n(c, 1)); return 0; };
  lib.munmap = (p, c) => { const at = n(c, 0), length = n(c, 1); writeBack(p, at, length); p.unmapRegion?.(at, length); p.sharedMappings = (p.sharedMappings ?? []).filter(m => !(m.at >= at && m.at < at + length)); p.memory.invalidateCode?.(at, length); return 0; };
  // the protection is recorded for /proc/self/maps and statm (src/arm64/process.js protectRegion) but not enforced: an access the protection would refuse is not a fault here;
  // code in the range is decoded (and translated) again before it runs
  lib.mprotect = (p, c) => { p.memory.invalidateCode?.(n(c, 0), n(c, 1)); p.protectRegion?.(n(c, 0), n(c, 1), n(c, 2)); return 0; };
  lib.madvise = (p, c) => { if (n(c, 2) === 4) p.discardPages(n(c, 0), n(c, 1)); return 0; };   // MADV_DONTNEED: private anonymous pages read as zero afterwards (Linux); the other advice changes nothing a program can observe
  // mincore(addr, length, vec): one byte per page, bit 0 set for a resident page; ENOMEM when a page of the range is not mapped. The lab's memory has no swap or demand paging:
  // a page its protection makes accessible is resident, a PROT_NONE page is not (the rule /proc/self/statm counts by, src/process-memory.js)
  lib.mincore = (p, c) => {
    const start = n(c, 0), length = n(c, 1), vec = n(c, 2); if (start % 0x1000) return setErrno(p, EINVAL);
    const pages = Math.ceil(length / 0x1000), resident = [];
    for (let i = 0; i < pages; i++) { const state = p.pageState(start + i * 0x1000); if (state === null) return setErrno(p, ENOMEM); resident.push(state === 'none' ? 0 : 1); }
    p.memory.copyIn(vec, Uint8Array.from(resident)); return 0;
  };
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
  lib.fopen = lib.fopen64 = (p, c) => { const path = linked(p, str(p, x(c, 0))), mode = str(p, x(c, 1)); { const dev = deviceOf(path); if (dev) return newStream(p, { ...dev, offset: 0 }); } { const proc = procOf(p, path); if (proc) { if (proc.missing) return setErrno(p, ENOENT) && 0; if (proc.link) return newStream(p, { path: proc.link, data: proc.bytes() ?? new Uint8Array(0), offset: 0 }); if (proc.mem) return newStream(p, { path, mem: true, offset: 0 }); if (!mode.startsWith('r') || proc.names) return setErrno(p, proc.names ? EISDIR : EACCES) && 0; return newStream(p, { path, data: proc.data, offset: 0 }); } } const files = vfs(), exists = files.stat(path)?.type === 'file'; if (!exists && mode.startsWith('r')) return setErrno(p, ENOENT) && 0; if (exists && files.denied?.(path) || /^[wa]|\+/.test(mode) && files.isReadOnly(path)) return setErrno(p, EACCES) && 0; if (mode.startsWith('w') || !exists) files.setBytes(path, new Uint8Array(0)); return newStream(p, { path, offset: mode.startsWith('a') ? fileBytes(path).length : 0, append: mode.startsWith('a') }); };
  // a stream over a pipe or socket descriptor (fdopen, popen): reads fill a buffer kept with the stream, so a read that has to wait (BLOCKED, the call is retried) loses nothing
  const viaCpu = (p, c, fn, values) => { const saved = [c.x[0], c.x[1], c.x[2]]; values.forEach((v, i) => { c.x[i] = BigInt(v); }); try { return fn(p, c); } finally { [c.x[0], c.x[1], c.x[2]] = saved; } };
  const fillPipe = (p, c, s, enough) => {
    while (!s.eof && !s.error && !enough(s.buf)) {
      const tmp = p.malloc(4096), got = viaCpu(p, c, lib.read, [s.sockFd, tmp, 4096]);
      if (got === BLOCKED) { p.free(tmp); return BLOCKED; }
      const count = Number(BigInt.asIntN(64, BigInt(got)));
      if (count <= 0) { p.free(tmp); if (count === 0) s.eof = true; else s.error = true; break; }
      const next = new Uint8Array(s.buf.length + count); next.set(s.buf); next.set(p.memory.bytes(tmp, count), s.buf.length); s.buf = next; p.free(tmp);
    }
    return 0;
  };
  lib.fdopen = (p, c) => { const f = fds.get(n(c, 0)); if (!f && lib.__socketTable?.().objects.has(n(c, 0))) return newStream(p, { sockFd: n(c, 0), buf: new Uint8Array(0) }); if (!f) return setErrno(p, EBADF) && 0; return newStream(p, f.device ? { device: f.device, read: f.read, offset: 0 } : { path: f.path, data: f.data, offset: f.offset }); };
  lib.funopen = (p, c) => newStream(p, { cookie: n(c, 0), readfn: n(c, 1), writefn: n(c, 2), seekfn: n(c, 3), closefn: n(c, 4), offset: 0 });
  const streamRead = (p, s, dst, length) => {
    if (s.sockFd !== undefined) { const chunk = s.buf.subarray(0, length); p.memory.copyIn(dst, chunk); s.buf = s.buf.slice(chunk.length); return chunk.length; }   // filled by fillPipe first
    if (s.readfn) { let done = 0; while (done < length) { const got = Number(BigInt.asIntN(32, p.call(s.readfn, [s.cookie, dst + done, length - done]))); if (got <= 0) { if (got === 0) s.eof = true; else s.error = true; break; } done += got; } return done; }
    if (s.device) { const chunk = s.read(length); p.memory.copyIn(dst, chunk); if (chunk.length < length) s.eof = true; return chunk.length; }
    if (s.path === undefined) { s.eof = true; return 0; }
    if (s.mem) { const got = memRead(p, s, dst, length, s.offset); if (got < 0) { s.error = true; return 0; } s.offset += got; return got; }   // /proc/self/mem
    const data = contentOf(s), chunk = data.subarray(s.offset, s.offset + length); p.memory.copyIn(dst, chunk); s.offset += chunk.length; if (chunk.length < length) s.eof = true; return chunk.length;
  };
  const streamWrite = (p, s, src, length) => {
    if (s.sockFd !== undefined) { const c = p.activeCpu, got = viaCpu(p, c, lib.write, [s.sockFd, src, length]); return got === BLOCKED ? 0 : Number(BigInt.asIntN(64, BigInt(got))); }
    if (s.writefn) return Number(BigInt.asIntN(32, p.call(s.writefn, [s.cookie, src, length])));
    if (s.device) return length;
    if (s.log) { log(s.log === 1 ? 4 : 6, s.log === 1 ? 'stdout' : 'stderr', text(p.memory.bytes(src, length)).replace(/\n$/, '')); return length; }
    const bytes = p.memory.bytes(src, length).slice(), data = contentOf(s), at = s.append ? data.length : s.offset, next = new Uint8Array(Math.max(data.length, at + length)); next.set(data); next.set(bytes, at); store(p, s.path, next); s.offset = at + length; return length;
  };
  lib.fread = (p, c) => { const size = n(c, 1), count = n(c, 2); if (!size || !count) return 0; { const s = stream(p, x(c, 3)); if (s.sockFd !== undefined && fillPipe(p, c, s, buf => buf.length >= size * count) === BLOCKED) return BLOCKED; } return Math.floor(streamRead(p, stream(p, x(c, 3)), n(c, 0), size * count) / size); };
  lib.__fread_chk = (p, c) => {   // _FORTIFY_SOURCE's fread(buf, bufSize, size, count, stream): bionic aborts the process when the read could overflow the buffer
    const bufSize = n(c, 1), size = n(c, 2), count = n(c, 3);
    if (size * count > bufSize) throw new APKError(`FORTIFY: fread: prevented ${size * count}-byte write into ${bufSize}-byte buffer (bionic aborts the process here)`, { kind: 'arm64-abort' });
    return lib.fread(p, { x: [c.x[0], c.x[2], c.x[3], c.x[4]] });
  };
  lib.fwrite = (p, c) => { const size = n(c, 1), count = n(c, 2); if (!size || !count) return 0; return Math.floor(streamWrite(p, stream(p, x(c, 3)), n(c, 0), size * count) / size); };
  lib.fgets = (p, c) => { const dst = n(c, 0), max = s32(c, 1), s = stream(p, x(c, 2)); if (s.sockFd !== undefined && fillPipe(p, c, s, buf => buf.length >= max - 1 || buf.includes(10)) === BLOCKED) return BLOCKED; let i = 0; while (i < max - 1) { const tmp = p.malloc(1), got = streamRead(p, s, tmp, 1), ch = p.memory.byte(tmp); p.free(tmp); if (!got) break; p.memory.setByte(dst + i++, ch); if (ch === 10) break; } if (!i) return 0; p.memory.setByte(dst + i, 0); return dst; };
  // fscanf / vfscanf: sscanf's conversions (src/arm64/libc-extra.js) over the stream's unread bytes; the stream advances by what the conversions read. A stream without a position
  // the lab can move back (a device, a funopen stream, stdin) is refused by name rather than read past what the conversions use.
  const streamScan = (p, s, format, args) => {
    if (s.path === undefined || s.mem || s.device || s.readfn) throw new APKError(`ARM64 native code called fscanf on ${s.device ? 'a device stream' : s.readfn ? 'a funopen stream' : s.mem ? '/proc/self/mem' : 'a standard stream'}, which the lab cannot scan in place`, { kind: 'arm64-files' });
    const data = contentOf(s), { count, used } = lib['lab:scan'](p, text(data.subarray(s.offset)), format, args);
    s.offset = Math.min(data.length, s.offset + used); if (count < 0 || s.offset >= data.length) s.eof = s.offset >= data.length;
    return count;
  };
  lib.fscanf = (p, c) => BigInt.asUintN(64, BigInt(streamScan(p, stream(p, x(c, 0)), str(p, x(c, 1)), variadic(c, 2))));
  lib.vfscanf = (p, c) => BigInt.asUintN(64, BigInt(streamScan(p, stream(p, x(c, 0)), str(p, x(c, 1)), vaList(p.memory, n(c, 2)))));
  lib.fgetc = lib.getc = (p, c) => { { const s = stream(p, x(c, 0)); if (s.sockFd !== undefined && fillPipe(p, c, s, buf => buf.length >= 1) === BLOCKED) return BLOCKED; } const tmp = p.malloc(1), got = streamRead(p, stream(p, x(c, 0)), tmp, 1), ch = p.memory.byte(tmp); p.free(tmp); return got ? ch : 0xffffffffffffffffn; };
  lib.fputs = (p, c) => { const bytes = bytesOf(p, x(c, 0)), ptr = p.malloc(bytes.length + 1); p.memory.copyIn(ptr, bytes); streamWrite(p, stream(p, x(c, 1)), ptr, bytes.length); p.free(ptr); return 1; };
  lib.fputc = lib.putc = (p, c) => { const ptr = p.malloc(1); p.memory.setByte(ptr, n(c, 0) & 0xff); streamWrite(p, stream(p, x(c, 1)), ptr, 1); p.free(ptr); return n(c, 0) & 0xff; };
  lib.fseek = lib.fseeko = lib.fseeko64 = (p, c) => { const s = stream(p, x(c, 0)), off = Number(BigInt.asIntN(64, x(c, 1))), whence = n(c, 2); if (s.seekfn) { const r = Number(BigInt.asIntN(64, p.call(s.seekfn, [s.cookie, BigInt.asUintN(64, BigInt(off)), whence]))); if (r < 0) return -1; s.offset = r; s.eof = false; return 0; } if (s.path === undefined) return setErrno(p, 29); s.offset = whence === 0 ? off : whence === 1 ? s.offset + off : contentOf(s).length + off; s.eof = false; return 0; };
  lib.ftell = lib.ftello = lib.ftello64 = (p, c) => stream(p, x(c, 0)).offset;
  lib.rewind = (p, c) => { const s = stream(p, x(c, 0)); s.offset = 0; s.eof = false; };
  lib.feof = (p, c) => stream(p, x(c, 0)).eof ? 1 : 0;
  lib.ferror = (p, c) => stream(p, x(c, 0)).error ? 1 : 0;
  lib.clearerr = (p, c) => { const s = stream(p, x(c, 0)); s.eof = false; s.error = false; };
  lib.fileno = (p, c) => { const s = stream(p, x(c, 0)); if (s.log) return s.log; if (s.sockFd !== undefined) return s.sockFd; const fd = nextFd++; fds.set(fd, { path: s.path, offset: s.offset }); return fd; };
  lib.fclose = (p, c) => { const ptr = n(c, 0), s = stream(p, ptr); let r = 0; if (s.closefn) r = Number(BigInt.asIntN(32, p.call(s.closefn, [s.cookie]))); if (s.sockFd !== undefined) r = Number(BigInt.asIntN(64, BigInt(viaCpu(p, c, lib.close, [s.sockFd])))); streams.delete(ptr); p.free(ptr); return r; };
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
  addJavaDescriptors(lib, { runtime, fds, setErrno, n });   // descriptors Java opened, used by native code (below)
  lib.__errno_location = lib.__errno;
  void ENOMEM; void EAGAIN; void ERANGE;
  // processes: fork / vfork / clone without CLONE_VM, wait4, the exec family and system / posix_spawn over the lab's process kernel (src/arm64/processes.js)
  return addProcesses(addGles(extendLibc(lib, { runtime, fs, clock, assets }), { runtime }), { runtime, childLibc: () => createLibc({ runtime, properties, fs, clock, assets }) });   // libEGL, libGLESv2 / v3 and ANativeWindow: src/arm64/gles.js
}

/**
 * The descriptors of the process that Java opened (libcore's table, src/libcore-io-native.js). On a device Java and native code share one kernel descriptor table, so
 * a descriptor Java hands to native code (FileDescriptor.getInt$, ParcelFileDescriptor.getFd, a RandomAccessFile's fd) reads, writes, seeks, truncates, stats, maps and
 * closes the very file Java opened, with the same file offset. The ARM64 process's own descriptors (`fds`: open() in native code) keep their numbers; a number in neither
 * table is EBADF, as before; the standard streams (0 to 2) stay the process's own. Shared mappings of the file (Java's or a lab-built library's, runtime.fileMappings) reach the file before it is read and are refreshed after
 * it changes, as the libcore natives do. A Java descriptor that is not a regular file or a directory (a pipe, a socket, a standard stream) fails by name.
 */
function addJavaDescriptors(lib, { runtime, fds, setErrno, n }) {
  const EBADF = 9, EINVAL = 22, EISDIR = 21, ESPIPE = 29, ENODEV = 19, ACC = 3, RDONLY = 0, WRONLY = 1;
  const files = () => runtime.platform.javaIo.fs();
  let streamInodes = 0;   // the inode numbers sockfs and pipefs give, one per description
  const entryOf = fd => fd <= 2 || fds.has(fd) ? null : runtime?.libcoreIo?.table.get(fd) ?? null;   // 0 to 2 (stdin, stdout, stderr) stay with the process's own functions (the log)
  const flush = node => runtime.fileMappings?.flushNode(node), refresh = node => runtime.fileMappings?.refreshNode(node);
  /** The open file behind Java descriptor `fd` for `op`: { desc } or { errno } (`need`: 'read' or 'write' access, or null). */
  const usable = (fd, entry, op, need) => {
    const desc = entry.desc;
    if (desc.kind === 'closed') return { errno: EBADF };
    if (desc.kind === 'socket' || desc.kind === 'pipe') {   // a socket or pipe: its reads and writes are the socket layer's (src/arm64/java-sockets.js); what a stream has no file meaning for answers as the kernel does
      if (op === 'fstat') return { desc, stream: true };
      if (op === 'pread' || op === 'pwrite' || op === 'lseek') return { errno: 29 };   // ESPIPE
      if (op === 'mmap') return { errno: 19 };   // ENODEV
      return { errno: EINVAL };   // ftruncate, fsync on a socket or pipe
    }
    if (desc.kind !== 'file' && desc.kind !== 'dir') throw new APKError(`ARM64 native code called ${op} on descriptor ${fd}, which Java opened as a ${desc.kind === 'std' ? 'standard stream' : desc.kind}: native I/O on such a descriptor is not provided by the lab`, { kind: 'arm64-files' });
    const acc = desc.acc & ACC;
    if (desc.kind === 'dir' && need !== null) return { errno: need === 'read' ? EISDIR : EBADF };
    if ((need === 'read' && acc === WRONLY) || (need === 'write' && acc === RDONLY)) return { errno: EBADF };
    return { desc };
  };
  const readAt = (p, desc, target, count, at) => {
    const node = desc.node; flush(node);
    if (at >= node.size || count <= 0) return 0;
    const length = Math.min(count, node.size - at), chunk = new Uint8Array(length); files().readAt(node, at, chunk, 0, length); p.memory.copyIn(target, chunk); return length;
  };
  const writeAt = (p, desc, source, count, at) => { const node = desc.node; flush(node); files().writeAt(node, at, p.memory.bytes(source, count).slice(), 0, count); refresh(node); return count; };
  // each function takes the descriptor in x0; a number the ARM64 process owns, or one Java does not have, goes to the process's own function
  const wrap = (names, op) => { const own = lib[names[0]]; const fn = (p, c) => { const fd = n(c, 0), entry = entryOf(fd); return entry ? op(p, c, fd, entry) : own(p, c); }; for (const name of names) lib[name] = fn; };
  wrap(['read'], (p, c, fd, entry) => { const u = usable(fd, entry, 'read', 'read'); if (u.errno) return setErrno(p, u.errno); const got = readAt(p, u.desc, n(c, 1), n(c, 2), u.desc.offset); u.desc.offset += got; return got; });
  wrap(['pread', 'pread64'], (p, c, fd, entry) => { const u = usable(fd, entry, 'pread', 'read'); if (u.errno) return setErrno(p, u.errno); return readAt(p, u.desc, n(c, 1), n(c, 2), n(c, 3)); });
  wrap(['write'], (p, c, fd, entry) => { const u = usable(fd, entry, 'write', 'write'); if (u.errno) return setErrno(p, u.errno); const at = u.desc.append ? u.desc.node.size : u.desc.offset, wrote = writeAt(p, u.desc, n(c, 1), n(c, 2), at); u.desc.offset = at + wrote; return wrote; });
  wrap(['pwrite', 'pwrite64'], (p, c, fd, entry) => { const u = usable(fd, entry, 'pwrite', 'write'); if (u.errno) return setErrno(p, u.errno); return writeAt(p, u.desc, n(c, 1), n(c, 2), n(c, 3)); });
  wrap(['lseek', 'lseek64'], (p, c, fd, entry) => {
    const u = usable(fd, entry, 'lseek', null); if (u.errno) return setErrno(p, u.errno);
    if (u.desc.kind !== 'file') return setErrno(p, ESPIPE);
    const whence = n(c, 2), offset = Number(BigInt.asIntN(64, c.x[1])), origin = whence === 0 ? 0 : whence === 1 ? u.desc.offset : whence === 2 ? u.desc.node.size : -1;
    if (origin < 0 || origin + offset < 0) return setErrno(p, EINVAL);
    u.desc.offset = origin + offset; return u.desc.offset;
  });
  wrap(['ftruncate', 'ftruncate64'], (p, c, fd, entry) => {   // as libcore's ftruncate of the same file: EINVAL for a descriptor not open for writing or a negative length
    const u = usable(fd, entry, 'ftruncate', null); if (u.errno) return setErrno(p, u.errno);
    const length = Number(BigInt.asIntN(64, c.x[1])), node = u.desc.node;
    if (u.desc.kind !== 'file' || (u.desc.acc & ACC) === RDONLY || length < 0) return setErrno(p, EINVAL);
    flush(node);
    if (length < node.size) { node.size = length; node.mtime = files().now(); } else if (length > node.size) files().writeAt(node, length, new Uint8Array(0), 0, 0);
    refresh(node); return 0;
  });
  wrap(['fstat', 'fstat64'], (p, c, fd, entry) => {   // bionic's arm64 struct stat: st_dev @0, st_mode @16, st_nlink @20, st_uid @24, st_gid @28, st_size @48, st_blksize @56, st_blocks @64, st_atim/st_mtim/st_ctim @72/88/104
    const u = usable(fd, entry, 'fstat', null); if (u.errno) return setErrno(p, u.errno);
    if (u.stream) {   // a socket (S_IFSOCK, 0777 as sockfs gives) or a pipe (S_IFIFO, 0600): no size, st_blksize 4096
      const out = n(c, 1), uid = runtime.platform?.virtualProcess?.uid ?? 10000, mode = u.desc.kind === 'socket' ? 0o140777 : 0o10600, size = u.desc.kind === 'pipe' ? u.desc.pipe.size : 0;
      p.memory.fill(out, 0, 128); p.memory.write64(out, u.desc.kind === 'socket' ? 0x8n : 0xcn); p.memory.write64(out + 8, BigInt(u.desc.ino ??= 0x10000 + (++streamInodes)));
      p.memory.writeU32(out + 16, mode); p.memory.writeU32(out + 20, 1); p.memory.writeU32(out + 24, uid); p.memory.writeU32(out + 28, uid); p.memory.write64(out + 48, BigInt(size)); p.memory.writeU32(out + 56, 4096);
      return 0;
    }
    const node = u.desc.node, out = n(c, 1), uid = runtime.platform?.virtualProcess?.uid ?? 10000; flush(node);
    const size = node.type === 'file' ? node.size : 4096, mtime = node.mtime ?? 0;
    p.memory.fill(out, 0, 128); p.memory.write64(out, 0xfd00n); p.memory.writeU32(out + 16, (node.type === 'dir' ? 0o40000 : 0o100000) | ((node.mode ?? 0o600) & 0o7777)); p.memory.writeU32(out + 20, node.type === 'dir' ? 2 : 1);
    p.memory.writeU32(out + 24, uid); p.memory.writeU32(out + 28, uid); p.memory.write64(out + 48, BigInt(size)); p.memory.writeU32(out + 56, 4096); p.memory.write64(out + 64, BigInt(Math.ceil(size / 512)));
    for (const at of [72, 88, 104]) { p.memory.write64(out + at, BigInt(Math.floor(mtime / 1000))); p.memory.write64(out + at + 8, BigInt(Math.floor(mtime % 1000) * 1000000)); }
    return 0;
  });
  wrap(['fsync', 'fdatasync'], (p, c, fd, entry) => { const u = usable(fd, entry, 'fsync', null); if (u.errno) return setErrno(p, u.errno); flush(u.desc.node); return 0; });   // the file system is memory: stable once the mappings reached it
  wrap(['close'], (p, c, fd, entry) => { if (entry.desc.kind === 'closed') return setErrno(p, EBADF); release(runtime, fd); return 0; });   // the process's descriptor: closed for Java too, as on a device
  { // mmap(addr, length, prot, flags, fd, offset): the descriptor is x4; a MAP_ANONYMOUS mapping ignores it
    const own = lib.mmap;
    lib.mmap = lib.mmap64 = (p, c) => {
      const flags = n(c, 3), fd = Number(BigInt.asIntN(32, c.x[4])), entry = !(flags & 0x20) && fd >= 0 ? entryOf(fd) : null;
      if (!entry) return own(p, c);
      const u = usable(fd, entry, 'mmap', null); if (u.errno) return setErrno(p, u.errno);
      if (u.desc.kind !== 'file') return setErrno(p, ENODEV);
      const length = n(c, 1), offset = n(c, 5), node = u.desc.node, at = p.placeMapping(n(c, 0), length, flags, u.desc.path ?? "", `${n(c, 2) & 1 ? "r" : "-"}${n(c, 2) & 2 ? "w" : "-"}${n(c, 2) & 4 ? "x" : "-"}${flags & 1 ? "s" : "p"}`); if (at < 0) return setErrno(p, -at); flush(node);   // /proc/self/maps names the file
      const chunk = new Uint8Array(Math.max(0, Math.min(length, node.size - offset))); if (chunk.length) files().readAt(node, offset, chunk, 0, chunk.length); p.memory.copyIn(at, chunk);
      if (flags & 1) lib['shared-mapping'](p, { at, length, path: u.desc.path, node, offset, writable: !!(n(c, 2) & 2) && (u.desc.acc & ACC) !== RDONLY });   // MAP_SHARED: one with the file and its other mappings
      return at;
    };
  }
}
