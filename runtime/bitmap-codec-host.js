import { gcRoot } from './heap-gc.js?v=b60e95a62870';
import { APKError } from './apk-error.js?v=b60e95a62870';
import { createHostRegistry } from './host-contract.js?v=b60e95a62870';
import { getVectorGraphics } from './vector-native.js?v=b60e95a62870';
import { jpegNativeScale, sampledDimension, samplePixels, premultiply, unpremultiply } from './image-codecs.js?v=b60e95a62870';

// android.graphics.BitmapFactory (+ Options), Bitmap.CompressFormat and the Bitmap operations on top of the recorded-canvas Bitmap of bitmap-host.js: decoding PNG/JPEG/GIF/WebP/BMP
// with the official Skia codecs (CanvasKit), inSampleSize / density scaling / inJustDecodeBounds / inBitmap reuse as in frameworks/base BitmapFactory.cpp, pixel access
// (getPixel/getPixels/setPixel), scaled and cropped copies, and compress() through Skia's encoders.
// Known limits (explicit, not hidden): Config RGB_565 / ARGB_4444 / RGBA_F16 requests decode to ARGB_8888 (outConfig reports it); HARDWARE requests produce an immutable bitmap that
// denies pixel access like Android's; EXIF orientation is never applied (BitmapFactory does not rotate): JPEG and WebP decode through the lab codec module (libjpeg-turbo, libwebp: src/image-codecs.js), which does not rotate, with libjpeg's DCT scaling for inSampleSize 2, 4 and 8 and Skia's sampler for the rest; PNG/GIF/BMP/ICO go through CanvasKit, whose decoder applies a PNG eXIf orientation (not corrected); animated GIF/WebP decode the first frame (as BitmapFactory does).
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', BITMAP = 'Landroid/graphics/Bitmap;', CONFIG = 'Landroid/graphics/Bitmap$Config;', CANVAS = 'Landroid/graphics/Canvas;', FACTORY = 'Landroid/graphics/BitmapFactory;';
const OPTIONS = 'Landroid/graphics/BitmapFactory$Options;', COMPRESS = 'Landroid/graphics/Bitmap$CompressFormat;', INPUT = 'Ljava/io/InputStream;', OUTPUT = 'Ljava/io/OutputStream;', RECT = 'Landroid/graphics/Rect;', RESOURCES = 'Landroid/content/res/Resources;', MATRIX = 'Landroid/graphics/Matrix;', PAINT = 'Landroid/graphics/Paint;', TYPED_VALUE = 'Landroid/util/TypedValue;', SPACE = 'Landroid/graphics/ColorSpace;';
const FORMATS = ['JPEG', 'PNG', 'WEBP', 'WEBP_LOSSY', 'WEBP_LOSSLESS'];
const DENSITY_DEFAULT = 160, DENSITY_NONE = 0xffff, MAX_ENCODED = 64 * 1024 * 1024;
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'bitmap-codec-unsupported', ...details }); };
const base64 = bytes => { let binary = ''; for (let at = 0; at < bytes.length; at += 16384) binary += String.fromCharCode(...bytes.subarray(at, at + 16384)); return btoa(binary); };
const bits = new DataView(new ArrayBuffer(4)), floatOf = raw => { bits.setInt32(0, raw | 0, true); return bits.getFloat32(0, true); };

/** BitmapFactory's encoded-format sniffing (SkCodec signatures) -> Android mime type. */
export function sniffMime(b) {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-ico';
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {   // ISO BMFF 'ftyp': the major brand and the compatible brands tell AVIF from HEIF
    const brands = []; for (let at = 8; at + 4 <= Math.min(b.length, 8 + Math.max(4, (((b[0] * 256 + b[1]) * 256 + b[2]) * 256 + b[3]) - 8)); at += at === 8 ? 8 : 4) brands.push(String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]));
    if (brands.includes('avif') || brands.includes('avis')) return 'image/avif';
    if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))) return 'image/heif';
  }
  return null;
}

/** SkWbmpCodec's header check: type 0, fixed-header 0, then two multi-byte integers (width, height) both non-zero, with exactly the packed 1-bit rows after them. */
export function looksLikeWbmp(b) {
  if (b.length < 4 || b[0] !== 0 || (b[1] & 0x9f) !== 0) return false;
  let at = 2; const read = () => { let value = 0; for (let n = 0; n < 5 && at < b.length; n++) { const byte = b[at++]; value = value * 128 + (byte & 0x7f); if (!(byte & 0x80)) return value; } return -1; };
  const width = read(), height = read(); if (width <= 0 || height <= 0 || width > 65535 || height > 65535) return false;
  return b.length - at === Math.ceil(width / 8) * height;
}

export function createBitmapCodecHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(FACTORY, OBJECT, [], {}); type(OPTIONS, OBJECT, [], { allocatable: true }); type(COMPRESS, 'Ljava/lang/Enum;');
  const vcall = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const bitmaps = r => r.skiaHost?.bitmaps ?? fail('Bitmap decoding requires the verified Skia backend');
  const CK = r => r.skia?.CanvasKit ?? fail('Bitmap decoding requires the verified Skia CanvasKit backend');
  const optionsKey = (name, t) => `${OPTIONS}->${name}:${t}`;

  // ---- Bitmap.CompressFormat ----------------------------------------------------------------------------------------------------------------
  const formatValues = new WeakMap();
  const formatValue = (r, name) => { const table = formatValues.get(r) ?? formatValues.set(r, gcRoot(new Map())).get(r); if (!table.has(name)) { const ref = r.makeObject(COMPRESS), o = r.object(ref); o.enumName = name; o.enumOrdinal = FORMATS.indexOf(name); r.storeField(o.fields, `${COMPRESS}->nativeInt:I`, FORMATS.indexOf(name)); table.set(name, ref); } return table.get(name); };
  for (const name of FORMATS) registry.staticField(COMPRESS, name, COMPRESS, r => formatValue(r, name));
  def(COMPRESS, 'values', `()[${COMPRESS}`, r => { const a = r.newArray(`[${COMPRESS}`, FORMATS.length); r.array(a).elements = FORMATS.map(n => formatValue(r, n)); return a; }, { static: true });
  def(COMPRESS, 'valueOf', `(${STRING})${COMPRESS}`, (r, _m, [name]) => { const n = r.stringCharacters(name); if (!FORMATS.includes(n)) r.throwJava('Ljava/lang/IllegalArgumentException;', `No enum constant android.graphics.Bitmap.CompressFormat.${n}`); return formatValue(r, n); }, { static: true });

  // ---- BitmapFactory.Options ----------------------------------------------------------------------------------------------------------------
  const optionFields = [['inBitmap', BITMAP], ['inMutable', 'Z'], ['inJustDecodeBounds', 'Z'], ['inSampleSize', 'I'], ['inPreferredConfig', CONFIG], ['inPremultiplied', 'Z'], ['inDither', 'Z'], ['inDensity', 'I'], ['inTargetDensity', 'I'],
    ['inScreenDensity', 'I'], ['inScaled', 'Z'], ['inPurgeable', 'Z'], ['inInputShareable', 'Z'], ['inPreferQualityOverSpeed', 'Z'], ['outWidth', 'I'], ['outHeight', 'I'], ['outMimeType', STRING], ['outConfig', CONFIG],
    ['outColorSpace', SPACE], ['inTempStorage', '[B'], ['inPreferredColorSpace', SPACE], ['mCancel', 'Z']];
  for (const [name, t] of optionFields) registry.instanceField(OPTIONS, name, t, { reflect: true });
  def(OPTIONS, '<init>', '()V', (r, _m, [self]) => {
    const f = r.object(self).fields;
    r.storeField(f, optionsKey('inScaled', 'Z'), 1); r.storeField(f, optionsKey('inPremultiplied', 'Z'), 1);
    r.storeField(f, optionsKey('inPreferredConfig', CONFIG), bitmaps(r).enumValue(CONFIG, bitmaps(r).CONFIGS, 'ARGB_8888'));
  });
  def(OPTIONS, 'requestCancelDecode', '()V', (r, _m, [self]) => r.storeField(r.object(self).fields, optionsKey('mCancel', 'Z'), 1));
  def(OPTIONS, 'canceled', `(${OPTIONS})Z`, (r, _m, [options]) => options !== null && r.object(options).fields.get(optionsKey('mCancel', 'Z')) ? 1 : 0, { static: true });
  const readOptions = (r, ref) => {
    const f = ref ? r.object(ref).fields : new Map(), get = (name, t, fallback) => f.get(optionsKey(name, t)) ?? fallback, object = (name, t) => get(name, t, null) || null;   // a null reference may be stored as 0
    return { ref, inBitmap: object('inBitmap', BITMAP), inMutable: !!get('inMutable', 'Z', 0), justBounds: !!get('inJustDecodeBounds', 'Z', 0), inSampleSize: get('inSampleSize', 'I', 0), inPreferredConfig: object('inPreferredConfig', CONFIG),
      inDensity: get('inDensity', 'I', 0), inTargetDensity: get('inTargetDensity', 'I', 0), inScreenDensity: get('inScreenDensity', 'I', 0), inScaled: ref ? !!get('inScaled', 'Z', 1) : true, inPreferredColorSpace: object('inPreferredColorSpace', SPACE) };
  };
  const writeOptions = (r, ref, values) => { if (!ref) return; const f = r.object(ref).fields; for (const [name, t, value] of values) r.storeField(f, optionsKey(name, t), value); };

  // ---- decoding -----------------------------------------------------------------------------------------------------------------------------
  /** Decodes encoded `bytes` the way BitmapFactory.cpp doDecode does; returns a Bitmap reference, or null when the data is not a supported image (or only the bounds were requested). */
  /** JPEG and WebP through the lab codec module (libjpeg-turbo / libwebp). Returns null when CanvasKit should decode (other formats, animated WebP), false when the codec rejects the data, else
   *  { image, width, height, srcWidth, srcHeight, alpha, label }: `image` is a CanvasKit image already at the sampled size (null for justBounds), width/height are outWidth/outHeight before density scaling. */
  const labDecoder = (r, bytes, mime, sample, justBounds) => {
    if (mime === 'image/heif') fail('HEIF/HEIC decoding is not available in the lab (it needs an HEVC decoder: libde265 is LGPL, Android uses MediaCodec); AVIF is supported', { mime });
    if (mime !== 'image/jpeg' && mime !== 'image/webp' && mime !== 'image/avif') return null;
    const codecs = r.skia?.codecs ?? fail(`${mime === 'image/jpeg' ? 'JPEG' : 'WebP'} decoding needs the lab codec module (vendor/lab-codecs)${r.skia?.codecsError ? ': ' + r.skia.codecsError.message : ''}`);
    const canvasKit = CK(r);
    if (mime === 'image/jpeg') {
      const info = codecs.jpegInfo(bytes); if (!info) return false;
      const { native, rest } = jpegNativeScale(sample), scaledWidth = Math.ceil(info.width / native), scaledHeight = Math.ceil(info.height / native);   // libjpeg's output size for scale 1/native
      const width = sampledDimension(scaledWidth, rest), height = sampledDimension(scaledHeight, rest), base = { width, height, srcWidth: info.width, srcHeight: info.height, alpha: false, label: `libjpeg-turbo 2.1.0${native > 1 ? ` DCT 1/${native}` : ''}${rest > 1 ? ` sampled ${rest}` : ''}` };
      if (justBounds) return { ...base, image: null };
      const decoded = codecs.jpegDecode(bytes, native); if (!decoded) return false;
      const picked = samplePixels(decoded.rgba, decoded.width, decoded.height, rest);
      return { ...base, image: canvasKit.MakeImage({ width: picked.width, height: picked.height, alphaType: canvasKit.AlphaType.Opaque, colorType: canvasKit.ColorType.RGBA_8888, colorSpace: canvasKit.ColorSpace.SRGB }, picked.rgba, picked.width * 4) };
    }
    if (mime === 'image/avif') {   // libavif + dav1d; the sampler does inSampleSize (SkAvifCodec has no native scaling)
      const info = codecs.avifInfo(bytes); if (!info) return false;
      const width = sampledDimension(info.width, sample), height = sampledDimension(info.height, sample), base = { width, height, srcWidth: info.width, srcHeight: info.height, alpha: info.hasAlpha, label: `libavif 1.0.4 + dav1d 1.4.3${sample > 1 ? ` sampled ${sample}` : ''}` };
      if (justBounds) return { ...base, image: null };
      const decoded = codecs.avifDecode(bytes, true); if (!decoded) return false;
      const picked = samplePixels(decoded.rgba, decoded.width, decoded.height, sample);
      return { ...base, image: canvasKit.MakeImage({ width: picked.width, height: picked.height, alphaType: info.hasAlpha ? canvasKit.AlphaType.Premul : canvasKit.AlphaType.Opaque, colorType: canvasKit.ColorType.RGBA_8888, colorSpace: canvasKit.ColorSpace.SRGB }, picked.rgba, picked.width * 4) };
    }
    const info = codecs.webpInfo(bytes); if (!info) return false;
    if (info.hasAnimation) return null;   // the first frame of an animated file: CanvasKit's decoder
    const width = sampledDimension(info.width, sample), height = sampledDimension(info.height, sample), base = { width, height, srcWidth: info.width, srcHeight: info.height, alpha: info.hasAlpha, label: `libwebp 1.2.2${sample > 1 ? ` sampled ${sample}` : ''}` };
    if (justBounds) return { ...base, image: null };
    const decoded = codecs.webpDecode(bytes, true); if (!decoded) return false;
    const picked = samplePixels(decoded.rgba, decoded.width, decoded.height, sample);
    return { ...base, image: canvasKit.MakeImage({ width: picked.width, height: picked.height, alphaType: info.hasAlpha ? canvasKit.AlphaType.Premul : canvasKit.AlphaType.Opaque, colorType: canvasKit.ColorType.RGBA_8888, colorSpace: canvasKit.ColorSpace.SRGB }, picked.rgba, picked.width * 4) };
  };
  function decode(r, bytes, optionsRef, paddingRef = null, defaultDensity = {}) {
    const o = readOptions(r, optionsRef), host = bitmaps(r), canvasKit = CK(r);
    if (paddingRef) { const f = r.object(paddingRef).fields; for (const edge of ['left', 'top', 'right', 'bottom']) r.storeField(f, `${RECT}->${edge}:I`, -1); }
    let mime = sniffMime(bytes);
    if (!mime && looksLikeWbmp(bytes)) mime = 'image/vnd.wap.wbmp';   // WBMP has no signature: Skia tries its codec last, on a valid header (type 0, fixed header 0, sizes)
    if (!mime) { r.record('LOG E BitmapFactory: Unable to decode stream: SkImageDecoder::Factory returned null'); return null; }
    if (o.inPreferredColorSpace && r.object(o.inPreferredColorSpace).colorSpaceName !== 'SRGB') fail('inPreferredColorSpace other than sRGB is not implemented');
    const requested = Math.max(1, o.inSampleSize | 0), lab = labDecoder(r, bytes, mime, requested, o.justBounds);
    if (lab === false) { r.record('LOG E BitmapFactory: Unable to decode stream: codec rejected the data'); return null; }
    const image = lab ? lab.image : canvasKit.MakeImageFromEncoded(bytes);
    if (!image && !(lab && o.justBounds)) { r.record('LOG E BitmapFactory: Unable to decode stream: codec rejected the data'); return null; }
    try {
      const sample = lab ? 1 : requested, srcWidth = lab ? lab.srcWidth : image.width(), srcHeight = lab ? lab.srcHeight : image.height();   // a lab decode is already at the sampled size
      const width = lab ? lab.width : Math.max(1, Math.floor(image.width() / sample)), height = lab ? lab.height : Math.max(1, Math.floor(image.height() / sample));
      const density = o.inDensity || defaultDensity.inDensity || 0, target = o.inTargetDensity || defaultDensity.inTargetDensity || 0;
      const scale = o.inScaled && density && target && density !== o.inScreenDensity ? target / density : 1;
      const scaledWidth = scale === 1 ? width : Math.max(1, Math.trunc(width * scale + 0.5)), scaledHeight = scale === 1 ? height : Math.max(1, Math.trunc(height * scale + 0.5));
      const configName = o.inPreferredConfig ? r.object(o.inPreferredConfig).enumName : 'ARGB_8888', hardware = configName === 'HARDWARE';
      const outConfig = hardware ? o.inPreferredConfig : host.enumValue(CONFIG, host.CONFIGS, 'ARGB_8888');
      writeOptions(r, optionsRef, [['outWidth', 'I', scaledWidth], ['outHeight', 'I', scaledHeight], ['outMimeType', STRING, mime], ['outConfig', CONFIG, outConfig]]);
      if (o.justBounds) return null;
      if (scaledWidth > 4096 || scaledHeight > 4096 || scaledWidth * scaledHeight > 4 * 1024 * 1024) fail(`Decoded image ${scaledWidth}x${scaledHeight} exceeds the VM bitmap limit (4096px/4Mpixel); use inSampleSize to decode a smaller version`, { width: scaledWidth, height: scaledHeight });
      // the pixels: the encoded PNG itself when no resampling is needed, otherwise a Skia rendering at the output size
      let png = mime === 'image/png' && !lab && scaledWidth === image.width() && scaledHeight === image.height() ? bytes : null;
      if (!png && lab && scaledWidth === image.width() && scaledHeight === image.height()) png = image.encodeToBytes(canvasKit.ImageFormat.PNG, 100);
      if (!png) {
        const surface = canvasKit.MakeSurface(scaledWidth, scaledHeight); if (!surface) fail('Skia raster allocation failed');
        try {
          const canvas = surface.getCanvas(), paint = new canvasKit.Paint();
          canvas.clear(canvasKit.TRANSPARENT);
          canvas.drawImageRectOptions(image, canvasKit.LTRBRect(0, 0, image.width(), image.height()), canvasKit.LTRBRect(0, 0, scaledWidth, scaledHeight), requested > 1 && scale === 1 ? canvasKit.FilterMode.Nearest : canvasKit.FilterMode.Linear, canvasKit.MipmapMode.None, paint);
          paint.delete(); surface.flush(); const snapshot = surface.makeImageSnapshot();
          try { png = snapshot.encodeToBytes(canvasKit.ImageFormat.PNG, 100); } finally { snapshot.delete(); }
        } finally { surface.dispose(); }
      }
      const alpha = lab ? lab.alpha : image.getImageInfo().alphaType.value !== canvasKit.AlphaType.Opaque.value;
      let bitmap = o.inBitmap;
      if (bitmap) {
        const state = host.live(bitmap);
        if (state.mutable === false) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Problem decoding into existing bitmap');
        if (scaledWidth * scaledHeight > state.width * state.height) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Problem decoding into existing bitmap');
        const canvasState = getVectorGraphics(r).get(state.handle, 'canvas'); canvasState.draws.length = 0; canvasState.width = scaledWidth; canvasState.height = scaledHeight;
        Object.assign(state, { width: scaledWidth, height: scaledHeight, hasAlpha: alpha });
      } else bitmap = host.create(scaledWidth, scaledHeight, hardware ? host.enumValue(CONFIG, host.CONFIGS, 'ARGB_8888') : outConfig, alpha, null, { mutable: o.inMutable && !hardware });
      const state = host.live(bitmap);
      if (hardware) { state.config = o.inPreferredConfig; state.hardware = true; state.mutable = false; }
      state.density = scale !== 1 ? target : density || DENSITY_DEFAULT; r.storeField(r.object(bitmap).fields, `${BITMAP}->mDensity:I`, state.density);
      host.recordNative(state.handle, { op: 'raster', raster: { kind: 'raster', dataURL: 'data:image/png;base64,' + base64(png), width: scaledWidth, height: scaledHeight }, args: [0, 0] });
      r.record(`HOST BitmapFactory.decode ${mime} ${srcWidth}x${srcHeight} -> ${scaledWidth}x${scaledHeight} [${lab ? lab.label : 'official Skia codec'}]`);
      return bitmap;
    } finally { image?.delete(); }
  }
  const bytesOf = (r, array, offset, length) => {
    if (array === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const e = r.array(array).elements; if ((offset | length) < 0 || offset + length > e.length) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', null);
    return Uint8Array.from(e.slice(offset, offset + length), v => v & 255);
  };
  function readAll(r, stream) {
    const chunks = []; let total = 0;
    for (;;) {
      const buffer = r.newArray('[B', 16384), got = vcall(r, stream, INPUT, 'read', ['[B', 'I', 'I'], 'I', [buffer, 0, 16384]);
      if (got < 0) break; if (got === 0) continue;
      chunks.push(Uint8Array.from(r.array(buffer).elements.slice(0, got), v => v & 255)); total += got; if (total > MAX_ENCODED) fail('Encoded image exceeds 64 MiB');
    }
    const all = new Uint8Array(total); let at = 0; for (const c of chunks) { all.set(c, at); at += c.length; } return all;
  }
  const streamBytes = (r, stream) => stream === null ? null : readAll(r, stream);
  def(FACTORY, 'decodeByteArray', `([BII${OPTIONS})${BITMAP}`, (r, _m, [a, o, l, options]) => decode(r, bytesOf(r, a, o, l), options), { static: true });
  def(FACTORY, 'decodeByteArray', `([BII)${BITMAP}`, (r, _m, [a, o, l]) => decode(r, bytesOf(r, a, o, l), null), { static: true });
  def(FACTORY, 'decodeStream', `(${INPUT}${RECT}${OPTIONS})${BITMAP}`, (r, _m, [stream, padding, options]) => { const bytes = streamBytes(r, stream); return bytes === null ? null : decode(r, bytes, options, padding); }, { static: true });
  def(FACTORY, 'decodeStream', `(${INPUT})${BITMAP}`, (r, _m, [stream]) => { const bytes = streamBytes(r, stream); return bytes === null ? null : decode(r, bytes, null); }, { static: true });
  const fileBytes = (r, path) => {
    const stream = r.allocate('Ljava/io/FileInputStream;');
    r.dispatch({ owner: 'Ljava/io/FileInputStream;', name: '<init>', parameters: [STRING], result: 'V', signature: `(${STRING})V` }, [stream, path], 'direct');
    try { return readAll(r, stream); } finally { vcall(r, stream, INPUT, 'close', [], 'V'); }
  };
  const tryFile = (r, path, options) => { try { return decode(r, fileBytes(r, path), options); } catch (error) { if (error?.value && r.isSubtype(r.typeOf(error.value), 'Ljava/io/IOException;')) { r.record(`LOG E BitmapFactory: Unable to decode stream: ${r.typeOf(error.value)}`); return null; } throw error; } };
  def(FACTORY, 'decodeFile', `(${STRING}${OPTIONS})${BITMAP}`, (r, _m, [path, options]) => tryFile(r, path, options), { static: true });
  def(FACTORY, 'decodeFile', `(${STRING})${BITMAP}`, (r, _m, [path]) => tryFile(r, path, null), { static: true });
  // Resources: the density of a drawable file comes from its resource directory qualifier (aapt2 stores it in the entry's config; the TypedValue carries it).
  const DPI = { ldpi: 120, mdpi: 160, tvdpi: 213, hdpi: 240, xhdpi: 320, xxhdpi: 480, xxxhdpi: 640 };
  const densityOfPath = path => { const dir = path.split('/').slice(-2, -1)[0] ?? ''; for (const q of dir.split('-')) if (q === 'nodpi') return DENSITY_NONE; else if (DPI[q]) return DPI[q]; return 0; };
  /** The file entry a resource id selects on this device: { path, density } -- density from the selected variant's ResTable_config (u16 at byte 14: 0 = unqualified = mdpi, 0xffff = nodpi), else from the directory qualifier. */
  const resourceFile = (r, id) => {
    let value = platform.resources.resolve(id >>> 0); while (value.resolved) value = value.resolved;
    if (value.kind === 'unresolved' || typeof value.value !== 'string' || !r.apkEntries.has(value.value)) return null;
    const bytes = value.config?.bytes, qualified = bytes && bytes.length >= 16 ? bytes[14] | (bytes[15] << 8) : 0;
    return { path: value.value, density: qualified || densityOfPath(value.value) };
  };
  const densityDefaults = density => ({ inDensity: density === 0 ? DENSITY_DEFAULT : density === DENSITY_NONE ? 0 : density, inTargetDensity: DENSITY_DEFAULT });
  const decodeResource = (r, resourceId, options) => {
    const file = resourceFile(r, resourceId); if (file === null) return null;
    return decode(r, Uint8Array.from(r.apkReader(file.path)), options, null, densityDefaults(file.density));
  };
  def(FACTORY, 'decodeResource', `(${RESOURCES}I${OPTIONS})${BITMAP}`, (r, _m, [, id, options]) => decodeResource(r, id, options), { static: true });
  def(FACTORY, 'decodeResource', `(${RESOURCES}I)${BITMAP}`, (r, _m, [, id]) => decodeResource(r, id, null), { static: true });
  def(FACTORY, 'decodeResourceStream', `(${RESOURCES}${TYPED_VALUE}${INPUT}${RECT}${OPTIONS})${BITMAP}`, (r, _m, [, value, stream, padding, options]) => {
    const bytes = streamBytes(r, stream); if (bytes === null) return null;
    const density = value === null ? 0 : r.object(value).fields.get(`${TYPED_VALUE}->density:I`) ?? 0;
    return decode(r, bytes, options, padding, { inDensity: density === 0 ? (value === null ? 0 : DENSITY_DEFAULT) : density === DENSITY_NONE ? 0 : density, inTargetDensity: DENSITY_DEFAULT });
  }, { static: true });
  def(FACTORY, 'decodeFileDescriptor', `(Ljava/io/FileDescriptor;${RECT}${OPTIONS})${BITMAP}`, () => fail('BitmapFactory.decodeFileDescriptor: file descriptors are not implemented'), { static: true });

  // ---- Bitmap operations --------------------------------------------------------------------------------------------------------------------
  const state = (r, ref) => bitmaps(r).live(ref);
  const configName = (r, s) => r.object(s.config).enumName;
  const pixelsOf = (r, ref) => {
    const s = state(r, ref);
    if (s.hardware || configName(r, s) === 'HARDWARE') r.throwJava('Ljava/lang/IllegalStateException;', 'unable to getPixel(), pixel access is not supported on Config#HARDWARE bitmaps');
    if (configName(r, s) === 'ALPHA_8') fail('Pixel access on ALPHA_8 bitmaps is not implemented');
    const graphics = getVectorGraphics(r), holder = s.canvasObject ??= r.allocate(CANVAS);
    if (!r.object(holder).nativeCanvasHandle) r.object(holder).nativeCanvasHandle = s.handle;
    return graphics.snapshotCanvas(holder, s.width, s.height, { pixels: true }).pixels;
  };
  const argbAt = (pixels, offset) => ((pixels[offset + 3] << 24) | (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]) | 0;
  const checkXY = (r, s, x, y) => { if (x < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'x must be >= 0'); if (y < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'y must be >= 0'); if (x >= s.width) r.throwJava('Ljava/lang/IllegalArgumentException;', 'x must be < bitmap.width()'); if (y >= s.height) r.throwJava('Ljava/lang/IllegalArgumentException;', 'y must be < bitmap.height()'); };
  def(BITMAP, 'getPixel', '(II)I', (r, _m, [self, x, y]) => { const s = state(r, self); checkXY(r, s, x, y); return argbAt(pixelsOf(r, self), (y * s.width + x) * 4); });
  def(BITMAP, 'getPixels', '([IIIIIII)V', (r, _m, [self, out, offset, stride, x, y, width, height]) => {
    const s = state(r, self); if (width === 0 || height === 0) return;
    if (x < 0 || y < 0 || x + width > s.width || y + height > s.height) r.throwJava('Ljava/lang/IllegalArgumentException;', 'x + width must be <= bitmap.width()');
    const target = r.array(out).elements, pixels = pixelsOf(r, self);
    if (Math.abs(stride) < width) r.throwJava('Ljava/lang/IllegalArgumentException;', 'abs(stride) must be >= width');
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) target[offset + row * stride + col] = argbAt(pixels, ((y + row) * s.width + x + col) * 4);
  });
  const writePixels = (r, self, entries) => {
    const s = state(r, self); if (s.mutable === false) r.throwJava('Ljava/lang/IllegalStateException;', 'Cannot modify pixels of an immutable bitmap');
    for (const [x, y, w, h, color] of entries) bitmaps(r).recordNative(s.handle, { op: 'rect', args: [x, y, x + w, y + h], paint: { argb: color | 0, flags: 0, style: 0, strokeWidth: 0, strokeMiter: 4, strokeCap: 0, strokeJoin: 0, blendMode: 1 } });
  };
  def(BITMAP, 'setPixel', '(III)V', (r, _m, [self, x, y, color]) => { const s = state(r, self); if (s.mutable === false) r.throwJava('Ljava/lang/IllegalStateException;', 'Cannot modify pixels of an immutable bitmap'); checkXY(r, s, x, y); writePixels(r, self, [[x, y, 1, 1, color]]); });
  def(BITMAP, 'setPixels', '([IIIIIII)V', (r, _m, [self, colors, offset, stride, x, y, width, height]) => {
    const s = state(r, self); if (width === 0 || height === 0) return;
    if (x < 0 || y < 0 || x + width > s.width || y + height > s.height) r.throwJava('Ljava/lang/IllegalArgumentException;', 'x + width must be <= bitmap.width()');
    const source = r.array(colors).elements, entries = [];
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) entries.push([x + col, y + row, 1, 1, source[offset + row * stride + col]]);
    writePixels(r, self, entries);
  });
  const fromPixels = (r, width, height, rgba, config, mutable) => {
    const host = bitmaps(r), canvasKit = CK(r), bitmap = host.create(width, height, config, true, null, { mutable });
    const image = canvasKit.MakeImage({ width, height, alphaType: canvasKit.AlphaType.Unpremul, colorType: canvasKit.ColorType.RGBA_8888, colorSpace: canvasKit.ColorSpace.SRGB }, rgba, width * 4);
    if (!image) fail('Skia rejected the pixel buffer');
    try { const png = image.encodeToBytes(canvasKit.ImageFormat.PNG, 100); host.recordNative(host.live(bitmap).handle, { op: 'raster', raster: { kind: 'raster', dataURL: 'data:image/png;base64,' + base64(png), width, height }, args: [0, 0] }); } finally { image.delete(); }
    return bitmap;
  };
  const argbToRgba = (colors, count) => { const out = new Uint8Array(count * 4); for (let i = 0; i < count; i++) { const c = colors[i] | 0; out[i * 4] = (c >> 16) & 255; out[i * 4 + 1] = (c >> 8) & 255; out[i * 4 + 2] = c & 255; out[i * 4 + 3] = (c >>> 24) & 255; } return out; };
  def(BITMAP, 'createBitmap', `([IIIIII${CONFIG})${BITMAP}`, (r, _m, [colors, offset, stride, width, height, config]) => {
    if (width <= 0 || height <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'width and height must be > 0');
    const source = r.array(colors).elements, flat = new Array(width * height);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) flat[row * width + col] = source[offset + row * stride + col];
    return fromPixels(r, width, height, argbToRgba(flat, flat.length), config, true);
  }, { static: true });
  def(BITMAP, 'createBitmap', `([III${CONFIG})${BITMAP}`, (r, _m, [colors, width, height, config]) => {
    if (width <= 0 || height <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'width and height must be > 0');
    const source = r.array(colors).elements; if (source.length < width * height) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', null);
    return fromPixels(r, width, height, argbToRgba(source, width * height), config, true);
  }, { static: true });
  const copyRegion = (r, source, x, y, width, height, destWidth, destHeight, transform, mutable, config) => {
    const host = bitmaps(r), s = state(r, source);
    const bitmap = host.create(destWidth, destHeight, config ?? s.config, s.hasAlpha, null, { mutable, hardware: configName(r, s) === 'HARDWARE' });
    const d = host.live(bitmap); d.density = s.density; r.storeField(r.object(bitmap).fields, `${BITMAP}->mDensity:I`, s.density);
    host.drawInto(d.handle, source, { src: [x, y, x + width, y + height], dst: transform ?? [0, 0, destWidth, destHeight] });
    return bitmap;
  };
  const checkSubset = (r, s, x, y, width, height) => {
    if (x < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'x must be >= 0'); if (y < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'y must be >= 0');
    if (width <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'width must be > 0'); if (height <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'height must be > 0');
    if (x + width > s.width) r.throwJava('Ljava/lang/IllegalArgumentException;', 'x + width must be <= bitmap.width()'); if (y + height > s.height) r.throwJava('Ljava/lang/IllegalArgumentException;', 'y + height must be <= bitmap.height()');
  };
  def(BITMAP, 'createBitmap', `(${BITMAP})${BITMAP}`, (r, _m, [source]) => { const s = state(r, source); return copyRegion(r, source, 0, 0, s.width, s.height, s.width, s.height, null, false, null); }, { static: true });
  def(BITMAP, 'createBitmap', `(${BITMAP}IIII)${BITMAP}`, (r, _m, [source, x, y, w, h]) => {
    const s = state(r, source); checkSubset(r, s, x, y, w, h);
    if (s.mutable === false && x === 0 && y === 0 && w === s.width && h === s.height) return source;
    return copyRegion(r, source, x, y, w, h, w, h, null, s.mutable !== false, null);
  }, { static: true });
  def(BITMAP, 'createBitmap', `(${BITMAP}IIII${MATRIX}Z)${BITMAP}`, (r, _m, [source, x, y, w, h, matrix, filter]) => {
    const s = state(r, source); checkSubset(r, s, x, y, w, h);
    const m = matrix === null ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : Array.from(bitmaps(r).matrixValues(r, matrix));
    const identity = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 && m[4] === 1 && m[5] === 0;
    if (identity && s.mutable === false && x === 0 && y === 0 && w === s.width && h === s.height) return source;
    if (identity) return copyRegion(r, source, x, y, w, h, w, h, null, s.mutable !== false, null);
    if (m[6] !== 0 || m[7] !== 0 || m[8] !== 1) fail('Bitmap.createBitmap with a perspective Matrix is not implemented');
    const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([px, py]) => [m[0] * px + m[1] * py + m[2], m[3] * px + m[4] * py + m[5]]);
    const left = Math.min(...corners.map(c => c[0])), top = Math.min(...corners.map(c => c[1])), right = Math.max(...corners.map(c => c[0])), bottom = Math.max(...corners.map(c => c[1]));
    const width = Math.max(1, Math.round(right - left)), height = Math.max(1, Math.round(bottom - top));
    const host = bitmaps(r), bitmap = host.create(width, height, s.config, true, null, { mutable: true }), d = host.live(bitmap);
    host.drawInto(d.handle, source, { src: [x, y, x + w, y + h], dst: [0, 0, w, h], transform: [m[0], m[1], m[2] - left, m[3], m[4], m[5] - top, 0, 0, 1] });
    d.mutable = s.mutable !== false; d.density = s.density; return bitmap;
  }, { static: true });
  def(BITMAP, 'createScaledBitmap', `(${BITMAP}IIZ)${BITMAP}`, (r, _m, [source, width, height, filter]) => {
    const s = state(r, source); if (width <= 0 || height <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'width and height must be > 0');
    if (width === s.width && height === s.height) return source;
    return copyRegion(r, source, 0, 0, s.width, s.height, width, height, null, true, null);
  }, { static: true });
  def(BITMAP, 'copy', `(${CONFIG}Z)${BITMAP}`, (r, _m, [self, config, mutable]) => {
    const s = state(r, self); if (config === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const name = r.object(config).enumName;
    if (name === 'HARDWARE' && mutable) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Hardware bitmaps are always immutable');
    if (!['ARGB_8888', 'HARDWARE'].includes(name)) fail(`Bitmap.copy to Config.${name} is not implemented`);
    return copyRegion(r, self, 0, 0, s.width, s.height, s.width, s.height, null, !!mutable, name === 'HARDWARE' ? config : null);
  });
  def(BITMAP, 'sameAs', `(${BITMAP})Z`, (r, _m, [self, other]) => {
    if (other === null) return 0; if (self === other) return 1;
    const a = state(r, self), b = state(r, other); if (a.width !== b.width || a.height !== b.height) return 0;
    const x = pixelsOf(r, self), y = pixelsOf(r, other); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return 0; return 1;
  });
  /** Bitmap.compress as Bitmap.cpp / SkEncodeImage do it (android-13.0.0_r1): PNG through CanvasKit; JPEG and WebP through libjpeg-turbo / libwebp with Skia's options. `pixels` are the lab's straight RGBA. */
  const encodeBitmap = (r, name, quality, pixels, width, height) => {
    if (name === 'PNG') {
      const canvasKit = CK(r), image = canvasKit.MakeImage({ width, height, alphaType: canvasKit.AlphaType.Unpremul, colorType: canvasKit.ColorType.RGBA_8888, colorSpace: canvasKit.ColorSpace.SRGB }, pixels, width * 4);
      if (!image) fail('Skia rejected the pixel buffer');
      try { return image.encodeToBytes(canvasKit.ImageFormat.PNG, 100); } finally { image.delete(); }
    }
    const codecs = r.skia?.codecs ?? fail(`${name} encoding needs the lab codec module (vendor/lab-codecs)${r.skia?.codecsError ? ': ' + r.skia.codecsError.message : ''}`);
    if (name === 'JPEG') return codecs.jpegEncode(premultiply(pixels), width, height, quality);   // Android's bitmaps are premultiplied and SkJpegEncoder ignores alpha
    // WEBP: lossless at quality 100 (SkEncodeImage), lossy otherwise; WEBP_LOSSY / WEBP_LOSSLESS are explicit; libwebp is handed unpremultiplied pixels converted from the premultiplied bitmap
    const lossless = name === 'WEBP_LOSSLESS' || (name === 'WEBP' && quality === 100), effort = name === 'WEBP' && quality === 100 ? 75 : quality;
    return codecs.webpEncode(unpremultiply(premultiply(pixels)), width, height, effort, lossless);
  };
  def(BITMAP, 'compress', `(${COMPRESS}I${OUTPUT})Z`, (r, _m, [self, format, quality, stream]) => {
    if (format === null || stream === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    if (quality < 0 || quality > 100) r.throwJava('Ljava/lang/IllegalArgumentException;', 'quality must be 0..100');
    const s = state(r, self), name = r.object(format).enumName, pixels = pixelsOf(r, self);
    const encoded = encodeBitmap(r, name, quality, pixels, s.width, s.height);
    if (!encoded) return 0;
    const array = r.newArray('[B', encoded.length); r.array(array).elements = Array.from(encoded, v => (v << 24) >> 24);
    vcall(r, stream, OUTPUT, 'write', ['[B', 'I', 'I'], 'V', [array, 0, encoded.length]); return 1;
  });
  def(BITMAP, 'getScaledWidth', '(I)I', (r, _m, [self, target]) => { const s = state(r, self); return s.density && target && s.density !== target ? Math.trunc(s.width * target / s.density + 0.5) : s.width; });
  def(BITMAP, 'getScaledHeight', '(I)I', (r, _m, [self, target]) => { const s = state(r, self); return s.density && target && s.density !== target ? Math.trunc(s.height * target / s.density + 0.5) : s.height; });
  def(BITMAP, 'getScaledWidth', `(${CANVAS})I`, (r, _m, [self]) => state(r, self).width);
  def(BITMAP, 'getScaledHeight', `(${CANVAS})I`, (r, _m, [self]) => state(r, self).height);
  def(BITMAP, 'setPremultiplied', '(Z)V', () => {});
  def(BITMAP, 'getGenerationId', '()I', (r, _m, [self]) => { const s = state(r, self); return getVectorGraphics(r).get(s.handle, 'canvas').draws.length + 1; });
  def(BITMAP, 'reconfigure', `(II${CONFIG})V`, (r, _m, [self, width, height, config]) => {
    const s = state(r, self); if (s.mutable === false) r.throwJava('Ljava/lang/IllegalStateException;', 'only mutable bitmaps may be reconfigured');
    if (width <= 0 || height <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'width and height must be > 0');
    if (width * height > s.width * s.height) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Bitmap not large enough to support new configuration');
    const canvas = getVectorGraphics(r).get(s.handle, 'canvas'); canvas.draws.length = 0; canvas.width = width; canvas.height = height; s.width = width; s.height = height;
    if (config !== null) s.config = config;
  });
  def(BITMAP, 'setWidth', '(I)V', (r, _m, [self, width]) => { const s = state(r, self); const canvas = getVectorGraphics(r).get(s.handle, 'canvas'); canvas.draws.length = 0; canvas.width = width; s.width = width; });
  def(BITMAP, 'setHeight', '(I)V', (r, _m, [self, height]) => { const s = state(r, self); const canvas = getVectorGraphics(r).get(s.handle, 'canvas'); canvas.draws.length = 0; canvas.height = height; s.height = height; });
  def(BITMAP, 'getNinePatchChunk', '()[B', () => null);
  def(BITMAP, 'setConfig', `(${CONFIG})V`, (r, _m, [self, config]) => { const s = state(r, self); if (config !== null && r.object(config).enumName !== 'ARGB_8888') fail('Bitmap.setConfig is only implemented for ARGB_8888'); });
  return { ...registry, interfaces: registry.interfacesOf, resourceFile, densityDefaults, decodeBytes: decode, DENSITY_DEFAULT, DENSITY_NONE };
}
