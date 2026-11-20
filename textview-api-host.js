import { createHostRegistry } from './host-contract.js?v=1c341f498fc5';
import { gcRoot } from './heap-gc.js?v=1c341f498fc5';
import { APKError } from './apk-error.js?v=1c341f498fc5';
import { parseFontFeatureSettings } from './skia-paragraph.js?v=1c341f498fc5';

// Public android.widget.TextView API (API 33) beyond what the platform's native text model carries, with the semantics of android-13.0.0_r1 TextView.java.
// The lab renders TextView / Button / EditText text through its native SkParagraph path (view-layout-host measure, compose-canvas-host draw), which honours the text, size, colour, typeface,
// gravity, hint, maxLines / minLines / single line, includeFontPadding and layout direction. Every other property has its AOSP state here (setter, getter, default, relayout / invalidate on
// change) and `unsupportedRendering(view)` names the ones set to a non-default value that the native path cannot draw yet, so a measure or draw pass stops with an explicit error instead of
// painting something else. getLayout() and the layout queries build the original StaticLayout from the same state.
const TEXT = 'Landroid/widget/TextView;', VIEW = 'Landroid/view/View;', CHARS = 'Ljava/lang/CharSequence;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', CONTEXT = 'Landroid/content/Context;';
const TINT = 'Landroid/content/res/ColorStateList;', BLEND = 'Landroid/graphics/BlendMode;', MODE = 'Landroid/graphics/PorterDuff$Mode;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', RECT = 'Landroid/graphics/Rect;';
const PAINT = 'Landroid/graphics/Paint;', TEXT_PAINT = 'Landroid/text/TextPaint;', LAYOUT = 'Landroid/text/Layout;', STATIC_LAYOUT = 'Landroid/text/StaticLayout;', BUILDER = 'Landroid/text/StaticLayout$Builder;', LOCALE = 'Ljava/util/Locale;', LOCALE_LIST = 'Landroid/os/LocaleList;';
const bits = new DataView(new ArrayBuffer(4)), f2i = n => { bits.setFloat32(0, n, true); return bits.getInt32(0, true); }, i2f = n => { bits.setInt32(0, n | 0, true); return bits.getFloat32(0, true); };
const nullish = v => v === null || v === undefined || v === 0;
const flag = v => v === true || v === 1 || v === 0xffffffff || v === -1;
const INT_MAX = 0x7fffffff, DEFAULTS = {
  autoLinkMask: 0, linksClickable: true, cursorVisible: true, showSoftInputOnFocus: true, imeOptions: 0, privateImeOptions: null, imeHintLocales: null, imeActionLabel: null, imeActionId: 0, marqueeRepeatLimit: 3,
  includeFontPadding: true, breakStrategy: 0, hyphenationFrequency: 0, justificationMode: 0, lineBreakStyle: 0, lineBreakWordStyle: 0, letterSpacing: 0, lineSpacingExtra: 0, lineSpacingMult: 1, fontFeatureSettings: null,
  fontVariationSettings: null, elegantTextHeight: false, fallbackLineSpacing: true, textScaleX: 1, ellipsize: null, highlightColor: 0x6633b5e5 | 0, textIsSelectable: false, selectAllOnFocus: false, suggestionsEnabled: true,
  firstBaselineToTopHeight: -1, lastBaselineToBottomHeight: -1, lineHeight: -1, shadowRadius: 0, shadowDx: 0, shadowDy: 0, shadowColor: 0, compoundDrawablePadding: 0, textSizeUnit: 0,
};

export function createTextViewApiHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const blocked = [];   // keys of the platform implementations currently being called through legacy(): this host steps aside for exactly those
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const tv = (r, self) => r.object(self).tv ??= { ...DEFAULTS };
  /** Runs the platform's own TextView implementation (the contract host steps aside while it does). */
  const legacy = (r, self, name, parameters, result, args = []) => {
    const signature = `(${parameters.join('')})${result}`; blocked.push(`${TEXT}->${name}${signature}`);
    try { return platform.invoke(r, { owner: TEXT, name, parameters, result, signature }, [self, ...args]); } finally { blocked.pop(); }
  };
  const relayout = (r, self) => { call(r, self, VIEW, 'requestLayout'); platform.requestDraw?.(r, self); };
  const resources = (r, self) => call(r, self, VIEW, 'getResources', [], 'Landroid/content/res/Resources;');
  const density = (r, self) => { const m = call(r, resources(r, self), 'Landroid/content/res/Resources;', 'getDisplayMetrics', [], 'Landroid/util/DisplayMetrics;'); return i2f(r.object(m).fields.get('Landroid/util/DisplayMetrics;->density:F') ?? f2i(1)); };

  // ---- plain properties: [setter, getter, key, jvm type, relayout?] -------------------------------------------------------------------------------------------------------------------------------
  const prop = (setter, getter, key, type, effect = 'relayout', validate = null) => {
    const [setName, setSig] = setter.split(/(?=\()/), [getName, getSig] = getter.split(/(?=\()/);
    def(TEXT, setName, setSig, (r, _m, [self, raw]) => {
      let value = type === 'Z' ? flag(raw) : (type.startsWith('L') || type.startsWith('[')) && nullish(raw) ? null : raw; value = validate ? (validate(r, value, self) ?? value) : value;
      const state = tv(r, self), previous = state[key]; state[key] = value;
      if (key === 'includeFontPadding') r.object(self).includeFontPadding = value;   // the field the native measure and draw read
      if (previous !== value) { if (effect === 'relayout') relayout(r, self); else if (effect === 'redraw') platform.requestDraw?.(r, self); }
    });
    def(TEXT, getName, getSig, (r, _m, [self]) => { const value = tv(r, self)[key]; return type === 'Z' ? (value ? 1 : 0) : value; });
  };
  prop('setAutoLinkMask(I)V', 'getAutoLinkMask()I', 'autoLinkMask', 'I', 'none');
  prop('setLinksClickable(Z)V', 'getLinksClickable()Z', 'linksClickable', 'Z', 'none');
  prop('setCursorVisible(Z)V', 'isCursorVisible()Z', 'cursorVisible', 'Z', 'redraw');
  prop('setShowSoftInputOnFocus(Z)V', 'getShowSoftInputOnFocus()Z', 'showSoftInputOnFocus', 'Z', 'none');
  prop('setImeOptions(I)V', 'getImeOptions()I', 'imeOptions', 'I', 'none');
  prop(`setPrivateImeOptions(${STRING})V`, `getPrivateImeOptions()${STRING}`, 'privateImeOptions', STRING, 'none');
  prop(`setImeHintLocales(${LOCALE_LIST})V`, `getImeHintLocales()${LOCALE_LIST}`, 'imeHintLocales', LOCALE_LIST, 'none');
  prop('setMarqueeRepeatLimit(I)V', 'getMarqueeRepeatLimit()I', 'marqueeRepeatLimit', 'I', 'none');
  prop('setIncludeFontPadding(Z)V', 'getIncludeFontPadding()Z', 'includeFontPadding', 'Z', 'relayout');
  prop('setBreakStrategy(I)V', 'getBreakStrategy()I', 'breakStrategy', 'I', 'relayout');
  prop('setHyphenationFrequency(I)V', 'getHyphenationFrequency()I', 'hyphenationFrequency', 'I', 'relayout');
  prop('setJustificationMode(I)V', 'getJustificationMode()I', 'justificationMode', 'I', 'relayout');
  prop('setLineBreakStyle(I)V', 'getLineBreakStyle()I', 'lineBreakStyle', 'I', 'relayout');
  prop('setLineBreakWordStyle(I)V', 'getLineBreakWordStyle()I', 'lineBreakWordStyle', 'I', 'relayout');
  prop('setElegantTextHeight(Z)V', 'isElegantTextHeight()Z', 'elegantTextHeight', 'Z', 'relayout');
  prop('setFallbackLineSpacing(Z)V', 'isFallbackLineSpacing()Z', 'fallbackLineSpacing', 'Z', 'relayout');
  prop('setSelectAllOnFocus(Z)V', 'isSelectAllOnFocus()Z', 'selectAllOnFocus', 'Z', 'none');
  prop(`setFontFeatureSettings(${STRING})V`, `getFontFeatureSettings()${STRING}`, 'fontFeatureSettings', STRING, 'relayout');
  prop('setHighlightColor(I)V', 'getHighlightColor()I', 'highlightColor', 'I', 'redraw');
  prop('setTextIsSelectable(Z)V', 'isTextSelectable()Z', 'textIsSelectable', 'Z', 'none');
  prop('setCompoundDrawablePadding(I)V', 'getCompoundDrawablePadding()I', 'compoundDrawablePadding', 'I', 'relayout');
  def(TEXT, 'isSuggestionsEnabled', '()Z', (r, _m, [self]) => {   // TextView.isSuggestionsEnabled: text-class input that does not forbid suggestions and whose variation is a free-text one
    const type = r.object(self).inputType ?? 0; if ((type & 0xf) !== 1 || (type & 0x80000) > 0) return 0;
    const variation = type & 0xff0; return variation === 0 || variation === 0x40 || variation === 0x50 || variation === 0x30 || variation === 0xa0 ? 1 : 0;
  });
  def(TEXT, 'getDefaultEditable', '()Z', () => 0);
  def(TEXT, 'getDefaultMovementMethod', '()Landroid/text/method/MovementMethod;', () => null);
  def(TEXT, 'getTextSizeUnit', '()I', (r, _m, [self]) => tv(r, self).textSizeUnit);
  def(TEXT, 'isInputMethodTarget', '()Z', () => 0);
  def(TEXT, 'getTextClassifier', '()Landroid/view/textclassifier/TextClassifier;', (r, _m, [self]) => {   // TextView.getTextClassifier: the one set on the view, else the manager's, else NO_OP
    const own = r.object(self).textClassifier; if (!nullish(own)) return own;
    const context = call(r, self, VIEW, 'getContext', [], CONTEXT), TCM = 'Landroid/view/textclassifier/TextClassificationManager;', CLASSIFIER = 'Landroid/view/textclassifier/TextClassifier;';
    const manager = nullish(context) ? null : call(r, context, CONTEXT, 'getSystemService', [STRING], OBJECT, ['textclassification']);
    return !nullish(manager) ? call(r, manager, TCM, 'getTextClassifier', [], CLASSIFIER) : r.readStatic({ owner: CLASSIFIER, name: 'NO_OP', type: CLASSIFIER });
  });
  def(TEXT, 'setTextClassifier', '(Landroid/view/textclassifier/TextClassifier;)V', (r, _m, [self, classifier]) => { r.object(self).textClassifier = nullish(classifier) ? null : classifier; });
  def(TEXT, 'setInputExtras', '(I)V', (r, _m, [self]) => { throw new APKError('TextView.setInputExtras parses an XML resource into the IME extras Bundle; the virtual device has no input method service to consume it', { kind: 'input-extras-unsupported' }); void self; });
  def(TEXT, 'getInputExtras', '(Z)Landroid/os/Bundle;', (r, _m, [self, create]) => {
    const state = tv(r, self); if (state.inputExtras) return state.inputExtras;
    if (!flag(create)) return null;
    return state.inputExtras = construct(r, 'Landroid/os/Bundle;', [], []);
  });
  def(TEXT, 'setImeActionLabel', `(${CHARS}I)V`, (r, _m, [self, label, id]) => { const s = tv(r, self); s.imeActionLabel = nullish(label) ? null : label; s.imeActionId = id; });
  def(TEXT, 'getImeActionLabel', `()${CHARS}`, (r, _m, [self]) => tv(r, self).imeActionLabel);
  // TextView.onCheckIsTextEditor / onCreateInputConnection (android-13.0.0_r1): an editable TextView with an input type is a text editor; its EditorInfo carries input type, IME options (the
  // default action is NEXT when a next focus exists, else DONE, for a single-line field), hint, selection and caps mode, and the connection is the lab's EditableInputConnection over the Editable.
  const EDITOR_INFO = 'Landroid/view/inputmethod/EditorInfo;', EDITABLE_CONNECTION = 'Ldev/apkweb/view/EditableInputConnection;', CONNECTION = 'Landroid/view/inputmethod/InputConnection;';
  def(TEXT, 'onCheckIsTextEditor', '()Z', (r, _m, [self]) => isEditText(r, self) && call(r, self, TEXT, 'getInputType', [], 'I') !== 0 ? 1 : 0);
  def(TEXT, 'onCreateInputConnection', `(${EDITOR_INFO})${CONNECTION}`, (r, _m, [self, outAttrs]) => {
    if (nullish(outAttrs)) r.throwJava('Ljava/lang/NullPointerException;', 'outAttrs');
    if (!flag(call(r, self, TEXT, 'onCheckIsTextEditor', [], 'Z')) || !r.classes.has(EDITABLE_CONNECTION)) return null;
    const fields = r.object(outAttrs).fields, put = (name, type, value) => r.storeField(fields, `${EDITOR_INFO}->${name}:${type}`, value);
    const inputType = call(r, self, TEXT, 'getInputType', [], 'I'), multiLine = (inputType & 0x20000) !== 0;
    let imeOptions = call(r, self, TEXT, 'getImeOptions', [], 'I');
    if ((imeOptions & 0xff) === 0) {   // IME_ACTION_UNSPECIFIED: NEXT when focus can move on, else DONE
      const next = call(r, self, VIEW, 'focusSearch', ['I'], VIEW, [2]);
      imeOptions |= !nullish(next) && next.ref !== self.ref ? 5 : 6;
    }
    if (multiLine && (imeOptions & 0x40000000) === 0) imeOptions |= 0x40000000;   // IME_FLAG_NO_ENTER_ACTION: Enter inserts a new line
    put('inputType', 'I', inputType); put('imeOptions', 'I', imeOptions);
    put('privateImeOptions', STRING, call(r, self, TEXT, 'getPrivateImeOptions', [], STRING)); put('fieldId', 'I', call(r, self, VIEW, 'getId', [], 'I'));
    const label = tv(r, self).imeActionLabel; put('actionLabel', CHARS, label ?? null); put('actionId', 'I', tv(r, self).imeActionId ?? 0);
    put('hintText', CHARS, call(r, self, TEXT, 'getHint', [], CHARS));
    const connection = construct(r, EDITABLE_CONNECTION, ['Landroid/widget/TextView;'], [self]);
    put('initialSelStart', 'I', call(r, self, TEXT, 'getSelectionStart', [], 'I')); put('initialSelEnd', 'I', call(r, self, TEXT, 'getSelectionEnd', [], 'I'));
    put('initialCapsMode', 'I', call(r, connection, CONNECTION, 'getCursorCapsMode', ['I'], 'I', [inputType]));
    return connection;
  });
  const BRIDGE = 'Ldev/apkweb/view/TextBridge;';
  registry.type(BRIDGE, OBJECT);
  def(BRIDGE, 'changed', `(${TEXT}${CHARS}${CHARS}I)V`, (r, _m, [view, before, after]) => {   // an Editable edit reached the view: update what the page draws and run the TextWatchers (View.text is the string the page renders)
    const text = csString(r, after); if (text === (r.object(view).text ?? '')) return;
    platform.setInput(r, r.object(view).id, text, { alreadyUpdated: true });
  }, { static: true });
  def(TEXT, 'getImeActionId', '()I', (r, _m, [self]) => tv(r, self).imeActionId);
  def(TEXT, 'setOnEditorActionListener', '(Landroid/widget/TextView$OnEditorActionListener;)V', (r, _m, [self, listener]) => { r.object(self).editorActionListener = nullish(listener) ? null : listener; });
  def(TEXT, 'onEditorAction', '(I)V', (r, _m, [self, actionCode]) => {   // TextView.onEditorAction: the listener first; then the default (next / previous focus, or hide the IME for done)
    const listener = r.object(self).editorActionListener;
    if (!nullish(listener) && flag(call(r, listener, r.object(listener).type, 'onEditorAction', [TEXT, 'I', 'Landroid/view/KeyEvent;'], 'Z', [self, actionCode, null]))) return;
    if (actionCode === 5) { const next = call(r, self, VIEW, 'focusSearch', ['I'], VIEW, [2]); if (!nullish(next)) call(r, next, VIEW, 'requestFocus', [], 'Z'); }              // IME_ACTION_NEXT -> FOCUS_FORWARD
    else if (actionCode === 7) { const prev = call(r, self, VIEW, 'focusSearch', ['I'], VIEW, [1]); if (!nullish(prev)) call(r, prev, VIEW, 'requestFocus', [], 'Z'); }         // IME_ACTION_PREVIOUS -> FOCUS_BACKWARD
  });
  // IME batch edits and callbacks (TextView.beginBatchEdit / endBatchEdit): the nesting counter; the hooks fire at the outermost level
  def(TEXT, 'beginBatchEdit', '()V', (r, _m, [self]) => { const s = tv(r, self); s.batchDepth = (s.batchDepth ?? 0) + 1; if (s.batchDepth === 1) call(r, self, TEXT, 'onBeginBatchEdit'); });
  def(TEXT, 'endBatchEdit', '()V', (r, _m, [self]) => { const s = tv(r, self); if ((s.batchDepth ?? 0) === 0) return; s.batchDepth--; if (s.batchDepth === 0) call(r, self, TEXT, 'onEndBatchEdit'); });
  for (const name of ['onBeginBatchEdit', 'onEndBatchEdit']) def(TEXT, name, '()V', () => {});
  def(TEXT, 'onCommitCompletion', '(Landroid/view/inputmethod/CompletionInfo;)V', () => {}); def(TEXT, 'onCommitCorrection', '(Landroid/view/inputmethod/CorrectionInfo;)V', () => {});
  def(TEXT, 'onPrivateIMECommand', `(${STRING}Landroid/os/Bundle;)Z`, () => 0);
  def(TEXT, 'clearComposingText', '()V', (r, _m, [self]) => {
    const text = call(r, self, TEXT, 'getText', [], CHARS); if (nullish(text) || !r.isSubtype(r.object(text).type, 'Landroid/text/Spannable;')) return;
    callStatic(r, 'Landroid/view/inputmethod/BaseInputConnection;', 'removeComposingSpans', ['Landroid/text/Spannable;'], 'V', [text]);
  });
  def(TEXT, 'extractText', '(Landroid/view/inputmethod/ExtractedTextRequest;Landroid/view/inputmethod/ExtractedText;)Z', () => { throw new APKError('TextView.extractText fills an ExtractedText for the input method service, which the virtual device does not run', { kind: 'extract-text-unsupported' }); });
  def(TEXT, 'setExtractedText', '(Landroid/view/inputmethod/ExtractedText;)V', () => { throw new APKError('TextView.setExtractedText is called by the input method service, which the virtual device does not run', { kind: 'extract-text-unsupported' }); });
  def(TEXT, 'onTextContextMenuItem', '(I)Z', () => 0);
  def(TEXT, 'debug', '(I)V', () => {});

  // ---- sizes: width / height / ems / min / max (TextView keeps a mode per axis: PIXELS or EMS, and for height LINES) ----------------------------------------------------------------------------------
  const sizeProps = [['MaxWidth', 'maxWidth'], ['MinWidth', 'minWidth'], ['MaxHeight', 'maxHeight'], ['MinHeight', 'minHeight']];
  for (const [Name, key] of sizeProps) {
    def(TEXT, `set${Name}`, '(I)V', (r, _m, [self, pixels]) => { const s = tv(r, self); s[key] = pixels; s[key + 'Mode'] = 'px'; if (key.endsWith('Height')) r.object(self)[key === 'maxHeight' ? 'maxLines' : 'minLines'] = null; /* mMaxMode / mMinMode = PIXELS: the line limit of that side is gone */ relayout(r, self); });
    def(TEXT, `get${Name}`, '()I', (r, _m, [self]) => { const s = tv(r, self); return s[key + 'Mode'] === 'ems' ? s[key + 'Ems'] : (s[key] ?? (key.startsWith('max') ? -1 : -1)); });
  }
  for (const [Name, key] of [['MaxEms', 'maxWidth'], ['MinEms', 'minWidth']]) def(TEXT, `set${Name}`, '(I)V', (r, _m, [self, ems]) => { const s = tv(r, self); s[key + 'Ems'] = ems; s[key + 'Mode'] = 'ems'; relayout(r, self); });
  def(TEXT, 'getMaxEms', '()I', (r, _m, [self]) => { const s = tv(r, self); return s.maxWidthMode === 'ems' ? s.maxWidthEms : -1; });
  def(TEXT, 'getMinEms', '()I', (r, _m, [self]) => { const s = tv(r, self); return s.minWidthMode === 'ems' ? s.minWidthEms : -1; });
  def(TEXT, 'getMaxWidth', '()I', (r, _m, [self]) => { const s = tv(r, self); return s.maxWidthMode === 'px' ? s.maxWidth : -1; });
  def(TEXT, 'getMinWidth', '()I', (r, _m, [self]) => { const s = tv(r, self); return s.minWidthMode === 'px' ? s.minWidth : -1; });
  def(TEXT, 'getMaxHeight', '()I', (r, _m, [self]) => { const s = tv(r, self); return s.maxHeightMode === 'px' ? s.maxHeight : -1; });
  def(TEXT, 'getMinHeight', '()I', (r, _m, [self]) => { const s = tv(r, self); return s.minHeightMode === 'px' ? s.minHeight : -1; });
  def(TEXT, 'setEms', '(I)V', (r, _m, [self, ems]) => { const s = tv(r, self); s.minWidthEms = s.maxWidthEms = ems; s.minWidthMode = s.maxWidthMode = 'ems'; relayout(r, self); });
  def(TEXT, 'setWidth', '(I)V', (r, _m, [self, pixels]) => { const s = tv(r, self); s.minWidth = s.maxWidth = pixels; s.minWidthMode = s.maxWidthMode = 'px'; relayout(r, self); });
  def(TEXT, 'setHeight', '(I)V', (r, _m, [self, pixels]) => { const s = tv(r, self), view = r.object(self); s.minHeight = s.maxHeight = pixels; s.minHeightMode = s.maxHeightMode = 'px'; view.minLines = view.maxLines = null; relayout(r, self); });
  /**
   * TextView.onMeasure's size limits other than the line counts: android:minWidth / maxWidth / width (pixels) or minEms / maxEms / ems (ems are line heights, as in the original),
   * and android:minHeight / maxHeight / height in pixels. null where the TextView has none.
   */
  registry.sizeLimits = (r, self) => {
    const s = r.object(self).tv; if (!s || !(s.minWidthMode || s.maxWidthMode || s.minHeightMode === 'px' || s.maxHeightMode === 'px')) return null;
    const em = s.minWidthMode === 'ems' || s.maxWidthMode === 'ems' ? call(r, self, TEXT, 'getLineHeight', [], 'I') : 0;
    const width = key => s[key + 'Mode'] === 'px' ? (s[key] >= 0 ? s[key] : null) : s[key + 'Mode'] === 'ems' ? (s[key + 'Ems'] >= 0 ? s[key + 'Ems'] * em : null) : null;
    const height = key => s[key + 'Mode'] === 'px' && s[key] >= 0 ? s[key] : null;
    return { minWidth: width('minWidth'), maxWidth: width('maxWidth'), minHeight: height('minHeight'), maxHeight: height('maxHeight') };
  };

  // ---- colours ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const argb = n => `#${(n >>> 0).toString(16).padStart(8, '0')}`;
  const currentColor = (r, self, list, fallback) => {
    if (nullish(list)) return fallback;
    const state = call(r, self, VIEW, 'getDrawableState', [], '[I');
    return call(r, list, TINT, 'getColorForState', ['[I', 'I'], 'I', [state, call(r, list, TINT, 'getDefaultColor', [], 'I')]);
  };
  const colorList = (r, color) => callStatic(r, TINT, 'valueOf', ['I'], TINT, [color]);
  const textColorOf = (r, self) => { const s = tv(r, self); if (s.textColors) return s.textColors; const c = r.object(self).textColor; return c == null ? null : colorList(r, typeof c === 'number' ? c | 0 : Number.parseInt(c.slice(1), 16) | (c.length === 7 ? 0xff000000 : 0)); };
  // TextView.getTextColors is never null: the constructor reads android:textColor (attributes, style, text appearance) and falls back to ColorStateList.valueOf(0xFF000000)
  def(TEXT, 'getTextColors', `()${TINT}`, (r, _m, [self]) => textColorOf(r, self) ?? (tv(r, self).themeTextColors ??= platform.composeCanvasHost?.themeTextColors?.(r, self) ?? colorList(r, 0xff000000 | 0)));
  def(TEXT, 'getCurrentTextColor', '()I', (r, _m, [self]) => {
    const list = textColorOf(r, self); if (list === null) return 0xff000000 | 0;   // TextView's theme default is resolved by the draw path; an unset TextView reports the default text colour black
    return currentColor(r, self, list, 0xff000000 | 0);
  });
  def(TEXT, 'setTextColor', `(${TINT})V`, (r, _m, [self, colors]) => {
    if (nullish(colors)) r.throwJava('Ljava/lang/NullPointerException;', null);
    tv(r, self).textColors = colors; legacy(r, self, 'setTextColor', ['I'], 'V', [currentColor(r, self, colors, 0xff000000 | 0)]);
  });
  // TextView.setTextColor(int) is mTextColor = ColorStateList.valueOf(color): it replaces a list a text appearance or setTextColor(ColorStateList) gave, for getTextColors(),
  // getCurrentTextColor() and the draw alike (Toolbar gives its title the text appearance first and android:titleTextColor after it).
  def(TEXT, 'setTextColor', '(I)V', (r, _m, [self, color]) => { tv(r, self).textColors = null; legacy(r, self, 'setTextColor', ['I'], 'V', [color]); });
  def(TEXT, 'getHintTextColors', `()${TINT}`, (r, _m, [self]) => tv(r, self).hintTextColors ?? null);
  def(TEXT, 'getCurrentHintTextColor', '()I', (r, _m, [self]) => { const list = tv(r, self).hintTextColors; return nullish(list) ? textColorOf(r, self) ? currentColor(r, self, textColorOf(r, self), 0) : 0 : currentColor(r, self, list, 0); });
  def(TEXT, 'setHintTextColor', '(I)V', (r, _m, [self, color]) => { tv(r, self).hintTextColors = colorList(r, color); platform.requestDraw?.(r, self); });
  def(TEXT, 'setHintTextColor', `(${TINT})V`, (r, _m, [self, colors]) => { tv(r, self).hintTextColors = nullish(colors) ? null : colors; platform.requestDraw?.(r, self); });
  def(TEXT, 'getLinkTextColors', `()${TINT}`, (r, _m, [self]) => tv(r, self).linkTextColors ?? null);
  def(TEXT, 'setLinkTextColor', '(I)V', (r, _m, [self, color]) => { tv(r, self).linkTextColors = colorList(r, color); platform.requestDraw?.(r, self); });
  def(TEXT, 'setLinkTextColor', `(${TINT})V`, (r, _m, [self, colors]) => { tv(r, self).linkTextColors = nullish(colors) ? null : colors; platform.requestDraw?.(r, self); });

  // ---- shadow, letter spacing, text scale, paint flags, locales (all on the TextView's TextPaint) ------------------------------------------------------------------------------------
  const paintOf = (r, self) => { const s = tv(r, self); if (!s.paint) { s.paint = construct(r, TEXT_PAINT, ['I'], [1]); s.paintFlags = 1; } return s.paint; };
  def(TEXT, 'getPaint', `()${TEXT_PAINT}`, (r, _m, [self]) => { const paint = paintOf(r, self); syncPaint(r, self); return paint; });
  const syncPaint = (r, self) => {   // the TextPaint mirrors the size / typeface / colour the platform holds for this TextView
    const s = tv(r, self), view = r.object(self), paint = paintOf(r, self);
    if (view.textSize != null) call(r, paint, PAINT, 'setTextSize', ['F'], 'V', [f2i(view.textSize)]);
    if (!nullish(view.typeface)) call(r, paint, PAINT, 'setTypeface', ['Landroid/graphics/Typeface;'], 'Landroid/graphics/Typeface;', [view.typeface]);
    call(r, paint, PAINT, 'setColor', ['I'], 'V', [call(r, self, TEXT, 'getCurrentTextColor', [], 'I')]);
    call(r, paint, PAINT, 'setLetterSpacing', ['F'], 'V', [f2i(s.letterSpacing)]); call(r, paint, PAINT, 'setTextScaleX', ['F'], 'V', [f2i(s.textScaleX)]);
    call(r, paint, PAINT, 'setFontFeatureSettings', [STRING], 'V', [s.fontFeatureSettings]);
    if (s.shadowRadius !== 0) call(r, paint, TEXT_PAINT, 'setShadowLayer', ['F', 'F', 'F', 'I'], 'V', [f2i(s.shadowRadius), f2i(s.shadowDx), f2i(s.shadowDy), s.shadowColor]);
    else if (s.paintShadow) call(r, paint, PAINT, 'clearShadowLayer', [], 'V', []);   // a shadow the TextView no longer has
    s.paintShadow = s.shadowRadius !== 0;
    call(r, paint, PAINT, 'setElegantTextHeight', ['Z'], 'V', [s.elegantTextHeight ? 1 : 0]);
  };
  def(TEXT, 'getPaintFlags', '()I', (r, _m, [self]) => call(r, paintOf(r, self), PAINT, 'getFlags', [], 'I'));
  def(TEXT, 'setPaintFlags', '(I)V', (r, _m, [self, flags]) => { const paint = paintOf(r, self); if (call(r, paint, PAINT, 'getFlags', [], 'I') !== flags) { call(r, paint, PAINT, 'setFlags', ['I'], 'V', [flags]); relayout(r, self); } });
  def(TEXT, 'getTextScaleX', '()F', (r, _m, [self]) => f2i(tv(r, self).textScaleX));
  def(TEXT, 'setTextScaleX', '(F)V', (r, _m, [self, size]) => { const s = tv(r, self), value = i2f(size); if (value !== s.textScaleX) { s.textScaleX = value; relayout(r, self); } });
  def(TEXT, 'getLetterSpacing', '()F', (r, _m, [self]) => f2i(tv(r, self).letterSpacing));
  def(TEXT, 'setLetterSpacing', '(F)V', (r, _m, [self, letterSpacing]) => { const s = tv(r, self), value = i2f(letterSpacing); if (value !== s.letterSpacing) { s.letterSpacing = value; relayout(r, self); } });
  def(TEXT, 'setFontVariationSettings', `(${STRING})Z`, (r, _m, [self, settings]) => {
    // TextView.setFontVariationSettings -> Paint.setFontVariationSettings: the settings are kept only when the typeface supports one of the axes (its own fonts or the
    // fallback chain's), and the TextView's typeface becomes Typeface.createFromTypefaceWithVariation(typeface, supported axes). null or "" clears them.
    const s = tv(r, self), text = nullish(settings) ? '' : typeof settings === 'string' ? settings : r.stringCharacters(settings), current = nullish(s.fontVariationSettings) ? '' : typeof s.fontVariationSettings === 'string' ? s.fontVariationSettings : r.stringCharacters(s.fontVariationSettings);
    if (text === current) return 1;
    if (!r.skiaHost?.variationTypeface) { s.fontVariationSettings = text === '' ? null : settings; relayout(r, self); return 1; }   // the page draws the text (no font backend): the value is kept
    const TYPEFACE = 'Landroid/graphics/Typeface;', base = call(r, self, TEXT, 'getTypeface', [], TYPEFACE) ?? null;
    let axes = [];
    if (text !== '') { try { axes = platform.typefaceBuilder.parseVariationSettings(r, text) ?? []; } catch (error) { if (error?.name === 'JavaException' && r.isSubtype(r.typeOf(error.value), 'Ljava/lang/IllegalArgumentException;')) return 0; throw error; } if (!axes.length) return 0; }
    const face = r.skiaHost.variationTypeface(base, axes);
    if (text !== '' && !face) return 0;
    s.fontVariationSettings = text === '' ? null : settings;
    if (face) call(r, self, TEXT, 'setTypeface', [TYPEFACE], 'V', [face]);
    relayout(r, self); return 1;
  });
  def(TEXT, 'getFontVariationSettings', `()${STRING}`, (r, _m, [self]) => tv(r, self).fontVariationSettings);
  def(TEXT, 'setShadowLayer', '(FFFI)V', (r, _m, [self, radius, dx, dy, color]) => { const s = tv(r, self); s.shadowRadius = i2f(radius); s.shadowDx = i2f(dx); s.shadowDy = i2f(dy); s.shadowColor = color; relayout(r, self); });
  for (const [Name, key] of [['Radius', 'shadowRadius'], ['Dx', 'shadowDx'], ['Dy', 'shadowDy']]) def(TEXT, `getShadow${Name}`, '()F', (r, _m, [self]) => f2i(tv(r, self)[key]));
  def(TEXT, 'getShadowColor', '()I', (r, _m, [self]) => tv(r, self).shadowColor);
  def(TEXT, 'getTextLocale', `()${LOCALE}`, (r, _m, [self]) => call(r, paintOf(r, self), PAINT, 'getTextLocale', [], LOCALE));
  def(TEXT, 'getTextLocales', `()${LOCALE_LIST}`, (r, _m, [self]) => call(r, paintOf(r, self), PAINT, 'getTextLocales', [], LOCALE_LIST));
  def(TEXT, 'setTextLocale', `(${LOCALE})V`, (r, _m, [self, locale]) => { tv(r, self).localeSet = true; call(r, paintOf(r, self), PAINT, 'setTextLocale', [LOCALE], 'V', [locale]); relayout(r, self); });
  def(TEXT, 'setTextLocales', `(${LOCALE_LIST})V`, (r, _m, [self, locales]) => { tv(r, self).localeSet = true; call(r, paintOf(r, self), PAINT, 'setTextLocales', [LOCALE_LIST], 'V', [locales]); relayout(r, self); });

  // ---- gravity, ellipsize, line spacing / height -------------------------------------------------------------------------------------------------------------------------------------------------
  const gravityOf = (r, self) => r.object(self).gravity ?? 0x800033;   // Gravity.TOP | Gravity.START unless the style says otherwise
  def(TEXT, 'getGravity', '()I', (r, _m, [self]) => gravityOf(r, self));
  def(TEXT, 'setGravity', '(I)V', (r, _m, [self, gravity]) => {   // TextView.setGravity: missing horizontal / vertical parts default to START / TOP
    let g = gravity; if ((g & 0x800007) === 0) g |= 0x800003; if ((g & 0x70) === 0) g |= 0x30;
    const view = r.object(self), previous = gravityOf(r, self); view.gravity = g; if (g !== previous) relayout(r, self);
  });
  def(TEXT, 'getEllipsize', '()Landroid/text/TextUtils$TruncateAt;', (r, _m, [self]) => tv(r, self).ellipsize);
  def(TEXT, 'setEllipsize', '(Landroid/text/TextUtils$TruncateAt;)V', (r, _m, [self, where]) => { const s = tv(r, self), value = nullish(where) ? null : where; if (s.ellipsize !== value) { s.ellipsize = value; relayout(r, self); } });
  def(TEXT, 'setLineSpacing', '(FF)V', (r, _m, [self, add, mult]) => { const s = tv(r, self); s.lineSpacingExtra = i2f(add); s.lineSpacingMult = i2f(mult); relayout(r, self); });
  def(TEXT, 'getLineSpacingExtra', '()F', (r, _m, [self]) => f2i(tv(r, self).lineSpacingExtra));
  def(TEXT, 'getLineSpacingMultiplier', '()F', (r, _m, [self]) => f2i(tv(r, self).lineSpacingMult));
  def(TEXT, 'setLineHeight', '(I)V', (r, _m, [self, lineHeight]) => {   // TextView.setLineHeight: spacing so that the line is exactly lineHeight pixels
    if (lineHeight < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Line height must be non-negative');
    syncPaint(r, self); const fontHeight = call(r, paintOf(r, self), PAINT, 'getFontMetricsInt', ['Landroid/graphics/Paint$FontMetricsInt;'], 'I', [null]);
    if (lineHeight !== fontHeight) call(r, self, TEXT, 'setLineSpacing', ['F', 'F'], 'V', [f2i(lineHeight - fontHeight), f2i(1)]);
  });
  const fontMetricsInt = (r, self) => { syncPaint(r, self); const fm = construct(r, 'Landroid/graphics/Paint$FontMetricsInt;', [], []); call(r, paintOf(r, self), PAINT, 'getFontMetricsInt', ['Landroid/graphics/Paint$FontMetricsInt;'], 'I', [fm]); const f = r.object(fm).fields; const read = n => f.get(`Landroid/graphics/Paint$FontMetricsInt;->${n}:I`) ?? 0; return { ascent: read('ascent'), descent: read('descent'), top: read('top'), bottom: read('bottom'), leading: read('leading') }; };
  def(TEXT, 'getLineHeight', '()I', (r, _m, [self]) => { const s = tv(r, self); syncPaint(r, self); const total = call(r, paintOf(r, self), PAINT, 'getFontMetricsInt', ['Landroid/graphics/Paint$FontMetricsInt;'], 'I', [null]); return Math.round(total * s.lineSpacingMult + s.lineSpacingExtra); });
  def(TEXT, 'getFirstBaselineToTopHeight', '()I', (r, _m, [self]) => call(r, self, VIEW, 'getPaddingTop', [], 'I') - fontMetricsInt(r, self).top);
  def(TEXT, 'getLastBaselineToBottomHeight', '()I', (r, _m, [self]) => call(r, self, VIEW, 'getPaddingBottom', [], 'I') + fontMetricsInt(r, self).bottom);
  def(TEXT, 'setFirstBaselineToTopHeight', '(I)V', (r, _m, [self, height]) => {   // only grows the top padding: a request below the font's own ascent changes nothing (TextView.setFirstBaselineToTopHeight)
    if (height < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'firstBaselineToTopHeight can\'t be negative');
    const fm = fontMetricsInt(r, self), fontTop = call(r, self, TEXT, 'getIncludeFontPadding', [], 'Z') ? fm.top : fm.ascent;
    if (height > Math.abs(fontTop)) call(r, self, VIEW, 'setPadding', ['I', 'I', 'I', 'I'], 'V', [call(r, self, VIEW, 'getPaddingLeft', [], 'I'), height - (-fontTop), call(r, self, VIEW, 'getPaddingRight', [], 'I'), call(r, self, VIEW, 'getPaddingBottom', [], 'I')]);
  });
  def(TEXT, 'setLastBaselineToBottomHeight', '(I)V', (r, _m, [self, height]) => {
    if (height < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'lastBaselineToBottomHeight can\'t be negative');
    const fm = fontMetricsInt(r, self), fontBottom = call(r, self, TEXT, 'getIncludeFontPadding', [], 'Z') ? fm.bottom : fm.descent;
    if (height > Math.abs(fontBottom)) call(r, self, VIEW, 'setPadding', ['I', 'I', 'I', 'I'], 'V', [call(r, self, VIEW, 'getPaddingLeft', [], 'I'), call(r, self, VIEW, 'getPaddingTop', [], 'I'), call(r, self, VIEW, 'getPaddingRight', [], 'I'), height - fontBottom]);
  });
  def(TEXT, 'isAllCaps', '()Z', (r, _m, [self]) => { const method = call(r, self, TEXT, 'getTransformationMethod', [], 'Landroid/text/method/TransformationMethod;'); return !nullish(method) && r.object(method).type === 'Landroid/text/method/AllCapsTransformationMethod;' ? 1 : 0; });
  def(TEXT, 'setAllCaps', '(Z)V', (r, _m, [self, allCaps]) => {
    const context = call(r, self, VIEW, 'getContext', [], CONTEXT);
    call(r, self, TEXT, 'setTransformationMethod', ['Landroid/text/method/TransformationMethod;'], 'V', [flag(allCaps) ? construct(r, 'Landroid/text/method/AllCapsTransformationMethod;', [CONTEXT], [context]) : null]);
  });
  def(TEXT, 'isHorizontallyScrollable', '()Z', (r, _m, [self]) => r.object(self).horizontallyScrolling ? 1 : 0);
  def(TEXT, 'setFrame', '(IIII)Z', (r, _m, [self, l, t, rr, b]) => {
    const view = r.object(self), before = view.bounds ?? {}; const changed = before.left !== l || before.top !== t || before.right !== rr || before.bottom !== b;
    call(r, self, VIEW, 'setLeftTopRightBottom', ['I', 'I', 'I', 'I'], 'V', [l, t, rr, b]); return changed ? 1 : 0;
  });

  // ---- compound drawables -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const drawables = (r, self) => { const s = tv(r, self); return s.compound ??= { left: null, top: null, right: null, bottom: null, start: null, end: null, relative: false }; };
  const adopt = (r, self, d) => { if (!nullish(d)) { call(r, d, DRAWABLE, 'setCallback', ['Landroid/graphics/drawable/Drawable$Callback;'], 'V', [self]); call(r, d, DRAWABLE, 'setLayoutDirection', ['I'], 'Z', [call(r, self, VIEW, 'getLayoutDirection', [], 'I')]); if (call(r, d, DRAWABLE, 'isStateful', [], 'Z')) call(r, d, DRAWABLE, 'setState', ['[I'], 'Z', [call(r, self, VIEW, 'getDrawableState', [], '[I')]); } return nullish(d) ? null : d; };
  const syncCompoundPaddingState = (r, self) => { const c = drawables(r, self); r.object(self).compoundDrawables = [c.left, c.top, c.right, c.bottom]; };
  const setCompound = (r, self, left, top, right, bottom) => {
    const c = drawables(r, self); c.relative = false; c.start = c.end = null;
    for (const [key, d] of [['left', left], ['top', top], ['right', right], ['bottom', bottom]]) { if (c[key] !== d && !nullish(c[key])) call(r, c[key], DRAWABLE, 'setCallback', ['Landroid/graphics/drawable/Drawable$Callback;'], 'V', [null]); c[key] = adopt(r, self, d); }
    applyCompoundTint(r, self); relayout(r, self);
  };
  const setCompoundRelative = (r, self, start, top, end, bottom) => {
    const c = drawables(r, self), rtl = call(r, self, VIEW, 'getLayoutDirection', [], 'I') === 1; c.relative = true; c.start = adopt(r, self, start); c.end = adopt(r, self, end);
    c.top = adopt(r, self, top); c.bottom = adopt(r, self, bottom); c.left = rtl ? c.end : c.start; c.right = rtl ? c.start : c.end; applyCompoundTint(r, self); relayout(r, self);
  };
  const D4 = DRAWABLE.repeat(4);
  def(TEXT, 'setCompoundDrawables', `(${D4})V`, (r, _m, [self, l, t, rr, b]) => {
    for (const d of [l, t, rr, b]) if (!nullish(d)) { const rect = call(r, d, DRAWABLE, 'getBounds', [], RECT); void rect; }
    setCompound(r, self, l, t, rr, b);
  });
  const intrinsic = (r, d) => { if (nullish(d)) return; call(r, d, DRAWABLE, 'setBounds', ['I', 'I', 'I', 'I'], 'V', [0, 0, call(r, d, DRAWABLE, 'getIntrinsicWidth', [], 'I'), call(r, d, DRAWABLE, 'getIntrinsicHeight', [], 'I')]); };
  def(TEXT, 'setCompoundDrawablesWithIntrinsicBounds', `(${D4})V`, (r, _m, [self, l, t, rr, b]) => { [l, t, rr, b].forEach(d => intrinsic(r, d)); setCompound(r, self, l, t, rr, b); });
  const byResource = (r, self, id) => id === 0 ? null : call(r, call(r, self, VIEW, 'getContext', [], CONTEXT), CONTEXT, 'getDrawable', ['I'], DRAWABLE, [id]);
  def(TEXT, 'setCompoundDrawablesWithIntrinsicBounds', '(IIII)V', (r, _m, [self, l, t, rr, b]) => call(r, self, TEXT, 'setCompoundDrawablesWithIntrinsicBounds', [DRAWABLE, DRAWABLE, DRAWABLE, DRAWABLE], 'V', [byResource(r, self, l), byResource(r, self, t), byResource(r, self, rr), byResource(r, self, b)]));
  def(TEXT, 'setCompoundDrawablesRelative', `(${D4})V`, (r, _m, [self, s, t, e, b]) => setCompoundRelative(r, self, s, t, e, b));
  def(TEXT, 'setCompoundDrawablesRelativeWithIntrinsicBounds', `(${D4})V`, (r, _m, [self, s, t, e, b]) => { [s, t, e, b].forEach(d => intrinsic(r, d)); setCompoundRelative(r, self, s, t, e, b); });
  def(TEXT, 'setCompoundDrawablesRelativeWithIntrinsicBounds', '(IIII)V', (r, _m, [self, s, t, e, b]) => call(r, self, TEXT, 'setCompoundDrawablesRelativeWithIntrinsicBounds', [DRAWABLE, DRAWABLE, DRAWABLE, DRAWABLE], 'V', [byResource(r, self, s), byResource(r, self, t), byResource(r, self, e), byResource(r, self, b)]));
  const arrayOf = (r, items) => { const a = r.newArray(`[${DRAWABLE}`, items.length); r.array(a).elements = items.map(x => x ?? null); return a; };
  def(TEXT, 'getCompoundDrawables', `()[${DRAWABLE}`, (r, _m, [self]) => { const c = drawables(r, self); return arrayOf(r, [c.left, c.top, c.right, c.bottom]); });
  def(TEXT, 'getCompoundDrawablesRelative', `()[${DRAWABLE}`, (r, _m, [self]) => {
    const c = drawables(r, self), rtl = call(r, self, VIEW, 'getLayoutDirection', [], 'I') === 1; return arrayOf(r, [rtl ? c.right : c.left, c.top, rtl ? c.left : c.right, c.bottom]);
  });
  const sizeOfDrawable = (r, d, axis) => { if (nullish(d)) return 0; const b = call(r, d, DRAWABLE, 'getBounds', [], RECT), f = r.object(b).fields; return axis === 'w' ? (f.get(`${RECT}->right:I`) ?? 0) - (f.get(`${RECT}->left:I`) ?? 0) : (f.get(`${RECT}->bottom:I`) ?? 0) - (f.get(`${RECT}->top:I`) ?? 0); };
  const compoundPad = (r, self, which) => {   // TextView.getCompoundPadding*: padding plus each side's drawable width / height and the drawable padding
    const c = drawables(r, self), s = tv(r, self), pad = n => call(r, self, VIEW, n, [], 'I'), rtl = call(r, self, VIEW, 'getLayoutDirection', [], 'I') === 1;
    const side = d => nullish(d) ? 0 : sizeOfDrawable(r, d, 'w') + s.compoundDrawablePadding, vertical = d => nullish(d) ? 0 : sizeOfDrawable(r, d, 'h') + s.compoundDrawablePadding;
    switch (which) {
      case 'left': return pad('getPaddingLeft') + side(c.left); case 'right': return pad('getPaddingRight') + side(c.right);
      case 'top': return pad('getPaddingTop') + vertical(c.top); case 'bottom': return pad('getPaddingBottom') + vertical(c.bottom);
      case 'start': return rtl ? compoundPad(r, self, 'right') : compoundPad(r, self, 'left'); case 'end': return rtl ? compoundPad(r, self, 'left') : compoundPad(r, self, 'right');
    }
    return 0;
  };
  for (const [Name, key] of [['Left', 'left'], ['Right', 'right'], ['Top', 'top'], ['Bottom', 'bottom'], ['Start', 'start'], ['End', 'end']]) def(TEXT, `getCompoundPadding${Name}`, '()I', (r, _m, [self]) => compoundPad(r, self, key));
  const vOffset = (r, self) => {   // TextView.getVerticalOffset: the vertical gravity space above the laid-out text
    const layout = call(r, self, TEXT, 'getLayout', [], LAYOUT); if (nullish(layout)) return 0;
    const box = call(r, self, VIEW, 'getMeasuredHeight', [], 'I') - compoundPad(r, self, 'top') - compoundPad(r, self, 'bottom'), height = call(r, layout, LAYOUT, 'getHeight', [], 'I'), vertical = gravityOf(r, self) & 0x70;
    if (vertical === 0x30 || box <= height) return 0; return vertical === 0x50 ? box - height : (box - height) >> 1;
  };
  def(TEXT, 'getExtendedPaddingTop', '()I', (r, _m, [self]) => compoundPad(r, self, 'top') + (vOffset(r, self) && (gravityOf(r, self) & 0x70) !== 0x50 ? vOffset(r, self) : 0));
  def(TEXT, 'getExtendedPaddingBottom', '()I', (r, _m, [self]) => compoundPad(r, self, 'bottom') + ((gravityOf(r, self) & 0x70) === 0x50 ? vOffset(r, self) : 0));
  def(TEXT, 'getTotalPaddingLeft', '()I', (r, _m, [self]) => compoundPad(r, self, 'left'));
  def(TEXT, 'getTotalPaddingRight', '()I', (r, _m, [self]) => compoundPad(r, self, 'right'));
  def(TEXT, 'getTotalPaddingTop', '()I', (r, _m, [self]) => call(r, self, TEXT, 'getExtendedPaddingTop', [], 'I'));
  def(TEXT, 'getTotalPaddingBottom', '()I', (r, _m, [self]) => call(r, self, TEXT, 'getExtendedPaddingBottom', [], 'I'));
  def(TEXT, 'getTotalPaddingStart', '()I', (r, _m, [self]) => compoundPad(r, self, 'start'));
  def(TEXT, 'getTotalPaddingEnd', '()I', (r, _m, [self]) => compoundPad(r, self, 'end'));
  def(TEXT, 'setCompoundDrawableTintList', `(${TINT})V`, (r, _m, [self, list]) => { const c = tvTint(r, self); c.list = nullish(list) ? null : list; c.hasList = true; applyCompoundTint(r, self); });
  def(TEXT, 'getCompoundDrawableTintList', `()${TINT}`, (r, _m, [self]) => tvTint(r, self).list);
  def(TEXT, 'setCompoundDrawableTintBlendMode', `(${BLEND})V`, (r, _m, [self, mode]) => { const c = tvTint(r, self); c.blend = nullish(mode) ? null : mode; c.hasBlend = true; applyCompoundTint(r, self); });
  def(TEXT, 'getCompoundDrawableTintBlendMode', `()${BLEND}`, (r, _m, [self]) => tvTint(r, self).blend);
  def(TEXT, 'setCompoundDrawableTintMode', `(${MODE})V`, (r, _m, [self, mode]) => {
    const names = { CLEAR: 0, SRC: 1, DST: 2, SRC_OVER: 3, DST_OVER: 4, SRC_IN: 5, DST_IN: 6, SRC_OUT: 7, DST_OUT: 8, SRC_ATOP: 9, DST_ATOP: 10, XOR: 11, ADD: 12, SCREEN: 14, OVERLAY: 15, DARKEN: 16, LIGHTEN: 17, MULTIPLY: 24 };
    call(r, self, TEXT, 'setCompoundDrawableTintBlendMode', [BLEND], 'V', [nullish(mode) ? null : callStatic(r, BLEND, 'fromValue', ['I'], BLEND, [names[r.object(mode).enumName]])]);
  });
  def(TEXT, 'getCompoundDrawableTintMode', `()${MODE}`, (r, _m, [self]) => { const b = tvTint(r, self).blend; return nullish(b) ? null : callStatic(r, BLEND, 'blendModeToPorterDuffMode', [BLEND], MODE, [b]); });
  const tvTint = (r, self) => tv(r, self).compoundTint ??= { list: null, hasList: false, blend: null, hasBlend: false };
  const applyCompoundTint = (r, self) => {
    const t = tvTint(r, self), c = drawables(r, self);
    for (const key of ['left', 'top', 'right', 'bottom']) {
      const d = c[key]; if (nullish(d) || !(t.hasList || t.hasBlend)) continue;
      const m = call(r, d, DRAWABLE, 'mutate', [], DRAWABLE); c[key] = m;
      if (t.hasList) call(r, m, DRAWABLE, 'setTintList', [TINT], 'V', [t.list]); if (t.hasBlend) call(r, m, DRAWABLE, 'setTintBlendMode', [BLEND], 'V', [t.blend]);
    }
    syncCompoundPaddingState(r, self); platform.requestDraw?.(r, self);
  };
  registry.compoundDrawables = (r, self) => drawables(r, self);
  /** The TextView.getCompoundPadding* box when a compound drawable is set (the native text path lays out and draws the text inside it), else null. */
  registry.compoundPadding = (r, self) => {
    const c = r.object(self).tv?.compound; if (!c || ![c.left, c.top, c.right, c.bottom].some(d => !nullish(d))) return null;
    return { left: compoundPad(r, self, 'left'), top: compoundPad(r, self, 'top'), right: compoundPad(r, self, 'right'), bottom: compoundPad(r, self, 'bottom') };
  };
  /** TextView.onMeasure's drawable extents: the heights of the left / right drawables and the widths of the top / bottom ones. */
  registry.compoundExtents = (r, self) => {
    const c = r.object(self).tv?.compound; if (!c) return null;
    return { leftHeight: sizeOfDrawable(r, c.left, 'h'), rightHeight: sizeOfDrawable(r, c.right, 'h'), topWidth: sizeOfDrawable(r, c.top, 'w'), bottomWidth: sizeOfDrawable(r, c.bottom, 'w') };
  };
  /** The drawables to draw with their positions (TextView.onDraw compound drawable pass), in the view's own coordinates before scrolling. */
  registry.compoundPlacements = (r, self, width, height) => {
    const c = r.object(self).tv?.compound; if (!c) return [];
    const cl = compoundPad(r, self, 'left'), ct = compoundPad(r, self, 'top'), cr = compoundPad(r, self, 'right'), cb = compoundPad(r, self, 'bottom');
    const pad = n => call(r, self, VIEW, n, [], 'I'), vspace = height - cb - ct, hspace = width - cr - cl, out = [];
    const w = d => sizeOfDrawable(r, d, 'w'), h = d => sizeOfDrawable(r, d, 'h');
    if (!nullish(c.left)) out.push({ drawable: c.left, x: pad('getPaddingLeft'), y: ct + (vspace - h(c.left)) / 2 });
    if (!nullish(c.right)) out.push({ drawable: c.right, x: width - pad('getPaddingRight') - w(c.right), y: ct + (vspace - h(c.right)) / 2 });
    if (!nullish(c.top)) out.push({ drawable: c.top, x: cl + (hspace - w(c.top)) / 2, y: pad('getPaddingTop') });
    if (!nullish(c.bottom)) out.push({ drawable: c.bottom, x: cl + (hspace - w(c.bottom)) / 2, y: height - pad('getPaddingBottom') - h(c.bottom) });
    return out;
  };
  /** Every compound drawable currently set (for drawable-state propagation). */
  registry.compoundList = (r, self) => { const c = r.object(self).tv?.compound; return c ? [c.left, c.top, c.right, c.bottom].filter(d => !nullish(d)) : []; };


  // ---- TextView.BufferType (NORMAL, SPANNABLE, EDITABLE) ---------------------------------------------------------------------------------------------------------------------------------------------------
  {
    const BUFFER_TYPE = 'Landroid/widget/TextView$BufferType;', NAMES = ['NORMAL', 'SPANNABLE', 'EDITABLE'], singletons = gcRoot(new Map());
    registry.type(BUFFER_TYPE, 'Ljava/lang/Enum;');
    NAMES.forEach((name, ordinal) => registry.staticField(BUFFER_TYPE, name, BUFFER_TYPE, r => { if (!singletons.has(name)) { const ref = r.makeObject(BUFFER_TYPE), o = r.object(ref); o.enumName = name; o.enumOrdinal = ordinal; singletons.set(name, ref); } return singletons.get(name); }));
    def(BUFFER_TYPE, 'values', `()[${BUFFER_TYPE}`, r => { const array = r.newArray(`[${BUFFER_TYPE}`, 3); r.array(array).elements = NAMES.map(name => r.readStatic({ owner: BUFFER_TYPE, name, type: BUFFER_TYPE, key: `${BUFFER_TYPE}->${name}:${BUFFER_TYPE}` })); return array; }, { static: true });
    def(BUFFER_TYPE, 'valueOf', `(${STRING})${BUFFER_TYPE}`, (r, _m, [name]) => { const n = r.stringCharacters(name); if (!NAMES.includes(n)) r.throwJava('Ljava/lang/IllegalArgumentException;', `No enum constant android.widget.TextView.BufferType.${n}`); return r.readStatic({ owner: BUFFER_TYPE, name: n, type: BUFFER_TYPE, key: `${BUFFER_TYPE}->${n}:${BUFFER_TYPE}` }); }, { static: true });
  }

  // ---- the text itself: CharSequence storage (spans survive), BufferType, append, selection, links, movement methods --------------------------------------------------------------------------------
  const SPANNABLE = 'Landroid/text/Spannable;', EDITABLE = 'Landroid/text/Editable;', SPANNED = 'Landroid/text/Spanned;', BUFFER = 'Landroid/widget/TextView$BufferType;', MOVEMENT = 'Landroid/text/method/MovementMethod;';
  const isEditText = (r, self) => r.isSubtype(r.object(self).type, 'Landroid/widget/EditText;');
  const typeOf = (r, cs) => (nullish(cs) || typeof cs === 'string') ? 'Ljava/lang/String;' : r.object(cs).type;
  const csString = (r, cs) => nullish(cs) ? '' : typeof cs === 'string' ? cs : r.stringCharacters(call(r, cs, OBJECT, 'toString', [], STRING));
  const bufferName = (r, type) => r.object(type).enumName ?? 'NORMAL';
  const staticField = (r, owner, name, type = owner) => r.readStatic({ owner, name, type, key: `${owner}->${name}:${type}` });
  /** Stores what getText() must return (the app's CharSequence, with its spans) next to the plain string the native text path draws. */
  const adoptText = (r, self, cs) => { r.object(self).textSource = cs; };
  def(TEXT, 'setText', `(${CHARS})V`, (r, _m, [self, text]) => callSetText(r, self, text, isEditText(r, self) ? 'EDITABLE' : 'NORMAL'));
  def(TEXT, 'setText', `(${CHARS}${BUFFER})V`, (r, _m, [self, text, type]) => callSetText(r, self, text, nullish(type) ? 'NORMAL' : bufferName(r, type)));
  def(TEXT, 'setText', '([CII)V', (r, _m, [self, chars, start, length]) => {
    if (start < 0 || length < 0 || start + length > r.array(chars).elements.length) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', `${start} ${length}`);
    callSetText(r, self, String.fromCharCode(...r.array(chars).elements.slice(start, start + length).map(c => c & 0xffff)), 'NORMAL');
  });
  def(TEXT, 'setText', `(I${BUFFER})V`, (r, _m, [self, resid, type]) => callSetText(r, self, call(r, resources(r, self), 'Landroid/content/res/Resources;', 'getText', ['I'], CHARS, [resid]), nullish(type) ? 'NORMAL' : bufferName(r, type)));
  const callSetText = (r, self, text, type) => {
    let stored = nullish(text) ? '' : text;
    const s = tv(r, self);
    if (!isEditText(r, self)) {
      const needSpannable = type === 'SPANNABLE' || (!nullish(r.object(self).movementMethod) && stored !== '');
      if (type === 'EDITABLE') stored = call(r, callStatic(r, 'Landroid/text/Editable$Factory;', 'getInstance', [], 'Landroid/text/Editable$Factory;'), 'Landroid/text/Editable$Factory;', 'newEditable', [CHARS], EDITABLE, [stored]);
      else if (needSpannable) stored = typeof stored !== 'string' && r.isSubtype(typeOf(r, stored), SPANNABLE) && type !== 'SPANNABLE' ? stored : call(r, callStatic(r, 'Landroid/text/Spannable$Factory;', 'getInstance', [], 'Landroid/text/Spannable$Factory;'), 'Landroid/text/Spannable$Factory;', 'newSpannable', [CHARS], SPANNABLE, [stored]);
      else if (typeof stored !== 'string') stored = callStatic(r, 'Landroid/text/TextUtils;', 'stringOrSpannedString', [CHARS], CHARS, [stored]);
      if (s.autoLinkMask !== 0 && stored !== '') {   // TextView.setText: Linkify.addLinks over a Spannable copy; clickable links get a LinkMovementMethod unless the text is selectable
        const spannable = typeof stored !== 'string' && r.isSubtype(typeOf(r, stored), SPANNABLE) ? stored : call(r, callStatic(r, 'Landroid/text/Spannable$Factory;', 'getInstance', [], 'Landroid/text/Spannable$Factory;'), 'Landroid/text/Spannable$Factory;', 'newSpannable', [CHARS], SPANNABLE, [stored]);
        if (flag(callStatic(r, 'Landroid/text/util/Linkify;', 'addLinks', [SPANNABLE, 'I'], 'Z', [spannable, s.autoLinkMask]))) {
          stored = spannable;
          if (s.linksClickable && !s.textIsSelectable) call(r, self, TEXT, 'setMovementMethod', [MOVEMENT], 'V', [callStatic(r, 'Landroid/text/method/LinkMovementMethod;', 'getInstance', [], MOVEMENT)]);
        }
      }
    }
    legacy(r, self, 'setText', [CHARS], 'V', [typeof stored === 'string' ? stored : r.object(self).type && csString(r, stored)]);
    if (!isEditText(r, self)) adoptText(r, self, typeof stored === 'string' ? null : stored);
    s.layoutKey = null;
  };
  def(TEXT, 'getText', `()${CHARS}`, (r, _m, [self]) => {
    const view = r.object(self), source = view.textSource;
    if (!isEditText(r, self) && !nullish(source) && csString(r, source) === (view.text ?? '')) return source;
    return legacy(r, self, 'getText', [], CHARS);
  });
  def(TEXT, 'length', '()I', (r, _m, [self]) => csString(r, call(r, self, TEXT, 'getText', [], CHARS)).length);
  def(TEXT, 'getEditableText', `()${EDITABLE}`, (r, _m, [self]) => { const text = call(r, self, TEXT, 'getText', [], CHARS); return !nullish(text) && typeof text !== 'string' && r.isSubtype(r.object(text).type, EDITABLE) ? text : null; });
  def(TEXT, 'setTextKeepState', `(${CHARS})V`, (r, _m, [self, text]) => call(r, self, TEXT, 'setTextKeepState', [CHARS, BUFFER], 'V', [text, staticField(r, BUFFER, 'NORMAL')]));
  def(TEXT, 'setTextKeepState', `(${CHARS}${BUFFER})V`, (r, _m, [self, text, type]) => {
    const start = call(r, self, TEXT, 'getSelectionStart', [], 'I'), end = call(r, self, TEXT, 'getSelectionEnd', [], 'I'), len = csString(r, text).length;
    call(r, self, TEXT, 'setText', [CHARS, BUFFER], 'V', [text, type]);
    if ((start >= 0 || end >= 0) && !nullish(call(r, self, TEXT, 'getText', [], CHARS)) && r.isSubtype(typeOf(r, call(r, self, TEXT, 'getText', [], CHARS)), SPANNABLE)) callStatic(r, 'Landroid/text/Selection;', 'setSelection', [SPANNABLE, 'I', 'I'], 'V', [call(r, self, TEXT, 'getText', [], CHARS), Math.max(0, Math.min(start, len)), Math.max(0, Math.min(end, len))]);
  });
  def(TEXT, 'append', `(${CHARS})V`, (r, _m, [self, text]) => call(r, self, TEXT, 'append', [CHARS, 'I', 'I'], 'V', [text, 0, csString(r, text).length]));
  def(TEXT, 'append', `(${CHARS}II)V`, (r, _m, [self, text, start, end]) => {
    let current = call(r, self, TEXT, 'getText', [], CHARS);
    if (nullish(current) || typeof current === 'string' || !r.isSubtype(r.object(current).type, EDITABLE)) { call(r, self, TEXT, 'setText', [CHARS, BUFFER], 'V', [current, staticField(r, BUFFER, 'EDITABLE')]); current = call(r, self, TEXT, 'getText', [], CHARS); }
    call(r, current, EDITABLE, 'append', [CHARS, 'I', 'I'], EDITABLE, [text, start, end]);
    if (!isEditText(r, self)) legacy(r, self, 'setText', [CHARS], 'V', [csString(r, current)]);   // the Editable is the source of truth; the plain mirror follows it
    const s = tv(r, self);
    if (s.autoLinkMask !== 0 && flag(callStatic(r, 'Landroid/text/util/Linkify;', 'addLinks', [SPANNABLE, 'I'], 'Z', [current, s.autoLinkMask])) && s.linksClickable && !s.textIsSelectable && nullish(call(r, self, TEXT, 'getMovementMethod', [], MOVEMENT))) call(r, self, TEXT, 'setMovementMethod', [MOVEMENT], 'V', [callStatic(r, 'Landroid/text/method/LinkMovementMethod;', 'getInstance', [], MOVEMENT)]);
  });
  const spannableText = (r, self) => { const text = call(r, self, TEXT, 'getText', [], CHARS); return !nullish(text) && typeof text !== 'string' && r.isSubtype(r.object(text).type, SPANNABLE) ? text : null; };
  // EditText's selection methods (frameworks/base EditText.java): thin wrappers over android.text.Selection on the view's Editable
  const EDIT_TEXT = 'Landroid/widget/EditText;', editable = (r, self) => call(r, self, TEXT, 'getText', [], CHARS);
  def(EDIT_TEXT, 'setSelection', '(II)V', (r, _m, [self, start, stop]) => callStatic(r, 'Landroid/text/Selection;', 'setSelection', [SPANNABLE, 'I', 'I'], 'V', [editable(r, self), start, stop]));
  def(EDIT_TEXT, 'setSelection', '(I)V', (r, _m, [self, index]) => callStatic(r, 'Landroid/text/Selection;', 'setSelection', [SPANNABLE, 'I'], 'V', [editable(r, self), index]));
  def(EDIT_TEXT, 'selectAll', '()V', (r, _m, [self]) => callStatic(r, 'Landroid/text/Selection;', 'selectAll', [SPANNABLE], 'V', [editable(r, self)]));
  def(EDIT_TEXT, 'extendSelection', '(I)V', (r, _m, [self, index]) => callStatic(r, 'Landroid/text/Selection;', 'extendSelection', [SPANNABLE, 'I'], 'V', [editable(r, self), index]));
  def(TEXT, 'getSelectionStart', '()I', (r, _m, [self]) => callStatic(r, 'Landroid/text/Selection;', 'getSelectionStart', [CHARS], 'I', [call(r, self, TEXT, 'getText', [], CHARS) ?? '']));
  def(TEXT, 'getSelectionEnd', '()I', (r, _m, [self]) => callStatic(r, 'Landroid/text/Selection;', 'getSelectionEnd', [CHARS], 'I', [call(r, self, TEXT, 'getText', [], CHARS) ?? '']));
  def(TEXT, 'hasSelection', '()Z', (r, _m, [self]) => { const a = call(r, self, TEXT, 'getSelectionStart', [], 'I'), b = call(r, self, TEXT, 'getSelectionEnd', [], 'I'); return a >= 0 && a !== b ? 1 : 0; });
  def(TEXT, 'onSelectionChanged', '(II)V', () => {});
  def(TEXT, 'onTextChanged', `(${CHARS}III)V`, () => {});
  def(TEXT, 'getUrls', '()[Landroid/text/style/URLSpan;', (r, _m, [self]) => {
    const text = call(r, self, TEXT, 'getText', [], CHARS);
    if (!nullish(text) && typeof text !== 'string' && r.isSubtype(r.object(text).type, SPANNED)) return call(r, text, SPANNED, 'getSpans', ['I', 'I', 'Ljava/lang/Class;'], '[Ljava/lang/Object;', [0, csString(r, text).length, r.classObject?.('Landroid/text/style/URLSpan;') ?? staticClass(r, 'Landroid/text/style/URLSpan;')]);
    return r.newArray('[Landroid/text/style/URLSpan;', 0);
  });
  const staticClass = (r, descriptor) => r.dispatch({ owner: 'Ljava/lang/Class;', name: 'forName', parameters: [STRING], result: 'Ljava/lang/Class;', signature: `(${STRING})Ljava/lang/Class;` }, [descriptor.slice(1, -1).replaceAll('/', '.')], 'static');
  def(TEXT, 'getMovementMethod', `()${MOVEMENT}`, (r, _m, [self]) => r.object(self).movementMethod ?? null);
  def(TEXT, 'setMovementMethod', `(${MOVEMENT})V`, (r, _m, [self, method]) => {
    const view = r.object(self), next = nullish(method) ? null : method; if ((view.movementMethod ?? null) === next) return;
    view.movementMethod = next;
    const text = call(r, self, TEXT, 'getText', [], CHARS);
    if (next !== null && (nullish(text) || typeof text === 'string' || !r.isSubtype(r.object(text).type, SPANNABLE))) call(r, self, TEXT, 'setText', [CHARS], 'V', [text]);   // movement methods work on Spannable text
    // fixFocusableAndClickableSettings: a movement method makes the View focusable, clickable and long-clickable (and a TextView without one is not, unless it is an EditText)
    if (next !== null) { call(r, self, VIEW, 'setFocusable', ['Z'], 'V', [1]); call(r, self, VIEW, 'setClickable', ['Z'], 'V', [1]); call(r, self, VIEW, 'setLongClickable', ['Z'], 'V', [1]); }
  });
  def(TEXT, 'onFocusChanged', '(ZILandroid/graphics/Rect;)V', (r, _m, [self, focused, direction, rect]) => {   // TextView.onFocusChanged -> Editor.onFocusChanged: android:selectAllOnFocus selects the whole text (TextView.selectAllText)
    if (flag(focused) && tv(r, self).selectAllOnFocus) { const text = spannableText(r, self); if (text) callStatic(r, 'Landroid/text/Selection;', 'setSelection', [SPANNABLE, 'I', 'I'], 'V', [text, 0, csString(r, text).length]); }
    r.dispatch({ owner: VIEW, name: 'onFocusChanged', parameters: ['Z', 'I', 'Landroid/graphics/Rect;'], result: 'V', signature: '(ZILandroid/graphics/Rect;)V' }, [self, focused, direction, rect], 'direct');
  });
  def(TEXT, 'onTouchEvent', '(Landroid/view/MotionEvent;)Z', (r, _m, [self, event]) => {   // TextView.onTouchEvent: View's click / press handling, then the movement method over the Spannable text
    const result = r.dispatch({ owner: VIEW, name: 'onTouchEvent', parameters: ['Landroid/view/MotionEvent;'], result: 'Z', signature: '(Landroid/view/MotionEvent;)Z' }, [self, event], 'direct');
    const method = r.object(self).movementMethod, text = spannableText(r, self);
    if (!nullish(method) && text && flag(call(r, self, VIEW, 'isEnabled', [], 'Z')) && !nullish(call(r, self, TEXT, 'getLayout', [], LAYOUT))) {
      if (flag(call(r, method, r.object(method).type, 'onTouchEvent', [TEXT, SPANNABLE, 'Landroid/view/MotionEvent;'], 'Z', [self, text, event]))) return 1;
    }
    return result;
  });
  def(TEXT, 'onKeyDown', '(ILandroid/view/KeyEvent;)Z', (r, _m, [self, code, event]) => {
    const method = r.object(self).movementMethod, text = spannableText(r, self);
    if (!nullish(method) && text && !nullish(call(r, self, TEXT, 'getLayout', [], LAYOUT)) && flag(call(r, method, r.object(method).type, 'onKeyDown', [TEXT, SPANNABLE, 'I', 'Landroid/view/KeyEvent;'], 'Z', [self, text, code, event]))) return 1;
    return r.dispatch({ owner: VIEW, name: 'onKeyDown', parameters: ['I', 'Landroid/view/KeyEvent;'], result: 'Z', signature: '(ILandroid/view/KeyEvent;)Z' }, [self, code, event], 'direct');
  });
  def(TEXT, 'onKeyUp', '(ILandroid/view/KeyEvent;)Z', (r, _m, [self, code, event]) => {
    const method = r.object(self).movementMethod, text = spannableText(r, self);
    if (!nullish(method) && text && !nullish(call(r, self, TEXT, 'getLayout', [], LAYOUT)) && flag(call(r, method, r.object(method).type, 'onKeyUp', [TEXT, SPANNABLE, 'I', 'Landroid/view/KeyEvent;'], 'Z', [self, text, code, event]))) return 1;
    return r.dispatch({ owner: VIEW, name: 'onKeyUp', parameters: ['I', 'Landroid/view/KeyEvent;'], result: 'Z', signature: '(ILandroid/view/KeyEvent;)Z' }, [self, code, event], 'direct');
  });
  def(TEXT, 'didTouchFocusSelect', '()Z', () => 0);
  def(TEXT, 'onPreDraw', '()Z', () => 1);
  def(TEXT, 'setSpannableFactory', '(Landroid/text/Spannable$Factory;)V', (r, _m, [self, factory]) => { if (nullish(factory)) r.throwJava('Ljava/lang/NullPointerException;', null); tv(r, self).spannableFactory = factory; call(r, self, TEXT, 'setText', [CHARS], 'V', [call(r, self, TEXT, 'getText', [], CHARS)]); });
  def(TEXT, 'setScroller', '(Landroid/widget/Scroller;)V', (r, _m, [self, scroller]) => { tv(r, self).scroller = nullish(scroller) ? null : scroller; });
  def(TEXT, 'setError', `(${CHARS})V`, (r, _m, [self, error]) => call(r, self, TEXT, 'setError', [CHARS, DRAWABLE], 'V', [error, null]));
  def(TEXT, 'setError', `(${CHARS}${DRAWABLE})V`, (r, _m, [self, error, icon]) => {   // the error text is kept and readable; the error popup and icon belong to the window surface the virtual device does not draw
    const s = tv(r, self), text = nullish(error) ? null : callStatic(r, 'Landroid/text/TextUtils;', 'stringOrSpannedString', [CHARS], CHARS, [error]);
    s.error = text; s.errorIcon = nullish(icon) ? null : icon;
    if (text !== null) r.record(`LOG W TextView: setError("${csString(r, text)}") kept; the error popup / icon is not drawn by the virtual window`);
  });
  def(TEXT, 'getError', `()${CHARS}`, (r, _m, [self]) => tv(r, self).error ?? null);
  def(TEXT, 'getTextDirectionHeuristic', '()Landroid/text/TextDirectionHeuristic;', (r, _m, [self]) => {
    const rtl = call(r, self, VIEW, 'getLayoutDirection', [], 'I') === 1;
    const names = { 1: 'FIRSTSTRONG_', 2: 'ANYRTL_LTR', 3: 'LTR', 4: 'RTL', 5: 'LOCALE', 6: 'FIRSTSTRONG_', 7: 'FIRSTSTRONG_' };
    const direction = call(r, self, VIEW, 'getTextDirection', [], 'I');
    let name = direction === 1 ? (rtl ? 'FIRSTSTRONG_RTL' : 'FIRSTSTRONG_LTR') : direction === 2 ? 'ANYRTL_LTR' : direction === 3 ? 'LTR' : direction === 4 ? 'RTL' : direction === 5 ? 'LOCALE' : direction === 6 ? 'FIRSTSTRONG_LTR' : direction === 7 ? 'FIRSTSTRONG_RTL' : (rtl ? 'FIRSTSTRONG_RTL' : 'FIRSTSTRONG_LTR');
    void names; return staticField(r, 'Landroid/text/TextDirectionHeuristics;', name, 'Landroid/text/TextDirectionHeuristic;');
  });
  def(TEXT, 'getTextMetricsParams', '()Landroid/text/PrecomputedText$Params;', (r, _m, [self]) => {
    const Params = 'Landroid/text/PrecomputedText$Params;', Builder = 'Landroid/text/PrecomputedText$Params$Builder;', s = tv(r, self);
    const b = construct(r, Builder, [PAINT], [call(r, self, TEXT, 'getPaint', [], TEXT_PAINT)]);
    call(r, b, Builder, 'setBreakStrategy', ['I'], Builder, [s.breakStrategy]); call(r, b, Builder, 'setHyphenationFrequency', ['I'], Builder, [s.hyphenationFrequency]);
    call(r, b, Builder, 'setTextDirection', ['Landroid/text/TextDirectionHeuristic;'], Builder, [call(r, self, TEXT, 'getTextDirectionHeuristic', [], 'Landroid/text/TextDirectionHeuristic;')]);
    return call(r, b, Builder, 'build', [], Params);
  });
  def(TEXT, 'setTextMetricsParams', '(Landroid/text/PrecomputedText$Params;)V', (r, _m, [self, params]) => {
    const Params = 'Landroid/text/PrecomputedText$Params;', paint = call(r, self, TEXT, 'getPaint', [], TEXT_PAINT);
    call(r, paint, PAINT, 'set', [PAINT], 'V', [call(r, params, Params, 'getTextPaint', [], TEXT_PAINT)]);
    const s = tv(r, self); s.breakStrategy = call(r, params, Params, 'getBreakStrategy', [], 'I'); s.hyphenationFrequency = call(r, params, Params, 'getHyphenationFrequency', [], 'I');
    const dir = call(r, params, Params, 'getTextDirection', [], 'Landroid/text/TextDirectionHeuristic;'); if (!nullish(dir)) s.textDirectionHeuristic = dir; relayout(r, self);
  });
  for (const [set, get, key] of [['setCustomSelectionActionModeCallback', 'getCustomSelectionActionModeCallback', 'customSelectionCallback'], ['setCustomInsertionActionModeCallback', 'getCustomInsertionActionModeCallback', 'customInsertionCallback']]) {
    def(TEXT, set, '(Landroid/view/ActionMode$Callback;)V', (r, _m, [self, callback]) => { tv(r, self)[key] = nullish(callback) ? null : callback; });
    def(TEXT, get, '()Landroid/view/ActionMode$Callback;', (r, _m, [self]) => tv(r, self)[key] ?? null);
  }
  for (const [Name, key] of [['TextCursorDrawable', 'textCursorDrawable'], ['TextSelectHandle', 'textSelectHandle'], ['TextSelectHandleLeft', 'textSelectHandleLeft'], ['TextSelectHandleRight', 'textSelectHandleRight']]) {
    def(TEXT, `set${Name}`, `(${DRAWABLE})V`, (r, _m, [self, d]) => { tv(r, self)[key] = nullish(d) ? null : d; tv(r, self)[key + 'Res'] = 0; platform.requestDraw?.(r, self); });
    def(TEXT, `set${Name}`, '(I)V', (r, _m, [self, id]) => { tv(r, self)[key + 'Res'] = id; tv(r, self)[key] = id === 0 ? null : call(r, call(r, self, VIEW, 'getContext', [], CONTEXT), CONTEXT, 'getDrawable', ['I'], DRAWABLE, [id]); platform.requestDraw?.(r, self); });
    def(TEXT, `get${Name}`, `()${DRAWABLE}`, (r, _m, [self]) => {   // the Drawable set, else the one of the resource the constructor read (android:textCursorDrawable, android:textSelectHandle*), loaded on first use
      const s = tv(r, self); if (nullish(s[key]) && s[key + 'Res']) s[key] = call(r, call(r, self, VIEW, 'getContext', [], CONTEXT), CONTEXT, 'getDrawable', ['I'], DRAWABLE, [s[key + 'Res']]);
      return s[key] ?? null;
    });
  }
  def(TEXT, 'moveCursorToVisibleOffset', '()Z', (r, _m, [self]) => {   // TextView.moveCursorToVisibleOffset: only an Editable with a collapsed selection can have its cursor moved into the visible lines
    const text = call(r, self, TEXT, 'getText', [], CHARS); if (nullish(text) || typeof text === 'string' || !r.isSubtype(r.object(text).type, SPANNABLE)) return 0;
    const start = call(r, self, TEXT, 'getSelectionStart', [], 'I'), end = call(r, self, TEXT, 'getSelectionEnd', [], 'I'); return start !== end || start < 0 ? 0 : 0;
  });
  def(TEXT, 'bringPointIntoView', '(I)Z', (r, _m, [self, offset]) => {   // TextView.bringPointIntoView: scrolls so the offset's line is visible; reports whether it scrolled
    const layout = call(r, self, TEXT, 'getLayout', [], LAYOUT); if (nullish(layout)) return 0;
    const line = call(r, layout, LAYOUT, 'getLineForOffset', ['I'], 'I', [offset]), top = call(r, layout, LAYOUT, 'getLineTop', ['I'], 'I', [line]), bottom = call(r, layout, LAYOUT, 'getLineTop', ['I'], 'I', [line + 1]);
    const viewHeight = call(r, self, VIEW, 'getHeight', [], 'I') - call(r, self, TEXT, 'getCompoundPaddingTop', [], 'I') - call(r, self, TEXT, 'getCompoundPaddingBottom', [], 'I'), scrollY = call(r, self, VIEW, 'getScrollY', [], 'I');
    let target = scrollY; if (top < scrollY) target = top; else if (bottom > scrollY + viewHeight) target = bottom - viewHeight;
    if (target === scrollY) return 0; call(r, self, VIEW, 'scrollTo', ['I', 'I'], 'V', [call(r, self, VIEW, 'getScrollX', [], 'I'), target]); return 1;
  });

  // ---- layout and the queries answered from it ---------------------------------------------------------------------------------------------------------------------------------------------------------
  const layoutWidth = (r, self) => call(r, self, VIEW, 'getMeasuredWidth', [], 'I') - compoundPad(r, self, 'left') - compoundPad(r, self, 'right');
  /**
   * The Layout TextView.makeSingleLayout builds for the text (or the hint of an empty TextView) at `width` pixels (the view's width inside its compound padding): the original
   * StaticLayout with the TextView's paint, alignment, spacing, break strategy, hyphenation frequency, justification, line-break configuration, line limit and ellipsis.
   * Kept until one of its inputs changes.
   */
  /** The gravity the text is laid out with: the TextView's own, else its style's (a Button's text is centred). */
  const layoutGravity = (r, self) => { const view = r.object(self); if (view.gravity != null) return view.gravity; try { return platform.composeCanvasHost?.textGravity?.(r, self) ?? 0x800033; } catch (error) { if (error?.name === 'JavaException') throw error; return 0x800033; } };
  /** mTransformed, or the hint of an empty TextView: the characters the Layout is built from. */
  const shownText = (r, self) => {
    const view = r.object(self), text = call(r, self, TEXT, 'getText', [], CHARS), raw = csString(r, text);
    // The transformation method's text (all caps, single line, password): the platform keeps it as a string (view.displayText); a text with spans is laid out as it is.
    const transformed = view.displayText != null && String(view.displayText) !== raw && (typeof text === 'string' || nullish(text) || isEditText(r, self) || !r.isSubtype(r.object(text).type, 'Landroid/text/Spanned;')) ? String(view.displayText) : text;
    return nullish(text) || raw === '' ? (view.hint ?? '') : transformed;
  };
  /** Layout.getDesiredWidth(mTransformed, mTextPaint): the width of the widest line when nothing wraps it (TextView.onMeasure for a text that is not boring). */
  registry.desiredTextWidth = (r, self) => { syncPaint(r, self); return i2f(callStatic(r, LAYOUT, 'getDesiredWidth', [CHARS, TEXT_PAINT], 'F', [shownText(r, self), paintOf(r, self)])); };
  const layoutFor = (r, self, innerWidth) => {
    const view = r.object(self), s = tv(r, self);
    let width = Math.max(0, innerWidth);
    const shown = shownText(r, self);
    const singleLine = !!view.singleLine || !!view.horizontallyScrolling, ellipsisWidth = width; if (singleLine) width = Math.max(width, 1024 * 1024);   // VERY_WIDE: a horizontally scrolling text is laid out unbounded
    const typeface = view.typeface ?? null, gravity = layoutGravity(r, self);
    const key = JSON.stringify([csString(r, shown), width, ellipsisWidth, s.lineSpacingExtra, s.lineSpacingMult, s.breakStrategy, s.hyphenationFrequency, s.justificationMode, s.lineBreakStyle, s.lineBreakWordStyle, s.letterSpacing, s.textScaleX, csString(r, s.fontFeatureSettings), typeface?.ref ?? null,
      s.shadowRadius, s.shadowDx, s.shadowDy, s.shadowColor, s.includeFontPadding, s.fallbackLineSpacing, view.maxLines ?? null, !!view.singleLine, view.textSize ?? null, gravity, view.layoutDirection ?? 0, nullish(s.ellipsize) ? null : r.object(s.ellipsize).enumName ?? true, s.marqueeFadeMode ?? 0, typeof r.icuBreakBackend?.breaks === 'function', !!s.layoutLineBreakOff, view.textColor ?? null, typeof shown === 'object' && shown !== null ? shown.ref ?? null : null]);   // the CharSequence itself too: the same characters with other spans are another layout
    if (s.layoutKey === key && s.layout) return s.layout;
    syncPaint(r, self);
    const paint = paintOf(r, self), len = csString(r, shown).length, gravityH = gravity & 0x800007, rtl = call(r, self, VIEW, 'getLayoutDirection', [], 'I') === 1;
    const alignName = gravityH === 0x800003 ? 'ALIGN_NORMAL' : gravityH === 0x800005 ? 'ALIGN_OPPOSITE' : gravityH === 3 ? (rtl ? 'ALIGN_OPPOSITE' : 'ALIGN_NORMAL') : gravityH === 5 ? (rtl ? 'ALIGN_NORMAL' : 'ALIGN_OPPOSITE') : (gravityH & 7) === 1 ? 'ALIGN_CENTER' : 'ALIGN_NORMAL';
    const AL = 'Landroid/text/Layout$Alignment;', CONFIG = 'Landroid/graphics/text/LineBreakConfig;';
    let b = callStatic(r, STATIC_LAYOUT.slice(0, -1) + '$Builder;', 'obtain', [CHARS, 'I', 'I', TEXT_PAINT, 'I'], BUILDER, [shown, 0, len, paint, width]);
    const step = (name, parameters, args) => { b = call(r, b, BUILDER, name, parameters, BUILDER, args); };
    step('setAlignment', [AL], [staticField(r, 'Landroid/text/Layout$Alignment;', alignName)]);
    step('setLineSpacing', ['F', 'F'], [f2i(s.lineSpacingExtra), f2i(s.lineSpacingMult)]); step('setIncludePad', ['Z'], [s.includeFontPadding ? 1 : 0]); step('setUseLineSpacingFromFallbacks', ['Z'], [s.fallbackLineSpacing ? 1 : 0]);
    // An optimal strategy the constructor read (the layout XML, or the default TextView style, which asks for high_quality) needs the ICU line-break iterator; where it is
    // not loaded the text is broken greedily, which the measure pass reports (view-layout-host.js). A strategy the app set from code is not replaced: it fails by name.
    const fromXml = s.xmlBreakStrategy === s.breakStrategy && !!s.xmlGiven?.get('breakStrategy'), strategy = s.breakStrategy > 0 && fromXml && typeof r.icuBreakBackend?.breaks !== 'function' ? 0 : s.breakStrategy;
    step('setBreakStrategy', ['I'], [strategy]); step('setHyphenationFrequency', ['I'], [s.hyphenationFrequency]); step('setJustificationMode', ['I'], [s.justificationMode]);
    if ((s.lineBreakStyle !== 0 || s.lineBreakWordStyle !== 0) && !s.layoutLineBreakOff && r.classes.has(CONFIG)) step('setLineBreakConfig', [CONFIG], [callStatic(r, CONFIG, 'getLineBreakConfig', ['I', 'I'], CONFIG, [s.lineBreakStyle, s.lineBreakWordStyle])]);
    step('setTextDirection', ['Landroid/text/TextDirectionHeuristic;'], [call(r, self, TEXT, 'getTextDirectionHeuristic', [], 'Landroid/text/TextDirectionHeuristic;')]);
    if (s.ellipsize) {
      // TextView.makeNewLayout: a marquee that switches to an ellipsis at rest (MARQUEE_FADE_SWITCH_SHOW_ELLIPSIS, a device without the fading marquee) is laid out with END_SMALL
      const TRUNCATE = 'Landroid/text/TextUtils$TruncateAt;', effective = r.object(s.ellipsize).enumName === 'MARQUEE' && s.marqueeFadeMode === 1 ? staticField(r, TRUNCATE, 'END_SMALL') : s.ellipsize;
      step('setEllipsize', [TRUNCATE], [effective]); step('setEllipsizedWidth', ['I'], [ellipsisWidth]);
    }
    const maxLines = view.singleLine ? 1 : view.maxLines; if (maxLines != null) step('setMaxLines', ['I'], [maxLines]);
    s.layout = call(r, b, BUILDER, 'build', [], STATIC_LAYOUT); s.layoutKey = key; return s.layout;
  };
  registry.layoutFor = layoutFor; registry.layoutGravity = layoutGravity;
  /** The TextView's TextPaint with the TextView's current size, typeface, colour, spacing, scale, font features and shadow. */
  registry.syncedPaint = (r, self) => { syncPaint(r, self); return paintOf(r, self); };
  def(TEXT, 'getLayout', `()${LAYOUT}`, (r, _m, [self]) => {
    if (!r.object(self).measuredDimensionSet) return null;                       // TextView builds its layout in onMeasure: before that getLayout() is null
    return layoutFor(r, self, layoutWidth(r, self));
  });
  def(TEXT, 'getLineCount', '()I', (r, _m, [self]) => { const layout = call(r, self, TEXT, 'getLayout', [], LAYOUT); return nullish(layout) ? 0 : call(r, layout, LAYOUT, 'getLineCount', [], 'I'); });
  def(TEXT, 'getLineBounds', `(I${RECT})I`, (r, _m, [self, line, bounds]) => {
    const layout = call(r, self, TEXT, 'getLayout', [], LAYOUT);
    if (nullish(layout)) { if (!nullish(bounds)) call(r, bounds, RECT, 'set', ['I', 'I', 'I', 'I'], 'V', [0, 0, 0, 0]); return 0; }
    const baseline = call(r, layout, LAYOUT, 'getLineBounds', ['I', RECT], 'I', [line, bounds]);
    let voffset = call(r, self, TEXT, 'getExtendedPaddingTop', [], 'I'); if ((gravityOf(r, self) & 0x70) !== 0x30) voffset += vOffset(r, self);
    if (!nullish(bounds)) call(r, bounds, RECT, 'offset', ['I', 'I'], 'V', [call(r, self, TEXT, 'getCompoundPaddingLeft', [], 'I'), voffset]);
    return baseline + voffset;
  });
  def(TEXT, 'getOffsetForPosition', '(FF)I', (r, _m, [self, xBits, yBits]) => {
    const layout = call(r, self, TEXT, 'getLayout', [], LAYOUT); if (nullish(layout)) return -1;
    let y = i2f(yBits) - call(r, self, TEXT, 'getTotalPaddingTop', [], 'I'); y = Math.max(0, y); y = Math.min(call(r, self, VIEW, 'getHeight', [], 'I') - call(r, self, TEXT, 'getTotalPaddingBottom', [], 'I') - 1, y); y += call(r, self, VIEW, 'getScrollY', [], 'I');
    const line = call(r, layout, LAYOUT, 'getLineForVertical', ['I'], 'I', [Math.trunc(y)]);
    let x = i2f(xBits) - call(r, self, TEXT, 'getTotalPaddingLeft', [], 'I'); x = Math.max(0, x); x = Math.min(call(r, self, VIEW, 'getWidth', [], 'I') - call(r, self, TEXT, 'getTotalPaddingRight', [], 'I') - 1, x); x += call(r, self, VIEW, 'getScrollX', [], 'I');
    return call(r, layout, LAYOUT, 'getOffsetForHorizontal', ['I', 'F'], 'I', [line, f2i(x)]);
  });

  // ---- text appearance, auto-size -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const R_STYLEABLE = 'Lcom/android/internal/R$styleable;', TYPED_ARRAY = 'Landroid/content/res/TypedArray;';
  const TA = { textSize: 0, typeface: 1, textStyle: 2, textColor: 3, textColorHighlight: 4, textColorHint: 5, textColorLink: 6, shadowColor: 7, shadowDx: 8, shadowDy: 9, shadowRadius: 10, textAllCaps: 11, fontFamily: 12, elegantTextHeight: 13, letterSpacing: 14, fontFeatureSettings: 15, fontVariationSettings: 16, fallbackLineSpacing: 17, textFontWeight: 18 };
  def(TEXT, 'setTextAppearance', '(I)V', (r, _m, [self, resId]) => call(r, self, TEXT, 'setTextAppearance', [CONTEXT, 'I'], 'V', [call(r, self, VIEW, 'getContext', [], CONTEXT), resId]));
  def(TEXT, 'setTextAppearance', `(${CONTEXT}I)V`, (r, _m, [self, context, resId]) => {   // TextView.setTextAppearance: read R.styleable.TextAppearance from the style, then apply what it sets
    const ids = r.readStatic({ owner: R_STYLEABLE, name: 'TextAppearance', type: '[I', key: `${R_STYLEABLE}->TextAppearance:[I` });
    const a = call(r, context, CONTEXT, 'obtainStyledAttributes', ['I', '[I'], TYPED_ARRAY, [resId, ids]);
    try {
      const has = i => flag(call(r, a, TYPED_ARRAY, 'hasValue', ['I'], 'Z', [i]));
      if (has(TA.textColor)) call(r, self, TEXT, 'setTextColor', [TINT], 'V', [call(r, a, TYPED_ARRAY, 'getColorStateList', ['I'], TINT, [TA.textColor])]);
      if (has(TA.textColorHint)) call(r, self, TEXT, 'setHintTextColor', [TINT], 'V', [call(r, a, TYPED_ARRAY, 'getColorStateList', ['I'], TINT, [TA.textColorHint])]);
      if (has(TA.textColorLink)) call(r, self, TEXT, 'setLinkTextColor', [TINT], 'V', [call(r, a, TYPED_ARRAY, 'getColorStateList', ['I'], TINT, [TA.textColorLink])]);
      if (has(TA.textColorHighlight)) call(r, self, TEXT, 'setHighlightColor', ['I'], 'V', [call(r, a, TYPED_ARRAY, 'getColor', ['I', 'I'], 'I', [TA.textColorHighlight, 0])]);
      if (has(TA.textSize)) { const px = call(r, a, TYPED_ARRAY, 'getDimensionPixelSize', ['I', 'I'], 'I', [TA.textSize, -1]); if (px !== -1) call(r, self, TEXT, 'setTextSize', ['I', 'F'], 'V', [0, f2i(px)]); }
      const style = has(TA.textStyle) ? call(r, a, TYPED_ARRAY, 'getInt', ['I', 'I'], 'I', [TA.textStyle, 0]) : 0, index = has(TA.typeface) ? call(r, a, TYPED_ARRAY, 'getInt', ['I', 'I'], 'I', [TA.typeface, -1]) : -1;
      // TextView.readTextAppearance: a font resource (TypedArray.getFont) wins; any other fontFamily value is a family name (getString); textFontWeight picks Typeface.create(tf, weight, italic)
      const weight = has(TA.textFontWeight) ? call(r, a, TYPED_ARRAY, 'getInt', ['I', 'I'], 'I', [TA.textFontWeight, -1]) : -1;
      let typeface = null, family = null;
      if (has(TA.fontFamily)) {
        try { typeface = call(r, a, TYPED_ARRAY, 'getFont', ['I'], 'Landroid/graphics/Typeface;', [TA.fontFamily]); }
        catch (error) { if (!(error?.name === 'JavaException' && r.isSubtype(r.typeOf(error.value), 'Landroid/content/res/Resources$NotFoundException;') || error?.name === 'JavaException' && r.isSubtype(r.typeOf(error.value), 'Ljava/lang/UnsupportedOperationException;'))) throw error; }
        if (nullish(typeface)) { typeface = null; family = call(r, a, TYPED_ARRAY, 'getString', ['I'], STRING, [TA.fontFamily]); if (nullish(family)) family = null; }
      }
      if (typeface !== null || family !== null || index !== -1 || style !== 0 || weight >= 0) platform.typefaceBuilder.applyTextViewFont(r, self, { typeface, familyName: family === null ? null : r.stringCharacters(family), typefaceIndex: index, style, weight });
      if (has(TA.shadowColor)) {
        const color = call(r, a, TYPED_ARRAY, 'getInt', ['I', 'I'], 'I', [TA.shadowColor, 0]);
        if (color !== 0) call(r, self, TEXT, 'setShadowLayer', ['F', 'F', 'F', 'I'], 'V', [call(r, a, TYPED_ARRAY, 'getFloat', ['I', 'F'], 'F', [TA.shadowRadius, 0]), call(r, a, TYPED_ARRAY, 'getFloat', ['I', 'F'], 'F', [TA.shadowDx, 0]), call(r, a, TYPED_ARRAY, 'getFloat', ['I', 'F'], 'F', [TA.shadowDy, 0]), color]);
      }
      if (has(TA.textAllCaps) && flag(call(r, a, TYPED_ARRAY, 'getBoolean', ['I', 'Z'], 'Z', [TA.textAllCaps, 0]))) call(r, self, TEXT, 'setAllCaps', ['Z'], 'V', [1]);
      if (has(TA.elegantTextHeight)) call(r, self, TEXT, 'setElegantTextHeight', ['Z'], 'V', [call(r, a, TYPED_ARRAY, 'getBoolean', ['I', 'Z'], 'Z', [TA.elegantTextHeight, 0])]);
      if (has(TA.fallbackLineSpacing)) call(r, self, TEXT, 'setFallbackLineSpacing', ['Z'], 'V', [call(r, a, TYPED_ARRAY, 'getBoolean', ['I', 'Z'], 'Z', [TA.fallbackLineSpacing, 0])]);
      if (has(TA.letterSpacing)) call(r, self, TEXT, 'setLetterSpacing', ['F'], 'V', [call(r, a, TYPED_ARRAY, 'getFloat', ['I', 'F'], 'F', [TA.letterSpacing, 0])]);
      if (has(TA.fontFeatureSettings)) call(r, self, TEXT, 'setFontFeatureSettings', [STRING], 'V', [call(r, a, TYPED_ARRAY, 'getString', ['I'], STRING, [TA.fontFeatureSettings])]);
      if (has(TA.fontVariationSettings)) call(r, self, TEXT, 'setFontVariationSettings', [STRING], 'Z', [call(r, a, TYPED_ARRAY, 'getString', ['I'], STRING, [TA.fontVariationSettings])]);
    } finally { call(r, a, TYPED_ARRAY, 'recycle'); }
  });
  // auto-size (TextView.setAutoSizeText*): the configuration is validated and kept like AOSP's AutoSizeTextViewParams; the size search (TextView.autoSizeText) runs in the native measure (view-layout-host.js)
  const AUTOSIZE = { type: 0, min: -1, max: -1, step: -1, presets: null };
  const autoSize = (r, self) => tv(r, self).autoSize ??= { ...AUTOSIZE };
  def(TEXT, 'getAutoSizeTextType', '()I', (r, _m, [self]) => autoSize(r, self).type);
  def(TEXT, 'setAutoSizeTextTypeWithDefaults', '(I)V', (r, _m, [self, type]) => {
    const a = autoSize(r, self);
    if (type === 0) { Object.assign(a, AUTOSIZE); }
    else if (type === 1) {   // AUTO_SIZE_TEXT_TYPE_UNIFORM: min 12sp, max 112sp, granularity 1px
      const metrics = call(r, resources(r, self), 'Landroid/content/res/Resources;', 'getDisplayMetrics', [], 'Landroid/util/DisplayMetrics;'), scaled = r.object(metrics).fields.get('Landroid/util/DisplayMetrics;->scaledDensity:F') ?? f2i(1);
      Object.assign(a, { type: 1, min: Math.round(12 * i2f(scaled)), max: Math.round(112 * i2f(scaled)), step: 1, presets: null });
    } else r.throwJava('Ljava/lang/IllegalArgumentException;', `Unknown auto-size text type: ${type}`);
    relayout(r, self);
  });
  def(TEXT, 'setAutoSizeTextTypeUniformWithConfiguration', '(IIII)V', (r, _m, [self, min, max, step, unit]) => {
    const toPx = v => Math.round(v * ([1, 0, 0, 0, 0, 0][unit] ?? 1)); void toPx;
    if (min <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `Minimum auto-size text size (${min}px) is less or equal to (0px)`);
    if (max <= min) r.throwJava('Ljava/lang/IllegalArgumentException;', `Maximum auto-size text size (${max}px) is less or equal to minimum auto-size text size (${min}px)`);
    if (step <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `The auto-size step granularity (${step}px) is less or equal to (0px)`);
    Object.assign(autoSize(r, self), { type: 1, min, max, step, presets: null }); relayout(r, self);
  });
  def(TEXT, 'setAutoSizeTextTypeUniformWithPresetSizes', '([II)V', (r, _m, [self, sizes]) => {
    const values = nullish(sizes) ? [] : [...r.array(sizes).elements];
    if (values.length > 0) { for (const v of values) if (v <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `All preset sizes must be > 0: ${v}`); }
    Object.assign(autoSize(r, self), { type: values.length ? 1 : 0, min: -1, max: -1, step: -1, presets: values.length ? [...new Set(values)].sort((a, b) => a - b) : null }); relayout(r, self);
  });
  def(TEXT, 'getAutoSizeMinTextSize', '()I', (r, _m, [self]) => { const a = autoSize(r, self); return a.presets ? a.presets[0] : Math.round(a.min); });
  def(TEXT, 'getAutoSizeMaxTextSize', '()I', (r, _m, [self]) => { const a = autoSize(r, self); return a.presets ? a.presets.at(-1) : Math.round(a.max); });
  def(TEXT, 'getAutoSizeStepGranularity', '()I', (r, _m, [self]) => Math.round(autoSize(r, self).step));
  /**
   * The auto-size part of the TextView constructor: android:autoSizePresetSizes (cleanupAutoSizePresetSizes: sorted, positive, without duplicates) or the uniform configuration,
   * where what the attributes left out is 12sp, 112sp and 1px (validateAndSetAutoSizeTextTypeUniformConfiguration: the original's IllegalArgumentExceptions). An EditText does
   * not auto-size (supportsAutoSizeText).
   */
  registry.autoSizeFromAttributes = (r, self, { type, min, max, step, presets }) => {
    const a = autoSize(r, self);
    if (isEditText(r, self)) { Object.assign(a, AUTOSIZE); return; }
    const cleaned = presets ? [...new Set(presets.filter(size => size > 0))].sort((x, y) => x - y) : [];
    if (cleaned.length) { Object.assign(a, { type: 1, min: -1, max: -1, step: -1, presets: cleaned }); return; }
    if (type !== 1) { a.type = type; return; }
    const metrics = call(r, resources(r, self), 'Landroid/content/res/Resources;', 'getDisplayMetrics', [], 'Landroid/util/DisplayMetrics;'), scaled = i2f(r.object(metrics).fields.get('Landroid/util/DisplayMetrics;->scaledDensity:F') ?? f2i(1));
    if (min === -1) min = 12 * scaled; if (max === -1) max = 112 * scaled; if (step === -1) step = 1;
    const px = value => Number.isInteger(value) ? value.toFixed(1) : String(value);
    if (min <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `Minimum auto-size text size (${px(min)}px) is less or equal to (0px)`);
    if (max <= min) r.throwJava('Ljava/lang/IllegalArgumentException;', `Maximum auto-size text size (${px(max)}px) is less or equal to minimum auto-size text size (${px(min)}px)`);
    if (step <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', `The auto-size step granularity (${px(step)}px) is less or equal to (0px)`);
    Object.assign(a, { type: 1, min, max, step, presets: null });
  };
  /** The sizes the auto-size search chooses among (TextView.mAutoSizeTextSizesInPx), ascending, or null when the TextView does not auto-size (an EditText never does). */
  registry.autoSizeSizes = (r, self) => {
    const a = r.object(self).tv?.autoSize; if (!a || a.type !== 1 || isEditText(r, self)) return null;
    const sizes = a.presets ?? (a.step > 0 ? Array.from({ length: Math.floor((a.max - a.min) / a.step) + 1 }, (_, i) => Math.round(a.min + i * a.step)) : []);
    return sizes.filter(size => size > 0 && size <= 512);   // the text backend's largest font
  };
  def(TEXT, 'getAutoSizeTextAvailableSizes', '()[I', (r, _m, [self]) => {
    const a = autoSize(r, self), sizes = a.presets ?? (a.type === 1 && a.step > 0 ? Array.from({ length: Math.floor((a.max - a.min) / a.step) + 1 }, (_, i) => Math.round(a.min + i * a.step)) : []);
    const array = r.newArray('[I', sizes.length); r.array(array).elements = sizes; return array;
  });
  def(TEXT, 'getTextSize', '()F', (r, _m, [self]) => f2i(r.object(self).textSize ?? 14));   // the native text path's default size (the theme's 14) when none was set


  // ---- input type and hint ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  def(TEXT, 'setHint', '(I)V', (r, _m, [self, resid]) => call(r, self, TEXT, 'setHint', [CHARS], 'V', [call(r, resources(r, self), 'Landroid/content/res/Resources;', 'getText', ['I'], CHARS, [resid])]));
  const passwordType = type => { const v = type & 0xfff; return v === (1 | 0x80) || v === (1 | 0xe0) || v === (2 | 0x10); };
  const visiblePasswordType = type => (type & 0xfff) === (1 | 0x90);
  const multilineType = type => (type & (0xf | 0x20000)) === (1 | 0x20000);
  const KL = 'Landroid/text/method/KeyListener;', TM = 'Landroid/text/method/TransformationMethod;';
  /** TextView.setInputType(type, direct): the KeyListener the input class implies. */
  const keyListenerFor = (r, type) => {
    const cls = type & 0xf, keyListenerOf = (owner, name, parameters = [], args = []) => callStatic(r, owner, name, parameters, owner, args);
    if (cls === 1) {
      const cap = (type & 0x1000) ? 'CHARACTERS' : (type & 0x2000) ? 'WORDS' : (type & 0x4000) ? 'SENTENCES' : 'NONE', C = 'Landroid/text/method/TextKeyListener$Capitalize;';
      return callStatic(r, 'Landroid/text/method/TextKeyListener;', 'getInstance', ['Z', C], 'Landroid/text/method/TextKeyListener;', [(type & 0x8000) ? 1 : 0, staticField(r, C, cap)]);
    }
    if (cls === 2) return callStatic(r, 'Landroid/text/method/DigitsKeyListener;', 'getInstance', ['Z', 'Z'], 'Landroid/text/method/DigitsKeyListener;', [(type & 0x1000) ? 1 : 0, (type & 0x2000) ? 1 : 0]);
    if (cls === 4) { const v = type & 0xff0; return v === 0x10 ? keyListenerOf('Landroid/text/method/DateKeyListener;', 'getInstance') : v === 0x20 ? keyListenerOf('Landroid/text/method/TimeKeyListener;', 'getInstance') : keyListenerOf('Landroid/text/method/DateTimeKeyListener;', 'getInstance'); }
    if (cls === 3) return keyListenerOf('Landroid/text/method/DialerKeyListener;', 'getInstance');
    return callStatic(r, 'Landroid/text/method/TextKeyListener;', 'getInstance', [], 'Landroid/text/method/TextKeyListener;');
  };
  /** For the constructor pass: the listener and the input type that setInputType(type, true) leaves on the Editor. */
  registry.keyListenerFor = (r, _self, type) => ({ listener: keyListenerFor(r, type), type });
  registry.state = (r, self) => tv(r, self);
  def(TEXT, 'setInputType', '(I)V', (r, _m, [self, type]) => {   // TextView.setInputType: the key listener the type implies, password handling, single-line mode
    const before = call(r, self, TEXT, 'getInputType', [], 'I'), wasPassword = passwordType(before), wasVisiblePassword = visiblePasswordType(before);
    const input = keyListenerFor(r, type);
    call(r, self, TEXT, 'setKeyListener', [KL], 'V', [input]); call(r, self, TEXT, 'setRawInputType', ['I'], 'V', [type]);   // setKeyListener derives an input type from the listener; the requested one is what stays
    const isPassword = passwordType(type), isVisiblePassword = visiblePasswordType(type), view = r.object(self);
    const password = callStatic(r, 'Landroid/text/method/PasswordTransformationMethod;', 'getInstance', [], 'Landroid/text/method/PasswordTransformationMethod;');
    let force = false; const current = call(r, self, TEXT, 'getTransformationMethod', [], TM);
    const TF = 'Landroid/graphics/Typeface;';
    if (isPassword) { call(r, self, TEXT, 'setTransformationMethod', [TM], 'V', [password]); call(r, self, TEXT, 'setTypeface', [TF], 'V', [staticField(r, TF, 'MONOSPACE')]); }
    else if (isVisiblePassword) { if (current?.ref === password.ref) force = true; call(r, self, TEXT, 'setTypeface', [TF], 'V', [staticField(r, TF, 'MONOSPACE')]); }
    else if (wasPassword || wasVisiblePassword) { call(r, self, TEXT, 'setTypeface', [TF], 'V', [staticField(r, TF, 'DEFAULT')]); if (current?.ref === password.ref) force = true; }
    const singleLine = !multilineType(type);
    if (!!view.singleLine !== singleLine || force) {   // applySingleLine(singleLine, !isPassword, true)
      view.singleLine = singleLine;
      if (singleLine) { call(r, self, TEXT, 'setLines', ['I'], 'V', [1]); call(r, self, TEXT, 'setHorizontallyScrolling', ['Z'], 'V', [1]); if (!isPassword) call(r, self, TEXT, 'setTransformationMethod', [TM], 'V', [callStatic(r, 'Landroid/text/method/SingleLineTransformationMethod;', 'getInstance', [], 'Landroid/text/method/SingleLineTransformationMethod;')]); }
      else { call(r, self, TEXT, 'setMaxLines', ['I'], 'V', [INT_MAX]); call(r, self, TEXT, 'setHorizontallyScrolling', ['Z'], 'V', [0]); if (!isPassword) call(r, self, TEXT, 'setTransformationMethod', [TM], 'V', [null]); }
    }
    view.inputType = type;
  });

  // ---- renderer contract -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** Why the native text path cannot draw this TextView as AOSP would (a property set to a non-default value it has no support for), or null. */
  /** 'START' | 'MIDDLE' | 'END' | 'MARQUEE' or null: the TruncateAt the native text path ellipsizes with. */
  registry.ellipsizeKind = (r, self) => { const e = r.object(self).tv?.ellipsize; return nullish(e) ? null : r.object(e).enumName ?? null; };
  /**
   * TextView.startMarquee: a marquee runs while the view is focused or selected, has one line, and that line is wider than the view (canMarquee). `overflows` is null before
   * the text was measured. The scroll is an animation on the Choreographer (TextView.Marquee) that the native text path does not run: at rest, and for a text that fits,
   * the line is laid out unbounded and clipped at the view, as on a device.
   */
  registry.marqueeWouldRun = (r, self, overflows) => {
    const view = r.object(self), s = view.tv; if (!s || nullish(s.ellipsize) || r.object(s.ellipsize).enumName !== 'MARQUEE') return false;
    return !!(view.selected || view.focused) && nullish(view.keyListener) && overflows === true;
  };
  registry.breakStrategy = (r, self) => r.object(self).tv?.breakStrategy ?? 0;
  registry.hyphenationFrequency = (r, self) => r.object(self).tv?.hyphenationFrequency ?? 0;
  /**
   * What the native paragraph draws beyond the plain text: letter spacing (pixels), the shadow layer and the line spacing, or null when the TextView sets none of them or is
   * not drawn as a paragraph (an EditText is a page text field; a single-line, horizontally scrolling or ellipsized text is one measured run).
   */
  const paragraphOnly = (r, self) => { const view = r.object(self); return isEditText(r, self) || !!view.singleLine || !!view.horizontallyScrolling || !nullish(view.tv?.ellipsize); };
  /**
   * Why this TextView is measured and drawn by its original Layout (StaticLayout over the native measured text, Layout.draw on the Canvas) instead of the plain run or the
   * native paragraph, or null. The Layout applies what those two paths do not have: a horizontal text scale, OpenType feature settings, justification, a line-break
   * configuration, and letter spacing, a shadow layer, line spacing or an app / system font on a text that is single-line, horizontally scrolling or ellipsized.
   * An EditText and the label of a compound button are measured the same way; on the page they are the page's own elements, which draw the text themselves (pageTextStyle
   * below; unsupportedRendering names what they cannot).
   */
  /** The texts the page draws with its own elements: an EditText (the page's text field) and the label of a CheckBox, RadioButton or Switch. */
  const pageDrawn = (r, self) => isEditText(r, self) || r.isSubtype(r.object(self).type, 'Landroid/widget/CompoundButton;');
  registry.layoutDrawn = (r, self) => {
    const view = r.object(self), s = view.tv; if (!s || !r.classes.has(STATIC_LAYOUT)) return null;
    const edit = pageDrawn(r, self);
    if (s.textScaleX !== 1 && !edit) return 'textScaleX';
    if (!nullish(s.fontFeatureSettings) && csString(r, s.fontFeatureSettings) !== '') return 'fontFeatureSettings';
    if (s.justificationMode !== 0 && !edit) return 'justificationMode';
    if ((s.lineBreakStyle !== 0 || s.lineBreakWordStyle !== 0) && !edit) return 'lineBreak';
    if (!paragraphOnly(r, self)) return null;
    if (s.letterSpacing !== 0) return 'letterSpacing';
    if (s.shadowRadius !== 0) return 'shadowLayer';
    if ((s.lineSpacingExtra !== 0 || s.lineSpacingMult !== 1) && !view.singleLine && !isEditText(r, self)) return 'lineSpacing';
    if (!nullish(view.typeface) && r.skiaHost?.resolveTypeface?.(view.typeface).custom) return 'typeface';
    return null;
  };
  /**
   * What the page's text field shows of an EditText's text properties (and the page's label of a compound button's), with the CSS property of the same meaning: letter spacing (Paint.setLetterSpacing is in ems, as CSS
   * letter-spacing in em), the shadow layer (text-shadow), the OpenType feature settings (font-feature-settings) and the generic family of a serif or monospace system font.
   * null for every other View and for an EditText that sets none of them.
   */
  /**
   * The colour the page draws a TextView's own text (or its hint) in: TextView.getCurrentTextColor / getCurrentHintTextColor of the View's drawable state, from its own
   * ColorStateList or the one its constructor read from the style and theme (android:textColor="?android:attr/textColorPrimary", a text appearance, a selector with
   * android:alpha). '#aarrggbb', or null when the View keeps a plain colour of its own (exported as it is) or has none. The theme's list is looked up once per View.
   */
  registry.currentTextColor = (r, self, hint = false) => {
    const view = r.object(self), s = tv(r, self);
    if (!hint && view.textColor != null) return null;
    // the framework code run here is the host's lookup for the page, not the app's: it must not evict APK-visible trace entries
    const muted = r.traceMuted; r.traceMuted = true; let list, failure = null;
    try {
      try {
        if (hint) list = s.hintTextColors ?? (s.themeHintTextColors !== undefined ? s.themeHintTextColors : (s.themeHintTextColors = platform.composeCanvasHost?.themeHintTextColors?.(r, self) ?? null));
        else list = s.textColors ?? (s.themeTextColors !== undefined ? s.themeTextColors : (s.themeTextColors = platform.composeCanvasHost?.themeTextColors?.(r, self) ?? null));
      } catch (error) {   // a theme the style lookup cannot read: the page keeps its default colour, and the trace says why
        if (error?.name !== 'APKError' && error?.name !== 'JavaException') throw error;
        if (hint) s.themeHintTextColors = null; else s.themeTextColors = null; failure = String(error.message).slice(0, 200); list = null;
      }
      if (nullish(list)) return null;
      const state = call(r, self, VIEW, 'getDrawableState', [], '[I'), key = `${list.ref}|${state?.ref ?? 0}`, memo = hint ? 'hintColorMemo' : 'textColorMemo';
      if (s[memo]?.key === key) return s[memo].value;
      const value = argb(call(r, list, TINT, 'getColorForState', ['[I', 'I'], 'I', [state, call(r, list, TINT, 'getDefaultColor', [], 'I')]));
      s[memo] = { key, value }; return value;
    } finally {
      r.traceMuted = muted;
      if (failure !== null) { const seen = r.textColorFailures ??= new Set(); if (!seen.has(failure) && seen.size < 64) { seen.add(failure); r.record(`TEXT colour not resolved for the page (the page keeps its default): ${failure}`); } }   // once per cause
    }
  };
  registry.pageTextStyle = (r, self) => {
    const view = r.object(self), s = view.tv; if (!s || !pageDrawn(r, self)) return null;
    const features = nullish(s.fontFeatureSettings) ? [] : parseFontFeatureSettings(csString(r, s.fontFeatureSettings)).filter(feature => /^[A-Za-z0-9 ]{4}$/.test(feature.name));
    const face = !nullish(view.typeface) && r.skiaHost?.resolveTypeface ? r.skiaHost.resolveTypeface(view.typeface) : null, family = face?.system ? (face.family === 'serif' ? 'serif' : /monospace$/.test(face.family) ? 'monospace' : null) : null;
    if (s.letterSpacing === 0 && s.shadowRadius === 0 && !features.length && !family) return null;
    return { letterSpacing: s.letterSpacing, shadow: s.shadowRadius > 0 ? { radius: s.shadowRadius, dx: s.shadowDx, dy: s.shadowDy, color: s.shadowColor >>> 0 } : null, features, family };
  };
  registry.paragraphStyle = (r, self) => {
    const view = r.object(self), s = view.tv; if (!s || (s.letterSpacing === 0 && s.shadowRadius === 0 && s.lineSpacingExtra === 0 && s.lineSpacingMult === 1) || paragraphOnly(r, self)) return null;
    return { letterSpacing: s.letterSpacing * (view.textSize || 14), letterSpacingEm: s.letterSpacing, shadow: s.shadowRadius > 0 ? { radius: s.shadowRadius, dx: s.shadowDx, dy: s.shadowDy, color: s.shadowColor >>> 0 } : null,
      lineSpacing: s.lineSpacingExtra !== 0 || s.lineSpacingMult !== 1 ? { add: s.lineSpacingExtra, mult: s.lineSpacingMult } : null };
  };
  /**
   * Why the native text path cannot draw this TextView as AOSP would (a property set to a non-default value it has no support for), or null. A property the XML gave
   * (s.xmlGiven, kept by the constructor pass) never stops a pass: `tolerate(attribute, what)` is told and the text is drawn without it.
   */
  registry.unsupportedRendering = (r, self, tolerate = null) => {
    const s = r.object(self).tv; if (!s) return null;
    // An EditText is the page's text field, a one-line HTML input: it has no horizontal glyph scale, and nothing that needs more than one line (line spacing, justification, a
    // line-break configuration). Letter spacing, the shadow layer and font features it draws (pageTextStyle); every other text is drawn by its Layout (layoutDrawn).
    const field = isEditText(r, self), edit = pageDrawn(r, self), where = field ? ' on an EditText (the page text field is a one-line input)' : ' on the label of a CheckBox, RadioButton or Switch (the page draws the label itself)';
    const checks = [[(s.lineSpacingExtra !== 0 || s.lineSpacingMult !== 1) && field && !r.object(self).singleLine, 'lineSpacing' + where, ['lineSpacingExtra', 'lineSpacingMult']],
      [s.justificationMode !== 0 && edit, 'justificationMode' + where, ['justificationMode']],
      [s.textScaleX !== 1 && edit, 'textScaleX' + where, ['textScaleX']], [s.paint && (call(r, s.paint, PAINT, 'getFlags', [], 'I') & 0x38) !== 0, 'paintFlags (underline / strike-through / fake bold)', []],
      [(s.lineBreakStyle !== 0 || s.lineBreakWordStyle !== 0) && edit, 'lineBreak' + where, ['lineBreakStyle', 'lineBreakWordStyle']]];
    for (const [on, what, keys] of checks) {
      if (!on) continue;
      const given = tolerate ? keys.map(key => s.xmlGiven?.get(key)).find(Boolean) : null;
      if (given) tolerate(given, what); else return what;
    }
    return null;
  };
  const supports = registry.supports ? registry.supports.bind(registry) : null;
  registry.supports = key => !blocked.includes(key) && (supports ? supports(key) : true);
  return registry;
}
