// The draw pipeline of the CPU OpenGL ES implementation (docs/OPENGL-ES-ON-CPU.md), in the order of the ES 3.0 specification: vertex fetch (2.9), the vertex shader, transform
// feedback (2.15), primitive assembly, clipping against the view volume (2.17, in homogeneous coordinates), perspective division and the viewport (2.13), face culling (3.6.1),
// rasterization of points, lines and polygons at pixel centres with the top-left rule (3.4-3.6; vertex positions snapped to 1/256 pixel so shared edges are watertight),
// perspective-correct interpolation (3.6.1), the fragment shader, then the per-fragment operations (4.1: scissor, stencil, depth with polygon offset, occlusion queries,
// blending, colour masks) into the draw framebuffer's images. No process.*.
import { VARYING_BASE } from './program.js?v=df19921e3eea';
import { makeColorWriter, srgbDecode, srgbEncode, quantizeDepth, fromHalf } from './formats.js?v=df19921e3eea';

export const MODES = { POINTS: 0, LINES: 1, LINE_LOOP: 2, LINE_STRIP: 3, TRIANGLES: 4, TRIANGLE_STRIP: 5, TRIANGLE_FAN: 6 };
const E = {
  NEVER: 0x0200, LESS: 0x0201, EQUAL: 0x0202, LEQUAL: 0x0203, GREATER: 0x0204, NOTEQUAL: 0x0205, GEQUAL: 0x0206, ALWAYS: 0x0207,
  KEEP: 0x1E00, REPLACE: 0x1E01, INCR: 0x1E02, DECR: 0x1E03, INVERT: 0x150A, INCR_WRAP: 0x8507, DECR_WRAP: 0x8508, ZERO: 0,
  FRONT: 0x0404, BACK: 0x0405, FRONT_AND_BACK: 0x0408, CW: 0x0900, CCW: 0x0901,
  FUNC_ADD: 0x8006, FUNC_SUBTRACT: 0x800A, FUNC_REVERSE_SUBTRACT: 0x800B, MIN: 0x8007, MAX: 0x8008,
  ONE: 1, SRC_COLOR: 0x0300, ONE_MINUS_SRC_COLOR: 0x0301, SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, DST_ALPHA: 0x0304, ONE_MINUS_DST_ALPHA: 0x0305,
  DST_COLOR: 0x0306, ONE_MINUS_DST_COLOR: 0x0307, SRC_ALPHA_SATURATE: 0x0308, CONSTANT_COLOR: 0x8001, ONE_MINUS_CONSTANT_COLOR: 0x8002, CONSTANT_ALPHA: 0x8003, ONE_MINUS_CONSTANT_ALPHA: 0x8004,
  BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, UNSIGNED_INT: 0x1405, FLOAT: 0x1406, HALF_FLOAT: 0x140B, FIXED: 0x140C,
  INT_2_10_10_10_REV: 0x8D9F, UNSIGNED_INT_2_10_10_10_REV: 0x8368,
};
const DEPTH_FUNCS = {
  [E.NEVER]: () => false, [E.LESS]: (a, b) => a < b, [E.EQUAL]: (a, b) => a === b, [E.LEQUAL]: (a, b) => a <= b, [E.GREATER]: (a, b) => a > b,
  [E.NOTEQUAL]: (a, b) => a !== b, [E.GEQUAL]: (a, b) => a >= b, [E.ALWAYS]: () => true,
};
function stencilOp(op, value, ref) {
  switch (op) {
    case E.KEEP: return value; case E.ZERO: return 0; case E.REPLACE: return ref & 255; case E.INCR: return value < 255 ? value + 1 : 255; case E.DECR: return value > 0 ? value - 1 : 0;
    case E.INVERT: return ~value & 255; case E.INCR_WRAP: return (value + 1) & 255; case E.DECR_WRAP: return (value - 1) & 255; default: return value;
  }
}

// ---- vertex fetch -----------------------------------------------------------------------------------------------------------------------------------------------------------
/** A reader of attribute `a` into A[base..base+3]: (vertex, instance) -> void. */
function attributeReader(a, A, base, generic) {
  if (!a || !a.enabled) { const g = generic; return () => { A[base] = g[0]; A[base + 1] = g[1]; A[base + 2] = g[2]; A[base + 3] = g[3]; }; }
  const data = a.buffer.data, view = new DataView(data.buffer, data.byteOffset, data.byteLength), size = a.size, type = a.type, norm = a.normalized && !a.integer, stride = a.stride || a.elementBytes, offset = a.offset, divisor = a.divisor;
  const index = divisor ? (v, inst) => Math.floor(inst / divisor) : v => v;
  const fill = () => { for (let k = size; k < 4; k++) A[base + k] = k === 3 ? 1 : 0; };
  fill();
  let get;
  switch (type) {
    case E.FLOAT: if (offset % 4 === 0 && stride % 4 === 0 && data.byteOffset % 4 === 0) { const f = new Float32Array(data.buffer, data.byteOffset, data.byteLength >> 2), s = stride >> 2, o = offset >> 2; return (v, inst) => { const at = index(v, inst) * s + o; for (let k = 0; k < size; k++) A[base + k] = f[at + k]; }; } get = (at) => view.getFloat32(at, true); break;
    case E.UNSIGNED_BYTE: get = norm ? at => view.getUint8(at) / 255 : at => view.getUint8(at); break;
    case E.BYTE: get = norm ? at => Math.max(-1, view.getInt8(at) / 127) : at => view.getInt8(at); break;
    case E.UNSIGNED_SHORT: get = norm ? at => view.getUint16(at, true) / 65535 : at => view.getUint16(at, true); break;
    case E.SHORT: get = norm ? at => Math.max(-1, view.getInt16(at, true) / 32767) : at => view.getInt16(at, true); break;
    case E.UNSIGNED_INT: get = norm ? at => view.getUint32(at, true) / 4294967295 : at => view.getUint32(at, true); break;
    case E.INT: get = norm ? at => Math.max(-1, view.getInt32(at, true) / 2147483647) : at => view.getInt32(at, true); break;
    case E.HALF_FLOAT: case 0x8D61: get = at => fromHalf(view.getUint16(at, true)); break;
    case E.FIXED: get = at => view.getInt32(at, true) / 65536; break;
    case E.INT_2_10_10_10_REV: case E.UNSIGNED_INT_2_10_10_10_REV: {
      const signed = type === E.INT_2_10_10_10_REV;
      return (v, inst) => {
        const x = view.getUint32(index(v, inst) * stride + offset, true);
        const parts = signed ? [(x << 22) >> 22, (x << 12) >> 22, (x << 2) >> 22, x >> 30] : [x & 1023, (x >>> 10) & 1023, (x >>> 20) & 1023, x >>> 30];
        for (let k = 0; k < 4; k++) A[base + k] = norm ? (signed ? Math.max(-1, parts[k] / (k === 3 ? 1 : 511)) : parts[k] / (k === 3 ? 3 : 1023)) : parts[k];
      };
    }
    default: return () => {};
  }
  const bytes = a.componentBytes;
  return (v, inst) => { const at = index(v, inst) * stride + offset; for (let k = 0; k < size; k++) A[base + k] = get(at + k * bytes); };
}

// ---- the draw ------------------------------------------------------------------------------------------------------------------------------------------------------------------
/**
 * Draws `count` vertices (indices: a Uint32Array of vertex indices or null for first..first+count-1) of `instances` instances with the context's current state.
 * `ctx` is the CPU context (src/cpu-gl/context.js): its state, program, vertex array, framebuffer targets and units.
 */
export function draw(ctx, mode, first, count, indices, instances) {
  const st = ctx.state, program = st.program.state, rtV = ctx.stageRuntime(program, 'vertex'), rtF = ctx.stageRuntime(program, 'fragment');
  const mainV = rtV.main, A = rtV.A, Ov = rtV.O, Fv = rtV.F;
  const stride = VARYING_BASE + program.varyingCount;
  // attribute readers
  const readers = [];
  for (const attr of program.activeAttributes) {
    const loc = attr.location, columns = attr.type.k === 'matrix' ? attr.type.c : 1;
    for (let c = 0; c < columns; c++) readers.push(attributeReader(st.vao.attribs[loc + c], A, (loc + c) * 4, ctx.generic[loc + c]));
  }
  const tf = st.transformFeedback && st.transformFeedback.active && !st.transformFeedback.paused ? st.transformFeedback : null;
  const target = ctx.drawTarget();
  for (let instance = 0; instance < instances; instance++) {
    Fv[1] = instance;
    // shade the vertices this instance uses (each index once)
    const cache = new Map();
    const shade = v => {
      let out = cache.get(v); if (out) return out;
      Fv[0] = v; for (let i = 0; i < readers.length; i++) readers[i](v, instance);
      mainV();
      out = Ov.slice(0, stride); cache.set(v, out); return out;
    };
    const list = [];
    for (let i = 0; i < count; i++) { const v = indices ? indices[i] : first + i; list.push(v === -1 ? null : shade(v)); }
    if (tf) ctx.captureFeedback(tf, mode, list, program);
    if (st.rasterizerDiscard || !target) continue;
    rasterize(ctx, mode, list, program, rtF, target);
  }
}
/** Primitive assembly (ES 3.0 2.8.1) of the shaded vertices (null = primitive restart) and rasterization. */
function rasterize(ctx, mode, list, program, rtF, target) {
  const r = new Raster(ctx, program, rtF, target);
  // split at primitive restarts
  const runs = []; let run = [];
  for (const v of list) { if (v === null) { if (run.length) runs.push(run); run = []; } else run.push(v); }
  if (run.length) runs.push(run);
  for (const vs of runs) {
    switch (mode) {
      case MODES.POINTS: for (const v of vs) r.point(v); break;
      case MODES.LINES: for (let i = 0; i + 1 < vs.length; i += 2) r.line(vs[i], vs[i + 1], vs[i + 1]); break;
      case MODES.LINE_STRIP: for (let i = 0; i + 1 < vs.length; i++) r.line(vs[i], vs[i + 1], vs[i + 1]); break;
      case MODES.LINE_LOOP: for (let i = 0; i + 1 < vs.length; i++) r.line(vs[i], vs[i + 1], vs[i + 1]); if (vs.length > 1) r.line(vs[vs.length - 1], vs[0], vs[0]); break;
      case MODES.TRIANGLES: for (let i = 0; i + 2 < vs.length; i += 3) r.triangle(vs[i], vs[i + 1], vs[i + 2], vs[i + 2]); break;
      case MODES.TRIANGLE_STRIP: for (let i = 0; i + 2 < vs.length; i++) { if (i % 2) r.triangle(vs[i + 1], vs[i], vs[i + 2], vs[i + 2]); else r.triangle(vs[i], vs[i + 1], vs[i + 2], vs[i + 2]); } break;
      case MODES.TRIANGLE_FAN: for (let i = 1; i + 1 < vs.length; i++) r.triangle(vs[0], vs[i], vs[i + 1], vs[i + 1]); break;
    }
  }
  ctx.samplesPassed += r.passed;
}

const SNAP = 256;
class Raster {
  constructor(ctx, program, rt, target) {
    const st = ctx.state;
    this.ctx = ctx; this.st = st; this.program = program; this.rt = rt; this.target = target; this.passed = 0;
    this.main = rt.main; this.I = rt.I; this.L1 = rt.L1; this.L2 = rt.L2; this.F = rt.F; this.F1 = rt.F1; this.F2 = rt.F2; this.O = rt.O;
    this.nvar = program.varyingCount; this.flat = program.flat; this.anyFlat = program.flat.some(Boolean); this.flatRead = program.readVaryings.filter(k => program.flat[k - VARYING_BASE]); this.smoothRead = program.readVaryings.filter(k => !program.flat[k - VARYING_BASE]);
    this.lanes = program.laneInputs; this.laneFrag = program.fragCoordLanes; this.lanePoint = program.pointCoordLanes;
    const [vx, vy, vw, vh] = st.viewport; this.vx = vx; this.vy = vy; this.vw = vw; this.vh = vh;
    this.near = st.depthRange[0]; this.far = st.depthRange[1];
    // the pixel rectangle fragments may land in: the framebuffer, the scissor box
    let x0 = 0, y0 = 0, x1 = target.width, y1 = target.height;
    if (st.scissorTest) { const [sx, sy, sw, sh] = st.scissor; x0 = Math.max(x0, sx); y0 = Math.max(y0, sy); x1 = Math.min(x1, sx + sw); y1 = Math.min(y1, sy + sh); }
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    // triangles are not cut at the side planes of the view volume (a guard band, as GPUs do, so edges stay the app's lines): the viewport bounds their pixels instead
    this.tx0 = Math.max(x0, vx); this.ty0 = Math.max(y0, vy); this.tx1 = Math.min(x1, vx + vw); this.ty1 = Math.min(y1, vy + vh);
    this.setupFragmentOps();
  }
  // ---- per-fragment operations (ES 3.0 4.1) ----
  setupFragmentOps() {
    const st = this.st, t = this.target, program = this.program;
    this.depth = st.depthTest && t.depth ? t.depth : null; this.depthFunc = DEPTH_FUNCS[st.depthFunc]; this.depthWrite = st.depthMask && !!this.depth;
    this.depthFmt = t.depth?.img.fmt; this.depthBase = t.depth ? t.depth.layer * t.depth.img.width * t.depth.img.height : 0; this.depthW = t.depth?.img.width ?? 0;
    this.stencil = st.stencilTest && t.stencil ? t.stencil : null; this.stencilBase = t.stencil ? t.stencil.layer * t.stencil.img.width * t.stencil.img.height : 0; this.stencilW = t.stencil?.img.width ?? 0;
    this.writesDepth = program.writesDepth; this.discards = program.usesDiscard;
    this.earlyTests = !this.writesDepth && !!(this.depth || this.stencil);   // only worth a test before shading when there is something to test
    this.offsetOn = st.polygonOffsetFill; this.offsetFactor = st.polygonOffset[0]; this.offsetUnits = st.polygonOffset[1];
    this.depthUnit = this.depthFmt ? (this.depthFmt.floatDepth ? 2 ** -23 : 1 / (2 ** this.depthFmt.depthBits - 1)) : 1 / 16777215;
    // colour outputs: fragment colour i -> draw buffer i -> an image
    const outputs = [];
    t.colors.forEach((c, i) => {
      if (!c) return;
      const source = program.writesFragColor ? 0 : program.version300 ? (program.fragmentOutputs.some(o => i >= o.location && i < o.location + o.count) ? i * 4 : -1) : i * 4;
      if (source < 0) return;
      const fmt = c.img.fmt, integer = fmt.kind === 'int' || fmt.kind === 'uint';
      outputs.push({ img: c.img, data: c.img.data, base: c.layer * c.img.width * c.img.height, w: c.img.width, fmt, source, write: makeColorWriter(fmt), integer, u8: fmt.store === 'u8', srgb: fmt.srgb, fixed: fmt.kind === 'unorm' || fmt.kind === 'snorm', rgba8: fmt.store === 'u8' && !fmt.srgb && fmt.bits[0] === 8 && fmt.bits[1] === 8 && fmt.bits[2] === 8 && (fmt.bits[3] === 8 || fmt.channels === 'RGB') });
    });
    this.outputs = outputs;
    const m = st.colorMask; this.mask = m; this.maskAll = m[0] && m[1] && m[2] && m[3]; this.maskNone = !m[0] && !m[1] && !m[2] && !m[3];
    this.blend = st.blend; this.blendState = { eqRGB: st.blendEquation[0], eqA: st.blendEquation[1], srcRGB: st.blendFunc[0], dstRGB: st.blendFunc[1], srcA: st.blendFunc[2], dstA: st.blendFunc[3], color: st.blendColor };
    this.writeColors = colorWriter(outputs, st, this.O);
    this.span = spanFunction(this);
  }
  /** Runs the per-fragment tests and writes for pixel (x, y) at window depth z; `front` picks the stencil state. Returns after the fragment shader ran (O holds its outputs). */
  fragment(x, y, z, front) {
    const st = this.st;
    let zq = z;
    if (this.writesDepth) zq = this.O[16];
    if (this.depth) zq = quantizeDepth(this.depthFmt, zq); else zq = zq < 0 ? 0 : zq > 1 ? 1 : zq;
    // stencil
    let sIndex = -1, sv = 0;
    const face = front ? 0 : 1;
    if (this.stencil) {
      sIndex = this.stencilBase + y * this.stencilW + x; sv = this.stencil.img.stencil[sIndex];
      const f = st.stencilFunc[face], ref = f.ref < 0 ? 0 : f.ref > 255 ? 255 : f.ref;
      if (!DEPTH_FUNCS[f.func](ref & f.mask, sv & f.mask)) { this.stencilWrite(sIndex, sv, stencilOp(st.stencilOp[face].fail, sv, f.ref), face); return false; }
    }
    if (this.depth) {
      const dIndex = this.depthBase + y * this.depthW + x, d = this.depth.img.depthData;
      if (!this.depthFunc(zq, d[dIndex])) { if (this.stencil) this.stencilWrite(sIndex, sv, stencilOp(st.stencilOp[face].zfail, sv, st.stencilFunc[face].ref), face); return false; }
      if (this.depthWrite) d[dIndex] = zq;
    }
    if (this.stencil) this.stencilWrite(sIndex, sv, stencilOp(st.stencilOp[face].zpass, sv, st.stencilFunc[face].ref), face);
    this.passed++;
    if (!this.maskNone) this.writeColors(x, y);
    return true;
  }
  stencilWrite(index, old, value, face) { const mask = this.st.stencilWriteMask[face] & 255; if (mask === 0) return; this.stencil.img.stencil[index] = (old & ~mask) | (value & mask); }
  /** Fills F / I for a fragment and runs the fragment shader; returns true unless it discarded. */
  shade() { return this.main() === 0; }

  // ---- vertices to window coordinates ----
  window(v) {
    const w = v[3], iw = 1 / w;
    const xd = v[0] * iw, yd = v[1] * iw, zd = v[2] * iw;
    return { x: Math.round(((xd + 1) * this.vw / 2 + this.vx) * SNAP) / SNAP, y: Math.round(((yd + 1) * this.vh / 2 + this.vy) * SNAP) / SNAP, z: zd * (this.far - this.near) / 2 + (this.far + this.near) / 2, iw, v };
  }
  inside(v) { const w = v[3]; return v[0] >= -w && v[0] <= w && v[1] >= -w && v[1] <= w && v[2] >= -w && v[2] <= w && w > 0; }
  inGuard(v) { const w = v[3], g = GUARD * w; return v[0] >= -g && v[0] <= g && v[1] >= -g && v[1] <= g && v[2] >= -w && v[2] <= w && w > 0; }

  // ---- triangles ----
  triangle(a, b, c, provoking) {
    if (this.inGuard(a) && this.inGuard(b) && this.inGuard(c)) return this.rasterTriangle(a, b, c, provoking);
    let poly = [a, b, c];
    for (const plane of GUARD_PLANES) { poly = clipPolygon(poly, plane, a.length); if (poly.length < 3) return; }
    for (let i = 1; i + 1 < poly.length; i++) this.rasterTriangle(poly[0], poly[i], poly[i + 1], provoking, true);
  }
  rasterTriangle(a, b, c, provoking, clipped = false) {
    const st = this.st;
    let p0 = this.window(a), p1 = this.window(b), p2 = this.window(c);
    let area = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
    if (area === 0 || !Number.isFinite(area)) return;
    const ccw = area > 0, front = (st.frontFace === E.CCW) === ccw;
    if (st.cullFace && (st.cullMode === E.FRONT_AND_BACK || (st.cullMode === E.FRONT) === front)) return;
    if (!ccw) { const t = p1; p1 = p2; p2 = t; area = -area; }
    void clipped;
    // bounding box in pixels
    const minX = Math.max(this.tx0, Math.floor(Math.min(p0.x, p1.x, p2.x))), maxX = Math.min(this.tx1 - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(this.ty0, Math.floor(Math.min(p0.y, p1.y, p2.y))), maxY = Math.min(this.ty1 - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    if (minX > maxX || minY > maxY) return;
    // edge functions: e0 opposite p0 (edge p1 -> p2), e1 opposite p1 (p2 -> p0), e2 opposite p2 (p0 -> p1); inside when all >= 0 (top-left edges) or > 0
    const ax = [p1.x, p2.x, p0.x], ay = [p1.y, p2.y, p0.y], bx = [p2.x, p0.x, p1.x], by = [p2.y, p0.y, p1.y];
    const dx = [bx[0] - ax[0], bx[1] - ax[1], bx[2] - ax[2]], dy = [by[0] - ay[0], by[1] - ay[1], by[2] - ay[2]];
    const topLeft = [0, 1, 2].map(i => dy[i] < 0 || (dy[i] === 0 && dx[i] < 0));
    const inv = 1 / area;
    // depth plane and polygon offset (ES 3.0 3.6.5)
    const z0 = p0.z, z1 = p1.z, z2 = p2.z;
    let zoff = 0;
    if (this.offsetOn) {
      const dzdx = ((z1 - z0) * (p2.y - p0.y) - (z2 - z0) * (p1.y - p0.y)) * inv, dzdy = ((z2 - z0) * (p1.x - p0.x) - (z1 - z0) * (p2.x - p0.x)) * inv;
      zoff = Math.max(Math.abs(dzdx), Math.abs(dzdy)) * this.offsetFactor + this.depthUnit * this.offsetUnits;
    }
    const v0 = p0.v, v1 = p1.v, v2 = p2.v, I = this.I;
    for (const k of this.flatRead) I[k] = provoking[k];
    if (this.lanes.length) for (const k of this.flatRead) { this.L1[k] = provoking[k]; this.L2[k] = provoking[k]; }
    const cx = minX + 0.5, cy = minY + 0.5;
    // with the interior on the left of each edge (counter-clockwise, y up) the edge function is (b - a) x (p - a): inside means e >= 0
    const r0 = (cy - ay[0]) * dx[0] - (cx - ax[0]) * dy[0], r1 = (cy - ay[1]) * dx[1] - (cx - ax[1]) * dy[1], r2 = (cy - ay[2]) * dx[2] - (cx - ax[2]) * dy[2];
    this.passed += this.span(minX, maxX, minY, maxY, r0, r1, r2, dx[0], dx[1], dx[2], dy[0], dy[1], dy[2], topLeft[0], topLeft[1], topLeft[2], inv, z0, z1, z2, zoff, p0.iw, p1.iw, p2.iw, v0, v1, v2, front);
  }
  // ---- lines (width 1) ----
  line(a, b, provoking) {
    let p = a, q = b;
    if (!this.inside(a) || !this.inside(b)) { const clipped = clipLine(a, b); if (!clipped) return; [p, q] = clipped; }
    const s = this.window(p), e = this.window(q);
    const nvar = this.nvar, I = this.I, F = this.F, base = VARYING_BASE, flat = this.flat;
    for (let k = 0; k < nvar; k++) if (flat[k]) I[base + k] = provoking[base + k];
    F[4] = 1;
    const ddx = e.x - s.x, ddy = e.y - s.y, xMajor = Math.abs(ddx) >= Math.abs(ddy);
    const len = xMajor ? Math.abs(ddx) : Math.abs(ddy); if (len === 0) return;
    // the diamond-exit rule (ES 3.0 3.5.1): a pixel is drawn when the segment leaves its diamond |x - xc| + |y - yc| < 1/2. Along the major axis that is the pixel whose centre
    // line the segment crosses, except at the ends: the start pixel is drawn when the start lies inside its diamond, the end pixel is not when the end lies inside its diamond.
    const start = xMajor ? s.x : s.y, end = xMajor ? e.x : e.y, dir = end > start ? 1 : -1;
    const inDiamond = (px, py) => Math.abs(px - (Math.floor(px) + 0.5)) + Math.abs(py - (Math.floor(py) + 0.5)) < 0.5;
    const pixels = [];
    let c = dir > 0 ? Math.ceil(start - 0.5) + 0.5 : Math.floor(start + 0.5) - 0.5;
    if (c === start) c += 0;   // a centre exactly at the start belongs to the segment
    for (; dir > 0 ? c < end : c > end; c += dir) {
      const t = (c - start) / (end - start); if (t < 0 || t > 1) continue;
      const other = xMajor ? s.y + t * ddy : s.x + t * ddx;
      pixels.push([xMajor ? Math.floor(c) : Math.floor(other), xMajor ? Math.floor(other) : Math.floor(c), t]);
    }
    const first = [Math.floor(s.x), Math.floor(s.y)], last = [Math.floor(e.x), Math.floor(e.y)];
    if (inDiamond(s.x, s.y) && !pixels.some(([x, y]) => x === first[0] && y === first[1])) pixels.unshift([first[0], first[1], 0]);
    if (inDiamond(e.x, e.y)) { const at = pixels.findIndex(([x, y]) => x === last[0] && y === last[1]); if (at >= 0) pixels.splice(at, 1); }
    for (const [x, y, t] of pixels) {
      if (x < this.x0 || y < this.y0 || x >= this.x1 || y >= this.y1) continue;
      const z = s.z + t * (e.z - s.z), q0 = (1 - t) * s.iw, q1 = t * e.iw, Q = q0 + q1, a0 = q0 / Q, a1 = q1 / Q;
      for (let k = 0; k < nvar; k++) if (!flat[k]) I[base + k] = a0 * p[base + k] + a1 * q[base + k];
      F[0] = x + 0.5; F[1] = y + 0.5; F[2] = z; F[3] = Q;
      if (this.lanes.length || this.laneFrag) { for (const k of this.lanes) { this.L1[k] = I[k]; this.L2[k] = I[k]; } this.F1.set(F.subarray(0, 4)); this.F2.set(F.subarray(0, 4)); }
      if (this.shade()) this.fragment(x, y, z, true);
    }
  }
  // ---- points ----
  point(v) {
    const w = v[3]; if (!(w > 0) || v[0] < -w || v[0] > w || v[1] < -w || v[1] > w || v[2] < -w || v[2] > w) return;   // a point whose centre is outside the view volume is discarded
    const p = this.window(v), size = this.program.usesPointSize ? Math.min(1024, Math.max(1, v[4])) : 1, half = size / 2;
    const nvar = this.nvar, I = this.I, F = this.F, base = VARYING_BASE;
    for (let k = 0; k < nvar; k++) I[base + k] = v[base + k];
    F[4] = 1;
    const x0 = Math.max(this.x0, Math.ceil(p.x - half - 0.5)), x1 = Math.min(this.x1 - 1, Math.ceil(p.x + half - 0.5) - 1);   // the centres in [x - size/2, x + size/2)
    const y0 = Math.max(this.y0, Math.ceil(p.y - half - 0.5)), y1 = Math.min(this.y1 - 1, Math.ceil(p.y + half - 0.5) - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      F[0] = x + 0.5; F[1] = y + 0.5; F[2] = p.z; F[3] = p.iw;
      F[5] = 0.5 + (x + 0.5 - p.x) / size; F[6] = 0.5 - (y + 0.5 - p.y) / size;   // gl_PointCoord: (0, 0) at the upper left (ES 3.0 3.4.1)
      if (this.lanes.length || this.laneFrag || this.lanePoint) {
        for (const k of this.lanes) { this.L1[k] = I[k]; this.L2[k] = I[k]; }
        const sx = x & 1 ? -1 : 1, sy = y & 1 ? -1 : 1; F[8] = sx; F[9] = sy; this.F1.set(F.subarray(0, 7)); this.F2.set(F.subarray(0, 7)); this.F1[0] += sx; this.F2[1] += sy; this.F1[5] += sx / size; this.F2[6] -= sy / size;
      }
      if (this.shade()) this.fragment(x, y, p.z, true);
    }
  }
}
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const spanCache = new Map();
/**
 * The pixel loop of a triangle for one draw configuration, generated (as the shaders are): the bounding box walked with the three edge functions, the depth plane, perspective
 * correction of the inputs the fragment shader reads (and their x+1 / y+1 lanes when it takes derivatives), an early depth test when nothing can change the depth, the shader,
 * then the colour writer. Stencil and shader-written depth go through the general per-fragment path (Raster.fragment).
 */
function spanFunction(r) {
  const smooth = r.smoothRead, lanes = r.lanes, flat = r.flat, depth = r.depth, general = !!r.stencil || r.writesDepth;
  const fmt = r.depthFmt, depthFunc = r.st.depthFunc;
  const key = JSON.stringify([smooth, lanes.map(k => [k, flat[k - VARYING_BASE]]), r.laneFrag, r.program.usesFragCoord, general, !!depth && [depthFunc, r.depthWrite, fmt.floatDepth, fmt.depthBits], r.maskNone]);
  let make = spanCache.get(key);
  if (!make) {
    const cmp = { [E.NEVER]: 'false', [E.LESS]: 'zq < dv', [E.EQUAL]: 'zq === dv', [E.LEQUAL]: 'zq <= dv', [E.GREATER]: 'zq > dv', [E.NOTEQUAL]: 'zq !== dv', [E.GEQUAL]: 'zq >= dv', [E.ALWAYS]: 'true' }[depthFunc];
    const quant = !depth ? '' : fmt.floatDepth ? 'Math.fround(zc)' : `Math.fround(Math.round(zc * ${fmt.depthBits === 16 ? 65535 : 16777215}) / ${fmt.depthBits === 16 ? 65535 : 16777215})`;
    const L = ['return function span(minX, maxX, minY, maxY, r0, r1, r2, ex0, ex1, ex2, ey0, ey1, ey2, tl0, tl1, tl2, inv, z0, z1, z2, zoff, w0, w1, w2, v0, v1, v2, front) {',
      'let passed = 0, e0r = r0, e1r = r1, e2r = r2; F[4] = front ? 1 : 0;',
      'for (let y = minY; y <= maxY; y++, e0r += ex0, e1r += ex1, e2r += ex2) {',
      'let e0 = e0r, e1 = e1r, e2 = e2r;',
      'for (let x = minX; x <= maxX; x++, e0 -= ey0, e1 -= ey1, e2 -= ey2) {',
      'if (!((e0 > 0 || (e0 === 0 && tl0)) && (e1 > 0 || (e1 === 0 && tl1)) && (e2 > 0 || (e2 === 0 && tl2)))) continue;',
      'const l0 = e0 * inv, l1 = e1 * inv, l2 = e2 * inv, z = l0 * z0 + l1 * z1 + l2 * z2 + zoff;'];
    if (depth && !general) L.push(`const zc = z < 0 ? 0 : z > 1 ? 1 : z, zq = ${quant}, di = DB + y * DW + x, dv = DD[di]; if (!(${cmp})) continue;`);
    L.push('const q0 = l0 * w0, q1 = l1 * w1, q2 = l2 * w2, Q = q0 + q1 + q2, iq = 1 / Q, a0 = q0 * iq, a1 = q1 * iq, a2 = q2 * iq;');
    for (const k of smooth) L.push(`I[${k}] = a0 * v0[${k}] + a1 * v1[${k}] + a2 * v2[${k}];`);
    L.push('F[0] = x + 0.5; F[1] = y + 0.5; F[2] = z; F[3] = Q;');
    if (lanes.length || r.laneFrag) {
      L.push('const sx = x & 1 ? -1 : 1, sy = y & 1 ? -1 : 1; F[8] = sx; F[9] = sy;');
      for (const [side, f] of [['L1', ['e0 - sx * ey0', 'e1 - sx * ey1', 'e2 - sx * ey2']], ['L2', ['e0 + sy * ex0', 'e1 + sy * ex1', 'e2 + sy * ex2']]]) {
        L.push(`{ const m0 = (${f[0]}) * inv * w0, m1 = (${f[1]}) * inv * w1, m2 = (${f[2]}) * inv * w2, mq = m0 + m1 + m2, mi = 1 / mq;`);
        for (const k of lanes) if (!flat[k - VARYING_BASE]) L.push(`${side}[${k}] = (m0 * v0[${k}] + m1 * v1[${k}] + m2 * v2[${k}]) * mi;`);
        if (r.laneFrag) { const Fl = side === 'L1' ? 'F1' : 'F2'; L.push(`${Fl}[0] = x + 0.5${side === 'L1' ? ' + sx' : ''}; ${Fl}[1] = y + 0.5${side === 'L1' ? '' : ' + sy'}; ${Fl}[2] = ((${f[0]}) * z0 + (${f[1]}) * z1 + (${f[2]}) * z2) * inv + zoff; ${Fl}[3] = mq;`); }
        L.push('}');
      }
    }
    L.push('if (main() !== 0) continue;');
    if (general) L.push('frag(x, y, z, front);');
    else { if (depth && r.depthWrite) L.push('DD[di] = zq;'); L.push('passed++;'); if (!r.maskNone) L.push('write(x, y);'); }
    L.push('}}', 'return passed;', '};');
    make = new Function('I', 'F', 'L1', 'L2', 'F1', 'F2', 'main', 'write', 'frag', 'DD', 'DB', 'DW', L.join('\n'));
    spanCache.set(key, make);
  }
  return make(r.I, r.F, r.L1, r.L2, r.F1, r.F2, r.main, r.writeColors, (x, y, z, front) => r.fragment(x, y, z, front), depth?.img.depthData ?? null, r.depthBase, r.depthW);
}
const writerCache = new Map();
/**
 * The colour writes of a draw (ES 3.0 4.1.7 blending, 4.1.9 dithering (none), 4.2.2 masks) as one generated function (x, y) for its outputs, blend state and colour mask:
 * no per-fragment dispatch on the state. Formats other than 8-bit RGBA / RGB go through their quantising writer (src/cpu-gl/formats.js).
 */
function colorWriter(outputs, st, O) {
  const m = st.colorMask, blend = st.blend, [eqRGB, eqA] = st.blendEquation, [srcRGB, dstRGB, srcA, dstA] = st.blendFunc;
  const key = JSON.stringify([outputs.map(o => [o.fmt.id, o.fmt.name, o.source, o.integer, o.rgba8, o.fixed, o.u8, o.srgb, o.fmt.channels]), m, blend && [eqRGB, eqA, srcRGB, dstRGB, srcA, dstA]]);
  let make = writerCache.get(key);
  if (!make) {
    const factor = (f, c) => {
      const s = ['r', 'g', 'b', 'a'][c], d = ['dr', 'dg', 'db', 'da'][c], k = ['c0', 'c1', 'c2', 'c3'][c];
      switch (f) {
        case E.ZERO: return '0'; case E.ONE: return '1'; case E.SRC_COLOR: return s; case E.ONE_MINUS_SRC_COLOR: return `(1-${s})`; case E.DST_COLOR: return d; case E.ONE_MINUS_DST_COLOR: return `(1-${d})`;
        case E.SRC_ALPHA: return 'a'; case E.ONE_MINUS_SRC_ALPHA: return '(1-a)'; case E.DST_ALPHA: return 'da'; case E.ONE_MINUS_DST_ALPHA: return '(1-da)';
        case E.CONSTANT_COLOR: return k; case E.ONE_MINUS_CONSTANT_COLOR: return `(1-${k})`; case E.CONSTANT_ALPHA: return 'c3'; case E.ONE_MINUS_CONSTANT_ALPHA: return '(1-c3)';
        case E.SRC_ALPHA_SATURATE: return c === 3 ? '1' : '(a<1-da?a:1-da)'; default: return '0';
      }
    };
    const term = (x, f) => (f === '0' ? null : f === '1' ? x : `${x}*${f}`);
    const equation = (eq, c, sf, df) => {
      const s = ['r', 'g', 'b', 'a'][c], d = ['dr', 'dg', 'db', 'da'][c];
      if (eq === E.MIN) return `(${s}<${d}?${s}:${d})`; if (eq === E.MAX) return `(${s}>${d}?${s}:${d})`;
      const a = term(s, sf), b = term(d, df);
      if (eq === E.FUNC_ADD) return a && b ? `${a}+${b}` : a ?? b ?? '0';
      if (eq === E.FUNC_SUBTRACT) return a && b ? `${a}-${b}` : a ?? (b ? `-${b}` : '0');
      return a && b ? `${b}-${a}` : b ?? (a ? `-${a}` : '0');
    };
    const q = v => `(${v}<=0?0:${v}>=1?255:(${v}*255+0.5)|0)`;
    const lines = [outputs.map((o, k) => `const D${k} = D[${k}], B${k} = B[${k}], W${k} = Wd[${k}];`).join(' '), 'return function write(x, y) {'];
    outputs.forEach((o, k) => {
      const s = o.source;
      lines.push(`{ const d = D${k}, at = (B${k} + y * W${k} + x) * 4; let r = O[${s}], g = O[${s + 1}], b = O[${s + 2}], a = O[${s + 3}];`);
      if (o.integer) { lines.push(m.every(Boolean) ? `Wr[${k}](d, at, r, g, b, a); }` : `Wr[${k}](T[${k}], 0, r, g, b, a); ${[0, 1, 2, 3].filter(i => m[i]).map(i => `d[at+${i}]=T[${k}][${i}];`).join('')} }`); return; }
      if (o.fixed) lines.push('r = r<0?0:r>1?1:r; g = g<0?0:g>1?1:g; b = b<0?0:b>1?1:b; a = a<0?0:a>1?1:a;');
      if (blend) {
        if (o.u8) lines.push(o.srgb ? 'const dr = SD[d[at]], dg = SD[d[at+1]], db = SD[d[at+2]], da = d[at+3]/255;' : 'const dr = d[at]/255, dg = d[at+1]/255, db = d[at+2]/255, da = d[at+3]/255;');
        else lines.push('const dr = d[at], dg = d[at+1], db = d[at+2], da = d[at+3];');
        lines.push(o.fixed ? 'const c0 = CC[0]<0?0:CC[0]>1?1:CC[0], c1 = CC[1]<0?0:CC[1]>1?1:CC[1], c2 = CC[2]<0?0:CC[2]>1?1:CC[2], c3 = CC[3]<0?0:CC[3]>1?1:CC[3];' : 'const c0 = CC[0], c1 = CC[1], c2 = CC[2], c3 = CC[3];');
        const rgb = [0, 1, 2].map(c => equation(eqRGB, c, factor(srcRGB, c), factor(dstRGB, c))), al = equation(eqA, 3, factor(srcA, 3), factor(dstA, 3));
        lines.push(`const nr = ${rgb[0]}, ng = ${rgb[1]}, nb = ${rgb[2]}, na = ${al}; r = nr; g = ng; b = nb; a = na;`);
      }
      if (o.rgba8) {
        const alpha = o.fmt.channels === 'RGB' ? '255' : q('a');
        lines.push([m[0] && `d[at] = ${q('r')};`, m[1] && `d[at+1] = ${q('g')};`, m[2] && `d[at+2] = ${q('b')};`, m[3] && `d[at+3] = ${alpha};`].filter(Boolean).join(' ') + ' }');
        return;
      }
      lines.push(m.every(Boolean) ? `Wr[${k}](d, at, r, g, b, a); }` : `Wr[${k}](T[${k}], 0, r, g, b, a); ${[0, 1, 2, 3].filter(i => m[i]).map(i => `d[at+${i}]=T[${k}][${i}];`).join('')} }`);
    });
    lines.push('};');
    make = new Function('O', 'D', 'B', 'Wd', 'Wr', 'T', 'CC', 'SD', lines.join('\n'));
    writerCache.set(key, make);
  }
  return make(O, outputs.map(o => o.data), outputs.map(o => o.base), outputs.map(o => o.w), outputs.map(o => o.write), outputs.map(o => new o.data.constructor(4)), st.blendColor, srgbDecode);
}
// ---- clipping in homogeneous coordinates ----
const PLANES = [[1, 0, 0, 1], [-1, 0, 0, 1], [0, 1, 0, 1], [0, -1, 0, 1], [0, 0, 1, 1], [0, 0, -1, 1]];
const GUARD = 64, GUARD_PLANES = [[0, 0, 1, 1], [0, 0, -1, 1], [1, 0, 0, GUARD], [-1, 0, 0, GUARD], [0, 1, 0, GUARD], [0, -1, 0, GUARD]];   // near / far, then a band 64x the view volume (window coordinates stay small enough for exact edge functions)
const distance = (v, [px, py, pz, g]) => g * v[3] + px * v[0] + py * v[1] + pz * v[2];   // >= 0 inside: w - x, w + x, ...
function lerp(a, b, t, n) { const out = new Float64Array(n); for (let k = 0; k < n; k++) out[k] = a[k] + (b[k] - a[k]) * t; return out; }
function clipPolygon(poly, plane, n) {
  const sign = [-plane[0], -plane[1], -plane[2], plane[3]], out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = distance(a, sign), db = distance(b, sign);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(lerp(a, b, da / (da - db), n));
  }
  return out;
}
function clipLine(a, b) {
  let t0 = 0, t1 = 1;
  for (const plane of PLANES) {
    const sign = [-plane[0], -plane[1], -plane[2], plane[3]], da = distance(a, sign), db = distance(b, sign);
    if (da < 0 && db < 0) return null;
    if (da < 0) t0 = Math.max(t0, da / (da - db)); else if (db < 0) t1 = Math.min(t1, da / (da - db));
  }
  if (t0 > t1) return null;
  const n = a.length; return [t0 > 0 ? lerp(a, b, t0, n) : a, t1 < 1 ? lerp(a, b, t1, n) : b];
}
export { srgbEncode };
