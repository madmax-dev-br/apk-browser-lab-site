// strtof / strtod / strtold of the ARM64 libc (C11 7.22.1.3, as bionic's gdtoa converts): the longest prefix that is a number (after white space: an optional sign, then a
// decimal number with an optional exponent, a hexadecimal one "0x" with an optional binary exponent "p", "inf" / "infinity", or "nan" with an optional "(chars)"), rounded
// once, to nearest with ties to even, from its exact value to the format asked for: binary32 (strtof, the result in S0), binary64 (strtod, D0) or binary128 (strtold: AArch64's
// long double, Q0). A value beyond the format's range is ±infinity (HUGE_VAL) with ERANGE; one that underflows to zero, or to an inexact subnormal, sets ERANGE too.
// Parsing to a double first and narrowing would round twice, and returning a double where the caller reads a float reads the low half of its bits.
export const BINARY32 = { precision: 24, exponentBits: 8 }, BINARY64 = { precision: 53, exponentBits: 11 }, BINARY128 = { precision: 113, exponentBits: 15 };
const bitLength = v => v === 0n ? 0 : v.toString(2).length;

/** The number at the start of `text`: { length (0: none), negative, kind: 'number' | 'inf' | 'nan', num, den } (the value is num / den, exactly). */
export function parseCFloat(text) {
  const m = /^[ \t\n\v\f\r]*([+-]?)(?:(0[xX])((?:[0-9a-fA-F]+\.?[0-9a-fA-F]*|\.[0-9a-fA-F]+))(?:[pP]([+-]?\d+))?|((?:\d+\.?\d*|\.\d+))(?:[eE]([+-]?\d+))?|(inf(?:inity)?)|(nan(?:\([0-9A-Za-z_]*\))?))/i.exec(text);
  if (!m) return { length: 0, negative: false, kind: 'number', num: 0n, den: 1n };
  const negative = m[1] === '-';
  if (m[7]) return { length: m[0].length, negative, kind: 'inf' };
  if (m[8]) return { length: m[0].length, negative, kind: 'nan' };
  if (m[2]) {   // hexadecimal: digits * 2^(exponent - 4 * fraction digits)
    const [whole, fraction = ''] = m[3].split('.'), digits = BigInt('0x' + ((whole + fraction) || '0')), exponent = Number(m[4] ?? 0) - 4 * fraction.length;
    return { length: m[0].length, negative, kind: 'number', num: exponent >= 0 ? digits << BigInt(exponent) : digits, den: exponent >= 0 ? 1n : 1n << BigInt(-exponent) };
  }
  const [whole, fraction = ''] = m[5].split('.'), digits = BigInt((whole + fraction) || '0');
  let exponent = Number(m[6] ?? 0) - fraction.length;
  if (digits === 0n) exponent = 0;
  const significant = digits === 0n ? 0 : digits.toString().length, magnitude = exponent + significant;   // the value is below 10^magnitude
  if (magnitude > 5000) exponent = 5000 - significant; else if (magnitude < -5000) exponent = -5000 - significant;   // beyond every format's range either way (0 or infinity), without huge powers
  return { length: m[0].length, negative, kind: 'number', num: exponent >= 0 ? digits * 10n ** BigInt(exponent) : digits, den: exponent >= 0 ? 1n : 10n ** BigInt(-exponent) };
}

/** The IEEE 754 bits of `parsed` in `format`, rounded to nearest-even: { bits (BigInt), erange }. */
export function roundBinary(parsed, { precision, exponentBits }) {
  const bias = (1 << (exponentBits - 1)) - 1, emin = 1 - bias, emax = bias, fractionBits = BigInt(precision - 1), maxExp = (1n << BigInt(exponentBits)) - 1n;
  const sign = parsed.negative ? 1n << BigInt(precision - 1 + exponentBits) : 0n, pack = (field, fraction) => sign | (field << fractionBits) | fraction;
  if (parsed.kind === 'inf') return { bits: pack(maxExp, 0n), erange: false };
  if (parsed.kind === 'nan') return { bits: pack(maxExp, 1n << (fractionBits - 1n)), erange: false };   // the default quiet NaN
  const { num, den } = parsed;
  if (num === 0n) return { bits: pack(0n, 0n), erange: false };
  let e = bitLength(num) - bitLength(den);   // 2^e <= num/den < 2^(e+1) after the adjustment
  if (e >= 0 ? num < den << BigInt(e) : num << BigInt(-e) < den) e--;
  if (e > emax) return { bits: pack(maxExp, 0n), erange: true };
  const q = Math.max(e, emin) - (precision - 1);   // the exponent of the last bit kept
  const scaledNum = q < 0 ? num << BigInt(-q) : num, scaledDen = q < 0 ? den : den << BigInt(q);
  let mantissa = scaledNum / scaledDen; const remainder = scaledNum - mantissa * scaledDen, twice = remainder * 2n;
  if (twice > scaledDen || (twice === scaledDen && (mantissa & 1n))) mantissa++;
  const inexact = remainder !== 0n;
  let exponent = q + precision - 1;   // the value's exponent when mantissa has `precision` bits
  if (mantissa === 1n << BigInt(precision)) { mantissa >>= 1n; exponent++; }
  if (mantissa >= 1n << fractionBits) {   // normal
    if (exponent > emax) return { bits: pack(maxExp, 0n), erange: true };
    return { bits: pack(BigInt(exponent + bias), mantissa & ((1n << fractionBits) - 1n)), erange: false };
  }
  return { bits: pack(0n, mantissa), erange: mantissa === 0n || inexact };   // subnormal, or an underflow to zero
}

/** A binary32 / binary64 bit pattern as the JavaScript number it is. */
export function bitsToNumber(bits, format) {
  const view = new DataView(new ArrayBuffer(8));
  if (format === BINARY32) { view.setUint32(0, Number(bits)); return view.getFloat32(0); }
  view.setBigUint64(0, bits); return view.getFloat64(0);
}
