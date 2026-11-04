import { createHostRegistry } from './host-contract.js?v=dab932c11eb4';
import { ISO_COUNTRIES, ISO_LANGUAGES } from './iso-codes-data.js?v=dab932c11eb4';

// java.util.Locale beyond the first host pass (libcore Locale.java, android-13.0.0_r1): the ISO code tables, 3-letter codes, extensions (BCP 47 -u- / -x- and any singleton),
// stripExtensions, setDefault, and Locale.Builder with IllformedLocaleException; plus Calendar week dates and Calendar.Builder. Locale objects are the platform's (one per canonical language tag, platform.locale).
const LOCALE = 'Ljava/util/Locale;', BUILDER = 'Ljava/util/Locale$Builder;', ILLFORMED = 'Ljava/util/IllformedLocaleException;', CATEGORY = 'Ljava/util/Locale$Category;', STRING = 'Ljava/lang/String;', SET = 'Ljava/util/Set;';
const LANGUAGE = /^[a-zA-Z]{2,8}$/, SCRIPT = /^[a-zA-Z]{4}$/, REGION = /^(?:[a-zA-Z]{2}|\d{3})$/, VARIANT = /^(?:[a-zA-Z0-9]{5,8}|\d[a-zA-Z0-9]{3})$/, KEY = /^[a-zA-Z0-9]{2}$/, TYPE = /^[a-zA-Z0-9]{3,8}$/, ATTRIBUTE = /^[a-zA-Z0-9]{3,8}$/;

export function createLocaleExtrasHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const nullish = value => value === null || value === undefined || value === 0;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = [], mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, mode === 'static' ? values : [receiver, ...values], mode);
  const create = (r, owner) => { const ref = r.allocate(owner); call(r, ref, owner, '<init>', [], 'V', [], 'direct'); return ref; };
  const tagOf = (r, locale) => r.object(locale).localeData?.tag ?? 'und';
  const stringSet = (r, values) => { const set = create(r, 'Ljava/util/LinkedHashSet;'); for (const value of values) call(r, set, SET, 'add', ['Ljava/lang/Object;'], 'Z', [value]); return call(r, null, 'Ljava/util/Collections;', 'unmodifiableSet', [SET], SET, [set], 'static'); };

  // ---- extensions of a language tag: [{ key: 'u', subtags: ['nu', 'latn'] }, { key: 'x', ... }]
  const parseExtensions = tag => {
    const parts = tag.split('-'), found = []; let current = null;
    for (const part of parts) {
      if (part.length === 1) { current = { key: part.toLowerCase(), subtags: [] }; found.push(current); if (current.key === 'x') { found[found.length - 1].subtags = parts.slice(parts.indexOf(part) + 1); break; } }
      else if (current) current.subtags.push(part);
    }
    return found;
  };
  const withoutExtensions = tag => { const parts = tag.split('-'), at = parts.findIndex(part => part.length === 1); return (at < 0 ? parts : parts.slice(0, at)).join('-'); };
  const validKey = (r, key) => { if (!/^[a-zA-Z0-9]$/.test(String.fromCharCode(key))) r.throwJava('Ljava/lang/IllegalArgumentException;', `Ill-formed extension key: ${String.fromCharCode(key)}`); };
  const unicode = tag => parseExtensions(tag).find(extension => extension.key === 'u') ?? null;
  const keywords = extension => {   // attributes (3-8 alnum before the first key) and key -> type
    const attributes = [], map = new Map(); let key = null;
    for (const subtag of extension?.subtags ?? []) {
      if (KEY.test(subtag) && !/^\d/.test(subtag) || (KEY.test(subtag) && key === null && attributes.length >= 0 && subtag.length === 2)) { key = subtag.toLowerCase(); if (!map.has(key)) map.set(key, []); }
      else if (key === null) attributes.push(subtag.toLowerCase()); else map.get(key).push(subtag.toLowerCase());
    }
    return { attributes, map };
  };

  def(LOCALE, 'getExtension', '(C)Ljava/lang/String;', (r, _m, [self, key]) => {
    validKey(r, key); const found = parseExtensions(tagOf(r, self)).find(extension => extension.key === String.fromCharCode(key).toLowerCase());
    return found && found.subtags.length ? found.subtags.join('-') : null;
  });
  def(LOCALE, 'getExtensionKeys', `()${SET}`, (r, _m, [self]) => {
    const set = create(r, 'Ljava/util/TreeSet;');
    for (const extension of parseExtensions(tagOf(r, self))) call(r, set, SET, 'add', ['Ljava/lang/Object;'], 'Z', [call(r, null, 'Ljava/lang/Character;', 'valueOf', ['C'], 'Ljava/lang/Character;', [extension.key.charCodeAt(0)], 'static')]);
    return call(r, null, 'Ljava/util/Collections;', 'unmodifiableSet', [SET], SET, [set], 'static');
  });
  def(LOCALE, 'getUnicodeLocaleKeys', `()${SET}`, (r, _m, [self]) => stringSet(r, [...keywords(unicode(tagOf(r, self))).map.keys()].sort()));
  def(LOCALE, 'getUnicodeLocaleAttributes', `()${SET}`, (r, _m, [self]) => stringSet(r, keywords(unicode(tagOf(r, self))).attributes));
  def(LOCALE, 'getUnicodeLocaleType', `(${STRING})${STRING}`, (r, _m, [self, key]) => {
    if (nullish(key)) r.throwJava('Ljava/lang/NullPointerException;', null);
    const name = r.stringCharacters(key); if (!KEY.test(name)) r.throwJava('Ljava/lang/IllegalArgumentException;', `Ill-formed Unicode locale key: ${name}`);
    const type = keywords(unicode(tagOf(r, self))).map.get(name.toLowerCase()); return type ? type.join('-') : null;
  });
  def(LOCALE, 'stripExtensions', `()${LOCALE}`, (r, _m, [self]) => { const tag = tagOf(r, self); return parseExtensions(tag).length ? platform.locale(r, withoutExtensions(tag)) : self; });

  // ---- ISO tables
  const stringArray = (r, values) => { const array = r.newArray(`[${STRING}`, values.length); r.array(array).elements = values; return array; };
  def(LOCALE, 'getISOCountries', `()[${STRING}`, r => stringArray(r, Object.keys(ISO_COUNTRIES)), { static: true });
  def(LOCALE, 'getISOLanguages', `()[${STRING}`, r => stringArray(r, Object.keys(ISO_LANGUAGES)), { static: true });
  const missing = (r, what, value) => r.throwJava('Ljava/util/MissingResourceException;', `Couldn't find 3-letter ${what} code for ${value}`);
  def(LOCALE, 'getISO3Country', `()${STRING}`, (r, _m, [self]) => { const country = r.object(self).localeData?.country ?? ''; if (country === '') return ''; const three = ISO_COUNTRIES[country.toUpperCase()]; if (!three) missing(r, 'country', country); return three; });
  def(LOCALE, 'getISO3Language', `()${STRING}`, (r, _m, [self]) => { const language = r.object(self).localeData?.language ?? ''; if (language === '') return ''; const three = ISO_LANGUAGES[language.toLowerCase()]; if (three === undefined || three === '') { if (language.length === 3) return language; missing(r, 'language', language); } return three; });

  // ---- default locale
  type(CATEGORY, 'Ljava/lang/Enum;');
  def(LOCALE, 'setDefault', `(${LOCALE})V`, (r, _m, [locale]) => { if (nullish(locale)) r.throwJava('Ljava/lang/NullPointerException;', 'Can\'t set default locale to NULL'); platform.defaultLocaleOverride = { tag: tagOf(r, locale), device: platform.device.locale }; }, { static: true });
  def(LOCALE, 'setDefault', `(${CATEGORY}${LOCALE})V`, (r, _m, [category, locale]) => {
    if (nullish(category)) r.throwJava('Ljava/lang/NullPointerException;', 'Category cannot be NULL'); if (nullish(locale)) r.throwJava('Ljava/lang/NullPointerException;', 'Can\'t set default locale to NULL');
    platform.defaultLocaleOverride = { tag: tagOf(r, locale), device: platform.device.locale };   // the VM has one default per process: both categories follow it
  }, { static: true });

  // ---- Locale.Builder
  type(BUILDER, 'Ljava/lang/Object;', [], { allocatable: true }); type(ILLFORMED, 'Ljava/lang/RuntimeException;', [], { allocatable: true });
  def(ILLFORMED, '<init>', '()V', (r, _m, [self]) => { r.object(self).errorIndex = -1; });
  def(ILLFORMED, '<init>', `(${STRING})V`, (r, _m, [self, message]) => { r.object(self).message = message; r.object(self).errorIndex = -1; });
  def(ILLFORMED, '<init>', `(${STRING}I)V`, (r, _m, [self, message, index]) => { r.object(self).message = (message === null ? 'null' : r.stringCharacters(message)) + (index < 0 ? '' : ` [at index ${index}]`); r.object(self).errorIndex = index; });
  def(ILLFORMED, 'getErrorIndex', '()I', (r, _m, [self]) => r.object(self).errorIndex);
  const state = (r, self) => (r.object(self).builder ??= { language: '', script: '', region: '', variant: '', extensions: new Map(), keywords: new Map(), attributes: new Set() });
  const illformed = (r, message, index) => { const e = r.allocate(ILLFORMED); call(r, e, ILLFORMED, '<init>', [STRING, 'I'], 'V', [message, index], 'direct'); r.throwJavaReference(e, message); };
  const text = (r, value) => (nullish(value) ? '' : r.stringCharacters(value));
  def(BUILDER, '<init>', '()V', (r, _m, [self]) => { state(r, self); });
  def(BUILDER, 'setLanguage', `(${STRING})${BUILDER}`, (r, _m, [self, language]) => { const v = text(r, language); if (v !== '' && !LANGUAGE.test(v)) illformed(r, `Ill-formed language: ${v}`, 0); state(r, self).language = v.toLowerCase(); return self; });
  def(BUILDER, 'setScript', `(${STRING})${BUILDER}`, (r, _m, [self, script]) => { const v = text(r, script); if (v !== '' && !SCRIPT.test(v)) illformed(r, `Ill-formed script: ${v}`, 0); state(r, self).script = v === '' ? '' : v[0].toUpperCase() + v.slice(1).toLowerCase(); return self; });
  def(BUILDER, 'setRegion', `(${STRING})${BUILDER}`, (r, _m, [self, region]) => { const v = text(r, region); if (v !== '' && !REGION.test(v)) illformed(r, `Ill-formed region: ${v}`, 0); state(r, self).region = v.toUpperCase(); return self; });
  def(BUILDER, 'setVariant', `(${STRING})${BUILDER}`, (r, _m, [self, variant]) => {
    const v = text(r, variant).replaceAll('_', '-'); const bad = v === '' ? -1 : v.split('-').findIndex(part => !VARIANT.test(part));
    if (bad >= 0) illformed(r, `Ill-formed variant: ${v}`, v.split('-').slice(0, bad).join('-').length + (bad ? 1 : 0)); state(r, self).variant = v; return self;
  });
  def(BUILDER, 'setLanguageTag', `(${STRING})${BUILDER}`, (r, _m, [self, tag]) => {
    const b = state(r, self); if (nullish(tag)) { Object.assign(b, { language: '', script: '', region: '', variant: '' }); b.extensions.clear(); b.keywords.clear(); b.attributes.clear(); return self; }
    const value = r.stringCharacters(tag); let info; try { info = new Intl.Locale(value); } catch { illformed(r, `Ill-formed language tag: ${value}`, 0); }
    Object.assign(b, { language: info.language === 'und' ? '' : info.language, script: info.script ?? '', region: info.region ?? '', variant: (info.variants ?? []).join('-') });
    b.extensions.clear(); b.keywords.clear(); b.attributes.clear();
    for (const extension of parseExtensions(info.toString())) { if (extension.key === 'u') { const k = keywords(extension); k.attributes.forEach(a => b.attributes.add(a)); for (const [key, parts] of k.map) b.keywords.set(key, parts.join('-')); } else b.extensions.set(extension.key, extension.subtags.join('-')); }
    return self;
  });
  def(BUILDER, 'setLocale', `(${LOCALE})${BUILDER}`, (r, _m, [self, locale]) => {
    const b = state(r, self), data = nullish(locale) ? null : r.object(locale).localeData;
    if (!data) { Object.assign(b, { language: '', script: '', region: '', variant: '' }); b.extensions.clear(); b.keywords.clear(); b.attributes.clear(); return self; }
    return call(r, self, BUILDER, 'setLanguageTag', [STRING], BUILDER, [data.tag]);
  });
  def(BUILDER, 'setUnicodeLocaleKeyword', `(${STRING}${STRING})${BUILDER}`, (r, _m, [self, key, value]) => {
    if (nullish(key)) r.throwJava('Ljava/lang/NullPointerException;', null); const k = r.stringCharacters(key); if (!KEY.test(k)) illformed(r, `Ill-formed Unicode locale keyword key: ${k}`, 0);
    if (nullish(value)) state(r, self).keywords.delete(k.toLowerCase()); else { const v = r.stringCharacters(value).replaceAll('_', '-'); if (v.split('-').some(part => !TYPE.test(part))) illformed(r, `Ill-formed Unicode locale keyword type: ${v}`, 0); state(r, self).keywords.set(k.toLowerCase(), v.toLowerCase()); }
    return self;
  });
  def(BUILDER, 'addUnicodeLocaleAttribute', `(${STRING})${BUILDER}`, (r, _m, [self, attribute]) => { if (nullish(attribute)) r.throwJava('Ljava/lang/NullPointerException;', null); const a = r.stringCharacters(attribute); if (!ATTRIBUTE.test(a)) illformed(r, `Ill-formed Unicode locale attribute: ${a}`, 0); state(r, self).attributes.add(a.toLowerCase()); return self; });
  def(BUILDER, 'removeUnicodeLocaleAttribute', `(${STRING})${BUILDER}`, (r, _m, [self, attribute]) => { if (nullish(attribute)) r.throwJava('Ljava/lang/NullPointerException;', null); state(r, self).attributes.delete(r.stringCharacters(attribute).toLowerCase()); return self; });
  def(BUILDER, 'setExtension', `(C${STRING})${BUILDER}`, (r, _m, [self, key, value]) => {
    const k = String.fromCharCode(key).toLowerCase(); if (!/^[a-wyz0-9]$|^x$/.test(k)) illformed(r, `Ill-formed extension key: ${k}`, 0);
    if (k === 'u') { const b = state(r, self); b.keywords.clear(); b.attributes.clear(); if (!nullish(value)) { const parsed = keywords({ subtags: r.stringCharacters(value).split(/[-_]/) }); parsed.attributes.forEach(a => b.attributes.add(a)); for (const [name, parts] of parsed.map) b.keywords.set(name, parts.join('-')); } return self; }
    if (nullish(value) || r.stringCharacters(value) === '') state(r, self).extensions.delete(k); else state(r, self).extensions.set(k, r.stringCharacters(value).replaceAll('_', '-').toLowerCase());
    return self;
  });
  def(BUILDER, 'clearExtensions', `()${BUILDER}`, (r, _m, [self]) => { const b = state(r, self); b.extensions.clear(); b.keywords.clear(); b.attributes.clear(); return self; });
  def(BUILDER, 'clear', `()${BUILDER}`, (r, _m, [self]) => { r.object(self).builder = null; state(r, self); return self; });
  def(BUILDER, 'build', `()${LOCALE}`, (r, _m, [self]) => {
    const b = state(r, self), parts = [b.language || 'und', b.script, b.region, ...(b.variant ? b.variant.split('-') : [])].filter(Boolean);
    const u = [...[...b.attributes].sort(), ...[...b.keywords].sort(([a], [c]) => (a < c ? -1 : 1)).flatMap(([k, v]) => [k, v])];
    const tail = [...[...b.extensions].filter(([k]) => k !== 'x').sort(([a], [c]) => (a < c ? -1 : 1)), ...(u.length ? [['u', u.join('-')]] : [])].sort(([a], [c]) => (a < c ? -1 : 1)).flatMap(([k, v]) => [k, v]);
    if (b.extensions.has('x')) tail.push('x', b.extensions.get('x'));
    return platform.locale(r, [...parts, ...tail].join('-'));
  });

  // ---- Calendar week dates and Calendar.Builder (Calendar.java android-13.0.0_r1). Week-date arithmetic is the Gregorian one (week 1 is the first week with at least
  // getMinimalDaysInFirstWeek() days in the year, weeks start on getFirstDayOfWeek()); dates before the Julian cutover are treated as proleptic Gregorian.
  const CALENDAR = 'Ljava/util/Calendar;', CAL_BUILDER = 'Ljava/util/Calendar$Builder;', TZ = 'Ljava/util/TimeZone;', DATE = 'Ljava/util/Date;', SET_I = 'Ljava/util/Set;';
  type(CAL_BUILDER, 'Ljava/lang/Object;', [], { allocatable: true });
  const FIELD_COUNT = 17, WEEK_YEAR = 17, YEAR = 1, MONTH = 2, WEEK_OF_YEAR = 3, DAY_OF_MONTH = 5, DAY_OF_WEEK = 7;
  const fromDayNumber = days => { const d = new Date(days * 86400000); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; };
  const utcDayNumber = (year, month, day) => { const d = new Date(0); d.setUTCFullYear(year, month, day); d.setUTCHours(0, 0, 0, 0); return Math.floor(d.getTime() / 86400000); };
  const week1Start = (year, first, minimal) => {
    const jan1 = utcDayNumber(year, 0, 1), dow1 = new Date(jan1 * 86400000).getUTCDay() + 1, lead = (dow1 - first + 7) % 7;
    return jan1 - lead + (7 - lead < minimal ? 7 : 0);
  };
  const calField = (r, cal, field) => call(r, cal, CALENDAR, 'get', ['I'], 'I', [field]);
  const weekRules = (r, cal) => [call(r, cal, CALENDAR, 'getFirstDayOfWeek', [], 'I'), call(r, cal, CALENDAR, 'getMinimalDaysInFirstWeek', [], 'I')];
  const applyWeekDate = (r, cal, weekYear, weekOfYear, dayOfWeek) => {
    const [first, minimal] = weekRules(r, cal);
    const target = week1Start(weekYear, first, minimal) + (weekOfYear - 1) * 7 + ((dayOfWeek - first + 7) % 7);
    const [y, m, d] = fromDayNumber(target);
    call(r, cal, CALENDAR, 'set', ['I', 'I', 'I'], 'V', [y, m, d]);
  };
  def(CALENDAR, 'isWeekDateSupported', '()Z', () => 1);
  def(CALENDAR, 'setWeekDate', '(III)V', (r, _m, [self, weekYear, weekOfYear, dayOfWeek]) => applyWeekDate(r, self, weekYear, weekOfYear, dayOfWeek));
  def(CALENDAR, 'getWeekYear', '()I', (r, _m, [self]) => {
    const year = calField(r, self, YEAR), week = calField(r, self, WEEK_OF_YEAR), month = calField(r, self, MONTH);
    return month === 0 && week >= 52 ? year - 1 : month === 11 && week === 1 ? year + 1 : year;
  });
  def(CALENDAR, 'getWeeksInWeekYear', '()I', (r, _m, [self]) => {
    const weekYear = call(r, self, CALENDAR, 'getWeekYear', [], 'I'), [first, minimal] = weekRules(r, self);
    return (week1Start(weekYear + 1, first, minimal) - week1Start(weekYear, first, minimal)) / 7;
  });
  def(CALENDAR, 'getAvailableCalendarTypes', `()${SET_I}`, r => {
    const set = r.allocate('Ljava/util/HashSet;'); r.dispatch({ owner: 'Ljava/util/HashSet;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [set], 'direct');
    call(r, set, SET_I, 'add', ['Ljava/lang/Object;'], 'Z', ['gregory']);
    return r.dispatch({ owner: 'Ljava/util/Collections;', name: 'unmodifiableSet', parameters: [SET_I], result: SET_I, signature: `(${SET_I})${SET_I}` }, [set], 'static');
  }, { static: true });

  const builder = (r, self) => (r.object(self).calendarBuilder ??= { instant: null, set: false, stamps: new Map(), nextStamp: 1, type: null, zone: null, lenient: true, locale: null, week: null });
  const ise = (r, message) => r.throwJava('Ljava/lang/IllegalStateException;', message), iae = (r, message) => r.throwJava('Ljava/lang/IllegalArgumentException;', message);
  const stamp = (b, field, value) => { b.stamps.delete(field); b.stamps.set(field, value); };   // the latest set of a field wins; fields apply in the order they were last set
  const callWide = (r, receiver, owner, name, parameters, result, values) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, values, { receiver }), 'virtual');
  def(CAL_BUILDER, '<init>', '()V', (r, _m, [self]) => { builder(r, self); });
  def(CAL_BUILDER, 'setInstant', `(J)${CAL_BUILDER}`, (r, _m, [self, instant]) => { const b = builder(r, self); if (b.set) ise(r, null); b.instant = instant; return self; });
  def(CAL_BUILDER, 'setInstant', `(${DATE})${CAL_BUILDER}`, (r, _m, [self, date]) => { if (nullish(date)) r.throwJava('Ljava/lang/NullPointerException;', null); return callWide(r, self, CAL_BUILDER, 'setInstant', ['J'], CAL_BUILDER, [call(r, date, DATE, 'getTime', [], 'J')]); });
  const setField = (r, b, field, value) => { if (field < 0 || field >= FIELD_COUNT) iae(r, 'field is invalid'); if (b.instant !== null) ise(r, 'instant has been set'); b.set = true; stamp(b, field, value); };
  def(CAL_BUILDER, 'set', `(II)${CAL_BUILDER}`, (r, _m, [self, field, value]) => { setField(r, builder(r, self), field, value); return self; });
  def(CAL_BUILDER, 'setFields', `([I)${CAL_BUILDER}`, (r, _m, [self, pairs]) => {
    const values = r.array(pairs).elements, b = builder(r, self); if (values.length % 2 !== 0) iae(r, null); if (b.instant !== null) ise(r, 'instant has been set');
    for (let i = 0; i < values.length; i += 2) setField(r, b, values[i], values[i + 1]);
    return self;
  });
  def(CAL_BUILDER, 'setDate', `(III)${CAL_BUILDER}`, (r, _m, [self, y, m, d]) => { const b = builder(r, self); if (b.instant !== null) ise(r, 'instant has been set'); setField(r, b, YEAR, y); setField(r, b, MONTH, m); setField(r, b, DAY_OF_MONTH, d); return self; });
  const timeOfDay = (r, self, h, mi, s, ms) => { const b = builder(r, self); if (b.instant !== null) ise(r, 'instant has been set'); for (const [f, v] of [[11, h], [12, mi], [13, s], [14, ms]]) setField(r, b, f, v); return self; };
  def(CAL_BUILDER, 'setTimeOfDay', `(III)${CAL_BUILDER}`, (r, _m, [self, h, mi, s]) => timeOfDay(r, self, h, mi, s, 0));
  def(CAL_BUILDER, 'setTimeOfDay', `(IIII)${CAL_BUILDER}`, (r, _m, [self, h, mi, s, ms]) => timeOfDay(r, self, h, mi, s, ms));
  def(CAL_BUILDER, 'setWeekDate', `(III)${CAL_BUILDER}`, (r, _m, [self, weekYear, weekOfYear, dayOfWeek]) => { const b = builder(r, self); b.set = true; stamp(b, WEEK_YEAR, weekYear); stamp(b, WEEK_OF_YEAR, weekOfYear); stamp(b, DAY_OF_WEEK, dayOfWeek); return self; });
  def(CAL_BUILDER, 'setTimeZone', `(${TZ})${CAL_BUILDER}`, (r, _m, [self, zone]) => { if (nullish(zone)) r.throwJava('Ljava/lang/NullPointerException;', null); builder(r, self).zone = zone; return self; });
  def(CAL_BUILDER, 'setLenient', `(Z)${CAL_BUILDER}`, (r, _m, [self, lenient]) => { builder(r, self).lenient = !!lenient; return self; });
  def(CAL_BUILDER, 'setLocale', `(${LOCALE})${CAL_BUILDER}`, (r, _m, [self, locale]) => { if (nullish(locale)) r.throwJava('Ljava/lang/NullPointerException;', null); builder(r, self).locale = locale; return self; });
  def(CAL_BUILDER, 'setCalendarType', `(${STRING})${CAL_BUILDER}`, (r, _m, [self, type]) => {
    if (nullish(type)) r.throwJava('Ljava/lang/NullPointerException;', null);
    let name = r.stringCharacters(type); if (name === 'gregorian') name = 'gregory';
    if (name !== 'gregory' && name !== 'iso8601') iae(r, `unknown calendar type: ${name}`);
    const b = builder(r, self); if (b.type === null) b.type = name; else if (b.type !== name) ise(r, 'calendar type override');
    return self;
  });
  def(CAL_BUILDER, 'setWeekDefinition', `(II)${CAL_BUILDER}`, (r, _m, [self, first, minimal]) => { if (first < 1 || first > 7 || minimal < 1 || minimal > 7) iae(r, null); builder(r, self).week = [first, minimal]; return self; });
  def(CAL_BUILDER, 'build', `()${CALENDAR}`, (r, _m, [self]) => {
    const b = builder(r, self);
    const locale = b.locale ?? r.dispatch({ owner: LOCALE, name: 'getDefault', parameters: [], result: LOCALE, signature: `()${LOCALE}` }, [], 'static');
    const zone = b.zone ?? r.dispatch({ owner: TZ, name: 'getDefault', parameters: [], result: TZ, signature: `()${TZ}` }, [], 'static');
    const type = b.type ?? 'gregory';
    const cal = r.dispatch({ owner: CALENDAR, name: 'getInstance', parameters: [TZ, LOCALE], result: CALENDAR, signature: `(${TZ}${LOCALE})${CALENDAR}` }, [zone, locale], 'static');
    call(r, cal, CALENDAR, 'clear', [], 'V'); call(r, cal, CALENDAR, 'setLenient', ['Z'], 'V', [b.lenient ? 1 : 0]);
    const week = type === 'iso8601' ? [2, 4] : b.week;
    if (week) { call(r, cal, CALENDAR, 'setFirstDayOfWeek', ['I'], 'V', [week[0]]); call(r, cal, CALENDAR, 'setMinimalDaysInFirstWeek', ['I'], 'V', [week[1]]); }
    if (b.instant !== null) { callWide(r, cal, CALENDAR, 'setTimeInMillis', ['J'], 'V', [b.instant]); call(r, cal, CALENDAR, 'getTimeInMillis', [], 'J'); return cal; }
    if (b.set) {
      const weekDate = b.stamps.has(WEEK_YEAR) && [...b.stamps.keys()].indexOf(WEEK_YEAR) > [...b.stamps.keys()].indexOf(YEAR);
      for (const [field, value] of b.stamps) if (field < FIELD_COUNT && !(weekDate && (field === WEEK_OF_YEAR || field === DAY_OF_WEEK))) call(r, cal, CALENDAR, 'set', ['I', 'I'], 'V', [field, value]);
      if (weekDate) applyWeekDate(r, cal, b.stamps.get(WEEK_YEAR), b.stamps.get(WEEK_OF_YEAR) ?? 1, b.stamps.get(DAY_OF_WEEK) ?? call(r, cal, CALENDAR, 'getFirstDayOfWeek', [], 'I'));
      call(r, cal, CALENDAR, 'getTimeInMillis', [], 'J');   // Calendar.complete(): resolve the fields (an IllegalArgumentException for an invalid date when not lenient)
    }
    return cal;
  });
  return { ...registry };
}
