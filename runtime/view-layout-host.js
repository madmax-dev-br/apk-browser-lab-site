import { APKError } from './apk-runtime.js?v=79581f96c833';
import { breakParagraphs } from './text-layout-native.js?v=79581f96c833';
import { measureSkiaParagraph } from './skia-paragraph.js?v=79581f96c833';
import { gcRoot, ephemeronMap } from './heap-gc.js?v=79581f96c833';
import { getVectorGraphics } from './vector-native.js?v=79581f96c833';
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
  // A layout requested on a tree that is not attached waits for its attach, but must not keep the tree alive: the views of a destroyed Activity that ask for a layout afterwards
  // (a late callback) were held for ever by this record. An ephemeron: the entry lives only while something else keeps its root alive.
  const detachedRoots = new Map();
  const rootFor = (runtime, receiver) => {
    const surface = platform.dialogWindowHost?.recordFor(runtime, receiver); if (surface) return surface.root;
    let ref = receiver; const seen = new Set();
    while (ref) { if (seen.has(ref.ref) || seen.size >= 4096) fail('Cyclic layout hierarchy'); seen.add(ref.ref); if (ref.ref === runtime.root?.ref) return runtime.root;
      const frame = platform.allFrames().find(frame => frame.root?.ref === ref.ref || frame.window && [runtime.object(frame.window).decor?.ref,runtime.object(frame.window).content?.ref].includes(ref.ref)); if (frame?.root) return frame.root;
      ref = runtime.object(ref).parent;
    }
    return null;
  };
  const request = (runtime, receiver) => {
    let ref = receiver; const seen = new Set();
    while (ref) {
      if (seen.has(ref.ref) || seen.size >= 4096) fail('Cyclic/excessive layout hierarchy'); seen.add(ref.ref); const object = runtime.object(ref);
      // View.requestLayout (android-13.0.0_r1): "if (mParent != null && !mParent.isLayoutRequested()) mParent.requestLayout()" is a virtual call. An ancestor whose class overrides
      // requestLayout() (TableLayout forces its rows, RelativeLayout marks its dependency graph dirty, GridLayout drops its cached axes, an app's own container) runs its override, whose
      // super.requestLayout() continues from there.
      if (ref !== receiver && object.layoutRequested === false && object.type && runtime.objectOverride(object.type, 'requestLayout()V')) { runtime.dispatch({ owner: object.type, name: 'requestLayout', signature: '()V', parameters: [], result: 'V' }, [ref], 'virtual'); return; }
      object.layoutRequested = true; object.measureCache?.clear(); ref = object.parent;
    }
    const root = rootFor(runtime, receiver); if (!root) return;
    if (!runtime.object(root).attached) { ephemeronMap(runtime, detachedRoots); detachedRoots.set(root.ref, root); return; }
    pendingRoots.set(root.ref,root); pending = true; schedule(runtime,root);
  };
  const schedule = (runtime, root) => {
    if (queuedRoots.has(root.ref)) return; queuedRoots.add(root.ref); queued = true;
    platform.queueTask(() => {
      queuedRoots.delete(root.ref); queued = queuedRoots.size > 0;
      if (pendingRoots.has(root.ref) && !runtime.object(root).attached) { pendingRoots.delete(root.ref); pending = pendingRoots.size > 0; ephemeronMap(runtime, detachedRoots); detachedRoots.set(root.ref, root); return; }   // detached since the request (a layout asked for while the window was being removed): it waits for an attach without being held
      if (!pendingRoots.has(root.ref) || platform.taskClosed) return;
      pendingRoots.delete(root.ref); pending = pendingRoots.size > 0;
      const rootView = runtime.object(root), frameRect = platform.systemBarsHost?.contentFrame(runtime, root), geometry = platform.dialogWindowHost?.geometry(runtime,root) ?? (frameRect ? { width: frameRect.right - frameRect.left, height: frameRect.bottom - frameRect.top } : null), device = platform.device ?? { widthDp: 411, heightDp: 840 }, parentW = algorithm(runtime, SPEC, 'makeMeasureSpec', '(II)I', [geometry?.width??device.widthDp, 0x40000000]), parentH = algorithm(runtime, SPEC, 'makeMeasureSpec', '(II)I', [geometry?.height??device.heightDp, 0x40000000]);
      const width = algorithm(runtime, CHILD, 'getChildMeasureSpec', '(III)I', [parentW, 0, geometry?.layoutWidth??rootView.layoutWidth??-1]), height = algorithm(runtime, CHILD, 'getChildMeasureSpec', '(III)I', [parentH, 0, geometry?.layoutHeight??rootView.layoutHeight??-1]);
      call(runtime,root,VIEW,'measure','(II)V',[width,height]); const view=runtime.object(root);
      // DecorView.onMeasure: a floating window under its theme's windowMinWidth is measured again at exactly that width
      const minWidth = platform.dialogWindowHost?.minWidth(runtime, root) ?? 0;
      if (minWidth > 0 && algorithm(runtime, SPEC, 'getMode', '(I)I', [width]) === (0x80000000 | 0) && (view.measuredWidth & SIZE) < minWidth) call(runtime,root,VIEW,'measure','(II)V',[algorithm(runtime, SPEC, 'makeMeasureSpec', '(II)I', [minWidth, 0x40000000]), height]);
      call(runtime,root,VIEW,'layout','(IIII)V',[0,0,view.measuredWidth&SIZE,view.measuredHeight&SIZE]); platform.requestDraw(runtime,root);
    }, 0, [root], { ui: true });
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
  // ImageView.onMeasure (android-13.0.0_r1): the drawable's intrinsic size plus the padding, at least the suggested minimum, resolved against the specs; with adjustViewBounds
  // the view takes the drawable's aspect ratio in the dimension(s) the spec leaves free, within maxWidth / maxHeight (resolveAdjustedSize).
  const imageMeasure = (runtime, receiver, wSpec, hSpec) => {
    const view = runtime.object(receiver), padding = view.padding || {}, drawable = view.imageDrawable, state = platform.imageViewApi.state(runtime, receiver);
    const pleft = padding.left || 0, pright = padding.right || 0, ptop = padding.top || 0, pbottom = padding.bottom || 0, EXACTLY = 0x40000000, AT_MOST = 0x80000000 | 0, MODE = 0xc0000000 | 0;
    let w = 0, h = 0, desiredAspect = 0, resizeWidth = false, resizeHeight = false;
    if (drawable) {
      w = call(runtime, drawable, 'Landroid/graphics/drawable/Drawable;', 'getIntrinsicWidth', '()I'); h = call(runtime, drawable, 'Landroid/graphics/drawable/Drawable;', 'getIntrinsicHeight', '()I'); if (w <= 0) w = 1; if (h <= 0) h = 1;
      if (state.adjustViewBounds) { resizeWidth = (wSpec & MODE) !== EXACTLY; resizeHeight = (hSpec & MODE) !== EXACTLY; desiredAspect = Math.fround(Math.fround(w) / Math.fround(h)); }
    }
    if (!(resizeWidth || resizeHeight)) {
      w += pleft + pright; h += ptop + pbottom;
      w = Math.max(w, call(runtime, receiver, VIEW, 'getSuggestedMinimumWidth', '()I')); h = Math.max(h, call(runtime, receiver, VIEW, 'getSuggestedMinimumHeight', '()I'));
      measured(runtime, receiver, algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [w, wSpec, 0]), algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [h, hSpec, 0])); return;
    }
    const adjusted = (desired, max, spec) => { const mode = spec & MODE, size = spec & 0x3fffffff; return mode === EXACTLY ? size : mode === AT_MOST ? Math.min(desired, size, max) : Math.min(desired, max); };
    const compat = Number(platform.manifest?.usesSdk?.targetSdkVersion ?? platform.manifest?.usesSdk?.minSdkVersion ?? 1) <= 17;   // sCompatAdjustViewBounds: targetSdk <= JELLY_BEAN_MR1
    let widthSize = adjusted(w + pleft + pright, state.maxWidth, wSpec), heightSize = adjusted(h + ptop + pbottom, state.maxHeight, hSpec);
    if (desiredAspect !== 0) {
      const actualAspect = Math.fround(Math.fround(widthSize - pleft - pright) / (heightSize - ptop - pbottom));
      if (Math.abs(actualAspect - desiredAspect) > 0.0000001) {
        let done = false;
        if (resizeWidth) {
          const newWidth = Math.trunc(Math.fround(desiredAspect * (heightSize - ptop - pbottom))) + pleft + pright;
          if (!resizeHeight && !compat) widthSize = adjusted(newWidth, state.maxWidth, wSpec);
          if (newWidth <= widthSize) { widthSize = newWidth; done = true; }
        }
        if (!done && resizeHeight) {
          const newHeight = Math.trunc(Math.fround((widthSize - pleft - pright) / desiredAspect)) + ptop + pbottom;
          if (!resizeWidth && !compat) heightSize = adjusted(newHeight, state.maxHeight, hSpec);
          if (newHeight <= heightSize) heightSize = newHeight;
        }
      }
    }
    measured(runtime, receiver, widthSize, heightSize);
  };
  // ProgressBar.onMeasure: the current drawable's intrinsic size inside minWidth / maxWidth / minHeight / maxHeight (progressBarApi.measureExtent), plus the padding.
  const progressMeasure = (runtime, receiver, wSpec, hSpec) => {
    const view = runtime.object(receiver), padding = view.padding || {};
    const [extentW, extentH] = platform.progressBarApi.measureExtent(runtime, receiver), dw = extentW + (padding.left || 0) + (padding.right || 0), dh = extentH + (padding.top || 0) + (padding.bottom || 0);
    measured(runtime, receiver, algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [dw, wSpec, 0]), algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [dh, hSpec, 0]));
  };
  /** TextUtils.ellipsize(text, paint, avail, where): the longest prefix / suffix (or both halves for MIDDLE) that fits next to the ellipsis character. */
  const ellipsizeLine = (runtime, line, font, avail, where) => {
    const width = text => runtime.skiaHost.measureText(text, font).width, ellipsis = '\u2026';
    avail -= width(ellipsis); if (avail < 0) return ellipsis;
    const longest = (fits, limit) => { let lo = 0, hi = line.length; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fits(mid) <= limit) lo = mid; else hi = mid - 1; } return lo; };
    if (where === 'END') return line.slice(0, longest(n => width(line.slice(0, n)), avail)) + ellipsis;
    if (where === 'START') return ellipsis + line.slice(line.length - longest(n => width(line.slice(line.length - n)), avail));
    const right = longest(n => width(line.slice(line.length - n)), avail / 2), rest = avail - width(line.slice(line.length - right));
    return line.slice(0, longest(n => width(line.slice(0, n)), rest)) + ellipsis + line.slice(line.length - right);
  };
  /** The colour the measured paragraph is rasterized with: the TextView's current text colour (its own or its theme's); the neutral grey only when no theme resolves one. */
  const paragraphColor = (runtime, receiver) => {
    const view = runtime.object(receiver);
    if (view.textColor != null) return typeof view.textColor === 'string' ? parseInt(view.textColor.replace('#', ''), 16) : view.textColor;
    try { const color = platform.composeCanvasHost?.textColor?.(runtime, receiver); return color == null ? 0xff757575 : color >>> 0; }
    catch (error) { if (error?.name === 'JavaException') throw error; return 0xff757575; }
  };
  /** Layout.Alignment of the paragraph from the horizontal part of TextView.getGravity (the view's own, or its style's: a Button's text is centred). */
  const textGravity = (runtime, receiver) => { const view = runtime.object(receiver); if (view.gravity != null) return view.gravity; try { return platform.composeCanvasHost?.textGravity?.(runtime, receiver) ?? 0x800033; } catch (error) { if (error?.name === 'JavaException') throw error; return 0x800033; } };
  const paragraphAlignment = (runtime, receiver) => { const view = runtime.object(receiver), gravity = textGravity(runtime, receiver), rtl = view.layoutDirection === 1, horizontal = gravity & 0x800007; return (horizontal & 7) === 1 ? 'center' : horizontal === 0x800005 ? (rtl ? 'left' : 'right') : horizontal === 5 ? 'right' : horizontal === 3 ? 'left' : 'start'; };
  /** TextView.getVerticalOffset(true): the space the vertical gravity leaves above the laid-out text inside the measured box (0 for Gravity.TOP or when the text fills the box). */
  const textVerticalOffset = (runtime, receiver) => {
    const view = runtime.object(receiver); if (view.textBlockHeight == null) return 0;
    const vertical = textGravity(runtime, receiver) & 0x70; if (vertical === 0x30) return 0;
    const box = ((view.measuredHeight || 0) & SIZE) - (view.textBoxPadding || 0), text = view.textBlockHeight;
    return text >= box ? 0 : vertical === 0x50 ? box - text : (box - text) >> 1;
  };
  const nativeTextMeasure = (runtime, receiver, wSpec, hSpec) => {
    if (!runtime.skia?.measureText) fail('Native text measurement requires the verified Skia CPU font backend');
    const switchState = platform.drawableViewHost.measureSwitch?.(runtime, receiver);
    // A property the native text path cannot draw stops the pass when the app set it from code; one the layout XML gave is reported under "XML attributes NOT APPLIED" and the text is drawn without it.
    const unsupported = platform.textViewApi.unsupportedRendering(runtime, receiver, (attribute, what) => platform.noteXmlAttributeNotApplied(runtime, attribute, runtime.object(receiver).xmlTag ?? runtime.object(receiver).type.slice(1, -1).replaceAll('/', '.'), `the native text path does not draw a TextView with ${what} yet`));
    if (unsupported) fail(`TextView ${unsupported} is set, and the native text path does not draw it yet`);
    const view = runtime.object(receiver), text = String(view.displayText ?? view.text ?? ''), lines = text.split('\n'); if (lines.length > 1024) fail('Native text line limit exceeded');
    // CompoundButton.onMeasure adds the button drawable's width (android:button of the widget's style). The lab's CheckBox and RadioButton load no button drawable from their style, so
    // their measured width is their text's: one without text (a check box or a radio button in a menu row or a list row) takes no room and shows nothing. Reported, once each.
    if (!text && !switchState && !view.buttonDrawable) for (const [name, mark] of [['CheckBox', 'check mark'], ['RadioButton', 'radio mark']]) if (runtime.isSubtype(view.type, `Landroid/widget/${name};`)) platform.noteFrameworkGap(runtime, `${name.toLowerCase()}-button-width`, `the button drawable of android.widget.${name} (android:button of its style, added to the width by CompoundButton.onMeasure): a ${name} without text measures 0 wide and shows no ${mark}`);
    const typeface = call(runtime, receiver, 'Landroid/widget/TextView;', 'getTypeface', '()Landroid/graphics/Typeface;'), info = runtime.skiaHost.resolveTypeface(typeface); view.textFontWeight = info.weight; view.textFontItalic = info.italic; const styled = platform.textViewApi.paragraphStyle(runtime, receiver), font = { textSize: view.textSize || 14, flags: 1, typefaceRef: typeface, ...(styled?.letterSpacing ? { letterSpacing: styled.letterSpacingEm } : {}) }, runs = lines.map(line => { const run = runtime.skiaHost.measureText(line, font); return styled && (styled.letterSpacing || styled.shadow || lines.length > 1) || info.custom ? { ...run, width: runtime.skiaHost.measureText(line, { ...font, hinting: 0 }).width } : run; });   // a styled text, or one in an app or system font, is drawn by the paragraph, which shapes with unhinted advances: its width is measured the same way
    const metrics = runs[0].metrics, padding = platform.drawableViewHost.compoundPadding?.(runtime,receiver) || view.padding || {}, includePadding = view.includeFontPadding !== false;
    let mode = algorithm(runtime, SPEC, 'getMode', '(I)I', [wSpec]), available = algorithm(runtime, SPEC, 'getSize', '(I)I', [wSpec]);
    // TextView.onMeasure: android:maxWidth / maxEms / width / ems cap the width the text may take before it wraps (unless the parent fixed the width), as an AT_MOST limit does.
    const limits = platform.textViewApi.sizeLimits(runtime, receiver);
    if (limits?.maxWidth != null && mode !== 0x40000000) { available = mode ? Math.min(available, limits.maxWidth) : limits.maxWidth; mode = 0x80000000 | 0; }
    // TextUtils.ellipsize for a single line: START / MIDDLE / END cut the line to the width left by the padding and put the ellipsis in the cut (marquee needs an animation and stays unsupported).
    view.ellipsizedText = null;
    const where = platform.textViewApi.ellipsizeKind(runtime, receiver);
    // A TextView with a property only its original Layout applies (textViewApi.layoutDrawn) is measured from that Layout and drawn by it, below.
    const drawnByLayout = text.length > 0 ? platform.textViewApi.layoutDrawn(runtime, receiver) : null;
    if (!drawnByLayout && where && where !== 'MARQUEE' && lines.length === 1 && (view.singleLine || view.maxLines === 1) && mode) {
      const room = available - (padding.left || 0) - (padding.right || 0);
      if (runs[0].width > room) { const cut = ellipsizeLine(runtime, lines[0], font, room, where); view.ellipsizedText = cut; lines[0] = cut; runs[0] = { ...runtime.skiaHost.measureText(cut, font), width: room }; }   // TextView.onMeasure sizes the view by the whole text (it overflowed: the width left by the parent), the ellipsized line is what is drawn in it
    }
    const top = includePadding ? Math.floor(metrics.bounds[1]) : Math.round(metrics.ascent), bottom = includePadding ? Math.ceil(metrics.bounds[3]) : Math.round(metrics.descent);
    const lineHeight = Math.max(1, Math.round(metrics.descent) - Math.round(metrics.ascent) + Math.round(metrics.leading || 0));
    let textHeight = bottom - top + (lines.length - 1) * lineHeight, textWidth = Math.ceil(Math.max(...runs.map(run => run.width)));
    const extents = platform.textViewApi.compoundExtents(runtime, receiver);   // TextView.onMeasure: the left / right drawables set a minimum height, the top / bottom ones a minimum width
    if (extents) { textHeight = Math.max(textHeight, extents.leftHeight, extents.rightHeight); textWidth = Math.max(textWidth, extents.topWidth, extents.bottomWidth); }
    let height = textHeight + (padding.top || 0) + (padding.bottom || 0), width = textWidth + (padding.left || 0) + (padding.right || 0), blockHeight = bottom - top + (lines.length - 1) * lineHeight;
    view.textRaster = null; view.textParagraph = null; view.textLayout = null;
    let paragraph = null, textLayout = null;
    let minWidth = Math.max(view.minimumWidth || 0, limits?.minWidth ?? 0), minHeight = view.minimumHeight || 0;
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

    view.textBreakText = null;
    // An app font is drawn by Skia in every case: the DOM preview only has Roboto, so the text is laid out as a paragraph and its raster replaces the DOM glyphs (the way multi-line text already is).
    const appFont = !!info.custom && !view.singleLine && !where && lines.length <= 64 && !view.horizontallyScrolling;
    // Letter spacing, a shadow layer and line spacing are drawn by the paragraph (textViewApi.paragraphStyle); line spacing changes nothing on a single line.
    const styledText = !!styled && text.length > 0 && lines.length <= 64 && (!!styled.letterSpacing || !!styled.shadow || lines.length > 1);
    if (drawnByLayout) {
      // TextView.onMeasure over the original Layout: the width the text wants is Layout.getDesiredWidth (the widest line, laid out unbounded); the Layout is then built at the
      // width the view gets inside its padding (unbounded for a horizontally scrolling text, with the view's width for the ellipsis) and its height is the text's.
      const LAYOUT = 'Landroid/text/Layout;', desired = Math.ceil(platform.textViewApi.desiredTextWidth(runtime, receiver));
      textWidth = desired; if (extents) textWidth = Math.max(textWidth, extents.topWidth, extents.bottomWidth);
      width = textWidth + (padding.left || 0) + (padding.right || 0);
      const finalWidth = algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [Math.max(mode === 0x40000000 || mode && width > available ? available : width, minWidth), wSpec, 0]) & SIZE;
      const inner = Math.max(0, finalWidth - (padding.left || 0) - (padding.right || 0));
      // A line-break configuration this text backend cannot run (a strict or loose style under the greedy breaker; the phrase word style for Japanese or Korean text): the
      // layout XML's is reported and the text is broken without it; one the app set from code stops the pass with the reason, as every such property does.
      let layout; if (view.tv) view.tv.layoutLineBreakOff = false;
      try { layout = platform.textViewApi.layoutFor(runtime, receiver, inner); }
      catch (error) {
        const attribute = view.tv?.xmlGiven?.get('lineBreakStyle') ?? view.tv?.xmlGiven?.get('lineBreakWordStyle');
        if (error?.name !== 'APKError' || !/LineBreakConfig\./.test(String(error.message)) || !attribute) throw error;
        platform.noteXmlAttributeNotApplied(runtime, attribute, view.xmlTag ?? view.type.slice(1, -1).replaceAll('/', '.'), String(error.message).slice(String(error.message).indexOf('LineBreakConfig.')).replace(/\s+/g, ' ').slice(0, 300));
        view.tv.layoutLineBreakOff = true; layout = platform.textViewApi.layoutFor(runtime, receiver, inner);
      }
      blockHeight = call(runtime, layout, LAYOUT, 'getHeight', '(Z)I', [1]);
      textHeight = blockHeight; if (extents) textHeight = Math.max(textHeight, extents.leftHeight, extents.rightHeight);
      height = textHeight + (padding.top || 0) + (padding.bottom || 0); width = Math.min(width, finalWidth);
      // the default style's (or the XML's) optimal break strategy without the ICU iterator: broken greedily (textViewApi.layoutFor), and said as for the native paragraph below
      const strategy = platform.textViewApi.breakStrategy(runtime, receiver), given = view.tv?.xmlBreakStrategy === strategy ? view.tv.xmlGiven?.get('breakStrategy') : null;
      if (strategy > 0 && given && typeof runtime.icuBreakBackend?.breaks !== 'function') {
        const tag = view.xmlTag ?? view.type.slice(1, -1).replaceAll('/', '.'), reason = 'Optimal line breaking needs the original ICU line-break iterator';
        if (given === 'default') platform.viewXmlAttributes.kit.noteNoEffect(runtime, 'breakStrategy', tag, `the default TextView style asks for optimal line breaking (${reason}); the text is broken greedily, the value is kept for the TextView API`); else platform.noteXmlAttributeNotApplied(runtime, 'breakStrategy', tag, reason);
      }
      textLayout = { reason: drawnByLayout, inner, height: blockHeight, desired, lineCount: call(runtime, layout, LAYOUT, 'getLineCount', '()I'), baseline: call(runtime, layout, LAYOUT, 'getLineBaseline', '(I)I', [0]) };
    } else if (mode && width > available && !view.singleLine && !view.horizontallyScrolling || view.maxLines != null && lines.length > view.maxLines || appFont || styledText) {
      const desiredWidth = width, paragraphWidth = mode === 0x40000000 || mode && desiredWidth > available ? available : desiredWidth, contentWidth = paragraphWidth - (padding.left || 0) - (padding.right || 0) + ((appFont || styledText) && width <= available ? 1 : 0);   // 1px of slack: the shaper's unhinted advances must not wrap a line the hinted run measure just fit
      // Layout.BREAK_STRATEGY_HIGH_QUALITY / BALANCED: Minikin's optimal breaker decides the lines, SkParagraph then lays out one hard line per entry
      const strategy = platform.textViewApi.breakStrategy(runtime, receiver); let brokenText = null;
      if (strategy > 0 && !text.includes('\t')) {
        // A strategy the constructor read (the layout XML, or the theme's default TextView style, which asks for high_quality) that this text backend cannot run is reported,
        // and the text is broken greedily: under "NOT APPLIED" when the tag or its style gave it, under "no effect in this VM" when only the default style did.
        const given = view.tv?.xmlBreakStrategy === strategy ? view.tv.xmlGiven?.get('breakStrategy') : null /* one set from code is not the constructor's */, tag = view.xmlTag ?? view.type.slice(1, -1).replaceAll('/', '.');
        const unavailable = reason => { if (given === 'default') platform.viewXmlAttributes.kit.noteNoEffect(runtime, 'breakStrategy', tag, `the default TextView style asks for optimal line breaking (${reason}); the text is broken greedily, the value is kept for the TextView API`); else platform.noteXmlAttributeNotApplied(runtime, 'breakStrategy', tag, reason); };
        if (given && typeof runtime.icuBreakBackend?.breaks !== 'function') unavailable('Optimal line breaking needs the original ICU line-break iterator');
        else try { brokenText = breakParagraphs(runtime, text, { textSize: font.textSize, weight: info.weight, italic: info.italic, locale: 'en-US' }, contentWidth, strategy, platform.textViewApi.hyphenationFrequency(runtime, receiver)).join('\n'); }
        catch (error) {
          if (!given || error?.name !== 'APKError' || error.details?.kind !== 'text-layout-backend-unsupported') throw error;
          unavailable(String(error.message).replace(/\s+/g, ' ').slice(0, 200));
        }
      }
      if (brokenText !== null) view.textBreakText = brokenText;
      // StaticLayout with includeFontPadding: the first line starts at the font's top instead of its ascent and the last one ends at its bottom instead of its descent.
      // Roboto's line box is the regular face's at every weight (see measureSkiaParagraph); an app font brings its own.
      const box = info.custom ? metrics : runtime.skiaHost.measureText('', { textSize: font.textSize, flags: 1 }).metrics;
      const padTop = includePadding ? Math.max(0, Math.round(box.ascent) - Math.floor(box.bounds[1])) : 0, padBottom = includePadding ? Math.max(0, Math.ceil(box.bounds[3]) - Math.round(box.descent)) : 0;
      const extra = styled ? { letterSpacing: styled.letterSpacing, shadow: styled.shadow, lineSpacing: styled.lineSpacing && { ...styled.lineSpacing, firstTop: padTop } } : {};
      paragraph = measureSkiaParagraph(runtime.skia, brokenText ?? text, { width: contentWidth, textSize: font.textSize, weight: info.weight, italic: info.italic, families: info.families ?? null, fontVariations: info.fontVariations ?? null, nativeTypeface: info.custom ? info.face : null, direction: view.layoutDirection || 0, maxLines: view.maxLines ?? null, ellipsis: where === 'END' && view.maxLines != null ? '\u2026' : null, color: paragraphColor(runtime, receiver), alignment: paragraphAlignment(runtime, receiver), raster: true, ...extra });
      width = paragraphWidth;
      blockHeight = Math.ceil(paragraph.height) + padTop + padBottom;
      height = blockHeight + (padding.top || 0) + (padding.bottom || 0);
      view.textRaster = paragraph.raster;
      const { raster, ...rest } = paragraph; view.textParagraph = { ...rest, padTop, padBottom, extra };
    }
    if (view.minLines != null) {
      if (!Number.isInteger(view.minLines) || view.minLines < 0 || view.minLines > 1024) fail('Native text minimum lines exceeds the supported 0..1024 range');
      height = Math.max(height, bottom - top + (Math.max(1, view.minLines) - 1) * lineHeight + (padding.top || 0) + (padding.bottom || 0));
    }
    // getDesiredHeight: android:maxHeight / height, then android:minHeight / height (pixels, padding included); android:minWidth / minEms / width / ems with the View's minimum
    if (limits?.maxHeight != null) height = Math.min(height, limits.maxHeight);
    if (limits?.minHeight != null) height = Math.max(height, limits.minHeight);
    let resolvedHeight = algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [Math.max(height, minHeight), hSpec, 0]);
    // Switch.onMeasure: after the TextView measure, the height is raised to the switch's own height.
    if (switchState && (resolvedHeight & SIZE) < switchState.switchHeight) resolvedHeight = switchState.switchHeight;
    measured(runtime, receiver, algorithm(runtime, ALGORITHMS, 'resolveSizeAndState', '(III)I', [Math.max(width, minWidth), wSpec, 0]), resolvedHeight);
    view.textBaseline = (padding.top || 0) - top; view.textLineHeight = Math.max(lineHeight, bottom - top); view.textMetrics = { width, height, baseline: view.textBaseline, lineHeight: view.textLineHeight, fontSize: font.textSize, glyphCount: runs.reduce((sum, run) => sum + run.glyphCount, 0), source: runs[0].source, scope: 'simple Latin; no paragraph shaping/fallback' };
    view.textBlockHeight = blockHeight; view.textBoxPadding = (padding.top || 0) + (padding.bottom || 0);   // what TextView.getVerticalOffset needs: the height of the laid-out text and the padding around its box
    if (textLayout) {
      // The text raster the page shows for this view (the DOM has neither the font features nor the scale, the justification or the fonts of the Layout): the Layout drawn into
      // the box inside the padding, at the place the vertical gravity gives it. On a Canvas the Layout draws itself (compose-canvas-host.js drawNativeText).
      view.textLayout = textLayout; view.textBaseline = (padding.top || 0) + textLayout.baseline; view.textMetrics = { ...view.textMetrics, width, height, baseline: view.textBaseline, lineCount: textLayout.lineCount, source: 'original android.text.StaticLayout over the native measured text', scope: 'drawn by Layout.draw (' + textLayout.reason + ')' };
      const boxWidth = textLayout.inner, boxHeight = Math.max(0, (view.measuredHeight & SIZE) - (padding.top || 0) - (padding.bottom || 0));
      if (boxWidth > 0 && boxHeight > 0 && boxWidth <= 4096 && boxHeight <= 4096 && platform.composeCanvasHost?.drawTextLayout) {
        const CANVAS = 'Landroid/graphics/Canvas;', color = paragraphColor(runtime, receiver) | 0, layout = platform.textViewApi.layoutFor(runtime, receiver, textLayout.inner), key = `${layout.ref}|${color}|${boxWidth}|${boxHeight}|${textGravity(runtime, receiver)}`;
        if (view.textLayoutRasterKey !== key || !view.textLayoutRaster) {
          const BITMAP = 'Landroid/graphics/Bitmap;', CONFIG = 'Landroid/graphics/Bitmap$Config;', bitmap = call(runtime, null, BITMAP, 'createBitmap', `(II${CONFIG})${BITMAP}`, [boxWidth, boxHeight, runtime.readStatic({ owner: CONFIG, name: 'ARGB_8888', type: CONFIG, key: `${CONFIG}->ARGB_8888:${CONFIG}` })], 'static');
          try {
            const canvas = runtime.allocate(CANVAS); call(runtime, canvas, CANVAS, '<init>', `(${BITMAP})V`, [bitmap], 'direct');
            platform.composeCanvasHost.drawTextLayout(runtime, receiver, canvas, { left: 0, top: 0, innerWidth: boxWidth, innerHeight: boxHeight, color });
            view.textLayoutRaster = getVectorGraphics(runtime).snapshotCanvas(canvas, boxWidth, boxHeight); view.textLayoutRasterKey = key;
          } finally { call(runtime, bitmap, BITMAP, 'recycle', '()V'); }
        }
        view.textRaster = view.textLayoutRaster; view.textParagraph = { layoutDrawn: true, padTop: 0, padBottom: 0, height: boxHeight, layoutWidth: boxWidth, lineCount: textLayout.lineCount };
      }
    }
    // TextView.startMarquee: the scroll of a marquee is an animation the native text path does not run. One that Android would run now (the view is focused or selected and
    // its single line is wider than the view) is reported when the layout XML asked for the marquee, and stops the pass when the app set it from code, as before.
    if (where === 'MARQUEE') {
      const natural = textLayout ? textLayout.desired : Math.max(...runs.map(run => run.width)), room = (view.measuredWidth & SIZE) - (padding.left || 0) - (padding.right || 0);
      if (platform.textViewApi.marqueeWouldRun(runtime, receiver, lines.length === 1 && natural > room)) {
        const what = 'a running marquee (the view is focused or selected and its line is wider than the view) needs the per-frame scroll of TextView.Marquee, which the native text path does not run: the line is drawn at rest';
        if (view.tv?.xmlGiven?.get('ellipsize')) platform.noteXmlAttributeNotApplied(runtime, 'ellipsize', view.xmlTag ?? view.type.slice(1, -1).replaceAll('/', '.'), what); else fail(`TextView ellipsize: ${what}`);
      }
    }
    if (paragraph) { view.textBaseline = (padding.top || 0) + view.textParagraph.padTop + Math.round(paragraph.baseline); view.textMetrics = { ...view.textMetrics, width, height, baseline: view.textBaseline, source: paragraph.source, scope: paragraph.scope, lineCount: paragraph.lineCount }; }
    runtime.record(paragraph ? 'MEASURE native paragraph: official SkParagraph/Roboto + original AOSP size constraints' : 'MEASURE native text: actual Skia/Roboto glyph metrics + original AOSP size constraints');
    // TextView.autoSizeText (Android runs it from onLayout with the measured size and lays the text out again): the largest of the configured sizes whose layout fits the
    // space inside the padding (findLargestTextSizeWhichFits / suggestedSizeFitsInSpace: not more lines than maxLines, not taller than the space). The text is measured again with it.
    const sizes = view.autoSizing ? null : platform.textViewApi.autoSizeSizes(runtime, receiver);
    if (sizes?.length && text.length) {
      const availableWidth = view.horizontallyScrolling ? 4096 : Math.min(4096, (view.measuredWidth & SIZE) - (padding.left || 0) - (padding.right || 0)), availableHeight = (view.measuredHeight & SIZE) - (padding.top || 0) - (padding.bottom || 0);
      if (availableWidth > 0 && availableHeight > 0) {
        const fits = size => {
          const box = runtime.skiaHost.measureText('', info.custom ? { ...font, textSize: size } : { textSize: size, flags: 1 }).metrics;
          const padTop = includePadding ? Math.max(0, Math.round(box.ascent) - Math.floor(box.bounds[1])) : 0, padBottom = includePadding ? Math.max(0, Math.ceil(box.bounds[3]) - Math.round(box.descent)) : 0;
          const layout = measureSkiaParagraph(runtime.skia, text, { width: availableWidth, textSize: size, weight: info.weight, italic: info.italic, families: info.families ?? null, fontVariations: info.fontVariations ?? null, nativeTypeface: info.custom ? info.face : null, direction: view.layoutDirection || 0, alignment: paragraphAlignment(runtime, receiver),
            letterSpacing: styled ? styled.letterSpacingEm * size : 0, lineSpacing: styled?.lineSpacing ? { ...styled.lineSpacing, firstTop: padTop } : null });
          return !(view.maxLines != null && layout.lineCount > view.maxLines) && Math.ceil(layout.height) + padTop + padBottom <= availableHeight;
        };
        let best = 0, low = 1, high = sizes.length - 1;
        while (low <= high) { const index = (low + high) >> 1; if (fits(sizes[index])) { best = low; low = index + 1; } else { high = index - 1; best = high; } }
        const optimal = sizes[best];
        if (optimal !== (view.textSize || 14)) { view.textSize = optimal; view.autoSizing = true; try { nativeTextMeasure(runtime, receiver, wSpec, hSpec); } finally { view.autoSizing = false; } }
      }
    }
  };
  return {
    supports: key => keys.has(key),
    rootReady(runtime, root) { if (!root) return; let type = runtime.object(root).type, source = runtime.dex.classes.has(type); const seen = new Set(); while (type && !seen.has(type)) { seen.add(type); if (runtime.classes.get(type)?.methods.has('onMeasure(II)V')) { source = true; break; } type = runtime.parent(type); } if (source || runtime.skia) request(runtime, root); },
    afterAttach(runtime, receiver, attached) { if(!attached&&pendingRoots.has(receiver.ref)){pendingRoots.delete(receiver.ref);pending=pendingRoots.size>0;} if (attached && (pending || detachedRoots.size)) { const root=rootFor(runtime,receiver); if(root&&detachedRoots.has(root.ref)){detachedRoots.delete(root.ref);pendingRoots.set(root.ref,root);pending=true;} if(root&&pendingRoots.has(root.ref))schedule(runtime,root); } },
    state: () => ({ pending, queued }),
    /** Which roots still wait for a measure/layout pass, whether the pass is queued as a task (the performTraversals of this VM) and whether the root is attached to a window. */
    /** Whether a layout pass of this window root is queued: ViewRootImpl.performTraversals measures and lays out before it dispatches the pre-draw listeners and draws. */
    layoutQueued: root => queuedRoots.has(root.ref) && pendingRoots.has(root.ref),
    detail: runtime => ({ pending, queued, roots: [...pendingRoots.values(), ...detachedRoots.values()].map(root => ({ ref: root.ref, type: runtime.object(root).type, attached: !!runtime.object(root).attached, queued: queuedRoots.has(root.ref) })) }),
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
      // View.setLayoutDirection: nothing for the raw value the View already has; else the raw value is kept and resolved at once (RTL only for an app with android:supportsRtl and
      // targetSdk 17+, INHERIT from the parent, LOCALE from the default locale); the relative padding, the LayoutParams' relative margins and the children that inherit follow
      // (view-xml-attributes.js applyLayoutDirection, which says once when a right-to-left View is laid out by the host containers, which do not mirror).
      if (name === 'setLayoutDirection') { if (![0, 1, 2, 3].includes(args[1])) fail('Invalid layout direction'); if ((view.layoutDirectionRaw ?? 2) === args[1]) return; if (platform.viewXmlAttributes) platform.viewXmlAttributes.applyLayoutDirection(runtime, receiver, args[1]); else { view.layoutDirectionRaw = args[1]; view.layoutDirection = args[1] < 2 ? args[1] : args[1] === 2 ? runtime.object(view.parent || receiver).layoutDirection || 0 : 0; } request(runtime, receiver); return; }
      if (name === 'getPaddingStart' || name === 'getPaddingEnd') return view.padding?.[name === 'getPaddingStart' ? view.layoutDirection === 1 ? 'right' : 'left' : view.layoutDirection === 1 ? 'left' : 'right'] || 0;
      if (name === 'addOnLayoutChangeListener') { const list = view.layoutListeners ||= []; if (!list.some(ref => ref.ref === args[1]?.ref)) list.push(args[1]); return; }
      if (name === 'removeOnLayoutChangeListener') { view.layoutListeners = (view.layoutListeners || []).filter(ref => ref.ref !== args[1]?.ref); return; }
      if (name === 'getBaseline') { if (runtime.isSubtype(view.type, 'Landroid/widget/ImageView;') && !runtime.classes.get('Landroid/widget/ImageView;')?.methods.has('getBaseline()I')) { const state = platform.imageViewApi.state(runtime, receiver); return state.baselineAlignBottom ? (view.measuredHeight || 0) & SIZE : state.baseline; /* ImageView.getBaseline */ } if (runtime.isSubtype(view.type, 'Landroid/widget/TextView;')) { return view.textBaseline == null ? -1 : view.textBaseline + textVerticalOffset(runtime, receiver); /* TextView.getBaseline: getBaselineOffset() (the padding plus the vertical gravity offset in the measured box) + the first line's baseline; with no Layout yet (not measured) it is View.getBaseline(), -1; ConstraintLayout/LinearLayout ask before the child's first measure */ } return -1; }
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
        // View.resolveRtlPropertiesIfNeeded (the first thing a measure pass does): a View that inherits its layout direction takes its parent's, and its relative padding and margins follow
        if (view.parent && (view.layoutDirectionRaw ?? 2) === 2 && platform.viewXmlAttributes) { const above = runtime.object(view.parent); if (above && ((above.layoutDirection === 1 ? 1 : 0) !== (view.layoutDirection === 1 ? 1 : 0)) && above.type && runtime.isSubtype(above.type, VIEW)) platform.viewXmlAttributes.applyLayoutDirection(runtime, receiver, 2); }
        if (view.layoutModeOptical || view.parent && runtime.object(view.parent).layoutModeOptical) fail('Optical-bound measurement requires the original optical-insets layout path');
        const w = args[1], h = args[2], force = view.layoutRequested !== false, key = `${w}:${h}`; view.measureCache ||= new Map();
        // View.measure -> resolveRtlPropertiesIfNeeded (android-13.0.0_r1): the layout params resolve for the view's layout direction (start / end margins, RelativeLayout's start / end
        // rules) and onRtlPropertiesChanged tells the class. Left-to-right is what everything starts as, so only a view whose direction differs from the last resolution does it.
        const direction = view.layoutDirection || 0;
        if ((view.rtlResolvedDirection ?? 0) !== direction) {
          view.rtlResolvedDirection = direction;
          if (runtime.objectOverride(view.type, 'onRtlPropertiesChanged(I)V')) call(runtime, receiver, VIEW, 'onRtlPropertiesChanged', '(I)V', [direction]);
        }
        if (view.layoutParams && (runtime.object(view.layoutParams).resolvedDirection ?? 0) !== direction) {
          const params = runtime.object(view.layoutParams); params.resolvedDirection = direction;
          call(runtime, view.layoutParams, 'Landroid/view/ViewGroup$LayoutParams;', 'resolveLayoutDirection', '(I)V', [direction]);
          if (view.margin) for (const edge of ['left', 'top', 'right', 'bottom']) view.margin[edge] = params.fields.get(`Landroid/view/ViewGroup$MarginLayoutParams;->${edge}Margin:I`) ?? view.margin[edge];
        }
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
        if (runtime.isSubtype(view.type, GROUP) && platform.viewGroupApi.layoutSuppressed(runtime, receiver)) return;   // ViewGroup.layout while suppressLayout(true)
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
