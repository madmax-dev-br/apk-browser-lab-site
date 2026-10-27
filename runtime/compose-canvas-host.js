import {APKError} from './apk-runtime.js?v=87d26d81015e';
import {measureSkiaParagraph} from './skia-paragraph.js?v=87d26d81015e';
import {getVectorGraphics} from './vector-native.js?v=87d26d81015e';
const VIEW='Landroid/view/View;',GROUP='Landroid/view/ViewGroup;',CANVAS='Landroid/graphics/Canvas;',DRAWABLE='Landroid/graphics/drawable/Drawable;',MATRIX='Landroid/graphics/Matrix;',PAINT='Landroid/graphics/Paint;';
const NODE='Landroid/graphics/RenderNode;',DISPLAY='Landroid/graphics/RecordingCanvas;',HOST='Landroid/graphics/RenderNode$AnimationHost;';   // API 33 RenderNode/RecordingCanvas (the hardware frontend View.updateDisplayListIfDirty records into)
const OWNER='Landroidx/compose/ui/platform/AndroidComposeView;';
const keys=new Set();
for(const signature of ['insertReorderBarrier()V','insertInorderBarrier()V'])keys.add('Landroid/graphics/Canvas;->'+signature);
for(const [owner,signatures] of [[VIEW,['draw(Landroid/graphics/Canvas;)V','onDraw(Landroid/graphics/Canvas;)V','dispatchDraw(Landroid/graphics/Canvas;)V','getDrawingTime()J','updateDisplayListIfDirty()Landroid/graphics/RenderNode;']],[GROUP,['dispatchDraw(Landroid/graphics/Canvas;)V','drawChild(Landroid/graphics/Canvas;Landroid/view/View;J)Z']]])for(const signature of signatures)keys.add(owner+'->'+signature);
const floats=new DataView(new ArrayBuffer(4)),raw=value=>{floats.setFloat32(0,value,true);return floats.getInt32(0,true);};
const fail=message=>{throw new APKError(message,{kind:'compose-canvas-boundary'});};

/** View/RenderNode software-canvas boundary. Compose layout, draw modifiers,
 * layers and shapes execute the APK's original AndroidComposeView/ViewLayer
 * methods. A semantics tree is never used to fabricate the rendered screen.
 */
export function createComposeCanvasHost(platform){
  let drawingTime=0,cachedTextRasterBytes=0;const textRasterSizes=new Map();
  const call=(r,receiver,owner,name,parameters=[],result='V',values=[],mode='virtual')=>r.dispatch({owner,name,parameters,result,signature:`(${parameters.join('')})${result}`},r.argumentWords(parameters,values,mode==='static'?{}:{receiver}),mode);
  const canvas=(r,ref,name,parameters=[],result='V',values=[])=>call(r,ref,CANVAS,name,parameters,result,values);
  const dimensions=view=>[Math.max(0,(view.bounds?.right??0)-(view.bounds?.left??0)),Math.max(0,(view.bounds?.bottom??0)-(view.bounds?.top??0))];
  const markDirty=(r,receiver)=>{const view=r.object(receiver);view.displayListDirty=true;r.storeField(view.fields,`${VIEW}->mRecreateDisplayList:Z`,1);};
  /** View's RenderNode.AnimationHost (ViewAnimationHostBridge): attached while the View is attached to a window, so RenderThread animators apply (RippleDrawable). */
  const animationHost=(r,view)=>{const HOSTCLASS='Ldev/apkweb/view/ViewAnimationHost;';if(!r.classes.has(HOSTCLASS))return null;const host=r.allocate(HOSTCLASS);r.dispatch({owner:HOSTCLASS,name:'<init>',parameters:[VIEW],result:'V',signature:`(${VIEW})V`},[host,view],'direct');return host;};
  const updateDisplayList=(r,receiver)=>{
    const view=r.object(receiver);if(!r.skiaHost||!r.classes.has(NODE))fail('View display lists require original RenderNode and verified Skia');
    const node=view.viewRenderNode??=call(r,null,NODE,'create',['Ljava/lang/String;',HOST],NODE,[view.type,animationHost(r,receiver)],'static');
    const valid=!!call(r,node,NODE,'hasDisplayList',[],'Z'),recreate=view.displayListDirty||view.fields.get(`${VIEW}->mRecreateDisplayList:Z`);
    if(valid&&!recreate)return node;if(view.updatingDisplayList)fail('Recursive updateDisplayListIfDirty on the same View');
    const [width,height]=dimensions(view),bounds=view.bounds??{left:0,top:0,right:width,bottom:height};
    call(r,node,NODE,'setPosition',['I','I','I','I'],'Z',[bounds.left,bounds.top,bounds.right,bounds.bottom]);
    // View.updateDisplayListIfDirty -> RenderNode properties: elevation/translationZ cast the HWUI shadow, the Outline shapes it and clips.
    {const z=view.webTransform,elevation=z?.elevation??0,translationZ=z?.translationZ??0;
     call(r,node,NODE,'setElevation',['F'],'Z',[raw(elevation)]);call(r,node,NODE,'setTranslationZ',['F'],'Z',[raw(translationZ)]);
     const outline=elevation+translationZ>0||view.clipToOutline?platform.viewOutlineHost.outlineObject(r,receiver):null;
     call(r,node,NODE,'setOutline',['Landroid/graphics/Outline;'],'Z',[outline??null]);call(r,node,NODE,'setClipToOutline',['Z'],'Z',[view.clipToOutline?1:0]);}
    const target=call(r,node,NODE,'beginRecording',['I','I'],DISPLAY,[width,height]);view.updatingDisplayList=true;view.displayListDirty=false;r.storeField(view.fields,`${VIEW}->mRecreateDisplayList:Z`,1);
    try{const sx=view.fields.get(`${VIEW}->mScrollX:I`)??0,sy=view.fields.get(`${VIEW}->mScrollY:I`)??0;if(sx||sy)canvas(r,target,'translate',['F','F'],'V',[raw(-sx),raw(-sy)]);call(r,receiver,VIEW,'draw',[CANVAS],'V',[target]);}
    catch(error){view.displayListDirty=true;r.storeField(view.fields,`${VIEW}->mRecreateDisplayList:Z`,1);throw error;}
    finally{view.updatingDisplayList=false;call(r,node,NODE,'endRecording',[],'V',[]);r.storeField(view.fields,`${VIEW}->mRecreateDisplayList:Z`,view.displayListDirty?1:0);}
    view.displayListGeneration=(view.displayListGeneration??0)+1;r.record(`HOST View.updateDisplayListIfDirty [original RenderNode/RecordingCanvas DEX; generation${view.displayListGeneration}]`);return node;
  };
  const textStyleValue=(r,receiver,attribute,method,result,fallback)=>{
    const view=r.object(receiver),table=platform.resources?.frameworkTable;
    if(!table||!view.context)return fallback;const id=table.findId('attr/'+attribute);if(!id)return fallback;
    const ids=r.newArray('[I',1);r.array(ids).elements=[id];let attrs=null;if(view.appliedNode){attrs=r.makeObject('Lapkweb/bridge/AttributeSet;');r.object(attrs).node=view.appliedNode;}
    const defStyle=view.defStyleAttr||table.findId(platform.drawableViewHost.defaultStyleName(r,view.type));
    const array=platform.styleBackend.obtain(r,platform.styleBackend.theme(r,view.context),attrs,ids,defStyle);
    try{if(!call(r,array,'Landroid/content/res/TypedArray;','hasValue',['I'],'Z',[0]))return fallback;return call(r,array,'Landroid/content/res/TypedArray;',method,method==='getInt'?['I','I']:['I'],result,method==='getInt'?[0,fallback]:[0]);}
    finally{call(r,array,'Landroid/content/res/TypedArray;','recycle');}
  };
  const textColor=(r,receiver,hint)=>{
    const view=r.object(receiver);if(!hint&&view.textColor!=null){if(typeof view.textColor==='number')return view.textColor|0;const value=view.textColor.slice(1);return (Number.parseInt(value,16)|(value.length===6?0xff000000:0))|0;}
    const list=textStyleValue(r,receiver,hint?'textColorHint':'textColor','getColorStateList','Landroid/content/res/ColorStateList;',null);
    if(!list)fail('Native TextView Canvas needs a resolved '+(hint?'hint':'text')+' color from its actual theme');
    const color=call(r,list,'Landroid/content/res/ColorStateList;','getDefaultColor',[],'I'),state=call(r,receiver,VIEW,'getDrawableState',[],'[I');return call(r,list,'Landroid/content/res/ColorStateList;','getColorForState',['[I','I'],'I',[state,color]);
  };
  const drawNativeText=(r,receiver,target)=>{
    const view=r.object(receiver);if(r.isSubtype(view.type,'Landroid/widget/CompoundButton;')&&!view.buttonDrawable)fail('CompoundButton Canvas needs its real indicator drawable and geometry');
    if(view.compoundDrawables?.some(Boolean)||view.marquee||view.ellipsize)fail('Native TextView Canvas compound/marquee/ellipsis layout is not connected');
    if(!view.textMetrics)fail('Native TextView Canvas requires completed actual font measurement');
    const displayed=String(view.displayText??view.text??''),hint=!displayed&&!!view.hint,text=hint?String(view.hint):displayed;if(!text)return;
    const [width,height]=dimensions(view),pad=platform.drawableViewHost.compoundPadding(r,receiver)??view.padding??{},innerWidth=Math.max(0,width-(pad.left??0)-(pad.right??0)),innerHeight=Math.max(0,height-(pad.top??0)-(pad.bottom??0));if(!innerWidth||!innerHeight)return;
    const color=textColor(r,receiver,hint),typeface=call(r,receiver,'Landroid/widget/TextView;','getTypeface',[],'Landroid/graphics/Typeface;'),face=r.skiaHost.resolveTypeface(typeface),size=view.textSize||14;
    const gravity=view.gravity??textStyleValue(r,receiver,'gravity','getInt','I',0x800033),abs=r.classes.has('Landroid/view/Gravity;')?call(r,null,'Landroid/view/Gravity;','getAbsoluteGravity',['I','I'],'I',[gravity,view.layoutDirection??0],'static'):gravity;
    const horizontal=abs&7,vertical=abs&0x70,lines=text.split('\n'),font={textSize:size,flags:1,typefaceRef:typeface},metrics=r.skiaHost.measureText('',font).metrics,top=view.includeFontPadding===false?Math.round(metrics.ascent):Math.floor(metrics.bounds[1]),bottom=view.includeFontPadding===false?Math.round(metrics.descent):Math.ceil(metrics.bounds[3]);
    const nativeParagraph=!hint&&view.textParagraph,blockHeight=nativeParagraph?view.textParagraph.height:bottom-top+(lines.length-1)*(view.textLineHeight??bottom-top),dy=vertical===0x10?(innerHeight-blockHeight)/2:vertical===0x50?innerHeight-blockHeight:0,save=canvas(r,target,'save',[],'I');
    try{canvas(r,target,'clipRect',['F','F','F','F'],'Z',[raw(pad.left??0),raw(pad.top??0),raw(width-(pad.right??0)),raw(height-(pad.bottom??0))]);const scrollX=view.updatingDisplayList?0:view.fields.get(`${VIEW}->mScrollX:I`)??0,scrollY=view.updatingDisplayList?0:view.fields.get(`${VIEW}->mScrollY:I`)??0;
      if(nativeParagraph){const renderWidth=view.textParagraph.layoutWidth,align=horizontal===1?'center':horizontal===5?'right':'left',key=JSON.stringify([text,renderWidth,size,face.weight,face.italic,color,align,view.layoutDirection,view.maxLines]);
        if(view.canvasTextRasterKey!==key){const result=measureSkiaParagraph(r.skia,text,{width:renderWidth,textSize:size,weight:face.weight,italic:face.italic,direction:view.layoutDirection??0,maxLines:view.maxLines??null,color,alignment:align,raster:true});if(Math.abs(result.height-view.textParagraph.height)>.001)fail('Native widget paragraph differs from its completed measurement');const length=result.raster.dataURL.length,next=cachedTextRasterBytes-(textRasterSizes.get(view.id)??0)+length;if(next>32*1024*1024)fail('Native widget paragraph raster cache exceeds32MiB');cachedTextRasterBytes=next;textRasterSizes.set(view.id,length);view.canvasTextRaster=result.raster;view.canvasTextRasterKey=key;}
        r.skiaHost.recordNative(r.object(target).nativeCanvasHandle,{op:'raster',raster:view.canvasTextRaster,args:[(pad.left??0)+(horizontal===1?(innerWidth-renderWidth)/2:horizontal===5?innerWidth-renderWidth:0)-scrollX,(pad.top??0)+dy-scrollY]});
      }else{const paint={argb:color>>>0,color:color>>>0,flags:1,style:0,strokeWidth:0,strokeMiter:4,strokeCap:0,strokeJoin:0,blendMode:3,textSize:size,textScaleX:1,textSkewX:0,letterSpacing:0,wordSpacing:0,hinting:1,weight:face.weight,italic:face.italic};
        lines.forEach((line,index)=>{const advance=r.skiaHost.measureText(line,font).width,dx=horizontal===1?(innerWidth-advance)/2:horizontal===5?innerWidth-advance:0;r.skiaHost.recordNative(r.object(target).nativeCanvasHandle,{op:'paragraphRun',text:line,args:[(pad.left??0)+dx-scrollX,(pad.top??0)+dy-top+index*(view.textLineHeight??bottom-top)-scrollY],isRtl:!!view.layoutDirection,paint});});
      }
      view.nativeCanvasText={source:'official-Skia/actual measured system-widget text',textLength:text.length,hint,gravity,color:color>>>0};r.record('DRAW system TextView/EditText: actual measured text + themed color -> Skia glyph/paragraph Canvas');
    }finally{canvas(r,target,'restoreToCount',['I'],'V',[save]);}
  };
  const sourceDraw=(r,receiver,target)=>{
    const view=r.object(receiver);
    if(!view.willNotDraw)call(r,receiver,VIEW,'onDraw',[CANVAS],'V',[target]);
    call(r,receiver,r.isSubtype(view.type,GROUP)?GROUP:VIEW,'dispatchDraw',[CANVAS],'V',[target]);
  };
  const drawable=(r,ref,target,w,h)=>{
    if(!ref)return;
    call(r,ref,DRAWABLE,'setBounds',['I','I','I','I'],'V',[0,0,w,h]);
    call(r,ref,DRAWABLE,'draw',[CANVAS],'V',[target]);
  };
  const drawView=(r,receiver,target)=>{
    const view=r.object(receiver),[w,h]=dimensions(view);
    if(view.visibility===4||view.visibility===8)return;
    if(view.backgroundDrawable)drawable(r,view.backgroundDrawable,target,w,h);
    else if(view.background){
      const color=typeof view.background==='string'?Number.parseInt(view.background.slice(1),16)|0:view.background|0;
      const paint=view.canvasBackgroundPaint??=r.allocate(PAINT);
      if(!r.object(paint).webPaint)call(r,paint,PAINT,'<init>',[],'V',[],'direct');
      call(r,paint,PAINT,'setColor',['I'],'V',[color]);canvas(r,target,'drawRect',['F','F','F','F',PAINT],'V',[raw(0),raw(0),raw(w),raw(h),paint]);
    }
    sourceDraw(r,receiver,target);
    if(view.buttonDrawable)platform.drawableViewHost.drawButton(r,receiver,target,w,h);
    if(view.foregroundDrawable){
      const bounds=view.foregroundBounds;if(!bounds)fail('Foreground must be positioned by the original Gravity before Canvas draw');
      call(r,view.foregroundDrawable,DRAWABLE,'setBounds',['I','I','I','I'],'V',[bounds.left,bounds.top,bounds.right,bounds.bottom]);
      call(r,view.foregroundDrawable,DRAWABLE,'draw',[CANVAS],'V',[target]);
    }
  };
  const drawChild=(r,parentRef,target,childRef)=>{
    const parent=r.object(parentRef),child=r.object(childRef);
    if(child.visibility===4||child.visibility===8)return 0;
    if(!child.bounds)fail('Custom Canvas child has not completed its original layout');
    const [w,h]=dimensions(child),save=canvas(r,target,'save',[],'I');
    try{
      const sx=parent.fields.get(`${VIEW}->mScrollX:I`)??0,sy=parent.fields.get(`${VIEW}->mScrollY:I`)??0;
      canvas(r,target,'translate',['F','F'],'V',[raw(child.bounds.left-sx),raw(child.bounds.top-sy)]);
      const matrix=platform.viewTransformHost.snapshot(r,childRef);
      if(matrix){
        const ref=child.canvasTransform??=r.allocate(MATRIX);
        if(!child.canvasTransformInitialized){call(r,ref,MATRIX,'<init>',[],'V',[],'direct');child.canvasTransformInitialized=true;}
        const values=child.canvasTransformValues??=r.newArray('[F',9);r.array(values).elements=matrix.map(raw);
        call(r,ref,MATRIX,'setValues',['[F'],'V',[values]);canvas(r,target,'concat',[MATRIX],'V',[ref]);
      }
      if(parent.clipChildren!==false)canvas(r,target,'clipRect',['F','F','F','F'],'Z',[raw(0),raw(0),raw(w),raw(h)]);
      platform.viewOutlineHost.clip(r,childRef,target);
      const alpha=child.renderAlpha??child.alpha??1;
      if(alpha!==1){
        if(!Number.isFinite(alpha)||alpha<0||alpha>1)fail('Unsupported child Canvas alpha');
        const paint=child.canvasAlphaPaint??=r.allocate(PAINT);if(!r.object(paint).webPaint)call(r,paint,PAINT,'<init>',[],'V',[],'direct');
        call(r,paint,PAINT,'setAlpha',['I'],'V',[Math.round(alpha*255)]);
        canvas(r,target,'saveLayer',['F','F','F','F',PAINT],'I',[raw(0),raw(0),raw(w),raw(h),paint]);
      }
      call(r,childRef,VIEW,'draw',[CANVAS],'V',[target]);
      return 0; // No View Animation is installed in this software View profile.
    }finally{canvas(r,target,'restoreToCount',['I'],'V',[save]);}
  };
  return{
    supports:key=>keys.has(key),
    markDirty,updateDisplayList,
    reflectionDefinition(owner,kind,name,parameters,publicOnly){
      // Hidden android.graphics.Canvas reorder barriers (androidx CanvasUtils.enableZ). Invocation is a normal virtual dispatch,
      // so a RecordingCanvas receiver reaches its original DisplayListCanvas Java -> nInsertReorderBarrier; others fail at dispatch.
      if(owner===CANVAS&&kind==='method'&&['insertReorderBarrier','insertInorderBarrier'].includes(name)&&(parameters??[]).length===0){const signature='()V';return {method:{owner,name,parameters:[],result:'V',signature,key:`${owner}->${name}${signature}`},flags:1};}
      if(owner!==VIEW)return null;
      if(kind==='method'&&name==='updateDisplayListIfDirty'&&(parameters??[]).length===0){const signature=`()${NODE}`;return {method:{owner,name,parameters:[],result:NODE,signature,key:`${owner}->${name}${signature}`},flags:1};}
      if(kind==='field'&&name==='mRecreateDisplayList'&&!publicOnly)return {field:{owner,name,type:'Z',key:`${owner}->${name}:Z`},flags:0};
      return null;
    },
    renderTree(r,root){
      const seen=new Set();drawingTime=Math.floor(r.platform?.lastFrameMs??r.clock.now());
      const visit=(receiver,depth=0)=>{
        const view=r.object(receiver);if(seen.has(view.id)||seen.size>=4096||depth>64)fail('Cyclic/excessive custom Canvas View tree');seen.add(view.id);
        if(view.visibility===4||view.visibility===8)return;
        const customLeaf=!r.isSubtype(view.type,GROUP)&&r.dex.classes.has(view.type)&&!!r.objectOverride(view.type,'onDraw(Landroid/graphics/Canvas;)V');
        if(r.isSubtype(view.type,OWNER)||customLeaf){
          const [width,height]=dimensions(view);if(!view.laidOut||!width||!height)return;
          if(!r.skiaHost)fail('Compose drawing requires the verified Skia Canvas backend');
          const target=view.contentCanvas??=r.allocate(CANVAS);
          if(!view.contentCanvasInitialized){call(r,target,CANVAS,'<init>',[],'V',[],'direct');view.contentCanvasInitialized=true;}
          const graphics=getVectorGraphics(r);graphics.resetCanvas(target,width,height);
          if(r.isSubtype(view.type,OWNER)){
            // The Compose owner draws into its RenderNode's recording DisplayListCanvas (hardware path: GraphicsLayer RenderNodes, reorder barriers, HWUI-model shadows); the software Canvas below only replays that node.
            const node=updateDisplayList(r,receiver),handle=[...r.object(node).fields.entries()].find(([key])=>key.endsWith('->mNativeRenderNode:J'))?.[1];
            if(handle===undefined)fail('Compose owner RenderNode has no native handle');
            r.skiaHost.recordNative(r.object(target).nativeCanvasHandle,{op:'renderNode',node:handle});
          }else sourceDraw(r,receiver,target);
          view.contentRaster=graphics.snapshotCanvas(target,width,height);view.canvasChildrenCaptured=true;
          r.record(`DRAW custom View: original ${view.type} Canvas callbacks DEX -> Skia CPU`);
          return;
        }
        for(const child of view.children??[])visit(child,depth+1);
      };if(root)visit(root);
    },
    invoke(r,method,args){
      if(method.owner===CANVAS&&/^insert(Reorder|Inorder)Barrier$/.test(method.name)){
        // Canvas.insertReorderBarrier/insertInorderBarrier are empty on a software Canvas; the recording canvas overrides them.
        const type=r.typeOf(args[0]);
        if(r.isSubtype(type,'Landroid/view/DisplayListCanvas;'))return r.dispatch({owner:'Landroid/view/DisplayListCanvas;',name:method.name,parameters:[],result:'V',signature:'()V'},[args[0]],'virtual');
        if(r.isSubtype(type,DISPLAY))return r.dispatch({owner:DISPLAY,name:method.name==='insertReorderBarrier'?'enableZ':'disableZ',parameters:[],result:'V',signature:'()V'},[args[0]],'virtual');   // API 29+: RecordingCanvas.enableZ/disableZ
        return;
      }
      const [receiver,target]=args,view=r.object(receiver);
      if(method.name==='updateDisplayListIfDirty')return updateDisplayList(r,receiver);
      if(method.name==='getDrawingTime')return BigInt(drawingTime);
      if(method.name==='drawChild')return drawChild(r,receiver,target,args[2]);
      if(method.name==='draw')return drawView(r,receiver,target);
      if(method.name==='onDraw'){
        // View.onDraw is empty in AOSP. Native widgets have their own paint
        // implementations and must never inherit that empty implementation.
        if(r.isSubtype(view.type,'Landroid/widget/TextView;'))return drawNativeText(r,receiver,target);
        if(['ImageView','ProgressBar'].some(name=>r.isSubtype(view.type,`Landroid/widget/${name};`)))fail(`Native widget Canvas drawing is not connected: ${view.type}`);
        return;
      }
      if(method.name==='dispatchDraw'&&method.owner===VIEW)return; // Empty original View hook.
      if(method.name==='dispatchDraw'){
        if(view.fields.get(`${GROUP}->mTransition:Landroid/animation/LayoutTransition;`))fail('Animated child Canvas ordering requires the original transition engine');
        const save=canvas(r,target,'save',[],'I'),[w,h]=dimensions(view),padding=view.padding??{};
        try{
          if(view.clipToPadding!==false&&Object.values(padding).some(value=>value>0))canvas(r,target,'clipRect',['F','F','F','F'],'Z',[raw(padding.left??0),raw(padding.top??0),raw(w-(padding.right??0)),raw(h-(padding.bottom??0))]);
          for(const child of view.children??[])drawChild(r,receiver,target,child);
        }finally{canvas(r,target,'restoreToCount',['I'],'V',[save]);}
        return;
      }
      fail('Unknown custom Canvas View operation '+method.name);
    },
  };
}
