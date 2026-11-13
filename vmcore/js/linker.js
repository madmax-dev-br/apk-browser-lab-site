// vmcore linker: lays out, in the WebAssembly core's linear memory, the classes and methods of the lab's loaded DEX model (an APKRuntime's class table and DexFile objects) as the
// records of vmcore/abi.h, lazily, as the running code reaches them.
//
// Design (abi.h has the record layouts and the meaning of every field):
//  - Metaspace. The linker owns one region of the memory, [metaStart, metaEnd), and bump-allocates every record it writes there: the VM record, the method/class/string tables,
//    Class records with their displays, vtables, itables, reference maps, initialization lists and static storage, Method records, the copied code units and the resolved-constant
//    tables, and the string literals (strings.h StringLiteral: each constant text's units; its String record is a heap record, made by the core). Nothing there is freed or
//    moved, and nothing there is a heap record: the collector (gc.h) never marks or frees it; what metaspace holds that can point into the heap (reference statics, the intern
//    table of String records) is handed to it as root ranges (rootRanges).
//  - Classes are laid out on demand (classOf): when a constant that names them is resolved, or as the superclass, an interface or an array component of a class being laid out.
//    Instance fields: the superclass's layout first, then the class's own fields by decreasing width (8, 4, 2, 1 bytes), each aligned to its width, so every subclass layout is a
//    prefix extension and 8-byte fields are 8-aligned; refMap lists every reference field, inherited ones included. Statics get 4 bytes (8 for long/double, 8-aligned) and the
//    DEX static initial values are written when the class is laid out (the JavaScript VM writes them when initialization starts; no code can read them earlier). Classes with no
//    DEX code (java.lang.Object, other host classes) get a record with no fields and no methods of their own, already initialized; java.lang.Object and java.lang.String get
//    vtable slots for the instance methods the JavaScript VM bridges for them, and String the record shape of strings.h (hostShape).
//  - Methods: every method a DEX class declares gets its record when the class is laid out (vtables need them), with registers and argument words from the code item, but its
//    code is copied and rewritten only when it is first called (kind METHOD_UNLINKED until then: the core calls env.resolve(t, method, RESOLVE_CODE)). Methods of host classes
//    get records when a call resolves to them: a native id from `natives` by method key (vmcore/js/natives.js: the C natives of vmcore/natives.c) or METHOD_UNBOUND.
//  - Code rewriting: every pool operand (string, type, field, method) becomes an index in the method's own resolved-constant table (deduplicated per method), so no operand is
//    limited by a global 16-bit index. An entry starts zeroed; the core asks env.resolve(t, method, index) the first time the instruction runs, and only then is what it names laid
//    out; new-array and filled-new-array name their array class the same way.
//  - Resolution follows the JavaScript VM (src/apk-runtime.js) so both engines run the same methods: fields by name and type in the class, its superinterfaces, then up the
//    superclass chain (resolveField); virtual methods by name and signature on the receiver's class chain, then interface defaults in findInterfaceDefault's order (vtable
//    construction below); static and direct methods up the chain from the referenced class; super calls from the caller's superclass, or in the named interface.
//  - Never runs Java code: class initialization is the core's (abi.h). A failure returns UNRESOLVED to the core and leaves the message in `linker.error`.
//
//  - Exceptions (vmcore/exceptions.h): linkCode copies the method's try/catch table (linkTries), each catch type an ordinary type constant of the method, resolved when a handler
//    is first tested; the classes of the exceptions the core throws are laid out on first use (resolveWellKnown, VM.exceptionClasses); the constructors of Throwable classes
//    without DEX code get kind METHOD_THROWABLE_INIT (the core reports their arguments and stack to vmcore/js/exceptions.js, as the JavaScript VM's host constructors keep them).
//
// Threads (vmcore/threads.h, vmcore/js/threads.js): the linker lives in one thread, its owner; Workers send their env.resolve requests to it through a slot in ThreadsState.
// Whatever a reader tests to see a record as published (a constant's `a`, Method.kind, the class and string counts) is written last, with Atomics.store.

import { CORE_NATIVES, HOST_VIRTUALS, HOST_INTERFACE_METHODS, STRING_CONSTRUCTORS } from './natives.js?v=a742e061d321';
import { CLASS_STRING, STRING_LAYOUT, literalBytes, writeLiteral } from './strings.js?v=a742e061d321';
import { WELL_KNOWN, RESOLVE_WELL_KNOWN } from './exceptions.js?v=a742e061d321';

export const CLASS = { super: 0, instanceSize: 4, refMap: 8, flags: 12, depth: 16, display: 20, vtable: 24, vtableLength: 28, itable: 32, itableLength: 36, statics: 40, staticRefMap: 44,
  initState: 48, initThread: 52, initList: 56, clinit: 60, component: 64, accessFlags: 68, id: 72, SIZE: 76 };
export const METHOD = { code: 0, registers: 4, ins: 8, kind: 12, owner: 16, flags: 20, vtableIndex: 24, pool: 28, id: 32, accessFlags: 36, tries: 40, SIZE: 44 };
export const VM_RECORD = { methods: 0, strings: 4, classes: 8, heapTop: 12, heapEnd: 16, oldBound: 20, gc: 24, exceptionClasses: 28, stringClass: 32, classClass: 36, classObjects: 40, hostState: 44, classCount: 48, stringCount: 52, threads: 56, SIZE: 60 };
export const STATUS = { 0: 'ok', 1: 'instruction budget', 2: 'stack overflow', 3: 'null pointer', 4: 'index out of bounds', 5: 'out of memory', 6: 'unsupported opcode', 7: 'interrupted',
  8: 'negative array size', 9: 'arithmetic', 32: 'class cast', 33: 'abstract method', 34: 'unresolved', 35: 'unbound native', 36: 'incompatible class', 37: 'class initialization blocked', 48: 'uncaught exception', 64: 'host step not supported', 65: 'host failed', 80: 'thread blocked', 81: 'yielded' };
export const NATIVE = { FLOAT_BITS: 1, DOUBLE_BITS: 2, NOTHING: 3 };
/** Every native core.wasm runs in C (vmcore/js/natives.js). */
export const DEFAULT_NATIVES = CORE_NATIVES;
const METHOD_UNLINKED = 0x7fff0001, METHOD_ABSTRACT = 0x7fff0002, METHOD_UNBOUND = 0x7fff0003, METHOD_THROWABLE_INIT = 0x7fff0004;
const M_STATIC = 1, M_CONSTRUCTOR = 2, M_CLINIT = 4, M_NATIVE = 8, M_ABSTRACT = 16, M_INTERFACE = 32;
const CLASS_ARRAY = 1, CLASS_REF_ELEMENTS = 2, CLASS_INTERFACE = 4, CLASS_PRIMITIVE = 8, CLASS_ARRAY_SUPERTYPE = 16, CLASS_MISSING = 64, INITIALIZED = 2;
const CLASS_TYPE = 'Ljava/lang/Class;', CLASS_OBJECT_BYTES = 16;   // classes.h
const STRING = 'Ljava/lang/String;';
const RESOLVE_CODE = 0xffffffff, UNRESOLVED = 34, OBJECT_HEADER = 8, NO_SLOT = 0xffffffff;
// Link errors (exceptions.h): env.resolve returns RESOLVE_THROW + the exception kind, and the message waits here for the thread (the exceptions side asks for it when it builds the object).
const RESOLVE_THROW = 0x7fff0200, KIND_NO_CLASS_DEF = 8, KIND_INCOMPATIBLE_CLASS = 13, KIND_NO_SUCH_FIELD = 14, KIND_NO_SUCH_METHOD = 15;
class LinkError extends Error { constructor(kind, message) { super(message); this.kind = kind; } }
const OBJECT = 'Ljava/lang/Object;', ARRAY_SUPERTYPES = new Set(['Ljava/lang/Cloneable;', 'Ljava/io/Serializable;']);   // JLS 10.8: every array implements these two
const INVOKE_STRING_INIT = 0xf0;   // classes.h: INVOKE_STRING_INIT and, for the range form, +1
const ACC_PRIVATE = 0x2, ACC_STATIC = 0x8, ACC_NATIVE = 0x100, ACC_INTERFACE = 0x200, ACC_ABSTRACT = 0x400;
/** The method reference { name, signature, parameters } of a 'name(params)result' string (host methods named by natives.js lists). */
function hostReference(nameSig) {
  const paren = nameSig.indexOf('('), name = nameSig.slice(0, paren), signature = nameSig.slice(paren), params = signature.slice(1, signature.indexOf(')')), parameters = [];
  for (let i = 0; i < params.length; i++) { const at = i; while (params[i] === '[') i++; if (params[i] === 'L') i = params.indexOf(';', i); parameters.push(params.slice(at, i + 1)); }
  return { name, signature, parameters };
}

// Constant kinds (what a rewritten operand names)
const K_STRING = 1, K_TYPE = 2, K_NEW = 3, K_IFIELD = 4, K_SFIELD = 5, K_VIRTUAL = 6, K_SUPER = 7, K_DIRECT = 8, K_STATIC = 9, K_INTERFACE = 10, K_ARRAY = 11, K_CLASS = 12;
const INVOKE_KIND = { 0x6e: K_VIRTUAL, 0x6f: K_SUPER, 0x70: K_DIRECT, 0x71: K_STATIC, 0x72: K_INTERFACE, 0x74: K_VIRTUAL, 0x75: K_SUPER, 0x76: K_DIRECT, 0x77: K_STATIC, 0x78: K_INTERFACE };

/** Code units of each instruction (DEX formats); payload pseudo-instructions (opcode 0 with an ident) are sized by `payloadUnits`. */
const UNITS = new Uint8Array(256).fill(1);
for (const op of [0x02, 0x05, 0x08, 0x13, 0x15, 0x16, 0x19, 0x1a, 0x1c, 0x1f, 0x20, 0x22, 0x23, 0x29, 0xfe, 0xff]) UNITS[op] = 2;
for (let op = 0x2d; op <= 0x3d; op++) UNITS[op] = 2;
for (let op = 0x44; op <= 0x6d; op++) UNITS[op] = 2;
for (let op = 0x90; op <= 0xaf; op++) UNITS[op] = 2;
for (let op = 0xd0; op <= 0xe2; op++) UNITS[op] = 2;
for (const op of [0x03, 0x06, 0x09, 0x14, 0x17, 0x1b, 0x24, 0x25, 0x26, 0x2a, 0x2b, 0x2c, 0xfc, 0xfd]) UNITS[op] = 3;
for (const op of [0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78, 0xf0, 0xf1]) UNITS[op] = 3;
UNITS[0xfa] = 4; UNITS[0xfb] = 4; UNITS[0x18] = 5;
const payloadUnits = (units, pc) => {
  const ident = units[pc];
  if (ident === 0x0100) return units[pc + 1] * 2 + 4;
  if (ident === 0x0200) return units[pc + 1] * 4 + 2;
  if (ident === 0x0300) { const width = units[pc + 1], size = units[pc + 2] | (units[pc + 3] << 16); return Math.ceil((size * width) / 2) + 4; }
  return 1;
};

const width = type => type === 'J' || type === 'D' ? 8 : type === 'B' || type === 'Z' ? 1 : type === 'S' || type === 'C' ? 2 : 4;
const isReference = type => type[0] === 'L' || type[0] === '[';
const wordCount = parameters => parameters.reduce((n, type) => n + (type === 'J' || type === 'D' ? 2 : 1), 0);
const align = (n, a) => (n + a - 1) & -a;

export class Linker {
  /**
   * `runtime`: the lab's APKRuntime (its `classes` table, `parent`); `memory`: the shared WebAssembly.Memory; [metaStart, metaEnd): the region this linker owns. `natives`: method key
   * -> native id for methods without DEX code (the core's NATIVE_* ids).
   */
  constructor(runtime, { memory, metaStart, metaEnd, natives = DEFAULT_NATIVES, maxMethods = 1 << 16, maxClasses = 1 << 16, maxStrings = 1 << 16 }) {
    this.r = runtime; this.memory = memory; this.top = metaStart; this.end = metaEnd; this.natives = natives;
    this.maxMethods = maxMethods; this.maxClasses = maxClasses; this.maxStrings = maxStrings;
    this.classes = new Map(); this.classList = []; this.methodList = []; this.methodsAt = new Map(); this.strings = new Map(); this.error = null;
    this.core = null; this.thread = 0; this.defaultThread = 0;   // bindCore: the exports that make interned String records for static initial values, and a thread to allocate as
    this.staticRoots = [];   // addresses of every reference static slot laid out so far (collector roots: static storage is metaspace, never heap)
    this.extraRoots = [];    // [address, words] ranges of metaspace that hold heap references for others (the host state's box caches, vmcore/js/host-linking.js)
    this.vm = this.alloc(VM_RECORD.SIZE);
    this.methodTable = this.alloc(4 * maxMethods); this.classTable = this.alloc(4 * maxClasses); this.stringTable = this.alloc(4 * maxStrings);
    this.w32(this.vm + VM_RECORD.methods, this.methodTable); this.w32(this.vm + VM_RECORD.strings, this.stringTable); this.w32(this.vm + VM_RECORD.classes, this.classTable);
    this.exceptionTable = this.alloc(4 * WELL_KNOWN.length); this.w32(this.vm + VM_RECORD.exceptionClasses, this.exceptionTable);
    this.classObjectTable = this.alloc(4 * maxClasses); this.w32(this.vm + VM_RECORD.classObjects, this.classObjectTable);   // classes.h: the Class object of each class by id
    this.linkErrors = new Map();   // thread -> the message of the link error env.resolve just answered (takeLinkError)
    this.imports = { resolve: (t, method, what) => this.resolve(t >>> 0, method >>> 0, what >>> 0) };
  }

  // ---- memory
  get u32() { if (this.view?.buffer.byteLength !== this.memory.buffer.byteLength) this.view = new Uint32Array(this.memory.buffer); return this.view; }
  w32(at, value) { this.u32[at >>> 2] = value >>> 0; }
  r32(at) { return this.u32[at >>> 2]; }
  w64(at, value) { const v = BigInt.asUintN(64, value); this.w32(at, Number(v & 0xffffffffn)); this.w32(at + 4, Number(v >> 32n)); }
  alloc(bytes, alignment = 8) {
    const at = align(this.top, alignment); if (at + bytes > this.end) throw new Error(`vmcore linker: metaspace exhausted (${this.end - at} bytes left, ${bytes} wanted)`);
    this.top = at + bytes; new Uint8Array(this.memory.buffer, at, bytes).fill(0); return at;
  }
  words(values) { const at = this.alloc(4 * Math.max(1, values.length), 4); values.forEach((v, i) => this.w32(at + 4 * i, v)); return at; }
  countedList(values) { return values.length ? this.words([values.length, ...values]) : 0; }
  /** The collector's roots that live in metaspace, as root-buffer entries (gc.h): [address, words] ranges of reference static slots, and the interned string table. */
  rootRanges() {
    return [...this.staticRoots.map(at => [at, 1]), ...(this.strings.size ? [[this.stringTable, this.strings.size]] : []), ...(this.classList.length ? [[this.classObjectTable, this.classList.length]] : []),
      ...this.extraRoots];
  }

  // ---- classes
  /** The laid-out class `type` (a descriptor), laying it out (and its supertypes) on first use. */
  classOf(type) {
    const known = this.classes.get(type); if (known !== undefined) return known;
    if (type[0] === '[') return this.arrayClass(type);
    if (type.length === 1) return this.primitiveClass(type);
    const cls = this.r.classes.get(type), info = cls ? this.dexClass(type, cls) : this.hostClass(type);
    if (type === OBJECT) this.classOf(CLASS_TYPE);   // java.lang.Class exists (VM.classClass) as soon as any class does, so that Object.getClass and const-class have it
    return info;
  }
  /**
   * Would APKRuntime.assertResolvable throw NoClassDefFoundError for `type`: a class the code names that is in no DEX, not a platform namespace and not one the JavaScript VM's hosts
   * provide (arrays by their component). Such a class gets a bare host record marked CLASS_MISSING, and the instructions that need it throw (exceptions.h).
   */
  unresolvable(type) {
    if (typeof type !== 'string' || this.r.classes.has(type)) return false;
    const component = type.replace(/^\[+/, ''); if (component.length === 1 || this.r.classes.has(component)) return false;
    return !(this.r.constructor.isPlatformSpace(component) || this.r.classResolvable(component));
  }
  /** Throws the link error NoClassDefFoundError when `type` is unresolvable (APKRuntime.throwNoClassDef's message). */
  requireClass(type) { if (this.unresolvable(type)) throw new LinkError(KIND_NO_CLASS_DEF, `Failed resolution of: ${type.replace(/^\[+/, '')}`); }
  /** Is every class from `info` up to (not including) java.lang.Object code of the app or its libraries (APKRuntime.resolveInvoke's test before NoSuchMethodError): no platform ancestor. */
  appCode(info) {
    if (this.r.constructor.isPlatformSpace(info.type)) return false;
    const boot = this.r.dex.bootDexes;
    for (let c = info, n = 0; c && c.type !== OBJECT && n < 64; c = c.superInfo, n++) if (!c.cls || boot?.has(c.cls.dex)) return false;
    return true;
  }
  /** Does class or interface `info` implement or extend, at any depth, an interface without DEX code (its methods unknown to the core's tables). */
  hostInterfaceAbove(info) { return this.interfaceSearchOrder(info).some(it => !it.cls); }
  /** The message the linker kept for `thread`'s last link error (consumed). */
  takeLinkError(thread) { const message = this.linkErrors.get(thread >>> 0) ?? null; this.linkErrors.delete(thread >>> 0); return message; }
  newClass(type, fields) {
    if (this.classList.length >= this.maxClasses) throw new Error('vmcore linker: class table full');
    const info = { id: this.classList.length, address: this.alloc(CLASS.SIZE), type, cls: null, superInfo: null, interfaces: [], isInterface: false, instanceSize: OBJECT_HEADER, refs: [],
      fields: new Map(), statics: new Map(), methods: new Map(), interfaceMethods: [], vtable: [], vmap: new Map(), allInterfaces: [], display: [], hasDefaults: false, ...fields };
    this.classList.push(info); this.w32(this.classTable + 4 * info.id, info.address); this.classes.set(type, info);
    Atomics.store(this.u32, (this.vm + VM_RECORD.classCount) >>> 2, this.classList.length);   // a collection run by any thread walks VM.classes (vmcore/threads.h)
    return info;
  }
  primitiveClass(type) {
    const info = this.newClass(type, {}); info.display = [info.address];
    this.writeClass(info, { flags: CLASS_PRIMITIVE, initState: INITIALIZED });
    return info;
  }
  arrayClass(type) {
    const component = this.classOf(type.slice(1)), object = this.classOf(OBJECT), size = width(type[1]);
    const info = this.newClass(type, { superInfo: object, component, instanceSize: 0, vtable: object.vtable, vmap: object.vmap });
    info.display = [object.address, info.address];
    this.writeClass(info, { flags: CLASS_ARRAY | (isReference(type.slice(1)) ? CLASS_REF_ELEMENTS : 0) | (size << 8) | (component.missing ? CLASS_MISSING : 0), initState: INITIALIZED, component: component.address, accessFlags: 0x411 });
    info.missing = component.missing;
    return info;
  }
  /**
   * A class without DEX code (java.lang.Object and the classes the lab's hosts implement): its superclass chain, the interfaces the JavaScript VM gives it (APKRuntime.interfaces,
   * e.g. String's CharSequence, Comparable and Serializable), no fields or methods of its own, initialized. A host type the JavaScript VM takes for an interface
   * (APKRuntime.isInterfaceType) is laid out as one, with the methods natives.js HOST_INTERFACE_METHODS lists as its itable columns. A host class's itable maps each interface
   * method to its vtable: a host virtual (HOST_VIRTUALS, a C native or unbound), else a slot added for the interface's first default method, else an unbound host method.
   */
  hostClass(type) {
    const recordOf = this.interfaceRecords?.get(type);   // interfaceRecordClass below
    const superType = type === OBJECT ? null : recordOf !== undefined ? OBJECT : (this.r.parent?.(type) ?? OBJECT);
    let superInfo = superType && superType !== type ? this.classOf(superType) : null;
    const isInterface = ARRAY_SUPERTYPES.has(type) || !!this.r.isInterfaceType?.(type) || this.hostInterfaceNames().has(type);
    const interfaces = this.interfaceInfos(recordOf !== undefined ? [recordOf] : (this.r.interfaces?.(type) ?? []).filter(it => it !== type)).filter(it => it.isInterface);
    // a host class whose parent the JavaScript VM names is an interface (a lab view object "extends" java.util.Set: APKRuntime.isSubtype walks parent() either way): it implements
    // it, and its superclass is java.lang.Object
    if (superInfo !== null && superInfo.isInterface && !isInterface) { if (!interfaces.includes(superInfo)) interfaces.push(superInfo); superInfo = this.classOf(OBJECT); }
    const info = this.newClass(type, { superInfo, isInterface, interfaces, instanceSize: superInfo && !isInterface ? superInfo.instanceSize : OBJECT_HEADER, refs: superInfo?.refs ?? [],
      vtable: isInterface ? [] : (superInfo?.vtable.slice() ?? []), vmap: new Map(isInterface ? [] : superInfo?.vmap ?? []) });
    info.display = [...(superInfo?.display ?? []), info.address];
    const shape = this.hostShape(info), missing = info.missing = this.unresolvable(type);
    if (type === CLASS_TYPE) info.instanceSize = CLASS_OBJECT_BYTES;   // classes.h: the Class record's address at +8
    if (isInterface) {
      info.interfaceMethods = (HOST_INTERFACE_METHODS.get(type) ?? []).map((nameSig, i) => {
        const mi = this.hostMethod(info, hostReference(nameSig), false); mi.vtableIndex = i; this.w32(mi.address + METHOD.vtableIndex, i);
        this.w32(mi.address + METHOD.flags, mi.flags |= M_INTERFACE | M_ABSTRACT); return mi;
      });
      info.allInterfaces = this.superinterfaces(info);
    } else {
      const order = info.allInterfaces = this.interfaceSearchOrder(info);
      const firstDefault = nameSig => { for (const it of order) { const mi = it.methods.get(nameSig); if (mi && mi.def?.code && !(mi.accessFlags & (ACC_STATIC | ACC_ABSTRACT))) return mi; } return null; };
      for (const it of order) for (const im of it.interfaceMethods) if (!info.vmap.has(im.nameSig)) {
        const slot = info.vtable.length, inherited = firstDefault(im.nameSig), mi = inherited ?? this.hostMethod(info, hostReference(im.nameSig), false);
        info.vmap.set(im.nameSig, slot); info.vtable.push(mi);
        if (!inherited) { mi.vtableIndex = slot; this.w32(mi.address + METHOD.vtableIndex, slot); }
      }
    }
    this.writeClass(info, { flags: (isInterface ? CLASS_INTERFACE | (ARRAY_SUPERTYPES.has(type) ? CLASS_ARRAY_SUPERTYPE : 0) : 0) | shape | (missing ? CLASS_MISSING : 0), initState: INITIALIZED,
      accessFlags: isInterface ? ACC_INTERFACE | ACC_ABSTRACT | 1 : 1,
      itable: isInterface ? info.allInterfaces.map(it => [it, 0]) : info.allInterfaces.map(it => [it, this.words(it.interfaceMethods.map(im => info.vtable[info.vmap.get(im.nameSig)].address))]) });
    if (type === STRING) this.w32(this.vm + VM_RECORD.stringClass, info.address);
    if (type === CLASS_TYPE) this.w32(this.vm + VM_RECORD.classClass, info.address);
    return info;
  }
  /**
   * Host types the platform's host registries use as interfaces (src/host-contract.js): every type named in the interface list of a type a registry declares. The JavaScript VM
   * never needs to know (its subtype test reads the lists); the core lays an interface out differently from a class, whichever of the two the code names first.
   */
  /**
   * The class of a record the JavaScript VM types as an interface (APKRuntime.annotationProxy: makeObject of an annotation type, whose methods its dispatch answers from the
   * record's annotationValues): a host class that implements it, every method a host-dispatch record (vmcore/js/host-linking.js), its facades typed as the interface itself.
   */
  interfaceRecordClass(iface) {
    const name = 'Lapkweb/vmcore/InterfaceRecord_' + iface.slice(1, -1).replaceAll('/', '_') + ';';
    let info = this.classes.get(name);
    if (info === undefined) { (this.interfaceRecords ??= new Map()).set(name, iface); info = this.classOf(name); info.facadeType = iface; }
    return info;
  }
  /** The records of the types a class implements: a host type named there is an interface (the JavaScript VM's subtype test reads the list; the core lays it out as one). */
  interfaceInfos(types) {
    const names = this.hostInterfaceNames();
    for (const t of types) {
      if (this.r.classes?.has?.(t)) continue;
      names.add(t);
      // a host type first met as a plain type (a field's or an array's type, before any class that implements it was laid out) is an interface from here on: the subtype test
      // of the core looks for an interface in the itables (a class laid out earlier does not list it, as it did not before)
      const known = this.classes.get(t);
      if (known !== undefined && !known.isInterface && !known.cls && t !== OBJECT && t[0] !== '[') {
        known.isInterface = true;
        this.w32(known.address + CLASS.flags, this.r32(known.address + CLASS.flags) | CLASS_INTERFACE); this.w32(known.address + CLASS.accessFlags, this.r32(known.address + CLASS.accessFlags) | ACC_INTERFACE | ACC_ABSTRACT);
      }
    }
    return types.map(t => this.classOf(t));
  }
  hostInterfaceNames() {
    if (this.hostInterfaces !== undefined) return this.hostInterfaces;
    const names = new Set();
    for (const host of this.r.platform?.contractHosts ?? []) {
      const declared = host?.parents, listOf = host?.interfacesOf ?? (typeof host?.interfaces === 'function' ? host.interfaces : null);
      if (!(declared instanceof Map) || listOf === null) continue;
      for (const owner of declared.keys()) for (const it of listOf(owner) ?? []) names.add(it);
    }
    for (const name of [...names]) if (this.r.classes?.has?.(name)) names.delete(name);   // DEX types are what their DEX says
    return (this.hostInterfaces = names);
  }
  dexClass(type, cls) {
    const superInfo = cls.superclass ? this.classOf(cls.superclass) : null, interfaces = this.interfaceInfos(cls.interfaces), isInterface = (cls.flags & ACC_INTERFACE) !== 0;
    const info = this.newClass(type, { cls, dex: cls.dex, superInfo, interfaces, isInterface });
    // instance fields: the superclass's layout, then this class's fields by decreasing width, each aligned to its width
    let size = superInfo && !isInterface ? superInfo.instanceSize : OBJECT_HEADER; const refs = [...(superInfo && !isInterface ? superInfo.refs : [])];
    const own = cls.fields.map((entry, order) => ({ field: cls.dex.field(entry.index), order })).sort((x, y) => width(y.field.type) - width(x.field.type) || x.order - y.order);
    for (const { field } of own) {
      const w = width(field.type); size = align(size, w);
      info.fields.set(field.name + ':' + field.type, { owner: info, static: false, offset: size, type: field.type, key: field.key });
      if (isReference(field.type)) refs.push(size);
      size += w;
    }
    info.instanceSize = size; info.refs = refs;
    // statics, with the DEX initial values
    let staticBytes = 0; const staticFields = cls.staticFields.map(entry => cls.dex.field(entry.index)), offsets = [];
    for (const field of staticFields) { const w = width(field.type) === 8 ? 8 : 4; staticBytes = align(staticBytes, w); offsets.push(staticBytes); staticBytes += w; }
    const statics = staticBytes ? this.alloc(staticBytes) : 0, staticRefs = [];
    staticFields.forEach((field, i) => {
      info.statics.set(field.name + ':' + field.type, { owner: info, static: true, address: statics + offsets[i], type: field.type, key: field.key });
      if (isReference(field.type)) { staticRefs.push(offsets[i]); this.staticRoots.push(statics + offsets[i]); }
    });
    if (cls.staticValuesOffset) {
      const cursor = { p: cls.staticValuesOffset }, count = cls.dex.reader.uleb(cursor);
      if (count > staticFields.length) throw new Error(`invalid encoded static values in ${type}`);
      for (let i = 0; i < count; i++) this.writeStaticValue(statics + offsets[i], staticFields[i], cls.dex.encodedValue(cursor));
    }
    // methods (records now; code when first called)
    for (const [nameSig, definition] of cls.methods) info.methods.set(nameSig, this.dexMethod(info, nameSig, definition));
    info.hasDefaults = isInterface && [...cls.methods.values()].some(d => d.method.name !== '<clinit>' && !(d.flags & (ACC_STATIC | ACC_ABSTRACT | ACC_PRIVATE)) && d.code);
    if (isInterface) {
      info.interfaceMethods = [...info.methods.values()].filter(mi => !(mi.accessFlags & (ACC_STATIC | ACC_PRIVATE)) && mi.name !== '<clinit>');
      info.interfaceMethods.forEach((mi, i) => { mi.vtableIndex = i; this.w32(mi.address + METHOD.vtableIndex, i); });
      info.allInterfaces = this.superinterfaces(info);
    } else this.buildVtable(info);
    info.display = [...(superInfo?.display ?? []), info.address];
    const order = this.initOrder(info), clinit = info.methods.get('<clinit>()V');
    this.writeClass(info, { flags: isInterface ? CLASS_INTERFACE : 0, initState: 0, accessFlags: cls.flags, statics, staticRefMap: staticRefs, initList: order.map(c => c.address),
      clinit: clinit?.address ?? 0, itable: isInterface ? info.allInterfaces.map(it => [it, 0]) : info.allInterfaces.map(it => [it, this.words(it.interfaceMethods.map(im => info.vtable[info.vmap.get(im.nameSig)].address))]) });
    return info;
  }
  /**
   * vtable of a class: its superclass's, overridden or extended by its own virtual methods (by name and signature, as the JavaScript VM resolves virtual calls), then a slot for
   * every interface method no class method provides, holding the first default method in findInterfaceDefault's order (or the abstract interface method).
   */
  buildVtable(info) {
    const superInfo = info.superInfo, vtable = info.vtable = superInfo ? superInfo.vtable.slice() : [], vmap = info.vmap = new Map(superInfo?.vmap ?? []);
    for (const mi of info.methods.values()) {
      if (mi.accessFlags & (ACC_STATIC | ACC_PRIVATE) || mi.name === '<init>' || mi.name === '<clinit>') continue;
      let slot = vmap.get(mi.nameSig); if (slot === undefined) { slot = vtable.length; vmap.set(mi.nameSig, slot); vtable.push(mi); } else vtable[slot] = mi;
      mi.vtableIndex = slot; this.w32(mi.address + METHOD.vtableIndex, slot);
    }
    const order = info.allInterfaces = this.interfaceSearchOrder(info);
    const firstDefault = nameSig => { for (const it of order) { const mi = it.methods.get(nameSig); if (mi && mi.def?.code && !(mi.accessFlags & (ACC_STATIC | ACC_ABSTRACT))) return mi; } return null; };
    for (const it of order) for (const im of it.interfaceMethods) {
      const slot = vmap.get(im.nameSig);
      if (slot === undefined) { vmap.set(im.nameSig, vtable.length); vtable.push(firstDefault(im.nameSig) ?? im); }
      else if (vtable[slot].owner.isInterface) vtable[slot] = firstDefault(im.nameSig) ?? vtable[slot];
    }
  }
  /** APKRuntime.findInterfaceDefault's search order: the interfaces of the class and of each superclass, then breadth-first through superinterfaces. */
  interfaceSearchOrder(info) {
    const queue = [], seen = new Set(), out = [];
    for (let c = info; c; c = c.superInfo) queue.push(...c.interfaces);
    while (queue.length) { const it = queue.shift(); if (seen.has(it)) continue; seen.add(it); out.push(it); queue.push(...it.interfaces); }
    return out;
  }
  superinterfaces(info) { const seen = new Set(), queue = [...info.interfaces]; while (queue.length) { const it = queue.shift(); if (!seen.has(it)) { seen.add(it); queue.push(...it.interfaces); } } return [...seen]; }
  /** APKRuntime.initStep's order for `info` with no class initialized yet (the core skips the ones that are): superclasses first, superinterfaces that declare default methods, the class. */
  initOrder(info) {
    const order = [], visiting = new Set();
    const visit = c => {
      if (!c.cls || visiting.has(c)) return; visiting.add(c);
      if (!c.isInterface) {
        if (c.superInfo) visit(c.superInfo);
        const seen = new Set();
        const defaults = it => { if (seen.has(it)) return; seen.add(it); if (!it.cls) return; for (const parent of it.interfaces) defaults(parent); if (it.hasDefaults) visit(it); };
        for (const it of c.interfaces) defaults(it);
      }
      order.push(c);
    };
    visit(info); return order;
  }
  writeClass(info, { flags = 0, initState = 0, accessFlags = 0, statics = 0, staticRefMap = [], initList = [], clinit = 0, component = 0, itable = [] }) {
    const at = info.address, superAddress = info.superInfo?.address ?? 0;
    const refMap = info.refs.length ? (info.superInfo && info.superInfo.refs === info.refs ? this.r32(info.superInfo.address + CLASS.refMap) : this.countedList(info.refs)) : 0;
    this.w32(at + CLASS.super, superAddress); this.w32(at + CLASS.instanceSize, info.instanceSize); this.w32(at + CLASS.refMap, refMap); this.w32(at + CLASS.flags, flags);
    this.w32(at + CLASS.depth, info.display.length - 1); this.w32(at + CLASS.display, this.words(info.display));
    this.w32(at + CLASS.vtable, info.vtable.length ? this.words(info.vtable.map(mi => mi.address)) : 0); this.w32(at + CLASS.vtableLength, info.vtable.length);
    this.w32(at + CLASS.itable, itable.length ? this.words(itable.flatMap(([it, map]) => [it.address, map])) : 0); this.w32(at + CLASS.itableLength, itable.length);
    this.w32(at + CLASS.statics, statics); this.w32(at + CLASS.staticRefMap, this.countedList(staticRefMap));
    this.w32(at + CLASS.initList, this.countedList(initList)); this.w32(at + CLASS.clinit, clinit); this.w32(at + CLASS.component, component);
    this.w32(at + CLASS.accessFlags, accessFlags); this.w32(at + CLASS.id, info.id); this.w32(at + CLASS.initState, initState);
  }
  /**
   * A DEX encoded static value into its slot (the encoded-value rules; APKRuntime.materialize): numbers by the field's type, a string its interned record, a type (a class constant) the
   * Class object of that class, null the default. What needs Java code or a host object -- an enum constant (the enum class would have to initialize), an annotation, an array (not a
   * valid static value), a method, a field, a method handle or type -- is an explicit error, not a guess.
   */
  writeStaticValue(at, field, value) { this.writeValue(at, field.type, value, field.key); }
  writeValue(at, type, value, what) {
    if (value !== null && typeof value === 'object') {
      if (value.encoded === 'class') { this.w32(at, this.classObjectOf(this.classOf(value.value))); return; }
      throw new Error(`static initial value of ${what} (${value.encoded ?? 'object'}) is not supported by the core yet`);
    }
    if (typeof value === 'string') { this.w32(at, this.intern(value)); return; }
    if (value === null) return;
    if (typeof value === 'bigint') { this.w64(at, value); return; }
    this.w32(at, type === 'Z' ? value & 1 : type === 'B' ? (value << 24) >> 24 : type === 'S' ? (value << 16) >> 16 : type === 'C' ? value & 0xffff : value);
  }
  /** The Class object of laid-out class `info` (classes.h), made now on the heap if no const-class did yet. Needs bindCore. */
  classObjectOf(info) {
    const known = this.r32(this.classObjectTable + 4 * info.id); if (known) return known;
    if (!this.core) throw new Error(`vmcore linker: a class constant (${info.type}) needs the core bound (bindCore) to allocate its Class object`);
    const record = this.core.vm_class_object(this.thread || this.defaultThread, info.address) >>> 0;
    if (!record) throw new Error(`vmcore linker: no room on the heap for the Class object of ${info.type}`);
    return record;
  }
  // (no arrays: a DEX static_values holds none -- ART's verifier refuses them -- so an encoded array is an explicit error below)

  // ---- methods
  newMethod(owner, name, signature, fields) {
    if (this.methodList.length >= this.maxMethods) throw new Error('vmcore linker: method table full');
    const mi = { id: this.methodList.length, address: this.alloc(METHOD.SIZE), owner, name, nameSig: name + signature, key: `${owner.type}->${name}${signature}`, def: null, accessFlags: 0, vtableIndex: NO_SLOT, pool: null, poolAddress: 0, ...fields };
    this.methodList.push(mi); this.methodsAt.set(mi.address, mi); this.w32(this.methodTable + 4 * mi.id, mi.address);
    const at = mi.address;
    this.w32(at + METHOD.registers, mi.registers); this.w32(at + METHOD.ins, mi.ins); this.w32(at + METHOD.kind, mi.kind); this.w32(at + METHOD.owner, owner.address);
    this.w32(at + METHOD.flags, mi.flags); this.w32(at + METHOD.vtableIndex, mi.vtableIndex); this.w32(at + METHOD.id, mi.id); this.w32(at + METHOD.accessFlags, mi.accessFlags);
    return mi;
  }
  dexMethod(owner, nameSig, def) {
    const method = def.method, flags = def.flags, isStatic = (flags & ACC_STATIC) !== 0, code = def.code;
    const kind = code ? METHOD_UNLINKED : flags & ACC_NATIVE ? (this.natives.get(method.key) ?? METHOD_UNBOUND) : flags & ACC_ABSTRACT ? METHOD_ABSTRACT : METHOD_UNBOUND;
    const mflags = (isStatic ? M_STATIC : 0) | (method.name === '<init>' ? M_CONSTRUCTOR : 0) | (method.name === '<clinit>' ? M_CLINIT : 0) | (flags & ACC_NATIVE ? M_NATIVE : 0)
      | (flags & ACC_ABSTRACT ? M_ABSTRACT : 0) | (owner.isInterface ? M_INTERFACE : 0);
    return this.newMethod(owner, method.name, method.signature, { def, accessFlags: flags, kind, flags: mflags, registers: code?.registers ?? 0, ins: code?.incoming ?? wordCount(method.parameters) + (isStatic ? 0 : 1) });
  }
  /** A method of a class without DEX code: a native id from `natives`, or METHOD_UNBOUND (calling it stops the run naming it). */
  hostMethod(owner, reference, isStatic, referencedKey = null) {
    const nameSig = reference.name + reference.signature, known = owner.methods.get(nameSig); if (known) return known;
    const key = `${owner.type}->${nameSig}`, kind = this.natives.get(key) ?? (referencedKey && this.natives.get(referencedKey))
      ?? (reference.name === '<init>' && this.isThrowable(owner) ? METHOD_THROWABLE_INIT : METHOD_UNBOUND);
    const mi = this.newMethod(owner, reference.name, reference.signature, { kind, parameters: reference.parameters, flags: (isStatic ? M_STATIC : 0) | (reference.name === '<init>' ? M_CONSTRUCTOR : 0) | M_NATIVE,
      accessFlags: (isStatic ? ACC_STATIC : 0) | ACC_NATIVE | 1, registers: 0, ins: wordCount(reference.parameters) + (isStatic ? 0 : 1) });
    owner.methods.set(nameSig, mi); return mi;
  }
  /**
   * A method of hand-assembled code units (tests: what no Java source makes d8 emit), owned by java.lang.Object, static, already linked: `pool` gives the resolved constants
   * (the `a` word of each entry; a zero entry stops the run with UNRESOLVED, as nothing names what it means). Returns its id.
   */
  rawMethod(units, { registers, ins = 0, pool = [] }) {
    const owner = this.classOf(OBJECT), codeAt = this.alloc(2 * Math.max(1, units.length)), poolAt = this.alloc(16 * Math.max(1, pool.length));
    new Uint16Array(this.memory.buffer, codeAt, units.length).set(units);
    pool.forEach((entry, i) => { const [a, b = 0] = Array.isArray(entry) ? entry : [entry]; this.w32(poolAt + 16 * i + 4, b); this.w32(poolAt + 16 * i, a); });   // an entry: the a word, or [a, b]
    const mi = this.newMethod(owner, `raw${this.methodList.length}`, '()V', { kind: 0, flags: M_STATIC, accessFlags: ACC_STATIC, registers, ins });
    mi.original = Uint16Array.from(units); mi.pool = []; mi.poolAddress = poolAt;
    this.w32(mi.address + METHOD.code, codeAt); this.w32(mi.address + METHOD.pool, poolAt);
    return mi.id;
  }
  /** The method id (run()'s methodIndex) of static method `name` + `signature` of `owner`. */
  methodId(owner, name, signature) {
    const info = this.classOf(owner), mi = info.methods.get(name + signature);
    if (!mi) throw new Error(`vmcore linker: no method ${owner}->${name}${signature}`);
    return mi.id;
  }
  /** Copies the method's code units into metaspace and rewrites every pool operand to an index in its resolved-constant table (`mi.original` keeps the DEX units). */
  linkCode(mi) {
    if (this.r32(mi.address + METHOD.kind) !== METHOD_UNLINKED) return;
    const code = mi.def.code, dex = mi.def.method.dex, bytes = dex.reader.bytes, n = code.units;
    const units = new Uint16Array(n); for (let i = 0; i < n; i++) units[i] = bytes[code.offset + 2 * i] | (bytes[code.offset + 2 * i + 1] << 8);
    mi.original = units.slice(); const pool = [], entries = new Map();
    const constant = (kind, index) => {
      const key = kind * 0x100000000 + index; let at = entries.get(key);
      if (at === undefined) { at = pool.length; if (at > 0xffff) throw new Error(`${mi.key}: more than 65536 constants`); pool.push({ kind, index }); entries.set(key, at); }
      return at;
    };
    for (let pc = 0; pc < n;) {
      const op = units[pc] & 255;
      if (op === 0 && units[pc] !== 0) { pc += payloadUnits(units, pc); continue; }
      if (op === 0x1a) units[pc + 1] = constant(K_STRING, units[pc + 1]);
      else if (op === 0x1b) { units[pc + 1] = constant(K_STRING, units[pc + 1] | (units[pc + 2] << 16)); units[pc + 2] = 0; }
      else if (op === 0x1c) units[pc + 1] = constant(K_CLASS, units[pc + 1]);
      else if (op === 0x1f || op === 0x20) units[pc + 1] = constant(K_TYPE, units[pc + 1]);
      else if (op === 0x22) units[pc + 1] = constant(K_NEW, units[pc + 1]);
      else if (op === 0x23 || op === 0x24 || op === 0x25) units[pc + 1] = constant(K_ARRAY, units[pc + 1]);
      else if (op >= 0x52 && op <= 0x5f) units[pc + 1] = constant(K_IFIELD, units[pc + 1]);
      else if (op >= 0x60 && op <= 0x6d) units[pc + 1] = constant(K_SFIELD, units[pc + 1]);
      else if ((op === 0x70 || op === 0x76) && this.stringConstructor(dex.method(units[pc + 1]))) {   // a String constructor: the core's own opcode (classes.h), a C native or the host's
        units[pc] = (units[pc] & 0xff00) | (INVOKE_STRING_INIT + (op === 0x76 ? 1 : 0)); units[pc + 1] = constant(K_DIRECT, units[pc + 1]);
      }
      else if (INVOKE_KIND[op] !== undefined) units[pc + 1] = constant(INVOKE_KIND[op], units[pc + 1]);
      pc += UNITS[op];
    }
    const tries = this.linkTries(mi, constant);
    const codeAt = this.alloc(2 * n), poolAt = this.alloc(16 * Math.max(1, pool.length));
    new Uint16Array(this.memory.buffer, codeAt, n).set(units);
    mi.pool = pool; mi.poolAddress = poolAt;
    this.w32(mi.address + METHOD.code, codeAt); this.w32(mi.address + METHOD.pool, poolAt); this.w32(mi.address + METHOD.tries, tries);
    Atomics.store(this.u32, (mi.address + METHOD.kind) >>> 2, 0);
  }

  /**
   * Is `reference` a constructor of java.lang.String as the core runs it (classes.h, INVOKE_STRING_INIT): every one when String has no DEX class -- the four of natives.js
   * STRING_CONSTRUCTORS in C, the others through the host trampoline (a host attached) or stopping with UNBOUND_NATIVE (none) -- since a String record is made from its text.
   */
  stringConstructor(reference) { return reference.owner === STRING && reference.name === '<init>' && (STRING_CONSTRUCTORS.has(reference.key) || !this.r.classes.has(STRING)); }

  // ---- exceptions (vmcore/exceptions.h)
  /**
   * The method's try/catch table in metaspace (exceptions.h layout), from the DEX code item's tries and encoded catch handlers (the JavaScript VM's decodeTries); every catch type
   * becomes a type constant of the method (`constant`, linkCode's). Handler lists shared by several ranges are written once. 0 when the method has no try.
   */
  linkTries(mi, constant) {
    const code = mi.def.code; if (!code.tries) return 0;
    const dex = mi.def.method.dex, b = dex.reader, start = code.offset + code.units * 2 + (code.units & 1 ? 2 : 0), handlersAt = start + code.tries * 8;
    b.check(start, code.tries * 8);
    const lists = new Map(), ranges = [];
    for (let i = 0; i < code.tries; i++) {
      const entry = start + 8 * i, from = b.u32(entry), count = b.u16(entry + 4), offset = b.u16(entry + 6);
      let list = lists.get(offset);
      if (list === undefined) {
        const cursor = { p: handlersAt + offset }, size = b.sleb(cursor), words = [size];
        if (Math.abs(size) > 10000) throw new Error(`${mi.key}: exception handler limit exceeded`);
        for (let j = 0; j < Math.abs(size); j++) {
          const type = b.uleb(cursor), address = b.uleb(cursor);
          if (dex.types[type] === undefined || address >= code.units) throw new Error(`${mi.key}: malformed exception handler`);
          words.push(constant(K_TYPE, type), address);
        }
        if (size <= 0) { const address = b.uleb(cursor); if (address >= code.units) throw new Error(`${mi.key}: invalid catch-all address`); words.push(address); }
        list = this.words(words); lists.set(offset, list);
      }
      ranges.push(from, from + count, list);
    }
    return this.words([code.tries, ...ranges]);
  }
  /** Whether class `info` (a laid-out class) is java.lang.Throwable or a subclass. */
  isThrowable(info) { for (let c = info; c; c = c.superInfo) if (c.type === 'Ljava/lang/Throwable;') return true; return false; }
  /** env.resolve(t, 0, RESOLVE_WELL_KNOWN + kind): lays out VM.exceptionClasses[kind]. */
  resolveWellKnown(kind) {
    const type = WELL_KNOWN[kind];
    try {
      if (type === undefined) throw new Error(`no well-known class ${kind}`);
      this.w32(this.exceptionTable + 4 * kind, this.classOf(type).address); return 0;
    } catch (error) { this.error = `vmcore exceptions: ${type ?? kind}: ${error.message}`; return UNRESOLVED; }
  }

  // ---- resolution (the env.resolve import)
  resolve(thread, method, what) {
    this.thread = thread;
    if (what >= RESOLVE_WELL_KNOWN && what !== RESOLVE_CODE) return this.resolveWellKnown(what - RESOLVE_WELL_KNOWN);
    const mi = this.methodsAt.get(method);
    try {
      if (!mi) throw new Error(`no method record at ${method}`);
      if (what === RESOLVE_CODE) { this.linkCode(mi); return 0; }
      const entry = mi.pool?.[what]; if (!entry) throw new Error(`no constant ${what}`);
      const at = mi.poolAddress + 16 * what, dex = mi.def.method.dex;
      let a = 0, b = 0;
      switch (entry.kind) {
        case K_STRING: { const literal = this.literal(dex.string(entry.index)); a = literal.slot; b = literal.address; break; }
        case K_TYPE: a = this.classOf(dex.types[entry.index]).address; break;
        case K_CLASS: { const info = this.classOf(dex.types[entry.index]); a = info.address; b = this.r32(this.vm + VM_RECORD.classClass); break; }   // const-class: the class and java.lang.Class
        case K_ARRAY: { const type = dex.types[entry.index]; if (type[0] !== '[') throw new Error(`new-array of ${type}, not an array type`); a = this.classOf(type).address; break; }
        case K_NEW: {
          this.requireClass(dex.types[entry.index]);
          const info = this.classOf(dex.types[entry.index]);
          if (info.isInterface || info.cls?.flags & ACC_ABSTRACT || info.type[0] === '[' || !info.cls && info.type !== OBJECT && info.type !== STRING) throw new Error(`new-instance of ${info.type} (abstract, an interface, an array or a host class)`);
          a = info.address; break;
        }
        case K_IFIELD: { const field = this.resolveField(dex.field(entry.index), false); if (field.static) throw new LinkError(KIND_INCOMPATIBLE_CLASS, `Expected field ${field.key} to be an instance field`); a = field.offset; break; }
        case K_SFIELD: { const field = this.resolveField(dex.field(entry.index), true); if (!field.static) throw new LinkError(KIND_INCOMPATIBLE_CLASS, `Expected field ${field.key} to be a static field`); a = field.address; b = this.pendingInit(field.owner); break; }
        case K_STATIC: { const target = this.resolveStatic(dex.method(entry.index)); a = target.address; b = this.pendingInit(target.owner); break; }
        case K_DIRECT: a = this.resolveDirect(dex.method(entry.index)).address; break;
        case K_SUPER: a = this.resolveSuper(dex.method(entry.index), mi.owner).address; break;
        case K_VIRTUAL: {
          const reference = dex.method(entry.index); this.requireClass(reference.owner);
          const info = this.classOf(reference.owner), slot = info.vmap.get(reference.name + reference.signature);
          if (slot === undefined) this.noMethod(reference, info, 'virtual', `no virtual method ${reference.key} (receiver class ${info.type}${info.cls ? '' : ', a host class'})`);
          a = info.vtable[slot].address; b = slot; break;
        }
        case K_INTERFACE: a = this.resolveInterfaceMethod(dex.method(entry.index)).address; break;
        default: throw new Error(`constant kind ${entry.kind}`);
      }
      this.w32(at + 4, b); Atomics.store(this.u32, at >>> 2, a);
      return 0;
    } catch (error) {
      if (error instanceof LinkError) { this.linkErrors.set(thread, error.message); return RESOLVE_THROW + error.kind; }
      this.error = `${mi?.key ?? 'vmcore'}${what === RESOLVE_CODE ? ' (code)' : ` constant ${what}`}: ${error.message}`;
      return UNRESOLVED;
    }
  }
  pendingInit(info) { return this.r32(info.address + CLASS.initState) === INITIALIZED ? 0 : info.address; }
  /** APKRuntime.resolveFieldUncached: the class, its superinterfaces, then the superclass chain, by name and type. */
  resolveField(reference, wantStatic = null) {
    this.requireClass(reference.owner);
    const nt = reference.name + ':' + reference.type, declaredIn = c => c.fields.get(nt) ?? c.statics.get(nt);
    const inInterfaces = (c, depth = 0) => { if (depth > 32) return undefined; for (const it of c.interfaces) { const found = declaredIn(it) ?? inInterfaces(it, depth + 1); if (found) return found; } return undefined; };
    for (let c = this.classOf(reference.owner); c; c = c.superInfo) { const found = declaredIn(c) ?? (c.cls ? inInterfaces(c) : undefined); if (found) return found; }
    const owner = this.classOf(reference.owner), text = `no field ${reference.owner}->${reference.name}:${reference.type}`;
    // a field the code of the app or its libraries lacks does not exist (ART: NoSuchFieldError); a platform class's is the host boundary's to say
    if (wantStatic !== null && this.appCode(owner)) throw new LinkError(KIND_NO_SUCH_FIELD, `No ${wantStatic ? 'static' : 'instance'} field ${reference.name} of type ${reference.type} in class ${reference.owner} or its superclasses`);
    throw new Error(text);
  }
  /**
   * A method the reference names is not there. APKRuntime.resolveInvoke: a class that exists nowhere is NoClassDefFoundError; a method missing from a class whose whole chain is the
   * app's or its libraries' code is NoSuchMethodError ("No <mode> method name(sig) in class Owner or its super classes"); a platform class's gap is a stop (the message `text`).
   */
  noMethod(reference, info, mode, text) {
    this.requireClass(reference.owner);
    // A virtual or interface method may also come from an interface without DEX code above the class (a JDK interface such as java.util.concurrent.Executor, whose methods
    // the core does not list: natives.js HOST_INTERFACE_METHODS): the receiver's class implements it, and the JavaScript VM finds it there at run time. Not a link error.
    if (this.appCode(info) && !(mode === 'virtual' && this.hostInterfaceAbove(info))) throw new LinkError(KIND_NO_SUCH_METHOD, `No ${mode} method ${reference.name}${reference.signature} in class ${reference.owner} or its super classes`);
    throw new Error(text);
  }
  /** Static and direct calls: up the class chain from the referenced class (a constructor only in that class); a class without DEX code answers with a host method. */
  resolveStatic(reference) { return this.resolveUp(reference, true); }
  resolveDirect(reference) { return this.resolveUp(reference, false); }
  resolveUp(reference, isStatic) {
    const nameSig = reference.name + reference.signature; this.requireClass(reference.owner);
    const start = this.classOf(reference.owner), mode = isStatic ? 'static' : 'direct';
    for (let c = start; c; c = c.superInfo) {
      if (!c.cls) {
        if (c.type === OBJECT && c !== start && !(HOST_VIRTUALS.get(OBJECT) ?? []).includes(nameSig)) this.noMethod(reference, start, mode, `no ${mode} method ${reference.key}`);   // app code all the way up: Object has no such method
        return this.hostMethod(c, reference, isStatic, reference.key);
      }
      const mi = c.methods.get(nameSig);
      if (mi) { if (!!(mi.accessFlags & ACC_STATIC) !== isStatic) throw new LinkError(KIND_INCOMPATIBLE_CLASS, `The method ${mi.key} was expected to be of type ${mode} but instead was found to be of type ${isStatic ? 'direct' : 'static'}`); return mi; }
      if (reference.name === '<init>') break;
    }
    this.noMethod(reference, start, mode, `no ${mode} method ${reference.key}`);
  }
  /** invoke-super: in the named interface (Interface.super.m()), otherwise from the caller's superclass (its vtable holds what the chain and the interface defaults give). */
  resolveSuper(reference, caller) {
    const nameSig = reference.name + reference.signature; this.requireClass(reference.owner);
    const named = this.classOf(reference.owner);
    if (named.isInterface) {   // Interface.super.method(): the interface's own method, or the default it inherits (the first concrete one in findInterfaceDefault's order, as the JavaScript VM resolves it)
      let mi = named.methods.get(nameSig);
      if (!mi) for (const it of this.interfaceSearchOrder(named)) { const inherited = it.methods.get(nameSig); if (inherited && !(inherited.flags & 16)) { mi = inherited; break; } }
      if (!mi) this.noMethod(reference, named, 'virtual', `no method ${reference.key}`);
      return mi;
    }
    const superInfo = caller.superInfo; if (!superInfo) throw new Error(`invoke-super in ${caller.type}, which has no superclass`);
    const slot = superInfo.vmap.get(nameSig); if (slot !== undefined) return superInfo.vtable[slot];
    for (let c = superInfo; c; c = c.superInfo) if (!c.cls) { if (c.type === OBJECT && c !== superInfo) break; return this.hostMethod(c, reference, false, reference.key); }
    this.noMethod(reference, named, 'virtual', `no super method ${reference.key} above ${caller.type}`);
  }
  /** invoke-interface: the interface method, declared in the named interface or (breadth-first) a superinterface. */
  resolveInterfaceMethod(reference) {
    const nameSig = reference.name + reference.signature; this.requireClass(reference.owner);
    const queue = [this.classOf(reference.owner)], seen = new Set();
    while (queue.length) {
      const it = queue.shift(); if (seen.has(it)) continue; seen.add(it);
      const mi = it.interfaceMethods.find(m => m.nameSig === nameSig); if (mi) return mi;
      queue.push(...it.interfaces);
    }
    this.noMethod(reference, this.classOf(reference.owner), 'virtual', `no interface method ${reference.key}`);
  }

  // ---- strings (vmcore/strings.h)
  /**
   * The literal of `text`: { slot, address } -- its slot in the intern table (VM.strings, a root range: it holds the String record on the heap once one is made, 0 before) and
   * its StringLiteral in metaspace (length, hash, units), what const-string's constant holds (abi.h). One per distinct text.
   */
  literal(text) {
    let literal = this.strings.get(text); if (literal !== undefined) return literal;
    if (this.strings.size >= this.maxStrings) throw new Error('vmcore linker: string table full');
    this.classOf(STRING);   // the String class exists (VM.stringClass) before any String record
    const address = this.alloc(literalBytes(text)); writeLiteral(this.u32, new Uint16Array(this.memory.buffer), address, text);
    literal = { slot: this.stringTable + 4 * this.strings.size, address }; this.strings.set(text, literal);
    Atomics.store(this.u32, (this.vm + VM_RECORD.stringCount) >>> 2, this.strings.size);
    return literal;
  }
  /** The interned String record of `text` (the one const-string of that text gives), made now on the heap if no const-string did yet: static initial values. Needs bindCore. */
  intern(text) {
    const { slot, address } = this.literal(text), known = this.r32(slot); if (known) return known;
    if (!this.core) throw new Error(`vmcore linker: a String initial value (${JSON.stringify(text.slice(0, 40))}) needs the core bound (bindCore) to allocate its record`);
    const record = this.core.vm_string_intern(this.thread || this.defaultThread, slot, address) >>> 0;
    if (!record) throw new Error(`vmcore linker: no room on the heap for the String initial value ${JSON.stringify(text.slice(0, 40))}`);
    return record;
  }
  /** The instance (its exports) that allocates interned records for static initial values, and the thread they are allocated as outside a run. */
  bindCore(exports, defaultThread) { this.core = exports; this.defaultThread = defaultThread; }
  /** The String Class record's address (laid out now if no code reached it yet). */
  get stringClassAddress() { return this.classOf(STRING).address; }
  /**
   * Host classes with a shape of their own: java.lang.Object and java.lang.String get vtable slots for the instance methods the JavaScript VM bridges for them (natives.js
   * HOST_VIRTUALS; each a host method, bound to its C native or unbound), and String's records are CLASS_STRING with 2-byte units (strings.h). Returns extra Class flags.
   */
  hostShape(info) {
    const signatures = HOST_VIRTUALS.get(info.type); if (!signatures) return 0;
    for (const nameSig of signatures) {
      const mi = this.hostMethod(info, hostReference(nameSig), false);
      let slot = info.vmap.get(nameSig); if (slot === undefined) { slot = info.vtable.length; info.vmap.set(nameSig, slot); info.vtable.push(mi); } else info.vtable[slot] = mi;
      mi.vtableIndex = slot; this.w32(mi.address + METHOD.vtableIndex, slot);
    }
    if (info.type !== STRING) return 0;
    info.instanceSize = STRING_LAYOUT.units;
    return CLASS_STRING | (2 << 8);
  }

  /** Diagnostics: a descriptor for a Class address, a key for a Method address. */
  describe(address) { return this.methodsAt.get(address)?.key ?? this.classList.find(c => c.address === address)?.type ?? null; }
}
