import { APKError } from './apk-error.js?v=94afba6d22ec';
// android.widget.Switch (API 28+ Switch.java: constructor attributes, onMeasure sizing, draw() layout of track and thumb,
// getThumbOffset/getThumbScrollRange, setChecked thumb animation). The thumb/track are the theme's original Drawables
// (switch_thumb_material_anim = AnimatedStateListDrawable of tinted 9-patches, switch_track_material = tinted shape) and are
// rasterized by the Skia drawable path together with the View background; the page only shows the raster.
const SWITCH = 'Landroid/widget/Switch;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', RECT = 'Landroid/graphics/Rect;', INSETS = 'Landroid/graphics/Insets;', TA = 'Landroid/content/res/TypedArray;', VIEW = 'Landroid/view/View;', CANVAS = 'Landroid/graphics/Canvas;';
const bits = new DataView(new ArrayBuffer(4)), floatBits = value => { bits.setFloat32(0, value, true); return bits.getInt32(0, true); }, bitsFloat = value => { bits.setInt32(0, value | 0, true); return bits.getFloat32(0, true); };
const keys = new Set([`${SWITCH}->setThumbPosition(F)V`, `${SWITCH}->getThumbPosition()F`]);
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
  const target = (runtime, receiver, state) => { for (const drawable of [state.thumb, state.track]) if (drawable) dispatch(runtime, DRAWABLE, 'setCallback', ['Landroid/graphics/drawable/Drawable$Callback;'], 'V', drawable, [receiver]); };
  const scrollRange = (runtime, state) => {
    if (!state.track) return 0;
    const pad = padding(runtime, state.track), insets = opticalInsets(runtime, state.thumb);
    return state.switchWidth - state.thumbWidth - pad.left - pad.right - insets.left - insets.right;
  };
  const thumbOffset = (runtime, receiver, state) => { const view = runtime.object(receiver), position = rtl(view) ? 1 - state.thumbPosition : state.thumbPosition; return Math.trunc(Math.fround(position * scrollRange(runtime, state)) + 0.5); };
  return {
    supports: key => keys.has(key),
    /** Switch(Context, AttributeSet, defStyleAttr): thumb, track, switchMinWidth, switchPadding, thumbTextPadding, splitTrack, thumbTint, trackTint. */
    attributes(runtime, receiver, attrsRef, defStyle) {
      const view = runtime.object(receiver), table = platform.resources?.frameworkTable;
      if (!is(runtime, view) || !table || !platform.resources.frameworkXml || !runtime.skia || !view.context) return;
      const names = ['thumb', 'track', 'switchMinWidth', 'switchPadding', 'thumbTextPadding', 'splitTrack', 'thumbTint', 'trackTint', 'thumbTintMode', 'trackTintMode', 'showText'];
      const ids = runtime.newArray('[I', names.length); runtime.object(ids).elements = names.map(name => table.findId('attr/' + name));
      const array = platform.styleBackend.obtain(runtime, platform.styleBackend.theme(runtime, view.context), attrsRef ?? null, ids, defStyle);
      try {
        const has = index => dispatch(runtime, TA, 'hasValue', ['I'], 'Z', array, [index]), dimension = index => dispatch(runtime, TA, 'getDimensionPixelSize', ['I', 'I'], 'I', array, [index, 0]);
        if (has(8) || has(9)) fail('Switch thumb/track tint modes require the original Switch tint application');
        if (has(10) && dispatch(runtime, TA, 'getBoolean', ['I', 'Z'], 'Z', array, [10, 0])) fail('Switch showText requires the original on/off text layouts');
        const state = { thumb: has(0) ? dispatch(runtime, TA, 'getDrawable', ['I'], DRAWABLE, array, [0]) : null, track: has(1) ? dispatch(runtime, TA, 'getDrawable', ['I'], DRAWABLE, array, [1]) : null,
          minWidth: dimension(2), switchPadding: dimension(3), thumbTextPadding: dimension(4), splitTrack: !!dispatch(runtime, TA, 'getBoolean', ['I', 'Z'], 'Z', array, [5, 0]), thumbWidth: 0, switchWidth: 0, switchHeight: 0, thumbPosition: view.checked ? 1 : 0, animator: null, bounds: null };
        for (const [index, key] of [[6, 'thumb'], [7, 'track']]) if (has(index) && state[key]) {
          state[key] = dispatch(runtime, DRAWABLE, 'mutate', [], DRAWABLE, state[key]);
          dispatch(runtime, DRAWABLE, 'setTintList', ['Landroid/content/res/ColorStateList;'], 'V', state[key], [dispatch(runtime, TA, 'getColorStateList', ['I'], 'Landroid/content/res/ColorStateList;', array, [index])]);
        }
        view.switchState = state; target(runtime, receiver, state);
      } finally { dispatch(runtime, TA, 'recycle', [], 'V', array); }
    },
    /** Switch.onMeasure part that sizes the switch (the text measure itself is the TextView path). */
    measure(runtime, receiver) {
      const state = st(runtime, receiver); if (!state) return null;
      let thumbWidth = 0, thumbHeight = 0;
      if (state.thumb) { const pad = padding(runtime, state.thumb); thumbWidth = dispatch(runtime, DRAWABLE, 'getIntrinsicWidth', [], 'I', state.thumb) - pad.left - pad.right; thumbHeight = dispatch(runtime, DRAWABLE, 'getIntrinsicHeight', [], 'I', state.thumb); }
      state.thumbWidth = thumbWidth;
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
      if (state.track) {
        if (state.splitTrack && state.thumb) fail('Switch splitTrack needs Canvas.clipRect(DIFFERENCE) on the drawable canvas');
        dispatch(runtime, DRAWABLE, 'draw', [CANVAS], 'V', state.track, [canvas]);
      }
      if (state.thumb) dispatch(runtime, DRAWABLE, 'draw', [CANVAS], 'V', state.thumb, [canvas]);
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
    invoke(runtime, method, args) {
      const state = st(runtime, args[0]); if (!state) fail('Switch widget used before construction');
      if (method.name === 'getThumbPosition') return floatBits(state.thumbPosition);
      state.thumbPosition = bitsFloat(args[1]); platform.requestDraw(runtime, args[0]);
    },
    get(runtime, receiver) { return st(runtime, receiver); },
  };
}
