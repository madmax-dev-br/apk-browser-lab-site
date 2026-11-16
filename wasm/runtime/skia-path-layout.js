// An android.graphics.Path as native code sees it: `Path.mNativePath` points at a SkPath whose first member is the sk_sp<SkPathRef>; androidx graphics-path
// (libandroidx.graphics.path.so) reads the SkPathRef's points, verbs, conic weights and counts straight from memory, with the layout of the Skia the device ships.
// This module writes that structure, for the lab's API level, into the shared wasm32 memory from the lab Path's commands (the verbs/points CanvasKit's Path.toCmds()
// reports: move, line, quad, conic(+weight), cubic, close). Offsets are ILP32 (wasm32 = armeabi-v7a), verified against Skia's headers at the AOSP tags by
// scripts/wasm/androidx/check-skia-layout.mjs (member order of SkPathRef/SkTDArray/SkPath at android-7.0.0_r1 .. android-13.0.0_r1) and against graphics-path's own Path.h
// by static_asserts compiled with the lab toolchain (scripts/wasm/androidx/skia-layout-check.cpp).
//
//   API 24-25  SkPathRef : SkRefCnt (virtual)   vptr@0 refCnt@4 bounds@8 points@24 verbs@28 verbCnt@32 pointCnt@36 freeSpace@40 conic{ptr@44 reserve@48 count@52} genId@56 ; verbs backwards
//   API 26-29  SkPathRef : SkNVRefCnt           refCnt@0 bounds@4 points@20 verbs@24 verbCnt@28 pointCnt@32 freeSpace@36 conic{ptr@40 reserve@44 count@48} genId@52 ; verbs backwards
//   API 30+    SkPathRef : SkNVRefCnt           refCnt@0 bounds@4 points{ptr@20 reserve@24 count@28} verbs{ptr@32 reserve@36 count@40} conic{ptr@44 reserve@48 count@52} genId@56 ; verbs forwards
//   "backwards": fVerbs points just past the allocation and the first verb is fVerbs[-1].

export const SK_PATH_LAYOUTS = {
  api24: { minApi: 24, maxApi: 25, size: 80, backwards: true, refCount: 4, vtable: 0, bounds: 8, points: { ptr: 24 }, verbs: { ptr: 28 }, verbCount: 32, pointCount: 36, freeSpace: 40, conic: { ptr: 44, reserve: 48, count: 52 }, generationId: 56 },
  api26: { minApi: 26, maxApi: 29, size: 80, backwards: true, refCount: 0, bounds: 4, points: { ptr: 20 }, verbs: { ptr: 24 }, verbCount: 28, pointCount: 32, freeSpace: 36, conic: { ptr: 40, reserve: 44, count: 48 }, generationId: 52 },
  api30: { minApi: 30, maxApi: 99, size: 80, backwards: false, refCount: 0, bounds: 4, points: { ptr: 20, reserve: 24, count: 28 }, verbs: { ptr: 32, reserve: 36, count: 40 }, conic: { ptr: 44, reserve: 48, count: 52 }, generationId: 56 },
};
export const SK_PATH_STRUCT = {   // SkPath: sk_sp<SkPathRef> fPathRef @0, int fLastMoveToIndex @4; the fill type byte moved with Android 10
  size: 32, pathRef: 0, lastMoveToIndex: 4, fillTypeByte: apiLevel => (apiLevel >= 29 ? 10 : 8), fillTypeMask: apiLevel => (apiLevel >= 29 ? 3 : 255),
};
export function layoutFor(apiLevel) {
  const layout = Object.values(SK_PATH_LAYOUTS).find(l => apiLevel >= l.minApi && apiLevel <= l.maxApi);
  if (!layout) throw new Error(`No SkPath layout for API level ${apiLevel}: androidx graphics-path supports 21+, the lab models Skia from API 24`);
  return layout;
}

const ARITY = [2, 2, 4, 5, 6, 0];       // coordinates per CanvasKit command verb: move line quad conic(+weight) cubic close
const POINTS = [1, 1, 2, 2, 3, 0];      // SkPoints each verb adds
/** The SkPath arrays for CanvasKit commands: verbs (Skia's SkPath::Verb values equal CanvasKit's), points (x,y pairs), conic weights, and fLastMoveToIndex. */
export function skiaArrays(commands) {
  const verbs = [], points = [], weights = []; let lastMove = ~0;
  for (let at = 0; at < commands.length;) {
    const verb = commands[at++], arity = ARITY[verb];
    if (arity === undefined) throw new Error(`Unknown path verb ${verb}`);
    if (at + arity > commands.length) throw new Error('Truncated path command stream');
    verbs.push(verb);
    if (verb === 0) lastMove = points.length / 2;
    else if (verb === 5 && lastMove >= 0) lastMove = ~lastMove;   // SkPath::close() marks the last move-to as closed
    const coordinates = verb === 3 ? arity - 1 : arity;
    for (let i = 0; i < coordinates; i++) points.push(commands[at + i]);
    if (verb === 3) weights.push(commands[at + arity - 1]);
    at += arity;
    if (POINTS[verb] * 2 !== coordinates) throw new Error('Inconsistent path command arity');
  }
  return { verbs, points, weights, lastMove };
}

/**
 * Writes a SkPath (and its SkPathRef and arrays) into `memory` and returns { address, blocks }. `malloc(size)` allocates in the same memory; `blocks` are the allocations to free.
 * `fillType` is SkPath::FillType (0 winding, 1 even-odd, 2 inverse winding, 3 inverse even-odd).
 */
export function writeSkPath({ memory, malloc }, commands, { apiLevel, fillType = 0 }) {
  const layout = layoutFor(apiLevel), { verbs, points, weights, lastMove } = skiaArrays(commands);
  const alloc = bytes => { const p = malloc(Math.max(16, (bytes + 15) & ~15)); if (!p) throw new Error('native memory exhausted while mirroring a Path'); return p; };
  const pointBlock = alloc(points.length * 4), verbBlock = alloc(verbs.length), weightBlock = alloc(weights.length * 4), ref = alloc(layout.size), skPath = alloc(SK_PATH_STRUCT.size);
  const view = new DataView(memory.buffer), bytes = new Uint8Array(memory.buffer);
  bytes.fill(0, ref, ref + layout.size); bytes.fill(0, skPath, skPath + SK_PATH_STRUCT.size);
  points.forEach((value, i) => view.setFloat32(pointBlock + i * 4, value, true));
  const n = verbs.length;
  verbs.forEach((verb, i) => { bytes[layout.backwards ? verbBlock + n - 1 - i : verbBlock + i] = verb; });
  weights.forEach((value, i) => view.setFloat32(weightBlock + i * 4, value, true));
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;   // SkPathRef::fBounds: the bounds of all points (control points included)
  for (let i = 0; i < points.length; i += 2) { left = Math.min(left, points[i]); right = Math.max(right, points[i]); top = Math.min(top, points[i + 1]); bottom = Math.max(bottom, points[i + 1]); }
  if (!points.length) left = top = right = bottom = 0;
  view.setInt32(ref + layout.refCount, 1, true);
  view.setFloat32(ref + layout.bounds, left, true); view.setFloat32(ref + layout.bounds + 4, top, true); view.setFloat32(ref + layout.bounds + 8, right, true); view.setFloat32(ref + layout.bounds + 12, bottom, true);
  view.setUint32(ref + layout.points.ptr, pointBlock, true);
  view.setUint32(ref + layout.verbs.ptr, layout.backwards ? verbBlock + n : verbBlock, true);
  if (layout.backwards) {
    view.setInt32(ref + layout.verbCount, n, true); view.setInt32(ref + layout.pointCount, points.length / 2, true); view.setUint32(ref + layout.freeSpace, 0, true);
  } else {
    view.setInt32(ref + layout.points.reserve, points.length / 2, true); view.setInt32(ref + layout.points.count, points.length / 2, true);
    view.setInt32(ref + layout.verbs.reserve, n, true); view.setInt32(ref + layout.verbs.count, n, true);
  }
  view.setUint32(ref + layout.conic.ptr, weightBlock, true); view.setInt32(ref + layout.conic.reserve, weights.length, true); view.setInt32(ref + layout.conic.count, weights.length, true);
  view.setUint32(ref + layout.generationId, 1, true);
  if (layout.vtable !== undefined) view.setUint32(ref + layout.vtable, 0, true);
  view.setUint32(skPath + SK_PATH_STRUCT.pathRef, ref, true); view.setInt32(skPath + SK_PATH_STRUCT.lastMoveToIndex, lastMove, true);
  const byte = SK_PATH_STRUCT.fillTypeByte(apiLevel); bytes[skPath + byte] = (bytes[skPath + byte] & ~SK_PATH_STRUCT.fillTypeMask(apiLevel)) | (fillType & SK_PATH_STRUCT.fillTypeMask(apiLevel));
  return { address: skPath, blocks: [pointBlock, verbBlock, weightBlock, ref, skPath] };
}
