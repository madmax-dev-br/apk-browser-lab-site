import { APKError } from './apk-error.js?v=9b98a94b8ae7';
import { JavaException } from './apk-runtime.js?v=9b98a94b8ae7';
import { JNI_FUNCTIONS } from './jni-function-table.js?v=9b98a94b8ae7';
import { buildElfDescriptor } from './native-descriptor.js?v=9b98a94b8ae7';
import { parseSignature, bitsDouble, bitsFloat, doubleBits, floatBits } from './host-contract.js?v=9b98a94b8ae7';
import { NativeLinker, LinkError } from './native-linker.js?v=9b98a94b8ae7';
import { hostFunction } from './wasm-host-function.js?v=9b98a94b8ae7';
import { parseWasm } from './wasm-dylink.js?v=9b98a94b8ae7';
import { formatVersion } from './rn-version.js?v=9b98a94b8ae7';
import { registerWasmMemory } from './unsafe-native.js?v=9b98a94b8ae7';
import { writeSkPath } from './skia-path-layout.js?v=9b98a94b8ae7';

// JNI -> WebAssembly bridge.
//
// Native library provider: the *lab* supplies verified WebAssembly modules per (library name, ABI "wasm32"); nothing is ever taken from an APK.
// The modules are relocatable shared libraries in the WebAssembly dynamic-linking convention and are linked by NativeLinker (src/native-linker.js)
// into ONE linear memory and ONE function table per process, the way Android's linker places .so files in one address space; libc/libc++/libc++abi
// are a single base module (libc++_shared.so) shared by all of them, so C++ objects, RTTI, exceptions and jsi::Runtime pointers cross library borders.
// System.loadLibrary(name) / System.load(path) / Runtime.nativeLoad resolve the file name against the app's virtual lib directory, where the
// provider's modules are mounted as ELF descriptors (SONAME + DT_NEEDED, so SoLoader loads dependencies first, in order), then:
//   1. link the library and its DT_NEEDED closure (symbols resolved across libraries in DT_NEEDED order; unresolved ones fail explicitly),
//   2. the first time, build the process JNIEnv/JavaVM in the shared memory: JNIEnv* -> { functions* } with the 235 JNINativeInterface_ slots, each
//      slot a table entry whose body is a JS function over the VM heap (signatures generated from jni.h, scripts/generate-jni-table.py),
//   3. call that library's own JNI_OnLoad(JavaVM*, NULL) (once per library, only for libraries the app loads itself, as ART does) and require a
//      supported version,
//   4. bind `native` Java methods through RegisterNatives or the Java_<class>_<method>[__<signature>] export naming rules.
// A native method with no binding still raises UnsatisfiedLinkError; a JNI function this bridge has not implemented fails with a JNI-specific
// APKError. Handles: local refs live for the duration of a native call (frames), global/weak refs until deleted (no GC, so weak == strong).
//
// ABI: wasm32; jint=i32, jlong=i64 (BigInt in JS), jfloat=f32, jdouble=f64, pointers and jobject/jmethodID/jfieldID handles = i32. The base module
// provides memory management (malloc/free) for the bridge.

const JNI_OK = 0, JNI_ERR = -1, JNI_EVERSION = -3;
const VERSIONS = new Set([0x10001, 0x10002, 0x10004, 0x10006, 0x10008]);
const GLOBAL_BASE = 0x40000000, WEAK_BASE = 0x60000000;
const PRIMITIVES = [['Boolean', 'Z', 1], ['Byte', 'B', 1], ['Char', 'C', 2], ['Short', 'S', 2], ['Int', 'I', 4], ['Long', 'J', 8], ['Float', 'F', 4], ['Double', 'D', 8]];
const mangle = text => { let out = ''; for (const ch of text) { if (ch === '/') out += '_'; else if (ch === '_') out += '_1'; else if (ch === ';') out += '_2'; else if (ch === '[') out += '_3'; else if (/[A-Za-z0-9]/.test(ch)) out += ch; else out += '_0' + ch.charCodeAt(0).toString(16).padStart(4, '0'); } return out; };
const sanitizeAlias = type => type.replace(/\$\$ldr\d+;$/, ';');

/** Soname of the base module: Emscripten's musl libc + LLVM libc++/libc++abi/libunwind, the one C/C++ runtime every native library shares. */
export const BASE_SONAME = 'libc++_shared.so';

/** Lab-controlled registry of WebAssembly native libraries. `add` verifies the pinned SHA-256 before compiling; there is no API that accepts APK bytes. */
export class NativeLibraryProvider {
  constructor({ abi = 'wasm32' } = {}) { this.abi = abi; this.modules = new Map(); this.unavailable = new Map(); }
  /** `hostImports(bridge, soname)` may supply imports the linker does not (a library's own host module, e.g. apkweb_sqlcipher): { module: { name: fn } }. Lab code only, never from an APK. */
  async add({ soname, wasm, sha256, needed = null, provenance = null, hostImports = null, apkSha256 = null }) {
    if (!/^lib[\w.+-]+\.so$/.test(soname)) throw new APKError(`Invalid native library name ${soname}`);
    if (!/^[0-9a-f]{64}$/i.test(sha256 ?? '')) throw new APKError(`Native library ${soname} needs a pinned SHA-256`);
    const bytes = wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm);
    const actual = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (actual !== sha256.toLowerCase()) throw new APKError(`Native library ${soname} does not match its pinned SHA-256 (expected ${sha256}, got ${actual})`, { kind: 'native-library-hash-mismatch' });
    const parsed = parseWasm(bytes);
    if (!parsed.dylink) throw new APKError(`Native library ${soname} is not a relocatable wasm32 shared library (no dylink.0 section)`, { kind: 'native-library-format' });
    // DT_NEEDED is what the module's own dylink.0 section says (link order); a provenance record that disagrees is stale
    if (needed && JSON.stringify(needed) !== JSON.stringify(parsed.dylink.needed)) throw new APKError(`Native library ${soname}: provenance DT_NEEDED ${JSON.stringify(needed)} differs from the module's ${JSON.stringify(parsed.dylink.needed)}`, { kind: 'native-library-format' });
    needed = parsed.dylink.needed;
    const module = await WebAssembly.compile(bytes);
    this.unavailable.delete(soname);
    this.modules.set(soname, { soname, abi: this.abi, bytes, sha256: actual, module, needed, provenance, hostImports, apkSha256, requires: provenance?.requires ?? null, descriptor: buildElfDescriptor({ soname, needed, wasmSha256: actual }) });
    return this;
  }
  has(soname) { return this.modules.has(soname); }
  get(soname) { return this.modules.get(soname) ?? null; }
  /** The lab knows this library is needed but has no matching build: loading it raises this explicit UnsatisfiedLinkError instead of the generic JNI-required one. */
  markUnavailable(soname, { message, details = {} }) { this.unavailable.set(soname, { message, details }); return this; }
}

const ENOSYS = 38, EBADF = 8;

export class JniBridge {
  constructor(runtime, provider, platform) {
    this.runtime = runtime; this.provider = provider; this.platform = platform;
    this.libraries = new Map(); // soname -> linked library, for the libraries the app loaded with System.load*/loadLibrary (their JNI_OnLoad ran, natives bind to them)
    this.linker = null; this.proc = null; // the process-wide linker and JNIEnv/JavaVM are created by the first load
    this.registered = new Map(); // "Lowner;->name(sig)" -> { lib, fn, symbol }
    this.locals = new Map(); this.globals = new Map(); this.frames = []; this.nextLocal = 1; this.nextGlobal = 1; this.nextWeak = 1;
    this.methodIds = [null]; this.fieldIds = [null]; this.methodIdByKey = new Map(); this.fieldIdByKey = new Map();
    this.pending = null; this.callerLoader = null;
    // The provider's modules appear in the app's native library directory, so File.exists / findLibrary / SoLoader directory sources see them.
    const fs = platform.javaIo.fs();
    fs.mkdirs(`${fs.codePath}/lib/wasm32`); fs.readOnly.add(`${fs.codePath}/lib`);
    for (const [soname, entry] of provider.modules) if (this.#provides(soname)) fs.mount(`${fs.codePath}/lib/wasm32/${soname}`, entry.descriptor); // ELF descriptor (SONAME/DT_NEEDED of the wasm module), not machine code
  }

  // ---- loading ---------------------------------------------------------------------------------------------------------------------------
  /** System.loadLibrary(name): returns false when the provider has no such library (caller keeps the genuine UnsatisfiedLinkError path). */
  loadLibrary(name) { const soname = `lib${name}.so`; this.#requireAvailable(soname); this.#requireVersions(soname); return this.#provides(soname) ? (this.#load(soname, 'System.loadLibrary'), true) : false; }
  /** A library is offered to this app when the provider has it and it is not scoped to a different APK (an app's own generated libraries, e.g. libappmodules.so, belong to that app only). */
  #provides(soname) { const entry = this.provider.get(soname); return !!entry && (!entry.apkSha256 || entry.apkSha256 === this.runtime.apkSha256); }
  /**
   * Libraries built from a specific React Native release (`requires` in the provenance: reactNative "0.79.4", hermesBytecodeVersion 96) are handed only to an app
   * built with that release: the app's version is read from its DEX (ReactNativeVersion) and its Hermes bundle header. Anything else, or an app whose version
   * cannot be read, gets an explicit UnsatisfiedLinkError that names the version to build, never a library of another version. Checked for the library and its
   * whole DT_NEEDED closure.
   */
  #requireVersions(soname, seen = new Set(), probe = false) {
    if (seen.has(soname)) return; seen.add(soname);
    const entry = this.provider.get(soname); if (!entry) return;
    const need = entry.requires, app = this.runtime.reactNativeVersion, appText = formatVersion(app), hermes = this.runtime.hermesBytecodeVersion;
    const fail = (why, details) => probe ? (() => { throw { probe: true, details: { ...details, why } }; })() : this.runtime.throwJava('Ljava/lang/UnsatisfiedLinkError;', `dlopen failed: library "${soname}" is built by the lab for ${why}`, { kind: 'native-library-unavailable', soname, labReactNative: need?.reactNative ?? null, appReactNative: appText, appHermesBytecodeVersion: hermes ?? null, ...details });
    if (need?.reactNative && appText !== need.reactNative) {
      fail(`React Native ${need.reactNative}, ${appText ? `but this app ships React Native ${appText}` : 'but the lab could not read this app\'s React Native version from its DEX'}. To serve it, add React Native ${appText ?? '<the app\'s version>'} to scripts/wasm/rn-versions.json and build it (scripts/build-native-libs.sh)`, { neededReactNative: appText });
    }
    if (need?.hermesBytecodeVersion && hermes != null && hermes !== need.hermesBytecodeVersion) {
      fail(`Hermes bytecode version ${need.hermesBytecodeVersion} (the Hermes of React Native ${need.reactNative ?? '?'}), but this app's JS bundle is Hermes bytecode version ${hermes}. Build the Hermes release that produces version ${hermes}`, { neededHermesBytecodeVersion: hermes });
    }
    const ax = need?.androidx;
    if (ax) {   // an open-source androidx library: the app's artifact version comes from META-INF/<artifact>.version
      const have = this.runtime.androidxVersions?.[ax.artifact] ?? null;
      if (!have || !ax.versions.includes(have)) {
        const known = ax.versions.join(', ');
        fail(`${ax.artifact} ${known}, ${have ? `but this app ships ${ax.artifact} ${have}` : `but the lab could not read this app's ${ax.artifact} version (no ${ax.versionFile})`}. To serve it, check that the native sources of that release are the ones in scripts/wasm/androidx-libs.json, add the version there and build it (scripts/build-native-libs.sh androidx)`, { neededAndroidx: `${ax.artifact} ${have ?? '(versão não identificada)'}`, labAndroidx: `${ax.artifact} ${known}` });
      }
    }
    for (const dep of entry.needed ?? []) this.#requireVersions(dep, seen, probe);
  }
  /**
   * What the lab can do for a library an app packages, without loading it: { status: 'available' | 'version-gated' | 'missing', needs }. `needs` names the release to build
   * for a version gate. Used by the static API-gap report (src/api-gap-scan.js).
   */
  libraryStatus(soname) {
    if (!this.provider.get(soname) || !this.#provides(soname)) return { status: 'missing' };
    try { this.#requireVersions(soname, new Set(), true); }
    catch (error) {
      if (!error?.probe) throw error;
      const d = error.details; return { status: 'version-gated', needs: d.neededAndroidx ? d.neededAndroidx : d.neededReactNative ? `React Native ${d.neededReactNative}` : d.neededHermesBytecodeVersion ? `Hermes bytecode ${d.neededHermesBytecodeVersion}` : `React Native ${d.labReactNative} (versão do app não identificada)` };
    }
    return { status: 'available' };
  }
  #requireAvailable(soname) {
    const missing = this.provider.unavailable?.get(soname); if (!missing || this.provider.has(soname)) return;
    this.runtime.throwJava('Ljava/lang/UnsatisfiedLinkError;', missing.message, missing.details);
  }
  /** System.load(path) / Runtime.nativeLoad: the file must exist in the virtual filesystem and be a provider module. */
  loadPath(path, via = 'System.load') {
    const soname = path.slice(path.lastIndexOf('/') + 1), fs = this.platform.javaIo.fs();
    if (!path.startsWith('/')) this.runtime.throwJava('Ljava/lang/UnsatisfiedLinkError;', `Expected absolute path to library: ${path}`);
    if (!fs.stat(path)) this.runtime.throwJava('Ljava/lang/UnsatisfiedLinkError;', `dlopen failed: library "${path}" not found`);
    this.#requireAvailable(soname);
    if (!this.#provides(soname)) return false;
    this.#requireVersions(soname);
    this.#load(soname, via); return true;
  }
  /** The process: one linear memory + function table for every library, and the JNIEnv/JavaVM built in it. Created on first use. */
  #process() {
    if (this.proc) return this.proc;
    const r = this.runtime;
    if (!this.provider.has(BASE_SONAME)) r.throwJava('Ljava/lang/UnsatisfiedLinkError;', `dlopen failed: the native library provider has no ${BASE_SONAME} (libc/libc++ base module)`, { kind: 'native-library-base' });
    const linker = new NativeLinker({ base: BASE_SONAME, hostImport: (module, name, soname) => this.#hostImport(module, name, soname) });
    for (const [soname, entry] of this.provider.modules) if (this.#provides(soname)) linker.register(soname, { needed: entry.needed, load: () => ({ module: entry.module, bytes: entry.bytes }) }); // entry.module/bytes may be fetched on first use
    this.linker = linker;
    try { linker.load(BASE_SONAME); } catch (error) { this.linker = null; r.throwJava('Ljava/lang/UnsatisfiedLinkError;', `dlopen failed: ${BASE_SONAME}: ${error.message}`, { kind: 'native-library-instantiate' }); }
    registerWasmMemory(this.runtime, linker.memory);
    this.proc = { memory: linker.memory, table: linker.table, malloc: linker.malloc, free: linker.free, allocations: new Map(), envPtr: 0, vmPtr: 0 };
    this.#installEnv(this.proc);
    return this.proc;
  }
  #load(soname, via) {
    const r = this.runtime;
    if (this.libraries.has(soname)) return;
    const entry = this.provider.get(soname), proc = this.#process();
    let lib;
    try { lib = this.linker.load(soname); }
    catch (error) { if (error instanceof JavaException) throw error; r.throwJava('Ljava/lang/UnsatisfiedLinkError;', `dlopen failed: ${soname}: ${error.message}`, { kind: error instanceof LinkError ? 'native-library-link' : 'native-library-instantiate' }); }
    lib.via = via; this.libraries.set(soname, lib);
    r.record(`JNI loaded ${soname} (${entry.bytes.length} bytes wasm32, sha256 ${entry.sha256.slice(0, 12)}…${lib.deps.length ? `, needs ${lib.deps.map(d => d.soname).join(' ')}` : ''})`);
    const onLoad = lib.exports.JNI_OnLoad;
    if (onLoad && !lib.jniDone) {
      lib.jniDone = true;
      const version = this.#enter(null, () => Number(onLoad(proc.vmPtr, 0)), 'JNI_OnLoad');
      if (!VERSIONS.has(version)) { this.libraries.delete(soname); lib.jniDone = false; r.throwJava('Ljava/lang/UnsatisfiedLinkError;', `JNI_ERR returned from JNI_OnLoad in "${soname}" (version 0x${(version >>> 0).toString(16)})`); }
    }
    lib.loaded = true;
  }
  /** Functions the linker cannot take from a library: WASI, the few Emscripten runtime hooks, and syscalls (which report ENOSYS: there is no kernel). */
  #hostImport(module, name, soname) {
    const r = this.runtime, memory = () => this.linker.memory.buffer;
    // a library's own host module (entry.hostImports), created once per library and bound to the shared process memory
    const owned = this.provider.get(soname)?.hostImports;
    if (owned) { const own = (this.hostImportsOf ??= new Map()).get(soname) ?? (this.hostImportsOf.set(soname, owned(this, soname)), this.hostImportsOf.get(soname)); if (own[module]?.[name]) return own[module][name]; }
    if (module === 'apkweb_android' && name === 'api_level') return () => r.apiLevel;   // android_get_device_api_level() of lab-built libraries (scripts/wasm/androidx/api-level-compat.c)
    if (module === 'wasi_snapshot_preview1') {
      const table = {
        proc_exit: code => { throw new APKError(`${soname} called exit(${code})`, { kind: 'native-exit', code }); },
        environ_sizes_get: (count, size) => { const v = new DataView(memory()); v.setUint32(count, 0, true); v.setUint32(size, 0, true); return 0; },
        environ_get: () => 0, args_sizes_get: (count, size) => { const v = new DataView(memory()); v.setUint32(count, 0, true); v.setUint32(size, 0, true); return 0; }, args_get: () => 0,
        clock_time_get: (_id, _precision, out) => { new DataView(memory()).setBigUint64(out, BigInt(Math.round(performance.now() * 1e6)), true); return 0; },
        clock_res_get: (_id, out) => { new DataView(memory()).setBigUint64(out, 1000n, true); return 0; },
        random_get: (ptr, length) => { for (let done = 0; done < length; done += 65536) globalThis.crypto.getRandomValues(new Uint8Array(memory(), ptr + done, Math.min(65536, length - done))); return 0; },
        fd_close: () => 0, fd_seek: () => 70, fd_fdstat_get: () => EBADF, fd_read: () => EBADF, fd_sync: () => EBADF,
        fd_write: (fd, iovs, count, written) => { // stdout/stderr are routed to the VM trace; other descriptors do not exist
          if (fd !== 1 && fd !== 2) return EBADF;
          const v = new DataView(memory()), bytes = new Uint8Array(memory()); let total = 0, text = '';
          for (let i = 0; i < count; i++) { const at = v.getUint32(iovs + i * 8, true), len = v.getUint32(iovs + i * 8 + 4, true); text += new TextDecoder().decode(bytes.subarray(at, at + len)); total += len; }
          v.setUint32(written, total, true); r.record(`LOG ${fd === 1 ? 'I' : 'E'} native: ${text.trimEnd()}`); return 0;
        },
      };
      return table[name];
    }
    if (module === 'GOT.func') { // functions whose *address* the base takes
      if (name === 'emscripten_console_trace') return hostFunction(['i32'], null, ptr => { const b = new Uint8Array(memory()); let end = ptr; while (b[end]) end++; r.record(`LOG E native: ${decodeModifiedUtf8(b.subarray(ptr, end))}`); });
      return undefined;
    }
    if (module === 'env') {
      // Emscripten runtime hooks of the base module. There is no stack unwinder in WebAssembly, so _Unwind_Backtrace reports an empty stack.
      if (name === 'emscripten_notify_memory_growth') return () => {};
      if (name === '_Unwind_Backtrace') return () => 5; // _URC_END_OF_STACK: no frames are available
      if (name.startsWith('__syscall_')) return () => -ENOSYS; // an honest "function not implemented", never a made-up success
    }
    return undefined;
  }

  // ---- JNIEnv / JavaVM -------------------------------------------------------------------------------------------------------------------
  #installEnv(lib) {
    const slots = JNI_FUNCTIONS.length, base = lib.table.length;
    lib.table.grow(slots);
    const tablePtr = lib.malloc(slots * 4), envPtr = lib.malloc(4), invokePtr = lib.malloc(9 * 4), vmPtr = lib.malloc(4);
    const view = () => new DataView(lib.memory.buffer);
    const handlers = this.#handlers(lib);
    JNI_FUNCTIONS.forEach(([name, params, result], slot) => {
      let fn;
      if (name === 'reserved') { view().setUint32(tablePtr + slot * 4, 0, true); return; }
      const handler = handlers[name];
      fn = handler ? (...args) => this.#guard(name, () => handler(...args)) : () => { throw new APKError(`JNI function ${name} is not implemented by this bridge`, { kind: 'jni-unimplemented', function: name }); };
      lib.table.set(base + slot, hostFunction(params, result, fn));
      view().setUint32(tablePtr + slot * 4, base + slot, true);
    });
    view().setUint32(envPtr, tablePtr, true);
    // JavaVM invoke interface: reserved x3, DestroyJavaVM, AttachCurrentThread, DetachCurrentThread, GetEnv, AttachCurrentThreadAsDaemon
    const invoke = {
      3: [['i32'], 'i32', () => JNI_ERR],
      4: [['i32', 'i32', 'i32'], 'i32', (_vm, penv) => { view().setUint32(penv, envPtr, true); return JNI_OK; }],
      5: [['i32'], 'i32', () => JNI_OK],
      6: [['i32', 'i32', 'i32'], 'i32', (_vm, penv, version) => { if (!VERSIONS.has(version)) { view().setUint32(penv, 0, true); return JNI_EVERSION; } view().setUint32(penv, envPtr, true); return JNI_OK; }],
      7: [['i32', 'i32', 'i32'], 'i32', (_vm, penv) => { view().setUint32(penv, envPtr, true); return JNI_OK; }],
    };
    const invokeBase = lib.table.length; lib.table.grow(Object.keys(invoke).length);
    Object.entries(invoke).forEach(([slot, [params, result, fn]], i) => { lib.table.set(invokeBase + i, hostFunction(params, result, fn)); view().setUint32(invokePtr + Number(slot) * 4, invokeBase + i, true); });
    view().setUint32(vmPtr, invokePtr, true);
    Object.assign(lib, { envPtr, vmPtr });
  }

  /** Runs a JNI function body; Java exceptions raised by callbacks become the pending exception (JNI semantics), everything else propagates. */
  #guard(name, body) {
    try { return body(); }
    catch (error) {
      if (error instanceof JavaException) { this.pending = error.value; return undefined; }
      throw error;
    }
  }

  // ---- references ------------------------------------------------------------------------------------------------------------------------
  #local(value) {
    if (value === null || value === 0 || value === undefined) return 0;
    const handle = this.nextLocal++; this.locals.set(handle, value); this.frames.at(-1)?.push(handle); return handle;
  }
  #global(value) { const handle = GLOBAL_BASE + this.nextGlobal++; this.globals.set(handle, value); return handle; }
  #weak(value) { const handle = WEAK_BASE + this.nextWeak++; this.globals.set(handle, value); return handle; }
  #value(handle) {
    if (handle === 0) return null;
    const value = handle >= GLOBAL_BASE ? this.globals.get(handle) : this.locals.get(handle);
    if (value === undefined) throw new APKError(`Invalid JNI reference 0x${handle.toString(16)} (deleted, from another frame, or never created)`, { kind: 'jni-invalid-reference' });
    return value;
  }
  #classType(handle) { const value = this.#value(handle); const type = this.runtime.object(value).classType; if (!type) throw new APKError('JNI jclass argument is not a java.lang.Class', { kind: 'jni-invalid-reference' }); return type; }

  /** Enter native code: a local-reference frame and the caller's loader for FindClass. */
  #enter(method, body) {
    const frame = []; this.frames.push(frame);
    const outerLoader = this.callerLoader; this.callerLoader = this.runtime.currentMethod?.dex?.definingLoader ?? null;
    try { return body(); }
    finally { this.frames.pop(); for (const h of frame) this.locals.delete(h); this.callerLoader = outerLoader; }
  }

  // ---- native method binding and invocation ---------------------------------------------------------------------------------------------
  bindingFor(method) {
    const key = `${sanitizeAlias(method.owner)}->${method.name}${method.signature}`, registered = this.registered.get(key) ?? this.registered.get(`${method.owner}->${method.name}${method.signature}`);
    if (registered) return registered;
    const className = sanitizeAlias(method.owner).slice(1, -1), shortName = `Java_${mangle(className)}_${mangle(method.name)}`;
    const longName = `${shortName}__${mangle(method.signature.slice(1, method.signature.indexOf(')')))}`;
    for (const lib of this.libraries.values()) for (const symbol of [shortName, longName]) {
      const fn = lib.exports[symbol] ?? lib.exports['_' + symbol];
      if (typeof fn === 'function') { const binding = { lib, fn, symbol }; this.registered.set(key, binding); return binding; }
    }
    return null;
  }
  /** Calls a bound native method with VM argument values (compact form: receiver first for instance methods). */
  invoke(binding, method, args, mode) {
    const r = this.runtime, isStatic = mode === 'static';
    const parameters = method.parameters;
    return this.#enter(method, () => {
      const wasmArgs = [this.proc.envPtr, this.#local(isStatic ? r.classObject(method.owner) : args[0])];
      parameters.forEach((type, i) => wasmArgs.push(this.#toWasm(type, args[(isStatic ? 0 : 1) + i])));
      let result = binding.fn(...wasmArgs);
      if (this.pending !== null) { const exception = this.pending; this.pending = null; throw new JavaException(exception, r.object(exception).message ?? null, r.object(exception).exceptionDetails ?? null); }
      return this.#fromWasm(method.result, result);
    });
  }
  #toWasm(type, value) {
    switch (type) {
      case 'J': return BigInt.asIntN(64, BigInt(value));
      case 'F': return bitsFloat(value);
      case 'D': return bitsDouble(value);
      case 'Z': case 'B': case 'S': case 'C': case 'I': return value | 0;
      default: return this.#local(value);
    }
  }
  #fromWasm(type, raw) {
    switch (type) {
      case 'V': return undefined;
      case 'Z': return (raw & 255) ? 1 : 0;
      case 'B': return (raw << 24) >> 24;
      case 'S': return (raw << 16) >> 16;
      case 'C': return raw & 0xffff;
      case 'I': return raw | 0;
      case 'J': return BigInt.asIntN(64, raw);
      case 'F': return floatBits(raw);
      case 'D': return doubleBits(raw);
      default: return this.#value(raw);
    }
  }

  // ---- member lookup ----------------------------------------------------------------------------------------------------------------------
  #findMethod(type, name, signature) {
    const r = this.runtime, { parameters, result } = parseSignature(signature), queue = [type], seen = new Set();
    while (queue.length) {
      const owner = queue.shift(); if (!owner || seen.has(owner)) continue; seen.add(owner);
      const cls = r.classes.get(owner), info = { owner, name, parameters, result, signature, key: `${owner}->${name}${signature}` };
      if (cls) { const def = cls.methods.get(name + signature); if (def) return { ...info, static: !!(def.flags & 8) }; queue.push(cls.superclass, ...cls.interfaces); }
      else if (r.methodAvailability({ owner, name, signature })) return { ...info, static: false, host: true };
      else queue.push(r.parent(owner), ...r.interfaces(owner));
      if (name === '<init>' && owner === type && !cls && !r.methodAvailability({ owner, name, signature })) break;
    }
    return null;
  }
  #methodId(info) { let id = this.methodIdByKey.get(info.key); if (!id) { id = this.methodIds.length; this.methodIds.push(info); this.methodIdByKey.set(info.key, id); } return id; }
  #fieldId(info) { const key = info.key + (info.static ? '#s' : ''); let id = this.fieldIdByKey.get(key); if (!id) { id = this.fieldIds.length; this.fieldIds.push(info); this.fieldIdByKey.set(key, id); } return id; }
  /**
   * android.graphics.Path.mNativePath (J): on Android the address of the Path's SkPath, which native libraries read directly (androidx graphics-path). The lab's Path is a CanvasKit
   * path owned by the Skia host, so this field is virtual: each read returns the address of an SkPath mirror of the Path's current contents in the process memory,
   * written with the layout of the Skia the lab's API level ships (src/skia-path-layout.js) and rebuilt when the Path changed.
   */
  #nativePathAddress(value) {
    const r = this.runtime, host = r.skiaHost;
    if (!host?.pathSnapshot) throw new APKError('android.graphics.Path.mNativePath is not available: the Skia host is not loaded', { kind: 'native-path-unavailable' });
    const { commands, fillType } = host.pathSnapshot(value), key = value.ref ?? value;
    const cache = this.nativePaths ??= new Map(), entry = cache.get(key);
    const same = entry && entry.fillType === fillType && entry.commands.length === commands.length && entry.commands.every((v, i) => Object.is(v, commands[i]));
    if (same) { cache.delete(key); cache.set(key, entry); return entry.address; }   // most recently used last
    this.#process();
    let written;
    try { written = writeSkPath({ memory: this.proc.memory, malloc: this.proc.malloc }, commands, { apiLevel: r.apiLevel, fillType }); }
    catch (error) { throw new APKError(`Cannot mirror the Path for native code: ${error.message}`, { kind: 'native-path-unsupported', apiLevel: r.apiLevel }); }
    // the previous generation stays allocated (an iterator created before the edit may still be reading it); the one before it is released
    for (const block of entry?.older ?? []) this.proc.free(block);
    cache.delete(key); cache.set(key, { commands: Float32Array.from(commands), fillType, address: written.address, blocks: written.blocks, older: entry?.blocks ?? [] });
    while (cache.size > 512) { const [oldKey, old] = cache.entries().next().value; for (const block of [...old.blocks, ...old.older]) this.proc.free(block); cache.delete(oldKey); }
    return written.address;
  }
  #findField(type, name, signature, isStatic) {
    const r = this.runtime, seen = new Set(), queue = [type];
    if (type === 'Landroid/graphics/Path;' && name === 'mNativePath' && signature === 'J' && !isStatic && r.skiaHost?.pathSnapshot) return { owner: type, name, type: signature, key: `${type}->mNativePath:J`, static: false, nativePath: true };
    while (queue.length) {
      const owner = queue.shift(); if (!owner || seen.has(owner)) continue; seen.add(owner);
      const cls = r.classes.get(owner); if (!cls) continue;
      for (const entry of [...cls.fields, ...cls.staticFields]) {
        const declared = cls.dex.fields[entry.index], statics = cls.staticFields.includes(entry);
        if (declared.name === name && declared.type === signature && statics === isStatic) return { owner: declared.owner, name, type: signature, key: declared.key, static: statics };
      }
      queue.push(cls.superclass, ...cls.interfaces);
    }
    return null;
  }
  #throwNew(type, message) {
    const r = this.runtime, exception = r.allocate(type);
    r.dispatch({ owner: type, name: '<init>', parameters: ['Ljava/lang/String;'], result: 'V', signature: '(Ljava/lang/String;)V' }, [exception, message ?? null], 'direct');
    this.pending = exception;
  }

  // ---- the JNI function table -------------------------------------------------------------------------------------------------------------
  #handlers(lib) {
    const r = this.runtime, self = this;
    const view = () => new DataView(lib.memory.buffer), bytes = () => new Uint8Array(lib.memory.buffer);
    const cString = ptr => { const b = bytes(); let end = ptr; while (b[end]) end++; return decodeModifiedUtf8(b.subarray(ptr, end)); };
    const putCString = (text) => { const encoded = encodeModifiedUtf8(text), ptr = lib.malloc(encoded.length + 1); bytes().set(encoded, ptr); bytes()[ptr + encoded.length] = 0; return ptr; };
    const stringOf = handle => { const v = self.#value(handle); return v === null ? null : r.stringCharacters(v); };
    const arrayOf = handle => { const v = self.#value(handle); if (v === null) throw new APKError('JNI array argument is null', { kind: 'jni-null' }); return r.array(v); };
    const outOfBounds = (message) => { self.#throwNew('Ljava/lang/ArrayIndexOutOfBoundsException;', message); };
    const h = {};

    // -- version / classes
    h.GetVersion = () => 0x10008;
    h.FindClass = (_env, namePtr) => {
      const name = cString(namePtr);
      try { return self.#local(r.resolveClass(name.replaceAll('/', '.'), false, self.callerLoader ?? undefined)); }
      catch (error) { if (error instanceof JavaException) { self.#throwNew('Ljava/lang/NoClassDefFoundError;', name); return 0; } throw error; }
    };
    h.GetSuperclass = (_env, cls) => { const type = self.#classType(cls); const parent = r.classes.get(type)?.flags & 0x200 ? null : r.parent(type); return parent ? self.#local(r.classObject(parent)) : 0; };
    h.IsAssignableFrom = (_env, sub, sup) => r.isSubtype(self.#classType(sub), self.#classType(sup)) ? 1 : 0;
    h.GetObjectClass = (_env, obj) => self.#local(r.classObject(r.typeOf(self.#value(obj))));
    h.IsInstanceOf = (_env, obj, cls) => { const v = self.#value(obj); return v === null || r.isSubtype(r.typeOf(v), self.#classType(cls)) ? 1 : 0; };
    h.IsSameObject = (_env, a, b) => { const x = self.#value(a), y = self.#value(b); return (x === y || (x && y && typeof x === 'object' && typeof y === 'object' && x.ref === y.ref)) ? 1 : 0; };
    h.GetObjectRefType = (_env, obj) => obj === 0 ? 0 : obj >= WEAK_BASE ? 3 : obj >= GLOBAL_BASE ? 2 : 1;

    // -- exceptions
    h.Throw = (_env, obj) => { self.pending = self.#value(obj); return JNI_OK; };
    h.ThrowNew = (_env, cls, msgPtr) => { self.#throwNew(self.#classType(cls), msgPtr ? cString(msgPtr) : null); return JNI_OK; };
    h.ExceptionOccurred = () => self.#local(self.pending);
    h.ExceptionCheck = () => self.pending === null ? 0 : 1;
    h.ExceptionClear = () => { self.pending = null; };
    h.ExceptionDescribe = () => { if (self.pending !== null) r.record(`LOG E jni: pending ${r.typeOf(self.pending)}: ${r.object(self.pending).message ?? ''}`); };
    h.FatalError = (_env, msgPtr) => { throw new APKError(`JNI FatalError: ${cString(msgPtr)}`, { kind: 'jni-fatal' }); };

    // -- references
    h.NewGlobalRef = (_env, obj) => obj === 0 ? 0 : self.#global(self.#value(obj));
    h.DeleteGlobalRef = (_env, obj) => { self.globals.delete(obj); };
    h.NewWeakGlobalRef = (_env, obj) => obj === 0 ? 0 : self.#weak(self.#value(obj));
    h.DeleteWeakGlobalRef = (_env, obj) => { self.globals.delete(obj); };
    h.NewLocalRef = (_env, obj) => self.#local(self.#value(obj));
    h.DeleteLocalRef = (_env, obj) => { self.locals.delete(obj); };
    h.EnsureLocalCapacity = () => JNI_OK;
    h.PushLocalFrame = () => { self.frames.push([]); return JNI_OK; };
    h.PopLocalFrame = (_env, result) => { const value = result === 0 ? null : self.#value(result), frame = self.frames.pop() ?? []; for (const handle of frame) self.locals.delete(handle); return self.#local(value); };
    h.MonitorEnter = (_env, obj) => { const o = r.object(self.#value(obj)); o.jniMonitor = (o.jniMonitor ?? 0) + 1; return JNI_OK; };
    h.MonitorExit = (_env, obj) => { const o = r.object(self.#value(obj)); if (!o.jniMonitor) { self.#throwNew('Ljava/lang/IllegalMonitorStateException;', 'object not locked by thread before MonitorExit'); return JNI_ERR; } o.jniMonitor--; return JNI_OK; };
    h.GetJavaVM = (_env, out) => { view().setUint32(out, lib.vmPtr, true); return JNI_OK; };

    // -- members
    const memberId = (isStatic) => (_env, cls, namePtr, sigPtr) => {
      const type = self.#classType(cls), name = cString(namePtr), signature = cString(sigPtr), info = self.#findMethod(type, name, signature);
      if (!info || (name !== '<init>' && info.static !== isStatic && !info.host)) { self.#throwNew('Ljava/lang/NoSuchMethodError;', name); return 0; }
      r.initialize?.(type);
      return self.#methodId({ ...info, static: isStatic });
    };
    h.GetMethodID = memberId(false); h.GetStaticMethodID = memberId(true);
    const fieldId = (isStatic) => (_env, cls, namePtr, sigPtr) => {
      const info = self.#findField(self.#classType(cls), cString(namePtr), cString(sigPtr), isStatic);
      if (!info) { self.#throwNew('Ljava/lang/NoSuchFieldError;', cString(namePtr)); return 0; }
      return self.#fieldId(info);
    };
    h.GetFieldID = fieldId(false); h.GetStaticFieldID = fieldId(true);

    // -- calls: argument decoding for "...", va_list (same buffer layout on wasm32) and jvalue*
    const varargs = (parameters, ptr) => {
      const out = []; let cursor = ptr; const v = view();
      for (const type of parameters) {
        if (type === 'J' || type === 'D') { cursor = (cursor + 7) & ~7; out.push(type === 'J' ? v.getBigInt64(cursor, true) : v.getFloat64(cursor, true)); cursor += 8; }
        else if (type === 'F') { cursor = (cursor + 7) & ~7; out.push(v.getFloat64(cursor, true)); cursor += 8; } // float is promoted to double in varargs
        else { out.push(v.getInt32(cursor, true)); cursor += 4; }
      }
      return out;
    };
    const jvalues = (parameters, ptr) => {
      const v = view(); return parameters.map((type, i) => { const at = ptr + i * 8; return type === 'J' ? v.getBigInt64(at, true) : type === 'D' ? v.getFloat64(at, true) : type === 'F' ? v.getFloat32(at, true) : type === 'Z' ? v.getUint8(at) : type === 'B' ? v.getInt8(at) : type === 'S' ? v.getInt16(at, true) : type === 'C' ? v.getUint16(at, true) : v.getInt32(at, true); });
    };
    const toVM = (type, raw) => {
      switch (type) {
        case 'Z': return raw & 255 ? 1 : 0; case 'B': return (raw << 24) >> 24; case 'S': return (raw << 16) >> 16; case 'C': return raw & 0xffff; case 'I': return raw | 0;
        case 'J': return BigInt.asIntN(64, BigInt(raw)); case 'F': return floatBits(raw); case 'D': return doubleBits(raw); default: return self.#value(raw);
      }
    };
    const toJNI = (type, value) => {
      switch (type) {
        case 'V': return undefined; case 'F': return bitsFloat(value); case 'D': return bitsDouble(value); case 'J': return BigInt.asIntN(64, BigInt(value));
        case 'Z': case 'B': case 'S': case 'C': case 'I': return value | 0; default: return self.#local(value);
      }
    };
    const callWith = (mode, kind, resultType) => (_env, objOrCls, ...rest) => {
      const nonvirtual = mode === 'nonvirtual', mid = rest[nonvirtual ? 1 : 0], argPtr = rest[nonvirtual ? 2 : 1];
      const info = self.methodIds[mid]; if (!info) throw new APKError('Invalid jmethodID', { kind: 'jni-invalid-reference' });
      const raw = kind === 'A' ? jvalues(info.parameters, argPtr) : varargs(info.parameters, argPtr);
      const values = info.parameters.map((type, i) => toVM(type, raw[i]));
      const words = r.argumentWords(info.parameters, values, mode === 'static' ? {} : { receiver: self.#value(objOrCls) });
      let result;
      if (mode === 'static') result = r.dispatch({ ...info }, words, 'static');
      else if (nonvirtual) result = r.dispatch({ ...info, owner: self.#classType(rest[0]) }, words, info.name === '<init>' ? 'direct' : 'direct');
      else result = r.dispatch(info, words, 'virtual');
      return toJNI(resultType, result);
    };
    const callTypes = [['Object', 'L'], ['Boolean', 'Z'], ['Byte', 'B'], ['Char', 'C'], ['Short', 'S'], ['Int', 'I'], ['Long', 'J'], ['Float', 'F'], ['Double', 'D'], ['Void', 'V']];
    for (const [name, code] of callTypes) for (const mode of ['', 'Nonvirtual', 'Static']) for (const [suffix, kind] of [['', 'V'], ['V', 'V'], ['A', 'A']]) {
      h[`Call${mode}${name}Method${suffix}`] = callWith(mode.toLowerCase() || 'virtual', kind, code);
    }
    h.AllocObject = (_env, cls) => self.#local(r.allocate(self.#classType(cls)));
    const newObject = (kind) => (_env, cls, mid, argPtr) => {
      const info = self.methodIds[mid], type = self.#classType(cls);
      const raw = kind === 'A' ? jvalues(info.parameters, argPtr) : varargs(info.parameters, argPtr);
      const object = r.allocate(type);
      r.dispatch({ ...info, owner: info.owner }, r.argumentWords(info.parameters, info.parameters.map((t, i) => toVM(t, raw[i])), { receiver: object }), 'direct');
      return self.#local(object);
    };
    h.NewObject = newObject('V'); h.NewObjectV = newObject('V'); h.NewObjectA = newObject('A');

    // -- fields
    const fieldRef = id => { const f = self.fieldIds[id]; if (!f) throw new APKError('Invalid jfieldID', { kind: 'jni-invalid-reference' }); return f; };
    for (const [name, code] of callTypes.slice(0, 9)) {
      h[`Get${name}Field`] = (_env, obj, id) => { const f = fieldRef(id); if (f.nativePath) return toJNI(code, BigInt(self.#nativePathAddress(self.#value(obj)))); const o = r.object(self.#value(obj)), stored = o.fields.get(f.key); return toJNI(code, stored === undefined ? defaultFor(f.type) : stored); };
      h[`Set${name}Field`] = (_env, obj, id, value) => { const f = fieldRef(id); r.storeField(r.object(self.#value(obj)).fields, f.key, toVM(code, value)); };
      h[`GetStatic${name}Field`] = (_env, _cls, id) => { const f = fieldRef(id); return toJNI(code, r.readStatic({ owner: f.owner, name: f.name, type: f.type, key: f.key })); };
      h[`SetStatic${name}Field`] = (_env, _cls, id, value) => { const f = fieldRef(id); r.writeStatic({ owner: f.owner, name: f.name, type: f.type, key: f.key }, toVM(code, value)); };
    }

    // -- strings
    h.NewStringUTF = (_env, ptr) => ptr === 0 ? 0 : self.#local(cString(ptr));
    h.GetStringUTFLength = (_env, s) => encodeModifiedUtf8(stringOf(s)).length;
    h.GetStringUTFChars = (_env, s, isCopy) => { if (isCopy) view().setUint8(isCopy, 1); const ptr = putCString(stringOf(s)); lib.allocations.set(ptr, 'string'); return ptr; };
    h.ReleaseStringUTFChars = (_env, _s, ptr) => { lib.allocations.delete(ptr); lib.free(ptr); };
    h.GetStringLength = (_env, s) => stringOf(s).length;
    h.GetStringChars = (_env, s, isCopy) => {
      const text = stringOf(s), ptr = lib.malloc(text.length * 2 + 2), v = view(); if (isCopy) v.setUint8(isCopy, 1);
      for (let i = 0; i < text.length; i++) v.setUint16(ptr + i * 2, text.charCodeAt(i), true); v.setUint16(ptr + text.length * 2, 0, true); lib.allocations.set(ptr, 'chars'); return ptr;
    };
    h.ReleaseStringChars = (_env, _s, ptr) => { lib.allocations.delete(ptr); lib.free(ptr); };
    h.GetStringCritical = h.GetStringChars; h.ReleaseStringCritical = h.ReleaseStringChars;
    h.NewString = (_env, ptr, length) => { const v = view(); let text = ''; for (let i = 0; i < length; i++) text += String.fromCharCode(v.getUint16(ptr + i * 2, true)); return self.#local(text); };
    h.GetStringRegion = (_env, s, start, length, out) => {
      const text = stringOf(s); if (start < 0 || length < 0 || start + length > text.length) { self.#throwNew('Ljava/lang/StringIndexOutOfBoundsException;', `region ${start}+${length} out of ${text.length}`); return; }
      const v = view(); for (let i = 0; i < length; i++) v.setUint16(out + i * 2, text.charCodeAt(start + i), true);
    };
    h.GetStringUTFRegion = (_env, s, start, length, out) => {
      const text = stringOf(s); if (start < 0 || length < 0 || start + length > text.length) { self.#throwNew('Ljava/lang/StringIndexOutOfBoundsException;', `region ${start}+${length} out of ${text.length}`); return; }
      const encoded = encodeModifiedUtf8(text.slice(start, start + length)); bytes().set(encoded, out); bytes()[out + encoded.length] = 0;
    };

    // -- arrays
    h.GetArrayLength = (_env, a) => arrayOf(a).elements.length;
    // -- direct buffers (ART semantics): NewDirectByteBuffer calls DirectByteBuffer(long, int) like ART; the buffer's address is a wasm32 pointer, which libcore's Memory/Unsafe
    //    natives resolve against the live process memory (unsafe-native.js registerWasmMemory), so reads and writes through the ByteBuffer hit the library's memory and survive memory.grow.
    const DIRECT = 'Ljava/nio/DirectByteBuffer;', BUFFER = 'Ljava/nio/Buffer;';
    h.NewDirectByteBuffer = (_env, address, capacity) => {
      if (capacity < 0n || capacity > 0x7fffffffn) { self.#throwNew('Ljava/lang/IllegalArgumentException;', `negative or too large capacity: ${capacity}`); return 0; }
      r.resolveClass('java.nio.DirectByteBuffer', false);   // ART looks the class up the same way (boot class path)
      const object = r.allocate(DIRECT);
      r.dispatch({ owner: DIRECT, name: '<init>', parameters: ['J', 'I'], result: 'V', signature: '(JI)V' }, r.argumentWords(['J', 'I'], [BigInt(address >>> 0), Number(capacity)], { receiver: object }), 'direct');
      return self.#local(object);
    };
    const directBuffer = handle => {   // the Buffer object when it is a direct java.nio.Buffer, else null
      const v = self.#value(handle); if (v === null) return null;
      const object = r.object(v); if (!r.isSubtype(object.type, BUFFER)) return null;
      return r.dispatch({ owner: BUFFER, name: 'isDirect', parameters: [], result: 'Z', signature: '()Z' }, r.argumentWords([], [], { receiver: v }), 'virtual') ? object : null;
    };
    h.GetDirectBufferAddress = (_env, buf) => { const object = directBuffer(buf); return object ? Number(BigInt.asUintN(32, BigInt(object.fields.get('Ljava/nio/Buffer;->address:J') ?? 0n))) : 0; };
    h.GetDirectBufferCapacity = (_env, buf) => { const object = directBuffer(buf); return object ? BigInt(object.fields.get('Ljava/nio/Buffer;->capacity:I') ?? 0) : -1n; };
    h.NewObjectArray = (_env, length, cls, init) => {
      if (length < 0) { self.#throwNew('Ljava/lang/NegativeArraySizeException;', String(length)); return 0; }
      const array = r.newArray(`[${self.#classType(cls)}`, length), fill = self.#value(init); if (fill !== null) r.array(array).elements.fill(fill); return self.#local(array);
    };
    h.GetObjectArrayElement = (_env, a, i) => { const array = arrayOf(a); if (i < 0 || i >= array.elements.length) { outOfBounds(`length=${array.elements.length}; index=${i}`); return 0; } return self.#local(array.elements[i]); };
    h.SetObjectArrayElement = (_env, a, i, v) => { const array = arrayOf(a); if (i < 0 || i >= array.elements.length) { outOfBounds(`length=${array.elements.length}; index=${i}`); return; } array.elements[i] = self.#value(v); };
    for (const [name, code, size] of PRIMITIVES) {
      const write = (v, at, value) => { switch (code) { case 'Z': v.setUint8(at, value & 1); break; case 'B': v.setInt8(at, value); break; case 'C': v.setUint16(at, value, true); break; case 'S': v.setInt16(at, value, true); break; case 'I': case 'F': v.setInt32(at, value, true); break; default: v.setBigInt64(at, BigInt.asIntN(64, BigInt(value)), true); } };
      const read = (v, at) => { switch (code) { case 'Z': return v.getUint8(at) ? 1 : 0; case 'B': return v.getInt8(at); case 'C': return v.getUint16(at, true); case 'S': return v.getInt16(at, true); case 'I': case 'F': return v.getInt32(at, true); default: return v.getBigInt64(at, true); } };
      h[`New${name}Array`] = (_env, length) => { if (length < 0) { self.#throwNew('Ljava/lang/NegativeArraySizeException;', String(length)); return 0; } return self.#local(r.newArray(`[${code}`, length)); };
      h[`Get${name}ArrayElements`] = (_env, a, isCopy) => {
        const array = arrayOf(a), ptr = lib.malloc(Math.max(1, array.elements.length * size)), v = view(); if (isCopy) v.setUint8(isCopy, 1);
        array.elements.forEach((e, i) => write(v, ptr + i * size, e)); lib.allocations.set(ptr, { array: self.#value(a), code, size }); return ptr;
      };
      h[`Release${name}ArrayElements`] = (_env, a, ptr, mode) => {
        const array = arrayOf(a), v = view();
        if (mode === 0 || mode === 1) array.elements.forEach((_, i) => { array.elements[i] = read(v, ptr + i * size); });
        if (mode === 0 || mode === 2) { lib.allocations.delete(ptr); lib.free(ptr); }
      };
      h[`Get${name}ArrayRegion`] = (_env, a, start, length, out) => {
        const array = arrayOf(a); if (start < 0 || length < 0 || start + length > array.elements.length) return outOfBounds(`length=${array.elements.length}; regionStart=${start}; regionLength=${length}`);
        const v = view(); for (let i = 0; i < length; i++) write(v, out + i * size, array.elements[start + i]);
      };
      h[`Set${name}ArrayRegion`] = (_env, a, start, length, src) => {
        const array = arrayOf(a); if (start < 0 || length < 0 || start + length > array.elements.length) return outOfBounds(`length=${array.elements.length}; regionStart=${start}; regionLength=${length}`);
        const v = view(); for (let i = 0; i < length; i++) array.elements[start + i] = read(v, src + i * size);
      };
    }
    h.GetPrimitiveArrayCritical = (_env, a, isCopy) => {
      const array = arrayOf(a), code = array.type[1], entry = PRIMITIVES.find(p => p[1] === code); if (!entry) throw new APKError('GetPrimitiveArrayCritical requires a primitive array', { kind: 'jni-bad-argument' });
      return h[`Get${entry[0]}ArrayElements`](_env, a, isCopy);
    };
    h.ReleasePrimitiveArrayCritical = (_env, a, ptr, mode) => { const array = arrayOf(a), entry = PRIMITIVES.find(p => p[1] === array.type[1]); return h[`Release${entry[0]}ArrayElements`](_env, a, ptr, mode); };

    // -- natives
    h.RegisterNatives = (_env, cls, methods, count) => {
      const type = self.#classType(cls), v = view();
      for (let i = 0; i < count; i++) {
        const name = cString(v.getUint32(methods + i * 12, true)), signature = cString(v.getUint32(methods + i * 12 + 4, true)).replace(/^[!]/, ''), index = v.getUint32(methods + i * 12 + 8, true);
        // ART's RegisterNatives finds the method in the class or, through FindVirtualMethod, in a superclass (reanimated registers NativeProxyCommon.installJSIBindings on NativeProxy); the binding belongs to the declaring class
        const info = self.#findMethod(type, name, signature), owner = info && !info.host ? info.owner : type, def = r.classes.get(owner)?.methods.get(name + signature);
        if (!def || !(def.flags & 0x100)) { self.#throwNew('Ljava/lang/NoSuchMethodError;', name); return JNI_ERR; }
        const fn = lib.table.get(index); if (typeof fn !== 'function') { self.#throwNew('Ljava/lang/NoSuchMethodError;', `${name}: null function pointer`); return JNI_ERR; }
        self.registered.set(`${owner}->${name}${signature}`, { lib, fn, symbol: `<RegisterNatives ${name}${signature}>` });
      }
      return JNI_OK;
    };
    h.UnregisterNatives = (_env, cls) => { const type = self.#classType(cls); for (const key of [...self.registered.keys()]) if (key.startsWith(type + '->')) self.registered.delete(key); return JNI_OK; };
    return h;
  }
}

const defaultFor = type => type === 'J' || type === 'D' ? 0n : type.startsWith('L') || type.startsWith('[') ? null : 0;

export function decodeModifiedUtf8(b) {
  let out = '';
  for (let i = 0; i < b.length;) {
    const a = b[i++];
    if (a < 0x80) out += String.fromCharCode(a);
    else if ((a & 0xe0) === 0xc0) out += String.fromCharCode(((a & 0x1f) << 6) | (b[i++] & 0x3f));
    else if ((a & 0xf0) === 0xe0) out += String.fromCharCode(((a & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
    else { const cp = ((a & 7) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f); out += String.fromCodePoint(cp); }
  }
  return out;
}
export function encodeModifiedUtf8(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) out.push(0xc0, 0x80);
    else if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); // supplementary characters stay as two 3-byte surrogates (CESU-8)
  }
  return Uint8Array.from(out);
}
