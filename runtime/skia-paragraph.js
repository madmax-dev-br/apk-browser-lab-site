import { APKError } from './apk-runtime.js?v=7fd72513c4ea';

const fail = message => { throw new APKError(message, { kind: 'skia-paragraph-unsupported' }); };
const fontWeightOf = (CK, weight) => { if(!Number.isInteger(weight)||weight<0||weight>1000)fail('Font weight must be in [0,1000]'); return Object.values(CK.FontWeight).find(value=>value?.value===weight)??{value:weight}; };
/** Minikin-style font itemization (Android 13 fallback chain) for text Roboto alone cannot shape; null keeps the Roboto-only path. */
const itemizeFonts = (backend, text, weight, italic) => backend.fallback?.itemize(text, { weight, italic }) ?? null;
const makeParagraphBuilder = (backend, CK, paragraphStyle, itemized) => itemized ? backend.fallback.makeBuilder(paragraphStyle) : CK.ParagraphBuilder.Make(paragraphStyle, backend.fontManager);
const addParagraphText = (backend, builder, text, textStyle, itemized) => backend.fallback.addRuns(builder, text, textStyle, itemized);
/** Code points a shaper reports as unresolved although no glyph is drawn for them (default ignorables, layout controls). */
const drawable = codepoint => !(codepoint === 0xad || codepoint === 0x34f || codepoint === 0x61c || (codepoint >= 0x200b && codepoint <= 0x200f) || (codepoint >= 0x202a && codepoint <= 0x202e) || (codepoint >= 0x2060 && codepoint <= 0x206f) || codepoint === 0xfeff || (codepoint >= 0xfe00 && codepoint <= 0xfe0f) || (codepoint >= 0xe0100 && codepoint <= 0xe01ef) || codepoint === 10 || codepoint === 13 || codepoint === 9);
const unresolved = paragraph => paragraph.unresolvedCodepoints().filter(drawable);
const base64 = bytes => { let binary = ''; for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384)); return btoa(binary); };

/** Original SkParagraph CPU implementation from the verified CanvasKit bundle.
 * This is an explicit web text backend, not Android StaticLayout/Minikin. No OS
 * fonts, character-width estimates, or silently substituted glyphs are used.
 */
export function measureSkiaParagraph(backend, text, { width, textSize = 14, weight = 400, italic = false, direction = 0, color = 0xff000000, maxLines = null, raster = false, alignment = 'start' } = {}) {
  if (typeof text !== 'string' || text.length > 65536) fail('Paragraph text exceeds 65536 characters');
  if (!Number.isFinite(width) || width <= 0 || width > 4096 || !Number.isFinite(textSize) || textSize <= 0 || textSize > 512) fail('Paragraph extent exceeds the web text backend limits');
  if (maxLines !== null && (!Number.isInteger(maxLines) || maxLines < 1)) fail('Paragraph maxLines must be a positive integer');
  if (!['start','left','right','center'].includes(alignment)) fail('Unsupported paragraph alignment');
  if (![0, 1].includes(direction)) fail('Invalid paragraph direction');
  const CK = backend?.CanvasKit;
  if (!CK?.ParagraphBuilder || !backend.fontManager) fail('Verified Skia ParagraphBuilder and font manager are required');
  backend.selectTypeface(weight, italic); // Reject unavailable faces before SkParagraph fallback selection.
  if (CK.ParagraphBuilder.RequiresClientICU()) fail('This Skia build requires external Unicode segmentation data');
  const fontWeight = fontWeightOf(CK, weight);
  const argb = color >>> 0;
  const textStyle = { color: CK.Color(argb >>> 16 & 255, argb >>> 8 & 255, argb & 255, (argb >>> 24) / 255), fontFamilies: ['Roboto'], fontSize: textSize,
    fontStyle: { weight: fontWeight, width: CK.FontWidth.Normal, slant: italic ? CK.FontSlant.Italic : CK.FontSlant.Upright } };
  const style = new CK.ParagraphStyle({ ...(maxLines === null ? {} : { maxLines }), textDirection: direction ? CK.TextDirection.RTL : CK.TextDirection.LTR, textAlign: {start:CK.TextAlign.Start,left:CK.TextAlign.Left,right:CK.TextAlign.Right,center:CK.TextAlign.Center}[alignment], textStyle });
  const itemized = itemizeFonts(backend, text, weight, italic);
  let builder, paragraph;
  try {
    builder = makeParagraphBuilder(backend, CK, style, itemized);
    if (!builder) fail('Skia paragraph allocation failed');
    if (itemized) addParagraphText(backend, builder, text, textStyle, itemized); else builder.addText(text);
    paragraph = builder.build(); paragraph.layout(width);
    const missing = unresolved(paragraph);
    if (missing.length) fail('The supplied Roboto fonts lack paragraph glyphs: ' + missing.slice(0, 8).map(codepoint => 'U+' + codepoint.toString(16)).join(', '));
    const lines = paragraph.getLineMetrics().map(line => ({ ...line }));
    if (lines.length > 1024) fail('Paragraph exceeds 1024 lines');
    const height = paragraph.getHeight();
    if (!Number.isFinite(height) || height < 0 || height > 65536) fail('Invalid or excessive paragraph height');
    const result = { width: Math.min(width, Math.max(0, paragraph.getLongestLine())), layoutWidth: width, height,
      baseline: lines[0]?.baseline ?? paragraph.getAlphabeticBaseline(), lineCount: paragraph.getNumberOfLines(), lines,
      intrinsicWidth: paragraph.getMaxIntrinsicWidth(), maxLines, exceededMaxLines: paragraph.didExceedMaxLines(), source: 'official-Skia-SkParagraph/Roboto', scope: 'SkParagraph web backend; not Android StaticLayout/Minikin' };
    if (raster && height > 0) {
      const rasterWidth = Math.max(1, Math.ceil(width)), rasterHeight = Math.max(1, Math.ceil(height));
      if (rasterHeight > 4096 || rasterWidth * rasterHeight > 4 * 1024 * 1024) fail('Paragraph raster exceeds4096px/4Mpixel VM limit');
      const surface = CK.MakeSurface(rasterWidth, rasterHeight);
      if (!surface) fail('Skia paragraph raster allocation failed');
      let image;
      try {
        const canvas = surface.getCanvas(); canvas.clear(CK.TRANSPARENT); canvas.drawParagraph(paragraph, 0, 0); surface.flush();
        image = surface.makeImageSnapshot(); const bytes = image.encodeToBytes();
        if (!bytes || bytes.length > 8 * 1024 * 1024) fail('Invalid or excessive paragraph PNG');
        result.raster = { kind: 'raster', dataURL: 'data:image/png;base64,' + base64(bytes), width: rasterWidth, height: rasterHeight };
      } finally { image?.delete(); surface.dispose(); }
    }
    return result;
  } finally { paragraph?.delete(); builder?.delete(); }
}

/** A single complete LTR run, shaped with original SkParagraph/SkShaper.
 * Partial shaping items, bidi/complex-script boundaries and Android Minikin
 * hyphen edits remain explicit gaps; slicing context and estimating widths
 * would change kerning and cluster advances.
 */
export function measureSkiaRun(backend,text,{isRtl=false,start=0,offset=text.length,textSize=12,weight=400,italic=false,letterSpacing=0,wordSpacing=0,textScaleX=1,hinting=1,flags=0x503,textLocaleTag='en-US'}={}){
  if(typeof text!=='string'||text.length>65536||/[\u0000-\u001f]/.test(text))fail('Run advance currently requires a complete single-line shaping run without control characters');
  if(!Number.isInteger(offset)||offset<0||offset>text.length||!Number.isInteger(start)||start<0||start>offset)fail('Invalid UTF16 run offset');
  if(![textSize,letterSpacing,wordSpacing,textScaleX].every(Number.isFinite)||textSize<0||textSize>512||textScaleX<0||textScaleX>16)fail('Run advance font state exceeds backend limits');
  if(flags&0x20||flags&0x800)fail('Run advance requires a backend for synthetic bold/forced auto-hinting');
  if(!text.length||textSize===0||textScaleX===0)return 0;
  const CK=backend.CanvasKit;if(CK.ParagraphBuilder.RequiresClientICU())fail('Run shaping requires original ICU segmentation support');
  backend.selectTypeface(weight,italic);
  const fontWeight=fontWeightOf(CK,weight);
  let builder,paragraph;
  const textStyle={fontFamilies:['Roboto'],fontSize:textSize,locale:textLocaleTag,fontStyle:{weight:fontWeight,width:CK.FontWidth.Normal,slant:italic?CK.FontSlant.Italic:CK.FontSlant.Upright},
        letterSpacing:letterSpacing*textSize,wordSpacing,fontFeatures:[{name:'kern',value:flags&0x100?1:0}]},itemized=itemizeFonts(backend,text,weight,italic);
  try{
    builder=makeParagraphBuilder(backend,CK,new CK.ParagraphStyle({textDirection:isRtl?CK.TextDirection.RTL:CK.TextDirection.LTR,textAlign:CK.TextAlign.Left,disableHinting:hinting===0,textStyle}),itemized);
    if(itemized)addParagraphText(backend,builder,text,textStyle,itemized);else builder.addText(text);paragraph=builder.build();paragraph.layout(Math.max(4096,textSize*(text.length+1)*4+Math.abs(letterSpacing*textSize+wordSpacing)*(text.length+1)));
    const missing=unresolved(paragraph);if(missing.length)fail('Run font lacks glyphs: '+missing.slice(0,8).map(code=>'U+'+code.toString(16)).join(','));
    if(paragraph.getNumberOfLines()!==1)fail('Run shaping unexpectedly produced multiple lines');
    const boxes=paragraph.getRectsForRange(start,offset,CK.RectHeightStyle.Tight,CK.RectWidthStyle.Tight);
    let advance=0;for(const box of boxes)advance+=box.rect[2]-box.rect[0];
    if(!Number.isFinite(advance))fail('SkParagraph returned a non-finite run advance');
    return Math.fround(advance*textScaleX);
  }finally{paragraph?.delete();builder?.delete();}
}

/** Paint.measureText for a complete single line that Roboto's simple glyph run cannot represent (complex scripts, emoji, symbols, CJK,
 * combining marks, letter/word spacing): itemized through the Android fallback chain and shaped run by run by SkParagraph/HarfBuzz.
 * Returns the advance, the glyph count and the font metrics of every font used (Minikin extents are the union over the fonts of a run). */
export function measureSkiaShapedText(backend,text,{isRtl=false,textSize=12,weight=400,italic=false,letterSpacing=0,wordSpacing=0,textScaleX=1,hinting=1,flags=0x503,textLocaleTag='en-US'}={}){
  if(typeof text!=='string'||text.length>65536||/[\u0000-\u001f]/.test(text))fail('Shaped text measurement needs one line without control characters');
  if(![textSize,letterSpacing,wordSpacing,textScaleX].every(Number.isFinite)||textSize<0||textSize>512||textScaleX<0||textScaleX>16)fail('Shaped text font state exceeds backend limits');
  if(flags&0x20||flags&0x800)fail('Shaped text needs a backend for synthetic bold/forced auto-hinting');
  if(!text.length||textSize===0||textScaleX===0)return{width:0,glyphCount:0,fontMetrics:[]};
  const CK=backend.CanvasKit;if(CK.ParagraphBuilder.RequiresClientICU())fail('Run shaping requires original ICU segmentation support');
  backend.selectTypeface(weight,italic);
  const textStyle={fontFamilies:['Roboto'],fontSize:textSize,locale:textLocaleTag,fontStyle:{weight:fontWeightOf(CK,weight),width:CK.FontWidth.Normal,slant:italic?CK.FontSlant.Italic:CK.FontSlant.Upright},
    letterSpacing:letterSpacing*textSize,wordSpacing,fontFeatures:[{name:'kern',value:flags&0x100?1:0}]},itemized=itemizeFonts(backend,text,weight,italic);
  let builder,paragraph;
  try{
    builder=makeParagraphBuilder(backend,CK,new CK.ParagraphStyle({textDirection:isRtl?CK.TextDirection.RTL:CK.TextDirection.LTR,textAlign:CK.TextAlign.Left,disableHinting:hinting===0,textStyle}),itemized);
    if(itemized)addParagraphText(backend,builder,text,textStyle,itemized);else builder.addText(text);
    paragraph=builder.build();paragraph.layout(Math.max(4096,textSize*(text.length+1)*4+Math.abs(letterSpacing*textSize+wordSpacing)*(text.length+1)));
    const missing=unresolved(paragraph);if(missing.length)fail('Run font lacks glyphs: '+missing.slice(0,8).map(code=>'U+'+code.toString(16)).join(','));
    if(paragraph.getNumberOfLines()!==1)fail('Run shaping unexpectedly produced multiple lines');
    let advance=0;for(const box of paragraph.getRectsForRange(0,text.length,CK.RectHeightStyle.Tight,CK.RectWidthStyle.Tight))advance+=box.rect[2]-box.rect[0];
    if(!Number.isFinite(advance))fail('SkParagraph returned a non-finite run advance');
    const fontMetrics=[];let glyphCount=0;
    for(const line of paragraph.getShapedLines())for(const run of line.runs){
      glyphCount+=run.glyphs.length;const font=new CK.Font(run.typeface,run.size);try{fontMetrics.push(font.getMetrics());}finally{font.delete();run.typeface.delete();}
    }
    return{width:Math.fround(advance*textScaleX),glyphCount,fontMetrics};
  }finally{paragraph?.delete();builder?.delete();}
}

/** Ink bounds of an actual shaped Latin glyph run; no character-box estimate. */
export function measureSkiaTextBounds(backend,text,state={}){
  // The run validator establishes the same installed font/script/state contract.
  measureSkiaRun(backend,text,{...state,offset:0});
  if(!text.length||state.textSize===0||state.textScaleX===0)return[0,0,0,0];
  const CK=backend.CanvasKit,textSize=state.textSize??12,scaleX=state.textScaleX??1;
  const weight=fontWeightOf(CK,state.weight??400);
  let builder,paragraph;
  const textStyle={fontFamilies:['Roboto'],fontSize:textSize,locale:state.textLocaleTag??'en-US',fontStyle:{weight,width:CK.FontWidth.Normal,slant:state.italic?CK.FontSlant.Italic:CK.FontSlant.Upright},
        letterSpacing:(state.letterSpacing??0)*textSize,wordSpacing:state.wordSpacing??0,fontFeatures:[{name:'kern',value:state.flags&0x100?1:0}]},itemized=itemizeFonts(backend,text,state.weight??400,!!state.italic);
  try{
    builder=makeParagraphBuilder(backend,CK,new CK.ParagraphStyle({textDirection:CK.TextDirection.LTR,textAlign:CK.TextAlign.Left,disableHinting:state.hinting===0,textStyle}),itemized);
    if(itemized)addParagraphText(backend,builder,text,textStyle,itemized);else builder.addText(text);paragraph=builder.build();paragraph.layout(Math.max(4096,textSize*(text.length+1)*4+Math.abs((state.letterSpacing??0)*textSize+(state.wordSpacing??0))*(text.length+1)));
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    for(const line of paragraph.getShapedLines())for(const run of line.runs){
      const font=new CK.Font(run.typeface,run.size);try{
        font.setScaleX((run.scaleX??1)*scaleX);font.setSkewX(state.textSkewX??0);font.setHinting(state.hinting===0?CK.FontHinting.None:CK.FontHinting.Normal);
        font.setLinearMetrics(!!(state.flags&0x40));font.setSubpixel(!!(state.flags&0x80));font.setEmbeddedBitmaps(!!(state.flags&0x400));
        const bounds=font.getGlyphBounds(run.glyphs);
        for(let i=0;i<run.glyphs.length;i++){
          const box=Array.from(bounds.slice(4*i,4*i+4));if(box.every(value=>value===0))continue;
          const x=run.positions[2*i]*scaleX,y=run.positions[2*i+1]-line.baseline;
          left=Math.min(left,x+box[0]);top=Math.min(top,y+box[1]);right=Math.max(right,x+box[2]);bottom=Math.max(bottom,y+box[3]);
        }
      }finally{font.delete();run.typeface.delete();}
    }
    return left===Infinity?[0,0,0,0]:[Math.floor(left),Math.floor(top),Math.ceil(right),Math.ceil(bottom)];
  }finally{paragraph?.delete();builder?.delete();}
}

/** Shape the complete context with original SkParagraph/ICU, then draw its
 * actual glyph IDs/positions. UTF16 ranges map to UTF8 cluster offsets; splitting
 * a cluster and partial RTL origins remain explicit unsupported boundaries. */
export function drawSkiaTextRun(backend,canvas,text,x,y,state={},isRtl=false,paint=null,{start=0,end=text.length}={}){
 const CK=backend.CanvasKit;
 if(typeof text!=='string'||text.length>65536||/[\r\n\t]/.test(text))fail('Recorded text needs one bounded shaping item');
 if(text.isWellFormed&&!text.isWellFormed())fail('Ill-formed UTF16 text requires a lossless native text boundary');
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>text.length)fail('Invalid shaping item draw range');
 if(state.hyphenEdit||state.flags&0x20||state.flags&0x800)fail('Recorded text synthetic-bold/force-autohint/hyphen state needs a native Minikin draw boundary');
 const size=state.textSize??12,scale=state.textScaleX??1,skew=state.textSkewX??0;
 if(![size,scale,skew].every(Number.isFinite)||size<0||size>512||Math.abs(scale)>16||Math.abs(skew)>16)fail('Recorded text font state exceeds limits');
 if(start===end||!size||!scale)return;
 const weight=state.weight??400,italic=!!state.italic;backend.selectTypeface(weight,italic);
 const style={fontFamilies:['Roboto'],fontSize:size,locale:state.textLocaleTag??'en-US',fontStyle:{weight:fontWeightOf(CK,weight),width:CK.FontWidth.Normal,slant:italic?CK.FontSlant.Italic:CK.FontSlant.Upright},letterSpacing:(state.letterSpacing??0)*size,wordSpacing:state.wordSpacing??0,fontFeatures:[{name:'kern',value:state.flags&0x100?1:0}]};
 let builder,paragraph,shapedLines;const itemized=itemizeFonts(backend,text,weight,italic);
 try{builder=makeParagraphBuilder(backend,CK,new CK.ParagraphStyle({textDirection:isRtl?CK.TextDirection.RTL:CK.TextDirection.LTR,textAlign:CK.TextAlign.Left,disableHinting:state.hinting===0,textStyle:style}),itemized);if(itemized)addParagraphText(backend,builder,text,style,itemized);else builder.addText(text);paragraph=builder.build();paragraph.layout(Math.max(4096,size*(text.length+1)*4+Math.abs((state.letterSpacing??0)*size+(state.wordSpacing??0))*(text.length+1)));
  const missing=unresolved(paragraph);if(missing.length)fail('Recorded text font lacks glyphs: '+missing.slice(0,8).map(c=>'U+'+c.toString(16)).join(','));
  const lines=shapedLines=paragraph.getShapedLines();if(lines.length!==1)fail('Recorded shaping item unexpectedly wraps');const line=lines[0],encoder=new TextEncoder(),from=encoder.encode(text.slice(0,start)).length,to=encoder.encode(text.slice(0,end)).length,clusters=new Set([0,encoder.encode(text).length]);for(const run of line.runs)for(const offset of run.offsets)clusters.add(offset);
  if(!clusters.has(from)||!clusters.has(to))fail('Draw range splits a shaped glyph cluster; native Minikin cluster slicing is required');
  const selected=line.runs.map(run=>{const glyphs=[],positions=[];for(let i=0;i<run.glyphs.length;i++)if(run.offsets[i]>=from&&run.offsets[i]<to){glyphs.push(run.glyphs[i]);positions.push(run.positions[i*2],run.positions[i*2+1]-line.baseline);}return{run,glyphs,positions};}).filter(v=>v.glyphs.length);
  if(!selected.length)return;const origin=start===0&&!isRtl||start===0&&end===text.length?0:Math.min(...selected.flatMap(v=>v.positions.filter((_,i)=>!(i&1))))-(state.letterSpacing??0)*size/2;let decorationMetrics=null;
  canvas.save();try{canvas.translate(x,y);canvas.scale(scale,1);for(const{run,glyphs,positions}of selected){const font=new CK.Font(run.typeface,run.size);try{font.setScaleX(run.scaleX);font.setSkewX(skew);font.setLinearMetrics(!!(state.flags&0x40));font.setSubpixel(!!(state.flags&0x80));font.setEmbeddedBitmaps(!!(state.flags&0x400));font.setEdging(state.flags&1?CK.FontEdging.AntiAlias:{value:0});font.setHinting(state.hinting===0?CK.FontHinting.None:CK.FontHinting.Normal);decorationMetrics??=font.getMetrics();canvas.drawGlyphs(glyphs,positions.map((v,i)=>i&1?v:v-origin),0,0,font,paint);
   }finally{font.delete();}}
    if(state.flags&0x18){const metrics=decorationMetrics,boxes=paragraph.getRectsForRange(start,end,CK.RectHeightStyle.Tight,CK.RectWidthStyle.Tight),advance=boxes.reduce((n,v)=>n+v.rect[2]-v.rect[0],0),decoration=paint.copy();decoration.setStyle(CK.PaintStyle.Fill);if(state.flags&8)canvas.drawRect(CK.XYWHRect(0,metrics.underlinePosition,advance,metrics.underlineThickness),decoration);if(state.flags&16)canvas.drawRect(CK.XYWHRect(0,metrics.strikeoutPosition,advance,metrics.strikeoutThickness),decoration);decoration.delete();}
   }finally{canvas.restore();}
 }finally{for(const line of shapedLines??[])for(const run of line.runs)run.typeface.delete();paragraph?.delete();builder?.delete();}
}
