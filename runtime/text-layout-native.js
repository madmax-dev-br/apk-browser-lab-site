import {APKError} from './apk-error.js?v=5baf5691b052';
import {getPaintStateByHandle} from './paint-host.js?v=5baf5691b052';
import {androidCharacterDirectionality} from './unicode-bidi-data.js?v=5baf5691b052';

const MT='Landroid/graphics/text/MeasuredText;',BUILDER=MT.slice(0,-1)+'$Builder;',LB='Landroid/graphics/text/LineBreaker;';
const REG='Llibcore/util/NativeAllocationRegistry;';
export const TEXT_LAYOUT_CLEANER='Lapkweb/bridge/TextLayoutCleaner;';
const FINALIZERS=new Map([[0x5445585401n,'measured'],[0x5445585402n,'breaker'],[0x5445585403n,'result']]);
const state=new WeakMap(),bits=new DataView(new ArrayBuffer(4));
const encode=n=>{bits.setFloat32(0,n,true);return bits.getInt32(0,true);};
const decode=n=>{bits.setInt32(0,n,true);return bits.getFloat32(0,true);};
const fail=message=>{throw new APKError(message,{kind:'text-layout-backend-unsupported',backend:'official-Skia-SkParagraph/CPU',scope:'Installed-font LTR, simple breaks, no hyphenation'});};
const stateFor=r=>{if(!state.has(r))state.set(r,{next:0x5458000000n,handles:new Map()});return state.get(r);};
const backend=r=>{const b=r.skia;if(!b?.CanvasKit?.ParagraphBuilder||!b.fontManager)fail('Text layout requires the verified SkParagraph CPU backend');if(b.CanvasKit.ParagraphBuilder.RequiresClientICU())fail('SkParagraph requires unavailable Unicode segmentation data');return b;};
const allocate=(r,kind,value)=>{const s=stateFor(r);if(s.handles.size>=8192)fail('Text layout exceeds8192 live handles');const h=s.next++;s.handles.set(h,{kind,...value});return h;};
const get=(r,h,kind)=>{const v=stateFor(r).handles.get(h);if(!v||v.kind!==kind)fail(`Invalid or released ${kind} text-layout token`);return v;};
const release=(r,h)=>{const s=stateFor(r),v=s.handles.get(h);if(v){v.paragraph?.delete();s.handles.delete(h);}};
const chars=(r,ref)=>{const a=r.array(ref);if(a.type!=='[C'||a.elements.length>65536)fail('Text layout requires at most65536 UTF16 code units');let text='';for(let i=0;i<a.elements.length;i+=8192)text+=String.fromCharCode(...a.elements.slice(i,i+8192));return text;};
const validateText=text=>{
 const rejected=[];
 for(const char of text){const cp=char.codePointAt(0),dir=androidCharacterDirectionality(cp);
  if((cp<0x20&&cp!==10)||cp===0x7f||!/^[^\p{Mark}]$/u.test(char)||![0,3,4,5,7,9,10,12,13].includes(dir))rejected.push('U+'+cp.toString(16).toUpperCase());
 }
 if(rejected.length)fail('LTR text layout does not support RTL, combining marks, tabs or control runs: '+[...new Set(rejected)].slice(0,8).join(','));
};
const bounds=(m,start,end)=>{if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>m.text.length)fail('Invalid measured-text UTF16 range');};
function paintSnapshot(r,handle){
 const p={...getPaintStateByHandle(r,handle)},face=r.skiaHost.resolveTypeface(p.typefaceRef);
 if(![p.textSize,p.textScaleX,p.textSkewX,p.letterSpacing,p.wordSpacing].every(Number.isFinite)||p.textSize<0||p.textSize>512||p.textScaleX!==1||p.textSkewX!==0)fail('Paragraph font state requires finite size0..512, scaleX1 and skewX0');
 if(p.flags&0x20||p.flags&0x800||p.hyphenEdit)fail('Paragraph synthetic bold, forced auto-hinting and hyphen edits require a separate backend');
 backend(r).selectTypeface(face.weight,face.italic);return{...p,weight:face.weight,italic:face.italic};
}
function nativeParagraph(r,m,width){
 const b=backend(r),c=b.CanvasKit,first=m.runs[0]?.paint??{hinting:1};
 const builder=c.ParagraphBuilder.Make(new c.ParagraphStyle({textDirection:c.TextDirection.LTR,textAlign:c.TextAlign.Left,textStyle:{},disableHinting:first.hinting===0}),b.fontManager);
 let paragraph;
 try{
  for(const run of m.runs){
   const p=run.paint;if(p.hinting!==first.hinting)fail('Mixed font hinting inside a paragraph is unavailable');
   builder.pushStyle(new c.TextStyle({fontFamilies:['Roboto'],fontSize:p.textSize,locale:p.textLocaleTag??'en-US',letterSpacing:p.letterSpacing*p.textSize,wordSpacing:p.wordSpacing,
    fontStyle:{weight:{value:p.weight},width:c.FontWidth.Normal,slant:p.italic?c.FontSlant.Italic:c.FontSlant.Upright},
    fontFeatures:[{name:'kern',value:p.flags&0x100?1:0}]}));
   builder.addText(m.text.slice(run.start,run.end));builder.pop();
  }
  paragraph=builder.build();paragraph.layout(width);
  const missing=paragraph.unresolvedCodepoints();if(missing.length)fail('Pinned Roboto fonts lack paragraph glyphs: '+missing.slice(0,8).join(','));
  if(paragraph.getNumberOfLines()>4096)fail('Paragraph exceeds4096 native lines');
  return paragraph;
 }catch(error){paragraph?.delete();throw error;}finally{builder.delete();}
}
function rangeWidth(r,m,start,end){
 bounds(m,start,end);if(start===end)return 0;const c=backend(r).CanvasKit;
 return Math.fround(m.paragraph.getRectsForRange(start,end,c.RectHeightStyle.Tight,c.RectWidthStyle.Tight).reduce((sum,box)=>sum+box.rect[2]-box.rect[0],0));
}
function metrics(r,m,start,end){
 bounds(m,start,end);let ascent=0,descent=0;
 for(const run of m.runs)if(run.start<end&&run.end>start){const f=r.skiaHost.measureText('',run.paint).metrics;ascent=Math.min(ascent,Math.round(f.ascent));descent=Math.max(descent,Math.round(f.descent));}
 return{ascent,descent};
}
function inkBounds(r,m,start,end){
 bounds(m,start,end);if(start===end)return[0,0,0,0];const c=backend(r).CanvasKit,origin=rangeWidth(r,m,0,start);
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(const line of m.paragraph.getShapedLines())for(const run of line.runs){
  const font=new c.Font(run.typeface,run.size);
  try{
   const boxes=font.getGlyphBounds(run.glyphs);
   for(let i=0;i<run.glyphs.length;i++){
    const clusterStart=run.offsets[i];let clusterEnd=run.offsets[i+1];for(let j=i+1;j<run.offsets.length&&clusterEnd<=clusterStart;j++)clusterEnd=run.offsets[j];
    if(clusterStart>=end||clusterEnd<=start)continue;
    const box=boxes.slice(i*4,i*4+4);if(Array.from(box).every(v=>v===0))continue;
    const x=run.positions[i*2]-origin,y=run.positions[i*2+1]-line.baseline;
    left=Math.min(left,x+box[0]);top=Math.min(top,y+box[1]);right=Math.max(right,x+box[2]);bottom=Math.max(bottom,y+box[3]);
   }
  }finally{font.delete();run.typeface.delete();}
 }
 return left===Infinity?[0,0,0,0]:[Math.floor(left),Math.floor(top),Math.ceil(right),Math.ceil(bottom)];
}

/** Original Android Java retains builder/range/span/layout algorithms. These
 * exact JNI boundaries use original SkParagraph CPU, not Minikin or ELF code.
 * Every returned long is a checked VM token; unsupported algorithms fail.
 */
export function createTextLayoutNativeBindings(){
 const out=new Map(),add=(owner,name,p,result,fn)=>out.set(`${owner}->${name}(${p.join('')})${result}`,(r,a)=>{const answer=fn(r,a.map((v,i)=>p[i]==='F'?decode(v):v));return result==='F'?encode(answer):answer;});
 add(MT,'nGetReleaseFunc',[],'J',()=>0x5445585401n);add(LB,'nGetReleaseFunc',[],'J',()=>0x5445585402n);add(LB,'nGetReleaseResultFunc',[],'J',()=>0x5445585403n);
 add(BUILDER,'nInitBuilder',[],'J',r=>{backend(r);return allocate(r,'builder',{runs:[]});});
 add(BUILDER,'nAddStyleRun',['J','J','I','I','I','I','Z'],'V',(r,[h,p,style,word,start,end,rtl])=>{
  const b=get(r,h,'builder');if(rtl||style||word)fail('RTL or configured line-break style requires a separate text backend');
  if(start!==(b.runs.at(-1)?.end??0)||end<=start||end>65536||b.runs.length>=4096)fail('Invalid or excessive measured-text style runs');
  b.runs.push({start,end,paint:paintSnapshot(r,p)});
 });
 add(BUILDER,'nAddReplacementRun',['J','J','I','I','F'],'V',()=>fail('ReplacementSpan native measured-text runs are unavailable'));
 add(BUILDER,'nBuildMeasuredText',['J','J','[C','Z','Z','Z'],'J',(r,[h,hint,buffer,hyphenation,layout,fast])=>{
  const b=get(r,h,'builder'),text=chars(r,buffer);validateText(text);if(hyphenation||fast)fail('Android Minikin hyphenation is unavailable');if(hint)get(r,hint,'measured');
  if((b.runs.at(-1)?.end??0)!==text.length)fail('Measured-text styles do not cover the actual text');
  const m={text,runs:b.runs.map(run=>({...run,paint:{...run.paint}})),computeLayout:!!layout};m.paragraph=nativeParagraph(r,m,1073741824);
  try{return allocate(r,'measured',m);}catch(error){m.paragraph.delete();throw error;}
 });
 add(BUILDER,'nFreeBuilder',['J'],'V',(r,[h])=>{get(r,h,'builder');release(r,h);});
 add(MT,'nGetWidth',['J','I','I'],'F',(r,[h,start,end])=>rangeWidth(r,get(r,h,'measured'),start,end));
 add(MT,'nGetCharWidthAt',['J','I'],'F',(r,[h,index])=>rangeWidth(r,get(r,h,'measured'),index,index+1));
 add(MT,'nGetMemoryUsage',['J'],'I',()=>fail('SkParagraph native allocation size is not exposed by CanvasKit'));
 add(MT,'nGetExtent',['J','[C','I','I'],'J',(r,[h,buffer,start,end])=>{
  const m=get(r,h,'measured');if(chars(r,buffer)!==m.text)fail('Measured-text character buffer differs from its native snapshot');
  const f=metrics(r,m,start,end);return(BigInt(f.ascent)<<32n)|BigInt.asUintN(32,BigInt(f.descent));
 });
 add(MT,'nGetBounds',['J','[C','I','I','Landroid/graphics/Rect;'],'V',(r,[h,buffer,start,end,rect])=>{
  const m=get(r,h,'measured');if(!m.computeLayout)fail('MeasuredText was built without layout data');if(chars(r,buffer)!==m.text)fail('Measured-text buffer differs from its snapshot');
  const values=inkBounds(r,m,start,end);for(const [i,name]of ['left','top','right','bottom'].entries())r.storeField(r.object(rect).fields,`Landroid/graphics/Rect;->${name}:I`,values[i]);
 });
 add(LB,'nInit',['I','I','Z','[I'],'J',(r,[strategy,hyphenation,justify,indents])=>{
  backend(r);if(strategy||hyphenation||justify||(indents&&r.array(indents).elements.some(Boolean)))fail('Only simple, unhyphenated, unjustified line breaking without indents is available');
  return allocate(r,'breaker',{});
 });
 add(LB,'nComputeLineBreaks',['J','[C','J','I','F','I','F','[F','F','I'],'J',(r,[h,buffer,mh,length,first,count,rest,tabs])=>{
  get(r,h,'breaker');const m=get(r,mh,'measured');if(chars(r,buffer)!==m.text||length!==m.text.length)fail('LineBreaker input differs from measured text');
  if(![first,rest].every(v=>Number.isFinite(v)&&v>=0&&v<=2147483648))fail('Line-break width must be finite and within0..2^31 (including Android UNSPECIFIED width)');
  if(count>0&&first!==rest)fail('Different first/rest widths require a native leading-margin backend');
  if(tabs&&r.array(tabs).elements.length)fail('Variable tab stops are outside the Latin text backend');
  const paragraph=nativeParagraph(r,m,count>0?first:rest);
  try{
   const lines=paragraph.getLineMetrics().filter(line=>line.startIndex<m.text.length).map(line=>({offset:line.endIncludingNewline,width:line.width,ascent:-line.ascent,descent:line.descent,flags:0}));
   return allocate(r,'result',{lines});
  }finally{paragraph.delete();}
 });
 add(LB,'nGetLineCount',['J'],'I',(r,[h])=>get(r,h,'result').lines.length);
 for(const[name,key,type]of [['nGetLineBreakOffset','offset','I'],['nGetLineWidth','width','F'],['nGetLineAscent','ascent','F'],['nGetLineDescent','descent','F'],['nGetLineFlag','flags','I']])add(LB,name,['J','I'],type,(r,[h,index])=>{const lines=get(r,h,'result').lines;if(!Number.isInteger(index)||index<0||index>=lines.length)fail('Line-break result index is out of bounds');return lines[index][key];});
 return out;
}

/** Ownership is explicit: the VM holds Java objects until shutdown. A returned
 * Runnable releases only its checked native token when explicitly invoked.
 */
export function textLayoutRegistryBridge(r,method,args){
 if(method.owner===REG&&method.name==='createMalloced'&&method.signature===`(Ljava/lang/ClassLoader;J)${REG}`&&FINALIZERS.has(args[1])){
  const value=r.makeObject(REG),object=r.object(value);object.textLayoutKind=FINALIZERS.get(args[1]);r.storeField(object.fields,`${REG}->freeFunction:J`,args[1]);return{value};
 }
 if(method.owner===REG&&method.name==='registerNativeAllocation'&&method.signature==='(Ljava/lang/Object;J)Ljava/lang/Runnable;'){
  const registry=r.object(args[0]);if(!registry.textLayoutKind)return null;r.object(args[1]);get(r,args[2],registry.textLayoutKind);
  const value=r.makeObject(TEXT_LAYOUT_CLEANER);r.object(value).textLayoutCleanup=args[2];return{value};
 }
 if(method.name==='run'&&method.signature==='()V'&&args[0]&&r.object(args[0]).type===TEXT_LAYOUT_CLEANER){const cleaner=r.object(args[0]);if(cleaner.textLayoutCleanup){release(r,cleaner.textLayoutCleanup);cleaner.textLayoutCleanup=0n;}return{value:undefined};}
 return null;
}
export function disposeTextLayout(r){for(const h of [...stateFor(r).handles.keys()])release(r,h);}
