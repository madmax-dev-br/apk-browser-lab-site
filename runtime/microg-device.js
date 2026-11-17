import { APKError } from './apk-error.js?v=f6b6991c82b7';
import { RUN_BODY, setMethodInterceptor } from './method-overrides.js?v=f6b6991c82b7';
import { MICROG_ENTRY_POINTS, microgEntryMethodSmali } from './microg-entry-points.js?v=f6b6991c82b7';
import { parseReturnValue } from './method-overrides.js?v=f6b6991c82b7';

const DEALIAS = /\$\$ldr\d+;/g;   // a companion package's classes are defined under a loader alias (Lfoo/Bar$$ldrN;): the de-aliased form matches the table's plain descriptors
const dealias = text => String(text).replace(DEALIAS, ';');

// The "com microG" device option (CLAUDE.md, docs/MICROG.md "Integration"): off by default. When on, the virtual device has the two microG packages built from the pinned
// source (vendor/microg/<version>/) installed as preinstalled companion packages, and PackageManager reports for THOSE packages only the certificate each declares in its
// own `fake-signature` <meta-data>, as a ROM with signature spoofing does. Nothing else about the device changes. The locks that keep device registration, Google login,
// push, SafetyNet/Play Integrity and DroidGuard off are enforced here and in the general package/permission code, never by trusting microG's defaults alone:
//  * /system/etc/microg.xml (microG's own ROM-defaults file, read by its SettingsProvider) pins those settings to off;
//  * org.microg.gms.PROVISION (signature|privileged) is never granted to any package, so ProvisionService refuses every caller with the SecurityException Android gives;
//  * microG's Activities are never started (a companion's Activities fail explicitly);
//  * DroidGuard's remote code never arrives: no real network, and loading code from the DroidGuard cache directory is refused by construction (class-loader-host.js).

export const MICROG_VERSION = '0.3.18.252432';
export const MICROG_GMS = 'com.google.android.gms', MICROG_VENDING = 'com.android.vending';
export const MICROG_PACKAGES = Object.freeze([MICROG_GMS, MICROG_VENDING]);
/** The files the page/Worker fetches for the option, relative to the site root. */
export const microgFiles = (version = MICROG_VERSION) => ({ base: `vendor/microg/${version}/`, provenance: `vendor/microg/${version}/provenance.json`, packages: MICROG_PACKAGES.map(name => `vendor/microg/${version}/${name}.apk`) });

/**
 * microG's ROM-defaults file (SharedPreferences XML, the format of Context.getSharedPreferences(File)): microG's SettingsProvider reads it before the code defaults
 * (play-services-base/core/src/main/kotlin/org/microg/gms/settings/SettingsProvider.kt, `systemDefaultPreferences`). Every key that would reach a Google server or run
 * attestation code is false; the device profile is "native" (microG's own copy of android.os.Build values, never a built-in profile of another device).
 */
export const MICROG_LOCKED_SETTINGS = Object.freeze({
  checkin_enable_service: false,       // CheckIn.ENABLED: device registration
  gcm_enable_mcs_service: false,       // Gcm.ENABLE_GCM: push (GCM/FCM) — needs check-in anyway
  safetynet_enabled: false,            // SafetyNet.ENABLED: SafetyNet attest, and the gate of Play Integrity (VendingPreferences.isDeviceAttestationEnabled)
  droidguard_enabled: false,           // DroidGuard.ENABLED: the downloaded attestation VM
  droidguard_force_local_disabled: true,  // DroidGuard.FORCE_LOCAL_DISABLED
  vending_licensing: false,            // Vending.LICENSING
  vending_licensing_purchase_free_apps: false,
  vending_billing: false,              // Vending.BILLING
  vending_asset_delivery: false,
  vending_split_install: false,
  vending_device_sync: false,
  location_wifi_ichnaea: false,        // Location: online sources are real network
  location_cell_ichnaea: false,
  location_ichnaea_contribute: false,
  location_geocoder_nominatim: false,
  location_wifi_moving: false,
  location_wifi_learning: false,
  location_cell_learning: false,
  location_online_source: '',
  device_profile: 'native',
});
export const MICROG_SETTINGS_PATH = '/system/etc/microg.xml';
const xmlEscape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function microgSettingsXml(settings = MICROG_LOCKED_SETTINGS) {
  const rows = Object.entries(settings).map(([key, value]) => typeof value === 'boolean' ? `    <boolean name="${xmlEscape(key)}" value="${value}" />` : `    <string name="${xmlEscape(key)}">${xmlEscape(value)}</string>`);
  return `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n${rows.join('\n')}\n</map>\n`;
}

/** Permissions no package of the device ever holds while the option is on (signature|privileged ones that let a caller flip microG's locked settings). */
export const MICROG_REFUSED_PERMISSIONS = Object.freeze(['org.microg.gms.PROVISION']);

/** Dangerous permissions the device grants to com.google.android.gms by default (only those it requests). */
export const MICROG_DEFAULT_GRANTS = Object.freeze(['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_BACKGROUND_LOCATION']);
/** The hex DER certificate of a package's `fake-signature` meta-data (a resource reference resolved in the package's own resources.arsc), or an explicit error. */
export function declaredFakeSignature(registry, entry) {
  const item = (entry.manifest?.application?.metaData ?? []).find(m => m.name === 'fake-signature');
  if (!item) throw new APKError(`microG option: ${entry.name} declares no fake-signature meta-data`, { kind: 'microg-signature' });
  let value = item.value;
  if (typeof value === 'number' || (typeof value === 'string' && /^@0x[0-9a-f]+$/i.test(value))) {
    const resolved = registry.resourceValue(entry, typeof value === 'number' ? value : parseInt(value.slice(1), 16));
    value = resolved?.value;
  }
  if (typeof value !== 'string' || !/^([0-9a-f]{2})+$/i.test(value)) throw new APKError(`microG option: the fake-signature of ${entry.name} is not a hex certificate`, { kind: 'microg-signature' });
  return Uint8Array.from(value.match(/../g), pair => parseInt(pair, 16));
}

/**
 * Turns the option on for a runtime whose loader installed the microG packages (entries flagged `deviceOption: 'microg'`). Called once, before any app code runs.
 * `version` is recorded in the trace and on platform.microg.
 */
export function enableMicrog(runtime, { version }) {
  const platform = runtime.platform, registry = platform.packages;
  const installed = registry.companions().filter(entry => entry.deviceOption === 'microg');
  const names = installed.map(entry => entry.name).sort();
  if (names.join() !== [...MICROG_PACKAGES].sort().join()) throw new APKError(`microG option: the device needs exactly ${MICROG_PACKAGES.join(' and ')}, got ${names.join(', ') || 'none'}`, { kind: 'microg-packages' });
  const certificates = new Map();
  // THE signer answer of the option: for the option's packages, the certificate each declares itself (both GET_SIGNATURES and GET_SIGNING_CERTIFICATES read this hook).
  // Every other package (the app, any other companion) keeps its APK's own signing block: the hook answers null for it.
  registry.signerCertificateSource = (entry) => {
    if (entry?.deviceOption !== 'microg') return null;
    if (!certificates.has(entry.name)) certificates.set(entry.name, [declaredFakeSignature(registry, entry)]);
    return certificates.get(entry.name);
  };
  for (const permission of MICROG_REFUSED_PERMISSIONS) registry.refusedPermissions.add(permission);
  // A ROM that ships microG grants it location by default (DefaultPermissionGrantPolicy / /system/etc/default-permissions), so its fused provider can read the system
  // LocationManager. microG still answers a client only with what that client's own location permission allows (and the device's location must be on).
  registry.defaultGrants.set(MICROG_GMS, new Set(MICROG_DEFAULT_GRANTS));
  const fs = platform.javaIo.fs();
  fs.mkdirs('/system/etc'); fs.mount(MICROG_SETTINGS_PATH, new TextEncoder().encode(microgSettingsXml())); fs.readOnly.add(MICROG_SETTINGS_PATH);   // a system partition file: read-only
  // ProviderInstaller (microG's ProviderInstallerImpl, loaded into the app's process through Dynamite) catches every Throwable of the Conscrypt start and only logs it, so the
  // app's ProviderInstaller.installIfNeeded returns as if the provider were installed. The native library it needs cannot run on this device (it is ARM code, and protected
  // natives are never substituted): the device records the failure explicitly, in the trace and in deviceOptions.microg.failures, naming what is missing.
  platform.onNativeLibraryUnavailable = (r, library) => {
    if (library !== 'conscrypt_gmscore_jni') return;
    const failure = { api: 'ProviderInstaller', library: `lib${library}.so`, reason: 'the Conscrypt security provider of microG needs its native library, which is ARM code the virtual device cannot run; microG catches the UnsatisfiedLinkError, so ProviderInstaller.installIfNeeded returns without installing a provider' };
    if (!platform.microg.failures.some(item => item.api === failure.api)) platform.microg.failures.push(failure);
    r.record(`DEVICE microG FAILURE ProviderInstaller: the security provider was NOT installed (lib${library}.so cannot run on this device; microG swallows the UnsatisfiedLinkError, so installIfNeeded returns normally)`);
  };
  // DroidGuard, by construction: its VM is code Google's server sends (stored as <dataDir>/app_cache_dg/<vmKey>/the.apk, Context.getDir("cache_dg"), then loaded with a
  // DexClassLoader, play-services-droidguard HandleProxyFactory). The settings above keep microG from asking for it, the device has no real network, and even so the device
  // refuses to load any code from that directory: the attempt is an explicit lab error naming DroidGuard.
  platform.codeLoadGuard = (r, path) => {
    if (!/\/app_cache_dg(\/|$)/.test(String(path))) return;
    r.record(`DEVICE microG REFUSED DroidGuard code load: ${path}`);
    throw new APKError(`DroidGuard: the virtual device never loads DroidGuard's downloaded code (${path}); DroidGuard, SafetyNet and Play Integrity attestation are not available with the microG option`, { kind: 'microg-droidguard-refused' });
  };
  const microg = platform.microg = { version, packages: names, failures: [], refusedPermissions: [...MICROG_REFUSED_PERMISSIONS], defaultGrants: [...MICROG_DEFAULT_GRANTS], settings: { ...MICROG_LOCKED_SETTINGS }, mocks: new Map(), entries: new Map() };
  installMicrogEntryPoints(runtime, microg, registry);
  runtime.record(`DEVICE microG ${version}: ${names.join(', ')} preinstalled (option "With microG"); signatures from their fake-signature meta-data; locked off: check-in, GCM, SafetyNet/Play Integrity, DroidGuard, licensing, billing (${MICROG_SETTINGS_PATH}); refused permission: ${MICROG_REFUSED_PERMISSIONS.join(', ')}; default grants to ${MICROG_GMS}: location`);
  return platform.microg;
}

// ---- The entry points of the forbidden features (docs/MICROG.md section 9, src/microg-entry-points.js) -----------------------------------------------------------------------
// Each entry point's microG method is intercepted (src/method-overrides.js setMethodInterceptor, honoured by both engines). A companion package's classes are defined under a loader
// alias, so the method's VM key is resolved from the laid-out class once the package's code exists (onPackageCodeDefined). Without a mock the device reports one uniform failure per
// entry point and microG's own body then runs; with a mock the mock's value is returned instead. Nothing is intercepted until the package's loader is built, so a run that never
// reaches a microG package pays nothing.
function installMicrogEntryPoints(runtime, microg, registry) {
  for (const def of MICROG_ENTRY_POINTS) microg.entries.set(def.id, { def, key: null, hits: 0, mockHits: 0, resolved: false });
  // API the page/Node use to supply a mock (loadAPK option mocks are applied by the caller through this).
  microg.mock = (id, handler) => {
    if (!microg.entries.has(id)) throw new APKError(`microG: no entry point "${id}" (known: ${[...microg.entries.keys()].join(', ')})`, { kind: 'microg-entry-point' });
    if (typeof handler !== 'function') throw new APKError(`microG: the mock of "${id}" must be a function`, { kind: 'microg-entry-point' });
    microg.mocks.set(id, handler);
  };
  microg.unmock = id => microg.mocks.delete(id);
  // Resolves and installs the interceptor for every entry point of the package whose code was just defined.
  const installFor = (rt, entry) => {
    for (const state of microg.entries.values()) {
      if (state.resolved || state.def.pkg !== entry.name) continue;
      const aliasOwner = entry.descriptors?.get(state.def.method.owner); if (!aliasOwner) continue;
      const cls = rt.classes.get(aliasOwner); if (!cls) continue;
      let nameSig = null;
      for (const candidate of cls.methods.keys()) if (candidate.startsWith(state.def.method.name + '(') && dealias(candidate) === state.def.method.name + state.def.method.signature) { nameSig = candidate; break; }
      if (!nameSig) throw new APKError(`microG entry point ${state.def.id}: ${microgEntryMethodSmali(state.def)} is not a method of the installed ${entry.name}`, { kind: 'microg-entry-point' });
      state.key = `${aliasOwner}->${nameSig}`; state.result = nameSig.slice(nameSig.indexOf(')') + 1); state.resolved = true;
      setMethodInterceptor(rt, state.key, (r, definition, args) => intercept(r, microg, state, definition, args));
    }
  };
  // Install for packages whose loader already exists, and hook later creations.
  for (const entry of registry.companions().filter(e => e.deviceOption === 'microg')) if (entry.loader) installFor(runtime, entry);
  const previous = runtime.platform.onPackageCodeDefined;
  runtime.platform.onPackageCodeDefined = (rt, entry) => { previous?.(rt, entry); if (entry.deviceOption === 'microg') installFor(rt, entry); };
}

/** One intercepted call of an entry point's method: the mock's value, or a reported "not implemented" failure followed by microG's own body (RUN_BODY). */
function intercept(runtime, microg, state, definition, args) {
  const def = state.def, handler = microg.mocks.get(def.id);
  if (!handler) {
    state.hits++;
    let failure = microg.failures.find(item => item.kind === 'microg-not-implemented' && item.entryPoint === def.id);
    if (!failure) { failure = { kind: 'microg-not-implemented', entryPoint: def.id, api: def.label, method: microgEntryMethodSmali(def), hits: 0 }; microg.failures.push(failure); }
    failure.hits = state.hits;
    if (state.hits === 1 || state.hits % 100 === 0) runtime.record(`LOG W APKWebLab: microG ${def.id} (${def.label}): not implemented, no mock; entry point ${microgEntryMethodSmali(def)} (${state.hits} calls)`);
    if (state.hits === 1) runtime.record(`DEVICE microG NOT IMPLEMENTED ${def.id}: ${def.label}; entry point ${dealias(definition.method.owner).slice(1, -1).replaceAll('/', '.')}.${def.method.name}; no mock registered`);
    return RUN_BODY;   // microG's own locked body runs: the app gets that API's ordinary failure
  }
  state.mockHits++;
  if (state.mockHits === 1 || state.mockHits % 100 === 0) runtime.record(`LOG W APKWebLab: microG MOCK ${def.id} (${def.label}): the provided value replaces ${microgEntryMethodSmali(def)} (${state.mockHits} calls)`);
  if (state.mockHits === 1) runtime.record(`DEVICE microG MOCK ${def.id}: ${def.label}; entry point ${microgEntryMethodSmali(def)}`);
  const receiver = (definition.flags & 8) ? null : args[0];   // ACC_STATIC
  let value;
  try { value = handler({ id: def.id, runtime, args, receiver, method: state.key }); }
  catch (error) {
    if (error?.name === 'JavaException') throw error;   // the handler threw a Java exception through the runtime: the app sees it thrown from this call
    throw new APKError(`microG mock "${def.id}" threw: ${error?.message ?? error}`, { kind: 'microg-mock-error', entryPoint: def.id });
  }
  return coerceMockValue(runtime, state.result, value);
}

/** The handler's value in the VM register form for the method's return type. References pass through (a `{ ref }`, a JavaScript string, or null); primitives are taken as given. */
function coerceMockValue(runtime, result, value) {
  if (result === 'V') return undefined;
  if (result[0] === 'L' || result[0] === '[') return value === undefined ? null : typeof value === 'string' ? runtime.javaString(value) : value;
  if (result === 'Z') return value === true || value === 1 ? 1 : 0;
  if (result === 'J') return typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value) || 0));
  return Number(value) | 0;
}

/**
 * The page's constant-value mocks for the entry points (the Worker has no way to receive a handler function). `specs`: [{ id, value }] with `value` written as for a method return
 * override (src/method-overrides.js parseReturnValue, against the entry point's own return type): for a reference type only "null" or a quoted "string"; a primitive as its literal. An id
 * absent from `specs` is unmocked. A value the type does not accept is reported as `error` on that row and leaves the entry point unmocked. Richer values (a Bundle, a byte[], a built
 * object) are the Node API's `platform.microg.mock(id, handler)`. Returns the entry-point rows (describeMicrogEntryPoints) with the error, if any, per id.
 */
export function applyMicrogMocks(runtime, specs) {
  const microg = runtime.platform?.microg;
  if (!microg) return [];
  const wanted = new Map((Array.isArray(specs) ? specs : []).map(spec => [spec?.id, spec]));
  const errors = new Map();
  for (const def of MICROG_ENTRY_POINTS) {
    const spec = wanted.get(def.id);
    if (spec === undefined) { microg.unmock(def.id); continue; }
    const state = microg.entries.get(def.id), result = state?.result ?? null;
    if (result === null) { errors.set(def.id, 'The entry point has not been resolved yet (open the app and reach microG once).'); continue; }
    const parsed = parseReturnValue(dealias(result), spec.value);   // the return type without the loader alias, so a reference is "null"/"string" and a primitive its literal
    if (!parsed.ok) { errors.set(def.id, parsed.error); microg.unmock(def.id); continue; }
    microg.mock(def.id, ({ runtime: r }) => typeof parsed.value === 'string' ? r.javaString(parsed.value) : parsed.value);
  }
  return describeMicrogEntryPoints(microg).map(row => errors.has(row.id) ? { ...row, error: errors.get(row.id) } : row);
}

/** For the snapshot and the page: one row per entry point (src/microg-entry-points.js), with its resolved key, whether it is mocked and its hit counts. */
export function describeMicrogEntryPoints(microg) {
  if (!microg?.entries) return [];
  return MICROG_ENTRY_POINTS.map(def => {
    const state = microg.entries.get(def.id);
    return { id: def.id, label: def.label, package: def.pkg, method: microgEntryMethodSmali(def), returnType: def.returnType, valueless: def.valueless === true, note: def.note,
      resolved: state?.resolved === true, mocked: microg.mocks.has(def.id), hits: state?.hits ?? 0, mockHits: state?.mockHits ?? 0 };
  });
}
