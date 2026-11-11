import {APKError} from './apk-error.js?v=dcfaf7b69a30';
import {getVectorGraphics} from './vector-native.js?v=dcfaf7b69a30';
import {getSolidPaint,getSolidPaintByHandle} from './paint-host.js?v=dcfaf7b69a30';
import { gcRoot } from './heap-gc.js?v=dcfaf7b69a30';
const BITMAP='Landroid/graphics/Bitmap;',CONFIG='Landroid/graphics/Bitmap$Config;',SPACE='Landroid/graphics/ColorSpace;',NAMED='Landroid/graphics/ColorSpace$Named;',CANVAS='Landroid/graphics/Canvas;';
// android.graphics.Bitmap.Config declaration order (android-13.0.0_r1: RGBA_1010102 is API 33 and last) / ColorSpace.Named order (API 34 HLG/PQ appended).
const CONFIGS=['ALPHA_8','RGB_565','ARGB_4444','ARGB_8888','RGBA_F16','HARDWARE','RGBA_1010102'];
// bytes: bytes per pixel in memory; native: Config.nativeInt; surface: the Skia color type a RGB_565 / RGBA_F16 / RGBA_1010102 bitmap rasterizes on (the rest use the N32 surface; ALPHA_8 keeps the coverage channel of it).
const CONFIG_INFO={ALPHA_8:{bytes:1,native:1},RGB_565:{bytes:2,native:3,surface:'RGB_565'},ARGB_4444:{bytes:4,native:4},ARGB_8888:{bytes:4,native:5},RGBA_F16:{bytes:8,native:6,surface:'RGBA_F16'},HARDWARE:{bytes:4,native:7},RGBA_1010102:{bytes:4,native:8,surface:'RGBA_1010102'}};
const NAMES=['SRGB','LINEAR_SRGB','EXTENDED_SRGB','LINEAR_EXTENDED_SRGB','BT709','BT2020','DCI_P3','DISPLAY_P3','NTSC_1953','SMPTE_C','ADOBE_RGB','PRO_PHOTO_RGB','ACES','ACESCG','CIE_XYZ','CIE_LAB','BT2020_HLG','BT2020_PQ'];
// The named spaces the lab's bitmap pipeline can represent (all RGB, sRGB primaries): id/name as AOSP ColorSpace.Named, range [min,max] per component, linear transfer or not.
const SPACES={SRGB:{name:'sRGB IEC61966-2.1',linear:false,min:0,max:1},LINEAR_SRGB:{name:'sRGB IEC61966-2.1 (Linear)',linear:true,min:0,max:1},EXTENDED_SRGB:{name:'scRGB-nl IEC 61966-2-2:2003',linear:false,min:-0.799,max:2.399},LINEAR_EXTENDED_SRGB:{name:'scRGB IEC 61966-2-2:2003',linear:true,min:-0.5,max:7.499}};
const DM='Landroid/util/DisplayMetrics;';
const bits=new DataView(new ArrayBuffer(4)),num=n=>{bits.setInt32(0,n,true);return bits.getFloat32(0,true);};
const fail=message=>{throw new APKError(message,{kind:'bitmap-backend'});};
const keys=new Set();const add=(owner,list)=>list.forEach(s=>keys.add(owner+'->'+s));
const SRC_PAINT={argb:-1,flags:0,style:0,strokeWidth:0,strokeMiter:4,strokeCap:0,strokeJoin:0,blendMode:1};
const base64=bytes=>{let binary='';for(let at=0;at<bytes.length;at+=16384)binary+=String.fromCharCode(...bytes.subarray(at,at+16384));return btoa(binary);};
add(BITMAP,['getNativeInstance()J']);
add(CONFIG,[`values()[${CONFIG}`]);add(NAMED,[`values()[${NAMED}`]);
add(SPACE,[`get(${NAMED})${SPACE}`,'getId()I','getName()Ljava/lang/String;','isSrgb()Z','isWideGamut()Z','getComponentCount()I','getMinValue(I)F','getMaxValue(I)F']);
add(CANVAS,['getWidth()I','getHeight()I',`throwIfCannotDraw(${BITMAP})V`,`<init>(${BITMAP})V`,`setBitmap(${BITMAP})V`,`drawBitmap(${BITMAP}FFLandroid/graphics/Paint;)V`,`drawBitmap(${BITMAP}Landroid/graphics/Rect;Landroid/graphics/Rect;Landroid/graphics/Paint;)V`,`drawBitmap(${BITMAP}Landroid/graphics/Rect;Landroid/graphics/RectF;Landroid/graphics/Paint;)V`,`drawBitmap(${BITMAP}Landroid/graphics/Matrix;Landroid/graphics/Paint;)V`,
 'drawBitmap([IIIFFIIZLandroid/graphics/Paint;)V','drawBitmap([IIIIIIIZLandroid/graphics/Paint;)V',`drawBitmapMesh(${BITMAP}II[FI[IILandroid/graphics/Paint;)V`]);
/** Software Bitmap over the verified Skia canvas model: a Bitmap owns a recorded Canvas command list that Canvas(Bitmap) appends to;
 * its pixels are produced by the real Skia rasterizer when the bitmap is read or drawn (snapshot semantics at the draw call), on a Skia surface of the color type of its Config
 * (RGB_565, RGBA_F16, RGBA_1010102 natively; ARGB_8888 and ALPHA_8 on N32). Pixel setters record exact pixel data, flattened when the command list grows. The Java-facing Bitmap API is src/bitmap-ops-host.js. */
export function createBitmapHost(runtime,{recordNative,rectF,matrixValues}){
 const enums=gcRoot(new Map()),spaces=gcRoot(new Map()),byHandle=gcRoot(new Map());   // byHandle: Bitmap.getNativeInstance() token -> Bitmap
 const enumValue=(owner,list,name)=>{
  const key=owner+name;if(!enums.has(key)){const ref=runtime.makeObject(owner),o=runtime.object(ref);o.enumName=name;o.enumOrdinal=list.indexOf(name);if(owner===CONFIG)runtime.storeField(o.fields,`${CONFIG}->nativeInt:I`,CONFIG_INFO[name].native);enums.set(key,ref);}return enums.get(key);
 };
 const throwJava=(type,message)=>runtime.throwJava(type,message);
 const state=ref=>{const o=runtime.object(ref);if(!o.bitmap)fail('Bitmap used before construction');return o.bitmap;};
 const live=(ref,message='Can\'t access a recycled bitmap')=>{const b=state(ref);if(b.recycled)throwJava('Ljava/lang/IllegalStateException;',message);return b;};
 const colorSpace=name=>{
  if(!SPACES[name])fail(`ColorSpace.Named.${name} is not implemented; only SRGB, LINEAR_SRGB, EXTENDED_SRGB and LINEAR_EXTENDED_SRGB have a Skia-backed Bitmap pipeline`);
  if(!spaces.has(name)){const ref=runtime.makeObject(SPACE);runtime.object(ref).colorSpaceName=name;spaces.set(name,ref);}return spaces.get(name);
 };
 const configName=b=>runtime.object(b.config).enumName;
 /** The Config whose memory layout holds the pixels (a HARDWARE bitmap keeps the layout it was copied from). */
 const storage=b=>b.hardware?b.backing??'ARGB_8888':configName(b);
 const bytesPerPixel=b=>CONFIG_INFO[storage(b)].bytes;
 const canvasOf=b=>getVectorGraphics(runtime).get(b.handle,'canvas');
 const holderOf=b=>{const holder=b.canvasObject??=runtime.allocate(CANVAS);if(!runtime.object(holder).nativeCanvasHandle)runtime.object(holder).nativeCanvasHandle=b.handle;return holder;};
 const render=(b,extra)=>{
  const surfaceType=CONFIG_INFO[storage(b)].surface,options=surfaceType||extra?{...(surfaceType?{surfaceType}:{}),...extra}:undefined;
  return getVectorGraphics(runtime).snapshotCanvas(holderOf(b),b.width,b.height,options);
 };
 /** getGenerationId: changes on every mutation, drawing through a Canvas included (every recorded command counts). */
 const generation=b=>b.genBase+canvasOf(b).draws.length+1;
 const record=(b,command)=>recordNative(b.handle,command);
 /** Drops the pixels (the command list) and optionally resizes: the generation id keeps growing. */
 const reset=(b,width=b.width,height=b.height)=>{const canvas=canvasOf(b);b.genBase+=canvas.draws.length+1;canvas.draws.length=0;canvas.width=width;canvas.height=height;b.width=width;b.height=height;b.px=null;};
 const create=(width,height,config,hasAlpha,space,{mutable=true,hardware=false}={})=>{
  if(!(width>0&&height>0))throwJava('Ljava/lang/IllegalArgumentException;','width and height must be > 0');
  if(config===null||config===0)throwJava('Ljava/lang/NullPointerException;','config is null');
  let name=runtime.object(config).enumName;
  if(name==='ARGB_4444'){name='ARGB_8888';config=enumValue(CONFIG,CONFIGS,name);}   // deprecated since KitKat: created as ARGB_8888 (GraphicsJNI::legacyBitmapConfigToColorType)
  if(!hardware&&name==='HARDWARE')fail('Bitmap.Config.HARDWARE bitmaps are created by Bitmap.copy(HARDWARE, false) or BitmapFactory only');
  const requested=space?runtime.object(space).colorSpaceName:null;
  if(requested&&requested!=='SRGB'&&name!=='RGBA_F16'&&name!=='ALPHA_8')fail(`ColorSpace.Named.${requested} is only implemented for Bitmap.Config.RGBA_F16 bitmaps`);
  if(requested&&!SPACES[requested])fail(`ColorSpace ${requested} is not implemented for Bitmap`);
  if(width>4096||height>4096||width*height>4*1024*1024)fail('Bitmap extent exceeds4096px/4Mpixel VM limit');
  const graphics=getVectorGraphics(runtime),handle=graphics.createCanvas(),canvas=graphics.get(handle,'canvas');Object.assign(canvas,{width,height});
  const ref=runtime.makeObject(BITMAP),o=runtime.object(ref);
  const spaceName=name==='ALPHA_8'?null:name==='RGBA_F16'?(requested&&requested!=='SRGB'?requested:'LINEAR_EXTENDED_SRGB'):'SRGB'   // RGBA_F16 defaults to (and, requested as sRGB, becomes) linear extended sRGB;
  o.bitmap={width,height,config,hasAlpha:name==='RGB_565'?false:!!hasAlpha,handle,recycled:false,mipMap:false,density:160,colorSpace:spaceName?colorSpace(spaceName):null,mutable,premultiplied:true,genBase:0,allocBytes:width*height*CONFIG_INFO[name].bytes,hardware:false,px:null};
  runtime.storeField(o.fields,`${BITMAP}->mDensity:I`,160);byHandle.set(handle,ref);
  return ref;
 };
 /** Marks a bitmap as Config.HARDWARE: immutable, no CPU pixel access, drawing still works (pixels keep the layout they were copied from). */
 const makeHardware=b=>{b.backing=configName(b);b.hardware=true;b.mutable=false;b.config=enumValue(CONFIG,CONFIGS,'HARDWARE');};
 const colorTypeName=name=>name==='RGB_565'||name==='RGBA_F16'||name==='RGBA_1010102'?name:'RGBA_8888';
 /** The pixels of the bitmap as Skia rasterizes them now: straight sRGB RGBA8 (`straight`: alpha-only for ALPHA_8, alpha forced to 255 when !hasAlpha), the raw memory bytes of the bitmap's color type
  *  (`raw`: premultiplied, w*h*bytes; one byte per pixel for ALPHA_8) and, with half=true on RGBA_F16, the unpremultiplied half-float words. Cached per generation id. */
 const read=(b,{half=false}={})=>{
  const key=generation(b)+':'+b.hasAlpha+':'+b.width+'x'+b.height;
  if(b.px&&b.px.key===key&&(!half||b.px.half))return b.px;
  const name=storage(b),out=render(b,{pixels:true,raw:true,...(half?{halfFloats:true}:{})}),n=b.width*b.height;
  let straight=out.pixels,raw=out.raw;
  if(name==='ALPHA_8'){raw=new Uint8Array(n);for(let i=0;i<n;i++){raw[i]=straight[i*4+3];straight[i*4]=straight[i*4+1]=straight[i*4+2]=0;}}
  else if(!b.hasAlpha&&name!=='RGB_565'){for(let i=0;i<n;i++){const a=straight[i*4+3];if(a!==255){for(let k=0;k<3;k++)straight[i*4+k]=Math.round(straight[i*4+k]*a/255);straight[i*4+3]=255;}}}
  b.px={key,straight,raw,half:out.halfFloats};return b.px;
 };
 /** Writes exact pixel data (SRC blend, no resampling) into a rectangle: `bytes` are rows of w*h pixels in `colorType` ('RGBA_8888' | 'RGB_565' | 'RGBA_F16' | 'RGBA_1010102') with `alphaType` ('Premul' | 'Unpremul' | 'Opaque'). */
 const writeRect=(b,x,y,w,h,colorType,alphaType,bytes)=>record(b,{op:'raster',pixelData:{width:w,height:h,colorType,alphaType,base64:base64(bytes)},raster:{kind:'raster',width:w,height:h},args:[x,y],paint:{...SRC_PAINT}});
 /** The whole bitmap rebuilt as one pixel-data command (bounded command list; the pixels do not change). */
 const flatten=b=>{
  const name=storage(b),{raw}=read(b),n=b.width*b.height;let bytes=raw,colorType=colorTypeName(name);
  if(name==='ALPHA_8'){bytes=new Uint8Array(n*4);for(let i=0;i<n;i++)bytes[i*4+3]=raw[i];}
  reset(b);writeRect(b,0,0,b.width,b.height,colorType,name==='RGB_565'?'Opaque':'Premul',bytes);
 };
 const FLATTEN_AT=900;
 /** Canvas(Bitmap) draws append to the bitmap's command list, bounded by the Skia command limit: when it is nearly full the pixels so far are folded into one command. */
 const flattenFullCanvas=handle=>{
  const ref=byHandle.get(handle);if(!ref)return;const o=runtime.object(ref),b=o.bitmap;
  if(!b||b.recycled||b.flattening)return;const canvas=canvasOf(b);if(canvas.draws.length<FLATTEN_AT)return;
  b.flattening=true;try{flatten(b);}finally{b.flattening=false;}
 };
 /** Records a draw of the bitmap's current pixels into a canvas handle. */
 const drawInto=(handle,bitmapRef,{left=0,top=0,src=null,dst=null,transform=null,paintRef=null,paint:resolved=null,scale=1,filter=false}={})=>{
  const b=live(bitmapRef),paint=resolved??(paintRef?{...getSolidPaint(runtime,paintRef)}:null);
  const raster=render(b);
  const command={op:'raster',raster,args:[left,top],paint};
  // ALPHA_8 keeps only coverage; Skia then tints it with the draw Paint's color/filter.
  if(storage(b)==='ALPHA_8')command.alpha8=true;
  if(src&&dst){command.src=src;command.dst=dst;}
  else if(scale!==1)command.imageScale=scale;
  if(transform)command.imageMatrix=transform;
  if(filter)command.filter=true;
  recordNative(handle,command);
 };
 const dpi=(canvasDensity,bitmapDensity)=>canvasDensity&&bitmapDensity&&canvasDensity!==bitmapDensity?canvasDensity/bitmapDensity:1;
 const intArgs=(vm,object,names)=>names.map(n=>vm.object(object).fields.get(`Landroid/graphics/Rect;->${n}:I`)??0);
 /** Canvas.drawBitmap(int[] colors, ...) / drawBitmapMesh: native-side checks of Canvas.java then a recorded raster. */
 const drawColors=(vm,handle,[colors,offset,stride,x,y,width,height,hasAlpha,paintRef])=>{
  if(width<0)throwJava('Ljava/lang/IllegalArgumentException;','width must be >= 0');
  if(height<0)throwJava('Ljava/lang/IllegalArgumentException;','height must be >= 0');
  if(Math.abs(stride)<width)throwJava('Ljava/lang/IllegalArgumentException;','abs(stride) must be >= width');
  const source=vm.array(colors).elements,lastScanline=offset+(height-1)*stride;
  if(offset<0||offset+width>source.length||lastScanline<0||lastScanline+width>source.length)throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;',null);
  if(width===0||height===0)return;
  const bytes=new Uint8Array(width*height*4);
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){const c=source[offset+row*stride+col]|0,at=(row*width+col)*4;bytes[at]=(c>>16)&255;bytes[at+1]=(c>>8)&255;bytes[at+2]=c&255;bytes[at+3]=hasAlpha?(c>>>24)&255:255;}
  recordNative(handle,{op:'raster',pixelData:{width,height,colorType:'RGBA_8888',alphaType:'Unpremul',base64:base64(bytes)},raster:{kind:'raster',width,height},args:[x,y],paint:paintRef?{...getSolidPaint(vm,paintRef)}:null});
 };
 const drawMesh=(vm,handle,[bitmap,meshWidth,meshHeight,verts,vertOffset,colors,colorOffset,paintRef])=>{
  const range=(length,offset,count)=>{if((offset|count)<0||offset+count>length)throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;',null);};
  if((meshWidth|meshHeight|vertOffset|colorOffset)<0)throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;',null);
  if(meshWidth===0||meshHeight===0)return;
  const count=(meshWidth+1)*(meshHeight+1),b=live(bitmap);
  const vertexWords=vm.array(verts).elements;range(vertexWords.length,vertOffset,count*2);
  const colorWords=colors?vm.array(colors).elements:null;if(colorWords)range(colorWords.length,colorOffset,count);
  if(count>65535)fail('Canvas.drawBitmapMesh mesh exceeds 65535 vertices');
  const positions=[];for(let i=0;i<count*2;i++)positions.push(num(vertexWords[vertOffset+i]));
  const command={op:'raster',raster:render(b),args:[0,0],paint:paintRef?{...getSolidPaint(vm,paintRef)}:null,mesh:{width:meshWidth,height:meshHeight,positions,colors:colorWords?Array.from(colorWords.slice(colorOffset,colorOffset+count),c=>c|0):null,bitmapWidth:b.width,bitmapHeight:b.height}};
  if(storage(b)==='ALPHA_8')fail('Canvas.drawBitmapMesh of an ALPHA_8 bitmap is not implemented');
  recordNative(handle,command);
 };
 return {
  supports:key=>keys.has(key),
  parent:type=>type===CONFIG||type===NAMED?'Ljava/lang/Enum;':type===BITMAP||type===SPACE?'Ljava/lang/Object;':null,
  readStatic(field){
   if(field.owner===CONFIG&&CONFIGS.includes(field.name))return{handled:true,value:enumValue(CONFIG,CONFIGS,field.name)};
   if(field.owner===NAMED&&NAMES.includes(field.name))return{handled:true,value:enumValue(NAMED,NAMES,field.name)};
   return null;
  },
  drawInto,create,live,state,enumValue,CONFIGS,CONFIG_INFO,SPACES,NAMES,matrixValues,rectF,recordNative,colorSpace,configName,storage,bytesPerPixel,canvasOf,render,read,reset,writeRect,flatten,flattenFullCanvas,generation,makeHardware,colorTypeName,base64,
  /** Bitmap for a Bitmap.getNativeInstance() token (the API 33 RecordingCanvas natives take the bitmap handle, not the object). */
  byNativeInstance(handle){const ref=byHandle.get(BigInt(handle));if(!ref)fail('Invalid Bitmap native instance token');live(ref);return ref;},
  /** Pixels of a Bitmap for BitmapShader sampling: a snapshot raster plus whether the bitmap is coverage-only (ALPHA_8). */
  shaderSource(bitmapRef){
   const b=live(bitmapRef);
   return{raster:render(b),alpha8:storage(b)==='ALPHA_8',width:b.width,height:b.height};
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
    const spaceName=vm.object(args[0]).colorSpaceName,info=SPACES[spaceName];
    switch(name){
     case'getId':return NAMES.indexOf(spaceName);case'getName':return info.name;case'isSrgb':return spaceName==='SRGB'?1:0;
     case'isWideGamut':return info.max>1||info.min<0?1:0;case'getComponentCount':return 3;
     case'getMinValue':return bitsFloat(info.min);case'getMaxValue':return bitsFloat(info.max);
    }
   }
   if(owner===CANVAS){
    if(name==='getWidth'||name==='getHeight'){const bitmap=vm.object(args[0]).canvasBitmap;const o=vm.object(args[0]);return bitmap?state(bitmap)[name==='getWidth'?'width':'height']:(name==='getWidth'?o.canvasWidth:o.canvasHeight)??0;}   // Canvas.nGetWidth: the bitmap's size, 0 without one
    if(name==='throwIfCannotDraw'){if(state(args[1]).recycled)vm.throwJava('Ljava/lang/RuntimeException;','Canvas: trying to use a recycled bitmap');return;}
    if(name==='setBitmap'){   // Canvas.setBitmap: later draws go to the bitmap (null detaches the canvas: draws land on a scratch device); the bitmap's recorded command list is shared with every Canvas bound to it
     const object=vm.object(args[0]);let handle;
     if(args[1]===null||args[1]===0){handle=getVectorGraphics(vm).createCanvas();object.canvasBitmap=null;}
     else{const b=state(args[1]);if(b.mutable===false)vm.throwJava('Ljava/lang/IllegalStateException;',null);if(b.recycled)vm.throwJava('Ljava/lang/RuntimeException;','Canvas: trying to use a recycled bitmap');handle=b.handle;object.canvasBitmap=args[1];}
     object.nativeCanvasHandle=handle;vm.storeField(object.fields,`${CANVAS}->mNativeCanvasWrapper:J`,handle);return;
    }
    if(name==='<init>'){
     const b=state(args[1]);if(b.mutable===false)vm.throwJava('Ljava/lang/IllegalStateException;','Immutable bitmap passed to Canvas constructor');if(b.recycled)vm.throwJava('Ljava/lang/RuntimeException;','Canvas: trying to use a recycled bitmap');
     const object=vm.object(args[0]);object.nativeCanvasHandle=b.handle;object.canvasBitmap=args[1];
     for(const[field,type,value]of[['mNativeCanvasWrapper','J',b.handle],['mDensity','I',0],['mScreenDensity','I',0]])vm.storeField(object.fields,`${CANVAS}->${field}:${type}`,value);
     object.canvasDensity=0;return;
    }
    const handle=vm.object(args[0]).nativeCanvasHandle,p=method.parameters,paintRef=args.at(-1)||null;
    if(name==='drawBitmapMesh')return drawMesh(vm,handle,args.slice(1));
    if(p[0]==='[I'){const values=args.slice(1);if(p[3]==='I'){values[3]=values[3]|0;values[4]=values[4]|0;}else{values[3]=num(values[3]);values[4]=num(values[4]);}return drawColors(vm,handle,values);}
    if(state(args[1]).recycled)vm.throwJava('Ljava/lang/RuntimeException;','Canvas: trying to use a recycled bitmap');
    if(p[1]==='F')return drawInto(handle,args[1],{left:num(args[2]),top:num(args[3]),paintRef});
    if(p[1]==='Landroid/graphics/Matrix;')return drawInto(handle,args[1],{transform:matrixValues(vm,args[2]),paintRef});
    const bm=live(args[1]),srcRect=args[2]?intArgs(vm,args[2],['left','top','right','bottom']):[0,0,bm.width,bm.height];
    const dst=p[2]==='Landroid/graphics/RectF;'?rectF(args[3]):intArgs(vm,args[3],['left','top','right','bottom']);
    return drawInto(handle,args[1],{src:srcRect,dst,paintRef});
   }
   // Bitmap (the rest of android.graphics.Bitmap is src/bitmap-ops-host.js)
   const b=state(args[0]);
   if(name==='getNativeInstance')return b.handle;
   fail('Unknown Bitmap operation '+name);
  },
 };
}
const f32=new DataView(new ArrayBuffer(4));
function bitsFloat(value){f32.setFloat32(0,value,true);return f32.getInt32(0,true);}
