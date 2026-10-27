import { APKError } from './apk-runtime.js?v=751a2d13ee0f';
const KEY_LISTENER = 'Landroid/text/method/KeyListener;', TEXT_KEYS = 'Landroid/text/method/TextKeyListener;', CAPITALIZE = 'Landroid/text/method/TextKeyListener$Capitalize;';
const SINGLE_LINE = 'Landroid/text/method/SingleLineTransformationMethod;', TRANSFORM = 'Landroid/text/method/TransformationMethod;';
const FACTORY = 'Landroid/text/Editable$Factory;', EDITABLE = 'Landroid/text/Editable;', TEXT = 'Landroid/widget/TextView;';
const keys = new Set([`${TEXT}->setEditableFactory(${FACTORY})V`, `${TEXT}->getKeyListener()${KEY_LISTENER}`, `${TEXT}->setKeyListener(${KEY_LISTENER})V`, `${TEXT}->getInputType()I`, `${TEXT}->setRawInputType(I)V`]);
for (const signature of ['setSingleLine()V', 'setSingleLine(Z)V', 'isSingleLine()Z', 'setLines(I)V', 'setMinLines(I)V', 'setMaxLines(I)V', 'getMinLines()I', 'getMaxLines()I', 'setHorizontallyScrolling(Z)V', 'getHorizontallyScrolling()Z']) keys.add(`${TEXT}->${signature}`);
/** Mutable text and spans live in original Factory/SpannableStringBuilder DEX.
 * The host synchronizes browser text edits with the actual Editable buffer. */
export function createEditableTextHost(platform) {
  const call = (runtime, receiver, owner, name, parameters, result, values = [], mode = 'virtual') => runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, mode === 'static' ? values : [receiver, ...values], mode);
  const field = (runtime, view, name, type, value) => runtime.storeField(view.fields, `${TEXT}->${name}:${type}`, value);
  const relayout = (runtime, receiver) => { call(runtime, receiver, 'Landroid/view/View;', 'requestLayout', [], 'V'); platform.requestDraw(runtime, receiver); };
  const available = runtime => runtime.classes.has(FACTORY);
  const factory = (runtime, view) => view.editableFactory ??= call(runtime, null, FACTORY, 'getInstance', [], FACTORY, [], 'static');
  const create = (runtime, view, source) => {
    if (!available(runtime)) throw new APKError('Original Editable.Factory and SpannableStringBuilder DEX are required', { kind: 'editable-text-unsupported' });
    const editable = call(runtime, factory(runtime, view), FACTORY, 'newEditable', ['Ljava/lang/CharSequence;'], EDITABLE, [source]);
    if (!editable || !runtime.isSubtype(runtime.object(editable).type, EDITABLE)) throw new APKError('Editable.Factory returned an invalid Editable');
    view.editable = editable; view.sourceEditable = true; return editable;
  };
  return {
    supports: key => keys.has(key), parent: () => null,
    get(runtime, receiver) {
      const view = runtime.object(receiver);
      if (!available(runtime)) return null;
      if (!view.sourceEditable) return create(runtime, view, view.text ?? '');
      return view.editable;
    },
    update(runtime, receiver, text, { replaceBuffer = false, sourceValue = text, start = 0, removed = 0, added = text.length } = {}) {
      const view = runtime.object(receiver);
      if (!runtime.isSubtype(view.type, 'Landroid/widget/EditText;') || !available(runtime)) return null;
      if (replaceBuffer || !view.sourceEditable) return create(runtime, view, sourceValue);
      call(runtime, view.editable, EDITABLE, 'replace', ['I', 'I', 'Ljava/lang/CharSequence;', 'I', 'I'], EDITABLE, [start, start + removed, text, start, start + added]);
      return view.editable;
    },
    invoke(runtime, method, args) {
      const receiver = args[0], view = runtime.object(receiver);
      if (method.name === 'isSingleLine') return view.singleLine ? 1 : 0;
      if (method.name === 'getHorizontallyScrolling') return view.horizontallyScrolling ? 1 : 0;
      if (method.name === 'setHorizontallyScrolling') {
        const value = !!args[1]; if (value !== !!view.horizontallyScrolling) { view.horizontallyScrolling = value; field(runtime, view, 'mHorizontallyScrolling', 'Z', value ? 1 : 0); relayout(runtime, receiver); } return;
      }
      if (method.name === 'getMinLines') return view.minLines ?? 0;
      if (method.name === 'getMaxLines') return view.maxLines ?? 0x7fffffff;
      if (['setLines', 'setMinLines', 'setMaxLines'].includes(method.name)) {
        const lines = args[1] | 0;
        if (method.name !== 'setMaxLines') { view.minLines = lines; field(runtime, view, 'mMinimum', 'I', lines); field(runtime, view, 'mMinMode', 'I', 1); }
        if (method.name !== 'setMinLines') { view.maxLines = lines; field(runtime, view, 'mMaximum', 'I', lines); field(runtime, view, 'mMaxMode', 'I', 1); }
        relayout(runtime, receiver); return;
      }
      if (method.name === 'setSingleLine') {
        const single = method.parameters.length === 0 || !!args[1];
        if (single && !runtime.classes.has(SINGLE_LINE)) throw new APKError('Original AOSP SingleLineTransformationMethod DEX is required', { kind: 'editable-text-unsupported' });
        // API28 TextView.setInputTypeSingleLine changes only an existing Editor
        // with TYPE_CLASS_TEXT. It never inserts API33's LengthFilter policy.
        const hasEditor = runtime.isSubtype(view.type, 'Landroid/widget/EditText;') || view.editorExists || !!view.keyListener;
        if (hasEditor) { const inputType = view.inputType ?? 1; if ((inputType & 15) === 1) view.inputType = single ? inputType & ~0x20000 : inputType | 0x20000; }
        view.singleLine = single; field(runtime, view, 'mSingleLine', 'Z', single ? 1 : 0);
        call(runtime, receiver, TEXT, single ? 'setLines' : 'setMaxLines', ['I'], 'V', [single ? 1 : 0x7fffffff]);
        call(runtime, receiver, TEXT, 'setHorizontallyScrolling', ['Z'], 'V', [single ? 1 : 0]);
        const transformation = single ? call(runtime, null, SINGLE_LINE, 'getInstance', [], SINGLE_LINE, [], 'static') : null;
        call(runtime, receiver, TEXT, 'setTransformationMethod', [TRANSFORM], 'V', [transformation]);
        return;
      }
      if (method.name === 'getInputType') return view.inputType ?? (runtime.isSubtype(view.type, 'Landroid/widget/EditText;') ? 1 : 0);
      if (method.name === 'setRawInputType') { view.editorExists = true; view.inputType = args[1]; return; }
      if (method.name === 'getKeyListener') {
        if (view.keyListenerInitialized) return view.keyListener || null;
        if (!runtime.isSubtype(view.type, 'Landroid/widget/EditText;')) { view.keyListenerInitialized = true; view.keyListener = null; return null; }
        if (!runtime.classes.has(TEXT_KEYS)) throw new APKError('Original AOSP TextKeyListener DEX is required for editable text', { kind: 'key-listener-unsupported' });
        const type = view.inputType ?? 1;
        if ((type & 15) !== 1) throw new APKError('The original KeyListener for this native input class is not installed', { kind: 'key-listener-unsupported', inputType: type });
        const capName = type & 0x1000 ? 'CHARACTERS' : type & 0x2000 ? 'WORDS' : type & 0x4000 ? 'SENTENCES' : 'NONE';
        const cap = runtime.readStatic({ owner: CAPITALIZE, name: capName, type: CAPITALIZE, key: `${CAPITALIZE}->${capName}:${CAPITALIZE}` });
        view.keyListener = call(runtime, null, TEXT_KEYS, 'getInstance', ['Z', CAPITALIZE], TEXT_KEYS, [type & 0x8000 ? 1 : 0, cap], 'static'); view.keyListenerInitialized = true;
        return view.keyListener;
      }
      if (method.name === 'setKeyListener') {
        const value = args[1]; if (value && !runtime.isSubtype(runtime.object(value).type, KEY_LISTENER)) throw new APKError('TextView.setKeyListener requires an actual KeyListener');
        view.keyListener = value || null; view.keyListenerInitialized = true;
        view.inputType = value ? call(runtime, value, KEY_LISTENER, 'getInputType', [], 'I') : 0;
        if (value) this.get(runtime, receiver);
        call(runtime, receiver, 'Landroid/view/View;', 'setFocusable', ['Z'], 'V', [value ? 1 : 0]);
        call(runtime, receiver, 'Landroid/view/View;', 'setClickable', ['Z'], 'V', [value ? 1 : 0]);
        call(runtime, receiver, 'Landroid/view/View;', 'setLongClickable', ['Z'], 'V', [value ? 1 : 0]);
        return;
      }
      if (!args[1]) runtime.throwJava('Ljava/lang/NullPointerException;', 'Editable.Factory');
      const source = view.sourceEditable ? view.editable : view.text ?? '';
      view.editableFactory = args[1];
      platform.setInput(runtime, view.id, view.text ?? '', { replaceBuffer: true, sourceValue: source });
    },
  };
}
