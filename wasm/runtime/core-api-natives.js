import { bitsFloat, floatBits } from './host-contract.js?v=7a839fa82e6c';
import { androidCharacterDirectionality } from './unicode-bidi-data.js?v=7a839fa82e6c';
import { icuCharMirror, icuEastAsianWidth } from './unicode-character-data.js?v=7a839fa82e6c';

// Native methods of original-source framework classes whose JNI halves are plain computation:
//   android.text.AndroidCharacter   frameworks/base/core/jni/android_text_AndroidCharacter.cpp (android-13.0.0_r1), ICU data from the Android 13 ICU (Unicode 14)
//   android.opengl.Matrix           frameworks/base/core/jni/android/opengl/util.cpp multiplyMM / multiplyMV
// Each binding keeps the C++ control flow (argument checks in the same order, same loops, same exceptions) so the observable results and failures are the platform's.
const CHARACTER = 'Landroid/text/AndroidCharacter;', MATRIX = 'Landroid/opengl/Matrix;';
const PROPERTY_UNDEFINED = -1, JAVA_LANG_CHARACTER_MAX_DIRECTIONALITY = 18, U_EA_MAX = 5;

const npe = runtime => runtime.throwJava('Ljava/lang/NullPointerException;', null);
const outOfBounds = runtime => runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', null);
const elements = (runtime, value) => (value === null || value === undefined ? npe(runtime) : runtime.array(value).elements);
const toByte = value => (value << 24) >> 24;
const isHigh = unit => unit >= 0xd800 && unit <= 0xdbff, isLow = unit => unit >= 0xdc00 && unit <= 0xdfff;
const supplementary = (high, low) => 0x10000 + ((high - 0xd800) << 10) + (low & 0x3ff);

export function createCoreApiNativeBindings() {
  const bindings = new Map();
  const bind = (owner, name, signature, fn) => bindings.set(`${owner}->${name}${signature}`, fn);

  const direction = codePoint => {   // dir = u_charDirection(c); anything the JDK has no constant for (isolates, unassigned) is PROPERTY_UNDEFINED
    const value = androidCharacterDirectionality(codePoint);
    return value < 0 || value > JAVA_LANG_CHARACTER_MAX_DIRECTIONALITY ? PROPERTY_UNDEFINED : value;
  };
  const width = codePoint => { const value = icuEastAsianWidth(codePoint); return value < 0 || value > U_EA_MAX ? PROPERTY_UNDEFINED : value; };

  bind(CHARACTER, 'getDirectionalities', '([C[BI)V', (runtime, [srcArray, destArray, count]) => {
    const src = elements(runtime, srcArray), dest = elements(runtime, destArray);
    if (src.length < count || dest.length < count) outOfBounds(runtime);
    for (let i = 0; i < count; i++) {
      if (isHigh(src[i]) && i + 1 < count && isLow(src[i + 1])) {
        const dir = direction(supplementary(src[i], src[i + 1]));
        dest[i++] = toByte(dir); dest[i] = toByte(dir);
      } else dest[i] = toByte(direction(src[i]));
    }
  });
  bind(CHARACTER, 'getEastAsianWidth', '(C)I', (_runtime, [input]) => width(input & 0xffff));
  bind(CHARACTER, 'getEastAsianWidths', '([CII[B)V', (runtime, [srcArray, start, count, destArray]) => {
    const src = elements(runtime, srcArray), dest = elements(runtime, destArray);
    if (start < 0 || start > start + count || src.length < start + count || dest.length < count) outOfBounds(runtime);
    for (let i = 0; i < count; i++) {
      const srci = start + i;
      if (isHigh(src[srci]) && i + 1 < count && isLow(src[srci + 1])) {
        const result = width(supplementary(src[srci], src[srci + 1]));
        dest[i++] = toByte(result); dest[i] = toByte(result);
      } else dest[i] = toByte(width(src[srci]));
    }
  });
  bind(CHARACTER, 'mirror', '([CII)Z', (runtime, [charArray, start, count]) => {
    const data = elements(runtime, charArray);
    if (start < 0 || start > start + count || data.length < start + count) outOfBounds(runtime);
    let changed = 0;
    for (let i = start; i < start + count; i++) {   // surrogates are never mirrored, as in the original
      const c1 = data[i], c2 = icuCharMirror(c1);
      if (c1 !== c2) { data[i] = c2 & 0xffff; changed = 1; }
    }
    return changed;
  });
  bind(CHARACTER, 'getMirror', '(C)C', (_runtime, [c]) => icuCharMirror(c & 0xffff) & 0xffff);

  // ArrayHelper::check(): null / negative offset / too short arrays are IllegalArgumentExceptions with these messages, checked result first.
  const checked = (runtime, array, offset, minimum) => {
    if (array === null || array === undefined) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'array == null');
    if (offset < 0) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'offset < 0');
    const data = runtime.array(array).elements;
    if (data.length - offset < minimum) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'length - offset < n');
    return data;
  };
  const f32 = Math.fround;
  // float[] cells hold IEEE-754 bit patterns, like every float register of the VM. The C++ works on the arrays in place through raw pointers (no copies), so overlapping operands read
  // results already written, exactly like the device; each product and sum is rounded to float32 (no fused multiply-add, which the arm64 build may contract).
  const get = (data, index) => bitsFloat(data[index]), put = (data, index, value) => { data[index] = floatBits(value); };
  bind(MATRIX, 'multiplyMM', '([FI[FI[FI)V', (runtime, [result, resultOffset, lhs, lhsOffset, rhs, rhsOffset]) => {
    const r = checked(runtime, result, resultOffset, 16), l = checked(runtime, lhs, lhsOffset, 16), h = checked(runtime, rhs, rhsOffset, 16);
    const I = (i, j) => j + 4 * i;
    for (let i = 0; i < 4; i++) {
      const rhsI0 = get(h, rhsOffset + I(i, 0));
      let ri0 = f32(get(l, lhsOffset + I(0, 0)) * rhsI0), ri1 = f32(get(l, lhsOffset + I(0, 1)) * rhsI0), ri2 = f32(get(l, lhsOffset + I(0, 2)) * rhsI0), ri3 = f32(get(l, lhsOffset + I(0, 3)) * rhsI0);
      for (let j = 1; j < 4; j++) {
        const rhsIJ = get(h, rhsOffset + I(i, j));
        ri0 = f32(ri0 + f32(get(l, lhsOffset + I(j, 0)) * rhsIJ)); ri1 = f32(ri1 + f32(get(l, lhsOffset + I(j, 1)) * rhsIJ));
        ri2 = f32(ri2 + f32(get(l, lhsOffset + I(j, 2)) * rhsIJ)); ri3 = f32(ri3 + f32(get(l, lhsOffset + I(j, 3)) * rhsIJ));
      }
      put(r, resultOffset + I(i, 0), ri0); put(r, resultOffset + I(i, 1), ri1); put(r, resultOffset + I(i, 2), ri2); put(r, resultOffset + I(i, 3), ri3);
    }
  });
  bind(MATRIX, 'multiplyMV', '([FI[FI[FI)V', (runtime, [result, resultOffset, lhs, lhsOffset, rhs, rhsOffset]) => {
    const r = checked(runtime, result, resultOffset, 4), m = checked(runtime, lhs, lhsOffset, 16), v = checked(runtime, rhs, rhsOffset, 4);
    const x = get(v, rhsOffset), y = get(v, rhsOffset + 1), z = get(v, rhsOffset + 2), w = get(v, rhsOffset + 3);
    for (let i = 0; i < 4; i++) put(r, resultOffset + i, f32(f32(f32(f32(get(m, lhsOffset + i) * x) + f32(get(m, lhsOffset + i + 4) * y)) + f32(get(m, lhsOffset + i + 8) * z)) + f32(get(m, lhsOffset + i + 12) * w)));   // mx4transform: pM[i + 4 * k], x..w read up front
  });
  return bindings;
}
