import { APKError } from './apk-error.js?v=32afb2a18437';
import { JavaException } from './apk-runtime.js?v=32afb2a18437';
import { JNI_FUNCTIONS } from './jni-function-table.js?v=32afb2a18437';
import { buildElfDescriptor } from './native-descriptor.js?v=32afb2a18437';
import { parseSignature, bitsDouble, bitsFloat, doubleBits, floatBits } from './host-contract.js?v=32afb2a18437';

// JNI -> WebAssembly bridge.
//
// Native library provider: the *lab* supplies verified WebAssembly modules per (library name, ABI "wasm32"); nothing is ever taken from an APK.
// System.loadLibrary(name) / System.load(path) / Runtime.nativeLoad resolve the file name against the app's virtual lib directory, where the
// provider's modules are mounted, then:
//   1. instantiate the module (imports are limited to a small WASI subset; anything else is an explicit failure),
//   2. build a JNIEnv/JavaVM in the module's linear memory: JNIEnv* -> { functions* } with the 235 JNINativeInterface_ slots, each slot a table
//      entry whose body is a JS function over the VM heap (signatures generated from jni.h, scripts/generate-jni-table.py),
//   3. call JNI_OnLoad(JavaVM*, NULL) and require a supported version,
//   4. bind `native` Java methods through RegisterNatives or the Java_<class>_<method>[__<signature>] export naming rules.
// A native method with no binding still raises UnsatisfiedLinkError; a JNI function this bridge has not implemented fails with a JNI-specific
// APKError. Handles: local refs live for the duration of a native call (frames), global/weak refs until deleted (no GC, so weak == strong).
//
// ABI: wasm32; jint=i32, jlong=i64 (BigInt in JS), jfloat=f32, jdouble=f64, pointers and jobject/jmethodID/jfieldID handles = i32. The module must
// export memory, malloc and free, and may export __indirect_function_table (required: JNI slots are installed by growing it) and _initialize.

const JNI_OK = 0, JNI_ERR = -1, JNI_EVERSION = -3;
const VERSIONS = new Set([0x10001, 0x10002, 0x10004, 0x10006, 0x10008]);
const GLOBAL_BASE = 0x40000000, WEAK_BASE = 0x60000000;
const PRIMITIVES = [['Boolean', 'Z', 1], ['Byte', 'B', 1], ['Char', 'C', 2], ['Short', 'S', 2], ['Int', 'I', 4], ['Long', 'J', 8], ['Float', 'F', 4], ['Double', 'D', 8]];
const WASM_TYPE = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c };
const LEB = n => { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };

const wrapperModules = new Map();
/** A real wasm function that forwards to `fn`, usable as a table entry (the same technique Emscripten's addFunction uses). */
function hostFunction(params, result, fn) {
  const key = params.join(',') + '>' + (result ?? '');
  let module = wrapperModules.get(key);
  if (!module) {
    const type = [0x60, ...LEB(params.length), ...params.map(p => WASM_TYPE[p]), ...LEB(result ? 1 : 0), ...(result ? [WASM_TYPE[result]] : [])];
    const section = (id, payload) => [id, ...LEB(payload.length), ...payload];
    const bytes = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, [1, ...type]), ...section(2, [1, 1, 0x65, 1, 0x66, 0, 0]), ...section(7, [1, 1, 0x66, 0, 0])];
    module = new WebAssembly.Module(Uint8Array.from(bytes)); wrapperModules.set(key, module);
  }
  return new WebAssembly.Instance(module, { e: { f: fn } }).exports.f;
}

const mangle = text => { let out = ''; for (const ch of text) { if (ch === '/') out += '_'; else if (ch === '_') out += '_1'; else if (ch === ';') out += '_2'; else if (ch === '[') out += '_3'; else if (/[A-Za-z0-9]/.test(ch)) out += ch; else out += '_0' + ch.charCodeAt(0).toString(16).padStart(4, '0'); } return out; };
const sanitizeAlias = type => type.replace(/\$\$ldr\d+;$/, ';');

/** Lab-controlled registry of WebAssembly native libraries. `add` verifies the pinned SHA-256 before compiling; there is no API that accepts APK bytes. */
export class NativeLibraryProvider {
  constructor({ abi = 'wasm32' } = {}) { this.abi = abi; this.modules = new Map(); }
  async add({ soname, wasm, sha256, needed = [], provenance = null }) {
    if (!/^lib[\w.+-]+\.so$/.test(soname)) throw new APKError(`Invalid native library name ${soname}`);
    if (!/^[0-9a-f]{64}$/i.test(sha256 ?? '')) throw new APKError(`Native library ${soname} needs a pinned SHA-256`);
    const bytes = wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm);
    const actual = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (actual !== sha256.toLowerCase()) throw new APKError(`Native library ${soname} does not match its pinned SHA-256 (expected ${sha256}, got ${actual})`, { kind: 'native-library-hash-mismatch' });
    const module = await WebAssembly.compile(bytes);
    this.modules.set(soname, { soname, abi: this.abi, bytes, sha256: actual, module, needed, provenance, descriptor: buildElfDescriptor({ soname, needed, wasmSha256: actual }) });
    return this;
  }
  has(soname) { return this.modules.has(soname); }
  get(soname) { return this.modules.get(soname) ?? null; }
}

export class JniBridge {
  constructor(runtime, provider, platform) {
    this.runtime = runtime; this.provider = provider; this.platform = platform;
    this.libraries = new Map(); // soname -> library context
    this.registered = new Map(); // "Lowner;->name(sig)" -> { lib, index }
    this.locals = new Map(); this.globals = new Map(); this.frames = []; this.nextLocal = 1; this.nextGlobal = 1; this.nextWeak = 1;
    this.methodIds = [null]; this.fieldIds = [null]; this.methodIdByKey = new Map(); this.fieldIdByKey = new Map();
    this.pending = null; this.callerLoader = null;
    // The provider's modules appear in the app's native library directory, so File.exists / findLibrary / SoLoader directory sources see them.
    const fs = platform.javaIo.fs();
    fs.mkdirs(`${fs.codePath}/lib/wasm32`); fs.readOnly.add(`${fs.codePath}/lib`);
    for (const [soname, entry] of provider.modules) fs.mount(`${fs.codePath}/lib/wasm32/${soname}`, entry.descriptor); // ELF descriptor (SONAME/DT_NEEDED of the wasm module), not machine code
  }

  // ---- loading ---------------------------------------------------------------------------------------------------------------------------
  /** System.loadLibrary(name): returns false when the provider has no such library (caller keeps the genuine UnsatisfiedLinkError path). */
  loadLibrary(name) { const soname = `lib${name}.so`; return this.provider.has(soname) ? (this.#load(soname, 'System.loadLibrary'), true) : false; }
  /** System.load(path) / Runtime.nativeLoad: the file must exist in the virtual filesystem and be a provider module. */
  loadPath(path, via = 'System.load') {
    const soname = path.slice(path.lastIndexOf('/') + 1), fs = this.platform.javaIo.fs();
    if (!path.startsWith('/')) this.runtime.throwJava('Ljava/lang/UnsatisfiedLinkError;', `Expected absolute path to library: ${path}`);
    if (!fs.stat(path)) this.runtime.throwJava('Ljava/lang/UnsatisfiedLinkError;', `dlopen failed: library "${path}" not found`);
    if (!this.provider.has(soname)) return false;
    this.#load(soname, via); return true;
  }
  #load(soname, via) {
    const r = this.runtime;
    if (this.libraries.has(soname)) return;
    const entry = this.provider.get(soname);
    let instance;
    try {
      const imports = {};
      for (const { module, name, kind } of WebAssembly.Module.imports(entry.module)) {
        if (kind !== 'function') throw new APKError(`${soname} imports ${module}.${name} (${kind}); only function imports are supported`, { kind: 'native-library-import' });
        (imports[module] ??= {})[name] = this.#systemImport(soname, module, name);
      }
      instance = new WebAssembly.Instance(entry.module, imports);
    } catch (error) { r.throwJava('Ljava/lang/UnsatisfiedLinkError;', `dlopen failed: ${soname}: ${error.message}`, { kind: 'native-library-instantiate' }); }
    const exports = instance.exports, need = name => exports[name] ?? r.throwJava('Ljava/lang/UnsatisfiedLinkError;', `dlopen failed: ${soname} does not export ${name}`);
    const lib = { soname, instance, exports, memory: need('memory'), table: need('__indirect_function_table'), malloc: need('malloc'), free: need('free'), allocations: new Map() };
    exports._initialize?.();
    lib.via = via; this.libraries.set(soname, lib);
    this.#installEnv(lib);
    r.record(`JNI loaded ${soname} (${entry.bytes.length} bytes wasm32, sha256 ${entry.sha256.slice(0, 12)}…)`);
    const onLoad = exports.JNI_OnLoad ?? exports._JNI_OnLoad;
    if (onLoad) {
      const version = this.#enter(null, () => Number(onLoad(lib.vmPtr, 0)), 'JNI_OnLoad');
      if (!VERSIONS.has(version)) { this.libraries.delete(soname); r.throwJava('Ljava/lang/UnsatisfiedLinkError;', `JNI_ERR returned from JNI_OnLoad in "${soname}" (version 0x${(version >>> 0).toString(16)})`); }
    }
    lib.loaded = true;
  }
  #systemImport(soname, module, name) {
    const r = this.runtime;
    if (module === 'wasi_snapshot_preview1') {
      const lib = () => this.libraries.get(soname);
      const table = {
        proc_exit: code => { throw new APKError(`${soname} called exit(${code})`, { kind: 'native-exit', code }); },
        environ_sizes_get: (count, size) => { const v = new DataView(lib().memory.buffer); v.setUint32(count, 0, true); v.setUint32(size, 0, true); return 0; },
        environ_get: () => 0, args_sizes_get: (count, size) => { const v = new DataView(lib().memory.buffer); v.setUint32(count, 0, true); v.setUint32(size, 0, true); return 0; }, args_get: () => 0,
        clock_time_get: (_id, _precision, out) => { new DataView(lib().memory.buffer).setBigUint64(out, BigInt(Math.round(performance.now() * 1e6)), true); return 0; },
        fd_close: () => 0, fd_seek: () => 70, fd_fdstat_get: () => 8,
        fd_write: (fd, iovs, count, written) => { // stdout/stderr are routed to the VM trace; other descriptors do not exist
          if (fd !== 1 && fd !== 2) return 8;
          const v = new DataView(lib().memory.buffer), bytes = new Uint8Array(lib().memory.buffer); let total = 0, text = '';
          for (let i = 0; i < count; i++) { const at = v.getUint32(iovs + i * 8, true), len = v.getUint32(iovs + i * 8 + 4, true); text += new TextDecoder().decode(bytes.subarray(at, at + len)); total += len; }
          v.setUint32(written, total, true); r.record(`LOG ${fd === 1 ? 'I' : 'E'} native(${soname}): ${text.trimEnd()}`); return 0;
        },
      };
      if (table[name]) return table[name];
    }
    if (module === 'env') {
      // Emscripten runtime hooks of a STANDALONE_WASM module. There is no stack unwinder in WebAssembly, so _Unwind_Backtrace reports an empty stack.
      if (name === 'emscripten_notify_memory_growth') return () => {};
      if (name === '_Unwind_Backtrace') return () => 5; // _URC_END_OF_STACK: no frames are available
    }
    return () => { throw new APKError(`${soname} called unsupported host import ${module}.${name}`, { kind: 'native-library-import' }); };
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
      const wasmArgs = [binding.lib.envPtr, this.#local(isStatic ? r.classObject(method.owner) : args[0])];
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
  #findField(type, name, signature, isStatic) {
    const r = this.runtime, seen = new Set(), queue = [type];
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
      h[`Get${name}Field`] = (_env, obj, id) => { const f = fieldRef(id), o = r.object(self.#value(obj)), stored = o.fields.get(f.key); return toJNI(code, stored === undefined ? defaultFor(f.type) : stored); };
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
        const name = cString(v.getUint32(methods + i * 12, true)), signature = cString(v.getUint32(methods + i * 12 + 4, true)), index = v.getUint32(methods + i * 12 + 8, true);
        const info = self.#findMethod(type, name, signature), def = r.classes.get(type)?.methods.get(name + signature);
        if (!def || !(def.flags & 0x100)) { self.#throwNew('Ljava/lang/NoSuchMethodError;', name); return JNI_ERR; }
        const fn = lib.table.get(index); if (typeof fn !== 'function') { self.#throwNew('Ljava/lang/NoSuchMethodError;', `${name}: null function pointer`); return JNI_ERR; }
        self.registered.set(`${type}->${name}${signature}`, { lib, fn, symbol: `<RegisterNatives ${name}${signature}>` });
        void info;
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
