import { createHostRegistry } from './host-contract.js?v=f90be5f5e9be';
import { bestDateTimePattern, defaultHourCycle } from './date-skeleton.js?v=f90be5f5e9be';
import { APKError } from './apk-error.js?v=f90be5f5e9be';

// android.icu.text / android.icu.util classes mapped over the lab's java.text hosts and the engine's CLDR data (Intl). Android 13 ships ICU4J as android.icu.*; the lab does not carry ICU4J (hundreds
// of classes plus its resource bundles), so each android.icu class below is a thin object holding the java.text / java.util object it maps to (`inner`) and forwarding the same-named API:
//   NumberFormat / DecimalFormat / DecimalFormatSymbols / Currency   -> java.text.NumberFormat / DecimalFormat / DecimalFormatSymbols, java.util.Currency (number-format-host.js)
//   DateFormat / SimpleDateFormat / TimeZone                         -> java.text.SimpleDateFormat (datetime-host.js); getInstanceForSkeleton / getPatternInstance build the locale's pattern for a skeleton
//   Collator / RuleBasedCollator                                      -> Intl.Collator (also backs java.text.Collator); strengths PRIMARY..TERTIARY map to the base / accent / variant sensitivities, IDENTICAL
//                                                                          adds a code-point tie-break, QUATERNARY is treated as TERTIARY; custom rules, sort keys and case-level with SECONDARY fail explicitly
// ICU-only behaviour the mapped classes do not have (significant-digit patterns, plural/scientific/ISO-currency number styles, MeasureFormat, DateFormat skeleton options beyond the common letters, ...)
// raises an explicit unsupported error naming the member, never an approximation. The ICU rounding modes are BigDecimal.ROUND_* ints, mapped to java.math.RoundingMode.
const STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', LOCALE = 'Ljava/util/Locale;', SB = 'Ljava/lang/StringBuffer;', FP = 'Ljava/text/FieldPosition;', PP = 'Ljava/text/ParsePosition;', NUMBER = 'Ljava/lang/Number;', DATE = 'Ljava/util/Date;';
const ULOCALE = 'Landroid/icu/util/ULocale;', I_NF = 'Landroid/icu/text/NumberFormat;', I_DF = 'Landroid/icu/text/DecimalFormat;', I_DFS = 'Landroid/icu/text/DecimalFormatSymbols;', I_CUR = 'Landroid/icu/util/Currency;';
const I_DATEF = 'Landroid/icu/text/DateFormat;', I_SDF = 'Landroid/icu/text/SimpleDateFormat;', I_TZ = 'Landroid/icu/util/TimeZone;', I_COLL = 'Landroid/icu/text/Collator;', I_RBC = 'Landroid/icu/text/RuleBasedCollator;';
const J_NF = 'Ljava/text/NumberFormat;', J_DF = 'Ljava/text/DecimalFormat;', J_DFS = 'Ljava/text/DecimalFormatSymbols;', J_CUR = 'Ljava/util/Currency;', J_DATEF = 'Ljava/text/DateFormat;', J_SDF = 'Ljava/text/SimpleDateFormat;', J_TZ = 'Ljava/util/TimeZone;';
const J_COLL = 'Ljava/text/Collator;', RMODE = 'Ljava/math/RoundingMode;';
const nullish = v => v === null || v === undefined || v === 0;
const ROUNDING = ['UP', 'DOWN', 'CEILING', 'FLOOR', 'HALF_UP', 'HALF_DOWN', 'HALF_EVEN', 'UNNECESSARY'];
const STYLE_NAMES = ['full', 'long', 'medium', 'short'];
const DESCRIPTOR_JAVA = { [ULOCALE]: LOCALE, [I_NF]: J_NF, [I_DF]: J_DF, [I_DFS]: J_DFS, [I_CUR]: J_CUR, [I_DATEF]: J_DATEF, [I_SDF]: J_SDF, [I_TZ]: J_TZ };

export function createIcuTextHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const npe = (r, m = null) => r.throwJava('Ljava/lang/NullPointerException;', m);
  const unsupported = (what, kind = 'icu-text-unsupported') => { throw new APKError(`${what}: not modelled by the lab's android.icu mapping over java.text / Intl (see docs/ICU-TEXT-MAPPING.md)`, { kind }); };
  for (const [icu, parent] of [['Landroid/icu/text/UFormat;', 'Ljava/text/Format;'], ['Landroid/icu/util/MeasureUnit;', OBJECT], [I_NF, 'Landroid/icu/text/UFormat;'], [I_DF, I_NF], [I_DFS, OBJECT], [I_CUR, 'Landroid/icu/util/MeasureUnit;'], [I_DATEF, 'Landroid/icu/text/UFormat;'], [I_SDF, I_DATEF], [I_TZ, OBJECT], [I_COLL, OBJECT], [I_RBC, I_COLL]]) type(icu, parent, [], { allocatable: true });
  const inner = (r, self) => r.object(self).inner ?? r.throwJava('Ljava/lang/IllegalStateException;', 'android.icu object used before construction');
  const wrap = (r, icuType, javaObject) => { if (nullish(javaObject)) return null; const o = r.allocate(icuType); r.object(o).inner = javaObject; return o; };
  const localeOf = (r, v) => nullish(v) ? null : (r.object(v).locale ?? v);   // a ULocale carries its java.util.Locale; a Locale is itself
  const defaultLocale = r => callStatic(r, LOCALE, 'getDefault', [], LOCALE);
  const fromJava = (r, icuDescriptor, value) => icuDescriptor === I_NF || icuDescriptor === I_DF ? wrap(r, I_DF, value) : icuDescriptor === I_SDF || icuDescriptor === I_DATEF ? wrap(r, I_SDF, value) : icuDescriptor === I_DFS ? wrap(r, I_DFS, value) : icuDescriptor === I_CUR ? wrap(r, I_CUR, value) : icuDescriptor === I_TZ ? wrap(r, I_TZ, value) : value;
  const toJava = (r, descriptor, value) => descriptor === ULOCALE ? localeOf(r, value) : DESCRIPTOR_JAVA[descriptor] && !nullish(value) && r.object(value).inner !== undefined ? r.object(value).inner : value;
  const javaDescriptor = d => d === ULOCALE ? LOCALE : DESCRIPTOR_JAVA[d] ?? d;
  /** Forwards owner.name(params)result to javaOwner.name with ICU object parameters unwrapped and ICU object results wrapped. */
  const forward = (icuOwner, javaOwner, name, params, result, { isStatic = false, javaName = name, finalResult = result } = {}) => {
    const javaParams = params.map(javaDescriptor), javaResult = javaDescriptor(result);
    def(icuOwner, name, `(${params.join('')})${finalResult}`, (r, _m, args) => {
      const offset = isStatic ? 0 : 1, values = params.map((p, i) => toJava(r, p, args[offset + i]));
      const out = isStatic ? callStatic(r, javaOwner, javaName, javaParams, javaResult, values) : call(r, inner(r, args[0]), javaOwner, javaName, javaParams, javaResult, values);
      return fromJava(r, finalResult, out);
    }, { static: isStatic });
  };

  // ---- Currency ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  forward(I_CUR, J_CUR, 'getInstance', [STRING], I_CUR, { isStatic: true }); forward(I_CUR, J_CUR, 'getInstance', [LOCALE], I_CUR, { isStatic: true }); forward(I_CUR, J_CUR, 'getInstance', [ULOCALE], I_CUR, { isStatic: true });
  for (const [name, sig] of [['getCurrencyCode', STRING], ['getDefaultFractionDigits', 'I'], ['getNumericCode', 'I'], ['toString', STRING]]) forward(I_CUR, J_CUR, name, [], sig);
  forward(I_CUR, J_CUR, 'getSymbol', [], STRING); forward(I_CUR, J_CUR, 'getSymbol', [LOCALE], STRING); forward(I_CUR, J_CUR, 'getSymbol', [ULOCALE], STRING);
  forward(I_CUR, J_CUR, 'getDisplayName', [], STRING); forward(I_CUR, J_CUR, 'getName', [ULOCALE, 'I', 'Z'.replace('Z', '[Z')], STRING, { javaName: 'getDisplayName' });

  // ---- DecimalFormatSymbols ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  for (const sig of [[], [LOCALE], [ULOCALE]]) { def(I_DFS, '<init>', `(${sig.join('')})V`, (r, _m, [self, locale]) => { r.object(self).inner = sig.length ? callStatic(r, J_DFS, 'getInstance', [LOCALE], J_DFS, [localeOf(r, locale)]) : callStatic(r, J_DFS, 'getInstance', [], J_DFS); }); forward(I_DFS, J_DFS, 'getInstance', sig, I_DFS, { isStatic: true }); }
  for (const property of ['DecimalSeparator', 'GroupingSeparator', 'MinusSign', 'Percent', 'PerMill', 'ZeroDigit', 'Digit', 'PatternSeparator']) { forward(I_DFS, J_DFS, `get${property}`, [], 'C'); forward(I_DFS, J_DFS, `set${property}`, ['C'], 'V'); }
  for (const property of ['CurrencySymbol', 'InternationalCurrencySymbol', 'Infinity', 'NaN', 'MonetaryDecimalSeparator']) {
    try { forward(I_DFS, J_DFS, `get${property}`, [], STRING); forward(I_DFS, J_DFS, `set${property}`, [STRING], 'V'); } catch { /* names the java host lacks fall through to unsupported */ }
  }
  forward(I_DFS, J_DFS, 'getCurrency', [], I_CUR); forward(I_DFS, J_DFS, 'setCurrency', [I_CUR], 'V');
  // ICU keeps the ten digits as strings (digitStrings, cloned by the getter); setZeroDigit renumbers them from the new zero. The lab formats with the zero digit of the java.text symbols.
  def(I_DFS, 'getDigitStrings', `()[${STRING}`, (r, _m, [self]) => {
    const zero = call(r, inner(r, self), J_DFS, 'getZeroDigit', [], 'C'), digits = r.newArray(`[${STRING}`, 10);
    r.array(digits).elements = Array.from({ length: 10 }, (_, i) => String.fromCharCode(zero + i)); return digits;
  });
  // ICU's plusSign is the locale's plus sign when it is one char, otherwise '+' (DEF_PLUS_SIGN); the sign itself comes from Intl (CLDR), with the latn digits the lab formats in.
  def(I_DFS, 'getPlusSign', '()C', (r, _m, [self]) => {
    const o = r.object(self); if (o.plusSign !== undefined) return o.plusSign;
    const locale = call(r, inner(r, self), J_DFS, 'getLocale', [], LOCALE), tag = text(r, call(r, locale, LOCALE, 'toLanguageTag', [], STRING));
    let sign = '+'; try { sign = new Intl.NumberFormat(tag, { numberingSystem: 'latn', signDisplay: 'always' }).formatToParts(1).find(part => part.type === 'plusSign')?.value ?? '+'; } catch { /* a tag Intl refuses: the default */ }
    return sign.length === 1 ? sign.charCodeAt(0) : 0x2b;
  });
  def(I_DFS, 'setPlusSign', '(C)V', (r, _m, [self, sign]) => { inner(r, self); r.object(self).plusSign = sign & 0xffff; });

  // ---- NumberFormat / DecimalFormat ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const nfFactory = { getInstance: 'getNumberInstance', getNumberInstance: 'getNumberInstance', getIntegerInstance: 'getIntegerInstance', getCurrencyInstance: 'getCurrencyInstance', getPercentInstance: 'getPercentInstance' };
  for (const [icuName, javaName] of Object.entries(nfFactory)) for (const sig of [[], [LOCALE], [ULOCALE]]) forward(I_NF, J_NF, icuName, sig, I_NF, { isStatic: true, javaName });
  const STYLES = { 0: 'getNumberInstance', 1: 'getCurrencyInstance', 2: 'getPercentInstance', 4: 'getIntegerInstance' };
  for (const sig of [[LOCALE, 'I'], [ULOCALE, 'I']]) def(I_NF, 'getInstance', `(${sig.join('')})${I_NF}`, (r, _m, [locale, style]) => { const name = STYLES[style]; if (!name) unsupported(`NumberFormat.getInstance(locale, style ${style})`); return wrap(r, I_DF, callStatic(r, J_NF, name, [LOCALE], J_NF, [localeOf(r, locale)])); }, { static: true });
  for (const [name, value] of [['NUMBERSTYLE', 0], ['CURRENCYSTYLE', 1], ['PERCENTSTYLE', 2], ['SCIENTIFICSTYLE', 3], ['INTEGERSTYLE', 4], ['INTEGER_FIELD', 0], ['FRACTION_FIELD', 1]]) staticField(I_NF, name, 'I', () => value);
  for (const [name, params, result] of [['format', ['D'], STRING], ['format', ['J'], STRING], ['format', [OBJECT], STRING], ['format', ['Ljava/math/BigDecimal;'], STRING], ['format', ['Ljava/math/BigInteger;'], STRING], ['format', ['D', SB, FP], SB], ['format', ['J', SB, FP], SB], ['parse', [STRING], NUMBER], ['parse', [STRING, PP], NUMBER], ['parseObject', [STRING], OBJECT],
    ['setMaximumFractionDigits', ['I'], 'V'], ['setMinimumFractionDigits', ['I'], 'V'], ['setMaximumIntegerDigits', ['I'], 'V'], ['setMinimumIntegerDigits', ['I'], 'V'], ['getMaximumFractionDigits', [], 'I'], ['getMinimumFractionDigits', [], 'I'], ['getMaximumIntegerDigits', [], 'I'], ['getMinimumIntegerDigits', [], 'I'],
    ['setGroupingUsed', ['Z'], 'V'], ['isGroupingUsed', [], 'Z'], ['setParseIntegerOnly', ['Z'], 'V'], ['isParseIntegerOnly', [], 'Z'], ['setCurrency', [I_CUR], 'V'], ['getCurrency', [], I_CUR]]) {
    try { forward(I_NF, J_NF, name, params, result); } catch { /* the java host lacks it: unsupported at call time */ }
  }
  def(I_NF, 'setParseStrict', '(Z)V', (r, _m, [self, strict]) => { r.object(self).parseStrict = !!strict; }); def(I_NF, 'isParseStrict', '()Z', (r, _m, [self]) => r.object(self).parseStrict ? 1 : 0);
  def(I_NF, 'setRoundingMode', '(I)V', (r, _m, [self, mode]) => { if (mode < 0 || mode > 7) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Invalid rounding mode: ' + mode); call(r, inner(r, self), J_NF, 'setRoundingMode', [RMODE], 'V', [callStatic(r, RMODE, 'valueOf', [STRING], RMODE, [ROUNDING[mode]])]); });
  def(I_NF, 'getRoundingMode', '()I', (r, _m, [self]) => ROUNDING.indexOf(text(r, call(r, call(r, inner(r, self), J_NF, 'getRoundingMode', [], RMODE), OBJECT, 'toString', [], STRING))));
  def(I_NF, 'getRoundingIncrement', '()Ljava/math/BigDecimal;', () => null);
  for (const [name, params] of [['setPositivePrefix', [STRING]], ['setPositiveSuffix', [STRING]], ['setNegativePrefix', [STRING]], ['setNegativeSuffix', [STRING]]]) forward(I_DF, J_DF, name, params, 'V');
  for (const name of ['getPositivePrefix', 'getPositiveSuffix', 'getNegativePrefix', 'getNegativeSuffix', 'toPattern', 'toLocalizedPattern']) forward(I_DF, J_DF, name, [], STRING);
  for (const name of ['applyPattern', 'applyLocalizedPattern']) forward(I_DF, J_DF, name, [STRING], 'V');
  for (const [name, params, result] of [['setGroupingSize', ['I'], 'V'], ['getGroupingSize', [], 'I'], ['setMultiplier', ['I'], 'V'], ['getMultiplier', [], 'I'], ['setDecimalSeparatorAlwaysShown', ['Z'], 'V'], ['isDecimalSeparatorAlwaysShown', [], 'Z'], ['setParseBigDecimal', ['Z'], 'V'], ['isParseBigDecimal', [], 'Z'], ['getDecimalFormatSymbols', [], I_DFS], ['setDecimalFormatSymbols', [I_DFS], 'V']]) forward(I_DF, J_DF, name, params, result);
  def(I_DF, '<init>', '()V', (r, _m, [self]) => { r.object(self).inner = callStatic(r, J_NF, 'getNumberInstance', [], J_NF); });
  def(I_DF, '<init>', `(${STRING})V`, (r, _m, [self, pattern]) => { if (nullish(pattern)) npe(r); const o = r.allocate(J_DF); r.dispatch({ owner: J_DF, name: '<init>', parameters: [STRING], result: 'V', signature: `(${STRING})V` }, [o, pattern], 'direct'); r.object(self).inner = o; });
  def(I_DF, '<init>', `(${STRING}${I_DFS})V`, (r, _m, [self, pattern, symbols]) => { if (nullish(pattern) || nullish(symbols)) npe(r); const o = r.allocate(J_DF); r.dispatch({ owner: J_DF, name: '<init>', parameters: [STRING, J_DFS], result: 'V', signature: `(${STRING}${J_DFS})V` }, [o, pattern, inner(r, symbols)], 'direct'); r.object(self).inner = o; });
  for (const name of ['setSignAlwaysShown', 'setSignificantDigitsUsed', 'setMaximumSignificantDigits', 'setMinimumSignificantDigits']) def(I_DF, name, name === 'setSignAlwaysShown' || name === 'setSignificantDigitsUsed' ? '(Z)V' : '(I)V', () => unsupported(`DecimalFormat.${name}`));
  for (const name of ['getMinimumSignificantDigits', 'getMaximumSignificantDigits']) def(I_DF, name, '()I', () => unsupported(`DecimalFormat.${name}`));
  def(I_DF, 'areSignificantDigitsUsed', '()Z', () => 0);
  for (const owner of [I_NF, I_DF]) { def(owner, 'toString', `()${STRING}`, (r, _m, [self]) => text(r, call(r, inner(r, self), OBJECT, 'toString', [], STRING))); def(owner, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => !nullish(other) && r.object(other).inner !== undefined && call(r, inner(r, self), OBJECT, 'equals', [OBJECT], 'Z', [inner(r, other)]) ? 1 : 0); def(owner, 'hashCode', '()I', (r, _m, [self]) => call(r, inner(r, self), OBJECT, 'hashCode', [], 'I')); }
  def(I_NF, 'clone', `()${OBJECT}`, (r, _m, [self]) => wrap(r, I_DF, call(r, inner(r, self), OBJECT, 'clone', [], OBJECT)));
  def(I_NF, 'formatToCharacterIterator', `(${OBJECT})Ljava/text/AttributedCharacterIterator;`, () => unsupported('NumberFormat.formatToCharacterIterator (field attributes of a formatted number)'));

  // ---- TimeZone ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  forward(I_TZ, J_TZ, 'getTimeZone', [STRING], I_TZ, { isStatic: true }); forward(I_TZ, J_TZ, 'getDefault', [], I_TZ, { isStatic: true });
  for (const [name, params, result] of [['getID', [], STRING], ['getRawOffset', [], 'I'], ['getOffset', ['J'], 'I'], ['useDaylightTime', [], 'Z'], ['getDisplayName', [], STRING]]) forward(I_TZ, J_TZ, name, params, result);

  // ---- DateFormat / SimpleDateFormat -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  for (const [name, value] of [['FULL', 0], ['LONG', 1], ['MEDIUM', 2], ['SHORT', 3], ['DEFAULT', 2], ['NONE', -1], ['RELATIVE', 128]]) staticField(I_DATEF, name, 'I', () => value);
  const styleCall = (r, kind, locale, a, b) => {
    const target = localeOf(r, locale) ?? null, javaLocale = target ?? defaultLocale(r);
    if (kind === 'date') return callStatic(r, J_DATEF, 'getDateInstance', ['I', LOCALE], J_DATEF, [a, javaLocale]);
    if (kind === 'time') return callStatic(r, J_DATEF, 'getTimeInstance', ['I', LOCALE], J_DATEF, [a, javaLocale]);
    if (a === -1 && b === -1) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Illegal date and time style -1/-1');
    if (a === -1) return callStatic(r, J_DATEF, 'getTimeInstance', ['I', LOCALE], J_DATEF, [b, javaLocale]);
    if (b === -1) return callStatic(r, J_DATEF, 'getDateInstance', ['I', LOCALE], J_DATEF, [a, javaLocale]);
    return callStatic(r, J_DATEF, 'getDateTimeInstance', ['I', 'I', LOCALE], J_DATEF, [a, b, javaLocale]);
  };
  for (const localeType of [null, LOCALE, ULOCALE]) {
    const ls = localeType ? [localeType] : [];
    def(I_DATEF, 'getDateInstance', `(${localeType ? 'I' + localeType : ''})${I_DATEF}`.replace('()', '()'), (r, _m, args) => wrap(r, I_SDF, styleCall(r, 'date', localeType ? args[1] : null, localeType ? args[0] : 2)), { static: true });
    def(I_DATEF, 'getTimeInstance', `(${localeType ? 'I' + localeType : ''})${I_DATEF}`, (r, _m, args) => wrap(r, I_SDF, styleCall(r, 'time', localeType ? args[1] : null, localeType ? args[0] : 2)), { static: true });
    def(I_DATEF, 'getDateTimeInstance', `(${localeType ? 'II' + localeType : ''})${I_DATEF}`, (r, _m, args) => wrap(r, I_SDF, styleCall(r, 'both', localeType ? args[2] : null, localeType ? args[0] : 2, localeType ? args[1] : 2)), { static: true });
    void ls;
  }
  def(I_DATEF, 'getDateInstance', `(I)${I_DATEF}`, (r, _m, [style]) => wrap(r, I_SDF, styleCall(r, 'date', null, style)), { static: true });
  def(I_DATEF, 'getTimeInstance', `(I)${I_DATEF}`, (r, _m, [style]) => wrap(r, I_SDF, styleCall(r, 'time', null, style)), { static: true });
  def(I_DATEF, 'getDateTimeInstance', `(II)${I_DATEF}`, (r, _m, [d, t]) => wrap(r, I_SDF, styleCall(r, 'both', null, d, t)), { static: true });
  def(I_DATEF, 'getInstance', `()${I_DATEF}`, r => wrap(r, I_SDF, styleCall(r, 'both', null, 3, 3)), { static: true });
  // Skeletons ("yMMMd", "jm", "Hms"): the locale's pattern for the components the skeleton names, from Intl, as a SimpleDateFormat pattern.
  const skeletonOptions = skeleton => {
    const o = {};
    for (const ch of new Set(skeleton)) {
      const n = [...skeleton].filter(c => c === ch).length;
      if ('yY'.includes(ch)) o.year = n === 2 ? '2-digit' : 'numeric'; else if ('ML'.includes(ch)) o.month = n >= 4 ? 'long' : n === 3 ? 'short' : n === 2 ? '2-digit' : 'numeric';
      else if (ch === 'd') o.day = n === 2 ? '2-digit' : 'numeric'; else if ('Ec'.includes(ch)) o.weekday = n >= 4 ? 'long' : 'short';
      else if ('hHjJkK'.includes(ch)) { o.hour = n === 2 ? '2-digit' : 'numeric'; if (ch === 'h' || ch === 'K') o.hour12 = true; if (ch === 'H' || ch === 'k') o.hour12 = false; }
      else if (ch === 'm') o.minute = '2-digit'; else if (ch === 's') o.second = '2-digit'; else if (ch === 'z') o.timeZoneName = n >= 4 ? 'long' : 'short'; else if (ch === 'a') { /* day period follows the 12-hour cycle */ }
      else unsupported(`DateFormat skeleton letter '${ch}' in "${skeleton}"`);
    }
    return o;
  };
  const patternFor = (tag, options) => {
    const sample = new Date(Date.UTC(2003, 0, 2, 4, 5, 6)), formatter = new Intl.DateTimeFormat(tag, { timeZone: 'UTC', ...options }), parts = formatter.formatToParts(sample);
    const long = new Intl.DateTimeFormat(tag, { timeZone: 'UTC', month: 'long', weekday: 'long' }).formatToParts(sample), longMonth = long.find(p => p.type === 'month')?.value, longWeekday = long.find(p => p.type === 'weekday')?.value, twelve = parts.some(p => p.type === 'dayPeriod');
    const width = (v, letter) => /^0\d/.test(v) ? letter + letter : letter; let out = '';
    for (const { type: kind, value } of parts) {
      switch (kind) {
        case 'year': out += value.length === 2 ? 'yy' : 'y'; break; case 'month': out += /^\d+$/.test(value) ? width(value, 'M') : value === longMonth ? 'MMMM' : 'MMM'; break;
        case 'weekday': out += value === longWeekday ? 'EEEE' : 'EEE'; break; case 'day': out += width(value, 'd'); break; case 'hour': out += width(value, twelve ? 'h' : 'H'); break;
        case 'minute': out += 'mm'; break; case 'second': out += 'ss'; break; case 'dayPeriod': out += 'a'; break; case 'timeZoneName': out += value.length > 5 ? 'zzzz' : 'z'; break;
        default: out += value.replace(/[  ]/g, ' ').replace(/[A-Za-z]+/g, m => `'${m}'`);
      }
    }
    return out;
  };
  const fromSkeleton = (r, skeleton, locale) => {
    if (nullish(skeleton)) npe(r, 'skeleton'); const tag = text(r, callV(r, localeOf(r, locale) ?? defaultLocale(r), LOCALE, 'toLanguageTag', [], STRING)), pattern = patternFor(tag, skeletonOptions(text(r, skeleton)));
    const o = r.allocate(J_SDF); r.dispatch({ owner: J_SDF, name: '<init>', parameters: [STRING, LOCALE], result: 'V', signature: `(${STRING}${LOCALE})V` }, [o, pattern, localeOf(r, locale) ?? defaultLocale(r)], 'direct'); return wrap(r, I_SDF, o);
  };
  const callV = call;
  for (const name of ['getInstanceForSkeleton', 'getPatternInstance']) {
    def(I_DATEF, name, `(${STRING})${I_DATEF}`, (r, _m, [skeleton]) => fromSkeleton(r, skeleton, null), { static: true });
    def(I_DATEF, name, `(${STRING}${LOCALE})${I_DATEF}`, (r, _m, [skeleton, locale]) => fromSkeleton(r, skeleton, locale), { static: true });
    def(I_DATEF, name, `(${STRING}${ULOCALE})${I_DATEF}`, (r, _m, [skeleton, locale]) => fromSkeleton(r, skeleton, locale), { static: true });
  }
  // MeasureFormat.getInstance(locale, width).formatMeasures(Measure...) for the time units (Chronometer's content description, "1 hour, 2 minutes, 5 seconds"): each measure is
  // Intl's unit format of its width and the list is Intl's unit list of the same width, which is what ICU's MeasureFormat composes. Other units and the NUMERIC width are not modelled.
  const MEASURE = 'Landroid/icu/util/Measure;', MEASURE_UNIT = 'Landroid/icu/util/MeasureUnit;', TIME_UNIT = 'Landroid/icu/util/TimeUnit;', MEASURE_FORMAT = 'Landroid/icu/text/MeasureFormat;', FORMAT_WIDTH = 'Landroid/icu/text/MeasureFormat$FormatWidth;';
  type(TIME_UNIT, MEASURE_UNIT, [], { allocatable: true }); type(MEASURE, OBJECT, [], { allocatable: true }); type(MEASURE_FORMAT, 'Landroid/icu/text/UFormat;', [], { allocatable: true }); type(FORMAT_WIDTH, 'Ljava/lang/Enum;', [], { allocatable: true });
  for (const [name, unit] of [['HOUR', 'hour'], ['MINUTE', 'minute'], ['SECOND', 'second'], ['DAY', 'day'], ['WEEK', 'week'], ['MONTH', 'month'], ['YEAR', 'year']]) staticField(MEASURE_UNIT, name, TIME_UNIT, r => { const o = r.allocate(TIME_UNIT); r.object(o).intlUnit = unit; return o; });
  for (const [name, display] of [['WIDE', 'long'], ['SHORT', 'short'], ['NARROW', 'narrow'], ['NUMERIC', null]]) staticField(FORMAT_WIDTH, name, FORMAT_WIDTH, r => { const o = r.allocate(FORMAT_WIDTH); r.object(o).unitDisplay = display; r.object(o).enumName = name; return o; });
  def(MEASURE, '<init>', `(Ljava/lang/Number;${MEASURE_UNIT})V`, (r, _m, [self, number, unit]) => { if (nullish(number) || nullish(unit)) npe(r, 'Number and MeasureUnit must not be null'); const o = r.object(self); o.measureNumber = number; o.measureUnit = unit; });
  def(MEASURE, 'getNumber', '()Ljava/lang/Number;', (r, _m, [self]) => r.object(self).measureNumber); def(MEASURE, 'getUnit', `()${MEASURE_UNIT}`, (r, _m, [self]) => r.object(self).measureUnit);
  for (const localeType of [LOCALE, ULOCALE]) def(MEASURE_FORMAT, 'getInstance', `(${localeType}${FORMAT_WIDTH})${MEASURE_FORMAT}`, (r, _m, [locale, width]) => {
    if (nullish(width)) npe(r, 'formatWidth'); const display = r.object(width).unitDisplay; if (!display) unsupported('MeasureFormat width NUMERIC');
    const o = r.allocate(MEASURE_FORMAT); r.object(o).measureFormat = { tag: text(r, callV(r, localeOf(r, locale) ?? defaultLocale(r), LOCALE, 'toLanguageTag', [], STRING)), display }; return o;
  }, { static: true });
  // Units Intl formats as ICU does (CLDR "digital" and "concentr" units): bytes and bits, the SI multiples, percent.
  for (const [name, unit] of [['BIT', 'bit'], ['BYTE', 'byte'], ['KILOBIT', 'kilobit'], ['KILOBYTE', 'kilobyte'], ['MEGABIT', 'megabit'], ['MEGABYTE', 'megabyte'], ['GIGABIT', 'gigabit'], ['GIGABYTE', 'gigabyte'], ['TERABIT', 'terabit'], ['TERABYTE', 'terabyte'], ['PETABYTE', 'petabyte'], ['PERCENT', 'percent']])
    staticField(MEASURE_UNIT, name, MEASURE_UNIT, r => { const o = r.allocate(MEASURE_UNIT); r.object(o).intlUnit = unit; return o; });
  const doubleOf = (r, number) => { const bits = call(r, number, 'Ljava/lang/Number;', 'doubleValue', [], 'D'); return typeof bits === 'bigint' ? new Float64Array(new BigInt64Array([bits]).buffer)[0] : Number(bits); };
  const intlUnitOf = (r, unitRef, what) => { const unit = r.object(unitRef).intlUnit; if (!unit) unsupported(`${what} for a MeasureUnit the lab does not map to an Intl unit`); return unit; };
  // getInstance(locale, width, NumberFormat): the measure's number takes that NumberFormat's fraction digits (and grouping); without one, the locale's default NumberFormat (at most 3 fraction digits)
  for (const localeType of [LOCALE, ULOCALE]) def(MEASURE_FORMAT, 'getInstance', `(${localeType}${FORMAT_WIDTH}${I_NF})${MEASURE_FORMAT}`, (r, _m, [locale, width, numberFormat]) => {
    if (nullish(width)) npe(r, 'formatWidth'); const display = r.object(width).unitDisplay; if (!display) unsupported('MeasureFormat width NUMERIC');
    const digits = nullish(numberFormat) ? {} : { minimumFractionDigits: call(r, numberFormat, I_NF, 'getMinimumFractionDigits', [], 'I'), maximumFractionDigits: call(r, numberFormat, I_NF, 'getMaximumFractionDigits', [], 'I'), useGrouping: call(r, numberFormat, I_NF, 'isGroupingUsed', [], 'Z') !== 0 };
    const o = r.allocate(MEASURE_FORMAT); r.object(o).measureFormat = { tag: text(r, callV(r, localeOf(r, locale) ?? defaultLocale(r), LOCALE, 'toLanguageTag', [], STRING)), display, digits }; return o;
  }, { static: true });
  const formatMeasureList = (r, self, refs) => {
    const { tag, display, digits = {} } = r.object(self).measureFormat, parts = refs.map(ref => {
      if (nullish(ref) || r.typeOf(ref) !== MEASURE) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Expecting a Measure');
      const measure = r.object(ref); return new Intl.NumberFormat(tag, { ...digits, style: 'unit', unit: intlUnitOf(r, measure.measureUnit, 'MeasureFormat'), unitDisplay: display }).format(doubleOf(r, measure.measureNumber));
    });
    return new Intl.ListFormat(tag, { type: 'unit', style: display }).format(parts);
  };
  def(MEASURE_FORMAT, 'formatMeasures', `([${MEASURE})${STRING}`, (r, _m, [self, measures]) => formatMeasureList(r, self, r.array(measures).elements));
  // Format.format(Object): ICU's MeasureFormat takes a Measure, a Measure[] or a Collection of them
  def(MEASURE_FORMAT, 'format', `(${OBJECT})${STRING}`, (r, _m, [self, object]) => {
    if (nullish(object)) npe(r);
    if (r.typeOf(object) === MEASURE) return formatMeasureList(r, self, [object]);
    if (r.typeOf(object) === `[${MEASURE}`) return formatMeasureList(r, self, r.array(object).elements);
    if (r.isSubtype(r.typeOf(object), 'Ljava/util/Collection;')) return formatMeasureList(r, self, r.array(call(r, object, 'Ljava/util/Collection;', 'toArray', [], `[${OBJECT}`)).elements);
    r.throwJava('Ljava/lang/IllegalArgumentException;', `Cannot format ${r.typeOf(object).slice(1, -1).replaceAll('/', '.')}`);
  });

  // ---- android.icu.text.TimeZoneNames (what java.time's zone text uses: DateTimeFormatterBuilder.ZoneTextPrinterParser, ZoneName) --------------------------------------
  // Names come from Intl.DateTimeFormat's timeZoneName (V8's ICU and CLDR data): STANDARD / DAYLIGHT are the long or short name at a date of the year on that side of the
  // zone's DST rule (a zone without DST has no daylight name: null), GENERIC is longGeneric / shortGeneric, EXEMPLAR_LOCATION is ICU's default exemplar (the last ID segment,
  // underscores as spaces). A name that is only a GMT offset is no zone name for ICU: null, and java.time then formats "GMT+hh:mm" itself, as on a device.
  // Metazone IDs are not exposed by Intl: getAvailableMetaZoneIDs is an empty set (recorded once), which the java.time callers only test region IDs against.
  const TZN = 'Landroid/icu/text/TimeZoneNames;', NAME_TYPE = 'Landroid/icu/text/TimeZoneNames$NameType;';
  type(TZN, OBJECT, ['Ljava/io/Serializable;'], { allocatable: true }); type(NAME_TYPE, 'Ljava/lang/Enum;', [], { allocatable: true });
  const NAME_TYPES = ['LONG_GENERIC', 'LONG_STANDARD', 'LONG_DAYLIGHT', 'SHORT_GENERIC', 'SHORT_STANDARD', 'SHORT_DAYLIGHT', 'EXEMPLAR_LOCATION'];
  NAME_TYPES.forEach((name, ordinal) => staticField(NAME_TYPE, name, NAME_TYPE, r => { const o = r.allocate(NAME_TYPE); Object.assign(r.object(o), { enumName: name, enumOrdinal: ordinal }); return o; }));
  def(NAME_TYPE, 'values', `()[${NAME_TYPE}`, r => { const a = r.newArray(`[${NAME_TYPE}`, NAME_TYPES.length); r.array(a).elements = NAME_TYPES.map(name => r.readStatic({ owner: NAME_TYPE, name, type: NAME_TYPE })); return a; }, { static: true });
  def(NAME_TYPE, 'ordinal', '()I', (r, _m, [self]) => r.object(self).enumOrdinal); def(NAME_TYPE, 'name', `()${STRING}`, (r, _m, [self]) => r.object(self).enumName);
  const tzNamesFor = (r, locale) => { const o = r.allocate(TZN); r.object(o).tzTag = text(r, callV(r, localeOf(r, locale) ?? defaultLocale(r), LOCALE, 'toLanguageTag', [], STRING)); return o; };
  for (const localeType of [LOCALE, ULOCALE]) def(TZN, 'getInstance', `(${localeType})${TZN}`, (r, _m, [locale]) => { if (nullish(locale)) npe(r); return tzNamesFor(r, locale); }, { static: true });
  const zoneName = (tag, id, date, style) => { try { return new Intl.DateTimeFormat(tag, { timeZone: id, timeZoneName: style }).formatToParts(date).find(p => p.type === 'timeZoneName')?.value ?? null; } catch { return null; } };
  const offsetAt = (id, date) => zoneName('en-US', id, date, 'longOffset');
  const onlyOffset = name => name === null || /^(GMT|UTC)([+\-−]|$)/.test(name);
  const displayName = (tag, id, typeName, dateMs) => {
    if (id === null) return null;
    if (typeName === 'EXEMPLAR_LOCATION') { if (!id.includes('/') || id.startsWith('Etc/')) return null; return id.slice(id.lastIndexOf('/') + 1).replaceAll('_', ' '); }
    const date = new Date(Number(dateMs)), long = typeName.startsWith('LONG'), kind = typeName.slice(typeName.indexOf('_') + 1);
    let name;
    if (kind === 'GENERIC') name = zoneName(tag, id, date, long ? 'longGeneric' : 'shortGeneric');
    else {
      const year = date.getUTCFullYear(), january = new Date(Date.UTC(year, 0, 15)), july = new Date(Date.UTC(year, 6, 15));
      const a = offsetAt(id, january), b = offsetAt(id, july); if (a === null) return null;
      const minutes = o => { const m = /([+\-−])(\d+)(?::(\d+))?/.exec(o); return m ? (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0; };
      if (a === b) name = kind === 'STANDARD' ? zoneName(tag, id, date, long ? 'long' : 'short') : null;
      else { const standardDate = minutes(a) < minutes(b) ? january : july, daylightDate = standardDate === january ? july : january; name = zoneName(tag, id, kind === 'STANDARD' ? standardDate : daylightDate, long ? 'long' : 'short'); }
    }
    return onlyOffset(name) ? null : name;
  };
  def(TZN, 'getDisplayName', `(${STRING}${NAME_TYPE}J)${STRING}`, (r, _m, [self, id, type, date]) => { if (nullish(type)) npe(r); return displayName(r.object(self).tzTag, text(r, id), r.object(type).enumName, date); });
  const getDisplayNames = (r, self, id, types, date, dest, offset) => {
    if (nullish(types) || nullish(dest)) npe(r);
    const names = r.array(types).elements, out = r.array(dest).elements, zone = text(r, id), tag = r.object(self).tzTag;
    if (offset < 0 || offset + names.length > out.length) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', null);
    names.forEach((type, i) => { out[offset + i] = nullish(type) ? null : displayName(tag, zone, r.object(type).enumName, date); });
  };
  def(TZN, 'getDisplayNames', `(${STRING}[${NAME_TYPE}J[${STRING}I)V`, (r, _m, [self, id, types, date, dest, offset]) => getDisplayNames(r, self, id, types, date, dest, offset));
  def('Llibcore/icu/TimeZoneNames;', 'getDisplayNames', `(${TZN}${STRING}[${NAME_TYPE}J[${STRING}I)V`, (r, _m, [names, id, types, date, dest, offset]) => { if (nullish(names)) npe(r); getDisplayNames(r, names, id, types, date, dest, offset); }, { static: true });
  type('Llibcore/icu/TimeZoneNames;', OBJECT, [], { allocatable: false });
  def(TZN, 'getAvailableMetaZoneIDs', '()Ljava/util/Set;', r => { if (!r.metaZoneNoticeRecorded) { r.metaZoneNoticeRecorded = true; r.record('ICU TimeZoneNames.getAvailableMetaZoneIDs: metazone IDs are not exposed by the browser\'s Intl data; empty set'); } return callStatic(r, 'Ljava/util/Collections;', 'emptySet', [], 'Ljava/util/Set;'); });
  def(TZN, 'getMetaZoneID', `(${STRING}J)${STRING}`, () => null);
  // android.icu.util.TimeZone.getCanonicalID(id, isSystemID[]) and UNKNOWN_ZONE_ID: Intl's canonical IANA/CLDR ID; "GMT+hh:mm" custom IDs are returned as given with isSystemID false
  staticField(I_TZ, 'UNKNOWN_ZONE_ID', STRING, () => 'Etc/Unknown');
  const canonicalZone = id => { try { return new Intl.DateTimeFormat('en', { timeZone: id }).resolvedOptions().timeZone; } catch { return null; } };
  def(I_TZ, 'getCanonicalID', `(${STRING}[Z)${STRING}`, (r, _m, [id, isSystem]) => {
    if (nullish(id)) npe(r); const zone = text(r, id), custom = /^GMT[+-]\d{1,2}(:?\d{2})?$/.test(zone), canonical = custom ? null : canonicalZone(zone);
    if (!nullish(isSystem) && r.array(isSystem).elements.length) r.array(isSystem).elements[0] = canonical !== null ? 1 : 0;
    return canonical ?? (custom ? zone : null);
  }, { static: true });
  def(I_TZ, 'getCanonicalID', `(${STRING})${STRING}`, (r, _m, [id]) => { if (nullish(id)) npe(r); const zone = text(r, id); return canonicalZone(zone) ?? (/^GMT[+-]\d{1,2}(:?\d{2})?$/.test(zone) ? zone : null); }, { static: true });

  // ---- android.icu.number (API 30): NumberFormatter.with() / withLocale(), the immutable settings chain, LocalizedNumberFormatter.format -> FormattedNumber --------------------------
  // Modelled settings: unit (an Intl-mapped MeasureUnit), unitWidth (NARROW / SHORT / FULL_NAME / HIDDEN), precision (integer, unlimited, fixed/min/max/minMax fraction), roundingMode;
  // ICU's defaults: at most 6 fraction digits, HALF_EVEN, SHORT unit width. Each setter returns a new formatter, as in ICU. Other settings fail by name.
  const NF_N = 'Landroid/icu/number/NumberFormatter;', SETTINGS = 'Landroid/icu/number/NumberFormatterSettings;', UNLOC = 'Landroid/icu/number/UnlocalizedNumberFormatter;', LOC = 'Landroid/icu/number/LocalizedNumberFormatter;';
  const PRECISION = 'Landroid/icu/number/Precision;', FRACTION_PRECISION = 'Landroid/icu/number/FractionPrecision;', FORMATTED = 'Landroid/icu/number/FormattedNumber;', UNIT_WIDTH = 'Landroid/icu/number/NumberFormatter$UnitWidth;';
  type(SETTINGS, OBJECT, [], { allocatable: false }); type(UNLOC, SETTINGS, [], { allocatable: true }); type(LOC, SETTINGS, [], { allocatable: true }); type(NF_N, OBJECT, [], { allocatable: false });
  type(PRECISION, OBJECT, [], { allocatable: true }); type(FRACTION_PRECISION, PRECISION, [], { allocatable: true }); type(FORMATTED, OBJECT, ['Ljava/lang/CharSequence;'], { allocatable: true }); type(UNIT_WIDTH, 'Ljava/lang/Enum;', [], { allocatable: true });
  ['NARROW', 'SHORT', 'FULL_NAME', 'ISO_CODE', 'HIDDEN'].forEach((name, ordinal) => staticField(UNIT_WIDTH, name, UNIT_WIDTH, r => { const o = r.allocate(UNIT_WIDTH); Object.assign(r.object(o), { enumName: name, enumOrdinal: ordinal }); return o; }));
  const settingsOf = (r, self) => self === null ? {} : r.object(self).numberSettings ?? {};
  const derive = (r, self, change, type = r.typeOf(self)) => { const o = r.allocate(type === LOC || type === UNLOC ? type : r.isSubtype(type, LOC) ? LOC : UNLOC); r.object(o).numberSettings = { ...settingsOf(r, self), ...change }; return o; };
  def(NF_N, 'with', `()${UNLOC}`, r => derive(r, null, {}, UNLOC), { static: true });
  def(NF_N, 'withLocale', `(${LOCALE})${LOC}`, (r, _m, [locale]) => { if (nullish(locale)) npe(r); return derive(r, null, { locale }, LOC); }, { static: true });
  def(NF_N, 'withLocale', `(${ULOCALE})${LOC}`, (r, _m, [locale]) => { if (nullish(locale)) npe(r); return derive(r, null, { locale: localeOf(r, locale) }, LOC); }, { static: true });
  for (const owner of [UNLOC, LOC]) {
    const setter = (name, param, change) => def(owner, name, `(${param})${SETTINGS}`, (r, _m, [self, value]) => derive(r, self, change(r, value)));
    setter('unit', MEASURE_UNIT, (r, unit) => ({ unit: nullish(unit) ? null : intlUnitOf(r, unit, 'NumberFormatter.unit') }));
    setter('unitWidth', UNIT_WIDTH, (r, width) => { const name = nullish(width) ? 'SHORT' : r.object(width).enumName; if (name === 'ISO_CODE') unsupported('NumberFormatter.unitWidth(ISO_CODE) (a currency setting)'); return { unitWidth: name }; });
    setter('precision', PRECISION, (r, precision) => ({ precision: nullish(precision) ? null : r.object(precision).precision }));
    setter('roundingMode', RMODE, (r, mode) => { if (nullish(mode)) npe(r); const name = r.object(mode).enumName ?? text(r, call(r, mode, 'Ljava/lang/Enum;', 'name', [], STRING)); const intl = { UP: 'expand', DOWN: 'trunc', CEILING: 'ceil', FLOOR: 'floor', HALF_UP: 'halfExpand', HALF_DOWN: 'halfTrunc', HALF_EVEN: 'halfEven' }[name]; if (!intl) unsupported(`NumberFormatter.roundingMode(${name})`); return { roundingMode: intl }; });
  }
  def(UNLOC, 'locale', `(${LOCALE})${LOC}`, (r, _m, [self, locale]) => { if (nullish(locale)) npe(r); return derive(r, self, { locale }, LOC); });
  def(UNLOC, 'locale', `(${ULOCALE})${LOC}`, (r, _m, [self, locale]) => { if (nullish(locale)) npe(r); return derive(r, self, { locale: localeOf(r, locale) }, LOC); });
  const precision = (r, type, value) => { const o = r.allocate(type); r.object(o).precision = value; return o; };
  const digitsArg = (r, n, name) => { if (n < 0 || n > 999) r.throwJava('Ljava/lang/IllegalArgumentException;', `${name} must be between 0 and 999 (inclusive)`); return n; };
  def(PRECISION, 'integer', `()${FRACTION_PRECISION}`, r => precision(r, FRACTION_PRECISION, { minimumFractionDigits: 0, maximumFractionDigits: 0 }), { static: true });
  def(PRECISION, 'unlimited', `()${PRECISION}`, r => precision(r, PRECISION, { minimumFractionDigits: 0, maximumFractionDigits: 100 }), { static: true });
  def(PRECISION, 'fixedFraction', `(I)${FRACTION_PRECISION}`, (r, _m, [n]) => precision(r, FRACTION_PRECISION, { minimumFractionDigits: digitsArg(r, n, 'Fraction length'), maximumFractionDigits: n }), { static: true });
  def(PRECISION, 'minFraction', `(I)${FRACTION_PRECISION}`, (r, _m, [n]) => precision(r, FRACTION_PRECISION, { minimumFractionDigits: digitsArg(r, n, 'Fraction length'), maximumFractionDigits: 100 }), { static: true });
  def(PRECISION, 'maxFraction', `(I)${FRACTION_PRECISION}`, (r, _m, [n]) => precision(r, FRACTION_PRECISION, { minimumFractionDigits: 0, maximumFractionDigits: digitsArg(r, n, 'Fraction length') }), { static: true });
  def(PRECISION, 'minMaxFraction', `(II)${FRACTION_PRECISION}`, (r, _m, [min, max]) => { digitsArg(r, min, 'Fraction length'); digitsArg(r, max, 'Fraction length'); if (min > max) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Fraction length must be between 0 and 999 (inclusive)'); return precision(r, FRACTION_PRECISION, { minimumFractionDigits: min, maximumFractionDigits: max }); }, { static: true });
  const formatNumber = (r, self, value) => {
    const s = settingsOf(r, self), tag = text(r, callV(r, s.locale ?? defaultLocale(r), LOCALE, 'toLanguageTag', [], STRING));
    const options = { minimumFractionDigits: 0, maximumFractionDigits: 6, roundingMode: s.roundingMode ?? 'halfEven', ...(s.precision ?? {}) };
    if (s.unit && s.unitWidth !== 'HIDDEN') Object.assign(options, { style: 'unit', unit: s.unit, unitDisplay: { NARROW: 'narrow', FULL_NAME: 'long' }[s.unitWidth] ?? 'short' });
    const o = r.allocate(FORMATTED); r.object(o).formattedText = new Intl.NumberFormat(tag, options).format(value); return o;
  };
  def(LOC, 'format', `(D)${FORMATTED}`, (r, _m, [self, bits]) => formatNumber(r, self, typeof bits === 'bigint' ? new Float64Array(new BigInt64Array([bits]).buffer)[0] : Number(bits)));
  def(LOC, 'format', `(J)${FORMATTED}`, (r, _m, [self, value]) => formatNumber(r, self, BigInt(value)));
  def(LOC, 'format', `(Ljava/lang/Number;)${FORMATTED}`, (r, _m, [self, number]) => { if (nullish(number)) npe(r); return formatNumber(r, self, doubleOf(r, number)); });
  def(FORMATTED, 'toString', `()${STRING}`, (r, _m, [self]) => r.object(self).formattedText);
  def(FORMATTED, 'length', '()I', (r, _m, [self]) => r.object(self).formattedText.length);
  def(FORMATTED, 'charAt', '(I)C', (r, _m, [self, i]) => r.object(self).formattedText.charCodeAt(i));
  def(FORMATTED, 'subSequence', `(II)Ljava/lang/CharSequence;`, (r, _m, [self, a, b]) => r.object(self).formattedText.slice(a, b));
  def(I_DATEF, 'getPatternInstance', `(Landroid/icu/text/DateFormat$HourCycle;${STRING}${LOCALE})${I_DATEF}`, () => unsupported('DateFormat.getPatternInstance(hourCycle, ...)'), { static: true });
  for (const [name, params, result] of [['format', [DATE, SB, FP], SB], ['parse', [STRING], DATE], ['parse', [STRING, PP], DATE], ['parseObject', [STRING], OBJECT], ['setTimeZone', [I_TZ], 'V'], ['getTimeZone', [], I_TZ], ['setLenient', ['Z'], 'V'], ['isLenient', [], 'Z']]) { try { forward(I_DATEF, J_DATEF, name, params, result); } catch { /* unsupported at call */ } }
  def(I_DATEF, 'getCalendar', '()Landroid/icu/util/Calendar;', () => unsupported('DateFormat.getCalendar (android.icu.util.Calendar)')); def(I_DATEF, 'setCalendar', '(Landroid/icu/util/Calendar;)V', () => unsupported('DateFormat.setCalendar (android.icu.util.Calendar)'));
  // DateFormat.setContext(DisplayContext): the capitalization context of the formatted text. NONE and MIDDLE_OF_SENTENCE change nothing; BEGINNING_OF_SENTENCE titlecases the first letter.
  // UI_LIST_OR_MENU and STANDALONE titlecase it only where the locale's CLDR contextTransforms say so, data the engine does not expose: a text that already starts with an upper-case or
  // caseless letter is returned as it is (no transform can change it), any other fails naming the context instead of guessing.
  const DISPLAY_CONTEXT = 'Landroid/icu/text/DisplayContext;', DISPLAY_CONTEXT_TYPE = 'Landroid/icu/text/DisplayContext$Type;'; type(DISPLAY_CONTEXT, 'Ljava/lang/Enum;', [], { allocatable: true }); type(DISPLAY_CONTEXT_TYPE, 'Ljava/lang/Enum;', [], { allocatable: true });
  const CONTEXT_TYPES = ['DIALECT_HANDLING', 'CAPITALIZATION', 'DISPLAY_LENGTH', 'SUBSTITUTE_HANDLING'];
  CONTEXT_TYPES.forEach((name, ordinal) => staticField(DISPLAY_CONTEXT_TYPE, name, DISPLAY_CONTEXT_TYPE, r => { const o = r.allocate(DISPLAY_CONTEXT_TYPE); Object.assign(r.object(o), { enumName: name, enumOrdinal: ordinal }); return o; }));
  [['STANDARD_NAMES', 0], ['DIALECT_NAMES', 0], ['CAPITALIZATION_NONE', 1], ['CAPITALIZATION_FOR_MIDDLE_OF_SENTENCE', 1], ['CAPITALIZATION_FOR_BEGINNING_OF_SENTENCE', 1], ['CAPITALIZATION_FOR_UI_LIST_OR_MENU', 1], ['CAPITALIZATION_FOR_STANDALONE', 1], ['LENGTH_FULL', 2], ['LENGTH_SHORT', 2], ['SUBSTITUTE', 3], ['NO_SUBSTITUTE', 3]]
    .forEach(([name, contextType], ordinal) => staticField(DISPLAY_CONTEXT, name, DISPLAY_CONTEXT, r => { const o = r.allocate(DISPLAY_CONTEXT); Object.assign(r.object(o), { enumName: name, enumOrdinal: ordinal, contextType }); return o; }));
  def(DISPLAY_CONTEXT, 'type', `()${DISPLAY_CONTEXT_TYPE}`, (r, _m, [self]) => r.readStatic({ owner: DISPLAY_CONTEXT_TYPE, name: CONTEXT_TYPES[r.object(self).contextType], type: DISPLAY_CONTEXT_TYPE })); def(DISPLAY_CONTEXT, 'value', '()I', (r, _m, [self]) => r.object(self).enumOrdinal);
  def(I_DATEF, 'setContext', `(${DISPLAY_CONTEXT})V`, (r, _m, [self, context]) => { const c = r.object(context); if (c.contextType === 1) r.object(self).capitalization = context; });
  def(I_DATEF, 'getContext', `(${DISPLAY_CONTEXT_TYPE})${DISPLAY_CONTEXT}`, (r, _m, [self, kind]) => r.object(kind).enumName === 'CAPITALIZATION' ? r.object(self).capitalization ?? r.readStatic({ owner: DISPLAY_CONTEXT, name: 'CAPITALIZATION_NONE', type: DISPLAY_CONTEXT }) : unsupported('DateFormat.getContext for a type other than CAPITALIZATION'));
  const inContext = (r, self, out) => {
    const context = r.object(self).capitalization ? r.object(r.object(self).capitalization).enumName : 'CAPITALIZATION_NONE'; if (context === 'CAPITALIZATION_NONE' || context === 'CAPITALIZATION_FOR_MIDDLE_OF_SENTENCE') return out;
    const value = text(r, out); if (!value) return out; const first = String.fromCodePoint(value.codePointAt(0)), upper = first.toLocaleUpperCase(platform.device?.locale ?? 'en-US'); if (upper === first) return out;
    if (context === 'CAPITALIZATION_FOR_BEGINNING_OF_SENTENCE') return upper + value.slice(first.length);
    return unsupported(`DateFormat.format with DisplayContext.${context} for a text that starts in lower case (whether the locale titlecases it is CLDR contextTransforms data)`);
  };
  for (const parameter of [DATE, OBJECT]) def(I_DATEF, 'format', `(${parameter})${STRING}`, (r, _m, [self, value]) => inContext(r, self, call(r, inner(r, self), J_DATEF, 'format', [parameter], STRING, [value])));

  // ---- android.icu.util.Calendar / GregorianCalendar. The calendar system of a locale (getType) is its `ca` keyword when it has one, else the calendar CLDR prefers for the
  // locale (Intl), under ICU's legacy names. The Gregorian calendar runs over java.util.GregorianCalendar (datetime-host.js) with the fields both classes share (ERA .. DST_OFFSET, the
  // same numbers in both). A Calendar of another system (Buddhist, Persian, ...) answers its type and zone only: its arithmetic, and the ICU-only fields (YEAR_WOY, DOW_LOCAL,
  // EXTENDED_YEAR, JULIAN_DAY, MILLISECONDS_IN_DAY) of any calendar, fail by name.
  const I_CAL = 'Landroid/icu/util/Calendar;', I_GCAL = 'Landroid/icu/util/GregorianCalendar;', J_CAL = 'Ljava/util/Calendar;', CALENDAR_LEGACY = { gregory: 'gregorian', ethioaa: 'ethiopic-amete-alem', islamicc: 'islamic-civil' };
  type(I_CAL, OBJECT, ['Ljava/io/Serializable;', 'Ljava/lang/Cloneable;', 'Ljava/lang/Comparable;'], { allocatable: true }); type(I_GCAL, I_CAL, [], { allocatable: true });
  const calendarType = (r, locale) => {
    const tag = text(r, call(r, localeOf(r, locale), LOCALE, 'toLanguageTag', [], STRING)), keyword = nullish(locale) ? undefined : r.object(locale).keywords?.ca;
    let calendar = keyword || /-u(?:-[a-z0-9]{2,8})*-ca-([a-z0-9]{3,8}(?:-[a-z0-9]{3,8})?)/i.exec(tag)?.[1]?.toLowerCase();
    if (!calendar) { try { calendar = new Intl.DateTimeFormat(tag).resolvedOptions().calendar; } catch { unsupported(`Calendar for locale ${tag}`, 'calendar-locale-unsupported'); } }
    return CALENDAR_LEGACY[calendar] ?? calendar;
  };
  const javaCalendar = (r, zone) => nullish(zone) ? callStatic(r, J_CAL, 'getInstance', [], J_CAL) : callStatic(r, J_CAL, 'getInstance', [J_TZ], J_CAL, [inner(r, zone)]);
  /** Calendar.getInstance: the Gregorian calendar is a GregorianCalendar over java.util's; another system is a Calendar that knows its type and zone only. */
  const calendarFor = (r, locale, zone) => {
    const kind = calendarType(r, locale ?? defaultLocale(r));
    if (kind === 'gregorian') { const o = wrap(r, I_GCAL, javaCalendar(r, zone)); r.object(o).icuCalendar = { type: kind }; return o; }
    const o = r.allocate(I_CAL); r.object(o).icuCalendar = { type: kind, zone: nullish(zone) ? callStatic(r, J_TZ, 'getDefault', [], J_TZ) : inner(r, zone) }; return o;
  };
  const calendarState = (r, self) => r.object(self).icuCalendar ?? r.throwJava('Ljava/lang/IllegalStateException;', 'android.icu.util.Calendar used before construction');
  /** The java.util.Calendar a Gregorian android.icu Calendar computes with. */
  const calendarInner = (r, self, what) => r.object(self).inner ?? unsupported(`android.icu.util.Calendar.${what} for the "${calendarState(r, self).type}" calendar (only the Gregorian calendar computes)`);
  for (const [sig, zoneAt, localeAt] of [[[], -1, -1], [[LOCALE], -1, 0], [[ULOCALE], -1, 0], [[I_TZ], 0, -1], [[I_TZ, LOCALE], 0, 1], [[I_TZ, ULOCALE], 0, 1]])
    def(I_CAL, 'getInstance', `(${sig.join('')})${I_CAL}`, (r, _m, args) => { if (localeAt >= 0 && nullish(args[localeAt])) npe(r); return calendarFor(r, localeAt < 0 ? null : args[localeAt], zoneAt < 0 ? null : args[zoneAt]); }, { static: true });
  // new GregorianCalendar(...) is Gregorian whatever the locale's own calendar is; the locale gives the week data only
  for (const [sig, zoneAt] of [[[], -1], [[LOCALE], -1], [[ULOCALE], -1], [[I_TZ], 1], [[I_TZ, LOCALE], 1], [[I_TZ, ULOCALE], 1]])
    def(I_GCAL, '<init>', `(${sig.join('')})V`, (r, _m, args) => { const o = r.object(args[0]); o.inner = javaCalendar(r, zoneAt < 0 ? null : args[zoneAt]); o.icuCalendar = { type: 'gregorian' }; });
  def(I_CAL, 'getType', `()${STRING}`, (r, _m, [self]) => calendarState(r, self).type);
  const sharedField = field => { if (field < 0 || field > 16) unsupported(`android.icu.util.Calendar field ${field} (an ICU-only field)`); };
  for (const [name, params, result, fieldFirst] of [['get', ['I'], 'I', true], ['set', ['I', 'I'], 'V', true], ['set', ['I', 'I', 'I'], 'V'], ['set', ['I', 'I', 'I', 'I', 'I'], 'V'], ['set', ['I', 'I', 'I', 'I', 'I', 'I'], 'V'], ['add', ['I', 'I'], 'V', true], ['roll', ['I', 'Z'], 'V', true],
    ['roll', ['I', 'I'], 'V', true], ['clear', [], 'V'], ['clear', ['I'], 'V', true], ['isSet', ['I'], 'Z', true], ['getTimeInMillis', [], 'J'], ['setTimeInMillis', ['J'], 'V'], ['getTime', [], DATE], ['setTime', [DATE], 'V'], ['getActualMaximum', ['I'], 'I', true], ['getActualMinimum', ['I'], 'I', true],
    ['getMaximum', ['I'], 'I', true], ['getMinimum', ['I'], 'I', true], ['getLeastMaximum', ['I'], 'I', true], ['getGreatestMinimum', ['I'], 'I', true], ['getFirstDayOfWeek', [], 'I'], ['setFirstDayOfWeek', ['I'], 'V'], ['getMinimalDaysInFirstWeek', [], 'I'], ['setMinimalDaysInFirstWeek', ['I'], 'V'],
    ['isLenient', [], 'Z'], ['setLenient', ['Z'], 'V'], ['hashCode', [], 'I']])
    def(I_CAL, name, `(${params.join('')})${result}`, (r, _m, [self, ...args]) => { if (fieldFirst) sharedField(args[0]); return call(r, calendarInner(r, self, name), J_CAL, name, params, result, args); });
  def(I_CAL, 'getTimeZone', `()${I_TZ}`, (r, _m, [self]) => r.object(self).inner ? wrap(r, I_TZ, call(r, r.object(self).inner, J_CAL, 'getTimeZone', [], J_TZ)) : wrap(r, I_TZ, calendarState(r, self).zone));
  def(I_CAL, 'setTimeZone', `(${I_TZ})V`, (r, _m, [self, zone]) => { if (nullish(zone)) npe(r); if (r.object(self).inner) call(r, r.object(self).inner, J_CAL, 'setTimeZone', [J_TZ], 'V', [inner(r, zone)]); else calendarState(r, self).zone = inner(r, zone); });
  const otherCalendar = (r, other) => nullish(other) || !r.isSubtype(r.object(other).type, I_CAL) ? null : calendarInner(r, other, 'compare');
  for (const name of ['before', 'after', 'equals']) def(I_CAL, name, `(${OBJECT})Z`, (r, _m, [self, other]) => { const o = otherCalendar(r, other); return o === null ? 0 : call(r, calendarInner(r, self, name), J_CAL, name, [OBJECT], 'Z', [o]); });
  for (const parameter of [I_CAL, OBJECT]) def(I_CAL, 'compareTo', `(${parameter})I`, (r, _m, [self, other]) => { if (nullish(other)) npe(r); return call(r, calendarInner(r, self, 'compareTo'), J_CAL, 'compareTo', [J_CAL], 'I', [calendarInner(r, other, 'compareTo')]); });
  def(I_CAL, 'clone', `()${OBJECT}`, (r, _m, [self]) => { const o = wrap(r, r.object(self).type, call(r, calendarInner(r, self, 'clone'), OBJECT, 'clone', [], OBJECT)); r.object(o).icuCalendar = { ...calendarState(r, self) }; return o; });
  def(I_CAL, 'toString', `()${STRING}`, (r, _m, [self]) => text(r, call(r, calendarInner(r, self, 'toString'), OBJECT, 'toString', [], STRING)).replace('java.util.GregorianCalendar', 'android.icu.util.GregorianCalendar'));
  for (const [name, params, result] of [['toPattern', [], STRING], ['applyPattern', [STRING], 'V'], ['toLocalizedPattern', [], STRING], ['applyLocalizedPattern', [STRING], 'V']]) forward(I_SDF, J_SDF, name, params, result);
  // ---- DateTimePatternGenerator and DateFormat.HourCycle: the locale's best pattern for a skeleton and its preferred hour cycle, from the platform's CLDR data (src/date-skeleton.js).
  // The generator holds its locale only: adding patterns, the append-item formats and the decimal string are not modelled (those methods stay absent).
  const I_DTPG = 'Landroid/icu/text/DateTimePatternGenerator;', HOUR_CYCLE = 'Landroid/icu/text/DateFormat$HourCycle;', HOUR_CYCLES = ['HOUR_CYCLE_11', 'HOUR_CYCLE_12', 'HOUR_CYCLE_23', 'HOUR_CYCLE_24'];
  type(I_DTPG, OBJECT, ['Ljava/lang/Cloneable;'], { allocatable: true }); type(HOUR_CYCLE, 'Ljava/lang/Enum;');
  for (const name of HOUR_CYCLES) staticField(HOUR_CYCLE, name, HOUR_CYCLE, r => { const ref = r.makeObject(HOUR_CYCLE), o = r.object(ref); o.enumName = name; o.enumOrdinal = HOUR_CYCLES.indexOf(name); return ref; });
  const hourCycle = (r, name) => r.readStatic({ owner: HOUR_CYCLE, name, type: HOUR_CYCLE });
  def(HOUR_CYCLE, 'values', `()[${HOUR_CYCLE}`, r => { const array = r.newArray(`[${HOUR_CYCLE}`, HOUR_CYCLES.length); r.array(array).elements = HOUR_CYCLES.map(name => hourCycle(r, name)); return array; }, { static: true });
  def(HOUR_CYCLE, 'valueOf', `(${STRING})${HOUR_CYCLE}`, (r, _m, [name]) => { if (nullish(name)) npe(r, 'name == null'); const wanted = text(r, name); if (!HOUR_CYCLES.includes(wanted)) r.throwJava('Ljava/lang/IllegalArgumentException;', `No enum constant android.icu.text.DateFormat.HourCycle.${wanted}`); return hourCycle(r, wanted); }, { static: true });
  const generator = (r, locale) => { const o = r.allocate(I_DTPG); r.object(o).patternLocale = text(r, call(r, locale, LOCALE, 'toLanguageTag', [], STRING)); return o; };
  const generatorTag = (r, self) => r.object(self).patternLocale ?? r.throwJava('Ljava/lang/IllegalStateException;', 'DateTimePatternGenerator used before construction');
  def(I_DTPG, 'getInstance', `()${I_DTPG}`, r => generator(r, defaultLocale(r)), { static: true });
  for (const localeType of [LOCALE, ULOCALE]) def(I_DTPG, 'getInstance', `(${localeType})${I_DTPG}`, (r, _m, [locale]) => { if (nullish(locale)) npe(r); return generator(r, localeOf(r, locale)); }, { static: true });
  def(I_DTPG, 'getBestPattern', `(${STRING})${STRING}`, (r, _m, [self, skeleton]) => { if (nullish(skeleton)) npe(r); return bestDateTimePattern(generatorTag(r, self), text(r, skeleton)); });
  def(I_DTPG, 'getBestPattern', `(${STRING}I)${STRING}`, (r, _m, [self, skeleton, options]) => { if (nullish(skeleton)) npe(r); if (options !== 0) unsupported(`DateTimePatternGenerator.getBestPattern with match options ${options}`); return bestDateTimePattern(generatorTag(r, self), text(r, skeleton)); });
  // the hidden getBestPattern(skeleton, options, allowDuplicateFields) android.text.format.DateFormat.getBestDateTimePattern calls
  def(I_DTPG, 'getBestPattern', `(${STRING}IZ)${STRING}`, (r, _m, [self, skeleton, options]) => { if (nullish(skeleton)) npe(r); if (options !== 0) unsupported(`DateTimePatternGenerator.getBestPattern with match options ${options}`); return bestDateTimePattern(generatorTag(r, self), text(r, skeleton)); });
  def(I_DTPG, 'getDefaultHourCycle', `()${HOUR_CYCLE}`, (r, _m, [self]) => hourCycle(r, { h11: 'HOUR_CYCLE_11', h12: 'HOUR_CYCLE_12', h23: 'HOUR_CYCLE_23', h24: 'HOUR_CYCLE_24' }[defaultHourCycle(generatorTag(r, self))]));
  for (const sig of [[], [STRING], [STRING, LOCALE], [STRING, ULOCALE]]) def(I_SDF, '<init>', `(${sig.join('')})V`, (r, _m, [self, pattern, locale]) => {
    const o = r.allocate(J_SDF), params = sig.map(javaDescriptor), values = [pattern, localeOf(r, locale)].slice(0, sig.length);
    r.dispatch({ owner: J_SDF, name: '<init>', parameters: params, result: 'V', signature: `(${params.join('')})V` }, [o, ...values], 'direct'); r.object(self).inner = o;
  });
  for (const owner of [I_DATEF, I_SDF]) { def(owner, 'toString', `()${STRING}`, (r, _m, [self]) => text(r, call(r, inner(r, self), OBJECT, 'toString', [], STRING))); def(owner, 'clone', `()${OBJECT}`, (r, _m, [self]) => wrap(r, I_SDF, call(r, inner(r, self), OBJECT, 'clone', [], OBJECT))); }

  // ---- Collator / RuleBasedCollator (also java.text.Collator) ---------------------------------------------------------------------------------------------------------------------------------------------
  const STRENGTH_SENSITIVITY = { 0: 'base', 1: 'accent', 2: 'variant', 3: 'variant', 15: 'variant' };
  const collatorState = (r, self) => r.object(self).collator ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Collator used before construction');
  const makeCollator = (r, self, locale, javaStyle) => {
    const tag = text(r, callV(r, localeOf(r, locale) ?? defaultLocale(r), LOCALE, 'toLanguageTag', [], STRING)); r.object(self).collator = { tag, strength: 2, decomposition: javaStyle ? 0 : 16, numeric: false, caseLevel: false, caseFirst: 'false', ignorePunctuation: false, javaStyle };
    try { new Intl.Collator(tag); } catch { unsupported(`Collator for locale ${tag}`, 'collator-locale-unsupported'); }
  };
  const compareStrings = (r, self, a, b) => {
    const s = collatorState(r, self); let sensitivity = STRENGTH_SENSITIVITY[s.strength];
    if (s.caseLevel) { if (s.strength === 0) sensitivity = 'case'; else if (s.strength === 1) unsupported('Collator.setCaseLevel(true) with SECONDARY strength', 'collator-unsupported'); }
    const x = text(r, a), y = text(r, b); if (x === null || y === null) npe(r);
    const result = new Intl.Collator(s.tag, { sensitivity, numeric: s.numeric, caseFirst: s.caseFirst, ignorePunctuation: s.ignorePunctuation }).compare(x, y);
    if (result === 0 && s.strength === 15 && x !== y) return x < y ? -1 : 1;   // IDENTICAL: a code-point tie-break
    return Math.sign(result);
  };
  const defineCollator = (owner, javaStyle) => {
    const sig = javaStyle ? [[], [LOCALE]] : [[], [LOCALE], [ULOCALE]];
    for (const params of sig) def(owner, 'getInstance', `(${params.join('')})${owner}`, (r, _m, [locale]) => { const o = r.allocate(owner === I_COLL ? I_RBC : J_RBC); makeCollator(r, o, params.length ? locale : null, javaStyle); return o; }, { static: true });   // Collator.getInstance returns a RuleBasedCollator, in ICU and in java.text
    def(owner, 'compare', `(${STRING}${STRING})I`, (r, _m, [self, a, b]) => compareStrings(r, self, a, b));
    def(owner, 'compare', `(${OBJECT}${OBJECT})I`, (r, _m, [self, a, b]) => compareStrings(r, self, a, b));
    def(owner, 'equals', `(${STRING}${STRING})Z`, (r, _m, [self, a, b]) => compareStrings(r, self, a, b) === 0 ? 1 : 0);
    def(owner, 'setStrength', '(I)V', (r, _m, [self, strength]) => { const s = collatorState(r, self), value = javaStyle ? [0, 1, 2, 15][strength] : strength; if (value === undefined || STRENGTH_SENSITIVITY[value] === undefined) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Incorrect comparison level.'); s.strength = value; });
    def(owner, 'getStrength', '()I', (r, _m, [self]) => { const s = collatorState(r, self).strength; return javaStyle ? { 0: 0, 1: 1, 2: 2, 15: 3 }[s] ?? 2 : s; });
    def(owner, 'setDecomposition', '(I)V', (r, _m, [self, mode]) => { collatorState(r, self).decomposition = mode; });   // Intl.Collator always normalises canonically: NO_DECOMPOSITION and CANONICAL give the same ordering for NFC text
    def(owner, 'getDecomposition', '()I', (r, _m, [self]) => collatorState(r, self).decomposition);
    for (const [name, value] of javaStyle ? [['PRIMARY', 0], ['SECONDARY', 1], ['TERTIARY', 2], ['IDENTICAL', 3], ['NO_DECOMPOSITION', 0], ['CANONICAL_DECOMPOSITION', 1], ['FULL_DECOMPOSITION', 2]] : [['PRIMARY', 0], ['SECONDARY', 1], ['TERTIARY', 2], ['QUATERNARY', 3], ['IDENTICAL', 15], ['NO_DECOMPOSITION', 16], ['CANONICAL_DECOMPOSITION', 17]]) staticField(owner, name, 'I', () => value);
    def(owner, 'getRules', `()${STRING}`, () => unsupported('Collator.getRules (the tailoring rules of the locale)', 'collator-unsupported'));
    def(owner, 'getCollationKey', `(${STRING})Ljava/text/CollationKey;`, () => unsupported('Collator.getCollationKey (sort keys)', 'collator-unsupported'));
  };
  defineCollator(I_COLL, false); defineCollator(J_COLL, true);
  type(J_COLL, OBJECT, ['Ljava/util/Comparator;', 'Ljava/lang/Cloneable;'], { allocatable: true });
  // java.text.RuleBasedCollator: the class of every collator java.text.Collator.getInstance makes (libcore wraps ICU's RuleBasedCollator); everything it answers is Collator's above.
  const J_RBC = 'Ljava/text/RuleBasedCollator;'; type(J_RBC, J_COLL, [], { allocatable: true });
  def(J_RBC, '<init>', `(${STRING})V`, () => unsupported('RuleBasedCollator(String rules): custom collation rules', 'collator-unsupported'));
  def(I_RBC, '<init>', `(${STRING})V`, () => unsupported('RuleBasedCollator(String rules): custom collation rules', 'collator-unsupported'));
  def(I_RBC, 'setNumericCollation', '(Z)V', (r, _m, [self, on]) => { collatorState(r, self).numeric = !!on; }); def(I_RBC, 'getNumericCollation', '()Z', (r, _m, [self]) => collatorState(r, self).numeric ? 1 : 0);
  def(I_RBC, 'setCaseLevel', '(Z)V', (r, _m, [self, on]) => { collatorState(r, self).caseLevel = !!on; }); def(I_RBC, 'isCaseLevel', '()Z', (r, _m, [self]) => collatorState(r, self).caseLevel ? 1 : 0);
  def(I_RBC, 'setAlternateHandlingShifted', '(Z)V', (r, _m, [self, on]) => { collatorState(r, self).ignorePunctuation = !!on; }); def(I_RBC, 'isAlternateHandlingShifted', '()Z', (r, _m, [self]) => collatorState(r, self).ignorePunctuation ? 1 : 0);
  def(I_RBC, 'setUpperCaseFirst', '(Z)V', (r, _m, [self, on]) => { collatorState(r, self).caseFirst = on ? 'upper' : 'false'; }); def(I_RBC, 'setLowerCaseFirst', '(Z)V', (r, _m, [self, on]) => { collatorState(r, self).caseFirst = on ? 'lower' : 'false'; });
  def(I_RBC, 'setCaseFirstDefault', '()V', (r, _m, [self]) => { collatorState(r, self).caseFirst = 'false'; });
  def(I_RBC, 'isUpperCaseFirst', '()Z', (r, _m, [self]) => collatorState(r, self).caseFirst === 'upper' ? 1 : 0); def(I_RBC, 'isLowerCaseFirst', '()Z', (r, _m, [self]) => collatorState(r, self).caseFirst === 'lower' ? 1 : 0);
  def(I_RBC, 'getInstance', `(${LOCALE})${I_RBC}`, (r, _m, [locale]) => { const o = r.allocate(I_RBC); makeCollator(r, o, locale, false); return o; }, { static: true });
  def(I_RBC, 'getInstance', `(${ULOCALE})${I_RBC}`, (r, _m, [locale]) => { const o = r.allocate(I_RBC); makeCollator(r, o, locale, false); return o; }, { static: true });
  def(I_RBC, 'getInstance', `()${I_RBC}`, r => { const o = r.allocate(I_RBC); makeCollator(r, o, null, false); return o; }, { static: true });

  // ---- CaseMap / Edits (android.text.TextUtils.toUpperCase, which AllCapsTransformationMethod calls) ---------------------------------------------------------------------------------
  // CaseMap.toUpper().apply(locale, source, destination, edits): full Unicode upper-casing of the engine (String.prototype.toLocaleUpperCase, the ICU tables of the browser) with the VM's
  // Locale; the Edits record which source ranges changed and what replaced them, one entry per code point, so a caller can map source indices to the destination (span copying).
  // A mapping that depends on the neighbours (the per-code-point results do not concatenate to the whole-string result) is recorded as one replacement of the whole text.
  const CASEMAP = 'Landroid/icu/text/CaseMap;', UPPER = 'Landroid/icu/text/CaseMap$Upper;', EDITS = 'Landroid/icu/text/Edits;', EDITS_IT = 'Landroid/icu/text/Edits$Iterator;', CHARS = 'Ljava/lang/CharSequence;', APPENDABLE = 'Ljava/lang/Appendable;';
  type(CASEMAP, OBJECT, []); type(UPPER, CASEMAP, [], { allocatable: true }); type(EDITS, OBJECT, [], { allocatable: true }); type(EDITS_IT, OBJECT, [], { allocatable: true });
  const charsOf = (r, v) => typeof v === 'string' ? v : r.typeOf(v) === STRING ? r.stringCharacters(v) : text(r, call(r, v, r.typeOf(v), 'toString', [], STRING));
  const caseLocale = (r, locale) => { const language = nullish(locale) ? '' : text(r, call(r, localeOf(r, locale), LOCALE, 'getLanguage', [], STRING)) ?? ''; return ['tr', 'az', 'lt', 'el'].includes(language) ? language : 'und'; };
  def(CASEMAP, 'toUpper', `()${UPPER}`, r => r.allocate(UPPER), { static: true });
  def(EDITS, '<init>', '()V', (r, _m, [self]) => { r.object(self).edits = []; });
  def(EDITS, 'reset', '()V', (r, _m, [self]) => { r.object(self).edits = []; });
  def(EDITS, 'hasChanges', '()Z', (r, _m, [self]) => (r.object(self).edits ?? []).some(edit => edit.changed) ? 1 : 0);
  def(EDITS, 'numberOfChanges', '()I', (r, _m, [self]) => (r.object(self).edits ?? []).filter(edit => edit.changed).length);
  def(EDITS, 'lengthDelta', '()I', (r, _m, [self]) => (r.object(self).edits ?? []).reduce((sum, edit) => sum + edit.newLength - edit.oldLength, 0));
  def(UPPER, 'apply', `(${LOCALE}${CHARS}${APPENDABLE}${EDITS})${APPENDABLE}`, (r, _m, [_self, locale, source, destination, edits]) => {
    if (nullish(source) || nullish(destination)) npe(r);
    const value = charsOf(r, source), tag = caseLocale(r, locale), whole = value.toLocaleUpperCase(tag), list = [];
    let joined = '';
    for (const point of value) { const mapped = point.toLocaleUpperCase(tag); joined += mapped; const last = list[list.length - 1], changed = mapped !== point;
      if (last && !changed && !last.changed) last.oldLength = last.newLength = last.oldLength + point.length; else list.push({ changed, oldLength: point.length, newLength: mapped.length }); }
    if (joined !== whole) { list.length = 0; list.push({ changed: true, oldLength: value.length, newLength: whole.length }); }
    if (!nullish(edits)) r.object(edits).edits = list;
    call(r, destination, r.typeOf(destination), 'append', [CHARS], r.isSubtype(r.typeOf(destination), 'Ljava/lang/StringBuilder;') ? 'Ljava/lang/StringBuilder;' : r.isSubtype(r.typeOf(destination), 'Landroid/text/SpannableStringBuilder;') ? 'Landroid/text/SpannableStringBuilder;' : APPENDABLE, [whole]);
    return destination;
  });
  // Edits.Iterator (fine iterator): positioned on one edit; findSourceIndex moves to the edit that contains the source index.
  for (const name of ['getFineIterator', 'getFineChangesIterator', 'getCoarseIterator', 'getCoarseChangesIterator']) def(EDITS, name, `()${EDITS_IT}`, (r, _m, [self]) => {
    if (name !== 'getFineIterator') unsupported(`android.icu.text.Edits.${name}`);
    const o = r.allocate(EDITS_IT); Object.assign(r.object(o), { edits: r.object(self).edits ?? [], index: -1, source: 0, destination: 0 }); return o;
  });
  const current = (r, self) => { const it = r.object(self); return it.index >= 0 && it.index < it.edits.length ? it.edits[it.index] : null; };
  const advance = it => { if (it.index >= 0 && it.index < it.edits.length) { it.source += it.edits[it.index].oldLength; it.destination += it.edits[it.index].newLength; } if (it.index < it.edits.length) it.index++; return it.index < it.edits.length; };
  def(EDITS_IT, 'next', '()Z', (r, _m, [self]) => advance(r.object(self)) ? 1 : 0);
  def(EDITS_IT, 'findSourceIndex', '(I)Z', (r, _m, [self, index]) => {
    const it = r.object(self); if (index < 0) return 0;
    if (it.index < 0 || it.index >= it.edits.length || index < it.source) { it.index = -1; it.source = 0; it.destination = 0; if (!advance(it)) return 0; }
    while (index >= it.source + it.edits[it.index].oldLength) if (!advance(it)) return 0;
    return 1;
  });
  def(EDITS_IT, 'hasChange', '()Z', (r, _m, [self]) => current(r, self)?.changed ? 1 : 0);
  def(EDITS_IT, 'oldLength', '()I', (r, _m, [self]) => current(r, self)?.oldLength ?? 0);
  def(EDITS_IT, 'newLength', '()I', (r, _m, [self]) => current(r, self)?.newLength ?? 0);
  def(EDITS_IT, 'sourceIndex', '()I', (r, _m, [self]) => r.object(self).source);
  def(EDITS_IT, 'destinationIndex', '()I', (r, _m, [self]) => r.object(self).destination);
  def(EDITS_IT, 'replacementIndex', '()I', (r, _m, [self]) => r.object(self).destination);
  return registry;
}
