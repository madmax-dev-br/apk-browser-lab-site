import { createHostRegistry } from './host-contract.js?v=d50f2f368405';

// android.widget.ProgressBar public API (API 33) with the semantics of android-13.0.0_r1 ProgressBar.java: min / max / progress / secondary progress with their clamping rules, the
// determinate <-> indeterminate switch (getProgress() is 0 while indeterminate and setProgress is ignored), progress and indeterminate drawables with the four tint sets applied to the
// drawable (or to its LayerDrawable layers: background, secondaryProgress, progress), the interpolator, and the min/max size limits that ProgressBar.onMeasure uses. The three
// values the snapshot and the saved-state host read (`max`, `progress`, `indeterminate`) stay on the view's host object. Drawing a ProgressBar through the native canvas path is a separate
// explicit wall in compose-canvas-host: the drawables held here are the real objects, but they are not painted yet.
const BAR = 'Landroid/widget/ProgressBar;', VIEW = 'Landroid/view/View;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', LAYER = 'Landroid/graphics/drawable/LayerDrawable;';
const TINT = 'Landroid/content/res/ColorStateList;', BLEND = 'Landroid/graphics/BlendMode;', MODE = 'Landroid/graphics/PorterDuff$Mode;', INTERPOLATOR = 'Landroid/view/animation/Interpolator;';
const CONTEXT = 'Landroid/content/Context;', INT_MAX = 0x7fffffff;
const ID_BACKGROUND = 16908288, ID_PROGRESS = 16908301, ID_SECONDARY = 16908303;
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
      view.pb = { min: view.xmlMin ?? 0, secondary: view.xmlSecondary ?? 0, onlyIndeterminate: false, progressDrawable: null, indeterminateDrawable: null, current: null, interpolator: null, limits: {}, tint: Object.fromEntries(TINTS.map(k => [k, { list: null, hasList: false, blend: null, hasBlend: false }])) };
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
  const swapCurrent = (r, self, drawable) => { const p = st(r, self); if (p.current !== drawable) { p.current = nullish(drawable) ? null : drawable; redraw(r, self); } };
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
  def(BAR, 'setProgressDrawableTiled', `(${DRAWABLE})V`, (r, _m, [self, d]) => call(r, self, BAR, 'setProgressDrawable', [DRAWABLE], 'V', [d]));   // tiling only matters for bitmap layers, which the lab loads untiled
  def(BAR, 'setIndeterminateDrawable', `(${DRAWABLE})V`, (r, _m, [self, d]) => {
    const p = st(r, self), next = nullish(d) ? null : d; if (p.indeterminateDrawable === next) return;
    if (p.indeterminateDrawable !== null && r.isSubtype(r.object(p.indeterminateDrawable).type, 'Landroid/graphics/drawable/Animatable;')) call(r, p.indeterminateDrawable, 'Landroid/graphics/drawable/Animatable;', 'stop');
    p.indeterminateDrawable = next;
    if (next !== null) { attach(r, self, next); applyIndeterminateTint(r, self); }
    if (r.object(self).indeterminate) { swapCurrent(r, self, next); redraw(r, self); }
  });
  def(BAR, 'setIndeterminateDrawableTiled', `(${DRAWABLE})V`, (r, _m, [self, d]) => call(r, self, BAR, 'setIndeterminateDrawable', [DRAWABLE], 'V', [d]));
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
  const refresh = (r, self) => {
    const view = r.object(self); redraw(r, self);
    // ProgressBar.refreshProgress -> onProgressRefresh: a subclass (AbsSeekBar) reacts; the base class only redraws.
    return view;
  };
  const setProgressInternal = (r, self, value) => {
    const view = r.object(self), p = st(r, self); if (view.indeterminate) return false;
    const next = clamp(value, p.min, view.max); if (next === view.progress) return false;
    view.progress = next; refresh(r, self); return true;
  };
  def(BAR, 'setProgress', '(I)V', (r, _m, [self, value]) => { setProgressInternal(r, self, value); });
  def(BAR, 'setProgress', '(IZ)V', (r, _m, [self, value]) => { setProgressInternal(r, self, value); });   // animate: the animation only matters for drawing; the value changes at once
  def(BAR, 'getProgress', '()I', (r, _m, [self]) => { st(r, self); const view = r.object(self); return view.indeterminate ? 0 : view.progress; });
  def(BAR, 'setSecondaryProgress', '(I)V', (r, _m, [self, value]) => {
    const view = r.object(self), p = st(r, self); if (view.indeterminate) return;
    const next = clamp(value, p.min, view.max); if (next !== p.secondary) { p.secondary = next; refresh(r, self); }
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
    if ((!p.onlyIndeterminate || !view.indeterminate) && next !== !!view.indeterminate) { view.indeterminate = next; swapCurrent(r, self, next ? p.indeterminateDrawable : p.progressDrawable); redraw(r, self); }
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
  /** The four limits: a value set through the API wins; the others come from the view's style (defaults 24 / unlimited as the layout host used before). */
  const limitsOf = (r, self) => {
    const view = r.object(self), p = st(r, self), table = platform.resources?.frameworkTable;
    if (!table) throw new Error('ProgressBar measurement needs the framework style table');
    let style;
    {
      const ids = r.newArray('[I', 4); r.object(ids).elements = NAMES.map(name => table.findId('attr/' + name));
      const attrs = view.appliedNode ? r.makeObject('Lapkweb/bridge/AttributeSet;') : null; if (attrs) r.object(attrs).node = view.appliedNode;
      const defStyle = view.defStyleAttr || table.findId(view.progressStyle === 'horizontal' ? 'attr/progressBarStyleHorizontal' : 'attr/progressBarStyle');
      const array = platform.styleBackend.obtain(r, platform.styleBackend.theme(r, view.context), attrs, ids, defStyle), TA = 'Landroid/content/res/TypedArray;';
      try { style = Object.fromEntries(NAMES.map((name, index) => [name, call(r, array, TA, 'getDimensionPixelSize', ['I', 'I'], 'I', [index, index % 2 ? INT_MAX : 24])])); }
      finally { call(r, array, TA, 'recycle'); }
    }
    return { ...style, ...p.limits };
  };
  registry.limits = (r, self) => { const l = limitsOf(r, self); return [l.minWidth, l.maxWidth, l.minHeight, l.maxHeight]; };
  NAMES.forEach(name => {
    const cap = name[0].toUpperCase() + name.slice(1);
    def(BAR, `get${cap}`, '()I', (r, _m, [self]) => st(r, self).limits[name] ?? limitsOf(r, self)[name]);
    def(BAR, `set${cap}`, '(I)V', (r, _m, [self, value]) => { const p = st(r, self); if (p.limits[name] !== value) { p.limits[name] = value; relayout(r, self); } });
  });
  return registry;
}
