// Which React Native (and Hermes bytecode) an APK was built with, read from the APK itself, so the lab only hands its React Native native libraries to an app
// they match (jni-host.js, `requires` in the library provenance).
//
// React Native keeps its version in com.facebook.react.modules.systeminfo.ReactNativeVersion.VERSION, a map {major, minor, patch, prerelease} built in <clinit>;
// R8 may inline that class into AndroidInfoModule.getTypedExportedConstants (`reactNativeVersion`), so both are scanned: a method that loads the strings
// "major", "minor" and "patch" in that order, each followed by an integer constant, gives the version. Nothing is executed.
// Hermes: the bytecode version in the header of assets/index.android.bundle (a Hermes bundle starts with the 0x1F1903C103BC1FC6 magic, then the u32 version).

const CONST_STRING = 0x1a, CONST_STRING_JUMBO = 0x1b, CONST_4 = 0x12, CONST_16 = 0x13, CONST = 0x14;

/** Integer constants (const/4, const/16, const) that are immediately passed to a static call (Integer.valueOf boxing), as [position, value] pairs in program order. */
function boxedIntegerConstants(units) {
  const out = [], INVOKE_STATIC = 0x71;
  for (let i = 0; i < units.length; i++) {
    const op = units[i] & 0xff;
    let value, width;
    if (op === CONST_4) { const v = units[i] >> 12; value = v > 7 ? v - 16 : v; width = 1; }
    else if (op === CONST_16 && i + 1 < units.length) { const v = units[i + 1]; value = v > 0x7fff ? v - 0x10000 : v; width = 2; }
    else if (op === CONST && i + 2 < units.length) { value = (units[i + 1] | (units[i + 2] << 16)) | 0; width = 3; }
    else continue;
    if ((units[i + width] & 0xff) === INVOKE_STATIC) out.push([i, value]);
  }
  return out;
}

/**
 * The version map is a Kotlin mapOf(...) of Integer.valueOf(n) values under the keys "major", "minor", "patch" (and a null "prerelease"). Two instruction orders occur
 * (R8 chooses): the three boxed integer constants first and then the three consecutive key strings, or each key string followed by its boxed integer. Either way the
 * version is the sequence of boxed integer constants paired with the three keys.
 */
function versionInMethod(cls, code) {
  const reader = cls.dex.reader, units = Array.from({ length: code.units }, (_, i) => reader.u16(code.offset + 2 * i)), strings = cls.dex.strings;
  const keys = {};
  for (let i = 0; i < units.length; i++) {
    const op = units[i] & 0xff;
    if (op !== CONST_STRING && op !== CONST_STRING_JUMBO) continue;
    const text = strings[op === CONST_STRING ? units[i + 1] : units[i + 1] | (units[i + 2] << 16)];
    if ((text === 'major' || text === 'minor' || text === 'patch') && !(text in keys)) keys[text] = i;
  }
  if (!('major' in keys && 'minor' in keys && 'patch' in keys)) return null;
  const boxed = boxedIntegerConstants(units);
  let values;
  if (keys.minor - keys.major <= 3 && keys.patch - keys.minor <= 3) values = boxed.filter(([position]) => position < keys.major).slice(-3).map(([, v]) => v);          // ints, then keys
  else values = ['major', 'minor', 'patch'].map(k => boxed.find(([position]) => position > keys[k])?.[1]);                                                                // key, then its int
  return values.length === 3 && values.every(v => Number.isInteger(v) && v >= 0 && v < 1000) ? { major: values[0], minor: values[1], patch: values[2] } : null;
}

/** The static field loaded right after the string `key` in a method (sget-object, op 0x62), as { owner, name }, or null. */
function fieldAfterString(cls, code, key) {
  const reader = cls.dex.reader, units = Array.from({ length: code.units }, (_, i) => reader.u16(code.offset + 2 * i)), strings = cls.dex.strings;
  for (let i = 0; i < units.length; i++) {
    if ((units[i] & 0xff) !== CONST_STRING || strings[units[i + 1]] !== key) continue;
    for (let k = i + 2; k < Math.min(units.length - 1, i + 8); k++) if ((units[k] & 0xff) === 0x62) { const field = cls.dex.fields[units[k + 1]]; return field ? { owner: field.owner, name: field.name } : null; }
  }
  return null;
}

/** { major, minor, patch, via } from the program's DEX, or null when the app carries no recognisable React Native version. */
export function detectReactNativeVersion(program) {
  const scan = (name, via = name) => {
    const cls = program.classes.get(name); if (!cls) return null;
    for (const { code } of cls.methods.values()) {
      if (!code?.units || code.units > 4096) continue;
      const version = versionInMethod(cls, code);
      if (version) return { ...version, via: via.slice(1, -1).replaceAll('/', '.') };
    }
    return null;
  };
  const direct = scan('Lcom/facebook/react/modules/systeminfo/ReactNativeVersion;') ?? scan('Lcom/facebook/react/modules/systeminfo/AndroidInfoModule;');
  if (direct) return direct;
  // R8 may have moved the version map to another class: AndroidInfoModule loads it right after the key "reactNativeVersion"
  const info = program.classes.get('Lcom/facebook/react/modules/systeminfo/AndroidInfoModule;');
  for (const { code } of info?.methods.values() ?? []) {
    if (!code?.units || code.units > 4096) continue;
    const field = fieldAfterString(info, code, 'reactNativeVersion');
    const found = field && scan(field.owner, 'Lcom/facebook/react/modules/systeminfo/AndroidInfoModule;');
    if (found) return found;
  }
  return null;
}
export const formatVersion = v => v ? `${v.major}.${v.minor}.${v.patch}` : null;

/** Hermes bytecode version of the app's JS bundle (Hermes bundles only), or null. Reads 12 bytes. */
export async function detectHermesBytecodeVersion(archive) {
  const path = 'assets/index.android.bundle';
  if (!archive.entries.has(path)) return null;
  const header = await archive.extractPrefix(path, 12);
  if (header.length < 12) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return view.getBigUint64(0, true) === 0x1f1903c103bc1fc6n ? view.getUint32(8, true) : null;
}
