import {APKError} from './apk-runtime.js?v=96c9de77f557';
import {getVectorGraphics} from './vector-native.js?v=96c9de77f557';
import {getSolidPaint,getPaintState} from './paint-host.js?v=96c9de77f557';
import {createMatrixAllocationHost,getMatrixValues} from './matrix-native.js?v=96c9de77f557';
import {measureSkiaRun,measureSkiaTextBounds,drawSkiaTextRun,measureSkiaShapedText} from './skia-paragraph.js?v=96c9de77f557';
import {getRenderNodeSnapshot,renderNodeShadowCaster,renderLightInfo,renderNodeStretchMatrix} from './rendernode-native.js?v=96c9de77f557';
import {makeSkiaColorFilter} from './color-filter-native.js?v=96c9de77f557';
import {createBitmapHost} from './bitmap-host.js?v=96c9de77f557';
import { gcRoot } from './heap-gc.js?v=96c9de77f557';
import {sha256Hex} from './sha256-sync.js?v=96c9de77f557';
import {sfntMember,sfntAxes,sfntStyle} from './sfnt.js?v=96c9de77f557';
const PATH='Landroid/graphics/Path;',CANVAS='Landroid/graphics/Canvas;';
const bits=new DataView(new ArrayBuffer(4));const number=n=>{bits.setInt32(0,n,true);return bits.getFloat32(0,true);};
const fail=message=>{throw new APKError(message,{kind:'skia-backend-unsupported'});};
const matrix=m=>[m[0],m[2],m[4],m[1],m[3],m[5],0,0,1];
const finite=values=>{if(values.some(v=>!Number.isFinite(v)))fail('Non-finite Skia geometry');return values;};
const argb=(CK,color,alpha=1)=>{const c=color>>>0;return CK.Color((c>>>16)&255,(c>>>8)&255,c&255,(c>>>24)/255*alpha);};
/** Android BitmapShader over a snapshot raster. ALPHA_8 bitmaps are coverage only: Skia exposes them as (0,0,0,a), later tinted by the Paint's color filter. */
function buildBitmapShader(CK,shader){
 if(!shader.raster?.dataURL?.startsWith('data:image/png;base64,'))fail('Unsupported Paint shader description');
 const bytes=Uint8Array.from(atob(shader.raster.dataURL.slice(22)),c=>c.charCodeAt(0)),image=CK.MakeImageFromEncoded(bytes);if(!image)fail('Skia rejected the BitmapShader raster');
 let source=image,coverage=null;
 try{
  if(shader.alpha8){
   const surface=CK.MakeSurface(image.width(),image.height());if(!surface)fail('Skia BitmapShader mask allocation failed');
   const mask=new CK.Paint(),filter=CK.ColorFilter.MakeBlend(CK.Color(0,0,0,1),CK.BlendMode.SrcIn);mask.setColorFilter(filter);
   try{surface.getCanvas().clear(CK.TRANSPARENT);surface.getCanvas().drawImage(image,0,0,mask);surface.flush();coverage=surface.makeImageSnapshot();source=coverage;}finally{mask.delete();filter.delete();surface.dispose();}
  }
  const modes=[CK.TileMode.Clamp,CK.TileMode.Repeat,CK.TileMode.Mirror];
  return source.makeShaderOptions(modes[shader.tileX],modes[shader.tileY],CK.FilterMode.Linear,CK.MipmapMode.None,shader.matrix?shader.matrix.slice():undefined);
 }finally{coverage?.delete();image.delete();}
}
/** AGSL (android.graphics.RuntimeShader) as an SkSL runtime effect: uniforms are matched by name to the effect's uniform slots, `uniform shader` children in declaration order. */
// A compiled SkSL program is immutable and depends on its source only, so it is compiled once per source and kept (bounded, least recently used first): hwui keeps the
// compiled program in the RuntimeShader too. Compiling the ripple's shader took 20-40 ms per replay, more than every other command of a frame together.
const RUNTIME_EFFECTS=new Map(),RUNTIME_EFFECT_LIMIT=64;
function runtimeEffectFor(CK,source){
 const known=RUNTIME_EFFECTS.get(source);if(known){RUNTIME_EFFECTS.delete(source);RUNTIME_EFFECTS.set(source,known);return known;}
 const effect=CK.RuntimeEffect.Make(source,message=>fail('AGSL/SkSL compile error: '+message));if(!effect)fail('Skia rejected the AGSL runtime effect');
 RUNTIME_EFFECTS.set(source,effect);while(RUNTIME_EFFECTS.size>RUNTIME_EFFECT_LIMIT){const [oldest,old]=RUNTIME_EFFECTS.entries().next().value;RUNTIME_EFFECTS.delete(oldest);old.delete?.();}
 return effect;
}
function buildRuntimeShader(CK,shader,overrides){
 const effect=runtimeEffectFor(CK,shader.source);
 const floats=new Float32Array(effect.getUniformFloatCount()),values=new Map(shader.uniforms.map(u=>[u.name,u.values]));
 for(const[name,v]of overrides??[])values.set(name,v);
 for(let i=0;i<effect.getUniformCount();i++){const u=effect.getUniform(i),name=effect.getUniformName(i),v=values.get(name);if(!v)continue;if(v.length>u.rows*u.columns)fail(`AGSL uniform ${name} has more values than its type`);floats.set(v,u.slot);}
 const childNames=[...shader.source.matchAll(/uniform\s+shader\s+(\w+)\s*;/g)].map(m=>m[1]),children=childNames.map(name=>{const input=shader.inputs.find(([n])=>n===name)?.[1];return input?buildShader(CK,input):CK.Shader.MakeColor(CK.Color4f(0,0,0,0));/* an unset child samples transparent black, as in hwui */});
 try{return effect.makeShaderWithChildren(floats,children,shader.matrix?shader.matrix.slice():undefined);}finally{for(const c of children)c.delete();}
}
function buildShader(CK,shader,overrides){
 if(shader.kind==='bitmap')return buildBitmapShader(CK,shader);
 if(shader.kind==='runtime')return buildRuntimeShader(CK,shader,overrides);
 if(shader.kind==='linear'||shader.kind==='radial'||shader.kind==='sweep'||shader.kind==='compose')return buildGradientShader(CK,shader,overrides);
 return fail('Unsupported Paint shader description');
}
/** Android gradients: sRGB stops, premultiplied interpolation (Gradient.cpp's kInterpolateColorsInPremul_Flag), Android TileMode ordinals CLAMP/REPEAT/MIRROR. */
function buildGradientShader(CK,shader,overrides){
 const matrix=shader.matrix?shader.matrix.slice():undefined,modes=[CK.TileMode.Clamp,CK.TileMode.Repeat,CK.TileMode.Mirror];
 if(shader.kind==='compose'){const dst=buildShader(CK,shader.dst,overrides),src=buildShader(CK,shader.src,overrides);try{return CK.Shader.MakeBlend({value:shader.blend},dst,src);}finally{dst.delete();src.delete();}}
 const colors=shader.colors.map(c=>CK.Color4f(((c>>>16)&255)/255,((c>>>8)&255)/255,(c&255)/255,(c>>>24)/255)),pos=shader.positions?Float32Array.from(shader.positions):null,flags=1;
 if(shader.kind==='linear')return CK.Shader.MakeLinearGradient(shader.p0,shader.p1,colors,pos,modes[shader.tile],matrix,flags);
 if(shader.kind==='radial')return shader.focal?CK.Shader.MakeTwoPointConformalGradient(shader.focal,0,shader.center,shader.radius,colors,pos,modes[shader.tile],matrix,flags):CK.Shader.MakeRadialGradient(shader.center,shader.radius,colors,pos,modes[shader.tile],matrix,flags);
 return CK.Shader.MakeSweepGradient(shader.center[0],shader.center[1],colors,pos,CK.TileMode.Clamp,matrix,flags,0,360);
}
/** Android BitmapShader over a snapshot raster. ALPHA_8 bitmaps are coverage only: Skia exposes them as (0,0,0,a), later tinted by the Paint's color filter. */
function attachShader(CK,paint,shader,overrides){const built=buildShader(CK,shader,overrides);paint.setShader(built);built.delete();}
function makePaint(CK,state){const paint=new CK.Paint();paint.setAntiAlias(!!(state.flags&1));paint.setColor(argb(CK,state.argb));paint.setBlendMode({value:state.blendMode??3});paint.setStyle([CK.PaintStyle.Fill,CK.PaintStyle.Stroke,CK.PaintStyle.StrokeAndFill][state.style]);paint.setStrokeWidth(state.strokeWidth);paint.setStrokeMiter(state.strokeMiter);paint.setStrokeCap([CK.StrokeCap.Butt,CK.StrokeCap.Round,CK.StrokeCap.Square][state.strokeCap]);paint.setStrokeJoin([CK.StrokeJoin.Miter,CK.StrokeJoin.Round,CK.StrokeJoin.Bevel][state.strokeJoin]);if(state.colorFilterSnapshot){const filter=makeSkiaColorFilter(CK,state.colorFilterSnapshot);paint.setColorFilter(filter);filter?.delete();}if(state.pathEffect){const effect=state.pathEffect.dash?CK.PathEffect.MakeDash(state.pathEffect.dash.intervals,state.pathEffect.dash.phase):CK.PathEffect.MakeCorner(state.pathEffect.corner);if(effect){paint.setPathEffect(effect);effect.delete();}}if(state.shader)attachShader(CK,paint,state.shader);return paint;}
function makeFont(backend,state,text){
 const CK=backend.CanvasKit;if(typeof text!=='string'||text.length>65536)fail('Skia text run exceeds65536characters');
 const size=state.textSize??12,scale=state.textScaleX??1,skew=state.textSkewX??0;if(![size,scale,skew].every(Number.isFinite)||size<0||size>512||Math.abs(scale)>16||Math.abs(skew)>16)fail('Skia font extent exceeds VM limits');
 if(state.hyphenEdit)fail('Text drawing with Android hyphen edits requires the Minikin boundary');
 // A simple glyph run is exact for scripts without contextual shaping (Latin, punctuation, symbols) that Roboto covers;
 // complex scripts, combining marks, emoji/joiner sequences, letter/word spacing and code points Roboto lacks are shaped
 // run by run through the Android font fallback chain (SkParagraph/HarfBuzz) instead: makeFont then returns {shaped:true}.
 const shaped=state.letterSpacing||state.wordSpacing||state.fontVariations?.length||/[\p{Mark}\u200c\u200d\ufe0e\ufe0f\p{Extended_Pictographic}]|[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}\p{Script=Hangul}]/u.test(text);
 if(state.flags&0x800)fail('The CanvasKit font API does not expose force-auto-hinting');
 const font=new CK.Font(state.nativeTypeface??backend.typeface,state.textSize??12);font.setScaleX(state.textScaleX??1);font.setSkewX((state.textSkewX??0)+(state.fakeItalic?-0.25:0));font.setEmbolden(!!(state.flags&0x20)||!!state.fakeBold);font.setLinearMetrics(!!(state.flags&0x40));font.setSubpixel(!!(state.flags&0x80));font.setEmbeddedBitmaps(!!(state.flags&0x400));
 // Embind's public enum ABI is {value:number};0.42 omits the Alias symbol (SkFont::Edging::kAlias=0).
 font.setEdging(state.flags&1?CK.FontEdging.AntiAlias:(CK.FontEdging.Alias??{value:0}));
 font.setHinting(state.hinting===0?CK.FontHinting.None:CK.FontHinting.Normal);
 if(shaped){font.delete();return {shaped:true};}
 const glyphs=font.getGlyphIDs(text);if(glyphs.some(id=>id===0)){font.delete();return {shaped:true};}return {font,glyphs};
}
const RTL_SCRIPT=/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Adlam}\p{Script=Samaritan}\p{Script=Mandaic}]/u;
/** Paint.BIDI_DEFAULT_LTR: the paragraph direction of Canvas.drawText(String) is that of the first strong character. */
const firstStrongRtl=text=>{for(const char of text)if(/\p{L}/u.test(char))return RTL_SCRIPT.test(char);return false;};
const mergeMetrics=(base,extra)=>{const m={...base};for(const e of extra){m.ascent=Math.min(m.ascent,e.ascent);m.descent=Math.max(m.descent,e.descent);m.leading=Math.max(m.leading??0,e.leading??0);if(m.bounds&&e.bounds){m.bounds=[Math.min(m.bounds[0],e.bounds[0]),Math.min(m.bounds[1],e.bounds[1]),Math.max(m.bounds[2],e.bounds[2]),Math.max(m.bounds[3],e.bounds[3])];}}return m;};
export function measureSkiaText(backend,text,state={}){const made=makeFont(backend,state,text);
 if(made.shaped){const CK=backend.CanvasKit,face=new CK.Font(state.nativeTypeface??backend.typeface,state.textSize??12);try{face.setScaleX(state.textScaleX??1);face.setSkewX((state.textSkewX??0)+(state.fakeItalic?-0.25:0));face.setEmbolden(!!(state.flags&0x20)||!!state.fakeBold);face.setLinearMetrics(!!(state.flags&0x40));face.setSubpixel(!!(state.flags&0x80));
   const run=measureSkiaShapedText(backend,text,{...state,weight:state.weight??400,italic:!!state.italic});
   return {width:run.width,metrics:mergeMetrics(face.getMetrics(),run.fontMetrics),glyphCount:run.glyphCount,source:'official-Skia-SkParagraph/Roboto+Android-fallback-chain'};}finally{face.delete();}}
 const {font,glyphs}=made;try{return {width:font.getGlyphWidths(glyphs).reduce((a,b)=>a+b,0),metrics:font.getMetrics(),glyphCount:glyphs.length,source:'official-Skia-Font/Roboto/simple-glyph-run'};}finally{font.delete();}}
function applyClips(CK,canvas,clips){for(const clip of clips??[]){let path,builder;
 if(clip.commands)path=CK.Path.MakeFromCmds(clip.commands);else{builder=new CK.PathBuilder();builder.addRect(clip.rect);path=builder.snapshot();builder.delete();}
 if(clip.fillType!==undefined)path.setFillType({value:clip.fillType});
 const transformed=new CK.PathBuilder(path);transformed.transform(matrix(clip.matrix));const shape=transformed.snapshot();canvas.clipPath(shape,clip.difference?CK.ClipOp.Difference:CK.ClipOp.Intersect,!!clip.antiAlias);shape.delete();transformed.delete();path.delete();
}}
// VectorDrawable trim paths (VectorDrawable.cpp FullPath::getUpdatedPath / VFullPath.applyTrim): the first contour of the path, from (trimPathStart + trimPathOffset) to (trimPathEnd + trimPathOffset)
// as fractions of its length modulo 1, wrapping through the contour end when start > end, taken with SkPathMeasure::getSegment (CanvasKit ContourMeasure).
function trimVectorPath(CK,path,props){
 const start=(props.trimPathStart+props.trimPathOffset)%1,end=(props.trimPathEnd+props.trimPathOffset)%1,iter=new CK.ContourMeasureIter(path,false,1),contour=iter.next();
 try{
  const builder=new CK.PathBuilder();
  if(contour){const length=contour.length(),add=(from,to)=>{const segment=contour.getSegment(from,to,true);if(segment){builder.addPath(segment);segment.delete();}};
   if(start>end){add(start*length,length);add(0,end*length);}else add(start*length,end*length);}
  const trimmed=builder.snapshot();builder.delete();return trimmed;
 }finally{contour?.delete();iter.delete();path.delete();}
}
function sourceVector(CK,canvas,graphics,handle,colorFilter=null){const tree=typeof handle==='object'?handle:graphics.get(handle,'tree'),seen=new Set(),get=pointer=>typeof pointer==='object'?pointer:graphics.get(pointer);
 const walk=(pointer,depth=0)=>{if(depth>128||seen.has(pointer))fail('Cyclic/excessive Skia vector tree');seen.add(pointer);const node=get(pointer);
  if(node.kind==='group'){const p=node.props;canvas.save();canvas.translate(p.translateX+p.pivotX,p.translateY+p.pivotY);canvas.rotate(p.rotation,0,0);canvas.scale(p.scaleX,p.scaleY);canvas.translate(-p.pivotX,-p.pivotY);
   for(const child of node.children){if(get(child).kind==='clip'){const path=CK.Path.MakeFromSVGString(get(child).path);if(!path)fail('Skia rejected a vector clip path');canvas.clipPath(path,CK.ClipOp.Intersect,tree.antiAlias);path.delete();}else walk(child,depth+1);}canvas.restore();
  }else if(node.kind==='full'){const p=node.props;let path=CK.Path.MakeFromSVGString(node.path);if(!path)fail('Skia rejected vector pathData');if(p.trimPathStart!==0||p.trimPathEnd!==1)path=trimVectorPath(CK,path,p);path.setFillType(p.fillType?CK.FillType.EvenOdd:CK.FillType.Winding);
   for(const [stroke,color,alpha]of [[false,p.fillColor,p.fillAlpha],[true,p.strokeColor,p.strokeAlpha]]){if(!(color>>>24)||stroke&&p.strokeWidth<=0)continue;const paint=new CK.Paint();paint.setAntiAlias(tree.antiAlias);paint.setColor(argb(CK,color,alpha));paint.setStyle(stroke?CK.PaintStyle.Stroke:CK.PaintStyle.Fill);if(stroke){paint.setStrokeWidth(p.strokeWidth);paint.setStrokeMiter(p.strokeMiterLimit);paint.setStrokeCap([CK.StrokeCap.Butt,CK.StrokeCap.Round,CK.StrokeCap.Square][p.strokeLineCap]);paint.setStrokeJoin([CK.StrokeJoin.Miter,CK.StrokeJoin.Round,CK.StrokeJoin.Bevel][p.strokeLineJoin]);}canvas.drawPath(path,paint);paint.delete();}path.delete();
  }else fail('Unsupported Skia vector node '+node.kind);seen.delete(pointer);
 };const alpha=new CK.Paint();alpha.setAlphaf(tree.alpha);if(colorFilter){const filter=makeSkiaColorFilter(CK,colorFilter);alpha.setColorFilter(filter);filter?.delete();}canvas.saveLayer(alpha);walk(tree.root);canvas.restore();alpha.delete();
}
/**
 * Identical recorded content rasterizes to identical pixels: Skia is deterministic and every input of a replay is part of the recorded commands, the RenderNode
 * snapshots they reference, the CanvasProperty values they read (read at replay) and the window light. The key is that complete input; a replay that depends on
 * state the key cannot see (vector trees reached through pointers, Maps, host objects) is not cached. Result objects are returned as copies.
 */
const NO_KEY=Symbol('uncacheable'),OBJECT_IDS=new WeakMap();let nextObjectId=1;   // host objects in a key (CanvasKit typefaces, immutable) are named by a process-wide identity
// A recorded command is immutable once it is in a display list (Canvas calls push fresh objects; RenderNode.finish stores copies), so the text of a command that reads
// nothing live (no RenderNode reference, no CanvasProperty) is computed once and named by a small integer: an unchanged RenderNode display list costs one WeakMap
// lookup per command per frame instead of a JSON.stringify of every path, paint and (large) bitmap raster. Commands that read live state (renderNode, *Props, ripple) are
// re-serialized at every call. The integer table is bounded; after a reset the same text just gets a new id (a miss, never a wrong hit).
const COMMAND_IDS=new WeakMap(),COMMAND_TEXTS=new Map();let nextCommandId=1,commandTextChars=0;
function commandId(text){let id=COMMAND_TEXTS.get(text);if(id===undefined){if(commandTextChars>16*1024*1024){COMMAND_TEXTS.clear();commandTextChars=0;}id=nextCommandId++;COMMAND_TEXTS.set(text,id);commandTextChars+=text.length;}return id;}
/** The part of a raster key that names the output format: extent and options (transport, scale). The same recording at two scales has two keys with one body. */
const rasterKeyPrefix=(width,height,options)=>JSON.stringify([width,height,options??null]);
function rasterKeyBody(runtime,graphics,state,width){
 let depth=0,nodes=false,dynamic=false;
 const resolve=value=>Object.fromEntries(Object.entries(value).map(([name,handle])=>[name,graphics.get(handle)]));
 const replacer=function(name,value){
  if(typeof value==='bigint')return 'n'+value;
  if(value===null||typeof value!=='object')return value;
  if(ArrayBuffer.isView(value))return {t:value.constructor.name,d:Array.from(value)};
  if(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype){
   if(value instanceof Map||value instanceof Set)throw NO_KEY;
   if(!OBJECT_IDS.has(value))OBJECT_IDS.set(value,nextObjectId++);return {id:OBJECT_IDS.get(value)};   // CanvasKit objects (immutable typefaces): identity
  }
  if(value.vectorTree!==undefined)throw NO_KEY;
  if(value.op==='renderNode'&&value.node!==undefined){
   if(++depth>128)throw NO_KEY;nodes=true;dynamic=true;
   try{const snapshot=getRenderNodeSnapshot(runtime,value.node),{displayList,...rest}=snapshot;return {...value,node:JSON.stringify(rest,replacer)+'|'+(Array.isArray(displayList)?displayList.map(commandKey).join(','):String(displayList))};}finally{depth--;}
  }
  if((value.op==='circleProps'||value.op==='roundRectProps'||value.op==='ripple')&&value.props){dynamic=true;return {...value,props:resolve(value.props)};}
  return value;
 };
 const commandKey=command=>{
  if(command===null||typeof command!=='object')return JSON.stringify(command,replacer);
  const known=COMMAND_IDS.get(command);if(known!==undefined)return '#'+known;
  const outer=dynamic;dynamic=false;
  try{const text=JSON.stringify(command,replacer);if(dynamic)return text;const id=commandId(text);COMMAND_IDS.set(command,id);return '#'+id;}finally{dynamic=outer||dynamic;}
 };
 try{
  const key=state.draws.map(commandKey).join(',');
  if(key.length>4*1024*1024)return null;
  // Shadows are lit by the window theme's light: part of the input whenever a RenderNode is replayed.
  if(!nodes)return key;
  try{return key+JSON.stringify(renderLightInfo(runtime,width));}catch{return null;}
 }catch(error){if(error===NO_KEY)return null;throw error;}
}
const RASTER_CACHE_BYTES=32*1024*1024;
const samePixels=(a,b)=>{if(!a||!b||a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;};
/** Cached rasters are bounded by their size (keys plus PNG data URLs, 32 MiB, least recently used first) and dropped with the Skia host. `runtime.rasterCacheDisabled = true` switches the cache off. */
function cacheRaster(runtime,key,result){
 const cache=runtime.rasterCache??=new Map(),size=key.length+(result.dataURL?.length??0)+(result.pixels?.byteLength??0);if(size>RASTER_CACHE_BYTES/4)return;
 cache.set(key,{result:{...result},size});runtime.rasterCacheBytes=(runtime.rasterCacheBytes??0)+size;
 for(const [oldKey,entry] of cache){if(runtime.rasterCacheBytes<=RASTER_CACHE_BYTES&&cache.size<=64)break;cache.delete(oldKey);runtime.rasterCacheBytes-=entry.size;}
}
/** A recorded 'raster' command's image: an encoded PNG (data URL) or exact pixel data (command.pixelData: base64 of rows in colorType/alphaType, written by Bitmap pixel setters). */
function decodeRasterImage(CK,raster){
 if(raster?.kind!=='raster'||!raster.dataURL?.startsWith('data:image/png;base64,')||raster.dataURL.length>12*1024*1024)fail('Canvas raster requires a bounded actual PNG');
 const image=CK.MakeImageFromEncoded(Uint8Array.from(atob(raster.dataURL.slice(22)),c=>c.charCodeAt(0)));if(!image)fail('Skia rejected a recorded widget raster');return image;
}
/** Canvas.drawBitmapMesh: the bitmap sampled (bilinear, clamped) over a (meshWidth+1)x(meshHeight+1) lattice of two-triangle cells; per-vertex colors modulate it (SkBlendMode::kModulate). */
function drawBitmapMesh(CK,canvas,image,mesh,paint){
 const cw=mesh.width,ch=mesh.height,count=(cw+1)*(ch+1),tex=new Float32Array(count*2),indices=[];
 for(let y=0;y<=ch;y++)for(let x=0;x<=cw;x++){const at=(y*(cw+1)+x)*2;tex[at]=x*mesh.bitmapWidth/cw;tex[at+1]=y*mesh.bitmapHeight/ch;}
 for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){const a=y*(cw+1)+x,b=a+1,c=a+cw+1,d=c+1;indices.push(a,b,c,b,d,c);}
 const colors=mesh.colors?Float32Array.from(mesh.colors.flatMap(c=>[((c>>>16)&255)/255,((c>>>8)&255)/255,(c&255)/255,(c>>>24)/255])):null;
 const vertices=CK.MakeVertices(CK.VertexMode.Triangles,Float32Array.from(mesh.positions),tex,colors,indices);
 const shader=image.makeShaderOptions(CK.TileMode.Clamp,CK.TileMode.Clamp,CK.FilterMode.Linear,CK.MipmapMode.None),meshPaint=paint?paint.copy():new CK.Paint();
 try{meshPaint.setShader(shader);canvas.drawVertices(vertices,CK.BlendMode.Modulate,meshPaint);}finally{meshPaint.delete();shader.delete();vertices.delete();}
}
const PIXEL_BYTES={RGBA_8888:4,RGB_565:2,RGBA_F16:8,RGBA_1010102:4};
function makePixelDataImage(CK,data){
 const bpp=PIXEL_BYTES[data.colorType];if(!bpp||CK.ColorType[data.colorType]===undefined||CK.AlphaType[data.alphaType]===undefined)fail('Unsupported Bitmap pixel data format '+data.colorType+'/'+data.alphaType);
 const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));if(bytes.length!==data.width*data.height*bpp)fail('Bitmap pixel data length does not match its extent');
 const image=CK.MakeImage({width:data.width,height:data.height,colorType:CK.ColorType[data.colorType],alphaType:CK.AlphaType[data.alphaType],colorSpace:CK.ColorSpace.SRGB},bytes,data.width*bpp);if(!image)fail('Skia rejected Bitmap pixel data');return image;
}
/** Skia color types a Bitmap config rasterizes on (RGB_565 opaque 2 B, RGBA_F16 8 B, RGBA_1010102 4 B); other configs use the N32 surface. */
function bitmapSurfaceSpec(CK,type){
 const spec={RGB_565:[CK.ColorType.RGB_565,2,CK.AlphaType.Opaque],RGBA_F16:[CK.ColorType.RGBA_F16,8,CK.AlphaType.Premul],RGBA_1010102:[CK.ColorType.RGBA_1010102,4,CK.AlphaType.Premul]}[type];
 if(!spec)fail('No Skia surface color type for Bitmap config '+type);if(spec[0]===undefined)fail('This CanvasKit build has no color type for Bitmap.Config.'+type);
 return {colorType:spec[0],bytes:spec[1],alphaType:spec[2]};
}
export function rasterizeSkiaCanvas(runtime,backend,graphics,receiver,width,height,options={}){
 const stats=runtime.rasterStats??={calls:0,rasterized:0,hits:0,keyMs:0,replayMs:0,encodeMs:0};stats.calls++;
 const state=graphics.get(runtime.object(receiver).nativeCanvasHandle,'canvas');
 const t0=performance.now();
 const body=options?.pixels||runtime.rasterCacheDisabled?null:rasterKeyBody(runtime,graphics,state,width);stats.keyMs+=performance.now()-t0;
 const cache=runtime.rasterCache??=new Map(),hit=key=>{const entry=cache.get(key);cache.delete(key);cache.set(key,entry);stats.hits++;return entry;};
 // A reduced-scale request (progressive raster, src/motion-raster.js) is served the full-density raster of the same recording when that is already cached: never worse, and no replay.
 // The scale is part of the key, so a full-density request is never served a reduced raster.
 if(body!==null&&(options?.scale??1)<1){const {scale,...rest}=options,full=Object.keys(rest).length?rest:undefined,fullKey=rasterKeyPrefix(width,height,full)+body;if(cache.has(fullKey)){stats.fullForReduced=(stats.fullForReduced??0)+1;return {...hit(fullKey).result};}}
 const key=body===null?null:rasterKeyPrefix(width,height,options)+body;
 if(key!==null&&cache.has(key)){
  const entry=hit(key);
  // runtime.rasterCacheVerify: shadow-check every hit against a fresh raster (A/B evidence that the key covers everything the pixels depend on).
  if(runtime.rasterCacheVerify){stats.verified=(stats.verified??0)+1;const fresh=rasterizeSkiaCanvasUncached(runtime,backend,graphics,receiver,width,height,options);if(fresh?.dataURL!==entry.result.dataURL||fresh?.pixels&&!samePixels(fresh.pixels,entry.result.pixels))fail(`Raster cache hit differs from a fresh raster (${width}x${height}, ${state.draws.length} commands)`);}
  return {...entry.result};
 }
 stats.rasterized++;
 const result=rasterizeSkiaCanvasUncached(runtime,backend,graphics,receiver,width,height,options);
 if(result?.kind==='rgba-raster')result.rasterId='p'+(runtime.rasterUid=(runtime.rasterUid??0)+1);   // identity of one rasterization: a cache hit returns the same id, so the page already holding it needs no pixels
 else if(result?.scale<1)result.rasterSerial='r'+(runtime.rasterUid=(runtime.rasterUid??0)+1);   // a reduced PNG's identity for the progressive raster's settle rule (src/deferred-raster.js); the page names PNGs by their hash
 if(key!==null&&(result?.kind==='raster'||result?.kind==='rgba-raster'))cacheRaster(runtime,key,result);
 return result;
}
function rasterizeSkiaCanvasUncached(runtime,backend,graphics,receiver,width,height,options={}){
 if(!(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=4096&&height<=4096&&width*height<=4*1024*1024))fail('Skia raster extent exceeds4096px/4Mpixel VM limit');
 // options.scale (0 < scale < 1): the same recording replayed on a surface of round(width*scale) x round(height*scale) pixels (progressive raster while the screen is moving, src/compose-canvas-host.js
 // setContentRaster); the page stretches the smaller bitmap over the View's box. Pixel read-backs (Bitmap.getPixel) and typed surfaces are never scaled: they are the bitmap's own memory.
 const scale=options?.scale??1;if(!(Number.isFinite(scale)&&scale>0&&scale<=1))fail('Skia raster scale must be in (0, 1]');if(scale!==1&&(options?.pixels||options?.surfaceType))fail('Skia raster scale applies to display rasters only');
 const pw=scale===1?width:Math.max(1,Math.round(width*scale)),ph=scale===1?height:Math.max(1,Math.round(height*scale));
 const CK=backend.CanvasKit,state=graphics.get(runtime.object(receiver).nativeCanvasHandle,'canvas'),typed=options?.surfaceType?bitmapSurfaceSpec(CK,options.surfaceType):null,memory=typed?CK.Malloc(Uint8Array,width*height*typed.bytes):null,surface=typed?CK.MakeRasterDirectSurface({width,height,colorType:typed.colorType,alphaType:typed.alphaType,colorSpace:CK.ColorSpace.SRGB},memory,width*typed.bytes):CK.MakeSurface(pw,ph);if(!surface){if(memory)CK.Free(memory);fail('Skia CPU surface allocation failed');}const canvas=surface.getCanvas();canvas.clear(CK.TRANSPARENT);if(scale!==1)canvas.scale(pw/width,ph/height);
 const activeNodes=new Set();let replayCount=0;   // a reduced replay (scale < 1) also scales the shadow light geometry, which Skia takes in device pixels (drawNodeShadow)
 const drawNodeShadow=node=>{
   const z=renderNodeShadowCaster(node);if(!z)return;const outline=node.outline,casterAlpha=node.alpha*outline.alpha;let path;
   if(outline.commands){path=CK.Path.MakeFromCmds(outline.commands);path.setFillType({value:outline.fillType});}else{const builder=new CK.PathBuilder();builder.addRRect(CK.RRectXY(outline.rect,outline.radius,outline.radius));path=builder.snapshot();builder.delete();}
   const light=renderLightInfo(runtime,width),color=(value,alpha)=>{const c=value>>>0;return CK.Color4f(((c>>>16)&255)/255,((c>>>8)&255)/255,(c&255)/255,Math.max(0,Math.min(1,(c>>>24)/255*alpha)));};
   canvas.save();canvas.translate(node.left,node.top);if(node.staticMatrix)canvas.concat(node.staticMatrix);if(node.animationMatrix)canvas.concat(node.animationMatrix);canvas.concat(node.matrix);
   try{canvas.drawShadow(path,[0,0,z*scale],[light.x*scale,light.y*scale,light.z*scale],light.radius*scale,color(node.ambientShadowColor,light.ambientShadowAlpha*casterAlpha),color(node.spotShadowColor,light.spotShadowAlpha*casterAlpha),casterAlpha<1?1:0);}finally{canvas.restore();path.delete();}
 };
 const run=(command,shadow=false)=>{
   if(command.op==='layerBegin'){
    const paint=command.paint?(command.paint.isLayerAlpha?(()=>{const p=new CK.Paint();p.setAlphaf(command.paint.alpha);return p;})():makePaint(CK,command.paint)):null;
    if(command.bounds)canvas.saveLayer(paint,CK.LTRBRect(...command.bounds));else canvas.saveLayer(paint);paint?.delete();return;
   }
   if(command.op==='layerEnd'){canvas.restore();return;}
   canvas.save();applyClips(CK,canvas,command.clips);canvas.concat(matrix(command.matrix));
   if(command.op==='picture'){replay(command.draws);}
   else if(command.op==='renderNode'){
    if(activeNodes.has(command.node)||activeNodes.size>=128)fail('Cyclic/excessive RenderNode display-list graph');
    const node=getRenderNodeSnapshot(runtime,command.node);if(node.displayList&&node.alpha>0){
     if(shadow)drawNodeShadow(node);activeNodes.add(command.node);canvas.translate(node.left,node.top);if(node.staticMatrix)canvas.concat(node.staticMatrix);if(node.animationMatrix)canvas.concat(node.animationMatrix);canvas.concat(node.matrix);
     if(node.clipToBounds)canvas.clipRect(CK.LTRBRect(0,0,node.right-node.left,node.bottom-node.top),CK.ClipOp.Intersect,false);
     if(node.clipBounds)canvas.clipRect(CK.LTRBRect(...node.clipBounds),CK.ClipOp.Intersect,false);
     if(node.clipToOutline&&node.outline){if(node.outline.commands){const path=CK.Path.MakeFromCmds(node.outline.commands);path.setFillType({value:node.outline.fillType});canvas.clipPath(path,CK.ClipOp.Intersect,true);path.delete();}else if(node.outline.empty)canvas.clipRect(CK.LTRBRect(0,0,0,0),CK.ClipOp.Intersect,false);else canvas.clipRRect(CK.RRectXY(node.outline.rect,node.outline.radius,node.outline.radius),CK.ClipOp.Intersect,true);}
     const isolate=!!node.layerPaint||node.layerType!==0||node.alpha<1;   // hwui only renders a node into an offscreen layer when it has alpha / a layer paint / a layer type
     if(isolate){const layer=node.layerPaint?makePaint(CK,node.layerPaint):new CK.Paint();layer.setAlphaf((node.layerPaint?.alpha??1)*Math.max(0,Math.min(1,node.alpha)));canvas.saveLayer(layer);layer.delete();}
     const stretch=renderNodeStretchMatrix(node);if(stretch)canvas.concat(stretch);   // hwui StretchEffect (approximation documented at renderNodeStretchMatrix); after the clips so the bounds stay fixed
     replay(node.displayList);if(isolate)canvas.restore();activeNodes.delete(command.node);
    }
   }else if(command.vectorTree){const tree=command.vectorState??graphics.get(command.vectorTree,'tree');canvas.translate(command.x,command.y);canvas.scale(command.width/tree.viewportWidth,command.height/tree.viewportHeight);if(command.mirrored){canvas.translate(tree.viewportWidth,0);canvas.scale(-1,1);}canvas.clipRect(CK.LTRBRect(0,0,tree.viewportWidth,tree.viewportHeight),CK.ClipOp.Intersect,true);sourceVector(CK,canvas,graphics,tree,command.colorFilter);
   }else if(command.argb!==undefined&&command.kind!=='skia'){const paint=makePaint(CK,command.paint??{argb:command.argb,flags:1,style:0,strokeWidth:0,strokeMiter:4,strokeCap:0,strokeJoin:0});canvas.drawRect(CK.XYWHRect(command.x,command.y,command.width,command.height),paint);paint.delete();
   }else if(command.kind==='skia'){const paint=command.paint?makePaint(CK,command.paint):null;
    if(command.op==='path'){const path=CK.Path.MakeFromCmds(command.commands);path.setFillType([CK.FillType.Winding,CK.FillType.EvenOdd,CK.FillType.InverseWinding,CK.FillType.InverseEvenOdd][command.fillType]);canvas.drawPath(path,paint);path.delete();}
    else if(command.op==='line')canvas.drawLine(...command.args,paint);
    else if(command.op==='point')canvas.drawPoints(CK.PointMode.Points,command.args,paint);
    else if(command.op==='arc')canvas.drawArc(command.args.slice(0,4),command.args[4],command.args[5],command.useCenter,paint);
    else if(command.op==='circle')canvas.drawCircle(...command.args,paint);
    else if(command.op==='oval')canvas.drawOval(command.args,paint);
    else if(command.op==='roundRect')canvas.drawRRect(CK.RRectXY(command.args.slice(0,4),command.args[4],command.args[5]),paint);
    else if(command.op==='doubleRoundRect'){const rr=v=>command.pair?CK.RRectXY(v.slice(0,4),v[4],v[5]):new Float32Array(v);canvas.drawDRRect(rr(command.outer),rr(command.inner),paint);}
    else if(command.op==='rect')canvas.drawRect(command.args,paint);
    else if(command.op==='circleProps'||command.op==='roundRectProps'||command.op==='ripple'){
     // RecordingCanvas draws whose geometry/paint are CanvasProperty tokens: the values are read NOW, so RenderThread animators (RenderNodeAnimator) move them between frames.
     const value=h=>graphics.get(h),number=h=>{const v=value(h);if(v.kind!=='float')fail('CanvasProperty<Float> expected');return v.value;},paintOf=h=>{const v=value(h);if(v.kind!=='paint')fail('CanvasProperty<Paint> expected');return v.paint;};
     const props=command.props;let drawPaint;
     if(command.op==='ripple'){
      const shader=command.shader,progress=number(props.progress),noise=number(props.noise),f=Math.fround,PI=Math.PI,scale=1.5;
      const circle=(a,b,k,c,sn)=>[f(scale*a+noise*k*Math.cos(scale*c)),f(scale*a+noise*k*Math.sin(scale*sn))];
      // hwui AnimatedRipple::draw: the shader's progress / noise-phase uniforms come from the animated CanvasProperties (same formulas as RippleShader.setNoisePhase).
      const overrides=[['in_progress',[f(progress)]],['in_noisePhase',[f(noise*0.001)]],['in_turbulencePhase',[f(noise)]],
       ['in_tCircle1',[f(scale*0.5+noise*0.01*Math.cos(scale*0.55)),f(scale*0.5+noise*0.01*Math.sin(scale*0.55))]],
       ['in_tCircle2',[f(scale*0.2+noise*-0.0066*Math.cos(scale*0.45)),f(scale*0.2+noise*-0.0066*Math.sin(scale*0.45))]],
       ['in_tCircle3',[f(scale+noise*-0.0066*Math.cos(scale*0.35)),f(scale+noise*-0.0066*Math.sin(scale*0.35))]]];
      const rot=(angle)=>[f(Math.cos(angle)),f(Math.sin(angle))];
      overrides.push(['in_tRotation1',rot(noise*PI*0.0078125+1.7*PI)],['in_tRotation2',rot(noise*PI*-0.0078125+2*PI)],['in_tRotation3',rot(noise*PI*0.0078125+2.75*PI)]);
      drawPaint=makePaint(CK,{...paintOf(props.paint),shader:null});attachShader(CK,drawPaint,shader,overrides);
      if(!Number.isFinite(progress))fail('Non-finite ripple progress');
     }else drawPaint=makePaint(CK,paintOf(props.paint));
     try{
      if(command.op==='roundRectProps')canvas.drawRRect(CK.RRectXY([number(props.left),number(props.top),number(props.right),number(props.bottom)],number(props.rx),number(props.ry)),drawPaint);
      else canvas.drawCircle(number(props.cx),number(props.cy),number(props.radius),drawPaint);
     }finally{drawPaint.delete();}
    }
    else if(command.op==='color')canvas.drawColor(argb(CK,command.color),{value:command.blendMode??3});
    else if(command.op==='paint')canvas.drawPaint(paint);
    else if(command.op==='raster'){const image=command.pixelData?makePixelDataImage(CK,command.pixelData):decodeRasterImage(CK,command.raster);try{if(image.width()>4096||image.height()>4096||image.width()*image.height()>4*1024*1024)fail('Recorded widget raster exceeds Skia bounds');const drawImage=p=>{if(command.mesh){drawBitmapMesh(CK,canvas,image,command.mesh,p);return;}if(command.imageMatrix)canvas.concat(command.imageMatrix);if(command.src&&command.dst){if(command.filter)canvas.drawImageRectOptions(image,CK.LTRBRect(...command.src),CK.LTRBRect(...command.dst),CK.FilterMode.Linear,CK.MipmapMode.None,p);else canvas.drawImageRect(image,CK.LTRBRect(...command.src),CK.LTRBRect(...command.dst),p);}else{if(command.imageScale&&command.imageScale!==1){canvas.translate(command.args[0],command.args[1]);canvas.scale(command.imageScale,command.imageScale);if(command.filter)canvas.drawImageOptions(image,0,0,CK.FilterMode.Linear,CK.MipmapMode.None,p);else canvas.drawImage(image,0,0,p);}else if(command.filter)canvas.drawImageOptions(image,command.args[0],command.args[1],CK.FilterMode.Linear,CK.MipmapMode.None,p);else canvas.drawImage(image,command.args[0],command.args[1],p);}};
     if(command.alpha8){
      // ALPHA_8 is coverage only: Skia tints it with the Paint color, then applies the Paint's alpha/filter/blend to the result.
      const c=(command.paint?.argb??0xff000000)>>>0,filter=CK.ColorFilter.MakeMatrix([0,0,0,0,((c>>>16)&255)/255,0,0,0,0,((c>>>8)&255)/255,0,0,0,0,(c&255)/255,0,0,0,1,0]),mask=new CK.Paint();
      mask.setColorFilter(filter);canvas.saveLayer(paint);try{drawImage(mask);}finally{canvas.restore();mask.delete();filter.delete();}
     }else drawImage(paint);}finally{image.delete();}}
    else if(command.op==='paragraphRun')drawSkiaTextRun(backend,canvas,command.text,command.args[0],command.args[1],command.paint,command.isRtl,paint,{start:command.runStart??0,end:command.runEnd??command.text.length});
    else if(command.op==='text'){
     const made=makeFont(backend,command.paint,command.text);
     if(made.shaped)drawSkiaTextRun(backend,canvas,command.text,command.args[0],command.args[1],{...command.paint,weight:command.paint.weight??400,italic:!!command.paint.italic},firstStrongRtl(command.text),paint);
     else{const {font,glyphs}=made;try{canvas.drawText(command.text,command.args[0],command.args[1],paint,font);
      if(command.paint.flags&0x18){const metrics=font.getMetrics(),width=font.getGlyphWidths(glyphs).reduce((a,b)=>a+b,0),decoration=paint.copy();decoration.setStyle(CK.PaintStyle.Fill);
       if(command.paint.flags&8)canvas.drawRect(CK.XYWHRect(command.args[0],command.args[1]+metrics.underlinePosition,width,metrics.underlineThickness),decoration);
       if(command.paint.flags&16)canvas.drawRect(CK.XYWHRect(command.args[0],command.args[1]+metrics.strikeoutPosition,width,metrics.strikeoutThickness),decoration);decoration.delete();}
     }finally{font.delete();}}
    }else fail('Unsupported recorded Skia command '+command.op);paint?.delete();
   }else fail('A legacy graphics command has no Skia representation');canvas.restore();
 };
 const replay=commands=>{let group=null;
  const flush=()=>{if(!group)return;const items=group.map((command,index)=>({command,index,z:(n=>n.elevation+n.translationZ)(getRenderNodeSnapshot(runtime,command.node))})).sort((x,y)=>x.z-y.z||x.index-y.index);group=null;for(const item of items)run(item.command,item.z>0);};
  for(const command of commands){if(++replayCount>65536)fail('RenderNode replay command limit exceeded');
   if(command.op==='reorderBegin'){flush();group=[];continue;}if(command.op==='reorderEnd'){flush();continue;}
   if(group&&command.op==='renderNode'){group.push(command);continue;}run(command);}
  flush();
 };
 const r0=performance.now();try{replay(state.draws);
  surface.flush();const image=surface.makeImageSnapshot();
  // options.pixels: the canvas as straight (unpremultiplied) sRGB RGBA8 bytes, for Bitmap.getPixel / compress.
  // options.surfaceType (RGB_565 / RGBA_F16 / RGBA_1010102): the canvas was rasterized on a Skia surface of that color type; options.halfFloats also returns the unpremultiplied RGBA_F16 words (little-endian bytes) for Bitmap.getColor.
  if(options?.pixels){try{const pixels=image.readPixels(0,0,{width,height,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB});if(!pixels)fail('Skia pixel read-back failed');let raw=null;if(options.raw){   // the bitmap's memory: a typed surface is directly backed by it, the N32 surface is read as premultiplied RGBA8
   if(memory)raw=Uint8Array.from(memory.toTypedArray());else{raw=image.readPixels(0,0,{width,height,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Premul,colorSpace:CK.ColorSpace.SRGB});if(!raw)fail('Skia native pixel read-back failed');raw=Uint8Array.from(raw);}}let halfFloats=null;if(options.halfFloats){halfFloats=image.readPixels(0,0,{width,height,colorType:CK.ColorType.RGBA_F16,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB});if(!halfFloats)fail('Skia RGBA_F16 read-back failed');halfFloats=Uint8Array.from(halfFloats);}return {kind:'pixels',width,height,pixels:Uint8Array.from(pixels),raw,halfFloats};}finally{image.delete();}}
  const stats=runtime.rasterStats;const e0=performance.now();if(stats){stats.replayMs+=e0-r0;if(scale!==1){stats.reduced=(stats.reduced??0)+1;stats.reducedMs=(stats.reducedMs??0)+(e0-r0);}}
  const reduced=scale===1?{}:{scale};   // a full-density raster is byte-identical to one made without the option
  // options.transport 'rgba': straight (unpremultiplied) sRGB RGBA8 bytes for the page to put on a canvas (no PNG encode, no base64, no decode); the page keeps a PNG path for every other raster.
  if(options?.transport==='rgba'){try{const pixels=image.readPixels(0,0,{width:pw,height:ph,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB});if(!pixels)fail('Skia pixel read-back failed');if(stats)stats.encodeMs+=performance.now()-e0;return {kind:'rgba-raster',width:pw,height:ph,...reduced,pixels,drawCalls:state.draws.length,source:'official-Skia-Wasm/CPU'};}finally{image.delete();}}
 try{const png=image.encodeToBytes(CK.ImageFormat.PNG);if(stats)stats.encodeMs+=performance.now()-e0;if(!png)fail('Skia PNG encoding failed');let binary='';for(let at=0;at<png.length;at+=32768)binary+=String.fromCharCode(...png.subarray(at,at+32768));return {kind:'raster',dataURL:'data:image/png;base64,'+btoa(binary),width:pw,height:ph,...reduced,drawCalls:state.draws.length,source:'official-Skia-Wasm/CPU',pngBytes:png.length};}finally{image.delete();}
 }finally{surface.dispose();if(memory)CK.Free(memory);}
}
export function createSkiaCanvasHost(runtime,backend){
 const matrixHost=createMatrixAllocationHost();
 const CK=backend.CanvasKit,paths=new Map(),pathHandles=new Map(),keys=new Set();let nextPathHandle=0x620000000n;let pathCells=0,clipCells=0;const add=(owner,signatures)=>signatures.forEach(s=>keys.add(owner+'->'+s));
 const TYPEFACE='Landroid/graphics/Typeface;',PAINT='Landroid/graphics/Paint;',typefaces=gcRoot(new Map()),faceCache=gcRoot(new Map());
 add(TYPEFACE,[`create(Ljava/lang/String;I)${TYPEFACE}`,`create(${TYPEFACE}I)${TYPEFACE}`,`create(${TYPEFACE}IZ)${TYPEFACE}`,`defaultFromStyle(I)${TYPEFACE}`,'getStyle()I','getWeight()I','isBold()Z','isItalic()Z']);
 add(PAINT,[`setTypeface(${TYPEFACE})${TYPEFACE}`,`getTypeface()${TYPEFACE}`,'getFillPath(Landroid/graphics/Path;Landroid/graphics/Path;)Z']);
 // System faces: the lab ships Roboto only. fonts.xml maps sans-serif and its aliases (arial, helvetica, tahoma, verdana) to it and defines weight aliases (sans-serif-thin 100 ... sans-serif-black 900). Any other
 // family name is absent from the system font map, and Typeface.create(String, int) answers the default typeface for it (create((Typeface) null, style)), as Android does: it is not an error.
 // Families fonts.xml defines that need font files the lab does not ship (serif, monospace, cursive, casual, the condensed and small-caps variants) therefore also answer Roboto.
 const SYSTEM_BASE=new Map([['sans-serif',400],['sans-serif-thin',100],['sans-serif-light',300],['sans-serif-medium',500],['sans-serif-black',900],['arial',400],['helvetica',400],['tahoma',400],['verdana',400]]);
 const apiStyle=(weight,italic)=>(weight>=600?1:0)|(italic?2:0);   // Typeface.cpp computeAPIStyle
 const makeTypeface=(family='sans-serif',style=0,weight=null,italic=null,baseHint=null)=>{
  const name=typeof family==='string'||family===null||family===undefined?family:runtime.stringCharacters(family);
  const relative=weight===null,base=baseHint??SYSTEM_BASE.get(name??'sans-serif')??400;
  if((style&~3)!==0)style=0;weight??=Math.min(1000,base+(style&1?300:0));italic??=!!(style&2);   // Typeface::computeRelativeStyle: bold adds 300 to the base weight
  const api=relative?style:apiStyle(weight,italic),key=weight+':'+italic+':'+base+':'+api;
  if(!faceCache.has(key)){const face=backend.selectTypeface(weight,italic),value=runtime.makeObject(TYPEFACE),info={face,family:'Roboto',style:api,weight,baseWeight:base,italic,reference:value};typefaces.set(value.ref,info);faceCache.set(key,value);}return faceCache.get(key);
 };
 // App fonts: one registered face per distinct font file (content hash + collection index), shared by every Typeface built from it, and registered once with the paragraph font provider under a content-derived family
 // name so SkParagraph can shape and fall back through [app family..., Roboto].
 const fontFiles=new Map(),registeredNames=backend.customFontNames??=new Set();let customCount=0,specSeq=0;
 /** A face from font bytes (ttc selects a collection member); null when it is not a font FreeType can read. */
 const registerFontFile=({bytes,ttc=0})=>{
  const hash=sha256Hex(bytes)+':'+ttc,known=fontFiles.get(hash);if(known)return known;
  if(fontFiles.size>=256)fail('Custom font limit (256) exceeded');
  const data=sfntMember(bytes,ttc);if(!data||!sfntStyle(data,0))return null;
  const ck=CK.Typeface.MakeFreeTypeFaceFromData(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));if(!ck)return null;
  const name='apk-font-'+hash.slice(0,32).replace(':','-');if(!registeredNames.has(name)){if(registeredNames.size>=1024)fail('Registered custom font limit (1024) exceeded');backend.fallback.registerCustom(name,data);registeredNames.add(name);}
  const entry={ck,name,axes:sfntAxes(data,0),size:data.length};fontFiles.set(hash,entry);return entry;
 };
 // Minikin FontFamily::getClosestMatch (score = weight grades apart + 2 for a slant mismatch) and computeFakery (fake bold when the wanted weight is >= 600 and 200+ above the font's; fake italic for an italic request on an upright font)
 const closest=(fonts,weight,italic)=>{let best=null,score=Infinity;for(const f of fonts){const s=Math.abs(Math.trunc(weight/100)-Math.trunc(f.weight/100))+(italic===f.italic?0:2);if(s<score){best=f;score=s;}}return best;};
 const bindCustom=info=>{
  const chain=info.spec.families.map(fonts=>closest(fonts,info.weight,info.italic)),primary=chain[0];
  info.selected=primary;info.face=primary.file.ck;info.families=chain.map(font=>font.file.name);
  info.fontVariations=primary.axes?.length?primary.axes.map(axis=>({axis:axis.tag,value:axis.value})):undefined;
  info.fakeBold=info.weight>=600&&info.weight-primary.weight>=200;info.fakeItalic=info.italic&&!primary.italic;
 };
 const makeCustom=(spec,weight,italic,baseWeight,style)=>{
  const key=weight+':'+italic+':'+baseWeight+':'+style;if(spec.cache.has(key))return spec.cache.get(key);
  if(customCount>=4096)fail('Custom Typeface limit (4096) exceeded');
  const value=runtime.makeObject(TYPEFACE),info={custom:true,spec,family:'custom',weight,italic,baseWeight,style,reference:value};bindCustom(info);
  typefaces.set(value.ref,info);spec.cache.set(key,value);customCount++;return value;
 };
 /** Typeface.CustomFallbackBuilder / Typeface.Builder result: `families` is the chain [[{file,weight,italic,axes}]...] (file from registerFontFile); the style picks the font of each family at use. */
 const customTypeface=({families,weight,italic,baseWeight,style})=>makeCustom({id:specSeq++,families,cache:new Map()},weight,italic,baseWeight??weight,style??apiStyle(weight,italic));
 const resolveTypeface=reference=>{if(reference===null||reference===undefined||reference===0)reference=makeTypeface();const info=typefaces.get(reference.ref);if(!info)fail('Typeface has no installed native Skia font state');return info;};
 /** What the text paths need of a Typeface: the Skia face, the paragraph family chain, variation coordinates and the synthetic styles Android applies. */
 const faceState=info=>({nativeTypeface:info.face,weight:info.weight,italic:info.italic,...(info.families?{families:info.families}:{}),...(info.fontVariations?{fontVariations:info.fontVariations}:{}),...(info.fakeBold?{fakeBold:true}:{}),...(info.fakeItalic?{fakeItalic:true}:{})});
 add(PATH,['<init>()V',`<init>(${PATH})V`,'reset()V','rewind()V','moveTo(FF)V','rMoveTo(FF)V','lineTo(FF)V','rLineTo(FF)V','quadTo(FFFF)V','rQuadTo(FFFF)V','cubicTo(FFFFFF)V','rCubicTo(FFFFFF)V','close()V','isEmpty()Z','approximate(F)[F',`set(${PATH})V`,`addPath(${PATH})V`,'setFillType(Landroid/graphics/Path$FillType;)V','getFillType()Landroid/graphics/Path$FillType;']);
 add(PATH,['addRoundRect(FFFFFFLandroid/graphics/Path$Direction;)V']);
 const PICTURE='Landroid/graphics/Picture;';
 add(PICTURE,['<init>()V',`<init>(${PICTURE})V`,'beginRecording(II)Landroid/graphics/Canvas;','endRecording()V','getWidth()I','getHeight()I','requiresHardwareAcceleration()Z','draw(Landroid/graphics/Canvas;)V']);
 add(CANVAS,[`drawPicture(${PICTURE})V`,`drawPicture(${PICTURE}Landroid/graphics/RectF;)V`,`drawPicture(${PICTURE}Landroid/graphics/Rect;)V`]);
 const OP='Landroid/graphics/Path$Op;',OPS=['DIFFERENCE','INTERSECT','UNION','XOR','REVERSE_DIFFERENCE'],CK_OPS=['Difference','Intersect','Union','XOR','ReverseDifference'];
 add(PATH,[`op(${PATH}${OP})Z`,`op(${PATH}${PATH}${OP})Z`]);add(OP,[`values()[${OP}`]);
 add(PATH,['readOnlyNI()J','getNativeInstance()J']);
 // Path geometry added in the Lottie/Glide round: shapes, arcs, offsets and transforms over CanvasKit's PathBuilder (SkPath::addRect/addOval/addCircle/addArc/arcTo/offset/transform).
 const DIR='Landroid/graphics/Path$Direction;',RF='Landroid/graphics/RectF;',MATRIX='Landroid/graphics/Matrix;';
 add(PATH,[`addRect(${RF}${DIR})V`,`addRect(FFFF${DIR})V`,`addOval(${RF}${DIR})V`,`addOval(FFFF${DIR})V`,`addCircle(FFF${DIR})V`,`addArc(${RF}FF)V`,'addArc(FFFFFF)V',`arcTo(${RF}FFZ)V`,`arcTo(${RF}FF)V`,'arcTo(FFFFFFZ)V',
  'offset(FF)V',`offset(FF${PATH})V`,`transform(${MATRIX})V`,`transform(${MATRIX}${PATH})V`,`addPath(${PATH}${MATRIX})V`,`addPath(${PATH}FF)V`,`computeBounds(${RF}Z)V`,'incReserve(I)V','toggleInverseFillType()V','isInverseFillType()Z']);
 add(PATH,['addRoundRect(Landroid/graphics/RectF;[FLandroid/graphics/Path$Direction;)V']);
 add(PATH,['addRoundRect(Landroid/graphics/RectF;FFLandroid/graphics/Path$Direction;)V','addRoundRect(FFFF[FLandroid/graphics/Path$Direction;)V']);
 add(CANVAS,['drawColor(ILandroid/graphics/PorterDuff$Mode;)V','drawDoubleRoundRect(Landroid/graphics/RectF;FFLandroid/graphics/RectF;FFLandroid/graphics/Paint;)V','drawDoubleRoundRect(Landroid/graphics/RectF;[FLandroid/graphics/RectF;[FLandroid/graphics/Paint;)V']);
 add(CANVAS,[`drawPath(${PATH}Landroid/graphics/Paint;)V`,'drawCircle(FFFLandroid/graphics/Paint;)V','drawOval(FFFFLandroid/graphics/Paint;)V','drawRoundRect(FFFFFFLandroid/graphics/Paint;)V','drawColor(I)V','drawText(Ljava/lang/String;FFLandroid/graphics/Paint;)V','drawText(Ljava/lang/String;IIFFLandroid/graphics/Paint;)V','drawText(Ljava/lang/CharSequence;IIFFLandroid/graphics/Paint;)V','drawText([CIIFFLandroid/graphics/Paint;)V','clipRect(FFFF)Z','clipRect(Landroid/graphics/Rect;)Z',`clipPath(${PATH})Z`]);
 add(CANVAS,['drawRect(Landroid/graphics/RectF;Landroid/graphics/Paint;)V','drawRoundRect(Landroid/graphics/RectF;FFLandroid/graphics/Paint;)V','drawOval(Landroid/graphics/RectF;Landroid/graphics/Paint;)V','saveLayer(FFFFLandroid/graphics/Paint;)I','save()I','restore()V','restoreToCount(I)V','getSaveCount()I']);
 add(CANVAS,['setCompatibilityVersion(I)V','<init>(J)V','getClipBounds(Landroid/graphics/Rect;)Z','getClipBounds()Landroid/graphics/Rect;']);
 add(CANVAS,['drawLine(FFFFLandroid/graphics/Paint;)V','drawPoint(FFLandroid/graphics/Paint;)V','drawArc(FFFFFFZLandroid/graphics/Paint;)V','drawArc(Landroid/graphics/RectF;FFZLandroid/graphics/Paint;)V']);
 add(CANVAS,['drawTextRun(Ljava/lang/CharSequence;IIIIFFZLandroid/graphics/Paint;)V','drawTextRun(Ljava/lang/String;IIIIFFZLandroid/graphics/Paint;)V','drawTextRun([CIIIIFFZLandroid/graphics/Paint;)V']);
 add(CANVAS,['clipRect(FFFFLandroid/graphics/Region$Op;)Z','clipRect(IIIILandroid/graphics/Region$Op;)Z','clipRect(Landroid/graphics/Rect;Landroid/graphics/Region$Op;)Z','clipRect(Landroid/graphics/RectF;Landroid/graphics/Region$Op;)Z',`clipPath(${PATH}Landroid/graphics/Region$Op;)Z`,'clipOutRect(FFFF)Z','clipOutRect(IIII)Z','clipOutRect(Landroid/graphics/Rect;)Z','clipOutRect(Landroid/graphics/RectF;)Z',`clipOutPath(${PATH})Z`]);
 add(CANVAS,['concat(Landroid/graphics/Matrix;)V','clipRect(IIII)Z','save(I)I']);
 add(CANVAS,['clipRect(Landroid/graphics/RectF;)Z']);
 // Canvas.saveLayer / saveLayerAlpha: a real offscreen layer (SkCanvas::saveLayer) bounded by the rectangle when one is given, composited back with the paint's alpha / blend / color filter on restore.
 add(CANVAS,[`saveLayer(${RF}Landroid/graphics/Paint;)I`,`saveLayer(${RF}Landroid/graphics/Paint;I)I`,'saveLayer(FFFFLandroid/graphics/Paint;I)I',`saveLayerAlpha(${RF}I)I`,`saveLayerAlpha(${RF}II)I`,'saveLayerAlpha(FFFFI)I','saveLayerAlpha(FFFFII)I',`getMatrix(${MATRIX})V`,`getMatrix()${MATRIX}`]);
 // android.graphics.PathMeasure over CanvasKit's ContourMeasure (SkContourMeasureIter): the current contour of the path set with setPath, advanced by nextContour().
 const PATH_MEASURE='Landroid/graphics/PathMeasure;',measures=new Map(),floatBitsOf=x=>{bits.setFloat32(0,x,true);return bits.getInt32(0,true);};
 add(PATH_MEASURE,['<init>()V',`<init>(${PATH}Z)V`,`setPath(${PATH}Z)V`,'getLength()F','isClosed()Z','nextContour()Z','getPosTan(F[F[F)Z',`getSegment(FF${PATH}Z)Z`,'getMatrix(FLandroid/graphics/Matrix;I)Z']);
 const releaseMeasure=state=>{state.contour?.delete();state.iter?.delete();state.shape?.delete();state.contour=state.iter=state.shape=null;};
 const setMeasurePath=(state,pathRef,forceClosed)=>{releaseMeasure(state);if(!pathRef)return;state.shape=path(pathRef).builder.snapshot();state.iter=new CK.ContourMeasureIter(state.shape,!!forceClosed,1);state.contour=state.iter.next();};
 const measure=(vm,ref)=>{const state=measures.get(ref.ref);if(!state)fail('PathMeasure used before construction');return state;};
 const rectF=ref=>finite(['left','top','right','bottom'].map(field=>number(runtime.object(ref).fields.get(`Landroid/graphics/RectF;->${field}:F`)??0)));
 const path=ref=>{const value=paths.get(ref?.ref);if(!value)fail('Path native state is unavailable');return value;};
 const snapshot=ref=>{const p=path(ref).builder.snapshot();try{return {commands:new Float32Array(p.toCmds()),fillType:p.getFillType().value};}finally{p.delete();}};
 const canvasState=ref=>getVectorGraphics(runtime).get(runtime.object(ref).nativeCanvasHandle,'canvas');
 const record=(receiver,command)=>{const state=canvasState(receiver);bitmaps.flattenFullCanvas(runtime.object(receiver).nativeCanvasHandle);getVectorGraphics(runtime).reserveDrawStorage((command.commands?.length??0)*4+(command.text?.length??0));if(state.draws.length>=1024)fail('Skia command limit exceeded');let cells=command.commands?.length??command.text?.length??0;for(const object of getVectorGraphics(runtime).handles.values())if(object.kind==='canvas')for(const draw of object.draws){cells+=draw.commands?.length??draw.text?.length??0;if(cells>1000000)fail('Aggregate recorded Skia geometry/text limit exceeded');}state.draws.push({kind:'skia',...command,matrix:state.matrix.slice(),clips:(state.clips??[]).slice()});};
 let host;const bitmaps=createBitmapHost(runtime,{recordNative:(handle,command)=>host.recordNative(handle,command),rectF,matrixValues:getMatrixValues});
 host={
  bitmaps,
  supports:key=>keys.has(key)||matrixHost.supports(key)||bitmaps.supports(key),canAllocate:type=>type===PATH||type===PICTURE||type===PATH_MEASURE||!!matrixHost.parent(type),parent:type=>matrixHost.parent(type)??bitmaps.parent(type)??(type===OP?'Ljava/lang/Enum;':type===CANVAS?'Landroid/graphics/BaseCanvas;':type==='Landroid/graphics/BaseCanvas;'?'Ljava/lang/Object;':type===PATH||type===TYPEFACE||type===PATH_MEASURE||type===PICTURE?'Ljava/lang/Object;':null),
  interfaces:type=>matrixHost.interfaces?.(type)??[],
  resolveTypeface,customTypeface,registerFontFile,faceState,
  /** Typeface.createFromTypefaceWithVariation: the same family chain with the supported axes (those the font file declares in fvar) set on every font; null when no axis is supported. */
  variationTypeface(reference,axes){
   const info=resolveTypeface(reference);if(!info.custom)return null;
   const supported=axes.filter(a=>info.spec.families.some(fonts=>fonts.some(f=>f.file.axes.some(x=>x.tag===a.tag))));if(!supported.length)return null;
   const apply=font=>font.file.axes.length?{...font,axes:[...(font.axes??[]).filter(x=>!supported.some(a=>a.tag===x.tag)),...supported.filter(a=>font.file.axes.some(x=>x.tag===a.tag)).map(a=>({tag:a.tag,value:a.value}))]}:font;
   return makeCustom({id:specSeq++,families:info.spec.families.map(fonts=>fonts.map(apply)),cache:new Map()},info.weight,info.italic,info.baseWeight,info.style);
  },
  parsePath(handle,text){const ref=pathHandles.get(handle);if(!ref)fail('Invalid or released VM SkPath token');const state=path(ref),shape=CK.Path.MakeFromSVGString(text);if(!shape)runtime.throwJava('Ljava/lang/IllegalArgumentException;','Invalid SVG pathData');try{const count=shape.countPoints(),old=state.builder.countPoints();if(count>100000||pathCells-old+count>1000000)fail('Parsed SkPath exceeds bounded geometry storage');const replacement=new CK.PathBuilder(shape);state.builder.delete();state.builder=replacement;pathCells=pathCells-old+count;}finally{shape.delete();}},
  /** The commands and fill type of the Path object `ref` (what JNI code sees through Path.mNativePath: src/skia-path-layout.js). */
  pathSnapshot(ref){return snapshot(ref);},
  pathByHandle(handle){const ref=pathHandles.get(handle);if(!ref)fail('Invalid or released VM SkPath token');return snapshot(ref);},
  recordNative(handle,command){const graphics=getVectorGraphics(runtime),state=graphics.get(handle,'canvas');bitmaps.flattenFullCanvas(handle);let rasterBytes=(command.raster?.dataURL?.length??0)+(command.pixelData?.base64?.length??0);for(const value of graphics.handles.values())if(value.kind==='canvas')for(const draw of value.draws){rasterBytes+=(draw.raster?.dataURL?.length??0)+(draw.pixelData?.base64?.length??0);if(rasterBytes>32*1024*1024)fail('Recorded Canvas rasters exceed32MiB');}getVectorGraphics(runtime).reserveDrawStorage((command.commands?.length??0)*4+(command.text?.length??0));if(state.draws.length>=1024)fail('Skia command limit exceeded');state.draws.push({kind:'skia',...command,matrix:state.matrix.slice(),clips:(state.clips??[]).slice()});},
  textBounds(text,state={}){const face=resolveTypeface(state.typefaceRef);return measureSkiaTextBounds(backend,text,{...state,...faceState(face)});},
  measureRun(text,options={},state={}){const face=resolveTypeface(state.typefaceRef);return measureSkiaRun(backend,text,{...state,...options,...faceState(face)});},
  /** Paint.hasGlyph: the paint's typeface (else Roboto of its weight/style) has a glyph for every character, the Android fallback chain included. */
  hasGlyph(text,state={}){if(!text.length)return false;const face=resolveTypeface(state.typefaceRef),CK=backend.CanvasKit,font=new CK.Font(face.face??backend.typeface,12);
   try{const ids=font.getGlyphIDs(text);if(ids.length&&ids.every(id=>id!==0))return true;}finally{font.delete();}
   return !!backend.fallback?.covers(text,{weight:face.weight,italic:face.italic});},
  measureText(text,state={}){const face=resolveTypeface(state.typefaceRef);return measureSkiaText(backend,text,{...state,...faceState(face)});},
  readStatic(vm,field){const bitmapStatic=bitmaps.readStatic(field);if(bitmapStatic)return bitmapStatic;if(field.owner===OP&&OPS.includes(field.name))return{handled:true,value:bitmaps.enumValue(OP,OPS,field.name)};if(field.owner===TYPEFACE&&['DEFAULT','DEFAULT_BOLD','SANS_SERIF','SERIF','MONOSPACE'].includes(field.name))return{handled:true,value:makeTypeface(field.name==='SERIF'?'serif':field.name==='MONOSPACE'?'monospace':'sans-serif',field.name==='DEFAULT_BOLD'?1:0)};return null;},
  dispose(){runtime.rasterCache?.clear();runtime.rasterCacheBytes=0;for(const f of fontFiles.values())f.ck.delete();fontFiles.clear();for(const m of measures.values())releaseMeasure(m);measures.clear();for(const p of paths.values())p.builder.delete();paths.clear();pathHandles.clear();},
  invoke(vm,method,args){if(bitmaps.supports(method.owner+'->'+method.name+method.signature))return bitmaps.invoke(vm,method,args);if(matrixHost.supports(method.owner+'->'+method.name+method.signature))return matrixHost.invoke(vm,method,args);const name=method.name,receiver=args[0];
   if(method.owner===CANVAS&&name==='setCompatibilityVersion'){vm.canvasCompatibilityVersion=args[0]|0;vm.record(`CANVAS compatibility target=${vm.canvasCompatibilityVersion} [actual process graphics policy]`);return;}
   if(method.owner===TYPEFACE){
    if(name==='create'){
     if(method.parameters[0]==='Ljava/lang/String;')return makeTypeface(args[0],args[1]);   // an unknown family name answers the default typeface (no exception)
     const source=resolveTypeface(args[0]);
     if(method.parameters.length===3){   // create(Typeface, weight, italic): an absolute style over the same family chain
      if(args[1]<0||args[1]>1000)vm.throwJava('Ljava/lang/IllegalArgumentException;','Typeface weight must be0..1000');
      return source.custom?makeCustom(source.spec,args[1],!!args[2],source.baseWeight,apiStyle(args[1],!!args[2])):makeTypeface(source.family,0,args[1],!!args[2],source.baseWeight);
     }
     let style=args[1];if((style&~3)!==0)style=0;
     if(style===source.style)return source.reference;
     return source.custom?makeCustom(source.spec,Math.min(1000,source.baseWeight+(style&1?300:0)),!!(style&2),source.baseWeight,style):makeTypeface(source.family,style,null,null,source.baseWeight);
    }
    if(name==='defaultFromStyle')return makeTypeface('sans-serif',args[0]);
    const info=resolveTypeface(receiver);return name==='getStyle'?info.style:name==='getWeight'?info.weight:name==='isBold'?(info.style&1?1:0):info.italic?1:0;
   }
   if(method.owner===PAINT&&name==='getFillPath'){
    // Paint.getFillPath(src, dst): the outline the paint would draw (SkPaint::getFillPath). A fill paint gives the source path; a stroke paint gives its stroked outline (width, cap, join,
    // miter); a zero-width stroke is a hairline: dst is the source and the result is false. Path effects (dashes) are not applied: the paint host does not hold them.
    const state=getPaintState(vm,receiver);if(args[1]==null||args[1]===0||args[2]==null||args[2]===0)vm.throwJava('Ljava/lang/NullPointerException;',null);
    const source=path(args[1]).builder.snapshot();let outline=null,filled=1;
    try{
     const style=state.style|0,width=Number(state.strokeWidth??0);
     if(style!==0&&width>0){const caps=[CK.StrokeCap.Butt,CK.StrokeCap.Round,CK.StrokeCap.Square],joins=[CK.StrokeJoin.Miter,CK.StrokeJoin.Round,CK.StrokeJoin.Bevel];
      outline=source.makeStroked({width,miter_limit:Number(state.strokeMiter??4),cap:caps[state.strokeCap|0]??caps[0],join:joins[state.strokeJoin|0]??joins[0]});if(!outline)filled=0;}
     else if(style!==0)filled=0;   // hairline
     const target=path(args[2]),replacement=new CK.PathBuilder(outline??source);target.builder.delete();target.builder=replacement;pathCells+=replacement.countPoints();
    }finally{source.delete();outline?.delete();}
    return filled;
   }
   if(method.owner===PAINT){const state=getPaintState(vm,receiver);if(name==='getTypeface')return state.typefaceRef??null;const value=args[1]==null||args[1]===0?null:args[1];if(value)resolveTypeface(value);state.typefaceRef=value;return value;}
   if(method.owner===CANVAS&&name==='<init>'){const handle=args[1];getVectorGraphics(vm).get(handle,'canvas');const object=vm.object(receiver);object.nativeCanvasHandle=handle;for(const[field,type,value]of [['mNativeCanvasWrapper','J',handle],['mDensity','I',0],['mScreenDensity','I',0]])vm.storeField(object.fields,`${CANVAS}->${field}:${type}`,value);object.canvasDensity=0;return;}
   if(method.owner===PICTURE||(method.owner===CANVAS&&name==='drawPicture')){
    // android.graphics.Picture: a recorded command list (a software Canvas that is frozen by endRecording()) replayed under the target canvas's matrix and clip.
    const graphics=getVectorGraphics(vm);
    const play=(canvasRef,pictureRef,dst)=>{
     const picture=vm.object(pictureRef).picture;if(!picture)fail('Picture used before construction');
     if(picture.recording)endRecording(pictureRef);
     const state=canvasState(canvasRef),saved=state.matrix.slice();
     try{
      if(dst){const[a,b,c,d]=state.matrix;state.matrix[4]+=a*dst.left+c*dst.top;state.matrix[5]+=b*dst.left+d*dst.top;
       if(picture.width>0&&picture.height>0){const sx=(dst.right-dst.left)/picture.width,sy=(dst.bottom-dst.top)/picture.height;state.matrix[0]=a*sx;state.matrix[1]=b*sx;state.matrix[2]=c*sy;state.matrix[3]=d*sy;}}
      record(canvasRef,{op:'picture',draws:picture.draws});
     }finally{for(let i=0;i<6;i++)state.matrix[i]=saved[i];}
    };
    const endRecording=ref=>{const picture=vm.object(ref).picture;if(!picture.recording)return;picture.draws=graphics.get(vm.object(picture.recording).nativeCanvasHandle,'canvas').draws.slice();picture.recording=null;};
    if(method.owner===CANVAS){
     const rect=args[2]?(method.parameters[1]===RF?rectF(args[2]):['left','top','right','bottom'].map(n=>vm.object(args[2]).fields.get(`Landroid/graphics/Rect;->${n}:I`)??0)):null;
     play(receiver,args[1],rect&&{left:rect[0],top:rect[1],right:rect[2],bottom:rect[3]});return;
    }
    if(name==='<init>'){
     const source=args[1]?vm.object(args[1]).picture:null;if(args[1]&&!source)fail('Picture copy source used before construction');
     if(source?.recording)endRecording(args[1]);
     vm.object(receiver).picture={width:source?.width??0,height:source?.height??0,draws:source?source.draws:[],recording:null};return;
    }
    const picture=vm.object(receiver).picture;if(!picture)fail('Picture used before construction');
    if(name==='beginRecording'){
     if(picture.recording)vm.throwJava('Ljava/lang/IllegalStateException;','Picture already recording, must call #endRecording()');
     const canvas=vm.allocate(CANVAS),object=vm.object(canvas),handle=graphics.createCanvas();
     object.nativeCanvasHandle=handle;object.canvasDensity=0;object.canvasWidth=args[1];object.canvasHeight=args[2];
     for(const[field,type,value]of [['mNativeCanvasWrapper','J',handle],['mDensity','I',0],['mScreenDensity','I',0]])vm.storeField(object.fields,`${CANVAS}->${field}:${type}`,value);
     picture.width=args[1];picture.height=args[2];picture.recording=canvas;picture.draws=[];return canvas;
    }
    if(name==='endRecording'){endRecording(receiver);return;}
    if(name==='getWidth')return picture.width;if(name==='getHeight')return picture.height;
    if(name==='requiresHardwareAcceleration')return 0;
    if(name==='draw'){play(args[1],receiver,null);return;}
   }
   if(method.owner===PATH_MEASURE){
    if(name==='<init>'){const state={shape:null,iter:null,contour:null};measures.set(receiver.ref,state);if(args[1])setMeasurePath(state,args[1],args[2]);return;}
    const state=measure(vm,receiver),contour=state.contour;
    if(name==='setPath'){setMeasurePath(state,args[1],args[2]);return;}
    if(name==='getLength')return floatBitsOf(contour?contour.length():0);
    if(name==='isClosed')return contour&&contour.isClosed()?1:0;
    if(name==='nextContour'){if(!state.iter)return 0;state.contour?.delete();state.contour=state.iter.next();return state.contour?1:0;}
    if(name==='getPosTan'||name==='getMatrix'){
      if(!contour)return 0;const distance=number(args[1]),length=contour.length();if(!(distance>=0&&distance<=length))return 0;
      const pos=contour.getPosTan(distance);
      if(name==='getPosTan'){
        for(const [index,offset] of [[2,0],[3,2]]){const array=args[index];if(!array)continue;const target=vm.array(array);if(target.elements.length<2)vm.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','array.length < 2');target.elements[0]=floatBitsOf(pos[offset]);target.elements[1]=floatBitsOf(pos[offset+1]);}
        return 1;
      }
      const flags=args[3],m=[1,0,0,0,1,0,0,0,1];
      if(flags&2){m[0]=pos[2];m[1]=-pos[3];m[3]=pos[3];m[4]=pos[2];}
      if(flags&1){m[2]=pos[0];m[5]=pos[1];}
      const values=vm.newArray('[F',9);vm.array(values).elements=m.map(floatBitsOf);
      vm.dispatch({owner:'Landroid/graphics/Matrix;',name:'setValues',parameters:['[F'],result:'V',signature:'([F)V'},[args[2],values],'virtual');return 1;
    }
    if(name==='getSegment'){
      if(!contour)return 0;let start=number(args[1]),stop=number(args[2]);const length=contour.length();if(start<0)start=0;if(stop>length)stop=length;if(!(start<=stop))return 0;
      const segment=contour.getSegment(start,stop,!!args[4]);if(!segment)return 0;
      try{const target=path(args[3]).builder;
        if(args[4]||target.countPoints()===0)target.addPath(segment);
        else{const commands=segment.toCmds();let at=0;while(at<commands.length){const verb=commands[at++];const arity=[2,2,4,5,6,0][verb]??fail('Unknown path verb');const v=commands.slice(at,at+arity);at+=arity;if(verb===0)continue;if(verb===1)target.lineTo(...v);else if(verb===2)target.quadTo(...v);else if(verb===3)target.conicTo(...v);else if(verb===4)target.cubicTo(...v);else target.close();}}
        pathCells+=segment.countPoints();return 1;
      }finally{segment.delete();}
    }
    fail('Unknown PathMeasure operation '+name);
   }
   if(method.owner===OP){const array=vm.newArray('['+OP,OPS.length);vm.object(array).elements=OPS.map(item=>bitmaps.enumValue(OP,OPS,item));return array;}
   if(method.owner===PATH){
    if(name==='<init>'){if(paths.size>=4096)fail('Skia Path limit exceeded');let builder;if(args[1]){const source=path(args[1]).builder.snapshot();builder=new CK.PathBuilder(source);source.delete();}else builder=new CK.PathBuilder();pathCells+=builder.countPoints();if(pathCells>1000000){builder.delete();fail('Aggregate Skia Path point limit exceeded');}const pathHandle=nextPathHandle++;paths.set(receiver.ref,{builder,handle:pathHandle});pathHandles.set(pathHandle,receiver);vm.storeField(vm.object(receiver).fields,`${PATH}->mNativePath:J`,pathHandle);vm.storeField(vm.object(receiver).fields,`${PATH}->isSimplePath:Z`,0);return;}
    const state=path(receiver),builder=state.builder;
    if(name==='op'){   // Path.op(Path, Op) / Path.op(Path, Path, Op): SkPathOps over the two snapshots; false when Skia cannot build a result
      const two=method.parameters.length===3,left=two?args[1]:receiver,right=two?args[2]:args[1],ordinal=vm.object(args.at(-1)).enumOrdinal;
      if(!Number.isInteger(ordinal)||ordinal<0||ordinal>=CK_OPS.length)fail('Path.op requires the Path.Op enum');
      const a=path(left).builder.snapshot(),b=path(right).builder.snapshot();let result;
      try{result=CK.Path.MakeFromOp(a,b,CK.PathOp[CK_OPS[ordinal]]);}finally{a.delete();b.delete();}
      if(!result)return 0;
      const count=result.countPoints();if(count>100000||pathCells+count>1000000){result.delete();fail('Aggregate Skia Path point limit exceeded');}
      const replacement=new CK.PathBuilder(result);result.delete();state.builder.delete();state.builder=replacement;pathCells+=count;return 1;
    }
    if(name==='readOnlyNI'||name==='getNativeInstance'){if(!state.handle){state.handle=nextPathHandle++;pathHandles.set(state.handle,receiver);}return state.handle;}
    if(name==='reset'||name==='rewind'){if(name==='reset'){const shape=builder.snapshot(),fill=shape.getFillType();shape.delete();builder.reset();builder.setFillType(fill);}else builder.reset();return;}
    if(name==='set'){if(receiver.ref===args[1]?.ref)return;const source=path(args[1]).builder.snapshot(),count=source.countPoints();if(count>100000||pathCells+count>1000000){source.delete();fail('Aggregate Skia Path point limit exceeded');}const replacement=new CK.PathBuilder(source);source.delete();state.builder.delete();state.builder=replacement;pathCells+=count;return;}
    if(name==='approximate'){const error=number(args[1]);if(error<0)vm.throwJava('Ljava/lang/IllegalArgumentException;','acceptableError must be greater than or equal to 0');if(!backend.pathApprox)fail('Original AOSP Path approximation Wasm is unavailable');const shape=builder.snapshot();let result;try{result=backend.pathApprox.approximate(shape.toCmds(),error);}finally{shape.delete();}vm.executionByOrigin.host.calls++;vm.record('HOST Path.approximate [original AOSP C++ Wasm / CanvasKit SkPath geometry]');const value=vm.newArray('[F',result.length);vm.array(value).elements=Array.from(result,x=>{bits.setFloat32(0,x,true);return bits.getInt32(0,true);});return value;}
    if(name==='isEmpty'){const shape=builder.snapshot();try{return shape.isEmpty()?1:0;}finally{shape.delete();}}
    if(name==='setFillType'){const index=vm.object(args[1]).fields.get('Landroid/graphics/Path$FillType;->nativeInt:I');if(!Number.isInteger(index)||index<0||index>3)fail('Path requires original FillType enum');builder.setFillType([CK.FillType.Winding,CK.FillType.EvenOdd,CK.FillType.InverseWinding,CK.FillType.InverseEvenOdd][index]);return;}
    if(name==='getFillType'){const shape=builder.snapshot();const index=shape.getFillType().value;shape.delete();const names=['WINDING','EVEN_ODD','INVERSE_WINDING','INVERSE_EVEN_ODD'],owner='Landroid/graphics/Path$FillType;',name=names[index];return vm.readStatic({owner,name,type:owner,key:`${owner}->${name}:${owner}`});}
    if(name==='addPath'&&method.parameters.length===1){const shape=path(args[1]).builder.snapshot(),count=shape.countPoints();if(pathCells+count>1000000){shape.delete();fail('Aggregate Skia Path point limit exceeded');}builder.addPath(shape);shape.delete();pathCells+=count;return;}
    if(name==='addRoundRect'&&method.parameters[0]==='F'&&method.parameters[4]==='[F'){   // addRoundRect(l, t, r, b, float[] radii, dir): eight radii, x then y per corner
      const radii=vm.array(args[5]);if(radii.elements.length<8)vm.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','radii[] needs 8 values');
      const direction=vm.object(args[6]).fields.get('Landroid/graphics/Path$Direction;->nativeInt:I');if(direction!==0&&direction!==1)fail('Path requires original Direction enum');
      const before=builder.countPoints();builder.addRRect(new Float32Array([...finite(args.slice(1,5).map(number)),...finite(radii.elements.slice(0,8).map(number))]),direction===1);
      pathCells+=builder.countPoints()-before;if(pathCells>1000000)fail('Aggregate Skia Path point limit exceeded');return;
    }
    if(name==='addRoundRect'&&method.parameters[0]==='Landroid/graphics/RectF;'&&method.parameters[1]==='F'){   // addRoundRect(RectF, rx, ry, dir)
      const direction=vm.object(args[4]).fields.get('Landroid/graphics/Path$Direction;->nativeInt:I');if(direction!==0&&direction!==1)fail('Path requires original Direction enum');
      const before=builder.countPoints();builder.addRRect(CK.RRectXY(rectF(args[1]),number(args[2]),number(args[3])),direction===1);
      pathCells+=builder.countPoints()-before;if(pathCells>1000000)fail('Aggregate Skia Path point limit exceeded');return;
    }
    if(name==='addRoundRect'&&method.parameters[0]==='F'){const values=finite(args.slice(1,7).map(number)),direction=vm.object(args[7]).fields.get('Landroid/graphics/Path$Direction;->nativeInt:I');if(direction!==0&&direction!==1)fail('Path requires original Direction enum');const before=builder.countPoints();builder.addRRect(CK.RRectXY(values.slice(0,4),values[4],values[5]),direction===1);pathCells+=builder.countPoints()-before;if(pathCells>1000000)fail('Aggregate Skia Path point limit exceeded');return;}
    if(name==='addRoundRect'){
      const radii=vm.array(args[2]);if(radii.type!=='[F')vm.throwJava('Ljava/lang/ClassCastException;','Round rectangle radii require float[]');
      if(radii.elements.length<8)vm.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','radii[] needs8values');
      const direction=vm.object(args[3]).fields.get('Landroid/graphics/Path$Direction;->nativeInt:I');if(direction!==0&&direction!==1)fail('Path requires original Direction enum');
      const before=builder.countPoints();builder.addRRect(new Float32Array([...rectF(args[1]),...finite(radii.elements.slice(0,8).map(number))]),direction===1);
      pathCells+=builder.countPoints()-before;if(pathCells>1000000)fail('Aggregate Skia Path point limit exceeded');return;
    }
    {
      const direction=ref=>{const index=vm.object(ref).fields.get(`${DIR}->nativeInt:I`);if(index!==0&&index!==1)fail('Path requires original Direction enum');return index===1;};
      const grow=before=>{pathCells+=Math.max(0,builder.countPoints()-before);if(pathCells>1000000)fail('Aggregate Skia Path point limit exceeded');};
      const before=builder.countPoints();
      if(name==='addRect'){const r=method.parameters[0]===RF?rectF(args[1]):finite(args.slice(1,5).map(number));builder.addRect(r,direction(args.at(-1)));grow(before);return;}
      if(name==='addOval'){const r=method.parameters[0]===RF?rectF(args[1]):finite(args.slice(1,5).map(number));builder.addOval(r,direction(args.at(-1)),1);grow(before);return;}
      if(name==='addCircle'){const[x,y,r]=finite(args.slice(1,4).map(number));if(r<0)return;builder.addCircle(x,y,r,direction(args[4]));grow(before);return;}
      if(name==='addArc'||name==='arcTo'){
        const rectArg=method.parameters[0]===RF,r=rectArg?rectF(args[1]):finite(args.slice(1,5).map(number)),angles=finite((rectArg?args.slice(2,4):args.slice(5,7)).map(number)),forceMoveTo=name==='addArc'?true:method.parameters.at(-1)==='Z'?!!args.at(-1):false;
        builder.arcToOval(r,angles[0],angles[1],forceMoveTo);grow(before);return;
      }
      if(name==='offset'||name==='transform'||(name==='addPath'&&method.parameters.length===2)){
        const m=name==='addPath'?null:name==='offset'?[1,0,number(args[1]),0,1,number(args[2]),0,0,1]:finite(Array.from(getMatrixValues(vm,args[1])));
        if(name==='addPath'){const source=path(args[1]).builder.snapshot();try{builder.addPath(source,getMatrixValues(vm,args[2]));}finally{source.delete();}grow(before);return;}
        const destination=name==='offset'?args[3]:args[2];
        if(destination){const source=builder.snapshot(),copy=new CK.PathBuilder(source);source.delete();copy.transform(m);const target=path(destination);target.builder.delete();target.builder=copy;}else builder.transform(m);
        return;
      }
      if(name==='addPath'&&method.parameters[1]==='F'){const source=path(args[1]).builder.snapshot();try{builder.addPath(source,[1,0,number(args[2]),0,1,number(args[3]),0,0,1]);}finally{source.delete();}grow(before);return;}
      if(name==='computeBounds'){const b=builder.getBounds(),target=vm.object(args[1]);['left','top','right','bottom'].forEach((field,i)=>vm.storeField(target.fields,`${RF}->${field}:F`,floatBitsOf(b[i])));return;}
      if(name==='incReserve')return;
      if(name==='toggleInverseFillType'||name==='isInverseFillType'){const shape=builder.snapshot(),index=shape.getFillType().value;shape.delete();if(name==='isInverseFillType')return index>=2?1:0;builder.setFillType([CK.FillType.InverseWinding,CK.FillType.InverseEvenOdd,CK.FillType.Winding,CK.FillType.EvenOdd][index]);return;}
    }
    if(builder.countPoints()>100000)fail('Skia Path point limit exceeded');if(name==='close'){builder.close();return;}
    const before=builder.countPoints(),values=finite(args.slice(1).map(number));if(typeof builder[name]!=='function')fail('Unsupported Path operation '+name);builder[name](...values);pathCells+=Math.max(0,builder.countPoints()-before);if(pathCells>1000000)fail('Aggregate Skia Path point limit exceeded');return;
   }
   const state=canvasState(receiver),values=args.slice(1).map((value,index)=>method.parameters[index]==='F'?number(value):value);
   if(name==='getClipBounds'&&method.parameters.length===0){   // Canvas.getClipBounds(): a new Rect filled by getClipBounds(Rect)
    const rect=vm.allocate('Landroid/graphics/Rect;');vm.dispatch({owner:'Landroid/graphics/Rect;',name:'<init>',parameters:[],result:'V',signature:'()V'},[rect],'direct');
    vm.dispatch({owner:CANVAS,name:'getClipBounds',parameters:['Landroid/graphics/Rect;'],result:'Z',signature:'(Landroid/graphics/Rect;)Z'},[receiver,rect],'virtual');return rect;
   }
   if(name==='getClipBounds'){
    if(args[1]===null||args[1]===0)vm.throwJava('Ljava/lang/NullPointerException;','Clip bounds Rect is null');const target=vm.object(args[1]);let bounds=[0,0,0,0],nonempty=false;
    if(state.width>0&&state.height>0){const surface=CK.MakeSurface(state.width,state.height);if(!surface)fail('Skia clip scratch allocation failed');try{const c=surface.getCanvas();applyClips(CK,c,state.clips);c.concat(matrix(state.matrix));const device=c.getDeviceClipBounds(),inverse=CK.Matrix.invert(c.getTotalMatrix());if(device[2]>device[0]&&device[3]>device[1]&&inverse){const points=CK.Matrix.mapPoints(inverse,[device[0],device[1],device[2],device[1],device[2],device[3],device[0],device[3]]);finite(points);bounds=[Math.min(points[0],points[2],points[4],points[6]),Math.min(points[1],points[3],points[5],points[7]),Math.max(points[0],points[2],points[4],points[6]),Math.max(points[1],points[3],points[5],points[7])].map(v=>Math.max(-2147483648,Math.min(2147483647,Math.floor(v+.5)))|0);nonempty=true;}}finally{surface.dispose();}}
    ['left','top','right','bottom'].forEach((field,i)=>vm.storeField(target.fields,`Landroid/graphics/Rect;->${field}:I`,bounds[i]));return nonempty?1:0;
   }
   if(name==='concat'){
    const transform=getMatrixValues(vm,args[1]);if(transform[6]!==0||transform[7]!==0||transform[8]!==1)fail('Perspective Canvas transforms require a projective canvas-state backend');
    const surface=CK.MakeSurface(1,1);if(!surface)fail('Skia Canvas matrix scratch allocation failed');
    try{const canvas=surface.getCanvas();canvas.concat(matrix(state.matrix));canvas.concat(transform);const result=canvas.getTotalMatrix();state.matrix=finite([result[0],result[3],result[1],result[4],result[2],result[5]]);}finally{surface.dispose();}return;
   }
   if(name==='getSaveCount')return state.stack.length+1;
   if(name==='getMatrix'){   // Canvas.getMatrix(Matrix): the current transform as a 3x3 (the canvas keeps [a,b,c,d,e,f]); getMatrix() is the deprecated allocating form
    const m=state.matrix,rows=[m[0],m[2],m[4],m[1],m[3],m[5],0,1*0,1];
    const target=method.parameters.length?args[1]:(()=>{const ref=vm.allocate(MATRIX);vm.dispatch({owner:MATRIX,name:'<init>',parameters:[],result:'V',signature:'()V'},[ref],'direct');return ref;})();
    if(target===null||target===0)vm.throwJava('Ljava/lang/NullPointerException;','ctm is null');
    const array=vm.newArray('[F',9);vm.array(array).elements=rows.map(value=>{bits.setFloat32(0,value,true);return bits.getInt32(0,true);});
    vm.dispatch({owner:MATRIX,name:'setValues',parameters:['[F'],result:'V',signature:'([F)V'},[target,array],'virtual');return method.parameters.length?undefined:target;
   }
   if(name==='save'||name==='saveLayer'||name==='saveLayerAlpha'){
    if(state.stack.length>=256)fail('Canvas save stack limit exceeded');const count=state.stack.length+1;
    let layerFlags=3;
    if(name!=='save'){
     // bounds: a RectF (null = unbounded) or four floats; then the Paint (saveLayer) or the 0..255 alpha (saveLayerAlpha); an optional trailing int is the deprecated save-flags word
     const byRect=method.parameters[0]===RF,bounds=byRect?(args[1]===null||args[1]===0?null:rectF(args[1])):finite(values.slice(0,4)),at=byRect?2:5;
     if(bounds)finite(bounds);
     let paint;
     if(name==='saveLayerAlpha'){const alpha=Math.max(0,Math.min(255,args[at]|0));paint={argb:(alpha<<24)>>>0|0x00ffffff,flags:1,style:0,strokeWidth:0,blendMode:3,alpha:alpha/255,isLayerAlpha:true};}
     else paint=args[at]?getSolidPaint(vm,args[at]):null;
     if(method.parameters.length>at+1&&method.parameters[at+1]==='I')layerFlags=args[at+1];
     record(receiver,{op:'layerBegin',paint,bounds});
    }
    const flags=name==='save'&&method.parameters.length?args[1]:layerFlags;
    state.stack.push({matrix:state.matrix.slice(),clips:(state.clips??[]).slice(),saveMatrix:!!(flags&1),saveClips:!!(flags&2),layer:name!=='save'});return count;
   }
   if(name==='restore'||name==='restoreToCount'){
    const count=name==='restore'?state.stack.length:args[1];if(count<1||count>state.stack.length+1)vm.throwJava('Ljava/lang/IllegalStateException;','Underflow in restore');
    while(state.stack.length+1>count){const previous=state.stack.pop();if(previous.layer)record(receiver,{op:'layerEnd'});if(previous.saveMatrix!==false)state.matrix=previous.matrix??previous;if(previous.saveClips!==false)state.clips=previous.clips??[];}return;
   }
   if(['clipRect','clipPath','clipOutRect','clipOutPath'].includes(name)){
    let operation=name.startsWith('clipOut')?0:1;const hasOp=method.parameters.at(-1)==='Landroid/graphics/Region$Op;';
    if(hasOp){if(!args.at(-1))vm.throwJava('Ljava/lang/NullPointerException;','Region.Op is null');operation=vm.object(args.at(-1)).fields.get('Landroid/graphics/Region$Op;->nativeInt:I');if(!Number.isInteger(operation)||operation<0||operation>5)fail('Clip operation requires the original Region.Op enum');if(operation>1){if((vm.canvasCompatibilityVersion??vm.targetSdkVersion??Number(vm.platform?.manifest?.usesSdk?.targetSdkVersion??1))>=28)vm.throwJava('Ljava/lang/IllegalArgumentException;','Invalid Region.Op - only INTERSECT and DIFFERENCE are allowed');fail('Legacy expanding Region.Op clip needs Skia path-operation clip state');}}
    let clip;if(name==='clipPath'||name==='clipOutPath')clip={...snapshot(args[1]),matrix:state.matrix.slice()};else{let rect;if(method.parameters[0]==='Landroid/graphics/Rect;'){const fields=vm.object(args[1]).fields;rect=['left','top','right','bottom'].map(n=>fields.get(`Landroid/graphics/Rect;->${n}:I`)??0);}else if(method.parameters[0]==='Landroid/graphics/RectF;')rect=rectF(args[1]);else rect=finite(hasOp?values.slice(0,-1):values);clip={rect,matrix:state.matrix.slice()};}clip.difference=operation===0;clip.antiAlias=false;
    clipCells+=clip.commands?.length??8;if(clipCells>1000000)fail('Aggregate Skia clip storage limit exceeded');if((state.clips??=[]).length>=128)fail('Skia clip limit exceeded');state.clips.push(clip);
    const width=state.width??411,height=state.height??840;if(!(width>0&&height>0))return 0;   // a canvas with no area (a RenderNode recorded at 0x0): every clip leaves it empty, as Canvas.clipRect answers false; Skia cannot even allocate the scratch surface
    const surface=CK.MakeSurface(width,height);if(!surface)fail('Skia clip scratch allocation failed');try{const canvas=surface.getCanvas();applyClips(CK,canvas,state.clips);return canvas.quickReject(CK.LTRBRect(0,0,width,height))?0:1;}finally{surface.dispose();}
   }
   if(name==='drawColor'){
    if(method.parameters.length===2){const mode=vm.object(args[2]).fields.get('Landroid/graphics/PorterDuff$Mode;->nativeInt:I');if(!Number.isInteger(mode)||mode<0||mode>28)fail('drawColor needs an original PorterDuff.Mode');record(receiver,{op:'color',color:args[1],blendMode:mode});return;}
    record(receiver,{op:'color',color:args[1]});return;
   }
   if(name==='drawDoubleRoundRect'){   // an outer rounded rectangle minus an inner one (SkCanvas::drawDRRect); radii are either one rx/ry pair or eight values per rectangle
    const paint=getSolidPaint(vm,args.at(-1)),shape=(rectRef,a,b)=>{const rect=rectF(rectRef);if(method.parameters[1]==='F')return [...rect,number(a),number(b)];const radii=vm.array(a);if(radii.elements.length<8)vm.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','radii[] needs 8 values');return [...rect,...radii.elements.slice(0,8).map(number)];};
    const byPair=method.parameters[1]==='F',outer=byPair?shape(args[1],args[2],args[3]):shape(args[1],args[2]),inner=byPair?shape(args[4],args[5],args[6]):shape(args[3],args[4]);
    finite(outer);finite(inner);record(receiver,{op:'doubleRoundRect',outer,inner,pair:byPair,paint});return;
   }
   const paintFace=resolveTypeface(getPaintState(vm,args.at(-1)).typefaceRef),paint={...getSolidPaint(vm,args.at(-1)),...faceState(paintFace)};
   if(name==='drawPath'){record(receiver,{op:'path',...snapshot(args[1]),paint});return;}
   if(name==='drawArc'){const rect=method.parameters[0]==='Landroid/graphics/RectF;'?rectF(args[1]):finite(values.slice(0,4)),angles=method.parameters[0]==='Landroid/graphics/RectF;'?[number(args[2]),number(args[3])]:values.slice(4,6),useCenter=!!args[method.parameters[0]==='Landroid/graphics/RectF;'?4:7];record(receiver,{op:'arc',args:finite([...rect,...angles]),useCenter,paint});return;}
   if(method.parameters[0]==='Landroid/graphics/RectF;'){
    const bounds=rectF(args[1]),op={drawRect:'rect',drawRoundRect:'roundRect',drawOval:'oval'}[name];if(!op)fail('Unsupported RectF drawing operation '+name);
    record(receiver,{op,args:name==='drawRoundRect'?[...bounds,...finite([number(args[2]),number(args[3])])]:bounds,paint});return;
   }
   if(name==='drawTextRun'){
    const value=args[1],array=method.parameters[0]==='[C',start=args[2],end=array?start+args[3]:args[3],cs=args[4],ce=array?cs+args[5]:args[5];if(value===null||value===0)vm.throwJava('Ljava/lang/NullPointerException;','text is null');
    const length=array?vm.array(value).elements.length:typeof value==='string'?value.length:vm.typeOf(value)==='Ljava/lang/String;'?vm.stringCharacters(value).length:vm.dispatch({owner:vm.typeOf(value),name:'length',parameters:[],result:'I',signature:'()I'},[value],'virtual');
    if(cs<0||start<cs||end<start||ce<end||ce>length)vm.throwJava('Ljava/lang/IndexOutOfBoundsException;','Text run range');if(ce-cs>65536)fail('Text shaping context exceeds65536UTF16units');
    if(!array&&typeof value!=='string'&&vm.isSubtype(vm.typeOf(value),'Landroid/text/GraphicsOperations;'))return vm.dispatch({owner:'Landroid/text/GraphicsOperations;',name:'drawTextRun',parameters:[CANVAS.replace('Canvas;','BaseCanvas;'),'I','I','I','I','F','F','Z','Landroid/graphics/Paint;'],result:'V',signature:'(Landroid/graphics/BaseCanvas;IIIIFFZLandroid/graphics/Paint;)V'},[value,receiver,start,end,cs,ce,args[6],args[7],args[8],args[9]],'virtual');
    let text;if(typeof value==='string')text=value.slice(cs,ce);else if(vm.typeOf(value)==='Ljava/lang/String;')text=vm.stringCharacters(value).slice(cs,ce);else{const chars=array?vm.array(value).elements.slice(cs,ce):(()=>{const ref=vm.newArray('[C',ce-cs);vm.dispatch({owner:'Landroid/text/TextUtils;',name:'getChars',parameters:['Ljava/lang/CharSequence;','I','I','[C','I'],result:'V',signature:'(Ljava/lang/CharSequence;II[CI)V'},[value,cs,ce,ref,0],'static');return vm.array(ref).elements;})();text='';for(let i=0;i<chars.length;i+=16384)text+=String.fromCharCode(...chars.slice(i,i+16384));}
    const face=resolveTypeface(paint.typefaceRef);record(receiver,{op:'paragraphRun',text,runStart:start-cs,runEnd:end-cs,args:finite([number(args[6]),number(args[7])]),isRtl:!!args[8],paint:{...paint,...faceState(face)}});return;
   }
   if(name==='drawText'&&method.parameters[0]==='[C'){   // drawText(char[] text, int index, int count, float x, float y, Paint)
    if(args[1]==null||args[1]===0)vm.throwJava('Ljava/lang/NullPointerException;',null);const chars=vm.array(args[1]).elements,index=args[2],count=args[3];
    if((index|count)<0||index+count>chars.length)vm.throwJava('Ljava/lang/IndexOutOfBoundsException;','Text range');
    if(count>65536)fail('Skia text run limit exceeded');record(receiver,{op:'text',text:String.fromCharCode(...chars.slice(index,index+count).map(v=>v&0xffff)),args:finite([number(args[4]),number(args[5])]),paint});return;
  }
  if(name==='drawText'){let text=args[1],x,y;if(method.parameters[0]==='Ljava/lang/CharSequence;'){if(text==null||text===0)vm.throwJava('Ljava/lang/NullPointerException;',null);if(typeof text!=='string')text=vm.stringCharacters(vm.dispatch({owner:'Ljava/lang/Object;',name:'toString',parameters:[],result:'Ljava/lang/String;',signature:'()Ljava/lang/String;'},[text],'virtual'));}if(typeof text!=='string')fail('Canvas.drawText requires a String');if(method.parameters.length===6){const from=args[2],to=args[3];if(from<0||to<from||to>text.length)vm.throwJava('Ljava/lang/IndexOutOfBoundsException;','Text range');text=text.slice(from,to);x=number(args[4]);y=number(args[5]);}else{x=number(args[2]);y=number(args[3]);}if(text.length>65536)fail('Skia text run limit exceeded');record(receiver,{op:'text',text,args:finite([x,y]),paint});return;}
   const op={drawCircle:'circle',drawOval:'oval',drawRoundRect:'roundRect',drawLine:'line',drawPoint:'point'}[name];if(!op)fail('Unsupported Skia Canvas operation '+name);record(receiver,{op,args:finite(values.slice(0,-1)),paint});
  },
  };
 return host;
}
