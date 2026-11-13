// A packed @ColorLong (android.graphics.Color.pack) as the sRGB 8-bit int Color.toArgb(long) answers, for the color spaces the lab's ColorSpace implements (src/bitmap-host.js
// SPACES): SRGB (id 0: the int is the upper 32 bits), LINEAR_SRGB (1), EXTENDED_SRGB (2) and LINEAR_EXTENDED_SRGB (3), whose longs hold red, green and blue as half-floats and a
// 10-bit alpha. ColorSpace.connect(source) to sRGB applies sRGB's transfer function to linear components and clamps to sRGB's [0, 1] range; toArgb then rounds each to 8 bits.
// Returns null for another ColorSpace id (the caller fails naming the API: no other color space is implemented).
const half = h => { const sign = h & 0x8000 ? -1 : 1, exponent = (h >> 10) & 31, mantissa = h & 1023; return exponent === 0 ? sign * mantissa * 2 ** -24 : exponent === 31 ? (mantissa ? NaN : sign * Infinity) : sign * (1 + mantissa / 1024) * 2 ** (exponent - 15); };
const oetf = v => { const a = Math.abs(v), e = a <= 0.0031308 ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055; return v < 0 ? -e : e; };

export function colorLongToArgb(packed) {
  const c = BigInt.asUintN(64, BigInt(packed)), id = Number(c & 63n);
  if (id === 0) return Number(BigInt.asIntN(32, c >> 32n));
  if (id > 3) return null;
  const linear = id === 1 || id === 3, channel = shift => { const v = half(Number((c >> shift) & 0xffffn)), encoded = linear ? oetf(v) : v; return Math.floor(Math.min(1, Math.max(0, encoded)) * 255 + 0.5); };
  const alpha = Math.floor(Number((c >> 6n) & 0x3ffn) / 1023 * 255 + 0.5);
  return (alpha << 24 | channel(48n) << 16 | channel(32n) << 8 | channel(16n)) | 0;
}
