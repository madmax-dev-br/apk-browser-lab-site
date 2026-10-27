import { gcRoot } from './heap-gc.js?v=fd59ee7c3d79';
import { createHostRegistry, doubleBits, bitsDouble, bitsFloat } from './host-contract.js?v=fd59ee7c3d79';

// java.text.NumberFormat / DecimalFormat / DecimalFormatSymbols / FieldPosition and java.util.Currency for the browser VM.
//
// Android's classes are the OpenJDK DecimalFormat algorithm over ICU locale data (libcore.icu.DecimalFormatData / LocaleData). The VM has no ICU locale data, so the locale
// symbols and the currency/percent affixes of a locale come from the JavaScript engine's CLDR data (Intl.NumberFormat), and the DecimalFormat algorithm itself -- pattern syntax,
// minimum/maximum digits, grouping, multiplier, rounding modes on the EXACT decimal value of a double (JDK 8+ behaviour), the sign of a negative that rounds to zero, parsing -- is
// implemented here. Exponent patterns ("0.###E0") fail explicitly instead of formatting approximately.
const FORMAT = 'Ljava/text/Format;', NF = 'Ljava/text/NumberFormat;', DF = 'Ljava/text/DecimalFormat;', DFS = 'Ljava/text/DecimalFormatSymbols;', CUR = 'Ljava/util/Currency;', FP = 'Ljava/text/FieldPosition;';
const STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', LOCALE = 'Ljava/util/Locale;', RMODE = 'Ljava/math/RoundingMode;', NUMBER = 'Ljava/lang/Number;', SB = 'Ljava/lang/StringBuffer;', PP = 'Ljava/text/ParsePosition;';
const MAX_DIGITS = 2147483647, ROUNDING = ['UP', 'DOWN', 'CEILING', 'FLOOR', 'HALF_UP', 'HALF_DOWN', 'HALF_EVEN', 'UNNECESSARY'];
const CURRENCY_SIGN = '¤', PER_MILLE = '‰';

// ISO 3166 region -> ISO 4217 currency, for Currency.getInstance(Locale) (the engine has no region-to-currency table).
const REGION_CURRENCY = Object.fromEntries(Object.entries({
  USD: 'US PR GU VI AS MP EC SV PA TL FM MH PW', EUR: 'DE FR ES IT NL BE AT PT IE FI GR LU SK SI EE LV LT MT CY HR AD MC SM VA ME XK', GBP: 'GB IM JE GG', BRL: 'BR', JPY: 'JP', CNY: 'CN', INR: 'IN', CAD: 'CA', AUD: 'AU', NZD: 'NZ', CHF: 'CH LI',
  MXN: 'MX', ARS: 'AR', CLP: 'CL', COP: 'CO', PEN: 'PE', UYU: 'UY', PYG: 'PY', BOB: 'BO', VES: 'VE', SEK: 'SE', NOK: 'NO', DKK: 'DK', PLN: 'PL', CZK: 'CZ', HUF: 'HU', RON: 'RO', BGN: 'BG', RUB: 'RU', UAH: 'UA', TRY: 'TR', ILS: 'IL', AED: 'AE',
  SAR: 'SA', EGP: 'EG', ZAR: 'ZA', NGN: 'NG', KES: 'KE', KRW: 'KR', SGD: 'SG', HKD: 'HK', TWD: 'TW', THB: 'TH', IDR: 'ID', MYR: 'MY', PHP: 'PH', VND: 'VN', PKR: 'PK', BDT: 'BD', AOA: 'AO', MZN: 'MZ',
}).flatMap(([code, regions]) => regions.split(' ').map(region => [region, code])));
const NUMERIC = { USD: 840, EUR: 978, GBP: 826, BRL: 986, JPY: 392, CNY: 156, INR: 356, CAD: 124, AUD: 36, NZD: 554, CHF: 756, MXN: 484, ARS: 32, CLP: 152, COP: 170, PEN: 604, UYU: 858, SEK: 752, NOK: 578, DKK: 208, PLN: 985, CZK: 203, HUF: 348,
  RON: 946, RUB: 643, UAH: 980, TRY: 949, ILS: 376, AED: 784, SAR: 682, EGP: 818, ZAR: 710, NGN: 566, KES: 404, KRW: 410, SGD: 702, HKD: 344, TWD: 901, THB: 764, IDR: 360, MYR: 458, PHP: 608, VND: 704, PKR: 586 };

// ---- exact decimal arithmetic on {digits, scale} (value = BigInt(digits) / 10^scale) --------------------------------------------------------------------------------------------
const bitsView = new DataView(new ArrayBuffer(8));
/** The exact decimal expansion of a finite non-negative double. */
function exactDecimal(x) {
  bitsView.setFloat64(0, x);
  const high = bitsView.getUint32(0), low = bitsView.getUint32(4), exponentBits = (high >>> 20) & 0x7ff;
  let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low), exponent;
  if (exponentBits === 0) exponent = -1074; else { mantissa |= 1n << 52n; exponent = exponentBits - 1075; }
  if (mantissa === 0n) return { digits: '0', scale: 0 };
  let digits, scale = 0;
  if (exponent >= 0) digits = (mantissa << BigInt(exponent)).toString();
  else { scale = -exponent; digits = (mantissa * 5n ** BigInt(scale)).toString(); }
  while (scale > 0 && digits.endsWith('0')) { digits = digits.slice(0, -1); scale--; }
  return { digits, scale };
}
const multiplied = (decimal, factor) => ({ digits: (BigInt(decimal.digits) * BigInt(factor)).toString(), scale: decimal.scale });
function parseDecimalText(text) {   // BigDecimal.toPlainString() / BigInteger.toString() of a non-negative value
  const [integer, fraction = ''] = text.split('.'); const digits = (integer + fraction).replace(/^0+(?=\d)/, '');
  return { digits, scale: fraction.length };
}
/** Round to `maxFrac` fractional digits with a java.math.RoundingMode; null signals UNNECESSARY needing rounding. */
function roundDecimal(decimal, maxFrac, mode, negative) {
  if (decimal.scale <= maxFrac) return decimal;
  const drop = decimal.scale - maxFrac, padded = decimal.digits.padStart(drop + 1, '0'), keep = padded.slice(0, padded.length - drop), rest = padded.slice(padded.length - drop);
  const inexact = /[1-9]/.test(rest), first = rest.charCodeAt(0) - 48, tail = /[1-9]/.test(rest.slice(1));
  const cmpHalf = first > 5 || (first === 5 && tail) ? 1 : first === 5 ? 0 : -1;   // rest vs one half
  const odd = (keep.charCodeAt(keep.length - 1) - 48) % 2 === 1;
  let up;
  switch (mode) {
    case 'UP': up = inexact; break; case 'DOWN': up = false; break; case 'CEILING': up = inexact && !negative; break; case 'FLOOR': up = inexact && negative; break;
    case 'HALF_UP': up = cmpHalf >= 0; break; case 'HALF_DOWN': up = cmpHalf > 0; break; case 'HALF_EVEN': up = cmpHalf > 0 || (cmpHalf === 0 && odd); break;
    default: if (inexact) return null; up = false;
  }
  return { digits: (BigInt(keep) + (up ? 1n : 0n)).toString(), scale: maxFrac };
}

// ---- locale data from Intl ----------------------------------------------------------------------------------------------------------------------------------------------------------
const localeCache = new Map();
function localeInfo(tag) {
  if (localeCache.has(tag)) return localeCache.get(tag);
  let canonical = 'en-US'; try { canonical = Intl.getCanonicalLocales(tag)[0] ?? 'en-US'; } catch { /* default */ }
  const base = { numberingSystem: 'latn' }, parts = (value, options) => new Intl.NumberFormat(canonical, { ...base, ...options }).formatToParts(value);
  const sample = parts(-1234567.5, { useGrouping: 'always', minimumFractionDigits: 1 }), find = (list, type, fallback) => list.find(p => p.type === type)?.value ?? fallback;
  const percentParts = parts(0.5, { style: 'percent' });
  const info = { tag: canonical, decimal: find(sample, 'decimal', '.'), group: find(sample, 'group', ','), minus: find(sample, 'minusSign', '-'), percent: find(percentParts, 'percentSign', '%') };
  localeCache.set(tag, info); return info;
}
/** Prefix/suffix of a styled Intl number as DecimalFormat tokens: the numeric run (integer/group/decimal/fraction) is the pattern, what surrounds it the affixes. */
function affixes(tag, options, positive, negative) {
  const take = value => {
    const list = new Intl.NumberFormat(tag, { numberingSystem: 'latn', ...options }).formatToParts(value), numeric = ['integer', 'group', 'decimal', 'fraction'];
    const first = list.findIndex(p => numeric.includes(p.type)); let last = list.length - 1; while (last >= 0 && !numeric.includes(list[last].type)) last--;
    const tokens = chunk => chunk.flatMap(p => p.type === 'currency' ? [{ currency: true }] : p.type === 'percentSign' ? [{ percent: true }] : p.type === 'minusSign' ? [{ minus: true }] : p.value ? [{ lit: p.value }] : []);
    return { prefix: tokens(list.slice(0, first)), suffix: tokens(list.slice(last + 1)) };
  };
  return { pos: take(positive), neg: take(negative) };
}

function symbolsFor(tag) {
  const l = localeInfo(tag);
  return { tag: l.tag, decimal: l.decimal, group: l.group, minus: l.minus, percent: l.percent, perMill: PER_MILLE, zero: '0', digit: '#', patternSeparator: ';', infinity: '∞', nan: 'NaN', exponent: 'E', monetaryDecimal: l.decimal, monetaryGroup: l.group, currencyCode: null, currencySymbol: null };
}

export function createNumberFormatHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(NF, FORMAT, ['Ljava/io/Serializable;', 'Ljava/lang/Cloneable;'], { allocatable: false }); type(DF, NF, [], { allocatable: true }); type(DFS, OBJECT, ['Ljava/io/Serializable;', 'Ljava/lang/Cloneable;'], { allocatable: true });
  type(CUR, OBJECT, ['Ljava/io/Serializable;'], { allocatable: true }); type(FP, OBJECT, [], { allocatable: true });
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const nullish = value => value === null || value === undefined || value === 0;
  const text = (r, value) => nullish(value) ? null : r.stringCharacters(value);
  const npe = (r, message = null) => r.throwJava('Ljava/lang/NullPointerException;', message);
  const iae = (r, message) => r.throwJava('Ljava/lang/IllegalArgumentException;', message);
  const tagOf = (r, locale) => { const data = nullish(locale) ? null : r.object(locale).localeData?.tag; return data && data !== 'und' ? data : platform.device?.locale ?? 'en-US'; };
  const defaultTag = r => tagOf(r, callStatic(r, LOCALE, 'getDefault', [], LOCALE));
  const localeRef = (r, tag) => callStatic(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [tag]);

  // ---- Currency ----------------------------------------------------------------------------------------------------------------------------------------------------------
  const currencyCodes = new Set(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('currency') : Object.keys(NUMERIC));
  const instances = new WeakMap();
  const currencyOf = (r, code) => {
    const table = instances.get(r) ?? instances.set(r, gcRoot(new Map())).get(r);
    if (!table.has(code)) { const ref = r.allocate(CUR); r.object(ref).currency = { code }; table.set(code, ref); }
    return table.get(code);
  };
  const cur = (r, self) => r.object(self).currency ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Currency used before construction');
  const fractionDigits = code => { try { return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits; } catch { return 2; } };
  const symbolIn = (code, tag) => { try { return new Intl.NumberFormat(tag, { numberingSystem: 'latn', style: 'currency', currency: code, currencyDisplay: 'symbol' }).formatToParts(1).find(p => p.type === 'currency')?.value ?? code; } catch { return code; } };
  def(CUR, 'getInstance', `(${STRING})${CUR}`, (r, _m, [codeRef]) => {
    if (nullish(codeRef)) npe(r); const code = r.stringCharacters(codeRef);
    if (!/^[A-Z]{3}$/.test(code) || !currencyCodes.has(code)) iae(r, null); return currencyOf(r, code);
  }, { static: true });
  def(CUR, 'getInstance', `(${LOCALE})${CUR}`, (r, _m, [locale]) => {
    if (nullish(locale)) npe(r); const region = (tagOf(r, locale).split('-').find((p, i) => i > 0 && /^[A-Za-z]{2}$/.test(p)) ?? '').toUpperCase();
    if (!region) iae(r, null); const code = REGION_CURRENCY[region]; return code ? currencyOf(r, code) : null;
  }, { static: true });
  def(CUR, 'getAvailableCurrencies', '()Ljava/util/Set;', r => { const set = r.allocate('Ljava/util/HashSet;'); r.dispatch({ owner: 'Ljava/util/HashSet;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [set], 'direct'); for (const code of currencyCodes) call(r, set, 'Ljava/util/HashSet;', 'add', [OBJECT], 'Z', [currencyOf(r, code)]); return set; }, { static: true });
  def(CUR, 'getCurrencyCode', `()${STRING}`, (r, _m, [self]) => cur(r, self).code);
  def(CUR, 'toString', `()${STRING}`, (r, _m, [self]) => cur(r, self).code);
  def(CUR, 'getDefaultFractionDigits', '()I', (r, _m, [self]) => fractionDigits(cur(r, self).code));
  def(CUR, 'getSymbol', `()${STRING}`, (r, _m, [self]) => symbolIn(cur(r, self).code, defaultTag(r)));
  def(CUR, 'getSymbol', `(${LOCALE})${STRING}`, (r, _m, [self, locale]) => { if (nullish(locale)) npe(r); return symbolIn(cur(r, self).code, tagOf(r, locale)); });
  def(CUR, 'getDisplayName', `()${STRING}`, (r, _m, [self]) => new Intl.DisplayNames(defaultTag(r), { type: 'currency' }).of(cur(r, self).code));
  def(CUR, 'getDisplayName', `(${LOCALE})${STRING}`, (r, _m, [self, locale]) => { if (nullish(locale)) npe(r); return new Intl.DisplayNames(tagOf(r, locale), { type: 'currency' }).of(cur(r, self).code); });
  def(CUR, 'getNumericCode', '()I', (r, _m, [self]) => NUMERIC[cur(r, self).code] ?? r.throwJava('Ljava/lang/UnsupportedOperationException;', `The ISO 4217 numeric code of ${cur(r, self).code} is not in the lab's table`));

  // ---- FieldPosition ----------------------------------------------------------------------------------------------------------------------------------------------------
  const fp = (r, ref) => r.object(ref).fieldPosition ??= { field: 0, begin: 0, end: 0 };
  def(FP, '<init>', '(I)V', (r, _m, [self, field]) => { r.object(self).fieldPosition = { field, begin: 0, end: 0 }; });
  def(FP, 'getField', '()I', (r, _m, [self]) => fp(r, self).field); def(FP, 'getBeginIndex', '()I', (r, _m, [self]) => fp(r, self).begin); def(FP, 'getEndIndex', '()I', (r, _m, [self]) => fp(r, self).end);
  def(FP, 'setBeginIndex', '(I)V', (r, _m, [self, v]) => { fp(r, self).begin = v; }); def(FP, 'setEndIndex', '(I)V', (r, _m, [self, v]) => { fp(r, self).end = v; });
  for (const [name, value] of [['INTEGER_FIELD', 0], ['FRACTION_FIELD', 1]]) registry.staticField(NF, name, 'I', () => value);

  // ---- DecimalFormatSymbols ---------------------------------------------------------------------------------------------------------------------------------------------
  const sym = (r, self) => r.object(self).symbols ?? r.throwJava('Ljava/lang/IllegalStateException;', 'DecimalFormatSymbols used before construction');
  const newSymbols = (r, tag) => { const ref = r.allocate(DFS); r.object(ref).symbols = symbolsFor(tag); return ref; };
  def(DFS, '<init>', '()V', (r, _m, [self]) => { r.object(self).symbols = symbolsFor(defaultTag(r)); });
  def(DFS, '<init>', `(${LOCALE})V`, (r, _m, [self, locale]) => { if (nullish(locale)) npe(r); r.object(self).symbols = symbolsFor(tagOf(r, locale)); });
  def(DFS, 'getInstance', `()${DFS}`, r => newSymbols(r, defaultTag(r)), { static: true });
  def(DFS, 'getInstance', `(${LOCALE})${DFS}`, (r, _m, [locale]) => { if (nullish(locale)) npe(r); return newSymbols(r, tagOf(r, locale)); }, { static: true });
  def(DFS, 'getAvailableLocales', `()[${LOCALE}`, r => { const a = r.newArray(`[${LOCALE}`, 1); r.array(a).elements = [localeRef(r, 'en-US')]; return a; }, { static: true });
  for (const [property, key, defaultOnly] of [['DecimalSeparator', 'decimal'], ['GroupingSeparator', 'group'], ['Percent', 'percent'], ['PerMill', 'perMill'], ['ZeroDigit', 'zero'], ['Digit', 'digit'], ['PatternSeparator', 'patternSeparator'], ['MinusSign', 'minus'], ['MonetaryDecimalSeparator', 'monetaryDecimal'], ['MonetaryGroupingSeparator', 'monetaryGroup']]) {
    def(DFS, `get${property}`, '()C', (r, _m, [self]) => sym(r, self)[key].charCodeAt(0));
    def(DFS, `set${property}`, '(C)V', (r, _m, [self, c]) => { sym(r, self)[key] = String.fromCharCode(c & 0xffff); });
    void defaultOnly;
  }
  for (const [property, key] of [['Infinity', 'infinity'], ['NaN', 'nan'], ['ExponentSeparator', 'exponent']]) {
    def(DFS, `get${property}`, `()${STRING}`, (r, _m, [self]) => sym(r, self)[key]);
    def(DFS, `set${property}`, `(${STRING})V`, (r, _m, [self, v]) => { if (nullish(v)) npe(r); sym(r, self)[key] = r.stringCharacters(v); });
  }
  const symbolCurrencyCode = s => s.currencyCode ?? REGION_CURRENCY[(s.tag.split('-').find((p, i) => i > 0 && /^[A-Za-z]{2}$/.test(p)) ?? '').toUpperCase()] ?? null;
  def(DFS, 'getCurrencySymbol', `()${STRING}`, (r, _m, [self]) => { const s = sym(r, self), code = symbolCurrencyCode(s); return s.currencySymbol ?? (code ? symbolIn(code, s.tag) : '¤'); });
  def(DFS, 'setCurrencySymbol', `(${STRING})V`, (r, _m, [self, v]) => { sym(r, self).currencySymbol = text(r, v); });
  def(DFS, 'getInternationalCurrencySymbol', `()${STRING}`, (r, _m, [self]) => symbolCurrencyCode(sym(r, self)) ?? 'XXX');
  def(DFS, 'setInternationalCurrencySymbol', `(${STRING})V`, (r, _m, [self, v]) => { const s = sym(r, self); s.currencyCode = text(r, v); s.currencySymbol = null; });
  def(DFS, 'getCurrency', `()${CUR}`, (r, _m, [self]) => { const code = symbolCurrencyCode(sym(r, self)); return code ? currencyOf(r, code) : null; });
  def(DFS, 'setCurrency', `(${CUR})V`, (r, _m, [self, currency]) => { if (nullish(currency)) npe(r); const s = sym(r, self); s.currencyCode = cur(r, currency).code; s.currencySymbol = null; });
  def(DFS, 'getLocale', `()${LOCALE}`, (r, _m, [self]) => localeRef(r, sym(r, self).tag));
  def(DFS, 'clone', `()${OBJECT}`, (r, _m, [self]) => { const ref = r.allocate(DFS); r.object(ref).symbols = { ...sym(r, self) }; return ref; });
  def(DFS, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => { if (nullish(other) || r.object(other).symbols === undefined) return 0; return JSON.stringify(sym(r, self)) === JSON.stringify(sym(r, other)) ? 1 : 0; });
  def(DFS, 'hashCode', '()I', (r, _m, [self]) => { const s = sym(r, self); return (s.zero.charCodeAt(0) * 37 + s.group.charCodeAt(0)) * 37 + s.decimal.charCodeAt(0); });

  // ---- pattern syntax ---------------------------------------------------------------------------------------------------------------------------------------------------
  const parseSubpattern = (r, source) => {
    let phase = 0, digitLeft = 0, zero = 0, digitRight = 0, grouping = -1, decimalPos = -1, multiplier = 1, quoted = false;
    const prefix = [], suffix = []; let sawNumber = false;
    for (let i = 0; i < source.length; i++) {
      const c = source[i], target = phase === 0 ? prefix : suffix;
      if (phase === 1) {
        if (c === '#') { if (zero > 0) digitRight++; else digitLeft++; if (grouping >= 0 && decimalPos < 0) grouping++; sawNumber = true; continue; }
        if (c === '0') { if (digitRight > 0) iae(r, `Unexpected '0' in pattern "${source}"`); zero++; if (grouping >= 0 && decimalPos < 0) grouping++; sawNumber = true; continue; }
        if (c === ',') { grouping = 0; continue; }
        if (c === '.') { if (decimalPos >= 0) iae(r, `Multiple decimal separators in pattern "${source}"`); decimalPos = digitLeft + zero + digitRight; continue; }
        if (c === 'E') r.throwJava('Ljava/lang/UnsupportedOperationException;', 'DecimalFormat exponent patterns (E0) are not implemented in the lab');
        phase = 2; i--; continue;
      }
      if (phase === 0 && (c === '#' || c === '0' || c === ',' || c === '.')) { phase = 1; i--; continue; }
      if (phase === 2 && (c === '#' || c === '0' || c === ',' || c === '.')) iae(r, `Unquoted special character '${c}' in pattern "${source}"`);
      if (c === "'") {
        if (source[i + 1] === "'") { target.push({ lit: "'" }); i++; continue; }
        let j = i + 1, literal = ''; while (j < source.length && source[j] !== "'") literal += source[j++];
        if (j >= source.length) iae(r, `Malformed quote in pattern "${source}"`);
        if (literal) target.push({ lit: literal }); i = j; continue;
      }
      if (c === CURRENCY_SIGN) { if (source[i + 1] === CURRENCY_SIGN) { target.push({ currency: 2 }); i++; } else target.push({ currency: true }); continue; }
      if (c === '%') { if (multiplier !== 1 && multiplier !== 100) iae(r, `Too many percent/per mille characters in pattern "${source}"`); multiplier = 100; target.push({ percent: true }); continue; }
      if (c === PER_MILLE) { if (multiplier !== 1 && multiplier !== 1000) iae(r, `Too many percent/per mille characters in pattern "${source}"`); multiplier = 1000; target.push({ perMille: true }); continue; }
      if (c === '-') { target.push({ minus: true }); continue; }
      target.push({ lit: c });
    }
    void quoted;
    if (phase === 0 || !sawNumber && source.length === 0) { /* a pattern with no digit characters */ }
    if (zero === 0 && digitLeft > 0 && decimalPos >= 0) { let n = decimalPos; if (n === 0) ++n; digitRight = digitLeft - n; digitLeft = n - 1; zero = 1; }
    if ((decimalPos < 0 && digitRight > 0) || (decimalPos >= 0 && (decimalPos < digitLeft || decimalPos > digitLeft + zero)) || grouping === 0 || phase === 0 && !sawNumber && false) iae(r, `Malformed pattern "${source}"`);
    const total = digitLeft + zero + digitRight, effective = decimalPos >= 0 ? decimalPos : total;
    return { prefix, suffix, multiplier, minInt: effective - digitLeft, maxInt: MAX_DIGITS, minFrac: decimalPos >= 0 ? Math.max(0, digitLeft + zero - decimalPos) : 0, maxFrac: decimalPos >= 0 ? total - decimalPos : 0,
      groupingSize: grouping > 0 ? grouping : 0, groupingUsed: grouping > 0, alwaysShown: decimalPos === 0 || decimalPos === total };
  };
  const splitPattern = (r, pattern) => {
    const parts = []; let current = '', quoted = false;
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "'") { quoted = !quoted; current += c; } else if (c === ';' && !quoted) { parts.push(current); current = ''; } else current += c;
    }
    parts.push(current);
    if (parts.length > 2) iae(r, `Multiple subpatterns in "${pattern}"`);
    return parts;
  };
  const applyPattern = (r, state, pattern) => {
    const [positive, negative] = splitPattern(r, pattern), pos = parseSubpattern(r, positive);
    Object.assign(state, { posPrefix: pos.prefix, posSuffix: pos.suffix, multiplier: pos.multiplier, minInt: pos.minInt, maxInt: pos.maxInt, minFrac: pos.minFrac, maxFrac: pos.maxFrac, groupingSize: pos.groupingSize, groupingUsed: pos.groupingUsed, alwaysShown: pos.alwaysShown });
    if (negative !== undefined) { const neg = parseSubpattern(r, negative); state.negPrefix = neg.prefix; state.negSuffix = neg.suffix; } else { state.negPrefix = [{ minus: true }, ...pos.prefix]; state.negSuffix = pos.suffix; }
    if (state.maxFrac < state.minFrac) state.maxFrac = state.minFrac;
  };
  const quoteLiteral = value => /[#0,.;%‰¤'\-E]/.test(value) ? `'${value.replace(/'/g, "''")}'` : value;
  const tokensToPattern = tokens => tokens.map(t => t.lit !== undefined ? quoteLiteral(t.lit) : t.currency === 2 ? CURRENCY_SIGN + CURRENCY_SIGN : t.currency ? CURRENCY_SIGN : t.percent ? '%' : t.perMille ? PER_MILLE : '-').join('');
  const toPattern = state => {
    let number = ''; const digitCount = Math.max(state.groupingSize, state.minInt) + 1;
    for (let i = digitCount; i > 0; --i) { if (i !== digitCount && state.groupingUsed && state.groupingSize !== 0 && i % state.groupingSize === 0) number += ','; number += i <= state.minInt ? '0' : '#'; }
    if (state.maxFrac > 0 || state.alwaysShown) number += '.';
    for (let i = 0; i < state.maxFrac; i++) number += i < state.minFrac ? '0' : '#';
    const positive = tokensToPattern(state.posPrefix) + number + tokensToPattern(state.posSuffix);
    const negPrefix = tokensToPattern(state.negPrefix), negSuffix = tokensToPattern(state.negSuffix);
    return negSuffix === tokensToPattern(state.posSuffix) && negPrefix === '-' + tokensToPattern(state.posPrefix) ? positive : `${positive};${negPrefix}${number}${negSuffix}`;
  };

  // ---- the formatter ------------------------------------------------------------------------------------------------------------------------------------------------------------
  const newState = (symbols, currencyCode) => ({ symbols, currencyCode, roundingMode: 'HALF_EVEN', parseIntegerOnly: false, parseBigDecimal: false, posPrefix: [], posSuffix: [], negPrefix: [{ minus: true }], negSuffix: [], multiplier: 1, minInt: 1, maxInt: MAX_DIGITS, minFrac: 0, maxFrac: 3, groupingSize: 3, groupingUsed: true, alwaysShown: false });
  const state = (r, self) => r.object(self).decimalFormat ?? r.throwJava('Ljava/lang/IllegalStateException;', 'DecimalFormat used before construction');
  const currencySymbolOf = (st, international) => {
    const code = st.currencyCode ?? symbolCurrencyCode(st.symbols);
    if (international) return code ?? 'XXX';
    return st.symbols.currencySymbol ?? (code ? symbolIn(code, st.symbols.tag) : '¤');
  };
  const render = (st, tokens) => tokens.map(t => t.lit !== undefined ? t.lit : t.currency ? currencySymbolOf(st, t.currency === 2) : t.percent ? st.symbols.percent : t.perMille ? st.symbols.perMill : st.symbols.minus).join('');
  const groupDigits = (digits, size, separator) => { if (!size || digits.length <= size) return digits; const out = []; for (let end = digits.length; end > 0; end -= size) out.unshift(digits.slice(Math.max(0, end - size), end)); return out.join(separator); };
  const localizeDigits = (value, zero) => zero === '0' ? value : value.replace(/[0-9]/g, d => String.fromCharCode(zero.charCodeAt(0) + d.charCodeAt(0) - 48));
  /** DecimalFormat.format core: `value` is a JS number (double), a BigInt (long / BigInteger) or { decimal: "plain text" } for a BigDecimal. */
  const formatValue = (r, st, value, position = null) => {
    const symbols = st.symbols;
    if (typeof value === 'number' && Number.isNaN(value)) return symbols.nan;
    let negative, decimal;
    if (typeof value === 'number') {
      negative = (value < 0 || Object.is(value, -0)) !== (st.multiplier < 0);
      if (!Number.isFinite(value)) return render(st, negative ? st.negPrefix : st.posPrefix) + symbols.infinity + render(st, negative ? st.negSuffix : st.posSuffix);
      decimal = exactDecimal(Math.abs(value));
    } else if (typeof value === 'bigint') { negative = (value < 0n) !== (st.multiplier < 0); decimal = { digits: (value < 0n ? -value : value).toString(), scale: 0 }; }
    else { const plain = value.decimal, isNegative = plain.startsWith('-'); negative = isNegative !== (st.multiplier < 0); decimal = parseDecimalText(isNegative ? plain.slice(1) : plain); }
    if (Math.abs(st.multiplier) !== 1) decimal = multiplied(decimal, Math.abs(st.multiplier));
    decimal = roundDecimal(decimal, st.maxFrac, st.roundingMode, negative);
    if (decimal === null) r.throwJava('Ljava/lang/ArithmeticException;', 'Rounding needed with the rounding mode being set to RoundingMode.UNNECESSARY');
    const padded = decimal.digits.padStart(decimal.scale + 1, '0');
    let integer = padded.slice(0, padded.length - decimal.scale).replace(/^0+/, ''), fraction = padded.slice(padded.length - decimal.scale);
    fraction = fraction.replace(/0+$/, ''); if (fraction.length < st.minFrac) fraction = fraction.padEnd(st.minFrac, '0');
    if (integer.length > st.maxInt) integer = integer.slice(integer.length - st.maxInt);
    if (integer.length < st.minInt) integer = integer.padStart(st.minInt, '0');
    if (integer === '' && fraction === '') integer = '0';
    const intStart = 0; let body = localizeDigits(st.groupingUsed ? groupDigits(integer, st.groupingSize, symbols.group) : integer, symbols.zero);
    const intLength = body.length; if (fraction !== '' || st.alwaysShown) body += symbols.decimal + localizeDigits(fraction, symbols.zero);
    const prefix = render(st, negative ? st.negPrefix : st.posPrefix);
    if (position) { const p = fp(r, position); if (p.field === 0) { p.begin = prefix.length + intStart; p.end = prefix.length + intLength; } else if (p.field === 1) { p.begin = prefix.length + intLength + (fraction !== '' || st.alwaysShown ? 1 : 0); p.end = prefix.length + body.length; } }
    return prefix + body + render(st, negative ? st.negSuffix : st.posSuffix);
  };
  const append = (r, buffer, string) => { r.object(buffer).builder = (r.object(buffer).builder ?? '') + string; return buffer; };
  const numberValue = (r, object) => {   // java.lang.Number -> a value formatValue understands
    if (nullish(object)) npe(r);
    const o = r.object(object);
    if (o.boxed !== undefined) return o.primitiveType === 'D' ? bitsDouble(o.boxed) : o.primitiveType === 'F' ? bitsFloat(o.boxed) : BigInt(o.boxed);
    const type = o.type;
    if (type === 'Ljava/math/BigDecimal;') return { decimal: r.stringCharacters(call(r, object, type, 'toPlainString', [], STRING)) };
    if (type === 'Ljava/math/BigInteger;') return BigInt(r.stringCharacters(call(r, object, type, 'toString', [], STRING)));
    if (/Atomic(Integer|Long)$/.test(type)) return BigInt(call(r, object, NUMBER, 'longValue', [], 'J'));
    return bitsDouble(call(r, object, NUMBER, 'doubleValue', [], 'D'));
  };
  const doubleOfBits = bitsDouble;

  const initDecimalFormat = (r, self, pattern, symbolsRef) => {
    const st = newState(symbolsRef ? { ...sym(r, symbolsRef) } : symbolsFor(defaultTag(r)), null); r.object(self).decimalFormat = st; applyPattern(r, st, pattern);
  };
  def(DF, '<init>', '()V', (r, _m, [self]) => initDecimalFormat(r, self, '#,##0.###', null));
  def(DF, '<init>', `(${STRING})V`, (r, _m, [self, pattern]) => { if (nullish(pattern)) npe(r); initDecimalFormat(r, self, r.stringCharacters(pattern), null); });
  def(DF, '<init>', `(${STRING}${DFS})V`, (r, _m, [self, pattern, symbols]) => { if (nullish(pattern) || nullish(symbols)) npe(r); initDecimalFormat(r, self, r.stringCharacters(pattern), symbols); });
  def(DF, 'applyPattern', `(${STRING})V`, (r, _m, [self, pattern]) => { if (nullish(pattern)) npe(r); applyPattern(r, state(r, self), r.stringCharacters(pattern)); });
  def(DF, 'applyLocalizedPattern', `(${STRING})V`, (r, _m, [self, pattern]) => { if (nullish(pattern)) npe(r); applyPattern(r, state(r, self), r.stringCharacters(pattern)); });
  def(DF, 'toPattern', `()${STRING}`, (r, _m, [self]) => toPattern(state(r, self)));
  def(DF, 'toLocalizedPattern', `()${STRING}`, (r, _m, [self]) => toPattern(state(r, self)));
  def(DF, 'getDecimalFormatSymbols', `()${DFS}`, (r, _m, [self]) => { const ref = r.allocate(DFS); r.object(ref).symbols = { ...state(r, self).symbols }; return ref; });
  def(DF, 'setDecimalFormatSymbols', `(${DFS})V`, (r, _m, [self, symbols]) => { if (nullish(symbols)) npe(r); state(r, self).symbols = { ...sym(r, symbols) }; });
  def(DF, 'setMultiplier', '(I)V', (r, _m, [self, v]) => { state(r, self).multiplier = v; }); def(DF, 'getMultiplier', '()I', (r, _m, [self]) => state(r, self).multiplier);
  def(DF, 'setGroupingSize', '(I)V', (r, _m, [self, v]) => { if (v < 0 || v > 127) iae(r, 'newValue is out of valid range. value: ' + v); state(r, self).groupingSize = v; }); def(DF, 'getGroupingSize', '()I', (r, _m, [self]) => state(r, self).groupingSize);
  def(DF, 'setDecimalSeparatorAlwaysShown', '(Z)V', (r, _m, [self, v]) => { state(r, self).alwaysShown = !!v; }); def(DF, 'isDecimalSeparatorAlwaysShown', '()Z', (r, _m, [self]) => state(r, self).alwaysShown ? 1 : 0);
  def(DF, 'setParseBigDecimal', '(Z)V', (r, _m, [self, v]) => { state(r, self).parseBigDecimal = !!v; }); def(DF, 'isParseBigDecimal', '()Z', (r, _m, [self]) => state(r, self).parseBigDecimal ? 1 : 0);
  def(DF, 'isDecimalSeparatorAlwaysShown', '()Z', (r, _m, [self]) => state(r, self).alwaysShown ? 1 : 0);
  for (const [name, key] of [['PositivePrefix', 'posPrefix'], ['PositiveSuffix', 'posSuffix'], ['NegativePrefix', 'negPrefix'], ['NegativeSuffix', 'negSuffix']]) {
    def(DF, `get${name}`, `()${STRING}`, (r, _m, [self]) => render(state(r, self), state(r, self)[key]));
    def(DF, `set${name}`, `(${STRING})V`, (r, _m, [self, v]) => { state(r, self)[key] = nullish(v) ? [] : [{ lit: r.stringCharacters(v) }]; });
  }

  // ---- NumberFormat API (also the DecimalFormat instance methods) -------------------------------------------------------------------------------------------------------------
  const fractionOf = (st, key) => st[key];
  for (const [name, key] of [['MinimumIntegerDigits', 'minInt'], ['MaximumIntegerDigits', 'maxInt'], ['MinimumFractionDigits', 'minFrac'], ['MaximumFractionDigits', 'maxFrac']]) {
    def(NF, `get${name}`, '()I', (r, _m, [self]) => fractionOf(state(r, self), key));
    def(NF, `set${name}`, '(I)V', (r, _m, [self, v]) => {
      const st = state(r, self), limit = key.endsWith('Int') ? MAX_DIGITS : MAX_DIGITS, value = Math.max(0, Math.min(v, limit)); st[key] = value;
      if (key === 'minInt' && st.maxInt < value) st.maxInt = value; if (key === 'maxInt' && st.minInt > value) st.minInt = value;
      if (key === 'minFrac' && st.maxFrac < value) st.maxFrac = value; if (key === 'maxFrac' && st.minFrac > value) st.minFrac = value;
    });
  }
  def(NF, 'setGroupingUsed', '(Z)V', (r, _m, [self, v]) => { state(r, self).groupingUsed = !!v; }); def(NF, 'isGroupingUsed', '()Z', (r, _m, [self]) => state(r, self).groupingUsed ? 1 : 0);
  def(NF, 'setParseIntegerOnly', '(Z)V', (r, _m, [self, v]) => { state(r, self).parseIntegerOnly = !!v; }); def(NF, 'isParseIntegerOnly', '()Z', (r, _m, [self]) => state(r, self).parseIntegerOnly ? 1 : 0);
  def(NF, 'setRoundingMode', `(${RMODE})V`, (r, _m, [self, mode]) => { if (nullish(mode)) npe(r); state(r, self).roundingMode = ROUNDING[call(r, mode, RMODE, 'ordinal', [], 'I')]; });
  def(NF, 'getRoundingMode', `()${RMODE}`, (r, _m, [self]) => callStatic(r, RMODE, 'valueOf', [STRING], RMODE, [state(r, self).roundingMode]));
  def(NF, 'setCurrency', `(${CUR})V`, (r, _m, [self, currency]) => { if (nullish(currency)) npe(r); const st = state(r, self); st.currencyCode = cur(r, currency).code; st.symbols = { ...st.symbols, currencyCode: st.currencyCode, currencySymbol: null }; });
  def(NF, 'getCurrency', `()${CUR}`, (r, _m, [self]) => { const st = state(r, self), code = st.currencyCode ?? symbolCurrencyCode(st.symbols); return code ? currencyOf(r, code) : null; });
  def(NF, 'format', '(D)Ljava/lang/String;', (r, _m, [self, d]) => formatValue(r, state(r, self), doubleOfBits(d)));
  def(NF, 'format', '(J)Ljava/lang/String;', (r, _m, [self, l]) => formatValue(r, state(r, self), BigInt(l)));
  def(NF, 'format', `(${OBJECT})${STRING}`, (r, _m, [self, object]) => {
    if (nullish(object) || typeof object === 'string') iae(r, 'Cannot format given Object as a Number');
    const o = r.object(object);
    if (!(o.boxed !== undefined && o.primitiveType !== 'Z' && o.primitiveType !== 'C') && !r.isSubtype(o.type, NUMBER)) iae(r, 'Cannot format given Object as a Number');
    return formatValue(r, state(r, self), numberValue(r, object));
  });
  def(NF, 'format', `(D${SB}${FP})${SB}`, (r, _m, [self, d, buffer, position]) => append(r, buffer, formatValue(r, state(r, self), doubleOfBits(d), position)));
  def(NF, 'format', `(J${SB}${FP})${SB}`, (r, _m, [self, l, buffer, position]) => append(r, buffer, formatValue(r, state(r, self), BigInt(l), position)));
  def(NF, 'format', `(${OBJECT}${SB}${FP})${SB}`, (r, _m, [self, object, buffer, position]) => {
    if (nullish(object)) iae(r, 'Cannot format given Object as a Number');
    return append(r, buffer, formatValue(r, state(r, self), numberValue(r, object), position));
  });

  // parsing: the longest prefix of `source` (from `start`) that matches prefix digits suffix; returns { value, end } or null with the error index
  const parseNumber = (r, st, source, start) => {
    const symbols = st.symbols; let best = null;
    for (const negative of [false, true]) {
      const prefix = render(st, negative ? st.negPrefix : st.posPrefix), suffix = render(st, negative ? st.negSuffix : st.posSuffix);
      if (!source.startsWith(prefix, start)) continue;
      let i = start + prefix.length, digits = '', seenDecimal = false, fraction = '', lastGood = -1;
      if (source.startsWith(symbols.infinity, i)) { const end = i + symbols.infinity.length; if (source.startsWith(suffix, end)) { const candidate = { value: negative ? -Infinity : Infinity, end: end + suffix.length }; if (!best || candidate.end > best.end) best = candidate; } continue; }
      for (; i < source.length; i++) {
        const c = source[i], d = c.charCodeAt(0) - symbols.zero.charCodeAt(0);
        if (d >= 0 && d <= 9) { if (seenDecimal) fraction += d; else digits += d; lastGood = i + 1; }
        else if (c === symbols.decimal && !seenDecimal && !st.parseIntegerOnly) { seenDecimal = true; }
        else if (c === symbols.group && st.groupingUsed && !seenDecimal) { /* skipped between digits */ }
        else break;
      }
      if (lastGood < 0) continue;
      let end = lastGood; if (!source.startsWith(suffix, end)) continue; end += suffix.length;
      let value;
      const mantissaText = fraction ? `${digits || '0'}.${fraction}` : digits || '0';
      if (st.parseBigDecimal) value = { decimal: (negative ? '-' : '') + mantissaText };
      else {
        const percentScale = Math.abs(st.multiplier);
        const dec = (BigInt(digits || '0') * 10n ** BigInt(fraction.length) + BigInt(fraction || '0'));
        const exactInteger = dec % (10n ** BigInt(fraction.length)) === 0n ? dec / 10n ** BigInt(fraction.length) : null;
        if (exactInteger !== null && percentScale === 1 && exactInteger <= 9223372036854775807n && !(negative && exactInteger === 0n)) value = negative ? -exactInteger : exactInteger;
        else { let number = Number(mantissaText) / percentScale; value = negative ? -number : number; if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && !Object.is(value, -0)) value = BigInt(value); }
      }
      const candidate = { value, end }; if (!best || candidate.end > best.end) best = candidate;
    }
    return best;
  };
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const boxResult = (r, value) => {
    if (typeof value === 'bigint') return r.boxPrimitive('J', value);
    if (typeof value === 'number') return r.boxPrimitive('D', doubleBits(value));
    return construct(r, 'Ljava/math/BigDecimal;', [STRING], [value.decimal]);
  };
  const positionFields = (r, position) => ({
    get index() { return call(r, position, PP, 'getIndex', [], 'I'); }, set index(v) { call(r, position, PP, 'setIndex', ['I'], 'V', [v]); },
    set error(v) { call(r, position, PP, 'setErrorIndex', ['I'], 'V', [v]); },
  });
  const parseFailure = (r, string) => { const e = construct(r, 'Ljava/text/ParseException;', [STRING, 'I'], [`Unparseable number: "${string}"`, 0]); r.throwJavaReference(e, `Unparseable number: "${string}"`); };
  def(NF, 'parse', `(${STRING}${PP})${NUMBER}`, (r, _m, [self, source, position]) => {
    if (nullish(source) || nullish(position)) npe(r); const p = positionFields(r, position), string = r.stringCharacters(source), result = parseNumber(r, state(r, self), string, p.index);
    if (!result) { p.error = p.index; return null; } p.index = result.end; return boxResult(r, result.value);
  });
  def(NF, 'parse', `(${STRING})${NUMBER}`, (r, _m, [self, source]) => {
    if (nullish(source)) npe(r); const string = r.stringCharacters(source), result = parseNumber(r, state(r, self), string, 0);
    if (!result) parseFailure(r, string);
    return boxResult(r, result.value);
  });
  def(NF, 'parseObject', `(${STRING}${PP})${OBJECT}`, (r, _m, [self, source, position]) => call(r, self, NF, 'parse', [STRING, PP], NUMBER, [source, position]));
  def(NF, 'clone', `()${OBJECT}`, (r, _m, [self]) => { const ref = r.allocate(r.object(self).type); r.object(ref).decimalFormat = { ...state(r, self), symbols: { ...state(r, self).symbols }, posPrefix: [...state(r, self).posPrefix], posSuffix: [...state(r, self).posSuffix], negPrefix: [...state(r, self).negPrefix], negSuffix: [...state(r, self).negSuffix] }; return ref; });
  def(NF, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => { if (self === other || (self && other && self.ref === other.ref)) return 1; if (nullish(other) || r.object(other).decimalFormat === undefined) return 0; return JSON.stringify(state(r, self)) === JSON.stringify(state(r, other)) ? 1 : 0; });
  def(NF, 'hashCode', '()I', (r, _m, [self]) => { const s = JSON.stringify(state(r, self)); let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; });
  def(NF, 'toString', `()${STRING}`, (r, _m, [self]) => `java.text.DecimalFormat@${(call(r, self, NF, 'hashCode', [], 'I') >>> 0).toString(16)}`);

  // ---- NumberFormat factories ------------------------------------------------------------------------------------------------------------------------------------------------
  const make = (r, tag, kind) => {
    const symbols = symbolsFor(tag), st = newState(symbols, null);
    if (kind === 'number') applyPattern(r, st, '#,##0.###');
    else if (kind === 'integer') { applyPattern(r, st, '#,##0'); st.parseIntegerOnly = true; }
    else if (kind === 'percent') {
      const a = affixes(symbols.tag, { style: 'percent' }, 0.25, -0.25); applyPattern(r, st, '#,##0');
      st.posPrefix = a.pos.prefix; st.posSuffix = a.pos.suffix; st.negPrefix = a.neg.prefix; st.negSuffix = a.neg.suffix; st.multiplier = 100;
    } else {
      const code = symbolCurrencyCode(symbols), options = { style: 'currency', currency: code ?? 'XXX', currencyDisplay: 'symbol' };
      const digits = code ? fractionDigits(code) : 2, a = affixes(symbols.tag, options, 1234.5, -1234.5);
      applyPattern(r, st, digits > 0 ? '#,##0.' + '0'.repeat(digits) : '#,##0');
      st.posPrefix = a.pos.prefix; st.posSuffix = a.pos.suffix; st.negPrefix = a.neg.prefix; st.negSuffix = a.neg.suffix;
      st.currencyCode = code; if (!code) st.posPrefix = [{ currency: true }, ...st.posPrefix.filter(t => !t.currency)];
    }
    const ref = r.allocate(DF); r.object(ref).decimalFormat = st; return ref;
  };
  for (const [name, kind] of [['getInstance', 'number'], ['getNumberInstance', 'number'], ['getIntegerInstance', 'integer'], ['getPercentInstance', 'percent'], ['getCurrencyInstance', 'currency']]) {
    def(NF, name, `()${NF}`, r => make(r, defaultTag(r), kind), { static: true });
    def(NF, name, `(${LOCALE})${NF}`, (r, _m, [locale]) => { if (nullish(locale)) npe(r); return make(r, tagOf(r, locale), kind); }, { static: true });
  }
  def(NF, 'getAvailableLocales', `()[${LOCALE}`, r => { const a = r.newArray(`[${LOCALE}`, 1); r.array(a).elements = [localeRef(r, 'en-US')]; return a; }, { static: true });
  return registry;
}
