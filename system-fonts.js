import { SYSTEM_FONT_FAMILIES, SYSTEM_FONT_ALIASES, SYSTEM_FONT_FILES, SYSTEM_FALLBACK_AXES } from './system-font-families.js?v=1c341f498fc5';
import { sfntAxes, sfntBounds } from './sfnt.js?v=1c341f498fc5';
import { APKError } from './apk-error.js?v=1c341f498fc5';

// The system font map of android-13.0.0_r1 (frameworks/base data/fonts/fonts.xml, read by SystemFonts.buildSystemFallback / Typeface.setSystemFontMap): the named families and
// their aliases, from the generated table src/system-font-families.js. Typeface.create(String, int) looks the name up in that map exactly as written; a name that is not there
// answers the default family. An alias with a weight is the same family with another base weight (Typeface.createWeightAlias: BOLD adds 300 to it).
export const DEFAULT_SYSTEM_FAMILY = 'sans-serif';
/** { family, base } for a name of the system font map, or null. */
export function systemFamilyOf(name) {
  if (typeof name !== 'string') return null;
  if (Object.hasOwn(SYSTEM_FONT_FAMILIES, name)) return { family: name, base: 400 };
  if (!Object.hasOwn(SYSTEM_FONT_ALIASES, name)) return null;
  const [family, weight] = SYSTEM_FONT_ALIASES[name];
  return { family, base: weight || 400 };
}
export const hasSystemFamily = name => systemFamilyOf(name) !== null;
/** The fonts of a family as { weight, italic, file, axes: [{ tag, value }] }, in the order of fonts.xml (the tie-break of the closest match). */
export const systemFamilyFonts = family => SYSTEM_FONT_FAMILIES[family].map(([weight, italic, file, axes]) => ({ weight, italic: !!italic, file, axes: axes.map(([tag, value]) => ({ tag, value })) }));
/** Size and SHA-256 of a vendored system font file; undefined for the regular Roboto the Skia backend ships (RobotoStatic-Regular.ttf in fonts.xml). */
export const systemFontFile = file => SYSTEM_FONT_FILES[file];
/** Minikin FontFamily::getClosestMatch: weight grades apart, plus 2 for a slant mismatch; the first font of the family wins a tie. */
export function closestSystemFont(fonts, weight, italic) {
  let best = null, score = Infinity;
  for (const font of fonts) { const s = Math.abs(Math.trunc(weight / 100) - Math.trunc(font.weight / 100)) + (italic === font.italic ? 0 : 2); if (s < score) { best = font; score = s; } }
  return best;
}


/** The Roboto faces the Skia backend ships (vendor/canvaskit): what `sans-serif` is drawn with at these weights and slants when no variation is set. */
const BACKEND_ROBOTO = new Set(['400:false', '500:false', '700:false', '400:true', '700:true']);
const ROBOTO = 'Roboto-Regular.ttf';   // the variable Roboto of fonts.xml (wght, wdth, ital)
/**
 * The font files of the system font map, one registered face per file for the life of the Skia backend. A file is read (synchronously, src/font-fallback.js readSystemFont)
 * and checked the first time a Typeface needs it, and registered with the paragraph font provider under its own family name.
 */
export function createSystemFontStore({ CK, fallback, fontBoxes = null }) {
  const loaded = new Map();
  const load = file => {
    let entry = loaded.get(file);
    if (!entry) {
      const bytes = fallback.readSystemFont(file, SYSTEM_FONT_FILES[file]);
      const ck = CK.Typeface.MakeFreeTypeFaceFromData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      if (!ck) throw new APKError('System font ' + file + ' could not be decoded by Skia', { kind: 'font-unavailable' });
      const name = 'android-system-' + file.replace(/\.(ttf|otf)$/, '');
      fallback.registerCustom(name, bytes); fontBoxes?.set(ck, sfntBounds(bytes, 0));
      loaded.set(file, entry = { ck, name, axes: sfntAxes(bytes, 0), size: bytes.length });
    }
    return entry;
  };
  return {
    /**
     * The font of `family` for a weight and slant, with `variation` (Typeface.createFromTypefaceWithVariation) applied to a font that declares the axes:
     * { backend: true } for a Roboto face of the Skia backend, else { file: { ck, name }, font, fontVariations }.
     */
    select(family, weight, italic, variation = null) {
      const font = closestSystemFont(systemFamilyFonts(family), weight, italic);
      // sans-serif: the regular weight is a static font in fonts.xml too (RobotoStatic-Regular.ttf, no axes); the other faces the backend has are used as long as no variation asks for the variable font
      if (family === DEFAULT_SYSTEM_FAMILY && (!SYSTEM_FONT_FILES[font.file] || (!variation?.length && BACKEND_ROBOTO.has(font.weight + ':' + font.italic)))) return { backend: true, font };
      const file = load(font.file), axes = [...font.axes.filter(axis => !variation?.some(v => v.tag === axis.tag)), ...(variation ?? []).filter(v => file.axes.some(axis => axis.tag === v.tag))];
      return { file, font, fontVariations: axes.map(axis => ({ axis: axis.tag, value: axis.value })) };
    },
    /** Typeface.isSupportedAxes: the axes of the family's own fonts and of the fallback chain behind it. */
    supportedAxes(family) { return new Set([...systemFamilyFonts(family).flatMap(font => SYSTEM_FONT_FILES[font.file]?.axes ?? []), ...SYSTEM_FALLBACK_AXES]); },
    /** Android's Roboto at a weight and slant of sans-serif, with every glyph and OpenType feature of the system font (see shapingFace in src/skia-paragraph.js). */
    fullRoboto(weight, italic) {
      const font = closestSystemFont(systemFamilyFonts(DEFAULT_SYSTEM_FAMILY), weight, italic), file = load(ROBOTO);
      const axes = font.axes.length ? font.axes : [{ tag: 'ital', value: 0 }, { tag: 'wdth', value: 100 }, { tag: 'wght', value: 400 }];   // the regular weight: the variable font's default instance, which RobotoStatic-Regular.ttf is cut from
      return { name: file.name, fontVariations: axes.map(axis => ({ axis: axis.tag, value: axis.value })) };
    },
    loadedFiles: () => [...loaded.keys()],
  };
}
