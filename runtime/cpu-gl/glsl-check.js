// The semantic pass of the lab's GLSL ES compiler (docs/OPENGL-ES-ON-CPU.md): scopes and symbols, the types of every expression (GLSL ES has no implicit conversions), the
// built-in variables and functions of 1.00 and 3.00 per stage, constant expressions (array sizes, const variables), and the checks a conformant compiler makes (undeclared names,
// mismatched operands, l-values, returns, loop and switch jumps). It annotates the AST in place for the code generator (src/cpu-gl/glsl-codegen.js). No process.*.
import { GlslError, preprocess, parse } from './glsl-parse.js?v=c542646b3fce';
import { VOID, FLOAT, INT, UINT, BOOL, scalar, vec, mat, array, sampler, struct, basicType, comps, isNumeric, isInteger, isBoolean, same, fieldOffset, containsSampler, containsArray } from './glsl-types.js?v=c542646b3fce';

const fail = (message, line) => { throw new GlslError(message, line); };

// ---- built-in functions -------------------------------------------------------------------------------------------------------------------------------------------------------
// Signatures in a small notation: "ret name(param, ...)"; genType = float/vec2/vec3/vec4 (the same size within a signature), genIType / genUType / genBType likewise, vec / ivec /
// uvec / bvec = sizes 2-4. `out T` marks an out parameter. Flags: v (vertex only), f (fragment only), d (needs derivatives in 1.00), x (an extension of 1.00).
const COMMON = [
  'genType radians(genType)', 'genType degrees(genType)', 'genType sin(genType)', 'genType cos(genType)', 'genType tan(genType)', 'genType asin(genType)', 'genType acos(genType)',
  'genType atan(genType, genType)', 'genType atan(genType)', 'genType pow(genType, genType)', 'genType exp(genType)', 'genType log(genType)', 'genType exp2(genType)', 'genType log2(genType)',
  'genType sqrt(genType)', 'genType inversesqrt(genType)', 'genType abs(genType)', 'genType sign(genType)', 'genType floor(genType)', 'genType ceil(genType)', 'genType fract(genType)',
  'genType mod(genType, float)', 'genType mod(genType, genType)', 'genType min(genType, genType)', 'genType min(genType, float)', 'genType max(genType, genType)', 'genType max(genType, float)',
  'genType clamp(genType, genType, genType)', 'genType clamp(genType, float, float)', 'genType mix(genType, genType, genType)', 'genType mix(genType, genType, float)',
  'genType step(genType, genType)', 'genType step(float, genType)', 'genType smoothstep(genType, genType, genType)', 'genType smoothstep(float, float, genType)',
  'float length(genType)', 'float distance(genType, genType)', 'float dot(genType, genType)', 'vec3 cross(vec3, vec3)', 'genType normalize(genType)', 'genType faceforward(genType, genType, genType)',
  'genType reflect(genType, genType)', 'genType refract(genType, genType, float)',
  'bvec lessThan(vec, vec)', 'bvec lessThan(ivec, ivec)', 'bvec lessThanEqual(vec, vec)', 'bvec lessThanEqual(ivec, ivec)', 'bvec greaterThan(vec, vec)', 'bvec greaterThan(ivec, ivec)',
  'bvec greaterThanEqual(vec, vec)', 'bvec greaterThanEqual(ivec, ivec)', 'bvec equal(vec, vec)', 'bvec equal(ivec, ivec)', 'bvec equal(bvec, bvec)', 'bvec notEqual(vec, vec)', 'bvec notEqual(ivec, ivec)',
  'bvec notEqual(bvec, bvec)', 'bool any(bvec)', 'bool all(bvec)', 'bvec not(bvec)',
];
const ONLY_100 = [
  'vec4 texture2D(sampler2D, vec2)', 'vec4 texture2D(sampler2D, vec2, float):f', 'vec4 texture2DProj(sampler2D, vec3)', 'vec4 texture2DProj(sampler2D, vec3, float):f', 'vec4 texture2DProj(sampler2D, vec4)',
  'vec4 texture2DProj(sampler2D, vec4, float):f', 'vec4 texture2DLod(sampler2D, vec2, float):v', 'vec4 texture2DProjLod(sampler2D, vec3, float):v', 'vec4 texture2DProjLod(sampler2D, vec4, float):v',
  'vec4 textureCube(samplerCube, vec3)', 'vec4 textureCube(samplerCube, vec3, float):f', 'vec4 textureCubeLod(samplerCube, vec3, float):v',
  'vec4 texture2D(samplerExternalOES, vec2)', 'vec4 texture2DProj(samplerExternalOES, vec3)', 'vec4 texture2DProj(samplerExternalOES, vec4)',
  'vec4 texture2DLodEXT(sampler2D, vec2, float):fx', 'vec4 texture2DProjLodEXT(sampler2D, vec3, float):fx', 'vec4 texture2DProjLodEXT(sampler2D, vec4, float):fx', 'vec4 textureCubeLodEXT(samplerCube, vec3, float):fx',
  'vec4 texture2DGradEXT(sampler2D, vec2, vec2, vec2):fx', 'vec4 texture2DProjGradEXT(sampler2D, vec3, vec2, vec2):fx', 'vec4 texture2DProjGradEXT(sampler2D, vec4, vec2, vec2):fx', 'vec4 textureCubeGradEXT(samplerCube, vec3, vec3, vec3):fx',
  'genType dFdx(genType):fd', 'genType dFdy(genType):fd', 'genType fwidth(genType):fd',
  'mat2 matrixCompMult(mat2, mat2)', 'mat3 matrixCompMult(mat3, mat3)', 'mat4 matrixCompMult(mat4, mat4)',
];
const ONLY_300 = [
  'genType sinh(genType)', 'genType cosh(genType)', 'genType tanh(genType)', 'genType asinh(genType)', 'genType acosh(genType)', 'genType atanh(genType)',
  'genIType abs(genIType)', 'genIType sign(genIType)', 'genType trunc(genType)', 'genType round(genType)', 'genType roundEven(genType)', 'genType modf(genType, out genType)',
  'genIType min(genIType, genIType)', 'genIType min(genIType, int)', 'genUType min(genUType, genUType)', 'genUType min(genUType, uint)', 'genIType max(genIType, genIType)', 'genIType max(genIType, int)',
  'genUType max(genUType, genUType)', 'genUType max(genUType, uint)', 'genIType clamp(genIType, genIType, genIType)', 'genIType clamp(genIType, int, int)', 'genUType clamp(genUType, genUType, genUType)',
  'genUType clamp(genUType, uint, uint)', 'genType mix(genType, genType, genBType)', 'genBType isnan(genType)', 'genBType isinf(genType)', 'genIType floatBitsToInt(genType)', 'genUType floatBitsToUint(genType)',
  'genType intBitsToFloat(genIType)', 'genType uintBitsToFloat(genUType)', 'uint packSnorm2x16(vec2)', 'vec2 unpackSnorm2x16(uint)', 'uint packUnorm2x16(vec2)', 'vec2 unpackUnorm2x16(uint)',
  'uint packHalf2x16(vec2)', 'vec2 unpackHalf2x16(uint)',
  'bvec lessThan(uvec, uvec)', 'bvec lessThanEqual(uvec, uvec)', 'bvec greaterThan(uvec, uvec)', 'bvec greaterThanEqual(uvec, uvec)', 'bvec equal(uvec, uvec)', 'bvec notEqual(uvec, uvec)',
  'genType dFdx(genType):f', 'genType dFdy(genType):f', 'genType fwidth(genType):f',
];
// ES 3.00 texture functions (8.8): per sampler kind, the coordinate type P, the integer coordinate / offset types, and the size type
const TEX_KINDS = [
  { s: ['sampler2D', 'isampler2D', 'usampler2D'], P: 'vec2', proj: ['vec3', 'vec4'], I: 'ivec2', off: 'ivec2', size: 'ivec2', lodGrad: 'vec2', fetch: true },
  { s: ['sampler3D', 'isampler3D', 'usampler3D'], P: 'vec3', proj: ['vec4'], I: 'ivec3', off: 'ivec3', size: 'ivec3', lodGrad: 'vec3', fetch: true },
  { s: ['samplerCube', 'isamplerCube', 'usamplerCube'], P: 'vec3', proj: [], size: 'ivec2', lodGrad: 'vec3' },
  { s: ['sampler2DArray', 'isampler2DArray', 'usampler2DArray'], P: 'vec3', proj: [], I: 'ivec3', off: 'ivec2', size: 'ivec3', lodGrad: 'vec2', fetch: true },
  { s: ['sampler2DShadow'], P: 'vec3', proj: ['vec4'], off: 'ivec2', size: 'ivec2', lodGrad: 'vec2', shadow: true },
  { s: ['samplerCubeShadow'], P: 'vec4', proj: [], size: 'ivec2', lodGrad: 'vec3', shadow: true, noLod: true },
  { s: ['sampler2DArrayShadow'], P: 'vec4', proj: [], off: 'ivec2', size: 'ivec3', lodGrad: 'vec2', shadow: true, noLod: true, noBias: true },
];
function textureSignatures() {
  const out = [];
  for (const kind of TEX_KINDS) for (const s of kind.s) {
    const g = kind.shadow ? 'float' : s.startsWith('i') ? 'ivec4' : s.startsWith('u') ? 'uvec4' : 'vec4';
    out.push(`${kind.size} textureSize(${s}, int)`);
    out.push(`${g} texture(${s}, ${kind.P})`); if (!kind.noBias) out.push(`${g} texture(${s}, ${kind.P}, float):f`);
    for (const p of kind.proj) { out.push(`${g} textureProj(${s}, ${p})`, `${g} textureProj(${s}, ${p}, float):f`, `${g} textureProjLod(${s}, ${p}, float)`, `${g} textureProjGrad(${s}, ${p}, ${kind.lodGrad}, ${kind.lodGrad})`); if (kind.off) out.push(`${g} textureProjOffset(${s}, ${p}, ${kind.off})`, `${g} textureProjOffset(${s}, ${p}, ${kind.off}, float):f`, `${g} textureProjLodOffset(${s}, ${p}, float, ${kind.off})`, `${g} textureProjGradOffset(${s}, ${p}, ${kind.lodGrad}, ${kind.lodGrad}, ${kind.off})`); }
    if (!kind.noLod) out.push(`${g} textureLod(${s}, ${kind.P}, float)`);
    out.push(`${g} textureGrad(${s}, ${kind.P}, ${kind.lodGrad}, ${kind.lodGrad})`);
    if (kind.off) { out.push(`${g} textureOffset(${s}, ${kind.P}, ${kind.off})`, `${g} textureGradOffset(${s}, ${kind.P}, ${kind.lodGrad}, ${kind.lodGrad}, ${kind.off})`); if (!kind.noBias) out.push(`${g} textureOffset(${s}, ${kind.P}, ${kind.off}, float):f`); if (!kind.noLod) out.push(`${g} textureLodOffset(${s}, ${kind.P}, float, ${kind.off})`); }
    if (kind.fetch) out.push(`${g} texelFetch(${s}, ${kind.I}, int)`, `${g} texelFetchOffset(${s}, ${kind.I}, int, ${kind.off})`);
  }
  out.push('vec4 texture(samplerExternalOES, vec2)', 'vec4 textureProj(samplerExternalOES, vec3)', 'vec4 textureProj(samplerExternalOES, vec4)', 'ivec2 textureSize(samplerExternalOES, int)');
  return out;
}
const MATRIX_300 = () => {
  const out = [];
  for (let c = 2; c <= 4; c++) for (let r = 2; r <= 4; r++) {
    const m = mat(c, r).name, t = mat(r, c).name;
    out.push(`${m} matrixCompMult(${m}, ${m})`, `${m} outerProduct(vec${r}, vec${c})`, `${t} transpose(${m})`);
  }
  for (let n = 2; n <= 4; n++) out.push(`float determinant(mat${n})`, `mat${n} inverse(mat${n})`);
  return out;
};
function expand(spec) {
  const m = /^(\S+) (\w+)\((.*)\)(?::(\w+))?$/.exec(spec); if (!m) throw new Error(`internal: builtin ${spec}`);
  const [, ret, name, list, flags = ''] = m, params = list ? list.split(', ') : [];
  const tokens = [ret, ...params].join(' ');
  const gen = /gen[IUB]?Type/.test(tokens), sized = /\b[biu]?vec\b/.test(tokens);
  const sizes = gen ? [1, 2, 3, 4] : sized ? [2, 3, 4] : [0];
  const out = [];
  for (const n of sizes) {
    const sub = s => {
      const outParam = s.startsWith('out '); const base = outParam ? s.slice(4) : s;
      const t = base === 'genType' ? vec('float', n) : base === 'genIType' ? vec('int', n) : base === 'genUType' ? vec('uint', n) : base === 'genBType' ? vec('bool', n)
        : base === 'vec' ? vec('float', n) : base === 'ivec' ? vec('int', n) : base === 'uvec' ? vec('uint', n) : base === 'bvec' ? vec('bool', n) : basicType(base);
      if (!t) throw new Error(`internal: builtin type ${base}`);
      return { t, out: outParam };
    };
    const ps = params.map(sub);
    out.push({ name, ret: sub(ret).t, params: ps.map(p => p.t), outs: ps.map(p => p.out), vertexOnly: flags.includes('v'), fragmentOnly: flags.includes('f'), derivative: flags.includes('d'), extension: flags.includes('x') });
  }
  return out;
}
const builtinTables = {};
function builtinsFor(version) {
  if (builtinTables[version]) return builtinTables[version];
  const map = new Map();
  for (const spec of [...COMMON, ...(version === 300 ? [...ONLY_300, ...textureSignatures(), ...MATRIX_300()] : ONLY_100)]) for (const sig of expand(spec)) { if (!map.has(sig.name)) map.set(sig.name, []); map.get(sig.name).push(sig); }
  builtinTables[version] = map; return map;
}
/** Texture calls that take implicit derivatives of their coordinate (in a fragment shader): the coordinate's screen-space gradient selects the mip level. */
export const IMPLICIT_LOD = new Set(['texture2D', 'texture2DProj', 'textureCube', 'texture', 'textureProj', 'textureOffset', 'textureProjOffset']);

// ---- constants ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const F32 = new Float32Array(1), I32 = new Int32Array(F32.buffer), U32 = new Uint32Array(F32.buffer);
const f32 = Math.fround;
/** A scalar of base type b as a JS number (floats rounded to float32, ints wrapped). */
export function coerce(b, v) { return b === 'float' ? f32(v) : b === 'int' ? v | 0 : b === 'uint' ? v >>> 0 : v ? 1 : 0; }
const FOLD = {
  radians: x => x * Math.PI / 180, degrees: x => x * 180 / Math.PI, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, sqrt: Math.sqrt, inversesqrt: x => 1 / Math.sqrt(x),
  exp: Math.exp, log: Math.log, exp2: x => 2 ** x, log2: Math.log2, floor: Math.floor, ceil: Math.ceil, fract: x => x - Math.floor(x), trunc: Math.trunc, round: Math.round, sign: Math.sign, abs: Math.abs,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh, atanh: Math.atanh,
};
const FOLD2 = { pow: (x, y) => x ** y, min: Math.min, max: Math.max, mod: (x, y) => x - y * Math.floor(x / y), atan: Math.atan2, step: (e, x) => (x < e ? 0 : 1) };

// ---- the checker --------------------------------------------------------------------------------------------------------------------------------------------------------------
const SWIZZLE_SETS = ['xyzw', 'rgba', 'stpq'];
export function swizzleOf(name, size, line) {
  if (name.length > 4) fail(`'${name}' : illegal vector field selection`, line);
  const set = SWIZZLE_SETS.find(s => s.includes(name[0])); if (!set) fail(`'${name}' : illegal vector field selection`, line);
  return [...name].map(ch => { const i = set.indexOf(ch); if (i < 0 || i >= size) fail(`'${name}' : vector field selection out of range`, line); return i; });
}
let symbolIds = 0;
const newSym = (props) => ({ id: ++symbolIds, ...props });

/**
 * Compiles a shader's source through the front end and this pass. Returns { ok: true, shader, log } or { ok: false, log }.
 * shader: { version, stage, ast, main, functions, globals, uniforms, blocks, inputs, outputs, builtins (used gl_ names), usesDiscard, writesDepth, derivativeSites, extensions }.
 */
export function checkShader(source, stage) {
  try {
    const pp = preprocess(source), ast = parse(pp);
    const shader = new Checker(pp, ast, stage).run();
    return { ok: true, shader, log: shader.warnings.map(w => `WARNING: 0:${w.line}: ${w.message}\n`).join('') };
  } catch (error) {
    if (error instanceof GlslError) return { ok: false, log: `ERROR: 0:${error.line}: ${error.message}\n` };
    return { ok: false, log: `ERROR: 0:0: internal compiler error: ${error?.message ?? error}\n` };
  }
}

class Checker {
  constructor(pp, ast, stage) {
    this.version = pp.version; this.stage = stage; this.ast = ast; this.extensions = pp.extensions;
    this.scopes = [new Map()]; this.functions = new Map(); this.builtins = builtinsFor(this.version); this.warnings = [];
    this.shader = { version: this.version, stage, ast, main: null, functions: [], globals: [], uniforms: [], blocks: [], inputs: [], outputs: [], builtins: new Set(), usesDiscard: false, writesDepth: false,
      derivativeSites: [], extensions: pp.extensions, warnings: this.warnings, defaultPrecision: new Map(), layoutDefaults: { rowMajor: false } };
    this.declareBuiltins();
  }
  ext(name) { const b = this.extensions.get(name); return b === 'enable' || b === 'require' || b === 'warn' || (this.extensions.get('all') === 'warn'); }
  declareBuiltins() {
    const g = this.scopes[0], v3 = this.version === 300;
    const builtin = (name, type, storage, extra = {}) => g.set(name, newSym({ name, type, kind: 'var', storage, builtin: name, line: 0, ...extra }));
    const constant = (name, value) => builtin(name, INT, 'const', { constValue: [value] });
    constant('gl_MaxVertexAttribs', 16); constant('gl_MaxVertexUniformVectors', 256); constant('gl_MaxVertexTextureImageUnits', 16); constant('gl_MaxCombinedTextureImageUnits', 32);
    constant('gl_MaxTextureImageUnits', 16); constant('gl_MaxFragmentUniformVectors', 224); constant('gl_MaxDrawBuffers', 4);
    if (v3) { constant('gl_MaxVertexOutputVectors', 16); constant('gl_MaxFragmentInputVectors', 15); constant('gl_MinProgramTexelOffset', -8); constant('gl_MaxProgramTexelOffset', 7); }
    else constant('gl_MaxVaryingVectors', 15);
    const range = struct('gl_DepthRangeParameters', [{ name: 'near', type: FLOAT }, { name: 'far', type: FLOAT }, { name: 'diff', type: FLOAT }]);
    builtin('gl_DepthRange', range, 'uniform');
    if (this.stage === 'vertex') {
      builtin('gl_Position', vec('float', 4), 'out'); builtin('gl_PointSize', FLOAT, 'out');
      if (v3) { builtin('gl_VertexID', INT, 'in', { readonly: true }); builtin('gl_InstanceID', INT, 'in', { readonly: true }); }
    } else {
      builtin('gl_FragCoord', vec('float', 4), 'in', { readonly: true }); builtin('gl_FrontFacing', BOOL, 'in', { readonly: true }); builtin('gl_PointCoord', vec('float', 2), 'in', { readonly: true });
      if (v3) builtin('gl_FragDepth', FLOAT, 'out');
      else { builtin('gl_FragColor', vec('float', 4), 'out'); builtin('gl_FragData', array(vec('float', 4), 4), 'out'); builtin('gl_FragDepthEXT', FLOAT, 'out', { extension: 'GL_EXT_frag_depth' }); }
    }
  }
  warn(message, line) { this.warnings.push({ message, line }); }
  push() { this.scopes.push(new Map()); } pop() { this.scopes.pop(); }
  lookup(name) { for (let i = this.scopes.length - 1; i >= 0; i--) { const s = this.scopes[i].get(name); if (s) return s; } return null; }
  declare(sym, line) {
    const scope = this.scopes.at(-1);
    if (sym.name.startsWith('gl_')) fail(`'${sym.name}' : identifiers starting with "gl_" are reserved`, line);
    const previous = scope.get(sym.name);
    if (previous && !(previous.kind === 'fn' && sym.kind === 'fn')) fail(`'${sym.name}' : redefinition`, line);
    if (this.scopes.length === 2 && this.functionScopeParams?.has(sym.name) && this.version === 100) { /* a local hiding a parameter is a redefinition in 1.00 (same scope) */ }
    scope.set(sym.name, sym); return sym;
  }

  // types
  resolveType(spec, line) {
    let t;
    if (spec.struct) {
      const fields = spec.struct.fields.map(f => {
        let ft = this.resolveType(f.type, f.line);
        if (f.array) ft = this.arrayOf(ft, f.array, f.line);
        if (ft.k === 'void') fail(`'${f.name}' : illegal use of type 'void'`, f.line);
        return { name: f.name, type: ft };
      });
      const names = new Set(); for (const f of fields) { if (names.has(f.name)) fail(`'${f.name}' : duplicate field name in structure`, line); names.add(f.name); }
      t = struct(spec.struct.name, fields);
      if (spec.struct.name) this.declareStruct(spec.struct.name, t, line);
      spec.resolved = t;
    } else if (spec.resolved) t = spec.resolved;
    else {
      t = basicType(spec.name);
      if (!t) { const s = this.lookup(spec.name); if (!s || s.kind !== 'struct') fail(`'${spec.name}' : unknown type`, line); t = s.type; }
      if (t.k === 'sampler' && t.external && this.version === 100) fail(`'${spec.name}' : requires extension GL_OES_EGL_image_external, which is not available (no EGLImage / external textures)`, line);
      if (t.k === 'sampler' && t.external) fail(`'${spec.name}' : requires extension GL_OES_EGL_image_external_essl3, which is not available`, line);
    }
    if (spec.array) t = this.arrayOf(t, spec.array, line);
    return t;
  }
  declareStruct(name, t, line) {
    const scope = this.scopes.at(-1); if (scope.has(name)) fail(`'${name}' : redefinition`, line);
    scope.set(name, newSym({ name, kind: 'struct', type: t, line }));
  }
  arrayOf(t, suffix, line, init = null) {
    if (t.k === 'array') fail("'[' : arrays of arrays are not allowed in GLSL ES", line);
    let len;
    if (suffix.size === null) {
      if (this.version !== 300 || !init) fail("'[]' : an array needs a size", line);
      this.expr(init); if (init.type.k !== 'array') fail("'=' : cannot convert to an array", line); len = init.type.len;
    } else {
      this.expr(suffix.size); const c = suffix.size.const;
      if (!c || !isInteger(suffix.size.type) || suffix.size.type.k !== 'scalar') fail("'[' : array size must be a constant integer expression", line);
      len = c[0]; if (len <= 0) fail("'[' : array size must be greater than zero", line);
    }
    return array(t, len);
  }

  run() {
    for (const d of this.ast.decls) this.external(d);
    const main = this.functions.get('main')?.find(f => f.params.length === 0 && f.body);
    if (!main) fail("'main' : function main() is not defined", this.ast.decls.at(-1)?.line ?? 0);
    if (main.ret !== VOID) fail("'main' : main must return void", main.line);
    this.shader.main = main;
    for (const list of this.functions.values()) for (const f of list) if (f.called && !f.body && !f.builtinFn) fail(`'${f.name}' : function is declared but not defined`, f.line);
    this.checkRecursion(main);
    return this.shader;
  }
  checkRecursion(main) {
    const state = new Map();
    const visit = f => {
      if (state.get(f) === 1) fail(`'${f.name}' : recursion is not allowed`, f.line); if (state.get(f) === 2) return;
      state.set(f, 1); for (const g of f.calls) visit(g); state.set(f, 2);
    };
    visit(main);
    this.shader.functions = [...this.functions.values()].flat().filter(f => state.get(f) === 2);
  }

  external(d) {
    switch (d.kind) {
      case 'Precision': {
        const t = basicType(d.type.name); if (!t || !(t === FLOAT || t === INT || t.k === 'sampler')) fail(`'${d.type.name}' : precision can only be set for float, int and sampler types`, d.line);
        this.shader.defaultPrecision.set(d.type.name, d.precision); return;
      }
      case 'Invariant': for (const name of d.names) { const s = this.lookup(name); if (!s || s.kind !== 'var') fail(`'${name}' : undeclared identifier`, d.line); s.invariant = true; } return;
      case 'DefaultLayout': if (d.q.layout?.row_major) this.shader.layoutDefaults.rowMajor = true; if (d.q.layout?.column_major) this.shader.layoutDefaults.rowMajor = false; return;
      case 'Block': return this.block(d);
      case 'VarDecl': return this.varDecl(d, true);
      case 'Function': return this.functionDecl(d);
      default: fail(`'${d.kind}' : unexpected declaration`, d.line);
    }
  }
  block(d) {
    if (d.q.storage !== 'uniform') fail(`'${d.blockName}' : only uniform blocks are allowed in GLSL ES 3.00`, d.line);
    const rowMajorDefault = d.q.layout?.row_major ? true : d.q.layout?.column_major ? false : this.shader.layoutDefaults.rowMajor;
    const fields = d.members.map(m => { let t = this.resolveType(m.type, m.line); if (m.array) t = this.arrayOf(t, m.array, m.line); if (containsSampler(t)) fail(`'${m.name}' : samplers are not allowed in uniform blocks`, m.line); return { name: m.name, type: t, rowMajor: m.layout?.row_major ? true : m.layout?.column_major ? false : rowMajorDefault, line: m.line }; });
    const type = struct(d.blockName, fields);
    const info = { name: d.blockName, type, fields, instance: d.instance, binding: 0, layout: d.q.layout?.packed ? 'packed' : d.q.layout?.shared ? 'shared' : 'std140', line: d.line, array: null };
    if (d.array) fail(`'${d.instance}' : arrays of uniform blocks are not supported by the lab's compiler`, d.line);
    this.shader.blocks.push(info);
    if (d.instance) { const s = this.declare(newSym({ name: d.instance, type, kind: 'var', storage: 'uniform', block: info, line: d.line }), d.line); info.symbol = s; }
    else for (const f of fields) { const s = this.declare(newSym({ name: f.name, type: f.type, kind: 'var', storage: 'uniform', block: info, member: f, line: f.line }), f.line); f.symbol = s; }
  }
  varDecl(d, global) {
    const q = d.q; let base = this.resolveType(d.type, d.line);
    let storage = q.storage;
    if (storage === 'inout' || (!global && storage && storage !== 'const')) fail(`'${storage}' : only const may qualify a local variable`, d.line);
    if (this.version === 100) { if (storage === 'in' || storage === 'out') fail(`'${storage}' : not allowed on global variables in GLSL ES 1.00`, d.line); if (storage === 'attribute') storage = 'in'; if (storage === 'varying') storage = this.stage === 'vertex' ? 'out' : 'in'; }
    if (q.storage === 'attribute' && this.stage !== 'vertex') fail("'attribute' : only allowed in a vertex shader", d.line);
    if (q.interp && storage !== 'in' && storage !== 'out') fail(`'${q.interp}' : only on shader inputs and outputs`, d.line);
    if (!d.vars.length) return;
    for (const v of d.vars) {
      let t = base; if (v.array) t = this.arrayOf(t, v.array, v.line, v.init);
      if (t.k === 'void') fail(`'${v.name}' : illegal use of type 'void'`, v.line);
      if (t.k === 'sampler' || containsSampler(t)) { if (storage !== 'uniform' && !(storage === null && false)) fail(`'${v.name}' : samplers must be uniform`, v.line); }
      if (storage === 'in' || storage === 'out') this.checkInterface(v, t, storage, q);
      const sym = newSym({ name: v.name, type: t, kind: 'var', storage: storage === null ? (global ? 'global' : 'local') : storage, q, line: v.line, interp: q.interp ?? (t.k !== 'array' && isInteger(t) || (t.k === 'array' && isInteger(t.e)) ? 'flat' : 'smooth'), location: q.layout?.location, global });
      if (v.init) {
        if (storage === 'uniform' || storage === 'in' || storage === 'out') fail(`'${v.name}' : cannot initialize this type of qualifier`, v.line);
        this.expr(v.init);
        if (!same(v.init.type, t)) fail(`'=' : cannot convert from '${v.init.type.name}' to '${t.name}'`, v.line);
        if (storage === 'const') { if (!v.init.const) fail(`'${v.name}' : const variables must be initialized with a constant expression`, v.line); sym.constValue = v.init.const; }
        else if (global && this.version === 100 && !v.init.const) { /* ES 1.00 4.3: global initializers must be constant; drivers accept uniforms-free expressions. */ }
        sym.init = v.init;
      } else if (storage === 'const') fail(`'${v.name}' : const variables must be initialized`, v.line);
      this.declare(sym, v.line);
      v.sym = sym;
      if (global) { this.shader.globals.push(sym); if (storage === 'uniform') this.shader.uniforms.push(sym); else if (storage === 'in') this.shader.inputs.push(sym); else if (storage === 'out') this.shader.outputs.push(sym); }
    }
  }
  checkInterface(v, t, storage, q) {
    const e = t.k === 'array' ? t.e : t;
    if (e.k === 'struct' && (this.stage === 'vertex' && storage === 'in' || this.stage === 'fragment' && storage === 'out')) fail(`'${v.name}' : structs are not allowed as vertex inputs or fragment outputs`, v.line);
    if (e.k === 'scalar' && e.b === 'bool' || e.k === 'vector' && e.b === 'bool') fail(`'${v.name}' : bool types are not allowed as shader inputs or outputs`, v.line);
    if (this.stage === 'vertex' && storage === 'in' && t.k === 'array') fail(`'${v.name}' : vertex inputs cannot be arrays`, v.line);
    if (this.stage === 'fragment' && storage === 'out' && e.k === 'matrix') fail(`'${v.name}' : fragment outputs cannot be matrices`, v.line);
    if (this.version === 300 && isInteger(e) && ((this.stage === 'vertex' && storage === 'out') || (this.stage === 'fragment' && storage === 'in')) && q.interp !== 'flat') fail(`'${v.name}' : integer varyings must be flat`, v.line);
  }
  functionDecl(d) {
    const ret = this.resolveType(d.ret, d.line);
    if (ret.k === 'array' && this.version === 100) fail(`'${d.name}' : functions cannot return arrays in GLSL ES 1.00`, d.line);
    if (containsSampler(ret)) fail(`'${d.name}' : functions cannot return samplers`, d.line);
    const params = d.params.map(p => {
      let t = this.resolveType(p.type, p.line); if (p.array) t = this.arrayOf(t, p.array, p.line);
      if (t.k === 'void') fail(`'${p.name ?? ''}' : illegal use of type 'void'`, p.line);
      const qual = p.q.storage ?? 'in'; if (!['in', 'out', 'inout', 'const'].includes(qual)) fail(`'${qual}' : not a parameter qualifier`, p.line);
      if (t.k === 'sampler' && qual !== 'in' && qual !== 'const') fail(`'${p.name}' : samplers cannot be out parameters`, p.line);
      return { name: p.name, type: t, qual: qual === 'const' ? 'in' : qual, constParam: qual === 'const' || p.q.storage === 'const', line: p.line };
    });
    if (this.builtins.has(d.name) && this.version === 300) fail(`'${d.name}' : built-in functions cannot be redefined or overloaded in GLSL ES 3.00`, d.line);
    if (d.name === 'main' && (params.length || ret !== VOID)) fail("'main' : main must be void main()", d.line);
    let list = this.functions.get(d.name); if (!list) { list = []; this.functions.set(d.name, list); }
    const g = this.scopes[0].get(d.name); if (g && g.kind !== 'fn') fail(`'${d.name}' : redefinition`, d.line);
    let fn = list.find(f => f.params.length === params.length && f.params.every((p, i) => same(p.type, params[i].type)));
    if (fn) {
      if (fn.ret !== ret && !same(fn.ret, ret)) fail(`'${d.name}' : overloaded functions must have the same return type`, d.line);
      if (fn.params.some((p, i) => p.qual !== params[i].qual)) fail(`'${d.name}' : parameter qualifiers differ from the prototype`, d.line);
      if (d.body && fn.body) fail(`'${d.name}' : function already has a body`, d.line);
    } else { fn = newSym({ name: d.name, kind: 'fn', ret, params, body: null, calls: new Set(), line: d.line, called: false }); fn.retSym = newSym({ name: `${d.name}$ret`, kind: 'ret', type: ret, fn }); list.push(fn); this.scopes[0].set(d.name, this.scopes[0].get(d.name) ?? newSym({ name: d.name, kind: 'fn', list })); }
    if (!d.body) return;
    fn.body = d.body; fn.params = params; fn.line = d.line;
    this.push(); this.currentFn = fn;
    for (const p of params) { if (!p.name) continue; p.sym = this.declare(newSym({ name: p.name, type: p.type, kind: 'var', storage: 'param', qual: p.qual, readonly: p.constParam, line: p.line, fn }), p.line); }
    this.loopDepth = 0; this.switchDepth = 0;
    for (const s of d.body.stmts) this.stmt(s);
    if (ret !== VOID && !this.returns(d.body)) { /* ES: missing return is undefined behaviour; drivers warn */ this.warn(`'${d.name}' : function does not return a value on every path`, d.line); }
    this.pop(); this.currentFn = null;
  }
  returns(s) {
    if (!s) return false;
    switch (s.kind) { case 'Return': case 'Discard': return true; case 'Compound': return s.stmts.some(x => this.returns(x)); case 'If': return !!s.b && this.returns(s.a) && this.returns(s.b); default: return false; }
  }

  // statements
  stmt(s) {
    switch (s.kind) {
      case 'Compound': if (!s.sameScope) this.push(); for (const x of s.stmts) this.stmt(x); if (!s.sameScope) this.pop(); return;
      case 'Empty': return;
      case 'Expr': this.expr(s.e); return;
      case 'DeclStmt': {
        const d = s.decl;
        if (d.kind === 'Precision') return this.external(d);
        if (d.kind !== 'VarDecl') fail(`'${d.name ?? ''}' : declaration not allowed here`, s.line);
        if (d.type.struct && !d.vars.length) { this.resolveType(d.type, d.line); return; }
        return this.varDecl(d, false);
      }
      case 'If': this.cond(s.c); this.push(); this.stmt(s.a); this.pop(); if (s.b) { this.push(); this.stmt(s.b); this.pop(); } return;
      case 'While': this.push(); this.loopCond(s.c); this.loopDepth++; this.stmt(s.body); this.loopDepth--; this.pop(); return;
      case 'DoWhile': this.loopDepth++; this.push(); this.stmt(s.body); this.pop(); this.loopDepth--; this.cond(s.c); return;
      case 'For': this.push(); if (s.init) this.stmt(s.init.kind === 'VarDecl' ? { kind: 'DeclStmt', decl: s.init, line: s.line } : s.init); if (s.c) this.loopCond(s.c); if (s.inc) this.expr(s.inc); this.loopDepth++; this.stmt(s.body); this.loopDepth--; this.pop(); return;
      case 'Switch': {
        this.expr(s.e); if (s.e.type !== INT && s.e.type !== UINT) fail("'switch' : init-expression in a switch statement must be a scalar integer", s.line);
        this.switchDepth++; this.push(); const seen = new Set(); let labels = 0;
        for (const x of s.body.stmts) {
          if (x.kind === 'Case') { this.expr(x.e); if (!x.e.const || x.e.type !== s.e.type) fail("'case' : case label must be a constant integer of the switch type", x.line); const v = x.e.const[0]; if (seen.has(v)) fail(`'case' : duplicate case label ${v}`, x.line); seen.add(v); labels++; continue; }
          if (x.kind === 'Default') { if (seen.has('default')) fail("'default' : duplicate default label", x.line); seen.add('default'); labels++; continue; }
          if (!labels) fail("'switch' : statement before the first label", x.line);
          this.stmt(x);
        }
        this.pop(); this.switchDepth--; return;
      }
      case 'Case': case 'Default': fail(`'${s.kind.toLowerCase()}' : label outside a switch`, s.line); return;
      case 'Break': if (!this.loopDepth && !this.switchDepth) fail("'break' : break statement only allowed in loops and switch statements", s.line); return;
      case 'Continue': if (!this.loopDepth) fail("'continue' : continue statement only allowed in loops", s.line); return;
      case 'Discard': if (this.stage !== 'fragment') fail("'discard' : only allowed in fragment shaders", s.line); this.shader.usesDiscard = true; return;
      case 'Return': {
        const fn = this.currentFn;
        if (!s.e) { if (fn.ret !== VOID) fail("'return' : non-void function must return a value", s.line); return; }
        this.expr(s.e); if (fn.ret === VOID) fail("'return' : void function cannot return a value", s.line);
        if (!same(s.e.type, fn.ret)) fail(`'return' : function return is not matching type`, s.line); return;
      }
      default: fail(`'${s.kind}' : unexpected statement`, s.line);
    }
  }
  cond(e) { this.expr(e); if (e.type !== BOOL) fail("'condition' : boolean expression expected", e.line); }
  loopCond(c) {
    if (c.kind === 'CondDecl') {
      const t = this.resolveType(c.type, c.line); this.expr(c.init); if (!same(c.init.type, t)) fail(`'=' : cannot convert from '${c.init.type.name}' to '${t.name}'`, c.line);
      if (t !== BOOL) fail("'condition' : boolean expression expected", c.line);
      c.sym = this.declare(newSym({ name: c.name, type: t, kind: 'var', storage: 'local', line: c.line }), c.line); return;
    }
    this.cond(c);
  }

  // expressions: sets e.type (and e.const for constant expressions)
  expr(e) {
    const t = this.exprType(e); e.type = t; return t;
  }
  exprType(e) {
    switch (e.kind) {
      case 'Num': e.const = [e.type === 'float' ? f32(e.value) : e.type === 'uint' ? e.value >>> 0 : e.type === 'int' ? (e.value > 0x7fffffff && e.value <= 0xffffffff ? e.value | 0 : e.value) : e.value];
        if (e.type === 'int' && e.value > 0xffffffff) fail(`'${e.value}' : integer constant overflow`, e.line);
        return scalar(e.type);
      case 'Ident': {
        const s = this.lookup(e.name); if (!s) fail(`'${e.name}' : undeclared identifier`, e.line);
        if (s.kind !== 'var') fail(`'${e.name}' : ${s.kind === 'struct' ? 'a struct name is not a value' : 'a function name is not a value'}`, e.line);
        if (s.extension && !this.ext(s.extension)) fail(`'${e.name}' : requires extension ${s.extension} to be enabled`, e.line);
        e.sym = s; if (s.constValue) e.const = s.constValue;
        if (s.builtin) this.shader.builtins.add(s.builtin);
        if (this.currentFn) s.usedIn ??= new Set(), s.usedIn.add(this.currentFn);
        return s.type;
      }
      case 'Comma': this.expr(e.l); this.expr(e.r); if (e.r.const && e.l.const) e.const = e.r.const; return e.r.type;
      case 'Ternary': {
        this.cond(e.c); const a = this.expr(e.a), b = this.expr(e.b);
        if (!same(a, b)) fail(`':' : wrong operand types - no operation ':' exists that takes a left-hand operand of type '${a.name}' and a right operand of type '${b.name}'`, e.line);
        if (a.k === 'array' && this.version === 100) fail("'?:' : ternary operator is not allowed for arrays in GLSL ES 1.00", e.line);
        if (containsSampler(a)) fail("'?:' : not allowed on samplers", e.line);
        if (e.c.const && e.a.const && e.b.const) e.const = e.c.const[0] ? e.a.const : e.b.const;
        return a;
      }
      case 'Assign': {
        const lt = this.lvalue(e.l, e.op), rt = this.expr(e.r);
        if (e.op === '=') { if (!same(lt, rt)) fail(`'=' : cannot convert from '${rt.name}' to '${lt.name}'`, e.line); if (lt.k === 'array' && this.version === 100) fail("'=' : arrays cannot be assigned in GLSL ES 1.00", e.line); return lt; }
        const result = this.binaryType(e.op.slice(0, -1), lt, rt, e.line);
        if (!same(result, lt)) fail(`'${e.op}' : cannot convert from '${result.name}' to '${lt.name}'`, e.line);
        return lt;
      }
      case 'Binary': {
        const l = this.expr(e.l), r = this.expr(e.r), t = this.binaryType(e.op, l, r, e.line);
        if (e.l.const && e.r.const && t.k !== 'array' && t.k !== 'struct') e.const = foldBinary(e.op, l, r, e.l.const, e.r.const, t);
        else if (e.l.const && e.r.const && (e.op === '==' || e.op === '!=')) e.const = [(JSON.stringify(e.l.const) === JSON.stringify(e.r.const)) === (e.op === '==') ? 1 : 0];
        return t;
      }
      case 'Unary': {
        const t = this.expr(e.e);
        if (e.op === '!') { if (t !== BOOL) fail(`'!' : wrong operand type - no operation '!' exists that takes an operand of type ${t.name}`, e.line); if (e.e.const) e.const = [e.e.const[0] ? 0 : 1]; return BOOL; }
        if (e.op === '~') { if (!isInteger(t)) fail(`'~' : wrong operand type - no operation '~' exists that takes an operand of type ${t.name}`, e.line); if (e.e.const) e.const = e.e.const.map(v => coerce(t.b, ~v)); return t; }
        if (!isNumeric(t)) fail(`'${e.op}' : wrong operand type - no operation '${e.op}' exists that takes an operand of type ${t.name}`, e.line);
        if (e.e.const) e.const = e.op === '-' ? e.e.const.map(v => coerce(t.b, -v)) : e.e.const;
        return t;
      }
      case 'Prefix': case 'Postfix': { const t = this.lvalue(e.e, e.op); if (!isNumeric(t)) fail(`'${e.op}' : wrong operand type`, e.line); return t; }
      case 'Field': return this.field(e);
      case 'Index': return this.index(e);
      case 'Length': {
        const t = this.expr(e.e); if (this.version !== 300) fail("'length' : not supported in GLSL ES 1.00", e.line);
        if (t.k === 'array') { e.const = [t.len]; return INT; }
        if (t.k === 'vector') { e.const = [t.n]; return INT; } if (t.k === 'matrix') { e.const = [t.c]; return INT; }
        fail("'length' : array, vector or matrix expected", e.line);
      }
      case 'Call': return e.ctor ? this.constructorCall(e) : this.call(e);
      default: fail(`'${e.kind}' : unexpected expression`, e.line);
    }
  }
  /** The l-value of an assignment, ++ or --, or an out argument: its type; marks the root symbol as written. */
  lvalue(e, op) {
    const t = this.expr(e);
    const root = (x, swz = new Set()) => {
      if (x.kind === 'Ident') return x.sym;
      if (x.kind === 'Field') { if (x.swizzle && new Set(x.swizzle).size !== x.swizzle.length) fail(`'${op}' : l-value of swizzle cannot have duplicate components`, x.line); return root(x.e, swz); }
      if (x.kind === 'Index') return root(x.e, swz);
      fail(`'${op}' : l-value required`, x.line);
    };
    const s = root(e);
    if (s.storage === 'const' || s.storage === 'uniform' || (s.storage === 'in' && !s.fn) || s.readonly) fail(`'${op}' : l-value required (can't modify ${s.storage === 'const' ? 'a const' : s.storage === 'uniform' ? 'a uniform' : s.readonly ? 'a read-only variable' : 'an input'} "${s.name}")`, e.line);
    if (containsSampler(t)) fail(`'${op}' : samplers cannot be modified`, e.line);
    s.written = true; if (s.builtin === 'gl_FragDepth' || s.builtin === 'gl_FragDepthEXT') this.shader.writesDepth = true;
    if (this.currentFn) { s.writtenIn ??= new Set(); s.writtenIn.add(this.currentFn); }
    return t;
  }
  binaryType(op, l, r, line) {
    const bad = () => fail(`'${op}' : wrong operand types - no operation '${op}' exists that takes a left-hand operand of type '${l.name}' and a right operand of type '${r.name}' (or there is no acceptable conversion)`, line);
    switch (op) {
      case '&&': case '||': case '^^': if (l !== BOOL || r !== BOOL) bad(); return BOOL;
      case '==': case '!=': if (!same(l, r) || containsSampler(l)) bad(); if (l.k === 'array' && this.version === 100) bad(); return BOOL;
      case '<': case '>': case '<=': case '>=': if (l !== r || l.k !== 'scalar' || l.b === 'bool') bad(); return BOOL;
      case '%': case '&': case '|': case '^': {
        if (!isInteger(l) || !isInteger(r) || l.b !== r.b) bad();
        if (l === r) return l; if (l.k === 'scalar') return r; if (r.k === 'scalar') return l; bad(); break;
      }
      case '<<': case '>>': {
        if (!isInteger(l) || !isInteger(r)) bad(); if (l.k === 'scalar' && r.k === 'vector') bad(); if (l.k === 'vector' && r.k === 'vector' && l.n !== r.n) bad(); return l;
      }
      case '+': case '-': case '*': case '/': {
        if (!isNumeric(l) || !isNumeric(r) || l.b !== r.b) bad();
        if (op === '*' && (l.k === 'matrix' || r.k === 'matrix')) {
          if (l.k === 'matrix' && r.k === 'matrix') { if (l.c !== r.r) bad(); return mat(r.c, l.r); }
          if (l.k === 'matrix' && r.k === 'vector') { if (l.c !== r.n) bad(); return vec('float', l.r); }
          if (l.k === 'vector' && r.k === 'matrix') { if (l.n !== r.r) bad(); return vec('float', r.c); }
          return l.k === 'matrix' ? l : r;   // matrix * scalar
        }
        if (l === r) return l; if (l.k === 'scalar') return r; if (r.k === 'scalar') return l;
        bad();
      }
    }
    bad();
  }
  field(e) {
    const t = this.expr(e.e);
    if (t.k === 'vector' || (t.k === 'scalar' && this.version === 300 && false)) { e.swizzle = swizzleOf(e.name, t.n, e.line); if (e.e.const) e.const = e.swizzle.map(i => e.e.const[i]); return vec(t.b, e.swizzle.length); }
    if (t.k === 'struct') {
      const f = fieldOffset(t, e.name); if (!f) fail(`'${e.name}' : no such field in structure`, e.line);
      e.fieldAt = f.at; e.fieldType = f.field.type; if (e.e.const) e.const = e.e.const.slice(f.at, f.at + comps(f.field.type));
      return f.field.type;
    }
    fail(`'${e.name}' : field selection requires structure or vector on left hand side`, e.line);
  }
  index(e) {
    const t = this.expr(e.e), it = this.expr(e.index);
    if (it !== INT && it !== UINT) fail("'[' : integer expression required for array index", e.line);
    const c = e.index.const?.[0];
    const check = n => { if (c !== undefined && (c < 0 || c >= n)) fail(`'[' : index ${c} out of range`, e.line); };
    if (t.k === 'array') {
      check(t.len);
      if (containsSampler(t.e) && c === undefined && this.version === 100) { /* ES 1.00 Appendix A: sampler indexing by constant-index-expressions (loop indices included): allowed */ }
      if (this.version === 100 && c === undefined && e.e.sym && (e.e.sym.storage === 'in' || e.e.sym.builtin === 'gl_FragData')) { /* allowed with loop indices */ }
      if (e.e.const && c !== undefined) { const n = comps(t.e); e.const = e.e.const.slice(c * n, c * n + n); }
      return t.e;
    }
    if (t.k === 'vector') { check(t.n); if (e.e.const && c !== undefined) e.const = [e.e.const[c]]; return scalar(t.b); }
    if (t.k === 'matrix') { check(t.c); if (e.e.const && c !== undefined) e.const = e.e.const.slice(c * t.r, c * t.r + t.r); return vec('float', t.r); }
    fail("'[' : left of '[' is not of type array, matrix, or vector", e.line);
  }
  constructorCall(e) {
    let t = this.resolveType(e.ctor, e.line);
    for (const a of e.args) this.expr(a);
    const args = e.args;
    if (t.k === 'array' || e.ctor.array) {
      if (this.version !== 300) fail("'[' : array constructors need GLSL ES 3.00", e.line);
      if (e.ctor.array && e.ctor.array.size === null) { const base = this.resolveType({ ...e.ctor, array: null }, e.line); t = array(base, args.length); }
      if (args.length !== t.len) fail(`'constructor' : array constructor needs ${t.len} arguments`, e.line);
      for (const a of args) if (!same(a.type, t.e)) fail(`'constructor' : cannot convert parameter from '${a.type.name}' to '${t.e.name}'`, e.line);
      e.ctorType = t; if (args.every(a => a.const)) e.const = args.flatMap(a => a.const); return t;
    }
    e.ctorType = t;
    if (t.k === 'struct') {
      if (args.length !== t.fields.length) fail(`'constructor' : wrong number of arguments for ${t.name}`, e.line);
      args.forEach((a, i) => { if (!same(a.type, t.fields[i].type)) fail(`'constructor' : cannot convert parameter ${i + 1} from '${a.type.name}' to '${t.fields[i].type.name}'`, e.line); });
      if (args.every(a => a.const)) e.const = args.flatMap(a => a.const);
      return t;
    }
    if (t.k === 'sampler' || t.k === 'void') fail(`'${t.name}' : cannot construct this type`, e.line);
    if (!args.length) fail(`'${t.name}' : constructor does not have any arguments`, e.line);
    for (const a of args) if (a.type.k === 'array' || a.type.k === 'struct' || a.type.k === 'sampler' || a.type.k === 'void') fail(`'constructor' : cannot convert a ${a.type.name} argument`, e.line);
    const total = args.reduce((sum, a) => sum + comps(a.type), 0), need = comps(t);
    if (t.k === 'matrix' && args.length === 1 && args[0].type.k === 'matrix') { /* matrix from matrix */ }
    else if (t.k === 'matrix' && args.some(a => a.type.k === 'matrix')) fail("'constructor' : a matrix argument must be the only argument", e.line);
    else if (args.length === 1 && comps(args[0].type) === 1) { /* broadcast or diagonal */ }
    else {
      if (total < need) fail("'constructor' : not enough data provided for construction", e.line);
      let used = 0; for (let i = 0; i < args.length; i++) { if (used >= need) fail("'constructor' : too many arguments", e.line); used += comps(args[i].type); }
    }
    if (args.every(a => a.const)) e.const = foldConstructor(t, args.map(a => ({ type: a.type, values: a.const })));
    return t;
  }
  call(e) {
    for (const a of e.args) this.expr(a);
    const user = this.functions.get(e.name);
    const sym = this.lookup(e.name);
    if (sym && sym.kind === 'var') fail(`'${e.name}' : not a function`, e.line);
    if (sym && sym.kind === 'struct') { e.ctor = { name: e.name, line: e.line }; return this.constructorCall(e); }
    const types = e.args.map(a => a.type);
    const fn = user?.find(f => f.params.length === types.length && f.params.every((p, i) => same(p.type, types[i])));
    if (fn) {
      e.fn = fn; fn.called = true; if (this.currentFn) this.currentFn.calls.add(fn);
      fn.params.forEach((p, i) => { if (p.qual !== 'in') this.lvalue(e.args[i], `out parameter of ${e.name}`); });
      return fn.ret;
    }
    const builtins = this.builtins.get(e.name);
    if (builtins) {
      const sig = builtins.find(s => s.params.length === types.length && s.params.every((p, i) => same(p, types[i])));
      if (!sig) fail(`'${e.name}' : no matching overloaded function found`, e.line);
      if (sig.vertexOnly && this.stage !== 'vertex' && !(this.version === 100 && this.ext('GL_EXT_shader_texture_lod'))) fail(`'${e.name}' : only available in a vertex shader`, e.line);
      if (sig.fragmentOnly && this.stage !== 'fragment') fail(`'${e.name}' : only available in a fragment shader`, e.line);
      if (sig.derivative && !this.ext('GL_OES_standard_derivatives')) fail(`'${e.name}' : requires extension GL_OES_standard_derivatives to be enabled`, e.line);
      if (sig.extension && /LodEXT|GradEXT/.test(e.name) && !this.ext('GL_EXT_shader_texture_lod')) fail(`'${e.name}' : requires extension GL_EXT_shader_texture_lod to be enabled`, e.line);
      sig.outs.forEach((out, i) => { if (out) this.lvalue(e.args[i], `out parameter of ${e.name}`); });
      e.builtin = sig;
      if (this.stage === 'fragment' && (IMPLICIT_LOD.has(e.name) || ['dFdx', 'dFdy', 'fwidth'].includes(e.name))) this.shader.derivativeSites.push(e);
      if (e.args.every(a => a.const)) e.const = foldBuiltin(e.name, sig, e.args.map(a => a.const));
      return sig.ret;
    }
    if (user) fail(`'${e.name}' : no matching overloaded function found`, e.line);
    fail(`'${e.name}' : no matching overloaded function found`, e.line);
  }
}

// ---- constant folding (enough for array sizes, const variables and case labels) ---------------------------------------------------------------------------------------------
function foldBinary(op, l, r, a, b, t) {
  if (t.k === 'matrix' || l.k === 'matrix' || r.k === 'matrix') {
    if (op !== '*' || (l.k === 'matrix' && r.k === 'matrix') || l.k === 'vector' || r.k === 'vector') { if (op === '*') return null; }
  }
  if (op === '*' && (l.k === 'matrix' && r.k !== 'scalar' || r.k === 'matrix' && l.k !== 'scalar')) return null;
  const n = comps(t), at = (v, i) => v.length === 1 ? v[0] : v[i];
  if (['==', '!='].includes(op)) { const eq = a.length === b.length && a.every((v, i) => v === b[i]); return [eq === (op === '==') ? 1 : 0]; }
  if (['<', '>', '<=', '>='].includes(op)) { const x = a[0], y = b[0]; return [op === '<' ? +(x < y) : op === '>' ? +(x > y) : op === '<=' ? +(x <= y) : +(x >= y)]; }
  if (op === '&&') return [a[0] && b[0] ? 1 : 0]; if (op === '||') return [a[0] || b[0] ? 1 : 0]; if (op === '^^') return [a[0] !== b[0] ? 1 : 0];
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = at(a, i), y = at(b, i); let v;
    switch (op) {
      case '+': v = x + y; break; case '-': v = x - y; break;
      case '*': v = t.b === 'float' ? x * y : Math.imul(x, y); break;
      case '/': if (t.b !== 'float') { if (y === 0) return null; v = Math.trunc(x / y); } else v = x / y; break;
      case '%': if (y === 0) return null; v = x % y; break;
      case '&': v = x & y; break; case '|': v = x | y; break; case '^': v = x ^ y; break;
      case '<<': v = x << y; break; case '>>': v = t.b === 'uint' ? x >>> y : x >> y; break;
      default: return null;
    }
    out.push(coerce(t.b, v));
  }
  return out;
}
export function foldConstructor(t, args) {
  const flat = args.flatMap(a => a.values.map(v => ({ v, b: a.type.b ?? 'float' })));
  const b = t.b ?? 'float', convert = x => coerce(b, x.b === 'bool' ? x.v : b === 'bool' ? (x.v !== 0 ? 1 : 0) : b === 'float' ? x.v : Math.trunc(x.v));
  if (t.k === 'scalar') return [convert(flat[0])];
  if (t.k === 'vector') return flat.length === 1 ? Array(t.n).fill(convert(flat[0])) : flat.slice(0, t.n).map(convert);
  if (t.k === 'matrix') {
    if (args.length === 1 && args[0].type.k === 'matrix') { const m = args[0].type, out = []; for (let c = 0; c < t.c; c++) for (let r = 0; r < t.r; r++) out.push(c < m.c && r < m.r ? args[0].values[c * m.r + r] : c === r ? 1 : 0); return out; }
    if (flat.length === 1) { const out = []; for (let c = 0; c < t.c; c++) for (let r = 0; r < t.r; r++) out.push(c === r ? convert(flat[0]) : 0); return out; }
    return flat.slice(0, t.c * t.r).map(convert);
  }
  return flat.map(x => x.v);
}
function foldBuiltin(name, sig, values) {
  const t = sig.ret;
  if (FOLD[name] && values.length === 1 && t.b === 'float') return values[0].map(v => f32(FOLD[name](v)));
  if (FOLD2[name] && values.length === 2) { const n = comps(t), [a, b] = values; return Array.from({ length: n }, (_, i) => coerce(t.b, FOLD2[name](a.length === 1 ? a[0] : a[i], b.length === 1 ? b[0] : b[i]))); }
  if (name === 'clamp') { const [x, lo, hi] = values, n = comps(t); return Array.from({ length: n }, (_, i) => coerce(t.b, Math.min(Math.max(x[i], lo.length === 1 ? lo[0] : lo[i]), hi.length === 1 ? hi[0] : hi[i]))); }
  if (name === 'abs' && t.b === 'int') return values[0].map(v => Math.abs(v) | 0);
  if (name === 'dot') return [f32(values[0].reduce((s, v, i) => s + v * values[1][i], 0))];
  if (name === 'length') return [f32(Math.hypot(...values[0]))];
  return null;
}
export { F32, I32, U32 };
