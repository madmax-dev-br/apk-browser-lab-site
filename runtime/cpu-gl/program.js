// Shader objects and program linking of the CPU OpenGL ES implementation (docs/OPENGL-ES-ON-CPU.md): compile (src/cpu-gl/glsl-check.js), then link (ES 3.0 2.11.3 / GLSL ES
// 3.00 4.3.4): the interface between the stages matched by name, attribute locations (layout qualifiers, glBindAttribLocation, then the lowest free ones), the uniform store and
// its locations, std140 uniform blocks, fragment outputs, transform feedback varyings, and both stages generated (src/cpu-gl/glsl-codegen.js). No process.*.
import { checkShader } from './glsl-check.js?v=d0b27a2b509b';
import { generate } from './glsl-codegen.js?v=d0b27a2b509b';
import { comps, glType, std140, needsStore, same } from './glsl-types.js?v=d0b27a2b509b';

export const VARYING_BASE = 8, MAX_VARYING_COMPONENTS = 64, MAX_DRAW_BUFFERS = 4, MAX_VERTEX_ATTRIBS = 16, MAX_COMBINED_UNITS = 32;

export class Shader { constructor(type) { this.kind = 'shader'; this.type = type; this.source = ''; this.compiled = false; this.log = ''; this.checked = null; this.deleted = false; this.attachedTo = 0; } }
export function compileShader(shader) {
  const stage = shader.type === 0x8B31 ? 'vertex' : 'fragment', result = checkShader(shader.source, stage);
  shader.compiled = result.ok; shader.log = result.log; shader.checked = result.ok ? result.shader : null; shader.compiledSource = shader.source;
}
export class Program {
  constructor() { this.kind = 'program'; this.shaders = []; this.linked = false; this.log = ''; this.bindings = new Map(); this.feedback = { varyings: [], mode: 0x8C8D /* GL_SEPARATE_ATTRIBS */ }; this.deleted = false; this.validated = false; this.linkCount = 0; this.inUse = 0; }
}
/** Leaves of a uniform's type: { name, type (basic or sampler), size (array length, 1 otherwise), offset (component offset of element 0), stride } */
function uniformLeaves(name, t, offset, out, inArray = false) {
  if (t.k === 'struct') { let at = offset; for (const f of t.fields) { uniformLeaves(`${name}.${f.name}`, f.type, at, out); at += comps(f.type); } return out; }
  if (t.k === 'array') {
    if (t.e.k === 'struct' || t.e.k === 'array') { const stride = comps(t.e); for (let i = 0; i < t.len; i++) uniformLeaves(`${name}[${i}]`, t.e, offset + i * stride, out); return out; }
    out.push({ name: `${name}[0]`, base: name, type: t.e, size: t.len, offset, stride: comps(t.e), isArray: true }); return out;
  }
  out.push({ name, base: name, type: t, size: 1, offset, stride: comps(t), isArray: inArray }); return out;
}
/** std140 byte offsets of every flat component of a block member type: [{ at, kind }] in component order. */
function std140Components(t, base, rowMajor, out) {
  if (t.k === 'scalar') { out.push({ at: base, kind: t.b }); return; }
  if (t.k === 'vector') { for (let i = 0; i < t.n; i++) out.push({ at: base + 4 * i, kind: t.b }); return; }
  if (t.k === 'matrix') { for (let c = 0; c < t.c; c++) for (let r = 0; r < t.r; r++) out.push({ at: base + (rowMajor ? r * 16 + c * 4 : c * 16 + r * 4), kind: 'float' }); return; }
  if (t.k === 'array') { const { stride } = std140(t, rowMajor); for (let i = 0; i < t.len; i++) std140Components(t.e, base + i * stride, rowMajor, out); return; }
  if (t.k === 'struct') { let at = base; for (const f of t.fields) { const m = std140(f.type, rowMajor); at = Math.ceil(at / m.align) * m.align; std140Components(f.type, at, rowMajor, out); at += m.size; } }
}
const fail = message => { throw Object.assign(new Error(message), { link: true }); };
/** Links a program: sets program.linked, program.log and the linked state (program.state) the draws use. */
export function linkProgram(program, context) {
  program.linkCount++;
  try { program.state = link(program, context); program.linked = true; program.log = ''; }
  catch (error) { if (!error.link) { program.log = `internal link error: ${error.message}`; program.linked = false; context.note?.(`GL program link: ${error.message.split('\n')[0]}`); } else { program.log = error.message; program.linked = false; } program.state = program.linked ? program.state : null; }
}
function link(program, context) {
  const vsObj = program.shaders.find(s => s.type === 0x8B31), fsObj = program.shaders.find(s => s.type === 0x8B30);
  if (!vsObj || !fsObj) fail('Attached vertex shader and fragment shader are both required');
  if (!vsObj.compiled || !fsObj.compiled) fail(`${!vsObj.compiled ? 'Vertex' : 'Fragment'} shader is not compiled`);
  const vs = vsObj.checked, fs = fsObj.checked;
  if (vs.version !== fs.version) fail(`Shader versions differ: ${vs.version} and ${fs.version}`);
  // ---- uniforms (merged by name) ----
  const uniforms = new Map();   // name -> { sym(s), type, offset }
  let size = 0;
  const depthRange = [];
  for (const shader of [vs, fs]) for (const sym of [...shader.uniforms, ...shader.globals.filter(s => false)]) {
    if (sym.block) continue;
    const previous = uniforms.get(sym.name);
    if (previous) { if (!same(previous.type, sym.type) && previous.type.key !== sym.type.key && JSON.stringify(typeShape(previous.type)) !== JSON.stringify(typeShape(sym.type))) fail(`Uniform "${sym.name}" differs between the shaders`); previous.syms.push(sym); continue; }
    uniforms.set(sym.name, { syms: [sym], type: sym.type, offset: size }); size += comps(sym.type);
  }
  const depthRangeOffset = size; size += 3; void depthRange;
  // ---- uniform blocks ----
  const blocks = [];
  for (const shader of [vs, fs]) for (const info of shader.blocks) {
    let block = blocks.find(b => b.name === info.name);
    if (block) { if (typeShape(block.type).join() !== typeShape(info.type).join()) fail(`Uniform block "${info.name}" differs between the shaders`); block.infos.push(info); continue; }
    const layout = []; let at = 0; const members = [];
    for (const f of info.fields) {
      const m = std140(f.type, f.rowMajor); at = Math.ceil(at / m.align) * m.align;
      const flat = []; std140Components(f.type, at, f.rowMajor, flat);
      members.push({ field: f, byteOffset: at, flatOffset: layout.length, size: m.size }); layout.push(...flat); at += m.size;
    }
    block = { name: info.name, type: info.type, infos: [info], index: blocks.length, binding: 0, dataSize: Math.ceil(at / 16) * 16, components: layout, members, instance: info.instance, store: null };
    blocks.push(block);
  }
  if (blocks.length > 24) fail('Too many uniform blocks');
  // ---- attributes ----
  const attributes = new Map(), used = new Set();
  const inputs = vs.inputs;
  for (const sym of inputs) { const loc = sym.location; if (loc === undefined) continue; const n = sym.type.k === 'matrix' ? sym.type.c : 1; for (let i = 0; i < n; i++) { if (used.has(loc + i)) fail(`Attribute location ${loc + i} is used twice`); used.add(loc + i); } if (loc + n > MAX_VERTEX_ATTRIBS) fail(`Attribute "${sym.name}" location out of range`); attributes.set(sym, loc); }
  for (const sym of inputs) { if (attributes.has(sym)) continue; const loc = program.bindings.get(sym.name); if (loc === undefined) continue; const n = sym.type.k === 'matrix' ? sym.type.c : 1; if (loc + n > MAX_VERTEX_ATTRIBS) fail(`Attribute "${sym.name}" bound out of range`); for (let i = 0; i < n; i++) used.add(loc + i); attributes.set(sym, loc); }
  for (const sym of inputs) {
    if (attributes.has(sym)) continue; const n = sym.type.k === 'matrix' ? sym.type.c : 1; let loc = 0;
    while (loc + n <= MAX_VERTEX_ATTRIBS && [...Array(n).keys()].some(i => used.has(loc + i))) loc++;
    if (loc + n > MAX_VERTEX_ATTRIBS) fail('Too many vertex attributes'); for (let i = 0; i < n; i++) used.add(loc + i); attributes.set(sym, loc);
  }
  // ---- varyings ----
  const varyings = new Map(); let vsize = VARYING_BASE; const flat = [];
  for (const sym of vs.outputs) {
    const n = comps(sym.type); varyings.set(sym.name, { sym, offset: vsize, type: sym.type, interp: sym.interp });
    for (let i = 0; i < n; i++) flat[vsize + i - VARYING_BASE] = sym.interp === 'flat';
    vsize += n;
  }
  if (vsize - VARYING_BASE > MAX_VARYING_COMPONENTS) fail('Too many varyings');
  const fsInputs = new Map();
  for (const sym of fs.inputs) {
    const v = varyings.get(sym.name);
    if (!v) { if (sym.usedIn?.size) fail(`Fragment shader input "${sym.name}" is not written by the vertex shader`); fsInputs.set(sym, -1); continue; }
    if (!same(v.type, sym.type)) fail(`Varying "${sym.name}" has different types in the shaders`);
    if (fs.version === 300 && (v.interp === 'flat') !== (sym.interp === 'flat')) fail(`Varying "${sym.name}" has different interpolation qualifiers`);
    fsInputs.set(sym, v.offset);
  }
  // ---- fragment outputs ----
  const outputs = new Map();
  if (fs.version === 300) {
    const list = fs.outputs; if (list.length > 1 && list.some(s => s.location === undefined)) fail('Multiple fragment outputs need explicit locations');
    const taken = new Set();
    for (const sym of list) {
      const loc = sym.location ?? 0, n = sym.type.k === 'array' ? sym.type.len : 1;
      for (let i = 0; i < n; i++) { if (taken.has(loc + i)) fail(`Fragment output location ${loc + i} is used twice`); taken.add(loc + i); }
      if (loc + n > MAX_DRAW_BUFFERS) fail(`Fragment output "${sym.name}" location out of range`);
      outputs.set(sym, { location: loc, count: n, type: sym.type.k === 'array' ? sym.type.e : sym.type });
    }
  }
  // ---- generate both stages ----
  const uniformOf = sym => {
    if (sym.builtin === 'gl_DepthRange') return { store: 'U', base: depthRangeOffset };
    if (sym.block) { const block = blocks.find(b => b.infos.includes(sym.block)); const name = `Bk${block.index}`; if (sym.member) { const m = block.members.find(x => x.field.name === sym.member.name); return { store: name, base: m.flatOffset, index: block.index }; } return { store: name, base: 0, index: block.index }; }
    const u = uniforms.get(sym.name); return { store: 'U', base: u.offset };
  };
  const vsLayout = { uniform: uniformOf, attribute: sym => attributes.get(sym), varying: sym => varyings.get(sym.name).offset, output: () => { throw new Error('internal: vertex output'); } };
  const fsLayout = { uniform: uniformOf, attribute: () => { throw new Error('internal: fragment attribute'); }, varying: sym => fsInputs.get(sym), output: sym => outputs.get(sym).location * 4 };
  let vgen, fgen;
  try { vgen = generate(vs, vsLayout); fgen = generate(fs, fsLayout); }
  catch (error) { if (error.name === 'GlslError') fail(error.message); throw error; }
  // ---- what the API reports ----
  const activeUniforms = [];
  for (const [name, u] of uniforms) {
    if (!u.syms.some(s => vgen.usedUniforms.has(s) || fgen.usedUniforms.has(s))) continue;
    for (const leaf of uniformLeaves(name, u.type, u.offset, [])) activeUniforms.push({ ...leaf, glType: glType(leaf.type), blockIndex: -1, sampler: leaf.type.k === 'sampler' });
  }
  for (const block of blocks) {
    block.store = new Float64Array(Math.max(1, block.components.length));
    block.uniformIndices = [];
    for (const m of block.members) {
      const prefix = block.instance ? `${block.name}.` : '';
      const leaves = uniformLeaves(`${prefix}${m.field.name}`, m.field.type, m.flatOffset, []);
      for (const leaf of leaves) {
        const t = leaf.type, stride = leaf.isArray ? std140({ k: 'array', e: t, len: 2 }, m.field.rowMajor).stride : 0;
        const at = block.components[leaf.offset]?.at ?? m.byteOffset;
        block.uniformIndices.push(activeUniforms.length);
        activeUniforms.push({ ...leaf, glType: glType(t), blockIndex: block.index, byteOffset: at, arrayStride: stride, matrixStride: t.k === 'matrix' ? 16 : 0, rowMajor: t.k === 'matrix' && m.field.rowMajor, sampler: false });
      }
    }
  }
  const readVaryings = [];   // the components of I the fragment shader reads (the rasterizer interpolates only those)
  for (const [sym, offset] of fsInputs) if (offset >= 0 && fgen.usedSymbols.has(sym)) for (let k = 0; k < comps(sym.type); k++) readVaryings.push(offset + k);
  readVaryings.sort((a, b) => a - b);
  const activeAttributes = [];
  for (const sym of inputs) if (vgen.usedSymbols.has(sym)) activeAttributes.push({ name: sym.name, type: sym.type, glType: glType(sym.type), size: 1, location: attributes.get(sym), sym });
  const builtinsWritten = fs.builtins;
  const transformFeedback = program.feedback.varyings.map(name => {
    if (name === 'gl_Position') return { name, offset: 0, count: 4, type: { k: 'vector', b: 'float', n: 4 }, glType: 0x8B52, size: 1 };
    if (name === 'gl_PointSize') return { name, offset: 4, count: 1, type: { k: 'scalar', b: 'float' }, glType: 0x1406, size: 1 };
    const m = /^(\w+)(?:\[(\d+)\])?$/.exec(name), v = m && varyings.get(m[1]); if (!v) fail(`Transform feedback varying "${name}" is not a vertex shader output`);
    if (m[2] !== undefined) { if (v.type.k !== 'array' || Number(m[2]) >= v.type.len) fail(`Transform feedback varying "${name}" is out of range`); const n = comps(v.type.e); return { name, offset: v.offset + Number(m[2]) * n, count: n, type: v.type.e, glType: glType(v.type.e), size: 1 }; }
    return { name, offset: v.offset, count: comps(v.type), type: v.type, glType: glType(v.type.k === 'array' ? v.type.e : v.type), size: v.type.k === 'array' ? v.type.len : 1 };
  });
  if (program.feedback.mode === 0x8C8D && transformFeedback.length > 4) fail('Too many separate transform feedback varyings');
  const U = new Float64Array(Math.max(1, size));
  U[depthRangeOffset] = 0; U[depthRangeOffset + 1] = 1; U[depthRangeOffset + 2] = 1;
  // samplers start at unit 0 (ES: uniforms are zero after a link)
  return {
    version: vs.version, U, uniforms, activeUniforms, activeAttributes, attributes, attributeNames: new Map([...attributes].map(([sym, loc]) => [sym.name, { loc, active: vgen.usedSymbols.has(sym), sym }])),
    varyings, varyingCount: vsize - VARYING_BASE, flat, readVaryings, blocks, outputs, depthRangeOffset, transformFeedback, feedbackMode: program.feedback.mode,
    vertex: vgen, fragment: fgen, writesFragColor: builtinsWritten.has('gl_FragColor'), writesFragData: builtinsWritten.has('gl_FragData'), writesDepth: fs.writesDepth, usesDiscard: fs.usesDiscard,
    fragmentOutputs: [...outputs.values()], version300: fs.version === 300,
    laneInputs: [...fgen.laneInputs].sort((a, b) => a - b), fragCoordLanes: fgen.fragCoordLanes, pointCoordLanes: fgen.pointCoordLanes,
    usesPointSize: vs.builtins.has('gl_PointSize'), usesPointCoord: fs.builtins.has('gl_PointCoord'), usesFragCoord: fs.builtins.has('gl_FragCoord'), usesFrontFacing: fs.builtins.has('gl_FrontFacing'),
  };
}
const typeShape = t => t.k === 'struct' ? t.fields.flatMap(f => [f.name, ...typeShape(f.type)]) : t.k === 'array' ? [`[${t.len}]`, ...typeShape(t.e)] : [t.name];
export { needsStore };
