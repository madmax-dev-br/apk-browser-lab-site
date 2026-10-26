import { APKError } from './apk-error.js?v=88ca7fbf670e';
import { snapshotPaintColorFilter } from './color-filter-native.js?v=88ca7fbf670e';

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
export function getPaintStateByHandle(runtime,handle){
  const reference=handleRegistry(runtime).values.get(handle);if(!reference)fail('Invalid VM Paint token; this is not a native memory address');
  return getPaintState(runtime,reference);
}
export function getSolidPaintByHandle(runtime,handle){const reference=handleRegistry(runtime).values.get(handle);if(!reference)fail('Invalid VM Paint token; this is not a native memory address');return getSolidPaint(runtime,reference);}
const initial = flags => ({ flags: (flags | HIDDEN_FLAGS), color: 0xff000000 | 0, colorFilter: null, xfermode: null, strokeWidth: 0, strokeMiter: 4, style: 0, strokeCap: 0, strokeJoin: 0, textSize: 12, textScaleX: 1, textSkewX: 0, letterSpacing: 0, wordSpacing: 0, hinting: 1, hyphenEdit: 0 });
const keys = new Set([
  '<init>()V', '<init>(I)V', `<init>(${PAINT})V`, 'reset()V', `set(${PAINT})V`,
  'getNativeInstance()J', 'getTextLocale()Ljava/util/Locale;', 'getTextLocales()Landroid/os/LocaleList;', 'setTextLocale(Ljava/util/Locale;)V', 'setTextLocales(Landroid/os/LocaleList;)V',
  'getBlendMode()Landroid/graphics/BlendMode;', 'setBlendMode(Landroid/graphics/BlendMode;)V',
  'getColor()I', 'setColor(I)V', 'getAlpha()I', 'setAlpha(I)V', 'getFlags()I', 'setFlags(I)V',
  'getHinting()I', 'setHinting(I)V', 'getStartHyphenEdit()I', 'getEndHyphenEdit()I', 'setStartHyphenEdit(I)V', 'setEndHyphenEdit(I)V',
  'getTextBounds(Ljava/lang/String;IILandroid/graphics/Rect;)V', 'getTextBounds([CIILandroid/graphics/Rect;)V', 'getTextBounds(Ljava/lang/CharSequence;IILandroid/graphics/Rect;)V',
  'getRunAdvance([CIIIIZI)F', 'getRunAdvance(Ljava/lang/CharSequence;IIIIZI)F',
  'getStrokeWidth()F', 'setStrokeWidth(F)V', 'getStrokeMiter()F', 'setStrokeMiter(F)V',
  `getColorFilter()${FILTER}`, `setColorFilter(${FILTER})${FILTER}`,
  `getXfermode()${XFERMODE}`, `setXfermode(${XFERMODE})${XFERMODE}`,
  'isAntiAlias()Z', 'setAntiAlias(Z)V', 'isDither()Z', 'setDither(Z)V', 'isFilterBitmap()Z', 'setFilterBitmap(Z)V'
].map(signature => PAINT + '->' + signature).concat([`${PDX}-><init>(Landroid/graphics/PorterDuff$Mode;)V`]));
for (const signature of [
  `getFontMetrics()${METRICS}`, `getFontMetrics(${METRICS})F`,
  `getFontMetricsInt()${METRICS_INT}`, `getFontMetricsInt(${METRICS_INT})I`,
  'getFontSpacing()F', 'ascent()F', 'descent()F', 'getUnderlinePosition()F', 'getUnderlineThickness()F',
  'getStrikeThruPosition()F', 'getStrikeThruThickness()F',
]) keys.add(PAINT + '->' + signature);
const enums = [
  ['Style', 'Style', 'style', ['FILL', 'STROKE', 'FILL_AND_STROKE']],
  ['StrokeCap', 'Cap', 'strokeCap', ['BUTT', 'ROUND', 'SQUARE']],
  ['StrokeJoin', 'Join', 'strokeJoin', ['MITER', 'ROUND', 'BEVEL']],
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
for (const effect of referenceEffects) { const type = `Landroid/graphics/${effect};`; keys.add(`${PAINT}->get${effect}()${type}`); keys.add(`${PAINT}->set${effect}(${type})${type}`); }

export function getPaintState(runtime, receiver) {
  if (nullish(receiver)) runtime.throwJava('Ljava/lang/NullPointerException;', 'Paint is null');
  const state = runtime.object(receiver).webPaint;
  if (!state) fail('Paint has not been initialized by the web graphics backend');
  return state;
}

function invokeLocale(runtime,owner,name,parameters,result,receiver,values=[],mode='virtual'){
 return runtime.dispatch({owner,name,parameters,result,signature:`(${parameters.join('')})${result}`},runtime.argumentWords(parameters,values,mode==='static'?{}:{receiver}),mode);
}
function sameTextLocales(runtime,a,b){const list='Landroid/os/LocaleList;',locale='Ljava/util/Locale;',count=invokeLocale(runtime,list,'size',[],'I',a);if(count!==invokeLocale(runtime,list,'size',[],'I',b))return false;for(let i=0;i<count;i++)if(!invokeLocale(runtime,locale,'equals',['Ljava/lang/Object;'],'Z',invokeLocale(runtime,list,'get',['I'],locale,a,[i]),[invokeLocale(runtime,list,'get',['I'],locale,b,[i])]))return false;return true;}
function initializeTextLocales(runtime,paint){
 const list='Landroid/os/LocaleList;',locale='Ljava/util/Locale;';paint.textLocalesRef=invokeLocale(runtime,list,'getAdjustedDefault',[],list,null,[],'static');
 paint.textLocaleTag=runtime.javaString(invokeLocale(runtime,locale,'toLanguageTag',[],'Ljava/lang/String;',invokeLocale(runtime,list,'get',['I'],locale,paint.textLocalesRef,[0])));
}

/** ARGB software-paint boundary. ColorDrawable state, alpha and mutation stay in original DEX. */
export function createPaintHost() {
  return {
    supports: key => keys.has(key),
    canAllocate: type => type === PAINT || type === PDX,
    parent: type => type === PAINT ? 'Ljava/lang/Object;' : type === PDX ? XFERMODE : null,
    invoke(runtime, method, args) {
      const object = runtime.object(args[0]), name = method.name;
      if (method.owner === PDX) {
        // Original API28 PorterDuffXfermode(Mode): Xfermode.porterDuffMode = mode.nativeInt.
        if (nullish(args[1])) runtime.throwJava('Ljava/lang/NullPointerException;', 'mode is null');
        runtime.storeField(object.fields, `${XFERMODE}->porterDuffMode:I`, runtime.object(args[1]).fields.get('Landroid/graphics/PorterDuff$Mode;->nativeInt:I')); return;
      }
      if (name === '<init>') {
        object.webPaint = method.parameters[0] === PAINT ? { ...getPaintState(runtime, args[1]) } : initial(method.parameters.length ? args[1] : 1);
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
        if(sameTextLocales(runtime,value,paint.textLocalesRef))return;paint.textLocalesRef=value;paint.textLocaleTag=runtime.javaString(invokeLocale(runtime,locale,'toLanguageTag',[],'Ljava/lang/String;',invokeLocale(runtime,list,'get',['I'],locale,value,[0])));return;
      }
      if(name==='getNativeInstance'){
        const registry=handleRegistry(runtime);if(!object.paintHandle){if(registry.values.size>=65536)fail('VM Paint token limit exceeded');object.paintHandle=registry.next++;registry.values.set(object.paintHandle,args[0]);}
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
        if(to-from>65536)fail('Text bounds exceeds65536UTF16units');if(paint.hyphenEdit)fail('Text bounds with Android hyphen editing requires a Minikin backend');
        let content='';
        if(typeof text==='string')content=text.slice(from,to);
        else{const array=isArray?runtime.array(text).elements.slice(from,to):(()=>{const ref=runtime.newArray('[C',to-from);runtime.dispatch({owner:'Landroid/text/TextUtils;',name:'getChars',parameters:['Ljava/lang/CharSequence;','I','I','[C','I'],result:'V',signature:'(Ljava/lang/CharSequence;II[CI)V'},[text,from,to,ref,0],'static');return runtime.array(ref).elements;})();for(let at=0;at<array.length;at+=16384)content+=String.fromCharCode(...array.slice(at,at+16384));}
        if(!runtime.skiaHost?.textBounds)fail('Paint text bounds requires the verified Skia glyph backend');
        const box=runtime.skiaHost.textBounds(content,paint);['left','top','right','bottom'].forEach((field,index)=>runtime.storeField(target.fields,`Landroid/graphics/Rect;->${field}:I`,box[index]));
        runtime.record('HOST Paint.getTextBounds [SkParagraph shaped glyph positions / original Skia Font bounds]');return;
      }
      if(name==='getRunAdvance'){
        if(nullish(args[1]))runtime.throwJava('Ljava/lang/IllegalArgumentException;','text cannot be null');
        const isArray=method.parameters[0]==='[C',text=args[1],start=args[2],end=args[3],contextStart=args[4],contextEnd=args[5],isRtl=!!args[6],offset=args[7];
        const length=isArray?runtime.array(text).elements.length:typeof text==='string'?text.length:runtime.dispatch({owner:runtime.typeOf(text),name:'length',parameters:[],result:'I',signature:'()I'},[text],'virtual');
        if(contextStart<0||start<contextStart||offset<start||end<offset||contextEnd<end||contextEnd>length)runtime.throwJava('Ljava/lang/IndexOutOfBoundsException;','Invalid Paint run/context range');
        if(start===end)return rawFloat(0);
        if(contextEnd-contextStart>65536)fail('Run context exceeds65536UTF16units');
        if(isRtl||start!==contextStart||end!==contextEnd)fail('Run advance requires a complete LTR shaping run; partial context/bidi items need the Android Minikin boundary');
        if(paint.hyphenEdit)fail('Run advance with Android hyphen editing requires an implemented Minikin backend');
        let chars;
        if(isArray){const source=runtime.array(text);if(source.type!=='[C')runtime.throwJava('Ljava/lang/ClassCastException;','Paint run requires char[]');chars=source.elements.slice(contextStart,contextEnd);}
        else{const buffer=runtime.newArray('[C',contextEnd-contextStart);runtime.dispatch({owner:'Landroid/text/TextUtils;',name:'getChars',parameters:['Ljava/lang/CharSequence;','I','I','[C','I'],result:'V',signature:'(Ljava/lang/CharSequence;II[CI)V'},[text,contextStart,contextEnd,buffer,0],'static');chars=runtime.array(buffer).elements;}
        let content='';for(let from=0;from<chars.length;from+=16384)content+=String.fromCharCode(...chars.slice(from,from+16384));
        if(!runtime.skiaHost?.measureRun)fail('Paint run advance requires the verified Skia shaping backend');
        const value=runtime.skiaHost.measureRun(content,{offset:offset-contextStart},paint);runtime.record('HOST Paint.getRunAdvance [original SkParagraph/SkShaper; complete LTR run]');return rawFloat(value);
      }
      if (name === 'reset') { runtime.storeField(object.fields,`${PAINT}->mBidiFlags:I`,2); object.webPaint = initial(1); initializeTextLocales(runtime,object.webPaint); return; }
      if (name === 'set') { runtime.storeField(object.fields,`${PAINT}->mBidiFlags:I`,runtime.object(args[1]).fields.get(`${PAINT}->mBidiFlags:I`)??2); object.webPaint = { ...getPaintState(runtime, args[1]) }; return; }
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
      if (name === 'getColor') return paint.color;
      if (name === 'setColor') { paint.color = args[1] | 0; return; }
      if (name === 'getAlpha') return paint.color >>> 24;
      if (name === 'setAlpha') {
        if (args[1] < 0 || args[1] > 255) fail('Software Paint alpha must be in [0,255]');
        paint.color = (paint.color & 0xffffff) | (args[1] << 24); return;
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
      for (const [suffix, nested, property, names] of enums) {
        const type = `Landroid/graphics/Paint$${nested};`;
        if (name === 'get' + suffix) {
          const constant = names[paint[property]];
          return runtime.readStatic({ owner: type, name: constant, type, key: `${type}->${constant}:${type}` });
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
}

/** A native Canvas may draw this state only when it can preserve the paint's meaning. */
export function getSolidPaint(runtime, receiver) {
  const paint = getPaintState(runtime, receiver);
  for (const effect of referenceEffects) if (effect !== 'Shader' && !nullish(paint[effect[0].toLowerCase() + effect.slice(1)])) fail(`This paint needs an implemented ${effect} drawing backend`);
  const shader = nullish(paint.shader) ? null : (runtime.platform?.shaderHost?.snapshot?.(runtime, paint.shader) ?? fail('This paint needs an implemented Shader drawing backend'));
  const colorFilterSnapshot=snapshotPaintColorFilter(runtime,paint.colorFilter);
  const blendMode=nullish(paint.xfermode)?3:runtime.object(paint.xfermode).fields.get(`${XFERMODE}->porterDuffMode:I`);
  if(!Number.isInteger(blendMode)||blendMode<0||blendMode>28)fail('This paint needs a known original Skia transfer-mode value');
  if(blendMode!==3&&!runtime.skiaHost)fail('Nondefault Paint BlendMode requires the verified Skia CPU backend');
  return { ...paint, shader, blendMode, colorFilterSnapshot, argb: paint.color >>> 0, color: '#' + (paint.color & 0xffffff).toString(16).padStart(6, '0'), alpha: (paint.color >>> 24) / 255 };
}
