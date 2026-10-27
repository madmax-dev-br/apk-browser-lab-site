import { APKError } from './apk-error.js?v=64078a5322f4';
import { createHostRegistry, bitsFloat } from './host-contract.js?v=64078a5322f4';
import { getMatrixValues } from './matrix-native.js?v=64078a5322f4';
import { gcRoot } from './heap-gc.js?v=64078a5322f4';
// android.graphics.Shader / BitmapShader / Shader.TileMode. A BitmapShader samples a Bitmap's pixels at draw time (snapshot
// semantics, as the Bitmap host already does for drawBitmap); RippleDrawable uses an ALPHA_8 mask this way. Skia builds the
// real image shader when the recorded command is replayed (skia-canvas-host makePaint).
const SHADER = 'Landroid/graphics/Shader;', BITMAP_SHADER = 'Landroid/graphics/BitmapShader;', TILE = 'Landroid/graphics/Shader$TileMode;', BITMAP = 'Landroid/graphics/Bitmap;', MATRIX = 'Landroid/graphics/Matrix;';
const TILES = ['CLAMP', 'REPEAT', 'MIRROR'];
const fail = message => { throw new APKError(message, { kind: 'shader-unsupported' }); };
export function createShaderHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  type(SHADER, 'Ljava/lang/Object;', [], { allocatable: false }); type(BITMAP_SHADER, SHADER, [], { allocatable: true }); type(TILE, 'Ljava/lang/Enum;');
  const tileConstants = gcRoot(new Map());   // Shader.TileMode.CLAMP/REPEAT/MIRROR are singletons that live as long as the VM (the collector must not free them)
  for (const name of TILES) staticField(TILE, name, TILE, runtime => { if (!tileConstants.has(name)) { const ref = runtime.makeObject(TILE), object = runtime.object(ref); object.enumName = name; object.enumOrdinal = TILES.indexOf(name); tileConstants.set(name, ref); } return tileConstants.get(name); });
  const state = (runtime, ref) => { const shader = runtime.object(ref).webShader; if (!shader) fail('Shader used before construction'); return shader; };
  def(BITMAP_SHADER, '<init>', `(${BITMAP}${TILE}${TILE})V`, (runtime, method, [self, bitmap, tileX, tileY]) => {
    for (const value of [bitmap, tileX, tileY]) if (value === null || value === undefined || value === 0) runtime.throwJava('Ljava/lang/NullPointerException;', 'BitmapShader arguments must not be null');
    runtime.object(bitmap); runtime.object(self).webShader = { kind: 'bitmap', bitmap, tileX: runtime.object(tileX).enumOrdinal, tileY: runtime.object(tileY).enumOrdinal, matrix: null };
  });
  // ---- gradients and ComposeShader (Gradient.cpp: premultiplied interpolation, Skia builds the shader when the recorded command is replayed) ---------------------------------------------
  const LINEAR = 'Landroid/graphics/LinearGradient;', RADIAL = 'Landroid/graphics/RadialGradient;', SWEEP = 'Landroid/graphics/SweepGradient;', COMPOSE = 'Landroid/graphics/ComposeShader;', PORTER = 'Landroid/graphics/PorterDuff$Mode;', BLEND = 'Landroid/graphics/BlendMode;';
  for (const owner of [LINEAR, RADIAL, SWEEP, COMPOSE]) type(owner, SHADER, [], { allocatable: true });
  const PORTER_TO_SKIA = { CLEAR: 0, SRC: 1, DST: 2, SRC_OVER: 3, DST_OVER: 4, SRC_IN: 5, DST_IN: 6, SRC_OUT: 7, DST_OUT: 8, SRC_ATOP: 9, DST_ATOP: 10, XOR: 11, ADD: 12, SCREEN: 14, OVERLAY: 15, DARKEN: 16, LIGHTEN: 17, MULTIPLY: 24 };
  const isNull = v => v === null || v === undefined || v === 0;
  const colorsOf = (runtime, ref, positionsRef, extra = 0) => {
    if (isNull(ref)) runtime.throwJava('Ljava/lang/NullPointerException;', 'colors array must not be null');
    const colors = runtime.array(ref).elements.map(c => c | 0);
    if (colors.length < 2) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'needs >= 2 number of colors');
    let positions = null;
    if (!isNull(positionsRef)) { positions = runtime.array(positionsRef).elements.map(bitsFloat); if (positions.length < colors.length) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'color and position arrays must be of equal length'); positions = positions.slice(0, colors.length); }
    return { colors, positions };
  };
  const tile = (runtime, ref) => { if (isNull(ref)) runtime.throwJava('Ljava/lang/NullPointerException;', 'tile mode must not be null'); return runtime.object(ref).enumOrdinal; };
  const two = (c0, c1) => ({ colors: [c0 | 0, c1 | 0], positions: null });
  const F = 'F', I = 'I', IA = '[I', FA = '[F';
  def(LINEAR, '<init>', `(${F}${F}${F}${F}${I}${I}${TILE})V`, (r, _m, [self, x0, y0, x1, y1, c0, c1, t]) => { r.object(self).webShader = { kind: 'linear', p0: [bitsFloat(x0), bitsFloat(y0)], p1: [bitsFloat(x1), bitsFloat(y1)], ...two(c0, c1), tile: tile(r, t), matrix: null }; });
  def(LINEAR, '<init>', `(${F}${F}${F}${F}${IA}${FA}${TILE})V`, (r, _m, [self, x0, y0, x1, y1, colors, pos, t]) => { r.object(self).webShader = { kind: 'linear', p0: [bitsFloat(x0), bitsFloat(y0)], p1: [bitsFloat(x1), bitsFloat(y1)], ...colorsOf(r, colors, pos), tile: tile(r, t), matrix: null }; });
  def(RADIAL, '<init>', `(${F}${F}${F}${I}${I}${TILE})V`, (r, _m, [self, cx, cy, radius, c0, c1, t]) => { checkRadius(r, radius); r.object(self).webShader = { kind: 'radial', center: [bitsFloat(cx), bitsFloat(cy)], radius: bitsFloat(radius), ...two(c0, c1), tile: tile(r, t), matrix: null }; });
  def(RADIAL, '<init>', `(${F}${F}${F}${IA}${FA}${TILE})V`, (r, _m, [self, cx, cy, radius, colors, pos, t]) => { checkRadius(r, radius); r.object(self).webShader = { kind: 'radial', center: [bitsFloat(cx), bitsFloat(cy)], radius: bitsFloat(radius), ...colorsOf(r, colors, pos), tile: tile(r, t), matrix: null }; });
  def(RADIAL, '<init>', `(${F}${F}${F}${F}${F}${F}${IA}${FA}${TILE})V`, (r, _m, [self, cx, cy, radius, fx, fy, fr, colors, pos, t]) => void (fr, checkRadius(r, radius), r.object(self).webShader = { kind: 'radial', center: [bitsFloat(cx), bitsFloat(cy)], radius: bitsFloat(radius), focal: [bitsFloat(fx), bitsFloat(fy)], ...colorsOf(r, colors, pos), tile: tile(r, t), matrix: null }));
  const checkRadius = (r, bits) => { if (!(bitsFloat(bits) > 0)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'radius must be > 0'); };
  def(SWEEP, '<init>', `(${F}${F}${I}${I})V`, (r, _m, [self, cx, cy, c0, c1]) => { r.object(self).webShader = { kind: 'sweep', center: [bitsFloat(cx), bitsFloat(cy)], ...two(c0, c1), matrix: null }; });
  def(SWEEP, '<init>', `(${F}${F}${IA}${FA})V`, (r, _m, [self, cx, cy, colors, pos]) => { r.object(self).webShader = { kind: 'sweep', center: [bitsFloat(cx), bitsFloat(cy)], ...colorsOf(r, colors, pos), matrix: null }; });
  const compose = (r, self, dst, src, blend) => { if (isNull(dst) || isNull(src)) r.throwJava('Ljava/lang/NullPointerException;', 'ComposeShader shaders must not be null'); state(r, dst); state(r, src); r.object(self).webShader = { kind: 'compose', dst, src, blend, matrix: null }; };
  def(COMPOSE, '<init>', `(${SHADER}${SHADER}${PORTER})V`, (r, _m, [self, dst, src, mode]) => { if (isNull(mode)) r.throwJava('Ljava/lang/NullPointerException;', 'mode must not be null'); compose(r, self, dst, src, PORTER_TO_SKIA[r.object(mode).enumName]); });
  def(COMPOSE, '<init>', `(${SHADER}${SHADER}${BLEND})V`, (r, _m, [self, dst, src, mode]) => { if (isNull(mode)) r.throwJava('Ljava/lang/NullPointerException;', 'blendMode must not be null'); compose(r, self, dst, src, r.dispatch({ owner: BLEND, name: 'ordinal', parameters: [], result: 'I', signature: '()I' }, [mode], 'virtual')); });   // BlendMode's declaration order is SkBlendMode's
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
  const uniform = (runtime, self, name, values, color = false) => { if (name === null || name === undefined) runtime.throwJava('Ljava/lang/NullPointerException;', 'uniform name must not be null'); state(runtime, self).uniforms.set(runtime.javaString ? runtime.javaString(name) : name, { values, color }); };
  for (const signature of ['F', 'FF', 'FFF', 'FFFF']) def(RUNTIME, 'setFloatUniform', `(${STR}${signature})V`, (runtime, method, [self, name, ...values]) => uniform(runtime, self, name, values));
  def(RUNTIME, 'setFloatUniform', `(${STR}[F)V`, (runtime, method, [self, name, array]) => uniform(runtime, self, name, runtime.array(array).elements.slice()));
  def(RUNTIME, 'setColorUniform', `(${STR}I)V`, (runtime, method, [self, name, color]) => uniform(runtime, self, name, [color], true));
  def(RUNTIME, 'setInputShader', `(${STR}${SHADER})V`, (runtime, method, [self, name, shader]) => { state(runtime, self).inputs.set(runtime.javaString ? runtime.javaString(name) : name, shader); });
  // RuntimeShader.getNativeShaderBuilder(): the token RecordingCanvas.nDrawRipple receives; the recorded op resolves it back to this shader's uniforms.
  const builders = new Map(); let nextBuilder = 0x7a000000n;
  def(RUNTIME, 'getNativeShaderBuilder', '()J', (runtime, method, [self]) => { const object = runtime.object(self); if (!object.shaderBuilderHandle) { object.shaderBuilderHandle = nextBuilder++; builders.set(object.shaderBuilderHandle, self); } return object.shaderBuilderHandle; });
  return {
    ...registry,
    /** The RuntimeShader a getNativeShaderBuilder() token names. */
    builderShader(handle) { const ref = builders.get(BigInt(handle)); if (!ref) fail('Invalid RuntimeShader builder token'); return ref; },
    /** Serializable description of a Paint's shader for the recorded draw command (pixels sampled now). */
    snapshot(runtime, ref) {
      const shader = runtime.object(ref).webShader; if (!shader) fail('This paint needs an implemented Shader drawing backend for this Shader type');
      if (shader.kind === 'runtime') {   // AGSL source + the uniform values set so far; Skia compiles the SkSL runtime effect when the recorded command is replayed
        const f32 = new DataView(new ArrayBuffer(4)), decode = bits => { f32.setInt32(0, bits | 0, true); return f32.getFloat32(0, true); };
        const uniforms = [...shader.uniforms].map(([name, { values, color }]) => ({ name, values: color ? [((values[0] >>> 16) & 255) / 255, ((values[0] >>> 8) & 255) / 255, (values[0] & 255) / 255, (values[0] >>> 24) / 255] : values.map(decode), color }));
        const inputs = [...shader.inputs].map(([name, child]) => [name, this.snapshot(runtime, child)]);
        return { kind: 'runtime', source: typeof shader.source === 'string' ? shader.source : runtime.javaString(shader.source), uniforms, inputs, matrix: shader.matrix ?? null };
      }
      if (shader.kind === 'linear' || shader.kind === 'radial' || shader.kind === 'sweep') return { ...shader, matrix: shader.matrix ?? null };
      if (shader.kind === 'compose') return { kind: 'compose', dst: this.snapshot(runtime, shader.dst), src: this.snapshot(runtime, shader.src), blend: shader.blend, matrix: shader.matrix ?? null };
      const source = runtime.skiaHost?.bitmaps?.shaderSource?.(shader.bitmap);
      if (!source) fail('BitmapShader needs the verified Skia Bitmap backend');
      return { kind: 'bitmap', raster: source.raster, alpha8: source.alpha8, width: source.width, height: source.height, tileX: shader.tileX, tileY: shader.tileY, matrix: shader.matrix };
    },
  };
}
