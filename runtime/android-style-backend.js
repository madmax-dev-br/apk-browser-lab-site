import {prepareCpuAnimatedVector} from './animated-vector-native.js?v=58b0147dafd8';
import { APKError } from './apk-runtime.js?v=58b0147dafd8';
const RESOURCES = 'Landroid/content/res/Resources;', THEME = 'Landroid/content/res/Resources$Theme;', TYPED_ARRAY = 'Landroid/content/res/TypedArray;', ASSETS = 'Landroid/content/res/AssetManager;', XML = 'Landroid/content/res/XmlBlock$Parser;';
const VALUE = 'Landroid/util/TypedValue;';
const fail = (message, details = {}) => { throw new APKError(`Resource backend: ${message}`, { kind: 'resource-backend-unsupported', ...details }); };
const empty = value => value == null || value === 0;
export const STYLE_METHODS = new Set();
const add = (owner, methods) => methods.forEach(method => STYLE_METHODS.add(`${owner}->${method}`));
for (const owner of ['Landroid/content/Context;', 'Landroid/content/ContextWrapper;', 'Landroid/view/ContextThemeWrapper;', 'Landroid/app/Activity;', 'Landroid/app/Application;']) add(owner, ['getDrawable(I)Landroid/graphics/drawable/Drawable;', 'getTheme()Landroid/content/res/Resources$Theme;', 'setTheme(I)V', 'obtainStyledAttributes([I)Landroid/content/res/TypedArray;', 'obtainStyledAttributes(I[I)Landroid/content/res/TypedArray;', 'obtainStyledAttributes(Landroid/util/AttributeSet;[I)Landroid/content/res/TypedArray;', 'obtainStyledAttributes(Landroid/util/AttributeSet;[III)Landroid/content/res/TypedArray;']);
add(RESOURCES, ['getDrawable(I)Landroid/graphics/drawable/Drawable;', 'getDrawable(ILandroid/content/res/Resources$Theme;)Landroid/graphics/drawable/Drawable;', 'getDrawableForDensity(II)Landroid/graphics/drawable/Drawable;', 'getDrawableForDensity(IILandroid/content/res/Resources$Theme;)Landroid/graphics/drawable/Drawable;', 'loadDrawable(Landroid/util/TypedValue;IILandroid/content/res/Resources$Theme;)Landroid/graphics/drawable/Drawable;', 'loadComplexColor(Landroid/util/TypedValue;ILandroid/content/res/Resources$Theme;)Landroid/content/res/ComplexColor;', 'loadColorStateList(Landroid/util/TypedValue;ILandroid/content/res/Resources$Theme;)Landroid/content/res/ColorStateList;', 'getColorStateList(I)Landroid/content/res/ColorStateList;', 'getColorStateList(ILandroid/content/res/Resources$Theme;)Landroid/content/res/ColorStateList;', 'obtainAttributes(Landroid/content/res/Resources;Landroid/content/res/Resources$Theme;Landroid/util/AttributeSet;[I)Landroid/content/res/TypedArray;', 'getValue(ILandroid/util/TypedValue;Z)V', 'getValueForDensity(IILandroid/util/TypedValue;Z)V', 'getAssets()Landroid/content/res/AssetManager;', 'newTheme()Landroid/content/res/Resources$Theme;', 'obtainAttributes(Landroid/util/AttributeSet;[I)Landroid/content/res/TypedArray;']);
add(RESOURCES, ['selectDefaultTheme(II)I','selectSystemTheme(IIIIII)I']);
add(RESOURCES, ['getAnimation(I)Landroid/content/res/XmlResourceParser;','getAnimatorCache()Landroid/content/res/ConfigurationBoundResourceCache;','getStateListAnimatorCache()Landroid/content/res/ConfigurationBoundResourceCache;','getDrawableInflater()Landroid/graphics/drawable/DrawableInflater;']);
add(THEME, ['rebase()V','getKey()Landroid/content/res/Resources$ThemeKey;','applyStyle(IZ)V', 'setTo(Landroid/content/res/Resources$Theme;)V', 'getResources()Landroid/content/res/Resources;', 'resolveAttribute(ILandroid/util/TypedValue;Z)Z', 'obtainStyledAttributes([I)Landroid/content/res/TypedArray;', 'obtainStyledAttributes(I[I)Landroid/content/res/TypedArray;', 'obtainStyledAttributes(Landroid/util/AttributeSet;[III)Landroid/content/res/TypedArray;']);
add(ASSETS, ['getPooledStringForCookie(II)Ljava/lang/CharSequence;']);
add(XML, ['getPooledString(I)Ljava/lang/CharSequence;']);
add('Landroid/view/ContextThemeWrapper;', ['getThemeResId()I']);

/** Native resource-data boundary. TypedArray/TypedValue/Pools algorithms stay in original AOSP DEX. */
export class AndroidStyleBackend {
  constructor(platform) { this.platform = platform; this.poolStrings = new Map(); this.xmlCookieSequence = 0; }
  put(runtime, ref, owner, name, type, value) { const field = runtime.resolveField({ owner, name, type, key: `${owner}->${name}:${type}` }); runtime.storeField(runtime.object(ref).fields, field.key, value); }
  get(runtime, ref, owner, name, type) { const field = runtime.resolveField({ owner, name, type, key: `${owner}->${name}:${type}` }); return runtime.object(ref).fields.get(field.key); }
  resourceObject(runtime) {
    const resources = this.platform.resourceObject ??= runtime.makeObject(RESOURCES);
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
    const object=runtime.object(theme), values=new Map(), table=this.platform.resources?.table;if(!table)fail('Theme rebase requires actual resource bags');
    // Theme.rebase's public Android contract: replay the applied styles in
    // order against current resource configuration; retain identity and key.
    for(const {id,force} of object.appliedStyles)for(const [attribute,value]of table.resolveBag(id))if(force||!values.has(attribute))values.set(attribute,value);
    object.themeValues=values;runtime.record('RESOURCE Theme.rebase [real applied-style history and compiled resource bags]');
  }
  createTheme(runtime) { const ref = runtime.makeObject(THEME); runtime.object(ref).themeValues = new Map(); runtime.object(ref).appliedStyles = []; (this.themeRefs ??= new Set()).add(ref); return ref; }
  /** Resources.updateConfiguration: every live Theme replays its applied styles against the new configuration (identity and key retained). */
  refreshThemes(runtime) { for (const ref of this.themeRefs ?? []) this.rebaseTheme(runtime, ref); }
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
    const resources=this.platform.resourcesForContext?.(runtime,context);if(resources&&runtime.object(resources).resourceConfigurationDifference)fail('Theme resource selection for changed Context configuration is not installed',{kind:'configuration-resources-unsupported'});
    const original = this.originalThemeMethod(runtime, context, startType, 'getTheme', [], THEME);
    if (original.handled) return original.value;
    const object = runtime.object(context); if (object.themeRef) return object.themeRef;
    // A ContextWrapper super call delegates to its actual base. An Activity or
    // themed Context uses its own theme; inherited attributes are copied once.
    if (object.baseContext && (startType === 'Landroid/content/ContextWrapper;' || !object.themeResId)) return this.theme(runtime, object.baseContext);
    const name = object.type.slice(1, -1).replaceAll('/', '.');
    const declaration = this.platform.manifest?.activities?.find(activity => activity.name === name);
    let id = object.themeResId || declaration?.theme || this.platform.manifest?.application?.theme;
    // No manifest theme: ContextImpl.getTheme asks the original Resources.selectDefaultTheme(0, targetSdkVersion).
    if (!id) id = runtime.dispatch({ owner: RESOURCES, name: 'selectDefaultTheme', parameters: ['I', 'I'], result: 'I', signature: '(II)I' }, [0, Number(this.platform.manifest?.usesSdk?.targetSdkVersion ?? 1)], 'static');
    if (!id) fail('Resources.selectDefaultTheme returned no theme');
    object.themeRef = this.createTheme(runtime); object.themeResId = Number(id) >>> 0;
    if (object.baseContext) { const base = this.theme(runtime, object.baseContext); if (base) this.copyTheme(runtime, object.themeRef, base); }
    this.applyStyle(runtime, object.themeRef, object.themeResId, true); return object.themeRef;
  }
  applyStyle(runtime, theme, id, force) {
    const table = this.platform.resources?.table; if (!table) fail('APK resources are unavailable');
    const bag = table.resolveBag(id), object = runtime.object(theme);
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
  typedValue(runtime, ref, value) {
    for (const [name, type, data] of [['type', 'I', value.dataType || 0], ['data', 'I', value.rawData | 0], ['assetCookie', 'I', value.sourceCookie || 0], ['resourceId', 'I', value.resourceId || 0], ['changingConfigurations', 'I', value.changingConfigurations || 0], ['density', 'I', value.density || 0], ['sourceResourceId', 'I', value.sourceResourceId || 0], ['string', 'Ljava/lang/CharSequence;', value.kind === 'string' ? value.value : null]]) this.put(runtime, ref, VALUE, name, type, data);
  }
  obtain(runtime, themeRef, attrsRef, requestedRef, defStyleAttr = 0, defStyleRes = 0, styleId = 0, useTheme = true) {
    if (!runtime.classes.has(TYPED_ARRAY)) fail('Original AOSP TypedArray DEX is required; no JS getter substitute is installed');
    const requested = runtime.array(requestedRef).elements;
    if (requested.length > 4096) fail('Styled attribute request exceeds 4096 IDs');
    const theme = themeRef ? runtime.object(themeRef).themeValues : new Map();
    const values = useTheme ? new Map(theme) : new Map();
    const merge = id => { if (id) for (const [attr, value] of this.platform.resources.table.resolveBag(id)) values.set(attr, value); };
    let defaultStyle = defStyleRes;
    if (defStyleAttr && theme.has(defStyleAttr)) { const value = this.resolved(theme.get(defStyleAttr), theme, false); if (value.kind === 'reference' && value.reference) defaultStyle = value.reference; }
    if (defaultStyle) merge(defaultStyle);
    if (styleId) merge(styleId);
    const node = empty(attrsRef) ? null : runtime.object(attrsRef).node;
    const xmlStyle = node?.attributes.find(attribute => attribute.name === 'style');
    if (xmlStyle) { const value = this.resolved(xmlStyle, theme, false); const id = value.kind === 'attribute' ? this.resolved(theme.get(value.reference), theme, false).reference : value.reference; merge(id); }
    const direct = new Map(); for (const attr of node?.attributes || []) if (attr.resourceId) direct.set(attr.resourceId >>> 0, { ...attr, nameResourceId: attr.resourceId, resourceId: attr.dataType === 1 ? attr.reference : 0, sourceCookie: attr.kind === 'string' ? -1 : attr.sourceCookie, fromXml: true });
    const resources = this.resourceObject(runtime);
    const array = runtime.dispatch({ owner: TYPED_ARRAY, name: 'obtain', signature: '(Landroid/content/res/Resources;I)Landroid/content/res/TypedArray;', parameters: [RESOURCES, 'I'], result: TYPED_ARRAY }, [resources, requested.length], 'static');
    const data = runtime.array(this.get(runtime, array, TYPED_ARRAY, 'mData', '[I')).elements, indices = runtime.array(this.get(runtime, array, TYPED_ARRAY, 'mIndices', '[I')).elements;
    data.fill(0); indices.fill(0); const xmlStrings = new Map();
    requested.forEach((id, index) => {
      const original = direct.get(id >>> 0) || values.get(id >>> 0); if (!original) return;
      const value = !useTheme && original.kind === 'attribute' ? original : this.resolved(original, theme, true);
      const at = index * 7, cookie = value.sourceCookie ?? original.sourceCookie ?? 1;
      data[at] = value.dataType || 0; data[at + 1] = value.rawData | 0; data[at + 2] = cookie; data[at + 3] = value.resourceId || 0; data[at + 4] = value.changingConfigurations || 0; data[at + 5] = value.density || 0; data[at + 6] = value.sourceResourceId || original.sourceResourceId || 0;
      if (value.dataType === 3) { if (cookie < 0) xmlStrings.set(value.rawData, value.value); else { if (!this.poolStrings.has(cookie)) this.poolStrings.set(cookie, new Map()); this.poolStrings.get(cookie).set(value.rawData, value.value); } }
      if (value.dataType || value.rawData === 1) indices[++indices[0]] = index;
    });
    this.put(runtime, array, TYPED_ARRAY, 'mTheme', THEME, themeRef || null);
    if (node) { const parser = runtime.makeObject(XML); runtime.object(parser).pooledStrings = xmlStrings; this.put(runtime, array, TYPED_ARRAY, 'mXml', XML, parser); }
    runtime.record(`RESOURCE styled attributes ${requested.length} (${indices[0]} present; original data)`);
    return array;
  }
  loadColor(runtime, id, theme, suppliedValue = null) {
    const COLOR = 'Landroid/content/res/ColorStateList;';
    if (!runtime.classes.has(COLOR)) fail('Original AOSP ColorStateList DEX is required');
    let type, data;
    if (suppliedValue) { type = this.get(runtime, suppliedValue, VALUE, 'type', 'I'); data = this.get(runtime, suppliedValue, VALUE, 'data', 'I'); }
    else { let value = this.platform.resources.resolve(id); while (value.resolved) value = value.resolved; type = value.dataType; data = value.rawData; }
    if (type >= 28 && type <= 31) return runtime.dispatch({ owner: COLOR, name: 'valueOf', signature: '(I)Landroid/content/res/ColorStateList;', parameters: ['I'], result: COLOR }, [data | 0], 'static');
    const tree = this.platform.resources.getXml(id);
    if (tree.name !== 'selector') fail(`Original color XML <${tree.name}> requires its own compiled color/shader implementation`, { resourceId: id });
    const parser = this.platform.xmlHost.create(runtime, tree, id);
    return runtime.dispatch({ owner: COLOR, name: 'createFromXml', signature: '(Landroid/content/res/Resources;Lorg/xmlpull/v1/XmlPullParser;Landroid/content/res/Resources$Theme;)Landroid/content/res/ColorStateList;', parameters: [RESOURCES, 'Lorg/xmlpull/v1/XmlPullParser;', THEME], result: COLOR }, [this.resourceObject(runtime), parser, theme || null], 'static');
  }
  loadDrawable(runtime, id, theme, density = 0, suppliedValue = null) {
    if (density && density !== 160) fail(`Drawable density override ${density} requires qualified resource selection; this profile is density 160`, { resourceId: id });
    let value = suppliedValue ? { dataType: this.get(runtime, suppliedValue, VALUE, 'type', 'I'), rawData: this.get(runtime, suppliedValue, VALUE, 'data', 'I') } : this.platform.resources.resolve(id >>> 0); while (value.resolved) value = value.resolved;
    if (value.kind === 'unresolved') fail(value.reason, { resourceId: id });
    let type, parameters = [], values = [], tree;
    if (!(value.dataType >= 28 && value.dataType <= 31) && runtime.classes.has('Landroid/graphics/drawable/DrawableInflater;')) {
      tree=this.platform.resources.getXml(id);
      const parser=this.platform.xmlHost.create(runtime,tree,id);this.platform.xmlHost.advance(runtime.object(parser));
      const owner='Landroid/graphics/drawable/Drawable;',parameters=[RESOURCES,'Lorg/xmlpull/v1/XmlPullParser;','Landroid/util/AttributeSet;','I',THEME];
      const drawable=runtime.dispatch({owner,name:'createFromXmlInnerForDensity',parameters,result:owner,signature:`(${parameters.join('')})${owner}`},[this.resourceObject(runtime),parser,parser,density,theme||null],'static');
      runtime.record(`RESOURCE drawable ${id>>>0} ${runtime.typeOf(drawable)} [original DrawableInflater tag/class factory]`);return prepareCpuAnimatedVector(runtime,drawable);
    }
    if (value.dataType >= 28 && value.dataType <= 31) { type = 'Landroid/graphics/drawable/ColorDrawable;'; parameters = ['I']; values = [value.rawData | 0]; }
    else { tree = this.platform.resources.getXml(id); const classes = { vector: 'VectorDrawable', color: 'ColorDrawable', shape: 'GradientDrawable', ripple: 'RippleDrawable' }; if (!classes[tree.name]) fail(`Drawable <${tree.name}> requires its original compiled drawable implementation and drawing backend`, { resourceId: id }); type = `Landroid/graphics/drawable/${classes[tree.name]};`; }
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
    if(owner===RESOURCES&&!['selectDefaultTheme','selectSystemTheme'].includes(name)&&runtime.object(receiver).resourceConfigurationDifference)fail('Resource selection for changed Context configuration is not installed',{kind:'configuration-resources-unsupported'});
    if(owner===RESOURCES&&['selectDefaultTheme','selectSystemTheme'].includes(name)){const algorithms='Landroid/content/res/ResourcesThemeAlgorithms;';if(!runtime.dex.bootClasses?.has(algorithms))fail('Original Resources theme-selection algorithms are required');return runtime.dispatch({...method,owner:algorithms},args,'static');}
    if (owner === ASSETS) { const text = this.poolStrings.get(args[1])?.get(args[2]); if (text === undefined) fail(`Missing original pooled string cookie=${args[1]} index=${args[2]}`); return text; }
    if (owner === XML) { const text = runtime.object(receiver).pooledStrings?.get(args[1]); if (text === undefined) fail('Missing compiled XML pooled string'); return text; }
    if (owner === RESOURCES) {
      if(name==='getAnimation')return this.platform.xmlHost.create(runtime,this.platform.resources.getXml(args[1]),args[1]);
      if(name==='getAnimatorCache'||name==='getStateListAnimatorCache'){const object=runtime.object(receiver),property=name==='getAnimatorCache'?'originalAnimatorCache':'originalStateListAnimatorCache',type='Landroid/content/res/ConfigurationBoundResourceCache;';if(!object[property]){if(!runtime.classes.has(type))fail('Original ConfigurationBoundResourceCache source is required');const value=runtime.allocate(type);runtime.dispatch({owner:type,name:'<init>',parameters:[],result:'V',signature:'()V'},[value],'direct');object[property]=value;}return object[property];}
      if(name==='getDrawableInflater'){
        const type='Landroid/graphics/drawable/DrawableInflater;',object=runtime.object(receiver);
        if(!object.sourceDrawableInflater){
          if(!runtime.classes.has(type))fail('Original AOSP DrawableInflater source DEX is unavailable');
          const inflater=runtime.allocate(type),loader=runtime.dispatch({owner:'Ljava/lang/ClassLoader;',name:'getSystemClassLoader',parameters:[],result:'Ljava/lang/ClassLoader;',signature:'()Ljava/lang/ClassLoader;'},[],'static');
          runtime.dispatch({owner:type,name:'<init>',parameters:[RESOURCES,'Ljava/lang/ClassLoader;'],result:'V',signature:`(${RESOURCES}Ljava/lang/ClassLoader;)V`},[inflater,receiver,loader],'direct');
          object.sourceDrawableInflater=inflater;
        }
        return object.sourceDrawableInflater;
      }
      if (name === 'loadDrawable') return this.loadDrawable(runtime, args[2], args[4], args[3], args[1]);
      if (name === 'getDrawable' || name === 'getDrawableForDensity') return this.loadDrawable(runtime, args[1], name === 'getDrawable' ? args[2] : args[3], name === 'getDrawable' ? 0 : args[2]);
      if (name === 'obtainAttributes' && method.parameters[0] === RESOURCES) return this.obtain(runtime, args[1], args[2], args[3], 0, 0, 0, !empty(args[1]));
      if (name === 'loadComplexColor' || name === 'loadColorStateList' || name === 'getColorStateList') return this.loadColor(runtime, name.startsWith('get') ? args[1] : args[2], name.startsWith('get') ? args[2] : args[3], name.startsWith('get') ? null : args[1]);
      if (name === 'getValue' || name === 'getValueForDensity') { const id = args[1] >>> 0, out = name === 'getValue' ? args[2] : args[3], resolve = !!(name === 'getValue' ? args[3] : args[4]); const table = (id >>> 24) === 1 ? this.platform.resources.frameworkTable || this.platform.resources.table : this.platform.resources.table; const raw = table.selectVariant(id); let value = resolve ? this.platform.resources.resolve(id) : raw; if (!value) fail(`Raw resource unavailable 0x${id.toString(16)}`); while (value.resolved) value = value.resolved; if (value.kind === 'unresolved') fail(value.reason); this.typedValue(runtime, out, { ...value, resourceId: id }); return; }
      if (name === 'getAssets') return this.assetObject(runtime); if (name === 'newTheme') return this.createTheme(runtime); return this.obtain(runtime, null, args[1], args[2], 0, 0, 0, false); }
    if (owner === THEME) {
      const object = runtime.object(receiver);
      if (name === 'rebase') return this.rebaseTheme(runtime,receiver);
      if (name === 'applyStyle') return this.applyStyle(runtime, receiver, args[1], !!args[2]);
      if (name === 'getKey')return this.themeKey(runtime,receiver);
      if (name === 'setTo') return this.copyTheme(runtime, receiver, args[1]);
      if (name === 'getResources') return this.resourceObject(runtime);
      if (name === 'resolveAttribute') { if (!object.themeValues.has(args[1])) return 0; this.typedValue(runtime, args[2], this.resolved(object.themeValues.get(args[1]), object.themeValues, !!args[3])); return 1; }
      if (method.parameters.length === 1) return this.obtain(runtime, receiver, null, args[1]);
      if (method.parameters[0] === 'I') return this.obtain(runtime, receiver, null, args[2], 0, 0, args[1]);
      return this.obtain(runtime, receiver, args[1], args[2], args[3], args[4]);
    }
    if (name === 'getDrawable') return this.loadDrawable(runtime, args[1], this.theme(runtime, receiver));
    if (name === 'getTheme') return this.theme(runtime, receiver, owner);
    if (name === 'getThemeResId') { const original=this.originalThemeMethod(runtime,receiver,owner,name,[],'I');return original.handled?original.value:runtime.object(receiver).themeResId??0; }
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
