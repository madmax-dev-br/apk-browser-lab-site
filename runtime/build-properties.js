// The ro.* system properties android.os.Build reads its identity fields from (android-13.0.0_r1 Build.java): on a device each property and its Build field hold the same
// value. The lab's Build fields come from the device model; these properties are answered from those same fields, so native code reading properties and Java code reading
// Build see one device (src/arm64/glue.js, src/adb-commands.js getprop).
export const BUILD_PROPS = [['ro.product.model', 'MODEL'], ['ro.product.manufacturer', 'MANUFACTURER'], ['ro.product.brand', 'BRAND'], ['ro.product.device', 'DEVICE'], ['ro.product.name', 'PRODUCT'], ['ro.hardware', 'HARDWARE'], ['ro.build.fingerprint', 'FINGERPRINT'],
  ['ro.build.id', 'ID'], ['ro.build.display.id', 'DISPLAY'], ['ro.build.type', 'TYPE'], ['ro.build.tags', 'TAGS'], ['ro.build.version.release', 'VERSION.RELEASE'], ['ro.build.version.sdk', 'VERSION.SDK_INT'], ['ro.build.version.codename', 'VERSION.CODENAME'], ['ro.build.version.incremental', 'VERSION.INCREMENTAL']];

/** The value of property `name` from the runtime's Build fields, or null when it is not one of BUILD_PROPS (or the field has no value). */
export function buildProperty(runtime, name) {
  const entry = BUILD_PROPS.find(([property]) => property === name); if (!entry) return null;
  const [owner, field] = entry[1].startsWith('VERSION.') ? ['Landroid/os/Build$VERSION;', entry[1].slice(8)] : ['Landroid/os/Build;', entry[1]];
  const type = field === 'SDK_INT' ? 'I' : 'Ljava/lang/String;';
  const value = runtime.readStatic({ owner, name: field, type, key: `${owner}->${field}:${type}` });
  if (value === null || value === undefined) return null;
  return type === 'I' ? String(value) : runtime.stringCharacters(value);
}
