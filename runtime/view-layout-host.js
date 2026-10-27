import { APKError } from './apk-runtime.js?v=64078a5322f4';
import { measureSkiaParagraph } from './skia-paragraph.js?v=64078a5322f4';
import { gcRoot } from './heap-gc.js?v=64078a5322f4';
const VIEW = 'Landroid/view/View;', GROUP = 'Landroid/view/ViewGroup;', SPEC = 'Landroid/view/View$MeasureSpec;', ALGORITHMS = 'Landroid/view/ViewMeasureAlgorithms;', CHILD = 'Landroid/view/ViewGroupMeasureAlgorithms;';
const SIZE = 0x00ffffff, STATE = 0xff000000;
const keys = new Set(), add = (owner, methods) => methods.forEach(method => keys.add(owner + '->' + method));
add(VIEW, ['requestLayout()V', 'forceLayout()V', 'isLayoutRequested()Z', 'isLaidOut()Z', 'measure(II)V', 'onMeasure(II)V', 'setMeasuredDimension(II)V', 'getMeasuredWidth()I', 'getMeasuredHeight()I', 'getMeasuredWidthAndState()I', 'getMeasuredHeightAndState()I', 'getMeasuredState()I', 'getWidth()I', 'getHeight()I', 'getLeft()I', 'getTop()I', 'getRight()I', 'getBottom()I', 'setLeft(I)V', 'setTop(I)V', 'setRight(I)V', 'setBottom(I)V', 'layout(IIII)V', 'onLayout(ZIIII)V', 'onSizeChanged(IIII)V', 'getMinimumWidth()I', 'getMinimumHeight()I', 'getSuggestedMinimumWidth()I', 'getSuggestedMinimumHeight()I', 'setMinimumWidth(I)V', 'setMinimumHeight(I)V', 'getBaseline()I', 'isLayoutRtl()Z', 'getLayoutDirection()I', 'setLayoutDirection(I)V', 'getPaddingStart()I', 'getPaddingEnd()I', 'addOnLayoutChangeListener(Landroid/view/View$OnLayoutChangeListener;)V', 'removeOnLayoutChangeListener(Landroid/view/View$OnLayoutChangeListener;)V']);
add(VIEW, ['onScrollChanged(IIII)V', 'setOnScrollChangeListener(Landroid/view/View$OnScrollChangeListener;)V']);
add(VIEW, ['getScrollX()I', 'getScrollY()I']);
add(VIEW, ['scrollTo(II)V', 'scrollBy(II)V', 'setScrollX(I)V', 'setScrollY(I)V']);
add(VIEW, ['offsetTopAndBottom(I)V', 'offsetLeftAndRight(I)V']);
add(VIEW, ['combineMeasuredStates(II)I', 'resolveSize(II)I', 'resolveSizeAndState(III)I', 'getDefaultSize(II)I']);
add('Landroid/widget/ScrollView;', ['onMeasure(II)V', 'onLayout(ZIIII)V']);
add(GROUP, ['getLayoutTransition()Landroid/animation/LayoutTransition;']);
add(GROUP, ['getChildMeasureSpec(III)I', 'measureChild(Landroid/view/View;II)V', 'measureChildWithMargins(Landroid/view/View;IIII)V', 'measureChildren(II)V']);
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'view-layout-unsupported', ...details }); };
const parametersOf = signature => signature.slice(1, signature.indexOf(')')).match(/\[*L[^;]+;|\[*[ZBCSIFJD]/g) || [];

/** View-system geometry boundary. Size constraints execute extracted, unchanged AOSP DEX;
 * APK/AndroidX onMeasure/onLayout callbacks run in the VM. Unavailable native widget
 * measurement is an explicit error, never a fabricated measurement or child list.
 */
export function createViewLayoutHost(platform) {
  let queued = false, pending = false;
  const call = (runtime, receiver, owner, name, signature, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, signature, parameters: parametersOf(signature), result: signature.slice(signature.indexOf(')') + 1) }, mode === 'static' ? values : [receiver, ...values], mode);
  const algorithm = (runtime, owner, name, signature, values) => { if (!runtime.classes.has(owner)) fail('Original AOSP measurement helper DEX is required', { owner, name }); return call(runtime, null, owner, name, signature, values, 'static'); };
  const store = (runtime, receiver, name, value) => runtime.storeField(runtime.object(receiver).fields, `${VIEW}->${name}:I`, value | 0);
  const measured = (runtime, receiver, width, height) => { const view = runtime.object(receiver); view.measuredWidth = width | 0; view.measuredHeight = height | 0; view.measuredDimensionSet = true; store(runtime, receiver, 'mMeasuredWidth', width); store(runtime, receiver, 'mMeasuredHeight', height); };
  const pendingRoots = gcRoot(new Map()), queuedRoots = gcRoot(new Set());
  const rootFor = (runtime, receiver) => {
    const surface = platform.dialogWindowHost?.recordFor(runtime, receiver); if (surface) return surface.root;
    let ref = receiver; const seen = new Set();
    while (ref) { if (seen.has(ref.ref) || seen.size >= 4096) fail('Cyclic layout hierarchy'); seen.add(ref.ref); if (ref.ref === runtime.root?.ref) return runtime.root;
      const frame = platform.frames.find(frame => frame.root?.ref === ref.ref || frame.window && [runtime.object(frame.window).decor?.ref,runtime.object(frame.window).content?.ref].includes(ref.ref)); if (frame?.root) return frame.root;
      ref = runtime.object(ref).parent;
    }
    return null;
  };
  const request = (runtime, receiver) => {
    let ref = receiver; const seen = new Set();
    while (ref) { if (seen.has(ref.ref) || seen.size >= 4096) fail('Cyclic/excessive layout hierarchy'); seen.add(ref.ref); const object = runtime.object(ref); object.layoutRequested = true; object.measureCache?.clear(); ref = object.parent; }
    const root = rootFor(runtime, receiver); if (!root) return;
    pendingRoots.set(root.ref,root); pending = true; if (runtime.object(root).attached) schedule(runtime,root);
  };
  const schedule = (runtime, root) => {
    if (queuedRoots.has(root.ref)) return; queuedRoots.add(root.ref); queued = true;
    platform.queueTask(() => {
      queuedRoots.delete(root.ref); queued = queuedRoots.size > 0;
      if (!pendingRoots.has(root.ref) || !runtime.object(root).attached || platform.taskClosed) return;
      pendingRoots.delete(root.ref); pending = pendingRoots.size > 0;
      const rootView = runtime.object(root), frameRect = platform.systemBarsHost?.contentFrame(runtime, root), geometry = platform.dialogWindowHost?.geometry(runtime,root) ?? (frameRect ? { width: frameRect.right - frameRect.left, height: frameRect.bottom - frameRect.top } : null), device = platform.device ?? { widthDp: 411, heightDp: 840 }, parentW = algorithm(runtime, SPEC, 'makeMeasureSpec', '(II)I', [geometry?.width??device.widthDp, 0x40000000]), parentH = algorithm(runtime, SPEC, 'makeMeasureSpec', '(II)I', [geometry?.height??device.heightDp, 0x40000000]);
      const width = algorithm(runtime, CHILD, 'getChildMeasureSpec', '(III)I', [parentW, 0, geometry?.layoutWidth??rootView.layoutWidth??-1]), height = algorithm(runtime, CHILD, 'getChildMeasureSpec', '(III)I', [parentH, 0, geometry?.layoutHeight??rootView.layoutHeight??-1]);
      call(runtime,root,VIEW,'measure','(II)V',[width,height]); const view=runtime.object(root);
      call(runtime,root,VIEW,'layout','(IIII)V',[0,0,view.measuredWidth&SIZE,view.measuredHeight&SIZE]); platform.requestDraw(runtime,root);
    }, 0, [root]);
  };
  const readLP = (runtime, view, name, fallback = 0) => { const fields = view.layoutParams ? runtime.object(view.layoutParams).fields : null; return fields ? [...fields].find(([key]) => key.endsWith(`->${name}:I`))?.[1] ?? fallback : fallback; };
  const measureChild = (runtime, receiver, childRef, widthSpec, widthUsed, heightSpec, heightUsed, margins) => {
    const parent = runtime.object(receiver), child = runtime.object(childRef), padding = parent.padding || {};
    if (!child.layoutParams) fail('Child measurement requires actual LayoutParams');
    const horizontal = (padding.left || 0) + (padding.right || 0) + widthUsed + (margins ? readLP(runtime, child, 'leftMargin') + readLP(runtime, child, 'rightMargin') : 0);
    const vertical = (padding.top || 0) + (padding.bottom || 0) + heightUsed + (margins ? readLP(runtime, child, 'topMargin') + readLP(runtime, child, 'bottomMargin') : 0);
    const w = algorithm(runtime, CHILD, 'getChildMeasureSpec', '(III)I', [widthSpec, horizontal, readLP(runtime, child, 'width', -2)]), h = algorithm(runtime, CHILD, 'getChildMeasureSpec', '(III)I', [heightSpec, vertical, readLP(runtime, child, 'height', -2)]);
    call(runtime, childRef, VIEW, 'measure', '(II)V', [w, h]);
  };
  // ImageView.onMeasure (adjustViewBounds=false): drawable intrinsic size + padding, at least the suggested minimum, resolved against the specs.
  const imageMeasure = (runtime, receiver, wSpec, hSpec) => {
    const view = runtime.object(receiver), padding = view.padding || {}, drawable = view.imageDrawable;
    if (view.adjustViewBounds) fail('ImageView adjustViewBounds measurement requires the original ImageView.onMeasure');
    let w = 0, h = 0;
    if (drawable) { w = call(runtime, drawable, 'Landroid/graphics/drawable/Drawable;', 'getIntrinsicWidth', '()I'); h = call(runtime, drawable, 'Landroid/graphics/drawable/Drawable;', 'getIntrinsicHeight', '()I'); if (w <= 0) w = 1; if (h <= 0) h = 1; }
    w += (padding.left || 0) + (padding.right || 0); h += (padding.top || 0) + (padding.bottom || 0);
    w = Math.max(w, call(runtime, receiver, VIEW, 'getSuggestedMinimumWidth', '()I')); h = Math.max(h, call(runtime, receiver, VIEW, 'getSuggestedMinimumHeight', '()I'));
    measured(runtime, receiver, algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [w, wSpec, 0]), algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [h, hSpec, 0]));
  };
  // ProgressBar.onMeasure: clamp the (host-less) drawable extent to the style's minWidth/maxWidth/minHeight/maxHeight, add padding.
  const progressMeasure = (runtime, receiver, wSpec, hSpec) => {
    const view = runtime.object(receiver), padding = view.padding || {}, table = platform.resources?.frameworkTable;
    if (!table) fail('ProgressBar measurement needs the framework style table');
    const names = ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'], ids = runtime.newArray('[I', 4); runtime.object(ids).elements = names.map(name => table.findId('attr/' + name));
    const attrs = view.appliedNode ? runtime.makeObject('Lapkweb/bridge/AttributeSet;') : null; if (attrs) runtime.object(attrs).node = view.appliedNode;
    const defStyle = view.defStyleAttr || table.findId(view.progressStyle === 'horizontal' ? 'attr/progressBarStyleHorizontal' : 'attr/progressBarStyle');
    const array = platform.styleBackend.obtain(runtime, platform.styleBackend.theme(runtime, view.context), attrs, ids, defStyle), TA = 'Landroid/content/res/TypedArray;';
    let limits; try { limits = names.map((_, index) => call(runtime, array, TA, 'getDimensionPixelSize', '(II)I', [index, index % 2 ? 0x7fffffff : 24])); } finally { call(runtime, array, TA, 'recycle', '()V'); }
    const [minW, maxW, minH, maxH] = limits, dw = Math.max(minW, Math.min(maxW, 0)) + (padding.left || 0) + (padding.right || 0), dh = Math.max(minH, Math.min(maxH, 0)) + (padding.top || 0) + (padding.bottom || 0);
    measured(runtime, receiver, algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [dw, wSpec, 0]), algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [dh, hSpec, 0]));
  };
  const nativeTextMeasure = (runtime, receiver, wSpec, hSpec) => {
    if (!runtime.skia?.measureText) fail('Native text measurement requires the verified Skia CPU font backend');
    const switchState = platform.drawableViewHost.measureSwitch?.(runtime, receiver);
    const view = runtime.object(receiver), text = String(view.displayText ?? view.text ?? ''), lines = text.split('\n'); if (lines.length > 1024) fail('Native text line limit exceeded');
    const typeface = call(runtime, receiver, 'Landroid/widget/TextView;', 'getTypeface', '()Landroid/graphics/Typeface;'), info = runtime.skiaHost.resolveTypeface(typeface); view.textFontWeight = info.weight; view.textFontItalic = info.italic; const font = { textSize: view.textSize || 14, flags: 1, typefaceRef: typeface }, runs = lines.map(line => runtime.skiaHost.measureText(line, font));
    const metrics = runs[0].metrics, padding = platform.drawableViewHost.compoundPadding?.(runtime,receiver) || view.padding || {}, includePadding = view.includeFontPadding !== false;
    const top = includePadding ? Math.floor(metrics.bounds[1]) : Math.round(metrics.ascent), bottom = includePadding ? Math.ceil(metrics.bounds[3]) : Math.round(metrics.descent);
    const lineHeight = Math.max(1, Math.round(metrics.descent) - Math.round(metrics.ascent) + Math.round(metrics.leading || 0));
    let height = bottom - top + (lines.length - 1) * lineHeight + (padding.top || 0) + (padding.bottom || 0), width = Math.ceil(Math.max(...runs.map(run => run.width))) + (padding.left || 0) + (padding.right || 0);
    const mode = algorithm(runtime, SPEC, 'getMode', '(I)I', [wSpec]), available = algorithm(runtime, SPEC, 'getSize', '(I)I', [wSpec]);
    view.textRaster = null; view.textParagraph = null;
    let paragraph = null;
    if (mode && width > available && !view.singleLine && !view.horizontallyScrolling || view.maxLines != null && lines.length > view.maxLines) {
      const desiredWidth = width, paragraphWidth = mode === 0x40000000 || mode && desiredWidth > available ? available : desiredWidth, contentWidth = paragraphWidth - (padding.left || 0) - (padding.right || 0);
      paragraph = measureSkiaParagraph(runtime.skia, text, { width: contentWidth, textSize: font.textSize, weight: info.weight, italic: info.italic, direction: view.layoutDirection || 0, maxLines: view.maxLines ?? null, color: view.textColor == null ? 0xff757575 : typeof view.textColor === 'string' ? parseInt(view.textColor.replace('#', ''), 16) : view.textColor, raster: true });
      width = paragraphWidth;
      height = Math.ceil(paragraph.height) + (padding.top || 0) + (padding.bottom || 0);
      view.textRaster = paragraph.raster;
      const { raster, ...metrics } = paragraph; view.textParagraph = metrics;
    }
    if (view.minLines != null) {
      if (!Number.isInteger(view.minLines) || view.minLines < 0 || view.minLines > 1024) fail('Native text minimum lines exceeds the supported 0..1024 range');
      height = Math.max(height, bottom - top + (Math.max(1, view.minLines) - 1) * lineHeight + (padding.top || 0) + (padding.bottom || 0));
    }
    let minWidth = view.minimumWidth || 0, minHeight = view.minimumHeight || 0;
    const table = platform.resources?.frameworkTable, button = runtime.isSubtype(view.type, 'Landroid/widget/Button;');
    if (table) {
      const ids = runtime.newArray('[I', 2); runtime.object(ids).elements = [table.findId('attr/minWidth'), table.findId('attr/minHeight')];
      const attrs = view.appliedNode ? runtime.makeObject('Lapkweb/bridge/AttributeSet;') : null; if (attrs) runtime.object(attrs).node = view.appliedNode;
      const array = platform.styleBackend.obtain(runtime, platform.styleBackend.theme(runtime, view.context), attrs, ids, view.defStyleAttr || table.findId(runtime.isSubtype(view.type,'Landroid/widget/Switch;')?'attr/switchStyle':runtime.isSubtype(view.type,'Landroid/widget/CheckBox;')?'attr/checkboxStyle':button?'attr/buttonStyle':'attr/textViewStyle'));
      try { minWidth = Math.max(minWidth, call(runtime, array, 'Landroid/content/res/TypedArray;', 'getDimensionPixelSize', '(II)I', [0, 0])); minHeight = Math.max(minHeight, call(runtime, array, 'Landroid/content/res/TypedArray;', 'getDimensionPixelSize', '(II)I', [1, 0])); }
      finally { call(runtime, array, 'Landroid/content/res/TypedArray;', 'recycle', '()V'); }
    }
    // TextView.onMeasure uses getSuggestedMinimum*: max(android:minWidth/Height, background.getMinimum*).
    if (view.backgroundDrawable) { minWidth = Math.max(minWidth, call(runtime, view.backgroundDrawable, 'Landroid/graphics/drawable/Drawable;', 'getMinimumWidth', '()I')); minHeight = Math.max(minHeight, call(runtime, view.backgroundDrawable, 'Landroid/graphics/drawable/Drawable;', 'getMinimumHeight', '()I')); }
    let resolvedHeight = algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [Math.max(height, minHeight), hSpec, 0]);
    // Switch.onMeasure: after the TextView measure, the height is raised to the switch's own height.
    if (switchState && (resolvedHeight & SIZE) < switchState.switchHeight) resolvedHeight = switchState.switchHeight;
    measured(runtime, receiver, algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [Math.max(width, minWidth), wSpec, 0]), resolvedHeight);
    view.textBaseline = (padding.top || 0) - top; view.textLineHeight = Math.max(lineHeight, bottom - top); view.textMetrics = { width, height, baseline: view.textBaseline, lineHeight: view.textLineHeight, fontSize: font.textSize, glyphCount: runs.reduce((sum, run) => sum + run.glyphCount, 0), source: runs[0].source, scope: 'simple Latin; no paragraph shaping/fallback' };
    if (paragraph) { view.textBaseline = (padding.top || 0) + Math.round(paragraph.baseline); view.textMetrics = { ...view.textMetrics, width, height, baseline: view.textBaseline, source: paragraph.source, scope: paragraph.scope, lineCount: paragraph.lineCount }; }
    runtime.record(paragraph ? 'MEASURE native paragraph: official SkParagraph/Roboto + original AOSP size constraints' : 'MEASURE native text: actual Skia/Roboto glyph metrics + original AOSP size constraints');
  };
  return {
    supports: key => keys.has(key),
    rootReady(runtime, root) { if (!root) return; let type = runtime.object(root).type, source = runtime.dex.classes.has(type); const seen = new Set(); while (type && !seen.has(type)) { seen.add(type); if (runtime.classes.get(type)?.methods.has('onMeasure(II)V')) { source = true; break; } type = runtime.parent(type); } if (source || runtime.skia) request(runtime, root); },
    afterAttach(runtime, receiver, attached) { if(!attached&&pendingRoots.has(receiver.ref)){pendingRoots.delete(receiver.ref);pending=pendingRoots.size>0;} if (attached && pending) { const root=rootFor(runtime,receiver); if(root&&pendingRoots.has(root.ref))schedule(runtime,root); } },
    state: () => ({ pending, queued }),
    relayoutRoot(runtime, root) { request(runtime, root); },
    invoke(runtime, method, args) {
      const name = method.name;
      if (method.owner === 'Landroid/widget/ScrollView;' && ['onMeasure', 'onLayout'].includes(name)) fail(`Original ScrollView.${name} is required; FrameLayout inheritance cannot substitute scrolling semantics`);
      if (['combineMeasuredStates', 'resolveSize', 'resolveSizeAndState', 'getDefaultSize', 'getChildMeasureSpec'].includes(name)) return algorithm(runtime, name === 'getChildMeasureSpec' ? CHILD : ALGORITHMS, name, method.signature, args);
      const receiver = args[0], view = runtime.object(receiver);
      if (name === 'offsetTopAndBottom' || name === 'offsetLeftAndRight') {
        const offset = args[1] | 0; if (!offset) return;
        const bounds = view.bounds || { left: 0, top: 0, right: 0, bottom: 0 }, axes = name === 'offsetTopAndBottom' ? ['top', 'bottom'] : ['left', 'right'];
        view.bounds = { ...bounds };
        for (const axis of axes) { view.bounds[axis] = (bounds[axis] + offset) | 0; store(runtime, receiver, 'm' + axis[0].toUpperCase() + axis.slice(1), view.bounds[axis]); }
        // This boundary replaces RenderNode translation/damage with a web frame;
        // offset is not a layout pass and must not invoke onLayout/size callbacks.
        platform.requestDraw(runtime, receiver); return;
      }
      if (name === 'getLayoutTransition') return view.fields.get(`${GROUP}->mTransition:Landroid/animation/LayoutTransition;`) ?? null;
      if (name === 'setOnScrollChangeListener') { view.scrollChangeListener = args[1]; return; }
      if (name === 'onScrollChanged') {
        view.backgroundSizeChanged = true; view.defaultFocusHighlightSizeChanged = true; view.foregroundBoundsChanged = true;
        if (view.attached) { if (!platform.viewTreeHost.noteScroll) fail('View scroll notifications require the source ViewTreeObserver frame boundary'); platform.viewTreeHost.noteScroll(runtime, receiver); }
        if (view.scrollChangeListener) call(runtime, view.scrollChangeListener, 'Landroid/view/View$OnScrollChangeListener;', 'onScrollChange', '(Landroid/view/View;IIII)V', [receiver, ...args.slice(1)]);
        platform.requestDraw(runtime, receiver); return;
      }
      if (name === 'getScrollX' || name === 'getScrollY') return view.fields.get(`${VIEW}->mScroll${name.endsWith('X') ? 'X' : 'Y'}:I`) ?? 0;
      if (['scrollTo', 'scrollBy', 'setScrollX', 'setScrollY'].includes(name)) {
        const oldX = view.fields.get(`${VIEW}->mScrollX:I`) ?? 0, oldY = view.fields.get(`${VIEW}->mScrollY:I`) ?? 0;
        if (name !== 'scrollTo') {
          const x = name === 'scrollBy' ? (oldX + args[1]) | 0 : name === 'setScrollX' ? args[1] : oldX;
          const y = name === 'scrollBy' ? (oldY + args[2]) | 0 : name === 'setScrollY' ? args[1] : oldY;
          return call(runtime, receiver, VIEW, 'scrollTo', '(II)V', [x, y]);
        }
        const x = args[1] | 0, y = args[2] | 0;
        if (x === oldX && y === oldY) return;
        store(runtime, receiver, 'mScrollX', x); store(runtime, receiver, 'mScrollY', y);
        call(runtime, receiver, VIEW, 'onScrollChanged', '(IIII)V', [x, y, oldX, oldY]);
        platform.requestDraw(runtime, receiver); return;
      }
      if (name === 'requestLayout') return request(runtime, receiver);
      if (name === 'forceLayout') { view.layoutRequested = true; view.measureCache?.clear(); return; }
      if (name === 'isLayoutRequested') return view.layoutRequested === false ? 0 : 1;
      if (name === 'isLaidOut') return view.laidOut ? 1 : 0;
      if (name === 'isLayoutRtl') return view.layoutDirection === 1 ? 1 : 0;
      if (name === 'getLayoutDirection') return view.layoutDirection || 0;
      if (name === 'setLayoutDirection') { if (![0, 1, 2, 3].includes(args[1])) fail('Invalid layout direction'); view.layoutDirection = args[1] < 2 ? args[1] : args[1] === 2 ? runtime.object(view.parent || receiver).layoutDirection || 0 : 0; request(runtime, receiver); return; }
      if (name === 'getPaddingStart' || name === 'getPaddingEnd') return view.padding?.[name === 'getPaddingStart' ? view.layoutDirection === 1 ? 'right' : 'left' : view.layoutDirection === 1 ? 'left' : 'right'] || 0;
      if (name === 'addOnLayoutChangeListener') { const list = view.layoutListeners ||= []; if (!list.some(ref => ref.ref === args[1]?.ref)) list.push(args[1]); return; }
      if (name === 'removeOnLayoutChangeListener') { view.layoutListeners = (view.layoutListeners || []).filter(ref => ref.ref !== args[1]?.ref); return; }
      if (name === 'getBaseline') { if (runtime.isSubtype(view.type, 'Landroid/widget/TextView;')) { if (view.textBaseline == null) fail('Native TextView baseline requires actual font layout'); return view.textBaseline; } return -1; }
      if (name.startsWith('getMeasured')) { if (name === 'getMeasuredState') return ((view.measuredWidth || 0) & STATE) | (((view.measuredHeight || 0) >> 16) & (STATE >> 16)); const value = name.includes('Width') ? view.measuredWidth || 0 : view.measuredHeight || 0; return name.endsWith('AndState') ? value : value & SIZE; }
      if (['setLeft', 'setTop', 'setRight', 'setBottom'].includes(name)) {   // View.setLeft/..: move one edge of the frame (Compose's ripple host view), invalidate, notify a size change
        const bounds = view.bounds ||= { left: 0, top: 0, right: 0, bottom: 0 }, edge = name.slice(3).toLowerCase(), value = args[1] | 0;
        if (bounds[edge] === value) return;
        const oldWidth = bounds.right - bounds.left, oldHeight = bounds.bottom - bounds.top; bounds[edge] = value;
        const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top;
        if (width !== oldWidth || height !== oldHeight) call(runtime, receiver, VIEW, 'onSizeChanged', '(IIII)V', [width, height, oldWidth, oldHeight]);
        platform.requestDraw(runtime, receiver); return;
      }
      if (['getLeft', 'getTop', 'getRight', 'getBottom', 'getWidth', 'getHeight'].includes(name)) { const bounds = view.bounds || { left: 0, top: 0, right: 0, bottom: 0 }; return name === 'getWidth' ? bounds.right - bounds.left : name === 'getHeight' ? bounds.bottom - bounds.top : bounds[name.slice(3).toLowerCase()]; }
      if (name.startsWith('setMinimum')) { view[name === 'setMinimumWidth' ? 'minimumWidth' : 'minimumHeight'] = args[1]; store(runtime, receiver, name === 'setMinimumWidth' ? 'mMinWidth' : 'mMinHeight', args[1]); request(runtime, receiver); return; }
      if (name.startsWith('getMinimum') || name.startsWith('getSuggestedMinimum')) { const width = name.endsWith('Width'); let result = view[width ? 'minimumWidth' : 'minimumHeight'] || 0; if (name.startsWith('getSuggested') && view.backgroundDrawable) result = Math.max(result, call(runtime, view.backgroundDrawable, 'Landroid/graphics/drawable/Drawable;', width ? 'getMinimumWidth' : 'getMinimumHeight', '()I')); return result; }
      if (name === 'setMeasuredDimension') { measured(runtime, receiver, args[1], args[2]); return; }
      if (name === 'onMeasure') {
        if (runtime.isSubtype(view.type, 'Landroid/widget/TextView;')) return nativeTextMeasure(runtime, receiver, args[1], args[2]);
        if (runtime.isSubtype(view.type, 'Landroid/widget/ImageView;') && !runtime.classes.get('Landroid/widget/ImageView;')?.methods.has('onMeasure(II)V')) return imageMeasure(runtime, receiver, args[1], args[2]);
        if (runtime.isSubtype(view.type, 'Landroid/widget/ProgressBar;') && !runtime.classes.get('Landroid/widget/ProgressBar;')?.methods.has('onMeasure(II)V')) return progressMeasure(runtime, receiver, args[1], args[2]);
        for (const native of ['TextView', 'FrameLayout', 'LinearLayout', 'ScrollView', 'ImageView', 'ProgressBar']) if (runtime.isSubtype(view.type, `Landroid/widget/${native};`) && !runtime.classes.get(`Landroid/widget/${native};`)?.methods.has('onMeasure(II)V')) fail(`Original ${native}.onMeasure or its native text/graphics boundary is not installed`, { type: view.type });
        const width = call(runtime, receiver, VIEW, 'getSuggestedMinimumWidth', '()I'), height = call(runtime, receiver, VIEW, 'getSuggestedMinimumHeight', '()I');
        measured(runtime, receiver, algorithm(runtime, ALGORITHMS, 'getDefaultSize', '(II)I', [width, args[1]]), algorithm(runtime, ALGORITHMS, 'getDefaultSize', '(II)I', [height, args[2]])); return;
      }
      if (name === 'measure') {
        if (view.layoutModeOptical || view.parent && runtime.object(view.parent).layoutModeOptical) fail('Optical-bound measurement requires the original optical-insets layout path');
        const w = args[1], h = args[2], force = view.layoutRequested !== false, key = `${w}:${h}`; view.measureCache ||= new Map();
        const specChanged = view.oldWidthSpec !== w || view.oldHeightSpec !== h, exact = (w & 0xc0000000) === 0x40000000 && (h & 0xc0000000) === 0x40000000, matches = (view.measuredWidth & SIZE) === (w & 0x3fffffff) && (view.measuredHeight & SIZE) === (h & 0x3fffffff);
        const target = Number(platform.manifest?.usesSdk?.targetSdkVersion ?? platform.manifest?.usesSdk?.minSdkVersion ?? 1);
        if (force || specChanged && (target <= 23 || !exact || !matches)) {
          view.measuredDimensionSet = false; const cached = force || target < 19 ? null : view.measureCache.get(key);
          if (!cached) { call(runtime, receiver, VIEW, 'onMeasure', '(II)V', [w, h]); view.measureBeforeLayout = false; }
          else { measured(runtime, receiver, ...cached); view.measureBeforeLayout = true; }
          if (!view.measuredDimensionSet) runtime.throwJava('Ljava/lang/IllegalStateException;', 'onMeasure did not call setMeasuredDimension'); view.layoutRequired = true;
        }
        view.oldWidthSpec = w; view.oldHeightSpec = h;
        if (view.measureCache.size >= 128 && !view.measureCache.has(key)) view.measureCache.clear(); view.measureCache.set(key, [view.measuredWidth, view.measuredHeight]); return;
      }
      if (name === 'measureChild') return measureChild(runtime, receiver, args[1], args[2], 0, args[3], 0, false);
      if (name === 'measureChildWithMargins') return measureChild(runtime, receiver, args[1], args[2], args[3], args[4], args[5], true);
      if (name === 'measureChildren') { for (const child of view.children || []) if (runtime.object(child).visibility !== 8) measureChild(runtime, receiver, child, args[1], 0, args[2], 0, false); return; }
      if (name === 'onLayout') { for (const native of ['FrameLayout', 'LinearLayout', 'ScrollView']) if (runtime.isSubtype(view.type, `Landroid/widget/${native};`) && !runtime.classes.get(`Landroid/widget/${native};`)?.methods.has('onLayout(ZIIII)V')) fail(`Original ${native}.onLayout is not installed`); return; }
      if (name === 'onSizeChanged') return; // Original View base callback bodies are empty.
      if (name === 'layout') {
        if (view.measureBeforeLayout) { call(runtime, receiver, VIEW, 'onMeasure', '(II)V', [view.oldWidthSpec, view.oldHeightSpec]); view.measureBeforeLayout = false; }
        const next = { left: args[1], top: args[2], right: args[3], bottom: args[4] }, old = view.bounds || { left: 0, top: 0, right: 0, bottom: 0 }; if (next.right < next.left || next.bottom < next.top) fail('Invalid negative View bounds');
        const changed = Object.keys(next).some(key => old[key] !== next[key]); view.bounds = next; for (const [name, value] of Object.entries(next)) store(runtime, receiver, 'm' + name[0].toUpperCase() + name.slice(1), value);
        if (next.right - next.left !== old.right - old.left || next.bottom - next.top !== old.bottom - old.top) call(runtime, receiver, VIEW, 'onSizeChanged', '(IIII)V', [next.right - next.left, next.bottom - next.top, old.right - old.left, old.bottom - old.top]);
        if (changed || view.layoutRequired) { call(runtime, receiver, VIEW, 'onLayout', '(ZIIII)V', [changed ? 1 : 0, ...Object.values(next)]); for (const listener of [...(view.layoutListeners || [])]) call(runtime, listener, 'Landroid/view/View$OnLayoutChangeListener;', 'onLayoutChange', '(Landroid/view/View;IIIIIIII)V', [receiver, ...Object.values(next), ...Object.values(old)]); }
        view.layoutRequired = false; view.layoutRequested = false; view.laidOut = true; platform.drawableViewHost.afterLayout(runtime, receiver); return;
      }
      fail('Unsupported View layout operation ' + name);
    },
  };
}
