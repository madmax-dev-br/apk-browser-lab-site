import { APKError } from './apk-error.js?v=d1b40b8dc64a';
import { createHostRegistry, bitsFloat } from './host-contract.js?v=d1b40b8dc64a';
import { AnimatedFrames, parseGifStructure, declaredFrameCount } from './animated-image.js?v=d1b40b8dc64a';
import { snapshotPaintColorFilter } from './color-filter-native.js?v=d1b40b8dc64a';
import { getSolidPaint } from './paint-host.js?v=d1b40b8dc64a';

// android.graphics.drawable.AnimatedImageDrawable (API 28) and android.graphics.Movie (API 1, deprecated in 28) over src/animated-image.js.
//
// AnimatedImageDrawable follows android-13.0.0_r1 AnimatedImageDrawable.java and, for what that file leaves to JNI, the software path of libs/hwui/hwui/AnimatedImageDrawable.cpp
// (drawStaging: the path Android takes on a Canvas that is not a RenderThread display list). The Java file is nearly all native calls, so the class is a host class here and the
// framework DEX is not rebuilt for it; DrawableInflater's `new AnimatedImageDrawable()` + inflate() for <animated-image> resolves to it.
//  - draw(Canvas) draws the current frame scaled to the bounds, and while the animation runs returns through scheduleSelf(invalidateSelf, uptime + ms to the next frame): the
//    Drawable.Callback (a View: Choreographer; Compose and libraries: their own Handler) redraws at the frame times. A View that is detached or not drawn never calls draw()
//    again, so nothing is scheduled; setVisible(false) (ImageView.onVisibilityAggregated) marks it invisible, and the time it stays undrawn does not count as animation time.
//  - start() restarts from the first frame; stop() keeps the frame on screen; the repeat count is the file's own until setRepeatCount; after the last frame of the last repetition
//    has had its duration the animation ends on that frame and onAnimationEnd is posted. Callbacks are posted to the main Looper (start: from the first draw after start()).
//  - GIF frames of 10 ms or less last 100 ms (AnimatedImageDrawable::adjustFrameDuration, as browsers do).
// Not modelled, with explicit errors: a PostProcessor (ImageDecoder refuses it before this class is reached) and theme attributes in <animated-image>.
//
// Movie is the GIF-only API (frameworks/base libs/hwui/jni/Movie.cpp + GIFMovie.cpp): decode* return null for anything that is not a GIF, duration() is the sum of the frame
// delays, setTime(ms) selects the first frame whose end time is >= ms, draw() draws the composed logical screen at (x, y).
const AID = 'Landroid/graphics/drawable/AnimatedImageDrawable;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', ANIMATABLE2 = 'Landroid/graphics/drawable/Animatable2;', CALLBACK = 'Landroid/graphics/drawable/Animatable2$AnimationCallback;';
const INVALIDATE = 'Landroid/graphics/drawable/AnimatedImageDrawable$InvalidateSelf;', NOTIFY = 'Landroid/graphics/drawable/AnimatedImageDrawable$PostedCallbacks;';
const MOVIE = 'Landroid/graphics/Movie;', CANVAS = 'Landroid/graphics/Canvas;', PAINT = 'Landroid/graphics/Paint;', FILTER = 'Landroid/graphics/ColorFilter;', RECT = 'Landroid/graphics/Rect;', RUNNABLE = 'Ljava/lang/Runnable;';
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', INPUT = 'Ljava/io/InputStream;', HANDLER = 'Landroid/os/Handler;', LOOPER = 'Landroid/os/Looper;', RESOURCES = 'Landroid/content/res/Resources;';
const REPEAT_INFINITE = -1, REPEAT_UNDEFINED = -2, FINISHED = -1, TRANSLUCENT = -3, ANDROID_NS = 'http://schemas.android.com/apk/res/android', DISPLAY_DENSITY = 160;
const nullish = v => v === null || v === undefined || v === 0;
const unsupported = (message, kind = 'animated-image-unsupported', details = {}) => { throw new APKError(message, { kind, ...details }); };
/** Bitmap.scaleFromDensity. */
const scaleFromDensity = (size, source, target) => !source || !target || source === target ? size : Math.trunc((size * target + (source >> 1)) / source);

export function createAnimatedImageHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  type(AID, DRAWABLE, [ANIMATABLE2, 'Landroid/graphics/drawable/Animatable;'], { allocatable: true }); type(MOVIE, OBJECT, [], {});
  type(INVALIDATE, OBJECT, [RUNNABLE], {}); type(NOTIFY, OBJECT, [RUNNABLE], {});
  // Animatable2.AnimationCallback is an abstract class with two empty methods that apps subclass; the framework DEX of the lab does not carry it.
  type(CALLBACK, OBJECT, [], { allocatable: true });
  def(CALLBACK, '<init>', '()V', () => {}); def(CALLBACK, 'onAnimationStart', `(${DRAWABLE})V`, () => {}); def(CALLBACK, 'onAnimationEnd', `(${DRAWABLE})V`, () => {});
  staticField(AID, 'REPEAT_INFINITE', 'I', () => REPEAT_INFINITE);
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = [], mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, values, { receiver }), mode);
  const callStatic = (r, owner, name, parameters, result, values = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, values), 'static');
  const ise = (r, m) => r.throwJava('Ljava/lang/IllegalStateException;', m), iae = (r, m) => r.throwJava('Ljava/lang/IllegalArgumentException;', m);
  const now = () => Math.floor(platform.clock.now());   // SystemClock.uptimeMillis(): whole milliseconds, the clock the Drawable callbacks are scheduled on
  // The Skia image of a drawable or a Movie lives outside the Java heap (a WeakMap the collector does not walk); it is released when the Java object is collected (record.onFree).
  const natives = new WeakMap(), live = { count: 0, draws: 0, frame: -1, decoded: 0 };   // live: native images alive, draws recorded, the frame of the last draw (what the tests and the memory measurement read)
  const open = (r, owner, state, bytes) => {
    const CK = r.skia?.CanvasKit; if (!CK) unsupported('Animated images need the Skia CanvasKit backend, which is not loaded for this run', 'animated-image-backend');
    const frames = new AnimatedFrames(CK, bytes); natives.set(state, frames); live.count++;
    const record = r.object(owner), previous = record.onFree;
    record.onFree = () => { if (typeof previous === 'function') previous(); if (natives.get(state) === frames) { natives.delete(state); frames.dispose(); live.count--; } };
    return frames;
  };
  const canvasHandle = (r, canvas, what) => { if (nullish(canvas)) r.throwJava('Ljava/lang/NullPointerException;', 'canvas == null'); const handle = r.object(canvas).nativeCanvasHandle; if (!handle) unsupported(`${what} needs a Canvas the lab records (a View, Bitmap or Picture canvas)`, 'animated-image-canvas'); return handle; };
  const frameCommand = (frames, dst, { src = null, paint = null, mirrored = false, filter = true } = {}) => {
    const px = frames.pixels(), command = { op: 'raster', pixelData: { width: px.width, height: px.height, colorType: 'RGBA_8888', alphaType: 'Premul', base64: px.base64 }, raster: { kind: 'raster', width: px.width, height: px.height }, args: [dst[0], dst[1]], src: src ?? [0, 0, px.width, px.height], dst, paint };
    if (filter && (dst[2] - dst[0] !== command.src[2] - command.src[0] || dst[3] - dst[1] !== command.src[3] - command.src[1])) command.filter = true;
    if (mirrored) command.imageMatrix = [-1, 0, dst[0] + dst[2], 0, 1, 0, 0, 0, 1];
    return command;
  };

  // ---- AnimatedImageDrawable ------------------------------------------------------------------------------------------------------------------
  const blank = () => ({ ready: false, width: 0, height: 0, intrinsic: [0, 0], src: null, gif: false, running: false, starting: false, notifyStart: false, finished: false, repeatCount: REPEAT_UNDEFINED, loops: 0,
    elapsed: 0, nextAt: 0, lastWall: null, alpha: 255, colorFilter: null, autoMirrored: false, mirrored: false, callbacks: null, handler: null, runnable: null });
  const state = (r, self) => r.object(self).animatedImage ??= blank();
  const ready = (r, self, method) => { const st = state(r, self); if (!st.ready) ise(r, `called ${method} on empty AnimatedImageDrawable`); return st; };
  const framesOf = st => natives.get(st) ?? unsupported('AnimatedImageDrawable used after its image was released', 'animated-image-released');
  const duration = (st, ms) => st.gif && ms <= 10 ? 100 : ms;   // AnimatedImageDrawable::adjustFrameDuration
  /**
   * Makes `self` the drawable of the animated image in `bytes`. `target` is the decoded size ImageDecoder was asked for (setTargetSize / setTargetSampleSize), `crop` a rectangle of
   * it; the intrinsic size is the cropped target scaled from the source density to the destination density, as the AOSP constructor computes it.
   */
  const load = (r, self, bytes, { target = null, crop = null, srcDensity = 0, dstDensity = 0 } = {}) => {
    const st = state(r, self), frames = open(r, self, st, bytes);
    const tw = target ? target[0] : frames.width, th = target ? target[1] : frames.height, sx = frames.width / tw, sy = frames.height / th;
    st.ready = true; st.width = frames.width; st.height = frames.height; st.gif = parseGifStructure(bytes) !== null;
    st.src = crop ? [crop[0] * sx, crop[1] * sy, crop[2] * sx, crop[3] * sy] : null;
    const w = crop ? crop[2] - crop[0] : tw, h = crop ? crop[3] - crop[1] : th;
    st.intrinsic = [scaleFromDensity(w, srcDensity, dstDensity), scaleFromDensity(h, srcDensity, dstDensity)];
    r.record(`HOST AnimatedImageDrawable ${frames.width}x${frames.height}, ${frames.frameCount} frames, repetition count ${frames.repetitionCount} [Skia SkAnimatedImage]`);
    return self;
  };
  /** A new AnimatedImageDrawable for encoded `bytes` (ImageDecoder.decodeDrawable of an animated source; Resources.getDrawable of an animated image file). */
  const create = (r, bytes, options) => { const self = r.allocate(AID); call(r, self, DRAWABLE, '<init>', [], 'V', [], 'direct'); return load(r, self, bytes, options); };
  const post = (r, self, st, which) => {
    if (!st.callbacks) return;
    st.handler ??= (() => { const h = r.allocate(HANDLER); call(r, h, HANDLER, '<init>', [LOOPER], 'V', [callStatic(r, LOOPER, 'getMainLooper', [], LOOPER)], 'direct'); return h; })();
    const task = r.makeObject(NOTIFY); r.object(task).postedCallbacks = { drawable: self, which };
    call(r, st.handler, HANDLER, 'post', [RUNNABLE], 'Z', [task]);
  };
  def(NOTIFY, 'run', '()V', (r, _m, [self]) => {
    const { drawable, which } = r.object(self).postedCallbacks, list = state(r, drawable).callbacks; if (!list) return;
    for (const callback of [...list]) call(r, callback, CALLBACK, which === 'start' ? 'onAnimationStart' : 'onAnimationEnd', [DRAWABLE], 'V', [drawable]);
  });
  def(INVALIDATE, 'run', '()V', (r, _m, [self]) => { call(r, r.object(self).invalidates, DRAWABLE, 'invalidateSelf'); });
  /** AnimatedImageDrawable::drawStaging: draws the frame that is due and answers the milliseconds until the next one (0: not running, FINISHED: the animation just ended). */
  const nativeDraw = (r, self, st, canvas) => {
    const frames = framesOf(st), at = now(); let next = 0;
    if (st.running) {
      if (st.starting) { st.starting = false; frames.reset(); st.loops = 0; st.finished = false; st.elapsed = 0; st.nextAt = duration(st, frames.duration); next = st.nextAt; }
      else {
        if (st.lastWall !== null) st.elapsed += Math.max(0, at - st.lastWall);   // undrawn time (invisible, detached) is not animation time
        if (st.elapsed >= st.nextAt) {
          const last = frames.index === frames.frameCount - 1, repeat = st.repeatCount === REPEAT_UNDEFINED ? frames.repetitionCount : st.repeatCount;
          if (last && repeat !== REPEAT_INFINITE && st.loops >= repeat) { st.finished = true; st.running = false; next = FINISHED; }
          else { if (last) st.loops++; st.nextAt += duration(st, frames.advance()); if (st.nextAt <= st.elapsed) st.nextAt = st.elapsed + duration(st, frames.duration); }   // a late frame still gets its whole duration
        }
        if (next !== FINISHED) next = Math.max(1, Math.ceil(st.nextAt - st.elapsed));
      }
      st.lastWall = at;
    }
    const rect = call(r, self, DRAWABLE, 'getBounds', [], RECT), f = r.object(rect).fields, edge = name => f.get(`${RECT}->${name}:I`) ?? 0, dst = [edge('left'), edge('top'), edge('right'), edge('bottom')];
    if (dst[2] > dst[0] && dst[3] > dst[1]) {
      const filter = st.colorFilter ? snapshotPaintColorFilter(r, st.colorFilter) : null;
      const paint = st.alpha !== 255 || filter ? { argb: ((st.alpha << 24) | 0xffffff) | 0, flags: 1, style: 0, strokeWidth: 0, strokeMiter: 4, strokeCap: 0, strokeJoin: 0, blendMode: 3, ...(filter ? { colorFilterSnapshot: filter } : {}) } : null;
      r.skiaHost.recordNative(canvasHandle(r, canvas, 'AnimatedImageDrawable.draw'), frameCommand(frames, dst, { src: st.src, paint, mirrored: st.mirrored }));
      live.draws++; live.frame = frames.index;
    }
    return next;
  };
  def(AID, '<init>', '()V', (r, _m, [self]) => { call(r, self, DRAWABLE, '<init>', [], 'V', [], 'direct'); state(r, self); });
  def(AID, 'draw', `(${CANVAS})V`, (r, _m, [self, canvas]) => {
    const st = ready(r, self, 'draw');
    if (st.notifyStart) { st.notifyStart = false; post(r, self, st, 'start'); }
    const next = nativeDraw(r, self, st, canvas);
    if (next > 0) {
      if (!st.runnable) { st.runnable = r.makeObject(INVALIDATE); r.object(st.runnable).invalidates = self; }
      call(r, self, DRAWABLE, 'scheduleSelf', [RUNNABLE, 'J'], 'V', [st.runnable, BigInt(now() + next)]);
    } else if (next === FINISHED) post(r, self, st, 'end');
  });
  def(AID, 'getIntrinsicWidth', '()I', (r, _m, [self]) => state(r, self).intrinsic[0]);
  def(AID, 'getIntrinsicHeight', '()I', (r, _m, [self]) => state(r, self).intrinsic[1]);
  def(AID, 'getOpacity', '()I', () => TRANSLUCENT);
  def(AID, 'setAlpha', '(I)V', (r, _m, [self, alpha]) => {
    if (alpha < 0 || alpha > 255) iae(r, 'Alpha must be between 0 and 255! provided ' + alpha);
    const st = ready(r, self, 'setAlpha'); st.alpha = alpha; call(r, self, DRAWABLE, 'invalidateSelf');
  });
  def(AID, 'getAlpha', '()I', (r, _m, [self]) => ready(r, self, 'getAlpha').alpha);
  def(AID, 'setColorFilter', `(${FILTER})V`, (r, _m, [self, filter]) => {
    const st = ready(r, self, 'setColorFilter'), value = nullish(filter) ? null : filter;
    if ((st.colorFilter?.ref ?? st.colorFilter) !== (value?.ref ?? value)) { st.colorFilter = value; call(r, self, DRAWABLE, 'invalidateSelf'); }
  });
  def(AID, 'getColorFilter', `()${FILTER}`, (r, _m, [self]) => state(r, self).colorFilter);
  def(AID, 'setAutoMirrored', '(Z)V', (r, _m, [self, mirrored]) => {
    const st = state(r, self); if (st.autoMirrored === !!mirrored) return; st.autoMirrored = !!mirrored;
    if (call(r, self, DRAWABLE, 'getLayoutDirection', [], 'I') === 1 && st.ready) { st.mirrored = !!mirrored; call(r, self, DRAWABLE, 'invalidateSelf'); }
  });
  def(AID, 'isAutoMirrored', '()Z', (r, _m, [self]) => state(r, self).autoMirrored ? 1 : 0);
  def(AID, 'onLayoutDirectionChanged', '(I)Z', (r, _m, [self, direction]) => { const st = state(r, self); if (!st.autoMirrored || !st.ready) return 0; st.mirrored = direction === 1; return 1; });
  def(AID, 'setVisible', '(ZZ)Z', (r, _m, [self, visible, restart]) => {
    if (!call(r, self, DRAWABLE, 'setVisible', ['Z', 'Z'], 'Z', [visible, restart], 'direct')) return 0;
    const st = ready(r, self, 'setVisible'); if (!visible) st.lastWall = null;   // nMarkInvisible: the time until the next draw is not animation time
    return 1;
  });
  def(AID, 'onBoundsChange', `(${RECT})V`, () => {});   // nSetBounds: the bounds are read when the frame is drawn
  def(AID, 'isRunning', '()Z', (r, _m, [self]) => ready(r, self, 'isRunning').running ? 1 : 0);
  def(AID, 'start', '()V', (r, _m, [self]) => {
    const st = ready(r, self, 'start'); if (st.running) return;
    st.running = true; st.starting = true; st.notifyStart = true; call(r, self, DRAWABLE, 'invalidateSelf');
  });
  def(AID, 'stop', '()V', (r, _m, [self]) => { const st = ready(r, self, 'stop'); if (!st.running) return; st.running = false; post(r, self, st, 'end'); });
  def(AID, 'getRepeatCount', '()I', (r, _m, [self]) => { const st = ready(r, self, 'getRepeatCount'); if (st.repeatCount === REPEAT_UNDEFINED) st.repeatCount = framesOf(st).repetitionCount; return st.repeatCount; });
  def(AID, 'setRepeatCount', '(I)V', (r, _m, [self, count]) => { if (count < REPEAT_INFINITE) iae(r, 'invalid value passed to setRepeatCount' + count); state(r, self).repeatCount = count; });
  def(AID, 'registerAnimationCallback', `(${CALLBACK})V`, (r, _m, [self, callback]) => { if (nullish(callback)) return; const st = state(r, self), list = st.callbacks ??= []; if (!list.some(item => item.ref === callback.ref)) list.push(callback); });
  def(AID, 'unregisterAnimationCallback', `(${CALLBACK})Z`, (r, _m, [self, callback]) => { const st = state(r, self); if (nullish(callback) || !st.callbacks) return 0; const at = st.callbacks.findIndex(item => item.ref === callback.ref); if (at < 0) return 0; st.callbacks.splice(at, 1); return 1; });
  def(AID, 'clearAnimationCallbacks', '()V', (r, _m, [self]) => { const st = state(r, self); if (st.callbacks) st.callbacks = null; });
  def(AID, 'getConstantState', '()Landroid/graphics/drawable/Drawable$ConstantState;', () => null);   // Drawable's default: an AnimatedImageDrawable has no ConstantState
  // <animated-image android:src android:autoStart android:repeatCount android:autoMirrored> (AnimatedImageDrawable.inflate / updateStateFromTypedArray)
  def(AID, 'inflate', `(${RESOURCES}Lorg/xmlpull/v1/XmlPullParser;Landroid/util/AttributeSet;Landroid/content/res/Resources$Theme;)V`, (r, _m, [self, , parser, attrs]) => {
    const node = r.object(attrs)?.node ?? r.object(parser)?.node; if (!node) unsupported('<animated-image> inflate needs the compiled XML attribute node', 'animated-image-inflate');
    const attribute = name => node.attributes.find(item => item.name === name && item.namespace === ANDROID_NS);
    const literal = (name, fallback) => { const a = attribute(name); if (!a) return fallback; if (a.kind === 'attribute') unsupported(`<animated-image> android:${name} set from a theme attribute is not modelled`, 'animated-image-inflate'); let v = a; if (a.kind === 'reference') { v = platform.resources.resolve(a.reference >>> 0); while (v.resolved) v = v.resolved; } return v.rawData | 0; };
    const st = state(r, self), src = attribute('src'), xmlError = message => r.throwJava('Lorg/xmlpull/v1/XmlPullParserException;', message);
    if (src?.kind === 'attribute') unsupported('<animated-image> android:src set from a theme attribute is not modelled', 'animated-image-inflate');
    if (!src || src.kind !== 'reference') { if (!st.ready) xmlError('<animated-image> requires a valid \'src\' attribute'); }
    else {
      const file = platform.bitmapCodec?.resourceFile(r, src.reference >>> 0);
      if (!file || !r.apkEntries?.has(file.path)) xmlError('<animated-image> requires a valid \'src\' attribute');
      const bytes = Uint8Array.from(r.apkReader(file.path));
      if (declaredFrameCount(bytes) <= 1) iae(r, 'image is not animated');
      const density = file.density === 0xffff ? 0 : file.density || DISPLAY_DENSITY, repeat = st.repeatCount;
      Object.assign(st, blank(), { repeatCount: repeat, autoMirrored: st.autoMirrored }); load(r, self, bytes, { srcDensity: density, dstDensity: DISPLAY_DENSITY });
    }
    st.autoMirrored = literal('autoMirrored', st.autoMirrored ? 1 : 0) !== 0;
    const repeatCount = literal('repeatCount', REPEAT_UNDEFINED); if (repeatCount !== REPEAT_UNDEFINED) { if (repeatCount < REPEAT_INFINITE) iae(r, 'invalid value passed to setRepeatCount' + repeatCount); st.repeatCount = repeatCount; }
    if (literal('autoStart', 0) !== 0 && st.ready) call(r, self, AID, 'start');
  });

  // ---- Movie ----------------------------------------------------------------------------------------------------------------------------------
  const movie = (r, self) => { const m = r.object(self).movie; if (!m || !natives.get(m)) unsupported('Movie used after its image was released', 'animated-image-released'); return m; };
  const decodeMovie = (r, bytes) => {
    const structure = parseGifStructure(bytes); if (!structure || !structure.frames.length) return null;   // Movie::DecodeStream knows GIF only
    const self = r.makeObject(MOVIE), m = { width: structure.width, height: structure.height, delays: structure.frames.map(frame => frame.delayMs), time: -1, index: 0, drawn: -1 };
    m.duration = m.delays.reduce((sum, d) => sum + d, 0);
    let frames; try { frames = open(r, self, m, bytes); } catch (error) { if (error?.details?.kind === 'animated-image-backend') throw error; return null; }   // data Skia rejects: null, as a failed decode
    if (frames.frameCount < m.delays.length) m.delays.length = frames.frameCount;   // a truncated last frame
    r.object(self).movie = m; r.record(`HOST Movie ${m.width}x${m.height}, ${m.delays.length} frames, ${m.duration} ms [Skia SkAnimatedImage]`);
    return self;
  };
  const readAll = (r, stream) => {
    const chunks = [], buffer = r.newArray('[B', 8192); let total = 0;
    for (;;) { const n = call(r, stream, INPUT, 'read', ['[B', 'I', 'I'], 'I', [buffer, 0, 8192]); if (n < 0) break; chunks.push(r.bytesOf(buffer, 0, n).slice()); total += n; if (total > 64 * 1024 * 1024) unsupported('Movie.decodeStream: the stream exceeds 64 MiB', 'animated-image-size'); }
    const out = new Uint8Array(total); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; } return out;
  };
  def(MOVIE, 'decodeStream', `(${INPUT})${MOVIE}`, (r, _m, [stream]) => nullish(stream) ? null : decodeMovie(r, readAll(r, stream)), { static: true });
  def(MOVIE, 'decodeByteArray', `([BII)${MOVIE}`, (r, _m, [data, offset, length]) => {
    if (nullish(data)) r.throwJava('Ljava/lang/NullPointerException;', null);
    const size = r.array(data).elements.length; if ((offset | length) < 0 || size < offset + length) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', null);
    return decodeMovie(r, r.bytesOf(data, offset, offset + length).slice());
  }, { static: true });
  def(MOVIE, 'decodeFile', `(${STRING})${MOVIE}`, (r, _m, [path]) => {
    let stream;
    try { stream = r.allocate('Ljava/io/FileInputStream;'); call(r, stream, 'Ljava/io/FileInputStream;', '<init>', [STRING], 'V', [path], 'direct'); }
    catch (error) { if (error?.value && r.isSubtype(r.typeOf(error.value), 'Ljava/io/FileNotFoundException;')) return null; throw error; }
    try { return decodeMovie(r, readAll(r, stream)); } finally { call(r, stream, INPUT, 'close', [], 'V'); }
  }, { static: true });
  def(MOVIE, 'width', '()I', (r, _m, [self]) => movie(r, self).width); def(MOVIE, 'height', '()I', (r, _m, [self]) => movie(r, self).height);
  def(MOVIE, 'isOpaque', '()Z', () => 0);   // GIFMovie reports every GIF as not opaque
  def(MOVIE, 'duration', '()I', (r, _m, [self]) => movie(r, self).duration);
  def(MOVIE, 'setTime', '(I)Z', (r, _m, [self, relative]) => {
    const m = movie(r, self), time = Math.min(relative >>> 0, m.duration);   // SkMSec is unsigned; Movie::setTime clamps to the duration
    if (time === m.time) return 0; m.time = time;
    let index = m.delays.length - 1, end = 0;
    for (let i = 0; i < m.delays.length; i++) { end += m.delays[i]; if (end >= time) { index = i; break; } }
    m.index = index; return m.drawn !== index ? 1 : 0;
  });
  const drawMovie = (r, self, canvas, x, y, paint) => {
    const m = movie(r, self), frames = natives.get(m); frames.seek(m.index); m.drawn = m.index;
    r.skiaHost.recordNative(canvasHandle(r, canvas, 'Movie.draw'), frameCommand(frames, [x, y, x + m.width, y + m.height], { paint: nullish(paint) ? null : { ...getSolidPaint(r, paint) }, filter: false }));
  };
  def(MOVIE, 'draw', `(${CANVAS}FF${PAINT})V`, (r, _m, [self, canvas, x, y, paint]) => drawMovie(r, self, canvas, bitsFloat(x), bitsFloat(y), paint));
  def(MOVIE, 'draw', `(${CANVAS}FF)V`, (r, _m, [self, canvas, x, y]) => drawMovie(r, self, canvas, bitsFloat(x), bitsFloat(y), null));

  return { ...registry, interfaces: registry.interfacesOf, create, declaredFrameCount, stats: () => ({ live: live.count, draws: live.draws, frame: live.frame }) };
}
