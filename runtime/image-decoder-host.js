import { createHostRegistry } from './host-contract.js?v=f9d334aa7591';
import { APKError } from './apk-error.js?v=f9d334aa7591';

// android.graphics.ImageDecoder (API 28+, android-13.0.0_r1 ImageDecoder.java) over the lab's bitmap codec: a Source is the encoded bytes (byte[], ByteBuffer, File, raw resource, asset, content Uri,
// Callable<AssetFileDescriptor> is not modelled); decodeBitmap / decodeDrawable decode with BitmapFactory, call the OnHeaderDecodedListener with the decoder and the ImageInfo (size, mime type,
// animated flag) and then apply what the listener asked for, in the framework's order: target size / sample size, crop (in target coordinates), mutability. Hardware allocation is accepted and decodes
// to a software bitmap; post-processors need Canvas(Bitmap) and fail explicitly; an animated image decodes its first frame as a Bitmap and fails explicitly as a Drawable.
const ID = 'Landroid/graphics/ImageDecoder;', SOURCE = 'Landroid/graphics/ImageDecoder$Source;', INFO = 'Landroid/graphics/ImageDecoder$ImageInfo;', LISTENER = 'Landroid/graphics/ImageDecoder$OnHeaderDecodedListener;', DECODE_EXCEPTION = 'Landroid/graphics/ImageDecoder$DecodeException;';
const STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', BITMAP = 'Landroid/graphics/Bitmap;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', RECT = 'Landroid/graphics/Rect;', SIZE = 'Landroid/util/Size;';
const FACTORY = 'Landroid/graphics/BitmapFactory;', INPUT = 'Ljava/io/InputStream;', RESOURCES = 'Landroid/content/res/Resources;';
const nullish = v => v === null || v === undefined || v === 0;
const MIME = [['image/png', b => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47], ['image/jpeg', b => b[0] === 0xff && b[1] === 0xd8], ['image/gif', b => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46],
  ['image/webp', b => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50], ['image/bmp', b => b[0] === 0x42 && b[1] === 0x4d]];
const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/x-ico', 'image/vnd.wap.wbmp', 'image/heif', 'image/heic', 'image/x-adobe-dng']);

export function createImageDecoderHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  for (const [t, parent, ifaces, alloc] of [[ID, OBJECT, ['Ljava/lang/AutoCloseable;'], false], [SOURCE, OBJECT, [], false], [INFO, OBJECT, [], false], [DECODE_EXCEPTION, 'Ljava/io/IOException;', [], true]]) type(t, parent, ifaces, { allocatable: alloc });
  for (const [name, value] of [['ALLOCATOR_DEFAULT', 0], ['ALLOCATOR_SOFTWARE', 1], ['ALLOCATOR_SHARED_MEMORY', 2], ['ALLOCATOR_HARDWARE', 3], ['MEMORY_POLICY_DEFAULT', 1], ['MEMORY_POLICY_LOW_RAM', 0]]) staticField(ID, name, 'I', () => value);
  for (const [name, value] of [['SOURCE_EXCEPTION', 1], ['SOURCE_INCOMPLETE', 2], ['SOURCE_MALFORMED_DATA', 3]]) staticField(DECODE_EXCEPTION, name, 'I', () => value);
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const npe = (r, m = null) => r.throwJava('Ljava/lang/NullPointerException;', m);
  const iae = (r, m) => r.throwJava('Ljava/lang/IllegalArgumentException;', m);
  const ise = (r, m) => r.throwJava('Ljava/lang/IllegalStateException;', m);
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };
  const bytesArray = (r, bytes) => { const array = r.newArray('[B', bytes.length); r.array(array).elements = Array.from(bytes, v => (v << 24) >> 24); return array; };
  const readAll = (r, stream) => {
    const chunks = [], buffer = r.newArray('[B', 8192);
    try { for (;;) { const n = call(r, stream, INPUT, 'read', ['[B', 'I', 'I'], 'I', [buffer, 0, 8192]); if (n < 0) break; chunks.push(Uint8Array.from(r.array(buffer).elements.slice(0, n), v => v & 255)); } } finally { call(r, stream, INPUT, 'close', [], 'V'); }
    const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0)); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; } return out;
  };
  const source = (r, load, description) => { const o = r.makeObject(SOURCE); r.object(o).source = { load, description }; return o; };
  def(ID, 'createSource', '([B)' + SOURCE, (r, _m, [data]) => { if (nullish(data)) npe(r, 'data is null'); return source(r, () => Uint8Array.from(r.array(data).elements, v => v & 255), 'ByteArraySource'); }, { static: true });
  def(ID, 'createSource', '([BII)' + SOURCE, (r, _m, [data, offset, length]) => {
    if (nullish(data)) npe(r, 'data is null'); const size = r.array(data).elements.length;
    if (offset < 0 || length < 0 || offset > size || offset + length > size) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `invalid offset/length: offset ${offset} length ${length} size ${size}`);
    return source(r, () => Uint8Array.from(r.array(data).elements.slice(offset, offset + length), v => v & 255), 'ByteArraySource');
  }, { static: true });
  def(ID, 'createSource', `(Ljava/nio/ByteBuffer;)${SOURCE}`, (r, _m, [buffer]) => { if (nullish(buffer)) npe(r, 'buffer is null'); return source(r, () => { const dup = call(r, buffer, 'Ljava/nio/ByteBuffer;', 'duplicate', [], 'Ljava/nio/ByteBuffer;'), n = call(r, dup, 'Ljava/nio/Buffer;', 'remaining', [], 'I'), a = r.newArray('[B', n); call(r, dup, 'Ljava/nio/ByteBuffer;', 'get', ['[B'], 'Ljava/nio/ByteBuffer;', [a]); return Uint8Array.from(r.array(a).elements, v => v & 255); }, 'ByteBufferSource'); }, { static: true });
  def(ID, 'createSource', `(Ljava/io/File;)${SOURCE}`, (r, _m, [file]) => { if (nullish(file)) npe(r, 'file is null'); return source(r, () => readAll(r, construct(r, 'Ljava/io/FileInputStream;', ['Ljava/io/File;'], [file])), 'FileSource'); }, { static: true });
  def(ID, 'createSource', `(${RESOURCES}I)${SOURCE}`, (r, _m, [res, id]) => { if (nullish(res)) npe(r, 'res is null'); return source(r, () => readAll(r, call(r, res, RESOURCES, 'openRawResource', ['I'], INPUT, [id])), 'ResourceSource'); }, { static: true });
  // createSource(Resources, InputStream[, int density]): the stream's bytes with the density they are authored at (Bitmap.DENSITY_NONE when absent); decoding tags the bitmap with it.
  def(ID, 'createSource', `(${RESOURCES}${INPUT})${SOURCE}`, (r, _m, [res, stream]) => { if (nullish(res) || nullish(stream)) npe(r, 'res or is is null'); const o = source(r, () => readAll(r, stream), 'InputStream'); r.object(o).source.density = null; return o; });
  def(ID, 'createSource', `(${RESOURCES}${INPUT}I)${SOURCE}`, (r, _m, [res, stream, density]) => { if (nullish(res) || nullish(stream)) npe(r, 'res or is is null'); const o = source(r, () => readAll(r, stream), 'InputStream'); r.object(o).source.density = density; return o; });
  def(ID, 'createSource', `(Landroid/content/res/AssetManager;${STRING})${SOURCE}`, (r, _m, [assets, name]) => { if (nullish(assets) || nullish(name)) npe(r); return source(r, () => readAll(r, call(r, assets, 'Landroid/content/res/AssetManager;', 'open', [STRING], INPUT, [name])), 'AssetSource'); }, { static: true });
  def(ID, 'createSource', `(Landroid/content/ContentResolver;Landroid/net/Uri;)${SOURCE}`, (r, _m, [resolver, uri]) => { if (nullish(resolver) || nullish(uri)) npe(r); return source(r, () => readAll(r, call(r, resolver, 'Landroid/content/ContentResolver;', 'openInputStream', ['Landroid/net/Uri;'], INPUT, [uri])), 'ContentResolverSource'); }, { static: true });
  def(ID, 'createSource', `(Ljava/util/concurrent/Callable;)${SOURCE}`, () => unsupported('ImageDecoder.createSource(Callable<AssetFileDescriptor>): not modelled; use a File, byte[], ByteBuffer, resource, asset or content Uri source', 'image-source-unsupported'), { static: true });
  def(SOURCE, 'toString', `()${STRING}`, (r, _m, [self]) => r.object(self).source.description);
  def(ID, 'isMimeTypeSupported', `(${STRING})Z`, (r, _m, [mime]) => { if (nullish(mime)) npe(r, 'mimeType is null'); return SUPPORTED.has(r.stringCharacters(mime).toLowerCase()) ? 1 : 0; }, { static: true });

  const decodeFailure = (r, cause = 'Input contained an error.') => { const e = r.allocate(DECODE_EXCEPTION); r.object(e).decodeError = 3; r.throwJavaReference(e, `Failed to create image decoder with message 'unimplemented'${cause}`); };
  const state = (r, self) => { const s = r.object(self).decoder; if (!s) ise(r, 'ImageDecoder used outside its OnHeaderDecodedListener'); if (s.closed) ise(r, 'Cannot use closed ImageDecoder'); return s; };
  const run = (r, src, listener, asDrawable, tune = null) => {
    if (nullish(src)) npe(r, 'src is null'); const bytes = r.object(src).source.load(), mime = MIME.find(([, test]) => test(bytes))?.[0];
    if (!mime) decodeFailure(r);
    const data = bytesArray(r, bytes), bitmap = callStatic(r, FACTORY, 'decodeByteArray', ['[B', 'I', 'I'], BITMAP, [data, 0, bytes.length]);
    if (nullish(bitmap)) decodeFailure(r);
    const width = call(r, bitmap, BITMAP, 'getWidth', [], 'I'), height = call(r, bitmap, BITMAP, 'getHeight', [], 'I'), animated = mime === 'image/gif' && bytes.length > 12 && countGifFrames(bytes) > 1;
    const decoder = r.makeObject(ID), s = { width, height, sample: 1, target: null, crop: null, mutable: false, allocator: 0, memoryPolicy: 1, unpremul: false, alpha: false, post: null, partial: null, closed: false };
    r.object(decoder).decoder = s;
    if (!nullish(listener)) {
      const info = r.makeObject(INFO); r.object(info).info = { width, height, mime, animated };
      try { call(r, listener, LISTENER, 'onHeaderDecoded', [ID, INFO, SOURCE], 'V', [decoder, info, src]); } finally { s.listenerDone = true; }
    }
    tune?.(s);
    if (s.post) unsupported('ImageDecoder.setPostProcessor: post-processors draw on a Canvas over the decoded bitmap, which the lab cannot create (Canvas(Bitmap))', 'image-post-processor-unsupported');
    if (s.alpha) unsupported('ImageDecoder.setDecodeAsAlphaMaskEnabled: A8 alpha-mask decoding is not modelled', 'image-alpha-mask-unsupported');
    if (asDrawable && animated) unsupported('ImageDecoder.decodeDrawable of an animated image (AnimatedImageDrawable) is not modelled; decodeBitmap returns the first frame', 'animated-image-unsupported');
    let out = bitmap; const tw = s.target ? s.target[0] : Math.max(1, Math.floor(width / s.sample)), th = s.target ? s.target[1] : Math.max(1, Math.floor(height / s.sample));
    if (tw !== width || th !== height) out = callStatic(r, BITMAP, 'createScaledBitmap', [BITMAP, 'I', 'I', 'Z'], BITMAP, [out, tw, th, 1]);
    if (s.crop) { const [l, t, rr, b] = s.crop; out = callStatic(r, BITMAP, 'createBitmap', [BITMAP, 'I', 'I', 'I', 'I'], BITMAP, [out, l, t, rr - l, b - t]); }
    if (s.mutable && !call(r, out, BITMAP, 'isMutable', [], 'Z')) out = call(r, out, BITMAP, 'copy', ['Landroid/graphics/Bitmap$Config;', 'Z'], BITMAP, [call(r, out, BITMAP, 'getConfig', [], 'Landroid/graphics/Bitmap$Config;'), 1]);
    const density = r.object(src).source.density;
    if (density !== undefined && density !== null) {   // ImageDecoder.computeDensity: the bitmap carries the source density; a source at another density than the display is resized to the display density
      const display = 160;   // the lab's display density (DisplayMetrics.densityDpi of the 160 dpi device profile)
      if (density !== 0 && density !== display && !s.target) { const w = Math.max(1, Math.round(width * display / density)), h = Math.max(1, Math.round(height * display / density)); out = callStatic(r, BITMAP, 'createScaledBitmap', [BITMAP, 'I', 'I', 'Z'], BITMAP, [out, w, h, 1]); call(r, out, BITMAP, 'setDensity', ['I'], 'V', [display]); }
      else call(r, out, BITMAP, 'setDensity', ['I'], 'V', [density]);
    }
    s.closed = true;
    return asDrawable ? construct(r, 'Landroid/graphics/drawable/BitmapDrawable;', [RESOURCES, BITMAP], [call(r, platform.application, 'Landroid/content/Context;', 'getResources', [], RESOURCES), out]) : out;
  };
  const countGifFrames = bytes => { let frames = 0; for (let i = 0; i < bytes.length - 3; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++; return frames; };
  // ContentResolver.loadThumbnail(Uri, Size, CancellationSignal) (android-13.0.0_r1 ContentResolver.loadThumbnail): ask the provider for an "image/*" asset with EXTRA_SIZE, then decode it, scaling down by an
  // integer sample when the provider returned something larger than requested. The MediaStore fallback (content://media) does not exist on the virtual device.
  const RESOLVER_T = 'Landroid/content/ContentResolver;', URI_T = 'Landroid/net/Uri;', SIZE_T = 'Landroid/util/Size;', SIGNAL_T = 'Landroid/os/CancellationSignal;', BUNDLE_T = 'Landroid/os/Bundle;', AFD_T = 'Landroid/content/res/AssetFileDescriptor;';
  def(RESOLVER_T, 'loadThumbnail', `(${URI_T}${SIZE_T}${SIGNAL_T})${BITMAP}`, (r, _m, [resolver, uri, size, signal]) => {
    if (nullish(uri)) npe(r, 'uri'); if (nullish(size)) npe(r, 'size');
    const width = call(r, size, SIZE_T, 'getWidth', [], 'I'), height = call(r, size, SIZE_T, 'getHeight', [], 'I');
    const opts = construct(r, BUNDLE_T, [], []), point = construct(r, 'Landroid/graphics/Point;', ['I', 'I'], [width, height]);
    call(r, opts, BUNDLE_T, 'putParcelable', [STRING, 'Landroid/os/Parcelable;'], 'V', ['android.content.extra.SIZE', point]);
    const afd = call(r, resolver, RESOLVER_T, 'openTypedAssetFileDescriptor', [URI_T, STRING, BUNDLE_T, SIGNAL_T], AFD_T, [uri, 'image/*', opts, signal]);
    if (nullish(afd)) r.throwJava('Ljava/io/FileNotFoundException;', `No image thumbnail available for ${r.stringCharacters(call(r, uri, URI_T, 'toString', [], STRING))}`);
    const bytes = readAll(r, call(r, afd, AFD_T, 'createInputStream', [], 'Ljava/io/FileInputStream;'));
    if (!nullish(signal)) call(r, signal, SIGNAL_T, 'throwIfCanceled', [], 'V');
    return run(r, source(r, () => bytes, 'AssetFileDescriptorSource'), null, false, s => { const sample = Math.min(Math.floor(s.width / width), Math.floor(s.height / height)); if (sample > 1) s.sample = sample; });
  });
  def(ID, 'decodeBitmap', `(${SOURCE})${BITMAP}`, (r, _m, [src]) => run(r, src, null, false), { static: true });
  def(ID, 'decodeBitmap', `(${SOURCE}${LISTENER})${BITMAP}`, (r, _m, [src, listener]) => run(r, src, listener, false), { static: true });
  def(ID, 'decodeDrawable', `(${SOURCE})${DRAWABLE}`, (r, _m, [src]) => run(r, src, null, true), { static: true });
  def(ID, 'decodeDrawable', `(${SOURCE}${LISTENER})${DRAWABLE}`, (r, _m, [src, listener]) => run(r, src, listener, true), { static: true });
  def(ID, 'setTargetSize', '(II)V', (r, _m, [self, w, h]) => { const s = state(r, self); if (w < 1 || h < 1) iae(r, `Dimensions must be positive! width = ${w}, height = ${h}`); s.target = [w, h]; });
  def(ID, 'setTargetSampleSize', '(I)V', (r, _m, [self, n]) => { const s = state(r, self); if (n < 1) iae(r, `sampleSize must be positive! ${n}`); s.sample = n; s.target = null; });
  def(ID, 'setCrop', `(${RECT})V`, (r, _m, [self, rect]) => {
    const s = state(r, self); if (nullish(rect)) { s.crop = null; return; }
    const f = k => r.object(rect).fields.get(`${RECT}->${k}:I`) ?? 0, crop = [f('left'), f('top'), f('right'), f('bottom')], tw = s.target ? s.target[0] : Math.max(1, Math.floor(s.width / s.sample)), th = s.target ? s.target[1] : Math.max(1, Math.floor(s.height / s.sample));
    if (crop[0] < 0 || crop[1] < 0 || crop[2] > tw || crop[3] > th || crop[2] <= crop[0] || crop[3] <= crop[1]) iae(r, 'Invalid crop rect ' + crop.join(',') + ' for the target size ' + tw + 'x' + th);
    s.crop = crop;
  });
  def(ID, 'getCrop', `()${RECT}`, (r, _m, [self]) => { const s = state(r, self); if (!s.crop) return null; return construct(r, RECT, ['I', 'I', 'I', 'I'], s.crop); });
  def(ID, 'setMutableRequired', '(Z)V', (r, _m, [self, v]) => { state(r, self).mutable = !!v; }); def(ID, 'isMutableRequired', '()Z', (r, _m, [self]) => state(r, self).mutable ? 1 : 0);
  def(ID, 'setAllocator', '(I)V', (r, _m, [self, a]) => { if (a < 0 || a > 3) iae(r, `invalid allocator ${a}`); state(r, self).allocator = a; }); def(ID, 'getAllocator', '()I', (r, _m, [self]) => state(r, self).allocator);
  def(ID, 'setMemorySizePolicy', '(I)V', (r, _m, [self, p]) => { state(r, self).memoryPolicy = p; }); def(ID, 'getMemorySizePolicy', '()I', (r, _m, [self]) => state(r, self).memoryPolicy);
  def(ID, 'setUnpremultipliedRequired', '(Z)V', (r, _m, [self, v]) => { state(r, self).unpremul = !!v; }); def(ID, 'isUnpremultipliedRequired', '()Z', (r, _m, [self]) => state(r, self).unpremul ? 1 : 0);
  def(ID, 'setDecodeAsAlphaMaskEnabled', '(Z)V', (r, _m, [self, v]) => { state(r, self).alpha = !!v; }); def(ID, 'isDecodeAsAlphaMaskEnabled', '()Z', (r, _m, [self]) => state(r, self).alpha ? 1 : 0);
  def(ID, 'setTargetColorSpace', '(Landroid/graphics/ColorSpace;)V', (r, _m, [self]) => { state(r, self); });   // pixels stay sRGB: the lab composes in sRGB
  def(ID, 'setPostProcessor', '(Landroid/graphics/PostProcessor;)V', (r, _m, [self, p]) => { state(r, self).post = nullish(p) ? null : p; }); def(ID, 'getPostProcessor', '()Landroid/graphics/PostProcessor;', (r, _m, [self]) => state(r, self).post);
  def(ID, 'setOnPartialImageListener', '(Landroid/graphics/ImageDecoder$OnPartialImageListener;)V', (r, _m, [self, l]) => { state(r, self).partial = nullish(l) ? null : l; }); def(ID, 'getOnPartialImageListener', '()Landroid/graphics/ImageDecoder$OnPartialImageListener;', (r, _m, [self]) => state(r, self).partial);
  def(ID, 'close', '()V', (r, _m, [self]) => { const s = r.object(self).decoder; if (s) s.closed = true; });
  def(ID, 'toString', `()${STRING}`, (r, _m, [self]) => `ImageDecoder{${r.object(self).decoder?.width}x${r.object(self).decoder?.height}}`);
  const info = (r, self) => r.object(self).info;
  def(INFO, 'getSize', `()${SIZE}`, (r, _m, [self]) => construct(r, SIZE, ['I', 'I'], [info(r, self).width, info(r, self).height]));
  def(INFO, 'getMimeType', `()${STRING}`, (r, _m, [self]) => info(r, self).mime); def(INFO, 'isAnimated', '()Z', (r, _m, [self]) => info(r, self).animated ? 1 : 0);
  def(INFO, 'getColorSpace', '()Landroid/graphics/ColorSpace;', () => null);
  def(INFO, 'toString', `()${STRING}`, (r, _m, [self]) => `ImageInfo{${info(r, self).width}x${info(r, self).height}, ${info(r, self).mime}}`);
  def(DECODE_EXCEPTION, 'getError', '()I', (r, _m, [self]) => r.object(self).decodeError ?? 3); def(DECODE_EXCEPTION, 'getSource', `()${SOURCE}`, () => null);
  return registry;
}
