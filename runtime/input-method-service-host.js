import { APKError } from './apk-error.js?v=64078a5322f4';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=64078a5322f4';

const MANAGER = 'Landroid/view/inputmethod/InputMethodManager;';
const VIEW = 'Landroid/view/View;';
const RECEIVER = 'Landroid/os/ResultReceiver;';
const BINDER = 'Landroid/os/IBinder;';
const signatures = [
  'isActive()Z', `isActive(${VIEW})Z`, 'isAcceptingText()Z', 'isFullscreenMode()Z',
  `showSoftInput(${VIEW}I)Z`, `showSoftInput(${VIEW}I${RECEIVER})Z`,
  `hideSoftInputFromWindow(${BINDER}I)Z`, `hideSoftInputFromWindow(${BINDER}I${RECEIVER})Z`,
  `restartInput(${VIEW})V`, `updateSelection(${VIEW}IIII)V`,
  `updateExtractedText(${VIEW}ILandroid/view/inputmethod/ExtractedText;)V`,
  `updateCursorAnchorInfo(${VIEW}Landroid/view/inputmethod/CursorAnchorInfo;)V`,
];
const keys = new Set(signatures.map(signature => `${MANAGER}->${signature}`));

/** Explicit device profile with no Android IME session or InputConnection.
 * AOSP android-13.0.0_r1 InputMethodManager returns false / returns early for
 * these methods when no View is served and no input-method session exists.
 * Browser text input is delivered separately through the actual editable
 * widget or Compose Semantics action. These guards do not pretend to open an
 * Android keyboard, bind an IME, or synthesize a ResultReceiver completion.
 * Source: frameworks/base/core/java/android/view/inputmethod/InputMethodManager.java
 */
export function createInputMethodServiceHost() {
  let manager = null;
  const observed = gcRoot(new Map());
  return { [GC_ROOTS](visit) { visit(manager); },
    supports: key => keys.has(key),
    parent: type => type === MANAGER ? 'Ljava/lang/Object;' : null,
    getService(runtime, name) { return name === 'input_method' ? manager ??= runtime.makeObject(MANAGER) : null; },
    getState() { return { transport: 'browser-editable-controls', androidImeSession: null, servedView: null, inputConnection: null, keyboardShownByAndroid: false, observedCalls: Object.fromEntries(observed) }; },
    invoke(runtime, method, args) {
      if (!keys.has(`${method.owner}->${method.name}${method.signature}`)) throw new APKError(`Unsupported input method API: ${method.name}`);
      if (!manager || args[0]?.ref !== manager.ref) throw new APKError('Unknown input method service instance');
      observed.set(method.name, Math.min(2147483647, (observed.get(method.name) || 0) + 1));
      if (observed.get(method.name) === 1) runtime.record(`WEB InputMethodManager.${method.name}: no Android IME session; browser editing uses widget/Semantics callbacks`);
      return method.result === 'Z' ? 0 : undefined;
    },
  };
}
