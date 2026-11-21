import { APKError } from './apk-error.js?v=d826b7643adc';
import { snapshotPaintColorFilter } from './color-filter-native.js?v=d826b7643adc';
import { colorLongToArgb } from './color-long.js?v=d826b7643adc';

const PAINT = 'Landroid/graphics/Paint;';
const METRICS = 'Landroid/graphics/Paint$FontMetrics;', METRICS_INT = 'Landroid/graphics/Paint$FontMetricsInt;';
const PDX = 'Landroid/graphics/PorterDuffXfermode;', FILTER = 'Landroid/graphics/ColorFilter;', XFERMODE = 'Landroid/graphics/Xfermode;';
// Android 13 Paint.java HIDDEN_DEFAULT_PAINT_FLAGS: DEV_KERN | EMBEDDED_BITMAP | FILTER_BITMAP.
const HIDDEN_FLAGS = 0x100 | 0x400 | 0x2;
const nullish = value => value == null || value === 0;
const fail = message => { throw new APKError(message, { kind: 'paint-backend-unsupported' }); };
const bits = new DataView(new ArrayBuffer(4));
const float = raw => { bits.setInt32(0, raw, true); return bits.getFloat32(0, true); };
const rawFloat = value => { bits.setFloat32(0, value, true); return bits.getInt32(0, true); };
const paintHandles = new WeakMap();
function handleRegistry(runtime) { let state=paintHandles.get(runtime);if(!state){state={next:0x500000000n,values:new Map()};paintHandles.set(runtime,state);}return state; }
/** How many Paint.getNativeInstance() tokens are live (tests). */
export const paintTokenCount=runtime=>handleRegistry(runtime).values.size;
export function getPaintStateByHandle(runtime,handle){
  const reference=handleRegistry(runtime).values.get(handle);if(!reference)fail('Invalid VM Paint token; this is not a native memory address');
  return getPaintState(runtime,reference);
}
export function getSolidPaintByHandle(runtime,handle){const reference=handleRegistry(runtime).values.get(handle);if(!reference)fail('Invalid VM Paint token; this is not a native memory address');return getSolidPaint(runtime,reference);}
const initial = flags => ({ flags: (flags | HIDDEN_FLAGS), color: 0xff000000 | 0, colorFilter: null, xfermode: null, strokeWidth: 0, strokeMiter: 4, style: 0, strokeCap: 0, strokeJoin: 0, textSize: 12, textScaleX: 1, textSkewX: 0, letterSpacing: 0, wordSpacing: 0, hinting: 1, hyphenEdit: 0, textAlign: 0, elegantTextHeight: false, fontFeatureSettings: null, fontVariationSettings: null });
const keys = new Set([
  '<init>()V', '<init>(I)V', `<init>(${PAINT})V`, 'reset()V', `set(${PAINT})V`,
  'getNativeInstance()J', 'getTextLocale()Ljava/util/Locale;', 'getTextLocales()Landroid/os/LocaleList;', 'setTextLocale(Ljava/util/Locale;)V', 'setTextLocales(Landroid/os/LocaleList;)V',
  'getBlendMode()Landroid/graphics/BlendMode;', 'setBlendMode(Landroid/graphics/BlendMode;)V',
  'getColor()I', 'setColor(I)V', 'setColor(J)V', 'setARGB(IIII)V', 'getColorLong()J', 'getAlpha()I', 'setAlpha(I)V', 'getFlags()I', 'setFlags(I)V',
  'clearShadowLayer()V', 'setShadowLayer(FFFI)V', 'hasShadowLayer()Z',
  'getHinting()I', 'setHinting(I)V', 'getStartHyphenEdit()I', 'getEndHyphenEdit()I', 'setStartHyphenEdit(I)V', 'setEndHyphenEdit(I)V',
  'getTextBounds(Ljava/lang/String;IILandroid/graphics/Rect;)V', 'getTextBounds([CIILandroid/graphics/Rect;)V', 'getTextBounds(Ljava/lang/CharSequence;IILandroid/graphics/Rect;)V',
  'getRunAdvance([CIIIIZI)F', 'getRunAdvance(Ljava/lang/CharSequence;IIIIZI)F', 'getTextRunAdvances([CIIIIZ[FI)F',
  'getTextRunCursor([CIIZII)I', 'getTextRunCursor(Ljava/lang/CharSequence;IIZII)I', 'getTextRunCursor(Ljava/lang/String;IIZII)I',
  'getStrokeWidth()F', 'setStrokeWidth(F)V', 'getStrokeMiter()F', 'setStrokeMiter(F)V',
  `getColorFilter()${FILTER}`, `setColorFilter(${FILTER})${FILTER}`,
  `getXfermode()${XFERMODE}`, `setXfermode(${XFERMODE})${XFERMODE}`,
  'isAntiAlias()Z', 'setAntiAlias(Z)V', 'isDither()Z', 'setDither(Z)V', 'isFilterBitmap()Z', 'setFilterBitmap(Z)V'
].map(signature => PAINT + '->' + signature).concat([`${PDX}-><init>(Landroid/graphics/PorterDuff$Mode;)V`]));
for (const signature of [
  'getFontFeatureSettings()Ljava/lang/String;', 'setFontFeatureSettings(Ljava/lang/String;)V', 'getFontVariationSettings()Ljava/lang/String;', 'setFontVariationSettings(Ljava/lang/String;)Z',
  'isElegantTextHeight()Z', 'setElegantTextHeight(Z)V', 'getShadowLayerRadius()F', 'getShadowLayerDx()F', 'getShadowLayerDy()F', 'getShadowLayerColor()I',
  'hasGlyph(Ljava/lang/String;)Z', 'measureText(Ljava/lang/String;)F', 'measureText(Ljava/lang/String;II)F', 'measureText(Ljava/lang/CharSequence;II)F', 'measureText([CII)F',
  'getTextWidths(Ljava/lang/String;[F)I', 'getTextWidths(Ljava/lang/String;II[F)I', 'getTextWidths(Ljava/lang/CharSequence;II[F)I', 'getTextWidths([CII[F)I',
]) keys.add(PAINT + '->' + signature);
for (const signature of [
  `getFontMetrics()${METRICS}`, `getFontMetrics(${METRICS})F`,
  `getFontMetricsInt()${METRICS_INT}`, `getFontMetricsInt(${METRICS_INT})I`,
  'getFontSpacing()F', 'ascent()F', 'descent()F', 'getUnderlinePosition()F', 'getUnderlineThickness()F',
  'getStrikeThruPosition()F', 'getStrikeThruThickness()F',
  `getFontMetricsInt(Ljava/lang/CharSequence;IIIIZ${METRICS_INT})V`, `getFontMetricsInt([CIIIIZ${METRICS_INT})V`,
]) keys.add(PAINT + '->' + signature);
const enums = [
  ['Style', 'Style', 'style', ['FILL', 'STROKE', 'FILL_AND_STROKE']],
  ['StrokeCap', 'Cap', 'strokeCap', ['BUTT', 'ROUND', 'SQUARE']],
  ['StrokeJoin', 'Join', 'strokeJoin', ['MITER', 'ROUND', 'BEVEL']],
  ['TextAlign', 'Align', 'textAlign', ['LEFT', 'CENTER', 'RIGHT']],
];
for (const [suffix, nested] of enums) {
  keys.add(`${PAINT}->get${suffix}()Landroid/graphics/Paint$${nested};`);
  keys.add(`${PAINT}->set${suffix}(Landroid/graphics/Paint$${nested};)V`);
}
for (const suffix of ['TextSize', 'TextScaleX', 'TextSkewX', 'LetterSpacing', 'WordSpacing']) {
  keys.add(`${PAINT}->get${suffix}()F`); keys.add(`${PAINT}->set${suffix}(F)V`);
}
const flagMasks = [['AntiAlias', 1], ['Dither', 4], ['FilterBitmap', 2], ['UnderlineText', 8], ['StrikeThruText', 16], ['FakeBoldText', 32], ['LinearText', 64], ['SubpixelText', 128]];
for (const [suffix] of flagMasks) { keys.add(`${PAINT}->is${suffix}()Z`); keys.add(`${PAINT}->set${suffix}(Z)V`); }
const referenceEffects = ['Shader', 'PathEffect', 'MaskFilter'];
// android.graphics.DashPathEffect(float[] intervals, float phase) and CornerPathEffect(float radius): path effects the Skia backend applies to stroked paths (android-13.0.0_r1 DashPathEffect.java:
// "intervals array must contain at least 2 elements" and an even count). Other PathEffect subclasses fail explicitly when a paint carrying them draws.
const PATH_EFFECT = 'Landroid/graphics/PathEffect;', DASH = 'Landroid/graphics/DashPathEffect;', CORNER = 'Landroid/graphics/CornerPathEffect;';
// PathDashPathEffect(Path shape, float advance, float phase, Style style) (android-13.0.0_r1 PathDashPathEffect.java: nativeCreate(shape.readOnlyNI(), advance, phase, style.native_style),
// which is SkPath1DPathEffect::Make): the shape is copied when the effect is made, as the native does. Its Style enum is the original class in framework.dex.
// ComposePathEffect(PathEffect outerpe, PathEffect innerpe) keeps its two effects; the pinned CanvasKit exports no composed path effect, so a paint that carries one fails by name when it draws.
const PATH_DASH = 'Landroid/graphics/PathDashPathEffect;', PATH_DASH_STYLE = 'Landroid/graphics/PathDashPathEffect$Style;', COMPOSE_EFFECT = 'Landroid/graphics/ComposePathEffect;';
for (const key of [`${DASH}-><init>([FF)V`, `${CORNER}-><init>(F)V`, `${PATH_DASH}-><init>(Landroid/graphics/Path;FF${PATH_DASH_STYLE})V`, `${COMPOSE_EFFECT}-><init>(${PATH_EFFECT}${PATH_EFFECT})V`]) keys.add(key);
// android.graphics.MaskFilter and BlurMaskFilter(float radius, BlurMaskFilter.Blur style) (android-13.0.0_r1 BlurMaskFilter.java: native_instance = nativeConstructor(radius,
// style.native_int); libs/hwui/jni/MaskFilter.cpp createBlur: sigma = SkBlurMask::ConvertRadiusToSigma(radius), SkMaskFilter::MakeBlur((SkBlurStyle)style, sigma), and
// IllegalArgumentException when Skia makes no filter, which is a sigma that is not positive). The Skia backend applies it to what the paint draws; EmbossMaskFilter and other
// MaskFilter subclasses are not implemented and fail by name when instantiated.
const MASK_FILTER = 'Landroid/graphics/MaskFilter;', BLUR_FILTER = 'Landroid/graphics/BlurMaskFilter;';
export const BLUR_STYLE = 'Landroid/graphics/BlurMaskFilter$Blur;', BLUR_STYLE_NAMES = ['NORMAL', 'SOLID', 'OUTER', 'INNER'];   // the enum's order is its native_int: SkBlurStyle
export const BLUR_SIGMA_SCALE = 0.57735;   // SkBlurMask::ConvertRadiusToSigma: radius > 0 ? 0.57735f * radius + 0.5f : 0
for (const key of [`${MASK_FILTER}-><init>()V`, `${BLUR_FILTER}-><init>(F${BLUR_STYLE})V`]) keys.add(key);
const floatOf = bits => { const view = new DataView(new ArrayBuffer(4)); view.setInt32(0, bits | 0, true); return view.getFloat32(0, true); };
for (const effect of referenceEffects) { const type = `Landroid/graphics/${effect};`; keys.add(`${PAINT}->get${effect}()${type}`); keys.add(`${PAINT}->set${effect}(${type})${type}`); }

// On the WebAssembly core a paint's state lives in its Paint record (vmcore/paint.h): the color, the flags, the hyphen edits, the color long, the floats, the enums, hinting,
// elegant text height, mBidiFlags and every reference (shader, filters, xfermode, path effect, typeface, text locales), where the core's Paint natives answer the hot getters and
// setters, Paint.set and getNativeInstance without a host call. The state below is then bound to the record (vmcore/js/paint-record.js): getPaintState copies into it what a
// native changed (pull), and this host writes back what it changed (push, PUSHED below). Only the shadow layer, the font feature / variation settings and the locales' tag
// stay JavaScript-only. On the JavaScript VM the state is the only copy and both are no-ops.
const bound = (runtime, ref, state) => runtime.wasm?.paints ? runtime.wasm.paints.bind(ref, state) : state;
/** A copy of paint state `source` for Paint `ref` (Paint(Paint), Paint.set): its own fields, bound to its own record on the core. */
const copyOf = (runtime, ref, source) => runtime.wasm?.paints ? runtime.wasm.paints.bind(ref, source) : { ...source };
/** The state again from memory after this host ran Java (a natively answered setter on the same paint may have changed it meanwhile). */
const pull = (runtime, state, receiver) => { runtime.wasm?.paints?.pull(state, runtime.object(receiver)); return state; };
/** The methods after which the state goes back to memory: true when they may change a reference (the constructors and reset push their locales after binding). */
const PUSHED = new Map([
  ...['setColor', 'setARGB', 'setAlpha', 'setFlags', 'setStartHyphenEdit', 'setEndHyphenEdit', ...flagMasks.map(([suffix]) => 'set' + suffix), 'setHinting', 'setElegantTextHeight',
    'setShadowLayer', 'clearShadowLayer', 'setFontFeatureSettings', ...['StrokeWidth', 'StrokeMiter', 'TextSize', 'TextScaleX', 'TextSkewX', 'LetterSpacing', 'WordSpacing'].map(suffix => 'set' + suffix),
    ...enums.map(([suffix]) => 'set' + suffix)].map(name => [name, false]),
  ...['<init>', 'reset', 'setShader', 'setPathEffect', 'setMaskFilter', 'setColorFilter', 'setXfermode', 'setBlendMode', 'setTextLocale', 'setTextLocales', 'setFontVariationSettings']
    .map(name => [name, true]),
]);
/** After another host changed paint `receiver`'s state (the skia host's setTypeface): back to memory on the core, with its references. */
export function pushPaintState(runtime, receiver) { const paints = runtime.wasm?.paints; if (paints) { const object = runtime.object(receiver); paints.push(object.webPaint, object, true); } }

export function getPaintState(runtime, receiver) {
  if (nullish(receiver)) runtime.throwJava('Ljava/lang/NullPointerException;', 'Paint is null');
  const object = runtime.object(receiver), state = object.webPaint;
  if (!state) fail('Paint has not been initialized by the web graphics backend');
  return runtime.wasm?.paints ? runtime.wasm.paints.pull(state, object) : state;
}

function invokeLocale(runtime,owner,name,parameters,result,receiver,values=[],mode='virtual'){
 return runtime.dispatch({owner,name,parameters,result,signature:`(${parameters.join('')})${result}`},runtime.argumentWords(parameters,values,mode==='static'?{}:{receiver}),mode);
}
function sameTextLocales(runtime,a,b){const list='Landroid/os/LocaleList;',locale='Ljava/util/Locale;',count=invokeLocale(runtime,list,'size',[],'I',a);if(count!==invokeLocale(runtime,list,'size',[],'I',b))return false;for(let i=0;i<count;i++)if(!invokeLocale(runtime,locale,'equals',['Ljava/lang/Object;'],'Z',invokeLocale(runtime,list,'get',['I'],locale,a,[i]),[invokeLocale(runtime,list,'get',['I'],locale,b,[i])]))return false;return true;}
function initializeTextLocales(runtime,paint){
 const list='Landroid/os/LocaleList;',locale='Ljava/util/Locale;';paint.textLocalesRef=invokeLocale(runtime,list,'getAdjustedDefault',[],list,null,[],'static');
 paint.textLocaleTag=runtime.javaString(invokeLocale(runtime,locale,'toLanguageTag',[],'Ljava/lang/String;',invokeLocale(runtime,list,'get',['I'],locale,paint.textLocalesRef,[0])));
 noteLocaleTag(runtime,paint);
}
/** On the core: the language tag of the paint's LocaleList, kept on that list's companion (a string, not a reference), where a pull finds it after Paint.set's native copied
 *  the list (vmcore/js/paint-record.js). A LocaleList is immutable: its tag never changes. */
function noteLocaleTag(runtime,paint){if(runtime.wasm?.paints&&paint.textLocalesRef)runtime.object(paint.textLocalesRef).paintLocaleTag=paint.textLocaleTag;}

/** ARGB software-paint boundary. ColorDrawable state, alpha and mutation stay in original DEX. */
export function createPaintHost() {
  const paintHost = {
    supports: key => keys.has(key),
    canAllocate: type => type === PAINT || type === PDX || type === DASH || type === CORNER || type === PATH_DASH || type === COMPOSE_EFFECT || type === MASK_FILTER || type === BLUR_FILTER,
    parent: type => type === PAINT || type === PATH_EFFECT || type === MASK_FILTER ? 'Ljava/lang/Object;' : type === PDX ? XFERMODE : type === DASH || type === CORNER || type === PATH_DASH || type === COMPOSE_EFFECT ? PATH_EFFECT : type === BLUR_FILTER ? MASK_FILTER : null,
    invoke(runtime, method, args) {
      const result = paintHost.serve(runtime, method, args);
      if (method.owner === PAINT && runtime.wasm?.paints) { const references = PUSHED.get(method.name); if (references !== undefined) { const object = runtime.object(args[0]); runtime.wasm.paints.push(object.webPaint, object, references); } }
      return result;
    },
    serve(runtime, method, args) {
      const object = runtime.object(args[0]), name = method.name;
      if (method.owner === DASH) {
        const values = nullish(args[1]) ? null : runtime.array(args[1]).elements; if (values === null) runtime.throwJava('Ljava/lang/NullPointerException;', null);
        if (values.length < 2 || values.length % 2 !== 0) runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', 'intervals array must contain at least 2 elements');
        object.pathEffect = { dash: { intervals: values.map(floatOf), phase: floatOf(args[2]) } }; return;
      }
      if (method.owner === CORNER) { object.pathEffect = { corner: floatOf(args[1]) }; return; }
      if (method.owner === PATH_DASH) {
        if (nullish(args[1]) || nullish(args[4])) runtime.throwJava('Ljava/lang/NullPointerException;', null);   // shape.readOnlyNI(), style.native_style
        if (!runtime.skiaHost?.pathSnapshot) fail('PathDashPathEffect requires the Skia backend (the shape is a Skia path)');
        const shape = runtime.skiaHost.pathSnapshot(args[1]), style = runtime.object(args[4]).fields.get(`${PATH_DASH_STYLE}->native_style:I`);
        if (!Number.isInteger(style) || style < 0 || style > 2) fail('PathDashPathEffect needs the original PathDashPathEffect.Style enum');
        object.pathEffect = { path1d: { commands: Array.from(shape.commands), fillType: shape.fillType, advance: floatOf(args[2]), phase: floatOf(args[3]), style } }; return;
      }
      if (method.owner === COMPOSE_EFFECT) {
        if (nullish(args[1]) || nullish(args[2])) runtime.throwJava('Ljava/lang/NullPointerException;', null);   // outerpe.native_instance, innerpe.native_instance
        object.pathEffect = { compose: { outer: runtime.object(args[1]).pathEffect ?? null, inner: runtime.object(args[2]).pathEffect ?? null } }; return;
      }
      if (method.owner === MASK_FILTER) return;   // MaskFilter(): the base class holds no filter (native_instance 0)
      if (method.owner === BLUR_FILTER) {
        if (nullish(args[2])) runtime.throwJava('Ljava/lang/NullPointerException;', null);   // style.native_int
        const radius = floatOf(args[1]), style = runtime.object(args[2]).enumOrdinal | 0, sigma = radius > 0 ? Math.fround(Math.fround(BLUR_SIGMA_SCALE * radius) + 0.5) : 0;
        if (!(sigma > 0) || !Number.isFinite(sigma)) runtime.throwJava('Ljava/lang/IllegalArgumentException;', null);
        object.maskFilter = { blur: { radius, sigma, style } }; return;
      }
      if (method.owner === PDX) {
        // Original API28 PorterDuffXfermode(Mode): Xfermode.porterDuffMode = mode.nativeInt.
        if (nullish(args[1])) runtime.throwJava('Ljava/lang/NullPointerException;', 'mode is null');
        runtime.storeField(object.fields, `${XFERMODE}->porterDuffMode:I`, runtime.object(args[1]).fields.get('Landroid/graphics/PorterDuff$Mode;->nativeInt:I')); return;
      }
      if (name === '<init>') {
        object.webPaint = method.parameters[0] === PAINT ? copyOf(runtime, args[0], getPaintState(runtime, args[1])) : bound(runtime, args[0], initial(method.parameters.length ? args[1] : 1));
        runtime.storeField(object.fields,`${PAINT}->mBidiFlags:I`,method.parameters[0]===PAINT?(runtime.object(args[1]).fields.get(`${PAINT}->mBidiFlags:I`)??2):2);
        if(method.parameters[0]!==PAINT)initializeTextLocales(runtime,object.webPaint);
        return;
      }
      const paint = getPaintState(runtime, args[0]);
      if(['getTextLocale','getTextLocales','setTextLocale','setTextLocales'].includes(name)){
        const list='Landroid/os/LocaleList;',locale='Ljava/util/Locale;';
        if(name==='getTextLocales')return paint.textLocalesRef;
        if(name==='getTextLocale')return invokeLocale(runtime,list,'get',['I'],locale,paint.textLocalesRef,[0]);
        if(nullish(args[1]))runtime.throwJava('Ljava/lang/IllegalArgumentException;',name==='setTextLocale'?'locale cannot be null':'locales cannot be null or empty');
        let value=args[1];
        if(name==='setTextLocale'){if(invokeLocale(runtime,list,'size',[],'I',paint.textLocalesRef)===1&&invokeLocale(runtime,locale,'equals',['Ljava/lang/Object;'],'Z',value,[invokeLocale(runtime,list,'get',['I'],locale,paint.textLocalesRef,[0])]))return;const array=runtime.newArray('[Ljava/util/Locale;',1);runtime.array(array).elements=[value];value=runtime.allocate(list);invokeLocale(runtime,list,'<init>',['[Ljava/util/Locale;'],'V',value,[array],'direct');}
        else if(invokeLocale(runtime,list,'isEmpty',[],'Z',value))runtime.throwJava('Ljava/lang/IllegalArgumentException;','locales cannot be null or empty');
        if(sameTextLocales(runtime,value,paint.textLocalesRef))return;paint.textLocalesRef=value;paint.textLocaleTag=runtime.javaString(invokeLocale(runtime,locale,'toLanguageTag',[],'Ljava/lang/String;',invokeLocale(runtime,list,'get',['I'],locale,value,[0])));noteLocaleTag(runtime,paint);return;
      }
      if(name==='getNativeInstance'){
        // The token goes with its Java owner, as Paint's NativeAllocationRegistry frees the native Paint: a screen that makes Paints on every frame (text measured and drawn anew) must
        // not use the table up. A full table collects first, so the cleaners of unreachable Paints release theirs.
        const registry=handleRegistry(runtime);if(!object.paintHandle){if(registry.values.size>=65536)runtime.collectForNativeHandles?.('android.graphics.Paint');if(registry.values.size>=65536)fail('VM Paint token limit exceeded');const handle=object.paintHandle=registry.next++,previous=object.onFree;registry.values.set(handle,args[0]);object.onFree=()=>{if(typeof previous==='function')previous();registry.values.delete(handle);};runtime.wasm?.paints?.setToken(args[0],handle);}
        runtime.record('HOST Paint.getNativeInstance [opaque VM Paint token; not native memory]');return object.paintHandle;
      }
      if(name==='getStartHyphenEdit')return paint.hyphenEdit>>>3;
      if(name==='getEndHyphenEdit')return paint.hyphenEdit&7;
      if(name==='setStartHyphenEdit'){paint.hyphenEdit=(((args[1]&255)<<3)|(paint.hyphenEdit&7))&255;return;}
      if(name==='setEndHyphenEdit'){paint.hyphenEdit=(((paint.hyphenEdit>>>3)<<3)|(args[1]&255))&255;return;}
      if(name==='getTextBounds'){
        const text=args[1],isArray=method.parameters[0]==='[C';if(isArray&&(args[2]<0||args[3]<0))runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','Invalid text bounds range');if(nullish(text))runtime.throwJava('Ljava/lang/NullPointerException;','text is null');
        const length=isArray?runtime.array(text).elements.length:typeof text==='string'?text.length:runtime.dispatch({owner:runtime.typeOf(text),name:'length',parameters:[],result:'I',signature:'()I'},[text],'virtual');
        const from=args[2],to=isArray?from+args[3]:args[3];if(from<0||to<from||to>length)runtime.throwJava(isArray?'Ljava/lang/ArrayIndexOutOfBoundsException;':'Ljava/lang/IndexOutOfBoundsException;','Invalid text bounds range');
        if(nullish(args[4]))runtime.throwJava('Ljava/lang/NullPointerException;','need bounds Rect');const target=runtime.object(args[4]);if(!runtime.isSubtype(target.type,'Landroid/graphics/Rect;'))runtime.throwJava('Ljava/lang/ClassCastException;','Text bounds output requires Rect');
        if(to-from>65536)fail('Text bounds exceeds65536UTF16units');pull(runtime,paint,args[0]);if(paint.hyphenEdit)fail('Text bounds with Android hyphen editing requires a Minikin backend');
        let content='';
        if(typeof text==='string')content=text.slice(from,to);
        else{const array=isArray?runtime.array(text).elements.slice(from,to):(()=>{const ref=runtime.newArray('[C',to-from);runtime.dispatch({owner:'Landroid/text/TextUtils;',name:'getChars',parameters:['Ljava/lang/CharSequence;','I','I','[C','I'],result:'V',signature:'(Ljava/lang/CharSequence;II[CI)V'},[text,from,to,ref,0],'static');return runtime.array(ref).elements;})();for(let at=0;at<array.length;at+=16384)content+=String.fromCharCode(...array.slice(at,at+16384));}
        pull(runtime,paint,args[0]);if(!runtime.skiaHost?.textBounds)fail('Paint text bounds requires the verified Skia glyph backend');
        const box=runtime.skiaHost.textBounds(content,paint);['left','top','right','bottom'].forEach((field,index)=>runtime.storeField(target.fields,`Landroid/graphics/Rect;->${field}:I`,box[index]));
        runtime.record('HOST Paint.getTextBounds [SkParagraph shaped glyph positions / original Skia Font bounds]');return;
      }
      if(name==='getTextRunCursor'){
        // Paint.getTextRunCursor -> Minikin GraphemeBreak::getTextRunCursor: the nearest grapheme-cluster boundary of the context in the requested direction. Boundaries come from the
        // original ICU4C character break rules (the Wasm ICU host); Minikin's extra ligature tailoring (it consults the shaped advances) is not applied.
        if(nullish(args[1]))runtime.throwJava('Ljava/lang/NullPointerException;',null);
        const kind=method.parameters[0];
        let contextStart=args[2],contextEnd=kind==='[C'?args[2]+args[3]:args[3];const offset=args[5],option=args[6];
        const length=kind==='[C'?runtime.array(args[1]).elements.length:typeof args[1]==='string'?args[1].length:runtime.dispatch({owner:runtime.typeOf(args[1]),name:'length',parameters:[],result:'I',signature:'()I'},[args[1]],'virtual');
        if(((contextStart|contextEnd|offset|(contextEnd-contextStart)|(offset-contextStart)|(contextEnd-offset)|(length-contextEnd)|option)<0)||option>4)runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;',null);
        if(!runtime.icuBreakBackend?.breaks)fail('Paint.getTextRunCursor requires the original ICU grapheme-break Wasm host');
        if(contextEnd-contextStart>65536)fail('Cursor context exceeds 65536 UTF16 units');
        let content;
        if(kind==='[C')content=String.fromCharCode(...runtime.array(args[1]).elements.slice(contextStart,contextEnd).map(v=>v&0xffff));
        else if(typeof args[1]==='string')content=args[1].slice(contextStart,contextEnd);
        else{const buffer=runtime.newArray('[C',contextEnd-contextStart);runtime.dispatch({owner:'Landroid/text/TextUtils;',name:'getChars',parameters:['Ljava/lang/CharSequence;','I','I','[C','I'],result:'V',signature:'(Ljava/lang/CharSequence;II[CI)V'},[args[1],contextStart,contextEnd,buffer,0],'static');content=String.fromCharCode(...runtime.array(buffer).elements.map(v=>v&0xffff));}
        const count=content.length,boundaries=new Set(runtime.icuBreakBackend.breaks(content,'en_US','character')),isBreak=at=>at<=0||at>=count||boundaries.has(at);
        let at=offset-contextStart,result;
        switch(option){
          case 0:if(at<count)at++;case 1:while(!isBreak(at))at++;result=at;break;     // AFTER, AT_OR_AFTER
          case 2:if(at>0)at--;case 3:while(!isBreak(at))at--;result=at;break;         // BEFORE, AT_OR_BEFORE
          default:result=isBreak(at)?at:-1;                                           // AT
        }
        runtime.record('HOST Paint.getTextRunCursor [original ICU4C grapheme boundaries]');
        return result===-1?-1:result+contextStart;
      }
      if(name==='getTextRunAdvances'){
        // Paint.getTextRunAdvances (android-13.0.0_r1 Paint.java: the argument checks, then nGetTextAdvances): the advance of [index, index + count) inside its context, and in
        // advances[advancesIndex..] the advance of every UTF-16 unit (a cluster's advance on its first unit, 0 on the others). MeasuredParagraph measures a left-to-right text
        // without bidi this way (TextUtils.ellipsize of a TextInputLayout hint, buildForMeasurement).
        const [, chars, index, count, contextIndex, contextCount, rtl, advances, advancesIndex] = args;
        if (nullish(chars)) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'text cannot be null');
        const source = runtime.array(chars), out = nullish(advances) ? null : runtime.array(advances);
        if (source.type !== '[C') runtime.throwJava('Ljava/lang/ClassCastException;', 'Paint run requires char[]');
        if ((index | count | contextIndex | contextCount | advancesIndex | (index - contextIndex) | (contextCount - count) | ((contextIndex + contextCount) - (index + count)) | (source.elements.length - (contextIndex + contextCount)) | (out === null ? 0 : out.elements.length - (advancesIndex + count))) < 0) runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;', null);
        if (source.elements.length === 0 || count === 0) return rawFloat(0);
        if (contextCount > 65536) fail('Run context exceeds65536UTF16units');
        pull(runtime, paint, args[0]); if (paint.hyphenEdit) fail('Run advances with Android hyphen editing require an implemented Minikin backend');
        if (!runtime.skiaHost?.measureRunAdvances) fail('Paint run advances require the verified Skia shaping backend');
        let content = ''; const context = source.elements.slice(contextIndex, contextIndex + contextCount); for (let from = 0; from < context.length; from += 16384) content += String.fromCharCode(...context.slice(from, from + 16384));
        // as getRunAdvance: a Latin left-to-right item inside a larger context is shaped as its own run (Minikin's itemization; the context matters to contextual scripts and bidi only)
        const latinItem = !rtl && (index !== contextIndex || count !== contextCount) && /^[\u0020-\u024f]*$/.test(content);
        if (!latinItem && (index !== contextIndex || count !== contextCount)) fail('Run advances require a complete shaping run; partial non-Latin context/bidi items need the Android Minikin boundary');
        const item = latinItem ? content.slice(index - contextIndex, index - contextIndex + count) : content, result = runtime.skiaHost.measureRunAdvances(item, { start: latinItem ? 0 : index - contextIndex, end: latinItem ? count : index - contextIndex + count, isRtl: !!rtl }, paint);
        if (out) for (let i = 0; i < count; i++) out.elements[advancesIndex + i] = rawFloat(result.advances[i]);   // a float[] holds the float bits
        runtime.record('HOST Paint.getTextRunAdvances [original SkParagraph/SkShaper cluster advances]'); return rawFloat(result.total);
      }
      if(name==='getRunAdvance'){
        if(nullish(args[1]))runtime.throwJava('Ljava/lang/IllegalArgumentException;','text cannot be null');
        const isArray=method.parameters[0]==='[C',text=args[1],start=args[2],end=args[3],contextStart=args[4],contextEnd=args[5],isRtl=!!args[6],offset=args[7];
        const length=isArray?runtime.array(text).elements.length:typeof text==='string'?text.length:runtime.dispatch({owner:runtime.typeOf(text),name:'length',parameters:[],result:'I',signature:'()I'},[text],'virtual');
        if(contextStart<0||start<contextStart||offset<start||end<offset||contextEnd<end||contextEnd>length)runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;','Invalid Paint run/context range');
        if(start===end)return rawFloat(0);
        if(contextEnd-contextStart>65536)fail('Run context exceeds65536UTF16units');
        pull(runtime,paint,args[0]);if(paint.hyphenEdit)fail('Run advance with Android hyphen editing requires an implemented Minikin backend');
        let chars;
        if(isArray){const source=runtime.array(text);if(source.type!=='[C')runtime.throwJava('Ljava/lang/ClassCastException;','Paint run requires char[]');chars=source.elements.slice(contextStart,contextEnd);}
        else{const buffer=runtime.newArray('[C',contextEnd-contextStart);runtime.dispatch({owner:'Landroid/text/TextUtils;',name:'getChars',parameters:['Ljava/lang/CharSequence;','I','I','[C','I'],result:'V',signature:'(Ljava/lang/CharSequence;II[CI)V'},[text,contextStart,contextEnd,buffer,0],'static');chars=runtime.array(buffer).elements;}
        let content='';for(let from=0;from<chars.length;from+=16384)content+=String.fromCharCode(...chars.slice(from,from+16384));
        // Partial/RTL items: the whole context is shaped (joining and clusters need it) and the advance is the sum of the cluster boxes of [start,offset).
        // Plain Latin partial LTR items stay unsupported: Minikin shapes them as their own run, and cross-boundary kerning would differ.
        pull(runtime,paint,args[0]);if(!runtime.skiaHost?.measureRun)fail('Paint run advance requires the verified Skia shaping backend');
        // A Latin LTR item inside a larger context (a styled span of a line): Minikin shapes [start, end) as its own run -- the context only matters to contextual scripts and
        // bidi -- so the item is shaped alone and the advance is the clusters of [start, offset), including the kerning that applies inside the item.
        if(!isRtl&&(start!==contextStart||end!==contextEnd)&&/^[\u0020-\u024f]*$/.test(content)){
          const item=content.slice(start-contextStart,end-contextStart),value=runtime.skiaHost.measureRun(item,{offset:offset-start,start:0,isRtl:false},paint);
          runtime.record('HOST Paint.getRunAdvance [original SkParagraph/SkShaper; LTR item shaped as its own run]');return rawFloat(value);
        }
        if((isRtl||start!==contextStart||end!==contextEnd)&&!isRtl)fail('Run advance requires a complete LTR shaping run; partial non-Latin context/bidi items need the Android Minikin boundary');
        const value=runtime.skiaHost.measureRun(content,{offset:offset-contextStart,start:start-contextStart,isRtl},paint);runtime.record('HOST Paint.getRunAdvance [original SkParagraph/SkShaper; complete LTR run]');return rawFloat(value);
      }
      if (name === 'reset') { runtime.storeField(object.fields,`${PAINT}->mBidiFlags:I`,2); object.webPaint = bound(runtime, args[0], initial(1)); initializeTextLocales(runtime,object.webPaint); return; }
      if (name === 'set') { runtime.storeField(object.fields,`${PAINT}->mBidiFlags:I`,runtime.object(args[1]).fields.get(`${PAINT}->mBidiFlags:I`)??2); object.webPaint = copyOf(runtime, args[0], getPaintState(runtime, args[1])); return; }
      if (name === 'getFontMetricsInt' && method.parameters.length === 7) {
        // Paint.getFontMetricsInt(text, start, count, contextStart, contextCount, isRtl, outMetrics) (API 29, android-13.0.0_r1 Paint.java argument checks; Paint.cpp
        // getFontMetricsIntForText): ascent/descent are the extent of every font the run uses (MinikinUtils::getFontExtent), top/bottom are the primary font's widened to them.
        const [, text, start, count, contextStart, contextCount, , out] = args, isArray = method.parameters[0] === '[C', illegal = message => runtime.throwJava('Ljava/lang/IllegalArgumentException;', message);
        if (nullish(text)) illegal('text must not be null');
        const length = isArray ? runtime.array(text).elements.length : typeof text === 'string' ? text.length : runtime.dispatch({ owner: 'Ljava/lang/CharSequence;', name: 'length', parameters: [], result: 'I', signature: '()I' }, [text], 'virtual');
        if (start < 0 || start >= length) illegal('start argument is out of bounds.');
        if (count < 0 || start + count > length) illegal('count argument is out of bounds.');
        if (contextStart < 0 || contextStart >= length) illegal('ctxStart argument is out of bounds.');
        if (contextCount < 0 || contextStart + contextCount > length) illegal('ctxCount argument is out of bounds.');
        if (nullish(out)) illegal('outmetrics must not be null.');
        if (count > 65536) fail('Font metrics text exceeds 65536 UTF-16 units');
        if (!runtime.skiaHost?.measureText) fail('Paint font metrics require the verified native Skia font backend');
        let content = '';
        if (typeof text === 'string') content = text.slice(start, start + count);
        else { const units = isArray ? runtime.array(text).elements.slice(start, start + count) : (() => { const ref = runtime.newArray('[C', count); runtime.dispatch({ owner: 'Landroid/text/TextUtils;', name: 'getChars', parameters: ['Ljava/lang/CharSequence;', 'I', 'I', '[C', 'I'], result: 'V', signature: '(Ljava/lang/CharSequence;II[CI)V' }, [text, start, start + count, ref, 0], 'static'); return runtime.array(ref).elements; })(); for (let at = 0; at < units.length; at += 16384) content += String.fromCharCode(...units.slice(at, at + 16384)); }
        const plain = { ...pull(runtime, paint, args[0]), letterSpacing: 0, wordSpacing: 0, hyphenEdit: 0 }, primary = runtime.skiaHost.measureText('', plain).metrics, extent = content ? runtime.skiaHost.measureText(content, plain).metrics : primary;
        const ascent = extent.ascent, descent = extent.descent, top = Math.min(ascent, primary.bounds?.[1]), bottom = Math.max(descent, primary.bounds?.[3]);
        for (const value of [ascent, descent, top, bottom, primary.leading]) if (!Number.isFinite(value)) fail('Skia returned incomplete font metrics for a text run');
        if (!runtime.isSubtype(runtime.object(out).type, METRICS_INT)) runtime.throwJava('Ljava/lang/ClassCastException;', 'Paint font metrics output type');
        const fields = runtime.object(out).fields, round = value => Math.floor(Math.fround(value + 0.5));   // GraphicsJNI::set_metrics_int
        for (const [field, value] of [['top', Math.floor(top)], ['ascent', round(ascent)], ['descent', round(descent)], ['bottom', Math.ceil(bottom)], ['leading', round(primary.leading)]]) runtime.storeField(fields, `${METRICS_INT}->${field}:I`, value);
        return;
      }
      if (['getFontMetrics', 'getFontMetricsInt', 'getFontSpacing', 'ascent', 'descent', 'getUnderlinePosition', 'getUnderlineThickness', 'getStrikeThruPosition', 'getStrikeThruThickness'].includes(name)) {
        // Paint.cpp uses these constants for strike-through regardless of the font table.
        if (name === 'getStrikeThruPosition') return rawFloat(Math.fround(Math.fround(-6 / 21) - Math.fround(0.5 * Math.fround(1 / 18))) * paint.textSize);
        if (name === 'getStrikeThruThickness') return rawFloat(Math.fround(1 / 18) * paint.textSize);
        if (!runtime.skiaHost?.measureText) fail('Paint font metrics require the verified native Skia font backend');
        // Letter/word spacing alter text advances, not the selected font's metrics.
        // This is the installed main typeface, not Android Minikin fallback metrics.
        const native = runtime.skiaHost.measureText('', { ...paint, letterSpacing: 0, wordSpacing: 0, hyphenEdit: 0 }).metrics;
        // CanvasKit 0.42 maps SkFontMetrics fTop/fBottom to bounds[1]/bounds[3].
        const metrics = { ...native, top: native.bounds?.[1], bottom: native.bounds?.[3] };
        for (const field of ['ascent', 'descent', 'leading']) if (!Number.isFinite(metrics[field])) fail('Skia returned incomplete font metrics: ' + field);
        if (name === 'ascent' || name === 'descent') return rawFloat(metrics[name]);
        if (name === 'getUnderlinePosition' || name === 'getUnderlineThickness') {
          const field = name === 'getUnderlinePosition' ? 'underlinePosition' : 'underlineThickness';
          // CanvasKit omits a property when SkFontMetrics::hasUnderline* is false.
          const fallback = name === 'getUnderlinePosition' ? Math.fround(Math.fround(1 / 9) - Math.fround(0.5 * Math.fround(1 / 18))) : Math.fround(1 / 18);
          return rawFloat(metrics[field] === undefined ? fallback * paint.textSize : metrics[field]);
        }
        if (name === 'getFontSpacing') return rawFloat(Math.fround(metrics.descent - metrics.ascent) + metrics.leading);
        for (const field of ['top', 'bottom']) if (!Number.isFinite(metrics[field])) fail('Skia returned incomplete font metrics: ' + field);
        const integer = name === 'getFontMetricsInt', type = integer ? METRICS_INT : METRICS, result = integer ? 'I' : 'F';
        let target = args[1];
        if (!method.parameters.length) {
          target = runtime.allocate(type);
          runtime.dispatch({ owner: type, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [target], 'direct');
        }
        // AOSP GraphicsJNI::set_metrics_int: outward clipping bounds, rounded line metrics.
        const values = Object.fromEntries(['top', 'ascent', 'descent', 'bottom', 'leading'].map(field => [field,
          integer ? (field === 'top' ? Math.floor(metrics[field]) : field === 'bottom' ? Math.ceil(metrics[field]) : Math.floor(Math.fround(metrics[field] + 0.5))) : metrics[field]
        ]));
        if (!nullish(target)) {
          if (!runtime.isSubtype(runtime.object(target).type, type)) runtime.throwJava('Ljava/lang/ClassCastException;', 'Paint font metrics output type');
          const fields = runtime.object(target).fields;
          for (const [field, value] of Object.entries(values)) runtime.storeField(fields, `${type}->${field}:${result}`, integer ? value : rawFloat(value));
        }
        if (!method.parameters.length) return target;
        return integer ? values.descent - values.ascent + values.leading : rawFloat(Math.fround(values.descent - values.ascent) + values.leading);
      }
      if (name === 'getFontFeatureSettings') return paint.fontFeatureSettings;
      if (name === 'setFontFeatureSettings') {   // CSS font-feature-settings text, applied to the shaper (text-layout-native.js parses it); an empty string clears it
        const value = nullish(args[1]) ? null : runtime.stringCharacters(args[1]); paint.fontFeatureSettings = value === '' ? null : value; return;
      }
      if (name === 'getFontVariationSettings') return paint.fontVariationSettings;
      if (name === 'setFontVariationSettings') {   // Paint.setFontVariationSettings: the axes the typeface's fonts declare are applied through Typeface.createFromTypefaceWithVariation; false (and no change) when it supports none
        const value = nullish(args[1]) ? '' : runtime.stringCharacters(args[1]);
        if (value === (paint.fontVariationSettings ?? '')) return 1;
        if (value === '') { paint.fontVariationSettings = null; const plain = runtime.skiaHost.variationTypeface?.(paint.typefaceRef ?? null, []); if (plain) paint.typefaceRef = plain; return 1; }   // Typeface.createFromTypefaceWithVariation(typeface, emptyList)
        let axes; try { axes = runtime.platform.typefaceBuilder.parseVariationSettings(runtime, value); } catch (error) { if (error?.name === 'JavaException' && runtime.isSubtype(runtime.typeOf(error.value), 'Ljava/lang/IllegalArgumentException;')) return 0; throw error; }
        const face = axes ? runtime.skiaHost.variationTypeface(paint.typefaceRef ?? null, axes) : null;
        if (!face) return 0;
        paint.fontVariationSettings = value; paint.typefaceRef = face; return 1;
      }
      if (name === 'isElegantTextHeight') return paint.elegantTextHeight ? 1 : 0;
      if (name === 'setElegantTextHeight') { paint.elegantTextHeight = !!args[1]; return; }
      if (name === 'getShadowLayerRadius') return rawFloat(paint.shadowLayer?.radius ?? 0);
      if (name === 'getShadowLayerDx') return rawFloat(paint.shadowLayer?.dx ?? 0);
      if (name === 'getShadowLayerDy') return rawFloat(paint.shadowLayer?.dy ?? 0);
      if (name === 'getShadowLayerColor') return paint.shadowLayer?.color ?? 0;
      if (name === 'hasGlyph') {   // Paint.hasGlyph(String): one grapheme cluster the paint's typeface or the fallback chain can draw
        if (nullish(args[1])) runtime.throwJava('Ljava/lang/NullPointerException;', 'string');
        if (!runtime.skiaHost?.hasGlyph) fail('Paint.hasGlyph requires the verified Skia font backend');
        return runtime.skiaHost.hasGlyph(runtime.stringCharacters(args[1]), paint) ? 1 : 0;
      }
      if (name === 'getTextWidths') {
        // Paint.getTextWidths (android-13.0.0_r1 Paint.java): the argument checks of each overload, then nGetTextAdvances over [start, end) with the range as its own context and the
        // paint's bidi flags: widths[0..] gets the advance of every UTF-16 unit (a cluster's advance on its first unit, 0 on the others) and the result is the unit count.
        const kind = method.parameters[0], text = args[1], bounds = message => runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;', message), arrayBounds = () => runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;');
        if (nullish(text)) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'text cannot be null');
        const widths = args[args.length - 1];
        if (nullish(widths)) runtime.throwJava('Ljava/lang/NullPointerException;', 'widths');
        const out = runtime.array(widths), length = kind === '[C' ? runtime.array(text).elements.length : typeof text === 'string' ? text.length : runtime.dispatch({ owner: 'Ljava/lang/CharSequence;', name: 'length', parameters: [], result: 'I', signature: '()I' }, [text], 'virtual');
        let start = 0, end = length;
        if (kind === '[C') { const index = args[2], count = args[3]; if ((index | count) < 0 || index + count > length || count > out.elements.length) arrayBounds(); start = index; end = index + count; }
        else {
          if (method.parameters.length === 4) { start = args[2]; end = args[3]; }
          if ((start | end | (end - start) | (length - end)) < 0) bounds(`start ${start}, end ${end}, length ${length}`);
          if (end - start > out.elements.length) arrayBounds();
        }
        if (length === 0 || start === end) return 0;
        if (end - start > 65536) fail('Paint.getTextWidths exceeds 65536 UTF16 units');
        let content;
        if (kind === '[C') content = String.fromCharCode(...runtime.array(text).elements.slice(start, end).map(v => v & 0xffff));
        else if (typeof text === 'string') content = text.slice(start, end);
        else { const buffer = runtime.newArray('[C', end - start); runtime.dispatch({ owner: 'Landroid/text/TextUtils;', name: 'getChars', parameters: ['Ljava/lang/CharSequence;', 'I', 'I', '[C', 'I'], result: 'V', signature: '(Ljava/lang/CharSequence;II[CI)V' }, [text, start, end, buffer, 0], 'static'); content = String.fromCharCode(...runtime.array(buffer).elements.map(v => v & 0xffff)); }
        // the paint's bidi flags (mBidiFlags, Minikin's Bidi): FORCE_LTR / FORCE_RTL make one run of that direction. For the paragraph directions (LTR, RTL, DEFAULT_LTR, DEFAULT_RTL)
        // a text whose strong characters all have the paragraph's direction is one run of it; a text that mixes levels needs Minikin's bidi itemization, which this boundary does not have.
        const bidi = object.fields.get(`${PAINT}->mBidiFlags:I`) ?? 2;
        const strongRtl = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefe]|\ud802[\udc00-\udfff]|\ud83a[\udc00-\udfff]/.test(content), strongLtr = !strongRtl ? /\p{L}/u.test(content) : /[^\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefe\ud800-\udfff\P{L}]/u.test(content);
        let isRtl;
        if (bidi === 4 || bidi === 5) isRtl = bidi === 5;
        else {
          const paragraphRtl = bidi === 1 || (bidi === 3 && !strongLtr) || (bidi === 2 && strongRtl && !strongLtr) || (bidi === 3 && strongRtl && !strongLtr);
          if (paragraphRtl ? strongLtr : strongRtl) fail('Paint.getTextWidths of a text that mixes directions requires the Android Minikin bidi boundary');
          isRtl = paragraphRtl;
        }
        pull(runtime, paint, args[0]); if (paint.hyphenEdit) fail('Text widths with Android hyphen editing require an implemented Minikin backend');
        if (!runtime.skiaHost?.measureRunAdvances) fail('Paint.getTextWidths requires the verified Skia shaping backend');
        const result = runtime.skiaHost.measureRunAdvances(content, { start: 0, end: content.length, isRtl }, paint);
        for (let i = 0; i < content.length; i++) out.elements[i] = rawFloat(result.advances[i]);   // a float[] holds the float bits
        runtime.record('HOST Paint.getTextWidths [original SkParagraph/SkShaper cluster advances]'); return content.length;
      }
      if (name === 'measureText') {
        // Paint.measureText = the advance of the whole run (Paint.getRunAdvance over [start, end) with the text as its own context); a null text is an NPE
        if (nullish(args[1])) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'text cannot be null');
        const kind = method.parameters[0], hasRange = method.parameters.length === 3;
        const length = kind === '[C' ? runtime.array(args[1]).elements.length : typeof args[1] === 'string' ? args[1].length : runtime.dispatch({ owner: runtime.typeOf(args[1]), name: 'length', parameters: [], result: 'I', signature: '()I' }, [args[1]], 'virtual');
        const start = hasRange ? args[2] : 0, end = hasRange ? (kind === '[C' ? args[2] + args[3] : args[3]) : length;
        if (start < 0 || end < start || end > length) runtime.throwJava(kind === '[C' ? 'Ljava/lang/ArrayIndexOutOfBoundsException;' : 'Ljava/lang/IndexOutOfBoundsException;', `start ${start}, end ${end}, length ${length}`);
        if (start === end) return rawFloat(0);
        if (end - start > 65536) fail('Paint.measureText exceeds 65536 UTF16 units');
        if (!runtime.skiaHost?.measureRun) fail('Paint.measureText requires the verified Skia shaping backend');
        let content;
        if (kind === '[C') content = String.fromCharCode(...runtime.array(args[1]).elements.slice(start, end).map(v => v & 0xffff));
        else if (typeof args[1] === 'string') content = args[1].slice(start, end);
        else { const buffer = runtime.newArray('[C', end - start); runtime.dispatch({ owner: 'Landroid/text/TextUtils;', name: 'getChars', parameters: ['Ljava/lang/CharSequence;', 'I', 'I', '[C', 'I'], result: 'V', signature: '(Ljava/lang/CharSequence;II[CI)V' }, [args[1], start, end, buffer, 0], 'static'); content = String.fromCharCode(...runtime.array(buffer).elements.map(v => v & 0xffff)); }
        const value = runtime.skiaHost.measureRun(content, { offset: content.length, start: 0, isRtl: false }, pull(runtime, paint, args[0])); runtime.record('HOST Paint.measureText [original SkParagraph/SkShaper run advance]'); return rawFloat(value);
      }
      if (name === 'clearShadowLayer') { paint.shadowLayer = null; return; }
      if (name === 'hasShadowLayer') return paint.shadowLayer ? 1 : 0;
      if (name === 'setShadowLayer') {   // Paint.setShadowLayer(radius, dx, dy, color): radius 0 clears the layer; otherwise every draw with this paint gets a blurred copy below it (src/skia-canvas-host.js makePaint)
        const radius = float(args[1]); if (!(radius > 0)) { paint.shadowLayer = null; return; }
        paint.shadowLayer = { radius, dx: float(args[2]), dy: float(args[3]), color: args[4] >>> 0 }; return;
      }
      if (name === 'getColor') return paint.color;
      // Paint.setColor(@ColorLong long) (API 29) keeps the long it was given (getColorLong answers it, as mColor does) and draws its sRGB 8-bit value, Color.toArgb(long)
      // (src/color-long.js). Every other color setter replaces it, so getColorLong then packs the int color.
      if (name === 'setColor' && method.parameters[0] === 'J') {
        const packed = BigInt.asIntN(64, BigInt(args[1])), argb = colorLongToArgb(packed);
        if (argb === null) fail(`Paint.setColor(long) with ColorSpace id ${Number(BigInt.asUintN(64, packed) & 63n)} is not implemented (sRGB, linear sRGB and their extended variants are)`);
        paint.color = argb; paint.colorLong = packed; return;
      }
      if (name === 'getColorLong') return paint.colorLong ?? BigInt.asIntN(64, BigInt(paint.color >>> 0) << 32n);   // Color.pack(int): sRGB, the int in the upper half
      if (name === 'setColor') { paint.color = args[1] | 0; paint.colorLong = null; return; }
      if (name === 'setARGB') { paint.color = ((args[1] << 24) | (args[2] << 16) | (args[3] << 8) | args[4]) | 0; paint.colorLong = null; return; }   // Paint.setARGB: setColor((a << 24) | (r << 16) | (g << 8) | b)
      if (name === 'getAlpha') return paint.color >>> 24;
      if (name === 'setAlpha') {
        if (args[1] < 0 || args[1] > 255) fail('Software Paint alpha must be in [0,255]');
        paint.color = (paint.color & 0xffffff) | (args[1] << 24);
        // AOSP setAlpha repacks mColor in its own ColorSpace with alpha a / 255f: for a non-sRGB long only its 10 alpha bits change (Color.pack: (int) (a * 1023 + 0.5) at bit 6)
        if (paint.colorLong != null && (BigInt(paint.colorLong) & 63n) !== 0n) paint.colorLong = BigInt.asIntN(64, (BigInt.asUintN(64, BigInt(paint.colorLong)) & ~(0x3ffn << 6n)) | (BigInt(Math.floor(args[1] / 255 * 1023 + 0.5)) << 6n));
        else paint.colorLong = null;
        return;
      }
      if (name === 'getFlags') return paint.flags;
      if (name === 'setFlags') { paint.flags = args[1]; return; }
      for (const effect of referenceEffects) {
        const field = effect[0].toLowerCase() + effect.slice(1);
        if (name === 'get' + effect) return paint[field] ?? null;
        if (name === 'set' + effect) {
          const value = nullish(args[1]) ? null : args[1];
          if (value) runtime.object(value);
          // Paint setters return the supplied effect, not the previous reference.
          paint[field] = value; return value;
        }
      }
      if (name === 'getHinting') return paint.hinting;
      // AOSP Paint.cpp maps zero to SkFontHinting::kNone and every other int to kNormal.
      if (name === 'setHinting') { paint.hinting = args[1] === 0 ? 0 : 1; return; }
      for (const suffix of ['StrokeWidth', 'StrokeMiter', 'TextSize', 'TextScaleX', 'TextSkewX', 'LetterSpacing', 'WordSpacing']) {
        const property = suffix[0].toLowerCase() + suffix.slice(1);
        if (name === 'get' + suffix) return rawFloat(paint[property]);
        // SkPaint preserves its previous value for negatives/NaN.
        if (name === 'set' + suffix) { const value = float(args[1]); if (!['StrokeWidth', 'StrokeMiter', 'TextSize'].includes(suffix) || value >= 0) paint[property] = value; return; }
      }
      for (const [which, [suffix, nested, property, names]] of enums.entries()) {
        const type = `Landroid/graphics/Paint$${nested};`;
        if (name === 'get' + suffix) {
          const constant = names[paint[property]], value = runtime.readStatic({ owner: type, name: constant, type, key: `${type}->${constant}:${type}` });
          runtime.wasm?.paints?.noteEnum(which, paint[property], value);   // the core's getter and setter natives answer this constant from now on
          return value;
        }
        if (name === 'set' + suffix) {
          if (nullish(args[1])) runtime.throwJava('Ljava/lang/NullPointerException;', `Paint.${suffix} is null`);
          const nativeInt = runtime.object(args[1]).fields.get(`${type}->nativeInt:I`);
          if (!Number.isInteger(nativeInt) || !names[nativeInt]) fail('Paint requires an original source enum with valid nativeInt');
          paint[property] = nativeInt; return;
        }
      }
      for (const [suffix, mask] of flagMasks) {
        if (name === 'is' + suffix) return paint.flags & mask ? 1 : 0;
        if (name === 'set' + suffix) { paint.flags = args[1] ? paint.flags | mask : paint.flags & ~mask; return; }
      }
      if (name === 'getColorFilter') return paint.colorFilter;
      if (name === 'getXfermode') return paint.xfermode;
      if (name === 'getBlendMode') { if(nullish(paint.xfermode))return null; const mode=runtime.object(paint.xfermode).fields.get(`${XFERMODE}->porterDuffMode:I`);return invokeLocale(runtime,'Landroid/graphics/BlendMode;','fromValue',['I'],'Landroid/graphics/BlendMode;',null,[mode],'static'); }
      if (name === 'setBlendMode') { paint.xfermode=nullish(args[1])?null:invokeLocale(runtime,'Landroid/graphics/BlendMode;','getXfermode',[],XFERMODE,args[1]);return; }
      if (name === 'setColorFilter' || name === 'setXfermode') {
        const value = nullish(args[1]) ? null : args[1]; if (value) runtime.object(value);
        paint[name === 'setColorFilter' ? 'colorFilter' : 'xfermode'] = value; return value;
      }
      fail(`Paint operation ${name} is not implemented`);
    }
  };
  return paintHost;
}

/** A native Canvas may draw this state only when it can preserve the paint's meaning. */
export function getSolidPaint(runtime, receiver) {
  const paint = getPaintState(runtime, receiver);
  const maskFilter = nullish(paint.maskFilter) ? null : (runtime.object(paint.maskFilter).maskFilter ?? fail('This paint needs an implemented MaskFilter drawing backend (only BlurMaskFilter is)'));
  if (maskFilter && !runtime.skiaHost) fail('A Paint with a BlurMaskFilter requires the Skia backend');
  if (paint.shadowLayer && !runtime.skiaHost) fail('A Paint with a shadow layer (Paint.setShadowLayer) requires the Skia backend');
  const pathEffect = nullish(paint.pathEffect) ? null : (runtime.object(paint.pathEffect).pathEffect ?? fail('This paint needs an implemented PathEffect drawing backend (only DashPathEffect, CornerPathEffect and PathDashPathEffect are)'));
  if (pathEffect?.compose) fail('A Paint with a ComposePathEffect cannot draw: the Skia build of the lab exports no composed path effect (SkPathEffect::MakeCompose)');
  const shader = nullish(paint.shader) ? null : (runtime.platform?.shaderHost?.snapshot?.(runtime, paint.shader) ?? fail('This paint needs an implemented Shader drawing backend'));
  const colorFilterSnapshot=snapshotPaintColorFilter(runtime,paint.colorFilter);
  const blendMode=nullish(paint.xfermode)?3:runtime.object(paint.xfermode).fields.get(`${XFERMODE}->porterDuffMode:I`);
  if(!Number.isInteger(blendMode)||blendMode<0||blendMode>28)fail('This paint needs a known original Skia transfer-mode value');
  if(blendMode!==3&&!runtime.skiaHost)fail('Nondefault Paint BlendMode requires the verified Skia CPU backend');
  return { ...paint, shader, pathEffect, maskFilter, blendMode, colorFilterSnapshot, argb: paint.color >>> 0, color: '#' + (paint.color & 0xffffff).toString(16).padStart(6, '0'), alpha: (paint.color >>> 24) / 255 };
}
