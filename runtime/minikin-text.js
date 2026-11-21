import { APKError } from './apk-error.js?v=e3ff4f2e305f';
import { systemFamilyFonts, DEFAULT_SYSTEM_FAMILY } from './system-fonts.js?v=e3ff4f2e305f';

// The virtual device's side of Minikin (src/minikin-provider.js): font collections built from the lab's Typeface state, the Paint state as hwui hands it to Minikin, and the
// MeasuredText / LineBreaker / Paint measurement calls of hwui's JNI (libs/hwui/jni/text/MeasuredText.cpp, LineBreaker.cpp, jni/Paint.cpp). Handles are wasm32 pointers kept
// on this side; the Java side only ever sees the checked tokens of src/text-layout-native.js.
//
// Fonts. A Typeface's collection is what Android builds for it (Typeface.cpp / SystemFonts.buildSystemFallback): the Typeface's own families, then for an app font the
// sans-serif family, then the fallback chain of fonts.xml in its order. Two font policies:
//  - 'drawing' (the default): the font files the lab's Skia backend draws the same Typeface with (the backend's Roboto faces for sans-serif at the weights it has, the
//    vendored system file otherwise, the app's own fonts, the vendored fallback chain), so text is measured with the glyphs that are drawn;
//  - 'android': sans-serif is Android 13's variable Roboto at every weight of fonts.xml (RobotoStatic-Regular.ttf, which is not vendored, is the variable font's default
//    instance it is cut from). Used to measure the font gap; see docs/ANDROID-GRAPHICS-NATIVES.md.
// A fallback file joins a collection only when the text has a code point in its coverage (the manifest's ranges): a family that covers nothing of the text never wins
// FontCollection::itemize, so the result is the full chain's, and the large files (CJK shards, colour emoji) are read only for text that uses them.
const fail = message => { throw new APKError(message, { kind: 'text-layout-backend-unsupported', backend: 'AOSP-Minikin-android-13.0.0_r1/Wasm' }); };
const tag = s => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
const inRanges = (ranges, cp) => { let lo = 0, hi = ranges.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1, r = ranges[mid]; if (cp < r[0]) hi = mid - 1; else if (cp > r[1]) lo = mid + 1; else return true; } return false; };
const ROBOTO_VARIABLE = 'Roboto-Regular.ttf', ROBOTO_STATIC = 'RobotoStatic-Regular.ttf';
const DEFAULT_INSTANCE = [{ tag: 'ital', value: 0 }, { tag: 'wdth', value: 100 }, { tag: 'wght', value: 400 }];
export const PAINT_BYTES = 64;

/**
 * `minikin`: the loaded module ({ api }). `fonts`: where font bytes come from —
 *   backendFaces: [{ weight, italic, bytes }] (the Skia backend's Roboto faces), systemBytes(file), manifest() (the fallback manifest), fallbackBytes(stem).
 */
export function createMinikinText(minikin, fonts, { policy = 'drawing' } = {}) {
  const api = minikin.api;
  const view = () => new DataView(api.memory.buffer);
  const malloc = size => { const p = api.mk_malloc(Math.max(4, size)); if (!p) fail('Minikin wasm heap exhausted'); return p; };
  const error = () => { const p = api.mk_last_error(), bytes = new Uint8Array(api.memory.buffer, p, 512), end = bytes.indexOf(0); return new TextDecoder().decode(bytes.subarray(0, end < 0 ? 512 : end)); };
  const cString = text => { const bytes = new TextEncoder().encode(text + '\0'), p = malloc(bytes.length); new Uint8Array(api.memory.buffer, p, bytes.length).set(bytes); return p; };
  const fatal = e => { if (e instanceof WebAssembly.RuntimeError) { const p = api.mk_fatal_message(), bytes = new Uint8Array(api.memory.buffer, p, 512), end = bytes.indexOf(0); fail('Minikin aborted: ' + (new TextDecoder().decode(bytes.subarray(0, end < 0 ? 512 : end)) || e.message)); } throw e; };
  /** Runs `body` inside the module, turning a Minikin abort (LOG_ALWAYS_FATAL) into an explicit error. */
  const guarded = body => { try { return body(); } catch (e) { return fatal(e); } };

  const locales = new Map();
  const localeList = tags => { const key = tags ?? ''; let id = locales.get(key); if (id === undefined) { const p = cString(key); try { id = api.mk_locale_list(p); } finally { api.mk_free(p); } locales.set(key, id); } return id; };

  const data = new Map(), fontHandles = new Map(), families = new Map(), collections = new Map();
  const dataFor = (key, read) => {
    let handle = data.get(key);
    if (handle === undefined) {
      const bytes = read(); if (!(bytes instanceof Uint8Array) || !bytes.length) fail('No font bytes for ' + key);
      const p = malloc(bytes.length); new Uint8Array(api.memory.buffer, p, bytes.length).set(bytes);
      handle = api.mk_data_new(p, bytes.length); if (!handle) fail('Minikin rejected font data ' + key + ': ' + error());
      data.set(key, handle);
    }
    return handle;
  };
  /** A Minikin Font (Font::Builder) over `dataKey` with variation `axes` [{ tag, value }] and the style fonts.xml / the app gives it. */
  const fontFor = (dataKey, read, { ttc = 0, axes = [], weight = 0, italic = -1 } = {}) => {
    const key = dataKey + '#' + ttc + '#' + axes.map(a => a.tag + '=' + a.value).join(',') + '#' + weight + '#' + italic;
    let handle = fontHandles.get(key);
    if (handle === undefined) {
      const dataHandle = dataFor(dataKey, read), tags = malloc(axes.length * 4), values = malloc(axes.length * 4);
      try {
        axes.forEach((axis, i) => { view().setUint32(tags + i * 4, tag(axis.tag.padEnd(4, ' ')), true); view().setFloat32(values + i * 4, axis.value, true); });
        handle = guarded(() => api.mk_font_new(dataHandle, ttc, tags, values, axes.length, weight, italic));
      } finally { api.mk_free(tags); api.mk_free(values); }
      if (!handle) fail('Minikin could not open font ' + dataKey + ': ' + error());
      fontHandles.set(key, handle);
    }
    return handle;
  };
  const familyFor = (key, makeFonts, { lang = '', variant = 0, customFallback = false } = {}) => {
    let handle = families.get(key);
    if (handle === undefined) {
      const list = makeFonts(), p = malloc(list.length * 4);
      try { list.forEach((font, i) => view().setInt32(p + i * 4, font, true)); handle = guarded(() => api.mk_family_new(p, list.length, localeList(lang), variant, customFallback ? 1 : 0)); }
      finally { api.mk_free(p); }
      if (!handle) fail('Minikin could not make font family ' + key + ': ' + error());
      families.set(key, handle);
    }
    return handle;
  };

  // ---- the families of a Typeface ----
  const systemFont = (file, axes, weight, italic) => {
    if (file === ROBOTO_STATIC) return fontFor('system:' + ROBOTO_VARIABLE, () => fonts.systemBytes(ROBOTO_VARIABLE), { axes: axes.length ? axes : DEFAULT_INSTANCE, weight, italic: italic ? 1 : 0 });
    return fontFor('system:' + file, () => fonts.systemBytes(file), { axes, weight, italic: italic ? 1 : 0 });
  };
  const axesOf = list => (list ?? []).map(v => ({ tag: v.axis ?? v.tag, value: v.value }));
  /** sans-serif: the backend's faces (policy 'drawing') or Android's family of fonts.xml. */
  const sansSerif = () => policy === 'drawing'
    ? familyFor('backend:sans-serif', () => fonts.backendFaces.map(face => fontFor('backend:' + face.weight + ':' + face.italic, () => face.bytes, { weight: face.weight, italic: face.italic ? 1 : 0 })))
    : familyFor('system:sans-serif', () => systemFamilyFonts(DEFAULT_SYSTEM_FAMILY).map(f => systemFont(f.file, f.axes, f.weight, f.italic)));
  /** The Typeface's own families (before the fallback chain) and a cache key. */
  function primaryFamilies(info) {
    if (info.spec) {   // Typeface.Builder / CustomFallbackBuilder: the app's families, then the sans-serif typeface's collection
      const list = info.spec.families.map((fontsOf, index) => familyFor('app:' + info.spec.id + ':' + index, () => fontsOf.map(f => {
        if (!f.file?.bytes) fail('App font bytes are unavailable to the text layout backend');
        return fontFor('app:' + f.file.name, () => f.file.bytes, { axes: (f.axes ?? []).map(a => ({ tag: a.tag, value: a.value })), weight: f.weight, italic: f.italic ? 1 : 0 });
      }), { customFallback: true }));
      return { key: 'app:' + info.spec.id, list: [...list, sansSerif()] };
    }
    if (info.systemFont && (policy === 'drawing' || info.family !== DEFAULT_SYSTEM_FAMILY)) {   // the fonts.xml font the lab draws this Typeface with, at its variation
      const f = info.systemFont, axes = axesOf(info.fontVariations);
      return { key: 'sys:' + f.file + ':' + JSON.stringify(axes) + ':' + f.weight + ':' + f.italic, list: [familyFor('sys:' + f.file + ':' + JSON.stringify(axes) + ':' + f.weight + ':' + f.italic, () => [systemFont(f.file, axes, f.weight, f.italic)])] };
    }
    if (info.variation?.length && policy === 'android') {
      const axes = info.variation.map(a => ({ tag: a.tag, value: a.value }));
      return { key: 'sans:' + JSON.stringify(axes), list: [familyFor('system:sans-serif:' + JSON.stringify(axes), () => systemFamilyFonts(DEFAULT_SYSTEM_FAMILY).map(f => systemFont(f.file, [...f.axes.filter(a => !axes.some(v => v.tag === a.tag)), ...axes], f.weight, f.italic)))] };
    }
    return { key: 'sans', list: [sansSerif()] };
  }
  // ---- the fallback chain ----
  let chain = null;
  const fallbackChain = () => {
    if (chain) return chain;
    const manifest = fonts.manifest();
    chain = [];
    for (const family of manifest.families) for (const file of family.files) chain.push({ family, file, key: 'fallback:' + file.stem });
    return chain;
  };
  const fallbackFamily = entry => familyFor(entry.key, () => [fontFor(entry.key, () => fonts.fallbackBytes(entry.file.stem), { ttc: 0 })],
    // fonts.xml marks the UI cuts of a script variant="compact" (FamilyVariant::COMPACT = 1)
    { lang: entry.family.lang ? entry.family.lang.replaceAll(' ', ',') : '', variant: /UI$/.test(entry.family.id) ? 1 : 0 });
  /** The FontCollection for a Typeface and the code points of `text`. */
  function collectionFor(info, text) {
    const primary = primaryFamilies(info), points = new Set();
    for (const ch of text) { const cp = ch.codePointAt(0); if (cp > 0x7e || cp < 0x20) points.add(cp); }
    const used = [];
    if (points.size) for (const [index, entry] of fallbackChain().entries()) { for (const cp of points) if (inRanges(entry.file.ranges, cp)) { used.push(index); break; } }
    const key = primary.key + '|' + used.join(',');
    let handle = collections.get(key);
    if (handle === undefined) {
      const list = [...primary.list, ...used.map(index => fallbackFamily(fallbackChain()[index]))], p = malloc(list.length * 4);
      try { list.forEach((family, i) => view().setInt32(p + i * 4, family, true)); handle = guarded(() => api.mk_collection_new(p, list.length)); }
      finally { api.mk_free(p); }
      if (!handle) fail('Minikin could not make a font collection: ' + error());
      collections.set(key, handle);
    }
    return handle;
  }

  // ---- Paint ----
  /** Writes hwui's Paint state (LabPaint of lab/minikin-wrapper.cpp) for paint state `p` (src/paint-host.js) with Typeface `info` into `at`; returns the C strings to free. */
  function writePaint(at, p, info, text) {
    const v = view(), features = p.fontFeatureSettings ? cString(p.fontFeatureSettings) : 0;
    v.setInt32(at, collectionFor(info, text), true);
    v.setFloat32(at + 4, p.textSize, true); v.setFloat32(at + 8, p.textScaleX ?? 1, true); v.setFloat32(at + 12, p.textSkewX ?? 0, true);
    v.setFloat32(at + 16, p.letterSpacing ?? 0, true); v.setFloat32(at + 20, p.wordSpacing ?? 0, true);
    v.setUint32(at + 24, p.flags >>> 0, true); v.setInt32(at + 28, p.hinting ?? 1, true);
    v.setUint32(at + 32, localeList(p.textLocaleTags ?? p.textLocaleTag ?? ''), true);
    v.setInt32(at + 36, p.elegantTextHeight ? 2 : 0, true);   // Paint.setElegantTextHeight: FamilyVariant::ELEGANT, else DEFAULT
    v.setInt32(at + 40, info.weight ?? 400, true); v.setInt32(at + 44, info.italic ? 1 : 0, true);
    v.setInt32(at + 48, (p.hyphenEdit ?? 0) >>> 3, true); v.setInt32(at + 52, (p.hyphenEdit ?? 0) & 7, true);
    v.setUint32(at + 56, features, true);
    return features;
  }
  const writeText = text => { const p = malloc(text.length * 2), v = view(); for (let i = 0; i < text.length; i++) v.setUint16(p + i * 2, text.charCodeAt(i), true); return p; };
  /** `body(paintPointer, textPointer)` with the paint written and the text copied in. */
  const withPaint = (p, info, text, body) => {
    const paint = malloc(PAINT_BYTES), buffer = writeText(text); let features = 0;
    try { features = writePaint(paint, p, info, text); return guarded(() => body(paint, buffer)); }
    finally { api.mk_free(paint); api.mk_free(buffer); if (features) api.mk_free(features); }
  };

  return {
    metadata: minikin.metadata, policy,
    localeList,
    // ---- MeasuredText ----
    builder: () => api.mk_mt_builder_new(),
    freeBuilder: b => api.mk_mt_builder_free(b),
    /** MeasuredText.Builder.appendStyleRun: `text` is the whole paragraph (the run's fonts depend on its code points). */
    addStyleRun(b, p, info, text, lineBreakStyle, lineBreakWordStyle, start, end, isRtl) {
      withPaint(p, info, text.slice(start, end), paint => { if (!api.mk_mt_add_style_run(b, paint, lineBreakStyle, lineBreakWordStyle, start, end, isRtl ? 1 : 0)) fail('Minikin style run: ' + error()); });
    },
    addReplacementRun(b, localeTags, start, end, width) { api.mk_mt_add_replacement_run(b, localeList(localeTags ?? ''), start, end, width); },
    build(b, text, { hyphenation = false, layout = false, fast = false, hint = 0 } = {}) {
      const buffer = writeText(text);
      try { return guarded(() => api.mk_mt_build(b, buffer, text.length, hyphenation ? 1 : 0, layout ? 1 : 0, fast ? 1 : 0, hint)); } finally { api.mk_free(buffer); }
    },
    freeMeasured: mt => api.mk_mt_free(mt),
    width: (mt, start, end) => api.mk_mt_width(mt, start, end),
    charWidth: (mt, index) => view().getFloat32(api.mk_mt_widths(mt) + index * 4, true),
    widths: (mt, length) => Array.from(new Float32Array(api.memory.buffer, api.mk_mt_widths(mt), length)),
    memoryUsage: mt => api.mk_mt_memory(mt),
    extent(mt, text, start, end) { const buffer = writeText(text), out = malloc(8); try { guarded(() => api.mk_mt_extent(mt, buffer, text.length, start, end, out)); return { ascent: view().getInt32(out, true), descent: view().getInt32(out + 4, true) }; } finally { api.mk_free(buffer); api.mk_free(out); } },
    bounds(mt, text, start, end) { const buffer = writeText(text), out = malloc(16); try { guarded(() => api.mk_mt_bounds(mt, buffer, text.length, start, end, out)); return [0, 4, 8, 12].map(o => view().getInt32(out + o, true)); } finally { api.mk_free(buffer); api.mk_free(out); } },
    // ---- LineBreaker ----
    lineBreaker(strategy, frequency, justified, indents) {
      const list = indents ?? [], p = malloc(list.length * 4);
      try { list.forEach((value, i) => view().setInt32(p + i * 4, value, true)); return api.mk_lb_new(strategy, frequency, justified ? 1 : 0, list.length ? p : 0, list.length); } finally { api.mk_free(p); }
    },
    freeLineBreaker: lb => api.mk_lb_free(lb),
    computeLineBreaks(lb, text, mt, { firstWidth, firstWidthLineCount, restWidth, tabStops = null, defaultTabStop = 0, indentsOffset = 0 }) {
      const buffer = writeText(text), tabs = tabStops?.length ? malloc(tabStops.length * 4) : 0;
      try {
        if (tabs) tabStops.forEach((value, i) => view().setFloat32(tabs + i * 4, value, true));
        const result = guarded(() => api.mk_lb_compute(lb, buffer, text.length, mt, firstWidth, firstWidthLineCount, restWidth, tabs, tabStops?.length ?? 0, defaultTabStop, indentsOffset));
        try {
          const n = api.mk_result_count(result), read = (pointer, type) => Array.from(new type(api.memory.buffer, pointer, n));
          const offsets = read(api.mk_result_offsets(result), Int32Array), widths = read(api.mk_result_widths(result), Float32Array), ascents = read(api.mk_result_ascents(result), Float32Array), descents = read(api.mk_result_descents(result), Float32Array), flags = read(api.mk_result_flags(result), Int32Array);
          return offsets.map((offset, i) => ({ offset, width: widths[i], ascent: ascents[i], descent: descents[i], flags: flags[i] }));
        } finally { api.mk_result_free(result); }
      } finally { api.mk_free(buffer); if (tabs) api.mk_free(tabs); }
    },
    // ---- Paint measurement (MinikinUtils) ----
    /** Layout::measureText: total advance and the per-UTF-16 advances of [start, start + count) in `text` (its context). */
    measureText(p, info, text, start, count, bidiFlags = 0) {
      return withPaint(p, info, text, (paint, buffer) => { const out = malloc(Math.max(1, text.length) * 4); try { const total = api.mk_measure_text(paint, bidiFlags, buffer, start, count, text.length, out); return { total, advances: Array.from(new Float32Array(api.memory.buffer, out, count)) }; } finally { api.mk_free(out); } });
    },
    textBounds(p, info, text, bidiFlags = 0) { return withPaint(p, info, text, (paint, buffer) => { const out = malloc(16); try { if (!api.mk_text_bounds(paint, bidiFlags, buffer, text.length, out)) fail(error()); return Array.from(new Float32Array(api.memory.buffer, out, 4)); } finally { api.mk_free(out); } }); },
    fontExtent(p, info, text, start, count, bidiFlags = 0) { return withPaint(p, info, text, (paint, buffer) => { const out = malloc(8); try { if (!api.mk_font_extent(paint, bidiFlags, buffer, start, count, text.length, out)) fail(error()); const values = new Float32Array(api.memory.buffer, out, 2); return { ascent: values[0], descent: values[1] }; } finally { api.mk_free(out); } }); },
    stats: () => ({ fontData: data.size, fonts: fontHandles.size, families: families.size, collections: collections.size, memoryBytes: api.memory.buffer.byteLength }),
  };
}
