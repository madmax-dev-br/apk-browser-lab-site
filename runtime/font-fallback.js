import {APKError} from './apk-runtime.js?v=00979d36e5ab';
import {DIGESTS} from './crypto-host.js?v=00979d36e5ab';

/** Android font fallback (Minikin FontCollection) over the vendored Android 13 fallback chain.
 *
 * Contract: frameworks/minikin FontCollection::itemize/getFamilyForChar, fonts.xml of android-13.0.0_r1.
 *  - The primary family (Roboto, the face selected for the paint) is the first font: it wins for every code point it covers.
 *  - Otherwise the first family of fonts.xml (vendor/android-fonts manifest order) that has the code point wins;
 *    U+FE0F asks for the colour emoji families first, U+FE0E excludes them.
 *  - Emoji sequences (ZWJ, modifiers, keycaps, flags, tag sequences) stay in one run and need one file that has every component.
 *  - Punctuation of the sticky allowlist and characters that need no font support continue the previous run (Minikin FontCollection.cpp).
 * The result is a list of runs; each run names the font file(s) (SkParagraph family names) to shape it with. Shaping itself
 * (HarfBuzz through SkParagraph) is done by the caller, run by run, exactly like Minikin shapes each itemized run.
 * Font files are read synchronously and lazily, only when a run needs them, and checked against the manifest SHA-256. */
const fail = message => { throw new APKError(message, {kind: 'font-fallback-unsupported'}); };
const PRIMARY = null, MAX_FONT = 16 * 1024 * 1024, MAX_MANIFEST = 2 * 1024 * 1024;
const VS15 = 0xfe0e, VS16 = 0xfe0f, ZWJ = 0x200d;
const STICKY = new Set([0x21, 0x2c, 0x2d, 0x2e, 0x3a, 0x3b, 0x3f, 0xa0, 0x2010, 0x2011, 0x202f, 0x2640, 0x2642, 0x2695]);
const NO_SUPPORT_NEEDED = c => c === 0xad || c === 0x34f || c === 0x61c || (c >= 0x200c && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0xe0100 && c <= 0xe01ef);
const SEQUENCE = /\p{Regional_Indicator}{2}|[0-9#*]️?⃣|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|\p{Extended_Pictographic}[︎️]?\p{Emoji_Modifier}?(?:‍\p{Extended_Pictographic}[︎️]?\p{Emoji_Modifier}?)*/uy;
const MARK = /^\p{M}$/u;
const hex = digest => [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
const inRanges = (ranges, cp) => { let lo = 0, hi = ranges.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1, r = ranges[mid]; if (cp < r[0]) hi = mid - 1; else if (cp > r[1]) lo = mid + 1; else return true; } return false; };
/** Code points that no glyph can be missing for: layout controls handled by the line breaker/shaper, never drawn. */
const LAYOUT_CONTROL = c => c === 0x0a || c === 0x0d || c === 0x09 || c === 0x85 || c === 0x2028 || c === 0x2029;
const u = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

export function createFontFallback({CK, baseURL, readSync, robotoFiles, selectTypeface}) {
  let manifest = null, provider = null, lookup = null;
  const loaded = new Set(), roboto = new Map(), stats = {loadedFiles: [], loadedBytes: 0};
  const load = () => {
    if (manifest) return manifest;
    if (typeof readSync !== 'function') fail('Android font fallback needs a synchronous font reader (Worker XMLHttpRequest or Node fs)');
    const bytes = readSync(new URL('manifest.json', baseURL), MAX_MANIFEST);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed.schema !== 1 || !Array.isArray(parsed.families) || parsed.families.length > 256) fail('Invalid Android font fallback manifest');
    lookup = new Map();
    for (const family of parsed.families) for (const file of family.files) {
      if (!/^[A-Za-z0-9_.-]+\.(ttf|otf)$/.test(file.file)) fail('Invalid fallback font file name');
      file.stem = file.file.replace(/\.(ttf|otf)$/, ''); lookup.set(file.stem, file);
    }
    return manifest = parsed;
  };
  const getProvider = () => {
    if (provider) return provider;
    provider = CK.TypefaceFontProvider.Make();
    for (const font of robotoFiles) provider.registerFont(font.bytes, 'Roboto');
    return provider;
  };
  /** Reads, verifies and registers one fallback font file the first time a run needs it. */
  const ensureLoaded = stem => {
    if (loaded.has(stem)) return;
    const entry = lookup.get(stem); if (!entry) fail('Unknown fallback font ' + stem);
    const bytes = readSync(new URL(entry.file, baseURL), MAX_FONT);
    if (bytes.length !== entry.bytes || hex(DIGESTS['SHA-256'].fn(bytes)) !== entry.sha256) fail('Fallback font integrity mismatch: ' + entry.file);
    getProvider().registerFont(bytes, stem);
    loaded.add(stem); stats.loadedFiles.push(entry.file); stats.loadedBytes += bytes.length;
  };
  const primary = (weight, italic) => {
    const key = weight + ':' + italic;
    if (!roboto.has(key)) roboto.set(key, {font: new CK.Font(selectTypeface(weight, italic), 12), cache: new Map()});
    return roboto.get(key);
  };
  const primaryCovers = (face, cp) => {
    let known = face.cache.get(cp);
    if (known === undefined) { const glyphs = face.font.getGlyphIDs(String.fromCodePoint(cp)); known = glyphs.length > 0 && glyphs[0] !== 0; face.cache.set(cp, known); }
    return known;
  };
  const fileCovers = (file, cp) => inRanges(file.ranges, cp);
  const familyFile = (family, cp) => family.files.find(file => fileCovers(file, cp));
  /** getFamilyForChar: first font of the chain with the glyph; VS16 prefers colour emoji families, VS15 skips them. */
  const pick = (cp, vs, face) => {
    if (vs !== VS16 && primaryCovers(face, cp)) return PRIMARY;
    const families = manifest.families;
    if (vs === VS16) for (const family of families) if (family.color && familyFile(family, cp)) return family;
    if (vs === VS16 && primaryCovers(face, cp)) return PRIMARY;
    for (const family of families) { if (vs === VS15 && family.color) continue; if (familyFile(family, cp)) return family; }
    return undefined;
  };
  const covers = (family, face, cp) => family === PRIMARY ? primaryCovers(face, cp) : !!familyFile(family, cp);

  return {
    /** Itemizes `text` for the primary face `{weight,italic}`. Returns null when Roboto alone covers it (the caller keeps its original
     * single-family path, so Roboto-only text is shaped exactly as before). Otherwise `{runs:[{start,end,families|null}], files}`. */
    itemize(text, {weight = 400, italic = false} = {}) {
      const face = primary(weight, italic);
      // Cheap exit: every code point is a layout control or covered by the primary face (nothing to itemize).
      let pure = true;
      for (let i = 0; i < text.length;) { const cp = text.codePointAt(i); i += cp > 0xffff ? 2 : 1; if (!LAYOUT_CONTROL(cp) && (NO_SUPPORT_NEEDED(cp) || !primaryCovers(face, cp))) { pure = false; break; } }
      if (pure) return null;
      load();
      const runs = [], missing = [];
      let last = undefined, runStart = 0, runFiles = null;
      const flush = end => { if (end > runStart && last !== undefined) runs.push({start: runStart, end, family: last, files: runFiles}); };
      const open = (start, family) => { if (family !== last) { flush(start); runStart = start; last = family; runFiles = family === PRIMARY ? null : new Set(); } };
      for (let i = 0; i < text.length;) {
        const cp = text.codePointAt(i), width = cp > 0xffff ? 2 : 1;
        // Emoji sequences stay whole in one colour-emoji file that has every component.
        if (cp >= 0x23) {
          SEQUENCE.lastIndex = i; const m = SEQUENCE.exec(text);
          if (m && m[0].length > width && !(text.codePointAt(i + width) === VS15)) {
            const parts = [...m[0]].map(c => c.codePointAt(0)).filter(c => c !== VS16 && c !== VS15 && c !== ZWJ);
            let found = null;
            for (const family of manifest.families) if (family.color) { const file = family.files.find(f => parts.every(c => fileCovers(f, c))); if (file) { found = {family, file}; break; } }
            if (found) { open(i, found.family); runFiles.add(found.file.stem); i += m[0].length; continue; }
          }
        }
        const next = text.codePointAt(i + width), vs = next === VS16 || next === VS15 ? next : null;
        let family;
        if (last !== undefined && ((STICKY.has(cp) && covers(last, face, cp)) || NO_SUPPORT_NEEDED(cp) || (cp >= 0x300 && MARK.test(String.fromCodePoint(cp)) && covers(last, face, cp)))) family = last;
        else if (LAYOUT_CONTROL(cp)) family = last === undefined ? PRIMARY : last;
        else if (NO_SUPPORT_NEEDED(cp)) family = PRIMARY;
        else family = pick(cp, vs, face);
        if (family === undefined) { missing.push(u(cp)); family = last === undefined ? PRIMARY : last; }
        open(i, family);
        if (family !== PRIMARY && !NO_SUPPORT_NEEDED(cp) && !LAYOUT_CONTROL(cp)) { const file = familyFile(family, cp); if (file) runFiles.add(file.stem); }
        i += width;
      }
      flush(text.length);
      if (missing.length) fail('The supplied Roboto font lacks a glyph in this run, and no font of the Android 13 fallback chain (Roboto + Noto, fonts.xml) has: ' + [...new Set(missing)].slice(0, 8).join(', '));
      const result = [];
      for (const run of runs) {
        let families = null;
        if (run.family !== PRIMARY) { families = [...(run.files.size ? run.files : [run.family.files[0].stem])]; for (const stem of families) ensureLoaded(stem); }
        const previous = result.at(-1);
        if (previous && previous.families === null && families === null) previous.end = run.end; else result.push({start: run.start, end: run.end, families});
      }
      return result.every(run => run.families === null) ? null : {runs: result};
    },
    /** SkParagraph builder over the registered fonts (Roboto + every fallback file loaded so far). */
    makeBuilder(paragraphStyle) { return CK.ParagraphBuilder.MakeFromFontProvider(paragraphStyle, getProvider()); },
    /** Adds `text` to `builder`, one pushed text style per itemized run (`styleProps` is the TextStyle of the paragraph). */
    addRuns(builder, text, styleProps, itemized, base = 0) {
      if (!itemized) { builder.addText(text); return; }
      for (const run of itemized.runs) {
        const piece = new CK.TextStyle({...styleProps, fontFamilies: run.families ?? styleProps.fontFamilies});
        builder.pushStyle(piece); builder.addText(text.slice(run.start - base, run.end - base)); builder.pop();
      }
    },
    /** Runs of `itemized` that intersect [start,end) cut to that range (UTF-16). */
    slice(itemized, start, end) {
      if (!itemized) return null;
      return {runs: itemized.runs.filter(run => run.end > start && run.start < end).map(run => ({start: Math.max(start, run.start) - start, end: Math.min(end, run.end) - start, families: run.families}))};
    },
    stats: () => ({...stats, loadedFiles: [...stats.loadedFiles]}),
    manifest: () => load(),
    isLoaded: stem => loaded.has(stem),
  };
}
