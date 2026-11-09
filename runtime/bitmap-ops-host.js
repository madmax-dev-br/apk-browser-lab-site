import { APKError } from './apk-error.js?v=308c7a12ce00';
import { floatBits } from './host-contract.js?v=308c7a12ce00';
import { getSolidPaint } from './paint-host.js?v=308c7a12ce00';
import { premultiply, unpremultiply } from './image-codecs.js?v=308c7a12ce00';

// The public android.graphics.Bitmap API (API 33) over the Skia-backed bitmap model of bitmap-host.js: construction (createBitmap overloads, createScaledBitmap, copy, extractAlpha), pixel access
// (getPixel(s)/setPixel(s)/getColor/copyPixelsTo|FromBuffer/eraseColor), reconfiguration, density, color space and compress(). Validation, messages and exceptions follow Bitmap.java / Bitmap.cpp of
// android-13.0.0_r1. Pixel reads are Skia read-backs of the bitmap's color type (RGB_565, RGBA_F16 and RGBA_1010102 rasterize on surfaces of their own type), pixel writes are recorded as exact pixel data.
const STRING = 'Ljava/lang/String;', BITMAP = 'Landroid/graphics/Bitmap;', CONFIG = 'Landroid/graphics/Bitmap$Config;', CANVAS = 'Landroid/graphics/Canvas;', COMPRESS = 'Landroid/graphics/Bitmap$CompressFormat;';
const OUTPUT = 'Ljava/io/OutputStream;', MATRIX = 'Landroid/graphics/Matrix;', PAINT = 'Landroid/graphics/Paint;', SPACE = 'Landroid/graphics/ColorSpace;', COLOR = 'Landroid/graphics/Color;', DM = 'Landroid/util/DisplayMetrics;', PICTURE = 'Landroid/graphics/Picture;', BUFFER = 'Ljava/nio/Buffer;';
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'bitmap-unsupported', ...details }); };

// ---- half floats and the sRGB transfer function (RGBA_F16 bitmaps hold sRGB-encoded extended-range components; linear spaces are converted on read) ----
const halfView = new DataView(new ArrayBuffer(4));
export const halfToFloat = h => { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15); };
export const floatToHalf = f => {
  if (Number.isNaN(f)) return 0x7e00;
  halfView.setFloat32(0, f, false); const x = halfView.getUint32(0, false), sign = (x >>> 16) & 0x8000; let exponent = ((x >>> 23) & 255) - 127 + 15, mantissa = x & 0x7fffff;
  if (exponent >= 31) return sign | 0x7c00;
  if (exponent <= 0) { if (exponent < -10) return sign; mantissa |= 0x800000; const shift = 14 - exponent; let half = mantissa >> shift; if ((mantissa >> (shift - 1)) & 1) half++; return sign | half; }
  let half = sign | (exponent << 10) | (mantissa >> 13); if (mantissa & 0x1000) half++; return half;
};
const eotf = v => { const a = Math.abs(v), l = a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4; return v < 0 ? -l : l; };
const oetf = v => { const a = Math.abs(v), e = a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055; return v < 0 ? -e : e; };

export function createBitmapOps(registry, { bitmaps, CK, vcall }) {
  const { def } = registry;
  const host = r => bitmaps(r), CONFIGS = ['ALPHA_8', 'RGB_565', 'ARGB_4444', 'ARGB_8888', 'RGBA_F16', 'HARDWARE', 'RGBA_1010102'];
  const iae = (r, message) => r.throwJava('Ljava/lang/IllegalArgumentException;', message), ise = (r, message) => r.throwJava('Ljava/lang/IllegalStateException;', message), aioobe = r => r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', null);
  const live = (r, ref, message) => host(r).live(ref, message);
  const name = (r, b) => host(r).configName(b);
  const configRef = (r, n) => host(r).enumValue(CONFIG, CONFIGS, n);
  const hardwareCheck = (r, b, what) => { if (b.hardware) ise(r, `unable to ${what}, pixel access is not supported on Config#HARDWARE bitmaps`); };
  const checkXYSign = (r, x, y) => { if (x < 0) iae(r, 'x must be >= 0'); if (y < 0) iae(r, 'y must be >= 0'); };
  const checkWidthHeight = (r, w, h) => { if (w <= 0) iae(r, 'width must be > 0'); if (h <= 0) iae(r, 'height must be > 0'); };
  const checkPixelAccess = (r, b, x, y) => { checkXYSign(r, x, y); if (x >= b.width) iae(r, 'x must be < bitmap.width()'); if (y >= b.height) iae(r, 'y must be < bitmap.height()'); };
  const checkPixelsAccess = (r, b, x, y, width, height, offset, stride, length) => {
    checkXYSign(r, x, y);
    if (width < 0) iae(r, 'width must be >= 0'); if (height < 0) iae(r, 'height must be >= 0');
    if (x + width > b.width) iae(r, 'x + width must be <= bitmap.width()'); if (y + height > b.height) iae(r, 'y + height must be <= bitmap.height()');
    if (Math.abs(stride) < width) iae(r, 'abs(stride) must be >= width');
    const lastScanline = offset + (height - 1) * stride;
    if (offset < 0 || offset + width > length || lastScanline < 0 || lastScanline + width > length) aioobe(r);
  };
  const argb = (px, i) => ((px[i * 4 + 3] << 24) | (px[i * 4] << 16) | (px[i * 4 + 1] << 8) | px[i * 4 + 2]) | 0;
  const toBytes = (colors, count, forceOpaque) => { const out = new Uint8Array(count * 4); for (let i = 0; i < count; i++) { const c = colors[i] | 0; out[i * 4] = (c >> 16) & 255; out[i * 4 + 1] = (c >> 8) & 255; out[i * 4 + 2] = c & 255; out[i * 4 + 3] = forceOpaque ? 255 : (c >>> 24) & 255; } return out; };
  const setDensity = (r, ref, density) => { host(r).state(ref).density = density; r.storeField(r.object(ref).fields, `${BITMAP}->mDensity:I`, density); };
  const inheritFrom = (r, dest, s) => { const d = host(r).state(dest); d.premultiplied = s.premultiplied; setDensity(r, dest, s.density); };
  const matrixOf = (r, matrix) => matrix === null ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : Array.from(host(r).matrixValues(r, matrix));
  const isIdentity = m => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 && m[4] === 1 && m[5] === 0 && m[6] === 0 && m[7] === 0 && m[8] === 1;
  const spaceNameOf = (r, space) => space === null ? null : r.object(space).colorSpaceName;

  // ---- construction ------------------------------------------------------------------------------------------------------------------------
  /** Bitmap.createBitmap(display, width, height, config, hasAlpha, colorSpace). */
  const createBlank = (r, display, width, height, config, hasAlpha, space) => {
    if (width <= 0 || height <= 0) iae(r, 'width and height must be > 0');
    if (config !== null && r.object(config).enumName === 'HARDWARE') iae(r, "can't create mutable bitmap with Config.HARDWARE");
    if (space === null && config !== null && r.object(config).enumName !== 'ALPHA_8') iae(r, "can't create bitmap without a color space");
    const bitmap = host(r).create(width, height, config, hasAlpha, space);
    if (display !== null) setDensity(r, bitmap, r.object(display).fields.get(`${DM}->densityDpi:I`) ?? 160);
    return bitmap;
  };
  const srgb = r => host(r).colorSpace('SRGB');
  const fromColors = (r, display, colors, offset, stride, width, height, config) => {
    checkWidthHeight(r, width, height);
    if (Math.abs(stride) < width) iae(r, 'abs(stride) must be >= width');
    const source = r.array(colors).elements, lastScanline = offset + (height - 1) * stride;
    if (offset < 0 || offset + width > source.length || lastScanline < 0 || lastScanline + width > source.length) aioobe(r);
    if (config !== null && r.object(config).enumName === 'HARDWARE') iae(r, "can't create mutable bitmap with Config.HARDWARE");
    const bitmap = host(r).create(width, height, config, true, null, { mutable: false }), flat = new Array(width * height);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) flat[row * width + col] = source[offset + row * stride + col];
    host(r).writeRect(host(r).state(bitmap), 0, 0, width, height, 'RGBA_8888', 'Unpremul', toBytes(flat, flat.length, false));
    if (display !== null) setDensity(r, bitmap, r.object(display).fields.get(`${DM}->densityDpi:I`) ?? 160);
    return bitmap;
  };
  /** Bitmap.createBitmap(source, x, y, width, height, m, filter): a copy through a Canvas, or `source` itself when it is immutable and nothing changes. */
  const subset = (r, source, x, y, width, height, matrix, filter) => {
    const h = host(r), s = live(r, source); checkXYSign(r, x, y); checkWidthHeight(r, width, height);
    if (x + width > s.width) iae(r, 'x + width must be <= bitmap.width()'); if (y + height > s.height) iae(r, 'y + height must be <= bitmap.height()');
    const m = matrixOf(r, matrix), identity = isIdentity(m);
    if (!s.mutable && x === 0 && y === 0 && width === s.width && height === s.height && identity) return source;
    const stored = h.storage(s), newName = stored === 'RGB_565' || stored === 'ALPHA_8' || stored === 'RGBA_F16' ? stored : 'ARGB_8888', spaceRef = stored === 'RGBA_F16' ? s.colorSpace : null;
    let dest, transform = null;
    if (identity) dest = h.create(width, height, configRef(r, newName), s.hasAlpha, spaceRef);
    else {
      if (m[6] !== 0 || m[7] !== 0 || m[8] !== 1) fail('Bitmap.createBitmap with a perspective Matrix is not implemented');
      const rectStaysRect = (m[1] === 0 && m[3] === 0) || (m[0] === 0 && m[4] === 0), transformed = !rectStaysRect;
      const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([px, py]) => [m[0] * px + m[1] * py + m[2], m[3] * px + m[4] * py + m[5]]);
      const left = Math.min(...corners.map(c => c[0])), top = Math.min(...corners.map(c => c[1])), right = Math.max(...corners.map(c => c[0])), bottom = Math.max(...corners.map(c => c[1]));
      const neww = Math.round(right - left), newh = Math.round(bottom - top), kept = newName === 'RGBA_F16' ? 'RGBA_F16' : 'ARGB_8888', config = transformed && newName !== 'ARGB_8888' && newName !== 'RGBA_F16' ? kept : newName;
      dest = h.create(neww, newh, configRef(r, config), transformed || s.hasAlpha, config === 'RGBA_F16' ? s.colorSpace : null);
      transform = [m[0], m[1], m[2] - left, m[3], m[4], m[5] - top, 0, 0, 1];
    }
    const d = h.state(dest);
    h.drawInto(d.handle, source, { src: [x, y, x + width, y + height], dst: [0, 0, width, height], transform, filter: !!filter && transform !== null });
    inheritFrom(r, dest, s);
    if (s.hardware) h.makeHardware(d);
    return dest;
  };
  def(BITMAP, 'createBitmap', `(II${CONFIG})${BITMAP}`, (r, _m, [w, h, config]) => createBlank(r, null, w, h, config, true, srgb(r)), { static: true });
  def(BITMAP, 'createBitmap', `(II${CONFIG}Z)${BITMAP}`, (r, _m, [w, h, config, alpha]) => createBlank(r, null, w, h, config, !!alpha, srgb(r)), { static: true });
  def(BITMAP, 'createBitmap', `(II${CONFIG}Z${SPACE})${BITMAP}`, (r, _m, [w, h, config, alpha, space]) => createBlank(r, null, w, h, config, !!alpha, space), { static: true });
  def(BITMAP, 'createBitmap', `(${DM}II${CONFIG})${BITMAP}`, (r, _m, [d, w, h, config]) => createBlank(r, d, w, h, config, true, srgb(r)), { static: true });
  def(BITMAP, 'createBitmap', `(${DM}II${CONFIG}Z)${BITMAP}`, (r, _m, [d, w, h, config, alpha]) => createBlank(r, d, w, h, config, !!alpha, srgb(r)), { static: true });
  def(BITMAP, 'createBitmap', `(${DM}II${CONFIG}Z${SPACE})${BITMAP}`, (r, _m, [d, w, h, config, alpha, space]) => createBlank(r, d, w, h, config, !!alpha, space), { static: true });
  def(BITMAP, 'createBitmap', `([IIIII${CONFIG})${BITMAP}`, (r, _m, [colors, offset, stride, w, h, config]) => fromColors(r, null, colors, offset, stride, w, h, config), { static: true });
  def(BITMAP, 'createBitmap', `([III${CONFIG})${BITMAP}`, (r, _m, [colors, w, h, config]) => fromColors(r, null, colors, 0, w, w, h, config), { static: true });
  def(BITMAP, 'createBitmap', `(${DM}[IIIII${CONFIG})${BITMAP}`, (r, _m, [d, colors, offset, stride, w, h, config]) => fromColors(r, d, colors, offset, stride, w, h, config), { static: true });
  def(BITMAP, 'createBitmap', `(${DM}[III${CONFIG})${BITMAP}`, (r, _m, [d, colors, w, h, config]) => fromColors(r, d, colors, 0, w, w, h, config), { static: true });
  def(BITMAP, 'createBitmap', `(${BITMAP})${BITMAP}`, (r, _m, [source]) => { const s = live(r, source); return subset(r, source, 0, 0, s.width, s.height, null, false); }, { static: true });
  def(BITMAP, 'createBitmap', `(${BITMAP}IIII)${BITMAP}`, (r, _m, [source, x, y, w, h]) => subset(r, source, x, y, w, h, null, false), { static: true });
  def(BITMAP, 'createBitmap', `(${BITMAP}IIII${MATRIX}Z)${BITMAP}`, (r, _m, [source, x, y, w, h, matrix, filter]) => subset(r, source, x, y, w, h, matrix, filter), { static: true });
  def(BITMAP, 'createScaledBitmap', `(${BITMAP}IIZ)${BITMAP}`, (r, _m, [source, dw, dh, filter]) => {
    const s = live(r, source), m = r.allocate(MATRIX); r.dispatch({ owner: MATRIX, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [m], 'direct');
    if (s.width !== dw || s.height !== dh) r.dispatch({ owner: MATRIX, name: 'setScale', parameters: ['F', 'F'], result: 'V', signature: '(FF)V' }, [m, floatBits(dw / s.width), floatBits(dh / s.height)], 'virtual');
    return subset(r, source, 0, 0, s.width, s.height, m, filter);
  }, { static: true });
  const pictureBitmap = (r, picture, width, height, config) => {
    if (width <= 0 || height <= 0) iae(r, 'width & height must be > 0');
    if (config === null) r.throwJava('Ljava/lang/NullPointerException;', 'Config must not be null');
    const hardware = r.object(config).enumName === 'HARDWARE', h = host(r), bitmap = h.create(width, height, hardware ? configRef(r, 'ARGB_8888') : config, true, null, { mutable: true });
    const canvas = r.allocate(CANVAS); r.dispatch({ owner: CANVAS, name: '<init>', parameters: [BITMAP], result: 'V', signature: `(${BITMAP})V` }, [canvas, bitmap], 'direct');
    const pw = vcall(r, picture, PICTURE, 'getWidth', [], 'I'), ph = vcall(r, picture, PICTURE, 'getHeight', [], 'I');
    if (pw !== width || ph !== height) vcall(r, canvas, CANVAS, 'scale', ['F', 'F'], 'V', [floatBits(width / pw), floatBits(height / ph)]);
    vcall(r, canvas, CANVAS, 'drawPicture', [PICTURE], 'V', [picture]);
    const d = h.state(bitmap); d.mutable = false; if (hardware) h.makeHardware(d);
    return bitmap;
  };
  def(BITMAP, 'createBitmap', `(${PICTURE})${BITMAP}`, (r, _m, [picture]) => pictureBitmap(r, picture, vcall(r, picture, PICTURE, 'getWidth', [], 'I'), vcall(r, picture, PICTURE, 'getHeight', [], 'I'), configRef(r, 'HARDWARE')), { static: true });
  def(BITMAP, 'createBitmap', `(${PICTURE}II${CONFIG})${BITMAP}`, (r, _m, [picture, w, h, config]) => pictureBitmap(r, picture, w, h, config), { static: true });
  def(BITMAP, 'copy', `(${CONFIG}Z)${BITMAP}`, (r, _m, [self, config, mutable]) => {
    const s = live(r, self, "Can't copy a recycled bitmap"), h = host(r);
    if (config === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const target = r.object(config).enumName;
    if (target === 'HARDWARE' && mutable) iae(r, 'Hardware bitmaps are always immutable');
    const concrete = target === 'HARDWARE' ? h.storage(s) : target === 'ARGB_4444' ? 'ARGB_8888' : target;
    const keepSpace = concrete === 'RGBA_F16' ? (h.storage(s) === 'RGBA_F16' ? s.colorSpace : null) : null;
    const dest = h.create(s.width, s.height, configRef(r, concrete), s.hasAlpha, keepSpace), d = h.state(dest);
    d.hasAlpha = concrete === 'RGB_565' ? false : s.hasAlpha;
    h.drawInto(d.handle, self, { src: [0, 0, s.width, s.height], dst: [0, 0, s.width, s.height] });
    inheritFrom(r, dest, s); d.mutable = !!mutable;
    if (target === 'HARDWARE') h.makeHardware(d);
    return dest;
  });
  def(BITMAP, 'extractAlpha', `()${BITMAP}`, (r, _m, [self]) => extractAlpha(r, self, null, null));
  def(BITMAP, 'extractAlpha', `(${PAINT}[I)${BITMAP}`, (r, _m, [self, paint, offset]) => extractAlpha(r, self, paint, offset));
  const extractAlpha = (r, self, paint, offsetXY) => {
    const s = live(r, self, "Can't extractAlpha on a recycled bitmap"), h = host(r);
    if (offsetXY !== null && r.array(offsetXY).elements.length < 2) iae(r, 'offsetXY must be null or have at least 2 elements');
    if (paint !== null) getSolidPaint(r, paint);   // a Paint with a MaskFilter (blur) would change the mask and its offset: refused by the Paint snapshot, never ignored
    const { straight } = h.read(s), n = s.width * s.height, bytes = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) bytes[i * 4 + 3] = straight[i * 4 + 3];
    const dest = h.create(s.width, s.height, configRef(r, 'ALPHA_8'), true, null, { mutable: true });
    h.writeRect(h.state(dest), 0, 0, s.width, s.height, 'RGBA_8888', 'Premul', bytes); setDensity(r, dest, s.density);
    if (offsetXY !== null) { const e = r.array(offsetXY).elements; e[0] = 0; e[1] = 0; }
    return dest;
  };

  // ---- pixel access ----------------------------------------------------------------------------------------------------------------------
  def(BITMAP, 'getPixel', '(II)I', (r, _m, [self, x, y]) => {
    const s = live(r, self, "Can't call getPixel() on a recycled bitmap"); hardwareCheck(r, s, 'getPixel()'); checkPixelAccess(r, s, x, y);
    return argb(host(r).read(s).straight, y * s.width + x);
  });
  def(BITMAP, 'getPixels', '([IIIIIII)V', (r, _m, [self, out, offset, stride, x, y, width, height]) => {
    const s = live(r, self, "Can't call getPixels() on a recycled bitmap"); if (width === 0 || height === 0) return;
    hardwareCheck(r, s, 'getPixels()'); checkPixelsAccess(r, s, x, y, width, height, offset, stride, r.array(out).elements.length);
    const target = r.array(out).elements, { straight } = host(r).read(s);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) target[offset + row * stride + col] = argb(straight, (y + row) * s.width + x + col);
  });
  /** Colors (ARGB ints) -> an exact pixel write of the region, in the bitmap's own rules (ALPHA_8 keeps alpha, a bitmap without alpha ignores it). */
  const writeColors = (r, s, x, y, w, h, colors) => {
    const hs = host(r), stored = hs.storage(s), bytes = toBytes(colors, w * h, !s.hasAlpha && stored !== 'ALPHA_8');
    if (stored === 'ALPHA_8') { for (let i = 0; i < w * h; i++) { bytes[i * 4] = bytes[i * 4 + 1] = bytes[i * 4 + 2] = 0; } hs.writeRect(s, x, y, w, h, 'RGBA_8888', 'Premul', bytes); return; }
    hs.writeRect(s, x, y, w, h, 'RGBA_8888', 'Unpremul', bytes);
  };
  def(BITMAP, 'setPixel', '(III)V', (r, _m, [self, x, y, color]) => {
    const s = live(r, self, "Can't call setPixel() on a recycled bitmap"); if (!s.mutable) ise(r, null);
    checkPixelAccess(r, s, x, y); writeColors(r, s, x, y, 1, 1, [color]);
  });
  def(BITMAP, 'setPixels', '([IIIIIII)V', (r, _m, [self, colors, offset, stride, x, y, width, height]) => {
    const s = live(r, self, "Can't call setPixels() on a recycled bitmap"); if (!s.mutable) ise(r, null);
    if (width === 0 || height === 0) return;
    checkPixelsAccess(r, s, x, y, width, height, offset, stride, r.array(colors).elements.length);
    const source = r.array(colors).elements, flat = new Array(width * height);
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) flat[row * width + col] = source[offset + row * stride + col];
    writeColors(r, s, x, y, width, height, flat);
  });
  const rawNative = (r, s) => { const hs = host(r), stored = hs.storage(s); if (stored === 'ALPHA_8') { const n = s.width * s.height, bytes = new Uint8Array(n * 4), { raw } = hs.read(s); for (let i = 0; i < n; i++) bytes[i * 4 + 3] = raw[i]; return { bytes, colorType: 'RGBA_8888', alphaType: 'Premul' }; } return { bytes: null, colorType: hs.colorTypeName(stored), alphaType: stored === 'RGB_565' ? 'Opaque' : 'Premul' }; };
  /** copyPixelsFromBuffer / copyPixelsToBuffer element shifts: Byte 0, Short 1, Int 2. */
  const shiftOf = (r, buffer) => r.isSubtype(r.typeOf(buffer), 'Ljava/nio/ByteBuffer;') ? 0 : r.isSubtype(r.typeOf(buffer), 'Ljava/nio/ShortBuffer;') ? 1 : r.isSubtype(r.typeOf(buffer), 'Ljava/nio/IntBuffer;') ? 2 : r.throwJava('Ljava/lang/RuntimeException;', 'unsupported Buffer subclass');
  const BUFFER_TYPES = ['Ljava/nio/ByteBuffer;', 'Ljava/nio/ShortBuffer;', 'Ljava/nio/IntBuffer;'], ARRAY_TYPES = ['[B', '[S', '[I'];
  const elementsFromBytes = (bytes, shift) => { const out = []; for (let i = 0; i + (1 << shift) <= bytes.length; i += 1 << shift) out.push(shift === 0 ? (bytes[i] << 24) >> 24 : shift === 1 ? ((bytes[i] | (bytes[i + 1] << 8)) << 16) >> 16 : (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) | 0); return out; };
  def(BITMAP, 'copyPixelsToBuffer', `(${BUFFER})V`, (r, _m, [self, dst]) => {
    const s = live(r, self, "Can't copy a recycled bitmap"); hardwareCheck(r, s, 'copyPixelsToBuffer');
    if (dst === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const shift = shiftOf(r, dst), elements = vcall(r, dst, BUFFER, 'remaining', [], 'I'), size = host(r).bytesPerPixel(s) * s.width * s.height;
    if (elements * 2 ** shift < size) r.throwJava('Ljava/lang/RuntimeException;', 'Buffer not large enough for pixels');
    if (size % (1 << shift)) fail(`Bitmap.copyPixelsToBuffer: ${size} bytes do not fill whole ${BUFFER_TYPES[shift]} elements`);
    const raw = host(r).read(s).raw, words = elementsFromBytes(raw, shift), array = r.newArray(ARRAY_TYPES[shift], words.length); r.array(array).elements = words;
    const owner = BUFFER_TYPES[shift];
    vcall(r, dst, owner, 'put', [ARRAY_TYPES[shift], 'I', 'I'], owner, [array, 0, words.length]);
  });
  def(BITMAP, 'copyPixelsFromBuffer', `(${BUFFER})V`, (r, _m, [self, src]) => {
    const s = live(r, self, 'copyPixelsFromBuffer called on recycled bitmap'); hardwareCheck(r, s, 'copyPixelsFromBuffer');
    if (src === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const hs = host(r), shift = shiftOf(r, src), elements = vcall(r, src, BUFFER, 'remaining', [], 'I'), size = hs.bytesPerPixel(s) * s.width * s.height;
    if (elements * 2 ** shift < size) r.throwJava('Ljava/lang/RuntimeException;', 'Buffer not large enough for pixels');
    if (size % (1 << shift)) fail(`Bitmap.copyPixelsFromBuffer: ${size} bytes do not fill whole ${BUFFER_TYPES[shift]} elements`);
    const count = size >> shift, array = r.newArray(ARRAY_TYPES[shift], count), owner = BUFFER_TYPES[shift];
    vcall(r, src, owner, 'get', [ARRAY_TYPES[shift], 'I', 'I'], owner, [array, 0, count]);
    const words = r.array(array).elements, bytes = new Uint8Array(size);
    for (let i = 0; i < count; i++) for (let k = 0; k < (1 << shift); k++) bytes[i * (1 << shift) + k] = (words[i] >> (8 * k)) & 255;
    const native = rawNative(r, s);
    if (native.bytes) { for (let i = 0; i < s.width * s.height; i++) native.bytes[i * 4 + 3] = bytes[i]; hs.writeRect(s, 0, 0, s.width, s.height, native.colorType, native.alphaType, native.bytes); }
    else hs.writeRect(s, 0, 0, s.width, s.height, native.colorType, native.alphaType, bytes);
  });
  /** Packed Color long (Color.pack): sRGB 8-bit, or four half-floats / 10-bit alpha plus a ColorSpace id. */
  const decodeColorLong = (r, packed) => {
    const c = BigInt.asUintN(64, BigInt(packed)), id = Number(c & 63n);
    if (id === 0) return { argb: Number((c >> 32n) & 0xffffffffn) | 0 };
    if (id > 3) fail(`Bitmap.eraseColor(long): ColorSpace id ${id} is not implemented (sRGB, linear sRGB and the extended variants are)`);
    const red = halfToFloat(Number((c >> 48n) & 0xffffn)), green = halfToFloat(Number((c >> 32n) & 0xffffn)), blue = halfToFloat(Number((c >> 16n) & 0xffffn)), alpha = Number((c >> 6n) & 0x3ffn) / 1023;
    const linear = id === 1 || id === 3, enc = v => linear ? oetf(v) : v;
    return { components: [enc(red), enc(green), enc(blue), alpha], extended: id >= 2 };
  };
  const erase = (r, self, color) => {
    const s = live(r, self, "Can't erase a recycled bitmap"); if (!s.mutable) ise(r, 'cannot erase immutable bitmaps');
    const h = host(r);
    if (color.components) {
      const [cr, cg, cb, ca] = color.components;
      if (h.storage(s) === 'RGBA_F16') {
        const n = s.width * s.height, bytes = new Uint8Array(n * 8), view = new DataView(bytes.buffer);
        for (let i = 0; i < n; i++) [cr, cg, cb, ca].forEach((v, k) => view.setUint16(i * 8 + k * 2, floatToHalf(v), true));
        h.reset(s); h.writeRect(s, 0, 0, s.width, s.height, 'RGBA_F16', 'Unpremul', bytes); return;
      }
      const q = v => Math.max(0, Math.min(255, Math.round(v * 255)));
      color = { argb: (q(ca) << 24 | q(cr) << 16 | q(cg) << 8 | q(cb)) | 0 };
    }
    h.reset(s);
    h.recordNative(s.handle, { op: 'color', color: color.argb, blendMode: 1 });
  };
  def(BITMAP, 'eraseColor', '(I)V', (r, _m, [self, c]) => erase(r, self, { argb: c | 0 }));
  def(BITMAP, 'eraseColor', '(J)V', (r, _m, [self, c]) => { live(r, self, "Can't erase a recycled bitmap"); erase(r, self, decodeColorLong(r, c)); });
  def(BITMAP, 'getColor', '(II)Landroid/graphics/Color;', (r, _m, [self, x, y]) => {
    const s = live(r, self, "Can't call getColor() on a recycled bitmap"); hardwareCheck(r, s, 'getColor()'); checkPixelAccess(r, s, x, y);
    const h = host(r);
    if (h.storage(s) !== 'RGBA_F16') return r.dispatch({ owner: COLOR, name: 'valueOf', parameters: ['I'], result: COLOR, signature: `(I)${COLOR}` }, [argb(h.read(s).straight, y * s.width + x)], 'static');
    const half = h.read(s, { half: true }).half, at = (y * s.width + x) * 8, view = new DataView(half.buffer, half.byteOffset, half.byteLength);
    const linear = h.SPACES[s.colorSpace && r.object(s.colorSpace).colorSpaceName]?.linear, c = [0, 1, 2].map(k => { const v = halfToFloat(view.getUint16(at + k * 2, true)); return linear ? eotf(v) : v; });
    return r.dispatch({ owner: COLOR, name: 'valueOf', parameters: ['F', 'F', 'F', 'F', SPACE], result: COLOR, signature: `(FFFF${SPACE})${COLOR}` }, [...c, halfToFloat(view.getUint16(at + 6, true))].map(floatBits).concat([s.colorSpace]), 'static');
  });

  // ---- sameAs, compress ------------------------------------------------------------------------------------------------------------------
  def(BITMAP, 'sameAs', `(${BITMAP})Z`, (r, _m, [self, other]) => {
    const a = live(r, self, "Can't call sameAs on a recycled bitmap!"); if (self === other) return 1; if (other === null) return 0;
    const b = host(r).state(other); if (b.recycled) iae(r, "Can't compare to a recycled bitmap!");
    const h = host(r); if (a.width !== b.width || a.height !== b.height || h.storage(a) !== h.storage(b)) return 0;
    const x = h.read(a, { half: true }), y = h.read(b, { half: true }); if (x.raw.length !== y.raw.length) return 0;
    for (let i = 0; i < x.raw.length; i++) if (x.raw[i] !== y.raw[i]) return 0;
    return 1;
  });
  /** Bitmap.compress as Bitmap.cpp / SkEncodeImage do it (android-13.0.0_r1): PNG through CanvasKit; JPEG and WebP through libjpeg-turbo / libwebp with Skia's options. `pixels` are the lab's straight RGBA. */
  const encodeBitmap = (r, format, quality, pixels, width, height) => {
    if (format === 'PNG') {
      const canvasKit = CK(r), image = canvasKit.MakeImage({ width, height, alphaType: canvasKit.AlphaType.Unpremul, colorType: canvasKit.ColorType.RGBA_8888, colorSpace: canvasKit.ColorSpace.SRGB }, pixels, width * 4);
      if (!image) fail('Skia rejected the pixel buffer');
      try { return image.encodeToBytes(canvasKit.ImageFormat.PNG, 100); } finally { image.delete(); }
    }
    const codecs = r.skia?.codecs ?? fail(`${format} encoding needs the lab codec module (vendor/lab-codecs)${r.skia?.codecsError ? ': ' + r.skia.codecsError.message : ''}`);
    if (format === 'JPEG') return codecs.jpegEncode(premultiply(pixels), width, height, quality);   // Android's bitmaps are premultiplied and SkJpegEncoder ignores alpha
    // WEBP: lossless at quality 100 (SkEncodeImage), lossy otherwise; WEBP_LOSSY / WEBP_LOSSLESS are explicit; libwebp is handed unpremultiplied pixels converted from the premultiplied bitmap
    const lossless = format === 'WEBP_LOSSLESS' || (format === 'WEBP' && quality === 100), effort = format === 'WEBP' && quality === 100 ? 75 : quality;
    return codecs.webpEncode(unpremultiply(premultiply(pixels)), width, height, effort, lossless);
  };
  def(BITMAP, 'compress', `(${COMPRESS}I${OUTPUT})Z`, (r, _m, [self, format, quality, stream]) => {
    const s = live(r, self, "Can't compress a recycled bitmap");
    if (stream === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    if (quality < 0 || quality > 100) iae(r, 'quality must be 0..100');
    if (format === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const h = host(r), formatName = r.object(format).enumName, stored = h.storage(s);
    if (stored === 'ALPHA_8' && formatName !== 'PNG') return 0;   // SkJpegEncoder / SkWebpEncoder have no ALPHA_8 input: SkEncodeImage fails and compress() returns false
    const encoded = encodeBitmap(r, formatName, quality, h.read(s).straight, s.width, s.height);
    if (!encoded) return 0;
    const array = r.newArray('[B', encoded.length); r.array(array).elements = Array.from(encoded, v => (v << 24) >> 24);
    vcall(r, stream, OUTPUT, 'write', ['[B', 'I', 'I'], 'V', [array, 0, encoded.length]); return 1;
  });

  // ---- properties ----------------------------------------------------------------------------------------------------------------------------
  const st = (r, ref) => host(r).state(ref);
  const scaleFromDensity = (size, sdensity, tdensity) => (sdensity === 0 || tdensity === 0 || sdensity === tdensity) ? size : Math.trunc(((size * tdensity) + (sdensity >> 1)) / sdensity);
  def(BITMAP, 'getWidth', '()I', (r, _m, [self]) => st(r, self).width);
  def(BITMAP, 'getHeight', '()I', (r, _m, [self]) => st(r, self).height);
  def(BITMAP, 'getConfig', `()${CONFIG}`, (r, _m, [self]) => st(r, self).config);
  def(BITMAP, 'hasAlpha', '()Z', (r, _m, [self]) => st(r, self).hasAlpha ? 1 : 0);
  def(BITMAP, 'setHasAlpha', '(Z)V', (r, _m, [self, alpha]) => { const s = live(r, self, 'setHasAlpha called on a recycled bitmap'); if (host(r).storage(s) !== 'RGB_565') { s.hasAlpha = !!alpha; s.px = null; } });
  def(BITMAP, 'isPremultiplied', '()Z', (r, _m, [self]) => { const s = st(r, self); return s.hasAlpha && s.premultiplied && host(r).storage(s) !== 'RGB_565' ? 1 : 0; });
  def(BITMAP, 'setPremultiplied', '(Z)V', (r, _m, [self, premultiplied]) => { live(r, self, 'setPremultiplied called on a recycled bitmap').premultiplied = !!premultiplied; });
  def(BITMAP, 'isMutable', '()Z', (r, _m, [self]) => st(r, self).mutable ? 1 : 0);
  def(BITMAP, 'isRecycled', '()Z', (r, _m, [self]) => st(r, self).recycled ? 1 : 0);
  def(BITMAP, 'recycle', '()V', (r, _m, [self]) => { st(r, self).recycled = true; });
  def(BITMAP, 'prepareToDraw', '()V', () => {});
  def(BITMAP, 'hasMipMap', '()Z', (r, _m, [self]) => { const s = st(r, self); if (s.recycled) ise(r, "Can't call hasMipMap() on a recycled bitmap"); return s.mipMap ? 1 : 0; });
  def(BITMAP, 'setHasMipMap', '(Z)V', (r, _m, [self, value]) => { live(r, self, "Can't call setHasMipMap() on a recycled bitmap").mipMap = !!value; });
  def(BITMAP, 'getDensity', '()I', (r, _m, [self]) => st(r, self).density);
  def(BITMAP, 'setDensity', '(I)V', (r, _m, [self, density]) => setDensity(r, self, density));
  def(BITMAP, 'getRowBytes', '()I', (r, _m, [self]) => { const s = st(r, self); return s.recycled ? 0 : s.width * host(r).bytesPerPixel(s); });
  def(BITMAP, 'getByteCount', '()I', (r, _m, [self]) => { const s = st(r, self); return s.recycled ? 0 : s.width * s.height * host(r).bytesPerPixel(s); });
  def(BITMAP, 'getAllocationByteCount', '()I', (r, _m, [self]) => { const s = st(r, self); return s.recycled ? 0 : s.allocBytes; });
  def(BITMAP, 'getGenerationId', '()I', (r, _m, [self]) => host(r).generation(st(r, self)));
  def(BITMAP, 'getScaledWidth', `(${CANVAS})I`, (r, _m, [self, canvas]) => { const s = st(r, self); return scaleFromDensity(s.width, s.density, r.object(canvas).fields.get(`${CANVAS}->mDensity:I`) ?? 0); });
  def(BITMAP, 'getScaledHeight', `(${CANVAS})I`, (r, _m, [self, canvas]) => { const s = st(r, self); return scaleFromDensity(s.height, s.density, r.object(canvas).fields.get(`${CANVAS}->mDensity:I`) ?? 0); });
  def(BITMAP, 'getScaledWidth', `(${DM})I`, (r, _m, [self, d]) => { const s = st(r, self); return scaleFromDensity(s.width, s.density, r.object(d).fields.get(`${DM}->densityDpi:I`) ?? 0); });
  def(BITMAP, 'getScaledHeight', `(${DM})I`, (r, _m, [self, d]) => { const s = st(r, self); return scaleFromDensity(s.height, s.density, r.object(d).fields.get(`${DM}->densityDpi:I`) ?? 0); });
  def(BITMAP, 'getScaledWidth', '(I)I', (r, _m, [self, target]) => { const s = st(r, self); return scaleFromDensity(s.width, s.density, target); });
  def(BITMAP, 'getScaledHeight', '(I)I', (r, _m, [self, target]) => { const s = st(r, self); return scaleFromDensity(s.height, s.density, target); });
  def(BITMAP, 'getNinePatchChunk', '()[B', () => null);
  def(BITMAP, 'getColorSpace', `()${SPACE}`, (r, _m, [self]) => live(r, self, "Can't getColorSpace on a recycled bitmap").colorSpace);
  def(BITMAP, 'setColorSpace', `(${SPACE})V`, (r, _m, [self, space]) => {
    const s = live(r, self, 'setColorSpace called on a recycled bitmap');
    if (space === null) iae(r, 'The colorSpace cannot be set to null');
    if (host(r).storage(s) === 'ALPHA_8') iae(r, 'Cannot set a ColorSpace on ALPHA_8');
    if (space !== s.colorSpace) fail(`Bitmap.setColorSpace(${spaceNameOf(r, space)}) is not implemented: the lab keeps each bitmap in its creation color space (${spaceNameOf(r, s.colorSpace)})`);
  });
  const reconfigure = (r, self, width, height, config) => {
    const s = live(r, self, "Can't call reconfigure() on a recycled bitmap");
    if (width <= 0 || height <= 0) iae(r, 'width and height must be > 0');
    if (!s.mutable) ise(r, 'only mutable bitmaps may be reconfigured');
    const h = host(r); let target = config === null ? h.storage(s) : r.object(config).enumName;
    if (target === 'ARGB_4444') target = 'ARGB_8888';
    if (target === 'HARDWARE') iae(r, "Can't reconfigure to Config.HARDWARE");
    if (width * height * h.CONFIG_INFO[target].bytes > s.allocBytes) iae(r, 'Bitmap not large enough to support new configuration');
    h.reset(s, width, height); s.config = configRef(r, target);
    if (target === 'RGB_565') s.hasAlpha = false;
    s.colorSpace = target === 'ALPHA_8' ? null : target === 'RGBA_F16' ? h.colorSpace('LINEAR_EXTENDED_SRGB') : h.colorSpace('SRGB');
  };
  def(BITMAP, 'reconfigure', `(II${CONFIG})V`, (r, _m, [self, w, h, config]) => reconfigure(r, self, w, h, config ?? r.throwJava('Ljava/lang/NullPointerException;', null)));
  def(BITMAP, 'setWidth', '(I)V', (r, _m, [self, w]) => reconfigure(r, self, w, st(r, self).height, st(r, self).config));
  def(BITMAP, 'setHeight', '(I)V', (r, _m, [self, h]) => reconfigure(r, self, st(r, self).width, h, st(r, self).config));
  def(BITMAP, 'setConfig', `(${CONFIG})V`, (r, _m, [self, config]) => { const s = st(r, self); reconfigure(r, self, s.width, s.height, config ?? r.throwJava('Ljava/lang/NullPointerException;', null)); });
  def(BITMAP, 'asShared', `()${BITMAP}`, () => fail('Bitmap.asShared: ashmem-shared bitmaps are not modeled by the lab'));
  def(BITMAP, 'wrapHardwareBuffer', `(Landroid/hardware/HardwareBuffer;${SPACE})${BITMAP}`, () => fail('Bitmap.wrapHardwareBuffer: HardwareBuffer is not modeled by the lab'), { static: true });
  def(BITMAP, 'describeContents', '()I', () => 0);
  def(BITMAP, 'writeToParcel', '(Landroid/os/Parcel;I)V', () => fail('Bitmap.writeToParcel: bitmaps are not parceled in the lab (no Parcel with ashmem/blob support)'));
  registry.staticField(BITMAP, 'CREATOR', 'Landroid/os/Parcelable$Creator;', () => fail('Bitmap.CREATOR: bitmaps are not parceled in the lab (no Parcel with ashmem/blob support)'));
  def(CONFIG, 'valueOf', `(${STRING})${CONFIG}`, (r, _m, [n]) => { const text = r.stringCharacters(n); if (!CONFIGS.includes(text)) iae(r, `No enum constant android.graphics.Bitmap.Config.${text}`); return configRef(r, text); }, { static: true });
  return { encodeBitmap, scaleFromDensity };
}
