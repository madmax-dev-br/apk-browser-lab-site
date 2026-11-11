// Reading the parts of an sfnt (TrueType / OpenType / TrueType Collection) container that the Android font classes need before FreeType sees the data: the table directory
// (the validity check Font.Builder.build() applies), usWeightClass / italic (FontFileUtil::analyzeStyle), the fvar axes (Paint.setFontVariationSettings filtering) and a single
// member of a TrueType Collection (Font.Builder.setTtcIndex), rebuilt as a standalone font because CanvasKit loads a face from bytes without a collection index.

const TAGS = ['\0\u0001\0\0', 'OTTO', 'true', 'typ1'];
const tag4 = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

/** The table directory of font `index` of `bytes` (index > 0 only for a 'ttcf' collection), or null when the data is not an sfnt with in-range tables. */
export function sfntDirectory(bytes, index = 0) {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), magic = tag4(bytes, 0);
  let base = 0, collection = false, fonts = 1;
  if (magic === 'ttcf') {
    collection = true; fonts = view.getUint32(8);
    if (fonts === 0 || fonts > 4096 || 12 + 4 * fonts > bytes.length) return null;
    if (index >= fonts) return null;
    base = view.getUint32(12 + 4 * index);
  } else if (!TAGS.includes(magic) || index !== 0) return null;
  if (base + 12 > bytes.length) return null;
  const count = view.getUint16(base + 4), tables = new Map();
  if (count === 0 || count > 256 || base + 12 + 16 * count > bytes.length) return null;
  for (let i = 0; i < count; i++) {
    const at = base + 12 + 16 * i, offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    if (offset > bytes.length || length > bytes.length - offset) return null;
    tables.set(tag4(bytes, at), { offset, length, checksum: view.getUint32(at + 4) });
  }
  return { tables, base, collection, fonts, version: view.getUint32(base) };
}

/** usWeightClass and italic flag of an sfnt (OS/2, falling back to head.macStyle); null when the data is not a TrueType/OpenType font. */
export function sfntStyle(bytes, ttcIndex = 0) {
  const directory = sfntDirectory(bytes, ttcIndex); if (!directory) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), os2 = directory.tables.get('OS/2'), head = directory.tables.get('head');
  if (os2 && os2.length >= 64) return { weight: view.getUint16(os2.offset + 4) || 400, italic: (view.getUint16(os2.offset + 62) & 0x201) !== 0 };
  if (head && head.length >= 46) { const mac = view.getUint16(head.offset + 44); return { weight: mac & 1 ? 700 : 400, italic: (mac & 2) !== 0 }; }
  return { weight: 400, italic: false };
}

/** The variation axes of the font (fvar table): [{tag, min, def, max}], empty for a static font. */
export function sfntAxes(bytes, ttcIndex = 0) {
  const directory = sfntDirectory(bytes, ttcIndex), fvar = directory?.tables.get('fvar'); if (!fvar || fvar.length < 16) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), start = fvar.offset + view.getUint16(fvar.offset + 4), count = view.getUint16(fvar.offset + 8), size = view.getUint16(fvar.offset + 10), axes = [];
  for (let i = 0; i < count && start + size * (i + 1) <= fvar.offset + fvar.length; i++) {
    const at = start + size * i;
    axes.push({ tag: tag4(bytes, at), min: view.getInt32(at + 4) / 65536, def: view.getInt32(at + 8) / 65536, max: view.getInt32(at + 12) / 65536 });
  }
  return axes;
}

/** Member `index` of a TrueType Collection as a standalone sfnt (tables copied, directory rewritten); bytes unchanged for index 0 of a plain font; null when absent. */
export function sfntMember(bytes, index) {
  const directory = sfntDirectory(bytes, index); if (!directory) return null;
  if (!directory.collection) return bytes;
  const entries = [...directory.tables].sort((a, b) => a[0] < b[0] ? -1 : 1), header = 12 + 16 * entries.length;
  let total = header; for (const [, t] of entries) total += (t.length + 3) & ~3;
  const out = new Uint8Array(total), view = new DataView(out.buffer), source = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(0, directory.version); view.setUint16(4, entries.length);
  let search = 1, shift = 0; while (search * 2 <= entries.length) { search *= 2; shift++; }
  view.setUint16(6, search * 16); view.setUint16(8, shift); view.setUint16(10, entries.length * 16 - search * 16);
  let cursor = header;
  entries.forEach(([tag, t], i) => {
    const at = 12 + 16 * i; for (let k = 0; k < 4; k++) out[at + k] = tag.charCodeAt(k);
    view.setUint32(at + 4, t.checksum); view.setUint32(at + 8, cursor); view.setUint32(at + 12, t.length);
    out.set(bytes.subarray(t.offset, t.offset + t.length), cursor); cursor += (t.length + 3) & ~3;
  });
  void source; return out;
}

/** FontVariationAxis tag <-> four-character string. */
export const tagToInt = tag => ((tag.charCodeAt(0) << 24) | (tag.charCodeAt(1) << 16) | (tag.charCodeAt(2) << 8) | tag.charCodeAt(3)) | 0;
export const intToTag = value => String.fromCharCode((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
