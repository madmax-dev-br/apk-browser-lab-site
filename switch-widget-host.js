import { APKError } from './apk-error.js?v=3e71109809bc';
// android.widget.Switch (API 28+ Switch.java: constructor attributes, onMeasure sizing, draw() layout of track and thumb,
// getThumbOffset/getThumbScrollRange, setChecked thumb animation). The thumb/track are the theme's original Drawables
// (switch_thumb_material_anim = AnimatedStateListDrawable of tinted 9-patches, switch_track_material = tinted shape) and are
// rasterized by the Skia drawable path together with the View background; the page only shows the raster.
const TINT = 'Landroid/content/res/ColorStateList;', BLEND = 'Landroid/graphics/BlendMode;';
const SWITCH = 'Landroid/widget/Switch;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', RECT = 'Landroid/graphics/Rect;', INSETS = 'Landroid/graphics/Insets;', TA = 'Landroid/content/res/TypedArray;', VIEW = 'Landroid/view/View;', CANVAS = 'Landroid/graphics/Canvas;';
const bits = new DataView(new ArrayBuffer(4)), floatBits = value => { bits.setFloat32(0, value, true); return bits.getInt32(0, true); }, bitsFloat = value => { bits.setInt32(0, value | 0, true); return bits.getFloat32(0, true); };
const MODE = 'Landroid/graphics/PorterDuff$Mode;', CHARS = 'Ljava/lang/CharSequence;', TYPEFACE = 'Landroid/graphics/Typeface;', CONTEXT = 'Landroid/content/Context;', PAINT = 'Landroid/graphics/Paint;';
const PORTER_TO_SKIA = { CLEAR: 0, SRC: 1, DST: 2, SRC_OVER: 3, DST_OVER: 4, SRC_IN: 5, DST_IN: 6, SRC_OUT: 7, DST_OUT: 8, SRC_ATOP: 9, DST_ATOP: 10, XOR: 11, ADD: 12, SCREEN: 14, OVERLAY: 15, DARKEN: 16, LIGHTEN: 17, MULTIPLY: 24 };
// The Switch API of android-13.0.0_r1 Switch.java beyond CompoundButton's: the thumb and track drawables with their tints, the on / off texts and whether they are shown, the
// sizes, the split track and the text appearance of the on / off text.
const keys = new Set(['setThumbPosition(F)V', 'getThumbPosition()F',
  ...['Thumb', 'Track'].flatMap(part => [`set${part}Drawable(${DRAWABLE})V`, `set${part}Resource(I)V`, `get${part}Drawable()${DRAWABLE}`, `set${part}TintList(${TINT})V`, `get${part}TintList()${TINT}`,
    `set${part}TintMode(${MODE})V`, `get${part}TintMode()${MODE}`, `set${part}TintBlendMode(${BLEND})V`, `get${part}TintBlendMode()${BLEND}`]),
  `setTextOn(${CHARS})V`, `getTextOn()${CHARS}`, `setTextOff(${CHARS})V`, `getTextOff()${CHARS}`, 'setShowText(Z)V', 'getShowText()Z', 'setSplitTrack(Z)V', 'getSplitTrack()Z',
  'setSwitchPadding(I)V', 'getSwitchPadding()I', 'setSwitchMinWidth(I)V', 'getSwitchMinWidth()I', 'setThumbTextPadding(I)V', 'getThumbTextPadding()I',
  `setSwitchTextAppearance(${CONTEXT}I)V`, `setSwitchTypeface(${TYPEFACE}I)V`, `setSwitchTypeface(${TYPEFACE})V`].map(member => `${SWITCH}->${member}`));
const fail = message => { throw new APKError(message, { kind: 'switch-widget-unsupported' }); };
export function createSwitchWidgetHost(platform, { dispatch, buttonGravity }) {
  const is = (runtime, view) => runtime.isSubtype(view.type, SWITCH);
  const rect = runtime => { const ref = runtime.allocate(RECT); dispatch(runtime, RECT, '<init>', [], 'V', ref, [], 'direct'); return ref; };
  const read = (runtime, ref, names, owner = RECT) => Object.fromEntries(names.map(name => [name, runtime.object(ref).fields.get(`${owner}->${name}:I`) ?? 0]));
  const padding = (runtime, drawable) => { if (!drawable) return { left: 0, top: 0, right: 0, bottom: 0 }; const out = rect(runtime); dispatch(runtime, DRAWABLE, 'getPadding', [RECT], 'Z', drawable, [out]); return read(runtime, out, ['left', 'top', 'right', 'bottom']); };
  const opticalInsets = (runtime, drawable) => drawable ? read(runtime, dispatch(runtime, DRAWABLE, 'getOpticalInsets', [], INSETS, drawable), ['left', 'top', 'right', 'bottom'], INSETS) : { left: 0, top: 0, right: 0, bottom: 0 };
  const hasText = view => String(view.text ?? '') !== '';
  const rtl = view => view.layoutDirection === 1;
  const st = (runtime, receiver) => runtime.object(receiver).switchState ?? null;
  const values = (runtime, receiver) => runtime.object(receiver).switchValues ??= { thumb: null, track: null, textOn: null, textOff: null, showText: true, minWidth: 0, switchPadding: 0, thumbTextPadding: 0, splitTrack: false,
    tint: { thumb: { list: null, hasList: false, mode: null, hasMode: false }, track: { list: null, hasList: false, mode: null, hasMode: false } }, textColors: null, textPaint: null, allCaps: false, layouts: {},
    thumbWidth: 0, switchWidth: 0, switchHeight: 0, thumbPosition: 0, animator: null, bounds: null };
  const target = (runtime, receiver, state) => { for (const drawable of [state.thumb, state.track]) if (drawable) dispatch(runtime, DRAWABLE, 'setCallback', ['Landroid/graphics/drawable/Drawable$Callback;'], 'V', drawable, [receiver]); };
  const scrollRange = (runtime, state) => {
    if (!state.track) return 0;
    const pad = padding(runtime, state.track), insets = opticalInsets(runtime, state.thumb);
    return state.switchWidth - state.thumbWidth - pad.left - pad.right - insets.left - insets.right;
  };
  const thumbOffset = (runtime, receiver, state) => { const view = runtime.object(receiver), position = rtl(view) ? 1 - state.thumbPosition : state.thumbPosition; return Math.trunc(Math.fround(position * scrollRange(runtime, state)) + 0.5); };
  return {
    supports: key => keys.has(key),
    /**
     * The state of a Switch (Switch.java's fields): what the constructor reads from R.styleable.Switch (widget-xml-attributes.js applySwitch) and what the Switch API sets. It
     * exists for every Switch; it becomes the render state (view.switchState: the VM measures and draws the track, the thumb and the on/off text) through activate().
     */
    values,
    /** The VM draws this Switch itself (a Skia backend and the framework's styles are present): the state becomes the render state, and the drawables call back into the View. */
    activate(runtime, receiver) { const view = runtime.object(receiver), state = values(runtime, receiver); state.thumbPosition = view.checked ? 1 : 0; view.switchState = state; target(runtime, receiver, state); },
    /** Switch.applyThumbTint / applyTrackTint: the tint list and blend mode on a mutated drawable. */
    applyTint(runtime, receiver, key) {
      const state = values(runtime, receiver), tint = state.tint[key];
      if (!state[key] || !(tint.hasList || tint.hasMode)) return;
      state[key] = dispatch(runtime, DRAWABLE, 'mutate', [], DRAWABLE, state[key]);
      if (tint.hasList) dispatch(runtime, DRAWABLE, 'setTintList', [TINT], 'V', state[key], [tint.list]);
      if (tint.hasMode) dispatch(runtime, DRAWABLE, 'setTintBlendMode', [BLEND], 'V', state[key], [tint.mode]);
      if (dispatch(runtime, DRAWABLE, 'isStateful', [], 'Z', state[key])) dispatch(runtime, DRAWABLE, 'setState', ['[I'], 'Z', state[key], [dispatch(runtime, VIEW, 'getDrawableState', [], '[I', receiver)]);
    },
    /** A new thumb or track drawable (the constructor, setThumbDrawable, setTrackDrawable): the callback moves to it and its tint is applied. */
    setDrawable(runtime, receiver, key, drawable) {
      const state = values(runtime, receiver), CALLBACK = 'Landroid/graphics/drawable/Drawable$Callback;';
      if (state[key]) dispatch(runtime, DRAWABLE, 'setCallback', [CALLBACK], 'V', state[key], [null]);
      state[key] = drawable || null;
      if (state[key] && runtime.object(receiver).switchState) dispatch(runtime, DRAWABLE, 'setCallback', [CALLBACK], 'V', state[key], [receiver]);
      this.applyTint(runtime, receiver, key);
    },
    /** Called where the default style used to be read: the constructor pass has read R.styleable.Switch already. */
    attributes() {},
    /** Switch.makeLayout for the on and the off text (android:showText): the original StaticLayout over the Switch's own TextPaint, as wide as the text. */
    textLayouts(runtime, receiver) {
      const state = values(runtime, receiver); if (!state.showText) return null;
      const PAINT = 'Landroid/text/TextPaint;', LAYOUT = 'Landroid/text/Layout;', BUILDER = 'Landroid/text/StaticLayout$Builder;', HEURISTIC = 'Landroid/text/TextDirectionHeuristic;';
      const paint = this.textPaint(runtime, receiver), make = key => {
        if (state.layouts[key]) return state.layouts[key];
        let text = state[key] ?? '';
        if (state.allCaps) {   // mSwitchTransformationMethod: AllCapsTransformationMethod over the on / off text
          const ALL_CAPS = 'Landroid/text/method/AllCapsTransformationMethod;';
          if (!runtime.classes.has(ALL_CAPS)) fail('The all-caps on / off text of a Switch needs android.text.method.AllCapsTransformationMethod');
          const method = runtime.allocate(ALL_CAPS); dispatch(runtime, ALL_CAPS, '<init>', [CONTEXT], 'V', method, [runtime.object(receiver).context], 'direct');
          text = dispatch(runtime, ALL_CAPS, 'getTransformation', [CHARS, VIEW], CHARS, method, [text, receiver]);
        }
        const length = typeof text === 'string' ? text.length : dispatch(runtime, CHARS, 'length', [], 'I', text);
        const heuristic = dispatch(runtime, 'Landroid/widget/TextView;', 'getTextDirectionHeuristic', [], HEURISTIC, receiver);
        const desired = runtime.dispatch({ owner: LAYOUT, name: 'getDesiredWidth', parameters: [CHARS, 'I', 'I', PAINT, HEURISTIC], result: 'F', signature: `(${CHARS}II${PAINT}${HEURISTIC})F` }, [text, 0, length, paint, heuristic], 'static');
        let builder = runtime.dispatch({ owner: BUILDER, name: 'obtain', parameters: [CHARS, 'I', 'I', PAINT, 'I'], result: BUILDER, signature: `(${CHARS}II${PAINT}I)${BUILDER}` }, [text, 0, length, paint, Math.ceil(bitsFloat(desired))], 'static');
        builder = dispatch(runtime, BUILDER, 'setUseLineSpacingFromFallbacks', ['Z'], BUILDER, builder, [Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1) >= 28 ? 1 : 0]);
        return state.layouts[key] = dispatch(runtime, BUILDER, 'build', [], 'Landroid/text/StaticLayout;', builder);
      };
      return { on: make('textOn'), off: make('textOff') };
    },
    /** Switch.mTextPaint: an anti-aliased TextPaint with the density of the display; setSwitchTextAppearance and setSwitchTypeface set its size and typeface. */
    textPaint(runtime, receiver) {
      const state = values(runtime, receiver); if (state.textPaint) return state.textPaint;
      const TEXT_PAINT = 'Landroid/text/TextPaint;', METRICS = 'Landroid/util/DisplayMetrics;', RESOURCES = 'Landroid/content/res/Resources;', paint = runtime.allocate(TEXT_PAINT); dispatch(runtime, TEXT_PAINT, '<init>', ['I'], 'V', paint, [1], 'direct');   // Paint.ANTI_ALIAS_FLAG
      const metrics = dispatch(runtime, RESOURCES, 'getDisplayMetrics', [], METRICS, dispatch(runtime, VIEW, 'getResources', [], RESOURCES, receiver));
      platform.styleBackend.put(runtime, paint, TEXT_PAINT, 'density', 'F', platform.styleBackend.get(runtime, metrics, METRICS, 'density', 'F'));
      return state.textPaint = paint;
    },
    /** Switch.onMeasure part that sizes the switch (the text measure itself is the TextView path). */
    measure(runtime, receiver) {
      const state = st(runtime, receiver); if (!state) return null;
      let thumbWidth = 0, thumbHeight = 0;
      if (state.thumb) { const pad = padding(runtime, state.thumb); thumbWidth = dispatch(runtime, DRAWABLE, 'getIntrinsicWidth', [], 'I', state.thumb) - pad.left - pad.right; thumbHeight = dispatch(runtime, DRAWABLE, 'getIntrinsicHeight', [], 'I', state.thumb); }
      const layouts = this.textLayouts(runtime, receiver), LAYOUT = 'Landroid/text/Layout;';
      const maxTextWidth = layouts ? Math.max(dispatch(runtime, LAYOUT, 'getWidth', [], 'I', layouts.on), dispatch(runtime, LAYOUT, 'getWidth', [], 'I', layouts.off)) + state.thumbTextPadding * 2 : 0;
      state.thumbWidth = Math.max(maxTextWidth, thumbWidth);
      let trackHeight = 0, pad = { left: 0, top: 0, right: 0, bottom: 0 };
      if (state.track) { pad = padding(runtime, state.track); trackHeight = dispatch(runtime, DRAWABLE, 'getIntrinsicHeight', [], 'I', state.track); }
      let left = pad.left, right = pad.right;
      if (state.thumb) { const insets = opticalInsets(runtime, state.thumb); left = Math.max(left, insets.left); right = Math.max(right, insets.right); }
      state.switchWidth = Math.max(state.minWidth, 2 * state.thumbWidth + left + right); state.switchHeight = Math.max(trackHeight, thumbHeight);
      return state;
    },
    /** getCompoundPaddingLeft/Right: the switch and its text gap are reserved at the end of the line. */
    compoundPadding(runtime, receiver, base) {
      const state = st(runtime, receiver); if (!state) return null; const view = runtime.object(receiver), result = { left: 0, top: 0, right: 0, bottom: 0, ...base }, extra = state.switchWidth + (hasText(view) ? state.switchPadding : 0);
      result[rtl(view) ? 'left' : 'right'] += extra; return result;
    },
    /** Switch.draw(Canvas) + onDraw(): lay out track and thumb exactly like the framework, then draw them in that order. */
    draw(runtime, receiver, canvas, width, height) {
      const state = st(runtime, receiver); if (!state) return; const view = runtime.object(receiver), pad = view.padding || { left: 0, top: 0, right: 0, bottom: 0 };
      this.measure(runtime, receiver);
      let opticalLeft = 0, opticalRight = 0;
      if (state.thumb) { const trackPadding = padding(runtime, state.track), insets = opticalInsets(runtime, state.thumb); opticalLeft = Math.max(0, insets.left - trackPadding.left); opticalRight = Math.max(0, insets.right - trackPadding.right); }
      let switchLeft, switchRight;
      if (rtl(view)) { switchLeft = (pad.left || 0) + opticalLeft; switchRight = switchLeft + state.switchWidth - opticalLeft - opticalRight; }
      else { switchRight = width - (pad.right || 0) - opticalRight; switchLeft = switchRight - state.switchWidth + opticalLeft + opticalRight; }
      const vertical = buttonGravity(runtime, receiver) & 0x70; let switchTop, switchBottom;
      if (vertical === 0x10) { switchTop = Math.trunc(((pad.top || 0) + height - (pad.bottom || 0)) / 2) - Math.trunc(state.switchHeight / 2); switchBottom = switchTop + state.switchHeight; }
      else if (vertical === 0x50) { switchBottom = height - (pad.bottom || 0); switchTop = switchBottom - state.switchHeight; }
      else { switchTop = pad.top || 0; switchBottom = switchTop + state.switchHeight; }
      let thumbInitialLeft = switchLeft + thumbOffset(runtime, receiver, state);
      const thumbInsets = opticalInsets(runtime, state.thumb);
      if (state.track) {
        const trackPadding = padding(runtime, state.track); thumbInitialLeft += trackPadding.left;
        let trackLeft = switchLeft, trackTop = switchTop, trackRight = switchRight, trackBottom = switchBottom;
        if (thumbInsets.left > trackPadding.left) trackLeft += thumbInsets.left - trackPadding.left;
        if (thumbInsets.top > trackPadding.top) trackTop += thumbInsets.top - trackPadding.top;
        if (thumbInsets.right > trackPadding.right) trackRight -= thumbInsets.right - trackPadding.right;
        if (thumbInsets.bottom > trackPadding.bottom) trackBottom -= thumbInsets.bottom - trackPadding.bottom;
        dispatch(runtime, DRAWABLE, 'setBounds', ['I', 'I', 'I', 'I'], 'V', state.track, [trackLeft, trackTop, trackRight, trackBottom]);
      }
      let thumbLeft = 0, thumbRight = 0;
      if (state.thumb) {
        const thumbPadding = padding(runtime, state.thumb); thumbLeft = thumbInitialLeft - thumbPadding.left; thumbRight = thumbInitialLeft + state.thumbWidth + thumbPadding.right;
        dispatch(runtime, DRAWABLE, 'setBounds', ['I', 'I', 'I', 'I'], 'V', state.thumb, [thumbLeft, switchTop, thumbRight, switchBottom]);
        if (view.backgroundDrawable) dispatch(runtime, DRAWABLE, 'setHotspotBounds', ['I', 'I', 'I', 'I'], 'V', view.backgroundDrawable, [thumbLeft, switchTop, thumbRight, switchBottom]);
      }
      let innerTop = switchTop, innerBottom = switchBottom;
      if (state.track) {
        const trackPadding = padding(runtime, state.track); innerTop += trackPadding.top; innerBottom -= trackPadding.bottom;
        if (state.splitTrack && state.thumb) {   // Switch.onDraw: the track is not drawn under the thumb (the thumb's bounds inside its optical insets are cut out of the clip)
          const save = dispatch(runtime, CANVAS, 'save', [], 'I', canvas);
          dispatch(runtime, CANVAS, 'clipOutRect', ['I', 'I', 'I', 'I'], 'Z', canvas, [thumbLeft + thumbInsets.left, switchTop, thumbRight - thumbInsets.right, switchBottom]);
          dispatch(runtime, DRAWABLE, 'draw', [CANVAS], 'V', state.track, [canvas]);
          dispatch(runtime, CANVAS, 'restoreToCount', ['I'], 'V', canvas, [save]);
        } else dispatch(runtime, DRAWABLE, 'draw', [CANVAS], 'V', state.track, [canvas]);
      }
      if (state.thumb) dispatch(runtime, DRAWABLE, 'draw', [CANVAS], 'V', state.thumb, [canvas]);
      const layouts = this.textLayouts(runtime, receiver);
      if (layouts) {   // the on or the off text, centred on the thumb, in the colour of the Switch's drawable state
        const LAYOUT = 'Landroid/text/Layout;', layout = view.checked ? layouts.on : layouts.off, paint = this.textPaint(runtime, receiver);
        const colors = state.textColors ?? dispatch(runtime, 'Landroid/widget/TextView;', 'getTextColors', [], TINT, receiver);
        if (colors) dispatch(runtime, PAINT, 'setColor', ['I'], 'V', paint, [dispatch(runtime, TINT, 'getColorForState', ['[I', 'I'], 'I', colors, [dispatch(runtime, VIEW, 'getDrawableState', [], '[I', receiver), 0])]);
        const centre = state.thumb ? thumbLeft + thumbRight : width, left = Math.trunc(centre / 2) - Math.trunc(dispatch(runtime, LAYOUT, 'getWidth', [], 'I', layout) / 2), top = Math.trunc((innerTop + innerBottom) / 2) - Math.trunc(dispatch(runtime, LAYOUT, 'getHeight', [], 'I', layout) / 2);
        const save = dispatch(runtime, CANVAS, 'save', [], 'I', canvas);
        dispatch(runtime, CANVAS, 'translate', ['F', 'F'], 'V', canvas, [floatBits(left), floatBits(top)]);
        dispatch(runtime, LAYOUT, 'draw', [CANVAS], 'V', layout, [canvas]);
        dispatch(runtime, CANVAS, 'restoreToCount', ['I'], 'V', canvas, [save]);
      }
      state.bounds = { left: switchLeft, top: switchTop, right: switchRight, bottom: switchBottom };
      view.compoundPadding = this.compoundPadding(runtime, receiver, view.padding);
    },
    /** drawableStateChanged(): thumb and track follow the View's drawable state. */
    stateChanged(runtime, receiver) {
      const state = st(runtime, receiver); if (!state) return;
      for (const drawable of [state.thumb, state.track]) if (drawable && dispatch(runtime, DRAWABLE, 'isStateful', [], 'Z', drawable)) dispatch(runtime, DRAWABLE, 'setState', ['[I'], 'Z', drawable, [dispatch(runtime, VIEW, 'getDrawableState', [], '[I', receiver)]);
    },
    jump(runtime, receiver) { const state = st(runtime, receiver); if (!state) return; state.animator && dispatch(runtime, 'Landroid/animation/Animator;', 'end', [], 'V', state.animator); for (const drawable of [state.thumb, state.track]) if (drawable) dispatch(runtime, DRAWABLE, 'jumpToCurrentState', [], 'V', drawable); },
    /** Switch.setChecked tail: animate the thumb when attached and laid out, else jump. */
    checkedChanged(runtime, receiver, checked) {
      const state = st(runtime, receiver); if (!state) return; const view = runtime.object(receiver);
      if (state.animator) { dispatch(runtime, 'Landroid/animation/Animator;', 'cancel', [], 'V', state.animator); state.animator = null; }
      if (view.attached && view.laidOut) {
        const OA = 'Landroid/animation/ObjectAnimator;', array = runtime.newArray('[F', 1); runtime.object(array).elements = [floatBits(checked ? 1 : 0)];
        const animator = runtime.dispatch({ owner: OA, name: 'ofFloat', signature: '(Ljava/lang/Object;Ljava/lang/String;[F)Landroid/animation/ObjectAnimator;', parameters: ['Ljava/lang/Object;', 'Ljava/lang/String;', '[F'], result: OA }, [receiver, 'thumbPosition', array], 'static');
        runtime.dispatch({ owner: OA, name: 'setDuration', signature: `(J)${OA}`, parameters: ['J'], result: OA }, runtime.argumentWords(['J'], [250n], { receiver: animator }), 'virtual'); dispatch(runtime, OA, 'setAutoCancel', ['Z'], 'V', animator, [1]); dispatch(runtime, 'Landroid/animation/Animator;', 'start', [], 'V', animator);
        state.animator = animator;
      } else { state.thumbPosition = checked ? 1 : 0; platform.requestDraw(runtime, receiver); }
    },
    /** Switch.setSwitchTypeface(Typeface): the typeface of the on / off text. */
    setTypeface(runtime, receiver, typeface) {
      const paint = this.textPaint(runtime, receiver), next = typeface || null, current = dispatch(runtime, PAINT, 'getTypeface', [], TYPEFACE, paint) || null;
      if ((current?.ref ?? null) === (next?.ref ?? null)) return;
      dispatch(runtime, PAINT, 'setTypeface', [TYPEFACE], TYPEFACE, paint, [next]); this.changed(runtime, receiver, true);
    },
    /** Switch.setSwitchTypeface(Typeface, int style): the styled typeface, with fake bold and skew for the style bits the typeface does not have. */
    setTypefaceStyle(runtime, receiver, typeface, style) {
      const paint = this.textPaint(runtime, receiver); let tf = typeface || null, need = 0;
      if (style > 0) {
        tf = tf === null ? runtime.dispatch({ owner: TYPEFACE, name: 'defaultFromStyle', parameters: ['I'], result: TYPEFACE, signature: `(I)${TYPEFACE}` }, [style], 'static') : runtime.dispatch({ owner: TYPEFACE, name: 'create', parameters: [TYPEFACE, 'I'], result: TYPEFACE, signature: `(${TYPEFACE}I)${TYPEFACE}` }, [tf, style], 'static');
        this.setTypeface(runtime, receiver, tf);
        need = style & ~(tf ? dispatch(runtime, TYPEFACE, 'getStyle', [], 'I', tf) : 0);
      } else this.setTypeface(runtime, receiver, tf);
      dispatch(runtime, PAINT, 'setFakeBoldText', ['Z'], 'V', paint, [need & 1 ? 1 : 0]); dispatch(runtime, PAINT, 'setTextSkewX', ['F'], 'V', paint, [floatBits(need & 2 ? -0.25 : 0)]);
      this.changed(runtime, receiver, true);
    },
    /** A property of the Switch changed: the on / off layouts are made again when the text or its paint did, and the View is measured (requestLayout) or drawn (invalidate) again. */
    changed(runtime, receiver, text = false, layout = true) {
      const state = values(runtime, receiver); if (text) state.layouts = {};
      if (!runtime.object(receiver).switchState) return;
      if (layout) dispatch(runtime, VIEW, 'requestLayout', [], 'V', receiver); platform.requestDraw(runtime, receiver);
    },
    invoke(runtime, method, args) {
      const receiver = args[0], state = values(runtime, receiver), name = method.name, value = args[1], nullish = v => v === null || v === undefined || v === 0;
      if (name === 'getThumbPosition') return floatBits(state.thumbPosition);
      if (name === 'setThumbPosition') { state.thumbPosition = bitsFloat(value); platform.requestDraw(runtime, receiver); return; }
      const part = name.includes('Thumb') && !name.includes('ThumbTextPadding') ? 'thumb' : name.includes('Track') && name !== 'setSplitTrack' && name !== 'getSplitTrack' ? 'track' : null;
      if (part) {
        const tint = state.tint[part];
        if (/^set(Thumb|Track)Resource$/.test(name)) return dispatch(runtime, SWITCH, `set${name.slice(3, 8)}Drawable`, [DRAWABLE], 'V', receiver, [dispatch(runtime, CONTEXT, 'getDrawable', ['I'], DRAWABLE, runtime.object(receiver).context, [value])]);
        if (/^set(Thumb|Track)Drawable$/.test(name)) { this.setDrawable(runtime, receiver, part, nullish(value) ? null : value); this.changed(runtime, receiver); return; }
        if (/^get(Thumb|Track)Drawable$/.test(name)) return state[part] ?? null;
        if (name.endsWith('TintList')) { if (name.startsWith('get')) return tint.list ?? null; tint.list = nullish(value) ? null : value; tint.hasList = true; this.applyTint(runtime, receiver, part); this.changed(runtime, receiver, false, false); return; }
        if (name.endsWith('TintBlendMode')) { if (name.startsWith('get')) return tint.mode ?? null; tint.mode = nullish(value) ? null : value; tint.hasMode = true; this.applyTint(runtime, receiver, part); this.changed(runtime, receiver, false, false); return; }
        if (name.endsWith('TintMode')) {   // the PorterDuff.Mode forms of the blend mode
          if (name.startsWith('get')) return nullish(tint.mode) ? null : runtime.dispatch({ owner: BLEND, name: 'blendModeToPorterDuffMode', parameters: [BLEND], result: MODE, signature: `(${BLEND})${MODE}` }, [tint.mode], 'static');
          const blend = nullish(value) ? null : runtime.dispatch({ owner: BLEND, name: 'fromValue', parameters: ['I'], result: BLEND, signature: `(I)${BLEND}` }, [PORTER_TO_SKIA[runtime.object(value).enumName]], 'static');
          return dispatch(runtime, SWITCH, `set${name.slice(3, 8)}TintBlendMode`, [BLEND], 'V', receiver, [blend]);
        }
      }
      switch (name) {
        case 'getTextOn': return state.textOn ?? null; case 'getTextOff': return state.textOff ?? null;
        case 'setTextOn': state.textOn = nullish(value) ? null : value; this.changed(runtime, receiver, true); return;
        case 'setTextOff': state.textOff = nullish(value) ? null : value; this.changed(runtime, receiver, true); return;
        case 'getShowText': return state.showText ? 1 : 0;
        case 'setShowText': if (state.showText !== !!value) { state.showText = !!value; this.changed(runtime, receiver, true); } return;
        case 'getSplitTrack': return state.splitTrack ? 1 : 0;
        case 'setSplitTrack': state.splitTrack = !!value; this.changed(runtime, receiver, false, false); return;
        case 'getSwitchPadding': return state.switchPadding; case 'setSwitchPadding': state.switchPadding = value | 0; this.changed(runtime, receiver); return;
        case 'getSwitchMinWidth': return state.minWidth; case 'setSwitchMinWidth': state.minWidth = value | 0; this.changed(runtime, receiver); return;
        case 'getThumbTextPadding': return state.thumbTextPadding; case 'setThumbTextPadding': state.thumbTextPadding = value | 0; this.changed(runtime, receiver); return;
        case 'setSwitchTextAppearance': platform.viewXmlAttributes.switchTextAppearance(runtime, receiver, value, args[2] | 0); return;
        case 'setSwitchTypeface': if (method.parameters.length === 2) this.setTypefaceStyle(runtime, receiver, nullish(value) ? null : value, args[2] | 0); else this.setTypeface(runtime, receiver, nullish(value) ? null : value); return;
        default: fail(`Switch.${name}${method.signature} is not implemented`);
      }
    },
    get(runtime, receiver) { return st(runtime, receiver); },
  };
}
