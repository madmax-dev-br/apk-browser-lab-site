import {APKError} from './apk-error.js?v=91b59af8dcf0';
import {getVectorGraphics} from './vector-native.js?v=91b59af8dcf0';
const AVD='Landroid/graphics/drawable/AnimatedVectorDrawable;';
/** Original AVD constructs an RT set before choosing its CPU fallback. The set
 * has real, bounded VM allocation/refcount ownership, but no RT executor (rtAnimatorBindings). Java/UI animation is selected
 * explicitly through the original Java method after resource inflation, or by the original software-Canvas fallback at the first draw. */
const PVH='Landroid/animation/PropertyValuesHolder;';
/** Real JNI GetMethodID/Call<Void>Method semantics for PropertyValuesHolder's
 * single-argument int/float setters: the id names a looked-up setter, and the call
 * is a normal virtual dispatch of that original Java method on the target. */
function pvhJniBindings(){
 const table=(runtime)=>runtime.propertyValuesHolderJni??=new Map(),bindings=[];
 for(const [kind,type] of [['Int','I'],['Float','F']]){
  bindings.push([`${PVH}->nGet${kind}Method(Ljava/lang/Class;Ljava/lang/String;)J`,(runtime,[targetClass,name])=>{
   const owner=runtime.object(targetClass).classType;if(!owner)throw new APKError('PropertyValuesHolder JNI lookup requires a Class',{kind:'animated-vector-backend'});
   let found=null;
   // Platform-bridged classes (android.view.View and widgets): the setter is a bridge key, e.g. View.setElevation(F)V used by StateListAnimator.
   for(let at=owner,seen=0;at&&!found&&seen<64;at=runtime.parent(at),seen++)if(runtime.platform?.supports?.(`${at}->${name}(${type})V`))found={method:{owner:at,name,parameters:[type],result:'V',signature:`(${type})V`,key:`${at}->${name}(${type})V`}};
   if(!found)try{found=runtime.reflectionLookup(owner,'method',name,[type],false);}catch(error){if(!(error?.value))throw error;}
   if(!found||found.method.result!=='V')runtime.throwJava('Ljava/lang/NoSuchMethodError;',`${name}(${type})V`);
   const handles=table(runtime),id=handles.size+1;handles.set(id,found.method);return BigInt(id);
  }],[`${PVH}->nCall${kind}Method(Ljava/lang/Object;J${type})V`,(runtime,[target,id,value])=>{
   const method=table(runtime).get(Number(id));if(!method)throw new APKError('Invalid PropertyValuesHolder JNI method id',{kind:'animated-vector-backend'});runtime.object(target);
   runtime.dispatch(method,runtime.argumentWords(method.parameters,[value],{receiver:target}),'virtual');
  }]);
 }
 return bindings;
}
/** VectorDrawableAnimatorRT.init builds its RenderThread animators before anything is drawn: one property holder per animated property (nCreate*PropertyHolder, with
 * keyframe data from nSetPropertyHolderData), one native animator per child (nAddAnimator) and the tree they drive (nSetVectorDrawableTarget). Here they are bounded
 * records of the set with no executor: a start with no RenderNode seen yet is a pending action of the original Java, and the first draw on the software Canvas of this
 * device takes AnimatedVectorDrawable.fallbackOntoUI(), which re-runs the same animators on the UI thread (what Android does for a software layer). What would really
 * run them on the RenderThread (nStart/nReverse/nEnd/nReset: only reached with a RenderNode target, which a software window never records) is not bound and fails by
 * name as every missing native does. */
function rtAnimatorBindings(){
 const graphics=runtime=>getVectorGraphics(runtime),holder=(runtime,fields)=>{const g=graphics(runtime),state=runtime.avdRtState??={holders:0};if(++state.holders>65536)throw new APKError('AnimatedVectorDrawable RenderThread property holders exceed 65536',{kind:'animated-vector-backend'});return g.create('animatedVectorPropertyHolder',{...fields,data:null});};
 const set=(runtime,handle)=>graphics(runtime).get(handle,'animatedVectorAnimatorSet');
 return [
  [`${AVD}->nCreateGroupPropertyHolder(JIFF)J`,(runtime,[tree,property,start,end])=>holder(runtime,{holderKind:'group',tree,property,start,end})],
  [`${AVD}->nCreatePathDataPropertyHolder(JJJ)J`,(runtime,[path,start,end])=>holder(runtime,{holderKind:'pathData',path,start,end})],
  [`${AVD}->nCreatePathColorPropertyHolder(JIII)J`,(runtime,[path,property,start,end])=>holder(runtime,{holderKind:'pathColor',path,property,start,end})],
  [`${AVD}->nCreatePathPropertyHolder(JIFF)J`,(runtime,[path,property,start,end])=>holder(runtime,{holderKind:'path',path,property,start,end})],
  [`${AVD}->nCreateRootAlphaPropertyHolder(JFF)J`,(runtime,[tree,start,end])=>holder(runtime,{holderKind:'rootAlpha',tree,start,end})],
  [`${AVD}->nSetPropertyHolderData(J[FI)V`,(runtime,[handle,data,length])=>{const array=runtime.array(data);if(length<0||length>array.elements.length||length>65536)runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;',null);graphics(runtime).get(handle,'animatedVectorPropertyHolder').data=array.elements.slice(0,length);}],
  [`${AVD}->nSetPropertyHolderData(J[II)V`,(runtime,[handle,data,length])=>{const array=runtime.array(data);if(length<0||length>array.elements.length||length>65536)runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;',null);graphics(runtime).get(handle,'animatedVectorPropertyHolder').data=array.elements.slice(0,length);}],
  [`${AVD}->nAddAnimator(JJJJJII)V`,(runtime,[setHandle,holderHandle,interpolator,startDelay,duration,repeatCount,repeatMode])=>{const value=set(runtime,setHandle);graphics(runtime).get(holderHandle,'animatedVectorPropertyHolder');if(value.animators.length>=4096)throw new APKError('AnimatedVectorDrawable RenderThread animators exceed 4096 per set',{kind:'animated-vector-backend'});value.animators.push({holder:holderHandle,interpolator,startDelay,duration,repeatCount,repeatMode});}],
  [`${AVD}->nSetVectorDrawableTarget(JJ)V`,(runtime,[setHandle,tree])=>{set(runtime,setHandle).target=tree;}],
 ];
}
export function createAnimatedVectorNativeBindings(){
 return new Map([...pvhJniBindings(),...rtAnimatorBindings(),[`${AVD}->nCreateAnimatorSet()J`,runtime=>{
  const value=getVectorGraphics(runtime).create('animatedVectorAnimatorSet',{animators:[],target:null,started:false,executionBackend:null});
  runtime.record('HOST AnimatedVectorDrawable native set allocation [opaque VM ownership; RenderThread executor unavailable]');return value;
 }]]);
}
export function prepareCpuAnimatedVector(runtime,drawable){
 const seen=new Set(),walk=(value,depth=0)=>{
  if(!value)return;if(depth>64||seen.size>=4096)throw new APKError('Animated drawable CPU preparation exceeds bounded resource tree',{kind:'animated-vector-backend'});if(seen.has(value.ref))return;seen.add(value.ref);
  const type=runtime.typeOf(value),object=runtime.object(value),call=(owner,name,p,result,args=[])=>runtime.dispatch({owner,name,parameters:p,result,signature:`(${p.join('')})${result}`},runtime.argumentWords(p,args,{receiver:value}),'virtual');
  if(runtime.isSubtype(type,AVD)){
   if(object.cpuAnimationPolicyApplied)return;if(!runtime.skiaHost)throw new APKError('AnimatedVectorDrawable CPU selection requires the verified Skia Canvas backend',{kind:'animated-vector-backend'});
   call(AVD,'forceAnimationOnUI',[],'V');object.cpuAnimationPolicyApplied=true;
   runtime.record('GRAPHICS_POLICY AnimatedVectorDrawable.forceAnimationOnUI [original Java UI animator; software Skia window; no RenderThread execution]');return;
  }
  const container='Landroid/graphics/drawable/DrawableContainer;',stateType='Landroid/graphics/drawable/DrawableContainer$DrawableContainerState;',D='Landroid/graphics/drawable/Drawable;';
  if(runtime.isSubtype(type,container)){
   const state=object.fields.get(`${container}->mDrawableContainerState:${stateType}`);if(!state)return;
   const dispatch=(name,p,result,args=[])=>runtime.dispatch({owner:stateType,name,parameters:p,result,signature:`(${p.join('')})${result}`},runtime.argumentWords(p,args,{receiver:state}),'virtual');
   const count=dispatch('getChildCount',[],'I');if(count<0||count>4096)throw new APKError('DrawableContainer child count exceeds4096',{kind:'animated-vector-backend'});
   // Original getChild materializes its own ConstantState future. Its Java
   // clone/factory executes normally before the explicit CPU backend choice.
   for(let i=0;i<count;i++)walk(dispatch('getChild',['I'],D,[i]),depth+1);
  }else if(runtime.isSubtype(type,'Landroid/graphics/drawable/LayerDrawable;')){
   const owner='Landroid/graphics/drawable/LayerDrawable;',count=call(owner,'getNumberOfLayers',[],'I');if(count<0||count>4096)throw new APKError('LayerDrawable child count exceeds4096',{kind:'animated-vector-backend'});for(let i=0;i<count;i++)walk(call(owner,'getDrawable',['I'],D,[i]),depth+1);
  }
 };walk(drawable);return drawable;
}
