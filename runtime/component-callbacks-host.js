import { APKError } from './apk-runtime.js?v=33d211b8a989';
const APP = 'Landroid/app/Application;', CONTROLLER = 'Landroid/content/ComponentCallbacksController;', CALLBACK = 'Landroid/content/ComponentCallbacks;', CONFIG = 'Landroid/content/res/Configuration;';
const CONTEXTS = [APP, 'Landroid/content/Context;', 'Landroid/content/ContextWrapper;', 'Landroid/view/ContextThemeWrapper;', 'Landroid/app/Activity;'];
const keys = new Set();
for (const owner of CONTEXTS) for (const name of ['registerComponentCallbacks', 'unregisterComponentCallbacks']) keys.add(`${owner}->${name}(${CALLBACK})V`);
for (const signature of [`onConfigurationChanged(${CONFIG})V`, 'onLowMemory()V', 'onTrimMemory(I)V']) keys.add(`${APP}->${signature}`);
const parametersOf = signature => signature.slice(1, signature.indexOf(')')).match(/\[*L[^;]+;|\[*[ZBCSIFJD]/g) || [];
/** Only the Context/Application system boundary lives here. Registration, duplicate
 * handling, mutation-safe snapshots and dispatch execute original AOSP Controller DEX. */
export function createComponentCallbacksHost(platform) {
  const call = (runtime, receiver, owner, name, signature, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, signature, parameters: parametersOf(signature), result: signature.slice(signature.indexOf(')') + 1) }, [receiver, ...values], mode);
  const controller = (runtime, app) => {
    const field = `${APP}->mCallbacksController:${CONTROLLER}`, object = runtime.object(app);
    if (object.fields.get(field)) return object.fields.get(field);
    if (!runtime.classes.has(CONTROLLER)) throw new APKError('Original AOSP ComponentCallbacksController DEX is required', { kind: 'component-callbacks-unsupported' });
    const value = runtime.allocate(CONTROLLER); call(runtime, value, CONTROLLER, '<init>', '()V', [], 'direct'); runtime.storeField(object.fields, field, value); return value;
  };
  return {
    supports: key => keys.has(key), parent: () => null,
    invoke(runtime, method, args) {
      const receiver = args[0], name = method.name;
      if (name.endsWith('ComponentCallbacks')) {
        if (!runtime.isSubtype(runtime.object(receiver).type, APP)) {
          const app = call(runtime, receiver, 'Landroid/content/Context;', 'getApplicationContext', '()Landroid/content/Context;');
          if (!app) runtime.throwJava('Ljava/lang/IllegalStateException;', 'Application context is not initialized');
          return call(runtime, app, APP, name, `(${CALLBACK})V`, [args[1]]);
        }
        return call(runtime, controller(runtime, receiver), CONTROLLER, name.startsWith('unregister') ? 'unregisterCallbacks' : 'registerCallbacks', `(${CALLBACK})V`, [args[1]]);
      }
      const target = controller(runtime, receiver);
      if (name === 'onConfigurationChanged') return call(runtime, target, CONTROLLER, 'dispatchConfigurationChanged', `(${CONFIG})V`, [args[1]]);
      if (name === 'onLowMemory') return call(runtime, target, CONTROLLER, 'dispatchLowMemory', '()V');
      return call(runtime, target, CONTROLLER, 'dispatchTrimMemory', '(I)V', [args[1]]);
    },
    dispatchConfiguration(runtime, configuration) { if (platform.application) return call(runtime, platform.application, APP, 'onConfigurationChanged', `(${CONFIG})V`, [configuration]); },
    dispatchLowMemory(runtime) { if (platform.application) return call(runtime, platform.application, APP, 'onLowMemory', '()V'); },
    dispatchTrimMemory(runtime, level) { if (platform.application) return call(runtime, platform.application, APP, 'onTrimMemory', '(I)V', [level]); },
  };
}
