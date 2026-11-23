// The virtual device's identity (owner decision of 2026-11-21): the system properties of an Android 13 production image (Build.TYPE user, Build.TAGS release-keys), made
// from the AOSP android-13.0.0_r1 build originals (src/device-identity-data.js, scripts/build-device-identity-data.py). One fixed identity for every app: it is never chosen
// per app or changed in response to what an app checks. The only part that varies is the ABI configuration, which follows the device option "Run ARM64 native code"
// (the ABIs the device really runs), as a 32-bit image and a 64-bit one of the same build differ.
// android.os.Build reads its fields from these properties as Build.java does (src/build-host.js); Java's SystemProperties and native code read the same table
// (src/framework-provider.js, src/arm64/glue.js), so every reader sees one device.
import { DEVICE_IDENTITY_TAG, DEVICE_IDENTITY_PROPERTIES, DEVICE_IDENTITY_ABI_PROPERTIES, FINGERPRINT_PARTS, BUILD_FIELD_PROPERTIES, VARIANT_RULES, RELEASE_TAG_CHANGES, LAB_PLATFORM_CERTIFICATE_SHA256 } from './device-identity-data.js?v=d0b27a2b509b';

export { BUILD_FIELD_PROPERTIES, FINGERPRINT_PARTS, LAB_PLATFORM_CERTIFICATE_SHA256 };
export const IDENTITY_PROPERTIES = new Map(DEVICE_IDENTITY_PROPERTIES);
const ABI = { default: new Map(DEVICE_IDENTITY_ABI_PROPERTIES.default), arm64: new Map(DEVICE_IDENTITY_ABI_PROPERTIES.arm64) };
export const ABI_PROPERTY_NAMES = Object.freeze([...new Set([...ABI.default.keys(), ...ABI.arm64.keys()])]);

/** The ABI configuration of a runtime (or of `{ arm64 }`): "arm64" when the ARM64 interpreter option is on, else "default". */
export const abiConfiguration = source => (source?.arm64 ? 'arm64' : 'default');
/** Every identity property of the configuration, as a Map (the image's build.prop with what init derives at boot). */
export function identityProperties(source = null) { return new Map([...IDENTITY_PROPERTIES, ...ABI[abiConfiguration(source)], ...(source?.customIdentity?.properties ?? [])]); }

/**
 * The value of system property `name` on the device of `runtime`: the property table Java's SystemProperties reads (`table`, default the runtime's, src/framework-provider.js:
 * the identity plus the lab's other device properties and any a test sets), then the identity's ABI properties of the runtime's configuration. null when the device does not set it.
 */
export function deviceProperty(runtime, name, table = runtime?.nativeBindings?.systemProperties) {
  const custom = runtime?.customIdentity?.properties; if (custom?.has(name)) return custom.get(name);   // the custom identity the user typed (customIdentityFor), when this run has one
  if (table?.has(name)) return String(table.get(name));
  const abi = ABI[abiConfiguration(runtime)];
  if (abi.has(name)) return abi.get(name);
  return table ? null : IDENTITY_PROPERTIES.get(name) ?? null;   // a runtime without the framework's table still has the identity
}
/** The names `deviceProperty` answers for `runtime` (for __system_property_foreach and getprop without a key). */
export function devicePropertyNames(runtime, table = runtime?.nativeBindings?.systemProperties) { return [...new Set([...(table?.keys() ?? IDENTITY_PROPERTIES.keys()), ...ABI[abiConfiguration(runtime)].keys()])]; }

/** The fingerprint as init's ConstructBuildFingerprint joins it from `get(name)` (unset parts read "unknown"). */
export const constructFingerprint = get => FINGERPRINT_PARTS.map(([kind, value]) => kind === 'property' ? (get(value) || 'unknown') : value).join('');
/** ro.build.description as core/sysprop.mk BUILD_DESC makes it (TARGET_PRODUCT-TARGET_BUILD_VARIANT PLATFORM_VERSION BUILD_ID BUILD_NUMBER tags; the tags after release signing). */
export const constructDescription = get => `${get('ro.product.name')}-${get('ro.build.type')} ${get('ro.build.version.release')} ${get('ro.build.id')} ${get('ro.build.version.incremental')} ${get('ro.build.tags')}`;

// ---- Custom device identity (owner decision of 2026-11-21, CLAUDE.md) -----------------------------------------------------------------------------------------------
// The user may type, in the Device panel, the product names of the device: off by default, applied only from what the user typed (the lab never fills it in or suggests
// values), shown on the page, in the trace and in the diagnostics summary as a custom identity, removable. The typed names replace the lab's product inputs, and every
// property the build makes from them is made again by the same rule, as on a device whose build had those names: the ro.product.* properties and their
// ro.product.system.* copies (sysprop.mk generate-common-build-props, init's property_initialize_ro_product_props), ro.build.product (buildinfo.sh: TARGET_DEVICE),
// ro.build.flavor (sysprop.mk: TARGET_PRODUCT-TARGET_BUILD_VARIANT), ro.product.board (main.mk: TARGET_BOOTLOADER_BOARD_NAME), ro.hardware and ro.boot.hardware
// (androidboot.hardware, exported by init), the fingerprint (init's ConstructBuildFingerprint; the system partition's the same) and ro.build.description (BUILD_DESC).
// The build itself (type, tags, release, SDK, build id, incremental, security patch, ABIs) stays the lab's.
/** The fields of the custom identity: `key` in the settings, the property it sets, the android.os.Build field that reads it, the page's label, and its rule (`name`: a
 * product name of CDD 3.2.2, ^[a-zA-Z0-9_-]+$; `text`: any printable value, as Build.MANUFACTURER / MODEL may be). */
export const CUSTOM_IDENTITY_FIELDS = Object.freeze([
  { key: 'manufacturer', property: 'ro.product.manufacturer', build: 'MANUFACTURER', label: 'Manufacturer', rule: 'text' },
  { key: 'brand', property: 'ro.product.brand', build: 'BRAND', label: 'Brand', rule: 'name' },
  { key: 'model', property: 'ro.product.model', build: 'MODEL', label: 'Model', rule: 'text' },
  { key: 'device', property: 'ro.product.device', build: 'DEVICE', label: 'Device', rule: 'name' },
  { key: 'name', property: 'ro.product.name', build: 'PRODUCT', label: 'Product name', rule: 'name' },
  { key: 'board', property: 'ro.product.board', build: 'BOARD', label: 'Board', rule: 'name', optional: true },
  { key: 'hardware', property: 'ro.hardware', build: 'HARDWARE', label: 'Hardware', rule: 'name', optional: true },
].map(Object.freeze));
/** The longest value native code reads whole: PROP_VALUE_MAX (92) less the terminating NUL; __system_property_get cannot return a longer one (bionic answers a longer ro.
 * property only through __system_property_read_callback). */
export const PROPERTY_VALUE_MAX_BYTES = 91;
const NAME_RULE = /^[a-zA-Z0-9_-]+$/, CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const utf8Length = text => new TextEncoder().encode(text).length;
/** The problem with one typed value of `field` (already trimmed), or null. An empty value is no problem: it keeps the lab's value. */
export function customIdentityFieldError(field, value) {
  if (!value) return null;
  if (CONTROL.test(value)) return 'no control characters or line breaks (a build.prop value is one line)';
  if (utf8Length(value) > PROPERTY_VALUE_MAX_BYTES) return `at most ${PROPERTY_VALUE_MAX_BYTES} bytes (${utf8Length(value)} typed): PROP_VALUE_MAX is 92 with the final NUL`;
  if (field.rule === 'name' && !NAME_RULE.test(value)) return `only letters A–Z and a–z, digits, "_" and "-" (Build.${field.build}, CDD 3.2.2: ^[a-zA-Z0-9_-]+$)`;
  return null;
}
/**
 * The custom identity as typed (pure): { on, fields: { key: trimmed text } (every key), errors: { key: message }, problems: [messages not of one field], value }.
 * `value` is what a load applies: the typed (non-empty) fields when the option is on, at least one field is typed and nothing is wrong; else null (the lab's identity).
 */
export function checkCustomIdentity(input = null) {
  const on = input?.on === true, fields = {}, errors = {}, problems = [];
  for (const field of CUSTOM_IDENTITY_FIELDS) {
    const raw = input?.[field.key]; fields[field.key] = typeof raw === 'string' ? raw.slice(0, 256).trim() : '';   // build.prop trims a value; 256: room to show a too-long value's error
    const error = customIdentityFieldError(field, fields[field.key]); if (error) errors[field.key] = error;
  }
  const typed = Object.fromEntries(CUSTOM_IDENTITY_FIELDS.filter(field => fields[field.key]).map(field => [field.key, fields[field.key]]));
  if (!Object.keys(errors).length && Object.keys(typed).length) {
    const fingerprint = customIdentityProperties(typed).get('ro.build.fingerprint'), bytes = utf8Length(fingerprint);
    if (bytes > PROPERTY_VALUE_MAX_BYTES) problems.push(`the fingerprint these names make (${fingerprint}) is ${bytes} bytes, more than the ${PROPERTY_VALUE_MAX_BYTES} native code reads: shorten Brand, Product name or Device`);
  }
  const value = on && Object.keys(typed).length && !Object.keys(errors).length && !problems.length ? typed : null;
  return { on, fields, errors, problems, value };
}
/** The properties the typed names `fields` (key -> value, the typed ones) set, made again by the build's rules over `get` (default: the lab's identity). */
export function customIdentityProperties(fields, get = name => IDENTITY_PROPERTIES.get(name) ?? null) {
  const out = new Map(), has = name => get(name) !== null && get(name) !== undefined;
  for (const field of CUSTOM_IDENTITY_FIELDS) {
    const value = fields?.[field.key]; if (!value) continue;
    out.set(field.property, value);
    const system = field.property.replace(/^ro\.product\./, 'ro.product.system.'); if (system !== field.property && has(system)) out.set(system, value);
  }
  if (fields?.device) out.set('ro.build.product', fields.device);
  if (fields?.name) out.set('ro.build.flavor', `${fields.name}-${get('ro.build.type')}`);
  if (fields?.hardware) out.set('ro.boot.hardware', fields.hardware);
  const merged = name => (out.has(name) ? out.get(name) : get(name));
  const fingerprint = constructFingerprint(merged); out.set('ro.build.fingerprint', fingerprint); if (has('ro.system.build.fingerprint')) out.set('ro.system.build.fingerprint', fingerprint);
  out.set('ro.build.description', constructDescription(merged));
  return out;
}
/** What a run (or the page) carries for a custom identity: { fields, properties }, or null when `fields` has no typed name (the lab's identity). `get`: the device's
 * properties the derived ones are made from (default: the lab's identity). */
export function customIdentityFor(fields, get) {
  const typed = Object.fromEntries(CUSTOM_IDENTITY_FIELDS.filter(field => typeof fields?.[field.key] === 'string' && fields[field.key]).map(field => [field.key, fields[field.key]]));
  if (!Object.keys(typed).length) return null;
  return Object.freeze({ fields: Object.freeze(typed), properties: customIdentityProperties(typed, get) });
}
/** "manufacturer …, brand …, product …" of the typed fields, in the panel's order. */
export const customIdentityFieldsText = fields => CUSTOM_IDENTITY_FIELDS.filter(field => fields?.[field.key]).map(field => `${field.key === 'name' ? 'product' : field.key} ${fields[field.key]}`).join(', ');

/** What the page's Device panel, the trace and the diagnostics summary say about the identity (`source`: a runtime, or `{ arm64 }` on the page). */
export function identitySummary(source = null) {
  const p = identityProperties(source), get = name => (source?.nativeBindings ? deviceProperty(source, name) : p.get(name)) ?? '';   // a runtime: what its SystemProperties answer
  return { tag: DEVICE_IDENTITY_TAG, release: get('ro.build.version.release'), sdk: Number(get('ro.build.version.sdk')), type: get('ro.build.type'), tags: get('ro.build.tags'), fingerprint: get('ro.build.fingerprint'),
    buildId: get('ro.build.id'), incremental: get('ro.build.version.incremental'), securityPatch: get('ro.build.version.security_patch'), debuggable: get('ro.debuggable'), secure: get('ro.secure'),
    abis: get('ro.product.cpu.abilist'), model: get('ro.product.model'), manufacturer: get('ro.product.manufacturer'), brand: get('ro.product.brand'), device: get('ro.product.device'), product: get('ro.product.name'),
    board: get('ro.product.board'), hardware: get('ro.hardware'), custom: source?.customIdentity?.fields ?? null, platformCertificateSha256: LAB_PLATFORM_CERTIFICATE_SHA256 };
}
/** One line: the names the user typed (a custom identity), the release, type and tags, the fingerprint and the ABIs. */
export function identityText(source = null, { customLabel = 'custom names typed in the Device panel' } = {}) {
  const s = identitySummary(source);
  return `${s.custom ? `${customLabel} (${customIdentityFieldsText(s.custom)}); ` : ''}Android ${s.release} (API ${s.sdk}), ${s.type} build, ${s.tags}, security patch ${s.securityPatch}; fingerprint ${s.fingerprint}; ABIs ${s.abis}; ro.debuggable=${s.debuggable}, ro.secure=${s.secure}`;
}
/** The trace line at load: the lab's identity, fixed for every app (CLAUDE.md, owner decision of 2026-11-21), or the custom one the user typed in the Device panel (marked CUSTOM). */
export const identityTraceLine = runtime => `DEVICE identity${runtime?.customIdentity ? ' (CUSTOM, typed by the user in the Device panel)' : ''}: ${identityText(runtime)}; system packages signed with the lab's platform certificate (SHA-256 ${LAB_PLATFORM_CERTIFICATE_SHA256.slice(0, 16)}…); ${runtime?.customIdentity ? 'the lab\'s build with the product names the user typed, the same for every app until the user removes them' : 'one fixed identity for every app'}`;

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
  want('ro.build.description', constructDescription(get), 'core/sysprop.mk BUILD_DESC');
  want('ro.build.product', get('ro.product.device'), 'tools/buildinfo.sh (TARGET_DEVICE)');
  want('ro.build.flavor', `${get('ro.product.name')}-${get('ro.build.type')}`, 'core/sysprop.mk TARGET_BUILD_FLAVOR');
  want('ro.hardware', get('ro.boot.hardware'), 'init (ExportKernelBootProps: ro.hardware from androidboot.hardware)');
  for (const name of ['brand', 'device', 'manufacturer', 'model', 'name']) want(`ro.product.${name}`, get(`ro.product.system.${name}`), 'init (ro.product.* from the system partition)');
  const list = get('ro.product.cpu.abilist') ?? '', list32 = get('ro.product.cpu.abilist32') ?? '', list64 = get('ro.product.cpu.abilist64') ?? '';
  if (list !== [list64, list32].filter(Boolean).join(',')) problems.push(`ro.product.cpu.abilist=${list} is not abilist64 then abilist32 (${list64} / ${list32})`);
  if (get('ro.product.cpu.abi') !== list.split(',')[0]) problems.push(`ro.product.cpu.abi=${get('ro.product.cpu.abi')} is not the first ABI of ${list}`);
  want('ro.zygote', list64 ? (list32 ? 'zygote64_32' : 'zygote64') : 'zygote32', `the ABI lists ${list}`);
  want('ro.build.version.security_patch', get('ro.build.version.security_patch')?.match(/^\d{4}-\d{2}-\d{2}$/) ? get('ro.build.version.security_patch') : 'YYYY-MM-DD', 'a production device (version_defaults.mk)');
  return problems;
}
