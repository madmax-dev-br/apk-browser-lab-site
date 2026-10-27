import { createHostRegistry } from './host-contract.js?v=6ef17e472569';
import { APKError } from './apk-error.js?v=6ef17e472569';

// Public android.view.View API (API 33) that the platform View model did not carry, with the semantics of android-13.0.0_r1 View.java. Grouped by topic below; state lives on the
// View's host object (`r.object(view)`), the same place the other view hosts keep theirs.
const VIEW = 'Landroid/view/View;', RENDER_EFFECT = 'Landroid/graphics/RenderEffect;';

export function createViewApiHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const nullish = value => value === null || value === undefined || value === 0;

  // ---- render effect (API 31): clearing is a no-op; a blur / shader effect needs a Skia image-filter pass over the View's RenderNode, which the lab does not have yet ----------
  def(VIEW, 'setRenderEffect', `(${RENDER_EFFECT})V`, (r, _m, [self, effect]) => {
    if (nullish(effect)) { delete r.object(self).renderEffect; return; }
    throw new APKError('View.setRenderEffect with a RenderEffect (blur / shader / color-filter effects) requires a Skia image-filter backend for RenderNode effects', { kind: 'render-effect-unsupported' });
  });

  // ---- layers (View.setLayerType / setLayerPaint / getLayerType / buildLayer): the type and paint are View state; the lab composites a View's display list directly, so a hardware
  // or software layer changes no pixels (a layer is a caching strategy), and the Paint's alpha / colour filter / xfermode are not applied to a layer composite --
  const PAINT = 'Landroid/graphics/Paint;', invalidate = (r, self) => platform.requestDraw?.(r, self);
  const layerState = (r, self) => r.object(self);
  def(VIEW, 'setLayerType', `(I${PAINT})V`, (r, _m, [self, type, paint]) => {
    if (type < 0 || type > 2) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Layer type can only be one of: LAYER_TYPE_NONE, LAYER_TYPE_SOFTWARE or LAYER_TYPE_HARDWARE');
    const view = layerState(r, self); view.layerType = type; view.layerPaint = nullish(paint) ? null : paint; invalidate(r, self);
  });
  def(VIEW, 'getLayerType', '()I', (r, _m, [self]) => layerState(r, self).layerType ?? 0);
  def(VIEW, 'setLayerPaint', `(${PAINT})V`, (r, _m, [self, paint]) => { const view = layerState(r, self); view.layerPaint = nullish(paint) ? null : paint; invalidate(r, self); });
  def(VIEW, 'buildLayer', '()V', (r, _m, [self]) => {
    const view = layerState(r, self);
    if ((view.layerType ?? 0) === 0) return;
    if (!view.attached) r.throwJava('Ljava/lang/IllegalStateException;', 'This view must be attached to a window first');
  });
  for (const [name, value] of [['LAYER_TYPE_NONE', 0], ['LAYER_TYPE_SOFTWARE', 1], ['LAYER_TYPE_HARDWARE', 2]]) registry.staticField(VIEW, name, 'I', () => value);

  // ---- ViewGroup.setOnHierarchyChangeListener: kept on the group; addView / removeView notify it after the onViewAdded / onViewRemoved hook (AndroidPlatform.notifyHierarchyChange) ----
  const GROUP = 'Landroid/view/ViewGroup;', HIERARCHY_LISTENER = 'Landroid/view/ViewGroup$OnHierarchyChangeListener;';
  def(GROUP, 'setOnHierarchyChangeListener', `(${HIERARCHY_LISTENER})V`, (r, _m, [self, listener]) => { r.object(self).hierarchyChangeListener = nullish(listener) ? null : listener; });
  void platform;
  return registry;
}
