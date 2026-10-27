import { createHostRegistry } from './host-contract.js?v=fd59ee7c3d79';
import { APKError } from './apk-error.js?v=fd59ee7c3d79';

// android.content.Intent public API (API 33) the platform Intent model did not carry, ported from android-13.0.0_r1 Intent.java: filter identity (filterEquals / filterHashCode / cloneFilter),
// fillIn, selectors, clip data, source bounds, identifier, the list extras, createChooser, the make*Activity factories, the Intent URI syntax (toUri / parseUri / getIntent) and mime type
// normalisation. State lives on the Intent's host object next to the fields the platform already keeps (action, data, mimeType, flags, categories, component, package, extras).
const INTENT = 'Landroid/content/Intent;', URI = 'Landroid/net/Uri;', STRING = 'Ljava/lang/String;', CHARS = 'Ljava/lang/CharSequence;', OBJECT = 'Ljava/lang/Object;', COMPONENT = 'Landroid/content/ComponentName;', CLIP = 'Landroid/content/ClipData;', RECT = 'Landroid/graphics/Rect;', ARRAYLIST = 'Ljava/util/ArrayList;', CONTEXT = 'Landroid/content/Context;';
const FILL = { ACTION: 1, DATA: 2, CATEGORIES: 4, COMPONENT: 8, PACKAGE: 16, SOURCE_BOUNDS: 32, SELECTOR: 64, CLIP_DATA: 128, IDENTIFIER: 256 };
const URI_INTENT_SCHEME = 1, URI_ANDROID_APP_SCHEME = 2, URI_ALLOW_UNSAFE = 4;
const IMMUTABLE_FLAGS = 0x1 | 0x2 | 0x40 | 0x80;   // FLAG_GRANT_READ/WRITE_URI_PERMISSION, PERSISTABLE, PREFIX
const nullish = v => v === null || v === undefined || v === 0;
const javaHash = text => { let h = 0; for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0; return h; };

export function createIntentApiHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const call = (r, receiver, owner, name, parameters = [], result = 'V', args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const state = (r, ref) => r.object(ref);
  const text = (r, value) => nullish(value) ? null : typeof value === 'string' ? value : r.stringCharacters(value);
  const newIntent = (r, action = null) => action === null ? construct(r, INTENT, [], []) : construct(r, INTENT, [STRING], [action]);
  const equalsObj = (r, a, b) => nullish(a) ? nullish(b) : !nullish(b) && (typeof a === 'string' ? a === b : call(r, a, OBJECT, 'equals', [OBJECT], 'Z', [b]) === 1);
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };
  const npe = r => r.throwJava('Ljava/lang/NullPointerException;', null);

  // ---- constructors ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  def(INTENT, '<init>', `(${STRING}${URI}${CONTEXT}Ljava/lang/Class;)V`, (r, _m, [self, action, uri, context, cls]) => {
    r.dispatch({ owner: INTENT, name: '<init>', parameters: [STRING, URI], result: 'V', signature: `(${STRING}${URI})V` }, [self, action, uri], 'direct');
    call(r, self, INTENT, 'setClass', [CONTEXT, 'Ljava/lang/Class;'], INTENT, [context, cls]);
  });

  // ---- identity and copies ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  def(INTENT, 'filterEquals', `(${INTENT})Z`, (r, _m, [self, other]) => {
    if (nullish(other)) return 0;
    const a = state(r, self), b = state(r, other), categoriesOf = x => x.categories ?? null, sameSet = (x, y) => (x === null || x.length === 0) ? (y === null || y.length === 0) : y !== null && x.length === y.length && x.every(c => y.includes(c));
    if ((a.action ?? null) !== (b.action ?? null)) return 0; if (!equalsObj(r, a.data ?? null, b.data ?? null)) return 0; if ((a.mimeType ?? null) !== (b.mimeType ?? null) && !(nullish(a.mimeType) && nullish(b.mimeType))) return 0;
    if ((a.identifier ?? null) !== (b.identifier ?? null)) return 0; if ((a.package ?? null) !== (b.package ?? null)) return 0;
    if (!equalsObj(r, call(r, self, INTENT, 'getComponent', [], COMPONENT), call(r, other, INTENT, 'getComponent', [], COMPONENT))) return 0;
    return sameSet(categoriesOf(a), categoriesOf(b)) ? 1 : 0;
  });
  def(INTENT, 'filterHashCode', '()I', (r, _m, [self]) => {
    const a = state(r, self), hash = value => nullish(value) ? 0 : typeof value === 'string' ? javaHash(value) : call(r, value, OBJECT, 'hashCode', [], 'I');
    let code = 0; code += hash(a.action); code += hash(a.data); code += hash(a.mimeType); code += hash(a.identifier); code += hash(a.package); code += hash(call(r, self, INTENT, 'getComponent', [], COMPONENT));
    for (const category of a.categories ?? []) code += javaHash(category);
    return code | 0;
  });
  def(INTENT, 'cloneFilter', `()${INTENT}`, (r, _m, [self]) => {   // new Intent(this, COPY_MODE_FILTER): action, data, type, identifier, package, component, categories -- not flags or extras
    const a = state(r, self), copy = newIntent(r), c = state(r, copy);
    c.action = a.action ?? null; c.data = a.data ?? null; c.mimeType = a.mimeType ?? null; c.identifier = a.identifier ?? null; c.package = a.package ?? null; c.target = a.target ?? null; c.component = a.component ?? null; c.categories = a.categories ? [...a.categories] : undefined;
    return copy;
  });
  def(INTENT, 'describeContents', '()I', (r, _m, [self]) => call(r, self, INTENT, 'hasFileDescriptors', [], 'Z') ? 1 : 0);
  def(INTENT, 'hasFileDescriptors', '()Z', (r, _m, [self]) => { for (const entry of (state(r, self).extras ?? new Map()).values()) if (typeof entry.type === 'string' && entry.type.includes('ParcelFileDescriptor')) return 1; return 0; });
  def(INTENT, 'writeToParcel', '(Landroid/os/Parcel;I)V', () => unsupported('Intent.writeToParcel needs the Parcel wire format for the Intent and its Bundle, which the virtual device only keeps in memory', 'intent-parcel-unsupported'));
  def(INTENT, 'readFromParcel', '(Landroid/os/Parcel;)V', () => unsupported('Intent.readFromParcel needs the Parcel wire format for the Intent and its Bundle, which the virtual device only keeps in memory', 'intent-parcel-unsupported'));

  // ---- fillIn ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  def(INTENT, 'fillIn', `(${INTENT}I)I`, (r, _m, [self, other, flags]) => {
    const a = state(r, self), b = state(r, other); let changes = 0;
    if (!nullish(b.action) && (nullish(a.action) || (flags & FILL.ACTION) !== 0)) { a.action = b.action; changes |= FILL.ACTION; }
    if ((!nullish(b.data) || !nullish(b.mimeType)) && ((nullish(a.data) && nullish(a.mimeType)) || (flags & FILL.DATA) !== 0)) { a.data = b.data ?? null; a.mimeType = b.mimeType ?? null; changes |= FILL.DATA; }
    if (!nullish(b.identifier) && (nullish(a.identifier) || (flags & FILL.IDENTIFIER) !== 0)) { a.identifier = b.identifier; changes |= FILL.IDENTIFIER; }
    if (b.categories && (!a.categories || (flags & FILL.CATEGORIES) !== 0)) { a.categories = [...b.categories]; changes |= FILL.CATEGORIES; }
    if (!nullish(b.package) && (nullish(a.package) || (flags & FILL.PACKAGE) !== 0) && nullish(a.selector)) { a.package = b.package; changes |= FILL.PACKAGE; }
    if (!nullish(b.selector) && (flags & FILL.SELECTOR) !== 0 && nullish(a.package)) { a.selector = construct(r, INTENT, [INTENT], [b.selector]); a.package = null; changes |= FILL.SELECTOR; }
    if (!nullish(b.clipData) && (nullish(a.clipData) || (flags & FILL.CLIP_DATA) !== 0)) { a.clipData = b.clipData; changes |= FILL.CLIP_DATA; }
    if ((!nullish(b.component) || !nullish(b.target)) && (flags & FILL.COMPONENT) !== 0) { a.component = call(r, other, INTENT, 'getComponent', [], COMPONENT); a.target = b.target ?? a.target; changes |= FILL.COMPONENT; }
    a.flags = (a.flags | 0) | (b.flags | 0);
    if (!nullish(b.sourceBounds) && (nullish(a.sourceBounds) || (flags & FILL.SOURCE_BOUNDS) !== 0)) { a.sourceBounds = construct(r, RECT, [RECT], [b.sourceBounds]); changes |= FILL.SOURCE_BOUNDS; }
    if (b.extras && b.extras.size) { const merged = new Map(b.extras); for (const [key, entry] of a.extras ?? []) merged.set(key, entry); a.extras = merged; a.extrasPresent = true; }
    return changes;
  });

  // ---- selector, clip data, identifier, source bounds, flags ------------------------------------------------------------------------------------------------------------------------------
  def(INTENT, 'setSelector', `(${INTENT})V`, (r, _m, [self, selector]) => {
    if (!nullish(selector) && selector.ref === self.ref) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Intent being set as a selector of itself');
    if (!nullish(selector) && !nullish(state(r, self).package)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Can\'t set selector when package name is already set');
    state(r, self).selector = nullish(selector) ? null : selector;
  });
  def(INTENT, 'getSelector', `()${INTENT}`, (r, _m, [self]) => state(r, self).selector ?? null);
  def(INTENT, 'setClipData', `(${CLIP})V`, (r, _m, [self, clip]) => { state(r, self).clipData = nullish(clip) ? null : clip; });
  def(INTENT, 'getClipData', `()${CLIP}`, (r, _m, [self]) => state(r, self).clipData ?? null);
  def(INTENT, 'setIdentifier', `(${STRING})${INTENT}`, (r, _m, [self, identifier]) => { state(r, self).identifier = nullish(identifier) ? null : identifier; return self; });
  def(INTENT, 'getIdentifier', `()${STRING}`, (r, _m, [self]) => state(r, self).identifier ?? null);
  def(INTENT, 'setSourceBounds', `(${RECT})V`, (r, _m, [self, bounds]) => { state(r, self).sourceBounds = nullish(bounds) ? null : construct(r, RECT, [RECT], [bounds]); });
  def(INTENT, 'getSourceBounds', `()${RECT}`, (r, _m, [self]) => state(r, self).sourceBounds ?? null);
  def(INTENT, 'removeFlags', '(I)V', (r, _m, [self, flags]) => { const a = state(r, self); a.flags = (a.flags | 0) & ~flags; });
  def(INTENT, 'putExtras', `(${INTENT})${INTENT}`, (r, _m, [self, src]) => {   // Intent.putExtras(Intent): the other Intent's extras are copied in (an Intent without extras changes nothing)
    const source = state(r, src); if (source.extras?.size) call(r, self, INTENT, 'putExtras', ['Landroid/os/Bundle;'], INTENT, [call(r, src, INTENT, 'getExtras', [], 'Landroid/os/Bundle;')]);
    return self;
  });
  def(INTENT, 'replaceExtras', `(${INTENT})${INTENT}`, (r, _m, [self, src]) => {
    const source = state(r, src), a = state(r, self); a.extras = new Map(source.extras ?? []); a.extrasPresent = !!source.extrasPresent || a.extras.size > 0; a.extrasClassLoader = source.extrasClassLoader ?? null; return self;
  });
  const listExtra = (name, signature) => def(INTENT, name, `(${STRING}${ARRAYLIST})${INTENT}`, (r, _m, [self, key, value]) => { platform.put(r, self, key, ARRAYLIST, nullish(value) ? null : value); return self; });
  for (const name of ['putStringArrayListExtra', 'putIntegerArrayListExtra', 'putCharSequenceArrayListExtra', 'putParcelableArrayListExtra']) listExtra(name);

  // ---- resolution against this app ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  def(INTENT, 'resolveType', `(${CONTEXT})${STRING}`, (r, _m, [self]) => state(r, self).mimeType ?? null);
  def(INTENT, 'resolveType', '(Landroid/content/ContentResolver;)Ljava/lang/String;', (r, _m, [self, resolver]) => {   // Intent.resolveType: an explicit type, else a content: URI asks its provider
    const a = state(r, self); if (!nullish(a.mimeType)) return a.mimeType;
    if (!nullish(a.data)) { const scheme = call(r, a.data, URI, 'getScheme', [], STRING); if (!nullish(scheme) && r.stringCharacters(scheme) === 'content') return call(r, resolver, 'Landroid/content/ContentResolver;', 'getType', [URI], STRING, [a.data]); }
    return null;
  });
  const PM = 'Landroid/content/pm/PackageManager;';
  def(INTENT, 'resolveActivity', `(${PM})${COMPONENT}`, (r, _m, [self, pm]) => {
    const component = call(r, self, INTENT, 'getComponent', [], COMPONENT); if (!nullish(component)) return component;
    const info = call(r, pm, PM, 'resolveActivity', [INTENT, 'I'], 'Landroid/content/pm/ResolveInfo;', [self, 0x10000]);   // MATCH_DEFAULT_ONLY
    if (nullish(info)) return null;
    const activity = r.object(info).fields.get('Landroid/content/pm/ResolveInfo;->activityInfo:Landroid/content/pm/ActivityInfo;'); if (nullish(activity)) return null;
    const f = r.object(activity).fields; return construct(r, COMPONENT, [STRING, STRING], [f.get('Landroid/content/pm/PackageItemInfo;->packageName:Ljava/lang/String;') ?? null, f.get('Landroid/content/pm/PackageItemInfo;->name:Ljava/lang/String;') ?? null]);
  });
  def(INTENT, 'resolveActivityInfo', `(${PM}I)Landroid/content/pm/ActivityInfo;`, (r, _m, [self, pm, flags]) => {
    const component = call(r, self, INTENT, 'getComponent', [], COMPONENT);
    if (!nullish(component)) return call(r, pm, PM, 'getActivityInfo', [COMPONENT, 'I'], 'Landroid/content/pm/ActivityInfo;', [component, flags]);
    const info = call(r, pm, PM, 'resolveActivity', [INTENT, 'I'], 'Landroid/content/pm/ResolveInfo;', [self, flags | 0x10000]);
    return nullish(info) ? null : r.object(info).fields.get('Landroid/content/pm/ResolveInfo;->activityInfo:Landroid/content/pm/ActivityInfo;') ?? null;
  });

  // ---- normalisation, factories, chooser ----------------------------------------------------------------------------------------------------------------------------------------------------------
  const normalize = type => { if (type === null) return null; let t = type.trim().toLowerCase(); const semicolon = t.indexOf(';'); if (semicolon !== -1) t = t.slice(0, semicolon); return t; };
  def(INTENT, 'normalizeMimeType', `(${STRING})${STRING}`, (r, _m, [type]) => normalize(text(r, type)), { static: true });
  def(INTENT, 'setTypeAndNormalize', `(${STRING})${INTENT}`, (r, _m, [self, type]) => call(r, self, INTENT, 'setType', [STRING], INTENT, [normalize(text(r, type))]));
  def(INTENT, 'setDataAndNormalize', `(${URI})${INTENT}`, (r, _m, [self, data]) => call(r, self, INTENT, 'setData', [URI], INTENT, [nullish(data) ? data : call(r, data, URI, 'normalizeScheme', [], URI)]));
  def(INTENT, 'setDataAndTypeAndNormalize', `(${URI}${STRING})${INTENT}`, (r, _m, [self, data, type]) => call(r, self, INTENT, 'setDataAndType', [URI, STRING], INTENT, [nullish(data) ? data : call(r, data, URI, 'normalizeScheme', [], URI), normalize(text(r, type))]));
  def(INTENT, 'makeMainActivity', `(${COMPONENT})${INTENT}`, (r, _m, [component]) => {
    const intent = newIntent(r, 'android.intent.action.MAIN'); call(r, intent, INTENT, 'setComponent', [COMPONENT], INTENT, [component]); call(r, intent, INTENT, 'addCategory', [STRING], INTENT, ['android.intent.category.LAUNCHER']); return intent;
  }, { static: true });
  def(INTENT, 'makeMainSelectorActivity', `(${STRING}${STRING})${INTENT}`, (r, _m, [action, category]) => {
    const intent = newIntent(r, 'android.intent.action.MAIN'); call(r, intent, INTENT, 'addCategory', [STRING], INTENT, ['android.intent.category.LAUNCHER']);
    const selector = newIntent(r); call(r, selector, INTENT, 'setAction', [STRING], INTENT, [action]); call(r, selector, INTENT, 'addCategory', [STRING], INTENT, [category]);
    call(r, intent, INTENT, 'setSelector', [INTENT], 'V', [selector]); return intent;
  }, { static: true });
  def(INTENT, 'makeRestartActivityTask', `(${COMPONENT})${INTENT}`, (r, _m, [component]) => {
    const intent = callStatic(r, INTENT, 'makeMainActivity', [COMPONENT], INTENT, [component]); call(r, intent, INTENT, 'addFlags', ['I'], INTENT, [0x10000000 | 0x8000]); return intent;   // NEW_TASK | CLEAR_TASK
  }, { static: true });
  const chooser = (r, target, title, sender) => {
    if (nullish(target)) npe(r);
    const intent = newIntent(r, 'android.intent.action.CHOOSER');
    platform.put(r, intent, 'android.intent.extra.INTENT', 'Landroid/os/Parcelable;', target);
    if (!nullish(title)) platform.put(r, intent, 'android.intent.extra.TITLE', CHARS, title);
    if (!nullish(sender)) platform.put(r, intent, 'android.intent.extra.CHOSEN_COMPONENT_INTENT_SENDER', 'Landroid/os/Parcelable;', sender);
    const permFlags = (state(r, target).flags | 0) & IMMUTABLE_FLAGS;   // migrate the URI-permission flags and the clip data to the chooser
    if (permFlags !== 0) {
      let clip = state(r, target).clipData ?? null, data = state(r, target).data ?? null;
      if (nullish(clip) && !nullish(data) && r.classes.has(CLIP)) {
        const item = construct(r, 'Landroid/content/ClipData$Item;', [URI], [data]), mimes = r.newArray(`[${STRING}`, state(r, target).mimeType ? 1 : 0); if (state(r, target).mimeType) r.array(mimes).elements = [state(r, target).mimeType];
        clip = construct(r, CLIP, [CHARS, `[${STRING}`, 'Landroid/content/ClipData$Item;'], [null, mimes, item]);
      }
      if (!nullish(clip)) { state(r, intent).clipData = clip; state(r, intent).flags = (state(r, intent).flags | 0) | permFlags; }
    }
    return intent;
  };
  def(INTENT, 'createChooser', `(${INTENT}${CHARS})${INTENT}`, (r, _m, [target, title]) => chooser(r, target, title, null), { static: true });
  def(INTENT, 'createChooser', `(${INTENT}${CHARS}Landroid/content/IntentSender;)${INTENT}`, (r, _m, [target, title, sender]) => chooser(r, target, title, sender), { static: true });

  // ---- the Intent URI syntax ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const URISyntax = (r, uri, reason, index = -1) => r.throwJavaReference(construct(r, 'Ljava/net/URISyntaxException;', [STRING, STRING, 'I'], [uri, reason, index]), reason);
  const encode = (r, value, allow = null) => r.stringCharacters(allow === null ? callStatic(r, URI, 'encode', [STRING], STRING, [value]) : callStatic(r, URI, 'encode', [STRING, STRING], STRING, [value, allow]));
  const decode = (r, value) => r.stringCharacters(callStatic(r, URI, 'decode', [STRING], STRING, [value]));
  const toUriInner = (r, intent, scheme, defAction, defPackage, flags) => {
    const a = state(r, intent); let out = '';
    if (scheme !== null) out += `scheme=${scheme};`;
    if (!nullish(a.action) && a.action !== defAction) out += `action=${encode(r, a.action)};`;
    for (const category of a.categories ?? []) out += `category=${encode(r, category)};`;
    if (!nullish(a.mimeType)) out += `type=${encode(r, a.mimeType, '/')};`;
    if (!nullish(a.identifier)) out += `identifier=${encode(r, a.identifier, '/')};`;
    if ((a.flags | 0) !== 0) out += `launchFlags=0x${((a.flags | 0) >>> 0).toString(16)};`;
    if (!nullish(a.package) && a.package !== defPackage) out += `package=${encode(r, a.package)};`;
    const component = call(r, intent, INTENT, 'getComponent', [], COMPONENT);
    if (!nullish(component)) out += `component=${encode(r, r.stringCharacters(call(r, component, COMPONENT, 'flattenToShortString', [], STRING)), '/')};`;
    if (!nullish(a.sourceBounds)) out += `sourceBounds=${encode(r, r.stringCharacters(call(r, a.sourceBounds, RECT, 'flattenToString', [], STRING)))};`;
    for (const [key, entry] of a.extras ?? []) {
      const kind = { 'Ljava/lang/String;': 'S', 'Ljava/lang/CharSequence;': 'S', Z: 'Z', B: 'b', C: 'c', D: 'd', F: 'f', I: 'i', J: 'l', S: 's' }[entry.type]; if (!kind) continue;
      const tag = kind === 'Z' ? 'B' : kind;   // Boolean is 'B', Byte is 'b'
      const value = entry.type === 'Z' ? String(!!entry.value) : entry.type === 'C' ? String.fromCharCode(entry.value) : entry.type === 'F' ? r.stringCharacters(callStatic(r, 'Ljava/lang/Float;', 'toString', ['F'], STRING, [entry.value])) : entry.type === 'D' ? r.stringCharacters(callStatic(r, 'Ljava/lang/Double;', 'toString', ['D'], STRING, [entry.value])) : typeof entry.value === 'string' ? entry.value : nullish(entry.value) ? 'null' : String(entry.value);
      out += `${tag}.${encode(r, key)}=${encode(r, value)};`;
    }
    return out;
  };
  const toUriFragment = (r, intent, scheme, defAction, defPackage, flags) => {
    let frag = toUriInner(r, intent, scheme, defAction, defPackage, flags); const selector = state(r, intent).selector;
    if (!nullish(selector)) { frag += 'SEL;'; const data = state(r, selector).data; frag += toUriInner(r, selector, nullish(data) ? null : text(r, call(r, data, URI, 'getScheme', [], STRING)), null, null, flags); }
    return frag.length > 0 ? `#Intent;${frag}end` : '';
  };
  const toUri = (r, self, flags) => {
    const a = state(r, self); let uri = '';
    if ((flags & URI_ANDROID_APP_SCHEME) !== 0) {
      if (nullish(a.package)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Intent must include an explicit package name to build an android-app: URI');
      uri += `android-app://${a.package}`; let scheme = null;
      if (!nullish(a.data)) {
        scheme = text(r, call(r, a.data, URI, 'getScheme', [], STRING));
        if (scheme !== null) {
          uri += `/${scheme}`; const authority = text(r, call(r, a.data, URI, 'getEncodedAuthority', [], STRING));
          if (authority !== null) {
            uri += `/${authority}`; const path = text(r, call(r, a.data, URI, 'getEncodedPath', [], STRING)); if (path !== null) uri += path;
            const query = text(r, call(r, a.data, URI, 'getEncodedQuery', [], STRING)); if (query !== null) uri += `?${query}`;
            const fragment = text(r, call(r, a.data, URI, 'getEncodedFragment', [], STRING)); if (fragment !== null) uri += `#${fragment}`;
          }
        }
      }
      return uri + toUriFragment(r, self, null, scheme === null ? 'android.intent.action.MAIN' : 'android.intent.action.VIEW', a.package, flags);
    }
    let scheme = null;
    if (!nullish(a.data)) {
      let data = text(r, call(r, a.data, OBJECT, 'toString', [], STRING));
      if ((flags & URI_INTENT_SCHEME) !== 0) {
        for (let i = 0; i < data.length; i++) {
          const c = data[i];
          if (/[a-zA-Z0-9.+-]/.test(c)) continue;
          if (c === ':' && i > 0) { scheme = data.slice(0, i); uri += 'intent:'; data = data.slice(i + 1); break; }
          break;
        }
      }
      uri += data;
    } else if ((flags & URI_INTENT_SCHEME) !== 0) uri += 'intent:';
    return uri + toUriFragment(r, self, scheme, 'android.intent.action.VIEW', null, flags);
  };
  def(INTENT, 'toUri', '(I)Ljava/lang/String;', (r, _m, [self, flags]) => toUri(r, self, flags));
  def(INTENT, 'toURI', '()Ljava/lang/String;', (r, _m, [self]) => toUri(r, self, 0));
  const parseUri = (r, uri, flags) => {
    let i = 0;
    const NUMBER = (kind, value) => { if (!/^[+-]?\d+$/.test(value.trim())) r.throwJava('Ljava/lang/NumberFormatException;', `For input string: "${value}"`); return kind === 'long' ? BigInt(value) : Number(value); };
    try {
      const androidApp = uri.startsWith('android-app:');
      if ((flags & (URI_INTENT_SCHEME | URI_ANDROID_APP_SCHEME)) !== 0 && !uri.startsWith('intent:') && !androidApp) {
        const intent = newIntent(r, 'android.intent.action.VIEW'); call(r, intent, INTENT, 'setData', [URI], INTENT, [callStatic(r, URI, 'parse', [STRING], URI, [uri])]); return intent;
      }
      i = uri.lastIndexOf('#');
      if (i === -1) { if (!androidApp) return construct(r, INTENT, [STRING, URI], ['android.intent.action.VIEW', callStatic(r, URI, 'parse', [STRING], URI, [uri])]); }
      else if (!uri.startsWith('#Intent;', i)) { if (!androidApp) return getIntentOld(r, uri, flags); i = -1; }
      let intent = newIntent(r, 'android.intent.action.VIEW'); const baseIntent = intent; let inSelector = false, explicitAction = false, scheme = null, data;
      if (i >= 0) { data = uri.slice(0, i); i += 8; } else data = uri;
      while (i >= 0 && !uri.startsWith('end', i)) {
        let eq = uri.indexOf('=', i); if (eq < 0) eq = i - 1; const semi = uri.indexOf(';', i); if (semi < 0) URISyntax(r, uri, 'illegal Intent URI format', i);
        const value = eq < semi ? decode(r, uri.slice(eq + 1, semi)) : '', a = state(r, intent);
        if (uri.startsWith('action=', i)) { call(r, intent, INTENT, 'setAction', [STRING], INTENT, [value]); if (!inSelector) explicitAction = true; }
        else if (uri.startsWith('category=', i)) call(r, intent, INTENT, 'addCategory', [STRING], INTENT, [value]);
        else if (uri.startsWith('type=', i)) a.mimeType = value;
        else if (uri.startsWith('identifier=', i)) a.identifier = value;
        else if (uri.startsWith('launchFlags=', i)) { a.flags = Number(BigInt.asIntN(32, BigInt(/^[+-]?0x/i.test(value) ? value : /^[+-]?#/.test(value) ? value.replace('#', '0x') : (/^0\d/.test(value) ? '0o' + value.slice(1) : value)))); if ((flags & URI_ALLOW_UNSAFE) === 0) a.flags &= ~IMMUTABLE_FLAGS; }
        else if (uri.startsWith('package=', i)) a.package = value;
        else if (uri.startsWith('component=', i)) a.component = callStatic(r, COMPONENT, 'unflattenFromString', [STRING], COMPONENT, [value]);
        else if (uri.startsWith('scheme=', i)) { if (inSelector) a.data = callStatic(r, URI, 'parse', [STRING], URI, [value + ':']); else scheme = value; }
        else if (uri.startsWith('sourceBounds=', i)) a.sourceBounds = callStatic(r, RECT, 'unflattenFromString', [STRING], RECT, [value]);
        else if (semi === i + 3 && uri.startsWith('SEL', i)) { intent = newIntent(r); inSelector = true; }
        else {
          const key = decode(r, uri.slice(i + 2, eq)), kind = uri.slice(i, i + 2), put = (type, v) => platform.put(r, intent, key, type, v);
          if (kind === 'S.') put(STRING, value); else if (kind === 'B.') put('Z', value.toLowerCase() === 'true' ? 1 : 0);
          else if (kind === 'b.') { const v = Number(value); if (!/^[+-]?\d+$/.test(value) || v < -128 || v > 127) r.throwJava('Ljava/lang/NumberFormatException;', `Value out of range. Value:"${value}" Radix:10`); put('B', v); }
          else if (kind === 'c.') put('C', value.charCodeAt(0));
          else if (kind === 'd.') put('D', callStatic(r, 'Ljava/lang/Double;', 'parseDouble', [STRING], 'D', [value]));
          else if (kind === 'f.') put('F', callStatic(r, 'Ljava/lang/Float;', 'parseFloat', [STRING], 'F', [value]));
          else if (kind === 'i.') put('I', NUMBER('int', value)); else if (kind === 'l.') put('J', NUMBER('long', value)); else if (kind === 's.') put('S', NUMBER('short', value));
          else URISyntax(r, uri, 'unknown EXTRA type', i);
        }
        i = semi + 1;
      }
      if (inSelector) { if (nullish(state(r, baseIntent).package)) state(r, baseIntent).selector = intent; intent = baseIntent; }
      if (data !== null && data !== undefined) {
        if (data.startsWith('intent:')) { data = data.slice(7); if (scheme !== null) data = `${scheme}:${data}`; }
        else if (data.startsWith('android-app:')) {
          if (data[12] === '/' && data[13] === '/') {
            let end = data.indexOf('/', 14);
            if (end < 0) { state(r, intent).package = data.slice(14); if (!explicitAction) state(r, intent).action = 'android.intent.action.MAIN'; data = ''; }
            else {
              let authority = null; state(r, intent).package = data.slice(14, end);
              if (end + 1 < data.length) {
                let next = data.indexOf('/', end + 1);
                if (next >= 0) {
                  scheme = data.slice(end + 1, next); end = next;
                  if (end < data.length && (next = data.indexOf('/', end + 1)) >= 0) { authority = data.slice(end + 1, next); end = next; }
                } else scheme = data.slice(end + 1);
              }
              if (scheme === null) { if (!explicitAction) state(r, intent).action = 'android.intent.action.MAIN'; data = ''; }
              else if (authority === null) data = scheme + ':';
              else data = `${scheme}://${authority}${data.slice(end)}`;
            }
          } else data = '';
        }
        if (data.length > 0) state(r, intent).data = callStatic(r, URI, 'parse', [STRING], URI, [data]);
      }
      if (nullish(state(r, intent).action)) state(r, intent).action = 'android.intent.action.VIEW';
      return intent;
    } catch (error) {
      if (error instanceof RangeError || error?.name === 'RangeError') URISyntax(r, uri, 'illegal Intent URI format', i);
      throw error;
    }
  };
  const getIntentOld = (r, uri, flags) => {   // the old "#action(...)categories(...)" syntax (Intent.getIntentOld)
    let i = uri.lastIndexOf('#');
    if (i < 0) return construct(r, INTENT, [STRING, URI], ['android.intent.action.VIEW', callStatic(r, URI, 'parse', [STRING], URI, [uri])]);
    const fragmentStart = i; let action = null, isFragment = false; i++;
    const region = (text) => uri.startsWith(text, i);
    if (region('action(')) { isFragment = true; i += 7; const j = uri.indexOf(')', i); action = uri.slice(i, j); i = j + 1; }
    const intent = action === null ? newIntent(r) : newIntent(r, action), a = state(r, intent);
    if (region('categories(')) { isFragment = true; i += 11; const j = uri.indexOf(')', i); while (i < j) { let sep = uri.indexOf('!', i); if (sep < 0 || sep > j) sep = j; if (i < sep) call(r, intent, INTENT, 'addCategory', [STRING], INTENT, [uri.slice(i, sep)]); i = sep + 1; } i = j + 1; }
    if (region('type(')) { isFragment = true; i += 5; const j = uri.indexOf(')', i); a.mimeType = uri.slice(i, j); i = j + 1; }
    if (region('launchFlags(')) { isFragment = true; i += 12; const j = uri.indexOf(')', i); a.flags = Number(BigInt.asIntN(32, BigInt(uri.slice(i, j).replace(/^([+-]?)#/, '$10x')))); if ((flags & URI_ALLOW_UNSAFE) === 0) a.flags &= ~IMMUTABLE_FLAGS; i = j + 1; }
    if (region('component(')) { isFragment = true; i += 10; const j = uri.indexOf(')', i), sep = uri.indexOf('!', i); if (sep >= 0 && sep < j) a.component = construct(r, COMPONENT, [STRING, STRING], [uri.slice(i, sep), uri.slice(sep + 1, j)]); i = j + 1; }
    if (region('extras(')) {
      isFragment = true; i += 7; const close = uri.indexOf(')', i); if (close === -1) URISyntax(r, uri, "EXTRA missing trailing ')'", i);
      while (i < close) {
        let j = uri.indexOf('=', i); if (j <= i + 1 || i >= close) URISyntax(r, uri, "EXTRA missing '='", i);
        const type = uri[i]; i++; const key = uri.slice(i, j); i = j + 1; j = uri.indexOf('!', i); if (j === -1 || j >= close) j = close; if (i >= j) URISyntax(r, uri, "EXTRA missing '!'", i);
        const value = uri.slice(i, j); i = j; const put = (t, v) => platform.put(r, intent, key, t, v);
        try {
          if (type === 'S') put(STRING, decode(r, value)); else if (type === 'B') put('Z', value.toLowerCase() === 'true' ? 1 : 0); else if (type === 'b') put('B', Number(value)); else if (type === 'c') put('C', decode(r, value).charCodeAt(0));
          else if (type === 'd') put('D', callStatic(r, 'Ljava/lang/Double;', 'parseDouble', [STRING], 'D', [value])); else if (type === 'f') put('F', callStatic(r, 'Ljava/lang/Float;', 'parseFloat', [STRING], 'F', [value]));
          else if (type === 'i') put('I', Number(value)); else if (type === 'l') put('J', BigInt(value)); else if (type === 's') put('S', Number(value)); else URISyntax(r, uri, 'EXTRA has unknown type', i);
        } catch (error) { if (error?.name === 'JavaException' && r.object(error.value).type === 'Ljava/lang/NumberFormatException;') URISyntax(r, uri, "EXTRA value can't be parsed", i); if (error instanceof SyntaxError) URISyntax(r, uri, "EXTRA value can't be parsed", i); throw error; }
        if (uri[i] === '!') i++;
      }
    }
    a.data = callStatic(r, URI, 'parse', [STRING], URI, [isFragment ? uri.slice(0, fragmentStart) : uri]);
    if (nullish(a.action)) a.action = 'android.intent.action.VIEW';
    return intent;
  };
  def(INTENT, 'parseUri', `(${STRING}I)${INTENT}`, (r, _m, [uri, flags]) => { if (nullish(uri)) npe(r); return parseUri(r, r.stringCharacters(uri), flags); }, { static: true });
  def(INTENT, 'getIntent', `(${STRING})${INTENT}`, (r, _m, [uri]) => { if (nullish(uri)) npe(r); return parseUri(r, r.stringCharacters(uri), 0); }, { static: true });
  def(INTENT, 'getIntentOld', `(${STRING})${INTENT}`, (r, _m, [uri]) => { if (nullish(uri)) npe(r); return getIntentOld(r, r.stringCharacters(uri), 0); }, { static: true });
  def(INTENT, 'parseIntent', '(Landroid/content/res/Resources;Lorg/xmlpull/v1/XmlPullParser;Landroid/util/AttributeSet;)Landroid/content/Intent;', () => unsupported('Intent.parseIntent reads <intent> shortcut XML through R.styleable.Intent and Resources.parseBundleExtra, which the framework resource data does not carry', 'intent-xml-unsupported'), { static: true });
  return registry;
}
