import { APKError } from './apk-runtime.js?v=33d211b8a989';

const TEXT = 'Landroid/widget/TextView;', EDIT = 'Landroid/widget/EditText;', CHECK = 'Landroid/widget/CompoundButton;', PROGRESS = 'Landroid/widget/ProgressBar;';
const PARCELABLE = 'Landroid/os/Parcelable;', CHAR = 'Ljava/lang/CharSequence;', ABS = 'Landroid/view/AbsSavedState;';
const stateType = owner => owner.slice(0, -1) + '$SavedState;';
const keys = new Set([TEXT, CHECK, PROGRESS].flatMap(owner => [`${owner}->onSaveInstanceState()${PARCELABLE}`, `${owner}->onRestoreInstanceState(${PARCELABLE})V`]));
for (const key of [`${TEXT}->setFreezesText(Z)V`, `${TEXT}->getFreezesText()Z`, `${EDIT}->getFreezesText()Z`]) keys.add(key);

/** Boundary for the host's plain-text and scalar native widgets. State objects
 * and superclass linkage execute original AOSP DEX. Span/editor/IME state and
 * Parcel transport are intentionally not represented by a fabricated value.
 */
export function createWidgetStateHost({ saveBase, restoreBase }) {
  const fail = message => { throw new APKError(message, { kind: 'widget-state-unsupported' }); };
  const call = (runtime, receiver, owner, name, parameters, result, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, runtime.argumentWords(parameters, values, { receiver }), mode);
  const read = (runtime, state, owner, name, type) => runtime.object(state).fields.get(`${stateType(owner)}->${name}:${type}`);
  const write = (runtime, state, owner, name, type, value) => runtime.storeField(runtime.object(state).fields, `${stateType(owner)}->${name}:${type}`, value);
  const make = (runtime, owner, superState) => {
    const type = stateType(owner); if (!runtime.dex.bootClasses?.has(type)) fail('Original AOSP widget SavedState DEX is required: ' + type);
    const state = runtime.allocate(type); call(runtime, state, type, '<init>', [PARCELABLE], 'V', [superState], 'direct'); return state;
  };
  const superState = (runtime, state) => call(runtime, state, ABS, 'getSuperState', [], PARCELABLE);
  const freezes = (runtime, receiver) => !!call(runtime, receiver, TEXT, 'getFreezesText', [], 'Z');
  const plain = (runtime, receiver) => {
    const view = runtime.object(receiver);
    if (typeof (view.text ?? '') !== 'string' || view.textSpans?.length || view.editorState || view.error || (view.selectionStart ?? -1) >= 0 || (view.selectionEnd ?? -1) >= 0) fail('TextView span, selection, error, or Editor saved state is not connected');
    if (view.sourceEditable && view.editable) {
      const length = call(runtime, view.editable, 'Ljava/lang/CharSequence;', 'length', [], 'I');
      const spans = call(runtime, view.editable, 'Landroid/text/Spanned;', 'getSpans', ['I', 'I', 'Ljava/lang/Class;'], '[Ljava/lang/Object;', [0, length, runtime.classObject('Ljava/lang/Object;')]);
      if (runtime.object(spans).elements.length) fail('TextView span, selection, error, or Editor saved state is not connected');
    }
    return view;
  };
  const saveText = (runtime, receiver) => {
    const view = plain(runtime, receiver), base = saveBase(runtime, receiver);
    if (!freezes(runtime, receiver)) return base;
    const state = make(runtime, TEXT, base); write(runtime, state, TEXT, 'text', CHAR, view.text ?? ''); return state;
  };
  const restoreText = (runtime, receiver, state) => {
    if (!state || !runtime.isSubtype(runtime.object(state).type, stateType(TEXT))) return restoreBase(runtime, receiver, state);
    const text = read(runtime, state, TEXT, 'text', CHAR);
    if (text != null && typeof text !== 'string' || read(runtime, state, TEXT, 'error', CHAR) || read(runtime, state, TEXT, 'editorState', 'Landroid/os/ParcelableParcel;') || (read(runtime, state, TEXT, 'selStart', 'I') ?? -1) >= 0 || (read(runtime, state, TEXT, 'selEnd', 'I') ?? -1) >= 0) fail('TextView span, selection, error, or Editor saved state is not connected');
    restoreBase(runtime, receiver, superState(runtime, state));
    if (text != null) call(runtime, receiver, TEXT, 'setText', [CHAR], 'V', [text]);
  };
  return {
    supports: key => keys.has(key),
    invoke(runtime, method, args) {
      const receiver = args[0], view = runtime.object(receiver), owner = method.owner;
      if (method.name === 'setFreezesText') { view.freezesText = !!args[1]; return; }
      if (method.name === 'getFreezesText') return owner === EDIT || view.freezesText ? 1 : 0;
      if (owner === TEXT) return method.name === 'onSaveInstanceState' ? saveText(runtime, receiver) : restoreText(runtime, receiver, args[1]);
      if (method.name === 'onSaveInstanceState') {
        const base = owner === CHECK ? saveText(runtime, receiver) : saveBase(runtime, receiver), state = make(runtime, owner, base);
        if (owner === CHECK) write(runtime, state, owner, 'checked', 'Z', view.checked ? 1 : 0);
        else { write(runtime, state, owner, 'progress', 'I', view.progress ?? 0); write(runtime, state, owner, 'secondaryProgress', 'I', view.secondaryProgress ?? 0); }
        return state;
      }
      const state = args[1];
      if (!state || !runtime.isSubtype(runtime.object(state).type, stateType(owner))) runtime.throwJava('Ljava/lang/ClassCastException;', 'Wrong widget SavedState class');
      if (owner === CHECK) {
        restoreText(runtime, receiver, superState(runtime, state));
        call(runtime, receiver, CHECK, 'setChecked', ['Z'], 'V', [read(runtime, state, owner, 'checked', 'Z')]);
        call(runtime, receiver, 'Landroid/view/View;', 'requestLayout', [], 'V');
      } else {
        restoreBase(runtime, receiver, superState(runtime, state));
        call(runtime, receiver, PROGRESS, 'setProgress', ['I'], 'V', [read(runtime, state, owner, 'progress', 'I')]);
        view.secondaryProgress = Math.max(0, Math.min(view.max ?? 100, read(runtime, state, owner, 'secondaryProgress', 'I')));
      }
    },
  };
}
