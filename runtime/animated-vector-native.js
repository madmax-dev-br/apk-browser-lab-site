import {APKError} from './apk-error.js?v=6e138f531f83';
import {getVectorGraphics} from './vector-native.js?v=6e138f531f83';
const AVD='Landroid/graphics/drawable/AnimatedVectorDrawable;';
/** Original AVD constructs an RT set before choosing its CPU fallback. The set
 * has real, bounded VM allocation/refcount ownership, but no RT executor. None
 * of nStart/nReverse/nAddAnimator is bound here. Java/UI animation is selected
 * explicitly through the original Java method after resource inflation. */
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
export function createAnimatedVectorNativeBindings(){
 return new Map([...pvhJniBindings(),[`${AVD}->nCreateAnimatorSet()J`,runtime=>{
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
