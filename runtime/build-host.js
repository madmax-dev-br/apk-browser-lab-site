import { createHostRegistry } from './host-contract.js?v=5fccdbc9ed78';
import { BUILD_FIELD_PROPERTIES, deviceProperty } from './device-identity.js?v=5fccdbc9ed78';

// android.os.Build / Build.VERSION, as android-13.0.0_r1 Build.java computes them from system properties. The properties are the device's (src/device-identity.js: the
// build.prop of the lab's Android 13 user image, released with release keys, plus what a test sets): each identity field reads the property Build.java names for it
// (BUILD_FIELD_PROPERTIES, taken from Build.java by scripts/build-device-identity-data.py), through SystemProperties as Build's static initializer does. A property the
// device does not set reads as it does on a device where it is unset (getString -> "unknown", getInt -> 0, empty list -> no entries), nothing is invented.
// Build.VERSION.SDK_INT / SDK stay the runtime's API level (33, the identity's ro.build.version.sdk, unless a test runs the device at another level).
const BUILD = 'Landroid/os/Build;', VERSION = 'Landroid/os/Build$VERSION;', PARTITION = 'Landroid/os/Build$Partition;', PROPS = 'Landroid/os/SystemProperties;', STRING = 'Ljava/lang/String;', LIST = 'Ljava/util/List;';
const READ_PHONE_STATE = 'android.permission.READ_PHONE_STATE', UNKNOWN = 'unknown', Q = 29;

export function createBuildHost(platform) {
  const registry = createHostRegistry(), { def, staticField, type: declare } = registry;
  const text = (r, value) => (value === null || value === undefined ? null : typeof value === 'string' ? value : r.stringCharacters(value));
  // SystemProperties.get(key[, default]) of the framework (a method override the user set on it applies, as it would to Build's static initializer); the device's table
  // directly when the framework is not loaded (a runtime without it still has the identity).
  const prop = (r, key, fallback = null) => {
    if (!r.classes?.has?.(PROPS)) { const value = deviceProperty(r, key); return value !== null && value !== '' ? value : fallback ?? ''; }
    return text(r, fallback === null
      ? r.dispatch({ owner: PROPS, name: 'get', parameters: [STRING], result: STRING, signature: `(${STRING})${STRING}` }, [key], 'static')
      : r.dispatch({ owner: PROPS, name: 'get', parameters: [STRING, STRING], result: STRING, signature: `(${STRING}${STRING})${STRING}` }, [key, fallback], 'static'));
  };
  const getString = (r, key) => prop(r, key, UNKNOWN);                                              // Build.getString
  const getInt = (r, key) => { const value = Number.parseInt(prop(r, key), 10); return Number.isNaN(value) ? 0 : value | 0; };   // SystemProperties.getInt(key, 0)
  const getLong = (r, key) => { const value = prop(r, key); return /^[+-]?\d+$/.test(value) ? BigInt(value) : -1n; };   // Build.getLong: Long.parseLong, -1 on NumberFormatException
  const list = (r, key, separator) => { const value = prop(r, key); return value === '' ? [] : value.split(separator); };   // Build.getStringList
  const strings = (r, values) => { const array = r.newArray('[Ljava/lang/String;', values.length); r.array(array).elements = values.slice(); return array; };
  const field = (owner, name, type, compute) => staticField(owner, name, type, compute);

  // the identity fields, each from its property as Build.java reads it
  for (const [owner, entries] of [[BUILD, BUILD_FIELD_PROPERTIES.Build], [VERSION, BUILD_FIELD_PROPERTIES.VERSION]]) for (const [name, key, kind, fallback] of entries) {
    if (owner === VERSION && name === 'SDK') continue;   // below: the runtime's API level
    if (kind === 'list') field(owner, name, '[Ljava/lang/String;', r => strings(r, list(r, key, ',')));
    else field(owner, name, STRING, kind === 'string' ? r => getString(r, key) : r => prop(r, key, fallback));
  }
  // FINGERPRINT = deriveFingerprint(): ro.build.fingerprint, or the parts joined when it is empty
  field(BUILD, 'FINGERPRINT', STRING, r => { const finger = prop(r, 'ro.build.fingerprint'); return finger !== '' ? finger : `${getString(r, 'ro.product.brand')}/${getString(r, 'ro.product.name')}/${getString(r, 'ro.product.device')}:${getString(r, 'ro.build.version.release')}/${getString(r, 'ro.build.id')}/${getString(r, 'ro.build.version.incremental')}:${getString(r, 'ro.build.type')}/${getString(r, 'ro.build.tags')}`; });
  // CPU_ABI / CPU_ABI2: the first two of SUPPORTED_64_BIT_ABIS in a 64-bit process (VMRuntime.is64Bit: the ARM64 interpreter option), else of SUPPORTED_32_BIT_ABIS
  const processAbis = r => list(r, r.arm64 ? 'ro.product.cpu.abilist64' : 'ro.product.cpu.abilist32', ',');
  field(BUILD, 'CPU_ABI', STRING, r => processAbis(r)[0] ?? null); field(BUILD, 'CPU_ABI2', STRING, r => processAbis(r)[1] ?? '');
  field(BUILD, 'TIME', 'J', r => getLong(r, 'ro.build.date.utc') * 1000n);
  field(BUILD, 'IS_DEBUGGABLE', 'Z', r => (getInt(r, 'ro.debuggable') === 1 ? 1 : 0));
  field(BUILD, 'RADIO', STRING, r => { const values = list(r, 'gsm.version.baseband', ',').map(value => value.trim()).filter(value => value !== ''); return values.length ? values.join(',') : UNKNOWN; });   // joinListOrElse(baseband_version(), UNKNOWN)
  field(BUILD, 'IS_TREBLE_ENABLED', 'Z', r => (['1', 'y', 'yes', 'on', 'true'].includes(prop(r, 'ro.treble.enabled')) ? 1 : 0));

  field(BUILD, 'SOC_MANUFACTURER', STRING, () => UNKNOWN); field(BUILD, 'SOC_MODEL', STRING, () => UNKNOWN);   // SocProperties .orElse(UNKNOWN): no ro.soc.* properties
  field(BUILD, 'IS_EMULATOR', 'Z', r => (getString(r, 'ro.boot.qemu') === '1' ? 1 : 0));
  field(BUILD, 'IS_ARC', 'Z', r => (['1', 'y', 'yes', 'on', 'true'].includes(prop(r, 'ro.boot.container')) ? 1 : 0));
  field(BUILD, 'PERMISSIONS_REVIEW_REQUIRED', 'Z', () => 1);
  const buildType = r => text(r, r.readStatic({ owner: BUILD, name: 'TYPE', type: STRING }));
  for (const [name, wanted] of [['IS_ENG', 'eng'], ['IS_USERDEBUG', 'userdebug'], ['IS_USER', 'user']]) field(BUILD, name, 'Z', r => (buildType(r) === wanted ? 1 : 0));

  field(VERSION, 'SDK', STRING, r => String(r.apiLevel)); field(VERSION, 'SDK_INT', 'I', r => r.apiLevel); field(VERSION, 'DEVICE_INITIAL_SDK_INT', 'I', r => getInt(r, 'ro.product.first_api_level'));
  field(VERSION, 'PREVIEW_SDK_INT', 'I', r => getInt(r, 'ro.build.version.preview_sdk'));
  field(VERSION, 'MEDIA_PERFORMANCE_CLASS', 'I', r => getInt(r, 'ro.odm.build.media_performance_class'));
  field(VERSION, 'MIN_SUPPORTED_TARGET_SDK_INT', 'I', r => getInt(r, 'ro.build.version.min_supported_target_sdk'));
  const allCodenames = r => list(r, 'ro.build.version.all_codenames', ',');
  field(VERSION, 'ACTIVE_CODENAMES', '[Ljava/lang/String;', r => { const all = allCodenames(r); return strings(r, all.length === 0 || all[0] === 'REL' ? [] : all); });
  field(VERSION, 'RESOURCES_SDK_INT', 'I', r => { const all = allCodenames(r); return r.apiLevel + (all.length === 0 || all[0] === 'REL' ? 0 : all.length); });
  field(VERSION, 'KNOWN_CODENAMES', 'Ljava/util/Set;', r => {
    const set = r.allocate('Ljava/util/HashSet;'); r.dispatch({ owner: 'Ljava/util/HashSet;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [set], 'direct');
    for (const name of list(r, 'ro.build.version.known_codenames', ',')) r.dispatch({ owner: 'Ljava/util/HashSet;', name: 'add', parameters: ['Ljava/lang/Object;'], result: 'Z', signature: '(Ljava/lang/Object;)Z' }, [set, name], 'virtual');
    return set;
  });

  // getRadioVersion(): joinListOrElse(TelephonyProperties.baseband_version(), null): the comma-separated gsm.version.baseband list, null when it is empty or unset.
  def(BUILD, 'getRadioVersion', `()${STRING}`, r => { const values = list(r, 'gsm.version.baseband', ',').map(value => value.trim()).filter(value => value !== ''); return values.length ? values.join(',') : null; }, { static: true });
  def(BUILD, 'isDebuggable', '()Z', r => (getInt(r, 'ro.debuggable') === 1 ? 1 : 0), { static: true });
  // isBuildConsistent(): true on an eng build; with Treble the VINTF check (not modeled: it fails by name); else ro.system.build.fingerprint must be set and equal the vendor's when that is set.
  def(BUILD, 'isBuildConsistent', '()Z', r => {
    if (buildType(r) === 'eng') return 1;
    if (r.readStatic({ owner: BUILD, name: 'IS_TREBLE_ENABLED', type: 'Z' })) r.throwJava('Ljava/lang/UnsupportedOperationException;', 'Build.isBuildConsistent on a Treble device needs VintfObject.verifyWithoutAvb, which the lab does not model');
    const system = prop(r, 'ro.system.build.fingerprint'), vendor = prop(r, 'ro.vendor.build.fingerprint');
    if (system === '') { r.record?.('LOG E Build: Required ro.system.build.fingerprint is empty!'); return 0; }
    if (vendor !== '' && vendor !== system) { r.record?.(`LOG E Build: Mismatched fingerprints; system reported ${system} but vendor reported ${vendor}`); return 0; }
    return 1;
  }, { static: true });
  // Build.Partition and getFingerprintedPartitions(): one Partition per ro.<name>.build.fingerprint that is set (the identity sets the system partition's), with ro.<name>.build.date.utc.
  declare(PARTITION, 'Ljava/lang/Object;');
  for (const [name, value] of Object.entries({ PARTITION_NAME_SYSTEM: 'system', PARTITION_NAME_BOOTIMAGE: 'bootimage', PARTITION_NAME_ODM: 'odm', PARTITION_NAME_OEM: 'oem', PARTITION_NAME_PRODUCT: 'product', PARTITION_NAME_SYSTEM_EXT: 'system_ext', PARTITION_NAME_VENDOR: 'vendor' })) field(PARTITION, name, STRING, () => value);
  const part = (r, self) => r.object(self).partition;
  def(PARTITION, 'getName', `()${STRING}`, (r, _m, [self]) => part(r, self).name);
  def(PARTITION, 'getFingerprint', `()${STRING}`, (r, _m, [self]) => part(r, self).fingerprint);
  def(PARTITION, 'getBuildTimeMillis', '()J', (r, _m, [self]) => part(r, self).timeMs);
  def(PARTITION, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => { if (other === null || r.typeOf(other) !== PARTITION) return 0; const a = part(r, self), b = part(r, other); return a.name === b.name && a.fingerprint === b.fingerprint && a.timeMs === b.timeMs ? 1 : 0; });
  const stringHash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; };
  def(PARTITION, 'hashCode', '()I', (r, _m, [self]) => {   // Objects.hash(mName, mFingerprint, mTimeMs) = Arrays.hashCode of the three
    const p = part(r, self), long = Number(BigInt.asIntN(32, BigInt.asUintN(64, p.timeMs) ^ (BigInt.asUintN(64, p.timeMs) >> 32n)));
    let h = 1; for (const value of [stringHash(p.name), stringHash(p.fingerprint), long]) h = (Math.imul(31, h) + value) | 0; return h;
  });
  def(BUILD, 'getFingerprintedPartitions', `()${LIST}`, r => {
    const result = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [result], 'direct');
    for (const name of ['bootimage', 'odm', 'product', 'system_ext', 'system', 'vendor']) {
      const fingerprint = prop(r, `ro.${name}.build.fingerprint`); if (fingerprint === '') continue;
      const partition = r.makeObject(PARTITION); r.object(partition).partition = { name, fingerprint, timeMs: getLong(r, `ro.${name}.build.date.utc`) * 1000n };
      r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: ['Ljava/lang/Object;'], result: 'Z', signature: '(Ljava/lang/Object;)Z' }, [result, partition], 'virtual');
    }
    return result;
  }, { static: true });
  // getSerial(): DeviceIdentifiersPolicyService.getSerialForPackage -> TelephonyPermissions.checkCallingOrSelfReadDeviceIdentifiers. An ordinary app is refused from Android 10; before it
  // READ_PHONE_STATE suffices. The value is ro.serialno, "unknown" when the device does not set it: this one does not (init sets it from androidboot.serialno, and the lab has
  // no hardware serial number). The same on a user build as on any other: the check is the permission's, not the build type's.
  def(BUILD, 'getSerial', `()${STRING}`, r => {
    const target = Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1), uid = platform.virtualProcess.uid;
    if (target >= Q) r.throwJava('Ljava/lang/SecurityException;', `${platform.packageName}: The user ${uid} does not meet the requirements to access device identifiers.`);
    if (!platform.holdsPermission?.(r, READ_PHONE_STATE)) r.throwJava('Ljava/lang/SecurityException;', `getSerial: uid ${uid} does not have ${READ_PHONE_STATE}.`);
    return getString(r, 'ro.serialno');
  }, { static: true });
  return { ...registry };
}
