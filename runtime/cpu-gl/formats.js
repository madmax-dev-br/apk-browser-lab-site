// Image formats of the CPU OpenGL ES implementation (docs/OPENGL-ES-ON-CPU.md): the internal formats of ES 3.0 (tables 3.13 / 3.14 and the unsized ES 2.0 ones), how their texels
// are stored (RGBA bytes for normalized formats of up to 8 bits, RGBA floats for snorm / float / 10-bit ones, RGBA int32 / uint32 for integer ones, a float depth and a byte
// stencil plane), the pixel transfers between those and the client's format / type (glTexImage*, glReadPixels, ES 3.0 3.7 / 4.3.2) and the conversions of fragment colours to
// stored values (ES 3.0 2.1.6 fixed-point conversion, 4.1.8 sRGB). No process.*.

export const GLC = {
  BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, UNSIGNED_INT: 0x1405, FLOAT: 0x1406, HALF_FLOAT: 0x140B, HALF_FLOAT_OES: 0x8D61,
  UNSIGNED_SHORT_4_4_4_4: 0x8033, UNSIGNED_SHORT_5_5_5_1: 0x8034, UNSIGNED_SHORT_5_6_5: 0x8363, UNSIGNED_INT_2_10_10_10_REV: 0x8368, UNSIGNED_INT_10F_11F_11F_REV: 0x8C3B,
  UNSIGNED_INT_5_9_9_9_REV: 0x8C3E, UNSIGNED_INT_24_8: 0x84FA, FLOAT_32_UNSIGNED_INT_24_8_REV: 0x8DAD,
  ALPHA: 0x1906, RGB: 0x1907, RGBA: 0x1908, LUMINANCE: 0x1909, LUMINANCE_ALPHA: 0x190A, RED: 0x1903, RG: 0x8227, RED_INTEGER: 0x8D94, RG_INTEGER: 0x8228, RGB_INTEGER: 0x8D98, RGBA_INTEGER: 0x8D99,
  DEPTH_COMPONENT: 0x1902, DEPTH_STENCIL: 0x84F9, STENCIL_INDEX: 0x1901, STENCIL_INDEX8: 0x8D48,
};
const G = GLC;
// internal format -> { channels (which of R G B A L the base format has), kind, bits [r, g, b, a], store, renderable, filterable, base (the base internal format), srgb, ... }
const F = {};
const def = (id, name, props) => { F[id] = { id, name, depthBits: 0, stencilBits: 0, srgb: false, renderable: false, filterable: true, sized: true, ...props }; };
const color = (id, name, base, kind, bits, store, props = {}) => def(id, name, { base, kind, bits, store, channels: { [G.RED]: 'R', [G.RG]: 'RG', [G.RGB]: 'RGB', [G.RGBA]: 'RGBA', [G.LUMINANCE]: 'L', [G.ALPHA]: 'A', [G.LUMINANCE_ALPHA]: 'LA' }[base], ...props });
const RENDER = { renderable: true }, FLOATRENDER = { renderable: true, floatTarget: true }, INTEGER = { renderable: true, filterable: false };
color(0x8229, 'R8', G.RED, 'unorm', [8, 0, 0, 0], 'u8', RENDER); color(0x8F94, 'R8_SNORM', G.RED, 'snorm', [8, 0, 0, 0], 'f32'); color(0x822D, 'R16F', G.RED, 'float', [16, 0, 0, 0], 'f32', { ...FLOATRENDER, half: true });
color(0x822E, 'R32F', G.RED, 'float', [32, 0, 0, 0], 'f32', FLOATRENDER); color(0x8232, 'R8UI', G.RED, 'uint', [8, 0, 0, 0], 'u32', INTEGER); color(0x8231, 'R8I', G.RED, 'int', [8, 0, 0, 0], 'i32', INTEGER);
color(0x8234, 'R16UI', G.RED, 'uint', [16, 0, 0, 0], 'u32', INTEGER); color(0x8233, 'R16I', G.RED, 'int', [16, 0, 0, 0], 'i32', INTEGER); color(0x8236, 'R32UI', G.RED, 'uint', [32, 0, 0, 0], 'u32', INTEGER); color(0x8235, 'R32I', G.RED, 'int', [32, 0, 0, 0], 'i32', INTEGER);
color(0x822B, 'RG8', G.RG, 'unorm', [8, 8, 0, 0], 'u8', RENDER); color(0x8F95, 'RG8_SNORM', G.RG, 'snorm', [8, 8, 0, 0], 'f32'); color(0x822F, 'RG16F', G.RG, 'float', [16, 16, 0, 0], 'f32', { ...FLOATRENDER, half: true });
color(0x8230, 'RG32F', G.RG, 'float', [32, 32, 0, 0], 'f32', FLOATRENDER); color(0x8238, 'RG8UI', G.RG, 'uint', [8, 8, 0, 0], 'u32', INTEGER); color(0x8237, 'RG8I', G.RG, 'int', [8, 8, 0, 0], 'i32', INTEGER);
color(0x823A, 'RG16UI', G.RG, 'uint', [16, 16, 0, 0], 'u32', INTEGER); color(0x8239, 'RG16I', G.RG, 'int', [16, 16, 0, 0], 'i32', INTEGER); color(0x823C, 'RG32UI', G.RG, 'uint', [32, 32, 0, 0], 'u32', INTEGER); color(0x823B, 'RG32I', G.RG, 'int', [32, 32, 0, 0], 'i32', INTEGER);
color(0x8051, 'RGB8', G.RGB, 'unorm', [8, 8, 8, 0], 'u8', RENDER); color(0x8C41, 'SRGB8', G.RGB, 'unorm', [8, 8, 8, 0], 'u8', { srgb: true }); color(0x8D62, 'RGB565', G.RGB, 'unorm', [5, 6, 5, 0], 'u8', RENDER);
color(0x8F96, 'RGB8_SNORM', G.RGB, 'snorm', [8, 8, 8, 0], 'f32'); color(0x8C3A, 'R11F_G11F_B10F', G.RGB, 'float', [11, 11, 10, 0], 'f32', { ...FLOATRENDER, half: true }); color(0x8C3D, 'RGB9_E5', G.RGB, 'float', [9, 9, 9, 0], 'f32', { half: true });
color(0x881B, 'RGB16F', G.RGB, 'float', [16, 16, 16, 0], 'f32', { half: true }); color(0x8815, 'RGB32F', G.RGB, 'float', [32, 32, 32, 0], 'f32'); color(0x8D7D, 'RGB8UI', G.RGB, 'uint', [8, 8, 8, 0], 'u32', { filterable: false });
color(0x8D8F, 'RGB8I', G.RGB, 'int', [8, 8, 8, 0], 'i32', { filterable: false }); color(0x8D77, 'RGB16UI', G.RGB, 'uint', [16, 16, 16, 0], 'u32', { filterable: false }); color(0x8D89, 'RGB16I', G.RGB, 'int', [16, 16, 16, 0], 'i32', { filterable: false });
color(0x8D71, 'RGB32UI', G.RGB, 'uint', [32, 32, 32, 0], 'u32', { filterable: false }); color(0x8D83, 'RGB32I', G.RGB, 'int', [32, 32, 32, 0], 'i32', { filterable: false });
color(0x8058, 'RGBA8', G.RGBA, 'unorm', [8, 8, 8, 8], 'u8', RENDER); color(0x8C43, 'SRGB8_ALPHA8', G.RGBA, 'unorm', [8, 8, 8, 8], 'u8', { ...RENDER, srgb: true }); color(0x8F97, 'RGBA8_SNORM', G.RGBA, 'snorm', [8, 8, 8, 8], 'f32');
color(0x8057, 'RGB5_A1', G.RGBA, 'unorm', [5, 5, 5, 1], 'u8', RENDER); color(0x8056, 'RGBA4', G.RGBA, 'unorm', [4, 4, 4, 4], 'u8', RENDER); color(0x8059, 'RGB10_A2', G.RGBA, 'unorm', [10, 10, 10, 2], 'f32', RENDER);
color(0x881A, 'RGBA16F', G.RGBA, 'float', [16, 16, 16, 16], 'f32', { ...FLOATRENDER, half: true }); color(0x8814, 'RGBA32F', G.RGBA, 'float', [32, 32, 32, 32], 'f32', FLOATRENDER);
color(0x8D7C, 'RGBA8UI', G.RGBA, 'uint', [8, 8, 8, 8], 'u32', INTEGER); color(0x8D8E, 'RGBA8I', G.RGBA, 'int', [8, 8, 8, 8], 'i32', INTEGER); color(0x906F, 'RGB10_A2UI', G.RGBA, 'uint', [10, 10, 10, 2], 'u32', INTEGER);
color(0x8D76, 'RGBA16UI', G.RGBA, 'uint', [16, 16, 16, 16], 'u32', INTEGER); color(0x8D88, 'RGBA16I', G.RGBA, 'int', [16, 16, 16, 16], 'i32', INTEGER); color(0x8D70, 'RGBA32UI', G.RGBA, 'uint', [32, 32, 32, 32], 'u32', INTEGER);
color(0x8D82, 'RGBA32I', G.RGBA, 'int', [32, 32, 32, 32], 'i32', INTEGER);
// unsized (ES 2.0) formats keep their base format as internal format; their effective sized format depends on the type
color(G.RGBA, 'RGBA', G.RGBA, 'unorm', [8, 8, 8, 8], 'u8', { ...RENDER, sized: false }); color(G.RGB, 'RGB', G.RGB, 'unorm', [8, 8, 8, 0], 'u8', { ...RENDER, sized: false });
color(G.LUMINANCE_ALPHA, 'LUMINANCE_ALPHA', G.LUMINANCE_ALPHA, 'unorm', [0, 0, 0, 8], 'u8', { sized: false, lbits: 8 }); color(G.LUMINANCE, 'LUMINANCE', G.LUMINANCE, 'unorm', [0, 0, 0, 0], 'u8', { sized: false, lbits: 8 });
color(G.ALPHA, 'ALPHA', G.ALPHA, 'unorm', [0, 0, 0, 8], 'u8', { sized: false });
// float variants of the unsized formats (OES_texture_float / OES_texture_half_float semantics through ES 3.0's table 3.2 effective formats)
def(0x10001, 'RGBA32F_UNSIZED', { ...F[0x8814], sized: false, base: G.RGBA }); def(0x10002, 'RGB32F_UNSIZED', { ...F[0x8815], sized: false, base: G.RGB });
// depth and stencil
def(0x81A5, 'DEPTH_COMPONENT16', { base: G.DEPTH_COMPONENT, kind: 'depth', depthBits: 16, store: 'depth', renderable: true, bits: [0, 0, 0, 0], channels: 'D' });
def(0x81A6, 'DEPTH_COMPONENT24', { base: G.DEPTH_COMPONENT, kind: 'depth', depthBits: 24, store: 'depth', renderable: true, bits: [0, 0, 0, 0], channels: 'D' });
def(0x8CAC, 'DEPTH_COMPONENT32F', { base: G.DEPTH_COMPONENT, kind: 'depth', depthBits: 32, store: 'depth', renderable: true, bits: [0, 0, 0, 0], channels: 'D', floatDepth: true });
def(0x88F0, 'DEPTH24_STENCIL8', { base: G.DEPTH_STENCIL, kind: 'depthstencil', depthBits: 24, stencilBits: 8, store: 'depthstencil', renderable: true, bits: [0, 0, 0, 0], channels: 'DS' });
def(0x8CAD, 'DEPTH32F_STENCIL8', { base: G.DEPTH_STENCIL, kind: 'depthstencil', depthBits: 32, stencilBits: 8, store: 'depthstencil', renderable: true, bits: [0, 0, 0, 0], channels: 'DS', floatDepth: true });
def(G.STENCIL_INDEX8, 'STENCIL_INDEX8', { base: G.STENCIL_INDEX, kind: 'stencil', stencilBits: 8, store: 'stencil', renderable: true, bits: [0, 0, 0, 0], channels: 'S', filterable: false });
def(G.DEPTH_COMPONENT, 'DEPTH_COMPONENT', { ...F[0x81A5], sized: false, id: G.DEPTH_COMPONENT });
def(G.DEPTH_STENCIL, 'DEPTH_STENCIL', { ...F[0x88F0], sized: false, id: G.DEPTH_STENCIL });
// compressed formats (ES 3.0 table 3.19, OES_compressed_ETC1_RGB8_texture): decoded on upload (src/cpu-gl/etc.js) into the store of their uncompressed equivalent
for (const [id, name, base, store, channels, bits, extra] of [
  [0x8D64, 'ETC1_RGB8_OES', G.RGB, 'u8', 'RGB', [8, 8, 8, 0], {}], [0x9274, 'COMPRESSED_RGB8_ETC2', G.RGB, 'u8', 'RGB', [8, 8, 8, 0], {}], [0x9275, 'COMPRESSED_SRGB8_ETC2', G.RGB, 'u8', 'RGB', [8, 8, 8, 0], { srgb: true }],
  [0x9276, 'COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2', G.RGBA, 'u8', 'RGBA', [8, 8, 8, 1], {}], [0x9277, 'COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2', G.RGBA, 'u8', 'RGBA', [8, 8, 8, 1], { srgb: true }],
  [0x9278, 'COMPRESSED_RGBA8_ETC2_EAC', G.RGBA, 'u8', 'RGBA', [8, 8, 8, 8], {}], [0x9279, 'COMPRESSED_SRGB8_ALPHA8_ETC2_EAC', G.RGBA, 'u8', 'RGBA', [8, 8, 8, 8], { srgb: true }],
  [0x9270, 'COMPRESSED_R11_EAC', G.RED, 'f32', 'R', [11, 0, 0, 0], { kind: 'unorm' }], [0x9271, 'COMPRESSED_SIGNED_R11_EAC', G.RED, 'f32', 'R', [11, 0, 0, 0], { kind: 'snorm' }],
  [0x9272, 'COMPRESSED_RG11_EAC', G.RG, 'f32', 'RG', [11, 11, 0, 0], { kind: 'unorm' }], [0x9273, 'COMPRESSED_SIGNED_RG11_EAC', G.RG, 'f32', 'RG', [11, 11, 0, 0], { kind: 'snorm' }],
]) def(id, name, { base, kind: 'unorm', store, channels, bits, compressed: true, renderable: false, ...extra });
export const COMPRESSED_FORMATS = Object.freeze([0x9274, 0x9275, 0x9276, 0x9277, 0x9278, 0x9279, 0x9270, 0x9271, 0x9272, 0x9273, 0x8D64]);
export const FORMATS = F;
/** The format of an internal format, resolving the unsized formats by their type (ES 3.0 table 3.2). */
export function formatOf(internal, type = G.UNSIGNED_BYTE) {
  if (internal === G.RGBA) return type === G.UNSIGNED_SHORT_4_4_4_4 ? F[0x8056] : type === G.UNSIGNED_SHORT_5_5_5_1 ? F[0x8057] : type === G.FLOAT ? { ...F[0x8814], id: G.RGBA, sized: false } : type === G.HALF_FLOAT || type === G.HALF_FLOAT_OES ? { ...F[0x881A], id: G.RGBA, sized: false } : F[G.RGBA];
  if (internal === G.RGB) return type === G.UNSIGNED_SHORT_5_6_5 ? { ...F[0x8D62], id: G.RGB, sized: false } : type === G.FLOAT ? { ...F[0x8815], id: G.RGB, sized: false } : type === G.HALF_FLOAT || type === G.HALF_FLOAT_OES ? { ...F[0x881B], id: G.RGB, sized: false } : F[G.RGB];
  if ((internal === G.LUMINANCE || internal === G.ALPHA || internal === G.LUMINANCE_ALPHA) && (type === G.FLOAT || type === G.HALF_FLOAT || type === G.HALF_FLOAT_OES)) return { ...F[internal], kind: 'float', store: 'f32', half: type !== G.FLOAT };
  if (internal === G.DEPTH_COMPONENT) return type === G.UNSIGNED_INT ? { ...F[0x81A6], id: G.DEPTH_COMPONENT, sized: false } : type === G.FLOAT ? { ...F[0x8CAC], id: G.DEPTH_COMPONENT, sized: false } : F[G.DEPTH_COMPONENT];
  return F[internal] ?? null;
}

// ---- half floats and packed floats ----------------------------------------------------------------------------------------------------------------------------------------
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function toHalf(v) {
  f32[0] = v; const x = u32[0], sign = (x >>> 16) & 0x8000; let e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (((x >>> 23) & 0xff) === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) { if (e < -10) return sign; m |= 0x800000; const shift = 14 - e; let h = m >> shift; const rem = m & ((1 << shift) - 1), half = 1 << (shift - 1); if (rem > half || (rem === half && (h & 1))) h++; return sign | h; }
  let h = sign | (e << 10) | (m >> 13); const rem = m & 0x1fff; if (rem > 0x1000 || (rem === 0x1000 && (h & 1))) h++; return h;
}
export function fromHalf(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24; if (e === 31) return m ? NaN : s * Infinity; return s * (1 + m / 1024) * 2 ** (e - 15);
}
const roundHalf = v => fromHalf(toHalf(v));
/** An unsigned float with `mbits` of mantissa and 5 of exponent (R11F_G11F_B10F): the value it stores. */
function packedFloat(v, mbits) {
  if (!(v > 0)) return 0; if (v === Infinity) return Infinity;
  const e = Math.max(-14, Math.floor(Math.log2(v))); if (e > 15) return 65024 * (mbits === 6 ? 1 : 1);
  const scale = 2 ** (e - mbits); return Math.round(v / scale) * scale;
}
function unpack11(bits) { const e = (bits >> 6) & 0x1f, m = bits & 0x3f; return e === 0 ? m / 64 * 2 ** -14 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 64) * 2 ** (e - 15); }
function unpack10(bits) { const e = (bits >> 5) & 0x1f, m = bits & 0x1f; return e === 0 ? m / 32 * 2 ** -14 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 32) * 2 ** (e - 15); }
function pack11(v, mbits) {
  if (!(v > 0)) return 0; if (v === Infinity) return 31 << mbits;
  let e = Math.floor(Math.log2(v)); if (e < -14) { return Math.min((1 << mbits) - 1, Math.round(v / 2 ** -14 * (1 << mbits))); }
  if (e > 15) return (30 << mbits) | ((1 << mbits) - 1);
  let m = Math.round((v / 2 ** e - 1) * (1 << mbits)); if (m === 1 << mbits) { m = 0; e++; if (e > 15) return (30 << mbits) | ((1 << mbits) - 1); }
  return ((e + 15) << mbits) | m;
}
const SRGB_DECODE = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; SRGB_DECODE[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export const srgbDecode = SRGB_DECODE;
export function srgbEncode(l) { if (!(l > 0)) return 0; if (l >= 1) return 1; return l < 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055; }

// ---- images -------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** One image of a texture level / face, or a renderbuffer: width x height x depth texels of `fmt`. */
export class Image {
  constructor(fmt, width, height, depth = 1, samples = 0) {
    this.fmt = fmt; this.width = width; this.height = height; this.depth = depth; this.samples = samples; this.version = 0;
    const n = Math.max(0, width * height * depth);
    if (fmt.store === 'u8') { this.data = new Uint8Array(n * 4); this.fillDefault(); }
    else if (fmt.store === 'f32') { this.data = new Float32Array(n * 4); this.fillDefault(); }
    else if (fmt.store === 'i32') this.data = new Int32Array(n * 4);
    else if (fmt.store === 'u32') this.data = new Uint32Array(n * 4);
    else { this.data = null; if (fmt.store === 'depth' || fmt.store === 'depthstencil') this.depthData = new Float32Array(n); if (fmt.store === 'stencil' || fmt.store === 'depthstencil') this.stencil = new Uint8Array(n); }
  }
  /** Alpha (and absent channels' defaults) of a fresh image: zero colour, alpha 1 for formats without alpha (what a read of the stored value gives). */
  fillDefault() { const ch = this.fmt.channels; if (!ch.includes('A') || ch === 'L') { const one = this.fmt.store === 'u8' ? 255 : 1; for (let i = 3; i < this.data.length; i += 4) this.data[i] = one; } }
}
/** Channel defaults by base format: the RGBA a texel of the base format reads as (ES 3.0 table 3.24). */
export function expand(ch, r, g, b, a, out) {
  switch (ch) {
    case 'R': out[0] = r; out[1] = 0; out[2] = 0; out[3] = 1; return; case 'RG': out[0] = r; out[1] = g; out[2] = 0; out[3] = 1; return;
    case 'RGB': out[0] = r; out[1] = g; out[2] = b; out[3] = 1; return; case 'L': out[0] = out[1] = out[2] = r; out[3] = 1; return;
    case 'A': out[0] = out[1] = out[2] = 0; out[3] = a; return; case 'LA': out[0] = out[1] = out[2] = r; out[3] = a; return;
    default: out[0] = r; out[1] = g; out[2] = b; out[3] = a;
  }
}
/** Quantises a colour channel of `bits` to what the format stores, as a value in its store (byte for u8, float otherwise). */
export function makeColorWriter(fmt) {
  const [rb, gb, bb, ab] = fmt.bits, ch = fmt.channels;
  if (fmt.store === 'u8') {
    const q = bits => bits === 8 || bits === 0 ? null : bits;   // bits < 8: round to `bits`, then expand to a byte (what the format stores reads back as)
    const conv = (bits) => { const k = q(bits); if (!k) return c => (c <= 0 ? 0 : c >= 1 ? 255 : (c * 255 + 0.5) | 0); const max = (1 << k) - 1; return c => { const v = c <= 0 ? 0 : c >= 1 ? max : (c * max + 0.5) | 0; return ((v * 255) / max + 0.5) | 0; }; };
    const cr = conv(rb || 8), cg = conv(gb || 8), cb = conv(bb || 8), ca = conv(ab || 8);
    const hasA = ch.includes('A'), hasG = ch === 'RG' || ch === 'RGB' || ch === 'RGBA', hasB = ch === 'RGB' || ch === 'RGBA';
    if (fmt.srgb) return (d, i, r, g, b, a) => { d[i] = cr(srgbEncode(r)); d[i + 1] = cg(srgbEncode(g)); d[i + 2] = cb(srgbEncode(b)); d[i + 3] = hasA ? ca(a) : 255; };
    return (d, i, r, g, b, a) => { d[i] = cr(r); d[i + 1] = hasG ? cg(g) : 0; d[i + 2] = hasB ? cb(b) : 0; d[i + 3] = hasA ? ca(a) : 255; };
  }
  if (fmt.store === 'f32') {
    const hasA = ch.includes('A'), hasG = ch === 'RG' || ch === 'RGB' || ch === 'RGBA', hasB = ch === 'RGB' || ch === 'RGBA';
    if (fmt.kind === 'snorm') { const s = c => Math.round((c < -1 ? -1 : c > 1 ? 1 : c) * 127) / 127; return (d, i, r, g, b, a) => { d[i] = s(r); d[i + 1] = hasG ? s(g) : 0; d[i + 2] = hasB ? s(b) : 0; d[i + 3] = hasA ? s(a) : 1; }; }
    if (fmt.kind === 'unorm') { const u = bits => { const max = (1 << bits) - 1; return c => Math.round((c < 0 ? 0 : c > 1 ? 1 : c) * max) / max; }; const cr = u(rb), cg = u(gb), cb = u(bb), ca = u(ab); return (d, i, r, g, b, a) => { d[i] = cr(r); d[i + 1] = cg(g); d[i + 2] = cb(b); d[i + 3] = ca(a); }; }
    if (fmt.name === 'R11F_G11F_B10F') return (d, i, r, g, b) => { d[i] = packedFloat(r, 6); d[i + 1] = packedFloat(g, 6); d[i + 2] = packedFloat(b, 5); d[i + 3] = 1; };
    const round = fmt.half ? roundHalf : Math.fround;
    return (d, i, r, g, b, a) => { d[i] = round(r); d[i + 1] = hasG ? round(g) : 0; d[i + 2] = hasB ? round(b) : 0; d[i + 3] = hasA ? round(a) : 1; };
  }
  // integer formats: the value modulo the channel's width (what the store keeps)
  const signed = fmt.kind === 'int', wrap = bits => bits >= 32 ? (signed ? v => v | 0 : v => v >>> 0) : signed ? v => (v << (32 - bits)) >> (32 - bits) : v => v & ((1 << bits) - 1);
  const wr = wrap(rb), wg = wrap(gb || 32), wb = wrap(bb || 32), wa = wrap(ab || 32);
  const hasA = ch.includes('A'), hasG = ch === 'RG' || ch === 'RGB' || ch === 'RGBA', hasB = ch === 'RGB' || ch === 'RGBA';
  return (d, i, r, g, b, a) => { d[i] = wr(r); d[i + 1] = hasG ? wg(g) : 0; d[i + 2] = hasB ? wb(b) : 0; d[i + 3] = hasA ? wa(a) : 1; };
}
/** Reads a stored texel as floats (normalised for u8, sRGB decoded), RGBA. */
export function readTexel(img, index, out) {
  const d = img.data, i = index * 4;
  if (img.fmt.store === 'u8') { if (img.fmt.srgb) { out[0] = SRGB_DECODE[d[i]]; out[1] = SRGB_DECODE[d[i + 1]]; out[2] = SRGB_DECODE[d[i + 2]]; out[3] = d[i + 3] / 255; } else { out[0] = d[i] / 255; out[1] = d[i + 1] / 255; out[2] = d[i + 2] / 255; out[3] = d[i + 3] / 255; } return; }
  if (d) { out[0] = d[i]; out[1] = d[i + 1]; out[2] = d[i + 2]; out[3] = d[i + 3]; return; }
  out[0] = img.depthData ? img.depthData[index] : 0; out[1] = 0; out[2] = 0; out[3] = 1;
}

// ---- pixel transfers ----------------------------------------------------------------------------------------------------------------------------------------------------------
const COMPONENTS = { [G.RGBA]: 4, [G.RGB]: 3, [G.RG]: 2, [G.RED]: 1, [G.ALPHA]: 1, [G.LUMINANCE]: 1, [G.LUMINANCE_ALPHA]: 2, [G.RGBA_INTEGER]: 4, [G.RGB_INTEGER]: 3, [G.RG_INTEGER]: 2, [G.RED_INTEGER]: 1, [G.DEPTH_COMPONENT]: 1, [G.DEPTH_STENCIL]: 2, [G.STENCIL_INDEX]: 1 };
const TYPE_BYTES = { [G.BYTE]: 1, [G.UNSIGNED_BYTE]: 1, [G.SHORT]: 2, [G.UNSIGNED_SHORT]: 2, [G.INT]: 4, [G.UNSIGNED_INT]: 4, [G.FLOAT]: 4, [G.HALF_FLOAT]: 2, [G.HALF_FLOAT_OES]: 2 };
const PACKED_BYTES = { [G.UNSIGNED_SHORT_4_4_4_4]: 2, [G.UNSIGNED_SHORT_5_5_5_1]: 2, [G.UNSIGNED_SHORT_5_6_5]: 2, [G.UNSIGNED_INT_2_10_10_10_REV]: 4, [G.UNSIGNED_INT_10F_11F_11F_REV]: 4, [G.UNSIGNED_INT_5_9_9_9_REV]: 4, [G.UNSIGNED_INT_24_8]: 4, [G.FLOAT_32_UNSIGNED_INT_24_8_REV]: 8 };
export function pixelBytes(format, type) { return PACKED_BYTES[type] ?? (COMPONENTS[format] ?? 4) * (TYPE_BYTES[type] ?? 1); }
export const isKnownType = type => TYPE_BYTES[type] !== undefined || PACKED_BYTES[type] !== undefined;
export const isKnownFormat = format => COMPONENTS[format] !== undefined;
/** Byte layout of a client image under the pixel-store state: { stride (row bytes), imageStride, start (byte offset of the first pixel), bpp, size (bytes covered) }. */
export function clientLayout(width, height, depth, format, type, store) {
  const bpp = pixelBytes(format, type), align = store.alignment || 4, rowLength = store.rowLength || width, imageHeight = store.imageHeight || height;
  const stride = Math.ceil(rowLength * bpp / align) * align, imageStride = stride * imageHeight;
  const start = (store.skipImages || 0) * imageStride + (store.skipRows || 0) * stride + (store.skipPixels || 0) * bpp;
  const size = width <= 0 || height <= 0 || depth <= 0 ? 0 : start + (depth - 1) * imageStride + (height - 1) * stride + width * bpp;
  return { stride, imageStride, start, bpp, size };
}
/** A decoder of one client pixel: (view, byteOffset, out[4]) -> sets RGBA (floats for normalised / float types, integers for integer formats); depth / stencil in out[0] / out[1]. */
function pixelReader(format, type) {
  const n = COMPONENTS[format], integer = format === G.RGBA_INTEGER || format === G.RGB_INTEGER || format === G.RG_INTEGER || format === G.RED_INTEGER;
  const order = { [G.RGBA]: [0, 1, 2, 3], [G.RGB]: [0, 1, 2], [G.RG]: [0, 1], [G.RED]: [0], [G.ALPHA]: [3], [G.LUMINANCE]: [0], [G.LUMINANCE_ALPHA]: [0, 3], [G.RGBA_INTEGER]: [0, 1, 2, 3], [G.RGB_INTEGER]: [0, 1, 2], [G.RG_INTEGER]: [0, 1], [G.RED_INTEGER]: [0] }[format];
  switch (type) {
    case G.UNSIGNED_SHORT_5_6_5: return (v, o, out) => { const x = v.getUint16(o, true); out[0] = (x >> 11) / 31; out[1] = ((x >> 5) & 63) / 63; out[2] = (x & 31) / 31; out[3] = 1; };
    case G.UNSIGNED_SHORT_4_4_4_4: return (v, o, out) => { const x = v.getUint16(o, true); out[0] = (x >> 12) / 15; out[1] = ((x >> 8) & 15) / 15; out[2] = ((x >> 4) & 15) / 15; out[3] = (x & 15) / 15; };
    case G.UNSIGNED_SHORT_5_5_5_1: return (v, o, out) => { const x = v.getUint16(o, true); out[0] = (x >> 11) / 31; out[1] = ((x >> 6) & 31) / 31; out[2] = ((x >> 1) & 31) / 31; out[3] = x & 1; };
    case G.UNSIGNED_INT_2_10_10_10_REV: return integer ? (v, o, out) => { const x = v.getUint32(o, true); out[0] = x & 1023; out[1] = (x >>> 10) & 1023; out[2] = (x >>> 20) & 1023; out[3] = x >>> 30; } : (v, o, out) => { const x = v.getUint32(o, true); out[0] = (x & 1023) / 1023; out[1] = ((x >>> 10) & 1023) / 1023; out[2] = ((x >>> 20) & 1023) / 1023; out[3] = (x >>> 30) / 3; };
    case G.UNSIGNED_INT_10F_11F_11F_REV: return (v, o, out) => { const x = v.getUint32(o, true); out[0] = unpack11(x & 0x7ff); out[1] = unpack11((x >>> 11) & 0x7ff); out[2] = unpack10(x >>> 22); out[3] = 1; };
    case G.UNSIGNED_INT_5_9_9_9_REV: return (v, o, out) => { const x = v.getUint32(o, true), e = 2 ** ((x >>> 27) - 15 - 9); out[0] = (x & 511) * e; out[1] = ((x >>> 9) & 511) * e; out[2] = ((x >>> 18) & 511) * e; out[3] = 1; };
    case G.UNSIGNED_INT_24_8: return (v, o, out) => { const x = v.getUint32(o, true); out[0] = (x >>> 8) / 16777215; out[1] = x & 255; };
    case G.FLOAT_32_UNSIGNED_INT_24_8_REV: return (v, o, out) => { out[0] = v.getFloat32(o, true); out[1] = v.getUint32(o + 4, true) & 255; };
  }
  if (format === G.DEPTH_COMPONENT) return type === G.UNSIGNED_SHORT ? (v, o, out) => { out[0] = v.getUint16(o, true) / 65535; } : type === G.UNSIGNED_INT ? (v, o, out) => { out[0] = v.getUint32(o, true) / 4294967295; } : (v, o, out) => { out[0] = v.getFloat32(o, true); };
  if (format === G.STENCIL_INDEX) return (v, o, out) => { out[1] = v.getUint8(o); };
  const size = TYPE_BYTES[type];
  const get = {
    [G.UNSIGNED_BYTE]: integer ? (v, o) => v.getUint8(o) : (v, o) => v.getUint8(o) / 255, [G.BYTE]: integer ? (v, o) => v.getInt8(o) : (v, o) => Math.max(-1, v.getInt8(o) / 127),
    [G.UNSIGNED_SHORT]: integer ? (v, o) => v.getUint16(o, true) : (v, o) => v.getUint16(o, true) / 65535, [G.SHORT]: integer ? (v, o) => v.getInt16(o, true) : (v, o) => Math.max(-1, v.getInt16(o, true) / 32767),
    [G.UNSIGNED_INT]: integer ? (v, o) => v.getUint32(o, true) : (v, o) => v.getUint32(o, true) / 4294967295, [G.INT]: integer ? (v, o) => v.getInt32(o, true) : (v, o) => Math.max(-1, v.getInt32(o, true) / 2147483647),
    [G.FLOAT]: (v, o) => v.getFloat32(o, true), [G.HALF_FLOAT]: (v, o) => fromHalf(v.getUint16(o, true)), [G.HALF_FLOAT_OES]: (v, o) => fromHalf(v.getUint16(o, true)),
  }[type];
  if (!get || !order) return null;
  return (v, o, out) => { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = integer ? 1 : 1; for (let k = 0; k < n; k++) out[order[k]] = get(v, o + k * size); if (format === G.LUMINANCE || format === G.LUMINANCE_ALPHA) { out[1] = out[2] = out[0]; } };
}
/**
 * Copies a client image into `img` at (x, y, z): `bytes` (Uint8Array view of the client memory, starting where the GL pointer points), the client `format` / `type` and the
 * unpack state. Normalised colours are quantised as the format stores them.
 */
export function unpackInto(img, x, y, z, width, height, depth, format, type, bytes, store) {
  const layout = clientLayout(width, height, depth, format, type, store), fmt = img.fmt;
  if (bytes.length < layout.size) return false;
  const W = img.width, H = img.height;
  // fast path: RGBA bytes into a byte store of an RGBA8 format
  if (fmt.store === 'u8' && format === G.RGBA && type === G.UNSIGNED_BYTE && fmt.bits[0] === 8 && fmt.channels === 'RGBA' && !fmt.srgb) {
    for (let k = 0; k < depth; k++) for (let row = 0; row < height; row++) { const src = layout.start + k * layout.imageStride + row * layout.stride; img.data.set(bytes.subarray(src, src + width * 4), (((z + k) * H + y + row) * W + x) * 4); }
    img.version++; return true;
  }
  if (fmt.store === 'u8' && fmt.srgb && format === G.RGBA && type === G.UNSIGNED_BYTE) {
    for (let k = 0; k < depth; k++) for (let row = 0; row < height; row++) { const src = layout.start + k * layout.imageStride + row * layout.stride; img.data.set(bytes.subarray(src, src + width * 4), (((z + k) * H + y + row) * W + x) * 4); }
    img.version++; return true;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), read = pixelReader(format, type);
  if (!read) return false;
  const px = new Float64Array(4), rgba = new Float64Array(4);
  if (fmt.store === 'depth' || fmt.store === 'depthstencil' || fmt.store === 'stencil') {
    for (let k = 0; k < depth; k++) for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      px[0] = 0; px[1] = 0; read(view, layout.start + k * layout.imageStride + row * layout.stride + col * layout.bpp, px);
      const at = ((z + k) * H + y + row) * W + x + col;
      if (img.depthData && format !== G.STENCIL_INDEX) img.depthData[at] = quantizeDepth(fmt, px[0]); if (img.stencil && (format === G.DEPTH_STENCIL || format === G.STENCIL_INDEX)) img.stencil[at] = px[1] & 255;
    }
    img.version++; return true;
  }
  const write = makeColorWriter(fmt), ch = fmt.channels, srgbBytes = fmt.srgb && fmt.store === 'u8';
  for (let k = 0; k < depth; k++) for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    read(view, layout.start + k * layout.imageStride + row * layout.stride + col * layout.bpp, px);
    expand(ch, px[0], px[1], px[2], px[3], rgba);
    const at = (((z + k) * H + y + row) * W + x + col) * 4;
    if (srgbBytes) { img.data[at] = Math.round(rgba[0] * 255); img.data[at + 1] = Math.round(rgba[1] * 255); img.data[at + 2] = Math.round(rgba[2] * 255); img.data[at + 3] = ch.includes('A') ? Math.round(rgba[3] * 255) : 255; }
    else write(img.data, at, rgba[0], rgba[1], rgba[2], rgba[3]);
  }
  img.version++; return true;
}
export function quantizeDepth(fmt, d) { const c = d < 0 ? 0 : d > 1 ? 1 : d; if (fmt.floatDepth) return Math.fround(d < 0 ? 0 : d > 1 ? 1 : d); const max = fmt.depthBits === 16 ? 65535 : 16777215; return Math.fround(Math.round(c * max) / max); }   // the value the float store keeps, so tests compare like with like
/** A writer of one client pixel for glReadPixels: (view, byteOffset, rgba floats or ints). */
function pixelWriter(format, type) {
  const integer = format === G.RGBA_INTEGER || format === G.RGB_INTEGER || format === G.RG_INTEGER || format === G.RED_INTEGER, n = COMPONENTS[format];
  const order = { [G.RGBA]: [0, 1, 2, 3], [G.RGB]: [0, 1, 2], [G.RG]: [0, 1], [G.RED]: [0], [G.ALPHA]: [3], [G.LUMINANCE]: [0], [G.LUMINANCE_ALPHA]: [0, 3], [G.RGBA_INTEGER]: [0, 1, 2, 3], [G.RGB_INTEGER]: [0, 1, 2], [G.RG_INTEGER]: [0, 1], [G.RED_INTEGER]: [0] }[format];
  const clamp = c => (c <= 0 ? 0 : c >= 1 ? 1 : c), unorm = (c, max) => Math.round(clamp(c) * max), snorm = (c, max) => Math.round((c < -1 ? -1 : c > 1 ? 1 : c) * max);
  switch (type) {
    case G.UNSIGNED_SHORT_5_6_5: return (v, o, p) => v.setUint16(o, (unorm(p[0], 31) << 11) | (unorm(p[1], 63) << 5) | unorm(p[2], 31), true);
    case G.UNSIGNED_SHORT_4_4_4_4: return (v, o, p) => v.setUint16(o, (unorm(p[0], 15) << 12) | (unorm(p[1], 15) << 8) | (unorm(p[2], 15) << 4) | unorm(p[3], 15), true);
    case G.UNSIGNED_SHORT_5_5_5_1: return (v, o, p) => v.setUint16(o, (unorm(p[0], 31) << 11) | (unorm(p[1], 31) << 6) | (unorm(p[2], 31) << 1) | unorm(p[3], 1), true);
    case G.UNSIGNED_INT_2_10_10_10_REV: return integer ? (v, o, p) => v.setUint32(o, ((p[0] & 1023) | ((p[1] & 1023) << 10) | ((p[2] & 1023) << 20) | ((p[3] & 3) << 30)) >>> 0, true) : (v, o, p) => v.setUint32(o, (unorm(p[0], 1023) | (unorm(p[1], 1023) << 10) | (unorm(p[2], 1023) << 20) | (unorm(p[3], 3) << 30)) >>> 0, true);
    case G.UNSIGNED_INT_10F_11F_11F_REV: return (v, o, p) => v.setUint32(o, (pack11(p[0], 6) | (pack11(p[1], 6) << 11) | (pack11(p[2], 5) << 22)) >>> 0, true);
  }
  const size = TYPE_BYTES[type];
  const set = {
    [G.UNSIGNED_BYTE]: integer ? (v, o, c) => v.setUint8(o, c & 255) : (v, o, c) => v.setUint8(o, unorm(c, 255)), [G.BYTE]: integer ? (v, o, c) => v.setInt8(o, c) : (v, o, c) => v.setInt8(o, snorm(c, 127)),
    [G.UNSIGNED_SHORT]: integer ? (v, o, c) => v.setUint16(o, c, true) : (v, o, c) => v.setUint16(o, unorm(c, 65535), true), [G.SHORT]: integer ? (v, o, c) => v.setInt16(o, c, true) : (v, o, c) => v.setInt16(o, snorm(c, 32767), true),
    [G.UNSIGNED_INT]: integer ? (v, o, c) => v.setUint32(o, c >>> 0, true) : (v, o, c) => v.setUint32(o, unorm(c, 4294967295), true), [G.INT]: integer ? (v, o, c) => v.setInt32(o, c | 0, true) : (v, o, c) => v.setInt32(o, snorm(c, 2147483647), true),
    [G.FLOAT]: (v, o, c) => v.setFloat32(o, c, true), [G.HALF_FLOAT]: (v, o, c) => v.setUint16(o, toHalf(c), true), [G.HALF_FLOAT_OES]: (v, o, c) => v.setUint16(o, toHalf(c), true),
  }[type];
  if (!set || !order) return null;
  return (v, o, p) => { for (let k = 0; k < n; k++) set(v, o + k * size, format === G.LUMINANCE_ALPHA && k === 0 || format === G.LUMINANCE ? p[0] : p[order[k]]); };
}
/** glReadPixels from a colour image: the rectangle (x, y, w, h) into `bytes` under the pack state (pixels outside the image are left as they are, ES 3.0 4.3.2). */
export function packFrom(img, layer, x, y, width, height, format, type, bytes, store) {
  const layout = clientLayout(width, height, 1, format, type, store); if (bytes.length < layout.size) return false;
  const W = img.width, H = img.height, base = layer * W * H, fmt = img.fmt;
  if (fmt.store === 'u8' && format === G.RGBA && type === G.UNSIGNED_BYTE && !fmt.srgb) {
    for (let row = 0; row < height; row++) {
      const sy = y + row; if (sy < 0 || sy >= H) continue;
      const x0 = Math.max(0, x), x1 = Math.min(W, x + width); if (x1 <= x0) continue;
      bytes.set(img.data.subarray((base + sy * W + x0) * 4, (base + sy * W + x1) * 4), layout.start + row * layout.stride + (x0 - x) * 4);
    }
    return true;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), write = pixelWriter(format, type); if (!write) return false;
  const px = new Float64Array(4);
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const sx = x + col, sy = y + row; if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
    const at = base + sy * W + sx;
    if (fmt.store === 'u8') { const d = img.data, i = at * 4; if (fmt.srgb) { px[0] = d[i] / 255; px[1] = d[i + 1] / 255; px[2] = d[i + 2] / 255; } else { px[0] = d[i] / 255; px[1] = d[i + 1] / 255; px[2] = d[i + 2] / 255; } px[3] = d[i + 3] / 255; }
    else if (img.data) { const i = at * 4; px[0] = img.data[i]; px[1] = img.data[i + 1]; px[2] = img.data[i + 2]; px[3] = img.data[i + 3]; }
    else { px[0] = img.depthData?.[at] ?? 0; px[1] = img.stencil?.[at] ?? 0; }
    write(view, layout.start + row * layout.stride + col * layout.bpp, px);
  }
  return true;
}
/** The client format / type pairs glReadPixels accepts for a buffer of this format (ES 3.0 4.3.2: RGBA / UNSIGNED_BYTE, RGBA_INTEGER, RGBA / FLOAT, plus the implementation's pair). */
export function readFormatAllowed(fmt, format, type) {
  if (fmt.kind === 'int') return format === G.RGBA_INTEGER && type === G.INT || readPreferred(fmt).format === format && readPreferred(fmt).type === type;
  if (fmt.kind === 'uint') return format === G.RGBA_INTEGER && type === G.UNSIGNED_INT || readPreferred(fmt).format === format && readPreferred(fmt).type === type;
  if (fmt.kind === 'float' || fmt.kind === 'snorm') return format === G.RGBA && type === G.FLOAT || readPreferred(fmt).format === format && readPreferred(fmt).type === type;
  if (fmt.name === 'RGB10_A2') return format === G.RGBA && (type === G.UNSIGNED_BYTE || type === G.UNSIGNED_INT_2_10_10_10_REV);
  return format === G.RGBA && type === G.UNSIGNED_BYTE || readPreferred(fmt).format === format && readPreferred(fmt).type === type;
}
/** GL_IMPLEMENTATION_COLOR_READ_FORMAT / _TYPE for a buffer of this format. */
export function readPreferred(fmt) {
  if (fmt.kind === 'int' || fmt.kind === 'uint') return { format: fmt.channels === 'R' ? G.RED_INTEGER : fmt.channels === 'RG' ? G.RG_INTEGER : G.RGBA_INTEGER, type: fmt.kind === 'int' ? G.INT : G.UNSIGNED_INT };
  if (fmt.kind === 'float') return { format: fmt.channels === 'R' ? G.RED : fmt.channels === 'RG' ? G.RG : G.RGBA, type: fmt.half ? G.HALF_FLOAT : G.FLOAT };
  if (fmt.name === 'RGB565') return { format: G.RGB, type: G.UNSIGNED_SHORT_5_6_5 };
  if (fmt.channels === 'RGB') return { format: G.RGB, type: G.UNSIGNED_BYTE };
  return { format: G.RGBA, type: G.UNSIGNED_BYTE };
}
/** Which internal formats a client format / type may be uploaded to (ES 3.0 table 3.2, plus the unsized combinations of ES 2.0). */
export function uploadAllowed(internal, format, type) {
  const fmt = F[internal]; if (!fmt) return false;
  if (!fmt.sized) {
    if (internal !== format) return false;
    if (internal === G.RGBA) return [G.UNSIGNED_BYTE, G.UNSIGNED_SHORT_4_4_4_4, G.UNSIGNED_SHORT_5_5_5_1, G.FLOAT, G.HALF_FLOAT, G.HALF_FLOAT_OES].includes(type);
    if (internal === G.RGB) return [G.UNSIGNED_BYTE, G.UNSIGNED_SHORT_5_6_5, G.FLOAT, G.HALF_FLOAT, G.HALF_FLOAT_OES].includes(type);
    if (internal === G.LUMINANCE || internal === G.ALPHA || internal === G.LUMINANCE_ALPHA) return [G.UNSIGNED_BYTE, G.FLOAT, G.HALF_FLOAT, G.HALF_FLOAT_OES].includes(type);
    if (internal === G.DEPTH_COMPONENT) return type === G.UNSIGNED_SHORT || type === G.UNSIGNED_INT;
    if (internal === G.DEPTH_STENCIL) return type === G.UNSIGNED_INT_24_8;
    return false;
  }
  const base = fmt.base, integer = fmt.kind === 'int' || fmt.kind === 'uint';
  const expectFormat = fmt.kind === 'depth' ? G.DEPTH_COMPONENT : fmt.kind === 'depthstencil' ? G.DEPTH_STENCIL : integer ? { [G.RED]: G.RED_INTEGER, [G.RG]: G.RG_INTEGER, [G.RGB]: G.RGB_INTEGER, [G.RGBA]: G.RGBA_INTEGER }[base] : base;
  if (format !== expectFormat) return false;
  const T = {
    R8: [G.UNSIGNED_BYTE], R8_SNORM: [G.BYTE], R16F: [G.HALF_FLOAT, G.FLOAT], R32F: [G.FLOAT], R8UI: [G.UNSIGNED_BYTE], R8I: [G.BYTE], R16UI: [G.UNSIGNED_SHORT], R16I: [G.SHORT], R32UI: [G.UNSIGNED_INT], R32I: [G.INT],
    RG8: [G.UNSIGNED_BYTE], RG8_SNORM: [G.BYTE], RG16F: [G.HALF_FLOAT, G.FLOAT], RG32F: [G.FLOAT], RG8UI: [G.UNSIGNED_BYTE], RG8I: [G.BYTE], RG16UI: [G.UNSIGNED_SHORT], RG16I: [G.SHORT], RG32UI: [G.UNSIGNED_INT], RG32I: [G.INT],
    RGB8: [G.UNSIGNED_BYTE], SRGB8: [G.UNSIGNED_BYTE], RGB565: [G.UNSIGNED_BYTE, G.UNSIGNED_SHORT_5_6_5], RGB8_SNORM: [G.BYTE], R11F_G11F_B10F: [G.UNSIGNED_INT_10F_11F_11F_REV, G.HALF_FLOAT, G.FLOAT],
    RGB9_E5: [G.UNSIGNED_INT_5_9_9_9_REV, G.HALF_FLOAT, G.FLOAT], RGB16F: [G.HALF_FLOAT, G.FLOAT], RGB32F: [G.FLOAT], RGB8UI: [G.UNSIGNED_BYTE], RGB8I: [G.BYTE], RGB16UI: [G.UNSIGNED_SHORT], RGB16I: [G.SHORT], RGB32UI: [G.UNSIGNED_INT], RGB32I: [G.INT],
    RGBA8: [G.UNSIGNED_BYTE], SRGB8_ALPHA8: [G.UNSIGNED_BYTE], RGBA8_SNORM: [G.BYTE], RGB5_A1: [G.UNSIGNED_BYTE, G.UNSIGNED_SHORT_5_5_5_1, G.UNSIGNED_INT_2_10_10_10_REV], RGBA4: [G.UNSIGNED_BYTE, G.UNSIGNED_SHORT_4_4_4_4],
    RGB10_A2: [G.UNSIGNED_INT_2_10_10_10_REV], RGBA16F: [G.HALF_FLOAT, G.FLOAT], RGBA32F: [G.FLOAT], RGBA8UI: [G.UNSIGNED_BYTE], RGBA8I: [G.BYTE], RGB10_A2UI: [G.UNSIGNED_INT_2_10_10_10_REV], RGBA16UI: [G.UNSIGNED_SHORT],
    RGBA16I: [G.SHORT], RGBA32I: [G.INT], RGBA32UI: [G.UNSIGNED_INT], DEPTH_COMPONENT16: [G.UNSIGNED_SHORT, G.UNSIGNED_INT], DEPTH_COMPONENT24: [G.UNSIGNED_INT], DEPTH_COMPONENT32F: [G.FLOAT],
    DEPTH24_STENCIL8: [G.UNSIGNED_INT_24_8], DEPTH32F_STENCIL8: [G.FLOAT_32_UNSIGNED_INT_24_8_REV],
  }[fmt.name];
  return !!T && T.includes(type === G.HALF_FLOAT_OES ? G.HALF_FLOAT : type);
}
