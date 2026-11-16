import { APKError } from './apk-error.js?v=49b0f144f57b';
import { gcRoot } from './heap-gc.js?v=49b0f144f57b';
import { FRAMEWORK_PERMISSIONS } from './permission-data.js?v=49b0f144f57b';
import { AndroidResources } from './android-resources.js?v=49b0f144f57b';

// The installed packages of the virtual device beyond the app being run (docs/MULTI-PACKAGE.md). Without a companion this registry is inert: `multi` is false and every
// caller keeps its single-package path, so a device with one package behaves exactly as before.
//
// A companion package lives in the same VM as the app. What Android gives each package and what stands for it here:
//  * its own code: a dalvik.system.PathClassLoader whose parent is the boot class loader (src/class-loader-host.js createPackageLoader). A class name both packages define is
//    defined again for the companion under a loader alias (Lfoo/Bar$$ldrN;), so each package's code binds to its own copy; a name only the app defines is not visible to the
//    companion's code (and the reverse);
//  * its own process: a uid (10001, 10002, ...) and pid, started lazily the first time one of its components is needed, as ActivityThread.handleBindApplication does:
//    Application.<init>, attachBaseContext, its ContentProviders (ActivityThread.installContentProviders), Application.onCreate;
//  * its own Context: a ContextImpl carrying the package (getPackageName, getApplicationInfo, getClassLoader, data directories, SharedPreferences and assets of that package);
//  * its own identity on the Binder: which package a thread is executing for is the package of the nearest stack frame that is not framework code (the defining loader of the
//    frame's class), and a transaction between packages records the caller's uid/pid for Binder.getCallingUid/getCallingPid, per thread.
// The two packages share one Java heap, one main Looper and one set of system services: a call between them runs on the calling thread (a Binder thread pool is not
// modelled) and a oneway call is a message on the main Looper.

const APPLICATION = 'Landroid/app/Application;', APP_CONTEXT = 'Landroid/app/ContextImpl;', APPLICATION_INFO = 'Landroid/content/pm/ApplicationInfo;', STRING = 'Ljava/lang/String;';
const PACKAGE_MANAGER = 'Landroid/content/pm/PackageManager;';
const FIRST_UID = 10001, FIRST_PID = 2;
const isFalse = value => value === false || value === 0 || value === 'false';
const isTrue = value => value === true || value === 0xffffffff || value === -1 || value === 'true' || (Number.isInteger(value) && value !== 0);
const descriptorOf = name => `L${name.replaceAll('.', '/')};`;
/** android:protectionLevel as PermissionInfo keeps it: the base level is the low four bits (normal 0, dangerous 1, signature 2, signatureOrSystem 3, internal 4). */
const baseLevel = value => typeof value === 'string' ? (/signature/.test(value) ? 2 : /dangerous/.test(value) ? 1 : /internal/.test(value) ? 4 : 0) : (Number(value) | 0) & 0xf;
const LEVEL_NAMES = ['normal', 'dangerous', 'signature', 'signatureOrSystem', 'internal'];

export function createPackageRegistry(platform) {
  const companions = new Map();             // packageName -> entry, install order
  const refs = gcRoot(new Map());           // Java values the registry keeps alive: `${package}:application`, `${package}:context`, `${package}:loader`, providers, services
  const grants = new Set();                 // AppsFilter.grantImplicitAccess: "viewer->visible" after the visible package interacted with the viewer's components
  const identities = new Map();             // thread -> stack of { caller, override } (the Binder transactions this thread is executing for another package)

  const main = {
    main: true,
    get name() { return platform.packageName; },
    get manifest() { return platform.manifest ?? {}; },
    get uid() { return platform.virtualProcess.uid; },
    get pid() { return platform.virtualProcess.pid; },
    signingCertificates: runtime => runtime?.apkSigningCertificates?.() ?? [],
  };

  const entries = () => [main, ...companions.values()];
  const byName = name => name === main.name ? main : companions.get(name) ?? null;
  const byUid = uid => entries().find(entry => entry.uid === uid) ?? null;
  const targetSdk = entry => Number(entry.manifest?.usesSdk?.targetSdkVersion ?? 1);

  // ---- installation ------------------------------------------------------------------------------------------------------------------------------------------------
  function install(spec) {
    if (byName(spec.packageName)) throw new APKError(`INSTALL_FAILED_DUPLICATE_PACKAGE: ${spec.packageName} is already installed`, { kind: 'duplicate-package' });
    const index = companions.size, fs = platform.javaIo.fs(), codePath = `/data/app/~~apkweb/${spec.packageName}-1`;
    // spec.system: preinstalled with the device (a device option's package), not installed by the user; spec.deviceOption names the option that installed it
    const entry = { ...spec, system: spec.system === true, deviceOption: spec.deviceOption ?? null, buildSigner: spec.buildSigner ?? null, main: false, name: spec.packageName, uid: FIRST_UID + index, pid: FIRST_PID + index, codePath, state: 'new', failure: null, assetManager: null, pm: null, loader: null, descriptors: new Map(), providers: new Map(), activityCallbacks: [] };
    fs.mkdirs(codePath); fs.mount(`${codePath}/base.apk`, spec.bytes); fs.readOnly.add(codePath);
    for (const dir of [`/data/user/0/${entry.name}`, `/data/user/0/${entry.name}/cache`, `/data/user/0/${entry.name}/code_cache`, `/data/user_de/0/${entry.name}`]) fs.mkdirs(dir);
    companions.set(entry.name, entry);
    return entry;
  }

  // ---- which package code runs for --------------------------------------------------------------------------------------------------------------------------------
  /** The package whose code defines class `owner` (null for framework and host classes). */
  const entryOfClass = (runtime, owner) => {
    const loader = runtime.classOwners?.get(owner);
    if (loader) {
      for (let x = loader, depth = 0; x && depth < 64; depth++) { const state = runtime.object(x).dexLoader; if (!state) break; if (state.packageEntry) return state.packageEntry; x = state.parent; }
      return main;   // a loader the app created at run time (DexClassLoader...)
    }
    if (runtime.dex?.bootClasses?.has(owner)) return null;
    return runtime.dex?.classes?.has(owner) ? main : null;
  };
  /** The package a thread is executing for now: the nearest frame whose class belongs to a package (framework frames are skipped), else the app. */
  const callerEntry = runtime => {
    if (!companions.size) return main;
    for (const method of runtime.captureStack?.() ?? []) { const owner = method?.owner; if (!owner) continue; const entry = entryOfClass(runtime, owner); if (entry) return entry; }
    return main;
  };
  /** The package a Context belongs to: the ContextImpl at the end of its baseContext chain records it; the app's contexts record none. */
  const contextEntry = (runtime, context) => {
    if (!companions.size) return main;
    for (let c = context, depth = 0; c && typeof c === 'object' && depth < 64; depth++) { const o = runtime.object(c); if (o.packageEntry) return o.packageEntry; c = o.baseContext ?? null; }
    return main;
  };

  // ---- Binder calling identity ------------------------------------------------------------------------------------------------------------------------------------
  const threadKey = runtime => runtime.thread ?? null;
  const stackOf = runtime => { const key = threadKey(runtime); let stack = identities.get(key); if (!stack) identities.set(key, stack = []); return stack; };
  /** Runs `fn` as a transaction from package `caller` (Binder.getCallingUid/Pid answer the caller's ids inside it). */
  const withCaller = (runtime, caller, fn) => {
    const stack = stackOf(runtime), frame = { caller, override: null }; stack.push(frame);
    try { return fn(); } finally { const at = stack.lastIndexOf(frame); if (at >= 0) stack.splice(at, 1); if (!stack.length) identities.delete(threadKey(runtime)); }
  };
  const callingIdentity = runtime => {
    const top = identities.get(threadKey(runtime))?.at(-1);
    if (top) return top.override ?? { uid: top.caller.uid, pid: top.caller.pid, entry: top.caller };
    const self = api.callerEntry(runtime); return { uid: self.uid, pid: self.pid, entry: self };
  };
  /** The package of the transaction this thread is serving, or null outside one (ContentProvider.getCallingPackage). */
  const callingPackage = runtime => { const top = identities.get(threadKey(runtime))?.at(-1); return top ? (top.override?.entry ?? top.caller).name : null; };
  /** Binder.clearCallingIdentity: the token encodes the identity ((long) uid << 32) | pid; the thread's calling identity becomes its own. */
  const clearCallingIdentity = runtime => {
    const identity = callingIdentity(runtime), token = (BigInt(identity.uid >>> 0) << 32n) | BigInt(identity.pid >>> 0);
    const top = identities.get(threadKey(runtime))?.at(-1); if (top) { const self = api.callerEntry(runtime); top.override = { uid: self.uid, pid: self.pid, entry: self }; }
    return BigInt.asIntN(64, token);
  };
  const restoreCallingIdentity = (runtime, token) => {
    const top = identities.get(threadKey(runtime))?.at(-1); if (!top) return;
    const value = BigInt.asUintN(64, BigInt(token)), uid = Number(value >> 32n), pid = Number(value & 0xffffffffn), entry = byUid(uid) ?? top.caller;
    top.override = uid === top.caller.uid && pid === top.caller.pid ? null : { uid, pid, entry };
  };

  // ---- class loading ----------------------------------------------------------------------------------------------------------------------------------------------
  const loaderOf = (runtime, entry) => {
    if (entry.main) return runtime.applicationClassLoader ??= platform.classLoaders.createApplicationLoader(runtime);
    if (!entry.loader) { entry.loader = platform.classLoaders.createPackageLoader(runtime, entry); refs.set(`${entry.name}:loader`, entry.loader); platform.onPackageCodeDefined?.(runtime, entry); }   // a device option that hooks the package's methods (src/microg-device.js) resolves their loader-alias keys now
    return entry.loader;
  };
  /** The VM class-table type of class `className` (dotted) as package `entry` sees it, or null when that package has no such class. */
  const typeIn = (runtime, entry, className) => {
    const plain = descriptorOf(className);
    if (entry.main) return runtime.classes.has(plain) && !runtime.classOwners?.has(plain) || runtime.dex?.bootClasses?.has(plain) ? plain : null;
    loaderOf(runtime, entry);
    return entry.descriptors.get(plain) ?? (runtime.dex?.bootClasses?.has(plain) ? plain : null);
  };

  // ---- contexts and the process -----------------------------------------------------------------------------------------------------------------------------------
  /** A new ContextImpl of package `entry` (ContextImpl.createAppContext): every Service gets its own; the Application's is kept. */
  const newContext = (runtime, entry) => { const context = runtime.makeObject(APP_CONTEXT), o = runtime.object(context); o.packageName = entry.name; o.packageEntry = entry; return context; };
  const baseContext = (runtime, entry) => refs.get(`${entry.name}:context`) ?? (refs.set(`${entry.name}:context`, newContext(runtime, entry)), refs.get(`${entry.name}:context`));
  const application = entry => entry.main ? platform.application : refs.get(`${entry.name}:application`) ?? null;
  /**
   * ActivityThread.handleBindApplication for a companion's process, run the first time one of its components is needed: its class loader, Application.<init> and
   * attachBaseContext, its ContentProviders in initOrder, then Application.onCreate. A failure is the process dying: the package stays failed and every later use names it.
   */
  function ensureProcess(runtime, entry) {
    if (entry.main) return;
    if (entry.state === 'started' || entry.state === 'starting') return;   // 'starting': a provider or the Application reaching its own package during start
    if (entry.state === 'failed') throw new APKError(`Process ${entry.name} failed to start: ${entry.failure?.message ?? entry.failure}`, { kind: 'package-process-failed' });
    entry.state = 'starting'; runtime.record(`PACKAGE start process ${entry.name} (uid ${entry.uid}, pid ${entry.pid})`);
    try {
      loaderOf(runtime, entry);
      const name = entry.manifest.applicationName, type = name ? typeIn(runtime, entry, name) : APPLICATION;
      if (name && (!type || !runtime.isSubtype(type, APPLICATION))) throw new APKError(`Unable to instantiate application ${name} of ${entry.name}: class not found or not an Application`, { kind: 'package-application' });
      const context = baseContext(runtime, entry), app = runtime.allocate(type);
      runtime.object(app).baseContext = context; runtime.object(app).packageEntry = entry; refs.set(`${entry.name}:application`, app);
      runtime.dispatch({ owner: type, name: '<init>', signature: '()V', parameters: [], result: 'V' }, [app], 'direct');
      runtime.dispatch({ owner: APPLICATION, name: 'attachBaseContext', signature: '(Landroid/content/Context;)V', parameters: ['Landroid/content/Context;'], result: 'V' }, [app, context], 'virtual');
      platform.appServices.installPackageProviders(runtime, entry);
      runtime.dispatch({ owner: type, name: 'onCreate', signature: '()V', parameters: [], result: 'V' }, [app], 'virtual');
      entry.state = 'started';
    } catch (failure) { entry.state = 'failed'; entry.failure = failure; throw failure; }
  }

  // ---- ApplicationInfo of a companion (PackageParser / PackageInfoUtils over its manifest) -------------------------------------------------------------------------
  const appInfos = gcRoot(new Map());
  function applicationInfoFor(runtime, entry, withMeta = true) {
    if (entry.main) return platform.applicationInfo(runtime, withMeta);
    const key = `${entry.name}:${withMeta ? 1 : 0}`; if (appInfos.has(key)) return appInfos.get(key);
    const app = entry.manifest.application ?? {}, info = runtime.makeObject(APPLICATION_INFO), put = (name, type, value) => platform.infoField(runtime, info, APPLICATION_INFO, name, type, value);
    if (withMeta) put('metaData', 'Landroid/os/Bundle;', metaData(runtime, entry, app.metaData ?? []));
    put('packageName', STRING, entry.name); put('name', STRING, entry.manifest.applicationName ?? null); put('className', STRING, entry.manifest.applicationName ?? null); put('theme', 'I', 0);
    put('labelRes', 'I', 0); put('nonLocalizedLabel', 'Ljava/lang/CharSequence;', typeof app.label === 'string' ? app.label : null); put('icon', 'I', 0);
    put('targetSdkVersion', 'I', targetSdk(entry)); put('minSdkVersion', 'I', Number(entry.manifest.usesSdk?.minSdkVersion || 1)); put('uid', 'I', entry.uid);
    const data = `/data/user/0/${entry.name}`, process = processOf(entry);
    for (const [name, value] of Object.entries({ sourceDir: `${entry.codePath}/base.apk`, publicSourceDir: `${entry.codePath}/base.apk`, dataDir: data, deviceProtectedDataDir: `/data/user_de/0/${entry.name}`, credentialProtectedDataDir: data, nativeLibraryDir: `${entry.codePath}/lib/wasm32`, processName: process, taskAffinity: entry.name })) put(name, STRING, value);
    put('flags', 'I', (isTrue(app.debuggable) ? 2 : 0) | (isFalse(app.hasCode) ? 0 : 4) | 0x40 | (1 << 23) | (isFalse(app.extractNativeLibs) ? 0 : (1 << 28)));
    put('enabled', 'Z', isFalse(app.enabled) ? 0 : 1); put('category', 'I', Number.isInteger(app.appCategory) ? app.appCategory : -1);
    appInfos.set(key, info); return info;
  }
  /** A companion's <meta-data>: literal values only; a value that names a resource needs the companion's resources, which are not loaded. */
  function metaData(runtime, entry, items) {
    return platform.appServices.metaDataBundle(runtime, items, id => resourceValue(entry, id));
  }
  /**
   * A value of the companion's own resources.arsc (parsed on first use, with the device's resource configuration; framework ids resolve in the framework table). Only what
   * PackageParser needs from it is used (manifest <meta-data> values); Context.getResources of a companion is not provided.
   */
  const resourceValue = (entry, id) => {
    if (entry.resourceTable === undefined) {
      entry.resourceTable = null;
      if (entry.entries.has('resources.arsc')) entry.resourceTable = new AndroidResources(entry.reader('resources.arsc'), { chooseConfiguration: platform.resourceSelector?.chooseConfiguration, resolveExternal: rid => ((Number(rid) >>> 24) === 1 ? platform.resources?.frameworkTable?.resolve?.(rid) ?? null : null) });
    }
    if (!entry.resourceTable) throw new APKError(`Resource 0x${(Number(id) >>> 0).toString(16)} of ${entry.name}: the package has no resources.arsc`, { kind: 'resource-unsupported' });
    const resolved = entry.resourceTable.resolve(id);
    if (resolved.kind === 'unresolved' || resolved.kind === 'bag') throw new APKError(`Resource 0x${(Number(id) >>> 0).toString(16)} of ${entry.name} cannot provide a scalar: ${resolved.reason || resolved.kind}`, { kind: 'resource-unsupported', resourceId: id });
    return resolved;
  };
  /**
   * The resource environment of a companion (the shape of the app's, src/apk-loader.js prepareResources): its own resources.arsc with the device configuration, framework
   * references resolved in the framework table, compiled XML parsed on first use. What Resources of a companion's Context read (android-platform.js withPackageResources).
   */
  const resourcesEnvironment = entry => {
    if (entry.resourcesEnvironment) return entry.resourcesEnvironment;
    if (entry.resourceTable === undefined) { try { resourceValue(entry, 0x7f000000); } catch { /* only builds the table */ } }
    const table = entry.resourceTable;
    if (!table) throw new APKError(`Resources of ${entry.name}: the package has no resources.arsc`, { kind: 'resource-unsupported' });
    const frameworkTable = platform.resources?.frameworkTable ?? null, trees = new Map();
    const xml = id => {
      const resource = table.resolve(id); let leaf = resource; while (leaf.resolved) leaf = leaf.resolved;
      if (resource.kind !== 'string' || typeof resource.value !== 'string') throw new APKError(`XML resource 0x${(Number(id) >>> 0).toString(16)} of ${entry.name} cannot be resolved: ${resource.reason ?? resource.kind}`, { kind: 'resource-unsupported', resourceId: Number(id) >>> 0 });
      if ((Number(id) >>> 24) === 1) return platform.resources.getXml(id);
      const path = resource.value; if (!entry.entries.has(path)) throw new APKError(`XML ${path} of ${entry.name} is not in the package`, { kind: 'resource-unsupported', resourceId: Number(id) >>> 0, path });
      if (!trees.has(path)) trees.set(path, table.parseLayout(entry.reader(path)));
      return trees.get(path);
    };
    entry.resourcesEnvironment = { table, layouts: new Map(), xmlTrees: trees, frameworkTable, frameworkXml: !!platform.resources?.frameworkXml, packageEntry: entry,
      resolve: id => table.resolve(id), resolveBag: id => table.resolveBag(id), getAttribute: (node, name) => table.getAttribute(node, name), getLayout: id => xml(id), getXml: id => xml(id) };
    return entry.resourcesEnvironment;
  };
  /** The Resources object of a companion's Contexts (one per package, as the Application's ResourcesImpl is shared by its Contexts). */
  const packageResources = (runtime, entry) => {
    const key = `${entry.name}:resources`; if (refs.has(key)) return refs.get(key);
    resourcesEnvironment(entry);
    const resources = runtime.makeObject('Landroid/content/res/Resources;'); runtime.object(resources).packageEntry = entry; refs.set(key, resources); return resources;
  };
  const processOf = (entry, detail = null) => {
    const declared = detail?.process ?? entry.manifest?.application?.process ?? null;   // all of a companion's android:process names share one VM process
    return declared ? (declared.startsWith(':') ? entry.name + declared : declared) : entry.name;
  };

  // ---- components ---------------------------------------------------------------------------------------------------------------------------------------------------
  const detailsOf = (entry, kind) => (entry.manifest?.componentDetails ?? []).filter(detail => detail.kind === kind);
  /** android:exported: the attribute, else (the pre-Android 12 default) whether the component has an intent filter; a provider defaults to not exported from API 17. */
  const exported = (entry, detail) => detail.exported !== undefined && detail.exported !== null ? isTrue(detail.exported) : detail.kind === 'provider' ? targetSdk(entry) < 17 : (detail.actions?.length ?? 0) > 0;
  const providerFor = authority => {
    for (const entry of entries()) for (const detail of entry.manifest?.providerDetails ?? []) if (!isFalse(detail.enabled) && String(detail.authorities ?? '').split(';').includes(authority)) return { entry, detail };
    return null;
  };
  const providerInstance = (runtime, entry, detail) => entry.main ? platform.appServices.providerByAuthority(String(detail.authorities).split(';')[0])
    : entry.providers.get(detail.name) ?? (entry.state === 'starting' ? platform.appServices.installPackageProvider(runtime, entry, detail) : null);   // a sibling reached during its own process start
  const providerOwners = new WeakMap();
  const providerOwner = (runtime, provider) => { const o = provider && typeof provider === 'object' ? runtime.object(provider) : null; return o?.providerPackage ?? null; };

  // ---- permissions ----------------------------------------------------------------------------------------------------------------------------------------------------
  /** The <permission> a package declares, with its declaring package. */
  const declaredPermission = name => { for (const entry of entries()) { const found = (entry.manifest?.declaredPermissions ?? []).find(p => p.name === name); if (found) return { entry, level: baseLevel(found.protectionLevel) }; } return null; };
  /**
   * The signer certificates (DER) PackageManager reports for a package: the ones in its APK's signing block (v3, v2, else v1; none for an unsigned APK). THE ONE HOOK for a
   * separately decided device option that supplies a package's signer certificates: `signerCertificateSource(entry, runtime)` returning an array of DER byte arrays, or
   * null/undefined to keep the APK's. It is null here; nothing in this module sets it.
   */
  const signingCertificatesOf = (runtime, entry) => api.signerCertificateSource?.(entry, runtime) ?? entry.signingCertificates(runtime);
  /**
   * Whether two packages have the same signers, as PackageManagerService decides it for signature permissions and checkSignatures: by the certificates of the APKs' own
   * signing blocks, never by the reported ones (a ROM with signature spoofing changes only what getPackageInfo reports, PackageManagerService keeps the real signatures).
   */
  const sameSigners = (runtime, a, b) => {
    // Packages a device option preinstalls are built here unsigned and installed as one system build signs them (one build key, entry.buildSigner): the same signer for each other
    // only, never for the app or any other package.
    if (a.buildSigner || b.buildSigner) return !!a.buildSigner && a.buildSigner === b.buildSigner;
    const x = a.signingCertificates(runtime), y = b.signingCertificates(runtime); return x.length > 0 && x.length === y.length && x.every((cert, i) => cert.length === y[i].length && cert.every((v, j) => v === y[i][j])); 
  };
  /**
   * Whether package `entry` holds `permission` (PermissionManagerService for an installed, non-privileged app): it must request it; a permission declared by an installed
   * package is granted by that declaration's level (normal: at install; signature: when both packages have the same signers; dangerous: only by a runtime grant, which
   * only the app being run can receive from the device's permission controls); framework permissions follow their AOSP protection level.
   */
  const holds = (runtime, entry, permission) => {
    if (entry.main) return platform.holdsPermission(runtime, permission);
    const sdk = runtime.apiLevel ?? 33, requested = (entry.manifest.usesPermissions ?? []).some(p => p.name === permission && (p.maxSdkVersion === null || Number(p.maxSdkVersion) >= sdk));
    if (!requested) return false;
    if (api.defaultGrants.get(entry.name)?.has(permission) && !api.refusedPermissions.has(permission)) return true;   // granted by the device's default grants (a device option's preinstalled package)
    return levelFor(runtime, entry, permission) === 'normal';
  };
  /** The level `permission` has for package `entry`: 'normal' when it is granted by installation alone. */
  const levelFor = (runtime, entry, permission) => {
    if (api.refusedPermissions.has(permission)) return 'refused';   // a device policy that grants a permission to no package (src/microg-device.js MICROG_REFUSED_PERMISSIONS)
    if ((entry.manifest?.declaredPermissions ?? []).some(p => p.name === permission)) return 'normal';   // a package holds the permissions it declares
    const declared = declaredPermission(permission);
    if (declared) return declared.level === 0 || ((declared.level === 2 || declared.level === 3) && sameSigners(runtime, entry, declared.entry)) ? 'normal' : LEVEL_NAMES[declared.level] ?? 'internal';
    return String(FRAMEWORK_PERMISSIONS[permission] ?? '').split('|')[0] || null;
  };
  const securityException = (runtime, message) => runtime.throwJava('Ljava/lang/SecurityException;', message);

  // ---- package visibility (AppsFilter, API 30+) ---------------------------------------------------------------------------------------------------------------------
  const componentActions = entry => (entry.manifest?.componentDetails ?? []).flatMap(detail => detail.actions ?? []).concat((entry.manifest?.activities ?? []).flatMap(a => (a.filters ?? []).flatMap(f => f.actions ?? [])));
  /**
   * Whether `viewer` can see package `target`: itself; everything when it targets API 29 or lower or holds QUERY_ALL_PACKAGES; else what its <queries> names (a package, an
   * intent action one of the target's components filters on, a provider authority), and a package that interacted with it (bound to its service, used its provider).
   */
  const visible = (runtime, viewer, target) => {
    if (!target || viewer === target) return !!target;
    if (targetSdk(viewer) < 30 || holds(runtime, viewer, 'android.permission.QUERY_ALL_PACKAGES')) return true;
    if (target.system && isTrue(target.manifest?.application?.forceQueryable)) return true;   // AppsFilter: android:forceQueryable is honoured for packages preinstalled on the system image only
    if (grants.has(`${viewer.name}->${target.name}`)) return true;
    const queries = viewer.manifest?.queries ?? { packages: [], actions: [], authorities: [] };
    if (queries.packages.includes(target.name)) return true;
    if (queries.authorities.some(authority => (target.manifest?.providerDetails ?? []).some(detail => String(detail.authorities ?? '').split(';').includes(authority)))) return true;
    const actions = componentActions(target); return queries.actions.some(action => actions.includes(action));
  };
  const grant = (viewer, visibleEntry) => { if (viewer !== visibleEntry) grants.add(`${viewer.name}->${visibleEntry.name}`); };

  // ---- Context methods of a companion's contexts (android-platform.js CONTEXTS) -------------------------------------------------------------------------------------
  const NOT_HANDLED = Symbol('not handled');
  const unsupported = (entry, what) => { throw new APKError(`${what} on a Context of companion package ${entry.name}: the resources of a second installed package are not loaded (only its manifest, code and assets)`, { kind: 'package-resources-unsupported' }); };
  function contextInvoke(runtime, method, args) {
    const receiver = args[0]; if (!receiver || typeof receiver !== 'object') return NOT_HANDLED;
    const entry = contextEntry(runtime, receiver); if (entry.main) return NOT_HANDLED;
    switch (method.name) {
      case 'getPackageName': case 'getOpPackageName': case 'getBasePackageName': return entry.name;
      case 'getApplication': case 'getApplicationContext': { const app = application(entry); if (!app) throw new APKError(`The Application of ${entry.name} has not been created`, { kind: 'package-process' }); return app; }
      case 'getApplicationInfo': return applicationInfoFor(runtime, entry);
      case 'getClassLoader': return runtime.object(receiver).packageCodeIncluded === false ? loaderOf(runtime, main) : loaderOf(runtime, entry);   // createPackageContext without CONTEXT_INCLUDE_CODE: no code of that package
      case 'getPackageManager': if (!entry.pm) { entry.pm = runtime.makeObject(PACKAGE_MANAGER); runtime.object(entry.pm).packageEntry = entry; refs.set(`${entry.name}:pm`, entry.pm); } return entry.pm;
      case 'getResources': return packageResources(runtime, entry);
      case 'getString': case 'getText': {   // Context.getString(id[, args]) / getText(id) = getResources().getString/getText
        const parameters = method.parameters, result = method.result;
        return runtime.dispatch({ owner: 'Landroid/content/res/Resources;', name: method.name, parameters, result, signature: `(${parameters.join('')})${result}` }, [packageResources(runtime, entry), ...args.slice(1)], 'virtual');
      }
      case 'createConfigurationContext': return unsupported(entry, 'Context.createConfigurationContext');
      case 'startActivity': case 'startActivityForResult': throw new APKError(`Context.startActivity from companion package ${entry.name}: Activities of a second package are not supported`, { kind: 'package-activity-unsupported' });
      case 'registerActivityLifecycleCallbacks': entry.activityCallbacks.push(args[1]); refs.set(`${entry.name}:activityCallbacks`, entry.activityCallbacks); return undefined;   // the companion's process has no Activities
      case 'unregisterActivityLifecycleCallbacks': { const at = entry.activityCallbacks.findIndex(ref => ref?.ref === args[1]?.ref); if (at >= 0) entry.activityCallbacks.splice(at, 1); return undefined; }
      default: return NOT_HANDLED;
    }
  }

  const api = {
    signerCertificateSource: null, signingCertificatesOf, refusedPermissions: new Set(), defaultGrants: new Map(),
    NOT_HANDLED,
    get multi() { return companions.size > 0; },
    main, entries, companions: () => [...companions.values()], byName, byUid, install, refs,
    callerEntry, contextEntry, entryOfClass, withCaller, callingIdentity, callingPackage, clearCallingIdentity, restoreCallingIdentity,
    loaderOf, typeIn, newContext, resourceValue, resourcesEnvironment, packageResources, baseContext, application, ensureProcess, applicationInfoFor, processOf, metaData,
    detailsOf, exported, providerFor, providerInstance, providerOwner, providerOwners,
    holds, levelFor, declaredPermission, sameSigners, securityException, visible, grant, targetSdk,
    contextInvoke,
  };
  return api;
}
