import { APKError } from './apk-runtime.js?v=dee55583552d';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=dee55583552d';
const RESOLVER = 'Landroid/content/ContentResolver;', URI = 'Landroid/net/Uri;', GLOBAL = 'Landroid/provider/Settings$Global;', OBSERVER = 'Landroid/database/ContentObserver;';
const fail = message => { throw new APKError(message, { kind: 'virtual-content-provider-unsupported' }); };
const keys = new Set();
const add = (owner, methods) => methods.forEach(method => keys.add(owner + '->' + method));
// android.net.Uri.Builder (android-13.0.0_r1 Uri.java): decoded setters encode like Part.fromDecoded (paths keep '/'), encoded setters store raw text.
const URI_BUILDER = 'Landroid/net/Uri$Builder;';
add(URI_BUILDER, ['<init>()V', 'build()Landroid/net/Uri;', 'toString()Ljava/lang/String;', 'clearQuery()Landroid/net/Uri$Builder;',
  ...['scheme', 'opaquePart', 'encodedOpaquePart', 'authority', 'encodedAuthority', 'path', 'encodedPath', 'appendPath', 'appendEncodedPath', 'query', 'encodedQuery', 'fragment', 'encodedFragment'].map(name => `${name}(Ljava/lang/String;)Landroid/net/Uri$Builder;`),
  'appendQueryParameter(Ljava/lang/String;Ljava/lang/String;)Landroid/net/Uri$Builder;']);
add('Landroid/net/Uri;', ['buildUpon()Landroid/net/Uri$Builder;']);
for (const owner of ['Landroid/content/Context;', 'Landroid/content/ContextWrapper;', 'Landroid/app/Application;', 'Landroid/app/Activity;']) add(owner, ['getContentResolver()Landroid/content/ContentResolver;']);
add(GLOBAL, ['getString(Landroid/content/ContentResolver;Ljava/lang/String;)Ljava/lang/String;', 'getFloat(Landroid/content/ContentResolver;Ljava/lang/String;F)F', 'putString(Landroid/content/ContentResolver;Ljava/lang/String;Ljava/lang/String;)Z', 'putFloat(Landroid/content/ContentResolver;Ljava/lang/String;F)Z', 'getUriFor(Ljava/lang/String;)Landroid/net/Uri;']);
add(RESOLVER, ['registerContentObserver(Landroid/net/Uri;ZLandroid/database/ContentObserver;)V', 'unregisterContentObserver(Landroid/database/ContentObserver;)V', 'notifyChange(Landroid/net/Uri;Landroid/database/ContentObserver;)V', 'notifyChange(Landroid/net/Uri;Landroid/database/ContentObserver;Z)V']);
add('Landroid/os/Binder;', ['getCallingUid()I']);
add('Landroid/os/Process;', ['myUid()I', 'myPid()I']);
add('Landroid/app/compat/CompatChanges;', ['isChangeEnabled(J)Z']);
const STR = 'Ljava/lang/String;';
add(URI, ['hashCode()I', 'parse(Ljava/lang/String;)Landroid/net/Uri;', 'toString()Ljava/lang/String;', 'equals(Ljava/lang/Object;)Z', 'getScheme()Ljava/lang/String;', 'getAuthority()Ljava/lang/String;', 'getPath()Ljava/lang/String;',
  'getEncodedAuthority()Ljava/lang/String;', 'getEncodedPath()Ljava/lang/String;', 'getQuery()Ljava/lang/String;', 'getEncodedQuery()Ljava/lang/String;', 'getFragment()Ljava/lang/String;', 'getEncodedFragment()Ljava/lang/String;', 'getSchemeSpecificPart()Ljava/lang/String;', 'getEncodedSchemeSpecificPart()Ljava/lang/String;',
  'getPathSegments()Ljava/util/List;', 'getLastPathSegment()Ljava/lang/String;', 'getHost()Ljava/lang/String;', 'getPort()I', 'getUserInfo()Ljava/lang/String;', 'getEncodedUserInfo()Ljava/lang/String;', 'isHierarchical()Z', 'isOpaque()Z', 'isRelative()Z', 'isAbsolute()Z', 'getQueryParameter(Ljava/lang/String;)Ljava/lang/String;', 'getQueryParameterNames()Ljava/util/Set;', 'getQueryParameters(Ljava/lang/String;)Ljava/util/List;', 'getBooleanQueryParameter(Ljava/lang/String;Z)Z',
  'encode(Ljava/lang/String;)Ljava/lang/String;', 'encode(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', 'decode(Ljava/lang/String;)Ljava/lang/String;']);
const hex = value => { const code = value.charCodeAt(0); return code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 70 ? code - 55 : code >= 97 && code <= 102 ? code - 87 : -1; };
/** android.net.Uri.decode / libcore UriCodec.decode(convertPlus, UTF-8, throwOnFailure=false): runs of %XX are decoded together as UTF-8 (malformed bytes become U+FFFD). */
export function decodeUri(text, convertPlus) {
  let out = '';
  for (let i = 0; i < text.length;) {
    const c = text[i++];
    if (c === '+') out += convertPlus ? ' ' : '+';
    else if (c !== '%') out += c;
    else {
      const bytes = []; i--;
      while (i < text.length && text[i] === '%') {
        const d1 = i + 1 < text.length ? hex(text[i + 1]) : -1, d2 = i + 2 < text.length ? hex(text[i + 2]) : -1;
        if (d1 < 0 || d2 < 0) break;
        bytes.push(d1 * 16 + d2); i += 3;
      }
      if (bytes.length) out += new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
      else { out += '\ufffd'; i++; } // malformed sequence with throwOnFailure=false
    }
  }
  return out;
}
/** android.net.Uri.encode: letters, digits and _-!.~'()* plus `allow` stay literal; everything else is uppercase %XX of the UTF-8 bytes. */
export function encodeUri(text, allow = null) {
  let out = '';
  for (const ch of text) {
    if (/^[A-Za-z0-9_\-!.~'()*]$/.test(ch) || allow != null && allow.includes(ch)) out += ch;
    else for (const byte of new TextEncoder().encode(ch)) out += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}
/** Field extraction mirrors AOSP Uri.StringUri (android-13.0.0_r1) exactly, including its permissive scheme/query scanning. */
export function parseUriParts(text) {
  const ssi = text.indexOf(':'), fsi = text.indexOf('#', ssi), length = text.length;
  const hierarchical = ssi === -1 || length !== ssi + 1 && text[ssi + 1] === '/';
  const slashes = length > ssi + 2 && text[ssi + 1] === '/' && text[ssi + 2] === '/';
  let authority = null;
  if (slashes) { let end = ssi + 3; while (end < length && !'/\\?#'.includes(text[end])) end++; authority = text.slice(ssi + 3, end); }
  let path = null;
  if (hierarchical) {
    let start;
    if (slashes) { start = ssi + 3; let empty = false; while (start < length) { const c = text[start]; if (c === '?' || c === '#') { empty = true; break; } if (c === '/' || c === '\\') break; start++; } if (empty) start = -1; } else start = ssi + 1;
    if (start < 0) path = ''; else { let end = start; while (end < length && text[end] !== '?' && text[end] !== '#') end++; path = text.slice(start, end); }
  }
  const qsi = text.indexOf('?', ssi); let query = null;
  if (qsi !== -1) query = fsi === -1 ? text.slice(qsi + 1) : fsi < qsi ? null : text.slice(qsi + 1, fsi);
  return { scheme: ssi === -1 ? null : text.slice(0, ssi), ssp: fsi === -1 ? text.slice(ssi + 1) : text.slice(ssi + 1, fsi), authority, path, query, fragment: fsi === -1 ? null : text.slice(fsi + 1), hierarchical, relative: ssi === -1 };
}
/** java.net.URLEncoder.encode(key, "UTF-8"), as used by Uri.getQueryParameters. */
function encodeUriFormKey(text) { let out = ''; for (const ch of text) { if (/^[A-Za-z0-9.\-*_]$/.test(ch)) out += ch; else if (ch === ' ') out += '+'; else for (const byte of new TextEncoder().encode(ch)) out += '%' + byte.toString(16).toUpperCase().padStart(2, '0'); } return out; }
/** Uri.getQueryParameter* name matching over the raw encoded query (AOSP algorithm); `visit(nameStart, separator, end)` is called per `&` segment. */
function eachQueryPair(query, visit) {
  let start = 0;
  do {
    const next = query.indexOf('&', start), end = next !== -1 ? next : query.length;
    let separator = query.indexOf('=', start); if (separator > end || separator === -1) separator = end;
    if (visit(start, separator, end) === false) return;
    if (next === -1) break; start = next + 1;
  } while (true);
}
const number = value => { const view = new DataView(new ArrayBuffer(4)); view.setInt32(0, value, true); return view.getFloat32(0, true); };

/** VM-owned Settings provider. Values are virtual-device configuration, never browser/host telemetry. */
export function createContentResolverHost(platform) {
  let resolver = null; const observers = gcRoot([]), stored = new Map();
  // Virtual-device settings owned by the "Dispositivo" state are read live from it; an APK write overrides until the device value changes.
  const settings = { get size() { return stored.size; }, has: key => stored.has(key) || key === 'animator_duration_scale',
    get: key => stored.has(key) ? stored.get(key) : key === 'animator_duration_scale' ? String(platform.device?.animatorScale ?? 1) : key === 'time_12_24' ? (platform.device?.hour24 === false ? '12' : '24') : undefined,
    set: (key, value) => stored.set(key, value), delete: key => stored.delete(key) };
  const uri = (runtime, text) => { if (typeof text !== 'string' || text.length > 8192) fail('URI requires a bounded string'); const value = runtime.makeObject(URI); runtime.object(value).uriText = text; return value; };
  const textOf = (runtime, value) => { const text = runtime.object(value).uriText; if (typeof text !== 'string') fail('Unknown URI object representation'); return text; };
  const notify = (runtime, text, source) => {
    for (const entry of [...observers]) {
      if (!(entry.uri === text || entry.descendants && text.startsWith(entry.uri.replace(/\/$/, '') + '/'))) continue;
      const self = source && source.ref === entry.observer.ref;
      if (self && !runtime.dispatch({ owner: OBSERVER, name: 'deliverSelfNotifications', signature: '()Z', parameters: [], result: 'Z' }, [entry.observer], 'virtual')) continue;
      // Original ContentObserver dispatchChange decides direct vs Handler delivery and invokes APK callbacks.
      runtime.dispatch({ owner: OBSERVER, name: 'dispatchChange', signature: '(ZLandroid/net/Uri;)V', parameters: ['Z', URI], result: 'V' }, [entry.observer, self ? 1 : 0, uri(runtime, text)], 'virtual');
    }
  };
  return {
    [GC_ROOTS](visit) { visit(resolver); },
    notifySetting: (runtime, key, scope = 'global') => notify(runtime, `content://settings/${scope}/${encodeURIComponent(key)}`, null),
    supports: key => keys.has(key), canAllocate: type => type === RESOLVER || type === URI || type === URI_BUILDER,
    parent: type => [RESOLVER, URI, URI_BUILDER].includes(type) ? 'Ljava/lang/Object;' : null,
    invoke(runtime, method, args) {
      const { owner, name } = method;
      if (owner === 'Landroid/os/Binder;') return platform.virtualProcess.uid;
      if (owner === 'Landroid/os/Process;') return name === 'myPid' ? platform.virtualProcess.pid : platform.virtualProcess.uid;
      if (owner === 'Landroid/app/compat/CompatChanges;') { if (args[0] !== 150939131n) fail(`Unmodeled compatibility change ${args[0]}`); runtime.record('COMPAT ContentObserver flags disabled in explicit API28 virtual profile'); return 0; }
      if (name === 'getContentResolver') { resolver ??= runtime.makeObject(RESOLVER); runtime.record(`CONTENT VM Settings provider, animator_duration_scale=${settings.get('animator_duration_scale')}; no host services`); return resolver; }
      if (owner === URI_BUILDER) {
        const state = runtime.object(args[0]).uriBuilder ??= { scheme: null, opaque: null, authority: null, path: null, query: null, fragment: null }, self = args[0], value = args[1] ?? null;
        const appendSegment = segment => { const old = state.path ?? ''; state.path = !old.length ? '/' + segment : old.endsWith('/') ? old + segment : old + '/' + segment; state.opaque = null; };
        const text = () => {
          if (state.opaque !== null) { if (state.scheme === null) runtime.throwJava('Ljava/lang/UnsupportedOperationException;', 'An opaque URI must have a scheme.'); return `${state.scheme}:${state.opaque}${state.fragment !== null ? '#' + state.fragment : ''}`; }
          let path = state.path ?? ''; if (state.authority !== null && path.length && !path.startsWith('/')) path = '/' + path;
          return `${state.scheme !== null ? state.scheme + ':' : ''}${state.authority !== null ? '//' + state.authority : ''}${path}${state.query !== null ? '?' + state.query : ''}${state.fragment !== null ? '#' + state.fragment : ''}`;
        };
        switch (name) {
          case '<init>': return;
          case 'scheme': state.scheme = value; return self;
          case 'opaquePart': state.opaque = value === null ? null : encodeUri(value); return self;
          case 'encodedOpaquePart': state.opaque = value; return self;
          case 'authority': state.authority = value === null ? null : encodeUri(value); state.opaque = null; return self;
          case 'encodedAuthority': state.authority = value; state.opaque = null; return self;
          case 'path': state.path = value === null ? null : encodeUri(value, '/'); state.opaque = null; return self;
          case 'encodedPath': state.path = value; state.opaque = null; return self;
          case 'appendPath': appendSegment(encodeUri(value)); return self;
          case 'appendEncodedPath': appendSegment(value); return self;
          case 'query': state.query = value === null ? null : encodeUri(value); state.opaque = null; return self;
          case 'encodedQuery': state.query = value; state.opaque = null; return self;
          case 'appendQueryParameter': { const parameter = `${value === null ? 'null' : encodeUri(value)}=${args[2] === null ? 'null' : encodeUri(args[2])}`; state.query = state.query ? state.query + '&' + parameter : parameter; state.opaque = null; return self; }
          case 'clearQuery': state.query = null; return self;
          case 'fragment': state.fragment = value === null ? null : encodeUri(value); return self;
          case 'encodedFragment': state.fragment = value; return self;
          case 'build': return uri(runtime, text());
          case 'toString': return text();
        }
      }
      if (owner === URI && name === 'buildUpon') {
        const parts = parseUriParts(textOf(runtime, args[0])), builder = runtime.makeObject(URI_BUILDER);
        runtime.object(builder).uriBuilder = parts.hierarchical
          ? { scheme: parts.scheme, opaque: null, authority: parts.authority, path: parts.path, query: parts.query, fragment: parts.fragment }
          : { scheme: parts.scheme, opaque: parts.ssp, authority: null, path: null, query: null, fragment: parts.fragment };
        return builder;
      }
      if (owner === URI) {
        if (name === 'parse') { if (args[0] == null) runtime.throwJava('Ljava/lang/NullPointerException;', 'uriString'); return uri(runtime, args[0]); }
        if (name === 'encode') return args[0] == null ? null : encodeUri(args[0], args[1] ?? null);
        if (name === 'decode') return args[0] == null ? null : decodeUri(args[0], false);
        const text = textOf(runtime, args[0]), parts = parseUriParts(text);
        const opaqueGuard = () => { if (!parts.hierarchical) runtime.throwJava('Ljava/lang/UnsupportedOperationException;', "This isn't a hierarchical URI."); };
        const decoded = value => value == null ? null : decodeUri(value, false);
        const collection = (type, items) => { const list = runtime.allocate(type); runtime.dispatch({ owner: type, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [list], 'direct'); for (const item of items) runtime.dispatch({ owner: type, name: 'add', signature: '(Ljava/lang/Object;)Z', parameters: ['Ljava/lang/Object;'], result: 'Z' }, [list, item], 'virtual'); runtime.object(list).readOnly = true; return list; }; // Collections.unmodifiable*: VM collections honor readOnly.
        const pathSegments = () => { // AOSP PathPart.getPathSegments: empty segments are skipped, each is decoded
          const path = parts.path ?? '', found = []; let previous = 0, current;
          while ((current = path.indexOf('/', previous)) > -1) { if (previous < current) found.push(decodeUri(path.slice(previous, current), false)); previous = current + 1; }
          if (previous < path.length) found.push(decodeUri(path.slice(previous), false)); return found;
        };
        const portSeparator = authority => { if (authority == null) return -1; for (let i = authority.length - 1; i >= 0; i--) { if (authority[i] === ':') return i; if (authority[i] < '0' || authority[i] > '9') return -1; } return -1; };
        if (name === 'getPathSegments') return collection('Ljava/util/ArrayList;', pathSegments());
        if (name === 'getLastPathSegment') { const found = pathSegments(); return found.length ? found.at(-1) : null; }
        if (name === 'getEncodedUserInfo' || name === 'getUserInfo') { const end = parts.authority == null ? -1 : parts.authority.lastIndexOf('@'); const info = end < 0 ? null : parts.authority.slice(0, end); return name === 'getUserInfo' ? decoded(info) : info; }
        if (name === 'getHost') { if (parts.authority == null) return null; const at = parts.authority.lastIndexOf('@'), colon = portSeparator(parts.authority); return decodeUri(colon < 0 ? parts.authority.slice(at + 1) : parts.authority.slice(at + 1, colon), false); }
        if (name === 'getPort') { const colon = portSeparator(parts.authority); if (colon < 0) return -1; const text = decodeUri(parts.authority.slice(colon + 1), false); return /^[+-]?\d+$/.test(text) && Math.abs(Number(text)) <= 2147483647 ? Number(text) | 0 : -1; }
        if (name === 'getScheme') return parts.scheme;
        if (name === 'getAuthority') return decoded(parts.authority);
        if (name === 'getEncodedAuthority') return parts.authority;
        if (name === 'getPath') return decoded(parts.path);
        if (name === 'getEncodedPath') return parts.path;
        if (name === 'getQuery') return decoded(parts.query);
        if (name === 'getEncodedQuery') return parts.query;
        if (name === 'getFragment') return decoded(parts.fragment);
        if (name === 'getEncodedFragment') return parts.fragment;
        if (name === 'getSchemeSpecificPart') return decodeUri(parts.ssp, false);
        if (name === 'getEncodedSchemeSpecificPart') return parts.ssp;
        if (name === 'isHierarchical') return parts.hierarchical ? 1 : 0;
        if (name === 'isOpaque') return parts.hierarchical ? 0 : 1;
        if (name === 'isRelative') return parts.relative ? 1 : 0;
        if (name === 'isAbsolute') return parts.relative ? 0 : 1;
        if (name === 'getQueryParameterNames') {
          opaqueGuard(); const names = [];
          if (parts.query !== null) eachQueryPair(parts.query, (start, separator, end) => { const value = decodeUri(parts.query.slice(start, separator), false); if (!names.includes(value)) names.push(value); if (end + 1 >= parts.query.length) return false; });
          return collection('Ljava/util/LinkedHashSet;', names);
        }
        if (name === 'getQueryParameter' || name === 'getQueryParameters' || name === 'getBooleanQueryParameter') {
          opaqueGuard(); if (args[1] == null) runtime.throwJava('Ljava/lang/NullPointerException;', 'key');
          const query = parts.query, encodedKey = name === 'getQueryParameters' ? encodeUriFormKey(args[1]) : encodeUri(args[1], null), values = [];
          if (query !== null) eachQueryPair(query, (start, separator, end) => {
            if (separator - start !== encodedKey.length || query.slice(start, separator) !== encodedKey) return;
            values.push(separator === end ? '' : decodeUri(query.slice(separator + 1, end), name !== 'getQueryParameters'));
            if (name !== 'getQueryParameters') return false;
          });
          if (name === 'getQueryParameters') return collection('Ljava/util/ArrayList;', values);
          if (name === 'getQueryParameter') return values.length ? values[0] : null;
          if (!values.length) return args[2];
          const flag = values[0].toLowerCase(); return flag !== 'false' && flag !== '0' ? 1 : 0;
        }
        if (name === 'toString') return text;
        if (name === 'hashCode') return runtime.dispatch({ owner: 'Ljava/lang/String;', name: 'hashCode', signature: '()I', parameters: [], result: 'I' }, [text], 'virtual');
        if (name === 'equals') return args[1]?.ref !== undefined && runtime.object(args[1]).uriText === text ? 1 : 0;
      }
      if (owner === GLOBAL) {
        if (name === 'getUriFor') return uri(runtime, 'content://settings/global/' + encodeURIComponent(args[0]));
        if (args[0]?.ref !== resolver?.ref) fail('Settings.Global requires this VM ContentResolver');
        const key = args[1]; if (typeof key !== 'string' || key.length > 1024) fail('Invalid Settings key');
        if (name === 'getString') return settings.get(key) ?? null;
        if (name === 'getFloat') { const value = settings.get(key); if (value == null) return args[2]; try { return runtime.dispatch({ owner: 'Ljava/lang/Float;', name: 'parseFloat', signature: '(Ljava/lang/String;)F', parameters: ['Ljava/lang/String;'], result: 'F' }, [value], 'static'); } catch (error) { if (error.name === 'JavaException' && error.value && runtime.isSubtype(runtime.object(error.value).type, 'Ljava/lang/NumberFormatException;')) return args[2]; throw error; } }
        const value = name === 'putFloat' ? String(number(args[2])) : args[2];
        if (value !== null && (typeof value !== 'string' || value.length > 16384)) fail('Invalid Settings string value');
        if (settings.size >= 4096 && !settings.has(key)) fail('VM Settings store exceeds 4096 keys');
        if (value == null) settings.delete(key); else settings.set(key, value); notify(runtime, 'content://settings/global/' + encodeURIComponent(key), null); return 1;
      }
      if (owner === RESOLVER) {
        if (args[0]?.ref !== resolver?.ref) fail('ContentResolver is not attached to this VM');
        if (name === 'registerContentObserver') { if (observers.length >= 1024) fail('Content observer limit exceeded'); runtime.object(args[3]); observers.push({ uri: textOf(runtime, args[1]), descendants: !!args[2], observer: args[3] }); return; }
        if (name === 'unregisterContentObserver') { for (let i = observers.length - 1; i >= 0; i--) if (observers[i].observer.ref === args[1]?.ref) observers.splice(i, 1); return; }
        if (name === 'notifyChange') return notify(runtime, textOf(runtime, args[1]), args[2]);
      }
      fail('Unsupported content operation ' + owner + '->' + name);
    },
  };
}
