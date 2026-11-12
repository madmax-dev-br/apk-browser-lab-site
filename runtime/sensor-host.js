import { bitsFloat, createHostRegistry, floatBits } from './host-contract.js?v=a9e9656b8d6c';

// android.hardware.SensorManager beyond the "device without sensors" answers of hardware-services-host.js, following android-13.0.0_r1 SensorManager.java:
//  - the sensor lists: the device panel models no sensor, so every list is empty and no Sensor object ever exists (android.hardware.Sensor is the original class in the framework DEX);
//  - the static orientation math (getRotationMatrix, getInclination, getOrientation, getAltitude, remapCoordinateSystem, getRotationMatrixFromVector, getQuaternionFromVector), a line by line
//    port of the Java bodies with every intermediate rounded to float32 as Java does. Float values travel as IEEE-754 bit patterns, like every float of the VM.
const SM = 'Landroid/hardware/SensorManager;', FLOATS = '[F', LIST = 'Ljava/util/List;', CALLBACK = 'Landroid/hardware/SensorManager$DynamicSensorCallback;', HANDLER = 'Landroid/os/Handler;';
const f = Math.fround;

export function createSensorHost() {
  const registry = createHostRegistry(), { def, type } = registry;
  const nullish = value => value === null || value === undefined || value === 0;
  type(CALLBACK, 'Ljava/lang/Object;');
  const emptyList = r => { const list = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct'); return list; };
  const statics = (name, signature, fn) => def(SM, name, signature, fn, { static: true });
  const cells = (r, ref) => (nullish(ref) ? r.throwJava('Ljava/lang/NullPointerException;', 'Attempt to get length of null array') : r.array(ref).elements);
  const get = (cell, index) => bitsFloat(cell[index]), put = (cell, index, value) => { cell[index] = floatBits(value); };
  const aioobe = (r, index, length) => r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${length}; index=${index}`);
  const at = (r, array, index) => { if (index >= array.length || index < 0) aioobe(r, index, array.length); return get(array, index); };
  const set = (r, array, index, value) => { if (index >= array.length || index < 0) aioobe(r, index, array.length); put(array, index, value); };

  // ---- sensor lists and dynamic discovery of a device with no sensors
  def(SM, 'getDefaultSensor', '(IZ)Landroid/hardware/Sensor;', () => null);
  def(SM, 'getDynamicSensorList', `(I)${LIST}`, r => emptyList(r));
  def(SM, 'isDynamicSensorDiscoverySupported', '()Z', () => 0);
  for (const signature of [`(${CALLBACK})V`, `(${CALLBACK}${HANDLER})V`]) {
    def(SM, 'registerDynamicSensorCallback', signature, (r, _m, [, callback]) => { if (nullish(callback)) return; });   // accepted; no sensor is ever connected
    def(SM, 'unregisterDynamicSensorCallback', `(${CALLBACK})V`, () => {});
  }

  // ---- static math
  statics('getAltitude', '(FF)F', (r, _m, [p0, p]) => floatBits(f(44330 * f(1 - f(Math.pow(f(bitsFloat(p) / bitsFloat(p0)), f(1 / 5.255)))))));
  statics('getRotationMatrix', `(${FLOATS}${FLOATS}${FLOATS}${FLOATS})Z`, (r, _m, [Rref, Iref, gravityRef, geomagneticRef]) => {
    const gravity = cells(r, gravityRef), geomagnetic = cells(r, geomagneticRef);
    let Ax = at(r, gravity, 0), Ay = at(r, gravity, 1), Az = at(r, gravity, 2);
    const normsqA = f(f(f(Ax * Ax) + f(Ay * Ay)) + f(Az * Az)), g = f(9.81), freeFallGravitySquared = f(f(0.01 * g) * g);
    if (normsqA < freeFallGravitySquared) return 0;
    const Ex = at(r, geomagnetic, 0), Ey = at(r, geomagnetic, 1), Ez = at(r, geomagnetic, 2);
    let Hx = f(f(Ey * Az) - f(Ez * Ay)), Hy = f(f(Ez * Ax) - f(Ex * Az)), Hz = f(f(Ex * Ay) - f(Ey * Ax));
    const normH = f(Math.sqrt(f(f(f(Hx * Hx) + f(Hy * Hy)) + f(Hz * Hz))));
    if (normH < f(0.1)) return 0;
    const invH = f(1 / normH); Hx = f(Hx * invH); Hy = f(Hy * invH); Hz = f(Hz * invH);
    const invA = f(1 / f(Math.sqrt(f(f(f(Ax * Ax) + f(Ay * Ay)) + f(Az * Az))))); Ax = f(Ax * invA); Ay = f(Ay * invA); Az = f(Az * invA);
    const Mx = f(f(Ay * Hz) - f(Az * Hy)), My = f(f(Az * Hx) - f(Ax * Hz)), Mz = f(f(Ax * Hy) - f(Ay * Hx));
    if (!nullish(Rref)) {
      const R = cells(r, Rref);
      if (R.length === 9) [Hx, Hy, Hz, Mx, My, Mz, Ax, Ay, Az].forEach((value, i) => put(R, i, value));
      else if (R.length === 16) [Hx, Hy, Hz, 0, Mx, My, Mz, 0, Ax, Ay, Az, 0, 0, 0, 0, 1].forEach((value, i) => put(R, i, value));
    }
    if (!nullish(Iref)) {
      const I = cells(r, Iref), invE = f(1 / f(Math.sqrt(f(f(f(Ex * Ex) + f(Ey * Ey)) + f(Ez * Ez))))), c = f(f(f(f(Ex * Mx) + f(Ey * My)) + f(Ez * Mz)) * invE), s = f(f(f(f(Ex * Ax) + f(Ey * Ay)) + f(Ez * Az)) * invE);
      if (I.length === 9) [1, 0, 0, 0, c, s, 0, -s, c].forEach((value, i) => put(I, i, value));
      else if (I.length === 16) [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1].forEach((value, i) => put(I, i, value));
    }
    return 1;
  });
  statics('getInclination', `(${FLOATS})F`, (r, _m, [Iref]) => { const I = cells(r, Iref); return floatBits(f(I.length === 9 ? Math.atan2(at(r, I, 5), at(r, I, 4)) : Math.atan2(at(r, I, 6), at(r, I, 5)))); });
  statics('getOrientation', `(${FLOATS}${FLOATS})${FLOATS}`, (r, _m, [Rref, valuesRef]) => {
    const R = cells(r, Rref), values = cells(r, valuesRef);
    if (R.length === 9) { set(r, values, 0, f(Math.atan2(at(r, R, 1), at(r, R, 4)))); set(r, values, 1, f(Math.asin(-at(r, R, 7)))); set(r, values, 2, f(Math.atan2(-at(r, R, 6), at(r, R, 8)))); }
    else { set(r, values, 0, f(Math.atan2(at(r, R, 1), at(r, R, 5)))); set(r, values, 1, f(Math.asin(-at(r, R, 9)))); set(r, values, 2, f(Math.atan2(-at(r, R, 8), at(r, R, 10)))); }
    return valuesRef;
  });
  const quaternion = (rv) => { const q1 = at0(rv, 0), q2 = at0(rv, 1), q3 = at0(rv, 2); let q0; if (rv.length >= 4) q0 = get(rv, 3); else { q0 = f(f(f(f(1 - f(q1 * q1)) - f(q2 * q2)) - f(q3 * q3))); q0 = q0 > 0 ? f(Math.sqrt(q0)) : 0; } return [q0, q1, q2, q3]; };
  const at0 = (cell, index) => get(cell, index);
  statics('getQuaternionFromVector', `(${FLOATS}${FLOATS})V`, (r, _m, [Qref, rvRef]) => {
    const Q = cells(r, Qref), rv = cells(r, rvRef);
    if (rv.length < 3) aioobe(r, rv.length, rv.length);
    const [q0, q1, q2, q3] = quaternion(rv); [q0, q1, q2, q3].forEach((value, i) => set(r, Q, i, value));
  });
  statics('getRotationMatrixFromVector', `(${FLOATS}${FLOATS})V`, (r, _m, [Rref, rvRef]) => {
    const R = cells(r, Rref), rv = cells(r, rvRef);
    if (rv.length < 3) aioobe(r, rv.length, rv.length);
    const [q0, q1, q2, q3] = quaternion(rv);
    const sq1 = f(f(2 * q1) * q1), sq2 = f(f(2 * q2) * q2), sq3 = f(f(2 * q3) * q3), q12 = f(f(2 * q1) * q2), q30 = f(f(2 * q3) * q0), q13 = f(f(2 * q1) * q3), q20 = f(f(2 * q2) * q0), q23 = f(f(2 * q2) * q3), q10 = f(f(2 * q1) * q0);
    const a = f(f(1 - sq2) - sq3), b = f(q12 - q30), c = f(q13 + q20), d = f(q12 + q30), e = f(f(1 - sq1) - sq3), g = f(q23 - q10), h = f(q13 - q20), i = f(q23 + q10), j = f(f(1 - sq1) - sq2);
    if (R.length === 9) [a, b, c, d, e, g, h, i, j].forEach((value, k) => put(R, k, value));
    else if (R.length === 16) [a, b, c, 0, d, e, g, 0, h, i, j, 0, 0, 0, 0, 1].forEach((value, k) => put(R, k, value));
  });
  const remap = (inR, X, Y, outR) => {   // remapCoordinateSystemImpl
    const length = outR.length;
    if (inR.length !== length) return false;
    if ((X & 0x7c) !== 0 || (Y & 0x7c) !== 0) return false;
    if ((X & 3) === 0 || (Y & 3) === 0 || (X & 3) === (Y & 3)) return false;
    let Z = X ^ Y;
    const x = (X & 3) - 1, y = (Y & 3) - 1, z = (Z & 3) - 1, axisY = (z + 1) % 3, axisZ = (z + 2) % 3;
    if (((x ^ axisY) | (y ^ axisZ)) !== 0) Z ^= 0x80;
    const sx = X >= 0x80, sy = Y >= 0x80, sz = Z >= 0x80, rowLength = length === 16 ? 4 : 3;
    for (let j = 0; j < 3; j++) {
      const offset = j * rowLength;
      for (let i = 0; i < 3; i++) {
        if (x === i) put(outR, offset + i, sx ? -get(inR, offset) : get(inR, offset));
        if (y === i) put(outR, offset + i, sy ? -get(inR, offset + 1) : get(inR, offset + 1));
        if (z === i) put(outR, offset + i, sz ? -get(inR, offset + 2) : get(inR, offset + 2));
      }
    }
    if (length === 16) { for (const index of [3, 7, 11, 12, 13, 14]) put(outR, index, 0); put(outR, 15, 1); }
    return true;
  };
  statics('remapCoordinateSystem', `(${FLOATS}II${FLOATS})Z`, (r, _m, [inRef, X, Y, outRef]) => {
    const inR = cells(r, inRef), outR = cells(r, outRef);
    if (inRef.ref === outRef.ref) { const temp = new Array(16).fill(0);   // sTempMatrix is a float[16]: a 9-element matrix then fails the length check and is remapped in place, as in Java
       if (remap(inR, X, Y, temp)) { for (let i = 0; i < outR.length; i++) outR[i] = temp[i]; return 1; } }
    return remap(inR, X, Y, outR) ? 1 : 0;
  });
  return { ...registry };
}
