import { APKError } from './apk-runtime.js?v=00979d36e5ab';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=00979d36e5ab';
const MANAGER = 'Landroid/view/accessibility/AccessibilityManager;';
const VIEW = 'Landroid/view/View;', DELEGATE = 'Landroid/view/View$AccessibilityDelegate;', PROVIDER = 'Landroid/view/accessibility/AccessibilityNodeProvider;';
const DELEGATE_FIELD = `${VIEW}->mAccessibilityDelegate:${DELEGATE}`;
const STATE = MANAGER.slice(0, -1) + '$AccessibilityStateChangeListener;';
const TOUCH = MANAGER.slice(0, -1) + '$TouchExplorationStateChangeListener;';
const SERVICES = MANAGER.slice(0, -1) + '$AccessibilityServicesStateChangeListener;';
const kinds = [
  ['AccessibilityStateChange', STATE, 'onAccessibilityStateChanged', 'enabled'],
  ['TouchExplorationStateChange', TOUCH, 'onTouchExplorationStateChanged', 'touchExploration'],
  ['AccessibilityServicesStateChange', SERVICES, 'onAccessibilityServicesStateChanged', null],
];
const keys = new Set(['isEnabled()Z', 'isTouchExplorationEnabled()Z', 'isHighTextContrastEnabled()Z', 'isRequestFromAccessibilityTool()Z', 'getRecommendedTimeoutMillis(II)I', 'getInstalledAccessibilityServiceList()Ljava/util/List;', 'getEnabledAccessibilityServiceList(I)Ljava/util/List;', 'getInstance(Landroid/content/Context;)Landroid/view/accessibility/AccessibilityManager;'].map(signature => MANAGER + '->' + signature));
for (const [name, type] of kinds) { keys.add(`${MANAGER}->add${name}Listener(${type})${name === 'AccessibilityServicesStateChange' ? 'V' : 'Z'}`); keys.add(`${MANAGER}->remove${name}Listener(${type})Z`); }
for (const signature of [`setAccessibilityDelegate(${DELEGATE})V`, `getAccessibilityDelegate()${DELEGATE}`, `getAccessibilityNodeProvider()${PROVIDER}`]) keys.add(VIEW + '->' + signature);
const call = (runtime, receiver, owner, name, parameters, result, values = []) => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], 'virtual');

/** Android service boundary for the explicit web device. No Android accessibility
 * services are installed in this VM. DOM accessibility remains the browser's job;
 * these flags do not inspect or infer whether the user's OS has a screen reader.
 */
export function createAccessibilityServiceHost(platform) {
  let manager = null;
  const state = { enabled: false, touchExploration: false, highTextContrast: false, interactiveTimeout: 0, nonInteractiveTimeout: 0 };
  const listeners = gcRoot(new Map(kinds.map(([name]) => [name, new Map()])));
  const service = runtime => manager ??= runtime.makeObject(MANAGER);
  const list = runtime => { const value = runtime.allocate('Ljava/util/ArrayList;'); runtime.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [value], 'direct'); return value; };
  return { [GC_ROOTS](visit) { visit(manager); },
    supports: key => keys.has(key), parent: type => type === MANAGER ? 'Ljava/lang/Object;' : null,
    reflectionDefinition(owner, kind, name, parameters, publicOnly) {
      if (owner === VIEW && kind === 'field' && name === 'mAccessibilityDelegate' && !publicOnly) return { field: { owner, name, type: DELEGATE, key: DELEGATE_FIELD }, flags: 0 };
      return null;
    },
    getService(runtime, name) { return name === 'accessibility' ? service(runtime) : null; },
    getState() { return { ...state, installedAndroidServices: 0 }; },
    // A future web accessibility integration can supply real changes here. Callbacks
    // are asynchronous and run APK bytecode; changing a host flag never bypasses it.
    setDeviceState(runtime, next) {
      for (const field of ['interactiveTimeout', 'nonInteractiveTimeout']) if (Object.hasOwn(next, field) && (!Number.isInteger(next[field]) || next[field] < 0 || next[field] > 2147483647)) throw new APKError('Invalid accessibility device timeout');
      for (const [suffix, type, callback, field] of kinds) if (field && Object.hasOwn(next, field) && !!next[field] !== state[field]) {
        state[field] = !!next[field]; const value = state[field] ? 1 : 0;
        for (const listener of listeners.get(suffix).values()) platform.queueTask(() => call(runtime, listener, type, callback, ['Z'], 'V', [value]), 0, [listener]);
      }
      if (Object.hasOwn(next, 'highTextContrast')) state.highTextContrast = !!next.highTextContrast;
      for (const field of ['interactiveTimeout', 'nonInteractiveTimeout']) if (Object.hasOwn(next, field)) {
        state[field] = next[field];
      }
    },
    invoke(runtime, method, args) {
      const name = method.name;
      if (method.owner === VIEW) {
        const fields = runtime.object(args[0]).fields;
        if (name === 'setAccessibilityDelegate') { if (args[1]) runtime.object(args[1]); runtime.storeField(fields, DELEGATE_FIELD, args[1] || null); return; }
        const delegate = fields.get(DELEGATE_FIELD) || null;
        if (name === 'getAccessibilityDelegate') return delegate;
        if (name === 'getAccessibilityNodeProvider') return delegate ? call(runtime, delegate, DELEGATE, 'getAccessibilityNodeProvider', [VIEW], PROVIDER, [args[0]]) : null;
        throw new APKError('Unsupported View accessibility method ' + name);
      }
      if (name === 'getInstance') return service(runtime);
      if (args[0]?.ref !== manager?.ref) throw new APKError('Unknown web accessibility service instance');
      if (name === 'isEnabled') return state.enabled ? 1 : 0;
      if (name === 'isTouchExplorationEnabled') return state.touchExploration ? 1 : 0;
      if (name === 'isHighTextContrastEnabled') return state.highTextContrast ? 1 : 0;
      if (name === 'isRequestFromAccessibilityTool') return 0; // The caller is this APK VM, not an Android accessibility-tool process.
      if (name === 'getInstalledAccessibilityServiceList' || name === 'getEnabledAccessibilityServiceList') return list(runtime);
      if (name === 'getRecommendedTimeoutMillis') { let timeout = args[1]; if (args[2] & 4) timeout = Math.max(timeout, state.interactiveTimeout); if (args[2] & 3) timeout = Math.max(timeout, state.nonInteractiveTimeout); return timeout; }
      for (const [suffix] of kinds) {
        if (name === 'add' + suffix + 'Listener') {
          if (!args[1]) runtime.throwJava('Ljava/lang/NullPointerException;', 'Accessibility listener is null');
          const values = listeners.get(suffix); if (!values.has(args[1].ref) && values.size >= 256) throw new APKError('Accessibility listener limit exceeded');
          runtime.object(args[1]); values.set(args[1].ref, args[1]); return suffix === 'AccessibilityServicesStateChange' ? undefined : 1;
        }
        if (name === 'remove' + suffix + 'Listener') return listeners.get(suffix).delete(args[1]?.ref) ? 1 : 0;
      }
      throw new APKError('Unsupported web accessibility service method ' + name);
    },
  };
}
