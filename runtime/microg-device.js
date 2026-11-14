import { APKError } from './apk-error.js?v=6e2e49883bb2';

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
  platform.microg = { version, packages: names, failures: [], refusedPermissions: [...MICROG_REFUSED_PERMISSIONS], defaultGrants: [...MICROG_DEFAULT_GRANTS], settings: { ...MICROG_LOCKED_SETTINGS } };
  runtime.record(`DEVICE microG ${version}: ${names.join(', ')} preinstalled (option "com microG"); signatures from their fake-signature meta-data; locked off: check-in, GCM, SafetyNet/Play Integrity, DroidGuard, licensing, billing (${MICROG_SETTINGS_PATH}); refused permission: ${MICROG_REFUSED_PERMISSIONS.join(', ')}; default grants to ${MICROG_GMS}: location`);
  return platform.microg;
}
