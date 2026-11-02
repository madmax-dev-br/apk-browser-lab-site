import { createHostRegistry } from './host-contract.js?v=2a1f5dd8c3fa';
import { APKError } from './apk-error.js?v=2a1f5dd8c3fa';
import { gcRoot } from './heap-gc.js?v=2a1f5dd8c3fa';

// android.app.Activity public API (API 33) that the platform's Activity model does not carry itself, ported from android-13.0.0_r1 Activity.java and its Window.Callback /
// KeyEvent.Callback / ComponentCallbacks2 / View.OnCreateContextMenuListener default bodies, plus the Context methods an Activity inherits and the lab has no other owner for.
//   * Orientation: setRequestedOrientation / getRequestedOrientation keep the request on the Activity's record (it survives a relaunch, like ActivityRecord); the platform folds the
//     top Activity's request (or android:screenOrientation of its manifest entry, with SCREEN_ORIENTATION_BEHIND walking down the stack and LOCKED freezing the current rotation) into
//     the *effective* device, so a fixed request changes the Configuration (and the Display rotation) exactly like a rotation: onConfigurationChanged when android:configChanges
//     covers it, a relaunch with saved state otherwise. The user's own orientation (the lab's Dispositivo panel) stays in platform.userDevice and decides every sensor/user/unspecified
//     request.
//   * Window-state setters (setShowWhenLocked, setTurnScreenOn, setTaskDescription, setImmersive, ...) are kept on the record and read back; the virtual device has no keyguard, recents or
//     picture-in-picture, which the methods say where it matters (isInPictureInPictureMode false, enterPictureInPictureMode refused as a device without the feature does).
//   * Dispatch (dispatchKeyEvent / dispatchTouchEvent / ...) follows Activity.java: onUserInteraction, the decor view, then the Activity's own on*Event.
const ACTIVITY = 'Landroid/app/Activity;', CONTEXT = 'Landroid/content/Context;', WRAPPER = 'Landroid/content/ContextWrapper;', IMPL = 'Landroid/app/ContextImpl;', INTENT = 'Landroid/content/Intent;';
const BUNDLE = 'Landroid/os/Bundle;', STRING = 'Ljava/lang/String;', CHARS = 'Ljava/lang/CharSequence;', VIEW = 'Landroid/view/View;', KEYEVENT = 'Landroid/view/KeyEvent;', MOTION = 'Landroid/view/MotionEvent;';
const WINDOW = 'Landroid/view/Window;', DIALOG = 'Landroid/app/Dialog;', MENU = 'Landroid/view/Menu;', MENU_ITEM = 'Landroid/view/MenuItem;', PARAMS = 'Landroid/view/ViewGroup$LayoutParams;';
const TASK_DESCRIPTION = 'Landroid/app/ActivityManager$TaskDescription;', COMPONENT = 'Landroid/content/ComponentName;', URI = 'Landroid/net/Uri;', PENDING = 'Landroid/app/PendingIntent;', OBJECT = 'Ljava/lang/Object;';
const BITMAP = 'Landroid/graphics/Bitmap;', FRAGMENT = 'Landroid/app/Fragment;', SENDER = 'Landroid/content/IntentSender;', CONFIGURATION = 'Landroid/content/res/Configuration;';
const nullish = v => v === null || v === undefined || v === 0;
const LOCKED = 14;
const LANDSCAPE_REQUESTS = new Set([0, 6, 8, 11]), PORTRAIT_REQUESTS = new Set([1, 7, 9, 12]);   // LANDSCAPE, SENSOR_/REVERSE_/USER_LANDSCAPE ; PORTRAIT and its variants
const ACTION_DOWN = 0, ACTION_UP = 1, KEYCODE_BACK = 4;
const CLEAR_TOP = 0x04000000;

/** Orientation ('portrait' | 'landscape') a request forces, or null when the device's own orientation decides. `current` is the orientation LOCKED freezes. */
export function forcedOrientationOf(request, current) {
  if (LANDSCAPE_REQUESTS.has(request)) return 'landscape';
  if (PORTRAIT_REQUESTS.has(request)) return 'portrait';
  if (request === LOCKED) return current;
  return null;
}

export function createActivityApiHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(TASK_DESCRIPTION, OBJECT, [], { allocatable: true });
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, [o, ...args], 'direct'); return o; };
  const flag = value => value === true || value === 1 || value === -1 || value === 0xffffffff;
  const text = (r, value) => nullish(value) ? null : typeof value === 'string' ? value : r.stringCharacters(value);
  const iae = (r, message) => r.throwJava('Ljava/lang/IllegalArgumentException;', message);
  const ise = (r, message) => r.throwJava('Ljava/lang/IllegalStateException;', message);
  const npe = r => r.throwJava('Ljava/lang/NullPointerException;', null);
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };
  // An Activity that already finished keeps answering from a detached record (platform.frame() would register it as a live frame again).
  const frameOf = (r, self) => platform.finishedActivities.has(self.ref) ? (r.object(self).detachedFrame ??= { activity: self, type: r.object(self).type, finished: true, record: {} }) : platform.frame(r, self);
  const record = (r, self) => frameOf(r, self).record ??= {};
  const own = (r, self) => r.object(self);
  const intArray = (r, type, values) => { const array = r.newArray(type, values.length); r.array(array).elements = values; return array; };
  const targetSdk = () => Number(platform.manifest?.usesSdk?.targetSdkVersion ?? platform.manifest?.usesSdk?.minSdkVersion ?? 1);
  const noop = (name, signature) => def(ACTIVITY, name, signature, () => {});
  const constant = (name, signature, value) => def(ACTIVITY, name, signature, () => value);

  // ---- ComponentName members the platform's own model lacks (ComponentName.java) -------------------------------------------------------------------------------------------------------------
  const cn = (r, self) => r.object(self);
  const newComponent = (r, pkg, cls) => construct(r, COMPONENT, [STRING, STRING], [pkg, cls]);
  def(COMPONENT, 'getShortClassName', `()${STRING}`, (r, _m, [self]) => { const { packageName: pkg, className: cls } = cn(r, self); return cls.startsWith(pkg) && cls.length > pkg.length && cls[pkg.length] === '.' ? cls.slice(pkg.length) : cls; });
  def(COMPONENT, 'toShortString', `()${STRING}`, (r, _m, [self]) => `{${cn(r, self).packageName}/${cn(r, self).className}}`);
  def(COMPONENT, 'clone', `()${COMPONENT}`, (r, _m, [self]) => newComponent(r, cn(r, self).packageName, cn(r, self).className));
  def(COMPONENT, 'clone', `()${OBJECT}`, (r, _m, [self]) => newComponent(r, cn(r, self).packageName, cn(r, self).className));
  const compare = (r, self, other) => { if (nullish(other)) npe(r); const a = cn(r, self), b = cn(r, other), byPackage = a.packageName < b.packageName ? -1 : a.packageName > b.packageName ? 1 : 0; return byPackage || (a.className < b.className ? -1 : a.className > b.className ? 1 : 0); };
  def(COMPONENT, 'compareTo', `(${COMPONENT})I`, (r, _m, [self, other]) => compare(r, self, other));
  def(COMPONENT, 'compareTo', `(${OBJECT})I`, (r, _m, [self, other]) => compare(r, self, other));
  def(COMPONENT, 'describeContents', '()I', () => 0);
  const PARCEL = 'Landroid/os/Parcel;';
  def(COMPONENT, 'writeToParcel', `(${PARCEL}I)V`, (r, _m, [self, out]) => { call(r, out, PARCEL, 'writeString', [STRING], 'V', [cn(r, self).packageName]); call(r, out, PARCEL, 'writeString', [STRING], 'V', [cn(r, self).className]); });
  def(COMPONENT, 'writeToParcel', `(${COMPONENT}${PARCEL})V`, (r, _m, [component, out]) => {   // null is a null package string
    if (nullish(component)) call(r, out, PARCEL, 'writeString', [STRING], 'V', [null]); else call(r, component, COMPONENT, 'writeToParcel', [PARCEL, 'I'], 'V', [out, 0]);
  }, { static: true });
  def(COMPONENT, '<init>', `(${PARCEL})V`, (r, _m, [self, source]) => { const o = cn(r, self); o.packageName = text(r, call(r, source, PARCEL, 'readString', [], STRING)); o.className = text(r, call(r, source, PARCEL, 'readString', [], STRING)); });
  def(COMPONENT, 'readFromParcel', `(${PARCEL})${COMPONENT}`, (r, _m, [source]) => {
    const pkg = call(r, source, PARCEL, 'readString', [], STRING); if (nullish(pkg)) return null;
    return newComponent(r, text(r, pkg), text(r, call(r, source, PARCEL, 'readString', [], STRING)));
  }, { static: true });
  const relative = (r, pkg, cls) => { if (nullish(cls) || !text(r, cls).length) iae(r, 'class name cannot be empty'); const name = text(r, cls); return newComponent(r, pkg, name[0] === '.' ? text(r, pkg) + name : name); };
  def(COMPONENT, 'createRelative', `(${STRING}${STRING})${COMPONENT}`, (r, _m, [pkg, cls]) => relative(r, pkg, cls), { static: true });
  def(COMPONENT, 'createRelative', `(${CONTEXT}${STRING})${COMPONENT}`, (r, _m, [context, cls]) => relative(r, call(r, context, CONTEXT, 'getPackageName', [], STRING), cls), { static: true });
  def(COMPONENT, 'unflattenFromString', `(${STRING})${COMPONENT}`, (r, _m, [str]) => {
    const value = text(r, str), sep = value.indexOf('/'); if (sep < 0 || sep + 1 >= value.length) return null;
    const pkg = value.slice(0, sep); let cls = value.slice(sep + 1); if (cls.length > 0 && cls[0] === '.') cls = pkg + cls; return newComponent(r, pkg, cls);
  }, { static: true });

  // ---- ViewGroup.MarginLayoutParams: relative (start / end) margins and their resolution by layout direction (android-13.0.0_r1 MarginLayoutParams). Undefined is Integer.MIN_VALUE; once a relative
  // margin is set the left / right margins follow the layout direction when it is resolved (RTL: start is the right margin).
  const MARGIN = 'Landroid/view/ViewGroup$MarginLayoutParams;', UNDEFINED = -2147483648;
  const margin = (r, self) => r.object(self).marginState ??= { start: UNDEFINED, end: UNDEFINED, dir: 0, relative: false };
  const marginField = (r, self, edge, value) => { const key = `${MARGIN}->${edge}Margin:I`; if (value === undefined) return r.object(self).fields.get(key) ?? 0; r.storeField(r.object(self).fields, key, value); return undefined; };
  const applyRelative = (r, self) => {
    const m = margin(r, self); if (!m.relative) return; const rtl = m.dir === 1;
    if (rtl) { if (m.end !== UNDEFINED) marginField(r, self, 'left', m.end); if (m.start !== UNDEFINED) marginField(r, self, 'right', m.start); } else { if (m.start !== UNDEFINED) marginField(r, self, 'left', m.start); if (m.end !== UNDEFINED) marginField(r, self, 'right', m.end); }
  };
  def(MARGIN, 'resolveLayoutDirection', '(I)V', (r, _m, [self, dir]) => { margin(r, self).dir = dir; applyRelative(r, self); });
  def(MARGIN, 'setLayoutDirection', '(I)V', (r, _m, [self, dir]) => { margin(r, self).dir = dir; }); def(MARGIN, 'getLayoutDirection', '()I', (r, _m, [self]) => margin(r, self).dir);
  def(MARGIN, 'setMarginStart', '(I)V', (r, _m, [self, v]) => { const m = margin(r, self); m.start = v; m.relative = true; applyRelative(r, self); });
  def(MARGIN, 'setMarginEnd', '(I)V', (r, _m, [self, v]) => { const m = margin(r, self); m.end = v; m.relative = true; applyRelative(r, self); });
  def(MARGIN, 'getMarginStart', '()I', (r, _m, [self]) => { const m = margin(r, self); return m.start !== UNDEFINED ? m.start : marginField(r, self, m.dir === 1 ? 'right' : 'left'); });
  def(MARGIN, 'getMarginEnd', '()I', (r, _m, [self]) => { const m = margin(r, self); return m.end !== UNDEFINED ? m.end : marginField(r, self, m.dir === 1 ? 'left' : 'right'); });
  def(MARGIN, 'isMarginRelative', '()Z', (r, _m, [self]) => margin(r, self).relative ? 1 : 0);

  // ---- Orientation -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  def(ACTIVITY, 'setRequestedOrientation', '(I)V', (r, _m, [self, request]) => {
    request |= 0;
    const frame = frameOf(r, self), rec = record(r, self);
    // ActivityClient.setRequestedOrientation -> ActivityRecord.setRequestedOrientation: an unknown value is stored as-is by the framework (the display ignores it); the value is kept for getRequestedOrientation.
    if (rec.requestedOrientation === request) return;
    rec.requestedOrientation = request; if (request === LOCKED) rec.lockedOrientation = platform.device.orientation; else delete rec.lockedOrientation;
    r.record(`ACTIVITY setRequestedOrientation ${request} ${frame.type}`);
    // ActivityRecord.setRequestedOrientation updates the display configuration on the main thread, after the calling method returns; a background Activity's request applies when it comes back to the top.
    if (platform.frames.at(-1) === frame && !frame.finished) platform.queueTask(() => { if (platform.frames.at(-1) === frame) platform.refreshOrientation(r); }, 0, [self]);
  });
  def(ACTIVITY, 'getRequestedOrientation', '()I', (r, _m, [self]) => platform.requestedOrientationOf(frameOf(r, self)));

  // ---- Window-state setters kept on the Activity's record -------------------------------------------------------------------------------------------------------------------------------------------
  def(ACTIVITY, 'setShowWhenLocked', '(Z)V', (r, _m, [self, value]) => { record(r, self).showWhenLocked = !!value; });
  def(ACTIVITY, 'setInheritShowWhenLocked', '(Z)V', (r, _m, [self, value]) => { record(r, self).inheritShowWhenLocked = !!value; });
  def(ACTIVITY, 'setTurnScreenOn', '(Z)V', (r, _m, [self, value]) => { record(r, self).turnScreenOn = !!value; });
  def(ACTIVITY, 'setImmersive', '(Z)V', (r, _m, [self, value]) => { record(r, self).immersive = !!value; });
  def(ACTIVITY, 'isImmersive', '()Z', (r, _m, [self]) => record(r, self).immersive ? 1 : 0);
  def(ACTIVITY, 'setRecentsScreenshotEnabled', '(Z)V', (r, _m, [self, value]) => { record(r, self).recentsScreenshot = !!value; });
  def(ACTIVITY, 'setShouldDockBigOverlays', '(Z)V', (r, _m, [self, value]) => { record(r, self).dockBigOverlays = !!value; });
  def(ACTIVITY, 'shouldDockBigOverlays', '()Z', (r, _m, [self]) => record(r, self).dockBigOverlays ? 1 : 0);
  def(ACTIVITY, 'setVisible', '(Z)V', (r, _m, [self, visible]) => { own(r, self).windowVisible = !!visible; });
  def(ACTIVITY, 'setTranslucent', '(Z)Z', (r, _m, [self, translucent]) => { own(r, self).translucent = !!translucent; return 1; });
  def(ACTIVITY, 'setFinishOnTouchOutside', '(Z)V', (r, _m, [self, finish]) => { own(r, self).finishOnTouchOutside = !!finish; });
  def(ACTIVITY, 'setVolumeControlStream', '(I)V', (r, _m, [self, stream]) => { own(r, self).volumeControlStream = stream | 0; });
  def(ACTIVITY, 'getVolumeControlStream', '()I', (r, _m, [self]) => own(r, self).volumeControlStream ?? -2147483648);   // AudioManager.USE_DEFAULT_STREAM_TYPE
  def(ACTIVITY, 'setDefaultKeyMode', '(I)V', (r, _m, [self, mode]) => {
    own(r, self).defaultKeyMode = mode | 0;
    if (![0, 1, 2, 3, 4].includes(mode | 0)) iae(r, null);   // Activity.setDefaultKeyMode's switch default
  });
  def(ACTIVITY, 'setTitleColor', '(I)V', (r, _m, [self, color]) => { const o = own(r, self); o.titleColor = color | 0; });
  def(ACTIVITY, 'getTitleColor', '()I', (r, _m, [self]) => own(r, self).titleColor ?? 0);
  def(ACTIVITY, 'takeKeyEvents', '(Z)V', (r, _m, [self, get]) => { own(r, self).takeKeyEvents = !!get; });
  def(ACTIVITY, 'setLocusContext', `(Landroid/content/LocusId;${BUNDLE})V`, (r, _m, [self, id, bundle]) => { record(r, self).locus = { id, bundle }; });
  def(ACTIVITY, 'setVrModeEnabled', `(Z${COMPONENT})V`, () => unsupported('Activity.setVrModeEnabled: the virtual device has no VR service (android.software.vr.mode is not a device feature)', 'vr-mode-unsupported'));
  def(ACTIVITY, 'setProgress', '(I)V', (r, _m, [self, progress]) => { own(r, self).windowProgress = progress | 0; });
  def(ACTIVITY, 'setSecondaryProgress', '(I)V', (r, _m, [self, progress]) => { own(r, self).windowSecondaryProgress = progress | 0; });
  def(ACTIVITY, 'setProgressBarVisibility', '(Z)V', (r, _m, [self, visible]) => { own(r, self).windowProgressVisible = !!visible; });
  def(ACTIVITY, 'setProgressBarIndeterminate', '(Z)V', (r, _m, [self, on]) => { own(r, self).windowProgressIndeterminate = !!on; });
  def(ACTIVITY, 'setProgressBarIndeterminateVisibility', '(Z)V', (r, _m, [self, on]) => { own(r, self).windowIndeterminateVisible = !!on; });
  for (const [name, parameters] of [['setFeatureDrawable', `I${'Landroid/graphics/drawable/Drawable;'}`], ['setFeatureDrawableAlpha', 'II'], ['setFeatureDrawableResource', 'II'], ['setFeatureDrawableUri', `I${URI}`]]) {
    def(ACTIVITY, name, `(${parameters})V`, (r, _m, [self, feature]) => { (own(r, self).featureDrawables ??= new Map()).set(feature | 0, name); });
  }
  def(ACTIVITY, 'requestWindowFeature', '(I)Z', (r, _m, [self, feature]) => {
    const window = call(r, self, ACTIVITY, 'getWindow', [], WINDOW);
    return call(r, window, WINDOW, 'requestFeature', ['I'], 'Z', [feature]);
  });
  def(ACTIVITY, 'addContentView', `(${VIEW}${PARAMS})V`, (r, _m, [self, view, params]) => { call(r, call(r, self, ACTIVITY, 'getWindow', [], WINDOW), WINDOW, 'addContentView', [VIEW, PARAMS], 'V', [view, params]); });
  def(ACTIVITY, 'requireViewById', `(I)${VIEW}`, (r, _m, [self, id]) => {
    const view = call(r, self, ACTIVITY, 'findViewById', ['I'], VIEW, [id]);
    if (nullish(view)) iae(r, 'ID does not reference a View inside this Activity');
    return view;
  });
  def(ACTIVITY, 'getCurrentFocus', `()${VIEW}`, (r, _m, [self]) => call(r, call(r, self, ACTIVITY, 'getWindow', [], WINDOW), WINDOW, 'getCurrentFocus', [], VIEW));
  def(ACTIVITY, 'hasWindowFocus', '()Z', (r, _m, [self]) => {
    const window = call(r, self, ACTIVITY, 'getWindow', [], WINDOW), decor = call(r, window, WINDOW, 'getDecorView', [], VIEW);
    return nullish(decor) ? 0 : call(r, decor, VIEW, 'hasWindowFocus', [], 'Z');
  });

  // ---- ActivityManager.TaskDescription + Activity.setTaskDescription ------------------------------------------------------------------------------------------------------------------------------
  const td = (r, self) => r.object(self);
  const opaque = (r, color) => { if (color !== 0 && ((color >>> 24) & 0xff) !== 255) iae(r, "A TaskDescription's primary color should be opaque"); };
  def(TASK_DESCRIPTION, '<init>', '()V', (r, _m, [self]) => { Object.assign(td(r, self), { label: null, icon: null, iconRes: 0, primary: 0, background: 0, statusBar: 0, navigationBar: 0 }); });
  def(TASK_DESCRIPTION, '<init>', `(${STRING})V`, (r, m, [self, label]) => { r.dispatch({ owner: TASK_DESCRIPTION, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [self], 'direct'); td(r, self).label = label; });
  def(TASK_DESCRIPTION, '<init>', `(${STRING}I)V`, (r, m, [self, label, iconRes]) => { r.dispatch({ owner: TASK_DESCRIPTION, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [self], 'direct'); Object.assign(td(r, self), { label, iconRes: iconRes | 0 }); });
  def(TASK_DESCRIPTION, '<init>', `(${STRING}II)V`, (r, m, [self, label, iconRes, colorPrimary]) => { opaque(r, colorPrimary | 0); r.dispatch({ owner: TASK_DESCRIPTION, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [self], 'direct'); Object.assign(td(r, self), { label, iconRes: iconRes | 0, primary: colorPrimary | 0 }); });
  def(TASK_DESCRIPTION, '<init>', `(${STRING}${BITMAP})V`, (r, m, [self, label, icon]) => { r.dispatch({ owner: TASK_DESCRIPTION, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [self], 'direct'); Object.assign(td(r, self), { label, icon }); });
  def(TASK_DESCRIPTION, '<init>', `(${STRING}${BITMAP}I)V`, (r, m, [self, label, icon, colorPrimary]) => { opaque(r, colorPrimary | 0); r.dispatch({ owner: TASK_DESCRIPTION, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [self], 'direct'); Object.assign(td(r, self), { label, icon, primary: colorPrimary | 0 }); });
  def(TASK_DESCRIPTION, '<init>', `(${TASK_DESCRIPTION})V`, (r, _m, [self, other]) => { if (nullish(other)) npe(r); const o = td(r, other); Object.assign(td(r, self), { label: o.label, icon: o.icon, iconRes: o.iconRes, primary: o.primary, background: o.background, statusBar: o.statusBar, navigationBar: o.navigationBar }); });
  def(TASK_DESCRIPTION, 'getLabel', `()${STRING}`, (r, _m, [self]) => td(r, self).label ?? null);
  def(TASK_DESCRIPTION, 'getIcon', `()${BITMAP}`, (r, _m, [self]) => td(r, self).icon ?? null);
  for (const [name, key] of [['getPrimaryColor', 'primary'], ['getBackgroundColor', 'background'], ['getStatusBarColor', 'statusBar'], ['getNavigationBarColor', 'navigationBar']]) def(TASK_DESCRIPTION, name, '()I', (r, _m, [self]) => td(r, self)[key] ?? 0);
  def(TASK_DESCRIPTION, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => {
    if (nullish(other) || r.typeOf(other) !== TASK_DESCRIPTION) return 0;
    const a = td(r, self), b = td(r, other); return (a.label ?? null) === (b.label ?? null) && a.icon?.ref === b.icon?.ref && a.iconRes === b.iconRes && a.primary === b.primary && a.background === b.background && a.statusBar === b.statusBar && a.navigationBar === b.navigationBar ? 1 : 0;
  });
  def(TASK_DESCRIPTION, 'hashCode', '()I', (r, _m, [self]) => { const a = td(r, self); let h = 17; for (const v of [a.primary, a.background, a.statusBar, a.navigationBar, a.iconRes]) h = (Math.imul(31, h) + (v | 0)) | 0; return h; });
  def(TASK_DESCRIPTION, 'toString', `()${STRING}`, (r, _m, [self]) => { const a = td(r, self); return `TaskDescription Label: ${text(r, a.label)} Icon: ${a.icon ? 'set' : null} IconRes: ${a.iconRes} colorPrimary: ${a.primary} colorBackground: ${a.background} statusBarColor: ${a.statusBar} navigationBarColor: ${a.navigationBar}`; });
  def(ACTIVITY, 'setTaskDescription', `(${TASK_DESCRIPTION})V`, (r, _m, [self, description]) => { record(r, self).taskDescription = nullish(description) ? null : description; });

  // ---- Lifecycle / Window.Callback / ComponentCallbacks defaults (bodies as Activity.java) ----------------------------------------------------------------------------------------------------
  for (const [name, signature] of [
    ['onUserInteraction', '()V'], ['onUserLeaveHint', '()V'], ['onEnterAnimationComplete', '()V'], ['onActivityReenter', `(I${INTENT})V`], ['onAttachFragment', `(${FRAGMENT})V`],
    ['onChildTitleChanged', `(${ACTIVITY}${CHARS})V`], ['onContextMenuClosed', `(${MENU})V`], ['onCreateNavigateUpTaskStack', '(Landroid/app/TaskStackBuilder;)V'], ['onPrepareNavigateUpTaskStack', '(Landroid/app/TaskStackBuilder;)V'],
    ['onLocalVoiceInteractionStarted', '()V'], ['onLocalVoiceInteractionStopped', '()V'], ['onOptionsMenuClosed', `(${MENU})V`], ['onPictureInPictureUiStateChanged', '(Landroid/app/PictureInPictureUiState;)V'],
    ['onProvideAssistContent', '(Landroid/app/assist/AssistContent;)V'], ['onProvideAssistData', `(${BUNDLE})V`], ['onStateNotSaved', '()V'], ['onTopResumedActivityChanged', '(Z)V'], ['onVisibleBehindCanceled', '()V'],
    ['onRequestPermissionsResult', '(I[Ljava/lang/String;[I)V'], ['onNewIntent', `(${INTENT})V`], ['onPointerCaptureChanged', '(Z)V'], ['onContentChanged', '()V'], ['onAttachedToWindow', '()V'], ['onDetachedFromWindow', '()V'],
    ['onWindowFocusChanged', '(Z)V'], ['onWindowAttributesChanged', '(Landroid/view/WindowManager$LayoutParams;)V'], ['onActionModeStarted', '(Landroid/view/ActionMode;)V'], ['onActionModeFinished', '(Landroid/view/ActionMode;)V'],
    ['onMultiWindowModeChanged', '(Z)V'], ['onPictureInPictureModeChanged', '(Z)V'], ['onProvideKeyboardShortcuts', '(Ljava/util/List;Landroid/view/Menu;I)V'], ['onLowMemory', '()V'], ['onTrimMemory', '(I)V'],
  ]) noop(name, signature);
  def(ACTIVITY, 'onMultiWindowModeChanged', `(Z${CONFIGURATION})V`, (r, _m, [self, on]) => { call(r, self, ACTIVITY, 'onMultiWindowModeChanged', ['Z'], 'V', [on]); });
  def(ACTIVITY, 'onPictureInPictureModeChanged', `(Z${CONFIGURATION})V`, (r, _m, [self, on]) => { call(r, self, ACTIVITY, 'onPictureInPictureModeChanged', ['Z'], 'V', [on]); });
  // The PersistableBundle forms forward to the Bundle forms (Activity.java: only a persistent Activity gets the other call).
  def(ACTIVITY, 'onCreate', `(${BUNDLE}Landroid/os/PersistableBundle;)V`, (r, _m, [self, saved]) => { call(r, self, ACTIVITY, 'onCreate', [BUNDLE], 'V', [saved]); });
  def(ACTIVITY, 'onPostCreate', `(${BUNDLE}Landroid/os/PersistableBundle;)V`, (r, _m, [self, saved]) => { call(r, self, ACTIVITY, 'onPostCreate', [BUNDLE], 'V', [saved]); });
  def(ACTIVITY, 'onRestoreInstanceState', `(${BUNDLE}Landroid/os/PersistableBundle;)V`, (r, _m, [self, saved]) => { call(r, self, ACTIVITY, 'onRestoreInstanceState', [BUNDLE], 'V', [saved]); });
  def(ACTIVITY, 'onSaveInstanceState', `(${BUNDLE}Landroid/os/PersistableBundle;)V`, (r, _m, [self, out]) => { call(r, self, ACTIVITY, 'onSaveInstanceState', [BUNDLE], 'V', [out]); });
  def(ACTIVITY, 'onTitleChanged', `(${CHARS}I)V`, (r, _m, [self, title, color]) => {
    const window = call(r, self, ACTIVITY, 'getWindow', [], WINDOW); if (nullish(window)) return;
    call(r, window, WINDOW, 'setTitle', [CHARS], 'V', [title]);
  });
  constant('onSearchRequested', '()Z', 0); constant('onSearchRequested', '(Landroid/view/SearchEvent;)Z', 0); constant('onPictureInPictureRequested', '()Z', 0);
  constant('onCreateOptionsMenu', `(${MENU})Z`, 1); constant('onPrepareOptionsMenu', `(${MENU})Z`, 1); constant('onOptionsItemSelected', `(${MENU_ITEM})Z`, 0); constant('onContextItemSelected', `(${MENU_ITEM})Z`, 0);
  constant('onNavigateUpFromChild', `(${ACTIVITY})Z`, 0);
  constant('onCreateThumbnail', `(${BITMAP}Landroid/graphics/Canvas;)Z`, 0); constant('onCreateDescription', `()${CHARS}`, null); constant('onCreatePanelView', `(I)${VIEW}`, null);
  constant('onGenericMotionEvent', `(${MOTION})Z`, 0); constant('onTrackballEvent', `(${MOTION})Z`, 0); constant('onKeyShortcut', `(I${KEYEVENT})Z`, 0); constant('onKeyLongPress', `(I${KEYEVENT})Z`, 0); constant('onKeyMultiple', `(II${KEYEVENT})Z`, 0);
  constant('onWindowStartingActionMode', '(Landroid/view/ActionMode$Callback;)Landroid/view/ActionMode;', null); constant('onWindowStartingActionMode', '(Landroid/view/ActionMode$Callback;I)Landroid/view/ActionMode;', null);
  constant('onCreateContextMenu', '(Landroid/view/ContextMenu;Landroid/view/View;Landroid/view/ContextMenu$ContextMenuInfo;)V', undefined);
  constant('onPreparePanel', `(I${VIEW}${MENU})Z`, 1);   // overridden below: feature 0 consults the options-menu callbacks
  def(ACTIVITY, 'onNavigateUp', '()Z', (r, _m, [self]) => {
    const up = call(r, self, ACTIVITY, 'getParentActivityIntent', [], INTENT);
    if (nullish(up)) return 0;
    call(r, self, ACTIVITY, 'navigateUpTo', [INTENT], 'Z', [up]); return 1;
  });
  def(ACTIVITY, 'onGetDirectActions', '(Landroid/os/CancellationSignal;Ljava/util/function/Consumer;)V', (r, _m, [, , callback]) => {
    const empty = callStatic(r, 'Ljava/util/Collections;', 'emptyList', [], 'Ljava/util/List;');
    call(r, callback, 'Ljava/util/function/Consumer;', 'accept', [OBJECT], 'V', [empty]);
  });
  def(ACTIVITY, 'onPerformDirectAction', `(${STRING}${BUNDLE}Landroid/os/CancellationSignal;Ljava/util/function/Consumer;)V`, (r, _m, [, , , , callback]) => {
    call(r, callback, 'Ljava/util/function/Consumer;', 'accept', [OBJECT], 'V', [construct(r, BUNDLE, [], [])]);   // Bundle.EMPTY
  });
  def(ACTIVITY, 'onKeyDown', `(I${KEYEVENT})Z`, (r, _m, [self, code, event]) => {
    if (code === KEYCODE_BACK) { if (targetSdk() >= 5) call(r, event, KEYEVENT, 'startTracking', [], 'V'); else call(r, self, ACTIVITY, 'onBackPressed', [], 'V'); return 1; }
    return 0;   // Activity.java: with DEFAULT_KEYS_DISABLE nothing else is handled; the dialer/search default key modes hand the key to apps the virtual device does not have
  });
  def(ACTIVITY, 'onKeyUp', `(I${KEYEVENT})Z`, (r, _m, [self, code, event]) => {
    if (targetSdk() >= 5 && code === KEYCODE_BACK && flag(call(r, event, KEYEVENT, 'isTracking', [], 'Z')) && !flag(call(r, event, KEYEVENT, 'isCanceled', [], 'Z'))) { call(r, self, ACTIVITY, 'onBackPressed', [], 'V'); return 1; }
    return 0;
  });
  def(ACTIVITY, 'onTouchEvent', `(${MOTION})Z`, (r, _m, [self, event]) => {
    // Window.shouldCloseOnTouch: only for a window that asked to close on touch outside, on ACTION_DOWN outside the decor view's bounds (plus the touch slop).
    if (!own(r, self).finishOnTouchOutside || call(r, event, MOTION, 'getAction', [], 'I') !== ACTION_DOWN) return 0;
    const decor = call(r, call(r, self, ACTIVITY, 'getWindow', [], WINDOW), WINDOW, 'peekDecorView', [], VIEW); if (nullish(decor)) return 0;
    const x = Math.trunc(bitsFloat(call(r, event, MOTION, 'getX', [], 'F'))), y = Math.trunc(bitsFloat(call(r, event, MOTION, 'getY', [], 'F'))), slop = 8 * (platform.device.densityDpi ?? 160) / 160 | 0;
    const width = call(r, decor, VIEW, 'getWidth', [], 'I'), height = call(r, decor, VIEW, 'getHeight', [], 'I');
    if (!(x < -slop || y < -slop || x > width + slop || y > height + slop)) return 0;
    call(r, self, ACTIVITY, 'finish', [], 'V'); return 1;
  });
  // Dispatch entry points.
  const decorOf = (r, self) => call(r, call(r, self, ACTIVITY, 'getWindow', [], WINDOW), WINDOW, 'getDecorView', [], VIEW);
  const interaction = (r, self) => call(r, self, ACTIVITY, 'onUserInteraction', [], 'V');
  def(ACTIVITY, 'dispatchTouchEvent', `(${MOTION})Z`, (r, _m, [self, event]) => {
    if (call(r, event, MOTION, 'getAction', [], 'I') === ACTION_DOWN) interaction(r, self);
    const decor = decorOf(r, self); if (!nullish(decor) && flag(call(r, decor, VIEW, 'dispatchTouchEvent', [MOTION], 'Z', [event]))) return 1;
    return call(r, self, ACTIVITY, 'onTouchEvent', [MOTION], 'Z', [event]);
  });
  def(ACTIVITY, 'dispatchGenericMotionEvent', `(${MOTION})Z`, (r, _m, [self, event]) => {
    interaction(r, self);
    const decor = decorOf(r, self); if (!nullish(decor) && flag(call(r, decor, VIEW, 'dispatchGenericMotionEvent', [MOTION], 'Z', [event]))) return 1;
    return call(r, self, ACTIVITY, 'onGenericMotionEvent', [MOTION], 'Z', [event]);
  });
  def(ACTIVITY, 'dispatchTrackballEvent', `(${MOTION})Z`, (r, _m, [self, event]) => {
    interaction(r, self);
    const decor = decorOf(r, self); if (!nullish(decor) && flag(call(r, decor, VIEW, 'dispatchTrackballEvent', [MOTION], 'Z', [event]))) return 1;
    return call(r, self, ACTIVITY, 'onTrackballEvent', [MOTION], 'Z', [event]);
  });
  def(ACTIVITY, 'dispatchKeyShortcutEvent', `(${KEYEVENT})Z`, (r, _m, [self, event]) => {
    interaction(r, self);
    const decor = decorOf(r, self); if (!nullish(decor) && flag(call(r, decor, VIEW, 'dispatchKeyShortcutEvent', [KEYEVENT], 'Z', [event]))) return 1;
    return call(r, self, ACTIVITY, 'onKeyShortcut', ['I', KEYEVENT], 'Z', [call(r, event, KEYEVENT, 'getKeyCode', [], 'I'), event]);
  });
  def(ACTIVITY, 'dispatchKeyEvent', `(${KEYEVENT})Z`, (r, _m, [self, event]) => {
    interaction(r, self);
    const decor = decorOf(r, self); if (!nullish(decor) && flag(call(r, decor, VIEW, 'dispatchKeyEvent', [KEYEVENT], 'Z', [event]))) return 1;
    // KeyEvent.dispatch(receiver, state, target): DOWN -> onKeyDown (a long press the app cancelled is skipped), UP -> onKeyUp, MULTIPLE -> onKeyMultiple.
    const action = call(r, event, KEYEVENT, 'getAction', [], 'I'), code = call(r, event, KEYEVENT, 'getKeyCode', [], 'I');
    if (action === ACTION_DOWN) return call(r, self, ACTIVITY, 'onKeyDown', ['I', KEYEVENT], 'Z', [code, event]);
    if (action === ACTION_UP) return call(r, self, ACTIVITY, 'onKeyUp', ['I', KEYEVENT], 'Z', [code, event]);
    return call(r, self, ACTIVITY, 'onKeyMultiple', ['I', 'I', KEYEVENT], 'Z', [code, call(r, event, KEYEVENT, 'getRepeatCount', [], 'I'), event]);
  });
  def(ACTIVITY, 'dispatchPopulateAccessibilityEvent', '(Landroid/view/accessibility/AccessibilityEvent;)Z', (r, _m, [self, event]) => {
    const A = 'Landroid/view/accessibility/AccessibilityEvent;';
    call(r, event, A, 'setClassName', [CHARS], 'V', [r.typeOf(self).slice(1, -1).replaceAll('/', '.')]);
    call(r, event, A, 'setPackageName', [CHARS], 'V', [platform.packageName]);
    const title = call(r, self, ACTIVITY, 'getTitle', [], CHARS);
    if (!nullish(title) && r.stringCharacters(title).length) call(r, call(r, event, A, 'getText', [], 'Ljava/util/List;'), 'Ljava/util/List;', 'add', [OBJECT], 'Z', [title]);
    return 1;
  });
  // Window callback panels: the lab has no options-menu panel, so the panel callbacks answer as a Window without a menu does.
  def(ACTIVITY, 'onCreatePanelMenu', `(I${MENU})Z`, (r, _m, [self, feature, menu]) => feature === 0 ? call(r, self, ACTIVITY, 'onCreateOptionsMenu', [MENU], 'Z', [menu]) : 0);
  def(ACTIVITY, 'onPreparePanel', `(I${VIEW}${MENU})Z`, (r, _m, [self, feature, view, menu]) => feature === 0 && !nullish(menu) ? call(r, self, ACTIVITY, 'onPrepareOptionsMenu', [MENU], 'Z', [menu]) : 1);
  def(ACTIVITY, 'onMenuOpened', `(I${MENU})Z`, () => 1);
  def(ACTIVITY, 'onMenuItemSelected', `(I${MENU_ITEM})Z`, (r, _m, [self, feature, item]) => {
    if (feature === 0 || feature === 8) return call(r, self, ACTIVITY, 'onOptionsItemSelected', [MENU_ITEM], 'Z', [item]);
    if (feature === 6) return call(r, self, ACTIVITY, 'onContextItemSelected', [MENU_ITEM], 'Z', [item]);
    return 0;
  });
  def(ACTIVITY, 'onPanelClosed', `(I${MENU})V`, (r, _m, [self, feature, menu]) => {
    if (feature === 0) call(r, self, ACTIVITY, 'onOptionsMenuClosed', [MENU], 'V', [menu]); else if (feature === 6) call(r, self, ACTIVITY, 'onContextMenuClosed', [MENU], 'V', [menu]);
  });

  // ---- Menus, action modes, search, assist: the virtual device draws none of these surfaces ---------------------------------------------------------------------------------------------------
  def(ACTIVITY, 'getMenuInflater', '()Landroid/view/MenuInflater;', () => unsupported('Activity.getMenuInflater: the lab has no menu framework (no android.view.Menu / MenuInflater classes); inflate the menu in the app or use a custom view', 'menu-unsupported'));
  def(ACTIVITY, 'openOptionsMenu', '()V', () => unsupported('Activity.openOptionsMenu: the lab has no options-menu panel to show', 'menu-unsupported'));
  def(ACTIVITY, 'openContextMenu', `(${VIEW})V`, () => unsupported('Activity.openContextMenu: the lab has no context-menu panel to show', 'menu-unsupported'));
  noop('closeOptionsMenu', '()V'); noop('closeContextMenu', '()V'); noop('invalidateOptionsMenu', '()V');   // no panel is ever open; there is no menu to rebuild
  noop('registerForContextMenu', `(${VIEW})V`); noop('unregisterForContextMenu', `(${VIEW})V`);
  def(ACTIVITY, 'registerForContextMenu', `(${VIEW})V`, (r, _m, [self, view]) => { call(r, view, VIEW, 'setOnCreateContextMenuListener', ['Landroid/view/View$OnCreateContextMenuListener;'], 'V', [self]); });
  def(ACTIVITY, 'unregisterForContextMenu', `(${VIEW})V`, (r, _m, [, view]) => { call(r, view, VIEW, 'setOnCreateContextMenuListener', ['Landroid/view/View$OnCreateContextMenuListener;'], 'V', [null]); });
  constant('startActionMode', '(Landroid/view/ActionMode$Callback;)Landroid/view/ActionMode;', null); constant('startActionMode', '(Landroid/view/ActionMode$Callback;I)Landroid/view/ActionMode;', null);   // ActionMode is null when the window cannot start one
  constant('getActionBar', '()Landroid/app/ActionBar;', null);    // android:windowActionBar of the lab's themes is never inflated into a decor action bar
  def(ACTIVITY, 'setActionBar', '(Landroid/widget/Toolbar;)V', () => unsupported('Activity.setActionBar: the lab has no Toolbar/ActionBar framework classes', 'action-bar-unsupported'));
  def(ACTIVITY, 'startSearch', `(${STRING}Z${BUNDLE}Z)V`, () => unsupported('Activity.startSearch: the virtual device has no global search provider', 'search-unsupported'));
  def(ACTIVITY, 'triggerSearch', `(${STRING}${BUNDLE})V`, () => unsupported('Activity.triggerSearch: the virtual device has no global search provider', 'search-unsupported'));
  constant('getSearchEvent', '()Landroid/view/SearchEvent;', null);
  constant('showAssist', `(${BUNDLE})Z`, 0);   // no assistant is installed: the framework answers false
  noop('requestShowKeyboardShortcuts', '()V'); noop('dismissKeyboardShortcutsHelper', '()V');
  def(ACTIVITY, 'requestDragAndDropPermissions', '(Landroid/view/DragEvent;)Landroid/view/DragAndDropPermissions;', () => unsupported('Activity.requestDragAndDropPermissions: drag and drop between apps is not modelled', 'drag-drop-unsupported'));

  // ---- Managed dialogs (deprecated showDialog family, Activity.java ManagedDialog) -----------------------------------------------------------------------------------------------------------
  const dialogs = (r, self) => own(r, self).managedDialogs ??= new Map();
  constant('onCreateDialog', `(I)${DIALOG}`, null);
  def(ACTIVITY, 'onCreateDialog', `(I${BUNDLE})${DIALOG}`, (r, _m, [self, id]) => call(r, self, ACTIVITY, 'onCreateDialog', ['I'], DIALOG, [id]));
  noop('onPrepareDialog', `(I${DIALOG})V`);
  def(ACTIVITY, 'onPrepareDialog', `(I${DIALOG}${BUNDLE})V`, (r, _m, [self, id, dialog]) => { call(r, self, ACTIVITY, 'onPrepareDialog', ['I', DIALOG], 'V', [id, dialog]); });
  def(ACTIVITY, 'showDialog', `(I${BUNDLE})Z`, (r, _m, [self, id, args]) => {
    const map = dialogs(r, self); let managed = map.get(id);
    if (!managed) {
      const dialog = call(r, self, ACTIVITY, 'onCreateDialog', ['I', BUNDLE], DIALOG, [id, args]); if (nullish(dialog)) return 0;
      managed = { dialog, args }; map.set(id, managed);
    }
    managed.args = args; call(r, self, ACTIVITY, 'onPrepareDialog', ['I', DIALOG, BUNDLE], 'V', [id, managed.dialog, args]);
    call(r, managed.dialog, DIALOG, 'show', [], 'V'); return 1;
  });
  def(ACTIVITY, 'showDialog', '(I)V', (r, _m, [self, id]) => { call(r, self, ACTIVITY, 'showDialog', ['I', BUNDLE], 'Z', [id, null]); });
  const managedOrThrow = (r, self, id) => { const managed = dialogs(r, self).get(id); if (!managed) iae(r, `no dialog with id ${id} was ever shown via Activity#showDialog`); return managed; };
  def(ACTIVITY, 'dismissDialog', '(I)V', (r, _m, [self, id]) => { call(r, managedOrThrow(r, self, id).dialog, DIALOG, 'dismiss', [], 'V'); });
  def(ACTIVITY, 'removeDialog', '(I)V', (r, _m, [self, id]) => { const managed = dialogs(r, self).get(id); if (managed) { dialogs(r, self).delete(id); call(r, managed.dialog, DIALOG, 'dismiss', [], 'V'); } });

  // ---- Tasks, parents, finishing, results -----------------------------------------------------------------------------------------------------------------------------------------------------------
  constant('getParent', `()${ACTIVITY}`, null); constant('isChild', '()Z', 0);
  def(ACTIVITY, 'isTaskRoot', '()Z', (r, _m, [self]) => { const frame = frameOf(r, self); return platform.taskOf(frame)?.frames[0] === frame ? 1 : 0; });
  def(ACTIVITY, 'getChangingConfigurations', '()I', (r, _m, [self]) => frameOf(r, self).changingConfiguration ? (platform.lastConfigurationDiff ?? 0) : 0);
  def(ACTIVITY, 'finishAfterTransition', '()V', (r, _m, [self]) => { call(r, self, ACTIVITY, 'finish', [], 'V'); });
  def(ACTIVITY, 'finishFromChild', `(${ACTIVITY})V`, (r, _m, [self]) => { call(r, self, ACTIVITY, 'finish', [], 'V'); });
  const finishFrames = (r, frames) => platform.finishFrames(r, frames);
  def(ACTIVITY, 'finishAffinity', '()V', (r, _m, [self]) => {
    const o = own(r, self); if ((o.activityResultCode ?? 0) !== 0 || !nullish(o.activityResultData)) ise(r, 'Can not be called to deliver a result');
    // ActivityRecord.finishActivityAffinity: this Activity and the ones below it in its task that share its task affinity, down to the first with another affinity.
    const frame = frameOf(r, self), task = platform.taskOf(frame); if (!task) return;
    const affinity = platform.activityInfo(frame.type).affinity, chain = [];
    for (let i = task.frames.indexOf(frame); i >= 0 && platform.activityInfo(task.frames[i].type).affinity === affinity; i--) chain.push(task.frames[i]);
    finishFrames(r, chain);
  });
  def(ACTIVITY, 'finishAndRemoveTask', '()V', (r, _m, [self]) => { const task = platform.taskOf(frameOf(r, self)); if (task) finishFrames(r, [...task.frames].reverse()); });
  def(ACTIVITY, 'finishActivity', '(I)V', (r, _m, [self, requestCode]) => { finishFrames(r, platform.frames.filter(f => f.resultReceiver && f.resultReceiver.ref === self.ref && f.resultRequestCode === requestCode)); });
  def(ACTIVITY, 'finishActivityFromChild', `(${ACTIVITY}I)V`, (r, _m, [self, , requestCode]) => { call(r, self, ACTIVITY, 'finishActivity', ['I'], 'V', [requestCode]); });
  const intentComponent = (r, intent) => {
    const o = r.object(intent); return o.target ? o.target : null;
  };
  def(ACTIVITY, 'getParentActivityIntent', `()${INTENT}`, (r, _m, [self]) => {
    const declaration = platform.manifest?.activities?.find(value => value.descriptor === own(r, self).type || value.name === own(r, self).type.slice(1, -1).replaceAll('/', '.'));
    const parent = declaration?.parentActivityName; if (!parent) return null;
    const cls = parent.startsWith('.') ? platform.packageName + parent : parent, intent = construct(r, INTENT, [], []);
    call(r, intent, INTENT, 'setClassName', [STRING, STRING], INTENT, [platform.packageName, cls]); return intent;
  });
  def(ACTIVITY, 'shouldUpRecreateTask', `(${INTENT})Z`, () => 0);   // one task: the target always belongs to the current task
  def(ACTIVITY, 'navigateUpTo', `(${INTENT})Z`, (r, _m, [self, up]) => {
    const frame = frameOf(r, self), target = intentComponent(r, up);
    if (!target) iae(r, 'navigateUpTo needs an explicit Intent');
    const descriptor = target.startsWith('L') ? target : `L${target.replaceAll('.', '/')};`, index = platform.frames.findIndex(f => f.type === descriptor);
    if (index >= 0 && platform.frames[index] !== frame) {
      // The target is already in the task: everything above it (this Activity included) finishes; CLEAR_TOP / a non-standard launch mode deliver onNewIntent to it instead of recreating it.
      const above = platform.frames.slice(index + 1).reverse();
      const flags = r.object(up).flags | 0, declaration = platform.manifest?.activities?.find(value => value.descriptor === descriptor || `L${value.name.replaceAll('.', '/')};` === descriptor), reuse = (flags & CLEAR_TOP) !== 0 || Number(declaration?.launchMode ?? 0) !== 0;
      finishFrames(r, above);
      if (reuse) call(r, platform.frames[index].activity, ACTIVITY, 'onNewIntent', [INTENT], 'V', [up]);
      else { const old = platform.frames[index]; finishFrames(r, [old]); platform.startActivity(r, up); }
      return 1;
    }
    platform.startActivity(r, up); finishFrames(r, [frame]); return 1;
  });
  def(ACTIVITY, 'navigateUpToFromChild', `(${ACTIVITY}${INTENT})Z`, (r, _m, [self, , intent]) => call(r, self, ACTIVITY, 'navigateUpTo', [INTENT], 'Z', [intent]));
  def(ACTIVITY, 'moveTaskToBack', '(Z)Z', (r, _m, [self, nonRoot]) => {
    const frame = frameOf(r, self), task = platform.taskOf(frame); if (!task) return 0;
    if (!nonRoot && task.frames[0] !== frame) return 0;   // ActivityTaskManager.moveActivityTaskToBack(token, nonRoot): without nonRoot only the task root may move it
    platform.moveTaskToBack(r, task); return 1;
  });
  constant('releaseInstance', '()Z', 0);
  constant('isActivityTransitionRunning', '()Z', 0); constant('isInMultiWindowMode', '()Z', 0); constant('isInPictureInPictureMode', '()Z', 0); constant('isLaunchedFromBubble', '()Z', 0);
  constant('isVoiceInteraction', '()Z', 0); constant('isVoiceInteractionRoot', '()Z', 0); constant('isLocalVoiceInteractionSupported', '()Z', 0);
  constant('getVoiceInteractor', '()Landroid/app/VoiceInteractor;', null); constant('getMaxNumPictureInPictureActions', '()I', 0);
  def(ACTIVITY, 'enterPictureInPictureMode', '()V', (r) => ise(r, 'Activity must be resizeable (PictureInPicture not supported on this device)') );
  def(ACTIVITY, 'enterPictureInPictureMode', '(Landroid/app/PictureInPictureParams;)Z', (r) => ise(r, 'Activity must be resizeable (PictureInPicture not supported on this device)'));
  def(ACTIVITY, 'setPictureInPictureParams', '(Landroid/app/PictureInPictureParams;)V', () => {});
  constant('requestVisibleBehind', '(Z)Z', 0);
  noop('startLockTask', '()V'); noop('stopLockTask', '()V'); noop('showLockTaskEscapeMessage', '()V');
  noop('postponeEnterTransition', '()V'); noop('startPostponedEnterTransition', '()V'); noop('reportFullyDrawn', '()V');
  noop('setEnterSharedElementCallback', '(Landroid/app/SharedElementCallback;)V'); noop('setExitSharedElementCallback', '(Landroid/app/SharedElementCallback;)V');
  // Activity.overridePendingTransition applies to the next start / finish of this Activity; FLAG_ACTIVITY_NO_ANIMATION on that launch drops it (platform.lastTransition records the outcome).
  def(ACTIVITY, 'overridePendingTransition', '(II)V', (r, _m, [self, enter, exit]) => { frameOf(r, self).overrideTransition = { enter, exit }; });
  def(ACTIVITY, 'overridePendingTransition', '(III)V', (r, _m, [self, enter, exit]) => { frameOf(r, self).overrideTransition = { enter, exit }; });
  noop('startLocalVoiceInteraction', `(${BUNDLE})V`); noop('stopLocalVoiceInteraction', '()V');
  constant('getContentScene', '()Landroid/transition/Scene;', null); constant('getContentTransitionManager', '()Landroid/transition/TransitionManager;', null);
  noop('setContentTransitionManager', '(Landroid/transition/TransitionManager;)V');
  def(ACTIVITY, 'getSplashScreen', '()Landroid/window/SplashScreen;', () => unsupported('Activity.getSplashScreen: the system splash screen is not drawn by the lab', 'splash-screen-unsupported'));
  def(ACTIVITY, 'getMediaController', '()Landroid/media/session/MediaController;', (r, _m, [self]) => own(r, self).mediaController ?? null);
  def(ACTIVITY, 'setMediaController', '(Landroid/media/session/MediaController;)V', (r, _m, [self, controller]) => { own(r, self).mediaController = controller; });
  def(ACTIVITY, 'getLoaderManager', '()Landroid/app/LoaderManager;', () => unsupported('Activity.getLoaderManager: android.app.LoaderManager (deprecated in API 28) is not part of the lab framework', 'loader-manager-unsupported'));
  def(ACTIVITY, 'getPreferences', '(I)Landroid/content/SharedPreferences;', (r, _m, [self, mode]) => call(r, self, CONTEXT, 'getSharedPreferences', [STRING, 'I'], 'Landroid/content/SharedPreferences;', [call(r, self, ACTIVITY, 'getLocalClassName', [], STRING), mode]));
  def(ACTIVITY, 'managedQuery', `(${URI}[Ljava/lang/String;${STRING}[Ljava/lang/String;${STRING})Landroid/database/Cursor;`, (r, _m, [self, uri, projection, selection, args, order]) => {
    const resolver = call(r, self, CONTEXT, 'getContentResolver', [], 'Landroid/content/ContentResolver;');
    return call(r, resolver, 'Landroid/content/ContentResolver;', 'query', [URI, '[Ljava/lang/String;', STRING, '[Ljava/lang/String;', STRING], 'Landroid/database/Cursor;', [uri, projection, selection, args, order]);
  });
  const managedCursors = (r, self) => own(r, self).managedCursors ??= [];
  def(ACTIVITY, 'startManagingCursor', '(Landroid/database/Cursor;)V', (r, _m, [self, cursor]) => { managedCursors(r, self).push(cursor); });
  def(ACTIVITY, 'stopManagingCursor', '(Landroid/database/Cursor;)V', (r, _m, [self, cursor]) => { const list = managedCursors(r, self), at = list.findIndex(c => c.ref === cursor?.ref); if (at >= 0) list.splice(at, 1); });
  def(ACTIVITY, 'dump', `(${STRING}Ljava/io/FileDescriptor;Ljava/io/PrintWriter;[Ljava/lang/String;)V`, (r, _m, [self, prefix, , writer]) => {
    if (nullish(writer)) return;
    const P = 'Ljava/io/PrintWriter;', line = s => call(r, writer, P, 'println', [STRING], 'V', [`${text(r, prefix) ?? ''}${s}`]);
    line(`Local Activity ${(r.object(self).id ?? '').toString(16)} State:`);
    line(`  mResumed=${frameOf(r, self).lifecycleStage === 4} mStopped=${frameOf(r, self).lifecycleStage === 2} mFinished=${!!frameOf(r, self).finishing}`);
  });
  def(ACTIVITY, 'getCallingPackage', `()${STRING}`, (r, _m, [self]) => frameOf(r, self).resultReceiver ? platform.packageName : null);
  def(ACTIVITY, 'getCallingActivity', `()${COMPONENT}`, (r, _m, [self]) => {
    const receiver = frameOf(r, self).resultReceiver; if (!receiver) return null;
    const type = r.object(receiver).type; return construct(r, COMPONENT, [STRING, STRING], [platform.packageName, type.slice(1, -1).replaceAll('/', '.')]);
  });
  def(ACTIVITY, 'onProvideReferrer', `()${URI}`, () => null);
  def(ACTIVITY, 'getReferrer', `()${URI}`, (r, _m, [self]) => {
    const intent = call(r, self, ACTIVITY, 'getIntent', [], INTENT);
    if (!nullish(intent)) {
      const uri = call(r, intent, INTENT, 'getParcelableExtra', [STRING], 'Landroid/os/Parcelable;', ['android.intent.extra.REFERRER']); if (!nullish(uri)) return uri;
      const name = call(r, intent, INTENT, 'getStringExtra', [STRING], STRING, ['android.intent.extra.REFERRER_NAME']); if (!nullish(name)) return callStatic(r, URI, 'parse', [STRING], URI, [r.stringCharacters(name)]);
    }
    const frame = frameOf(r, self), caller = frame.resultReceiver || frame.sourceActivity ? platform.packageName : frame === platform.frames[0] ? 'com.android.launcher3' : platform.packageName;
    return callStatic(r, URI, 'parse', [STRING], URI, [`android-app://${caller}`]);
  });

  // ---- Permission requests: the virtual device has no permission dialog; the request is answered with the current grant state, the way a user who dismissed the dialog would -----------------------------
  const denials = new Map();
  def(ACTIVITY, 'requestPermissions', '([Ljava/lang/String;I)V', (r, _m, [self, permissions, requestCode]) => {
    if (requestCode < 0) iae(r, 'requestCode should be >= 0');
    if (nullish(permissions)) iae(r, 'permissions cannot be null or empty');
    const names = r.array(permissions).elements;
    if (names.length === 0) iae(r, 'permission cannot be null or empty');
    const strings = names.map(n => text(r, n)), results = strings.map(permission => platform.holdsPermission(r, permission) ? 0 : -1);
    strings.forEach((permission, i) => { if (results[i] !== 0) denials.set(permission, (denials.get(permission) ?? 0) + 1); });
    r.record(`PERMISSIONS request ${requestCode} ${strings.map((p, i) => `${p}=${results[i] === 0 ? 'granted' : 'denied'}`).join(' ')}`);
    platform.queueTask(() => {
      const outNames = intArray(r, '[Ljava/lang/String;', strings), outResults = intArray(r, '[I', results);
      call(r, self, ACTIVITY, 'onRequestPermissionsResult', ['I', '[Ljava/lang/String;', '[I'], 'V', [requestCode, outNames, outResults]);
    }, 0, [self, permissions]);
  });
  def(ACTIVITY, 'shouldShowRequestPermissionRationale', `(${STRING})Z`, (r, _m, [, permission]) => {
    if (nullish(permission)) npe(r);
    const name = text(r, permission); return !platform.holdsPermission(r, name) && denials.get(name) === 1 ? 1 : 0;   // shown once after the first denial; "don't ask again" after the second
  });

  // ---- Activity starts ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const start = (r, caller, intent, requestCode) => platform.startActivity(r, intent, requestCode >= 0 ? caller : null, requestCode);
  def(ACTIVITY, 'startActivityFromChild', `(${ACTIVITY}${INTENT}I)V`, (r, _m, [self, , intent, requestCode]) => start(r, self, intent, requestCode));
  def(ACTIVITY, 'startActivityFromChild', `(${ACTIVITY}${INTENT}I${BUNDLE})V`, (r, _m, [self, , intent, requestCode]) => start(r, self, intent, requestCode));
  const fromFragment = (r, self, fragment, intent, requestCode) => { if (requestCode >= 0) (frameOf(r, self).fragmentRequests ??= new Map()).set(requestCode, fragment); start(r, self, intent, requestCode); };
  def(ACTIVITY, 'startActivityFromFragment', `(${FRAGMENT}${INTENT}I)V`, (r, _m, [self, fragment, intent, requestCode]) => fromFragment(r, self, fragment, intent, requestCode));
  def(ACTIVITY, 'startActivityFromFragment', `(${FRAGMENT}${INTENT}I${BUNDLE})V`, (r, _m, [self, fragment, intent, requestCode]) => fromFragment(r, self, fragment, intent, requestCode));
  def(ACTIVITY, 'startActivityIfNeeded', `(${INTENT}I)Z`, (r, _m, [self, intent, requestCode]) => { start(r, self, intent, requestCode); return 1; });
  def(ACTIVITY, 'startActivityIfNeeded', `(${INTENT}I${BUNDLE})Z`, (r, _m, [self, intent, requestCode]) => { start(r, self, intent, requestCode); return 1; });
  def(ACTIVITY, 'startNextMatchingActivity', `(${INTENT})Z`, () => 0);   // no other Activity of the app matches the same Intent filters as a caller-chosen alternative
  def(ACTIVITY, 'startNextMatchingActivity', `(${INTENT}${BUNDLE})Z`, () => 0);
  def(ACTIVITY, 'createPendingResult', `(I${INTENT}I)${PENDING}`, (r, _m, [self, requestCode, data, flags]) => platform.pendingIntents.createResult(r, self, requestCode, data, flags));
  const noSender = () => unsupported('IntentSender-based starts are not modelled: the virtual device has no system service to resolve the sender', 'intent-sender-unsupported');
  for (const sig of [`(${SENDER}I${INTENT}III)V`, `(${SENDER}I${INTENT}III${BUNDLE})V`]) def(ACTIVITY, 'startIntentSenderForResult', sig, noSender);
  for (const sig of [`(${ACTIVITY}${SENDER}I${INTENT}III)V`, `(${ACTIVITY}${SENDER}I${INTENT}III${BUNDLE})V`]) def(ACTIVITY, 'startIntentSenderFromChild', sig, noSender);
  for (const owner of [CONTEXT, WRAPPER, IMPL]) { for (const sig of [`(${SENDER}${INTENT}III)V`, `(${SENDER}${INTENT}III${BUNDLE})V`]) def(owner, 'startIntentSender', sig, noSender); }

  // ---- Context methods an Activity inherits ---------------------------------------------------------------------------------------------------------------------------------------------------
  const defContext = (name, signature, fn, options) => { for (const owner of [CONTEXT, WRAPPER, IMPL]) def(owner, name, signature, fn, options); };
  const codePath = () => `${platform.javaIo.fs().codePath}/base.apk`;
  defContext('getPackageCodePath', `()${STRING}`, () => codePath());
  defContext('getPackageResourcePath', `()${STRING}`, () => codePath());
  defContext('getOpPackageName', `()${STRING}`, () => platform.packageName);
  defContext('getColorStateList', `(I)Landroid/content/res/ColorStateList;`, (r, _m, [self, id]) => call(r, call(r, self, CONTEXT, 'getTheme', [], 'Landroid/content/res/Resources$Theme;'), 'Landroid/content/res/Resources;', 'getColorStateList', ['I', 'Landroid/content/res/Resources$Theme;'], 'Landroid/content/res/ColorStateList;', [id, call(r, self, CONTEXT, 'getTheme', [], 'Landroid/content/res/Resources$Theme;')]) );
  defContext('getString', `(I[Ljava/lang/Object;)${STRING}`, (r, _m, [self, id, args]) => call(r, call(r, self, CONTEXT, 'getResources', [], 'Landroid/content/res/Resources;'), 'Landroid/content/res/Resources;', 'getString', ['I', '[Ljava/lang/Object;'], STRING, [id, args]));
  defContext('getDisplay', '()Landroid/view/Display;', (r) => platform.displayHost.get(r));
  defContext('isUiContext', '()Z', (r, _m, [self]) => r.isSubtype(r.object(self).type, ACTIVITY) ? 1 : 0);
  defContext('getParams', '()Landroid/content/ContextParams;', () => null);   // a Context not made by createContext(ContextParams) has no params
  defContext('getAttributionSource', '()Landroid/content/AttributionSource;', () => unsupported('Context.getAttributionSource: android.content.AttributionSource is not part of the lab framework', 'attribution-source-unsupported'));
  for (const name of ['getWallpaper', 'peekWallpaper']) defContext(name, '()Landroid/graphics/drawable/Drawable;', () => null);   // no wallpaper is set on the virtual device (WallpaperManager reports none either)
  defContext('getWallpaperDesiredMinimumWidth', '()I', () => platform.device.widthDp * ((platform.device.densityDpi ?? 160) / 160) | 0);
  defContext('getWallpaperDesiredMinimumHeight', '()I', () => platform.device.heightDp * ((platform.device.densityDpi ?? 160) / 160) | 0);
  defContext('clearWallpaper', '()V', (r) => r.throwJava('Ljava/lang/SecurityException;', `uid ${platform.virtualProcess.uid} does not have android.permission.SET_WALLPAPER.`));
  defContext('setWallpaper', `(${BITMAP})V`, (r) => r.throwJava('Ljava/lang/SecurityException;', `uid ${platform.virtualProcess.uid} does not have android.permission.SET_WALLPAPER.`));
  defContext('setWallpaper', '(Ljava/io/InputStream;)V', (r) => r.throwJava('Ljava/lang/SecurityException;', `uid ${platform.virtualProcess.uid} does not have android.permission.SET_WALLPAPER.`));
  // Fresh Contexts of the same app.
  const derived = (r, self, extra = {}) => { const ctx = r.makeObject(IMPL); Object.assign(r.object(ctx), { packageName: platform.packageName, outerContext: self, ...extra }); return ctx; };
  defContext('createDisplayContext', '(Landroid/view/Display;)Landroid/content/Context;', (r, _m, [self, display]) => { if (nullish(display)) iae(r, 'display must not be null'); return derived(r, self); });
  defContext('createWindowContext', `(I${BUNDLE})Landroid/content/Context;`, (r, _m, [self]) => derived(r, self, { uiContext: true }));
  defContext('createWindowContext', `(Landroid/view/Display;I${BUNDLE})Landroid/content/Context;`, (r, _m, [self, display]) => { if (nullish(display)) iae(r, 'display must not be null'); return derived(r, self, { uiContext: true }); });
  defContext('createAttributionContext', `(${STRING})Landroid/content/Context;`, (r, _m, [self, tag]) => derived(r, self, { attributionTag: tag }));
  defContext('createContext', '(Landroid/content/ContextParams;)Landroid/content/Context;', () => unsupported('Context.createContext(ContextParams): android.content.ContextParams is not part of the lab framework', 'context-params-unsupported'));
  defContext('createContextForSplit', `(${STRING})Landroid/content/Context;`, (r) => r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', 'Split name null'));
  defContext('createPackageContext', `(${STRING}I)Landroid/content/Context;`, (r, _m, [self, name]) => {
    if (nullish(name)) npe(r);
    if (text(r, name) !== platform.packageName) r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', `Application package ${text(r, name)} not found`);   // the virtual device cannot load another package's code or resources
    return derived(r, self);
  });
  // URI permissions: the app is the only package, so its own URIs are always granted, a foreign content URI is not, and granting to another package is allowed for providers that grant URI permissions.
  const checkUri = (r, uri) => {
    if (nullish(uri)) npe(r);
    const scheme = text(r, call(r, uri, URI, 'getScheme', [], STRING)); if (scheme !== 'content') return -1;   // only content URIs carry grants
    const authority = text(r, call(r, uri, URI, 'getAuthority', [], STRING)), provider = (platform.manifest?.providers ?? []).find(p => String(p.authorities ?? '').split(';').includes(authority));
    return provider ? 0 : -1;   // the app's own providers resolve for itself; a content URI of another app is denied (no grants exist on the virtual device)
  };
  defContext('checkUriPermission', `(${URI}III)I`, (r, _m, [, uri]) => checkUri(r, uri));
  defContext('checkUriPermission', `(${URI}${STRING}${STRING}III)I`, (r, _m, [, uri]) => checkUri(r, uri));
  defContext('checkCallingUriPermission', `(${URI}I)I`, (r, _m, [, uri]) => checkUri(r, uri));
  defContext('checkCallingOrSelfUriPermission', `(${URI}I)I`, (r, _m, [, uri]) => checkUri(r, uri));
  const checkUris = (r, uris) => { if (nullish(uris)) npe(r); const size = call(r, uris, 'Ljava/util/List;', 'size', [], 'I'); return intArray(r, '[I', Array.from({ length: size }, (_, i) => checkUri(r, call(r, uris, 'Ljava/util/List;', 'get', ['I'], OBJECT, [i])))); };
  defContext('checkUriPermissions', `(Ljava/util/List;III)[I`, (r, _m, [, uris]) => checkUris(r, uris));
  defContext('checkCallingUriPermissions', `(Ljava/util/List;I)[I`, (r, _m, [, uris]) => checkUris(r, uris));
  defContext('checkCallingOrSelfUriPermissions', `(Ljava/util/List;I)[I`, (r, _m, [, uris]) => checkUris(r, uris));
  const enforceUri = (r, result, uri, message) => { if (result !== 0) r.throwJava('Ljava/lang/SecurityException;', `${message === null ? '' : text(r, message) + ': '}Neither user ${platform.virtualProcess.uid} nor current process has uri ${text(r, call(r, uri, OBJECT, 'toString', [], STRING))}.`); };
  defContext('enforceUriPermission', `(${URI}IIILjava/lang/String;)V`, (r, _m, [, uri, , , , message]) => enforceUri(r, checkUri(r, uri), uri, message));
  defContext('enforceUriPermission', `(${URI}${STRING}${STRING}IIILjava/lang/String;)V`, (r, _m, [, uri, , , , , , message]) => enforceUri(r, checkUri(r, uri), uri, message));
  defContext('enforceCallingUriPermission', `(${URI}ILjava/lang/String;)V`, (r, _m, [, uri, , message]) => enforceUri(r, checkUri(r, uri), uri, message));
  defContext('enforceCallingOrSelfUriPermission', `(${URI}ILjava/lang/String;)V`, (r, _m, [, uri, , message]) => enforceUri(r, checkUri(r, uri), uri, message));
  defContext('grantUriPermission', `(${STRING}${URI}I)V`, (r, _m, [, to, uri]) => { if (nullish(to) || nullish(uri)) npe(r); r.record(`URIPERMISSION grant ${text(r, to)}`); });
  defContext('revokeUriPermission', `(${URI}I)V`, (r, _m, [, uri]) => { if (nullish(uri)) npe(r); });
  defContext('revokeUriPermission', `(${STRING}${URI}I)V`, (r, _m, [, , uri]) => { if (nullish(uri)) npe(r); });
  defContext('revokeSelfPermissionOnKill', `(${STRING})V`, (r, _m, [, permission]) => { if (nullish(permission)) npe(r); });
  defContext('revokeSelfPermissionsOnKill', '(Ljava/util/Collection;)V', (r, _m, [, permissions]) => { if (nullish(permissions)) npe(r); });
  // Moving storage from another Context of the same app.
  defContext('moveSharedPreferencesFrom', `(${CONTEXT}${STRING})Z`, (r, _m, [, source]) => { if (nullish(source)) npe(r); return 1; });   // ContextImpl.moveFiles: both Contexts share the app's data directory, the files are already there (res != -1)
  defContext('moveDatabaseFrom', `(${CONTEXT}${STRING})Z`, (r, _m, [, source]) => { if (nullish(source)) npe(r); return 1; });

  // ---- Broadcast variants -----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const broadcast = (r, self, intent) => call(r, self, CONTEXT, 'sendBroadcast', [INTENT], 'V', [intent]);
  const needSticky = r => { if (!platform.holdsPermission(r, 'android.permission.BROADCAST_STICKY')) r.throwJava('Ljava/lang/SecurityException;', `Neither user ${platform.virtualProcess.uid} nor current process has android.permission.BROADCAST_STICKY.`); };
  const sticky = platform.stickyBroadcasts ??= gcRoot(new Map());
  const stick = (r, intent) => {
    needSticky(r); const action = call(r, intent, INTENT, 'getAction', [], STRING); if (nullish(action)) return;
    sticky.set(text(r, action), construct(r, INTENT, [INTENT], [intent]));
  };
  defContext('sendBroadcastAsUser', `(${INTENT}Landroid/os/UserHandle;)V`, (r, _m, [self, intent]) => broadcast(r, self, intent));
  defContext('sendBroadcastAsUser', `(${INTENT}Landroid/os/UserHandle;${STRING})V`, (r, _m, [self, intent]) => broadcast(r, self, intent));
  defContext('sendBroadcastWithMultiplePermissions', `(${INTENT}[Ljava/lang/String;)V`, (r, _m, [self, intent]) => broadcast(r, self, intent));
  defContext('sendStickyBroadcast', `(${INTENT})V`, (r, _m, [self, intent]) => { stick(r, intent); broadcast(r, self, intent); });
  defContext('sendStickyBroadcast', `(${INTENT}${BUNDLE})V`, (r, _m, [self, intent]) => { stick(r, intent); broadcast(r, self, intent); });
  defContext('sendStickyBroadcastAsUser', `(${INTENT}Landroid/os/UserHandle;)V`, (r, _m, [self, intent]) => { stick(r, intent); broadcast(r, self, intent); });
  const unstick = (r, intent) => { needSticky(r); const action = call(r, intent, INTENT, 'getAction', [], STRING); if (!nullish(action)) sticky.delete(text(r, action)); };
  defContext('removeStickyBroadcast', `(${INTENT})V`, (r, _m, [, intent]) => unstick(r, intent));
  defContext('removeStickyBroadcastAsUser', `(${INTENT}Landroid/os/UserHandle;)V`, (r, _m, [, intent]) => unstick(r, intent));
  // Ordered broadcasts: delivered to the registered receivers, then the final receiver runs with the initial result (receiver-side result editing is not modelled: no receiver can change it).
  const ordered = (r, self, intent, resultReceiver, scheduler, initialCode, initialData, initialExtras) => {
    broadcast(r, self, intent);
    if (nullish(resultReceiver)) return;
    platform.queueTask(() => {
      call(r, resultReceiver, 'Landroid/content/BroadcastReceiver;', 'setResultCode', ['I'], 'V', [initialCode]);
      call(r, resultReceiver, 'Landroid/content/BroadcastReceiver;', 'onReceive', [CONTEXT, INTENT], 'V', [self, intent]);
    }, 0, [resultReceiver, intent, self, initialData, initialExtras]);
  };
  defContext('sendOrderedBroadcast', `(${INTENT}${STRING})V`, (r, _m, [self, intent]) => ordered(r, self, intent, null, null, -1, null, null));
  defContext('sendOrderedBroadcast', `(${INTENT}${STRING}Landroid/content/BroadcastReceiver;Landroid/os/Handler;I${STRING}${BUNDLE})V`, (r, _m, [self, intent, , receiver, handler, code, data, extras]) => ordered(r, self, intent, receiver, handler, code, data, extras));
  defContext('sendOrderedBroadcast', `(${INTENT}${STRING}${STRING}Landroid/content/BroadcastReceiver;Landroid/os/Handler;I${STRING}${BUNDLE})V`, (r, _m, [self, intent, , , receiver, handler, code, data, extras]) => ordered(r, self, intent, receiver, handler, code, data, extras));
  defContext('sendOrderedBroadcast', `(${INTENT}I${STRING}${STRING}Landroid/content/BroadcastReceiver;Landroid/os/Handler;${STRING}${BUNDLE}${BUNDLE})V`, (r, _m, [self, intent, , , , receiver, handler, data, extras]) => ordered(r, self, intent, receiver, handler, -1, data, extras));
  defContext('sendOrderedBroadcastAsUser', `(${INTENT}Landroid/os/UserHandle;${STRING}Landroid/content/BroadcastReceiver;Landroid/os/Handler;I${STRING}${BUNDLE})V`, (r, _m, [self, intent, , , receiver, handler, code, data, extras]) => ordered(r, self, intent, receiver, handler, code, data, extras));
  defContext('sendStickyOrderedBroadcast', `(${INTENT}Landroid/content/BroadcastReceiver;Landroid/os/Handler;I${STRING}${BUNDLE})V`, (r, _m, [self, intent, receiver, handler, code, data, extras]) => { stick(r, intent); ordered(r, self, intent, receiver, handler, code, data, extras); });
  defContext('sendStickyOrderedBroadcastAsUser', `(${INTENT}Landroid/os/UserHandle;Landroid/content/BroadcastReceiver;Landroid/os/Handler;I${STRING}${BUNDLE})V`, (r, _m, [self, intent, , receiver, handler, code, data, extras]) => { stick(r, intent); ordered(r, self, intent, receiver, handler, code, data, extras); });
  // Starting / stopping services and activities through the Context.
  defContext('startActivity', `(${INTENT}${BUNDLE})V`, (r, _m, [self, intent]) => call(r, self, CONTEXT, 'startActivity', [INTENT], 'V', [intent]));
  defContext('startActivities', `([${INTENT})V`, (r, _m, [self, intents]) => { platform.startBatch(() => { for (const intent of r.array(intents).elements) call(r, self, CONTEXT, 'startActivity', [INTENT], 'V', [intent]); }); });
  defContext('startActivities', `([${INTENT}${BUNDLE})V`, (r, _m, [self, intents]) => call(r, self, CONTEXT, 'startActivities', [`[${INTENT}`], 'V', [intents]));
  defContext('bindService', `(${INTENT}ILjava/util/concurrent/Executor;Landroid/content/ServiceConnection;)Z`, (r, _m, [self, intent, flags, , connection]) => call(r, self, CONTEXT, 'bindService', [INTENT, 'Landroid/content/ServiceConnection;', 'I'], 'Z', [intent, connection, flags]));
  defContext('bindIsolatedService', `(${INTENT}I${STRING}Ljava/util/concurrent/Executor;Landroid/content/ServiceConnection;)Z`, (r, _m, [self, intent, flags, , , connection]) => call(r, self, CONTEXT, 'bindService', [INTENT, 'Landroid/content/ServiceConnection;', 'I'], 'Z', [intent, connection, flags]));
  defContext('bindServiceAsUser', `(${INTENT}Landroid/content/ServiceConnection;ILandroid/os/UserHandle;)Z`, (r, _m, [self, intent, connection, flags]) => call(r, self, CONTEXT, 'bindService', [INTENT, 'Landroid/content/ServiceConnection;', 'I'], 'Z', [intent, connection, flags]));
  defContext('updateServiceGroup', '(Landroid/content/ServiceConnection;II)V', (r, _m, [, connection]) => { if (nullish(connection)) npe(r); });
  defContext('startInstrumentation', `(${COMPONENT}${STRING}${BUNDLE})Z`, (r) => r.throwJava('Ljava/lang/SecurityException;', `Permission Denial: starting instrumentation requires android.permission.RUN_INSTRUMENTATION`));
  return registry;
}

const floatView = new DataView(new ArrayBuffer(4));
function bitsFloat(bits) { floatView.setInt32(0, bits | 0, true); return floatView.getFloat32(0, true); }
