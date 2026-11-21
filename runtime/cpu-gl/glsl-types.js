// Types of the lab's GLSL ES compiler (docs/OPENGL-ES-ON-CPU.md) and the GL enums that name them (glGetActiveUniform / glGetActiveAttrib). A value of a type is a flat list of
// scalar components: vectors in order, matrices column-major, structs field after field, arrays element after element. No process.*.

const cache = new Map();
const intern = (key, make) => { let t = cache.get(key); if (!t) { t = make(); t.key = key; cache.set(key, t); } return t; };
export const VOID = intern('void', () => ({ k: 'void', name: 'void' }));
export const scalar = b => intern(b, () => ({ k: 'scalar', b, n: 1, name: b }));
export const FLOAT = scalar('float'), INT = scalar('int'), UINT = scalar('uint'), BOOL = scalar('bool');
const VEC_PREFIX = { float: '', int: 'i', uint: 'u', bool: 'b' };
export const vec = (b, n) => n === 1 ? scalar(b) : intern(`${VEC_PREFIX[b]}vec${n}`, () => ({ k: 'vector', b, n, name: `${VEC_PREFIX[b]}vec${n}` }));
export const mat = (c, r) => intern(c === r ? `mat${c}` : `mat${c}x${r}`, () => ({ k: 'matrix', b: 'float', c, r, name: c === r ? `mat${c}` : `mat${c}x${r}` }));
export const array = (e, len) => intern(`${e.key}[${len}]`, () => ({ k: 'array', e, len, name: `${e.name}[${len}]` }));
export const sampler = name => intern(name, () => ({ k: 'sampler', name, ...SAMPLERS[name] }));
let structCount = 0;
export const struct = (name, fields) => { const t = { k: 'struct', name: name ?? `__anon${++structCount}`, fields, key: `struct#${++structCount}` }; return t; };
/** Sampler kinds: dim (2, 3, 'cube', '2a'), result base type, shadow. */
export const SAMPLERS = {
  sampler2D: { dim: 2, b: 'float' }, sampler3D: { dim: 3, b: 'float' }, samplerCube: { dim: 'cube', b: 'float' }, sampler2DArray: { dim: '2a', b: 'float' },
  sampler2DShadow: { dim: 2, b: 'float', shadow: true }, samplerCubeShadow: { dim: 'cube', b: 'float', shadow: true }, sampler2DArrayShadow: { dim: '2a', b: 'float', shadow: true },
  isampler2D: { dim: 2, b: 'int' }, isampler3D: { dim: 3, b: 'int' }, isamplerCube: { dim: 'cube', b: 'int' }, isampler2DArray: { dim: '2a', b: 'int' },
  usampler2D: { dim: 2, b: 'uint' }, usampler3D: { dim: 3, b: 'uint' }, usamplerCube: { dim: 'cube', b: 'uint' }, usampler2DArray: { dim: '2a', b: 'uint' },
  samplerExternalOES: { dim: 2, b: 'float', external: true },
};
const NAMED = { void: VOID, float: FLOAT, int: INT, uint: UINT, bool: BOOL };
/** The type of a basic type name, or undefined. */
export function basicType(name) {
  if (NAMED[name]) return NAMED[name];
  let m = /^([biu]?)vec([234])$/.exec(name); if (m) return vec({ '': 'float', i: 'int', u: 'uint', b: 'bool' }[m[1]], Number(m[2]));
  m = /^mat([234])(?:x([234]))?$/.exec(name); if (m) return mat(Number(m[1]), Number(m[2] ?? m[1]));
  if (SAMPLERS[name]) return sampler(name);
  return undefined;
}
/** Scalar components of a value of the type (samplers count one: the texture unit). */
export function comps(t) {
  switch (t.k) {
    case 'scalar': case 'sampler': return 1; case 'vector': return t.n; case 'matrix': return t.c * t.r;
    case 'array': return t.len * comps(t.e); case 'struct': return t.fields.reduce((sum, f) => sum + comps(f.type), 0);
    default: return 0;
  }
}
/** Arrays, and structs with an array (or a sampler) inside, live in a typed-array store instead of in JS locals. */
export function needsStore(t) { return t.k === 'array' || (t.k === 'struct' && t.fields.some(f => needsStore(f.type) || f.type.k === 'sampler')); }
export const containsSampler = t => t.k === 'sampler' || (t.k === 'array' && containsSampler(t.e)) || (t.k === 'struct' && t.fields.some(f => containsSampler(f.type)));
export const containsArray = t => t.k === 'array' || (t.k === 'struct' && t.fields.some(f => containsArray(f.type)));
export const isNumeric = t => (t.k === 'scalar' || t.k === 'vector' || t.k === 'matrix') && t.b !== 'bool';
export const isInteger = t => (t.k === 'scalar' || t.k === 'vector') && (t.b === 'int' || t.b === 'uint');
export const isBoolean = t => (t.k === 'scalar' || t.k === 'vector') && t.b === 'bool';
export const same = (a, b) => a === b || (a.k === 'array' && b.k === 'array' && a.len === b.len && same(a.e, b.e));
export function fieldOffset(t, name) { let at = 0; for (const f of t.fields) { if (f.name === name) return { at, field: f }; at += comps(f.type); } return null; }
/** The GL enum of a type (ES 3.0 table 2.10). */
export function glType(t) {
  const BASE = { float: [0x1406, 0x8B50, 0x8B51, 0x8B52], int: [0x1404, 0x8B53, 0x8B54, 0x8B55], uint: [0x1405, 0x8DC6, 0x8DC7, 0x8DC8], bool: [0x8B56, 0x8B57, 0x8B58, 0x8B59] };
  if (t.k === 'scalar') return BASE[t.b][0]; if (t.k === 'vector') return BASE[t.b][t.n - 1];
  if (t.k === 'matrix') return { 'mat2': 0x8B5A, 'mat3': 0x8B5B, 'mat4': 0x8B5C, 'mat2x3': 0x8B65, 'mat2x4': 0x8B66, 'mat3x2': 0x8B67, 'mat3x4': 0x8B68, 'mat4x2': 0x8B69, 'mat4x3': 0x8B6A }[t.name];
  if (t.k === 'sampler') return { sampler2D: 0x8B5E, sampler3D: 0x8B5F, samplerCube: 0x8B60, sampler2DShadow: 0x8B62, sampler2DArray: 0x8DC1, sampler2DArrayShadow: 0x8DC4, samplerCubeShadow: 0x8DC5,
    isampler2D: 0x8DCA, isampler3D: 0x8DCB, isamplerCube: 0x8DCC, isampler2DArray: 0x8DCF, usampler2D: 0x8DD2, usampler3D: 0x8DD3, usamplerCube: 0x8DD4, usampler2DArray: 0x8DD7, samplerExternalOES: 0x8D66 }[t.name];
  return 0;
}
/** std140 base alignment and size in bytes (ES 3.0 2.11.6.4 / GLSL ES 3.00 4.3.7), row_major for matrices when asked. */
export function std140(t, rowMajor = false) {
  if (t.k === 'scalar') return { align: 4, size: 4 };
  if (t.k === 'vector') return { align: t.n === 2 ? 8 : 16, size: t.n * 4 };
  if (t.k === 'matrix') { const columns = rowMajor ? t.r : t.c; return { align: 16, size: columns * 16, stride: 16 }; }
  if (t.k === 'array') { const e = std140(t.e, rowMajor); const stride = Math.ceil(e.size / 16) * 16 || 16; const align = Math.max(16, e.align); return { align, size: stride * t.len, stride: Math.ceil(stride / align) * align }; }
  if (t.k === 'struct') { let size = 0, align = 16; for (const f of t.fields) { const m = std140(f.type, rowMajor); size = Math.ceil(size / m.align) * m.align + m.size; align = Math.max(align, m.align); } return { align, size: Math.ceil(size / 16) * 16 }; }
  return { align: 4, size: 4 };
}
