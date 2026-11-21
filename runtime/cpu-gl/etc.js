// The compressed texture formats of OpenGL ES 3.0 (section 3.8.6, appendix C: ETC2 / EAC) and OES_compressed_ETC1_RGB8_texture, decoded on upload into the byte or float
// store of their uncompressed equivalents (src/cpu-gl/formats.js): 4x4 blocks of 64 bits (RGB, punch-through alpha, R11, and the alpha half of RGBA8) or 128 bits (RGBA8
// with EAC alpha, RG11). Written from the specification. No process.*.

export const ETC_FORMATS = {
  0x8D64: { name: 'ETC1_RGB8_OES', block: 8, kind: 'rgb' },   // an ETC2 decoder reads ETC1 (valid ETC1 never overflows a differential colour), as GPUs do
  0x9274: { name: 'COMPRESSED_RGB8_ETC2', block: 8, kind: 'rgb' }, 0x9275: { name: 'COMPRESSED_SRGB8_ETC2', block: 8, kind: 'rgb', srgb: true },
  0x9276: { name: 'COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2', block: 8, kind: 'punch' }, 0x9277: { name: 'COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2', block: 8, kind: 'punch', srgb: true },
  0x9278: { name: 'COMPRESSED_RGBA8_ETC2_EAC', block: 16, kind: 'rgba' }, 0x9279: { name: 'COMPRESSED_SRGB8_ALPHA8_ETC2_EAC', block: 16, kind: 'rgba', srgb: true },
  0x9270: { name: 'COMPRESSED_R11_EAC', block: 8, kind: 'r11' }, 0x9271: { name: 'COMPRESSED_SIGNED_R11_EAC', block: 8, kind: 'r11', signed: true },
  0x9272: { name: 'COMPRESSED_RG11_EAC', block: 16, kind: 'rg11' }, 0x9273: { name: 'COMPRESSED_SIGNED_RG11_EAC', block: 16, kind: 'rg11', signed: true },
};
export const compressedSize = (format, width, height, depth = 1) => Math.ceil(width / 4) * Math.ceil(height / 4) * depth * ETC_FORMATS[format].block;

const MODIFIERS = [[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]];
const DISTANCES = [3, 6, 11, 16, 23, 32, 41, 64];
const EAC = [[-3, -6, -9, -15, 2, 5, 8, 14], [-3, -7, -10, -13, 2, 6, 9, 12], [-2, -5, -8, -13, 1, 4, 7, 12], [-2, -4, -6, -13, 1, 3, 5, 12], [-3, -6, -8, -12, 2, 5, 7, 11], [-3, -7, -9, -11, 2, 6, 8, 10],
  [-4, -7, -8, -11, 3, 6, 7, 10], [-3, -5, -8, -11, 2, 4, 7, 10], [-2, -6, -8, -10, 1, 5, 7, 9], [-2, -5, -8, -10, 1, 4, 7, 9], [-2, -4, -8, -10, 1, 3, 7, 9], [-2, -5, -7, -10, 1, 4, 6, 9],
  [-3, -4, -7, -10, 2, 3, 6, 9], [-1, -2, -3, -10, 0, 1, 2, 9], [-4, -6, -8, -9, 3, 5, 7, 8], [-3, -5, -7, -9, 2, 4, 6, 8]];
const clamp255 = v => (v < 0 ? 0 : v > 255 ? 255 : v);
const ext4 = v => (v << 4) | v, ext5 = v => (v << 3) | (v >> 2), ext6 = v => (v << 2) | (v >> 4), ext7 = v => (v << 1) | (v >> 6);
/** The two 32-bit halves of a big-endian 64-bit block at `at`. */
const halves = (b, at) => [((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0, ((b[at + 4] << 24) | (b[at + 5] << 16) | (b[at + 6] << 8) | b[at + 7]) >>> 0];
const bitsHi = (hi, from, count) => (hi >>> (from - 32)) & ((1 << count) - 1);   // bits of the high word, numbered 63..32
/**
 * Decodes one RGB block (ETC1 / ETC2, with punch-through alpha when `punch`) into out (16 pixels x RGBA bytes, pixel (x, y) at (y * 4 + x) * 4).
 */
export function decodeRgbBlock(b, at, out, { punch = false } = {}) {
  const [hi, lo] = halves(b, at);
  const diff = (hi >>> 1) & 1, flip = hi & 1, opaque = punch ? diff : 1;
  const index = (x, y) => { const i = x * 4 + y; return (((lo >>> (16 + i)) & 1) << 1) | ((lo >>> i) & 1); };
  const put = (x, y, r, g, bl, a = 255) => { const o = (y * 4 + x) * 4; out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = a; };
  if (!punch && !diff) {   // individual mode
    const c = [[ext4(bitsHi(hi, 60, 4)), ext4(bitsHi(hi, 52, 4)), ext4(bitsHi(hi, 44, 4))], [ext4(bitsHi(hi, 56, 4)), ext4(bitsHi(hi, 48, 4)), ext4(bitsHi(hi, 40, 4))]];
    return etc1Pixels(hi, c, flip, index, put, false, true);
  }
  const r1 = bitsHi(hi, 59, 5), g1 = bitsHi(hi, 51, 5), b1 = bitsHi(hi, 43, 5);
  const dr = (bitsHi(hi, 56, 3) << 29) >> 29, dg = (bitsHi(hi, 48, 3) << 29) >> 29, db = (bitsHi(hi, 40, 3) << 29) >> 29;
  const r2 = r1 + dr, g2 = g1 + dg, b2 = b1 + db;
  if ((r2 >= 0 && r2 <= 31 && g2 >= 0 && g2 <= 31 && b2 >= 0 && b2 <= 31)) {   // differential mode
    const c = [[ext5(r1), ext5(g1), ext5(b1)], [ext5(r2 & 31), ext5(g2 & 31), ext5(b2 & 31)]];
    return etc1Pixels(hi, c, flip, index, put, punch && !opaque, opaque);
  }
  if (r2 < 0 || r2 > 31) {   // T mode
    const c1 = [ext4((bitsHi(hi, 59, 2) << 2) | bitsHi(hi, 56, 2)), ext4(bitsHi(hi, 52, 4)), ext4(bitsHi(hi, 48, 4))], c2 = [ext4(bitsHi(hi, 44, 4)), ext4(bitsHi(hi, 40, 4)), ext4(bitsHi(hi, 36, 4))];
    const d = DISTANCES[(bitsHi(hi, 34, 2) << 1) | (hi & 1)];
    const paint = [c1, c2.map(v => clamp255(v + d)), c2, c2.map(v => clamp255(v - d))];
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) { const i = index(x, y); if (!opaque && i === 2) put(x, y, 0, 0, 0, 0); else put(x, y, ...paint[i]); }
    return;
  }
  if (g2 < 0 || g2 > 31) {   // H mode
    const R1 = bitsHi(hi, 59, 4), G1 = (bitsHi(hi, 56, 3) << 1) | bitsHi(hi, 52, 1), B1 = (bitsHi(hi, 51, 1) << 3) | bitsHi(hi, 47, 3), R2 = bitsHi(hi, 43, 4), G2 = bitsHi(hi, 39, 4), B2 = bitsHi(hi, 35, 4);
    const c1 = [ext4(R1), ext4(G1), ext4(B1)], c2 = [ext4(R2), ext4(G2), ext4(B2)];
    const order = ((R1 << 8) | (G1 << 4) | B1) >= ((R2 << 8) | (G2 << 4) | B2) ? 1 : 0;
    const d = DISTANCES[(bitsHi(hi, 34, 1) << 2) | ((hi & 1) << 1) | order];
    const paint = [c1.map(v => clamp255(v + d)), c1.map(v => clamp255(v - d)), c2.map(v => clamp255(v + d)), c2.map(v => clamp255(v - d))];
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) { const i = index(x, y); if (!opaque && i === 2) put(x, y, 0, 0, 0, 0); else put(x, y, ...paint[i]); }
    return;
  }
  // planar mode
  const ro = ext6(bitsHi(hi, 57, 6)), go = ext7((bitsHi(hi, 56, 1) << 6) | bitsHi(hi, 49, 6)), bo = ext6((bitsHi(hi, 48, 1) << 5) | (bitsHi(hi, 43, 2) << 3) | bitsHi(hi, 39, 3));
  const rh = ext6((bitsHi(hi, 34, 5) << 1) | (hi & 1)), gh = ext7((lo >>> 25) & 127), bh = ext6((lo >>> 19) & 63), rv = ext6((lo >>> 13) & 63), gv = ext7((lo >>> 6) & 127), bv = ext6(lo & 63);
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) put(x, y, clamp255((x * (rh - ro) + y * (rv - ro) + 4 * ro + 2) >> 2), clamp255((x * (gh - go) + y * (gv - go) + 4 * go + 2) >> 2), clamp255((x * (bh - bo) + y * (bv - bo) + 4 * bo + 2) >> 2));
}
function etc1Pixels(hi, colors, flip, index, put, transparent2, opaque) {
  const t1 = (hi >>> 5) & 7, t2 = (hi >>> 2) & 7;
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
    const second = flip ? y >= 2 : x >= 2, [a, bb] = MODIFIERS[second ? t2 : t1], i = index(x, y), c = colors[second ? 1 : 0];
    if (transparent2 && i === 2) { put(x, y, 0, 0, 0, 0); continue; }
    const m = !opaque ? [0, bb, -a, -bb][i] : [a, bb, -a, -bb][i];
    put(x, y, clamp255(c[0] + m), clamp255(c[1] + m), clamp255(c[2] + m));
  }
}
/** An EAC block (64 bits) as 16 values: 8-bit alpha (`mode` 'alpha'), or 11-bit unsigned / signed normalised floats ('r11' / 'r11s'), pixel (x, y) at y * 4 + x. */
export function decodeEacBlock(b, at, out, mode) {
  const [hi, lo] = halves(b, at), base = hi >>> 24, mult = (hi >>> 20) & 15, table = EAC[(hi >>> 16) & 15];
  const bits = (BigInt(hi & 0xffff) << 32n) | BigInt(lo);
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
    const i = x * 4 + y, idx = Number((bits >> BigInt(45 - 3 * i)) & 7n), m = table[idx];
    if (mode === 'alpha') out[y * 4 + x] = clamp255(base + m * mult);
    else if (mode === 'r11') { const v = mult ? base * 8 + 4 + m * mult * 8 : base * 8 + 4 + m; out[y * 4 + x] = Math.min(2047, Math.max(0, v)) / 2047; }
    else { const sb = base > 127 ? base - 256 : base, s = sb === -128 ? -127 : sb, v = mult ? s * 8 + m * mult * 8 : s * 8 + m; out[y * 4 + x] = Math.min(1023, Math.max(-1023, v)) / 1023; }
  }
}
/** Decodes `width` x `height` (x depth) of a compressed format from `bytes` into the RGBA store of `img` at (x0, y0, z0). Returns false when `bytes` is too short. */
export function decodeInto(img, format, x0, y0, z0, width, height, depth, bytes) {
  const f = ETC_FORMATS[format], bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
  if (bytes.length < bw * bh * depth * f.block) return false;
  const rgb = new Uint8Array(64), alpha = new Uint8Array(16), r = new Float64Array(16), g = new Float64Array(16), W = img.width, H = img.height, d = img.data;
  let at = 0;
  for (let z = 0; z < depth; z++) for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++, at += f.block) {
    if (f.kind === 'rgb' || f.kind === 'punch') decodeRgbBlock(bytes, at, rgb, { punch: f.kind === 'punch' });
    else if (f.kind === 'rgba') { decodeEacBlock(bytes, at, alpha, 'alpha'); decodeRgbBlock(bytes, at + 8, rgb); }
    else if (f.kind === 'r11') decodeEacBlock(bytes, at, r, f.signed ? 'r11s' : 'r11');
    else { decodeEacBlock(bytes, at, r, f.signed ? 'r11s' : 'r11'); decodeEacBlock(bytes, at + 8, g, f.signed ? 'r11s' : 'r11'); }
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const px = bx * 4 + x, py = by * 4 + y; if (px >= width || py >= height) continue;
      const o = (((z0 + z) * H + y0 + py) * W + x0 + px) * 4, i = y * 4 + x;
      if (f.kind === 'r11') { d[o] = r[i]; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 1; continue; }
      if (f.kind === 'rg11') { d[o] = r[i]; d[o + 1] = g[i]; d[o + 2] = 0; d[o + 3] = 1; continue; }
      d[o] = rgb[i * 4]; d[o + 1] = rgb[i * 4 + 1]; d[o + 2] = rgb[i * 4 + 2]; d[o + 3] = f.kind === 'rgba' ? alpha[i] : rgb[i * 4 + 3];
    }
  }
  img.version++; return true;
}
