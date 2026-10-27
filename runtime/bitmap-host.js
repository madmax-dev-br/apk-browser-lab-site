import {APKError} from './apk-error.js?v=33d211b8a989';
import {getVectorGraphics} from './vector-native.js?v=33d211b8a989';
import {getSolidPaint,getSolidPaintByHandle} from './paint-host.js?v=33d211b8a989';
import { gcRoot } from './heap-gc.js?v=33d211b8a989';
const BITMAP='Landroid/graphics/Bitmap;',CONFIG='Landroid/graphics/Bitmap$Config;',SPACE='Landroid/graphics/ColorSpace;',NAMED='Landroid/graphics/ColorSpace$Named;',CANVAS='Landroid/graphics/Canvas;';
// android.graphics.Bitmap.Config / ColorSpace.Named declaration order (API 28 + API 34 HLG/PQ appended).
const CONFIGS=['ALPHA_8','RGB_565','ARGB_4444','ARGB_8888','RGBA_F16','HARDWARE'];
const NAMES=['SRGB','LINEAR_SRGB','EXTENDED_SRGB','LINEAR_EXTENDED_SRGB','BT709','BT2020','DCI_P3','DISPLAY_P3','NTSC_1953','SMPTE_C','ADOBE_RGB','PRO_PHOTO_RGB','ACES','ACESCG','CIE_XYZ','CIE_LAB','BT2020_HLG','BT2020_PQ'];
const DM='Landroid/util/DisplayMetrics;';
const bits=new DataView(new ArrayBuffer(4)),num=n=>{bits.setInt32(0,n,true);return bits.getFloat32(0,true);};
const fail=message=>{throw new APKError(message,{kind:'bitmap-backend'});};
const keys=new Set();const add=(owner,list)=>list.forEach(s=>keys.add(owner+'->'+s));
add(BITMAP,['getNativeInstance()J',`createBitmap(II${CONFIG})${BITMAP}`,`createBitmap(II${CONFIG}Z)${BITMAP}`,`createBitmap(II${CONFIG}Z${SPACE})${BITMAP}`,`createBitmap(${DM}II${CONFIG})${BITMAP}`,`createBitmap(${DM}II${CONFIG}Z)${BITMAP}`,`createBitmap(${DM}II${CONFIG}Z${SPACE})${BITMAP}`,'getWidth()I','getHeight()I',`getConfig()${CONFIG}`,'hasAlpha()Z','setHasAlpha(Z)V',`getColorSpace()${SPACE}`,'isRecycled()Z','recycle()V','prepareToDraw()V','hasMipMap()Z','setHasMipMap(Z)V','isMutable()Z','isPremultiplied()Z','getDensity()I','getByteCount()I','getAllocationByteCount()I','getRowBytes()I','setDensity(I)V','eraseColor(I)V']);
add(CONFIG,[`values()[${CONFIG}`]);add(NAMED,[`values()[${NAMED}`]);
add(SPACE,[`get(${NAMED})${SPACE}`,'getId()I','getName()Ljava/lang/String;','isSrgb()Z','isWideGamut()Z','getComponentCount()I']);
add(CANVAS,['getWidth()I','getHeight()I',`throwIfCannotDraw(${BITMAP})V`,`<init>(${BITMAP})V`,`drawBitmap(${BITMAP}FFLandroid/graphics/Paint;)V`,`drawBitmap(${BITMAP}Landroid/graphics/Rect;Landroid/graphics/Rect;Landroid/graphics/Paint;)V`,`drawBitmap(${BITMAP}Landroid/graphics/Rect;Landroid/graphics/RectF;Landroid/graphics/Paint;)V`,`drawBitmap(${BITMAP}Landroid/graphics/Matrix;Landroid/graphics/Paint;)V`]);
/** Software Bitmap over the verified Skia canvas model: a Bitmap owns a recorded Canvas command list that Canvas(Bitmap) appends to;
 * its pixels are produced by the real Skia rasterizer when the bitmap is drawn (snapshot semantics at the draw call). */
export function createBitmapHost(runtime,{recordNative,rectF,matrixValues}){
 const enums=gcRoot(new Map()),spaces=gcRoot(new Map()),byHandle=gcRoot(new Map());   // byHandle: Bitmap.getNativeInstance() token -> Bitmap
 const enumValue=(owner,list,name)=>{
  const key=owner+name;if(!enums.has(key)){const ref=runtime.makeObject(owner),o=runtime.object(ref);o.enumName=name;o.enumOrdinal=list.indexOf(name);enums.set(key,ref);}return enums.get(key);
 };
 const state=ref=>{const o=runtime.object(ref);if(!o.bitmap)fail('Bitmap used before construction');return o.bitmap;};
 const live=ref=>{const b=state(ref);if(b.recycled)runtime.throwJava('Ljava/lang/IllegalStateException;','Can\'t access a recycled bitmap');return b;};
 const colorSpace=name=>{
  if(name!=='SRGB')fail(`ColorSpace.Named.${name} is not implemented; only sRGB has a Skia-backed Bitmap pipeline`);
  if(!spaces.has(name)){const ref=runtime.makeObject(SPACE);runtime.object(ref).colorSpaceName=name;spaces.set(name,ref);}return spaces.get(name);
 };
 const create=(width,height,config,hasAlpha,space,{mutable=true,hardware=false}={})=>{
  if(!(width>0&&height>0))runtime.throwJava('Ljava/lang/IllegalArgumentException;','width and height must be > 0');
  if(config===null||config===0)runtime.throwJava('Ljava/lang/NullPointerException;','config is null');
  const configName=runtime.object(config).enumName;
  if(!hardware&&configName!=='ARGB_8888'&&configName!=='ALPHA_8')fail(`Bitmap.Config.${configName} is not implemented; only ARGB_8888 and ALPHA_8 have a Skia-backed Bitmap`);
  if(space&&runtime.object(space).colorSpaceName!=='SRGB')fail('Only sRGB Bitmap color spaces are implemented');
  if(width>4096||height>4096||width*height>4*1024*1024)fail('Bitmap extent exceeds4096px/4Mpixel VM limit');
  const graphics=getVectorGraphics(runtime),handle=graphics.createCanvas(),canvas=graphics.get(handle,'canvas');Object.assign(canvas,{width,height});
  const ref=runtime.makeObject(BITMAP),o=runtime.object(ref);
  o.bitmap={width,height,config,hasAlpha,handle,recycled:false,mipMap:false,density:160,colorSpace:colorSpace('SRGB'),mutable};
  runtime.storeField(o.fields,`${BITMAP}->mDensity:I`,160);byHandle.set(handle,ref);
  return ref;
 };
 /** Records a draw of the bitmap's current pixels into a canvas handle. */
 const drawInto=(handle,bitmapRef,{left=0,top=0,src=null,dst=null,transform=null,paintRef=null,paint:resolved=null,scale=1}={})=>{
  const b=live(bitmapRef),graphics=getVectorGraphics(runtime);
  const holder=b.canvasObject??=runtime.allocate(CANVAS);
  if(!runtime.object(holder).nativeCanvasHandle)runtime.object(holder).nativeCanvasHandle=b.handle;
  const raster=graphics.snapshotCanvas(holder,b.width,b.height),paint=resolved??(paintRef?{...getSolidPaint(runtime,paintRef)}:null);
  const command={op:'raster',raster,args:[left,top],paint};
  // ALPHA_8 keeps only coverage; Skia then tints it with the draw Paint's color/filter.
  if(runtime.object(b.config).enumName==='ALPHA_8')command.alpha8=true;
  if(src&&dst){command.src=src;command.dst=dst;}
  else if(scale!==1)command.imageScale=scale;
  if(transform)command.imageMatrix=transform;
  recordNative(handle,command);
 };
 const dpi=(canvasDensity,bitmapDensity)=>canvasDensity&&bitmapDensity&&canvasDensity!==bitmapDensity?canvasDensity/bitmapDensity:1;
 return {
  supports:key=>keys.has(key),
  parent:type=>type===CONFIG||type===NAMED?'Ljava/lang/Enum;':type===BITMAP||type===SPACE?'Ljava/lang/Object;':null,
  readStatic(field){
   if(field.owner===CONFIG&&CONFIGS.includes(field.name))return{handled:true,value:enumValue(CONFIG,CONFIGS,field.name)};
   if(field.owner===NAMED&&NAMES.includes(field.name))return{handled:true,value:enumValue(NAMED,NAMES,field.name)};
   return null;
  },
  drawInto,create,live,enumValue,CONFIGS,matrixValues,rectF,recordNative,
  /** Bitmap for a Bitmap.getNativeInstance() token (the API 33 RecordingCanvas natives take the bitmap handle, not the object). */
  byNativeInstance(handle){const ref=byHandle.get(BigInt(handle));if(!ref)fail('Invalid Bitmap native instance token');live(ref);return ref;},
  /** Pixels of a Bitmap for BitmapShader sampling: a snapshot raster plus whether the bitmap is coverage-only (ALPHA_8). */
  shaderSource(bitmapRef){
   const b=live(bitmapRef),graphics=getVectorGraphics(runtime),holder=b.canvasObject??=runtime.allocate(CANVAS);
   if(!runtime.object(holder).nativeCanvasHandle)runtime.object(holder).nativeCanvasHandle=b.handle;
   return{raster:graphics.snapshotCanvas(holder,b.width,b.height),alpha8:runtime.object(b.config).enumName==='ALPHA_8',width:b.width,height:b.height};
  },
  /** Native RecordingCanvas boundary (nDrawBitmap*): canvas/native paint tokens, densities as passed by the original Java. */
  nativeDraw(handle,bitmapRef,{left=0,top=0,src=null,dst=null,transform=null,paint=0,canvasDensity=0,bitmapDensity=0}){
   const scale=src?1:dpi(canvasDensity,bitmapDensity);
   drawInto(handle,bitmapRef,{left,top,src,dst,transform,scale,paint:paint?{...getSolidPaintByHandle(runtime,paint)}:null});
  },
  invoke(vm,method,args){
   const owner=method.owner,name=method.name;
   if(owner===CONFIG||owner===NAMED){const list=owner===CONFIG?CONFIGS:NAMES,array=vm.newArray('['+owner,list.length);vm.object(array).elements=list.map(item=>enumValue(owner,list,item));return array;}
   if(owner===SPACE){
    if(name==='get'){const named=vm.object(args[0]);return colorSpace(named.enumName);}
    return name==='getId'?0:name==='getName'?'sRGB IEC61966-2.1':name==='isSrgb'?1:name==='isWideGamut'?0:3;
   }
   if(owner===CANVAS){
    if(name==='getWidth'||name==='getHeight'){const bitmap=vm.object(args[0]).canvasBitmap;const o=vm.object(args[0]);return bitmap?state(bitmap)[name==='getWidth'?'width':'height']:(name==='getWidth'?o.canvasWidth:o.canvasHeight)??0;}   // Canvas.nGetWidth: the bitmap's size, 0 without one
    if(name==='throwIfCannotDraw'){if(state(args[1]).recycled)vm.throwJava('Ljava/lang/RuntimeException;','Canvas: trying to use a recycled bitmap');return;}
    if(name==='<init>'){
     const b=live(args[1]);if(b.mutable===false)vm.throwJava('Ljava/lang/IllegalStateException;','Immutable bitmap passed to Canvas constructor');
     const object=vm.object(args[0]);object.nativeCanvasHandle=b.handle;object.canvasBitmap=args[1];
     for(const[field,type,value]of[['mNativeCanvasWrapper','J',b.handle],['mDensity','I',0],['mScreenDensity','I',0]])vm.storeField(object.fields,`${CANVAS}->${field}:${type}`,value);
     object.canvasDensity=0;return;
    }
    const handle=vm.object(args[0]).nativeCanvasHandle,p=method.parameters,paintRef=args.at(-1)||null;
    if(p[1]==='F')return drawInto(handle,args[1],{left:num(args[2]),top:num(args[3]),paintRef});
    if(p[1]==='Landroid/graphics/Matrix;')return drawInto(handle,args[1],{transform:matrixValues(vm,args[2]),paintRef});
    const bm=live(args[1]),srcRect=args[2]?(()=>{const f=vm.object(args[2]).fields;return['left','top','right','bottom'].map(n=>f.get(`Landroid/graphics/Rect;->${n}:I`)??0);})():[0,0,bm.width,bm.height];
    const dst=p[2]==='Landroid/graphics/RectF;'?rectF(args[3]):(()=>{const f=vm.object(args[3]).fields;return['left','top','right','bottom'].map(n=>f.get(`Landroid/graphics/Rect;->${n}:I`)??0);})();
    return drawInto(handle,args[1],{src:srcRect,dst,paintRef});
   }
   // Bitmap
   if(name==='createBitmap'){
    let p=method.parameters,a=args;if(p[0]===DM){if(a[0])fail('Bitmap.createBitmap(DisplayMetrics) density scaling is not implemented');p=p.slice(1);a=a.slice(1);}return create(a[0],a[1],a[2],p.length>=4?!!a[3]:true,p.length===5?a[4]:null);
   }
   const b=state(args[0]);
   switch(name){
    case'getNativeInstance':return b.handle;
    case'getWidth':return b.width;case'getHeight':return b.height;case'getConfig':return b.config;case'hasAlpha':return b.hasAlpha?1:0;
    case'setHasAlpha':b.hasAlpha=!!args[1];return;case'getColorSpace':return b.colorSpace;case'isRecycled':return b.recycled?1:0;
    case'recycle':b.recycled=true;return;case'prepareToDraw':return;case'hasMipMap':return b.mipMap?1:0;case'setHasMipMap':b.mipMap=!!args[1];return;
    case'isMutable':return b.mutable===false?0:1;case'isPremultiplied':return 1;case'getDensity':return b.density;
    case'getRowBytes':return b.width*(vm.object(b.config).enumName==='ALPHA_8'?1:4);
    case'getByteCount':case'getAllocationByteCount':return b.width*b.height*(vm.object(b.config).enumName==='ALPHA_8'?1:4);
    case'setDensity':b.density=args[1];vm.storeField(vm.object(args[0]).fields,`${BITMAP}->mDensity:I`,args[1]);return;
    case'eraseColor':{live(args[0]);const c=getVectorGraphics(vm).get(b.handle,'canvas');c.draws.length=0;recordNative(b.handle,{op:'color',color:args[1],blendMode:1});return;}
   }
   fail('Unknown Bitmap operation '+name);
  },
 };
}
