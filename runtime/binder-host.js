import { createHostRegistry } from './host-contract.js?v=5baf5691b052';

// The platform side of android.os.Parcel (original Parcel.java in framework.dex, natives in parcel-native.js): hidden framework hooks Parcel calls around transactions, and the
// Parcel serialisation of the VM's Bundle/PersistableBundle (BaseBundle.writeToParcelInner / readFromParcelInner wire format: length, BUNDLE_MAGIC, count, then key + typed value
// per entry). Bundles are host objects (src/android-platform.js); their entries are converted to Java values and written with the original Parcel.writeValue, and read back with
// Parcel.readValue, so every value type Parcel supports (primitives, Strings, arrays, Parcelables, nested Bundles, Serializables, lists) round-trips.
const PARCEL = 'Landroid/os/Parcel;', BUNDLE = 'Landroid/os/Bundle;', PERSISTABLE = 'Landroid/os/PersistableBundle;', BASE = 'Landroid/os/BaseBundle;', LOADER = 'Ljava/lang/ClassLoader;';
const BUNDLE_MAGIC = 0x4C444E42, BOXES = { 'Ljava/lang/Integer;': 'I', 'Ljava/lang/Long;': 'J', 'Ljava/lang/Boolean;': 'Z', 'Ljava/lang/Float;': 'F', 'Ljava/lang/Double;': 'D', 'Ljava/lang/Short;': 'S', 'Ljava/lang/Byte;': 'B', 'Ljava/lang/Character;': 'C' };

export function createBinderHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  // Hidden hooks Parcel.writeNoException/readException call (cross-process StrictMode violation transport and AppOps noting): no violations or noted ops exist in-process.
  def('Landroid/os/StrictMode;', 'hasGatheredViolations', '()Z', () => 0, { static: true });
  def('Landroid/os/StrictMode;', 'clearGatheredViolations', '()V', () => {}, { static: true });
  def('Landroid/os/StrictMode;', 'writeGatheredViolationsToParcel', `(${PARCEL})V`, () => {}, { static: true });
  def('Landroid/os/StrictMode;', 'readAndHandleBinderCallViolations', `(${PARCEL})V`, () => {}, { static: true });
  def('Landroid/app/AppOpsManager;', 'prefixParcelWithAppOpsIfNeeded', `(${PARCEL})V`, () => {}, { static: true });
  def('Landroid/app/AppOpsManager;', 'readAndLogNotedAppops', `(${PARCEL})V`, () => {}, { static: true });

  const p = (r, parcel, name, parameters, result, args = []) => r.dispatch({ owner: PARCEL, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [parcel, ...args], 'virtual');
  /** The Java value of a Bundle entry: boxed primitives become java.lang boxes (the same conversion Bundle.get performs), everything else is the stored reference. */
  const javaValue = (r, bundle, key) => platform.bundleInvoke(r, { name: 'get', parameters: [] }, [bundle, key]);
  /** A Java value read from a Parcel -> the typed entry the VM's bundles keep. */
  const entryOf = (r, value) => {
    if (value === null || value === 0) return { type: 'Ljava/lang/String;', value: null };
    if (typeof value === 'string') return { type: 'Ljava/lang/String;', value };
    const object = r.object(value), type = object.type, primitive = BOXES[type];
    if (primitive) return { type: primitive, value: primitive === 'J' ? BigInt(object.boxed) : object.boxed };
    if (r.isSubtype(type, BUNDLE) || r.isSubtype(type, PERSISTABLE)) return { type: r.isSubtype(type, PERSISTABLE) ? PERSISTABLE : BUNDLE, value };
    if (type.startsWith('[')) return { type, value };
    if (r.isSubtype(type, 'Ljava/util/ArrayList;') || type === 'Ljava/util/ArrayList;') return { type: 'Ljava/util/ArrayList;', value };
    if (r.isSubtype(type, 'Landroid/os/Parcelable;')) return { type: 'Landroid/os/Parcelable;', value };
    if (r.isSubtype(type, 'Ljava/lang/CharSequence;')) return { type: 'Ljava/lang/CharSequence;', value };
    return { type: 'Ljava/io/Serializable;', value };
  };

  function writeBundle(r, bundle, parcel) {
    const entries = platform.extras(r, bundle);
    if (entries.size === 0) { p(r, parcel, 'writeInt', ['I'], 'V', [0]); return; }
    const lengthPosition = p(r, parcel, 'dataPosition', [], 'I');
    p(r, parcel, 'writeInt', ['I'], 'V', [-1]); p(r, parcel, 'writeInt', ['I'], 'V', [BUNDLE_MAGIC]);
    const start = p(r, parcel, 'dataPosition', [], 'I');
    p(r, parcel, 'writeInt', ['I'], 'V', [entries.size]);
    for (const key of [...entries.keys()]) { p(r, parcel, 'writeString', ['Ljava/lang/String;'], 'V', [key]); p(r, parcel, 'writeValue', ['Ljava/lang/Object;'], 'V', [javaValue(r, bundle, key)]); }
    const end = p(r, parcel, 'dataPosition', [], 'I');
    p(r, parcel, 'setDataPosition', ['I'], 'V', [lengthPosition]); p(r, parcel, 'writeInt', ['I'], 'V', [end - start]); p(r, parcel, 'setDataPosition', ['I'], 'V', [end]);
  }
  function readBundle(r, bundle, parcel, length, loader) {
    const entries = platform.extras(r, bundle); entries.clear();
    if (length < 0) r.throwJava('Ljava/lang/NegativeArraySizeException;', 'Bad length in parcel: ' + length);
    if (length === 0) return;
    if (length & 3) r.throwJava('Landroid/os/BadParcelableException;', 'Bundle length is not aligned by 4: ' + length);
    const magic = p(r, parcel, 'readInt', [], 'I');
    if (magic !== BUNDLE_MAGIC) r.throwJava('Landroid/os/BadParcelableException;', 'Bad magic number for Bundle: 0x' + (magic >>> 0).toString(16));
    const count = p(r, parcel, 'readInt', [], 'I');
    for (let i = 0; i < count; i++) {
      const key = p(r, parcel, 'readString', [], 'Ljava/lang/String;'), value = p(r, parcel, 'readValue', [LOADER], 'Ljava/lang/Object;', [loader ?? null]);
      entries.set(r.stringCharacters(key), entryOf(r, value));
    }
    r.object(bundle).bundleVersion = (r.object(bundle).bundleVersion || 0) + 1;
  }
  for (const owner of [BUNDLE, PERSISTABLE]) {
    def(owner, '<init>', `(${PARCEL}I)V`, (r, _m, [self, parcel, length]) => { r.object(self).extras = new Map(); readBundle(r, self, parcel, length, r.object(self).classLoader ?? null); });
    def(owner, 'writeToParcel', `(${PARCEL}I)V`, (r, _m, [self, parcel]) => writeBundle(r, self, parcel));
    def(owner, 'readFromParcel', `(${PARCEL})V`, (r, _m, [self, parcel]) => { const length = p(r, parcel, 'readInt', [], 'I'); readBundle(r, self, parcel, length, r.object(self).classLoader ?? null); });
    def(owner, 'describeContents', '()I', () => 0);
  }
  return { ...registry };
}
