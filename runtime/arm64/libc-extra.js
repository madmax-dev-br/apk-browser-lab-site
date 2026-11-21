// More of bionic for the ARM64 process (src/arm64/libc.js has the core): locales and wide characters as bionic has them (one UTF-8 "C.UTF-8" locale, which
// libc++ initializes at start-up), time conversion, sorting and searching (comparators run as native code), sscanf, setjmp/longjmp, directories and paths,
// process limits and identity, and more of libm. Sockets and event-loop primitives (poll, epoll, eventfd) are not here: they fail by name.
import { APKError } from '../apk-error.js?v=6954cacca256';
import { formatC, variadic, vaList } from './libc.js?v=6954cacca256';
import { addSockets } from './sockets.js?v=6954cacca256';
import { addMoreLibc } from './libc-more.js?v=6954cacca256';
import { addSyscalls } from './syscalls.js?v=6954cacca256';
import { addSignals } from './signals.js?v=6954cacca256';
import { utf8 } from './text.js?v=6954cacca256';

const ENOENT = 2, EINVAL = 22, ENOTDIR = 20, EEXIST = 17;
const decoder = utf8, encoder = new TextEncoder();

export function extendLibc(lib, { runtime, fs = () => null, clock = () => Date.now(), assets = null } = {}) {
  const x = (c, i) => c.x[i], n = (c, i) => Number(c.x[i]), s32 = (c, i) => Number(BigInt.asIntN(32, c.x[i]));
  const str = (p, ptr) => decoder.decode(p.memory.cString(Number(ptr)));
  const setErrno = (p, value) => { p.memory.writeU32(p.errnoAddress, value); return 0xffffffffffffffffn; };
  const vfs = () => fs() ?? (() => { throw new APKError('ARM64 native code used the file system, which is not available here', { kind: 'arm64-files' }); })();
  const putString = (p, dst, size, text) => { const bytes = encoder.encode(text), k = Math.min(bytes.length, Number(size) - 1); if (Number(size) > 0) { p.memory.copyIn(Number(dst), bytes.subarray(0, k)); p.memory.setByte(Number(dst) + k, 0); } return bytes.length; };

  // ---- locales: bionic has one locale (C.UTF-8); newlocale returns a handle to it, the _l functions ignore their locale argument
  const LOCALE = 0x7c0000000010;
  lib.setlocale = (p) => { p.localeName ??= p.allocString('C.UTF-8'); return p.localeName; };
  lib.newlocale = () => LOCALE; lib.duplocale = () => LOCALE; lib.freelocale = () => {};
  lib.uselocale = () => 0xffffffffffffffffn;   // LC_GLOBAL_LOCALE
  lib.__ctype_get_mb_cur_max = () => 4;
  lib.localeconv = p => { if (!p.lconv) { const l = p.malloc(96), dot = p.allocString('.'), empty = p.allocString(''); p.memory.fill(l, 0, 96); p.memory.writePtr(l, dot); for (let i = 1; i < 10; i++) p.memory.writePtr(l + 8 * i, empty); p.memory.fill(l + 80, 0x7f, 14); p.lconv = l; } return p.lconv; };
  for (const name of ['strtoll_l', 'strtoull_l', 'strtold_l', 'strtof_l', 'strtod_l']) { const base = name.replace('_l', ''); lib[name] = (p, c) => lib[base](p, c); }
  lib.strcoll = lib.strcoll_l = (p, c) => lib.strcmp(p, c);
  lib.strxfrm = lib.strxfrm_l = (p, c) => { const src = p.memory.cString(n(c, 1)), size = n(c, 2); if (size > src.length) { p.memory.copyIn(n(c, 0), src.slice()); p.memory.setByte(n(c, 0) + src.length, 0); } return src.length; };
  for (const [name, test] of Object.entries({ isalpha: /[A-Za-z]/, isdigit: /[0-9]/, isxdigit: /[0-9A-Fa-f]/, isupper: /[A-Z]/, islower: /[a-z]/, isspace: /[ \t\n\v\f\r]/, isprint: /[ -~]/, ispunct: /[!-\/:-@\[-`{-~]/, iscntrl: /[\x00-\x1f\x7f]/, isblank: /[ \t]/, isalnum: /[A-Za-z0-9]/ })) {
    const fn = (p, c) => { const code = n(c, 0); return code >= 0 && code < 0x110000 && (code > 127 ? (name === 'isprint' || name === 'isalpha' || name === 'isalnum') && !/\p{C}/u.test(String.fromCodePoint(code)) : test.test(String.fromCharCode(code))) ? 1 : 0; };
    lib[name + '_l'] = fn; lib['isw' + name.slice(2)] = fn; lib['isw' + name.slice(2) + '_l'] = fn;
  }
  lib.towupper = lib.towupper_l = (p, c) => { const s = String.fromCodePoint(n(c, 0)).toUpperCase(); return [...s].length === 1 ? s.codePointAt(0) : n(c, 0); };
  lib.towlower = lib.towlower_l = (p, c) => { const s = String.fromCodePoint(n(c, 0)).toLowerCase(); return [...s].length === 1 ? s.codePointAt(0) : n(c, 0); };
  lib.toupper_l = lib.toupper; lib.tolower_l = lib.tolower;
  // ---- multibyte / wide characters (UTF-8, wchar_t = 32 bits)
  const utf8Length = b => b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : -1;
  const decodeAt = (p, ptr, max) => { const b0 = p.memory.byte(ptr); if (max < 1) return [-2, 0]; const len = utf8Length(b0); if (len < 0) return [-1, 0]; if (len > max) return [-2, 0]; let cp = len === 1 ? b0 : b0 & (0xff >> (len + 1)); for (let i = 1; i < len; i++) { const b = p.memory.byte(ptr + i); if ((b & 0xc0) !== 0x80) return [-1, 0]; cp = (cp << 6) | (b & 0x3f); } return [len, cp]; };
  const encodeCp = cp => encoder.encode(String.fromCodePoint(cp));
  lib.mbrtowc = (p, c) => { const dst = n(c, 0), src = n(c, 1), max = n(c, 2); if (!src) return 0; const [len, cp] = decodeAt(p, src, max); if (len === -1) { setErrno(p, 84); return 0xffffffffffffffffn; } if (len === -2) return 0xfffffffffffffffen; if (dst) p.memory.writeU32(dst, cp); return cp === 0 ? 0 : len; };
  lib.mbtowc = (p, c) => { if (!n(c, 1)) return 0; const [len, cp] = decodeAt(p, n(c, 1), n(c, 2)); if (len < 0) return 0xffffffffffffffffn; if (n(c, 0)) p.memory.writeU32(n(c, 0), cp); return cp === 0 ? 0 : len; };
  lib.mbrlen = (p, c) => { const [len] = decodeAt(p, n(c, 0), n(c, 1)); return len === -1 ? 0xffffffffffffffffn : len === -2 ? 0xfffffffffffffffen : len; };
  lib.wcrtomb = (p, c) => { if (!n(c, 0)) return 1; const cp = n(c, 1); if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) { setErrno(p, 84); return 0xffffffffffffffffn; } const bytes = encodeCp(cp); p.memory.copyIn(n(c, 0), bytes); return bytes.length; };
  lib.wctomb = (p, c) => lib.wcrtomb(p, c);
  lib.btowc = (p, c) => { const b = s32(c, 0); return b >= 0 && b < 0x80 ? b : 0xffffffffn; };
  lib.wctob = (p, c) => { const w = n(c, 0); return w < 0x80 ? w : 0xffffffffffffffffn; };
  lib.mbsinit = () => 1;
  const mbsConvert = (p, dst, srcPtr, nms, len) => { let src = p.memory.readPtr(srcPtr), count = 0; const end = nms === Infinity ? Infinity : src + nms; while (count < len && src < end) { const [l, cp] = decodeAt(p, src, end - src); if (l === -1) { setErrno(p, 84); return 0xffffffffffffffffn; } if (l === -2) break; if (cp === 0) { if (dst) { p.memory.writeU32(dst + 4 * count, 0); p.memory.writePtr(srcPtr, 0); } return count; } if (dst) p.memory.writeU32(dst + 4 * count, cp); src += l; count++; } if (dst) p.memory.writePtr(srcPtr, src); return count; };
  lib.mbsrtowcs = (p, c) => mbsConvert(p, n(c, 0), n(c, 1), Infinity, n(c, 0) ? n(c, 2) : Infinity);
  lib.mbsnrtowcs = (p, c) => mbsConvert(p, n(c, 0), n(c, 1), n(c, 2), n(c, 0) ? n(c, 3) : Infinity);
  lib.mbstowcs = (p, c) => { const holder = p.malloc(8); p.memory.writePtr(holder, n(c, 1)); const r = mbsConvert(p, n(c, 0), holder, Infinity, n(c, 0) ? n(c, 2) : Infinity); p.free(holder); return r; };
  const wcsConvert = (p, dst, srcPtr, nwc, len) => { let src = p.memory.readPtr(srcPtr), written = 0; for (let i = 0; i < nwc; i++) { const cp = p.memory.readU32(src); if (cp === 0) { if (dst) { if (written < len) p.memory.setByte(dst + written, 0); p.memory.writePtr(srcPtr, 0); } return written; } const bytes = encodeCp(cp); if (dst && written + bytes.length > len) break; if (dst) p.memory.copyIn(dst + written, bytes); written += bytes.length; src += 4; } if (dst) p.memory.writePtr(srcPtr, src); return written; };
  lib.wcsrtombs = (p, c) => wcsConvert(p, n(c, 0), n(c, 1), Infinity, n(c, 0) ? n(c, 2) : Infinity);
  lib.wcsnrtombs = (p, c) => wcsConvert(p, n(c, 0), n(c, 1), n(c, 2), n(c, 0) ? n(c, 3) : Infinity);
  lib.wcstombs = (p, c) => { const holder = p.malloc(8); p.memory.writePtr(holder, n(c, 1)); const r = wcsConvert(p, n(c, 0), holder, Infinity, n(c, 0) ? n(c, 2) : Infinity); p.free(holder); return r; };
  lib.wcslen = (p, c) => { let i = 0; while (p.memory.readU32(n(c, 0) + 4 * i)) i++; return i; };
  lib.wcscmp = (p, c) => { for (let i = 0; ; i++) { const a = p.memory.readU32(n(c, 0) + 4 * i), b = p.memory.readU32(n(c, 1) + 4 * i); if (a !== b) return a < b ? 0xffffffffffffffffn : 1; if (!a) return 0; } };
  lib.wcscoll = lib.wcscoll_l = lib.wcscmp;
  lib.wcsxfrm = lib.wcsxfrm_l = (p, c) => { const len = Number(lib.wcslen(p, { x: [c.x[1]] })); if (n(c, 2) > len) p.memory.copyIn(n(c, 0), p.memory.bytes(n(c, 1), 4 * (len + 1)).slice()); return len; };
  lib.wmemchr = (p, c) => { for (let i = 0; i < n(c, 2); i++) if (p.memory.readU32(n(c, 0) + 4 * i) === n(c, 1)) return n(c, 0) + 4 * i; return 0; };
  lib.wmemcmp = (p, c) => { for (let i = 0; i < n(c, 2); i++) { const a = p.memory.readU32(n(c, 0) + 4 * i), b = p.memory.readU32(n(c, 1) + 4 * i); if (a !== b) return a < b ? 0xffffffffffffffffn : 1; } return 0; };
  lib.wmemcpy = lib.wmemmove = (p, c) => { if (n(c, 2)) p.memory.copyIn(n(c, 0), p.memory.bytes(n(c, 1), 4 * n(c, 2)).slice()); return n(c, 0); };
  lib.wmemset = (p, c) => { for (let i = 0; i < n(c, 2); i++) p.memory.writeU32(n(c, 0) + 4 * i, n(c, 1)); return n(c, 0); };
  const wideString = (p, ptr) => { let out = '', i = 0; for (let cp; (cp = p.memory.readU32(ptr + 4 * i)); i++) out += String.fromCodePoint(cp); return out; };
  const wideNumber = (p, c, parse) => { const s = wideString(p, n(c, 0)), m = parse(s); if (n(c, 1)) p.memory.writePtr(n(c, 1), n(c, 0) + 4 * m.length); return m.value; };
  for (const name of ['wcstol', 'wcstoll', 'wcstoul', 'wcstoull']) lib[name] = (p, c) => wideNumber(p, c, s => { const m = /^\s*[+-]?(0x)?[0-9a-fA-F]*/.exec(s), base = n(c, 2) || (m[1] ? 16 : 10), t = m[0].trim(); const v = BigInt(parseInt(t, base) || 0); return { length: m[0].length, value: BigInt.asUintN(64, v) }; });
  for (const name of ['wcstod', 'wcstof', 'wcstold']) lib[name] = (p, c) => ({ double: wideNumber(p, c, s => { const m = /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s); return { length: m ? m[0].length : 0, value: m ? parseFloat(m[0]) : 0 }; }) });
  lib.swprintf = (p, c) => { const s = formatC(p.memory, wideString(p, n(c, 2)), variadic(c, 3)), max = n(c, 1), cps = [...s].map(ch => ch.codePointAt(0)); const k = Math.min(cps.length, max - 1); cps.slice(0, k).forEach((cp, i) => p.memory.writeU32(n(c, 0) + 4 * i, cp)); p.memory.writeU32(n(c, 0) + 4 * k, 0); return cps.length < max ? cps.length : 0xffffffffffffffffn; };
  // ---- time
  const tmWrite = (p, ptr, date, utc, gmtoff = 0, zone = 'UTC') => {
    const get = k => utc ? date[`getUTC${k}`]() : date[`get${k}`](), start = utc ? Date.UTC(get('FullYear'), 0, 1) : new Date(get('FullYear'), 0, 1).getTime();
    const fields = [get('Seconds'), get('Minutes'), get('Hours'), get('Date'), get('Month'), get('FullYear') - 1900, get('Day'), Math.floor((date.getTime() - start) / 86400000), 0];
    fields.forEach((v, i) => p.memory.writeU32(ptr + 4 * i, v)); p.memory.write64(ptr + 40, BigInt(gmtoff)); p.memory.writePtr(ptr + 48, p.zoneName ??= p.allocString(zone)); return ptr;
  };
  const tmRead = (p, ptr) => { const f = i => p.memory.int32(ptr + 4 * i); return { sec: f(0), min: f(1), hour: f(2), mday: f(3), mon: f(4), year: f(5) + 1900, wday: f(6), yday: f(7) }; };
  // the device's time zone is the VM's (java.util.TimeZone default), which the browser models; native local time uses the same offset at that instant
  const offsetAt = ms => { try { const zone = runtime?.platform?.device?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone; const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(ms)).find(x => x.type === 'timeZoneName')?.value ?? 'GMT'; const m = /([+-])(\d\d):?(\d\d)?/.exec(parts); return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 3600 + Number(m[3] ?? 0) * 60) : 0; } catch { return 0; } };
  lib.gmtime_r = (p, c) => tmWrite(p, n(c, 1), new Date(Number(BigInt.asIntN(64, p.memory.read64(n(c, 0)))) * 1000), true);
  lib.gmtime = (p, c) => { p.tmBuffer ??= p.malloc(64); c.x[1] = BigInt(p.tmBuffer); return lib.gmtime_r(p, c); };
  lib.localtime_r = (p, c) => { const ms = Number(BigInt.asIntN(64, p.memory.read64(n(c, 0)))) * 1000, off = offsetAt(ms); return tmWrite(p, n(c, 1), new Date(ms + off * 1000), true, off, 'local'); };
  lib.localtime = (p, c) => { p.tmBuffer ??= p.malloc(64); c.x[1] = BigInt(p.tmBuffer); return lib.localtime_r(p, c); };
  lib.timegm = (p, c) => { const t = tmRead(p, n(c, 0)); return BigInt.asUintN(64, BigInt(Math.floor(Date.UTC(t.year, t.mon, t.mday, t.hour, t.min, t.sec) / 1000))); };
  lib.mktime = (p, c) => { const t = tmRead(p, n(c, 0)), utc = Date.UTC(t.year, t.mon, t.mday, t.hour, t.min, t.sec), off = offsetAt(utc); return BigInt.asUintN(64, BigInt(Math.floor((utc - off * 1000) / 1000))); };
  lib.tzset = () => {}; lib.difftime = (p, c) => ({ double: Number(BigInt.asIntN(64, x(c, 0)) - BigInt.asIntN(64, x(c, 1))) });
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  lib.strftime = lib.strftime_l = (p, c) => {
    const t = tmRead(p, n(c, 3)), pad = (v, w = 2, ch = '0') => String(v).padStart(w, ch);
    const out = str(p, x(c, 2)).replace(/%([a-zA-Z%])/g, (_, k) => ({ a: DAYS[t.wday]?.slice(0, 3), A: DAYS[t.wday], b: MONTHS[t.mon]?.slice(0, 3), h: MONTHS[t.mon]?.slice(0, 3), B: MONTHS[t.mon], d: pad(t.mday), e: pad(t.mday, 2, ' '), H: pad(t.hour), I: pad(t.hour % 12 || 12), j: pad(t.yday + 1, 3), m: pad(t.mon + 1), M: pad(t.min), p: t.hour < 12 ? 'AM' : 'PM', S: pad(t.sec), y: pad(t.year % 100), Y: t.year, Z: 'GMT', z: '+0000', '%': '%', F: `${t.year}-${pad(t.mon + 1)}-${pad(t.mday)}`, T: `${pad(t.hour)}:${pad(t.min)}:${pad(t.sec)}`, D: `${pad(t.mon + 1)}/${pad(t.mday)}/${pad(t.year % 100)}`, R: `${pad(t.hour)}:${pad(t.min)}`, n: '\n', t: '\t', u: t.wday || 7, w: t.wday, s: Math.floor(Date.UTC(t.year, t.mon, t.mday, t.hour, t.min, t.sec) / 1000), c: `${DAYS[t.wday]?.slice(0, 3)} ${MONTHS[t.mon]?.slice(0, 3)} ${pad(t.mday, 2, ' ')} ${pad(t.hour)}:${pad(t.min)}:${pad(t.sec)} ${t.year}` }[k] ?? `%${k}`));
    const bytes = encoder.encode(out); if (bytes.length >= n(c, 1)) return 0; p.memory.copyIn(n(c, 0), bytes); p.memory.setByte(n(c, 0) + bytes.length, 0); return bytes.length;
  };
  // ---- sort / search with native comparators
  lib.qsort = (p, c) => {
    const base = n(c, 0), count = n(c, 1), size = n(c, 2), compare = n(c, 3); if (count < 2) return;
    const items = Array.from({ length: count }, (_, i) => p.memory.bytes(base + i * size, size).slice()), a = p.malloc(size), b = p.malloc(size);
    items.sort((l, r) => { p.memory.copyIn(a, l); p.memory.copyIn(b, r); return Number(BigInt.asIntN(32, p.call(compare, [a, b]))); });
    items.forEach((item, i) => p.memory.copyIn(base + i * size, item)); p.free(a); p.free(b);
  };
  lib.bsearch = (p, c) => { const key = n(c, 0), base = n(c, 1), size = n(c, 3), compare = n(c, 4); let lo = 0, hi = n(c, 2) - 1; while (lo <= hi) { const mid = (lo + hi) >> 1, r = Number(BigInt.asIntN(32, p.call(compare, [key, base + mid * size]))); if (r === 0) return base + mid * size; if (r < 0) hi = mid - 1; else lo = mid + 1; } return 0; };
  let seed = 1; lib.srand = (p, c) => { seed = n(c, 0) >>> 0; }; lib.rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 1) & 0x7fffffff; };
  lib.random = lib.rand; lib.srandom = lib.srand; lib.lrand48 = lib.rand; lib.srand48 = lib.srand;
  // ---- sscanf (the conversions libraries parse with: integers, floats, strings, characters, scansets, %n)
  const scan = (p, input, format, out) => {
    let i = 0, count = 0; const s = input;
    for (let f = 0; f < format.length; f++) {
      const ch = format[f];
      if (/\s/.test(ch)) { while (/\s/.test(s[i] ?? '')) i++; continue; }
      if (ch !== '%') { if (s[i] !== ch) return count; i++; continue; }
      const m = /^(\*)?(\d+)?(hh|h|ll|l|z|j|L)?([diouxXfFeEgGsc%n]|\[[^\]]*\])/.exec(format.slice(f + 1)); if (!m) return count;
      f += m[0].length; const [, skip, widthRaw, length, conv] = m, width = widthRaw ? Number(widthRaw) : Infinity;
      if (conv === '%') { if (s[i] !== '%') return count; i++; continue; }
      if (conv === 'n') { if (!skip) p.memory.writeU32(Number(out.int()), new TextEncoder().encode(s.slice(0, i)).length); continue; }
      if (conv !== 'c' && !conv.startsWith('[')) while (/\s/.test(s[i] ?? '')) i++;
      if (i >= s.length) return count || -1;
      let token;
      if (conv === 'c') { token = s.slice(i, i + (widthRaw ? width : 1)); i += token.length; if (!skip) p.memory.copyIn(Number(out.int()), encoder.encode(token)); count += skip ? 0 : 1; continue; }
      if (conv === 's' || conv.startsWith('[')) {
        const set = conv.startsWith('[') ? conv.slice(1, -1) : null, negate = set?.startsWith('^'), members = set ? (negate ? set.slice(1) : set) : '';
        const ok = c2 => set ? (negate ? !members.includes(c2) : members.includes(c2)) : !/\s/.test(c2);
        let j = i; while (j < s.length && j - i < width && ok(s[j])) j++; token = s.slice(i, j); if (!token.length) return count; i = j;
        if (!skip) { const ptr = Number(out.int()); p.memory.copyIn(ptr, encoder.encode(token)); p.memory.setByte(ptr + encoder.encode(token).length, 0); count++; } continue;
      }
      const re = /[diouxX]/.test(conv) ? (conv === 'x' || conv === 'X' ? /^[+-]?(0[xX])?[0-9a-fA-F]+/ : conv === 'o' ? /^[+-]?[0-7]+/ : conv === 'i' ? /^[+-]?(0[xX][0-9a-fA-F]+|0[0-7]*|[1-9]\d*)/ : /^[+-]?\d+/) : /^[+-]?(?:inf(?:inity)?|nan|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/i;
      const mm = re.exec(s.slice(i, i + (width === Infinity ? s.length : width))); if (!mm) return count; i += mm[0].length;
      if (skip) continue;
      const ptr = Number(out.int());
      if (/[diouxX]/.test(conv)) { const t = mm[0], radix = conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : conv === 'i' ? (/^[+-]?0[xX]/.test(t) ? 16 : /^[+-]?0\d/.test(t) ? 8 : 10) : 10; const v = BigInt(parseInt(t, radix)); const bytes = length === 'll' || length === 'l' || length === 'z' || length === 'j' ? 8 : length === 'h' ? 2 : length === 'hh' ? 1 : 4; p.memory.write(ptr, BigInt.asUintN(bytes * 8, v), bytes); }
      else { const v = parseFloat(mm[0].replace(/inf(inity)?/i, 'Infinity')); if (length === 'l' || length === 'L') p.memory.setFloat64(ptr, v); else p.memory.setFloat32(ptr, v); }
      count++;
    }
    return count;
  };
  lib.sscanf = (p, c) => BigInt.asUintN(64, BigInt(scan(p, str(p, x(c, 0)), str(p, x(c, 1)), variadic(c, 2))));
  lib.vsscanf = (p, c) => BigInt.asUintN(64, BigInt(scan(p, str(p, x(c, 0)), str(p, x(c, 1)), vaList(p.memory, n(c, 2)))));
  // ---- setjmp / longjmp: the callee-saved state (x19-x30, sp, d8-d15) in the jmp_buf
  const save = (p, c) => { const buf = n(c, 0); for (let i = 19; i <= 30; i++) p.memory.write64(buf + 8 * (i - 19), c.x[i]); p.memory.write64(buf + 96, c.sp); for (let i = 8; i <= 15; i++) p.memory.setFloat64(buf + 104 + 8 * (i - 8), c.getD(i)); return 0; };
  const restore = (p, c) => { const buf = n(c, 0), value = x(c, 1) || 1n; for (let i = 19; i <= 30; i++) c.x[i] = p.memory.read64(buf + 8 * (i - 19)); c.sp = p.memory.read64(buf + 96); for (let i = 8; i <= 15; i++) c.setD(i, p.memory.float64(buf + 104 + 8 * (i - 8))); c.x[0] = value; c.jumpTo = Number(c.x[30]); };
  lib.setjmp = lib._setjmp = lib.sigsetjmp = save; lib.longjmp = lib._longjmp = lib.siglongjmp = (p, c) => { restore(p, c); return undefined; };
  // ---- directories and paths
  lib.getcwd = (p, c) => { const dst = n(c, 0) || p.malloc(256); putString(p, dst, n(c, 1) || 256, '/'); return dst; };
  lib.realpath = (p, c) => { const path = str(p, x(c, 0)), files = vfs(); if (!files.stat(path)) return setErrno(p, ENOENT) && 0; const canonical = files.canonical(path), dst = n(c, 1) || p.malloc(4096); putString(p, dst, 4096, canonical); return dst; };
  lib.readlink = (p, c) => setErrno(p, EINVAL);
  lib.rename = (p, c) => { try { vfs().rename(str(p, x(c, 0)), str(p, x(c, 1))); return 0; } catch { return setErrno(p, ENOENT); } };
  lib.rmdir = (p, c) => { const path = str(p, x(c, 0)); if (vfs().stat(path)?.type !== 'dir') return setErrno(p, ENOTDIR); vfs().delete(path); return 0; };
  lib.unlinkat = (p, c) => { const path = str(p, x(c, 1)); if (!vfs().stat(path)) return setErrno(p, ENOENT); vfs().delete(path); return 0; };
  lib.mkdirat = (p, c) => { const path = str(p, x(c, 1)); if (vfs().stat(path)) return setErrno(p, EEXIST); vfs().mkdirs(path); return 0; };
  lib.chmod = lib.fchmod = lib.chown = lib.fchown = lib.utimes = lib.utimensat = lib.futimens = () => 0;
  lib.mkstemp = (p, c) => { const ptr = n(c, 0), template = str(p, ptr), name = template.replace(/XXXXXX$/, Math.random().toString(36).slice(2, 8).padEnd(6, '0')); p.memory.copyIn(ptr, encoder.encode(name)); c.x[1] = BigInt(0o102); return lib.open(p, c); };
  const dirs = new Map();
  lib.opendir = (p, c) => { const path = str(p, x(c, 0)); if (vfs().stat(path)?.type !== 'dir') return setErrno(p, ENOENT) && 0; const handle = p.malloc(16), entry = p.malloc(280); dirs.set(handle, { names: ['.', '..', ...vfs().list(path)], index: 0, entry }); return handle; };
  lib.fdopendir = (p, c) => setErrno(p, EINVAL) && 0;
  lib.readdir = (p, c) => { const d = dirs.get(n(c, 0)); if (!d || d.index >= d.names.length) return 0; const name = d.names[d.index++]; p.memory.fill(d.entry, 0, 280); p.memory.write64(d.entry, BigInt(d.index)); p.memory.setUint16(d.entry + 16, 280); putString(p, d.entry + 19, 256, String(name).split('/').pop()); return d.entry; };
  lib.closedir = (p, c) => { const d = dirs.get(n(c, 0)); if (d) { p.free(d.entry); dirs.delete(n(c, 0)); p.free(n(c, 0)); } return 0; };
  // scandir (bionic scandir.cpp): every entry of the directory that `filter` accepts (all of them when it is null), each copied into its own malloc'd dirent, the array of pointers
  // malloc'd too and sorted with `compar` (qsort) when given; the caller frees each entry and the array. alphasort / versionsort compare the names (strcoll / strverscmp in bionic:
  // bionic's only locale is C.UTF-8, where strcoll is strcmp).
  lib.scandir = lib.scandir64 = (p, c) => {
    const path = str(p, x(c, 0)), out = n(c, 1), filter = n(c, 2), compar = n(c, 3);
    if (vfs().stat(path)?.type !== 'dir') return setErrno(p, vfs().stat(path) ? ENOTDIR : ENOENT) && -1;
    const names = ['.', '..', ...vfs().list(path)], entries = [], scratch = p.malloc(280);
    try {
      names.forEach((name, i) => {
        p.memory.fill(scratch, 0, 280); p.memory.write64(scratch, BigInt(i + 1)); p.memory.write64(scratch + 8, BigInt(i + 1)); p.memory.setUint16(scratch + 16, 280); putString(p, scratch + 19, 256, String(name).split('/').pop());
        if (filter && Number(BigInt.asIntN(32, p.call(filter, [scratch]))) === 0) return;
        const copy = p.malloc(280); p.memory.copyIn(copy, p.memory.bytes(scratch, 280).slice()); entries.push(copy);
      });
    } finally { p.free(scratch); }
    const list = p.malloc(Math.max(8, 8 * entries.length)); entries.forEach((entry, i) => p.memory.writePtr(list + 8 * i, entry));
    if (compar && entries.length > 1) { c.x[0] = BigInt(list); c.x[1] = BigInt(entries.length); c.x[2] = 8n; c.x[3] = BigInt(compar); lib.qsort(p, c); }
    p.memory.writePtr(out, list); return entries.length;
  };
  const direntName = (p, ptr) => decoder.decode(p.memory.cString(p.memory.readPtr(ptr) + 19));
  lib.alphasort = lib.alphasort64 = (p, c) => { const a = direntName(p, n(c, 0)), b = direntName(p, n(c, 1)); return a < b ? -1 : a > b ? 1 : 0; };
  lib.statfs = lib.statvfs = lib.fstatfs = lib.fstatvfs = (p, c) => { p.memory.fill(n(c, 1), 0, 120); p.memory.write64(n(c, 1) + 8, 4096n); p.memory.write64(n(c, 1) + 16, 1n << 20n); p.memory.write64(n(c, 1) + 24, 1n << 19n); p.memory.write64(n(c, 1) + 32, 1n << 19n); return 0; };
  // pathconf / fpathconf as bionic's libc/bionic/pathconf.cpp answers them from statfs of the file's filesystem (the virtual filesystem: one ext4-like volume, 4 KiB blocks,
  // 255-byte names): LINK_MAX of a filesystem bionic does not list, MAX_CANON/MAX_INPUT 255, PATH_MAX and PIPE_BUF 4096, the _POSIX_* options; the names bionic leaves
  // without a limit are -1 with errno untouched, an unknown name is EINVAL.
  const pathconfValue = (p, name) => {
    switch (name) {   // bionic's <bits/sysconf.h> numbering (not glibc's)
      case 0: return 64n;                        // _PC_FILESIZEBITS
      case 1: return 127n;                       // _PC_LINK_MAX (LINK_MAX)
      case 2: case 3: return 255n;               // _PC_MAX_CANON, _PC_MAX_INPUT
      case 4: return 255n;                       // _PC_NAME_MAX (statfs f_namelen)
      case 5: case 6: return 4096n;              // _PC_PATH_MAX, _PC_PIPE_BUF
      case 7: return 1n;                         // _PC_2_SYMLINKS
      case 8: case 12: case 11: return 4096n;    // _PC_ALLOC_SIZE_MIN and _PC_REC_XFER_ALIGN (f_frsize), _PC_REC_MIN_XFER_SIZE (f_bsize)
      case 14: case 15: return 1n;               // _PC_CHOWN_RESTRICTED, _PC_NO_TRUNC
      case 16: return 0n;                        // _PC_VDISABLE ('\0')
      case 9: case 10: case 13: case 17: case 18: case 19: return 0xffffffffffffffffn;   // _PC_REC_INCR/MAX_XFER_SIZE, _PC_SYMLINK_MAX, _PC_ASYNC_IO, _PC_PRIO_IO, _PC_SYNC_IO: no limit
      default: return setErrno(p, EINVAL);
    }
  };
  lib.pathconf = (p, c) => { const path = str(p, x(c, 0)); if (!vfs().stat(path)) return setErrno(p, ENOENT); return pathconfValue(p, n(c, 1)); };   // statfs of a missing path: ENOENT
  lib.fpathconf = (p, c) => pathconfValue(p, n(c, 1));
  lib.basename = (p, c) => { const path = str(p, x(c, 0)), base = path.replace(/\/+$/, '').split('/').pop() || '/'; return p.allocString(base); };
  lib.dirname = (p, c) => { const path = str(p, x(c, 0)), at = path.replace(/\/+$/, '').lastIndexOf('/'); return p.allocString(at <= 0 ? (at === 0 ? '/' : '.') : path.slice(0, at)); };
  // ---- identity, limits, signals (one process, no signals delivered)
  lib.uname = (p, c) => { const u = n(c, 0); ['Linux', 'localhost', '5.15.0-apkweb', '#1 SMP PREEMPT', 'aarch64', 'localdomain'].forEach((v, i) => putString(p, u + 65 * i, 65, v)); return 0; };
  lib.gethostname = (p, c) => { putString(p, x(c, 0), x(c, 1), 'localhost'); return 0; };
  lib.getrlimit = lib.getrlimit64 = (p, c) => { p.memory.write64(n(c, 1), 0xffffffffffffffffn); p.memory.write64(n(c, 1) + 8, 0xffffffffffffffffn); return 0; };
  lib.setrlimit = lib.setrlimit64 = lib.prlimit = lib.prlimit64 = () => 0;
  lib.getrusage = (p, c) => { p.memory.fill(n(c, 1), 0, 144); return 0; };
  lib.getpriority = () => 0; lib.sched_setaffinity = lib.sched_getaffinity = () => 0;
  lib.sched_get_priority_max = () => 99; lib.sched_get_priority_min = () => 1; lib.pthread_getschedparam = lib.pthread_attr_getschedparam = (p, c) => { if (n(c, 2)) p.memory.writeU32(n(c, 2), 0); return 0; };
  lib.pthread_attr_getguardsize = (p, c) => { p.memory.write64(n(c, 1), 4096n); return 0; };
  lib.sigaltstack = (p, c) => {   // the calling thread's alternate signal stack (stack_t: ss_sp, ss_flags, ss_size); bionic installs one per thread (src/arm64/threads.js selfOf). No signal is delivered here, so it is state only
    const threads = p.threads, t = threads.current; threads.selfOf(t); const ss = n(c, 0), old = n(c, 1), alt = t.altStack;
    if (old) { p.memory.writePtr(old, alt.flags & 2 ? 0 : alt.sp); p.memory.writeU32(old + 8, alt.flags & 2); p.memory.writeU32(old + 12, 0); p.memory.write64(old + 16, BigInt(alt.flags & 2 ? 0 : alt.size)); }
    if (ss) { const flags = p.memory.readU32(ss + 8); t.altStack = flags & 2 ? { sp: 0, size: 0, flags: 2 } : { sp: p.memory.readPtr(ss), size: Number(p.memory.read64(ss + 16)), flags: 0 }; }   // SS_DISABLE
    return 0;
  }; 
  // signal, raise, kill, tgkill and the masks: src/arm64/signals.js
  lib.syslog = (p, c) => { runtime?.record?.(`LOG I syslog: ${formatC(p.memory, str(p, x(c, 1)), variadic(c, 2))}`); };
  lib.openlog = lib.closelog = () => {};
  lib.perror = (p, c) => { runtime?.record?.(`LOG E perror: ${n(c, 0) ? str(p, x(c, 0)) + ': ' : ''}errno ${p.memory.readU32(p.errnoAddress)}`); };
  lib.android_fdsan_exchange_owner_tag = lib.android_fdsan_close_with_tag = () => 0;
  lib.__read_chk = (p, c) => lib.read(p, c); lib.__write_chk = (p, c) => lib.write(p, c); lib.__openat_2 = (p, c) => lib.openat(p, c);
  lib.__vsprintf_chk = (p, c) => { c.x[1] = c.x[3]; c.x[2] = c.x[4]; return lib.vsprintf(p, c); };
  lib.__fwrite_chk = (p, c) => lib.fwrite(p, c);
  lib.dup = lib.dup2 = lib.dup3 = (p, c) => setErrno(p, EINVAL);
  lib.strtok_r = (p, c) => { let s = n(c, 0) || p.memory.readPtr(n(c, 2)); if (!s) return 0; const delims = new Set(p.memory.cString(n(c, 1))); while (p.memory.byte(s) && delims.has(p.memory.byte(s))) s++; if (!p.memory.byte(s)) { p.memory.writePtr(n(c, 2), 0); return 0; } let e = s; while (p.memory.byte(e) && !delims.has(p.memory.byte(e))) e++; if (p.memory.byte(e)) { p.memory.setByte(e, 0); p.memory.writePtr(n(c, 2), e + 1); } else p.memory.writePtr(n(c, 2), 0); return s; };
  lib.strtok = (p, c) => { p.strtokSave ??= p.malloc(8); c.x[2] = BigInt(p.strtokSave); return lib.strtok_r(p, c); };
  lib.strcasestr = (p, c) => { const hay = str(p, x(c, 0)), at = hay.toLowerCase().indexOf(str(p, x(c, 1)).toLowerCase()); return at < 0 ? 0 : n(c, 0) + encoder.encode(hay.slice(0, at)).length; };
  lib.putchar = (p, c) => n(c, 0) & 0xff;
  // ---- libm
  const m = (name, fn, arity = 1) => { lib[name] = (p, c) => ({ double: arity === 1 ? fn(c.getD(0)) : fn(c.getD(0), c.getD(1)) }); lib[name + 'f'] = (p, c) => ({ float: Math.fround(arity === 1 ? fn(c.getS(0)) : fn(c.getS(0), c.getS(1))) }); };
  m('asinh', Math.asinh); m('acosh', Math.acosh); m('atanh', Math.atanh); m('remainder', (a, b) => a - b * Math.round(a / b), 2); m('nextafter', (a, b) => { if (a === b || isNaN(a) || isNaN(b)) return b; const buf = new DataView(new ArrayBuffer(8)); buf.setFloat64(0, a); let bits = buf.getBigInt64(0); bits += (b > a) === (a >= 0) ? 1n : -1n; if (a === 0) { buf.setBigInt64(0, 1n); return b > 0 ? buf.getFloat64(0) : -buf.getFloat64(0); } buf.setBigInt64(0, bits); return buf.getFloat64(0); }, 2);
  m('erf', v => { const t = 1 / (1 + 0.3275911 * Math.abs(v)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-v * v); return v < 0 ? -y : y; });
  m('erfc', v => 1 - lib.erf(null, { getD: () => v }).double);
  lib.nan = () => ({ double: NaN }); lib.nanf = () => ({ float: NaN });
  lib.ldexp = (p, c) => ({ double: c.getD(0) * 2 ** s32(c, 0) }); lib.ldexpf = (p, c) => ({ float: Math.fround(c.getS(0) * 2 ** s32(c, 0)) }); lib.scalbn = lib.ldexp; lib.scalbnf = lib.ldexpf;
  lib.frexp = (p, c) => { const v = c.getD(0); if (v === 0 || !isFinite(v)) { p.memory.writeU32(n(c, 0), 0); return { double: v }; } const e = Math.floor(Math.log2(Math.abs(v))) + 1; p.memory.writeU32(n(c, 0), e); return { double: v / 2 ** e }; };
  lib.frexpf = (p, c) => { const v = c.getS(0); if (v === 0 || !isFinite(v)) { p.memory.writeU32(n(c, 0), 0); return { float: v }; } const e = Math.floor(Math.log2(Math.abs(v))) + 1; p.memory.writeU32(n(c, 0), e); return { float: Math.fround(v / 2 ** e) }; };
  lib.modf = (p, c) => { const v = c.getD(0), i = Math.trunc(v); p.memory.setFloat64(n(c, 0), i); return { double: v - i }; };
  lib.modff = (p, c) => { const v = c.getS(0), i = Math.trunc(v); p.memory.setFloat32(n(c, 0), i); return { float: Math.fround(v - i) }; };
  lib.sincos = (p, c) => { const v = c.getD(0); p.memory.setFloat64(n(c, 0), Math.sin(v)); p.memory.setFloat64(n(c, 1), Math.cos(v)); };
  lib.sincosf = (p, c) => { const v = c.getS(0); p.memory.setFloat32(n(c, 0), Math.sin(v)); p.memory.setFloat32(n(c, 1), Math.cos(v)); };
  lib.abs = (p, c) => Math.abs(s32(c, 0)); lib.labs = lib.llabs = (p, c) => { const v = BigInt.asIntN(64, x(c, 0)); return v < 0n ? -v : v; };
  // ---- libandroid's ATrace: tracing is off on this device (ATrace_isEnabled is false), so sections and counters are not recorded, as on a device with no trace session
  lib.ATrace_isEnabled = () => 0;
  lib.ATrace_beginSection = lib.ATrace_endSection = lib.ATrace_beginAsyncSection = lib.ATrace_endAsyncSection = lib.ATrace_setCounter = () => {};
  // ---- libandroid's asset manager over the APK's assets/ (base and splits): AAssetManager_fromJava, AAssetManager_open, AAsset_* and AAssetDir_*
  const assetHandles = new Map(); let nextAsset = 1;
  const asset = (p, c) => assetHandles.get(n(c, 0)) ?? (() => { throw new APKError(`ARM64 native code used AAsset 0x${n(c, 0).toString(16)} that AAssetManager_open did not return`, { kind: 'arm64-assets' }); })();
  lib.AAssetManager_fromJava = () => 0x7b0000000001;
  lib.AAssetManager_open = (p, c) => { const name = str(p, x(c, 1)).replace(/^\/+/, ''), bytes = assets?.read(name); if (!bytes) return 0; const handle = 0x7b0000100000 + nextAsset++; assetHandles.set(handle, { bytes, offset: 0, buffer: 0 }); return handle; };
  lib.AAsset_read = (p, c) => { const a = asset(p, c), chunk = a.bytes.subarray(a.offset, a.offset + n(c, 2)); p.memory.copyIn(n(c, 1), chunk); a.offset += chunk.length; return chunk.length; };
  lib.AAsset_getLength = lib.AAsset_getLength64 = (p, c) => asset(p, c).bytes.length;
  lib.AAsset_getRemainingLength = lib.AAsset_getRemainingLength64 = (p, c) => { const a = asset(p, c); return a.bytes.length - a.offset; };
  lib.AAsset_seek = lib.AAsset_seek64 = (p, c) => { const a = asset(p, c), off = Number(BigInt.asIntN(64, x(c, 1))), whence = n(c, 2), next = whence === 0 ? off : whence === 1 ? a.offset + off : a.bytes.length + off; if (next < 0 || next > a.bytes.length) return 0xffffffffffffffffn; a.offset = next; return next; };
  lib.AAsset_getBuffer = (p, c) => { const a = asset(p, c); if (!a.buffer) { a.buffer = p.malloc(Math.max(1, a.bytes.length)); p.memory.copyIn(a.buffer, a.bytes); } return a.buffer; };
  lib.AAsset_isAllocated = () => 1;
  lib.AAsset_close = (p, c) => { const a = assetHandles.get(n(c, 0)); if (a?.buffer) p.free(a.buffer); assetHandles.delete(n(c, 0)); };
  lib.AAsset_openFileDescriptor = lib.AAsset_openFileDescriptor64 = () => 0xffffffffffffffffn;   // an asset is not a plain file region here: -1, as for a compressed asset
  lib.AAssetManager_openDir = (p, c) => { const dir = str(p, x(c, 1)).replace(/^\/+|\/+$/g, ''), handle = 0x7b0000200000 + nextAsset++; assetHandles.set(handle, { names: assets?.list(dir) ?? [], index: 0, current: 0 }); return handle; };
  lib.AAssetDir_getNextFileName = (p, c) => { const d = asset(p, c); if (d.index >= d.names.length) return 0; if (d.current) p.free(d.current); d.current = p.allocString(d.names[d.index++]); return d.current; };
  lib.AAssetDir_rewind = (p, c) => { asset(p, c).index = 0; };
  lib.AAssetDir_close = (p, c) => { const d = assetHandles.get(n(c, 0)); if (d?.current) p.free(d.current); assetHandles.delete(n(c, 0)); };
  // ---- jnigraphics: AndroidBitmap_getInfo / lockPixels / unlockPixels over the lab's Bitmap pixels (the storage layout of the bitmap's Config); unlock writes the buffer back
  const FORMATS = { ARGB_8888: 1, RGB_565: 4, ARGB_4444: 7, ALPHA_8: 8, RGBA_F16: 9, RGBA_1010102: 10 };
  const bitmapOf = (p, handle) => { const ref = runtime.jni.valueOf(handle), host = runtime.skiaHost?.bitmaps; if (!host) throw new APKError('AndroidBitmap: the Bitmap backend (Skia) is not loaded', { kind: 'arm64-bitmap' }); return { host, b: host.live(ref) }; };
  const locks = new Map();
  lib.AndroidBitmap_getInfo = (p, c) => { if (!n(c, 1) || !n(c, 2)) return 0xfffffffffffffffen; const { host, b } = bitmapOf(p, x(c, 1)), name = host.storage(b), bpp = host.bytesPerPixel(b), info = n(c, 2); p.memory.writeU32(info, b.width); p.memory.writeU32(info + 4, b.height); p.memory.writeU32(info + 8, b.width * bpp); p.memory.writeU32(info + 12, FORMATS[name] ?? 0); p.memory.writeU32(info + 16, (b.hardware ? 0x80000000 : 0) | (name === 'RGB_565' || !b.hasAlpha ? 1 : 0)); return 0; };
  lib.AndroidBitmap_lockPixels = (p, c) => { const { host, b } = bitmapOf(p, x(c, 1)); if (b.hardware) return 0xfffffffffffffffdn; const raw = host.read(b).raw, ptr = p.malloc(Math.max(1, raw.length)); p.memory.copyIn(ptr, raw); locks.set(b, { ptr, length: raw.length }); if (n(c, 2)) p.memory.writePtr(n(c, 2), ptr); return 0; };
  lib.AndroidBitmap_unlockPixels = (p, c) => {
    const { host, b } = bitmapOf(p, x(c, 1)), lock = locks.get(b); if (!lock) return 0xfffffffffffffffdn;
    const name = host.storage(b), raw = p.memory.bytes(lock.ptr, lock.length).slice(); let bytes = raw;
    if (name === 'ALPHA_8') { bytes = new Uint8Array(b.width * b.height * 4); for (let i = 0; i < b.width * b.height; i++) bytes[i * 4 + 3] = raw[i]; }
    host.reset(b); host.writeRect(b, 0, 0, b.width, b.height, host.colorTypeName(name), name === 'RGB_565' ? 'Opaque' : 'Premul', bytes);
    p.free(lock.ptr); locks.delete(b); return 0;
  };
  void clock;
  return addSyscalls(addSignals(addMoreLibc(addSockets(lib, { runtime }), { runtime }), { runtime }));
}
