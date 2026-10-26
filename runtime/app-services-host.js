import { APKError } from './apk-error.js?v=9fc86cc65ae6';
import { FRAMEWORK_PERMISSIONS } from './permission-data.js?v=9fc86cc65ae6';
import { createHostRegistry, bitsFloat, floatBits } from './host-contract.js?v=9fc86cc65ae6';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=9fc86cc65ae6';

// Application-process services between ActivityThread and the app: Context file/preference APIs, SharedPreferences (SharedPreferencesImpl
// semantics, XML files on the virtual filesystem), ContentProvider base class + ProviderInfo + installContentProviders, and the PackageManager
// provider lookup androidx.startup relies on. AOSP references: android-13.0.0_r1 ContextImpl.java, SharedPreferencesImpl.java,
// ContentProvider.java, ActivityThread.installContentProviders / handleBindApplication, ActivityManagerService.generateApplicationProvidersLocked.

const CONTEXT = 'Landroid/content/Context;', WRAPPER = 'Landroid/content/ContextWrapper;', IMPL = 'Landroid/app/ContextImpl;';
const SP = 'Landroid/content/SharedPreferences;', SP_IMPL = 'Landroid/app/SharedPreferencesImpl;', EDITOR = 'Landroid/content/SharedPreferences$Editor;', EDITOR_IMPL = 'Landroid/app/SharedPreferencesImpl$EditorImpl;';
const LISTENER = 'Landroid/content/SharedPreferences$OnSharedPreferenceChangeListener;';
const FILE = 'Ljava/io/File;', STRING = 'Ljava/lang/String;', BUNDLE = 'Landroid/os/Bundle;', OBJECT = 'Ljava/lang/Object;';
const CP = 'Landroid/content/ContentProvider;', PROVIDER_INFO = 'Landroid/content/pm/ProviderInfo;', COMPONENT_INFO = 'Landroid/content/pm/ComponentInfo;', ITEM_INFO = 'Landroid/content/pm/PackageItemInfo;';
const PACKAGE_MANAGER = 'Landroid/content/pm/PackageManager;', APPLICATION_INFO = 'Landroid/content/pm/ApplicationInfo;';
const MODE_APPEND = 0x8000, REMOVE = Symbol('remove');

const isFalse = value => value === false || value === 0 || value === 'false';
const isTrue = value => value === true || value === 0xffffffff || value === -1 || value === 'true';

// ---- value model for preference files ------------------------------------------------------------------------------------------------------
const escapeXml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const unescapeXml = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
/** Float.toString for a float32 value (shortest digits that round-trip, Java exponent form outside [1e-3, 1e7)). */
export function floatToString(value) {
  if (Number.isNaN(value)) return 'NaN'; if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity'; if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0';
  let digits = 1; for (; digits < 10; digits++) if (Math.fround(Number(value.toPrecision(digits))) === value) break;
  const text = Number(value.toPrecision(digits)); const abs = Math.abs(text);
  if (abs >= 1e-3 && abs < 1e7) { const s = String(text); return s.includes('.') ? s : s + '.0'; }
  const [mantissa, exponent] = text.toExponential().split('e'); return (mantissa.includes('.') ? mantissa : mantissa + '.0') + 'E' + Number(exponent);
}
function entryEquals(a, b) {
  if (a.t !== b.t) return false;
  if (a.t === 'set') return a.v.length === b.v.length && a.v.every(x => b.v.includes(x));
  return a.v === b.v;
}
export function serializePreferences(map) {
  if (!map.size) return "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map />\n";
  const lines = ["<?xml version='1.0' encoding='utf-8' standalone='yes' ?>", '<map>'];
  for (const [key, entry] of map) {
    const name = `name="${escapeXml(key)}"`;
    switch (entry.t) {
      case 's': lines.push(`    <string ${name}>${escapeXml(entry.v)}</string>`); break;
      case 'i': lines.push(`    <int ${name} value="${entry.v}" />`); break;
      case 'j': lines.push(`    <long ${name} value="${entry.v}" />`); break;
      case 'f': lines.push(`    <float ${name} value="${floatToString(entry.v)}" />`); break;
      case 'z': lines.push(`    <boolean ${name} value="${entry.v}" />`); break;
      default: lines.push(`    <set ${name}>`); for (const member of entry.v) lines.push(`        <string>${escapeXml(member)}</string>`); lines.push('    </set>');
    }
  }
  lines.push('</map>'); return lines.join('\n') + '\n';
}
/** Parses the XmlUtils.writeMapXml dialect used by SharedPreferencesImpl; anything else is an XmlPullParserException equivalent. */
export function parsePreferences(text) {
  const map = new Map(), body = /<map\s*\/>|<map>([\s\S]*)<\/map>/.exec(text);
  if (!body) throw new Error('not a <map> document');
  const inner = body[1] ?? '', tag = /<(string|int|long|float|double|boolean|set)\s+name="([^"]*)"(?:\s+value="([^"]*)")?\s*(\/>|>([\s\S]*?)<\/\1>)/g;
  let consumed = 0, m; const rest = inner.replace(/\s+/g, ' ').trim();
  while ((m = tag.exec(inner))) {
    const [, kind, rawName, rawValue, , content] = m, name = unescapeXml(rawName), value = rawValue === undefined ? undefined : unescapeXml(rawValue);
    consumed += m[0].length;
    if (kind === 'string') map.set(name, { t: 's', v: unescapeXml(content ?? '') });
    else if (kind === 'int') map.set(name, { t: 'i', v: parseInt(value, 10) | 0 });
    else if (kind === 'long') map.set(name, { t: 'j', v: BigInt(value) });
    else if (kind === 'float' || kind === 'double') map.set(name, { t: 'f', v: Math.fround(parseFloat(value)) });
    else if (kind === 'boolean') map.set(name, { t: 'z', v: value === 'true' });
    else map.set(name, { t: 'set', v: [...(content ?? '').matchAll(/<string>([\s\S]*?)<\/string>/g)].map(x => unescapeXml(x[1])) });
  }
  if (rest && consumed === 0) throw new Error('unrecognized content in <map>');
  return map;
}

export function createAppServicesHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const pkg = () => platform.packageName ?? 'app', fs = () => platform.javaIo.fs();
  // The context a file/preference API was called on decides credential-protected (/data/user/0) vs device-protected (/data/user_de/0) storage.
  let currentContext = null;
  const protectedContext = r => { for (let c = currentContext, depth = 0; c && depth < 32; depth++) { const o = r.object(c); if (o.deviceProtected) return true; c = o.baseContext; } return false; };
  const dataDir = () => (currentRuntime && protectedContext(currentRuntime)) ? `/data/user_de/0/${pkg()}` : `/data/user/0/${pkg()}`;
  let currentRuntime = null;
  const text = (r, v) => { if (v === null || v === 0) r.throwJava('Ljava/lang/NullPointerException;', null); return r.stringCharacters(v); };
  const file = (r, path) => platform.javaIo.makeFile(r, path);
  const defContext = (name, signature, fn, options) => {
    const scoped = (r, m, a) => { const [pc, pr] = [currentContext, currentRuntime]; currentContext = a[0]; currentRuntime = r; try { return fn(r, m, a); } finally { currentContext = pc; currentRuntime = pr; } };
    for (const owner of [CONTEXT, WRAPPER, IMPL]) def(owner, name, signature, scoped, options);
  };
  type(CONTEXT, OBJECT); type(WRAPPER, CONTEXT); type(IMPL, CONTEXT, [], { allocatable: true }); // same hierarchy as the platform (def() must not default these to Object)
  // ---- Context permission checks (ContextImpl.checkPermission & friends). The app is the only process, so every caller is the app itself; it holds a permission when
  // its manifest requests it and the permission is installed with "normal" protection (or is one the app defines itself); dangerous permissions stay denied until a
  // runtime grant (platform.grantedPermissions), signature/privileged ones never reach a third-party app.
  const PERMISSION_GRANTED = 0, PERMISSION_DENIED = -1;
  const holdsPermission = (r, permission) => {
    const manifest = platform.manifest ?? {}, sdk = r.apiLevel ?? 33, requested = (manifest.usesPermissions ?? []).find(entry => entry.name === permission && (entry.maxSdkVersion === null || Number(entry.maxSdkVersion) >= sdk));
    if (!requested) return false;
    if (platform.grantedPermissions?.has(permission)) return true;
    const own = (manifest.declaredPermissions ?? []).find(entry => entry.name === permission), level = String(own ? 'normal' : FRAMEWORK_PERMISSIONS[permission] ?? '').split('|')[0];   // a permission the app declares itself is held by its own signature
    return level === 'normal';
  };
  platform.holdsPermission = holdsPermission;   // the network layer answers getaddrinfo with EACCES when the app lacks INTERNET
  const needPermission = (r, permission) => { if (permission === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'permission is null'); return r.stringCharacters(permission); };
  const check = (r, permission) => holdsPermission(r, needPermission(r, permission)) ? PERMISSION_GRANTED : PERMISSION_DENIED;
  const enforce = (r, permission, result, selfToo, message) => {
    if (result !== PERMISSION_GRANTED) r.throwJava('Ljava/lang/SecurityException;', `${message === null ? '' : r.stringCharacters(message) + ': '}${selfToo ? `Neither user ${platform.virtualProcess.uid} nor current process has ` : `uid ${platform.virtualProcess.uid} does not have `}${r.stringCharacters(permission)}.`);
  };
  defContext('checkSelfPermission', `(${STRING})I`, (r, _m, [, permission]) => check(r, permission));
  defContext('checkPermission', `(${STRING}II)I`, (r, _m, [, permission, pid, uid]) => pid === platform.virtualProcess.pid && uid === platform.virtualProcess.uid ? check(r, permission) : (needPermission(r, permission), PERMISSION_DENIED));   // no other process exists
  defContext('checkCallingPermission', `(${STRING})I`, (r, _m, [, permission]) => { needPermission(r, permission); return PERMISSION_DENIED; });   // not inside a Binder transaction: the calling pid is this process
  defContext('checkCallingOrSelfPermission', `(${STRING})I`, (r, _m, [, permission]) => check(r, permission));
  defContext('enforcePermission', `(${STRING}IILjava/lang/String;)V`, (r, _m, [self, permission, pid, uid, message]) => enforce(r, permission, pid === platform.virtualProcess.pid && uid === platform.virtualProcess.uid ? check(r, permission) : PERMISSION_DENIED, false, message));
  defContext('enforceCallingPermission', `(${STRING}${STRING})V`, (r, _m, [, permission, message]) => enforce(r, permission, (needPermission(r, permission), PERMISSION_DENIED), false, message));
  defContext('enforceCallingOrSelfPermission', `(${STRING}${STRING})V`, (r, _m, [, permission, message]) => enforce(r, permission, check(r, permission), true, message));

  // ---- Context directories and files (ContextImpl.getDataDir/getFilesDir/..., ensurePrivateDirExists) -------------------------------------------
  const ensure = (r, path) => { const result = fs().mkdirs(path); if (result !== 'ok' && result !== 'EEXIST') r.record(`LOG W ContextImpl: Failed to ensure ${path}: ${result}`); return file(r, path); };
  const external = () => `/storage/emulated/0/Android/data/${pkg()}`;
  defContext('getDataDir', `()${FILE}`, r => ensure(r, dataDir()));
  defContext('getFilesDir', `()${FILE}`, r => ensure(r, `${dataDir()}/files`));
  defContext('getCacheDir', `()${FILE}`, r => ensure(r, `${dataDir()}/cache`));
  defContext('getCodeCacheDir', `()${FILE}`, r => ensure(r, `${dataDir()}/code_cache`));
  defContext('getNoBackupFilesDir', `()${FILE}`, r => ensure(r, `${dataDir()}/no_backup`));
  defContext('getDir', `(${STRING}I)${FILE}`, (r, _m, [, name]) => ensure(r, `${dataDir()}/app_${text(r, name)}`));
  defContext('getDatabasePath', `(${STRING})${FILE}`, (r, _m, [, name]) => { const n = text(r, name); return file(r, n.startsWith('/') ? n : (ensure(r, `${dataDir()}/databases`), `${dataDir()}/databases/${n}`)); });
  // ContextImpl.openOrCreateDatabase/deleteDatabase/databaseList over the original android.database.sqlite classes (src/sqlite-native.js natives).
  const SQLITE_DB = 'Landroid/database/sqlite/SQLiteDatabase;', CURSOR_FACTORY = 'Landroid/database/sqlite/SQLiteDatabase$CursorFactory;', ERROR_HANDLER = 'Landroid/database/DatabaseErrorHandler;';
  const MODE_ENABLE_WRITE_AHEAD_LOGGING = 0x8, MODE_NO_LOCALIZED_COLLATORS = 0x10, CREATE_IF_NECESSARY = 0x10000000, ENABLE_WRITE_AHEAD_LOGGING = 0x20000000, NO_LOCALIZED_COLLATORS = 0x10;
  const databasePath = (r, name) => { const n = text(r, name); if (n.startsWith('/')) return n; if (n.includes('/')) r.throwJava('Ljava/lang/IllegalArgumentException;', `File ${n} contains a path separator`); ensure(r, `${dataDir()}/databases`); return `${dataDir()}/databases/${n}`; };
  const openDatabase = (r, name, mode, factory, handler) => {
    const path = databasePath(r, name); let flags = CREATE_IF_NECESSARY;
    if (mode & MODE_ENABLE_WRITE_AHEAD_LOGGING) flags |= ENABLE_WRITE_AHEAD_LOGGING;
    if (mode & MODE_NO_LOCALIZED_COLLATORS) flags |= NO_LOCALIZED_COLLATORS;
    return r.dispatch({ owner: SQLITE_DB, name: 'openDatabase', parameters: [STRING, CURSOR_FACTORY, 'I', ERROR_HANDLER], result: SQLITE_DB, signature: `(${STRING}${CURSOR_FACTORY}I${ERROR_HANDLER})${SQLITE_DB}` }, [path, factory, flags, handler], 'static');
  };
  defContext('openOrCreateDatabase', `(${STRING}I${CURSOR_FACTORY})${SQLITE_DB}`, (r, _m, [, name, mode, factory]) => openDatabase(r, name, mode, factory, null));
  defContext('openOrCreateDatabase', `(${STRING}I${CURSOR_FACTORY}${ERROR_HANDLER})${SQLITE_DB}`, (r, _m, [, name, mode, factory, handler]) => openDatabase(r, name, mode, factory, handler));
  defContext('deleteDatabase', `(${STRING})Z`, (r, _m, [, name]) => {
    const file = platform.javaIo.makeFile(r, databasePath(r, name));
    return r.dispatch({ owner: SQLITE_DB, name: 'deleteDatabase', parameters: [FILE], result: 'Z', signature: `(${FILE})Z` }, [file], 'static');
  });
  defContext('databaseList', '()[Ljava/lang/String;', r => { ensure(r, `${dataDir()}/databases`); const names = fs().list(`${dataDir()}/databases`) ?? [], array = r.newArray('[Ljava/lang/String;', names.length); r.array(array).elements = names; return array; });
  defContext('getFileStreamPath', `(${STRING})${FILE}`, (r, _m, [, name]) => { const n = text(r, name); if (n.includes('/')) r.throwJava('Ljava/lang/IllegalArgumentException;', `File ${n} contains a path separator`); ensure(r, `${dataDir()}/files`); return file(r, `${dataDir()}/files/${n}`); });
  defContext('getExternalFilesDir', `(${STRING})${FILE}`, (r, _m, [, sub]) => ensure(r, `${external()}/files${sub === null ? '' : '/' + r.stringCharacters(sub)}`));
  defContext('getExternalCacheDir', `()${FILE}`, r => ensure(r, `${external()}/cache`));
  defContext('getObbDir', `()${FILE}`, r => ensure(r, `/storage/emulated/0/Android/obb/${pkg()}`));
  defContext('deleteFile', `(${STRING})Z`, (r, _m, [, name]) => fs().delete(`${dataDir()}/files/${text(r, name)}`) === 'ok' ? 1 : 0);
  defContext('fileList', '()[Ljava/lang/String;', r => { ensure(r, `${dataDir()}/files`); const names = fs().list(`${dataDir()}/files`) ?? [], array = r.newArray('[Ljava/lang/String;', names.length); r.array(array).elements = names; return array; });
  const stream = (r, owner, ctorParams, ctorArgs) => { const ref = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters: ctorParams, result: 'V', signature: `(${ctorParams.join('')})V` }, [ref, ...ctorArgs], 'direct'); return ref; };
  defContext('openFileInput', `(${STRING})Ljava/io/FileInputStream;`, (r, _m, [, name]) => stream(r, 'Ljava/io/FileInputStream;', [FILE], [file(r, `${dataDir()}/files/${text(r, name)}`)]));
  defContext('openFileOutput', `(${STRING}I)Ljava/io/FileOutputStream;`, (r, _m, [, name, mode]) => {
    if (mode & 3) r.throwJava('Ljava/lang/SecurityException;', 'MODE_WORLD_READABLE no longer supported');
    ensure(r, `${dataDir()}/files`); return stream(r, 'Ljava/io/FileOutputStream;', [FILE, 'Z'], [file(r, `${dataDir()}/files/${text(r, name)}`), mode & MODE_APPEND ? 1 : 0]);
  });

  defContext('createDeviceProtectedStorageContext', `()${CONTEXT}`, (r, _m, [self]) => { const ctx = r.allocate(IMPL); const o = r.object(ctx); o.baseContext = self; o.deviceProtected = true; o.packageName = pkg(); return ctx; });
  defContext('isDeviceProtectedStorage', '()Z', r => protectedContext(r) ? 1 : 0);

  // ---- SharedPreferences ----------------------------------------------------------------------------------------------------------------------
  type(SP_IMPL, OBJECT, [SP], { allocatable: true }); type(EDITOR_IMPL, OBJECT, [EDITOR], { allocatable: true });
  registry.interfaces.set(SP, []); registry.interfaces.set(EDITOR, []);
  const instances = gcRoot(new Map()); // file path -> SharedPreferencesImpl ref (ContextImpl.sSharedPrefsCache)
  const prefsPath = name => `${dataDir()}/shared_prefs/${name}.xml`;
  function loadMap(r, path) {
    const backup = path + '.bak', f = fs();
    if (f.stat(backup)) { f.delete(path); f.rename(backup, path); } // a crash between rename and write: the backup is the last good state
    const bytes = f.bytes(path); if (!bytes) return new Map();
    try { return parsePreferences(new TextDecoder().decode(bytes)); }
    catch (error) { r.record(`LOG W SharedPreferencesImpl: Cannot read ${path}: ${error.message}`); return new Map(); }
  }
  function writeFile(r, path, map) {
    const f = fs(), backup = path + '.bak';
    if (f.stat(path)) { if (!f.stat(backup)) f.rename(path, backup); else f.delete(path); }
    f.mkdirs(path.slice(0, path.lastIndexOf('/')));
    const result = f.setBytes(path, new TextEncoder().encode(serializePreferences(map)));
    if (result !== 'ok') { r.record(`LOG W SharedPreferencesImpl: Couldn't write ${path}: ${result}`); f.delete(path); return false; }
    f.delete(backup); return true;
  }
  defContext('getSharedPreferences', `(${STRING}I)${SP}`, (r, _m, [, name, mode]) => {
    const n = name === null ? 'null' : r.stringCharacters(name);
    if (n.includes('/')) r.throwJava('Ljava/lang/IllegalArgumentException;', `File ${n} contains a path separator`);
    if (mode & 3 && Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 28) >= 24) r.throwJava('Ljava/lang/SecurityException;', (mode & 1) ? 'MODE_WORLD_READABLE no longer supported' : 'MODE_WORLD_WRITEABLE no longer supported');
    const path = prefsPath(n);
    if (!instances.has(path)) {
      const ref = r.allocate(SP_IMPL), state = { path, map: loadMap(r, path), listeners: [], generation: 0, writes: 0 };
      r.object(ref).prefs = state; instances.set(path, ref);
    }
    return instances.get(path);
  });
  defContext('deleteSharedPreferences', `(${STRING})Z`, (r, _m, [, name]) => { const path = prefsPath(text(r, name)); instances.delete(path); fs().delete(path + '.bak'); return fs().delete(path) === 'ok' ? 1 : 0; });
  defContext('getSharedPreferencesPath', `(${STRING})${FILE}`, (r, _m, [, name]) => file(r, prefsPath(text(r, name))));
  const state = (r, ref) => r.object(ref).prefs;
  const castFail = (r, entry, expected) => r.throwJava('Ljava/lang/ClassCastException;', `${({ s: 'java.lang.String', i: 'java.lang.Integer', j: 'java.lang.Long', f: 'java.lang.Float', z: 'java.lang.Boolean', set: 'java.util.HashSet' })[entry.t]} cannot be cast to ${expected}`);
  const setObject = (r, members) => { const set = r.allocate('Ljava/util/HashSet;'); r.dispatch({ owner: 'Ljava/util/HashSet;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [set], 'direct'); for (const m of members) r.dispatch({ owner: 'Ljava/util/HashSet;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [set, m], 'virtual'); return set; };
  const typed = (code, expected, convert) => (r, _m, [self, key, fallback]) => {
    const entry = state(r, self).map.get(text(r, key)); if (!entry) return fallback;
    if (entry.t !== code) castFail(r, entry, expected); return convert(entry.v);
  };
  def(SP_IMPL, 'getString', `(${STRING}${STRING})${STRING}`, typed('s', 'java.lang.String', v => v));
  def(SP_IMPL, 'getInt', `(${STRING}I)I`, typed('i', 'java.lang.Integer', v => v));
  def(SP_IMPL, 'getLong', `(${STRING}J)J`, typed('j', 'java.lang.Long', v => v));
  def(SP_IMPL, 'getFloat', `(${STRING}F)F`, typed('f', 'java.lang.Float', v => floatBits(v)));
  def(SP_IMPL, 'getBoolean', `(${STRING}Z)Z`, typed('z', 'java.lang.Boolean', v => v ? 1 : 0));
  def(SP_IMPL, 'getStringSet', `(${STRING}Ljava/util/Set;)Ljava/util/Set;`, (r, _m, [self, key, fallback]) => {
    const entry = state(r, self).map.get(text(r, key)); if (!entry) return fallback; if (entry.t !== 'set') castFail(r, entry, 'java.util.Set');
    return entry.ref ??= setObject(r, entry.v); // the stored set itself, as in SharedPreferencesImpl
  });
  def(SP_IMPL, 'contains', `(${STRING})Z`, (r, _m, [self, key]) => state(r, self).map.has(text(r, key)) ? 1 : 0);
  def(SP_IMPL, 'getAll', '()Ljava/util/Map;', (r, _m, [self]) => {
    const map = r.allocate('Ljava/util/HashMap;'); r.dispatch({ owner: 'Ljava/util/HashMap;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [map], 'direct');
    for (const [key, entry] of state(r, self).map) {
      const value = entry.t === 's' ? entry.v : entry.t === 'set' ? (entry.ref ??= setObject(r, entry.v)) : entry.t === 'f' ? r.boxPrimitive('F', floatBits(entry.v)) : r.boxPrimitive(({ i: 'I', j: 'J', z: 'Z' })[entry.t], entry.t === 'z' ? (entry.v ? 1 : 0) : entry.v);
      r.dispatch({ owner: 'Ljava/util/HashMap;', name: 'put', parameters: [OBJECT, OBJECT], result: OBJECT, signature: `(${OBJECT}${OBJECT})${OBJECT}` }, [map, key, value], 'virtual');
    }
    return map;
  });
  def(SP_IMPL, 'registerOnSharedPreferenceChangeListener', `(${LISTENER})V`, (r, _m, [self, l]) => { const st = state(r, self); if (!st.listeners.some(x => x.ref === l.ref)) st.listeners.push(l); });
  def(SP_IMPL, 'unregisterOnSharedPreferenceChangeListener', `(${LISTENER})V`, (r, _m, [self, l]) => { const st = state(r, self); st.listeners = st.listeners.filter(x => x.ref !== l.ref); });
  def(SP_IMPL, 'edit', `()${EDITOR}`, (r, _m, [self]) => { const ed = r.allocate(EDITOR_IMPL); r.object(ed).editor = { prefs: self, modified: new Map(), clear: false }; return ed; });

  const ed = (r, ref) => r.object(ref).editor;
  const put = (code, convert) => (r, _m, [self, key, value]) => { ed(r, self).modified.set(text(r, key), convert(r, value)); return self; };
  def(EDITOR_IMPL, 'putString', `(${STRING}${STRING})${EDITOR}`, put('s', (r, v) => v === null ? null : { t: 's', v: r.stringCharacters(v) }));
  def(EDITOR_IMPL, 'putInt', `(${STRING}I)${EDITOR}`, put('i', (_r, v) => ({ t: 'i', v })));
  def(EDITOR_IMPL, 'putLong', `(${STRING}J)${EDITOR}`, put('j', (_r, v) => ({ t: 'j', v: BigInt.asIntN(64, BigInt(v)) })));
  def(EDITOR_IMPL, 'putFloat', `(${STRING}F)${EDITOR}`, put('f', (_r, v) => ({ t: 'f', v: bitsFloat(v) })));
  def(EDITOR_IMPL, 'putBoolean', `(${STRING}Z)${EDITOR}`, put('z', (_r, v) => ({ t: 'z', v: !!v })));
  def(EDITOR_IMPL, 'putStringSet', `(${STRING}Ljava/util/Set;)${EDITOR}`, put('set', (r, v) => {
    if (v === null) return null; // a null set is a removal
    const iterator = r.dispatch({ owner: 'Ljava/util/Set;', name: 'iterator', parameters: [], result: 'Ljava/util/Iterator;', signature: '()Ljava/util/Iterator;' }, [v], 'virtual'), members = [];
    for (;;) { if (!r.dispatch({ owner: 'Ljava/util/Iterator;', name: 'hasNext', parameters: [], result: 'Z', signature: '()Z' }, [iterator], 'virtual')) break; const m = r.dispatch({ owner: 'Ljava/util/Iterator;', name: 'next', parameters: [], result: OBJECT, signature: `()${OBJECT}` }, [iterator], 'virtual'); members.push(m === null ? null : r.stringCharacters(m)); }
    return { t: 'set', v: members };
  }));
  def(EDITOR_IMPL, 'remove', `(${STRING})${EDITOR}`, (r, _m, [self, key]) => { ed(r, self).modified.set(text(r, key), REMOVE); return self; });
  def(EDITOR_IMPL, 'clear', `()${EDITOR}`, (r, _m, [self]) => { ed(r, self).clear = true; return self; });

  /** EditorImpl.commitToMemory: clear first, then the staged puts in insertion order; returns what must be written and whom to notify. */
  function commitToMemory(r, editor) {
    const st = state(r, editor.prefs), map = st.map; let changes = false; const keysModified = [], hasListeners = st.listeners.length > 0; let keysCleared = false;
    if (editor.clear) { if (map.size) { changes = true; map.clear(); } keysCleared = true; editor.clear = false; }
    for (const [key, value] of editor.modified) {
      if (value === REMOVE || value === null) { if (!map.has(key)) continue; map.delete(key); }
      else { const existing = map.get(key); if (existing && entryEquals(existing, value)) continue; map.set(key, value); }
      changes = true; if (hasListeners) keysModified.push(key);
    }
    editor.modified.clear(); if (changes) st.generation++;
    return { st, snapshot: new Map(map), changes, keysModified, keysCleared, listeners: hasListeners ? [...st.listeners] : null, generation: st.generation };
  }
  function notifyListeners(r, mcr, owner) {
    // Single-threaded VM: the caller is the main thread, so Looper.myLooper() == getMainLooper() and listeners run inline (SharedPreferencesImpl.notifyListeners).
    if (!mcr.listeners || (!mcr.keysModified.length && !mcr.keysCleared)) return;
    const call = key => { for (const l of mcr.listeners) r.dispatch({ owner: LISTENER, name: 'onSharedPreferenceChanged', parameters: [SP, STRING], result: 'V', signature: `(${SP}${STRING})V` }, [l, owner, key], 'virtual'); };
    if (mcr.keysCleared && r.apiLevel >= 30) call(null); // listeners learned about clear() with a null key in Android 11
    for (let i = mcr.keysModified.length - 1; i >= 0; i--) call(mcr.keysModified[i]);
  }
  function writeNeeded(r, mcr) {
    const f = fs(); if (!f.stat(mcr.st.path)) return true;
    if (mcr.st.diskGeneration !== undefined && mcr.st.diskGeneration >= mcr.generation) return false;
    return mcr.changes || (mcr.st.diskGeneration ?? 0) < mcr.generation;
  }
  def(EDITOR_IMPL, 'commit', '()Z', (r, _m, [self]) => {
    const editor = ed(r, self), mcr = commitToMemory(r, editor); let ok = true;
    if (writeNeeded(r, mcr)) { ok = writeFile(r, mcr.st.path, mcr.snapshot); if (ok) mcr.st.diskGeneration = mcr.generation; }
    notifyListeners(r, mcr, editor.prefs); return ok ? 1 : 0;
  });
  def(EDITOR_IMPL, 'apply', '()V', (r, _m, [self]) => {
    const editor = ed(r, self), mcr = commitToMemory(r, editor);
    // Memory and listeners are updated now; the file is written by a later task, in order (enqueueDiskWrite on the single-threaded writer).
    if (writeNeeded(r, mcr)) platform.queueTask(() => { if (writeFile(r, mcr.st.path, mcr.snapshot)) mcr.st.diskGeneration = Math.max(mcr.st.diskGeneration ?? 0, mcr.generation); }, 0, []);
    notifyListeners(r, mcr, editor.prefs);
  });

  // ---- ProviderInfo / ContentProvider -----------------------------------------------------------------------------------------------------------
  type(ITEM_INFO, OBJECT, [], { allocatable: true }); type(COMPONENT_INFO, ITEM_INFO, [], { allocatable: true }); type(PROVIDER_INFO, COMPONENT_INFO, [], { allocatable: true });
  for (const [owner, name, ftype] of [[ITEM_INFO, 'name', STRING], [ITEM_INFO, 'packageName', STRING], [ITEM_INFO, 'metaData', BUNDLE], [COMPONENT_INFO, 'applicationInfo', APPLICATION_INFO], [COMPONENT_INFO, 'processName', STRING],
    [COMPONENT_INFO, 'enabled', 'Z'], [COMPONENT_INFO, 'exported', 'Z'], [COMPONENT_INFO, 'directBootAware', 'Z'], [PROVIDER_INFO, 'authority', STRING], [PROVIDER_INFO, 'readPermission', STRING], [PROVIDER_INFO, 'writePermission', STRING],
    [PROVIDER_INFO, 'grantUriPermissions', 'Z'], [PROVIDER_INFO, 'multiprocess', 'Z'], [PROVIDER_INFO, 'initOrder', 'I'], [PROVIDER_INFO, 'flags', 'I']]) registry.instanceField(owner, name, ftype, { reflect: true });
  const dispatchBundle = (r, bundle, name, parameters, args) => r.dispatch({ owner: BUNDLE, name, parameters, result: 'V', signature: `(${parameters.join('')})V` }, [bundle, ...args], 'virtual');
  function metaDataBundle(r, entries) {
    if (!entries?.length) return null;
    const bundle = platform.bundle(r);
    for (const { name, value, valueType, resource } of entries) {
      if (resource !== undefined) { dispatchBundle(r, bundle, 'putInt', [STRING, 'I'], [name, resource | 0]); continue; }
      if (valueType === 3) dispatchBundle(r, bundle, 'putString', [STRING, STRING], [name, value]);
      else if (valueType === 1) { // reference: PackageParser resolves it to the final typed value
        let resolved; try { resolved = platform.resource(value, ['string']).value; } catch { resolved = undefined; }
        if (typeof resolved === 'string') dispatchBundle(r, bundle, 'putString', [STRING, STRING], [name, resolved]); else dispatchBundle(r, bundle, 'putInt', [STRING, 'I'], [name, value | 0]);
      } else if (valueType === 0x12) dispatchBundle(r, bundle, 'putBoolean', [STRING, 'Z'], [name, isTrue(value) ? 1 : 0]);
      else if (valueType === 4) dispatchBundle(r, bundle, 'putFloat', [STRING, 'F'], [name, value | 0]);
      else dispatchBundle(r, bundle, 'putInt', [STRING, 'I'], [name, value | 0]);
    }
    return bundle;
  }
  const processName = () => platform.manifest?.application?.process ?? pkg();
  function makeProviderInfo(r, detail, withMeta) {
    const info = r.allocate(PROVIDER_INFO), put = (owner, name, ftype, value) => r.storeField(r.object(info).fields, `${owner}->${name}:${ftype}`, value);
    put(ITEM_INFO, 'name', STRING, detail.name); put(ITEM_INFO, 'packageName', STRING, pkg()); put(ITEM_INFO, 'metaData', BUNDLE, withMeta ? metaDataBundle(r, detail.metaData) : null);
    put(COMPONENT_INFO, 'applicationInfo', APPLICATION_INFO, platform.applicationInfo(r)); put(COMPONENT_INFO, 'processName', STRING, providerProcess(detail));
    put(COMPONENT_INFO, 'enabled', 'Z', isFalse(detail.enabled) ? 0 : 1); put(COMPONENT_INFO, 'exported', 'Z', isTrue(detail.exported) ? 1 : 0); put(COMPONENT_INFO, 'directBootAware', 'Z', isTrue(detail.directBootAware) ? 1 : 0);
    put(PROVIDER_INFO, 'authority', STRING, detail.authorities); put(PROVIDER_INFO, 'readPermission', STRING, detail.permission); put(PROVIDER_INFO, 'writePermission', STRING, detail.permission);
    put(PROVIDER_INFO, 'grantUriPermissions', 'Z', isTrue(detail.grantUriPermissions) ? 1 : 0); put(PROVIDER_INFO, 'multiprocess', 'Z', isTrue(detail.multiprocess) ? 1 : 0); put(PROVIDER_INFO, 'initOrder', 'I', Number(detail.initOrder) | 0); put(PROVIDER_INFO, 'flags', 'I', 0);
    return info;
  }
  const providerProcess = detail => detail.process ? (detail.process.startsWith(':') ? pkg() + detail.process : detail.process) : processName();

  type(CP, OBJECT, ['Landroid/content/ComponentCallbacks2;'], { allocatable: true });
  def(CP, '<init>', '()V', () => {});
  const attach = (r, _m, [self, context, info]) => {
    const object = r.object(self); if (object.providerContext) return; // ContentProvider.attachInfo only initializes once
    object.providerContext = context; object.providerInfo = info;
    r.dispatch({ owner: CP, name: 'onCreate', parameters: [], result: 'Z', signature: '()Z' }, [self], 'virtual');
  };
  def(CP, 'attachInfo', `(${CONTEXT}${PROVIDER_INFO})V`, attach); def(CP, 'attachInfo', `(${CONTEXT}${PROVIDER_INFO}Z)V`, attach);
  def(CP, 'getContext', `()${CONTEXT}`, (r, _m, [self]) => r.object(self).providerContext ?? null);
  def(CP, 'isTemporary', '()Z', () => 0);
  def(CP, 'getCallingPackage', `()${STRING}`, () => null); // outside a Binder transaction there is no caller
  for (const name of ['onLowMemory']) def(CP, name, '()V', () => {}); // ContentProvider's own empty ComponentCallbacks bodies
  def(CP, 'onTrimMemory', '(I)V', () => {}); def(CP, 'onConfigurationChanged', '(Landroid/content/res/Configuration;)V', () => {});
  def(CP, 'shutdown', '()V', r => r.record('LOG W ContentProvider: implement shutdown() only for tests'));

  // ---- system services (Context.getSystemService) ------------------------------------------------------------------------------------------------
  // A service exists only when a contract below implements it; unknown names stay the explicit "not installed in the virtual device" error.
  const services = new Map(), serviceByClass = new Map(), serviceObjects = new WeakMap();
  const service = (name, classType, hostType = classType.replace(/;$/, '') + 'Impl;') => { services.set(name, hostType); serviceByClass.set(classType, name); type(classType, OBJECT, [], { allocatable: false }); type(hostType, classType, [], { allocatable: true }); return hostType; };
  const getService = (r, name) => {
    const hostType = services.get(name); if (!hostType) return null;
    const cache = serviceObjects.get(r) ?? serviceObjects.set(r, gcRoot(new Map())).get(r);
    if (!cache.has(name)) cache.set(name, r.allocate(hostType));
    return cache.get(name);
  };
  // UserManager: the virtual device has exactly one user (0), always unlocked (credential-protected storage is the in-memory VFS).
  const USER_MANAGER = service('user', 'Landroid/os/UserManager;');
  def(USER_MANAGER, 'isUserUnlocked', '()Z', () => 1); def(USER_MANAGER, 'isUserUnlocked', '(Landroid/os/UserHandle;)Z', () => 1);
  def(USER_MANAGER, 'isUserRunning', '(Landroid/os/UserHandle;)Z', () => 1); def(USER_MANAGER, 'isSystemUser', '()Z', () => 1);
  def(USER_MANAGER, 'isManagedProfile', '()Z', () => 0); def(USER_MANAGER, 'isDemoUser', '()Z', () => 0); def(USER_MANAGER, 'isGuestUser', '()Z', () => 0);

  // ActivityManager: the virtual device runs exactly this app's process, in the foreground; memory figures are the VM's declared device (4 GiB RAM, 256 MiB app heap).
  const ACTIVITY_MANAGER = service('activity', 'Landroid/app/ActivityManager;'), PROC_INFO = 'Landroid/app/ActivityManager$RunningAppProcessInfo;', MEM_INFO = 'Landroid/app/ActivityManager$MemoryInfo;';
  type(PROC_INFO, OBJECT, [], { allocatable: true }); type(MEM_INFO, OBJECT, [], { allocatable: true });
  def(PROC_INFO, '<init>', '()V', () => {}); def(MEM_INFO, '<init>', '()V', () => {});
  for (const [name, ftype] of [['processName', STRING], ['pid', 'I'], ['uid', 'I'], ['importance', 'I'], ['importanceReasonCode', 'I'], ['pkgList', '[Ljava/lang/String;']]) registry.instanceField(PROC_INFO, name, ftype, { reflect: true });
  // Choreographer's frame bookkeeping is read by reflection in some libraries (hidden-API greylist 'unsupported' fields, still reachable on API 28-ish targets): the value is the last frame time the VM produced.
  registry.instanceField('Landroid/view/Choreographer;', 'mLastFrameTimeNanos', 'J', { reflect: true });
  for (const [name, ftype] of [['availMem', 'J'], ['totalMem', 'J'], ['threshold', 'J'], ['lowMemory', 'Z']]) registry.instanceField(MEM_INFO, name, ftype, { reflect: true });
  def(ACTIVITY_MANAGER, 'getRunningAppProcesses', '()Ljava/util/List;', r => {
    const list = newEmptyList(r), info = r.allocate(PROC_INFO), put = (name, ftype, value) => r.storeField(r.object(info).fields, `${PROC_INFO}->${name}:${ftype}`, value), packages = r.newArray('[Ljava/lang/String;', 1);
    r.array(packages).elements = [pkg()];
    put('processName', STRING, processName()); put('pid', 'I', platform.virtualProcess.pid); put('uid', 'I', platform.virtualProcess.uid); put('importance', 'I', 100); put('importanceReasonCode', 'I', 0); put('pkgList', '[Ljava/lang/String;', packages);
    r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, info], 'virtual'); return list;
  });
  def(ACTIVITY_MANAGER, 'getMemoryInfo', `(${MEM_INFO})V`, (r, _m, [, info]) => {
    const total = 4n * 1024n * 1024n * 1024n, put = (name, ftype, value) => r.storeField(r.object(info).fields, `${MEM_INFO}->${name}:${ftype}`, value);
    put('totalMem', 'J', total); put('availMem', 'J', total / 2n); put('threshold', 'J', 200n * 1024n * 1024n); put('lowMemory', 'Z', 0);
  });
  def(ACTIVITY_MANAGER, 'isLowRamDevice', '()Z', () => 0); def(ACTIVITY_MANAGER, 'getMemoryClass', '()I', () => 256); def(ACTIVITY_MANAGER, 'getLargeMemoryClass', '()I', () => 512);
  def(ACTIVITY_MANAGER, 'isBackgroundRestricted', '()Z', () => 0);
  def(ACTIVITY_MANAGER, 'getHistoricalProcessExitReasons', `(${STRING}II)Ljava/util/List;`, r => newEmptyList(r)); // a fresh virtual process has no exit history

  // PowerManager / WakeLock (frameworks/base/core/java/android/os/PowerManager.java): the device is awake and interactive; wake locks keep the AOSP reference counting
  // (RuntimeException "WakeLock under-locked <tag>"), and acquire(timeout) lapses against the VM's virtual clock. Holding one has no further effect on this device.
  const POWER_MANAGER = service('power', 'Landroid/os/PowerManager;'), WAKE_LOCK = 'Landroid/os/PowerManager$WakeLock;', WAKE_LOCK_LEVELS = new Set([1, 6, 10, 26, 32, 64, 128]);
  type(WAKE_LOCK, OBJECT, [], { allocatable: true });
  def(POWER_MANAGER, 'newWakeLock', `(I${STRING})${WAKE_LOCK}`, (r, _m, [, levelAndFlags, tag]) => {
    if (tag === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'The tag must not be null.');
    if (!WAKE_LOCK_LEVELS.has(levelAndFlags & 0xffff)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Must specify a valid wake lock level.');
    const lock = r.allocate(WAKE_LOCK); r.object(lock).wakeLock = { levelAndFlags, tag: r.stringCharacters(tag), refCounted: true, internal: 0, external: 0, held: false, timeouts: [] }; return lock;
  });
  const wakeLock = (r, ref) => {
    const state = r.object(ref).wakeLock, now = r.clock.wall();
    for (const due of state.timeouts.filter(at => at <= now)) { state.timeouts.splice(state.timeouts.indexOf(due), 1); releaseWakeLock(state, true); }   // the Handler.postDelayed(mReleaser) of acquire(timeout)
    return state;
  };
  const releaseWakeLock = (state, byTimeout) => {
    state.internal--; if (!byTimeout) state.external--;
    if (!state.refCounted || state.internal === 0) state.held = false;
    return state.refCounted && state.external < 0;
  };
  def(WAKE_LOCK, 'acquire', '()V', (r, _m, [self]) => { const state = wakeLock(r, self); state.internal++; state.external++; if (!state.refCounted || state.internal === 1) state.held = true; });
  def(WAKE_LOCK, 'acquire', '(J)V', (r, _m, [self, timeout]) => {
    const state = wakeLock(r, self); state.internal++; state.external++; if (!state.refCounted || state.internal === 1) state.held = true;
    state.timeouts.push(r.clock.wall() + Number(timeout));
  });
  const release = (r, self, flags) => { const state = wakeLock(r, self); if (releaseWakeLock(state, (flags & 1) !== 0)) r.throwJava('Ljava/lang/RuntimeException;', `WakeLock under-locked ${state.tag}`); };
  def(WAKE_LOCK, 'release', '()V', (r, _m, [self]) => release(r, self, 0)); def(WAKE_LOCK, 'release', '(I)V', (r, _m, [self, flags]) => release(r, self, flags));
  def(WAKE_LOCK, 'isHeld', '()Z', (r, _m, [self]) => wakeLock(r, self).held ? 1 : 0);
  def(WAKE_LOCK, 'setReferenceCounted', '(Z)V', (r, _m, [self, value]) => { const state = wakeLock(r, self); state.refCounted = !!value; });
  def(WAKE_LOCK, 'toString', `()${STRING}`, (r, _m, [self]) => { const state = wakeLock(r, self); return `WakeLock{${(r.object(self).id >>> 0).toString(16)} held=${state.held}, refCount=${state.internal}}`; });
  def(POWER_MANAGER, 'isInteractive', '()Z', () => 1); def(POWER_MANAGER, 'isScreenOn', '()Z', () => 1);
  def(POWER_MANAGER, 'isPowerSaveMode', '()Z', () => 0); def(POWER_MANAGER, 'isDeviceIdleMode', '()Z', () => 0); def(POWER_MANAGER, 'isLightDeviceIdleMode', '()Z', () => 0);
  def(POWER_MANAGER, 'isIgnoringBatteryOptimizations', `(${STRING})Z`, () => 0); def(POWER_MANAGER, 'isSustainedPerformanceModeSupported', '()Z', () => 0);
  def(POWER_MANAGER, 'getCurrentThermalStatus', '()I', () => 0); def(POWER_MANAGER, 'isWakeLockLevelSupported', '(I)Z', (_r, _m, [, level]) => level === 1 || level === 6 || level === 10 || level === 26 || level === 128 ? 1 : 0);

  // ---- PackageManager.getServiceInfo (ServiceInfo = ComponentInfo + permission/flags/foregroundServiceType) --------------------------------------
  const SERVICE_INFO = 'Landroid/content/pm/ServiceInfo;';
  type(SERVICE_INFO, COMPONENT_INFO, [], { allocatable: true });
  for (const [name, ftype] of [['permission', STRING], ['flags', 'I'], ['foregroundServiceType', 'I']]) registry.instanceField(SERVICE_INFO, name, ftype, { reflect: true });
  function fillComponentInfo(r, info, detail, withMeta) {
    const put = (owner, name, ftype, value) => r.storeField(r.object(info).fields, `${owner}->${name}:${ftype}`, value);
    put(ITEM_INFO, 'name', STRING, detail.name); put(ITEM_INFO, 'packageName', STRING, pkg()); put(ITEM_INFO, 'metaData', BUNDLE, withMeta ? metaDataBundle(r, detail.metaData) : null);
    put(COMPONENT_INFO, 'applicationInfo', APPLICATION_INFO, platform.applicationInfo(r)); put(COMPONENT_INFO, 'processName', STRING, providerProcess(detail));
    put(COMPONENT_INFO, 'enabled', 'Z', isFalse(detail.enabled) ? 0 : 1); put(COMPONENT_INFO, 'exported', 'Z', isTrue(detail.exported) ? 1 : 0); put(COMPONENT_INFO, 'directBootAware', 'Z', isTrue(detail.directBootAware) ? 1 : 0);
    return put;
  }
  // ---- component enabled state (ApplicationPackageManager.setComponentEnabledSetting): an app may toggle its own components; state lives for the VM's lifetime like a user-0 package setting.
  // getXInfo(...).enabled and Intent resolution of disabled components are not re-derived from it yet (components are never resolved by Intent in this VM).
  const COMPONENT_STATES = new Map();
  const componentKey = (r, component) => { const c = r.object(component); return `${c.packageName}/${c.className}`; };
  const KNOWN_KINDS = new Set(['activity', 'service', 'receiver', 'provider']);
  def(PACKAGE_MANAGER, 'setComponentEnabledSetting', '(Landroid/content/ComponentName;II)V', (r, _m, [, component, state, flags]) => {
    if (component === null || component === 0) r.throwJava('Ljava/lang/NullPointerException;', 'componentName');
    if (![0, 1, 2, 3, 4].includes(state)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Invalid new component state: ' + state);
    const c = r.object(component), declared = (platform.manifest?.componentDetails ?? []).some(detail => KNOWN_KINDS.has(detail.kind) && detail.name === c.className) || (platform.manifest?.activities ?? []).includes(c.className);
    if (c.packageName !== pkg() || !declared) r.throwJava('Ljava/lang/IllegalArgumentException;', `Unknown component: ComponentInfo{${c.packageName}/${c.className}}`);
    if (state === 0) COMPONENT_STATES.delete(componentKey(r, component)); else COMPONENT_STATES.set(componentKey(r, component), state);
    r.record(`PM setComponentEnabledSetting ${c.className} state=${state} flags=${flags}`);
  });
  def(PACKAGE_MANAGER, 'getComponentEnabledSetting', '(Landroid/content/ComponentName;)I', (r, _m, [, component]) => {
    if (component === null || component === 0) r.throwJava('Ljava/lang/NullPointerException;', 'componentName');
    const c = r.object(component), declared = (platform.manifest?.componentDetails ?? []).some(detail => KNOWN_KINDS.has(detail.kind) && detail.name === c.className) || (platform.manifest?.activities ?? []).includes(c.className);
    if (c.packageName !== pkg() || !declared) r.throwJava('Ljava/lang/IllegalArgumentException;', `Unknown component: ComponentInfo{${c.packageName}/${c.className}}`);
    return COMPONENT_STATES.get(componentKey(r, component)) ?? 0;
  });
  for (const [name, value] of Object.entries({ COMPONENT_ENABLED_STATE_DEFAULT: 0, COMPONENT_ENABLED_STATE_ENABLED: 1, COMPONENT_ENABLED_STATE_DISABLED: 2, COMPONENT_ENABLED_STATE_DISABLED_USER: 3, COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED: 4, DONT_KILL_APP: 1, SYNCHRONOUS: 4 })) registry.staticField(PACKAGE_MANAGER, name, 'I', () => value);
  def(PACKAGE_MANAGER, 'getServiceInfo', `(Landroid/content/ComponentName;I)${SERVICE_INFO}`, (r, _m, [, component, flags]) => {
    const c = r.object(component), detail = (platform.manifest?.componentDetails ?? []).find(p => p.kind === 'service' && p.name === c.className);
    if (c.packageName !== pkg() || !detail) r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', `ComponentInfo{${c.packageName}/${c.className}}`);
    const info = r.allocate(SERVICE_INFO), put = fillComponentInfo(r, info, detail, (flags & 128) !== 0);
    put(SERVICE_INFO, 'permission', STRING, detail.permission); put(SERVICE_INFO, 'flags', 'I', 0); put(SERVICE_INFO, 'foregroundServiceType', 'I', Number(detail.foregroundServiceType) | 0);
    return info;
  });

  // ---- AssetManager over the APK's assets/ tree -----------------------------------------------------------------------------------------------
  const ASSETS = 'Landroid/content/res/AssetManager;'; type(ASSETS, OBJECT, ['Ljava/lang/AutoCloseable;'], { allocatable: true });
  const assetManager = r => platform.assetManager ??= r.allocate(ASSETS);
  defContext('getAssets', `()${ASSETS}`, r => assetManager(r));
  def('Landroid/content/res/Resources;', 'getAssets', `()${ASSETS}`, r => assetManager(r));
  const assetEntry = (r, name) => { const n = text(r, name).replace(/^\/+/, ''); return { n, entry: 'assets/' + n }; };
  const openAsset = (r, _m, [, name]) => { const { n, entry } = assetEntry(r, name); if (!r.apkEntries.has(entry)) r.throwJava('Ljava/io/FileNotFoundException;', n); return platform.javaIo.apkResourceStream(r, entry); };
  def(ASSETS, 'open', `(${STRING})Ljava/io/InputStream;`, openAsset); def(ASSETS, 'open', `(${STRING}I)Ljava/io/InputStream;`, openAsset);
  def(ASSETS, 'openFd', `(${STRING})Landroid/content/res/AssetFileDescriptor;`, (r, _m, [, name]) => { const { n, entry } = assetEntry(r, name); if (!r.apkEntries.has(entry)) r.throwJava('Ljava/io/FileNotFoundException;', 'This file can not be opened as a file descriptor; it is probably compressed or missing: ' + n); throw new APKError(`AssetManager.openFd(${n}): file descriptors for APK assets are not implemented`, { kind: 'asset-fd-unsupported' }); });
  def(ASSETS, 'list', `(${STRING})[${STRING}`, (r, _m, [, path]) => {
    const prefix = 'assets/' + text(r, path).replace(/^\/+|\/+$/g, ''), base = prefix === 'assets/' ? 'assets/' : prefix + '/', names = new Set();
    for (const e of r.apkEntries) if (e.startsWith(base) && e.length > base.length) names.add(e.slice(base.length).split('/')[0]);
    const array = r.newArray('[Ljava/lang/String;', names.size); r.array(array).elements = [...names]; return array;
  });
  def(ASSETS, 'close', '()V', () => {});

  // ---- PackageManager.getPackageInfo (only this package is installed; Play Services and every other package are NameNotFoundException) -----------
  const PACKAGE_INFO = 'Landroid/content/pm/PackageInfo;', installTime = Date.now();
  type(PACKAGE_INFO, OBJECT, [], { allocatable: true });
  for (const [name, ftype] of [['packageName', STRING], ['versionName', STRING], ['versionCode', 'I'], ['longVersionCode', 'J'], ['firstInstallTime', 'J'], ['lastUpdateTime', 'J'], ['applicationInfo', APPLICATION_INFO], ['requestedPermissions', '[Ljava/lang/String;'], ['signatures', '[Landroid/content/pm/Signature;']]) registry.instanceField(PACKAGE_INFO, name, ftype, { reflect: true });
  def(PACKAGE_INFO, 'getLongVersionCode', '()J', (r, _m, [self]) => r.object(self).fields.get(`${PACKAGE_INFO}->longVersionCode:J`) ?? 0n);
  def(PACKAGE_MANAGER, 'getPackageInfo', `(${STRING}I)${PACKAGE_INFO}`, (r, _m, [, name, flags]) => {
    const n = text(r, name); if (n !== pkg()) r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', n);
    if (flags & (0x40 | 0x08000000)) throw new APKError('PackageManager.getPackageInfo with GET_SIGNATURES / GET_SIGNING_CERTIFICATES needs the APK signing block, which is not parsed yet', { kind: 'signatures-unsupported' });
    const info = r.allocate(PACKAGE_INFO), put = (name2, ftype, value) => r.storeField(r.object(info).fields, `${PACKAGE_INFO}->${name2}:${ftype}`, value), attrs = platform.manifest?.manifestAttrs ?? {};
    const code = Number(attrs.versionCode ?? 0) | 0;
    put('packageName', STRING, pkg()); put('versionName', STRING, typeof attrs.versionName === 'string' ? attrs.versionName : null); put('versionCode', 'I', code); put('longVersionCode', 'J', BigInt(code));
    put('firstInstallTime', 'J', BigInt(installTime)); put('lastUpdateTime', 'J', BigInt(installTime)); put('applicationInfo', APPLICATION_INFO, platform.applicationInfo(r)); return info;
  });

  // The lab installs the APK itself: no store recorded it, so the installer package is null (what adb/sideloaded installs report).
  def(PACKAGE_MANAGER, 'checkPermission', `(${STRING}${STRING})I`, (r, _m, [, permission, name]) => { const permissionName = needPermission(r, permission); if (name === null) r.throwJava('Ljava/lang/NullPointerException;', null); return text(r, name) === pkg() && holdsPermission(r, permissionName) ? PERMISSION_GRANTED : PERMISSION_DENIED; });   // other packages are not installed on the virtual device
  def(PACKAGE_MANAGER, 'getInstallerPackageName', `(${STRING})${STRING}`, (r, _m, [, name]) => { const n = text(r, name); if (n !== pkg()) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Unknown package: ' + n); return null; });

  // PackageManager.queryIntentContentProviders: the virtual device has one installed package (this app), no Play Services and no system font
  // provider, so an action (e.g. androidx.content.action.FONT_PROVIDER) resolves only to providers this app declares for it.
  def(PACKAGE_MANAGER, 'queryIntentContentProviders', `(Landroid/content/Intent;I)Ljava/util/List;`, (r, _m, [, intent]) => {
    const action = r.dispatch({ owner: 'Landroid/content/Intent;', name: 'getAction', parameters: [], result: STRING, signature: `()${STRING}` }, [intent], 'virtual');
    const matches = (platform.manifest?.providerDetails ?? []).filter(p => action !== null && p.actions?.includes(r.stringCharacters(action)));
    if (matches.length) throw new APKError(`queryIntentContentProviders(${r.stringCharacters(action)}) matches ${matches.length} provider(s) of this app; ResolveInfo transport is not implemented`, { kind: 'resolve-info-unsupported' });
    return newEmptyList(r);
  });
  function newEmptyList(r) { const list = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct'); return list; }

  // ---- PackageManager.getProviderInfo ---------------------------------------------------------------------------------------------------------
  def(PACKAGE_MANAGER, 'getProviderInfo', `(Landroid/content/ComponentName;I)${PROVIDER_INFO}`, (r, _m, [, component, flags]) => {
    const c = r.object(component), detail = (platform.manifest?.providerDetails ?? []).find(p => p.name === c.className);
    if (c.packageName !== pkg() || !detail) r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', `ComponentInfo{${c.packageName}/${c.className}}`);
    return makeProviderInfo(r, detail, (flags & 128) !== 0);
  });

  // PackageManager.resolveContentProvider(authority, flags): only this app's enabled providers exist on the virtual device (no system providers), so any other authority is null.
  def(PACKAGE_MANAGER, 'resolveContentProvider', `(${STRING}I)${PROVIDER_INFO}`, (r, _m, [, authority, flags]) => {
    const wanted = text(r, authority), detail = (platform.manifest?.providerDetails ?? []).find(p => !isFalse(p.enabled) && String(p.authorities ?? '').split(';').includes(wanted));
    return detail ? makeProviderInfo(r, detail, (flags & 128) !== 0) : null;
  });

  /**
   * ActivityThread.installContentProviders for handleBindApplication: providers of this process (process attribute equal to the app's), enabled,
   * ordered by initOrder descending (manifest order among equals); each is instantiated, attachInfo()'d (which runs onCreate) with the Application
   * as Context. A provider failure aborts startup as RuntimeException("Unable to get provider ...") does on a device.
   */
  function installContentProviders(runtime) {
    const details = (platform.manifest?.providerDetails ?? []).filter(p => !isFalse(p.enabled) && providerProcess(p) === processName());
    details.sort((a, b) => (Number(b.initOrder) | 0) - (Number(a.initOrder) | 0) || a.order - b.order);
    const skipped = (platform.manifest?.providerDetails ?? []).length - details.length;
    runtime.record(`PROVIDERS install ${details.length} (skipped ${skipped}: other process or disabled) in initOrder`);
    for (const detail of details) {
      const className = 'L' + detail.name.replaceAll('.', '/') + ';';
      if (!runtime.classes.has(className) || !runtime.isSubtype(className, CP)) throw new APKError(`Unable to get provider ${detail.name}: class not found or not a ContentProvider`, { kind: 'provider-class' });
      const instance = runtime.allocate(className);
      runtime.dispatch({ owner: className, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [instance], 'direct');
      runtime.record(`PROVIDERS attachInfo ${detail.name} (initOrder ${Number(detail.initOrder) | 0})`);
      runtime.dispatch({ owner: CP, name: 'attachInfo', parameters: [CONTEXT, PROVIDER_INFO], result: 'V', signature: `(${CONTEXT}${PROVIDER_INFO})V` }, [instance, platform.application, makeProviderInfo(runtime, detail, true)], 'virtual');
    }
  }

  return { ...registry, [GC_ROOTS](visit) { visit(currentContext); }, interfaces: registry.interfacesOf, getService, metaDataBundle, serviceNameForClass: classType => serviceByClass.get(classType) ?? null, installContentProviders, preferenceInstances: instances };
}
