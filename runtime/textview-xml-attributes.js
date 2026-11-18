import { floatBits, bitsFloat } from './host-contract.js?v=0eed5c4e54ff';

// The attribute pass of the android.widget.TextView and android.widget.CompoundButton constructors, as android-13.0.0_r1 runs it (TextView.java TextView(Context, AttributeSet,
// int, int), readTextAppearance, applyTextAppearance; CompoundButton.java CompoundButton(Context, AttributeSet, int, int)). EditText, Button and CheckBox read nothing of their
// own in that release: their constructors only pass another default style. The pass is a subclass pass of view-xml-attributes.js and uses its TypedArray reader:
//
//   1. R.styleable.TextViewAppearance names the text appearance style; R.styleable.TextAppearance is read from it into one set of text appearance values;
//   2. R.styleable.TextView is read from the tag, its style="", the default style and the theme; the attributes it shares with a text appearance override those values;
//   3. the rest of the switch runs in attribute-id order, and what the constructor does after the loop runs after it here: the input type and key listener, the compound
//      drawables, single line and ellipsize, the text appearance, the password transformation, the length filter, the text, the hint, the auto-size configuration, the baseline
//      distances and the line height.
//
// Values go through the TextView's own setters (textview-api-host.js, editable-text-host.js) or the state those keep, so the getter an app calls returns what the XML said.
// Three rules of this VM shape the pass:
//   - A value the native text path cannot draw (see textViewApi.unsupportedRendering: a measure pass stops with an explicit error for one set from code) is not kept: the attribute
//     is reported under "XML attributes NOT APPLIED" with what is missing, and the screen is inflated without it. An attribute never fails the inflation.
//   - What the lab gives a TextView that no attribute names stays as it was (the default text size, an EditText's key listener made on first use): the branches of the
//     constructor run for the attributes that are present.
//   - A value that is kept but changes nothing a user of this VM sees is reported under "accepted, no effect in this VM" when the tag itself carries it.
const TEXT = 'Landroid/widget/TextView;', VIEW = 'Landroid/view/View;', COMPOUND = 'Landroid/widget/CompoundButton;', EDIT = 'Landroid/widget/EditText;', TA = 'Landroid/content/res/TypedArray;';
const CHARS = 'Ljava/lang/CharSequence;', STRING = 'Ljava/lang/String;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', TINT = 'Landroid/content/res/ColorStateList;', BLEND = 'Landroid/graphics/BlendMode;';
const KEY_LISTENER = 'Landroid/text/method/KeyListener;', TRANSFORM = 'Landroid/text/method/TransformationMethod;', BUFFER = 'Landroid/widget/TextView$BufferType;', LOCALES = 'Landroid/os/LocaleList;';
const TRUNCATE = 'Landroid/text/TextUtils$TruncateAt;', MOVEMENT = 'Landroid/text/method/MovementMethod;', FILTER = 'Landroid/text/InputFilter;';
const ANDROID_NAMESPACE = 'http://schemas.android.com/apk/res/android';
const SWITCH = 'Landroid/widget/Switch;';

// R.styleable.TextAppearance, and the attributes of R.styleable.TextView that TextView.sAppearanceValues maps onto it (the same names).
export const TEXT_APPEARANCE_ATTRIBUTES = ['textColor', 'textSize', 'textStyle', 'textFontWeight', 'typeface', 'fontFamily', 'textLocale', 'textColorHighlight', 'textColorHint', 'textColorLink', 'textAllCaps',
  'shadowColor', 'shadowDx', 'shadowDy', 'shadowRadius', 'elegantTextHeight', 'fallbackLineSpacing', 'letterSpacing', 'fontFeatureSettings', 'fontVariationSettings', 'lineBreakStyle', 'lineBreakWordStyle'];
// R.styleable.TextView.
export const TEXT_VIEW_ATTRIBUTES = ['bufferType', 'text', 'hint', 'textColor', 'textColorHighlight', 'textColorHint', 'textAppearance', 'textSize', 'textScaleX', 'typeface', 'textStyle', 'textFontWeight',
  'fontFamily', 'textLocale', 'textColorLink', 'cursorVisible', 'maxLines', 'maxHeight', 'lines', 'height', 'minLines', 'minHeight', 'maxEms', 'maxWidth', 'ems', 'width', 'minEms', 'minWidth', 'gravity',
  'scrollHorizontally', 'password', 'singleLine', 'enabled', 'selectAllOnFocus', 'includeFontPadding', 'maxLength', 'shadowColor', 'shadowDx', 'shadowDy', 'shadowRadius', 'autoLink', 'linksClickable',
  'numeric', 'digits', 'phoneNumber', 'inputMethod', 'capitalize', 'autoText', 'editable', 'freezesText', 'ellipsize', 'drawableTop', 'drawableBottom', 'drawableLeft', 'drawableRight', 'drawableStart',
  'drawableEnd', 'drawablePadding', 'drawableTint', 'drawableTintMode', 'lineSpacingExtra', 'lineSpacingMultiplier', 'lineHeight', 'firstBaselineToTopHeight', 'lastBaselineToBottomHeight',
  'marqueeRepeatLimit', 'inputType', 'allowUndo', 'imeOptions', 'privateImeOptions', 'imeActionLabel', 'imeActionId', 'editorExtras', 'textSelectHandleLeft', 'textSelectHandleRight', 'textSelectHandle',
  'textEditPasteWindowLayout', 'textEditNoPasteWindowLayout', 'textEditSidePasteWindowLayout', 'textEditSideNoPasteWindowLayout', 'textEditSuggestionItemLayout', 'textEditSuggestionContainerLayout',
  'textEditSuggestionHighlightStyle', 'textCursorDrawable', 'textIsSelectable', 'textAllCaps', 'elegantTextHeight', 'fallbackLineSpacing', 'letterSpacing', 'fontFeatureSettings', 'fontVariationSettings',
  'breakStrategy', 'hyphenationFrequency', 'lineBreakStyle', 'lineBreakWordStyle', 'autoSizeTextType', 'autoSizeStepGranularity', 'autoSizePresetSizes', 'autoSizeMinTextSize', 'autoSizeMaxTextSize',
  'justificationMode'];
// R.styleable.Switch.
export const SWITCH_ATTRIBUTES = ['thumb', 'thumbTint', 'thumbTintMode', 'track', 'trackTint', 'trackTintMode', 'textOn', 'textOff', 'thumbTextPadding', 'switchTextAppearance', 'switchMinWidth', 'switchPadding', 'splitTrack', 'showText'];
// R.styleable.CompoundButton.
export const COMPOUND_BUTTON_ATTRIBUTES = ['button', 'checked', 'buttonTint', 'buttonTintMode'];
// What an attribute that is kept but changes nothing in this VM is reported with, when the tag itself carries it (the value is still what its getter returns).
const NO_EFFECT = {
  caret: 'the page draws the caret and the selection handles of a text field itself; the value is kept for the TextView API',
  highlight: 'the page draws the selection of a text field with its own colour; the value is kept for the TextView API',
  marquee: 'a marquee is drawn at rest (clipped at the view), it does not scroll; the value is kept for the TextView API',
  undo: 'the page text field has its own undo; the value is kept',
  suggestions: 'the spelling suggestion popup needs a spell checker service, which the lab does not have; the value is kept',
};
const NO_EFFECT_OF = { textCursorDrawable: 'caret', textSelectHandle: 'caret', textSelectHandleLeft: 'caret', textSelectHandleRight: 'caret', cursorVisible: 'caret', textColorHighlight: 'highlight',
  marqueeRepeatLimit: 'marquee', allowUndo: 'undo', textEditSuggestionItemLayout: 'suggestions' };
/** styleable -> attribute -> why, as VIEW_ATTRIBUTES_WITHOUT_EFFECT of src/view-xml-attributes.js. */
export const TEXT_ATTRIBUTES_WITHOUT_EFFECT = { TextView: Object.fromEntries(Object.entries(NO_EFFECT_OF).map(([name, kind]) => [name, NO_EFFECT[kind]])) };
const UNSET = -1;   // TextView.UNSET_AUTO_SIZE_UNIFORM_CONFIGURATION_VALUE
const TYPE_CLASS = 0xf, TYPE_VARIATION = 0xff0, TEXT_CLASS = 1, NUMBER_CLASS = 2, MULTI_LINE = 0x20000;

/** Adds the TextView and CompoundButton constructor attribute passes to platform.viewXmlAttributes. */
export function installTextViewXmlAttributes(platform) {
  const base = platform.viewXmlAttributes, kit = base.kit, { styleable, reader, attempt, attributeSet, theme, table, tagOf, tagGives, noteNoEffect, parseBlendMode, call, isJava } = kit;
  const nullish = value => value === null || value === undefined || value === 0;
  const text = (r, self, name, signature, values = [], owner = TEXT) => call(r, 'virtual', owner, name, signature, [self, ...values]);
  const statics = (r, owner, name, signature, values = []) => call(r, 'static', owner, name, signature, values);
  const staticField = (r, owner, name, type = owner) => r.readStatic({ owner, name, type, key: `${owner}->${name}:${type}` });
  /** A java.lang.String or JavaScript string as a JavaScript string; null for anything else (a Spanned text keeps its spans and goes through the setter). */
  const plain = (r, value) => nullish(value) ? null : typeof value === 'string' ? value : r.typeOf(value) === STRING ? r.stringCharacters(value) : null;
  const characters = (r, value) => nullish(value) ? null : plain(r, value) ?? r.stringCharacters(call(r, 'virtual', 'Ljava/lang/Object;', 'toString', `()${STRING}`, [value]));
  const ids = (r, list) => { const array = r.newArray('[I', list.ids.length); r.object(array).elements = [...list.ids]; return array; };
  const isApkError = error => !isJava(error) && error?.name === 'APKError' && error.details?.kind !== 'instruction-budget' && !/budget|heap|limit exceeded|aborted|cancell?ed/i.test(String(error.message));
  // What a text appearance style and a colour state list resource give is the same for every TextView under one theme and one device configuration (Android's Resources
  // caches the colour lists; a style's bag is native there): read once per Theme. The values live on the Theme object itself (host state of the record, which the collector
  // traces in both engines), so they die with their Theme, and they are read again when the Theme changed: Theme.applyStyle appends to its applied-style history (a forced
  // style overwrites values in place), rebase and setTo replace the value map, and a new device configuration replaces platform.device.
  const memoOf = (r, themeRef) => {
    const themeObject = r.object(themeRef), values = themeObject.themeValues, device = platform.device; if (!values || !device) return null;
    const applied = themeObject.appliedStyles?.length ?? 0, entry = themeObject.textAppearanceMemo;
    if (entry && entry.values === values && entry.applied === applied && entry.device === device) return entry.map;
    return (themeObject.textAppearanceMemo = { values, applied, device, map: new Map() }).map;
  };
  /** TypedArray.getColorStateList(index), read once per colour resource. */
  const colorsOf = (a, name, memo) => {
    const source = a.source(name), key = `colors:${source}`; if (!memo || !source) return a.colors(name);
    if (!memo.has(key)) memo.set(key, a.colors(name));
    return memo.get(key);
  };
  /** The reason of the lab's own explicit refusal while `apply` ran, or null; anything else propagates (as kit.attempt does). */
  const refusal = apply => { try { apply(); return null; } catch (error) { if (!isApkError(error)) throw error; return String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 200); } };
  /** TextView.isMultilineInputType. */
  const multiline = type => (type & (TYPE_CLASS | MULTI_LINE)) === (TEXT_CLASS | MULTI_LINE);

  /** TextView.readTextAppearance(context, appearance, attributes, styleArray): the text appearance attributes among `names` (present in `a`) into `attributes`. */
  const readTextAppearance = (r, view, context, a, names, attributes, memo = null, refused = null) => {
    for (const name of names) { const reason = refusal(() => {
      switch (name) {
        case 'textColorHighlight': attributes.textColorHighlight = a.color(name, attributes.textColorHighlight); break;
        case 'textColor': attributes.textColor = colorsOf(a, name, memo); break;
        case 'textColorHint': attributes.textColorHint = colorsOf(a, name, memo); break;
        case 'textColorLink': attributes.textColorLink = colorsOf(a, name, memo); break;
        case 'textSize': attributes.textSize = a.size(name, attributes.textSize); attributes.textSizeUnit = a.type(name) === 5 ? a.data(name) & 0xf : -1; break;   // peekValue(attr).getComplexUnit()
        case 'textLocale': {
          const tags = a.string(name); if (nullish(tags)) break;
          const locales = statics(r, LOCALES, 'forLanguageTags', `(${STRING})${LOCALES}`, [tags]);
          if (!call(r, 'virtual', LOCALES, 'isEmpty', '()Z', [locales])) attributes.textLocales = locales;
          break;
        }
        case 'typeface': attributes.typefaceIndex = a.int(name, attributes.typefaceIndex); if (attributes.typefaceIndex !== -1 && !attributes.fontFamilyExplicit) attributes.fontFamily = null; break;
        case 'fontFamily': {
          // TypedArray.getFont for a font resource (not in a restricted context); any other value is a family name
          attributes.fontTypeface = r.skiaHost?.resolveTypeface && !call(r, 'virtual', 'Landroid/content/Context;', 'isRestricted', '()Z', [context]) ? a.font(name) : null;
          if (attributes.fontTypeface === null) attributes.fontFamily = characters(r, a.string(name));
          attributes.fontFamilyExplicit = true; break;
        }
        case 'textStyle': attributes.textStyle = a.int(name, attributes.textStyle); break;
        case 'textFontWeight': attributes.fontWeight = a.int(name, attributes.fontWeight); break;
        case 'textAllCaps': attributes.allCaps = a.bool(name, attributes.allCaps); break;
        case 'shadowColor': attributes.shadowColor = a.int(name, attributes.shadowColor); break;
        case 'shadowDx': attributes.shadowDx = a.floatBits(name, bitsFloat(attributes.shadowDx)); break;
        case 'shadowDy': attributes.shadowDy = a.floatBits(name, bitsFloat(attributes.shadowDy)); break;
        case 'shadowRadius': attributes.shadowRadius = a.floatBits(name, bitsFloat(attributes.shadowRadius)); break;
        case 'elegantTextHeight': attributes.hasElegant = true; attributes.elegant = a.bool(name, attributes.elegant); break;
        case 'fallbackLineSpacing': attributes.hasFallbackLineSpacing = true; attributes.fallbackLineSpacing = a.bool(name, attributes.fallbackLineSpacing); break;
        case 'letterSpacing': attributes.hasLetterSpacing = true; attributes.letterSpacing = a.floatBits(name, bitsFloat(attributes.letterSpacing)); break;
        case 'fontFeatureSettings': attributes.fontFeatureSettings = a.string(name); break;
        case 'fontVariationSettings': attributes.fontVariationSettings = a.string(name); break;
        case 'lineBreakStyle': attributes.hasLineBreakStyle = true; attributes.lineBreakStyle = a.int(name, attributes.lineBreakStyle); break;
        case 'lineBreakWordStyle': attributes.hasLineBreakWordStyle = true; attributes.lineBreakWordStyle = a.int(name, attributes.lineBreakWordStyle); break;
        default: break;   // not part of a text appearance
      }
    }); if (reason !== null) { platform.noteXmlAttributeNotApplied(r, name, tagOf(view), reason); refused?.push([name, reason]); } }
  };

  // ------------------------------------------------------------------------------------------------------------------------------------------------- android.widget.TextView
  /** TextView(Context, AttributeSet, int defStyleAttr, int defStyleRes). Returns the names of R.styleable.TextView (the pass owns them), or null when it did not run. */
  const applyTextView = (r, self, node, context) => {
    const view = r.object(self), source = table();
    if (!r.isSubtype(view.type, TEXT) || !source || !context || !r.classes.has(TA) || !platform.styleBackend || !platform.textViewApi?.state) return null;
    // As for View: the default style is read where the VM measures and draws the text itself; in the page-laid-out flow mode only the tag and its style="" are read.
    const styled = !!r.skia && !!platform.resources.frameworkXml;
    let defStyleAttr = 0, defStyleRes = 0;
    if (styled) { defStyleAttr = view.defStyleExplicit ? view.defStyleAttr | 0 : (view.defStyleAttr || source.findId(platform.drawableViewHost.defaultStyleName(r, view.type))) | 0; defStyleRes = view.defStyleRes | 0; }
    if (!node && !defStyleAttr && !defStyleRes) return null;
    const list = styleable(r, 'TextView', TEXT_VIEW_ATTRIBUTES), appearanceList = styleable(r, 'TextAppearance', TEXT_APPEARANCE_ATTRIBUTES), holderList = styleable(r, 'TextViewAppearance', ['textAppearance']);
    const themeRef = theme(r, context), attrs = attributeSet(r, node), tag = tagOf(view), tv = platform.textViewApi.state(r, self);
    const guard = !!r.skia;   // a native measure pass would stop for a value it cannot draw
    /** Applies one attribute; when the native text path cannot draw the TextView with it, the TextView's state is put back and the attribute is reported as not applied. */
    const drawn = (name, apply) => attempt(r, view, name, () => {
      if (!guard) { apply(); return; }
      const before = { ...tv }; apply();
      const missing = platform.textViewApi.unsupportedRendering(r, self);
      if (!missing) { const given = tv.xmlGiven ??= new Map(); for (const key of Object.keys(tv)) if (tv[key] !== before[key] && key !== 'xmlGiven') given.set(key, name); return; }   // a later change that makes it undrawable is reported at the measure pass, it does not stop it
      for (const key of Object.keys(tv)) if (!(key in before)) delete tv[key];
      Object.assign(tv, before);
      platform.noteXmlAttributeNotApplied(r, name, tag, `the native text path does not draw a TextView with ${missing} yet`);
    });
    const tagCarries = name => !!node && node.attributes.some(attribute => attribute.namespace === ANDROID_NAMESPACE && attribute.name === name);
    /** Whether the style="" of the tag gives the attribute (the style's bag, with its parents). */
    const tagStyleGives = name => {
      const style = node?.attributes.find(attribute => attribute.namespace === null && attribute.name === 'style'); if (!style) return false;
      const values = r.object(themeRef).themeValues, value = platform.styleBackend.resolved(style, values, false), id = value.kind === 'attribute' ? platform.styleBackend.resolved(values.get(value.reference), values, false).reference : value.reference;
      return !!id && platform.resources.table.resolveBag(id).has(kit.attributeId(name) >>> 0);
    };
    const inert = name => { if (tagCarries(name)) noteNoEffect(r, name, tag, NO_EFFECT[NO_EFFECT_OF[name]]); };

    // 1. The text appearance the tag, its style, the default style or the theme names. In the flow mode the theme's own text appearance is the page's business.
    const attributes = { textColor: null, textColorHint: null, textColorLink: null, textColorHighlight: 0, textSize: -1, textSizeUnit: -1, textLocales: null, fontFamily: null, fontTypeface: null,
      fontFamilyExplicit: false, typefaceIndex: -1, textStyle: 0, fontWeight: -1, allCaps: false, shadowColor: 0, shadowDx: floatBits(0), shadowDy: floatBits(0), shadowRadius: floatBits(0), hasElegant: false,
      elegant: false, hasFallbackLineSpacing: false, fallbackLineSpacing: false, hasLetterSpacing: false, letterSpacing: floatBits(0), fontFeatureSettings: null, fontVariationSettings: null,
      hasLineBreakStyle: false, hasLineBreakWordStyle: false, lineBreakStyle: 0, lineBreakWordStyle: 0 };
    const memo = memoOf(r, themeRef);

    // 2. R.styleable.TextView (android:textAppearance is one of its attributes too: the same value R.styleable.TextViewAppearance gives)
    const array = platform.styleBackend.obtain(r, themeRef, attrs, ids(r, list), defStyleAttr, defStyleRes), a = reader(r, array, list);
    let editable = false, inputMethod = null, numeric = 0, digits = null, phone = false, autotext = false, autocap = -1, buffertype = 0, selectallonfocus = false;
    const drawables = { left: null, top: null, right: null, bottom: null, start: null, end: null }; let anyDrawable = false, drawableTint = null, drawableTintMode = null, drawablePadding = null;
    let ellipsize = -1, singleLine = null, maxlength = -1, textValue = null, textSet = false, hint = null, password = false, inputType = 0, bufferGiven = false;
    let autoSizeMin = UNSET, autoSizeMax = UNSET, autoSizeStep = UNSET, autoSizeType = null, autoSizePresets = null;
    let firstBaselineToTopHeight = -1, lastBaselineToBottomHeight = -1, lineHeight = -1, lineSpacingExtra = null, lineSpacingMult = null;
    try {
      if (styled || tagGives(node, holderList.handled)) {
        const appearance = a.resource('textAppearance', -1);
        if (appearance !== -1 && appearance !== 0) {
          const key = `appearance:${appearance}`;
          if (!memo?.has(key)) {
            const style = platform.styleBackend.obtain(r, themeRef, null, ids(r, appearanceList), 0, 0, appearance), t = reader(r, style, appearanceList), read = { ...attributes }, refused = [];
            try { readTextAppearance(r, view, context, t, t.present, read, memo, refused); } finally { t.recycle(); }
            read.fontFamilyExplicit = false;
            if (memo) memo.set(key, { read, refused }); else Object.assign(attributes, read);
          } else for (const [name, reason] of memo.get(key).refused) platform.noteXmlAttributeNotApplied(r, name, tag, reason);   // what the first reading could not apply is not applied to this tag either
          if (memo) Object.assign(attributes, memo.get(key).read);
        }
      }
      readTextAppearance(r, view, context, a, a.present.filter(name => appearanceList.handled.has(name)), attributes, memo);
      const size = (name, setter) => text(r, self, setter, '(I)V', [a.size(name, -1)]), count = (name, setter) => text(r, self, setter, '(I)V', [a.int(name, -1)]);
      for (const name of a.present) attempt(r, view, name, () => {
        switch (name) {
          case 'editable': editable = a.bool(name, editable); break;
          case 'inputMethod': inputMethod = a.text(name); break;
          case 'numeric': numeric = a.int(name, numeric); break;
          case 'digits': digits = a.text(name); break;
          case 'phoneNumber': phone = a.bool(name, phone); break;
          case 'autoText': autotext = a.bool(name, autotext); break;
          case 'capitalize': autocap = a.int(name, autocap); break;
          case 'bufferType': buffertype = a.int(name, buffertype); bufferGiven = true; break;
          case 'selectAllOnFocus': selectallonfocus = a.bool(name, selectallonfocus); break;
          case 'autoLink': tv.autoLinkMask = a.int(name, 0); break;
          case 'linksClickable': tv.linksClickable = a.bool(name, true); break;
          case 'drawableLeft': case 'drawableTop': case 'drawableRight': case 'drawableBottom': case 'drawableStart': case 'drawableEnd': drawables[name.slice(8).toLowerCase()] = a.drawable(name); anyDrawable = true; break;
          case 'drawableTint': drawableTint = a.colors(name); break;
          case 'drawableTintMode': drawableTintMode = parseBlendMode(r, a.int(name, -1)); break;
          case 'drawablePadding': drawablePadding = a.size(name, 0); break;
          case 'maxLines': count(name, 'setMaxLines'); break;
          case 'maxHeight': size(name, 'setMaxHeight'); break;
          case 'lines': count(name, 'setLines'); break;
          case 'height': size(name, 'setHeight'); break;
          case 'minLines': count(name, 'setMinLines'); break;
          case 'minHeight': size(name, 'setMinHeight'); break;
          case 'maxEms': count(name, 'setMaxEms'); break;
          case 'maxWidth': size(name, 'setMaxWidth'); break;
          case 'ems': count(name, 'setEms'); break;
          case 'width': size(name, 'setWidth'); break;
          case 'minEms': count(name, 'setMinEms'); break;
          case 'minWidth': size(name, 'setMinWidth'); break;
          case 'gravity': text(r, self, 'setGravity', '(I)V', [a.int(name, -1)]); break;
          case 'hint': hint = a.text(name); break;
          case 'text': textSet = true; textValue = a.text(name); break;
          case 'scrollHorizontally': if (a.bool(name, false)) text(r, self, 'setHorizontallyScrolling', '(Z)V', [1]); break;   // applySingleLine below decides again
          case 'singleLine': singleLine = a.bool(name, false); break;
          case 'ellipsize': ellipsize = a.int(name, ellipsize); break;
          case 'marqueeRepeatLimit': text(r, self, 'setMarqueeRepeatLimit', '(I)V', [a.int(name, tv.marqueeRepeatLimit)]); inert(name); break;
          case 'includeFontPadding': if (!a.bool(name, true)) text(r, self, 'setIncludeFontPadding', '(Z)V', [0]); break;
          case 'cursorVisible': if (!a.bool(name, true)) { text(r, self, 'setCursorVisible', '(Z)V', [0]); inert(name); } break;
          case 'maxLength': maxlength = a.int(name, -1); break;
          case 'textScaleX': drawn(name, () => text(r, self, 'setTextScaleX', '(F)V', [a.floatBits(name, 1)])); break;
          case 'freezesText': text(r, self, 'setFreezesText', '(Z)V', [a.bool(name, false) ? 1 : 0]); break;
          case 'enabled': call(r, 'virtual', VIEW, 'setEnabled', '(Z)V', [self, a.bool(name, view.enabled !== false) ? 1 : 0]); break;
          case 'password': password = a.bool(name, password); break;
          case 'lineSpacingExtra': lineSpacingExtra = a.size(name, Math.trunc(tv.lineSpacingExtra)); break;
          case 'lineSpacingMultiplier': lineSpacingMult = bitsFloat(a.floatBits(name, tv.lineSpacingMult)); break;
          case 'inputType': inputType = a.int(name, 0); break;
          case 'allowUndo': view.editorExists = true; tv.allowUndo = a.bool(name, true); if (!tv.allowUndo) inert(name); break;
          case 'imeOptions': view.editorExists = true; tv.imeOptions = a.int(name, tv.imeOptions); break;
          case 'imeActionLabel': view.editorExists = true; tv.imeActionLabel = a.text(name); break;
          case 'imeActionId': view.editorExists = true; tv.imeActionId = a.int(name, tv.imeActionId); break;
          case 'privateImeOptions': text(r, self, 'setPrivateImeOptions', `(${STRING})V`, [a.string(name)]); break;
          case 'editorExtras': text(r, self, 'setInputExtras', '(I)V', [a.resource(name, 0)]); break;
          // The caret and the selection handles: the resource is kept, the Drawable is loaded when the getter is first asked (TextView.getTextCursorDrawable).
          case 'textCursorDrawable': case 'textSelectHandleLeft': case 'textSelectHandleRight': case 'textSelectHandle': tv[name + 'Res'] = a.resource(name, 0); tv[name] = null; inert(name); break;
          case 'textEditSuggestionItemLayout': case 'textEditSuggestionContainerLayout': case 'textEditSuggestionHighlightStyle': tv[name] = a.resource(name, 0); if (name === 'textEditSuggestionItemLayout') inert(name); break;
          case 'textIsSelectable': text(r, self, 'setTextIsSelectable', '(Z)V', [a.bool(name, false) ? 1 : 0]); break;
          case 'autoSizeTextType': autoSizeType = a.int(name, 0); break;
          case 'autoSizeStepGranularity': autoSizeStep = bitsFloat(a.dimensionBits(name, UNSET)); break;
          case 'autoSizeMinTextSize': autoSizeMin = bitsFloat(a.dimensionBits(name, UNSET)); break;
          case 'autoSizeMaxTextSize': autoSizeMax = bitsFloat(a.dimensionBits(name, UNSET)); break;
          case 'autoSizePresetSizes': {   // Resources.obtainTypedArray(id), each item as getDimensionPixelSize(i, -1)
            const id = a.resource(name, 0); if (id <= 0) break;
            const sizes = platform.styleBackend.obtainResourceArray(r, id), parsed = [];
            try { const length = call(r, 'virtual', TA, 'length', '()I', [sizes]); for (let i = 0; i < length; i++) parsed.push(call(r, 'virtual', TA, 'getDimensionPixelSize', '(II)I', [sizes, i, -1]) | 0); }
            finally { call(r, 'virtual', TA, 'recycle', '()V', [sizes]); }
            if (parsed.length) autoSizePresets = parsed;
            break;
          }
          case 'justificationMode': drawn(name, () => { tv.justificationMode = a.int(name, 0); }); break;
          // mBreakStrategy / mHyphenationFrequency: the framework's default TextView style gives both. A strategy the text backend cannot run is reported at the measure
          // pass (view-layout-host.js) and the text is broken greedily there; the getter keeps Android's value.
          case 'breakStrategy': case 'hyphenationFrequency': tv[name] = a.int(name, 0); (tv.xmlGiven ??= new Map()).set(name, tagCarries(name) || tagStyleGives(name) ? name : 'default'); if (name === 'breakStrategy') tv.xmlBreakStrategy = tv[name]; break;
          case 'firstBaselineToTopHeight': firstBaselineToTopHeight = a.size(name, -1); break;
          case 'lastBaselineToBottomHeight': lastBaselineToBottomHeight = a.size(name, -1); break;
          case 'lineHeight': lineHeight = a.size(name, -1); break;
          default: break;   // the text appearance attributes (read above; the two line break ones are applied with them), android:textAppearance, and the four paste window layouts nothing reads
        }
      });
      if (a.has('textColorHighlight')) inert('textColorHighlight');
    } finally { a.recycle(); }

    // 3. After the loop, in the constructor's order.
    // The key listener and the input type (the constructor sets them on the Editor directly: no setKeyListener side effects).
    const variation = inputType & (TYPE_CLASS | TYPE_VARIATION), passwordInputType = variation === (TEXT_CLASS | 0x80), webPasswordInputType = variation === (TEXT_CLASS | 0xe0), numberPasswordInputType = variation === (NUMBER_CLASS | 0x10);
    let bufferType = null, keyListenerSet = false, movementSet = false;
    const direct = (listener, type) => { view.keyListener = nullish(listener) ? null : listener; view.keyListenerInitialized = true; view.editorExists = true; view.inputType = type; keyListenerSet = !nullish(listener); bufferType = 'EDITABLE'; };
    if (inputMethod !== null) attempt(r, view, 'inputMethod', () => {
      const name = call(r, 'virtual', 'Ljava/lang/Object;', 'toString', `()${STRING}`, [inputMethod]);
      let type;
      try { type = statics(r, 'Ljava/lang/Class;', 'forName', `(${STRING})Ljava/lang/Class;`, [name]); }
      catch (error) { if (!kit.javaIs(r, error, 'Ljava/lang/ClassNotFoundException;')) throw error; r.throwJava('Ljava/lang/RuntimeException;', `java.lang.ClassNotFoundException: ${characters(r, name)}`); }
      const listener = call(r, 'virtual', 'Ljava/lang/Class;', 'newInstance', '()Ljava/lang/Object;', [type]);
      direct(listener, inputType !== 0 ? inputType : call(r, 'virtual', KEY_LISTENER, 'getInputType', '()I', [listener]));
    });
    else if (digits !== null) attempt(r, view, 'digits', () => {
      const owner = 'Landroid/text/method/DigitsKeyListener;';
      direct(statics(r, owner, 'getInstance', `(${STRING})${owner}`, [call(r, 'virtual', 'Ljava/lang/Object;', 'toString', `()${STRING}`, [digits])]), inputType !== 0 ? inputType : TEXT_CLASS);
    });
    else if (inputType !== 0) {
      // setInputType(inputType, true): the key listener the input class implies. Without the listener classes the type alone is kept, and that is reported.
      const reason = refusal(() => { const made = platform.textViewApi.keyListenerFor(r, self, inputType); direct(made.listener, made.type); });
      if (reason !== null) { view.inputType = inputType; view.editorExists = true; bufferType = 'EDITABLE'; platform.noteXmlAttributeNotApplied(r, 'inputType', tag, `the input type is kept, its key listener is not made: ${reason}`); }
      singleLine = !multiline(inputType);
    } else if (phone) attempt(r, view, 'phoneNumber', () => { const owner = 'Landroid/text/method/DialerKeyListener;'; inputType = 3; direct(statics(r, owner, 'getInstance', `()${owner}`, []), inputType); });
    else if (numeric !== 0) attempt(r, view, 'numeric', () => {
      const owner = 'Landroid/text/method/DigitsKeyListener;', listener = statics(r, owner, 'getInstance', `(Ljava/util/Locale;ZZ)${owner}`, [null, numeric & 2 ? 1 : 0, numeric & 4 ? 1 : 0]);   // SIGNED = 2, DECIMAL = 4
      inputType = call(r, 'virtual', KEY_LISTENER, 'getInputType', '()I', [listener]); direct(listener, inputType);
    });
    else if (autotext || autocap !== -1) attempt(r, view, autotext ? 'autoText' : 'capitalize', () => {
      const owner = 'Landroid/text/method/TextKeyListener;', capitalize = `${owner.slice(0, -1)}$Capitalize;`, [capName, flag] = [['NONE', 0], ['SENTENCES', 0x4000], ['WORDS', 0x2000], ['CHARACTERS', 0x1000]][autocap] ?? ['NONE', 0];
      inputType = TEXT_CLASS | flag;
      direct(statics(r, owner, 'getInstance', `(Z${capitalize})${owner}`, [autotext ? 1 : 0, staticField(r, capitalize, capName)]), inputType);
    });
    else if (editable && !r.isSubtype(view.type, EDIT)) attempt(r, view, 'editable', () => { const owner = 'Landroid/text/method/TextKeyListener;'; direct(statics(r, owner, 'getInstance', `()${owner}`, []), TEXT_CLASS); });
    else if (tv.textIsSelectable) attempt(r, view, 'textIsSelectable', () => {
      if (view.editorExists) { view.keyListener = null; view.keyListenerInitialized = true; view.inputType = 0; }
      bufferType = 'SPANNABLE';
      const owner = 'Landroid/text/method/ArrowKeyMovementMethod;';
      text(r, self, 'setMovementMethod', `(${MOVEMENT})V`, [statics(r, owner, 'getInstance', `()${MOVEMENT}`, [])]); movementSet = true;
    });
    else if (bufferGiven && !r.isSubtype(view.type, EDIT)) bufferType = ['NORMAL', 'SPANNABLE', 'EDITABLE'][buffertype] ?? 'NORMAL';
    // Editor.adjustInputType: android:password and the password input types become the password variation of the input type
    if (view.editorExists && view.inputType != null) {
      if ((view.inputType & TYPE_CLASS) === TEXT_CLASS) { if (password || passwordInputType) view.inputType = (view.inputType & ~TYPE_VARIATION) | 0x80; if (webPasswordInputType) view.inputType = (view.inputType & ~TYPE_VARIATION) | 0xe0; }
      else if ((view.inputType & TYPE_CLASS) === NUMBER_CLASS && numberPasswordInputType) view.inputType = (view.inputType & ~TYPE_VARIATION) | 0x10;
    }
    if (selectallonfocus) { view.editorExists = true; tv.selectAllOnFocus = true; if ((bufferType === null || bufferType === 'NORMAL') && !r.isSubtype(view.type, EDIT)) bufferType = 'SPANNABLE'; }

    // Compound drawables: the tint first (setCompoundDrawables applies it), the absolute ones, then start / end over them.
    if (drawableTint !== null) attempt(r, view, 'drawableTint', () => text(r, self, 'setCompoundDrawableTintList', `(${TINT})V`, [drawableTint]));
    if (drawableTintMode !== null) attempt(r, view, 'drawableTintMode', () => text(r, self, 'setCompoundDrawableTintBlendMode', `(${BLEND})V`, [drawableTintMode]));
    if (anyDrawable) attempt(r, view, 'drawableLeft', () => {
      const four = DRAWABLE.repeat(4), relative = drawables.start !== null || drawables.end !== null;
      // setRelativeDrawablesIfNeeded and Drawables.resolveWithLayoutDirection: with a start or an end drawable, start and end override left and right (mOverride: a side
      // they do not give shows nothing); in RTL compatibility mode they only fill a left / right the XML did not define.
      if (relative && !base.rtlCompatibility(r, context)) text(r, self, 'setCompoundDrawablesRelativeWithIntrinsicBounds', `(${four})V`, [drawables.start, drawables.top, drawables.end, drawables.bottom]);
      else if (relative) text(r, self, 'setCompoundDrawablesWithIntrinsicBounds', `(${four})V`, [drawables.left ?? drawables.start, drawables.top, drawables.right ?? drawables.end, drawables.bottom]);
      else text(r, self, 'setCompoundDrawablesWithIntrinsicBounds', `(${four})V`, [drawables.left, drawables.top, drawables.right, drawables.bottom]);
    });
    if (drawablePadding !== null) attempt(r, view, 'drawablePadding', () => text(r, self, 'setCompoundDrawablePadding', '(I)V', [drawablePadding]));

    // setInputTypeSingleLine(singleLine) and applySingleLine(singleLine, singleLine, singleLine, false): always, as the constructor does. Without android:singleLine="true"
    // the text does not scroll horizontally, whatever android:scrollHorizontally said. (The multi-line flag of the input type is set where an attribute decided the input
    // type or single line: an input type no attribute names stays as the lab had it, see the head of this file.)
    if (singleLine === true) {
      const reason = refusal(() => text(r, self, 'setSingleLine', '(Z)V', [1]));
      if (reason !== null) { view.singleLine = true; platform.noteXmlAttributeNotApplied(r, 'singleLine', tag, `the line limit is kept, the single-line transformation is not applied: ${reason}`); }
    } else attempt(r, view, 'singleLine', () => {
      if ((singleLine !== null || keyListenerSet) && view.editorExists && view.inputType != null && (view.inputType & TYPE_CLASS) === TEXT_CLASS) view.inputType |= MULTI_LINE;
      view.singleLine = false; if (view.horizontallyScrolling) text(r, self, 'setHorizontallyScrolling', '(Z)V', [0]);
    });
    if (singleLine === true && nullish(view.keyListener) && !r.isSubtype(view.type, EDIT) && ellipsize === -1) ellipsize = 3;   // ELLIPSIZE_END for a single line that is not edited
    if (ellipsize >= 1 && ellipsize <= 4) drawn('ellipsize', () => {
      if (ellipsize === 4) {   // ViewConfiguration.isFadingMarqueeEnabled() (config_ui_enableFadingMarquee): MARQUEE_FADE_NORMAL with the fading edge, else MARQUEE_FADE_SWITCH_SHOW_ELLIPSIS
        const CONFIGURATION = 'Landroid/view/ViewConfiguration;', fading = !!call(r, 'virtual', CONFIGURATION, 'isFadingMarqueeEnabled', '()Z', [statics(r, CONFIGURATION, 'get', '(Landroid/content/Context;)Landroid/view/ViewConfiguration;', [context])]);
        call(r, 'virtual', VIEW, 'setHorizontalFadingEdgeEnabled', '(Z)V', [self, fading ? 1 : 0]); tv.marqueeFadeMode = fading ? 0 : 1;
      }
      text(r, self, 'setEllipsize', `(${TRUNCATE})V`, [staticField(r, TRUNCATE, [null, 'START', 'MIDDLE', 'END', 'MARQUEE'][ellipsize])]);
    });

    // mSpacingAdd / mSpacingMult (fields the loop sets on Android; here after single line and ellipsize are known, which decide whether the native text path draws them)
    if (lineSpacingExtra !== null) drawn('lineSpacingExtra', () => { tv.lineSpacingExtra = lineSpacingExtra; });
    if (lineSpacingMult !== null) drawn('lineSpacingMultiplier', () => { tv.lineSpacingMult = lineSpacingMult; });

    // applyTextAppearance(attributes)
    const isPassword = password || passwordInputType || webPasswordInputType || numberPasswordInputType;
    if (isPassword || (view.editorExists && view.inputType != null && (view.inputType & (TYPE_CLASS | TYPE_VARIATION)) === (TEXT_CLASS | 0x80))) attributes.typefaceIndex = 3;   // MONOSPACE
    if (attributes.textColor !== null) attempt(r, view, 'textColor', () => {
      // A single colour is the colour the text is drawn with; a list with states is kept as the TextView's colours and resolved for the View's state when the text is drawn.
      if (call(r, 'virtual', TINT, 'isStateful', '()Z', [attributes.textColor])) { tv.textColors = attributes.textColor; view.textColor = null; }
      else text(r, self, 'setTextColor', `(${TINT})V`, [attributes.textColor]);
    });
    if (attributes.textColorHint !== null) attempt(r, view, 'textColorHint', () => text(r, self, 'setHintTextColor', `(${TINT})V`, [attributes.textColorHint]));
    if (attributes.textColorLink !== null) attempt(r, view, 'textColorLink', () => text(r, self, 'setLinkTextColor', `(${TINT})V`, [attributes.textColorLink]));
    if (attributes.textColorHighlight !== 0) attempt(r, view, 'textColorHighlight', () => text(r, self, 'setHighlightColor', '(I)V', [attributes.textColorHighlight]));
    if (attributes.textSize !== -1) attempt(r, view, 'textSize', () => { text(r, self, 'setTextSize', '(IF)V', [0, floatBits(attributes.textSize)]); tv.textSizeUnit = attributes.textSizeUnit === -1 ? 0 : attributes.textSizeUnit; });
    if (attributes.textLocales !== null) attempt(r, view, 'textLocale', () => text(r, self, 'setTextLocales', `(${LOCALES})V`, [attributes.textLocales]));
    if (attributes.typefaceIndex !== -1 && !attributes.fontFamilyExplicit) attributes.fontFamily = null;
    if (attributes.fontTypeface !== null || attributes.fontFamily !== null || attributes.typefaceIndex !== -1 || attributes.textStyle !== 0 || attributes.fontWeight >= 0) attempt(r, view, attributes.fontFamilyExplicit ? 'fontFamily' : 'textStyle', () => {
      // setTypefaceFromAttrs. Without the font backend (the page draws the text) the style bits are what the page reads.
      if (!r.skiaHost?.resolveTypeface) {
        view.textStyle = attributes.textStyle;
        for (const [name, given] of [['fontFamily', attributes.fontTypeface !== null || attributes.fontFamily !== null], ['typeface', attributes.typefaceIndex !== -1], ['textFontWeight', attributes.fontWeight >= 0]])
          if (given) platform.noteXmlAttributeNotApplied(r, name, tag, 'the page draws this text with its own font (no font backend in this mode); the style bits are kept');
        return;
      }
      const font = { typeface: attributes.fontTypeface, familyName: attributes.fontFamily, typefaceIndex: attributes.typefaceIndex, style: attributes.textStyle, weight: attributes.fontWeight };
      view.styledFont = font; platform.typefaceBuilder.applyTextViewFont(r, self, font);
      // A family name of the system font map (fonts.xml: serif, monospace, sans-serif-light, ...) is drawn with the font the map names, read when the Typeface is made
      // (src/system-fonts.js); a name outside the map answers the default family, as Typeface.create(String, int) does on a device.
    });
    if (attributes.shadowColor !== 0) drawn('shadowColor', () => text(r, self, 'setShadowLayer', '(FFFI)V', [attributes.shadowRadius, attributes.shadowDx, attributes.shadowDy, attributes.shadowColor]));
    if (attributes.allCaps && r.classes.has('Landroid/text/method/AllCapsTransformationMethod;')) attempt(r, view, 'textAllCaps', () => text(r, self, 'setAllCaps', '(Z)V', [1]));
    else if (attributes.allCaps) platform.noteXmlAttributeNotApplied(r, 'textAllCaps', tag, 'android.text.method.AllCapsTransformationMethod is not loaded: the text is shown in capitals, getTransformationMethod() does not return the transformation');
    if (attributes.allCaps) view.textAllCaps = true;
    if (attributes.hasElegant) attempt(r, view, 'elegantTextHeight', () => text(r, self, 'setElegantTextHeight', '(Z)V', [attributes.elegant ? 1 : 0]));
    if (attributes.hasFallbackLineSpacing) attempt(r, view, 'fallbackLineSpacing', () => text(r, self, 'setFallbackLineSpacing', '(Z)V', [attributes.fallbackLineSpacing ? 1 : 0]));
    if (attributes.hasLetterSpacing) drawn('letterSpacing', () => text(r, self, 'setLetterSpacing', '(F)V', [attributes.letterSpacing]));
    if (!nullish(attributes.fontFeatureSettings)) drawn('fontFeatureSettings', () => text(r, self, 'setFontFeatureSettings', `(${STRING})V`, [attributes.fontFeatureSettings]));
    if (!nullish(attributes.fontVariationSettings)) drawn('fontVariationSettings', () => text(r, self, 'setFontVariationSettings', `(${STRING})Z`, [attributes.fontVariationSettings]));
    if (attributes.hasLineBreakStyle) drawn('lineBreakStyle', () => { tv.lineBreakStyle = attributes.lineBreakStyle; });
    if (attributes.hasLineBreakWordStyle) drawn('lineBreakWordStyle', () => { tv.lineBreakWordStyle = attributes.lineBreakWordStyle; });

    if (isPassword) attempt(r, view, 'password', () => { const owner = 'Landroid/text/method/PasswordTransformationMethod;'; text(r, self, 'setTransformationMethod', `(${TRANSFORM})V`, [statics(r, owner, 'getInstance', `()${owner}`, [])]); });
    if (maxlength >= 0) attempt(r, view, 'maxLength', () => {
      const owner = 'Landroid/text/InputFilter$LengthFilter;', filter = r.allocate(owner); call(r, 'direct', owner, '<init>', '(I)V', [filter, maxlength]);
      const filters = r.newArray(`[${FILTER}`, 1); r.object(filters).elements[0] = filter;
      text(r, self, 'setFilters', `([${FILTER})V`, [filters]);
    });

    // setText(text, bufferType), setHint(hint). A plain string in the default buffer is the text itself; anything else (styled text, a Spannable or Editable buffer) goes through the setter.
    if (textSet || bufferType !== null) attempt(r, view, textSet ? 'text' : 'bufferType', () => {
      const string = textSet ? plain(r, textValue) ?? (nullish(textValue) ? '' : null) : null;
      const direct = () => { view.text = string; platform.updateTextTransformation(r, self); };
      if (string !== null && string !== '' && tv.autoLinkMask !== 0 && !r.isSubtype(view.type, EDIT)) {
        // android:autoLink: setText runs Linkify over the text. Without the regular expression backend Linkify needs, the links are reported as not applied and the text is set.
        try { text(r, self, 'setText', `(${CHARS}${BUFFER})V`, [string, staticField(r, BUFFER, bufferType ?? 'NORMAL')]); }
        catch (error) { if (!isApkError(error)) throw error; platform.noteXmlAttributeNotApplied(r, 'autoLink', tag, String(error.message).replace(/\s+/g, ' ').slice(0, 200)); tv.autoLinkMask = 0; direct(); }
        return;
      }
      if (string !== null && (bufferType === null || bufferType === 'NORMAL' || r.isSubtype(view.type, EDIT))) { direct(); return; }
      if (!textSet && (bufferType === 'NORMAL' || r.isSubtype(view.type, EDIT))) return;
      const value = textSet ? (nullish(textValue) ? '' : textValue) : text(r, self, 'getText', `()${CHARS}`);
      text(r, self, 'setText', `(${CHARS}${BUFFER})V`, [value ?? '', staticField(r, BUFFER, bufferType ?? 'NORMAL')]);
    });
    if (!nullish(hint)) attempt(r, view, 'hint', () => { const string = plain(r, hint); if (string !== null) view.hint = string; else text(r, self, 'setHint', `(${CHARS})V`, [hint]); });

    // "TextViews that have input or movement methods are clickable by default": android:focusable, clickable and longClickable are read again from R.styleable.View and win
    // (so focusable="false" wins over focusableInTouchMode="true"). The View pass read that same TypedArray and left what it found (view.xmlFocusRead).
    const again = view.xmlFocusRead ?? null, canInputOrMove = keyListenerSet || movementSet || !nullish(view.keyListener) || !nullish(view.movementMethod); delete view.xmlFocusRead;
    if (again !== null || canInputOrMove) attempt(r, view, 'focusable', () => {
      const flag = name => !!call(r, 'virtual', VIEW, name, '()Z', [self]);
      const clickable = again?.clickable ?? (canInputOrMove || flag('isClickable')), longClickable = again?.longClickable ?? (canInputOrMove || flag('isLongClickable'));
      if (again?.focusable != null && again.focusable !== call(r, 'virtual', VIEW, 'getFocusable', '()I', [self])) call(r, 'virtual', VIEW, 'setFocusable', '(I)V', [self, again.focusable]);
      call(r, 'virtual', VIEW, 'setClickable', '(Z)V', [self, clickable ? 1 : 0]);
      call(r, 'virtual', VIEW, 'setLongClickable', '(Z)V', [self, longClickable ? 1 : 0]);
    });
    // "If not explicitly specified this view is important for accessibility."
    if ((view.importantForAccessibility || 0) === 0) attempt(r, view, 'importantForAccessibility', () => call(r, 'virtual', VIEW, 'setImportantForAccessibility', '(I)V', [self, 1]));

    // Auto-size: the preset sizes, or the uniform configuration with the defaults for what the attributes left out (12sp, 112sp, 1px). The search runs at the measure pass.
    if (autoSizeType !== null || autoSizePresets !== null) attempt(r, view, 'autoSizeTextType', () => {
      platform.textViewApi.autoSizeFromAttributes(r, self, { type: autoSizeType ?? 0, min: autoSizeMin, max: autoSizeMax, step: autoSizeStep, presets: autoSizePresets });
    });
    if (firstBaselineToTopHeight >= 0) attempt(r, view, 'firstBaselineToTopHeight', () => text(r, self, 'setFirstBaselineToTopHeight', '(I)V', [firstBaselineToTopHeight]));
    if (lastBaselineToBottomHeight >= 0) attempt(r, view, 'lastBaselineToBottomHeight', () => text(r, self, 'setLastBaselineToBottomHeight', '(I)V', [lastBaselineToBottomHeight]));
    if (lineHeight >= 0) drawn('lineHeight', () => text(r, self, 'setLineHeight', '(I)V', [lineHeight]));
    view.textViewAttributesApplied = true;
    return list.handled;
  };

  // ------------------------------------------------------------------------------------------------------------------------------------------- android.widget.CompoundButton
  /**
   * CompoundButton(Context, AttributeSet, int, int): android:button, buttonTint, buttonTintMode and checked. Read from the tag and its style="": the default style's button (the
   * check box or radio button indicator of the theme) is not loaded here, the lab draws the indicator of those widgets itself.
   */
  const applyCompoundButton = (r, self, node, context) => {
    const view = r.object(self), source = table();
    if (!r.isSubtype(view.type, COMPOUND) || !source || !context || !r.classes.has(TA) || !platform.styleBackend) return null;
    const list = styleable(r, 'CompoundButton', COMPOUND_BUTTON_ATTRIBUTES);
    // Without a tag (a button built in code: the original RadioButton / ToggleButton constructors pass their default style) there is only the default style, which this pass leaves to the lab's own indicator.
    if (!node || !tagGives(node, list.handled)) return list.handled;
    const array = platform.styleBackend.obtain(r, theme(r, context), attributeSet(r, node), ids(r, list), 0, 0), a = reader(r, array, list);
    try {
      if (a.has('button')) attempt(r, view, 'button', () => { const drawable = a.drawable('button'); if (!nullish(drawable)) call(r, 'virtual', COMPOUND, 'setButtonDrawable', `(${DRAWABLE})V`, [self, drawable]); });
      // android:button="@null" on the tag: a.getDrawable is null, so the original sets nothing and the tag's "@null" has overridden the style's indicator: the button has no
      // indicator at all (the hour and minute of the framework's time picker header are such RadioButtons). The lab draws its own indicator unless it is told there is none.
      else if (node.attributes.some(attribute => attribute.namespace === ANDROID_NAMESPACE && attribute.name === 'button')) attempt(r, view, 'button', () => call(r, 'virtual', COMPOUND, 'setButtonDrawable', '(I)V', [self, 0]));
      if (a.has('buttonTintMode')) attempt(r, view, 'buttonTintMode', () => call(r, 'virtual', COMPOUND, 'setButtonTintBlendMode', `(${BLEND})V`, [self, parseBlendMode(r, a.int('buttonTintMode', -1))]));
      if (a.has('buttonTint')) attempt(r, view, 'buttonTint', () => call(r, 'virtual', COMPOUND, 'setButtonTintList', `(${TINT})V`, [self, a.colors('buttonTint')]));
      if (a.has('checked')) attempt(r, view, 'checked', () => { view.checked = a.bool('checked', false); });   // setChecked before any listener exists: the state alone
    } finally { a.recycle(); }
    return list.handled;
  };

  // ------------------------------------------------------------------------------------------------------------------------------------------------- android.widget.Switch
  /** Switch.setSwitchTextAppearance(Context, int): the colour, size, typeface, style and capitals of the on / off text from a text appearance style. */
  const switchTextAppearance = (r, self, context, resid) => {
    const host = platform.drawableViewHost.switchHost, state = host.values(r, self), list = styleable(r, 'Switch.TextAppearance', ['textColor', 'textSize', 'typeface', 'textStyle', 'textAllCaps']);
    const style = platform.styleBackend.obtain(r, theme(r, context), null, ids(r, list), 0, 0, resid), t = reader(r, style, list);
    try {
      state.textColors = t.colors('textColor') ?? text(r, self, 'getTextColors', `()${TINT}`);   // "If no color set in TextAppearance, default to the view's textColor"
      const size = t.size('textSize', 0), paint = host.textPaint(r, self), PAINT = 'Landroid/graphics/Paint;';
      if (size !== 0 && size !== bitsFloat(call(r, 'virtual', PAINT, 'getTextSize', '()F', [paint]))) call(r, 'virtual', PAINT, 'setTextSize', '(F)V', [paint, floatBits(size)]);
      const TYPEFACE = 'Landroid/graphics/Typeface;', family = [null, 'SANS_SERIF', 'SERIF', 'MONOSPACE'][t.int('typeface', -1)] ?? null;   // setSwitchTypefaceByIndex
      host.setTypefaceStyle(r, self, family ? staticField(r, TYPEFACE, family) : null, t.int('textStyle', -1));
      state.allCaps = t.bool('textAllCaps', false);
    } finally { t.recycle(); }
    host.changed(r, self, true);
  };
  /**
   * Switch(Context, AttributeSet, int, int): R.styleable.Switch into the Switch's state (switch-widget-host.js), in the constructor's order. Where the VM measures and draws
   * the Switch itself (a Skia backend and the framework's styles) the state becomes the render state; in the page-laid-out flow mode the page draws its own switch, and the
   * attributes a tag carries are said to have no effect there.
   */
  const applySwitch = (r, self, node, context) => {
    const view = r.object(self), source = table(), host = platform.drawableViewHost?.switchHost;
    if (!r.isSubtype(view.type, SWITCH) || !source || !context || !host || !r.classes.has(TA) || !platform.styleBackend) return null;
    const styled = !!r.skia && !!platform.resources.frameworkXml;
    let defStyleAttr = 0, defStyleRes = 0;
    if (styled) { defStyleAttr = view.defStyleExplicit ? view.defStyleAttr | 0 : (view.defStyleAttr || source.findId(platform.drawableViewHost.defaultStyleName(r, view.type))) | 0; defStyleRes = view.defStyleRes | 0; }
    if (!node && !defStyleAttr && !defStyleRes) return null;
    const list = styleable(r, 'Switch', SWITCH_ATTRIBUTES);
    if (!styled && !tagGives(node, list.handled)) return list.handled;
    const array = platform.styleBackend.obtain(r, theme(r, context), attributeSet(r, node), ids(r, list), defStyleAttr, defStyleRes), a = reader(r, array, list), state = host.values(r, self);
    try {
      attempt(r, view, 'thumb', () => { state.thumb = a.drawable('thumb'); });
      attempt(r, view, 'track', () => { state.track = a.drawable('track'); });
      state.textOn = a.text('textOn'); state.textOff = a.text('textOff'); state.showText = a.bool('showText', true);
      state.thumbTextPadding = a.size('thumbTextPadding', 0); state.minWidth = a.size('switchMinWidth', 0); state.switchPadding = a.size('switchPadding', 0); state.splitTrack = a.bool('splitTrack', false);
      for (const part of ['thumb', 'track']) attempt(r, view, `${part}Tint`, () => {
        const tint = state.tint[part], colors = a.colors(`${part}Tint`), mode = parseBlendMode(r, a.int(`${part}TintMode`, -1));
        if (!nullish(colors)) { tint.list = colors; tint.hasList = true; }
        if (!nullish(mode)) { tint.mode = mode; tint.hasMode = true; }
        if (tint.hasList || tint.hasMode) host.applyTint(r, self, part);
      });
      const appearance = a.resource('switchTextAppearance', 0);
      if (appearance !== 0) attempt(r, view, 'switchTextAppearance', () => switchTextAppearance(r, self, context, appearance));
    } finally { a.recycle(); }
    if (styled) host.activate(r, self);
    else if (node) for (const attribute of node.attributes) if (attribute.namespace === ANDROID_NAMESPACE && list.handled.has(attribute.name)) noteNoEffect(r, attribute.name, tagOf(view), 'the page draws the switch itself in this mode; the value is kept for the Switch API');
    return list.handled;
  };

  base.addSubclassPass(applyTextView); base.addSubclassPass(applyCompoundButton); base.addSubclassPass(applySwitch);
  base.applyTextView = applyTextView; base.applyCompoundButton = applyCompoundButton; base.applySwitch = applySwitch; base.switchTextAppearance = switchTextAppearance;
}
