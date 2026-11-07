import { createHostRegistry } from './host-contract.js?v=3d4e6dce15ef';
import { APKError } from './apk-error.js?v=3d4e6dce15ef';
import { cleartextPermitted } from './network-native.js?v=3d4e6dce15ef';

// Small platform classes: android.os.WorkSource (a set of (uid, name) pairs the framework blames for work), android.media.MediaMetadataRetriever and android.graphics.Movie.
// MediaMetadataRetriever and Movie need container / GIF decoders the lab does not carry: a missing or unreadable source fails the way the framework does, a readable one says explicitly that
// there is no extractor (never an invented duration or frame).
const WS = 'Landroid/os/WorkSource;', MMR = 'Landroid/media/MediaMetadataRetriever;', MOVIE = 'Landroid/graphics/Movie;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;';
const URI = 'Landroid/net/Uri;', CONTEXT = 'Landroid/content/Context;', FD = 'Ljava/io/FileDescriptor;', BITMAP = 'Landroid/graphics/Bitmap;', PARAMS = 'Landroid/media/MediaMetadataRetriever$BitmapParams;', LIST = 'Ljava/util/List;';
const nullish = v => v === null || v === undefined || v === 0;

export function createMiscPlatformHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  type(WS, OBJECT, ['Landroid/os/Parcelable;'], { allocatable: true }); type(MMR, OBJECT, ['Ljava/lang/AutoCloseable;'], { allocatable: true }); type(MOVIE, OBJECT, [], { allocatable: false });
  const npe = (r, m = null) => r.throwJava('Ljava/lang/NullPointerException;', m);
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };

  // ---- WorkSource: ordered, duplicate-free (uid, name) entries ------------------------------------------------------------------------------------------------------------------------------------------
  const entries = (r, self) => r.object(self).work ??= [];
  const sameEntry = (a, b) => a.uid === b.uid && (a.name ?? null) === (b.name ?? null);
  const addAll = (list, other) => { let changed = false; for (const entry of other) if (!list.some(e => sameEntry(e, entry))) { list.push({ ...entry }); changed = true; } return changed; };
  def(WS, '<init>', '()V', (r, _m, [self]) => { r.object(self).work = []; });
  def(WS, '<init>', `(${WS})V`, (r, _m, [self, source]) => { r.object(self).work = nullish(source) ? [] : entries(r, source).map(e => ({ ...e })); });
  def(WS, '<init>', '(I)V', (r, _m, [self, uid]) => { r.object(self).work = [{ uid, name: null }]; });
  def(WS, '<init>', `(I${STRING})V`, (r, _m, [self, uid, name]) => { if (nullish(name)) npe(r, 'packageName'); r.object(self).work = [{ uid, name: text(r, name) }]; });
  def(WS, 'size', '()I', (r, _m, [self]) => entries(r, self).length);
  def(WS, 'isEmpty', '()Z', (r, _m, [self]) => entries(r, self).length === 0 ? 1 : 0);
  def(WS, 'getUid', '(I)I', (r, _m, [self, i]) => { const e = entries(r, self)[i]; if (!e) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${entries(r, self).length}; index=${i}`); return e.uid; });
  def(WS, 'getName', `(I)${STRING}`, (r, _m, [self, i]) => { const e = entries(r, self)[i]; if (!e) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${entries(r, self).length}; index=${i}`); return e.name; });
  def(WS, 'add', '(I)Z', (r, _m, [self, uid]) => addAll(entries(r, self), [{ uid, name: null }]) ? 1 : 0);
  def(WS, 'add', `(I${STRING})Z`, (r, _m, [self, uid, name]) => { if (nullish(name)) npe(r, 'name'); return addAll(entries(r, self), [{ uid, name: text(r, name) }]) ? 1 : 0; });
  def(WS, 'add', `(${WS})Z`, (r, _m, [self, other]) => { if (nullish(other)) npe(r); return addAll(entries(r, self), entries(r, other)) ? 1 : 0; });
  def(WS, 'remove', `(${WS})Z`, (r, _m, [self, other]) => { if (nullish(other)) npe(r); const list = entries(r, self), before = list.length; r.object(self).work = list.filter(e => !entries(r, other).some(o => sameEntry(o, e))); return r.object(self).work.length !== before ? 1 : 0; });
  def(WS, 'diff', `(${WS})Z`, (r, _m, [self, other]) => { if (nullish(other)) npe(r); const a = entries(r, self), b = entries(r, other); return a.length !== b.length || a.some(e => !b.some(o => sameEntry(o, e))) ? 1 : 0; });
  def(WS, 'set', `(${WS})V`, (r, _m, [self, other]) => { r.object(self).work = nullish(other) ? [] : entries(r, other).map(e => ({ ...e })); });
  def(WS, 'clear', '()V', (r, _m, [self]) => { r.object(self).work = []; });
  def(WS, 'clone', `()${OBJECT}`, (r, _m, [self]) => { const copy = r.allocate(WS); r.object(copy).work = entries(r, self).map(e => ({ ...e })); return copy; });
  def(WS, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => { if (nullish(other) || r.typeOf(other) !== WS) return 0; const a = entries(r, self), b = entries(r, other); return a.length === b.length && a.every(e => b.some(o => sameEntry(o, e))) ? 1 : 0; });
  def(WS, 'hashCode', '()I', (r, _m, [self]) => { let h = 0; for (const e of entries(r, self)) h = (Math.imul(31, h) + (e.uid | 0) + [...(e.name ?? '')].reduce((x, c) => (Math.imul(31, x) + c.charCodeAt(0)) | 0, 0)) | 0; return h; });
  def(WS, 'toString', `()${STRING}`, (r, _m, [self]) => `WorkSource{${entries(r, self).map(e => e.name == null ? `${e.uid}` : `${e.uid} ${e.name}`).join(', ')}}`);
  def(WS, 'describeContents', '()I', () => 0);

  // ---- MediaMetadataRetriever ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const noExtractor = what => unsupported(`${what}: the lab has no media container extractor (no MediaExtractor / codecs); a readable source cannot be probed`, 'media-extractor-unsupported');
  const checkFile = (r, path) => {
    if (nullish(path)) r.throwJava('Ljava/lang/IllegalArgumentException;', null);
    const p = text(r, path); const exists = platform.javaIo.fs().node(p) !== null;
    if (!exists) r.throwJava('Ljava/lang/RuntimeException;', 'setDataSource failed: status = 0x80000000');
    noExtractor(`MediaMetadataRetriever.setDataSource(${p})`);
  };
  def(MMR, '<init>', '()V', () => {});
  def(MMR, 'setDataSource', `(${STRING})V`, (r, _m, [, path]) => checkFile(r, path));
  def(MMR, 'setDataSource', `(${STRING}Ljava/util/Map;)V`, (r, _m, [, path]) => checkFile(r, path));
  def(MMR, 'setDataSource', `(${CONTEXT}${URI})V`, (r, _m, [, , uri]) => { if (nullish(uri)) r.throwJava('Ljava/lang/IllegalArgumentException;', null); noExtractor('MediaMetadataRetriever.setDataSource(Context, Uri)'); });
  def(MMR, 'setDataSource', `(${FD})V`, () => noExtractor('MediaMetadataRetriever.setDataSource(FileDescriptor)'));
  def(MMR, 'setDataSource', `(${FD}JJ)V`, () => noExtractor('MediaMetadataRetriever.setDataSource(FileDescriptor, offset, length)'));
  def(MMR, 'setDataSource', '(Landroid/media/MediaDataSource;)V', () => noExtractor('MediaMetadataRetriever.setDataSource(MediaDataSource)'));
  def(MMR, 'release', '()V', () => {}); def(MMR, 'close', '()V', () => {});
  const noSource = r => r.throwJava('Ljava/lang/IllegalStateException;', 'No data source set.');
  def(MMR, 'extractMetadata', `(I)${STRING}`, noSource);
  def(MMR, 'getEmbeddedPicture', '()[B', noSource);
  for (const [name, sig] of [['getFrameAtTime', '()'], ['getFrameAtTime', '(J)'], ['getFrameAtTime', '(JI)'], ['getFrameAtTime', `(JI${PARAMS})`], ['getScaledFrameAtTime', '(JIII)'], ['getScaledFrameAtTime', `(JIII${PARAMS})`], ['getFrameAtIndex', '(I)'], ['getFrameAtIndex', `(I${PARAMS})`], ['getImageAtIndex', '(I)'], ['getImageAtIndex', `(I${PARAMS})`], ['getPrimaryImage', '()'], ['getPrimaryImage', `(${PARAMS})`]]) def(MMR, name, `${sig}${BITMAP}`, noSource);
  def(MMR, 'getFramesAtIndex', `(II)${LIST}`, noSource); def(MMR, 'getFramesAtIndex', `(II${PARAMS})${LIST}`, noSource);

  // ---- Movie (GIF decoding) -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const noMovie = what => unsupported(`${what}: android.graphics.Movie (GIF decoding) is not modelled; use ImageDecoder / BitmapFactory for still images`, 'movie-unsupported');
  def(MOVIE, 'decodeStream', `(Ljava/io/InputStream;)${MOVIE}`, () => noMovie('Movie.decodeStream'), { static: true });
  def(MOVIE, 'decodeByteArray', `([BII)${MOVIE}`, () => noMovie('Movie.decodeByteArray'), { static: true });
  def(MOVIE, 'decodeFile', `(${STRING})${MOVIE}`, () => noMovie('Movie.decodeFile'), { static: true });
  for (const [name, sig] of [['width', '()I'], ['height', '()I'], ['duration', '()I'], ['isOpaque', '()Z'], ['setTime', '(I)Z'], ['draw', 'DUMMY']]) if (sig !== 'DUMMY') def(MOVIE, name, sig, () => noMovie(`Movie.${name}`));
  def(MOVIE, 'draw', 'Landroid/graphics/Canvas;FF'.replace(/^/, '(') + ')V', () => noMovie('Movie.draw')); def(MOVIE, 'draw', '(Landroid/graphics/Canvas;FFLandroid/graphics/Paint;)V', () => noMovie('Movie.draw'));

  const UL = 'Landroid/icu/util/ULocale;', LOCALE = 'Ljava/util/Locale;';
  const callV = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const callS = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'static');
  // ---- java.util.Locale display names (getDisplayLanguage / getDisplayCountry / getDisplayScript / getDisplayName), in the Locale's own or a given Locale, from the platform CLDR data (Intl.DisplayNames).
  const tagOf = (r, loc) => { const t = r.object(loc).localeData?.tag; return t && t !== 'und' ? t : 'en-US'; };
  const partsOf = (r, loc) => ({ language: callV(r, loc, LOCALE, 'getLanguage', [], STRING), script: callV(r, loc, LOCALE, 'getScript', [], STRING), country: callV(r, loc, LOCALE, 'getCountry', [], STRING), variant: callV(r, loc, LOCALE, 'getVariant', [], STRING) });
  const display = (r, loc, inLoc, kind) => {
    const names = (type, code) => { if (!code) return ''; try { return new Intl.DisplayNames([tagOf(r, inLoc)], { type, fallback: 'code' }).of(code) ?? code; } catch { return code; } };
    const p = partsOf(r, loc), language = names('language', p.language), script = names('script', p.script), country = names('region', p.country);
    if (kind === 'language') return language; if (kind === 'country') return country; if (kind === 'script') return script; if (kind === 'variant') return p.variant;
    const qualifiers = [script, country, p.variant].filter(Boolean);   // Locale.getDisplayName: "language (script, country, variant)"
    return qualifiers.length ? `${language} (${qualifiers.join(', ')})` : language;
  };
  for (const [name, kind] of [['getDisplayLanguage', 'language'], ['getDisplayCountry', 'country'], ['getDisplayScript', 'script'], ['getDisplayVariant', 'variant'], ['getDisplayName', 'name']]) {
    def(LOCALE, name, `()${STRING}`, (r, _m, [self]) => display(r, self, callS(r, LOCALE, 'getDefault', [], LOCALE), kind));
    def(LOCALE, name, `(${LOCALE})${STRING}`, (r, _m, [self, inLocale]) => { if (nullish(inLocale)) npe(r, 'inLocale'); return display(r, self, inLocale, kind); });
  }

  // ---- android.icu.util.ULocale over the platform's java.util.Locale (ICU4J itself, with its data bundles, is not part of the lab; the Locale model carries language, script, country, variant and the
  // display names from the platform CLDR data). Keywords (-u- extensions) beyond the Locale's own are not modelled: getKeywordValue answers null and getKeywords null.
  type(UL, OBJECT, ['Ljava/lang/Comparable;', 'Ljava/io/Serializable;'], { allocatable: true });
  const locale = (r, self) => r.object(self).locale ?? r.throwJava('Ljava/lang/IllegalStateException;', 'ULocale used before construction');
  const KEY_LEGACY = { ca: 'calendar', nu: 'numbers', co: 'collation', hc: 'hours', cu: 'currency', kn: 'colnumeric', kf: 'colcasefirst', ks: 'colstrength' }, VALUE_LEGACY = { phonebk: 'phonebook', trad: 'traditional', dict: 'dictionary', gregory: 'gregorian', ethioaa: 'ethiopic-amete-alem', islamicc: 'islamic-civil' };
  const parseExtensions = tag => { const m = /-u((?:-[a-z0-9]{2,8})+)/i.exec(tag), out = {}; if (!m) return out; let key = null; for (const token of m[1].slice(1).split('-')) { if (token.length === 2 && /^[a-z][a-z0-9]$/i.test(token)) { key = token.toLowerCase(); out[key] = ''; } else if (key) out[key] = out[key] ? `${out[key]}-${token.toLowerCase()}` : token.toLowerCase(); } return out; };
  const wrap = (r, loc, keywords = {}) => { const o = r.allocate(UL); r.object(o).locale = loc; r.object(o).keywords = keywords; return o; };
  const tagWithKeywords = (r, loc, keywords) => { const base = text(r, callV(r, loc, LOCALE, 'toLanguageTag', [], STRING)).replace(/-u(?:-[a-z0-9]{2,8})+/i, ''), pairs = Object.entries(keywords); return pairs.length ? `${base}-u${pairs.map(([k, v]) => `-${k}${v ? '-' + v : ''}`).join('')}` : base; };
  const fromId = (r, id) => callS(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [text(r, id).replace(/_/g, '-').split('@')[0]]);
  def(UL, '<init>', `(${STRING})V`, (r, _m, [self, id]) => {
    if (nullish(id)) npe(r); const raw = text(r, id), at = raw.indexOf('@'), keywords = {};
    if (at >= 0) for (const pair of raw.slice(at + 1).split(';')) { const [k, v] = pair.split('='); const short = Object.entries(KEY_LEGACY).find(([, legacy]) => legacy === k)?.[0] ?? k; keywords[short] = Object.entries(VALUE_LEGACY).find(([, legacy]) => legacy === v)?.[0] ?? v; }
    r.object(self).locale = fromId(r, id); r.object(self).keywords = keywords;
  });
  def(UL, '<init>', `(${STRING}${STRING})V`, (r, _m, [self, lang, country]) => { r.object(self).locale = construct(r, LOCALE, [STRING, STRING], [lang ?? '', country ?? '']); r.object(self).keywords = {}; });
  def(UL, '<init>', `(${STRING}${STRING}${STRING})V`, (r, _m, [self, lang, country, variant]) => { r.object(self).locale = construct(r, LOCALE, [STRING, STRING, STRING], [lang ?? '', country ?? '', variant ?? '']); });
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, [o, ...args], 'direct'); return o; };
  def(UL, 'forLanguageTag', `(${STRING})${UL}`, (r, _m, [tag]) => { if (nullish(tag)) npe(r); return wrap(r, callS(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [tag]), parseExtensions(text(r, tag))); }, { static: true });
  def(UL, 'createCanonical', `(${STRING})${UL}`, (r, _m, [id]) => wrap(r, fromId(r, id)), { static: true });
  def(UL, 'createCanonical', `(${UL})${UL}`, (r, _m, [other]) => other, { static: true });
  def(UL, 'getDefault', `()${UL}`, r => wrap(r, callS(r, LOCALE, 'getDefault', [], LOCALE)), { static: true });
  def(UL, 'getDefault', `(Landroid/icu/util/ULocale$Category;)${UL}`, r => wrap(r, callS(r, LOCALE, 'getDefault', [], LOCALE)), { static: true });
  def(UL, 'getAvailableLocales', `()[${UL}`, r => { const tags = ['en-US', 'pt-BR', 'es-ES', 'fr-FR', 'de-DE'], array = r.newArray(`[${UL}`, tags.length); r.array(array).elements = tags.map(tag => wrap(r, callS(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [tag]))); return array; }, { static: true });
  def(UL, 'toLanguageTag', `()${STRING}`, (r, _m, [self]) => tagWithKeywords(r, locale(r, self), r.object(self).keywords ?? {}));
  def(UL, 'toLocale', `()${LOCALE}`, (r, _m, [self]) => locale(r, self));
  for (const name of ['getLanguage', 'getCountry', 'getVariant']) def(UL, name, `()${STRING}`, (r, _m, [self]) => callV(r, locale(r, self), LOCALE, name, [], STRING));
  def(UL, 'getScript', `()${STRING}`, (r, _m, [self]) => callV(r, locale(r, self), LOCALE, 'getScript', [], STRING));
  def(UL, 'getName', `()${STRING}`, (r, _m, [self]) => { const base = text(r, callV(r, locale(r, self), OBJECT, 'toString', [], STRING)), pairs = Object.entries(r.object(self).keywords ?? {}).map(([k, v]) => [KEY_LEGACY[k] ?? k, VALUE_LEGACY[v] ?? v]).sort(([a], [b]) => a < b ? -1 : 1); return pairs.length ? `${base}@${pairs.map(([k, v]) => `${k}=${v}`).join(';')}` : base; });
  def(UL, 'getBaseName', `()${STRING}`, (r, _m, [self]) => callV(r, locale(r, self), OBJECT, 'toString', [], STRING));
  for (const name of ['getDisplayName', 'getDisplayLanguage', 'getDisplayCountry']) { def(UL, name, `()${STRING}`, (r, _m, [self]) => callV(r, locale(r, self), LOCALE, name, [], STRING)); def(UL, name, `(${UL})${STRING}`, (r, _m, [self, inLocale]) => callV(r, locale(r, self), LOCALE, name, [LOCALE], STRING, [locale(r, inLocale)])); }
  def(UL, 'getKeywordValue', `(${STRING})${STRING}`, (r, _m, [self, key]) => { if (nullish(key)) npe(r); const k = text(r, key), short = Object.entries(KEY_LEGACY).find(([, legacy]) => legacy === k)?.[0] ?? k, v = (r.object(self).keywords ?? {})[short]; return v === undefined ? null : VALUE_LEGACY[v] ?? v; });
  def(UL, 'getKeywords', '()Ljava/util/Iterator;', (r, _m, [self]) => { const names = Object.keys(r.object(self).keywords ?? {}).map(k => KEY_LEGACY[k] ?? k).sort(); if (!names.length) return null; const list = construct(r, 'Ljava/util/ArrayList;', [], []); for (const n of names) callV(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [n]); return callV(r, list, 'Ljava/util/ArrayList;', 'iterator', [], 'Ljava/util/Iterator;'); });
  // ---- ULocale.Builder: language / script / region / variant, language tag, and Unicode keywords (the ca, nu, co, hc, cu keys); anything else is rejected
  const BUILDER = 'Landroid/icu/util/ULocale$Builder;'; type(BUILDER, OBJECT, [], { allocatable: true });
  const b = (r, self) => r.object(self).build ??= { language: '', script: '', region: '', variant: '', keywords: {} };
  def(BUILDER, '<init>', '()V', (r, _m, [self]) => b(r, self));
  for (const [name, key] of [['setLanguage', 'language'], ['setScript', 'script'], ['setRegion', 'region'], ['setVariant', 'variant']]) def(BUILDER, name, `(${STRING})${BUILDER}`, (r, _m, [self, v]) => { b(r, self)[key] = nullish(v) ? '' : text(r, v); return self; });
  def(BUILDER, 'setLocale', `(${UL})${BUILDER}`, (r, _m, [self, loc]) => { const st = b(r, self), l = locale(r, loc); Object.assign(st, { language: text(r, callV(r, l, LOCALE, 'getLanguage', [], STRING)), script: text(r, callV(r, l, LOCALE, 'getScript', [], STRING)), region: text(r, callV(r, l, LOCALE, 'getCountry', [], STRING)), variant: text(r, callV(r, l, LOCALE, 'getVariant', [], STRING)), keywords: { ...(r.object(loc).keywords ?? {}) } }); return self; });
  def(BUILDER, 'setLanguageTag', `(${STRING})${BUILDER}`, (r, _m, [self, tag]) => { const l = callS(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [tag]), st = b(r, self); Object.assign(st, { language: text(r, callV(r, l, LOCALE, 'getLanguage', [], STRING)), script: text(r, callV(r, l, LOCALE, 'getScript', [], STRING)), region: text(r, callV(r, l, LOCALE, 'getCountry', [], STRING)), variant: text(r, callV(r, l, LOCALE, 'getVariant', [], STRING)), keywords: parseExtensions(text(r, tag)) }); return self; });
  def(BUILDER, 'setUnicodeLocaleKeyword', `(${STRING}${STRING})${BUILDER}`, (r, _m, [self, key, value]) => { const k = text(r, key); if (!/^[a-z][a-z0-9]$/i.test(k ?? '')) r.throwJava('Ljava/util/IllformedLocaleException;', `Ill-formed Unicode locale keyword key: ${k}`); if (nullish(value)) delete b(r, self).keywords[k]; else b(r, self).keywords[k.toLowerCase()] = text(r, value).toLowerCase(); return self; });
  def(BUILDER, 'clearExtensions', `()${BUILDER}`, (r, _m, [self]) => { b(r, self).keywords = {}; return self; });
  def(BUILDER, 'clear', `()${BUILDER}`, (r, _m, [self]) => { r.object(self).build = { language: '', script: '', region: '', variant: '', keywords: {} }; return self; });
  def(BUILDER, 'build', `()${UL}`, (r, _m, [self]) => { const st = b(r, self), tag = [st.language || 'und', st.script, st.region, st.variant].filter(Boolean).join('-'); return wrap(r, callS(r, LOCALE, 'forLanguageTag', [STRING], LOCALE, [tag]), { ...st.keywords }); });
  def(UL, 'toString', `()${STRING}`, (r, _m, [self]) => callV(r, locale(r, self), OBJECT, 'toString', [], STRING));
  def(UL, 'hashCode', '()I', (r, _m, [self]) => callV(r, locale(r, self), OBJECT, 'hashCode', [], 'I'));
  def(UL, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => !nullish(other) && r.typeOf(other) === UL && callV(r, locale(r, self), OBJECT, 'equals', [OBJECT], 'Z', [locale(r, other)]) ? 1 : 0);
  def(UL, 'compareTo', `(${UL})I`, (r, _m, [self, other]) => { const a = callV(r, locale(r, self), OBJECT, 'toString', [], STRING), b = callV(r, locale(r, other), OBJECT, 'toString', [], STRING); return a < b ? -1 : a > b ? 1 : 0; });

  // ---- java.util.logging.Logger members the system host's logger model lacks: logp (source class / method are only record metadata), entering / exiting, the Supplier overloads, getGlobal, filters
  const LOGGER = 'Ljava/util/logging/Logger;', LEVEL = 'Ljava/util/logging/Level;', SUPPLIER = 'Ljava/util/function/Supplier;', THROWABLE = 'Ljava/lang/Throwable;', OBJECTS = '[Ljava/lang/Object;';
  const level = (r, name) => r.readStatic({ owner: LEVEL, name, type: LEVEL, key: `${LEVEL}->${name}:${LEVEL}` });
  const supplied = (r, supplier) => callV(r, supplier, SUPPLIER, 'get', [], OBJECT);
  const loggable = (r, self, lv) => callV(r, self, LOGGER, 'isLoggable', [LEVEL], 'Z', [lv]) === 1 || callV(r, self, LOGGER, 'isLoggable', [LEVEL], 'Z', [lv]) === true;
  const logSupplied = (r, self, lv, supplier, thrown = null) => { if (!loggable(r, self, lv)) return; const message = supplied(r, supplier); if (thrown === null) callV(r, self, LOGGER, 'log', [LEVEL, STRING], 'V', [lv, message]); else callV(r, self, LOGGER, 'log', [LEVEL, STRING, THROWABLE], 'V', [lv, message, thrown]); };
  for (const name of ['severe', 'warning', 'info', 'config', 'fine', 'finer', 'finest']) def(LOGGER, name, `(${SUPPLIER})V`, (r, _m, [self, supplier]) => logSupplied(r, self, level(r, name.toUpperCase()), supplier));
  def(LOGGER, 'log', `(${LEVEL}${SUPPLIER})V`, (r, _m, [self, lv, supplier]) => logSupplied(r, self, lv, supplier));
  def(LOGGER, 'log', `(${LEVEL}${THROWABLE}${SUPPLIER})V`, (r, _m, [self, lv, thrown, supplier]) => logSupplied(r, self, lv, supplier, thrown));
  const logp = (r, self, lv, message, extra) => { if (extra === undefined) callV(r, self, LOGGER, 'log', [LEVEL, STRING], 'V', [lv, message]); else if (extra.thrown !== undefined) callV(r, self, LOGGER, 'log', [LEVEL, STRING, THROWABLE], 'V', [lv, message, extra.thrown]); else callV(r, self, LOGGER, 'log', [LEVEL, STRING, OBJECTS], 'V', [lv, message, extra.params]); };
  const one = (r, value) => { const array = r.newArray(OBJECTS, 1); r.array(array).elements = [value]; return array; };
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${STRING})V`, (r, _m, [self, lv, , , msg]) => logp(r, self, lv, msg));
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${STRING}${OBJECT})V`, (r, _m, [self, lv, , , msg, p]) => logp(r, self, lv, msg, { params: one(r, p) }));
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${STRING}${OBJECTS})V`, (r, _m, [self, lv, , , msg, ps]) => logp(r, self, lv, msg, { params: ps }));
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${STRING}${THROWABLE})V`, (r, _m, [self, lv, , , msg, t]) => logp(r, self, lv, msg, { thrown: t }));
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${SUPPLIER})V`, (r, _m, [self, lv, , , supplier]) => logSupplied(r, self, lv, supplier));
  def(LOGGER, 'logp', `(${LEVEL}${STRING}${STRING}${THROWABLE}${SUPPLIER})V`, (r, _m, [self, lv, , , t, supplier]) => logSupplied(r, self, lv, supplier, t));
  def(LOGGER, 'entering', `(${STRING}${STRING})V`, (r, _m, [self]) => logp(r, self, level(r, 'FINER'), 'ENTRY'));
  def(LOGGER, 'entering', `(${STRING}${STRING}${OBJECT})V`, (r, _m, [self, , , p]) => logp(r, self, level(r, 'FINER'), 'ENTRY {0}', { params: one(r, p) }));
  def(LOGGER, 'entering', `(${STRING}${STRING}${OBJECTS})V`, (r, _m, [self, , , ps]) => { const n = nullish(ps) ? 0 : r.array(ps).elements.length; logp(r, self, level(r, 'FINER'), 'ENTRY' + Array.from({ length: n }, (_, i) => ` {${i}}`).join(''), nullish(ps) ? undefined : { params: ps }); });
  def(LOGGER, 'exiting', `(${STRING}${STRING})V`, (r, _m, [self]) => logp(r, self, level(r, 'FINER'), 'RETURN'));
  def(LOGGER, 'exiting', `(${STRING}${STRING}${OBJECT})V`, (r, _m, [self, , , p]) => logp(r, self, level(r, 'FINER'), 'RETURN {0}', { params: one(r, p) }));
  def(LOGGER, 'getGlobal', `()${LOGGER}`, r => callS(r, LOGGER, 'getLogger', [STRING], LOGGER, ['global']), { static: true });
  def(LOGGER, 'getFilter', '()Ljava/util/logging/Filter;', (r, _m, [self]) => r.object(self).filter ?? null); def(LOGGER, 'setFilter', '(Ljava/util/logging/Filter;)V', (r, _m, [self, filter]) => { r.object(self).filter = nullish(filter) ? null : filter; });

  // ---- AnimationUtils XML loading: the lab's AnimationUtils class carries the animation clock only; the load* / make* calls go to the original code copied into dev.apkweb.view.XmlAnimations (layouts profile)
  const UTILS = 'Landroid/view/animation/AnimationUtils;', XA = 'Ldev/apkweb/view/XmlAnimations;', ANIM = 'Landroid/view/animation/Animation;', INTERP = 'Landroid/view/animation/Interpolator;', LAC = 'Landroid/view/animation/LayoutAnimationController;';
  const xa = (r, name, parameters, result, args) => { if (!r.classes.has(XA)) unsupported(`AnimationUtils.${name}: XML animation loading needs the layouts framework profile (enableLayoutProfile)`, 'xml-animations-profile'); return callS(r, XA, name, parameters, result, args); };
  for (const [name, parameters, result] of [['loadAnimation', [CONTEXT, 'I'], ANIM], ['loadLayoutAnimation', [CONTEXT, 'I'], LAC], ['loadInterpolator', [CONTEXT, 'I'], INTERP], ['loadInterpolator', ['Landroid/content/res/Resources;', 'Landroid/content/res/Resources$Theme;', 'I'], INTERP], ]) {
    def(UTILS, name, `(${parameters.join('')})${result}`, (r, _m, args) => xa(r, name, parameters, result, args), { static: true });
  }
  for (const [name, parameters] of [['makeInAnimation', [CONTEXT, 'Z']], ['makeOutAnimation', [CONTEXT, 'Z']], ['makeInChildBottomAnimation', [CONTEXT]]]) def(UTILS, name, `(${parameters.join('')})${ANIM}`, () => unsupported(`AnimationUtils.${name}: the framework's slide_in / slide_out animation resources are not part of the lab`, 'framework-animation-resources'), { static: true });

  // ---- android.content.ContentUris (android-13.0.0_r1 ContentUris.java) ---------------------------------------------------------------------------------------------------------------------------------------
  const CU = 'Landroid/content/ContentUris;', URI_BUILDER = 'Landroid/net/Uri$Builder;'; type(CU, OBJECT, [], { allocatable: false });
  const uriLast = (r, uri) => text(r, callV(r, uri, URI, 'getLastPathSegment', [], STRING));
  def(CU, 'appendId', `(${URI_BUILDER}J)${URI_BUILDER}`, (r, _m, [builder, id]) => callV(r, builder, URI_BUILDER, 'appendEncodedPath', [STRING], URI_BUILDER, [String(id)]), { static: true });
  def(CU, 'withAppendedId', `(${URI}J)${URI}`, (r, _m, [uri, id]) => { if (nullish(uri)) npe(r); const b = callV(r, uri, URI, 'buildUpon', [], URI_BUILDER); callV(r, b, URI_BUILDER, 'appendEncodedPath', [STRING], URI_BUILDER, [String(id)]); return callV(r, b, URI_BUILDER, 'build', [], URI); }, { static: true });
  def(CU, 'parseId', `(${URI})J`, (r, _m, [uri]) => { const last = uriLast(r, uri); return last === null ? -1n : callS(r, 'Ljava/lang/Long;', 'parseLong', [STRING], 'J', [last]); }, { static: true });
  def(CU, 'removeId', `(${URI})${URI}`, (r, _m, [uri]) => {
    const last = uriLast(r, uri); if (last === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'No path segments to remove');
    const segments = callV(r, uri, URI, 'getPathSegments', [], 'Ljava/util/List;'), count = callV(r, segments, 'Ljava/util/List;', 'size', [], 'I'), b = callV(r, uri, URI, 'buildUpon', [], URI_BUILDER);
    callV(r, b, URI_BUILDER, 'path', [STRING], URI_BUILDER, [null]); for (let i = 0; i < count - 1; i++) callV(r, b, URI_BUILDER, 'appendPath', [STRING], URI_BUILDER, [callV(r, segments, 'Ljava/util/List;', 'get', ['I'], OBJECT, [i])]);
    return callV(r, b, URI_BUILDER, 'build', [], URI);
  }, { static: true });

  // ---- android.util.Xml: newPullParser / newSerializer over libcore's KXmlParser / KXmlSerializer (original sources), findEncodingByName, the SAX parse entry points are not modelled -----------------------------------------
  const XML = 'Landroid/util/Xml;', KPARSER = 'Lcom/android/org/kxml2/io/KXmlParser;', KSER = 'Lcom/android/org/kxml2/io/KXmlSerializer;', ENC = 'Landroid/util/Xml$Encoding;', PULL = 'Lorg/xmlpull/v1/XmlPullParser;', SER = 'Lorg/xmlpull/v1/XmlSerializer;';
  type(XML, OBJECT, [], { allocatable: false }); type(ENC, 'Ljava/lang/Enum;', [], { allocatable: true });
  staticField(XML, 'FEATURE_RELAXED', STRING, () => 'http://xmlpull.org/v1/doc/features.html#relaxed');
  const ENCODINGS = [['US_ASCII', 'US-ASCII'], ['UTF_8', 'UTF-8'], ['UTF_16', 'UTF-16'], ['ISO_8859_1', 'ISO-8859-1']];
  ENCODINGS.forEach(([name, expat], i) => staticField(ENC, name, ENC, r => { const v = r.allocate(ENC), o = r.object(v); o.enumName = name; o.enumOrdinal = i; o.expatName = expat; return v; }));
  def(XML, 'newPullParser', `()${PULL}`, r => { if (!r.classes.has(KPARSER)) unsupported('Xml.newPullParser: KXmlParser is not in this framework build', 'xml-parser-missing'); const p = construct(r, KPARSER, [], []); callV(r, p, KPARSER, 'setFeature', [STRING, 'Z'], 'V', ['http://xmlpull.org/v1/doc/features.html#process-docdecl', 1]); callV(r, p, KPARSER, 'setFeature', [STRING, 'Z'], 'V', ['http://xmlpull.org/v1/doc/features.html#relaxed', 1]); return p; }, { static: true });
  def(XML, 'newSerializer', `()${SER}`, r => { if (!r.classes.has(KSER)) unsupported('Xml.newSerializer: KXmlSerializer is not in this framework build', 'xml-serializer-missing'); return construct(r, KSER, [], []); }, { static: true });
  def(XML, 'findEncodingByName', `(${STRING})${ENC}`, (r, _m, [name]) => { if (nullish(name)) npe(r); const n = text(r, name).toUpperCase(), at = ENCODINGS.findIndex(([, expat]) => expat.toUpperCase() === n); if (at < 0) r.throwJava('Ljava/io/UnsupportedEncodingException;', text(r, name)); return r.readStatic({ owner: ENC, name: ENCODINGS[at][0], type: ENC, key: `${ENC}->${ENCODINGS[at][0]}:${ENC}` }); }, { static: true });
  def(ENC, 'toString', `()${STRING}`, (r, _m, [self]) => r.object(self).expatName);
  def(XML, 'asAttributeSet', `(${PULL})Landroid/util/AttributeSet;`, (r, _m, [parser]) => { if (nullish(parser)) npe(r); if (r.isSubtype(r.object(parser).type, 'Landroid/util/AttributeSet;')) return parser; unsupported('Xml.asAttributeSet over a plain XmlPullParser: XmlPullAttributes is not modelled (XML resource parsers are AttributeSets already)', 'xml-attributes-unsupported'); }, { static: true });
  for (const sig of [`(Ljava/io/InputStream;${ENC}Lorg/xml/sax/ContentHandler;)V`, `(Ljava/io/Reader;Lorg/xml/sax/ContentHandler;)V`, `(${STRING}Lorg/xml/sax/ContentHandler;)V`]) def(XML, 'parse', sig, () => unsupported('Xml.parse (SAX): the lab has no SAX parser; use Xml.newPullParser()', 'sax-unsupported'), { static: true });
  // ---- com.android.internal.util.XmlUtils.convertValueToInt / convertValueToBoolean (android-13.0.0_r1; android.text.Html reads colour attributes through the first). The class itself needs TypedXml* and
  // Bitmap.CompressFormat and is not packaged; these two keep the original bodies, with Integer.parseInt run by the real Java class so number errors are the framework's.
  const XMLUTILS = 'Lcom/android/internal/util/XmlUtils;', CHARS = 'Ljava/lang/CharSequence;';
  type(XMLUTILS, OBJECT, [], { allocatable: false });
  const emptyChars = (r, v) => nullish(v) || r.stringCharacters(v).length === 0;
  def(XMLUTILS, 'convertValueToBoolean', `(${CHARS}Z)Z`, (r, _m, [value, fallback]) => emptyChars(r, value) ? fallback : (typeof value === 'string' || r.typeOf(value) === STRING) && ['1', 'true', 'TRUE'].includes(r.stringCharacters(value)) ? 1 : 0, { static: true });
  def(XMLUTILS, 'convertValueToInt', `(${CHARS}I)I`, (r, _m, [charSeq, fallback]) => {
    if (emptyChars(r, charSeq)) return fallback;
    const nm = r.stringCharacters(charSeq); let sign = 1, index = 0, base = 10;
    if (nm[0] === '-') { sign = -1; index++; }
    if (nm[index] === '0') { if (index === nm.length - 1) return 0; const c = nm[index + 1]; if (c === 'x' || c === 'X') { index += 2; base = 16; } else { index++; base = 8; } }
    else if (nm[index] === '#') { index++; base = 16; }
    const parsed = r.dispatch({ owner: 'Ljava/lang/Integer;', name: 'parseInt', parameters: [STRING, 'I'], result: 'I', signature: `(${STRING}I)I` }, r.argumentWords([STRING, 'I'], [nm.slice(index), base]), 'static');
    return Math.imul(parsed, sign);
  }, { static: true });

  // ---- android.security.NetworkSecurityPolicy: the same decision the lab's HTTP stack takes (network_security_config, usesCleartextTraffic, target SDK) -------------------------------------------
  const NSP = 'Landroid/security/NetworkSecurityPolicy;';
  type(NSP, OBJECT, [], { allocatable: false });
  def(NSP, 'getInstance', `()${NSP}`, r => r.makeObject(NSP), { static: true });
  def(NSP, 'isCleartextTrafficPermitted', '()Z', r => cleartextPermitted(r) ? 1 : 0);
  def(NSP, 'isCleartextTrafficPermitted', `(${STRING})Z`, (r, _m, [, host]) => { if (nullish(host)) npe(r, 'hostname'); return cleartextPermitted(r, text(r, host)) ? 1 : 0; });
  def(NSP, 'isCertificateTransparencyVerificationRequired', `(${STRING})Z`, () => 0);   // certificate transparency is not enforced on Android 13 unless the network security config asks for it (not parsed)
  return registry;
}
