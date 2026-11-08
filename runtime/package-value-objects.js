import { createHostRegistry } from './host-contract.js?v=c8a9f970d5b5';
import { PACKAGE_VALUE_FIELDS, PACKAGE_VALUE_PARENTS } from './package-value-fields.js?v=c8a9f970d5b5';

// Construction, copy and Parcel behaviour of the android.content.pm value classes (PackageItemInfo, ComponentInfo, ApplicationInfo, ServiceInfo, ProviderInfo, InstrumentationInfo, PermissionInfo,
// PermissionGroupInfo, PackageInfo, ResolveInfo, FeatureInfo, ConfigurationInfo, Signature). They are host objects whose fields are declared by the AOSP class that owns them
// (package-value-fields.js) and whose host type chain is the AOSP superclass chain, so an iget/iput through a superclass reference, instanceof, checkcast and Field.get behave as on the real class.
// ActivityInfo is an original DEX class; its constructors and Parcel code call into the ComponentInfo / PackageItemInfo constructors and writeToParcel defined here.
const OBJECT = 'Ljava/lang/Object;', PARCEL = 'Landroid/os/Parcel;', PARCELABLE = 'Landroid/os/Parcelable;', CREATOR = 'Landroid/os/Parcelable$Creator;', PM = 'Landroid/content/pm/';
const ITEM = `${PM}PackageItemInfo;`, COMPONENT = `${PM}ComponentInfo;`, SIGNATURE = `${PM}Signature;`;
const CONCRETE = ['ApplicationInfo', 'ServiceInfo', 'ProviderInfo', 'InstrumentationInfo', 'PermissionInfo', 'PermissionGroupInfo', 'PackageInfo', 'ResolveInfo', 'FeatureInfo', 'ConfigurationInfo'].map(name => `${PM}${name};`);
const NO_COPY_CONSTRUCTOR = new Set([`${PM}PackageInfo;`]);   // PackageInfo has no public copy constructor in android-13
const SKIPPED_IN_PARCEL = new Set([`${PM}SigningInfo;`, 'Ljava/util/UUID;', `${PM}ActivityInfo$WindowLayout;`, '[Landroid/os/PatternMatcher;', '[Landroid/content/pm/PathPermission;', 'Landroid/content/IntentFilter;', '[Landroid/content/pm/FeatureGroupInfo;']);

const defaultOf = type => type === 'J' ? 0n : type.length === 1 ? 0 : null;
const keyOf = (owner, name, type) => `${owner}->${name}:${type}`;

/** The classes from the root (PackageItemInfo) down to `owner` that declare fields. */
function levels(owner) {
  const chain = [];
  for (let type = owner; type; type = PACKAGE_VALUE_PARENTS[type]) if (PACKAGE_VALUE_FIELDS[type]) chain.unshift(type);
  return chain;
}

export function createPackageValueObjectsHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = [], mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), mode);
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const get = (r, self, owner, name, ftype) => r.object(self).fields.get(keyOf(owner, name, ftype)) ?? defaultOf(ftype);
  const put = (r, self, owner, name, ftype, value) => r.storeField(r.object(self).fields, keyOf(owner, name, ftype), value);
  const nullish = v => v === null || v === undefined;

  // ---- hierarchy -------------------------------------------------------------------------------------------------------------------------
  type(ITEM, OBJECT, [], { allocatable: true }); type(COMPONENT, ITEM, [], { allocatable: true });
  for (const owner of CONCRETE) type(owner, PACKAGE_VALUE_PARENTS[owner] ?? OBJECT, [PARCELABLE], { allocatable: true });
  type(SIGNATURE, OBJECT, [PARCELABLE], { allocatable: true });

  // ---- constructors ----------------------------------------------------------------------------------------------------------------------
  /** Field defaults the AOSP constructors/initialisers give (ComponentInfo.enabled = true, ApplicationInfo.enabled = true, category = CATEGORY_UNDEFINED, PackageInfo.installLocation = UNSPECIFIED, ResolveInfo.specificIndex = -1). */
  const initialise = (r, self, owner) => {
    for (const level of levels(owner)) {
      if (level === COMPONENT) put(r, self, COMPONENT, 'enabled', 'Z', 1);
      else if (level === `${PM}ApplicationInfo;`) { put(r, self, level, 'enabled', 'Z', 1); put(r, self, level, 'category', 'I', -1); }
      else if (level === `${PM}PackageInfo;`) put(r, self, level, 'installLocation', 'I', -1);
      else if (level === `${PM}ResolveInfo;`) put(r, self, level, 'specificIndex', 'I', -1);
    }
  };
  /** Copy constructors copy every field of the chain by reference (AOSP: metaData, applicationInfo and the arrays are shared). */
  const copyFields = (r, self, owner, source) => {
    const from = r.object(source).fields;
    for (const level of levels(owner)) for (const [name, ftype] of PACKAGE_VALUE_FIELDS[level]) { const key = keyOf(level, name, ftype); if (from.has(key)) r.storeField(r.object(self).fields, key, from.get(key)); }
  };
  for (const owner of [ITEM, COMPONENT, ...CONCRETE]) {
    const noArgument = owner !== `${PM}ResolveInfo;`;   // ResolveInfo() is defined with the resolve model (app-services-host)
    if (noArgument) def(owner, '<init>', '()V', (r, _m, [self]) => initialise(r, self, owner));
    if (!NO_COPY_CONSTRUCTOR.has(owner)) def(owner, '<init>', `(${owner})V`, (r, _m, [self, source]) => {
      if (nullish(source)) r.throwJava('Ljava/lang/NullPointerException;', null);
      initialise(r, self, owner); copyFields(r, self, owner, source);
    });
  }

  // ---- Parcel ----------------------------------------------------------------------------------------------------------------------------
  const valueClass = ftype => ftype.startsWith('L') && (PACKAGE_VALUE_FIELDS[ftype] !== undefined || ftype === SIGNATURE) && ftype !== ITEM && ftype !== COMPONENT;
  const writeValue = (r, parcel, ftype, value) => {
    const p = (name, parameters, args) => call(r, parcel, PARCEL, name, parameters, 'V', args);
    if (SKIPPED_IN_PARCEL.has(ftype)) return;
    if (ftype === 'I' || ftype === 'Z') p('writeInt', ['I'], [value ? (ftype === 'Z' ? 1 : value) : 0]);
    else if (ftype === 'J') p('writeLong', ['J'], [value]);
    else if (ftype === 'F') p('writeFloat', ['F'], [value]);
    else if (ftype === 'Ljava/lang/String;') p('writeString', ['Ljava/lang/String;'], [value]);
    else if (ftype === 'Ljava/lang/CharSequence;') callStatic(r, 'Landroid/text/TextUtils;', 'writeToParcel', ['Ljava/lang/CharSequence;', PARCEL, 'I'], 'V', [value, parcel, 0]);
    else if (ftype === 'Landroid/os/Bundle;') p('writeBundle', ['Landroid/os/Bundle;'], [value]);
    else if (ftype === '[Ljava/lang/String;') p('writeStringArray', ['[Ljava/lang/String;'], [value]);
    else if (ftype === '[I') p('writeIntArray', ['[I'], [value]);
    else if (valueClass(ftype)) writeObject(r, parcel, ftype, value);
    else if (ftype.startsWith('[L') && valueClass(ftype.slice(1))) {
      if (nullish(value)) { p('writeInt', ['I'], [-1]); return; }
      const elements = r.array(value).elements; p('writeInt', ['I'], [elements.length]);
      for (const element of elements) writeObject(r, parcel, ftype.slice(1), element);
    } else throw new Error(`package value Parcel: no writer for ${ftype}`);
  };
  const writeObject = (r, parcel, ftype, value) => {
    if (nullish(value)) { call(r, parcel, PARCEL, 'writeInt', ['I'], 'V', [0]); return; }
    call(r, parcel, PARCEL, 'writeInt', ['I'], 'V', [1]);
    if (ftype === SIGNATURE) call(r, parcel, PARCEL, 'writeByteArray', ['[B'], 'V', [call(r, value, SIGNATURE, 'toByteArray', [], '[B')]);
    else call(r, value, ftype, 'writeToParcel', [PARCEL, 'I'], 'V', [parcel, 0]);
  };
  const readValue = (r, parcel, ftype) => {
    const q = (name, result, parameters = [], args = []) => call(r, parcel, PARCEL, name, parameters, result, args);
    if (SKIPPED_IN_PARCEL.has(ftype)) return defaultOf(ftype);
    if (ftype === 'I') return q('readInt', 'I'); if (ftype === 'Z') return q('readInt', 'I') !== 0 ? 1 : 0;
    if (ftype === 'J') return q('readLong', 'J'); if (ftype === 'F') return q('readFloat', 'F');
    if (ftype === 'Ljava/lang/String;') return q('readString', 'Ljava/lang/String;');
    if (ftype === 'Ljava/lang/CharSequence;') { const creator = r.readStatic({ owner: 'Landroid/text/TextUtils;', name: 'CHAR_SEQUENCE_CREATOR', type: CREATOR }); return call(r, creator, CREATOR, 'createFromParcel', [PARCEL], OBJECT, [parcel]); }
    if (ftype === 'Landroid/os/Bundle;') return q('readBundle', 'Landroid/os/Bundle;');
    if (ftype === '[Ljava/lang/String;') return q('createStringArray', '[Ljava/lang/String;');
    if (ftype === '[I') return q('createIntArray', '[I');
    if (valueClass(ftype)) return readObject(r, parcel, ftype);
    if (ftype.startsWith('[L') && valueClass(ftype.slice(1))) {
      const count = q('readInt', 'I'); if (count < 0) return null;
      const array = r.newArray(ftype, count), elements = r.array(array).elements; for (let i = 0; i < count; i++) elements[i] = readObject(r, parcel, ftype.slice(1));
      return array;
    }
    throw new Error(`package value Parcel: no reader for ${ftype}`);
  };
  const readObject = (r, parcel, ftype) => {
    if (call(r, parcel, PARCEL, 'readInt', [], 'I') === 0) return null;
    if (ftype === SIGNATURE) { const o = r.allocate(SIGNATURE); r.dispatch({ owner: SIGNATURE, name: '<init>', parameters: ['[B'], result: 'V', signature: '([B)V' }, [o, call(r, parcel, PARCEL, 'createByteArray', [], '[B')], 'direct'); return o; }
    const creator = r.readStatic({ owner: ftype, name: 'CREATOR', type: CREATOR });
    return call(r, creator, CREATOR, 'createFromParcel', [PARCEL], OBJECT, [parcel]);
  };
  const writeFields = (r, self, owner, parcel) => { for (const level of levels(owner)) for (const [name, ftype] of PACKAGE_VALUE_FIELDS[level]) writeValue(r, parcel, ftype, get(r, self, level, name, ftype)); };
  const readFields = (r, self, owner, parcel) => { for (const level of levels(owner)) for (const [name, ftype] of PACKAGE_VALUE_FIELDS[level]) if (!SKIPPED_IN_PARCEL.has(ftype)) put(r, self, level, name, ftype, readValue(r, parcel, ftype)); };
  for (const owner of [ITEM, COMPONENT, ...CONCRETE]) {
    def(owner, 'writeToParcel', `(${PARCEL}I)V`, (r, _m, [self, parcel]) => writeFields(r, self, owner, parcel));
    def(owner, '<init>', `(${PARCEL})V`, (r, _m, [self, parcel]) => { initialise(r, self, owner); readFields(r, self, owner, parcel); });
  }
  for (const owner of [...CONCRETE, SIGNATURE]) def(owner, 'describeContents', '()I', () => 0);
  def(SIGNATURE, 'writeToParcel', `(${PARCEL}I)V`, (r, _m, [self, parcel]) => call(r, parcel, PARCEL, 'writeByteArray', ['[B'], 'V', [call(r, self, SIGNATURE, 'toByteArray', [], '[B')]));

  // ---- Parcelable.Creator ----------------------------------------------------------------------------------------------------------------
  for (const owner of [...CONCRETE, SIGNATURE]) {
    const creatorType = `${owner.slice(0, -1)}$1;`;
    type(creatorType, OBJECT, [CREATOR], { allocatable: true });
    def(creatorType, 'createFromParcel', `(${PARCEL})${OBJECT}`, (r, _m, [, parcel]) => {
      if (owner === SIGNATURE) { const o = r.allocate(SIGNATURE); r.dispatch({ owner: SIGNATURE, name: '<init>', parameters: ['[B'], result: 'V', signature: '([B)V' }, [o, call(r, parcel, PARCEL, 'createByteArray', [], '[B')], 'direct'); return o; }
      const created = r.allocate(owner); initialise(r, created, owner); readFields(r, created, owner, parcel); return created;
    });
    def(creatorType, 'newArray', '(I)[Ljava/lang/Object;', (r, _m, [, size]) => { if (size < 0) r.throwJava('Ljava/lang/NegativeArraySizeException;', String(size)); return r.newArray(`[${owner}`, size); });
    registry.staticField(owner, 'CREATOR', CREATOR, r => r.allocate(creatorType));
  }

  // ---- toString (the android-13 forms) ---------------------------------------------------------------------------------------------------
  const identityHex = (r, self) => (call(r, self, OBJECT, 'hashCode', [], 'I') >>> 0).toString(16);
  def(`${PM}ApplicationInfo;`, 'toString', '()Ljava/lang/String;', (r, _m, [self]) => `ApplicationInfo{${identityHex(r, self)} ${get(r, self, ITEM, 'packageName', 'Ljava/lang/String;')}}`);
  def(`${PM}ServiceInfo;`, 'toString', '()Ljava/lang/String;', (r, _m, [self]) => `ServiceInfo{${identityHex(r, self)} ${get(r, self, ITEM, 'name', 'Ljava/lang/String;')}}`);

  // ---- ActivityManager.getDeviceConfigurationInfo / ConfigurationInfo.getGlEsVersion ------------------------------------------------------
  // The virtual device: a touch screen driven by a finger, no hardware keyboard, no navigation device. It carries no OpenGL ES implementation, so reqGlEsVersion is 0 (the framework answers
  // 0 when GL ES is absent) and getGlEsVersion() reports "0.0".
  const CONFIGURATION_INFO = `${PM}ConfigurationInfo;`;
  def('Landroid/app/ActivityManager;', 'getDeviceConfigurationInfo', `()${CONFIGURATION_INFO}`, r => {
    const info = r.allocate(CONFIGURATION_INFO);
    put(r, info, CONFIGURATION_INFO, 'reqTouchScreen', 'I', 3); put(r, info, CONFIGURATION_INFO, 'reqKeyboardType', 'I', 1); put(r, info, CONFIGURATION_INFO, 'reqNavigation', 'I', 1);
    put(r, info, CONFIGURATION_INFO, 'reqInputFeatures', 'I', 0); put(r, info, CONFIGURATION_INFO, 'reqGlEsVersion', 'I', 0);
    return info;
  });
  const glEsVersion = (r, self) => { const version = get(r, self, CONFIGURATION_INFO, 'reqGlEsVersion', 'I'); return `${version >>> 16}.${version & 0xffff}`; };
  def(CONFIGURATION_INFO, 'getGlEsVersion', '()Ljava/lang/String;', (r, _m, [self]) => glEsVersion(r, self));
  def(CONFIGURATION_INFO, 'toString', '()Ljava/lang/String;', (r, _m, [self]) => `ConfigurationInfo{reqTouchScreen=${get(r, self, CONFIGURATION_INFO, 'reqTouchScreen', 'I')} reqKeyboardType=${get(r, self, CONFIGURATION_INFO, 'reqKeyboardType', 'I')} reqNavigation=${get(r, self, CONFIGURATION_INFO, 'reqNavigation', 'I')} reqInputFeatures=${get(r, self, CONFIGURATION_INFO, 'reqInputFeatures', 'I')} reqGlEsVersion=0x${(get(r, self, CONFIGURATION_INFO, 'reqGlEsVersion', 'I') >>> 0).toString(16)}}`);
  return registry;
}
