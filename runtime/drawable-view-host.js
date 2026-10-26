import {prepareCpuAnimatedVector} from './animated-vector-native.js?v=af3232247547';
import { APKError } from './apk-runtime.js?v=af3232247547';
import { getVectorGraphics } from './vector-native.js?v=af3232247547';
import { createNinePatchDrawableHost } from './ninepatch-drawable-host.js?v=af3232247547';
import { createSwitchWidgetHost } from './switch-widget-host.js?v=af3232247547';
const COMPOUND='Landroid/widget/CompoundButton;',TEXT='Landroid/widget/TextView;',TINT='Landroid/content/res/ColorStateList;',BLEND='Landroid/graphics/BlendMode;',MODE='Landroid/graphics/PorterDuff$Mode;';
const IMAGE = 'Landroid/widget/ImageView;', VIEW = 'Landroid/view/View;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', CANVAS = 'Landroid/graphics/Canvas;';
const keys = new Set(), add = (owner, methods) => methods.forEach(method => keys.add(owner + '->' + method));
add(IMAGE, ['setImageState([IZ)V', 'onCreateDrawableState(I)[I', 'drawableStateChanged()V', '<init>(Landroid/content/Context;)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;I)V', '<init>(Landroid/content/Context;Landroid/util/AttributeSet;II)V', 'setImageResource(I)V', 'setImageDrawable(Landroid/graphics/drawable/Drawable;)V', 'getDrawable()Landroid/graphics/drawable/Drawable;', 'setImageAlpha(I)V', 'setAlpha(I)V']);
add(VIEW, ['getDrawableState()[I', 'onCreateDrawableState(I)[I', 'mergeDrawableStates([I[I)[I', 'refreshDrawableState()V', 'drawableStateChanged()V', 'setForeground(Landroid/graphics/drawable/Drawable;)V', 'getForeground()Landroid/graphics/drawable/Drawable;', 'invalidate()V', 'setBackground(Landroid/graphics/drawable/Drawable;)V', 'setBackgroundDrawable(Landroid/graphics/drawable/Drawable;)V', 'setBackgroundResource(I)V', 'getBackground()Landroid/graphics/drawable/Drawable;', 'invalidateDrawable(Landroid/graphics/drawable/Drawable;)V', 'verifyDrawable(Landroid/graphics/drawable/Drawable;)Z', 'setContentDescription(Ljava/lang/CharSequence;)V', 'getContentDescription()Ljava/lang/CharSequence;']);
add(VIEW, ['scheduleDrawable(Landroid/graphics/drawable/Drawable;Ljava/lang/Runnable;J)V', 'unscheduleDrawable(Landroid/graphics/drawable/Drawable;Ljava/lang/Runnable;)V', 'unscheduleDrawable(Landroid/graphics/drawable/Drawable;)V']);
add(VIEW, ['setPressed(Z)V', 'isPressed()Z', 'setStateListAnimator(Landroid/animation/StateListAnimator;)V', 'getStateListAnimator()Landroid/animation/StateListAnimator;', 'jumpDrawablesToCurrentState()V']);
add(COMPOUND,[`setButtonDrawable(${DRAWABLE})V`,'setButtonDrawable(I)V',`getButtonDrawable()${DRAWABLE}`,`setButtonTintList(${TINT})V`,`getButtonTintList()${TINT}`,`setButtonTintMode(${MODE})V`,`getButtonTintMode()${MODE}`,`setButtonTintBlendMode(${BLEND})V`,`getButtonTintBlendMode()${BLEND}`,'getCompoundPaddingLeft()I','getCompoundPaddingRight()I']);
add(TEXT,['getCompoundPaddingLeft()I','getCompoundPaddingRight()I']);
const fail = message => { throw new APKError(message, { kind: 'drawable-view-unsupported' }); };
const same = (a, b) => a?.ref !== undefined && a.ref === b?.ref;
export function createDrawableViewHost(platform) {
  const ninePatch = createNinePatchDrawableHost(platform);
  const dispatch = (runtime, owner, name, parameters, result, receiver, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], mode);
  const compoundPadding=(runtime,receiver)=>{const view=runtime.object(receiver);if(view.switchState)return switchHost.compoundPadding(runtime,receiver,view.padding);if(!view.buttonDrawable)return null;const result={left:0,top:0,right:0,bottom:0,...view.padding},width=dispatch(runtime,DRAWABLE,'getIntrinsicWidth',[],'I',view.buttonDrawable);result[view.layoutDirection===1?'right':'left']+=width;return result;};
  const buttonGravity=(runtime,receiver)=>{const view=runtime.object(receiver);if(view.gravity!=null)return view.gravity;const table=platform.resources?.frameworkTable;if(!table||!view.context)return 0x800033;const id=table.findId('attr/gravity');if(!id)return 0x800033;const attrs=runtime.newArray('[I',1);runtime.array(attrs).elements=[id];const array=platform.styleBackend.obtain(runtime,platform.styleBackend.theme(runtime,view.context),null,attrs,view.defStyleAttr||table.findId('attr/'+(runtime.isSubtype(view.type,'Landroid/widget/Switch;')?'switchStyle':'checkboxStyle')));try{return dispatch(runtime,'Landroid/content/res/TypedArray;','getInt',['I','I'],'I',array,[0,0x800033]);}finally{dispatch(runtime,'Landroid/content/res/TypedArray;','recycle',[],'V',array);}};
  const switchHost = createSwitchWidgetHost(platform, { dispatch, buttonGravity });
  const buttonBounds=(runtime,receiver,width,height)=>{const view=runtime.object(receiver),drawable=view.buttonDrawable;if(!drawable)return null;const iw=dispatch(runtime,DRAWABLE,'getIntrinsicWidth',[],'I',drawable),ih=dispatch(runtime,DRAWABLE,'getIntrinsicHeight',[],'I',drawable),gravity=buttonGravity(runtime,receiver)&0x70,left=view.layoutDirection===1?width-iw:0,top=gravity===0x50?height-ih:gravity===0x10?Math.trunc((height-ih)/2):0;return {left,top,right:left+iw,bottom:top+ih};};
  const drawButton=(runtime,receiver,canvas,width,height)=>{const view=runtime.object(receiver);if(!view.buttonDrawable)return;prepareCpuAnimatedVector(runtime,view.buttonDrawable);const bounds=buttonBounds(runtime,receiver,width,height);view.buttonBounds=bounds;dispatch(runtime,DRAWABLE,'setBounds',['I','I','I','I'],'V',view.buttonDrawable,Object.values(bounds));if(view.backgroundDrawable)dispatch(runtime,DRAWABLE,'setHotspotBounds',['I','I','I','I'],'V',view.backgroundDrawable,Object.values(bounds));dispatch(runtime,DRAWABLE,'draw',[CANVAS],'V',view.buttonDrawable,[canvas]);};
  const applyButtonTint=(runtime,receiver)=>{const view=runtime.object(receiver);if(!view.buttonDrawable||!view.hasButtonTint&&!view.hasButtonBlendMode)return;view.buttonDrawable=dispatch(runtime,DRAWABLE,'mutate',[],DRAWABLE,view.buttonDrawable);prepareCpuAnimatedVector(runtime,view.buttonDrawable);if(view.hasButtonTint)dispatch(runtime,DRAWABLE,'setTintList',[TINT],'V',view.buttonDrawable,[view.buttonTintList??null]);if(view.hasButtonBlendMode)dispatch(runtime,DRAWABLE,'setTintBlendMode',[BLEND],'V',view.buttonDrawable,[view.buttonTintBlendMode??null]);if(dispatch(runtime,DRAWABLE,'isStateful',[],'Z',view.buttonDrawable))dispatch(runtime,DRAWABLE,'setState',['[I'],'Z',view.buttonDrawable,[dispatch(runtime,VIEW,'getDrawableState',[],'[I',receiver)]);};
  const render = (runtime, receiver) => {
    const view = runtime.object(receiver); if (view.drawingDrawable) return;
    const padding = view.padding || { left: 0, right: 0, top: 0, bottom: 0 };
    let width = view.laidOut && view.bounds ? view.bounds.right - view.bounds.left : view.layoutWidth > 0 ? view.layoutWidth : null, height = view.laidOut && view.bounds ? view.bounds.bottom - view.bounds.top : view.layoutHeight > 0 ? view.layoutHeight : null;
    if ((!width || !height) && view.imageDrawable) { width ||= dispatch(runtime, DRAWABLE, 'getIntrinsicWidth', [], 'I', view.imageDrawable); height ||= dispatch(runtime, DRAWABLE, 'getIntrinsicHeight', [], 'I', view.imageDrawable); }
    if (!(width > 0 && height > 0)) { view.needsDrawableDraw = true; return; }
    if (width > 4096 || height > 4096) fail('Drawable View extent exceeds 4096 px');
    view.drawingDrawable = true;
    try {
      if (!view.drawableCanvas) { view.drawableCanvas = runtime.allocate(CANVAS); dispatch(runtime, CANVAS, '<init>', [], 'V', view.drawableCanvas); }
      const graphics = getVectorGraphics(runtime), canvas = view.drawableCanvas; graphics.resetCanvas(canvas, width, height);
      for (const [drawable, image] of [[view.backgroundDrawable, false], [view.imageDrawable, true]]) {
        if (!drawable) continue;prepareCpuAnimatedVector(runtime,drawable);
        let left = image ? padding.left : 0, top = image ? padding.top : 0, right = image ? width - padding.right : width, bottom = image ? height - padding.bottom : height;
        if (image && (view.imageScaleType ?? 3) !== 1) {
          const iw = dispatch(runtime, DRAWABLE, 'getIntrinsicWidth', [], 'I', drawable), ih = dispatch(runtime, DRAWABLE, 'getIntrinsicHeight', [], 'I', drawable), type = view.imageScaleType ?? 3;
          if (type === 0) fail('ImageView MATRIX scaleType requires explicit Matrix host state');
          if (iw > 0 && ih > 0) { const availableWidth = right - left, availableHeight = bottom - top; let scale = [5, 7].includes(type) ? 1 : type === 6 ? Math.max(availableWidth / iw, availableHeight / ih) : Math.min(availableWidth / iw, availableHeight / ih); if (type === 7) scale = Math.min(1, availableWidth / iw, availableHeight / ih); const w = iw * scale, h = ih * scale, align = type === 2 ? 0 : type === 4 ? 1 : .5; left += (availableWidth - w) * align; top += (availableHeight - h) * align; right = left + w; bottom = top + h; }
        }
        dispatch(runtime, DRAWABLE, 'setBounds', ['I', 'I', 'I', 'I'], 'V', drawable, [Math.round(left), Math.round(top), Math.round(right), Math.round(bottom)]);
        dispatch(runtime, DRAWABLE, 'draw', [CANVAS], 'V', drawable, [canvas]);
      }
      if (view.switchState) switchHost.draw(runtime, receiver, canvas, width, height);
      view.drawableSVG = view.backgroundDrawable || view.imageDrawable || view.switchState ? graphics.snapshotCanvas(canvas, width, height) : null;
      if(view.foregroundDrawable){
        if(!view.foregroundCanvas){view.foregroundCanvas=runtime.allocate(CANVAS);dispatch(runtime,CANVAS,'<init>',[],'V',view.foregroundCanvas);}
        const foreground=prepareCpuAnimatedVector(runtime,view.foregroundDrawable),rect='Landroid/graphics/Rect;',gravity='Landroid/view/Gravity;';
        if(!runtime.classes.has(gravity))fail('Foreground positioning requires the original AOSP Gravity source profile');
        const bounds=view.foregroundRects??=Array.from({length:2},()=>{const ref=runtime.allocate(rect);dispatch(runtime,rect,'<init>',[],'V',ref,[],'direct');return ref;});
        const inside=view.foregroundInsidePadding!==false;
        dispatch(runtime,rect,'set',['I','I','I','I'],'V',bounds[0],inside?[0,0,width,height]:[padding.left,padding.top,width-padding.right,height-padding.bottom]);
        const iw=dispatch(runtime,DRAWABLE,'getIntrinsicWidth',[],'I',foreground),ih=dispatch(runtime,DRAWABLE,'getIntrinsicHeight',[],'I',foreground);
        runtime.dispatch({owner:gravity,name:'apply',parameters:['I','I','I',rect,rect,'I'],result:'V',signature:`(III${rect}${rect}I)V`},[view.foregroundGravity??119,iw,ih,bounds[0],bounds[1],view.layoutDirection??0],'static');
        dispatch(runtime,DRAWABLE,'setBounds',[rect],'V',foreground,[bounds[1]]);
        const read=name=>runtime.object(bounds[1]).fields.get(`${rect}->${name}:I`)??0;
        view.foregroundBounds=Object.fromEntries(['left','top','right','bottom'].map(name=>[name,read(name)]));
        graphics.resetCanvas(view.foregroundCanvas,width,height);dispatch(runtime,DRAWABLE,'draw',[CANVAS],'V',foreground,[view.foregroundCanvas]);
        view.foregroundSVG=graphics.snapshotCanvas(view.foregroundCanvas,width,height);view.foregroundBoundsChanged=false;
      }else{view.foregroundSVG=null;view.foregroundBounds=null;}
      if(view.buttonDrawable){if(!view.buttonCanvas){view.buttonCanvas=runtime.allocate(CANVAS);dispatch(runtime,CANVAS,'<init>',[],'V',view.buttonCanvas);}const bounds=buttonBounds(runtime,receiver,width,height),iw=bounds.right-bounds.left,ih=bounds.bottom-bounds.top;if(iw<=0||ih<=0||iw>4096||ih>4096)fail('CompoundButton indicator needs bounded positive intrinsic dimensions');graphics.resetCanvas(view.buttonCanvas,iw,ih);const raw=n=>{const d=new DataView(new ArrayBuffer(4));d.setFloat32(0,n,true);return d.getInt32(0,true);};dispatch(runtime,CANVAS,'translate',['F','F'],'V',view.buttonCanvas,[raw(-bounds.left),raw(-bounds.top)]);drawButton(runtime,receiver,view.buttonCanvas,width,height);view.buttonSVG=graphics.snapshotCanvas(view.buttonCanvas,iw,ih);view.compoundPadding=compoundPadding(runtime,receiver);}else{view.buttonSVG=null;view.buttonBounds=null;view.compoundPadding=null;}
      view.needsDrawableDraw = false;
      runtime.record('DRAWABLE View.draw -> original Drawable DEX -> web Canvas commands');
    } finally { view.drawingDrawable = false; }
  };
  // View.setBackgroundDrawable: a Drawable that reports padding replaces the View padding (explicit padding attributes are re-applied by the constructor path).
  const adoptBackgroundPadding = (runtime, receiver, drawable) => {
    const view = runtime.object(receiver), rect = runtime.allocate('Landroid/graphics/Rect;'); dispatch(runtime, 'Landroid/graphics/Rect;', '<init>', [], 'V', rect, [], 'direct');
    if (!dispatch(runtime, DRAWABLE, 'getPadding', ['Landroid/graphics/Rect;'], 'Z', drawable, [rect])) return;
    const read = name => runtime.object(rect).fields.get(`Landroid/graphics/Rect;->${name}:I`) ?? 0, next = { left: read('left'), top: read('top'), right: read('right'), bottom: read('bottom') };
    const previous = view.padding || {}; if (['left', 'top', 'right', 'bottom'].every(edge => (previous[edge] || 0) === next[edge])) return;
    view.padding = next; platform.syncViewFields?.(runtime, receiver); dispatch(runtime, VIEW, 'requestLayout', [], 'V', receiver);
  };
  // The framework class's own default style attribute (Switch(Context,AttributeSet) passes R.attr.switchStyle, not buttonStyle, even though the host models CompoundButton under Button).
  const defaultStyleName = (runtime, type) => {
    const is = name => runtime.isSubtype(type, `Landroid/widget/${name};`);
    return is('Switch') ? 'attr/switchStyle' : is('CheckBox') ? 'attr/checkboxStyle' : is('RadioButton') ? 'attr/radioButtonStyle' : is('ToggleButton') ? 'attr/buttonStyleToggle' : is('EditText') ? 'attr/editTextStyle' : is('CompoundButton') ? 'attr/compoundButtonStyle' : is('Button') ? 'attr/buttonStyle' : 'attr/textViewStyle';
  };
  /** View/TextView constructor semantics for style-provided android:background and android:padding* (theme -> defStyleAttr -> style). */
  const applyThemeDefaults = (runtime, receiver, attrsRef = null) => {
    const view = runtime.object(receiver), table = platform.resources?.frameworkTable;
    // Style backgrounds are drawn/measured by the VM only when a Skia backend and TypedArray source are present; otherwise the page lays the View out (legacy flow mode).
    if (!table || !platform.resources.frameworkXml || !view.context || !runtime.skia || !runtime.classes.has('Landroid/content/res/TypedArray;')) return;
    const text = runtime.isSubtype(view.type, TEXT);
    const defStyle = view.defStyleAttr || (text ? table.findId(defaultStyleName(runtime, view.type)) : 0);
    if (!defStyle) return;
    const names = ['background', 'padding', 'paddingLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'elevation', 'translationZ', 'stateListAnimator'], ids = runtime.newArray('[I', names.length); runtime.object(ids).elements = names.map(name => table.findId('attr/' + name));
    const theme = platform.styleBackend.theme(runtime, view.context), array = platform.styleBackend.obtain(runtime, theme, null, ids, defStyle), TA = 'Landroid/content/res/TypedArray;';
    try {
      const has = index => dispatch(runtime, TA, 'hasValue', ['I'], 'Z', array, [index]);
      if (has(0)) { const drawable = dispatch(runtime, TA, 'getDrawable', ['I'], DRAWABLE, array, [0]); if (drawable) setDrawable(runtime, receiver, 'backgroundDrawable', drawable); }
      const dimension = index => dispatch(runtime, TA, 'getDimensionPixelSize', ['I', 'I'], 'I', array, [index, -1]);
      const padding = { ...(view.padding || { left: 0, top: 0, right: 0, bottom: 0 }) };
      if (has(1)) { const all = dimension(1); if (all >= 0) for (const edge of ['left', 'top', 'right', 'bottom']) padding[edge] = all; }
      ['left', 'top', 'right', 'bottom'].forEach((edge, i) => { if (has(2 + i)) { const value = dimension(2 + i); if (value >= 0) padding[edge] = value; } });
      view.padding = padding;
      // View constructor: elevation / translationZ / stateListAnimator attributes (Widget.Material.Button sets button_state_list_anim_material).
      const bitsOf = value => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, value, true); return d.getInt32(0, true); }, floatOf = raw => { const d = new DataView(new ArrayBuffer(4)); d.setInt32(0, raw, true); return d.getFloat32(0, true); };
      if (has(6)) { const value = floatOf(dispatch(runtime, TA, 'getDimension', ['I', 'F'], 'F', array, [6, bitsOf(0)])); if (value !== 0) dispatch(runtime, VIEW, 'setElevation', ['F'], 'V', receiver, [bitsOf(value)]); }
      if (has(7)) { const value = floatOf(dispatch(runtime, TA, 'getDimension', ['I', 'F'], 'F', array, [7, bitsOf(0)])); if (value !== 0) dispatch(runtime, VIEW, 'setTranslationZ', ['F'], 'V', receiver, [bitsOf(value)]); }
      if (has(8)) { const id = dispatch(runtime, TA, 'getResourceId', ['I', 'I'], 'I', array, [8, 0]); if (id) { const owner = 'Landroid/animation/AnimatorInflater;', animator = runtime.dispatch({ owner, name: 'loadStateListAnimator', signature: '(Landroid/content/Context;I)Landroid/animation/StateListAnimator;', parameters: ['Landroid/content/Context;', 'I'], result: 'Landroid/animation/StateListAnimator;' }, [view.context, id], 'static'); dispatch(runtime, VIEW, 'setStateListAnimator', ['Landroid/animation/StateListAnimator;'], 'V', receiver, [animator]); } }
    } finally { dispatch(runtime, TA, 'recycle', [], 'V', array); }
    switchHost.attributes(runtime, receiver, attrsRef, defStyle);
  };
  const setDrawable = (runtime, receiver, field, drawable) => {
    const view = runtime.object(receiver), previous = view[field];if(drawable)prepareCpuAnimatedVector(runtime,drawable);
    if (previous && !same(previous, drawable)) dispatch(runtime, DRAWABLE, 'setCallback', ['Landroid/graphics/drawable/Drawable$Callback;'], 'V', previous, [null]);
    view[field] = drawable;
    if (field === 'backgroundDrawable' && drawable) {
      // View.setBackgroundDrawable: layout direction, current drawable state, then padding adoption.
      dispatch(runtime, DRAWABLE, 'setLayoutDirection', ['I'], 'Z', drawable, [view.layoutDirection ?? 0]);
      if (dispatch(runtime, DRAWABLE, 'isStateful', [], 'Z', drawable)) dispatch(runtime, DRAWABLE, 'setState', ['[I'], 'Z', drawable, [dispatch(runtime, VIEW, 'getDrawableState', [], '[I', receiver)]);
      adoptBackgroundPadding(runtime, receiver, drawable);
    }
    if (drawable) { if(field==='foregroundDrawable'){dispatch(runtime,DRAWABLE,'setLayoutDirection',['I'],'Z',drawable,[view.layoutDirection??0]);if(dispatch(runtime,DRAWABLE,'isStateful',[],'Z',drawable))dispatch(runtime,DRAWABLE,'setState',['[I'],'Z',drawable,[dispatch(runtime,VIEW,'getDrawableState',[],'[I',receiver)]);if(view.attached)dispatch(runtime,DRAWABLE,'setVisible',['Z','Z'],'Z',drawable,[view.visibility===4||view.visibility===8?0:1,0]);} dispatch(runtime, DRAWABLE, 'setCallback', ['Landroid/graphics/drawable/Drawable$Callback;'], 'V', drawable, [receiver]); if (field === 'imageDrawable' && view.imageAlpha !== undefined) dispatch(runtime, DRAWABLE, 'setAlpha', ['I'], 'V', drawable, [view.imageAlpha]); }
    render(runtime, receiver);
    if(field==='foregroundDrawable'){platform.requestDraw(runtime,receiver);dispatch(runtime,VIEW,'requestLayout',[],'V',receiver);}
  };
  return {
    compoundPadding,drawButton,applyThemeDefaults,defaultStyleName,switchWidget:(runtime,receiver)=>switchHost.get(runtime,receiver),measureSwitch:(runtime,receiver)=>switchHost.measure(runtime,receiver),checkedChanged:(runtime,receiver,checked)=>switchHost.checkedChanged(runtime,receiver,checked),
    setForegroundFromXML(runtime,receiver,attribute,context){
      const theme=platform.styleBackend.theme(runtime,context),reference=attribute.kind==='attribute'?platform.styleBackend.resolved(attribute,runtime.object(theme).themeValues,false):attribute;
      let drawable=null;
      if(reference.kind==='reference'){if(reference.reference!==0)drawable=platform.styleBackend.loadDrawable(runtime,reference.reference,theme);}
      else if(reference.kind==='color'){const owner='Landroid/graphics/drawable/ColorDrawable;';drawable=runtime.allocate(owner);dispatch(runtime,owner,'<init>',['I'],'V',drawable,[reference.rawData|0],'direct');}
      else if(reference.kind!=='null')fail('XML foreground requires a real color or Drawable resource');
      return setDrawable(runtime,receiver,'foregroundDrawable',drawable);
    },
    supports: key => keys.has(key) || ninePatch.supports(key) || switchHost.supports(key), canAllocate: type => type === IMAGE || ninePatch.canAllocate(type),
    parent: type => type === IMAGE ? VIEW : ninePatch.parent(type),
    interfaces: type => type === VIEW || type === IMAGE ? ['Landroid/graphics/drawable/Drawable$Callback;'] : [],
    viewKind(runtime, object) { return runtime.isSubtype(object.type, IMAGE) ? 'image' : null; },
    drawTree(runtime, root, seen = new Set()) { if (!root) return; const view = runtime.object(root); if (seen.has(view.id) || seen.size >= 4096) fail('Cyclic/excessive drawable frame'); seen.add(view.id); if (view.visibility === 8 || view.visibility === 4) return; if (view.imageDrawable || view.backgroundDrawable || view.foregroundDrawable || view.buttonDrawable || view.switchState) render(runtime, root); for (const child of view.children || []) this.drawTree(runtime, child, seen); },
    afterAttach(runtime, receiver) { const view = runtime.object(receiver); if (runtime.isSubtype(view.type, IMAGE) || view.backgroundDrawable || view.foregroundDrawable || view.buttonDrawable || view.stateListAnimator || view.switchState) this.invoke(runtime, { owner: VIEW, name: 'refreshDrawableState' }, [receiver]); },
    afterLayout(runtime, receiver) { const view = runtime.object(receiver); if (view.imageDrawable || view.backgroundDrawable || view.foregroundDrawable || view.buttonDrawable || view.switchState) render(runtime, receiver); },
    invoke(runtime, method, args) {
      const name = method.name;
      if (ninePatch.handles(method.owner)) return ninePatch.invoke(runtime, method, args);
      if (method.owner === 'Landroid/widget/Switch;' && switchHost.supports(`${method.owner}->${method.name}${method.signature}`)) return switchHost.invoke(runtime, method, args);
      if (name === 'mergeDrawableStates') { const base = runtime.array(args[0]).elements, extra = runtime.array(args[1]).elements; let count = base.length; while (count > 0 && base[count - 1] === 0) count--; if (count + extra.length > base.length) runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', 'Drawable state merge exceeds allocated extra space'); for (let i = 0; i < extra.length; i++) base[count + i] = extra[i]; return args[0]; }
      const view = runtime.object(args[0]);
      if(name==='getCompoundPaddingLeft'||name==='getCompoundPaddingRight'){const pad=method.owner===COMPOUND?compoundPadding(runtime,args[0]):null;return (pad??view.padding??{})[name.endsWith('Left')?'left':'right']??0;}
      if(name==='getButtonDrawable')return view.buttonDrawable??null;
      if(name==='setButtonDrawable'){
        const value=method.parameters?.[0]==='I'?(args[1]?platform.styleBackend.loadDrawable(runtime,args[1],platform.styleBackend.theme(runtime,view.context)):null):args[1]||null;
        if(same(view.buttonDrawable,value)||!view.buttonDrawable&&!value)return;if(view.buttonDrawable)dispatch(runtime,DRAWABLE,'setCallback',['Landroid/graphics/drawable/Drawable$Callback;'],'V',view.buttonDrawable,[null]);view.buttonDrawable=value;
        if(value){prepareCpuAnimatedVector(runtime,value);dispatch(runtime,DRAWABLE,'setCallback',['Landroid/graphics/drawable/Drawable$Callback;'],'V',value,[args[0]]);dispatch(runtime,DRAWABLE,'setLayoutDirection',['I'],'Z',value,[view.layoutDirection??0]);if(dispatch(runtime,DRAWABLE,'isStateful',[],'Z',value))dispatch(runtime,DRAWABLE,'setState',['[I'],'Z',value,[dispatch(runtime,VIEW,'getDrawableState',[],'[I',args[0])]);dispatch(runtime,DRAWABLE,'setVisible',['Z','Z'],'Z',value,[view.visibility===4||view.visibility===8?0:1,0]);dispatch(runtime,VIEW,'setMinimumHeight',['I'],'V',args[0],[dispatch(runtime,DRAWABLE,'getIntrinsicHeight',[],'I',value)]);applyButtonTint(runtime,args[0]);}render(runtime,args[0]);platform.requestDraw(runtime,args[0]);return;
      }
      if(name==='getButtonTintList')return view.buttonTintList??null;
      if(name==='getButtonTintBlendMode')return view.buttonTintBlendMode??null;
      if(name==='getButtonTintMode')return runtime.dispatch({owner:BLEND,name:'blendModeToPorterDuffMode',parameters:[BLEND],result:MODE,signature:`(${BLEND})${MODE}`},[view.buttonTintBlendMode??null],'static');
      if(name==='setButtonTintList'){view.hasButtonTint=true;view.buttonTintList=args[1]||null;applyButtonTint(runtime,args[0]);render(runtime,args[0]);return;}
      if(name==='setButtonTintMode'||name==='setButtonTintBlendMode'){view.hasButtonBlendMode=true;view.buttonTintBlendMode=name==='setButtonTintMode'?(args[1]?runtime.dispatch({owner:BLEND,name:'fromValue',parameters:['I'],result:BLEND,signature:`(I)${BLEND}`},[runtime.object(args[1]).fields.get(`${MODE}->nativeInt:I`)],'static'):null):args[1]||null;applyButtonTint(runtime,args[0]);render(runtime,args[0]);return;}
      if (name === 'setImageState') { if (args[1] && runtime.array(args[1]).elements.length > 1024) fail('Image state exceeds 1024 attributes'); view.imageState = args[1]; view.mergeImageState = !!args[2]; if (view.imageDrawable) dispatch(runtime, VIEW, 'refreshDrawableState', [], 'V', args[0]); return; }
      if (name === 'getDrawableState') { if (!view.drawableStateRef || view.drawableStateDirty) { view.drawableStateRef = dispatch(runtime, runtime.isSubtype(view.type, IMAGE) ? IMAGE : VIEW, 'onCreateDrawableState', ['I'], '[I', args[0], [0]); view.drawableStateDirty = false; } return view.drawableStateRef; }
      if (name === 'onCreateDrawableState') {
        if (!Number.isInteger(args[1]) || args[1] < 0 || args[1] > 1024) fail('Invalid drawable state extra space');
        if (method.owner === IMAGE && view.imageState && !view.mergeImageState) return view.imageState;
        const extra = method.owner === IMAGE && view.imageState ? runtime.array(view.imageState).elements : [];
        const states = []; if (view.windowFocused !== false && view.attached) states.push(16842909); if (view.enabled !== false) states.push(16842910); if (view.focused) states.push(16842908); if (view.selected) states.push(16842913); if (view.pressed) states.push(16842919); if (view.checked) states.push(16842912);
        const result = runtime.newArray('[I', states.length + args[1] + extra.length); runtime.object(result).elements.splice(0, states.length, ...states);
        if (extra.length) return this.invoke(runtime, { owner: VIEW, name: 'mergeDrawableStates' }, [result, view.imageState]); return result;
      }
      if (name === 'refreshDrawableState') { view.drawableStateDirty = true; return dispatch(runtime, runtime.isSubtype(view.type, IMAGE) ? IMAGE : VIEW, 'drawableStateChanged', [], 'V', args[0]); }
      if (name === 'drawableStateChanged') {
        for (const drawable of [view.backgroundDrawable, view.foregroundDrawable, view.buttonDrawable, ...(method.owner === IMAGE ? [view.imageDrawable] : [])]) if (drawable && dispatch(runtime, DRAWABLE, 'isStateful', [], 'Z', drawable)) { prepareCpuAnimatedVector(runtime,drawable);const state = dispatch(runtime, VIEW, 'getDrawableState', [], '[I', args[0]); dispatch(runtime, DRAWABLE, 'setState', ['[I'], 'Z', drawable, [state]); }
        switchHost.stateChanged(runtime, args[0]);
        if (view.stateListAnimator) dispatch(runtime, 'Landroid/animation/StateListAnimator;', 'setState', ['[I'], 'V', view.stateListAnimator, [dispatch(runtime, VIEW, 'getDrawableState', [], '[I', args[0])]);
        return;
      }
      if (name === '<init>') { dispatch(runtime, VIEW, '<init>', ['Landroid/content/Context;'], 'V', args[0], [args[1]], 'direct'); if (args[2]) { const node = runtime.object(args[2]).node; if (node) platform.inflate(runtime, node, args[1], 0, { existing: args[0], applyOnly: true }); } return; }
      if (name === 'scheduleDrawable' || name === 'unscheduleDrawable') {
        // View.scheduleDrawable: run the Drawable's Runnable at its uptime on the VM task queue; unschedule cancels it (animated state-list transitions, AnimationDrawable).
        const pending = view.scheduledDrawables ??= new Map();
        if (name === 'unscheduleDrawable') { for (const [key, token] of [...pending]) if (args[2] === undefined ? key.who === args[1].ref : key.who === args[1].ref && key.what === args[2]?.ref) { token.cancelled = true; pending.delete(key); } return; }
        if (!args[2] || !args[1]) return; const now = runtime.dispatch({ owner: 'Landroid/os/SystemClock;', name: 'uptimeMillis', signature: '()J', parameters: [], result: 'J' }, [], 'static'), delay = Math.max(0, Number(BigInt(args[3]) - BigInt(now)));
        const key = { who: args[1].ref, what: args[2].ref }, token = { cancelled: false }; for (const [other, value] of [...pending]) if (other.who === key.who && other.what === key.what) { value.cancelled = true; pending.delete(other); }
        pending.set(key, token); platform.queueTask(() => { if (token.cancelled) return; pending.delete(key); dispatch(runtime, 'Ljava/lang/Runnable;', 'run', [], 'V', args[2]); }, delay, [args[1], args[2]]); return;
      }
      if (name === 'setPressed') { const pressed = !!args[1]; if (!!view.pressed === pressed) return; view.pressed = pressed; dispatch(runtime, VIEW, 'refreshDrawableState', [], 'V', args[0]); platform.requestDraw(runtime, args[0]); return; }
      if (name === 'isPressed') return view.pressed ? 1 : 0;
      if (name === 'getStateListAnimator') return view.stateListAnimator ?? null;
      if (name === 'setStateListAnimator') {
        // View.setStateListAnimator: retarget, then evaluate the current drawable state when attached.
        const SLA = 'Landroid/animation/StateListAnimator;', next = args[1] || null; if (same(view.stateListAnimator, next) || !view.stateListAnimator && !next) return;
        if (view.stateListAnimator) dispatch(runtime, SLA, 'setTarget', ['Landroid/view/View;'], 'V', view.stateListAnimator, [null]);
        view.stateListAnimator = next;
        if (next) { dispatch(runtime, SLA, 'setTarget', ['Landroid/view/View;'], 'V', next, [args[0]]); if (view.attached) dispatch(runtime, SLA, 'setState', ['[I'], 'V', next, [dispatch(runtime, VIEW, 'getDrawableState', [], '[I', args[0])]); }
        return;
      }
      if (name === 'jumpDrawablesToCurrentState') { for (const drawable of [view.backgroundDrawable, view.foregroundDrawable, view.buttonDrawable]) if (drawable) dispatch(runtime, DRAWABLE, 'jumpToCurrentState', [], 'V', drawable); if (view.stateListAnimator) dispatch(runtime, 'Landroid/animation/StateListAnimator;', 'jumpToCurrentState', [], 'V', view.stateListAnimator); switchHost.jump(runtime, args[0]); return; }
      if (name === 'invalidate') return platform.requestDraw(runtime, args[0]);
      if (name === 'setForeground') return setDrawable(runtime,args[0],'foregroundDrawable',args[1]);
      if (name === 'getForeground') return view.foregroundDrawable || null;
      if (name === 'getDrawable') return view.imageDrawable || null;
      if (name === 'getBackground') return view.backgroundDrawable || null;
      if (name === 'setContentDescription') { view.contentDescription = args[1]; return; }
      if (name === 'getContentDescription') return view.contentDescription || null;
      if (name === 'setImageAlpha' || name === 'setAlpha') { view.imageAlpha = args[1] & 255; if (view.imageDrawable) dispatch(runtime, DRAWABLE, 'setAlpha', ['I'], 'V', view.imageDrawable, [view.imageAlpha]); render(runtime, args[0]); return; }
      if (name === 'setImageResource' || name === 'setBackgroundResource') { const drawable = args[1] ? platform.styleBackend.loadDrawable(runtime, args[1], platform.styleBackend.theme(runtime, view.context)) : null; return setDrawable(runtime, args[0], name === 'setImageResource' ? 'imageDrawable' : 'backgroundDrawable', drawable); }
      if (name === 'setImageDrawable' || name === 'setBackground' || name === 'setBackgroundDrawable') return setDrawable(runtime, args[0], name === 'setImageDrawable' ? 'imageDrawable' : 'backgroundDrawable', args[1]);
      if (name === 'verifyDrawable') return same(args[1], view.imageDrawable) || same(args[1], view.backgroundDrawable) || same(args[1], view.foregroundDrawable) || same(args[1],view.buttonDrawable) ? 1 : 0;
      if (name === 'invalidateDrawable') { if (same(args[1], view.imageDrawable) || same(args[1], view.backgroundDrawable) || same(args[1], view.foregroundDrawable)||same(args[1],view.buttonDrawable)){if(view.drawingDrawable){view.needsDrawableDraw=true;platform.requestDraw(runtime,args[0],1000/60);}else{render(runtime,args[0]);platform.requestDraw(runtime,args[0]);}} return; }
      fail('Unknown Drawable View method ' + name);
    },
  };
}
