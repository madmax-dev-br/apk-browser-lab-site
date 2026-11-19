// Which React Native (and Hermes bytecode) an APK was built with, read from the APK itself, so the lab only hands its React Native native libraries to an app
// they match (jni-host.js, `requires` in the library provenance).
//
// React Native keeps its version in com.facebook.react.modules.systeminfo.ReactNativeVersion.VERSION, a map {major, minor, patch, prerelease} built in <clinit>;
// R8 may inline that class into AndroidInfoModule.getTypedExportedConstants (`reactNativeVersion`), so both are scanned: a method that loads the strings
// "major", "minor" and "patch" in that order, each followed by an integer constant, gives the version. Nothing is executed.
// Hermes: the bytecode version in the header of assets/index.android.bundle (a Hermes bundle starts with the 0x1F1903C103BC1FC6 magic, then the u32 version).

const CONST_STRING = 0x1a, CONST_STRING_JUMBO = 0x1b, CONST_4 = 0x12, CONST_16 = 0x13, CONST = 0x14;

/**
 * The integers boxed by Integer.valueOf in program order, as [position, value] pairs: a register's value is the last const/4, const/16 or const written to it, so a constant
 * that d8/R8 loaded once and passed to several valueOf calls (0.0.0: one register for the three zeros) is seen at each call.
 */
function boxedIntegerConstants(units, dex) {
  const out = [], regs = new Map(), INVOKE_STATIC = 0x71, INVOKE_STATIC_RANGE = 0x77;
  for (let i = 0; i < units.length; i++) {
    const op = units[i] & 0xff;
    if (op === CONST_4) { const v = units[i] >> 12; regs.set((units[i] >> 8) & 0xf, v > 7 ? v - 16 : v); continue; }
    if (op === CONST_16 && i + 1 < units.length) { const v = units[i + 1]; regs.set((units[i] >> 8) & 0xff, v > 0x7fff ? v - 0x10000 : v); i += 1; continue; }
    if (op === CONST && i + 2 < units.length) { regs.set((units[i] >> 8) & 0xff, (units[i + 1] | (units[i + 2] << 16)) | 0); i += 2; continue; }
    if ((op === INVOKE_STATIC || op === INVOKE_STATIC_RANGE) && i + 2 < units.length) {
      const index = units[i + 1], ref = dex && index < dex.methods.length ? dex.method(index) : null;
      if (ref && !(ref.owner === 'Ljava/lang/Integer;' && ref.name === 'valueOf')) { i += 2; continue; }
      const reg = op === INVOKE_STATIC ? units[i + 2] & 0xf : units[i + 2];
      if (regs.has(reg)) out.push([i, regs.get(reg)]);
      i += 2; continue;
    }
  }
  return out;
}

/** Code units of the Dalvik instruction at `i` (payload pseudo-instructions included). */
function width(units, i) {
  const op = units[i] & 0xff;
  if (op === 0x00) { const kind = units[i] >> 8; if (kind === 1) return units[i + 1] * 2 + 4; if (kind === 2) return units[i + 1] * 4 + 2; if (kind === 3) return 4 + Math.ceil(units[i + 1] * (units[i + 2] | (units[i + 3] << 16)) / 2); return 1; }
  if (op === 0x18) return 5;
  if ([0x03, 0x06, 0x09, 0x14, 0x17, 0x1b, 0x24, 0x25, 0x26, 0x2a, 0x2b, 0x2c, 0xfc, 0xfd].includes(op) || (op >= 0x6e && op <= 0x72) || (op >= 0x74 && op <= 0x78)) return 3;
  if (op === 0xfa || op === 0xfb) return 4;
  if ([0x02, 0x05, 0x08, 0x13, 0x15, 0x16, 0x19, 0x1a, 0x1c, 0x1f, 0x20, 0x22, 0x23, 0x29, 0xfe, 0xff].includes(op) || (op >= 0x2d && op <= 0x3d) || (op >= 0x44 && op <= 0x6d) || (op >= 0x90 && op <= 0xaf) || (op >= 0xd0 && op <= 0xe2)) return 2;
  return 1;
}
const KEYS = ['major', 'minor', 'patch', 'prerelease'];
/**
 * The version map of a straight-line method, by simulating its registers: a key string and a value go into the same call (HashMap.put(key, value), Kotlin's TuplesKt.to(key,
 * value), new Pair(key, value)); a value is an Integer boxed by Integer.valueOf of a constant -- d8/R8 often box a constant once and pass the same object for several keys (0.0.0:
 * one boxed 0 for the three) -- or, for "prerelease", a string or null. -> { major, minor, patch, prerelease } or null.
 */
function versionBySimulation(dex, units) {
  const ints = new Map(), boxed = new Map(), strings = new Map(), found = {}; let pending = null;
  for (let i = 0; i < units.length; i += Math.max(1, width(units, i))) {
    const op = units[i] & 0xff, a = (units[i] >> 8) & 0xff, forget = reg => { ints.delete(reg); boxed.delete(reg); strings.delete(reg); };
    if (op === 0x12) { const reg = a & 0xf, v = units[i] >> 12; forget(reg); ints.set(reg, v > 7 ? v - 16 : v); continue; }
    if (op === 0x13) { forget(a); const v = units[i + 1]; ints.set(a, v > 0x7fff ? v - 0x10000 : v); continue; }
    if (op === 0x14) { forget(a); ints.set(a, (units[i + 1] | (units[i + 2] << 16)) | 0); continue; }
    if (op === 0x1a || op === 0x1b) { forget(a); const index = op === 0x1a ? units[i + 1] : units[i + 1] | (units[i + 2] << 16); if (index < dex.strings.length) strings.set(a, dex.string(index)); continue; }
    if (op === 0x0c) { forget(a); if (pending !== null) boxed.set(a, pending); pending = null; continue; }   // move-result-object after Integer.valueOf
    if (op === 0x07 || op === 0x08) { const to = op === 0x07 ? a & 0xf : a, from = op === 0x07 ? a >> 4 : units[i + 1]; const b = boxed.get(from), t = strings.get(from), n = ints.get(from); forget(to); if (b !== undefined) boxed.set(to, b); if (t !== undefined) strings.set(to, t); if (n !== undefined) ints.set(to, n); continue; }
    pending = null;
    if ((op >= 0x6e && op <= 0x72) || (op >= 0x74 && op <= 0x78)) {
      const index = units[i + 1], ref = index < dex.methods.length ? dex.method(index) : null, range = op >= 0x74;
      const count = range ? a : a >> 4, last = units[i + 2], regs = range ? Array.from({ length: count }, (_, k) => last + k) : [last & 0xf, (last >> 4) & 0xf, (last >> 8) & 0xf, last >> 12, a & 0xf].slice(0, count);
      if (ref?.owner === 'Ljava/lang/Integer;' && ref.name === 'valueOf' && ints.has(regs[0])) { pending = ints.get(regs[0]); continue; }
      const keyReg = regs.find(reg => KEYS.includes(strings.get(reg)));
      if (keyReg !== undefined) {
        const key = strings.get(keyReg), rest = regs.filter(reg => reg !== keyReg);
        if (key === 'prerelease') { if (!(key in found)) { const text = rest.map(reg => strings.get(reg)).find(value => value !== undefined); found[key] = text ?? (rest.some(reg => ints.get(reg) === 0) ? null : undefined); } }
        else if (!(key in found)) { const value = rest.map(reg => boxed.get(reg)).find(v => v !== undefined); if (value !== undefined) found[key] = value; }
      }
      continue;
    }
  }
  if (!['major', 'minor', 'patch'].every(key => Number.isInteger(found[key]) && found[key] >= 0 && found[key] < 1000)) return null;
  const prerelease = typeof found.prerelease === 'string' && /^[0-9A-Za-z.-]{1,80}$/.test(found.prerelease) ? found.prerelease : null;
  return { major: found.major, minor: found.minor, patch: found.patch, prerelease };
}

/**
 * The version map is a Kotlin mapOf(...) of Integer.valueOf(n) values under the keys "major", "minor", "patch" (and a null "prerelease"). Two instruction orders occur
 * (R8 chooses): the three boxed integer constants first and then the three consecutive key strings, or each key string followed by its boxed integer. Either way the
 * version is the sequence of boxed integer constants paired with the three keys.
 */
function versionInMethod(cls, code) {
  const dex = cls.dex, reader = dex.reader, units = Array.from({ length: code.units }, (_, i) => reader.u16(code.offset + 2 * i));
  const simulated = versionBySimulation(dex, units); if (simulated) return simulated;
  const keys = {};
  for (let i = 0; i < units.length; i++) {
    const op = units[i] & 0xff;
    if (op !== CONST_STRING && op !== CONST_STRING_JUMBO) continue;
    const index = op === CONST_STRING ? units[i + 1] : units[i + 1] | (units[i + 2] << 16), text = index < dex.strings.length ? dex.string(index) : undefined;
    if ((text === 'major' || text === 'minor' || text === 'patch') && !(text in keys)) keys[text] = i;
  }
  if (!('major' in keys && 'minor' in keys && 'patch' in keys)) return null;
  const boxed = boxedIntegerConstants(units, dex);
  let values;
  if (keys.minor - keys.major <= 3 && keys.patch - keys.minor <= 3) values = boxed.filter(([position]) => position < keys.major).slice(-3).map(([, v]) => v);          // ints, then keys
  else values = ['major', 'minor', 'patch'].map(k => boxed.find(([position]) => position > keys[k])?.[1]);                                                                // key, then its int
  if (!(values.length === 3 && values.every(v => Number.isInteger(v) && v >= 0 && v < 1000))) return null;
  // "prerelease": null for a release; a string for a nightly or canary (React Native publishes nightlies as 0.0.0-<yyyymmdd>-<hhmm>-<commit>), loaded by const-string. The value is
  // the string loaded right after the key, or, in a method that builds only the version map (the keys and that one value), its only other string.
  let prerelease = null;
  const strings = [];
  for (let i = 0; i < units.length; i++) { const op = units[i] & 0xff; if (op !== CONST_STRING && op !== CONST_STRING_JUMBO) continue; const index = op === CONST_STRING ? units[i + 1] : units[i + 1] | (units[i + 2] << 16); if (index < dex.strings.length) strings.push([i, dex.string(index)]); }
  const keyAt = strings.find(([, text]) => text === 'prerelease')?.[0];
  if (keyAt !== undefined) {
    const after = strings.find(([position, text]) => position > keyAt && position - keyAt <= 6 && !['major', 'minor', 'patch', 'prerelease'].includes(text));
    const others = strings.filter(([, text]) => !['major', 'minor', 'patch', 'prerelease'].includes(text));
    const text = after?.[1] ?? (others.length === 1 && units.length <= 96 ? others[0][1] : null);
    if (typeof text === 'string' && /^[0-9A-Za-z.-]{1,80}$/.test(text)) prerelease = text;
  }
  return { major: values[0], minor: values[1], patch: values[2], prerelease };
}

/** The static field loaded right after the string `key` in a method (sget-object, op 0x62), as { owner, name }, or null. */
function fieldAfterString(cls, code, key) {
  const dex = cls.dex, reader = dex.reader, units = Array.from({ length: code.units }, (_, i) => reader.u16(code.offset + 2 * i));
  for (let i = 0; i < units.length; i++) {
    if ((units[i] & 0xff) !== CONST_STRING || !(units[i + 1] < dex.strings.length) || dex.string(units[i + 1]) !== key) continue;
    for (let k = i + 2; k < Math.min(units.length - 1, i + 8); k++) if ((units[k] & 0xff) === 0x62) { const field = units[k + 1] < dex.fields.length ? dex.field(units[k + 1]) : null; return field ? { owner: field.owner, name: field.name } : null; }
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
export const formatVersion = v => v ? `${v.major}.${v.minor}.${v.patch}${v.prerelease ? `-${v.prerelease}` : ''}` : null;
/** A React Native version that is not a release: a nightly (0.0.0-<date>-<time>-<commit>), any prerelease, or a build from source that left the version unstamped (0.0.0). */
export const isUnreleased = v => !!v && (!!v.prerelease || (v.major === 0 && v.minor === 0 && v.patch === 0));
/** The commit of a nightly's version string (0.0.0-20250604-2005-abc1234 -> abc1234), or null. */
export const nightlyCommit = v => /(?:^|-)([0-9a-f]{7,40})$/.exec(v?.prerelease ?? '')?.[1] ?? null;

/** Hermes bytecode version of the app's JS bundle (Hermes bundles only), or null. Reads 12 bytes. */
export async function detectHermesBytecodeVersion(archive) {
  const path = 'assets/index.android.bundle';
  if (!archive.entries.has(path)) return null;
  const header = await archive.extractPrefix(path, 12);
  if (header.length < 12) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return view.getBigUint64(0, true) === 0x1f1903c103bc1fc6n ? view.getUint32(8, true) : null;
}
