import { createHostRegistry } from './host-contract.js?v=e04c619c649c';
import { APKError } from './apk-error.js?v=e04c619c649c';
import { HOST_STYLEABLES } from './host-styleables.js?v=e04c619c649c';

// android.widget.ProgressBar public API (API 33) with the semantics of android-13.0.0_r1 ProgressBar.java: min / max / progress / secondary progress with their clamping rules, the
// determinate <-> indeterminate switch (getProgress() is 0 while indeterminate and setProgress is ignored), progress and indeterminate drawables with the four tint sets applied to the
// drawable (or to its LayerDrawable layers: background, secondaryProgress, progress), the interpolator, and the min/max size limits that ProgressBar.onMeasure uses. The three
// values the snapshot and the saved-state host read (`max`, `progress`, `indeterminate`) stay on the view's host object.
// The constructor's attribute pass (R.styleable.ProgressBar from the tag, its style="", the default style and the theme, in the order ProgressBar.java reads them) is
// `applyAttributes`; ProgressBar.tileify, updateDrawableBounds, drawTrack with the indeterminate animation, and what onMeasure takes from the current drawable are here too.
// Where the VM draws the View through a Canvas the drawables held here are what is painted; on the page a ProgressBar is the page's own progress element, fed from the same state.
const BAR = 'Landroid/widget/ProgressBar;', VIEW = 'Landroid/view/View;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', LAYER = 'Landroid/graphics/drawable/LayerDrawable;';
const TINT = 'Landroid/content/res/ColorStateList;', BLEND = 'Landroid/graphics/BlendMode;', MODE = 'Landroid/graphics/PorterDuff$Mode;', INTERPOLATOR = 'Landroid/view/animation/Interpolator;';
const CONTEXT = 'Landroid/content/Context;', INT_MAX = 0x7fffffff, MIRROR = 'Landroid/widget/ProgressBar;->mMirrorForRtl:Z', SAMPLE = 'Landroid/widget/ProgressBar;->mSampleWidth:I';
const ID_BACKGROUND = 16908288, ID_PROGRESS = 16908301, ID_SECONDARY = 16908303;
const F32 = new Float32Array(1), I32 = new Int32Array(F32.buffer), f2i = v => { F32[0] = v; return I32[0]; }, i2f = v => { I32[0] = v; return F32[0]; };
const CANVAS = 'Landroid/graphics/Canvas;', TA = 'Landroid/content/res/TypedArray;', ANIMATABLE = 'Landroid/graphics/drawable/Animatable;', ANIMATION_DRAWABLE = 'Landroid/graphics/drawable/AnimationDrawable;';
/** R.styleable.ProgressBar (the pinned attrs.xml, src/host-styleables.js). */
export const PROGRESS_BAR_ATTRIBUTES = HOST_STYLEABLES.ProgressBar;
const TINT_ATTRIBUTES = { progress: 'progressTint', background: 'progressBackgroundTint', secondary: 'secondaryProgressTint', indeterminate: 'indeterminateTint' };
const nullish = v => v === null || v === undefined || v === 0;
const flag = v => v === true || v === 1 || v === 0xffffffff || v === -1;
const PORTER_TO_SKIA = { CLEAR: 0, SRC: 1, DST: 2, SRC_OVER: 3, DST_OVER: 4, SRC_IN: 5, DST_IN: 6, SRC_OUT: 7, DST_OUT: 8, SRC_ATOP: 9, DST_ATOP: 10, XOR: 11, ADD: 12, SCREEN: 14, OVERLAY: 15, DARKEN: 16, LIGHTEN: 17, MULTIPLY: 24 };

export function createProgressBarApiHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [o], 'direct'); return o; };
  const TINTS = ['progress', 'background', 'secondary', 'indeterminate'];
  const st = (r, self) => {
    const view = r.object(self);
    if (!view.pb) {
      view.pb = { min: view.xmlMin ?? 0, secondary: view.xmlSecondary ?? 0, onlyIndeterminate: false, duration: 4000, behavior: 1, started: false, animationStart: null, progressDrawable: null, indeterminateDrawable: null, current: null, interpolator: null, limits: {}, tint: Object.fromEntries(TINTS.map(k => [k, { list: null, hasList: false, blend: null, hasBlend: false }])) };
      view.max ??= 100; view.progress ??= 0;
    }
    return view.pb;
  };
  const clamp = (value, lo, hi) => value < lo ? lo : value > hi ? hi : value;
  const redraw = (r, self) => platform.requestDraw?.(r, self);
  const relayout = (r, self) => { call(r, self, VIEW, 'requestLayout'); redraw(r, self); };

  // ---- drawables and tints --------------------------------------------------------------------------------------------------------------------------
  const stateOf = (r, self, drawable) => { if (flag(call(r, drawable, DRAWABLE, 'isStateful', [], 'Z'))) call(r, drawable, DRAWABLE, 'setState', ['[I'], 'Z', [call(r, self, VIEW, 'getDrawableState', [], '[I')]); };
  const tintTarget = (r, p, id, fallback) => {
    let layer = null;
    if (!nullish(p.progressDrawable) && r.isSubtype(r.object(p.progressDrawable).type, LAYER)) layer = call(r, p.progressDrawable, LAYER, 'findDrawableByLayerId', ['I'], DRAWABLE, [id]);
    if (fallback && nullish(layer)) layer = p.progressDrawable;
    return nullish(layer) ? null : layer;
  };
  const applyOne = (r, self, p, key, target) => {
    const t = p.tint[key]; if (!(t.hasList || t.hasBlend) || target === null) return;
    if (t.hasList) call(r, target, DRAWABLE, 'setTintList', [TINT], 'V', [t.list]);
    if (t.hasBlend) call(r, target, DRAWABLE, 'setTintBlendMode', [BLEND], 'V', [t.blend]);
    stateOf(r, self, target);
  };
  const applyTarget = (r, self, key, id, fallback) => {
    const p = st(r, self); let target = tintTarget(r, p, id, fallback); if (target === null) return;
    target = call(r, target, DRAWABLE, 'mutate', [], DRAWABLE); applyOne(r, self, p, key, target);
  };
  const applyProgressTints = (r, self) => {
    const p = st(r, self); if (nullish(p.progressDrawable)) return;
    if (p.tint.progress.hasList || p.tint.progress.hasBlend || p.tint.background.hasList || p.tint.background.hasBlend || p.tint.secondary.hasList || p.tint.secondary.hasBlend) {
      p.progressDrawable = call(r, p.progressDrawable, DRAWABLE, 'mutate', [], DRAWABLE);
      applyTarget(r, self, 'progress', ID_PROGRESS, true); applyTarget(r, self, 'background', ID_BACKGROUND, false); applyTarget(r, self, 'secondary', ID_SECONDARY, false);
    }
  };
  const applyIndeterminateTint = (r, self) => {
    const p = st(r, self), t = p.tint.indeterminate; if (nullish(p.indeterminateDrawable) || !(t.hasList || t.hasBlend)) return;
    p.indeterminateDrawable = call(r, p.indeterminateDrawable, DRAWABLE, 'mutate', [], DRAWABLE); applyOne(r, self, p, 'indeterminate', p.indeterminateDrawable);
  };
  const swapCurrent = (r, self, drawable) => { const p = st(r, self); if (p.current !== drawable) { p.current = nullish(drawable) ? null : drawable; if (!r.object(self).indeterminate) applyLevel(r, self); redraw(r, self); } };
  const attach = (r, self, drawable) => {
    call(r, drawable, DRAWABLE, 'setLayoutDirection', ['I'], 'Z', [call(r, self, VIEW, 'getLayoutDirection', [], 'I')]);
    stateOf(r, self, drawable);
  };

  def(BAR, 'setProgressDrawable', `(${DRAWABLE})V`, (r, _m, [self, d]) => {
    const p = st(r, self), next = nullish(d) ? null : d; if (p.progressDrawable === next) return;
    p.progressDrawable = next;
    if (next !== null) {
      attach(r, self, next);
      // Make sure the ProgressBar is always tall enough
      const height = call(r, next, DRAWABLE, 'getMinimumHeight', [], 'I'), maxHeight = p.limits.maxHeight ?? (platform.resources?.frameworkTable ? limitsOf(r, self).maxHeight : 48);   // 48: the field default before a style applies
      if (maxHeight < height) { p.limits.maxHeight = height; relayout(r, self); }
      applyProgressTints(r, self);
    }
    if (!r.object(self).indeterminate) { swapCurrent(r, self, next); redraw(r, self); }
  });
  def(BAR, 'getProgressDrawable', `()${DRAWABLE}`, (r, _m, [self]) => st(r, self).progressDrawable);
  /** ProgressBar.needsTileify: a bitmap anywhere in the layers / states of the drawable. */
  const BITMAP = 'Landroid/graphics/drawable/BitmapDrawable;', STATE_LIST = 'Landroid/graphics/drawable/StateListDrawable;';
  const needsTileify = (r, d) => {
    const type = r.object(d).type;
    if (r.isSubtype(type, LAYER)) { const n = call(r, d, LAYER, 'getNumberOfLayers', [], 'I'); for (let i = 0; i < n; i++) if (needsTileify(r, call(r, d, LAYER, 'getDrawable', ['I'], DRAWABLE, [i]))) return true; return false; }
    if (r.isSubtype(type, STATE_LIST)) { const n = call(r, d, STATE_LIST, 'getStateCount', [], 'I'); for (let i = 0; i < n; i++) if (needsTileify(r, call(r, d, STATE_LIST, 'getStateDrawable', ['I'], DRAWABLE, [i]))) return true; return false; }
    return r.isSubtype(type, BITMAP);
  };
  /**
   * ProgressBar.tileify(drawable, clip): a copy of the drawable in which every bitmap repeats horizontally (Shader.TileMode.REPEAT / CLAMP) and, in the progress and secondary
   * progress layers, is clipped from the left by its level. The first bitmap's width becomes mSampleWidth (RatingBar.onMeasure multiplies it by the number of stars).
   */
  const CLIP = 'Landroid/graphics/drawable/ClipDrawable;', TILE = 'Landroid/graphics/Shader$TileMode;', STATE = 'Landroid/graphics/drawable/Drawable$ConstantState;', RESOURCES = 'Landroid/content/res/Resources;';
  const LAYER_PROPERTIES = ['LayerGravity', 'LayerWidth', 'LayerHeight', 'LayerInsetLeft', 'LayerInsetRight', 'LayerInsetTop', 'LayerInsetBottom', 'LayerInsetStart', 'LayerInsetEnd'];
  const make = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const tileMode = (r, name) => r.readStatic({ owner: TILE, name, type: TILE, key: `${TILE}->${name}:${TILE}` });
  const tileify = (r, self, d, clip) => {
    const type = r.object(d).type;
    if (r.isSubtype(type, LAYER)) {
      const n = call(r, d, LAYER, 'getNumberOfLayers', [], 'I'), out = r.newArray(`[${DRAWABLE}`, n);
      for (let i = 0; i < n; i++) { const id = call(r, d, LAYER, 'getId', ['I'], 'I', [i]); r.array(out).elements[i] = tileify(r, self, call(r, d, LAYER, 'getDrawable', ['I'], DRAWABLE, [i]), id === ID_PROGRESS || id === ID_SECONDARY); }
      const clone = make(r, LAYER, [`[${DRAWABLE}`], [out]);
      for (let i = 0; i < n; i++) { call(r, clone, LAYER, 'setId', ['I', 'I'], 'V', [i, call(r, d, LAYER, 'getId', ['I'], 'I', [i])]); for (const property of LAYER_PROPERTIES) call(r, clone, LAYER, `set${property}`, ['I', 'I'], 'V', [i, call(r, d, LAYER, `get${property}`, ['I'], 'I', [i])]); }
      return clone;
    }
    if (r.isSubtype(type, STATE_LIST)) {
      const out = construct(r, STATE_LIST), n = call(r, d, STATE_LIST, 'getStateCount', [], 'I');
      for (let i = 0; i < n; i++) call(r, out, STATE_LIST, 'addState', ['[I', DRAWABLE], 'V', [call(r, d, STATE_LIST, 'getStateSet', ['I'], '[I', [i]), tileify(r, self, call(r, d, STATE_LIST, 'getStateDrawable', ['I'], DRAWABLE, [i]), clip)]);
      return out;
    }
    if (r.isSubtype(type, BITMAP)) {
      const view = r.object(self), clone = call(r, call(r, d, DRAWABLE, 'getConstantState', [], STATE), STATE, 'newDrawable', [RESOURCES], DRAWABLE, [call(r, self, VIEW, 'getResources', [], RESOURCES)]);
      call(r, clone, BITMAP, 'setTileModeXY', [TILE, TILE], 'V', [tileMode(r, 'REPEAT'), tileMode(r, 'CLAMP')]);
      if ((view.fields.get(SAMPLE) ?? 0) <= 0) r.storeField(view.fields, SAMPLE, call(r, clone, DRAWABLE, 'getIntrinsicWidth', [], 'I'));
      if (!clip) return clone;
      if (!r.classes.has(CLIP)) throw new APKError('ProgressBar.tileify: the progress layer of a bitmap drawable is clipped by an android.graphics.drawable.ClipDrawable, whose original class is in the layouts profile, which is not loaded for this APK', { kind: 'progress-tileify-unsupported' });
      return make(r, CLIP, [DRAWABLE, 'I', 'I'], [clone, 3, 1]);   // Gravity.LEFT, ClipDrawable.HORIZONTAL
    }
    return d;
  };
  /** ProgressBar.tileifyIndeterminate: the frames of an AnimationDrawable tiled, at full level. */
  const tileifyIndeterminate = (r, self, d) => {
    if (!r.isSubtype(r.object(d).type, ANIMATION_DRAWABLE)) return d;
    const n = call(r, d, ANIMATION_DRAWABLE, 'getNumberOfFrames', [], 'I'), out = construct(r, ANIMATION_DRAWABLE);
    call(r, out, ANIMATION_DRAWABLE, 'setOneShot', ['Z'], 'V', [call(r, d, ANIMATION_DRAWABLE, 'isOneShot', [], 'Z')]);
    for (let i = 0; i < n; i++) { const frame = tileify(r, self, call(r, d, ANIMATION_DRAWABLE, 'getFrame', ['I'], DRAWABLE, [i]), true); call(r, frame, DRAWABLE, 'setLevel', ['I'], 'Z', [10000]); call(r, out, ANIMATION_DRAWABLE, 'addFrame', [DRAWABLE, 'I'], 'V', [frame, call(r, d, ANIMATION_DRAWABLE, 'getDuration', ['I'], 'I', [i])]); }
    call(r, out, DRAWABLE, 'setLevel', ['I'], 'Z', [10000]);
    return out;
  };
  def(BAR, 'setProgressDrawableTiled', `(${DRAWABLE})V`, (r, _m, [self, d]) => call(r, self, BAR, 'setProgressDrawable', [DRAWABLE], 'V', [nullish(d) ? null : tileify(r, self, d, false)]));
  /** ProgressBar.stopAnimation: the indeterminate drawable stops (an Animatable) and the level animation of drawTrack starts over at the next start. */
  const stopAnimation = (r, self) => {
    const p = st(r, self), d = p.indeterminateDrawable;
    if (p.started && !nullish(d) && r.isSubtype(r.object(d).type, ANIMATABLE)) call(r, d, ANIMATABLE, 'stop');
    p.started = false; p.animationStart = null;
  };
  def(BAR, 'setIndeterminateDrawable', `(${DRAWABLE})V`, (r, _m, [self, d]) => {
    const p = st(r, self), next = nullish(d) ? null : d; if (p.indeterminateDrawable === next) return;
    if (p.indeterminateDrawable !== null && r.isSubtype(r.object(p.indeterminateDrawable).type, ANIMATABLE)) call(r, p.indeterminateDrawable, ANIMATABLE, 'stop');
    p.started = false; p.animationStart = null;
    p.indeterminateDrawable = next;
    if (next !== null) { attach(r, self, next); applyIndeterminateTint(r, self); }
    if (r.object(self).indeterminate) { swapCurrent(r, self, next); redraw(r, self); }
  });
  def(BAR, 'setIndeterminateDrawableTiled', `(${DRAWABLE})V`, (r, _m, [self, d]) => call(r, self, BAR, 'setIndeterminateDrawable', [DRAWABLE], 'V', [nullish(d) ? null : tileifyIndeterminate(r, self, d)]));
  def(BAR, 'getIndeterminateDrawable', `()${DRAWABLE}`, (r, _m, [self]) => st(r, self).indeterminateDrawable);
  def(BAR, 'getCurrentDrawable', `()${DRAWABLE}`, (r, _m, [self]) => { const p = st(r, self); return r.object(self).indeterminate ? p.indeterminateDrawable : p.progressDrawable; });

  const tintAccessors = (key, name, apply) => {
    const t = (r, self) => st(r, self).tint[key];
    def(BAR, `set${name}TintList`, `(${TINT})V`, (r, _m, [self, list]) => { const x = t(r, self); x.list = nullish(list) ? null : list; x.hasList = true; apply(r, self); });
    def(BAR, `get${name}TintList`, `()${TINT}`, (r, _m, [self]) => t(r, self).list);
    def(BAR, `set${name}TintBlendMode`, `(${BLEND})V`, (r, _m, [self, mode]) => { const x = t(r, self); x.blend = nullish(mode) ? null : mode; x.hasBlend = true; apply(r, self); });
    def(BAR, `get${name}TintBlendMode`, `()${BLEND}`, (r, _m, [self]) => t(r, self).blend);
    def(BAR, `set${name}TintMode`, `(${MODE})V`, (r, _m, [self, mode]) => call(r, self, BAR, `set${name}TintBlendMode`, [BLEND], 'V', [nullish(mode) ? null : callStatic(r, BLEND, 'fromValue', ['I'], BLEND, [PORTER_TO_SKIA[r.object(mode).enumName]])]));
    def(BAR, `get${name}TintMode`, `()${MODE}`, (r, _m, [self]) => { const b = t(r, self).blend; return nullish(b) ? null : callStatic(r, BLEND, 'blendModeToPorterDuffMode', [BLEND], MODE, [b]); });
  };
  const withDrawable = (key, id, fallback) => (r, self) => { if (!nullish(st(r, self).progressDrawable)) applyTarget(r, self, key, id, fallback); redraw(r, self); };
  tintAccessors('progress', 'Progress', withDrawable('progress', ID_PROGRESS, true));
  tintAccessors('background', 'ProgressBackground', withDrawable('background', ID_BACKGROUND, false));
  tintAccessors('secondary', 'SecondaryProgress', withDrawable('secondary', ID_SECONDARY, false));
  tintAccessors('indeterminate', 'Indeterminate', (r, self) => { applyIndeterminateTint(r, self); redraw(r, self); });

  // ---- range and progress ---------------------------------------------------------------------------------------------------------------------------
  /** ProgressBar.setVisualProgress: the layer `id` of the current drawable (the drawable itself when it is not a LayerDrawable or has no such layer) shows `scale` of its range through its level
   *  (0..10000, float arithmetic as in the original). */
  const applyLevel = (r, self, id = ID_PROGRESS, scale = scaleOf(r, self, id)) => {
    const p = st(r, self), view = r.object(self), d = p.current; if (nullish(d) || view.indeterminate) return;
    let target = d; if (r.isSubtype(r.object(d).type, LAYER)) { const layer = call(r, d, LAYER, 'findDrawableByLayerId', ['I'], DRAWABLE, [id]); if (!nullish(layer)) target = layer; }
    call(r, target, DRAWABLE, 'setLevel', ['I'], 'Z', [Math.trunc(Math.fround(scale * 10000))]);
  };
  const scaleOf = (r, self, id) => { const view = r.object(self), p = st(r, self), range = view.max - p.min; return range > 0 ? Math.fround(((id === ID_SECONDARY ? p.secondary : view.progress) - p.min) / range) : 0; };
  /** ProgressBar.refreshProgress -> doRefreshProgress (android-13.0.0_r1): the visual progress of layer `id`, then the two hooks a subclass overrides: onVisualProgressChanged(id, scale)
   *  (AbsSeekBar moves its thumb) and, for the primary progress, onProgressRefresh(scale, fromUser, progress) (SeekBar / RatingBar call their listeners). */
  const refresh = (r, self, id = ID_PROGRESS, fromUser = false) => {
    const view = r.object(self), scale = scaleOf(r, self, id); applyLevel(r, self, id, scale); redraw(r, self);
    if (r.objectOverride(view.type, 'onVisualProgressChanged(IF)V')) call(r, self, BAR, 'onVisualProgressChanged', ['I', 'F'], 'V', [id, f2i(scale)]);
    if (id === ID_PROGRESS) call(r, self, BAR, 'onProgressRefresh', ['F', 'Z', 'I'], 'V', [f2i(scale), fromUser ? 1 : 0, view.progress]);
    return view;
  };
  const setProgressInternal = (r, self, value, fromUser = false) => {
    const view = r.object(self), p = st(r, self); if (view.indeterminate) return false;
    const next = clamp(value, p.min, view.max); if (next === view.progress) return false;
    view.progress = next; refresh(r, self, ID_PROGRESS, fromUser); return true;
  };
  // Package-private members of ProgressBar that the original AbsSeekBar / SeekBar / RatingBar call or override.
  def(BAR, 'setProgressInternal', '(IZZ)Z', (r, _m, [self, value, fromUser]) => setProgressInternal(r, self, value, flag(fromUser)) ? 1 : 0);   // animate only changes how the level gets there
  def(BAR, 'onVisualProgressChanged', '(IF)V', () => {});   // the original body is empty
  def(BAR, 'onProgressRefresh', '(FZI)V', (r, _m, [self]) => {
    // the original sends TYPE_WINDOW_CONTENT_CHANGED / CONTENT_CHANGE_TYPE_STATE_DESCRIPTION when accessibility is enabled and the view has no state description of its own
    const view = r.object(self); if (!platform.accessibilityService?.getState?.().enabled || view.indeterminate || !nullish(call(r, self, VIEW, 'getStateDescription', [], 'Ljava/lang/CharSequence;'))) return;
    const EVENT = 'Landroid/view/accessibility/AccessibilityEvent;', event = callStatic(r, EVENT, 'obtain', [], EVENT);
    call(r, event, EVENT, 'setEventType', ['I'], 'V', [2048]); call(r, event, EVENT, 'setContentChangeTypes', ['I'], 'V', [64]); call(r, self, VIEW, 'sendAccessibilityEventUnchecked', [EVENT], 'V', [event]);
  });
  def(BAR, 'onResolveDrawables', '(I)V', (r, _m, [self, direction]) => { const p = st(r, self); for (const d of new Set([p.current, p.indeterminateDrawable, p.progressDrawable])) if (!nullish(d)) call(r, d, DRAWABLE, 'setLayoutDirection', ['I'], 'Z', [direction]); });
  /**
   * ProgressBar.updateDrawableBounds(w, h): the progress drawable fills the box inside the padding; the indeterminate drawable too, except that a bar that is only indeterminate keeps
   * the drawable's aspect ratio, centred (not for an AnimationDrawable), and a mirrored bar under a right-to-left layout swaps the sides.
   */
  const updateDrawableBounds = (r, self, w, h) => {
    const view = r.object(self), p = st(r, self), padding = view.padding ?? {};
    w -= (padding.right ?? 0) + (padding.left ?? 0); h -= (padding.top ?? 0) + (padding.bottom ?? 0);
    let right = w, bottom = h, top = 0, left = 0;
    const d = p.indeterminateDrawable;
    if (!nullish(d)) {
      if (p.onlyIndeterminate && !r.isSubtype(r.object(d).type, ANIMATION_DRAWABLE)) {
        const intrinsicAspect = Math.fround(call(r, d, DRAWABLE, 'getIntrinsicWidth', [], 'I') / call(r, d, DRAWABLE, 'getIntrinsicHeight', [], 'I')), boundAspect = Math.fround(w / h);
        if (intrinsicAspect !== boundAspect) {
          if (boundAspect > intrinsicAspect) { const width = Math.trunc(Math.fround(h * intrinsicAspect)); left = Math.trunc((w - width) / 2); right = left + width; }
          else { const height = Math.trunc(Math.fround(w * Math.fround(1 / intrinsicAspect))); top = Math.trunc((h - height) / 2); bottom = top + height; }
        }
      }
      if ((view.layoutDirection || 0) === 1 && flag(view.fields.get(MIRROR))) { const tempLeft = left; left = w - right; right = w - tempLeft; }
      call(r, d, DRAWABLE, 'setBounds', ['I', 'I', 'I', 'I'], 'V', [left | 0, top | 0, right | 0, bottom | 0]);
    }
    if (!nullish(p.progressDrawable)) call(r, p.progressDrawable, DRAWABLE, 'setBounds', ['I', 'I', 'I', 'I'], 'V', [0, 0, Math.max(0, right) | 0, Math.max(0, bottom) | 0]);
  };
  /** ProgressBar.drawTrack: the current drawable inside the padding (mirrored for a right-to-left layout when the style asks for it). A plain ProgressBar has no size callback in the lab, so
   *  its drawables get their bounds here (updateDrawableBounds); a class that overrides drawTrack (AbsSeekBar) places the track itself in updateThumbAndTrackPos.
   *  The indeterminate animation is the original's: an Animatable drawable (the Material animated vectors) is started at the first draw, any other drawable gets its level from
   *  AlphaAnimation(0, 1) over android:indeterminateDuration with android:indeterminateBehavior as repeat mode and the interpolator, and asks for the next frame. Both run only while
   *  the bar is drawn through a Canvas, and stop when it leaves the window or stops being indeterminate. */
  def(BAR, 'drawTrack', `(${CANVAS})V`, (r, _m, [self, canvas]) => {
    const view = r.object(self), p = view.pb, current = p?.current; if (nullish(current)) return;
    const padding = view.padding ?? {}, bounds = view.bounds ?? {}, w = (bounds.right ?? 0) - (bounds.left ?? 0), h = (bounds.bottom ?? 0) - (bounds.top ?? 0), left = padding.left ?? 0, top = padding.top ?? 0, right = padding.right ?? 0;
    if (!r.objectOverride(view.type, `drawTrack(${CANVAS})V`)) updateDrawableBounds(r, self, w, h);
    const animating = !!view.indeterminate && current === p.indeterminateDrawable && view.visibility !== 4 && view.visibility !== 8, animatable = animating && r.isSubtype(r.object(current).type, ANIMATABLE);
    const save = call(r, canvas, CANVAS, 'save', [], 'I');
    try {
      if ((view.layoutDirection || 0) === 1 && flag(view.fields.get(MIRROR))) { call(r, canvas, CANVAS, 'translate', ['F', 'F'], 'V', [f2i(w - right), f2i(top)]); call(r, canvas, CANVAS, 'scale', ['F', 'F'], 'V', [f2i(-1), f2i(1)]); }
      else call(r, canvas, CANVAS, 'translate', ['F', 'F'], 'V', [f2i(left), f2i(top)]);
      if (animating && !animatable) {   // mHasAnimation: Animation.getTransformation(drawing time) of AlphaAnimation(0, 1), INFINITE, START_ON_FIRST_FRAME
        const time = Number(call(r, self, VIEW, 'getDrawingTime', [], 'J')), duration = Math.max(1, p.duration), elapsed = Math.max(0, time - (p.animationStart ??= time)), cycle = Math.floor(elapsed / duration);
        let fraction = elapsed / duration - cycle; if (p.behavior === 2 && cycle % 2 === 1) fraction = 1 - fraction;   // Animation.REVERSE ("cycle"); RESTART ("repeat") otherwise
        const scale = i2f(call(r, call(r, self, BAR, 'getInterpolator', [], INTERPOLATOR), INTERPOLATOR, 'getInterpolation', ['F'], 'F', [f2i(Math.fround(fraction))]));
        call(r, current, DRAWABLE, 'setLevel', ['I'], 'Z', [Math.trunc(Math.fround(scale * 10000))]);
        if (view.attached) platform.requestDraw?.(r, self, 16);   // postInvalidateOnAnimation: the next frame
      }
      call(r, current, DRAWABLE, 'draw', [CANVAS], 'V', [canvas]);
    } finally { call(r, canvas, CANVAS, 'restoreToCount', ['I'], 'V', [save]); }
    if (animatable && !p.started && view.attached) { p.started = true; call(r, current, ANIMATABLE, 'start'); }   // mShouldStartAnimationDrawable
  });
  /** View.dispatchDetachedFromWindow -> ProgressBar.onDetachedFromWindow: the indeterminate animation stops. */
  registry.afterAttach = (r, self, attached) => { const view = r.object(self); if (!attached && view.pb && r.isSubtype(view.type, BAR)) stopAnimation(r, self); };
  /** What ProgressBar.onMeasure takes from the current drawable: its intrinsic size inside the four limits (without one, the limits alone), and updateDrawableState. */
  registry.measureExtent = (r, self) => {
    const view = r.object(self), p = st(r, self), [minW, maxW, minH, maxH] = registry.limits(r, self), d = p.current;
    if (nullish(d)) return [Math.max(minW, Math.min(maxW, 0)), Math.max(minH, Math.min(maxH, 0))];
    const size = [Math.max(minW, Math.min(maxW, call(r, d, DRAWABLE, 'getIntrinsicWidth', [], 'I'))), Math.max(minH, Math.min(maxH, call(r, d, DRAWABLE, 'getIntrinsicHeight', [], 'I')))];
    for (const drawable of new Set([p.progressDrawable, p.indeterminateDrawable])) if (!nullish(drawable)) stateOf(r, self, drawable);
    return size;
  };
  def(BAR, 'setProgress', '(I)V', (r, _m, [self, value]) => { setProgressInternal(r, self, value); });
  def(BAR, 'setProgress', '(IZ)V', (r, _m, [self, value]) => { setProgressInternal(r, self, value); });   // animate: the animation only matters for drawing; the value changes at once
  def(BAR, 'getProgress', '()I', (r, _m, [self]) => { st(r, self); const view = r.object(self); return view.indeterminate ? 0 : view.progress; });
  def(BAR, 'setSecondaryProgress', '(I)V', (r, _m, [self, value]) => {
    const view = r.object(self), p = st(r, self); if (view.indeterminate) return;
    const next = clamp(value, p.min, view.max); if (next !== p.secondary) { p.secondary = next; refresh(r, self, ID_SECONDARY); }
  });
  def(BAR, 'getSecondaryProgress', '()I', (r, _m, [self]) => { const p = st(r, self); return r.object(self).indeterminate ? 0 : p.secondary; });
  def(BAR, 'incrementProgressBy', '(I)V', (r, _m, [self, diff]) => call(r, self, BAR, 'setProgress', ['I'], 'V', [call(r, self, BAR, 'getProgress', [], 'I') + diff]));
  def(BAR, 'incrementSecondaryProgressBy', '(I)V', (r, _m, [self, diff]) => call(r, self, BAR, 'setSecondaryProgress', ['I'], 'V', [call(r, self, BAR, 'getSecondaryProgress', [], 'I') + diff]));
  def(BAR, 'setMax', '(I)V', (r, _m, [self, max]) => {
    const view = r.object(self), p = st(r, self); if (max < p.min) max = p.min;
    if (max !== view.max) { view.max = max; if (view.progress > max) view.progress = max; if (p.secondary > max) p.secondary = max; refresh(r, self); }
  });
  def(BAR, 'getMax', '()I', (r, _m, [self]) => { st(r, self); return r.object(self).max; });
  def(BAR, 'setMin', '(I)V', (r, _m, [self, min]) => {
    const view = r.object(self), p = st(r, self); if (min > view.max) min = view.max;
    if (min !== p.min) { p.min = min; if (view.progress < min) view.progress = min; if (p.secondary < min) p.secondary = min; refresh(r, self); }
  });
  def(BAR, 'getMin', '()I', (r, _m, [self]) => st(r, self).min);
  def(BAR, 'setIndeterminate', '(Z)V', (r, _m, [self, on]) => {
    const view = r.object(self), p = st(r, self), next = flag(on);
    if ((!p.onlyIndeterminate || !view.indeterminate) && next !== !!view.indeterminate) { view.indeterminate = next; if (!next) stopAnimation(r, self); swapCurrent(r, self, next ? p.indeterminateDrawable : p.progressDrawable); redraw(r, self); }
  });
  def(BAR, 'isIndeterminate', '()Z', (r, _m, [self]) => (st(r, self), r.object(self).indeterminate ? 1 : 0));
  def(BAR, 'isAnimating', '()Z', (r, _m, [self]) => {
    if (!r.object(self).indeterminate) return 0;
    return call(r, self, VIEW, 'getWindowVisibility', [], 'I') === 0 && flag(call(r, self, VIEW, 'isShown', [], 'Z')) ? 1 : 0;
  });

  // ---- interpolator ---------------------------------------------------------------------------------------------------------------------------------
  def(BAR, 'setInterpolator', `(${INTERPOLATOR})V`, (r, _m, [self, value]) => { st(r, self).interpolator = nullish(value) ? null : value; });
  def(BAR, 'setInterpolator', `(${CONTEXT}I)V`, (r, _m, [self, context, id]) => { st(r, self).interpolator = callStatic(r, 'Landroid/view/animation/AnimationUtils;', 'loadInterpolator', [CONTEXT, 'I'], INTERPOLATOR, [context, id]); });
  def(BAR, 'getInterpolator', `()${INTERPOLATOR}`, (r, _m, [self]) => { const p = st(r, self); return p.interpolator ??= construct(r, 'Landroid/view/animation/LinearInterpolator;'); });   // R.anim.linear_interpolator, the style default

  // ---- size limits (ProgressBar.onMeasure) ----------------------------------------------------------------------------------------------------------
  const NAMES = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'];
  // ProgressBar's own fields (package-private: mMinWidth / mMinHeight shadow View's) that the original AbsSeekBar / RatingBar read in onMeasure and when they place the thumb.
  const fieldKey = name => `${BAR}->m${name[0].toUpperCase() + name.slice(1)}:I`;
  NAMES.forEach(name => registry.instanceField(BAR, `m${name[0].toUpperCase() + name.slice(1)}`, 'I')); registry.instanceField(BAR, 'mMirrorForRtl', 'Z'); registry.instanceField(BAR, 'mSampleWidth', 'I');
  /** The four limits: a value set through the API wins; the others come from the view's style (defaults 24 / 48 px, the fields ProgressBar.initProgressBar sets). */
  const limitsOf = (r, self) => {
    const view = r.object(self), p = st(r, self), table = platform.resources?.frameworkTable;
    if (NAMES.every(name => p.limits[name] !== undefined)) return p.limits;   // the constructor pass read them (applyAttributes), or the app set all four
    if (!table) throw new Error('ProgressBar measurement needs the framework style table');
    let style;
    {
      const ids = r.newArray('[I', 4); r.object(ids).elements = NAMES.map(name => table.findId('attr/' + name));
      const attrs = view.appliedNode ? r.makeObject('Lapkweb/bridge/AttributeSet;') : null; if (attrs) r.object(attrs).node = view.appliedNode;
      const defStyle = view.defStyleAttr || table.findId(view.progressStyle === 'horizontal' ? 'attr/progressBarStyleHorizontal' : 'attr/progressBarStyle');
      const array = platform.styleBackend.obtain(r, platform.styleBackend.theme(r, view.context), attrs, ids, defStyle), TA = 'Landroid/content/res/TypedArray;';
      try { style = Object.fromEntries(NAMES.map((name, index) => [name, call(r, array, TA, 'getDimensionPixelSize', ['I', 'I'], 'I', [index, index % 2 ? 48 : 24])])); }
      finally { call(r, array, TA, 'recycle'); }
    }
    return { ...style, ...p.limits };
  };
  /**
   * ProgressBar(Context, AttributeSet, int defStyleAttr, int defStyleRes) after View's constructor: one TypedArray over R.styleable.ProgressBar (the tag, its style="", the default
   * style and the theme), read in the order of the original constructor, each value through the setter the original calls (the virtual ones virtually: AbsSeekBar overrides
   * setMin / setMax) or into the field it assigns. Returns the attribute names of the styleable (the generic XML pass does not apply them again), or null when it did not run.
   *
   * The default style is android:progressBarStyle unless the constructor was given another, and is read where the VM measures and draws Views itself (as the other passes do)
   * and for a class with an original subclass (AbsSeekBar measures and draws its own track). Where the page lays the Views out only the tag and its style="" are read.
   *
   * A drawable the virtual device cannot build leaves the bar without it and is reported under "XML attributes NOT APPLIED" with the reason: a framework bitmap that is not in
   * the lab's framework resource data (the pre-Material spinner frames, the stars of ratingbar_material), or a bitmap layer whose clip needs a class of the layouts profile.
   * Any other failure of the drawable (a broken resource of the app) propagates, as Resources.getDrawable's exception does out of the constructor on Android.
   */
  registry.applyAttributes = (r, self, node, context) => {
    const view = r.object(self), kit = platform.viewXmlAttributes?.kit, source = kit?.table();
    if (!r.isSubtype(view.type, BAR) || !kit || !source || nullish(context) || !r.classes.has(TA) || !platform.styleBackend) return null;
    const styled = !!platform.resources?.frameworkTable && (!!r.skia && !!platform.resources.frameworkXml || view.type !== BAR);
    let defStyleAttr = 0, defStyleRes = 0;
    if (styled) { defStyleAttr = view.defStyleExplicit ? view.defStyleAttr | 0 : (view.defStyleAttr || source.findId(view.progressStyle === 'horizontal' ? 'attr/progressBarStyleHorizontal' : 'attr/progressBarStyle')) | 0; defStyleRes = view.defStyleRes | 0; }
    if (!node && !defStyleAttr && !defStyleRes) return null;
    const list = kit.styleable(r, 'ProgressBar', PROGRESS_BAR_ATTRIBUTES);
    if (!styled && !kit.tagGives(node, list.handled)) return list.handled;   // nothing to read
    const ids = r.newArray('[I', list.ids.length); r.object(ids).elements = [...list.ids];
    const a = kit.reader(r, platform.styleBackend.obtain(r, kit.theme(r, context), kit.attributeSet(r, node), ids, defStyleAttr, defStyleRes), list), p = st(r, self), tag = node?.name ?? kit.tagOf(view);
    /** a.getDrawable + the setter; the two known gaps of the virtual device are reported, everything else is the constructor's own failure. */
    const drawable = (name, setter) => kit.attempt(r, view, name, () => {
      let d;
      try { d = a.drawable(name); if (!nullish(d)) call(r, self, BAR, needsTileify(r, d) ? `${setter}Tiled` : setter, [DRAWABLE], 'V', [d]); }
      catch (error) {
        const reason = String(error?.message ?? error), absent = /android framework resource (0x0?1[0-9a-f]{6}) is not in the lab's framework resource data/.exec(reason);
        // Where the page lays the screen out no graphics backend is loaded (android.graphics.Path and the rest are not there), and a drawable that needs one cannot be built:
        // the bar is the page's own progress element. Said as that, not as the class the drawable's inflation stopped at.
        if (!absent && !r.skia && error?.name === 'APKError' && platform.isAttributeRefusal(error)) { platform.noteXmlAttributeNotApplied(r, name, tag, `the page lays this screen out and shows the bar as its own progress element; the ${name === 'progressDrawable' ? 'progress' : 'indeterminate'} drawable is not built, because the graphics backend is not loaded for this APK (${platform.refusalReason(error).split(' (')[0].slice(0, 120)})`); return; }
        if (!absent && error?.details?.kind !== 'progress-tileify-unsupported') throw error;
        platform.noteXmlAttributeNotApplied(r, name, tag, `${absent ? `the framework drawable Resource ${absent[1]} is not in the lab's framework resource table (bitmap drawables are not shipped)` : reason.replace(/^(?:L[^ ]+ \[[^\]]*\] at PC 0x[\da-f]+: )+/i, '')}; the bar has no ${name === 'progressDrawable' ? 'progress' : 'indeterminate'} drawable and draws nothing through a Canvas`);
      }
    });
    try {
      if (styled) p.limits = { minWidth: 24, maxWidth: 48, minHeight: 24, maxHeight: 48 };   // initProgressBar
      drawable('progressDrawable', 'setProgressDrawable');   // may raise mMaxHeight, which is why android:maxHeight is read after it
      p.duration = a.int('indeterminateDuration', p.duration);
      for (const name of NAMES) if (styled || a.has(name)) p.limits[name] = a.size(name, p.limits[name] ?? (name.startsWith('min') ? 24 : 48));
      p.behavior = a.int('indeterminateBehavior', p.behavior);
      // android:interpolator, android.R.anim.linear_interpolator without it: the default is made on first use (getInterpolator), a LinearInterpolator either way
      if (a.has('interpolator')) kit.attempt(r, view, 'interpolator', () => { const id = a.resource('interpolator', 0); if (id > 0) call(r, self, BAR, 'setInterpolator', [CONTEXT, 'I'], 'V', [context, id]); });
      call(r, self, BAR, 'setMin', ['I'], 'V', [a.int('min', p.min)]);
      call(r, self, BAR, 'setMax', ['I'], 'V', [a.int('max', view.max)]);
      call(r, self, BAR, 'setProgress', ['I'], 'V', [a.int('progress', view.progress)]);
      call(r, self, BAR, 'setSecondaryProgress', ['I'], 'V', [a.int('secondaryProgress', p.secondary)]);
      drawable('indeterminateDrawable', 'setIndeterminateDrawable');
      p.onlyIndeterminate = a.bool('indeterminateOnly', p.onlyIndeterminate);
      call(r, self, BAR, 'setIndeterminate', ['Z'], 'V', [p.onlyIndeterminate || a.bool('indeterminate', !!view.indeterminate) ? 1 : 0]);
      r.storeField(view.fields, MIRROR, a.bool('mirrorForRtl', flag(view.fields.get(MIRROR))) ? 1 : 0);
      for (const key of TINTS) {
        const name = TINT_ATTRIBUTES[key], t = p.tint[key];
        if (a.has(`${name}Mode`)) { t.blend = kit.parseBlendMode(r, a.int(`${name}Mode`, -1)); t.hasBlend = true; }
        if (a.has(name)) {
          t.list = a.colors(name); t.hasList = true;
          if (key === 'progress' && !nullish(t.list)) view.progressTint = kit.colorText(call(r, t.list, TINT, 'getDefaultColor', [], 'I'));   // the colour of the page's progress element
        }
      }
    } finally { a.recycle(); }
    applyProgressTints(r, self); applyIndeterminateTint(r, self);
    // the fields the original subclasses read (AbsSeekBar.onMeasure, RatingBar.onMeasure)
    if (view.type !== BAR && platform.resources?.frameworkTable) { const l = limitsOf(r, self); NAMES.forEach(name => r.storeField(view.fields, fieldKey(name), l[name])); }
    // "If not explicitly specified this view is important for accessibility."
    if (call(r, self, VIEW, 'getImportantForAccessibility', [], 'I') === 0) call(r, self, VIEW, 'setImportantForAccessibility', ['I'], 'V', [1]);
    return list.handled;
  };
  registry.limits = (r, self) => { const l = limitsOf(r, self); return [l.minWidth, l.maxWidth, l.minHeight, l.maxHeight]; };
  NAMES.forEach(name => {
    const cap = name[0].toUpperCase() + name.slice(1);
    def(BAR, `get${cap}`, '()I', (r, _m, [self]) => st(r, self).limits[name] ?? limitsOf(r, self)[name]);
    def(BAR, `set${cap}`, '(I)V', (r, _m, [self, value]) => { const p = st(r, self); r.storeField(r.object(self).fields, fieldKey(name), value); if (p.limits[name] !== value) { p.limits[name] = value; relayout(r, self); } });
  });
  return registry;
}
