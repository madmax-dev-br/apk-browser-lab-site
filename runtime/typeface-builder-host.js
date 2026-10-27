import { createHostRegistry } from './host-contract.js?v=36ea061c5c9d';

// android.graphics.Typeface.Builder / Typeface.CustomFallbackBuilder and android.graphics.fonts.{Font, Font.Builder, FontFamily, FontFamily.Builder, FontStyle} (android-13.0.0_r1
// contracts). Font bytes come from the app's virtual filesystem (File), the APK's assets/ (AssetManager) or a ByteBuffer, are validated and shaped by Skia's FreeType, and the
// resulting Typeface is registered with the Skia canvas host (skiaHost.customTypeface), so Paint.setTypeface / measureText / drawText use the real font.
// Not supported, and refused with an explicit error instead of being approximated: TrueType collections with ttcIndex > 0, font variation settings, FileDescriptor and
// Resources sources, and custom fallback families (glyph fallback into app fonts is owned by the font-fallback itemizer).

const FONT = 'Landroid/graphics/fonts/Font;', FONT_BUILDER = 'Landroid/graphics/fonts/Font$Builder;', FAMILY = 'Landroid/graphics/fonts/FontFamily;', FAMILY_BUILDER = 'Landroid/graphics/fonts/FontFamily$Builder;';
const STYLE = 'Landroid/graphics/fonts/FontStyle;', AXIS = 'Landroid/graphics/fonts/FontVariationAxis;', TYPEFACE = 'Landroid/graphics/Typeface;', TB = 'Landroid/graphics/Typeface$Builder;', CFB = 'Landroid/graphics/Typeface$CustomFallbackBuilder;';
const FILE = 'Ljava/io/File;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', ASSETS = 'Landroid/content/res/AssetManager;', BUFFER = 'Ljava/nio/ByteBuffer;';
const WEIGHTS = { THIN: 100, EXTRA_LIGHT: 200, LIGHT: 300, NORMAL: 400, MEDIUM: 500, SEMI_BOLD: 600, BOLD: 700, EXTRA_BOLD: 800, BLACK: 900 };
const MAX_FONT_BYTES = 32 * 1024 * 1024;

/** usWeightClass and italic flag of an sfnt (OS/2, falling back to head.macStyle); null when the data is not a TrueType/OpenType font. */
export function sfntStyle(bytes, ttcIndex = 0) {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = String.fromCharCode(...bytes.subarray(0, 4));
  let base = 0;
  if (tag === 'ttcf') { const count = view.getUint32(8); if (ttcIndex >= count || 12 + 4 * ttcIndex + 4 > bytes.length) return null; base = view.getUint32(12 + 4 * ttcIndex); }
  else if (!['\0\u0001\0\0', 'OTTO', 'true', 'typ1'].includes(tag)) return null;
  if (base + 12 > bytes.length) return null;
  const tables = new Map(), count = view.getUint16(base + 4);
  for (let i = 0; i < count; i++) {
    const at = base + 12 + 16 * i; if (at + 16 > bytes.length) return null;
    tables.set(String.fromCharCode(...bytes.subarray(at, at + 4)), view.getUint32(at + 8));
  }
  const os2 = tables.get('OS/2'), head = tables.get('head');
  if (os2 !== undefined && os2 + 64 <= bytes.length) return { weight: view.getUint16(os2 + 4) || 400, italic: (view.getUint16(os2 + 62) & 0x201) !== 0 };
  if (head !== undefined && head + 46 <= bytes.length) { const mac = view.getUint16(head + 44); return { weight: mac & 1 ? 700 : 400, italic: (mac & 2) !== 0 }; }
  return { weight: 400, italic: false };
}

export function createTypefaceBuilderHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const text = (r, v) => v === null || v === undefined ? null : r.stringCharacters(v);
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const unsupported = (r, what) => r.throwJava('Ljava/lang/UnsupportedOperationException;', `${what} is not supported by the browser VM`);
  const npe = (r, what) => r.throwJava('Ljava/lang/NullPointerException;', what);
  const weightArg = (r, weight) => { if (weight < 1 || weight > 1000) r.throwJava('Ljava/lang/IllegalArgumentException;', `weight(${weight}) must be [1, 1000]`); return weight; };

  // ---- FontStyle ------------------------------------------------------------------------------------------------------------------------------
  type(STYLE, OBJECT, [], { allocatable: true });
  for (const [name, value] of Object.entries(WEIGHTS)) registry.staticField(STYLE, 'FONT_WEIGHT_' + name, 'I', () => value);
  registry.staticField(STYLE, 'FONT_WEIGHT_MIN', 'I', () => 1); registry.staticField(STYLE, 'FONT_WEIGHT_MAX', 'I', () => 1000);
  registry.staticField(STYLE, 'FONT_SLANT_UPRIGHT', 'I', () => 0); registry.staticField(STYLE, 'FONT_SLANT_ITALIC', 'I', () => 1);
  const initStyle = (r, self, weight, slant) => {
    if (weight < 1 || weight > 1000) r.throwJava('Ljava/lang/IllegalArgumentException;', `weight value must be [1, 1000], but got ${weight}`);
    if (slant !== 0 && slant !== 1) r.throwJava('Ljava/lang/IllegalArgumentException;', `slant value must be FONT_SLANT_UPRIGHT or FONT_SLANT_ITALIC, but got ${slant}`);
    Object.assign(r.object(self), { fontStyle: { weight, slant } });
  };
  const styleOf = (r, ref) => r.object(ref).fontStyle ?? { weight: 400, slant: 0 };
  const newStyle = (r, weight, slant) => { const style = r.allocate(STYLE); initStyle(r, style, weight, slant); return style; };
  def(STYLE, '<init>', '()V', (r, _m, [self]) => initStyle(r, self, 400, 0));
  def(STYLE, '<init>', '(II)V', (r, _m, [self, weight, slant]) => initStyle(r, self, weight, slant));
  def(STYLE, 'getWeight', '()I', (r, _m, [self]) => styleOf(r, self).weight); def(STYLE, 'getSlant', '()I', (r, _m, [self]) => styleOf(r, self).slant);
  def(STYLE, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => other !== null && typeof other === 'object' && r.typeOf(other) === STYLE && styleOf(r, self).weight === styleOf(r, other).weight && styleOf(r, self).slant === styleOf(r, other).slant ? 1 : 0);
  def(STYLE, 'hashCode', '()I', (r, _m, [self]) => { const s = styleOf(r, self); return (31 * (31 + s.weight) + s.slant) | 0; });
  def(STYLE, 'toString', `()${STRING}`, (r, _m, [self]) => { const s = styleOf(r, self); return `FontStyle { weight=${s.weight}, slant=${s.slant}}`; });

  // ---- FontVariationAxis (only the empty array is ever produced) --------------------------------------------------------------------------------
  type(AXIS, OBJECT, [], { allocatable: false });

  // ---- Font / Font.Builder ----------------------------------------------------------------------------------------------------------------------
  type(FONT, OBJECT, [], { allocatable: true }); type(FONT_BUILDER, OBJECT, [], { allocatable: true });
  const builderOf = (r, self) => r.object(self).fontBuilder ?? npe(r, 'Font.Builder used before construction');
  const readFile = (r, file) => {
    if (file === null) npe(r, 'file');
    const path = text(r, call(r, file, FILE, 'getPath', [], STRING)), bytes = platform.javaIo.fs().bytes(path);
    if (bytes === null) r.throwJava('Ljava/io/FileNotFoundException;', `${path} (No such file or directory)`);
    return { bytes, file };
  };
  const readAsset = (r, name) => {
    if (name === null) npe(r, 'path');
    const path = text(r, name).replace(/^\/+/, ''), entry = 'assets/' + path;
    if (!r.apkEntries.has(entry)) r.throwJava('Ljava/io/FileNotFoundException;', path);
    return { bytes: r.apkReader(entry), file: null };
  };
  const readBuffer = (r, buffer) => {
    if (buffer === null) npe(r, 'buffer');
    const copy = call(r, buffer, BUFFER, 'duplicate', [], BUFFER), n = call(r, copy, BUFFER, 'remaining', [], 'I'), array = r.newArray('[B', n);
    call(r, copy, BUFFER, 'get', ['[B'], BUFFER, [array]);
    return { bytes: Uint8Array.from(r.array(array).elements, v => v & 255), file: null, buffer };
  };
  const init = (r, self, source) => { r.object(self).fontBuilder = { source, weight: null, slant: null, ttc: 0, axes: false }; };
  def(FONT_BUILDER, '<init>', `(${FILE})V`, (r, _m, [self, file]) => init(r, self, () => readFile(r, file)));
  def(FONT_BUILDER, '<init>', `(${ASSETS}${STRING})V`, (r, _m, [self, , path]) => init(r, self, () => readAsset(r, path)));
  def(FONT_BUILDER, '<init>', `(${BUFFER})V`, (r, _m, [self, buffer]) => init(r, self, () => readBuffer(r, buffer)));
  def(FONT_BUILDER, '<init>', '(Ljava/io/FileDescriptor;)V', r => unsupported(r, 'Font.Builder(FileDescriptor)'));
  def(FONT_BUILDER, '<init>', '(Landroid/content/res/Resources;I)V', r => unsupported(r, 'Font.Builder(Resources, int)'));
  def(FONT_BUILDER, 'setWeight', `(I)${FONT_BUILDER}`, (r, _m, [self, weight]) => { builderOf(r, self).weight = weightArg(r, weight); return self; });
  def(FONT_BUILDER, 'setSlant', `(I)${FONT_BUILDER}`, (r, _m, [self, slant]) => {
    if (slant !== 0 && slant !== 1) r.throwJava('Ljava/lang/IllegalArgumentException;', `slant must be FONT_SLANT_UPRIGHT or FONT_SLANT_ITALIC, but got ${slant}`);
    builderOf(r, self).slant = slant; return self;
  });
  def(FONT_BUILDER, 'setTtcIndex', `(I)${FONT_BUILDER}`, (r, _m, [self, index]) => { if (index < 0) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'TTC index can not be negative.'); builderOf(r, self).ttc = index; return self; });
  def(FONT_BUILDER, 'setFontVariationSettings', `(${STRING})${FONT_BUILDER}`, (r, _m, [self, settings]) => { if (settings !== null && text(r, settings).trim() !== '') unsupported(r, 'Font variation settings'); return self; });
  def(FONT_BUILDER, 'setFontVariationSettings', `([${AXIS})${FONT_BUILDER}`, (r, _m, [self, axes]) => { if (axes !== null && r.array(axes).elements.length) unsupported(r, 'Font variation settings'); return self; });
  def(FONT_BUILDER, 'build', `()${FONT}`, (r, _m, [self]) => {
    const state = builderOf(r, self);
    if (state.ttc !== 0) unsupported(r, 'Font.Builder.setTtcIndex with a non-zero index');
    const { bytes, file, buffer } = state.source();
    if (bytes.length === 0 || bytes.length > MAX_FONT_BYTES) r.throwJava('Ljava/io/IOException;', 'Failed to read font: file is empty or too large');
    const style = sfntStyle(bytes, state.ttc);
    if (!style) r.throwJava('Ljava/io/IOException;', 'Failed to open font: the data is not a TrueType or OpenType font');
    const font = r.allocate(FONT);
    Object.assign(r.object(font), { fontData: { bytes, file, buffer: buffer ?? null, weight: state.weight ?? style.weight, slant: state.slant ?? (style.italic ? 1 : 0), ttc: state.ttc } });
    return font;
  });
  const fontOf = (r, ref) => r.object(ref).fontData ?? npe(r, 'Font used before construction');
  def(FONT, 'getStyle', `()${STYLE}`, (r, _m, [self]) => { const d = fontOf(r, self); return newStyle(r, d.weight, d.slant); });
  def(FONT, 'getTtcIndex', '()I', (r, _m, [self]) => fontOf(r, self).ttc);
  def(FONT, 'getFile', `()${FILE}`, (r, _m, [self]) => fontOf(r, self).file);
  def(FONT, 'getAxes', `()[${AXIS}`, r => r.newArray(`[${AXIS}`, 0));
  def(FONT, 'getBuffer', `()${BUFFER}`, (r, _m, [self]) => {
    const d = fontOf(r, self), array = r.newArray('[B', d.bytes.length); r.array(array).elements = Array.from(d.bytes, v => (v << 24) >> 24);
    const wrapped = r.dispatch({ owner: BUFFER, name: 'wrap', parameters: ['[B'], result: BUFFER, signature: `([B)${BUFFER}` }, [array], 'static');
    return call(r, wrapped, BUFFER, 'asReadOnlyBuffer', [], BUFFER);
  });

  // ---- FontFamily / FontFamily.Builder ------------------------------------------------------------------------------------------------------------
  type(FAMILY, OBJECT, [], { allocatable: true }); type(FAMILY_BUILDER, OBJECT, [], { allocatable: true });
  const familyBuilder = (r, self) => r.object(self).familyBuilder ?? npe(r, 'FontFamily.Builder used before construction');
  const addFont = (r, state, font) => {
    if (font === null) npe(r, 'font must not be null');
    const d = fontOf(r, font);
    if (state.fonts.some(f => { const e = fontOf(r, f); return e.weight === d.weight && e.slant === d.slant; })) r.throwJava('Ljava/lang/IllegalArgumentException;', 'New font and existing font are in conflict. New font and existing font have the same style.');
    state.fonts.push(font);
  };
  def(FAMILY_BUILDER, '<init>', `(${FONT})V`, (r, _m, [self, font]) => { const state = r.object(self).familyBuilder = { fonts: [] }; addFont(r, state, font); });
  def(FAMILY_BUILDER, 'addFont', `(${FONT})${FAMILY_BUILDER}`, (r, _m, [self, font]) => { addFont(r, familyBuilder(r, self), font); return self; });
  def(FAMILY_BUILDER, 'build', `()${FAMILY}`, (r, _m, [self]) => { const family = r.allocate(FAMILY); r.object(family).fontFamily = { fonts: familyBuilder(r, self).fonts.slice() }; return family; });
  const familyOf = (r, ref) => r.object(ref).fontFamily ?? npe(r, 'FontFamily used before construction');
  def(FAMILY, 'getSize', '()I', (r, _m, [self]) => familyOf(r, self).fonts.length);
  def(FAMILY, 'getFont', `(I)${FONT}`, (r, _m, [self, index]) => { const fonts = familyOf(r, self).fonts; if (index < 0 || index >= fonts.length) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', `Index: ${index}, Size: ${fonts.length}`); return fonts[index]; });

  // ---- Typeface creation (the Skia canvas host owns Typeface objects) ---------------------------------------------------------------------------------
  const typefaceFromFont = (r, fontRef, weight, italic) => {
    const d = fontOf(r, fontRef), host = r.skiaHost;
    if (!host?.customTypeface) r.throwJava('Ljava/lang/UnsupportedOperationException;', 'Custom typefaces need the Skia graphics backend');
    return host.customTypeface({ bytes: d.bytes, weight, italic });
  };
  const systemFallback = (r, name, weight, italic) => r.dispatch({ owner: TYPEFACE, name: 'create', parameters: [STRING, 'I'], result: TYPEFACE, signature: `(${STRING}I)${TYPEFACE}` }, [name, (weight >= 600 ? 1 : 0) | (italic ? 2 : 0)], 'static');

  // ---- Typeface.Builder ---------------------------------------------------------------------------------------------------------------------------
  type(TB, OBJECT, [], { allocatable: true });
  const tb = (r, self) => r.object(self).typefaceBuilder ?? npe(r, 'Typeface.Builder used before construction');
  const initTb = (r, self, source) => { r.object(self).typefaceBuilder = { source, weight: null, italic: null, ttc: 0, fallback: null }; };
  def(TB, '<init>', `(${FILE})V`, (r, _m, [self, file]) => initTb(r, self, () => readFile(r, file)));
  def(TB, '<init>', `(${STRING})V`, (r, _m, [self, path]) => {
    if (path === null) npe(r, 'path'); const file = r.allocate(FILE);
    r.dispatch({ owner: FILE, name: '<init>', parameters: [STRING], result: 'V', signature: `(${STRING})V` }, [file, path], 'direct'); initTb(r, self, () => readFile(r, file));
  });
  def(TB, '<init>', `(${ASSETS}${STRING})V`, (r, _m, [self, , path]) => initTb(r, self, () => readAsset(r, path)));
  def(TB, '<init>', '(Ljava/io/FileDescriptor;)V', r => unsupported(r, 'Typeface.Builder(FileDescriptor)'));
  def(TB, 'setWeight', `(I)${TB}`, (r, _m, [self, weight]) => { tb(r, self).weight = weightArg(r, weight); return self; });
  def(TB, 'setItalic', `(Z)${TB}`, (r, _m, [self, italic]) => { tb(r, self).italic = italic !== 0 && italic !== false; return self; });
  def(TB, 'setTtcIndex', `(I)${TB}`, (r, _m, [self, index]) => { if (index < 0) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', 'TTC index can not be negative.'); tb(r, self).ttc = index; return self; });
  def(TB, 'setFontVariationSettings', `(${STRING})${TB}`, (r, _m, [self, settings]) => { if (settings !== null && text(r, settings).trim() !== '') unsupported(r, 'Font variation settings'); return self; });
  def(TB, 'setFontVariationSettings', `([${AXIS})${TB}`, (r, _m, [self, axes]) => { if (axes !== null && r.array(axes).elements.length) unsupported(r, 'Font variation settings'); return self; });
  def(TB, 'setFallback', `(${STRING})${TB}`, (r, _m, [self, name]) => { tb(r, self).fallback = name; return self; });
  def(TB, 'build', `()${TYPEFACE}`, (r, _m, [self]) => {
    const state = tb(r, self);
    if (state.ttc !== 0) unsupported(r, 'Typeface.Builder.setTtcIndex with a non-zero index');
    let data;
    try { data = state.source(); }
    catch (error) {
      if (error?.name !== 'JavaException' || !['Ljava/io/FileNotFoundException;', 'Ljava/io/IOException;'].includes(r.typeOf(error.value))) throw error;
      return state.fallback === null ? null : systemFallback(r, state.fallback, state.weight ?? 400, state.italic ?? false);   // AOSP: resolveFallbackTypeface()
    }
    const style = sfntStyle(data.bytes, 0);
    if (!style || data.bytes.length === 0 || data.bytes.length > MAX_FONT_BYTES) return state.fallback === null ? null : systemFallback(r, state.fallback, state.weight ?? 400, state.italic ?? false);
    const face = r.skiaHost?.customTypeface?.({ bytes: data.bytes, weight: state.weight ?? style.weight, italic: state.italic ?? style.italic });
    if (face === undefined) r.throwJava('Ljava/lang/UnsupportedOperationException;', 'Custom typefaces need the Skia graphics backend');
    return face ?? (state.fallback === null ? null : systemFallback(r, state.fallback, state.weight ?? 400, state.italic ?? false));
  });

  // ---- Typeface.CustomFallbackBuilder -------------------------------------------------------------------------------------------------------------
  type(CFB, OBJECT, [], { allocatable: true });
  const cfb = (r, self) => r.object(self).customBuilder ?? npe(r, 'Typeface.CustomFallbackBuilder used before construction');
  def(CFB, '<init>', `(${FAMILY})V`, (r, _m, [self, family]) => { if (family === null) npe(r, 'family'); r.object(self).customBuilder = { family, style: null, system: null }; });
  def(CFB, 'setStyle', `(${STYLE})${CFB}`, (r, _m, [self, style]) => { if (style === null) npe(r, 'style'); cfb(r, self).style = styleOf(r, style); return self; });
  def(CFB, 'setSystemFallback', `(${STRING})${CFB}`, (r, _m, [self, name]) => { if (name === null) npe(r, 'familyName'); cfb(r, self).system = name; return self; });
  def(CFB, 'addCustomFallback', `(${FAMILY})${CFB}`, (r, _m, [self, family]) => { if (family === null) npe(r, 'family'); unsupported(r, 'Typeface.CustomFallbackBuilder.addCustomFallback (glyph fallback into app fonts)'); });
  def(CFB, 'build', `()${TYPEFACE}`, (r, _m, [self]) => {
    const state = cfb(r, self), want = state.style ?? { weight: 400, slant: 0 }, fonts = familyOf(r, state.family).fonts;
    let best = null, bestScore = Infinity;
    for (const font of fonts) { const d = fontOf(r, font), score = (d.slant === want.slant ? 0 : 1e6) + Math.abs(d.weight - want.weight); if (score < bestScore) { best = font; bestScore = score; } }
    if (best === null) r.throwJava('Ljava/lang/IllegalStateException;', 'FontFamily has no fonts');
    return typefaceFromFont(r, best, want.weight, want.slant === 1);
  });
  return registry;
}
