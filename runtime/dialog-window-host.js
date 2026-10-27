import { APKError } from './apk-runtime.js?v=f1c4bcc7c53e';
import { getVectorGraphics } from './vector-native.js?v=f1c4bcc7c53e';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=f1c4bcc7c53e';
const VIEW='Landroid/view/View;',GROUP='Landroid/view/ViewGroup;',FRAME='Landroid/widget/FrameLayout;',WINDOW='Landroid/view/Window;',PHONE='Lcom/android/internal/policy/PhoneWindow;',WM='Landroid/view/WindowManager;',WMI='Landroid/view/WindowManagerImpl;',LP='Landroid/view/WindowManager$LayoutParams;',VLP='Landroid/view/ViewGroup$LayoutParams;',CTX='Landroid/content/Context;',CTXW='Landroid/view/ContextThemeWrapper;',THEME='Landroid/content/res/Resources$Theme;',RECT='Landroid/graphics/Rect;',TOKEN='Lapkweb/bridge/WindowToken;',ACTIVITY='Landroid/app/Activity;',DIALOG='Landroid/app/Dialog;',TYPED='Landroid/util/TypedValue;';
const floatBuffer=new DataView(new ArrayBuffer(4)),bits=value=>{floatBuffer.setFloat32(0,value,true);return floatBuffer.getInt32(0,true);},number=value=>{floatBuffer.setInt32(0,value,true);return floatBuffer.getFloat32(0,true);};
const keys=new Set(),add=(owner,methods)=>methods.forEach(method=>keys.add(owner+'->'+method));
add(WMI,['<init>(Landroid/content/Context;)V','getDefaultDisplay()Landroid/view/Display;','addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V','updateViewLayout(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V','removeView(Landroid/view/View;)V','removeViewImmediate(Landroid/view/View;)V']);
for(const key of [...keys])if(key.startsWith(WMI))keys.add(WM+key.slice(WMI.length));
add(PHONE,['<init>(Landroid/content/Context;)V']);
add(LP,['<init>()V','<init>(I)V','<init>(III)V','<init>(IIIII)V','<init>(IIIIIII)V','setTitle(Ljava/lang/CharSequence;)V','getTitle()Ljava/lang/CharSequence;']);
add(CTXW,['<init>()V','<init>(Landroid/content/Context;I)V','<init>(Landroid/content/Context;Landroid/content/res/Resources$Theme;)V']);
add('Landroid/app/Dialog;',['getOnBackInvokedDispatcher()Landroid/window/OnBackInvokedDispatcher;']);
add(WINDOW,['getOnBackInvokedDispatcher()Landroid/window/OnBackInvokedDispatcher;','getContext()Landroid/content/Context;','getWindowManager()Landroid/view/WindowManager;','getLayoutInflater()Landroid/view/LayoutInflater;','getAttributes()Landroid/view/WindowManager$LayoutParams;','setAttributes(Landroid/view/WindowManager$LayoutParams;)V','setLayout(II)V','setGravity(I)V','addFlags(I)V','clearFlags(I)V','setFlags(II)V','setSoftInputMode(I)V','setDimAmount(F)V','setType(I)V','setFormat(I)V','setBackgroundDrawable(Landroid/graphics/drawable/Drawable;)V','setBackgroundDrawableResource(I)V','setWindowManager(Landroid/view/WindowManager;Landroid/os/IBinder;Ljava/lang/String;)V','setWindowManager(Landroid/view/WindowManager;Landroid/os/IBinder;Ljava/lang/String;Z)V','setCallback(Landroid/view/Window$Callback;)V','getCallback()Landroid/view/Window$Callback;','setOnWindowDismissedCallback(Landroid/view/Window$OnWindowDismissedCallback;)V','setOnWindowSwipeDismissedCallback(Landroid/view/Window$OnWindowSwipeDismissedCallback;)V','getDecorView()Landroid/view/View;','peekDecorView()Landroid/view/View;','requestFeature(I)Z','hasFeature(I)Z','setContentView(Landroid/view/View;)V','setContentView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V','setContentView(I)V','addContentView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V','findViewById(I)Landroid/view/View;','isDestroyed()Z','destroy()V','setCloseOnTouchOutside(Z)V','setCloseOnSwipeEnabled(Z)V','closeAllPanels()V','getCurrentFocus()Landroid/view/View;','setTitle(Ljava/lang/CharSequence;)V']);
add(VIEW,['getSystemUiVisibility()I','setSystemUiVisibility(I)V','getWindowToken()Landroid/os/IBinder;','getApplicationWindowToken()Landroid/os/IBinder;','hasWindowFocus()Z','getWindowVisibility()I','dispatchWindowFocusChanged(Z)V','onWindowFocusChanged(Z)V']);
const fail=(message,details={})=>{throw new APKError(message,{kind:'web-window-transport',...details});};
const same=(a,b)=>a?.ref===b?.ref,parameters=s=>s.slice(1,s.indexOf(')')).match(/\[*L[^;]+;|\[*[ZBCSIFJD]/g)||[];
/** Native OS/window-compositor transport. Dialog and Compose lifecycle,
 * composition, layout and semantics run their original DEX. The PhoneWindow
 * content adapter is explicitly a Web boundary, never a claim to run its full
 * Java policy. Roots are registered only by actual WindowManager.addView. */
export function createDialogWindowHost(platform){
 const records=gcRoot(new Map()),managers=gcRoot(new Map());let sequence=0,display=null;
 const call=(r,ref,owner,name,signature,values=[],mode='virtual')=>r.dispatch({owner,name,signature,parameters:parameters(signature),result:signature.slice(signature.indexOf(')')+1)},r.argumentWords(parameters(signature),values,mode==='static'?{}:{receiver:ref}),mode);
 const set=(r,ref,owner,name,type,value)=>r.storeField(r.object(ref).fields,`${owner}->${name}:${type}`,value);
 const field=(r,ref,name,fallback=0,type='I')=>r.object(ref).fields.get(`${['width','height'].includes(name)?VLP:LP}->${name}:${type}`)??fallback;
 const rootOf=(r,ref)=>{const seen=new Set();while(r.object(ref).parent){if(seen.has(ref.ref)||seen.size>=4096)fail('Cyclic window View hierarchy');seen.add(ref.ref);ref=r.object(ref).parent;}return ref;};
 const recordFor=(r,ref)=>records.get(rootOf(r,ref).ref)||null;
 const ownerActivity=(r,context)=>{const seen=new Set();while(context){if(seen.has(context.ref)||seen.size>=64)fail('Cyclic window context chain');seen.add(context.ref);const frame=platform.frames.find(frame=>same(frame.activity,context)&&!frame.finished);if(frame)return frame;const o=r.object(context);context=o.baseContext||o.fields.get('Landroid/content/ContextWrapper;->mBase:Landroid/content/Context;');}return null;};
 const newParams=(r,width=-1,height=-1,type=2,flags=0,format=-1)=>{const ref=r.makeObject(LP);set(r,ref,VLP,'width','I',width);set(r,ref,VLP,'height','I',height);for(const[name,value]of Object.entries({type,flags,format,x:0,y:0,gravity:0,softInputMode:0}))set(r,ref,LP,name,'I',value);set(r,ref,LP,'alpha','F',bits(1));set(r,ref,LP,'dimAmount','F',bits(1));return ref;};
 const frameView=(r,context)=>{const ref=r.allocate(FRAME);call(r,ref,FRAME,'<init>','(Landroid/content/Context;)V',[context],'direct');return ref;};
 const manager=(r,context,parentWindow=null)=>{const key=`${context.ref}:${parentWindow?.ref||0}`;if(!managers.has(key)){const ref=r.makeObject(WMI);Object.assign(r.object(ref),{windowContext:context,parentWindow});managers.set(key,ref);}return managers.get(key);};
 const windowData=(r,ref)=>{const object=r.object(ref);object.windowContext??=object.host;if(!object.windowContext)fail('Window has no actual Context');object.attributes??=newParams(r);object.features??=new Set([0,6]);return object;};
 // PhoneWindow.generateLayout theme policy (windowIsFloating, background dim, windowBackground) read through the original Theme.resolveAttribute.
 const themeValue=(r,context,attr)=>{const theme=call(r,context,CTX,'getTheme',`()${THEME}`),value=r.allocate(TYPED);call(r,value,TYPED,'<init>','()V',[],'direct');if(!call(r,theme,THEME,'resolveAttribute',`(I${TYPED}Z)Z`,[attr,value,1]))return null;const f=r.object(value).fields;return{type:f.get(`${TYPED}->type:I`)??0,data:f.get(`${TYPED}->data:I`)|0,resourceId:f.get(`${TYPED}->resourceId:I`)|0};};
 const applyThemePolicy=(r,w)=>{const c=w.windowContext,floating=themeValue(r,c,0x01010057),dim=themeValue(r,c,0x0101021f),amount=themeValue(r,c,0x01010032);
  if(floating?.data){set(r,w.attributes,VLP,'width','I',-2);set(r,w.attributes,VLP,'height','I',-2);}
  if(dim?dim.data:floating?.data){set(r,w.attributes,LP,'flags','I',field(r,w.attributes,'flags')|2);set(r,w.attributes,LP,'dimAmount','F',amount?.type===4?amount.data:bits(0.5));}
  const background=w.explicitBackground?null:themeValue(r,c,0x01010054);if(background){if(background.type>=0x1c&&background.type<=0x1f)call(r,w.decor,VIEW,'setBackgroundColor','(I)V',[background.data]);else if(background.resourceId)call(r,w.decor,VIEW,'setBackgroundResource','(I)V',[background.resourceId]);}};
 const ensureDecor=(r,ref)=>{const w=windowData(r,ref);if(!w.decor){w.decor=frameView(r,w.windowContext);w.content=frameView(r,w.windowContext);r.object(w.content).androidId=0x01020002;call(r,w.decor,GROUP,'addView','(Landroid/view/View;)V',[w.content]);r.object(w.decor).surfaceWindow=ref;applyThemePolicy(r,w);}return w.decor;};
 const visible=(r,record)=>record.attached&&(r.object(record.root).visibility??0)===0;
 const focusedRoot=r=>[...records.values()].reverse().find(record=>visible(r,record)&&!(field(r,record.params,'flags')&8))?.root??r.root;
 const focusTree=(r,root,focused)=>call(r,root,VIEW,'dispatchWindowFocusChanged','(Z)V',[focused?1:0]);
 const updateFocus=r=>{const target=focusedRoot(r);for(const record of records.values()){const focused=visible(r,record)&&same(target,record.root);if(record.focused!==focused){record.focused=focused;focusTree(r,record.root,focused);}}if(r.root){const focused=same(target,r.root),object=r.object(r.root);if(object.surfaceWindowFocused!==focused){object.surfaceWindowFocused=focused;focusTree(r,r.root,focused);}}};
 const layout=r=>{for(const record of records.values())if(record.attached)platform.viewLayoutHost.rootReady(r,record.root);};
 const dimensions=(r,record)=>{const view=r.object(record.root),width=Math.max(0,(view.measuredWidth??view.bounds?.right??0)&0xffffff),height=Math.max(0,(view.measuredHeight??view.bounds?.bottom??0)&0xffffff);if(!width||!height)return{width:0,height:0,x:0,y:0};if(!r.classes.has('Landroid/view/Gravity;'))fail('Original AOSP Gravity DEX is required for window placement');const container=r.allocate(RECT),out=r.allocate(RECT);call(r,container,RECT,'<init>','(IIII)V',[0,0,platform.device.widthDp,platform.device.heightDp],'direct');call(r,out,RECT,'<init>','()V',[],'direct');call(r,null,'Landroid/view/Gravity;','apply','(IIILandroid/graphics/Rect;IILandroid/graphics/Rect;)V',[field(r,record.params,'gravity'),width,height,container,field(r,record.params,'x'),field(r,record.params,'y'),out],'static');const f=r.object(out).fields;return{width,height,x:f.get(`${RECT}->left:I`)??0,y:f.get(`${RECT}->top:I`)??0};};
 const remove=(r,ref)=>{const record=records.get(ref.ref);if(!record)r.throwJava('Ljava/lang/IllegalArgumentException;','View not attached to this WindowManager');record.attached=false;platform.attachTree(r,ref,false);records.delete(ref.ref);updateFocus(r);r.record(`WINDOW remove actual root ${ref.ref}`);};
 const addView=(r,managerRef,ref,params)=>{if(!r.isSubtype(r.object(ref).type,VIEW)||!r.isSubtype(r.object(params).type,LP))r.throwJava('Ljava/lang/IllegalArgumentException;','WindowManager requires View and WindowManager.LayoutParams');if(records.has(ref.ref)||r.object(ref).attached||r.object(ref).parent)r.throwJava('Ljava/lang/IllegalStateException;','View already belongs to a window or parent');if(records.size>=16)fail('Window surface limit16 exceeded');const m=r.object(managerRef),frame=ownerActivity(r,m.windowContext);if(!frame)fail('Application windows require an actual Activity context/token');const type=field(r,params,'type',2);if(![2,1000,1001,1002].includes(type))fail('External/system window type is unavailable',{windowType:type});const window=r.object(ref).surfaceWindow??null;call(r,ref,VIEW,'setLayoutParams',`(${VLP})V`,[params]);const record={id:++sequence,root:ref,params,window,ownerActivity:frame.activity,context:m.windowContext,token:r.makeObject(TOKEN),attached:true,focused:false,kind:window?'dialog':type>=1000?'popup':'window'};records.set(ref.ref,record);r.object(ref).surfaceRecord=record;platform.attachTree(r,ref,true);platform.viewLayoutHost.rootReady(r,ref);updateFocus(r);platform.requestDraw(r,ref);r.record(`WINDOW add actual ${record.kind} root ${ref.ref}`);};
 return{ [GC_ROOTS](visit) { visit(display); },
  supports:key=>keys.has(key),
  handles(r,method,args){if(method.owner!==WINDOW)return true;const object=r.object(args[0]);return !!object.webPhoneWindow||!['getDecorView','peekDecorView','getCallback','setCallback','findViewById','setContentView','requestFeature','hasFeature'].includes(method.name);},
  canAllocate:type=>[PHONE,WMI,LP,CTXW].includes(type),
  parent:type=>type===PHONE?WINDOW:type===WMI?'Ljava/lang/Object;':type===LP?VLP:type===CTXW?'Landroid/content/ContextWrapper;':null,
  interfaces:type=>type===WMI?[WM,'Landroid/view/ViewManager;']:[],
  getService(r,context,name){return name==='window'?manager(r,context):null;},
  /** android:windowBackground of the Activity theme (PhoneWindow.generateLayout): a color, or a Drawable rasterized at the device extent. */
  activityBackground(r){
   // Needs the framework style table (Activity theme resolution); without it the page keeps its neutral surface.
   if(!r.activity||!platform.resources?.frameworkTable||!r.object(r.activity).baseContext)return null;const value=themeValue(r,r.activity,0x01010054);if(!value)return null;
   if(value.type>=0x1c&&value.type<=0x1f)return{kind:'color',argb:value.data>>>0};
   if(!value.resourceId)return null;
   const theme=platform.styleBackend.theme(r,r.activity),drawable=platform.styleBackend.loadDrawable(r,value.resourceId,theme),DRAWABLE='Landroid/graphics/drawable/Drawable;',CANVAS='Landroid/graphics/Canvas;';
   const width=platform.device.widthDp,height=platform.device.heightDp,graphics=getVectorGraphics(r),canvas=r.allocate(CANVAS);call(r,canvas,CANVAS,'<init>','()V',[],'direct');graphics.resetCanvas(canvas,width,height);
   if(call(r,drawable,DRAWABLE,'isStateful','()Z',[]))call(r,drawable,DRAWABLE,'setState','([I)Z',[r.newArray('[I',0)]);
   call(r,drawable,DRAWABLE,'setBounds','(IIII)V',[0,0,width,height]);call(r,drawable,DRAWABLE,'draw',`(${CANVAS})V`,[canvas]);
   return{kind:'drawable',drawing:graphics.snapshotCanvas(canvas,width,height)};
  },
  roots(r){const background=this.activityBackground(r),result=r.root?[{root:r.root,window:null,...(background?{windowBackground:background}:{})}]:[],seen=new Set(result.map(value=>value.root.ref));for(const record of records.values()){if(!record.attached||seen.has(record.root.ref))continue;seen.add(record.root.ref);const bounds=dimensions(r,record),flags=field(r,record.params,'flags'),dim=number(field(r,record.params,'dimAmount',bits(1),'F'));result.push({root:record.root,window:{id:record.id,kind:record.kind,...bounds,modal:!(flags&40),focused:record.focused,visible:visible(r,record),dimAmount:flags&2?dim:0,flags,source:'web-WindowManager/PhoneWindow-content-adapter'}});}return result;},
  geometry(r,root){const record=records.get(root.ref);return record?{width:platform.device.widthDp,height:platform.device.heightDp,layoutWidth:field(r,record.params,'width',-1),layoutHeight:field(r,record.params,'height',-1)}:null;},
  recordFor,
  /** Screen position of an attached WindowManager root (null for the Activity window). */
  surfaceOffset(r,root){const record=records.get(root.ref);if(!record?.attached)return null;const {x,y}=dimensions(r,record);return{x,y};},
  /** WindowManagerGlobal.closeAll(token): windows an Activity still owns are removed after its onDestroy (a leaked Dialog is not dismissed or notified). */
  activityDestroyed(r,activity){for(const record of [...records.values()])if(same(record.ownerActivity,activity)){remove(r,record.root);r.record(`WINDOW leaked ${record.kind} root removed with destroyed Activity`);}},
  visibilityChanged(r,ref){if(records.has(ref.ref))updateFocus(r);},
  back(r){const record=[...records.values()].reverse().find(record=>visible(r,record)&&!(field(r,record.params,'flags')&8));if(!record)return false;if(record.window){if(platform.backDispatcher.dispatchBack(r,record.window))return true;const callback=windowData(r,record.window).callback;if(callback&&r.isSubtype(r.object(callback).type,DIALOG)){call(r,callback,DIALOG,'onBackPressed','()V');return true;}}fail('Popup back requires original KeyEvent dispatch');},
  invoke(r,method,args){
   const owner=method.owner,name=method.name,ref=args[0];
   if(owner==='Landroid/app/Dialog;'&&name==='getOnBackInvokedDispatcher'){const window=r.dispatch({owner:'Landroid/app/Dialog;',name:'getWindow',parameters:[],result:WINDOW,signature:'()'+WINDOW},[ref],'virtual');return platform.backDispatcher.forOwner(r,window);}   // Dialog.getOnBackInvokedDispatcher() = mWindow.getOnBackInvokedDispatcher()
   if(owner===CTXW&&name==='<init>'){const o=r.object(ref);if(!args[1])return;o.baseContext=args[1];if(method.parameters[1]===THEME){o.themeRef=args[2];return;}o.themeResId=args[2]|0;if(!o.themeResId)fail('ContextThemeWrapper default-theme selection requires the original Resources selector');const base=call(r,args[1],CTX,'getTheme',`()${THEME}`),theme=platform.styleBackend.createTheme(r);call(r,theme,THEME,'setTo',`(${THEME})V`,[base]);call(r,theme,THEME,'applyStyle','(IZ)V',[o.themeResId,1]);o.themeRef=theme;return;}
   if(owner===PHONE&&name==='<init>'){Object.assign(r.object(ref),{windowContext:args[1],attributes:newParams(r),features:new Set([0,6]),destroyed:false,webPhoneWindow:true});return;}
   if(owner===LP){if(name==='<init>'){let width=-1,height=-1,type=2,flags=0,format=-1,x=0,y=0;if(args.length===2)type=args[1];else if(args.length===4)[type,flags,format]=args.slice(1);else if(args.length===6)[width,height,type,flags,format]=args.slice(1);else if(args.length===8)[width,height,x,y,type,flags,format]=args.slice(1);const source=newParams(r,width,height,type,flags,format);for(const[k,v]of r.object(source).fields)r.storeField(r.object(ref).fields,k,v);set(r,ref,LP,'x','I',x);set(r,ref,LP,'y','I',y);return;}if(name==='setTitle'){r.object(ref).windowTitle=args[1];return;}return r.object(ref).windowTitle??'';}
   if(owner===WM||owner===WMI){if(name==='<init>'){r.object(ref).windowContext=args[1];return;}if(name==='getDefaultDisplay')return display??=r.makeObject('Landroid/view/Display;');if(name==='addView')return addView(r,ref,args[1],args[2]);if(name==='removeView'||name==='removeViewImmediate')return remove(r,args[1]);const record=records.get(args[1].ref);if(!record)r.throwJava('Ljava/lang/IllegalArgumentException;','View not attached to this WindowManager');record.params=args[2];call(r,record.root,VIEW,'setLayoutParams',`(${VLP})V`,[args[2]]);layout(r);updateFocus(r);platform.requestDraw(r,record.root);return;}
   if(owner===VIEW){
    if(name==='getSystemUiVisibility')return r.object(ref).systemUiVisibility??0;
    if(name==='setSystemUiVisibility'){r.object(ref).systemUiVisibility=args[1]|0;return;}
    if(name==='onWindowFocusChanged'){r.object(ref).surfaceWindowFocused=!!args[1];return;}
    if(name==='dispatchWindowFocusChanged'){call(r,ref,VIEW,'onWindowFocusChanged','(Z)V',[args[1]]);for(const child of [...r.object(ref).children])call(r,child,VIEW,'dispatchWindowFocusChanged','(Z)V',[args[1]]);return;}
    const record=recordFor(r,ref);if(name==='getWindowToken'&&record)return record.attached?record.token:null;
    if(name==='getApplicationWindowToken'&&record){if(!record.attached||!r.object(ref).attached)return null;const frame=platform.frames.find(frame=>same(frame.activity,record.ownerActivity));return frame?.root?platform.viewWindowHost.invoke(r,{owner:VIEW,name:'getWindowToken',signature:'()Landroid/os/IBinder;',parameters:[],result:'Landroid/os/IBinder;'},[frame.root]):null;}
    if(name==='hasWindowFocus'){if(record)return record.attached&&record.focused?1:0;if(!same(focusedRoot(r),r.root))return 0;return platform.viewWindowHost.invoke(r,method,args);}
    if(name==='getWindowVisibility'&&record)return visible(r,record)?0:8;
    return platform.viewWindowHost.invoke(r,method,args);
   }
   const w=windowData(r,ref);
   if(name==='getOnBackInvokedDispatcher')return platform.backDispatcher.forOwner(r,platform.frames.find(f=>f.window&&f.window.ref===ref.ref)?.activity??ref);
   if(name==='getContext')return w.windowContext;if(name==='getWindowManager')return w.windowManager??=manager(r,w.windowContext,ref);if(name==='getLayoutInflater')return platform.inflater(r,w.windowContext);
   if(name==='getAttributes')return w.attributes;
   if(name==='setCallback'){w.callback=args[1];return;}if(name==='getCallback')return w.callback??null;
   if(name==='setOnWindowDismissedCallback'){w.dismissedCallback=args[1];return;}if(name==='setOnWindowSwipeDismissedCallback'){w.swipeCallback=args[1];return;}
   if(name==='setWindowManager'){w.windowManager=manager(r,w.windowContext,ref);w.appToken=args[2];w.appName=args[3];return;}
   if(name==='getDecorView'){w.decorRequested=true;return ensureDecor(r,ref);}if(name==='peekDecorView')return w.decorRequested?w.decor??null:null;
   if(name==='requestFeature'){w.features.add(args[1]);return 1;}if(name==='hasFeature')return w.features.has(args[1])?1:0;
   if(name==='findViewById')return platform.find(r,ensureDecor(r,ref),args[1]);
   if(name==='isDestroyed')return w.destroyed?1:0;if(name==='destroy'){w.destroyed=true;return;}
   if(name==='setCloseOnTouchOutside'){w.closeOnTouchOutside=!!args[1];return;}if(name==='setCloseOnSwipeEnabled'){w.closeOnSwipeEnabled=!!args[1];return;}
   if(name==='closeAllPanels'){if(w.panels?.size)fail('Native panel/menu close transport is unavailable');return;}
   if(name==='getCurrentFocus')return call(r,ensureDecor(r,ref),VIEW,'findFocus','()Landroid/view/View;');
   if(name==='setTitle'){r.object(w.attributes).windowTitle=args[1];return;}
   if(name==='setContentView'||name==='addContentView'){
    ensureDecor(r,ref);let child=args[1];if(method.parameters[0]==='I')child=call(r,platform.inflater(r,w.windowContext),'Landroid/view/LayoutInflater;','inflate','(ILandroid/view/ViewGroup;Z)Landroid/view/View;',[args[1],w.content,0]);
    if(name==='setContentView')call(r,w.content,GROUP,'removeAllViews','()V');
    if(method.parameters[1]===VLP)call(r,w.content,GROUP,'addView',`(${VIEW}${VLP})V`,[child,args[2]]);else call(r,w.content,GROUP,'addView',`(${VIEW})V`,[child]);
    if(w.callback)call(r,w.callback,'Landroid/view/Window$Callback;','onContentChanged','()V');return;
   }
   if(name==='setBackgroundDrawable'||name==='setBackgroundDrawableResource'){w.explicitBackground=true;ensureDecor(r,ref);call(r,w.decor,VIEW,name==='setBackgroundDrawable'?'setBackground':'setBackgroundResource',name==='setBackgroundDrawable'?'(Landroid/graphics/drawable/Drawable;)V':'(I)V',[args[1]]);return;}
   if(name==='setAttributes')w.attributes=args[1];
   else if(name==='setLayout'){set(r,w.attributes,VLP,'width','I',args[1]);set(r,w.attributes,VLP,'height','I',args[2]);}
   else if(name==='setGravity')set(r,w.attributes,LP,'gravity','I',args[1]);
   else if(name==='setSoftInputMode')set(r,w.attributes,LP,'softInputMode','I',args[1]);
   else if(name==='setDimAmount')set(r,w.attributes,LP,'dimAmount','F',args[1]);
   else if(name==='setType')set(r,w.attributes,LP,'type','I',args[1]);
   else if(name==='setFormat')set(r,w.attributes,LP,'format','I',args[1]);
   else if(['addFlags','clearFlags','setFlags'].includes(name)){const old=field(r,w.attributes,'flags'),mask=name==='setFlags'?args[2]:args[1],value=name==='clearFlags'?0:args[1];set(r,w.attributes,LP,'flags','I',(old&~mask)|(value&mask));}
   else fail('Unsupported Window transport operation',{method:owner+'->'+name+method.signature});
   const record=w.decor&&records.get(w.decor.ref);if(record){record.params=w.attributes;layout(r);updateFocus(r);platform.requestDraw(r,record.root);}
  },
 };
}
