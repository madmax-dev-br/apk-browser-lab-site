import { APKError } from './apk-runtime.js?v=87d26d81015e';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=87d26d81015e';

const MANAGER = 'Landroid/view/autofill/AutofillManager;';
const VIEW = 'Landroid/view/View;';
const CALLBACK = 'Landroid/view/autofill/AutofillManager$AutofillCallback;';
const ID = 'Landroid/view/autofill/AutofillId;';
const ACTIVITY = 'Landroid/app/Activity;';
const CONTEXT = 'Landroid/content/Context;';
const CONTEXTS = [CONTEXT, ACTIVITY, 'Landroid/app/Application;', 'Landroid/app/ContextImpl;', 'Landroid/content/ContextWrapper;', 'Landroid/view/ContextThemeWrapper;'];
const signatures = [
  'hasAutofillFeature()Z', 'isEnabled()Z', 'isAutofillSupported()Z', 'hasEnabledAutofillServices()Z',
  `registerCallback(${CALLBACK})V`, `unregisterCallback(${CALLBACK})V`, 'commit()V', 'cancel()V',
  `notifyViewEntered(${VIEW})V`, `notifyViewEntered(${VIEW}ILandroid/graphics/Rect;)V`,
  `notifyViewExited(${VIEW})V`, `notifyViewExited(${VIEW}I)V`,
  `notifyValueChanged(${VIEW})V`, `notifyValueChanged(${VIEW}ILandroid/view/autofill/AutofillValue;)V`,
  `notifyViewVisibilityChanged(${VIEW}IZ)V`,
  `requestAutofill(${VIEW})V`, `requestAutofill(${VIEW}ILandroid/graphics/Rect;)V`,
];
const keys = new Set(signatures.map(signature => `${MANAGER}->${signature}`));
for (const signature of [`getAutofillId()${ID}`, 'getAutofillViewId()I', `setAutofillId(${ID})V`]) keys.add(`${VIEW}->${signature}`);
for (const owner of CONTEXTS) keys.add(`${owner}->getNextAutofillId()I`);
const call = (runtime, receiver, owner, name, parameters, result, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], mode);

/** Service boundary for a virtual Android device with no autofill feature.
 * AOSP android-13.0.0_r1 AutofillManager uses mService != null for
 * hasAutofillFeature(). With a null service, these methods take their documented
 * disabled paths. In particular, registerCallback returns BEFORE storing a
 * callback. This does not provide Android autofill, a Binder client, or access
 * to the browser's password manager.
 * Source: frameworks/base/core/java/android/view/autofill/AutofillManager.java
 */
export function createAutofillServiceHost() {
  let manager = null;
  let applicationLastId = -1;
  const ignored = gcRoot(new Map());
  return { [GC_ROOTS](visit) { visit(manager); },
    supports: key => keys.has(key),
    parent: type => type === MANAGER ? 'Ljava/lang/Object;' : null,
    getService(runtime, name) { return name === 'autofill' ? manager ??= runtime.makeObject(MANAGER) : null; },
    getState() { return { feature: false, enabled: false, androidService: null, registeredCallbacks: 0, ignoredCalls: Object.fromEntries(ignored) }; },
    invoke(runtime, method, args) {
      if (!keys.has(`${method.owner}->${method.name}${method.signature}`)) throw new APKError('Unsupported web autofill service method ' + method.name);
      if (CONTEXTS.includes(method.owner)) {
        let context = args[0]; const visited = new Set();
        // ContextWrapper forwards to its base. Activity owns the upper ID range;
        // a plain Context uses Context.java's process-wide lower range.
        while (context) {
          if (visited.has(context.ref) || visited.size >= 128) throw new APKError('Cyclic autofill context chain');
          visited.add(context.ref); const object = runtime.object(context);
          if (runtime.isSubtype(object.type, ACTIVITY)) {
            const last = object.lastAutofillId ?? 1073741823;
            return object.lastAutofillId = (last === 2147483646 ? 1073741823 : last) + 1;
          }
          context = object.baseContext;
        }
        if (applicationLastId === 1073741822) applicationLastId = -1;
        return ++applicationLastId;
      }
      if (method.owner === VIEW) {
        const view = runtime.object(args[0]);
        if (method.name === 'setAutofillId') {
          if (view.attached) runtime.throwJava('Ljava/lang/IllegalStateException;', 'Cannot set autofill id when view is attached');
          if (args[1] && !call(runtime, args[1], ID, 'isNonVirtual', [], 'Z')) runtime.throwJava('Ljava/lang/IllegalStateException;', 'Cannot set autofill id assigned to virtual views');
          if (!args[1] && !view.autofillIdExplicit) return;
          view.autofillId = args[1]; view.autofillIdExplicit = !!args[1];
          view.autofillViewId = args[1] ? call(runtime, args[1], ID, 'getViewId', [], 'I') : -1;
          return;
        }
        if (view.autofillViewId == null || view.autofillViewId === -1) {
          if (!view.context) throw new APKError('View autofill identifier requires its actual Context');
          view.autofillViewId = call(runtime, view.context, CONTEXT, 'getNextAutofillId', [], 'I');
        }
        if (method.name === 'getAutofillViewId') return view.autofillViewId;
        if (!view.autofillId) {
          if (!runtime.classes.has(ID)) throw new APKError('Original AOSP AutofillId DEX required');
          view.autofillId = runtime.allocate(ID);
          call(runtime, view.autofillId, ID, '<init>', ['I'], 'V', [view.autofillViewId], 'direct');
        }
        return view.autofillId;
      }
      if (args[0]?.ref !== manager?.ref) throw new APKError('Unknown web autofill service instance');
      if (method.result === 'Z') return 0;
      if (method.name === 'requestAutofill') {
        // The original overloads consult the View before notifyViewEntered's
        // feature check. Preserve the virtual call and Java null behavior.
        runtime.dispatch({ owner: VIEW, name: 'isFocused', parameters: [], result: 'Z', signature: '()Z' }, [args[1]], 'virtual');
      }
      // No session and no callback are created when Android's service is absent.
      // Keep bounded diagnostics, rather than reporting a successful autofill.
      ignored.set(method.name, Math.min(2147483647, (ignored.get(method.name) || 0) + 1));
      if (ignored.get(method.name) === 1) runtime.record(`WEB AutofillManager.${method.name}: Android autofill feature unavailable (mService=null)`);
      return undefined;
    },
  };
}
