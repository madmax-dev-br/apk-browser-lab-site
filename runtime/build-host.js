import { createHostRegistry } from './host-contract.js?v=962c59289a0f';

// The statics of android.os.Build / Build.VERSION that system-services-host.js and android-platform.js do not already answer, as android-13.0.0_r1 Build.java computes them from system properties.
// Identity fields (FINGERPRINT, MODEL, TYPE, TAGS, ...) are the device model's and are not touched here; a property the VM does not set reads as it does on a device where it is unset
// (getString -> "unknown", getInt -> 0, empty list -> no entries), nothing is invented.
const BUILD = 'Landroid/os/Build;', VERSION = 'Landroid/os/Build$VERSION;', PROPS = 'Landroid/os/SystemProperties;', STRING = 'Ljava/lang/String;', LIST = 'Ljava/util/List;';
const READ_PHONE_STATE = 'android.permission.READ_PHONE_STATE', UNKNOWN = 'unknown', Q = 29;

export function createBuildHost(platform) {
  const registry = createHostRegistry(), { def, staticField } = registry;
  const text = (r, value) => (value === null || value === undefined ? null : r.stringCharacters(value));
  const prop = (r, key, fallback = null) => text(r, fallback === null
    ? r.dispatch({ owner: PROPS, name: 'get', parameters: [STRING], result: STRING, signature: `(${STRING})${STRING}` }, [key], 'static')
    : r.dispatch({ owner: PROPS, name: 'get', parameters: [STRING, STRING], result: STRING, signature: `(${STRING}${STRING})${STRING}` }, [key, fallback], 'static'));
  const getString = (r, key) => prop(r, key, UNKNOWN);                                              // Build.getString
  const getInt = (r, key) => { const value = Number.parseInt(prop(r, key), 10); return Number.isNaN(value) ? 0 : value | 0; };   // SystemProperties.getInt(key, 0)
  const getLong = (r, key) => { const value = Number.parseInt(prop(r, key), 10); return Number.isNaN(value) ? 0 : value; };
  const list = (r, key, separator) => { const value = prop(r, key); return value === '' ? [] : value.split(separator); };
  const strings = (r, values) => { const array = r.newArray('[Ljava/lang/String;', values.length); r.array(array).elements = values.slice(); return array; };
  const field = (owner, name, type, compute) => staticField(owner, name, type, compute);

  field(BUILD, 'SOC_MANUFACTURER', STRING, () => UNKNOWN); field(BUILD, 'SOC_MODEL', STRING, () => UNKNOWN);   // SocProperties .orElse(UNKNOWN): no ro.soc.* properties
  field(BUILD, 'SKU', STRING, r => getString(r, 'ro.boot.hardware.sku')); field(BUILD, 'ODM_SKU', STRING, r => getString(r, 'ro.boot.product.hardware.sku'));
  field(BUILD, 'IS_EMULATOR', 'Z', r => (getString(r, 'ro.boot.qemu') === '1' ? 1 : 0));
  field(BUILD, 'IS_ARC', 'Z', r => (['1', 'y', 'yes', 'on', 'true'].includes(prop(r, 'ro.boot.container')) ? 1 : 0));
  field(BUILD, 'PERMISSIONS_REVIEW_REQUIRED', 'Z', () => 1);
  const type = r => r.readStatic({ owner: BUILD, name: 'TYPE', type: STRING });
  for (const [name, wanted] of [['IS_ENG', 'eng'], ['IS_USERDEBUG', 'userdebug'], ['IS_USER', 'user']]) field(BUILD, name, 'Z', r => (text(r, type(r)) === wanted ? 1 : 0));

  field(VERSION, 'SDK', STRING, r => String(r.apiLevel)); field(VERSION, 'DEVICE_INITIAL_SDK_INT', 'I', r => getInt(r, 'ro.product.first_api_level'));
  field(VERSION, 'PREVIEW_SDK_FINGERPRINT', STRING, r => prop(r, 'ro.build.version.preview_sdk_fingerprint', 'REL'));
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
  def(BUILD, 'isBuildConsistent', '()Z', () => 1, { static: true });   // no partition fingerprints to disagree with the system one
  // getFingerprintedPartitions(): one Partition per ro.<name>.build.fingerprint that is set; the model sets none.
  def(BUILD, 'getFingerprintedPartitions', `()${LIST}`, r => {
    for (const name of ['bootimage', 'odm', 'product', 'system_ext', 'system', 'vendor'])
      if (prop(r, `ro.${name}.build.fingerprint`) !== '') r.throwJava('Ljava/lang/UnsupportedOperationException;', `Build.Partition for ro.${name}.build.fingerprint is not modeled`);
    const result = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [result], 'direct'); return result;
  }, { static: true });
  // getSerial(): DeviceIdentifiersPolicyService.getSerialForPackage -> TelephonyPermissions.checkCallingOrSelfReadDeviceIdentifiers. An ordinary app is refused from Android 10; before it
  // READ_PHONE_STATE suffices. The value is ro.serialno, "unknown" when the device does not set it: this one does not.
  def(BUILD, 'getSerial', `()${STRING}`, r => {
    const target = Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1), uid = platform.virtualProcess.uid;
    if (target >= Q) r.throwJava('Ljava/lang/SecurityException;', `${platform.packageName}: The user ${uid} does not meet the requirements to access device identifiers.`);
    if (!platform.holdsPermission?.(r, READ_PHONE_STATE)) r.throwJava('Ljava/lang/SecurityException;', `getSerial: uid ${uid} does not have ${READ_PHONE_STATE}.`);
    return getString(r, 'ro.serialno');
  }, { static: true });
  return { ...registry };
}
