import { createHostRegistry, floatBits, bitsFloat } from './host-contract.js?v=0d5a397ebb41';
import { gcRoot } from './heap-gc.js?v=0d5a397ebb41';
import { sfntStyle, tagToInt } from './sfnt.js?v=0d5a397ebb41';

export { sfntStyle };

// The app font stack of android-13.0.0_r1: android.graphics.fonts.{Font, Font.Builder, FontFamily, FontFamily.Builder, FontStyle, FontVariationAxis}, android.graphics.Typeface.{Builder, CustomFallbackBuilder},
// Typeface.createFromAsset / createFromFile / findFromCache, and the resource side (Resources.getFont, ResourcesImpl.loadFont, FontResourcesParser, Typeface.createFromResources, TextView's font attributes).
// The Java sources run as host code with the same checks, messages and fallbacks as the originals; the native half (Font.cpp / Typeface.cpp) is replaced by the Skia canvas host: a font is validated by FreeType
// (the Font.Builder.build() IllegalArgumentException for data that is no font), kept once per distinct file, and a Typeface keeps its whole family chain so the style requested at use time (Typeface.create(tf, BOLD),
// textFontWeight) selects the font by Minikin's closest-match score and decides the synthetic bold / italic Android applies.
// Approximations: a downloadable-font family (fontProviderAuthority) always answers Typeface.DEFAULT because no font provider exists in the VM; system families that fonts.xml defines but the lab has no file for
// (serif, monospace, cursive, ...) answer Roboto; Font.getLocaleList is always empty; a ParcelFileDescriptor font is read from the descriptor's current position.

const FONT = 'Landroid/graphics/fonts/Font;', FONT_BUILDER = 'Landroid/graphics/fonts/Font$Builder;', FAMILY = 'Landroid/graphics/fonts/FontFamily;', FAMILY_BUILDER = 'Landroid/graphics/fonts/FontFamily$Builder;';
const STYLE = 'Landroid/graphics/fonts/FontStyle;', AXIS = 'Landroid/graphics/fonts/FontVariationAxis;', TYPEFACE = 'Landroid/graphics/Typeface;', TB = 'Landroid/graphics/Typeface$Builder;', CFB = 'Landroid/graphics/Typeface$CustomFallbackBuilder;';
const FILE = 'Ljava/io/File;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', ASSETS = 'Landroid/content/res/AssetManager;', BUFFER = 'Ljava/nio/ByteBuffer;', PFD = 'Landroid/os/ParcelFileDescriptor;';
const RESOURCES = 'Landroid/content/res/Resources;', TYPED_VALUE = 'Landroid/util/TypedValue;', LIST = 'Ljava/util/List;', RECTF = 'Landroid/graphics/RectF;', PAINT = 'Landroid/graphics/Paint;', FD = 'Ljava/io/FileDescriptor;';
const NOT_FOUND = 'Landroid/content/res/Resources$NotFoundException;', IOEXCEPTION = 'Ljava/io/IOException;', IAE = 'Ljava/lang/IllegalArgumentException;', NPE = 'Ljava/lang/NullPointerException;';
const WEIGHTS = { THIN: 100, EXTRA_LIGHT: 200, LIGHT: 300, NORMAL: 400, MEDIUM: 500, SEMI_BOLD: 600, BOLD: 700, EXTRA_BOLD: 800, BLACK: 900 };
const RESOLVE_BY_FONT_TABLE = -1, DEFAULT_FAMILY = 'sans-serif', MAX_FALLBACK = 64;
const MAX_FONT_BYTES = 64 * 1024 * 1024;
const SYSTEM_FAMILIES = new Set(['sans-serif', 'sans-serif-thin', 'sans-serif-light', 'sans-serif-medium', 'sans-serif-black', 'arial', 'helvetica', 'tahoma', 'verdana']);

export function createTypefaceBuilderHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const dynamicCache = gcRoot(new Map());   // Typeface.sDynamicTypefaceCache: asset uid -> Typeface
  const text = (r, v) => v === null || v === undefined ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const flag = v => v !== 0 && v !== false && v !== null && v !== undefined;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'static');
  const construct = (r, owner, parameters, args = []) => { const value = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, [value, ...args], 'direct'); return value; };
  const npe = (r, what) => r.throwJava(NPE, what);
  const iae = (r, what = null) => r.throwJava(IAE, what);
  const isJava = (error, r, ...types) => error?.name === 'JavaException' && types.some(t => r.isSubtype(r.typeOf(error.value), t));
  /** new IOException(message, cause) with a cause of the given class, thrown (Font.Builder.build: "Failed to read font contents"). */
  const throwWithCause = (r, owner, message, cause) => {
    const exception = construct(r, owner, [STRING, 'Ljava/lang/Throwable;'], [message, construct(r, cause.type, [STRING], [cause.message])]);
    r.throwJavaReference(exception, message);
  };
  const javaFloat = (r, bits) => callStatic(r, 'Ljava/lang/Float;', 'toString', ['F'], STRING, [bits]);
  const stringOf = (r, value) => text(r, value);
  const defaultTypeface = r => r.readStatic({ owner: TYPEFACE, name: 'DEFAULT', type: TYPEFACE, key: `${TYPEFACE}->DEFAULT:${TYPEFACE}` });
  const skiaHost = r => r.skiaHost?.registerFontFile ? r.skiaHost : r.throwJava('Ljava/lang/UnsupportedOperationException;', 'App fonts need the Skia graphics backend');
  const systemTypeface = (r, name, style = 0) => callStatic(r, TYPEFACE, 'create', [STRING, 'I'], TYPEFACE, [name, style]);

  // ---- FontStyle ------------------------------------------------------------------------------------------------------------------------------
  type(STYLE, OBJECT, [], { allocatable: true });
  for (const [name, value] of Object.entries(WEIGHTS)) registry.staticField(STYLE, 'FONT_WEIGHT_' + name, 'I', () => value);
  registry.staticField(STYLE, 'FONT_WEIGHT_MIN', 'I', () => 1); registry.staticField(STYLE, 'FONT_WEIGHT_MAX', 'I', () => 1000);
  registry.staticField(STYLE, 'FONT_SLANT_UPRIGHT', 'I', () => 0); registry.staticField(STYLE, 'FONT_SLANT_ITALIC', 'I', () => 1);
  const initStyle = (r, self, weight, slant) => {
    if (weight < 1 || weight > 1000) iae(r, 'weight value must be [1, 1000]');
    if (slant !== 0 && slant !== 1) iae(r, 'slant value must be FONT_SLANT_UPRIGHT or FONT_SLANT_UPRIGHT');
    Object.assign(r.object(self), { fontStyle: { weight, slant } });
  };
  const styleOf = (r, ref) => r.object(ref).fontStyle ?? { weight: 400, slant: 0 };
  const newStyle = (r, weight, slant) => { const style = r.allocate(STYLE); initStyle(r, style, weight, slant); return style; };
  def(STYLE, '<init>', '()V', (r, _m, [self]) => initStyle(r, self, 400, 0));
  def(STYLE, '<init>', '(II)V', (r, _m, [self, weight, slant]) => initStyle(r, self, weight, slant));
  def(STYLE, 'getWeight', '()I', (r, _m, [self]) => styleOf(r, self).weight); def(STYLE, 'getSlant', '()I', (r, _m, [self]) => styleOf(r, self).slant);
  def(STYLE, 'getMatchScore', `(${STYLE})I`, (r, _m, [self, other]) => { if (other === null) npe(r, null); const a = styleOf(r, self), b = styleOf(r, other); return Math.trunc(Math.abs(a.weight - b.weight) / 100) + (a.slant === b.slant ? 0 : 2); });
  const sameStyle = (r, a, b) => styleOf(r, a).weight === styleOf(r, b).weight && styleOf(r, a).slant === styleOf(r, b).slant;
  def(STYLE, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => other === self || other !== null && typeof other === 'object' && r.typeOf(other) === STYLE && sameStyle(r, self, other) ? 1 : 0);
  def(STYLE, 'hashCode', '()I', (r, _m, [self]) => { const s = styleOf(r, self); return (31 * (31 + s.weight) + s.slant) | 0; });
  def(STYLE, 'toString', `()${STRING}`, (r, _m, [self]) => { const s = styleOf(r, self); return `FontStyle { weight=${s.weight}, slant=${s.slant}}`; });

  // ---- FontVariationAxis ----------------------------------------------------------------------------------------------------------------------
  type(AXIS, OBJECT, [], { allocatable: true });
  const axisOf = (r, ref) => r.object(ref).fontAxis ?? npe(r, 'FontVariationAxis used before construction');
  const validTag = tag => typeof tag === 'string' && /^[ -~]{4}$/.test(tag);
  const makeAxis = (r, tag, value) => {
    if (!validTag(tag)) iae(r, 'Illegal tag pattern: ' + tag);
    const self = r.allocate(AXIS); r.object(self).fontAxis = { tag, value }; return self;
  };
  def(AXIS, '<init>', `(${STRING}F)V`, (r, _m, [self, tag, bits]) => { const t = text(r, tag); if (!validTag(t)) iae(r, 'Illegal tag pattern: ' + t); r.object(self).fontAxis = { tag: t, value: bitsFloat(bits) }; });
  def(AXIS, 'getOpenTypeTagValue', '()I', (r, _m, [self]) => tagToInt(axisOf(r, self).tag));
  def(AXIS, 'getTag', `()${STRING}`, (r, _m, [self]) => axisOf(r, self).tag);
  def(AXIS, 'getStyleValue', '()F', (r, _m, [self]) => floatBits(axisOf(r, self).value));
  def(AXIS, 'toString', `()${STRING}`, (r, _m, [self]) => { const a = axisOf(r, self); return `'${a.tag}' ${javaFloat(r, floatBits(a.value))}`; });
  def(AXIS, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => other === self || other !== null && typeof other === 'object' && r.typeOf(other) === AXIS && axisOf(r, self).tag === axisOf(r, other).tag && Math.fround(axisOf(r, self).value) === Math.fround(axisOf(r, other).value) ? 1 : 0);
  def(AXIS, 'hashCode', '()I', (r, _m, [self]) => { const a = axisOf(r, self); return (31 * (31 + tagToInt(a.tag)) + floatBits(a.value)) | 0; });
  def(AXIS, 'makeTag', `(${STRING})I`, (r, _m, [tag]) => tagToInt(text(r, tag)), { static: true });
  /** FontVariationAxis.fromFontVariationSettings: null for null / empty / no axes, IllegalArgumentException for malformed text. */
  const parseSettings = (r, settings) => {
    if (settings === null || settings === undefined) return null;
    const s = text(r, settings); if (s === '') return null;
    const axes = [], length = s.length;
    for (let i = 0; i < length; i++) {
      const c = s[i];
      if (/\s/.test(c)) continue;
      if (!(c === "'" || c === '"') || length < i + 6 || s[i + 5] !== c) iae(r, 'Tag should be wrapped with double or single quote: ' + s);
      const tag = s.slice(i + 1, i + 5); i += 6;
      let end = s.indexOf(',', i); if (end === -1) end = length;
      let value;
      try { value = bitsFloat(callStatic(r, 'Ljava/lang/Float;', 'parseFloat', [STRING], 'F', [s.slice(i, end)])); }
      catch (error) { if (isJava(error, r, 'Ljava/lang/NumberFormatException;')) iae(r, 'Failed to parse float string: ' + r.object(error.value).message); throw error; }
      axes.push({ tag, value }); i = end;
    }
    return axes.length ? axes : null;
  };
  const axisArray = (r, axes) => { const array = r.newArray(`[${AXIS}`, axes.length); r.array(array).elements = axes.map(a => makeAxis(r, a.tag, a.value)); return array; };
  const axesOfArray = (r, array) => array === null ? null : r.array(array).elements.map(ref => ref === null ? npe(r, null) : axisOf(r, ref));
  const settingsString = (r, axes) => (axes ?? []).map(a => `'${a.tag}' ${javaFloat(r, floatBits(a.value))}`).join(',');
  def(AXIS, 'fromFontVariationSettings', `(${STRING})[${AXIS}`, (r, _m, [settings]) => { const axes = parseSettings(r, settings); return axes === null ? null : axisArray(r, axes); }, { static: true });
  def(AXIS, 'toFontVariationSettings', `([${AXIS})${STRING}`, (r, _m, [axes]) => settingsString(r, axesOfArray(r, axes)), { static: true });
  def(AXIS, 'toFontVariationSettings', `(${LIST})${STRING}`, (r, _m, [list]) => {
    if (list === null) return '';
    const size = call(r, list, LIST, 'size', [], 'I'), axes = []; for (let i = 0; i < size; i++) axes.push(axisOf(r, call(r, list, LIST, 'get', ['I'], OBJECT, [i])));
    return settingsString(r, axes);
  }, { static: true });

  // ---- sources of font bytes ------------------------------------------------------------------------------------------------------------------
  /** A direct read-only ByteBuffer over `bytes` (what Font.getBuffer answers). */
  const directBuffer = (r, bytes) => {
    const buffer = callStatic(r, BUFFER, 'allocateDirect', ['I'], BUFFER, [bytes.length]), array = r.newArray('[B', bytes.length);
    r.array(array).elements = Array.from(bytes, v => (v << 24) >> 24);
    call(r, buffer, BUFFER, 'put', ['[B'], BUFFER, [array]); call(r, buffer, BUFFER, 'rewind', [], 'Ljava/nio/Buffer;');
    return call(r, buffer, BUFFER, 'asReadOnlyBuffer', [], BUFFER);
  };
  const failure = (type, message) => ({ cause: { type, message } });
  const readFile = (r, file) => {
    if (file === null) npe(r, 'path can not be null');
    const path = text(r, call(r, file, FILE, 'getPath', [], STRING)), bytes = platform.javaIo.fs().bytes(path);
    return bytes === null ? { file, ...failure('Ljava/io/FileNotFoundException;', `${path}: open failed: ENOENT (No such file or directory)`) } : { bytes, file };
  };
  const readAsset = (r, manager, name, isAsset) => {
    if (manager === null) npe(r, 'assetManager can not be null');
    if (name === null) npe(r, 'path can not be null');
    const path = text(r, name), entry = isAsset ? 'assets/' + path.replace(/^\/+/, '') : path;
    if (!r.apkEntries.has(entry)) return failure('Ljava/io/FileNotFoundException;', (isAsset ? 'Asset file: ' : 'Asset absolute file: ') + path);
    return { bytes: r.apkReader(entry), file: null };
  };
  const readBuffer = (r, buffer) => {
    if (buffer === null) npe(r, 'buffer can not be null');
    if (!call(r, buffer, BUFFER, 'isDirect', [], 'Z')) iae(r, 'Only direct buffer can be used as the source of font data.');
    const copy = call(r, buffer, BUFFER, 'duplicate', [], BUFFER), n = call(r, copy, BUFFER, 'remaining', [], 'I'), array = r.newArray('[B', n);
    call(r, copy, BUFFER, 'get', ['[B'], BUFFER, [array]);
    return { bytes: Uint8Array.from(r.array(array).elements, v => v & 255), file: null };
  };
  const readDescriptor = (r, pfd, offset, size) => {
    if (pfd === null) npe(r, null);
    const stream = construct(r, 'Ljava/io/FileInputStream;', [FD], [call(r, pfd, PFD, 'getFileDescriptor', [], FD)]), chunks = [], block = r.newArray('[B', 65536);
    try {
      for (;;) { const n = call(r, stream, 'Ljava/io/FileInputStream;', 'read', ['[B', 'I', 'I'], 'I', [block, 0, 65536]); if (n < 0) break; chunks.push(r.bytesOf(block, 0, n).slice()); }
    } catch (error) { if (isJava(error, r, IOEXCEPTION)) return failure(r.typeOf(error.value), r.object(error.value).message ?? ''); throw error; }
    const all = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0)); let at = 0; for (const c of chunks) { all.set(c, at); at += c.length; }
    const start = Number(offset), count = Number(size) === -1 ? all.length - start : Number(size);
    return { bytes: all.slice(start, start + count), file: null };
  };
  const resourcePath = (r, resources, id) => {
    let resolved; try { resolved = platform.resources?.resolve(id) ?? { kind: 'unresolved' }; } catch { resolved = { kind: 'unresolved' }; }
    if (resolved.kind === 'unresolved' || resolved.kind === 'bag') r.throwJava(NOT_FOUND, `Resource ID #0x${(id >>> 0).toString(16)}`);
    return resolved.kind === 'string' ? resolved.value : null;
  };
  const readResource = (r, resources, id) => {
    const path = resourcePath(r, resources, id);
    if (path === null) return failure('Ljava/io/FileNotFoundException;', `${id} not found`);
    if (path.toLowerCase().endsWith('.xml')) return failure('Ljava/io/FileNotFoundException;', `${id} must be font file.`);
    return readAsset(r, call(r, resources, RESOURCES, 'getAssets', [], ASSETS), path, false);
  };

  // ---- Font / Font.Builder ----------------------------------------------------------------------------------------------------------------------
  type(FONT, OBJECT, [], { allocatable: true }); type(FONT_BUILDER, OBJECT, [], { allocatable: true });
  const builderOf = (r, self) => r.object(self).fontBuilder ?? npe(r, 'Font.Builder used before construction');
  const init = (r, self, source) => { r.object(self).fontBuilder = { source, weight: -1, italic: -1, ttc: 0, axes: null, font: null }; };
  def(FONT_BUILDER, '<init>', `(${FILE})V`, (r, _m, [self, file]) => init(r, self, readFile(r, file)));
  def(FONT_BUILDER, '<init>', `(${FILE}${STRING})V`, (r, _m, [self, file]) => init(r, self, readFile(r, file)));
  def(FONT_BUILDER, '<init>', `(${ASSETS}${STRING})V`, (r, _m, [self, manager, path]) => init(r, self, readAsset(r, manager, path, true)));
  def(FONT_BUILDER, '<init>', `(${ASSETS}${STRING}ZI)V`, (r, _m, [self, manager, path, isAsset]) => init(r, self, readAsset(r, manager, path, flag(isAsset))));
  def(FONT_BUILDER, '<init>', `(${BUFFER})V`, (r, _m, [self, buffer]) => init(r, self, readBuffer(r, buffer)));
  def(FONT_BUILDER, '<init>', `(${BUFFER}${FILE}${STRING})V`, (r, _m, [self, buffer, file]) => init(r, self, { ...readBuffer(r, buffer), file }));
  def(FONT_BUILDER, '<init>', `(${PFD})V`, (r, _m, [self, pfd]) => init(r, self, readDescriptor(r, pfd, 0, -1)));
  def(FONT_BUILDER, '<init>', `(${PFD}JJ)V`, (r, _m, [self, pfd, offset, size]) => init(r, self, readDescriptor(r, pfd, offset, size)));
  def(FONT_BUILDER, '<init>', `(${RESOURCES}I)V`, (r, _m, [self, resources, id]) => init(r, self, readResource(r, resources, id)));
  def(FONT_BUILDER, '<init>', `(${FONT})V`, (r, _m, [self, font]) => {
    if (font === null) npe(r, null); const d = fontOf(r, font);
    init(r, self, { bytes: d.bytes, file: d.file }); Object.assign(builderOf(r, self), { weight: d.weight, italic: d.slant, ttc: d.ttc, axes: d.axes.slice(), font });
  });
  def(FONT_BUILDER, 'createBuffer', `(${ASSETS}${STRING}ZI)${BUFFER}`, (r, _m, [manager, path, isAsset]) => {
    const source = readAsset(r, manager, path, flag(isAsset));
    if (source.cause) r.throwJava(source.cause.type, source.cause.message);
    return directBuffer(r, source.bytes);
  }, { static: true });
  def(FONT_BUILDER, 'setWeight', `(I)${FONT_BUILDER}`, (r, _m, [self, weight]) => { if (weight < 1 || weight > 1000) iae(r, null); builderOf(r, self).weight = weight; return self; });
  def(FONT_BUILDER, 'setSlant', `(I)${FONT_BUILDER}`, (r, _m, [self, slant]) => { builderOf(r, self).italic = slant === 0 ? 0 : 1; return self; });
  def(FONT_BUILDER, 'setTtcIndex', `(I)${FONT_BUILDER}`, (r, _m, [self, index]) => { builderOf(r, self).ttc = index; return self; });
  def(FONT_BUILDER, 'setFontVariationSettings', `(${STRING})${FONT_BUILDER}`, (r, _m, [self, settings]) => { builderOf(r, self).axes = parseSettings(r, settings); return self; });
  def(FONT_BUILDER, 'setFontVariationSettings', `([${AXIS})${FONT_BUILDER}`, (r, _m, [self, axes]) => { builderOf(r, self).axes = axesOfArray(r, axes)?.map(a => ({ ...a })) ?? null; return self; });

  /** Font.Builder.build(): the exception captured by the constructor, FontFileUtil.analyzeStyle for an unspecified weight / slant, then Font.cpp nBuild's checks. */
  const buildFontData = (r, state) => {
    const source = state.source;
    if (source.cause) throwWithCause(r, IOEXCEPTION, 'Failed to read font contents', source.cause);
    let { weight, italic } = state;
    if (weight === -1 || italic === -1) {
      const style = sfntStyle(source.bytes, state.ttc), axes = state.axes ?? [];
      let analysed = style ?? { weight: 400, italic: false };
      const wght = axes.find(a => a.tag === 'wght'), ital = axes.find(a => a.tag === 'ital');
      if (style && wght) analysed = { ...analysed, weight: Math.round(wght.value) };
      if (style && ital) analysed = { ...analysed, italic: ital.value >= 1 };
      if (weight === -1) weight = analysed.weight;
      if (italic === -1) italic = analysed.italic ? 1 : 0;
    }
    weight = Math.max(1, Math.min(1000, weight));
    const bytes = source.bytes;
    if (bytes.length === 0) iae(r, 'buffer size must not be zero or negative');
    if (bytes.length > MAX_FONT_BYTES) iae(r, 'Failed to create internal object. maybe invalid font data.');
    const native = skiaHost(r).registerFontFile({ bytes, ttc: state.ttc });
    if (!native) iae(r, 'Failed to create internal object. maybe invalid font data.');
    return { bytes, file: source.file ?? null, weight, slant: italic ? 1 : 0, ttc: state.ttc, axes: (state.axes ?? []).map(a => ({ ...a })), native };
  };
  const newFont = (r, data) => { const font = r.allocate(FONT); r.object(font).fontData = data; return font; };
  def(FONT_BUILDER, 'build', `()${FONT}`, (r, _m, [self]) => newFont(r, buildFontData(r, builderOf(r, self))));
  const fontOf = (r, ref) => r.object(ref).fontData ?? npe(r, 'Font used before construction');
  def(FONT, 'getStyle', `()${STYLE}`, (r, _m, [self]) => { const d = fontOf(r, self); return d.styleRef ??= newStyle(r, d.weight, d.slant); });
  def(FONT, 'getTtcIndex', '()I', (r, _m, [self]) => fontOf(r, self).ttc);
  def(FONT, 'getFile', `()${FILE}`, (r, _m, [self]) => fontOf(r, self).file);
  def(FONT, 'getAxes', `()[${AXIS}`, (r, _m, [self]) => { const d = fontOf(r, self); return d.axesRef ??= axisArray(r, d.axes); });
  def(FONT, 'getBuffer', `()${BUFFER}`, (r, _m, [self]) => { const d = fontOf(r, self); return d.bufferRef ??= directBuffer(r, d.bytes); });
  def(FONT, 'getLocaleList', '()Landroid/os/LocaleList;', r => callStatic(r, 'Landroid/os/LocaleList;', 'getEmptyLocaleList', [], 'Landroid/os/LocaleList;'));
  def(FONT, 'getSourceIdentifier', '()I', (r, _m, [self]) => { let h = 17; const bytes = fontOf(r, self).bytes; for (let i = 0; i < bytes.length; i += Math.max(1, bytes.length >> 8)) h = (31 * h + bytes[i]) | 0; return (h ^ bytes.length) | 0; });
  const paramEquals = (r, a, b) => { const x = fontOf(r, a), y = fontOf(r, b); return x.weight === y.weight && x.slant === y.slant && x.ttc === y.ttc && settingsString(r, x.axes) === settingsString(r, y.axes) && (x.file === y.file || x.file !== null && y.file !== null && text(r, call(r, x.file, FILE, 'getPath', [], STRING)) === text(r, call(r, y.file, FILE, 'getPath', [], STRING))); };
  def(FONT, 'paramEquals', `(${FONT})Z`, (r, _m, [self, other]) => { if (other === null) npe(r, null); return paramEquals(r, self, other) ? 1 : 0; });
  const sameBytes = (a, b) => { if (a === b) return true; if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  def(FONT, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => other === self || other !== null && typeof other === 'object' && r.typeOf(other) === FONT && fontOf(r, self).native === fontOf(r, other).native && paramEquals(r, self, other) ? 1 : (other !== null && typeof other === 'object' && r.typeOf(other) === FONT && paramEquals(r, self, other) && sameBytes(fontOf(r, self).bytes, fontOf(r, other).bytes)) ? 1 : 0);
  def(FONT, 'hashCode', '()I', (r, _m, [self]) => { const d = fontOf(r, self); return (31 * (31 * (31 * (31 + d.weight * 31 + d.slant) + d.ttc) + d.axes.length) + 1) | 0; });
  def(FONT, 'toString', `()${STRING}`, (r, _m, [self]) => { const d = fontOf(r, self); return `Font {path=${d.file === null ? 'null' : text(r, call(r, d.file, FILE, 'getPath', [], STRING))}, style=FontStyle { weight=${d.weight}, slant=${d.slant}}, ttcIndex=${d.ttc}, axes=${settingsString(r, d.axes)}, localeList=[], buffer=java.nio.DirectByteBuffer[pos=0 lim=${d.bytes.length} cap=${d.bytes.length}]}`; });
  def(FONT, 'getAvailableFonts', '()Ljava/util/Set;', r => callStatic(r, 'Ljava/util/Collections;', 'emptySet', [], 'Ljava/util/Set;'), { static: true });
  // Font.getGlyphBounds / getMetrics: the font's own glyph geometry at the paint's text size (FreeType through Skia).
  def(FONT, 'getGlyphBounds', `(I${PAINT}${RECTF})F`, (r, _m, [self, glyph, paint, rect]) => {
    if (glyph < 0) iae(r, null);
    const d = fontOf(r, self), CK = r.skia.CanvasKit, size = bitsFloat(call(r, paint, PAINT, 'getTextSize', [], 'F')), font = new CK.Font(d.native.ck, size);
    try {
      const advance = font.getGlyphWidths([glyph])[0], box = font.getGlyphBounds([glyph]);
      if (rect !== null) { const f = r.object(rect).fields; f.set(`${RECTF}->left:F`, floatBits(box[0])); f.set(`${RECTF}->top:F`, floatBits(box[1])); f.set(`${RECTF}->right:F`, floatBits(box[2])); f.set(`${RECTF}->bottom:F`, floatBits(box[3])); }
      return floatBits(advance);
    } finally { font.delete(); }
  });
  def(FONT, 'getMetrics', `(${PAINT}Landroid/graphics/Paint$FontMetrics;)V`, (r, _m, [self, paint, out]) => {
    const d = fontOf(r, self), CK = r.skia.CanvasKit, size = bitsFloat(call(r, paint, PAINT, 'getTextSize', [], 'F')), font = new CK.Font(d.native.ck, size);
    try {
      const m = font.getMetrics(), f = r.object(out).fields, O = 'Landroid/graphics/Paint$FontMetrics;';
      f.set(`${O}->top:F`, floatBits(m.bounds ? m.bounds[1] : m.ascent)); f.set(`${O}->ascent:F`, floatBits(m.ascent)); f.set(`${O}->descent:F`, floatBits(m.descent)); f.set(`${O}->bottom:F`, floatBits(m.bounds ? m.bounds[3] : m.descent)); f.set(`${O}->leading:F`, floatBits(m.leading ?? 0));
    } finally { font.delete(); }
  });

  // ---- FontFamily / FontFamily.Builder ------------------------------------------------------------------------------------------------------------
  type(FAMILY, OBJECT, [], { allocatable: true }); type(FAMILY_BUILDER, OBJECT, [], { allocatable: true });
  const familyBuilder = (r, self) => r.object(self).familyBuilder ?? npe(r, 'FontFamily.Builder used before construction');
  const styleKey = (r, font) => { const d = fontOf(r, font); return d.weight | (d.slant << 16); };
  const addFont = (r, state, font) => {
    if (font === null) npe(r, 'font can not be null');
    const key = styleKey(r, font);
    if (state.keys.has(key)) iae(r, `${stringOf(r, call(r, font, OBJECT, 'toString', [], STRING))} has already been added`);
    state.keys.add(key); state.fonts.push(font);
  };
  def(FAMILY_BUILDER, '<init>', `(${FONT})V`, (r, _m, [self, font]) => { if (font === null) npe(r, 'font can not be null'); const state = r.object(self).familyBuilder = { fonts: [], keys: new Set() }; state.keys.add(styleKey(r, font)); state.fonts.push(font); });
  def(FAMILY_BUILDER, 'addFont', `(${FONT})${FAMILY_BUILDER}`, (r, _m, [self, font]) => { addFont(r, familyBuilder(r, self), font); return self; });
  def(FAMILY_BUILDER, 'build', `()${FAMILY}`, (r, _m, [self]) => { const family = r.allocate(FAMILY); r.object(family).fontFamily = { fonts: familyBuilder(r, self).fonts.slice() }; return family; });
  def(FAMILY_BUILDER, 'build', `(${STRING}IZ)${FAMILY}`, (r, _m, [self]) => { const family = r.allocate(FAMILY); r.object(family).fontFamily = { fonts: familyBuilder(r, self).fonts.slice() }; return family; });
  const familyOf = (r, ref) => r.object(ref).fontFamily ?? npe(r, 'FontFamily used before construction');
  def(FAMILY, 'getSize', '()I', (r, _m, [self]) => familyOf(r, self).fonts.length);
  def(FAMILY, 'getFont', `(I)${FONT}`, (r, _m, [self, index]) => { const fonts = familyOf(r, self).fonts; if (index < 0 || index >= fonts.length) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', null); return fonts[index]; });
  def(FAMILY, 'getLangTags', `()${STRING}`, () => '');
  def(FAMILY, 'getVariant', '()I', () => 0);
  /** The chain entry of a FontFamily for the Skia host: every font with its style and variation coordinates. */
  const familySpec = (r, family) => familyOf(r, family).fonts.map(font => { const d = fontOf(r, font); return { file: d.native, weight: d.weight, italic: d.slant === 1, axes: d.axes.map(a => ({ tag: a.tag, value: a.value })) }; });

  // ---- Typeface.CustomFallbackBuilder -------------------------------------------------------------------------------------------------------------
  type(CFB, OBJECT, [], { allocatable: true });
  const cfb = (r, self) => r.object(self).customBuilder ?? npe(r, 'Typeface.CustomFallbackBuilder used before construction');
  def(CFB, '<init>', `(${FAMILY})V`, (r, _m, [self, family]) => { if (family === null) npe(r, null); r.object(self).customBuilder = { families: [family], style: null, system: null }; });
  def(CFB, 'getMaxCustomFallbackCount', '()I', () => MAX_FALLBACK, { static: true });
  def(CFB, 'setStyle', `(${STYLE})${CFB}`, (r, _m, [self, style]) => { cfb(r, self).style = style === null ? null : styleOf(r, style); return self; });
  def(CFB, 'setSystemFallback', `(${STRING})${CFB}`, (r, _m, [self, name]) => { if (name === null) npe(r, null); cfb(r, self).system = text(r, name); return self; });
  def(CFB, 'addCustomFallback', `(${FAMILY})${CFB}`, (r, _m, [self, family]) => {
    if (family === null) npe(r, null); const state = cfb(r, self);
    if (state.families.length >= MAX_FALLBACK) iae(r, `Custom fallback limit exceeded(${MAX_FALLBACK})`);
    state.families.push(family); return self;
  });
  const buildCustom = (r, state, style) => {
    const weight = style === null ? 400 : style.weight, italic = style !== null && style.slant !== 0;
    return skiaHost(r).customTypeface({ families: state.families.map(family => familySpec(r, family)), weight, italic });
  };
  def(CFB, 'build', `()${TYPEFACE}`, (r, _m, [self]) => { const state = cfb(r, self); return buildCustom(r, state, state.style); });

  // ---- Typeface.Builder ---------------------------------------------------------------------------------------------------------------------------
  type(TB, OBJECT, [], { allocatable: true });
  const tb = (r, self) => r.object(self).typefaceBuilder ?? npe(r, 'Typeface.Builder used before construction');
  const initTb = (r, self, fontBuilder, manager = null, path = null) => { r.object(self).typefaceBuilder = { fontBuilder, manager, path, weight: -1, italic: -1, fallback: null }; };
  const newFile = (r, path) => construct(r, FILE, [STRING], [path]);
  def(TB, '<init>', `(${FILE})V`, (r, _m, [self, file]) => initTb(r, self, construct(r, FONT_BUILDER, [FILE], [file])));
  def(TB, '<init>', `(${STRING})V`, (r, _m, [self, path]) => initTb(r, self, construct(r, FONT_BUILDER, [FILE], [newFile(r, path)])));
  def(TB, '<init>', `(${ASSETS}${STRING})V`, (r, _m, [self, manager, path]) => initTb(r, self, construct(r, FONT_BUILDER, [ASSETS, STRING, 'Z', 'I'], [manager, path, 1, 0]), manager, path));
  def(TB, '<init>', `(${ASSETS}${STRING}ZI)V`, (r, _m, [self, manager, path, isAsset, cookie]) => initTb(r, self, construct(r, FONT_BUILDER, [ASSETS, STRING, 'Z', 'I'], [manager, path, isAsset, cookie]), manager, path));
  def(TB, '<init>', `(${FD})V`, (r, _m, [self, fd]) => {
    let builder = null;
    try { builder = construct(r, FONT_BUILDER, [PFD], [callStatic(r, PFD, 'dup', [FD], PFD, [fd])]); } catch (error) { if (!isJava(error, r, IOEXCEPTION)) throw error; }
    initTb(r, self, builder);
  });
  def(TB, 'setWeight', `(I)${TB}`, (r, _m, [self, weight]) => { const s = tb(r, self); s.weight = weight; call(r, s.fontBuilder, FONT_BUILDER, 'setWeight', ['I'], FONT_BUILDER, [weight]); return self; });
  def(TB, 'setItalic', `(Z)${TB}`, (r, _m, [self, italic]) => { const s = tb(r, self); s.italic = flag(italic) ? 1 : 0; call(r, s.fontBuilder, FONT_BUILDER, 'setSlant', ['I'], FONT_BUILDER, [s.italic]); return self; });
  def(TB, 'setTtcIndex', `(I)${TB}`, (r, _m, [self, index]) => { call(r, tb(r, self).fontBuilder, FONT_BUILDER, 'setTtcIndex', ['I'], FONT_BUILDER, [index]); return self; });
  def(TB, 'setFontVariationSettings', `(${STRING})${TB}`, (r, _m, [self, settings]) => { call(r, tb(r, self).fontBuilder, FONT_BUILDER, 'setFontVariationSettings', [STRING], FONT_BUILDER, [settings]); return self; });
  def(TB, 'setFontVariationSettings', `([${AXIS})${TB}`, (r, _m, [self, axes]) => { call(r, tb(r, self).fontBuilder, FONT_BUILDER, 'setFontVariationSettings', [`[${AXIS}`], FONT_BUILDER, [axes]); return self; });
  def(TB, 'setFallback', `(${STRING})${TB}`, (r, _m, [self, name]) => { tb(r, self).fallback = name === null ? null : text(r, name); return self; });
  const assetUid = (path, ttc, axes, weight, italic, fallback) => `${path}-${ttc}-${weight}-${italic}--${fallback}--${(axes ?? []).map(a => a.tag + '-' + a.value).join('')}`;
  const resolveFallback = (r, state) => {   // Typeface.Builder.resolveFallbackTypeface
    if (state.fallback === null) return null;
    const base = systemTypeface(r, state.fallback, 0);
    if (state.weight === -1 && state.italic === -1) return base;
    const weight = state.weight === -1 ? call(r, base, TYPEFACE, 'getWeight', [], 'I') : state.weight;
    const italic = state.italic === -1 ? flag(call(r, base, TYPEFACE, 'isItalic', [], 'Z')) : state.italic === 1;
    return callStatic(r, TYPEFACE, 'create', [TYPEFACE, 'I', 'Z'], TYPEFACE, [base, weight, italic ? 1 : 0]);
  };
  def(TB, 'build', `()${TYPEFACE}`, (r, _m, [self]) => {
    const state = tb(r, self);
    if (state.fontBuilder === null) return resolveFallback(r, state);
    try {
      const fb = builderOf(r, state.fontBuilder), data = buildFontData(r, fb), key = state.manager === null ? null : assetUid(text(r, state.path), data.ttc, data.axes, state.weight, state.italic, state.fallback ?? DEFAULT_FAMILY);
      if (key !== null && dynamicCache.has(key)) return dynamicCache.get(key);
      const weight = state.weight === -1 ? data.weight : state.weight, slant = state.italic === -1 ? data.slant : state.italic;
      const typeface = skiaHost(r).customTypeface({ families: [[{ file: data.native, weight: data.weight, italic: data.slant === 1, axes: data.axes.map(a => ({ tag: a.tag, value: a.value })) }]], weight, italic: slant === 1 });
      if (key !== null) dynamicCache.set(key, typeface);
      return typeface;
    } catch (error) {
      if (!isJava(error, r, IOEXCEPTION, IAE)) throw error;
      return resolveFallback(r, state);
    }
  });

  // ---- Typeface statics -----------------------------------------------------------------------------------------------------------------------------
  const buildWith = (r, parameters, args) => { const builder = construct(r, TB, parameters, args); return call(r, builder, TB, 'build', [], TYPEFACE); };
  def(TYPEFACE, 'createFromAsset', `(${ASSETS}${STRING})${TYPEFACE}`, (r, _m, [manager, path]) => {
    if (path === null) npe(r, null); if (manager === null) npe(r, null);
    const face = buildWith(r, [ASSETS, STRING], [manager, path]); if (face !== null) return face;
    if (!r.apkEntries.has('assets/' + text(r, path).replace(/^\/+/, ''))) r.throwJava('Ljava/lang/RuntimeException;', `Font asset not found ${text(r, path)}`);
    return defaultTypeface(r);
  }, { static: true });
  const fromFile = (r, file) => {
    if (file === null) npe(r, null);
    const face = buildWith(r, [FILE], [file]); if (face !== null) return face;
    if (!call(r, file, FILE, 'exists', [], 'Z')) r.throwJava('Ljava/lang/RuntimeException;', `Font asset not found ${text(r, call(r, file, FILE, 'getAbsolutePath', [], STRING))}`);
    return defaultTypeface(r);
  };
  def(TYPEFACE, 'createFromFile', `(${FILE})${TYPEFACE}`, (r, _m, [file]) => fromFile(r, file), { static: true });
  def(TYPEFACE, 'createFromFile', `(${STRING})${TYPEFACE}`, (r, _m, [path]) => { if (path === null) npe(r, null); return fromFile(r, newFile(r, path)); }, { static: true });
  def(TYPEFACE, 'findFromCache', `(${ASSETS}${STRING})${TYPEFACE}`, (r, _m, [, path]) => dynamicCache.get(assetUid(text(r, path), 0, null, -1, -1, DEFAULT_FAMILY)) ?? null, { static: true });
  def(TYPEFACE, 'hasFontFamily', `(${STRING})Z`, (r, _m, [name]) => { if (name === null) npe(r, null); return SYSTEM_FAMILIES.has(text(r, name)) ? 1 : 0; }, { static: true });
  def(TYPEFACE, 'createFromTypefaceWithVariation', `(${TYPEFACE}${LIST})${TYPEFACE}`, (r, _m, [family, list]) => {
    const size = call(r, list, LIST, 'size', [], 'I'), axes = []; for (let i = 0; i < size; i++) axes.push(axisOf(r, call(r, list, LIST, 'get', ['I'], OBJECT, [i])));
    return skiaHost(r).variationTypeface(family ?? defaultTypeface(r), axes) ?? family ?? defaultTypeface(r);
  }, { static: true });

  // ---- Resources.getFont / ResourcesImpl.loadFont / FontResourcesParser -----------------------------------------------------------------------------
  const attrString = (attribute) => attribute === undefined ? null : attribute.kind === 'string' ? attribute.value : attribute.kind === 'reference' ? (attribute.resolved?.kind === 'string' ? attribute.resolved.value : null) : null;
  const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
  /** FontResourcesParser.parse over the compiled font-family XML: a provider entry, a files entry, or null (no <font-family>, no usable <font>). Only android:-namespaced attributes belong to the framework styleables. */
  const parseFamily = (r, resources, tree) => {
    if (tree.name !== 'font-family') return null;
    const own = (node, name) => node.attributes.find(a => a.name === name && a.namespace === ANDROID_NS);
    const authority = attrString(own(tree, 'fontProviderAuthority')), providerPackage = attrString(own(tree, 'fontProviderPackage')), query = attrString(own(tree, 'fontProviderQuery'));
    if (authority !== null && providerPackage !== null && query !== null) return { kind: 'provider', authority, package: providerPackage, query, systemFamily: attrString(own(tree, 'fontProviderSystemFontFamily')) };
    const fonts = [];
    for (const child of tree.children ?? []) {
      if (child.name !== 'font') continue;
      const file = attrString(own(child, 'font')); if (file === null) continue;
      const int = (name, fallback) => { const a = own(child, name); return a && typeof a.value === 'number' ? a.value | 0 : fallback; };
      fonts.push({ file, weight: int('fontWeight', RESOLVE_BY_FONT_TABLE), italic: int('fontStyle', RESOLVE_BY_FONT_TABLE), variation: attrString(own(child, 'fontVariationSettings')), ttc: int('ttcIndex', 0) });
    }
    return fonts.length ? { kind: 'files', fonts } : null;
  };
  /** Typeface.createFromResources(FamilyResourceEntry, AssetManager, path). */
  const createFromEntry = (r, resources, entry, path) => {
    if (entry.kind === 'provider') {
      if (entry.systemFamily !== null && SYSTEM_FAMILIES.has(entry.systemFamily)) return systemTypeface(r, entry.systemFamily, 0);
      return defaultTypeface(r);   // FontsContract.getFontSync finds no provider in the VM and answers null, which createFromResources turns into DEFAULT
    }
    const key = assetUid(path, 0, null, -1, -1, DEFAULT_FAMILY);
    if (dynamicCache.has(key)) return dynamicCache.get(key);
    let typeface;
    try {
      const manager = call(r, resources, RESOURCES, 'getAssets', [], ASSETS), fonts = [], styles = new Set();
      for (const file of entry.fonts) {
        const state = { source: readAsset(r, manager, file.file, false), weight: file.weight, italic: file.italic === RESOLVE_BY_FONT_TABLE ? -1 : file.italic === 1 ? 1 : 0, ttc: file.ttc, axes: parseSettings(r, file.variation) };
        if (state.weight !== -1 && (state.weight < 1 || state.weight > 1000)) iae(r, null);
        const data = buildFontData(r, state), id = data.weight | (data.slant << 16);
        if (styles.has(id)) iae(r, 'font has already been added');
        styles.add(id); fonts.push(data);
      }
      let best = fonts[0], bestScore = Math.trunc(Math.abs(400 - best.weight) / 100) + (best.slant === 0 ? 0 : 2);
      for (const candidate of fonts.slice(1)) { const score = Math.trunc(Math.abs(400 - candidate.weight) / 100) + (candidate.slant === 0 ? 0 : 2); if (score < bestScore) { best = candidate; bestScore = score; } }
      typeface = skiaHost(r).customTypeface({ families: [fonts.map(d => ({ file: d.native, weight: d.weight, italic: d.slant === 1, axes: d.axes.map(a => ({ tag: a.tag, value: a.value })) }))], weight: best.weight, italic: best.slant === 1 });
    } catch (error) {
      if (isJava(error, r, IAE)) return null;
      if (!isJava(error, r, IOEXCEPTION)) throw error;
      typeface = defaultTypeface(r);
    }
    dynamicCache.set(key, typeface);
    return typeface;
  };
  /** ResourcesImpl.loadFont for a resolved resource value: null when the value is no file under res/. */
  const loadFont = (r, resources, id, path) => {
    if (path === null) r.throwJava(NOT_FOUND, `Resource "${id}" (${(id >>> 0).toString(16)}) is not a Font`);
    if (!path.startsWith('res/')) return null;
    const cached = dynamicCache.get(assetUid(path, 0, null, -1, -1, DEFAULT_FAMILY)); if (cached) return cached;
    if (path.endsWith('xml')) {
      let tree; try { tree = platform.resources.getXml(id); } catch { return null; }
      const entry = parseFamily(r, resources, tree); if (entry === null) return null;
      return createFromEntry(r, resources, entry, path);
    }
    const manager = call(r, resources, RESOURCES, 'getAssets', [], ASSETS);
    return buildWith(r, [ASSETS, STRING, 'Z', 'I'], [manager, path, 0, 0]);
  };
  def(RESOURCES, 'getFont', `(I)${TYPEFACE}`, (r, _m, [resources, id]) => {
    const typeface = loadFont(r, resources, id, resourcePath(r, resources, id));
    if (typeface !== null && typeface !== undefined) return typeface;
    r.throwJava(NOT_FOUND, `Font resource ID #0x${(id >>> 0).toString(16)}`);
  });
  def(RESOURCES, 'getFont', `(${TYPED_VALUE}I)${TYPEFACE}`, (r, _m, [resources, value, id]) => {   // Resources.getFont(TypedValue, int): TypedArray.getFont's door
    const string = value === null ? null : r.object(value).fields.get(`${TYPED_VALUE}->string:Ljava/lang/CharSequence;`) ?? null;
    return loadFont(r, resources, id, string === null ? null : text(r, string) ?? text(r, call(r, string, 'Ljava/lang/Object;', 'toString', [], STRING)));
  });

  // ---- TextView font attributes (TextView.setTypefaceFromAttrs / resolveStyleAndSetTypeface) ----------------------------------------------------------
  /**
   * TextView's android:fontFamily: a font resource (a file or a font-family XML) loads through Resources.getFont; any other value is a family name looked up in the system font map.
   * Returns { typeface, familyName } with at most one set (TextView: mFontTypeface from TypedArray.getFont, else mFontFamily from getString).
   */
  const fontFamilyAttribute = (r, resources, attribute) => {
    if (attribute.kind === 'reference' && attribute.reference) {
      let path = null; try { const resolved = platform.resources.resolve(attribute.reference); path = resolved.kind === 'string' ? resolved.value : null; } catch { path = null; }
      if (path !== null && path.startsWith('res/')) {
        try { const typeface = loadFont(r, resources, attribute.reference, path); if (typeface) return { typeface, familyName: null }; }
        catch (error) { if (!isJava(error, r, NOT_FOUND, 'Ljava/lang/UnsupportedOperationException;')) throw error; }
      }
      return { typeface: null, familyName: path };
    }
    return { typeface: null, familyName: attribute.kind === 'string' ? attribute.value : attrString(attribute) };
  };
  /** TextView.setTypefaceFromAttrs: family typeface or name, android:typeface index, textStyle bits and textFontWeight (-1 when unset). */
  const applyTextViewFont = (r, view, { typeface = null, familyName = null, typefaceIndex = -1, style = 0, weight = -1 }) => {
    let face = typeface;
    if (face === null && familyName !== null) face = systemTypeface(r, familyName, 0);
    else if (face === null) face = typefaceIndex === 1 ? r.readStatic({ owner: TYPEFACE, name: 'SANS_SERIF', type: TYPEFACE, key: `${TYPEFACE}->SANS_SERIF:${TYPEFACE}` }) : typefaceIndex === 2 ? r.readStatic({ owner: TYPEFACE, name: 'SERIF', type: TYPEFACE, key: `${TYPEFACE}->SERIF:${TYPEFACE}` }) : typefaceIndex === 3 ? r.readStatic({ owner: TYPEFACE, name: 'MONOSPACE', type: TYPEFACE, key: `${TYPEFACE}->MONOSPACE:${TYPEFACE}` }) : null;
    if (weight >= 0) call(r, view, 'Landroid/widget/TextView;', 'setTypeface', [TYPEFACE], 'V', [callStatic(r, TYPEFACE, 'create', [TYPEFACE, 'I', 'Z'], TYPEFACE, [face, Math.min(1000, weight), style & 2 ? 1 : 0])]);
    else call(r, view, 'Landroid/widget/TextView;', 'setTypeface', [TYPEFACE, 'I'], 'V', [face, style]);
  };
  return { ...registry, fontFamilyAttribute, applyTextViewFont, loadFont, parseFamily, parseVariationSettings: parseSettings };
}
