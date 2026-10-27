import { gcRoot } from './heap-gc.js?v=751a2d13ee0f';
import { APKError } from './apk-error.js?v=751a2d13ee0f';
import { createHostRegistry, doubleBits, floatBits, bitsFloat, bitsDouble as bitsDoubleLocal } from './host-contract.js?v=751a2d13ee0f';

// Process-level Android services needed by production apps' startup paths (StrictMode, telephony math, ...).
// Each entry is a contract reimplementation of the named AOSP method (android-13.0.0_r1 sources noted inline) over
// the browser VM's single virtual process. Nothing here pretends an effect happened: where the browser VM cannot
// observe a behavior (e.g. StrictMode violation detection) the policy is *stored* with Android semantics and the
// absence of detection is documented, never reported as detected/enforced.

// ---- android.os.StrictMode (frameworks/base/core/java/android/os/StrictMode.java) ----------------------------
const STRICT = 'Landroid/os/StrictMode;', THREAD_POLICY = 'Landroid/os/StrictMode$ThreadPolicy;', THREAD_BUILDER = 'Landroid/os/StrictMode$ThreadPolicy$Builder;';
const VM_POLICY = 'Landroid/os/StrictMode$VmPolicy;', VM_BUILDER = 'Landroid/os/StrictMode$VmPolicy$Builder;';
const DETECT_THREAD_DISK_WRITE = 0x01, DETECT_THREAD_DISK_READ = 0x02, DETECT_THREAD_NETWORK = 0x04, DETECT_THREAD_CUSTOM = 0x08,
  DETECT_THREAD_RESOURCE_MISMATCH = 0x10, DETECT_THREAD_UNBUFFERED_IO = 0x20, DETECT_THREAD_EXPLICIT_GC = 0x40;
const PENALTY_LOG = 0x01 << 16, PENALTY_DIALOG = 0x02 << 16, PENALTY_DEATH = 0x04 << 16, PENALTY_DROPBOX = 0x08 << 16, PENALTY_FLASH = 0x10 << 16, PENALTY_DEATH_ON_NETWORK = 0x20 << 16, PENALTY_DEATH_ON_CLEARTEXT_NETWORK = 0x40 << 16;
const ALL_THREAD_DETECT_BITS = DETECT_THREAD_DISK_WRITE | DETECT_THREAD_DISK_READ | DETECT_THREAD_NETWORK | DETECT_THREAD_CUSTOM | DETECT_THREAD_RESOURCE_MISMATCH | DETECT_THREAD_UNBUFFERED_IO | DETECT_THREAD_EXPLICIT_GC;

const STRING_T = 'Ljava/lang/String;';
export function createSystemServicesHost(platform) {
  const registry = createHostRegistry(), { def } = registry, PARENTS = registry.parents;
  // The VM has exactly one thread; its StrictMode policy lives here (StrictMode.sThreadPolicy / BlockGuard policy).
  for (const owner of [THREAD_POLICY, THREAD_BUILDER, VM_POLICY, VM_BUILDER]) registry.type(owner, 'Ljava/lang/Object;', [], { allocatable: true });
  const state = { threadPolicyMask: 0, vmPolicyMask: 0, violationsDetected: 0 };
  const policy = (runtime, mask) => { const ref = runtime.makeObject(THREAD_POLICY); runtime.object(ref).strictMask = mask; return ref; };
  const maskOf = (runtime, ref) => { if (ref === null) runtime.throwJava('Ljava/lang/NullPointerException;', 'policy'); return runtime.object(ref).strictMask ?? 0; };
  const setMask = (runtime, mask, why) => { if (mask !== state.threadPolicyMask) runtime.record(`STRICTMODE thread policy 0x${mask.toString(16)} (${why}); violations are not detected in the browser VM`); state.threadPolicyMask = mask; };

  def(STRICT, 'allowThreadDiskWrites', `()${THREAD_POLICY}`, (runtime) => {
    const old = state.threadPolicyMask, next = old & ~(DETECT_THREAD_DISK_WRITE | DETECT_THREAD_DISK_READ);
    setMask(runtime, next, 'allowThreadDiskWrites'); return policy(runtime, old);
  }, { static: true });
  def(STRICT, 'allowThreadDiskReads', `()${THREAD_POLICY}`, (runtime) => {
    const old = state.threadPolicyMask, next = old & ~DETECT_THREAD_DISK_READ;
    setMask(runtime, next, 'allowThreadDiskReads'); return policy(runtime, old);
  }, { static: true });
  def(STRICT, 'getThreadPolicy', `()${THREAD_POLICY}`, (runtime) => policy(runtime, state.threadPolicyMask), { static: true });
  def(STRICT, 'setThreadPolicy', `(${THREAD_POLICY})V`, (runtime, _m, [p]) => setMask(runtime, maskOf(runtime, p), 'setThreadPolicy'), { static: true });
  def(THREAD_POLICY, 'toString', '()Ljava/lang/String;', (runtime, _m, [p]) => `StrictMode.ThreadPolicy{mask=${maskOf(runtime, p)}}`);
  // ThreadPolicy.LAX is a constant policy of mask 0 (static field; see readStatic).
  def(THREAD_BUILDER, '<init>', '()V', (runtime, _m, [b]) => { runtime.object(b).strictMask = state.threadPolicyMask; });
  def(THREAD_BUILDER, '<init>', `(${THREAD_POLICY})V`, (runtime, _m, [b, p]) => { runtime.object(b).strictMask = maskOf(runtime, p); });   // Builder(ThreadPolicy): start from an existing policy's mask
  const builderBits = (name, bits, enable) => def(THREAD_BUILDER, name, `()${THREAD_BUILDER}`, (runtime, _m, [b]) => { const o = runtime.object(b); o.strictMask = enable ? o.strictMask | bits : o.strictMask & ~bits; return b; });
  builderBits('detectAll', ALL_THREAD_DETECT_BITS, true); builderBits('permitAll', ALL_THREAD_DETECT_BITS, false);
  builderBits('detectDiskReads', DETECT_THREAD_DISK_READ, true); builderBits('permitDiskReads', DETECT_THREAD_DISK_READ, false);
  builderBits('detectDiskWrites', DETECT_THREAD_DISK_WRITE, true); builderBits('permitDiskWrites', DETECT_THREAD_DISK_WRITE, false);
  builderBits('detectNetwork', DETECT_THREAD_NETWORK, true); builderBits('permitNetwork', DETECT_THREAD_NETWORK, false);
  builderBits('detectCustomSlowCalls', DETECT_THREAD_CUSTOM, true); builderBits('permitCustomSlowCalls', DETECT_THREAD_CUSTOM, false);
  builderBits('penaltyLog', PENALTY_LOG, true); builderBits('penaltyDeath', PENALTY_DEATH, true); builderBits('penaltyDialog', PENALTY_DIALOG, true); builderBits('penaltyFlashScreen', PENALTY_FLASH, true);
  builderBits('detectResourceMismatches', DETECT_THREAD_RESOURCE_MISMATCH, true); builderBits('permitResourceMismatches', DETECT_THREAD_RESOURCE_MISMATCH, false); builderBits('detectUnbufferedIo', DETECT_THREAD_UNBUFFERED_IO, true); builderBits('permitUnbufferedIo', DETECT_THREAD_UNBUFFERED_IO, false);
  builderBits('detectExplicitGc', DETECT_THREAD_EXPLICIT_GC, true); builderBits('permitExplicitGc', DETECT_THREAD_EXPLICIT_GC, false); builderBits('penaltyDeathOnNetwork', PENALTY_DEATH_ON_NETWORK, true); builderBits('penaltyDropBox', PENALTY_DROPBOX, true);
  def(THREAD_BUILDER, 'build', `()${THREAD_POLICY}`, (runtime, _m, [b]) => policy(runtime, runtime.object(b).strictMask));
  // VmPolicy: stored only; none of its detectors (leaks, cleartext, untagged sockets) can fire in the browser VM.
  def(VM_BUILDER, '<init>', '()V', (runtime, _m, [b]) => { runtime.object(b).strictMask = 0; });
  for (const name of ['detectAll', 'detectLeakedClosableObjects', 'detectLeakedSqlLiteObjects', 'detectActivityLeaks', 'detectLeakedRegistrationObjects', 'detectFileUriExposure', 'detectCleartextNetwork', 'detectContentUriWithoutPermission', 'detectUntaggedSockets', 'penaltyLog', 'penaltyDeath', 'penaltyDropBox', 'penaltyDeathOnCleartextNetwork', 'penaltyDeathOnFileUriExposure', 'permitUnsafeIntentLaunch', 'detectNonSdkApiUsage', 'permitNonSdkApiUsage'])
    def(VM_BUILDER, name, `()${VM_BUILDER}`, (_r, _m, [b]) => b);
  def(VM_BUILDER, 'build', `()${VM_POLICY}`, (runtime) => runtime.makeObject(VM_POLICY));
  def(STRICT, 'setVmPolicy', `(${VM_POLICY})V`, (runtime, _m, [p]) => { if (p === null) runtime.throwJava('Ljava/lang/NullPointerException;', 'policy'); runtime.record('STRICTMODE vm policy stored; no VM violation detection'); }, { static: true });
  def(STRICT, 'getVmPolicy', `()${VM_POLICY}`, (runtime) => runtime.makeObject(VM_POLICY), { static: true });
  def(STRICT, 'enableDefaults', '()V', (runtime) => setMask(runtime, state.threadPolicyMask | ALL_THREAD_DETECT_BITS | PENALTY_LOG, 'enableDefaults'), { static: true });

  // ---- android.telephony.cdma.CdmaCellLocation (android-13.0.0_r1) ----------------------------------------------
  const CDMA = 'Landroid/telephony/cdma/CdmaCellLocation;';
  PARENTS.set(CDMA, 'Ljava/lang/Object;');
  def(CDMA, 'convertQuartSecToDecDegrees', '(I)D', (runtime, _m, [quartSec]) => {
    // if (Double.isNaN(quartSec) || quartSec < -2592000 || quartSec > 2592000) throw IAE("Invalid coordiante value:" + quartSec);
    if (quartSec < -2592000 || quartSec > 2592000) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'Invalid coordiante value:' + quartSec);
    return doubleBits(quartSec / (3600 * 4));
  }, { static: true });

  // ---- android.os.Build (browser VM device identity; framework resources/classes are Android 13-based but SDK_INT stays the VM's declared api level (28; moving it to 33 changes AppCompat/Material code paths and breaks 20+ UI tests, see the task 21 report), whatever the app's targetSdkVersion) ----
  const BUILD = 'Landroid/os/Build;', stringArray = values => runtime => { const array = runtime.newArray('[Ljava/lang/String;', values.length); runtime.array(array).elements = values.slice(); return array; };
  registry.staticField(BUILD, 'SUPPORTED_ABIS', '[Ljava/lang/String;', stringArray(['wasm32']));
  registry.staticField(BUILD, 'SUPPORTED_32_BIT_ABIS', '[Ljava/lang/String;', stringArray(['wasm32']));
  registry.staticField(BUILD, 'SUPPORTED_64_BIT_ABIS', '[Ljava/lang/String;', stringArray([]));
  for (const [name, value] of Object.entries({ BOARD: 'apkweb', BOOTLOADER: 'unknown', HOST: 'apkweb-host', USER: 'apkweb', RADIO: 'unknown', SERIAL: 'unknown' })) registry.staticField(BUILD, name, 'Ljava/lang/String;', () => value);
  registry.staticField(BUILD, 'TIME', 'J', () => 0n); registry.staticField(BUILD, 'IS_DEBUGGABLE', 'Z', () => 0);
  const BUILD_VERSION = 'Landroid/os/Build$VERSION;';
  for (const [name, value] of Object.entries({ RELEASE: '9', INCREMENTAL: 'apkweb', CODENAME: 'REL', SECURITY_PATCH: '', BASE_OS: '', RELEASE_OR_CODENAME: '9', RELEASE_OR_PREVIEW_DISPLAY: '9' })) registry.staticField(BUILD_VERSION, name, 'Ljava/lang/String;', () => value);
  registry.staticField(BUILD_VERSION, 'PREVIEW_SDK_INT', 'I', () => 0);

  // ---- Byte/Short/Long string parsing (java.lang.Long.parseLong semantics: optional sign, digits of the radix, range check; Integer.parseInt is a VM bridge) ----
  const parseWhole = (r, value, radix, min, max, withRadix) => {
    const fail = () => r.throwJava('Ljava/lang/NumberFormatException;', value === null ? 'Cannot parse null string: null' : `For input string: "${r.stringCharacters(value)}"${withRadix && radix !== 10 ? ` under radix ${radix}` : ''}`);
    if (value === null) fail();
    if (radix < 2 || radix > 36) r.throwJava('Ljava/lang/NumberFormatException;', `radix ${radix} ${radix < 2 ? 'less than Character.MIN_RADIX' : 'greater than Character.MAX_RADIX'}`);
    const text = r.stringCharacters(value), m = /^([+-]?)([0-9a-zA-Z]+)$/.exec(text); if (!m) fail();
    let n = 0n; for (const ch of m[2].toLowerCase()) { const d = parseInt(ch, 36); if (d >= radix) fail(); n = n * BigInt(radix) + BigInt(d); }
    if (m[1] === '-') n = -n;
    if (n < min || n > max) { if (max < 2n ** 31n) r.throwJava('Ljava/lang/NumberFormatException;', `Value out of range. Value:"${text}" Radix:${radix}`); fail(); }
    return n;
  };
  for (const [owner, name, ret, min, max] of [['Ljava/lang/Byte;', 'parseByte', 'B', -128n, 127n], ['Ljava/lang/Short;', 'parseShort', 'S', -32768n, 32767n], ['Ljava/lang/Long;', 'parseLong', 'J', -(2n ** 63n), 2n ** 63n - 1n]]) {
    const wrap = n => ret === 'J' ? n : Number(n);
    def(owner, name, `(Ljava/lang/String;)${ret}`, (r, _m, [v]) => wrap(parseWhole(r, v, 10, min, max, false)), { static: true });
    def(owner, name, `(Ljava/lang/String;I)${ret}`, (r, _m, [v, radix]) => wrap(parseWhole(r, v, radix, min, max, true)), { static: true });
  }

  // ---- java.lang.Math additions (the VM bridge covers the common subset; doubles travel as IEEE bits) ----------------------------------------------
  const MATH = 'Ljava/lang/Math;', dnum = bits => bitsDoubleLocal(bits);
  const unary = { tan: Math.tan, atan: Math.atan, asin: Math.asin, acos: Math.acos, log10: Math.log10, cbrt: Math.cbrt, toRadians: x => x / 180 * Math.PI, toDegrees: x => x * 180 / Math.PI };
  for (const [name, fn] of Object.entries(unary)) def(MATH, name, '(D)D', (_r, _m, [x]) => doubleBits(fn(dnum(x))), { static: true });
  def(MATH, 'atan2', '(DD)D', (_r, _m, [y, x]) => doubleBits(Math.atan2(dnum(y), dnum(x))), { static: true });
  def(MATH, 'randomLongInternal', '()J', () => { const words = new BigUint64Array(1); globalThis.crypto.getRandomValues(words); return BigInt.asIntN(64, words[0]); }, { static: true });   // libcore's Math.randomLongInternal(): the 64 random bits behind Math.random() and File.createTempFile
  def(MATH, 'random', '()D', () => doubleBits(Math.random()), { static: true }); // Math.random() seeds from the platform entropy, like java.util.Random's default seed
  const exact = (r, big, min, max, value) => { if (value < min || value > max) r.throwJava('Ljava/lang/ArithmeticException;', big ? 'long overflow' : 'integer overflow'); return big ? value : Number(value); };
  for (const [suffix, bigType, min, max] of [['I', false, -(2n ** 31n), 2n ** 31n - 1n], ['J', true, -(2n ** 63n), 2n ** 63n - 1n]]) {
    const sig = (n) => `(${suffix.repeat(n)})${suffix}`, B = v => BigInt(v);
    def(MATH, 'addExact', sig(2), (r, _m, [a, b]) => exact(r, bigType, min, max, B(a) + B(b)), { static: true });
    def(MATH, 'subtractExact', sig(2), (r, _m, [a, b]) => exact(r, bigType, min, max, B(a) - B(b)), { static: true });
    def(MATH, 'multiplyExact', sig(2), (r, _m, [a, b]) => exact(r, bigType, min, max, B(a) * B(b)), { static: true });
    def(MATH, 'negateExact', sig(1), (r, _m, [a]) => exact(r, bigType, min, max, -B(a)), { static: true });
    def(MATH, 'incrementExact', sig(1), (r, _m, [a]) => exact(r, bigType, min, max, B(a) + 1n), { static: true });
    def(MATH, 'decrementExact', sig(1), (r, _m, [a]) => exact(r, bigType, min, max, B(a) - 1n), { static: true });
    const floorDiv = (r, a, b) => { a = B(a); b = B(b); if (b === 0n) r.throwJava('Ljava/lang/ArithmeticException;', '/ by zero'); let q = a / b; if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q -= 1n; return bigType ? BigInt.asIntN(64, q) : Number(BigInt.asIntN(32, q)); };
    def(MATH, 'floorDiv', sig(2), (r, _m, [a, b]) => floorDiv(r, a, b), { static: true });
    def(MATH, 'floorMod', sig(2), (r, _m, [a, b]) => { const q = B(floorDiv(r, a, b)), m = B(a) - q * B(b); return bigType ? m : Number(m); }, { static: true });
  }
  def(MATH, 'toIntExact', '(J)I', (r, _m, [v]) => exact(r, false, -(2n ** 31n), 2n ** 31n - 1n, BigInt(v)), { static: true });

  // ---- android.util.Base64 (frameworks/base/core/java/android/util/Base64.java) ---------------------------------------------------------------------
  const B64 = 'Landroid/util/Base64;', std = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', urlSafe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (const [name, value] of Object.entries({ DEFAULT: 0, NO_PADDING: 1, NO_WRAP: 2, CRLF: 4, URL_SAFE: 8, NO_CLOSE: 16 })) registry.staticField(B64, name, 'I', () => value);
  const checkRange = (r, array, offset, length) => { if (offset < 0 || length < 0 || offset + length > array.length) r.throwJava('Ljava/lang/IllegalArgumentException;', 'bad base-64'); };
  const b64encode = (bytes, flags) => {
    const alphabet = flags & 8 ? urlSafe : std; let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2], n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
      out += alphabet[n >> 18 & 63] + alphabet[n >> 12 & 63] + (b === undefined ? (flags & 1 ? '' : '=') : alphabet[n >> 6 & 63]) + (c === undefined ? (flags & 1 ? '' : '=') : alphabet[n & 63]);
    }
    if (!(flags & 2)) { const eol = flags & 4 ? '\r\n' : '\n', lines = out.match(/.{1,76}/g) ?? []; out = lines.length ? lines.join(eol) + (bytes.length ? eol : '') : ''; }
    return out;
  };
  const b64decode = (r, text, flags) => {
    const alphabet = flags & 8 ? urlSafe : std, out = []; let acc = 0, bits = 0, pad = 0, sawData = 0;
    for (const ch of text) {
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
      if (ch === '=') { pad++; continue; }
      const v = alphabet.indexOf(ch); if (v < 0 || pad) r.throwJava('Ljava/lang/IllegalArgumentException;', 'bad base-64');
      acc = (acc << 6) | v; bits += 6; sawData++; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); acc &= (1 << bits) - 1; }
    }
    if (sawData % 4 === 1) r.throwJava('Ljava/lang/IllegalArgumentException;', 'bad base-64');
    return Int8Array.from(out, v => (v << 24) >> 24);
  };
  const toUnsigned = (r, ref, offset, length) => { const a = r.array(ref).elements; checkRange(r, a, offset, length); return a.slice(offset, offset + length).map(v => v & 255); };
  const bytesArray = (r, signed) => { const array = r.newArray('[B', signed.length); r.array(array).elements = Array.from(signed); return array; };
  def(B64, 'encodeToString', '([BI)Ljava/lang/String;', (r, _m, [a, flags]) => b64encode(toUnsigned(r, a, 0, r.array(a).elements.length), flags), { static: true });
  def(B64, 'encodeToString', '([BIII)Ljava/lang/String;', (r, _m, [a, o, l, flags]) => b64encode(toUnsigned(r, a, o, l), flags), { static: true });
  def(B64, 'encode', '([BI)[B', (r, _m, [a, flags]) => bytesArray(r, new TextEncoder().encode(b64encode(toUnsigned(r, a, 0, r.array(a).elements.length), flags))), { static: true });
  def(B64, 'encode', '([BIII)[B', (r, _m, [a, o, l, flags]) => bytesArray(r, new TextEncoder().encode(b64encode(toUnsigned(r, a, o, l), flags))), { static: true });
  def(B64, 'decode', '(Ljava/lang/String;I)[B', (r, _m, [s2, flags]) => bytesArray(r, b64decode(r, r.stringCharacters(s2), flags)), { static: true });
  // android.util.Base64OutputStream: written bytes are encoded (or decoded) with Base64's flags and reach the wrapped stream by close(),
  // which also closes it unless NO_CLOSE (16) is set. The output equals Base64.encode(all bytes, flags), as AOSP's incremental coder produces.
  const B64OS = 'Landroid/util/Base64OutputStream;', OUTPUT_STREAM = 'Ljava/io/OutputStream;', FILTER_OUT = 'Ljava/io/FilterOutputStream;';
  registry.type(B64OS, FILTER_OUT, [], { allocatable: true });
  const b64state = (r, self) => r.object(self).base64Stream ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Base64OutputStream used before construction');
  const b64init = (r, self, out, flags, encode) => { r.storeField(r.object(self).fields, `${FILTER_OUT}->out:${OUTPUT_STREAM}`, out); r.object(self).base64Stream = { out, flags, encode, buffer: [], closed: false }; };
  def(B64OS, '<init>', `(${OUTPUT_STREAM}I)V`, (r, _m, [self, out, flags]) => b64init(r, self, out, flags, true));
  def(B64OS, '<init>', `(${OUTPUT_STREAM}IZ)V`, (r, _m, [self, out, flags, encode]) => b64init(r, self, out, flags, !!encode));
  def(B64OS, 'write', '(I)V', (r, _m, [self, value]) => { b64state(r, self).buffer.push(value & 255); });
  def(B64OS, 'write', '([BII)V', (r, _m, [self, array, offset, length]) => { const state = b64state(r, self); for (const v of toUnsigned(r, array, offset, length)) state.buffer.push(v); });
  def(B64OS, 'write', '([B)V', (r, _m, [self, array]) => { const state = b64state(r, self); for (const v of toUnsigned(r, array, 0, r.array(array).elements.length)) state.buffer.push(v); });
  def(B64OS, 'close', '()V', (r, _m, [self]) => {
    const state = b64state(r, self); if (state.closed) return; state.closed = true;
    const output = state.encode ? new TextEncoder().encode(b64encode(state.buffer, state.flags)) : Uint8Array.from(b64decode(r, String.fromCharCode(...state.buffer), state.flags), v => v & 255);
    const array = bytesArray(r, Int8Array.from(output, v => (v << 24) >> 24)), stream = (name, parameters, args2) => r.dispatch({ owner: OUTPUT_STREAM, name, parameters, result: 'V', signature: `(${parameters.join('')})V` }, args2, 'virtual');
    stream('write', ['[B', 'I', 'I'], [state.out, array, 0, output.length]);
    if (state.flags & 16) stream('flush', [], [state.out]); else stream('close', [], [state.out]);
  });
  def(B64, 'decode', '([BI)[B', (r, _m, [a, flags]) => bytesArray(r, b64decode(r, String.fromCharCode(...toUnsigned(r, a, 0, r.array(a).elements.length)), flags)), { static: true });
  def(B64, 'decode', '([BIII)[B', (r, _m, [a, o, l, flags]) => bytesArray(r, b64decode(r, String.fromCharCode(...toUnsigned(r, a, o, l)), flags)), { static: true });

  // ---- String regex helpers = Pattern.compile(regex).matcher(this)... (java.lang.String: replaceAll, replaceFirst, matches) -----------------------------------
  const PATTERN = 'Ljava/util/regex/Pattern;', MATCHER = 'Ljava/util/regex/Matcher;', CS = 'Ljava/lang/CharSequence;';
  const matcherOf = (r, self, regex) => { const pattern = r.dispatch({ owner: PATTERN, name: 'compile', parameters: ['Ljava/lang/String;'], result: PATTERN, signature: `(Ljava/lang/String;)${PATTERN}` }, [regex], 'static'); return r.dispatch({ owner: PATTERN, name: 'matcher', parameters: [CS], result: MATCHER, signature: `(${CS})${MATCHER}` }, [pattern, self], 'virtual'); };
  const viaMatcher = (name, extra) => (r, _m, [self, regex, replacement]) => r.dispatch({ owner: MATCHER, name: extra ?? name, parameters: extra === undefined && name === 'matches' ? [] : ['Ljava/lang/String;'], result: name === 'matches' ? 'Z' : 'Ljava/lang/String;', signature: name === 'matches' ? '()Z' : '(Ljava/lang/String;)Ljava/lang/String;' }, name === 'matches' ? [matcherOf(r, self, regex)] : [matcherOf(r, self, regex), replacement], 'virtual');
  def('Ljava/lang/String;', 'replaceAll', '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', viaMatcher('replaceAll'));
  def('Ljava/lang/String;', 'replaceFirst', '(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', viaMatcher('replaceFirst'));
  def('Ljava/lang/String;', 'matches', '(Ljava/lang/String;)Z', (r, m, [self, regex]) => viaMatcher('matches')(r, m, [self, regex]));

  // ---- Throwable additions: the VM keeps no Java frame list, so stack traces are empty (documented gap); suppressed exceptions are tracked ---------------
  const THROWABLE = 'Ljava/lang/Throwable;', STE = 'Ljava/lang/StackTraceElement;';
  registry.type(STE, 'Ljava/lang/Object;', [], { allocatable: true });
  def(THROWABLE, 'getLocalizedMessage', '()Ljava/lang/String;', (r, _m, [self]) => r.dispatch({ owner: THROWABLE, name: 'getMessage', parameters: [], result: 'Ljava/lang/String;', signature: '()Ljava/lang/String;' }, [self], 'virtual'));
  const dotted = type => type.slice(1, -1).replace(/\//g, '.');
  const traceElements = (r, self) => {
    const o = r.object(self); if (o.stackElements) return o.stackElements;
    return o.stackElements = (o.stack ?? []).map(method => { const e = r.makeObject(STE); r.object(e).ste = { cls: dotted(method.owner), method: method.name, file: null, line: -1 }; return e; });
  };
  def(THROWABLE, 'getStackTrace', `()[${STE}`, (r, _m, [self]) => { const list = traceElements(r, self), array = r.newArray(`[${STE}`, list.length); r.array(array).elements = list.slice(); return array; });
  def(THROWABLE, 'setStackTrace', `([${STE})V`, (r, _m, [self, array]) => { if (array === null) r.throwJava('Ljava/lang/NullPointerException;', 'stackTrace == null'); r.object(self).stackElements = r.array(array).elements.slice(); });
  def(THROWABLE, 'fillInStackTrace', `()${THROWABLE}`, (r, _m, [self]) => { const o = r.object(self); o.stack = r.captureStack(); o.stackElements = undefined; return self; });
  def(STE, 'getClassName', '()Ljava/lang/String;', (r, _m, [self]) => r.object(self).ste.cls); def(STE, 'getMethodName', '()Ljava/lang/String;', (r, _m, [self]) => r.object(self).ste.method);
  def(STE, 'getFileName', '()Ljava/lang/String;', (r, _m, [self]) => r.object(self).ste.file); def(STE, 'getLineNumber', '()I', (r, _m, [self]) => r.object(self).ste.line);
  def(STE, 'isNativeMethod', '()Z', () => 0);
  // new StackTraceElement(declaringClass, methodName, fileName, lineNumber): the only public constructor on Android; the first two arguments must not be null (libcore message "Declaring class is null").
  def(STE, '<init>', '(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;I)V', (r, _m, [self, cls, method, file, line]) => {
    if (cls === null) r.throwJava('Ljava/lang/NullPointerException;', 'Declaring class is null');
    if (method === null) r.throwJava('Ljava/lang/NullPointerException;', 'Method name is null');
    r.object(self).ste = { cls: r.stringCharacters(cls), method: r.stringCharacters(method), file: file === null ? null : r.stringCharacters(file), line };
  });
  const steText = e => `${e.cls}.${e.method}(${e.file ? e.file + (e.line >= 0 ? ':' + e.line : '') : 'Unknown Source'})`;
  def(STE, 'toString', '()Ljava/lang/String;', (r, _m, [self]) => steText(r.object(self).ste));
  /** The lines printStackTrace writes: "Type: message", the frames, then "Caused by:" sections. */
  const traceLines = (r, self) => {
    const lines = [], seen = new Set(); let current = self, prefix = '';
    while (current && !seen.has(current.ref)) {
      seen.add(current.ref); const o = r.object(current);
      lines.push(prefix + dotted(o.type) + (o.message !== null && o.message !== undefined ? ': ' + o.message : ''));
      for (const e of traceElements(r, current)) lines.push('\tat ' + steText(r.object(e).ste));
      current = o.cause ?? null; prefix = 'Caused by: ';
    }
    return lines;
  };
  def(THROWABLE, 'printStackTrace', '()V', (r, _m, [self]) => { for (const line of traceLines(r, self)) r.record(`LOG W System.err: ${line}`); });
  for (const sink of ['Ljava/io/PrintStream;', 'Ljava/io/PrintWriter;'])
    def(THROWABLE, 'printStackTrace', `(${sink})V`, (r, _m, [self, out]) => { for (const line of traceLines(r, self)) r.dispatch({ owner: sink, name: 'println', parameters: ['Ljava/lang/String;'], result: 'V', signature: '(Ljava/lang/String;)V' }, [out, line], 'virtual'); });
  def(THROWABLE, 'addSuppressed', `(${THROWABLE})V`, (r, _m, [self, t]) => { if (t === null) r.throwJava('Ljava/lang/NullPointerException;', 'Cannot suppress a null exception.'); if (t.ref === self.ref) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Self-suppression not permitted'); (r.object(self).suppressed ??= []).push(t); });
  def(THROWABLE, 'getSuppressed', `()[${THROWABLE}`, (r, _m, [self]) => { const list = r.object(self).suppressed ?? [], array = r.newArray(`[${THROWABLE}`, list.length); r.array(array).elements = list.slice(); return array; });

  // ---- android.os.Binder: in-process objects only. attachInterface/queryLocalInterface work (local AIDL stubs); transact needs android.os.Parcel and
  //      real IPC to other processes (there are none), so it fails explicitly. -------------------------------------------------------------------
  const BINDER = 'Landroid/os/Binder;', IINTERFACE = 'Landroid/os/IInterface;';
  registry.type(BINDER, 'Ljava/lang/Object;', ['Landroid/os/IBinder;'], { allocatable: true }); registry.interfaces.set('Landroid/os/IBinder;', []); registry.parents.set('Landroid/os/IBinder;', 'Ljava/lang/Object;');
  def(BINDER, '<init>', '()V', () => {}); def(BINDER, '<init>', '(Ljava/lang/String;)V', (r, _m, [self, d]) => { r.object(self).binderDescriptor = d; });
  def(BINDER, 'attachInterface', `(${IINTERFACE}Ljava/lang/String;)V`, (r, _m, [self, owner, descriptor]) => { const o = r.object(self); o.binderOwner = owner; o.binderDescriptor = descriptor; });
  def(BINDER, 'queryLocalInterface', `(Ljava/lang/String;)${IINTERFACE}`, (r, _m, [self, descriptor]) => { const o = r.object(self); return o.binderDescriptor !== undefined && o.binderDescriptor !== null && descriptor !== null && r.stringCharacters(o.binderDescriptor) === r.stringCharacters(descriptor) ? o.binderOwner ?? null : null; });
  def(BINDER, 'getInterfaceDescriptor', '()Ljava/lang/String;', (r, _m, [self]) => r.object(self).binderDescriptor ?? null);
  def(BINDER, 'pingBinder', '()Z', () => 1); def(BINDER, 'isBinderAlive', '()Z', () => 1);
  // Local Binder transactions (Binder.transact -> execTransact -> onTransact): the VM is one process, so every Binder an app sees is a local object (AIDL Stub.asInterface returns the
  // implementation itself through queryLocalInterface; a Proxy only exists for a BinderProxy, which has no driver here). Exceptions the service throws travel back in the reply Parcel
  // like Binder.execTransact does: writeException for RemoteException/RuntimeException, with the call returning true.
  const PARCEL_T = 'Landroid/os/Parcel;';
  const vcall = (r, owner, name, parameters, result, args) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'virtual');
  def(BINDER, 'onTransact', `(I${PARCEL_T}${PARCEL_T}I)Z`, (r, _m, [self, code, data, reply]) => {
    if (code === 0x5f4e5446 && reply) { vcall(r, PARCEL_T, 'writeString', ['Ljava/lang/String;'], 'V', [reply, r.object(self).binderDescriptor ?? null]); return 1; }   // INTERFACE_TRANSACTION
    return 0;
  });
  def(BINDER, 'transact', `(I${PARCEL_T}${PARCEL_T}I)Z`, (r, _m, [self, code, data, reply, flags]) => {
    if (data) vcall(r, PARCEL_T, 'setDataPosition', ['I'], 'V', [data, 0]);
    let result;
    try { result = vcall(r, r.typeOf(self), 'onTransact', ['I', PARCEL_T, PARCEL_T, 'I'], 'Z', [self, code, data, reply, flags]); }
    catch (error) {
      const value = error?.value; if (!value || !(r.isSubtype(r.typeOf(value), 'Ljava/lang/RuntimeException;') || r.isSubtype(r.typeOf(value), 'Landroid/os/RemoteException;'))) throw error;
      if (flags & 1) { r.record(`BINDER oneway call threw ${r.typeOf(value)}`); result = 1; }      // FLAG_ONEWAY: the exception is only logged
      else { vcall(r, PARCEL_T, 'setDataSize', ['I'], 'V', [reply, 0]); vcall(r, PARCEL_T, 'setDataPosition', ['I'], 'V', [reply, 0]); vcall(r, PARCEL_T, 'writeException', ['Ljava/lang/Exception;'], 'V', [reply, value]); result = 1; }
    }
    if (reply) vcall(r, PARCEL_T, 'setDataPosition', ['I'], 'V', [reply, 0]);
    return result ? 1 : 0;
  });
  def(BINDER, 'allowBlocking', `(${'Landroid/os/IBinder;'})Landroid/os/IBinder;`, (r, _m, [binder]) => binder, { static: true });
  def(BINDER, 'linkToDeath', '(Landroid/os/IBinder$DeathRecipient;I)V', () => {}); def(BINDER, 'unlinkToDeath', '(Landroid/os/IBinder$DeathRecipient;I)Z', () => 1);
  def(BINDER, 'flushPendingCommands', '()V', () => {}, { static: true });
  def(BINDER, 'getCallingPid', '()I', r => r.platform.virtualProcess.pid, { static: true }); def(BINDER, 'getCallingUid', '()I', r => r.platform.virtualProcess.uid, { static: true });
  def(BINDER, 'clearCallingIdentity', '()J', () => 0n, { static: true }); def(BINDER, 'restoreCallingIdentity', '(J)V', () => {}, { static: true });

  // ---- java.lang.Number conversions (byteValue/shortValue/intValue/longValue/floatValue/doubleValue between all numeric boxes, Java narrowing rules) ------
  const NUMBER_BOXES = { 'Ljava/lang/Byte;': 'B', 'Ljava/lang/Short;': 'S', 'Ljava/lang/Integer;': 'I', 'Ljava/lang/Long;': 'J', 'Ljava/lang/Float;': 'F', 'Ljava/lang/Double;': 'D' };
  const numeric = (r, self) => { const o = r.object(self), code = NUMBER_BOXES[o.type] ?? o.primitiveType; return code === 'F' ? bitsFloat(o.boxed) : code === 'D' ? bitsDouble_(o.boxed) : code === 'J' ? BigInt(o.boxed) : Number(o.boxed); };
  const bitsDouble_ = bitsDoubleLocal;
  const toInteger = (v, bits) => { if (typeof v === 'bigint') return BigInt.asIntN(bits, v); if (Number.isNaN(v)) return 0n; const t = Math.trunc(v), lim = 2n ** BigInt(bits - 1); if (!Number.isFinite(t)) return t > 0 ? lim - 1n : -lim; const b = BigInt(t); return b >= lim ? lim - 1n : b < -lim ? -lim : b; };
  const wrapNarrow = (v, bits) => { // integral boxes narrow modulo 2^n from their own value; floating boxes saturate via int/long first
    if (typeof v === 'bigint' || Number.isInteger(v)) return Number(BigInt.asIntN(bits, BigInt(v)));
    return Number(BigInt.asIntN(bits, toInteger(v, 32)));
  };
  for (const owner of [...Object.keys(NUMBER_BOXES), 'Ljava/lang/Number;']) {
    def(owner, 'byteValue', '()B', (r, _m, [self]) => wrapNarrow(numeric(r, self), 8)); def(owner, 'shortValue', '()S', (r, _m, [self]) => wrapNarrow(numeric(r, self), 16));
    def(owner, 'intValue', '()I', (r, _m, [self]) => { const v = numeric(r, self); return typeof v === 'bigint' ? Number(BigInt.asIntN(32, v)) : Number.isInteger(v) ? Number(BigInt.asIntN(32, BigInt(v))) : Number(toInteger(v, 32)); });
    def(owner, 'longValue', '()J', (r, _m, [self]) => { const v = numeric(r, self); return typeof v === 'bigint' ? v : Number.isInteger(v) ? BigInt(v) : toInteger(v, 64); });
    def(owner, 'floatValue', '()F', (r, _m, [self]) => floatBits(Number(numeric(r, self)))); def(owner, 'doubleValue', '()D', (r, _m, [self]) => doubleBits(Number(numeric(r, self))));
  }

  // ---- java.lang.Package (Android: derived from the class name, no manifest attributes) ---------------------------------------------------------------
  const PACKAGE = 'Ljava/lang/Package;'; registry.type(PACKAGE, 'Ljava/lang/Object;', [], { allocatable: true });
  const packages = new WeakMap();
  def('Ljava/lang/Class;', 'getPackage', `()${PACKAGE}`, (r, _m, [self]) => {
    const t = r.object(self).classType.replace(/\$\$ldr\d+;$/, ';'); if (t.length === 1 || t.startsWith('[')) return null;
    const name = t.slice(1, -1).replaceAll('/', '.'), dot = name.lastIndexOf('.'), pkgName = dot < 0 ? '' : name.slice(0, dot), table = packages.get(r) ?? packages.set(r, gcRoot(new Map())).get(r);
    if (!table.has(pkgName)) { const ref = r.allocate(PACKAGE); r.object(ref).packageName = pkgName; table.set(pkgName, ref); } return table.get(pkgName);
  });
  def(PACKAGE, 'getName', '()Ljava/lang/String;', (r, _m, [self]) => r.object(self).packageName); def(PACKAGE, 'toString', '()Ljava/lang/String;', (r, _m, [self]) => 'package ' + r.object(self).packageName);
  for (const name of ['getImplementationVersion', 'getSpecificationVersion', 'getImplementationTitle', 'getImplementationVendor', 'getSpecificationTitle', 'getSpecificationVendor']) def(PACKAGE, name, '()Ljava/lang/String;', () => null);

  // ---- java.util.logging (libcore: the root logger's AndroidHandler forwards to android.util.Log; default level INFO) ----------------------------------
  const LOGGER = 'Ljava/util/logging/Logger;', LEVEL = 'Ljava/util/logging/Level;', levels = { OFF: 2147483647, SEVERE: 1000, WARNING: 900, INFO: 800, CONFIG: 700, FINE: 500, FINER: 400, FINEST: 300, ALL: -2147483648 };
  registry.type(LEVEL, 'Ljava/lang/Object;', [], { allocatable: true }); registry.type(LOGGER, 'Ljava/lang/Object;', [], { allocatable: true });
  const levelObjects = new WeakMap(), loggers = new WeakMap();
  const levelOf = (r, name) => { const m = levelObjects.get(r) ?? levelObjects.set(r, gcRoot(new Map())).get(r); if (!m.has(name)) { const ref = r.allocate(LEVEL); r.object(ref).level = { name, value: levels[name] }; m.set(name, ref); } return m.get(name); };
  for (const name of Object.keys(levels)) registry.staticField(LEVEL, name, LEVEL, r => levelOf(r, name));
  def(LEVEL, 'intValue', '()I', (r, _m, [self]) => r.object(self).level.value); def(LEVEL, 'getName', '()Ljava/lang/String;', (r, _m, [self]) => r.object(self).level.name); def(LEVEL, 'toString', '()Ljava/lang/String;', (r, _m, [self]) => r.object(self).level.name);
  // Logger hierarchy (LogManager): a logger's parent is the nearest existing ancestor by dotted name, else the root logger ""; handlers run up the chain while
  // useParentHandlers holds. The root's default handler is libcore's AndroidHandler, modelled by the "LOG" trace line (android.util.Log).
  const HANDLER = 'Ljava/util/logging/Handler;', LOG_RECORD = 'Ljava/util/logging/LogRecord;';
  registry.type(HANDLER, 'Ljava/lang/Object;', [], { allocatable: true }); registry.type(LOG_RECORD, 'Ljava/lang/Object;', [], { allocatable: true });
  const loggerNamed = (r, n) => {
    const table = loggers.get(r) ?? loggers.set(r, gcRoot(new Map())).get(r);
    if (!table.has(n)) { const ref = r.allocate(LOGGER); r.object(ref).logger = { name: n, level: null, handlers: [], useParent: true, parent: undefined }; table.set(n, ref); } return table.get(n);
  };
  def(LOGGER, 'getLogger', `(Ljava/lang/String;)${LOGGER}`, (r, _m, [name]) => loggerNamed(r, r.stringCharacters(name)), { static: true });
  const lg = (r, self) => r.object(self).logger;
  const parentOf = (r, self) => {
    const l = lg(r, self); if (l.parent !== undefined) return l.parent; if (l.name === '') return null;
    const table = loggers.get(r); for (let n = l.name; n.includes('.');) { n = n.slice(0, n.lastIndexOf('.')); if (table.has(n)) return table.get(n); }
    return loggerNamed(r, '');
  };
  const effective = (r, self) => { for (let l = self; l !== null; l = parentOf(r, l)) { const v = lg(r, l).level; if (v !== null) return v; } return levels.INFO; };
  const levelValue = (r, record) => r.object(r.object(record).record.level).level.value;
  const emitRecord = (r, self, record) => {
    const lv = levelValue(r, record); if (lv < effective(r, self) || effective(r, self) === levels.OFF) return;
    for (let l = self; l !== null; l = parentOf(r, l)) {
      for (const handler of [...lg(r, l).handlers]) if (lv >= (r.object(handler).handlerLevel ?? levels.ALL)) r.dispatch({ owner: HANDLER, name: 'publish', parameters: [LOG_RECORD], result: 'V', signature: `(${LOG_RECORD})V` }, [handler, record], 'virtual');
      if (!lg(r, l).useParent) return;
    }
    const { message, thrown } = r.object(record).record;
    r.record(`LOG ${lv >= 1000 ? 'E' : lv >= 900 ? 'W' : lv >= 800 ? 'I' : lv >= 500 ? 'D' : 'V'} ${lg(r, self).name}: ${message === null ? 'null' : r.stringCharacters(message)}${thrown ? ' [' + r.typeOf(thrown) + ']' : ''}`);
  };
  const newRecord = (r, level, message, thrown = null, loggerName = null, parameters = null) => { const ref = r.allocate(LOG_RECORD); r.object(ref).record = { level, message, thrown, loggerName, parameters, millis: BigInt(Math.trunc(platform.clock.now())) }; return ref; };
  const emit = (r, self, levelRef, message, thrown, parameters = null) => {
    if (r.object(levelRef).level.value < effective(r, self) || effective(r, self) === levels.OFF) return;
    emitRecord(r, self, newRecord(r, levelRef, message, thrown, lg(r, self).name, parameters));
  };
  def(LOGGER, 'log', `(${LOG_RECORD})V`, (r, _m, [self, record]) => emitRecord(r, self, record));
  def(LOGGER, 'log', `(${LEVEL}Ljava/lang/String;[Ljava/lang/Object;)V`, (r, _m, [self, level, msg, params]) => emit(r, self, level, msg, null, params));
  def(LOGGER, 'addHandler', `(${HANDLER})V`, (r, _m, [self, handler]) => { if (handler === null) r.throwJava('Ljava/lang/NullPointerException;', null); lg(r, self).handlers.push(handler); });
  def(LOGGER, 'removeHandler', `(${HANDLER})V`, (r, _m, [self, handler]) => { const l = lg(r, self), i = l.handlers.indexOf(handler); if (i >= 0) l.handlers.splice(i, 1); });
  def(LOGGER, 'getHandlers', `()[${HANDLER}`, (r, _m, [self]) => { const array = r.newArray(`[${HANDLER}`, lg(r, self).handlers.length); r.array(array).elements = [...lg(r, self).handlers]; return array; });
  def(LOGGER, 'getParent', `()${LOGGER}`, (r, _m, [self]) => parentOf(r, self));
  def(LOGGER, 'setParent', `(${LOGGER})V`, (r, _m, [self, parent]) => { if (parent === null) r.throwJava('Ljava/lang/NullPointerException;', null); lg(r, self).parent = parent; });
  def(LOGGER, 'getUseParentHandlers', '()Z', (r, _m, [self]) => lg(r, self).useParent ? 1 : 0);
  // java.util.logging.Handler (abstract: publish/flush/close come from the app's subclass) and LogRecord.
  const levelName = value => Object.keys(levels).find(k => levels[k] === value);
  def(HANDLER, '<init>', '()V', () => {});
  def(HANDLER, 'setLevel', `(${LEVEL})V`, (r, _m, [self, level]) => { if (level === null) r.throwJava('Ljava/lang/NullPointerException;', null); r.object(self).handlerLevel = r.object(level).level.value; });
  def(HANDLER, 'getLevel', `()${LEVEL}`, (r, _m, [self]) => levelOf(r, levelName(r.object(self).handlerLevel ?? levels.ALL)));
  def(HANDLER, 'isLoggable', `(${LOG_RECORD})Z`, (r, _m, [self, record]) => record !== null && levelValue(r, record) >= (r.object(self).handlerLevel ?? levels.ALL) ? 1 : 0);
  for (const [name, type] of [['Formatter', 'Ljava/util/logging/Formatter;'], ['Filter', 'Ljava/util/logging/Filter;']]) {
    def(HANDLER, 'set' + name, `(${type})V`, (r, _m, [self, value]) => { r.object(self)['handler' + name] = value; }); def(HANDLER, 'get' + name, `()${type}`, (r, _m, [self]) => r.object(self)['handler' + name] ?? null);
  }
  def(LOG_RECORD, '<init>', `(${LEVEL}Ljava/lang/String;)V`, (r, _m, [self, level, msg]) => { if (level === null) r.throwJava('Ljava/lang/NullPointerException;', null); r.object(self).record = { level, message: msg, thrown: null, loggerName: null, parameters: null, millis: BigInt(Math.trunc(platform.clock.now())) }; });
  for (const [name, type, key] of [['Level', LEVEL, 'level'], ['Message', 'Ljava/lang/String;', 'message'], ['LoggerName', 'Ljava/lang/String;', 'loggerName'], ['Thrown', 'Ljava/lang/Throwable;', 'thrown'], ['Parameters', '[Ljava/lang/Object;', 'parameters']]) {
    def(LOG_RECORD, 'get' + name, `()${type}`, (r, _m, [self]) => r.object(self).record[key]); def(LOG_RECORD, 'set' + name, `(${type})V`, (r, _m, [self, value]) => { r.object(self).record[key] = value; });
  }
  def(LOG_RECORD, 'getMillis', '()J', (r, _m, [self]) => r.object(self).record.millis);
  def(LOGGER, 'log', `(${LEVEL}Ljava/lang/String;)V`, (r, _m, [self, level, msg]) => emit(r, self, level, msg, null));
  def(LOGGER, 'log', `(${LEVEL}Ljava/lang/String;Ljava/lang/Throwable;)V`, (r, _m, [self, level, msg, t]) => emit(r, self, level, msg, t));
  def(LOGGER, 'log', `(${LEVEL}Ljava/lang/String;Ljava/lang/Object;)V`, (r, _m, [self, level, msg]) => emit(r, self, level, msg, null));
  for (const [method, level] of [['severe', 'SEVERE'], ['warning', 'WARNING'], ['info', 'INFO'], ['config', 'CONFIG'], ['fine', 'FINE'], ['finer', 'FINER'], ['finest', 'FINEST']]) def(LOGGER, method, '(Ljava/lang/String;)V', (r, _m, [self, msg]) => emit(r, self, levelOf(r, level), msg, null));
  def(LOGGER, 'isLoggable', `(${LEVEL})Z`, (r, _m, [self, level]) => r.object(level).level.value >= effective(r, self) && effective(r, self) !== levels.OFF ? 1 : 0);
  def(LOGGER, 'getName', '()Ljava/lang/String;', (r, _m, [self]) => r.object(self).logger.name);
  def(LOGGER, 'setLevel', `(${LEVEL})V`, (r, _m, [self, level]) => { r.object(self).logger.level = level === null ? null : r.object(level).level.value; });
  def(LOGGER, 'getLevel', `()${LEVEL}`, (r, _m, [self]) => { const v = r.object(self).logger.level; return v === null ? null : levelOf(r, Object.keys(levels).find(k => levels[k] === v)); });
  def(LOGGER, 'setUseParentHandlers', '(Z)V', (r, _m, [self, value]) => { lg(r, self).useParent = !!value; });

  // ---- java.lang.System.getenv: environment of a zygote-forked Android 13 app process ----------------------------
  const ENV = { ANDROID_ROOT: '/system', ANDROID_DATA: '/data', ANDROID_STORAGE: '/storage', ANDROID_ASSETS: '/system/app', ANDROID_ART_ROOT: '/apex/com.android.art', ANDROID_I18N_ROOT: '/apex/com.android.i18n', ANDROID_TZDATA_ROOT: '/apex/com.android.tzdata', ANDROID_RUNTIME_ROOT: '/apex/com.android.runtime', EXTERNAL_STORAGE: '/sdcard', ASEC_MOUNTPOINT: '/mnt/asec', PATH: '/product/bin:/apex/com.android.runtime/bin:/system/bin:/system/xbin:/odm/bin:/vendor/bin:/vendor/xbin', ANDROID_BOOTLOGO: '1' };
  platform.environment = ENV;   // the process environment libcore's Linux.getenv/environ report
  def('Ljava/lang/System;', 'getenv', '(Ljava/lang/String;)Ljava/lang/String;', (r, _m, [name]) => { if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'name == null'); return ENV[r.stringCharacters(name)] ?? null; }, { static: true });

  def('Ljava/lang/System;', 'mapLibraryName', '(Ljava/lang/String;)Ljava/lang/String;', (r, _m, [name]) => { if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'libname == null'); return 'lib' + r.stringCharacters(name) + '.so'; }, { static: true }); // libcore System.mapLibraryName

  // ---- java.lang.Runtime memory/processor accounting for the virtual heap ------------------------------------------------------------------
  // maxMemory/totalMemory describe the VM's declared heap (256 MiB limit, 128 MiB committed); freeMemory = committed - an estimate of live VM data
  // (object slots + field slots + array cells + collection cells at 16/8/8/16 bytes). The VM has no garbage collector, so used memory only grows.
  const RUNTIME = 'Ljava/lang/Runtime;', MAX_MEMORY = 256n * 1024n * 1024n, TOTAL_MEMORY = 128n * 1024n * 1024n;
  const used = runtime => BigInt(runtime.heap.size * 16 + runtime.fieldSlots * 8 + runtime.arrayCells * 8 + runtime.collectionCells * 16);
  def(RUNTIME, 'maxMemory', '()J', () => MAX_MEMORY); def(RUNTIME, 'totalMemory', '()J', () => TOTAL_MEMORY);
  def(RUNTIME, 'freeMemory', '()J', (runtime) => { const free = TOTAL_MEMORY - used(runtime); return free > 0n ? free : 0n; });
  def(RUNTIME, 'gc', '()V', (runtime) => { runtime.record('RUNTIME gc requested; the VM has no garbage collector (Runtime.gc is a hint)'); });

  // ---- Runtime.nativeLoad: the primitive under System.load and SoLoader's SoFileLoader (libcore Runtime.java; returns null on success, else the dlopen error text)
  const nativeLoad = (r, _m, [filename]) => {
    const path = r.stringCharacters(filename);
    try {
      if (r.jni?.loadPath(path, 'Runtime.nativeLoad')) return null;
      if (r.stubNativeLibrary(path)) return null;
      return `dlopen failed: library "${path}" is not a native library of this device (no wasm32 module is registered for it)`;
    } catch (error) {
      if (error?.value && r.isSubtype(r.typeOf(error.value), 'Ljava/lang/UnsatisfiedLinkError;')) return r.object(error.value).message ?? 'dlopen failed';
      throw error;
    }
  };
  def('Ljava/lang/Runtime;', 'nativeLoad', '(Ljava/lang/String;Ljava/lang/ClassLoader;Ljava/lang/String;)Ljava/lang/String;', nativeLoad, { static: true });
  def('Ljava/lang/Runtime;', 'nativeLoad', '(Ljava/lang/String;Ljava/lang/ClassLoader;)Ljava/lang/String;', nativeLoad, { static: true });

  // ---- android.os.Process (android-13.0.0_r1 Process.java) ----------------------------------------------------------
  const PROCESS = 'Landroid/os/Process;';
  const threadPriorities = new Map(); // tid -> nice value; the single-threaded VM has no scheduler, so priorities are recorded, never enforced
  for (const [name, value] of Object.entries({ THREAD_PRIORITY_DEFAULT: 0, THREAD_PRIORITY_LOWEST: 19, THREAD_PRIORITY_BACKGROUND: 10, THREAD_PRIORITY_FOREGROUND: -2, THREAD_PRIORITY_DISPLAY: -4, THREAD_PRIORITY_URGENT_DISPLAY: -8, THREAD_PRIORITY_AUDIO: -16, THREAD_PRIORITY_URGENT_AUDIO: -19, THREAD_PRIORITY_MORE_FAVORABLE: -1, THREAD_PRIORITY_LESS_FAVORABLE: 1, SYSTEM_UID: 1000, FIRST_APPLICATION_UID: 10000, LAST_APPLICATION_UID: 19999, ROOT_UID: 0 }))
    registry.staticField(PROCESS, name, 'I', () => value);
  // Process.myProcessName() (API 33): the app's process name, android:process on <application> (":x" is package-private) or the package name.
  def(PROCESS, 'myProcessName', '()Ljava/lang/String;', () => { const process = platform.manifest?.application?.process, pkg = platform.packageName; return process ? (process.startsWith(':') ? pkg + process : process) : pkg; }, { static: true });
  def(PROCESS, 'is64Bit', '()Z', () => 0, { static: true }); // the VM's native word is wasm32 (Build.SUPPORTED_ABIS = wasm32), so VMRuntime.is64Bit() is false
  const processStart = platform.clock.now(); // the virtual process starts when the VM is created; uptime/elapsed clocks both count from VM creation (SystemClock bridge uses platform.clock.now())
  for (const name of ['getStartUptimeMillis', 'getStartElapsedRealtime', 'getStartRequestedUptimeMillis', 'getStartRequestedElapsedRealtime']) def(PROCESS, name, '()J', () => BigInt(Math.floor(processStart)), { static: true });
  // ---- android.text.TextUtils: the framework DEX carries only the span/ellipsis half of TextUtils; the plain string helpers apps call are reimplemented here from the AOSP bodies
  // (android-13.0.0_r1 TextUtils.java: join, isDigitsOnly, split, concat, getTrimmedLength, htmlEncode). isEmpty/equals stay VM bridges.
  const TEXT_UTILS = 'Landroid/text/TextUtils;', CHARSEQ = 'Ljava/lang/CharSequence;';
  const csText = (r, value) => value === null || value === 0 ? 'null' : r.javaString(value);
  def(TEXT_UTILS, 'join', `(${CHARSEQ}Ljava/lang/Iterable;)${STRING_T}`, (r, _m, [delimiter, tokens]) => {
    if (tokens === null || tokens === 0) r.throwJava('Ljava/lang/NullPointerException;', null);
    const holder = r.object(tokens), parts = [];
    if (holder.list || holder.set || holder.elements) for (const item of r.collectionValues(holder)) parts.push(csText(r, item));   // VM-native collections
    else {
      const call = (owner, name, result, receiver) => r.dispatch({ owner, name, parameters: [], result, signature: `()${result}` }, [receiver], 'virtual');
      const it = call(holder.type, 'iterator', 'Ljava/util/Iterator;', tokens), type = r.typeOf(it);
      while (call(type, 'hasNext', 'Z', it)) parts.push(csText(r, call(type, 'next', 'Ljava/lang/Object;', it)));
    }
    return parts.join(csText(r, delimiter));
  }, { static: true });
  def(TEXT_UTILS, 'join', `(${CHARSEQ}[Ljava/lang/Object;)${STRING_T}`, (r, _m, [delimiter, tokens]) => r.array(tokens).elements.map(item => csText(r, item)).join(csText(r, delimiter)), { static: true });
  def(TEXT_UTILS, 'isDigitsOnly', `(${CHARSEQ})Z`, (r, _m, [text]) => /^[\p{Nd}]*$/u.test(r.javaString(text)) ? 1 : 0, { static: true });
  def(TEXT_UTILS, 'getTrimmedLength', `(${CHARSEQ})I`, (r, _m, [text]) => { const value = r.javaString(text); let start = 0, end = value.length; while (start < end && value.charCodeAt(start) <= 32) start++; while (end > start && value.charCodeAt(end - 1) <= 32) end--; return end - start; }, { static: true });
  def(TEXT_UTILS, 'concat', `([${CHARSEQ})${CHARSEQ}`, (r, _m, [pieces]) => r.array(pieces).elements.map(item => csText(r, item)).join(''), { static: true });
  def(TEXT_UTILS, 'htmlEncode', `(${STRING_T})${STRING_T}`, (r, _m, [text]) => r.stringCharacters(text).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' })[c]), { static: true });
  def(TEXT_UTILS, 'split', `(${STRING_T}${STRING_T})[${STRING_T}`, (r, _m, [text, expression]) => {   // String.split(regex): trailing empty strings removed, like TextUtils.split's fast path / Pattern split
    const value = r.stringCharacters(text); if (value.length === 0) { const empty = r.newArray(`[${STRING_T}`, 0); return empty; }
    const parts = value.split(new RegExp(r.stringCharacters(expression))); while (parts.length > 1 && parts.at(-1) === '') parts.pop();
    const array = r.newArray(`[${STRING_T}`, parts.length); r.array(array).elements = parts; return array;
  }, { static: true });
  // ---- android.os.Debug: no debugger can attach to the VM; the native heap numbers describe the VM's own arena (src/unsafe-native.js) and the cost counters are VM time.
  const DEBUG = 'Landroid/os/Debug;';
  registry.type(DEBUG, 'Ljava/lang/Object;');
  def(DEBUG, 'isDebuggerConnected', '()Z', () => 0, { static: true }); def(DEBUG, 'waitingForDebugger', '()Z', () => 0, { static: true });
  def(DEBUG, 'waitForDebugger', '()V', () => {}, { static: true });   // returns at once: nothing ever attaches, which is what the call observes on a device without a debugger
  for (const name of ['getNativeHeapSize', 'getNativeHeapAllocatedSize', 'getNativeHeapFreeSize', 'getPss']) def(DEBUG, name, '()J', r => BigInt(Math.floor((r.heap?.size ?? 0) * 64)), { static: true });
  def(DEBUG, 'threadCpuTimeNanos', '()J', r => BigInt(Math.floor(platform.clock.now() * 1e6)), { static: true });
  def(DEBUG, 'getBinderSentTransactions', '()I', () => 0, { static: true }); def(DEBUG, 'getBinderReceivedTransactions', '()I', () => 0, { static: true });
  // java.security.PrivilegedActionException: AccessController.doPrivileged(PrivilegedExceptionAction) wraps checked exceptions of the action in it.
  const PAE = 'Ljava/security/PrivilegedActionException;';
  registry.type(PAE, 'Ljava/lang/Exception;', [], { allocatable: true });
  def(PAE, '<init>', '(Ljava/lang/Exception;)V', (r, _m, [self, exception]) => { r.object(self).cause = exception; r.object(self).message = null; });
  def(PAE, 'getException', '()Ljava/lang/Exception;', (r, _m, [self]) => r.object(self).cause ?? null);
  def(PAE, 'getCause', '()Ljava/lang/Throwable;', (r, _m, [self]) => r.object(self).cause ?? null);

  // ---- android.os.Messenger over the process-local Handler (frameworks/base/core/java/android/os/Messenger.java + Handler.MessengerImpl): a Messenger made from a Handler
  // delivers send(Message) to that handler's queue after stamping Message.sendingUid with Binder.getCallingUid(). Remote messengers (Messenger(IBinder), Parcel
  // transport) need a Binder driver and are not available; they fail explicitly.
  const MESSENGER = 'Landroid/os/Messenger;', MESSENGER_IMPL = 'Landroid/os/Handler$MessengerImpl;', HANDLER_TYPE = 'Landroid/os/Handler;', MESSAGE_TYPE = 'Landroid/os/Message;', IBINDER = 'Landroid/os/IBinder;';
  registry.type(MESSENGER, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;'], { allocatable: true }); registry.type(MESSENGER_IMPL, 'Landroid/os/Binder;', [IBINDER], { allocatable: true });
  const messengerTarget = (runtime, self) => runtime.object(self).messengerTarget ?? runtime.throwJava('Ljava/lang/IllegalStateException;', 'Messenger used before construction');
  const impl = (runtime, handler) => { const object = runtime.object(handler); if (!object.messengerImpl) { object.messengerImpl = runtime.allocate(MESSENGER_IMPL); runtime.object(object.messengerImpl).messengerHandler = handler; } return object.messengerImpl; };
  def(MESSENGER, '<init>', `(${HANDLER_TYPE})V`, (r, _m, [self, handler]) => { if (handler === null) r.throwJava('Ljava/lang/NullPointerException;', null); r.object(self).messengerTarget = handler; });
  // Messenger(IBinder) = IMessenger.Stub.asInterface(target): a binder from this process (another Messenger's getBinder(), e.g. a bound
  // service's onBind result) answers queryLocalInterface with its Handler, so send() posts to it directly; only remote binders need a driver.
  def(MESSENGER, '<init>', `(${IBINDER})V`, (r, _m, [self, binder]) => {
    if (binder === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const handler = r.object(binder).messengerHandler;
    if (handler) { r.object(self).messengerTarget = handler; return; }
    throw new APKError('android.os.Messenger(IBinder): remote messengers need a Binder driver, which the browser VM does not have', { kind: 'binder-unavailable' });
  });
  def(MESSENGER, 'send', `(${MESSAGE_TYPE})V`, (r, _m, [self, message]) => {
    if (message === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    r.storeField(r.object(message).fields, `${MESSAGE_TYPE}->sendingUid:I`, platform.virtualProcess.uid);
    r.dispatch({ owner: HANDLER_TYPE, name: 'sendMessage', parameters: [MESSAGE_TYPE], result: 'Z', signature: `(${MESSAGE_TYPE})Z` }, [messengerTarget(r, self), message], 'virtual');
  });
  def(MESSENGER, 'getBinder', `()${IBINDER}`, (r, _m, [self]) => impl(r, messengerTarget(r, self)));
  def(MESSENGER, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => other !== null && typeof other === 'object' && r.typeOf(other) === MESSENGER && messengerTarget(r, self) === messengerTarget(r, other) ? 1 : 0);
  def(MESSENGER, 'hashCode', '()I', (r, _m, [self]) => r.object(impl(r, messengerTarget(r, self))).id | 0);
  def(PROCESS, 'myTid', '()I', () => platform.virtualProcess.pid, { static: true });
  def(PROCESS, 'setThreadPriority', '(I)V', (_r, _m, [priority]) => { if (priority < -20 || priority > 19) _r.throwJava('Ljava/lang/IllegalArgumentException;', 'Priority ' + priority + ' out of range'); threadPriorities.set(platform.virtualProcess.pid, priority); }, { static: true });
  def(PROCESS, 'setThreadPriority', '(II)V', (r, _m, [tid, priority]) => { if (priority < -20 || priority > 19) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Priority ' + priority + ' out of range'); threadPriorities.set(tid, priority); }, { static: true });
  def(PROCESS, 'getThreadPriority', '(I)I', (_r, _m, [tid]) => threadPriorities.get(tid) ?? 0, { static: true });
  def(PROCESS, 'getElapsedCpuTime', '()J', () => BigInt(Math.floor(platform.clock.now())), { static: true });
  def(PROCESS, 'isApplicationUid', '(I)Z', (_r, _m, [uid]) => { const app = uid % 100000; return app >= 10000 && app <= 19999 ? 1 : 0; }, { static: true });
  def(PROCESS, 'killProcess', '(I)V', (r, _m, [pid]) => { throw new APKError(`Process.killProcess(${pid}): the app terminated its own virtual process`, { kind: 'process-killed', pid }); }, { static: true });

  // ---- hidden-API process accessors (android.app.ActivityThread / AppGlobals; android-13.0.0_r1) -------------------
  // ActivityThread.mInitialApplication is assigned after Application.attach() (attachBaseContext) and before Application.onCreate(),
  // so reflective callers inside attachBaseContext observe null exactly as on a device.
  const initialApplication = () => platform.applicationAttached ? platform.application : null;
  def('Landroid/app/ActivityThread;', 'currentApplication', '()Landroid/app/Application;', initialApplication, { static: true });
  def('Landroid/app/ActivityThread;', 'currentPackageName', '()Ljava/lang/String;', () => platform.applicationAttached ? platform.packageName : null, { static: true });
  def('Landroid/app/ActivityThread;', 'currentProcessName', '()Ljava/lang/String;', () => platform.applicationAttached ? platform.packageName : null, { static: true });
  def('Landroid/app/AppGlobals;', 'getInitialApplication', '()Landroid/app/Application;', initialApplication, { static: true });
  def('Landroid/app/AppGlobals;', 'getInitialPackage', '()Ljava/lang/String;', () => platform.applicationAttached ? platform.packageName : null, { static: true });

  // ---- android.widget.ExpandableListView packed-position statics (android-13.0.0_r1 ExpandableListView.java) ------------------------------
  const ELV = 'Landroid/widget/ExpandableListView;';
  const VALUE_NULL = 0x00000000FFFFFFFFn, MASK_TYPE = 0x8000000000000000n, MASK_GROUP = 0x7FFFFFFF00000000n, MASK_CHILD = 0x00000000FFFFFFFFn;
  for (const [name, value] of Object.entries({ PACKED_POSITION_TYPE_GROUP: 0, PACKED_POSITION_TYPE_CHILD: 1, PACKED_POSITION_TYPE_NULL: 2 })) registry.staticField(ELV, name, 'I', () => value);
  registry.staticField(ELV, 'PACKED_POSITION_VALUE_NULL', 'J', () => VALUE_NULL);
  def(ELV, 'getPackedPositionType', '(J)I', (_r, _m, [p]) => p === VALUE_NULL ? 2 : (BigInt.asUintN(64, p) & MASK_TYPE) === MASK_TYPE ? 1 : 0, { static: true });
  def(ELV, 'getPackedPositionGroup', '(J)I', (_r, _m, [p]) => p === VALUE_NULL ? -1 : Number(BigInt.asIntN(32, (BigInt.asUintN(64, p) & MASK_GROUP) >> 32n)), { static: true });
  def(ELV, 'getPackedPositionChild', '(J)I', (_r, _m, [p]) => p === VALUE_NULL || (BigInt.asUintN(64, p) & MASK_TYPE) !== MASK_TYPE ? -1 : Number(BigInt.asIntN(32, BigInt.asUintN(64, p) & MASK_CHILD)), { static: true });
  def(ELV, 'getPackedPositionForChild', '(II)J', (_r, _m, [group, child]) => BigInt.asIntN(64, (1n << 63n) | ((BigInt(group) & 0x7FFFFFFFn) << 32n) | (BigInt(child) & 0xFFFFFFFFn)), { static: true });
  def(ELV, 'getPackedPositionForGroup', '(I)J', (_r, _m, [group]) => BigInt.asIntN(64, (BigInt(group) & 0x7FFFFFFFn) << 32n), { static: true });

  // ---- android.view.KeyEvent static helpers (android-13.0.0_r1 KeyEvent.java) ------------------------------------
  const KEY_EVENT = 'Landroid/view/KeyEvent;';
  PARENTS.set(KEY_EVENT, 'Ljava/lang/Object;');
  // META_MODIFIER_MASK = SHIFT_ON|SHIFT_LEFT_ON|SHIFT_RIGHT_ON|ALT_ON|ALT_LEFT_ON|ALT_RIGHT_ON|SYM_ON|FUNCTION_ON|CTRL_ON|CTRL_LEFT_ON|CTRL_RIGHT_ON|META_ON|META_LEFT_ON|META_RIGHT_ON
  def(KEY_EVENT, 'getModifierMetaStateMask', '()I', () => 0x1 | 0x40 | 0x80 | 0x2 | 0x10 | 0x20 | 0x4 | 0x8 | 0x1000 | 0x2000 | 0x4000 | 0x10000 | 0x20000 | 0x40000, { static: true });

  // ---- android.graphics.PointF static helper (android-13.0.0_r1): length(x, y) = (float) Math.hypot(x, y) ------
  const POINTF = 'Landroid/graphics/PointF;';
  def(POINTF, 'length', '(FF)F', (_r, _m, [x, y]) => floatBits(Math.hypot(bitsFloat(x), bitsFloat(y))), { static: true });

  registry.staticField(THREAD_POLICY, 'LAX', THREAD_POLICY, runtime => policy(runtime, 0));
  /** System.getProperty defaults of an Android 13 app process (libcore System.java initUnchangeableSystemProperties/setDefaultChangeableProperties + ActivityThread.setupGraphicsSupport). */
  function initializeSystemProperties(runtime) {
    const pkg = platform.packageName ?? 'app', properties = {
      'java.boot.class.path': '/apex/com.android.art/javalib/core-oj.jar:/apex/com.android.art/javalib/core-libart.jar:/system/framework/framework.jar', 'java.class.path': '.',
      'java.home': '/system', 'java.io.tmpdir': `/data/user/0/${pkg}/cache`, 'java.library.path': '/system/lib64:/system_ext/lib64:/product/lib64:/vendor/lib64',
      'java.runtime.name': 'Android Runtime', 'java.runtime.version': '0.9', 'java.specification.name': 'Dalvik Core Library', 'java.specification.vendor': 'The Android Project', 'java.specification.version': '0.9',
      'java.vendor': 'The Android Project', 'java.vendor.url': 'http://www.android.com/', 'java.version': '0', 'java.vm.info': 'compiled mode', 'java.vm.specification.name': 'Dalvik Virtual Machine Specification',
      'java.vm.specification.vendor': 'The Android Project', 'java.vm.specification.version': '0.9', 'java.vm.vendor': 'The Android Project', 'java.vm.version': '2.1.0',
      'file.encoding': 'UTF-8', 'user.dir': '/', 'user.home': '', 'user.language': 'en', 'user.region': 'US', 'user.locale': 'en-US', 'os.version': '5.15.0-apkweb', 'os.arch': 'wasm32',
      'http.keepAlive': 'false',
    };
    for (const [key, value] of Object.entries(properties)) if (!runtime.javaProperties.has(key)) runtime.javaProperties.set(key, value);
    runtime.javaProperties.set('os.name', 'Linux'); // System.getProperty("os.name") on Android is the kernel name (uname.sysname)
  }
  return { state, initializeSystemProperties, ...registry, interfaces: registry.interfacesOf };
}
