// Textures and samplers of the CPU OpenGL ES implementation (docs/OPENGL-ES-ON-CPU.md): texture objects of the four ES 3.0 targets with their levels, parameters and
// completeness (ES 3.0 3.8.13), and texture lookup (3.8.10-3.8.12): level of detail from the coordinate derivatives, nearest / linear filtering, mipmap selection, the wrap
// modes, cube face selection (table 3.21), depth comparison (3.8.16), swizzles and texelFetch. A generated shader (src/cpu-gl/glsl-codegen.js) calls unit.sample(mode) with
// its arguments in P and reads the result from R. No process.*.
import { MODE } from './glsl-codegen.js?v=d826b7643adc';
import { srgbDecode } from './formats.js?v=d826b7643adc';

export const T = {
  TEXTURE_2D: 0x0DE1, TEXTURE_3D: 0x806F, TEXTURE_2D_ARRAY: 0x8C1A, TEXTURE_CUBE_MAP: 0x8513, CUBE_POSITIVE_X: 0x8515,
  NEAREST: 0x2600, LINEAR: 0x2601, NEAREST_MIPMAP_NEAREST: 0x2700, LINEAR_MIPMAP_NEAREST: 0x2701, NEAREST_MIPMAP_LINEAR: 0x2702, LINEAR_MIPMAP_LINEAR: 0x2703,
  REPEAT: 0x2901, CLAMP_TO_EDGE: 0x812F, MIRRORED_REPEAT: 0x8370,
  MAG_FILTER: 0x2800, MIN_FILTER: 0x2801, WRAP_S: 0x2802, WRAP_T: 0x2803, WRAP_R: 0x8072, BASE_LEVEL: 0x813C, MAX_LEVEL: 0x813D, MIN_LOD: 0x813A, MAX_LOD: 0x813B,
  COMPARE_MODE: 0x884C, COMPARE_FUNC: 0x884D, COMPARE_REF_TO_TEXTURE: 0x884E, SWIZZLE_R: 0x8E42, SWIZZLE_G: 0x8E43, SWIZZLE_B: 0x8E44, SWIZZLE_A: 0x8E45,
  IMMUTABLE_FORMAT: 0x912F, IMMUTABLE_LEVELS: 0x82DF, MAX_ANISOTROPY: 0x84FE,
  RED: 0x1903, GREEN: 0x1904, BLUE: 0x1905, ALPHA: 0x1906, ZERO: 0, ONE: 1,
  NEVER: 0x0200, LESS: 0x0201, EQUAL: 0x0202, LEQUAL: 0x0203, GREATER: 0x0204, NOTEQUAL: 0x0205, GEQUAL: 0x0206, ALWAYS: 0x0207, NONE: 0,
};
export const SAMPLER_PARAMS = [T.MAG_FILTER, T.MIN_FILTER, T.WRAP_S, T.WRAP_T, T.WRAP_R, T.MIN_LOD, T.MAX_LOD, T.COMPARE_MODE, T.COMPARE_FUNC];
export const defaultSamplerParams = () => ({ [T.MAG_FILTER]: T.LINEAR, [T.MIN_FILTER]: T.NEAREST_MIPMAP_LINEAR, [T.WRAP_S]: T.REPEAT, [T.WRAP_T]: T.REPEAT, [T.WRAP_R]: T.REPEAT, [T.MIN_LOD]: -1000, [T.MAX_LOD]: 1000, [T.COMPARE_MODE]: T.NONE, [T.COMPARE_FUNC]: T.LEQUAL, [T.MAX_ANISOTROPY]: 1 });

export class Texture {
  constructor(target) {
    this.kind = 'texture'; this.target = target; this.faces = target === T.TEXTURE_CUBE_MAP ? 6 : 1; this.levels = []; this.version = 0; this.immutable = false; this.immutableLevels = 0; this.deleted = false;
    this.params = { ...defaultSamplerParams(), [T.BASE_LEVEL]: 0, [T.MAX_LEVEL]: 1000, [T.SWIZZLE_R]: T.RED, [T.SWIZZLE_G]: T.GREEN, [T.SWIZZLE_B]: T.BLUE, [T.SWIZZLE_A]: T.ALPHA };
  }
  image(level, face = 0) { return this.levels[level]?.[face] ?? null; }
  setImage(level, face, img) { (this.levels[level] ??= [])[face] = img; this.version++; }
  touch() { this.version++; }
  /** ES 3.0 3.8.13: { complete, base, q } with the levels a lookup may use; `params` are the effective sampler parameters. */
  completeness(params) {
    const p = this.params, baseRaw = p[T.BASE_LEVEL], base = this.immutable ? Math.min(baseRaw, this.immutableLevels - 1) : baseRaw;
    const img = this.image(base); if (!img || img.width <= 0 || img.height <= 0 || img.depth <= 0) return { complete: false };
    const fmt = img.fmt, minF = params[T.MIN_FILTER], magF = params[T.MAG_FILTER], mip = minF !== T.NEAREST && minF !== T.LINEAR;
    if (this.faces === 6) for (let f = 0; f < 6; f++) { const face = this.image(base, f); if (!face || face.width !== img.width || face.height !== img.height || face.width !== face.height || face.fmt.id !== fmt.id) return { complete: false }; }
    let q = base;
    if (mip) {
      const maxLevel = this.immutable ? Math.min(Math.max(base, p[T.MAX_LEVEL]), this.immutableLevels - 1) : p[T.MAX_LEVEL];
      const dims = this.target === T.TEXTURE_3D ? Math.max(img.width, img.height, img.depth) : Math.max(img.width, img.height);
      q = Math.min(base + Math.floor(Math.log2(dims)), maxLevel);
      for (let level = base + 1; level <= q; level++) {
        const k = level - base, w = Math.max(1, img.width >> k), h = Math.max(1, img.height >> k), d = this.target === T.TEXTURE_3D ? Math.max(1, img.depth >> k) : img.depth;
        for (let f = 0; f < this.faces; f++) { const li = this.image(level, f); if (!li || li.width !== w || li.height !== h || li.depth !== d || li.fmt.id !== fmt.id) return { complete: false }; }
      }
    }
    const integer = fmt.kind === 'int' || fmt.kind === 'uint';
    const nearestOnly = magF === T.NEAREST && (minF === T.NEAREST || minF === T.NEAREST_MIPMAP_NEAREST);
    if (integer && !nearestOnly) return { complete: false };
    if ((fmt.kind === 'depth' || fmt.kind === 'depthstencil') && params[T.COMPARE_MODE] === T.NONE && !nearestOnly) return { complete: false };
    if (fmt.kind === 'stencil') return { complete: false };
    return { complete: true, base, q, fmt, integer };
  }
}
/** A nearest / bilinear lookup in a byte image (RGBA8 store), adding weight x the result to R. */
function lookupU8(img, u, v, filter, wrapS, wrapT, weight, ox, oy, R) {
  const W = img.width, H = img.height, d = img.data, k = weight / 255;
  if (filter === T.NEAREST) {
    let i = Math.floor(u * W + ox), j = Math.floor(v * H + oy);
    i = wrapS === T.CLAMP_TO_EDGE ? (i < 0 ? 0 : i >= W ? W - 1 : i) : wrap(wrapS, i, W); j = wrapT === T.CLAMP_TO_EDGE ? (j < 0 ? 0 : j >= H ? H - 1 : j) : wrap(wrapT, j, H);
    const p = (j * W + i) * 4; R[0] += k * d[p]; R[1] += k * d[p + 1]; R[2] += k * d[p + 2]; R[3] += k * d[p + 3]; return;
  }
  const x = u * W - 0.5 + ox, y = v * H - 0.5 + oy, x0 = Math.floor(x), y0 = Math.floor(y), a = x - x0, b = y - y0;
  let i0, i1, j0, j1;
  if (wrapS === T.CLAMP_TO_EDGE) { i0 = x0 < 0 ? 0 : x0 >= W ? W - 1 : x0; i1 = x0 + 1 < 0 ? 0 : x0 + 1 >= W ? W - 1 : x0 + 1; } else { i0 = wrap(wrapS, x0, W); i1 = wrap(wrapS, x0 + 1, W); }
  if (wrapT === T.CLAMP_TO_EDGE) { j0 = y0 < 0 ? 0 : y0 >= H ? H - 1 : y0; j1 = y0 + 1 < 0 ? 0 : y0 + 1 >= H ? H - 1 : y0 + 1; } else { j0 = wrap(wrapT, y0, H); j1 = wrap(wrapT, y0 + 1, H); }
  const w00 = k * (1 - a) * (1 - b), w10 = k * a * (1 - b), w01 = k * (1 - a) * b, w11 = k * a * b;
  const p00 = (j0 * W + i0) * 4, p10 = (j0 * W + i1) * 4, p01 = (j1 * W + i0) * 4, p11 = (j1 * W + i1) * 4;
  R[0] += w00 * d[p00] + w10 * d[p10] + w01 * d[p01] + w11 * d[p11]; R[1] += w00 * d[p00 + 1] + w10 * d[p10 + 1] + w01 * d[p01 + 1] + w11 * d[p11 + 1];
  R[2] += w00 * d[p00 + 2] + w10 * d[p10 + 2] + w01 * d[p01 + 2] + w11 * d[p11 + 2]; R[3] += w00 * d[p00 + 3] + w10 * d[p10 + 3] + w01 * d[p01 + 3] + w11 * d[p11 + 3];
}
export class Sampler { constructor() { this.kind = 'sampler'; this.params = defaultSamplerParams(); this.version = 0; this.deleted = false; } }

// ---- lookups -------------------------------------------------------------------------------------------------------------------------------------------------------------------
const wrap = (mode, i, n) => {
  if (mode === T.REPEAT) { i %= n; return i < 0 ? i + n : i; }
  if (mode === T.MIRRORED_REPEAT) { const period = 2 * n; let m = i % period; if (m < 0) m += period; return m < n ? m : period - 1 - m; }
  return i < 0 ? 0 : i >= n ? n - 1 : i;
};
const COMPARE = {
  [T.LEQUAL]: (r, d) => (r <= d ? 1 : 0), [T.GEQUAL]: (r, d) => (r >= d ? 1 : 0), [T.LESS]: (r, d) => (r < d ? 1 : 0), [T.GREATER]: (r, d) => (r > d ? 1 : 0),
  [T.EQUAL]: (r, d) => (r === d ? 1 : 0), [T.NOTEQUAL]: (r, d) => (r !== d ? 1 : 0), [T.ALWAYS]: () => 1, [T.NEVER]: () => 0,
};
/**
 * The texture bound to a unit for one sampler kind (S2 / S3 / SC / SA in the generated code): what a draw's lookups read. update(texture, sampler) refreshes it when the
 * texture, its images or the sampler object changed.
 */
export class Unit {
  constructor(rt, target) { this.P = rt.P; this.R = rt.R; this.target = target; this.texture = null; this.sampler = null; this.key = ''; this.state = { complete: false }; this.tmp = new Float64Array(4); this.acc = new Float64Array(4); }
  update(texture, sampler) {
    const key = texture ? `${texture.version}/${sampler ? sampler.version : -1}` : 'none';
    if (texture === this.texture && sampler === this.sampler && key === this.key) return;
    this.texture = texture; this.sampler = sampler; this.key = key;
    if (!texture || texture.target !== this.target) { this.state = { complete: false }; return; }
    const params = sampler ? { ...texture.params, ...sampler.params } : texture.params;
    this.params = params; this.state = texture.completeness(params);
    if (!this.state.complete) return;
    const s = this.state; s.minF = params[T.MIN_FILTER]; s.magF = params[T.MAG_FILTER]; s.wrapS = params[T.WRAP_S]; s.wrapT = params[T.WRAP_T]; s.wrapR = params[T.WRAP_R];
    s.minLod = params[T.MIN_LOD]; s.maxLod = params[T.MAX_LOD]; s.compare = params[T.COMPARE_MODE] === T.COMPARE_REF_TO_TEXTURE && (s.fmt.kind === 'depth' || s.fmt.kind === 'depthstencil');
    s.compareFn = COMPARE[params[T.COMPARE_FUNC]] ?? COMPARE[T.LEQUAL];
    const sw = [texture.params[T.SWIZZLE_R], texture.params[T.SWIZZLE_G], texture.params[T.SWIZZLE_B], texture.params[T.SWIZZLE_A]];
    s.swizzle = sw.every((v, i) => v === [T.RED, T.GREEN, T.BLUE, T.ALPHA][i]) ? null : sw;
    s.images = []; for (let level = s.base; level <= s.q; level++) s.images.push(Array.from({ length: texture.faces }, (_, f) => texture.image(level, f)));
    // the common lookup (a 2D texture of bytes, no comparison, no swizzle) takes a path of its own
    s.fast = this.target === T.TEXTURE_2D && !s.compare && !s.swizzle && !s.integer && s.fmt.store === 'u8' && !s.fmt.srgb;
    s.mip = s.minF !== T.NEAREST && s.minF !== T.LINEAR; s.needLod = s.mip || s.minF !== s.magF;
    s.levels = s.images.map(faces => faces[0]);
  }
  incomplete() { const R = this.R; R[0] = 0; R[1] = 0; R[2] = 0; R[3] = 1; }
  size(lod) {
    const R = this.R, s = this.state; R[0] = R[1] = R[2] = 0;
    if (!this.texture) return;
    const base = this.texture.immutable ? Math.min(this.texture.params[T.BASE_LEVEL], this.texture.immutableLevels - 1) : this.texture.params[T.BASE_LEVEL];
    const img = this.texture.image(base + lod) ?? (s.complete ? null : null); if (!img) return;
    R[0] = img.width; R[1] = img.height; R[2] = img.depth;
  }
  /** One texel of level image `img` (face already chosen) as floats into out; depth formats compare against `ref` when comparing. */
  texel(img, i, j, k, out, ref) {
    const index = (k * img.height + j) * img.width + i, s = this.state;
    if (img.depthData) { const d = img.depthData[index]; if (s.compare) { const r = s.fmt.floatDepth ? ref : ref < 0 ? 0 : ref > 1 ? 1 : ref; out[0] = s.compareFn(r, d); } else out[0] = d; out[1] = 0; out[2] = 0; out[3] = 1; return; }
    const d = img.data, at = index * 4;
    if (img.fmt.store === 'u8') {
      if (img.fmt.srgb) { out[0] = srgbDecode[d[at]]; out[1] = srgbDecode[d[at + 1]]; out[2] = srgbDecode[d[at + 2]]; out[3] = d[at + 3] / 255; }
      else { out[0] = d[at] / 255; out[1] = d[at + 1] / 255; out[2] = d[at + 2] / 255; out[3] = d[at + 3] / 255; }
      return;
    }
    out[0] = d[at]; out[1] = d[at + 1]; out[2] = d[at + 2]; out[3] = d[at + 3];
  }
  /** Adds weight x texel (i, j, k) of `img` to acc (a byte image of a linear format straight from its bytes). */
  add(img, i, j, k, weight, ref) {
    const acc = this.acc;
    if (img.fmt.store === 'u8' && !img.fmt.srgb) {
      const d = img.data, at = ((k * img.height + j) * img.width + i) * 4, w = weight / 255;
      acc[0] += w * d[at]; acc[1] += w * d[at + 1]; acc[2] += w * d[at + 2]; acc[3] += w * d[at + 3]; return;
    }
    const t = this.tmp; this.texel(img, i, j, k, t, ref); acc[0] += weight * t[0]; acc[1] += weight * t[1]; acc[2] += weight * t[2]; acc[3] += weight * t[3];
  }
  /** Filters level image `img` at normalised (u, v, w) with `filter`, adding weight * result to acc. */
  filter(img, u, v, w, filter, weight, ref, threeD, layer) {
    const s = this.state, P = this.P, W = img.width, H = img.height, D = img.depth, offset = this.offset;
    const offX = offset ? P[12] : 0, offY = offset ? P[13] : 0, offZ = offset ? P[14] : 0;
    if (filter === T.NEAREST) {
      const i = wrap(s.wrapS, Math.floor(u * W + offX), W), j = wrap(s.wrapT, Math.floor(v * H + offY), H), k = threeD ? wrap(s.wrapR, Math.floor(w * D + offZ), D) : layer;
      this.add(img, i, j, k, weight, ref); return;
    }
    const x = u * W - 0.5 + offX, y = v * H - 0.5 + offY, x0 = Math.floor(x), y0 = Math.floor(y), a = x - x0, b = y - y0;
    const i0 = wrap(s.wrapS, x0, W), i1 = wrap(s.wrapS, x0 + 1, W), j0 = wrap(s.wrapT, y0, H), j1 = wrap(s.wrapT, y0 + 1, H);
    if (!threeD) {
      const w00 = weight * (1 - a) * (1 - b), w10 = weight * a * (1 - b), w01 = weight * (1 - a) * b, w11 = weight * a * b;
      if (img.fmt.store === 'u8' && !img.fmt.srgb) {   // the common case, without a call per corner
        const d = img.data, row0 = (layer * H + j0) * W, row1 = (layer * H + j1) * W, p00 = (row0 + i0) * 4, p10 = (row0 + i1) * 4, p01 = (row1 + i0) * 4, p11 = (row1 + i1) * 4, acc = this.acc, n = 1 / 255;
        acc[0] += (w00 * d[p00] + w10 * d[p10] + w01 * d[p01] + w11 * d[p11]) * n; acc[1] += (w00 * d[p00 + 1] + w10 * d[p10 + 1] + w01 * d[p01 + 1] + w11 * d[p11 + 1]) * n;
        acc[2] += (w00 * d[p00 + 2] + w10 * d[p10 + 2] + w01 * d[p01 + 2] + w11 * d[p11 + 2]) * n; acc[3] += (w00 * d[p00 + 3] + w10 * d[p10 + 3] + w01 * d[p01 + 3] + w11 * d[p11 + 3]) * n;
        return;
      }
      if (w00) this.add(img, i0, j0, layer, w00, ref); if (w10) this.add(img, i1, j0, layer, w10, ref); if (w01) this.add(img, i0, j1, layer, w01, ref); if (w11) this.add(img, i1, j1, layer, w11, ref);
      return;
    }
    const z = w * D - 0.5 + offZ, z0 = Math.floor(z), c = z - z0, k0 = wrap(s.wrapR, z0, D), k1 = wrap(s.wrapR, z0 + 1, D);
    for (let pass = 0; pass < 2; pass++) {
      const k = pass ? k1 : k0, cw = weight * (pass ? c : 1 - c); if (!cw) continue;
      this.add(img, i0, j0, k, cw * (1 - a) * (1 - b), ref); this.add(img, i1, j0, k, cw * a * (1 - b), ref); this.add(img, i0, j1, k, cw * (1 - a) * b, ref); this.add(img, i1, j1, k, cw * a * b, ref);
    }
  }
  /** sample() for a 2D byte texture without comparison or swizzle (s.fast). */
  sampleFast(mode) {
    const P = this.P, R = this.R, s = this.state, u = P[0], v = P[1], base = s.levels[0];
    let lambda = 0;
    if (s.needLod) {
      if (mode & MODE.LOD) lambda = P[11];
      else if (mode & MODE.GRAD) { const W = base.width, H = base.height, ax = P[4] * W, ay = P[5] * H, bx = P[7] * W, by = P[8] * H, rx = ax * ax + ay * ay, ry = bx * bx + by * by, rho2 = rx > ry ? rx : ry; lambda = rho2 > 0 ? 0.5 * Math.log2(rho2) : -Infinity; }
      if (mode & MODE.BIAS) lambda += P[10];
      if (lambda > s.maxLod) lambda = s.maxLod; if (lambda < s.minLod) lambda = s.minLod;
    }
    const off = (mode & MODE.OFFSET) !== 0, ox = off ? P[12] : 0, oy = off ? P[13] : 0;
    R[0] = R[1] = R[2] = R[3] = 0;
    if (!(lambda > 0)) { lookupU8(base, u, v, s.magF, s.wrapS, s.wrapT, 1, ox, oy, R); return; }
    const minF = s.minF;
    if (!s.mip) { lookupU8(base, u, v, minF, s.wrapS, s.wrapT, 1, ox, oy, R); return; }
    const levels = s.levels.length - 1, inner = minF === T.NEAREST_MIPMAP_NEAREST || minF === T.NEAREST_MIPMAP_LINEAR ? T.NEAREST : T.LINEAR;
    if (minF === T.NEAREST_MIPMAP_NEAREST || minF === T.LINEAR_MIPMAP_NEAREST) { const d = lambda <= 0.5 ? 0 : Math.min(levels, Math.ceil(lambda + 0.5) - 1); lookupU8(s.levels[d], u, v, inner, s.wrapS, s.wrapT, 1, ox, oy, R); return; }
    const d1 = Math.min(levels, Math.floor(lambda)), frac = lambda >= levels ? 0 : lambda - Math.floor(lambda);
    lookupU8(s.levels[d1], u, v, inner, s.wrapS, s.wrapT, 1 - frac, ox, oy, R);
    if (frac > 0) lookupU8(s.levels[Math.min(levels, d1 + 1)], u, v, inner, s.wrapS, s.wrapT, frac, ox, oy, R);
  }
  sample(mode) {
    const P = this.P, R = this.R, s = this.state;
    if (!s.complete) return this.incomplete();
    if (s.fast && !(mode & MODE.FETCH)) return this.sampleFast(mode);
    this.offset = (mode & MODE.OFFSET) !== 0;
    if (mode & MODE.FETCH) return this.fetch();
    const target = this.target, cube = target === T.TEXTURE_CUBE_MAP, threeD = target === T.TEXTURE_3D, array = target === T.TEXTURE_2D_ARRAY;
    let u = P[0], v = P[1], w = P[2], face = 0, layer = 0;
    const ref = P[3];
    let dux = P[4], dvx = P[5], dwx = P[6], duy = P[7], dvy = P[8], dwy = P[9];
    if (cube) {
      // ES 3.0 table 3.21: the face of the major axis, (s, t) on it
      const sel = (x, y, z) => { const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z); if (ax >= ay && ax >= az) return x >= 0 ? [0, -z, -y, ax] : [1, z, -y, ax]; if (ay >= az) return y >= 0 ? [2, x, z, ay] : [3, x, -z, ay]; return z >= 0 ? [4, x, -y, az] : [5, -x, -y, az]; };
      const [f, sc, tc, ma] = sel(u, v, w); face = f;
      const st = (x, y, z) => { const [f2, a, b, m] = sel(x, y, z); void f2; return [(a / m + 1) / 2, (b / m + 1) / 2]; };
      const fs = (a, b) => [(a / ma + 1) / 2, (b / ma + 1) / 2];
      const [cu, cv] = fs(sc, tc);
      if (mode & MODE.GRAD) {   // the face coordinates' derivatives, from the direction's
        const [xu, xv] = st(u + dux, v + dvx, w + dwx), [yu, yv] = st(u + duy, v + dvy, w + dwy);
        dux = xu - cu; dvx = xv - cv; duy = yu - cu; dvy = yv - cv; dwx = dwy = 0;
      }
      u = cu; v = cv; w = 0;
    } else if (array) { layer = Math.max(0, Math.min(s.images[0][0].depth - 1, Math.floor(w + 0.5))); }
    // level of detail
    let lambda;
    const baseImg = s.images[0][face];
    if (mode & MODE.LOD) lambda = P[11];
    else if (mode & MODE.GRAD) {
      const W = baseImg.width, H = baseImg.height, D = threeD ? baseImg.depth : 0;
      const rx = Math.sqrt((dux * W) ** 2 + (dvx * H) ** 2 + (threeD ? (dwx * D) ** 2 : 0)), ry = Math.sqrt((duy * W) ** 2 + (dvy * H) ** 2 + (threeD ? (dwy * D) ** 2 : 0));
      const rho = rx > ry ? rx : ry; lambda = rho > 0 ? Math.log2(rho) : -Infinity;
    } else lambda = 0;
    if (mode & MODE.BIAS) lambda += P[10];
    if (lambda > s.maxLod) lambda = s.maxLod; if (lambda < s.minLod) lambda = s.minLod;
    const acc = this.acc; acc[0] = acc[1] = acc[2] = acc[3] = 0;
    const levels = s.images.length - 1;
    if (lambda <= 0 || Number.isNaN(lambda)) this.filter(baseImg, u, v, w, s.magF, 1, ref, threeD, layer);
    else {
      const minF = s.minF;
      if (minF === T.NEAREST || minF === T.LINEAR) this.filter(baseImg, u, v, w, minF, 1, ref, threeD, layer);
      else {
        const inner = minF === T.NEAREST_MIPMAP_NEAREST || minF === T.NEAREST_MIPMAP_LINEAR ? T.NEAREST : T.LINEAR;
        if (minF === T.NEAREST_MIPMAP_NEAREST || minF === T.LINEAR_MIPMAP_NEAREST) {
          const d = lambda <= 0.5 ? 0 : Math.min(levels, Math.ceil(lambda + 0.5) - 1);
          this.filter(s.images[d][face], u, v, w, inner, 1, ref, threeD, layer);
        } else {
          const d1 = Math.min(levels, Math.floor(lambda)), d2 = Math.min(levels, d1 + 1), frac = lambda >= levels ? 0 : lambda - Math.floor(lambda);
          this.filter(s.images[d1][face], u, v, w, inner, 1 - frac, ref, threeD, layer);
          if (frac > 0) this.filter(s.images[d2][face], u, v, w, inner, frac, ref, threeD, layer);
        }
      }
    }
    this.finish(acc);
  }
  finish(acc) {
    const R = this.R, s = this.state;
    if (s.compare) { R[0] = acc[0]; R[1] = 0; R[2] = 0; R[3] = 1; return; }
    if (s.integer) { R[0] = Math.round(acc[0]); R[1] = Math.round(acc[1]); R[2] = Math.round(acc[2]); R[3] = Math.round(acc[3]); }
    else { R[0] = acc[0]; R[1] = acc[1]; R[2] = acc[2]; R[3] = acc[3]; }
    if (s.swizzle) { const v = [R[0], R[1], R[2], R[3]]; for (let i = 0; i < 4; i++) { const sw = s.swizzle[i]; R[i] = sw === T.ZERO ? 0 : sw === T.ONE ? 1 : v[sw - T.RED]; } }
  }
  /** texelFetch: integer coordinates of level base + lod, no filtering; out-of-range texels read zero (ES 3.0 leaves them undefined). */
  fetch() {
    const P = this.P, s = this.state, lod = P[11] | 0, acc = this.acc;
    const img = s.images[lod]?.[0];
    const i = (P[0] | 0) + (this.offset ? P[12] | 0 : 0), j = (P[1] | 0) + (this.offset ? P[13] | 0 : 0), k = this.target === T.TEXTURE_3D || this.target === T.TEXTURE_2D_ARRAY ? (P[2] | 0) + (this.offset && this.target === T.TEXTURE_3D ? P[14] | 0 : 0) : 0;
    if (!img || i < 0 || j < 0 || k < 0 || i >= img.width || j >= img.height || k >= img.depth) { acc[0] = acc[1] = acc[2] = 0; acc[3] = s.integer ? 0 : 0; return this.finish(acc); }
    this.texel(img, i, j, k, acc, 0); this.finish(acc);
  }
}
