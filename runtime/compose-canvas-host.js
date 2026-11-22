import {APKError} from './apk-runtime.js?v=97135b36a679';
import {measureSkiaParagraph} from './skia-paragraph.js?v=97135b36a679';
import {getVectorGraphics} from './vector-native.js?v=97135b36a679';
import {deferRaster} from './deferred-raster.js?v=97135b36a679';
const VIEW='Landroid/view/View;',GROUP='Landroid/view/ViewGroup;',CANVAS='Landroid/graphics/Canvas;',DRAWABLE='Landroid/graphics/drawable/Drawable;',MATRIX='Landroid/graphics/Matrix;',PAINT='Landroid/graphics/Paint;';
const NODE='Landroid/graphics/RenderNode;',DISPLAY='Landroid/graphics/RecordingCanvas;',HOST='Landroid/graphics/RenderNode$AnimationHost;';   // API 33 RenderNode/RecordingCanvas (the hardware frontend View.updateDisplayListIfDirty records into)
import {isComposeOwner} from './compose-owner.js?v=97135b36a679';
const keys=new Set();
for(const signature of ['insertReorderBarrier()V','insertInorderBarrier()V'])keys.add('Landroid/graphics/Canvas;->'+signature);
for(const [owner,signatures] of [[VIEW,['draw(Landroid/graphics/Canvas;)V','onDraw(Landroid/graphics/Canvas;)V','dispatchDraw(Landroid/graphics/Canvas;)V','getDrawingTime()J','updateDisplayListIfDirty()Landroid/graphics/RenderNode;']],[GROUP,['dispatchDraw(Landroid/graphics/Canvas;)V','drawChild(Landroid/graphics/Canvas;Landroid/view/View;J)Z']]])for(const signature of signatures)keys.add(owner+'->'+signature);
const floats=new DataView(new ArrayBuffer(4)),raw=value=>{floats.setFloat32(0,value,true);return floats.getInt32(0,true);};
const fail=message=>{throw new APKError(message,{kind:'compose-canvas-boundary'});};

/** View/RenderNode software-canvas boundary. Compose layout, draw modifiers,
 * layers and shapes execute the APK's original AndroidComposeView/ViewLayer
 * methods. A semantics tree is never used to fabricate the rendered screen.
 */
/** The Skia replay of a View's Canvas content is deferred to the read of `view.contentRaster` and follows the progressive raster scale (src/deferred-raster.js). */
export function setContentRaster(r,view,graphics,target,width,height){
 // The deferred replay reads `target`, which is the View's own `contentCanvas` (see the callers): that record property keeps it alive for the collector.
 // force dark (src/force-dark-host.js): the replay takes the transform of the View's own RenderNode, decided when the raster is read
 const options=scale=>scale<1?{...r.contentRasterOptions,scale}:r.contentRasterOptions,forceDark=r.platform?.forceDarkHost;
 deferRaster(r,view,'contentRaster',scale=>graphics.snapshotCanvas(target,width,height,forceDark?forceDark.layerOptions(r,{ref:view.id},options(scale)):options(scale)));
}
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
    if(valid&&!recreate)return node;
    // Again while this View records (its draw asked for its own display list): as on Android, the original RenderNode.beginRecording refuses a second recording with
    // IllegalStateException("Recording currently in progress - missing #endRecording() call?"), which the caller may catch; the trace names the View.
    if(view.updatingDisplayList){r.record(`HOST View.updateDisplayListIfDirty re-entered while ${view.type} records its display list: RenderNode.beginRecording throws as on Android`);const [w,h]=dimensions(view);call(r,node,NODE,'beginRecording',['I','I'],DISPLAY,[w,h]);fail('RenderNode.beginRecording accepted a second recording of the same View');}
    const [width,height]=dimensions(view),bounds=view.bounds??{left:0,top:0,right:width,bottom:height};
    call(r,node,NODE,'setPosition',['I','I','I','I'],'Z',[bounds.left,bounds.top,bounds.right,bounds.bottom]);
    // View.updateDisplayListIfDirty -> RenderNode properties: elevation/translationZ cast the HWUI shadow, the Outline shapes it and clips.
    {const z=view.webTransform,elevation=z?.elevation??0,translationZ=z?.translationZ??0;
     call(r,node,NODE,'setElevation',['F'],'Z',[raw(elevation)]);call(r,node,NODE,'setTranslationZ',['F'],'Z',[raw(translationZ)]);
     const outline=elevation+translationZ>0||view.clipToOutline?platform.viewOutlineHost.outlineObject(r,receiver):null;
     call(r,node,NODE,'setOutline',['Landroid/graphics/Outline;'],'Z',[outline??null]);call(r,node,NODE,'setClipToOutline',['Z'],'Z',[view.clipToOutline?1:0]);}
    // View.updateDisplayListIfDirty (android-13.0.0_r1): "Reset any stretch effects as those are applied during the draw pass" -- hwui merges every RenderNode.stretch of a recording.
    call(r,node,NODE,'clearStretch',[],'Z',[]);
    const target=call(r,node,NODE,'beginRecording',['I','I'],DISPLAY,[width,height]);view.updatingDisplayList=true;view.displayListDirty=false;r.storeField(view.fields,`${VIEW}->mRecreateDisplayList:Z`,1);
    try{const sx=view.fields.get(`${VIEW}->mScrollX:I`)??0,sy=view.fields.get(`${VIEW}->mScrollY:I`)??0;if(sx||sy)canvas(r,target,'translate',['F','F'],'V',[raw(-sx),raw(-sy)]);call(r,receiver,VIEW,'draw',[CANVAS],'V',[target]);}
    catch(error){view.displayListDirty=true;r.storeField(view.fields,`${VIEW}->mRecreateDisplayList:Z`,1);throw error;}
    finally{view.updatingDisplayList=false;call(r,node,NODE,'endRecording',[],'V',[]);r.storeField(view.fields,`${VIEW}->mRecreateDisplayList:Z`,view.displayListDirty?1:0);}
    view.displayListGeneration=(view.displayListGeneration??0)+1;r.record(`HOST View.updateDisplayListIfDirty [original RenderNode/RecordingCanvas DEX; generation${view.displayListGeneration}]`);return node;
  };
  /** A lookup the host makes for itself (what the page shows, which path draws): the framework code it runs is not the app's and must not evict APK-visible trace entries. */
  const quietly=(r,body)=>{const muted=r.traceMuted;r.traceMuted=true;try{return body();}finally{r.traceMuted=muted;}};
  const styledButtonOf=(r,receiver)=>{const view=r.object(receiver);return view.styledButtonId??=quietly(r,()=>textStyleValue(r,receiver,'button','getResourceId','I',0))>>>0;};
  const textStyleValue=(r,receiver,attribute,method,result,fallback)=>{
    const view=r.object(receiver),table=platform.resources?.frameworkTable;
    if(!table||!view.context)return fallback;const id=table.findId('attr/'+attribute);if(!id)return fallback;
    const ids=r.newArray('[I',1);r.array(ids).elements=[id];let attrs=null;if(view.appliedNode){attrs=r.makeObject('Lapkweb/bridge/AttributeSet;');r.object(attrs).node=view.appliedNode;}
    const defStyle=view.defStyleAttr||table.findId(platform.drawableViewHost.defaultStyleName(r,view.type));
    const array=platform.styleBackend.obtain(r,platform.styleBackend.theme(r,view.context),attrs,ids,defStyle);
    const TA='Landroid/content/res/TypedArray;',read=(typed,index)=>call(r,typed,TA,method,method==='getInt'||method==='getResourceId'?['I','I']:['I'],result,method==='getInt'||method==='getResourceId'?[index,fallback]:[index]);
    try{if(call(r,array,TA,'hasValue',['I'],'Z',[0]))return read(array,0);}
    finally{call(r,array,TA,'recycle');}
    // TextView constructor: android:textAppearance (explicit, from the style or from the default style) supplies what the view's own attributes do not
    const appearanceId=table.findId('attr/textAppearance');if(!appearanceId||attribute==='textAppearance')return fallback;
    const aids=r.newArray('[I',1);r.array(aids).elements=[appearanceId];const holder=platform.styleBackend.obtain(r,platform.styleBackend.theme(r,view.context),attrs,aids,defStyle);let appearance=0;
    try{appearance=call(r,holder,TA,'getResourceId',['I','I'],'I',[0,0]);}finally{call(r,holder,TA,'recycle');}
    if(!appearance)return fallback;
    const fromAppearance=platform.styleBackend.obtain(r,platform.styleBackend.theme(r,view.context),null,ids,0,0,appearance);
    try{return call(r,fromAppearance,TA,'hasValue',['I'],'Z',[0])?read(fromAppearance,0):fallback;}finally{call(r,fromAppearance,TA,'recycle');}
  };
  const textColor=(r,receiver,hint)=>{
    const view=r.object(receiver);if(!hint&&view.textColor!=null){if(typeof view.textColor==='number')return view.textColor|0;const value=view.textColor.slice(1);return (Number.parseInt(value,16)|(value.length===6?0xff000000:0))|0;}
    // The TextView's own colours (setTextColor / setHintTextColor with a ColorStateList, or the ones its constructor read), else the style's, resolved for the View's state
    const list=(hint?view.tv?.hintTextColors:view.tv?.textColors)??textStyleValue(r,receiver,hint?'textColorHint':'textColor','getColorStateList','Landroid/content/res/ColorStateList;',null);
    if(!list)fail('Native TextView Canvas needs a resolved '+(hint?'hint':'text')+' color from its actual theme');
    const color=call(r,list,'Landroid/content/res/ColorStateList;','getDefaultColor',[],'I'),state=call(r,receiver,VIEW,'getDrawableState',[],'[I');return call(r,list,'Landroid/content/res/ColorStateList;','getColorForState',['[I','I'],'I',[state,color]);
  };
  /**
   * TextView.onDraw for a text that is drawn by its original Layout (textViewApi.layoutDrawn; view.textLayout from the measure pass): the Layout of the measured width, drawn
   * with the TextView's paint in the current text (or hint) colour, inside the box left by the compound padding, at the vertical gravity's offset. A horizontally scrolling
   * text (single line) is laid out unbounded: TextView.bringTextIntoView scrolls the view so that its line sits where the alignment puts it, which is the shift applied here.
   */
  const drawTextLayout=(r,receiver,target,{left,top,innerWidth,innerHeight,scrollX=0,scrollY=0,hint=false,color=null})=>{
    const view=r.object(receiver),LAYOUT='Landroid/text/Layout;',PAINT='Landroid/graphics/Paint;',layout=platform.textViewApi.layoutFor(r,receiver,view.textLayout.inner);
    call(r,platform.textViewApi.syncedPaint(r,receiver),PAINT,'setColor',['I'],'V',[color??textColor(r,receiver,hint)]);
    const gravity=platform.textViewApi.layoutGravity(r,receiver),abs=r.classes.has('Landroid/view/Gravity;')?call(r,null,'Landroid/view/Gravity;','getAbsoluteGravity',['I','I'],'I',[gravity,view.layoutDirection??0],'static'):gravity;
    const blockHeight=call(r,layout,LAYOUT,'getHeight',[],'I'),vertical=abs&0x70,dy=blockHeight>=innerHeight?0:vertical===0x10?(innerHeight-blockHeight)>>1:vertical===0x50?innerHeight-blockHeight:0;
    let dx=0;
    if(view.singleLine||view.horizontallyScrolling){
      const float=bits=>{const v=new DataView(new ArrayBuffer(4));v.setInt32(0,bits,true);return v.getFloat32(0,true);},lineLeft=Math.floor(float(call(r,layout,LAYOUT,'getLineLeft',['I'],'F',[0]))),lineRight=Math.ceil(float(call(r,layout,LAYOUT,'getLineRight',['I'],'F',[0]))),horizontal=abs&7;
      dx=-(horizontal===1?(lineRight-lineLeft<innerWidth?(lineRight+lineLeft)/2-innerWidth/2:lineLeft):horizontal===5?lineRight-innerWidth:lineLeft);
    }
    const save=canvas(r,target,'save',[],'I');
    try{canvas(r,target,'clipRect',['F','F','F','F'],'Z',[raw(left),raw(top),raw(left+innerWidth),raw(top+innerHeight)]);canvas(r,target,'translate',['F','F'],'V',[raw(left+dx-scrollX),raw(top+dy-scrollY)]);call(r,layout,LAYOUT,'draw',[CANVAS],'V',[target]);}
    finally{canvas(r,target,'restoreToCount',['I'],'V',[save]);}
  };
  const drawNativeText=(r,receiver,target)=>{
    const view=r.object(receiver);
    // CompoundButton(Context, AttributeSet, int, int) reads android:button from the tag, its style and the default style: a widget whose styles give none (SwitchCompat, which draws
    // its own track and thumb; Chip) has no indicator, and CompoundButton.onDraw draws the text alone. One whose style names an indicator the lab did not load still stops here.
    if(r.isSubtype(view.type,'Landroid/widget/CompoundButton;')&&!view.buttonDrawable&&!view.buttonDrawableSet){
      const button=styledButtonOf(r,receiver);
      if(button)fail(`CompoundButton Canvas needs its indicator drawable (android:button 0x${(button>>>0).toString(16)} of its style), which was not loaded`);
      view.buttonDrawableSet=true;
    }
    if(view.marquee||view.ellipsize)fail('Native TextView Canvas marquee/ellipsis layout is not connected');
    if(!view.textMetrics)fail('Native TextView Canvas requires completed actual font measurement');
    {const [cw,ch]=dimensions(view);for(const {drawable:d,x,y} of platform.textViewApi.compoundPlacements(r,receiver,cw,ch)){const save=canvas(r,target,'save',[],'I');try{canvas(r,target,'translate',['F','F'],'V',[raw(x),raw(y)]);call(r,d,DRAWABLE,'draw',[CANVAS],'V',[target]);}finally{canvas(r,target,'restoreToCount',['I'],'V',[save]);}}}   // TextView.onDraw: compound drawables first, then the text
    const displayed=String(view.ellipsizedText??view.displayText??view.text??''),hint=!displayed&&!!view.hint,text=hint?String(view.hint):displayed;if(!text)return;
    const [width,height]=dimensions(view),pad=platform.drawableViewHost.compoundPadding(r,receiver)??view.padding??{},innerWidth=Math.max(0,width-(pad.left??0)-(pad.right??0)),innerHeight=Math.max(0,height-(pad.top??0)-(pad.bottom??0));if(!innerWidth||!innerHeight)return;
    if(view.textLayout&&!hint){
      const scrollX=view.updatingDisplayList?0:view.fields.get(`${VIEW}->mScrollX:I`)??0,scrollY=view.updatingDisplayList?0:view.fields.get(`${VIEW}->mScrollY:I`)??0;
      drawTextLayout(r,receiver,target,{left:pad.left??0,top:pad.top??0,innerWidth,innerHeight,scrollX,scrollY});
      view.nativeCanvasText={source:'original android.text.Layout.draw ('+view.textLayout.reason+')',textLength:text.length,hint:false,gravity:view.gravity??0x800033};r.record('DRAW TextView text: original Layout.draw -> Canvas');
      return;
    }
    // Styled text (a Spanned with CharacterStyle spans: colours, sizes, typefaces, underlines per range): TextView.onDraw draws its Layout, and the spans change the paint run by run
    // (android.text.TextLine). The single-style paragraph below cannot show that, so the original StaticLayout the TextView builds (getLayout) draws itself on this Canvas.
    if(!hint&&!view.marquee){const TEXTVIEW='Landroid/widget/TextView;',CS='Ljava/lang/CharSequence;',SPANNED='Landroid/text/Spanned;',LAYOUT='Landroid/text/Layout;',source=call(r,receiver,TEXTVIEW,'getText',[],CS);
      if(source!==null&&source!==undefined&&typeof source!=='string'&&r.isSubtype(r.object(source).type,SPANNED)&&r.classes.has('Landroid/text/style/CharacterStyle;')){
        const spans=call(r,source,SPANNED,'getSpans',['I','I','Ljava/lang/Class;'],'[Ljava/lang/Object;',[0,displayed.length,r.classObject('Landroid/text/style/CharacterStyle;')]);
        const layout=r.array(spans).elements.length>0?call(r,receiver,TEXTVIEW,'getLayout',[],LAYOUT):null;
        if(layout!==null&&layout!==undefined){const gravity=view.gravity??0x800033,blockHeight=call(r,layout,LAYOUT,'getHeight',[],'I'),vertical=gravity&0x70,dy=vertical===0x10?(innerHeight-blockHeight)/2:vertical===0x50?innerHeight-blockHeight:0,save=canvas(r,target,'save',[],'I');
          try{const scrollX=view.updatingDisplayList?0:view.fields.get(`${VIEW}->mScrollX:I`)??0,scrollY=view.updatingDisplayList?0:view.fields.get(`${VIEW}->mScrollY:I`)??0;
            canvas(r,target,'clipRect',['F','F','F','F'],'Z',[raw(pad.left??0),raw(pad.top??0),raw(width-(pad.right??0)),raw(height-(pad.bottom??0))]);canvas(r,target,'translate',['F','F'],'V',[raw((pad.left??0)-scrollX),raw((pad.top??0)+dy-scrollY)]);
            call(r,layout,LAYOUT,'draw',[CANVAS],'V',[target]);
            view.nativeCanvasText={source:'original android.text.Layout.draw (styled spans)',textLength:text.length,hint:false,gravity,spans:r.array(spans).elements.length};r.record('DRAW TextView styled text: original Layout.draw with CharacterStyle spans -> Canvas');
          }finally{canvas(r,target,'restoreToCount',['I'],'V',[save]);}
          return;}}}
    const color=textColor(r,receiver,hint),typeface=call(r,receiver,'Landroid/widget/TextView;','getTypeface',[],'Landroid/graphics/Typeface;'),face=r.skiaHost.resolveTypeface(typeface),size=view.textSize||14;
    const gravity=view.gravity??textStyleValue(r,receiver,'gravity','getInt','I',0x800033),abs=r.classes.has('Landroid/view/Gravity;')?call(r,null,'Landroid/view/Gravity;','getAbsoluteGravity',['I','I'],'I',[gravity,view.layoutDirection??0],'static'):gravity;
    const horizontal=abs&7,vertical=abs&0x70,lines=text.split('\n'),font={textSize:size,flags:1,typefaceRef:typeface},metrics=r.skiaHost.measureText('',font).metrics,top=view.includeFontPadding===false?Math.round(metrics.ascent):Math.floor(metrics.bounds[1]),bottom=view.includeFontPadding===false?Math.round(metrics.descent):Math.ceil(metrics.bounds[3]);
    const nativeParagraph=!hint&&view.textParagraph,fontPadTop=nativeParagraph?view.textParagraph.padTop??0:0,blockHeight=nativeParagraph?view.textParagraph.height+fontPadTop+(view.textParagraph.padBottom??0):bottom-top+(lines.length-1)*(view.textLineHeight??bottom-top),dy=vertical===0x10?(innerHeight-blockHeight)/2:vertical===0x50?innerHeight-blockHeight:0,save=canvas(r,target,'save',[],'I');
    try{canvas(r,target,'clipRect',['F','F','F','F'],'Z',[raw(pad.left??0),raw(pad.top??0),raw(width-(pad.right??0)),raw(height-(pad.bottom??0))]);const scrollX=view.updatingDisplayList?0:view.fields.get(`${VIEW}->mScrollX:I`)??0,scrollY=view.updatingDisplayList?0:view.fields.get(`${VIEW}->mScrollY:I`)??0;
      // the paragraph is a raster drawn with its colour: under force dark, the colour of text (the node that draws text is foreground: lightened); the raster op is text (mHasText)
      if(nativeParagraph){const shown=platform.forceDarkHost?platform.forceDarkHost.textColor(r,receiver,color):color,renderWidth=view.textParagraph.layoutWidth,align=horizontal===1?'center':horizontal===5?'right':'left',extra=view.textParagraph.extra??{},key=JSON.stringify([text,renderWidth,size,face.weight,face.italic,face.families??null,face.fontVariations??null,shown,align,view.layoutDirection,view.maxLines,extra]);
        if(view.canvasTextRasterKey!==key){const result=measureSkiaParagraph(r.skia,hint?text:view.textBreakText??text,{width:renderWidth,textSize:size,weight:face.weight,italic:face.italic,families:face.families??null,fontVariations:face.fontVariations??null,nativeTypeface:face.custom?face.face:null,direction:view.layoutDirection??0,maxLines:view.maxLines??null,ellipsis:platform.textViewApi.ellipsizeKind(r,receiver)==='END'&&view.maxLines!=null?'\u2026':null,color:shown,alignment:align,raster:true,...extra});if(Math.abs(result.height-view.textParagraph.height)>.001)fail('Native widget paragraph differs from its completed measurement');const length=result.raster.dataURL.length,next=cachedTextRasterBytes-(textRasterSizes.get(view.id)??0)+length;if(next>32*1024*1024)fail('Native widget paragraph raster cache exceeds32MiB');cachedTextRasterBytes=next;textRasterSizes.set(view.id,length);view.canvasTextRaster=result.raster;view.canvasTextRasterKey=key;}
        r.skiaHost.recordNative(r.object(target).nativeCanvasHandle,{op:'raster',text:true,raster:view.canvasTextRaster,args:[(pad.left??0)+(horizontal===1?(innerWidth-renderWidth)/2:horizontal===5?innerWidth-renderWidth:0)-scrollX,(pad.top??0)+dy+fontPadTop-scrollY]});   // fontPadTop: StaticLayout's first line starts at the font's top, above the ascent the paragraph starts at
      }else{const paint={argb:color>>>0,color:color>>>0,flags:1,style:0,strokeWidth:0,strokeMiter:4,strokeCap:0,strokeJoin:0,blendMode:3,textSize:size,textScaleX:1,textSkewX:0,letterSpacing:0,wordSpacing:0,hinting:1,...r.skiaHost.faceState(face)};   // the face the text was measured with: an app or system font, its variation, the synthetic styles
        lines.forEach((line,index)=>{const advance=r.skiaHost.measureText(line,font).width,dx=horizontal===1?(innerWidth-advance)/2:horizontal===5?innerWidth-advance:0;r.skiaHost.recordNative(r.object(target).nativeCanvasHandle,{op:'paragraphRun',text:line,args:[(pad.left??0)+dx-scrollX,(pad.top??0)+dy-top+index*(view.textLineHeight??bottom-top)-scrollY],isRtl:!!view.layoutDirection,paint});});
      }
      view.nativeCanvasText={source:'official-Skia/actual measured system-widget text',textLength:text.length,hint,gravity,color:color>>>0};r.record('DRAW system TextView/EditText: actual measured text + themed color -> Skia glyph/paragraph Canvas');
    }finally{canvas(r,target,'restoreToCount',['I'],'V',[save]);}
  };
  const contentDraw=(r,receiver,target)=>{
    const view=r.object(receiver);
    if(!view.willNotDraw)call(r,receiver,VIEW,'onDraw',[CANVAS],'V',[target]);
    // a group whose own draw(Canvas) override is being captured (renderTree): its children are the page's elements; what the override draws after super.draw returns is drawn over them
    if(view.groupDrawCapture){view.groupDrawSplit=getVectorGraphics(r).get(r.object(target).nativeCanvasHandle,'canvas').draws.length;return;}
    call(r,receiver,r.isSubtype(view.type,GROUP)?GROUP:VIEW,'dispatchDraw',[CANVAS],'V',[target]);
  };
  // What a parent calls is View.draw(Canvas): a class that overrides it runs its override (SwitchCompat sets the bounds of its track and thumb there, then calls super.draw), and
  // View.draw then draws the content only (onDraw, the children): the page draws the background and the foreground as layers of their own.
  const sourceDraw=(r,receiver,target)=>{
    const view=r.object(receiver);
    if(!view.contentOnlyDraw&&r.objectOverride(view.type,'draw(Landroid/graphics/Canvas;)V')){view.contentOnlyDraw=true;try{call(r,receiver,VIEW,'draw',[CANVAS],'V',[target]);}finally{view.contentOnlyDraw=false;}return;}
    contentDraw(r,receiver,target);
  };
  const drawable=(r,ref,target,w,h)=>{
    if(!ref)return;
    call(r,ref,DRAWABLE,'setBounds',['I','I','I','I'],'V',[0,0,w,h]);
    call(r,ref,DRAWABLE,'draw',[CANVAS],'V',[target]);
  };
  const drawBackground=(r,receiver,target)=>{
    const view=r.object(receiver),[w,h]=dimensions(view);
    // View.drawBackground records the background in a RenderNode of its own with USAGE_BACKGROUND: under force dark its draws are a background scope of this recording
    const scope=(view.backgroundDrawable||view.background)&&r.skia?.rasterizeCanvas&&platform.forceDarkHost?.backgroundTransform(r,receiver)?r.object(target).nativeCanvasHandle??r.object(target).fields.get('Landroid/graphics/BaseCanvas;->mNativeCanvasWrapper:J'):null;
    if(scope!==null&&scope!==undefined)r.skiaHost.recordNative(scope,{op:'usageBegin',usage:1});
    try{drawBackgroundContent(r,receiver,target,view,w,h);}finally{if(scope!==null&&scope!==undefined)r.skiaHost.recordNative(scope,{op:'usageEnd'});}
  };
  const drawBackgroundContent=(r,receiver,target,view,w,h)=>{
    if(view.backgroundDrawable)drawable(r,view.backgroundDrawable,target,w,h);
    else if(view.background){
      const color=typeof view.background==='string'?Number.parseInt(view.background.slice(1),16)|0:view.background|0;
      const paint=view.canvasBackgroundPaint??=r.allocate(PAINT);
      if(!r.object(paint).webPaint)call(r,paint,PAINT,'<init>',[],'V',[],'direct');
      call(r,paint,PAINT,'setColor',['I'],'V',[color]);canvas(r,target,'drawRect',['F','F','F','F',PAINT],'V',[raw(0),raw(0),raw(w),raw(h),paint]);
    }
  };
  // A View with a layer (setLayerType SOFTWARE or HARDWARE) draws into its own offscreen layer, background included, and its onDraw may cut that layer (ShapeableImageView
  // clears its corners with a DST_OUT path): its background is drawn in its content layer, which the page then shows instead of a background of its own.
  const leafDraw=(r,receiver,target)=>{
    const view=r.object(receiver);view.backgroundInContent=(view.layerType??0)>0&&!!(view.backgroundDrawable||view.background);
    if(view.backgroundInContent)drawBackground(r,receiver,target);
    sourceDraw(r,receiver,target);
  };
  const drawView=(r,receiver,target)=>{
    const view=r.object(receiver),[w,h]=dimensions(view);
    if(view.visibility===4||view.visibility===8)return;
    drawBackground(r,receiver,target);
    sourceDraw(r,receiver,target);
    // View.draw step 5: "if (mOverlay != null && !mOverlay.isEmpty()) mOverlay.getOverlayView().dispatchDraw(canvas)", after the children and before the foreground
    if(view.overlay){const OVERLAY='Landroid/view/ViewOverlay;',group=platform.viewApi.overlayView(r,receiver);if(group&&!call(r,view.overlay,OVERLAY,'isEmpty',[],'Z'))call(r,group,GROUP,'dispatchDraw',[CANVAS],'V',[target]);}
    if(view.buttonDrawable)platform.drawableViewHost.drawButton(r,receiver,target,w,h);
    if(view.foregroundDrawable){
      const bounds=view.foregroundBounds;if(!bounds)fail('Foreground must be positioned by the original Gravity before Canvas draw');
      call(r,view.foregroundDrawable,DRAWABLE,'setBounds',['I','I','I','I'],'V',[bounds.left,bounds.top,bounds.right,bounds.bottom]);
      call(r,view.foregroundDrawable,DRAWABLE,'draw',[CANVAS],'V',[target]);
    }
  };
  const drawChild=(r,parentRef,target,childRef,disappearing=false)=>{
    const parent=r.object(parentRef),child=r.object(childRef);
    if(!disappearing&&(child.visibility===4||child.visibility===8))return 0;
    if(!child.bounds)fail('Custom Canvas child has not completed its original layout');
    const [w,h]=dimensions(child),save=canvas(r,target,'save',[],'I');
    try{
      const sx=parent.fields.get(`${VIEW}->mScrollX:I`)??0,sy=parent.fields.get(`${VIEW}->mScrollY:I`)??0;
      canvas(r,target,'translate',['F','F'],'V',[raw(child.bounds.left-sx),raw(child.bounds.top-sy)]);
      const legacy=platform.viewApi.legacyAnimation(r,parentRef,childRef);   // View.draw(Canvas, ViewGroup, long) -> applyLegacyAnimation: the Animation's Transformation for this frame
      if(legacy?.matrix)canvas(r,target,'concat',[MATRIX],'V',[legacy.matrix]);
      const matrix=platform.viewTransformHost.snapshot(r,childRef);
      if(matrix){
        const ref=child.canvasTransform??=r.allocate(MATRIX);
        if(!child.canvasTransformInitialized){call(r,ref,MATRIX,'<init>',[],'V',[],'direct');child.canvasTransformInitialized=true;}
        const values=child.canvasTransformValues??=r.newArray('[F',9);r.array(values).elements=matrix.map(raw);
        call(r,ref,MATRIX,'setValues',['[F'],'V',[values]);canvas(r,target,'concat',[MATRIX],'V',[ref]);
      }
      if(parent.clipChildren!==false)canvas(r,target,'clipRect',['F','F','F','F'],'Z',[raw(0),raw(0),raw(w),raw(h)]);
      platform.viewOutlineHost.clip(r,childRef,target);
      const alpha=(child.renderAlpha??child.alpha??1)*(legacy?.alpha??1);
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
    /** The TextView's current text colour (its own, or the one its style / TextAppearance resolves to in its theme, for its drawable state). */
    textColor:(r,receiver)=>textColor(r,receiver,false),
    drawTextLayout,
    /** The ColorStateList the TextView constructor would have read: android:textColor of the view, its style or its text appearance (null when the theme gives none). */
    themeTextColors:(r,receiver)=>textStyleValue(r,receiver,'textColor','getColorStateList','Landroid/content/res/ColorStateList;',null),
    themeHintTextColors:(r,receiver)=>quietly(r,()=>textStyleValue(r,receiver,'textColorHint','getColorStateList','Landroid/content/res/ColorStateList;',null)),
    /** The android:button resource the CompoundButton constructor read from the tag, its style and the default style (0: none, the widget has no indicator: a Chip). Cached. */
    styledButton:styledButtonOf,
    /** TextView.getGravity as the constructor leaves it: the view's own gravity, or android:gravity of its style / default style (a Button's is center). */
    textGravity:(r,receiver)=>{const view=r.object(receiver);if(view.gravity!=null)return view.gravity;return view.styledGravity??=textStyleValue(r,receiver,'gravity','getInt','I',0x800033);},
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
      // An original framework class whose onDraw the page needs (see visit). LinearLayout.onDraw draws only its dividers: a layout without a divider drawable is left alone.
      const LINEAR_ONDRAW='Landroid/widget/LinearLayout;',DIVIDER='Landroid/widget/LinearLayout;->mDivider:Landroid/graphics/drawable/Drawable;';
      const frameworkDraws=(r,view,onDraw)=>r.dex.bootClasses?.has(onDraw.owner)&&(onDraw.owner!==LINEAR_ONDRAW||!!view.fields.get(DIVIDER));

      const seen=new Set();drawingTime=Math.floor(r.platform?.lastFrameMs??r.clock.now());
      const visit=(receiver,depth=0)=>{
        const view=r.object(receiver);if(seen.has(view.id)||seen.size>=4096||depth>64)fail('Cyclic/excessive custom Canvas View tree');seen.add(view.id);
        if(view.visibility===4||view.visibility===8)return;
        // A View whose class (in the app's DEX) overrides onDraw paints itself through the original Canvas callbacks. A ViewGroup that does so (react-native-svg's SvgView draws its whole
        // vector output from onDraw) keeps its children as separate layers: only its own onDraw runs here, and the walk continues into the children.
        // The same holds for an original framework class that draws itself in onDraw (the thumb of the seek bars, NumberPicker's wheel, the month and clock faces of the pickers,
        // CheckedTextView's check mark, the dividers of the original LinearLayout): the page has no element for that drawing, so it is the View's content layer. What such a
        // class cannot draw in this VM (an explicit failure of the lab, never a Java exception) leaves the View as the page shows it without the layer, and is said once.
        const isGroup=r.isSubtype(view.type,GROUP),onDraw=r.objectOverride(view.type,'onDraw(Landroid/graphics/Canvas;)V'),ownDraw=!!onDraw&&r.dex.classes.has(view.type);
        // A determinate ProgressBar (the lab's ProgressBar: ProgressBar.onDraw is drawTrack, its progress drawable at the current level) is drawn as Android draws it, with the
        // theme's tints, instead of the page's own progress bar; an indeterminate one, an animation of every frame, stays the page's.
        const hostBar=!onDraw&&!isGroup&&r.isSubtype(view.type,'Landroid/widget/ProgressBar;')&&!view.indeterminate&&!!view.pb?.current&&!view.frameworkDrawFailed&&!!r.skiaHost;
        const frameworkDraw=hostBar||!!onDraw&&!ownDraw&&!view.frameworkDrawFailed&&r.skiaHost&&frameworkDraws(r,view,onDraw);
        const overridesDraw=ownDraw||frameworkDraw;
        const guarded=draw=>{
          if(!frameworkDraw)return draw();
          try{return draw();}catch(failure){
            if(failure?.name!=='APKError'||failure.details?.kind==='instruction-budget')throw failure;
            view.frameworkDrawFailed=true;view.contentRaster=null;view.canvasChildrenCaptured=false;
            platform.noteFrameworkGap?.(r,`framework-ondraw:${view.type}`,`${view.type.slice(1,-1).replaceAll('/','.')}.onDraw: the widget is shown on the page without what it draws itself (${String(failure.message).replace(/\s+/g,' ').replace(/^(?:L[^ ]+ \[[^\]]*\] at PC 0x[\da-f]+: )+/i,'').slice(0,200)})`);
            return false;
          }
        };
        // A group of the app whose class overrides draw(Canvas) (TextInputLayout draws its floating hint and the box's underline there, after super.draw has drawn the children):
        // the override runs as a parent would call it; what it draws before its children (onDraw) is the content layer, what it draws after them is a layer over them (overlaySVG).
        const composeOwner=isComposeOwner(r,view.type),drawOverride=isGroup&&!composeOwner?r.objectOverride(view.type,'draw(Landroid/graphics/Canvas;)V'):null,appGroupDraw=!!drawOverride&&!r.dex.bootClasses?.has(drawOverride.owner);
        const customLeaf=overridesDraw&&!isGroup,customGroup=overridesDraw&&isGroup&&!view.willNotDraw&&!composeOwner&&!appGroupDraw;
        if(appGroupDraw){
          const [gw,gh]=dimensions(view);
          if(view.laidOut&&gw&&gh&&r.skiaHost){
            const graphics=getVectorGraphics(r),target=view.contentCanvas??=r.allocate(CANVAS),overlay=view.overlayCanvas??=r.allocate(CANVAS);
            if(!view.contentCanvasInitialized){call(r,target,CANVAS,'<init>',[],'V',[],'direct');view.contentCanvasInitialized=true;}
            if(!view.overlayCanvasInitialized){call(r,overlay,CANVAS,'<init>',[],'V',[],'direct');view.overlayCanvasInitialized=true;}
            graphics.resetCanvas(target,gw,gh);graphics.resetCanvas(overlay,gw,gh);
            view.contentOnlyDraw=true;view.groupDrawCapture=true;view.groupDrawSplit=null;
            try{call(r,receiver,VIEW,'draw',[CANVAS],'V',[target]);}finally{view.contentOnlyDraw=false;view.groupDrawCapture=false;}
            const draws=graphics.get(r.object(target).nativeCanvasHandle,'canvas').draws,after=draws.splice(view.groupDrawSplit??draws.length);
            graphics.get(r.object(overlay).nativeCanvasHandle,'canvas').draws.push(...after);
            if(draws.length)setContentRaster(r,view,graphics,target,gw,gh);else view.contentRaster=null;
            if(after.length){deferRaster(r,view,'overlaySVG',scale=>{const options=scale<1?{...r.layerRasterOptions,scale}:r.layerRasterOptions;return graphics.snapshotCanvas(overlay,gw,gh,platform.forceDarkHost?platform.forceDarkHost.layerOptions(r,receiver,options):options);});}else view.overlaySVG=null;
            r.record(`DRAW ViewGroup draw override: original ${view.type} -> Skia CPU (${draws.length} under, ${after.length} over its children)`);
          }
        }
        if(customGroup){
          const [gw,gh]=dimensions(view);
          if(view.laidOut&&gw&&gh&&r.skiaHost)guarded(()=>{
            const target=view.contentCanvas??=r.allocate(CANVAS);
            if(!view.contentCanvasInitialized){call(r,target,CANVAS,'<init>',[],'V',[],'direct');view.contentCanvasInitialized=true;}
            const graphics=getVectorGraphics(r);graphics.resetCanvas(target,gw,gh);
            call(r,receiver,VIEW,'onDraw',[CANVAS],'V',[target]);
            setContentRaster(r,view,graphics,target,gw,gh);r.record(`DRAW custom ViewGroup onDraw: original ${view.type} -> Skia CPU`);
          });
        }
        if(frameworkDraw&&customLeaf){
          const [width,height]=dimensions(view);if(!view.laidOut||!width||!height)return;
          if(guarded(()=>{
            const target=view.contentCanvas??=r.allocate(CANVAS);
            if(!view.contentCanvasInitialized){call(r,target,CANVAS,'<init>',[],'V',[],'direct');view.contentCanvasInitialized=true;}
            const graphics=getVectorGraphics(r);graphics.resetCanvas(target,width,height);
            leafDraw(r,receiver,target);
            setContentRaster(r,view,graphics,target,width,height);view.canvasChildrenCaptured=true;
            r.record(`DRAW framework View: original ${view.type} onDraw -> Skia CPU`);
          })!==false)return;
        }
        if(composeOwner||customLeaf&&ownDraw){
          const [width,height]=dimensions(view);if(!view.laidOut||!width||!height)return;
          if(!r.skiaHost)fail('Compose drawing requires the verified Skia Canvas backend');
          const target=view.contentCanvas??=r.allocate(CANVAS);
          if(!view.contentCanvasInitialized){call(r,target,CANVAS,'<init>',[],'V',[],'direct');view.contentCanvasInitialized=true;}
          const graphics=getVectorGraphics(r);graphics.resetCanvas(target,width,height);
          if(composeOwner){
            // The Compose owner draws into its RenderNode's recording DisplayListCanvas (hardware path: GraphicsLayer RenderNodes, reorder barriers, HWUI-model shadows); the software Canvas below only replays that node.
            const node=updateDisplayList(r,receiver),handle=[...r.object(node).fields.entries()].find(([key])=>key.endsWith('->mNativeRenderNode:J'))?.[1];
            if(handle===undefined)fail('Compose owner RenderNode has no native handle');
            r.skiaHost.recordNative(r.object(target).nativeCanvasHandle,{op:'renderNode',node:handle});
          }else leafDraw(r,receiver,target);
          setContentRaster(r,view,graphics,target,width,height);view.canvasChildrenCaptured=true;
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
      if(method.name==='draw')return view.contentOnlyDraw?contentDraw(r,receiver,target):drawView(r,receiver,target);
      if(method.name==='onDraw'){
        // View.onDraw is empty in AOSP. Native widgets have their own paint
        // implementations and must never inherit that empty implementation.
        if(r.isSubtype(view.type,'Landroid/widget/TextView;'))return drawNativeText(r,receiver,target);
        if(r.isSubtype(view.type,'Landroid/widget/ImageView;')){   // ImageView.onDraw: nothing without a drawable, otherwise the drawable placed by padding / scale type / image matrix
          if(view.imageDrawable){const [w,h]=dimensions(view);platform.drawableViewHost.drawImage(r,receiver,target,w,h);}
          return;
        }
        if(r.isSubtype(view.type,'Landroid/widget/ProgressBar;'))return r.dispatch({owner:'Landroid/widget/ProgressBar;',name:'drawTrack',parameters:['Landroid/graphics/Canvas;'],result:'V',signature:'(Landroid/graphics/Canvas;)V'},[receiver,target],'virtual');   // ProgressBar.onDraw: drawTrack, which AbsSeekBar overrides (src/progress-bar-api-host.js)
        return;
      }
      if(method.name==='dispatchDraw'&&method.owner===VIEW)return; // Empty original View hook.
      if(method.name==='dispatchDraw'){
        const save=canvas(r,target,'save',[],'I'),[w,h]=dimensions(view),padding=view.padding??{};
        try{
          if(view.clipToPadding!==false&&Object.values(padding).some(value=>value>0))canvas(r,target,'clipRect',['F','F','F','F'],'Z',[raw(padding.left??0),raw(padding.top??0),raw(w-(padding.right??0)),raw(h-(padding.bottom??0))]);
          platform.viewGroupApi.beforeDispatchDraw(r,receiver);
          for(const child of platform.viewGroupApi.drawOrder(r,receiver))drawChild(r,receiver,target,child);
          for(const child of platform.viewGroupApi.disappearing(r,receiver))drawChild(r,receiver,target,child,true);   // "Draw any disappearing views that have animations": whatever their visibility
          platform.viewGroupApi.afterDispatchDraw(r,receiver);
        }finally{canvas(r,target,'restoreToCount',['I'],'V',[save]);}
        return;
      }
      fail('Unknown custom Canvas View operation '+method.name);
    },
  };
}
