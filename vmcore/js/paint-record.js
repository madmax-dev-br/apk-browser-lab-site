// The JavaScript side of android.graphics.Paint's native fields (vmcore/paint.h; docs/SINGLE-HEAP.md, slices 1 and 2). On the core, a Paint record carries its state in its
// payload, where the paint natives read and write it: the payload is the truth. The paint host (src/paint-host.js) keeps a plain JavaScript copy of it on the record's companion
// (`webPaint`), which every host reads through getPaintState:
//   - pull: getPaintState, the only way any host reaches a paint's live state (Skia, text layout, RenderNode, the paint host itself), copies into the state what a native changed
//     since the last pull (the record's dirty word: the scalars, and each reference by itself) and nothing when no native wrote; the paint host pulls again after it ran Java
//     (a CharSequence's getChars) before it reads the state;
//   - push: the paint host writes back what it changed after every method that changes the state (the setters it still serves: the natives' deferred cases and the methods
//     with no native), and a bind writes all of it (the constructors, set, reset). The skia host's setTypeface pushes through the paint host (pushPaintState).
// No other host writes the moved properties. The state stays a plain object with plain data properties: accessors over memory (as commit 03a455619 on `wasm-host` made them) cost
// about 2 us for every spread copy of a state (getSolidPaint makes one per recorded draw) and 1-3 us per bind, measured in Node, which ate the crossings saved.
//
// What stays in JavaScript only: the shadow layer, the font feature and variation settings (JavaScript strings where Java has Strings) and the text locales' language tag
// (computed by Java from the LocaleList). The payload's extras word says when a state has any of the first three (Paint.set's native defers then); the tag follows the locales
// reference: the paint host notes it on the LocaleList's companion when a paint first takes that list (a string, not a reference), and a pull of the locales reads it there.
//
// References: the payload holds the shader, the color filter, the xfermode, the path effect, the mask filter, the typeface and the text locales, in the Class's reference map
// (vmcore/js/host-linking.js), traced by the core's collector. A store from JavaScript is refWord, the store, the record's card (as iput-object marks it) and the space's
// reference-store hook. The state also holds them as plain properties (walked by the collector's companion scan, as before): a reference a native replaced stays reachable from
// the state until that paint's next pull, never less. Optional keys: a state the host never gave a shader, path effect, mask filter or typeface has no such key; the payload's
// present word keeps which keys the state has, so a copy made by the native keeps the keys the host's copy would have (a key a pull removes is set to undefined, not deleted,
// so the state keeps its shape: JSON and `??` read both as absent).
//
// Nothing is added to the state: the record's address comes from its facade (the companion that holds the state), and whether its class has the payload is cached on the
// class's layout. (A symbol-keyed address on the state, tried first, made every spread copy of a state six times slower.)
//
// The views are the RecordSpace's (`space.i32`, `space.f32`, `space.i64`), read at each access: the core's memory is created at its full size and never grown afterwards
// (src/core-memory.js), and whoever would grow it rebinds the space's views; nothing here keeps a view of its own.
//
// Floats: the state keeps a JavaScript number, the payload the IEEE single bits (Float32Array): a value the host made with float(bits) round-trips bit for bit (a NaN keeps its
// payload and sign, quieted, as the host's own float -> double -> float does).
//
// The JavaScript VM has no payload: there the state stays as it was and nothing here runs.

import { APKError } from '../../runtime/apk-error.js?v=bcf03886254c';

/** paint.h: the Paint record's payload. */
export const PAINT_RECORD = Object.freeze({
  state: 8, color: 12, flags: 16, hyphenEdit: 20, colorLongState: 24, colorLong: 32, token: 40,
  strokeWidth: 48, strokeMiter: 52, textSize: 56, textScaleX: 60, textSkewX: 64, letterSpacing: 68, wordSpacing: 72,
  style: 76, strokeCap: 80, strokeJoin: 84, textAlign: 88, hinting: 92, elegant: 96, extras: 100, present: 104, bidiFlags: 108, dirty: 112,
  shader: 116, colorFilter: 120, xfermode: 124, pathEffect: 128, maskFilter: 132, typeface: 136, textLocales: 140, end: 144,
});
/** paint.h CLASS_PAINT_RECORD: the Class flag of the receivers the paint natives answer for. */
export const CLASS_PAINT_RECORD = 1 << 16;
/** The offsets of the payload's references (the Class's reference map), in paint.h's order. */
export const PAINT_REFERENCES = Object.freeze([116, 120, 124, 128, 132, 136, 140]);
/** natives.h HostState.paintEnums (+100): u32[4][3], paint.h PAINT_ENUM_*. */
export const HOST_STATE_PAINT_ENUMS = 100, PAINT_ENUM_SLOTS = 12;
const COLOR_LONG_UNSET = 0, COLOR_LONG_NULL = 1, COLOR_LONG_SET = 2, DIRTY_SCALARS = 1;
// the float and int fields of the state, as [property, offset]
const FLOATS = [['strokeWidth', 48], ['strokeMiter', 52], ['textSize', 56], ['textScaleX', 60], ['textSkewX', 64], ['letterSpacing', 68], ['wordSpacing', 72]];
const INTS = [['style', 76], ['strokeCap', 80], ['strokeJoin', 84], ['textAlign', 88], ['hinting', 92]];
// the references as [property, offset, present bit (0: always a key of the state)]
const REFS = [['shader', 116, 1], ['colorFilter', 120, 0], ['xfermode', 124, 0], ['pathEffect', 128, 8], ['maskFilter', 132, 16], ['typefaceRef', 136, 32], ['textLocalesRef', 140, 0]];
/** The enum classes of the Paint enum natives, in paint.h PAINT_ENUM_* order (the paint host's getters record their constants: noteEnum). */
export const PAINT_ENUMS = Object.freeze(['Landroid/graphics/Paint$Style;', 'Landroid/graphics/Paint$Cap;', 'Landroid/graphics/Paint$Join;', 'Landroid/graphics/Paint$Align;']);

/**
 * The paint natives' side of the core engine (`engine.paints`). src/paint-host.js reaches it as `runtime.wasm?.paints` (absent on the JavaScript VM).
 */
export class PaintRecords {
  constructor(engine) { this.engine = engine; }
  /** The address of Paint record `ref` (Paint or a class below it) when its class has the payload, else 0. */
  address(ref) {
    const engine = this.engine, id = ref?.ref; if (typeof id !== 'number') return 0;
    const address = engine.handles.addressById.get(id); if (address === undefined) return 0;
    return engine.space.layouts.infoAt(engine.r32(address))?.paintRecord ? address : 0;
  }
  /** The payload address of the record whose facade is `facade` (it holds a paint state), or 0 when its class has none. */
  at(facade) {
    const layout = facade.layout; let has = layout.paintPayload;
    if (has === undefined) has = layout.paintPayload = this.engine.space.layouts.infoAt(this.engine.r32(facade.address))?.paintRecord === true;
    return has ? facade.address : 0;
  }
  /**
   * A new state for Paint record `ref` with the values of `source` (a fresh initial state, or the state of the paint copied): a plain copy written whole to the record's payload,
   * which is then bound (the natives answer from it). A record without the payload gets the plain copy only.
   */
  bind(ref, source) {
    const state = { ...source }, at = this.address(ref); if (!at) return state;
    this.write(state, at, true);
    const i32 = this.engine.space.i32; i32[(at + PAINT_RECORD.dirty) >> 2] = 0; i32[(at + PAINT_RECORD.state) >> 2] = 1;
    return state;
  }
  /** Memory -> state of the record of `facade`: what the natives changed since the last pull (nothing when they changed nothing). */
  pull(state, facade) {
    const at = this.at(facade); if (!at) return state;
    const space = this.engine.space, i32 = space.i32, dirty = i32[(at + PAINT_RECORD.dirty) >> 2]; if (dirty === 0) return state;
    i32[(at + PAINT_RECORD.dirty) >> 2] = 0;
    if (dirty & DIRTY_SCALARS) {
      const f32 = space.f32;
      state.color = i32[(at + 12) >> 2]; state.flags = i32[(at + 16) >> 2]; state.hyphenEdit = i32[(at + 20) >> 2];
      const long = i32[(at + 24) >> 2];
      if (long === COLOR_LONG_SET) state.colorLong = space.i64[(at + 32) >> 3]; else if (long === COLOR_LONG_NULL) state.colorLong = null; else if (state.colorLong !== undefined) state.colorLong = undefined;
      for (const [property, offset] of FLOATS) state[property] = f32[(at + offset) >> 2];
      for (const [property, offset] of INTS) state[property] = i32[(at + offset) >> 2];
      state.elegantTextHeight = i32[(at + 96) >> 2] !== 0;
    }
    if (dirty > DIRTY_SCALARS) {
      const present = i32[(at + PAINT_RECORD.present) >> 2];
      for (let i = 0; i < REFS.length; i++) {
        if (!(dirty & (2 << i))) continue;
        const [property, offset, bit] = REFS[i];
        if (bit === 0 || (present & bit)) state[property] = space.refValue(space.u32[(at + offset) >> 2]);
        else if (state[property] !== undefined) state[property] = undefined;
        if (offset === PAINT_RECORD.textLocales) state.textLocaleTag = this.localeTag(state.textLocalesRef);
      }
    }
    return state;
  }
  /** The language tag of LocaleList `ref`, which the paint host noted on its companion when a paint first took it (src/paint-host.js noteLocaleTag). */
  localeTag(ref) {
    const tag = ref ? this.engine.runtime.object(ref).paintLocaleTag : undefined;
    if (typeof tag !== 'string') throw new APKError('vmcore paint: a LocaleList copied by Paint.set has no language tag noted by the paint host', { kind: 'paint-backend-unsupported' });
    return tag;
  }
  /** State -> memory of the record of `facade`, after the paint host changed it: the scalars, and the references too with `references`. */
  push(state, facade, references = false) { const at = this.at(facade); if (at) this.write(state, at, references); }
  write(state, at, references) {
    const space = this.engine.space, i32 = space.i32, f32 = space.f32, long = state.colorLong;
    i32[(at + 12) >> 2] = state.color; i32[(at + 16) >> 2] = state.flags; i32[(at + 20) >> 2] = state.hyphenEdit;
    if (long === undefined) i32[(at + 24) >> 2] = COLOR_LONG_UNSET;
    else if (long === null) i32[(at + 24) >> 2] = COLOR_LONG_NULL;
    else { space.i64[(at + 32) >> 3] = BigInt.asIntN(64, BigInt(long)); i32[(at + 24) >> 2] = COLOR_LONG_SET; }
    for (const [property, offset] of FLOATS) f32[(at + offset) >> 2] = state[property];
    for (const [property, offset] of INTS) i32[(at + offset) >> 2] = state[property];
    i32[(at + 96) >> 2] = state.elegantTextHeight ? 1 : 0;
    i32[(at + PAINT_RECORD.extras) >> 2] = (state.shadowLayer !== undefined ? 1 : 0) | (state.fontFeatureSettings != null ? 2 : 0) | (state.fontVariationSettings != null ? 4 : 0);
    if (!references) return;
    let present = 0, stored = false;
    for (const [property, offset, bit] of REFS) {
      const value = state[property];
      if (bit !== 0 && value !== undefined) present |= bit;
      const target = value === null || value === undefined || value === 0 ? 0 : space.refWord(value);
      space.u32[(at + offset) >> 2] = target;
      if (target !== 0) { stored = true; if (space.onReferenceStore !== null) space.onReferenceStore(at, target); }
    }
    i32[(at + PAINT_RECORD.present) >> 2] = present;
    if (stored) this.markCard(at);   // the record's card, as iput-object marks it (gc.h)
  }
  /** The card of record `at` (gc.h: cards[(record - base) >> 9] = 1 inside the heap's card span), through the space's own byte view (space.markCard makes a view per call). */
  markCard(at) {
    const engine = this.engine, h = engine.h, base = engine.r32(h + 4), off = at - base;
    if (off >= 0 && off < engine.r32(h + 8) - base) this.engine.space.u8[engine.r32(h + 432) + (off >> 9)] = 1; else engine.space.markCard(at);
  }
  /** Getting the native instance made the record's token: the natives answer it from now on. */
  setToken(ref, token) {
    const at = this.address(ref); if (!at) return;
    this.engine.space.i64[(at + PAINT_RECORD.token) >> 3] = BigInt.asIntN(64, BigInt(token));
  }
  /**
   * The paint host's getter of enum `which` (PAINT_ENUMS) read `constant` for nativeInt `k`: the natives answer it from now on (getter) and take it (setter) -- only when the
   * constant's own nativeInt is `k`, so that the setter's mapping constant -> k is the host's.
   */
  noteEnum(which, k, constant) {
    const engine = this.engine, runtime = engine.runtime, type = PAINT_ENUMS[which];
    if (constant === null || typeof constant !== 'object' || runtime.object(constant).fields.get(`${type}->nativeInt:I`) !== k) return;
    const table = engine.r32(engine.linker.hostState + HOST_STATE_PAINT_ENUMS); if (!table || engine.r32(table + 4 * (3 * which + k)) !== 0) return;
    engine.w32(table + 4 * (3 * which + k), engine.refWord(constant));
  }
}
