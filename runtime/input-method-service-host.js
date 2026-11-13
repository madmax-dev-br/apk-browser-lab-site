import { APKError } from './apk-error.js?v=a742e061d321';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=a742e061d321';

// android.view.inputmethod.InputMethodManager for the virtual device (android-13.0.0_r1 InputMethodManager.java, single client, one input method: the lab keyboard that the browser's
// text controls play). The manager keeps the *served view*: the focused View whose onCheckIsTextEditor() is true. When such a View gains focus the manager does what startInputInner does:
// it builds an EditorInfo, asks the View for its InputConnection (View.onCreateInputConnection -- the app's override included) and keeps both; when it loses focus (or restartInput /
// invalidateInput asks) the connection is closed (closeConnection) and, for a restart, created again. The original BaseInputConnection / EditorInfo classes (layouts profile) give the
// editing semantics; without that profile there is no EditorInfo class, so no connection is made and the manager answers like a device with no active input session.
// The soft keyboard is a flag (shown by showSoftInput on the served view, hidden by hideSoftInputFromWindow / toggleSoftInput) with the ResultReceiver codes of the real manager.
// Source: frameworks/base/core/java/android/view/inputmethod/InputMethodManager.java
const MANAGER = 'Landroid/view/inputmethod/InputMethodManager;', VIEW = 'Landroid/view/View;', RECEIVER = 'Landroid/os/ResultReceiver;', BINDER = 'Landroid/os/IBinder;', KEYEVENT = 'Landroid/view/KeyEvent;';
const CHARS = 'Ljava/lang/CharSequence;', EDITOR_INFO = 'Landroid/view/inputmethod/EditorInfo;', CONNECTION = 'Landroid/view/inputmethod/InputConnection;', STRING = 'Ljava/lang/String;', BUNDLE = 'Landroid/os/Bundle;', SUBTYPE = 'Landroid/view/inputmethod/InputMethodSubtype;', INFO = 'Landroid/view/inputmethod/InputMethodInfo;';
const SHOW_IMPLICIT = 1, SHOW_FORCED = 2, HIDE_IMPLICIT_ONLY = 1, HIDE_NOT_ALWAYS = 2;
const RESULT_UNCHANGED_SHOWN = 0, RESULT_SHOWN = 2, RESULT_UNCHANGED_HIDDEN = 1, RESULT_HIDDEN = 3;
const methods = {
  'isActive()Z': 'isActive', [`isActive(${VIEW})Z`]: 'isActiveView', 'isAcceptingText()Z': 'isAcceptingText', 'isFullscreenMode()Z': 'false',
  [`showSoftInput(${VIEW}I)Z`]: 'show', [`showSoftInput(${VIEW}I${RECEIVER})Z`]: 'show',
  [`hideSoftInputFromWindow(${BINDER}I)Z`]: 'hide', [`hideSoftInputFromWindow(${BINDER}I${RECEIVER})Z`]: 'hide',
  [`restartInput(${VIEW})V`]: 'restart', [`invalidateInput(${VIEW})V`]: 'restart', [`updateSelection(${VIEW}IIII)V`]: 'updateSelection',
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
    const { connection } = state; state.connection = null; state.info = null; state.selection = null;
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
    // The IME learns the selection from EditorInfo.initialSelStart/End, then from every updateSelection the editor reports (InputMethodService.onUpdateSelection).
    const start = editorInt(r, 'initialSelStart'), end = editorInt(r, 'initialSelEnd');
    state.selection = start >= 0 && end >= 0 ? { start, end } : null;
    r.record(`WEB InputMethodManager: input started on ${r.object(view).type}${state.connection ? '' : ' (no InputConnection)'}`);
  };
  const editorInt = (r, name) => state.info ? (r.object(state.info).fields.get(`${EDITOR_INFO}->${name}:I`) ?? 0) | 0 : 0;
  const served = (r, view) => same(state.view, view) && flagFocused(r, view);
  // ---- The lab keyboard: what a soft keyboard sends through the served view's InputConnection (AOSP LatinIME InputLogic.onCodeInput / handleBackspaceEvent, android-13
  // InputConnection contract). Each key is one batch edit, like LatinIME's beginBatchEdit/endBatchEdit around onCodeInput, so an editor that batches (Compose) applies it at once.
  let typing = null;   // the connection the current key is sent to: an IME keeps the connection it started the key on, even if the editor restarts input meanwhile
  const ic = (r, name, parameters, result, values = []) => r.dispatch({ owner: CONNECTION, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, values, { receiver: typing }), 'virtual');
  const text = (r, value) => nullish(value) ? '' : r.javaString(value, 'Ljava/lang/CharSequence;');
  const keyEvent = (r, action, code, meta, time) => {   // InputMethodService.sendDownUpKeyEvents: VIRTUAL_KEYBOARD device, FLAG_SOFT_KEYBOARD | FLAG_KEEP_TOUCH_MODE
    const parameters = ['J', 'J', 'I', 'I', 'I', 'I', 'I', 'I', 'I'], event = r.allocate(KEYEVENT);
    r.dispatch({ owner: KEYEVENT, name: '<init>', parameters, result: 'V', signature: '(JJIIIIIII)V' }, r.argumentWords(parameters, [time, time, action, code, 0, meta, -1, 0, 6], { receiver: event }), 'direct');
    return event;
  };
  const sendKey = (r, code, meta = 0) => {
    const time = BigInt(Math.max(Math.floor(platform?.clock?.now?.() ?? 0), (state.lastKeyTime ?? -1) + 1)); state.lastKeyTime = Number(time);
    ic(r, 'sendKeyEvent', [KEYEVENT], 'Z', [keyEvent(r, 0, code, meta, time)]); ic(r, 'sendKeyEvent', [KEYEVENT], 'Z', [keyEvent(r, 1, code, meta, time)]);
  };
  const KEYCODE_DEL = 67, KEYCODE_FORWARD_DEL = 112, IME_ACTION_NONE = 1, IME_MASK_ACTION = 0xff, IME_FLAG_NO_ENTER_ACTION = 0x40000000, SELECT_ALL = 0x0102001f;
  const deleteSelection = (r, { start, end }) => { const min = Math.min(start, end), max = Math.max(start, end); ic(r, 'setSelection', ['I', 'I'], 'Z', [max, max]); ic(r, 'deleteSurroundingText', ['I', 'I'], 'Z', [max - min, 0]); };
  const codePointLength = (value, before) => { if (!value) return 0; const unit = before ? value.charCodeAt(value.length - 1) : value.charCodeAt(0), other = before ? value.charCodeAt(value.length - 2) : value.charCodeAt(1); return before ? (unit >= 0xdc00 && unit <= 0xdfff && other >= 0xd800 && other <= 0xdbff ? 2 : 1) : (unit >= 0xd800 && unit <= 0xdbff && other >= 0xdc00 && other <= 0xdfff ? 2 : 1); };
  const editOps = {
    commit: (r, op) => ic(r, 'commitText', [CHARS, 'I'], 'Z', [op.text, 1]),
    composing: (r, op) => ic(r, 'setComposingText', [CHARS, 'I'], 'Z', [op.text, 1]),
    finishComposing: r => ic(r, 'finishComposingText', [], 'Z'),
    deleteBackward: r => {   // handleBackspaceEvent: a selection is removed (cursor to its end, then that many characters before it); otherwise one code point, or DEL when nothing precedes the cursor
      const selection = state.selection;
      if (selection && selection.start !== selection.end) return deleteSelection(r, selection);
      const before = text(r, ic(r, 'getTextBeforeCursor', ['I', 'I'], CHARS, [2, 0]));
      if (!before) return sendKey(r, KEYCODE_DEL);
      ic(r, 'deleteSurroundingText', ['I', 'I'], 'Z', [codePointLength(before, true), 0]);
    },
    deleteForward: r => {
      const selection = state.selection;
      if (selection && selection.start !== selection.end) return deleteSelection(r, selection);
      const after = text(r, ic(r, 'getTextAfterCursor', ['I', 'I'], CHARS, [2, 0]));
      if (!after) return sendKey(r, KEYCODE_FORWARD_DEL);
      ic(r, 'deleteSurroundingText', ['I', 'I'], 'Z', [0, codePointLength(after, false)]);
    },
    key: (r, op) => sendKey(r, op.code, op.meta | 0),
    enter: r => {   // CODE_ENTER: the editor's action (IME_FLAG_NO_ENTER_ACTION means none; an action label means its actionId), or a line break when the action is NONE
      const options = editorInt(r, 'imeOptions'), label = state.info ? r.object(state.info).fields.get(`${EDITOR_INFO}->actionLabel:${CHARS}`) : null;
      const action = options & IME_FLAG_NO_ENTER_ACTION ? IME_ACTION_NONE : !nullish(label) ? editorInt(r, 'actionId') : options & IME_MASK_ACTION;
      if (action !== IME_ACTION_NONE) ic(r, 'performEditorAction', ['I'], 'Z', [action]); else ic(r, 'commitText', [CHARS, 'I'], 'Z', ['\n', 1]);
    },
    selectAll: r => ic(r, 'performContextMenuAction', ['I'], 'Z', [SELECT_ALL]),
  };
  const flagFocused = (r, view) => !!r.object(view).focused;
  const answer = (r, receiver, code) => { if (!nullish(receiver)) call(r, receiver, RECEIVER, 'send', ['I', BUNDLE], 'V', [code, null]); };   // goes through the host send above
  return { [GC_ROOTS](visit) { visit(manager); visit(state); visit(typing); },
    supports: key => keys.has(key),
    parent: type => type === MANAGER ? 'Ljava/lang/Object;' : null,
    getService(runtime, name) { return name === 'input_method' ? manager ??= runtime.makeObject(MANAGER) : null; },
    getState() { return { transport: 'browser-editable-controls', servedView: state.view, inputConnection: state.connection, editorInfo: state.info, keyboardShown: state.visible, starts: state.starts, observedCalls: Object.fromEntries(observed) }; },
    /** The served view's live InputConnection (what the page's keyboard would type into), or null. */
    connectionOf(view) { return same(state.view, view) ? state.connection : null; },
    /** What the page needs to route its keyboard: the served view, whether it has a connection, the editor's input type / IME options and the selection the IME knows. */
    imeState(r) {
      const view = state.view;
      return { servedViewId: view?.ref ?? null, connected: !!state.connection, keyboardShown: state.visible, inputType: editorInt(r, 'inputType'), imeOptions: editorInt(r, 'imeOptions'), selection: state.selection ? [state.selection.start, state.selection.end] : null };
    },
    /** Why `view` cannot be typed into through an InputConnection right now, or null when it can. */
    imeUnavailable(r, view) {
      if (!r.classes.has(EDITOR_INFO) || !r.classes.has(CONNECTION)) return 'the framework profile has no EditorInfo / InputConnection classes';
      if (!same(state.view, view)) return state.view ? `the served view is another View (${r.object(state.view).type})` : 'no View is served by the InputMethodManager (nothing focused)';
      if (!state.connection) return `${r.object(view).type}.onCreateInputConnection returned null (no input session)`;
      return null;
    },
    /** One key of the lab keyboard on the served view's InputConnection, inside a batch edit. `op.kind`: commit, composing, finishComposing, deleteBackward, deleteForward, key, enter, selectAll. */
    imeEdit(r, view, op) {
      const reason = this.imeUnavailable(r, view); if (reason) return { handled: false, reason };
      const edit = editOps[op?.kind]; if (!edit) throw new APKError(`Unsupported IME operation: ${op?.kind}`);
      if ((op.kind === 'commit' || op.kind === 'composing') && (typeof op.text !== 'string' || op.text.length > 65536)) throw new APKError('IME text must be a bounded string');
      if (op.kind === 'key' && !(Number.isInteger(op.code) && op.code > 0 && op.code < 400 && Number.isInteger(op.meta ?? 0))) throw new APKError('IME key needs an Android key code');
      typing = state.connection; ic(r, 'beginBatchEdit', [], 'Z');
      try { edit(r, op); } finally { try { ic(r, 'endBatchEdit', [], 'Z'); } finally { typing = null; } }
      r.record(`WEB InputMethod: ${op.kind}${op.kind === 'key' ? ' ' + op.code : ''} on ${r.object(view).type}`);
      return { handled: true };
    },
    /** View focus changed (View.onFocusChanged): a focused text editor starts input, a view that loses focus ends it. */
    viewFocusChanged(r, view, focused) {
      if (focused) {
        if (!r.isSubtype(r.object(view).type, VIEW)) return;
        // ImeFocusController.onViewFocusChanged: the focused View becomes the served view whether or not it edits text, so a View that opens its input session later
        // (Compose focuses its AndroidComposeView first and calls restartInput when a text field gains focus) is restarted like on a device.
        if (!call(r, view, VIEW, 'onCheckIsTextEditor', [], 'Z')) { if (!same(state.view, view)) { closeConnection(r); state.view = view; state.visible = false; } return; }
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
        case 'updateSelection': if (same(state.view, args[1])) state.selection = { start: args[2] | 0, end: args[3] | 0 }; return undefined;
        case 'restart': { const view = args[1]; if (same(state.view, view) && flagFocused(r, view)) startInput(r, view); return undefined; }
        case 'dispatchKey': call(r, args[1], VIEW, 'dispatchKeyEvent', [KEYEVENT], 'Z', [args[2]]); return undefined;
        default: throw new APKError(`Unsupported input method API: ${method.name}`);
      }
    },
  };
}
void SHOW_IMPLICIT; void SHOW_FORCED; void HIDE_NOT_ALWAYS;
