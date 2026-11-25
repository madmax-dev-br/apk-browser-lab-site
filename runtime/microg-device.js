import { APKError } from './apk-error.js?v=2e0bd04dc9d5';
import { RUN_BODY, setMethodInterceptor } from './method-overrides.js?v=2e0bd04dc9d5';
import { MICROG_ENTRY_POINTS, microgEntryMethodSmali } from './microg-entry-points.js?v=2e0bd04dc9d5';
import { parseReturnValue } from './method-overrides.js?v=2e0bd04dc9d5';
import { MICROG_STUBS, microgStubMethodSmali, MICROG_STUB_ANSWERS } from './microg-stubs.js?v=2e0bd04dc9d5';
import { MICROG_ROM_DEFAULTS, MICROG_NO_TELEMETRY_KEYS, MICROG_SERVICES, sanitizeMicrogServices, microgSettingRefusal, serviceOfKey } from './microg-services.js?v=2e0bd04dc9d5';
import { installDroidGuard, droidGuardNativeUnavailable } from './microg-droidguard.js?v=2e0bd04dc9d5';

const DEALIAS = /\$\$ldr\d+;/g;   // a companion package's classes are defined under a loader alias (Lfoo/Bar$$ldrN;): the de-aliased form matches the table's plain descriptors
const dealias = text => String(text).replace(DEALIAS, ';');

// The "com microG" device option (CLAUDE.md, docs/MICROG.md "Integration"): off by default. When on, the virtual device has the two microG packages built from the pinned
// source (vendor/microg/<version>/) installed as preinstalled companion packages, and PackageManager reports for THOSE packages only the certificate each declares in its
// own `fake-signature` <meta-data>, as a ROM with signature spoofing does. Nothing else about the device changes.
// microG's online services (check-in, push, attestation, licensing, billing, online location; src/microg-services.js) start at microG's own code defaults, all off, and the user
// turns each on (the Device panel's "microG services", or microG's own settings screens); the device then writes microG's settings the way microG's own UI does. What stays fixed:
//  * /system/etc/microg.xml (microG's own ROM-defaults file, read by its SettingsProvider) pins the device profile to "native", DroidGuard to its embedded mode and microG's
//    data-donation switches off; a write that would change one of them (from microG's screens, its ProvisionService or its code) is refused by the device, recorded, never silent;
//  * org.microg.gms.PROVISION keeps its protection level (signature|privileged): only a package signed with microG's build key that requests it holds it, never the app;
//  * microG's Activities (its screens: SMS User Consent, permission prompts, location settings resolution, its settings) start as the Activities of any installed package do
//    (android-platform.js activityTarget / createInstance); each one opened is named in the trace (what it is for);
//  * DroidGuard's downloaded VM is not refused by construction any more (2026-11-20): with the attestation switch on, microG's own code fetches it and loads it with a
//    DexClassLoader; what the VM needs that the device cannot run (its ARM native library) fails explicitly (src/microg-droidguard.js, docs/MICROG.md section 6); its network
//    mode (a remote DroidGuard server, which would attest another device) stays refused.

export const MICROG_VERSION = '0.3.18.252432';
export const MICROG_GMS = 'com.google.android.gms', MICROG_VENDING = 'com.android.vending';
export const MICROG_PACKAGES = Object.freeze([MICROG_GMS, MICROG_VENDING]);
/** The account type microG's authenticator declares (its res/xml/authenticator.xml): a Google account. */
export const MICROG_ACCOUNT_TYPE = 'com.google';
/** The authority of microG's SettingsProvider (SettingsContract.getAuthority: "<package>.microg.settings"). */
export const MICROG_SETTINGS_AUTHORITY = `${MICROG_GMS}.microg.settings`;
/** The files the page/Worker fetches for the option, relative to the site root. */
export const microgFiles = (version = MICROG_VERSION) => ({ base: `vendor/microg/${version}/`, provenance: `vendor/microg/${version}/provenance.json`, packages: MICROG_PACKAGES.map(name => `vendor/microg/${version}/${name}.apk`) });

/**
 * microG's ROM-defaults file (SharedPreferences XML, the format of Context.getSharedPreferences(File)): microG's SettingsProvider reads it after the user's preferences and before
 * the code defaults (play-services-base/core/src/main/kotlin/org/microg/gms/settings/SettingsProvider.kt, `gatherDefaultPreferences`). It holds only what the device keeps fixed
 * (src/microg-services.js MICROG_ROM_DEFAULTS); every other setting is microG's own default.
 */
export { MICROG_ROM_DEFAULTS, MICROG_NO_TELEMETRY_KEYS };
/** The name of the defaults before 2026-11-20 (when every online feature was pinned off here); kept for callers that import it. */
export const MICROG_LOCKED_SETTINGS = MICROG_ROM_DEFAULTS;
export const MICROG_SETTINGS_PATH = '/system/etc/microg.xml';
const xmlEscape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function microgSettingsXml(settings = MICROG_ROM_DEFAULTS) {
  const rows = Object.entries(settings).map(([key, value]) => typeof value === 'boolean' ? `    <boolean name="${xmlEscape(key)}" value="${value}" />` : `    <string name="${xmlEscape(key)}">${xmlEscape(value)}</string>`);
  return `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n${rows.join('\n')}\n</map>\n`;
}

/** What a microG Activity is for (the trace names each microG screen the device opens). */
const MICROG_ACTIVITIES = [
  [/\.auth\.phone\.UserConsentPromptActivity$/, 'SMS User Consent prompt'], [/\.auth\.phone\.AskPermissionActivity$/, 'SMS Retriever permission prompt'],
  [/\.location\.manager\.AskPermissionActivity$/, 'location permission prompt'], [/\.location\.settings\./, 'location settings resolution'],
  [/\.ui\.SettingsActivity$|\.ui\.MainSettingsActivity$|\.ui\.SettingsDashboardActivity$/, 'microG settings'], [/LoginActivity$|\.auth\.login\./, 'Google account login'], [/\.safetynet\.ReCaptchaActivity$/, 'reCAPTCHA (SafetyNet: a Google WebView challenge and a DroidGuard flow)'],
];
/**
 * Permissions no package of the device ever holds while the option is on. Empty since 2026-11-20: org.microg.gms.PROVISION keeps its own protection level (signature|privileged:
 * the device grants it to a package signed with microG's build key that requests it, never to the app), and the settings it could change are guarded by the device itself.
 */
export const MICROG_REFUSED_PERMISSIONS = Object.freeze([]);

/**
 * Dangerous permissions the device grants to com.google.android.gms by default (only those it requests), as a ROM that preinstalls microG grants them (default-permissions): location
 * for its fused provider, and RECEIVE_SMS / READ_CONTACTS, the two permissions microG's SMS Retriever asks for through its own permission Activity (AskPermissionActivity,
 * ALLOWED_PERMISSIONS) when it lacks them (without these grants that screen opens and the device's permission dialog asks the user for microG). microG still answers each app
 * only within that app's own grants.
 */
export const MICROG_DEFAULT_GRANTS = Object.freeze(['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.RECEIVE_SMS', 'android.permission.READ_CONTACTS']);
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
export function enableMicrog(runtime, { version, services = null }) {
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
    const droidGuard = droidGuardNativeUnavailable(r, platform.microg, library);   // the downloaded DroidGuard VM asks for a library: the error's message names it (src/microg-droidguard.js)
    if (droidGuard !== undefined) return droidGuard;
    if (library !== 'conscrypt_gmscore_jni') return;
    const failure = { api: 'ProviderInstaller', library: `lib${library}.so`, reason: 'the Conscrypt security provider of microG needs its native library, which is ARM code the virtual device cannot run; microG catches the UnsatisfiedLinkError, so ProviderInstaller.installIfNeeded returns without installing a provider' };
    if (!platform.microg.failures.some(item => item.api === failure.api)) platform.microg.failures.push(failure);
    r.record(`DEVICE microG FAILURE ProviderInstaller: the security provider was NOT installed (lib${library}.so cannot run on this device; microG swallows the UnsatisfiedLinkError, so installIfNeeded returns normally)`);
  };
  // microG's Activities (the prompts some local APIs open: SMS User Consent, permission requests, location settings resolution; its settings and login screens) start as any
  // installed package's Activities do; the device names each microG screen it opens in the trace (what it is for), so a run shows which of them the app reached.
  platform.onPackageActivityStart = (r, entry, className) => {
    if (entry?.deviceOption !== 'microg') return;
    const api = MICROG_ACTIVITIES.find(([pattern]) => pattern.test(className ?? ''))?.[1] ?? 'a microG screen';
    r.record(`DEVICE microG screen ${api}: ${entry.name}/${className}`);
  };
  // microG's push channel (MCS: TLS over TCP to mtalk.google.com:5228, McsService) is not HTTP. A browser has no TCP: through the APK Lab Relay it is a TCP tunnel (src/tcp-tunnel.js);
  // without one the conversation cannot be served. It is microG's connection, not the app's, so the device records the failure explicitly (trace, deviceOptions.microg.failures)
  // and microG gets the IOException a phone without a route to the server gives (it schedules a reconnect, as on a phone); the app keeps running.
  const previousUnserved = platform.onUnservedSocket;
  platform.onUnservedSocket = (r, socket) => {
    const handled = previousUnserved?.(r, socket); if (handled) return handled;
    const caller = registry.callerEntry(r); if (caller?.deviceOption !== 'microg') return null;
    const mcs = /(^|\.)mtalk\.google\.com$/i.test(socket.host), api = mcs ? 'Cloud messaging (MCS push channel)' : `a connection of ${caller.name}`;
    const reason = `${socket.host}:${socket.port} is ${mcs ? 'microG\'s push channel, ' : ''}a TLS/TCP conversation that is not HTTP; a browser cannot open TCP, so it needs the APK Lab Relay as the Proxy (Device > Proxy), whose TCP tunnel carries it`;
    let failure = microg.failures.find(item => item.kind === 'microg-network' && item.host === socket.host && item.port === socket.port);
    if (!failure) { failure = { kind: 'microg-network', api, host: socket.host, port: socket.port, reason, attempts: 0 }; microg.failures.push(failure); r.record(`DEVICE microG FAILURE ${api}: ${reason} (${socket.message})`); }
    failure.attempts++;
    return { type: 'Ljava/net/SocketException;', message: `${socket.host}:${socket.port}: no relay: ${reason}` };
  };
  // microG's settings as the device knows them: the fixed ones (the ROM defaults file) and the online services' switches, which start at microG's code defaults (off) and follow
  // every write that reaches microG's SettingsProvider (the guard below sees them all).
  const settings = { ...MICROG_ROM_DEFAULTS }; for (const service of MICROG_SERVICES) for (const key of service.keys) settings[key] = false;
  const microg = platform.microg = { version, packages: names, failures: [], refusedPermissions: [...MICROG_REFUSED_PERMISSIONS], defaultGrants: [...MICROG_DEFAULT_GRANTS], settings, fixed: { ...MICROG_ROM_DEFAULTS },
    services: sanitizeMicrogServices(services), refusedWrites: [], writer: null, mocks: new Map(), entries: new Map(), stubs: new Map() };
  installMicrogEntryPoints(runtime, microg, registry);
  installDroidGuard(runtime, microg, registry);
  installSettingsGuard(platform, microg, registry);
  // The user's choices of the Device panel ("microG services") are applied when microG's process starts, before anything else in it asks for them, the way microG's settings screen
  // applies a switch (its preference helpers: SettingsContract.setSettings, and what the screen does next, e.g. the check-in trigger). A process that never starts asks nothing.
  const previousStart = platform.onPackageProcessStarted;
  platform.onPackageProcessStarted = (rt, entry) => { previousStart?.(rt, entry); if (entry.name === MICROG_GMS) applyServiceSwitches(rt, microg, registry, MICROG_SERVICES.filter(service => microg.services[service.id]).map(service => [service, true])); };
  const on = MICROG_SERVICES.filter(service => microg.services[service.id]).map(service => service.label);
  runtime.record(`DEVICE microG ${version}: ${names.join(', ')} preinstalled (option "With microG"); signatures from their fake-signature meta-data; fixed (${MICROG_SETTINGS_PATH}): device profile native, DroidGuard embedded, data donation off (${MICROG_NO_TELEMETRY_KEYS.join(', ')}); online services ${on.length ? `turned on by the user: ${on.join(', ')}` : 'off (microG\'s defaults)'}; default grants to ${MICROG_GMS}: location, RECEIVE_SMS, READ_CONTACTS`);
  return platform.microg;
}

// ---- microG's settings: the fixed ones guarded, the online services applied as microG's own screen applies them ---------------------------------------------------------------
const CONTENT_VALUES = 'Landroid/content/ContentValues;', JSTRING = 'Ljava/lang/String;', JOBJECT = 'Ljava/lang/Object;', CONTEXT_TYPE = 'Landroid/content/Context;';
const vcall = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
const scall = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'static');
const jtext = (r, value) => value === null || value === undefined || value === 0 ? null : typeof value === 'string' ? value : r.stringCharacters(value);
/** The [key, value as text] pairs of a ContentValues (String.valueOf of each value: a Boolean reads "true"/"false"). */
function contentValuesEntries(r, values) {
  const keys = vcall(r, vcall(r, values, CONTENT_VALUES, 'keySet', [], 'Ljava/util/Set;'), 'Ljava/util/Set;', 'toArray', [], `[${JOBJECT}`);
  return (r.array(keys).elements ?? []).map(key => { const value = vcall(r, values, CONTENT_VALUES, 'get', [JSTRING], JOBJECT, [key]); return [jtext(r, key), value === null || value === 0 || value === undefined ? null : jtext(r, scall(r, JSTRING, 'valueOf', [JOBJECT], JSTRING, [value]))]; });
}
const settingValue = text => text === 'true' ? true : text === 'false' ? false : text;
/**
 * Every write to microG's SettingsProvider passes the device's guard (ContentResolver.update/insert, src/content-resolver-api-host.js providerWriteFilter), whoever makes it: microG's
 * settings screens, its ProvisionService, its own code, the Device panel. A write of a fixed setting (src/microg-services.js microgSettingRefusal: data donation on, another device
 * profile or serial, DroidGuard's network mode) is taken out of the ContentValues (the rest is written), recorded in the trace and in deviceOptions.microg.failures, and never
 * silent. A change of an online service's switch is recorded in the trace, with who made it.
 */
function installSettingsGuard(platform, microg, registry) {
  platform.providerWriteFilter = (r, authority, uri, values) => {
    if (authority !== MICROG_SETTINGS_AUTHORITY || values === null || values === undefined || values === 0) return values;
    const entries = contentValuesEntries(r, values), refused = entries.map(([key, value]) => [key, value, microgSettingRefusal(key, value)]).filter(([, , reason]) => reason);
    const by = microg.writer ?? `${registry.callerEntry(r).name}${registry.callerEntry(r).name === MICROG_GMS ? ' (microG\'s settings screen or its own code)' : ''}`;
    let out = values;
    if (refused.length) {
      out = r.allocate(CONTENT_VALUES); r.dispatch({ owner: CONTENT_VALUES, name: '<init>', parameters: [CONTENT_VALUES], result: 'V', signature: `(${CONTENT_VALUES})V` }, [out, values], 'direct');
      for (const [key, value, reason] of refused) {
        vcall(r, out, CONTENT_VALUES, 'remove', [JSTRING], 'V', [r.javaString(key)]);
        const failure = { kind: 'microg-setting-refused', key, value, by, reason };
        microg.refusedWrites.push(failure); if (!microg.failures.some(item => item.kind === failure.kind && item.key === key && item.value === value)) microg.failures.push(failure);
        r.record(`DEVICE microG REFUSED setting ${key}=${value} (written by ${by}): ${reason}; the other values of the same write are kept`);
      }
    }
    for (const [key, value] of entries) {
      if (refused.some(([k]) => k === key)) continue;
      const service = serviceOfKey(key), next = settingValue(value);
      if (!service && !(key in microg.fixed)) continue;
      if (microg.settings[key] !== next) r.record(`DEVICE microG SETTING ${key}=${value}${service ? ` (${service.label}, talks to ${service.who}: ${service.hosts.join(', ')})` : ''} by ${by}`);
      microg.settings[key] = next;
    }
    return out;
  };
}
/** Whether every switch of a service is on in microG's settings as the device last saw them written. */
const serviceOn = (microg, service) => service.keys.every(key => microg.settings[key] === true);
/**
 * Flips the switches of `changes` ([service, on]) in microG's process the way microG's settings screen does: its own preference helpers (CheckinPreferences.setEnabled,
 * GcmPrefs.setEnabled, SafetyNetPreferences/DroidGuardPreferences.setEnabled, VendingPreferences.setLicensingEnabled/setBillingEnabled, LocationSettings), which write through
 * SettingsContract to its SettingsProvider and then do what the screen does next (a check-in trigger, a push reconnect). microG's code is never patched. A failure is recorded.
 */
function applyServiceSwitches(r, microg, registry, changes) {
  if (!changes.length) return;
  const gms = registry.byName(MICROG_GMS), context = gms ? registry.application(gms) : null;
  if (!context) return;
  const previousWriter = microg.writer; microg.writer = 'the Device panel (microG services)';
  try {
    for (const [service, on] of changes) {
      try {
        for (const setter of service.setters) {
          const owner = registry.typeIn(r, gms, setter.owner);
          if (!owner) throw new APKError(`${setter.owner} is not a class of the installed ${MICROG_GMS}`, { kind: 'microg-setting' });
          if (setter.companion) {
            const companionType = registry.typeIn(r, gms, `${setter.owner}$Companion`), companion = r.readStatic({ owner, name: 'Companion', type: companionType });
            vcall(r, companion, companionType, setter.name, [CONTEXT_TYPE, 'Z'], 'V', [context, on ? 1 : 0]);
          } else if (setter.instance) {
            const object = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters: [CONTEXT_TYPE], result: 'V', signature: `(${CONTEXT_TYPE})V` }, [object, context], 'direct');
            vcall(r, object, owner, setter.name, ['Z'], 'V', [on ? 1 : 0]);
          } else scall(r, owner, setter.name, [CONTEXT_TYPE, 'Z'], 'V', [context, on ? 1 : 0]);
        }
        r.record(`DEVICE microG SERVICE ${service.label} ${on ? 'on' : 'off'} (Device panel; microG's own switch: ${service.keys.join(', ')}); ${on ? `microG talks to ${service.who} (${service.hosts.join(', ')})` : 'microG stops using it'}`);
      } catch (error) {
        const message = error?.name === 'JavaException' ? `${r.typeOf(error.value)}: ${jtext(r, r.object(error.value).message) ?? ''}` : error?.message ?? String(error);
        const failure = { kind: 'microg-service', api: service.label, reason: `microG's switch could not be set: ${message}` };
        if (!microg.failures.some(item => item.kind === failure.kind && item.api === failure.api)) microg.failures.push(failure);
        r.record(`DEVICE microG FAILURE ${service.label}: the switch was NOT applied (${message})`);
      }
    }
  } finally { microg.writer = previousWriter; }
}
/**
 * The Device panel changed "microG services" while the app runs: the new choices are kept for microG's next process start and, when microG's process already runs, the switches
 * that differ from microG's settings are flipped now, between two VM events (platform.queueTask), as microG's screen would. Returns the services and microG's switches as they are.
 */
export function applyMicrogServices(runtime, services) {
  const microg = runtime.platform?.microg; if (!microg) return null;
  microg.services = sanitizeMicrogServices(services);
  const registry = runtime.platform.packages, gms = registry.byName(MICROG_GMS);
  if (gms?.state === 'started') {
    const changes = MICROG_SERVICES.filter(service => serviceOn(microg, service) !== microg.services[service.id]).map(service => [service, microg.services[service.id]]);
    if (changes.length) runtime.platform.queueTask(() => applyServiceSwitches(runtime, microg, registry, changes), 0, []);
  }
  return describeMicrogServices(microg);
}
/** For the snapshot and the page: what the user chose, and each service's switches in microG as the device last saw them written. */
export function describeMicrogServices(microg) {
  if (!microg?.settings) return null;
  return { chosen: { ...microg.services }, effective: Object.fromEntries(MICROG_SERVICES.map(service => [service.id, serviceOn(microg, service)])), settings: { ...microg.settings }, refused: microg.refusedWrites.map(item => ({ ...item })) };
}

// ---- The entry points of the forbidden features (docs/MICROG.md section 9, src/microg-entry-points.js) -----------------------------------------------------------------------
// Each entry point's microG method is intercepted (src/method-overrides.js setMethodInterceptor, honoured by both engines). A companion package's classes are defined under a loader
// alias, so the method's VM key is resolved from the laid-out class once the package's code exists (onPackageCodeDefined). Without a mock the device reports one uniform failure per
// entry point and microG's own body then runs; with a mock the mock's value is returned instead. Nothing is intercepted until the package's loader is built, so a run that never
// reaches a microG package pays nothing.
function installMicrogEntryPoints(runtime, microg, registry) {
  for (const def of MICROG_ENTRY_POINTS) microg.entries.set(def.id, { def, key: null, hits: 0, mockHits: 0, resolved: false });
  for (const def of MICROG_STUBS) microg.stubs.set(def.id, { def, key: null, hits: 0, resolved: false, stub: true });
  // API the page/Node use to supply a mock (loadAPK option mocks are applied by the caller through this).
  microg.mock = (id, handler) => {
    if (!microg.entries.has(id)) throw new APKError(`microG: no entry point "${id}" (known: ${[...microg.entries.keys()].join(', ')})`, { kind: 'microg-entry-point' });
    if (typeof handler !== 'function') throw new APKError(`microG: the mock of "${id}" must be a function`, { kind: 'microg-entry-point' });
    microg.mocks.set(id, handler);
  };
  microg.unmock = id => microg.mocks.delete(id);
  // Resolves and installs the interceptor for every entry point of the package whose code was just defined.
  const installFor = (rt, entry) => {
    for (const state of [...microg.entries.values(), ...microg.stubs.values()]) {
      if (state.resolved || state.def.pkg !== entry.name) continue;
      const aliasOwner = entry.descriptors?.get(state.def.method.owner); if (!aliasOwner) continue;
      const cls = rt.classes.get(aliasOwner); if (!cls) continue;
      let nameSig = null;
      for (const candidate of cls.methods.keys()) if (candidate.startsWith(state.def.method.name + '(') && dealias(candidate) === state.def.method.name + state.def.method.signature) { nameSig = candidate; break; }
      const smali = state.stub ? microgStubMethodSmali(state.def) : microgEntryMethodSmali(state.def);
      if (!nameSig) throw new APKError(`microG ${state.stub ? 'unimplemented method' : 'entry point'} ${state.def.id}: ${smali} is not a method of the installed ${entry.name}`, { kind: 'microg-entry-point' });
      state.key = `${aliasOwner}->${nameSig}`; state.result = nameSig.slice(nameSig.indexOf(')') + 1); state.resolved = true;
      setMethodInterceptor(rt, state.key, (r, definition, args) => state.stub ? reportStub(r, microg, state) : intercept(r, microg, state, definition, args));
    }
  };
  // The device-profile lock: microG's ProfileManager.setProfile writes the setting (refused by the settings guard) and then applies the new profile to its own copy of the Build values
  // in memory (applyProfile). The device refuses that application for any profile but "native", recorded, so no built-in or spoofed profile is ever reported; "native" runs as is.
  const PROFILE_OWNER = 'Lorg/microg/gms/profile/ProfileManager;', PROFILE_METHOD = 'applyProfile', PROFILE_SIGNATURE = '(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V';
  let profileGuarded = false;
  const guardProfile = (rt, entry) => {
    if (profileGuarded || entry.name !== MICROG_GMS) return;
    const owner = entry.descriptors?.get(PROFILE_OWNER), cls = owner ? rt.classes.get(owner) : null; if (!cls) return;
    const nameSig = [...cls.methods.keys()].find(candidate => candidate.startsWith(PROFILE_METHOD + '(') && dealias(candidate) === PROFILE_METHOD + PROFILE_SIGNATURE);
    if (!nameSig) throw new APKError(`microG device profile lock: ${PROFILE_OWNER}${PROFILE_METHOD}${PROFILE_SIGNATURE} is not a method of the installed ${MICROG_GMS}`, { kind: 'microg-entry-point' });
    profileGuarded = true;
    setMethodInterceptor(rt, `${owner}->${nameSig}`, (r, definition, args) => {
      const value = args[(definition.flags & 8) ? 1 : 2], profile = value === null || value === undefined || value === 0 ? null : r.stringCharacters(value);   // (this,) context, profile, serial
      if (profile === 'native') return RUN_BODY;
      const failure = { kind: 'microg-setting-refused', key: 'device_profile (applied)', value: profile, by: MICROG_GMS, reason: 'microG\'s device profile stays "native": the device does not let microG apply another profile to the values it reports' };
      if (!microg.failures.some(item => item.kind === failure.kind && item.key === failure.key && item.value === profile)) { microg.failures.push(failure); microg.refusedWrites.push(failure); }
      r.record(`DEVICE microG REFUSED device profile ${profile}: microG's ProfileManager.applyProfile was not run (its device profile stays "native")`);
      return undefined;
    });
  };
  // Install for packages whose loader already exists, and hook later creations.
  for (const entry of registry.companions().filter(e => e.deviceOption === 'microg')) if (entry.loader) { installFor(runtime, entry); guardProfile(runtime, entry); }
  const previous = runtime.platform.onPackageCodeDefined;
  runtime.platform.onPackageCodeDefined = (rt, entry) => { previous?.(rt, entry); if (entry.deviceOption === 'microg') { installFor(rt, entry); guardProfile(rt, entry); } };
}

/**
 * One call of a local API microG does not implement (src/microg-stubs.js): the device records it as an explicit failure, naming the API and what microG does with it (never answers, or
 * answers without doing it), and microG's own body runs, so the app sees what it would see on a phone with this microG.
 */
function reportStub(runtime, microg, state) {
  const def = state.def; state.hits++;
  let failure = microg.failures.find(item => item.kind === 'microg-unimplemented' && item.stub === def.id);
  if (!failure) { failure = { kind: 'microg-unimplemented', stub: def.id, api: def.api, answer: def.answer, reason: `microG ${microg.version} does not implement this (its source logs "Not yet implemented"): ${MICROG_STUB_ANSWERS[def.answer]}`, method: microgStubMethodSmali(def), source: def.source, hits: 0 }; microg.failures.push(failure); }
  failure.hits = state.hits;
  if (state.hits === 1 || state.hits % 100 === 0) runtime.record(`LOG W APKWebLab: microG ${def.id} (${def.api}): not implemented by microG; ${MICROG_STUB_ANSWERS[def.answer]} (${state.hits} calls)`);
  if (state.hits === 1) runtime.record(`DEVICE microG UNIMPLEMENTED ${def.id}: ${def.api}; ${MICROG_STUB_ANSWERS[def.answer]} (${def.source})`);
  return RUN_BODY;
}

/**
 * The microG switches behind each entry point's feature (src/microg-entry-points.js). With all of them on (the user turned the service on: microG's screens or the Device panel),
 * the call is microG's own online code doing its work, not a missing feature: the device records once that it runs, and microG's body runs.
 */
const ENTRY_POINT_SWITCHES = Object.freeze({ checkin: ['checkin_enable_service'], 'push-registration': ['checkin_enable_service', 'gcm_enable_mcs_service'], 'safetynet-attest': ['safetynet_enabled'], 'play-integrity': ['safetynet_enabled'], droidguard: ['droidguard_enabled'], licensing: ['vending_licensing'], billing: ['vending_billing'] });
/** One intercepted call of an entry point's method: the mock's value, or a reported "not implemented" failure followed by microG's own body (RUN_BODY). */
function intercept(runtime, microg, state, definition, args) {
  const def = state.def, handler = microg.mocks.get(def.id), switches = ENTRY_POINT_SWITCHES[def.id];
  // A Google account's token is microG's online work once the user signed in to a Google account in microG's login screen (the account is in the device's account store)
  const signedIn = def.id === 'account-token' && (runtime.platform.accountStore?.()?.accounts ?? []).some(account => account.type === MICROG_ACCOUNT_TYPE);
  if (!handler && (signedIn || (switches && switches.every(key => microg.settings?.[key] === true)))) {
    state.onlineHits = (state.onlineHits ?? 0) + 1;
    if (state.onlineHits === 1) runtime.record(`DEVICE microG ONLINE ${def.id}: ${def.label}; microG's own code runs (${signedIn ? 'a Google account was added in microG\'s login screen' : `turned on: ${switches.join(', ')}`})`);
    return RUN_BODY;
  }
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

/** For the snapshot: one row per local API microG leaves unimplemented (src/microg-stubs.js), whether its method was found in the installed DEX and how often it was called. */
export function describeMicrogStubs(microg) {
  if (!microg?.stubs) return [];
  return MICROG_STUBS.map(def => { const state = microg.stubs.get(def.id); return { id: def.id, api: def.api, answer: def.answer, method: microgStubMethodSmali(def), resolved: state?.resolved === true, hits: state?.hits ?? 0 }; });
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
