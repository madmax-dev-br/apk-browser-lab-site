import { createHostRegistry } from './host-contract.js?v=fd59ee7c3d79';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=fd59ee7c3d79';

// android.window.OnBackInvokedDispatcher of an Activity window (WindowOnBackInvokedDispatcher): the registry of OnBackInvokedCallbacks a window keeps and the Back dispatch rule
// of Android 13. AndroidX (AppCompat's Api33Impl, ComponentActivity / OnBackPressedDispatcher) registers its callbacks here when SDK_INT >= 33.
//   * Registration needs android:enableOnBackInvokedCallback="true" on the <application> or the <activity>; otherwise the platform logs the same warning and ignores it, and Back
//     stays the legacy key path (Activity.onBackPressed).
//   * Back goes to the callback with the highest priority (the most recently registered one among equal priorities): callback.onBackInvoked(). With none registered it is
//     the legacy Activity.onBackPressed. Predictive-back progress events (onBackStarted/Progressed) are not generated: there is no gesture surface in the browser VM.
const IFACE = 'Landroid/window/OnBackInvokedDispatcher;', DISPATCHER = 'Landroid/window/WindowOnBackInvokedDispatcher;', CALLBACK = 'Landroid/window/OnBackInvokedCallback;';
const PRIORITY_DEFAULT = 0, PRIORITY_OVERLAY = 1000000;

export function createBackDispatcherHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  registry.interfaces.set(IFACE, []); registry.parents.set(IFACE, 'Ljava/lang/Object;');
  type(DISPATCHER, 'Ljava/lang/Object;', [IFACE], { allocatable: true });
  const entries = gcRoot(new Map());            // dispatcher ref id -> [{ priority, callback, seq }]
  let sequence = 0;
  const same = (a, b) => a?.ref !== undefined && a.ref === b?.ref;
  const enabled = (runtime, dispatcher) => {
    const manifest = platform.manifest ?? {};
    const value = (manifest.application ?? {}).enableOnBackInvokedCallback;
    return value === true || value === 'true' || value === 1;
  };
  def(DISPATCHER, 'registerOnBackInvokedCallback', `(I${CALLBACK})V`, (r, _m, [self, priority, callback]) => {
    if (callback === null) r.throwJava('Ljava/lang/NullPointerException;', 'OnBackInvokedCallback is null');
    if (priority < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Application registered OnBackInvokedCallback cannot have negative priority. Priority: ' + priority);
    if (!enabled(r, self)) { r.record("LOG W WindowOnBackInvokedDispatcher: OnBackInvokedCallback is not enabled for the application.\nSet 'android:enableOnBackInvokedCallback=\"true\"' in the application manifest."); return; }
    const list = entries.get(self.ref) ?? entries.set(self.ref, []).get(self.ref);
    const at = list.findIndex(entry => same(entry.callback, callback)); if (at >= 0) list.splice(at, 1);   // re-registering moves the callback to the top of its priority
    list.push({ priority, callback, seq: ++sequence });
  });
  def(DISPATCHER, 'unregisterOnBackInvokedCallback', `(${CALLBACK})V`, (r, _m, [self, callback]) => {
    if (callback === null) r.throwJava('Ljava/lang/NullPointerException;', 'OnBackInvokedCallback is null');
    const list = entries.get(self.ref); if (!list) return; const at = list.findIndex(entry => same(entry.callback, callback)); if (at >= 0) list.splice(at, 1);
  });
  return {
    ...registry,
    /** Window.getOnBackInvokedDispatcher(): one dispatcher per window (Activity.getOnBackInvokedDispatcher() is its window's). */
    forOwner(runtime, owner) {
      const object = runtime.object(owner);
      if (!object.onBackDispatcher) { object.onBackDispatcher = runtime.makeObject(DISPATCHER); runtime.object(object.onBackDispatcher).dispatcherOwner = owner; }
      return object.onBackDispatcher;
    },
    /** The Back key / gesture on a window: true when a registered callback consumed it. */
    dispatchBack(runtime, owner) {
      const dispatcher = runtime.object(owner).onBackDispatcher; const list = dispatcher && entries.get(dispatcher.ref); if (!list?.length) return false;
      const top = [...list].sort((a, b) => b.priority - a.priority || b.seq - a.seq)[0];
      runtime.dispatch({ owner: runtime.object(top.callback).type, name: 'onBackInvoked', signature: '()V', parameters: [], result: 'V' }, [top.callback], 'virtual');
      return true;
    },
    [GC_ROOTS](visit) { for (const list of entries.values()) for (const entry of list) visit(entry.callback); },
    PRIORITY_DEFAULT, PRIORITY_OVERLAY,
  };
}
