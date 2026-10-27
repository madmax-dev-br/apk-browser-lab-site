import {APKError} from './apk-error.js?v=6531d427a542';
import {getVectorGraphics} from './vector-native.js?v=6531d427a542';
import {getSolidPaintByHandle} from './paint-host.js?v=6531d427a542';
import {createMatrixNativeBindings} from './matrix-native.js?v=6531d427a542';

const NODE='Landroid/view/RenderNode;',DISPLAY='Landroid/view/DisplayListCanvas;',RECORD='Landroid/view/RecordingCanvas;';
const NODE33='Landroid/graphics/RenderNode;',RC33='Landroid/graphics/RecordingCanvas;',BRC='Landroid/graphics/BaseRecordingCanvas;';
const REG='Llibcore/util/NativeAllocationRegistry;';
export const RENDER_NODE_CLEANER='Lapkweb/bridge/RenderNodeCleaner;';
const FINALIZER=0x524e444601n,states=new WeakMap(),bits=new DataView(new ArrayBuffer(4));
const decode=v=>{bits.setInt32(0,v,true);return bits.getFloat32(0,true);};
const encode=v=>{bits.setFloat32(0,v,true);return bits.getInt32(0,true);};
// ABI: framework-aosp/legacy-rendernode/jni-contracts.json, Android 9.0.0_r1.
// Scalar defaults/order follow original hwui RenderProperties.h/.cpp; Skia
// executes matrices, clipping and rasterization in the browser CPU backend.
const fail=message=>{throw new APKError(message,{kind:'rendernode-cpu-backend',backend:'original-Skia-Wasm/display-list'});};
const stateFor=r=>{if(!states.has(r))states.set(r,{next:0x600000000n,nodes:new Map(),recordings:new Map(),canvases:new Set()});return states.get(r);};
const node=(r,h,retained=false)=>{const value=stateFor(r).nodes.get(h);if(!value||value.javaReleased&&!retained)fail('Invalid or released RenderNode VM token');return value;};
const finite=values=>{if(values.some(v=>!Number.isFinite(v)))fail('Non-finite RenderNode geometry');return values;};
const identity=()=>[1,0,0,0,1,0,0,0,1];
function newNode(r,name){const s=stateFor(r);if(s.nodes.size>=4096)fail('RenderNode handle limit4096 exceeded');const h=s.next++;s.nodes.set(h,{name,displayList:null,left:0,top:0,right:0,bottom:0,alpha:1,translationX:0,translationY:0,translationZ:0,elevation:0,rotation:0,rotationX:0,rotationY:0,scaleX:1,scaleY:1,pivotX:0,pivotY:0,pivotExplicit:false,clipToBounds:true,clipBounds:null,clipToOutline:false,outline:null,overlap:false,layerType:0,layerPaint:null,staticMatrix:null,animationMatrix:null,spotShadowColor:0xff000000|0,ambientShadowColor:0xff000000|0,cameraDistance:8});return h;}
function copyCommand(c){return {...c,args:c.args?.slice(),matrix:c.matrix?.slice(),clips:c.clips?.map(v=>({...v,rect:v.rect?.slice(),matrix:v.matrix?.slice(),commands:v.commands?new Float32Array(v.commands):undefined})),commands:c.commands?new Float32Array(c.commands):undefined,paint:c.paint?{...c.paint}:null};}
function canvas(r,h){return getVectorGraphics(r).get(h,'canvas');}
function storageBytes(commands){let bytes=0;for(const c of commands)bytes+=128+(c.commands?.byteLength??0)+(c.text?.length??0)*2+(c.raster?.dataURL?.length??0)+(c.clips??[]).reduce((n,v)=>n+64+(v.commands?.byteLength??0),0);return bytes;}
function finish(r,h){const c=canvas(r,h);if(c.stack.length)fail('Unbalanced Canvas save/restore in RenderNode recording');const s=stateFor(r);if(s.recordings.size>=8192)fail('RenderNode display-list limit exceeded');let total=storageBytes(c.draws);for(const n of s.nodes.values())total+=storageBytes(n.displayList??[]);for(const list of s.recordings.values())total+=storageBytes(list);if(total>32*1024*1024)fail('RenderNode aggregate display-list storage limit32MiB exceeded');const id=s.next++;s.recordings.set(id,c.draws.map(copyCommand));return id;}
function set(r,h,key,value){const n=node(r,h),old=n[key];n[key]=value;return old!==value?1:0;}
function matrixFromHandle(r,h){if(!h)return null;const arr=r.newArray('[F',9);createMatrixNativeBindings().get('Landroid/graphics/Matrix;->nGetValues(J[F)V')(r,[h,arr]);return r.array(arr).elements.map(decode);}
export function renderNodeTransform(r,n){const CK=r.skia?.CanvasKit;if(!CK)fail('RenderNode requires verified Skia');const surface=CK.MakeSurface(1,1);if(!surface)fail('RenderNode matrix scratch allocation failed');try{const c=surface.getCanvas(),px=n.pivotExplicit?n.pivotX:(n.right-n.left)/2,py=n.pivotExplicit?n.pivotY:(n.bottom-n.top)/2;c.translate(n.translationX,n.translationY);c.rotate(n.rotation,px,py);c.translate(px,py);c.scale(n.scaleX,n.scaleY);c.translate(-px,-py);return Array.from(c.getTotalMatrix());}finally{surface.dispose();}}
/** hwui RenderProperties::hasShadow: positive Z and a non-empty outline with nonzero alpha. */
export function renderNodeShadowCaster(n){const z=n.elevation+n.translationZ;return z>0&&n.outline&&!n.outline.empty&&n.outline.alpha>0&&n.alpha>0&&n.scaleX!==0&&n.scaleY!==0?z:0;}
/** Lighting from the window theme, exactly like ThreadedRenderer: context.obtainStyledAttributes(null, R.styleable.Lighting)
 * through the original TypedArray over the APK/framework theme (android:style/Theme carries @dimen/light_y|z|radius and
 * ambient/spot_shadow_alpha). Missing attributes read as 0, as ThreadedRenderer's getDimension/getFloat defaults do.
 * Without any Context, the bare framework android:style/Theme is applied to a scratch theme. */
export function themeLighting(r,context=r.activity){
 const platform=r.platform,backend=platform?.styleBackend,table=platform?.resources?.frameworkTable;
 if(!backend||!table)fail('Shadow lighting requires the framework resource table and style backend');
 const names=['lightY','lightZ','lightRadius','ambientShadowAlpha','spotShadowAlpha'],ids=names.map(name=>table.findId('attr/'+name)||table.findId('^attr-private/'+name));
 if(ids.some(id=>!id))fail('Framework resources lack the Lighting attributes');
 let theme;if(context&&!(context.ref===undefined))theme=backend.theme(r,context);else if(r.bareLightingTheme)theme=r.bareLightingTheme;else{theme=backend.createTheme(r);backend.applyStyle(r,theme,table.findId('style/Theme'),true);r.bareLightingTheme=theme;}
 const cache=r.themeLightingCache??=new WeakMap(),object=r.object(theme);const key=backend.themeKey?backend.themeKey(r,theme):null;
 const hit=cache.get(object);if(hit&&hit.key===key)return hit.value;
 const TA='Landroid/content/res/TypedArray;',array=r.newArray('[I',ids.length);r.array(array).elements=ids;
 const typed=backend.obtain(r,theme,null,array,0,0),call=(name,p,result,values)=>r.dispatch({owner:TA,name,parameters:p,result,signature:`(${p.join('')})${result}`},r.argumentWords(p,values,{receiver:typed}),'virtual');
 try{
  const dimension=i=>decode(call('getDimension',['I','F'],'F',[i,encode(0)])),number=i=>decode(call('getFloat',['I','F'],'F',[i,encode(0)]));
  const value={y:dimension(0),z:dimension(1),radius:dimension(2),ambientShadowAlpha:number(3),spotShadowAlpha:number(4),source:'window theme android:attr/Lighting via original TypedArray',present:ids.map((_,i)=>!!call('hasValue',['I'],'Z',[i]))};
  cache.set(object,{key,value});return value;
 }finally{call('recycle',[],'V',[]);}
}
/** Light geometry for SkShadowUtils in device pixels: x = surface width/2 (display centre), y/z/radius/alphas from the window theme;
 * a host may override fields through runtime.renderLightInfo. */
export function renderLightInfo(r,width,context=r.activity){const t=themeLighting(r,context);return {x:width/2,y:t.y,z:t.z,radius:t.radius,ambientShadowAlpha:t.ambientShadowAlpha,spotShadowAlpha:t.spotShadowAlpha,...(r.renderLightInfo??{})};}
/** hwui property state of a native RenderNode handle (RenderThread animators write through it). */
export function renderNodeByHandle(r,handle){return node(r,handle,true);}
/** Live hwui property state of a node reference (the single store behind the View transform). */
export function renderNodeProperties(r,reference){const f=r.object(reference).fields;return node(r,f.get(`${NODE33}->mNativeRenderNode:J`)??f.get(`${NODE}->mNativeRenderNode:J`));}
/** Returns the live display list. Child nodes are deliberately not rasterized at record time. */
export function getRenderNodeSnapshot(r,h){const n=node(r,h,true);return {...n,matrix:renderNodeTransform(r,n),displayList:n.displayList};}
export function disposeRenderNodes(r){const s=stateFor(r),g=getVectorGraphics(r);for(const h of s.canvases)g.handles.delete(h);s.canvases.clear();s.recordings.clear();s.nodes.clear();}
export function renderNodeRegistryBridge(r,m,a){
 if(m.owner===REG&&m.name==='<init>'&&m.signature==='(Ljava/lang/ClassLoader;JJ)V'&&a[2]===FINALIZER){r.object(a[0]).renderNodeRegistry=true;return{value:undefined};}
 if(m.owner===REG&&m.name==='createMalloced'&&m.signature==='(Ljava/lang/ClassLoader;J)'+REG&&a[1]===FINALIZER){const value=r.makeObject(REG);r.object(value).renderNodeRegistry=true;return{value};}   // API 29+ RenderNode: NativeAllocationRegistry.createMalloced(loader, nGetNativeFinalizer())
 if(m.owner===REG&&m.name==='registerNativeAllocation'&&m.signature==='(Ljava/lang/Object;J)Ljava/lang/Runnable;'&&r.object(a[0]).renderNodeRegistry){r.object(a[1]);node(r,a[2]);const value=r.makeObject(RENDER_NODE_CLEANER);r.object(value).renderNodeCleanup=a[2];return{value};}
 if(m.owner===RENDER_NODE_CLEANER&&m.name==='run'&&m.signature==='()V'){const c=r.object(a[0]);if(c.renderNodeCleanup){const s=stateFor(r),h=c.renderNodeCleanup,n=node(r,h);n.javaReleased=true;const owns=list=>(list??[]).some(v=>v.op==='renderNode'&&v.node===h);let retained=false;for(const value of s.nodes.values())if(value!==n&&owns(value.displayList))retained=true;for(const list of s.recordings.values())if(owns(list))retained=true;for(const id of s.canvases)if(owns(canvas(r,id).draws))retained=true;if(!retained)s.nodes.delete(h);c.renderNodeCleanup=0n;}return{value:undefined};}return null;
}
/** Only these exact original Java native declarations have a CPU web boundary.
 * Perspective/3D rotation, GL, textures and RenderThread animators remain unbound.
 */
export function createRenderNodeNativeBindings(){const map=new Map();
 const add=(owner,name,p,result,fn)=>map.set(`${owner}->${name}(${p.join('')})${result}`,(r,args)=>{const a=args.map((v,i)=>p[i]==='F'?decode(v):v),answer=fn(r,a);return result==='F'?encode(answer):answer;});
 const n=(name,p,result,fn)=>add(NODE,name,p,result,fn),d=(name,p,result,fn)=>add(DISPLAY,name,p,result,fn),rec=(name,p,fn)=>add(RECORD,name,p,'V',fn);
 // android.graphics.CanvasProperty: float/Paint holders. Without a RenderThread nothing animates them, so they keep their creation values; the
 // RenderNodeAnimator/RecordingCanvas.drawRipple consumers exist only on hardware canvases, and this software-window VM reports isHardwareAccelerated()=false.
 {const CP='Landroid/graphics/CanvasProperty;',create=(r,value)=>getVectorGraphics(r).create('canvasProperty',value);
  add(CP,'nCreateFloat',['F'],'J',(r,[value])=>create(r,{kind:'float',value}));
  add(CP,'nCreatePaint',['J'],'J',(r,[paint])=>create(r,{kind:'paint',paint:{...getSolidPaintByHandle(r,paint)}}));}   // hwui copies the SkPaint into the CanvasPropertyPaint
 n('nCreate',['Ljava/lang/String;'],'J',(r,[name])=>newNode(r,r.javaString(name)));n('nGetNativeFinalizer',[],'J',()=>FINALIZER);
 n('nSetDisplayList',['J','J'],'V',(r,[h,list])=>{const s=stateFor(r),v=list?s.recordings.get(list):null;if(list&&!v)fail('Invalid or consumed display-list token');node(r,h).displayList=v;s.recordings.delete(list);});
 n('nIsValid',['J'],'Z',(r,[h])=>node(r,h).displayList!==null?1:0);
 // nGetDebugSize measures native hwui allocations; this backend does not invent that number.
 for(const [suffix,key]of[['Alpha','alpha'],['TranslationX','translationX'],['TranslationY','translationY'],['ScaleX','scaleX'],['ScaleY','scaleY'],['Rotation','rotation'],['CameraDistance','cameraDistance']]){
  n('nSet'+suffix,['J','F'],'Z',(r,[h,v])=>set(r,h,key,suffix==='Alpha'?Math.max(0,Math.min(1,finite([v])[0])):finite([v])[0]));n('nGet'+suffix,['J'],'F',(r,[h])=>node(r,h)[key]);
 }
 for(const [suffix,key]of[['TranslationZ','translationZ'],['Elevation','elevation']])n('nSet'+suffix,['J','F'],'Z',(r,[h,v])=>set(r,h,key,finite([v])[0]));
 for(const [suffix,key]of[['RotationX','rotationX'],['RotationY','rotationY']])n('nSet'+suffix,['J','F'],'Z',(r,[h,v])=>{if(v!==0)fail(`RenderNode ${suffix} requires a 3D perspective backend`);return set(r,h,key,0);});
 for(const key of ['TranslationZ','Elevation','RotationX','RotationY'])n('nGet'+key,['J'],'F',(r,[h])=>node(r,h)[key[0].toLowerCase()+key.slice(1)]);
 for(const [suffix,key]of[['PivotX','pivotX'],['PivotY','pivotY']]){n('nSet'+suffix,['J','F'],'Z',(r,[h,v])=>{const x=node(r,h),old=x[key];x[key]=finite([v])[0];const changed=!x.pivotExplicit||old!==v;x.pivotExplicit=true;return changed?1:0;});n('nGet'+suffix,['J'],'F',(r,[h])=>{const x=node(r,h);return x.pivotExplicit?x[key]:(suffix==='PivotX'?x.right-x.left:x.bottom-x.top)/2;});}
 n('nResetPivot',['J'],'Z',(r,[h])=>set(r,h,'pivotExplicit',false));n('nIsPivotExplicitlySet',['J'],'Z',(r,[h])=>node(r,h).pivotExplicit?1:0);
 for(const [suffix,key]of[['Left','left'],['Top','top'],['Right','right'],['Bottom','bottom']])n('nSet'+suffix,['J','I'],'Z',(r,[h,v])=>set(r,h,key,v));
 n('nSetLeftTopRightBottom',['J','I','I','I','I'],'Z',(r,[h,...v])=>{let changed=0;['left','top','right','bottom'].forEach((key,i)=>changed|=set(r,h,key,v[i]));return changed;});
 for(const[method,keys]of[['nOffsetLeftAndRight',['left','right']],['nOffsetTopAndBottom',['top','bottom']]])n(method,['J','I'],'Z',(r,[h,v])=>{const x=node(r,h);keys.forEach(k=>x[k]+=v);return v?1:0;});
 for(const[suffix,key]of[['ClipToBounds','clipToBounds'],['HasOverlappingRendering','overlap'],['ClipToOutline','clipToOutline']])n('nSet'+suffix,['J','Z'],'Z',(r,[h,v])=>set(r,h,key,!!v));
 n('nHasOverlappingRendering',['J'],'Z',(r,[h])=>node(r,h).overlap?1:0);n('nGetClipToOutline',['J'],'Z',(r,[h])=>node(r,h).clipToOutline?1:0);
 n('nSetClipBounds',['J','I','I','I','I'],'Z',(r,[h,...v])=>{const x=node(r,h),changed=JSON.stringify(x.clipBounds)!==JSON.stringify(v);x.clipBounds=v;return changed?1:0;});n('nSetClipBoundsEmpty',['J'],'Z',(r,[h])=>set(r,h,'clipBounds',null));
 for(const suffix of ['SpotShadowColor','AmbientShadowColor']){const k=suffix[0].toLowerCase()+suffix.slice(1);n('nSet'+suffix,['J','I'],'Z',(r,[h,v])=>set(r,h,k,v));n('nGet'+suffix,['J'],'I',(r,[h])=>node(r,h)[k]);}
 n('nHasShadow',['J'],'Z',(r,[h])=>renderNodeShadowCaster(node(r,h))?1:0);
 n('nSetOutlineRoundRect',['J','I','I','I','I','F','F'],'Z',(r,[h,...v])=>{const x=node(r,h),outline={rect:v.slice(0,4),radius:v[4],alpha:v[5]};finite(v);const changed=JSON.stringify(x.outline)!==JSON.stringify(outline);x.outline=outline;return changed?1:0;});
 n('nSetOutlineConvexPath',['J','J','F'],'Z',(r,[h,path,alpha])=>{const x=node(r,h),shape=r.skiaHost.pathByHandle(path);x.outline={...shape,alpha:finite([alpha])[0]};return 1;});
 for(const suffix of ['Empty','None'])n('nSetOutline'+suffix,['J'],'Z',(r,[h])=>set(r,h,'outline',suffix==='Empty'?{empty:true}:null));
 n('nSetLayerType',['J','I'],'Z',(r,[h,v])=>{if(v<0||v>2)fail('Invalid RenderNode layer type');return set(r,h,'layerType',v);});n('nSetLayerPaint',['J','J'],'Z',(r,[h,v])=>set(r,h,'layerPaint',v?getSolidPaintByHandle(r,v):null));
 for(const [name,key]of[['nSetStaticMatrix','staticMatrix'],['nSetAnimationMatrix','animationMatrix']])n(name,['J','J'],'Z',(r,[h,v])=>{const x=node(r,h),m=matrixFromHandle(r,v),changed=JSON.stringify(x[key])!==JSON.stringify(m);x[key]=m;return changed?1:0;});
 for(const name of ['nSetProjectBackwards','nSetProjectionReceiver'])n(name,['J','Z'],'Z',(r,[h,v])=>{node(r,h);if(v)fail('Projected RenderNodes require a projection backend');return 0;});
 n('nSetRevealClip',['J','Z','F','F','F'],'Z',(r,[h,enabled])=>{node(r,h);if(enabled)fail('RenderNode reveal clipping is not implemented');return 0;});
 n('nHasIdentityMatrix',['J'],'Z',(r,[h])=>renderNodeTransform(r,node(r,h)).every((v,i)=>v===identity()[i])?1:0);
 for(const name of ['nGetTransformMatrix','nGetInverseTransformMatrix'])n(name,['J','J'],'V',(r,[h,m])=>{let v=renderNodeTransform(r,node(r,h));if(name.includes('Inverse'))v=r.skia.CanvasKit.Matrix.invert(v)??identity();const arr=r.newArray('[F',9);r.array(arr).elements=v.map(encode);createMatrixNativeBindings().get('Landroid/graphics/Matrix;->nSetValues(J[F)V')(r,[m,arr]);});
 d('nCreateDisplayListCanvas',['J','I','I'],'J',(r,[h,w,height])=>{node(r,h);if(w<0||height<0||w>4096||height>4096)fail('DisplayListCanvas extent exceeds4096');const id=getVectorGraphics(r).createCanvas(),c=canvas(r,id);Object.assign(c,{width:w,height,renderNode:h});stateFor(r).canvases.add(id);return id;});
 d('nResetDisplayListCanvas',['J','J','I','I'],'V',(r,[c,h,w,height])=>{node(r,h);if(w<0||height<0||w>4096||height>4096)fail('DisplayListCanvas extent exceeds4096');Object.assign(canvas(r,c),{draws:[],matrix:[1,0,0,1,0,0],clips:[],stack:[],width:w,height,renderNode:h});});
 for(const name of ['nGetMaximumTextureWidth','nGetMaximumTextureHeight'])d(name,[],'I',()=>4096);
 d('nFinishRecording',['J'],'J',(r,[c])=>finish(r,c));
 // hwui reorder barrier: RenderNode children recorded inside a region are
 // deferred and replayed by ascending Z (stable), with shadows for Z>0; the
 // Skia replay in skia-canvas-host implements this from these two markers.
 d('nInsertReorderBarrier',['J','Z'],'V',(r,[c,enabled])=>{const x=canvas(r,c),active=!!x.reorderBarrier;if(active)r.skiaHost.recordNative(c,{op:'reorderEnd'});if(enabled)r.skiaHost.recordNative(c,{op:'reorderBegin'});x.reorderBarrier=!!enabled;});
 d('nDrawRenderNode',['J','J'],'V',(r,[c,h])=>{node(r,h);r.skiaHost.recordNative(c,{op:'renderNode',node:h});});
 const draw=(r,h,op,args,paint)=>r.skiaHost.recordNative(h,{op,args:finite(args),paint:paint?getSolidPaintByHandle(r,paint):null});
 rec('nDrawRect',['J','F','F','F','F','J'],(r,[h,...v])=>draw(r,h,'rect',v.slice(0,4),v[4]));
 rec('nDrawRoundRect',['J','F','F','F','F','F','F','J'],(r,[h,...v])=>draw(r,h,'roundRect',v.slice(0,6),v[6]));
 rec('nDrawOval',['J','F','F','F','F','J'],(r,[h,...v])=>draw(r,h,'oval',v.slice(0,4),v[4]));
 rec('nDrawCircle',['J','F','F','F','J'],(r,[h,...v])=>draw(r,h,'circle',v.slice(0,3),v[3]));
 rec('nDrawArc',['J','F','F','F','F','F','F','Z','J'],(r,[h,l,t,right,bottom,start,sweep,center,p])=>r.skiaHost.recordNative(h,{op:'arc',args:finite([l,t,right,bottom,start,sweep]),useCenter:!!center,paint:getSolidPaintByHandle(r,p)}));
 rec('nDrawLine',['J','F','F','F','F','J'],(r,[h,...v])=>draw(r,h,'line',v.slice(0,4),v[4]));
 rec('nDrawPoint',['J','F','F','J'],(r,[h,x,y,p])=>draw(r,h,'point',[x,y],p));
 rec('nDrawColor',['J','I','I'],(r,[h,color,mode])=>{if(mode<0||mode>28)fail('Unsupported Canvas blend mode');r.skiaHost.recordNative(h,{op:'color',color,blendMode:mode});});
 const BMP='Landroid/graphics/Bitmap;';
 rec('nDrawBitmap',['J',BMP,'F','F','J','I','I','I'],(r,[h,bitmap,left,top,paint,canvasDensity,screenDensity,bitmapDensity])=>r.skiaHost.bitmaps.nativeDraw(h,bitmap,{left:finite([left])[0],top:finite([top])[0],paint,canvasDensity,bitmapDensity}));
 rec('nDrawBitmap',['J',BMP,'F','F','F','F','F','F','F','F','J','I','I'],(r,[h,bitmap,sl,st,sr,sb,dl,dt,dr,db,paint])=>r.skiaHost.bitmaps.nativeDraw(h,bitmap,{src:finite([sl,st,sr,sb]),dst:finite([dl,dt,dr,db]),paint}));
 rec('nDrawBitmapMatrix',['J',BMP,'J','J'],(r,[h,bitmap,matrix,paint])=>r.skiaHost.bitmaps.nativeDraw(h,bitmap,{transform:matrixFromHandle(r,matrix)?.length===9?(m=>[m[0],m[1],m[2],m[3],m[4],m[5],0,0,1])(matrixFromHandle(r,matrix)):fail('Invalid Matrix token'),paint}));
 rec('nDrawPaint',['J','J'],(r,[h,p])=>draw(r,h,'paint',[],p));
 rec('nDrawPath',['J','J','J'],(r,[h,p,paint])=>r.skiaHost.recordNative(h,{op:'path',...r.skiaHost.pathByHandle(p),paint:getSolidPaintByHandle(r,paint)}));
 const text=(r,h,value,start,end,contextStart,contextEnd,x,y,rtl,paint)=>{
  const array=value?.ref&&r.object(value).type==='[C',source=array?null:typeof value==='string'?value:r.javaString(value);let content;
  if(array){const elements=r.array(value).elements;if(contextStart<0||start<contextStart||end<start||contextEnd<end||contextEnd>elements.length)r.throwJava('Ljava/lang/IndexOutOfBoundsException;','Recorded text range');content='';for(let i=contextStart;i<contextEnd;i+=16384)content+=String.fromCharCode(...elements.slice(i,Math.min(contextEnd,i+16384)));}
  else{if(contextStart<0||start<contextStart||end<start||contextEnd<end||contextEnd>source.length)r.throwJava('Ljava/lang/IndexOutOfBoundsException;','Recorded text range');content=source.slice(contextStart,contextEnd);}
  const state={...getSolidPaintByHandle(r,paint)},face=r.skiaHost.resolveTypeface(state.typefaceRef);Object.assign(state,{weight:face.weight,italic:face.italic});
  r.skiaHost.recordNative(h,{op:'paragraphRun',text:content,runStart:start-contextStart,runEnd:end-contextStart,args:finite([x,y]),isRtl:!!rtl,paint:state});
 };
 rec('nDrawText',['J','Ljava/lang/String;','I','I','F','F','I','J'],(r,[h,t,start,end,x,y,bidi,p])=>{if(bidi!==0&&bidi!==1&&bidi!==2)fail('RecordingCanvas text bidi flag not implemented');text(r,h,t,start,end,start,end,x,y,bidi===1,p);});
 rec('nDrawText',['J','[C','I','I','F','F','I','J'],(r,[h,t,start,count,x,y,bidi,p])=>{if(bidi!==0&&bidi!==1&&bidi!==2)fail('RecordingCanvas text bidi flag not implemented');text(r,h,t,start,start+count,start,start+count,x,y,bidi===1,p);});
 rec('nDrawTextRun',['J','Ljava/lang/String;','I','I','I','I','F','F','Z','J'],(r,[h,t,start,end,cs,ce,x,y,rtl,p])=>text(r,h,t,start,end,cs,ce,x,y,rtl,p));
 rec('nDrawTextRun',['J','[C','I','I','I','I','F','F','Z','J','J'],(r,[h,t,start,count,cs,cc,x,y,rtl,p])=>text(r,h,t,start,start+count,cs,cs+cc,x,y,rtl,p));
 
 // ---- API 33 frontend: android.graphics.RenderNode / RecordingCanvas / BaseRecordingCanvas (android-13.0.0_r1, compiled by compile-aosp-hardware-recording.py) ----
 // Same hwui-property store and same display-list recorder as the API 28 frontend above; only the JNI surface differs (names, arities, bitmap handles).
 for(const [key,fn] of [...map]){
  if(key.startsWith(NODE+'->'))map.set(NODE33+key.slice(NODE.length),fn);        // RenderNode property natives keep their names and signatures
  else if(key.startsWith(RECORD+'->'))map.set(BRC+key.slice(RECORD.length),fn);   // android.view.RecordingCanvas draw natives == BaseRecordingCanvas draw natives
 }
 const n3=(name,p,result,fn)=>add(NODE33,name,p,result,fn),r3=(name,p,result,fn)=>add(RC33,name,p,result,fn),b3=(name,p,result,fn)=>add(BRC,name,p,result,fn);
 // RenderNode: renamed / new natives
 n3('nSetOutlinePath',['J','J','F'],'Z',(r,[h,path,alpha])=>{const x=node(r,h),shape=r.skiaHost.pathByHandle(path);x.outline={...shape,alpha:finite([alpha])[0]};return 1;});
 n3('nDiscardDisplayList',['J'],'V',(r,[h])=>{node(r,h).displayList=null;});
 for(const name of ['nEndAllAnimators','nForceEndAnimators'])n3(name,['J'],'V',(r,[h])=>{node(r,h);});   // no RenderThread animators exist until a RenderNodeAnimator is added (nAddAnimator is unbound)
 for(const [suffix,key]of[['Left','left'],['Top','top'],['Right','right'],['Bottom','bottom']])n3('nGet'+suffix,['J'],'I',(r,[h])=>node(r,h)[key]);
 n3('nGetWidth',['J'],'I',(r,[h])=>{const x=node(r,h);return x.right-x.left;});n3('nGetHeight',['J'],'I',(r,[h])=>{const x=node(r,h);return x.bottom-x.top;});
 n3('nGetLayerType',['J'],'I',(r,[h])=>node(r,h).layerType);
 n3('nGetClipToBounds',['J'],'Z',(r,[h])=>node(r,h).clipToBounds?1:0);
 n3('nStretch',['J','F','F','F','F'],'Z',(r,[h,...v])=>{node(r,h);if(v.some(x=>x!==0))fail('RenderNode.stretch (overscroll stretch) requires the hwui stretch shader backend');return 0;});
 n3('nClearStretch',['J'],'Z',(r,[h])=>{node(r,h);return 0;});
 n3('nSetRenderEffect',['J','J'],'Z',(r,[h,effect])=>{node(r,h);if(effect)fail('RenderNode RenderEffect (blur / shader effects) requires a Skia image-filter backend');return 0;});
 n3('nSetUsageHint',['J','I'],'V',(r,[h,v])=>{node(r,h).usageHint=v;});
 for(const [suffix,key]of[['AllowForceDark','allowForceDark']]){n3('nSet'+suffix,['J','Z'],'Z',(r,[h,v])=>{const x=node(r,h),old=x[key]??true;x[key]=!!v;return old!==!!v?1:0;});n3('nGet'+suffix,['J'],'Z',(r,[h])=>(node(r,h)[key]??true)?1:0);}
 n3('nGetAnimationMatrix',['J','J'],'Z',(r,[h,m])=>{const x=node(r,h);if(!x.animationMatrix)return 0;const arr=r.newArray('[F',9);r.array(arr).elements=x.animationMatrix.map(encode);createMatrixNativeBindings().get('Landroid/graphics/Matrix;->nSetValues(J[F)V')(r,[m,arr]);return 1;});
 {let unique=1n;n3('nGetUniqueId',['J'],'J',(r,[h])=>{const x=node(r,h);return x.uniqueId??=unique++;});}
 // Not available without hwui: sizes, debug output, position-update listeners and RT animators fail explicitly instead of inventing values.
 // RecordingCanvas
 r3('nCreateDisplayListCanvas',['J','I','I'],'J',(r,[h,w,height])=>{node(r,h);if(w<0||height<0||w>4096||height>4096)fail('RecordingCanvas extent exceeds4096');const id=getVectorGraphics(r).createCanvas(),c=canvas(r,id);Object.assign(c,{width:w,height,renderNode:h});stateFor(r).canvases.add(id);return id;});
 r3('nResetDisplayListCanvas',['J','J','I','I'],'V',(r,[c,h,w,height])=>{node(r,h);if(w<0||height<0||w>4096||height>4096)fail('RecordingCanvas extent exceeds4096');Object.assign(canvas(r,c),{draws:[],matrix:[1,0,0,1,0,0],clips:[],stack:[],width:w,height,renderNode:h});});
 for(const name of ['nGetMaximumTextureWidth','nGetMaximumTextureHeight'])r3(name,[],'I',()=>4096);
 r3('nEnableZ',['J','Z'],'V',(r,[c,enabled])=>{const x=canvas(r,c),active=!!x.reorderBarrier;if(active)r.skiaHost.recordNative(c,{op:'reorderEnd'});if(enabled)r.skiaHost.recordNative(c,{op:'reorderBegin'});x.reorderBarrier=!!enabled;});
 r3('nFinishRecording',['J','J'],'V',(r,[c,h])=>{const id=finish(r,c),s=stateFor(r),list=s.recordings.get(id);node(r,h).displayList=list;s.recordings.delete(id);});
 r3('nDrawRenderNode',['J','J'],'V',(r,[c,h])=>{node(r,h);r.skiaHost.recordNative(c,{op:'renderNode',node:h});});
 // CanvasProperty-driven draws: the geometry / paint live in CanvasProperty tokens that RenderThread animators change between frames (read when the display list is replayed).
 const prop=(r,h)=>{const v=getVectorGraphics(r).get(h);if(v.kind!=='float'&&v.kind!=='paint')fail('CanvasProperty token expected');return h;};
 r3('nDrawCircle',['J','J','J','J','J'],'V',(r,[c,cx,cy,radius,paint])=>r.skiaHost.recordNative(c,{op:'circleProps',props:{cx:prop(r,cx),cy:prop(r,cy),radius:prop(r,radius),paint:prop(r,paint)}}));
 r3('nDrawRoundRect',['J','J','J','J','J','J','J','J'],'V',(r,[c,left,top,right,bottom,rx,ry,paint])=>r.skiaHost.recordNative(c,{op:'roundRectProps',props:{left:prop(r,left),top:prop(r,top),right:prop(r,right),bottom:prop(r,bottom),rx:prop(r,rx),ry:prop(r,ry),paint:prop(r,paint)}}));
 // RippleDrawable (STYLE_PATTERNED): hwui draws a circle with the ripple's SkSL runtime shader whose progress / noise uniforms come from the animated CanvasProperties.
 r3('nDrawRipple',['J','J','J','J','J','J','J','I','J'],'V',(r,[c,cx,cy,radius,paint,progress,noise,color,builder])=>{
  const shaders=r.platform.shaderHost,shader=shaders.snapshot(r,shaders.builderShader(builder));
  r.skiaHost.recordNative(c,{op:'ripple',props:{cx:prop(r,cx),cy:prop(r,cy),radius:prop(r,radius),paint:prop(r,paint),progress:prop(r,progress),noise:prop(r,noise)},color,shader});
 });
 // BaseRecordingCanvas: bitmaps arrive as Bitmap.getNativeInstance() tokens
 const BH=r=>r.skiaHost.bitmaps;
 b3('nDrawBitmap',['J','J','F','F','J','I','I','I'],'V',(r,[h,bitmap,left,top,paint,canvasDensity,screenDensity,bitmapDensity])=>BH(r).nativeDraw(h,BH(r).byNativeInstance(bitmap),{left:finite([left])[0],top:finite([top])[0],paint,canvasDensity,bitmapDensity}));
 b3('nDrawBitmap',['J','J','F','F','F','F','F','F','F','F','J','I','I'],'V',(r,[h,bitmap,sl,st,sr,sb,dl,dt,dr,db,paint])=>BH(r).nativeDraw(h,BH(r).byNativeInstance(bitmap),{src:finite([sl,st,sr,sb]),dst:finite([dl,dt,dr,db]),paint}));
 b3('nDrawBitmapMatrix',['J','J','J','J'],'V',(r,[h,bitmap,matrix,paint])=>{const m=matrixFromHandle(r,matrix);if(m?.length!==9)fail('Invalid Matrix token');BH(r).nativeDraw(h,BH(r).byNativeInstance(bitmap),{transform:[m[0],m[1],m[2],m[3],m[4],m[5],0,0,1],paint});});
 map.delete(BRC+'->nDrawBitmap(J'+BMP+'FFJIII)V');map.delete(BRC+'->nDrawBitmap(J'+BMP+'FFFFFFFFJII)V');map.delete(BRC+'->nDrawBitmapMatrix(J'+BMP+'JJ)V');
 b3('nDrawPoints',['J','[F','I','I','J'],'V',(r,[h,pts,offset,count,paint])=>{const a=r.array(pts).elements.map(decode);if(offset<0||count<0||offset+count>a.length)r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','drawPoints range');for(let i=offset;i+1<offset+count;i+=2)draw(r,h,'point',[a[i],a[i+1]],paint);});
 b3('nDrawLines',['J','[F','I','I','J'],'V',(r,[h,pts,offset,count,paint])=>{const a=r.array(pts).elements.map(decode);if(offset<0||count<0||offset+count>a.length)r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','drawLines range');for(let i=offset;i+3<offset+count;i+=4)draw(r,h,'line',a.slice(i,i+4),paint);});
 b3('nPunchHole',['J','F','F','F','F','F','F'],'V',(r,[h])=>{canvas(r,h);fail('Canvas.punchHole requires the hwui CLEAR-mode compositing backend');});
 return map;
}
