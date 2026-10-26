import { createHostRegistry, bitsDouble, bitsFloat } from './host-contract.js?v=94afba6d22ec';

// java.lang.String.format(...) / java.util.Formatter conversions: %s %S %d %x %X %o %c %b %B %h %n %% %f %e %E %g %G with the flags - # + space 0 , ( and
// argument indices (%1$s, %<s). Number formatting uses ASCII digits with the locale's decimal/grouping separators from Intl. Date/time (%t) and
// BigDecimal/BigInteger arguments are not implemented and fail explicitly. Contract: java.util.Formatter (android-13.0.0_r1 libcore).
const STRING = 'Ljava/lang/String;', LOCALE = 'Ljava/util/Locale;', OBJECTS = '[Ljava/lang/Object;';
const SPEC = /%(\d+\$|<)?([-#+ 0,(]*)(\d+)?(?:\.(\d+))?([tT]?[a-zA-Z%])/g;

export function createFormatterHost(platform) {
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
      if (width >= 0 && flags.includes('0') && /[dxofeg]/.test(c) && arg !== null && !flags.includes('-')) { const sign = /^[+\- (]/.test(text) ? text[0] : ''; text = sign + text.slice(sign.length).padStart(width - sign.length, '0'); }
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
        if (arg === null) return 'null'; const b = boxed(r, arg); if (!b || b.kind[0] !== 'int') { if (b && b.kind[0] === 'float' || !b) mismatch(r, c, arg); }
        let n = BigInt(b.value);
        if (c === 'd') { const neg = n < 0n; let digits = (neg ? -n : n).toString(); if (flags.includes(',')) digits = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group);
          return (neg ? (flags.includes('(') ? '(' : '-') : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + digits + (neg && flags.includes('(') ? ')' : ''); }
        if (n < 0n) n = BigInt.asUintN(b.kind[1], n); const t = n.toString(c === 'x' ? 16 : 8); return (flags.includes('#') ? (c === 'x' ? '0x' : '0') : '') + t;
      }
      case 'f': case 'e': case 'g': {
        if (arg === null) return 'null'; const b = boxed(r, arg); if (!b || b.kind[0] !== 'float') mismatch(r, c, arg);
        const v = b.type === 'Ljava/lang/Float;' ? bitsFloat(b.value) : bitsDouble(b.value);
        if (!Number.isFinite(v)) return Number.isNaN(v) ? 'NaN' : v > 0 ? (flags.includes('+') ? '+Infinity' : 'Infinity') : (flags.includes('(') ? '(Infinity)' : '-Infinity');
        const neg = v < 0 || Object.is(v, -0), a = Math.abs(v), p = precision < 0 ? 6 : precision; let body;
        if (c === 'f') { body = a.toFixed(Math.min(p, 100)); const [i, f] = body.split('.'); body = (flags.includes(',') ? i.replace(/\B(?=(\d{3})+(?!\d))/g, sep.group) : i) + (f ? sep.decimal + f : (flags.includes('#') ? sep.decimal : '')); }
        else if (c === 'e') { const [mant, exp] = a.toExponential(Math.min(p, 100)).split('e'); body = mant.replace('.', sep.decimal) + 'e' + (exp[0] === '-' ? '-' : '+') + exp.replace(/^[+-]/, '').padStart(2, '0'); }
        else { const pp = p === 0 ? 1 : p, rounded = Number(a.toPrecision(pp)); if (rounded !== 0 && (rounded < 1e-4 || rounded >= 10 ** pp)) { const [mant, exp] = a.toExponential(pp - 1).split('e'); body = mant.replace('.', sep.decimal) + 'e' + (exp[0] === '-' ? '-' : '+') + exp.replace(/^[+-]/, '').padStart(2, '0'); } else { const digitsBefore = rounded === 0 ? 1 : Math.floor(Math.log10(rounded)) + 1; body = a.toFixed(Math.max(0, pp - digitsBefore)).replace('.', sep.decimal); } }
        return (neg ? (flags.includes('(') ? '(' : '-') : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '') + body + (neg && flags.includes('(') ? ')' : '');
      }
      default: r.throwJava('Ljava/util/UnknownFormatConversionException;', `Conversion = '${c}'`);
    }
  }
  const trunc = (t, p) => p >= 0 ? t.slice(0, p) : t;
  const localeTag = (r, locale) => { const tag = locale ? r.object(locale).localeData?.tag : null; return tag && tag !== 'und' ? tag : 'en-US'; };
  const args = (r, array) => array === null ? [null] : r.array(array).elements; // format(fmt, (Object[]) null) formats one null argument, as Java does
  def('Ljava/lang/String;', 'format', `(${STRING}${OBJECTS})${STRING}`, (r, _m, [f, a]) => { if (f === null) r.throwJava('Ljava/lang/NullPointerException;', null); return format(r, r.stringCharacters(f), args(r, a), 'en-US'); }, { static: true });
  def('Ljava/lang/String;', 'format', `(${LOCALE}${STRING}${OBJECTS})${STRING}`, (r, _m, [l, f, a]) => { if (f === null) r.throwJava('Ljava/lang/NullPointerException;', null); return format(r, r.stringCharacters(f), args(r, a), localeTag(r, l)); }, { static: true });
  return { ...registry, interfaces: registry.interfacesOf, format };
}
