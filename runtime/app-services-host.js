import { resolveIntentFields } from './intent-resolver.js?v=7233a7b1ab13';
import { APKError } from './apk-error.js?v=7233a7b1ab13';
import { registerPackageValueFields } from './package-value-fields.js?v=7233a7b1ab13';
import { FRAMEWORK_PERMISSIONS } from './permission-data.js?v=7233a7b1ab13';
import { nativeHeap } from './vm-debug-host.js?v=7233a7b1ab13';
import { debugHeapStats, processMappings, deviceMemory, MEMORY_INFO_FIELDS, NUM_CORE_HEAP, NUM_HEAP, HEAP } from './process-memory.js?v=7233a7b1ab13';
import { createHostRegistry, bitsFloat, floatBits } from './host-contract.js?v=7233a7b1ab13';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=7233a7b1ab13';
import { PLATFORM_CERTIFICATE_BASE64 } from './platform-certificate-data.js?v=7233a7b1ab13';

// Application-process services between ActivityThread and the app: Context file/preference APIs, SharedPreferences (SharedPreferencesImpl
// semantics, XML files on the virtual filesystem), ContentProvider base class + ProviderInfo + installContentProviders, and the PackageManager
// provider lookup androidx.startup relies on. AOSP references: android-13.0.0_r1 ContextImpl.java, SharedPreferencesImpl.java,
// ContentProvider.java, ActivityThread.installContentProviders / handleBindApplication, ActivityManagerService.generateApplicationProvidersLocked.

const CONTEXT = 'Landroid/content/Context;', WRAPPER = 'Landroid/content/ContextWrapper;', IMPL = 'Landroid/app/ContextImpl;', MUTABLE_WRAPPER = 'Landroid/content/MutableContextWrapper;';
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
  // The package a Context API answers for: the app, or the companion package (src/package-registry.js) whose Context the call was made on.
  const appPkg = () => platform.packageName ?? 'app', fs = () => platform.javaIo.fs(), pkgs = () => platform.packages;
  const contextOwner = () => pkgs()?.multi && currentRuntime && currentContext ? pkgs().contextEntry(currentRuntime, currentContext) : null;
  const pkg = () => { const owner = contextOwner(); return owner && !owner.main ? owner.name : appPkg(); };
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
  // android.content.MutableContextWrapper: a ContextWrapper whose base can be replaced (ContextWrapper is a host class: its base is the record's baseContext, not a DEX field).
  type(MUTABLE_WRAPPER, WRAPPER, [], { allocatable: true });
  def(MUTABLE_WRAPPER, '<init>', `(${CONTEXT})V`, (r, _m, [self, base]) => { r.object(self).baseContext = base ?? null; });
  def(MUTABLE_WRAPPER, 'setBaseContext', `(${CONTEXT})V`, (r, _m, [self, base]) => { r.object(self).baseContext = base ?? null; });
  // ---- Context permission checks (ContextImpl.checkPermission & friends). The app is the only process, so every caller is the app itself; it holds a permission when
  // its manifest requests it and the permission is installed with "normal" protection (or is one the app defines itself); dangerous permissions stay denied until a
  // runtime grant (platform.grantedPermissions), signature/privileged ones never reach a third-party app.
  const PERMISSION_GRANTED = 0, PERMISSION_DENIED = -1;
  const holdsPermission = (r, permission) => {
    const manifest = platform.manifest ?? {}, sdk = r.apiLevel ?? 33, requested = (manifest.usesPermissions ?? []).find(entry => entry.name === permission && (entry.maxSdkVersion === null || Number(entry.maxSdkVersion) >= sdk));
    if (!requested) return false;
    if (pkgs()?.refusedPermissions?.has(permission)) return false;   // a device policy grants it to no package (src/microg-device.js); an app cannot redeclare it either
    if (platform.grantedPermissions?.has(permission)) return true;
    const own = (manifest.declaredPermissions ?? []).find(entry => entry.name === permission);
    let level = String(own ? 'normal' : FRAMEWORK_PERMISSIONS[permission] ?? '').split('|')[0];   // a permission the app declares itself is held by its own signature
    if (!own && !level && pkgs()?.multi) level = pkgs().levelFor(r, pkgs().main, permission) ?? '';   // a permission a companion package declares: its protection level (signature: same signers)
    return level === 'normal';
  };
  platform.holdsPermission = holdsPermission;   // the network layer answers getaddrinfo with EACCES when the app lacks INTERNET
  const needPermission = (r, permission) => { if (permission === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'permission is null'); return r.stringCharacters(permission); };
  /** The package a Context permission check is made for: the companion whose Context it is, else the app (null). */
  const selfEntry = () => { const owner = contextOwner(); return owner && !owner.main ? owner : null; };
  const holdsFor = (r, entry, permission) => entry && !entry.main ? pkgs().holds(r, entry, permission) : holdsPermission(r, permission);
  const check = (r, permission) => holdsFor(r, selfEntry(), needPermission(r, permission)) ? PERMISSION_GRANTED : PERMISSION_DENIED;
  /** Inside a Binder transaction from another package (src/package-registry.js): that package; else null (the calling process is this one). */
  const callingEntry = r => pkgs() && (pkgs().multi || pkgs().inTransaction(r)) && pkgs().callingPackage(r) !== null ? pkgs().callingIdentity(r).entry : null;
  const checkUid = (r, permission, pid, uid) => {
    const name = needPermission(r, permission), entry = pkgs()?.multi ? pkgs().byUid(uid) : null;
    if (entry && !entry.main) return entry.pid === pid && pkgs().holds(r, entry, name) ? PERMISSION_GRANTED : PERMISSION_DENIED;
    return pid === platform.virtualProcess.pid && uid === platform.virtualProcess.uid ? (holdsPermission(r, name) ? PERMISSION_GRANTED : PERMISSION_DENIED) : PERMISSION_DENIED;
  };
  const enforce = (r, permission, result, selfToo, message, uid = (selfEntry() ?? platform.virtualProcess).uid) => {
    if (result !== PERMISSION_GRANTED) r.throwJava('Ljava/lang/SecurityException;', `${message === null ? '' : r.stringCharacters(message) + ': '}${selfToo ? `Neither user ${uid} nor current process has ` : `uid ${uid} does not have `}${r.stringCharacters(permission)}.`);
  };
  // Service binding (ContextImpl.bindServiceCommon / ActiveServices): an implicit Intent is refused on API 21+; a service of a package that
  // is not installed (by default the virtual device has no other package) cannot be bound, so bindService returns false as Android does
  // for a missing service; an installed companion package's services are bound below (docs/MULTI-PACKAGE.md). This app's own declared services are bound in-process: created once (BIND_AUTO_CREATE),
  // onCreate, onBind once, and ServiceConnection.onServiceConnected (or onNullBinding) posted to the main thread; the last unbind runs
  // onUnbind and onDestroy. Started services (startService) are not covered here.
  const INTENT = 'Landroid/content/Intent;', COMPONENT = 'Landroid/content/ComponentName;', SERVICE_CONNECTION = 'Landroid/content/ServiceConnection;';
  const boundServices = gcRoot(new Map()), boundConnections = new Map();
  // Services of another installed package, and a companion package's own services (src/package-registry.js, docs/MULTI-PACKAGE.md): ActiveServices.retrieveServiceLocked
  // resolves the component (explicit, or by package and action), refuses a service that is not exported or whose android:permission the caller does not hold (SecurityException,
  // as ContextImpl.bindServiceCommon / startServiceCommon throw), and a package the caller cannot see (API 30 visibility) is absent. The service's process is started on demand;
  // onCreate, onBind and onServiceConnected follow on the main thread, as in the other process. Records share boundServices under the key "package/class".
  const packageConnections = new Map();   // connection ref -> { key, caller }
  const intentText = (r, intent) => {   // Intent.toString's short form (act, cat, dat, typ, pkg, cmp), as ActiveServices puts it in its SecurityException
    const f = platform.intentFields(r, r.object(intent)), parts = [], component = intentCall(r, intent, 'getComponent', COMPONENT);
    if (f.action) parts.push(`act=${f.action}`); if (f.categories.length) parts.push(`cat=[${f.categories.join(',')}]`); if (f.data) parts.push(`dat=${f.data}`); if (f.type) parts.push(`typ=${f.type}`); if (f.package) parts.push(`pkg=${f.package}`);
    if (component !== null) { const c = r.object(component), short = c.className.startsWith(c.packageName + '.') ? c.className.slice(c.packageName.length) : c.className; parts.push(`cmp=${c.packageName}/${short}`); }
    return `Intent { ${parts.join(' ')} }`;
  };
  const componentOf = (r, packageName, className) => { const c = r.allocate(COMPONENT); call(r, COMPONENT, '<init>', [STRING, STRING], 'V', [c, packageName, className], 'direct'); return c; };
  const serviceKey = (entry, className) => entry.main ? className : `${entry.name}/${className}`;
  const resolvePackageService = (r, caller, target, intent, component, verb) => {
    const P = pkgs(); let detail;
    if (component !== null) { const className = r.stringCharacters(call(r, COMPONENT, 'getClassName', [], STRING, [component])); detail = P.detailsOf(target, 'service').find(d => d.name === className); }
    else { const action = intentCall(r, intent, 'getAction', STRING); detail = action === null ? undefined : P.detailsOf(target, 'service').find(d => d.actions?.includes(r.stringCharacters(action))); }
    if (!detail || isFalse(detail.enabled)) { r.record(`SERVICE ${verb} ${target.name}: no service matches ${intentText(r, intent)}`); return null; }
    if (caller !== target) {
      const denied = !P.exported(target, detail) ? `not exported from uid ${target.uid}` : detail.permission && !P.holds(r, caller, detail.permission) ? detail.permission : null;
      if (denied !== null) {
        r.record(`LOG W ActivityManager: Permission Denial: Accessing service ${target.name}/${detail.name} from pid=${caller.pid}, uid=${caller.uid} ${denied === detail.permission ? 'requires ' + denied : 'that is ' + denied}`);
        r.throwJava('Ljava/lang/SecurityException;', verb === 'bind' ? `Not allowed to bind to service ${intentText(r, intent)}` : denied === detail.permission ? `Not allowed to ${verb} service ${intentText(r, intent)} without permission ${denied}` : `Unable to ${verb} service ${intentText(r, intent)}: ${denied}`);
      }
    }
    return { entry: target, className: detail.name, key: serviceKey(target, detail.name) };
  };
  const createPackageService = (r, target) => {
    const P = pkgs(); P.ensureProcess(r, target.entry);
    if (target.entry.main) return createService(r, target.className, `L${target.className.replaceAll('.', '/')};`);
    const descriptor = P.typeIn(r, target.entry, target.className);
    if (!descriptor) throw new APKError(`Unable to instantiate service ${target.entry.name}/${target.className}: the class is not in the package`, { kind: 'package-service-class' });
    const ref = r.allocate(descriptor); call(r, descriptor, '<init>', [], 'V', [ref], 'direct');
    const o = r.object(ref); o.serviceApplication = P.application(target.entry);
    // ActivityThread.handleCreateService: Service.attach -> attachBaseContext(context) before onCreate. A service that overrides it sees it (microG's ServiceProxy loads the actual service there).
    call(r, 'Landroid/content/ContextWrapper;', 'attachBaseContext', ['Landroid/content/Context;'], 'V', [ref, P.newContext(r, target.entry)], 'virtual');
    r.record(`SERVICE create ${target.key} (uid ${target.entry.uid})`);
    call(r, descriptor, 'onCreate', [], 'V', [ref]);
    const service = { ref, binder: null, bound: false, started: false, startId: 0, intent: null, component: null, connections: new Set(), since: platform.clock.now() };
    boundServices.set(target.key, service); return service;
  };
  const bindPackageService = (r, caller, target, intent, component, connection, flags) => {
    const resolved = resolvePackageService(r, caller, target, intent, component, 'bind'); if (!resolved) return 0;
    pkgs().grant(target, caller);   // AppsFilter.grantImplicitAccess: the service's package can see its client from now on
    const name = componentOf(r, target.name, resolved.className), key = resolved.key;
    packageConnections.set(connection.ref, { key, caller });
    if (!boundServices.has(key) && !(flags & 1)) { r.record(`SERVICE bind ${key}: not running and no BIND_AUTO_CREATE`); return 1; }
    r.record(`SERVICE bind ${key} from ${caller.name} (uid ${caller.uid})`);
    platform.queueTask(() => {
      if (packageConnections.get(connection.ref)?.key !== key) return;   // unbound before the service's process got to it
      const service = boundServices.get(key) ?? createPackageService(r, resolved);
      if (!service.bound) { service.bound = true; service.intent = intent; service.component = name; service.binder = call(r, r.typeOf(service.ref), 'onBind', [INTENT], 'Landroid/os/IBinder;', [service.ref, intent]); }
      service.connections.add(connection.ref);
      if (service.binder === null) call(r, SERVICE_CONNECTION, 'onNullBinding', [COMPONENT], 'V', [connection, name]);
      else call(r, SERVICE_CONNECTION, 'onServiceConnected', [COMPONENT, 'Landroid/os/IBinder;'], 'V', [connection, name, service.binder]);
    }, 0, [connection, intent, name]);
    return 1;
  };
  const unbindPackageService = (r, connection) => {
    const binding = packageConnections.get(connection.ref); packageConnections.delete(connection.ref);
    const service = boundServices.get(binding.key); if (!service) return;
    service.connections.delete(connection.ref);
    if (!service.connections.size && service.bound) platform.queueTask(() => {
      if (service.connections.size || !service.bound || boundServices.get(binding.key) !== service) return;
      const descriptor = r.typeOf(service.ref); service.bound = false;
      call(r, descriptor, 'onUnbind', [INTENT], 'Z', [service.ref, service.intent]);
      if (!service.started) { boundServices.delete(binding.key); call(r, descriptor, 'onDestroy', [], 'V', [service.ref]); r.record(`SERVICE unbind+destroy ${binding.key}`); }
    }, 0, [service.ref]);
  };
  /**
   * bindService made by system_server (ActiveServices for a system caller: AccountManagerService binding an account authenticator, src/account-sessions.js): the service `className` of
   * package `entry` (the app or a companion), exported or not, created on demand in that package's process; `connected(binder)` runs on the main thread once onBind returned
   * (onServiceConnected). Returns the unbind function, or null when the package declares no such (enabled) service.
   */
  let systemConnections = 0;
  platform.bindServiceAsSystem = (r, entry, className, intent, connected) => {
    const P = pkgs(); let key, create;
    if (entry.main) {
      const descriptor = `L${className.replaceAll('.', '/')};`;
      if (!(platform.manifest?.services ?? []).includes(className) || !r.classes.has(descriptor)) return null;
      key = className; create = () => { const created = createService(r, className, descriptor); r.record(`SERVICE create+bind ${className}`); return created; };
    } else {
      const detail = P.detailsOf(entry, 'service').find(d => d.name === className); if (!detail || isFalse(detail.enabled)) return null;
      const resolved = { entry, className, key: serviceKey(entry, className) }; key = resolved.key; create = () => createPackageService(r, resolved);
    }
    const token = `system:${++systemConnections}`, component = componentOf(r, entry.name, className); let unbound = false;
    r.record(`SERVICE bind ${key} from android (uid 1000)`);
    platform.queueTask(() => {
      if (unbound) return;
      const service = boundServices.get(key) ?? create();
      if (!service.bound) { service.bound = true; service.intent = intent; service.component = component; service.binder = call(r, r.typeOf(service.ref), 'onBind', [INTENT], 'Landroid/os/IBinder;', [service.ref, intent]); }
      service.connections.add(token);
      connected(service.binder);
    }, 0, [intent, component]);
    return () => {
      if (unbound) return; unbound = true;
      const service = boundServices.get(key); if (!service) return;
      service.connections.delete(token);
      if (!service.connections.size && service.bound) platform.queueTask(() => {
        if (service.connections.size || !service.bound || boundServices.get(key) !== service) return;
        const descriptor = r.typeOf(service.ref); service.bound = false;
        call(r, descriptor, 'onUnbind', [INTENT], 'Z', [service.ref, service.intent]);
        if (!service.started) { boundServices.delete(key); call(r, descriptor, 'onDestroy', [], 'V', [service.ref]); r.record(`SERVICE unbind+destroy ${key}`); }
      }, 0, [service.ref]);
    };
  };
  const startPackageService = (r, caller, target, intent, component) => {
    const resolved = resolvePackageService(r, caller, target, intent, component, 'start'); if (!resolved) return null;
    pkgs().grant(target, caller);
    const name = componentOf(r, target.name, resolved.className);
    platform.queueTask(() => {
      const service = boundServices.get(resolved.key) ?? createPackageService(r, resolved);
      service.started = true; const startId = ++service.startId; r.record(`SERVICE start ${resolved.key} #${startId}`);
      call(r, r.typeOf(service.ref), 'onStartCommand', [INTENT, 'I', 'I'], 'I', [service.ref, intent, 0, startId]);
    }, 0, [intent]);
    return name;
  };
  /** The caller and target packages of a Context service call when a companion package is involved; null for the app's own services (the original single-package path). */
  const crossTarget = (r, self, targetPackage) => {
    const P = pkgs(); if (!P?.multi) return null;
    const caller = P.contextEntry(r, self);
    if (caller.main && targetPackage === caller.name) return null;
    const target = P.byName(targetPackage);
    return { caller, target: target && P.visible(r, caller, target) ? target : null };
  };
  const createService = (r, className, descriptor) => {
    const ref = r.allocate(descriptor); call(r, descriptor, '<init>', [], 'V', [ref], 'direct'); r.object(ref).baseContext = platform.application;
    call(r, descriptor, 'onCreate', [], 'V', [ref]);
    const service = { ref, binder: null, bound: false, started: false, startId: 0, intent: null, component: null, connections: new Set(), since: platform.clock.now() };
    boundServices.set(className, service); return service;
  };
  // Context.startService / startForegroundService / stopService and Service.stopSelf (ActiveServices): the Service is created once, onStartCommand follows on the main thread for every start with a growing
  // startId, and it is destroyed by stopService/stopSelf once no connection keeps it bound. Background-start limits do not apply: the lab's app is always in the foreground.
  const explicitTarget = (r, intent) => {
    const component = intentCall(r, intent, 'getComponent', 'Landroid/content/ComponentName;'), explicitPackage = intentCall(r, intent, 'getPackage', STRING);
    const targetPackage = component !== null ? r.stringCharacters(call(r, COMPONENT, 'getPackageName', [], STRING, [component])) : explicitPackage === null ? null : r.stringCharacters(explicitPackage);
    if (targetPackage === null) r.throwJava('Ljava/lang/IllegalArgumentException;', `Service Intent must be explicit: ${r.stringCharacters(call(r, 'Ljava/lang/Object;', 'toString', [], STRING, [intent]))}`);
    return targetPackage;
  };
  /**
   * An Intent with this app's package and an action, no component (ActiveServices.retrieveServiceLocked -> PackageManager.resolveService): the app's own enabled service whose
   * intent-filter names the action, as { component, className, descriptor }, or null when none does (Android's "Unable to start service ...: not found").
   */
  const ownServiceByAction = (r, intent) => {
    const action = intentCall(r, intent, 'getAction', STRING); if (action === null) return null;
    const name = r.stringCharacters(action), detail = (platform.manifest?.componentDetails ?? []).find(d => d.kind === 'service' && !isFalse(d.enabled) && d.actions?.includes(name));
    if (!detail) return null;
    const className = detail.name, descriptor = `L${className.replaceAll('.', '/')};`;
    if (!(platform.manifest?.services ?? []).includes(className) || !r.classes.has(descriptor)) return null;
    const component = r.allocate(COMPONENT); call(r, COMPONENT, '<init>', [STRING, STRING], 'V', [component, pkg(), className], 'direct');
    return { component, className, descriptor };
  };
  const serviceTarget = (r, intent, verb) => {
    const component = intentCall(r, intent, 'getComponent', 'Landroid/content/ComponentName;'), explicitPackage = intentCall(r, intent, 'getPackage', STRING);
    const targetPackage = component !== null ? r.stringCharacters(call(r, COMPONENT, 'getPackageName', [], STRING, [component])) : explicitPackage === null ? null : r.stringCharacters(explicitPackage);
    if (targetPackage === null) r.throwJava('Ljava/lang/IllegalArgumentException;', `Service Intent must be explicit: ${r.stringCharacters(call(r, 'Ljava/lang/Object;', 'toString', [], STRING, [intent]))}`);
    if (targetPackage !== pkg()) { r.record(`SERVICE ${verb} ${targetPackage}: package not installed`); return null; }
    if (component === null) { const own = ownServiceByAction(r, intent); if (!own) { r.record(`LOG W ActivityManager: Unable to ${verb} service ${intentText(r, intent)} U=0: not found`); return null; } return own; }
    const className = r.stringCharacters(call(r, COMPONENT, 'getClassName', [], STRING, [component])), descriptor = `L${className.replaceAll('.', '/')};`;
    if (!(platform.manifest?.services ?? []).includes(className) || !r.classes.has(descriptor)) { r.record(`SERVICE ${verb} ${className}: not declared`); return null; }
    return { component, className, descriptor };
  };
  const startService = (r, intent, self = null) => {
    const cross = self === null ? null : crossTarget(r, self, explicitTarget(r, intent));
    if (cross) { if (!cross.target) { r.record(`SERVICE start ${explicitTarget(r, intent)}: package not installed`); return null; } return startPackageService(r, cross.caller, cross.target, intent, intentCall(r, intent, 'getComponent', COMPONENT)); }
    const target = serviceTarget(r, intent, 'start'); if (!target) return null;
    const service = boundServices.get(target.className) ?? createService(r, target.className, target.descriptor);
    service.started = true; const startId = ++service.startId; r.record(`SERVICE start ${target.className} #${startId}`);
    platform.queueTask(() => { if (boundServices.get(target.className) === service && service.started) call(r, target.descriptor, 'onStartCommand', [INTENT, 'I', 'I'], 'I', [service.ref, intent, 0, startId]); }, 0, [service.ref, intent]);
    return target.component;
  };
  const stopServiceNamed = (r, className) => {
    const service = boundServices.get(className); if (!service?.started) return 0;
    service.started = false; r.record(`SERVICE stop ${className}`);
    if (!service.connections.size) { boundServices.delete(className); call(r, r.typeOf(service.ref), 'onDestroy', [], 'V', [service.ref]); }
    return 1;
  };
  const classNameOf = ref => { for (const [name, service] of boundServices) if (service.ref.ref === ref.ref) return name; return null; };
  platform.serviceControl = { stopSelf: (r, self, startId = null) => { const name = classNameOf(self); if (name === null) return 0; const service = boundServices.get(name); if (startId !== null && startId !== service.startId) return 0; return stopServiceNamed(r, name); } };
  defContext('startService', `(${INTENT})Landroid/content/ComponentName;`, (r, _m, [self, intent]) => startService(r, intent, self));
  defContext('startForegroundService', `(${INTENT})Landroid/content/ComponentName;`, (r, _m, [self, intent]) => startService(r, intent, self));
  defContext('stopService', `(${INTENT})Z`, (r, _m, [self, intent]) => {
    const cross = pkgs()?.multi ? crossTarget(r, self, explicitTarget(r, intent)) : null;
    if (cross) { if (!cross.target) return 0; const resolved = resolvePackageService(r, cross.caller, cross.target, intent, intentCall(r, intent, 'getComponent', COMPONENT), 'stop'); return resolved ? stopServiceNamed(r, resolved.key) : 0; }
    const target = serviceTarget(r, intent, 'stop'); return target ? stopServiceNamed(r, target.className) : 0;
  });   // className -> { ref, binder, intent, component, connections:Set<ref> }; connection ref -> className
  const call = (r, owner, name, parameters, result, args, mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, mode);
  const intentCall = (r, intent, name, result) => r.dispatch({ owner: INTENT, name, parameters: [], result, signature: `()${result}` }, [intent], 'virtual');
  defContext('bindService', `(${INTENT}Landroid/content/ServiceConnection;I)Z`, (r, _m, [self, intent, connection, flags]) => {
    if (connection === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'connection is null');
    const componentIn = intentCall(r, intent, 'getComponent', 'Landroid/content/ComponentName;'), explicitPackage = intentCall(r, intent, 'getPackage', STRING);
    const targetPackage = componentIn !== null ? r.stringCharacters(r.dispatch({ owner: 'Landroid/content/ComponentName;', name: 'getPackageName', parameters: [], result: STRING, signature: `()${STRING}` }, [componentIn], 'virtual')) : explicitPackage === null ? null : r.stringCharacters(explicitPackage);
    if (targetPackage === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Service Intent must be explicit');
    const cross = crossTarget(r, self, targetPackage);
    if (cross) { if (!cross.target) { r.record(`SERVICE bind ${targetPackage}: package not installed`); return 0; } return bindPackageService(r, cross.caller, cross.target, intent, componentIn, connection, flags); }
    if (targetPackage !== pkg()) { r.record(`SERVICE bind ${targetPackage}: package not installed`); return 0; }
    let component = componentIn;
    if (component === null) { const own = ownServiceByAction(r, intent); if (!own) { r.record(`LOG W ActivityManager: Unable to bind service ${intentText(r, intent)} U=0: not found`); return 0; } component = own.component; }
    const className = r.stringCharacters(call(r, COMPONENT, 'getClassName', [], STRING, [component])), descriptor = `L${className.replaceAll('.', '/')};`;
    if (!(platform.manifest?.services ?? []).includes(className) || !r.classes.has(descriptor)) { r.record(`SERVICE bind ${className}: not declared`); return 0; }
    let service = boundServices.get(className);
    if (!service) {
      if (!(flags & 1)) { r.record(`SERVICE bind ${className}: not running and no BIND_AUTO_CREATE`); return 1; }
      service = createService(r, className, descriptor); r.record(`SERVICE create+bind ${className}`);
    }
    if (!service.bound) { service.bound = true; service.intent = intent; service.component = component; service.binder = call(r, descriptor, 'onBind', [INTENT], 'Landroid/os/IBinder;', [service.ref, intent]); }   // onBind runs once, for the first connection
    service.connections.add(connection.ref); boundConnections.set(connection.ref, className);
    platform.queueTask(() => {
      if (!service.connections.has(connection.ref)) return;
      if (service.binder === null) call(r, SERVICE_CONNECTION, 'onNullBinding', [COMPONENT], 'V', [connection, service.component]);
      else call(r, SERVICE_CONNECTION, 'onServiceConnected', [COMPONENT, 'Landroid/os/IBinder;'], 'V', [connection, service.component, service.binder]);
    }, 0, [connection, service.component, service.binder]);
    return 1;
  });
  defContext('unbindService', '(Landroid/content/ServiceConnection;)V', (r, _m, [, connection]) => {
    if (packageConnections.has(connection?.ref)) return unbindPackageService(r, connection);
    const className = boundConnections.get(connection?.ref);
    if (className === undefined) r.throwJava('Ljava/lang/IllegalArgumentException;', `Service not registered: ${r.typeOf(connection).slice(1, -1).replaceAll('/', '.')}`);
    boundConnections.delete(connection.ref); const service = boundServices.get(className); service.connections.delete(connection.ref);
    if (!service.connections.size) {
      const descriptor = r.typeOf(service.ref); service.bound = false;
      call(r, descriptor, 'onUnbind', [INTENT], 'Z', [service.ref, service.intent]);
      if (!service.started) { boundServices.delete(className); call(r, descriptor, 'onDestroy', [], 'V', [service.ref]); r.record(`SERVICE unbind+destroy ${className}`); }
    }
  });
  // Context.getAttributionTag() (API 30): null unless the Context came from createAttributionContext, which the lab does not create.
  // the tag of createAttributionContext(tag) along the Context chain; a plain Context has none
  defContext('getAttributionTag', `()${STRING}`, (r, _m, [self]) => { for (let c = self, depth = 0; c && typeof c === 'object' && depth < 64; depth++) { const o = r.object(c); if (o.attributionTag !== undefined) return o.attributionTag; c = o.outerContext ?? o.baseContext ?? null; } return null; });
  // Activity.getTaskId(): the id of the task (platform.tasks, see activity-starter.js) the Activity lives in; the app's first task is 1.
  def('Landroid/app/Activity;', 'getTaskId', '()I', (r, _m, [self]) => platform.taskOf(platform.frame(r, self))?.id ?? -1);
  defContext('checkSelfPermission', `(${STRING})I`, (r, _m, [, permission]) => check(r, permission));
  defContext('checkPermission', `(${STRING}II)I`, (r, _m, [, permission, pid, uid]) => checkUid(r, permission, pid, uid));   // the app's process, or an installed companion package's (src/package-registry.js)
  // checkCallingPermission: inside a Binder transaction from another installed package, that package's permissions; otherwise the calling pid is this process, which ContextImpl refuses
  const callingCheck = (r, permission) => { const name = needPermission(r, permission), caller = callingEntry(r); return caller && holdsFor(r, caller, name) ? PERMISSION_GRANTED : PERMISSION_DENIED; };
  defContext('checkCallingPermission', `(${STRING})I`, (r, _m, [, permission]) => callingCheck(r, permission));
  defContext('checkCallingOrSelfPermission', `(${STRING})I`, (r, _m, [, permission]) => callingEntry(r) ? callingCheck(r, permission) : check(r, permission));
  defContext('enforcePermission', `(${STRING}IILjava/lang/String;)V`, (r, _m, [self, permission, pid, uid, message]) => enforce(r, permission, checkUid(r, permission, pid, uid), false, message, uid));
  defContext('enforceCallingPermission', `(${STRING}${STRING})V`, (r, _m, [, permission, message]) => enforce(r, permission, callingCheck(r, permission), false, message, callingEntry(r)?.uid));
  defContext('enforceCallingOrSelfPermission', `(${STRING}${STRING})V`, (r, _m, [, permission, message]) => enforce(r, permission, callingEntry(r) ? callingCheck(r, permission) : check(r, permission), true, message, callingEntry(r)?.uid));

  // ---- Context directories and files (ContextImpl.getDataDir/getFilesDir/..., ensurePrivateDirExists) -------------------------------------------
  const ensure = (r, path) => { const result = fs().mkdirs(path); if (result !== 'ok' && result !== 'EEXIST') r.record(`LOG W ContextImpl: Failed to ensure ${path}: ${result}`); return file(r, path); };
  const external = () => `/storage/emulated/0/Android/data/${pkg()}`;
  defContext('getDataDir', `()${FILE}`, r => ensure(r, dataDir()));
  defContext('getFilesDir', `()${FILE}`, r => ensure(r, `${dataDir()}/files`));
  defContext('getCacheDir', `()${FILE}`, r => ensure(r, `${dataDir()}/cache`));
  defContext('getCodeCacheDir', `()${FILE}`, r => ensure(r, `${dataDir()}/code_cache`));
  defContext('getNoBackupFilesDir', `()${FILE}`, r => ensure(r, `${dataDir()}/no_backup`));
  defContext('getDir', `(${STRING}I)${FILE}`, (r, _m, [, name]) => ensure(r, `${dataDir()}/app_${text(r, name)}`));
  // ContextImpl.getDatabasePath: an absolute name is the file itself, and its directory is made when it is missing (File.mkdir: one level, so a missing parent of it leaves
  // the open to fail); a relative name is a file of the databases directory and may not contain a separator (makeFilename: IllegalArgumentException). openOrCreateDatabase,
  // deleteDatabase and SQLiteOpenHelper (through getDatabasePath) see the same path.
  const databasePath = (r, name) => {
    const n = text(r, name);
    if (n.startsWith('/')) { const dir = n.slice(0, n.lastIndexOf('/')); if (dir && fs().stat(dir)?.type !== 'dir') fs().mkdir(dir); return n; }
    if (n.includes('/')) r.throwJava('Ljava/lang/IllegalArgumentException;', `File ${n} contains a path separator`);
    ensure(r, `${dataDir()}/databases`); return `${dataDir()}/databases/${n}`;
  };
  defContext('getDatabasePath', `(${STRING})${FILE}`, (r, _m, [, name]) => file(r, databasePath(r, name)));
  // ContextImpl.openOrCreateDatabase/deleteDatabase/databaseList over the original android.database.sqlite classes (src/sqlite-native.js natives).
  const SQLITE_DB = 'Landroid/database/sqlite/SQLiteDatabase;', CURSOR_FACTORY = 'Landroid/database/sqlite/SQLiteDatabase$CursorFactory;', ERROR_HANDLER = 'Landroid/database/DatabaseErrorHandler;';
  const MODE_ENABLE_WRITE_AHEAD_LOGGING = 0x8, MODE_NO_LOCALIZED_COLLATORS = 0x10, CREATE_IF_NECESSARY = 0x10000000, ENABLE_WRITE_AHEAD_LOGGING = 0x20000000, NO_LOCALIZED_COLLATORS = 0x10;
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
  // The device has one shared-storage volume, so each *Dirs variant is the one-element array of the primary-volume directory (ContextImpl.getExternalFilesDirs / getExternalCacheDirs / getObbDirs / getExternalMediaDirs).
  const fileArray = (r, files) => { const array = r.newArray(`[${FILE}`, files.length); r.array(array).elements = files; return array; };
  defContext('getExternalFilesDirs', `(${STRING})[${FILE}`, (r, _m, [, sub]) => fileArray(r, [ensure(r, `${external()}/files${sub === null ? '' : '/' + r.stringCharacters(sub)}`)]));
  defContext('getExternalCacheDirs', `()[${FILE}`, r => fileArray(r, [ensure(r, `${external()}/cache`)]));
  defContext('getObbDirs', `()[${FILE}`, r => fileArray(r, [ensure(r, `/storage/emulated/0/Android/obb/${pkg()}`)]));
  defContext('getExternalMediaDirs', `()[${FILE}`, r => fileArray(r, [ensure(r, `/storage/emulated/0/Android/media/${pkg()}`)]));
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
  // The hidden ContextImpl.getSharedPreferences(File, int) (reached by reflection): the preferences stored in that file, one instance per path (sSharedPrefsCache), the same
  // mode checks. A file that does not exist is an empty map; a file on a read-only partition (/system/etc/...) can be read, and a commit to it fails as a write there does.
  defContext('getSharedPreferences', `(${FILE}I)${SP}`, (r, _m, [, target, mode]) => {
    if (target === null) r.throwJava('Ljava/lang/NullPointerException;', 'file');
    if (mode & 3 && Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 28) >= 24) r.throwJava('Ljava/lang/SecurityException;', (mode & 1) ? 'MODE_WORLD_READABLE no longer supported' : 'MODE_WORLD_WRITEABLE no longer supported');
    const path = text(r, call(r, FILE, 'getAbsolutePath', [], STRING, [target]));
    if (!instances.has(path)) { const ref = r.allocate(SP_IMPL); r.object(ref).prefs = { path, map: loadMap(r, path), listeners: [], generation: 0, writes: 0 }; instances.set(path, ref); }
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
    if (writeNeeded(r, mcr)) { ok = writeFile(r, mcr.st.path, mcr.snapshot); if (ok) { mcr.st.diskGeneration = mcr.generation; platform.appData?.syncPoint('prefs-commit'); } }   // commit(): on disk (and in the app-data store) before it returns
    notifyListeners(r, mcr, editor.prefs); return ok ? 1 : 0;
  });
  def(EDITOR_IMPL, 'apply', '()V', (r, _m, [self]) => {
    const editor = ed(r, self), mcr = commitToMemory(r, editor);
    // Memory and listeners are updated now; the file is written by a later task, in order (enqueueDiskWrite on the single-threaded writer).
    if (writeNeeded(r, mcr)) {
      // QueuedWork: the same write is also reachable from appData.finishQueuedWork() (Activity onStop waits for pending apply() writes); whichever runs first does it.
      const write = () => { if (!queued.delete(write)) return; if (writeFile(r, mcr.st.path, mcr.snapshot)) { mcr.st.diskGeneration = Math.max(mcr.st.diskGeneration ?? 0, mcr.generation); platform.appData?.touch(); } };
      const queued = platform.appData?.queuedWork ?? new Set(); queued.add(write);
      platform.queueTask(write, 0, []);
    }
    notifyListeners(r, mcr, editor.prefs);
  });

  // ---- ProviderInfo / ContentProvider -----------------------------------------------------------------------------------------------------------
  registerPackageValueFields(registry);
  type(ITEM_INFO, OBJECT, [], { allocatable: true }); type(COMPONENT_INFO, ITEM_INFO, [], { allocatable: true }); type(PROVIDER_INFO, COMPONENT_INFO, [], { allocatable: true });
  for (const [owner, name, ftype] of [[ITEM_INFO, 'name', STRING], [ITEM_INFO, 'packageName', STRING], [ITEM_INFO, 'metaData', BUNDLE], [COMPONENT_INFO, 'applicationInfo', APPLICATION_INFO], [COMPONENT_INFO, 'processName', STRING],
    [COMPONENT_INFO, 'enabled', 'Z'], [COMPONENT_INFO, 'exported', 'Z'], [COMPONENT_INFO, 'directBootAware', 'Z'], [PROVIDER_INFO, 'authority', STRING], [PROVIDER_INFO, 'readPermission', STRING], [PROVIDER_INFO, 'writePermission', STRING],
    [PROVIDER_INFO, 'grantUriPermissions', 'Z'], [PROVIDER_INFO, 'multiprocess', 'Z'], [PROVIDER_INFO, 'initOrder', 'I'], [PROVIDER_INFO, 'flags', 'I']]) registry.instanceField(owner, name, ftype, { reflect: true });
  const dispatchBundle = (r, bundle, name, parameters, args) => r.dispatch({ owner: BUNDLE, name, parameters, result: 'V', signature: `(${parameters.join('')})V` }, [bundle, ...args], 'virtual');
  function metaDataBundle(r, entries, resolveResource = id => { const bag = platform.resources?.resolve?.(id); return bag?.kind === 'bag' ? bag : platform.resource(id); }) {   // a bag comes back as such (see below)   // resolveResource: a companion package resolves android:value="@type/name" in its own table
    if (!entries?.length) return null;
    const bundle = platform.bundle(r);
    for (const { name, value, valueType, resource } of entries) {
      if (resource !== undefined) { dispatchBundle(r, bundle, 'putInt', [STRING, 'I'], [name, resource | 0]); continue; }
      if (valueType === 3) dispatchBundle(r, bundle, 'putString', [STRING, STRING], [name, value]);
      else if (valueType === 1) {   // android:value="@type/name": PackageParser reads the final typed value (TypedArray.peekValue resolves the reference), then stores it by its type
        // A reference to a bag (an array, a style, plurals) does not resolve to a value: peekValue keeps TYPE_REFERENCE, which none of the branches takes.
        const resolved = resolveResource(value), data = resolved.rawData ?? resolved.data, type = resolved.kind === 'bag' ? 1 : resolved.dataType;
        if (type === 3) dispatchBundle(r, bundle, 'putString', [STRING, STRING], [name, resolved.value]);          // TYPE_STRING
        else if (type === 0x12) dispatchBundle(r, bundle, 'putBoolean', [STRING, 'Z'], [name, (data | 0) !== 0 ? 1 : 0]);                              // TYPE_INT_BOOLEAN
        else if (type === 4) dispatchBundle(r, bundle, 'putFloat', [STRING, 'F'], [name, bitsFloat(data | 0)]);                                                   // TYPE_FLOAT
        else if (type >= 0x10 && type <= 0x1f) dispatchBundle(r, bundle, 'putInt', [STRING, 'I'], [name, data | 0]);                                   // TYPE_FIRST_INT..TYPE_LAST_INT: integers, hex, colors
        // ParsingPackageUtils.parseMetaData (RIGID_PARSER is false): any other type is logged and the entry is left out of the Bundle
        else r.record(`LOG W PackageParsing: <meta-data> only supports string, integer, float, color, boolean, and resource reference types: ${name} (resource 0x${(Number(value) >>> 0).toString(16)}, ${resolved.kind === 'bag' ? 'a bag' : 'type ' + type}): not in the Bundle`);
      } else if (valueType === 0x12) dispatchBundle(r, bundle, 'putBoolean', [STRING, 'Z'], [name, isTrue(value) ? 1 : 0]);
      else if (valueType === 4) dispatchBundle(r, bundle, 'putFloat', [STRING, 'F'], [name, bitsFloat(value | 0)]);
      else dispatchBundle(r, bundle, 'putInt', [STRING, 'I'], [name, value | 0]);
    }
    return bundle;
  }
  // The app's process: android:process on <application> (":name" is private to the package, as in PackageParser), else the package name.
  const processName = () => { const process = platform.manifest?.application?.process; return process ? (process.startsWith(':') ? appPkg() + process : process) : appPkg(); };
  /** `owner`: the package that declares the component (src/package-registry.js entry); the app when null. */
  const companionOf = owner => owner && !owner.main ? owner : null;
  function makeProviderInfo(r, detail, withMeta, owner = null) {
    const info = r.allocate(PROVIDER_INFO), put = (owner, name, ftype, value) => r.storeField(r.object(info).fields, `${owner}->${name}:${ftype}`, value), other = companionOf(owner);
    put(ITEM_INFO, 'name', STRING, detail.name); put(ITEM_INFO, 'packageName', STRING, other ? other.name : appPkg()); put(ITEM_INFO, 'metaData', BUNDLE, withMeta ? (other ? pkgs().metaData(r, other, detail.metaData ?? []) : metaDataBundle(r, detail.metaData)) : null);
    put(COMPONENT_INFO, 'applicationInfo', APPLICATION_INFO, other ? pkgs().applicationInfoFor(r, other) : platform.applicationInfo(r)); put(COMPONENT_INFO, 'processName', STRING, other ? pkgs().processOf(other, detail) : providerProcess(detail));
    put(COMPONENT_INFO, 'enabled', 'Z', isFalse(detail.enabled) ? 0 : 1); put(COMPONENT_INFO, 'exported', 'Z', isTrue(detail.exported) ? 1 : 0); put(COMPONENT_INFO, 'directBootAware', 'Z', isTrue(detail.directBootAware) ? 1 : 0);
    put(PROVIDER_INFO, 'authority', STRING, detail.authorities); put(PROVIDER_INFO, 'readPermission', STRING, detail.readPermission ?? detail.permission); put(PROVIDER_INFO, 'writePermission', STRING, detail.writePermission ?? detail.permission);   // android:readPermission / writePermission, else android:permission (PackageParser)
    put(PROVIDER_INFO, 'grantUriPermissions', 'Z', isTrue(detail.grantUriPermissions) ? 1 : 0); put(PROVIDER_INFO, 'multiprocess', 'Z', isTrue(detail.multiprocess) ? 1 : 0); put(PROVIDER_INFO, 'initOrder', 'I', Number(detail.initOrder) | 0); put(PROVIDER_INFO, 'flags', 'I', 0);
    return info;
  }
  const providerProcess = detail => detail.process ? (detail.process.startsWith(':') ? appPkg() + detail.process : detail.process) : processName();

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
  def(CP, 'getCallingPackage', `()${STRING}`, r => pkgs()?.multi ? pkgs().callingPackage(r) : null); // the package of the cross-package call being served; outside one there is no caller
  def(CP, 'getCallingPackageUnchecked', `()${STRING}`, r => pkgs()?.multi ? pkgs().callingPackage(r) : null);
  // getCallingAttributionSource: the AttributionSource of the call being served (ContentProvider.mCallingAttributionSource: the caller's uid and package), null outside one.
  // The lab's cross-package calls carry no attribution tag, so the source has none and getCallingAttributionTag is null.
  const ATTRIBUTION = 'Landroid/content/AttributionSource;';
  const callingSource = r => {
    const P = pkgs(), name = P?.multi ? P.callingPackage(r) : null; if (!name) return null;
    const source = r.allocate(ATTRIBUTION);
    r.dispatch({ owner: ATTRIBUTION, name: '<init>', parameters: ['I', STRING, STRING, 'Ljava/util/Set;', ATTRIBUTION], result: 'V', signature: `(I${STRING}${STRING}Ljava/util/Set;${ATTRIBUTION})V` }, [source, P.callingIdentity(r).uid, name, null, null, null], 'direct');
    return source;
  };
  def(CP, 'getCallingAttributionSource', `()${ATTRIBUTION}`, r => callingSource(r));
  def(CP, 'getCallingAttributionTag', `()${STRING}`, () => null);
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

  // NotificationManager: the virtual device has no status bar. Channels the app creates are kept (and returned by getNotificationChannel[s]);
  // posted notifications are counted and traced, never shown. areNotificationsEnabled follows Android 13's rule: apps targeting 33+ need
  // POST_NOTIFICATIONS declared (the lab grants declared runtime permissions); older targets are enabled by default.
  const NOTIFICATION_MANAGER = service('notification', 'Landroid/app/NotificationManager;'), CHANNEL = 'Landroid/app/NotificationChannel;';
  const notificationState = { delegate: null, channels: gcRoot(new Map()), posted: gcRoot(new Map()), records: gcRoot(new Map()) };
  const channelId = (r, channel) => { try { return r.stringCharacters(r.dispatch({ owner: CHANNEL, name: 'getId', parameters: [], result: STRING, signature: `()${STRING}` }, [channel], 'virtual')); } catch { return null; } };
  def(NOTIFICATION_MANAGER, 'setNotificationDelegate', `(${STRING})V`, (r, _m, [, delegate]) => { notificationState.delegate = delegate === null ? null : r.stringCharacters(delegate); });
  def(NOTIFICATION_MANAGER, 'getNotificationDelegate', `()${STRING}`, () => notificationState.delegate);
  def(NOTIFICATION_MANAGER, 'canNotifyAsPackage', `(${STRING})Z`, () => 0);
  def(NOTIFICATION_MANAGER, 'areNotificationsEnabled', '()Z', () => {
    const target = Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1), declared = (platform.manifest?.usesPermissions ?? []).some(p => p.name === 'android.permission.POST_NOTIFICATIONS');
    return target < 33 || declared ? 1 : 0;
  });
  def(NOTIFICATION_MANAGER, 'getImportance', '()I', () => 3);   // IMPORTANCE_DEFAULT
  // NotificationManager channels and channel groups (NotificationManagerService / PreferencesHelper, android-13.0.0_r1): a channel may only name a group that exists; creating a channel
  // that already exists updates its name and description (and its group when it has none), and lowers its importance; deleting a group deletes its channels.
  const GROUP = 'Landroid/app/NotificationChannelGroup;', LIST_T = 'Ljava/util/List;';
  notificationState.groups = gcRoot(new Map());
  const vc = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const channelGroupId = (r, channel) => { const g = vc(r, channel, CHANNEL, 'getGroup', [], STRING); return g === null ? null : r.stringCharacters(g); };
  const groupId = (r, group) => { const id = vc(r, group, GROUP, 'getId', [], STRING); return id === null ? null : r.stringCharacters(id); };
  const createChannel = (r, channel) => {
    if (channel === null || channel === 0 || channel === undefined) r.throwJava('Ljava/lang/NullPointerException;', null);
    const id = channelId(r, channel), group = channelGroupId(r, channel);
    if (group !== null && !notificationState.groups.has(group)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'NotificationChannelGroup doesn\'t exist');
    const existing = notificationState.channels.get(id);
    if (existing === undefined) { notificationState.channels.set(id, channel); return; }
    vc(r, existing, CHANNEL, 'setName', ['Ljava/lang/CharSequence;'], 'V', [vc(r, channel, CHANNEL, 'getName', [], 'Ljava/lang/CharSequence;')]);
    vc(r, existing, CHANNEL, 'setDescription', [STRING], 'V', [vc(r, channel, CHANNEL, 'getDescription', [], STRING)]);
    if (channelGroupId(r, existing) === null && group !== null) vc(r, existing, CHANNEL, 'setGroup', [STRING], 'V', [vc(r, channel, CHANNEL, 'getGroup', [], STRING)]);
    const importance = vc(r, channel, CHANNEL, 'getImportance', [], 'I');   // an app may lower the importance of its own channel; raising it is the user's choice
    if (importance < vc(r, existing, CHANNEL, 'getImportance', [], 'I')) vc(r, existing, CHANNEL, 'setImportance', ['I'], 'V', [importance]);
  };
  const listValues = (r, list) => { if (list === null || list === 0 || list === undefined) r.throwJava('Ljava/lang/NullPointerException;', null); return r.array(vc(r, list, LIST_T, 'toArray', [], '[Ljava/lang/Object;')).elements; };
  const createGroup = (r, group) => {
    if (group === null || group === 0 || group === undefined) r.throwJava('Ljava/lang/NullPointerException;', null);
    const id = groupId(r, group), existing = notificationState.groups.get(id);
    if (existing === undefined) { notificationState.groups.set(id, group); return; }
    vc(r, existing, GROUP, 'setDescription', [STRING], 'V', [vc(r, group, GROUP, 'getDescription', [], STRING)]);
    r.object(existing).channelGroup.name = r.object(group).channelGroup.name;
  };
  const withChannels = (r, group) => {
    const id = groupId(r, group), list = newEmptyList(r);
    for (const channel of notificationState.channels.values()) if (channelGroupId(r, channel) === id) r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, channel], 'virtual');
    vc(r, group, GROUP, 'setChannels', [LIST_T], 'V', [list]); return group;
  };
  def(NOTIFICATION_MANAGER, 'createNotificationChannel', `(${CHANNEL})V`, (r, _m, [, channel]) => createChannel(r, channel));
  def(NOTIFICATION_MANAGER, 'createNotificationChannels', `(${LIST_T})V`, (r, _m, [, channels]) => { for (const channel of listValues(r, channels)) createChannel(r, channel); });
  def(NOTIFICATION_MANAGER, 'createNotificationChannelGroup', `(${GROUP})V`, (r, _m, [, group]) => createGroup(r, group));
  def(NOTIFICATION_MANAGER, 'createNotificationChannelGroups', `(${LIST_T})V`, (r, _m, [, groups]) => { for (const group of listValues(r, groups)) createGroup(r, group); });
  def(NOTIFICATION_MANAGER, 'getNotificationChannelGroups', `()${LIST_T}`, r => { const list = newEmptyList(r); for (const group of notificationState.groups.values()) r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, withChannels(r, group)], 'virtual'); return list; });
  def(NOTIFICATION_MANAGER, 'getNotificationChannelGroup', `(${STRING})${GROUP}`, (r, _m, [, id]) => { const group = notificationState.groups.get(text(r, id)); return group === undefined ? null : withChannels(r, group); });
  def(NOTIFICATION_MANAGER, 'deleteNotificationChannelGroup', `(${STRING})V`, (r, _m, [, id]) => {
    const key = text(r, id); notificationState.groups.delete(key);
    for (const [channelKey, channel] of [...notificationState.channels]) if (channelGroupId(r, channel) === key) notificationState.channels.delete(channelKey);
  });
  def(NOTIFICATION_MANAGER, 'getNotificationChannel', `(${STRING})${CHANNEL}`, (r, _m, [, id]) => notificationState.channels.get(text(r, id)) ?? null);
  def(NOTIFICATION_MANAGER, 'getNotificationChannels', '()Ljava/util/List;', r => { const list = newEmptyList(r); for (const channel of notificationState.channels.values()) r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, channel], 'virtual'); return list; });
  def(NOTIFICATION_MANAGER, 'deleteNotificationChannel', `(${STRING})V`, (r, _m, [, id]) => { notificationState.channels.delete(text(r, id)); });
  const post = (r, key, notification, tag, id) => { notificationState.posted.set(key, notification); notificationState.records.set(key, { tag: tag === null ? null : r.stringCharacters(tag), id, time: BigInt(Math.trunc(platform.clock.wall())) }); r.record(`NOTIFICATION post ${key}`); };
  platform.notificationRecords = notificationState.records; platform.notificationPosted = notificationState.posted;   // (tag, id, post time) of every notification the app still has posted, in post order (an update keeps its place, as in the service's list): NotificationManager.getActiveNotifications
  def(NOTIFICATION_MANAGER, 'notify', '(ILandroid/app/Notification;)V', (r, _m, [, id, notification]) => post(r, `:${id}`, notification, null, id));
  def(NOTIFICATION_MANAGER, 'notify', `(${STRING}ILandroid/app/Notification;)V`, (r, _m, [, tag, id, notification]) => post(r, `${tag === null ? '' : r.stringCharacters(tag)}:${id}`, notification, tag, id));
  def(NOTIFICATION_MANAGER, 'cancel', '(I)V', (_r, _m, [, id]) => { notificationState.posted.delete(`:${id}`); notificationState.records.delete(`:${id}`); });
  def(NOTIFICATION_MANAGER, 'cancel', `(${STRING}I)V`, (r, _m, [, tag, id]) => { const key = `${tag === null ? '' : r.stringCharacters(tag)}:${id}`; notificationState.posted.delete(key); notificationState.records.delete(key); });
  def(NOTIFICATION_MANAGER, 'cancelAll', '()V', () => { notificationState.posted.clear(); notificationState.records.clear(); });

  // ShortcutManager (ShortcutManager.java / ShortcutService, API 25+): per-app dynamic shortcut store with the service's limits. The virtual device has
  // no launcher that pins shortcuts, so isRequestPinShortcutSupported/requestPinShortcut answer false; there are no manifest or pinned shortcuts.
  const SHORTCUT_MANAGER = service('shortcut', 'Landroid/content/pm/ShortcutManager;'), SHORTCUT_INFO = 'Landroid/content/pm/ShortcutInfo;', LIST = 'Ljava/util/List;';
  const MAX_SHORTCUTS = 15;   // ShortcutService.DEFAULT_MAX_SHORTCUTS_PER_APP
  const shortcuts = { dynamic: gcRoot(new Map()), disabled: new Set(), used: [], sequence: 0 };
  const shortcutCall = (r, receiver, name, signature, parameters, result, ...rest) => r.dispatch({ owner: r.typeOf(receiver), name, signature, parameters, result }, [receiver, ...rest], 'virtual');
  const javaItems = (r, list) => {
    if (list === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const iterator = shortcutCall(r, list, 'iterator', '()Ljava/util/Iterator;', [], 'Ljava/util/Iterator;'), out = [];
    while (shortcutCall(r, iterator, 'hasNext', '()Z', [], 'Z')) { if (out.length > 4096) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Too many shortcuts'); out.push(shortcutCall(r, iterator, 'next', `()${OBJECT}`, [], OBJECT)); }
    return out;
  };
  // The service works on its own copies of the app's ShortcutInfo objects (the original class from the framework DEX) and follows ShortcutService / ShortcutPackage of
  // android-13.0.0_r1: fillInDefaultActivity, assignImplicitRanks, fixUpIncomingShortcutInfo, enforceShortcutCountsBeforeOperation (per target Activity), addOrReplaceDynamicShortcut,
  // the push eviction, updateShortcuts' copyNonNullFieldsFrom and adjustRanks' comparator (rank, rank-changed first, implicit rank, id). What the app reads back are clones
  // (CLONE_REMOVE_FOR_CREATOR) in ArrayMap order, i.e. ascending String.hashCode of the ids.
  const info = (r, ref, name, parameters, result, ...rest) => r.dispatch({ owner: SHORTCUT_INFO, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, rest, { receiver: ref }), 'virtual');
  const constant = (r, name) => r.readStatic({ owner: SHORTCUT_INFO, name, type: 'I', key: `${SHORTCUT_INFO}->${name}:I` });
  const idOf = (r, ref) => { if (ref === null) r.throwJava('Ljava/lang/NullPointerException;', 'Null shortcut detected'); return r.stringCharacters(info(r, ref, 'getId', [], STRING)); };
  const shortcutId = idOf;
  const componentText = (r, component) => component === null ? null : `${r.stringCharacters(r.dispatch({ owner: COMPONENT, name: 'getPackageName', parameters: [], result: STRING, signature: `()${STRING}` }, [component], 'virtual'))}/${r.stringCharacters(r.dispatch({ owner: COMPONENT, name: 'getClassName', parameters: [], result: STRING, signature: `()${STRING}` }, [component], 'virtual'))}`;
  const mainActivities = () => new Set((platform.manifest?.activities ?? []).filter(activity => activity.launcher).map(activity => activity.name.replace(/^\./, `${platform.packageName}.`)));
  const defaultActivity = r => {
    if (!shortcuts.activity) { const name = r.launcherActivity; if (!name) return null; const component = r.allocate(COMPONENT); r.dispatch({ owner: COMPONENT, name: '<init>', parameters: [STRING, STRING], result: 'V', signature: `(${STRING}${STRING})V` }, [component, platform.packageName, name], 'direct'); shortcuts.activity = component; }
    return shortcuts.activity;
  };
  const cloneOf = (r, ref, flags = 0) => info(r, ref, 'clone', ['I'], SHORTCUT_INFO, flags);
  const now = r => BigInt(Math.floor(r.clock.wall?.() ?? 0));
  const javaHash = value => { let h = 0; for (let i = 0; i < value.length; i++) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0; return h; };
  const isMain = (r, component) => component === null || mainActivities().has(r.stringCharacters(r.dispatch({ owner: COMPONENT, name: 'getClassName', parameters: [], result: STRING, signature: `()${STRING}` }, [component], 'virtual')));
  /** ShortcutService.fixUpIncomingShortcutInfo */
  const fixUp = (r, ref, forUpdate) => {
    const activity = info(r, ref, 'getActivity', [], COMPONENT);
    if (activity !== null) {
      const pkg = r.stringCharacters(r.dispatch({ owner: COMPONENT, name: 'getPackageName', parameters: [], result: STRING, signature: `()${STRING}` }, [activity], 'virtual'));
      if (pkg !== platform.packageName) r.throwJava('Ljava/lang/IllegalStateException;', `Cannot publish shortcut: activity ${componentText(r, activity)} does not belong to package ${platform.packageName}`);
      if (!isMain(r, activity)) r.throwJava('Ljava/lang/IllegalStateException;', `Cannot publish shortcut: activity ${componentText(r, activity)} is not main activity`);
    }
    if (!forUpdate) {
      info(r, ref, 'enforceMandatoryFields', ['Z'], 'V', 0);
      if (info(r, ref, 'getActivity', [], COMPONENT) === null) r.throwJava('Ljava/lang/IllegalStateException;', 'Cannot publish shortcut: target activity is not set');
    }
    const icon = info(r, ref, 'getIcon', [], 'Landroid/graphics/drawable/Icon;');
    if (icon !== null) r.dispatch({ owner: SHORTCUT_INFO, name: 'validateIcon', parameters: ['Landroid/graphics/drawable/Icon;'], result: 'Landroid/graphics/drawable/Icon;', signature: '(Landroid/graphics/drawable/Icon;)Landroid/graphics/drawable/Icon;' }, [icon], 'static');
    info(r, ref, 'replaceFlags', ['I'], 'V', info(r, ref, 'getFlags', [], 'I') & constant(r, 'FLAG_LONG_LIVED'));
  };
  /** The app's list as the service's own copies, with the default Activity filled in (fillInDefaultActivity) and implicit ranks assigned (assignImplicitRanks). */
  const prepare = (r, list, { defaults }) => {
    const copies = javaItems(r, list).map(ref => { idOf(r, ref); return cloneOf(r, ref); });
    if (defaults) for (let i = copies.length - 1; i >= 0; i--) if (info(r, copies[i], 'getActivity', [], COMPONENT) === null) {
      const activity = defaultActivity(r); if (!activity) r.throwJava('Ljava/lang/IllegalStateException;', `Launcher activity not found for package ${platform.packageName}`);
      info(r, copies[i], 'setActivity', [COMPONENT], 'V', activity);
    }
    return copies;
  };
  const clearAllImplicitRanks = r => { for (const entry of shortcuts.dynamic.values()) info(r, entry.info, 'clearImplicitRankAndRankChangedFlag', [], 'V'); };
  const assignImplicitRanks = (r, copies) => { for (let i = copies.length - 1; i >= 0; i--) info(r, copies[i], 'setImplicitRank', ['I'], 'V', i); };
  const OPERATION = { SET: 0, ADD: 1, UPDATE: 2 };
  /** ShortcutPackage.enforceShortcutCountsBeforeOperation: no target Activity may end up with more than the maximum. */
  const enforceCounts = (r, copies, operation) => {
    const counts = new Map(), bump = (key, delta) => counts.set(key, (counts.get(key) ?? 0) + delta);
    for (const entry of shortcuts.dynamic.values()) if (operation !== OPERATION.SET) bump(componentText(r, info(r, entry.info, 'getActivity', [], COMPONENT)), 1);
    for (let i = copies.length - 1; i >= 0; i--) {
      const activity = info(r, copies[i], 'getActivity', [], COMPONENT); if (activity === null) continue;
      const original = shortcuts.dynamic.get(idOf(r, copies[i]));
      if (!original) { if (operation !== OPERATION.UPDATE) bump(componentText(r, activity), 1); continue; }
      if (operation !== OPERATION.SET) bump(componentText(r, info(r, original.info, 'getActivity', [], COMPONENT)), -1);
      bump(componentText(r, activity), 1);
    }
    for (const count of counts.values()) if (count > MAX_SHORTCUTS) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Max number of dynamic shortcuts exceeded');
  };
  const addOrReplace = (r, id, copy) => {
    info(r, copy, 'addFlags', ['I'], 'V', constant(r, 'FLAG_DYNAMIC')); info(r, copy, 'setTimestamp', ['J'], 'V', now(r));
    shortcuts.dynamic.delete(id); shortcuts.dynamic.set(id, { info: copy });
  };
  /** ShortcutPackage.adjustRanks */
  const adjustRanks = r => {
    const byActivity = new Map();
    for (const [id, entry] of shortcuts.dynamic) {
      const key = componentText(r, info(r, entry.info, 'getActivity', [], COMPONENT)), view = { id, info: entry.info, rank: info(r, entry.info, 'getRank', [], 'I'), changed: info(r, entry.info, 'isRankChanged', [], 'Z') === 1, implicit: info(r, entry.info, 'getImplicitRank', [], 'I') };
      (byActivity.get(key) ?? byActivity.set(key, []).get(key)).push(view);
    }
    for (const list of byActivity.values()) {
      list.sort((a, b) => a.rank - b.rank || (a.changed === b.changed ? 0 : a.changed ? -1 : 1) || a.implicit - b.implicit || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      list.forEach((view, index) => { if (view.rank !== index) { info(r, view.info, 'setTimestamp', ['J'], 'V', now(r)); info(r, view.info, 'setRank', ['I'], 'V', index); } });
    }
  };
  const dynamicList = r => listOf(r, [...shortcuts.dynamic.entries()].sort((a, b) => javaHash(a[0]) - javaHash(b[0])).map(([, entry]) => cloneOf(r, entry.info, constant(r, 'CLONE_REMOVE_FOR_CREATOR'))));
  const listOf = (r, values) => { const list = newEmptyList(r); for (const value of values) r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, value], 'virtual'); return list; };
  const ids = (r, list) => javaItems(r, list).map(id => text(r, id));
  // ShortcutManager.FLAG_MATCH_MANIFEST = 1, FLAG_MATCH_DYNAMIC = 2, FLAG_MATCH_PINNED = 4, FLAG_MATCH_CACHED = 8
  def(SHORTCUT_MANAGER, 'getMaxShortcutCountPerActivity', '()I', () => MAX_SHORTCUTS);
  def(SHORTCUT_MANAGER, 'isRateLimitingActive', '()Z', () => 0);
  def(SHORTCUT_MANAGER, 'getRemainingCallCount', '()I', () => 10);
  def(SHORTCUT_MANAGER, 'isRequestPinShortcutSupported', '()Z', () => 0);
  def(SHORTCUT_MANAGER, 'requestPinShortcut', `(${SHORTCUT_INFO}Landroid/content/IntentSender;)Z`, (r, _m, [, ref]) => { shortcutId(r, ref); return 0; });
  def(SHORTCUT_MANAGER, 'createShortcutResultIntent', `(${SHORTCUT_INFO})Landroid/content/Intent;`, () => { throw new APKError('ShortcutManager.createShortcutResultIntent needs a launcher result path that the virtual device does not have', { kind: 'unsupported-shortcut-result' }); });
  def(SHORTCUT_MANAGER, 'getDynamicShortcuts', `()${LIST}`, r => dynamicList(r));
  def(SHORTCUT_MANAGER, 'getManifestShortcuts', `()${LIST}`, r => listOf(r, []));
  def(SHORTCUT_MANAGER, 'getPinnedShortcuts', `()${LIST}`, r => listOf(r, []));
  def(SHORTCUT_MANAGER, 'getShortcuts', `(I)${LIST}`, (r, _m, [, flags]) => (flags & 2) ? dynamicList(r) : listOf(r, []));
  def(SHORTCUT_MANAGER, 'setDynamicShortcuts', `(${LIST})Z`, (r, _m, [, list]) => {
    const copies = prepare(r, list, { defaults: true });
    enforceCounts(r, copies, OPERATION.SET); clearAllImplicitRanks(r); assignImplicitRanks(r, copies);
    for (const copy of copies) fixUp(r, copy, false);
    shortcuts.dynamic.clear(); for (const copy of copies) addOrReplace(r, idOf(r, copy), copy);
    adjustRanks(r); return 1;
  });
  def(SHORTCUT_MANAGER, 'addDynamicShortcuts', `(${LIST})Z`, (r, _m, [, list]) => {
    const copies = prepare(r, list, { defaults: true });
    enforceCounts(r, copies, OPERATION.ADD); clearAllImplicitRanks(r); assignImplicitRanks(r, copies);
    for (const copy of copies) { fixUp(r, copy, false); info(r, copy, 'setRankChanged', [], 'V'); addOrReplace(r, idOf(r, copy), copy); }
    adjustRanks(r); return 1;
  });
  def(SHORTCUT_MANAGER, 'pushDynamicShortcut', `(${SHORTCUT_INFO})V`, (r, _m, [, ref]) => {
    const [copy] = prepare(r, listOf(r, [ref]), { defaults: true }), id = idOf(r, copy);
    if (info(r, copy, 'hasRank', [], 'Z') !== 1) info(r, copy, 'setRank', ['I'], 'V', 0);
    clearAllImplicitRanks(r); info(r, copy, 'setImplicitRank', ['I'], 'V', 0);
    fixUp(r, copy, false); info(r, copy, 'setRankChanged', [], 'V');
    if (info(r, copy, 'isEnabled', [], 'Z') !== 1) r.throwJava('Ljava/lang/IllegalArgumentException;', 'pushDynamicShortcuts() cannot publish disabled shortcuts');
    if (!shortcuts.dynamic.has(id)) {
      const key = componentText(r, info(r, copy, 'getActivity', [], COMPONENT)), same = [...shortcuts.dynamic.entries()].filter(([, entry]) => componentText(r, info(r, entry.info, 'getActivity', [], COMPONENT)) === key);
      if (same.length === MAX_SHORTCUTS) { same.sort((a, b) => info(r, a[1].info, 'getRank', [], 'I') - info(r, b[1].info, 'getRank', [], 'I')); shortcuts.dynamic.delete(same[MAX_SHORTCUTS - 1][0]); }   // the lowest-ranked one makes room
    }
    addOrReplace(r, id, copy); adjustRanks(r);
    if (shortcuts.used.length < 256) shortcuts.used.push(id);
  });
  def(SHORTCUT_MANAGER, 'updateShortcuts', `(${LIST})Z`, (r, _m, [, list]) => {
    const copies = prepare(r, list, { defaults: false });
    enforceCounts(r, copies, OPERATION.UPDATE); clearAllImplicitRanks(r); assignImplicitRanks(r, copies);
    for (const source of copies) {
      fixUp(r, source, true);
      const target = shortcuts.dynamic.get(idOf(r, source)); if (!target) continue;
      if (info(r, source, 'hasRank', [], 'Z') === 1) { info(r, target.info, 'setRankChanged', [], 'V'); info(r, target.info, 'setImplicitRank', ['I'], 'V', info(r, source, 'getImplicitRank', [], 'I')); }
      info(r, target.info, 'copyNonNullFieldsFrom', [SHORTCUT_INFO], 'V', source); info(r, target.info, 'setTimestamp', ['J'], 'V', now(r));
    }
    adjustRanks(r); return 1;
  });
  def(SHORTCUT_MANAGER, 'removeDynamicShortcuts', `(${LIST})V`, (r, _m, [, list]) => { for (const id of ids(r, list)) shortcuts.dynamic.delete(id); adjustRanks(r); });
  def(SHORTCUT_MANAGER, 'removeLongLivedShortcuts', `(${LIST})V`, (r, _m, [, list]) => { for (const id of ids(r, list)) shortcuts.dynamic.delete(id); adjustRanks(r); });
  def(SHORTCUT_MANAGER, 'removeAllDynamicShortcuts', '()V', () => { shortcuts.dynamic.clear(); });
  def(SHORTCUT_MANAGER, 'disableShortcuts', `(${LIST})V`, (r, _m, [, list]) => { for (const id of ids(r, list)) { shortcuts.dynamic.delete(id); shortcuts.disabled.add(id); } adjustRanks(r); });
  def(SHORTCUT_MANAGER, 'disableShortcuts', `(${LIST}Ljava/lang/CharSequence;)V`, (r, _m, [, list]) => { for (const id of ids(r, list)) { shortcuts.dynamic.delete(id); shortcuts.disabled.add(id); } adjustRanks(r); });
  def(SHORTCUT_MANAGER, 'enableShortcuts', `(${LIST})V`, (r, _m, [, list]) => { for (const id of ids(r, list)) shortcuts.disabled.delete(id); });
  def(SHORTCUT_MANAGER, 'reportShortcutUsed', `(${STRING})V`, (r, _m, [, id]) => { const value = text(r, id); if (shortcuts.used.length < 256) shortcuts.used.push(value); r.record(`SHORTCUT used ${value}`); });

  // ActivityManager: the virtual device runs exactly this app's process, in the foreground; memory figures are the VM's declared device (4 GiB RAM, 256 MiB app heap).
  const ACTIVITY_MANAGER = service('activity', 'Landroid/app/ActivityManager;'), PROC_INFO = 'Landroid/app/ActivityManager$RunningAppProcessInfo;', MEM_INFO = 'Landroid/app/ActivityManager$MemoryInfo;';
  type(PROC_INFO, OBJECT, [], { allocatable: true }); type(MEM_INFO, OBJECT, [], { allocatable: true });
  def(PROC_INFO, '<init>', '()V', () => {}); def(MEM_INFO, '<init>', '()V', () => {});
  for (const [name, ftype] of [['processName', STRING], ['pid', 'I'], ['uid', 'I'], ['importance', 'I'], ['importanceReasonCode', 'I'], ['pkgList', '[Ljava/lang/String;']]) registry.instanceField(PROC_INFO, name, ftype, { reflect: true });
  // Choreographer's frame bookkeeping is read by reflection in some libraries (hidden-API greylist 'unsupported' fields, still reachable on API 28-ish targets): the value is the last frame time the VM produced.
  registry.instanceField('Landroid/view/Choreographer;', 'mLastFrameTimeNanos', 'J', { reflect: true });
  for (const [name, ftype] of [['availMem', 'J'], ['totalMem', 'J'], ['threshold', 'J'], ['lowMemory', 'Z']]) registry.instanceField(MEM_INFO, name, ftype, { reflect: true });
  // Application.getProcessName() (API 28): ActivityThread.currentProcessName(), the process the app runs in.
  def('Landroid/app/Application;', 'getProcessName', `()${STRING}`, () => processName(), { static: true });
  def(ACTIVITY_MANAGER, 'getRunningAppProcesses', '()Ljava/util/List;', r => {
    const list = newEmptyList(r), info = r.allocate(PROC_INFO), put = (name, ftype, value) => r.storeField(r.object(info).fields, `${PROC_INFO}->${name}:${ftype}`, value), packages = r.newArray('[Ljava/lang/String;', 1);
    const self = pkgs()?.multi ? pkgs().callerEntry(r) : null, other = self && !self.main ? self : null;   // ActivityManagerService: a normal app is shown its own process only; a companion's code sees its own
    r.array(packages).elements = [other ? other.name : appPkg()];
    put('processName', STRING, other ? pkgs().processOf(other) : processName()); put('pid', 'I', other ? other.pid : platform.virtualProcess.pid); put('uid', 'I', other ? other.uid : platform.virtualProcess.uid); put('importance', 'I', 100); put('importanceReasonCode', 'I', 0); put('pkgList', '[Ljava/lang/String;', packages);
    r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, info], 'virtual'); return list;
  });
  // the device's memory (src/process-memory.js): its RAM, and what this app's process does not hold of it, as /proc/meminfo and sysinfo report them
  def(ACTIVITY_MANAGER, 'getMemoryInfo', `(${MEM_INFO})V`, (r, _m, [, info]) => {
    const memory = deviceMemory(r), put = (name, ftype, value) => r.storeField(r.object(info).fields, `${MEM_INFO}->${name}:${ftype}`, value);
    put('totalMem', 'J', BigInt(memory.total)); put('availMem', 'J', BigInt(memory.available)); put('threshold', 'J', BigInt(memory.threshold)); put('lowMemory', 'Z', memory.low ? 1 : 0);
  });
  // ---- running services, tasks, app tasks, process memory (Android 13): a normal app sees only its own process, services and tasks (since API 26 / 21) -------------------------------------
  const RUNNING_SERVICE = 'Landroid/app/ActivityManager$RunningServiceInfo;', RUNNING_TASK = 'Landroid/app/ActivityManager$RunningTaskInfo;', RECENT_TASK = 'Landroid/app/ActivityManager$RecentTaskInfo;', APP_TASK = 'Landroid/app/ActivityManager$AppTask;';
  const MEMORY_INFO = 'Landroid/os/Debug$MemoryInfo;', COMPONENT_NAME_T = 'Landroid/content/ComponentName;', INTENT_T = 'Landroid/content/Intent;';
  const TASK_INFO = 'Landroid/app/TaskInfo;';   // RunningTaskInfo and RecentTaskInfo extend TaskInfo, which declares taskId, baseIntent, baseActivity, topActivity, origActivity, numActivities and isRunning
  type(TASK_INFO, OBJECT, [], { allocatable: true });
  for (const t of [RUNNING_TASK, RECENT_TASK]) type(t, TASK_INFO, ['Landroid/os/Parcelable;'], { allocatable: true });
  for (const t of [RUNNING_SERVICE, APP_TASK, MEMORY_INFO]) type(t, OBJECT, [], { allocatable: true });
  for (const t of [RUNNING_SERVICE, RUNNING_TASK, RECENT_TASK, MEMORY_INFO]) def(t, '<init>', '()V', () => {});
  for (const [name, ftype] of [['service', COMPONENT_NAME_T], ['pid', 'I'], ['uid', 'I'], ['process', STRING], ['foreground', 'Z'], ['activeSince', 'J'], ['started', 'Z'], ['clientCount', 'I'], ['crashCount', 'I'], ['lastActivityTime', 'J'], ['restarting', 'J'], ['flags', 'I'], ['clientPackage', STRING], ['clientLabel', 'I']]) registry.instanceField(RUNNING_SERVICE, name, ftype, { reflect: true });
  const taskFields = [['taskId', 'I'], ['persistentId', 'I'], ['baseIntent', INTENT_T], ['baseActivity', COMPONENT_NAME_T], ['topActivity', COMPONENT_NAME_T], ['origActivity', COMPONENT_NAME_T], ['numActivities', 'I'], ['isRunning', 'Z'], ['lastActiveTime', 'J'], ['description', 'Ljava/lang/CharSequence;']];
  const taskOwner = { taskId: TASK_INFO, baseIntent: TASK_INFO, baseActivity: TASK_INFO, topActivity: TASK_INFO, origActivity: TASK_INFO, numActivities: TASK_INFO, isRunning: TASK_INFO, lastActiveTime: TASK_INFO };
  for (const [name, ftype] of taskFields) if (taskOwner[name]) registry.instanceField(TASK_INFO, name, ftype, { reflect: true });
  for (const t of [RUNNING_TASK, RECENT_TASK]) { registry.instanceField(t, 'description', 'Ljava/lang/CharSequence;', { reflect: true }); registry.instanceField(t, 'id', 'I', { reflect: true }); }
  registry.instanceField(RUNNING_TASK, 'numRunning', 'I', { reflect: true }); registry.instanceField(RECENT_TASK, 'persistentId', 'I', { reflect: true }); registry.instanceField(RECENT_TASK, 'affiliatedTaskId', 'I', { reflect: true });
  // Debug.MemoryInfo's fields (frameworks/base core/java/android/os/Debug.java, android-13.0.0_r1): nine figures for each of dalvik, native and other, hasSwappedOutPss, and
  // otherStats, the nine figures of each "other" heap (NUM_OTHER_STATS + NUM_DVK_STATS = 32 of them)
  const MEMORY_PREFIXES = ['dalvik', 'native', 'other'], memName = (prefix, field) => prefix + field[0].toUpperCase() + field.slice(1);
  for (const prefix of MEMORY_PREFIXES) for (const field of MEMORY_INFO_FIELDS) registry.instanceField(MEMORY_INFO, memName(prefix, field), 'I', { reflect: true });
  registry.instanceField(MEMORY_INFO, 'hasSwappedOutPss', 'Z', { reflect: true }); registry.instanceField(MEMORY_INFO, 'otherStats', '[I', { reflect: true });
  const putField = (r, ref, owner, name, ftype, value) => r.storeField(r.object(ref).fields, r.resolveField({ owner, name, type: ftype, key: `${owner}->${name}:${ftype}` }).key, value);   // stored under the declaring class
  const addTo = (r, list, item) => r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, item], 'virtual');
  const componentFor = (r, className) => { const c = r.allocate(COMPONENT_NAME_T); call(r, COMPONENT_NAME_T, '<init>', [STRING, STRING], 'V', [c, appPkg(), className], 'direct'); return c; };
  def(ACTIVITY_MANAGER, 'getRunningServices', '(I)Ljava/util/List;', (r, _m, [, maxNum]) => {
    const list = newEmptyList(r); if (maxNum <= 0) return list;
    for (const [className, service] of boundServices) {
      if (call(r, 'Ljava/util/List;', 'size', [], 'I', [list]) >= maxNum) break;
      const info = r.allocate(RUNNING_SERVICE), put = (name, ftype, value) => putField(r, info, RUNNING_SERVICE, name, ftype, value);
      put('service', COMPONENT_NAME_T, componentFor(r, className)); put('pid', 'I', platform.virtualProcess.pid); put('uid', 'I', platform.virtualProcess.uid); put('process', STRING, processName());
      put('foreground', 'Z', 0); put('started', 'Z', 0); put('activeSince', 'J', BigInt(Math.floor(service.since ?? 0))); put('lastActivityTime', 'J', BigInt(Math.floor(service.since ?? 0)));
      put('clientCount', 'I', service.connections.size); put('crashCount', 'I', 0); put('restarting', 'J', 0n); put('flags', 'I', 0); put('clientPackage', STRING, null); put('clientLabel', 'I', 0);
      addTo(r, list, info);
    }
    return list;
  });
  const framesOf = task => task.frames.filter(frame => !frame.finished);
  const openTasks = () => platform.taskClosed ? [] : [...platform.tasks].reverse().filter(task => framesOf(task).length);   // most recent first, the way the recents list is ordered
  const fillTask = (r, info, owner, task) => {
    const put = (name, ftype, value) => putField(r, info, owner, name, ftype, value), frames = framesOf(task), base = frames[0], top = frames.at(-1);
    const baseName = r.typeOf(base.activity).slice(1, -1).replaceAll('/', '.'), topName = r.typeOf(top.activity).slice(1, -1).replaceAll('/', '.');
    const intent = r.allocate(INTENT_T); call(r, INTENT_T, '<init>', [STRING], 'V', [intent, 'android.intent.action.MAIN'], 'direct'); call(r, INTENT_T, 'addCategory', [STRING], INTENT_T, [intent, 'android.intent.category.LAUNCHER']); call(r, INTENT_T, 'setComponent', [COMPONENT_NAME_T], INTENT_T, [intent, componentFor(r, baseName)]);
    put('taskId', 'I', task.id); put('persistentId', 'I', task.id); put('baseIntent', INTENT_T, intent); put('baseActivity', COMPONENT_NAME_T, componentFor(r, baseName)); put('topActivity', COMPONENT_NAME_T, componentFor(r, topName)); put('origActivity', COMPONENT_NAME_T, null);
    put('numActivities', 'I', frames.length); put('isRunning', 'Z', 1); put('lastActiveTime', 'J', BigInt(Math.floor(task.lastActiveTime ?? platform.clock.now()))); put('description', 'Ljava/lang/CharSequence;', null);
    put('id', 'I', task.id);
    if (owner === RUNNING_TASK) put('numRunning', 'I', frames.length); else put('affiliatedTaskId', 'I', task.id);
  };
  def(ACTIVITY_MANAGER, 'getRunningTasks', '(I)Ljava/util/List;', (r, _m, [, maxNum]) => {   // since API 21 the caller's own tasks only
    const list = newEmptyList(r); if (maxNum <= 0) return list;
    for (const task of openTasks().slice(0, maxNum)) { const info = r.allocate(RUNNING_TASK); fillTask(r, info, RUNNING_TASK, task); addTo(r, list, info); }
    return list;
  });
  def(ACTIVITY_MANAGER, 'getAppTasks', '()Ljava/util/List;', r => { const list = newEmptyList(r); for (const task of openTasks()) { const appTask = r.allocate(APP_TASK); r.object(appTask).taskId = task.id; addTo(r, list, appTask); } return list; });
  const appTask = (r, self) => { const task = platform.taskById(r.object(self).taskId); return task && framesOf(task).length ? task : null; };
  def(APP_TASK, 'getTaskInfo', `()${RECENT_TASK}`, (r, _m, [self]) => {
    const task = appTask(r, self); if (!task) return null;   // a finished task has no info
    const info = r.allocate(RECENT_TASK); fillTask(r, info, RECENT_TASK, task); return info;
  });
  def(APP_TASK, 'finishAndRemoveTask', '()V', (r, _m, [self]) => { const task = appTask(r, self); if (task) platform.finishFrames(r, framesOf(task).reverse()); });
  def(APP_TASK, 'moveToFront', '()V', (r, _m, [self]) => { const task = appTask(r, self); if (task) platform.moveTaskToFront(r, task); });
  def(APP_TASK, 'setExcludeFromRecents', '(Z)V', (r, _m, [self, exclude]) => { const task = appTask(r, self); if (task) task.excludeFromRecents = !!exclude; });
  // Debug.MemoryInfo of this process (ActivityManager.getProcessMemoryInfo, Debug.getMemoryInfo, Debug.getPss), in kB, filled as android_os_Debug.cpp's getDirtyPagesPid fills it:
  // load_maps sums the process's mappings per heap (src/process-memory.js: the native process's mappings and the VM's Java heap and native memory, the figures /proc/self/status,
  // statm and smaps_rollup report). Other pids are not visible to an app and read zero (getMemoryInfo(pid) answers false).
  const memoryMappings = r => { const procfs = platform.javaIo?.fs?.()?.procfs; if (!procfs?.memoryMappings) return processMappings(r); procfs.attachRuntime?.(r); return procfs.memoryMappings(); };
  const fillMemoryInfo = (r, info, own) => {
    const put = (name, value) => putField(r, info, MEMORY_INFO, name, 'I', value);
    const stats = own ? debugHeapStats(memoryMappings(r)) : Array.from({ length: NUM_HEAP }, () => Object.fromEntries(MEMORY_INFO_FIELDS.map(f => [f, 0])));
    [HEAP.DALVIK, HEAP.NATIVE, HEAP.UNKNOWN].forEach((heap, i) => { for (const field of MEMORY_INFO_FIELDS) put(memName(['dalvik', 'native', 'other'][i], field), stats[heap][field]); });
    const other = r.newArray('[I', (NUM_HEAP - NUM_CORE_HEAP) * MEMORY_INFO_FIELDS.length);
    r.array(other).elements = stats.slice(NUM_CORE_HEAP).flatMap(s => MEMORY_INFO_FIELDS.map(f => s[f]));
    putField(r, info, MEMORY_INFO, 'otherStats', '[I', other);
    putField(r, info, MEMORY_INFO, 'hasSwappedOutPss', 'Z', 0);   // no zram: swapped-out figures are swap sizes, and there is no swap
  };
  def(ACTIVITY_MANAGER, 'getProcessMemoryInfo', `([I)[${MEMORY_INFO}`, (r, _m, [, pids]) => {
    if (pids === null) r.throwJava('Ljava/lang/NullPointerException;', 'pids');
    const wanted = r.array(pids).elements, out = r.newArray(`[${MEMORY_INFO}`, wanted.length);
    r.array(out).elements = wanted.map(pid => { const info = r.allocate(MEMORY_INFO); fillMemoryInfo(r, info, pid === platform.virtualProcess.pid); return info; });
    return out;
  });
  const DEBUG_T = 'Landroid/os/Debug;';
  def(DEBUG_T, 'getMemoryInfo', `(${MEMORY_INFO})V`, (r, _m, [info]) => { if (info === null) r.throwJava('Ljava/lang/NullPointerException;', null); fillMemoryInfo(r, info, true); }, { static: true });
  def(DEBUG_T, 'getMemoryInfo', `(I${MEMORY_INFO})Z`, (r, _m, [pid, info]) => { if (info === null) r.throwJava('Ljava/lang/NullPointerException;', null); const own = pid === platform.virtualProcess.pid; fillMemoryInfo(r, info, own); return own ? 1 : 0; }, { static: true });   // false: the pid's smaps cannot be read
  // Debug.getPss: android_os_Debug_getPssPid sums the Pss of /proc/self/smaps_rollup (the same mappings)
  def(DEBUG_T, 'getPss', '()J', r => BigInt(debugHeapStats(memoryMappings(r)).slice(0, NUM_CORE_HEAP).reduce((sum, s) => sum + s.pss, 0)), { static: true });
  def(DEBUG_T, 'getPss', '(I[J[J)J', (r, _m, [pid, outUssSwapPssRss, outMemtrack]) => {
    if (pid !== platform.virtualProcess.pid) return 0n;
    const stats = debugHeapStats(memoryMappings(r)).slice(0, NUM_CORE_HEAP), sum = f => stats.reduce((total, s) => total + s[f], 0);
    if (outUssSwapPssRss !== null) { const a = r.array(outUssSwapPssRss).elements, values = [sum('privateDirty') + sum('privateClean'), 0, sum('rss')]; for (let i = 0; i < Math.min(a.length, 3); i++) a[i] = BigInt(values[i]); }
    if (outMemtrack !== null) { const a = r.array(outMemtrack).elements; for (let i = 0; i < a.length; i++) a[i] = 0n; }   // no memtrack HAL
    return BigInt(sum('pss'));
  }, { static: true });
  // MemoryInfo's own methods, as Debug.java computes them from the fields
  const memField = (r, self, name) => r.object(self).fields.get(`${MEMORY_INFO}->${name}:I`) ?? 0;
  const total = (r, self, field) => MEMORY_PREFIXES.reduce((sum, prefix) => sum + memField(r, self, memName(prefix, field)), 0);
  const otherStat = (r, self, which, field) => { const ref = r.object(self).fields.get(`${MEMORY_INFO}->otherStats:[I`); return ref ? (r.array(ref).elements[which * MEMORY_INFO_FIELDS.length + MEMORY_INFO_FIELDS.indexOf(field)] ?? 0) : 0; };
  const otherPrivate = (r, self, which) => otherStat(r, self, which, 'privateClean') + otherStat(r, self, which, 'privateDirty');
  const OTHER = Object.fromEntries(Object.entries(HEAP).filter(([, heap]) => heap >= NUM_CORE_HEAP).map(([name, heap]) => [name, heap - NUM_CORE_HEAP]));   // Debug.MemoryInfo.OTHER_*
  const swappedOutPss = (r, self) => total(r, self, 'swappedOutPss');
  const totalPss = (r, self) => total(r, self, 'pss') + swappedOutPss(r, self);
  const summary = {
    javaHeap: (r, self) => memField(r, self, 'dalvikPrivateDirty') + otherPrivate(r, self, OTHER.ART),
    nativeHeap: (r, self) => memField(r, self, 'nativePrivateDirty'),
    code: (r, self) => ['SO', 'JAR', 'APK', 'TTF', 'DEX', 'OAT', 'DALVIK_OTHER_ZYGOTE_CODE_CACHE', 'DALVIK_OTHER_APP_CODE_CACHE'].reduce((sum, name) => sum + otherPrivate(r, self, OTHER[name]), 0),
    stack: (r, self) => otherStat(r, self, OTHER.STACK, 'privateDirty'),
    graphics: (r, self) => otherPrivate(r, self, OTHER.GL_DEV) + otherPrivate(r, self, OTHER.GRAPHICS) + otherPrivate(r, self, OTHER.GL),
  };
  summary.privateOther = (r, self) => total(r, self, 'privateClean') + total(r, self, 'privateDirty') - summary.javaHeap(r, self) - summary.nativeHeap(r, self) - summary.code(r, self) - summary.stack(r, self) - summary.graphics(r, self);
  summary.system = (r, self) => totalPss(r, self) - total(r, self, 'privateClean') - total(r, self, 'privateDirty');
  const MEMORY_STATS = [['summary.java-heap', summary.javaHeap], ['summary.native-heap', summary.nativeHeap], ['summary.code', summary.code], ['summary.stack', summary.stack],
    ['summary.graphics', summary.graphics], ['summary.private-other', summary.privateOther], ['summary.system', summary.system], ['summary.total-pss', totalPss], ['summary.total-swap', (r, self) => total(r, self, 'swappedOut')]];
  const intGetters = {
    getTotalPss: totalPss, getTotalUss: (r, self) => total(r, self, 'privateClean') + total(r, self, 'privateDirty'), getTotalSwappablePss: (r, self) => total(r, self, 'swappablePss'),
    getTotalRss: (r, self) => total(r, self, 'rss'), getTotalPrivateDirty: (r, self) => total(r, self, 'privateDirty'), getTotalSharedDirty: (r, self) => total(r, self, 'sharedDirty'),
    getTotalPrivateClean: (r, self) => total(r, self, 'privateClean'), getTotalSharedClean: (r, self) => total(r, self, 'sharedClean'), getTotalSwappedOut: (r, self) => total(r, self, 'swappedOut'),
    getTotalSwappedOutPss: swappedOutPss, getSummaryJavaHeap: summary.javaHeap, getSummaryNativeHeap: summary.nativeHeap, getSummaryCode: summary.code, getSummaryStack: summary.stack,
    getSummaryGraphics: summary.graphics, getSummaryPrivateOther: summary.privateOther, getSummarySystem: summary.system, getSummaryTotalPss: totalPss,
    getSummaryTotalSwap: (r, self) => total(r, self, 'swappedOut'), getSummaryTotalSwapPss: swappedOutPss,
    getSummaryJavaHeapRss: (r, self) => memField(r, self, 'dalvikRss') + otherStat(r, self, OTHER.ART, 'rss'), getSummaryNativeHeapRss: (r, self) => memField(r, self, 'nativeRss'),
    getSummaryCodeRss: (r, self) => ['SO', 'JAR', 'APK', 'TTF', 'DEX', 'OAT', 'DALVIK_OTHER_ZYGOTE_CODE_CACHE', 'DALVIK_OTHER_APP_CODE_CACHE'].reduce((sum, name) => sum + otherStat(r, self, OTHER[name], 'rss'), 0),
    getSummaryStackRss: (r, self) => otherStat(r, self, OTHER.STACK, 'rss'),
    getSummaryGraphicsRss: (r, self) => otherStat(r, self, OTHER.GL_DEV, 'rss') + otherStat(r, self, OTHER.GRAPHICS, 'rss') + otherStat(r, self, OTHER.GL, 'rss'),
  };
  intGetters.getSummaryUnknownRss = (r, self) => intGetters.getTotalRss(r, self) - intGetters.getSummaryJavaHeapRss(r, self) - intGetters.getSummaryNativeHeapRss(r, self) - intGetters.getSummaryCodeRss(r, self) - intGetters.getSummaryStackRss(r, self) - intGetters.getSummaryGraphicsRss(r, self);
  for (const [name, fn] of Object.entries(intGetters)) def(MEMORY_INFO, name, '()I', (r, _m, [self]) => fn(r, self));
  def(MEMORY_INFO, 'hasSwappedOutPss', '()Z', (r, _m, [self]) => r.object(self).fields.get(`${MEMORY_INFO}->hasSwappedOutPss:Z`) ? 1 : 0);
  const otherIndex = (r, which) => { if (which < 0 || which >= NUM_HEAP - NUM_CORE_HEAP) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${(NUM_HEAP - NUM_CORE_HEAP) * MEMORY_INFO_FIELDS.length}; index=${which * MEMORY_INFO_FIELDS.length}`); return which; };
  for (const field of MEMORY_INFO_FIELDS) def(MEMORY_INFO, memName('getOther', field), '(I)I', (r, _m, [self, which]) => otherStat(r, self, otherIndex(r, which), field));
  def(MEMORY_INFO, 'getOtherPrivate', '(I)I', (r, _m, [self, which]) => otherPrivate(r, self, otherIndex(r, which)));
  // getOtherLabel (Debug.java's switch)
  const OTHER_LABELS = ['Dalvik Other', 'Stack', 'Cursor', 'Ashmem', 'Gfx dev', 'Other dev', '.so mmap', '.jar mmap', '.apk mmap', '.ttf mmap', '.dex mmap', '.oat mmap', '.art mmap', 'Other mmap',
    'EGL mtrack', 'GL mtrack', 'Other mtrack', '.Heap', '.LOS', '.Zygote', '.NonMoving', '.LinearAlloc', '.GC', '.ZygoteJIT', '.AppJIT', '.CompilerMetadata', '.IndirectRef', '.Boot vdex',
    '.App dex', '.App vdex', '.App art', '.Boot art'];
  def(MEMORY_INFO, 'getOtherLabel', `(I)${STRING}`, (_r, _m, [which]) => OTHER_LABELS[which] ?? '????', { static: true });
  // getMemoryStat / getMemoryStats: the summary figures by name, as decimal strings (null for an unknown name)
  def(MEMORY_INFO, 'getMemoryStat', `(${STRING})${STRING}`, (r, _m, [self, name]) => { const stat = MEMORY_STATS.find(([key]) => key === text(r, name)); return stat ? String(stat[1](r, self)) : null; });
  def(MEMORY_INFO, 'getMemoryStats', '()Ljava/util/Map;', (r, _m, [self]) => {
    const map = r.allocate('Ljava/util/HashMap;'); r.dispatch({ owner: 'Ljava/util/HashMap;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [map], 'direct');
    for (const [key, fn] of MEMORY_STATS) r.dispatch({ owner: 'Ljava/util/HashMap;', name: 'put', parameters: [OBJECT, OBJECT], result: OBJECT, signature: `(${OBJECT}${OBJECT})${OBJECT}` }, [map, key, String(fn(r, self))], 'virtual');
    return map;
  });
  def(ACTIVITY_MANAGER, 'isLowRamDevice', '()Z', () => 0); def(ACTIVITY_MANAGER, 'getMemoryClass', '()I', () => 256); def(ACTIVITY_MANAGER, 'getLargeMemoryClass', '()I', () => 512);
  def(ACTIVITY_MANAGER, 'isBackgroundRestricted', '()Z', () => 0);
  def(ACTIVITY_MANAGER, 'getHistoricalProcessExitReasons', `(${STRING}II)Ljava/util/List;`, r => newEmptyList(r)); // a fresh virtual process has no exit history

  // ---- PackageManager.getServiceInfo (ServiceInfo = ComponentInfo + permission/flags/foregroundServiceType) --------------------------------------
  const SERVICE_INFO = 'Landroid/content/pm/ServiceInfo;';
  type(SERVICE_INFO, COMPONENT_INFO, [], { allocatable: true });
  for (const [name, ftype] of [['permission', STRING], ['flags', 'I'], ['foregroundServiceType', 'I']]) registry.instanceField(SERVICE_INFO, name, ftype, { reflect: true });
  function fillComponentInfo(r, info, detail, withMeta, owner = null) {
    const put = (owner, name, ftype, value) => r.storeField(r.object(info).fields, `${owner}->${name}:${ftype}`, value), other = companionOf(owner);
    put(ITEM_INFO, 'name', STRING, detail.name); put(ITEM_INFO, 'packageName', STRING, other ? other.name : appPkg()); put(ITEM_INFO, 'metaData', BUNDLE, withMeta ? (other ? pkgs().metaData(r, other, detail.metaData ?? []) : metaDataBundle(r, detail.metaData)) : null);
    put(COMPONENT_INFO, 'applicationInfo', APPLICATION_INFO, other ? pkgs().applicationInfoFor(r, other) : platform.applicationInfo(r)); put(COMPONENT_INFO, 'processName', STRING, other ? pkgs().processOf(other, detail) : providerProcess(detail));
    put(COMPONENT_INFO, 'enabled', 'Z', isFalse(detail.enabled) ? 0 : 1); put(COMPONENT_INFO, 'exported', 'Z', (other ? pkgs().exported(other, detail) : isTrue(detail.exported)) ? 1 : 0); put(COMPONENT_INFO, 'directBootAware', 'Z', isTrue(detail.directBootAware) ? 1 : 0);
    return put;
  }
  // ---- component enabled state (ApplicationPackageManager.setComponentEnabledSetting): an app may toggle its own components; state lives for the VM's lifetime like a user-0 package setting.
  // getXInfo(...).enabled and Intent resolution of disabled components are not re-derived from it yet (components are never resolved by Intent in this VM).
  const COMPONENT_STATES = new Map();
  const componentKey = (r, component) => { const c = r.object(component); return `${c.packageName}/${c.className}`; };
  const KNOWN_KINDS = new Set(['activity', 'activity-alias', 'service', 'receiver', 'provider']);
  def(PACKAGE_MANAGER, 'setComponentEnabledSetting', '(Landroid/content/ComponentName;II)V', (r, _m, [, component, state, flags]) => {
    if (component === null || component === 0) r.throwJava('Ljava/lang/NullPointerException;', 'componentName');
    if (![0, 1, 2, 3, 4].includes(state)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Invalid new component state: ' + state);
    const c = r.object(component), declared = (platform.manifest?.componentDetails ?? []).some(detail => KNOWN_KINDS.has(detail.kind) && detail.name === c.className) || (platform.manifest?.activities ?? []).some(a => (a?.name ?? a) === c.className);
    if (c.packageName !== appPkg() || !declared) r.throwJava('Ljava/lang/IllegalArgumentException;', `Unknown component: ComponentInfo{${c.packageName}/${c.className}}`);
    if (state === 0) COMPONENT_STATES.delete(componentKey(r, component)); else COMPONENT_STATES.set(componentKey(r, component), state);
    r.record(`PM setComponentEnabledSetting ${c.className} state=${state} flags=${flags}`);
  });
  def(PACKAGE_MANAGER, 'getComponentEnabledSetting', '(Landroid/content/ComponentName;)I', (r, _m, [, component]) => {
    if (component === null || component === 0) r.throwJava('Ljava/lang/NullPointerException;', 'componentName');
    const c = r.object(component), declared = (platform.manifest?.componentDetails ?? []).some(detail => KNOWN_KINDS.has(detail.kind) && detail.name === c.className) || (platform.manifest?.activities ?? []).some(a => (a?.name ?? a) === c.className);
    if (c.packageName !== appPkg() || !declared) r.throwJava('Ljava/lang/IllegalArgumentException;', `Unknown component: ComponentInfo{${c.packageName}/${c.className}}`);
    return COMPONENT_STATES.get(componentKey(r, component)) ?? 0;
  });
  for (const [name, value] of Object.entries({ COMPONENT_ENABLED_STATE_DEFAULT: 0, COMPONENT_ENABLED_STATE_ENABLED: 1, COMPONENT_ENABLED_STATE_DISABLED: 2, COMPONENT_ENABLED_STATE_DISABLED_USER: 3, COMPONENT_ENABLED_STATE_DISABLED_UNTIL_USED: 4, DONT_KILL_APP: 1, SYNCHRONOUS: 4 })) registry.staticField(PACKAGE_MANAGER, name, 'I', () => value);
  /** A component of a visible companion package (or, for a companion's code, of the app): { owner, detail }, else null (the app's own lookups keep their original path). */
  const packageComponent = (r, c, kind) => {
    if (!pkgs()?.multi) return null;
    const found = packages(r).find(e => e.name === c.packageName && e.entry); if (!found) return null;
    const owner = found.entry; if (owner.main && pmCaller(r).main) return null;
    const detail = kind === 'provider' ? (owner.manifest.providerDetails ?? []).find(p => p.name === c.className) : (owner.manifest.componentDetails ?? []).find(p => p.kind === kind && p.name === c.className);
    if (!detail) r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', `ComponentInfo{${c.packageName}/${c.className}}`);
    return { owner, detail };
  };
  def(PACKAGE_MANAGER, 'getServiceInfo', `(Landroid/content/ComponentName;I)${SERVICE_INFO}`, (r, _m, [, component, flags]) => {
    const c = r.object(component), found = packageComponent(r, c, 'service'); if (found) return makeInfo(r, found.detail, 'service', (flags & 128) !== 0, found.owner);
    const detail = (platform.manifest?.componentDetails ?? []).find(p => p.kind === 'service' && p.name === c.className);
    if (c.packageName !== pkg() || !detail) r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', `ComponentInfo{${c.packageName}/${c.className}}`);
    const info = r.allocate(SERVICE_INFO), put = fillComponentInfo(r, info, detail, (flags & 128) !== 0);
    put(SERVICE_INFO, 'permission', STRING, detail.permission); put(SERVICE_INFO, 'flags', 'I', 0); put(SERVICE_INFO, 'foregroundServiceType', 'I', Number(detail.foregroundServiceType) | 0);
    return info;
  });

  // ---- getReceiverInfo / queryIntentServices / queryBroadcastReceivers / resolveService over this app's manifest (the virtual device has one installed package) ----------------
  // Matching uses the explicit component or package of the Intent, else the declared <action> names; <category>/<data> of a manifest filter are not recorded by the loader, so they cannot
  // narrow a match (a component whose action matches is returned).
  const ACTIVITY_INFO_TYPE = 'Landroid/content/pm/ActivityInfo;', RESOLVE_INFO = 'Landroid/content/pm/ResolveInfo;', INTENT_TYPE = 'Landroid/content/Intent;', COMPONENT_NAME = 'Landroid/content/ComponentName;';
  type(RESOLVE_INFO, OBJECT, [], { allocatable: true });
  for (const [name, ftype] of [['activityInfo', ACTIVITY_INFO_TYPE], ['serviceInfo', SERVICE_INFO], ['providerInfo', PROVIDER_INFO], ['priority', 'I'], ['preferredOrder', 'I'], ['match', 'I'], ['specificIndex', 'I'], ['isDefault', 'Z'], ['resolvePackageName', STRING], ['labelRes', 'I'], ['icon', 'I']]) registry.instanceField(RESOLVE_INFO, name, ftype, { reflect: true });
  def(RESOLVE_INFO, '<init>', '()V', (r, _m, [self]) => { r.storeField(r.object(self).fields, `${RESOLVE_INFO}->specificIndex:I`, -1); });
  const makeInfo = (r, detail, kind, withMeta, owner = null) => {
    if (kind === 'service') { const info = r.allocate(SERVICE_INFO), put = fillComponentInfo(r, info, detail, withMeta, owner); put(SERVICE_INFO, 'permission', STRING, detail.permission); put(SERVICE_INFO, 'flags', 'I', 0); put(SERVICE_INFO, 'foregroundServiceType', 'I', Number(detail.foregroundServiceType) | 0); return info; }
    const info = r.makeObject(ACTIVITY_INFO_TYPE), put = fillComponentInfo(r, info, detail, withMeta, owner); put(ACTIVITY_INFO_TYPE, 'permission', STRING, detail.permission ?? null); put(ACTIVITY_INFO_TYPE, 'flags', 'I', 0); return info;
  };
  const matchingComponents = (r, intent, kind, flags = 0) => {
    const call = (name, result) => r.dispatch({ owner: INTENT_TYPE, name, parameters: [], result, signature: `()${result}` }, [intent], 'virtual');
    const component = call('getComponent', COMPONENT_NAME), wantedPackage = call('getPackage', STRING), action = call('getAction', STRING);
    // activities come from the manifest's activity list (name, exported flag, launcher); the launcher activity answers MAIN with the LAUNCHER category (its intent filter), the rest by explicit component only
    const details = kind === 'activity' ? (platform.manifest?.activities ?? []).map(a => ({ ...a, kind: 'activity', actions: a.launcher ? ['android.intent.action.MAIN'] : [], categories: a.launcher ? ['android.intent.category.LAUNCHER', 'android.intent.category.DEFAULT'] : [] })) : (platform.manifest?.componentDetails ?? []).filter(d => d.kind === kind && !isFalse(d.enabled));
    if (component !== null) { const c = r.object(component); return c.packageName === pkg() ? details.filter(d => d.name === c.className) : []; }
    // Activities: the manifest's <intent-filter>s decide (src/intent-resolver.js, as PackageManager.queryIntentActivities); MATCH_DEFAULT_ONLY (0x10000) requires CATEGORY_DEFAULT.
    // A manifest record without parsed filters (a hand-built one) keeps the launcher filter its launcher flag stands for.
    if (kind === 'activity') {
      const manifest = { ...platform.manifest, activities: (platform.manifest?.activities ?? []).map(a => a.filters || !a.launcher ? a : { ...a, filters: [{ actions: ['android.intent.action.MAIN'], categories: ['android.intent.category.LAUNCHER'], data: [] }] }) };
      const { matches } = resolveIntentFields(manifest, platform.intentFields(r, r.object(intent)), { defaultOnly: (flags & 0x10000) !== 0 });
      return matches.map(match => details.find(d => d.name === match.activity)).filter(Boolean);
    }
    if (wantedPackage !== null && r.stringCharacters(wantedPackage) !== pkg()) return [];
    const categories = call('getCategories', 'Ljava/util/Set;'), asArray = categories === null ? null : r.dispatch({ owner: 'Ljava/util/Set;', name: 'toArray', parameters: [], result: '[Ljava/lang/Object;', signature: '()[Ljava/lang/Object;' }, [categories], 'interface'), wanted = asArray === null ? [] : r.array(asArray).elements.map(c => r.stringCharacters(c));
    return action === null ? [] : details.filter(d => d.actions?.includes(r.stringCharacters(action)) && (kind !== 'activity' || wanted.every(c => d.categories?.includes(c))));
  };
  /** Services / receivers of the visible companion packages (and, for a companion's code, of the app) an Intent matches: [{ detail, owner }]. */
  const packageMatches = (r, intent, kind) => {
    if (!pkgs()?.multi || kind === 'activity') return [];
    const caller = pmCaller(r), call = (name, result) => r.dispatch({ owner: INTENT_TYPE, name, parameters: [], result, signature: `()${result}` }, [intent], 'virtual');
    const component = call('getComponent', COMPONENT_NAME), wanted = call('getPackage', STRING), action = call('getAction', STRING), out = [];
    for (const e of packages(r)) {
      const owner = e.entry; if (!owner || (owner.main && caller.main)) continue;
      const details = (owner.manifest.componentDetails ?? []).filter(d => d.kind === kind && !isFalse(d.enabled));
      if (component !== null) { const c = r.object(component); if (c.packageName === owner.name) out.push(...details.filter(d => d.name === c.className).map(detail => ({ detail, owner }))); continue; }
      if (wanted !== null && r.stringCharacters(wanted) !== owner.name) continue;
      if (action !== null) out.push(...details.filter(d => d.actions?.includes(r.stringCharacters(action))).map(detail => ({ detail, owner })));
    }
    return out;
  };
  const resolveInfos = (r, intent, kind, withMeta, flags = 0) => {
    const own = !pkgs()?.multi || pmCaller(r).main, list = newEmptyList(r), details = own ? matchingComponents(r, intent, kind, flags) : [];
    if (kind === 'activity' && !details.length) { const system = platform.sharedStorage?.systemActivity(r, intent) ?? platform.camera?.systemActivity?.(r, intent) ?? null; if (system !== null) r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, system], 'virtual'); }   // the device's file pickers (src/shared-storage-host.js) and its camera app (src/camera-capture-intent.js)
    for (const detail of details) {
      const resolved = r.allocate(RESOLVE_INFO); r.dispatch({ owner: RESOLVE_INFO, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [resolved], 'direct');
      r.storeField(r.object(resolved).fields, kind === 'service' ? `${RESOLVE_INFO}->serviceInfo:${SERVICE_INFO}` : `${RESOLVE_INFO}->activityInfo:${ACTIVITY_INFO_TYPE}`, makeInfo(r, detail, kind, withMeta));
      r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, resolved], 'virtual');
    }
    for (const { detail, owner } of packageMatches(r, intent, kind)) {
      const resolved = r.allocate(RESOLVE_INFO); r.dispatch({ owner: RESOLVE_INFO, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [resolved], 'direct');
      r.storeField(r.object(resolved).fields, kind === 'service' ? `${RESOLVE_INFO}->serviceInfo:${SERVICE_INFO}` : `${RESOLVE_INFO}->activityInfo:${ACTIVITY_INFO_TYPE}`, makeInfo(r, detail, kind, withMeta, owner));
      r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, resolved], 'virtual');
    }
    return list;
  };
  def(PACKAGE_MANAGER, 'getReceiverInfo', `(${COMPONENT_NAME}I)${ACTIVITY_INFO_TYPE}`, (r, _m, [, component, flags]) => {
    const found = packageComponent(r, r.object(component), 'receiver'); if (found) return makeInfo(r, found.detail, 'receiver', (flags & 128) !== 0, found.owner);
    const c = r.object(component), detail = (platform.manifest?.componentDetails ?? []).find(p => p.kind === 'receiver' && p.name === c.className);
    if (c.packageName !== pkg() || !detail) r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', `ComponentInfo{${c.packageName}/${c.className}}`);
    return makeInfo(r, detail, 'receiver', (flags & 128) !== 0);
  });
  def(PACKAGE_MANAGER, 'queryIntentServices', `(${INTENT_TYPE}I)Ljava/util/List;`, (r, _m, [, intent, flags]) => resolveInfos(r, intent, 'service', (flags & 128) !== 0));
  def(PACKAGE_MANAGER, 'queryBroadcastReceivers', `(${INTENT_TYPE}I)Ljava/util/List;`, (r, _m, [, intent, flags]) => resolveInfos(r, intent, 'receiver', (flags & 128) !== 0));
  // Activities resolve the same way: only this app is installed, so an external intent (a browser, the Play Store, the dialer) truthfully resolves to nothing.
  def(PACKAGE_MANAGER, 'queryIntentActivities', `(${INTENT_TYPE}I)Ljava/util/List;`, (r, _m, [, intent, flags]) => resolveInfos(r, intent, 'activity', (flags & 128) !== 0, flags));
  def(PACKAGE_MANAGER, 'resolveActivity', `(${INTENT_TYPE}I)${RESOLVE_INFO}`, (r, _m, [, intent, flags]) => {
    const list = resolveInfos(r, intent, 'activity', (flags & 128) !== 0, flags);
    return r.dispatch({ owner: 'Ljava/util/List;', name: 'isEmpty', parameters: [], result: 'Z', signature: '()Z' }, [list], 'virtual') ? null : r.dispatch({ owner: 'Ljava/util/List;', name: 'get', parameters: ['I'], result: OBJECT, signature: `(I)${OBJECT}` }, [list, 0], 'virtual');
  });
  def(PACKAGE_MANAGER, 'resolveService', `(${INTENT_TYPE}I)${RESOLVE_INFO}`, (r, _m, [, intent, flags]) => { const list = resolveInfos(r, intent, 'service', (flags & 128) !== 0); return r.dispatch({ owner: 'Ljava/util/List;', name: 'isEmpty', parameters: [], result: 'Z', signature: '()Z' }, [list], 'virtual') ? null : r.dispatch({ owner: 'Ljava/util/List;', name: 'get', parameters: ['I'], result: OBJECT, signature: `(I)${OBJECT}` }, [list, 0], 'virtual'); });

  // ---- AssetManager over the APK's assets/ tree -----------------------------------------------------------------------------------------------
  const ASSETS = 'Landroid/content/res/AssetManager;'; type(ASSETS, OBJECT, ['Ljava/lang/AutoCloseable;'], { allocatable: true });
  const assetManager = r => platform.assetManager ??= r.allocate(ASSETS);
  // A companion package's AssetManager reads that package's APK (src/package-registry.js); the app's reads the app's.
  const packageAssets = (r, entry) => { if (!entry.assetManager) { entry.assetManager = r.allocate(ASSETS); r.object(entry.assetManager).packageEntry = entry; pkgs().refs.set(`${entry.name}:assets`, entry.assetManager); } return entry.assetManager; };
  defContext('getAssets', `()${ASSETS}`, r => { const self = selfEntry(); return self ? packageAssets(r, self) : assetManager(r); });
  const assetPackage = (r, self) => (self && typeof self === 'object' ? r.object(self).packageEntry : null) ?? null;
  const entriesOf = (r, self) => assetPackage(r, self)?.entries ?? r.apkEntries;
  def('Landroid/content/res/Resources;', 'getAssets', `()${ASSETS}`, (r, _m, [self]) => { const own = assetPackage(r, self); return own && !own.main ? packageAssets(r, own) : assetManager(r); });   // a second package's Resources: the AssetManager over its own APK
  // new Resources(AssetManager, DisplayMetrics, Configuration) (Resources.java, deprecated public constructor): Resources over that AssetManager's package, whose configuration is the
  // given one (the device's when null), selected like a createConfigurationContext Resources (src/android-platform.js overrideResources).
  def('Landroid/content/res/Resources;', '<init>', `(${ASSETS}Landroid/util/DisplayMetrics;Landroid/content/res/Configuration;)V`, (r, _m, [self, assets, _metrics, config]) => {
    const CONFIG = 'Landroid/content/res/Configuration;', owner = assetPackage(r, assets), object = r.object(self);
    if (owner && !owner.main) object.packageEntry = owner;
    const device = platform.resourceConfiguration(r, null), merged = r.allocate(CONFIG);
    r.dispatch({ owner: CONFIG, name: '<init>', parameters: [CONFIG], result: 'V', signature: `(${CONFIG})V` }, [merged, device], 'direct');
    if (config) r.dispatch({ owner: CONFIG, name: 'updateFrom', parameters: [CONFIG], result: 'I', signature: `(${CONFIG})I` }, [merged, config], 'virtual');
    object.contextConfiguration = merged;
    object.resourceConfigurationDifference = r.dispatch({ owner: CONFIG, name: 'diff', parameters: [CONFIG], result: 'I', signature: `(${CONFIG})I` }, [device, merged], 'virtual');
  });
  const assetEntry = (r, name) => { const n = text(r, name).replace(/^\/+/, ''); return { n, entry: 'assets/' + n }; };
  const openAsset = (r, _m, [self, name]) => {
    const { n, entry } = assetEntry(r, name), owner = assetPackage(r, self);
    if (!entriesOf(r, self).has(entry)) r.throwJava('Ljava/io/FileNotFoundException;', n);
    return owner ? platform.javaIo.bytesStream(r, owner.reader(entry)) : platform.javaIo.apkResourceStream(r, entry);
  };
  def(ASSETS, 'open', `(${STRING})Ljava/io/InputStream;`, openAsset); def(ASSETS, 'open', `(${STRING}I)Ljava/io/InputStream;`, openAsset);
  // A file descriptor over a package entry (AssetManager.openFd / openNonAssetFd, Resources.openRawResourceFd): the installed APK file itself, with the offset and length of the entry's data.
  // Only an entry stored without compression can be read in place; a compressed one is the FileNotFoundException Android throws (aapt stores media, fonts and already-compressed formats).
  const ENTRY_AFD = 'Landroid/content/res/AssetFileDescriptor;', ENTRY_PFD = 'Landroid/os/ParcelFileDescriptor;', ENTRY_FILE = 'Ljava/io/File;';
  const NOT_FD = 'This file can not be opened as a file descriptor; it is probably compressed';
  const entryFd = (r, entry) => {
    const range = r.apkEntryRange?.(entry); if (!range || !range.stored) return null;
    const file = r.allocate(ENTRY_FILE); r.dispatch({ owner: ENTRY_FILE, name: '<init>', parameters: [STRING], result: 'V', signature: `(${STRING})V` }, [file, `${platform.javaIo.fs().codePath}/base.apk`], 'direct');
    const pfd = r.dispatch({ owner: ENTRY_PFD, name: 'open', parameters: [ENTRY_FILE, 'I'], result: ENTRY_PFD, signature: `(${ENTRY_FILE}I)${ENTRY_PFD}` }, [file, 0x10000000], 'static');   // MODE_READ_ONLY
    const afd = r.allocate(ENTRY_AFD); r.dispatch({ owner: ENTRY_AFD, name: '<init>', parameters: [ENTRY_PFD, 'J', 'J'], result: 'V', signature: `(${ENTRY_PFD}JJ)V` }, r.argumentWords([ENTRY_PFD, 'J', 'J'], [pfd, BigInt(range.start), BigInt(range.length)], { receiver: afd }), 'direct');
    return afd;
  };
  def(ASSETS, 'openFd', `(${STRING})${ENTRY_AFD}`, (r, _m, [self, name]) => { if (assetPackage(r, self)) throw new APKError(`AssetManager.openFd of companion package ${assetPackage(r, self).name} is not supported (open() is)`, { kind: 'package-assets-unsupported' }); const { n, entry } = assetEntry(r, name), fd = r.apkEntries.has(entry) ? entryFd(r, entry) : null; if (fd === null) r.throwJava('Ljava/io/FileNotFoundException;', NOT_FD + ': ' + n); return fd; });
  def(ASSETS, 'openNonAssetFd', `(${STRING})${ENTRY_AFD}`, (r, _m, [, name]) => { const n = text(r, name), fd = r.apkEntries.has(n) ? entryFd(r, n) : null; if (fd === null) r.throwJava('Ljava/io/FileNotFoundException;', NOT_FD + ': ' + n); return fd; });
  def(ASSETS, 'list', `(${STRING})[${STRING}`, (r, _m, [self, path]) => {
    const prefix = 'assets/' + text(r, path).replace(/^\/+|\/+$/g, ''), base = prefix === 'assets/' ? 'assets/' : prefix + '/', names = new Set();
    for (const e of entriesOf(r, self)) if (e.startsWith(base) && e.length > base.length) names.add(e.slice(base.length).split('/')[0]);
    const array = r.newArray('[Ljava/lang/String;', names.size); r.array(array).elements = [...names]; return array;
  });
  def(ASSETS, 'close', '()V', () => {});
  // AssetManager.getLocales (AssetManager2::GetResourceLocales over the loaded tables, system ones included): the locale of every resource configuration that names one, as
  // "language[-REGION]" (ResTable_config::unpackLanguage/unpackRegion: two letters, or three packed into two bytes), once each. A companion's AssetManager reads its own table.
  const unpackCode = (first, second, base) => {
    if (first & 0x80) return String.fromCharCode((second & 0x1f) + base, (((second & 0xe0) >> 5) | ((first & 0x03) << 3)) + base, ((first & 0x7c) >> 2) + base);
    return first ? String.fromCharCode(first, second) : '';
  };
  const tableLocales = (table, out) => {
    for (const variants of table?.entries?.values?.() ?? []) for (const entry of variants) {
      const bytes = entry?.config?.bytes; if (!Array.isArray(bytes) || bytes.length < 8) continue;
      const language = unpackCode(bytes[4], bytes[5], 0x61); if (!language) continue;
      const region = unpackCode(bytes[6], bytes[7], 0x30); out.add(region ? `${language}-${region}` : language);
    }
  };
  def(ASSETS, 'getLocales', `()[${STRING}`, (r, _m, [self]) => {
    const owner = assetPackage(r, self), locales = new Set();
    tableLocales(platform.resources?.frameworkTable, locales);
    tableLocales(owner ? pkgs().resourcesEnvironment(owner).table : platform.resources?.table, locales);
    const array = r.newArray(`[${STRING}`, locales.size); r.array(array).elements = [...locales].sort(); return array;
  });

  // Context.getMainExecutor (API 28): ContextImpl hands out the main thread's HandlerExecutor; execute() posts to the main Looper and refuses when the post fails.
  const HANDLER_EXECUTOR = 'Landroid/os/HandlerExecutor;', EXECUTOR = 'Ljava/util/concurrent/Executor;';
  // The executor is the original android.os.HandlerExecutor of framework.dex over a Handler on the main Looper (its execute() posts and refuses when the post fails).
  defContext('getMainExecutor', `()${EXECUTOR}`, r => {
    if (!platform.mainExecutor) {
      const looper = r.dispatch({ owner: 'Landroid/os/Looper;', name: 'getMainLooper', parameters: [], result: 'Landroid/os/Looper;', signature: '()Landroid/os/Looper;' }, [], 'static');
      const handler = r.allocate('Landroid/os/Handler;'); r.dispatch({ owner: 'Landroid/os/Handler;', name: '<init>', parameters: ['Landroid/os/Looper;'], result: 'V', signature: '(Landroid/os/Looper;)V' }, [handler, looper], 'direct');
      const executor = r.allocate(HANDLER_EXECUTOR); r.dispatch({ owner: HANDLER_EXECUTOR, name: '<init>', parameters: ['Landroid/os/Handler;'], result: 'V', signature: '(Landroid/os/Handler;)V' }, [executor, handler], 'direct'); platform.mainExecutor = executor;
    }
    return platform.mainExecutor;
  });
  // Context.getColor (API 23): getResources().getColor(id, getTheme())
  defContext('getColor', '(I)I', (r, _m, [context, id]) => {
    const resources = r.dispatch({ owner: CONTEXT, name: 'getResources', parameters: [], result: 'Landroid/content/res/Resources;', signature: '()Landroid/content/res/Resources;' }, [context], 'virtual');
    const theme = r.dispatch({ owner: CONTEXT, name: 'getTheme', parameters: [], result: 'Landroid/content/res/Resources$Theme;', signature: '()Landroid/content/res/Resources$Theme;' }, [context], 'virtual');
    return r.dispatch({ owner: 'Landroid/content/res/Resources;', name: 'getColor', parameters: ['I', 'Landroid/content/res/Resources$Theme;'], result: 'I', signature: '(ILandroid/content/res/Resources$Theme;)I' }, [resources, id, theme], 'virtual');
  });

  // Resources.openRawResource: the APK file behind a res/raw (or any file-based) resource id, as ART's AssetManager serves it.
  const rawEntry = (r, id) => {
    let value = platform.resources.resolve(id >>> 0); while (value.resolved) value = value.resolved;
    if (value.kind === 'unresolved' || value.kind === 'bag') platform.resourceNotFound(r, id, value, `Resource ID #0x${(id >>> 0).toString(16)}`);   // Resources.openRawResource: getValue first
    // ResourcesImpl.openRawResource: a value that is no file of the APK fails in AssetManager.openNonAsset, rethrown as NotFoundException("File <value.string> from resource ID #0x..")
    if (typeof value.value !== 'string' || !r.apkEntries.has(value.value)) r.throwJava('Landroid/content/res/Resources$NotFoundException;', `File ${typeof value.value === 'string' ? value.value : '(null)'} from resource ID #0x${(id >>> 0).toString(16)}`);
    return value.value;
  };
  // Resources.openRawResourceFd: the same entry as a descriptor; a compressed entry is Resources.NotFoundException, as AssetManager's FileNotFoundException is wrapped on Android
  def('Landroid/content/res/Resources;', 'openRawResourceFd', `(I)${ENTRY_AFD}`, (r, _m, [, id]) => { const entry = rawEntry(r, id), fd = entryFd(r, entry); if (fd === null) r.throwJava('Landroid/content/res/Resources$NotFoundException;', `File ${entry} from resource ID #0x${(id >>> 0).toString(16)}: ${NOT_FD}`); return fd; });
  def('Landroid/content/res/Resources;', 'openRawResource', '(I)Ljava/io/InputStream;', (r, _m, [, id]) => platform.javaIo.apkResourceStream(r, rawEntry(r, id)));
  def('Landroid/content/res/Resources;', 'openRawResource', '(ILandroid/util/TypedValue;)Ljava/io/InputStream;', (r, _m, [, id]) => platform.javaIo.apkResourceStream(r, rawEntry(r, id)));

  // ---- android.content.pm.Signature / SigningInfo (AOSP semantics: a byte[] certificate, hex toCharsString, Arrays.hashCode) ----------------------
  const SIGNATURE = 'Landroid/content/pm/Signature;', SIGNATURES = '[Landroid/content/pm/Signature;', SIGNING_INFO = 'Landroid/content/pm/SigningInfo;';
  type(SIGNATURE, OBJECT, ['Landroid/os/Parcelable;'], { allocatable: true }); type(SIGNING_INFO, OBJECT, ['Landroid/os/Parcelable;'], { allocatable: true });
  const bytesOf = (r, self) => r.object(self).signatureBytes ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Signature has no bytes');
  const byteArray = (r, bytes) => { const array = r.newArray('[B', bytes.length); r.array(array).elements = Array.from(bytes, v => (v << 24) >> 24); return array; };
  const newSignature = (r, bytes) => { const signature = r.allocate(SIGNATURE); r.object(signature).signatureBytes = Int8Array.from(bytes, v => (v << 24) >> 24); return signature; };
  const signatureArray = (r, chosen = null) => { const certificates = chosen ?? r.apkSigningCertificates?.() ?? [], array = r.newArray(SIGNATURES, certificates.length); r.array(array).elements = certificates.map(der => newSignature(r, der)); return array; };
  const hex = bytes => Array.from(bytes, v => (v & 0xff).toString(16).padStart(2, '0')).join('');
  def(SIGNATURE, '<init>', '([B)V', (r, _m, [self, bytes]) => { if (bytes === null) r.throwJava('Ljava/lang/NullPointerException;', null); r.object(self).signatureBytes = Int8Array.from(r.array(bytes).elements); });
  def(SIGNATURE, '<init>', `(${STRING})V`, (r, _m, [self, text]) => {
    const value = r.stringCharacters(text); if (value.length % 2 || /[^0-9a-fA-F]/.test(value)) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid character in signature: ${value}`);
    r.object(self).signatureBytes = Int8Array.from(value.match(/../g) ?? [], pair => (parseInt(pair, 16) << 24) >> 24);
  });
  def(SIGNATURE, 'toByteArray', '()[B', (r, _m, [self]) => byteArray(r, bytesOf(r, self)));
  def(SIGNATURE, 'toCharsString', `()${STRING}`, (r, _m, [self]) => hex(bytesOf(r, self)));
  def(SIGNATURE, 'toChars', '()[C', (r, _m, [self]) => { const text = hex(bytesOf(r, self)), array = r.newArray('[C', text.length); r.array(array).elements = [...text].map(c => c.charCodeAt(0)); return array; });
  def(SIGNATURE, 'hashCode', '()I', (r, _m, [self]) => { let h = 1; for (const v of bytesOf(r, self)) h = (Math.imul(31, h) + v) | 0; return h; });
  def(SIGNATURE, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => { if (other === null || typeof other !== 'object' || r.object(other).type !== SIGNATURE) return 0; const a = bytesOf(r, self), b = bytesOf(r, other); return a.length === b.length && a.every((v, i) => v === b[i]) ? 1 : 0; });
  def(SIGNING_INFO, 'getApkContentsSigners', `()${SIGNATURES}`, (r, _m, [self]) => r.object(self).signers);
  def(SIGNING_INFO, 'getSigningCertificateHistory', `()${SIGNATURES}`, (r, _m, [self]) => r.object(self).signers);   // no key rotation recorded: history = current signers
  def(SIGNING_INFO, 'hasMultipleSigners', '()Z', (r, _m, [self]) => r.array(r.object(self).signers).elements.length > 1 ? 1 : 0);
  def(SIGNING_INFO, 'hasPastSigningCertificates', '()Z', () => 0);

  // ---- PackageManager.getPackageInfo (only this package is installed; Play Services and every other package are NameNotFoundException) -----------
  const PACKAGE_INFO = 'Landroid/content/pm/PackageInfo;', installTime = Date.now();
  type(PACKAGE_INFO, OBJECT, [], { allocatable: true });
  for (const [name, ftype] of [['packageName', STRING], ['versionName', STRING], ['versionCode', 'I'], ['longVersionCode', 'J'], ['firstInstallTime', 'J'], ['lastUpdateTime', 'J'], ['applicationInfo', APPLICATION_INFO], ['requestedPermissions', '[Ljava/lang/String;'], ['signatures', '[Landroid/content/pm/Signature;'], ['signingInfo', 'Landroid/content/pm/SigningInfo;'], ['services', '[Landroid/content/pm/ServiceInfo;'], ['providers', '[Landroid/content/pm/ProviderInfo;']]) registry.instanceField(PACKAGE_INFO, name, ftype, { reflect: true });
  def(PACKAGE_INFO, 'getLongVersionCode', '()J', (r, _m, [self]) => r.object(self).fields.get(`${PACKAGE_INFO}->longVersionCode:J`) ?? 0n);
  // API 33 PackageManager.PackageInfoFlags.of(long) + getPackageInfo(String, PackageInfoFlags): the same lookup with the flag value taken from the holder.
  const INFO_FLAGS = 'Landroid/content/pm/PackageManager$PackageInfoFlags;'; type(INFO_FLAGS, OBJECT, [], { allocatable: true });
  def(INFO_FLAGS, 'of', `(J)${INFO_FLAGS}`, (r, _m, [value]) => { const holder = r.makeObject(INFO_FLAGS); r.object(holder).flagsValue = BigInt(value); return holder; }, { static: true });
  def(INFO_FLAGS, 'getValue', '()J', (r, _m, [self]) => r.object(self).flagsValue ?? 0n);
  // API 33 PackageManager.ApplicationInfoFlags.of(long) + getApplicationInfo(String, ApplicationInfoFlags): only this package is installed;
  // GET_META_DATA (128) decides whether metaData is filled, as in getApplicationInfo(String, int).
  const APP_INFO_FLAGS = 'Landroid/content/pm/PackageManager$ApplicationInfoFlags;'; type(APP_INFO_FLAGS, OBJECT, [], { allocatable: true });
  def(APP_INFO_FLAGS, 'of', `(J)${APP_INFO_FLAGS}`, (r, _m, [value]) => { const holder = r.makeObject(APP_INFO_FLAGS); r.object(holder).flagsValue = BigInt(value); return holder; }, { static: true });
  def(APP_INFO_FLAGS, 'getValue', '()J', (r, _m, [self]) => r.object(self).flagsValue ?? 0n);
  // ---- the packages of the virtual device ------------------------------------------------------------------------------------------------------------
  // A stock Android 13 image without Google services: this app plus a small, generic set of system packages (framework resources, System UI, the AOSP launcher). Nothing else is installed (no store,
  // no root or hooking framework). System packages carry what the image would: FLAG_SYSTEM, a /system* code path, the platform version, no installer, and the signer of a release-keys build: the
  // platform certificate of the image's maker, here the lab's own platform key (src/device-identity.js; framework-aosp/device-identity/lab-platform.x509.pem, src/platform-certificate-data.js:
  // only the certificate exists, nothing can be signed as this platform), never AOSP's public test key or another maker's. Their components and permission lists are
  // not modeled (activities / services / requestedPermissions stay null). Package visibility (API 30+) applies: an app targeting 30 or later without QUERY_ALL_PACKAGES sees itself and the
  // always-visible "android" package; <queries> declarations are not parsed, so packages they would add are not listed.
  const SYSTEM_PACKAGES = [
    { name: 'android', uid: () => 1000, label: 'Android System', sourceDir: '/system/framework/framework-res.apk', dataDir: '/data/system', process: 'system', flags: 1 | 4 | 8 | (1 << 23), always: true },
    { name: 'com.android.systemui', uid: app => app === 10037 ? 10039 : 10037, label: 'System UI', sourceDir: '/system_ext/priv-app/SystemUI/SystemUI.apk', process: 'com.android.systemui', flags: 1 | 4 | 8 | (1 << 23) },
    { name: 'com.android.launcher3', uid: app => app === 10038 ? 10040 : 10038, label: 'Quickstep', sourceDir: '/system_ext/priv-app/Launcher3QuickStep/Launcher3QuickStep.apk', process: 'com.android.launcher3', flags: 1 | 4 | 0x40 | (1 << 23) },
  ];
  let platformDer = null;
  const platformCertificate = () => platformDer ??= Uint8Array.from(atob(PLATFORM_CERTIFICATE_BASE64), c => c.charCodeAt(0));
  const systemInfos = new WeakMap();
  const systemApplicationInfo = (r, entry) => {
    const cache = systemInfos.get(r) ?? systemInfos.set(r, gcRoot(new Map())).get(r);   // a collector root: the cached ApplicationInfo objects are handed out again (a WeakMap's values are invisible to the collector)
    if (cache.has(entry.name)) return cache.get(entry.name);
    const info = r.makeObject(APPLICATION_INFO), put = (name, type, value) => platform.infoField(r, info, APPLICATION_INFO, name, type, value), data = entry.dataDir ?? `/data/user/0/${entry.name}`;
    put('packageName', STRING, entry.name); put('name', STRING, null); put('processName', STRING, entry.process); put('taskAffinity', STRING, entry.name); put('uid', 'I', entry.uid(platform.virtualProcess.uid));
    put('labelRes', 'I', 0); put('nonLocalizedLabel', 'Ljava/lang/CharSequence;', entry.label); put('icon', 'I', 0); put('theme', 'I', 0);
    put('sourceDir', STRING, entry.sourceDir); put('publicSourceDir', STRING, entry.sourceDir); put('dataDir', STRING, data); put('deviceProtectedDataDir', STRING, entry.dataDir ? entry.dataDir : `/data/user_de/0/${entry.name}`); put('credentialProtectedDataDir', STRING, data); put('nativeLibraryDir', STRING, null);
    put('flags', 'I', entry.flags); put('targetSdkVersion', 'I', 33); put('minSdkVersion', 'I', 33); put('enabled', 'Z', 1);
    cache.set(entry.name, info); return info;
  };
  const targetSdk = () => Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1);
  /** The package a PackageManager call is made for: the package whose code calls it (src/package-registry.js), the app when no companion is installed. */
  const pmCaller = r => pkgs()?.multi ? pkgs().callerEntry(r) : null;
  const seesAll = (r, caller = null) => caller && !caller.main ? pkgs().targetSdk(caller) < 30 || pkgs().holds(r, caller, 'android.permission.QUERY_ALL_PACKAGES') : targetSdk() < 30 || holdsPermission(r, 'android.permission.QUERY_ALL_PACKAGES');
  /**
   * The installed, visible packages in install order: [{ name, system, entry }] -- the caller, the system packages it can see, then the other installed packages
   * (the app and the companions, src/package-registry.js) that package visibility lets it see.
   */
  const packages = r => {
    const caller = pmCaller(r), own = caller ?? { name: appPkg(), main: true };
    const list = [{ name: own.name, system: null, entry: caller }, ...SYSTEM_PACKAGES.filter(entry => seesAll(r, caller) || entry.always).map(entry => ({ name: entry.name, system: entry }))];
    if (caller) for (const other of pkgs().entries()) if (other !== caller && pkgs().visible(r, caller, other)) list.push({ name: other.name, system: null, entry: other });
    return list;
  };
  const findPackage = (r, name) => packages(r).find(entry => entry.name === name) ?? r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', name);
  const companionEntry = e => e.entry && !e.entry.main ? e.entry : null;
  const applicationInfoOf = (r, entry, meta) => entry.system ? systemApplicationInfo(r, entry.system) : companionEntry(entry) ? pkgs().applicationInfoFor(r, entry.entry, meta) : platform.applicationInfo(r, meta);
  const holderValue = (r, holder) => holder === null ? 0n : r.object(holder).flagsValue ?? 0n;
  const getApplicationInfo = (r, name, flags) => { const n = text(r, name); return applicationInfoOf(r, findPackage(r, n), (Number(BigInt.asIntN(32, BigInt(flags))) & 128) !== 0); };
  def(PACKAGE_MANAGER, 'getApplicationInfo', `(${STRING}${APP_INFO_FLAGS})${APPLICATION_INFO}`, (r, _m, [, name, flags]) => getApplicationInfo(r, name, holderValue(r, flags)));
  def(PACKAGE_MANAGER, 'getApplicationInfo', `(${STRING}I)${APPLICATION_INFO}`, (r, _m, [, name, flags]) => getApplicationInfo(r, name, flags));
  const packageInfoFor = (r, entry, flags) => {
    const other = companionEntry(entry);
    const info = r.allocate(PACKAGE_INFO), put = (name2, ftype, value) => r.storeField(r.object(info).fields, `${PACKAGE_INFO}->${name2}:${ftype}`, value), attrs = (other ? other.manifest : platform.manifest)?.manifestAttrs ?? {};
    const system = entry.system, code = system ? 33 : Number(attrs.versionCode ?? 0) | 0;
    put('packageName', STRING, entry.name); put('versionName', STRING, system ? '13' : typeof attrs.versionName === 'string' ? attrs.versionName : null); put('versionCode', 'I', code); put('longVersionCode', 'J', BigInt(code));
    put('installLocation', 'I', Number.isInteger(attrs.installLocation) && !system ? attrs.installLocation : -1);   // android:installLocation, else INSTALL_LOCATION_UNSPECIFIED
    put('firstInstallTime', 'J', BigInt(installTime)); put('lastUpdateTime', 'J', BigInt(installTime)); put('applicationInfo', APPLICATION_INFO, applicationInfoOf(r, entry, (flags & 128) !== 0));
    if (system) {   // GET_SIGNATURES / GET_SIGNING_CERTIFICATES of a system package: the platform certificate of the build
      const certificates = [platformCertificate()];
      if (flags & 0x40) put('signatures', SIGNATURES, signatureArray(r, certificates));
      if (flags & 0x08000000) { const signing = r.allocate(SIGNING_INFO); r.object(signing).signers = signatureArray(r, certificates); put('signingInfo', SIGNING_INFO, signing); }
    }
    if (!system) {
      // GET_SIGNATURES (0x40) / GET_SIGNING_CERTIFICATES (0x08000000): the APK's real signer certificates (v3, v2 or v1 block).
      const certificates = other ? pkgs().signingCertificatesOf(r, other) : null;
      if (flags & 0x40) put('signatures', SIGNATURES, signatureArray(r, certificates));
      if (flags & 0x08000000) { const signing = r.allocate(SIGNING_INFO); r.object(signing).signers = signatureArray(r, certificates); put('signingInfo', SIGNING_INFO, signing); }
      if (other) {   // GET_SERVICES (4) / GET_PROVIDERS (8) / GET_PERMISSIONS (0x1000) of a companion package
        if (flags & 4) { const details = pkgs().detailsOf(other, 'service'), array = r.newArray(`[${SERVICE_INFO}`, details.length); r.array(array).elements = details.map(d => makeInfo(r, d, 'service', (flags & 128) !== 0, other)); put('services', `[${SERVICE_INFO}`, array); }
        if (flags & 8) { const details = (other.manifest.providerDetails ?? []), array = r.newArray(`[${PROVIDER_INFO}`, details.length); r.array(array).elements = details.map(d => makeProviderInfo(r, d, (flags & 128) !== 0, other)); put('providers', `[${PROVIDER_INFO}`, array); }
      }
      // GET_PERMISSIONS (0x1000): the <uses-permission> names in manifest order, and requestedPermissionsFlags with REQUESTED_PERMISSION_GRANTED (2) for those the package holds
      if (flags & 0x1000) {
        const names = [...new Set(((other ? other.manifest : platform.manifest)?.usesPermissions ?? []).map(p => p.name))];
        if (names.length) {
          const array = r.newArray('[Ljava/lang/String;', names.length); r.array(array).elements = names; put('requestedPermissions', '[Ljava/lang/String;', array);
          const granted = r.newArray('[I', names.length); r.array(granted).elements = names.map(name => (other ? pkgs().holds(r, other, name) : holdsPermission(r, name)) ? 2 : 0); put('requestedPermissionsFlags', '[I', granted);
        }
      }
    }
    return info;
  };
  const packageInfoDef = (r, _m, [, name, flags]) => packageInfoFor(r, findPackage(r, text(r, name)), flags);

  def(PACKAGE_MANAGER, 'getPackageInfo', `(${STRING}I)${PACKAGE_INFO}`, packageInfoDef);
  def(PACKAGE_MANAGER, 'getPackageInfo', `(${STRING}${INFO_FLAGS})${PACKAGE_INFO}`, (r, m, [self, name, holder]) => { if (holder === null) r.throwJava('Ljava/lang/NullPointerException;', 'flags'); return packageInfoDef(r, m, [self, name, Number(BigInt.asIntN(32, r.object(holder).flagsValue ?? 0n))]); });

  // PackageManager listings: the same package set, ApplicationInfo / PackageInfo objects as getApplicationInfo / getPackageInfo return for each name.
  const MATCH_SYSTEM_ONLY = 0x00100000;
  const listPackages = (r, flags, build) => {
    const list = newEmptyList(r);
    for (const entry of packages(r)) {
      if ((flags & MATCH_SYSTEM_ONLY) && !entry.system) continue;
      r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, build(entry)], 'virtual');
    }
    return list;
  };
  const int32 = value => Number(BigInt.asIntN(32, BigInt(value)));
  def(PACKAGE_MANAGER, 'getInstalledApplications', '(I)Ljava/util/List;', (r, _m, [, flags]) => listPackages(r, flags, entry => applicationInfoOf(r, entry, (flags & 128) !== 0)));
  def(PACKAGE_MANAGER, 'getInstalledApplications', `(${APP_INFO_FLAGS})Ljava/util/List;`, (r, _m, [, holder]) => { const flags = int32(holderValue(r, holder)); return listPackages(r, flags, entry => applicationInfoOf(r, entry, (flags & 128) !== 0)); });
  def(PACKAGE_MANAGER, 'getInstalledPackages', '(I)Ljava/util/List;', (r, _m, [, flags]) => listPackages(r, flags, entry => packageInfoFor(r, entry, flags)));
  def(PACKAGE_MANAGER, 'getInstalledPackages', `(${INFO_FLAGS})Ljava/util/List;`, (r, _m, [, holder]) => { const flags = int32(holderValue(r, holder)); return listPackages(r, flags, entry => packageInfoFor(r, entry, flags)); });
  // getPackagesHoldingPermissions: the packages holding at least one of the permissions. Only this app's permissions are modeled, so system packages never match.
  const holding = (r, permissions, flags) => {
    if (permissions === null) r.throwJava('Ljava/lang/NullPointerException;', 'permissions');
    const wanted = r.array(permissions).elements.map(name => text(r, name)), list = newEmptyList(r);
    if (wanted.some(name => holdsPermission(r, name))) r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, packageInfoFor(r, packages(r)[0], flags)], 'virtual');
    return list;
  };
  def(PACKAGE_MANAGER, 'getPackagesHoldingPermissions', '([Ljava/lang/String;I)Ljava/util/List;', (r, _m, [, permissions, flags]) => holding(r, permissions, flags));
  def(PACKAGE_MANAGER, 'getPackagesHoldingPermissions', `([Ljava/lang/String;${INFO_FLAGS})Ljava/util/List;`, (r, _m, [, permissions, holder]) => holding(r, permissions, int32(holderValue(r, holder))));
  const uidOf = (r, entry) => entry.system ? entry.system.uid(platform.virtualProcess.uid) : entry.entry ? entry.entry.uid : platform.virtualProcess.uid;
  def(PACKAGE_MANAGER, 'getPackageUid', `(${STRING}I)I`, (r, _m, [, name]) => uidOf(r, findPackage(r, text(r, name))));
  def(PACKAGE_MANAGER, 'getPackageUid', `(${STRING}${INFO_FLAGS})I`, (r, _m, [, name]) => uidOf(r, findPackage(r, text(r, name))));
  def(PACKAGE_MANAGER, 'getPackagesForUid', '(I)[Ljava/lang/String;', (r, _m, [, uid]) => {
    const names = packages(r).filter(entry => uidOf(r, entry) === uid).map(entry => entry.name); if (!names.length) return null;
    const array = r.newArray('[Ljava/lang/String;', names.length); r.array(array).elements = names; return array;
  });
  def(PACKAGE_MANAGER, 'getNameForUid', `(I)${STRING}`, (r, _m, [, uid]) => { const entry = packages(r).find(candidate => uidOf(r, candidate) === uid); return entry ? (uid === 1000 ? 'android.uid.system:1000' : entry.name) : null; });
  // API 33 ResolveInfoFlags overloads of the query/resolve calls: the flag value is the same long.
  const RESOLVE_FLAGS = 'Landroid/content/pm/PackageManager$ResolveInfoFlags;'; type(RESOLVE_FLAGS, OBJECT, [], { allocatable: true });
  def(RESOLVE_FLAGS, 'of', `(J)${RESOLVE_FLAGS}`, (r, _m, [value]) => { const holder = r.makeObject(RESOLVE_FLAGS); r.object(holder).flagsValue = BigInt(value); return holder; }, { static: true });
  def(RESOLVE_FLAGS, 'getValue', '()J', (r, _m, [self]) => r.object(self).flagsValue ?? 0n);
  for (const [name, kind] of [['queryIntentActivities', 'activity'], ['queryIntentServices', 'service'], ['queryBroadcastReceivers', 'receiver']]) {
    def(PACKAGE_MANAGER, name, `(${INTENT_TYPE}${RESOLVE_FLAGS})Ljava/util/List;`, (r, _m, [, intent, holder]) => resolveInfos(r, intent, kind, (int32(holderValue(r, holder)) & 128) !== 0));
  }

  // The lab installs the APK itself: no store recorded it, so the installer package is null (what adb/sideloaded installs report).
  def(PACKAGE_MANAGER, 'checkPermission', `(${STRING}${STRING})I`, (r, _m, [, permission, name]) => { const permissionName = needPermission(r, permission); if (name === null) r.throwJava('Ljava/lang/NullPointerException;', null); return (() => { const n = text(r, name), target = pkgs()?.multi ? packages(r).find(e => e.name === n && e.entry) : null; return target ? (holdsFor(r, target.entry, permissionName) ? PERMISSION_GRANTED : PERMISSION_DENIED) : n === appPkg() && holdsPermission(r, permissionName) ? PERMISSION_GRANTED : PERMISSION_DENIED; })(); });   // the app, or a visible companion package (src/package-registry.js)
  // PackageManager.getApplicationLabel / ApplicationInfo.loadLabel: nonLocalizedLabel, else the string behind labelRes, else the package name (ApplicationInfo.loadLabel in PackageItemInfo.java).
  const loadLabel = (r, info) => {
    const fields = r.object(info).fields, literal = fields.get(`${ITEM_INFO}->nonLocalizedLabel:Ljava/lang/CharSequence;`) ?? null, resource = fields.get(`${ITEM_INFO}->labelRes:I`) ?? 0;
    if (literal !== null && literal !== 0) return literal;
    // the label resource is one of the package's own table (each installed package's ids start at 0x7f): resolved with that package's resources in scope
    const owner = fields.get(`${ITEM_INFO}->packageName:Ljava/lang/String;`) ?? appPkg(), entry = pkgs()?.multi ? pkgs().byName(typeof owner === 'string' ? owner : r.stringCharacters(owner)) : null;
    if (resource) { try { const value = entry ? platform.withPackageResources(r, entry, () => platform.resource(resource, ['string']).value) : platform.resource(resource, ['string']).value; if (typeof value === 'string') return value; } catch { /* unresolvable label: fall through to the package name */ } }
    return owner;
  };
  def(PACKAGE_MANAGER, 'isInstantApp', '()Z', () => 0); def(PACKAGE_MANAGER, 'isInstantApp', `(${STRING})Z`, () => 0);   // an installed APK is never an instant app
  def(PACKAGE_MANAGER, 'getApplicationLabel', `(${APPLICATION_INFO})Ljava/lang/CharSequence;`, (r, _m, [, info]) => { if (info === null) r.throwJava('Ljava/lang/NullPointerException;', null); return loadLabel(r, info); });
  def(APPLICATION_INFO, 'loadLabel', `(${PACKAGE_MANAGER})Ljava/lang/CharSequence;`, (r, _m, [info]) => loadLabel(r, info));
  // The hidden partition queries of ApplicationInfo (isSystemApp: FLAG_SYSTEM; the rest read privateFlags PRIVATE_FLAG_PRIVILEGED/OEM/VENDOR/PRODUCT/SYSTEM_EXT/ODM, which no
  // package of the virtual device has: every package is on the data partition, and a device option's preinstalled packages are not given partition flags either).
  def(APPLICATION_INFO, 'isSystemApp', '()Z', (r, _m, [info]) => (Number(r.object(info).fields.get(`${APPLICATION_INFO}->flags:I`) ?? 0) & 1) ? 1 : 0);
  for (const name of ['isPrivilegedApp', 'isOem', 'isVendor', 'isProduct', 'isSystemExt', 'isOdm']) def(APPLICATION_INFO, name, '()Z', () => 0);
  // isInstantApp() (hidden): privateFlags & PRIVATE_FLAG_INSTANT (1 << 7); an installed APK is never an instant app, so the flag is clear unless the object was given it
  def(APPLICATION_INFO, 'isInstantApp', '()Z', (r, _m, [info]) => (Number(r.object(info).fields.get(`${APPLICATION_INFO}->privateFlags:I`) ?? 0) & 0x80) ? 1 : 0);
  def(PACKAGE_MANAGER, 'getInstallerPackageName', `(${STRING})${STRING}`, (r, _m, [, name]) => { const n = text(r, name); if (n !== appPkg() && !(pkgs()?.multi && packages(r).some(e => e.name === n && e.entry))) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Unknown package: ' + n); return null; });   // companions are installed by the lab too

  // PackageManager.queryIntentContentProviders: the virtual device has one installed package (this app), no Play Services and no system font
  // provider, so an action (e.g. androidx.content.action.FONT_PROVIDER) resolves only to providers this app declares for it.
  def(PACKAGE_MANAGER, 'queryIntentContentProviders', `(Landroid/content/Intent;I)Ljava/util/List;`, (r, _m, [, intent]) => {
    const action = r.dispatch({ owner: 'Landroid/content/Intent;', name: 'getAction', parameters: [], result: STRING, signature: `()${STRING}` }, [intent], 'virtual');
    const matches = (platform.manifest?.providerDetails ?? []).filter(p => action !== null && p.actions?.includes(r.stringCharacters(action)));
    if (matches.length) throw new APKError(`queryIntentContentProviders(${r.stringCharacters(action)}) matches ${matches.length} provider(s) of this app; ResolveInfo transport is not implemented`, { kind: 'resolve-info-unsupported' });
    const list = newEmptyList(r);
    for (const system of platform.sharedStorage?.documentsProviders(r, action === null ? null : r.stringCharacters(action)) ?? []) r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, system], 'virtual');   // the device's documents providers (src/shared-storage-host.js)
    return list;
  });
  function newEmptyList(r) { const list = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct'); return list; }

  // ---- PackageManager.getProviderInfo ---------------------------------------------------------------------------------------------------------
  def(PACKAGE_MANAGER, 'getProviderInfo', `(Landroid/content/ComponentName;I)${PROVIDER_INFO}`, (r, _m, [, component, flags]) => {
    const found = packageComponent(r, r.object(component), 'provider'); if (found) return makeProviderInfo(r, found.detail, (flags & 128) !== 0, found.owner);
    const c = r.object(component), detail = (platform.manifest?.providerDetails ?? []).find(p => p.name === c.className);
    if (c.packageName !== pkg() || !detail) r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', `ComponentInfo{${c.packageName}/${c.className}}`);
    return makeProviderInfo(r, detail, (flags & 128) !== 0);
  });

  // PackageManager.resolveContentProvider(authority, flags): only this app's enabled providers exist on the virtual device (no system providers), so any other authority is null.
  def(PACKAGE_MANAGER, 'resolveContentProvider', `(${STRING}I)${PROVIDER_INFO}`, (r, _m, [, authority, flags]) => {
    const wanted = text(r, authority);
    if (pkgs()?.multi) {   // every installed package's providers, as the caller can see them
      const caller = pmCaller(r), found = pkgs().providerFor(wanted);
      if (!found || !pkgs().visible(r, caller, found.entry)) return null;
      return makeProviderInfo(r, found.detail, (flags & 128) !== 0, found.entry);
    }
    const detail = (platform.manifest?.providerDetails ?? []).find(p => !isFalse(p.enabled) && String(p.authorities ?? '').split(';').includes(wanted));
    return detail ? makeProviderInfo(r, detail, (flags & 128) !== 0) : null;
  });

  /**
   * ActivityThread.installContentProviders for handleBindApplication: providers of this process (process attribute equal to the app's), enabled,
   * ordered by initOrder descending (manifest order among equals); each is instantiated, attachInfo()'d (which runs onCreate) with the Application
   * as Context. A provider failure aborts startup as RuntimeException("Unable to get provider ...") does on a device.
   */
  const installedProviders = gcRoot(new Map());   // ActivityThread.mProviderMap keeps every installed provider alive for the life of the process
  function installContentProviders(runtime) {
    const details = (platform.manifest?.providerDetails ?? []).filter(p => !isFalse(p.enabled) && providerProcess(p) === processName());
    details.sort((a, b) => (Number(b.initOrder) | 0) - (Number(a.initOrder) | 0) || a.order - b.order);
    const skipped = (platform.manifest?.providerDetails ?? []).length - details.length;
    runtime.record(`PROVIDERS install ${details.length} (skipped ${skipped}: other process or disabled) in initOrder`);
    for (const detail of details) {
      const className = 'L' + detail.name.replaceAll('.', '/') + ';';
      if (!runtime.classes.has(className) || !runtime.isSubtype(className, CP)) throw new APKError(`Unable to get provider ${detail.name}: class not found or not a ContentProvider`, { kind: 'provider-class' });
      const instance = runtime.allocate(className); installedProviders.set(detail.name, instance);
      if (pkgs()?.multi) runtime.object(instance).providerPackage = pkgs().main;   // another installed package's calls to it are cross-package transactions (src/content-resolver-api-host.js)
      runtime.dispatch({ owner: className, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [instance], 'direct');
      runtime.record(`PROVIDERS attachInfo ${detail.name} (initOrder ${Number(detail.initOrder) | 0})`);
      runtime.dispatch({ owner: CP, name: 'attachInfo', parameters: [CONTEXT, PROVIDER_INFO], result: 'V', signature: `(${CONTEXT}${PROVIDER_INFO})V` }, [instance, platform.application, makeProviderInfo(runtime, detail, true)], 'virtual');
    }
  }

  /**
   * ActivityThread.installContentProviders(Context, List<ProviderInfo>) called by the app itself (a plugin or split loader installing providers the manifest does not list):
   * each provider not installed yet is instantiated from its ProviderInfo.name, attachInfo()'d with the given Context and info (onCreate runs), and answers its authorities.
   */
  const installedByAuthority = new Map();
  def('Landroid/app/ActivityThread;', 'installContentProviders', `(${CONTEXT}Ljava/util/List;)V`, (r, _m, [, context, list]) => {
    if (list === null) return;
    const size = r.dispatch({ owner: 'Ljava/util/List;', name: 'size', parameters: [], result: 'I', signature: '()I' }, [list], 'virtual');
    for (let i = 0; i < size; i++) {
      const info = r.dispatch({ owner: 'Ljava/util/List;', name: 'get', parameters: ['I'], result: OBJECT, signature: `(I)${OBJECT}` }, [list, i], 'virtual');
      const fields = r.object(info).fields, read = (owner, name) => { const v = fields.get(`${owner}->${name}:${STRING}`); return v === null || v === undefined ? null : text(r, v); };
      const name = read(ITEM_INFO, 'name'), authority = read(PROVIDER_INFO, 'authority');
      if (!name) r.throwJava('Ljava/lang/NullPointerException;', 'ProviderInfo.name');
      if (installedProviders.has(name)) continue;   // installProvider: an existing local provider is reused
      const className = 'L' + name.replaceAll('.', '/') + ';';
      r.resolveClass?.(name, false);
      if (!r.classes.has(className) || !r.isSubtype(className, CP)) r.throwJava('Ljava/lang/RuntimeException;', `Unable to get provider ${name}: java.lang.ClassNotFoundException: ${name}`);
      const instance = r.allocate(className); installedProviders.set(name, instance);
      r.record(`PROVIDERS installContentProviders (called by the app) ${name}${authority ? ` authority ${authority}` : ''}`);
      r.dispatch({ owner: className, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [instance], 'direct');
      r.dispatch({ owner: CP, name: 'attachInfo', parameters: [CONTEXT, PROVIDER_INFO], result: 'V', signature: `(${CONTEXT}${PROVIDER_INFO})V` }, [instance, context, info], 'virtual');
      for (const each of String(authority ?? '').split(';').filter(Boolean)) if (!installedByAuthority.has(each)) installedByAuthority.set(each, name);
    }
  });

  /** installContentProviders for a companion package's process (src/package-registry.js ensureProcess): the same order, its class loader, its Application as Context. */
  function installPackageProviders(runtime, entry) {
    const details = (entry.manifest.providerDetails ?? []).filter(p => !isFalse(p.enabled));
    details.sort((a, b) => (Number(b.initOrder) | 0) - (Number(a.initOrder) | 0) || a.order - b.order);
    runtime.record(`PROVIDERS install ${details.length} of ${entry.name} in initOrder (one VM process for all its android:process names)`);
    for (const detail of details) installPackageProvider(runtime, entry, detail);
  }
  /**
   * ActivityThread.installProvider for one provider of a companion: instantiated once and kept (mLocalProvidersByName). A provider whose onCreate reaches a sibling provider
   * of its own process that installContentProviders has not reached yet gets that sibling installed right then, and the later loop reuses the same instance.
   */
  function installPackageProvider(runtime, entry, detail) {
    const existing = entry.providers.get(detail.name); if (existing) return existing;
    const type = pkgs().typeIn(runtime, entry, detail.name);
    if (!type || !runtime.isSubtype(type, CP)) throw new APKError(`Unable to get provider ${detail.name} of ${entry.name}: class not found or not a ContentProvider`, { kind: 'provider-class' });
    const instance = runtime.allocate(type); entry.providers.set(detail.name, instance); pkgs().refs.set(`${entry.name}:provider:${detail.name}`, instance);
    runtime.object(instance).providerPackage = entry;
    runtime.dispatch({ owner: type, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [instance], 'direct');
    runtime.dispatch({ owner: CP, name: 'attachInfo', parameters: [CONTEXT, PROVIDER_INFO], result: 'V', signature: `(${CONTEXT}${PROVIDER_INFO})V` }, [instance, pkgs().application(entry), makeProviderInfo(runtime, detail, true, entry)], 'virtual');
    return instance;
  }
  return { ...registry, [GC_ROOTS](visit) { visit(currentContext); }, interfaces: registry.interfacesOf, getService, metaDataBundle, installPackageProviders, installPackageProvider, holdsFor, serviceNameForClass: classType => serviceByClass.get(classType) ?? null, installContentProviders, providerByAuthority: authority => { const detail = (platform.manifest?.providerDetails ?? []).find(p => !isFalse(p.enabled) && String(p.authorities ?? '').split(';').includes(authority)); if (detail) return installedProviders.get(detail.name) ?? null; const added = installedByAuthority.get(authority); return added ? installedProviders.get(added) ?? null : null; }, preferenceInstances: instances, findPackage, packageAssets, packageNames: r => packages(r).map(entry => entry.name) };
}
