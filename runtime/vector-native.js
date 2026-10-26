import { APKError } from './apk-error.js?v=dee55583552d';
import { getSolidPaint } from './paint-host.js?v=dee55583552d';
import { getColorFilterSnapshot } from './color-filter-native.js?v=dee55583552d';

const VECTOR='Landroid/graphics/drawable/VectorDrawable;', PARSER='Landroid/util/PathParser;';
const bits=new DataView(new ArrayBuffer(4));
const f32=n=>{bits.setInt32(0,n,true);return bits.getFloat32(0,true);};
const rawFloat=n=>{bits.setFloat32(0,n,true);return bits.getInt32(0,true);};
const problem=(message,kind='vector-backend-unsupported')=>{throw new APKError(message,{kind});};
const finite=n=>{if(!Number.isFinite(n))problem('Vector geometry contains a non-finite number');return n;};
const xml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const parameters={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};
/** SVG and Android pathData share this command grammar. Keep commands for source morphing. */
function parsePath(text){
 if(typeof text!=='string'||text.length>1024*1024)problem('Invalid or oversized vector pathData','invalid-vector-path');
 const tokens=text.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)||[];
 if(text.replace(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[\s,]/g,''))problem('Invalid vector pathData syntax','invalid-vector-path');
 const commands=[];let i=0;
 while(i<tokens.length){const verb=tokens[i++];if(!(verb.toUpperCase() in parameters))problem('Path command is missing','invalid-vector-path');const values=[];
  while(i<tokens.length&&!/^[a-z]$/i.test(tokens[i]))values.push(finite(Number(tokens[i++])));
  const size=parameters[verb.toUpperCase()];if((!size&&values.length)||(size&&(!values.length||values.length%size)))problem('Invalid vector path command arity','invalid-vector-path');
  if(verb.toUpperCase()==='A')for(let k=0;k<values.length;k+=7)if(![0,1].includes(values[k+3])||![0,1].includes(values[k+4])||values[k]<0||values[k+1]<0)problem('Invalid SVG arc flags/radii','invalid-vector-path');
  commands.push({verb,values});if(commands.length>100000)problem('Vector command count limit exceeded');
 }
 if(commands.length&&!/^[Mm]$/.test(commands[0].verb))problem('Vector path must begin with moveTo','invalid-vector-path');
 return commands;
}
const pathString=commands=>commands.map(c=>c.verb+c.values.join(' ')).join(' ');
const sameShape=(a,b)=>a.length===b.length&&a.every((c,i)=>c.verb===b[i].verb&&c.values.length===b[i].values.length);
const clone=value=>structuredClone(value);
const FULL_DEFAULTS={strokeWidth:0,strokeColor:0,strokeAlpha:1,fillColor:0,fillAlpha:1,trimPathStart:0,trimPathEnd:1,trimPathOffset:0,strokeLineCap:0,strokeLineJoin:0,strokeMiterLimit:4,fillType:0};
const GROUP_DEFAULTS={rotation:0,pivotX:0,pivotY:0,scaleX:1,scaleY:1,translateX:0,translateY:0};
const groupKeys=Object.keys(GROUP_DEFAULTS), propertyKeys=Object.keys(FULL_DEFAULTS);
const states=new WeakMap();

export class VectorGraphics {
 constructor(runtime){this.runtime=runtime;this.handles=new Map();this.next=0x200000000n;this.commandCount=0;this.pathChars=0;this.accountedBytes=0n;}
 create(kind,props={}){if(this.handles.size>=20000)problem('Vector handle limit exceeded');const handle=this.next++;this.handles.set(handle,{kind,refs:0,...props});return handle;}
 release(handle){this.get(handle);const pending=[handle],seen=new Set();while(pending.length){const h=pending.pop();if(seen.has(h)||!this.handles.has(h))continue;seen.add(h);const object=this.get(h);if(object.kind==='tree')pending.push(object.root);else if(object.kind==='group')pending.push(...object.children);this.pathChars-=(object.path||'').length;this.handles.delete(h);}}
 get(handle,kind=null){const value=this.handles.get(handle);if(!value||kind&&value.kind!==kind)problem(`Invalid ${kind||'graphics'} VM handle ${handle}`,'invalid-vector-handle');return value;}
 copy(handle,kind){const value=clone(this.get(handle,kind));value.refs=0;return this.create(kind,value);}
 setPath(handle,text){const value=this.get(handle);const commands=parsePath(text);this.pathChars+=text.length-(value.path||'').length;if(this.pathChars>8*1024*1024)problem('Aggregate vector path storage limit exceeded');value.commands=commands;value.path=pathString(commands);}
 snapshot(handle,{width=null,height=null,mirrored=false}={}){
  const tree=this.get(handle,'tree');width??=tree.viewportWidth;height??=tree.viewportHeight;
  if(!(width>0&&height>0&&tree.viewportWidth>0&&tree.viewportHeight>0))problem('Vector dimensions and viewport must be positive');
  const seen=new Set();let serial=0,pathCount=0;
  const color=(argb,alpha)=>{const v=argb>>>0;return {color:'#'+(v&0xffffff).toString(16).padStart(6,'0'),alpha:((v>>>24)/255)*alpha};};
  const render=(nodeHandle,depth=0)=>{
   if(depth>128||seen.has(nodeHandle))problem('Cyclic/excessive vector tree');seen.add(nodeHandle);const node=this.get(nodeHandle);let result='';
   if(node.kind==='group'){
    const p=node.props;let body='',clips=0;
    for(const child of node.children){const object=this.get(child);if(object.kind==='clip'){
     const id=`vector-clip-${serial++}`;body+=`<defs><clipPath id="${id}"><path d="${xml(object.path||'')}"/></clipPath></defs><g clip-path="url(#${id})">`;clips++;
    }else body+=render(child,depth+1);}
    body+='</g>'.repeat(clips);result=`<g transform="translate(${p.translateX+p.pivotX} ${p.translateY+p.pivotY}) rotate(${p.rotation}) scale(${p.scaleX} ${p.scaleY}) translate(${-p.pivotX} ${-p.pivotY})">${body}</g>`;
   }else if(node.kind==='full'){
    const p=node.props;if(p.trimPathStart!==0||p.trimPathEnd!==1||p.trimPathOffset!==0)problem('Vector trimPath requires a measured-path backend');
    if(![0,1].includes(p.fillType))problem('Unsupported vector fill rule');
    const fill=color(p.fillColor,p.fillAlpha),stroke=color(p.strokeColor,p.strokeAlpha);pathCount++;
    result=`<path d="${xml(node.path||'')}" fill="${fill.color}" fill-opacity="${fill.alpha}" fill-rule="${p.fillType?'evenodd':'nonzero'}" stroke="${stroke.color}" stroke-opacity="${stroke.alpha}" stroke-width="${p.strokeWidth}" stroke-linecap="${['butt','round','square'][p.strokeLineCap]||problem('Invalid stroke cap')}" stroke-linejoin="${['miter','round','bevel'][p.strokeLineJoin]||problem('Invalid stroke join')}" stroke-miterlimit="${p.strokeMiterLimit}"/>`;
   }else problem(`Cannot render vector node ${node.kind}`);
   seen.delete(nodeHandle);return result;
  };
  const body=render(tree.root);const transform=mirrored?` transform="translate(${tree.viewportWidth} 0) scale(-1 1)"`:'';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${finite(width)}" height="${finite(height)}" viewBox="0 0 ${tree.viewportWidth} ${tree.viewportHeight}" preserveAspectRatio="none"${tree.antiAlias?'':' shape-rendering="crispEdges"'}><g opacity="${tree.alpha}"${transform}>${body}</g></svg>`;
  return {kind:'svg',svg,width,height,viewportWidth:tree.viewportWidth,viewportHeight:tree.viewportHeight,pathCount,source:'AOSP-VectorDrawable-DEX/web-native-graphics'};
 }
 snapshotDrawable(receiver){const vm=this.runtime,object=vm.object(receiver);const state=object.fields.get(`${VECTOR}->mVectorState:Landroid/graphics/drawable/VectorDrawable$VectorDrawableState;`);if(!state)problem('VectorDrawable state is absent');
  const fields=vm.object(state).fields,tree=fields.get('Landroid/graphics/drawable/VectorDrawable$VectorDrawableState;->mNativeTree:Lcom/android/internal/util/VirtualRefBasePtr;');
  for(const [key,value]of [...object.fields,...fields])if(/->(?:mTint|mTintFilter|mColorFilter|mBlendModeColorFilter):/.test(key)&&value!==null&&value!==0)problem('Vector tint/color filter requires a web color-filter backend');
  const handle=vm.object(tree).fields.get('Lcom/android/internal/util/VirtualRefBasePtr;->mNativePtr:J');
  return this.snapshot(handle,{width:fields.get('Landroid/graphics/drawable/VectorDrawable$VectorDrawableState;->mBaseWidth:I'),height:fields.get('Landroid/graphics/drawable/VectorDrawable$VectorDrawableState;->mBaseHeight:I')});
 }
 createCanvas(){return this.create('canvas',{draws:[],matrix:[1,0,0,1,0,0],stack:[]});}
 canvasDraws(handle){return this.get(handle,'canvas').draws.slice();}
 captureVector(handle){const tree=this.get(handle,'tree'),active=new Set();let count=0;const capture=(pointer,depth=0)=>{if(depth>128||active.has(pointer)||++count>20000)problem('Cyclic/excessive vector draw snapshot');active.add(pointer);const node=this.get(pointer),copy={kind:node.kind,props:{...node.props},path:node.path??''};if(node.kind==='group')copy.children=node.children.map(child=>capture(child,depth+1));active.delete(pointer);return copy;};return {...tree,root:capture(tree.root)};}
 reserveDrawStorage(extra){let used=extra;for(const object of this.handles.values())if(object.kind==='canvas')for(const draw of object.draws){used+=(draw.svg?.length??0)+(draw.commands?.length??0)*4+(draw.text?.length??0);if(used>32*1024*1024)problem('Aggregate recorded graphics storage limit exceeded');}}
 resetCanvas(receiver,width=null,height=null){const canvas=this.get(this.runtime.object(receiver).nativeCanvasHandle,'canvas');canvas.draws.length=0;canvas.matrix=[1,0,0,1,0,0];canvas.stack.length=0;canvas.clips=[];if(width!==null)canvas.width=width;if(height!==null)canvas.height=height;}
 snapshotCanvas(receiver,width,height){
  if(!(width>0&&height>0&&width*height<=16*1024*1024))problem('Invalid canvas snapshot extent');
  if(this.runtime.skia?.rasterizeCanvas)return this.runtime.skia.rasterizeCanvas(this.runtime,this,receiver,width,height);
  const handle=this.runtime.object(receiver).nativeCanvasHandle,draws=this.get(handle,'canvas').draws;
  const body=draws.map(draw=>`<g transform="matrix(${draw.matrix.join(' ')})"><g transform="translate(${draw.x} ${draw.y})">${draw.svg}</g></g>`).join('');
  return {kind:'svg',svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,width,height,drawCalls:draws.length,source:'original-Drawable.draw/web-software-canvas'};
 }
}
export function getVectorGraphics(runtime){if(!states.has(runtime))states.set(runtime,new VectorGraphics(runtime));return states.get(runtime);}

/** Registered exact native declarations only. Runtime dispatch additionally enforces boot origin. */
export function createVectorNativeBindings(){
 const bindings=new Map();
 const add=(owner,name,parameters,result,fn)=>bindings.set(`${owner}->${name}(${parameters.join('')})${result}`,(vm,args)=>{
  const decoded=args.map((v,i)=>parameters[i]==='F'?f32(v):v);let answer;
  try{answer=fn(getVectorGraphics(vm),decoded,vm);}catch(error){if(error.details?.kind==='invalid-vector-path')vm.throwJava('Ljava/lang/IllegalArgumentException;',error.message);throw error;}
  return result==='F'?rawFloat(answer):answer;
 });
 const vector=(name,p,r,fn)=>add(VECTOR,name,p,r,fn),parser=(name,p,r,fn)=>add(PARSER,name,p,r,fn);
 for(const [suffix,kind]of [['Group','group'],['FullPath','full'],['ClipPath','clip']]){
  const empty=g=>g.create(kind,{props:clone(kind==='group'?GROUP_DEFAULTS:FULL_DEFAULTS),children:[],path:'',commands:[]});
  vector('nCreate'+suffix,[],'J',g=>empty(g));vector('nCreate'+suffix,['J'],'J',(g,[h])=>g.copy(h,kind));
 }
 vector('nCreateTree',['J'],'J',(g,[root])=>{g.get(root,'group');return g.create('tree',{root,viewportWidth:0,viewportHeight:0,alpha:1,antiAlias:true,allowCaching:true});});
 vector('nCreateTreeFromCopy',['J','J'],'J',(g,[source,root])=>{const tree=clone(g.get(source,'tree'));g.get(root,'group');return g.create('tree',{...tree,root,refs:0});});
 vector('nAddChild',['J','J'],'V',(g,[parent,child])=>{const group=g.get(parent,'group');g.get(child);if(group.children.length>=20000)problem('Vector child limit exceeded');group.children.push(child);});
 vector('nSetName',['J','Ljava/lang/String;'],'V',(g,[h,name])=>{if(typeof name!=='string'||name.length>65536)problem('Invalid vector name');g.get(h).name=name;});
 vector('nSetPathString',['J','Ljava/lang/String;','I'],'V',(g,[h,text,length])=>{if(text?.length!==length)problem('Invalid vector path string length');g.setPath(h,text);});
 vector('nSetPathData',['J','J'],'V',(g,[h,data])=>g.setPath(h,g.get(data,'pathData').path));
 vector('nSetRendererViewportSize',['J','F','F'],'V',(g,[h,w,v])=>{const t=g.get(h,'tree');t.viewportWidth=finite(w);t.viewportHeight=finite(v);});
 vector('nSetRootAlpha',['J','F'],'Z',(g,[h,a])=>{const tree=g.get(h,'tree'),changed=tree.alpha!==a;tree.alpha=finite(a);return changed?1:0;});
 vector('nGetRootAlpha',['J'],'F',(g,[h])=>g.get(h,'tree').alpha);
 for(const [name,field]of [['nSetAntiAlias','antiAlias'],['nSetAllowCaching','allowCaching']])vector(name,['J','Z'],'V',(g,[h,v])=>{g.get(h,'tree')[field]=!!v;});
 vector('nUpdateGroupProperties',['J',...Array(7).fill('F')],'V',(g,[h,...values])=>{const p=g.get(h,'group').props;groupKeys.forEach((key,i)=>p[key]=finite(values[i]));});
 vector('nGetGroupProperties',['J','[F','I'],'Z',(g,[h,array,length],vm)=>{if(length!==7||vm.array(array).elements.length<length)return 0;vm.array(array).elements.splice(0,7,...groupKeys.map(k=>rawFloat(g.get(h,'group').props[k])));return 1;});
 vector('nUpdateFullPathProperties',['J','F','I','F','I','F','F','F','F','F','I','I','I'],'V',(g,[h,...values])=>{
  const order=['strokeWidth','strokeColor','strokeAlpha','fillColor','fillAlpha','trimPathStart','trimPathEnd','trimPathOffset','strokeMiterLimit','strokeLineCap','strokeLineJoin','fillType'];const p=g.get(h,'full').props;order.forEach((key,i)=>p[key]=finite(values[i]));});
 vector('nGetFullPathProperties',['J','[B','I'],'Z',(g,[h,array,length],vm)=>{if(length!==48||vm.array(array).elements.length<length)return 0;const buf=new DataView(new ArrayBuffer(48)),p=g.get(h,'full').props;propertyKeys.forEach((key,i)=>{if(['strokeColor','fillColor','strokeLineCap','strokeLineJoin','fillType'].includes(key))buf.setInt32(i*4,p[key],true);else buf.setFloat32(i*4,p[key],true);});vm.array(array).elements.splice(0,48,...new Int8Array(buf.buffer));return 1;});
 for(const [kind,keys]of [['group',groupKeys],['full',propertyKeys]])for(const property of keys){const suffix=property[0].toUpperCase()+property.slice(1),integer=['strokeColor','fillColor','strokeLineCap','strokeLineJoin','fillType'].includes(property),type=integer?'I':'F';
  if(kind==='full'&&!['strokeWidth','strokeColor','strokeAlpha','fillColor','fillAlpha','trimPathStart','trimPathEnd','trimPathOffset'].includes(property))continue;
  vector('nGet'+suffix,['J'],type,(g,[h])=>g.get(h,kind).props[property]);vector('nSet'+suffix,['J',type],'V',(g,[h,v])=>{g.get(h,kind).props[property]=finite(v);});}
 for(const name of ['nUpdateFullPathFillGradient','nUpdateFullPathStrokeGradient'])vector(name,['J','J'],'V',(g,[h,gradient])=>{g.get(h,'full');if(gradient!==0n)problem('Vector gradient requires a web shader backend');});
 parser('nCreateEmptyPathData',[],'J',g=>g.create('pathData',{path:'',commands:[]}));
 parser('nCreatePathData',['J'],'J',(g,[h])=>g.copy(h,'pathData'));
 parser('nCreatePathDataFromString',['Ljava/lang/String;','I'],'J',(g,[text,length])=>{if(text?.length!==length)problem('Invalid pathData string length');const h=g.create('pathData');g.setPath(h,text);return h;});
 parser('nSetPathData',['J','J'],'V',(g,[to,from])=>g.setPath(to,g.get(from,'pathData').path));
 parser('nCanMorph',['J','J'],'Z',(g,[a,b])=>sameShape(g.get(a,'pathData').commands,g.get(b,'pathData').commands)?1:0);
 parser('nInterpolatePathData',['J','J','J','F'],'Z',(g,[to,a,b,t])=>{const from=g.get(a,'pathData').commands,target=g.get(b,'pathData').commands;if(!sameShape(from,target))return 0;const commands=from.map((c,i)=>({verb:c.verb,values:c.values.map((n,j)=>finite(n*(1-t)+target[i].values[j]*t))}));g.setPath(to,pathString(commands));return 1;});
 parser('nFinalize',['J'],'V',(g,[h])=>{g.get(h,'pathData');g.handles.delete(h);});
 parser('nParseStringForPath',['J','Ljava/lang/String;','I'],'V',(g,[handle,text,length],vm)=>{if(typeof text!=='string'||text.length!==length||length>1000000)problem('Invalid bounded SVG pathData input');if(!vm.skiaHost?.parsePath)problem('PathParser requires the verified Skia Path backend');vm.skiaHost.parsePath(handle,text);});
 parser('nCreatePathFromPathData',['J','J'],'V',(g,[handle,data],vm)=>{if(!vm.skiaHost?.parsePath)problem('PathParser requires the verified Skia Path backend');vm.skiaHost.parsePath(handle,g.get(data,'pathData').path);});
 vector('nDraw',['J','J','J','Landroid/graphics/Rect;','Z','Z'],'I',(g,[tree,canvas,filter,rect,mirror],vm)=>{
  const colorFilter=getColorFilterSnapshot(vm,filter);if(colorFilter&&!vm.skia?.rasterizeCanvas)problem('Filtered vectors require the original Skia raster backend');const fields=vm.object(rect).fields,get=n=>fields.get(`Landroid/graphics/Rect;->${n}:I`)??0,w=get('right')-get('left'),h=get('bottom')-get('top');if(w<=0||h<=0)return 0;
  if(w*h>16*1024*1024)problem('Vector raster extent exceeds VM pixel limit');const draw=g.snapshot(tree,{width:w,height:h,mirrored:!!mirror});draw.colorFilter=colorFilter;draw.x=get('left');draw.y=get('top');const output=g.get(canvas,'canvas');draw.matrix=output.matrix.slice();draw.clips=(output.clips??[]).slice();draw.vectorTree=tree;draw.vectorState=g.captureVector(tree);draw.mirrored=!!mirror;if(output.draws.length>=1024)problem('Vector canvas command limit exceeded');g.reserveDrawStorage(draw.svg.length);output.draws.push(draw);return Math.ceil(w*h);
 });
 for(const [name,delta]of [['nIncStrong',1],['nDecStrong',-1]])add('Lcom/android/internal/util/VirtualRefBasePtr;',name,['J'],'V',(g,[h])=>{const object=g.get(h);if(object.refs+delta<0)problem('Unbalanced vector handle release');object.refs+=delta;if(!object.refs&&delta<0)g.release(h);});
 for(const [name,delta]of [['registerNativeAllocation',1n],['registerNativeFree',-1n]])add('Ldalvik/system/VMRuntime;',name,['J'],'V',(g,args)=>{
  // Instance native receives receiver before the declared long parameter.
  const bytes=args[1];if(typeof bytes!=='bigint'||bytes<0n)problem('Invalid VM native allocation accounting');g.accountedBytes+=delta*bytes;if(g.accountedBytes<0n||g.accountedBytes>64n*1024n*1024n)problem('Vector native allocation accounting limit exceeded');});
 return bindings;
}

/** Software Canvas system boundary; drawable algorithms still execute their boot DEX. */
export function createVectorCanvasHost(){
 const owner='Landroid/graphics/Canvas;',keys=new Set(['<init>()V','getNativeCanvasWrapper()J','isHardwareAccelerated()Z','save()I','restore()V','restoreToCount(I)V','getSaveCount()I','translate(FF)V','scale(FF)V','rotate(F)V','getDensity()I','setDensity(I)V','drawRect(Landroid/graphics/Rect;Landroid/graphics/Paint;)V','drawRect(FFFFLandroid/graphics/Paint;)V'].map(s=>owner+'->'+s));
 return {
  supports:key=>keys.has(key),canAllocate:type=>type===owner,parent:type=>type===owner?'Ljava/lang/Object;':null,
  invoke(runtime,method,args){
   const object=runtime.object(args[0]),graphics=getVectorGraphics(runtime),name=method.name;
   if(name==='<init>'){if(object.nativeCanvasHandle)problem('Canvas is already initialized');object.nativeCanvasHandle=graphics.createCanvas();object.canvasDensity=160;return;}
   const canvas=graphics.get(object.nativeCanvasHandle,'canvas');
   if(name==='getNativeCanvasWrapper')return object.nativeCanvasHandle;
   if(name==='isHardwareAccelerated')return 0;
   if(name==='getDensity')return object.canvasDensity;
   if(name==='setDensity'){object.canvasDensity=args[1];return;}
   if(name==='drawRect'){
    let left,top,right,bottom,paint;
    if(method.parameters.length===2){const fields=runtime.object(args[1]).fields,get=n=>fields.get(`Landroid/graphics/Rect;->${n}:I`)??0;left=get('left');top=get('top');right=get('right');bottom=get('bottom');paint=args[2];}
    else{[left,top,right,bottom]=args.slice(1,5).map(f32);paint=args[5];}
    for(const n of [left,top,right,bottom])finite(n);
    const width=right-left,height=bottom-top;if(width<=0||height<=0)return;if(width*height>16*1024*1024)problem('Canvas rectangle exceeds VM extent limit');
    const solid=getSolidPaint(runtime,paint);if(canvas.draws.length>=1024)problem('Canvas command limit exceeded');
    if(![0,1,2].includes(solid.style))problem('Unsupported Paint style');
    const fill=solid.style===1?'none':solid.color,stroke=solid.style===0?'':` stroke="${solid.color}" stroke-opacity="${solid.alpha}" stroke-width="${solid.strokeWidth||1}" stroke-miterlimit="${solid.strokeMiter}" stroke-linecap="${['butt','round','square'][solid.strokeCap]}" stroke-linejoin="${['miter','round','bevel'][solid.strokeJoin]}"${solid.strokeWidth===0?' vector-effect="non-scaling-stroke"':''}`;
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="visible"><rect width="${width}" height="${height}" fill="${fill}" fill-opacity="${solid.alpha}"${stroke}${solid.flags&1?'':' shape-rendering="crispEdges"'}/></svg>`;graphics.reserveDrawStorage(svg.length);canvas.draws.push({kind:'svg',svg,x:left,y:top,width,height,matrix:canvas.matrix.slice(),clips:(canvas.clips??[]).slice(),argb:solid.argb,paint:solid,source:'original-Drawable.draw/web-Paint/Canvas'});return;
   }
   if(name==='getSaveCount')return canvas.stack.length+1;
   if(name==='save'){if(canvas.stack.length>=256)problem('Canvas save stack limit exceeded');const count=canvas.stack.length+1;canvas.stack.push({matrix:canvas.matrix.slice(),clips:(canvas.clips??[]).slice()});return count;}
   if(name==='restore'||name==='restoreToCount'){
    const count=name==='restore'?canvas.stack.length:args[1];if(count<1||count>canvas.stack.length+1)runtime.throwJava('Ljava/lang/IllegalStateException;','Underflow in restore');
    while(canvas.stack.length+1>count){const state=canvas.stack.pop();canvas.matrix=state.matrix??state;canvas.clips=state.clips??[];}return;
   }
   const matrix=canvas.matrix,[a,b,c,d,e,f]=matrix,x=finite(f32(args[1])),y=method.parameters.length>1?finite(f32(args[2])):0;
   if(name==='translate'){matrix[4]=a*x+c*y+e;matrix[5]=b*x+d*y+f;return;}
   if(name==='scale'){matrix[0]=a*x;matrix[1]=b*x;matrix[2]=c*y;matrix[3]=d*y;return;}
   if(name==='rotate'){const radians=x*Math.PI/180,s=Math.sin(radians),cos=Math.cos(radians);matrix[0]=a*cos+c*s;matrix[1]=b*cos+d*s;matrix[2]=c*cos-a*s;matrix[3]=d*cos-b*s;return;}
   problem(`Unsupported Canvas operation ${name}`);
  },
 };
}
