import {APKError} from './apk-runtime.js?v=0c9f1b0d2456';
const VIEW='Landroid/view/View;',PROVIDER='Landroid/view/ViewOutlineProvider;',OUTLINE='Landroid/graphics/Outline;',RECT='Landroid/graphics/Rect;',PATH='Landroid/graphics/Path;',CANVAS='Landroid/graphics/Canvas;';
const keys=new Set(['setOutlineProvider('+PROVIDER+')V','getOutlineProvider()'+PROVIDER,'invalidateOutline()V','setClipToOutline(Z)V','getClipToOutline()Z','setClipBounds('+RECT+')V','getClipBounds()'+RECT,'getClipBounds('+RECT+')Z'].map(signature=>VIEW+'->'+signature));
const bits=new DataView(new ArrayBuffer(4)),encode=value=>{bits.setFloat32(0,value,true);return bits.getInt32(0,true);},decode=value=>{bits.setInt32(0,value,true);return bits.getFloat32(0,true);};
const fail=message=>{throw new APKError(message,{kind:'view-outline-boundary'});};
const call=(r,receiver,owner,name,p=[],result='V',args=[],mode='virtual')=>r.dispatch({owner,name,parameters:p,result,signature:`(${p.join('')})${result}`},r.argumentWords(p,args,{receiver}),mode);
const make=(r,type)=>{const value=r.allocate(type);call(r,value,type,'<init>',[],'V',[],'direct');return value;};
const rectangle=(r,value)=>['left','top','right','bottom'].map(name=>r.object(value).fields.get(`${RECT}->${name}:I`)??0);
export function createViewOutlineHost(platform){
 const provider=(r,view)=>{
  if(view.outlineProvider!==undefined)return view.outlineProvider;
  if(!r.dex.bootClasses?.has(PROVIDER))fail('Original ViewOutlineProvider DEX is required');
  return r.readStatic({owner:PROVIDER,name:'BACKGROUND',type:PROVIDER,key:`${PROVIDER}->BACKGROUND:${PROVIDER}`});
 };
 const outline=(r,receiver)=>{
  const view=r.object(receiver),source=provider(r,view);if(!source)return null;
  const target=view.webOutline??=make(r,OUTLINE);
  call(r,target,OUTLINE,'setEmpty');call(r,target,OUTLINE,'setAlpha',['F'],'V',[encode(1)]);
  call(r,source,PROVIDER,'getOutline',[VIEW,OUTLINE],'V',[receiver,target]);return target;
 };
 return{
  supports:key=>keys.has(key),
  /** Original Outline state for shadows: {rect,radius,alpha} or null when empty/none. Convex-path outlines fail explicitly. */
  /** The View's original Outline object (null without a provider); RenderNode.setOutline consumes it when a View is recorded into a display list. */
  outlineObject(r,receiver){return outline(r,receiver);},
  shape(r,receiver){
   const target=outline(r,receiver);if(!target||call(r,target,OUTLINE,'isEmpty',[],'Z'))return null;
   const fields=r.object(target).fields,mode=fields.get(`${OUTLINE}->mMode:I`),alpha=decode(fields.get(`${OUTLINE}->mAlpha:F`)??encode(1));
   if(mode===1)return{rect:rectangle(r,fields.get(`${OUTLINE}->mRect:${RECT}`)),radius:decode(fields.get(`${OUTLINE}->mRadius:F`)??0),alpha};
   fail('Shadows for convex-path View outlines are not connected to the View shadow raster yet');
  },
  clip(r,receiver,canvas){
   const view=r.object(receiver);
   if(view.clipBounds)call(r,canvas,CANVAS,'clipRect',['I','I','I','I'],'Z',view.clipBounds);
   if(!view.clipToOutline)return;
   const target=outline(r,receiver);if(!target||!call(r,target,OUTLINE,'canClip',[],'Z')||call(r,target,OUTLINE,'isEmpty',[],'Z'))return;
   const fields=r.object(target).fields,mode=fields.get(`${OUTLINE}->mMode:I`);
   if(mode===1){
    const rect=rectangle(r,fields.get(`${OUTLINE}->mRect:${RECT}`)),radius=decode(fields.get(`${OUTLINE}->mRadius:F`)??0);
    if(!Number.isFinite(radius))fail('Outline radius must be finite');
    if(radius<=0){call(r,canvas,CANVAS,'clipRect',['I','I','I','I'],'Z',rect);return;}
    const path=view.webOutlineClipPath??=make(r,PATH);call(r,path,PATH,'rewind');
    const direction='Landroid/graphics/Path$Direction;',cw=r.readStatic({owner:direction,name:'CW',type:direction,key:`${direction}->CW:${direction}`});
    call(r,path,PATH,'addRoundRect',['F','F','F','F','F','F',direction],'V',[...rect.map(encode),encode(radius),encode(radius),cw]);
    call(r,canvas,CANVAS,'clipPath',[PATH],'Z',[path]);return;
   }
   if(mode===2){const path=fields.get(`${OUTLINE}->mPath:${PATH}`)??fields.get(`${OUTLINE}->mConvexPath:${PATH}`);if(!path)fail('Original Outline path is absent');call(r,canvas,CANVAS,'clipPath',[PATH],'Z',[path]);return;}
   fail('Unsupported original Outline mode '+mode);
  },
  invoke(r,method,args){
   const view=r.object(args[0]),name=method.name;
   if(name==='getOutlineProvider')return provider(r,view);
   if(name==='setOutlineProvider'){if(args[1])r.object(args[1]);view.outlineProvider=args[1]||null;platform.requestDraw(r,args[0]);return;}
   if(name==='invalidateOutline'){platform.requestDraw(r,args[0]);return;}
   if(name==='getClipToOutline')return view.clipToOutline?1:0;
   if(name==='setClipToOutline'){view.clipToOutline=!!args[1];platform.requestDraw(r,args[0]);return;}
   if(name==='setClipBounds'){view.clipBounds=args[1]?rectangle(r,args[1]):null;platform.requestDraw(r,args[0]);return;}
   if(name==='getClipBounds'){
    if(!view.clipBounds)return method.parameters.length?0:null;
    const rect=method.parameters.length?args[1]:make(r,RECT);call(r,rect,RECT,'set',['I','I','I','I'],'V',view.clipBounds);return method.parameters.length?1:rect;
   }
   fail('Unknown View outline operation '+name);
  },
 };
}
