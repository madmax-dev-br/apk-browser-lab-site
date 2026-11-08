import { createHostRegistry, doubleBits, bitsDouble, bitsFloat } from './host-contract.js?v=fa94ded129ca';

// java.text.MessageFormat and java.text.ChoiceFormat, ported method by method from libcore's originals (ojluni, android-13.0.0_r1): applyPattern / makeFormat / subformat / parse /
// toPattern / copyAndFixQuotes of MessageFormat; applyPattern / toPattern / format / parse / nextDouble of ChoiceFormat, with the originals' exception messages. They extend the platform's
// Format and NumberFormat hosts, so the number and date sub-formats are the platform's own NumberFormat, DecimalFormat, DateFormat and SimpleDateFormat objects.
// Not modelled: formatToCharacterIterator and MessageFormat.Field (they need AttributedString / Format.Field), and an NumberFormat-style cause on the "can't parse argument number" error.
const MF = 'Ljava/text/MessageFormat;', CF = 'Ljava/text/ChoiceFormat;', FORMAT = 'Ljava/text/Format;', NF = 'Ljava/text/NumberFormat;', DF = 'Ljava/text/DecimalFormat;', DFS = 'Ljava/text/DecimalFormatSymbols;';
const DATE_FORMAT = 'Ljava/text/DateFormat;', SDF = 'Ljava/text/SimpleDateFormat;', PP = 'Ljava/text/ParsePosition;', FP = 'Ljava/text/FieldPosition;', SB = 'Ljava/lang/StringBuffer;', STRING = 'Ljava/lang/String;';
const OBJECT = 'Ljava/lang/Object;', OBJECTS = '[Ljava/lang/Object;', LOCALE = 'Ljava/util/Locale;', NUMBER = 'Ljava/lang/Number;';
const TYPE_KEYWORDS = ['', 'number', 'date', 'time', 'choice'], NUMBER_MODIFIERS = ['', 'currency', 'percent', 'integer'], DATE_TIME_MODIFIERS = ['', 'short', 'medium', 'long', 'full'];
const DATE_STYLES = [2, 3, 2, 1, 0];   // DateFormat.DEFAULT (=MEDIUM), SHORT, MEDIUM, LONG, FULL

export function createMessageFormatHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const nullish = value => value === null || value === undefined || value === 0;
  type(MF, FORMAT, [], { allocatable: true }); type(CF, NF, [], { allocatable: true });
  const str = (r, v) => (nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v));
  const throwNew = (r, name, message) => r.throwJava(`Ljava/lang/${name};`, message);
  const iae = (r, message) => throwNew(r, 'IllegalArgumentException', message);
  const virtual = (r, receiver, owner, name, parameters = [], result = 'V', values = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, values, { receiver }), 'virtual');
  const staticCall = (r, owner, name, parameters, result, values) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, values), 'static');
  const construct = (r, owner, parameters, values) => { const ref = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, values, { receiver: ref }), 'direct'); return ref; };
  const javaHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; };
  const append = (r, buffer, text) => { r.object(buffer).builder = (r.object(buffer).builder ?? '') + text; return buffer; };
  const bufferLength = (r, buffer) => (r.object(buffer).builder ?? '').length;
  const stringArray = (r, values) => { const a = r.newArray(`[${STRING}`, values.length); r.array(a).elements = [...values]; return a; };

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------- ChoiceFormat
  const NEG_ZERO_BITS = 0x8000000000000000n, EXPONENT = 0x7ff0000000000000n, POSITIVE_INFINITY_BITS = 0x7ff0000000000000n;
  const nextDouble = (d, positive) => {
    if (Number.isNaN(d)) return d;
    if (d === 0) return positive ? Number.MIN_VALUE : -Number.MIN_VALUE;
    const bits = doubleBits(d), signed = BigInt.asIntN(64, bits);
    let magnitude = bits & ~NEG_ZERO_BITS & 0xffffffffffffffffn;
    if ((signed > 0n) === positive) { if (magnitude !== POSITIVE_INFINITY_BITS) magnitude += 1n; } else magnitude -= 1n;
    return bitsDouble((magnitude | (bits & NEG_ZERO_BITS)) & 0xffffffffffffffffn);
  };
  void EXPONENT;
  const choice = (r, self) => r.object(self).choice ?? throwNew(r, 'IllegalStateException', 'ChoiceFormat used before construction');
  const parseDoubleText = (r, text) => bitsDouble(staticCall(r, 'Ljava/lang/Double;', 'parseDouble', [STRING], 'D', [text]));
  const javaDoubleString = (r, value) => str(r, staticCall(r, 'Ljava/lang/Double;', 'toString', ['D'], STRING, [doubleBits(value)]));
  const applyChoicePattern = (r, self, pattern) => {
    const segments = ['', ''], limits = [], formats = []; let part = 0, startValue = 0, oldStartValue = NaN, inQuote = false;
    for (let i = 0; i < pattern.length; ++i) {
      const ch = pattern[i];
      if (ch === "'") { if (i + 1 < pattern.length && pattern[i + 1] === ch) { segments[part] += ch; ++i; } else inQuote = !inQuote; }
      else if (inQuote) segments[part] += ch;
      else if (ch === '<' || ch === '#' || ch === '≤') {
        if (segments[0].length === 0) iae(r, 'Each interval must contain a number before a format');
        const text = segments[0];
        if (text === '∞') startValue = Infinity; else if (text === '-∞') startValue = -Infinity; else startValue = parseDoubleText(r, text);
        if (ch === '<' && startValue !== Infinity && startValue !== -Infinity) startValue = nextDouble(startValue, true);
        if (startValue <= oldStartValue) iae(r, 'Incorrect order of intervals, must be in ascending order');
        segments[0] = ''; part = 1;
      } else if (ch === '|') { limits.push(startValue); formats.push(segments[1]); oldStartValue = startValue; segments[1] = ''; part = 0; }
      else segments[part] += ch;
    }
    if (part === 1) { limits.push(startValue); formats.push(segments[1]); }
    r.object(self).choice = { limits, formats };
  };
  const newChoice = (r, pattern) => { const ref = r.allocate(CF); applyChoicePattern(r, ref, pattern); return ref; };
  const choiceToPattern = (r, c) => {
    let result = '';
    for (let i = 0; i < c.limits.length; ++i) {
      if (i !== 0) result += '|';
      const limit = c.limits[i], less = nextDouble(limit, false);
      const ieeeRemainder = x => { const f = Math.floor(x), d = x - f, n = d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1); return x - n; };
      const tryLessOrEqual = Number.isFinite(limit) ? Math.abs(ieeeRemainder(limit)) : NaN, tryLess = Number.isFinite(less) ? Math.abs(ieeeRemainder(less)) : NaN;
      if (tryLessOrEqual < tryLess) result += javaDoubleString(r, limit) + '#';
      else { result += limit === Infinity ? '∞' : limit === -Infinity ? '-∞' : javaDoubleString(r, less); result += '<'; }
      const text = c.formats[i], needQuote = /[<#≤|]/.test(text);
      if (needQuote) result += "'";
      result += text.includes("'") ? text.replaceAll("'", "''") : text;
      if (needQuote) result += "'";
    }
    return result;
  };
  const choiceFormat = (c, number) => { let i; for (i = 0; i < c.limits.length; ++i) if (!(number >= c.limits[i])) break; --i; if (i < 0) i = 0; return c.formats[i]; };
  const numberValue = (r, object) => {
    if (nullish(object)) iae(r, 'Cannot format given Object as a Number');
    const o = r.object(object);
    if (o.boxed !== undefined && o.primitiveType !== 'Z' && o.primitiveType !== 'C') return o.primitiveType === 'D' ? { double: bitsDouble(o.boxed) } : o.primitiveType === 'F' ? { double: bitsFloat(o.boxed) } : { long: BigInt(o.boxed) };
    if (!r.isSubtype(o.type, NUMBER)) iae(r, 'Cannot format given Object as a Number');
    if (/Atomic(Integer|Long)$/.test(o.type)) return { long: BigInt(virtual(r, object, NUMBER, 'longValue', [], 'J')) };
    return { double: bitsDouble(virtual(r, object, NUMBER, 'doubleValue', [], 'D')) };
  };
  const doubleText = value => value;
  def(CF, '<init>', `(${STRING})V`, (r, _m, [self, pattern]) => { if (nullish(pattern)) throwNew(r, 'NullPointerException', null); applyChoicePattern(r, self, str(r, pattern)); });
  def(CF, '<init>', `([D[${STRING})V`, (r, _m, [self, limits, formats]) => setChoices(r, self, limits, formats));
  const setChoices = (r, self, limits, formats) => {
    const l = r.array(limits).elements, f = r.array(formats).elements;
    if (l.length !== f.length) iae(r, 'Array and limit arrays must be of the same length.');
    r.object(self).choice = { limits: l.map(bitsDouble), formats: f.map(v => str(r, v)) };
  };
  def(CF, 'applyPattern', `(${STRING})V`, (r, _m, [self, pattern]) => { if (nullish(pattern)) throwNew(r, 'NullPointerException', null); applyChoicePattern(r, self, str(r, pattern)); });
  def(CF, 'toPattern', `()${STRING}`, (r, _m, [self]) => choiceToPattern(r, choice(r, self)));
  def(CF, 'setChoices', `([D[${STRING})V`, (r, _m, [self, limits, formats]) => setChoices(r, self, limits, formats));
  def(CF, 'getLimits', '()[D', (r, _m, [self]) => { const a = r.newArray('[D', choice(r, self).limits.length); r.array(a).elements = choice(r, self).limits.map(doubleBits); return a; });
  def(CF, 'getFormats', `()${OBJECTS}`, (r, _m, [self]) => { const a = r.newArray(OBJECTS, choice(r, self).formats.length); r.array(a).elements = [...choice(r, self).formats]; return a; });
  const formatDouble = (r, self, value) => choiceFormat(choice(r, self), value);
  def(CF, 'format', `(D)${STRING}`, (r, _m, [self, d]) => formatDouble(r, self, bitsDouble(d)));
  def(CF, 'format', `(J)${STRING}`, (r, _m, [self, l]) => formatDouble(r, self, Number(l)));
  def(CF, 'format', `(${OBJECT})${STRING}`, (r, _m, [self, object]) => { const n = numberValue(r, object); return formatDouble(r, self, n.long !== undefined ? Number(n.long) : n.double); });
  def(CF, 'format', `(D${SB}${FP})${SB}`, (r, _m, [self, d, buffer]) => append(r, buffer, formatDouble(r, self, bitsDouble(d))));
  def(CF, 'format', `(J${SB}${FP})${SB}`, (r, _m, [self, l, buffer]) => append(r, buffer, formatDouble(r, self, Number(l))));
  def(CF, 'format', `(${OBJECT}${SB}${FP})${SB}`, (r, _m, [self, object, buffer]) => { const n = numberValue(r, object); return append(r, buffer, formatDouble(r, self, n.long !== undefined ? Number(n.long) : n.double)); });
  const ppIndex = (r, pp) => virtual(r, pp, PP, 'getIndex', [], 'I'), setPpIndex = (r, pp, v) => virtual(r, pp, PP, 'setIndex', ['I'], 'V', [v]), setPpError = (r, pp, v) => virtual(r, pp, PP, 'setErrorIndex', ['I'], 'V', [v]);
  const boxDouble = (r, value) => staticCall(r, 'Ljava/lang/Double;', 'valueOf', ['D'], 'Ljava/lang/Double;', [doubleBits(value)]);
  const choiceParse = (r, self, text, status) => {
    const c = choice(r, self), source = str(r, text), start = ppIndex(r, status); let furthest = start, best = NaN;
    for (let i = 0; i < c.formats.length; ++i) {
      const candidate = c.formats[i];
      if (source.startsWith(candidate, start)) {
        const end = start + candidate.length; setPpIndex(r, status, end);
        if (end > furthest) { furthest = end; best = c.limits[i]; if (furthest === source.length) break; }
      }
    }
    setPpIndex(r, status, furthest);
    if (furthest === start) setPpError(r, status, furthest);
    return boxDouble(r, best);
  };
  def(CF, 'parse', `(${STRING}${PP})${NUMBER}`, (r, _m, [self, text, status]) => choiceParse(r, self, text, status));
  def(CF, 'parseObject', `(${STRING}${PP})${OBJECT}`, (r, _m, [self, text, status]) => choiceParse(r, self, text, status));
  def(CF, 'parse', `(${STRING})${NUMBER}`, (r, _m, [self, text]) => {
    const pp = construct(r, PP, ['I'], [0]), number = choiceParse(r, self, text, pp);
    if (ppIndex(r, pp) === 0) { const e = construct(r, 'Ljava/text/ParseException;', [STRING, 'I'], [`Unparseable number: "${str(r, text)}"`, virtual(r, pp, PP, 'getErrorIndex', [], 'I')]); r.throwJavaReference(e, null); }
    return number;
  });
  def(CF, 'nextDouble', '(D)D', (r, _m, [d]) => doubleBits(nextDouble(bitsDouble(d), true)), { static: true });
  def(CF, 'nextDouble', '(DZ)D', (r, _m, [d, positive]) => doubleBits(nextDouble(bitsDouble(d), !!positive)), { static: true });
  def(CF, 'previousDouble', '(D)D', (r, _m, [d]) => doubleBits(nextDouble(bitsDouble(d), false)), { static: true });
  def(CF, 'clone', `()${OBJECT}`, (r, _m, [self]) => { const copy = r.allocate(CF), c = choice(r, self); r.object(copy).choice = { limits: [...c.limits], formats: [...c.formats] }; return copy; });
  def(CF, 'hashCode', '()I', (r, _m, [self]) => { const c = choice(r, self); let h = c.limits.length; if (c.formats.length > 0) h ^= javaHash(c.formats[c.formats.length - 1]); return h; });
  def(CF, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => {
    if (nullish(other)) return 0; if (self === other) return 1; if (r.typeOf(other) !== r.typeOf(self)) return 0;
    const a = choice(r, self), b = choice(r, other);
    return a.limits.length === b.limits.length && a.limits.every((v, i) => Object.is(v, b.limits[i])) && a.formats.every((v, i) => v === b.formats[i]) ? 1 : 0;
  });
  void doubleText;

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------- MessageFormat
  const state = (r, self) => r.object(self).messageFormat ?? throwNew(r, 'IllegalStateException', 'MessageFormat used before construction');
  const localeOf = (r, self) => state(r, self).localeRef;
  const defaultLocale = r => staticCall(r, LOCALE, 'getDefault', [], LOCALE, []);
  const getNumberInstance = (r, kind, locale) => staticCall(r, NF, kind, [LOCALE], NF, [locale]);
  const findKeyword = (s, list) => {
    for (let i = 0; i < list.length; ++i) if (s === list[i]) return i;
    const ls = s.trim().toLowerCase();
    if (ls !== s) for (let i = 0; i < list.length; ++i) if (ls === list[i]) return i;
    return -1;
  };
  const copyAndFixQuotes = (source, start, end) => {
    let quoted = false, target = '';
    for (let i = start; i < end; ++i) {
      const ch = source[i];
      if (ch === '{') { if (!quoted) { target += "'"; quoted = true; } target += ch; }
      else if (ch === "'") target += "''";
      else { if (quoted) { target += "'"; quoted = false; } target += ch; }
    }
    if (quoted) target += "'";
    return target;
  };
  const makeFormat = (r, self, offsetNumber, segs) => {
    const s = state(r, self), index = segs[1];
    if (!/^[+-]?\d+$/.test(index) || Math.abs(Number(index)) > 2147483648 || Number(index) > 2147483647 || Number(index) < -2147483648) iae(r, `can't parse argument number: ${index}`);
    const argumentNumber = Number(index);
    if (argumentNumber < 0) iae(r, `negative argument number: ${argumentNumber}`);
    const oldMaxOffset = s.maxOffset; s.maxOffset = offsetNumber;
    s.offsets[offsetNumber] = segs[0].length; s.argumentNumbers[offsetNumber] = argumentNumber;
    let newFormat = null;
    if (segs[2].length > 0) {
      const kind = findKeyword(segs[2], TYPE_KEYWORDS), locale = s.localeRef;
      switch (kind) {
        case 0: break;
        case 1: {
          switch (findKeyword(segs[3], NUMBER_MODIFIERS)) {
            case 0: newFormat = getNumberInstance(r, 'getInstance', locale); break;
            case 1: newFormat = getNumberInstance(r, 'getCurrencyInstance', locale); break;
            case 2: newFormat = getNumberInstance(r, 'getPercentInstance', locale); break;
            case 3: newFormat = getNumberInstance(r, 'getIntegerInstance', locale); break;
            default:
              try { newFormat = construct(r, DF, [STRING, DFS], [segs[3], staticCall(r, DFS, 'getInstance', [LOCALE], DFS, [locale])]); } catch (error) { s.maxOffset = oldMaxOffset; throw error; }
          }
          break;
        }
        case 2: case 3: {
          const mod = findKeyword(segs[3], DATE_TIME_MODIFIERS);
          if (mod >= 0 && mod < DATE_TIME_MODIFIERS.length) newFormat = staticCall(r, DATE_FORMAT, kind === 2 ? 'getDateInstance' : 'getTimeInstance', ['I', LOCALE], DATE_FORMAT, [DATE_STYLES[mod], locale]);
          else { try { newFormat = construct(r, SDF, [STRING, LOCALE], [segs[3], locale]); } catch (error) { s.maxOffset = oldMaxOffset; throw error; } }
          break;
        }
        case 4:
          try { newFormat = newChoice(r, segs[3]); } catch (error) { s.maxOffset = oldMaxOffset; iae(r, `Choice Pattern incorrect: ${segs[3]}`); }
          break;
        default: s.maxOffset = oldMaxOffset; iae(r, `unknown format type: ${segs[2]}`);
      }
    }
    s.formatRefs[offsetNumber] = newFormat;
  };
  const applyPattern = (r, self, pattern) => {
    if (nullish(pattern)) throwNew(r, 'NullPointerException', null);
    const source = str(r, pattern), s = state(r, self);
    const segments = ['', '', '', ''];
    let part = 0, formatNumber = 0, inQuote = false, braceStack = 0; s.maxOffset = -1; s.formatRefs = []; s.offsets = []; s.argumentNumbers = [];
    for (let i = 0; i < source.length; ++i) {
      const ch = source[i];
      if (part === 0) {
        if (ch === "'") { if (i + 1 < source.length && source[i + 1] === "'") { segments[part] += ch; ++i; } else inQuote = !inQuote; }
        else if (ch === '{' && !inQuote) { part = 1; }
        else segments[part] += ch;
      } else if (inQuote) { segments[part] += ch; if (ch === "'") inQuote = false; }
      else {
        switch (ch) {
          case ',': if (part < 3) { ++part; } else segments[part] += ch; break;
          case '{': ++braceStack; segments[part] += ch; break;
          case '}':
            if (braceStack === 0) { part = 0; makeFormat(r, self, formatNumber, segments); formatNumber++; segments[1] = segments[2] = segments[3] = ''; }
            else { --braceStack; segments[part] += ch; }
            break;
          case ' ': if (part !== 2 || segments[2].length > 0) segments[part] += ch; break;
          case "'": inQuote = true; segments[part] += ch; break;
          default: segments[part] += ch;
        }
      }
    }
    if (braceStack === 0 && part !== 0) { s.maxOffset = -1; iae(r, 'Unmatched braces in the pattern.'); }
    s.pattern = segments[0];
  };
  const newState = (r, self, locale) => { r.object(self).messageFormat = { localeRef: locale, pattern: '', formatRefs: [], offsets: [], argumentNumbers: [], maxOffset: -1 }; };
  def(MF, '<init>', `(${STRING})V`, (r, _m, [self, pattern]) => { newState(r, self, defaultLocale(r)); applyPattern(r, self, pattern); });
  def(MF, '<init>', `(${STRING}${LOCALE})V`, (r, _m, [self, pattern, locale]) => { newState(r, self, locale); applyPattern(r, self, pattern); });
  def(MF, 'setLocale', `(${LOCALE})V`, (r, _m, [self, locale]) => { state(r, self).localeRef = locale; });
  def(MF, 'getLocale', `()${LOCALE}`, (r, _m, [self]) => localeOf(r, self));
  def(MF, 'applyPattern', `(${STRING})V`, (r, _m, [self, pattern]) => applyPattern(r, self, pattern));
  const equalsRef = (r, a, b) => (a === b ? true : nullish(a) ? nullish(b) : !nullish(b) && virtual(r, a, OBJECT, 'equals', [OBJECT], 'Z', [b]) === 1);
  def(MF, 'toPattern', `()${STRING}`, (r, _m, [self]) => {
    const s = state(r, self), locale = s.localeRef; let lastOffset = 0, result = '';
    for (let i = 0; i <= s.maxOffset; ++i) {
      result += copyAndFixQuotes(s.pattern, lastOffset, s.offsets[i]); lastOffset = s.offsets[i];
      result += `{${s.argumentNumbers[i]}`;
      const fmt = s.formatRefs[i];
      if (nullish(fmt)) { /* string format */ }
      else if (r.isSubtype(r.typeOf(fmt), NF)) {
        if (equalsRef(r, fmt, getNumberInstance(r, 'getInstance', locale))) result += ',number';
        else if (equalsRef(r, fmt, getNumberInstance(r, 'getCurrencyInstance', locale))) result += ',number,currency';
        else if (equalsRef(r, fmt, getNumberInstance(r, 'getPercentInstance', locale))) result += ',number,percent';
        else if (equalsRef(r, fmt, getNumberInstance(r, 'getIntegerInstance', locale))) result += ',number,integer';
        else if (r.isSubtype(r.typeOf(fmt), DF)) result += `,number,${str(r, virtual(r, fmt, DF, 'toPattern', [], STRING))}`;
        else if (r.isSubtype(r.typeOf(fmt), CF)) result += `,choice,${choiceToPattern(r, choice(r, fmt))}`;
      } else if (r.isSubtype(r.typeOf(fmt), DATE_FORMAT)) {
        let index;
        for (index = 0; index < DATE_STYLES.length; index++) {
          if (equalsRef(r, fmt, staticCall(r, DATE_FORMAT, 'getDateInstance', ['I', LOCALE], DATE_FORMAT, [DATE_STYLES[index], locale]))) { result += ',date'; break; }
          if (equalsRef(r, fmt, staticCall(r, DATE_FORMAT, 'getTimeInstance', ['I', LOCALE], DATE_FORMAT, [DATE_STYLES[index], locale]))) { result += ',time'; break; }
        }
        if (index >= DATE_STYLES.length) { if (r.isSubtype(r.typeOf(fmt), SDF)) result += `,date,${str(r, virtual(r, fmt, SDF, 'toPattern', [], STRING))}`; }
        else if (index !== 0) result += `,${DATE_TIME_MODIFIERS[index]}`;
      }
      result += '}';
    }
    return result + copyAndFixQuotes(s.pattern, lastOffset, s.pattern.length);
  });
  // setFormats & co: arrays of Format (null entries allowed)
  const formatArray = (r, values) => { const a = r.newArray(`[${FORMAT}`, values.length); r.array(a).elements = values.map(v => (nullish(v) ? null : v)); return a; };
  def(MF, 'setFormatsByArgumentIndex', `([${FORMAT})V`, (r, _m, [self, formats]) => { const s = state(r, self), list = r.array(formats).elements; for (let i = 0; i <= s.maxOffset; i++) { const j = s.argumentNumbers[i]; if (j < list.length) s.formatRefs[i] = list[j]; } });
  def(MF, 'setFormats', `([${FORMAT})V`, (r, _m, [self, formats]) => { const s = state(r, self), list = r.array(formats).elements, runs = Math.min(list.length, s.maxOffset + 1); for (let i = 0; i < runs; i++) s.formatRefs[i] = list[i]; });
  def(MF, 'setFormatByArgumentIndex', `(I${FORMAT})V`, (r, _m, [self, argumentIndex, format]) => { const s = state(r, self); for (let j = 0; j <= s.maxOffset; j++) if (s.argumentNumbers[j] === argumentIndex) s.formatRefs[j] = format; });
  def(MF, 'setFormat', `(I${FORMAT})V`, (r, _m, [self, index, format]) => { const s = state(r, self); if (index > s.maxOffset) throwNew(r, 'ArrayIndexOutOfBoundsException', `length=${s.maxOffset + 1}; index=${index}`); s.formatRefs[index] = format; });
  def(MF, 'getFormatsByArgumentIndex', `()[${FORMAT}`, (r, _m, [self]) => {
    const s = state(r, self); let max = -1; for (let i = 0; i <= s.maxOffset; i++) if (s.argumentNumbers[i] > max) max = s.argumentNumbers[i];
    const out = new Array(max + 1).fill(null); for (let i = 0; i <= s.maxOffset; i++) out[s.argumentNumbers[i]] = s.formatRefs[i] ?? null; return formatArray(r, out);
  });
  def(MF, 'getFormats', `()[${FORMAT}`, (r, _m, [self]) => { const s = state(r, self); return formatArray(r, s.formatRefs.slice(0, s.maxOffset + 1).map(v => v ?? null)); });
  // formatting
  const isNumberObject = (r, obj) => { const o = r.object(obj); return (o.boxed !== undefined && o.primitiveType !== 'Z' && o.primitiveType !== 'C') || r.isSubtype(o.type, NUMBER); };
  const subformat = (r, self, argumentsRef, resultBuffer) => {
    const s = state(r, self), args = nullish(argumentsRef) ? null : r.array(argumentsRef).elements; let lastOffset = 0;
    for (let i = 0; i <= s.maxOffset; ++i) {
      append(r, resultBuffer, s.pattern.slice(lastOffset, s.offsets[i])); lastOffset = s.offsets[i];
      const argumentNumber = s.argumentNumbers[i];
      if (args === null || argumentNumber >= args.length) { append(r, resultBuffer, `{${argumentNumber}}`); continue; }
      let obj = args[argumentNumber], arg = null, sub = null;
      if (nullish(obj)) arg = 'null';
      else if (!nullish(s.formatRefs[i])) {
        sub = s.formatRefs[i];
        if (r.isSubtype(r.typeOf(sub), CF)) {
          arg = str(r, virtual(r, sub, FORMAT, 'format', [OBJECT], STRING, [obj]));
          if (arg.includes('{')) { sub = construct(r, MF, [STRING, LOCALE], [arg, s.localeRef]); obj = argumentsRef; arg = null; }
        }
      } else if (typeof obj === 'string') arg = obj;
      else if (isNumberObject(r, obj)) sub = getNumberInstance(r, 'getInstance', s.localeRef);
      else if (r.isSubtype(r.typeOf(obj), 'Ljava/util/Date;')) sub = staticCall(r, DATE_FORMAT, 'getDateTimeInstance', ['I', 'I', LOCALE], DATE_FORMAT, [3, 3, s.localeRef]);
      else arg = str(r, virtual(r, obj, OBJECT, 'toString', [], STRING)) ?? 'null';
      if (sub !== null) arg = str(r, virtual(r, sub, FORMAT, 'format', [OBJECT], STRING, [obj]));
      append(r, resultBuffer, arg);
    }
    append(r, resultBuffer, s.pattern.slice(lastOffset));
    return resultBuffer;
  };
  def(MF, 'format', `(${OBJECTS}${SB}${FP})${SB}`, (r, _m, [self, args, buffer]) => subformat(r, self, args, buffer));
  def(MF, 'format', `(${OBJECT}${SB}${FP})${SB}`, (r, _m, [self, args, buffer]) => subformat(r, self, args, buffer));
  def(MF, 'format', `(${OBJECT})${STRING}`, (r, _m, [self, args]) => { const buffer = r.allocate(SB); r.dispatch({ owner: SB, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [buffer], 'direct'); return r.object(subformat(r, self, args, buffer)).builder ?? ''; });
  def(MF, 'format', `(${STRING}${OBJECTS})${STRING}`, (r, _m, [pattern, args]) => {
    const temp = construct(r, MF, [STRING], [pattern]), buffer = r.allocate(SB); r.dispatch({ owner: SB, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [buffer], 'direct');
    return r.object(subformat(r, temp, args, buffer)).builder ?? '';
  }, { static: true });
  def(MF, 'formatToCharacterIterator', `(${OBJECT})Ljava/text/AttributedCharacterIterator;`, r => throwNew(r, 'UnsupportedOperationException', 'MessageFormat.formatToCharacterIterator needs AttributedString, which this device does not provide'));
  // parsing
  const parse = (r, self, source, pos) => {
    const s = state(r, self); if (nullish(source)) return r.newArray(OBJECTS, 0);
    const text = str(r, source); let max = -1; for (let i = 0; i <= s.maxOffset; i++) if (s.argumentNumbers[i] > max) max = s.argumentNumbers[i];
    const result = new Array(max + 1).fill(null), temp = construct(r, PP, ['I'], [0]);
    let patternOffset = 0, sourceOffset = ppIndex(r, pos);
    for (let i = 0; i <= s.maxOffset; ++i) {
      const len = s.offsets[i] - patternOffset;
      if (len === 0 || s.pattern.substr(patternOffset, len) === text.substr(sourceOffset, len) && sourceOffset + len <= text.length) { sourceOffset += len; patternOffset += len; }
      else { setPpError(r, pos, sourceOffset); return null; }
      if (nullish(s.formatRefs[i])) {
        const tempLength = i !== s.maxOffset ? s.offsets[i + 1] : s.pattern.length;
        const next = patternOffset >= tempLength ? text.length : text.indexOf(s.pattern.slice(patternOffset, tempLength), sourceOffset);
        if (next < 0) { setPpError(r, pos, sourceOffset); return null; }
        const value = text.slice(sourceOffset, next);
        if (value !== `{${s.argumentNumbers[i]}}`) result[s.argumentNumbers[i]] = value;
        sourceOffset = next;
      } else {
        setPpIndex(r, temp, sourceOffset);
        result[s.argumentNumbers[i]] = virtual(r, s.formatRefs[i], FORMAT, 'parseObject', [STRING, PP], OBJECT, [source, temp]);
        if (ppIndex(r, temp) === sourceOffset) { setPpError(r, pos, sourceOffset); return null; }
        sourceOffset = ppIndex(r, temp);
      }
    }
    const len = s.pattern.length - patternOffset;
    if (len === 0 || (text.substr(sourceOffset, len) === s.pattern.substr(patternOffset, len) && sourceOffset + len <= text.length)) setPpIndex(r, pos, sourceOffset + len);
    else { setPpError(r, pos, sourceOffset); return null; }
    const array = r.newArray(OBJECTS, result.length); r.array(array).elements = result.map(v => v ?? null); return array;
  };
  def(MF, 'parse', `(${STRING}${PP})${OBJECTS}`, (r, _m, [self, source, pos]) => parse(r, self, source, pos));
  def(MF, 'parseObject', `(${STRING}${PP})${OBJECT}`, (r, _m, [self, source, pos]) => parse(r, self, source, pos));
  def(MF, 'parse', `(${STRING})${OBJECTS}`, (r, _m, [self, source]) => {
    const pos = construct(r, PP, ['I'], [0]), result = parse(r, self, source, pos);
    if (ppIndex(r, pos) === 0) { const e = construct(r, 'Ljava/text/ParseException;', [STRING, 'I'], ['MessageFormat parse error!', virtual(r, pos, PP, 'getErrorIndex', [], 'I')]); r.throwJavaReference(e, null); }
    return result;
  });
  def(MF, 'clone', `()${OBJECT}`, (r, _m, [self]) => {
    const copy = r.allocate(MF), s = state(r, self);
    r.object(copy).messageFormat = { localeRef: s.localeRef, pattern: s.pattern, maxOffset: s.maxOffset, offsets: [...s.offsets], argumentNumbers: [...s.argumentNumbers], formatRefs: s.formatRefs.map(f => (nullish(f) ? null : virtual(r, f, OBJECT, 'clone', [], OBJECT))) };
    return copy;
  });
  def(MF, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => {
    if (self === other) return 1; if (nullish(other) || r.typeOf(other) !== r.typeOf(self)) return 0;
    const a = state(r, self), b = state(r, other);
    if (a.maxOffset !== b.maxOffset || a.pattern !== b.pattern || !(nullish(a.localeRef) ? nullish(b.localeRef) : equalsRef(r, a.localeRef, b.localeRef))) return 0;
    for (let i = 0; i < Math.max(a.formatRefs.length, b.formatRefs.length, a.offsets.length); i++) {
      if ((a.offsets[i] ?? 0) !== (b.offsets[i] ?? 0) || (a.argumentNumbers[i] ?? 0) !== (b.argumentNumbers[i] ?? 0) || !equalsRef(r, a.formatRefs[i] ?? null, b.formatRefs[i] ?? null)) return 0;
    }
    return 1;
  });
  def(MF, 'hashCode', '()I', (r, _m, [self]) => javaHash(state(r, self).pattern));
  // Format.format(Object) / parseObject(String) for subclasses declared by apps (the platform's own formats define theirs)
  def(FORMAT, 'format', `(${OBJECT})${STRING}`, (r, _m, [self, object]) => {
    const buffer = r.allocate(SB); r.dispatch({ owner: SB, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [buffer], 'direct');
    const out = virtual(r, self, FORMAT, 'format', [OBJECT, SB, FP], SB, [object, buffer, construct(r, FP, ['I'], [0])]);
    return r.object(out).builder ?? '';
  });
  return { ...registry };
}
