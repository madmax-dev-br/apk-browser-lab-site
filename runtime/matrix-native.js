import { APKError } from './apk-error.js?v=36ea061c5c9d';
const MATRIX = 'Landroid/graphics/Matrix;', RECT = 'Landroid/graphics/RectF;';
const REGISTRY = 'Llibcore/util/NativeAllocationRegistry;', CLEANER = 'Lapkweb/bridge/MatrixCleaner;';
const FINALIZER = 0x4d415452n;
const states = new WeakMap(), float = new DataView(new ArrayBuffer(4));
const decode = value => { float.setInt32(0, value, true); return float.getFloat32(0, true); };
const encode = value => { float.setFloat32(0, value, true); return float.getInt32(0, true); };
const fail = message => { throw new APKError(message, { kind: 'matrix-backend-unsupported' }); };
const stateFor = runtime => { if (!states.has(runtime)) states.set(runtime, { handles: new Map(), next: 1n }); return states.get(runtime); };
const backend = runtime => runtime.skia?.CanvasKit || fail('Matrix requires the verified Skia backend');
const get = (runtime, handle) => stateFor(runtime).handles.get(handle) || fail('Invalid or released native Matrix handle');
const put = (runtime, handle, values) => {
  get(runtime, handle);
  if (values.length !== 9 || values.some(value => !Number.isFinite(value))) fail('Non-finite Matrix values are not supported by this backend');
  stateFor(runtime).handles.set(handle, values.map(Math.fround));
};
// Transform composition and rotation run through the actual C++ Skia canvas.
// A one-pixel scratch surface is disposed after each operation, with no drawing.
const compose = (runtime, matrices, transform = null) => {
  const surface = backend(runtime).MakeSurface(1, 1);
  if (!surface) fail('Unable to allocate Skia matrix scratch surface');
  try { const canvas = surface.getCanvas(); for (const matrix of matrices) canvas.concat(matrix); transform?.(canvas); return Array.from(canvas.getTotalMatrix()); }
  finally { surface.dispose(); }
};
const affine = matrix => matrix[6] === 0 && matrix[7] === 0 && matrix[8] === 1;
// Conditions from AOSP SkMatrix::computeTypeMask, including degenerate scales.
const keepsRect = matrix => affine(matrix) && (matrix[1] || matrix[3] ? matrix[0] === 0 && matrix[4] === 0 && matrix[1] !== 0 && matrix[3] !== 0 : matrix[0] !== 0 && matrix[4] !== 0);
const identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
const pointMap = (runtime, matrix, points, vectors = false) => {
  // SkMatrix::mapVectors removes affine translation before mapping. Subtracting
  // two translated points would lose small vectors at large translations.
  const transform = vectors && affine(matrix) ? matrix.map((value, index) => index === 2 || index === 5 ? 0 : value) : matrix;
  const map = coordinates => {
    const result = backend(runtime).Matrix.mapPoints(transform, coordinates.slice());
    if (!affine(transform)) for (let i = 0; i < coordinates.length; i += 2) {
      // SkMatrix::Persp_pts keeps a zero homogeneous divisor at zero instead
      // of the Infinity produced by CanvasKit's JavaScript division helper.
      const divisor = Math.fround(Math.fround(Math.fround(coordinates[i] * transform[6]) + Math.fround(coordinates[i + 1] * transform[7])) + transform[8]);
      if (divisor === 0) { result[i] = 0; result[i + 1] = 0; }
    }
    return result;
  };
  const result = map(points);
  if (vectors && !affine(matrix)) { const origin = map([0, 0]); for (let i = 0; i < result.length; i += 2) { result[i] -= origin[0]; result[i + 1] -= origin[1]; } }
  return result.map(Math.fround);
};
const readRect = (runtime, ref) => ['left', 'top', 'right', 'bottom'].map(field => decode(runtime.object(ref).fields.get(`${RECT}->${field}:F`) || 0));
const writeRect = (runtime, ref, values) => ['left', 'top', 'right', 'bottom'].forEach((field, index) => runtime.storeField(runtime.object(ref).fields, `${RECT}->${field}:F`, encode(values[index])));

/** Exact native declarations reached from the original AOSP Matrix Java class.
 * Skia CPU performs composition; the official CanvasKit Matrix helpers provide
 * inversion and point mapping. This is not execution of an APK's ELF library.
 * Methods without a binding (e.g. setPolyToPoly) remain explicit JNI failures.
 */
export function createMatrixNativeBindings() {
  const bindings = new Map();
  const add = (name, parameters, result, operation) => bindings.set(`${MATRIX}->${name}(${parameters.join('')})${result}`, (runtime, args) => {
    const values = args.map((value, index) => parameters[index] === 'F' ? decode(value) : value);
    const answer = operation(runtime, values); return result === 'F' ? encode(answer) : answer;
  });
  add('nGetNativeFinalizer', [], 'J', () => FINALIZER);
  add('nCreate', ['J'], 'J', (runtime, [source]) => {
    backend(runtime); const state = stateFor(runtime); if (state.handles.size >= 8192) fail('Native Matrix handle limit exceeded');
    const values = source ? get(runtime, source).slice() : identity(), handle = state.next++; state.handles.set(handle, values); return handle;
  });
  add('nReset', ['J'], 'V', (runtime, [handle]) => put(runtime, handle, identity()));
  add('nSet', ['J', 'J'], 'V', (runtime, [handle, other]) => put(runtime, handle, get(runtime, other).slice()));
  add('nEquals', ['J', 'J'], 'Z', (runtime, [a, b]) => get(runtime, a).every((value, i) => value === get(runtime, b)[i]) ? 1 : 0);
  add('nIsIdentity', ['J'], 'Z', (runtime, [handle]) => get(runtime, handle).every((value, i) => value === identity()[i]) ? 1 : 0);
  add('nIsAffine', ['J'], 'Z', (runtime, [handle]) => affine(get(runtime, handle)) ? 1 : 0);
  add('nRectStaysRect', ['J'], 'Z', (runtime, [handle]) => keepsRect(get(runtime, handle)) ? 1 : 0);
  for (const [suffix, count, transform] of [
    ['Translate', 2, (canvas, [x, y]) => canvas.translate(x, y)],
    ['Scale', 2, (canvas, [x, y]) => canvas.scale(x, y)],
    ['Scale', 4, (canvas, [x, y, px, py]) => { canvas.translate(px, py); canvas.scale(x, y); canvas.translate(-px, -py); }],
    ['Rotate', 1, (canvas, [degrees]) => canvas.rotate(degrees, 0, 0)],
    ['Rotate', 3, (canvas, [degrees, px, py]) => canvas.rotate(degrees, px, py)],
    ['Skew', 2, (canvas, [x, y]) => canvas.skew(x, y)],
    ['Skew', 4, (canvas, [x, y, px, py]) => { canvas.translate(px, py); canvas.skew(x, y); canvas.translate(-px, -py); }],
  ]) for (const mode of ['Set', 'Pre', 'Post']) add('n' + mode + suffix, ['J', ...Array(count).fill('F')], 'V', (runtime, [handle, ...values]) => {
    if (values.some(value => !Number.isFinite(value))) fail('Non-finite Matrix transform');
    const current = get(runtime, handle);
    const transformed = compose(runtime, mode === 'Pre' ? [current] : [], canvas => transform(canvas, values));
    put(runtime, handle, mode === 'Post' ? compose(runtime, [transformed, current]) : transformed);
  });
  add('nSetConcat', ['J', 'J', 'J'], 'V', (runtime, [handle, a, b]) => put(runtime, handle, compose(runtime, [get(runtime, a), get(runtime, b)])));
  for (const mode of ['Pre', 'Post']) add('n' + mode + 'Concat', ['J', 'J'], 'V', (runtime, [handle, other]) => put(runtime, handle, compose(runtime, (mode === 'Pre' ? [handle, other] : [other, handle]).map(id => get(runtime, id)))));
  add('nInvert', ['J', 'J'], 'Z', (runtime, [handle, inverse]) => {
    const result = backend(runtime).Matrix.invert(get(runtime, handle));
    if (!result || result.some(value => !Number.isFinite(value))) return 0;
    put(runtime, inverse, result); return 1;
  });
  add('nGetValues', ['J', '[F'], 'V', (runtime, [handle, array]) => { const target = runtime.array(array); if (target.type !== '[F' || target.elements.length < 9) fail('Matrix requires nine float values'); get(runtime, handle).forEach((value, i) => { target.elements[i] = encode(value); }); });
  add('nSetValues', ['J', '[F'], 'V', (runtime, [handle, array]) => { const source = runtime.array(array); if (source.type !== '[F' || source.elements.length < 9) fail('Matrix requires nine float values'); put(runtime, handle, source.elements.slice(0, 9).map(decode)); });
  add('nMapPoints', ['J', '[F', 'I', '[F', 'I', 'I', 'Z'], 'V', (runtime, [handle, dst, dstIndex, src, srcIndex, count, points]) => {
    const target = runtime.array(dst), source = runtime.array(src), size = count * 2;
    if (target.type !== '[F' || source.type !== '[F' || count < 0 || count > 524288 || srcIndex < 0 || dstIndex < 0 || srcIndex + size > source.elements.length || dstIndex + size > target.elements.length) fail('Invalid Matrix point buffer');
    const mapped = pointMap(runtime, get(runtime, handle), source.elements.slice(srcIndex, srcIndex + size).map(decode), !points);
    mapped.forEach((value, i) => { target.elements[dstIndex + i] = encode(value); });
  });
  add('nMapRect', ['J', RECT, RECT], 'Z', (runtime, [handle, dst, src]) => {
    const [left, top, right, bottom] = readRect(runtime, src), matrix = get(runtime, handle), points = pointMap(runtime, matrix, [left, top, right, top, right, bottom, left, bottom]);
    writeRect(runtime, dst, [Math.min(points[0], points[2], points[4], points[6]), Math.min(points[1], points[3], points[5], points[7]), Math.max(points[0], points[2], points[4], points[6]), Math.max(points[1], points[3], points[5], points[7])]); return keepsRect(matrix) ? 1 : 0;
  });
  return bindings;
}

/** Allocation ownership for this VM, which retains its Java heap until shutdown.
 * The returned Runnable really releases a registered matrix if explicitly run.
 * No native function pointer is executed and no per-object GC is fabricated.
 */
export function createMatrixAllocationHost() {
  const keys = new Set([`${REGISTRY}->createMalloced(Ljava/lang/ClassLoader;J)${REGISTRY}`, `${REGISTRY}->registerNativeAllocation(Ljava/lang/Object;J)Ljava/lang/Runnable;`, `${CLEANER}->run()V`]);
  return {
    supports: key => keys.has(key), parent: type => [REGISTRY, CLEANER].includes(type) ? 'Ljava/lang/Object;' : null,
    interfaces: type => type === CLEANER ? ['Ljava/lang/Runnable;'] : [],
    invoke(runtime, method, args) {
      if (method.name === 'createMalloced') { if (args[1] !== FINALIZER) fail('Native allocation finalizer is not connected'); const registry = runtime.makeObject(REGISTRY); runtime.object(registry).matrixFinalizer = FINALIZER; return registry; }
      if (method.name === 'registerNativeAllocation') {
        if (runtime.object(args[0]).matrixFinalizer !== FINALIZER) fail('Unknown native allocation registry');
        runtime.object(args[1]); get(runtime, args[2]);
        const cleaner = runtime.makeObject(CLEANER); runtime.object(cleaner).matrixHandle = args[2]; return cleaner;
      }
      if (method.owner === CLEANER && method.name === 'run') { const cleaner = runtime.object(args[0]); if (cleaner.matrixHandle) { stateFor(runtime).handles.delete(cleaner.matrixHandle); cleaner.matrixHandle = 0n; } return; }
      fail('Unsupported native allocation operation');
    },
  };
}

export function getMatrixValues(runtime, reference) { return get(runtime, runtime.object(reference).fields.get(`${MATRIX}->native_instance:J`)).slice(); }
