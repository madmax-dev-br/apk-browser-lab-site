import {APKError} from './apk-error.js?v=88ca7fbf670e';

const PATTERN='Lcom/android/icu/util/regex/PatternNative;',MATCHER='Lcom/android/icu/util/regex/MatcherNative;',REGISTRY='Llibcore/util/NativeAllocationRegistry;';
const FINALIZERS=new Map([[0x5245475001n,'pattern'],[0x5245474d01n,'matcher']]);
export const REGEX_CLEANER='Lapkweb/bridge/RegexCleaner;';
const states=new WeakMap();
const fail=(message,kind='regex-native-boundary')=>{throw new APKError(message,{kind,backend:'original-ICU4C70.1/Wasm'});};
const stateFor=r=>{
 let state=states.get(r);if(state)return state;
 if(!r.icuBreakBackend?.createRegexSession)fail('Java regex requires the verified original ICU Wasm backend');
 state={session:r.icuBreakBackend.createRegexSession(),handles:new Map()};states.set(r,state);r.icuRegexMetadata=r.icuBreakBackend.metadata;return state;
};
const checked=(r,handle,kind)=>{
 const state=stateFor(r),record=state.handles.get(handle);
 if(!record||kind&&record!==kind)fail('Invalid, released or mismatched ICU regex token');
 return {state,token:Number(handle)};
};
const remember=(r,token,kind)=>{const state=stateFor(r),handle=BigInt(token);state.handles.set(handle,kind);return handle;};
const close=(r,handle)=>{const {state,token}=checked(r,handle);state.session.close(token);state.handles.delete(handle);};
function syntaxError(r,error,pattern){
 const owner='Ljava/util/regex/PatternSyntaxException;',reference=r.allocate(owner),description=error.icuErrorName||error.message;
 r.dispatch({owner,name:'<init>',parameters:['Ljava/lang/String;','Ljava/lang/String;','I'],result:'V',signature:'(Ljava/lang/String;Ljava/lang/String;I)V'},[reference,description,pattern,Number.isInteger(error.offset)?error.offset:-1],'direct');
 r.throwJavaReference(reference,`${description}: ${pattern}`,{kind:'regex-syntax',icuStatus:error.code});
}
function boundary(r,operation,{pattern}={}){
 try{return operation();}catch(error){
  if(error.name==='ICURegexLimitError'||['U_REGEX_TIME_OUT','U_REGEX_STACK_OVERFLOW'].includes(error.icuErrorName))fail(error.message,'regex-execution-limit');
  if(error.name==='ICURegexError'){
   if(pattern!==undefined)syntaxError(r,error,pattern);
   r.throwJava('Ljava/lang/IllegalArgumentException;',error.message);
  }
  throw error;
 }
}
export function createRegexNativeBindings(){
 const bindings=new Map(),add=(owner,signature,callback)=>bindings.set(owner+'->'+signature,callback);
 add(PATTERN,'getNativeFinalizer()J',()=>0x5245475001n);add(MATCHER,'getNativeFinalizer()J',()=>0x5245474d01n);
 add(PATTERN,'compileImpl(Ljava/lang/String;I)J',(r,[text,flags])=>{
  const pattern=r.stringCharacters(text);return boundary(r,()=>remember(r,stateFor(r).session.compile(pattern,flags),'pattern'),{pattern});
 });
 add(PATTERN,'openMatcherImpl(J)J',(r,[handle])=>{const {state,token}=checked(r,handle,'pattern');return boundary(r,()=>remember(r,state.session.openMatcher(token),'matcher'));});
 add(PATTERN,'getMatchedGroupIndexImpl(JLjava/lang/String;)I',(r,[handle,name])=>{const {state,token}=checked(r,handle,'pattern');return boundary(r,()=>state.session.matchedGroupIndex(token,r.stringCharacters(name)));});
 add(MATCHER,'setInputImpl(JLjava/lang/String;II)V',(r,[handle,text,start,end])=>{const {state,token}=checked(r,handle,'matcher');return boundary(r,()=>state.session.setInput(token,r.stringCharacters(text),start,end));});
 const matching=(r,handle,output,operation,start)=>{
  const {state,token}=checked(r,handle,'matcher'),array=r.array(output);
  if(array.type!=='[I'||array.elements.length!==(state.session.groupCount(token)+1)*2)fail('Regex native output requires an exactly sized original Matcher offset array');
  const result=boundary(r,()=>state.session[operation](token,...(start===undefined?[]:[start])));
  if(result.matched){if(!Array.isArray(result.offsets)||result.offsets.length!==array.elements.length||result.offsets.some(value=>!Number.isInteger(value)||value< -1||value>65536))fail('Invalid ICU UTF-16 group offsets');array.elements.splice(0,array.elements.length,...result.offsets);}
  return result.matched?1:0;
 };
 add(MATCHER,'findImpl(JI[I)Z',(r,[handle,start,output])=>matching(r,handle,output,'find',start));
 for(const operation of ['findNext','matches','lookingAt'])add(MATCHER,`${operation}Impl(J[I)Z`,(r,[handle,output])=>matching(r,handle,output,operation));
 add(MATCHER,'groupCountImpl(J)I',(r,[handle])=>{const {state,token}=checked(r,handle,'matcher');return boundary(r,()=>state.session.groupCount(token));});
 for(const operation of ['hitEnd','requireEnd'])add(MATCHER,`${operation}Impl(J)Z`,(r,[handle])=>{const {state,token}=checked(r,handle,'matcher');return boundary(r,()=>state.session[operation](token)?1:0);});
 for(const operation of ['useAnchoringBounds','useTransparentBounds'])add(MATCHER,`${operation}Impl(JZ)V`,(r,[handle,value])=>{const {state,token}=checked(r,handle,'matcher');return boundary(r,()=>state.session[operation](token,!!value));});
 return bindings;
}
export function regexRegistryBridge(r,method,args){
 if(method.owner===REGISTRY&&method.name==='createMalloced'&&method.signature===`(Ljava/lang/ClassLoader;J)${REGISTRY}`&&FINALIZERS.has(args[1])){
  const reference=r.makeObject(REGISTRY);r.object(reference).regexFinalizer=FINALIZERS.get(args[1]);return{value:reference};
 }
 if(method.owner===REGISTRY&&method.name==='registerNativeAllocation'&&method.signature==='(Ljava/lang/Object;J)Ljava/lang/Runnable;'){
  const kind=r.object(args[0]).regexFinalizer;if(!kind)return null;
  r.object(args[1]);checked(r,args[2],kind);const reference=r.makeObject(REGEX_CLEANER);r.object(reference).regexCleanup=args[2];return{value:reference};
 }
 if(method.name==='run'&&method.signature==='()V'&&args[0]&&r.object(args[0]).type===REGEX_CLEANER){
  const cleaner=r.object(args[0]);if(cleaner.regexCleanup){close(r,cleaner.regexCleanup);cleaner.regexCleanup=0n;}return{value:undefined};
 }
 return null;
}
export function disposeRegex(r){const state=states.get(r);if(state){state.session.dispose();state.handles.clear();states.delete(r);}}
