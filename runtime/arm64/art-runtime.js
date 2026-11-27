// ART's view of the app's classes in the ARM64 native process (owner decision of 2026-11-21, src/art-structures.js): what native code finds when it follows a jmethodID,
// a jfieldID or Executable.artMethod into memory, laid out as Android 13's libart lays it out and filled with what the lab really runs.
//
//   libart.so      an image mapped at process start with ELF header, program headers and a dynamic section (SONAME libart.so, no exported symbols: ART's assembly
//                  entry points are .hidden), listed by dl_iterate_phdr and dladdr as /apex/com.android.art/lib64/libart.so. Its text holds ART's quick entry points
//                  (ExecuteNterpImpl, art_quick_to_interpreter_bridge, art_quick_generic_jni_trampoline, art_quick_resolution_trampoline, art_jni_dlsym_lookup_stub ...),
//                  each preceded by the 0xFF bytes of ART's ENTRY macro. Their code branches to a lab function that stops the run naming the entry point and the
//                  method: they take ART's managed calling convention, and the lab runs Java code in its own interpreter, not through them.
//   DEX files      each DEX a class comes from is mapped whole, read-only by convention, the first time one of its methods needs a CodeItem pointer (as ART mmaps them).
//   ArtMethod      one LengthPrefixedArray<ArtMethod> per class (ClassLinker::LoadClass): direct methods, then virtual ones, then the copied (default / miranda) methods
//                  LinkMethods adds; the class's superclass and interfaces are laid out first (vtable). Values: declaring_class_ = the lab's heap reference of the Class
//                  object (32 bits, as a GcRoot; the lab does not lay out mirror::Class in native memory), access_flags_ as LoadMethod / linking / CHA set them,
//                  dex_method_index_ the method_id in its DEX, method_index_ the vtable (or direct, or interface) index, hotness_count_ the JIT warm-up threshold or
//                  imt_index_ for abstract interface methods, data_ = the registered JNI function (or art_jni_dlsym_lookup_stub before one is bound), the CodeItem in the
//                  mapped DEX, or the single implementation of an abstract method; entry_point_from_quick_compiled_code_ = the trampoline a device without AOT code uses.
//   ArtField       sfields_ and ifields_ arrays per class (LengthPrefixedArray<ArtField>): declaring class, flags, field_dex_idx_, offset_ (LinkFields' layout).
//   jmethodID / jfieldID  the ArtMethod* / ArtField* (JniIdType::kPointer, a non-debuggable app), or ART's opaque odd indices (kIndices) for a debuggable app; Executable.artMethod
//                  is the ArtMethod* either way.
// Members the lab serves from host code (a framework class without a DEX body) get their own ArtMethod / ArtField with dex index kDexNoIndex and no code item.
import { APKError } from '../apk-error.js?v=d20881b83aa7';
import { parseSignature } from '../host-contract.js?v=d20881b83aa7';
import { ART_METHOD, ART_FIELD, arrayElementOffset, ACC, DEX_NO_INDEX, JIT_WARMUP_THRESHOLD, loadMethodFlags, loadFieldFlags, quickEntryPoint, imtIndex, linkFieldOffsets, firstStaticFieldOffset, MIRROR_CLASS } from '../art-structures.js?v=d20881b83aa7';
import { ART_INTRINSICS } from '../art-intrinsics-data.js?v=d20881b83aa7';

export const LIBART_PATH = '/apex/com.android.art/lib64/libart.so';
export const LIBART_ENTRY_POINTS = ['ExecuteNterpImpl', 'art_quick_to_interpreter_bridge', 'art_quick_generic_jni_trampoline', 'art_quick_resolution_trampoline', 'art_jni_dlsym_lookup_stub',
  'art_jni_dlsym_lookup_critical_stub', 'art_quick_imt_conflict_trampoline', 'art_quick_proxy_invoke_handler', 'art_quick_invoke_stub', 'art_quick_invoke_static_stub'];
const M = ART_METHOD[8], F = ART_FIELD, METHOD_ARRAY_DATA = arrayElementOffset(0, M.size, M.align), FIELD_ARRAY_DATA = arrayElementOffset(0, F.size, F.align);
const PT_LOAD = 1, PT_DYNAMIC = 2, PT_GNU_STACK = 0x6474e551, PF_X = 1, PF_W = 2, PF_R = 4;
const INTRINSICS = new Map(ART_INTRINSICS.map(([owner, name, signature, , ordinal]) => [`${owner}->${name}${signature}`, ordinal]));
const NATIVE_ANNOTATIONS = { 'Ldalvik/annotation/optimization/FastNative;': ACC.FAST_NATIVE, 'Ldalvik/annotation/optimization/CriticalNative;': ACC.CRITICAL_NATIVE };
const hex = n => `0x${Number(n).toString(16)}`;
const packageOf = type => type.slice(0, Math.max(1, type.lastIndexOf('/')));

/**
 * Maps the libart.so image into `process` and returns its library record (process.order lists it first, so dl_iterate_phdr and dladdr report it) with `entries`
 * (entry point name -> address). `onCall(name, cpu)` runs when native code branches to an entry point.
 */
export function mapLibart(process, onCall) {
  const mem = process.memory, size = 0x4000, base = process.mapRegion(size, 0x10000, null);
  const TEXT = 0x1000, DATA = 0x2000, SLOT = 32;
  // .text: per entry point 16 bytes of 0xFF (ENTRY's no-method-header marker and its .balign padding), then LDR X16, #8; BR X16; .quad <lab function>
  const entries = new Map();
  LIBART_ENTRY_POINTS.forEach((name, i) => {
    const at = base + TEXT + i * SLOT; mem.fill(at, 0xff, 16);
    const address = at + 16, host = process.hostEntry(`libart:${name}`, (p, cpu) => onCall(name, cpu));
    mem.writeU32(address, 0x58000050); mem.writeU32(address + 4, 0xd61f0200); mem.write64(address + 8, BigInt(host));
    entries.set(name, address);
  });
  const textEnd = TEXT + LIBART_ENTRY_POINTS.length * SLOT;
  // .dynstr / .dynsym (the null symbol only) / .hash in the first page, .dynamic in the data page
  const strtab = 0x200, soname = 1, names = new TextEncoder().encode('\0libart.so\0');
  mem.copyIn(base + strtab, names);
  const symtab = 0x240; mem.fill(base + symtab, 0, 24);
  const hash = 0x260; mem.writeU32(base + hash, 1); mem.writeU32(base + hash + 4, 1); mem.writeU32(base + hash + 8, 0); mem.writeU32(base + hash + 12, 0);
  const dynamic = [[14, soname], [5, strtab], [6, symtab], [10, names.length], [11, 24], [4, hash], [0, 0]];
  dynamic.forEach(([tag, value], i) => { mem.write64(base + DATA + i * 16, BigInt(tag)); mem.write64(base + DATA + i * 16 + 8, BigInt(value)); });
  const segments = [
    { type: PT_LOAD, flags: PF_R, offset: 0, vaddr: 0, filesz: TEXT, memsz: TEXT, align: 0x1000 },
    { type: PT_LOAD, flags: PF_R | PF_X, offset: TEXT, vaddr: TEXT, filesz: textEnd - TEXT, memsz: textEnd - TEXT, align: 0x1000 },
    { type: PT_LOAD, flags: PF_R | PF_W, offset: DATA, vaddr: DATA, filesz: dynamic.length * 16, memsz: dynamic.length * 16, align: 0x1000 },
    { type: PT_DYNAMIC, flags: PF_R | PF_W, offset: DATA, vaddr: DATA, filesz: dynamic.length * 16, memsz: dynamic.length * 16, align: 8 },
    { type: PT_GNU_STACK, flags: PF_R | PF_W, offset: 0, vaddr: 0, filesz: 0, memsz: 0, align: 0 },
  ];
  // ELF64 header (ET_DYN, EM_AARCH64) and the program headers right after it
  const ident = [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]; ident.forEach((b, i) => mem.setByte(base + i, b));
  mem.setUint16(base + 16, 3); mem.setUint16(base + 18, 183); mem.writeU32(base + 20, 1); mem.write64(base + 32, 64n);
  mem.setUint16(base + 52, 64); mem.setUint16(base + 54, 56); mem.setUint16(base + 56, segments.length); mem.setUint16(base + 58, 64);
  segments.forEach((s, i) => { const o = base + 64 + 56 * i; mem.writeU32(o, s.type); mem.writeU32(o + 4, s.flags); mem.write64(o + 8, BigInt(s.offset)); mem.write64(o + 16, BigInt(s.vaddr)); mem.write64(o + 24, BigInt(s.vaddr)); mem.write64(o + 32, BigInt(s.filesz)); mem.write64(o + 40, BigInt(s.memsz)); mem.write64(o + 48, BigInt(s.align)); });
  const lib = { name: 'libart.so', soname: 'libart.so', path: LIBART_PATH, base, end: base + size, exports: new Map(), needed: [], elf: { segments }, phdr: base + 64, art: true, entries, via: 'the runtime (zygote)' };
  process.order.unshift(lib);
  return lib;
}

export class ArtView {
  constructor({ process, runtime, bridge, debuggable = false }) {
    this.process = process; this.runtime = runtime; this.bridge = bridge; this.mem = process.memory;
    this.idType = debuggable ? 'indices' : 'pointer';   // Runtime: a Java-debuggable app gets JniIdType::kIndices, any other kPointer
    this.layouts = new Map(); this.methods = new Map(); this.fields = new Map(); this.byKey = new Map(); this.fieldByKey = new Map(); this.dexMaps = new Map(); this.classRefs = new Map();
    this.arena = { at: 0, end: 0 }; this.approximations = new Set();
    this.libart = mapLibart(process, (name, cpu) => this.#entryCalled(name, cpu));
  }
  entry(name) { return this.libart.entries.get(name); }

  // ---- JNI ids (the bridge's handlers translate through these: src/jni-host.js)
  get jniIds() {
    return this.ids ??= {
      methodHandle: (info, index) => this.idType === 'indices' ? ((index - 1) << 1) + 1 : this.methodAddress(info),
      methodInfo: handle => { if (this.idType === 'indices') return (handle & 1) ? this.bridge.methodIds[((handle - 1) >> 1) + 1] : undefined; return this.methods.get(Number(handle))?.info; },
      fieldHandle: (info, index) => this.idType === 'indices' ? ((index - 1) << 1) + 1 : this.fieldAddress(info),
      fieldInfo: handle => { if (this.idType === 'indices') return (handle & 1) ? this.bridge.fieldIds[((handle - 1) >> 1) + 1] : undefined; return this.fields.get(Number(handle))?.info; },
      nativeBound: (owner, name, signature, address) => this.nativeBound(owner, name, signature, address),
    };
  }

  // ---- memory: ART's LinearAlloc ([anon:linear alloc]) for the arrays, one mapping per DEX file
  #allocate(bytes) {
    bytes = Math.ceil(bytes / 8) * 8;
    if (this.arena.at + bytes > this.arena.end) { const size = Math.max(bytes, 256 * 1024), at = this.process.mapRegion(size, 0x1000, '[anon:dalvik-LinearAlloc]'); this.arena = { at, end: at + size }; (this.arenas ??= []).push({ base: at, end: at + size }); }
    const at = this.arena.at; this.arena.at += bytes; return at;
  }
  /** The address where `dex` is mapped (mapped on first use, the whole file). */
  dexBase(dex) {
    let base = this.dexMaps.get(dex);
    if (base === undefined) { const bytes = dex.reader.bytes; base = this.process.mapRegion(bytes.length, 0x1000, this.#dexMappingName(dex), 'r--p'); this.mem.copyIn(base, bytes); this.dexMaps.set(dex, base); this.runtime.record?.(`ART VIEW mapped ${dex.filename} (${bytes.length} bytes) at ${hex(base)} for the CodeItems of its methods`); }
    return base;
  }
  /** ART's name of an anonymous DEX mapping: the bytes are a copy in memory, as ART holds a DEX it extracted from a compressed APK entry or one handed to it as a buffer. */
  #dexMappingName(dex) {
    const fs = this.runtime.platform?.javaIo?.fs?.(), apk = fs?.codePath ? `${fs.codePath}/base.apk` : 'base.apk';
    return /^classes\d*\.dex$/.test(dex.filename ?? '') ? `[anon:dalvik-${dex.filename} extracted in memory from ${apk}]` : `[anon:dalvik-DEX data]`;
  }
  /** The Class object's heap reference, as a GcRoot<mirror::Class> holds it (32 bits). */
  #classRef(type) { let ref = 0; try { ref = Number(this.runtime.classObject(type)?.ref ?? 0) >>> 0; } catch { ref = 0; } if (ref) this.classRefs.set(ref, type); return ref; }

  // ---- classes
  /** The ArtMethod / ArtField layout of a class the lab has a DEX record for (its superclass and interfaces first); null for a class without one. */
  layout(type) {
    if (this.layouts.has(type)) return this.layouts.get(type);
    const r = this.runtime, cls = r.classes.get(type);
    if (!cls?.dex) { this.layouts.set(type, null); return null; }
    const layout = { type, cls, methods: [], byName: new Map(), vtable: null, iftable: [], interface: !!(cls.flags & ACC.INTERFACE), abstract: !!(cls.flags & ACC.ABSTRACT), final: !!(cls.flags & ACC.FINAL) };
    this.layouts.set(type, layout);   // set first: a cycle (malformed hierarchy) ends here
    const superLayout = cls.superclass ? this.layout(cls.superclass) : null;
    if (cls.superclass && !superLayout && !layout.interface) this.#approximate(type, `its superclass ${cls.superclass} has no DEX body in the lab (host-modelled), so its vtable indices count from the nearest ancestor with one`);   // an interface has no vtable
    const interfaces = cls.interfaces.map(i => this.layout(i)).filter(Boolean);
    layout.instantiable = !layout.interface && !layout.abstract;
    layout.boot = !!r.dex?.bootDexes?.has(cls.dex);
    const hiddenapi = hiddenapiFlags(cls.dex, type);
    let hiddenAt = cls.staticFields.length + cls.fields.length, direct = 0;
    const initialized = r.initialized?.get(type)?.status === 'initialized';
    for (const def of cls.methods.values()) {
      const m = def.method, isDirect = !!(def.flags & (ACC.STATIC | ACC.PRIVATE | ACC.CONSTRUCTOR));
      const nativeAnnotation = def.flags & ACC.NATIVE ? annotationFlags(cls.dex, m, NATIVE_ANNOTATIONS) : 0;
      const neverCompile = !(def.flags & (ACC.NATIVE | ACC.ABSTRACT)) && annotationFlags(cls.dex, m, { 'Ldalvik/annotation/optimization/NeverCompile;': 1 }) !== 0;
      const intrinsic = layout.boot ? INTRINSICS.get(`${type}->${m.name}${m.signature}`) ?? 0 : 0;
      const flags = loadMethodFlags({ dexFlags: def.flags, name: m.name, parameters: m.parameters, result: m.result, hiddenapi: hiddenapi?.[hiddenAt++] ?? 0, nativeAnnotation, neverCompile, interfaceClass: layout.interface, intrinsic });
      const code = def.code ? { registers: def.code.registers, outs: cls.dex.reader.u16(def.code.offset - 16 + 4), offset: def.code.offset - 16 } : null;
      const rec = { layout, type, def, method: m, flags, code, direct: isDirect, methodIndex: isDirect ? direct++ : 0, dexIndex: m.index, info: this.#info(type, m, !!(def.flags & ACC.STATIC)), copied: false, singleImpl: 0 };
      layout.methods.push(rec); layout.byName.set(m.name + m.signature, rec);
    }
    // LinkMethods: interface method indices and IMT indices, or the vtable over the superclass's, then the copied methods for the interfaces' methods
    layout.iftable = [...(superLayout?.iftable ?? [])];
    const addInterface = l => { for (const sub of l.iftable) if (!layout.iftable.includes(sub)) layout.iftable.push(sub); if (!layout.iftable.includes(l)) layout.iftable.push(l); };
    for (const i of interfaces) addInterface(i);
    const virtuals = layout.methods.filter(rec => !rec.direct);
    if (layout.interface) virtuals.forEach((rec, i) => { rec.methodIndex = i; if (rec.flags & ACC.ABSTRACT) rec.imt = imtIndex(type, rec.method.name, rec.method.parameters, rec.method.result); });
    else {
      const vtable = layout.vtable = [...(superLayout?.vtable ?? [])], superLength = vtable.length;
      for (const rec of virtuals) {
        let index = -1;
        for (let j = 0; j < superLength; j++) {
          const entry = vtable[j];
          if (entry.method.name !== rec.method.name || entry.method.signature !== rec.method.signature) continue;
          if (!(entry.flags & (ACC.PUBLIC | ACC.PROTECTED)) && packageOf(entry.type) !== packageOf(type)) continue;   // a package-private method of another package is not overridden
          vtable[j] = rec; if (index < 0) index = j;
        }
        if (index < 0) { index = vtable.length; vtable.push(rec); }
        rec.methodIndex = index; rec.overrides = index < superLength;
      }
      for (const iface of layout.iftable) for (const im of iface.methods) {
        if (im.direct || (im.flags & ACC.STATIC)) continue;
        if (vtable.some(entry => entry.method.name === im.method.name && entry.method.signature === im.method.signature)) continue;
        const candidates = layout.iftable.map(l => l.byName.get(im.method.name + im.method.signature)).filter(c => c && !c.direct && !(c.flags & ACC.ABSTRACT) && !c.copied);
        const specific = candidates.filter(c => !candidates.some(other => other !== c && other.layout.iftable.includes(c.layout)));
        const source = specific.length === 1 ? specific[0] : im;
        let flags = (source.flags | ACC.COPIED) >>> 0;
        if (specific.length > 1) flags = (flags | ACC.ABSTRACT | ACC.DEFAULT) & ~(ACC.SKIP_ACCESS_CHECKS | ACC.SINGLE_IMPLEMENTATION);   // a default conflict
        if (specific.length === 0) flags = (im.flags | ACC.COPIED) >>> 0;   // a miranda: the abstract interface method, copied
        const copy = { ...source, layout, flags, copied: true, conflict: specific.length > 1, methodIndex: vtable.length, singleImpl: 0, imt: source.imt, entryFromCopy: true, direct: false };
        layout.methods.push(copy); vtable.push(copy);
      }
    }
    // the methods_ array
    layout.array = this.#allocate(METHOD_ARRAY_DATA + layout.methods.length * M.size);
    this.mem.writeU32(layout.array, layout.methods.length);
    layout.methods.forEach((rec, i) => { rec.address = layout.array + METHOD_ARRAY_DATA + i * M.size; if (!rec.copied) this.byKey.set(rec.info.key, rec); this.methods.set(rec.address, rec); });
    this.#cha(layout, superLayout);
    for (const rec of layout.methods) this.#writeMethod(rec, initialized);
    this.#layoutFields(layout, superLayout, hiddenapi);
    return layout;
  }
  #approximate(type, why) { if (this.approximations.has(type)) return; this.approximations.add(type); if (this.approximations.size <= 40) this.runtime.record?.(`ART VIEW ${type}: ${why}`); }
  #info(owner, m, isStatic) { return { owner, name: m.name, parameters: m.parameters, result: m.result, signature: m.signature, key: `${owner}->${m.name}${m.signature}`, static: isStatic }; }
  /** Class hierarchy analysis (cha.cc) over the classes laid out so far: InitSingleImplementationFlag for the class's new vtable entries, and the superclass's / interfaces' methods it overrides lose theirs (or record it as their single implementation). */
  #cha(layout, superLayout) {
    const init = rec => {
      if (layout.final || (rec.flags & (ACC.FINAL | ACC.INTRINSIC))) return;
      if (rec.flags & ACC.ABSTRACT && !rec.conflict) { if (layout.instantiable) rec.flags &= ~ACC.SINGLE_IMPLEMENTATION; else rec.flags |= ACC.SINGLE_IMPLEMENTATION; }
      else if (!rec.conflict) rec.flags |= ACC.SINGLE_IMPLEMENTATION;
      rec.flags >>>= 0;
    };
    const invalidate = target => { if (target.flags & ACC.SINGLE_IMPLEMENTATION) { target.flags = (target.flags & ~ACC.SINGLE_IMPLEMENTATION) >>> 0; target.singleImpl = 0; if (target.address) this.#writeMethod(target); } };
    const implementedBy = (target, impl) => {
      if (!(target.flags & ACC.SINGLE_IMPLEMENTATION)) return;
      if (target.flags & ACC.ABSTRACT) { if (impl.flags & ACC.ABSTRACT) { if (layout.instantiable) invalidate(target); return; } if (!target.singleImpl) { target.singleImpl = impl; if (target.address) this.#writeMethod(target); } else if (target.singleImpl !== impl) invalidate(target); }
      else if (impl !== target) invalidate(target);
    };
    if (layout.interface) { for (const rec of layout.methods) if (!rec.direct) init(rec); return; }
    const superVtable = superLayout?.vtable ?? [];
    layout.vtable.forEach((rec, j) => {
      const inSuper = superVtable[j];
      if (inSuper === rec) { if (rec.flags & ACC.ABSTRACT && layout.instantiable) implementedBy(rec, rec); return; }
      init(rec); if (inSuper) implementedBy(inSuper, rec);
    });
    if (layout.instantiable) for (const iface of layout.iftable) for (const im of iface.methods) {
      if (im.direct) continue;
      const impl = layout.vtable.find(entry => entry.method.name === im.method.name && entry.method.signature === im.method.signature);
      if (impl && impl !== im && !(impl.copied && impl.def === im.def)) implementedBy(im, impl);
    }
  }
  #writeMethod(rec, initialized = this.runtime.initialized?.get(rec.type)?.status === 'initialized') {
    const at = rec.address, mem = this.mem, abstract = !!(rec.flags & ACC.ABSTRACT);
    mem.writeU32(at + M.declaringClass, this.#classRef(rec.copied ? rec.def.method.owner : rec.type));
    mem.writeU32(at + M.accessFlags, rec.flags);
    mem.writeU32(at + M.dexMethodIndex, rec.host ? DEX_NO_INDEX : rec.dexIndex);
    mem.setUint16(at + M.methodIndex, rec.methodIndex & 0xffff);
    mem.setUint16(at + M.hotnessCount, abstract ? (rec.imt ?? 0) : JIT_WARMUP_THRESHOLD);
    mem.writePtr(at + M.data, this.#data(rec));
    let entry = rec.host ? 'art_quick_to_interpreter_bridge' : quickEntryPoint(rec, { classInitialized: initialized });
    if (rec.entryFromCopy && entry === 'ExecuteNterpImpl') entry = 'art_quick_to_interpreter_bridge';   // ArtMethod::CopyFrom: a copied nterp method starts on the interpreter bridge
    mem.writePtr(at + M.entryPoint, this.entry(entry));
    rec.entryName = entry;
  }
  #data(rec) {
    if (rec.flags & ACC.NATIVE) {
      const bound = rec.boundAddress ?? this.#boundAddress(rec);
      return bound ?? this.entry(rec.flags & ACC.CRITICAL_NATIVE ? 'art_jni_dlsym_lookup_critical_stub' : 'art_jni_dlsym_lookup_stub');
    }
    if (rec.flags & ACC.ABSTRACT) return rec.singleImpl?.address ?? 0;   // abstract: the single implementation CHA found, else null; default conflict: null
    if (rec.code) return this.dexBase(rec.def.method.dex ?? rec.layout.cls.dex) + rec.code.offset;
    return 0;
  }
  #boundAddress(rec) {
    const binding = this.bridge.registered.get(`${rec.type}->${rec.method.name}${rec.method.signature}`);
    if (!binding) return null;
    if (binding.address !== undefined) return binding.address;
    if (binding.fn?.address !== undefined) return binding.fn.address;
    return this.process.hostEntry(`jni-wasm32:${binding.symbol}`, () => { throw new APKError(`ARM64 native code called the native method ${rec.type}.${rec.method.name} through its ArtMethod data_, but that method is bound to the lab's wasm32 library ${binding.lib?.soname ?? ''} (${binding.symbol}), which runs outside the ARM64 address space`, { kind: 'arm64-unsupported' }); });
  }
  #layoutFields(layout, superLayout, hiddenapi) {
    const cls = layout.cls, dex = cls.dex;
    const toField = (entry, isStatic, i) => { const f = dex.field(entry.index); return { layout, type: layout.type, entry, field: f, static: isStatic, flags: loadFieldFlags({ dexFlags: entry.flags, hiddenapi: hiddenapi?.[i] ?? 0 }), info: { owner: layout.type, name: f.name, type: f.type, key: f.key, static: isStatic } }; };
    const statics = cls.staticFields.map((e, i) => toField(e, true, i)), instance = cls.fields.map((e, i) => toField(e, false, cls.staticFields.length + i));
    const objectStart = superLayout ? superLayout.objectSize : cls.superclass ? MIRROR_CLASS.objectSize : 0;
    if (cls.superclass && !superLayout && !layout.interface && cls.fields.length) this.#approximate(layout.type, `its superclass ${cls.superclass} has no DEX body in the lab, so its instance fields start after java.lang.Object's 8 bytes`);
    const instanceLink = linkFieldOffsets(instance.map(f => ({ index: f.entry.index, type: f.field.type })), objectStart);
    layout.objectSize = instanceLink.size;
    const staticLink = linkFieldOffsets(statics.map(f => ({ index: f.entry.index, type: f.field.type })), firstStaticFieldOffset({ embeddedVTable: layout.instantiable, vtableLength: layout.vtable?.length ?? 0 }));
    for (const [list, link, key] of [[statics, staticLink, 'sfields'], [instance, instanceLink, 'ifields']]) {
      if (!list.length) { layout[key] = 0; continue; }   // ART leaves an empty array null
      const array = layout[key] = this.#allocate(FIELD_ARRAY_DATA + list.length * F.size);
      this.mem.writeU32(array, list.length);
      list.forEach((f, i) => {
        f.address = array + FIELD_ARRAY_DATA + i * F.size; f.offset = link.offsets.get(f.entry.index);
        this.mem.writeU32(f.address + F.declaringClass, this.#classRef(layout.type)); this.mem.writeU32(f.address + F.accessFlags, f.flags);
        this.mem.writeU32(f.address + F.fieldDexIdx, f.entry.index); this.mem.writeU32(f.address + F.offset, f.offset);
        this.fields.set(f.address, f); this.fieldByKey.set(f.info.key + (f.static ? '#s' : ''), f);
      });
    }
  }

  // ---- lookups
  /** The ArtMethod* of a bridge method record ({ owner, name, signature, parameters, result, static, host? }). */
  methodAddress(info) {
    const known = this.byKey.get(info.key); if (known) return known.address;
    const layout = this.layout(info.owner), rec = layout?.byName.get(info.name + info.signature);
    if (rec) return rec.address;
    return this.#hostMethod(info).address;
  }
  /** A method the lab serves without a DEX body (a host-modelled framework class): its own ArtMethod in an array of one, no dex index, no code item. */
  #hostMethod(info) {
    const key = info.key; let rec = this.byKey.get(key); if (rec) return rec;
    const { parameters, result } = info.parameters ? info : parseSignature(info.signature);
    const flags = (ACC.PUBLIC | (info.static ? ACC.STATIC : 0) | (info.name === '<init>' ? ACC.CONSTRUCTOR : 0) | ACC.PUBLIC_API) >>> 0;
    const array = this.#allocate(METHOD_ARRAY_DATA + M.size); this.mem.writeU32(array, 1);
    rec = { type: info.owner, host: true, flags, code: null, methodIndex: 0, method: { name: info.name, signature: info.signature, parameters, result }, info: { ...info, parameters, result }, address: array + METHOD_ARRAY_DATA, singleImpl: 0 };
    this.byKey.set(key, rec); this.methods.set(rec.address, rec); this.#writeMethod(rec);
    if ((this.hostMethods = (this.hostMethods ?? 0) + 1) <= 100) this.runtime.record?.(`ART VIEW ${info.owner}->${info.name}${info.signature}: served by the lab without a DEX body, so its ArtMethod ${hex(rec.address)} has no dex index and no CodeItem (data_ null)`);
    return rec;
  }
  /** The ArtField* of a bridge field record ({ owner, name, type, key, static }). */
  fieldAddress(info) {
    const key = info.key + (info.static ? '#s' : '');
    let f = this.fieldByKey.get(key); if (f) return f.address;
    if (this.layout(info.owner)) { f = this.fieldByKey.get(key); if (f) return f.address; }
    // a field the lab models without a DEX body (a host-modelled class's member, a framework constant, Path.mNativePath): its own ArtField
    const array = this.#allocate(FIELD_ARRAY_DATA + F.size); this.mem.writeU32(array, 1);
    f = { type: info.owner, host: true, static: !!info.static, info, address: array + FIELD_ARRAY_DATA, flags: (ACC.PUBLIC | (info.static ? ACC.STATIC : 0) | ACC.PUBLIC_API) >>> 0, offset: 0 };
    this.mem.writeU32(f.address + F.declaringClass, this.#classRef(info.owner)); this.mem.writeU32(f.address + F.accessFlags, f.flags); this.mem.writeU32(f.address + F.fieldDexIdx, DEX_NO_INDEX); this.mem.writeU32(f.address + F.offset, 0);
    this.fields.set(f.address, f); this.fieldByKey.set(key, f);
    return f.address;
  }
  /** The method record at an ArtMethod address (the start of the structure), or null. */
  methodAt(address) { return this.methods.get(Number(address)) ?? null; }
  fieldAt(address) { return this.fields.get(Number(address)) ?? null; }

  // ---- state changes ART reflects in the structures
  /** RegisterNatives / UnregisterNatives / a Java_ symbol bound on first call: data_ of the native method is the function (or the dlsym lookup stub again). */
  nativeBound(owner, name, signature, address) {
    const rec = this.byKey.get(`${owner}->${name}${signature}`); if (!rec) return;
    rec.boundAddress = address || undefined;
    this.mem.writePtr(rec.address + M.data, address ?? this.entry(rec.flags & ACC.CRITICAL_NATIVE ? 'art_jni_dlsym_lookup_critical_stub' : 'art_jni_dlsym_lookup_stub'));
  }
  /** ClassLinker::FixupStaticTrampolines after a class's initializer ran: its static methods leave the resolution trampoline. */
  classInitialized(type) {
    const layout = this.layouts.get(type); if (!layout) return;
    for (const rec of layout.methods) if (!rec.copied && (rec.flags & ACC.STATIC) && !(rec.flags & ACC.CONSTRUCTOR)) this.#writeMethod(rec, true);
  }

  // ---- calls into libart and explanations
  #entryCalled(name, cpu) {
    const x0 = Number(cpu.x[0]), rec = this.methodAt(x0);
    const target = rec ? `ArtMethod ${hex(x0)} (${rec.type.replace(/^L|;$/g, '').replaceAll('/', '.')}.${rec.method.name}${rec.method.signature})` : `x0 ${hex(x0)}, which is not an ArtMethod the lab laid out`;
    const what = name.startsWith('art_jni_dlsym_lookup') ? 'ART\'s lookup of a native method\'s JNI function, which ART calls from its JNI transition with the method found on the managed stack'
      : name.startsWith('art_quick_invoke') ? 'ART\'s call from native code into managed code (ArtMethod::Invoke)' : 'a quick entry point ART installs in ArtMethods: it takes ART\'s managed calling convention (ArtMethod* in x0, arguments as managed values)';
    throw new APKError(`ARM64 native code called ${name} in libart.so (${what}) for ${target}, called from ${cpu.where(Number(cpu.x[30]))}: the lab runs Java methods in its own interpreter and does not take calls through ART's entry points; call Java through JNI (Call<Type>Method)`, { kind: 'art-entry-point', entryPoint: name, artMethod: x0 });
  }
  /** A fault address near an ART structure or value: which one, for the segmentation fault report. */
  explain(address) {
    for (const [base, rec] of this.methods) if (address >= base && address < base + M.size) return `${hex(address)} is ${address - base} bytes into the ArtMethod of ${rec.type}.${rec.method.name}${rec.method.signature}`;
    for (const [ref, type] of this.classRefs) if (address >= ref && address < ref + 0x200) return `${hex(address)} is ${address - ref} bytes past ${hex(ref)}, the declaring_class_ (GcRoot<mirror::Class>) the lab writes in ArtMethod/ArtField records of ${type}: it is the lab's heap reference of that Class object; the lab does not lay out mirror::Class objects in native memory`;
    return null;
  }
}

/** The hiddenapi flags of a class's members (hiddenapi_class_data, map item 0xF000) in class_data order (static fields, instance fields, direct, virtual methods), or null when the DEX has none. */
function hiddenapiFlags(dex, type) {
  const b = dex.reader, mapOff = b.u32(52), count = b.u32(mapOff);
  let section = 0; for (let i = 0; i < count; i++) if (b.u16(mapOff + 4 + i * 12) === 0xf000) { section = b.u32(mapOff + 4 + i * 12 + 8); break; }
  if (!section) return null;
  const index = dex.classes.names?.get(type); if (index === undefined) return null;
  const offset = b.u32(section + 4 + index * 4); if (!offset) return null;
  const cls = dex.classes.get(type), total = cls.staticFields.length + cls.fields.length + cls.methods.size, out = [], cursor = { p: section + offset };
  for (let i = 0; i < total; i++) out.push(b.uleb(cursor));
  return out;
}
/** Access-flag bits a method's build-visibility annotations select (dex_file_annotations.cc GetNativeMethodAnnotationAccessFlags, MethodIsNeverCompile). */
function annotationFlags(dex, method, table) {
  let flags = 0;
  try { for (const annotation of dex.memberAnnotations({ method }, 0)) flags |= table[annotation.type] ?? 0; } catch { return 0; }
  return flags;
}
