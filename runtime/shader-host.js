import { APKError } from './apk-error.js?v=6e138f531f83';
import { createHostRegistry } from './host-contract.js?v=6e138f531f83';
import { getMatrixValues } from './matrix-native.js?v=6e138f531f83';
// android.graphics.Shader / BitmapShader / Shader.TileMode. A BitmapShader samples a Bitmap's pixels at draw time (snapshot
// semantics, as the Bitmap host already does for drawBitmap); RippleDrawable uses an ALPHA_8 mask this way. Skia builds the
// real image shader when the recorded command is replayed (skia-canvas-host makePaint).
const SHADER = 'Landroid/graphics/Shader;', BITMAP_SHADER = 'Landroid/graphics/BitmapShader;', TILE = 'Landroid/graphics/Shader$TileMode;', BITMAP = 'Landroid/graphics/Bitmap;', MATRIX = 'Landroid/graphics/Matrix;';
const TILES = ['CLAMP', 'REPEAT', 'MIRROR'];
const fail = message => { throw new APKError(message, { kind: 'shader-unsupported' }); };
export function createShaderHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  type(SHADER, 'Ljava/lang/Object;', [], { allocatable: false }); type(BITMAP_SHADER, SHADER, [], { allocatable: true }); type(TILE, 'Ljava/lang/Enum;');
  for (const name of TILES) staticField(TILE, name, TILE, runtime => { const ref = runtime.makeObject(TILE), object = runtime.object(ref); object.enumName = name; object.enumOrdinal = TILES.indexOf(name); return ref; });
  const state = (runtime, ref) => { const shader = runtime.object(ref).webShader; if (!shader) fail('Shader used before construction'); return shader; };
  def(BITMAP_SHADER, '<init>', `(${BITMAP}${TILE}${TILE})V`, (runtime, method, [self, bitmap, tileX, tileY]) => {
    for (const value of [bitmap, tileX, tileY]) if (value === null || value === undefined || value === 0) runtime.throwJava('Ljava/lang/NullPointerException;', 'BitmapShader arguments must not be null');
    runtime.object(bitmap); runtime.object(self).webShader = { kind: 'bitmap', bitmap, tileX: runtime.object(tileX).enumOrdinal, tileY: runtime.object(tileY).enumOrdinal, matrix: null };
  });
  def(SHADER, 'setLocalMatrix', `(${MATRIX})V`, (runtime, method, [self, matrix]) => { state(runtime, self).matrix = matrix === null || matrix === undefined || matrix === 0 ? null : getMatrixValues(runtime, matrix); });
  def(SHADER, 'getLocalMatrix', `(${MATRIX})Z`, (runtime, method, [self, out]) => {
    const shader = state(runtime, self); if (!shader.matrix) return 0;
    const values = runtime.newArray('[F', 9); runtime.object(values).elements = shader.matrix.map(value => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, value, true); return d.getInt32(0, true); });
    runtime.dispatch({ owner: MATRIX, name: 'setValues', signature: '([F)V', parameters: ['[F'], result: 'V' }, [out, values], 'virtual'); return 1;
  });
  // android.graphics.RuntimeShader (AGSL): source and uniforms are kept so APK/AOSP code (RippleShader) constructs and configures it;
  // drawing one needs an SkSL runtime-effect backend and fails explicitly (RippleDrawable never draws it on a software Canvas).
  const RUNTIME = 'Landroid/graphics/RuntimeShader;', STR = 'Ljava/lang/String;', COLOR = 'Landroid/graphics/Color;';
  type(RUNTIME, SHADER, [], { allocatable: true });
  def(RUNTIME, '<init>', `(${STR})V`, (runtime, method, [self, source]) => { if (source === null || source === undefined || source === 0) runtime.throwJava('Ljava/lang/NullPointerException;', 'AGSL source is null'); runtime.object(self).webShader = { kind: 'runtime', source, uniforms: new Map(), inputs: new Map() }; });
  const uniform = (runtime, self, name, values) => { state(runtime, self).uniforms.set(name, values); };
  for (const signature of ['F', 'FF', 'FFF', 'FFFF']) def(RUNTIME, 'setFloatUniform', `(${STR}${signature})V`, (runtime, method, [self, name, ...values]) => uniform(runtime, self, name, values));
  def(RUNTIME, 'setFloatUniform', `(${STR}[F)V`, (runtime, method, [self, name, array]) => uniform(runtime, self, name, runtime.array(array).elements.slice()));
  def(RUNTIME, 'setColorUniform', `(${STR}I)V`, (runtime, method, [self, name, color]) => uniform(runtime, self, name, [color]));
  def(RUNTIME, 'setInputShader', `(${STR}${SHADER})V`, (runtime, method, [self, name, shader]) => { state(runtime, self).inputs.set(name, shader); });
  return {
    ...registry,
    /** Serializable description of a Paint's shader for the recorded draw command (pixels sampled now). */
    snapshot(runtime, ref) {
      const shader = runtime.object(ref).webShader; if (!shader) fail('This paint needs an implemented Shader drawing backend for this Shader type');
      if (shader.kind === 'runtime') fail('Drawing an AGSL RuntimeShader requires an SkSL runtime-effect backend');
      const source = runtime.skiaHost?.bitmaps?.shaderSource?.(shader.bitmap);
      if (!source) fail('BitmapShader needs the verified Skia Bitmap backend');
      return { kind: 'bitmap', raster: source.raster, alpha8: source.alpha8, width: source.width, height: source.height, tileX: shader.tileX, tileY: shader.tileY, matrix: shader.matrix };
    },
  };
}
