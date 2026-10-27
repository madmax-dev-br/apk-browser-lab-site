import { APKError } from './apk-error.js?v=0c9f1b0d2456';
import { createHostRegistry } from './host-contract.js?v=0c9f1b0d2456';

// android.graphics.drawable.BitmapDrawable (android-13.0.0_r1 BitmapDrawable.java) over the recorded-canvas Bitmap: intrinsic size scaled by the target density, gravity placement
// of the bitmap inside the bounds (FILL by default), alpha, ColorFilter, filter/dither/antialias flags. Shader tiling (setTileMode*) and tinting need Skia shader/color-filter state
// the Bitmap model does not carry yet and fail explicitly. The class itself (a Drawable subclass backed by native Skia draw calls) is not in the framework DEX.
const TYPE = 'Landroid/graphics/drawable/BitmapDrawable;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', BITMAP = 'Landroid/graphics/Bitmap;', RESOURCES = 'Landroid/content/res/Resources;', CANVAS = 'Landroid/graphics/Canvas;', RECT = 'Landroid/graphics/Rect;', PAINT = 'Landroid/graphics/Paint;';
const FILTER = 'Landroid/graphics/ColorFilter;', GRAVITY = 'Landroid/view/Gravity;', TILE = 'Landroid/graphics/Shader$TileMode;', STRING = 'Ljava/lang/String;', INPUT = 'Ljava/io/InputStream;', DENSITY = 160;
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'bitmap-drawable-unsupported', ...details }); };

export function createBitmapDrawableHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(TYPE, DRAWABLE, [], { allocatable: true });
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = [], mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], mode);
  const st = (r, ref) => r.object(ref).bitmapDrawable ??= { bitmap: null, gravity: 119, alpha: 255, filter: null, paint: null, targetDensity: DENSITY, tileX: null, tileY: null, autoMirrored: false, dither: true, filterBitmap: true, antiAlias: false };
  const boundsOf = (r, receiver) => { const fields = r.object(call(r, receiver, DRAWABLE, 'getBounds', [], RECT)).fields, get = n => fields.get(`${RECT}->${n}:I`) ?? 0; return { left: get('left'), top: get('top'), right: get('right'), bottom: get('bottom') }; };
  const bitmapSize = (r, s) => {
    const b = r.skiaHost.bitmaps.live(s.bitmap), density = b.density || DENSITY, target = s.targetDensity || DENSITY;
    return density === target ? { width: b.width, height: b.height } : { width: Math.trunc(b.width * target / density + 0.5), height: Math.trunc(b.height * target / density + 0.5) };
  };
  const makePaint = (r, s) => {
    if (!s.paint) { s.paint = r.allocate(PAINT); call(r, s.paint, PAINT, '<init>', [], 'V', [], 'direct'); }
    call(r, s.paint, PAINT, 'setFilterBitmap', ['Z'], 'V', [s.filterBitmap ? 1 : 0]); call(r, s.paint, PAINT, 'setDither', ['Z'], 'V', [s.dither ? 1 : 0]); call(r, s.paint, PAINT, 'setAntiAlias', ['Z'], 'V', [s.antiAlias ? 1 : 0]);
    call(r, s.paint, PAINT, 'setAlpha', ['I'], 'V', [s.alpha]); call(r, s.paint, PAINT, 'setColorFilter', [FILTER], FILTER, [s.filter]);
    return s.paint;
  };
  const rect = (r, l, t, rt, b) => { const ref = r.allocate(RECT); call(r, ref, RECT, '<init>', ['I', 'I', 'I', 'I'], 'V', [l, t, rt, b], 'direct'); return ref; };
  const setBitmap = (r, receiver, bitmap) => { const s = st(r, receiver); s.bitmap = bitmap; call(r, receiver, DRAWABLE, 'invalidateSelf'); };
  const readStream = (r, stream) => { const bytes = []; for (;;) { const buffer = r.newArray('[B', 16384), got = call(r, stream, INPUT, 'read', ['[B', 'I', 'I'], 'I', [buffer, 0, 16384]); if (got < 0) break; bytes.push(...r.array(buffer).elements.slice(0, got)); } const array = r.newArray('[B', bytes.length); r.array(array).elements = bytes; return array; };
  const decoded = (r, bytes) => r.dispatch({ owner: 'Landroid/graphics/BitmapFactory;', name: 'decodeByteArray', parameters: ['[B', 'I', 'I'], result: BITMAP, signature: `([BII)${BITMAP}` }, [bytes, 0, r.array(bytes).elements.length], 'static');
  def(TYPE, '<init>', '()V', (r, _m, [self]) => { call(r, self, DRAWABLE, '<init>', [], 'V', [], 'direct'); st(r, self); });
  def(TYPE, '<init>', `(${RESOURCES})V`, (r, _m, [self]) => { call(r, self, DRAWABLE, '<init>', [], 'V', [], 'direct'); st(r, self); });
  def(TYPE, '<init>', `(${BITMAP})V`, (r, _m, [self, bitmap]) => { call(r, self, DRAWABLE, '<init>', [], 'V', [], 'direct'); st(r, self).bitmap = bitmap; });
  def(TYPE, '<init>', `(${RESOURCES}${BITMAP})V`, (r, _m, [self, , bitmap]) => { call(r, self, DRAWABLE, '<init>', [], 'V', [], 'direct'); st(r, self).bitmap = bitmap; });
  def(TYPE, '<init>', `(${STRING})V`, (r, _m, [self, path]) => { call(r, self, DRAWABLE, '<init>', [], 'V', [], 'direct'); const stream = r.allocate('Ljava/io/FileInputStream;'); call(r, stream, 'Ljava/io/FileInputStream;', '<init>', [STRING], 'V', [path], 'direct'); try { st(r, self).bitmap = decoded(r, readStream(r, stream)); } finally { call(r, stream, INPUT, 'close'); } });
  def(TYPE, '<init>', `(${INPUT})V`, (r, _m, [self, stream]) => { call(r, self, DRAWABLE, '<init>', [], 'V', [], 'direct'); st(r, self).bitmap = decoded(r, readStream(r, stream)); });
  def(TYPE, 'getBitmap', `()${BITMAP}`, (r, _m, [self]) => st(r, self).bitmap);
  def(TYPE, 'setBitmap', `(${BITMAP})V`, (r, _m, [self, bitmap]) => setBitmap(r, self, bitmap));
  def(TYPE, 'getPaint', `()${PAINT}`, (r, _m, [self]) => makePaint(r, st(r, self)));
  def(TYPE, 'getGravity', '()I', (r, _m, [self]) => st(r, self).gravity);
  def(TYPE, 'setGravity', '(I)V', (r, _m, [self, gravity]) => { st(r, self).gravity = gravity; call(r, self, DRAWABLE, 'invalidateSelf'); });
  for (const [name, field] of [['AntiAlias', 'antiAlias'], ['Dither', 'dither'], ['FilterBitmap', 'filterBitmap']]) def(TYPE, `set${name}`, '(Z)V', (r, _m, [self, value]) => { st(r, self)[field] = !!value; call(r, self, DRAWABLE, 'invalidateSelf'); });
  def(TYPE, 'isFilterBitmap', '()Z', (r, _m, [self]) => st(r, self).filterBitmap ? 1 : 0);
  def(TYPE, 'hasAntiAlias', '()Z', (r, _m, [self]) => st(r, self).antiAlias ? 1 : 0);
  def(TYPE, 'setTargetDensity', '(I)V', (r, _m, [self, density]) => { st(r, self).targetDensity = density || DENSITY; call(r, self, DRAWABLE, 'invalidateSelf'); });
  def(TYPE, 'setTargetDensity', `(${CANVAS})V`, (r, _m, [self]) => { st(r, self).targetDensity = DENSITY; });
  def(TYPE, 'setTargetDensity', '(Landroid/util/DisplayMetrics;)V', (r, _m, [self]) => { st(r, self).targetDensity = DENSITY; });
  for (const name of ['setTileModeX', 'setTileModeY']) def(TYPE, name, `(${TILE})V`, (r, _m, [self, mode]) => { if (mode !== null && r.object(mode).enumName !== 'CLAMP') fail('BitmapDrawable tiling needs Skia shader state the Bitmap model does not carry'); st(r, self)[name.endsWith('X') ? 'tileX' : 'tileY'] = mode; });
  def(TYPE, 'setTileModeXY', `(${TILE}${TILE})V`, (r, _m, [self, x, y]) => { for (const mode of [x, y]) if (mode !== null && r.object(mode).enumName !== 'CLAMP') fail('BitmapDrawable tiling needs Skia shader state the Bitmap model does not carry'); const s = st(r, self); s.tileX = x; s.tileY = y; });
  def(TYPE, 'getTileModeX', `()${TILE}`, (r, _m, [self]) => st(r, self).tileX); def(TYPE, 'getTileModeY', `()${TILE}`, (r, _m, [self]) => st(r, self).tileY);
  def(TYPE, 'setAlpha', '(I)V', (r, _m, [self, alpha]) => { st(r, self).alpha = alpha & 255; call(r, self, DRAWABLE, 'invalidateSelf'); });
  def(TYPE, 'getAlpha', '()I', (r, _m, [self]) => st(r, self).alpha);
  def(TYPE, 'setColorFilter', `(${FILTER})V`, (r, _m, [self, filter]) => { st(r, self).filter = filter; call(r, self, DRAWABLE, 'invalidateSelf'); });
  def(TYPE, 'getColorFilter', `()${FILTER}`, (r, _m, [self]) => st(r, self).filter);
  def(TYPE, 'setAutoMirrored', '(Z)V', (r, _m, [self, value]) => { st(r, self).autoMirrored = !!value; }); def(TYPE, 'isAutoMirrored', '()Z', (r, _m, [self]) => st(r, self).autoMirrored ? 1 : 0);
  def(TYPE, 'getIntrinsicWidth', '()I', (r, _m, [self]) => { const s = st(r, self); return s.bitmap === null ? -1 : bitmapSize(r, s).width; });
  def(TYPE, 'getIntrinsicHeight', '()I', (r, _m, [self]) => { const s = st(r, self); return s.bitmap === null ? -1 : bitmapSize(r, s).height; });
  def(TYPE, 'getOpacity', '()I', (r, _m, [self]) => { const s = st(r, self); if (s.bitmap === null) return -3; return s.gravity !== 119 || r.skiaHost.bitmaps.live(s.bitmap).hasAlpha || s.alpha < 255 ? -3 : -1; });
  def(TYPE, 'mutate', `()${DRAWABLE}`, (r, _m, [self]) => self);
  def(TYPE, 'getConstantState', '()Landroid/graphics/drawable/Drawable$ConstantState;', () => null);
  def(TYPE, 'draw', `(${CANVAS})V`, (r, _m, [self, canvas]) => {
    const s = st(r, self); if (s.bitmap === null) return;
    const b = boundsOf(r, self); if (b.right <= b.left || b.bottom <= b.top) return;
    let dst;
    if (s.gravity === 119) dst = rect(r, b.left, b.top, b.right, b.bottom);
    else {
      const size = bitmapSize(r, s), bounds = call(r, self, DRAWABLE, 'getBounds', [], RECT); dst = rect(r, 0, 0, 0, 0);
      r.dispatch({ owner: GRAVITY, name: 'apply', parameters: ['I', 'I', 'I', RECT, RECT, 'I'], result: 'V', signature: `(III${RECT}${RECT}I)V` }, [s.gravity, size.width, size.height, bounds, dst, 0], 'static');
    }
    call(r, canvas, CANVAS, 'drawBitmap', [BITMAP, RECT, RECT, PAINT], 'V', [s.bitmap, null, dst, makePaint(r, s)]);
    r.record('DRAW BitmapDrawable: Canvas.drawBitmap -> Skia image');
  });
  return { ...registry, interfaces: registry.interfacesOf };
}
