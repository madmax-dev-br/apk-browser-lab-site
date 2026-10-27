import { createHostRegistry, bitsFloat, floatBits } from './host-contract.js?v=64078a5322f4';

// android.widget.Magnifier and Magnifier.Builder (android-13.0.0_r1 Magnifier.java): size, zoom, corner radius, elevation and source-to-magnifier offsets come from the builder or from
// the framework's default_magnifier_* resources exactly as AOSP reads them; argument checks, getters and the show/update/dismiss lifecycle are AOSP's. The real class draws the
// zoomed pixels into a popup window through SurfaceControl and PixelCopy; the web frame has neither, so no magnifier pixels are drawn: the state machine is kept (Compose's text
// handle drag calls show/update/dismiss) and every show is traced as state-only.
const MAGNIFIER = 'Landroid/widget/Magnifier;', BUILDER = 'Landroid/widget/Magnifier$Builder;', VIEW = 'Landroid/view/View;', POINT = 'Landroid/graphics/Point;', OBJECT = 'Ljava/lang/Object;';

export function createMagnifierHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(MAGNIFIER, OBJECT, [], { allocatable: true }); type(BUILDER, OBJECT, [], { allocatable: true });
  const npe = (r, message) => r.throwJava('Ljava/lang/NullPointerException;', message);
  const positive = (r, value, message) => { if (!(value > 0)) r.throwJava('Ljava/lang/IllegalArgumentException;', message); return value; };
  const nonNegative = (r, value, message) => { if (!(value >= 0)) r.throwJava('Ljava/lang/IllegalArgumentException;', message); return value; };
  const framework = (r, name, kind) => {
    const table = platform.resources?.frameworkTable, id = table?.findId('dimen/' + name); if (!id) return null;
    let value = table.resolve(id); while (value.resolved) value = value.resolved;
    if (kind === 'float') return value.dataType === 4 ? bitsFloat(value.rawData | 0) : null;
    if (value.dataType !== 5) return null;
    const radix = (value.rawData >> 4) & 3, mantissa = (value.rawData >> 8) / [1, 128, 32768, 8388608][radix], unit = value.rawData & 15;
    return unit === 1 ? mantissa * (platform.device?.densityScale ?? 1) : unit === 0 ? mantissa : null;   // dip scaled by the 160 dpi web density; px as is
  };
  const defaults = r => {
    const px = (name, fallback) => framework(r, name) ?? fallback;
    return {
      width: Math.round(px('default_magnifier_width', 100)), height: Math.round(px('default_magnifier_height', 48)), elevation: px('default_magnifier_elevation', 4), cornerRadius: px('default_magnifier_corner_radius', 2),
      zoom: framework(r, 'default_magnifier_zoom', 'float') ?? 1.25, horizontalOffset: Math.round(px('default_magnifier_horizontal_offset', 0)), verticalOffset: Math.round(px('default_magnifier_vertical_offset', -42)), clipping: true,
    };
  };
  const stateOf = (r, ref) => r.object(ref).magnifier ?? npe(r, 'Magnifier used before construction');
  const builderOf = (r, ref) => r.object(ref).magnifierBuilder ?? npe(r, 'Magnifier.Builder used before construction');

  // ---- Builder
  def(BUILDER, '<init>', `(${VIEW})V`, (r, _m, [self, view]) => { if (view === null || view === 0) npe(r, 'view'); r.object(self).magnifierBuilder = { view, ...defaults(r) }; });
  def(BUILDER, 'setSize', `(II)${BUILDER}`, (r, _m, [self, width, height]) => { const b = builderOf(r, self); b.width = positive(r, width, 'Width should be positive'); b.height = positive(r, height, 'Height should be positive'); return self; });
  def(BUILDER, 'setInitialZoom', `(F)${BUILDER}`, (r, _m, [self, zoom]) => { builderOf(r, self).zoom = positive(r, bitsFloat(zoom), 'Zoom should be positive'); return self; });
  def(BUILDER, 'setElevation', `(F)${BUILDER}`, (r, _m, [self, elevation]) => { builderOf(r, self).elevation = nonNegative(r, bitsFloat(elevation), 'Elevation should be non-negative'); return self; });
  def(BUILDER, 'setCornerRadius', `(F)${BUILDER}`, (r, _m, [self, radius]) => { builderOf(r, self).cornerRadius = nonNegative(r, bitsFloat(radius), 'Corner radius should be non-negative'); return self; });
  def(BUILDER, 'setClippingEnabled', `(Z)${BUILDER}`, (r, _m, [self, enabled]) => { builderOf(r, self).clipping = enabled === 1 || enabled === true; return self; });
  def(BUILDER, 'setDefaultSourceToMagnifierOffset', `(II)${BUILDER}`, (r, _m, [self, horizontal, vertical]) => { const b = builderOf(r, self); b.horizontalOffset = horizontal; b.verticalOffset = vertical; return self; });
  def(BUILDER, 'build', `()${MAGNIFIER}`, (r, _m, [self]) => { const magnifier = r.allocate(MAGNIFIER); r.object(magnifier).magnifier = { ...builderOf(r, self), shown: false }; return magnifier; });

  // ---- Magnifier
  def(MAGNIFIER, '<init>', `(${VIEW})V`, (r, _m, [self, view]) => { if (view === null || view === 0) npe(r, 'view'); r.object(self).magnifier = { view, ...defaults(r), shown: false }; });
  const show = (r, self, sourceX, sourceY, magnifierX, magnifierY) => {
    const m = stateOf(r, self);
    if (r.object(m.view).attached === false) r.throwJava('Ljava/lang/IllegalStateException;', 'The magnifier view is not attached to a window');
    Object.assign(m, { shown: true, sourceX, sourceY, magnifierX, magnifierY });
    r.record('HOST Magnifier.show [state only: the web frame draws no magnifier window]');
  };
  def(MAGNIFIER, 'show', '(FF)V', (r, _m, [self, x, y]) => { const m = stateOf(r, self), sx = bitsFloat(x), sy = bitsFloat(y); show(r, self, sx, sy, sx + m.horizontalOffset, sy + m.verticalOffset); });
  def(MAGNIFIER, 'show', '(FFFF)V', (r, _m, [self, x, y, mx, my]) => show(r, self, bitsFloat(x), bitsFloat(y), bitsFloat(mx), bitsFloat(my)));
  def(MAGNIFIER, 'update', '()V', (r, _m, [self]) => { const m = stateOf(r, self); if (m.shown) r.record('HOST Magnifier.update [state only]'); });
  def(MAGNIFIER, 'dismiss', '()V', (r, _m, [self]) => { const m = stateOf(r, self); if (m.shown) { m.shown = false; r.record('HOST Magnifier.dismiss'); } });
  def(MAGNIFIER, 'getWidth', '()I', (r, _m, [self]) => stateOf(r, self).width);
  def(MAGNIFIER, 'getHeight', '()I', (r, _m, [self]) => stateOf(r, self).height);
  def(MAGNIFIER, 'getZoom', '()F', (r, _m, [self]) => floatBits(stateOf(r, self).zoom));
  def(MAGNIFIER, 'setZoom', '(F)V', (r, _m, [self, zoom]) => { stateOf(r, self).zoom = positive(r, bitsFloat(zoom), 'Zoom should be positive'); });
  def(MAGNIFIER, 'getElevation', '()F', (r, _m, [self]) => floatBits(stateOf(r, self).elevation));
  def(MAGNIFIER, 'getCornerRadius', '()F', (r, _m, [self]) => floatBits(stateOf(r, self).cornerRadius));
  def(MAGNIFIER, 'getSourceWidth', '()I', (r, _m, [self]) => { const m = stateOf(r, self); return Math.round(m.width / m.zoom); });
  def(MAGNIFIER, 'getSourceHeight', '()I', (r, _m, [self]) => { const m = stateOf(r, self); return Math.round(m.height / m.zoom); });
  def(MAGNIFIER, 'getDefaultHorizontalSourceToMagnifierOffset', '()I', (r, _m, [self]) => stateOf(r, self).horizontalOffset);
  def(MAGNIFIER, 'getDefaultVerticalSourceToMagnifierOffset', '()I', (r, _m, [self]) => stateOf(r, self).verticalOffset);
  def(MAGNIFIER, 'isClippingEnabled', '()Z', (r, _m, [self]) => stateOf(r, self).clipping ? 1 : 0);
  const point = (r, x, y) => { const p = r.allocate(POINT); r.dispatch({ owner: POINT, name: '<init>', parameters: ['I', 'I'], result: 'V', signature: '(II)V' }, [p, Math.round(x), Math.round(y)], 'direct'); return p; };
  def(MAGNIFIER, 'getPosition', `()${POINT}`, (r, _m, [self]) => { const m = stateOf(r, self); return m.shown ? point(r, m.magnifierX - m.width / 2, m.magnifierY - m.height / 2) : null; });
  def(MAGNIFIER, 'getSourcePosition', `()${POINT}`, (r, _m, [self]) => { const m = stateOf(r, self); return m.shown ? point(r, m.sourceX, m.sourceY) : null; });
  return registry;
}
