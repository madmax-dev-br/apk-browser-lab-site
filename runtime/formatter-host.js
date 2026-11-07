import { createHostRegistry, bitsDouble, bitsFloat } from './host-contract.js?v=4bc73c32ad67';

// java.lang.String.format(...) / java.util.Formatter conversions: %s %S %d %x %X %o %c %b %B %h %n %% %f %e %E %g %G with the flags - # + space 0 , ( and
// argument indices (%1$s, %<s). Number formatting uses ASCII digits with the locale's decimal/grouping separators from Intl. Date/time (%t) and
// BigInteger arguments (%d %x %X %o, with their sign / '#' / ',' / '(' flags) and BigDecimal arguments (%f %e %E %g %G, HALF_UP like java.util.Formatter) use the original math classes. Contract: java.util.Formatter (android-13.0.0_r1 libcore).
const STRING = 'Ljava/lang/String;', LOCALE = 'Ljava/util/Locale;', OBJECTS = '[Ljava/lang/Object;';
const SPEC = /%(\d+\$|<)?([-#+ 0,(]*)(\d+)?(?:\.(\d+))?([tT]?[a-zA-Z%])/g;

export function createFormatterHost(platform) {

/**
 * java.util.Formatter %f / %e of a double (OpenJDK FormattedFloatingDecimal): the digits are the SHORTEST decimal that round-trips (Double.toString's digits), rounded HALF_UP at the requested
 * precision -- so 1.005 prints 1.01 and 0.125 prints 0.13, where rounding the exact binary value (JavaScript's toFixed) would print 1.00.
 */
function shortestDigits(a) { const [mantissa, exponent] = a.toExponential().split('e'); return { digits: mantissa.replace('.', ''), exp10: Number(exponent) }; }
function javaFixed(a, precision) {
  if (a === 0) return precision > 0 ? '0.' + '0'.repeat(precision) : '0';
  const { digits, exp10 } = shortestDigits(a), n = BigInt(digits), k = exp10 - (digits.length - 1) + precision;
  const rounded = k >= 0 ? n * 10n ** BigInt(k) : (n + 5n * 10n ** BigInt(-k - 1)) / 10n ** BigInt(-k);
  let text = rounded.toString().padStart(precision + 1, '0');
  return precision > 0 ? text.slice(0, text.length - precision) + '.' + text.slice(text.length - precision) : text;
}
function javaExponential(a, precision) {
  if (a === 0) return (precision > 0 ? '0.' + '0'.repeat(precision) : '0') + 'e0';
  const { digits, exp10 } = shortestDigits(a); let exponent = exp10, kept = digits;
  if (digits.length > precision + 1) { let n = BigInt(digits.slice(0, precision + 1)); if (digits.charCodeAt(precision + 1) >= 53) n += 1n; kept = n.toString(); if (kept.length > precision + 1) { kept = kept.slice(0, precision + 1); exponent++; } }
  kept = kept.padEnd(precision + 1, '0');
  return (precision > 0 ? kept[0] + '.' + kept.slice(1) : kept) + 'e' + exponent;
}

  const registry = createHostRegistry(), { def, type } = registry;
  for (const name of ['IllegalFormatException', 'MissingFormatArgumentException', 'UnknownFormatConversionException', 'IllegalFormatConversionException', 'FormatFlagsConversionMismatchException', 'MissingFormatWidthException', 'IllegalFormatPrecisionException'])
    type(`Ljava/util/${name};`, name === 'IllegalFormatException' ? 'Ljava/lang/IllegalArgumentException;' : 'Ljava/util/IllegalFormatException;');
  const separators = new Map();
  const seps = tag => { if (!separators.has(tag)) { const parts = new Intl.NumberFormat(tag).formatToParts(1234567.5); separators.set(tag, { group: parts.find(p => p.type === 'group')?.value ?? ',', decimal: parts.find(p => p.type === 'decimal')?.value ?? '.' }); } return separators.get(tag); };
  const BOX = { 'Ljava/lang/Byte;': ['int', 8], 'Ljava/lang/Short;': ['int', 16], 'Ljava/lang/Integer;': ['int', 32], 'Ljava/lang/Long;': ['int', 64], 'Ljava/lang/Float;': ['float'], 'Ljava/lang/Double;': ['float'], 'Ljava/lang/Character;': ['char'], 'Ljava/lang/Boolean;': ['bool'] };
  const javaName = t => t.slice(1, -1).replaceAll('/', '.');

  function format(r, pattern, args, tag) {
    const { group, decimal } = seps(tag); let out = '', index = 0, last = -1, ordinary = 0, position = 0;
    for (const m of pattern.matchAll(SPEC)) {
      out += pattern.slice(position, m.index); position = m.index + m[0].length;
      const [whole, ref, flags, widthText, precisionText, conv] = m, width = widthText ? Number(widthText) : -1, precision = precisionText !== undefined ? Number(precisionText) : -1;
      const c = conv.toLowerCase(), upper = conv !== c && conv !== '%' && conv !== 'n';
      if (conv === 'n') { out += '\n'; continue; }
      if (conv === '%') { out += pad('%', width, flags.includes('-')); continue; }
      if (conv.length === 2) throw new Error(`Formatter date/time conversion %${conv} is not implemented`);
      if (!'sdxoficeghbEGXHBSC'.includes(conv) && !'sdxofcegbhn'.includes(c)) r.throwJava('Ljava/util/UnknownFormatConversionException;', `Conversion = '${conv}'`);
      const argIndex = ref === '<' ? last : ref ? Number(ref.slice(0, -1)) - 1 : ordinary++;
      if (argIndex < 0 || argIndex >= args.length) r.throwJava('Ljava/util/MissingFormatArgumentException;', `Format specifier '${whole}'`);
      last = argIndex; const arg = args[argIndex]; index++;
      let text = convert(r, c, flags, precision, arg, whole, { group, decimal });
      if (upper) text = text.toUpperCase();
      if (width >= 0 && flags.includes('0') && /[dxofeg]/.test(c) && arg !== null && !flags.includes('-')) {   // zeros go after the sign and the 0x prefix, inside a '(' ... ')' pair
        const sign = /^[+\- (]/.test(text) ? text[0] : '', close = sign === '(' && text.endsWith(')') ? ')' : '', rest = text.slice(sign.length, text.length - close.length), prefix = /^0[xX]/.test(rest) ? rest.slice(0, 2) : '';
        text = sign + prefix + rest.slice(prefix.length).padStart(width - sign.length - prefix.length - close.length, '0') + close;
      }
      out += pad(text, width, flags.includes('-'));
    }
    return out + pattern.slice(position);
  }
  const pad = (text, width, left) => width > text.length ? (left ? text.padEnd(width) : text.padStart(width)) : text;
  const boxed = (r, arg) => { if (arg === null || typeof arg === 'string') return null; const o = r.object(arg); const kind = BOX[o.type]; return kind ? { type: o.type, kind, value: o.boxed } : null; };
  const mismatch = (r, c, arg) => r.throwJava('Ljava/util/IllegalFormatConversionException;', `${c} != ${javaName(r.typeOf(arg))}`);
  function convert(r, c, flags, precision, arg, whole, sep) {
    switch (c) {
      case 's': { if (arg === null) return trunc('null', precision); return trunc(r.javaString(arg), precision); }
      case 'b': return trunc(arg === null ? 'false' : boxed(r, arg)?.kind[0] === 'bool' ? (boxed(r, arg).value ? 'true' : 'false') : 'true', precision);
      case 'h': return arg === null ? 'null' : (Number(r.dispatch({ owner: 'Ljava/lang/Object;', name: 'hashCode', parameters: [], result: 'I', signature: '()I' }, [arg], 'virtual')) >>> 0).toString(16);
      case 'c': { if (arg === null) return 'null'; const b = boxed(r, arg); if (!b || !['char', 'int'].includes(b.kind[0])) mismatch(r, 'c', arg); return String.fromCodePoint(Number(b.value)); }
      case 'd': case 'x': case 'o': {
        if (arg === null) return 'null';
        if (r.typeOf(arg) === BIG_INTEGER) return bigInteger(r, c, flags, arg, sep);
        const b = boxed(r, arg); if (!b || b.kind[0] !== 'int') { if (b && b.kind[0] === 'float' || !b) mismatch(r, c, arg); }
        let n = BigInt(b.value);
        if (c === 'd') { const neg = n < 0n; let digits = (neg ? -n : n).toString(); if (flags.includes(',')) digits = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group);
          return (neg ? (flags.includes('(') ? '(' : '-') : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + digits + (neg && flags.includes('(') ? ')' : ''); }
        if (n < 0n) n = BigInt.asUintN(b.kind[1], n); const t = n.toString(c === 'x' ? 16 : 8); return (flags.includes('#') ? (c === 'x' ? '0x' : '0') : '') + t;
      }
      case 'f': case 'e': case 'g': {
        if (arg === null) return 'null'; if (r.typeOf(arg) === BIG_DECIMAL) return bigDecimal(r, c, flags, precision, arg, sep);
        const b = boxed(r, arg); if (!b || b.kind[0] !== 'float') mismatch(r, c, arg);
        const v = b.type === 'Ljava/lang/Float;' ? bitsFloat(b.value) : bitsDouble(b.value);
        if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? (flags.includes('+') ? '+Infinity' : 'Infinity') : (flags.includes('(') ? '(Infinity)' : '-Infinity');
        const neg = v < 0 || Object.is(v, -0), a = Math.abs(v), p = precision < 0 ? 6 : precision; let body;
        if (c === 'f') { body = javaFixed(a, Math.min(p, 100)); const [i, f] = body.split('.'); body = (flags.includes(',') ? i.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group) : i) + (f ? sep.decimal + f : (flags.includes('#') ? sep.decimal : '')); }
        else if (c === 'e') { const [mant, exp] = javaExponential(a, Math.min(p, 100)).split('e'); body = mant.replace('.', sep.decimal) + 'e' + (exp[0] === '-' ? '-' : '+') + exp.replace(/^[+-]/, '').padStart(2, '0'); }
        else { const pp = p === 0 ? 1 : p, rounded = Number(a.toPrecision(pp)); if (rounded !== 0 && (rounded < 1e-4 || rounded >= 10 ** pp)) { const [mant, exp] = a.toExponential(pp - 1).split('e'); body = mant.replace('.', sep.decimal) + 'e' + (exp[0] === '-' ? '-' : '+') + exp.replace(/^[+-]/, '').padStart(2, '0'); } else { const digitsBefore = rounded === 0 ? 1 : Math.floor(Math.log10(rounded)) + 1; body = a.toFixed(Math.max(0, pp - digitsBefore)).replace('.', sep.decimal); } }
        return (neg ? (flags.includes('(') ? '(' : '-') : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + body + (neg && flags.includes('(') ? ')' : '');
      }
      default: r.throwJava('Ljava/util/UnknownFormatConversionException;', `Conversion = '${c}'`);
    }
  }
  // ---- java.math arguments ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const BIG_INTEGER = 'Ljava/math/BigInteger;', BIG_DECIMAL = 'Ljava/math/BigDecimal;';
  const sayString = (r, receiver, owner, name, parameters = [], args = []) => r.stringCharacters(r.dispatch({ owner, name, parameters, result: STRING, signature: `(${parameters.join('')})${STRING}` }, r.argumentWords(parameters, args, { receiver }), 'virtual'));
  const callI = (r, receiver, owner, name) => r.dispatch({ owner, name, parameters: [], result: 'I', signature: '()I' }, [receiver], 'virtual');
  const signed = (neg, flags, body) => (neg ? (flags.includes('(') ? '(' : '-') : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + body + (neg && flags.includes('(') ? ')' : '');
  function bigInteger(r, c, flags, arg, sep) {
    const neg = callI(r, arg, BIG_INTEGER, 'signum') < 0, radix = c === 'd' ? 10 : c === 'x' ? 16 : 8;
    let digits = sayString(r, arg, BIG_INTEGER, 'toString', ['I'], [radix]).replace(/^-/, '');   // BigInteger prints the magnitude with a sign: no two's complement, whatever the radix
    if (c === 'd' && flags.includes(',')) digits = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group);
    if (flags.includes('#')) digits = (c === 'x' ? '0x' : c === 'o' ? '0' : '') + digits;
    return signed(neg, flags, digits);
  }
  /** java.util.Formatter's BigDecimal conversions: the exact value rounded HALF_UP to the precision (%f: decimals, %e: significant digits - 1, %g: significant digits). */
  function bigDecimal(r, c, flags, precision, arg, sep) {
    const unscaled = BigInt(sayString(r, r.dispatch({ owner: BIG_DECIMAL, name: 'unscaledValue', parameters: [], result: BIG_INTEGER, signature: `()${BIG_INTEGER}` }, [arg], 'virtual'), BIG_INTEGER, 'toString')), scale = callI(r, arg, BIG_DECIMAL, 'scale');
    const neg = unscaled < 0n, magnitude = neg ? -unscaled : unscaled;
    const roundTo = (value, from, to) => { if (to >= from) return value * 10n ** BigInt(to - from); const divisor = 10n ** BigInt(from - to), quotient = value / divisor, rest = value % divisor; return rest * 2n >= divisor ? quotient + 1n : quotient; };   // HALF_UP on a magnitude
    const fixed = p => { let digits = roundTo(magnitude, scale, p).toString().padStart(p + 1, '0'); const integer = digits.slice(0, digits.length - p), fraction = digits.slice(digits.length - p);
      return (flags.includes(',') ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group) : integer) + (p > 0 ? sep.decimal + fraction : flags.includes('#') ? sep.decimal : ''); };
    const scientific = p => {
      if (magnitude === 0n) return (p > 0 ? '0' + sep.decimal + '0'.repeat(p) : '0') + 'e+00';
      let exponent = magnitude.toString().length - 1 - scale, digits = roundTo(magnitude, scale, p - exponent).toString();
      if (digits.length > p + 1) { exponent += 1; digits = digits.slice(0, p + 1); }
      return digits[0] + (p > 0 ? sep.decimal + digits.slice(1) : '') + 'e' + (exponent < 0 ? '-' : '+') + String(Math.abs(exponent)).padStart(2, '0');
    };
    const p = precision < 0 ? 6 : precision;
    let body;
    if (c === 'f') body = fixed(p);
    else if (c === 'e') body = scientific(p);
    else {   // %g
      const sig = p === 0 ? 1 : p, rounded = magnitude === 0n ? 0n : roundTo(magnitude, scale, sig - 1 - (magnitude.toString().length - 1 - scale));
      const exponent = magnitude === 0n ? 0 : magnitude.toString().length - 1 - scale + (rounded.toString().length > sig ? 1 : 0);
      body = magnitude !== 0n && (exponent < -4 || exponent >= sig) ? scientific(sig - 1) : fixed(Math.max(0, sig - 1 - exponent));
    }
    return signed(neg, flags, body);
  }
  const trunc = (t, p) => p >= 0 ? t.slice(0, p) : t;
  const localeTag = (r, locale) => { const tag = locale ? r.object(locale).localeData?.tag : null; return tag && tag !== 'und' ? tag : 'en-US'; };
  const args = (r, array) => array === null ? [null] : r.array(array).elements; // format(fmt, (Object[]) null) formats one null argument, as Java does
  def('Ljava/lang/String;', 'format', `(${STRING}${OBJECTS})${STRING}`, (r, _m, [f, a]) => { if (f === null) r.throwJava('Ljava/lang/NullPointerException;', null); return format(r, r.stringCharacters(f), args(r, a), 'en-US'); }, { static: true });
  def('Ljava/lang/String;', 'format', `(${LOCALE}${STRING}${OBJECTS})${STRING}`, (r, _m, [l, f, a]) => { if (f === null) r.throwJava('Ljava/lang/NullPointerException;', null); return format(r, r.stringCharacters(f), args(r, a), localeTag(r, l)); }, { static: true });
  // ---- java.util.Formatter over the same conversion engine: output goes to an Appendable (a StringBuilder by default), the locale defaults to Locale.getDefault(), close() closes a Closeable
  // destination, and every method after close() fails with FormatterClosedException.
  const FORMATTER = 'Ljava/util/Formatter;', APPENDABLE = 'Ljava/lang/Appendable;', CHARS = 'Ljava/lang/CharSequence;';
  type(FORMATTER, 'Ljava/lang/Object;', ['Ljava/io/Closeable;', 'Ljava/io/Flushable;'], { allocatable: true }); type('Ljava/util/FormatterClosedException;', 'Ljava/lang/IllegalStateException;');
  const virtual = (r, receiver, owner, name, parameters, result, values = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], 'virtual');
  const defaultOut = r => { const sb = r.allocate('Ljava/lang/StringBuilder;'); r.dispatch({ owner: 'Ljava/lang/StringBuilder;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [sb], 'direct'); return sb; };
  const defaultLocale = r => r.dispatch({ owner: LOCALE, name: 'getDefault', parameters: [], result: LOCALE, signature: `()${LOCALE}` }, [], 'static');
  const open = (r, self) => { const f = r.object(self).formatter; if (!f) r.throwJava('Ljava/lang/IllegalStateException;', 'Formatter used before construction'); if (f.closed) r.throwJava('Ljava/util/FormatterClosedException;', null); return f; };
  const setup = (r, self, out, locale) => { r.object(self).formatter = { out: out === null || out === 0 ? defaultOut(r) : out, locale: locale === null || locale === 0 ? defaultLocale(r) : locale, closed: false }; };
  def(FORMATTER, '<init>', '()V', (r, _m, [self]) => setup(r, self, null, null));
  def(FORMATTER, '<init>', `(${APPENDABLE})V`, (r, _m, [self, out]) => setup(r, self, out, null));
  def(FORMATTER, '<init>', `(${LOCALE})V`, (r, _m, [self, locale]) => setup(r, self, null, locale));
  def(FORMATTER, '<init>', `(${APPENDABLE}${LOCALE})V`, (r, _m, [self, out, locale]) => setup(r, self, out, locale));
  const emit = (r, self, locale, f, a) => {
    const state = open(r, self); if (f === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    virtual(r, state.out, APPENDABLE, 'append', [CHARS], APPENDABLE, [format(r, r.stringCharacters(f), args(r, a), localeTag(r, locale ?? state.locale))]);
    return self;
  };
  def(FORMATTER, 'format', `(${STRING}${OBJECTS})${FORMATTER}`, (r, _m, [self, f, a]) => emit(r, self, null, f, a));
  def(FORMATTER, 'format', `(${LOCALE}${STRING}${OBJECTS})${FORMATTER}`, (r, _m, [self, l, f, a]) => emit(r, self, l, f, a));
  def(FORMATTER, 'out', `()${APPENDABLE}`, (r, _m, [self]) => open(r, self).out); def(FORMATTER, 'locale', `()${LOCALE}`, (r, _m, [self]) => open(r, self).locale);
  def(FORMATTER, 'toString', `()${STRING}`, (r, _m, [self]) => r.stringCharacters(virtual(r, open(r, self).out, 'Ljava/lang/Object;', 'toString', [], STRING)));
  def(FORMATTER, 'flush', '()V', (r, _m, [self]) => { const out = open(r, self).out; if (r.isSubtype(r.typeOf(out), 'Ljava/io/Flushable;')) virtual(r, out, 'Ljava/io/Flushable;', 'flush', [], 'V'); });
  def(FORMATTER, 'close', '()V', (r, _m, [self]) => { const state = r.object(self).formatter; if (!state || state.closed) return; state.closed = true; if (r.isSubtype(r.typeOf(state.out), 'Ljava/io/Closeable;')) virtual(r, state.out, 'Ljava/io/Closeable;', 'close', [], 'V'); });
  def(FORMATTER, 'ioException', '()Ljava/io/IOException;', () => null);
  return { ...registry, interfaces: registry.interfacesOf, format };
}
