// GL_TEXTURE_EXTERNAL_OES and samplerExternalOES (GL_OES_EGL_image_external, GL_OES_EGL_image_external_essl3) over WebGL2 or the lab's CPU implementation, which have neither.
// Every Android device compiles shaders with samplerExternalOES, so a renderer that prepares such a pipeline at start (before anything is drawn with it) needs them to compile.
//
//   Shaders   the #extension line is blanked (line numbers stay), its name in #if / #ifdef is the defined macro it is on a device, and samplerExternalOES becomes sampler2D. A
//             shader that uses the type without enabling the extension is left alone and fails to compile, as on a device. glGetShaderSource answers the app's own source.
//   Textures  a texture unit has an external binding beside its 2D one. A program with external samplers draws with its units' external textures in the 2D slot, put back after.
//   Images    what fills an external texture on a device (glEGLImageTargetTexture2DOES, SurfaceTexture.updateTexImage) is not available and fails by name, so an external texture
//             has no image and samples (0, 0, 0, 1), as an incomplete texture does (ES 3.0 3.8.13). For the same reason the extension is not in GL_EXTENSIONS. No process.*.
export const EXTERNAL = 0x8D65, EXTERNAL_BINDING = 0x8D67, SAMPLER_EXTERNAL = 0x8D66;
const TEXTURE_2D = 0x0DE1, TEXTURE_BINDING_2D = 0x8069, ACTIVE_TEXTURE = 0x84E0, TEXTURE0 = 0x84C0, SAMPLER_2D = 0x8B5E, MIN_FILTER = 0x2801, MAG_FILTER = 0x2800, WRAP_S = 0x2802, WRAP_T = 0x2803,
  LINEAR = 0x2601, NEAREST = 0x2600, CLAMP_TO_EDGE = 0x812F, INVALID_ENUM = 0x500, INVALID_OPERATION = 0x502;
const NAME = 'GL_OES_EGL_image_external(?:_essl3)?';
const ENABLE = new RegExp(`^[ \\t]*#[ \\t]*extension[ \\t]+${NAME}[ \\t]*:[ \\t]*(\\w+).*$`, 'gm');

/** `source` as the GL below compiles it, or null when it does not use the extension: { source, samplers: names of the external sampler uniforms }. */
export function translateExternalShader(source) {
  if (!/samplerExternalOES|GL_OES_EGL_image_external/.test(source)) return null;
  let enabled = false;
  let text = source.replace(ENABLE, (_line, behavior) => { if (behavior === 'require' || behavior === 'enable' || behavior === 'warn') enabled = true; return ''; });
  text = text.replace(new RegExp(`^([ \\t]*#[ \\t]*)(ifdef|ifndef)[ \\t]+${NAME}\\b.*$`, 'gm'), (_line, head, word) => `${head}if ${word === 'ifdef' ? 1 : 0}`)
    .replace(/^[ \t]*#[ \t]*(?:if|elif)\b.*$/gm, line => line.replace(new RegExp(`\\bdefined[ \\t]*(?:\\([ \\t]*${NAME}[ \\t]*\\)|${NAME}\\b)`, 'g'), '1').replace(new RegExp(`\\b${NAME}\\b`, 'g'), '1'));
  if (!enabled) return { source: text, samplers: [] };
  const samplers = [];
  for (const [, list] of text.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?samplerExternalOES\s+([^;]+);/g)) for (const part of list.split(',')) { const name = /^\s*(\w+)/.exec(part)?.[1]; if (name) samplers.push(name); }
  return { source: text.replace(/\bsamplerExternalOES\b/g, 'sampler2D'), samplers };
}

const shaders = group => group.externalShaders ??= new WeakMap(), programs = group => group.externalPrograms ??= new WeakMap();
/** glShaderSource. */
export function shaderSource(r, context, shader, source) {
  const translated = translateExternalShader(source);
  if (!translated) { context.group.externalShaders?.delete(shader); context.gl.shaderSource(shader, source); return; }
  if (!context.group.externalNoted) { context.group.externalNoted = true; r.record?.('GL: a shader uses samplerExternalOES; external textures have no image source in the lab (EGLImage, SurfaceTexture) and sample as incomplete textures'); }
  shaders(context.group).set(shader, { original: source, samplers: translated.samplers }); context.gl.shaderSource(shader, translated.source);
}
/** The source the app gave (glGetShaderSource, GL_SHADER_SOURCE_LENGTH). */
export const originalSource = (context, shader) => context.group.externalShaders?.get(shader)?.original ?? context.gl.getShaderSource(shader) ?? '';
/** glLinkProgram: the external sampler uniforms of its shaders. */
export function linked(context, program) {
  const known = context.group.externalShaders; if (!known) return;
  const names = new Set((context.gl.getAttachedShaders(program) ?? []).flatMap(shader => known.get(shader)?.samplers ?? []));
  if (names.size) programs(context.group).set(program, { names, locations: null }); else programs(context.group).delete(program);
}
const isExternal = (context, program, name) => !!context.group.externalPrograms?.get(program)?.names.has(name.replace(/\[0\]$/, ''));
/** glGetActiveUniform's type. */
export const uniformType = (context, program, info) => info.type === SAMPLER_2D && isExternal(context, program, info.name) ? SAMPLER_EXTERNAL : info.type;

const bindings = context => context.externalBindings ??= new Map();   // texture unit -> external texture object
const unitOf = gl => gl.getParameter(ACTIVE_TEXTURE) - TEXTURE0;
/** The lab's object for an external texture (a 2D one below), with the state an external texture starts with. */
function prepare(context, object) {
  const gl = context.gl, previous = gl.getParameter(TEXTURE_BINDING_2D); gl.bindTexture(TEXTURE_2D, object);
  for (const [pname, value] of [[MIN_FILTER, LINEAR], [MAG_FILTER, LINEAR], [WRAP_S, CLAMP_TO_EDGE], [WRAP_T, CLAMP_TO_EDGE]]) gl.texParameteri(TEXTURE_2D, pname, value);
  gl.bindTexture(TEXTURE_2D, previous);
}
/** glBindTexture: an object's first target is its target for good (ES 3.0 3.8.1). Answers true when it handled the call. */
export function bindTexture(context, target, object, raise) {
  const { gl, group } = context, known = group.externalTextures ??= new WeakSet();
  if (target !== EXTERNAL) { if (object && known.has(object)) { raise(context, INVALID_OPERATION); return true; } return false; }
  if (object && !known.has(object)) { if (gl.isTexture(object)) { raise(context, INVALID_OPERATION); return true; } known.add(object); prepare(context, object); }
  if (object) bindings(context).set(unitOf(gl), object); else bindings(context).delete(unitOf(gl));
  return true;
}
export const boundExternal = context => context.externalBindings?.get(unitOf(context.gl)) ?? null;
/** glDeleteTextures: the external bindings of a deleted object go back to 0. */
export function deleted(context, object) { if (context.externalBindings) for (const [unit, bound] of context.externalBindings) if (bound === object) context.externalBindings.delete(unit); }
function withExternal(context, body) {
  const { gl } = context, previous = gl.getParameter(TEXTURE_BINDING_2D); let object = boundExternal(context);
  if (!object) { object = context.externalDefault ??= gl.createTexture(); if (!context.externalDefaultReady) { context.externalDefaultReady = true; prepare(context, object); } }   // texture 0 of the target
  gl.bindTexture(TEXTURE_2D, object); try { return body(TEXTURE_2D); } finally { gl.bindTexture(TEXTURE_2D, previous); }
}
/** glTexParameter* of any target; an external texture takes only CLAMP_TO_EDGE and the filters without mipmaps (GL_OES_EGL_image_external 3.7.14). */
export function texParameter(context, method, target, pname, value, raise) {
  if (target !== EXTERNAL) return context.gl[method](target, pname, value);
  if ((pname === WRAP_S || pname === WRAP_T) && value !== CLAMP_TO_EDGE || pname === MIN_FILTER && value !== LINEAR && value !== NEAREST) return raise(context, INVALID_ENUM);
  withExternal(context, at => context.gl[method](at, pname, value));
}
export const getTexParameter = (context, target, pname) => target === EXTERNAL ? withExternal(context, at => context.gl.getTexParameter(at, pname)) : context.gl.getTexParameter(target, pname);

/** Runs a draw of the current program: its external samplers' units have their external texture in the 2D slot meanwhile. */
export function draw(context, program, body) {
  const entry = context.group.externalPrograms?.get(program); if (!entry) return body();
  const { gl } = context, active = gl.getParameter(ACTIVE_TEXTURE), saved = [];
  entry.locations ??= [...entry.names].map(name => gl.getUniformLocation(program, name)).filter(Boolean);
  const units = new Set(entry.locations.flatMap(location => { const value = gl.getUniform(program, location); return ArrayBuffer.isView(value) ? Array.from(value) : [Number(value)]; }));
  for (const unit of units) { gl.activeTexture(TEXTURE0 + unit); saved.push([unit, gl.getParameter(TEXTURE_BINDING_2D)]); gl.bindTexture(TEXTURE_2D, context.externalBindings?.get(unit) ?? null); }
  try { return body(); }
  finally { for (const [unit, texture] of saved) { gl.activeTexture(TEXTURE0 + unit); gl.bindTexture(TEXTURE_2D, texture); } gl.activeTexture(active); }
}
