import { createHostRegistry, parseSignature } from './host-contract.js?v=4ebf400428b7';

// java.lang.StrictMath: every method is java.lang.Math's, same name and signature. On ART Math is the intrinsic / fdlibm implementation StrictMath names (libcore's Math.java calls
// StrictMath for the transcendental functions), so delegating gives the platform's results; anything Math itself does not provide fails by Math's name.
const STRICT = 'Ljava/lang/StrictMath;', MATH = 'Ljava/lang/Math;';
const SIGNATURES = ['IEEEremainder(DD)D', 'abs(D)D', 'abs(F)F', 'abs(I)I', 'abs(J)J', 'absExact(I)I', 'absExact(J)J', 'acos(D)D', 'addExact(II)I', 'addExact(JJ)J', 'asin(D)D', 'atan(D)D', 'atan2(DD)D', 'cbrt(D)D', 'ceil(D)D',
  'ceilDiv(II)I', 'ceilDiv(JI)J', 'ceilDiv(JJ)J', 'ceilMod(II)I', 'ceilMod(JI)I', 'ceilMod(JJ)J', 'copySign(DD)D', 'copySign(FF)F', 'cos(D)D', 'cosh(D)D', 'decrementExact(I)I', 'decrementExact(J)J', 'exp(D)D', 'expm1(D)D',
  'floor(D)D', 'floorDiv(II)I', 'floorDiv(JI)J', 'floorDiv(JJ)J', 'floorMod(II)I', 'floorMod(JI)I', 'floorMod(JJ)J', 'fma(DDD)D', 'fma(FFF)F', 'getExponent(D)I', 'getExponent(F)I', 'hypot(DD)D', 'incrementExact(I)I',
  'incrementExact(J)J', 'log(D)D', 'log10(D)D', 'log1p(D)D', 'max(DD)D', 'max(FF)F', 'max(II)I', 'max(JJ)J', 'min(DD)D', 'min(FF)F', 'min(II)I', 'min(JJ)J', 'multiplyExact(II)I', 'multiplyExact(JI)J', 'multiplyExact(JJ)J',
  'multiplyFull(II)J', 'multiplyHigh(JJ)J', 'negateExact(I)I', 'negateExact(J)J', 'nextAfter(DD)D', 'nextAfter(FD)F', 'nextDown(D)D', 'nextDown(F)F', 'nextUp(D)D', 'nextUp(F)F', 'pow(DD)D', 'random()D', 'rint(D)D', 'round(D)J',
  'round(F)I', 'scalb(DI)D', 'scalb(FI)F', 'signum(D)D', 'signum(F)F', 'sin(D)D', 'sinh(D)D', 'sqrt(D)D', 'subtractExact(II)I', 'subtractExact(JJ)J', 'tan(D)D', 'tanh(D)D', 'toDegrees(D)D', 'toIntExact(J)I', 'toRadians(D)D',
  'ulp(D)D', 'ulp(F)F'];

export function createStrictMathHost() {
  const registry = createHostRegistry(), { def, type } = registry;
  type(STRICT, 'Ljava/lang/Object;', [], { allocatable: false });
  for (const signature of SIGNATURES) {
    const name = signature.slice(0, signature.indexOf('(')), shape = signature.slice(signature.indexOf('(')), { parameters, result } = parseSignature(shape);
    def(STRICT, name, shape, (r, _m, args) => r.dispatch({ owner: MATH, name, parameters, result, signature: shape }, r.argumentWords(parameters, args), 'static'), { static: true });
  }
  return { ...registry };
}
