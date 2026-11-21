import {APKError} from './apk-error.js?v=e3ff4f2e305f';
import {getPaintStateByHandle} from './paint-host.js?v=e3ff4f2e305f';

// The natives of android.graphics.text.MeasuredText, MeasuredText.Builder and LineBreaker (frameworks/base libs/hwui/jni/text/MeasuredText.cpp and LineBreaker.cpp,
// android-13.0.0_r1) over AOSP Minikin itself, compiled to wasm32 with HarfBuzz and ICU (src/minikin-provider.js, src/minikin-text.js): MeasuredTextBuilder, StyleRun /
// ReplacementRun, MeasuredText (widths, extents, bounds, memory usage) and StaticLayoutNative::computeBreaks with Minikin's greedy and optimal breakers, its WordBreaker
// over the ICU line iterator, tab stops, indents and justification. What hwui does around them is mirrored in lab/minikin-wrapper.cpp (prepareMinikinPaint, the rounding of
// nGetExtent / nGetBounds). The Java side keeps its original StaticLayout, MeasuredParagraph and LineBreaker code.
// Hyphenation: Minikin's Hyphenator needs the pattern files (hyph-*.hyb) a device ships in /system/usr/hyphen-data; the virtual device has none, so no locale has a
// hyphenator and computing hyphenation finds no point, as on a device without patterns for the locale (the frequency still sets the penalties).
const MT='Landroid/graphics/text/MeasuredText;',BUILDER=MT.slice(0,-1)+'$Builder;',LB='Landroid/graphics/text/LineBreaker;';
const REG='Llibcore/util/NativeAllocationRegistry;';
export const TEXT_LAYOUT_CLEANER='Lapkweb/bridge/TextLayoutCleaner;';
const FINALIZERS=new Map([[0x5445585401n,'measured'],[0x5445585402n,'breaker'],[0x5445585403n,'result']]);
const state=new WeakMap(),bits=new DataView(new ArrayBuffer(4));
const encode=n=>{bits.setFloat32(0,n,true);return bits.getInt32(0,true);};
const decode=n=>{bits.setInt32(0,n,true);return bits.getFloat32(0,true);};
const fail=message=>{throw new APKError(message,{kind:'text-layout-backend-unsupported',backend:'AOSP-Minikin-android-13.0.0_r1/Wasm'});};
const stateFor=r=>{if(!state.has(r))state.set(r,{next:0x5458000000n,handles:new Map()});return state.get(r);};
/** The Minikin text engine of the VM's Skia backend (one per backend, loaded on first use). */
const engine=r=>{const b=r.skia;if(typeof b?.minikinText!=='function')fail('Text layout requires the Skia backend with its Minikin text module');return b.minikinText('drawing');};
// A full table first asks for a collection: the handles of layouts whose Java owners are unreachable are released by their owners' cleaners (registerNativeAllocation below).
const allocate=(r,kind,value)=>{const s=stateFor(r);if(s.handles.size>=8192)r.collectForNativeHandles?.('handles de layout de texto');if(s.handles.size>=8192)fail('Text layout exceeds 8192 live handles');const h=s.next++;s.handles.set(h,{kind,...value});return h;};
const get=(r,h,kind)=>{const v=stateFor(r).handles.get(h);if(!v||v.kind!==kind)fail(`Invalid or released ${kind} text-layout token`);return v;};
const release=(r,h)=>{const s=stateFor(r),v=s.handles.get(h);if(!v)return;s.handles.delete(h);const e=v.engine;if(!e)return;if(v.kind==='measured')e.freeMeasured(v.pointer);else if(v.kind==='breaker')e.freeLineBreaker(v.pointer);};
const chars=(r,ref,length=null)=>{const a=r.array(ref);if(a.type!=='[C')fail('Text layout needs a char[] buffer');const count=length??a.elements.length;if(count>a.elements.length||count<0)fail('Text layout length exceeds its buffer');if(count>1<<20)fail('Text layout exceeds 2^20 UTF-16 code units');const cells=a.cells;let text='';for(let i=0;i<count;i+=8192)text+=String.fromCharCode(...(ArrayBuffer.isView(cells)?cells.subarray(i,Math.min(count,i+8192)):cells.slice(i,Math.min(count,i+8192))));return text;};
const bounds=(m,start,end)=>{if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>m.length)fail('Invalid measured-text UTF16 range');};
/** The paint state hwui's Paint would hold at nAddStyleRun (MeasuredText keeps what it was built with: later Paint changes do not reach it) and the Typeface's state. */
function paintSnapshot(r,handle){
 const p={...getPaintStateByHandle(r,handle)},info=r.skiaHost.resolveTypeface(p.typefaceRef);
 if(![p.textSize,p.textScaleX,p.textSkewX,p.letterSpacing,p.wordSpacing].every(Number.isFinite)||p.textSize<0||p.textSize>4096)fail('Paragraph font state requires finite values and a text size in 0..4096');
 return{paint:p,info};
}

/** Original Android Java keeps the builder, range, span and layout algorithms; these JNI boundaries run AOSP Minikin. Every returned long is a checked VM token. */
export function createTextLayoutNativeBindings(){
 const out=new Map(),add=(owner,name,p,result,fn)=>out.set(`${owner}->${name}(${p.join('')})${result}`,(r,a)=>{const answer=fn(r,a.map((v,i)=>p[i]==='F'?decode(v):v));return result==='F'?encode(answer):answer;});
 add(MT,'nGetReleaseFunc',[],'J',()=>0x5445585401n);add(LB,'nGetReleaseFunc',[],'J',()=>0x5445585402n);add(LB,'nGetReleaseResultFunc',[],'J',()=>0x5445585403n);
 // The builder's runs are kept here until nBuildMeasuredText: the font collection of a run depends on the code points it covers (src/minikin-text.js).
 add(BUILDER,'nInitBuilder',[],'J',r=>allocate(r,'builder',{runs:[]}));
 add(BUILDER,'nAddStyleRun',['J','J','I','I','I','I','Z'],'V',(r,[h,p,style,word,start,end,rtl])=>{
  const b=get(r,h,'builder');if(b.runs.length>=65536)fail('Measured text exceeds 65536 style runs');
  if(![0,1,2,3].includes(style)||![0,1].includes(word))fail(`Invalid line-break configuration (lineBreakStyle=${style} wordStyle=${word})`);
  const snapshot=paintSnapshot(r,p);
  // LineBreakConfig.LINE_BREAK_WORD_STYLE_PHRASE: Minikin asks ICU for the phrase-based rules (the lw=phrase locale keyword), which exist for Japanese and Korean text and are
  // an Android addition to ICU 70; the ICU of the virtual device is the upstream release without them, which would ignore the keyword. For any other locale the word style
  // changes nothing, as on a device.
  if(word===1&&/^(ja|ko)\b/i.test(snapshot.paint.textLocaleTag??'en-US'))fail('LineBreakConfig.LINE_BREAK_WORD_STYLE_PHRASE for Japanese or Korean text needs the phrase-based line-break rules of Android\'s ICU (lw=phrase), which the ICU 70.1 of the virtual device does not have');
  b.runs.push({type:'style',...snapshot,lineBreakStyle:style,lineBreakWordStyle:word,start,end,rtl:!!rtl});
 });
 add(BUILDER,'nAddReplacementRun',['J','J','I','I','F'],'V',(r,[h,p,start,end,width])=>{
  const b=get(r,h,'builder');if(b.runs.length>=65536)fail('Measured text exceeds 65536 style runs');
  b.runs.push({type:'replacement',locale:getPaintStateByHandle(r,p).textLocaleTag??'',start,end,width});
 });
 add(BUILDER,'nBuildMeasuredText',['J','J','[C','Z','Z','Z'],'J',(r,[h,hint,buffer,hyphenation,layout,fast])=>{
  const b=get(r,h,'builder'),text=chars(r,buffer),e=engine(r),hintPointer=hint?get(r,hint,'measured').pointer:0;
  for(const run of b.runs)if(!Number.isInteger(run.start)||!Number.isInteger(run.end)||run.start<0||run.end<run.start||run.end>text.length)fail('Measured-text run range is outside the text');
  const native=e.builder();let pointer;
  try{
   for(const run of b.runs){
    if(run.type==='style')e.addStyleRun(native,run.paint,run.info,text,run.lineBreakStyle,run.lineBreakWordStyle,run.start,run.end,run.rtl);
    else e.addReplacementRun(native,run.locale,run.start,run.end,run.width);
   }
   pointer=e.build(native,text,{hyphenation:!!hyphenation,layout:!!layout,fast:!!fast,hint:hintPointer});
  }finally{e.freeBuilder(native);}
  try{return allocate(r,'measured',{engine:e,pointer,length:text.length});}catch(error){e.freeMeasured(pointer);throw error;}
 });
 add(BUILDER,'nFreeBuilder',['J'],'V',(r,[h])=>{get(r,h,'builder');release(r,h);});
 add(MT,'nGetWidth',['J','I','I'],'F',(r,[h,start,end])=>{const m=get(r,h,'measured');bounds(m,start,end);return m.engine.width(m.pointer,start,end);});
 add(MT,'nGetCharWidthAt',['J','I'],'F',(r,[h,index])=>{const m=get(r,h,'measured');bounds(m,index,index+1);return m.engine.charWidth(m.pointer,index);});
 add(MT,'nGetMemoryUsage',['J'],'I',(r,[h])=>{const m=get(r,h,'measured');return m.engine.memoryUsage(m.pointer);});
 add(MT,'nGetExtent',['J','[C','I','I'],'J',(r,[h,buffer,start,end])=>{
  const m=get(r,h,'measured'),text=chars(r,buffer);bounds(m,start,end);if(text.length<m.length)fail('Measured-text character buffer is shorter than its text');
  const f=m.engine.extent(m.pointer,text,start,end);return(BigInt(f.ascent)<<32n)|BigInt.asUintN(32,BigInt(f.descent));
 });
 add(MT,'nGetBounds',['J','[C','I','I','Landroid/graphics/Rect;'],'V',(r,[h,buffer,start,end,rect])=>{
  const m=get(r,h,'measured'),text=chars(r,buffer);bounds(m,start,end);if(text.length<m.length)fail('Measured-text character buffer is shorter than its text');
  const values=m.engine.bounds(m.pointer,text,start,end);for(const [i,name]of ['left','top','right','bottom'].entries())r.storeField(r.object(rect).fields,`Landroid/graphics/Rect;->${name}:I`,values[i]);
 });
 add(LB,'nInit',['I','I','Z','[I'],'J',(r,[strategy,hyphenation,justify,indents])=>{
  if(![0,1,2].includes(strategy)||![0,1,2].includes(hyphenation))fail('Invalid line-break strategy or hyphenation frequency');
  const e=engine(r),list=indents?Array.from(r.array(indents).elements,v=>v|0):[];
  return allocate(r,'breaker',{engine:e,pointer:e.lineBreaker(strategy,hyphenation,!!justify,list)});
 });
 add(LB,'nComputeLineBreaks',['J','[C','J','I','F','I','F','[F','F','I'],'J',(r,[h,buffer,mh,length,first,count,rest,tabs,defaultTab,indentsOffset])=>{
  const breaker=get(r,h,'breaker'),m=get(r,mh,'measured');
  if(!Number.isInteger(length)||length<0||length>m.length)fail('LineBreaker length exceeds its measured text');
  if(![first,rest,defaultTab].every(Number.isFinite))fail('Line-break widths and tab stop must be finite');
  const text=chars(r,buffer,length),tabStops=tabs?Array.from(r.array(tabs).elements,v=>decode(v|0)):null;
  return allocate(r,'result',{lines:breaker.engine.computeLineBreaks(breaker.pointer,text,m.pointer,{firstWidth:first,firstWidthLineCount:count,restWidth:rest,tabStops,defaultTabStop:defaultTab,indentsOffset})});
 });
 add(LB,'nGetLineCount',['J'],'I',(r,[h])=>get(r,h,'result').lines.length);
 for(const[name,key,type]of [['nGetLineBreakOffset','offset','I'],['nGetLineWidth','width','F'],['nGetLineAscent','ascent','F'],['nGetLineDescent','descent','F'],['nGetLineFlag','flags','I']])add(LB,name,['J','I'],type,(r,[h,index])=>{const lines=get(r,h,'result').lines;if(!Number.isInteger(index)||index<0||index>=lines.length)fail('Line-break result index is out of bounds');return lines[index][key];});
 return out;
}

/**
 * The lines of a TextView's text under Layout.BREAK_STRATEGY_HIGH_QUALITY / BALANCED at `width` (one entry per line, line-end spaces dropped), paragraph by paragraph like
 * StaticLayout, through Minikin's MeasuredText and LineBreaker. The paint is the TextView's (its face, size and letter spacing); the lab's TextView draws the lines with the
 * Skia paragraph at the full text size, so the size is measured whole (LINEAR_TEXT_FLAG) rather than truncated as an unflagged Paint would be.
 */
export function breakParagraphs(r,text,style,width,strategy,frequency){
 const e=engine(r),out=[],info=style.face??{weight:style.weight??400,italic:!!style.italic};
 const paint={textSize:style.textSize,textScaleX:1,textSkewX:0,letterSpacing:style.letterSpacing??0,wordSpacing:0,flags:0x1|0x40|0x100,hinting:0,textLocaleTag:style.locale??'en-US',hyphenEdit:0};
 for(const paragraph of text.split('\n')){
  if(!paragraph){out.push('');continue;}
  const native=e.builder();let measured=0,breaker=0;
  try{
   e.addStyleRun(native,paint,info,paragraph,0,0,0,paragraph.length,false);measured=e.build(native,paragraph);
   breaker=e.lineBreaker(strategy,frequency,false,[]);
   const lines=e.computeLineBreaks(breaker,paragraph,measured,{firstWidth:width,firstWidthLineCount:0,restWidth:width});
   let from=0;for(const line of lines){out.push(paragraph.slice(from,line.offset).replace(/[   -  -  　]+$/,''));from=line.offset;}
  }finally{e.freeBuilder(native);if(measured)e.freeMeasured(measured);if(breaker)e.freeLineBreaker(breaker);}
 }
 return out;
}

/** A registered native allocation is released when its referent is collected, or earlier when the returned Runnable is run; release is idempotent. */
export function textLayoutRegistryBridge(r,method,args){
 if(method.owner===REG&&method.name==='createMalloced'&&method.signature===`(Ljava/lang/ClassLoader;J)${REG}`&&FINALIZERS.has(args[1])){
  const value=r.makeObject(REG),object=r.object(value);object.textLayoutKind=FINALIZERS.get(args[1]);r.storeField(object.fields,`${REG}->freeFunction:J`,args[1]);return{value};
 }
 if(method.owner===REG&&method.name==='registerNativeAllocation'&&method.signature==='(Ljava/lang/Object;J)Ljava/lang/Runnable;'){
  const registry=r.object(args[0]);if(!registry.textLayoutKind)return null;r.object(args[1]);get(r,args[2],registry.textLayoutKind);
  const handle=args[2],referent=r.object(args[1]),previous=referent.onFree;referent.onFree=()=>{if(typeof previous==='function')previous();release(r,handle);};/* NativeAllocationRegistry: the native allocation is freed when the referent is collected (or earlier, by the returned Runnable) */
  const value=r.makeObject(TEXT_LAYOUT_CLEANER);r.object(value).textLayoutCleanup=args[2];return{value};
 }
 if(method.name==='run'&&method.signature==='()V'&&args[0]&&r.object(args[0]).type===TEXT_LAYOUT_CLEANER){const cleaner=r.object(args[0]);if(cleaner.textLayoutCleanup){release(r,cleaner.textLayoutCleanup);cleaner.textLayoutCleanup=0n;}return{value:undefined};}
 return null;
}
export function disposeTextLayout(r){for(const h of [...stateFor(r).handles.keys()])release(r,h);}
