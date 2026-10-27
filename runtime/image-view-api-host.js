import { createHostRegistry } from './host-contract.js?v=fd59ee7c3d79';
import { APKError } from './apk-error.js?v=fd59ee7c3d79';

// android.widget.ImageView API (API 33) beyond ScaleType / setImageBitmap (image-view-host.js): colour filter, alpha, tint, level, matrix, crop-to-padding, adjustViewBounds and the max
// size, baseline alignment, setImageURI / setImageIcon, with the semantics of android-13.0.0_r1 ImageView.java. Colour filter, alpha, tint and level act on the image Drawable itself
// (so they show wherever the Drawable draws); the image matrix replaces the MATRIX scale type's transform in the draw pass; the properties that change measurement or clipping
// (adjustViewBounds, maxWidth / maxHeight, cropToPadding, baseline) are kept and `unsupportedRendering` names the ones the native image path does not apply yet.
const IMAGE = 'Landroid/widget/ImageView;', VIEW = 'Landroid/view/View;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', TINT = 'Landroid/content/res/ColorStateList;', BLEND = 'Landroid/graphics/BlendMode;', MODE = 'Landroid/graphics/PorterDuff$Mode;';
const FILTER = 'Landroid/graphics/ColorFilter;', MATRIX = 'Landroid/graphics/Matrix;', URI = 'Landroid/net/Uri;', INT_MAX = 0x7fffffff;
const nullish = v => v === null || v === undefined || v === 0;
const flag = v => v === true || v === 1 || v === 0xffffffff || v === -1;
const PORTER_TO_SKIA = { CLEAR: 0, SRC: 1, DST: 2, SRC_OVER: 3, DST_OVER: 4, SRC_IN: 5, DST_IN: 6, SRC_OUT: 7, DST_OUT: 8, SRC_ATOP: 9, DST_ATOP: 10, XOR: 11, ADD: 12, SCREEN: 14, OVERLAY: 15, DARKEN: 16, LIGHTEN: 17, MULTIPLY: 24 };

export function createImageViewApiHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const st = (r, self) => r.object(self).iv ??= { adjustViewBounds: false, maxWidth: INT_MAX, maxHeight: INT_MAX, baselineAlignBottom: false, baseline: -1, cropToPadding: false, alpha: 255, colorMod: false, hasColorFilter: false, colorFilter: null, hasAlpha: false,
    tintList: null, hasTint: false, blend: null, hasBlend: false, matrix: null };
  const drawableOf = (r, self) => r.object(self).imageDrawable ?? null;
  const redraw = (r, self) => platform.requestDraw?.(r, self);
  const relayout = (r, self) => { call(r, self, VIEW, 'requestLayout'); redraw(r, self); };

  /** ImageView.applyColorMod + applyImageTint on the current image drawable (called when the drawable or a modifier changes). */
  const apply = (r, self) => {
    const s = st(r, self); let drawable = drawableOf(r, self); if (nullish(drawable)) return;
    if (s.colorMod) {
      drawable = call(r, drawable, DRAWABLE, 'mutate', [], DRAWABLE); r.object(self).imageDrawable = drawable;
      if (s.hasColorFilter) call(r, drawable, DRAWABLE, 'setColorFilter', [FILTER], 'V', [s.colorFilter]);
      if (s.hasAlpha) call(r, drawable, DRAWABLE, 'setAlpha', ['I'], 'V', [(s.alpha * 256) >> 8]);   // mAlpha * mViewAlphaScale(256) >> 8
    }
    if (s.hasTint || s.hasBlend) {
      drawable = call(r, drawable, DRAWABLE, 'mutate', [], DRAWABLE); r.object(self).imageDrawable = drawable;
      if (s.hasTint) call(r, drawable, DRAWABLE, 'setTintList', [TINT], 'V', [s.tintList]);
      if (s.hasBlend) call(r, drawable, DRAWABLE, 'setTintBlendMode', [BLEND], 'V', [s.blend]);
      if (flag(call(r, drawable, DRAWABLE, 'isStateful', [], 'Z'))) call(r, drawable, DRAWABLE, 'setState', ['[I'], 'Z', [call(r, self, VIEW, 'getDrawableState', [], '[I')]);
    }
  };
  registry.drawableChanged = apply;

  def(IMAGE, 'setColorFilter', `(${FILTER})V`, (r, _m, [self, filter]) => {
    const s = st(r, self), next = nullish(filter) ? null : filter; if (s.colorFilter === next && s.hasColorFilter) return;
    s.colorFilter = next; s.hasColorFilter = true; s.colorMod = true; apply(r, self); redraw(r, self);
  });
  def(IMAGE, 'setColorFilter', `(I${MODE})V`, (r, _m, [self, color, mode]) => call(r, self, IMAGE, 'setColorFilter', [FILTER], 'V', [construct(r, 'Landroid/graphics/PorterDuffColorFilter;', ['I', MODE], [color, mode])]));
  def(IMAGE, 'setColorFilter', '(I)V', (r, _m, [self, color]) => call(r, self, IMAGE, 'setColorFilter', ['I', MODE], 'V', [color, r.readStatic({ owner: MODE, name: 'SRC_ATOP', type: MODE })]));
  def(IMAGE, 'clearColorFilter', '()V', (r, _m, [self]) => call(r, self, IMAGE, 'setColorFilter', [FILTER], 'V', [null]));
  def(IMAGE, 'getColorFilter', `()${FILTER}`, (r, _m, [self]) => st(r, self).colorFilter);
  def(IMAGE, 'setImageAlpha', '(I)V', (r, _m, [self, alpha]) => { const s = st(r, self), a = alpha & 0xff; if (s.alpha !== a) { s.alpha = a; s.hasAlpha = true; s.colorMod = true; apply(r, self); redraw(r, self); } });
  def(IMAGE, 'getImageAlpha', '()I', (r, _m, [self]) => st(r, self).alpha);
  def(IMAGE, 'setImageTintList', `(${TINT})V`, (r, _m, [self, list]) => { const s = st(r, self); s.tintList = nullish(list) ? null : list; s.hasTint = true; apply(r, self); redraw(r, self); });
  def(IMAGE, 'getImageTintList', `()${TINT}`, (r, _m, [self]) => st(r, self).tintList);
  def(IMAGE, 'setImageTintBlendMode', `(${BLEND})V`, (r, _m, [self, mode]) => { const s = st(r, self); s.blend = nullish(mode) ? null : mode; s.hasBlend = true; apply(r, self); redraw(r, self); });
  def(IMAGE, 'getImageTintBlendMode', `()${BLEND}`, (r, _m, [self]) => st(r, self).blend);
  def(IMAGE, 'setImageTintMode', `(${MODE})V`, (r, _m, [self, mode]) => call(r, self, IMAGE, 'setImageTintBlendMode', [BLEND], 'V', [nullish(mode) ? null : callStatic(r, BLEND, 'fromValue', ['I'], BLEND, [PORTER_TO_SKIA[r.object(mode).enumName]])]));
  def(IMAGE, 'getImageTintMode', `()${MODE}`, (r, _m, [self]) => { const b = st(r, self).blend; return nullish(b) ? null : callStatic(r, BLEND, 'blendModeToPorterDuffMode', [BLEND], MODE, [b]); });
  def(IMAGE, 'setImageLevel', '(I)V', (r, _m, [self, level]) => { const drawable = drawableOf(r, self); r.object(self).imageLevel = level; if (!nullish(drawable)) call(r, drawable, DRAWABLE, 'setLevel', ['I'], 'Z', [level]); redraw(r, self); });
  def(IMAGE, 'setImageIcon', '(Landroid/graphics/drawable/Icon;)V', (r, _m, [self, icon]) => call(r, self, IMAGE, 'setImageDrawable', [DRAWABLE], 'V', [nullish(icon) ? null : call(r, icon, 'Landroid/graphics/drawable/Icon;', 'loadDrawable', ['Landroid/content/Context;'], DRAWABLE, [call(r, self, VIEW, 'getContext', [], 'Landroid/content/Context;')])]));
  def(IMAGE, 'setImageURI', `(${URI})V`, (r, _m, [self, uri]) => {
    if (nullish(uri)) { call(r, self, IMAGE, 'setImageDrawable', [DRAWABLE], 'V', [null]); return; }
    const resolver = call(r, call(r, self, VIEW, 'getContext', [], 'Landroid/content/Context;'), 'Landroid/content/Context;', 'getContentResolver', [], 'Landroid/content/ContentResolver;');
    let drawable = null;
    try {
      const stream = call(r, resolver, 'Landroid/content/ContentResolver;', 'openInputStream', [URI], 'Ljava/io/InputStream;', [uri]);
      if (!nullish(stream)) drawable = callStatic(r, DRAWABLE, 'createFromStream', ['Ljava/io/InputStream;', 'Ljava/lang/String;'], DRAWABLE, [stream, null]);
    } catch (error) { if (error?.name !== 'JavaException') throw error; r.record(`LOG W ImageView: Unable to open content: ${r.stringCharacters(call(r, uri, 'Ljava/lang/Object;', 'toString', [], 'Ljava/lang/String;'))}`); }
    call(r, self, IMAGE, 'setImageDrawable', [DRAWABLE], 'V', [drawable]);
  });

  def(IMAGE, 'getImageMatrix', `()${MATRIX}`, (r, _m, [self]) => { const s = st(r, self); return s.matrix ?? construct(r, MATRIX, [], []); });
  def(IMAGE, 'setImageMatrix', `(${MATRIX})V`, (r, _m, [self, matrix]) => {
    const s = st(r, self), identity = nullish(matrix) || flag(call(r, matrix, MATRIX, 'isIdentity', [], 'Z'));
    if (identity) { if (s.matrix === null) return; s.matrix = null; } else { s.matrix = construct(r, MATRIX, [MATRIX], [matrix]); }
    redraw(r, self);
  });
  registry.imageMatrix = (r, self) => st(r, self).matrix;
  def(IMAGE, 'animateTransform', `(${MATRIX})V`, (r, _m, [self, matrix]) => call(r, self, IMAGE, 'setImageMatrix', [MATRIX], 'V', [matrix]));   // ImageView.animateTransform: the transform animates in the real framework; the end state applies here at once

  const prop = (setter, getter, key, type, effect = 'relayout') => {
    const [setName, setSig] = setter.split(/(?=\()/), [getName, getSig] = getter.split(/(?=\()/);
    def(IMAGE, setName, setSig, (r, _m, [self, raw]) => { const s = st(r, self), value = type === 'Z' ? flag(raw) : raw; if (s[key] === value) return; s[key] = value; if (effect === 'relayout') relayout(r, self); else redraw(r, self); });
    def(IMAGE, getName, getSig, (r, _m, [self]) => { const value = st(r, self)[key]; return type === 'Z' ? (value ? 1 : 0) : value; });
  };
  prop('setAdjustViewBounds(Z)V', 'getAdjustViewBounds()Z', 'adjustViewBounds', 'Z');
  prop('setMaxWidth(I)V', 'getMaxWidth()I', 'maxWidth', 'I'); prop('setMaxHeight(I)V', 'getMaxHeight()I', 'maxHeight', 'I');
  prop('setCropToPadding(Z)V', 'getCropToPadding()Z', 'cropToPadding', 'Z', 'redraw');
  prop('setBaselineAlignBottom(Z)V', 'getBaselineAlignBottom()Z', 'baselineAlignBottom', 'Z');
  def(IMAGE, 'setBaseline', '(I)V', (r, _m, [self, baseline]) => { const s = st(r, self); if (s.baseline !== baseline) { s.baseline = baseline; relayout(r, self); } });
  def(IMAGE, 'setFrame', '(IIII)Z', (r, _m, [self, l, t, rr, b]) => {
    const view = r.object(self), before = view.bounds ?? {}, changed = before.left !== l || before.top !== t || before.right !== rr || before.bottom !== b;
    call(r, self, VIEW, 'setLeftTopRightBottom', ['I', 'I', 'I', 'I'], 'V', [l, t, rr, b]); return changed ? 1 : 0;
  });

  /** Why the native image path cannot lay out / draw this ImageView as AOSP would, or null. */
  registry.unsupportedRendering = (r, self) => {
    const s = r.object(self).iv; if (!s) return null;
    if (s.adjustViewBounds) return 'adjustViewBounds (the measure pass does not resize to the drawable\'s aspect ratio)';
    if (s.maxWidth !== INT_MAX || s.maxHeight !== INT_MAX) return 'maxWidth / maxHeight';
    if (s.cropToPadding) return 'cropToPadding';
    if (s.baselineAlignBottom || s.baseline !== -1) return 'baseline';
    return null;
  };
  void APKError;
  return registry;
}
