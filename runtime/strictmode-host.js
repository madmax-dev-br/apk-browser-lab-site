import { createHostRegistry } from './host-contract.js?v=3e66c3e6cd8f';
import { collectGarbage } from './heap-gc.js?v=3e66c3e6cd8f';

// The platform side of android.os.StrictMode. StrictMode itself, its ThreadPolicy/VmPolicy builders, the android.os.strictmode violation classes, dalvik.system.CloseGuard and
// dalvik.system.BlockGuard are the pinned originals (android-13.0.0_r1) in framework.dex; policies live in ThreadLocals and BlockGuard exactly as on a device. What the original
// reaches outside the framework is answered here: the Binder policy tag, the context kind, the animation count, VMDebug instance counts, and the (absent) activity manager objects.
const STRICT_HOST = 'Ldev/apkweb/os/StrictModeHost;', VM_DEBUG = 'Ldalvik/system/VMDebug;', RUNTIME_INIT = 'Lcom/android/internal/os/RuntimeInit;', SYSTEM = 'Ljava/lang/System;';
const ACTIVITY = 'Landroid/app/Activity;', CONTEXT_WRAPPER = 'Landroid/content/ContextWrapper;';
const STRING = 'Ljava/lang/String;', THROWABLE = 'Ljava/lang/Throwable;', CLASS = 'Ljava/lang/Class;';

export function createStrictModeHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  registry.type(STRICT_HOST, 'Ljava/lang/Object;'); registry.type(VM_DEBUG, 'Ljava/lang/Object;'); registry.type(RUNTIME_INIT, 'Ljava/lang/Object;');
  const threadPolicies = new Map();   // scheduler thread id -> the mask StrictMode last tagged onto Binder transactions (Binder.setThreadStrictModePolicy)

  // Binder.setThreadStrictModePolicy: the policy is carried by outgoing transactions so the callee can report violations back; with no Binder driver it is only recorded.
  def(STRICT_HOST, 'setThreadStrictModePolicy', '(I)V', (r, _m, [mask]) => { threadPolicies.set(r.scheduler?.current?.id ?? 0, mask); }, { static: true });
  platform.strictThreadPolicy = id => threadPolicies.get(id ?? 0) ?? 0;

  // ContextImpl.isConfigurationContext(): true for contexts created for a visual component (an Activity, or a wrapper over one); the application and service contexts are not.
  def(STRICT_HOST, 'isConfigurationContext', '(Landroid/content/Context;)Z', (r, _m, [context]) => {
    for (let current = context, hops = 0; current && hops < 16; hops++) {
      const type = r.typeOf(current);
      if (r.isSubtype(type, ACTIVITY)) return 1;
      if (!r.isSubtype(type, CONTEXT_WRAPPER)) return 0;
      current = r.dispatch({ owner: CONTEXT_WRAPPER, name: 'getBaseContext', parameters: [], result: 'Landroid/content/Context;', signature: '()Landroid/content/Context;' }, [current], 'virtual');
    }
    return 0;
  }, { static: true });

  // ValueAnimator.getCurrentAnimationsCount() is a hidden static of the framework ValueAnimator.
  def(STRICT_HOST, 'getCurrentAnimationsCount', '()I', r => r.dispatch({ owner: 'Landroid/animation/ValueAnimator;', name: 'getCurrentAnimationsCount', parameters: [], result: 'I', signature: '()I' }, [], 'static'), { static: true });

  // ActivityThread.getIntentBeingBroadcast(): a broadcast receiver's intent is dispatched by the lab itself, not by ActivityThread's receiver handler.
  def('Landroid/app/ActivityThread;', 'getIntentBeingBroadcast', '()Landroid/content/Intent;', () => platform.intentBeingBroadcast ?? null, { static: true });
  // RuntimeInit.getApplicationObject(): the binder identifying this process to the activity manager, which the lab does not have.
  def(RUNTIME_INIT, 'getApplicationObject', '()Landroid/os/IBinder;', () => null, { static: true });

  // VMDebug.countInstancesOfClass(Class, boolean): live instances after a collection (ART counts reachable objects), the class itself or, when assignable, its subclasses too.
  const count = (r, klass, assignable) => {
    const wanted = r.object(klass).classType; let n = 0;
    for (let id = 1; id < r.nextId; id++) { const record = r.heap.list[id]; if (!record || record.freed || record.elements) continue; if (record.type === wanted || (assignable && r.isSubtype(record.type, wanted))) n++; }
    return n;
  };
  const prepare = r => { collectGarbage(r, { reason: 'VMDebug.countInstancesOfClass' }); };
  def(VM_DEBUG, 'countInstancesOfClass', `(${CLASS}Z)J`, (r, _m, [klass, assignable]) => { prepare(r); return BigInt(count(r, klass, !!assignable)); }, { static: true });
  def(VM_DEBUG, 'countInstancesOfClasses', `([${CLASS}Z)[J`, (r, _m, [classes, assignable]) => {
    prepare(r); const elements = r.array(classes).elements, result = r.newArray('[J', elements.length);
    r.array(result).elements = elements.map(klass => BigInt(count(r, klass, !!assignable))); return result;
  }, { static: true });

  // java.lang.System.logW (libcore): a warning in the system log, used by CloseGuard's default reporter.
  def(SYSTEM, 'logW', `(${STRING})V`, (r, _m, [message]) => { r.record(`LOG W System: ${r.stringCharacters(message)}`); }, { static: true });
  def(SYSTEM, 'logW', `(${STRING}${THROWABLE})V`, (r, _m, [message, throwable]) => { r.record(`LOG W System: ${r.stringCharacters(message)}${throwable ? ` (${r.typeOf(throwable)})` : ''}`); }, { static: true });

  return { ...registry, interfaces: registry.interfacesOf };
}
