// ART's in-memory records of classes' methods and fields as native code reads them (owner decision of 2026-11-21): when native code dereferences a jmethodID, a
// jfieldID or Executable.artMethod, it reads ArtMethod / ArtField structures; the lab lays them out as Android 13's libart does, with values that describe what the
// lab really runs. This module holds the layouts and the rules ART uses to fill them, independent of the native process that holds the memory (src/arm64/art-runtime.js
// writes them into the ARM64 address space). Pinned source: platform/art at android-13.0.0_r1; scripts/art/check-art-layout.mjs re-derives every offset and constant
// below from the headers (art_method.h, art_field.h, length_prefixed_array.h, modifiers.h, standard_dex_file.h, nterp_helpers.cc, imtable-inl.h ...).
//
//   ArtMethod (64-bit, 32 bytes)  declaring_class_ GcRoot<mirror::Class> @0 (u32) | access_flags_ @4 | dex_method_index_ @8 | method_index_ @12 (u16)
//                                 | hotness_count_ / imt_index_ @14 (u16) | ptr_sized_fields_ { data_ @16, entry_point_from_quick_compiled_code_ @24 }
//   ArtMethod (32-bit, 24 bytes)  the same, ptr_sized_fields_ { data_ @16, entry_point @20 }
//   ArtField (16 bytes)           declaring_class_ @0 | access_flags_ @4 | field_dex_idx_ @8 | offset_ @12
//   LengthPrefixedArray<T>        uint32_t size_ @0, then the elements at RoundUp(4, alignof(T)): ArtMethod 8 (64-bit), ArtField 4
//   CodeItem (standard DEX)       registers_size_ u16, ins_size_ u16, outs_size_ u16, tries_size_ u16, debug_info_off_ u32, insns_size_in_code_units_ u32, insns_[]

export const ART_SOURCE = { tag: 'android-13.0.0_r1', repository: 'https://android.googlesource.com/platform/art', commit: 'c944c3d8182b2c2ba4571a1cc1665e1353596439' };

export const ART_METHOD = {
  8: { size: 32, align: 8, declaringClass: 0, accessFlags: 4, dexMethodIndex: 8, methodIndex: 12, hotnessCount: 14, imtIndex: 14, data: 16, entryPoint: 24 },
  4: { size: 24, align: 4, declaringClass: 0, accessFlags: 4, dexMethodIndex: 8, methodIndex: 12, hotnessCount: 14, imtIndex: 14, data: 16, entryPoint: 20 },
};
export const ART_FIELD = { size: 16, align: 4, declaringClass: 0, accessFlags: 4, fieldDexIdx: 8, offset: 12 };
export const LENGTH_PREFIXED_ARRAY = { size: 0, data: 4 };
/** LengthPrefixedArray<T>::OffsetOfElement(index, element_size, alignment). */
export const arrayElementOffset = (index, elementSize, alignment) => roundUp(LENGTH_PREFIXED_ARRAY.data, alignment) + index * elementSize;
export const CODE_ITEM = { registersSize: 0, insSize: 2, outsSize: 4, triesSize: 6, debugInfoOff: 8, insnsSizeInCodeUnits: 12, insns: 16 };

// libdexfile/dex/modifiers.h
export const ACC = {
  PUBLIC: 0x0001, PRIVATE: 0x0002, PROTECTED: 0x0004, STATIC: 0x0008, FINAL: 0x0010, SYNCHRONIZED: 0x0020, BRIDGE: 0x0040, VARARGS: 0x0080, NATIVE: 0x0100,
  INTERFACE: 0x0200, ABSTRACT: 0x0400, STRICT: 0x0800, SYNTHETIC: 0x1000, ANNOTATION: 0x2000, ENUM: 0x4000, JAVA_FLAGS_MASK: 0xffff,
  CONSTRUCTOR: 0x00010000, DECLARED_SYNCHRONIZED: 0x00020000, SKIP_ACCESS_CHECKS: 0x00080000, FAST_NATIVE: 0x00080000, CRITICAL_NATIVE: 0x00100000,
  NTERP_ENTRY_POINT_FAST_PATH: 0x00100000, NTERP_INVOKE_FAST_PATH: 0x00200000, DEFAULT: 0x00400000, PREVIOUSLY_WARM: 0x00800000, COPIED: 0x01000000,
  COMPILE_DONT_BOTHER: 0x02000000, MUST_COUNT_LOCKS: 0x04000000, SINGLE_IMPLEMENTATION: 0x08000000, PUBLIC_API: 0x10000000, CORE_PLATFORM_API: 0x20000000,
  MEMORY_SHARED_METHOD: 0x40000000, INTRINSIC: 0x80000000,
};
ACC.INTRINSIC_BITS = (ACC.PUBLIC_API | ACC.CORE_PLATFORM_API | ACC.SINGLE_IMPLEMENTATION | ACC.MUST_COUNT_LOCKS | ACC.COMPILE_DONT_BOTHER | ACC.COPIED | ACC.PREVIOUSLY_WARM | ACC.MEMORY_SHARED_METHOD) >>> 0;
export const INTRINSIC_SHIFT = 23;   // CTZ(kAccIntrinsicBits)
export const DEX_NO_INDEX = 0xffffffff;   // dex::kDexNoIndex: a runtime method that has no method_id
export const IMT_SIZE = 43;   // ImTable::kSize
export const JIT_WARMUP_THRESHOLD = 0xffff;   // jit.cc kJitDefaultWarmupThreshold (user builds): ResetCounter's value for every non-abstract method
export const NTERP_MAX_FRAME = 3 * 1024;   // interpreter/mterp/nterp.h kNterpMaxFrame
const NTERP_FRAME_ENTRY_SIZE_ARM64 = (12 + 8) * 8;   // kSaveAllCalleeSaves on arm64: x19-x28, x29, x30 and d8-d15, 8 bytes each
const roundUp = (value, alignment) => Math.ceil(value / alignment) * alignment;

/** NterpGetFrameSize (nterp_helpers.cc) for arm64: the frame nterp would build for a method with `registers` dex registers and `outs` out registers. */
export function nterpFrameSize(registers, outs) { return roundUp(NTERP_FRAME_ENTRY_SIZE_ARM64 + registers * 4 * 2 + 8 + 8 + outs * 4 + 8, 16); }

/** ComputeModifiedUtf8Hash (libdexfile/dex/utf.cc) of a string, over its modified UTF-8 bytes: hash = hash * 31 + byte. */
export function modifiedUtf8Hash(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i), bytes = c !== 0 && c < 0x80 ? [c] : c < 0x800 ? [0xc0 | (c >> 6), 0x80 | (c & 63)] : [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
    for (const b of bytes) hash = (Math.imul(hash, 31) + b) >>> 0;
  }
  return hash >>> 0;
}
/** ImTable::GetImtIndex (imtable-inl.h) of an abstract interface method: (427 * class hash + 16 * name hash + 14 * signature hash) % 43, the signature hash mixing the return then each parameter type. */
export function imtIndex(owner, name, parameters, result) {
  let signature = modifiedUtf8Hash(result);
  for (const type of parameters) signature = (Math.imul(signature, 31) + modifiedUtf8Hash(type)) >>> 0;
  const mixed = (Math.imul(427, modifiedUtf8Hash(owner)) + Math.imul(16, modifiedUtf8Hash(name)) + Math.imul(14, signature)) >>> 0;
  return mixed % IMT_SIZE;
}
/** The shorty of a method descriptor's parameters and result (return type first), as dex_file.GetShorty. */
export function shortyOf(parameters, result) { const s = t => (t.startsWith('L') || t.startsWith('[') ? 'L' : t[0]); return s(result) + parameters.map(s).join(''); }

/**
 * ClassLinker::LoadMethod's access_flags_ for a method of the DEX (dex flags | hiddenapi runtime flags | nterp fast paths | @FastNative/@CriticalNative | never-compile),
 * then what linking adds: kAccDefault for a non-abstract interface method (LinkMethods), kAccSkipAccessChecks once the class is verified, kAccSingleImplementation from
 * class hierarchy analysis (cha.cc, applied by the caller), and SetIntrinsic for an intrinsic of the boot class path.
 */
export function loadMethodFlags({ dexFlags, name, parameters, result, hiddenapi = 0, nativeAnnotation = 0, neverCompile = false, interfaceClass = false, verified = true, intrinsic = 0 }) {
  let flags = (dexFlags | hiddenapiRuntimeFlags(hiddenapi)) >>> 0;
  if ((name === '<init>' || name === '<clinit>') && !(flags & ACC.CONSTRUCTOR)) flags |= ACC.CONSTRUCTOR;
  const shorty = shortyOf(parameters, result);
  let allReference = true, referenceOrInt = true;
  for (let i = 1; i < shorty.length; i++) if (shorty[i] !== 'L') { allReference = false; if (shorty[i] === 'F' || shorty[i] === 'D' || shorty[i] === 'J') { referenceOrInt = false; break; } }
  if (referenceOrInt && shorty[0] !== 'F' && shorty[0] !== 'D') flags |= ACC.NTERP_INVOKE_FAST_PATH;
  if (flags & ACC.NATIVE) flags |= nativeAnnotation;
  else if (!(flags & ACC.ABSTRACT)) { if (allReference) flags |= ACC.NTERP_ENTRY_POINT_FAST_PATH; if (neverCompile) flags |= ACC.COMPILE_DONT_BOTHER; }
  if (interfaceClass && !(flags & ACC.ABSTRACT) && !(flags & ACC.STATIC) && name !== '<clinit>') flags |= ACC.DEFAULT;   // a default method (virtual, non-abstract, of an interface)
  if (verified && !(flags & ACC.NATIVE) && !(flags & ACC.ABSTRACT)) flags |= ACC.SKIP_ACCESS_CHECKS;   // mirror::Class::SetSkipAccessChecksFlagOnAllMethods
  if (intrinsic) flags = ((flags & ~ACC.INTRINSIC_BITS) | ACC.INTRINSIC | (intrinsic << INTRINSIC_SHIFT)) >>> 0;
  return flags >>> 0;
}
/** ClassLinker::LoadField: dex flags | hiddenapi runtime flags. */
export function loadFieldFlags({ dexFlags, hiddenapi = 0 }) { return (dexFlags | hiddenapiRuntimeFlags(hiddenapi)) >>> 0; }
/** hiddenapi::CreateRuntimeFlags (hidden_api.h): kAccPublicApi for an SDK member (dex flags 0, which is also what a DEX without hiddenapi data gives), kAccCorePlatformApi for a core-platform one. */
export function hiddenapiRuntimeFlags(dexHiddenapiFlags) {
  const value = dexHiddenapiFlags & 0x7, domain = dexHiddenapiFlags & ~0x7;   // ApiList: the value in the low bits (kSdk = 0), the domain flags above (kCorePlatformApi = 0x8)
  if (value === 0) return ACC.PUBLIC_API;
  return domain & 0x8 ? ACC.CORE_PLATFORM_API : 0;
}
/** CanMethodUseNterp (nterp_helpers.cc) with the method's code item: not native, invokable, no lock counting, not a proxy, and its frame within kNterpMaxFrame. */
export function canUseNterp({ flags, code }) {
  if (flags & (ACC.NATIVE | ACC.ABSTRACT) || !code) return false;
  if ((flags & ACC.MUST_COUNT_LOCKS) && !(flags & ACC.INTRINSIC)) return false;
  return nterpFrameSize(code.registers, code.outs) <= NTERP_MAX_FRAME;
}
/**
 * The quick entry point a device without AOT code for the method installs (Instrumentation::InitializeMethodsCode, ClassLinker::LinkCode, FixupStaticTrampolines):
 * a non-invokable method throws through the interpreter bridge; a static method (not <clinit>) of a class that is not initialized yet goes through the resolution
 * trampoline (when it is native or nterp can run it; else the interpreter bridge); then nterp, the generic JNI trampoline for natives, or the interpreter bridge.
 */
export function quickEntryPoint({ flags, code }, { classInitialized }) {
  if (flags & ACC.ABSTRACT) return 'art_quick_to_interpreter_bridge';   // EnsureThrowsInvocationError (abstract and default-conflict methods)
  const nterp = canUseNterp({ flags, code }), native = !!(flags & ACC.NATIVE);
  if ((flags & ACC.STATIC) && !(flags & ACC.CONSTRUCTOR) && !classInitialized) return native || nterp ? 'art_quick_resolution_trampoline' : 'art_quick_to_interpreter_bridge';
  if (nterp) return 'ExecuteNterpImpl';
  return native ? 'art_quick_generic_jni_trampoline' : 'art_quick_to_interpreter_bridge';
}

// ---- class linking: vtables and copied methods (ClassLinker::LinkMethods), field offsets (LinkFieldsHelper::LinkFields)
const FIELD_ORDER = { J: 1, D: 2, I: 3, F: 4, C: 5, S: 6, Z: 7, B: 8 };   // FieldTypeOrder: kReference 0, kLong, kDouble, kInt, kFloat, kChar, kShort, kBoolean, kByte
const PRIMITIVE_SIZE = { J: 8, D: 8, I: 4, F: 4, C: 2, S: 2, Z: 1, B: 1 };
const PRIMITIVE_TYPE = { Z: 1, B: 2, C: 3, S: 4, I: 5, J: 6, F: 7, D: 8 };   // Primitive::Type (kPrimNot 0, kPrimBoolean 1, ... kPrimDouble 8), the tie-break of sizes
/**
 * Field offsets as LinkFieldsHelper::LinkFields assigns them: references first (by dex field index), then 64-bit, 32-bit, 16-bit and 8-bit primitives (largest first,
 * by Primitive::Type, then dex field index), filling the alignment gaps left behind. `fields` are { index (dex field index), type }; `start` the first free offset
 * (the superclass's object size, or the first static field offset). Returns { offsets: Map(index -> offset), size, references }.
 */
export function linkFieldOffsets(fields, start) {
  const references = fields.filter(f => !FIELD_ORDER[f.type[0]]).sort((a, b) => a.index - b.index);
  const primitives = fields.filter(f => FIELD_ORDER[f.type[0]]).sort((a, b) => { const sa = PRIMITIVE_SIZE[a.type[0]], sb = PRIMITIVE_SIZE[b.type[0]]; if (a.type[0] !== b.type[0]) return sa !== sb ? sb - sa : PRIMITIVE_TYPE[a.type[0]] - PRIMITIVE_TYPE[b.type[0]]; return a.index - b.index; });
  const offsets = new Map(), gaps = { 1: null, 2: null, 4: null };
  // FieldGaps::AddGaps<kGapsToCheck>: the 1-, 2- and 4-byte pieces of [start, end), lowest first (each size has at most one free gap)
  const addGaps = (check, start, end) => {
    if ((check & 1) && (start & 1)) { gaps[1] = start; start += 1; if (check === 1 || start === end) return; }
    if ((check & 2) && (start & 2)) { gaps[2] = start; start += 2; if (check <= 3 || start === end) return; }
    if (check & 4) gaps[4] = start;
  };
  const align = (offset, size) => { if (offset % size) { const next = roundUp(offset, size); addGaps(size - 1, offset, next); return next; } return offset; };
  const hasGap = size => (size === 1 && gaps[1] !== null) || (size <= 2 && gaps[2] !== null) || gaps[4] !== null;
  const releaseGap = size => {
    let result;
    if (size === 1 && gaps[1] !== null) { result = gaps[1]; gaps[1] = null; }
    else if (size <= 2 && gaps[2] !== null) { result = gaps[2]; gaps[2] = null; if (size < 2) addGaps(1, result + size, result + 2); }
    else { result = gaps[4]; gaps[4] = null; if (size < 4) addGaps(3, result + size, result + 4); }
    return result;
  };
  let offset = start, i = 0;
  if (references.length) { offset = align(offset, 4); for (const f of references) { offsets.set(f.index, offset); offset += 4; } }
  const ordered = primitives, take = maxOrder => i < ordered.length && FIELD_ORDER[ordered[i].type[0]] <= maxOrder;
  if (take(2)) { offset = align(offset, 8); while (take(2)) { offsets.set(ordered[i++].index, offset); offset += 8; } }
  if (take(4)) { offset = align(offset, 4); if (hasGap(4)) offsets.set(ordered[i++].index, releaseGap(4)); while (take(4)) { offsets.set(ordered[i++].index, offset); offset += 4; } }
  if (take(6)) { offset = align(offset, 2); while (take(6) && hasGap(2)) offsets.set(ordered[i++].index, releaseGap(2)); while (take(6)) { offsets.set(ordered[i++].index, offset); offset += 2; } }
  for (; i < ordered.length && hasGap(1); i++) offsets.set(ordered[i].index, releaseGap(1));
  for (; i < ordered.length; i++) { offsets.set(ordered[i].index, offset); offset += 1; }
  return { offsets, size: offset, references: references.length };
}
// mirror::Class (class.h): sizeof is 120 on 64-bit (Object's 8 bytes, 8 heap references, 3 uint64, 13 uint32, 2 uint16); an instantiable class embeds its vtable:
// EmbeddedVTableLengthOffset = sizeof(Class), ImtPtrOffset = RoundUp(+4, pointer), EmbeddedVTableOffset = ImtPtrOffset + pointer, then vtable_length pointers.
export const MIRROR_CLASS = { size: 120, objectSize: 8 };
/** mirror::Class::GetFirstReferenceStaticFieldOffsetDuringLinking (64-bit): after the embedded vtable when the class has one, else after the Class fields. */
export function firstStaticFieldOffset({ embeddedVTable, vtableLength }) {
  if (!embeddedVTable) return MIRROR_CLASS.size;
  const imtPtr = roundUp(MIRROR_CLASS.size + 4, 8);
  return imtPtr + 8 + vtableLength * 8;
}
