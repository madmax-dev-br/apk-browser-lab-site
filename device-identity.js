// The virtual device's identity (owner decision of 2026-11-21): the system properties of an Android 13 production image (Build.TYPE user, Build.TAGS release-keys), made
// from the AOSP android-13.0.0_r1 build originals (src/device-identity-data.js, scripts/build-device-identity-data.py). One fixed identity for every app: it is never chosen
// per app or changed in response to what an app checks. The only part that varies is the ABI configuration, which follows the device option "Run ARM64 native code"
// (the ABIs the device really runs), as a 32-bit image and a 64-bit one of the same build differ.
// android.os.Build reads its fields from these properties as Build.java does (src/build-host.js); Java's SystemProperties and native code read the same table
// (src/framework-provider.js, src/arm64/glue.js), so every reader sees one device.
import { DEVICE_IDENTITY_TAG, DEVICE_IDENTITY_PROPERTIES, DEVICE_IDENTITY_ABI_PROPERTIES, FINGERPRINT_PARTS, BUILD_FIELD_PROPERTIES, VARIANT_RULES, RELEASE_TAG_CHANGES, LAB_PLATFORM_CERTIFICATE_SHA256 } from './device-identity-data.js?v=af8ff7411a95';

export { BUILD_FIELD_PROPERTIES, FINGERPRINT_PARTS, LAB_PLATFORM_CERTIFICATE_SHA256 };
export const IDENTITY_PROPERTIES = new Map(DEVICE_IDENTITY_PROPERTIES);
const ABI = { default: new Map(DEVICE_IDENTITY_ABI_PROPERTIES.default), arm64: new Map(DEVICE_IDENTITY_ABI_PROPERTIES.arm64) };
export const ABI_PROPERTY_NAMES = Object.freeze([...new Set([...ABI.default.keys(), ...ABI.arm64.keys()])]);

/** The ABI configuration of a runtime (or of `{ arm64 }`): "arm64" when the ARM64 interpreter option is on, else "default". */
export const abiConfiguration = source => (source?.arm64 ? 'arm64' : 'default');
/** Every identity property of the configuration, as a Map (the image's build.prop with what init derives at boot). */
export function identityProperties(source = null) { return new Map([...IDENTITY_PROPERTIES, ...ABI[abiConfiguration(source)]]); }

/**
 * The value of system property `name` on the device of `runtime`: the property table Java's SystemProperties reads (`table`, default the runtime's, src/framework-provider.js:
 * the identity plus the lab's other device properties and any a test sets), then the identity's ABI properties of the runtime's configuration. null when the device does not set it.
 */
export function deviceProperty(runtime, name, table = runtime?.nativeBindings?.systemProperties) {
  if (table?.has(name)) return String(table.get(name));
  const abi = ABI[abiConfiguration(runtime)];
  if (abi.has(name)) return abi.get(name);
  return table ? null : IDENTITY_PROPERTIES.get(name) ?? null;   // a runtime without the framework's table still has the identity
}
/** The names `deviceProperty` answers for `runtime` (for __system_property_foreach and getprop without a key). */
export function devicePropertyNames(runtime, table = runtime?.nativeBindings?.systemProperties) { return [...new Set([...(table?.keys() ?? IDENTITY_PROPERTIES.keys()), ...ABI[abiConfiguration(runtime)].keys()])]; }

/** The fingerprint as init's ConstructBuildFingerprint joins it from `get(name)` (unset parts read "unknown"). */
export const constructFingerprint = get => FINGERPRINT_PARTS.map(([kind, value]) => kind === 'property' ? (get(value) || 'unknown') : value).join('');

/** What the page's Device panel, the trace and the diagnostics summary say about the identity (`source`: a runtime, or `{ arm64 }` on the page). */
export function identitySummary(source = null) {
  const p = identityProperties(source), get = name => (source?.nativeBindings ? deviceProperty(source, name) : p.get(name)) ?? '';   // a runtime: what its SystemProperties answer
  return { tag: DEVICE_IDENTITY_TAG, release: get('ro.build.version.release'), sdk: Number(get('ro.build.version.sdk')), type: get('ro.build.type'), tags: get('ro.build.tags'), fingerprint: get('ro.build.fingerprint'),
    buildId: get('ro.build.id'), incremental: get('ro.build.version.incremental'), securityPatch: get('ro.build.version.security_patch'), debuggable: get('ro.debuggable'), secure: get('ro.secure'),
    abis: get('ro.product.cpu.abilist'), model: get('ro.product.model'), manufacturer: get('ro.product.manufacturer'), brand: get('ro.product.brand'), platformCertificateSha256: LAB_PLATFORM_CERTIFICATE_SHA256 };
}
/** One line: the release, type and tags, the fingerprint and the ABIs. */
export function identityText(source = null) {
  const s = identitySummary(source);
  return `Android ${s.release} (API ${s.sdk}), ${s.type} build, ${s.tags}, security patch ${s.securityPatch}; fingerprint ${s.fingerprint}; ABIs ${s.abis}; ro.debuggable=${s.debuggable}, ro.secure=${s.secure}`;
}
/** The trace line at load: the identity, fixed for every app (CLAUDE.md, owner decision of 2026-11-21). */
export const identityTraceLine = runtime => `DEVICE identity: ${identityText(runtime)}; system packages signed with the lab's platform certificate (SHA-256 ${LAB_PLATFORM_CERTIFICATE_SHA256.slice(0, 16)}…); one fixed identity for every app`;

/**
 * The consistency rules of an Android 13 production image, checked on a property lookup `get(name)`: problems as strings, [] when the identity holds together.
 * Release vs SDK level, the fingerprint (init's format, and the system partition's equal to it), type and tags of a release-signed user build, the variant's
 * ro.debuggable / ro.secure / ro.adb.secure (core/main.mk), the display id of a user build, and the ABI lists (abilist = abilist64 + abilist32, cpu.abi its first entry).
 */
export function identityProblems(get) {
  const problems = [], want = (name, value, why) => { if (get(name) !== value) problems.push(`${name}=${get(name)} but ${why} needs ${value}`); };
  const sdk = Number(get('ro.build.version.sdk')), release = get('ro.build.version.release');
  if (sdk !== 33 || release !== '13') problems.push(`release ${release} with SDK ${sdk}: Android 13 is API 33`);
  want('ro.build.version.codename', 'REL', 'a released platform');
  want('ro.build.version.release_or_codename', release, 'a REL build (PLATFORM_VERSION is the last stable release)');
  want('ro.build.version.preview_sdk', '0', 'a REL build');
  want('ro.build.type', 'user', 'the owner decision of 2026-11-21');
  const tags = (get('ro.build.tags') ?? '').split(',');
  for (const change of RELEASE_TAG_CHANGES) { const tag = change.slice(1); if (change[0] === '-' ? tags.includes(tag) : !tags.includes(tag)) problems.push(`ro.build.tags=${get('ro.build.tags')} after release signing (${change})`); }
  for (const [name, value] of Object.entries(VARIANT_RULES[get('ro.build.type')] ?? {})) want(name, value, `a ${get('ro.build.type')} build (core/main.mk)`);
  const fingerprint = get('ro.build.fingerprint');
  if (fingerprint !== constructFingerprint(get)) problems.push(`ro.build.fingerprint=${fingerprint} is not what init's ConstructBuildFingerprint makes: ${constructFingerprint(get)}`);
  if (!/^[^/:\s]+\/[^/:\s]+\/[^/:\s]+:[^/:\s]+\/[^/:\s]+\/[^/:\s]+:[^/:\s]+\/[^/:\s]+$/.test(fingerprint ?? '')) problems.push(`ro.build.fingerprint=${fingerprint} is not brand/name/device:release/id/incremental:type/tags without spaces`);
  want('ro.system.build.fingerprint', fingerprint, 'the system partition of the same build');
  for (const part of ['id', 'tags', 'type', 'version.incremental', 'version.release', 'version.sdk']) want(`ro.system.build.${part}`, get(`ro.build.${part}`), 'the system partition of the same build');
  want('ro.build.display.id', get('ro.build.id'), 'a release-signed user build (BUILD_ID, the keys tag removed by sign_target_files_apks.py)');
  want('ro.build.description', `${get('ro.product.name')}-${get('ro.build.type')} ${release} ${get('ro.build.id')} ${get('ro.build.version.incremental')} ${get('ro.build.tags')}`, 'core/sysprop.mk BUILD_DESC');
  for (const name of ['brand', 'device', 'manufacturer', 'model', 'name']) want(`ro.product.${name}`, get(`ro.product.system.${name}`), 'init (ro.product.* from the system partition)');
  const list = get('ro.product.cpu.abilist') ?? '', list32 = get('ro.product.cpu.abilist32') ?? '', list64 = get('ro.product.cpu.abilist64') ?? '';
  if (list !== [list64, list32].filter(Boolean).join(',')) problems.push(`ro.product.cpu.abilist=${list} is not abilist64 then abilist32 (${list64} / ${list32})`);
  if (get('ro.product.cpu.abi') !== list.split(',')[0]) problems.push(`ro.product.cpu.abi=${get('ro.product.cpu.abi')} is not the first ABI of ${list}`);
  want('ro.zygote', list64 ? (list32 ? 'zygote64_32' : 'zygote64') : 'zygote32', `the ABI lists ${list}`);
  want('ro.build.version.security_patch', get('ro.build.version.security_patch')?.match(/^\d{4}-\d{2}-\d{2}$/) ? get('ro.build.version.security_patch') : 'YYYY-MM-DD', 'a production device (version_defaults.mk)');
  return problems;
}
