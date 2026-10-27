import { createHostRegistry } from './host-contract.js?v=fd59ee7c3d79';
import { APKError } from './apk-error.js?v=fd59ee7c3d79';

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


  // ================================================================================== shared helpers
  const RECT = 'Landroid/graphics/Rect;', POINT = 'Landroid/graphics/Point;', RECTF = 'Landroid/graphics/RectF;', MATRIX = 'Landroid/graphics/Matrix;', CONTEXT = 'Landroid/content/Context;', RESOURCES = 'Landroid/content/res/Resources;';
  const STRING = 'Ljava/lang/String;', CHARS = 'Ljava/lang/CharSequence;', OBJECT = 'Ljava/lang/Object;', LIST = 'Ljava/util/List;', ARRAYLIST = 'Ljava/util/ArrayList;';
  const flag = value => value === true || value === 1 || value === 0xffffffff || value === -1;
  const ref = value => value?.ref;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const viewCall = (r, self, name, parameters = [], result = 'V', args = []) => call(r, self, VIEW, name, parameters, result, args);
  const isView = (r, value) => !nullish(value) && typeof value === 'object' && r.isSubtype(r.object(value).type, VIEW);
  const isGroup = (r, value) => !nullish(value) && typeof value === 'object' && r.isSubtype(r.object(value).type, 'Landroid/view/ViewGroup;');
  const childrenOf = (r, self) => [...(r.object(self).children ?? [])];
  const npe = (r, message = null) => r.throwJava('Ljava/lang/NullPointerException;', message);
  const parentView = (r, self) => { const p = r.object(self).parent; return isView(r, p) ? p : null; };
  const rectSet = (r, rect, left, top, right, bottom) => call(r, rect, RECT, 'set', ['I', 'I', 'I', 'I'], 'V', [left, top, right, bottom]);
  const bits = new DataView(new ArrayBuffer(4)), f2i = n => { bits.setFloat32(0, n, true); return bits.getInt32(0, true); }, i2f = n => { bits.setInt32(0, n | 0, true); return bits.getFloat32(0, true); };
  const dimension = (r, self) => { const left = viewCall(r, self, 'getLeft', [], 'I'), top = viewCall(r, self, 'getTop', [], 'I'), right = viewCall(r, self, 'getRight', [], 'I'), bottom = viewCall(r, self, 'getBottom', [], 'I'); return { left, top, right, bottom, width: right - left, height: bottom - top }; };

  // ================================================================================== resources, hierarchy lookup, visibility
  def(VIEW, 'getResources', `()${RESOURCES}`, (r, _m, [self]) => { const context = viewCall(r, self, 'getContext', [], CONTEXT); return call(r, context, CONTEXT, 'getResources', [], RESOURCES); });
  // View.isShown: every ancestor up to the window root is VISIBLE, and the chain ends at the window (ViewRootImpl is not a View), not at a detached parent-less View
  def(VIEW, 'isShown', '()Z', (r, _m, [self]) => {
    let current = self;
    for (let depth = 0; current && depth < 4096; depth++) {
      const view = r.object(current); if ((view.visibility ?? 0) !== 0) return 0;
      const parent = view.parent; if (nullish(parent)) return view.attached ? 1 : 0;
      if (!isView(r, parent)) return 1;
      current = parent;
    }
    return 0;
  });
  def(VIEW, 'requireViewById', `(I)${VIEW}`, (r, _m, [self, id]) => {
    const found = viewCall(r, self, 'findViewById', ['I'], VIEW, [id]);
    if (nullish(found)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'ID does not reference a View inside this View');
    return found;
  });
  def(VIEW, 'findViewWithTag', `(${OBJECT})${VIEW}`, (r, _m, [self, tag]) => {
    if (nullish(tag)) return null;
    const matches = view => { const own = viewCall(r, view, 'getTag', [], OBJECT); return !nullish(own) && call(r, tag, OBJECT, 'equals', [OBJECT], 'Z', [own]) === 1; };
    const search = view => { if (matches(view)) return view; for (const child of childrenOf(r, view)) { const hit = search(child); if (hit) return hit; } return null; };
    return search(self);
  });
  // View.findViewsWithText(outViews, searched, flags): FIND_VIEWS_WITH_TEXT = 1, FIND_VIEWS_WITH_CONTENT_DESCRIPTION = 2; TextView overrides with its text (below)
  def(VIEW, 'findViewsWithText', `(${ARRAYLIST}${CHARS}I)V`, (r, _m, [self, out, searched, flags]) => {
    if ((flags & 2) === 2 && !nullish(searched)) {
      const description = viewCall(r, self, 'getContentDescription', [], CHARS);
      if (!nullish(description) && r.stringCharacters(call(r, description, OBJECT, 'toString', [], STRING)).toLowerCase().includes(r.stringCharacters(call(r, searched, OBJECT, 'toString', [], STRING)).toLowerCase())) call(r, out, ARRAYLIST, 'add', [OBJECT], 'Z', [self]);
    }
  });
  def('Landroid/view/ViewGroup;', 'findViewsWithText', `(${ARRAYLIST}${CHARS}I)V`, (r, _m, [self, out, searched, flags]) => {
    r.dispatch({ owner: VIEW, name: 'findViewsWithText', parameters: [ARRAYLIST, CHARS, 'I'], result: 'V', signature: `(${ARRAYLIST}${CHARS}I)V` }, [self, out, searched, flags], 'direct');
    for (const child of childrenOf(r, self)) if ((r.object(child).visibility ?? 0) === 0 || true) viewCall(r, child, 'findViewsWithText', [ARRAYLIST, CHARS, 'I'], 'V', [out, searched, flags]);
  });
  def(VIEW, 'getWindowAttachCount', '()I', (r, _m, [self]) => r.object(self).windowAttachCount ?? (r.object(self).attached ? 1 : 0));
  def(VIEW, 'isTemporarilyDetached', '()Z', (r, _m, [self]) => r.object(self).temporarilyDetached ? 1 : 0);
  def(VIEW, 'dispatchStartTemporaryDetach', '()V', (r, _m, [self]) => { viewCall(r, self, 'onStartTemporaryDetach'); r.object(self).temporarilyDetached = true; });
  def(VIEW, 'dispatchFinishTemporaryDetach', '()V', (r, _m, [self]) => { r.object(self).temporarilyDetached = false; viewCall(r, self, 'onFinishTemporaryDetach'); });
  def(VIEW, 'onStartTemporaryDetach', '()V', () => {}); def(VIEW, 'onFinishTemporaryDetach', '()V', () => {});
  def(VIEW, 'isInLayout', '()Z', (r, _m, [self]) => r.object(self).inLayout ? 1 : 0);

  // ================================================================================== geometry
  def(VIEW, 'getDrawingRect', `(${RECT})V`, (r, _m, [self, outRect]) => {
    const d = dimension(r, self), x = viewCall(r, self, 'getScrollX', [], 'I'), y = viewCall(r, self, 'getScrollY', [], 'I');
    rectSet(r, outRect, x, y, x + d.width, y + d.height);
  });
  def(VIEW, 'getFocusedRect', `(${RECT})V`, (r, _m, [self, outRect]) => viewCall(r, self, 'getDrawingRect', [RECT], 'V', [outRect]));
  const mapRectThroughMatrix = (r, view, left, top, right, bottom) => {
    const matrix = viewCall(r, view, 'getMatrix', [], MATRIX), rect = construct(r, RECTF, ['F', 'F', 'F', 'F'], [f2i(left), f2i(top), f2i(right), f2i(bottom)]);
    call(r, matrix, MATRIX, 'mapRect', [RECTF], 'Z', [rect]);
    return { left: readField(r, rect, 'left'), top: readField(r, rect, 'top'), right: readField(r, rect, 'right'), bottom: readField(r, rect, 'bottom') };
  };
  const readField = (r, rect, name) => i2f(r.object(rect).fields.get(`${RECTF}->${name}:F`) ?? 0);
  def(VIEW, 'getHitRect', `(${RECT})V`, (r, _m, [self, outRect]) => {
    const d = dimension(r, self);
    if (viewCall(r, self, 'hasIdentityMatrix', [], 'Z') || !r.object(self).attached) { rectSet(r, outRect, d.left, d.top, d.right, d.bottom); return; }
    const m = mapRectThroughMatrix(r, self, 0, 0, d.width, d.height);
    rectSet(r, outRect, Math.round(m.left + d.left), Math.round(m.top + d.top), Math.round(m.right + d.left), Math.round(m.bottom + d.top));   // View.getHitRect: the transformed rect, then offset by (mLeft, mTop)
  });
  // ViewGroup.getChildVisibleRect (android-13.0.0_r1) for a chain of parents; `offset` is a Point or null
  const childVisibleRect = (r, group, child, rect, offset) => {
    const d = dimension(r, group), scrollX = viewCall(r, group, 'getScrollX', [], 'I'), scrollY = viewCall(r, group, 'getScrollY', [], 'I'), c = dimension(r, child);
    let box = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    if (!viewCall(r, child, 'hasIdentityMatrix', [], 'Z')) box = mapRectThroughMatrix(r, child, box.left, box.top, box.right, box.bottom);
    const dx = c.left - scrollX, dy = c.top - scrollY;
    box = { left: box.left + dx, top: box.top + dy, right: box.right + dx, bottom: box.bottom + dy };
    if (offset) { offset.x += dx; offset.y += dy; }
    const intersect = (l, t, rr, b) => { const nl = Math.max(box.left, l), nt = Math.max(box.top, t), nr = Math.min(box.right, rr), nb = Math.min(box.bottom, b); if (nl < nr && nt < nb) { box = { left: nl, top: nt, right: nr, bottom: nb }; return true; } return false; };
    let visible = true;
    const parent = r.object(group).parent;
    if (nullish(parent) || !isGroup(r, parent) || flag(call(r, parent, 'Landroid/view/ViewGroup;', 'getClipChildren', [], 'Z'))) visible = intersect(0, 0, d.width, d.height);
    if (visible && flag(call(r, group, 'Landroid/view/ViewGroup;', 'getClipToPadding', [], 'Z'))) visible = intersect(viewCall(r, group, 'getPaddingLeft', [], 'I'), viewCall(r, group, 'getPaddingTop', [], 'I'), d.width - viewCall(r, group, 'getPaddingRight', [], 'I'), d.height - viewCall(r, group, 'getPaddingBottom', [], 'I'));
    const clip = r.object(group).clipBounds;
    if (visible && clip) visible = intersect(clip.left, clip.top, clip.right, clip.bottom);
    rect.left = Math.floor(box.left); rect.top = Math.floor(box.top); rect.right = Math.ceil(box.right); rect.bottom = Math.ceil(box.bottom);
    if (visible && isGroup(r, parent)) return childVisibleRect(r, parent, group, rect, offset);
    return visible;
  };
  def(VIEW, 'getGlobalVisibleRect', `(${RECT}${POINT})Z`, (r, _m, [self, outRect, globalOffset]) => {
    const d = dimension(r, self); if (!(d.width > 0 && d.height > 0)) return 0;
    const rect = { left: 0, top: 0, right: d.width, bottom: d.height }, offset = nullish(globalOffset) ? null : { x: -viewCall(r, self, 'getScrollX', [], 'I'), y: -viewCall(r, self, 'getScrollY', [], 'I') };
    const parent = r.object(self).parent; let visible = true;
    if (isGroup(r, parent)) visible = childVisibleRect(r, parent, self, rect, offset);
    rectSet(r, outRect, rect.left, rect.top, rect.right, rect.bottom);
    if (offset) call(r, globalOffset, POINT, 'set', ['I', 'I'], 'V', [Math.round(offset.x), Math.round(offset.y)]);
    return visible ? 1 : 0;
  });
  def(VIEW, 'getGlobalVisibleRect', `(${RECT})Z`, (r, _m, [self, outRect]) => viewCall(r, self, 'getGlobalVisibleRect', [RECT, POINT], 'Z', [outRect, null]));
  def(VIEW, 'getLocalVisibleRect', `(${RECT})Z`, (r, _m, [self, outRect]) => {
    const offset = construct(r, POINT, [], []);
    if (!flag(viewCall(r, self, 'getGlobalVisibleRect', [RECT, POINT], 'Z', [outRect, offset]))) return 0;
    const f = r.object(offset).fields; call(r, outRect, RECT, 'offset', ['I', 'I'], 'V', [-(f.get(`${POINT}->x:I`) ?? 0), -(f.get(`${POINT}->y:I`) ?? 0)]); return 1;
  });
  def(VIEW, 'getLocationInSurface', '([I)V', (r, _m, [self, location]) => {
    viewCall(r, self, 'getLocationInWindow', ['[I'], 'V', [location]);   // no scaled surface / compat translation on the virtual window: the surface origin is the window origin
  });
  def(VIEW, 'transformMatrixToLocal', `(${MATRIX})V`, (r, _m, [self, matrix]) => {
    const parent = r.object(self).parent;
    if (isView(r, parent)) { viewCall(r, parent, 'transformMatrixToLocal', [MATRIX], 'V', [matrix]); call(r, matrix, MATRIX, 'preTranslate', ['F', 'F'], 'Z', [f2i(viewCall(r, parent, 'getScrollX', [], 'I')), f2i(viewCall(r, parent, 'getScrollY', [], 'I'))]); }
    const d = dimension(r, self); call(r, matrix, MATRIX, 'preTranslate', ['F', 'F'], 'Z', [f2i(-d.left), f2i(-d.top)]);
    if (!viewCall(r, self, 'hasIdentityMatrix', [], 'Z')) { const inverse = viewCall(r, self, 'getInverseMatrix', [], MATRIX); call(r, matrix, MATRIX, 'preConcat', [MATRIX], 'Z', [inverse]); }
  });
  // View.setLeftTopRightBottom: the new frame, onSizeChanged when the size changed, then a redraw
  def(VIEW, 'setLeftTopRightBottom', '(IIII)V', (r, _m, [self, left, top, right, bottom]) => {
    const before = dimension(r, self), view = r.object(self); view.bounds = { left, top, right, bottom };
    const width = right - left, height = bottom - top;
    if (width !== before.width || height !== before.height) viewCall(r, self, 'onSizeChanged', ['I', 'I', 'I', 'I'], 'V', [width, height, before.width, before.height]);
    platform.requestDraw?.(r, self);
  });


  // ================================================================================== plain state (setter + getter pairs with the AOSP default); `redraw` repaints, `layout` requests a layout pass
  const BLEND = 'Landroid/graphics/BlendMode;', TINT = 'Landroid/content/res/ColorStateList;', MODE = 'Landroid/graphics/PorterDuff$Mode;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;';
  const plain = (setter, getter, key, type, initial, options = {}) => {
    const [setName, setSig] = setter.split(/(?=\()/), [getName, getSig] = getter.split(/(?=\()/);
    const decode = value => type === 'Z' ? (value ? 1 : 0) : value;
    def(VIEW, setName, setSig, (r, _m, [self, value]) => {
      let next = type === 'Z' ? flag(value) : (type.startsWith('L') || type.startsWith('[')) && nullish(value) ? null : value;
      if (options.validate) next = options.validate(r, next, self) ?? next;
      const view = r.object(self), previous = view[key] ?? initial; view[key] = next;
      if (options.changed && previous !== next) options.changed(r, self, next, previous);
      if (options.redraw && previous !== next) platform.requestDraw?.(r, self);
      if (options.layout && previous !== next) viewCall(r, self, 'requestLayout');
    });
    def(VIEW, getName, getSig, (r, _m, [self]) => decode(r.object(self)[key] ?? initial));
  };
  const range = (name, low, high) => (r, value) => { if (value < low || value > high) r.throwJava('Ljava/lang/IllegalArgumentException;', `${name} must be in [${low}, ${high}] but was ${value}`); };
  plain('setKeepScreenOn(Z)V', 'getKeepScreenOn()Z', 'keepScreenOn', 'Z', false);
  plain('setSoundEffectsEnabled(Z)V', 'isSoundEffectsEnabled()Z', 'soundEffectsEnabled', 'Z', true);
  plain('setFilterTouchesWhenObscured(Z)V', 'getFilterTouchesWhenObscured()Z', 'filterTouchesWhenObscured', 'Z', false);
  plain('setDuplicateParentStateEnabled(Z)V', 'isDuplicateParentStateEnabled()Z', 'duplicateParentState', 'Z', false);
  plain('setContextClickable(Z)V', 'isContextClickable()Z', 'contextClickable', 'Z', false);
  plain('setAllowClickWhenDisabled(Z)V', 'getAllowClickWhenDisabled()Z', 'allowClickWhenDisabled', 'Z', false);
  plain('setFocusedByDefault(Z)V', 'isFocusedByDefault()Z', 'focusedByDefault', 'Z', false);
  plain('setKeyboardNavigationCluster(Z)V', 'isKeyboardNavigationCluster()Z', 'keyboardNavigationCluster', 'Z', false);
  plain('setRevealOnFocusHint(Z)V', 'getRevealOnFocusHint()Z', 'revealOnFocusHint', 'Z', true);
  plain('setPreferKeepClear(Z)V', 'isPreferKeepClear()Z', 'preferKeepClear', 'Z', false);
  plain('setScreenReaderFocusable(Z)V', 'isScreenReaderFocusable()Z', 'screenReaderFocusable', 'Z', false);
  plain('setAccessibilityHeading(Z)V', 'isAccessibilityHeading()Z', 'accessibilityHeading', 'Z', false);
  plain('setAutoHandwritingEnabled(Z)V', 'isAutoHandwritingEnabled()Z', 'autoHandwriting', 'Z', true);
  def(VIEW, 'isNestedScrollingEnabled', '()Z', (r, _m, [self]) => r.object(self).nestedScrollingEnabled ? 1 : 0);
  plain('setHorizontalFadingEdgeEnabled(Z)V', 'isHorizontalFadingEdgeEnabled()Z', 'horizontalFadingEdge', 'Z', false);
  plain('setVerticalFadingEdgeEnabled(Z)V', 'isVerticalFadingEdgeEnabled()Z', 'verticalFadingEdge', 'Z', false);
  plain('setHorizontalScrollBarEnabled(Z)V', 'isHorizontalScrollBarEnabled()Z', 'horizontalScrollBar', 'Z', false);
  plain('setVerticalScrollBarEnabled(Z)V', 'isVerticalScrollBarEnabled()Z', 'verticalScrollBar', 'Z', false);
  plain('setScrollbarFadingEnabled(Z)V', 'isScrollbarFadingEnabled()Z', 'scrollbarFading', 'Z', true);
  plain('setNextFocusLeftId(I)V', 'getNextFocusLeftId()I', 'nextFocusLeftId', 'I', -1); plain('setNextFocusRightId(I)V', 'getNextFocusRightId()I', 'nextFocusRightId', 'I', -1);
  plain('setNextFocusUpId(I)V', 'getNextFocusUpId()I', 'nextFocusUpId', 'I', -1); plain('setNextFocusDownId(I)V', 'getNextFocusDownId()I', 'nextFocusDownId', 'I', -1);
  plain('setNextFocusForwardId(I)V', 'getNextFocusForwardId()I', 'nextFocusForwardId', 'I', -1); plain('setNextClusterForwardId(I)V', 'getNextClusterForwardId()I', 'nextClusterForwardId', 'I', -1);
  plain('setLabelFor(I)V', 'getLabelFor()I', 'labelFor', 'I', -1);
  plain('setAccessibilityTraversalAfter(I)V', 'getAccessibilityTraversalAfter()I', 'traversalAfter', 'I', -1); plain('setAccessibilityTraversalBefore(I)V', 'getAccessibilityTraversalBefore()I', 'traversalBefore', 'I', -1);
  plain('setAccessibilityLiveRegion(I)V', 'getAccessibilityLiveRegion()I', 'liveRegion', 'I', 0, { validate: range('live region', 0, 2) });
  plain('setScrollCaptureHint(I)V', 'getScrollCaptureHint()I', 'scrollCaptureHint', 'I', 0);
  plain('setOutlineAmbientShadowColor(I)V', 'getOutlineAmbientShadowColor()I', 'ambientShadowColor', 'I', 0xff000000 | 0, { redraw: true });
  plain('setOutlineSpotShadowColor(I)V', 'getOutlineSpotShadowColor()I', 'spotShadowColor', 'I', 0xff000000 | 0, { redraw: true });
  plain('setDrawingCacheBackgroundColor(I)V', 'getDrawingCacheBackgroundColor()I', 'drawingCacheBackgroundColor', 'I', 0);
  plain('setDrawingCacheQuality(I)V', 'getDrawingCacheQuality()I', 'drawingCacheQuality', 'I', 0);
  plain('setFadingEdgeLength(I)V', 'getVerticalFadingEdgeLength()I', 'fadingEdgeLength', 'I', 0);
  plain('setScrollBarDefaultDelayBeforeFade(I)V', 'getScrollBarDefaultDelayBeforeFade()I', 'scrollBarDelay', 'I', 300);
  plain('setScrollBarFadeDuration(I)V', 'getScrollBarFadeDuration()I', 'scrollBarFadeDuration', 'I', 250);
  plain('setScrollBarSize(I)V', 'getScrollBarSize()I', 'scrollBarSize', 'I', 0);
  plain('setScrollBarStyle(I)V', 'getScrollBarStyle()I', 'scrollBarStyle', 'I', 0, { redraw: true, layout: true });
  plain('setVerticalScrollbarPosition(I)V', 'getVerticalScrollbarPosition()I', 'verticalScrollbarPosition', 'I', 0, { layout: true });
  plain(`setAccessibilityPaneTitle(${CHARS})V`, `getAccessibilityPaneTitle()${CHARS}`, 'accessibilityPaneTitle', CHARS, null);
  plain(`setStateDescription(${CHARS})V`, `getStateDescription()${CHARS}`, 'stateDescription', CHARS, null);
  plain(`setTooltipText(${CHARS})V`, `getTooltipText()${CHARS}`, 'tooltipText', CHARS, null);
  plain(`setTransitionName(${STRING})V`, `getTransitionName()${STRING}`, 'transitionName', STRING, null);
  plain(`setVerticalScrollbarThumbDrawable(${DRAWABLE})V`, `getVerticalScrollbarThumbDrawable()${DRAWABLE}`, 'vScrollThumb', DRAWABLE, null);
  plain(`setVerticalScrollbarTrackDrawable(${DRAWABLE})V`, `getVerticalScrollbarTrackDrawable()${DRAWABLE}`, 'vScrollTrack', DRAWABLE, null);
  plain(`setHorizontalScrollbarThumbDrawable(${DRAWABLE})V`, `getHorizontalScrollbarThumbDrawable()${DRAWABLE}`, 'hScrollThumb', DRAWABLE, null);
  plain(`setHorizontalScrollbarTrackDrawable(${DRAWABLE})V`, `getHorizontalScrollbarTrackDrawable()${DRAWABLE}`, 'hScrollTrack', DRAWABLE, null);
  def(VIEW, 'setTextDirection', '(I)V', (r, _m, [self, value]) => { const view = r.object(self); if ((view.textDirection ?? 0) !== value) { view.textDirection = value; viewCall(r, self, 'requestLayout'); platform.requestDraw?.(r, self); } });   // TEXT_DIRECTION_INHERIT is the raw default
  def(VIEW, 'setTextAlignment', '(I)V', (r, _m, [self, value]) => { const view = r.object(self); if ((view.textAlignment ?? 0) !== value) { view.textAlignment = value; viewCall(r, self, 'requestLayout'); platform.requestDraw?.(r, self); } });
  plain(`setPreferKeepClearRects(${LIST})V`, `getPreferKeepClearRects()${LIST}`, 'preferKeepClearRects', LIST, null);
  plain('setTransitionVisibility(I)V', 'getTransitionVisibility()I', 'transitionVisibility', 'I', 0);
  // View.setCameraDistance stores abs(distance) / dpi on the RenderNode and getCameraDistance returns -(stored * dpi): the dpi cancels, the sign is AOSP's. The camera only feeds rotationX / rotationY, which the transform host refuses.
  def(VIEW, 'setCameraDistance', '(F)V', (r, _m, [self, distance]) => { r.object(self).cameraDistance = f2i(Math.abs(i2f(distance))); platform.requestDraw?.(r, self); });
  def(VIEW, 'getCameraDistance', '()F', (r, _m, [self]) => { const stored = i2f(r.object(self).cameraDistance ?? 0); return stored === 0 ? 0 : f2i(-stored); });
  plain(`setPointerIcon(${'Landroid/view/PointerIcon;'})V`, `getPointerIcon()${'Landroid/view/PointerIcon;'}`, 'pointerIcon', 'Landroid/view/PointerIcon;', null);
  plain(`setTouchDelegate(${'Landroid/view/TouchDelegate;'})V`, `getTouchDelegate()${'Landroid/view/TouchDelegate;'}`, 'touchDelegate', 'Landroid/view/TouchDelegate;', null);


  // ================================================================================== activated / selected / pressed / hovered states
  const refreshState = (r, self) => { viewCall(r, self, 'refreshDrawableState'); platform.requestDraw?.(r, self); };
  def(VIEW, 'isActivated', '()Z', (r, _m, [self]) => r.object(self).activated ? 1 : 0);
  def(VIEW, 'setActivated', '(Z)V', (r, _m, [self, activated]) => {   // View.setActivated: on a change redraw, refresh the drawable state and tell the children (ViewGroup.dispatchSetActivated)
    const next = flag(activated), view = r.object(self); if (!!view.activated === next) return;
    view.activated = next; refreshState(r, self); viewCall(r, self, 'dispatchSetActivated', ['Z'], 'V', [next ? 1 : 0]);
  });
  def(VIEW, 'dispatchSetActivated', '(Z)V', () => {});
  def('Landroid/view/ViewGroup;', 'dispatchSetActivated', '(Z)V', (r, _m, [self, activated]) => { for (const child of childrenOf(r, self)) viewCall(r, child, 'setActivated', ['Z'], 'V', [activated]); });
  def(VIEW, 'isSelected', '()Z', (r, _m, [self]) => r.object(self).selected ? 1 : 0);
  def(VIEW, 'setSelected', '(Z)V', (r, _m, [self, selected]) => {   // View.setSelected: clears the pressed state when deselected, refreshes, dispatches to children, announces VIEW_SELECTED
    const next = flag(selected), view = r.object(self); if (!!view.selected === next) return;
    view.selected = next; if (!next && view.pressed) viewCall(r, self, 'setPressed', ['Z'], 'V', [0]);
    refreshState(r, self); viewCall(r, self, 'dispatchSetSelected', ['Z'], 'V', [next ? 1 : 0]);
    if (next) viewCall(r, self, 'sendAccessibilityEvent', ['I'], 'V', [4]);
  });
  def(VIEW, 'dispatchSetSelected', '(Z)V', () => {});
  def('Landroid/view/ViewGroup;', 'dispatchSetSelected', '(Z)V', (r, _m, [self, selected]) => { for (const child of childrenOf(r, self)) viewCall(r, child, 'setSelected', ['Z'], 'V', [selected]); });
  def(VIEW, 'dispatchSetPressed', '(Z)V', () => {});
  def('Landroid/view/ViewGroup;', 'dispatchSetPressed', '(Z)V', (r, _m, [self, pressed]) => {   // ViewGroup.dispatchSetPressed: children that are clickable keep their own state when the group is pressed
    for (const child of childrenOf(r, self)) {
      const on = flag(pressed);
      if (!on || (!flag(viewCall(r, child, 'isClickable', [], 'Z')) && !flag(viewCall(r, child, 'isLongClickable', [], 'Z')))) viewCall(r, child, 'setPressed', ['Z'], 'V', [pressed]);
    }
  });
  def(VIEW, 'isHovered', '()Z', (r, _m, [self]) => r.object(self).hovered ? 1 : 0);
  def(VIEW, 'setHovered', '(Z)V', (r, _m, [self, hovered]) => {   // View.setHovered: onHoverChanged on a change, then the drawable state
    const next = flag(hovered), view = r.object(self); if (!!view.hovered === next) return;
    view.hovered = next; viewCall(r, self, 'onHoverChanged', ['Z'], 'V', [next ? 1 : 0]); refreshState(r, self);
  });
  def(VIEW, 'onHoverChanged', '(Z)V', () => {});
  def(VIEW, 'isDirty', '()Z', (r, _m, [self]) => r.object(self).invalidated ? 1 : 0);
  // View.isOpaque: computeOpaqueFlags (an opaque background; no scroll bars, or overlay-style ones) and a final alpha of 1
  def(VIEW, 'isOpaque', '()Z', (r, _m, [self]) => {
    const background = viewCall(r, self, 'getBackground', [], DRAWABLE), view = r.object(self);
    const opaqueBackground = !nullish(background) && call(r, background, DRAWABLE, 'getOpacity', [], 'I') === -1;
    const style = view.scrollBarStyle ?? 0, scrollbars = view.horizontalScrollBar || view.verticalScrollBar, opaqueScrollbars = !scrollbars || style === 0 || style === 0x2000000;
    return opaqueBackground && opaqueScrollbars && i2f(viewCall(r, self, 'getAlpha', [], 'F')) >= 1 ? 1 : 0;
  });


  // ================================================================================== listeners, long click, context click, context menus
  const KEYEVENT = 'Landroid/view/KeyEvent;', MOTION = 'Landroid/view/MotionEvent;', MENU = 'Landroid/view/ContextMenu;';
  const listenerSetter = (name, type, key, extra) => def(VIEW, name, `(${type})V`, (r, _m, [self, listener]) => { r.object(self)[key] = nullish(listener) ? null : listener; extra?.(r, self); });
  const makeLongClickable = (r, self) => { if (!flag(viewCall(r, self, 'isLongClickable', [], 'Z'))) viewCall(r, self, 'setLongClickable', ['Z'], 'V', [1]); };
  listenerSetter('setOnLongClickListener', 'Landroid/view/View$OnLongClickListener;', 'longClickListener', makeLongClickable);   // View.setOnLongClickListener makes the View long-clickable
  listenerSetter('setOnCreateContextMenuListener', 'Landroid/view/View$OnCreateContextMenuListener;', 'createContextMenuListener', makeLongClickable);
  listenerSetter('setOnHoverListener', 'Landroid/view/View$OnHoverListener;', 'hoverListener');
  listenerSetter('setOnGenericMotionListener', 'Landroid/view/View$OnGenericMotionListener;', 'genericMotionListener');
  listenerSetter('setOnContextClickListener', 'Landroid/view/View$OnContextClickListener;', 'contextClickListener', (r, self) => { if (!flag(viewCall(r, self, 'isContextClickable', [], 'Z'))) viewCall(r, self, 'setContextClickable', ['Z'], 'V', [1]); });
  listenerSetter('setOnCapturedPointerListener', 'Landroid/view/View$OnCapturedPointerListener;', 'capturedPointerListener');
  listenerSetter('setOnSystemUiVisibilityChangeListener', 'Landroid/view/View$OnSystemUiVisibilityChangeListener;', 'systemUiVisibilityListener');
  def(VIEW, 'setOnKeyListener', '(Landroid/view/View$OnKeyListener;)V', (r, _m, [self, listener]) => { r.object(self).keyListener = nullish(listener) ? null : listener; });
  def(VIEW, 'hasOnLongClickListeners', '()Z', (r, _m, [self]) => nullish(r.object(self).longClickListener) ? 0 : 1);
  const onKeyListenerOf = (r, self) => r.object(self).keyListener;
  const CONTENT_INFO = 'Landroid/view/ContentInfo;', RECEIVE_LISTENER = 'Landroid/view/OnReceiveContentListener;';
  def(VIEW, 'setOnReceiveContentListener', `([${STRING}${RECEIVE_LISTENER})V`, (r, _m, [self, types, listener]) => {
    const mimes = nullish(types) ? [] : r.array(types).elements.map(x => r.stringCharacters(x));
    if (!nullish(listener) && mimes.length === 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'When the listener is set, MIME types must also be set');
    if (mimes.some(t => t.startsWith('*'))) r.throwJava('Ljava/lang/IllegalArgumentException;', `A MIME type set here must not start with *: [${mimes.join(', ')}]`);
    const view = r.object(self); view.receiveContentMimeTypes = mimes.length ? types : null; view.receiveContentListener = nullish(listener) ? null : listener;
  });
  def(VIEW, 'getReceiveContentMimeTypes', `()[${STRING}`, (r, _m, [self]) => r.object(self).receiveContentMimeTypes ?? null);
  def(VIEW, 'onReceiveContent', `(${CONTENT_INFO})${CONTENT_INFO}`, (r, _m, [, payload]) => payload);
  def(VIEW, 'performReceiveContent', `(${CONTENT_INFO})${CONTENT_INFO}`, (r, _m, [self, payload]) => {
    const listener = r.object(self).receiveContentListener;
    if (nullish(listener)) return viewCall(r, self, 'onReceiveContent', [CONTENT_INFO], CONTENT_INFO, [payload]);
    const remaining = call(r, listener, r.object(listener).type, 'onReceiveContent', [VIEW, CONTENT_INFO], CONTENT_INFO, [self, payload]);
    return nullish(remaining) ? null : viewCall(r, self, 'onReceiveContent', [CONTENT_INFO], CONTENT_INFO, [remaining]);
  });
  def(VIEW, 'performLongClick', '()Z', (r, _m, [self]) => {
    viewCall(r, self, 'sendAccessibilityEvent', ['I'], 'V', [2]);   // TYPE_VIEW_LONG_CLICKED
    const listener = r.object(self).longClickListener; let handled = false;
    if (!nullish(listener)) handled = flag(call(r, listener, r.object(listener).type, 'onLongClick', [VIEW], 'Z', [self]));
    if (!handled) handled = flag(viewCall(r, self, 'showContextMenu', [], 'Z'));
    if (handled) viewCall(r, self, 'performHapticFeedback', ['I'], 'Z', [0]);
    return handled ? 1 : 0;
  });
  def(VIEW, 'performLongClick', '(FF)Z', (r, _m, [self, x, y]) => { const view = r.object(self); view.longClickX = i2f(x); view.longClickY = i2f(y); try { return viewCall(r, self, 'performLongClick', [], 'Z'); } finally { view.longClickX = NaN; view.longClickY = NaN; } });
  // Context menus need a popup-menu surface the lab does not have: with no OnCreateContextMenuListener and no onCreateContextMenu override the View answers false like AOSP's
  // (the parent chain finds nothing to show); a View that does create menu items fails explicitly instead of silently showing nothing.
  def(VIEW, 'getContextMenuInfo', `()Landroid/view/ContextMenu$ContextMenuInfo;`, () => null);
  def(VIEW, 'onCreateContextMenu', `(${MENU})V`, () => {});
  def(VIEW, 'createContextMenu', `(${MENU})V`, (r, _m, [self, menu]) => {
    viewCall(r, self, 'getContextMenuInfo'); viewCall(r, self, 'onCreateContextMenu', [MENU], 'V', [menu]);
    const listener = r.object(self).createContextMenuListener; if (!nullish(listener)) call(r, listener, r.object(listener).type, 'onCreateContextMenu', [MENU, VIEW, 'Landroid/view/ContextMenu$ContextMenuInfo;'], 'V', [menu, self, null]);
  });
  def(VIEW, 'showContextMenu', '()Z', (r, _m, [self]) => {
    const overrides = !nullish(r.object(self).createContextMenuListener);
    if (overrides) throw new APKError('View.showContextMenu with an OnCreateContextMenuListener needs a popup context-menu surface, which the virtual window does not have', { kind: 'context-menu-unsupported' });
    return 0;
  });
  def(VIEW, 'showContextMenu', '(FF)Z', (r, _m, [self]) => viewCall(r, self, 'showContextMenu', [], 'Z'));
  def(VIEW, 'performContextClick', '()Z', (r, _m, [self]) => {
    viewCall(r, self, 'sendAccessibilityEvent', ['I'], 'V', [8388608]);   // TYPE_VIEW_CONTEXT_CLICKED
    const listener = r.object(self).contextClickListener; let handled = false;
    if (!nullish(listener)) handled = flag(call(r, listener, r.object(listener).type, 'onContextClick', [VIEW], 'Z', [self]));
    if (handled) viewCall(r, self, 'performHapticFeedback', ['I'], 'Z', [6]);
    return handled ? 1 : 0;
  });
  def(VIEW, 'performContextClick', '(FF)Z', (r, _m, [self]) => viewCall(r, self, 'performContextClick', [], 'Z'));
  def(VIEW, 'callOnClick', '()Z', (r, _m, [self]) => {
    const listener = r.object(self).listener; if (nullish(listener)) return 0;
    call(r, listener, r.object(listener).type, 'onClick', [VIEW], 'V', [self]); return 1;
  });
  def(VIEW, 'playSoundEffect', '(I)V', () => {});   // routed to AudioManager.playSoundEffect by the window; the virtual device has no sound-effect output

  // ================================================================================== key / hover / motion dispatch (View.java defaults)
  const confirmKey = code => code === 23 || code === 66 || code === 62 || code === 160;   // KeyEvent.isConfirmKey
  const enabled = (r, self) => r.object(self).enabled !== false;
  const keyCode = (r, event) => call(r, event, KEYEVENT, 'getKeyCode', [], 'I');
  def(VIEW, 'dispatchKeyEvent', `(${KEYEVENT})Z`, (r, _m, [self, event]) => {
    const listener = onKeyListenerOf(r, self);
    if (!nullish(listener) && enabled(r, self) && flag(call(r, listener, r.object(listener).type, 'onKey', [VIEW, 'I', KEYEVENT], 'Z', [self, keyCode(r, event), event]))) return 1;
    return flag(call(r, event, KEYEVENT, 'dispatch', ['Landroid/view/KeyEvent$Callback;', 'Landroid/view/KeyEvent$DispatcherState;', OBJECT], 'Z', [self, null, self])) ? 1 : 0;
  });
  def(VIEW, 'dispatchKeyEventPreIme', `(${KEYEVENT})Z`, (r, _m, [self, event]) => viewCall(r, self, 'onKeyPreIme', ['I', KEYEVENT], 'Z', [keyCode(r, event), event]));
  def(VIEW, 'dispatchKeyShortcutEvent', `(${KEYEVENT})Z`, (r, _m, [self, event]) => viewCall(r, self, 'onKeyShortcut', ['I', KEYEVENT], 'Z', [keyCode(r, event), event]));
  def(VIEW, 'onKeyPreIme', `(I${KEYEVENT})Z`, () => 0); def(VIEW, 'onKeyShortcut', `(I${KEYEVENT})Z`, () => 0);
  def(VIEW, 'onKeyLongPress', `(I${KEYEVENT})Z`, () => 0); def(VIEW, 'onKeyMultiple', `(II${KEYEVENT})Z`, () => 0);
  def(VIEW, 'onKeyDown', `(I${KEYEVENT})Z`, (r, _m, [self, code, event]) => {
    if (!confirmKey(code)) return 0;
    if (!enabled(r, self)) return 1;
    if (call(r, event, KEYEVENT, 'getRepeatCount', [], 'I') === 0) {
      const clickable = flag(viewCall(r, self, 'isClickable', [], 'Z')) || flag(viewCall(r, self, 'isLongClickable', [], 'Z'));
      if (clickable) {
        const view = r.object(self); viewCall(r, self, 'setPressed', ['Z'], 'V', [1]); view.hasPerformedLongPress = false; view.keyPressed = true;
        const token = view.longPressToken = (view.longPressToken ?? 0) + 1;
        if (flag(viewCall(r, self, 'isLongClickable', [], 'Z'))) platform.queueTask(() => {
          if (view.longPressToken !== token || !view.keyPressed || !flag(viewCall(r, self, 'isPressed', [], 'Z'))) return;
          const w = viewCall(r, self, 'getWidth', [], 'I') / 2, h = viewCall(r, self, 'getHeight', [], 'I') / 2;
          if (flag(viewCall(r, self, 'performLongClick', ['F', 'F'], 'Z', [f2i(w), f2i(h)]))) view.hasPerformedLongPress = true;
        }, 500, [self]);
        return 1;
      }
    }
    return 0;
  });
  def(VIEW, 'onKeyUp', `(I${KEYEVENT})Z`, (r, _m, [self, code, event]) => {
    if (!confirmKey(code)) return 0;
    if (!enabled(r, self)) return 1;
    if (flag(viewCall(r, self, 'isClickable', [], 'Z')) && flag(viewCall(r, self, 'isPressed', [], 'Z'))) {
      const view = r.object(self); viewCall(r, self, 'setPressed', ['Z'], 'V', [0]); view.keyPressed = false; view.longPressToken++;
      if (!view.hasPerformedLongPress && !flag(call(r, event, KEYEVENT, 'isCanceled', [], 'Z'))) return viewCall(r, self, 'performClick', [], 'Z');
    }
    return 0;
  });
  def(VIEW, 'dispatchTrackballEvent', `(${MOTION})Z`, (r, _m, [self, event]) => viewCall(r, self, 'onTrackballEvent', [MOTION], 'Z', [event]));
  def(VIEW, 'onTrackballEvent', `(${MOTION})Z`, () => 0);
  def(VIEW, 'onGenericMotionEvent', `(${MOTION})Z`, () => 0);
  def(VIEW, 'onCapturedPointerEvent', `(${MOTION})Z`, () => 0);
  const genericInternal = (r, self, event) => {
    const listener = r.object(self).genericMotionListener;
    if (!nullish(listener) && enabled(r, self) && flag(call(r, listener, r.object(listener).type, 'onGenericMotion', [VIEW, MOTION], 'Z', [self, event]))) return true;
    return flag(viewCall(r, self, 'onGenericMotionEvent', [MOTION], 'Z', [event]));
  };
  def(VIEW, 'dispatchGenericMotionEvent', `(${MOTION})Z`, (r, _m, [self, event]) => {
    const source = call(r, event, MOTION, 'getSource', [], 'I'), action = call(r, event, MOTION, 'getAction', [], 'I');
    if ((source & 0x2) !== 0) {                                                  // SOURCE_CLASS_POINTER
      if (action === 9 || action === 7 || action === 10) { if (flag(viewCall(r, self, 'dispatchHoverEvent', [MOTION], 'Z', [event]))) return 1; }
      else if (flag(viewCall(r, self, 'dispatchGenericPointerEvent', [MOTION], 'Z', [event]))) return 1;
    } else if (flag(viewCall(r, self, 'dispatchGenericFocusedEvent', [MOTION], 'Z', [event]))) return 1;
    return genericInternal(r, self, event) ? 1 : 0;
  });
  def(VIEW, 'dispatchGenericPointerEvent', `(${MOTION})Z`, () => 0); def(VIEW, 'dispatchGenericFocusedEvent', `(${MOTION})Z`, () => 0);
  def(VIEW, 'dispatchHoverEvent', `(${MOTION})Z`, (r, _m, [self, event]) => {
    const listener = r.object(self).hoverListener;
    if (!nullish(listener) && enabled(r, self) && flag(call(r, listener, r.object(listener).type, 'onHover', [VIEW, MOTION], 'Z', [self, event]))) return 1;
    return viewCall(r, self, 'onHoverEvent', [MOTION], 'Z', [event]);
  });
  def(VIEW, 'onHoverEvent', `(${MOTION})Z`, (r, _m, [self, event]) => {
    const action = call(r, event, MOTION, 'getActionMasked', [], 'I');
    const hoverable = enabled(r, self) && (flag(viewCall(r, self, 'isClickable', [], 'Z')) || flag(viewCall(r, self, 'isLongClickable', [], 'Z')) || flag(viewCall(r, self, 'isContextClickable', [], 'Z')));
    if (hoverable || flag(viewCall(r, self, 'isHovered', [], 'Z')) || flag(viewCall(r, self, 'isContextClickable', [], 'Z'))) {
      if (action === 9) viewCall(r, self, 'setHovered', ['Z'], 'V', [1]); else if (action === 10) viewCall(r, self, 'setHovered', ['Z'], 'V', [0]);
      genericInternal(r, self, event); return 1;
    }
    return 0;
  });
  def(VIEW, 'dispatchCapturedPointerEvent', `(${MOTION})Z`, (r, _m, [self, event]) => {
    if (!flag(viewCall(r, self, 'hasPointerCapture', [], 'Z'))) return 0;
    const listener = r.object(self).capturedPointerListener;
    if (!nullish(listener) && flag(call(r, listener, r.object(listener).type, 'onCapturedPointer', [VIEW, MOTION], 'Z', [self, event]))) return 1;
    return viewCall(r, self, 'onCapturedPointerEvent', [MOTION], 'Z', [event]);
  });
  def(VIEW, 'hasPointerCapture', '()Z', () => 0);
  def(VIEW, 'requestPointerCapture', '()V', () => { throw new APKError('View.requestPointerCapture needs a pointer-lock input source (Pointer Lock API) that the virtual window does not wire to MotionEvent.SOURCE_MOUSE_RELATIVE', { kind: 'pointer-capture-unsupported' }); });
  def(VIEW, 'releasePointerCapture', '()V', () => {});
  def(VIEW, 'onPointerCaptureChange', '(Z)V', () => {}); def(VIEW, 'dispatchPointerCaptureChanged', '(Z)V', (r, _m, [self, has]) => viewCall(r, self, 'onPointerCaptureChange', ['Z'], 'V', [has]));
  def(VIEW, 'requestUnbufferedDispatch', '(I)V', () => {}); def(VIEW, 'requestUnbufferedDispatch', `(${MOTION})V`, () => {});   // input batching is a Choreographer detail; events are delivered one by one here
  def(VIEW, 'onResolvePointerIcon', `(${MOTION}I)Landroid/view/PointerIcon;`, (r, _m, [self]) => r.object(self).pointerIcon ?? null);


  // ================================================================================== drawable tints (View.setBackgroundTintList / ForegroundTint*): TintInfo applied to a mutated copy of the drawable
  const PORTER_TO_SKIA = { CLEAR: 0, SRC: 1, DST: 2, SRC_OVER: 3, DST_OVER: 4, SRC_IN: 5, DST_IN: 6, SRC_OUT: 7, DST_OUT: 8, SRC_ATOP: 9, DST_ATOP: 10, XOR: 11, ADD: 12, SCREEN: 14, OVERLAY: 15, DARKEN: 16, LIGHTEN: 17, MULTIPLY: 24 };
  const tintKinds = { background: { field: 'backgroundDrawable', info: 'backgroundTint' }, foreground: { field: 'foregroundDrawable', info: 'foregroundTint' } };
  const applyTint = (r, self, which) => {
    const kind = tintKinds[which], view = r.object(self), info = view[kind.info]; let drawable = view[kind.field];
    if (nullish(drawable) || !info || !(info.hasList || info.hasBlend)) return;
    drawable = call(r, drawable, DRAWABLE, 'mutate', [], DRAWABLE); view[kind.field] = drawable;
    if (info.hasList) call(r, drawable, DRAWABLE, 'setTintList', [TINT], 'V', [info.list]);
    if (info.hasBlend) call(r, drawable, DRAWABLE, 'setTintBlendMode', [BLEND], 'V', [info.blend]);
    if (flag(call(r, drawable, DRAWABLE, 'isStateful', [], 'Z'))) call(r, drawable, DRAWABLE, 'setState', ['[I'], 'Z', [viewCall(r, self, 'getDrawableState', [], '[I')]);
  };
  registry.applyTint = applyTint;
  for (const [which, Name] of [['background', 'Background'], ['foreground', 'Foreground']]) {
    const kind = tintKinds[which], info = (r, self) => r.object(self)[kind.info] ??= { list: null, hasList: false, blend: null, hasBlend: false };
    def(VIEW, `set${Name}TintList`, `(${TINT})V`, (r, _m, [self, list]) => { const t = info(r, self); t.list = nullish(list) ? null : list; t.hasList = true; applyTint(r, self, which); });
    def(VIEW, `get${Name}TintList`, `()${TINT}`, (r, _m, [self]) => r.object(self)[kind.info]?.list ?? null);
    def(VIEW, `set${Name}TintBlendMode`, `(${BLEND})V`, (r, _m, [self, mode]) => { const t = info(r, self); t.blend = nullish(mode) ? null : mode; t.hasBlend = true; applyTint(r, self, which); });
    def(VIEW, `get${Name}TintBlendMode`, `()${BLEND}`, (r, _m, [self]) => r.object(self)[kind.info]?.blend ?? null);
    def(VIEW, `set${Name}TintMode`, `(${MODE})V`, (r, _m, [self, mode]) => {
      const blend = nullish(mode) ? null : callStatic(r, BLEND, 'fromValue', ['I'], BLEND, [PORTER_TO_SKIA[r.object(mode).enumName]]);
      viewCall(r, self, `set${Name}TintBlendMode`, [BLEND], 'V', [blend]);
    });
    def(VIEW, `get${Name}TintMode`, `()${MODE}`, (r, _m, [self]) => { const blend = r.object(self)[kind.info]?.blend; return nullish(blend) ? null : callStatic(r, BLEND, 'blendModeToPorterDuffMode', [BLEND], MODE, [blend]); });
  }

  // ================================================================================== invalidation, z-order, drawing cache
  def(VIEW, 'invalidate', `(${RECT})V`, (r, _m, [self]) => platform.requestDraw?.(r, self));
  def(VIEW, 'invalidate', '(IIII)V', (r, _m, [self]) => platform.requestDraw?.(r, self));
  def(VIEW, 'postInvalidate', '(IIII)V', (r, _m, [self]) => platform.requestDraw?.(r, self));
  def(VIEW, 'postInvalidateDelayed', '(J)V', (r, _m, [self, delay]) => { platform.queueTask(() => platform.requestDraw?.(r, self), Number(delay), [self]); });
  def(VIEW, 'postInvalidateDelayed', '(JIIII)V', (r, _m, [self, delay]) => { platform.queueTask(() => platform.requestDraw?.(r, self), Number(delay), [self]); });
  def(VIEW, 'postInvalidateOnAnimation', '(IIII)V', (r, _m, [self]) => { platform.queueTask(() => platform.requestDraw?.(r, self), 16, [self]); });
  def(VIEW, 'bringToFront', '()V', (r, _m, [self]) => {   // ViewGroup.bringChildToFront: the child moves to the end of the children array (drawn last, hit first)
    const parent = r.object(self).parent; if (!isGroup(r, parent)) return;
    const group = r.object(parent), index = group.children.findIndex(child => ref(child) === ref(self)); if (index < 0) return;
    group.children.splice(index, 1); group.children.push(self); viewCall(r, parent, 'requestLayout'); platform.requestDraw?.(r, parent);
  });
  // The drawing cache (deprecated since API 28): a bitmap of the view drawn into it, built on demand and kept until destroyDrawingCache / the next build
  def(VIEW, 'setDrawingCacheEnabled', '(Z)V', (r, _m, [self, enabled]) => { const view = r.object(self); view.drawingCacheEnabled = flag(enabled); if (!view.drawingCacheEnabled) viewCall(r, self, 'destroyDrawingCache'); });
  def(VIEW, 'isDrawingCacheEnabled', '()Z', (r, _m, [self]) => r.object(self).drawingCacheEnabled ? 1 : 0);
  def(VIEW, 'setWillNotCacheDrawing', '(Z)V', (r, _m, [self, willNot]) => { r.object(self).willNotCacheDrawing = flag(willNot); });
  def(VIEW, 'willNotCacheDrawing', '()Z', (r, _m, [self]) => r.object(self).willNotCacheDrawing ? 1 : 0);
  def(VIEW, 'destroyDrawingCache', '()V', (r, _m, [self]) => { r.object(self).drawingCacheBitmap = null; });
  def(VIEW, 'buildDrawingCache', '()V', (r, _m, [self]) => viewCall(r, self, 'buildDrawingCache', ['Z'], 'V', [0]));
  def(VIEW, 'buildDrawingCache', '(Z)V', (r, _m, [self, autoScale]) => {
    const view = r.object(self); if (view.drawingCacheBitmap || view.willNotCacheDrawing) return;
    if (!r.skiaHost) throw new APKError('View.buildDrawingCache needs the verified Skia Bitmap backend', { kind: 'drawing-cache-unsupported' });
    const width = viewCall(r, self, 'getWidth', [], 'I'), height = viewCall(r, self, 'getHeight', [], 'I'); if (width <= 0 || height <= 0) return;
    const quality = view.drawingCacheQuality ?? 0, config = quality === 0x00080000 ? 'RGB_565' : 'ARGB_8888', CFG = 'Landroid/graphics/Bitmap$Config;', BMP = 'Landroid/graphics/Bitmap;';
    const configValue = r.readStatic({ owner: CFG, name: config, type: CFG, key: `${CFG}->${config}:${CFG}` });
    const bitmap = callStatic(r, BMP, 'createBitmap', ['I', 'I', CFG], BMP, [width, height, configValue]);
    const canvas = construct(r, 'Landroid/graphics/Canvas;', [BMP], [bitmap]);
    const background = view.drawingCacheBackgroundColor ?? 0; if (background !== 0) call(r, bitmap, BMP, 'eraseColor', ['I'], 'V', [background]);
    viewCall(r, self, 'draw', ['Landroid/graphics/Canvas;'], 'V', [canvas]); view.drawingCacheBitmap = bitmap; void autoScale;
  });
  def(VIEW, 'getDrawingCache', '()Landroid/graphics/Bitmap;', (r, _m, [self]) => viewCall(r, self, 'getDrawingCache', ['Z'], 'Landroid/graphics/Bitmap;', [0]));
  def(VIEW, 'getDrawingCache', '(Z)Landroid/graphics/Bitmap;', (r, _m, [self, autoScale]) => {
    const view = r.object(self); if (view.willNotCacheDrawing || !view.drawingCacheEnabled) return null;
    viewCall(r, self, 'buildDrawingCache', ['Z'], 'V', [autoScale]); return view.drawingCacheBitmap ?? null;
  });

  // ================================================================================== padding, layout direction, text direction / alignment resolution
  def(VIEW, 'setPaddingRelative', '(IIII)V', (r, _m, [self, start, top, end, bottom]) => {
    const rtl = viewCall(r, self, 'getLayoutDirection', [], 'I') === 1, view = r.object(self);
    view.paddingRelative = true; view.userPaddingStart = start; view.userPaddingEnd = end;
    viewCall(r, self, 'setPadding', ['I', 'I', 'I', 'I'], 'V', [rtl ? end : start, top, rtl ? start : end, bottom]);
    view.paddingRelative = true;
  });
  def(VIEW, 'isPaddingRelative', '()Z', (r, _m, [self]) => r.object(self).paddingRelative ? 1 : 0);
  def(VIEW, 'isPaddingOffsetRequired', '()Z', () => 0);
  for (const name of ['getLeftPaddingOffset', 'getTopPaddingOffset', 'getRightPaddingOffset', 'getBottomPaddingOffset']) def(VIEW, name, '()I', () => 0);
  def(VIEW, 'getSolidColor', '()I', () => 0);
  def(VIEW, 'onRtlPropertiesChanged', '(I)V', () => {});
  const rawDirection = (r, self) => r.object(self).layoutDirectionRaw ?? 2;   // LAYOUT_DIRECTION_INHERIT
  def(VIEW, 'canResolveLayoutDirection', '()Z', (r, _m, [self]) => {
    if (rawDirection(r, self) !== 2) return 1;
    const parent = r.object(self).parent; return isView(r, parent) ? viewCall(r, parent, 'canResolveLayoutDirection', [], 'Z') : 0;
  });
  def(VIEW, 'isLayoutDirectionResolved', '()Z', (r, _m, [self]) => (r.object(self).attached || rawDirection(r, self) !== 2) ? 1 : 0);
  const resolvable = (name, getter) => def(VIEW, name, '()Z', (r, _m, [self]) => {
    if (viewCall(r, self, getter, [], 'I') !== 0) return 1;   // an explicit value resolves by itself
    const parent = r.object(self).parent; return isView(r, parent) ? viewCall(r, parent, name, [], 'Z') : 0;
  });
  def(VIEW, 'isTextDirectionResolved', '()Z', (r, _m, [self]) => viewCall(r, self, 'canResolveTextDirection', [], 'Z'));
  def(VIEW, 'isTextAlignmentResolved', '()Z', (r, _m, [self]) => viewCall(r, self, 'canResolveTextAlignment', [], 'Z'));
  resolvable('canResolveTextDirection', 'getRawTextDirectionInternal'); resolvable('canResolveTextAlignment', 'getRawTextAlignmentInternal');
  def(VIEW, 'getRawTextDirectionInternal', '()I', (r, _m, [self]) => r.object(self).textDirection ?? 0);
  def(VIEW, 'getRawTextAlignmentInternal', '()I', (r, _m, [self]) => r.object(self).textAlignment ?? 1);
  // getTextDirection / getTextAlignment return the RESOLVED value (View.getTextDirection resolves up the parent chain; the default of the root is TEXT_DIRECTION_FIRST_STRONG = 1 and TEXT_ALIGNMENT_GRAVITY = 1)
  const resolved = (name, rawKey, inheritValue, fallback) => def(VIEW, name, '()I', (r, _m, [self]) => {
    for (let current = self, depth = 0; current && depth < 4096; depth++) {
      const value = r.object(current)[rawKey] ?? inheritValue; if (value !== inheritValue) return value;
      const parent = r.object(current).parent; if (!isView(r, parent)) break; current = parent;
    }
    return fallback;
  });
  resolved('getTextDirection', 'textDirection', 0, 1); resolved('getTextAlignment', 'textAlignment', 0, 1);


  // ================================================================================== accessibility (View.java: delegate first, then the *Internal body)
  const A11Y_EVENT = 'Landroid/view/accessibility/AccessibilityEvent;', A11Y_INFO = 'Landroid/view/accessibility/AccessibilityNodeInfo;', A11Y_MANAGER = 'Landroid/view/accessibility/AccessibilityManager;', DELEGATE = 'Landroid/view/View$AccessibilityDelegate;', BUNDLE = 'Landroid/os/Bundle;';
  const delegateOf = (r, self) => r.object(self).fields.get(`${VIEW}->mAccessibilityDelegate:${DELEGATE}`) ?? null;
  const a11yEnabled = (r, self) => { const context = viewCall(r, self, 'getContext', [], CONTEXT); const manager = callStatic(r, A11Y_MANAGER, 'getInstance', [CONTEXT], A11Y_MANAGER, [context]); return flag(call(r, manager, A11Y_MANAGER, 'isEnabled', [], 'Z')); };
  const TYPE_VIEW_FOCUSED = 8;
  def(VIEW, 'sendAccessibilityEvent', '(I)V', (r, _m, [self, type]) => {
    const delegate = delegateOf(r, self);
    if (!nullish(delegate)) call(r, delegate, DELEGATE, 'sendAccessibilityEvent', [VIEW, 'I'], 'V', [self, type]); else viewCall(r, self, 'sendAccessibilityEventInternal', ['I'], 'V', [type]);
  });
  def(VIEW, 'sendAccessibilityEventInternal', '(I)V', (r, _m, [self, type]) => {
    if (!a11yEnabled(r, self)) return;
    viewCall(r, self, 'sendAccessibilityEventUnchecked', [A11Y_EVENT], 'V', [callStatic(r, A11Y_EVENT, 'obtain', ['I'], A11Y_EVENT, [type])]);
  });
  def(VIEW, 'sendAccessibilityEventUnchecked', `(${A11Y_EVENT})V`, (r, _m, [self, event]) => {
    const delegate = delegateOf(r, self);
    if (!nullish(delegate)) call(r, delegate, DELEGATE, 'sendAccessibilityEventUnchecked', [VIEW, A11Y_EVENT], 'V', [self, event]); else viewCall(r, self, 'sendAccessibilityEventUncheckedInternal', [A11Y_EVENT], 'V', [event]);
  });
  // The populating event types (POPULATING_ACCESSIBILITY_EVENT_TYPES) fill the text; the finished event is handed to the (empty) set of accessibility services at the ViewRootImpl boundary
  const POPULATING = 0x1 | 0x4 | 0x8 | 0x10 | 0x20 | 0x200 | 0x400 | 0x800 | 0x20000 | 0x400000;
  def(VIEW, 'sendAccessibilityEventUncheckedInternal', `(${A11Y_EVENT})V`, (r, _m, [self, event]) => {
    const type = call(r, event, A11Y_EVENT, 'getEventType', [], 'I'), windowDisappeared = type === 32 && (call(r, event, A11Y_EVENT, 'getContentChangeTypes', [], 'I') & 0x20) !== 0;
    if (!flag(viewCall(r, self, 'isShown', [], 'Z')) && !windowDisappeared) return;
    viewCall(r, self, 'onInitializeAccessibilityEvent', [A11Y_EVENT], 'V', [event]);
    if ((type & POPULATING) !== 0) viewCall(r, self, 'dispatchPopulateAccessibilityEvent', [A11Y_EVENT], 'Z', [event]);
  });
  def(VIEW, 'announceForAccessibility', `(${CHARS})V`, (r, _m, [self, text]) => {
    if (!r.object(self).attached || !a11yEnabled(r, self)) return;
    const event = callStatic(r, A11Y_EVENT, 'obtain', ['I'], A11Y_EVENT, [16384]);   // TYPE_ANNOUNCEMENT
    viewCall(r, self, 'onInitializeAccessibilityEvent', [A11Y_EVENT], 'V', [event]);
    call(r, call(r, event, 'Landroid/view/accessibility/AccessibilityRecord;', 'getText', [], LIST), LIST, 'add', [OBJECT], 'Z', [text]);
    call(r, event, A11Y_EVENT, 'setContentDescription', [CHARS], 'V', [null]);
  });
  def(VIEW, 'onInitializeAccessibilityEvent', `(${A11Y_EVENT})V`, (r, _m, [self, event]) => {
    const delegate = delegateOf(r, self);
    if (!nullish(delegate)) call(r, delegate, DELEGATE, 'onInitializeAccessibilityEvent', [VIEW, A11Y_EVENT], 'V', [self, event]); else viewCall(r, self, 'onInitializeAccessibilityEventInternal', [A11Y_EVENT], 'V', [event]);
  });
  def(VIEW, 'onInitializeAccessibilityEventInternal', `(${A11Y_EVENT})V`, (r, _m, [self, event]) => {
    const R = 'Landroid/view/accessibility/AccessibilityRecord;', context = viewCall(r, self, 'getContext', [], CONTEXT);
    call(r, event, R, 'setSource', [VIEW], 'V', [self]);
    call(r, event, R, 'setClassName', [CHARS], 'V', [viewCall(r, self, 'getAccessibilityClassName', [], CHARS)]);
    call(r, event, A11Y_EVENT, 'setPackageName', [CHARS], 'V', [call(r, context, CONTEXT, 'getPackageName', [], STRING)]);
    call(r, event, R, 'setEnabled', ['Z'], 'V', [viewCall(r, self, 'isEnabled', [], 'Z')]);
    call(r, event, A11Y_EVENT, 'setContentDescription', [CHARS], 'V', [viewCall(r, self, 'getContentDescription', [], CHARS)]);
    call(r, event, R, 'setScrollX', ['I'], 'V', [viewCall(r, self, 'getScrollX', [], 'I')]); call(r, event, R, 'setScrollY', ['I'], 'V', [viewCall(r, self, 'getScrollY', [], 'I')]);
    if (call(r, event, A11Y_EVENT, 'getEventType', [], 'I') === TYPE_VIEW_FOCUSED) {
      const list = construct(r, ARRAYLIST, [], []), root = viewCall(r, self, 'getRootView', [], VIEW);
      viewCall(r, root, 'addFocusables', [ARRAYLIST, 'I', 'I'], 'V', [list, 2, 0]);   // FOCUS_FORWARD, FOCUSABLES_ALL
      call(r, event, R, 'setItemCount', ['I'], 'V', [call(r, list, LIST, 'size', [], 'I')]); call(r, event, R, 'setCurrentItemIndex', ['I'], 'V', [call(r, list, LIST, 'indexOf', [OBJECT], 'I', [self])]);
    }
  });
  def(VIEW, 'dispatchPopulateAccessibilityEvent', `(${A11Y_EVENT})Z`, (r, _m, [self, event]) => {
    const delegate = delegateOf(r, self);
    if (!nullish(delegate)) return call(r, delegate, DELEGATE, 'dispatchPopulateAccessibilityEvent', [VIEW, A11Y_EVENT], 'Z', [self, event]);
    viewCall(r, self, 'onPopulateAccessibilityEvent', [A11Y_EVENT], 'V', [event]); return 0;
  });
  def(VIEW, 'onPopulateAccessibilityEvent', `(${A11Y_EVENT})V`, (r, _m, [self, event]) => {
    const delegate = delegateOf(r, self);
    if (!nullish(delegate)) call(r, delegate, DELEGATE, 'onPopulateAccessibilityEvent', [VIEW, A11Y_EVENT], 'V', [self, event]);
  });
  def(VIEW, 'getAccessibilityClassName', `()${CHARS}`, (r, _m, [self]) => {   // each framework widget overrides this with its own class name; an app subclass inherits the nearest framework class's
    for (let type = r.object(self).type, depth = 0; type && depth < 64; type = r.parent(type), depth++) if (type.startsWith('Landroid/')) return type.slice(1, -1).replaceAll('/', '.');
    return 'android.view.View';
  });
  const IMPORTANT = { YES: 1, NO: 2, NO_HIDE_DESCENDANTS: 4 };
  def(VIEW, 'isImportantForAccessibility', '()Z', (r, _m, [self]) => {
    const mode = viewCall(r, self, 'getImportantForAccessibility', [], 'I');
    if (mode === IMPORTANT.NO || mode === IMPORTANT.NO_HIDE_DESCENDANTS) return 0;
    for (let parent = r.object(self).parent, depth = 0; isView(r, parent) && depth < 4096; parent = r.object(parent).parent, depth++) if (viewCall(r, parent, 'getImportantForAccessibility', [], 'I') === IMPORTANT.NO_HIDE_DESCENDANTS) return 0;
    const view = r.object(self), listeners = !nullish(view.touchDelegate) || !nullish(view.keyListener) || !nullish(view.touchListener) || !nullish(view.genericMotionListener) || !nullish(view.hoverListener) || !nullish(view.dragListener);
    return mode === IMPORTANT.YES || flag(viewCall(r, self, 'isClickable', [], 'Z')) || flag(viewCall(r, self, 'isLongClickable', [], 'Z')) || flag(viewCall(r, self, 'isFocusable', [], 'Z')) || listeners
      || !nullish(viewCall(r, self, 'getAccessibilityNodeProvider', [], 'Landroid/view/accessibility/AccessibilityNodeProvider;')) || viewCall(r, self, 'getAccessibilityLiveRegion', [], 'I') !== 0
      || !nullish(view.accessibilityPaneTitle) || !!view.accessibilityHeading ? 1 : 0;
  });
  def(VIEW, 'getParentForAccessibility', '()Landroid/view/ViewParent;', (r, _m, [self]) => {
    for (let parent = r.object(self).parent, depth = 0; isView(r, parent) && depth < 4096; parent = r.object(parent).parent, depth++) {
      if (r.object(parent).attached && (flag(viewCall(r, parent, 'isImportantForAccessibility', [], 'Z')))) return parent;
    }
    return null;
  });
  def(VIEW, 'isAccessibilityFocused', '()Z', () => 0);   // accessibility focus belongs to an accessibility service, and the virtual device runs none
  def(VIEW, 'performAccessibilityAction', `(I${BUNDLE})Z`, (r, _m, [self, action, args]) => {
    const delegate = delegateOf(r, self);
    if (!nullish(delegate)) return call(r, delegate, DELEGATE, 'performAccessibilityAction', [VIEW, 'I', BUNDLE], 'Z', [self, action, args]);
    return viewCall(r, self, 'performAccessibilityActionInternal', ['I', BUNDLE], 'Z', [action, args]);
  });
  def(VIEW, 'performAccessibilityActionInternal', `(I${BUNDLE})Z`, (r, _m, [self, action]) => {
    switch (action) {
      case 16: if (flag(viewCall(r, self, 'isClickable', [], 'Z'))) { viewCall(r, self, 'performClick', [], 'Z'); return 1; } return 0;                    // ACTION_CLICK
      case 32: if (flag(viewCall(r, self, 'isLongClickable', [], 'Z'))) { viewCall(r, self, 'performLongClick', [], 'Z'); return 1; } return 0;             // ACTION_LONG_CLICK
      case 1: return flag(viewCall(r, self, 'hasFocus', [], 'Z')) ? 0 : viewCall(r, self, 'requestFocus', [], 'Z');   // ACTION_FOCUS
      case 2: if (flag(viewCall(r, self, 'hasFocus', [], 'Z'))) { viewCall(r, self, 'clearFocus'); return flag(viewCall(r, self, 'isFocused', [], 'Z')) ? 0 : 1; } return 0;   // ACTION_CLEAR_FOCUS
      case 4: if (!flag(viewCall(r, self, 'isSelected', [], 'Z'))) { viewCall(r, self, 'setSelected', ['Z'], 'V', [1]); return flag(viewCall(r, self, 'isSelected', [], 'Z')) ? 1 : 0; } return 0;   // ACTION_SELECT
      case 8: if (flag(viewCall(r, self, 'isSelected', [], 'Z'))) { viewCall(r, self, 'setSelected', ['Z'], 'V', [0]); return flag(viewCall(r, self, 'isSelected', [], 'Z')) ? 0 : 1; } return 0;   // ACTION_CLEAR_SELECTION
      default: return 0;                                                                                                                                       // accessibility focus, text and scroll actions belong to accessibility services / widget overrides
    }
  });
  def(VIEW, 'createAccessibilityNodeInfo', `()${A11Y_INFO}`, (r, _m, [self]) => {
    const delegate = delegateOf(r, self);
    return !nullish(delegate) ? call(r, delegate, DELEGATE, 'createAccessibilityNodeInfo', [VIEW], A11Y_INFO, [self]) : viewCall(r, self, 'createAccessibilityNodeInfoInternal', [], A11Y_INFO);
  });
  def(VIEW, 'createAccessibilityNodeInfoInternal', `()${A11Y_INFO}`, (r, _m, [self]) => {
    const provider = viewCall(r, self, 'getAccessibilityNodeProvider', [], 'Landroid/view/accessibility/AccessibilityNodeProvider;');
    if (!nullish(provider)) return call(r, provider, 'Landroid/view/accessibility/AccessibilityNodeProvider;', 'createAccessibilityNodeInfo', ['I'], A11Y_INFO, [-1]);
    const info = callStatic(r, A11Y_INFO, 'obtain', [VIEW], A11Y_INFO, [self]); viewCall(r, self, 'onInitializeAccessibilityNodeInfo', [A11Y_INFO], 'V', [info]); return info;
  });
  def(VIEW, 'onInitializeAccessibilityNodeInfo', `(${A11Y_INFO})V`, (r, _m, [self, info]) => {
    const delegate = delegateOf(r, self);
    if (!nullish(delegate)) call(r, delegate, DELEGATE, 'onInitializeAccessibilityNodeInfo', [VIEW, A11Y_INFO], 'V', [self, info]); else viewCall(r, self, 'onInitializeAccessibilityNodeInfoInternal', [A11Y_INFO], 'V', [info]);
  });
  def(VIEW, 'onInitializeAccessibilityNodeInfoInternal', `(${A11Y_INFO})V`, (r, _m, [self, info]) => {
    if (!r.object(self).attached) return;
    const I = A11Y_INFO, context = viewCall(r, self, 'getContext', [], CONTEXT), set = (name, sig, value) => call(r, info, I, name, [sig], 'V', [value]);
    const bounds = construct(r, RECT, [], []); viewCall(r, self, 'getDrawingRect', [RECT], 'V', [bounds]); call(r, info, I, 'setBoundsInParent', [RECT], 'V', [bounds]);
    const location = r.newArray('[I', 2); viewCall(r, self, 'getLocationOnScreen', ['[I'], 'V', [location]); const d = dimension(r, self), at = r.array(location).elements;
    rectSet(r, bounds, at[0], at[1], at[0] + d.width, at[1] + d.height); call(r, info, I, 'setBoundsInScreen', [RECT], 'V', [bounds]);
    const parent = viewCall(r, self, 'getParentForAccessibility', [], 'Landroid/view/ViewParent;'); if (isView(r, parent)) call(r, info, I, 'setParent', [VIEW], 'V', [parent]);
    set('setVisibleToUser', 'Z', viewCall(r, self, 'getGlobalVisibleRect', [RECT], 'Z', [construct(r, RECT, [], [])]) && viewCall(r, self, 'isShown', [], 'Z') ? 1 : 0);
    set('setImportantForAccessibility', 'Z', viewCall(r, self, 'isImportantForAccessibility', [], 'Z'));
    set('setPackageName', CHARS, call(r, context, CONTEXT, 'getPackageName', [], STRING)); set('setClassName', CHARS, viewCall(r, self, 'getAccessibilityClassName', [], CHARS));
    set('setContentDescription', CHARS, viewCall(r, self, 'getContentDescription', [], CHARS));
    for (const [setter, getter] of [['setEnabled', 'isEnabled'], ['setClickable', 'isClickable'], ['setFocusable', 'isFocusable'], ['setScreenReaderFocusable', 'isScreenReaderFocusable'], ['setFocused', 'isFocused'], ['setAccessibilityFocused', 'isAccessibilityFocused'], ['setSelected', 'isSelected'], ['setLongClickable', 'isLongClickable'], ['setContextClickable', 'isContextClickable']]) set(setter, 'Z', viewCall(r, self, getter, [], 'Z'));
    set('setLiveRegion', 'I', viewCall(r, self, 'getAccessibilityLiveRegion', [], 'I'));
    const tooltip = r.object(self).tooltipText; if (!nullish(tooltip)) set('setTooltipText', CHARS, tooltip);
    const add = action => set('addAction', 'I', action);
    add(0x4); add(0x8);
    if (flag(viewCall(r, self, 'isFocusable', [], 'Z'))) add(flag(viewCall(r, self, 'isFocused', [], 'Z')) ? 0x2 : 0x1);
    add(0x40);
    if (flag(viewCall(r, self, 'isClickable', [], 'Z')) && flag(viewCall(r, self, 'isEnabled', [], 'Z'))) add(0x10);
    if (flag(viewCall(r, self, 'isLongClickable', [], 'Z')) && flag(viewCall(r, self, 'isEnabled', [], 'Z'))) add(0x20);
    set('setPaneTitle', CHARS, r.object(self).accessibilityPaneTitle ?? null); set('setHeading', 'Z', r.object(self).accessibilityHeading ? 1 : 0);
  });
  def(VIEW, 'addExtraDataToAccessibilityNodeInfo', `(${A11Y_INFO}${STRING}${BUNDLE})V`, () => {});
  def(VIEW, 'addChildrenForAccessibility', `(${ARRAYLIST})V`, () => {});
  def('Landroid/view/ViewGroup;', 'addChildrenForAccessibility', `(${ARRAYLIST})V`, (r, _m, [self, out]) => {
    for (const child of childrenOf(r, self)) {
      if (!(r.object(child).visibility === undefined || r.object(child).visibility === 0)) continue;
      if (flag(viewCall(r, child, 'isImportantForAccessibility', [], 'Z'))) call(r, out, LIST, 'add', [OBJECT], 'Z', [child]); else viewCall(r, child, 'addChildrenForAccessibility', [ARRAYLIST], 'V', [out]);
    }
  });
  def(VIEW, 'dispatchNestedPrePerformAccessibilityAction', `(I${BUNDLE})Z`, (r, _m, [self, action, args]) => {
    for (let parent = r.object(self).parent, depth = 0; isView(r, parent) && depth < 4096; parent = r.object(parent).parent, depth++) if (flag(call(r, parent, 'Landroid/view/ViewParent;', 'onNestedPrePerformAccessibilityAction', [VIEW, 'I', BUNDLE], 'Z', [self, action, args]))) return 1;
    return 0;
  });


  // ================================================================================== focus search, focusables, touchables, keyboard navigation clusters
  const FOCUS_FINDER = 'Landroid/view/FocusFinder;', GROUP_T = 'Landroid/view/ViewGroup;', COLLECTION = 'Ljava/util/Collection;';
  const visibleFlag = (r, view) => (r.object(view).visibility ?? 0) === 0;
  const rootNamespace = (r, self) => !isView(r, r.object(self).parent);
  const finder = r => callStatic(r, FOCUS_FINDER, 'getInstance', [], FOCUS_FINDER);
  def(VIEW, 'getFocusable', '()I', (r, _m, [self]) => r.object(self).focusableMode === 16 ? 16 : (flag(viewCall(r, self, 'isFocusable', [], 'Z')) ? 1 : 0));
  def(VIEW, 'focusSearch', `(I)${VIEW}`, (r, _m, [self, direction]) => {
    const parent = r.object(self).parent; return isGroup(r, parent) ? call(r, parent, GROUP_T, 'focusSearch', [VIEW, 'I'], VIEW, [self, direction]) : null;
  });
  def(GROUP_T, 'focusSearch', `(${VIEW}I)${VIEW}`, (r, _m, [self, focused, direction]) => {
    if (rootNamespace(r, self)) return call(r, finder(r), FOCUS_FINDER, 'findNextFocus', [GROUP_T, VIEW, 'I'], VIEW, [self, focused, direction]);
    const parent = r.object(self).parent; return isGroup(r, parent) ? call(r, parent, GROUP_T, 'focusSearch', [VIEW, 'I'], VIEW, [focused, direction]) : null;
  });
  def(VIEW, 'canTakeFocusInternal', '()Z', (r, _m, [self]) => {   // View.canTakeFocus: visible, focusable, enabled, and not zero-sized once laid out
    const d = dimension(r, self);
    return visibleFlag(r, self) && flag(viewCall(r, self, 'isFocusable', [], 'Z')) && enabled(r, self) && (!flag(viewCall(r, self, 'isLaidOut', [], 'Z')) || (d.height > 0 && d.width > 0)) ? 1 : 0;
  });
  def(VIEW, 'addFocusables', `(${ARRAYLIST}I)V`, (r, _m, [self, views, direction]) => viewCall(r, self, 'addFocusables', [ARRAYLIST, 'I', 'I'], 'V', [views, direction, flag(viewCall(r, self, 'isInTouchMode', [], 'Z')) ? 1 : 0]));
  def(VIEW, 'addFocusables', `(${ARRAYLIST}II)V`, (r, _m, [self, views, direction, mode]) => {
    if (nullish(views) || !flag(viewCall(r, self, 'canTakeFocusInternal', [], 'Z'))) return;
    if ((mode & 1) === 1 && !flag(viewCall(r, self, 'isFocusableInTouchMode', [], 'Z'))) return;   // FOCUSABLES_TOUCH_MODE
    call(r, views, ARRAYLIST, 'add', [OBJECT], 'Z', [self]);
  });
  def(GROUP_T, 'addFocusables', `(${ARRAYLIST}II)V`, (r, _m, [self, views, direction, modeIn]) => {
    let mode = modeIn; const before = call(r, views, ARRAYLIST, 'size', [], 'I'), focusability = call(r, self, GROUP_T, 'getDescendantFocusability', [], 'I');
    const blockForTouchscreen = !!r.object(self).touchscreenBlocksFocus && r.platform?.systemFeatures?.has?.('android.hardware.touchscreen') === true;
    const focusSelf = flag(viewCall(r, self, 'isFocusableInTouchMode', [], 'Z')) || !blockForTouchscreen;
    const superAdd = () => r.dispatch({ owner: VIEW, name: 'addFocusables', parameters: [ARRAYLIST, 'I', 'I'], result: 'V', signature: `(${ARRAYLIST}II)V` }, r.argumentWords([ARRAYLIST, 'I', 'I'], [views, direction, mode], { receiver: self }), 'direct');
    if (focusability === 0x60000) { if (focusSelf) superAdd(); return; }   // FOCUS_BLOCK_DESCENDANTS
    if (blockForTouchscreen) mode |= 1;
    if (focusability === 0x20000 && focusSelf) superAdd();                  // FOCUS_BEFORE_DESCENDANTS
    const visible = childrenOf(r, self).filter(child => visibleFlag(r, child)), rtl = viewCall(r, self, 'getLayoutDirection', [], 'I') === 1;
    const frameOf = child => dimension(r, child);
    visible.sort((a, b) => {   // FocusFinder.SequentialFocusComparator: top, then left (mirrored for RTL), then bottom, then right
      const x = frameOf(a), y = frameOf(b);
      if (x.top !== y.top) return x.top < y.top ? -1 : 1;
      if (x.left !== y.left) return x.left < y.left ? (rtl ? 1 : -1) : (rtl ? -1 : 1);
      if (x.bottom !== y.bottom) return x.bottom < y.bottom ? -1 : 1;
      if (x.right !== y.right) return x.right < y.right ? (rtl ? 1 : -1) : (rtl ? -1 : 1);
      return 0;
    });
    for (const child of visible) viewCall(r, child, 'addFocusables', [ARRAYLIST, 'I', 'I'], 'V', [views, direction, mode]);
    if (focusability === 0x40000 && focusSelf && before === call(r, views, ARRAYLIST, 'size', [], 'I')) superAdd();   // FOCUS_AFTER_DESCENDANTS only when no descendant took focus
  });
  def(VIEW, 'getFocusables', `(I)${ARRAYLIST}`, (r, _m, [self, direction]) => { const list = construct(r, ARRAYLIST, ['I'], [24]); viewCall(r, self, 'addFocusables', [ARRAYLIST, 'I'], 'V', [list, direction]); return list; });
  def(VIEW, 'addTouchables', `(${ARRAYLIST})V`, (r, _m, [self, views]) => {
    if ((flag(viewCall(r, self, 'isClickable', [], 'Z')) || flag(viewCall(r, self, 'isLongClickable', [], 'Z')) || flag(viewCall(r, self, 'isContextClickable', [], 'Z'))) && enabled(r, self)) call(r, views, ARRAYLIST, 'add', [OBJECT], 'Z', [self]);
  });
  def(GROUP_T, 'addTouchables', `(${ARRAYLIST})V`, (r, _m, [self, views]) => {
    r.dispatch({ owner: VIEW, name: 'addTouchables', parameters: [ARRAYLIST], result: 'V', signature: `(${ARRAYLIST})V` }, [self, views], 'direct');
    for (const child of childrenOf(r, self)) if (visibleFlag(r, child)) viewCall(r, child, 'addTouchables', [ARRAYLIST], 'V', [views]);
  });
  def(VIEW, 'getTouchables', `()${ARRAYLIST}`, (r, _m, [self]) => { const list = construct(r, ARRAYLIST, [], []); viewCall(r, self, 'addTouchables', [ARRAYLIST], 'V', [list]); return list; });
  def(VIEW, 'restoreDefaultFocus', '()Z', (r, _m, [self]) => viewCall(r, self, 'requestFocus', ['I'], 'Z', [130]));   // FOCUS_DOWN
  def(VIEW, 'keyboardNavigationClusterSearch', `(${VIEW}I)${VIEW}`, (r, _m, [self, currentCluster, direction]) => {
    const cluster = flag(viewCall(r, self, 'isKeyboardNavigationCluster', [], 'Z')) ? self : currentCluster;
    if (rootNamespace(r, self)) return call(r, finder(r), FOCUS_FINDER, 'findNextKeyboardNavigationCluster', [VIEW, VIEW, 'I'], VIEW, [self, cluster, direction]);
    const parent = r.object(self).parent; return isGroup(r, parent) ? call(r, parent, GROUP_T, 'keyboardNavigationClusterSearch', [VIEW, 'I'], VIEW, [cluster, direction]) : null;
  });
  def(VIEW, 'addKeyboardNavigationClusters', `(${COLLECTION}I)V`, (r, _m, [self, views]) => {
    if (!flag(viewCall(r, self, 'isKeyboardNavigationCluster', [], 'Z')) || !flag(viewCall(r, self, 'hasFocusable', [], 'Z'))) return;
    call(r, views, COLLECTION, 'add', [OBJECT], 'Z', [self]);
  });
  def(GROUP_T, 'addKeyboardNavigationClusters', `(${COLLECTION}I)V`, (r, _m, [self, views, direction]) => {
    const before = call(r, views, COLLECTION, 'size', [], 'I');
    r.dispatch({ owner: VIEW, name: 'addKeyboardNavigationClusters', parameters: [COLLECTION, 'I'], result: 'V', signature: `(${COLLECTION}I)V` }, r.argumentWords([COLLECTION, 'I'], [views, direction], { receiver: self }), 'direct');
    if (before !== call(r, views, COLLECTION, 'size', [], 'I')) return;   // no clusters inside a cluster
    if (call(r, self, GROUP_T, 'getDescendantFocusability', [], 'I') === 0x60000) return;
    for (const child of childrenOf(r, self)) if (visibleFlag(r, child)) viewCall(r, child, 'addKeyboardNavigationClusters', [COLLECTION, 'I'], 'V', [views, direction]);
  });
  def(VIEW, 'dispatchUnhandledMove', `(${VIEW}I)Z`, () => 0);
  def(GROUP_T, 'dispatchUnhandledMove', `(${VIEW}I)Z`, (r, _m, [self, focused, direction]) => { const child = call(r, self, GROUP_T, 'getFocusedChild', [], VIEW); return nullish(child) ? 0 : viewCall(r, child, 'dispatchUnhandledMove', [VIEW, 'I'], 'Z', [focused, direction]); });
  def(VIEW, 'addOnUnhandledKeyEventListener', 'Landroid/view/View$OnUnhandledKeyEventListener;'.replace(/^/, '(') + ')V', (r, _m, [self, listener]) => {
    if (nullish(listener)) npe(r); const view = r.object(self); (view.unhandledKeyListeners ??= []).push(listener);
  });
  def(VIEW, 'removeOnUnhandledKeyEventListener', 'Landroid/view/View$OnUnhandledKeyEventListener;'.replace(/^/, '(') + ')V', (r, _m, [self, listener]) => {
    const list = r.object(self).unhandledKeyListeners ?? [], index = list.findIndex(x => ref(x) === ref(listener)); if (index >= 0) list.splice(index, 1);
  });


  // ================================================================================== scrolling (View.java defaults), over-scroll, scroll bars, fading edges, scroll indicators
  def(VIEW, 'computeScroll', '()V', () => {});
  for (const [axis, size, getScroll] of [['Horizontal', 'getWidth', 'getScrollX'], ['Vertical', 'getHeight', 'getScrollY']]) {
    def(VIEW, `compute${axis}ScrollRange`, '()I', (r, _m, [self]) => viewCall(r, self, size, [], 'I'));
    def(VIEW, `compute${axis}ScrollOffset`, '()I', (r, _m, [self]) => viewCall(r, self, getScroll, [], 'I'));
    def(VIEW, `compute${axis}ScrollExtent`, '()I', (r, _m, [self]) => viewCall(r, self, size, [], 'I'));
    def(VIEW, `canScroll${axis}ly`.replace('Horizontally', 'Horizontally').replace('Verticaly', 'Vertically'), '(I)Z', (r, _m, [self, direction]) => {
      const offset = viewCall(r, self, `compute${axis}ScrollOffset`, [], 'I'), range = viewCall(r, self, `compute${axis}ScrollRange`, [], 'I') - viewCall(r, self, `compute${axis}ScrollExtent`, [], 'I');
      if (range === 0) return 0;
      return direction < 0 ? (offset > 0 ? 1 : 0) : (offset < range - 1 ? 1 : 0);
    });
  }
  def(VIEW, 'onOverScrolled', '(IIZZ)V', () => {});
  def(VIEW, 'overScrollBy', '(IIIIIIIIZ)Z', (r, _m, [self, deltaX, deltaY, scrollX, scrollY, rangeX, rangeY, maxX, maxY]) => {
    const mode = viewCall(r, self, 'getOverScrollMode', [], 'I');   // OVER_SCROLL_ALWAYS 0, IF_CONTENT_SCROLLS 1, NEVER 2
    const canH = viewCall(r, self, 'computeHorizontalScrollRange', [], 'I') > viewCall(r, self, 'computeHorizontalScrollExtent', [], 'I'), canV = viewCall(r, self, 'computeVerticalScrollRange', [], 'I') > viewCall(r, self, 'computeVerticalScrollExtent', [], 'I');
    const overH = mode === 0 || (mode === 1 && canH), overV = mode === 0 || (mode === 1 && canV);
    let newX = scrollX + deltaX, newY = scrollY + deltaY; const maxOverX = overH ? maxX : 0, maxOverY = overV ? maxY : 0;
    const left = -maxOverX, right = maxOverX + rangeX, top = -maxOverY, bottom = maxOverY + rangeY;
    let clampedX = false, clampedY = false;
    if (newX > right) { newX = right; clampedX = true; } else if (newX < left) { newX = left; clampedX = true; }
    if (newY > bottom) { newY = bottom; clampedY = true; } else if (newY < top) { newY = top; clampedY = true; }
    viewCall(r, self, 'onOverScrolled', ['I', 'I', 'Z', 'Z'], 'V', [newX, newY, clampedX ? 1 : 0, clampedY ? 1 : 0]);
    return clampedX || clampedY ? 1 : 0;
  });
  const scaledScrollBar = (r, self) => { const metrics = call(r, viewCall(r, self, 'getResources', [], RESOURCES), RESOURCES, 'getDisplayMetrics', [], 'Landroid/util/DisplayMetrics;'); const density = i2f(r.object(metrics).fields.get('Landroid/util/DisplayMetrics;->density:F') ?? f2i(1)); return Math.trunc(4 * density + 0.5); };   // ViewConfiguration.getScaledScrollBarSize: SCROLL_BAR_SIZE = 4 dp
  def(VIEW, 'getHorizontalScrollbarHeight', '()I', (r, _m, [self]) => { const view = r.object(self); return (view.horizontalScrollBar || view.hScrollThumb || view.hScrollTrack) ? (view.scrollBarSize || scaledScrollBar(r, self)) : 0; });
  def(VIEW, 'getVerticalScrollbarWidth', '()I', (r, _m, [self]) => { const view = r.object(self); return (view.verticalScrollBar || view.vScrollThumb || view.vScrollTrack) ? (view.scrollBarSize || scaledScrollBar(r, self)) : 0; });
  def(VIEW, 'getTopFadingEdgeStrength', '()F', (r, _m, [self]) => f2i(viewCall(r, self, 'computeVerticalScrollOffset', [], 'I') > 0 ? 1 : 0));
  def(VIEW, 'getBottomFadingEdgeStrength', '()F', (r, _m, [self]) => f2i(viewCall(r, self, 'computeVerticalScrollOffset', [], 'I') + viewCall(r, self, 'computeVerticalScrollExtent', [], 'I') < viewCall(r, self, 'computeVerticalScrollRange', [], 'I') ? 1 : 0));
  def(VIEW, 'getLeftFadingEdgeStrength', '()F', (r, _m, [self]) => f2i(viewCall(r, self, 'computeHorizontalScrollOffset', [], 'I') > 0 ? 1 : 0));
  def(VIEW, 'getRightFadingEdgeStrength', '()F', (r, _m, [self]) => f2i(viewCall(r, self, 'computeHorizontalScrollOffset', [], 'I') + viewCall(r, self, 'computeHorizontalScrollExtent', [], 'I') < viewCall(r, self, 'computeHorizontalScrollRange', [], 'I') ? 1 : 0));
  def(VIEW, 'onDrawScrollBars', '(Landroid/graphics/Canvas;)V', () => {});   // the virtual window draws no scroll bars
  def(VIEW, 'onDrawForeground', '(Landroid/graphics/Canvas;)V', (r, _m, [self, canvas]) => {
    const foreground = r.object(self).foregroundDrawable; if (nullish(foreground)) return;
    const d = dimension(r, self); call(r, foreground, DRAWABLE, 'setBounds', ['I', 'I', 'I', 'I'], 'V', [0, 0, d.width, d.height]); call(r, foreground, DRAWABLE, 'draw', ['Landroid/graphics/Canvas;'], 'V', [canvas]);
  });
  def(VIEW, 'getScrollIndicators', '()I', (r, _m, [self]) => r.object(self).scrollIndicators ?? 0);
  def(VIEW, 'setScrollIndicators', '(I)V', (r, _m, [self, flags]) => viewCall(r, self, 'setScrollIndicators', ['I', 'I'], 'V', [flags, 0x3f]));
  def(VIEW, 'setScrollIndicators', '(II)V', (r, _m, [self, flags, mask]) => {   // only the bits of `mask` (SCROLL_INDICATORS_PFLAG3_MASK = 0x3f) change
    const view = r.object(self), updated = flags & mask & 0x3f, next = ((view.scrollIndicators ?? 0) & ~(mask & 0x3f)) | updated;
    if (next !== (view.scrollIndicators ?? 0)) { view.scrollIndicators = next; platform.requestDraw?.(r, self); }
  });
  def(VIEW, 'getHasOverlappingRendering', '()Z', (r, _m, [self]) => viewCall(r, self, 'hasOverlappingRendering', [], 'Z'));
  def(VIEW, 'hasOverlappingRendering', '()Z', (r, _m, [self]) => (r.object(self).forceOverlappingRendering ?? true) ? 1 : 0);
  def(VIEW, 'forceHasOverlappingRendering', '(Z)V', (r, _m, [self, has]) => { r.object(self).forceOverlappingRendering = flag(has); });
  def(VIEW, 'gatherTransparentRegion', '(Landroid/graphics/Region;)Z', (r, _m, [self, region]) => {   // View.gatherTransparentRegion: an opaque, drawing View punches out nothing; a View that does not draw is see-through
    if (nullish(region)) return 1;
    return 1;
  });
  def(VIEW, 'isShowingLayoutBounds', '()Z', () => 0);

  // ================================================================================== nested scrolling (the NestedScrollingChild half of View, and the ViewParent half of ViewGroup)
  const NESTED_PARENT = 'Landroid/view/ViewParent;';
  const nestedParentOf = (r, self) => r.object(self).nestedScrollingParent ?? null;
  def(VIEW, 'setNestedScrollingEnabled', '(Z)V', (r, _m, [self, enabledFlag]) => { const view = r.object(self); if (flag(enabledFlag)) view.nestedScrollingEnabled = true; else { viewCall(r, self, 'stopNestedScroll'); view.nestedScrollingEnabled = false; } });
  def(VIEW, 'hasNestedScrollingParent', '()Z', (r, _m, [self]) => nullish(nestedParentOf(r, self)) ? 0 : 1);
  def(VIEW, 'startNestedScroll', '(I)Z', (r, _m, [self, axes]) => {
    if (!nullish(nestedParentOf(r, self))) return 1;
    if (!flag(viewCall(r, self, 'isNestedScrollingEnabled', [], 'Z'))) return 0;
    let child = self;
    for (let parent = r.object(self).parent, depth = 0; !nullish(parent) && depth < 4096; parent = r.object(parent).parent, depth++) {
      const type = r.object(parent).type;
      if (flag(call(r, parent, type, 'onStartNestedScroll', [VIEW, VIEW, 'I'], 'Z', [child, self, axes]))) {
        r.object(self).nestedScrollingParent = parent; call(r, parent, type, 'onNestedScrollAccepted', [VIEW, VIEW, 'I'], 'V', [child, self, axes]); return 1;
      }
      if (isView(r, parent)) child = parent;
    }
    return 0;
  });
  def(VIEW, 'stopNestedScroll', '()V', (r, _m, [self]) => {
    const parent = nestedParentOf(r, self); if (nullish(parent)) return;
    r.object(self).nestedScrollingParent = null; call(r, parent, r.object(parent).type, 'onStopNestedScroll', [VIEW], 'V', [self]);
  });
  const locationInWindow = (r, self, out) => viewCall(r, self, 'getLocationInWindow', ['[I'], 'V', [out]);
  def(VIEW, 'dispatchNestedScroll', '(IIII[I)Z', (r, _m, [self, dxConsumed, dyConsumed, dxUnconsumed, dyUnconsumed, offset]) => {
    const parent = nestedParentOf(r, self);
    if (!flag(viewCall(r, self, 'isNestedScrollingEnabled', [], 'Z')) || nullish(parent)) return 0;
    const elements = nullish(offset) ? null : r.array(offset).elements;
    if (dxConsumed !== 0 || dyConsumed !== 0 || dxUnconsumed !== 0 || dyUnconsumed !== 0) {
      let startX = 0, startY = 0; if (elements) { locationInWindow(r, self, offset); startX = elements[0]; startY = elements[1]; }
      call(r, parent, r.object(parent).type, 'onNestedScroll', [VIEW, 'I', 'I', 'I', 'I'], 'V', [self, dxConsumed, dyConsumed, dxUnconsumed, dyUnconsumed]);
      if (elements) { locationInWindow(r, self, offset); elements[0] -= startX; elements[1] -= startY; }
      return 1;
    }
    if (elements) { elements[0] = 0; elements[1] = 0; }
    return 0;
  });
  def(VIEW, 'dispatchNestedPreScroll', '(II[I[I)Z', (r, _m, [self, dx, dy, consumedIn, offset]) => {
    const parent = nestedParentOf(r, self);
    if (!flag(viewCall(r, self, 'isNestedScrollingEnabled', [], 'Z')) || nullish(parent)) return 0;
    const offsets = nullish(offset) ? null : r.array(offset).elements;
    if (dx !== 0 || dy !== 0) {
      let startX = 0, startY = 0; if (offsets) { locationInWindow(r, self, offset); startX = offsets[0]; startY = offsets[1]; }
      const consumed = nullish(consumedIn) ? r.newArray('[I', 2) : consumedIn, values = r.array(consumed).elements; values[0] = 0; values[1] = 0;
      call(r, parent, r.object(parent).type, 'onNestedPreScroll', [VIEW, 'I', 'I', '[I'], 'V', [self, dx, dy, consumed]);
      if (offsets) { locationInWindow(r, self, offset); offsets[0] -= startX; offsets[1] -= startY; }
      return values[0] !== 0 || values[1] !== 0 ? 1 : 0;
    }
    if (offsets) { offsets[0] = 0; offsets[1] = 0; }
    return 0;
  });
  def(VIEW, 'dispatchNestedFling', '(FFZ)Z', (r, _m, [self, vx, vy, consumed]) => {
    const parent = nestedParentOf(r, self); if (!flag(viewCall(r, self, 'isNestedScrollingEnabled', [], 'Z')) || nullish(parent)) return 0;
    return call(r, parent, r.object(parent).type, 'onNestedFling', [VIEW, 'F', 'F', 'Z'], 'Z', [self, vx, vy, consumed]);
  });
  def(VIEW, 'dispatchNestedPreFling', '(FF)Z', (r, _m, [self, vx, vy]) => {
    const parent = nestedParentOf(r, self); if (!flag(viewCall(r, self, 'isNestedScrollingEnabled', [], 'Z')) || nullish(parent)) return 0;
    return call(r, parent, r.object(parent).type, 'onNestedPreFling', [VIEW, 'F', 'F'], 'Z', [self, vx, vy]);
  });
  // ViewGroup as a ViewParent: it takes no part in nested scrolling by itself, remembers the accepted axes and relays the child's events to its own nested-scrolling parent
  def(GROUP_T, 'onStartNestedScroll', `(${VIEW}${VIEW}I)Z`, () => 0);
  def(GROUP_T, 'onNestedScrollAccepted', `(${VIEW}${VIEW}I)V`, (r, _m, [self, , , axes]) => { r.object(self).nestedScrollAxes = axes; });
  def(GROUP_T, 'onStopNestedScroll', `(${VIEW})V`, (r, _m, [self]) => { viewCall(r, self, 'stopNestedScroll'); r.object(self).nestedScrollAxes = 0; });
  def(GROUP_T, 'onNestedScroll', `(${VIEW}IIII)V`, (r, _m, [self, , dxC, dyC, dxU, dyU]) => { viewCall(r, self, 'dispatchNestedScroll', ['I', 'I', 'I', 'I', '[I'], 'Z', [dxC, dyC, dxU, dyU, null]); });
  def(GROUP_T, 'onNestedPreScroll', `(${VIEW}II[I)V`, (r, _m, [self, , dx, dy, consumed]) => { viewCall(r, self, 'dispatchNestedPreScroll', ['I', 'I', '[I', '[I'], 'Z', [dx, dy, consumed, null]); });
  def(GROUP_T, 'onNestedFling', `(${VIEW}FFZ)Z`, (r, _m, [self, , vx, vy, consumed]) => viewCall(r, self, 'dispatchNestedFling', ['F', 'F', 'Z'], 'Z', [vx, vy, consumed]));
  def(GROUP_T, 'onNestedPreFling', `(${VIEW}FF)Z`, (r, _m, [self, , vx, vy]) => viewCall(r, self, 'dispatchNestedPreFling', ['F', 'F'], 'Z', [vx, vy]));
  def(GROUP_T, 'getNestedScrollAxes', '()I', (r, _m, [self]) => r.object(self).nestedScrollAxes ?? 0);
  void NESTED_PARENT;


  // ================================================================================== lifecycle / configuration / visibility dispatch (View.java hooks, ViewGroup propagation)
  const CONFIGURATION = 'Landroid/content/res/Configuration;';
  const propagate = (name, parameters) => {
    def(GROUP_T, name, `(${parameters.join('')})V`, (r, _m, [self, ...args]) => {
      r.dispatch({ owner: VIEW, name, parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: self }), 'direct');
      for (const child of childrenOf(r, self)) viewCall(r, child, name, parameters, 'V', args);
    });
  };
  def(VIEW, 'onConfigurationChanged', `(${CONFIGURATION})V`, () => {});
  def(VIEW, 'dispatchConfigurationChanged', `(${CONFIGURATION})V`, (r, _m, [self, config]) => viewCall(r, self, 'onConfigurationChanged', [CONFIGURATION], 'V', [config]));
  propagate('dispatchConfigurationChanged', [CONFIGURATION]);
  def(VIEW, 'onDisplayHint', '(I)V', () => {});
  def(VIEW, 'dispatchDisplayHint', '(I)V', (r, _m, [self, hint]) => viewCall(r, self, 'onDisplayHint', ['I'], 'V', [hint]));
  propagate('dispatchDisplayHint', ['I']);
  def(VIEW, 'dispatchWindowVisibilityChanged', '(I)V', (r, _m, [self, visibility]) => viewCall(r, self, 'onWindowVisibilityChanged', ['I'], 'V', [visibility]));
  propagate('dispatchWindowVisibilityChanged', ['I']);
  def(VIEW, 'dispatchVisibilityChanged', `(${VIEW}I)V`, (r, _m, [self, changed, visibility]) => viewCall(r, self, 'onVisibilityChanged', [VIEW, 'I'], 'V', [changed, visibility]));
  propagate('dispatchVisibilityChanged', [VIEW, 'I']);
  def(VIEW, 'onScreenStateChanged', '(I)V', () => {});
  def(VIEW, 'onVisibilityAggregated', '(Z)V', (r, _m, [self, visible]) => {   // View.onVisibilityAggregated: remember it and show / hide the background and foreground drawables
    const view = r.object(self), on = flag(visible); view.aggregatedVisible = on;
    for (const field of ['backgroundDrawable', 'foregroundDrawable']) {
      const drawable = view[field]; if (nullish(drawable)) continue;
      if (flag(call(r, drawable, DRAWABLE, 'isVisible', [], 'Z')) !== on) call(r, drawable, DRAWABLE, 'setVisible', ['Z', 'Z'], 'Z', [on ? 1 : 0, 0]);
    }
  });
  def(VIEW, 'dispatchSystemUiVisibilityChanged', '(I)V', (r, _m, [self, visibility]) => {
    const listener = r.object(self).systemUiVisibilityListener;
    if (!nullish(listener)) call(r, listener, r.object(listener).type, 'onSystemUiVisibilityChange', ['I'], 'V', [visibility & 0x3ff7]);   // PUBLIC_STATUS_BAR_VISIBILITY_MASK
  });
  def(VIEW, 'onWindowSystemUiVisibilityChanged', '(I)V', () => {});
  def(VIEW, 'dispatchWindowSystemUiVisiblityChanged', '(I)V', (r, _m, [self, visible]) => viewCall(r, self, 'onWindowSystemUiVisibilityChanged', ['I'], 'V', [visible]));
  propagate('dispatchWindowSystemUiVisiblityChanged', ['I']);
  def(VIEW, 'drawableHotspotChanged', '(FF)V', (r, _m, [self, x, y]) => {
    const view = r.object(self);
    for (const field of ['backgroundDrawable', 'foregroundDrawable']) if (!nullish(view[field])) call(r, view[field], DRAWABLE, 'setHotspot', ['F', 'F'], 'V', [x, y]);
    viewCall(r, self, 'dispatchDrawableHotspotChanged', ['F', 'F'], 'V', [x, y]);
  });
  def(VIEW, 'dispatchDrawableHotspotChanged', '(FF)V', () => {});
  def(GROUP_T, 'dispatchDrawableHotspotChanged', '(FF)V', (r, _m, [self, x, y]) => {   // only children that do not handle touches themselves (or mirror the parent's state) follow the hotspot, in their own coordinates
    const scrollX = viewCall(r, self, 'getScrollX', [], 'I'), scrollY = viewCall(r, self, 'getScrollY', [], 'I');
    for (const child of childrenOf(r, self)) {
      const nonActionable = !flag(viewCall(r, child, 'isClickable', [], 'Z')) && !flag(viewCall(r, child, 'isLongClickable', [], 'Z')), duplicates = !!r.object(child).duplicateParentState;
      if (!nonActionable && !duplicates) continue;
      const c = dimension(r, child); viewCall(r, child, 'drawableHotspotChanged', ['F', 'F'], 'V', [f2i(i2f(x) + scrollX - c.left), f2i(i2f(y) + scrollY - c.top)]);
    }
  });
  def(VIEW, 'onAnimationStart', '()V', () => {}); def(VIEW, 'onAnimationEnd', '()V', () => {});
  def(VIEW, 'getKeyDispatcherState', '()Landroid/view/KeyEvent$DispatcherState;', (r, _m, [self]) => {
    if (!r.object(self).attached) return null;
    let root = self; for (let depth = 0; isView(r, r.object(root).parent) && depth < 4096; depth++) root = r.object(root).parent;
    const owner = r.object(root); return owner.keyDispatchState ??= construct(r, 'Landroid/view/KeyEvent$DispatcherState;', [], []);
  });
  def(VIEW, 'inflate', `(${CONTEXT}I${'Landroid/view/ViewGroup;'})${VIEW}`, (r, _m, [context, resource, root]) => {
    const inflater = callStatic(r, 'Landroid/view/LayoutInflater;', 'from', [CONTEXT], 'Landroid/view/LayoutInflater;', [context]);
    return call(r, inflater, 'Landroid/view/LayoutInflater;', 'inflate', ['I', 'Landroid/view/ViewGroup;'], VIEW, [resource, root]);
  }, { static: true });
  // The attribute-debugging accessors answer like a View with sDebugViewAttributes off (the default outside the layout inspector)
  def(VIEW, 'getExplicitStyle', '()I', () => 0); def(VIEW, 'getAttributeResolutionStack', '(I)[I', r => r.newArray('[I', 0));
  def(VIEW, 'getAttributeSourceResourceMap', '()Ljava/util/Map;', r => callStatic(r, 'Ljava/util/Collections;', 'emptyMap', [], 'Ljava/util/Map;'));
  def(VIEW, 'getSourceLayoutResId', '()I', (r, _m, [self]) => r.object(self).sourceLayoutResId ?? 0);

  // ================================================================================== input method hooks, visibility-to-user, autofill / content capture properties
  const EDITOR_INFO = 'Landroid/view/inputmethod/EditorInfo;', INPUT_CONNECTION = 'Landroid/view/inputmethod/InputConnection;';
  def(VIEW, 'onCheckIsTextEditor', '()Z', () => 0);
  def(VIEW, 'onCreateInputConnection', `(${EDITOR_INFO})${INPUT_CONNECTION}`, () => null);
  def(VIEW, 'checkInputConnectionProxy', `(${VIEW})Z`, () => 0);
  const visibleToUser = (r, self) => {   // View.isVisibleToUser(): attached, every ancestor visible with alpha > 0, and a non-empty global visible rect
    if (!r.object(self).attached) return false;
    for (let current = self, depth = 0; isView(r, current) && depth < 4096; current = r.object(current).parent, depth++) {
      if (i2f(viewCall(r, current, 'getAlpha', [], 'F')) <= 0 || (r.object(current).visibility ?? 0) !== 0) return false;
    }
    return flag(viewCall(r, self, 'getGlobalVisibleRect', [RECT, POINT], 'Z', [construct(r, RECT, [], []), construct(r, POINT, [], [])]));
  };
  def(VIEW, 'isVisibleToUserForAutofill', '(I)Z', (r, _m, [self]) => visibleToUser(r, self) ? 1 : 0);
  def(VIEW, 'setAutofillHints', `([${STRING})V`, (r, _m, [self, hints]) => { r.object(self).autofillHints = nullish(hints) || r.array(hints).elements.length === 0 ? null : hints; });
  def(VIEW, 'getAutofillHints', `()[${STRING}`, (r, _m, [self]) => r.object(self).autofillHints ?? null);
  def(VIEW, 'getAutofillType', '()I', () => 0);                      // AUTOFILL_TYPE_NONE
  def(VIEW, 'getAutofillValue', '()Landroid/view/autofill/AutofillValue;', () => null);
  def(VIEW, 'autofill', '(Landroid/view/autofill/AutofillValue;)V', () => {});
  def(VIEW, 'autofill', '(Landroid/util/SparseArray;)V', () => {});
  const generatedId = id => (id & 0xff000000) === 0 && (id & 0x00ffffff) !== 0;   // View.isViewIdGenerated
  const explicitAppResource = (r, self) => {
    const id = viewCall(r, self, 'getId', [], 'I'); if (id === -1 || generatedId(id)) return false;
    try {
      const resources = viewCall(r, self, 'getResources', [], RESOURCES), context = viewCall(r, self, 'getContext', [], CONTEXT);
      const entry = call(r, resources, RESOURCES, 'getResourceEntryName', ['I'], STRING, [id]), pkg = call(r, resources, RESOURCES, 'getResourcePackageName', ['I'], STRING, [id]);
      return !nullish(entry) && !nullish(pkg) && r.stringCharacters(pkg) === r.stringCharacters(call(r, context, CONTEXT, 'getPackageName', [], STRING));
    } catch (error) { if (error?.name === 'JavaException') return false; throw error; }
  };
  const importantFor = (r, self, getter, heuristics) => {   // shared shape of isImportantForAutofill / isImportantForContentCapture
    for (let parent = r.object(self).parent, depth = 0; isView(r, parent) && depth < 4096; parent = r.object(parent).parent, depth++) {
      const mode = viewCall(r, parent, getter, [], 'I'); if (mode === 4 || mode === 8) return false;
    }
    const mode = viewCall(r, self, getter, [], 'I');
    if (mode === 4 || mode === 1) return true; if (mode === 8 || mode === 2) return false;
    return heuristics();
  };
  def(VIEW, 'isImportantForAutofill', '()Z', (r, _m, [self]) => importantFor(r, self, 'getImportantForAutofill', () => explicitAppResource(r, self) || !nullish(viewCall(r, self, 'getAutofillHints', [], `[${STRING}`))) ? 1 : 0);
  def(VIEW, 'isImportantForContentCapture', '()Z', (r, _m, [self]) => importantFor(r, self, 'getImportantForContentCapture', () => explicitAppResource(r, self)) ? 1 : 0);
  def(VIEW, 'setContentCaptureSession', '(Landroid/view/contentcapture/ContentCaptureSession;)V', (r, _m, [self, session]) => { r.object(self).contentCaptureSession = nullish(session) ? null : session; });

  // ================================================================================== subsystems the virtual device does not have: structure dumps, translation, drag and drop, action modes, scroll capture, display hashes
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };
  const STRUCTURE = 'Landroid/view/ViewStructure;';
  for (const [name, sig] of [['onProvideStructure', `(${STRUCTURE})V`], ['onProvideAutofillStructure', `(${STRUCTURE}I)V`], ['onProvideVirtualStructure', `(${STRUCTURE})V`], ['onProvideAutofillVirtualStructure', `(${STRUCTURE}I)V`], ['onProvideContentCaptureStructure', `(${STRUCTURE}I)V`], ['dispatchProvideStructure', `(${STRUCTURE})V`], ['dispatchProvideAutofillStructure', `(${STRUCTURE}I)V`]]) {
    def(VIEW, name, sig, () => unsupported(`View.${name} fills an android.view.ViewStructure for the assist / autofill / content-capture services, which are not part of the virtual device`, 'view-structure-unsupported'));
  }
  def(VIEW, 'onCreateViewTranslationRequest', '([ILjava/util/function/Consumer;)V', () => unsupported('View translation requests need the TranslationManager service', 'view-translation-unsupported'));
  def(VIEW, 'onCreateVirtualViewTranslationRequests', '([J[ILjava/util/function/Consumer;)V', () => unsupported('View translation requests need the TranslationManager service', 'view-translation-unsupported'));
  def(VIEW, 'dispatchCreateViewTranslationRequest', '(Ljava/util/Map;[ILandroid/view/translation/TranslationCapability;Ljava/util/List;)V', () => unsupported('View translation requests need the TranslationManager service', 'view-translation-unsupported'));
  def(VIEW, 'onViewTranslationResponse', '(Landroid/view/translation/ViewTranslationResponse;)V', () => {});
  def(VIEW, 'onVirtualViewTranslationResponses', '(Landroid/util/LongSparseArray;)V', () => {});
  def(VIEW, 'getViewTranslationResponse', '()Landroid/view/translation/ViewTranslationResponse;', () => null);
  def(VIEW, 'onDragEvent', '(Landroid/view/DragEvent;)Z', () => 0);
  def(VIEW, 'dispatchDragEvent', '(Landroid/view/DragEvent;)Z', (r, _m, [self, event]) => {
    const listener = r.object(self).dragListener;
    if (!nullish(listener) && enabled(r, self) && flag(call(r, listener, r.object(listener).type, 'onDrag', [VIEW, 'Landroid/view/DragEvent;'], 'Z', [self, event]))) return 1;
    return viewCall(r, self, 'onDragEvent', ['Landroid/view/DragEvent;'], 'Z', [event]);
  });
  for (const name of ['startDrag', 'startDragAndDrop']) def(VIEW, name, `(Landroid/content/ClipData;Landroid/view/View$DragShadowBuilder;${OBJECT}I)Z`, () => unsupported(`View.${name} needs the system drag-and-drop window, which the virtual window does not have`, 'drag-and-drop-unsupported'));
  def(VIEW, 'cancelDragAndDrop', '()V', () => {}); def(VIEW, 'updateDragShadow', '(Landroid/view/View$DragShadowBuilder;)V', () => {});   // no drag is ever in progress
  for (const sig of ['(Landroid/view/ActionMode$Callback;)', '(Landroid/view/ActionMode$Callback;I)']) def(VIEW, 'startActionMode', `${sig}Landroid/view/ActionMode;`, (r, _m, [self]) => {
    if (nullish(r.object(self).parent)) return null;   // View.startActionMode without a parent returns null
    return unsupported('View.startActionMode needs the window decor\'s action-mode surface (contextual action bar / floating toolbar), which the virtual window does not have', 'action-mode-unsupported');
  });
  def(VIEW, 'setScrollCaptureCallback', '(Landroid/view/ScrollCaptureCallback;)V', (r, _m, [self, callback]) => { r.object(self).scrollCaptureCallback = nullish(callback) ? null : callback; });
  def(VIEW, 'onScrollCaptureSearch', '(Landroid/graphics/Rect;Landroid/graphics/Point;Ljava/util/function/Consumer;)V', (r, _m, [self]) => {
    if (!nullish(r.object(self).scrollCaptureCallback)) unsupported('Scroll capture targets need the system screenshot service', 'scroll-capture-unsupported');
  });
  def(VIEW, 'dispatchScrollCaptureSearch', '(Landroid/graphics/Rect;Landroid/graphics/Point;Ljava/util/function/Consumer;)V', (r, _m, [self, rect, point, consumer]) => viewCall(r, self, 'onScrollCaptureSearch', [RECT, POINT, 'Ljava/util/function/Consumer;'], 'V', [rect, point, consumer]));
  def(VIEW, 'generateDisplayHash', `(${STRING}${RECT}Ljava/util/concurrent/Executor;Landroid/view/displayhash/DisplayHashResultCallback;)V`, () => unsupported('View.generateDisplayHash needs the system DisplayHashManager', 'display-hash-unsupported'));
  def(VIEW, 'getRootSurfaceControl', '()Landroid/view/AttachedSurfaceControl;', (r, _m, [self]) => r.object(self).attached ? unsupported('An attached View\'s AttachedSurfaceControl needs a SurfaceControl, which the virtual window does not have', 'surface-control-unsupported') : null);
  def(VIEW, 'getWindowId', '()Landroid/view/WindowId;', (r, _m, [self]) => r.object(self).attached ? unsupported('View.getWindowId needs the window session\'s IWindowId binder, which the virtual window does not have', 'window-id-unsupported') : null);
  def(VIEW, 'getOverlay', '()Landroid/view/ViewOverlay;', () => unsupported('View.getOverlay needs ViewOverlay, which is not part of the framework yet', 'view-overlay-unsupported'));
  def(VIEW, 'getAnimationMatrix', '()Landroid/graphics/Matrix;', (r, _m, [self]) => r.object(self).animationMatrix ?? null);
  def(VIEW, 'setAnimationMatrix', '(Landroid/graphics/Matrix;)V', (r, _m, [self, matrix]) => {
    if (nullish(matrix)) { r.object(self).animationMatrix = null; platform.requestDraw?.(r, self); return; }
    unsupported('View.setAnimationMatrix replaces the property-based RenderNode matrix, which the transform host does not model', 'animation-matrix-unsupported');
  });


  // ================================================================================== legacy view animations (android.view.animation: Animation and its subclasses, original sources in the framework)
  const ANIMATION = 'Landroid/view/animation/Animation;', TRANSFORMATION = 'Landroid/view/animation/Transformation;', ANIMATION_UTILS = 'Landroid/view/animation/AnimationUtils;';
  const currentAnimationTime = r => Number(callStatic(r, ANIMATION_UTILS, 'currentAnimationTimeMillis', [], 'J'));
  def(VIEW, 'getAnimation', `()${ANIMATION}`, (r, _m, [self]) => r.object(self).currentAnimation ?? null);
  def(VIEW, 'setAnimation', `(${ANIMATION})V`, (r, _m, [self, animation]) => {
    r.object(self).currentAnimation = nullish(animation) ? null : animation;
    if (!nullish(animation)) call(r, animation, ANIMATION, 'reset', [], 'V');
  });
  def(VIEW, 'startAnimation', `(${ANIMATION})V`, (r, _m, [self, animation]) => {
    if (nullish(animation)) npe(r);
    call(r, animation, ANIMATION, 'setStartTime', ['J'], 'V', [-1n]);   // Animation.START_ON_FIRST_FRAME
    viewCall(r, self, 'setAnimation', [ANIMATION], 'V', [animation]);
    const parent = r.object(self).parent; platform.requestDraw?.(r, isView(r, parent) ? parent : self);
  });
  def(VIEW, 'clearAnimation', '()V', (r, _m, [self]) => {
    const view = r.object(self); if (!nullish(view.currentAnimation)) call(r, view.currentAnimation, ANIMATION, 'detach', [], 'V');
    view.currentAnimation = null; const parent = view.parent; if (isView(r, parent)) platform.requestDraw?.(r, parent);
  });
  /** ViewGroup.drawChild for a child with an Animation: initialise it on its first frame, ask it for this frame's Transformation, finish it (listener, onAnimationEnd, clearAnimation unless fillAfter)
   *  when it is over, and keep the parent redrawing every frame while it runs. Returns { matrix, alpha } to apply to the child's canvas, or null. */
  registry.legacyAnimation = (r, parentRef, childRef) => {
    const child = r.object(childRef), animation = child.currentAnimation; if (nullish(animation)) return null;
    const time = currentAnimationTime(r), d = dimension(r, childRef), p = dimension(r, parentRef);
    if (!flag(call(r, animation, ANIMATION, 'isInitialized', [], 'Z'))) {
      call(r, animation, ANIMATION, 'initialize', ['I', 'I', 'I', 'I'], 'V', [d.width, d.height, p.width, p.height]);
      call(r, animation, ANIMATION, 'initializeInvalidateRegion', ['I', 'I', 'I', 'I'], 'V', [0, 0, d.width, d.height]);
      child.animationStarted = true; viewCall(r, childRef, 'onAnimationStart');
    }
    const group = r.object(parentRef), transformation = group.childTransformation ??= construct(r, TRANSFORMATION, [], []);
    call(r, transformation, TRANSFORMATION, 'clear', [], 'V');
    const more = flag(call(r, animation, ANIMATION, 'getTransformation', ['J', TRANSFORMATION, 'F'], 'Z', [BigInt(time), transformation, f2i(1)]));
    const type = call(r, transformation, TRANSFORMATION, 'getTransformationType', [], 'I');
    const result = { matrix: flag(call(r, animation, ANIMATION, 'willChangeTransformationMatrix', [], 'Z')) ? call(r, transformation, TRANSFORMATION, 'getMatrix', [], MATRIX) : null,
      alpha: (type & 1) !== 0 ? i2f(call(r, transformation, TRANSFORMATION, 'getAlpha', [], 'F')) : 1 };   // TYPE_ALPHA = 1
    if (more) platform.requestDraw?.(r, parentRef, 16);
    else {
      if (!flag(call(r, animation, ANIMATION, 'getFillAfter', [], 'Z'))) viewCall(r, childRef, 'clearAnimation');
      if (child.animationStarted) { child.animationStarted = false; viewCall(r, childRef, 'onAnimationEnd'); }
      platform.requestDraw?.(r, parentRef);   // one more frame after the animation is done
    }
    return result;
  };
  def(GROUP_T, 'getChildTransformation', `()${TRANSFORMATION}`, (r, _m, [self]) => r.object(self).childTransformation ??= construct(r, TRANSFORMATION, [], []));
  // window insets animation dispatch (View.java passes through the callback set with setWindowInsetsAnimationCallback; ViewGroup continues into its children unless DISPATCH_MODE_STOP)
  const INSETS_CB = r => r;
  void INSETS_CB;
  const WIA = 'Landroid/view/WindowInsetsAnimation;', BOUNDS = 'Landroid/view/WindowInsetsAnimation$Bounds;', WINSETS = 'Landroid/view/WindowInsets;', CB = 'Landroid/view/WindowInsetsAnimation$Callback;';
  const insetsCallback = (r, self) => r.object(self).windowInsetsAnimationCallback ?? null;
  def(VIEW, 'dispatchWindowInsetsAnimationPrepare', `(${WIA})V`, (r, _m, [self, animation]) => { const cb = insetsCallback(r, self); if (!nullish(cb)) call(r, cb, CB, 'onPrepare', [WIA], 'V', [animation]); });
  def(VIEW, 'dispatchWindowInsetsAnimationStart', `(${WIA}${BOUNDS})${BOUNDS}`, (r, _m, [self, animation, bounds]) => { const cb = insetsCallback(r, self); return nullish(cb) ? bounds : call(r, cb, CB, 'onStart', [WIA, BOUNDS], BOUNDS, [animation, bounds]); });
  def(VIEW, 'dispatchWindowInsetsAnimationProgress', `(${WINSETS}${LIST})${WINSETS}`, (r, _m, [self, insets, running]) => { const cb = insetsCallback(r, self); return nullish(cb) ? insets : call(r, cb, CB, 'onProgress', [WINSETS, LIST], WINSETS, [insets, running]); });
  def(VIEW, 'dispatchWindowInsetsAnimationEnd', `(${WIA})V`, (r, _m, [self, animation]) => { const cb = insetsCallback(r, self); if (!nullish(cb)) call(r, cb, CB, 'onEnd', [WIA], 'V', [animation]); });
  const stops = (r, self) => (r.object(self).insetsAnimationDispatchMode ?? 1) === 0;
  const direct = (r, owner, name, parameters, result, args, self) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver: self }), 'direct');
  def(GROUP_T, 'dispatchWindowInsetsAnimationPrepare', `(${WIA})V`, (r, _m, [self, animation]) => { direct(r, VIEW, 'dispatchWindowInsetsAnimationPrepare', [WIA], 'V', [animation], self); if (!stops(r, self)) for (const c of childrenOf(r, self)) viewCall(r, c, 'dispatchWindowInsetsAnimationPrepare', [WIA], 'V', [animation]); });
  def(GROUP_T, 'dispatchWindowInsetsAnimationStart', `(${WIA}${BOUNDS})${BOUNDS}`, (r, _m, [self, animation, bounds]) => { const out = direct(r, VIEW, 'dispatchWindowInsetsAnimationStart', [WIA, BOUNDS], BOUNDS, [animation, bounds], self); if (!stops(r, self)) for (const c of childrenOf(r, self)) viewCall(r, c, 'dispatchWindowInsetsAnimationStart', [WIA, BOUNDS], BOUNDS, [animation, bounds]); return out; });
  def(GROUP_T, 'dispatchWindowInsetsAnimationProgress', `(${WINSETS}${LIST})${WINSETS}`, (r, _m, [self, insets, running]) => { const out = direct(r, VIEW, 'dispatchWindowInsetsAnimationProgress', [WINSETS, LIST], WINSETS, [insets, running], self); if (!stops(r, self)) for (const c of childrenOf(r, self)) viewCall(r, c, 'dispatchWindowInsetsAnimationProgress', [WINSETS, LIST], WINSETS, [out, running]); return out; });
  def(GROUP_T, 'dispatchWindowInsetsAnimationEnd', `(${WIA})V`, (r, _m, [self, animation]) => { direct(r, VIEW, 'dispatchWindowInsetsAnimationEnd', [WIA], 'V', [animation], self); if (!stops(r, self)) for (const c of childrenOf(r, self)) viewCall(r, c, 'dispatchWindowInsetsAnimationEnd', [WIA], 'V', [animation]); });

  // ---- ViewGroup.setOnHierarchyChangeListener: kept on the group; addView / removeView notify it after the onViewAdded / onViewRemoved hook (AndroidPlatform.notifyHierarchyChange) ----
  const GROUP = 'Landroid/view/ViewGroup;', HIERARCHY_LISTENER = 'Landroid/view/ViewGroup$OnHierarchyChangeListener;';
  def(GROUP, 'setOnHierarchyChangeListener', `(${HIERARCHY_LISTENER})V`, (r, _m, [self, listener]) => { r.object(self).hierarchyChangeListener = nullish(listener) ? null : listener; });
  void platform;
  return registry;
}
