import { Blocked } from './scheduler.js?v=a104526a388b';
import { bitsFloat, floatBits } from './host-contract.js?v=a104526a388b';
import { readNativeBytes, writeNativeBytes } from './unsafe-native.js?v=a104526a388b';

// OpenGL ES 2.0 / 3.0 and EGL 1.4 for the ORIGINAL android.opengl.GLES20, GLES30, EGL14 and com.google.android.gles_jni.EGLImpl / GLImpl (android-13.0.0_r1 Java in framework.dex),
// over WebGL2 in the VM Worker (docs/OPENGL-ES-ON-WEBGL2.md). These are the natives of android_opengl_GLES20.cpp, android_opengl_GLES30.cpp, android_opengl_EGL14.cpp and
// com_google_android_gles_jni_EGLImpl.cpp: the Java side (GLSurfaceView, EglHelper, the Renderer callbacks on the GL thread) is the original code.
//
//   EGL      one display; a fixed table of RGBA8888 / RGB888 / RGB565 configs, ES2 and ES3 renderable, window and pbuffer, chosen with the EGL 1.4 matching and sorting rules;
//            contexts of client version 2 or 3 (1.x is refused: the lab has no fixed-function pipeline); per-thread current context and error, as EGL binds them to a thread
//            (the VM's green threads). A context is one WebGL2 context; contexts created with a share context share its WebGL2 context and its object names.
//   Surfaces a window surface is the Surface of a SurfaceView (src/camera-surface-host.js), a pbuffer is offscreen. Each is a framebuffer object of the lab with a colour and a
//            depth/stencil renderbuffer of its config; the app's framebuffer 0 is that object (bindings, queries, glDrawBuffers / glReadBuffer / glInvalidateFramebuffer of
//            GL_BACK, GL_COLOR, GL_DEPTH, GL_STENCIL are translated). eglSwapBuffers copies it to the context's canvas, hands the picture to the page
//            (platform.glPresent: an ImageBitmap the page draws in the SurfaceView's box) and returns at the next display frame (16.7 ms), as a device's buffer queue does.
//   GL       names are lab integers mapped to WebGL objects per share group; uniform locations are integers per program; ES 2.0 client-side vertex and index arrays (which WebGL
//            forbids) are uploaded to scratch buffers at draw time, as an ES-on-desktop layer does; java.nio buffers are read and written where they are (native memory of a
//            direct buffer, or the backing array of a heap buffer), as NIOAccess does for the original JNI. glGetError keeps the first error the lab itself raised, then WebGL's.
//   Strings  GL_VERSION "OpenGL ES 3.0 (WebGL2 lab)", GL_SHADING_LANGUAGE_VERSION "OpenGL ES GLSL ES 3.00", GL_RENDERER the browser's (WEBGL_debug_renderer_info) when exposed.
// Not available, failing explicitly with UnsupportedOperationException naming the call: ES 1.x contexts and the GL10 fixed-function calls of GLImpl, glMapBufferRange /
// glGetBufferPointerv / glUnmapBuffer (no mapped memory), program and shader binaries, pixmap surfaces, EGLImage and external textures. Without WebGL2 in the Worker (some browsers,
// Node without a backend) eglInitialize refuses with the reason. No process.*.
const GLES20 = 'Landroid/opengl/GLES20;', GLES30 = 'Landroid/opengl/GLES30;', EGL14 = 'Landroid/opengl/EGL14;', EGLIMPL = 'Lcom/google/android/gles_jni/EGLImpl;', GLIMPL = 'Lcom/google/android/gles_jni/GLImpl;';
const H = 'Landroid/opengl/EGLObjectHandle;->mHandle:J';
const E14 = { display: 'Landroid/opengl/EGLDisplay;', config: 'Landroid/opengl/EGLConfig;', context: 'Landroid/opengl/EGLContext;', surface: 'Landroid/opengl/EGLSurface;' };
const E10 = { display: 'Lcom/google/android/gles_jni/EGLDisplayImpl;', config: 'Lcom/google/android/gles_jni/EGLConfigImpl;', context: 'Lcom/google/android/gles_jni/EGLContextImpl;', surface: 'Lcom/google/android/gles_jni/EGLSurfaceImpl;' };
const E10_FIELD = { display: `${E10.display}->mEGLDisplay:J`, config: `${E10.config}->mEGLConfig:J`, context: `${E10.context}->mEGLContext:J`, surface: `${E10.surface}->mEGLSurface:J` };
const J_DISPLAY = 'Ljavax/microedition/khronos/egl/EGLDisplay;', J_CONFIG = 'Ljavax/microedition/khronos/egl/EGLConfig;', J_CONTEXT = 'Ljavax/microedition/khronos/egl/EGLContext;', J_SURFACE = 'Ljavax/microedition/khronos/egl/EGLSurface;';
const BUFFER = 'Ljava/nio/Buffer;', INT_BUFFER = 'Ljava/nio/IntBuffer;', FLOAT_BUFFER = 'Ljava/nio/FloatBuffer;', LONG_BUFFER = 'Ljava/nio/LongBuffer;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;';
const UOE = 'Ljava/lang/UnsupportedOperationException;', IAE = 'Ljava/lang/IllegalArgumentException;';
export const GL_VERSION_STRING = 'OpenGL ES 3.0 (WebGL2 lab)', GLSL_VERSION_STRING = 'OpenGL ES GLSL ES 3.00', VSYNC_MS = 1000 / 60;

// ---- EGL constants ---------------------------------------------------------------------------------------------------------------------------------------------------------
const EGL = { SUCCESS: 0x3000, NOT_INITIALIZED: 0x3001, BAD_ACCESS: 0x3002, BAD_ALLOC: 0x3003, BAD_ATTRIBUTE: 0x3004, BAD_CONFIG: 0x3005, BAD_CONTEXT: 0x3006, BAD_CURRENT_SURFACE: 0x3007, BAD_DISPLAY: 0x3008,
  BAD_MATCH: 0x3009, BAD_NATIVE_PIXMAP: 0x300A, BAD_NATIVE_WINDOW: 0x300B, BAD_PARAMETER: 0x300C, BAD_SURFACE: 0x300D, NONE: 0x3038, DONT_CARE: -1,
  BUFFER_SIZE: 0x3020, ALPHA_SIZE: 0x3021, BLUE_SIZE: 0x3022, GREEN_SIZE: 0x3023, RED_SIZE: 0x3024, DEPTH_SIZE: 0x3025, STENCIL_SIZE: 0x3026, CONFIG_CAVEAT: 0x3027, CONFIG_ID: 0x3028, LEVEL: 0x3029,
  MAX_PBUFFER_HEIGHT: 0x302A, MAX_PBUFFER_PIXELS: 0x302B, MAX_PBUFFER_WIDTH: 0x302C, NATIVE_RENDERABLE: 0x302D, NATIVE_VISUAL_ID: 0x302E, NATIVE_VISUAL_TYPE: 0x302F, SAMPLES: 0x3031, SAMPLE_BUFFERS: 0x3032,
  SURFACE_TYPE: 0x3033, TRANSPARENT_TYPE: 0x3034, TRANSPARENT_BLUE_VALUE: 0x3035, TRANSPARENT_GREEN_VALUE: 0x3036, TRANSPARENT_RED_VALUE: 0x3037, BIND_TO_TEXTURE_RGB: 0x3039, BIND_TO_TEXTURE_RGBA: 0x303A,
  MIN_SWAP_INTERVAL: 0x303B, MAX_SWAP_INTERVAL: 0x303C, LUMINANCE_SIZE: 0x303D, ALPHA_MASK_SIZE: 0x303E, COLOR_BUFFER_TYPE: 0x303F, RENDERABLE_TYPE: 0x3040, MATCH_NATIVE_PIXMAP: 0x3041, CONFORMANT: 0x3042,
  RGB_BUFFER: 0x308E, HEIGHT: 0x3056, WIDTH: 0x3057, LARGEST_PBUFFER: 0x3058, TEXTURE_FORMAT: 0x3080, TEXTURE_TARGET: 0x3081, MIPMAP_TEXTURE: 0x3082, MIPMAP_LEVEL: 0x3083, RENDER_BUFFER: 0x3086,
  VG_COLORSPACE: 0x3087, VG_ALPHA_FORMAT: 0x3088, HORIZONTAL_RESOLUTION: 0x3090, VERTICAL_RESOLUTION: 0x3091, PIXEL_ASPECT_RATIO: 0x3092, SWAP_BEHAVIOR: 0x3093, MULTISAMPLE_RESOLVE: 0x3099,
  BACK_BUFFER: 0x3084, BUFFER_DESTROYED: 0x3095, CONTEXT_CLIENT_TYPE: 0x3097, CONTEXT_CLIENT_VERSION: 0x3098, OPENGL_ES_API: 0x30A0, VENDOR: 0x3053, VERSION: 0x3054, EXTENSIONS: 0x3055, CLIENT_APIS: 0x308D,
  DRAW: 0x3059, READ: 0x305A, PBUFFER_BIT: 0x1, WINDOW_BIT: 0x4, ES2_BIT: 0x4, ES3_BIT: 0x40, RECORDABLE_ANDROID: 0x3142, FRAMEBUFFER_TARGET_ANDROID: 0x3147, CONTEXT_FLAGS_KHR: 0x30FC,
  CONTEXT_MINOR_VERSION_KHR: 0x30FB, CONTEXT_PRIORITY_LEVEL_IMG: 0x3100, GL_COLORSPACE_KHR: 0x309D, GL_COLORSPACE_SRGB_KHR: 0x3089, GL_COLORSPACE_LINEAR_KHR: 0x308A };
const PIXEL_FORMAT = { RGBA_8888: 1, RGBX_8888: 2, RGB_888: 3, RGB_565: 4 };
/** The configs of the lab's display (window and pbuffer, ES2 and ES3 renderable; single-sampled). */
export const EGL_CONFIGS = Object.freeze([
  { r: 8, g: 8, b: 8, a: 8, depth: 24, stencil: 8 }, { r: 8, g: 8, b: 8, a: 8, depth: 16, stencil: 0 }, { r: 8, g: 8, b: 8, a: 8, depth: 0, stencil: 0 },
  { r: 8, g: 8, b: 8, a: 0, depth: 24, stencil: 8 }, { r: 8, g: 8, b: 8, a: 0, depth: 16, stencil: 0 }, { r: 8, g: 8, b: 8, a: 0, depth: 0, stencil: 0 },
  { r: 5, g: 6, b: 5, a: 0, depth: 16, stencil: 0 }, { r: 5, g: 6, b: 5, a: 0, depth: 0, stencil: 0 },
].map((c, i) => Object.freeze({ ...c, id: i + 1, handle: 0x1000n + BigInt(i + 1) })));
export function configAttribute(config, attribute) {
  switch (attribute) {
    case EGL.BUFFER_SIZE: return config.r + config.g + config.b + config.a;
    case EGL.RED_SIZE: return config.r; case EGL.GREEN_SIZE: return config.g; case EGL.BLUE_SIZE: return config.b; case EGL.ALPHA_SIZE: return config.a;
    case EGL.DEPTH_SIZE: return config.depth; case EGL.STENCIL_SIZE: return config.stencil; case EGL.CONFIG_ID: return config.id; case EGL.CONFIG_CAVEAT: return EGL.NONE; case EGL.LEVEL: return 0;
    case EGL.MAX_PBUFFER_WIDTH: case EGL.MAX_PBUFFER_HEIGHT: return 4096; case EGL.MAX_PBUFFER_PIXELS: return 4096 * 4096; case EGL.NATIVE_RENDERABLE: return 1;
    case EGL.NATIVE_VISUAL_ID: return config.r === 5 ? PIXEL_FORMAT.RGB_565 : config.a ? PIXEL_FORMAT.RGBA_8888 : PIXEL_FORMAT.RGBX_8888; case EGL.NATIVE_VISUAL_TYPE: return 0;
    case EGL.SAMPLES: case EGL.SAMPLE_BUFFERS: return 0; case EGL.SURFACE_TYPE: return EGL.WINDOW_BIT | EGL.PBUFFER_BIT; case EGL.TRANSPARENT_TYPE: return EGL.NONE;
    case EGL.TRANSPARENT_RED_VALUE: case EGL.TRANSPARENT_GREEN_VALUE: case EGL.TRANSPARENT_BLUE_VALUE: return 0; case EGL.BIND_TO_TEXTURE_RGB: case EGL.BIND_TO_TEXTURE_RGBA: return 0;
    case EGL.MIN_SWAP_INTERVAL: return 0; case EGL.MAX_SWAP_INTERVAL: return 1; case EGL.LUMINANCE_SIZE: case EGL.ALPHA_MASK_SIZE: return 0; case EGL.COLOR_BUFFER_TYPE: return EGL.RGB_BUFFER;
    case EGL.RENDERABLE_TYPE: case EGL.CONFORMANT: return EGL.ES2_BIT | EGL.ES3_BIT; case EGL.RECORDABLE_ANDROID: case EGL.FRAMEBUFFER_TARGET_ANDROID: return 1;
    default: return undefined;
  }
}
const AT_LEAST = new Set([EGL.BUFFER_SIZE, EGL.RED_SIZE, EGL.GREEN_SIZE, EGL.BLUE_SIZE, EGL.ALPHA_SIZE, EGL.DEPTH_SIZE, EGL.STENCIL_SIZE, EGL.SAMPLES, EGL.SAMPLE_BUFFERS, EGL.LUMINANCE_SIZE, EGL.ALPHA_MASK_SIZE]);
const MASK = new Set([EGL.SURFACE_TYPE, EGL.RENDERABLE_TYPE, EGL.CONFORMANT]);
const IGNORED = new Set([EGL.MAX_PBUFFER_WIDTH, EGL.MAX_PBUFFER_HEIGHT, EGL.MAX_PBUFFER_PIXELS, EGL.NATIVE_VISUAL_ID]);   // EGL 1.4 3.4.1: ignored by eglChooseConfig
/** eglChooseConfig (EGL 1.4 section 3.4.1): the configs that match an attribute list, in the specified sort order. Returns null for a bad attribute. */
export function chooseConfigs(attributes) {
  const wanted = new Map([[EGL.SURFACE_TYPE, EGL.WINDOW_BIT], [EGL.RENDERABLE_TYPE, 0x1 /* EGL_OPENGL_ES_BIT */]]);
  for (let i = 0; i + 1 < attributes.length && attributes[i] !== EGL.NONE; i += 2) { if (configAttribute(EGL_CONFIGS[0], attributes[i]) === undefined && !IGNORED.has(attributes[i]) && attributes[i] !== EGL.MATCH_NATIVE_PIXMAP && attributes[i] !== EGL.CONFIG_CAVEAT) return null; wanted.set(attributes[i], attributes[i + 1]); }
  if (wanted.has(EGL.CONFIG_ID) && wanted.get(EGL.CONFIG_ID) !== EGL.DONT_CARE) return EGL_CONFIGS.filter(c => c.id === wanted.get(EGL.CONFIG_ID));
  const matches = EGL_CONFIGS.filter(config => [...wanted].every(([attribute, value]) => {
    if (value === EGL.DONT_CARE || IGNORED.has(attribute)) return true;
    const own = configAttribute(config, attribute); if (own === undefined) return true;
    return AT_LEAST.has(attribute) ? own >= value : MASK.has(attribute) ? (own & value) === value : own === value;
  }));
  const colour = config => ['r', 'g', 'b', 'a'].reduce((sum, key, i) => sum + ((wanted.get([EGL.RED_SIZE, EGL.GREEN_SIZE, EGL.BLUE_SIZE, EGL.ALPHA_SIZE][i]) ?? 0) > 0 ? config[key] : 0), 0);
  return matches.sort((a, b) => colour(b) - colour(a) || configAttribute(a, EGL.BUFFER_SIZE) - configAttribute(b, EGL.BUFFER_SIZE) || a.depth - b.depth || a.stencil - b.stencil || a.id - b.id);
}

// ---- GL constants used by the translation ----------------------------------------------------------------------------------------------------------------------------------
const GL = { NO_ERROR: 0, INVALID_ENUM: 0x500, INVALID_VALUE: 0x501, INVALID_OPERATION: 0x502, OUT_OF_MEMORY: 0x505, FRAMEBUFFER: 0x8D40, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9,
  RENDERBUFFER: 0x8D41, COLOR_ATTACHMENT0: 0x8CE0, DEPTH_ATTACHMENT: 0x8D00, STENCIL_ATTACHMENT: 0x8D20, DEPTH_STENCIL_ATTACHMENT: 0x821A, BACK: 0x405, NONE: 0, COLOR: 0x1800, DEPTH: 0x1801, STENCIL: 0x1802,
  RGBA8: 0x8058, RGB8: 0x8051, RGB565: 0x8D62, DEPTH24_STENCIL8: 0x88F0, DEPTH_COMPONENT16: 0x81A5, COLOR_BUFFER_BIT: 0x4000, NEAREST: 0x2600, ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
  STREAM_DRAW: 0x88E0, FRAMEBUFFER_BINDING: 0x8CA6, READ_FRAMEBUFFER_BINDING: 0x8CAA, RENDERBUFFER_BINDING: 0x8CA7, ARRAY_BUFFER_BINDING: 0x8894, ELEMENT_ARRAY_BUFFER_BINDING: 0x8895,
  CURRENT_PROGRAM: 0x8B8D, TEXTURE_BINDING_2D: 0x8069, TEXTURE_BINDING_CUBE_MAP: 0x8514, TEXTURE_BINDING_3D: 0x806A, TEXTURE_BINDING_2D_ARRAY: 0x8C1D, VERTEX_ARRAY_BINDING: 0x85B5, SAMPLER_BINDING: 0x8919,
  COPY_READ_BUFFER_BINDING: 0x8F36, COPY_WRITE_BUFFER_BINDING: 0x8F37, PIXEL_PACK_BUFFER_BINDING: 0x88ED, PIXEL_UNPACK_BUFFER_BINDING: 0x88EF, TRANSFORM_FEEDBACK_BUFFER_BINDING: 0x8C8F,
  UNIFORM_BUFFER_BINDING: 0x8A28, TRANSFORM_FEEDBACK_BINDING: 0x8E25, VERSION: 0x1F02, VENDOR: 0x1F00, RENDERER: 0x1F01, EXTENSIONS: 0x1F03, SHADING_LANGUAGE_VERSION: 0x8B8C,
  NUM_EXTENSIONS: 0x821D, MAJOR_VERSION: 0x821B, MINOR_VERSION: 0x821C, NUM_COMPRESSED_TEXTURE_FORMATS: 0x86A2, COMPRESSED_TEXTURE_FORMATS: 0x86A3, NUM_SHADER_BINARY_FORMATS: 0x8DF9,
  SHADER_BINARY_FORMATS: 0x8DF8, NUM_PROGRAM_BINARY_FORMATS: 0x87FE, PROGRAM_BINARY_FORMATS: 0x87FF, SHADER_COMPILER: 0x8DFA, INFO_LOG_LENGTH: 0x8B84, SHADER_SOURCE_LENGTH: 0x8B88,
  ACTIVE_UNIFORM_MAX_LENGTH: 0x8B87, ACTIVE_ATTRIBUTE_MAX_LENGTH: 0x8B8A, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B89, TRANSFORM_FEEDBACK_VARYING_MAX_LENGTH: 0x8C76,
  ACTIVE_UNIFORM_BLOCK_MAX_NAME_LENGTH: 0x8A35, PROGRAM_BINARY_LENGTH: 0x8741, FRAMEBUFFER_COMPLETE: 0x8CD5, FRAMEBUFFER_UNDEFINED: 0x8219, VIEWPORT: 0x0BA2, SCISSOR_BOX: 0x0C10,
  UNSIGNED_BYTE: 0x1401, BYTE: 0x1400, UNSIGNED_SHORT: 0x1403, SHORT: 0x1402, UNSIGNED_INT: 0x1405, INT: 0x1404, FLOAT: 0x1406, HALF_FLOAT: 0x140B, FIXED: 0x140C,
  UNSIGNED_SHORT_5_6_5: 0x8363, UNSIGNED_SHORT_4_4_4_4: 0x8033, UNSIGNED_SHORT_5_5_5_1: 0x8034, UNSIGNED_INT_2_10_10_10_REV: 0x8368, UNSIGNED_INT_10F_11F_11F_REV: 0x8C3B,
  UNSIGNED_INT_5_9_9_9_REV: 0x8C3E, UNSIGNED_INT_24_8: 0x84FA, FLOAT_32_UNSIGNED_INT_24_8_REV: 0x8DAD, INT_2_10_10_10_REV: 0x8D9F, SYNC_STATUS: 0x9114, OBJECT_TYPE: 0x9112, SYNC_CONDITION: 0x9113,
  SYNC_FLAGS: 0x9115, TIMEOUT_IGNORED: -1n, FRAMEBUFFER_ATTACHMENT_OBJECT_NAME: 0x8CD1, FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE: 0x8CD0 };
// pname -> the object kind getParameter answers with for it (mapped back to the app's name)
const OBJECT_PNAMES = new Map([[GL.ARRAY_BUFFER_BINDING, 'buffer'], [GL.ELEMENT_ARRAY_BUFFER_BINDING, 'buffer'], [GL.COPY_READ_BUFFER_BINDING, 'buffer'], [GL.COPY_WRITE_BUFFER_BINDING, 'buffer'],
  [GL.PIXEL_PACK_BUFFER_BINDING, 'buffer'], [GL.PIXEL_UNPACK_BUFFER_BINDING, 'buffer'], [GL.TRANSFORM_FEEDBACK_BUFFER_BINDING, 'buffer'], [GL.UNIFORM_BUFFER_BINDING, 'buffer'],
  [GL.RENDERBUFFER_BINDING, 'renderbuffer'], [GL.CURRENT_PROGRAM, 'object'], [GL.TEXTURE_BINDING_2D, 'texture'], [GL.TEXTURE_BINDING_CUBE_MAP, 'texture'], [GL.TEXTURE_BINDING_3D, 'texture'],
  [GL.TEXTURE_BINDING_2D_ARRAY, 'texture'], [GL.VERTEX_ARRAY_BINDING, 'vertexArray'], [GL.SAMPLER_BINDING, 'sampler'], [GL.TRANSFORM_FEEDBACK_BINDING, 'transformFeedback']]);
/** WebGL extension -> the OpenGL ES extension string it stands for (GL_EXTENSIONS lists only these, and only when the browser has them). */
const EXTENSIONS = { EXT_color_buffer_float: 'GL_EXT_color_buffer_float', EXT_color_buffer_half_float: 'GL_EXT_color_buffer_half_float', EXT_texture_filter_anisotropic: 'GL_EXT_texture_filter_anisotropic',
  OES_texture_float_linear: 'GL_OES_texture_float_linear', WEBGL_compressed_texture_s3tc: 'GL_EXT_texture_compression_s3tc', WEBGL_compressed_texture_s3tc_srgb: 'GL_EXT_texture_compression_s3tc_srgb',
  WEBGL_compressed_texture_etc1: 'GL_OES_compressed_ETC1_RGB8_texture', WEBGL_compressed_texture_astc: 'GL_KHR_texture_compression_astc_ldr', EXT_texture_compression_bptc: 'GL_EXT_texture_compression_bptc',
  EXT_texture_compression_rgtc: 'GL_EXT_texture_compression_rgtc', EXT_float_blend: 'GL_EXT_float_blend', OES_draw_buffers_indexed: 'GL_OES_draw_buffers_indexed', EXT_texture_norm16: 'GL_EXT_texture_norm16' };

// ---- java.nio buffers and Java arrays (NIOAccess of the original JNI) -------------------------------------------------------------------------------------------------------
const ELEMENT = { B: 1, Z: 1, C: 2, S: 2, I: 4, F: 4, J: 8, D: 8 };
const BUFFER_ELEMENT = [['Ljava/nio/ByteBuffer;', 'B'], ['Ljava/nio/CharBuffer;', 'C'], ['Ljava/nio/ShortBuffer;', 'S'], ['Ljava/nio/IntBuffer;', 'I'], ['Ljava/nio/FloatBuffer;', 'F'], ['Ljava/nio/LongBuffer;', 'J'], ['Ljava/nio/DoubleBuffer;', 'D']];
/** Where the remaining elements of a java.nio.Buffer are: { native: address } or { array, index (in array elements), type }, and how many bytes remain. */
export function nioRegion(r, buffer) {
  if (buffer === null || buffer === undefined) return null;
  const fields = r.object(buffer).fields, get = key => fields.get(key);
  const position = get(`${BUFFER}->position:I`) ?? 0, limit = get(`${BUFFER}->limit:I`) ?? 0, shift = get(`${BUFFER}->_elementSizeShift:I`) ?? 0;
  const bytes = Math.max(0, limit - position) << shift, address = BigInt.asIntN(64, BigInt(get(`${BUFFER}->address:J`) ?? 0n));
  if (address !== 0n) return { address: address + BigInt(position << shift), bytes };
  for (const [owner, type] of BUFFER_ELEMENT) {
    const array = get(`${owner}->hb:[${type}`); if (array === undefined) continue;
    if (array === null || array === 0) break;
    return { array, index: (get(`${owner}->offset:I`) ?? 0) + position, type, bytes };
  }
  // a view of a heap ByteBuffer (ByteBufferAs<Type>Buffer): its bytes are the ByteBuffer's array at the view's byte offset
  for (const [key, value] of fields) {
    if (!key.endsWith('->bb:Ljava/nio/ByteBuffer;') || value === null || value === 0) continue;
    const owner = key.slice(0, key.indexOf('->')), base = nioRegion(r, value); if (!base?.array) break;
    const bf = r.object(value).fields, start = (bf.get('Ljava/nio/ByteBuffer;->offset:I') ?? 0) + (fields.get(`${owner}->offset:I`) ?? 0) + (position << shift);
    return { array: base.array, index: start, type: 'B', bytes };
  }
  r.throwJava(IAE, 'Must use a native order direct Buffer');
}
/** The bytes of a Java array range (elements stored as JS numbers: floats as their int bits, longs and doubles as bigint bits), little-endian. */
function arrayBytes(r, array, type, index, byteCount) {
  const elements = r.array(array).elements, size = ELEMENT[type], count = Math.ceil(byteCount / size), out = new Uint8Array(count * size), view = new DataView(out.buffer);
  for (let i = 0; i < count; i++) {
    const v = elements[index + i] ?? 0, at = i * size;
    if (size === 1) out[at] = v & 255; else if (size === 2) view.setUint16(at, v & 0xffff, true); else if (size === 4) view.setInt32(at, v | 0, true); else view.setBigInt64(at, BigInt.asIntN(64, BigInt(v)), true);
  }
  return byteCount === out.length ? out : out.subarray(0, byteCount);
}
function writeArrayBytes(r, array, type, index, bytes) {
  const elements = r.array(array).elements, size = ELEMENT[type], view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i * size + size <= bytes.length; i++) {
    const at = i * size;
    elements[index + i] = size === 1 ? (bytes[at] << 24) >> 24 : size === 2 ? (type === 'C' ? view.getUint16(at, true) : view.getInt16(at, true)) : size === 4 ? view.getInt32(at, true) : view.getBigInt64(at, true);
  }
}
/** The remaining bytes of a Buffer, or of a Java array from `offset` (in elements), at most `limit` bytes. */
function readRegion(r, region, limit = Infinity) {
  const count = Math.min(region.bytes, limit);
  return region.address !== undefined ? readNativeBytes(r, region.address, count) : arrayBytes(r, region.array, region.type, region.index, count);
}
function writeRegion(r, region, bytes) {
  if (bytes.length > region.bytes) r.throwJava(IAE, 'remaining() < needed');
  if (region.address !== undefined) writeNativeBytes(r, region.address, bytes); else writeArrayBytes(r, region.array, region.type, region.index, bytes);
}
const arrayRegion = (r, array, offset, type) => {
  if (array === null) r.throwJava(IAE, `${type === 'F' ? 'params' : 'array'} == null`);
  if (offset < 0) r.throwJava(IAE, 'offset < 0');
  const length = r.array(array).elements.length; if (offset > length) r.throwJava(IAE, 'length - offset < needed');
  return { array, index: offset, type, bytes: (length - offset) * ELEMENT[type] };
};
const typed = (bytes, Type) => { const copy = bytes.byteOffset % Type.BYTES_PER_ELEMENT ? bytes.slice() : bytes; return new Type(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / Type.BYTES_PER_ELEMENT)); };
/** The typed array WebGL wants for pixel data of a GL `type`. */
const pixelArray = (bytes, type) => {
  switch (type) {
    case GL.UNSIGNED_BYTE: return bytes; case GL.BYTE: return typed(bytes, Int8Array); case GL.SHORT: return typed(bytes, Int16Array); case GL.INT: return typed(bytes, Int32Array); case GL.FLOAT: return typed(bytes, Float32Array);
    case GL.UNSIGNED_INT: case GL.UNSIGNED_INT_2_10_10_10_REV: case GL.UNSIGNED_INT_10F_11F_11F_REV: case GL.UNSIGNED_INT_5_9_9_9_REV: case GL.UNSIGNED_INT_24_8: return typed(bytes, Uint32Array);
    default: return typed(bytes, Uint16Array);   // UNSIGNED_SHORT, HALF_FLOAT and the packed 16-bit types
  }
};
const floats = bytes => typed(bytes, Float32Array), ints = bytes => typed(bytes, Int32Array), uints = bytes => typed(bytes, Uint32Array);
const f = bits => bitsFloat(bits);

// ---- per-runtime state -----------------------------------------------------------------------------------------------------------------------------------------------------
const states = new WeakMap();
const NAMESPACES = ['buffer', 'texture', 'framebuffer', 'renderbuffer', 'object', 'sampler', 'query', 'transformFeedback'];
/** The WebGL2 backend of the platform: runtime.platform.glBackend ({ createContext() -> { gl, canvas } }), or one over OffscreenCanvas where the global has it. */
function backendOf(r) {
  const own = r.platform?.glBackend; if (own) return own;
  if (typeof OffscreenCanvas !== 'function') return null;
  return { createContext(attributes) { const canvas = new OffscreenCanvas(1, 1), gl = canvas.getContext('webgl2', attributes); return gl ? { gl, canvas } : null; } };
}
function stateOf(r) {
  let s = states.get(r);
  if (!s) {
    s = { initialized: false, initCount: 0, contexts: new Map(), surfaces: new Map(), current: new WeakMap(), errors: new WeakMap(), next: 1n, groups: [], unavailable: null };
    states.set(r, s);
  }
  return s;
}
const threadOf = r => r.thread ?? r.scheduler?.mainThread?.() ?? r;
const setEglError = (r, error) => { stateOf(r).errors.set(threadOf(r), error); };
const eglFail = (r, error, value = 0) => { setEglError(r, error); return value; };
const eglOk = (r, value = 1) => { setEglError(r, EGL.SUCCESS); return value; };
const currentOf = r => stateOf(r).current.get(threadOf(r)) ?? null;

function newGroup(r, created) {
  const gl = created.gl, group = { gl, canvas: created.canvas, names: Object.fromEntries(NAMESPACES.map(kind => [kind, new Map()])), reverse: new WeakMap(), next: Object.fromEntries(NAMESPACES.map(kind => [kind, 1])),
    uniforms: new Map(), syncs: new Map(), nextSync: 1n, scratch: new Map(), extensions: [], renderer: null };
  for (const name of gl.getSupportedExtensions?.() ?? []) { if (!EXTENSIONS[name]) continue; try { if (gl.getExtension(name)) group.extensions.push(EXTENSIONS[name]); } catch { /* refused */ } }
  try { const info = gl.getExtension?.('WEBGL_debug_renderer_info'); if (info) group.renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL); } catch { /* hidden */ }
  for (const parameter of ['UNPACK_FLIP_Y_WEBGL', 'UNPACK_PREMULTIPLY_ALPHA_WEBGL']) if (gl[parameter] !== undefined) gl.pixelStorei(gl[parameter], false);
  if (gl.UNPACK_COLORSPACE_CONVERSION_WEBGL !== undefined) gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE ?? 0);
  return group;
}
function newContext(r, config, version, share) {
  const s = stateOf(r);
  let group = share?.group;
  if (!group) {
    const backend = backendOf(r); const created = backend?.createContext({ alpha: true, depth: false, stencil: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!created) return null;
    group = newGroup(r, created); s.groups.push(group);
  }
  const handle = 0x2000n + s.next++;
  const context = { handle, config, version, group, gl: group.gl, thread: null, draw: null, read: null, appDraw: 0, appRead: 0, program: 0, vertexArrays: new Map(), nextVertexArray: 1, error: GL.NO_ERROR,
    viewportSet: false, clientAttribs: new Map(), destroyed: false };
  s.contexts.set(handle, context); return context;
}

// ---- surfaces: a framebuffer object per surface and WebGL context ------------------------------------------------------------------------------------------------------------
/** The SurfaceView behind a Surface (src/camera-surface-host.js) and its size now. */
function windowOf(r, surface) {
  const sink = surface === null ? null : r.object(surface).surface?.sink;
  if (!sink || sink.kind !== 'holder' || !sink.valid?.()) return null;
  return sink.view;
}
function surfaceSize(r, surface) {
  if (surface.kind !== 'window') return { width: surface.width, height: surface.height };
  const view = r.object(surface.view), state = view.surfaceView, b = view.bounds, fixed = state?.fixed;
  return fixed ?? (b ? { width: Math.max(1, b.right - b.left), height: Math.max(1, b.bottom - b.top) } : { width: 1, height: 1 });
}
function surfaceTarget(r, context, surface) {
  const gl = context.gl; let entry = surface.targets.get(gl);
  const { width, height } = surfaceSize(r, surface);
  if (!entry) { entry = { framebuffer: gl.createFramebuffer(), color: gl.createRenderbuffer(), depth: null, width: 0, height: 0 }; surface.targets.set(gl, entry); }
  if (entry.width !== width || entry.height !== height) {
    const c = surface.config, previousRb = gl.getParameter(gl.RENDERBUFFER_BINDING), previousFb = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    gl.bindRenderbuffer(gl.RENDERBUFFER, entry.color); gl.renderbufferStorage(gl.RENDERBUFFER, c.r === 5 ? GL.RGB565 : c.a ? GL.RGBA8 : GL.RGB8, width, height);
    if (c.depth || c.stencil) { entry.depth ??= gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, entry.depth); gl.renderbufferStorage(gl.RENDERBUFFER, c.stencil ? GL.DEPTH24_STENCIL8 : GL.DEPTH_COMPONENT16, width, height); }
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, entry.framebuffer);
    gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, GL.COLOR_ATTACHMENT0, gl.RENDERBUFFER, entry.color);
    if (entry.depth) gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, c.stencil ? GL.DEPTH_STENCIL_ATTACHMENT : GL.DEPTH_ATTACHMENT, gl.RENDERBUFFER, entry.depth);
    gl.bindRenderbuffer(gl.RENDERBUFFER, previousRb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousFb);
    entry.width = width; entry.height = height;
  }
  return entry;
}
/** Binds what the app's framebuffer bindings mean now: its own framebuffers, or the current surfaces' for name 0. */
function applyFramebuffers(r, context) {
  const gl = context.gl;
  const resolve = (name, surface) => name ? context.group.names.framebuffer.get(name) ?? null : surface ? surfaceTarget(r, context, surface).framebuffer : null;
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolve(context.appDraw, context.draw)); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, resolve(context.appRead, context.read));
}
function releaseSurface(r, surface) {
  for (const [gl, entry] of surface.targets) { gl.deleteFramebuffer(entry.framebuffer); gl.deleteRenderbuffer(entry.color); if (entry.depth) gl.deleteRenderbuffer(entry.depth); }
  surface.targets.clear();
  if (surface.kind === 'window') { const view = r.object(surface.view); if (view.surfaceView?.gl === surface) view.surfaceView.gl = null; }
}

// ---- the GL entry points -----------------------------------------------------------------------------------------------------------------------------------------------------
/** The calling thread's current context, or null (an ES call without one does nothing and answers zero, as a device's GL does: it logs "call to OpenGL ES API with no current context"). */
function glFor(r, name) {
  const context = currentOf(r)?.context ?? null;
  if (!context) { const s = stateOf(r); if (!s.warnedNoContext) { s.warnedNoContext = true; r.record?.(`GL ${name}: call to OpenGL ES API with no current context`); } }
  return context;
}
const raise = (context, error) => { if (context.error === GL.NO_ERROR) context.error = error; };
const nameOf = (context, kind, object) => object ? context.group.reverse.get(object) ?? 0 : 0;
const objectOf = (context, kind, name) => name ? context.group.names[kind].get(name) ?? null : null;
function lookup(context, kind, name) { if (!name) return null; const object = context.group.names[kind].get(name); if (!object) { raise(context, GL.INVALID_OPERATION); return undefined; } return object; }
function genNames(context, kind, count, create) {
  const group = context.group, names = [];
  for (let i = 0; i < count; i++) { const name = group.next[kind]++, object = create(); group.names[kind].set(name, object); group.reverse.set(object, name); names.push(name); }
  return names;
}
function deleteName(context, kind, name, destroy) { const object = context.group.names[kind].get(name); if (!object) return; context.group.names[kind].delete(name); destroy(object); context.group.uniforms.delete(name); }
/** The uniform location objects of a program: integer locations handed to the app, per program (invalidated by a new link). */
function uniformTable(context, program) { let table = context.group.uniforms.get(program); if (!table) { table = { byName: new Map(), locations: [] }; context.group.uniforms.set(program, table); } return table; }
const location = (context, loc) => { if (loc === -1) return null; const table = context.group.uniforms.get(context.program); const object = table?.locations[loc]; if (!object) { raise(context, GL.INVALID_OPERATION); return undefined; } return object; };
/** A pname answer of getParameter as the numbers glGet*v writes. */
function parameterValues(context, pname) {
  const gl = context.gl;
  switch (pname) {
    case GL.MAJOR_VERSION: return [3]; case GL.MINOR_VERSION: return [0];
    case GL.NUM_EXTENSIONS: return [context.group.extensions.length];
    case GL.NUM_COMPRESSED_TEXTURE_FORMATS: return [(gl.getParameter(GL.COMPRESSED_TEXTURE_FORMATS) ?? []).length];
    case GL.NUM_SHADER_BINARY_FORMATS: case GL.NUM_PROGRAM_BINARY_FORMATS: return [0];
    case GL.SHADER_BINARY_FORMATS: case GL.PROGRAM_BINARY_FORMATS: return [];
    case GL.SHADER_COMPILER: return [1];
    case GL.FRAMEBUFFER_BINDING: return [context.appDraw]; case GL.READ_FRAMEBUFFER_BINDING: return [context.appRead];
    case GL.VERTEX_ARRAY_BINDING: { const object = gl.getParameter(pname); for (const [name, vao] of context.vertexArrays) if (vao === object) return [name]; return [0]; }
    case GL.CURRENT_PROGRAM: return [context.program];
  }
  const value = gl.getParameter(pname);
  if (value === null || value === undefined) return OBJECT_PNAMES.has(pname) ? [0] : null;
  if (OBJECT_PNAMES.has(pname)) return [nameOf(context, OBJECT_PNAMES.get(pname), value)];
  if (typeof value === 'number') return [value]; if (typeof value === 'boolean') return [value ? 1 : 0];
  if (ArrayBuffer.isView(value) || Array.isArray(value)) return Array.from(value, v => typeof v === 'boolean' ? (v ? 1 : 0) : Number(v));
  if (typeof value === 'string') return null;
  return [nameOf(context, 'object', value)];
}
const bytesOfInts = values => { const out = new Uint8Array(values.length * 4), view = new DataView(out.buffer); values.forEach((v, i) => view.setInt32(i * 4, v | 0, true)); return out; };
const bytesOfFloats = values => { const out = new Uint8Array(values.length * 4), view = new DataView(out.buffer); values.forEach((v, i) => view.setFloat32(i * 4, v, true)); return out; };
const bytesOfLongs = values => { const out = new Uint8Array(values.length * 8), view = new DataView(out.buffer); values.forEach((v, i) => view.setBigInt64(i * 8, BigInt(Math.trunc(Number(v))), true)); return out; };
/** The default framebuffer's attachment names on the lab's surface object (GL_BACK, GL_COLOR, GL_DEPTH, GL_STENCIL). */
const defaultAttachment = value => value === GL.BACK || value === GL.COLOR ? GL.COLOR_ATTACHMENT0 : value === GL.DEPTH ? GL.DEPTH_ATTACHMENT : value === GL.STENCIL ? GL.STENCIL_ATTACHMENT : value;
const framebufferIsDefault = (context, target) => (target === GL.READ_FRAMEBUFFER ? context.appRead : context.appDraw) === 0;

/** The client-side vertex arrays of the current draw, uploaded to scratch buffers (ES 2.0 allows a Java Buffer as glVertexAttribPointer's pointer; WebGL does not). */
function uploadClientArrays(r, context, vertexCount) {
  if (!context.clientAttribs.size) return null;
  const gl = context.gl, previous = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
  for (const [index, a] of context.clientAttribs) {
    const size = ELEMENT_OF_TYPE[a.type] ?? 4, stride = a.stride || size * a.size, needed = vertexCount ? (vertexCount - 1) * stride + size * a.size : 0;
    let scratch = context.group.scratch.get(index); if (!scratch) { scratch = gl.createBuffer(); context.group.scratch.set(index, scratch); }
    gl.bindBuffer(gl.ARRAY_BUFFER, scratch); gl.bufferData(gl.ARRAY_BUFFER, readRegion(r, a.region, Math.max(needed, 0)), gl.STREAM_DRAW);
    if (a.integer) gl.vertexAttribIPointer(index, a.size, a.type, a.stride, 0); else gl.vertexAttribPointer(index, a.size, a.type, a.normalized, a.stride, 0);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, previous); return true;
}
const ELEMENT_OF_TYPE = { [GL.BYTE]: 1, [GL.UNSIGNED_BYTE]: 1, [GL.SHORT]: 2, [GL.UNSIGNED_SHORT]: 2, [GL.HALF_FLOAT]: 2, [GL.INT]: 4, [GL.UNSIGNED_INT]: 4, [GL.FLOAT]: 4, [GL.FIXED]: 4, [GL.INT_2_10_10_10_REV]: 4, [GL.UNSIGNED_INT_2_10_10_10_REV]: 4 };
function maxIndex(bytes, type) { const values = type === GL.UNSIGNED_BYTE ? bytes : type === GL.UNSIGNED_SHORT ? typed(bytes, Uint16Array) : typed(bytes, Uint32Array); let max = -1; for (const v of values) if (v > max) max = v; return max; }
/** glDrawElements with a Java Buffer of indices: uploaded to a scratch element buffer (restored after the draw, as the VAO's binding). */
function drawClientElements(r, context, mode, count, type, indices, draw) {
  const gl = context.gl, bytes = readRegion(r, nioRegion(r, indices), count * (ELEMENT_OF_TYPE[type] ?? 2));
  let scratch = context.group.scratch.get('elements'); if (!scratch) { scratch = gl.createBuffer(); context.group.scratch.set('elements', scratch); }
  const previous = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, scratch); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bytes, gl.STREAM_DRAW);
  uploadClientArrays(r, context, maxIndex(bytes, type) + 1); draw(0); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, previous);
}

/** Bindings of the GLES20 / GLES30 natives: Map 'owner->name(signature)' -> (runtime, args). */
function glesBindings(add) {
  // add(owner, 'name', 'signature', (r, context, gl, args) => value, default) -- runs only with a current context; without one answers `fallback`
  const S20 = (name, signature, body, fallback = 0) => add(GLES20, name, signature, body, fallback), S30 = (name, signature, body, fallback = 0) => add(GLES30, name, signature, body, fallback);
  const both = (S, name, signatures, body) => { for (const signature of signatures) S(name, signature, body); };
  // pointer-like arguments: an array with an offset, or a java.nio Buffer (the next argument when it is an array)
  const vec = (r, args, i, type) => typeof args[i + 1] === 'number' && args.length > i + 1 && isArrayRef(r, args[i]) ? arrayRegion(r, args[i], args[i + 1], type) : args[i] === null ? r.throwJava(IAE, `${type === 'F' ? 'params' : 'data'} == null`) : nioRegion(r, args[i]);
  const isArrayRef = (r, value) => value !== null && typeof value === 'object' && r.typeOf(value).startsWith('[');
  const readInts = (r, args, i, count) => Array.from(ints(readRegion(r, vec(r, args, i, 'I'), count * 4)));
  const writeVec = (r, args, i, type, values, kind = 'int') => { const region = vec(r, args, i, type); writeRegion(r, region, kind === 'float' ? bytesOfFloats(values) : kind === 'long' ? bytesOfLongs(values) : bytesOfInts(values)); };
  const unsupported = (S, name, signatures, why) => { for (const signature of signatures) S(name, signature, r => r.throwJava(UOE, `${name}: ${why}`)); };

  // ---- state ----
  for (const [name, method, sig] of [['glActiveTexture', 'activeTexture', '(I)V'], ['glBlendEquation', 'blendEquation', '(I)V'], ['glBlendEquationSeparate', 'blendEquationSeparate', '(II)V'], ['glBlendFunc', 'blendFunc', '(II)V'],
    ['glBlendFuncSeparate', 'blendFuncSeparate', '(IIII)V'], ['glClear', 'clear', '(I)V'], ['glClearStencil', 'clearStencil', '(I)V'], ['glCullFace', 'cullFace', '(I)V'], ['glDepthFunc', 'depthFunc', '(I)V'],
    ['glDisable', 'disable', '(I)V'], ['glEnable', 'enable', '(I)V'], ['glDisableVertexAttribArray', 'disableVertexAttribArray', '(I)V'], ['glEnableVertexAttribArray', 'enableVertexAttribArray', '(I)V'],
    ['glFinish', 'finish', '()V'], ['glFlush', 'flush', '()V'], ['glFrontFace', 'frontFace', '(I)V'], ['glGenerateMipmap', 'generateMipmap', '(I)V'], ['glHint', 'hint', '(II)V'], ['glPixelStorei', 'pixelStorei', '(II)V'],
    ['glScissor', 'scissor', '(IIII)V'], ['glStencilFunc', 'stencilFunc', '(III)V'], ['glStencilFuncSeparate', 'stencilFuncSeparate', '(IIII)V'], ['glStencilMask', 'stencilMask', '(I)V'],
    ['glStencilMaskSeparate', 'stencilMaskSeparate', '(II)V'], ['glStencilOp', 'stencilOp', '(III)V'], ['glStencilOpSeparate', 'stencilOpSeparate', '(IIII)V'], ['glViewport', 'viewport', '(IIII)V'],
    ['glCopyTexImage2D', 'copyTexImage2D', '(IIIIIIII)V'], ['glCopyTexSubImage2D', 'copyTexSubImage2D', '(IIIIIIII)V'], ['glRenderbufferStorage', 'renderbufferStorage', '(IIII)V'], ['glTexParameteri', 'texParameteri', '(III)V'],
    ['glDrawArrays', null, '(III)V']]) {
    if (!method) continue; S20(name, sig, (r, c, gl, args) => { gl[method](...args); });
  }
  for (const [name, method, sig] of [['glBlendColor', 'blendColor', '(FFFF)V'], ['glClearColor', 'clearColor', '(FFFF)V'], ['glClearDepthf', 'clearDepth', '(F)V'], ['glDepthRangef', 'depthRange', '(FF)V'],
    ['glLineWidth', 'lineWidth', '(F)V'], ['glPolygonOffset', 'polygonOffset', '(FF)V'], ['glVertexAttrib1f', 'vertexAttrib1f', '(IF)V'], ['glVertexAttrib2f', 'vertexAttrib2f', '(IFF)V'], ['glVertexAttrib3f', 'vertexAttrib3f', '(IFFF)V'],
    ['glVertexAttrib4f', 'vertexAttrib4f', '(IFFFF)V'], ['glTexParameterf', 'texParameterf', '(IIF)V']]) {
    const params = sig.slice(1, sig.indexOf(')')); S20(name, sig, (r, c, gl, args) => { gl[method](...args.map((v, i) => params[i] === 'F' ? f(v) : v)); });
  }
  S20('glColorMask', '(ZZZZ)V', (r, c, gl, args) => { gl.colorMask(...args.map(v => !!v)); });
  S20('glDepthMask', '(Z)V', (r, c, gl, [flag]) => { gl.depthMask(!!flag); });
  S20('glSampleCoverage', '(FZ)V', (r, c, gl, [value, invert]) => { gl.sampleCoverage(f(value), !!invert); });
  S20('glIsEnabled', '(I)Z', (r, c, gl, [cap]) => gl.isEnabled(cap) ? 1 : 0);
  S20('glReleaseShaderCompiler', '()V', () => {});
  S20('glGetError', '()I', (r, c, gl) => { const own = c.error; if (own !== GL.NO_ERROR) { c.error = GL.NO_ERROR; return own; } return gl.getError(); });
  S20('glDrawArrays', '(III)V', (r, c, gl, [mode, first, count]) => { uploadClientArrays(r, c, first + count); gl.drawArrays(mode, first, count); });
  S20('glDrawElements', '(IIII)V', (r, c, gl, [mode, count, type, offset]) => { if (c.clientAttribs.size) r.throwJava(UOE, 'glDrawElements: client-side vertex arrays with an element buffer object are not supported'); gl.drawElements(mode, count, type, offset); });
  S20('glDrawElements', `(III${BUFFER})V`, (r, c, gl, [mode, count, type, indices]) => drawClientElements(r, c, mode, count, type, indices, offset => gl.drawElements(mode, count, type, offset)));
  for (const [sig, kind] of [[`(II${STRING})V`, null]]) S20('glBindAttribLocation', sig, (r, c, gl, [program, index, name]) => { const p = lookup(c, 'object', program); if (p) gl.bindAttribLocation(p, index, name); });
  // ---- objects ----
  const genDelete = (S, noun, kind, create, destroy, extra = {}) => {
    both(S, `glGen${noun}`, ['(I[II)V', `(I${INT_BUFFER})V`], (r, c, gl, args) => { const [n] = args; if (n < 0) return raise(c, GL.INVALID_VALUE); writeVec(r, args, 1, 'I', genNames(c, kind, n, () => create(gl))); });
    both(S, `glDelete${noun}`, ['(I[II)V', `(I${INT_BUFFER})V`], (r, c, gl, args) => { const [n] = args; if (n < 0) return raise(c, GL.INVALID_VALUE); for (const name of readInts(r, args, 1, n)) if (name) { extra.before?.(c, name); deleteName(c, kind, name, object => destroy(gl, object)); } });
  };
  genDelete(S20, 'Buffers', 'buffer', gl => gl.createBuffer(), (gl, o) => gl.deleteBuffer(o));
  genDelete(S20, 'Textures', 'texture', gl => gl.createTexture(), (gl, o) => gl.deleteTexture(o));
  genDelete(S20, 'Framebuffers', 'framebuffer', gl => gl.createFramebuffer(), (gl, o) => gl.deleteFramebuffer(o), { before: (c, name) => { if (c.appDraw === name) c.appDraw = 0; if (c.appRead === name) c.appRead = 0; } });
  genDelete(S20, 'Renderbuffers', 'renderbuffer', gl => gl.createRenderbuffer(), (gl, o) => gl.deleteRenderbuffer(o));
  genDelete(S30, 'Samplers', 'sampler', gl => gl.createSampler(), (gl, o) => gl.deleteSampler(o));
  genDelete(S30, 'Queries', 'query', gl => gl.createQuery(), (gl, o) => gl.deleteQuery(o));
  genDelete(S30, 'TransformFeedbacks', 'transformFeedback', gl => gl.createTransformFeedback(), (gl, o) => gl.deleteTransformFeedback(o));
  // vertex arrays are per context, not shared (ES 3.0 D.1)
  both(S30, 'glGenVertexArrays', ['(I[II)V', `(I${INT_BUFFER})V`], (r, c, gl, args) => { const names = []; for (let i = 0; i < args[0]; i++) { const name = c.nextVertexArray++; c.vertexArrays.set(name, gl.createVertexArray()); names.push(name); } writeVec(r, args, 1, 'I', names); });
  both(S30, 'glDeleteVertexArrays', ['(I[II)V', `(I${INT_BUFFER})V`], (r, c, gl, args) => { for (const name of readInts(r, args, 1, args[0])) { const vao = c.vertexArrays.get(name); if (vao) { gl.deleteVertexArray(vao); c.vertexArrays.delete(name); } } });
  S30('glBindVertexArray', '(I)V', (r, c, gl, [name]) => { if (name && !c.vertexArrays.has(name)) return raise(c, GL.INVALID_OPERATION); gl.bindVertexArray(name ? c.vertexArrays.get(name) : null); c.clientAttribs = new Map(); });
  S30('glIsVertexArray', '(I)Z', (r, c, gl, [name]) => c.vertexArrays.has(name) ? 1 : 0);
  const isA = (S, name, kind, test) => S(name, '(I)Z', (r, c, gl, [n]) => { const o = objectOf(c, kind, n); return o && test(gl, o) ? 1 : 0; });
  isA(S20, 'glIsBuffer', 'buffer', (gl, o) => gl.isBuffer(o)); isA(S20, 'glIsTexture', 'texture', (gl, o) => gl.isTexture(o)); isA(S20, 'glIsFramebuffer', 'framebuffer', (gl, o) => gl.isFramebuffer(o));
  isA(S20, 'glIsRenderbuffer', 'renderbuffer', (gl, o) => gl.isRenderbuffer(o)); isA(S30, 'glIsSampler', 'sampler', (gl, o) => gl.isSampler(o)); isA(S30, 'glIsQuery', 'query', (gl, o) => gl.isQuery(o));
  isA(S30, 'glIsTransformFeedback', 'transformFeedback', (gl, o) => gl.isTransformFeedback(o));
  isA(S20, 'glIsShader', 'object', (gl, o) => gl.isShader(o)); isA(S20, 'glIsProgram', 'object', (gl, o) => gl.isProgram(o));
  // binding a name that was never generated creates it (ES 2.0/3.0 for buffers, textures, framebuffers, renderbuffers)
  const bindCreate = (c, gl, kind, name, create) => { if (!name) return null; let o = c.group.names[kind].get(name); if (!o) { o = create(gl); c.group.names[kind].set(name, o); c.group.reverse.set(o, name); c.group.next[kind] = Math.max(c.group.next[kind], name + 1); } return o; };
  S20('glBindBuffer', '(II)V', (r, c, gl, [target, name]) => { gl.bindBuffer(target, bindCreate(c, gl, 'buffer', name, g => g.createBuffer())); });
  S20('glBindTexture', '(II)V', (r, c, gl, [target, name]) => { gl.bindTexture(target, bindCreate(c, gl, 'texture', name, g => g.createTexture())); });
  S20('glBindRenderbuffer', '(II)V', (r, c, gl, [target, name]) => { gl.bindRenderbuffer(target, bindCreate(c, gl, 'renderbuffer', name, g => g.createRenderbuffer())); });
  S20('glBindFramebuffer', '(II)V', (r, c, gl, [target, name]) => {
    if (name) bindCreate(c, gl, 'framebuffer', name, g => g.createFramebuffer());
    if (target === GL.FRAMEBUFFER || target === GL.DRAW_FRAMEBUFFER) c.appDraw = name; if (target === GL.FRAMEBUFFER || target === GL.READ_FRAMEBUFFER) c.appRead = name;
    if (target !== GL.FRAMEBUFFER && target !== GL.DRAW_FRAMEBUFFER && target !== GL.READ_FRAMEBUFFER) return raise(c, GL.INVALID_ENUM);
    applyFramebuffers(r, c);
  });
  S30('glBindSampler', '(II)V', (r, c, gl, [unit, name]) => { const o = lookup(c, 'sampler', name); if (o !== undefined) gl.bindSampler(unit, o); });
  S30('glBindTransformFeedback', '(II)V', (r, c, gl, [target, name]) => { const o = lookup(c, 'transformFeedback', name); if (o !== undefined) gl.bindTransformFeedback(target, o); });
  S30('glBindBufferBase', '(III)V', (r, c, gl, [target, index, name]) => { gl.bindBufferBase(target, index, bindCreate(c, gl, 'buffer', name, g => g.createBuffer())); });
  S30('glBindBufferRange', '(IIIII)V', (r, c, gl, [target, index, name, offset, size]) => { gl.bindBufferRange(target, index, bindCreate(c, gl, 'buffer', name, g => g.createBuffer()), offset, size); });
  S20('glFramebufferTexture2D', '(IIIII)V', (r, c, gl, [target, attachment, textarget, name, level]) => { if (framebufferIsDefault(c, target)) return raise(c, GL.INVALID_OPERATION); const o = lookup(c, 'texture', name); if (o !== undefined) gl.framebufferTexture2D(target, attachment, textarget, o, level); });
  S30('glFramebufferTextureLayer', '(IIIII)V', (r, c, gl, [target, attachment, name, level, layer]) => { if (framebufferIsDefault(c, target)) return raise(c, GL.INVALID_OPERATION); const o = lookup(c, 'texture', name); if (o !== undefined) gl.framebufferTextureLayer(target, attachment, o, level, layer); });
  S20('glFramebufferRenderbuffer', '(IIII)V', (r, c, gl, [target, attachment, rbTarget, name]) => { if (framebufferIsDefault(c, target)) return raise(c, GL.INVALID_OPERATION); const o = lookup(c, 'renderbuffer', name); if (o !== undefined) gl.framebufferRenderbuffer(target, attachment, rbTarget, o); });
  S20('glCheckFramebufferStatus', '(I)I', (r, c, gl, [target]) => gl.checkFramebufferStatus(target));
  // ---- buffers ----
  S20('glBufferData', `(II${BUFFER}I)V`, (r, c, gl, [target, size, data, usage]) => {
    if (data === null) return void gl.bufferData(target, size, usage);
    const region = nioRegion(r, data); if (region.bytes < size) r.throwJava(IAE, 'remaining() < size < needed');
    gl.bufferData(target, readRegion(r, region, size), usage);
  });
  S20('glBufferSubData', `(III${BUFFER})V`, (r, c, gl, [target, offset, size, data]) => { const region = nioRegion(r, data); if (region.bytes < size) r.throwJava(IAE, 'remaining() < size < needed'); gl.bufferSubData(target, offset, readRegion(r, region, size)); });
  S30('glCopyBufferSubData', '(IIIII)V', (r, c, gl, args) => { gl.copyBufferSubData(...args); });
  unsupported(S30, 'glMapBufferRange', ['(IIII)Ljava/nio/Buffer;'], 'mapped buffer memory is not available on WebGL2 (glBufferSubData writes a range)');
  unsupported(S30, 'glGetBufferPointerv', ['(II)Ljava/nio/Buffer;'], 'mapped buffer memory is not available on WebGL2');
  unsupported(S30, 'glFlushMappedBufferRange', ['(III)V'], 'mapped buffer memory is not available on WebGL2');
  S30('glUnmapBuffer', '(I)Z', (r, c) => { raise(c, GL.INVALID_OPERATION); return 0; });   // nothing can be mapped: unmapping an unmapped buffer is GL_INVALID_OPERATION
  both(S20, 'glGetBufferParameteriv', ['(II[II)V', `(II${INT_BUFFER})V`], (r, c, gl, args) => { const v = gl.getBufferParameter(args[0], args[1]); if (v === null) return; writeVec(r, args, 2, 'I', [Number(v)]); });
  both(S30, 'glGetBufferParameteri64v', ['(II[JI)V', `(II${LONG_BUFFER})V`], (r, c, gl, args) => { const v = gl.getBufferParameter(args[0], args[1]); if (v === null) return; writeVec(r, args, 2, 'J', [Number(v)], 'long'); });
  // ---- shaders and programs (one namespace) ----
  S20('glCreateShader', '(I)I', (r, c, gl, [type]) => { const o = gl.createShader(type); if (!o) return 0; return genNamesOf(c, o); });
  S20('glCreateProgram', '()I', (r, c, gl) => { const o = gl.createProgram(); return o ? genNamesOf(c, o) : 0; });
  const genNamesOf = (c, object) => { const name = c.group.next.object++; c.group.names.object.set(name, object); c.group.reverse.set(object, name); return name; };
  S20('glDeleteShader', '(I)V', (r, c, gl, [name]) => { if (name) deleteName(c, 'object', name, o => gl.deleteShader(o)); });
  S20('glDeleteProgram', '(I)V', (r, c, gl, [name]) => { if (name) deleteName(c, 'object', name, o => gl.deleteProgram(o)); });
  S20('glShaderSource', `(I${STRING})V`, (r, c, gl, [name, source]) => { const o = lookup(c, 'object', name); if (o) gl.shaderSource(o, source ?? ''); });
  S20('glCompileShader', '(I)V', (r, c, gl, [name]) => { const o = lookup(c, 'object', name); if (o) gl.compileShader(o); });
  S20('glAttachShader', '(II)V', (r, c, gl, [p, s]) => { const program = lookup(c, 'object', p), shader = lookup(c, 'object', s); if (program && shader) gl.attachShader(program, shader); });
  S20('glDetachShader', '(II)V', (r, c, gl, [p, s]) => { const program = lookup(c, 'object', p), shader = lookup(c, 'object', s); if (program && shader) gl.detachShader(program, shader); });
  S20('glLinkProgram', '(I)V', (r, c, gl, [p]) => { const o = lookup(c, 'object', p); if (!o) return; gl.linkProgram(o); c.group.uniforms.delete(p); });
  S20('glValidateProgram', '(I)V', (r, c, gl, [p]) => { const o = lookup(c, 'object', p); if (o) gl.validateProgram(o); });
  S20('glUseProgram', '(I)V', (r, c, gl, [p]) => {
    const o = lookup(c, 'object', p); if (o === undefined) return;
    if (o && !gl.getProgramParameter(o, gl.LINK_STATUS)) return raise(c, GL.INVALID_OPERATION);   // ES 2.0 2.10.3: a program that did not link cannot be made current
    gl.useProgram(o); c.program = p;
  });
  S30('glProgramParameteri', '(III)V', (r, c) => raise(c, GL.INVALID_ENUM));   // GL_PROGRAM_BINARY_RETRIEVABLE_HINT: no binaries
  unsupported(S30, 'glProgramBinary', [`(II${BUFFER}I)V`], 'program binaries are not available (GL_NUM_PROGRAM_BINARY_FORMATS is 0)');
  unsupported(S30, 'glGetProgramBinary', [`(II${INT_BUFFER}${INT_BUFFER}${BUFFER})V`, `(II[II[II${BUFFER})V`], 'program binaries are not available (GL_NUM_PROGRAM_BINARY_FORMATS is 0)');
  unsupported(S20, 'glShaderBinary', [`(I${INT_BUFFER}I${BUFFER}I)V`, `(I[III${BUFFER}I)V`], 'shader binaries are not available (GL_NUM_SHADER_BINARY_FORMATS is 0)');
  const shaderParam = (c, gl, o, pname) => {
    if (pname === GL.INFO_LOG_LENGTH) { const log = gl.getShaderInfoLog(o) ?? ''; return log ? log.length + 1 : 0; }
    if (pname === GL.SHADER_SOURCE_LENGTH) { const s = gl.getShaderSource(o) ?? ''; return s ? s.length + 1 : 0; }
    const v = gl.getShaderParameter(o, pname); if (v === null) { raise(c, GL.INVALID_ENUM); return null; } return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  };
  both(S20, 'glGetShaderiv', ['(II[II)V', `(II${INT_BUFFER})V`], (r, c, gl, args) => { const o = lookup(c, 'object', args[0]); if (!o) return; const v = shaderParam(c, gl, o, args[1]); if (v !== null) writeVec(r, args, 2, 'I', [v]); });
  const programParam = (c, gl, o, pname) => {
    switch (pname) {
      case GL.INFO_LOG_LENGTH: { const log = gl.getProgramInfoLog(o) ?? ''; return log ? log.length + 1 : 0; }
      case GL.ACTIVE_UNIFORM_MAX_LENGTH: { let max = 0; for (let i = 0, n = gl.getProgramParameter(o, GL.ACTIVE_UNIFORMS) ?? 0; i < n; i++) max = Math.max(max, (gl.getActiveUniform(o, i)?.name.length ?? 0) + 1); return max; }
      case GL.ACTIVE_ATTRIBUTE_MAX_LENGTH: { let max = 0; for (let i = 0, n = gl.getProgramParameter(o, GL.ACTIVE_ATTRIBUTES) ?? 0; i < n; i++) max = Math.max(max, (gl.getActiveAttrib(o, i)?.name.length ?? 0) + 1); return max; }
      case GL.ACTIVE_UNIFORM_BLOCK_MAX_NAME_LENGTH: { let max = 0; for (let i = 0, n = gl.getProgramParameter(o, 0x8A36) ?? 0; i < n; i++) max = Math.max(max, (gl.getActiveUniformBlockName(o, i)?.length ?? 0) + 1); return max; }
      case GL.TRANSFORM_FEEDBACK_VARYING_MAX_LENGTH: { let max = 0; for (let i = 0, n = gl.getProgramParameter(o, 0x8C83) ?? 0; i < n; i++) max = Math.max(max, (gl.getTransformFeedbackVarying(o, i)?.name.length ?? 0) + 1); return max; }
      case GL.PROGRAM_BINARY_LENGTH: return 0;
    }
    const v = gl.getProgramParameter(o, pname); if (v === null) { raise(c, GL.INVALID_ENUM); return null; } return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  };
  both(S20, 'glGetProgramiv', ['(II[II)V', `(II${INT_BUFFER})V`], (r, c, gl, args) => { const o = lookup(c, 'object', args[0]); if (!o) return; const v = programParam(c, gl, o, args[1]); if (v !== null) writeVec(r, args, 2, 'I', [v]); });
  S20('glGetShaderInfoLog', `(I)${STRING}`, (r, c, gl, [name]) => { const o = lookup(c, 'object', name); return o ? gl.getShaderInfoLog(o) ?? '' : ''; }, '');
  S20('glGetProgramInfoLog', `(I)${STRING}`, (r, c, gl, [name]) => { const o = lookup(c, 'object', name); return o ? gl.getProgramInfoLog(o) ?? '' : ''; }, '');
  S20('glGetShaderSource', `(I)${STRING}`, (r, c, gl, [name]) => { const o = lookup(c, 'object', name); return o ? gl.getShaderSource(o) ?? '' : ''; }, '');
  both(S20, 'glGetShaderPrecisionFormat', ['(II[II[II)V', `(II${INT_BUFFER}${INT_BUFFER})V`], (r, c, gl, args) => {
    const format = gl.getShaderPrecisionFormat(args[0], args[1]); if (!format) return raise(c, GL.INVALID_ENUM);
    const second = typeof args[3] === 'number' ? 4 : 3;
    writeVec(r, args, 2, 'I', [format.rangeMin, format.rangeMax]); writeVec(r, args, second, 'I', [format.precision]);
  });
  both(S20, 'glGetAttachedShaders', ['(II[II[II)V', `(II${INT_BUFFER}${INT_BUFFER})V`], (r, c, gl, args) => {
    const o = lookup(c, 'object', args[0]); if (!o) return; const names = (gl.getAttachedShaders(o) ?? []).slice(0, args[1]).map(s => nameOf(c, 'object', s));
    const countAt = 2, shadersAt = typeof args[3] === 'number' ? 4 : 3;
    if (args[countAt] !== null) writeVec(r, args, countAt, 'I', [names.length]); writeVec(r, args, shadersAt, 'I', names);
  });
  S20('glGetAttribLocation', `(I${STRING})I`, (r, c, gl, [p, name]) => { const o = lookup(c, 'object', p); return o ? gl.getAttribLocation(o, name) : -1; }, -1);
  S30('glGetFragDataLocation', `(I${STRING})I`, (r, c, gl, [p, name]) => { const o = lookup(c, 'object', p); return o ? gl.getFragDataLocation(o, name) : -1; }, -1);
  S20('glGetUniformLocation', `(I${STRING})I`, (r, c, gl, [p, name]) => {
    const o = lookup(c, 'object', p); if (!o) return -1;
    const table = uniformTable(c, p); if (table.byName.has(name)) return table.byName.get(name);
    const object = gl.getUniformLocation(o, name); if (!object) return -1;
    const at = table.locations.length; table.locations.push(object); table.byName.set(name, at); return at;
  }, -1);
  // glGetActiveAttrib / glGetActiveUniform: the String-returning overloads and the byte[] / ByteBuffer ones
  for (const [which, method] of [['Attrib', 'getActiveAttrib'], ['Uniform', 'getActiveUniform']]) {
    const info = (c, gl, p, index) => { const o = lookup(c, 'object', p); if (!o) return null; const value = gl[method](o, index); if (!value) raise(c, GL.INVALID_VALUE); return value; };
    S20(`glGetActive${which}`, `(II[II[II)${STRING}`, (r, c, gl, args) => { const v = info(c, gl, args[0], args[1]); if (!v) return null; writeVec(r, args, 2, 'I', [v.size]); writeVec(r, args, 4, 'I', [v.type]); return v.name; }, null);
    S20(`glGetActive${which}`, `(II${INT_BUFFER}${INT_BUFFER})${STRING}`, (r, c, gl, args) => { const v = info(c, gl, args[0], args[1]); if (!v) return null; writeVec(r, args, 2, 'I', [v.size]); writeVec(r, args, 3, 'I', [v.type]); return v.name; }, null);
    S20(`glGetActive${which}`, '(III[II[II[II[BI)V', (r, c, gl, args) => {
      const [p, index, bufsize, length, lengthOffset, size, sizeOffset, type, typeOffset, name, nameOffset] = args, v = info(c, gl, p, index); if (!v) return;
      const bytes = new TextEncoder().encode(v.name).subarray(0, Math.max(0, bufsize - 1));
      if (length !== null) writeRegion(r, arrayRegion(r, length, lengthOffset, 'I'), bytesOfInts([bytes.length]));
      writeRegion(r, arrayRegion(r, size, sizeOffset, 'I'), bytesOfInts([v.size])); writeRegion(r, arrayRegion(r, type, typeOffset, 'I'), bytesOfInts([v.type]));
      if (bufsize > 0) writeRegion(r, arrayRegion(r, name, nameOffset, 'B'), Uint8Array.from([...bytes, 0]));
    });
    unsupported(S20, `glGetActive${which}`, [`(IIILjava/nio/IntBuffer;Ljava/nio/IntBuffer;Ljava/nio/IntBuffer;B)V`], 'this overload writes the name into a single byte (a legacy JNI signature); use the String-returning glGetActive' + which);
  }
  // ---- uniforms ----
  const uniform = (name, sig, method, conv) => S20(name, sig, (r, c, gl, [loc, ...values]) => { const l = location(c, loc); if (l === undefined) return; gl[method](l, ...values.map(conv)); });
  for (const n of [1, 2, 3, 4]) {
    uniform(`glUniform${n}f`, `(I${'F'.repeat(n)})V`, `uniform${n}f`, f); uniform(`glUniform${n}i`, `(I${'I'.repeat(n)})V`, `uniform${n}i`, v => v);
    S30(`glUniform${n}ui`, `(I${'I'.repeat(n)})V`, (r, c, gl, [loc, ...values]) => { const l = location(c, loc); if (l !== undefined) gl[`uniform${n}ui`](l, ...values.map(v => v >>> 0)); });
    for (const [kind, type, S, method, convert] of [['f', 'F', S20, `uniform${n}fv`, floats], ['i', 'I', S20, `uniform${n}iv`, ints], ['ui', 'I', S30, `uniform${n}uiv`, uints]]) {
      both(S, `glUniform${n}${kind}v`, [`(II[${type}I)V`, `(II${type === 'F' ? FLOAT_BUFFER : INT_BUFFER})V`], (r, c, gl, args) => {
        const [loc, count] = args, l = location(c, loc); if (l === undefined) return; if (count < 0) return raise(c, GL.INVALID_VALUE);
        const region = vec(r, args, 2, type), need = count * n * 4; if (region.bytes < need) r.throwJava(IAE, 'length - offset < count*' + n + ' < needed');
        gl[method](l, convert(readRegion(r, region, need)));
      });
    }
  }
  for (const [shape, cells, S] of [['2', 4, S20], ['3', 9, S20], ['4', 16, S20], ['2x3', 6, S30], ['3x2', 6, S30], ['2x4', 8, S30], ['4x2', 8, S30], ['3x4', 12, S30], ['4x3', 12, S30]]) {
    both(S, `glUniformMatrix${shape}fv`, ['(IIZ[FI)V', `(IIZ${FLOAT_BUFFER})V`], (r, c, gl, args) => {
      const [loc, count, transpose] = args, l = location(c, loc); if (l === undefined) return; if (count < 0) return raise(c, GL.INVALID_VALUE);
      const region = vec(r, args, 3, 'F'), need = count * cells * 4; if (region.bytes < need) r.throwJava(IAE, `length - offset < count*${cells} < needed`);
      gl[`uniformMatrix${shape}fv`](l, !!transpose, floats(readRegion(r, region, need)));
    });
  }
  for (const [name, method, convert, kind, S] of [['glGetUniformfv', 'getUniform', 'float', 'F', S20], ['glGetUniformiv', 'getUniform', 'int', 'I', S20], ['glGetUniformuiv', 'getUniform', 'int', 'I', S30]]) {
    both(S, name, [`(II[${kind}I)V`, `(II${kind === 'F' ? FLOAT_BUFFER : INT_BUFFER})V`], (r, c, gl, args) => {
      const o = lookup(c, 'object', args[0]); if (!o) return; const table = c.group.uniforms.get(args[0]), l = table?.locations[args[1]]; if (!l) return raise(c, GL.INVALID_OPERATION);
      const v = gl.getUniform(o, l), values = ArrayBuffer.isView(v) || Array.isArray(v) ? Array.from(v, x => Number(x)) : [typeof v === 'boolean' ? (v ? 1 : 0) : Number(v)];
      writeVec(r, args, 2, kind, values, convert);
    });
  }
  // ---- vertex attributes ----
  for (const n of [1, 2, 3, 4]) both(S20, `glVertexAttrib${n}fv`, ['(I[FI)V', `(I${FLOAT_BUFFER})V`], (r, c, gl, args) => { gl[`vertexAttrib${n}fv`](args[0], floats(readRegion(r, vec(r, args, 1, 'F'), n * 4))); });
  S30('glVertexAttribI4i', '(IIIII)V', (r, c, gl, args) => { gl.vertexAttribI4i(...args); }); S30('glVertexAttribI4ui', '(IIIII)V', (r, c, gl, [i, ...v]) => { gl.vertexAttribI4ui(i, ...v.map(x => x >>> 0)); });
  both(S30, 'glVertexAttribI4iv', ['(I[II)V', `(I${INT_BUFFER})V`], (r, c, gl, args) => { gl.vertexAttribI4iv(args[0], ints(readRegion(r, vec(r, args, 1, 'I'), 16))); });
  both(S30, 'glVertexAttribI4uiv', ['(I[II)V', `(I${INT_BUFFER})V`], (r, c, gl, args) => { gl.vertexAttribI4uiv(args[0], uints(readRegion(r, vec(r, args, 1, 'I'), 16))); });
  S20('glVertexAttribPointer', '(IIIZII)V', (r, c, gl, [index, size, type, normalized, stride, offset]) => { c.clientAttribs.delete(index); gl.vertexAttribPointer(index, size, type, !!normalized, stride, offset); });
  S30('glVertexAttribIPointer', '(IIIII)V', (r, c, gl, [index, size, type, stride, offset]) => { c.clientAttribs.delete(index); gl.vertexAttribIPointer(index, size, type, stride, offset); });
  const clientPointer = (r, c, gl, index, size, type, normalized, stride, buffer, integer) => {
    if (gl.getParameter(gl.ARRAY_BUFFER_BINDING)) { raise(c, GL.INVALID_OPERATION); return; }   // with a buffer object bound the pointer is an offset: the int overload
    if (buffer === null) { c.clientAttribs.delete(index); return; }
    c.clientAttribs.set(index, { size, type, normalized: !!normalized, stride, region: nioRegion(r, buffer), buffer, integer });
  };
  S20('glVertexAttribPointerBounds', `(IIIZI${BUFFER}I)V`, (r, c, gl, [index, size, type, normalized, stride, buffer]) => clientPointer(r, c, gl, index, size, type, normalized, stride, buffer, false));
  S30('glVertexAttribIPointerBounds', `(IIII${BUFFER}I)V`, (r, c, gl, [index, size, type, stride, buffer]) => clientPointer(r, c, gl, index, size, type, false, stride, buffer, true));
  S30('glVertexAttribDivisor', '(II)V', (r, c, gl, args) => { gl.vertexAttribDivisor(...args); });
  for (const [name, S, kind, convert] of [['glGetVertexAttribfv', S20, 'F', 'float'], ['glGetVertexAttribiv', S20, 'I', 'int'], ['glGetVertexAttribIiv', S30, 'I', 'int'], ['glGetVertexAttribIuiv', S30, 'I', 'int']]) {
    both(S, name, [`(II[${kind}I)V`, `(II${kind === 'F' ? FLOAT_BUFFER : INT_BUFFER})V`], (r, c, gl, args) => {
      const v = gl.getVertexAttrib(args[0], args[1]); if (v === null || v === undefined) return raise(c, GL.INVALID_ENUM);
      writeVec(r, args, 2, kind, ArrayBuffer.isView(v) ? Array.from(v, Number) : [typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'object' ? nameOf(c, 'buffer', v) : Number(v)], convert);
    });
  }
  // ---- textures ----
  S20('glTexImage2D', `(IIIIIIII${BUFFER})V`, (r, c, gl, [target, level, internal, width, height, border, format, type, pixels]) => {
    gl.texImage2D(target, level, internal, width, height, border, format, type, pixels === null ? null : pixelArray(readRegion(r, nioRegion(r, pixels)), type));
  });
  S20('glTexSubImage2D', `(IIIIIIII${BUFFER})V`, (r, c, gl, [target, level, x, y, width, height, format, type, pixels]) => {
    if (pixels === null) r.throwJava(IAE, 'pixels == null'); gl.texSubImage2D(target, level, x, y, width, height, format, type, pixelArray(readRegion(r, nioRegion(r, pixels)), type));
  });
  S30('glTexImage3D', `(IIIIIIIII${BUFFER})V`, (r, c, gl, [target, level, internal, width, height, depth, border, format, type, pixels]) => {
    gl.texImage3D(target, level, internal, width, height, depth, border, format, type, pixels === null ? null : pixelArray(readRegion(r, nioRegion(r, pixels)), type));
  });
  S30('glTexImage3D', '(IIIIIIIIII)V', (r, c, gl, args) => { gl.texImage3D(...args); });   // from a bound PIXEL_UNPACK_BUFFER at an offset
  S30('glTexSubImage3D', `(IIIIIIIIII${BUFFER})V`, (r, c, gl, [target, level, x, y, z, width, height, depth, format, type, pixels]) => { gl.texSubImage3D(target, level, x, y, z, width, height, depth, format, type, pixelArray(readRegion(r, nioRegion(r, pixels)), type)); });
  S30('glTexSubImage3D', '(IIIIIIIIIII)V', (r, c, gl, args) => { gl.texSubImage3D(...args); });
  S30('glTexStorage2D', '(IIIII)V', (r, c, gl, args) => { gl.texStorage2D(...args); }); S30('glTexStorage3D', '(IIIIII)V', (r, c, gl, args) => { gl.texStorage3D(...args); });
  S30('glCopyTexSubImage3D', '(IIIIIIIII)V', (r, c, gl, args) => { gl.copyTexSubImage3D(...args); });
  S20('glCompressedTexImage2D', `(IIIIIII${BUFFER})V`, (r, c, gl, [target, level, internal, width, height, border, size, data]) => { gl.compressedTexImage2D(target, level, internal, width, height, border, readRegion(r, nioRegion(r, data), size)); });
  S20('glCompressedTexSubImage2D', `(IIIIIIII${BUFFER})V`, (r, c, gl, [target, level, x, y, width, height, format, size, data]) => { gl.compressedTexSubImage2D(target, level, x, y, width, height, format, readRegion(r, nioRegion(r, data), size)); });
  S30('glCompressedTexImage3D', `(IIIIIIII${BUFFER})V`, (r, c, gl, [target, level, internal, width, height, depth, border, size, data]) => { gl.compressedTexImage3D(target, level, internal, width, height, depth, border, readRegion(r, nioRegion(r, data), size)); });
  S30('glCompressedTexImage3D', '(IIIIIIIII)V', (r, c, gl, [target, level, internal, width, height, depth, border, size, offset]) => { gl.compressedTexImage3D(target, level, internal, width, height, depth, border, size, offset); });
  S30('glCompressedTexSubImage3D', `(IIIIIIIIII${BUFFER})V`, (r, c, gl, [target, level, x, y, z, width, height, depth, format, size, data]) => { gl.compressedTexSubImage3D(target, level, x, y, z, width, height, depth, format, readRegion(r, nioRegion(r, data), size)); });
  S30('glCompressedTexSubImage3D', '(IIIIIIIIIII)V', (r, c, gl, [target, level, x, y, z, width, height, depth, format, size, offset]) => { gl.compressedTexSubImage3D(target, level, x, y, z, width, height, depth, format, size, offset); });
  both(S20, 'glTexParameterfv', ['(II[FI)V', `(II${FLOAT_BUFFER})V`], (r, c, gl, args) => { gl.texParameterf(args[0], args[1], floats(readRegion(r, vec(r, args, 2, 'F'), 4))[0]); });
  both(S20, 'glTexParameteriv', ['(II[II)V', `(II${INT_BUFFER})V`], (r, c, gl, args) => { gl.texParameteri(args[0], args[1], ints(readRegion(r, vec(r, args, 2, 'I'), 4))[0]); });
  for (const [name, kind, convert] of [['glGetTexParameterfv', 'F', 'float'], ['glGetTexParameteriv', 'I', 'int']]) both(S20, name, [`(II[${kind}I)V`, `(II${kind === 'F' ? FLOAT_BUFFER : INT_BUFFER})V`], (r, c, gl, args) => {
    const v = gl.getTexParameter(args[0], args[1]); if (v === null) return raise(c, GL.INVALID_ENUM); writeVec(r, args, 2, kind, [typeof v === 'boolean' ? (v ? 1 : 0) : Number(v)], convert);
  });
  // ---- samplers ----
  S30('glSamplerParameteri', '(III)V', (r, c, gl, [name, pname, value]) => { const o = lookup(c, 'sampler', name); if (o) gl.samplerParameteri(o, pname, value); });
  S30('glSamplerParameterf', '(IIF)V', (r, c, gl, [name, pname, value]) => { const o = lookup(c, 'sampler', name); if (o) gl.samplerParameterf(o, pname, f(value)); });
  both(S30, 'glSamplerParameteriv', ['(II[II)V', `(II${INT_BUFFER})V`], (r, c, gl, args) => { const o = lookup(c, 'sampler', args[0]); if (o) gl.samplerParameteri(o, args[1], ints(readRegion(r, vec(r, args, 2, 'I'), 4))[0]); });
  both(S30, 'glSamplerParameterfv', ['(II[FI)V', `(II${FLOAT_BUFFER})V`], (r, c, gl, args) => { const o = lookup(c, 'sampler', args[0]); if (o) gl.samplerParameterf(o, args[1], floats(readRegion(r, vec(r, args, 2, 'F'), 4))[0]); });
  for (const [name, kind, convert] of [['glGetSamplerParameteriv', 'I', 'int'], ['glGetSamplerParameterfv', 'F', 'float']]) both(S30, name, [`(II[${kind}I)V`, `(II${kind === 'F' ? FLOAT_BUFFER : INT_BUFFER})V`], (r, c, gl, args) => {
    const o = lookup(c, 'sampler', args[0]); if (!o) return; const v = gl.getSamplerParameter(o, args[1]); if (v === null) return raise(c, GL.INVALID_ENUM); writeVec(r, args, 2, kind, [Number(v)], convert);
  });
  // ---- framebuffers and renderbuffers ----
  S30('glRenderbufferStorageMultisample', '(IIIII)V', (r, c, gl, args) => { gl.renderbufferStorageMultisample(...args); });
  S30('glBlitFramebuffer', '(IIIIIIIIII)V', (r, c, gl, args) => { gl.blitFramebuffer(...args); });
  S30('glReadBuffer', '(I)V', (r, c, gl, [mode]) => { gl.readBuffer(c.appRead === 0 ? (mode === GL.BACK ? GL.COLOR_ATTACHMENT0 : mode) : mode); });
  both(S30, 'glDrawBuffers', ['(I[II)V', `(I${INT_BUFFER})V`], (r, c, gl, args) => { const list = readInts(r, args, 1, args[0]); gl.drawBuffers(c.appDraw === 0 ? list.map(v => v === GL.BACK ? GL.COLOR_ATTACHMENT0 : v) : list); });
  const invalidate = (r, c, gl, args, rest) => { const [target, n] = args, list = readInts(r, args, 2, n), mapped = framebufferIsDefault(c, target) ? list.map(defaultAttachment) : list; rest(target, mapped); };
  both(S30, 'glInvalidateFramebuffer', ['(II[II)V', `(II${INT_BUFFER})V`], (r, c, gl, args) => invalidate(r, c, gl, args, (target, list) => gl.invalidateFramebuffer(target, list)));
  S30('glInvalidateSubFramebuffer', '(II[IIIIII)V', (r, c, gl, args) => invalidate(r, c, gl, args, (target, list) => gl.invalidateSubFramebuffer(target, list, args[4], args[5], args[6], args[7])));
  S30('glInvalidateSubFramebuffer', `(II${INT_BUFFER}IIII)V`, (r, c, gl, args) => invalidate(r, c, gl, args, (target, list) => gl.invalidateSubFramebuffer(target, list, args[3], args[4], args[5], args[6])));
  both(S20, 'glGetFramebufferAttachmentParameteriv', ['(III[II)V', `(III${INT_BUFFER})V`], (r, c, gl, args) => {
    const [target, attachment, pname] = args, fallback = framebufferIsDefault(c, target), v = gl.getFramebufferAttachmentParameter(target, fallback ? defaultAttachment(attachment) : attachment, pname);
    if (v === null || v === undefined) return raise(c, GL.INVALID_ENUM);
    const value = pname === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE && fallback ? 0x8218 /* GL_FRAMEBUFFER_DEFAULT */ : typeof v === 'object' ? nameOf(c, pname === GL.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME ? 'texture' : 'renderbuffer', v) || nameOf(c, 'renderbuffer', v) : Number(v);
    writeVec(r, args, 3, 'I', [value]);
  });
  both(S20, 'glGetRenderbufferParameteriv', ['(II[II)V', `(II${INT_BUFFER})V`], (r, c, gl, args) => { const v = gl.getRenderbufferParameter(args[0], args[1]); if (v === null) return raise(c, GL.INVALID_ENUM); writeVec(r, args, 2, 'I', [Number(v)]); });
  both(S30, 'glGetInternalformativ', ['(IIII[II)V', `(IIII${INT_BUFFER})V`], (r, c, gl, args) => { const v = gl.getInternalformatParameter(args[0], args[1], args[2]); if (!v) return raise(c, GL.INVALID_ENUM); writeVec(r, args, 4, 'I', Array.from(v).slice(0, args[3])); });
  for (const [name, S, kind, method] of [['glClearBufferfv', S30, 'F', 'clearBufferfv'], ['glClearBufferiv', S30, 'I', 'clearBufferiv'], ['glClearBufferuiv', S30, 'I', 'clearBufferuiv']]) {
    both(S, name, [`(II[${kind}I)V`, `(II${kind === 'F' ? FLOAT_BUFFER : INT_BUFFER})V`], (r, c, gl, args) => { const bytes = readRegion(r, vec(r, args, 2, kind), 16); gl[method](args[0], args[1], kind === 'F' ? floats(bytes) : method.endsWith('uiv') ? uints(bytes) : ints(bytes)); });
  }
  S30('glClearBufferfi', '(IIFI)V', (r, c, gl, [buffer, drawbuffer, depth, stencil]) => { gl.clearBufferfi(buffer, drawbuffer, f(depth), stencil); });
  // ---- reading pixels ----
  S20('glReadPixels', `(IIIIII${BUFFER})V`, (r, c, gl, [x, y, width, height, format, type, pixels]) => {
    const region = nioRegion(r, pixels), bytes = new Uint8Array(region.bytes); if (!bytes.length) return;
    gl.readPixels(x, y, width, height, format, type, pixelArray(bytes, type)); writeRegion(r, region, bytes);
  });
  S30('glReadPixels', '(IIIIIII)V', (r, c, gl, args) => { gl.readPixels(...args); });   // into a bound PIXEL_PACK_BUFFER at an offset
  // ---- getters ----
  for (const [name, kind, convert, S] of [['glGetIntegerv', 'I', 'int', S20], ['glGetFloatv', 'F', 'float', S20], ['glGetBooleanv', 'Z', 'int', S20], ['glGetInteger64v', 'J', 'long', S30]]) {
    const signatures = kind === 'Z' ? ['(I[ZI)V', `(I${INT_BUFFER})V`] : [`(I[${kind}I)V`, `(I${kind === 'F' ? FLOAT_BUFFER : kind === 'J' ? LONG_BUFFER : INT_BUFFER})V`];
    both(S, name, signatures, (r, c, gl, args) => {
      const values = parameterValues(c, args[0]); if (values === null) return raise(c, GL.INVALID_ENUM);
      const region = typeof args[2] === 'number' && args.length === 3 ? arrayRegion(r, args[1], args[2], kind === 'Z' ? 'B' : kind) : nioRegion(r, args[1]);
      const out = kind === 'Z' ? (region.type === 'B' ? Uint8Array.from(values.map(v => v ? 1 : 0)) : bytesOfInts(values.map(v => v ? 1 : 0))) : kind === 'F' ? bytesOfFloats(values) : kind === 'J' ? bytesOfLongs(values) : bytesOfInts(values.map(v => Math.trunc(v)));
      writeRegion(r, region, out);
    });
  }
  both(S30, 'glGetIntegeri_v', ['(II[II)V', `(II${INT_BUFFER})V`], (r, c, gl, args) => { const v = gl.getIndexedParameter(args[0], args[1]); if (v === null || v === undefined) return raise(c, GL.INVALID_ENUM); writeVec(r, args, 2, 'I', [typeof v === 'object' ? nameOf(c, 'buffer', v) : Number(v)]); });
  both(S30, 'glGetInteger64i_v', ['(II[JI)V', `(II${LONG_BUFFER})V`], (r, c, gl, args) => { const v = gl.getIndexedParameter(args[0], args[1]); if (v === null || v === undefined) return raise(c, GL.INVALID_ENUM); writeVec(r, args, 2, 'J', [typeof v === 'object' ? nameOf(c, 'buffer', v) : Number(v)], 'long'); });
  S20('glGetString', `(I)${STRING}`, (r, c, gl, [name]) => {
    switch (name) {
      case GL.VERSION: return GL_VERSION_STRING; case GL.SHADING_LANGUAGE_VERSION: return GLSL_VERSION_STRING; case GL.VENDOR: return 'APK Web Lab';
      case GL.RENDERER: return c.group.renderer ? `WebGL2 (${c.group.renderer})` : 'WebGL2'; case GL.EXTENSIONS: return c.group.extensions.join(' ');
      default: raise(c, GL.INVALID_ENUM); return null;
    }
  }, null);
  S30('glGetStringi', `(II)${STRING}`, (r, c, gl, [name, index]) => { if (name !== GL.EXTENSIONS) { raise(c, GL.INVALID_ENUM); return null; } if (index < 0 || index >= c.group.extensions.length) { raise(c, GL.INVALID_VALUE); return null; } return c.group.extensions[index]; }, null);
  // ---- ES 3.0 draws, queries, transform feedback, uniform blocks, syncs ----
  S30('glDrawArraysInstanced', '(IIII)V', (r, c, gl, [mode, first, count, instances]) => { uploadClientArrays(r, c, first + count); gl.drawArraysInstanced(mode, first, count, instances); });
  S30('glDrawElementsInstanced', '(IIIII)V', (r, c, gl, args) => { gl.drawElementsInstanced(...args); });
  S30('glDrawElementsInstanced', `(III${BUFFER}I)V`, (r, c, gl, [mode, count, type, indices, instances]) => drawClientElements(r, c, mode, count, type, indices, offset => gl.drawElementsInstanced(mode, count, type, offset, instances)));
  S30('glDrawRangeElements', '(IIIIII)V', (r, c, gl, args) => { gl.drawRangeElements(...args); });
  S30('glDrawRangeElements', `(IIIII${BUFFER})V`, (r, c, gl, [mode, start, end, count, type, indices]) => drawClientElements(r, c, mode, count, type, indices, offset => gl.drawRangeElements(mode, start, end, count, type, offset)));
  S30('glBeginQuery', '(II)V', (r, c, gl, [target, name]) => { const o = lookup(c, 'query', name); if (o) gl.beginQuery(target, o); }); S30('glEndQuery', '(I)V', (r, c, gl, [target]) => { gl.endQuery(target); });
  both(S30, 'glGetQueryiv', ['(II[II)V', `(II${INT_BUFFER})V`], (r, c, gl, args) => { const v = gl.getQuery(args[0], args[1]); writeVec(r, args, 2, 'I', [v && typeof v === 'object' ? nameOf(c, 'query', v) : Number(v ?? 0)]); });
  both(S30, 'glGetQueryObjectuiv', ['(II[II)V', `(II${INT_BUFFER})V`], (r, c, gl, args) => { const o = lookup(c, 'query', args[0]); if (!o) return; const v = gl.getQueryParameter(o, args[1]); writeVec(r, args, 2, 'I', [typeof v === 'boolean' ? (v ? 1 : 0) : Number(v ?? 0)]); });
  S30('glBeginTransformFeedback', '(I)V', (r, c, gl, [mode]) => { gl.beginTransformFeedback(mode); }); S30('glEndTransformFeedback', '()V', (r, c, gl) => { gl.endTransformFeedback(); });
  S30('glPauseTransformFeedback', '()V', (r, c, gl) => { gl.pauseTransformFeedback(); }); S30('glResumeTransformFeedback', '()V', (r, c, gl) => { gl.resumeTransformFeedback(); });
  S30('glTransformFeedbackVaryings', `(I[${STRING}I)V`, (r, c, gl, [p, varyings, mode]) => { const o = lookup(c, 'object', p); if (!o) return; if (varyings === null) r.throwJava(IAE, 'varyings == null'); gl.transformFeedbackVaryings(o, Array.from(r.array(varyings).elements, s => r.stringCharacters(s)), mode); });
  for (const sig of [`(II[II[II)${STRING}`, `(II${INT_BUFFER}${INT_BUFFER})${STRING}`]) S30('glGetTransformFeedbackVarying', sig, (r, c, gl, args) => {
    const o = lookup(c, 'object', args[0]); if (!o) return null; const v = gl.getTransformFeedbackVarying(o, args[1]); if (!v) { raise(c, GL.INVALID_VALUE); return null; }
    const typeAt = typeof args[3] === 'number' ? 4 : 3; writeVec(r, args, 2, 'I', [v.size]); writeVec(r, args, typeAt, 'I', [v.type]); return v.name;
  }, null);
  unsupported(S30, 'glGetTransformFeedbackVarying', [`(IIILjava/nio/IntBuffer;Ljava/nio/IntBuffer;Ljava/nio/IntBuffer;B)V`, `(IIILjava/nio/IntBuffer;Ljava/nio/IntBuffer;Ljava/nio/IntBuffer;Ljava/nio/ByteBuffer;)V`, '(III[II[II[II[BI)V'], 'use the String-returning glGetTransformFeedbackVarying');
  S30('glGetUniformBlockIndex', `(I${STRING})I`, (r, c, gl, [p, name]) => { const o = lookup(c, 'object', p); return o ? gl.getUniformBlockIndex(o, name) >>> 0 | 0 : -1; }, -1);
  S30('glUniformBlockBinding', '(III)V', (r, c, gl, [p, index, binding]) => { const o = lookup(c, 'object', p); if (o) gl.uniformBlockBinding(o, index, binding); });
  S30('glGetActiveUniformBlockName', `(II)${STRING}`, (r, c, gl, [p, index]) => { const o = lookup(c, 'object', p); return o ? gl.getActiveUniformBlockName(o, index) : null; }, null);
  unsupported(S30, 'glGetActiveUniformBlockName', ['(III[II[BI)V', `(II${BUFFER}${BUFFER})V`], 'use the String-returning glGetActiveUniformBlockName(program, index)');
  both(S30, 'glGetActiveUniformBlockiv', ['(III[II)V', `(III${INT_BUFFER})V`], (r, c, gl, args) => {
    const o = lookup(c, 'object', args[0]); if (!o) return; const v = gl.getActiveUniformBlockParameter(o, args[1], args[2]); if (v === null) return raise(c, GL.INVALID_ENUM);
    writeVec(r, args, 3, 'I', ArrayBuffer.isView(v) ? Array.from(v, Number) : [typeof v === 'boolean' ? (v ? 1 : 0) : Number(v)]);
  });
  for (const sig of ['(II[III[II)V', `(II${INT_BUFFER}I${INT_BUFFER})V`]) S30('glGetActiveUniformsiv', sig, (r, c, gl, args) => {
    const o = lookup(c, 'object', args[0]); if (!o) return; const array = typeof args[3] === 'number' && sig.startsWith('(II[');
    const indices = readInts(r, args, 2, args[1]), pname = array ? args[4] : args[3], v = gl.getActiveUniforms(o, indices, pname); if (!v) return raise(c, GL.INVALID_ENUM);
    writeVec(r, args, array ? 5 : 4, 'I', Array.from(v, x => typeof x === 'boolean' ? (x ? 1 : 0) : Number(x)));
  });
  for (const sig of [`(I[${STRING}[II)V`, `(I[${STRING}${INT_BUFFER})V`]) S30('glGetUniformIndices', sig, (r, c, gl, args) => {
    const o = lookup(c, 'object', args[0]); if (!o) return; if (args[1] === null) r.throwJava(IAE, 'uniformNames == null');
    const names = Array.from(r.array(args[1]).elements, s => r.stringCharacters(s)), v = gl.getUniformIndices(o, names) ?? []; writeVec(r, args, 2, 'I', Array.from(v, x => x >>> 0 | 0));
  });
  S30('glFenceSync', '(II)J', (r, c, gl, [condition, flags]) => { const sync = gl.fenceSync(condition, flags); if (!sync) return 0n; const handle = c.group.nextSync++; c.group.syncs.set(handle, sync); return handle; }, 0n);
  const syncOf = (c, handle) => c.group.syncs.get(BigInt(handle)) ?? null;
  S30('glIsSync', '(J)Z', (r, c, gl, [handle]) => syncOf(c, handle) ? 1 : 0);
  S30('glDeleteSync', '(J)V', (r, c, gl, [handle]) => { const sync = syncOf(c, handle); if (sync) { gl.deleteSync(sync); c.group.syncs.delete(BigInt(handle)); } });
  S30('glClientWaitSync', '(JIJ)I', (r, c, gl, [handle, flags]) => { const sync = syncOf(c, handle); if (!sync) { raise(c, GL.INVALID_VALUE); return 0x911D; } return gl.clientWaitSync(sync, flags, 0); }, 0x911D /* GL_WAIT_FAILED */);
  S30('glWaitSync', '(JIJ)V', (r, c, gl, [handle, flags]) => { const sync = syncOf(c, handle); if (!sync) return raise(c, GL.INVALID_VALUE); gl.waitSync(sync, flags, -1); });
  both(S30, 'glGetSynciv', ['(JII[II[II)V', `(JII${INT_BUFFER}${INT_BUFFER})V`], (r, c, gl, args) => {
    const sync = syncOf(c, args[0]); if (!sync) return raise(c, GL.INVALID_VALUE); const v = gl.getSyncParameter(sync, args[1]); if (v === null) return raise(c, GL.INVALID_ENUM);
    const valuesAt = typeof args[4] === 'number' ? 5 : 4; if (args[3] !== null) writeVec(r, args, 3, 'I', [1]); writeVec(r, args, valuesAt, 'I', [Number(v)]);
  });
}

// ---- EGL ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** EGL over the state above, independent of the Java flavour: EGL14 (android.opengl handles) and EGL10 (gles_jni impls) call these with handles (bigint). */
function eglCore() {
  const DISPLAY = 1n;
  const config = handle => EGL_CONFIGS.find(c => c.handle === BigInt(handle ?? 0n)) ?? null;
  const ready = (r, display) => { const s = stateOf(r); if (BigInt(display ?? 0n) !== DISPLAY) return eglFail(r, EGL.BAD_DISPLAY, false); if (!s.initialized) return eglFail(r, EGL.NOT_INITIALIZED, false); return true; };
  return {
    DISPLAY,
    getDisplay: (r, id) => (id === 0 || id === 0n ? (eglOk(r), DISPLAY) : eglFail(r, EGL.BAD_PARAMETER, 0n)),
    initialize(r, display) {
      const s = stateOf(r); if (BigInt(display ?? 0n) !== DISPLAY) return eglFail(r, EGL.BAD_DISPLAY, null);
      if (!backendOf(r)) r.throwJava(UOE, 'OpenGL ES needs WebGL2 in this browser\'s Worker (OffscreenCanvas with a "webgl2" context), which is not available here');
      s.initialized = true; s.initCount++; eglOk(r); return [1, 4];
    },
    terminate(r, display) { if (BigInt(display ?? 0n) !== DISPLAY) return eglFail(r, EGL.BAD_DISPLAY, 0); stateOf(r).initialized = false; return eglOk(r); },
    queryString(r, display, name) {
      if (!ready(r, display)) return null;
      const value = { [EGL.VENDOR]: 'APK Web Lab', [EGL.VERSION]: '1.4 WebGL2', [EGL.EXTENSIONS]: 'EGL_KHR_create_context EGL_ANDROID_recordable', [EGL.CLIENT_APIS]: 'OpenGL_ES' }[name];
      if (value === undefined) return eglFail(r, EGL.BAD_PARAMETER, null); eglOk(r); return value;
    },
    configs(r, display, attributes) { if (!ready(r, display)) return null; if (attributes === null) return [...EGL_CONFIGS]; const list = chooseConfigs(attributes); if (!list) return eglFail(r, EGL.BAD_ATTRIBUTE, null); eglOk(r); return list; },
    configAttribute(r, display, handle, attribute) {
      if (!ready(r, display)) return null; const c = config(handle); if (!c) return eglFail(r, EGL.BAD_CONFIG, null);
      const v = configAttribute(c, attribute); if (v === undefined) return eglFail(r, EGL.BAD_ATTRIBUTE, null); eglOk(r); return v;
    },
    createContext(r, display, configHandle, shareHandle, attributes) {
      if (!ready(r, display)) return 0n; const c = config(configHandle); if (!c) return eglFail(r, EGL.BAD_CONFIG, 0n);
      let version = 1;
      for (let i = 0; attributes && i + 1 < attributes.length && attributes[i] !== EGL.NONE; i += 2) {
        if (attributes[i] === EGL.CONTEXT_CLIENT_VERSION) version = attributes[i + 1];
        else if (![EGL.CONTEXT_MINOR_VERSION_KHR, EGL.CONTEXT_FLAGS_KHR, EGL.CONTEXT_PRIORITY_LEVEL_IMG].includes(attributes[i])) return eglFail(r, EGL.BAD_ATTRIBUTE, 0n);
      }
      if (version !== 2 && version !== 3) { r.record?.(`EGL eglCreateContext: OpenGL ES ${version}.x is not available (the lab runs ES 2.0 and 3.0 on WebGL2)`); return eglFail(r, EGL.BAD_MATCH, 0n); }
      const share = shareHandle ? stateOf(r).contexts.get(BigInt(shareHandle)) : null; if (shareHandle && !share) return eglFail(r, EGL.BAD_CONTEXT, 0n);
      const context = newContext(r, c, version, share); if (!context) return eglFail(r, EGL.BAD_ALLOC, 0n);
      eglOk(r); return context.handle;
    },
    destroyContext(r, display, handle) {
      if (!ready(r, display)) return 0; const s = stateOf(r), context = s.contexts.get(BigInt(handle ?? 0n)); if (!context) return eglFail(r, EGL.BAD_CONTEXT, 0);
      context.destroyed = true; if (!context.thread) s.contexts.delete(context.handle); return eglOk(r);   // destroyed when it is no longer current anywhere (EGL 1.4 3.7.1.2)
    },
    createWindowSurface(r, display, configHandle, surfaceObject) {
      if (!ready(r, display)) return 0n; const c = config(configHandle); if (!c) return eglFail(r, EGL.BAD_CONFIG, 0n);
      const view = windowOf(r, surfaceObject); if (!view) return eglFail(r, EGL.BAD_NATIVE_WINDOW, 0n);
      const state = r.object(view).surfaceView; if (state.gl) return eglFail(r, EGL.BAD_ALLOC, 0n);   // a window has one producer: another EGL surface of it is EGL_BAD_ALLOC (ANativeWindow already connected)
      const s = stateOf(r), surface = { handle: 0x3000n + s.next++, kind: 'window', config: c, view, viewId: r.object(view).id, targets: new Map(), frames: 0, interval: 1, bound: 0, destroyed: false };
      state.gl = surface; s.surfaces.set(surface.handle, surface); platformOf(r); r.record?.(`EGL window surface on SurfaceView ${surface.viewId}`); eglOk(r); return surface.handle;
    },
    createPbufferSurface(r, display, configHandle, attributes) {
      if (!ready(r, display)) return 0n; const c = config(configHandle); if (!c) return eglFail(r, EGL.BAD_CONFIG, 0n);
      let width = 0, height = 0;
      for (let i = 0; attributes && i + 1 < attributes.length && attributes[i] !== EGL.NONE; i += 2) { if (attributes[i] === EGL.WIDTH) width = attributes[i + 1]; else if (attributes[i] === EGL.HEIGHT) height = attributes[i + 1]; }
      if (width < 0 || height < 0) return eglFail(r, EGL.BAD_PARAMETER, 0n);
      const s = stateOf(r), surface = { handle: 0x3000n + s.next++, kind: 'pbuffer', config: c, width: Math.min(4096, Math.max(1, width)), height: Math.min(4096, Math.max(1, height)), targets: new Map(), frames: 0, bound: 0, destroyed: false };
      s.surfaces.set(surface.handle, surface); eglOk(r); return surface.handle;
    },
    destroySurface(r, display, handle) {
      if (!ready(r, display)) return 0; const s = stateOf(r), surface = s.surfaces.get(BigInt(handle ?? 0n)); if (!surface) return eglFail(r, EGL.BAD_SURFACE, 0);
      surface.destroyed = true; if (!surface.bound) { releaseSurface(r, surface); s.surfaces.delete(surface.handle); } return eglOk(r);
    },
    querySurface(r, display, handle, attribute) {
      if (!ready(r, display)) return null; const surface = stateOf(r).surfaces.get(BigInt(handle ?? 0n)); if (!surface) return eglFail(r, EGL.BAD_SURFACE, null);
      const { width, height } = surfaceSize(r, surface);
      const value = { [EGL.WIDTH]: width, [EGL.HEIGHT]: height, [EGL.CONFIG_ID]: surface.config.id, [EGL.RENDER_BUFFER]: EGL.BACK_BUFFER, [EGL.SWAP_BEHAVIOR]: EGL.BUFFER_DESTROYED, [EGL.LARGEST_PBUFFER]: 0,
        [EGL.HORIZONTAL_RESOLUTION]: -1, [EGL.VERTICAL_RESOLUTION]: -1, [EGL.PIXEL_ASPECT_RATIO]: -1, [EGL.MULTISAMPLE_RESOLVE]: 0x309A, [EGL.TEXTURE_FORMAT]: EGL.NONE, [EGL.TEXTURE_TARGET]: EGL.NONE,
        [EGL.MIPMAP_TEXTURE]: 0, [EGL.MIPMAP_LEVEL]: 0, [EGL.GL_COLORSPACE_KHR]: EGL.GL_COLORSPACE_LINEAR_KHR }[attribute];
      if (value === undefined) return eglFail(r, EGL.BAD_ATTRIBUTE, null); eglOk(r); return value;
    },
    surfaceAttrib(r, display, handle, attribute, value) {
      if (!ready(r, display)) return 0; const surface = stateOf(r).surfaces.get(BigInt(handle ?? 0n)); if (!surface) return eglFail(r, EGL.BAD_SURFACE, 0);
      if (attribute === EGL.SWAP_BEHAVIOR || attribute === EGL.MULTISAMPLE_RESOLVE || attribute === EGL.MIPMAP_LEVEL) return eglOk(r);
      return eglFail(r, EGL.BAD_ATTRIBUTE, 0);
    },
    makeCurrent(r, display, drawHandle, readHandle, contextHandle) {
      const s = stateOf(r), thread = threadOf(r), previous = s.current.get(thread) ?? null;
      const release = () => {
        if (!previous) return; const { context } = previous; context.thread = null;
        for (const surface of new Set([context.draw, context.read])) if (surface) { surface.bound--; if (surface.destroyed && !surface.bound) { releaseSurface(r, surface); s.surfaces.delete(surface.handle); } }
        context.draw = context.read = null; if (context.destroyed) s.contexts.delete(context.handle); s.current.delete(thread);
      };
      if (!contextHandle) { if (drawHandle || readHandle) return eglFail(r, EGL.BAD_MATCH, 0); if (BigInt(display ?? 0n) !== DISPLAY && display) return eglFail(r, EGL.BAD_DISPLAY, 0); release(); return eglOk(r); }
      if (!ready(r, display)) return 0;
      const context = s.contexts.get(BigInt(contextHandle)); if (!context || context.destroyed) return eglFail(r, EGL.BAD_CONTEXT, 0);
      if (context.thread && context.thread !== thread) return eglFail(r, EGL.BAD_ACCESS, 0);
      const draw = drawHandle ? s.surfaces.get(BigInt(drawHandle)) : null, read = readHandle ? s.surfaces.get(BigInt(readHandle)) : null;
      if ((drawHandle && (!draw || draw.destroyed)) || (readHandle && (!read || read.destroyed))) return eglFail(r, EGL.BAD_SURFACE, 0);
      if ((draw && draw.config !== context.config) || (read && read.config !== context.config)) return eglFail(r, EGL.BAD_MATCH, 0);
      if (draw?.kind === 'window' && !r.object(draw.view).surfaceView?.created) return eglFail(r, EGL.BAD_NATIVE_WINDOW, 0);
      if (previous?.context !== context) release(); else { for (const surface of new Set([context.draw, context.read])) if (surface) surface.bound--; }
      context.thread = thread; context.draw = draw; context.read = read; for (const surface of new Set([draw, read])) if (surface) surface.bound++;
      s.current.set(thread, { display: DISPLAY, context });
      applyFramebuffers(r, context);
      if (!context.viewportSet && draw) { const { width, height } = surfaceSize(r, draw); context.gl.viewport(0, 0, width, height); context.gl.scissor(0, 0, width, height); context.viewportSet = true; }   // EGL 1.4 3.7.3: the first make-current sets them to the surface
      return eglOk(r);
    },
    current(r) { const binding = currentOf(r); return binding ? { display: binding.display, context: binding.context.handle, draw: binding.context.draw?.handle ?? 0n, read: binding.context.read?.handle ?? 0n } : null; },
    queryContext(r, display, handle, attribute) {
      if (!ready(r, display)) return null; const context = stateOf(r).contexts.get(BigInt(handle ?? 0n)); if (!context) return eglFail(r, EGL.BAD_CONTEXT, null);
      const value = { [EGL.CONFIG_ID]: context.config.id, [EGL.CONTEXT_CLIENT_TYPE]: EGL.OPENGL_ES_API, [EGL.CONTEXT_CLIENT_VERSION]: context.version, [EGL.RENDER_BUFFER]: context.draw ? (context.draw.kind === 'window' ? EGL.BACK_BUFFER : EGL.BACK_BUFFER) : EGL.NONE }[attribute];
      if (value === undefined) return eglFail(r, EGL.BAD_ATTRIBUTE, null); eglOk(r); return value;
    },
    swapInterval(r, display, interval) { if (!ready(r, display)) return 0; const binding = currentOf(r); if (!binding) return eglFail(r, EGL.BAD_CONTEXT, 0); if (binding.context.draw) binding.context.draw.interval = Math.max(0, Math.min(1, interval)); return eglOk(r); },
    /** eglSwapBuffers: the surface's picture to the page, then the thread waits for the next display frame (interval 1) as a device's buffer queue makes it wait. */
    swapBuffers(r, display, handle) {
      if (!ready(r, display)) return 0; const s = stateOf(r), surface = s.surfaces.get(BigInt(handle ?? 0n)); if (!surface || surface.destroyed) return eglFail(r, EGL.BAD_SURFACE, 0);
      const binding = currentOf(r); if (!binding || binding.context.draw !== surface) return eglFail(r, EGL.BAD_SURFACE, 0);
      if (surface.kind !== 'window') return eglOk(r);   // a pbuffer has no back buffer to post (EGL 1.4 3.9.1: no effect)
      if (!r.object(surface.view).surfaceView?.created) return eglFail(r, EGL.BAD_NATIVE_WINDOW, 0);   // the window went away (surfaceDestroyed): EGL_BAD_NATIVE_WINDOW, as after an abandoned buffer queue
      const context = binding.context, gl = context.gl, target = surfaceTarget(r, context, surface), canvas = context.group.canvas;
      surface.frames++;
      if (canvas && typeof canvas.transferToImageBitmap === 'function') {
        if (canvas.width !== target.width) canvas.width = target.width; if (canvas.height !== target.height) canvas.height = target.height;
        const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), scissor = gl.isEnabled(gl.SCISSOR_TEST);
        if (scissor) gl.disable(gl.SCISSOR_TEST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, GL.COLOR_BUFFER_BIT, GL.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw); if (scissor) gl.enable(gl.SCISSOR_TEST);
        const bitmap = canvas.transferToImageBitmap();
        try { r.platform?.glPresent?.({ viewId: surface.viewId, bitmap, width: target.width, height: target.height, frame: surface.frames, opaque: !surface.config.a }); } catch { bitmap.close?.(); }
      } else r.platform?.glPresent?.({ viewId: surface.viewId, bitmap: null, width: target.width, height: target.height, frame: surface.frames, opaque: !surface.config.a });
      platformOf(r).noteFrame(r, surface);
      eglOk(r);
      if (!surface.interval) return 1;
      // the display's frames: the next vsync of a 60 Hz grid after the last posted frame (one frame per vsync, whatever surface posts; a late frame waits for the next one)
      const clock = r.platform?.clock, now = clock?.now?.() ?? 0, last = s.lastSwap, due = last === undefined ? now : last + VSYNC_MS * Math.max(1, Math.ceil((now - last) / VSYNC_MS)); s.lastSwap = due;
      if (due <= now || !clock) return 1;
      return new Blocked({ ready: () => clock.now() >= due, deadline: due, interruptible: false, reason: 'eglSwapBuffers (waiting for the next display frame)', finish: () => 1 });
    },
    error(r) { const s = stateOf(r), thread = threadOf(r), error = s.errors.get(thread) ?? EGL.SUCCESS; s.errors.set(thread, EGL.SUCCESS); return error; },
  };
}
/** What the snapshot and the page know of GL surfaces (apk-runtime's per-View payload `glSurface`). */
const platforms = new WeakMap();
function platformOf(r) {
  let p = platforms.get(r);
  if (!p) {
    p = { noteFrame(runtime, surface) { surface.lastFrameAt = runtime.platform?.clock?.now?.() ?? 0; }, nodeState(runtime, object) { const surface = object.surfaceView?.gl; return surface && !surface.destroyed ? { viewId: object.id, frames: surface.frames, opaque: !surface.config.a } : undefined; } };
    platforms.set(r, p); if (r.platform) r.platform.gles = p;
  }
  return p;
}

/** The bindings of every GL / EGL native of the original classes: Map 'owner->name(signature)' -> (runtime, args). */
export function createGlesNativeBindings() {
  const bindings = new Map();
  const glAdd = (owner, name, signature, body, fallback) => bindings.set(`${owner}->${name}${signature}`, (r, args) => { const c = glFor(r, name); return c ? body(r, c, c.gl, args) : fallback; });
  glesBindings(glAdd);
  const add = (owner, signature, body) => bindings.set(`${owner}->${signature}`, body);
  for (const owner of [GLES20, GLES30, EGLIMPL, GLIMPL, EGL14]) add(owner, '_nativeClassInit()V', (r) => { if (owner === EGL14) initEgl14Statics(r); });
  const core = eglCore();
  const ints = (r, array, offset = 0) => array === null ? null : Array.from(r.array(array).elements).slice(offset);
  const setInt = (r, array, offset, value) => { if (array === null) return; const elements = r.array(array).elements; if (offset < 0 || offset >= elements.length) r.throwJava(IAE, 'offset out of range'); elements[offset] = value | 0; };
  const construct = (r, type, handle) => { const o = r.allocate(type); r.dispatch({ owner: type, name: '<init>', parameters: ['J'], result: 'V', signature: '(J)V' }, r.argumentWords(['J'], [handle], { receiver: o }), 'direct'); return o; };
  // ---- EGL14 (android.opengl) ----
  const h14 = (r, o) => o === null ? 0n : BigInt(r.object(o).fields.get(H) ?? 0n);
  const obj14 = (r, kind, handle) => construct(r, E14[kind], BigInt(handle ?? 0n));
  function initEgl14Statics(r) {
    for (const [field, kind] of [['EGL_NO_CONTEXT', 'context'], ['EGL_NO_DISPLAY', 'display'], ['EGL_NO_SURFACE', 'surface']]) r.writeStatic({ owner: EGL14, name: field, type: E14[kind] }, obj14(r, kind, 0n));
  }
  add(EGL14, 'eglGetError()I', r => core.error(r));
  add(EGL14, 'eglGetDisplay(I)Landroid/opengl/EGLDisplay;', (r, [id]) => obj14(r, 'display', core.getDisplay(r, id)));
  add(EGL14, 'eglGetDisplay(J)Landroid/opengl/EGLDisplay;', (r, [id]) => obj14(r, 'display', core.getDisplay(r, id)));
  add(EGL14, 'eglInitialize(Landroid/opengl/EGLDisplay;[II[II)Z', (r, [d, major, majorOffset, minor, minorOffset]) => { const v = core.initialize(r, h14(r, d)); if (!v) return 0; setInt(r, major, majorOffset, v[0]); setInt(r, minor, minorOffset, v[1]); return 1; });
  add(EGL14, 'eglTerminate(Landroid/opengl/EGLDisplay;)Z', (r, [d]) => core.terminate(r, h14(r, d)));
  add(EGL14, 'eglQueryString(Landroid/opengl/EGLDisplay;I)Ljava/lang/String;', (r, [d, name]) => core.queryString(r, h14(r, d), name));
  const fillConfigs = (r, list, configs, offset, size, construct14) => { if (configs !== null) { const elements = r.array(configs).elements; list.slice(0, size).forEach((c, i) => { elements[offset + i] = construct14(c); }); } };
  add(EGL14, 'eglGetConfigs(Landroid/opengl/EGLDisplay;[Landroid/opengl/EGLConfig;II[II)Z', (r, [d, configs, offset, size, count, countOffset]) => {
    const list = core.configs(r, h14(r, d), null); if (!list) return 0; fillConfigs(r, list, configs, offset, size, c => obj14(r, 'config', c.handle)); setInt(r, count, countOffset, configs === null ? list.length : Math.min(size, list.length)); return 1;
  });
  add(EGL14, 'eglChooseConfig(Landroid/opengl/EGLDisplay;[II[Landroid/opengl/EGLConfig;II[II)Z', (r, [d, attribs, attribsOffset, configs, offset, size, count, countOffset]) => {
    const list = core.configs(r, h14(r, d), ints(r, attribs, attribsOffset) ?? [EGL.NONE]); if (!list) return 0; fillConfigs(r, list, configs, offset, size, c => obj14(r, 'config', c.handle));
    setInt(r, count, countOffset, configs === null ? list.length : Math.min(size, list.length)); return 1;
  });
  add(EGL14, 'eglGetConfigAttrib(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLConfig;I[II)Z', (r, [d, c, attribute, value, offset]) => { const v = core.configAttribute(r, h14(r, d), h14(r, c), attribute); if (v === null) return 0; setInt(r, value, offset, v); return 1; });
  add(EGL14, '_eglCreateWindowSurface(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLConfig;Ljava/lang/Object;[II)Landroid/opengl/EGLSurface;', (r, [d, c, win]) => obj14(r, 'surface', core.createWindowSurface(r, h14(r, d), h14(r, c), win)));
  add(EGL14, '_eglCreateWindowSurfaceTexture(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLConfig;Ljava/lang/Object;[II)Landroid/opengl/EGLSurface;', r => r.throwJava(UOE, 'eglCreateWindowSurface(SurfaceTexture): a SurfaceTexture as an EGL window is not available in the lab (no buffer queue consumer)'));
  add(EGL14, 'eglCreatePbufferSurface(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLConfig;[II)Landroid/opengl/EGLSurface;', (r, [d, c, attribs, offset]) => obj14(r, 'surface', core.createPbufferSurface(r, h14(r, d), h14(r, c), ints(r, attribs, offset))));
  add(EGL14, 'eglCreatePixmapSurface(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLConfig;I[II)Landroid/opengl/EGLSurface;', r => r.throwJava(UOE, 'eglCreatePixmapSurface: pixmap surfaces are not available (no native pixmaps)'));
  add(EGL14, 'eglDestroySurface(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLSurface;)Z', (r, [d, s]) => core.destroySurface(r, h14(r, d), h14(r, s)));
  add(EGL14, 'eglQuerySurface(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLSurface;I[II)Z', (r, [d, s, attribute, value, offset]) => { const v = core.querySurface(r, h14(r, d), h14(r, s), attribute); if (v === null) return 0; setInt(r, value, offset, v); return 1; });
  add(EGL14, 'eglBindAPI(I)Z', (r, [api]) => api === EGL.OPENGL_ES_API ? eglOk(r) : eglFail(r, EGL.BAD_PARAMETER, 0));
  add(EGL14, 'eglQueryAPI()I', () => EGL.OPENGL_ES_API);
  add(EGL14, 'eglWaitClient()Z', r => eglOk(r)); add(EGL14, 'eglWaitGL()Z', r => eglOk(r)); add(EGL14, 'eglWaitNative(I)Z', r => eglOk(r));
  add(EGL14, 'eglReleaseThread()Z', r => { core.makeCurrent(r, core.DISPLAY, 0n, 0n, 0n); return eglOk(r); });
  for (const sig of ['eglCreatePbufferFromClientBuffer(Landroid/opengl/EGLDisplay;IILandroid/opengl/EGLConfig;[II)Landroid/opengl/EGLSurface;', 'eglCreatePbufferFromClientBuffer(Landroid/opengl/EGLDisplay;IJLandroid/opengl/EGLConfig;[II)Landroid/opengl/EGLSurface;'])
    add(EGL14, sig, r => r.throwJava(UOE, 'eglCreatePbufferFromClientBuffer: client buffers are not available'));
  add(EGL14, 'eglSurfaceAttrib(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLSurface;II)Z', (r, [d, s, attribute, value]) => core.surfaceAttrib(r, h14(r, d), h14(r, s), attribute, value));
  add(EGL14, 'eglBindTexImage(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLSurface;I)Z', r => eglFail(r, EGL.BAD_MATCH, 0));   // no config is EGL_BIND_TO_TEXTURE_RGB(A)
  add(EGL14, 'eglReleaseTexImage(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLSurface;I)Z', r => eglFail(r, EGL.BAD_MATCH, 0));
  add(EGL14, 'eglSwapInterval(Landroid/opengl/EGLDisplay;I)Z', (r, [d, interval]) => core.swapInterval(r, h14(r, d), interval));
  add(EGL14, 'eglCreateContext(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLConfig;Landroid/opengl/EGLContext;[II)Landroid/opengl/EGLContext;', (r, [d, c, share, attribs, offset]) => obj14(r, 'context', core.createContext(r, h14(r, d), h14(r, c), h14(r, share), ints(r, attribs, offset))));
  add(EGL14, 'eglDestroyContext(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLContext;)Z', (r, [d, c]) => core.destroyContext(r, h14(r, d), h14(r, c)));
  add(EGL14, 'eglMakeCurrent(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLSurface;Landroid/opengl/EGLSurface;Landroid/opengl/EGLContext;)Z', (r, [d, draw, read, c]) => core.makeCurrent(r, h14(r, d), h14(r, draw), h14(r, read), h14(r, c)));
  add(EGL14, 'eglGetCurrentContext()Landroid/opengl/EGLContext;', r => obj14(r, 'context', core.current(r)?.context ?? 0n));
  add(EGL14, 'eglGetCurrentSurface(I)Landroid/opengl/EGLSurface;', (r, [which]) => { const c = core.current(r); return obj14(r, 'surface', c ? (which === EGL.READ ? c.read : c.draw) : 0n); });
  add(EGL14, 'eglGetCurrentDisplay()Landroid/opengl/EGLDisplay;', r => obj14(r, 'display', core.current(r)?.display ?? 0n));
  add(EGL14, 'eglQueryContext(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLContext;I[II)Z', (r, [d, c, attribute, value, offset]) => { const v = core.queryContext(r, h14(r, d), h14(r, c), attribute); if (v === null) return 0; setInt(r, value, offset, v); return 1; });
  add(EGL14, 'eglSwapBuffers(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLSurface;)Z', (r, [d, s]) => core.swapBuffers(r, h14(r, d), h14(r, s)));
  add(EGL14, 'eglCopyBuffers(Landroid/opengl/EGLDisplay;Landroid/opengl/EGLSurface;I)Z', r => r.throwJava(UOE, 'eglCopyBuffers: native pixmaps are not available'));
  // ---- EGL10 (com.google.android.gles_jni.EGLImpl) ----
  const h10 = (r, o, kind) => o === null ? 0n : BigInt(r.object(o).fields.get(E10_FIELD[kind]) ?? 0n);
  const D = J_DISPLAY, C = J_CONFIG, X = J_CONTEXT, S = J_SURFACE;
  add(EGLIMPL, `eglGetError()I`, r => core.error(r));
  add(EGLIMPL, `_eglGetDisplay(${OBJECT})J`, (r, [, id]) => core.getDisplay(r, id === null ? 0 : -1));   // EGL10.EGL_DEFAULT_DISPLAY is null
  add(EGLIMPL, `eglInitialize(${D}[I)Z`, (r, [, d, majorMinor]) => { const v = core.initialize(r, h10(r, d, 'display')); if (!v) return 0; if (majorMinor !== null) { const e = r.array(majorMinor).elements; if (e.length < 2) r.throwJava(IAE, 'major_minor.length < 2'); e[0] = v[0]; e[1] = v[1]; } return 1; });
  add(EGLIMPL, `eglTerminate(${D})Z`, (r, [, d]) => core.terminate(r, h10(r, d, 'display')));
  add(EGLIMPL, `eglQueryString(${D}I)${STRING}`, (r, [, d, name]) => core.queryString(r, h10(r, d, 'display'), name));
  const fill10 = (r, list, configs, size, count) => {
    if (configs !== null) { const elements = r.array(configs).elements; if (elements.length < size) r.throwJava(IAE, 'length - offset < config_size'); list.slice(0, size).forEach((c, i) => { elements[i] = construct(r, E10.config, c.handle); }); }
    if (count !== null) r.array(count).elements[0] = configs === null ? list.length : Math.min(size, list.length);
  };
  add(EGLIMPL, `eglGetConfigs(${D}[${C}I[I)Z`, (r, [, d, configs, size, count]) => { const list = core.configs(r, h10(r, d, 'display'), null); if (!list) return 0; fill10(r, list, configs, size, count); return 1; });
  add(EGLIMPL, `eglChooseConfig(${D}[I[${C}I[I)Z`, (r, [, d, attribs, configs, size, count]) => {
    if (attribs === null) r.throwJava(IAE, 'attrib_list == null'); const list = core.configs(r, h10(r, d, 'display'), ints(r, attribs)); if (!list) return 0; fill10(r, list, configs, size, count); return 1;
  });
  add(EGLIMPL, `eglGetConfigAttrib(${D}${C}I[I)Z`, (r, [, d, c, attribute, value]) => { const v = core.configAttribute(r, h10(r, d, 'display'), h10(r, c, 'config'), attribute); if (v === null) return 0; setInt(r, value, 0, v); return 1; });
  add(EGLIMPL, `_eglCreateContext(${D}${C}${X}[I)J`, (r, [, d, c, share, attribs]) => core.createContext(r, h10(r, d, 'display'), h10(r, c, 'config'), share === null ? 0n : h10(r, share, 'context'), ints(r, attribs)));
  add(EGLIMPL, `_eglCreatePbufferSurface(${D}${C}[I)J`, (r, [, d, c, attribs]) => core.createPbufferSurface(r, h10(r, d, 'display'), h10(r, c, 'config'), ints(r, attribs)));
  add(EGLIMPL, `_eglCreatePixmapSurface(${S}${D}${C}${OBJECT}[I)V`, r => r.throwJava(UOE, 'eglCreatePixmapSurface: pixmap surfaces are not available (no native pixmaps)'));
  add(EGLIMPL, `_eglCreateWindowSurface(${D}${C}${OBJECT}[I)J`, (r, [, d, c, win]) => core.createWindowSurface(r, h10(r, d, 'display'), h10(r, c, 'config'), win));
  add(EGLIMPL, `_eglCreateWindowSurfaceTexture(${D}${C}${OBJECT}[I)J`, r => r.throwJava(UOE, 'eglCreateWindowSurface(SurfaceTexture): a SurfaceTexture as an EGL window is not available in the lab (no buffer queue consumer)'));
  add(EGLIMPL, `eglDestroyContext(${D}${X})Z`, (r, [, d, c]) => core.destroyContext(r, h10(r, d, 'display'), h10(r, c, 'context')));
  add(EGLIMPL, `eglDestroySurface(${D}${S})Z`, (r, [, d, s]) => core.destroySurface(r, h10(r, d, 'display'), h10(r, s, 'surface')));
  add(EGLIMPL, `eglMakeCurrent(${D}${S}${S}${X})Z`, (r, [, d, draw, read, c]) => core.makeCurrent(r, h10(r, d, 'display'), h10(r, draw, 'surface'), h10(r, read, 'surface'), h10(r, c, 'context')));
  add(EGLIMPL, `eglQueryContext(${D}${X}I[I)Z`, (r, [, d, c, attribute, value]) => { const v = core.queryContext(r, h10(r, d, 'display'), h10(r, c, 'context'), attribute); if (v === null) return 0; setInt(r, value, 0, v); return 1; });
  add(EGLIMPL, `eglQuerySurface(${D}${S}I[I)Z`, (r, [, d, s, attribute, value]) => { const v = core.querySurface(r, h10(r, d, 'display'), h10(r, s, 'surface'), attribute); if (v === null) return 0; setInt(r, value, 0, v); return 1; });
  add(EGLIMPL, 'eglReleaseThread()Z', r => { core.makeCurrent(r, core.DISPLAY, 0n, 0n, 0n); return eglOk(r); });
  add(EGLIMPL, `eglSwapBuffers(${D}${S})Z`, (r, [, d, s]) => core.swapBuffers(r, h10(r, d, 'display'), h10(r, s, 'surface')));
  add(EGLIMPL, `eglCopyBuffers(${D}${S}${OBJECT})Z`, r => r.throwJava(UOE, 'eglCopyBuffers: native pixmaps are not available'));
  add(EGLIMPL, 'eglWaitGL()Z', r => eglOk(r)); add(EGLIMPL, `eglWaitNative(I${OBJECT})Z`, r => eglOk(r));
  add(EGLIMPL, '_eglGetCurrentContext()J', r => core.current(r)?.context ?? 0n);
  add(EGLIMPL, '_eglGetCurrentDisplay()J', r => core.current(r)?.display ?? 0n);
  add(EGLIMPL, '_eglGetCurrentSurface(I)J', (r, [, which]) => { const c = core.current(r); return c ? (which === EGL.READ ? c.read : c.draw) : 0n; });
  add(EGLIMPL, `getInitCount(${D})I`, (r, [d]) => (h10(r, d, 'display') === core.DISPLAY ? stateOf(r).initCount : 0));
  return bindings;
}
/** The snapshot payload of a SurfaceView an EGL window surface draws into (apk-runtime), or undefined. */
export function glSurfaceNodeState(runtime, object) { return platforms.get(runtime)?.nodeState(runtime, object); }
