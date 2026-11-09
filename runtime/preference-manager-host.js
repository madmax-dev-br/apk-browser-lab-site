import { createHostRegistry } from './host-contract.js?v=e96a854757f6';

// android.preference.PreferenceManager's statics, following android-13.0.0_r1 frameworks/base/core/java/android/preference/PreferenceManager.java:
//   getDefaultSharedPreferences(Context)  = context.getSharedPreferences(packageName + "_preferences", MODE_PRIVATE)   (the same SharedPreferences instance, listeners and files as getSharedPreferences by that name)
//   setDefaultValues(Context, int, boolean) / (Context, String, int, int, boolean): unless the marker says it ran (KEY_HAS_SET_DEFAULT_VALUES in a SharedPreferences of that name) or readAgain, the preference XML
//   is inflated like PreferenceInflater does and every preference's android:defaultValue is written to the target SharedPreferences through one Editor, applied once, for keys that are not there yet; then the marker is set.
// The legacy android.preference.Preference classes are not in the framework DEX: what setDefaultValues needs from them (the tag -> class mapping, each class's onGetDefaultValue / onSetInitialValue, persistence rules)
// is done here per tag. A custom Preference subclass (a tag with a package) needs the real class and fails explicitly.
const CONTEXT = 'Landroid/content/Context;', PREFS = 'Landroid/content/SharedPreferences;', EDITOR = 'Landroid/content/SharedPreferences$Editor;', RESOURCES = 'Landroid/content/res/Resources;', STRING = 'Ljava/lang/String;', SET = 'Ljava/util/Set;';
const MANAGER = 'Landroid/preference/PreferenceManager;', KEY_HAS_SET_DEFAULT_VALUES = '_has_set_default_values', MODE_PRIVATE = 0;
const ANDROID = 'http://schemas.android.com/apk/res/android';
// tag -> how the class turns android:defaultValue into a value and what onSetInitialValue(false, default) persists
const KINDS = { CheckBoxPreference: 'boolean', SwitchPreference: 'boolean', TwoStatePreference: 'boolean', EditTextPreference: 'string', ListPreference: 'string', RingtonePreference: 'string', MultiSelectListPreference: 'set', SeekBarPreference: 'int', Preference: null };
const GROUPS = new Set(['PreferenceScreen', 'PreferenceCategory']);

export function createPreferenceManagerHost() {
  const registry = createHostRegistry(), { def, type } = registry;
  type(MANAGER, 'Ljava/lang/Object;', [], { allocatable: false });
  registry.staticField(MANAGER, 'KEY_HAS_SET_DEFAULT_VALUES', STRING, () => KEY_HAS_SET_DEFAULT_VALUES);
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const text = (r, value) => (value === null || value === undefined ? null : r.stringCharacters(value));
  const sharedPreferences = (r, context, name, mode) => call(r, context, CONTEXT, 'getSharedPreferences', [STRING, 'I'], PREFS, [name, mode]);
  const defaultName = (r, context) => `${text(r, call(r, context, CONTEXT, 'getPackageName', [], STRING))}_preferences`;   // getDefaultSharedPreferencesName
  const defaultMode = () => MODE_PRIVATE;                                                                                        // getDefaultSharedPreferencesMode

  const attribute = (node, name) => node.attributes.find(attr => attr.name === name && attr.namespace === ANDROID) ?? null;
  const INT = value => value >= 0x10 && value <= 0x1f;
  // TypedArray.getBoolean / getString / getInt / getTextArray over a compiled attribute (references resolve through Resources)
  const resourcesOf = (r, context) => call(r, context, CONTEXT, 'getResources', [], RESOURCES);
  const asBoolean = (r, context, attr) => {
    if (INT(attr.dataType)) return (attr.rawData | 0) !== 0;
    if (attr.dataType === 1) return !!call(r, resourcesOf(r, context), RESOURCES, 'getBoolean', ['I'], 'Z', [attr.reference]);
    const value = attr.dataType === 3 ? attr.value : null; return value === '1' || value === 'true' || value === 'TRUE';   // XmlUtils.convertValueToBoolean
  };
  const asString = (r, context, attr) => {
    if (attr.dataType === 3) return attr.value;
    if (attr.dataType === 1) return text(r, call(r, resourcesOf(r, context), RESOURCES, 'getString', ['I'], STRING, [attr.reference]));
    if (attr.dataType === 0x12) return (attr.rawData | 0) !== 0 ? 'true' : 'false';   // TypedValue.coerceToString of an int-boolean
    if (INT(attr.dataType)) return String(attr.rawData | 0);
    return null;
  };
  const asInt = (r, context, attr) => (INT(attr.dataType) ? attr.rawData | 0 : attr.dataType === 1 ? call(r, resourcesOf(r, context), RESOURCES, 'getInteger', ['I'], 'I', [attr.reference]) : 0);
  const asStringArray = (r, context, attr) => {
    if (attr.dataType !== 1) return null;
    const array = call(r, resourcesOf(r, context), RESOURCES, 'getTextArray', ['I'], '[Ljava/lang/CharSequence;', [attr.reference]);
    return array === null ? null : r.array(array).elements.map(item => (item === null ? null : r.stringCharacters(call(r, item, 'Ljava/lang/CharSequence;', 'toString', [], STRING))));
  };

  /** Writes the defaults of one inflated PreferenceScreen subtree (Preference.dispatchSetInitialValue for every preference with a key that persists). */
  const writeDefaults = (r, context, node, prefs, editor, path) => {
    const tag = node.name;
    if (tag.includes('.')) r.throwJava('Landroid/view/InflateException;', `${path}: Error inflating class ${tag}: custom Preference classes need the real android.preference.Preference, which is not available in the lab`);
    if (GROUPS.has(tag)) { for (const child of node.children) writeDefaults(r, context, child, prefs, editor, path); return; }
    if (!(tag in KINDS)) r.throwJava('Landroid/view/InflateException;', `${path}: Error inflating class android.preference.${tag}`);
    const key = attribute(node, 'key'), persistent = attribute(node, 'persistent'), defaultValue = attribute(node, 'defaultValue');
    if (node.children.length) r.throwJava('Landroid/view/InflateException;', `${path}: <${tag}> can not have child elements`);
    const keyText = key === null ? null : asString(r, context, key);
    const shouldPersist = (persistent === null || asBoolean(r, context, persistent)) && keyText !== null && keyText !== '';   // Preference.shouldPersist: persistent (default true) and hasKey
    if (!shouldPersist || defaultValue === null) return;
    if (call(r, prefs, PREFS, 'contains', [STRING], 'Z', [keyText])) return;   // onSetInitialValue(true, null) rewrites the persisted value with itself
    switch (KINDS[tag]) {
      case 'boolean': call(r, editor, EDITOR, 'putBoolean', [STRING, 'Z'], EDITOR, [keyText, asBoolean(r, context, defaultValue) ? 1 : 0]); break;
      case 'string': { const value = asString(r, context, defaultValue); if (value !== null) call(r, editor, EDITOR, 'putString', [STRING, STRING], EDITOR, [keyText, value]); break; }
      case 'int': call(r, editor, EDITOR, 'putInt', [STRING, 'I'], EDITOR, [keyText, asInt(r, context, defaultValue)]); break;
      case 'set': {   // MultiSelectListPreference.onGetDefaultValue: getTextArray -> HashSet
        const items = asStringArray(r, context, defaultValue) ?? r.throwJava('Ljava/lang/NullPointerException;', 'Attempt to get length of null array');
        const set = r.allocate('Ljava/util/HashSet;'); r.dispatch({ owner: 'Ljava/util/HashSet;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [set], 'direct');
        for (const item of items) call(r, set, SET, 'add', ['Ljava/lang/Object;'], 'Z', [item]);
        call(r, editor, EDITOR, 'putStringSet', [STRING, SET], EDITOR, [keyText, set]); break;
      }
      default: break;   // Preference: onSetInitialValue does nothing
    }
  };

  /** PreferenceManager.inflateFromResource + the editor commit: one edit session over the whole resource, applied once. */
  const setDefaults = (r, context, name, mode, resId, readAgain) => {
    const marker = sharedPreferences(r, context, KEY_HAS_SET_DEFAULT_VALUES, MODE_PRIVATE);
    if (!readAgain && call(r, marker, PREFS, 'getBoolean', [STRING, 'Z'], 'Z', [KEY_HAS_SET_DEFAULT_VALUES, 0])) return;
    const parser = call(r, resourcesOf(r, context), RESOURCES, 'getXml', ['I'], 'Landroid/content/res/XmlResourceParser;', [resId]);   // Resources.NotFoundException for a bad id, as ART
    const events = r.object(parser).events, root = events?.find(event => event.type === 2)?.node;
    call(r, parser, 'Landroid/content/res/XmlResourceParser;', 'close', [], 'V');
    if (!root) r.throwJava('Landroid/view/InflateException;', 'XML file has no root element');
    if (root.name !== 'PreferenceScreen') r.throwJava('Ljava/lang/ClassCastException;', `android.preference.${root.name} cannot be cast to android.preference.PreferenceScreen`);
    const prefs = sharedPreferences(r, context, name, mode), editor = call(r, prefs, PREFS, 'edit', [], EDITOR);
    writeDefaults(r, context, root, prefs, editor, `XML file ${resId.toString(16)}`);
    call(r, editor, EDITOR, 'apply', [], 'V');                                           // PreferenceManager.tryCommit: apply()
    const markerEditor = call(r, marker, PREFS, 'edit', [], EDITOR);
    call(r, markerEditor, EDITOR, 'putBoolean', [STRING, 'Z'], EDITOR, [KEY_HAS_SET_DEFAULT_VALUES, 1]); call(r, markerEditor, EDITOR, 'apply', [], 'V');
  };

  const nullContext = (r, context) => { if (context === null) r.throwJava('Ljava/lang/NullPointerException;', 'Attempt to invoke virtual method on a null object reference'); };
  def(MANAGER, 'getDefaultSharedPreferences', `(${CONTEXT})${PREFS}`, (r, _m, [context]) => { nullContext(r, context); return sharedPreferences(r, context, defaultName(r, context), defaultMode()); }, { static: true });
  def(MANAGER, 'setDefaultValues', `(${CONTEXT}IZ)V`, (r, _m, [context, resId, readAgain]) => { nullContext(r, context); setDefaults(r, context, defaultName(r, context), defaultMode(), resId, !!readAgain); }, { static: true });
  def(MANAGER, 'setDefaultValues', `(${CONTEXT}${STRING}IIZ)V`, (r, _m, [context, name, mode, resId, readAgain]) => { nullContext(r, context); setDefaults(r, context, text(r, name), mode, resId, !!readAgain); }, { static: true });
  return { ...registry, interfaces: registry.interfacesOf };
}
