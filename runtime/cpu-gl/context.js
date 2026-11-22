// The CPU implementation of OpenGL ES 3.0 (docs/OPENGL-ES-ON-CPU.md), shaped as the WebGL2RenderingContext that src/gles-native.js drives, so the GLES / EGL bindings (Java and
// ARM64) run unchanged over it when the Worker has no WebGL2 (no GPU, Node, a blocklisted driver) or when the device setting asks for the CPU path. Objects, bindings,
// the error flags and every state query follow the OpenGL ES 3.0.6 specification; where WebGL2 is stricter than ES (buffer-bound checks on draws, robust array indexing in
// shaders) the lab's WebGL2 path already behaves that way and this one does the same. Pixels: textures, renderbuffers and the default framebuffer are images of
// src/cpu-gl/formats.js, rows bottom-up as GL addresses them; transferToImageBitmap turns the default framebuffer into the page's picture (top-down). No process.*.
import { Shader, Program, compileShader, linkProgram, VARYING_BASE, MAX_VERTEX_ATTRIBS, MAX_DRAW_BUFFERS, MAX_COMBINED_UNITS } from './program.js?v=266d8da382fc';
import { Texture, Sampler, Unit, T as TX, SAMPLER_PARAMS } from './textures.js?v=266d8da382fc';
import { FORMATS, COMPRESSED_FORMATS, GLC, Image, formatOf, unpackInto, packFrom, clientLayout, uploadAllowed, readFormatAllowed, readPreferred, makeColorWriter, readTexel, quantizeDepth, isKnownType, isKnownFormat, toHalf, fromHalf } from './formats.js?v=266d8da382fc';
import { draw as drawPipeline, MODES } from './raster.js?v=266d8da382fc';
import { comps } from './glsl-types.js?v=266d8da382fc';
import { LOOP_LIMIT } from './glsl-codegen.js?v=266d8da382fc';
import { WEBGL_CONSTANTS } from './constants.js?v=266d8da382fc';
import { ETC_FORMATS, compressedSize, decodeInto } from './etc.js?v=266d8da382fc';

export const CPU_RENDERER = 'APK Web Lab CPU rasterizer', CPU_VENDOR = 'APK Web Lab';
const C = {
  NO_ERROR: 0, INVALID_ENUM: 0x500, INVALID_VALUE: 0x501, INVALID_OPERATION: 0x502, OUT_OF_MEMORY: 0x505, INVALID_FRAMEBUFFER_OPERATION: 0x506,
  DEPTH_BUFFER_BIT: 0x100, STENCIL_BUFFER_BIT: 0x400, COLOR_BUFFER_BIT: 0x4000,
  ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, COPY_READ_BUFFER: 0x8F36, COPY_WRITE_BUFFER: 0x8F37, PIXEL_PACK_BUFFER: 0x88EB, PIXEL_UNPACK_BUFFER: 0x88EC, TRANSFORM_FEEDBACK_BUFFER: 0x8C8E, UNIFORM_BUFFER: 0x8A11,
  ARRAY_BUFFER_BINDING: 0x8894, ELEMENT_ARRAY_BUFFER_BINDING: 0x8895, STREAM_DRAW: 0x88E0, STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8, BUFFER_SIZE: 0x8764, BUFFER_USAGE: 0x8765,
  FRAMEBUFFER: 0x8D40, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9, RENDERBUFFER: 0x8D41, FRAMEBUFFER_BINDING: 0x8CA6, DRAW_FRAMEBUFFER_BINDING: 0x8CA6, READ_FRAMEBUFFER_BINDING: 0x8CAA, RENDERBUFFER_BINDING: 0x8CA7,
  COLOR_ATTACHMENT0: 0x8CE0, DEPTH_ATTACHMENT: 0x8D00, STENCIL_ATTACHMENT: 0x8D20, DEPTH_STENCIL_ATTACHMENT: 0x821A, BACK: 0x0405, NONE: 0,
  FRAMEBUFFER_COMPLETE: 0x8CD5, FRAMEBUFFER_INCOMPLETE_ATTACHMENT: 0x8CD6, FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: 0x8CD7, FRAMEBUFFER_INCOMPLETE_DIMENSIONS: 0x8CD9, FRAMEBUFFER_UNSUPPORTED: 0x8CDD, FRAMEBUFFER_INCOMPLETE_MULTISAMPLE: 0x8D56, FRAMEBUFFER_UNDEFINED: 0x8219,
  SCISSOR_TEST: 0x0C11, BLEND: 0x0BE2, DEPTH_TEST: 0x0B71, CULL_FACE: 0x0B44, STENCIL_TEST: 0x0B90, DITHER: 0x0BD0, POLYGON_OFFSET_FILL: 0x8037, SAMPLE_ALPHA_TO_COVERAGE: 0x809E, SAMPLE_COVERAGE: 0x80A0, RASTERIZER_DISCARD: 0x8C89, PRIMITIVE_RESTART_FIXED_INDEX: 0x8D69,
  VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30, COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82, DELETE_STATUS: 0x8B80, VALIDATE_STATUS: 0x8B83, SHADER_TYPE: 0x8B4F, ATTACHED_SHADERS: 0x8B85, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B89,
  ACTIVE_UNIFORM_BLOCKS: 0x8A36, TRANSFORM_FEEDBACK_VARYINGS: 0x8C83, TRANSFORM_FEEDBACK_BUFFER_MODE: 0x8C7F, INTERLEAVED_ATTRIBS: 0x8C8C, SEPARATE_ATTRIBS: 0x8C8D,
  TEXTURE0: 0x84C0, TEXTURE_2D: 0x0DE1, TEXTURE_3D: 0x806F, TEXTURE_2D_ARRAY: 0x8C1A, TEXTURE_CUBE_MAP: 0x8513, TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
  UNPACK_ALIGNMENT: 0x0CF5, PACK_ALIGNMENT: 0x0D05, UNPACK_ROW_LENGTH: 0x0CF2, UNPACK_SKIP_ROWS: 0x0CF3, UNPACK_SKIP_PIXELS: 0x0CF4, PACK_ROW_LENGTH: 0x0D02, PACK_SKIP_ROWS: 0x0D03, PACK_SKIP_PIXELS: 0x0D04, UNPACK_IMAGE_HEIGHT: 0x806E, UNPACK_SKIP_IMAGES: 0x806D,
  TRANSFORM_FEEDBACK: 0x8E22, ANY_SAMPLES_PASSED: 0x8C2F, ANY_SAMPLES_PASSED_CONSERVATIVE: 0x8D6A, TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN: 0x8C88, QUERY_RESULT: 0x8866, QUERY_RESULT_AVAILABLE: 0x8867, CURRENT_QUERY: 0x8865,
  SYNC_GPU_COMMANDS_COMPLETE: 0x9117, ALREADY_SIGNALED: 0x911A, SIGNALED: 0x9119, SYNC_STATUS: 0x9114, OBJECT_TYPE: 0x9112, SYNC_CONDITION: 0x9113, SYNC_FLAGS: 0x9115, SYNC_FENCE: 0x9116,
};
const CAPS = new Map([[C.SCISSOR_TEST, 'scissorTest'], [C.BLEND, 'blend'], [C.DEPTH_TEST, 'depthTest'], [C.CULL_FACE, 'cullFace'], [C.STENCIL_TEST, 'stencilTest'], [C.DITHER, 'dither'], [C.POLYGON_OFFSET_FILL, 'polygonOffsetFill'],
  [C.SAMPLE_ALPHA_TO_COVERAGE, 'sampleAlphaToCoverage'], [C.SAMPLE_COVERAGE, 'sampleCoverage'], [C.RASTERIZER_DISCARD, 'rasterizerDiscard'], [C.PRIMITIVE_RESTART_FIXED_INDEX, 'primitiveRestart']]);
const BUFFER_TARGETS = new Map([[C.ARRAY_BUFFER, 'array'], [C.ELEMENT_ARRAY_BUFFER, 'element'], [C.COPY_READ_BUFFER, 'copyRead'], [C.COPY_WRITE_BUFFER, 'copyWrite'], [C.PIXEL_PACK_BUFFER, 'pixelPack'], [C.PIXEL_UNPACK_BUFFER, 'pixelUnpack'], [C.TRANSFORM_FEEDBACK_BUFFER, 'transformFeedback'], [C.UNIFORM_BUFFER, 'uniform']]);
const TEXTURE_TARGETS = new Map([[C.TEXTURE_2D, '2d'], [C.TEXTURE_3D, '3d'], [C.TEXTURE_2D_ARRAY, '2darray'], [C.TEXTURE_CUBE_MAP, 'cube']]);
const BLEND_EQUATIONS = new Set([0x8006, 0x800A, 0x800B, 0x8007, 0x8008]);
const BLEND_FACTORS = new Set([0, 1, 0x300, 0x301, 0x302, 0x303, 0x304, 0x305, 0x306, 0x307, 0x308, 0x8001, 0x8002, 0x8003, 0x8004]);
const COMPARE_FUNCS = new Set([0x200, 0x201, 0x202, 0x203, 0x204, 0x205, 0x206, 0x207]);
const STENCIL_OPS = new Set([0x1E00, 0, 0x1E01, 0x1E02, 0x1E03, 0x150A, 0x8507, 0x8508]);
const INDEX_BYTES = { 0x1401: 1, 0x1403: 2, 0x1405: 4 };
const ATTRIB_TYPES = { 0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x1404: 4, 0x1405: 4, 0x1406: 4, 0x140B: 2, 0x140C: 4, 0x8D9F: 4, 0x8368: 4 };
/** The WebGL extension names this implementation offers (src/gles-native.js maps them to the OpenGL ES extension strings). */
export const CPU_EXTENSIONS = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'OES_texture_float_linear', 'EXT_float_blend', 'WEBGL_compressed_texture_etc', 'WEBGL_compressed_texture_etc1'];

class GLObject { constructor(kind) { this.kind = kind; this.deleted = false; this.used = false; } }
const newVertexArray = () => { const vao = new GLObject('vertexArray'); vao.attribs = Array.from({ length: MAX_VERTEX_ATTRIBS }, () => ({ enabled: false, buffer: null, size: 4, type: 0x1406, normalized: false, integer: false, stride: 0, offset: 0, divisor: 0, elementBytes: 16, componentBytes: 4 })); vao.element = null; return vao; };

/** A new CPU context: { gl, canvas } with the shape of OffscreenCanvas.getContext('webgl2'). `note(text)` records what the trace should say (multisampling at one sample, loop limits). */
export function createCpuWebGL2({ width = 1, height = 1, note = null, makeBitmap = null } = {}) {
  const gl = new CpuGL({ width, height, note, makeBitmap });
  return { gl, canvas: gl.canvas, renderer: CPU_RENDERER, path: 'cpu' };
}

export class CpuGL {
  constructor({ width, height, note, makeBitmap }) {
    Object.assign(this, WEBGL_CONSTANTS, C);
    this.note = text => { if (!this.notes.has(text)) { this.notes.add(text); note?.(text); } }; this.notes = new Set();
    this.errors = [];
    this.makeBitmap = makeBitmap;
    const self = this;
    let cw = width, ch = height;
    this.defaultColor = new Image(FORMATS[0x8058], cw, ch);
    this.canvas = {
      get width() { return cw; }, set width(v) { v = Math.max(1, v | 0); if (v !== cw) { cw = v; self.defaultColor = new Image(FORMATS[0x8058], cw, ch); } },
      get height() { return ch; }, set height(v) { v = Math.max(1, v | 0); if (v !== ch) { ch = v; self.defaultColor = new Image(FORMATS[0x8058], cw, ch); } },
      transferToImageBitmap: () => self.transferToImageBitmap(),
      getContext: () => self,
    };
    this.P = new Float64Array(16); this.R = new Float64Array(4);
    const rt = { P: this.P, R: this.R };
    this.S2 = Array.from({ length: MAX_COMBINED_UNITS }, () => new Unit(rt, TX.TEXTURE_2D)); this.S3 = Array.from({ length: MAX_COMBINED_UNITS }, () => new Unit(rt, TX.TEXTURE_3D));
    this.SC = Array.from({ length: MAX_COMBINED_UNITS }, () => new Unit(rt, TX.TEXTURE_CUBE_MAP)); this.SA = Array.from({ length: MAX_COMBINED_UNITS }, () => new Unit(rt, TX.TEXTURE_2D_ARRAY));
    this.generic = Array.from({ length: MAX_VERTEX_ATTRIBS }, () => Object.assign(new Float64Array([0, 0, 0, 1]), { kind: 'float' }));
    this.samplesPassed = 0; this.primitivesWritten = 0;
    const defaultVao = newVertexArray();
    this.state = {
      viewport: [0, 0, width, height], scissor: [0, 0, width, height], depthRange: [0, 1], clearColor: [0, 0, 0, 0], clearDepth: 1, clearStencil: 0,
      colorMask: [true, true, true, true], depthMask: true, stencilWriteMask: [0xffffffff, 0xffffffff],
      scissorTest: false, blend: false, depthTest: false, cullFace: false, stencilTest: false, dither: true, polygonOffsetFill: false, sampleAlphaToCoverage: false, sampleCoverage: false, rasterizerDiscard: false, primitiveRestart: false,
      blendColor: [0, 0, 0, 0], blendEquation: [0x8006, 0x8006], blendFunc: [1, 0, 1, 0], depthFunc: 0x201, stencilFunc: [{ func: 0x207, ref: 0, mask: 0xffffffff }, { func: 0x207, ref: 0, mask: 0xffffffff }],
      stencilOp: [{ fail: 0x1E00, zfail: 0x1E00, zpass: 0x1E00 }, { fail: 0x1E00, zfail: 0x1E00, zpass: 0x1E00 }], cullMode: 0x405, frontFace: 0x901, polygonOffset: [0, 0], lineWidth: 1, sampleCoverageValue: 1, sampleCoverageInvert: false,
      hints: { 0x8192: 0x1100, 0x8B8B: 0x1100 }, program: null, vao: defaultVao, defaultVao, buffers: { array: null, copyRead: null, copyWrite: null, pixelPack: null, pixelUnpack: null, transformFeedback: null, uniform: null },
      uniformBindings: Array.from({ length: 24 }, () => ({ buffer: null, offset: 0, size: 0 })), activeTexture: 0,
      textures: Array.from({ length: MAX_COMBINED_UNITS }, () => ({ '2d': null, '3d': null, '2darray': null, cube: null })), samplers: Array(MAX_COMBINED_UNITS).fill(null),
      drawFb: null, readFb: null, renderbuffer: null, defaultDrawBuffer: C.BACK, defaultReadBuffer: C.BACK,
      pack: { alignment: 4, rowLength: 0, skipRows: 0, skipPixels: 0 }, unpack: { alignment: 4, rowLength: 0, skipRows: 0, skipPixels: 0, imageHeight: 0, skipImages: 0 },
      transformFeedback: null, queries: new Map(),
    };
    this.defaultFeedback = this.createTransformFeedback(); this.state.transformFeedback = this.defaultFeedback;
  }
  // ---- errors ----
  err(code) { if (!this.errors.includes(code)) this.errors.push(code); }
  getError() { return this.errors.shift() ?? C.NO_ERROR; }
  isContextLost() { return false; }
  getContextAttributes() { return { alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false, desynchronized: false }; }
  getSupportedExtensions() { return [...CPU_EXTENSIONS]; }
  getExtension(name) { return CPU_EXTENSIONS.includes(name) ? {} : null; }
  finish() {} flush() {}

  // ---- the picture for the page ----
  transferToImageBitmap() {
    const img = this.defaultColor, w = img.width, h = img.height, pixels = new Uint8ClampedArray(w * h * 4), row = w * 4;
    for (let y = 0; y < h; y++) pixels.set(img.data.subarray((h - 1 - y) * row, (h - y) * row), y * row);   // GL rows are bottom-up; a bitmap's top-down
    img.data.fill(0); for (let i = 3; i < img.data.length; i += 4) img.data[i] = 0;   // preserveDrawingBuffer: false
    const made = this.makeBitmap?.(pixels, w, h);
    return made ?? { width: w, height: h, pixels: new Uint8Array(pixels.buffer), closed: false, close() { this.closed = true; } };
  }

  // ---- state ----
  enable(cap) { const key = CAPS.get(cap); if (!key) return this.err(C.INVALID_ENUM); this.state[key] = true; }
  disable(cap) { const key = CAPS.get(cap); if (!key) return this.err(C.INVALID_ENUM); this.state[key] = false; }
  isEnabled(cap) { const key = CAPS.get(cap); if (!key) { this.err(C.INVALID_ENUM); return false; } return this.state[key]; }
  viewport(x, y, w, h) { if (w < 0 || h < 0) return this.err(C.INVALID_VALUE); this.state.viewport = [x | 0, y | 0, Math.min(w, 4096) | 0, Math.min(h, 4096) | 0]; }
  scissor(x, y, w, h) { if (w < 0 || h < 0) return this.err(C.INVALID_VALUE); this.state.scissor = [x | 0, y | 0, w | 0, h | 0]; }
  clearColor(r, g, b, a) { this.state.clearColor = [r, g, b, a].map(Math.fround); }
  clearDepth(d) { this.state.clearDepth = Math.min(1, Math.max(0, d)); }
  clearStencil(s) { this.state.clearStencil = s | 0; }
  colorMask(r, g, b, a) { this.state.colorMask = [!!r, !!g, !!b, !!a]; }
  depthMask(flag) { this.state.depthMask = !!flag; }
  depthFunc(f) { if (!COMPARE_FUNCS.has(f)) return this.err(C.INVALID_ENUM); this.state.depthFunc = f; }
  depthRange(n, f) { this.state.depthRange = [Math.min(1, Math.max(0, n)), Math.min(1, Math.max(0, f))]; }
  blendColor(r, g, b, a) { this.state.blendColor = [r, g, b, a].map(Math.fround); }
  blendEquation(m) { this.blendEquationSeparate(m, m); }
  blendEquationSeparate(rgb, a) { if (!BLEND_EQUATIONS.has(rgb) || !BLEND_EQUATIONS.has(a)) return this.err(C.INVALID_ENUM); this.state.blendEquation = [rgb, a]; }
  blendFunc(s, d) { this.blendFuncSeparate(s, d, s, d); }
  blendFuncSeparate(sr, dr, sa, da) { if (![sr, dr, sa, da].every(f => BLEND_FACTORS.has(f))) return this.err(C.INVALID_ENUM); this.state.blendFunc = [sr, dr, sa, da]; }
  cullFace(m) { if (![0x404, 0x405, 0x408].includes(m)) return this.err(C.INVALID_ENUM); this.state.cullMode = m; }
  frontFace(m) { if (m !== 0x900 && m !== 0x901) return this.err(C.INVALID_ENUM); this.state.frontFace = m; }
  lineWidth(w) { if (!(w > 0)) return this.err(C.INVALID_VALUE); this.state.lineWidth = w; }
  polygonOffset(factor, units) { this.state.polygonOffset = [Math.fround(factor), Math.fround(units)]; }
  sampleCoverage(v, invert) { this.state.sampleCoverageValue = Math.min(1, Math.max(0, v)); this.state.sampleCoverageInvert = !!invert; }
  hint(target, mode) { if (!(target in this.state.hints)) return this.err(C.INVALID_ENUM); if (![0x1100, 0x1101, 0x1102].includes(mode)) return this.err(C.INVALID_ENUM); this.state.hints[target] = mode; }
  stencilFunc(func, ref, mask) { this.stencilFuncSeparate(0x408, func, ref, mask); }
  stencilFuncSeparate(face, func, ref, mask) { if (!COMPARE_FUNCS.has(func)) return this.err(C.INVALID_ENUM); const f = { func, ref: ref | 0, mask: mask >>> 0 }; if (face === 0x404 || face === 0x408) this.state.stencilFunc[0] = { ...f }; if (face === 0x405 || face === 0x408) this.state.stencilFunc[1] = { ...f }; if (![0x404, 0x405, 0x408].includes(face)) this.err(C.INVALID_ENUM); }
  stencilMask(mask) { this.stencilMaskSeparate(0x408, mask); }
  stencilMaskSeparate(face, mask) { if (face === 0x404 || face === 0x408) this.state.stencilWriteMask[0] = mask >>> 0; if (face === 0x405 || face === 0x408) this.state.stencilWriteMask[1] = mask >>> 0; if (![0x404, 0x405, 0x408].includes(face)) this.err(C.INVALID_ENUM); }
  stencilOp(fail, zfail, zpass) { this.stencilOpSeparate(0x408, fail, zfail, zpass); }
  stencilOpSeparate(face, fail, zfail, zpass) { if (![fail, zfail, zpass].every(o => STENCIL_OPS.has(o))) return this.err(C.INVALID_ENUM); const o = { fail, zfail, zpass }; if (face === 0x404 || face === 0x408) this.state.stencilOp[0] = { ...o }; if (face === 0x405 || face === 0x408) this.state.stencilOp[1] = { ...o }; if (![0x404, 0x405, 0x408].includes(face)) this.err(C.INVALID_ENUM); }
  activeTexture(unit) { const i = unit - C.TEXTURE0; if (i < 0 || i >= MAX_COMBINED_UNITS) return this.err(C.INVALID_ENUM); this.state.activeTexture = i; }
  pixelStorei(pname, value) {
    const s = this.state, map = { [C.UNPACK_ALIGNMENT]: ['unpack', 'alignment'], [C.PACK_ALIGNMENT]: ['pack', 'alignment'], [C.UNPACK_ROW_LENGTH]: ['unpack', 'rowLength'], [C.UNPACK_SKIP_ROWS]: ['unpack', 'skipRows'], [C.UNPACK_SKIP_PIXELS]: ['unpack', 'skipPixels'], [C.PACK_ROW_LENGTH]: ['pack', 'rowLength'], [C.PACK_SKIP_ROWS]: ['pack', 'skipRows'], [C.PACK_SKIP_PIXELS]: ['pack', 'skipPixels'], [C.UNPACK_IMAGE_HEIGHT]: ['unpack', 'imageHeight'], [C.UNPACK_SKIP_IMAGES]: ['unpack', 'skipImages'] }[pname];
    if (!map) return this.err(C.INVALID_ENUM);
    if (map[1] === 'alignment' && ![1, 2, 4, 8].includes(value)) return this.err(C.INVALID_VALUE); if (value < 0) return this.err(C.INVALID_VALUE);
    s[map[0]][map[1]] = value;
  }

  // ---- getters ----
  drawBufferBits(which) {
    const t = this.framebufferImages(this.state.drawFb, true);
    if (which === 'depth') return t?.depth?.img.fmt.depthBits ?? 0; if (which === 'stencil') return t?.stencil?.img.fmt.stencilBits ?? 0;
    const c = t?.colors.find(Boolean); if (!c) return 0; const fmt = c.img.fmt, i = { r: 0, g: 1, b: 2, a: 3 }[which];
    if (fmt.channels === 'L' || fmt.channels === 'LA') return i < 3 ? fmt.lbits ?? 8 : fmt.bits[3];
    return fmt.bits[i] ?? 0;
  }
  getParameter(p) {
    const s = this.state, f32 = a => new Float32Array(a), i32 = a => new Int32Array(a);
    switch (p) {
      case 0x1F00: return CPU_VENDOR; case 0x1F01: return CPU_RENDERER; case 0x1F02: return 'WebGL 2.0 (OpenGL ES 3.0 CPU)'; case 0x8B8C: return 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 CPU)';
      case 0x0D33: return 4096; case 0x851C: return 4096; case 0x8073: return 2048; case 0x88FF: return 256; case 0x84E8: return 4096; case 0x0D3A: return i32([4096, 4096]);
      case 0x8869: return MAX_VERTEX_ATTRIBS; case 0x8DFB: return 256; case 0x8DFD: return 224; case 0x8DFC: return 15; case 0x8B4C: return 16; case 0x8872: return 16; case 0x8B4D: return MAX_COMBINED_UNITS;
      case 0x8D6B: return 4294967295; case 0x8824: return MAX_DRAW_BUFFERS; case 0x8CDF: return MAX_DRAW_BUFFERS; case 0x8D57: return 4; case 0x8B4A: return 1024; case 0x8B49: return 896; case 0x9122: return 64; case 0x9125: return 60;
      case 0x8A2F: return 24; case 0x8A30: return 16384; case 0x8A2B: return 12; case 0x8A2D: return 12; case 0x8A2E: return 24; case 0x8A34: return 4; case 0x8A31: return 1024 + 12 * 4096; case 0x8A33: return 896 + 12 * 4096;
      case 0x8C8A: return 64; case 0x8C8B: return 4; case 0x8C80: return 4; case 0x8905: return 7; case 0x8904: return -8; case 0x84FD: return 16; case 0x9111: return 0; case 0x8D6C: return 0;
      case 0x846E: return f32([1, 1]); case 0x846D: return f32([1, 1024]); case 0x0D50: return 8;
      case 0x0D52: return this.drawBufferBits('r'); case 0x0D53: return this.drawBufferBits('g'); case 0x0D54: return this.drawBufferBits('b'); case 0x0D55: return this.drawBufferBits('a');
      case 0x0D56: return this.drawBufferBits('depth'); case 0x0D57: return this.drawBufferBits('stencil');
      case 0x80A8: return 0; case 0x80A9: return 0;
      case 0x8B9B: case 0x8B9A: { const t = this.readImage(); if (!t) { this.err(C.INVALID_OPERATION); return null; } const pref = readPreferred(t.img.fmt); return p === 0x8B9B ? pref.format : pref.type; }
      case 0x86A3: return Uint32Array.from(COMPRESSED_FORMATS); case 0x8DF8: return new Uint32Array(0); case 0x87FF: return new Uint32Array(0);
      case 0x84E0: return C.TEXTURE0 + s.activeTexture; case 0x8894: return s.buffers.array; case 0x8895: return s.vao.element;
      case 0x0BE2: return s.blend; case 0x8005: return f32(s.blendColor); case 0x80CA: return s.blendFunc[3]; case 0x80C8: return s.blendFunc[1]; case 0x883D: return s.blendEquation[1]; case 0x8009: return s.blendEquation[0];
      case 0x80CB: return s.blendFunc[2]; case 0x80C9: return s.blendFunc[0]; case 0x0C22: return f32(s.clearColor); case 0x0C23: return [...s.colorMask]; case 0x0B44: return s.cullFace; case 0x0B45: return s.cullMode;
      case 0x8B8D: return s.program; case 0x0B73: return s.clearDepth; case 0x0B74: return s.depthFunc; case 0x0B70: return f32(s.depthRange); case 0x0B71: return s.depthTest; case 0x0B72: return s.depthMask; case 0x0BD0: return s.dither;
      case 0x8CA6: return s.drawFb; case 0x8CAA: return s.readFb; case 0x8CA7: return s.renderbuffer; case 0x0B46: return s.frontFace; case 0x8192: return s.hints[0x8192]; case 0x8B8B: return s.hints[0x8B8B]; case 0x0B21: return s.lineWidth;
      case 0x0D05: return s.pack.alignment; case 0x0CF5: return s.unpack.alignment; case 0x0D02: return s.pack.rowLength; case 0x0D03: return s.pack.skipRows; case 0x0D04: return s.pack.skipPixels;
      case 0x0CF2: return s.unpack.rowLength; case 0x0CF3: return s.unpack.skipRows; case 0x0CF4: return s.unpack.skipPixels; case 0x806E: return s.unpack.imageHeight; case 0x806D: return s.unpack.skipImages;
      case 0x8038: return s.polygonOffset[0]; case 0x8037: return s.polygonOffsetFill; case 0x2A00: return s.polygonOffset[1]; case 0x809E: return s.sampleAlphaToCoverage; case 0x80A0: return s.sampleCoverage;
      case 0x80AB: return s.sampleCoverageInvert; case 0x80AA: return s.sampleCoverageValue; case 0x0C10: return i32(s.scissor); case 0x0C11: return s.scissorTest;
      case 0x8801: return s.stencilOp[1].fail; case 0x8800: return s.stencilFunc[1].func; case 0x8802: return s.stencilOp[1].zfail; case 0x8803: return s.stencilOp[1].zpass; case 0x8CA3: return s.stencilFunc[1].ref;
      case 0x8CA4: return s.stencilFunc[1].mask; case 0x8CA5: return s.stencilWriteMask[1]; case 0x0B91: return s.clearStencil; case 0x0B94: return s.stencilOp[0].fail; case 0x0B92: return s.stencilFunc[0].func;
      case 0x0B95: return s.stencilOp[0].zfail; case 0x0B96: return s.stencilOp[0].zpass; case 0x0B97: return s.stencilFunc[0].ref; case 0x0B90: return s.stencilTest; case 0x0B93: return s.stencilFunc[0].mask; case 0x0B98: return s.stencilWriteMask[0];
      case 0x8069: return s.textures[s.activeTexture]['2d']; case 0x8514: return s.textures[s.activeTexture].cube; case 0x806A: return s.textures[s.activeTexture]['3d']; case 0x8C1D: return s.textures[s.activeTexture]['2darray'];
      case 0x0BA2: return i32(s.viewport); case 0x8F36: return s.buffers.copyRead; case 0x8F37: return s.buffers.copyWrite; case 0x88ED: return s.buffers.pixelPack; case 0x88EF: return s.buffers.pixelUnpack;
      case 0x8C89: return s.rasterizerDiscard; case 0x8D69: return s.primitiveRestart; case 0x0C02: return s.readFb ? s.readFb.readBuffer : s.defaultReadBuffer;
      case 0x8919: return s.samplers[s.activeTexture]; case 0x8E24: return !!s.transformFeedback.active; case 0x8E23: return !!s.transformFeedback.paused; case 0x8E25: return s.transformFeedback === this.defaultFeedback ? null : s.transformFeedback;
      case 0x8C8F: return s.buffers.transformFeedback; case 0x8A28: return s.buffers.uniform; case 0x85B5: return s.vao === s.defaultVao ? null : s.vao;
      case 0x821B: return 3; case 0x821C: return 0;
    }
    if (p >= 0x8825 && p < 0x8825 + MAX_DRAW_BUFFERS) { const i = p - 0x8825; return s.drawFb ? s.drawFb.drawBuffers[i] : i === 0 ? s.defaultDrawBuffer : C.NONE; }
    this.err(C.INVALID_ENUM); return null;
  }
  getIndexedParameter(target, index) {
    const s = this.state;
    if (target === 0x8C8F || target === 0x8C84 || target === 0x8C85) { const b = s.transformFeedback.buffers[index]; if (!b) { this.err(C.INVALID_VALUE); return null; } return target === 0x8C8F ? b.buffer : target === 0x8C84 ? b.offset : b.size; }
    if (target === 0x8A28 || target === 0x8A29 || target === 0x8A2A) { const b = s.uniformBindings[index]; if (!b) { this.err(C.INVALID_VALUE); return null; } return target === 0x8A28 ? b.buffer : target === 0x8A29 ? b.offset : b.size; }
    this.err(C.INVALID_ENUM); return null;
  }
  getShaderPrecisionFormat(shaderType, precisionType) {
    if (shaderType !== C.VERTEX_SHADER && shaderType !== C.FRAGMENT_SHADER) { this.err(C.INVALID_ENUM); return null; }
    if (precisionType >= 0x8DF0 && precisionType <= 0x8DF2) return { rangeMin: 127, rangeMax: 127, precision: 23 };   // every float precision computes at least IEEE single precision
    if (precisionType >= 0x8DF3 && precisionType <= 0x8DF5) return { rangeMin: 31, rangeMax: 30, precision: 0 };
    this.err(C.INVALID_ENUM); return null;
  }
  getInternalformatParameter(target, internalformat, pname) {
    if (target !== C.RENDERBUFFER) { this.err(C.INVALID_ENUM); return null; }
    const fmt = FORMATS[internalformat]; if (!fmt || !fmt.renderable || !fmt.sized) { this.err(C.INVALID_ENUM); return null; }
    if (pname === 0x80A9) return new Int32Array(fmt.kind === 'int' || fmt.kind === 'uint' || fmt.floatTarget ? [] : [4]);
    if (pname === 0x9380) return new Int32Array([fmt.kind === 'int' || fmt.kind === 'uint' || fmt.floatTarget ? 0 : 1]);   // GL_NUM_SAMPLE_COUNTS
    this.err(C.INVALID_ENUM); return null;
  }

  // ---- buffers ----
  createBuffer() { const b = new GLObject('buffer'); b.data = new Uint8Array(0); b.usage = C.STATIC_DRAW; return b; }
  deleteBuffer(b) {
    if (!b || b.deleted) return; b.deleted = true; const s = this.state;
    for (const key of Object.keys(s.buffers)) if (s.buffers[key] === b) s.buffers[key] = null;
    for (const a of s.vao.attribs) if (a.buffer === b) a.buffer = null; if (s.vao.element === b) s.vao.element = null;
    for (const u of s.uniformBindings) if (u.buffer === b) u.buffer = null;
  }
  isBuffer(b) { return !!b && b.kind === 'buffer' && !b.deleted && b.used; }
  bufferFor(target) {
    if (target === C.ELEMENT_ARRAY_BUFFER) return this.state.vao.element;
    const key = BUFFER_TARGETS.get(target); if (!key) { this.err(C.INVALID_ENUM); return undefined; } return this.state.buffers[key];
  }
  bindBuffer(target, b) {
    const key = BUFFER_TARGETS.get(target); if (!key) return this.err(C.INVALID_ENUM);
    if (b && b.deleted) return this.err(C.INVALID_OPERATION);
    if (b) { if (b.boundAs && ((b.boundAs === 'element') !== (key === 'element')) && false) return this.err(C.INVALID_OPERATION); b.used = true; b.boundAs ??= key; }
    if (key === 'element') this.state.vao.element = b; else this.state.buffers[key] = b;
  }
  bufferData(target, data, usage) {
    const b = this.bufferFor(target); if (b === undefined) return; if (!b) return this.err(C.INVALID_OPERATION);
    if (![0x88E0, 0x88E1, 0x88E2, 0x88E4, 0x88E5, 0x88E6, 0x88E8, 0x88E9, 0x88EA].includes(usage)) return this.err(C.INVALID_ENUM);
    if (typeof data === 'number') { if (data < 0) return this.err(C.INVALID_VALUE); b.data = new Uint8Array(data); }
    else if (data === null) b.data = new Uint8Array(0);
    else b.data = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
    b.usage = usage; b.version = (b.version ?? 0) + 1;
  }
  bufferSubData(target, offset, data) {
    const b = this.bufferFor(target); if (b === undefined) return; if (!b) return this.err(C.INVALID_OPERATION);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (offset < 0 || offset + bytes.length > b.data.length) return this.err(C.INVALID_VALUE);
    b.data.set(bytes, offset); b.version = (b.version ?? 0) + 1;
  }
  getBufferSubData(target, offset, dst) {
    const b = this.bufferFor(target); if (b === undefined) return; if (!b) return this.err(C.INVALID_OPERATION);
    const out = new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength); if (offset < 0 || offset + out.length > b.data.length) return this.err(C.INVALID_VALUE);
    out.set(b.data.subarray(offset, offset + out.length));
  }
  copyBufferSubData(readTarget, writeTarget, readOffset, writeOffset, size) {
    const from = this.bufferFor(readTarget), to = this.bufferFor(writeTarget); if (from === undefined || to === undefined) return; if (!from || !to) return this.err(C.INVALID_OPERATION);
    if (readOffset < 0 || writeOffset < 0 || size < 0 || readOffset + size > from.data.length || writeOffset + size > to.data.length) return this.err(C.INVALID_VALUE);
    if (from === to && Math.abs(readOffset - writeOffset) < size) return this.err(C.INVALID_VALUE);
    to.data.set(from.data.slice(readOffset, readOffset + size), writeOffset);
  }
  getBufferParameter(target, pname) {
    const b = this.bufferFor(target); if (b === undefined) return null; if (!b) { this.err(C.INVALID_OPERATION); return null; }
    if (pname === C.BUFFER_SIZE) return b.data.length; if (pname === C.BUFFER_USAGE) return b.usage; if (pname === 0x88BC) return false; if (pname === 0x911F || pname === 0x9120 || pname === 0x9121) return 0;
    this.err(C.INVALID_ENUM); return null;
  }
  bindBufferBase(target, index, b) { this.bindBufferRange(target, index, b, 0, -1); }
  bindBufferRange(target, index, b, offset, size) {
    const s = this.state;
    if (target === C.UNIFORM_BUFFER) { if (index < 0 || index >= 24) return this.err(C.INVALID_VALUE); if (b) b.used = true; s.uniformBindings[index] = { buffer: b, offset, size }; s.buffers.uniform = b; return; }
    if (target === C.TRANSFORM_FEEDBACK_BUFFER) { if (index < 0 || index >= 4) return this.err(C.INVALID_VALUE); if (s.transformFeedback.active) return this.err(C.INVALID_OPERATION); if (b) b.used = true; s.transformFeedback.buffers[index] = { buffer: b, offset, size }; s.buffers.transformFeedback = b; return; }
    this.err(C.INVALID_ENUM);
  }

  // ---- vertex arrays and attributes ----
  createVertexArray() { return newVertexArray(); }
  deleteVertexArray(v) { if (!v || v.deleted) return; v.deleted = true; if (this.state.vao === v) this.state.vao = this.state.defaultVao; }
  isVertexArray(v) { return !!v && v.kind === 'vertexArray' && !v.deleted && v.used; }
  bindVertexArray(v) { if (v && v.deleted) return this.err(C.INVALID_OPERATION); if (v) v.used = true; this.state.vao = v ?? this.state.defaultVao; }
  enableVertexAttribArray(i) { if (i >= MAX_VERTEX_ATTRIBS) return this.err(C.INVALID_VALUE); this.state.vao.attribs[i].enabled = true; }
  disableVertexAttribArray(i) { if (i >= MAX_VERTEX_ATTRIBS) return this.err(C.INVALID_VALUE); this.state.vao.attribs[i].enabled = false; }
  vertexAttribPointer(i, size, type, normalized, stride, offset) { this.attribPointer(i, size, type, !!normalized, stride, offset, false); }
  vertexAttribIPointer(i, size, type, stride, offset) { if (![0x1400, 0x1401, 0x1402, 0x1403, 0x1404, 0x1405].includes(type)) return this.err(C.INVALID_ENUM); this.attribPointer(i, size, type, false, stride, offset, true); }
  attribPointer(i, size, type, normalized, stride, offset, integer) {
    if (i >= MAX_VERTEX_ATTRIBS || size < 1 || size > 4 || stride < 0 || stride > 255 || offset < 0) return this.err(C.INVALID_VALUE);
    const bytes = ATTRIB_TYPES[type]; if (!bytes) return this.err(C.INVALID_ENUM);
    if ((type === 0x8D9F || type === 0x8368) && size !== 4) return this.err(C.INVALID_OPERATION);
    const buffer = this.state.buffers.array; if (!buffer && offset !== 0 && this.state.vao !== this.state.defaultVao) return this.err(C.INVALID_OPERATION);
    if (offset % bytes || stride % bytes) { if (type !== 0x8D9F && type !== 0x8368) { /* WebGL requires alignment */ return this.err(C.INVALID_OPERATION); } }
    const a = this.state.vao.attribs[i];
    Object.assign(a, { buffer, size, type, normalized, integer, stride, offset, componentBytes: bytes, elementBytes: type === 0x8D9F || type === 0x8368 ? 4 : bytes * size });
  }
  vertexAttribDivisor(i, divisor) { if (i >= MAX_VERTEX_ATTRIBS) return this.err(C.INVALID_VALUE); this.state.vao.attribs[i].divisor = divisor >>> 0; }
  setGeneric(i, values, kind) { if (i >= MAX_VERTEX_ATTRIBS) return this.err(C.INVALID_VALUE); const g = this.generic[i]; for (let k = 0; k < 4; k++) g[k] = values[k] ?? (k === 3 ? 1 : 0); g.kind = kind; }
  vertexAttrib1f(i, x) { this.setGeneric(i, [Math.fround(x), 0, 0, 1], 'float'); } vertexAttrib2f(i, x, y) { this.setGeneric(i, [x, y, 0, 1].map(Math.fround), 'float'); }
  vertexAttrib3f(i, x, y, z) { this.setGeneric(i, [x, y, z, 1].map(Math.fround), 'float'); } vertexAttrib4f(i, x, y, z, w) { this.setGeneric(i, [x, y, z, w].map(Math.fround), 'float'); }
  vertexAttrib1fv(i, v) { this.setGeneric(i, [v[0], 0, 0, 1], 'float'); } vertexAttrib2fv(i, v) { this.setGeneric(i, [v[0], v[1], 0, 1], 'float'); }
  vertexAttrib3fv(i, v) { this.setGeneric(i, [v[0], v[1], v[2], 1], 'float'); } vertexAttrib4fv(i, v) { this.setGeneric(i, [v[0], v[1], v[2], v[3]], 'float'); }
  vertexAttribI4i(i, x, y, z, w) { this.setGeneric(i, [x | 0, y | 0, z | 0, w | 0], 'int'); } vertexAttribI4ui(i, x, y, z, w) { this.setGeneric(i, [x >>> 0, y >>> 0, z >>> 0, w >>> 0], 'uint'); }
  vertexAttribI4iv(i, v) { this.vertexAttribI4i(i, v[0], v[1], v[2], v[3]); } vertexAttribI4uiv(i, v) { this.vertexAttribI4ui(i, v[0], v[1], v[2], v[3]); }
  getVertexAttrib(i, pname) {
    if (i >= MAX_VERTEX_ATTRIBS) { this.err(C.INVALID_VALUE); return null; }
    const a = this.state.vao.attribs[i];
    switch (pname) {
      case 0x889F: return a.buffer; case 0x8622: return a.enabled; case 0x8623: return a.size; case 0x8624: return a.stride; case 0x8625: return a.type; case 0x886A: return a.normalized; case 0x88FD: return a.integer; case 0x88FE: return a.divisor;
      case 0x8626: { const g = this.generic[i]; return g.kind === 'int' ? new Int32Array(g) : g.kind === 'uint' ? new Uint32Array(g) : new Float32Array(g); }
    }
    this.err(C.INVALID_ENUM); return null;
  }
  getVertexAttribOffset(i, pname) { if (pname !== 0x8645) { this.err(C.INVALID_ENUM); return 0; } return this.state.vao.attribs[i]?.offset ?? 0; }

  // ---- textures ----
  createTexture() { return Object.assign(new Texture(0), { kind: 'texture', target: 0 }); }
  deleteTexture(t) {
    if (!t || t.deleted) return; t.deleted = true;
    for (const unit of this.state.textures) for (const key of Object.keys(unit)) if (unit[key] === t) unit[key] = null;
    for (const fb of [this.state.drawFb, this.state.readFb]) if (fb) for (const [att, a] of fb.attachments) if (a.object === t) fb.attachments.delete(att);
  }
  isTexture(t) { return !!t && t.kind === 'texture' && !t.deleted && !!t.target; }
  bindTexture(target, t) {
    const key = TEXTURE_TARGETS.get(target); if (!key) return this.err(C.INVALID_ENUM);
    if (t) { if (t.deleted) return this.err(C.INVALID_OPERATION); if (t.target && t.target !== target) return this.err(C.INVALID_OPERATION); if (!t.target) { t.target = target; t.faces = target === C.TEXTURE_CUBE_MAP ? 6 : 1; } }
    this.state.textures[this.state.activeTexture][key] = t;
  }
  /** The bound texture of a texImage target (cube faces resolve to the cube map) and the face index. */
  texTarget(target, allowCubeFaces = true) {
    let face = 0, key = TEXTURE_TARGETS.get(target);
    if (allowCubeFaces && target >= 0x8515 && target <= 0x851A) { key = 'cube'; face = target - 0x8515; }
    else if (target === C.TEXTURE_CUBE_MAP && allowCubeFaces) { this.err(C.INVALID_ENUM); return null; }
    if (!key) { this.err(C.INVALID_ENUM); return null; }
    const t = this.state.textures[this.state.activeTexture][key]; if (!t) { this.err(C.INVALID_OPERATION); return null; }
    return { t, face, key };
  }
  pixelSource(pixels, width, height, depth, format, type) {
    if (pixels === null || pixels === undefined) return null;
    if (typeof pixels === 'number') {
      const pbo = this.state.buffers.pixelUnpack; if (!pbo) { this.err(C.INVALID_OPERATION); return undefined; }
      const layout = clientLayout(width, height, depth, format, type, this.state.unpack); if (pixels + layout.size > pbo.data.length) { this.err(C.INVALID_OPERATION); return undefined; }
      return pbo.data.subarray(pixels);
    }
    if (this.state.buffers.pixelUnpack) { this.err(C.INVALID_OPERATION); return undefined; }
    return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  }
  texImage2D(target, level, internal, width, height, border, format, type, pixels) {
    const at = this.texTarget(target); if (!at) return;
    if (at.t.immutable) return this.err(C.INVALID_OPERATION);
    if (level < 0 || width < 0 || height < 0 || border !== 0 || width > 4096 || height > 4096 || (at.key === 'cube' && width !== height)) return this.err(C.INVALID_VALUE);
    if (!isKnownFormat(format) || !isKnownType(type)) return this.err(C.INVALID_ENUM);
    if (!FORMATS[internal]) return this.err(C.INVALID_VALUE);
    if (!uploadAllowed(internal, format, type)) return this.err(C.INVALID_OPERATION);
    const fmt = formatOf(internal, type), img = new Image(fmt, width, height, 1);
    const bytes = this.pixelSource(pixels, width, height, 1, format, type); if (bytes === undefined) return;
    if (bytes && !unpackInto(img, 0, 0, 0, width, height, 1, format, type, bytes, this.state.unpack)) return this.err(C.INVALID_OPERATION);
    at.t.setImage(level, at.face, img);
  }
  texSubImage2D(target, level, x, y, width, height, format, type, pixels) {
    const at = this.texTarget(target); if (!at) return; const img = at.t.image(level, at.face);
    if (!img || img.fmt.compressed) return this.err(C.INVALID_OPERATION);
    if (x < 0 || y < 0 || width < 0 || height < 0 || x + width > img.width || y + height > img.height) return this.err(C.INVALID_VALUE);
    if (!isKnownFormat(format) || !isKnownType(type)) return this.err(C.INVALID_ENUM);
    if (!uploadAllowed(img.fmt.sized ? img.fmt.id : img.fmt.base, format, type) && !uploadAllowed(img.fmt.id, format, type)) return this.err(C.INVALID_OPERATION);
    const bytes = this.pixelSource(pixels, width, height, 1, format, type); if (bytes === undefined) return; if (bytes === null) return this.err(C.INVALID_VALUE);
    if (!unpackInto(img, x, y, 0, width, height, 1, format, type, bytes, this.state.unpack)) return this.err(C.INVALID_OPERATION);
    at.t.touch();
  }
  texImage3D(target, level, internal, width, height, depth, border, format, type, pixels) {
    const at = this.texTarget(target, false); if (!at) return; if (at.key !== '3d' && at.key !== '2darray') return this.err(C.INVALID_ENUM); if (at.t.immutable) return this.err(C.INVALID_OPERATION);
    if (level < 0 || width < 0 || height < 0 || depth < 0 || border !== 0) return this.err(C.INVALID_VALUE);
    if (!FORMATS[internal]) return this.err(C.INVALID_VALUE); if (!uploadAllowed(internal, format, type)) return this.err(C.INVALID_OPERATION);
    if (at.key === '3d' && (FORMATS[internal].kind === 'depth' || FORMATS[internal].kind === 'depthstencil')) return this.err(C.INVALID_OPERATION);
    const img = new Image(formatOf(internal, type), width, height, depth);
    const bytes = this.pixelSource(pixels, width, height, depth, format, type); if (bytes === undefined) return;
    if (bytes && !unpackInto(img, 0, 0, 0, width, height, depth, format, type, bytes, this.state.unpack)) return this.err(C.INVALID_OPERATION);
    at.t.setImage(level, 0, img);
  }
  texSubImage3D(target, level, x, y, z, width, height, depth, format, type, pixels) {
    const at = this.texTarget(target, false); if (!at) return; const img = at.t.image(level, 0); if (!img) return this.err(C.INVALID_OPERATION);
    if (x < 0 || y < 0 || z < 0 || x + width > img.width || y + height > img.height || z + depth > img.depth) return this.err(C.INVALID_VALUE);
    const bytes = this.pixelSource(pixels, width, height, depth, format, type); if (bytes === undefined) return; if (!bytes) return this.err(C.INVALID_VALUE);
    if (!unpackInto(img, x, y, z, width, height, depth, format, type, bytes, this.state.unpack)) return this.err(C.INVALID_OPERATION);
    at.t.touch();
  }
  texStorage2D(target, levels, internal, width, height) {
    const key = TEXTURE_TARGETS.get(target); if (key !== '2d' && key !== 'cube') return this.err(C.INVALID_ENUM);
    const t = this.state.textures[this.state.activeTexture][key]; if (!t) return this.err(C.INVALID_OPERATION); if (t.immutable) return this.err(C.INVALID_OPERATION);
    const fmt = FORMATS[internal]; if (!fmt || !fmt.sized) return this.err(C.INVALID_ENUM);
    if (levels < 1 || width < 1 || height < 1 || levels > Math.floor(Math.log2(Math.max(width, height))) + 1 || (key === 'cube' && width !== height)) return this.err(C.INVALID_VALUE);
    t.levels = []; for (let l = 0; l < levels; l++) for (let f = 0; f < t.faces; f++) t.setImage(l, f, new Image(fmt, Math.max(1, width >> l), Math.max(1, height >> l), 1));
    t.immutable = true; t.immutableLevels = levels; t.touch();
  }
  texStorage3D(target, levels, internal, width, height, depth) {
    const key = TEXTURE_TARGETS.get(target); if (key !== '3d' && key !== '2darray') return this.err(C.INVALID_ENUM);
    const t = this.state.textures[this.state.activeTexture][key]; if (!t) return this.err(C.INVALID_OPERATION); if (t.immutable) return this.err(C.INVALID_OPERATION);
    const fmt = FORMATS[internal]; if (!fmt || !fmt.sized) return this.err(C.INVALID_ENUM);
    if (levels < 1 || width < 1 || height < 1 || depth < 1) return this.err(C.INVALID_VALUE);
    t.levels = []; for (let l = 0; l < levels; l++) t.setImage(l, 0, new Image(fmt, Math.max(1, width >> l), Math.max(1, height >> l), key === '3d' ? Math.max(1, depth >> l) : depth));
    t.immutable = true; t.immutableLevels = levels; t.touch();
  }
  /** The bytes of a compressed upload: an ArrayBufferView, or (imageSize, offset) into the bound pixel unpack buffer. */
  compressedSource(data, offset) {
    if (typeof data === 'number') { const pbo = this.state.buffers.pixelUnpack; if (!pbo) { this.err(C.INVALID_OPERATION); return null; } if (offset + data > pbo.data.length) { this.err(C.INVALID_OPERATION); return null; } return pbo.data.subarray(offset, offset + data); }
    if (this.state.buffers.pixelUnpack) { this.err(C.INVALID_OPERATION); return null; }
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  compressedTexImage2D(target, level, internal, width, height, border, data, offset = 0) {
    const at = this.texTarget(target); if (!at) return; if (!ETC_FORMATS[internal]) return this.err(C.INVALID_ENUM); if (at.t.immutable) return this.err(C.INVALID_OPERATION);
    if (level < 0 || width < 0 || height < 0 || border !== 0 || width > 4096 || height > 4096 || (at.key === 'cube' && width !== height)) return this.err(C.INVALID_VALUE);
    const bytes = this.compressedSource(data, offset); if (!bytes) return; if (bytes.length !== compressedSize(internal, width, height)) return this.err(C.INVALID_VALUE);
    const img = new Image(FORMATS[internal], width, height, 1); decodeInto(img, internal, 0, 0, 0, width, height, 1, bytes); at.t.setImage(level, at.face, img);
  }
  compressedTexSubImage2D(target, level, x, y, width, height, format, data, offset = 0) {
    const at = this.texTarget(target); if (!at) return; const img = at.t.image(level, at.face); if (!img) return this.err(C.INVALID_OPERATION);
    if (!ETC_FORMATS[format]) return this.err(C.INVALID_ENUM); if (img.fmt.id !== format) return this.err(C.INVALID_OPERATION);
    if (x < 0 || y < 0 || width < 0 || height < 0 || x + width > img.width || y + height > img.height) return this.err(C.INVALID_VALUE);
    if (x % 4 || y % 4 || (width % 4 && x + width !== img.width) || (height % 4 && y + height !== img.height)) return this.err(C.INVALID_OPERATION);   // whole blocks (ES 3.0 3.8.7)
    const bytes = this.compressedSource(data, offset); if (!bytes) return; if (bytes.length !== compressedSize(format, width, height)) return this.err(C.INVALID_VALUE);
    decodeInto(img, format, x, y, 0, width, height, 1, bytes); at.t.touch();
  }
  compressedTexImage3D(target, level, internal, width, height, depth, border, data, offset = 0) {
    const at = this.texTarget(target, false); if (!at) return; if (!ETC_FORMATS[internal]) return this.err(C.INVALID_ENUM); if (at.key !== '2darray') return this.err(C.INVALID_OPERATION); if (at.t.immutable) return this.err(C.INVALID_OPERATION);
    if (level < 0 || width < 0 || height < 0 || depth < 0 || border !== 0) return this.err(C.INVALID_VALUE);
    const bytes = this.compressedSource(data, offset); if (!bytes) return; if (bytes.length !== compressedSize(internal, width, height, depth)) return this.err(C.INVALID_VALUE);
    const img = new Image(FORMATS[internal], width, height, depth); decodeInto(img, internal, 0, 0, 0, width, height, depth, bytes); at.t.setImage(level, 0, img);
  }
  compressedTexSubImage3D(target, level, x, y, z, width, height, depth, format, data, offset = 0) {
    const at = this.texTarget(target, false); if (!at) return; const img = at.t.image(level, 0); if (!img) return this.err(C.INVALID_OPERATION);
    if (!ETC_FORMATS[format]) return this.err(C.INVALID_ENUM); if (img.fmt.id !== format) return this.err(C.INVALID_OPERATION);
    if (x < 0 || y < 0 || z < 0 || x + width > img.width || y + height > img.height || z + depth > img.depth) return this.err(C.INVALID_VALUE);
    if (x % 4 || y % 4 || (width % 4 && x + width !== img.width) || (height % 4 && y + height !== img.height)) return this.err(C.INVALID_OPERATION);
    const bytes = this.compressedSource(data, offset); if (!bytes) return; if (bytes.length !== compressedSize(format, width, height, depth)) return this.err(C.INVALID_VALUE);
    decodeInto(img, format, x, y, z, width, height, depth, bytes); at.t.touch();
  }
  copyTexImage2D(target, level, internal, x, y, width, height, border) {
    const at = this.texTarget(target); if (!at) return; if (at.t.immutable) return this.err(C.INVALID_OPERATION);
    if (border !== 0 || width < 0 || height < 0 || level < 0) return this.err(C.INVALID_VALUE);
    const src = this.readImage(); if (!src) return this.err(C.INVALID_FRAMEBUFFER_OPERATION);
    const fmt = FORMATS[internal]?.sized ? FORMATS[internal] : formatOf(internal, src.img.fmt.kind === 'float' ? GLC.FLOAT : GLC.UNSIGNED_BYTE); if (!fmt) return this.err(C.INVALID_ENUM);
    const img = new Image(fmt, width, height, 1); this.copyPixels(src, x, y, img, 0, 0, 0, width, height); at.t.setImage(level, at.face, img);
  }
  copyTexSubImage2D(target, level, xo, yo, x, y, width, height) {
    const at = this.texTarget(target); if (!at) return; const img = at.t.image(level, at.face); if (!img) return this.err(C.INVALID_OPERATION);
    if (xo < 0 || yo < 0 || xo + width > img.width || yo + height > img.height) return this.err(C.INVALID_VALUE);
    const src = this.readImage(); if (!src) return this.err(C.INVALID_FRAMEBUFFER_OPERATION); this.copyPixels(src, x, y, img, xo, yo, 0, width, height); at.t.touch();
  }
  copyTexSubImage3D(target, level, xo, yo, zo, x, y, width, height) {
    const at = this.texTarget(target, false); if (!at) return; const img = at.t.image(level, 0); if (!img) return this.err(C.INVALID_OPERATION);
    if (xo < 0 || yo < 0 || zo < 0 || zo >= img.depth || xo + width > img.width || yo + height > img.height) return this.err(C.INVALID_VALUE);
    const src = this.readImage(); if (!src) return this.err(C.INVALID_FRAMEBUFFER_OPERATION); this.copyPixels(src, x, y, img, xo, yo, zo, width, height); at.t.touch();
  }
  /** Copies a rectangle of the read buffer into an image (texels outside the read buffer are left undefined: here unchanged). */
  copyPixels(src, x, y, dst, xo, yo, zo, width, height) {
    const t = new Float64Array(4), write = makeColorWriter(dst.fmt), sImg = src.img, base = src.layer * sImg.width * sImg.height;
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const sx = x + i, sy = y + j; if (sx < 0 || sy < 0 || sx >= sImg.width || sy >= sImg.height) continue;
      readTexel(sImg, base + sy * sImg.width + sx, t); write(dst.data, ((zo * dst.height + yo + j) * dst.width + xo + i) * 4, t[0], t[1], t[2], t[3]);
    }
    dst.version++;
  }
  generateMipmap(target) {
    const key = TEXTURE_TARGETS.get(target); if (!key) return this.err(C.INVALID_ENUM);
    const t = this.state.textures[this.state.activeTexture][key]; if (!t) return this.err(C.INVALID_OPERATION);
    const base = t.params[TX.BASE_LEVEL], img0 = t.image(base); if (!img0) return this.err(C.INVALID_OPERATION);
    const fmt = img0.fmt; if (fmt.compressed || fmt.kind === 'int' || fmt.kind === 'uint' || fmt.kind === 'depth' || fmt.kind === 'depthstencil' || (!fmt.renderable && fmt.store !== 'u8' && !fmt.filterable)) return this.err(C.INVALID_OPERATION);
    if (key === 'cube') for (let f = 1; f < 6; f++) { const i = t.image(base, f); if (!i || i.width !== img0.width || i.fmt.id !== fmt.id) return this.err(C.INVALID_OPERATION); }
    const maxLevel = t.immutable ? t.immutableLevels - 1 : Math.min(t.params[TX.MAX_LEVEL], base + Math.floor(Math.log2(Math.max(img0.width, img0.height, key === '3d' ? img0.depth : 1))));
    const write = makeColorWriter(fmt), a = new Float64Array(4), s = new Float64Array(4);
    for (let f = 0; f < t.faces; f++) {
      let prev = t.image(base, f);
      for (let level = base + 1; level <= maxLevel; level++) {
        const w = Math.max(1, prev.width >> 1), h = Math.max(1, prev.height >> 1), d = key === '3d' ? Math.max(1, prev.depth >> 1) : prev.depth;
        const img = t.immutable ? t.image(level, f) : new Image(fmt, w, h, d);
        for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          s[0] = s[1] = s[2] = s[3] = 0; let n = 0;
          const zs = key === '3d' ? [2 * z, Math.min(prev.depth - 1, 2 * z + 1)] : [z];
          for (const zz of zs) for (const yy of [2 * y, Math.min(prev.height - 1, 2 * y + 1)]) for (const xx of [2 * x, Math.min(prev.width - 1, 2 * x + 1)]) { readTexel(prev, (zz * prev.height + yy) * prev.width + xx, a); for (let k = 0; k < 4; k++) s[k] += fmt.srgb && k < 3 ? a[k] : a[k]; n++; }
          write(img.data, ((z * h + y) * w + x) * 4, s[0] / n, s[1] / n, s[2] / n, s[3] / n);
        }
        if (!t.immutable) t.setImage(level, f, img); prev = img;
      }
    }
    t.touch();
  }
  texParameteri(target, pname, value) { this.texParameter(target, pname, value); }
  texParameterf(target, pname, value) { this.texParameter(target, pname, value); }
  texParameter(target, pname, value) {
    const key = TEXTURE_TARGETS.get(target); if (!key) return this.err(C.INVALID_ENUM);
    const t = this.state.textures[this.state.activeTexture][key]; if (!t) return this.err(C.INVALID_OPERATION);
    if (!this.validParam(pname, value, true)) return;
    t.params[pname] = pname === TX.MIN_LOD || pname === TX.MAX_LOD || pname === TX.MAX_ANISOTROPY ? Math.fround(value) : Math.trunc(value); t.touch();
  }
  validParam(pname, value, texture) {
    const ok = {
      [TX.MAG_FILTER]: v => v === TX.NEAREST || v === TX.LINEAR, [TX.MIN_FILTER]: v => [TX.NEAREST, TX.LINEAR, TX.NEAREST_MIPMAP_NEAREST, TX.LINEAR_MIPMAP_NEAREST, TX.NEAREST_MIPMAP_LINEAR, TX.LINEAR_MIPMAP_LINEAR].includes(v),
      [TX.WRAP_S]: v => [TX.REPEAT, TX.CLAMP_TO_EDGE, TX.MIRRORED_REPEAT].includes(v), [TX.WRAP_T]: v => [TX.REPEAT, TX.CLAMP_TO_EDGE, TX.MIRRORED_REPEAT].includes(v), [TX.WRAP_R]: v => [TX.REPEAT, TX.CLAMP_TO_EDGE, TX.MIRRORED_REPEAT].includes(v),
      [TX.MIN_LOD]: () => true, [TX.MAX_LOD]: () => true, [TX.COMPARE_MODE]: v => v === TX.NONE || v === TX.COMPARE_REF_TO_TEXTURE, [TX.COMPARE_FUNC]: v => COMPARE_FUNCS.has(v),
      ...(texture ? { [TX.BASE_LEVEL]: v => v >= 0, [TX.MAX_LEVEL]: v => v >= 0, [TX.SWIZZLE_R]: v => [TX.RED, TX.GREEN, TX.BLUE, TX.ALPHA, TX.ZERO, TX.ONE].includes(v), [TX.SWIZZLE_G]: v => [TX.RED, TX.GREEN, TX.BLUE, TX.ALPHA, TX.ZERO, TX.ONE].includes(v), [TX.SWIZZLE_B]: v => [TX.RED, TX.GREEN, TX.BLUE, TX.ALPHA, TX.ZERO, TX.ONE].includes(v), [TX.SWIZZLE_A]: v => [TX.RED, TX.GREEN, TX.BLUE, TX.ALPHA, TX.ZERO, TX.ONE].includes(v) } : {}),
    }[pname];
    if (!ok) { this.err(C.INVALID_ENUM); return false; }
    if (!ok(value)) { this.err(pname === TX.BASE_LEVEL || pname === TX.MAX_LEVEL ? C.INVALID_VALUE : C.INVALID_ENUM); return false; }
    return true;
  }
  getTexParameter(target, pname) {
    const key = TEXTURE_TARGETS.get(target); if (!key) { this.err(C.INVALID_ENUM); return null; }
    const t = this.state.textures[this.state.activeTexture][key]; if (!t) { this.err(C.INVALID_OPERATION); return null; }
    if (pname === TX.IMMUTABLE_FORMAT) return t.immutable; if (pname === TX.IMMUTABLE_LEVELS) return t.immutableLevels;
    if (!(pname in t.params)) { this.err(C.INVALID_ENUM); return null; } return t.params[pname];
  }
  // ---- samplers ----
  createSampler() { return new Sampler(); }
  deleteSampler(s) { if (!s || s.deleted) return; s.deleted = true; this.state.samplers = this.state.samplers.map(x => (x === s ? null : x)); }
  isSampler(s) { return !!s && s.kind === 'sampler' && !s.deleted; }
  bindSampler(unit, s) { if (unit < 0 || unit >= MAX_COMBINED_UNITS) return this.err(C.INVALID_VALUE); if (s && s.deleted) return this.err(C.INVALID_OPERATION); this.state.samplers[unit] = s; }
  samplerParameteri(s, pname, value) { if (!s) return this.err(C.INVALID_OPERATION); if (!SAMPLER_PARAMS.includes(pname)) return this.err(C.INVALID_ENUM); if (!this.validParam(pname, value, false)) return; s.params[pname] = value; s.version++; }
  samplerParameterf(s, pname, value) { this.samplerParameteri(s, pname, pname === TX.MIN_LOD || pname === TX.MAX_LOD ? Math.fround(value) : Math.trunc(value)); }
  getSamplerParameter(s, pname) { if (!s) { this.err(C.INVALID_OPERATION); return null; } if (!SAMPLER_PARAMS.includes(pname)) { this.err(C.INVALID_ENUM); return null; } return s.params[pname]; }

  // ---- renderbuffers ----
  createRenderbuffer() { const rb = new GLObject('renderbuffer'); rb.img = null; rb.internalformat = 0x8056; rb.samples = 0; return rb; }
  deleteRenderbuffer(rb) {
    if (!rb || rb.deleted) return; rb.deleted = true; if (this.state.renderbuffer === rb) this.state.renderbuffer = null;
    for (const fb of [this.state.drawFb, this.state.readFb]) if (fb) for (const [att, a] of fb.attachments) if (a.object === rb) fb.attachments.delete(att);
  }
  isRenderbuffer(rb) { return !!rb && rb.kind === 'renderbuffer' && !rb.deleted && rb.used; }
  bindRenderbuffer(target, rb) { if (target !== C.RENDERBUFFER) return this.err(C.INVALID_ENUM); if (rb && rb.deleted) return this.err(C.INVALID_OPERATION); if (rb) rb.used = true; this.state.renderbuffer = rb; }
  renderbufferStorage(target, internal, width, height) { this.renderbufferStorageMultisample(target, 0, internal, width, height); }
  renderbufferStorageMultisample(target, samples, internal, width, height) {
    if (target !== C.RENDERBUFFER) return this.err(C.INVALID_ENUM); const rb = this.state.renderbuffer; if (!rb) return this.err(C.INVALID_OPERATION);
    const fmt = FORMATS[internal]; if (!fmt || !fmt.renderable || (!fmt.sized && internal !== GLC.DEPTH_STENCIL)) return this.err(C.INVALID_ENUM);
    if (fmt.floatTarget && !CPU_EXTENSIONS.includes('EXT_color_buffer_float')) return this.err(C.INVALID_ENUM);
    if (width < 0 || height < 0 || width > 4096 || height > 4096 || samples < 0) return this.err(C.INVALID_VALUE);
    if (samples > 4 || (samples > 0 && (fmt.kind === 'int' || fmt.kind === 'uint'))) return this.err(C.INVALID_OPERATION);
    if (samples > 0) this.note(`GL multisampled renderbuffer (${samples} samples) rendered at one sample per pixel on the CPU path`);
    rb.img = new Image(fmt, width, height, 1, samples); rb.internalformat = internal; rb.samples = samples ? 4 : 0;
  }
  getRenderbufferParameter(target, pname) {
    if (target !== C.RENDERBUFFER) { this.err(C.INVALID_ENUM); return null; } const rb = this.state.renderbuffer; if (!rb) { this.err(C.INVALID_OPERATION); return null; }
    const img = rb.img, fmt = img?.fmt;
    switch (pname) {
      case 0x8D42: return img?.width ?? 0; case 0x8D43: return img?.height ?? 0; case 0x8D44: return rb.internalformat; case 0x8CAB: return rb.samples;
      case 0x8D50: return fmt ? fmt.bits[0] : 0; case 0x8D51: return fmt ? fmt.bits[1] : 0; case 0x8D52: return fmt ? fmt.bits[2] : 0; case 0x8D53: return fmt ? fmt.bits[3] : 0;
      case 0x8D54: return fmt?.depthBits ?? 0; case 0x8D55: return fmt?.stencilBits ?? 0;
    }
    this.err(C.INVALID_ENUM); return null;
  }

  // ---- framebuffers ----
  createFramebuffer() { const fb = new GLObject('framebuffer'); fb.attachments = new Map(); fb.drawBuffers = [C.COLOR_ATTACHMENT0, C.NONE, C.NONE, C.NONE]; fb.readBuffer = C.COLOR_ATTACHMENT0; return fb; }
  deleteFramebuffer(fb) { if (!fb || fb.deleted) return; fb.deleted = true; if (this.state.drawFb === fb) this.state.drawFb = null; if (this.state.readFb === fb) this.state.readFb = null; }
  isFramebuffer(fb) { return !!fb && fb.kind === 'framebuffer' && !fb.deleted && fb.used; }
  bindFramebuffer(target, fb) {
    if (fb && fb.deleted) return this.err(C.INVALID_OPERATION); if (fb) fb.used = true;
    if (target === C.FRAMEBUFFER) { this.state.drawFb = fb; this.state.readFb = fb; } else if (target === C.DRAW_FRAMEBUFFER) this.state.drawFb = fb; else if (target === C.READ_FRAMEBUFFER) this.state.readFb = fb; else this.err(C.INVALID_ENUM);
  }
  fbFor(target) { if (target === C.FRAMEBUFFER || target === C.DRAW_FRAMEBUFFER) return this.state.drawFb; if (target === C.READ_FRAMEBUFFER) return this.state.readFb; this.err(C.INVALID_ENUM); return undefined; }
  validAttachment(att) { return (att >= C.COLOR_ATTACHMENT0 && att < C.COLOR_ATTACHMENT0 + MAX_DRAW_BUFFERS) || att === C.DEPTH_ATTACHMENT || att === C.STENCIL_ATTACHMENT || att === C.DEPTH_STENCIL_ATTACHMENT; }
  attach(fb, att, value) { if (att === C.DEPTH_STENCIL_ATTACHMENT) { this.attach(fb, C.DEPTH_ATTACHMENT, value); this.attach(fb, C.STENCIL_ATTACHMENT, value); return; } if (value) fb.attachments.set(att, value); else fb.attachments.delete(att); }
  framebufferRenderbuffer(target, att, rbTarget, rb) {
    const fb = this.fbFor(target); if (fb === undefined) return; if (!fb) return this.err(C.INVALID_OPERATION); if (!this.validAttachment(att) || rbTarget !== C.RENDERBUFFER) return this.err(C.INVALID_ENUM);
    if (rb && rb.deleted) return this.err(C.INVALID_OPERATION);
    this.attach(fb, att, rb ? { type: 'renderbuffer', object: rb } : null);
  }
  framebufferTexture2D(target, att, textarget, tex, level) {
    const fb = this.fbFor(target); if (fb === undefined) return; if (!fb) return this.err(C.INVALID_OPERATION); if (!this.validAttachment(att)) return this.err(C.INVALID_ENUM);
    if (!tex) return this.attach(fb, att, null);
    const cube = textarget >= 0x8515 && textarget <= 0x851A; if (!cube && textarget !== C.TEXTURE_2D) return this.err(C.INVALID_ENUM);
    if (tex.deleted || (tex.target && tex.target !== (cube ? C.TEXTURE_CUBE_MAP : C.TEXTURE_2D))) return this.err(C.INVALID_OPERATION); if (level < 0) return this.err(C.INVALID_VALUE);
    this.attach(fb, att, { type: 'texture', object: tex, level, face: cube ? textarget - 0x8515 : 0, layer: 0, textarget });
  }
  framebufferTextureLayer(target, att, tex, level, layer) {
    const fb = this.fbFor(target); if (fb === undefined) return; if (!fb) return this.err(C.INVALID_OPERATION); if (!this.validAttachment(att)) return this.err(C.INVALID_ENUM);
    if (!tex) return this.attach(fb, att, null);
    if (tex.target !== C.TEXTURE_3D && tex.target !== C.TEXTURE_2D_ARRAY) return this.err(C.INVALID_OPERATION); if (level < 0 || layer < 0) return this.err(C.INVALID_VALUE);
    this.attach(fb, att, { type: 'texture', object: tex, level, face: 0, layer });
  }
  attachmentImage(a) {
    if (!a) return null;
    if (a.type === 'renderbuffer') return a.object.img && !a.object.deleted ? { img: a.object.img, layer: 0 } : null;
    const img = a.object.image(a.level, a.face); if (!img || a.object.deleted) return null; if (a.layer >= img.depth) return null; return { img, layer: a.layer };
  }
  framebufferStatus(fb) {
    if (!fb) return C.FRAMEBUFFER_COMPLETE;
    if (!fb.attachments.size) return C.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT;
    let samples = null;
    for (const [att, a] of fb.attachments) {
      const at = this.attachmentImage(a); if (!at || at.img.width === 0 || at.img.height === 0) return C.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
      const fmt = at.img.fmt;
      if (att >= C.COLOR_ATTACHMENT0 && att < C.COLOR_ATTACHMENT0 + MAX_DRAW_BUFFERS) { if (!fmt.renderable || fmt.kind === 'depth' || fmt.kind === 'depthstencil' || fmt.kind === 'stencil') return C.FRAMEBUFFER_INCOMPLETE_ATTACHMENT; }
      else if (att === C.DEPTH_ATTACHMENT) { if (!fmt.depthBits) return C.FRAMEBUFFER_INCOMPLETE_ATTACHMENT; }
      else if (att === C.STENCIL_ATTACHMENT) { if (!fmt.stencilBits) return C.FRAMEBUFFER_INCOMPLETE_ATTACHMENT; }
      const s = a.type === 'renderbuffer' ? a.object.samples : 0; if (samples !== null && s !== samples) return C.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE; samples = s;
    }
    const d = fb.attachments.get(C.DEPTH_ATTACHMENT), s = fb.attachments.get(C.STENCIL_ATTACHMENT);
    if (d && s && d.object !== s.object && (this.attachmentImage(d).img.fmt.kind === 'depthstencil' || this.attachmentImage(s).img.fmt.kind === 'depthstencil')) return C.FRAMEBUFFER_UNSUPPORTED;
    return C.FRAMEBUFFER_COMPLETE;
  }
  checkFramebufferStatus(target) { const fb = this.fbFor(target); if (fb === undefined) return 0; return this.framebufferStatus(fb); }
  /** The images a framebuffer draws into / reads from: { colors[draw buffer], depth, stencil, width, height } or null when incomplete. */
  framebufferImages(fb, forDraw) {
    if (!fb) { const img = this.defaultColor; const enabled = forDraw ? this.state.defaultDrawBuffer === C.BACK : this.state.defaultReadBuffer === C.BACK; return { colors: [enabled ? { img, layer: 0 } : null], depth: null, stencil: null, width: img.width, height: img.height, read: enabled ? { img, layer: 0 } : null }; }
    if (this.framebufferStatus(fb) !== C.FRAMEBUFFER_COMPLETE) return null;
    let width = Infinity, height = Infinity; for (const a of fb.attachments.values()) { const at = this.attachmentImage(a); width = Math.min(width, at.img.width); height = Math.min(height, at.img.height); }
    const colors = fb.drawBuffers.map(b => (b === C.NONE ? null : this.attachmentImage(fb.attachments.get(b))));
    const depth = this.attachmentImage(fb.attachments.get(C.DEPTH_ATTACHMENT)), stencil = this.attachmentImage(fb.attachments.get(C.STENCIL_ATTACHMENT));
    const read = fb.readBuffer === C.NONE ? null : this.attachmentImage(fb.attachments.get(fb.readBuffer));
    return { colors, depth: depth?.img.depthData ? depth : null, stencil: stencil?.img.stencil ? stencil : null, width, height, read };
  }
  drawTarget() { return this.framebufferImages(this.state.drawFb, true); }
  readImage() { const t = this.framebufferImages(this.state.readFb, false); return t?.read ?? null; }
  getFramebufferAttachmentParameter(target, att, pname) {
    const fb = this.fbFor(target); if (fb === undefined) return null;
    if (!fb) { if (pname === 0x8CD0) return 0x8218; if (att === C.BACK || att === 0x1800) { if (pname >= 0x8212 && pname <= 0x8215) return 8; if (pname === 0x8211) return 0x1401; if (pname === 0x8210) return 0x2601; } if (att === 0x1801 || att === 0x1802) { if (pname >= 0x8212 && pname <= 0x8217) return 0; } this.err(C.INVALID_ENUM); return null; }
    if (!this.validAttachment(att)) { this.err(C.INVALID_ENUM); return null; }
    const a = att === C.DEPTH_STENCIL_ATTACHMENT ? fb.attachments.get(C.DEPTH_ATTACHMENT) : fb.attachments.get(att);
    if (pname === 0x8CD0) return a ? (a.type === 'texture' ? 0x1702 : C.RENDERBUFFER) : C.NONE;   // GL_TEXTURE / GL_RENDERBUFFER / GL_NONE
    if (!a) { if (pname === 0x8CD1) return null; this.err(C.INVALID_ENUM); return null; }
    if (att === C.DEPTH_STENCIL_ATTACHMENT && fb.attachments.get(C.STENCIL_ATTACHMENT)?.object !== a.object) { this.err(C.INVALID_OPERATION); return null; }
    const img = this.attachmentImage(a)?.img, fmt = img?.fmt;
    switch (pname) {
      case 0x8CD1: return a.object; case 0x8CD2: return a.type === 'texture' ? a.level : (this.err(C.INVALID_ENUM), null);
      case 0x8CD3: return a.type === 'texture' ? (a.textarget >= 0x8515 ? a.textarget : 0) : (this.err(C.INVALID_ENUM), null); case 0x8CD4: return a.type === 'texture' ? a.layer : (this.err(C.INVALID_ENUM), null);
      case 0x8212: case 0x8213: case 0x8214: case 0x8215: return fmt ? fmt.bits[pname - 0x8212] : 0; case 0x8216: return fmt?.depthBits ?? 0; case 0x8217: return fmt?.stencilBits ?? 0;
      case 0x8211: return !fmt ? 0 : fmt.kind === 'float' ? GLC.FLOAT : fmt.kind === 'int' ? GLC.INT : fmt.kind === 'uint' ? GLC.UNSIGNED_INT : fmt.kind === 'snorm' ? 0x8F9C : fmt.kind === 'depthstencil' && att === C.STENCIL_ATTACHMENT ? GLC.UNSIGNED_INT : fmt.floatDepth ? GLC.FLOAT : 0x8C17;   // GL_UNSIGNED_NORMALIZED
      case 0x8210: return fmt?.srgb ? 0x8C40 : 0x2601;   // GL_SRGB / GL_LINEAR
    }
    this.err(C.INVALID_ENUM); return null;
  }
  drawBuffers(list) {
    const fb = this.state.drawFb;
    if (!fb) { if (list.length !== 1 || (list[0] !== C.BACK && list[0] !== C.NONE)) return this.err(C.INVALID_OPERATION); this.state.defaultDrawBuffer = list[0]; return; }
    if (list.length > MAX_DRAW_BUFFERS) return this.err(C.INVALID_VALUE);
    for (let i = 0; i < list.length; i++) if (list[i] !== C.NONE && list[i] !== C.COLOR_ATTACHMENT0 + i) return this.err(C.INVALID_OPERATION);
    fb.drawBuffers = Array.from({ length: MAX_DRAW_BUFFERS }, (_, i) => list[i] ?? C.NONE);
  }
  readBuffer(mode) {
    const fb = this.state.readFb;
    if (!fb) { if (mode !== C.BACK && mode !== C.NONE) return this.err(C.INVALID_OPERATION); this.state.defaultReadBuffer = mode; return; }
    if (mode !== C.NONE && !(mode >= C.COLOR_ATTACHMENT0 && mode < C.COLOR_ATTACHMENT0 + MAX_DRAW_BUFFERS)) return this.err(mode === C.BACK ? C.INVALID_OPERATION : C.INVALID_ENUM);
    fb.readBuffer = mode;
  }
  invalidateFramebuffer(target) { this.fbFor(target); } invalidateSubFramebuffer(target) { this.fbFor(target); }
  /** The pixel rectangle clears and blits touch: the target clipped to the scissor box. */
  clipRect(width, height) {
    let x0 = 0, y0 = 0, x1 = width, y1 = height; const s = this.state;
    if (s.scissorTest) { x0 = Math.max(x0, s.scissor[0]); y0 = Math.max(y0, s.scissor[1]); x1 = Math.min(x1, s.scissor[0] + s.scissor[2]); y1 = Math.min(y1, s.scissor[1] + s.scissor[3]); }
    return { x0, y0, x1, y1 };
  }
  clear(mask) {
    if (mask & ~(C.COLOR_BUFFER_BIT | C.DEPTH_BUFFER_BIT | C.STENCIL_BUFFER_BIT)) return this.err(C.INVALID_VALUE);
    const t = this.drawTarget(); if (!t) return this.err(C.INVALID_FRAMEBUFFER_OPERATION);
    if (this.state.rasterizerDiscard) return;
    const s = this.state;
    if (mask & C.COLOR_BUFFER_BIT) t.colors.forEach(c => { if (c && c.img.fmt.kind !== 'int' && c.img.fmt.kind !== 'uint') this.fillColor(c, t, s.clearColor); });
    if (mask & C.DEPTH_BUFFER_BIT && t.depth && s.depthMask) this.fillDepth(t.depth, t, s.clearDepth);
    if (mask & C.STENCIL_BUFFER_BIT && t.stencil) this.fillStencil(t.stencil, t, s.clearStencil);
  }
  fillColor(c, t, rgba) {
    const img = c.img, { x0, y0, x1, y1 } = this.clipRect(t.width, t.height), m = this.state.colorMask, base = c.layer * img.width * img.height;
    if (x1 <= x0 || y1 <= y0) return;
    const scratch = new img.data.constructor(4); makeColorWriter(img.fmt)(scratch, 0, rgba[0], rgba[1], rgba[2], rgba[3]);
    const d = img.data, all = m[0] && m[1] && m[2] && m[3];
    if (all && img.fmt.store === 'u8') { const words = new Uint32Array(d.buffer, d.byteOffset, d.length >> 2), packed = new Uint32Array(scratch.buffer)[0]; for (let y = y0; y < y1; y++) words.fill(packed, base + y * img.width + x0, base + y * img.width + x1); }
    else for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const at = (base + y * img.width + x) * 4; for (let k = 0; k < 4; k++) if (m[k]) d[at + k] = scratch[k]; }
    img.version++;
  }
  fillDepth(dpt, t, value) { const img = dpt.img, { x0, y0, x1, y1 } = this.clipRect(t.width, t.height), base = dpt.layer * img.width * img.height, v = quantizeDepth(img.fmt, value); for (let y = y0; y < y1; y++) img.depthData.fill(v, base + y * img.width + x0, base + y * img.width + x1); }
  fillStencil(sp, t, value) { const img = sp.img, { x0, y0, x1, y1 } = this.clipRect(t.width, t.height), base = sp.layer * img.width * img.height, mask = this.state.stencilWriteMask[0] & 255; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const at = base + y * img.width + x; img.stencil[at] = (img.stencil[at] & ~mask) | (value & mask); } }
  clearBufferfv(buffer, drawbuffer, values) { this.clearBuffer(buffer, drawbuffer, values, 'float'); }
  clearBufferiv(buffer, drawbuffer, values) { this.clearBuffer(buffer, drawbuffer, values, 'int'); }
  clearBufferuiv(buffer, drawbuffer, values) { this.clearBuffer(buffer, drawbuffer, values, 'uint'); }
  clearBufferfi(buffer, drawbuffer, depth, stencil) {
    if (buffer !== 0x84F9) return this.err(C.INVALID_ENUM); if (drawbuffer !== 0) return this.err(C.INVALID_VALUE);
    const t = this.drawTarget(); if (!t) return this.err(C.INVALID_FRAMEBUFFER_OPERATION);
    if (t.depth && this.state.depthMask) this.fillDepth(t.depth, t, depth); if (t.stencil) this.fillStencil(t.stencil, t, stencil);
  }
  clearBuffer(buffer, drawbuffer, values, kind) {
    const t = this.drawTarget(); if (!t) return this.err(C.INVALID_FRAMEBUFFER_OPERATION);
    if (buffer === 0x1800) {   // GL_COLOR
      if (drawbuffer < 0 || drawbuffer >= MAX_DRAW_BUFFERS) return this.err(C.INVALID_VALUE);
      const c = t.colors[drawbuffer]; if (!c) return;
      const fk = c.img.fmt.kind, ok = kind === 'float' ? fk !== 'int' && fk !== 'uint' : fk === kind; if (!ok) return this.err(C.INVALID_OPERATION);
      return this.fillColor(c, t, [values[0], values[1], values[2], values[3]]);
    }
    if (buffer === 0x1801) { if (kind !== 'float') return this.err(C.INVALID_ENUM); if (drawbuffer !== 0) return this.err(C.INVALID_VALUE); if (t.depth && this.state.depthMask) this.fillDepth(t.depth, t, values[0]); return; }
    if (buffer === 0x1802) { if (kind !== 'int') return this.err(C.INVALID_ENUM); if (drawbuffer !== 0) return this.err(C.INVALID_VALUE); if (t.stencil) this.fillStencil(t.stencil, t, values[0]); return; }
    this.err(C.INVALID_ENUM);
  }
  readPixels(x, y, width, height, format, type, dst) {
    if (width < 0 || height < 0) return this.err(C.INVALID_VALUE);
    if (!isKnownFormat(format) || !isKnownType(type)) return this.err(C.INVALID_ENUM);
    if (this.state.readFb && this.framebufferStatus(this.state.readFb) !== C.FRAMEBUFFER_COMPLETE) return this.err(C.INVALID_FRAMEBUFFER_OPERATION);
    const src = this.readImage(); if (!src) return this.err(C.INVALID_OPERATION);
    if (this.state.readFb) { const a = this.state.readFb.attachments.get(this.state.readFb.readBuffer); if (a?.type === 'renderbuffer' && a.object.samples) return this.err(C.INVALID_OPERATION); }
    if (!readFormatAllowed(src.img.fmt, format, type)) return this.err(C.INVALID_OPERATION);
    let bytes;
    if (typeof dst === 'number') { const pbo = this.state.buffers.pixelPack; if (!pbo) return this.err(C.INVALID_OPERATION); bytes = pbo.data.subarray(dst); }
    else { if (this.state.buffers.pixelPack) return this.err(C.INVALID_OPERATION); bytes = new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength); }
    if (!packFrom(src.img, src.layer, x, y, width, height, format, type, bytes, this.state.pack)) return this.err(C.INVALID_OPERATION);
  }
  blitFramebuffer(sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, mask, filter) {
    if (mask & ~(C.COLOR_BUFFER_BIT | C.DEPTH_BUFFER_BIT | C.STENCIL_BUFFER_BIT)) return this.err(C.INVALID_VALUE);
    if (filter !== TX.NEAREST && filter !== TX.LINEAR) return this.err(C.INVALID_ENUM);
    if (filter === TX.LINEAR && mask & (C.DEPTH_BUFFER_BIT | C.STENCIL_BUFFER_BIT)) return this.err(C.INVALID_OPERATION);
    const read = this.framebufferImages(this.state.readFb, false), drawT = this.drawTarget(); if (!read || !drawT) return this.err(C.INVALID_FRAMEBUFFER_OPERATION);
    const { x0, y0, x1, y1 } = this.clipRect(drawT.width, drawT.height);
    const sw = sx1 - sx0, sh = sy1 - sy0, dw = dx1 - dx0, dh = dy1 - dy0; if (!dw || !dh) return;
    const t = new Float64Array(4);
    const each = fn => {
      const ax = Math.max(x0, Math.min(dx0, dx1)), bx = Math.min(x1, Math.max(dx0, dx1)), ay = Math.max(y0, Math.min(dy0, dy1)), by = Math.min(y1, Math.max(dy0, dy1));
      for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) { const u = sx0 + (x + 0.5 - dx0) * sw / dw, v = sy0 + (y + 0.5 - dy0) * sh / dh; fn(x, y, u, v); }
    };
    if (mask & C.COLOR_BUFFER_BIT && read.read) {
      const src = read.read, sImg = src.img, sBase = src.layer * sImg.width * sImg.height;
      const fetch = (i, j) => { if (i < 0 || j < 0 || i >= sImg.width || j >= sImg.height) return false; readTexel(sImg, sBase + j * sImg.width + i, t); return true; };
      for (const c of drawT.colors) {
        if (!c) continue; const img = c.img, write = makeColorWriter(img.fmt), base = c.layer * img.width * img.height, same = img.fmt.store === sImg.fmt.store && img.fmt.store === 'u8' && !img.fmt.srgb && !sImg.fmt.srgb && img.fmt.bits.join() === sImg.fmt.bits.join();
        if (filter === TX.NEAREST && same && sw === dw && sh === dh && dw > 0 && dh > 0) {   // a 1:1 copy of the same byte format: rows at once
          const ax = Math.max(x0, dx0, dx0 - sx0), bx = Math.min(x1, dx1, sImg.width + dx0 - sx0);
          for (let y = Math.max(y0, dy0); y < Math.min(y1, dy1); y++) { const sy = sy0 + y - dy0; if (sy < 0 || sy >= sImg.height || bx <= ax) continue; img.data.set(sImg.data.subarray((sBase + sy * sImg.width + ax - dx0 + sx0) * 4, (sBase + sy * sImg.width + bx - dx0 + sx0) * 4), (base + y * img.width + ax) * 4); }
          img.version++; continue;
        }
        each((x, y, u, v) => {
          if (filter === TX.NEAREST) { if (!fetch(Math.floor(u), Math.floor(v))) return; write(img.data, (base + y * img.width + x) * 4, t[0], t[1], t[2], t[3]); return; }
          const fx = u - 0.5, fy = v - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fy), a = fx - i0, b = fy - j0, acc = [0, 0, 0, 0];
          for (const [i, j, w] of [[i0, j0, (1 - a) * (1 - b)], [i0 + 1, j0, a * (1 - b)], [i0, j0 + 1, (1 - a) * b], [i0 + 1, j0 + 1, a * b]]) { const ci = Math.min(sImg.width - 1, Math.max(0, i)), cj = Math.min(sImg.height - 1, Math.max(0, j)); readTexel(sImg, sBase + cj * sImg.width + ci, t); for (let k = 0; k < 4; k++) acc[k] += w * t[k]; }
          write(img.data, (base + y * img.width + x) * 4, acc[0], acc[1], acc[2], acc[3]);
        });
        img.version++;
      }
    }
    if (mask & C.DEPTH_BUFFER_BIT && read.depth && drawT.depth) { const s = read.depth.img, d = drawT.depth.img; each((x, y, u, v) => { const i = Math.floor(u), j = Math.floor(v); if (i >= 0 && j >= 0 && i < s.width && j < s.height) d.depthData[y * d.width + x] = s.depthData[j * s.width + i]; }); }
    if (mask & C.STENCIL_BUFFER_BIT && read.stencil && drawT.stencil) { const s = read.stencil.img, d = drawT.stencil.img; each((x, y, u, v) => { const i = Math.floor(u), j = Math.floor(v); if (i >= 0 && j >= 0 && i < s.width && j < s.height) d.stencil[y * d.width + x] = s.stencil[j * s.width + i]; }); }
  }

  // ---- shaders and programs ----
  createShader(type) { if (type !== C.VERTEX_SHADER && type !== C.FRAGMENT_SHADER) { this.err(C.INVALID_ENUM); return null; } return new Shader(type); }
  deleteShader(s) { if (!s || s.deleted) return; s.deleted = true; }
  isShader(s) { return !!s && s.kind === 'shader' && !(s.deleted && !s.attachedTo); }
  shaderSource(s, source) { if (!s) return this.err(C.INVALID_VALUE); s.source = String(source); }
  compileShader(s) { if (!s) return this.err(C.INVALID_VALUE); compileShader(s); }
  getShaderSource(s) { return s ? s.source : null; }
  getShaderInfoLog(s) { return s ? s.log : null; }
  getShaderParameter(s, pname) { if (pname === C.COMPILE_STATUS) return s.compiled; if (pname === C.SHADER_TYPE) return s.type; if (pname === C.DELETE_STATUS) return s.deleted; this.err(C.INVALID_ENUM); return null; }
  createProgram() { return new Program(); }
  deleteProgram(p) { if (!p || p.deleted) return; p.deleted = true; for (const s of p.shaders) s.attachedTo--; if (this.state.program !== p) p.shaders = []; }
  isProgram(p) { return !!p && p.kind === 'program' && !p.deleted; }
  attachShader(p, s) { if (!p || !s) return this.err(C.INVALID_VALUE); if (p.shaders.includes(s) || p.shaders.some(x => x.type === s.type)) return this.err(C.INVALID_OPERATION); p.shaders.push(s); s.attachedTo++; }
  detachShader(p, s) { if (!p.shaders.includes(s)) return this.err(C.INVALID_OPERATION); p.shaders = p.shaders.filter(x => x !== s); s.attachedTo--; }
  getAttachedShaders(p) { return p ? [...p.shaders] : null; }
  bindAttribLocation(p, index, name) { if (index >= MAX_VERTEX_ATTRIBS) return this.err(C.INVALID_VALUE); if (String(name).startsWith('gl_')) return this.err(C.INVALID_OPERATION); p.bindings.set(String(name), index); }
  linkProgram(p) {
    if (!p) return this.err(C.INVALID_VALUE);
    if (p.feedbackActive) return this.err(C.INVALID_OPERATION);
    linkProgram(p, this); p.runtimes = null; p.validated = p.linked;
  }
  validateProgram(p) { p.validated = !!p?.linked; }
  useProgram(p) {
    if (p && !p.linked) return this.err(C.INVALID_OPERATION);
    if (this.state.transformFeedback.active && !this.state.transformFeedback.paused) return this.err(C.INVALID_OPERATION);
    this.state.program = p;
  }
  getProgramParameter(p, pname) {
    const ls = p.state;
    switch (pname) {
      case C.LINK_STATUS: return p.linked; case C.DELETE_STATUS: return p.deleted; case C.VALIDATE_STATUS: return p.validated; case C.ATTACHED_SHADERS: return p.shaders.length;
      case C.ACTIVE_UNIFORMS: return ls ? ls.activeUniforms.length : 0; case C.ACTIVE_ATTRIBUTES: return ls ? ls.activeAttributes.length : 0; case C.ACTIVE_UNIFORM_BLOCKS: return ls ? ls.blocks.length : 0;
      case C.TRANSFORM_FEEDBACK_VARYINGS: return ls ? ls.transformFeedback.length : 0; case C.TRANSFORM_FEEDBACK_BUFFER_MODE: return p.feedback.mode;
    }
    this.err(C.INVALID_ENUM); return null;
  }
  getProgramInfoLog(p) { return p ? p.log : null; }
  getAttribLocation(p, name) { if (!p?.linked) { this.err(C.INVALID_OPERATION); return -1; } const a = p.state.attributeNames.get(String(name)); return a && a.active ? a.loc : -1; }
  getActiveAttrib(p, index) { const a = p?.state?.activeAttributes[index]; if (!a) { this.err(C.INVALID_VALUE); return null; } return { name: a.name, size: a.size, type: a.glType }; }
  getActiveUniform(p, index) { const u = p?.state?.activeUniforms[index]; if (!u) { this.err(C.INVALID_VALUE); return null; } return { name: u.name, size: u.size, type: u.glType }; }
  getFragDataLocation(p, name) {
    if (!p?.linked) { this.err(C.INVALID_OPERATION); return -1; }
    const m = /^(\w+)(?:\[(\d+)\])?$/.exec(String(name)); if (!m) return -1;
    for (const [sym, o] of p.state.outputs) if (sym.name === m[1]) { const i = m[2] === undefined ? 0 : Number(m[2]); if (i >= o.count) return -1; return o.location + i; }
    return -1;
  }
  getUniformLocation(p, name) {
    if (!p?.linked) { this.err(C.INVALID_OPERATION); return null; }
    name = String(name);
    const m = /^(.*?)(?:\[(\d+)\])?$/.exec(name), base = m[1], index = m[2] === undefined ? 0 : Number(m[2]);
    for (const u of p.state.activeUniforms) {
      if (u.blockIndex !== -1) continue;
      if (u.base === base || u.name === name || (u.isArray && `${u.base}[0]` === name)) {
        if (index >= u.size) return null; if (m[2] !== undefined && !u.isArray) return null;
        return { kind: 'uniformLocation', program: p, link: p.linkCount, u, index };
      }
    }
    return null;
  }
  checkLocation(loc) {
    if (loc === null || loc === undefined) return null;
    if (loc.program !== this.state.program || loc.link !== loc.program.linkCount) { this.err(C.INVALID_OPERATION); return null; }
    return loc;
  }
  /** Writes uniform values: `values` flat, `n` components per element, `kind` of the call ('f' | 'i' | 'ui'), `matrix` for uniformMatrix*. */
  setUniform(loc, values, n, kind, matrix = null) {
    const l = this.checkLocation(loc); if (!l) return;
    const u = l.u, t = u.type, b = t.k === 'sampler' ? 'sampler' : t.b, size = t.k === 'sampler' ? 1 : comps(t);
    if (matrix) { if (t.k !== 'matrix' || t.c !== matrix.c || t.r !== matrix.r) return this.err(C.INVALID_OPERATION); }
    else {
      if (t.k === 'matrix') return this.err(C.INVALID_OPERATION);
      if ((t.k === 'scalar' || t.k === 'sampler' ? 1 : t.n) !== n) return this.err(C.INVALID_OPERATION);
      if (b === 'float' && kind !== 'f') return this.err(C.INVALID_OPERATION); if ((b === 'int' || b === 'sampler') && kind !== 'i') return this.err(C.INVALID_OPERATION); if (b === 'uint' && kind !== 'ui') return this.err(C.INVALID_OPERATION);
    }
    const count = Math.floor(values.length / size); if (!u.isArray && count > 1) return this.err(C.INVALID_OPERATION);
    if (b === 'sampler') for (const v of values) if (v < 0 || v >= MAX_COMBINED_UNITS) return this.err(C.INVALID_VALUE);
    const U = l.program.state.U, elements = Math.min(count, u.size - l.index);
    for (let e = 0; e < elements; e++) {
      const at = u.offset + (l.index + e) * u.stride;
      if (matrix && matrix.transpose) { for (let c = 0; c < t.c; c++) for (let r = 0; r < t.r; r++) U[at + c * t.r + r] = Math.fround(values[e * size + r * t.c + c]); continue; }
      for (let k = 0; k < size; k++) { const v = values[e * size + k]; U[at + k] = b === 'float' ? Math.fround(v) : b === 'bool' ? (v ? 1 : 0) : b === 'uint' ? v >>> 0 : v | 0; }
    }
  }
  getUniform(p, loc) {
    if (!p?.linked || loc?.program !== p || loc.link !== p.linkCount) { this.err(C.INVALID_OPERATION); return null; }
    const u = loc.u, t = u.type, at = u.offset + loc.index * u.stride, U = p.state.U, n = t.k === 'sampler' ? 1 : comps(t), values = Array.from(U.subarray(at, at + n));
    if (t.k === 'sampler' || t.b === 'int') return n === 1 ? values[0] : new Int32Array(values);
    if (t.b === 'uint') return n === 1 ? values[0] : new Uint32Array(values);
    if (t.b === 'bool') return n === 1 ? !!values[0] : values.map(Boolean);
    return n === 1 ? values[0] : new Float32Array(values);
  }
  getUniformBlockIndex(p, name) { const b = p?.state?.blocks.find(x => x.name === String(name)); return b ? b.index : 0xFFFFFFFF; }
  uniformBlockBinding(p, index, binding) { const b = p?.state?.blocks[index]; if (!b || binding >= 24) return this.err(C.INVALID_VALUE); b.binding = binding; }
  getActiveUniformBlockName(p, index) { const b = p?.state?.blocks[index]; if (!b) { this.err(C.INVALID_VALUE); return null; } return b.name; }
  getActiveUniformBlockParameter(p, index, pname) {
    const b = p?.state?.blocks[index]; if (!b) { this.err(C.INVALID_VALUE); return null; }
    switch (pname) {
      case 0x8A3F: return b.binding; case 0x8A40: return b.dataSize; case 0x8A42: return b.uniformIndices.length; case 0x8A43: return new Uint32Array(b.uniformIndices);
      case 0x8A44: return b.infos.some(i => p.state.vertex && i === i) && p.shaders.find(s => s.type === C.VERTEX_SHADER)?.checked?.blocks.some(x => x.name === b.name) || false;
      case 0x8A46: return p.shaders.find(s => s.type === C.FRAGMENT_SHADER)?.checked?.blocks.some(x => x.name === b.name) || false;
      case 0x8A41: return b.name.length + 1;
    }
    this.err(C.INVALID_ENUM); return null;
  }
  getActiveUniforms(p, indices, pname) {
    const list = p?.state?.activeUniforms; if (!list) { this.err(C.INVALID_OPERATION); return null; }
    const out = [];
    for (const i of indices) {
      const u = list[i]; if (!u) { this.err(C.INVALID_VALUE); return null; }
      switch (pname) {
        case 0x8A37: out.push(u.glType); break; case 0x8A38: out.push(u.size); break; case 0x8A39: out.push(u.name.length + 1); break; case 0x8A3A: out.push(u.blockIndex); break;
        case 0x8A3B: out.push(u.blockIndex === -1 ? -1 : u.byteOffset); break; case 0x8A3C: out.push(u.blockIndex === -1 ? -1 : u.arrayStride); break; case 0x8A3D: out.push(u.blockIndex === -1 ? -1 : u.matrixStride); break;
        case 0x8A3E: out.push(!!u.rowMajor); break; default: this.err(C.INVALID_ENUM); return null;
      }
    }
    return pname === 0x8A3E ? out : pname === 0x8A37 || pname === 0x8A39 ? new Uint32Array(out) : new Int32Array(out);
  }
  getUniformIndices(p, names) { const list = p?.state?.activeUniforms ?? []; return names.map(n => { const i = list.findIndex(u => u.name === n || `${u.base}` === n); return i < 0 ? 0xFFFFFFFF : i; }); }
  transformFeedbackVaryings(p, varyings, mode) { if (mode !== C.INTERLEAVED_ATTRIBS && mode !== C.SEPARATE_ATTRIBS) return this.err(C.INVALID_ENUM); if (mode === C.SEPARATE_ATTRIBS && varyings.length > 4) return this.err(C.INVALID_VALUE); p.feedback = { varyings: [...varyings], mode }; }
  getTransformFeedbackVarying(p, index) { const v = p?.state?.transformFeedback[index]; if (!v) { this.err(C.INVALID_VALUE); return null; } return { name: v.name, size: v.size, type: v.glType }; }

  // ---- queries, transform feedback, syncs ----
  createQuery() { const q = new GLObject('query'); q.target = 0; q.result = 0; q.available = false; return q; }
  deleteQuery(q) { if (!q || q.deleted) return; q.deleted = true; for (const [t, active] of this.state.queries) if (active === q) this.state.queries.delete(t); }
  isQuery(q) { return !!q && q.kind === 'query' && !q.deleted && !!q.target; }
  beginQuery(target, q) {
    if (![C.ANY_SAMPLES_PASSED, C.ANY_SAMPLES_PASSED_CONSERVATIVE, C.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN].includes(target)) return this.err(C.INVALID_ENUM);
    if (!q || q.deleted) return this.err(C.INVALID_OPERATION); if (this.state.queries.has(target)) return this.err(C.INVALID_OPERATION);
    const occlusion = target !== C.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN; if (occlusion && this.state.queries.has(occlusion ? (target === C.ANY_SAMPLES_PASSED ? C.ANY_SAMPLES_PASSED_CONSERVATIVE : C.ANY_SAMPLES_PASSED) : 0)) return this.err(C.INVALID_OPERATION);
    if (q.target && q.target !== target) return this.err(C.INVALID_OPERATION);
    q.target = target; q.available = false; q.start = occlusion ? this.samplesPassed : this.primitivesWritten; this.state.queries.set(target, q);
  }
  endQuery(target) {
    const q = this.state.queries.get(target); if (!q) return this.err(C.INVALID_OPERATION); this.state.queries.delete(target);
    q.result = target === C.TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN ? this.primitivesWritten - q.start : this.samplesPassed > q.start ? 1 : 0; q.available = true;   // the CPU finishes the work at once: the result is available
  }
  getQuery(target, pname) { if (pname !== C.CURRENT_QUERY) { this.err(C.INVALID_ENUM); return null; } return this.state.queries.get(target) ?? null; }
  getQueryParameter(q, pname) { if (!q || this.state.queries.get(q.target) === q) { this.err(C.INVALID_OPERATION); return null; } if (pname === C.QUERY_RESULT) return q.result; if (pname === C.QUERY_RESULT_AVAILABLE) return q.available; this.err(C.INVALID_ENUM); return null; }
  createTransformFeedback() { const tf = new GLObject('transformFeedback'); tf.buffers = Array.from({ length: 4 }, () => ({ buffer: null, offset: 0, size: -1 })); tf.active = false; tf.paused = false; tf.written = [0, 0, 0, 0]; return tf; }
  deleteTransformFeedback(tf) { if (!tf || tf.deleted) return; if (tf.active) return this.err(C.INVALID_OPERATION); tf.deleted = true; if (this.state.transformFeedback === tf) this.state.transformFeedback = this.defaultFeedback; }
  isTransformFeedback(tf) { return !!tf && tf.kind === 'transformFeedback' && !tf.deleted && tf.used; }
  bindTransformFeedback(target, tf) { if (target !== C.TRANSFORM_FEEDBACK) return this.err(C.INVALID_ENUM); if (this.state.transformFeedback.active && !this.state.transformFeedback.paused) return this.err(C.INVALID_OPERATION); if (tf) tf.used = true; this.state.transformFeedback = tf ?? this.defaultFeedback; }
  beginTransformFeedback(mode) {
    const tf = this.state.transformFeedback, p = this.state.program; if (![0, 1, 4].includes(mode)) return this.err(C.INVALID_ENUM);
    if (tf.active || !p?.linked || !p.state.transformFeedback.length) return this.err(C.INVALID_OPERATION);
    const n = p.state.feedbackMode === C.INTERLEAVED_ATTRIBS ? 1 : p.state.transformFeedback.length; for (let i = 0; i < n; i++) if (!tf.buffers[i].buffer) return this.err(C.INVALID_OPERATION);
    tf.active = true; tf.paused = false; tf.mode = mode; tf.program = p; tf.written = [0, 0, 0, 0];
  }
  endTransformFeedback() { const tf = this.state.transformFeedback; if (!tf.active) return this.err(C.INVALID_OPERATION); tf.active = false; tf.paused = false; }
  pauseTransformFeedback() { const tf = this.state.transformFeedback; if (!tf.active || tf.paused) return this.err(C.INVALID_OPERATION); tf.paused = true; }
  resumeTransformFeedback() { const tf = this.state.transformFeedback; if (!tf.active || !tf.paused) return this.err(C.INVALID_OPERATION); tf.paused = false; }
  /** Writes the captured outputs of a draw's vertices (in primitive order) to the bound buffers (ES 3.0 2.15.2). */
  captureFeedback(tf, mode, list, program) {
    const varyings = program.transformFeedback, interleaved = program.feedbackMode === C.INTERLEAVED_ATTRIBS;
    const per = mode === MODES.POINTS ? 1 : mode === MODES.LINES || mode === MODES.LINE_STRIP || mode === MODES.LINE_LOOP ? 2 : 3;
    const verts = [];
    if (mode === MODES.POINTS || mode === MODES.LINES || mode === MODES.TRIANGLES) for (let i = 0; i + per <= list.length; i += per) verts.push(...list.slice(i, i + per));
    const prims = verts.length / per;
    const write = (slot, offsetBytes, v, varying) => {
      const b = tf.buffers[slot], view = new DataView(b.buffer.data.buffer, b.buffer.data.byteOffset, b.buffer.data.byteLength), base = varying.type.k === 'array' ? varying.type.e : varying.type;
      for (let k = 0; k < varying.count; k++) { const at = b.offset + offsetBytes + 4 * k; if (base.b === 'int') view.setInt32(at, v[varying.offset + k], true); else if (base.b === 'uint') view.setUint32(at, v[varying.offset + k], true); else view.setFloat32(at, v[varying.offset + k], true); }
    };
    const strideOf = slot => interleaved ? varyings.reduce((s, v) => s + v.count * 4, 0) : varyings[slot].count * 4;
    for (let slot = 0; slot < (interleaved ? 1 : varyings.length); slot++) { const b = tf.buffers[slot], room = (b.size >= 0 ? Math.min(b.size, b.buffer.data.length - b.offset) : b.buffer.data.length - b.offset) - tf.written[slot] * strideOf(slot); if (room < verts.length * strideOf(slot)) { this.err(C.INVALID_OPERATION); return; } }
    verts.forEach(v => {
      if (interleaved) { let at = tf.written[0] * strideOf(0); for (const varying of varyings) { write(0, at, v, varying); at += varying.count * 4; } tf.written[0]++; }
      else varyings.forEach((varying, slot) => { write(slot, tf.written[slot] * strideOf(slot), v, varying); tf.written[slot]++; });
    });
    this.primitivesWritten += prims;
  }
  fenceSync(condition, flags) { if (condition !== C.SYNC_GPU_COMMANDS_COMPLETE) { this.err(C.INVALID_ENUM); return null; } if (flags !== 0) { this.err(C.INVALID_VALUE); return null; } return new GLObject('sync'); }
  isSync(s) { return !!s && s.kind === 'sync' && !s.deleted; }
  deleteSync(s) { if (s) s.deleted = true; }
  clientWaitSync(s, flags) { if (flags & ~1) { this.err(C.INVALID_VALUE); return 0x911D; } return C.ALREADY_SIGNALED; }   // the commands before a fence have completed when the call returns: the CPU runs them synchronously
  waitSync() {}
  getSyncParameter(s, pname) { switch (pname) { case C.SYNC_STATUS: return C.SIGNALED; case C.OBJECT_TYPE: return C.SYNC_FENCE; case C.SYNC_CONDITION: return C.SYNC_GPU_COMMANDS_COMPLETE; case C.SYNC_FLAGS: return 0; } this.err(C.INVALID_ENUM); return null; }

  // ---- uniforms (the WebGL entry points) ----
  uniform1f(l, x) { this.setUniform(l, [x], 1, 'f'); } uniform2f(l, x, y) { this.setUniform(l, [x, y], 2, 'f'); } uniform3f(l, x, y, z) { this.setUniform(l, [x, y, z], 3, 'f'); } uniform4f(l, x, y, z, w) { this.setUniform(l, [x, y, z, w], 4, 'f'); }
  uniform1i(l, x) { this.setUniform(l, [x], 1, 'i'); } uniform2i(l, x, y) { this.setUniform(l, [x, y], 2, 'i'); } uniform3i(l, x, y, z) { this.setUniform(l, [x, y, z], 3, 'i'); } uniform4i(l, x, y, z, w) { this.setUniform(l, [x, y, z, w], 4, 'i'); }
  uniform1ui(l, x) { this.setUniform(l, [x], 1, 'ui'); } uniform2ui(l, x, y) { this.setUniform(l, [x, y], 2, 'ui'); } uniform3ui(l, x, y, z) { this.setUniform(l, [x, y, z], 3, 'ui'); } uniform4ui(l, x, y, z, w) { this.setUniform(l, [x, y, z, w], 4, 'ui'); }
  uniform1fv(l, v) { this.setUniform(l, v, 1, 'f'); } uniform2fv(l, v) { this.setUniform(l, v, 2, 'f'); } uniform3fv(l, v) { this.setUniform(l, v, 3, 'f'); } uniform4fv(l, v) { this.setUniform(l, v, 4, 'f'); }
  uniform1iv(l, v) { this.setUniform(l, v, 1, 'i'); } uniform2iv(l, v) { this.setUniform(l, v, 2, 'i'); } uniform3iv(l, v) { this.setUniform(l, v, 3, 'i'); } uniform4iv(l, v) { this.setUniform(l, v, 4, 'i'); }
  uniform1uiv(l, v) { this.setUniform(l, v, 1, 'ui'); } uniform2uiv(l, v) { this.setUniform(l, v, 2, 'ui'); } uniform3uiv(l, v) { this.setUniform(l, v, 3, 'ui'); } uniform4uiv(l, v) { this.setUniform(l, v, 4, 'ui'); }
  uniformMatrix2fv(l, tr, v) { this.setUniform(l, v, 4, 'f', { c: 2, r: 2, transpose: tr }); } uniformMatrix3fv(l, tr, v) { this.setUniform(l, v, 9, 'f', { c: 3, r: 3, transpose: tr }); } uniformMatrix4fv(l, tr, v) { this.setUniform(l, v, 16, 'f', { c: 4, r: 4, transpose: tr }); }
  uniformMatrix2x3fv(l, tr, v) { this.setUniform(l, v, 6, 'f', { c: 2, r: 3, transpose: tr }); } uniformMatrix3x2fv(l, tr, v) { this.setUniform(l, v, 6, 'f', { c: 3, r: 2, transpose: tr }); }
  uniformMatrix2x4fv(l, tr, v) { this.setUniform(l, v, 8, 'f', { c: 2, r: 4, transpose: tr }); } uniformMatrix4x2fv(l, tr, v) { this.setUniform(l, v, 8, 'f', { c: 4, r: 2, transpose: tr }); }
  uniformMatrix3x4fv(l, tr, v) { this.setUniform(l, v, 12, 'f', { c: 3, r: 4, transpose: tr }); } uniformMatrix4x3fv(l, tr, v) { this.setUniform(l, v, 12, 'f', { c: 4, r: 3, transpose: tr }); }

  // ---- draws ----
  /** The generated stage of a linked program, bound to this context's texture units (built once per link). */
  stageRuntime(state, stage) {
    state.runtimes ??= {};
    if (state.runtimes[stage]) return state.runtimes[stage];
    const n = VARYING_BASE + state.varyingCount, self = this;
    const rt = {
      U: state.U, A: new Float64Array(MAX_VERTEX_ATTRIBS * 4), O: new Float64Array(stage === 'vertex' ? n : 20), I: new Float64Array(n), L1: new Float64Array(n), L2: new Float64Array(n),
      F: new Float64Array(10), F1: new Float64Array(10), F2: new Float64Array(10), P: this.P, R: this.R, S2: this.S2, S3: this.S3, SC: this.SC, SA: this.SA, B: state.blocks.map(b => b.store),
      loopLimit() { self.note(`GL shader: a loop ran more than ${LOOP_LIMIT} iterations and was stopped (a GPU would reset the context)`); },
      ...shaderHelpers(this.R),
    };
    rt.main = (stage === 'vertex' ? state.vertex : state.fragment).factory(rt);
    state.runtimes[stage] = rt; return rt;
  }
  prepareDraw(mode) {
    const s = this.state, p = s.program;
    if (!p) { this.err(C.INVALID_OPERATION); return false; }
    if (!p.linked || !p.state) { this.err(C.INVALID_OPERATION); return false; }
    if (mode < 0 || mode > 6) { this.err(C.INVALID_ENUM); return false; }
    const tf = s.transformFeedback; if (tf.active && !tf.paused && (mode !== tf.mode && !(tf.mode === 1 && false))) { this.err(C.INVALID_OPERATION); return false; }
    if (s.drawFb && this.framebufferStatus(s.drawFb) !== C.FRAMEBUFFER_COMPLETE) { this.err(C.INVALID_FRAMEBUFFER_OPERATION); return false; }
    const ps = p.state;
    // texture units of the program's samplers
    for (const u of ps.activeUniforms) {
      if (!u.sampler) continue; const dim = u.type.dim, table = dim === 2 ? this.S2 : dim === 3 ? this.S3 : dim === 'cube' ? this.SC : this.SA, key = dim === 2 ? '2d' : dim === 3 ? '3d' : dim === 'cube' ? 'cube' : '2darray';
      for (let i = 0; i < u.size; i++) { const unit = ps.U[u.offset + i]; table[unit].update(s.textures[unit][key], s.samplers[unit]); }
    }
    // uniform blocks: std140 data of the bound ranges
    for (const b of ps.blocks) {
      const binding = s.uniformBindings[b.binding]; if (!binding?.buffer) { this.err(C.INVALID_OPERATION); return false; }
      const data = binding.buffer.data, size = binding.size >= 0 ? binding.size : data.length - binding.offset; if (size < b.dataSize || binding.offset + b.dataSize > data.length) { this.err(C.INVALID_OPERATION); return false; }
      const view = new DataView(data.buffer, data.byteOffset + binding.offset, b.dataSize);
      b.components.forEach((c, i) => { b.store[i] = c.kind === 'float' ? view.getFloat32(c.at, true) : c.kind === 'int' ? view.getInt32(c.at, true) : c.kind === 'uint' ? view.getUint32(c.at, true) : (view.getUint32(c.at, true) ? 1 : 0); });
    }
    const dr = s.depthRange; ps.U[ps.depthRangeOffset] = dr[0]; ps.U[ps.depthRangeOffset + 1] = dr[1]; ps.U[ps.depthRangeOffset + 2] = dr[1] - dr[0];
    return true;
  }
  /** WebGL's check that enabled arrays cover the vertices a draw reads (INVALID_OPERATION otherwise). */
  checkAttributes(maxVertex, instances) {
    const s = this.state, ps = s.program.state;
    for (const attr of ps.activeAttributes) {
      const columns = attr.type.k === 'matrix' ? attr.type.c : 1;
      for (let c = 0; c < columns; c++) {
        const a = s.vao.attribs[attr.location + c]; if (!a.enabled) continue;
        if (!a.buffer) { this.err(C.INVALID_OPERATION); return false; }
        const count = a.divisor ? Math.ceil(instances / a.divisor) : maxVertex + 1; if (count <= 0) continue;
        const stride = a.stride || a.elementBytes, need = a.offset + (count - 1) * stride + a.elementBytes;
        if (need > a.buffer.data.length) { this.err(C.INVALID_OPERATION); return false; }
      }
    }
    return true;
  }
  drawArrays(mode, first, count) { this.drawArraysInstanced(mode, first, count, 1); }
  drawArraysInstanced(mode, first, count, instances) {
    if (first < 0 || count < 0 || instances < 0) return this.err(C.INVALID_VALUE);
    if (!this.prepareDraw(mode)) return; if (!count || !instances) return;
    if (!this.checkAttributes(first + count - 1, instances)) return;
    drawPipeline(this, mode, first, count, null, instances);
  }
  drawElements(mode, count, type, offset) { this.drawElementsInstanced(mode, count, type, offset, 1); }
  drawRangeElements(mode, start, end, count, type, offset) { if (end < start) return this.err(C.INVALID_VALUE); this.drawElementsInstanced(mode, count, type, offset, 1); }
  drawElementsInstanced(mode, count, type, offset, instances) {
    if (count < 0 || instances < 0 || offset < 0) return this.err(C.INVALID_VALUE);
    const bytes = INDEX_BYTES[type]; if (!bytes) return this.err(C.INVALID_ENUM);
    if (!this.prepareDraw(mode)) return;
    if (this.state.transformFeedback.active && !this.state.transformFeedback.paused) return this.err(C.INVALID_OPERATION);
    const element = this.state.vao.element; if (!element) return this.err(C.INVALID_OPERATION);
    if (offset % bytes) return this.err(C.INVALID_OPERATION);
    if (!count || !instances) return;
    if (offset + count * bytes > element.data.length) return this.err(C.INVALID_OPERATION);
    const view = new DataView(element.data.buffer, element.data.byteOffset + offset, count * bytes), indices = new Int32Array(count), restart = this.state.primitiveRestart;
    const restartIndex = bytes === 1 ? 0xff : bytes === 2 ? 0xffff : 0xffffffff;
    let max = -1;
    for (let i = 0; i < count; i++) { const v = bytes === 1 ? view.getUint8(i) : bytes === 2 ? view.getUint16(i * 2, true) : view.getUint32(i * 4, true); if (restart && v === restartIndex) { indices[i] = -1; continue; } indices[i] = v; if (v > max) max = v; }
    if (!this.checkAttributes(max, instances)) return;
    drawPipeline(this, mode, 0, count, indices, instances);
  }
}
const F32 = new Float32Array(1), I32 = new Int32Array(F32.buffer), U32 = new Uint32Array(F32.buffer);
/** Runtime helpers of generated shaders (rt.* in src/cpu-gl/glsl-codegen.js); the unpack ones write R. */
function shaderHelpers(R) {
  return {
    round: x => (x < 0 ? -Math.round(-x) : Math.round(x)),
    roundEven: x => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : r; },
    fbi: x => { F32[0] = x; return I32[0]; }, fbu: x => { F32[0] = x; return U32[0]; }, ibf: x => { I32[0] = x; return F32[0]; }, ubf: x => { U32[0] = x; return F32[0]; },
    packSnorm2x16: (x, y) => { const p = v => Math.round(Math.min(1, Math.max(-1, v)) * 32767) & 0xffff; return (p(x) | (p(y) << 16)) >>> 0; },
    packUnorm2x16: (x, y) => { const p = v => Math.round(Math.min(1, Math.max(0, v)) * 65535); return (p(x) | (p(y) << 16)) >>> 0; },
    packHalf2x16: (x, y) => (toHalf(x) | (toHalf(y) << 16)) >>> 0,
    unpackSnorm2x16: v => { R[0] = Math.max(-1, ((v << 16) >> 16) / 32767); R[1] = Math.max(-1, (v >> 16) / 32767); },
    unpackUnorm2x16: v => { R[0] = (v & 0xffff) / 65535; R[1] = (v >>> 16) / 65535; },
    unpackHalf2x16: v => { R[0] = fromHalf(v & 0xffff); R[1] = fromHalf(v >>> 16); },
  };
}
