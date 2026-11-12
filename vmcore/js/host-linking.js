// What the linker (vmcore/js/linker.js) does differently when a real APKRuntime is the host side of the core (vmcore/js/host-bridge.js; vmcore/host.h). Installed on one Linker
// instance by wrapping four of its methods; linker.js itself is unchanged, and a core without a host attached keeps its behaviour (a host method stops with UNBOUND_NATIVE).
//
//  1. Host classes select nothing themselves. A class without DEX code other than java.lang.Object and java.lang.String (whose records keep their C natives and their bridged
//     virtuals, natives.js HOST_VIRTUALS) gets, in every vtable slot it inherits, a host-dispatch record of its own (host.h): METHOD_UNBOUND with METHOD_HOST_DISPATCH. A call
//     on such a receiver goes through the trampoline to APKRuntime.dispatch, which selects by the receiver's class exactly as the JavaScript VM does -- a bridge of the class, a DEX
//     body of a superclass (java.lang.Number's byteValue), an interface default, NoSuchMethodError. (Inherited C natives would be wrong there: java.lang.Integer.equals is not
//     Object's identity.) The class's itable maps to those records too.
//  2. Calls the class model cannot select. invoke-virtual of a method no vtable slot of the named class holds (StringBuilder.append: host classes have no slots of their own
//     methods) resolves to a host-dispatch record of the named class with no slot (constant b = ~0: interp.c calls the record itself); invoke-interface of a method the
//     interface does not list (a host interface, natives.js HOST_INTERFACE_METHODS lists only Comparable's) resolves to a host-dispatch record of the interface, which
//     invoke-interface calls without an itable lookup. Both reach APKRuntime.dispatch with the call site's reference.
//  3. new-instance of a host class allocates its record (instance size: its superclass chain's fields), as the JavaScript VM's allocate() does; what the host constructor keeps
//     about the object goes to its JavaScript companion (vmcore/js/record-facade.js). Refused, with the JavaScript VM's own check (APKRuntime.allocatable), for what it
//     refuses. (java.lang.String is the linker's own: new-instance makes an empty record and every String constructor is INVOKE_STRING_INIT, classes.h -- a C native, or the
//     host's constructor bridge through the trampoline, host-bridge.js constructString -- which answers the new String.)
//  4. sget of a static that no DEX class declares (a host-modelled static: Boolean.TRUE, Build.VERSION.SDK_INT): the constant gets a slot of its own in metaspace holding
//     APKRuntime.readStatic's value, read when the instruction first runs (a reference slot is a root). An sput to such a static stays unresolved (the JavaScript VM refuses it).
//  6. A static, direct or super call whose class chain the linker walks without finding the method, in a class that is not code of the app or its libraries (the linker answers
//     UNRESOLVED, not a link error): a host-call record of the referenced class (kind METHOD_UNBOUND, no slot), so the trampoline asks APKRuntime.dispatch, which takes the bridge
//     the JavaScript VM takes there (a SHIM bridge of a framework class whose DEX lacks the method: resolveInvoke's deferred bridge), or fails as it fails. Link errors the linker
//     answers (RESOLVE_THROW: NoClassDefFoundError, NoSuchMethodError...) stand: the JavaScript VM throws them at the same instruction.
//  7. The java.lang box classes get a payload (natives.h: the value and a state word; 16 bytes, 24 for Long and Double) and the HostState record (VM.hostState) names their
//     Class records and the boxPrimitive caches, so the box natives (natives.c, bound by vmcore/js/host-bridge.js to the bridges the JavaScript VM selects) and the record
//     facades' `boxed` (host-bridge.js) share one value. AtomicInteger gets the same payload for its `atomicValue` (its get/compareAndSet natives).
//  8. An interface method of the app that only a host superclass implements (linker.buildVtable leaves the abstract interface method in the slot): a host-dispatch record of
//     the nearest host superclass, selected by APKRuntime.dispatch.
//  5. Constructors of Throwable classes without DEX code are host methods like any other (not METHOD_THROWABLE_INIT): the JavaScript VM's constructor bridges keep the message,
//     cause and captured stack on the record, which here is the companion, where Throwable's host methods read them.

import { BOX_CLASSES, ATOMIC_INTEGER } from './natives.js?v=f0166ffeffb5';

const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;';
// natives.h HostState: boxClass[8] then boxCache[8]; the box payload sizes; the kinds with a boxPrimitive cache (B S C I J)
const VM_HOST_STATE = 44, HOST_STATE_BYTES = 72, HOST_STATE_ATOMIC_INTEGER = 64, BOX_CACHE_SLOTS = 256, CACHED_KINDS = [1, 2, 3, 4, 5], CLASS_INSTANCE_SIZE = 4;
const CLASS_VTABLE = 24, CLASS_ITABLE = 32, METHOD_KIND = 12, METHOD_FLAGS = 20, METHOD_VTABLE_INDEX = 24;
const METHOD_UNBOUND = 0x7fff0003, METHOD_THROWABLE_INIT = 0x7fff0004, METHOD_HOST_DISPATCH = 64, M_INTERFACE = 32, M_ABSTRACT = 16, NO_SLOT = 0xffffffff;
const K_NEW = 3, K_IFIELD = 4, K_SFIELD = 5, K_VIRTUAL = 6, K_SUPER = 7, K_DIRECT = 8, K_STATIC = 9, K_INTERFACE = 10, RESOLVE_CODE = 0xffffffff, RESOLVE_WELL_KNOWN = 0xffffff00, UNRESOLVED = 34;
const M_STATIC = 1, M_CONSTRUCTOR = 2;

// Code units of each instruction (DEX formats, as linker.js), and of the payload pseudo-instructions.
const UNITS = new Uint8Array(256).fill(1);
for (const op of [0x02, 0x05, 0x08, 0x13, 0x15, 0x16, 0x19, 0x1a, 0x1c, 0x1f, 0x20, 0x22, 0x23, 0x29, 0xfe, 0xff]) UNITS[op] = 2;
for (const [from, to] of [[0x2d, 0x3d], [0x44, 0x6d], [0x90, 0xaf], [0xd0, 0xe2]]) for (let op = from; op <= to; op++) UNITS[op] = 2;
for (const op of [0x03, 0x06, 0x09, 0x14, 0x17, 0x1b, 0x24, 0x25, 0x26, 0x2a, 0x2b, 0x2c, 0xfc, 0xfd, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x74, 0x75, 0x76, 0x77, 0x78]) UNITS[op] = 3;
UNITS[0xfa] = 4; UNITS[0xfb] = 4; UNITS[0x18] = 5;
function instructionUnits(units, pc) {
  const w = units[pc];
  if (w === 0x0100) return units[pc + 1] * 2 + 4;
  if (w === 0x0200) return units[pc + 1] * 4 + 2;
  if (w === 0x0300) return Math.ceil((units[pc + 1] * (units[pc + 2] | (units[pc + 3] << 16))) / 2) + 4;
  return UNITS[w & 255];
}

/** { name, signature, parameters } of a name and signature ('append(I)Ljava/lang/StringBuilder;'). */
export function methodReference(name, signature) {
  const params = signature.slice(1, signature.indexOf(')')), parameters = [];
  for (let i = 0; i < params.length; i++) { const at = i; while (params[i] === '[') i++; if (params[i] === 'L') i = params.indexOf(';', i); parameters.push(params.slice(at, i + 1)); }
  return { name, signature, parameters };
}

/**
 * Installs the host linking on `linker` for `runtime`. `staticValue(reference, type, slot)` writes the value of a host-modelled static into its metaspace slot (the engine's
 * encoding: a reference becomes a record address). Returns nothing; the linker's records get `hostDispatch` maps of the records made here.
 */
const HOST_FIELD = 0x80000000;
const OBJECT_MONITOR_METHODS = new Set(['notify()V', 'notifyAll()V', 'wait()V', 'wait(J)V', 'wait(JI)V']);

export function installHostLinking(linker, runtime, { staticValue }) {
  const dispatchRecord = (info, name, signature, { slot = NO_SLOT, isInterface = false } = {}) => {
    const nameSig = name + signature, table = info.hostDispatch ??= new Map(), known = table.get(nameSig); if (known) return known;
    const mi = linker.newMethod(info, name, signature, { kind: METHOD_UNBOUND, parameters: methodReference(name, signature).parameters, flags: 8 | METHOD_HOST_DISPATCH | (isInterface ? M_INTERFACE | M_ABSTRACT : 0),
      accessFlags: 0x101, registers: 0, ins: methodReference(name, signature).parameters.reduce((n, t) => n + (t === 'J' || t === 'D' ? 2 : 1), 1), vtableIndex: slot, hostDispatch: true });
    table.set(nameSig, mi); return mi;
  };

  // (5) Throwable constructors without DEX code: host methods
  const hostMethod = linker.hostMethod;
  linker.hostMethod = function (owner, reference, isStatic, referencedKey = null) {
    const mi = hostMethod.call(this, owner, reference, isStatic, referencedKey);
    if (mi.kind === METHOD_THROWABLE_INIT) { mi.kind = METHOD_UNBOUND; this.w32(mi.address + METHOD_KIND, METHOD_UNBOUND); }
    return mi;
  };

  // (7) the host state: box classes and caches
  const hostState = linker.hostState = linker.alloc(HOST_STATE_BYTES); linker.w32(linker.vm + VM_HOST_STATE, hostState);
  for (const kind of CACHED_KINDS) { const cache = linker.alloc(4 * BOX_CACHE_SLOTS); linker.w32(hostState + 32 + 4 * kind, cache); linker.extraRoots.push([cache, BOX_CACHE_SLOTS]); }

  // (1) host classes: every slot a host-dispatch record of the class
  const hostClass = linker.hostClass;
  linker.hostClass = function (type) {
    const info = hostClass.call(this, type), box = BOX_CLASSES.indexOf(type);
    if (box >= 0) {   // (7)
      info.instanceSize = box === 5 || box === 7 ? 24 : 16; this.w32(info.address + CLASS_INSTANCE_SIZE, info.instanceSize);
      this.w32(hostState + 4 * box, info.address); info.boxKind = box;
    } else if (type === ATOMIC_INTEGER) {   // (7): `atomicValue` as an Integer's payload
      info.instanceSize = 16; this.w32(info.address + CLASS_INSTANCE_SIZE, 16); this.w32(hostState + HOST_STATE_ATOMIC_INTEGER, info.address); info.memoryProperty = 'atomicValue';
    }
    if (type === OBJECT || type === STRING || info.isInterface) return info;
    let changed = false;
    info.vtable = info.vtable.map((mi, slot) => {
      if (mi.owner === info && mi.hostDispatch) return mi;
      if (OBJECT_MONITOR_METHODS.has(mi.nameSig) && mi.owner.type === OBJECT) return mi;   // final in java.lang.Object: no class overrides them; the core's monitors serve every receiver (vmcore/threads.c)
      changed = true; return dispatchRecord(info, mi.name, mi.nameSig.slice(mi.name.length), { slot });
    });
    if (changed) {
      this.w32(info.address + CLASS_VTABLE, info.vtable.length ? this.words(info.vtable.map(mi => mi.address)) : 0);
      const itable = info.allInterfaces.map(it => [it, this.words(it.interfaceMethods.map(im => info.vtable[info.vmap.get(im.nameSig)].address))]);
      this.w32(info.address + CLASS_ITABLE, itable.length ? this.words(itable.flatMap(([it, map]) => [it.address, map])) : 0);
    }
    return info;
  };

  // (8) a class with DEX code below a host class (a View subclass, a Service...) that implements an interface of the app whose method only the host superclass provides
  // (`interface HasContext { Context getContext(); }` on a View subclass): the linker's vtable has the abstract interface method in that slot, because host classes have no slots of
  // their own methods. The slot gets a host-dispatch record of the nearest host superclass, so the call reaches APKRuntime.dispatch, which selects by the receiver's class as the
  // JavaScript VM does (the host's method, or AbstractMethodError when the host has none either). Chains whose only host class is java.lang.Object keep the abstract method.
  const buildVtable = linker.buildVtable;
  linker.buildVtable = function (info) {
    buildVtable.call(this, info);
    let host = info.superInfo; while (host && host.cls) host = host.superInfo;
    if (!host || host.type === OBJECT) return;
    info.vtable.forEach((mi, slot) => {
      if (mi.owner.isInterface && !mi.def?.code && !mi.hostDispatch) info.vtable[slot] = dispatchRecord(host, mi.name, mi.nameSig.slice(mi.name.length));
    });
  };

  // (6) a static, direct or super call the class chain does not answer: a host-call record of the referenced class (no slot), served by APKRuntime.dispatch with the site's reference
  const callRecord = (info, reference, isStatic) => {
    const nameSig = reference.name + reference.signature, table = info.hostCalls ??= new Map(), known = table.get(nameSig); if (known) return known;
    const parameters = methodReference(reference.name, reference.signature).parameters;
    const mi = linker.newMethod(info, reference.name, reference.signature, { kind: METHOD_UNBOUND, parameters, flags: (isStatic ? M_STATIC : 0) | (reference.name === '<init>' ? M_CONSTRUCTOR : 0) | 8,
      accessFlags: (isStatic ? 0x8 : 0) | 0x101, registers: 0, ins: parameters.reduce((n, t) => n + (t === 'J' || t === 'D' ? 2 : 1), isStatic ? 0 : 1), hostCall: true });
    table.set(nameSig, mi); return mi;
  };

  // (2), (3), (4), (6): what the linker's own resolution refuses as a gap of the core (UNRESOLVED). A link error the linker answered (RESOLVE_THROW + kind: NoClassDefFoundError,
  // NoSuchMethodError, NoSuchFieldError, IncompatibleClassChangeError for code of the app or its libraries) stands: the JavaScript VM throws the same error at the same instruction.
  const resolve = linker.resolve;
  linker.resolve = function (thread, method, what) {
    const status = resolve.call(this, thread, method, what);
    if (status !== UNRESOLVED || what === RESOLVE_CODE || what >= RESOLVE_WELL_KNOWN) return status;
    const mi = this.methodsAt.get(method), entry = mi?.pool?.[what]; if (!entry || !mi.def) return status;
    const dex = mi.def.method.dex, at = mi.poolAddress + 16 * what, refused = this.error;
    try {
      let a = 0, b = 0;
      switch (entry.kind) {
        case K_VIRTUAL: {
          const reference = dex.method(entry.index), info = this.classOf(reference.owner);
          if (info.vmap.has(reference.name + reference.signature)) return status;
          a = dispatchRecord(info, reference.name, reference.signature).address; b = NO_SLOT; break;
        }
        case K_INTERFACE: {
          const reference = dex.method(entry.index), info = this.classOf(reference.owner);
          a = dispatchRecord(info, reference.name, reference.signature, { isInterface: true }).address; break;
        }
        case K_STATIC: case K_DIRECT: case K_SUPER: {   // (6): e.g. a SHIM bridge of a framework class whose DEX lacks the method (APKRuntime.resolveInvoke's deferred bridge)
          const reference = dex.method(entry.index), info = this.classOf(reference.owner);
          a = callRecord(info, reference, entry.kind === K_STATIC).address; break;
        }
        case K_IFIELD: {   // a field of a class the lab models in JavaScript: the record's `fields` map, as the JavaScript VM keeps it (vmcore/host.h HOST_FIELD)
          const reference = dex.field(entry.index), info = this.classOf(reference.owner);
          if (this.appCode(info)) return status;
          a = HOST_FIELD; break;
        }
        case K_NEW: {
          const type = dex.types[entry.index], info = this.classOf(type);
          if (info.cls || info.isInterface || type[0] === '[') return status;
          if (runtime.allocatable(type) === false) throw new Error(`the JavaScript VM cannot allocate ${type} either (APKRuntime.allocatable)`);
          a = info.address; break;
        }
        case K_SFIELD: {
          const reference = dex.field(entry.index);
          const units = new Uint16Array(this.memory.buffer, this.r32(mi.address), mi.original.length);
          for (let pc = 0; pc < units.length; pc += instructionUnits(units, pc))
            if ((units[pc] & 255) >= 0x67 && (units[pc] & 255) <= 0x6d && units[pc + 1] === what) throw new Error(`sput to ${reference.owner}->${reference.name}, a static no DEX class declares (the JavaScript VM refuses it)`);
          const slot = this.alloc(8);
          staticValue(reference, slot);
          if (reference.type[0] === 'L' || reference.type[0] === '[') this.staticRoots.push(slot);
          a = slot; break;
        }
        default: return status;
      }
      this.w32(at + 4, b); Atomics.store(this.u32, at >>> 2, a); this.error = null;
      return 0;
    } catch (error) {
      this.error = `${refused}; host linking: ${error?.message ?? error}`;
      return status;
    }
  };
}
