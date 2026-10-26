import { APKError } from './apk-error.js?v=5baf5691b052';

// Natives behind the ORIGINAL android.graphics.Region and RegionIterator (android-13.0.0_r1 Java in framework.dex): android_graphics_Region.cpp over SkRegion.
// A region is the integer area covered by a set of rectangles, kept in Skia's canonical banded form: bands of equal top/bottom in y order, each holding sorted,
// non-touching x spans; vertically adjacent bands with identical spans are merged. Boolean operations (difference, intersect, union, xor, reverse difference,
// replace) run per scanline interval of the merged y edges, so results are canonical like SkRegion's.
//   * setPath / getBoundaryPath need path rasterisation / outlining (SkRegion::setPath, SkRegion::getBoundaryPath): not available, they fail explicitly.
//   * Parcel (de)serialisation uses Skia's private binary layout: it fails explicitly rather than inventing a different wire format.
const REGION = 'Landroid/graphics/Region;', ITER = 'Landroid/graphics/RegionIterator;', RECT = 'Landroid/graphics/Rect;', PARCEL = 'Landroid/os/Parcel;', STRING = 'Ljava/lang/String;';
const OP_DIFFERENCE = 0, OP_INTERSECT = 1, OP_UNION = 2, OP_XOR = 3, OP_REVERSE_DIFFERENCE = 4, OP_REPLACE = 5;
const states = new WeakMap();
const registryOf = runtime => states.get(runtime) ?? states.set(runtime, { regions: new Map(), iterators: new Map(), next: 0x6000_0000_0000n }).get(runtime);

/** bands: [{ top, bottom, spans: [l0, r0, l1, r1, ...] }] */
const emptyRegion = () => ({ bands: [] });
const normalize = bands => {
  const out = [];
  for (const band of bands) {
    if (band.bottom <= band.top || band.spans.length === 0) continue;
    const last = out[out.length - 1];
    if (last && last.bottom === band.top && last.spans.length === band.spans.length && last.spans.every((v, i) => v === band.spans[i])) last.bottom = band.bottom;
    else out.push({ top: band.top, bottom: band.bottom, spans: band.spans.slice() });
  }
  return out;
};
const rectRegion = (l, t, r, b) => (l < r && t < b ? { bands: [{ top: t, bottom: b, spans: [l, r] }] } : emptyRegion());
const spansAt = (region, y) => { for (const band of region.bands) if (y >= band.top && y < band.bottom) return band.spans; return []; };
const combineSpans = (a, b, op) => {
  const xs = [...new Set([...a, ...b])].sort((x, y) => x - y), out = [];
  const covered = (spans, x0, x1) => { for (let i = 0; i < spans.length; i += 2) if (spans[i] <= x0 && x1 <= spans[i + 1]) return true; return false; };
  for (let i = 0; i + 1 < xs.length; i++) {
    const inA = covered(a, xs[i], xs[i + 1]), inB = covered(b, xs[i], xs[i + 1]);
    const inside = op === OP_DIFFERENCE ? inA && !inB : op === OP_INTERSECT ? inA && inB : op === OP_UNION ? inA || inB : op === OP_XOR ? inA !== inB : op === OP_REVERSE_DIFFERENCE ? inB && !inA : inB;
    if (!inside) continue;
    if (out.length && out[out.length - 1] === xs[i]) out[out.length - 1] = xs[i + 1]; else out.push(xs[i], xs[i + 1]);
  }
  return out;
};
const operate = (a, b, op) => {
  const ys = [...new Set([...a.bands.flatMap(x => [x.top, x.bottom]), ...b.bands.flatMap(x => [x.top, x.bottom])])].sort((x, y) => x - y), bands = [];
  for (let i = 0; i + 1 < ys.length; i++) bands.push({ top: ys[i], bottom: ys[i + 1], spans: combineSpans(spansAt(a, ys[i]), spansAt(b, ys[i]), op) });
  return { bands: normalize(bands) };
};
const bounds = region => {
  if (!region.bands.length) return null;
  let l = Infinity, r = -Infinity;
  for (const band of region.bands) { l = Math.min(l, band.spans[0]); r = Math.max(r, band.spans[band.spans.length - 1]); }
  return { left: l, top: region.bands[0].top, right: r, bottom: region.bands[region.bands.length - 1].bottom };
};
const rects = region => region.bands.flatMap(band => { const out = []; for (let i = 0; i < band.spans.length; i += 2) out.push({ left: band.spans[i], top: band.top, right: band.spans[i + 1], bottom: band.bottom }); return out; });
const isRect = region => region.bands.length === 1 && region.bands[0].spans.length === 2;

export function createRegionNativeBindings() {
  const bindings = new Map(), add = (owner, signature, callback) => bindings.set(`${owner}->${signature}`, callback);
  const region = (runtime, handle) => { const r = registryOf(runtime).regions.get(BigInt(handle)); if (!r) throw new APKError('Region native handle is not live (use after finalize)', { kind: 'region-dead' }); return r; };
  const self = (runtime, ref) => region(runtime, runtime.object(ref).fields.get(`${REGION}->mNativeRegion:J`) ?? 0n);
  const create = (runtime, value) => { const reg = registryOf(runtime), handle = reg.next++; reg.regions.set(handle, value); return handle; };
  const setRectFields = (runtime, rect, b) => { const fields = runtime.object(rect).fields; for (const k of ['left', 'top', 'right', 'bottom']) runtime.storeField(fields, `${RECT}->${k}:I`, b[k]); };
  const rectOf = (runtime, rect) => { const f = runtime.object(rect).fields, g = k => f.get(`${RECT}->${k}:I`) ?? 0; return { l: g('left'), t: g('top'), r: g('right'), b: g('bottom') }; };
  const store = (runtime, handle, value) => { registryOf(runtime).regions.set(BigInt(handle), value); };
  const unsupported = (runtime, what) => runtime.throwJava('Ljava/lang/UnsupportedOperationException;', `${what} is not available in this VM`);

  add(REGION, 'nativeConstructor()J', runtime => create(runtime, emptyRegion()));
  add(REGION, 'nativeDestructor(J)V', (runtime, [handle]) => { registryOf(runtime).regions.delete(BigInt(handle)); });
  add(REGION, 'nativeSetRegion(JJ)V', (runtime, [dst, src]) => { region(runtime, dst); store(runtime, dst, structuredClone(region(runtime, src))); });
  add(REGION, 'nativeSetRect(JIIII)Z', (runtime, [dst, l, t, r, b]) => { region(runtime, dst); const value = rectRegion(l, t, r, b); store(runtime, dst, value); return value.bands.length ? 1 : 0; });
  add(REGION, 'nativeSetPath(JJJ)Z', runtime => unsupported(runtime, 'Region.setPath (path rasterisation)'));
  add(REGION, 'nativeGetBoundaryPath(JJ)Z', runtime => unsupported(runtime, 'Region.getBoundaryPath (region outlining)'));
  add(REGION, 'nativeGetBounds(JLandroid/graphics/Rect;)Z', (runtime, [handle, rect]) => {
    if (rect === null) runtime.throwJava('Ljava/lang/NullPointerException;', 'rect == null');
    const b = bounds(region(runtime, handle)); setRectFields(runtime, rect, b ?? { left: 0, top: 0, right: 0, bottom: 0 }); return b ? 1 : 0;
  });
  add(REGION, 'nativeOp(JIIIII)Z', (runtime, [dst, l, t, r, b, op]) => { const value = operate(region(runtime, dst), rectRegion(l, t, r, b), op); store(runtime, dst, value); return value.bands.length ? 1 : 0; });
  add(REGION, 'nativeOp(JLandroid/graphics/Rect;JI)Z', (runtime, [dst, rect, other, op]) => {
    if (rect === null) runtime.throwJava('Ljava/lang/NullPointerException;', 'rect == null');
    const { l, t, r, b } = rectOf(runtime, rect), value = operate(rectRegion(l, t, r, b), region(runtime, other), op); region(runtime, dst); store(runtime, dst, value); return value.bands.length ? 1 : 0;
  });
  add(REGION, 'nativeOp(JJJI)Z', (runtime, [dst, a, b, op]) => { const value = operate(region(runtime, a), region(runtime, b), op); region(runtime, dst); store(runtime, dst, value); return value.bands.length ? 1 : 0; });
  add(REGION, 'nativeEquals(JJ)Z', (runtime, [a, b]) => JSON.stringify(region(runtime, a).bands) === JSON.stringify(region(runtime, b).bands) ? 1 : 0);
  add(REGION, 'nativeCreateFromParcel(Landroid/os/Parcel;)J', runtime => unsupported(runtime, 'Region Parcel deserialisation (Skia private layout)'));
  add(REGION, 'nativeWriteToParcel(JLandroid/os/Parcel;)Z', runtime => unsupported(runtime, 'Region Parcel serialisation (Skia private layout)'));
  add(REGION, `nativeToString(J)${STRING}`, (runtime, [handle]) => { const value = region(runtime, handle); return 'SkRegion(' + rects(value).map(q => `(${q.left},${q.top},${q.right},${q.bottom})`).join('') + ')'; });
  add(REGION, 'isEmpty()Z', (runtime, [ref]) => self(runtime, ref).bands.length ? 0 : 1);
  add(REGION, 'isRect()Z', (runtime, [ref]) => isRect(self(runtime, ref)) ? 1 : 0);
  add(REGION, 'isComplex()Z', (runtime, [ref]) => { const v = self(runtime, ref); return v.bands.length && !isRect(v) ? 1 : 0; });
  add(REGION, 'contains(II)Z', (runtime, [ref, x, y]) => { const spans = spansAt(self(runtime, ref), y); for (let i = 0; i < spans.length; i += 2) if (x >= spans[i] && x < spans[i + 1]) return 1; return 0; });
  add(REGION, 'quickContains(IIII)Z', (runtime, [ref, l, t, r, b]) => { const v = self(runtime, ref); return isRect(v) && l < r && t < b && bounds(v).left <= l && bounds(v).top <= t && bounds(v).right >= r && bounds(v).bottom >= b ? 1 : 0; });
  add(REGION, 'quickReject(IIII)Z', (runtime, [ref, l, t, r, b]) => { const v = self(runtime, ref), bb = bounds(v); return !bb || l >= r || t >= b || r <= bb.left || l >= bb.right || b <= bb.top || t >= bb.bottom ? 1 : 0; });
  add(REGION, 'quickReject(Landroid/graphics/Region;)Z', (runtime, [ref, other]) => {
    if (other === null) runtime.throwJava('Ljava/lang/NullPointerException;', 'rgn == null');
    const a = bounds(self(runtime, ref)), b = bounds(self(runtime, other)); return !a || !b || b.right <= a.left || b.left >= a.right || b.bottom <= a.top || b.top >= a.bottom ? 1 : 0;
  });
  add(REGION, 'translate(IILandroid/graphics/Region;)V', (runtime, [ref, dx, dy, dst]) => {
    if (dst === null) runtime.throwJava('Ljava/lang/NullPointerException;', 'dst == null');
    const v = self(runtime, ref), moved = { bands: v.bands.map(band => ({ top: band.top + dy, bottom: band.bottom + dy, spans: band.spans.map(x => x + dx) })) };
    store(runtime, runtime.object(dst).fields.get(`${REGION}->mNativeRegion:J`), moved);
  });
  add(REGION, 'scale(FLandroid/graphics/Region;)V', (runtime, [ref, scaleBits, dst]) => {
    if (dst === null) runtime.throwJava('Ljava/lang/NullPointerException;', 'dst == null');
    const view = new DataView(new ArrayBuffer(4)); view.setInt32(0, scaleBits | 0, true); const scale = view.getFloat32(0, true), v = self(runtime, ref);
    // SkRegion::scale-style: every rectangle edge is scaled and rounded; the result is rebuilt as a union so overlaps stay canonical.
    let out = emptyRegion();
    for (const q of rects(v)) out = operate(out, rectRegion(Math.round(q.left * scale), Math.round(q.top * scale), Math.round(q.right * scale), Math.round(q.bottom * scale)), OP_UNION);
    store(runtime, runtime.object(dst).fields.get(`${REGION}->mNativeRegion:J`), out);
  });
  add(ITER, 'nativeConstructor(J)J', (runtime, [handle]) => { const reg = registryOf(runtime), id = reg.next++; reg.iterators.set(id, { rects: rects(region(runtime, handle)), index: 0 }); return id; });
  add(ITER, 'nativeDestructor(J)V', (runtime, [id]) => { registryOf(runtime).iterators.delete(BigInt(id)); });
  add(ITER, 'nativeNext(JLandroid/graphics/Rect;)Z', (runtime, [id, rect]) => {
    if (rect === null) runtime.throwJava('Ljava/lang/NullPointerException;', 'r == null');
    const it = registryOf(runtime).iterators.get(BigInt(id)); if (!it) throw new APKError('RegionIterator native handle is not live', { kind: 'region-dead' });
    if (it.index >= it.rects.length) return 0; setRectFields(runtime, rect, it.rects[it.index++]); return 1;
  });
  return [...bindings];
}
