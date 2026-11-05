import { APKError } from './apk-error.js?v=17ba9bd8e48f';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=17ba9bd8e48f';

// android.view.inputmethod.InputMethodManager for the virtual device (android-13.0.0_r1 InputMethodManager.java, single client, one input method: the lab keyboard that the browser's
// text controls play). The manager keeps the *served view*: the focused View whose onCheckIsTextEditor() is true. When such a View gains focus the manager does what startInputInner does:
// it builds an EditorInfo, asks the View for its InputConnection (View.onCreateInputConnection -- the app's override included) and keeps both; when it loses focus (or restartInput /
// invalidateInput asks) the connection is closed (closeConnection) and, for a restart, created again. The original BaseInputConnection / EditorInfo classes (layouts profile) give the
// editing semantics; without that profile there is no EditorInfo class, so no connection is made and the manager answers like a device with no active input session.
// The soft keyboard is a flag (shown by showSoftInput on the served view, hidden by hideSoftInputFromWindow / toggleSoftInput) with the ResultReceiver codes of the real manager.
// Source: frameworks/base/core/java/android/view/inputmethod/InputMethodManager.java
const MANAGER = 'Landroid/view/inputmethod/InputMethodManager;', VIEW = 'Landroid/view/View;', RECEIVER = 'Landroid/os/ResultReceiver;', BINDER = 'Landroid/os/IBinder;', KEYEVENT = 'Landroid/view/KeyEvent;';
const EDITOR_INFO = 'Landroid/view/inputmethod/EditorInfo;', CONNECTION = 'Landroid/view/inputmethod/InputConnection;', STRING = 'Ljava/lang/String;', BUNDLE = 'Landroid/os/Bundle;', SUBTYPE = 'Landroid/view/inputmethod/InputMethodSubtype;', INFO = 'Landroid/view/inputmethod/InputMethodInfo;';
const SHOW_IMPLICIT = 1, SHOW_FORCED = 2, HIDE_IMPLICIT_ONLY = 1, HIDE_NOT_ALWAYS = 2;
const RESULT_UNCHANGED_SHOWN = 0, RESULT_SHOWN = 2, RESULT_UNCHANGED_HIDDEN = 1, RESULT_HIDDEN = 3;
const methods = {
  'isActive()Z': 'isActive', [`isActive(${VIEW})Z`]: 'isActiveView', 'isAcceptingText()Z': 'isAcceptingText', 'isFullscreenMode()Z': 'false',
  [`showSoftInput(${VIEW}I)Z`]: 'show', [`showSoftInput(${VIEW}I${RECEIVER})Z`]: 'show',
  [`hideSoftInputFromWindow(${BINDER}I)Z`]: 'hide', [`hideSoftInputFromWindow(${BINDER}I${RECEIVER})Z`]: 'hide',
  [`restartInput(${VIEW})V`]: 'restart', [`invalidateInput(${VIEW})V`]: 'restart', [`updateSelection(${VIEW}IIII)V`]: 'noop',
  'toggleSoftInput(II)V': 'toggle', [`toggleSoftInputFromWindow(${BINDER}II)V`]: 'toggleWindow', [`viewClicked(${VIEW})V`]: 'noop', [`updateCursor(${VIEW}IIII)V`]: 'noop',
  [`updateExtractedText(${VIEW}ILandroid/view/inputmethod/ExtractedText;)V`]: 'noop', [`updateCursorAnchorInfo(${VIEW}Landroid/view/inputmethod/CursorAnchorInfo;)V`]: 'noop',
  [`isWatchingCursor(${VIEW})Z`]: 'false', [`sendAppPrivateCommand(${VIEW}${STRING}${BUNDLE})V`]: 'noop', [`displayCompletions(${VIEW}[Landroid/view/inputmethod/CompletionInfo;)V`]: 'noop',
  [`dispatchKeyEventFromInputMethod(${VIEW}${KEYEVENT})V`]: 'dispatchKey', [`startStylusHandwriting(${VIEW})V`]: 'noop',
  'isInputMethodSuppressingSpellChecker()Z': 'false', 'showInputMethodPicker()V': 'noop', [`showInputMethodAndSubtypeEnabler(${STRING})V`]: 'noop',
  'getInputMethodList()Ljava/util/List;': 'emptyList', 'getEnabledInputMethodList()Ljava/util/List;': 'emptyList', [`getEnabledInputMethodSubtypeList(${INFO}Z)Ljava/util/List;`]: 'emptyList',
  [`getCurrentInputMethodSubtype()${SUBTYPE}`]: 'null', [`getLastInputMethodSubtype()${SUBTYPE}`]: 'null', 'getShortcutInputMethodsAndSubtypes()Ljava/util/Map;': 'emptyMap',
  [`setCurrentInputMethodSubtype(${SUBTYPE})Z`]: 'false', [`switchToLastInputMethod(${BINDER})Z`]: 'false', [`switchToNextInputMethod(${BINDER}Z)Z`]: 'false', [`shouldOfferSwitchingToNextInputMethod(${BINDER})Z`]: 'false',
  // IME-side calls need the window token of the input method service the app does not own: the framework ignores / refuses them for a client that is not the current IME.
  [`hideSoftInputFromInputMethod(${BINDER}I)V`]: 'noop', [`showSoftInputFromInputMethod(${BINDER}I)V`]: 'noop', [`hideStatusIcon(${BINDER})V`]: 'noop', [`showStatusIcon(${BINDER}${STRING}I)V`]: 'noop',
  [`setInputMethod(${BINDER}${STRING})V`]: 'noop', [`setInputMethodAndSubtype(${BINDER}${STRING}${SUBTYPE})V`]: 'noop',
  [`setAdditionalInputMethodSubtypes(${STRING}[${SUBTYPE})V`]: 'denied',
};
const keys = new Map(Object.entries(methods).map(([signature, kind]) => [`${MANAGER}->${signature}`, kind]));
keys.set(`${RECEIVER}->send(I${BUNDLE})V`, 'receiverSend');   // ResultReceiver.send: a local receiver gets onReceiveResult on the main thread

export function createInputMethodServiceHost(platform = null) {
  let manager = null;
  const observed = gcRoot(new Map());
  const state = gcRoot({ view: null, connection: null, info: null, visible: false, starts: 0 });
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const nullish = v => v === null || v === undefined || v === 0;
  const same = (a, b) => !nullish(a) && !nullish(b) && a.ref === b.ref;
  const closeConnection = r => {
    const { connection } = state; state.connection = null; state.info = null;
    if (!nullish(connection)) { try { call(r, connection, CONNECTION, 'closeConnection', [], 'V'); } catch (error) { if (error?.name !== 'JavaException') throw error; } }
  };
  /** InputMethodManager.startInputInner for the focused text editor: EditorInfo, then View.onCreateInputConnection. */
  const startInput = (r, view) => {
    closeConnection(r); state.view = view; state.starts++;
    if (!r.classes.has(EDITOR_INFO) || !r.classes.has(CONNECTION)) { r.record('WEB InputMethodManager: the input-method classes are not in this framework profile; no InputConnection'); return; }
    const info = r.allocate(EDITOR_INFO); r.dispatch({ owner: EDITOR_INFO, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [info], 'direct');
    r.storeField(r.object(info).fields, `${EDITOR_INFO}->packageName:${STRING}`, platform?.packageName ?? null);
    const connection = call(r, view, VIEW, 'onCreateInputConnection', [EDITOR_INFO], CONNECTION, [info]);
    state.info = info; state.connection = nullish(connection) ? null : connection;
    r.record(`WEB InputMethodManager: input started on ${r.object(view).type}${state.connection ? '' : ' (no InputConnection)'}`);
  };
  const served = (r, view) => same(state.view, view) && flagFocused(r, view);
  const flagFocused = (r, view) => !!r.object(view).focused;
  const answer = (r, receiver, code) => { if (!nullish(receiver)) call(r, receiver, RECEIVER, 'send', ['I', BUNDLE], 'V', [code, null]); };   // goes through the host send above
  return { [GC_ROOTS](visit) { visit(manager); visit(state); },
    supports: key => keys.has(key),
    parent: type => type === MANAGER ? 'Ljava/lang/Object;' : null,
    getService(runtime, name) { return name === 'input_method' ? manager ??= runtime.makeObject(MANAGER) : null; },
    getState() { return { transport: 'browser-editable-controls', servedView: state.view, inputConnection: state.connection, editorInfo: state.info, keyboardShown: state.visible, starts: state.starts, observedCalls: Object.fromEntries(observed) }; },
    /** The served view's live InputConnection (what the page's keyboard would type into), or null. */
    connectionOf(view) { return same(state.view, view) ? state.connection : null; },
    /** View focus changed (View.onFocusChanged): a focused text editor starts input, a view that loses focus ends it. */
    viewFocusChanged(r, view, focused) {
      if (focused) {
        if (!r.isSubtype(r.object(view).type, VIEW) || !call(r, view, VIEW, 'onCheckIsTextEditor', [], 'Z')) return;
        startInput(r, view);
        if (r.object(view).tv?.showSoftInputOnFocus !== false) state.visible = true;   // TextView.onFocusChanged asks to show the IME for an editor that wants it
      } else if (same(state.view, view)) { closeConnection(r); state.view = null; state.visible = false; }
    },
    invoke(runtime, method, args) {
      const kind = keys.get(`${method.owner}->${method.name}${method.signature}`);
      if (kind === undefined) throw new APKError(`Unsupported input method API: ${method.name}`);
      if (kind === 'receiverSend') { const receiver = args[0], code = args[1], data = args[2]; platform.queueTask(() => call(runtime, receiver, RECEIVER, 'onReceiveResult', ['I', BUNDLE], 'V', [code, data]), 0, [receiver, data]); return undefined; }
      if (!manager || args[0]?.ref !== manager.ref) throw new APKError('Unknown input method service instance');
      observed.set(method.name, Math.min(2147483647, (observed.get(method.name) || 0) + 1));
      const r = runtime;
      switch (kind) {
        case 'isActive': return state.view !== null ? 1 : 0;
        case 'isActiveView': return same(state.view, args[1]) ? 1 : 0;
        case 'isAcceptingText': return state.connection !== null ? 1 : 0;
        case 'false': return 0;
        case 'null': return null;
        case 'noop': return undefined;
        case 'denied': r.throwJava('Ljava/lang/SecurityException;', 'Requires permission: android.permission.WRITE_SECURE_SETTINGS or the caller must be the input method'); return undefined;
        case 'emptyList': return r.dispatch({ owner: 'Ljava/util/Collections;', name: 'emptyList', parameters: [], result: 'Ljava/util/List;', signature: '()Ljava/util/List;' }, [], 'static');
        case 'emptyMap': return r.dispatch({ owner: 'Ljava/util/Collections;', name: 'emptyMap', parameters: [], result: 'Ljava/util/Map;', signature: '()Ljava/util/Map;' }, [], 'static');
        case 'show': {   // showSoftInput: only the served, focused view may; SHOW_IMPLICIT after an explicit hide stays hidden is not modelled
          const receiver = method.parameters.length === 3 ? args[3] : null, view = args[1];
          if (!served(r, view)) { answer(r, receiver, RESULT_UNCHANGED_HIDDEN); return 0; }
          const was = state.visible; state.visible = true; answer(r, receiver, was ? RESULT_UNCHANGED_SHOWN : RESULT_SHOWN); return 1;
        }
        case 'hide': {
          const flags = args[2] | 0, receiver = method.parameters.length === 3 ? args[3] : null;
          // InputMethodManager.hideSoftInputFromWindow: only for the window of the served view
          if (state.view === null || nullish(args[1]) || call(r, state.view, VIEW, 'getWindowToken', [], BINDER)?.ref !== args[1].ref) { answer(r, receiver, RESULT_UNCHANGED_HIDDEN); return 0; }
          if (!state.visible || (flags & HIDE_IMPLICIT_ONLY) && state.forced) { answer(r, receiver, RESULT_UNCHANGED_HIDDEN); return 0; }
          state.visible = false; answer(r, receiver, RESULT_HIDDEN); return 1;
        }
        case 'toggle': state.visible = !state.visible && state.view !== null; return undefined;
        case 'toggleWindow': state.visible = !state.visible && state.view !== null; return undefined;
        case 'restart': { const view = args[1]; if (same(state.view, view) && flagFocused(r, view)) startInput(r, view); return undefined; }
        case 'dispatchKey': call(r, args[1], VIEW, 'dispatchKeyEvent', [KEYEVENT], 'Z', [args[2]]); return undefined;
        default: throw new APKError(`Unsupported input method API: ${method.name}`);
      }
    },
  };
}
void SHOW_IMPLICIT; void SHOW_FORCED; void HIDE_NOT_ALWAYS;
