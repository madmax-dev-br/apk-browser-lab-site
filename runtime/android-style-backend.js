import {prepareCpuAnimatedVector} from './animated-vector-native.js?v=7233a7b1ab13';
import { APKError } from './apk-runtime.js?v=7233a7b1ab13';
import { ephemeronMap } from './heap-gc.js?v=7233a7b1ab13';
import { hasNinePatchChunk } from './ninepatch-drawable-host.js?v=7233a7b1ab13';
import { sniffMime } from './bitmap-codec-host.js?v=7233a7b1ab13';
import { XML_ATTRIBUTE_GETTERS, XML_ATTRIBUTE_ENUMS } from './xml-attribute-readers.js?v=7233a7b1ab13';
const RESOURCES = 'Landroid/content/res/Resources;', THEME = 'Landroid/content/res/Resources$Theme;', TYPED_ARRAY = 'Landroid/content/res/TypedArray;', ASSETS = 'Landroid/content/res/AssetManager;', XML = 'Landroid/content/res/XmlBlock$Parser;';
const VALUE = 'Landroid/util/TypedValue;';
const NO_DRAWABLE = Symbol('no drawable');   // loadFileDrawable: a file that is neither XML nor an image (Resources.getDrawable answers null)
const fail = (message, details = {}) => { throw new APKError(`Resource backend: ${message}`, { kind: 'resource-backend-unsupported', ...details }); };
const empty = value => value == null || value === 0;
export const STYLE_METHODS = new Set();
const add = (owner, methods) => methods.forEach(method => STYLE_METHODS.add(`${owner}->${method}`));
for (const owner of ['Landroid/content/Context;', 'Landroid/content/ContextWrapper;', 'Landroid/view/ContextThemeWrapper;', 'Landroid/app/Activity;', 'Landroid/app/Application;']) add(owner, ['getDrawable(I)Landroid/graphics/drawable/Drawable;', 'getTheme()Landroid/content/res/Resources$Theme;', 'setTheme(I)V', 'obtainStyledAttributes([I)Landroid/content/res/TypedArray;', 'obtainStyledAttributes(I[I)Landroid/content/res/TypedArray;', 'obtainStyledAttributes(Landroid/util/AttributeSet;[I)Landroid/content/res/TypedArray;', 'obtainStyledAttributes(Landroid/util/AttributeSet;[III)Landroid/content/res/TypedArray;']);
add(RESOURCES, ['obtainTypedArray(I)Landroid/content/res/TypedArray;', 'getDrawable(I)Landroid/graphics/drawable/Drawable;', 'getDrawable(ILandroid/content/res/Resources$Theme;)Landroid/graphics/drawable/Drawable;', 'getDrawableForDensity(II)Landroid/graphics/drawable/Drawable;', 'getDrawableForDensity(IILandroid/content/res/Resources$Theme;)Landroid/graphics/drawable/Drawable;', 'loadDrawable(Landroid/util/TypedValue;IILandroid/content/res/Resources$Theme;)Landroid/graphics/drawable/Drawable;', 'loadComplexColor(Landroid/util/TypedValue;ILandroid/content/res/Resources$Theme;)Landroid/content/res/ComplexColor;', 'loadColorStateList(Landroid/util/TypedValue;ILandroid/content/res/Resources$Theme;)Landroid/content/res/ColorStateList;', 'getColorStateList(I)Landroid/content/res/ColorStateList;', 'getColorStateList(ILandroid/content/res/Resources$Theme;)Landroid/content/res/ColorStateList;', 'obtainAttributes(Landroid/content/res/Resources;Landroid/content/res/Resources$Theme;Landroid/util/AttributeSet;[I)Landroid/content/res/TypedArray;', 'getValue(ILandroid/util/TypedValue;Z)V', 'getValueForDensity(IILandroid/util/TypedValue;Z)V', 'getAssets()Landroid/content/res/AssetManager;', 'newTheme()Landroid/content/res/Resources$Theme;', 'obtainAttributes(Landroid/util/AttributeSet;[I)Landroid/content/res/TypedArray;']);
add(RESOURCES, ['selectDefaultTheme(II)I','selectSystemTheme(IIIIII)I']);
add(RESOURCES, ['getAnimation(I)Landroid/content/res/XmlResourceParser;','getAnimatorCache()Landroid/content/res/ConfigurationBoundResourceCache;','getStateListAnimatorCache()Landroid/content/res/ConfigurationBoundResourceCache;','getDrawableInflater()Landroid/graphics/drawable/DrawableInflater;']);
add(THEME, ['rebase()V','getKey()Landroid/content/res/Resources$ThemeKey;','applyStyle(IZ)V', 'setTo(Landroid/content/res/Resources$Theme;)V', 'getResources()Landroid/content/res/Resources;', 'resolveAttribute(ILandroid/util/TypedValue;Z)Z', 'obtainStyledAttributes([I)Landroid/content/res/TypedArray;', 'obtainStyledAttributes(I[I)Landroid/content/res/TypedArray;', 'obtainStyledAttributes(Landroid/util/AttributeSet;[III)Landroid/content/res/TypedArray;']);
add(ASSETS, ['getPooledStringForCookie(II)Ljava/lang/CharSequence;']);
add(XML, ['getPooledString(I)Ljava/lang/CharSequence;']);
// getThemeResId (@hide): ContextThemeWrapper and ContextImpl answer their mThemeResource (ContextImpl's is the theme getTheme chose), ContextWrapper asks its base
for (const owner of ['Landroid/content/Context;', 'Landroid/content/ContextWrapper;', 'Landroid/app/ContextImpl;', 'Landroid/view/ContextThemeWrapper;']) add(owner, ['getThemeResId()I']);

// ---- a value of a tag's attribute that no TypedArray getter of the attribute can read ---------------------------------------------------------------------------------------
// TypedArray.java (android-13.0.0_r1) reads a value by its type: a getter given a type it does not take throws (UnsupportedOperationException, NumberFormatException,
// Resources.NotFoundException), which on a device ends the inflation of the whole screen. The lab keeps such a value out of the TypedArray a tag is read with (the attribute
// is then absent, as if the tag did not carry it) and reports it under "XML attributes NOT APPLIED": an android: attribute never fails an inflation here, whatever its value
// (owner's rule; docs/XML-ATTRIBUTES.md, "A value of the wrong kind"). What a getter reads by coercion (getText and getString of any value, getBoolean, getInt of a string
// XmlUtils.convertValueToInt parses, a colour where a drawable is asked) is read as Android reads it.
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
const isInt = type => type >= 0x10 && type <= 0x1f, isColor = type => type >= 0x1c && type <= 0x1f;
/**
 * What TypedArray.getInt makes of the text of a string value: com.android.internal.util.XmlUtils.convertValueToInt (android-13.0.0_r1), which the getter gives the text to.
 * `fallback` for an empty text (the getter's default); a leading '-', then "0x" / "0X" or '#' (hexadecimal), a leading '0' (octal), else decimal; the digits go to
 * Integer.parseInt(text, radix), which takes one more sign, only digits of the radix and only the range of an int. null where the original throws: "0xffffffff", "09",
 * " 5 " and "99999999999" are a NumberFormatException, a lone "-" a StringIndexOutOfBoundsException.
 */
export function convertValueToInt(text, fallback = 0) {
  const nm = String(text ?? ''); if (nm.length === 0) return fallback;
  let index = 0, base = 10, sign = 1;
  if (nm[0] === '-') { sign = -1; index++; }
  if (index >= nm.length) return null;
  if (nm[index] === '0') { if (index === nm.length - 1) return 0; const c = nm[index + 1]; if (c === 'x' || c === 'X') { index += 2; base = 16; } else { index++; base = 8; } }
  else if (nm[index] === '#') { index++; base = 16; }
  const digits = /^([+-]?)([0-9a-zA-Z]+)$/.exec(nm.slice(index)); if (!digits) return null;
  let value = 0n; for (const c of digits[2].toLowerCase()) { const digit = parseInt(c, 36); if (digit >= base) return null; value = value * BigInt(base) + BigInt(digit); if (value > 2147483648n) return null; }
  if (digits[1] === '-') value = -value; else if (value > 2147483647n) return null;
  return Math.imul(Number(value), sign);
}
const intText = value => convertValueToInt(value.value) !== null, FLOAT_TEXT = /^\s*[-+]?(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|NaN|Infinity)[fFdD]?\s*$/;
/** getter -> whether it reads a value of this type without throwing (type: Res_value dataType after the reference was followed; file: the value is a resource file path). */
const READS = {
  getDrawable: (type, value) => isColor(type) || type === 3 && !!value.resourceId, getColorStateList: (type, value) => isColor(type) || type === 3 && !!value.resourceId,
  getColor: (type, value) => isInt(type) || type === 3 && !!value.resourceId,
  getDimension: type => type === 5, getDimensionPixelOffset: type => type === 5, getDimensionPixelSize: type => type === 5, getLayoutDimension: type => type === 5 || isInt(type),
  getInt: (type, value) => isInt(type) || type === 3 && intText(value), getInteger: type => isInt(type),
  getFloat: (type, value) => type === 4 || isInt(type) || type === 3 && FLOAT_TEXT.test(String(value.value ?? '')), getFraction: type => type === 6,
  getTextArray: (type, value, bag) => bag,
  // View's pointerIcon: a.getResourceId, and when that is 0 a.getInt (a system icon type)
  getResourceIdOrInt: (type, value) => !!value.resourceId || isInt(type) || type === 3 && intText(value),
};
const THROWS = { getDrawable: 'Resources.NotFoundException', getColorStateList: 'UnsupportedOperationException', getColor: 'UnsupportedOperationException', getDimension: 'UnsupportedOperationException',
  getDimensionPixelOffset: 'UnsupportedOperationException', getDimensionPixelSize: 'UnsupportedOperationException', getLayoutDimension: 'UnsupportedOperationException', getInt: 'NumberFormatException',
  getInteger: 'UnsupportedOperationException', getFloat: 'NumberFormatException', getFraction: 'UnsupportedOperationException', getTextArray: 'Resources.NotFoundException', getResourceIdOrInt: 'NumberFormatException' };
const TYPE_NAMES = { 1: 'a reference', 2: 'a theme attribute', 3: 'a string', 4: 'a float', 5: 'a dimension', 6: 'a fraction', 0x10: 'an integer', 0x11: 'an integer', 0x12: 'a boolean' };

// ---- a value a getter reads, and what Android does with it next throws -----------------------------------------------------------------------------------------------------
// A menu is built by the original MenuInflater and MenuBuilder in one pass over the XML, so a value they refuse cannot be found by building the item again without one
// attribute (as a View or its LayoutParams are: AndroidPlatform.recoverViewConstruction / recoverLayoutParams). These are the checks of that code, made before it reads.
const numberOf = (type, value) => isInt(type) ? value.rawData | 0 : type === 3 ? convertValueToInt(value.value, null) : null;
const emptyShortcut = (type, value) => type === 3 && String(value.value ?? '') === '' ? 'the value is an empty text, and MenuInflater.getShortcut reads its first character (StringIndexOutOfBoundsException on a device, where the menu fails to inflate); the lab leaves the attribute out' : null;
const REFUSED = {
  // MenuBuilder.getOrdering: (category & CATEGORY_MASK) >> CATEGORY_SHIFT indexes sCategoryToOrder, which has six entries (none, container, system, secondary, alternative, selected alternative)
  menuCategory: (type, value) => { const number = numberOf(type, value), index = number === null ? 0 : (number & 0xffff0000) >> 16; return index < 0 || index >= 6 ? `the value ${number} is no menu category: MenuBuilder.getOrdering throws IllegalArgumentException "order does not contain a valid category" (on a device the menu fails to inflate); the lab leaves the attribute out` : null; },
  alphabeticShortcut: emptyShortcut, numericShortcut: emptyShortcut,
};

/** Native resource-data boundary. TypedArray/TypedValue/Pools algorithms stay in original AOSP DEX. */
// Attributes an original framework constructor acts on with a class the framework build does not have (AndroidStyleBackend.withheld).
const WITHHELD = [
  // AbsListView(Context, AttributeSet, ..): setFastScrollEnabled(true) / setFastScrollAlwaysVisible(true) create the FastScroller, whose views live in ViewGroup.getOverlay()
  { attributes: ['fastScrollEnabled', 'fastScrollAlwaysVisible'], when: value => value.dataType === 0x12 && (value.rawData | 0) !== 0, missing: ['Landroid/view/ViewGroupOverlay;'],
    reason: "the list's fast scroller is drawn in ViewGroup.getOverlay(), and this framework has no ViewOverlay / ViewGroupOverlay (original classes of the layouts profile, which every framework with the list widgets has: this only happens with a reduced build)" },
];
export class AndroidStyleBackend {
  constructor(platform) { this.platform = platform; this.poolStrings = new Map(); this.xmlCookieSequence = 0; }
  put(runtime, ref, owner, name, type, value) { const field = runtime.resolveField({ owner, name, type, key: `${owner}->${name}:${type}` }); runtime.storeField(runtime.object(ref).fields, field.key, value); }
  get(runtime, ref, owner, name, type) { const field = runtime.resolveField({ owner, name, type, key: `${owner}->${name}:${type}` }); return runtime.object(ref).fields.get(field.key); }
  /** The Resources being served: the scoped configuration Resources (platform.withResources), else the app's default one. */
  resourceObject(runtime) {
    const scope = this.platform.resourcePackage ?? null;   // a second installed package's resources in scope (android-platform.js withPackageResources): its own Resources object
    const resources = this.platform.activeResources ?? (scope ? this.platform.packages.packageResources(runtime, scope) : (this.platform.resourceObject ??= runtime.makeObject(RESOURCES)));
    if (!this.get(runtime, resources, RESOURCES, 'mTypedArrayPool', 'Landroid/util/Pools$SynchronizedPool;')) {
      const type = 'Landroid/util/Pools$SynchronizedPool;';
      if (!runtime.classes.has(type)) fail('Original AOSP Pools DEX is required for the resource TypedArray pool');
      const pool = runtime.allocate(type); runtime.dispatch({ owner: type, name: '<init>', signature: '(I)V', parameters: ['I'], result: 'V' }, [pool, 5], 'direct');
      this.put(runtime, resources, RESOURCES, 'mTypedArrayPool', type, pool);
    }
    return resources;
  }
  assetObject(runtime) { return this.assets ??= runtime.makeObject(ASSETS); }
  reflectionDefinition(owner,kind,name,parameters){if(owner!==THEME||kind!=='method'||name!=='rebase'||parameters?.length)return null;return {method:{owner,name,parameters:[],result:'V',signature:'()V',key:owner+'->rebase()V'},flags:1};}
  rebaseTheme(runtime,theme){
    const owner=runtime.object(theme).resources??null;if((this.platform.activeResources??null)!==owner)return this.platform.withResources(runtime,owner,()=>this.rebaseTheme(runtime,theme));   // replay against the configuration of the Resources the Theme belongs to
    const object=runtime.object(theme), values=new Map(), table=this.platform.resources?.table;if(!table)fail('Theme rebase requires actual resource bags');
    // Theme.rebase's public Android contract: replay the applied styles in
    // order against current resource configuration; retain identity and key.
    for(const {id,force} of object.appliedStyles)for(const [attribute,value]of table.resolveBag(id))if(force||!values.has(attribute))values.set(attribute,value);
    object.themeValues=values;runtime.record('RESOURCE Theme.rebase [real applied-style history and compiled resource bags]');
  }
  createTheme(runtime) { const ref = runtime.makeObject(THEME); runtime.object(ref).resources = this.platform.activeResources ?? null; if (this.platform.resourcePackage) runtime.object(ref).packageEntry = this.platform.resourcePackage;   /* a Theme of a second package resolves in its table */ runtime.object(ref).themeValues = new Map(); runtime.object(ref).appliedStyles = []; (this.themeRefs ??= ephemeronMap(runtime, new Map())).set(ref.ref, ref); return ref; }   // weakly held: a Theme nothing else references is collected
  /** Resources.updateConfiguration: every live Theme replays its applied styles against the new configuration (identity and key retained). */
  refreshThemes(runtime) { for (const ref of this.themeRefs?.values() ?? []) this.rebaseTheme(runtime, ref); }
  originalThemeMethod(runtime, context, startType, name, parameters, result, values = []) {
    const signature = `(${parameters.join('')})${result}`, seen = new Set();
    for (let owner = startType; owner; owner = runtime.parent(owner)) {
      if (seen.has(owner) || seen.size >= 64) fail('Cyclic theme class hierarchy'); seen.add(owner);
      if (runtime.classes.get(owner)?.methods.has(name + signature)) {
        return { handled: true, value: runtime.dispatch({ owner, name, parameters, result, signature }, [context, ...values], 'direct') };
      }
    }
    return { handled: false };
  }
  copyTheme(runtime, target, source) {
    const object = runtime.object(target), original = runtime.object(source);
    if(object.originalThemeKey){const type='Landroid/content/res/Resources$ThemeKey;';runtime.dispatch({owner:type,name:'setTo',parameters:[type],result:'V',signature:`(${type})V`},[object.originalThemeKey,this.themeKey(runtime,source)],'virtual');}
    object.themeValues = new Map(original.themeValues); object.appliedStyles = original.appliedStyles.slice();
  }
  theme(runtime, context, startType = runtime.typeOf(context)) {
    const scoped=this.platform.overrideResources(runtime,this.platform.resourcesForContext?.(runtime,context));if(scoped!==(this.platform.activeResources??null))return this.platform.withResources(runtime,scoped,()=>this.theme(runtime,context,startType));   // the Context's own Resources (a configuration Context wins over its Activity's) select every variant of its Theme
    const original = this.originalThemeMethod(runtime, context, startType, 'getTheme', [], THEME);
    if (original.handled) return original.value;
    const object = runtime.object(context); if (object.themeRef) return object.themeRef;
    // A ContextWrapper super call delegates to its actual base. An Activity or
    // themed Context uses its own theme; inherited attributes are copied once.
    if (object.baseContext && (startType === 'Landroid/content/ContextWrapper;' || !object.themeResId)) return this.theme(runtime, object.baseContext);
    // The manifest of the Context's own package: a Context of a second installed package (its ContextImpl, which an AppCompat Activity asks for its Theme in attachBaseContext,
    // before ActivityThread sets the Activity's theme) takes its theme and targetSdkVersion from that package, never from the app's (whose style ids name other resources).
    const entry = this.platform.packages?.contextEntry?.(runtime, context), manifest = entry && !entry.main ? entry.manifest : this.platform.manifest;
    const name = object.type.slice(1, -1).replaceAll('/', '.'), plain = name.replace(/\$\$ldr\d+$/, '');
    const declaration = manifest?.activities?.find(activity => activity.name === name || activity.name === plain);
    let id = object.themeResId || declaration?.theme || manifest?.application?.theme;
    // No manifest theme: ContextImpl.getTheme asks the original Resources.selectDefaultTheme(0, targetSdkVersion).
    if (!id) id = runtime.dispatch({ owner: RESOURCES, name: 'selectDefaultTheme', parameters: ['I', 'I'], result: 'I', signature: '(II)I' }, [0, Number(manifest?.usesSdk?.targetSdkVersion ?? 1)], 'static');
    if (!id) fail('Resources.selectDefaultTheme returned no theme');
    object.themeRef = this.createTheme(runtime); object.themeResId = Number(id) >>> 0;
    if (object.baseContext) { const base = this.theme(runtime, object.baseContext); if (base) this.copyTheme(runtime, object.themeRef, base); }
    this.applyStyle(runtime, object.themeRef, object.themeResId, true); return object.themeRef;
  }
  applyStyle(runtime, theme, id, force) {
    const table = this.platform.resources?.table; if (!table) fail('APK resources are unavailable');
    // Theme.applyStyle of a style that cannot be read (AssetManager2::GetBag fails) leaves the theme as it was, without an exception: reported, as obtain does for a style.
    let bag; try { bag = table.resolveBag(id); } catch (failure) { if (failure?.name !== 'AndroidResourceError') throw failure; this.platform.noteResourceUnresolved(runtime, `style 0x${(id >>> 0).toString(16)} applied to a theme`, `not readable, the theme is left without it: ${failure.message}`); bag = new Map(); }
    const object = runtime.object(theme);
    if(object.appliedStyles.length>=4096)fail('Theme applied-style history exceeds4096 entries');
    for (const [attribute, value] of bag) if (force || !object.themeValues.has(attribute)) object.themeValues.set(attribute, value);
    object.appliedStyles.push({ id, force });
    if(object.originalThemeKey){const owner='Landroid/content/res/Resources$ThemeKey;';runtime.dispatch({owner,name:'append',parameters:['I','Z'],result:'V',signature:'(IZ)V'},[object.originalThemeKey,id|0,force?1:0],'virtual');}
  }
  themeKey(runtime,theme){
    const object=runtime.object(theme),owner='Landroid/content/res/Resources$ThemeKey;';
    if(!object.originalThemeKey){if(!runtime.classes.has(owner))fail('Original Resources.ThemeKey source is required for animator cache keys');const key=runtime.allocate(owner);runtime.dispatch({owner,name:'<init>',parameters:[],result:'V',signature:'()V'},[key],'direct');for(const style of object.appliedStyles)runtime.dispatch({owner,name:'append',parameters:['I','Z'],result:'V',signature:'(IZ)V'},[key,style.id|0,style.force?1:0],'virtual');object.originalThemeKey=key;}
    return object.originalThemeKey;
  }
  resolved(value, values, resolveReferences = true) {
    const result = this.platform.resources.table.resolveThemeValue(value, values, { resolveReferences });
    if (result.kind === 'unresolved') fail(result.reason, { resourceId: result.reference || result.id });
    if (result.kind === 'bag') return { ...value, kind: 'reference', dataType: 1, rawData: result.id, reference: result.id, resourceId: result.id };
    return result;
  }
  /** The resource name of an attribute id for diagnostics ("attr/name"), or "(unnamed)". */
  attributeName(id) { try { const table = this.platform.resources.table; for (const [name, value] of table.names) if (value === (id >>> 0) && name.startsWith('attr/')) return name; } catch { /* diagnostics only */ } return '(unnamed)'; }   // diagnostics only: a scan of every name
  typedValue(runtime, ref, value) {
    for (const [name, type, data] of [['type', 'I', value.dataType || 0], ['data', 'I', value.rawData | 0], ['assetCookie', 'I', value.sourceCookie || 0], ['resourceId', 'I', value.resourceId || 0], ['changingConfigurations', 'I', value.changingConfigurations || 0], ['density', 'I', value.density || 0], ['sourceResourceId', 'I', value.sourceResourceId || 0], ['string', 'Ljava/lang/CharSequence;', value.kind === 'string' ? value.value : null]]) this.put(runtime, ref, VALUE, name, type, data);
  }
  /**
   * Whether the value of an attribute is kept out of the TypedArray an original constructor reads from a tag. Only for what the constructor could not survive: it would call
   * into a part of Android that is not in the virtual device and fail the whole inflation. The attribute is reported under "XML attributes NOT APPLIED" with what is missing;
   * the same call from the app's code still fails explicitly.
   */
  withheld(runtime, id, value, node) {
    const names = this.withheldIds ??= (() => { const table = this.platform.resources?.frameworkTable, map = new Map(); if (table) for (const rule of WITHHELD) for (const name of rule.attributes) { const found = this.platform.viewXmlAttributes?.kit.attributeId(name) || table.findId('attr/' + name); if (found) map.set(found >>> 0, { name, rule }); } /* the public id, which a compiled layout carries */ return map; })();
    const entry = names.get(id); if (!entry || !entry.rule.when(value) || entry.rule.missing.every(type => runtime.classes.has(type))) return false;
    this.platform.noteXmlAttributeNotApplied(runtime, entry.name, node.name, entry.rule.reason);
    return true;
  }
  /** The type name of a resource id ("layout", "id", "drawable"), from the names of the resource table: known for an id whose own entry is missing as long as its type has any entry. */
  resourceTypeName(id) {
    const types = this.resourceTypes ??= (() => { const map = new Map(); try { for (const [name, value] of this.platform.resources.table.names) { const key = value >>> 16; if (!map.has(key)) map.set(key, name.slice(0, name.indexOf('/'))); } } catch { /* an unreadable name table: no type is known */ } return map; })();
    return types.get(id >>> 16) ?? null;
  }
  /**
   * Why the value a tag gives an attribute cannot be read by any getter the original constructors read that attribute with, or null when one reads it (or nothing is known
   * about how the attribute is read). `original` is the attribute as the tag has it, `value` what following its reference gave, `missing` why that stopped short.
   */
  unreadable(original, value, missing) {
    const name = original.name; if (!name || original.namespace && original.namespace !== ANDROID_NS) return null;
    const type = value.dataType || 0;
    if (type === 0) return null;   // @null, or no value: absent for every getter
    // A reference to a resource that is not there cannot be loaded by anything (TypedArray.getResourceId still answers the id, and the layout, animation, style or drawable it names
    // then fails to load). An id is the exception: it is a number to compare with, whether or not the table has an entry for it.
    if (type === 1 && missing && this.resourceTypeName(value.reference >>> 0) !== 'id') return `the value refers to resource 0x${(value.reference >>> 0).toString(16)}, which cannot be read: ${String(missing).replace(/\s+/g, ' ').slice(0, 200)}`;
    const legal = XML_ATTRIBUTE_ENUMS[name];
    if (legal && isInt(type) && type !== 0x12 && !legal.includes(value.rawData | 0)) return `the value ${value.rawData | 0} is not one of the numbers android-13 declares for the attribute (${legal.join(', ')}): a value of a newer release, or not a value at all`;
    const refused = REFUSED[name]?.(type, value); if (refused) return refused;
    const getters = XML_ATTRIBUTE_GETTERS[name]?.split(','); if (!getters) return null;
    let bag = false; if (type === 1 && !missing) { try { let entry = this.platform.resources.resolve(value.reference >>> 0); for (let guard = 0; entry?.resolved && guard < 20; guard++) entry = entry.resolved; bag = entry?.kind === 'bag'; } catch { bag = false; } }
    if (getters.some(getter => !READS[getter] || READS[getter](type, value, bag))) return null;
    const what = type === 1 ? (bag ? `a reference to a style or an array (0x${(value.reference >>> 0).toString(16)})` : `a reference to resource 0x${(value.reference >>> 0).toString(16)}, which is not in the resource table${(value.reference >>> 24) === 0x7f ? ' (a resource of a configuration split that is not loaded, or removed by a resource shrinker)' : ''}`)
      : type === 2 ? `the theme attribute 0x${(value.reference >>> 0).toString(16)}, which the theme gives no value` : isColor(type) ? 'a colour' : TYPE_NAMES[type] ?? `a value of type 0x${type.toString(16)}`;
    return `the value is ${what}, which TypedArray.${getters[0]} does not read (${THROWS[getters[0]]} on a device, where the layout fails to inflate); the lab leaves the attribute out`;
  }
  obtain(runtime, themeRef, attrsRef, requestedRef, defStyleAttr = 0, defStyleRes = 0, styleId = 0, useTheme = true) {
    if (!runtime.classes.has(TYPED_ARRAY)) fail('Original AOSP TypedArray DEX is required; no JS getter substitute is installed');
    // Theme.obtainStyledAttributes resolves with the Resources the Theme was created from: an Activity whose configuration AppCompat overrides (setDefaultNightMode, a
    // per-Activity locale) reads @color/... and @drawable/... of its layouts in that configuration (values-night), as its theme already is
    const scoped = themeRef ? this.platform.overrideResources?.(runtime, runtime.object(themeRef).resources) ?? null : null;
    if (scoped !== (this.platform.activeResources ?? null) && this.platform.withResources) return this.platform.withResources(runtime, scoped, () => this.obtain(runtime, themeRef, attrsRef, requestedRef, defStyleAttr, defStyleRes, styleId, useTheme));
    const requested = runtime.array(requestedRef).elements;
    if (requested.length > 4096) fail('Styled attribute request exceeds 4096 IDs');
    const theme = themeRef ? runtime.object(themeRef).themeValues : new Map();
    const values = useTheme ? new Map(theme) : new Map();
    const table = this.platform.resources.table;
    // AssetManager2::GetBag fails for a style that cannot be read (it does not exist, or a parent of its chain does not): ApplyStyle then reads the attributes without that style. Reported.
    // The report names the tag being read, or the class of a View built in code (readingFor, set by the constructor passes).
    const node = empty(attrsRef) ? null : runtime.object(attrsRef).node, reader = node?.name ?? this.readingFor ?? null;
    const merge = (id, role) => { if (!id) return; let bag; try { bag = table.resolveBag(id); } catch (failure) { if (failure?.name !== 'AndroidResourceError') throw failure; this.platform.noteResourceUnresolved(runtime, `${role} 0x${(id >>> 0).toString(16)}${reader ? ` of <${reader}>` : ''}`, `not readable, read without it: ${failure.message}`); return; } for (const [attr, value] of bag) values.set(attr, value); };
    let defaultStyle = defStyleRes;
    if (defStyleAttr) { const found = table.getThemeAttribute(theme, defStyleAttr, false); if (found?.value.kind === 'reference' && found.value.reference) defaultStyle = found.value.reference; }   // ApplyStyle: theme->GetAttribute(def_style_attr), a TYPE_REFERENCE names the default style
    if (defaultStyle) merge(defaultStyle, 'default style');
    if (styleId) merge(styleId, 'style');
    const xmlStyle = node?.attributes.find(attribute => attribute.name === 'style');
    if (xmlStyle) {   // ApplyStyle: the style="" attribute is a @style reference or a ?attr the theme resolves to one; anything else is no style
      const id = xmlStyle.kind === 'attribute' ? (found => (found?.value.kind === 'reference' ? found.value.reference : 0))(table.getThemeAttribute(theme, xmlStyle.reference, false)) : xmlStyle.kind === 'reference' ? xmlStyle.reference : 0;
      if (!id && xmlStyle.kind === 'attribute') this.platform.noteResourceUnresolved(runtime, `style="?attr" 0x${(xmlStyle.reference >>> 0).toString(16)} on <${node.name}>`, 'the theme has no style reference for it');
      merge(id, 'style');
    }
    const held = node ? this.platform.withheldFor?.(node) : null;   // attributes a failed constructor is being run again without
    const direct = new Map(); for (const attr of node?.attributes || []) if (attr.resourceId && !held?.has(attr)) direct.set(attr.resourceId >>> 0, { ...attr, nameResourceId: attr.resourceId, resourceId: attr.dataType === 1 ? attr.reference : 0, sourceCookie: attr.kind === 'string' ? -1 : attr.sourceCookie, fromXml: true });
    const resources = this.resourceObject(runtime);
    const array = runtime.dispatch({ owner: TYPED_ARRAY, name: 'obtain', signature: '(Landroid/content/res/Resources;I)Landroid/content/res/TypedArray;', parameters: [RESOURCES, 'I'], result: TYPED_ARRAY }, [resources, requested.length], 'static');
    const data = runtime.array(this.get(runtime, array, TYPED_ARRAY, 'mData', '[I')).elements, indices = runtime.array(this.get(runtime, array, TYPED_ARRAY, 'mIndices', '[I')).elements;
    data.fill(0); indices.fill(0); const xmlStrings = new Map();
    requested.forEach((id, index) => {
      let original = direct.get(id >>> 0) || values.get(id >>> 0); if (!original) return;
      let { value, missing } = table.resolveAttributeReference(original, useTheme ? theme : null);
      // A value of the tag that no getter of the attribute reads (a string where a dimension is read, a resource that is not there) is left out and reported, once per parse:
      // the attribute is then what the tag's style, the default style or the theme gives it, as for a tag that does not carry it.
      if (node && original.fromXml && this.platform.xmlHost?.isLayoutNode(node)) {
        const reason = this.unreadable(original, value, missing);
        if (reason) {
          const size = original.name === 'layout_width' || original.name === 'layout_height', seen = this.unreadableNoted ??= new WeakMap(), mark = `${this.platform.xmlHost?.serial ?? 0}:${id}`;
          if (!seen.get(node)?.includes(mark)) { seen.set(node, [...(seen.get(node) ?? []).filter(entry => entry.startsWith(mark.split(':')[0] + ':')), mark]); this.platform.noteXmlAttributeNotApplied(runtime, original.name, node.name, size ? `${reason}; a View needs the two sizes, so it is given wrap_content` : reason); }
          // LayoutParams.setBaseAttributes fails without a size ("You must supply a layout_width attribute"): an unreadable size is wrap_content.
          if (size) { const at = index * 7; data[at] = 0x10; data[at + 1] = -2; data[at + 2] = -1; indices[++indices[0]] = index; return; }
          original = values.get(id >>> 0); if (!original) return;
          ({ value, missing } = table.resolveAttributeReference(original, useTheme ? theme : null));
        }
      }
      if (missing) this.platform.noteResourceUnresolved(runtime, `attribute 0x${(id >>> 0).toString(16)}${node ? ` on <${node.name}>` : ''}`, missing);
      // An attribute of a tag that an original constructor would act on with something the virtual device does not have is withheld from the constructor's TypedArray and
      // reported as not applied (an android: attribute never fails the inflation): see WITHHELD.
      if (node && this.withheld(runtime, id >>> 0, value, node)) return;
      const at = index * 7, cookie = value.sourceCookie ?? original.sourceCookie ?? 1;
      data[at] = value.dataType || 0; data[at + 1] = value.rawData | 0; data[at + 2] = cookie; data[at + 3] = value.resourceId || 0; data[at + 4] = value.changingConfigurations || 0; data[at + 5] = value.density || 0; data[at + 6] = value.sourceResourceId || original.sourceResourceId || 0;
      if (value.dataType === 3) { if (cookie < 0) xmlStrings.set(value.rawData, value.value); else { if (!this.poolStrings.has(cookie)) this.poolStrings.set(cookie, new Map()); this.poolStrings.get(cookie).set(value.rawData, value.value); } }
      if (value.dataType || value.rawData === 1) indices[++indices[0]] = index;
    });
    this.put(runtime, array, TYPED_ARRAY, 'mTheme', THEME, themeRef || null);
    if (node) { const parser = runtime.makeObject(XML); runtime.object(parser).pooledStrings = xmlStrings; runtime.object(parser).styledNode = node; this.put(runtime, array, TYPED_ARRAY, 'mXml', XML, parser); }
    runtime.record(`RESOURCE styled attributes ${requested.length} (${indices[0]} present; original data)`);
    return array;
  }
  /** Resources.obtainTypedArray(id) over an <array> / <string-array> / <integer-array> / <array> of @references bag (ResourcesImpl.obtainTypedArray): one 7-int record per item, references resolved. */
  obtainResourceArray(runtime, id) {
    if (!runtime.classes.has(TYPED_ARRAY)) fail('Original AOSP TypedArray DEX is required; no JS getter substitute is installed');
    let bag = this.platform.resources.resolve(id); while (bag.resolved) bag = bag.resolved;   // an <item type="array"> alias names another array
    if (bag.kind !== 'bag') this.platform.resourceNotFound(runtime, id, bag, `Array resource ID #0x${(id >>> 0).toString(16)}`);   // ResourcesImpl.obtainTypedArray: getResourceArraySize < 0
    const resources = this.resourceObject(runtime), items = bag.items;
    const array = runtime.dispatch({ owner: TYPED_ARRAY, name: 'obtain', signature: '(Landroid/content/res/Resources;I)Landroid/content/res/TypedArray;', parameters: [RESOURCES, 'I'], result: TYPED_ARRAY }, [resources, items.length], 'static');
    const data = runtime.array(this.get(runtime, array, TYPED_ARRAY, 'mData', '[I')).elements, indices = runtime.array(this.get(runtime, array, TYPED_ARRAY, 'mIndices', '[I')).elements;
    data.fill(0); indices.fill(0);
    items.forEach((original, index) => {
      const { value, missing } = this.platform.resources.table.resolveAttributeReference(original, null);
      if (missing) this.platform.noteResourceUnresolved(runtime, `item ${index} of array 0x${(id >>> 0).toString(16)}`, missing);
      const at = index * 7, cookie = value.sourceCookie ?? original.sourceCookie ?? 1;
      data[at] = value.dataType || 0; data[at + 1] = value.rawData | 0; data[at + 2] = cookie; data[at + 3] = value.resourceId || 0; data[at + 4] = value.changingConfigurations || 0; data[at + 5] = value.density || 0; data[at + 6] = value.sourceResourceId || 0;
      if (value.dataType === 3) { if (!this.poolStrings.has(cookie)) this.poolStrings.set(cookie, new Map()); this.poolStrings.get(cookie).set(value.rawData, value.value); }
      if (value.dataType || value.rawData === 1) indices[++indices[0]] = index;
    });
    return array;
  }
  loadColor(runtime, id, theme, suppliedValue = null) {
    const COLOR = 'Landroid/content/res/ColorStateList;';
    if (!runtime.classes.has(COLOR)) fail('Original AOSP ColorStateList DEX is required');
    let type, data;
    if (suppliedValue) { type = this.get(runtime, suppliedValue, VALUE, 'type', 'I'); data = this.get(runtime, suppliedValue, VALUE, 'data', 'I'); }
    else { let value = this.platform.resources.resolve(id); while (value.resolved) value = value.resolved; if (value.kind === 'unresolved' || value.kind === 'bag') this.platform.resourceNotFound(runtime, id, value, `Resource ID #0x${(id >>> 0).toString(16)}`); type = value.dataType; data = value.rawData; }   // Resources.getColorStateList: getValue first
    if (type >= 28 && type <= 31) return runtime.dispatch({ owner: COLOR, name: 'valueOf', signature: '(I)Landroid/content/res/ColorStateList;', parameters: ['I'], result: COLOR }, [data | 0], 'static');
    const tree = this.platform.xmlResource(runtime, id, 'color state list');
    if (tree.name !== 'selector') fail(`Original color XML <${tree.name}> requires its own compiled color/shader implementation`, { resourceId: id });
    const parser = this.platform.xmlHost.create(runtime, tree, id);
    return runtime.dispatch({ owner: COLOR, name: 'createFromXml', signature: '(Landroid/content/res/Resources;Lorg/xmlpull/v1/XmlPullParser;Landroid/content/res/Resources$Theme;)Landroid/content/res/ColorStateList;', parameters: [RESOURCES, 'Lorg/xmlpull/v1/XmlPullParser;', THEME], result: COLOR }, [this.resourceObject(runtime), parser, theme || null], 'static');
  }
  /**
   * Resources.loadDrawable for a drawable that is an image FILE of the APK (ResourcesImpl.loadDrawableForCookie): .png/.jpg/.webp/.gif/.bmp decode through BitmapFactory into a
   * BitmapDrawable, and a PNG that carries the compiled 9-patch chunk (npTc) becomes a NinePatchDrawable. Both are at the device density: a bitmap qualified for another density
   * (ResTable_config of the selected variant) is scaled by target/resource density, the 9-patch chunk with it (Res_png_9patch::scale). Null when `id` is not an image file.
   */
  loadFileDrawable(runtime, id) {
    const codec = this.platform.bitmapCodec, file = id >>> 0 ? codec?.resourceFile(runtime, id) : null;
    if (!file || /\.xml$/i.test(file.path)) return null;
    const bytes = Uint8Array.from(file.read ? file.read() : runtime.apkReader(file.path));
    // A file that does not end in .xml is decoded as an image whatever its name (ResourcesImpl.decodeImageDrawable: ImageDecoder reads the format from the bytes); one that is no
    // image gives no drawable: decodeImageDrawable catches the IOException and Resources.getDrawable returns null (a res/raw file named without an extension, a JSON or a font).
    if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.path) && sniffMime(bytes) === null) { runtime.record(`RESOURCE drawable ${id >>> 0} null [${file.path}: not an XML file and not an image (ImageDecoder cannot decode it)]`); return NO_DRAWABLE; }
    const defaults = codec.densityDefaults(file.density), scale = defaults.inDensity && defaults.inDensity !== defaults.inTargetDensity ? defaults.inTargetDensity / defaults.inDensity : 1;
    if (hasNinePatchChunk(bytes)) {
      const drawable = this.platform.drawableViewHost.createNinePatchDrawable(runtime, bytes, scale);
      runtime.record(`RESOURCE drawable ${id >>> 0} NinePatchDrawable [${file.path}: compiled npTc chunk, density ${file.density || 160} -> 160]`); return drawable;
    }
    if ((/\.(gif|webp)$/i.test(file.path) || /^image\/(gif|webp)$/.test(sniffMime(bytes) ?? '')) && this.platform.animatedImages.declaredFrameCount(bytes) > 1) {   // ResourcesImpl.decodeImageDrawable: ImageDecoder.decodeDrawable, an AnimatedImageDrawable for an animated file (API 28+)
      const drawable = this.platform.animatedImages.create(runtime, bytes, { srcDensity: defaults.inDensity, dstDensity: defaults.inTargetDensity });
      runtime.record(`RESOURCE drawable ${id >>> 0} AnimatedImageDrawable [${file.path}, density ${file.density || 160} -> 160]`); return drawable;
    }
    const bitmap = codec.decodeBytes(runtime, bytes, null, null, defaults);
    if (bitmap === null) fail(`Resource ${file.path} could not be decoded as an image`, { resourceId: id, path: file.path });
    const type = 'Landroid/graphics/drawable/BitmapDrawable;', drawable = runtime.allocate(type);
    runtime.dispatch({ owner: type, name: '<init>', parameters: [RESOURCES, 'Landroid/graphics/Bitmap;'], result: 'V', signature: `(${RESOURCES}Landroid/graphics/Bitmap;)V` }, [drawable, this.resourceObject(runtime), bitmap], 'direct');
    runtime.record(`RESOURCE drawable ${id >>> 0} BitmapDrawable [${file.path}, density ${file.density || 160} -> 160]`); return drawable;
  }
  loadDrawable(runtime, id, theme, density = 0, suppliedValue = null) {
    const fileDrawable = this.loadFileDrawable(runtime, id); if (fileDrawable !== null) return fileDrawable === NO_DRAWABLE ? null : fileDrawable;
    if (density && density !== 160) fail(`Drawable density override ${density} requires qualified resource selection; this profile is density 160`, { resourceId: id });
    let value = suppliedValue ? { dataType: this.get(runtime, suppliedValue, VALUE, 'type', 'I'), rawData: this.get(runtime, suppliedValue, VALUE, 'data', 'I') } : this.platform.resources.resolve(id >>> 0); while (value.resolved) value = value.resolved;
    if (value.kind === 'unresolved' || value.kind === 'bag') this.platform.resourceNotFound(runtime, id, value, `Resource ID #0x${(id >>> 0).toString(16)}`);   // ResourcesImpl.getValueForDensity: no value
    let type, parameters = [], values = [], tree;
    // the type of the resource itself, app or framework (?attr/colorControlNormal of an AppCompat theme is ?android:attr/textColorSecondary, a framework color list: a TypedValue
    // supplied by TypedArray.getDrawable carries no type)
    const resourceType = this.platform.resources.table.selectVariant(id >>> 0)?.resourceType ?? this.platform.resources.frameworkTable?.selectVariant?.(id >>> 0)?.resourceType ?? value.resourceType ?? this.platform.resources.resolve(id >>> 0)?.resourceType;
    if (!(value.dataType >= 28 && value.dataType <= 31) && resourceType === 'color') {
      // ResourcesImpl.loadDrawableForCookie: an XML file of a color/ resource loads as a ColorStateListDrawable around the ColorStateList parsed from it (not through DrawableInflater).
      const csl = this.loadColor(runtime, id >>> 0, theme || null), type = 'Landroid/graphics/drawable/ColorStateListDrawable;';
      if (!runtime.classes.has(type)) fail('Original AOSP ColorStateListDrawable DEX is unavailable', { resourceId: id });
      const drawable = runtime.allocate(type); runtime.dispatch({ owner: type, name: '<init>', signature: '(Landroid/content/res/ColorStateList;)V', parameters: ['Landroid/content/res/ColorStateList;'], result: 'V' }, [drawable, csl], 'direct');
      runtime.record(`RESOURCE drawable ${id >>> 0} ${type} [color state list file, original ColorStateListDrawable]`); return drawable;
    }
    if (!(value.dataType >= 28 && value.dataType <= 31) && runtime.classes.has('Landroid/graphics/drawable/DrawableInflater;')) {
      tree=this.platform.xmlResource(runtime,id,'drawable');
      const parser=this.platform.xmlHost.create(runtime,tree,id);this.platform.xmlHost.advance(runtime.object(parser));
      const owner='Landroid/graphics/drawable/Drawable;',parameters=[RESOURCES,'Lorg/xmlpull/v1/XmlPullParser;','Landroid/util/AttributeSet;','I',THEME];
      const drawable=runtime.dispatch({owner,name:'createFromXmlInnerForDensity',parameters,result:owner,signature:`(${parameters.join('')})${owner}`},[this.resourceObject(runtime),parser,parser,density,theme||null],'static');
      runtime.record(`RESOURCE drawable ${id>>>0} ${runtime.typeOf(drawable)} [original DrawableInflater tag/class factory]`);return prepareCpuAnimatedVector(runtime,drawable);
    }
    if (value.dataType >= 28 && value.dataType <= 31) { type = 'Landroid/graphics/drawable/ColorDrawable;'; parameters = ['I']; values = [value.rawData | 0]; }
    else { tree = this.platform.xmlResource(runtime, id, 'drawable'); const classes = { vector: 'VectorDrawable', color: 'ColorDrawable', shape: 'GradientDrawable', ripple: 'RippleDrawable' }; if (!classes[tree.name]) fail(`Drawable <${tree.name}> requires its original compiled drawable implementation and drawing backend`, { resourceId: id }); type = `Landroid/graphics/drawable/${classes[tree.name]};`; }
    if (!runtime.classes.has(type)) fail(`Original AOSP ${type} DEX is unavailable`, { resourceId: id });
    const drawable = runtime.allocate(type); runtime.dispatch({ owner: type, name: '<init>', signature: `(${parameters.join('')})V`, parameters, result: 'V' }, [drawable, ...values], 'direct');
    if (tree) {
      const parser = this.platform.xmlHost.create(runtime, tree, id); this.platform.xmlHost.advance(runtime.object(parser));
      runtime.dispatch({ owner: type, name: 'inflate', signature: '(Landroid/content/res/Resources;Lorg/xmlpull/v1/XmlPullParser;Landroid/util/AttributeSet;Landroid/content/res/Resources$Theme;)V', parameters: [RESOURCES, 'Lorg/xmlpull/v1/XmlPullParser;', 'Landroid/util/AttributeSet;', THEME], result: 'V' }, [drawable, this.resourceObject(runtime), parser, parser, theme || null], 'virtual');
    }
    runtime.record(`RESOURCE drawable ${id >>> 0} ${type} original DEX, requested density ${density}`); return prepareCpuAnimatedVector(runtime,drawable);
  }
  invoke(runtime, method, args) {
    const owner = method.owner, name = method.name, receiver = args[0];
    if(owner!==ASSETS&&owner!==XML&&!(owner===RESOURCES&&['selectDefaultTheme','selectSystemTheme'].includes(name))){
      // Resources: its own configuration; Theme: the Resources it was created from; a Context: the Resources of its chain.
      const platform=this.platform,source=owner===RESOURCES?receiver:owner===THEME?runtime.object(receiver).resources:platform.resourcesForContext?.(runtime,receiver),scoped=platform.overrideResources(runtime,source);
      if(scoped!==(platform.activeResources??null))return platform.withResources(runtime,scoped,()=>this.invoke(runtime,method,args));
    }
    if(owner===RESOURCES&&['selectDefaultTheme','selectSystemTheme'].includes(name)){const algorithms='Landroid/content/res/ResourcesThemeAlgorithms;';if(!runtime.dex.bootClasses?.has(algorithms))fail('Original Resources theme-selection algorithms are required');return runtime.dispatch({...method,owner:algorithms},args,'static');}
    if (owner === ASSETS) { const text = this.poolStrings.get(args[1])?.get(args[2]); if (text === undefined) fail(`Missing original pooled string cookie=${args[1]} index=${args[2]}`); return text; }
    if (owner === XML) { const text = runtime.object(receiver).pooledStrings?.get(args[1]); if (text === undefined) fail('Missing compiled XML pooled string'); return text; }
    if (owner === RESOURCES) {
      if(name==='getAnimation')return this.platform.xmlHost.create(runtime,this.platform.xmlResource(runtime,args[1],'xml type anim'),args[1]);
      if(name==='getAnimatorCache'||name==='getStateListAnimatorCache'){const object=runtime.object(receiver),property=name==='getAnimatorCache'?'originalAnimatorCache':'originalStateListAnimatorCache',type='Landroid/content/res/ConfigurationBoundResourceCache;';if(!object[property]){if(!runtime.classes.has(type))fail('Original ConfigurationBoundResourceCache source is required');const value=runtime.allocate(type);runtime.dispatch({owner:type,name:'<init>',parameters:[],result:'V',signature:'()V'},[value],'direct');object[property]=value;}return object[property];}
      if(name==='getDrawableInflater'){
        const type='Landroid/graphics/drawable/DrawableInflater;',object=runtime.object(receiver);
        if(!object.sourceDrawableInflater){
          if(!runtime.classes.has(type))fail('Original AOSP DrawableInflater source DEX is unavailable');
          const own=runtime.object(receiver).packageEntry,inflater=runtime.allocate(type),loader=own&&!own.main?this.platform.packages.loaderOf(runtime,own):runtime.applicationClassLoader??=this.platform.classLoaders.createApplicationLoader(runtime);   // Resources.getDrawableInflater: the Resources' class loader, its package's (a <drawable class=...> names a class of that package)
          runtime.dispatch({owner:type,name:'<init>',parameters:[RESOURCES,'Ljava/lang/ClassLoader;'],result:'V',signature:`(${RESOURCES}Ljava/lang/ClassLoader;)V`},[inflater,receiver,loader],'direct');
          object.sourceDrawableInflater=inflater;
        }
        return object.sourceDrawableInflater;
      }
      if (name === 'loadDrawable') return this.loadDrawable(runtime, args[2], args[4], args[3], args[1]);
      if (name === 'getDrawable' || name === 'getDrawableForDensity') return this.loadDrawable(runtime, args[1], name === 'getDrawable' ? args[2] : args[3], name === 'getDrawable' ? 0 : args[2]);
      if (name === 'obtainTypedArray') return this.obtainResourceArray(runtime, args[1]);
      if (name === 'obtainAttributes' && method.parameters[0] === RESOURCES) return this.obtain(runtime, args[1], args[2], args[3], 0, 0, 0, !empty(args[1]));
      if (name === 'loadComplexColor' || name === 'loadColorStateList' || name === 'getColorStateList') return this.loadColor(runtime, name.startsWith('get') ? args[1] : args[2], name.startsWith('get') ? args[2] : args[3], name.startsWith('get') ? null : args[1]);
      if (name === 'getValue' || name === 'getValueForDensity') { const id = args[1] >>> 0, out = name === 'getValue' ? args[2] : args[3], resolve = !!(name === 'getValue' ? args[3] : args[4]); const table = (id >>> 24) === 1 ? this.platform.resources.frameworkTable || this.platform.resources.table : this.platform.resources.table; const raw = table.selectVariant(id); let value = resolve ? this.platform.resources.resolve(id) : raw; if (!value) this.platform.resourceNotFound(runtime, id, this.platform.resources.resolve(id), `Resource ID #0x${id.toString(16)}`); while (value.resolved) value = value.resolved; if (value.kind === 'unresolved' || value.kind === 'bag') this.platform.resourceNotFound(runtime, id, value, `Resource ID #0x${id.toString(16)}`);   /* ResourcesImpl.getValue: no value, or a bag (AssetManager2::GetResource with may_be_bag false: "a complex map type"), is NotFoundException */ this.typedValue(runtime, out, { ...value, resourceId: id }); return; }
      if (name === 'getAssets') return this.assetObject(runtime); if (name === 'newTheme') return this.createTheme(runtime); return this.obtain(runtime, null, args[1], args[2], 0, 0, 0, false); }
    if (owner === THEME) {
      const object = runtime.object(receiver);
      if (name === 'rebase') return this.rebaseTheme(runtime,receiver);
      if (name === 'applyStyle') return this.applyStyle(runtime, receiver, args[1], !!args[2]);
      if (name === 'getKey')return this.themeKey(runtime,receiver);
      if (name === 'setTo') return this.copyTheme(runtime, receiver, args[1]);
      if (name === 'getResources') return object.resources ?? this.resourceObject(runtime);
      if (name === 'resolveAttribute') {
        const found = this.platform.resources.table.getThemeAttribute(object.themeValues, args[1], !!args[3]);
        // the diagnostic line (src/operation-monitor.js) is written when something reads it: a Compose frame resolves hundreds of attributes, and naming each one scanned the table
        const id = args[1] >>> 0, resolveRefs = !!args[3];
        runtime.lastResourceCall = () => `Resources$Theme.resolveAttribute(0x${id.toString(16)}${this.platform.resources.table.names ? ' ' + this.attributeName(id) : ''}, resolveRefs=${resolveRefs}) -> ${found ? `type ${found.value.dataType}, data 0x${(found.value.rawData >>> 0).toString(16)}, resourceId 0x${found.ref.toString(16)}` : 'false'}`;
        if (!found) return 0;
        this.typedValue(runtime, args[2], { ...found.value, resourceId: found.ref }); return 1;
      }
      if (method.parameters.length === 1) return this.obtain(runtime, receiver, null, args[1]);
      if (method.parameters[0] === 'I') return this.obtain(runtime, receiver, null, args[2], 0, 0, args[1]);
      return this.obtain(runtime, receiver, args[1], args[2], args[3], args[4]);
    }
    if (name === 'getDrawable') return this.loadDrawable(runtime, args[1], this.theme(runtime, receiver));
    if (name === 'getTheme') return this.theme(runtime, receiver, owner);
    if (name === 'getThemeResId') {
      const original = this.originalThemeMethod(runtime, receiver, owner, name, [], 'I'); if (original.handled) return original.value;
      const object = runtime.object(receiver);
      if (object.baseContext && !runtime.isSubtype(runtime.typeOf(receiver), 'Landroid/view/ContextThemeWrapper;')) return runtime.dispatch({ owner: 'Landroid/content/Context;', name, parameters: [], result: 'I', signature: '()I' }, [object.baseContext], 'virtual');   // ContextWrapper: mBase.getThemeResId()
      return object.themeResId ?? 0;
    }
    if (name === 'setTheme') {
      const original=this.originalThemeMethod(runtime,receiver,owner,name,['I'],'V',[args[1]]);if(original.handled)return original.value;
      const object=runtime.object(receiver);if(object.themeResId===args[1])return;object.themeResId=args[1];
      if(!object.themeRef){object.themeRef=this.createTheme(runtime);if(object.baseContext){const base=this.theme(runtime,object.baseContext);if(base)this.copyTheme(runtime,object.themeRef,base);}}
      this.applyStyle(runtime,object.themeRef,args[1],true);return;
    }
    const theme = this.theme(runtime, receiver);
    if (method.parameters.length === 1) return this.obtain(runtime, theme, null, args[1]);
    if (method.parameters[0] === 'I') return this.obtain(runtime, theme, null, args[2], 0, 0, args[1]);
    return this.obtain(runtime, theme, args[1], args[2], args[3] || 0, args[4] || 0);
  }
}
