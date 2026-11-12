import { createHostRegistry } from './host-contract.js?v=a94e2efcced9';
import { APKError } from './apk-error.js?v=a94e2efcced9';

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
  def(I_DATEF, 'getPatternInstance', `(Landroid/icu/text/DateFormat$HourCycle;${STRING}${LOCALE})${I_DATEF}`, () => unsupported('DateFormat.getPatternInstance(hourCycle, ...)'), { static: true });
  for (const [name, params, result] of [['format', [DATE], STRING], ['format', [OBJECT], STRING], ['format', [DATE, SB, FP], SB], ['parse', [STRING], DATE], ['parse', [STRING, PP], DATE], ['parseObject', [STRING], OBJECT], ['setTimeZone', [I_TZ], 'V'], ['getTimeZone', [], I_TZ], ['setLenient', ['Z'], 'V'], ['isLenient', [], 'Z']]) { try { forward(I_DATEF, J_DATEF, name, params, result); } catch { /* unsupported at call */ } }
  def(I_DATEF, 'getCalendar', '()Landroid/icu/util/Calendar;', () => unsupported('DateFormat.getCalendar (android.icu.util.Calendar)')); def(I_DATEF, 'setCalendar', '(Landroid/icu/util/Calendar;)V', () => unsupported('DateFormat.setCalendar (android.icu.util.Calendar)'));
  for (const [name, params, result] of [['toPattern', [], STRING], ['applyPattern', [STRING], 'V']]) forward(I_SDF, J_SDF, name, params, result);
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
    for (const params of sig) def(owner, 'getInstance', `(${params.join('')})${owner}`, (r, _m, [locale]) => { const o = r.allocate(owner === I_COLL ? I_RBC : owner); makeCollator(r, o, params.length ? locale : null, javaStyle); return o; }, { static: true });   // ICU's Collator.getInstance returns a RuleBasedCollator
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
