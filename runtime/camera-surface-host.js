import { APKError } from './apk-error.js?v=aaf994ef49d6';
import { bitsFloat, floatBits } from './host-contract.js?v=aaf994ef49d6';
import { FORMAT, rgbaToYuv420, withExifOrientation, exifOrientation } from './camera-frames.js?v=aaf994ef49d6';
import { ByteCells } from './java-arrays.js?v=aaf994ef49d6';

// The consumers a camera stream ends in (android-13.0.0_r1 TextureView.java, SurfaceView.java, SurfaceHolder.java, ImageReader.java, Image.java), over the lab's frame path:
//
//   TextureView / SurfaceView   real Views of the VM (measure, layout, visibility come from the View model). Their pixels never enter the Worker: the snapshot node carries a
//                               `cameraSurface` payload and the page draws the camera source into the View's element (src/camera-source.js). What the VM gives the app is the
//                               life cycle: onSurfaceTextureAvailable / SizeChanged / Updated / Destroyed, surfaceCreated / Changed / Destroyed, and a Surface to hand to the camera.
//   ImageReader                 the only consumer whose frames reach the app as bytes. The page sends an RGBA buffer per frame only while a request targets a reader
//                               (src/camera-host.js); an Image exposes it as YUV_420_888 planes (converted when getPlanes() is called) or as a JPEG stream encoded by the lab's
//                               libjpeg-turbo, with the request's JPEG_ORIENTATION written as the Exif Orientation tag, as a camera HAL does.
//
// Not provided, failing with the VM's explicit unsupported-API error: lockCanvas / lockHardwareCanvas on these surfaces (no producer other than the camera), TextureView.getBitmap
// (the pixels are in the page, see the def below), ImageReader formats the virtual camera does not produce, Image.getHardwareBuffer.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', VIEW = 'Landroid/view/View;', CONTEXT = 'Landroid/content/Context;', ATTRS = 'Landroid/util/AttributeSet;', HANDLER = 'Landroid/os/Handler;';
export const TEXTURE_VIEW = 'Landroid/view/TextureView;', SURFACE_VIEW = 'Landroid/view/SurfaceView;', SURFACE = 'Landroid/view/Surface;', SURFACE_TEXTURE = 'Landroid/graphics/SurfaceTexture;';
const TEXTURE_LISTENER = 'Landroid/view/TextureView$SurfaceTextureListener;', HOLDER = 'Landroid/view/SurfaceHolder;', HOLDER_CALLBACK = 'Landroid/view/SurfaceHolder$Callback;', HOLDER_CALLBACK2 = 'Landroid/view/SurfaceHolder$Callback2;';
const HOLDER_IMPL = 'Landroid/view/SurfaceView$LabSurfaceHolder;', MATRIX = 'Landroid/graphics/Matrix;', RECT = 'Landroid/graphics/Rect;', BITMAP = 'Landroid/graphics/Bitmap;';
export const IMAGE_READER = 'Landroid/media/ImageReader;';
const IMAGE = 'Landroid/media/Image;', PLANE = 'Landroid/media/Image$Plane;', IMAGE_IMPL = 'Landroid/media/ImageReader$SurfaceImage;', PLANE_IMPL = 'Landroid/media/ImageReader$SurfaceImage$SurfacePlane;';
const IMAGE_LISTENER = 'Landroid/media/ImageReader$OnImageAvailableListener;', BYTE_BUFFER = 'Ljava/nio/ByteBuffer;';
const PIXEL_FORMAT_RGB_565 = 4, VISIBLE = 0;
const nullish = value => value === null || value === undefined || value === 0;

export function installCameraSurfaces({ platform, registry, post, targetFor }) {
  const { def, type } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters = [], args = []) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const size = view => { const b = view.bounds; return b ? { width: Math.max(0, b.right - b.left), height: Math.max(0, b.bottom - b.top) } : { width: 0, height: 0 }; };
  const shown = view => !!view.attached && (view.visibility ?? VISIBLE) === VISIBLE;
  const viewInit = (owner, parameters, after) => def(owner, '<init>', `(${parameters.join('')})V`, (r, _m, args) => {
    r.dispatch({ owner: VIEW, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, args.slice(0, 1 + parameters.length), 'direct');
    after(r, args[0]);
  });

  // ---- TextureView --------------------------------------------------------------------------------------------------------------------------------------------------------
  type(TEXTURE_VIEW, VIEW, [], { allocatable: true }); type(TEXTURE_LISTENER, OBJECT);
  const textureView = (r, self) => r.object(self).textureView;
  for (const parameters of [[CONTEXT], [CONTEXT, ATTRS], [CONTEXT, ATTRS, 'I'], [CONTEXT, ATTRS, 'I', 'I']]) viewInit(TEXTURE_VIEW, parameters, (r, self) => { r.object(self).textureView = { listener: null, texture: null, opaque: true, transform: null, pending: false }; });
  /** TextureView.getTextureLayer: the first draw of an attached, laid-out, visible TextureView creates its SurfaceTexture and tells the listener. */
  const ensureTexture = (r, self) => {
    const view = r.object(self), state = view.textureView; if (!state || state.texture || state.pending || !shown(view)) return;
    const { width, height } = size(view); if (!(width > 0 && height > 0)) return;
    state.pending = true;
    platform.queueTask(() => {
      state.pending = false; const now = size(view); if (state.texture || !shown(view) || !(now.width > 0 && now.height > 0)) return;
      const texture = construct(r, SURFACE_TEXTURE, ['Z'], [0]); r.object(texture).texture.ownerView = self;
      call(r, texture, SURFACE_TEXTURE, 'setDefaultBufferSize', ['I', 'I'], 'V', [now.width, now.height]);
      state.texture = texture; r.record(`CAMERA TextureView ${view.id} surface available ${now.width}x${now.height}`);
      if (!nullish(state.listener)) call(r, state.listener, TEXTURE_LISTENER, 'onSurfaceTextureAvailable', [SURFACE_TEXTURE, 'I', 'I'], 'V', [texture, now.width, now.height]);
      platform.requestDraw?.(r, self);
    }, 0, [self]);
  };
  const destroyTexture = (r, self) => {
    const state = textureView(r, self); if (!state?.texture) return;
    const texture = state.texture; let release = true;
    if (!nullish(state.listener)) release = !!call(r, state.listener, TEXTURE_LISTENER, 'onSurfaceTextureDestroyed', [SURFACE_TEXTURE], 'Z', [texture]);
    if (release) call(r, texture, SURFACE_TEXTURE, 'release', [], 'V');
    state.texture = null;
  };
  def(TEXTURE_VIEW, 'setSurfaceTextureListener', `(${TEXTURE_LISTENER})V`, (r, _m, [self, listener]) => { textureView(r, self).listener = nullish(listener) ? null : listener; });
  def(TEXTURE_VIEW, 'getSurfaceTextureListener', `()${TEXTURE_LISTENER}`, (r, _m, [self]) => textureView(r, self).listener);
  def(TEXTURE_VIEW, 'getSurfaceTexture', `()${SURFACE_TEXTURE}`, (r, _m, [self]) => textureView(r, self).texture);
  def(TEXTURE_VIEW, 'isAvailable', '()Z', (r, _m, [self]) => (textureView(r, self).texture ? 1 : 0));
  def(TEXTURE_VIEW, 'setSurfaceTexture', `(${SURFACE_TEXTURE})V`, (r, _m, [self, texture]) => {
    if (nullish(texture)) r.throwJava('Ljava/lang/NullPointerException;', 'surfaceTexture must not be null');
    const state = textureView(r, self); if (state.texture && state.texture.ref === texture.ref) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Trying to setSurfaceTexture to the same SurfaceTexture that\'s already set.');
    if (r.object(texture).texture?.released) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Cannot setSurfaceTexture to a released SurfaceTexture');
    if (state.texture) call(r, state.texture, SURFACE_TEXTURE, 'release', [], 'V');
    state.texture = texture; r.object(texture).texture.ownerView = self; platform.requestDraw?.(r, self);
  });
  def(TEXTURE_VIEW, 'setOpaque', '(Z)V', (r, _m, [self, opaque]) => { textureView(r, self).opaque = !!opaque; platform.requestDraw?.(r, self); });
  def(TEXTURE_VIEW, 'isOpaque', '()Z', (r, _m, [self]) => (textureView(r, self).opaque ? 1 : 0));
  def(TEXTURE_VIEW, 'getLayerType', '()I', () => 2);   // LAYER_TYPE_HARDWARE, always
  def(TEXTURE_VIEW, 'setLayerType', '(ILandroid/graphics/Paint;)V', () => {});   // TextureView ignores the type
  def(TEXTURE_VIEW, 'buildLayer', '()V', () => {});
  def(TEXTURE_VIEW, 'setTransform', `(${MATRIX})V`, (r, _m, [self, matrix]) => {
    const state = textureView(r, self);
    if (nullish(matrix)) state.transform = null;
    else { const values = r.newArray('[F', 9); call(r, matrix, MATRIX, 'getValues', ['[F'], 'V', [values]); state.transform = Array.from(r.array(values).elements, bitsFloat); }
    platform.requestDraw?.(r, self);
  });
  def(TEXTURE_VIEW, 'getTransform', `(${MATRIX})${MATRIX}`, (r, _m, [self, into]) => {
    const out = nullish(into) ? construct(r, MATRIX) : into, values = r.newArray('[F', 9);
    r.array(values).elements = (textureView(r, self).transform ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]).map(floatBits); call(r, out, MATRIX, 'setValues', ['[F'], 'V', [values]); return out;
  });
  const noBitmap = () => { throw new APKError('android.view.TextureView.getBitmap is not provided: the frames a TextureView shows are drawn by the page and never copied into the VM; read frames through an ImageReader target instead', { kind: 'camera-unsupported', method: 'TextureView.getBitmap' }); };
  def(TEXTURE_VIEW, 'getBitmap', `()${BITMAP}`, noBitmap); def(TEXTURE_VIEW, 'getBitmap', `(II)${BITMAP}`, noBitmap); def(TEXTURE_VIEW, 'getBitmap', `(${BITMAP})${BITMAP}`, noBitmap);
  def(TEXTURE_VIEW, 'onAttachedToWindow', '()V', (r, _m, [self]) => ensureTexture(r, self));
  def(TEXTURE_VIEW, 'onDetachedFromWindow', '()V', (r, _m, [self]) => destroyTexture(r, self));
  def(TEXTURE_VIEW, 'onVisibilityChanged', `(${VIEW}I)V`, (r, _m, [self]) => ensureTexture(r, self));
  def(TEXTURE_VIEW, 'onSizeChanged', '(IIII)V', (r, _m, [self, width, height]) => {
    const state = textureView(r, self); if (!state) return;
    if (!state.texture) { ensureTexture(r, self); return; }
    call(r, state.texture, SURFACE_TEXTURE, 'setDefaultBufferSize', ['I', 'I'], 'V', [width, height]);
    if (!nullish(state.listener)) call(r, state.listener, TEXTURE_LISTENER, 'onSurfaceTextureSizeChanged', [SURFACE_TEXTURE, 'I', 'I'], 'V', [state.texture, width, height]);
  });

  // ---- SurfaceView and its SurfaceHolder ------------------------------------------------------------------------------------------------------------------------------------
  type(SURFACE_VIEW, VIEW, [], { allocatable: true }); type(HOLDER, OBJECT); type(HOLDER_CALLBACK, OBJECT); type(HOLDER_CALLBACK2, OBJECT, [HOLDER_CALLBACK]); type(HOLDER_IMPL, OBJECT, [HOLDER], { allocatable: true });
  const surfaceView = (r, self) => r.object(self).surfaceView;
  for (const parameters of [[CONTEXT], [CONTEXT, ATTRS], [CONTEXT, ATTRS, 'I'], [CONTEXT, ATTRS, 'I', 'I']]) viewInit(SURFACE_VIEW, parameters, (r, self) => {
    const surface = construct(r, SURFACE), state = { holder: null, callbacks: [], surface, created: false, format: PIXEL_FORMAT_RGB_565, fixed: null, pending: false, sink: { kind: 'holder', view: self, stream: null, shots: 0 } };
    state.sink.valid = () => state.created; r.object(surface).surface.sink = state.sink; r.object(surface).surface.name = null;
    r.object(self).surfaceView = state;
  });
  const holderSize = (view, state) => state.fixed ?? size(view);
  const tellHolder = (r, state, name, parameters, args) => { for (const callback of [...state.callbacks]) call(r, callback, HOLDER_CALLBACK, name, [HOLDER, ...parameters], 'V', [state.holder, ...args]); };
  /** SurfaceView.updateSurface: the surface exists while the View is attached, visible and has a size; a new size is a surfaceChanged. */
  const updateSurface = (r, self) => {
    const view = r.object(self), state = view.surfaceView; if (!state || state.pending) return;
    state.pending = true;
    platform.queueTask(() => {
      state.pending = false; const { width, height } = holderSize(view, state), wanted = shown(view) && width > 0 && height > 0;
      if (wanted && !state.created) {
        state.created = true; state.reported = { width, height, format: state.format }; r.record(`CAMERA SurfaceView ${view.id} surface created ${width}x${height}`);
        if (state.holder) { tellHolder(r, state, 'surfaceCreated', [], []); tellHolder(r, state, 'surfaceChanged', ['I', 'I', 'I'], [state.format, width, height]); }
      } else if (wanted && (state.reported.width !== width || state.reported.height !== height || state.reported.format !== state.format)) {
        state.reported = { width, height, format: state.format }; if (state.holder) tellHolder(r, state, 'surfaceChanged', ['I', 'I', 'I'], [state.format, width, height]);
      } else if (!wanted && state.created) {
        if (state.holder) tellHolder(r, state, 'surfaceDestroyed', [], []);
        state.created = false; state.sink.stream = null;
      }
      platform.requestDraw?.(r, self);
    }, 0, [self]);
  };
  def(SURFACE_VIEW, 'getHolder', `()${HOLDER}`, (r, _m, [self]) => { const state = surfaceView(r, self); if (!state.holder) { state.holder = r.makeObject(HOLDER_IMPL); r.object(state.holder).holderView = self; } return state.holder; });
  for (const name of ['setZOrderOnTop', 'setZOrderMediaOverlay', 'setSecure']) def(SURFACE_VIEW, name, '(Z)V', () => {});   // one window, one layer: the page draws the surface in the View's box
  for (const name of ['onAttachedToWindow', 'onDetachedFromWindow']) def(SURFACE_VIEW, name, '()V', (r, _m, [self]) => updateSurface(r, self));
  def(SURFACE_VIEW, 'onVisibilityChanged', `(${VIEW}I)V`, (r, _m, [self]) => updateSurface(r, self));
  def(SURFACE_VIEW, 'onWindowVisibilityChanged', '(I)V', (r, _m, [self]) => updateSurface(r, self));
  def(SURFACE_VIEW, 'onSizeChanged', '(IIII)V', (r, _m, [self]) => updateSurface(r, self));
  const held = (r, self) => { const view = r.object(self).holderView; return { view, state: surfaceView(r, view) }; };
  def(HOLDER_IMPL, 'addCallback', `(${HOLDER_CALLBACK})V`, (r, _m, [self, callback]) => { const { state } = held(r, self); if (!nullish(callback) && !state.callbacks.some(entry => entry.ref === callback.ref)) state.callbacks.push(callback); });
  def(HOLDER_IMPL, 'removeCallback', `(${HOLDER_CALLBACK})V`, (r, _m, [self, callback]) => { const { state } = held(r, self); state.callbacks = state.callbacks.filter(entry => nullish(callback) || entry.ref !== callback.ref); });
  def(HOLDER_IMPL, 'getSurface', `()${SURFACE}`, (r, _m, [self]) => held(r, self).state.surface);
  def(HOLDER_IMPL, 'isCreating', '()Z', () => 0);
  def(HOLDER_IMPL, 'setType', '(I)V', () => {});   // deprecated, ignored since API 11
  def(HOLDER_IMPL, 'setKeepScreenOn', '(Z)V', () => {});
  def(HOLDER_IMPL, 'setFormat', '(I)V', (r, _m, [self, format]) => { const { view, state } = held(r, self); state.format = format === -1 ? PIXEL_FORMAT_RGB_565 : format; updateSurface(r, view); });   // PixelFormat.OPAQUE is the default format
  def(HOLDER_IMPL, 'setFixedSize', '(II)V', (r, _m, [self, width, height]) => { const { view, state } = held(r, self); state.fixed = { width, height }; updateSurface(r, view); });
  def(HOLDER_IMPL, 'setSizeFromLayout', '()V', (r, _m, [self]) => { const { view, state } = held(r, self); state.fixed = null; updateSurface(r, view); });
  def(HOLDER_IMPL, 'getSurfaceFrame', `()${RECT}`, (r, _m, [self]) => { const { view, state } = held(r, self), { width, height } = holderSize(r.object(view), state); return construct(r, RECT, ['I', 'I', 'I', 'I'], [0, 0, width, height]); });

  // ---- ImageReader, Image, Image.Plane --------------------------------------------------------------------------------------------------------------------------------------
  type(IMAGE_READER, OBJECT, ['Ljava/lang/AutoCloseable;']); type(IMAGE_LISTENER, OBJECT); type(IMAGE_IMPL, IMAGE, [], { allocatable: true }); type(PLANE_IMPL, PLANE, [], { allocatable: true });
  const readerOf = (r, self) => r.object(self).reader;
  const newReader = (r, width, height, format, maxImages) => {
    if (width < 1 || height < 1) r.throwJava('Ljava/lang/IllegalArgumentException;', 'The image dimensions must be positive');
    if (maxImages < 1) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Maximum outstanding image count must be at least 1');
    if (format === 0x11) r.throwJava('Ljava/lang/IllegalArgumentException;', 'NV21 format is not supported');   // ImageFormat.NV21
    const reader = r.makeObject(IMAGE_READER), surface = construct(r, SURFACE), state = { width, height, format, maxImages, surface, listener: null, listenerTarget: null, queue: [], acquired: 0, closed: false, dropped: 0 };
    state.sink = { kind: 'reader', reader, state, stream: null, shots: 0, valid: () => !state.closed }; r.object(surface).surface.sink = state.sink;
    r.object(reader).reader = state; return reader;
  };
  def(IMAGE_READER, 'newInstance', `(IIII)${IMAGE_READER}`, (r, _m, [width, height, format, maxImages]) => newReader(r, width, height, format, maxImages), { static: true });
  def(IMAGE_READER, 'newInstance', `(IIIIJ)${IMAGE_READER}`, (r, _m, [width, height, format, maxImages]) => newReader(r, width, height, format, maxImages), { static: true });
  def(IMAGE_READER, 'getWidth', '()I', (r, _m, [self]) => readerOf(r, self).width);
  def(IMAGE_READER, 'getHeight', '()I', (r, _m, [self]) => readerOf(r, self).height);
  def(IMAGE_READER, 'getImageFormat', '()I', (r, _m, [self]) => readerOf(r, self).format);
  def(IMAGE_READER, 'getMaxImages', '()I', (r, _m, [self]) => readerOf(r, self).maxImages);
  def(IMAGE_READER, 'getSurface', `()${SURFACE}`, (r, _m, [self]) => readerOf(r, self).surface);
  def(IMAGE_READER, 'setOnImageAvailableListener', `(${IMAGE_LISTENER}${HANDLER})V`, (r, _m, [self, listener, handler]) => {
    const state = readerOf(r, self);
    if (nullish(listener)) { state.listener = null; state.listenerTarget = null; return; }
    state.listenerTarget = targetFor(r, handler, 'handler is null but the current thread is not a looper'); state.listener = listener;
  });
  def(IMAGE_READER, 'discardFreeBuffers', '()V', () => {});
  const closeReader = (r, self) => { const state = readerOf(r, self); if (state.closed) return; state.closed = true; state.listener = null; for (const frame of state.queue) frame.rgba = null; state.queue.length = 0; state.sink.stream = null; };
  def(IMAGE_READER, 'close', '()V', (r, _m, [self]) => closeReader(r, self));
  const acquire = (r, self, latest) => {
    const state = readerOf(r, self);
    if (state.closed) r.throwJava('Ljava/lang/IllegalStateException;', 'ImageReader has been closed');   // AOSP surfaces this as "Unknown error" from the detached native reader
    if (state.acquired >= state.maxImages) r.throwJava('Ljava/lang/IllegalStateException;', `maxImages (${state.maxImages}) has already been acquired, call #close before acquiring more.`);
    if (!state.queue.length) return null;
    const frame = latest ? state.queue.pop() : state.queue.shift();
    if (latest) { for (const stale of state.queue) stale.rgba = null; state.queue.length = 0; }
    const image = r.makeObject(IMAGE_IMPL); r.object(image).image = { frame, reader: self, closed: false, planes: null, crop: null }; state.acquired++; return image;
  };
  def(IMAGE_READER, 'acquireNextImage', `()${IMAGE}`, (r, _m, [self]) => acquire(r, self, false));
  def(IMAGE_READER, 'acquireLatestImage', `()${IMAGE}`, (r, _m, [self]) => acquire(r, self, true));

  const imageOf = (r, self) => { const image = r.object(self).image; if (image.closed) r.throwJava('Ljava/lang/IllegalStateException;', 'Image is already closed'); return image; };
  def(IMAGE_IMPL, 'getFormat', '()I', (r, _m, [self]) => imageOf(r, self).frame.format);
  def(IMAGE_IMPL, 'getWidth', '()I', (r, _m, [self]) => imageOf(r, self).frame.width);
  def(IMAGE_IMPL, 'getHeight', '()I', (r, _m, [self]) => imageOf(r, self).frame.height);
  def(IMAGE_IMPL, 'getTimestamp', '()J', (r, _m, [self]) => BigInt(imageOf(r, self).frame.timestamp));
  def(IMAGE_IMPL, 'getDataSpace', '()I', (r, _m, [self]) => (imageOf(r, self), 0x8c20000));   // DataSpace.DATASPACE_JFIF: full-range BT.601, what the conversion below produces
  def(IMAGE_IMPL, 'getCropRect', `()${RECT}`, (r, _m, [self]) => { const image = imageOf(r, self), [left, top, right, bottom] = image.crop ?? [0, 0, image.frame.width, image.frame.height]; return construct(r, RECT, ['I', 'I', 'I', 'I'], [left, top, right, bottom]); });
  def(IMAGE_IMPL, 'setCropRect', `(${RECT})V`, (r, _m, [self, rect]) => {
    const image = imageOf(r, self); if (nullish(rect)) { image.crop = null; return; }
    const read = name => r.object(rect).fields.get(`${RECT}->${name}:I`) ?? 0, left = Math.max(0, read('left')), top = Math.max(0, read('top')), right = Math.min(image.frame.width, read('right')), bottom = Math.min(image.frame.height, read('bottom'));
    image.crop = left < right && top < bottom ? [left, top, right, bottom] : [0, 0, 0, 0];   // Rect.intersect with the image bounds, empty when they do not meet
  });
  def(IMAGE_IMPL, 'close', '()V', (r, _m, [self]) => { const image = r.object(self).image; if (image.closed) return; image.closed = true; image.frame.rgba = null; image.frame = null; image.planes = null; const reader = readerOf(r, image.reader); if (reader.acquired > 0) reader.acquired--; });
  const bytes = (r, data) => r.newArray('[B', data.length, new ByteCells(data.buffer, data.byteOffset, data.length));   // the Java byte[] is a view of the frame's own memory: no copy
  const plane = (r, array, offset, length, rowStride, pixelStride) => {
    const wrapped = callStatic(r, BYTE_BUFFER, 'wrap', ['[B', 'I', 'I'], BYTE_BUFFER, [array, offset, length]), sliced = call(r, wrapped, BYTE_BUFFER, 'slice', [], BYTE_BUFFER), readOnly = call(r, sliced, BYTE_BUFFER, 'asReadOnlyBuffer', [], BYTE_BUFFER);
    const ref = r.makeObject(PLANE_IMPL); r.object(ref).plane = { buffer: readOnly, rowStride, pixelStride }; return ref;
  };
  /** The JPEG stream of a captured frame: libjpeg-turbo at the request's JPEG_QUALITY, then the Exif Orientation of JPEG_ORIENTATION. */
  const encodeJpeg = (r, frame) => {
    const codecs = r.skia?.codecs ?? (() => { throw new APKError(`ImageReader (ImageFormat.JPEG): encoding a camera frame needs the lab codec module (vendor/lab-codecs)${r.skia?.codecsError ? ': ' + r.skia.codecsError.message : ', which this host did not load'}`, { kind: 'camera-jpeg-unavailable' }); })();
    const encoded = codecs.jpegEncode(frame.rgba, frame.width, frame.height, frame.jpegQuality ?? 95) ?? (() => { throw new APKError('ImageReader (ImageFormat.JPEG): libjpeg rejected the frame', { kind: 'camera-jpeg-unavailable' }); })();
    return frame.jpegOrientation ? withExifOrientation(encoded, exifOrientation(frame.jpegOrientation)) : encoded;
  };
  def(IMAGE_IMPL, 'getPlanes', `()[${PLANE}`, (r, _m, [self]) => {
    const image = imageOf(r, self); if (image.planes) return image.planes;
    const frame = image.frame, planes = [];
    if (frame.format === FORMAT.JPEG) { const data = encodeJpeg(r, frame); planes.push(plane(r, bytes(r, data), 0, data.length, 0, 0)); }
    else if (frame.format === FORMAT.YUV_420_888) {
      const yuv = rgbaToYuv420(frame.rgba, frame.width, frame.height), luma = bytes(r, yuv.y), chroma = bytes(r, yuv.vu), span = yuv.vu.length - 1;
      planes.push(plane(r, luma, 0, yuv.y.length, frame.width, 1), plane(r, chroma, 1, span, yuv.chromaRowStride, 2), plane(r, chroma, 0, span, yuv.chromaRowStride, 2));   // U starts at the odd bytes of the interleaved V,U plane
    }   // PRIVATE: an opaque buffer has no planes
    const array = r.newArray(`[${PLANE}`, planes.length); r.array(array).elements = planes; image.planes = array; return array;
  });
  def(PLANE_IMPL, 'getBuffer', `()${BYTE_BUFFER}`, (r, _m, [self]) => r.object(self).plane.buffer);
  def(PLANE_IMPL, 'getRowStride', '()I', (r, _m, [self]) => r.object(self).plane.rowStride);
  def(PLANE_IMPL, 'getPixelStride', '()I', (r, _m, [self]) => r.object(self).plane.pixelStride);

  return {
    ensureTexture,
    /** A frame of the camera reached a SurfaceTexture: its timestamp moves, its OnFrameAvailableListener and the owning TextureView's listener hear it. */
    textureFrame(r, texture, timestamp) {
      const state = r.object(texture).texture; if (!state || state.released) return;
      state.timestamp = timestamp; state.frames = (state.frames ?? 0) + 1;
      if (!nullish(state.listener)) { const run = () => { if (!state.released && !nullish(state.listener)) call(r, state.listener, 'Landroid/graphics/SurfaceTexture$OnFrameAvailableListener;', 'onFrameAvailable', [SURFACE_TEXTURE], 'V', [texture]); }; if (state.listenerHandler) post(r, { handler: state.listenerHandler }, run, [texture, state.listener]); else run(); }
      if (state.ownerView) { const listener = r.object(state.ownerView).textureView?.listener; if (!nullish(listener)) call(r, listener, TEXTURE_LISTENER, 'onSurfaceTextureUpdated', [SURFACE_TEXTURE], 'V', [texture]); }
    },
    /** A frame for an ImageReader: queued unless the reader is closed or already holds maxImages (the producer then drops it, as a full BufferQueue makes the camera do). Returns whether it was queued. */
    readerFrame(r, sink, buffer, meta) {
      const state = sink.state; if (state.closed) return false;
      if (state.queue.length + state.acquired >= state.maxImages) { state.dropped++; return false; }
      state.queue.push({ width: state.width, height: state.height, format: state.format, rgba: buffer, timestamp: meta.timestamp, jpegQuality: meta.jpegQuality, jpegOrientation: meta.jpegOrientation });
      if (!nullish(state.listener)) post(r, state.listenerTarget, () => { if (!state.closed && !nullish(state.listener)) call(r, state.listener, IMAGE_LISTENER, 'onImageAvailable', [IMAGE_READER], 'V', [sink.reader]); }, [sink.reader, state.listener]);
      return true;
    },
    /** The consumer behind a Surface, or null for a Surface nothing of the lab can fill (released, empty, of a consumer the VM does not have). */
    sinkOf(r, surface) {
      if (nullish(surface)) return null; const state = r.object(surface).surface; if (!state || state.released) return null;
      if (state.sink) return state.sink.valid() ? state.sink : null;
      if (nullish(state.texture)) return null; const texture = r.object(state.texture).texture; if (!texture || texture.released) return null;
      return texture.sink ??= { kind: 'texture', texture: state.texture, state: texture, stream: null, shots: 0, valid: () => !texture.released };
    },
    viewKind: (r, object) => (object.textureView || object.surfaceView) && (object.type === TEXTURE_VIEW || object.type === SURFACE_VIEW) ? 'view' : null,
    /** Snapshot payload of a TextureView / SurfaceView node: which camera stream the page draws into its box (null: nothing has been queued to the surface). */
    nodeState(r, object) {
      const texture = object.textureView, surface = object.surfaceView; if (!texture && !surface) return undefined;
      const sink = texture ? (texture.texture ? r.object(texture.texture).texture?.sink : null) : surface.sink;
      return { kind: texture ? 'texture' : 'surface', ready: texture ? !!texture.texture : surface.created, opaque: texture ? texture.opaque : true, transform: texture?.transform ?? null, stream: sink?.stream ? { ...sink.stream } : null, shots: sink?.shots ?? 0 };
    },
  };
}
