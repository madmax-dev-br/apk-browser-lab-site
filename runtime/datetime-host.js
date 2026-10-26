import { createHostRegistry, parseSignature } from './host-contract.js?v=94afba6d22ec';
import { JavaException } from './apk-runtime.js?v=94afba6d22ec';

// java.util.Date / java.util.TimeZone / java.text.SimpleDateFormat for the browser VM.
// Contract reimplementation over JavaScript's Intl (IANA tz database, English month/day names unless the Locale names another language).
// Not libcore/ICU: calendars other than Gregorian, week-of-year fields, DateFormat styles and locale-specific patterns are NOT implemented and fail
// explicitly. AOSP references: java.util.Date, java.util.SimpleTimeZone/ZoneInfoDB, java.text.SimpleDateFormat (android-13.0.0_r1).
const DATE = 'Ljava/util/Date;', ZONE = 'Ljava/util/TimeZone;', SDF = 'Ljava/text/SimpleDateFormat;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', LOCALE = 'Ljava/util/Locale;', PARSE = 'Ljava/text/ParseException;';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function createDateTimeHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(DATE, OBJECT, ['Ljava/io/Serializable;', 'Ljava/lang/Cloneable;', 'Ljava/lang/Comparable;'], { allocatable: true });
  type(ZONE, OBJECT, ['Ljava/io/Serializable;', 'Ljava/lang/Cloneable;'], { allocatable: true });
  type('Ljava/text/Format;', OBJECT, ['Ljava/io/Serializable;', 'Ljava/lang/Cloneable;'], { allocatable: true }); type('Ljava/text/DateFormat;', 'Ljava/text/Format;', [], { allocatable: true }); type(SDF, 'Ljava/text/DateFormat;', [], { allocatable: true });
  type(PARSE, 'Ljava/lang/Exception;'); type('Ljava/text/ParseException;', 'Ljava/lang/Exception;');

  // ---- Date ----------------------------------------------------------------------------------------------------------------------------------------
  const time = (r, ref) => { const t = r.object(ref).dateMillis; if (t === undefined) r.throwJava('Ljava/lang/IllegalStateException;', 'java.util.Date used before construction'); return t; };
  def(DATE, '<init>', '()V', (r, _m, [self]) => { r.object(self).dateMillis = BigInt(Math.floor(r.clock.wall())); });
  def(DATE, '<init>', '(J)V', (r, _m, [self, t]) => { r.object(self).dateMillis = BigInt(t); });
  def(DATE, 'getTime', '()J', (r, _m, [self]) => time(r, self));
  def(DATE, 'setTime', '(J)V', (r, _m, [self, t]) => { time(r, self); r.object(self).dateMillis = BigInt(t); });
  def(DATE, 'before', `(${DATE})Z`, (r, _m, [self, o]) => time(r, self) < time(r, o) ? 1 : 0); def(DATE, 'after', `(${DATE})Z`, (r, _m, [self, o]) => time(r, self) > time(r, o) ? 1 : 0);
  const compare = (r, a, b) => { const x = time(r, a), y = time(r, b); return x < y ? -1 : x > y ? 1 : 0; };
  def(DATE, 'compareTo', `(${DATE})I`, (r, _m, [self, o]) => compare(r, self, o)); def(DATE, 'compareTo', `(${OBJECT})I`, (r, _m, [self, o]) => compare(r, self, o));
  def(DATE, 'equals', `(${OBJECT})Z`, (r, _m, [self, o]) => o !== null && typeof o === 'object' && r.object(o).dateMillis !== undefined && r.object(o).dateMillis === time(r, self) ? 1 : 0);
  def(DATE, 'hashCode', '()I', (r, _m, [self]) => { const t = BigInt.asUintN(64, time(r, self)); return Number(BigInt.asIntN(32, t ^ (t >> 32n))); });
  def(DATE, 'clone', `()${OBJECT}`, (r, _m, [self]) => { const c = r.allocate(DATE); r.object(c).dateMillis = time(r, self); return c; });
  def(DATE, 'toString', `()${STRING}`, (r, _m, [self]) => { const t = Number(time(r, self)), tz = defaultZone(); const p = parts(t, tz.id); return `${p.weekday.slice(0, 3)} ${p.monthName.slice(0, 3)} ${String(p.day).padStart(2, '0')} ${two(p.hour)}:${two(p.minute)}:${two(p.second)} ${gmtName(tz.id, t)} ${p.year}`; });

  // ---- java.time interplay (libcore Date.toInstant/from, TimeZone.toZoneId; the java.time classes themselves are the original libcore sources in the framework DEX)
  const INSTANT = 'Ljava/time/Instant;', ZONE_ID = 'Ljava/time/ZoneId;';
  const call = (r, owner, name, signature, args, mode = 'static') => { const { parameters, result } = parseSignature(signature); return r.dispatch({ owner, name, parameters, result, signature }, mode === 'static' ? r.argumentWords(parameters, args) : r.argumentWords(parameters, args.slice(1), { receiver: args[0] }), mode); };
  def(DATE, 'toInstant', `()${INSTANT}`, (r, _m, [self]) => call(r, INSTANT, 'ofEpochMilli', `(J)${INSTANT}`, [time(r, self)]));
  def(DATE, 'from', `(${INSTANT})${DATE}`, (r, _m, [instant]) => {
    let millis; try { millis = call(r, INSTANT, 'toEpochMilli', '()J', [instant], 'virtual'); } catch (error) {
      if (!(error instanceof JavaException) || r.object(error.value).type !== 'Ljava/lang/ArithmeticException;') throw error;
      const wrapper = r.allocate('Ljava/lang/IllegalArgumentException;'); call(r, 'Ljava/lang/IllegalArgumentException;', '<init>', '(Ljava/lang/Throwable;)V', [wrapper, error.value], 'direct'); r.throwJavaReference(wrapper, null);
    }
    const date = r.allocate(DATE); r.object(date).dateMillis = BigInt(millis); return date;
  }, { static: true });

  // ---- time zones ---------------------------------------------------------------------------------------------------------------------------------------
  const two = n => String(n).padStart(2, '0');
  const formatters = new Map();
  const dtf = (tz, options) => { const k = tz + JSON.stringify(options); if (!formatters.has(k)) formatters.set(k, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', ...options })); return formatters.get(k); };
  const validZone = id => { try { new Intl.DateTimeFormat('en-US', { timeZone: id }); return true; } catch { return false; } };
  /** Offset in ms of `id` at instant `t`. Custom ids "GMT+hh:mm" are fixed offsets. */
  function offsetOf(id, t) {
    const custom = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(id); if (custom) return (custom[1] === '-' ? -1 : 1) * (Number(custom[2]) * 60 + Number(custom[3] ?? 0)) * 60000;
    if (id === 'UTC' || id === 'GMT') return 0;
    const name = dtf(id, { timeZoneName: 'longOffset' }).formatToParts(new Date(t)).find(p => p.type === 'timeZoneName').value, m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000 : 0;
  }
  const gmtName = (id, t) => { const o = offsetOf(id, t); if (o === 0) return 'GMT'; const a = Math.abs(o) / 60000; return `GMT${o < 0 ? '-' : '+'}${two(Math.floor(a / 60))}:${two(a % 60)}`; };
  function parts(t, id) {
    const shifted = new Date(t + offsetOf(id, t)); // fields of the wall clock: shift by the offset, read in UTC
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate(), hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), second: shifted.getUTCSeconds(), millis: shifted.getUTCMilliseconds(), dow: shifted.getUTCDay(), weekday: WEEKDAYS[shifted.getUTCDay()],
      monthName: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][shifted.getUTCMonth()], dayOfYear: Math.floor((Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - Date.UTC(shifted.getUTCFullYear(), 0, 0)) / 86400000) };
  }
  // The virtual device's time zone setting (Settings > Date & time) wins over the browser's zone; an empty setting follows the browser.
  const defaultId = () => { if (platform.device?.timeZone) return platform.device.timeZone; try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
  let overrideDefault = null; const defaultZone = () => ({ id: overrideDefault ?? defaultId() });
  const zoneObjects = new WeakMap();
  const zone = (r, id) => { const m = zoneObjects.get(r) ?? zoneObjects.set(r, new Map()).get(r); if (!m.has(id)) { const ref = r.allocate(ZONE); r.object(ref).tzId = id; m.set(id, ref); } return m.get(id); };
  const zid = (r, ref) => r.object(ref).tzId;
  // ---- deprecated java.util.Date field accessors / constructors (default time zone), as libcore's Date: used by java.util.zip.ZipUtils and old app code
  const fieldsOf = (r, ref) => parts(Number(time(r, ref)), defaultZone().id);
  def(DATE, 'getYear', '()I', (r, _m, [self]) => fieldsOf(r, self).year - 1900); def(DATE, 'getMonth', '()I', (r, _m, [self]) => fieldsOf(r, self).month);
  def(DATE, 'getDate', '()I', (r, _m, [self]) => fieldsOf(r, self).day); def(DATE, 'getDay', '()I', (r, _m, [self]) => fieldsOf(r, self).dow);
  def(DATE, 'getHours', '()I', (r, _m, [self]) => fieldsOf(r, self).hour); def(DATE, 'getMinutes', '()I', (r, _m, [self]) => fieldsOf(r, self).minute); def(DATE, 'getSeconds', '()I', (r, _m, [self]) => fieldsOf(r, self).second);
  def(DATE, 'getTimezoneOffset', '()I', (r, _m, [self]) => -offsetOf(defaultZone().id, Number(time(r, self))) / 60000 | 0);
  /** Wall-clock fields in the default zone -> epoch milliseconds (fields may overflow, as the lenient java.util.Date constructors allow). */
  const localToEpoch = (year, month, day, hour, minute, second) => {
    const wall = Date.UTC(1970, 0, 1) + new Date(Date.UTC(2000, 0, 1)).setUTCFullYear(year, month, day) - Date.UTC(2000, 0, 1) + ((hour * 60 + minute) * 60 + second) * 1000;
    const zoneId = defaultZone().id; let guess = wall - offsetOf(zoneId, wall); guess = wall - offsetOf(zoneId, guess); return guess;
  };
  for (const signature of ['(III)V', '(IIIII)V', '(IIIIII)V']) def(DATE, '<init>', signature, (r, _m, [self, y, mo, d, h = 0, mi = 0, sec = 0]) => { r.object(self).dateMillis = BigInt(localToEpoch(y + 1900, mo, d, h, mi, sec)); });

  def(ZONE, 'getTimeZone', `(${STRING})${ZONE}`, (r, _m, [id]) => { const n = r.stringCharacters(id); return zone(r, validZone(n) || /^GMT[+-]\d{1,2}(:?\d{2})?$/.test(n) ? n : 'GMT'); }, { static: true }); // unknown ids fall back to GMT, like TimeZone.getTimeZone
  def(ZONE, 'getDefault', `()${ZONE}`, r => zone(r, defaultZone().id), { static: true });
  def(ZONE, 'setDefault', `(${ZONE})V`, (r, _m, [z]) => { overrideDefault = z === null ? null : zid(r, z); }, { static: true });
  def(ZONE, 'toZoneId', `()${ZONE_ID}`, (r, _m, [self]) => call(r, ZONE_ID, 'of', `(${STRING}Ljava/util/Map;)${ZONE_ID}`, [zid(r, self), r.readStatic({ owner: ZONE_ID, name: 'SHORT_IDS', type: 'Ljava/util/Map;' })]));
  def(ZONE, 'getID', `()${STRING}`, (r, _m, [self]) => zid(r, self));
  def(ZONE, 'getRawOffset', '()I', (r, _m, [self]) => { const id = zid(r, self), year = new Date().getUTCFullYear(); return Math.min(offsetOf(id, Date.UTC(year, 0, 1)), offsetOf(id, Date.UTC(year, 6, 1))); });
  def(ZONE, 'getOffset', '(J)I', (r, _m, [self, t]) => offsetOf(zid(r, self), Number(t)));
  def(ZONE, 'useDaylightTime', '()Z', (r, _m, [self]) => { const id = zid(r, self), y = new Date().getUTCFullYear(); return offsetOf(id, Date.UTC(y, 0, 1)) !== offsetOf(id, Date.UTC(y, 6, 1)) ? 1 : 0; });
  def(ZONE, 'inDaylightTime', `(${DATE})Z`, (r, _m, [self, d]) => { const id = zid(r, self), t = Number(time(r, d)), y = new Date(t).getUTCFullYear(); return offsetOf(id, t) !== Math.min(offsetOf(id, Date.UTC(y, 0, 1)), offsetOf(id, Date.UTC(y, 6, 1))) ? 1 : 0; });
  def(ZONE, 'getDisplayName', `()${STRING}`, (r, _m, [self]) => zid(r, self)); def(ZONE, 'toString', `()${STRING}`, (r, _m, [self]) => `libcore.util.ZoneInfo[id="${zid(r, self)}"]`);
  def(ZONE, 'equals', `(${OBJECT})Z`, (r, _m, [self, o]) => o !== null && typeof o === 'object' && r.object(o).tzId === zid(r, self) ? 1 : 0); def(ZONE, 'hashCode', '()I', (r, _m, [self]) => [...zid(r, self)].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0));
  def(ZONE, 'clone', `()${OBJECT}`, (r, _m, [self]) => self);

  // ---- SimpleDateFormat ---------------------------------------------------------------------------------------------------------------------------------
  const tokens = (r, pattern) => {
    const out = []; for (let i = 0; i < pattern.length;) {
      const c = pattern[i];
      if (c === "'") { let j = i + 1, lit = ''; for (; j < pattern.length; j++) { if (pattern[j] === "'") { if (pattern[j + 1] === "'") { lit += "'"; j++; } else break; } else lit += pattern[j]; } if (j >= pattern.length) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Unterminated quote'); out.push({ literal: i + 1 === j ? "'" : lit }); i = j + 1; }
      else if (/[A-Za-z]/.test(c)) { let n = 1; while (pattern[i + n] === c) n++; if (!'GyYMLwWDdFEuaHkKhmsSzZX'.includes(c)) r.throwJava('Ljava/lang/IllegalArgumentException;', `Unknown pattern character '${c}'`); out.push({ field: c, count: n }); i += n; }
      else { out.push({ literal: c }); i++; }
    } return out;
  };
  const sdf = (r, ref) => r.object(ref).sdf ?? r.throwJava('Ljava/lang/IllegalStateException;', 'SimpleDateFormat used before construction');
  const localeTag = (r, locale) => { const tag = locale ? r.object(locale).localeData?.tag : null; return tag && tag !== 'und' ? tag : 'en-US'; };
  const init = (r, self, pattern, locale) => { if (pattern === null) r.throwJava('Ljava/lang/NullPointerException;', 'pattern == null'); const text = r.stringCharacters(pattern); r.object(self).sdf = { pattern: text, tokens: tokens(r, text), zone: defaultZone().id, lenient: true, tag: localeTag(r, locale) }; };
  def(SDF, '<init>', '()V', (r, _m, [self]) => init(r, self, "M/d/yy h:mm a", null));
  def(SDF, '<init>', `(${STRING})V`, (r, _m, [self, p]) => init(r, self, p, null));
  def(SDF, '<init>', `(${STRING}${LOCALE})V`, (r, _m, [self, p, l]) => init(r, self, p, l));
  def(SDF, 'setTimeZone', `(${ZONE})V`, (r, _m, [self, z]) => { sdf(r, self).zone = zid(r, z); }); def(SDF, 'getTimeZone', `()${ZONE}`, (r, _m, [self]) => zone(r, sdf(r, self).zone));
  def(SDF, 'setLenient', '(Z)V', (r, _m, [self, v]) => { sdf(r, self).lenient = !!v; }); def(SDF, 'isLenient', '()Z', (r, _m, [self]) => sdf(r, self).lenient ? 1 : 0);
  def(SDF, 'toPattern', `()${STRING}`, (r, _m, [self]) => sdf(r, self).pattern);
  const intlName = (tag, id, t, options) => new Intl.DateTimeFormat(tag, { timeZone: id === 'GMT' ? 'UTC' : /^GMT[+-]/.test(id) ? 'UTC' : id, ...options }).format(new Date(t));
  function formatDate(r, f, t) {
    const p = parts(t, f.zone), o = offsetOf(f.zone, t); let out = '';
    for (const tok of f.tokens) {
      if (tok.literal !== undefined) { out += tok.literal; continue; }
      const n = tok.count, num = v => String(v).padStart(n, '0');
      switch (tok.field) {
        case 'G': out += p.year > 0 ? 'AD' : 'BC'; break;
        case 'y': case 'Y': out += n === 2 ? two(p.year % 100) : num(p.year); break;
        case 'M': case 'L': out += n >= 4 ? intlName(f.tag, f.zone, t, { month: 'long' }) : n === 3 ? intlName(f.tag, f.zone, t, { month: 'short' }) : num(p.month + 1); break;
        case 'd': out += num(p.day); break; case 'D': out += num(p.dayOfYear); break;
        case 'H': out += num(p.hour); break; case 'k': out += num(p.hour === 0 ? 24 : p.hour); break;
        case 'h': out += num(p.hour % 12 === 0 ? 12 : p.hour % 12); break; case 'K': out += num(p.hour % 12); break;
        case 'm': out += num(p.minute); break; case 's': out += num(p.second); break; case 'S': out += num(p.millis); break;
        case 'E': out += n >= 4 ? intlName(f.tag, f.zone, t, { weekday: 'long' }) : intlName(f.tag, f.zone, t, { weekday: 'short' }); break;
        case 'u': out += num(p.dow === 0 ? 7 : p.dow); break;
        case 'a': out += p.hour < 12 ? 'AM' : 'PM'; break;
        case 'z': out += gmtName(f.zone, t); break;
        case 'Z': { const a = Math.abs(o) / 60000; out += `${o < 0 ? '-' : '+'}${two(Math.floor(a / 60))}${two(a % 60)}`; break; }
        case 'X': { if (o === 0) { out += 'Z'; break; } const a = Math.abs(o) / 60000, h = two(Math.floor(a / 60)), mm = two(a % 60); out += `${o < 0 ? '-' : '+'}${h}${n === 1 ? '' : n === 2 ? mm : ':' + mm}`; break; }
        default: throw new Error(`SimpleDateFormat field '${tok.field}' (week-based fields) is not implemented`);
      }
    }
    return out;
  }
  def(SDF, 'format', `(${DATE})${STRING}`, (r, _m, [self, d]) => { if (d === null) r.throwJava('Ljava/lang/NullPointerException;', null); return formatDate(r, sdf(r, self), Number(time(r, d))); });
  def(SDF, 'format', `(${OBJECT})${STRING}`, (r, _m, [self, d]) => formatDate(r, sdf(r, self), Number(time(r, d))));
  const monthNames = tag => Array.from({ length: 12 }, (_, i) => ({ long: new Intl.DateTimeFormat(tag, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2021, i, 1))), short: new Intl.DateTimeFormat(tag, { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2021, i, 1))) }));
  const parseText = (r, f, text) => {
    const fail = (at = 0) => { const e = r.allocate(PARSE); r.dispatch({ owner: PARSE, name: '<init>', parameters: [STRING, 'I'], result: 'V', signature: `(${STRING}I)V` }, r.argumentWords([STRING, 'I'], [`Unparseable date: "${text}"`, at], { receiver: e }), 'direct'); r.object(e).errorOffset = at; r.throwJavaReference(e, `Unparseable date: "${text}"`); };
    let pos = 0; const f_ = { year: 1970, month: 0, day: 1, hour: 0, minute: 0, second: 0, millis: 0, pm: null, hour12: false, offset: null, era: 1 };
    const digits = (min, max) => { const m = new RegExp(`^[+-]?\\d{${min},${max}}`).exec(text.slice(pos)); if (!m) fail(pos); pos += m[0].length; return Number(m[0]); };
    const names = monthNames(f.tag);
    for (let i = 0; i < f.tokens.length; i++) {
      const tok = f.tokens[i];
      if (tok.literal !== undefined) { if (!text.startsWith(tok.literal, pos)) fail(pos); pos += tok.literal.length; continue; }
      const n = tok.count, adjacentNumeric = f.tokens[i + 1]?.field && 'yMdHhmsSkK'.includes(f.tokens[i + 1].field), width = adjacentNumeric ? n : 10;
      switch (tok.field) {
        case 'y': case 'Y': { const start = pos, v = digits(1, adjacentNumeric ? n : 9); f_.year = n <= 2 && pos - start <= 2 ? (v < 70 ? 2000 + v : 1900 + v) : v; break; }
        case 'M': case 'L': if (n >= 3) { const hit = names.findIndex(m => text.slice(pos).toLowerCase().startsWith((n >= 4 ? m.long : m.short).toLowerCase())); if (hit < 0) fail(pos); pos += (n >= 4 ? names[hit].long : names[hit].short).length; f_.month = hit; } else f_.month = digits(1, width) - 1; break;
        case 'd': f_.day = digits(1, width); break; case 'H': f_.hour = digits(1, width); break; case 'k': f_.hour = digits(1, width) % 24; break;
        case 'h': f_.hour = digits(1, width) % 12; f_.hour12 = true; break; case 'K': f_.hour = digits(1, width); f_.hour12 = true; break;
        case 'm': f_.minute = digits(1, width); break; case 's': f_.second = digits(1, width); break; case 'S': f_.millis = digits(1, width); break;
        case 'a': { const m = /^(AM|PM)/i.exec(text.slice(pos)); if (!m) fail(pos); f_.pm = m[1].toUpperCase() === 'PM'; pos += 2; break; }
        case 'E': { const m = new RegExp(`^(${WEEKDAYS.join('|')}|${WEEKDAYS.map(d => d.slice(0, 3)).join('|')})`, 'i').exec(text.slice(pos)); if (!m) fail(pos); pos += m[0].length; break; }
        case 'Z': case 'X': case 'z': { const m = /^(Z|GMT|UTC)?([+-])(\d{2}):?(\d{2})?|^(Z|GMT|UTC)/.exec(text.slice(pos)); if (!m) fail(pos); pos += m[0].length; f_.offset = m[2] ? (m[2] === '-' ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4] ?? 0)) * 60000 : 0; break; }
        case 'G': { const m = /^(AD|BC)/i.exec(text.slice(pos)); if (!m) fail(pos); pos += 2; f_.era = m[1].toUpperCase() === 'BC' ? -1 : 1; break; }
        default: throw new Error(`SimpleDateFormat parsing of field '${tok.field}' is not implemented`);
      }
    }
    if (f_.hour12 && f_.pm) f_.hour += 12;
    if (!f.lenient && (f_.month < 0 || f_.month > 11 || f_.day < 1 || f_.day > 31 || f_.hour > 23 || f_.minute > 59 || f_.second > 59)) fail(0);
    const utc = Date.UTC(f_.era < 0 ? 1 - f_.year : f_.year, f_.month, f_.day, f_.hour, f_.minute, f_.second, f_.millis);
    if (f_.offset !== null) return utc - f_.offset;
    let guess = utc - offsetOf(f.zone, utc); guess = utc - offsetOf(f.zone, guess); return guess; // wall clock in the format's zone -> instant
  };
  def(SDF, 'parse', `(${STRING})${DATE}`, (r, _m, [self, s]) => { if (s === null) r.throwJava('Ljava/lang/NullPointerException;', null); const d = r.allocate(DATE); r.object(d).dateMillis = BigInt(parseText(r, sdf(r, self), r.stringCharacters(s))); return d; });
  def(PARSE, '<init>', `(${STRING}I)V`, (r, _m, [self, message, offset]) => { Object.assign(r.object(self), { message, errorOffset: offset }); });
  def(PARSE, 'getErrorOffset', '()I', (r, _m, [self]) => r.object(self).errorOffset ?? 0);
  // ---- java.util.Calendar / GregorianCalendar (the Gregorian calendar with java.util.Calendar's field model: set() marks fields, get()/getTime() resolve them leniently, add() works on
  // the wall clock for date fields and on the time line for time fields, roll() wraps inside the field's range). First day of week and minimal days follow the device locale's region
  // (CLDR week data for the common regions; others use Monday / 4 days), the zone is a TimeZone object or the device default. Not modelled: Julian cutover (proleptic Gregorian), eras
  // other than AD/BC, week years, non-Gregorian types (Calendar.getInstance(...) never returns a Buddhist/Japanese calendar). ------------------------------------------------------------------------
  const CALENDAR = 'Ljava/util/Calendar;', GREGORIAN = 'Ljava/util/GregorianCalendar;', LOCALE_T = 'Ljava/util/Locale;';
  type(CALENDAR, OBJECT, ['Ljava/io/Serializable;', 'Ljava/lang/Cloneable;', 'Ljava/lang/Comparable;'], { allocatable: true }); type(GREGORIAN, CALENDAR, [], { allocatable: true });
  const F = { ERA: 0, YEAR: 1, MONTH: 2, WEEK_OF_YEAR: 3, WEEK_OF_MONTH: 4, DATE: 5, DAY_OF_MONTH: 5, DAY_OF_YEAR: 6, DAY_OF_WEEK: 7, DAY_OF_WEEK_IN_MONTH: 8, AM_PM: 9, HOUR: 10, HOUR_OF_DAY: 11, MINUTE: 12, SECOND: 13, MILLISECOND: 14, ZONE_OFFSET: 15, DST_OFFSET: 16 };
  for (const [name, value] of Object.entries({ ...F, FIELD_COUNT: 17, JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5, JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11, UNDECIMBER: 12, SUNDAY: 1, MONDAY: 2, TUESDAY: 3, WEDNESDAY: 4, THURSDAY: 5, FRIDAY: 6, SATURDAY: 7, AM: 0, PM: 1, ALL_STYLES: 0, SHORT: 1, LONG: 2, NARROW_FORMAT: 4, NARROW_STANDALONE: 32772, SHORT_FORMAT: 1, LONG_FORMAT: 2, SHORT_STANDALONE: 32769, LONG_STANDALONE: 32770 }))
    for (const owner of [CALENDAR, GREGORIAN]) registry.staticField(owner, name, 'I', () => value);
  registry.staticField(GREGORIAN, 'BC', 'I', () => 0); registry.staticField(GREGORIAN, 'AD', 'I', () => 1);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SUNDAY_FIRST = new Set(['US', 'CA', 'BR', 'JP', 'IN', 'MX', 'IL', 'KR', 'TW', 'HK', 'PH', 'ZA', 'CO', 'PE', 'VE', 'AR', 'CL']), SATURDAY_FIRST = new Set(['AE', 'SA', 'EG', 'DZ', 'IQ', 'JO', 'KW', 'LY', 'OM', 'QA', 'SD', 'SY', 'IR', 'AF']), ONE_DAY_WEEK = new Set(['US', 'CA', 'BR', 'JP', 'IN', 'MX', 'IL', 'KR', 'TW', 'HK', 'PH', 'ZA', 'CO', 'PE', 'VE', 'AR', 'CL', 'AU', 'AE', 'SA', 'EG']);
  const regionOf = () => (platform.device?.locale ?? 'en-US').split('-')[1] ?? 'US';
  const weekData = () => { const region = regionOf(); return { first: SUNDAY_FIRST.has(region) ? 1 : SATURDAY_FIRST.has(region) ? 7 : 2, minimal: ONE_DAY_WEEK.has(region) ? 1 : 4 }; };
  const cal = (r, ref) => r.object(ref).cal ?? r.throwJava('Ljava/lang/IllegalStateException;', 'java.util.Calendar used before construction');
  const newCalendar = (r, owner, zoneId, millis) => { const ref = r.allocate(owner), week = weekData(); r.object(ref).cal = { time: millis ?? Math.floor(r.clock.wall()), zone: zoneId ?? defaultZone().id, lenient: true, first: week.first, minimal: week.minimal, f: null, dirty: false, lastSet: [] }; return ref; };
  const dowOf = (y, mo, d) => new Date(Date.UTC(y, mo, d)).getUTCDay();
  const yearDays = y => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
  /** GregorianCalendar.WEEK_OF_YEAR: week 1 is the first week with at least `minimal` days in the new year; early January days can belong to the last week of the previous year and late December days to week 1 of the next. */
  const weekOfYear = (y, mo, d, first, minimal) => {
    const doy = Math.round((Date.UTC(y, mo, d) - Date.UTC(y, 0, 1)) / 86400000) + 1, shift = (dowOf(y, 0, 1) + 1 - first + 7) % 7;
    const w = Math.floor((doy - 1 + shift) / 7) + (7 - shift >= minimal ? 1 : 0);
    if (w === 0) return weekOfYear(y - 1, 11, 31, first, minimal);
    if (w >= 52) { const nshift = (dowOf(y + 1, 0, 1) + 1 - first + 7) % 7; if (nshift > 0 && 7 - nshift >= minimal && doy >= yearDays(y) - nshift + 1) return 1; }
    return w;
  };
  const loadFields = c => {
    if (c.f && !c.dirty) return c.f;
    if (c.dirty) resolveTime(c);
    const p = parts(c.time, c.zone), off = offsetOf(c.zone, c.time), raw = rawOffset(c.zone), hour = p.hour;
    const doy = Math.round((Date.UTC(p.year, p.month, p.day) - Date.UTC(p.year, 0, 1)) / 86400000) + 1, mshift = (dowOf(p.year, p.month, 1) + 1 - c.first + 7) % 7;
    const wom = Math.floor((p.day - 1 + mshift) / 7) + (7 - mshift >= c.minimal ? 1 : 0);
    c.f = [p.year > 0 ? 1 : 0, p.year > 0 ? p.year : 1 - p.year, p.month, weekOfYear(p.year, p.month, p.day, c.first, c.minimal), wom, p.day, doy, p.dow + 1, Math.floor((p.day - 1) / 7) + 1, hour >= 12 ? 1 : 0, hour % 12, hour, p.minute, p.second, p.millis, raw, off - raw];
    return c.f;
  };
  const rawOffset = zoneId => { const t = Date.UTC(2021, 0, 15), u = Date.UTC(2021, 6, 15); return Math.min(offsetOf(zoneId, t), offsetOf(zoneId, u)) === offsetOf(zoneId, t) && offsetOf(zoneId, t) !== offsetOf(zoneId, u) ? Math.min(offsetOf(zoneId, t), offsetOf(zoneId, u)) : offsetOf(zoneId, t); };
  /** Wall-clock components (lenient: any overflow carries) -> epoch millis in the calendar's zone. */
  const wallToEpoch = (zoneId, year, month, day, hour, minute, second, millis) => {
    const d = new Date(0); d.setUTCFullYear(year, month, day); d.setUTCHours(hour, minute, second, millis); const wall = d.getTime();
    return wallToInstant(zoneId, wall);
  };
  /** Local wall time (as UTC millis) -> instant. Normal: the one matching offset. Overlap (clocks go back): the standard-time reading. Gap (clocks go forward): the pre-transition offset, which lands after the gap. */
  const wallToInstant = (zoneId, wall) => {
    const before = offsetOf(zoneId, wall - 36 * 3600000), after = offsetOf(zoneId, wall + 36 * 3600000);
    const valid = [...new Set([before, after])].filter(o => offsetOf(zoneId, wall - o) === o);
    if (valid.length === 1) return wall - valid[0];
    if (valid.length === 2) return wall - Math.min(...valid);
    return wall - before;
  };
  function resolveTime(c) {
    const f = c.f; c.dirty = false; if (!f) return;
    const set = field => c.lastSet.includes(field);
    const year = f[F.ERA] === 0 ? 1 - f[F.YEAR] : f[F.YEAR];
    let month = f[F.MONTH], day = f[F.DAY_OF_MONTH];
    if (set(F.DAY_OF_YEAR) && !set(F.DAY_OF_MONTH) && !set(F.MONTH)) { month = 0; day = f[F.DAY_OF_YEAR]; }
    else if (set(F.DAY_OF_WEEK) && !set(F.DAY_OF_MONTH)) { const base = new Date(Date.UTC(year, month, day)); const cur = base.getUTCDay() + 1; let diff = f[F.DAY_OF_WEEK] - cur; const startShift = (cur - c.first + 7) % 7, targetShift = (f[F.DAY_OF_WEEK] - c.first + 7) % 7; diff = targetShift - startShift; day += diff; }
    else if (set(F.WEEK_OF_YEAR) && !set(F.DAY_OF_MONTH) && !set(F.MONTH)) { const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay(), shift = (jan1 + 1 - c.first + 7) % 7, firstWeekStart = 1 - shift + (7 - shift >= c.minimal ? 0 : 7); month = 0; day = firstWeekStart + (f[F.WEEK_OF_YEAR] - 1) * 7 + ((f[F.DAY_OF_WEEK] - c.first + 7) % 7); }
    let hour; const hourOfDaySet = set(F.HOUR_OF_DAY) || !(set(F.HOUR) || set(F.AM_PM));
    hour = hourOfDaySet ? f[F.HOUR_OF_DAY] : f[F.AM_PM] * 12 + f[F.HOUR];
    if (!c.lenient && (f[F.MONTH] < 0 || f[F.MONTH] > 11 || f[F.DAY_OF_MONTH] < 1 || f[F.DAY_OF_MONTH] > daysIn(year, f[F.MONTH]) || hour < 0 || hour > 23 || f[F.MINUTE] > 59 || f[F.SECOND] > 59)) throw new RangeError('non-lenient');
    c.time = wallToEpoch(c.zone, year, month, day, hour, f[F.MINUTE], f[F.SECOND], f[F.MILLISECOND]); c.f = null; c.lastSet = [];
  }
  const daysIn = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const fieldsOfCal = c => { const f = loadFields(c); return f; };
  const getField = (r, self, field) => {
    if (field < 0 || field > 16) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=17; index=${field}`);
    const c = cal(r, self); try { if (c.dirty) resolveTime(c); } catch (e) { if (e instanceof RangeError) r.throwJava('Ljava/lang/IllegalArgumentException;', field === F.MONTH ? 'MONTH' : 'DAY_OF_MONTH'); throw e; }
    return fieldsOfCal(c)[field];
  };
  const setField = (r, self, field, value) => { const c = cal(r, self); if (field < 0 || field > 14) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=17; index=${field}`); if (!c.dirty) loadFields(c); c.f = c.f.slice(); c.f[field] = value; c.dirty = true; if (!c.lastSet.includes(field)) c.lastSet.push(field); };
  const settle = (r, self) => { const c = cal(r, self); try { if (c.dirty) resolveTime(c); } catch (e) { if (e instanceof RangeError) r.throwJava('Ljava/lang/IllegalArgumentException;', 'non-lenient field out of range'); throw e; } return c; };
  for (const owner of [CALENDAR, GREGORIAN]) {
    def(owner, 'get', '(I)I', (r, _m, [self, field]) => getField(r, self, field));
    def(owner, 'set', '(II)V', (r, _m, [self, field, value]) => setField(r, self, field, value));
    def(owner, 'set', '(III)V', (r, _m, [self, y, mo, d]) => { setField(r, self, F.YEAR, y); setField(r, self, F.MONTH, mo); setField(r, self, F.DAY_OF_MONTH, d); });
    def(owner, 'set', '(IIIII)V', (r, _m, [self, y, mo, d, h, mi]) => { setField(r, self, F.YEAR, y); setField(r, self, F.MONTH, mo); setField(r, self, F.DAY_OF_MONTH, d); setField(r, self, F.HOUR_OF_DAY, h); setField(r, self, F.MINUTE, mi); });
    def(owner, 'set', '(IIIIII)V', (r, _m, [self, y, mo, d, h, mi, se]) => { setField(r, self, F.YEAR, y); setField(r, self, F.MONTH, mo); setField(r, self, F.DAY_OF_MONTH, d); setField(r, self, F.HOUR_OF_DAY, h); setField(r, self, F.MINUTE, mi); setField(r, self, F.SECOND, se); });
    def(owner, 'getTimeInMillis', '()J', (r, _m, [self]) => BigInt(settle(r, self).time)); def(owner, 'setTimeInMillis', '(J)V', (r, _m, [self, t]) => { const c = cal(r, self); c.time = Number(t); c.f = null; c.dirty = false; c.lastSet = []; });
    def(owner, 'getTime', `()${DATE}`, (r, _m, [self]) => { const d = r.allocate(DATE); r.object(d).dateMillis = BigInt(settle(r, self).time); return d; });
    def(owner, 'setTime', `(${DATE})V`, (r, _m, [self, d]) => { const c = cal(r, self); c.time = Number(time(r, d)); c.f = null; c.dirty = false; c.lastSet = []; });
    def(owner, 'getTimeZone', `()${ZONE}`, (r, _m, [self]) => zone(r, cal(r, self).zone));
    def(owner, 'setTimeZone', `(${ZONE})V`, (r, _m, [self, z]) => { const c = settle(r, self); c.zone = zid(r, z); c.f = null; });
    def(owner, 'isLenient', '()Z', (r, _m, [self]) => cal(r, self).lenient ? 1 : 0); def(owner, 'setLenient', '(Z)V', (r, _m, [self, v]) => { cal(r, self).lenient = !!v; });
    def(owner, 'getFirstDayOfWeek', '()I', (r, _m, [self]) => cal(r, self).first); def(owner, 'setFirstDayOfWeek', '(I)V', (r, _m, [self, v]) => { const c = settle(r, self); c.first = v; c.f = null; });
    def(owner, 'getMinimalDaysInFirstWeek', '()I', (r, _m, [self]) => cal(r, self).minimal); def(owner, 'setMinimalDaysInFirstWeek', '(I)V', (r, _m, [self, v]) => { const c = settle(r, self); c.minimal = v; c.f = null; });
    def(owner, 'isSet', '(I)Z', (r, _m, [self, field]) => { const c = cal(r, self); return c.dirty ? (c.lastSet.includes(field) ? 1 : 0) : 1; });
    def(owner, 'clear', '()V', (r, _m, [self]) => { const c = cal(r, self); c.time = Date.UTC(1970, 0, 1) - offsetOf(c.zone, 0); c.f = null; c.dirty = false; c.lastSet = []; c.time = wallToEpoch(c.zone, 1970, 0, 1, 0, 0, 0, 0); });
    def(owner, 'clear', '(I)V', (r, _m, [self, field]) => { const defaults = { [F.MONTH]: 0, [F.DAY_OF_MONTH]: 1, [F.HOUR_OF_DAY]: 0, [F.HOUR]: 0, [F.MINUTE]: 0, [F.SECOND]: 0, [F.MILLISECOND]: 0, [F.AM_PM]: 0, [F.YEAR]: 1970, [F.DAY_OF_YEAR]: 1 }; setField(r, self, field, defaults[field] ?? 0); });
    const monthLen = (r, self) => { const f = loadFields(settle(r, self)); return daysIn(f[F.ERA] ? f[F.YEAR] : 1 - f[F.YEAR], f[F.MONTH]); };
    const maxOf = (r, self, field) => { const c0 = settle(r, self), f = loadFields(c0); const year = f[F.ERA] ? f[F.YEAR] : 1 - f[F.YEAR]; switch (field) {
      case F.DAY_OF_MONTH: return monthLen(r, self); case F.DAY_OF_YEAR: return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365; case F.MONTH: return 11; case F.HOUR: return 11; case F.HOUR_OF_DAY: return 23; case F.MINUTE: case F.SECOND: return 59; case F.MILLISECOND: return 999;
      case F.DAY_OF_WEEK: return 7; case F.AM_PM: return 1; case F.WEEK_OF_MONTH: return 6; case F.WEEK_OF_YEAR: { let w = 0; for (let d = 25; d <= 31; d++) { const x = weekOfYear(year, 11, d, c0.first, c0.minimal); if (x !== 1) w = Math.max(w, x); } return w; } case F.DAY_OF_WEEK_IN_MONTH: return Math.floor((monthLen(r, self) - 1) / 7) + 1; case F.YEAR: return 292278994; case F.ERA: return 1; default: return 0; } };
    const minOf = field => ([F.DAY_OF_MONTH, F.DAY_OF_YEAR, F.DAY_OF_WEEK, F.YEAR, F.WEEK_OF_YEAR, F.WEEK_OF_MONTH, F.DAY_OF_WEEK_IN_MONTH].includes(field) ? 1 : 0);
    def(owner, 'getActualMaximum', '(I)I', (r, _m, [self, field]) => maxOf(r, self, field)); def(owner, 'getActualMinimum', '(I)I', (r, _m, [self, field]) => minOf(field));
    def(owner, 'getMaximum', '(I)I', (r, _m, [self, field]) => field === F.DAY_OF_MONTH ? 31 : field === F.DAY_OF_YEAR ? 366 : maxOf(r, self, field)); def(owner, 'getMinimum', '(I)I', (r, _m, [, field]) => minOf(field));
    def(owner, 'getLeastMaximum', '(I)I', (r, _m, [self, field]) => field === F.DAY_OF_MONTH ? 28 : field === F.DAY_OF_YEAR ? 365 : field === F.WEEK_OF_YEAR ? 52 : maxOf(r, self, field)); def(owner, 'getGreatestMinimum', '(I)I', (r, _m, [, field]) => minOf(field));
    def(owner, 'add', '(II)V', (r, _m, [self, field, amount]) => {
      const c = settle(r, self); if (!amount) return; const f = loadFields(c);
      const year = f[F.ERA] ? f[F.YEAR] : 1 - f[F.YEAR];
      const wall = (y, mo, d) => { c.time = wallToEpoch(c.zone, y, mo, d, f[F.HOUR_OF_DAY], f[F.MINUTE], f[F.SECOND], f[F.MILLISECOND]); c.f = null; };
      if (field === F.YEAR || field === F.MONTH) { const total = (field === F.YEAR ? year + amount : year) * 12 + f[F.MONTH] + (field === F.MONTH ? amount : 0), y = Math.floor(total / 12), mo = ((total % 12) + 12) % 12; wall(y, mo, Math.min(f[F.DAY_OF_MONTH], daysIn(y, mo))); }
      else if ([F.DAY_OF_MONTH, F.DAY_OF_YEAR, F.DAY_OF_WEEK].includes(field)) wall(year, f[F.MONTH], f[F.DAY_OF_MONTH] + amount);
      else if ([F.WEEK_OF_YEAR, F.WEEK_OF_MONTH, F.DAY_OF_WEEK_IN_MONTH].includes(field)) wall(year, f[F.MONTH], f[F.DAY_OF_MONTH] + 7 * amount);
      else if (field === F.AM_PM) { c.time += 12 * 3600000 * amount; c.f = null; }
      else if ([F.HOUR, F.HOUR_OF_DAY].includes(field)) { c.time += 3600000 * amount; c.f = null; } else if (field === F.MINUTE) { c.time += 60000 * amount; c.f = null; } else if (field === F.SECOND) { c.time += 1000 * amount; c.f = null; } else if (field === F.MILLISECOND) { c.time += amount; c.f = null; }
      else r.throwJava('Ljava/lang/IllegalArgumentException;', null);
    });
    const roll = (r, self, field, amount) => {
      const c = settle(r, self), f = loadFields(c), lo = minOf(field), hi = maxOf(r, self, field), span = hi - lo + 1; if (field === F.YEAR) { setField(r, self, F.YEAR, f[F.YEAR] + amount); return; }
      let value = ((f[field] - lo + amount) % span + span) % span + lo; if (field === F.DAY_OF_MONTH || field === F.MONTH) { setField(r, self, field, value); if (field === F.MONTH) { const max = daysIn(f[F.ERA] ? f[F.YEAR] : 1 - f[F.YEAR], value); if (f[F.DAY_OF_MONTH] > max) setField(r, self, F.DAY_OF_MONTH, max); } return; }
      setField(r, self, field, value);
    };
    def(owner, 'roll', '(IZ)V', (r, _m, [self, field, up]) => roll(r, self, field, up ? 1 : -1)); def(owner, 'roll', '(II)V', (r, _m, [self, field, amount]) => roll(r, self, field, amount));
    const cmp = (r, a, b) => { const x = settle(r, a).time, y = settle(r, b).time; return x < y ? -1 : x > y ? 1 : 0; };
    def(owner, 'before', `(${OBJECT})Z`, (r, _m, [self, o]) => o && r.object(o).cal && cmp(r, self, o) < 0 ? 1 : 0); def(owner, 'after', `(${OBJECT})Z`, (r, _m, [self, o]) => o && r.object(o).cal && cmp(r, self, o) > 0 ? 1 : 0);
    def(owner, 'compareTo', `(${CALENDAR})I`, (r, _m, [self, o]) => cmp(r, self, o)); def(owner, 'compareTo', `(${OBJECT})I`, (r, _m, [self, o]) => cmp(r, self, o));
    def(owner, 'equals', `(${OBJECT})Z`, (r, _m, [self, o]) => { if (!o || !r.object(o).cal) return 0; const a = settle(r, self), b = settle(r, o); return a.time === b.time && a.zone === b.zone && a.lenient === b.lenient && a.first === b.first && a.minimal === b.minimal ? 1 : 0; });
    def(owner, 'hashCode', '()I', (r, _m, [self]) => { const c = settle(r, self); return (Number(BigInt.asIntN(32, BigInt(c.time))) ^ c.first ^ c.minimal) | 0; });
    def(owner, 'clone', `()${OBJECT}`, (r, _m, [self]) => { const c = settle(r, self), ref = r.allocate(r.typeOf(self)); r.object(ref).cal = { ...c, f: null, lastSet: [] }; return ref; });
    def(owner, 'getDisplayName', `(II${LOCALE_T})${STRING}`, (r, _m, [self, field, style]) => { const f = loadFields(settle(r, self)); const long = (style & 3) !== 1;
      if (field === F.MONTH) return long ? MONTHS[f[F.MONTH]] : MONTHS[f[F.MONTH]].slice(0, 3); if (field === F.DAY_OF_WEEK) return long ? WEEKDAYS[f[F.DAY_OF_WEEK] - 1] : WEEKDAYS[f[F.DAY_OF_WEEK] - 1].slice(0, 3);
      if (field === F.AM_PM) return f[F.AM_PM] ? 'PM' : 'AM'; if (field === F.ERA) return f[F.ERA] ? (long ? 'AD' : 'AD') : 'BC'; return null; });
    def(owner, 'toInstant', `()${INSTANT}`, (r, _m, [self]) => call(r, INSTANT, 'ofEpochMilli', `(J)${INSTANT}`, [BigInt(settle(r, self).time)]));
    def(owner, 'getCalendarType', `()${STRING}`, () => 'gregory');
    def(owner, 'toString', `()${STRING}`, (r, _m, [self]) => { const c = settle(r, self); return `java.util.GregorianCalendar[time=${c.time},areFieldsSet=true,lenient=${c.lenient},zone=${c.zone},firstDayOfWeek=${c.first},minimalDaysInFirstWeek=${c.minimal}]`; });
  }
  def(CALENDAR, 'getInstance', `()${CALENDAR}`, r => newCalendar(r, GREGORIAN), { static: true });
  def(CALENDAR, 'getInstance', `(${ZONE})${CALENDAR}`, (r, _m, [z]) => newCalendar(r, GREGORIAN, z ? zid(r, z) : undefined), { static: true });
  def(CALENDAR, 'getInstance', `(${LOCALE_T})${CALENDAR}`, r => newCalendar(r, GREGORIAN), { static: true });
  def(CALENDAR, 'getInstance', `(${ZONE}${LOCALE_T})${CALENDAR}`, (r, _m, [z]) => newCalendar(r, GREGORIAN, z ? zid(r, z) : undefined), { static: true });
  def(GREGORIAN, '<init>', '()V', (r, _m, [self]) => { const fresh = newCalendar(r, GREGORIAN); r.object(self).cal = r.object(fresh).cal; });
  def(GREGORIAN, '<init>', `(${ZONE})V`, (r, _m, [self, z]) => { const fresh = newCalendar(r, GREGORIAN, z ? zid(r, z) : undefined); r.object(self).cal = r.object(fresh).cal; });
  def(GREGORIAN, '<init>', `(${LOCALE_T})V`, (r, _m, [self]) => { const fresh = newCalendar(r, GREGORIAN); r.object(self).cal = r.object(fresh).cal; });
  def(GREGORIAN, '<init>', `(${ZONE}${LOCALE_T})V`, (r, _m, [self, z]) => { const fresh = newCalendar(r, GREGORIAN, z ? zid(r, z) : undefined); r.object(self).cal = r.object(fresh).cal; });
  for (const signature of ['(III)V', '(IIIII)V', '(IIIIII)V']) def(GREGORIAN, '<init>', signature, (r, _m, [self, y, mo, d, h = 0, mi = 0, se = 0]) => { const fresh = newCalendar(r, GREGORIAN); const c = r.object(fresh).cal; c.time = wallToEpoch(c.zone, y, mo, d, h, mi, se, 0); r.object(self).cal = c; });
  def(GREGORIAN, 'isLeapYear', '(I)Z', (r, _m, [, year]) => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 1 : 0);
  def(GREGORIAN, 'toZonedDateTime', `()Ljava/time/ZonedDateTime;`, (r, _m, [self]) => call(r, 'Ljava/time/ZonedDateTime;', 'ofInstant', `(${INSTANT}${ZONE_ID})Ljava/time/ZonedDateTime;`, [call(r, INSTANT, 'ofEpochMilli', `(J)${INSTANT}`, [BigInt(settle(r, self).time)]), call(r, 'Ljava/time/ZoneId;', 'of', `(${STRING})${ZONE_ID}`, [cal(r, self).zone])]));
  return { ...registry, interfaces: registry.interfacesOf };
}
