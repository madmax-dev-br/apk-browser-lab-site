// android.view.WindowManagerGlobal (android-13.0.0_r1) as the process-wide registry of the virtual device's windows.
//
// The class is hidden but on the unsupported-app-usage list, and window-tracking libraries reach it by reflection: Class.forName, the static sDefaultWindowManager or getInstance(),
// getDeclaredField("mViews" / "mRoots" / "mParams" / "mLock"), and often Field.set of mViews to an ArrayList subclass that is told of every window added and removed. So the singleton
// is an object with the real instance fields of WindowManagerGlobal.java, holding real java.util.ArrayList / android.util.ArraySet objects, and every window the lab adds or removes
// (an Activity's decor after its first onResume, a Dialog, a PopupWindow, any WindowManager.addView) goes THROUGH those lists with the calls WindowManagerGlobal makes:
//   addView:          findViewLocked (mViews.indexOf), then mViews.add(view), mRoots.add(root), mParams.add(params)
//   updateViewLayout: findViewLocked, mParams.remove(index), mParams.add(index, params)
//   removeView:       findViewLocked, then doRemoveView: mRoots.indexOf(root), mRoots.remove(i), mParams.remove(i), mViews.remove(i), mDyingViews.remove(view)
// The calls are virtual, so a list an app swapped in sees each of them, in the order a device makes them. The lists are read from the instance's fields at every call (Field.set is
// honoured). The member table (names, types, modifiers) is the generated one of src/hidden-member-tables.js; the values live in the instance's fields map.
//
// Where the lab differs, by design:
//  - the original class is not compiled in: its addView builds a ViewRootImpl (surfaces, IWindowSession, Choreographer, input channels) the lab replaces with its own window host
//    (src/dialog-window-host.js), and it would cost framework.dex method references the single-DEX budget does not have;
//  - mRoots holds the lab's android.view.ViewRootImpl companion of the window (the object View.getViewRootImpl() returns), appended once the root is attached (on a device it is
//    appended just before ViewRootImpl.setView): mViews.add still comes first and before the view is attached, as on a device;
//  - removal is immediate (the lab has no deferred MSG_DIE), so mDyingViews stays empty;
//  - sWindowSession stays null: the lab has no IWindowSession. sWindowManagerService is the virtual device's IWindowManager once an Activity has been launched
//    (WindowManagerGlobal.initialize() in handleLaunchActivity), null before;
//  - toasts are not windows of the app here (Android 13 draws text toasts in System UI; the lab's toast host has no in-app window), so they never appear in mViews.
const WMG = 'Landroid/view/WindowManagerGlobal;', VIEW = 'Landroid/view/View;', ROOT_IMPL = 'Landroid/view/ViewRootImpl;', LIST = 'Ljava/util/ArrayList;', ARRAY_SET = 'Landroid/util/ArraySet;';
const OBJECT = 'Ljava/lang/Object;', LP = 'Landroid/view/WindowManager$LayoutParams;', VLP = 'Landroid/view/ViewGroup$LayoutParams;', WINDOW = 'Landroid/view/Window;';
const FIELD = { mLock: OBJECT, mViews: LIST, mRoots: LIST, mParams: LIST, mDyingViews: ARRAY_SET, mWindowlessRoots: LIST };
const key = name => `${WMG}->${name}:${FIELD[name]}`;
const isNull = value => value === null || value === undefined || value === 0;

export function createWindowManagerGlobal(platform) {
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = [], mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, mode === 'static' ? {} : { receiver }), mode);
  const construct = (r, type, parameters = [], args = []) => { const ref = r.allocate(type); call(r, ref, type, '<init>', parameters, 'V', args, 'direct'); return ref; };
  const list = (r, name) => {
    const value = r.object(instance(r)).fields.get(key(name));
    if (isNull(value)) r.throwJava('Ljava/lang/NullPointerException;', `Attempt to invoke a method on a null object reference (WindowManagerGlobal.${name})`);   // what the original does with a field an app set to null
    return value;
  };
  // A virtual call: the subclass an app swapped in sees it (and its code is traced as the app's). On the platform's own ArrayList / ArraySet the bookkeeping is muted in the trace, so
  // it never evicts APK-visible entries.
  const quiet = (r, body) => { const muted = r.traceMuted; r.traceMuted = true; try { return body(); } finally { r.traceMuted = muted; } };
  const on = (r, target, name, parameters, result, args) => { const type = r.object(target).type, run = () => call(r, target, type, name, parameters, result, args); return type === LIST || type === ARRAY_SET ? quiet(r, run) : run(); };
  const indexOf = (r, name, value) => on(r, list(r, name), 'indexOf', [OBJECT], 'I', [value]) | 0;
  const removeAt = (r, name, index) => on(r, list(r, name), 'remove', ['I'], OBJECT, [index]);
  const append = (r, name, value) => on(r, list(r, name), 'add', [OBJECT], 'Z', [value]);
  const insert = (r, name, index, value) => on(r, list(r, name), 'add', ['I', OBJECT], 'V', [index, value]);
  const get = (r, name, index) => on(r, list(r, name), 'get', ['I'], OBJECT, [index]);

  /** WindowManagerGlobal.getInstance(): the singleton, created on first use with the fields the constructor's initialisers give it. */
  function instance(r) {
    if (r.hostWindowManagerGlobal) return r.hostWindowManagerGlobal;
    const ref = r.makeObject(WMG), fields = r.object(ref).fields, muted = r.traceMuted;
    r.hostWindowManagerGlobal = ref; (r.hostStaticValues ??= []).push(ref);
    r.traceMuted = true;   // the singleton's construction is the platform's, not the app's: it must not evict APK-visible trace entries
    try {
      r.storeField(fields, key('mLock'), construct(r, OBJECT));
      for (const name of ['mViews', 'mRoots', 'mParams', 'mWindowlessRoots']) r.storeField(fields, key(name), construct(r, LIST));
      if (r.classes.has(ARRAY_SET)) r.storeField(fields, key('mDyingViews'), construct(r, ARRAY_SET));   // android.util.ArraySet is in every framework DEX; a runtime loaded without one has no value here
    } finally { r.traceMuted = muted; }
    return ref;
  }
  /** The ViewRootImpl companion of an attached window root (View.getViewRootImpl), or a bare one bound to the root when the runtime builds none (no WindowInsets class). */
  const viewRoot = (r, attachedView, root) => {
    // the companion exists only where the runtime builds the window's AttachInfo (with the original WindowInsets: src/window-insets-host.js)
    const impl = isNull(attachedView) || !r.classes.has('Landroid/view/WindowInsets;') ? null : quiet(r, () => call(r, attachedView, VIEW, 'getViewRootImpl', [], ROOT_IMPL));
    if (!isNull(impl)) return impl;
    const bare = r.makeObject(ROOT_IMPL); r.object(bare).windowRootView = root; return bare;
  };
  const describe = (r, view) => `${r.object(view).type.slice(1, -1).replaceAll('/', '.')}@${view.ref.toString(16)}`;

  return {
    instance,
    /** WindowManagerGlobal.addView, first half: "has already been added" through mViews.indexOf, then mViews.add(view). Before the lab attaches the root. */
    beforeAdd(r, view) {
      if (indexOf(r, 'mViews', view) >= 0) r.throwJava('Ljava/lang/IllegalStateException;', `View ${describe(r, view)} has already been added to the window manager.`);
      append(r, 'mViews', view);
    },
    /** WindowManagerGlobal.addView, second half: mRoots.add(root), mParams.add(params), once the lab attached the window (`attachedView` is the view the lab attached). */
    afterAdd(r, view, params, attachedView = view) { append(r, 'mRoots', viewRoot(r, attachedView, view)); append(r, 'mParams', params); },
    /** A failed add after mViews.add (the lab refused the window): the entries are taken out again, as removeViewLocked(index, true) does when setView throws. */
    abortAdd(r, view) { const index = indexOf(r, 'mViews', view); if (index >= 0) removeAt(r, 'mViews', index); },
    /** WindowManagerGlobal.findViewLocked(view, true): the index in mViews or the IllegalArgumentException a device throws. */
    find(r, view) {
      const index = indexOf(r, 'mViews', view);
      if (index < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `View=${describe(r, view)} not attached to window manager`);
      return index;
    },
    /** doRemoveView: the root's index in mRoots, then remove(index) from mRoots, mParams and mViews, and mDyingViews.remove(view). */
    remove(r, view, index = this.find(r, view)) {
      const root = get(r, 'mRoots', index), at = indexOf(r, 'mRoots', root);
      if (at < 0) return;
      removeAt(r, 'mRoots', at); removeAt(r, 'mParams', at); const removed = removeAt(r, 'mViews', at);
      const dying = r.object(instance(r)).fields.get(key('mDyingViews'));
      if (!isNull(removed) && !isNull(dying)) on(r, dying, 'remove', [OBJECT], 'Z', [removed]);
    },
    /** updateViewLayout: mParams.remove(index), mParams.add(index, params). */
    update(r, view, params, index = this.find(r, view)) { removeAt(r, 'mParams', index); insert(r, 'mParams', index, params); },
    /** getWindowViews(): new ArrayList<>(mViews). */
    windowViews(r) { return construct(r, LIST, ['Ljava/util/Collection;'], [list(r, 'mViews')]); },
    /** mViews.indexOf(view), -1 before any window exists (closeAll only removes the windows the lists hold). */
    indexIn(r, view) { return r.hostWindowManagerGlobal ? indexOf(r, 'mViews', view) : -1; },

    // ---- the Activity's own window: ActivityThread.handleResumeActivity adds it once, after the first onResume (wm.addView(decor, window.getAttributes()));
    // handleDestroyActivity removes it (removeViewImmediate) before WindowManagerGlobal.closeAll removes the windows the Activity still owns.
    // The lab builds an Activity's Window object only when the app asks for it (Activity.getWindow), and building it changes what android.R.id.content finds; so the entry is
    // the Window's decor when the app already has the Window, and otherwise the content root the lab attaches as the window's root view, with a new
    // WindowManager.LayoutParams() (TYPE_APPLICATION, MATCH_PARENT) as its attributes. The entry stays the view that was added, as the decor does on a device, for as long as
    // the Activity lives (a later setContentView changes nothing in the lists).
    activityResumed(r, frame, attach) {
      if (frame.globalWindowAdded || !frame.root) { attach(); return; }
      let view = frame.root, params;
      if (frame.window) {
        view = r.object(frame.window).decor; params = quiet(r, () => call(r, frame.window, WINDOW, 'getAttributes', [], LP));
        // view.setLayoutParams(wparams): stored as View.setLayoutParams stores it, without its requestLayout (the lab lays out the content root, not this decor).
        r.object(view).layoutParams = params; r.storeField(r.object(view).fields, `${VIEW}->mLayoutParams:${VLP}`, params);
      } else params = quiet(r, () => construct(r, LP));
      this.beforeAdd(r, view);
      frame.globalWindowAdded = view;
      attach();
      this.afterAdd(r, view, params, r.object(frame.root).attached ? frame.root : null);
      r.record(`WINDOW global add activity window ${view.ref}`);
    },
    activityDestroyed(r, frame) {
      const view = frame.globalWindowAdded; if (!view) return; frame.globalWindowAdded = null;
      const index = indexOf(r, 'mViews', view); if (index >= 0) this.remove(r, view, index);
      r.record(`WINDOW global remove activity window ${view.ref}`);
    },
  };
}
