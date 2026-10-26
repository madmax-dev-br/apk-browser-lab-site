import {APKError} from './apk-error.js?v=6e138f531f83';
import {renderNodeProperties} from './rendernode-native.js?v=6e138f531f83';
const VIEW='Landroid/view/View;',VPA='Landroid/view/ViewPropertyAnimator;',NODE='Landroid/view/RenderNode;',INFO='Landroid/view/View$TransformationInfo;',PAINT='Landroid/graphics/Paint;',RUNNABLE='Ljava/lang/Runnable;';
const bits=new DataView(new ArrayBuffer(4)),encode=v=>{bits.setFloat32(0,v,true);return bits.getInt32(0,true);},decode=v=>{bits.setInt32(0,v,true);return bits.getFloat32(0,true);};
const fail=message=>{throw new APKError(message,{kind:'view-property-animator-boundary'});};
const keys=new Set(['animate()'+VPA,'ensureTransformationInfo()V','setAlphaNoInvalidation(F)Z','invalidateViewProperty(ZZ)V','invalidateParentCaches()V','invalidate(Z)V','setHasTransientState(Z)V','hasTransientState()Z'].map(s=>VIEW+'->'+s));
/** Host boundary for the original Android 9 ViewPropertyAnimator (framework-aosp/legacy-vpa).
 * The animator itself, its ValueAnimator, listeners and end actions are original Java DEX. The host View only supplies the
 * members that source reads: mRenderNode (the original RenderNode, whose native hwui properties are also the View transform
 * state through view-transform-host), mTransformationInfo.mAlpha, mLeft/mTop and the invalidation entry points.
 * RenderThread animation (ViewPropertyAnimatorRT) is never created by this source version, so no fake RT exists. */
export function createViewPropertyAnimatorHost(platform){
 const call=(r,receiver,owner,name,p=[],result='V',values=[],mode='virtual')=>r.dispatch({owner,name,parameters:p,result,signature:`(${p.join('')})${result}`},r.argumentWords(p,values,mode==='static'?{}:{receiver}),mode);
 const node=(r,receiver)=>{
  const view=r.object(receiver);if(view.viewRenderNode)return view.viewRenderNode;
  if(!r.dex.bootClasses?.has(NODE)||!r.skiaHost)fail('View.animate() requires the original RenderNode and the verified Skia backend');
  view.viewRenderNode=call(r,null,NODE,'create',['Ljava/lang/String;',VIEW],NODE,[view.type,receiver],'static');return view.viewRenderNode;
 };
 const sync=(r,receiver)=>{
  const view=r.object(receiver),ref=node(r,receiver),b=view.bounds??{left:0,top:0,right:0,bottom:0};
  call(r,ref,NODE,'setLeftTopRightBottom',['I','I','I','I'],'Z',[b.left,b.top,b.right,b.bottom]);
  r.storeField(view.fields,`${VIEW}->mLeft:I`,b.left);r.storeField(view.fields,`${VIEW}->mTop:I`,b.top);
  if(!view.fields.has(`${VIEW}->mPrivateFlags:I`))r.storeField(view.fields,`${VIEW}->mPrivateFlags:I`,0);
  platform.viewTransformHost.bindRenderNode(r,receiver,ref);
  r.storeField(view.fields,`${VIEW}->mRenderNode:${NODE}`,ref);
  let info=view.fields.get(`${VIEW}->mTransformationInfo:${INFO}`);
  if(!info){info=r.makeObject(INFO);r.storeField(view.fields,`${VIEW}->mTransformationInfo:${INFO}`,info);}
  r.storeField(r.object(info).fields,`${INFO}->mAlpha:F`,encode(view.alpha??1));
  return ref;
 };
 return{
  supports:key=>keys.has(key),
  invoke(r,method,args){
   const receiver=args[0],view=r.object(receiver),name=method.name;
   if(name==='ensureTransformationInfo'){sync(r,receiver);return;}
   if(name==='animate'){
    if(!r.dex.bootClasses?.has(VPA))fail('View.animate() requires the original ViewPropertyAnimator in the framework (legacy-vpa build)');
    sync(r,receiver);
    if(!view.viewPropertyAnimator){const a=r.allocate(VPA);call(r,a,VPA,'<init>',[VIEW],'V',[receiver],'direct');view.viewPropertyAnimator=a;}
    return view.viewPropertyAnimator;
   }
   if(name==='setAlphaNoInvalidation'){
    const alpha=decode(args[1]);if(!Number.isFinite(alpha))fail('Non-finite View alpha is unsupported by the web renderer');
    const info=r.object(view.fields.get(`${VIEW}->mTransformationInfo:${INFO}`)??fail('ensureTransformationInfo was not called')),old=decode(info.fields.get(`${INFO}->mAlpha:F`)??encode(1));
    if(old===alpha)return 0;
    r.storeField(info.fields,`${INFO}->mAlpha:F`,encode(alpha));view.alpha=alpha;
    view.alphaHandledByView=!!call(r,receiver,VIEW,'onSetAlpha',['I'],'Z',[Math.max(-2147483648,Math.min(2147483647,Math.trunc(Math.fround(alpha*255))))]);
    view.renderAlpha=view.alphaHandledByView?1:Math.fround(alpha*(view.transitionAlpha??1));
    renderNodeProperties(r,view.viewRenderNode).alpha=Math.max(0,Math.min(1,view.renderAlpha));
    return view.alphaHandledByView?1:0;
   }
   if(name==='invalidateViewProperty'||name==='invalidateParentCaches'||name==='invalidate'){platform.requestDraw(r,receiver);return;}
   if(name==='setHasTransientState'){
    const count=(view.transientStateCount??0)+(args[1]?1:-1);
    if(count<0)fail('Unbalanced View.setHasTransientState(false)');view.transientStateCount=count;return;
   }
   if(name==='hasTransientState')return (view.transientStateCount??0)>0?1:0;
   fail('Unknown View property animator operation '+name);
  },
 };
}
