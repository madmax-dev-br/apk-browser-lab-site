import { APKError } from './apk-error.js?v=e9d35ddef77e';

const FILTER='Landroid/graphics/ColorFilter;',REGISTRY='Llibcore/util/NativeAllocationRegistry;',FINALIZER=0x43464c5401n;
export const COLOR_FILTER_CLEANER='Lapkweb/bridge/ColorFilterCleaner;';
const states=new WeakMap();
const stateFor=runtime=>{if(!states.has(runtime))states.set(runtime,{next:0x4346000000n,handles:new Map()});return states.get(runtime);};
const fail=message=>{throw new APKError(message,{kind:'color-filter-backend',backend:'original-Skia-ColorFilter/Wasm'});};
const get=(runtime,handle)=>{const value=stateFor(runtime).handles.get(handle);if(!value)fail('Invalid or released Skia color-filter token');return value;};
const release=(runtime,handle)=>{const state=stateFor(runtime),value=get(runtime,handle);value.native.delete();state.handles.delete(handle);};

export function makeSkiaColorFilter(CK,descriptor){
 if(!descriptor)return null;
 if(descriptor.kind!=='blend'||!Number.isInteger(descriptor.mode)||descriptor.mode<0||descriptor.mode>28)fail('Unsupported Skia color-filter descriptor');
 const color=descriptor.argb>>>0;
 return CK.ColorFilter.MakeBlend(CK.Color((color>>>16)&255,(color>>>8)&255,color&255,(color>>>24)/255),{value:descriptor.mode});
}
export function getColorFilterSnapshot(runtime,handle){return handle===0n?null:{...get(runtime,handle).descriptor};}
export function snapshotPaintColorFilter(runtime,reference){
 if(reference===null||reference===undefined||reference===0)return null;
 const handle=runtime.dispatch({owner:FILTER,name:'getNativeInstance',parameters:[],result:'J',signature:'()J'},[reference],'virtual');
 return getColorFilterSnapshot(runtime,handle);
}
export function createColorFilterNativeBindings(){
 const bindings=new Map([[`${FILTER}->nativeGetFinalizer()J`,()=>FINALIZER]]);
 for(const owner of ['PorterDuffColorFilter','BlendModeColorFilter'])bindings.set(`Landroid/graphics/${owner};->native_CreateBlendModeFilter(II)J`,(runtime,[argb,mode])=>{
  const CK=runtime.skia?.CanvasKit;if(!CK?.ColorFilter?.MakeBlend)fail('Color filters require the verified Skia Wasm backend');
  const descriptor={kind:'blend',argb:argb>>>0,mode},native=makeSkiaColorFilter(CK,descriptor);
  // Skia legitimately returns null for an identity filter (e.g. DST).
  if(!native)return 0n;
  const state=stateFor(runtime);if(state.handles.size>=4096){native.delete();fail('Color-filter allocation limit exceeded');}
  const handle=state.next++;state.handles.set(handle,{descriptor,native});return handle;
 });
 return bindings;
}
export function colorFilterRegistryBridge(runtime,method,args){
 if(method.owner===REGISTRY&&method.name==='createMalloced'&&method.signature===`(Ljava/lang/ClassLoader;J)${REGISTRY}`&&args[1]===FINALIZER){
  const reference=runtime.makeObject(REGISTRY);runtime.object(reference).colorFilterFinalizer=FINALIZER;return{value:reference};
 }
 if(method.owner===REGISTRY&&method.name==='registerNativeAllocation'&&method.signature==='(Ljava/lang/Object;J)Ljava/lang/Runnable;'&&runtime.object(args[0]).colorFilterFinalizer===FINALIZER){
  runtime.object(args[1]);get(runtime,args[2]);const reference=runtime.makeObject(COLOR_FILTER_CLEANER);runtime.object(reference).colorFilterCleanup=args[2];return{value:reference};
 }
 if(method.name==='run'&&method.signature==='()V'&&args[0]&&runtime.object(args[0]).type===COLOR_FILTER_CLEANER){
  const cleaner=runtime.object(args[0]);if(cleaner.colorFilterCleanup){release(runtime,cleaner.colorFilterCleanup);cleaner.colorFilterCleanup=0n;}return{value:undefined};
 }
 return null;
}
export function disposeColorFilters(runtime){for(const handle of [...stateFor(runtime).handles.keys()])release(runtime,handle);}
