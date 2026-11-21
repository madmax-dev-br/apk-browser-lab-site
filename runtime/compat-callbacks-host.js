import { createHostRegistry } from './host-contract.js?v=efe50e99a19d';
import { COMPAT_CHANGES } from './compat-config-data.js?v=efe50e99a19d';

// The app process's compatibility callbacks: on a device ActivityThread.handleBindApplication calls AppCompatCallbacks.install(data.disabledCompatChanges), which hands
// libcore's android.compat.Compatibility a BehaviorChangeDelegate (Compatibility.setBehaviorChangeDelegate). From then on Compatibility.isChangeEnabled (and
// CompatChanges.isChangeEnabled over it) answers silently: a change is enabled unless it is in the app's disabled list. system_server's PlatformCompat
// (CompatConfig.getDisabledChanges) computes that list from the device's compat config: a change marked @Disabled, or gated by a target SDK the app does not reach
// (enableSinceTargetSdk > targetSdkVersion), is disabled; @LoggingOnly changes never are. The compat config here is the @ChangeId constants of the pinned sources
// (src/compat-config-data.js, scripts/gen-compat-config.mjs); an id the config does not know is enabled, as on a device. Without these callbacks libcore's default
// delegate logs "No Compatibility callbacks set! Querying change <id>" on every query and answers true whatever the target SDK.
// reportChange (the delegate's onChangeReported) goes to the device's ChangeReporter, which only writes statsd/debug logs: nothing an app observes.
const CALLBACKS = 'Landroid/app/AppCompatCallbacks;', DELEGATE = 'Landroid/compat/Compatibility$BehaviorChangeDelegate;', COMPATIBILITY = 'Landroid/compat/Compatibility;';

/** The disabled changes of an app with this target SDK (CompatConfig.getDisabledChanges, without per-package overrides): sorted ids. */
export function disabledChanges(targetSdk) {
  return COMPAT_CHANGES.filter(c => !c.loggingOnly && (c.disabled || (c.enableSinceTargetSdk !== null && targetSdk < c.enableSinceTargetSdk))).map(c => c.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function createCompatCallbacksHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(CALLBACKS, 'Ljava/lang/Object;', [DELEGATE], { allocatable: true });
  def(CALLBACKS, 'isChangeEnabled', '(J)Z', (r, _m, [self, id]) => (r.object(self).disabledChanges.has(BigInt.asIntN(64, BigInt(id))) ? 0 : 1));
  def(CALLBACKS, 'onChangeReported', '(J)V', () => undefined);
  /** AppCompatCallbacks.install(disabledChanges): the delegate of this process, set once at bind time (src/apk-runtime.js configureFrameworkRuntime). */
  platform.installCompatCallbacks = (r, targetSdk) => {
    if (!r.dex.bootClasses?.has(COMPATIBILITY)) return;
    const self = r.allocate(CALLBACKS); r.object(self).disabledChanges = new Set(disabledChanges(targetSdk));
    (r.hostStaticValues ??= []).push(self);
    r.dispatch({ owner: COMPATIBILITY, name: 'setBehaviorChangeDelegate', parameters: [DELEGATE], result: 'V', signature: `(${DELEGATE})V` }, [self], 'static');
  };
  return { ...registry, interfaces: registry.interfacesOf };
}
