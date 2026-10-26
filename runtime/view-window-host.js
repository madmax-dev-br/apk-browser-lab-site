import { APKError } from './apk-runtime.js?v=00979d36e5ab';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=00979d36e5ab';

const VIEW='Landroid/view/View;', CHOREOGRAPHER='Landroid/view/Choreographer;', TOKEN='Lapkweb/bridge/WindowToken;',DISPLAY='Landroid/view/Display;';
const RUNNABLE='Ljava/lang/Runnable;', CALLBACK='Landroid/view/Choreographer$FrameCallback;';
const nullish=x=>x===null||x===0||x===undefined;
const same=(a,b)=>a?.ref!==undefined&&a.ref===b?.ref;
const keys=new Set();
keys.add(VIEW+'->isHardwareAccelerated()Z');
keys.add(VIEW+'->generateViewId()I');
// Legacy View.startAnimation/setAnimation are not implemented (they fail as unsupported), so mCurrentAnimation is always null: clearAnimation() is then the original no-op and getAnimation() is null.
keys.add(VIEW+'->clearAnimation()V');keys.add(VIEW+'->getAnimation()Landroid/view/animation/Animation;');
for(const signature of ['getWindowToken()Landroid/os/IBinder;','getApplicationWindowToken()Landroid/os/IBinder;','getWindowVisibility()I','getRootView()Landroid/view/View;','isAttachedToWindow()Z','hasWindowFocus()Z','getHandler()Landroid/os/Handler;','post(Ljava/lang/Runnable;)Z','postDelayed(Ljava/lang/Runnable;J)Z','postOnAnimation(Ljava/lang/Runnable;)V','postOnAnimationDelayed(Ljava/lang/Runnable;J)V','removeCallbacks(Ljava/lang/Runnable;)Z'])keys.add(VIEW+'->'+signature);
for(const signature of ['hasFocusable()Z','hasExplicitFocusable()Z','getDisplay()Landroid/view/Display;','isInTouchMode()Z','isFocused()Z','hasFocus()Z','findFocus()Landroid/view/View;','clearFocus()V','requestFocus()Z','requestFocus(I)Z','requestFocus(ILandroid/graphics/Rect;)Z','requestFocusFromTouch()Z','isFocusable()Z','isFocusableInTouchMode()Z','setFocusable(Z)V','setFocusable(I)V','setFocusableInTouchMode(Z)V','setOnFocusChangeListener(Landroid/view/View$OnFocusChangeListener;)V','getOnFocusChangeListener()Landroid/view/View$OnFocusChangeListener;','onFocusChanged(ZILandroid/graphics/Rect;)V'])keys.add(VIEW+'->'+signature);
for(const signature of ['getFocusedChild()Landroid/view/View;','setDescendantFocusability(I)V','getDescendantFocusability()I'])keys.add('Landroid/view/ViewGroup;->'+signature);
for(const signature of ['getInstance()Landroid/view/Choreographer;','postFrameCallback(Landroid/view/Choreographer$FrameCallback;)V','postFrameCallbackDelayed(Landroid/view/Choreographer$FrameCallback;J)V','removeFrameCallback(Landroid/view/Choreographer$FrameCallback;)V','postCallback(ILjava/lang/Runnable;Ljava/lang/Object;)V','postCallbackDelayed(ILjava/lang/Runnable;Ljava/lang/Object;J)V','removeCallbacks(ILjava/lang/Runnable;Ljava/lang/Object;)V','getFrameTimeNanos()J','getFrameTime()J','getFrameIntervalNanos()J'])keys.add(CHOREOGRAPHER+'->'+signature);
for(const signature of ['getDisplayId()I','getRefreshRate()F','isValid()Z','getRotation()I','getName()Ljava/lang/String;'])keys.add(DISPLAY+'->'+signature);
const floatView=new DataView(new ArrayBuffer(4));const floatBits=value=>{floatView.setFloat32(0,value,true);return floatView.getInt32(0,true);};
for(const signature of ['getFrameDelay()J','setFrameDelay(J)V'])keys.add(CHOREOGRAPHER+'->'+signature);
const error=message=>{throw new APKError(message,{kind:'window-frame-unsupported'});};

/** Explicit web-device window identity and bounded, asynchronous 60Hz frame clock. */
export function createViewWindowHost(platform){
 // Choreographer.sFrameDelay is a legacy animation setting, not the VSYNC interval.
 let legacyFrameDelay=10n;
 const frameInterval=1000/60, pendingViews=gcRoot(new Map()), pendingFrames=gcRoot([]), tokens=gcRoot(new Map());let display=null,choreographer=null,handler=null,frameTime=null,lastFrameMs=0,currentPhase=-1,pendingViewCount=0;
 const focusedWindows=gcRoot(new Map()),focusQueryStack=new Set();let focusDepth=0,inTouchMode=false,focusQueryNodes=0;
 const rootOf=(runtime,receiver)=>{let current=receiver;const seen=new Set();while(runtime.object(current).parent){if(seen.has(current.ref)||seen.size>=4096)error('Cyclic/excessive View window hierarchy');seen.add(current.ref);current=runtime.object(current).parent;}return current;};
 const frameOf=(runtime,receiver)=>{const root=rootOf(runtime,receiver);const context=runtime.object(receiver).context;return platform.frames.find(frame=>same(frame.root,root)||frame.window&&same(runtime.object(frame.window).decor,root)||same(frame.activity,context))||null;};
 const focusKey=(runtime,receiver)=>frameOf(runtime,receiver)?.activity.ref??rootOf(runtime,receiver).ref;
 const isFocusable=(runtime,receiver)=>{const view=runtime.object(receiver),mode=view.focusableMode;if(mode!==undefined&&mode!==16)return mode===1;return runtime.isSubtype(view.type,'Landroid/widget/EditText;')||runtime.isSubtype(view.type,'Landroid/widget/Button;')||!!view.listener||!!view.clickable;};
 const inTouchFocusable=(runtime,receiver)=>runtime.object(receiver).focusableInTouchMode??runtime.isSubtype(runtime.object(receiver).type,'Landroid/widget/EditText;');
 const findFocus=(runtime,receiver)=>{const pending=[receiver],seen=new Set();while(pending.length){const value=pending.shift(),view=runtime.object(value);if(seen.has(view.id)||seen.size>=4096)error('Cyclic/excessive focus hierarchy');seen.add(view.id);if(view.focused)return value;pending.unshift(...(view.children??[]));}return null;};
 const hasFocusable=(runtime,receiver,explicit)=>{
  if(!focusQueryStack.size)focusQueryNodes=0;if(focusQueryStack.has(receiver.ref)||++focusQueryNodes>4096)error('Cyclic/excessive focusable hierarchy');focusQueryStack.add(receiver.ref);
  try{const view=runtime.object(receiver),group=runtime.isSubtype(view.type,'Landroid/view/ViewGroup;');if((view.visibility??0)!==0||!group&&view.enabled===false)return 0;
   if(!group&&!inTouchFocusable(runtime,receiver)){let parent=view.parent,seen=new Set();while(parent){if(seen.has(parent.ref)||seen.size>=4096)error('Cyclic focus ancestor hierarchy');seen.add(parent.ref);const ancestor=runtime.object(parent);if(ancestor.touchscreenBlocksFocus&&(inTouchFocusable(runtime,parent)||(ancestor.descendantFocusability??0x20000)!==0x40000))return 0;parent=ancestor.parent;}}
   const target=Number(platform.manifest?.usesSdk?.targetSdkVersion??platform.manifest?.usesSdk?.minSdkVersion??1),allowAuto=!explicit&&target>=26;
   const mode=view.focusableMode??(runtime.isSubtype(view.type,'Landroid/widget/EditText;')||runtime.isSubtype(view.type,'Landroid/widget/Button;')?1:16);
   if((allowAuto||mode!==16)&&isFocusable(runtime,receiver))return 1;
   if(group&&(view.descendantFocusability??0x20000)!==0x60000){const name=explicit?'hasExplicitFocusable':'hasFocusable';for(const child of view.children??[])if(runtime.dispatch({owner:runtime.object(child).type,name,parameters:[],result:'Z',signature:'()Z'},[child],'virtual'))return 1;}
   return 0;
  }finally{focusQueryStack.delete(receiver.ref);}
 };
 const notifyFocus=(runtime,receiver,focused,direction=130,rect=null)=>runtime.dispatch({owner:runtime.object(receiver).type,name:'onFocusChanged',signature:'(ZILandroid/graphics/Rect;)V',parameters:['Z','I','Landroid/graphics/Rect;'],result:'V'},[receiver,focused?1:0,direction,rect],'virtual');
 const clearFocus=(runtime,receiver)=>{const focused=findFocus(runtime,receiver);if(!focused)return;runtime.object(focused).focused=false;for(const [key,value]of focusedWindows)if(same(value,focused))focusedWindows.delete(key);notifyFocus(runtime,focused,false);};
 const requestFocus=(runtime,receiver,direction=130,rect=null)=>{
  if(++focusDepth>32){focusDepth--;error('Reentrant focus transition limit exceeded');}
  try{const view=runtime.object(receiver);if((view.visibility??0)!==0)return 0;
   const own=()=>{if(!isFocusable(runtime,receiver)||view.enabled===false||inTouchMode&&!inTouchFocusable(runtime,receiver))return 0;
    const key=focusKey(runtime,receiver),old=focusedWindows.get(key);if(view.focused){focusedWindows.set(key,receiver);return 1;}
    if(old&&!same(old,receiver)){runtime.object(old).focused=false;focusedWindows.delete(key);notifyFocus(runtime,old,false,direction,rect);if(focusedWindows.has(key))return view.focused?1:0;}
    focusedWindows.set(key,receiver);view.focused=true;notifyFocus(runtime,receiver,true,direction,rect);return view.focused?1:0;};
   const children=()=>{const entries=direction&2?view.children??[]:[...(view.children??[])].reverse();for(const child of entries)if(runtime.dispatch({owner:runtime.object(child).type,name:'requestFocus',signature:'(ILandroid/graphics/Rect;)Z',parameters:['I','Landroid/graphics/Rect;'],result:'Z'},[child,direction,rect],'virtual'))return 1;return 0;};
   const descendants=view.descendantFocusability??0x20000;
   if(descendants===0x60000)return own();if(descendants===0x40000)return children()||own();return own()||children();
  }finally{focusDepth--;}
 };
 const isAttached=(runtime,receiver)=>{const view=runtime.object(receiver);if(view.attached)return true;const frame=frameOf(runtime,receiver);if(!frame?.window||!frame.root)return false;const window=runtime.object(frame.window);return (same(receiver,window.decor)||same(receiver,window.content))&&!!runtime.object(frame.root).attached;};
 const windowToken=(runtime,receiver)=>{if(!isAttached(runtime,receiver))return null;const frame=frameOf(runtime,receiver),key=frame?.activity.ref??rootOf(runtime,receiver).ref;
  if(!tokens.has(key)){const value=runtime.makeObject(TOKEN);runtime.object(value).windowOwner=frame?.activity??rootOf(runtime,receiver);tokens.set(key,value);}return tokens.get(key);};
 const mainHandler=runtime=>{if(!handler){handler=runtime.allocate('Landroid/os/Handler;');runtime.dispatch({owner:'Landroid/os/Handler;',name:'<init>',signature:'()V',parameters:[],result:'V'},[handler],'direct');}return handler;};
 const sortQueue=()=>platform.eventQueue.sort((a,b)=>a.front!==b.front?a.front?-1:1:a.front?b.sequence-a.sequence:a.when-b.when||a.sequence-b.sequence);
 const schedule=(runtime,when,task,metadata={})=>{if(platform.eventQueue.length>=1024)error('Window/frame queue exceeds1024events');const event={when,sequence:++platform.eventSequence,front:false,platformTask:task,...metadata};platform.eventQueue.push(event);sortQueue();return event;};
 const run=(runtime,callback)=>runtime.dispatch({owner:RUNNABLE,name:'run',signature:'()V',parameters:[],result:'V'},[callback],'virtual');
 const enqueueView=(runtime,receiver,callback,delay,onAnimation)=>{
  if(nullish(callback))runtime.throwJava('Ljava/lang/NullPointerException;','View.post requires Runnable');runtime.object(callback);
  const record={receiver,callback,delay:Math.max(0,Number(delay)),onAnimation};if(!Number.isFinite(record.delay)||record.delay>2147483647)error('View callback delay exceeds web clock range');
  if(!isAttached(runtime,receiver)){const list=pendingViews.get(receiver.ref)??[];if(pendingViewCount>=1024)error('Aggregate detached View callback queue exceeds1024');list.push(record);pendingViewCount++;pendingViews.set(receiver.ref,list);return;}
  const now=performance.now(),when=onAnimation?Math.ceil((Math.max(now,lastFrameMs)+record.delay+0.000001)/frameInterval)*frameInterval:now+record.delay;
  schedule(runtime,when,()=>{runtime.record('WINDOW Runnable callback [web event queue]');run(runtime,callback);},{windowCallback:record,roots:[callback]});
 };
 const planFrame=(runtime,callback,delay,{phase=1,token=null,runnable=false}={})=>{
  if(nullish(callback))runtime.throwJava('Ljava/lang/NullPointerException;','Frame callback is null');runtime.object(callback);
  const amount=Math.max(0,Number(delay));if(!Number.isFinite(amount)||amount>2147483647)error('Frame delay exceeds web clock range');
  if(pendingFrames.length>=1024)error('Frame callback limit exceeded');
  const now=performance.now(),sameFrame=frameTime!==null&&runnable&&phase>currentPhase&&amount===0;
  const when=sameFrame?lastFrameMs:Math.ceil((Math.max(now,lastFrameMs)+amount+0.000001)/frameInterval)*frameInterval;
  const entry={callback,token,runnable,phase,when};pendingFrames.push(entry);
  if(sameFrame)return;
  // One queue task per frame lets callbacks posted while dispatching wait until a later frame.
  if(platform.eventQueue.some(event=>event.windowFrameTime===when))return;
  schedule(runtime,when,()=>{
   lastFrameMs=when;frameTime=BigInt(Math.round(when*1000000));runtime.record(`FRAME ${frameTime} [explicit60HzwebVMclock]`);
   let animationClockLocked=false;
   const animationClock=(name,parameters,values)=>runtime.dispatch({owner:'Landroid/view/animation/AnimationUtils;',name,parameters,result:'V',signature:`(${parameters.join('')})V`},runtime.argumentWords(parameters,values),'static');
   try{if(runtime.dex.bootClasses?.has('Landroid/view/animation/AnimationUtils;')){animationClock('lockAnimationClock',['J'],[frameTime/1000000n]);animationClockLocked=true;}for(currentPhase=0;currentPhase<=4;currentPhase++){const due=pendingFrames.filter(x=>x.when<=when&&x.phase===currentPhase);for(const item of due)pendingFrames.splice(pendingFrames.indexOf(item),1);
    for(const item of due){runtime.record(`FRAME callback phase=${currentPhase}`);if(item.runnable)run(runtime,item.callback);else runtime.dispatch({owner:CALLBACK,name:'doFrame',signature:'(J)V',parameters:['J'],result:'V'},runtime.argumentWords(['J'],[frameTime],{receiver:item.callback}),'virtual');}
   }}finally{try{if(animationClockLocked)animationClock('unlockAnimationClock',[],[]);}finally{frameTime=null;currentPhase=-1;}}
  },{windowFrameTime:when,roots:[]});
 };
 return { [GC_ROOTS](visit) { visit(display); visit(choreographer); visit(handler); },
  supports:key=>keys.has(key),
  interfaces:type=>type===TOKEN?['Landroid/os/IBinder;']:[],
  parent:type=>type===TOKEN||type===DISPLAY?'Ljava/lang/Object;':null,
  /** ViewGroup.removeViewInternal / window removal: the focused descendant is un-focused BEFORE the subtree is detached (callbacks still see an attached hierarchy). */
  unfocusSubtree(runtime,receiver){clearFocus(runtime,receiver);},
  afterAttach(runtime,receiver,attached){if(attached){if(runtime.object(receiver).focused)focusedWindows.set(focusKey(runtime,receiver),receiver);let value=receiver;const seen=new Set();while(value){if(seen.has(value.ref)||seen.size>=4096)error('Cyclic View callback attachment hierarchy');seen.add(value.ref);const pending=pendingViews.get(value.ref)||[];pendingViews.delete(value.ref);pendingViewCount-=pending.length;for(const item of pending)enqueueView(runtime,value,item.callback,item.delay,item.onAnimation);value=runtime.object(value).parent;}}else clearFocus(runtime,receiver);},
  invoke(runtime,method,args){const name=method.name,receiver=args[0];if(name==='clearAnimation')return;if(name==='getAnimation')return null;
   if(method.owner===VIEW&&name==='generateViewId'){
    // AOSP View's process-wide 24-bit ID space; this VM has one Java thread.
    const value=platform.nextGeneratedViewId??1;platform.nextGeneratedViewId=value===0x00ffffff?1:value+1;return value;
   }
   if(method.owner===DISPLAY){const info=runtime.object(receiver).virtualDisplay;if(!info)error('Display is not the configured virtual display');if(name==='getDisplayId')return info.id;if(name==='getRefreshRate')return floatBits(info.refreshRate);if(name==='isValid')return info.valid?1:0;if(name==='getRotation')return info.rotation;if(name==='getName')return info.name;error('Unsupported Display API '+name);}

   if(method.owner===CHOREOGRAPHER){
    if(name==='getFrameDelay')return legacyFrameDelay;
    if(name==='setFrameDelay'){legacyFrameDelay=BigInt.asIntN(64,BigInt(args[0]));return;}
    if(name==='getInstance')return choreographer??=runtime.makeObject(CHOREOGRAPHER);
    runtime.object(receiver);
    if(name==='getFrameIntervalNanos')return 16666667n;
    if(name==='getFrameTimeNanos'||name==='getFrameTime'){if(frameTime===null)runtime.throwJava('Ljava/lang/IllegalStateException;','Must only be called as part of a frame callback');return name==='getFrameTime'?frameTime/1000000n:frameTime;}
    if(name==='removeFrameCallback'){for(let i=pendingFrames.length-1;i>=0;i--)if(!pendingFrames[i].runnable&&same(pendingFrames[i].callback,args[1]))pendingFrames.splice(i,1);return;}
    if(name==='removeCallbacks'){const phase=args[1];if(phase<0||phase>4)runtime.throwJava('Ljava/lang/IllegalArgumentException;','Invalid callback phase');for(let i=pendingFrames.length-1;i>=0;i--){const item=pendingFrames[i];if(item.runnable&&item.phase===phase&&(nullish(args[2])||same(item.callback,args[2]))&&(nullish(args[3])||same(item.token,args[3])||item.token===args[3]))pendingFrames.splice(i,1);}return;}
    if(name.startsWith('postFrameCallback'))return planFrame(runtime,args[1],args[2]??0n);
    if(name.startsWith('postCallback')){if(args[1]<0||args[1]>4)runtime.throwJava('Ljava/lang/IllegalArgumentException;','Invalid callback phase');return planFrame(runtime,args[2],args[4]??0n,{phase:args[1],token:args[3],runnable:true});}
    error(`Unsupported Choreographer operation ${name}`);
   }
   const view=runtime.object(receiver);
   if(name==='isHardwareAccelerated')return 0; // This window draws through the verified Skia CPU surface, with no HWUI/GPU window.
   if(name==='getDisplay'){if(!isAttached(runtime,receiver))return null;if(!display){display=runtime.makeObject(DISPLAY);runtime.object(display).virtualDisplay={id:0,refreshRate:60,rotation:0,valid:true,name:'APK Web virtual display 0'};runtime.record('DISPLAY 0 @60Hz [declared web-device profile; no Android host telemetry]');}return display;}
   if(name==='isInTouchMode')return isAttached(runtime,receiver)&&inTouchMode?1:0;
   if(name==='hasFocusable'||name==='hasExplicitFocusable')return hasFocusable(runtime,receiver,name==='hasExplicitFocusable');
   if(name==='getFocusedChild'){for(const child of view.children??[])if(findFocus(runtime,child))return child;return null;}
   if(name==='isFocused')return view.focused?1:0;
   if(name==='hasFocus')return findFocus(runtime,receiver)?1:0;
   if(name==='findFocus')return findFocus(runtime,receiver);
   if(name==='clearFocus'){clearFocus(runtime,receiver);return;}
   if(name==='requestFocus'||name==='requestFocusFromTouch'){if(name==='requestFocusFromTouch')inTouchMode=false;const direction=args[1]??130;if(![1,2,17,33,66,130].includes(direction))runtime.throwJava('Ljava/lang/IllegalArgumentException;','Invalid focus direction');return requestFocus(runtime,receiver,direction,args[2]??null);}
   if(name==='isFocusable')return isFocusable(runtime,receiver)?1:0;
   if(name==='isFocusableInTouchMode')return inTouchFocusable(runtime,receiver)?1:0;
   if(name==='setFocusable'){const mode=method.parameters[0]==='Z'?(args[1]?1:0):args[1];if(![0,1,16].includes(mode))runtime.throwJava('Ljava/lang/IllegalArgumentException;','Invalid focusability');view.focusableMode=mode;if(!isFocusable(runtime,receiver))clearFocus(runtime,receiver);return;}
   if(name==='setFocusableInTouchMode'){view.focusableInTouchMode=!!args[1];if(args[1])view.focusableMode=1;return;}
   if(name==='setOnFocusChangeListener'){view.focusChangeListener=args[1];return;}
   if(name==='getOnFocusChangeListener')return view.focusChangeListener??null;
   if(name==='setDescendantFocusability'){if(![0x20000,0x40000,0x60000].includes(args[1]))runtime.throwJava('Ljava/lang/IllegalArgumentException;','Invalid descendant focusability');view.descendantFocusability=args[1];return;}
   if(name==='getDescendantFocusability')return view.descendantFocusability??0x20000;
   if(name==='onFocusChanged'){view.focused=!!args[1];view.lastFocusDirection=args[2];view.previousFocusRect=args[3];if(!nullish(view.focusChangeListener))runtime.dispatch({owner:runtime.object(view.focusChangeListener).type,name:'onFocusChange',signature:'(Landroid/view/View;Z)V',parameters:[VIEW,'Z'],result:'V'},[view.focusChangeListener,receiver,args[1]],'virtual');return;}
   if(name==='getRootView')return rootOf(runtime,receiver);
   if(name==='isAttachedToWindow')return isAttached(runtime,receiver)?1:0;
   if(name==='getWindowToken'||name==='getApplicationWindowToken')return windowToken(runtime,receiver);
   if(name==='getWindowVisibility'){const frame=frameOf(runtime,receiver);return !isAttached(runtime,receiver)||frame?.finished||frame?.destroyed||frame&&frame.lifecycleStage<3?8:0;}
   if(name==='hasWindowFocus'){const frame=frameOf(runtime,receiver);return isAttached(runtime,receiver)&&(!frame||same(frame.activity,runtime.activity)&&frame.lifecycleStage===4)?1:0;}
   if(name==='getHandler')return isAttached(runtime,receiver)?mainHandler(runtime):null;
   if(name==='removeCallbacks'){
    if(nullish(args[1]))return 0;
    const match=item=>same(item.receiver,receiver)&&same(item.callback,args[1]);
    const before=pendingViews.get(receiver.ref)||[],after=before.filter(item=>!match(item));pendingViewCount-=before.length-after.length;
    if(after.length)pendingViews.set(receiver.ref,after);else pendingViews.delete(receiver.ref);
    platform.eventQueue=platform.eventQueue.filter(event=>!event.windowCallback||!match(event.windowCallback));return 1;
   }
   if(name.startsWith('post')){enqueueView(runtime,receiver,args[1],args[2]??0n,name.startsWith('postOnAnimation'));return name==='post'||name==='postDelayed'?1:undefined;}
   error(`Unsupported View window operation ${name}`);
  }
 };
}
