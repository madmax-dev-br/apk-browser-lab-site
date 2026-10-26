import {APKError} from './apk-runtime.js?v=dc4f5903d89b';
import {getVectorGraphics} from './vector-native.js?v=dc4f5903d89b';
import {getSolidPaint,getPaintState} from './paint-host.js?v=dc4f5903d89b';
import {createMatrixAllocationHost,getMatrixValues} from './matrix-native.js?v=dc4f5903d89b';
import {measureSkiaRun,measureSkiaTextBounds,drawSkiaTextRun} from './skia-paragraph.js?v=dc4f5903d89b';
import {getRenderNodeSnapshot,renderNodeShadowCaster,renderLightInfo} from './rendernode-native.js?v=dc4f5903d89b';
import {makeSkiaColorFilter} from './color-filter-native.js?v=dc4f5903d89b';
import {createBitmapHost} from './bitmap-host.js?v=dc4f5903d89b';
import { gcRoot } from './heap-gc.js?v=dc4f5903d89b';
const PATH='Landroid/graphics/Path;',CANVAS='Landroid/graphics/Canvas;';
const bits=new DataView(new ArrayBuffer(4));const number=n=>{bits.setInt32(0,n,true);return bits.getFloat32(0,true);};
const fail=message=>{throw new APKError(message,{kind:'skia-backend-unsupported'});};
const matrix=m=>[m[0],m[2],m[4],m[1],m[3],m[5],0,0,1];
const finite=values=>{if(values.some(v=>!Number.isFinite(v)))fail('Non-finite Skia geometry');return values;};
const argb=(CK,color,alpha=1)=>{const c=color>>>0;return CK.Color((c>>>16)&255,(c>>>8)&255,c&255,(c>>>24)/255*alpha);};
/** Android BitmapShader over a snapshot raster. ALPHA_8 bitmaps are coverage only: Skia exposes them as (0,0,0,a), later tinted by the Paint's color filter. */
function attachShader(CK,paint,shader){
 if(shader.kind!=='bitmap'||!shader.raster?.dataURL?.startsWith('data:image/png;base64,'))fail('Unsupported Paint shader description');
 const bytes=Uint8Array.from(atob(shader.raster.dataURL.slice(22)),c=>c.charCodeAt(0)),image=CK.MakeImageFromEncoded(bytes);if(!image)fail('Skia rejected the BitmapShader raster');
 let source=image,coverage=null;
 try{
  if(shader.alpha8){
   const surface=CK.MakeSurface(image.width(),image.height());if(!surface)fail('Skia BitmapShader mask allocation failed');
   const mask=new CK.Paint(),filter=CK.ColorFilter.MakeBlend(CK.Color(0,0,0,1),CK.BlendMode.SrcIn);mask.setColorFilter(filter);
   try{surface.getCanvas().clear(CK.TRANSPARENT);surface.getCanvas().drawImage(image,0,0,mask);surface.flush();coverage=surface.makeImageSnapshot();source=coverage;}finally{mask.delete();filter.delete();surface.dispose();}
  }
  const modes=[CK.TileMode.Clamp,CK.TileMode.Repeat,CK.TileMode.Mirror],built=source.makeShaderOptions(modes[shader.tileX],modes[shader.tileY],CK.FilterMode.Linear,CK.MipmapMode.None,shader.matrix?shader.matrix.slice():undefined);
  paint.setShader(built);built.delete();
 }finally{coverage?.delete();image.delete();}
}
function makePaint(CK,state){const paint=new CK.Paint();paint.setAntiAlias(!!(state.flags&1));paint.setColor(argb(CK,state.argb));paint.setBlendMode({value:state.blendMode??3});paint.setStyle([CK.PaintStyle.Fill,CK.PaintStyle.Stroke,CK.PaintStyle.StrokeAndFill][state.style]);paint.setStrokeWidth(state.strokeWidth);paint.setStrokeMiter(state.strokeMiter);paint.setStrokeCap([CK.StrokeCap.Butt,CK.StrokeCap.Round,CK.StrokeCap.Square][state.strokeCap]);paint.setStrokeJoin([CK.StrokeJoin.Miter,CK.StrokeJoin.Round,CK.StrokeJoin.Bevel][state.strokeJoin]);if(state.colorFilterSnapshot){const filter=makeSkiaColorFilter(CK,state.colorFilterSnapshot);paint.setColorFilter(filter);filter?.delete();}if(state.shader)attachShader(CK,paint,state.shader);return paint;}
function makeFont(backend,state,text){
 const CK=backend.CanvasKit;if(typeof text!=='string'||text.length>65536)fail('Skia text run exceeds65536characters');
 const size=state.textSize??12,scale=state.textScaleX??1,skew=state.textSkewX??0;if(![size,scale,skew].every(Number.isFinite)||size<0||size>512||Math.abs(scale)>16||Math.abs(skew)>16)fail('Skia font extent exceeds VM limits');
 if(state.hyphenEdit)fail('Text drawing with Android hyphen edits requires the Minikin boundary');
 // A simple glyph run is exact for scripts without contextual shaping (Latin, Greek, Cyrillic, punctuation, symbols);
 // complex scripts, combining marks and emoji/joiner sequences need Minikin/HarfBuzz. Missing glyphs still fail below.
 if(state.letterSpacing||state.wordSpacing||/[\p{Mark}\u200c\u200d\ufe0e\ufe0f\p{Extended_Pictographic}]|[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}\p{Script=Hangul}]/u.test(text))fail('Text shaping/fallback for this run requires the Android text layout bridge');
 if(state.flags&0x800)fail('The CanvasKit font API does not expose force-auto-hinting');
 const font=new CK.Font(state.nativeTypeface??backend.typeface,state.textSize??12);font.setScaleX(state.textScaleX??1);font.setSkewX(state.textSkewX??0);font.setEmbolden(!!(state.flags&0x20));font.setLinearMetrics(!!(state.flags&0x40));font.setSubpixel(!!(state.flags&0x80));font.setEmbeddedBitmaps(!!(state.flags&0x400));
 // Embind's public enum ABI is {value:number};0.42 omits the Alias symbol (SkFont::Edging::kAlias=0).
 font.setEdging(state.flags&1?CK.FontEdging.AntiAlias:(CK.FontEdging.Alias??{value:0}));
 font.setHinting(state.hinting===0?CK.FontHinting.None:CK.FontHinting.Normal);
 const glyphs=font.getGlyphIDs(text);if(glyphs.some(id=>id===0)){font.delete();fail('The supplied Roboto font lacks a glyph in this run');}return {font,glyphs};
}
export function measureSkiaText(backend,text,state={}){const {font,glyphs}=makeFont(backend,state,text);try{return {width:font.getGlyphWidths(glyphs).reduce((a,b)=>a+b,0),metrics:font.getMetrics(),glyphCount:glyphs.length,source:'official-Skia-Font/Roboto/simple-glyph-run'};}finally{font.delete();}}
function applyClips(CK,canvas,clips){for(const clip of clips??[]){let path,builder;
 if(clip.commands)path=CK.Path.MakeFromCmds(clip.commands);else{builder=new CK.PathBuilder();builder.addRect(clip.rect);path=builder.snapshot();builder.delete();}
 if(clip.fillType!==undefined)path.setFillType({value:clip.fillType});
 const transformed=new CK.PathBuilder(path);transformed.transform(matrix(clip.matrix));const shape=transformed.snapshot();canvas.clipPath(shape,clip.difference?CK.ClipOp.Difference:CK.ClipOp.Intersect,!!clip.antiAlias);shape.delete();transformed.delete();path.delete();
}}
function sourceVector(CK,canvas,graphics,handle,colorFilter=null){const tree=typeof handle==='object'?handle:graphics.get(handle,'tree'),seen=new Set(),get=pointer=>typeof pointer==='object'?pointer:graphics.get(pointer);
 const walk=(pointer,depth=0)=>{if(depth>128||seen.has(pointer))fail('Cyclic/excessive Skia vector tree');seen.add(pointer);const node=get(pointer);
  if(node.kind==='group'){const p=node.props;canvas.save();canvas.translate(p.translateX+p.pivotX,p.translateY+p.pivotY);canvas.rotate(p.rotation,0,0);canvas.scale(p.scaleX,p.scaleY);canvas.translate(-p.pivotX,-p.pivotY);
   for(const child of node.children){if(get(child).kind==='clip'){const path=CK.Path.MakeFromSVGString(get(child).path);if(!path)fail('Skia rejected a vector clip path');canvas.clipPath(path,CK.ClipOp.Intersect,tree.antiAlias);path.delete();}else walk(child,depth+1);}canvas.restore();
  }else if(node.kind==='full'){const p=node.props;if(p.trimPathStart!==0||p.trimPathEnd!==1||p.trimPathOffset!==0)fail('Android vector trim semantics are not connected to the Skia backend yet');const path=CK.Path.MakeFromSVGString(node.path);if(!path)fail('Skia rejected vector pathData');path.setFillType(p.fillType?CK.FillType.EvenOdd:CK.FillType.Winding);
   for(const [stroke,color,alpha]of [[false,p.fillColor,p.fillAlpha],[true,p.strokeColor,p.strokeAlpha]]){if(!(color>>>24)||stroke&&p.strokeWidth<=0)continue;const paint=new CK.Paint();paint.setAntiAlias(tree.antiAlias);paint.setColor(argb(CK,color,alpha));paint.setStyle(stroke?CK.PaintStyle.Stroke:CK.PaintStyle.Fill);if(stroke){paint.setStrokeWidth(p.strokeWidth);paint.setStrokeMiter(p.strokeMiterLimit);paint.setStrokeCap([CK.StrokeCap.Butt,CK.StrokeCap.Round,CK.StrokeCap.Square][p.strokeLineCap]);paint.setStrokeJoin([CK.StrokeJoin.Miter,CK.StrokeJoin.Round,CK.StrokeJoin.Bevel][p.strokeLineJoin]);}canvas.drawPath(path,paint);paint.delete();}path.delete();
  }else fail('Unsupported Skia vector node '+node.kind);seen.delete(pointer);
 };const alpha=new CK.Paint();alpha.setAlphaf(tree.alpha);if(colorFilter){const filter=makeSkiaColorFilter(CK,colorFilter);alpha.setColorFilter(filter);filter?.delete();}canvas.saveLayer(alpha);walk(tree.root);canvas.restore();alpha.delete();
}
export function rasterizeSkiaCanvas(runtime,backend,graphics,receiver,width,height){
 if(!(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=4096&&height<=4096&&width*height<=4*1024*1024))fail('Skia raster extent exceeds4096px/4Mpixel VM limit');
 const CK=backend.CanvasKit,state=graphics.get(runtime.object(receiver).nativeCanvasHandle,'canvas'),surface=CK.MakeSurface(width,height);if(!surface)fail('Skia CPU surface allocation failed');const canvas=surface.getCanvas();canvas.clear(CK.TRANSPARENT);
 const activeNodes=new Set();let replayCount=0;
 const drawNodeShadow=node=>{
   const z=renderNodeShadowCaster(node);if(!z)return;const outline=node.outline,casterAlpha=node.alpha*outline.alpha;let path;
   if(outline.commands){path=CK.Path.MakeFromCmds(outline.commands);path.setFillType({value:outline.fillType});}else{const builder=new CK.PathBuilder();builder.addRRect(CK.RRectXY(outline.rect,outline.radius,outline.radius));path=builder.snapshot();builder.delete();}
   const light=renderLightInfo(runtime,width),color=(value,alpha)=>{const c=value>>>0;return CK.Color4f(((c>>>16)&255)/255,((c>>>8)&255)/255,(c&255)/255,Math.max(0,Math.min(1,(c>>>24)/255*alpha)));};
   canvas.save();canvas.translate(node.left,node.top);if(node.staticMatrix)canvas.concat(node.staticMatrix);if(node.animationMatrix)canvas.concat(node.animationMatrix);canvas.concat(node.matrix);
   try{canvas.drawShadow(path,[0,0,z],[light.x,light.y,light.z],light.radius,color(node.ambientShadowColor,light.ambientShadowAlpha*casterAlpha),color(node.spotShadowColor,light.spotShadowAlpha*casterAlpha),casterAlpha<1?1:0);}finally{canvas.restore();path.delete();}
 };
 const run=(command,shadow=false)=>{
   if(command.op==='layerBegin'){const paint=command.paint?makePaint(CK,command.paint):null;canvas.saveLayer(paint);paint?.delete();return;}
   if(command.op==='layerEnd'){canvas.restore();return;}
   canvas.save();applyClips(CK,canvas,command.clips);canvas.concat(matrix(command.matrix));
   if(command.op==='renderNode'){
    if(activeNodes.has(command.node)||activeNodes.size>=128)fail('Cyclic/excessive RenderNode display-list graph');
    const node=getRenderNodeSnapshot(runtime,command.node);if(node.displayList&&node.alpha>0){
     if(shadow)drawNodeShadow(node);activeNodes.add(command.node);canvas.translate(node.left,node.top);if(node.staticMatrix)canvas.concat(node.staticMatrix);if(node.animationMatrix)canvas.concat(node.animationMatrix);canvas.concat(node.matrix);
     if(node.clipToBounds)canvas.clipRect(CK.LTRBRect(0,0,node.right-node.left,node.bottom-node.top),CK.ClipOp.Intersect,false);
     if(node.clipBounds)canvas.clipRect(CK.LTRBRect(...node.clipBounds),CK.ClipOp.Intersect,false);
     if(node.clipToOutline&&node.outline){if(node.outline.commands){const path=CK.Path.MakeFromCmds(node.outline.commands);path.setFillType({value:node.outline.fillType});canvas.clipPath(path,CK.ClipOp.Intersect,true);path.delete();}else if(node.outline.empty)canvas.clipRect(CK.LTRBRect(0,0,0,0),CK.ClipOp.Intersect,false);else canvas.clipRRect(CK.RRectXY(node.outline.rect,node.outline.radius,node.outline.radius),CK.ClipOp.Intersect,true);}
     const layer=node.layerPaint?makePaint(CK,node.layerPaint):new CK.Paint();layer.setAlphaf((node.layerPaint?.alpha??1)*Math.max(0,Math.min(1,node.alpha)));canvas.saveLayer(layer);layer.delete();replay(node.displayList);canvas.restore();activeNodes.delete(command.node);
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
    else if(command.op==='rect')canvas.drawRect(command.args,paint);
    else if(command.op==='color')canvas.drawColor(argb(CK,command.color),{value:command.blendMode??3});
    else if(command.op==='paint')canvas.drawPaint(paint);
    else if(command.op==='raster'){const raster=command.raster;if(raster?.kind!=='raster'||!raster.dataURL?.startsWith('data:image/png;base64,')||raster.dataURL.length>12*1024*1024)fail('Canvas raster requires a bounded actual PNG');const binary=atob(raster.dataURL.slice(22)),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const image=CK.MakeImageFromEncoded(bytes);if(!image)fail('Skia rejected a recorded widget raster');try{if(image.width()>4096||image.height()>4096||image.width()*image.height()>4*1024*1024)fail('Recorded widget raster exceeds Skia bounds');const drawImage=p=>{if(command.src&&command.dst)canvas.drawImageRect(image,CK.LTRBRect(...command.src),CK.LTRBRect(...command.dst),p);else{if(command.imageMatrix)canvas.concat(command.imageMatrix);if(command.imageScale&&command.imageScale!==1){canvas.translate(command.args[0],command.args[1]);canvas.scale(command.imageScale,command.imageScale);canvas.drawImage(image,0,0,p);}else canvas.drawImage(image,command.args[0],command.args[1],p);}};
     if(command.alpha8){
      // ALPHA_8 is coverage only: Skia tints it with the Paint color, then applies the Paint's alpha/filter/blend to the result.
      const c=(command.paint?.argb??0xff000000)>>>0,filter=CK.ColorFilter.MakeMatrix([0,0,0,0,((c>>>16)&255)/255,0,0,0,0,((c>>>8)&255)/255,0,0,0,0,(c&255)/255,0,0,0,1,0]),mask=new CK.Paint();
      mask.setColorFilter(filter);canvas.saveLayer(paint);try{drawImage(mask);}finally{canvas.restore();mask.delete();filter.delete();}
     }else drawImage(paint);}finally{image.delete();}}
    else if(command.op==='paragraphRun')drawSkiaTextRun(backend,canvas,command.text,command.args[0],command.args[1],command.paint,command.isRtl,paint,{start:command.runStart??0,end:command.runEnd??command.text.length});
    else if(command.op==='text'){
     const {font,glyphs}=makeFont(backend,command.paint,command.text);try{canvas.drawText(command.text,command.args[0],command.args[1],paint,font);
      if(command.paint.flags&0x18){const metrics=font.getMetrics(),width=font.getGlyphWidths(glyphs).reduce((a,b)=>a+b,0),decoration=paint.copy();decoration.setStyle(CK.PaintStyle.Fill);
       if(command.paint.flags&8)canvas.drawRect(CK.XYWHRect(command.args[0],command.args[1]+metrics.underlinePosition,width,metrics.underlineThickness),decoration);
       if(command.paint.flags&16)canvas.drawRect(CK.XYWHRect(command.args[0],command.args[1]+metrics.strikeoutPosition,width,metrics.strikeoutThickness),decoration);decoration.delete();}
     }finally{font.delete();}
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
 try{replay(state.draws);
  surface.flush();const image=surface.makeImageSnapshot();try{const png=image.encodeToBytes(CK.ImageFormat.PNG);if(!png)fail('Skia PNG encoding failed');let binary='';for(let at=0;at<png.length;at+=32768)binary+=String.fromCharCode(...png.subarray(at,at+32768));return {kind:'raster',dataURL:'data:image/png;base64,'+btoa(binary),width,height,drawCalls:state.draws.length,source:'official-Skia-Wasm/CPU',pngBytes:png.length};}finally{image.delete();}
 }finally{surface.dispose();}
}
export function createSkiaCanvasHost(runtime,backend){
 const matrixHost=createMatrixAllocationHost();
 const CK=backend.CanvasKit,paths=new Map(),pathHandles=new Map(),keys=new Set();let nextPathHandle=0x620000000n;let pathCells=0,clipCells=0;const add=(owner,signatures)=>signatures.forEach(s=>keys.add(owner+'->'+s));
 const TYPEFACE='Landroid/graphics/Typeface;',PAINT='Landroid/graphics/Paint;',typefaces=gcRoot(new Map()),faceCache=gcRoot(new Map());
 add(TYPEFACE,[`create(Ljava/lang/String;I)${TYPEFACE}`,`create(${TYPEFACE}I)${TYPEFACE}`,`create(${TYPEFACE}IZ)${TYPEFACE}`,`defaultFromStyle(I)${TYPEFACE}`,'getStyle()I','getWeight()I','isBold()Z','isItalic()Z']);
 add(PAINT,[`setTypeface(${TYPEFACE})${TYPEFACE}`,`getTypeface()${TYPEFACE}`]);
 const makeTypeface=(family='sans-serif',style=0,weight=null,italic=null)=>{
  const name=family??'sans-serif';if(!['sans-serif','sans','Roboto','sans-serif-medium','arial','helvetica','tahoma','verdana'].includes(name))fail(`Font family ${name} is not installed in the VM`);
  style&=3;weight??=name==='sans-serif-medium'&&style===0?500:style&1?700:400;italic??=!!(style&2);
  const key=weight+':'+italic;if(!faceCache.has(key)){const face=backend.selectTypeface(weight,italic),value=runtime.makeObject(TYPEFACE),info={face,family:'Roboto',style:(weight>=700?1:0)|(italic?2:0),weight,italic,reference:value};typefaces.set(value.ref,info);faceCache.set(key,value);}return faceCache.get(key);
 };
 const resolveTypeface=reference=>{if(reference===null||reference===undefined||reference===0)reference=makeTypeface();const info=typefaces.get(reference.ref);if(!info)fail('Typeface has no installed native Skia font state');return info;};
 add(PATH,['<init>()V',`<init>(${PATH})V`,'reset()V','rewind()V','moveTo(FF)V','rMoveTo(FF)V','lineTo(FF)V','rLineTo(FF)V','quadTo(FFFF)V','rQuadTo(FFFF)V','cubicTo(FFFFFF)V','rCubicTo(FFFFFF)V','close()V','isEmpty()Z','approximate(F)[F',`set(${PATH})V`,`addPath(${PATH})V`,'setFillType(Landroid/graphics/Path$FillType;)V','getFillType()Landroid/graphics/Path$FillType;']);
 add(PATH,['addRoundRect(FFFFFFLandroid/graphics/Path$Direction;)V']);
 add(PATH,['readOnlyNI()J','getNativeInstance()J']);
 add(PATH,['addRoundRect(Landroid/graphics/RectF;[FLandroid/graphics/Path$Direction;)V']);
 add(CANVAS,[`drawPath(${PATH}Landroid/graphics/Paint;)V`,'drawCircle(FFFLandroid/graphics/Paint;)V','drawOval(FFFFLandroid/graphics/Paint;)V','drawRoundRect(FFFFFFLandroid/graphics/Paint;)V','drawColor(I)V','drawText(Ljava/lang/String;FFLandroid/graphics/Paint;)V','drawText(Ljava/lang/String;IIFFLandroid/graphics/Paint;)V','clipRect(FFFF)Z','clipRect(Landroid/graphics/Rect;)Z',`clipPath(${PATH})Z`]);
 add(CANVAS,['drawRect(Landroid/graphics/RectF;Landroid/graphics/Paint;)V','drawRoundRect(Landroid/graphics/RectF;FFLandroid/graphics/Paint;)V','drawOval(Landroid/graphics/RectF;Landroid/graphics/Paint;)V','saveLayer(FFFFLandroid/graphics/Paint;)I','save()I','restore()V','restoreToCount(I)V','getSaveCount()I']);
 add(CANVAS,['setCompatibilityVersion(I)V','<init>(J)V','getClipBounds(Landroid/graphics/Rect;)Z']);
 add(CANVAS,['drawLine(FFFFLandroid/graphics/Paint;)V','drawPoint(FFLandroid/graphics/Paint;)V','drawArc(FFFFFFZLandroid/graphics/Paint;)V','drawArc(Landroid/graphics/RectF;FFZLandroid/graphics/Paint;)V']);
 add(CANVAS,['drawTextRun(Ljava/lang/CharSequence;IIIIFFZLandroid/graphics/Paint;)V','drawTextRun(Ljava/lang/String;IIIIFFZLandroid/graphics/Paint;)V','drawTextRun([CIIIIFFZLandroid/graphics/Paint;)V']);
 add(CANVAS,['clipRect(FFFFLandroid/graphics/Region$Op;)Z','clipRect(IIIILandroid/graphics/Region$Op;)Z','clipRect(Landroid/graphics/Rect;Landroid/graphics/Region$Op;)Z','clipRect(Landroid/graphics/RectF;Landroid/graphics/Region$Op;)Z',`clipPath(${PATH}Landroid/graphics/Region$Op;)Z`,'clipOutRect(FFFF)Z','clipOutRect(IIII)Z',`clipOutPath(${PATH})Z`]);
 add(CANVAS,['concat(Landroid/graphics/Matrix;)V','clipRect(IIII)Z','save(I)I']);
 const rectF=ref=>finite(['left','top','right','bottom'].map(field=>number(runtime.object(ref).fields.get(`Landroid/graphics/RectF;->${field}:F`)??0)));
 const path=ref=>{const value=paths.get(ref?.ref);if(!value)fail('Path native state is unavailable');return value;};
 const snapshot=ref=>{const p=path(ref).builder.snapshot();try{return {commands:new Float32Array(p.toCmds()),fillType:p.getFillType().value};}finally{p.delete();}};
 const canvasState=ref=>getVectorGraphics(runtime).get(runtime.object(ref).nativeCanvasHandle,'canvas');
 const record=(receiver,command)=>{const state=canvasState(receiver);getVectorGraphics(runtime).reserveDrawStorage((command.commands?.length??0)*4+(command.text?.length??0));if(state.draws.length>=1024)fail('Skia command limit exceeded');let cells=command.commands?.length??command.text?.length??0;for(const object of getVectorGraphics(runtime).handles.values())if(object.kind==='canvas')for(const draw of object.draws){cells+=draw.commands?.length??draw.text?.length??0;if(cells>1000000)fail('Aggregate recorded Skia geometry/text limit exceeded');}state.draws.push({kind:'skia',...command,matrix:state.matrix.slice(),clips:(state.clips??[]).slice()});};
 let host;const bitmaps=createBitmapHost(runtime,{recordNative:(handle,command)=>host.recordNative(handle,command),rectF,matrixValues:getMatrixValues});
 host={
  bitmaps,
  supports:key=>keys.has(key)||matrixHost.supports(key)||bitmaps.supports(key),canAllocate:type=>type===PATH||!!matrixHost.parent(type),parent:type=>matrixHost.parent(type)??bitmaps.parent(type)??(type===CANVAS?'Landroid/graphics/BaseCanvas;':type==='Landroid/graphics/BaseCanvas;'?'Ljava/lang/Object;':type===PATH||type===TYPEFACE?'Ljava/lang/Object;':null),
  interfaces:type=>matrixHost.interfaces?.(type)??[],
  resolveTypeface,
  parsePath(handle,text){const ref=pathHandles.get(handle);if(!ref)fail('Invalid or released VM SkPath token');const state=path(ref),shape=CK.Path.MakeFromSVGString(text);if(!shape)runtime.throwJava('Ljava/lang/IllegalArgumentException;','Invalid SVG pathData');try{const count=shape.countPoints(),old=state.builder.countPoints();if(count>100000||pathCells-old+count>1000000)fail('Parsed SkPath exceeds bounded geometry storage');const replacement=new CK.PathBuilder(shape);state.builder.delete();state.builder=replacement;pathCells=pathCells-old+count;}finally{shape.delete();}},
  pathByHandle(handle){const ref=pathHandles.get(handle);if(!ref)fail('Invalid or released VM SkPath token');return snapshot(ref);},
  recordNative(handle,command){const graphics=getVectorGraphics(runtime),state=graphics.get(handle,'canvas');let rasterBytes=command.raster?.dataURL?.length??0;for(const value of graphics.handles.values())if(value.kind==='canvas')for(const draw of value.draws){rasterBytes+=draw.raster?.dataURL?.length??0;if(rasterBytes>32*1024*1024)fail('Recorded Canvas rasters exceed32MiB');}getVectorGraphics(runtime).reserveDrawStorage((command.commands?.length??0)*4+(command.text?.length??0));if(state.draws.length>=1024)fail('Skia command limit exceeded');state.draws.push({kind:'skia',...command,matrix:state.matrix.slice(),clips:(state.clips??[]).slice()});},
  textBounds(text,state={}){const face=resolveTypeface(state.typefaceRef);return measureSkiaTextBounds(backend,text,{...state,weight:face.weight,italic:face.italic});},
  measureRun(text,options={},state={}){const face=resolveTypeface(state.typefaceRef);return measureSkiaRun(backend,text,{...state,...options,weight:face.weight,italic:face.italic});},
  measureText(text,state={}){return measureSkiaText(backend,text,{...state,nativeTypeface:resolveTypeface(state.typefaceRef).face});},
  readStatic(vm,field){const bitmapStatic=bitmaps.readStatic(field);if(bitmapStatic)return bitmapStatic;if(field.owner===TYPEFACE&&['DEFAULT','DEFAULT_BOLD','SANS_SERIF'].includes(field.name))return{handled:true,value:makeTypeface('sans-serif',field.name==='DEFAULT_BOLD'?1:0)};return null;},
  dispose(){for(const p of paths.values())p.builder.delete();paths.clear();pathHandles.clear();},
  invoke(vm,method,args){if(bitmaps.supports(method.owner+'->'+method.name+method.signature))return bitmaps.invoke(vm,method,args);if(matrixHost.supports(method.owner+'->'+method.name+method.signature))return matrixHost.invoke(vm,method,args);const name=method.name,receiver=args[0];
   if(method.owner===CANVAS&&name==='setCompatibilityVersion'){vm.canvasCompatibilityVersion=args[0]|0;vm.record(`CANVAS compatibility target=${vm.canvasCompatibilityVersion} [actual process graphics policy]`);return;}
   if(method.owner===TYPEFACE){
    if(name==='create'){if(method.parameters[0]==='Ljava/lang/String;')return makeTypeface(args[0],args[1]);const source=resolveTypeface(args[0]);if(method.parameters.length===3){if(args[1]<0||args[1]>1000)vm.throwJava('Ljava/lang/IllegalArgumentException;','Typeface weight must be0..1000');return makeTypeface(source.family,0,args[1],!!args[2]);}return (args[1]&3)===source.style?source.reference:makeTypeface(source.family,args[1]);}
    if(name==='defaultFromStyle')return makeTypeface('sans-serif',args[0]);
    const info=resolveTypeface(receiver);return name==='getStyle'?info.style:name==='getWeight'?info.weight:name==='isBold'?(info.style&1?1:0):info.italic?1:0;
   }
   if(method.owner===PAINT){const state=getPaintState(vm,receiver);if(name==='getTypeface')return state.typefaceRef??null;const value=args[1]==null||args[1]===0?null:args[1];if(value)resolveTypeface(value);state.typefaceRef=value;return value;}
   if(method.owner===CANVAS&&name==='<init>'){const handle=args[1];getVectorGraphics(vm).get(handle,'canvas');const object=vm.object(receiver);object.nativeCanvasHandle=handle;for(const[field,type,value]of [['mNativeCanvasWrapper','J',handle],['mDensity','I',0],['mScreenDensity','I',0]])vm.storeField(object.fields,`${CANVAS}->${field}:${type}`,value);object.canvasDensity=0;return;}
   if(method.owner===PATH){
    if(name==='<init>'){if(paths.size>=4096)fail('Skia Path limit exceeded');let builder;if(args[1]){const source=path(args[1]).builder.snapshot();builder=new CK.PathBuilder(source);source.delete();}else builder=new CK.PathBuilder();pathCells+=builder.countPoints();if(pathCells>1000000){builder.delete();fail('Aggregate Skia Path point limit exceeded');}const pathHandle=nextPathHandle++;paths.set(receiver.ref,{builder,handle:pathHandle});pathHandles.set(pathHandle,receiver);vm.storeField(vm.object(receiver).fields,`${PATH}->mNativePath:J`,pathHandle);vm.storeField(vm.object(receiver).fields,`${PATH}->isSimplePath:Z`,0);return;}
    const state=path(receiver),builder=state.builder;
    if(name==='readOnlyNI'||name==='getNativeInstance'){if(!state.handle){state.handle=nextPathHandle++;pathHandles.set(state.handle,receiver);}return state.handle;}
    if(name==='reset'||name==='rewind'){if(name==='reset'){const shape=builder.snapshot(),fill=shape.getFillType();shape.delete();builder.reset();builder.setFillType(fill);}else builder.reset();return;}
    if(name==='set'){if(receiver.ref===args[1]?.ref)return;const source=path(args[1]).builder.snapshot(),count=source.countPoints();if(count>100000||pathCells+count>1000000){source.delete();fail('Aggregate Skia Path point limit exceeded');}const replacement=new CK.PathBuilder(source);source.delete();state.builder.delete();state.builder=replacement;pathCells+=count;return;}
    if(name==='approximate'){const error=number(args[1]);if(error<0)vm.throwJava('Ljava/lang/IllegalArgumentException;','acceptableError must be greater than or equal to 0');if(!backend.pathApprox)fail('Original AOSP Path approximation Wasm is unavailable');const shape=builder.snapshot();let result;try{result=backend.pathApprox.approximate(shape.toCmds(),error);}finally{shape.delete();}vm.executionByOrigin.host.calls++;vm.record('HOST Path.approximate [original AOSP C++ Wasm / CanvasKit SkPath geometry]');const value=vm.newArray('[F',result.length);vm.array(value).elements=Array.from(result,x=>{bits.setFloat32(0,x,true);return bits.getInt32(0,true);});return value;}
    if(name==='isEmpty'){const shape=builder.snapshot();try{return shape.isEmpty()?1:0;}finally{shape.delete();}}
    if(name==='setFillType'){const index=vm.object(args[1]).fields.get('Landroid/graphics/Path$FillType;->nativeInt:I');if(!Number.isInteger(index)||index<0||index>3)fail('Path requires original FillType enum');builder.setFillType([CK.FillType.Winding,CK.FillType.EvenOdd,CK.FillType.InverseWinding,CK.FillType.InverseEvenOdd][index]);return;}
    if(name==='getFillType'){const shape=builder.snapshot();const index=shape.getFillType().value;shape.delete();const names=['WINDING','EVEN_ODD','INVERSE_WINDING','INVERSE_EVEN_ODD'],owner='Landroid/graphics/Path$FillType;',name=names[index];return vm.readStatic({owner,name,type:owner,key:`${owner}->${name}:${owner}`});}
    if(name==='addPath'){const shape=path(args[1]).builder.snapshot(),count=shape.countPoints();if(pathCells+count>1000000){shape.delete();fail('Aggregate Skia Path point limit exceeded');}builder.addPath(shape);shape.delete();pathCells+=count;return;}
    if(name==='addRoundRect'&&method.parameters[0]==='F'){const values=finite(args.slice(1,7).map(number)),direction=vm.object(args[7]).fields.get('Landroid/graphics/Path$Direction;->nativeInt:I');if(direction!==0&&direction!==1)fail('Path requires original Direction enum');const before=builder.countPoints();builder.addRRect(CK.RRectXY(values.slice(0,4),values[4],values[5]),direction===1);pathCells+=builder.countPoints()-before;if(pathCells>1000000)fail('Aggregate Skia Path point limit exceeded');return;}
    if(name==='addRoundRect'){
      const radii=vm.array(args[2]);if(radii.type!=='[F')vm.throwJava('Ljava/lang/ClassCastException;','Round rectangle radii require float[]');
      if(radii.elements.length<8)vm.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;','radii[] needs8values');
      const direction=vm.object(args[3]).fields.get('Landroid/graphics/Path$Direction;->nativeInt:I');if(direction!==0&&direction!==1)fail('Path requires original Direction enum');
      const before=builder.countPoints();builder.addRRect(new Float32Array([...rectF(args[1]),...finite(radii.elements.slice(0,8).map(number))]),direction===1);
      pathCells+=builder.countPoints()-before;if(pathCells>1000000)fail('Aggregate Skia Path point limit exceeded');return;
    }
    if(builder.countPoints()>100000)fail('Skia Path point limit exceeded');if(name==='close'){builder.close();return;}
    const before=builder.countPoints(),values=finite(args.slice(1).map(number));if(typeof builder[name]!=='function')fail('Unsupported Path operation '+name);builder[name](...values);pathCells+=Math.max(0,builder.countPoints()-before);if(pathCells>1000000)fail('Aggregate Skia Path point limit exceeded');return;
   }
   const state=canvasState(receiver),values=args.slice(1).map((value,index)=>method.parameters[index]==='F'?number(value):value);
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
   if(name==='save'||name==='saveLayer'){
    if(state.stack.length>=256)fail('Canvas save stack limit exceeded');const count=state.stack.length+1;
    if(name==='saveLayer'){finite(values.slice(0,4));const paint=args[5]?getSolidPaint(vm,args[5]):null;record(receiver,{op:'layerBegin',paint});}
    const flags=name==='save'&&method.parameters.length?args[1]:3;
    state.stack.push({matrix:state.matrix.slice(),clips:(state.clips??[]).slice(),saveMatrix:!!(flags&1),saveClips:!!(flags&2),layer:name==='saveLayer'});return count;
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
    const surface=CK.MakeSurface(state.width??411,state.height??840);try{const canvas=surface.getCanvas();applyClips(CK,canvas,state.clips);return canvas.quickReject(CK.LTRBRect(0,0,state.width??411,state.height??840))?0:1;}finally{surface.dispose();}
   }
   if(name==='drawColor'){record(receiver,{op:'color',color:args[1]});return;}
   const paint={...getSolidPaint(vm,args.at(-1)),nativeTypeface:resolveTypeface(getPaintState(vm,args.at(-1)).typefaceRef).face};
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
    const face=resolveTypeface(paint.typefaceRef);record(receiver,{op:'paragraphRun',text,runStart:start-cs,runEnd:end-cs,args:finite([number(args[6]),number(args[7])]),isRtl:!!args[8],paint:{...paint,weight:face.weight,italic:face.italic}});return;
   }
   if(name==='drawText'){let text=args[1],x,y;if(typeof text!=='string')fail('Canvas.drawText requires a String');if(method.parameters.length===6){const from=args[2],to=args[3];if(from<0||to<from||to>text.length)vm.throwJava('Ljava/lang/IndexOutOfBoundsException;','Text range');text=text.slice(from,to);x=number(args[4]);y=number(args[5]);}else{x=number(args[2]);y=number(args[3]);}if(text.length>65536)fail('Skia text run limit exceeded');record(receiver,{op:'text',text,args:finite([x,y]),paint});return;}
   const op={drawCircle:'circle',drawOval:'oval',drawRoundRect:'roundRect',drawLine:'line',drawPoint:'point'}[name];if(!op)fail('Unsupported Skia Canvas operation '+name);record(receiver,{op,args:finite(values.slice(0,-1)),paint});
  },
  };
 return host;
}
