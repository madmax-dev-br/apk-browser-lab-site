import { APKError } from './apk-error.js?v=d8da3b335496';

// libcore.math.NativeBN: the BoringSSL BIGNUM calls Android's java.math.BigInteger falls back to for large multiplications, divisions and modPow.
// A BIGNUM is an opaque long handle; the value is an exact arbitrary-precision integer held by the host (JavaScript BigInt), so every result is the
// mathematical answer BN_mul / BN_div / BN_mod_exp compute. Invalid or released handles fail explicitly.
const NATIVE_BN = 'Llibcore/math/NativeBN;';

export function createMathNativeBindings() {
  const bindings = new Map(), add = (signature, callback) => bindings.set(`${NATIVE_BN}->${signature}`, callback);
  const tables = new WeakMap();
  const table = runtime => { let t = tables.get(runtime); if (!t) tables.set(runtime, t = { values: new Map(), next: 1n }); return t; };
  const get = (runtime, handle) => { const value = table(runtime).values.get(handle); if (value === undefined) throw new APKError('Invalid or released BIGNUM handle', { kind: 'bignum-handle' }); return value; };
  add('BN_new()J', runtime => { const t = table(runtime), handle = t.next++; t.values.set(handle, 0n); return handle; });
  add('BN_free(J)V', (runtime, [handle]) => { table(runtime).values.delete(handle); });
  add('litEndInts2bn([IIZJ)V', (runtime, [ints, length, negative, ret]) => {
    const elements = runtime.array(ints).elements; if (length < 0 || length > elements.length) runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${length}`);
    let value = 0n; for (let i = length - 1; i >= 0; i--) value = (value << 32n) | BigInt(elements[i] >>> 0);
    get(runtime, ret); table(runtime).values.set(ret, negative ? -value : value);
  });
  add('bn2litEndInts(J)[I', (runtime, [handle]) => {
    let value = get(runtime, handle); if (value < 0n) value = -value;
    const words = []; while (value > 0n) { words.push(Number(value & 0xffffffffn) | 0); value >>= 32n; }
    const array = runtime.newArray('[I', words.length); runtime.array(array).elements = words; return array;
  });
  add('BN_mul(JJJ)V', (runtime, [r, a, b]) => { const product = get(runtime, a) * get(runtime, b); get(runtime, r); table(runtime).values.set(r, product); });
  add('BN_div(JJJJ)V', (runtime, [dv, rem, num, divisor]) => {
    const d = get(runtime, divisor); if (d === 0n) throw new APKError('BN_div: division by zero', { kind: 'bignum-div-zero' });
    const n = get(runtime, num); get(runtime, dv); get(runtime, rem);
    table(runtime).values.set(dv, n / d); table(runtime).values.set(rem, n % d); // truncating division, remainder takes the dividend's sign, as BN_div
  });
  add('BN_mod_exp(JJJJ)V', (runtime, [r, a, p, m]) => {
    const modulus = get(runtime, m), exponent = get(runtime, p); let base = get(runtime, a);
    if (modulus <= 0n || exponent < 0n) throw new APKError('BN_mod_exp: modulus must be positive and the exponent non-negative', { kind: 'bignum-domain' });
    base = ((base % modulus) + modulus) % modulus; let result = 1n % modulus, e = exponent;
    while (e > 0n) { if (e & 1n) result = (result * base) % modulus; base = (base * base) % modulus; e >>= 1n; }
    get(runtime, r); table(runtime).values.set(r, result);
  });
  return bindings;
}
