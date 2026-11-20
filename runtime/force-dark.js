// Force dark (Android 10+): what HWUI does to a window whose ViewRootImpl turned it on (night mode, a light theme with android:forceDarkAllowed). Pure colour math and the
// rules that pick it, ported from android-13.0.0_r1:
//  - libs/hwui/CanvasTransform.cpp: makeLight / makeDark (invert the CIE Lab lightness, L' = min(110 - L, 100), when that moves the colour the right way), transformColor and
//    transformColorInverse, applyColorTransform (the paint colour, the colours of a linear gradient of at most 10 stops, the colour of a blend-mode colour filter), the bitmap path
//    transformPaint(transform, paint, palette) (a bitmap whose palette is light drawn in a "dark" node, or dark in a "light" one, gets SkHighContrastFilter's lightness inversion
//    composed after its paint's colour filter; its paint colour is left alone);
//  - libs/hwui/utils/Color.cpp sRGBToLab / LabToSRGB (D50 Lab through Bradford adaptation, frameworks/native libs/ui ColorSpace::sRGB(), float arithmetic, the result truncated to
//    8 bits);
//  - libs/hwui/hwui/Bitmap.cpp Bitmap::computePalette and libs/hwui/VectorDrawable.cpp Tree::computePalette (HSV of up to 100 sampled pixels, or of every path's fill colour);
//  - external/skia src/effects/SkHighContrastFilter.cpp (kInvertLightness: HSL lightness inverted in linear, unpremultiplied sRGB);
//  - libs/hwui/RenderNode.cpp RenderNode::handleForceDark (a node's usage: text makes it foreground; an unknown node with more than one child node, or one child that is not a
//    background, is a background; the crude overlap check makes a child that contains everything drawn after it a background) and RecordingCanvas.cpp's per-op transforms.
// Transforms are named 'light' (ColorTransform::Light: foreground, made lighter) and 'dark' (ColorTransform::Dark: background, made darker); null is ColorTransform::None.
const f = Math.fround;

// ---- frameworks/native libs/ui ColorSpace::sRGB() ----------------------------------------------------------------------------------------------------------------------------------
// primaries {0.640, 0.330} {0.300, 0.600} {0.150, 0.060}, white point {0.3127, 0.3290}, TransferParameters {g 2.4, a 1/1.055, b 0.055/1.055, c 1/12.92, d 0.04045, e 0, f 0}
const P = { g: f(2.4), a: f(1 / 1.055), b: f(f(0.055) / f(1.055)), c: f(1 / 12.92), d: f(0.04045) };
/** ColorSpace.cpp response (EOTF, e = f = 0): x >= d ? pow(a x + b, g) : c x. */
const eotf = x => x >= P.d ? f(Math.pow(f(f(P.a * x) + P.b), P.g)) : f(P.c * x);
/** ColorSpace.cpp rcpResponse (OETF, e = f = 0): x >= d c ? (pow(x, 1/g) - b) / a : x / c. */
const oetf = x => x >= f(P.d * P.c) ? f(f(f(Math.pow(x, f(1 / P.g))) - P.b) / P.a) : f(x / P.c);
const saturate = x => x < 0 ? 0 : x > 1 ? 1 : x;
// mat3 helpers, column-major as android's math library stores them: m[column][row]
const mulMV = (m, v) => [0, 1, 2].map(row => f(f(f(f(m[0][row] * v[0]) + f(m[1][row] * v[1]))) + f(m[2][row] * v[2])));
const mulMM = (a, b) => [0, 1, 2].map(col => mulMV(a, b[col]));
function inverse3(m) {
  // TMatHelpers fastInverse3: cofactors over the column-major elements, divided by the determinant
  const a = m[0][0], b = m[1][0], c = m[2][0], d = m[0][1], e = m[1][1], g = m[2][1], h = m[0][2], i = m[1][2], j = m[2][2];
  const A = f(f(e * j) - f(g * i)), B = f(f(g * h) - f(d * j)), C = f(f(d * i) - f(e * h));
  const D = f(f(c * i) - f(b * j)), E = f(f(a * j) - f(c * h)), F = f(f(b * h) - f(a * i));
  const G = f(f(b * g) - f(c * e)), H = f(f(c * d) - f(a * g)), I = f(f(a * e) - f(b * d));
  const det = f(f(f(a * A) + f(b * B)) + f(c * C));
  return [[f(A / det), f(B / det), f(C / det)], [f(D / det), f(E / det), f(F / det)], [f(G / det), f(H / det), f(I / det)]];
}
function computeXYZMatrix(R, G, B, W) {
  const oneRxRy = f(f(1 - R[0]) / R[1]), oneGxGy = f(f(1 - G[0]) / G[1]), oneBxBy = f(f(1 - B[0]) / B[1]), oneWxWy = f(f(1 - W[0]) / W[1]);
  const RxRy = f(R[0] / R[1]), GxGy = f(G[0] / G[1]), BxBy = f(B[0] / B[1]), WxWy = f(W[0] / W[1]);
  const BY = f(f(f(f(oneWxWy - oneRxRy) * f(GxGy - RxRy)) - f(f(WxWy - RxRy) * f(oneGxGy - oneRxRy))) / f(f(f(oneBxBy - oneRxRy) * f(GxGy - RxRy)) - f(f(BxBy - RxRy) * f(oneGxGy - oneRxRy))));
  const GY = f(f(f(WxWy - RxRy) - f(BY * f(BxBy - RxRy))) / f(GxGy - RxRy)), RY = f(f(1 - GY) - BY);
  const RYRy = f(RY / R[1]), GYGy = f(GY / G[1]), BYBy = f(BY / B[1]);
  return [[f(RYRy * R[0]), RY, f(RYRy * f(f(1 - R[0]) - R[1]))], [f(GYGy * G[0]), GY, f(GYGy * f(f(1 - G[0]) - G[1]))], [f(BYBy * B[0]), BY, f(BYBy * f(f(1 - B[0]) - B[1]))]];
}
const fl = v => v.map(f);
const RGB_TO_XYZ = computeXYZMatrix(fl([0.640, 0.330]), fl([0.300, 0.600]), fl([0.150, 0.060]), fl([0.3127, 0.3290]));
const XYZ_TO_RGB = inverse3(RGB_TO_XYZ);
// ColorSpace::computeWhitePoint is what getWhitePoint returns for a colour space built from primaries: the white point it was given
const WHITE = fl([0.3127, 0.3290]);
/** ColorSpace::XYZ(float3{xy, 1}). */
const SRGB_WHITE_XYZ = [f(f(WHITE[0] * 1) / WHITE[1]), 1, f(f(f(f(1 - WHITE[0]) - WHITE[1]) * 1) / WHITE[1])];
// ---- libs/hwui/utils/Color.cpp ------------------------------------------------------------------------------------------------------------------------------------------------------
const D50 = fl([0.964212, 1.0, 0.825188]);
const BRADFORD = [fl([0.8951, -0.7502, 0.0389]), fl([0.2664, 1.7135, -0.0685]), fl([-0.1614, 0.0367, 1.0296])];
function adaptation(matrix, srcWhite, dstWhite) {
  const src = mulMV(matrix, srcWhite), dst = mulMV(matrix, dstWhite), diagonal = [[f(dst[0] / src[0]), 0, 0], [0, f(dst[1] / src[1]), 0], [0, 0, f(dst[2] / src[2])]];
  return mulMM(mulMM(inverse3(matrix), diagonal), matrix);
}
const TO_D50 = adaptation(BRADFORD, SRGB_WHITE_XYZ, D50), FROM_D50 = adaptation(BRADFORD, D50, SRGB_WHITE_XYZ);
const LA = f(216 / 24389), LB = f(841 / 108), LC = f(4 / 29), LD = f(6 / 29), THIRD = f(1 / 3);
const clampTo = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
/** sRGBToLab: the SkColor's 8-bit channels / 255 through the sRGB EOTF and RGB -> XYZ, adapted to D50, to CIE Lab (each component clamped: L to 0..100, a and b to -128..128). */
export function sRGBToLab(color) {
  const rgb = [(color >>> 16) & 255, (color >>> 8) & 255, color & 255].map(c => f(c / 255));
  const xyz = mulMV(TO_D50, mulMV(RGB_TO_XYZ, rgb.map(eotf)));
  const X = f(xyz[0] / D50[0]), Y = f(xyz[1] / D50[1]), Z = f(xyz[2] / D50[2]);
  const cube = t => t > LA ? f(Math.pow(t, THIRD)) : f(f(LB * t) + LC);
  const fx = cube(X), fy = cube(Y), fz = cube(Z);
  return { L: clampTo(f(f(116 * fy) - 16), 0, 100), a: clampTo(f(500 * f(fx - fy)), -128, 128), b: clampTo(f(200 * f(fy - fz)), -128, 128) };
}
/** LabToSRGB: Lab (clamped) -> D50 XYZ -> sRGB XYZ (Bradford) -> sRGB, each channel saturated and truncated to 8 bits (static_cast<uint8_t>(c * 255)); `alpha` kept. */
export function labToSRGB({ L, a, b }, alpha) {
  const l = clampTo(f(L), 0, 100), aa = clampTo(f(a), -128, 128), bb = clampTo(f(b), -128, 128);
  const fy = f(f(l + 16) / 116), fx = f(fy + f(aa * f(0.002))), fz = f(fy - f(bb * f(0.005)));
  const inv = t => t > LD ? f(f(t * t) * t) : f(f(1 / LB) * f(t - LC));
  const xyz = mulMV(FROM_D50, [f(inv(fx) * D50[0]), f(inv(fy) * D50[1]), f(inv(fz) * D50[2])]);
  const rgb = mulMV(XYZ_TO_RGB, xyz).map(c => saturate(oetf(c)));
  return ((alpha & 255) << 24 | Math.trunc(f(rgb[0] * 255)) << 16 | Math.trunc(f(rgb[1] * 255)) << 8 | Math.trunc(f(rgb[2] * 255))) >>> 0;
}
// ---- libs/hwui/CanvasTransform.cpp --------------------------------------------------------------------------------------------------------------------------------------------------
/** makeLight: the colour with its Lab lightness inverted (min(110 - L, 100)) when that makes it lighter, else unchanged. */
export function makeLight(color) {
  const lab = sRGBToLab(color), inverted = Math.min(f(110 - lab.L), 100);
  return inverted > lab.L ? labToSRGB({ ...lab, L: inverted }, color >>> 24) : color >>> 0;
}
/** makeDark: the colour with its Lab lightness inverted when that makes it darker, else unchanged. */
export function makeDark(color) {
  const lab = sRGBToLab(color), inverted = Math.min(f(110 - lab.L), 100);
  return inverted < lab.L ? labToSRGB({ ...lab, L: inverted }, color >>> 24) : color >>> 0;
}
export const transformColor = (transform, color) => transform === 'light' ? makeLight(color) : transform === 'dark' ? makeDark(color) : color >>> 0;
/** transformColorInverse: what DrawRippleDrawable takes (a ripple contrasts with its background). */
export const transformColorInverse = (transform, color) => transform === 'dark' ? makeLight(color) : transform === 'light' ? makeDark(color) : color >>> 0;
/**
 * applyColorTransform on a recorded paint description (src/paint-host.js getSolidPaint: `argb`, `color`, `shader`, `colorFilterSnapshot`): a new description with the paint colour
 * transformed, the stops of a linear gradient of at most 10 colours transformed (SkShader::asAGradient; radial, sweep and composed shaders are left alone), and the colour of a
 * blend-mode colour filter (SkColorFilter::asAColorMode) transformed. The recorded description is never changed (a display list replays it again, and keys it).
 */
export function transformPaint(transform, paint) {
  if (!transform || !paint) return paint;
  const out = { ...paint, argb: transformColor(transform, paint.argb ?? 0xff000000) };
  if (paint.color !== undefined) out.color = out.argb;
  if (paint.shader?.kind === 'linear' && Array.isArray(paint.shader.colors) && paint.shader.colors.length <= 10) out.shader = { ...paint.shader, colors: paint.shader.colors.map(c => transformColor(transform, c)) };
  if (paint.colorFilterSnapshot?.kind === 'blend') out.colorFilterSnapshot = { ...paint.colorFilterSnapshot, argb: transformColor(transform, paint.colorFilterSnapshot.argb) };
  return out;
}
// ---- palettes: Bitmap::computePalette, Tree::computePalette -------------------------------------------------------------------------------------------------------------------------
/** SkRGBToHSV of an SkColor's 8-bit channels (src/core/SkColor.cpp): h in degrees, s and v in 0..1. */
export function skColorToHSV(color) {
  const r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255, min = Math.min(r, g, b), max = Math.max(r, g, b), delta = max - min, v = f(max / 255);
  if (delta === 0) return [0, 0, v];
  const s = f(delta / max);
  let h = r === max ? f((g - b) / delta) : g === max ? f(2 + f((b - r) / delta)) : f(4 + f((r - g) / delta));
  h = f(h * 60); if (h < 0) h = f(h + 360);
  return [h, s, v];
}
/** MinMaxAverage over HSV samples, then the decision both palettes share: hue within 20 degrees and saturation within 0.1 is light (average value >= 0.5) or dark; anything else unknown. */
function decide(samples, enough) {
  if (samples.length < enough) return 'unknown';
  const stats = [0, 1, 2].map(() => ({ min: 0, max: 0, total: 0, count: 0 }));
  for (const hsv of samples) for (let i = 0; i < 3; i++) { const s = stats[i], x = hsv[i]; if (s.count === 0) { s.min = x; s.max = x; } else { s.min = Math.min(s.min, x); s.max = Math.max(s.max, x); } s.total = f(s.total + x); s.count++; }
  const [hue, saturation, value] = stats;
  if (f(hue.max - hue.min) <= 20 && f(saturation.max - saturation.min) <= f(0.1)) return f(value.total / value.count) >= 0.5 ? 'light' : 'dark';
  return 'unknown';
}
/** Bitmap::computePalette over unpremultiplied RGBA8 pixels: a grid of up to 10 x 10 samples (x outer), transparent ones (alpha < 75) skipped unless the bitmap is opaque; fewer than 5 is unknown. */
export function bitmapPalette(pixels, width, height, opaque = false) {
  const xStep = Math.max(1, Math.trunc(width / 10)), yStep = Math.max(1, Math.trunc(height / 10)), samples = [];
  for (let x = 0; x < width; x += xStep) for (let y = 0; y < height; y += yStep) {
    const at = (y * width + x) * 4, alpha = pixels[at + 3];
    if (!opaque && alpha < 75) continue;
    samples.push(skColorToHSV((pixels[at] << 16 | pixels[at + 1] << 8 | pixels[at + 2]) >>> 0));
  }
  return decide(samples, 5);
}
/** Tree::computePalette: every full path's fill colour (FullPath::forEachFillColor, the colour without its fill alpha), those with alpha < 75 skipped; none is unknown. */
export function fillColorsPalette(colors) {
  return decide(colors.filter(color => (color >>> 24) >= 75).map(skColorToHSV), 1);
}
/** paletteForColorHSV: the palette a single colour stands for (value >= 0.5 is light). */
export const paletteOfColor = color => skColorToHSV(color)[2] >= 0.5 ? 'light' : 'dark';
/**
 * transformPaint(transform, paint, palette): does the bitmap draw get the lightness inversion? `filterColor` maps an opaque colour through the paint's colour filter (filterPalette:
 * white for a light palette, black for a dark one), or is null when the paint has none.
 */
export function bitmapShouldInvert(transform, palette, filterColor = null) {
  if (!transform || palette === 'unknown') return false;
  const filtered = filterColor ? paletteOfColor(filterColor(palette === 'light' ? 0xffffffff : 0xff000000)) : palette;
  return filtered === 'light' && transform === 'dark' || filtered === 'dark' && transform === 'light';
}
// ---- SkHighContrastFilter kInvertLightness ------------------------------------------------------------------------------------------------------------------------------------------
const toLinear = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const toEncoded = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
/** The filter's SkSL on one linear, unpremultiplied colour: rgb_to_hsl, lightness 1 - l, hsl_to_rgb, saturate. */
export function invertLightnessLinear(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, invd = 1 / d, gltb = g < b ? 6 : 0;
  const h = (1 / 6) * (mx === mn ? 0 : r >= g && r >= b ? invd * (g - b) + gltb : g >= b ? invd * (b - r) + 2 : invd * (r - g) + 4);
  const sum = mx + mn, l = sum * 0.5, s = mx === mn ? 0 : d / (l > 0.5 ? 2 - sum : sum), L = 1 - l;
  const C = (1 - Math.abs(2 * L - 1)) * s, fract = x => x - Math.floor(x), q = p => saturate(Math.abs(fract(p) * 6 - 3) - 1);
  return [q(h) , q(h + 2 / 3), q(h + 1 / 3)].map(x => saturate((x - 0.5) * C + L));
}
/** The lightness inversion of unpremultiplied sRGB RGBA8 pixels, in place (the filter works in linear sRGB, unpremultiplied; alpha is kept). Memoized per colour: images have few. */
export function invertLightnessPixels(pixels) {
  const memo = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const key = pixels[i] << 16 | pixels[i + 1] << 8 | pixels[i + 2];
    let out = memo.get(key);
    if (out === undefined) { out = invertLightnessLinear(toLinear(pixels[i] / 255), toLinear(pixels[i + 1] / 255), toLinear(pixels[i + 2] / 255)).map(c => Math.round(saturate(toEncoded(c)) * 255)); if (memo.size < 65536) memo.set(key, out); }
    pixels[i] = out[0]; pixels[i + 1] = out[1]; pixels[i + 2] = out[2];
  }
  return pixels;
}
/** The lightness inversion of one ARGB colour (an ALPHA_8 bitmap is drawn in its paint's colour: inverting the image is inverting that colour). */
export function invertLightnessColor(color) {
  const px = Uint8ClampedArray.of((color >>> 16) & 255, (color >>> 8) & 255, color & 255, 255); invertLightnessPixels(px);
  return ((color >>> 24) << 24 | px[0] << 16 | px[1] << 8 | px[2]) >>> 0;
}
// ---- RenderNode::handleForceDark ----------------------------------------------------------------------------------------------------------------------------------------------------
export const USAGE_UNKNOWN = 0, USAGE_BACKGROUND = 1, USAGE_FOREGROUND = 2;
/**
 * The colour transform of one node's own ops. `hint`: its usage hint; `hasText`: it draws text; `children`: its child nodes in drawing order, each { hint, x, y, width, height }
 * (x, y: left + translation in the parent). The crude overlap check sets `hint` of every child that contains everything drawn after it to USAGE_BACKGROUND (setUsageHint is
 * sticky: the caller keeps it); `onBackground(child)` is called for each.
 */
export function nodeTransform({ hint = USAGE_UNKNOWN, hasText = false, children = [] }, onBackground = null) {
  let usage = hasText ? USAGE_FOREGROUND : hint;
  if (usage === USAGE_UNKNOWN) {
    if (children.length > 1) usage = USAGE_BACKGROUND;
    else if (children.length === 1 && children[0].hint !== USAGE_BACKGROUND) usage = USAGE_BACKGROUND;
  }
  if (children.length > 1) {
    // SkRect::contains is false for an empty rect on either side; SkRect::join ignores an empty rect
    let drawn = null;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i], l = child.x, t = child.y, r = f(child.x + child.width), b = f(child.y + child.height), empty = !(l < r && t < b);
      if (!empty && drawn && l <= drawn[0] && t <= drawn[1] && r >= drawn[2] && b >= drawn[3]) { child.hint = USAGE_BACKGROUND; onBackground?.(child); }
      if (!empty) drawn = drawn ? [Math.min(drawn[0], l), Math.min(drawn[1], t), Math.max(drawn[2], r), Math.max(drawn[3], b)] : [l, t, r, b];
    }
  }
  return usage === USAGE_BACKGROUND ? 'dark' : 'light';
}
