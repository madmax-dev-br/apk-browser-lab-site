// libEGL.so, libGLESv2.so / libGLESv3.so and libandroid's (libnativewindow's) ANativeWindow for the app's ARM64 libraries (docs/ARM64-NATIVE.md "EGL and OpenGL ES"),
// as host functions of the ARM64 process (src/arm64/process.js). They run over the same EGL model and WebGL2 contexts as the Java classes (src/gles-native.js): one display,
// the same configs, contexts, surfaces, per-thread current context and error, the same GL object names, error queue, framebuffer-0 mapping and client-side arrays, and the
// same pictures to the page (eglSwapBuffers of a SurfaceView's window). A native renderer and android.opengl in one app share them, as on a device.
//
//   Calls     each GL entry point is the Java binding of the same call (GLES20 / GLES30, their java.nio Buffer overload): a C pointer stands where the Buffer would be (a
//             NativeRegion of the ARM64 memory, read and written there), C strings are read from the memory, a returned string (glGetString) is a C string the process keeps.
//             Calls whose C shape differs (glShaderSource, the info logs and active-variable names, glTexImage* sizes from the pixel-store state, client-side or buffer-offset
//             pointers, mapped buffer ranges, GLboolean output) are written here. Arguments follow AAPCS64 (integers and pointers in X0-X7, floats in S0-S7, the rest on the stack).
//   Threads   a native thread (pthread) is its own EGL thread; a Java thread calling a native method is that Java thread, so EGL14 and native EGL see one current context.
//             eglSwapBuffers on a native thread waits for the next display frame as the Java one does; called synchronously from a Java native method it posts and returns.
//   Windows   ANativeWindow_fromSurface takes the Surface of a SurfaceView (src/camera-surface-host.js); setBuffersGeometry sets its buffer size and format.
// eglGetProcAddress answers the EGL and GL entry points listed here, NULL for any other name (as Android does for an unknown name). Not provided, failing by name: GLES 1.x,
// pixmap surfaces and client-buffer pbuffers, a SurfaceTexture / ImageReader Surface as a native window, ANativeWindow_lock (CPU rendering), EGL extension functions
// (EGLImage, sync objects, presentation time, damage regions). No process.*.
import { APKError } from '../apk-error.js?v=8411deb8def1';
import { BLOCKED } from './cpu.js?v=8411deb8def1';
import { Blocked } from '../scheduler.js?v=8411deb8def1';
import { floatBits } from '../host-contract.js?v=8411deb8def1';
import { createGlesNativeBindings, createEglCore, EGL_CONSTANTS as EGL, glAccess, NativeRegion, configAttribute, EGL_CONFIGS, windowSize } from '../gles-native.js?v=8411deb8def1';
import { utf8 } from './text.js?v=8411deb8def1';

const GLES20 = 'Landroid/opengl/GLES20;', GLES30 = 'Landroid/opengl/GLES30;', STRING = 'Ljava/lang/String;', BUFFER = 'Ljava/nio/Buffer;', INT_BUFFER = 'Ljava/nio/IntBuffer;';
const GL = { INVALID_ENUM: 0x500, INVALID_VALUE: 0x501, INVALID_OPERATION: 0x502, ARRAY_BUFFER_BINDING: 0x8894, ELEMENT_ARRAY_BUFFER_BINDING: 0x8895, PIXEL_PACK_BUFFER_BINDING: 0x88ED,
  PIXEL_UNPACK_BUFFER_BINDING: 0x88EF, BUFFER_SIZE: 0x8764, BUFFER_MAPPED: 0x88BC, BUFFER_MAP_POINTER: 0x88BD, BUFFER_ACCESS_FLAGS: 0x911F, BUFFER_MAP_LENGTH: 0x9120, BUFFER_MAP_OFFSET: 0x9121 };
const PIXEL_FORMAT = { RGBA_8888: 1, RGBX_8888: 2, RGB_565: 4 }, EINVAL = 22, ENODEV = 19;

// ---- pixel sizes (ES 3.0 3.7.2 / 4.3.2): the bytes a glTexImage / glReadPixels pointer covers under the pixel-store state
const COMPONENTS = { 0x1908: 4, 0x1907: 3, 0x8227: 2, 0x1903: 1, 0x1906: 1, 0x1909: 1, 0x190A: 2, 0x8D99: 4, 0x8D98: 3, 0x8228: 2, 0x8D94: 1, 0x1902: 1, 0x84F9: 1 };
const TYPE_BYTES = { 0x1400: 1, 0x1401: 1, 0x1402: 2, 0x1403: 2, 0x1404: 4, 0x1405: 4, 0x1406: 4, 0x140B: 2, 0x8D61: 2 };
const PACKED = { 0x8363: 2, 0x8033: 2, 0x8034: 2, 0x8368: 4, 0x8C3B: 4, 0x8C3E: 4, 0x84FA: 4, 0x8DAD: 8 };
const INDEX_BYTES = { 0x1401: 1, 0x1403: 2, 0x1405: 4 };
function imageBytes(gl, unpack, width, height, depth, format, type) {
  if (width <= 0 || height <= 0 || depth <= 0) return 0;
  const get = (pname, fallback) => { if (!pname) return fallback; const v = gl.getParameter(pname); return typeof v === 'number' ? v : fallback; };
  const [align, row, rows, pixels, image, images] = unpack ? [0x0CF5, 0x0CF2, 0x0CF3, 0x0CF4, 0x806E, 0x806D] : [0x0D05, 0x0D02, 0x0D03, 0x0D04, 0, 0];
  const bpp = PACKED[type] ?? (COMPONENTS[format] ?? 4) * (TYPE_BYTES[type] ?? 1), alignment = get(align, 4), rowLength = get(row, 0) || width, imageHeight = get(image, 0) || height;
  const stride = Math.ceil(rowLength * bpp / alignment) * alignment;
  return (get(images, 0) + depth - 1) * imageHeight * stride + (get(rows, 0) + height - 1) * stride + (get(pixels, 0) + width) * bpp;
}
/** The C arguments of a call in order (AAPCS64): integer / pointer ones from X0-X7 then the stack, float ones from S0-S7 then the stack. */
function cursor(cpu) {
  let gp = 0, fp = 0, stack = Number(cpu.sp); const mem = cpu.mem;
  return { gp() { if (gp < 8) return cpu.x[gp++]; const v = mem.read64(stack); stack += 8; return v; }, fp() { if (fp < 8) return cpu.getS(fp++); const v = mem.float32(stack); stack += 8; return v; } };
}
const params = signature => signature.slice(1, signature.indexOf(')')).match(/\[*(?:L[^;]+;|[ZBCSIJFD])/g) ?? [];

export function addGles(lib, { runtime: r } = {}) {
  const bindings = createGlesNativeBindings(), core = createEglCore(), provided = new Set();
  const { glFor, lookup, raise, setEglError, bufferSubData, primaryBuffer } = glAccess;
  const java = (name, signature) => { const fn = bindings.get(`${GLES20}->${name}${signature}`) ?? bindings.get(`${GLES30}->${name}${signature}`); if (!fn) throw new Error(`internal: no binding ${name}${signature}`); return args => fn(r, args); };
  const str = (p, ptr) => ptr ? utf8.decode(p.memory.cString(Number(ptr))) : null;
  const cString = (p, text) => { if (text === null || text === undefined) return 0; const cache = (p.glStrings ??= new Map()); let ptr = cache.get(text); if (ptr === undefined) { ptr = p.allocString(text); cache.set(text, ptr); } return ptr; };   // kept for the process's life, as a driver's strings are
  const region = (p, ptr, bytes = Infinity, type) => Number(ptr) ? new NativeRegion(p.memory, Number(ptr), bytes, type) : null;
  // the EGL thread of the running native thread: a pthread of the process, or (undefined) the Java thread that called the native method
  const eglThreadOf = p => { const t = p.threads.current; return t.main || t.java ? undefined : t; };
  /** A host entry: runs as the calling thread's EGL thread; a Java exception the shared bindings raise is an explicit failure naming the C function. */
  const entry = (name, fn) => {
    provided.add(name);
    lib[name] = (p, cpu) => {
      const previous = r.eglThread; r.eglThread = eglThreadOf(p);
      try { return fn(p, cpu); }
      catch (error) {
        if (error?.name !== 'JavaException') throw error;
        const message = String(error.message ?? '').startsWith(`${name}:`) ? String(error.message).slice(name.length + 1).trim() : error.message;
        throw new APKError(`ARM64 native code called ${name}: ${message}`, { kind: 'arm64-gles', symbol: name, javaType: error.details?.javaType });
      } finally { r.eglThread = previous; }
    };
  };
  const unavailable = (name, why) => entry(name, () => { throw new APKError(`ARM64 native code called ${name}: ${why}`, { kind: 'arm64-missing-symbol', symbol: name }); });

  // ---- GL: the Java binding of the same call, arguments read per its signature --------------------------------------------------------------------------------------------
  const special = new Set(['glShaderSource', 'glGetShaderInfoLog', 'glGetProgramInfoLog', 'glGetShaderSource', 'glGetActiveAttrib', 'glGetActiveUniform', 'glGetTransformFeedbackVarying',
    'glGetActiveUniformBlockName', 'glTransformFeedbackVaryings', 'glGetUniformIndices', 'glVertexAttribPointer', 'glVertexAttribIPointer', 'glDrawElements', 'glDrawElementsInstanced',
    'glDrawRangeElements', 'glTexImage2D', 'glTexSubImage2D', 'glTexImage3D', 'glTexSubImage3D', 'glCompressedTexImage2D', 'glCompressedTexSubImage2D', 'glCompressedTexImage3D',
    'glCompressedTexSubImage3D', 'glReadPixels', 'glGetBooleanv', 'glGetString', 'glGetStringi', 'glMapBufferRange', 'glFlushMappedBufferRange', 'glUnmapBuffer', 'glGetBufferPointerv',
    'glGetBufferParameteriv', 'glGetBufferParameteri64v', 'glProgramBinary', 'glGetProgramBinary', 'glShaderBinary']);
  const read = (p, a, type) => {
    switch (type) {
      case 'I': return Number(BigInt.asIntN(32, a.gp()));
      case 'Z': return Number(a.gp() & 0xffn) ? 1 : 0;
      case 'J': return BigInt.asIntN(64, a.gp());
      case 'F': return floatBits(a.fp());
      case STRING: return str(p, a.gp());
      default: return region(p, a.gp());   // a pointer where the Java overload takes a java.nio Buffer
    }
  };
  const answer = (type, value) => type === 'V' ? undefined : type === 'Z' ? (value ? 1 : 0) : type === 'J' ? BigInt(value ?? 0n) : value;
  for (const key of bindings.keys()) {
    const m = /^(Landroid\/opengl\/GLES(?:20|30);)->(gl\w+)(\(.*)$/.exec(key); if (!m) continue;
    const [, , name, signature] = m; if (special.has(name) || name.endsWith('Bounds') || signature.slice(0, signature.indexOf(')')).includes('[')) continue;
    const types = params(signature), result = signature.slice(signature.indexOf(')') + 1), call = java(name, signature);
    entry(name, (p, cpu) => { const a = cursor(cpu); return answer(result, call(types.map(type => read(p, a, type)))); });
  }
  const args = (p, cpu, types) => { const a = cursor(cpu); return types.map(type => type === 'P' ? Number(a.gp()) : type === 'L' ? a.gp() : read(p, a, type)); };   // 'P': a raw pointer / offset
  const bound = (gl, pname) => !!gl.getParameter(pname);
  // strings the call writes into a caller buffer: at most bufSize - 1 bytes and a NUL; *length the bytes written without the NUL
  const writeName = (p, c, bufSize, lengthPtr, namePtr, text) => {
    if (bufSize < 0) { raise(c, GL.INVALID_VALUE); return; }
    const bytes = new TextEncoder().encode(text ?? ''), k = Math.max(0, Math.min(bytes.length, bufSize - 1));
    if (bufSize > 0 && namePtr) { p.memory.copyIn(namePtr, bytes.subarray(0, k)); p.memory.setByte(namePtr + k, 0); }
    if (lengthPtr) p.memory.setInt32(lengthPtr, bufSize > 0 ? k : 0);
  };
  entry('glShaderSource', (p, cpu) => {
    const [shader, count, strings, lengths] = args(p, cpu, ['I', 'I', 'P', 'P']), c = glFor(r, 'glShaderSource'); if (!c) return;
    if (count < 0) return raise(c, GL.INVALID_VALUE);
    const parts = []; for (let i = 0; i < count; i++) { const at = p.memory.readPtr(strings + 8 * i), length = lengths ? p.memory.int32(lengths + 4 * i) : -1; parts.push((length < 0 ? p.memory.cString(at) : p.memory.bytes(at, length)).slice()); }
    const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0; for (const part of parts) { all.set(part, at); at += part.length; }
    java('glShaderSource', `(I${STRING})V`)([shader, utf8.decode(all)]);
  });
  for (const name of ['glGetShaderInfoLog', 'glGetProgramInfoLog', 'glGetShaderSource']) entry(name, (p, cpu) => {
    const [object, bufSize, lengthPtr, out] = args(p, cpu, ['I', 'I', 'P', 'P']), c = glFor(r, name); if (!c) return;
    if (lookup(c, 'object', object) === undefined) return;   // GL_INVALID_OPERATION raised, nothing written
    writeName(p, c, bufSize, lengthPtr, out, java(name, `(I)${STRING}`)([object]));
  });
  for (const name of ['glGetActiveAttrib', 'glGetActiveUniform', 'glGetTransformFeedbackVarying']) entry(name, (p, cpu) => {
    const [program, index, bufSize, lengthPtr, size, type, out] = args(p, cpu, ['I', 'I', 'I', 'P', 'P', 'P', 'P']), c = glFor(r, name); if (!c) return;
    const text = java(name, `(II${INT_BUFFER}${INT_BUFFER})${STRING}`)([program, index, region(p, size, 4), region(p, type, 4)]); if (text === null) return;
    writeName(p, c, bufSize, lengthPtr, out, text);
  });
  entry('glGetActiveUniformBlockName', (p, cpu) => {
    const [program, index, bufSize, lengthPtr, out] = args(p, cpu, ['I', 'I', 'I', 'P', 'P']), c = glFor(r, 'glGetActiveUniformBlockName'); if (!c) return;
    const text = java('glGetActiveUniformBlockName', `(II)${STRING}`)([program, index]); if (text === null) return; writeName(p, c, bufSize, lengthPtr, out, text);
  });
  const names = (p, list, count) => Array.from({ length: Math.max(0, count) }, (_, i) => str(p, p.memory.readPtr(list + 8 * i)));
  entry('glTransformFeedbackVaryings', (p, cpu) => {
    const [program, count, list, mode] = args(p, cpu, ['I', 'I', 'P', 'I']), c = glFor(r, 'glTransformFeedbackVaryings'); if (!c) return;
    if (count < 0) return raise(c, GL.INVALID_VALUE); const o = lookup(c, 'object', program); if (!o) return; c.gl.transformFeedbackVaryings(o, names(p, list, count), mode);
  });
  entry('glGetUniformIndices', (p, cpu) => {
    const [program, count, list, out] = args(p, cpu, ['I', 'I', 'P', 'P']), c = glFor(r, 'glGetUniformIndices'); if (!c) return;
    if (count < 0) return raise(c, GL.INVALID_VALUE); const o = lookup(c, 'object', program); if (!o) return;
    const indices = c.gl.getUniformIndices(o, names(p, list, count)) ?? []; for (let i = 0; i < count; i++) p.memory.writeU32(out + 4 * i, indices[i] ?? 0xffffffff);
  });
  // client-side arrays or offsets into the bound buffer object (ES 2.0 2.8, ES 3.0 2.9.6)
  entry('glVertexAttribPointer', (p, cpu) => {
    const [index, size, type, normalized, stride, pointer] = args(p, cpu, ['I', 'I', 'I', 'Z', 'I', 'P']), c = glFor(r, 'glVertexAttribPointer'); if (!c) return;
    if (bound(c.gl, GL.ARRAY_BUFFER_BINDING) || !pointer) java('glVertexAttribPointer', '(IIIZII)V')([index, size, type, normalized, stride, pointer]);
    else java('glVertexAttribPointerBounds', `(IIIZI${BUFFER}I)V`)([index, size, type, normalized, stride, region(p, pointer), 0]);
  });
  entry('glVertexAttribIPointer', (p, cpu) => {
    const [index, size, type, stride, pointer] = args(p, cpu, ['I', 'I', 'I', 'I', 'P']), c = glFor(r, 'glVertexAttribIPointer'); if (!c) return;
    if (bound(c.gl, GL.ARRAY_BUFFER_BINDING) || !pointer) java('glVertexAttribIPointer', '(IIIII)V')([index, size, type, stride, pointer]);
    else java('glVertexAttribIPointerBounds', `(IIII${BUFFER}I)V`)([index, size, type, stride, region(p, pointer), 0]);
  });
  entry('glGetVertexAttribPointerv', (p, cpu) => {
    const [index, pname, out] = args(p, cpu, ['I', 'I', 'P']), c = glFor(r, 'glGetVertexAttribPointerv'); if (!c) return;
    if (pname !== 0x8645 /* GL_VERTEX_ATTRIB_ARRAY_POINTER */) return raise(c, GL.INVALID_ENUM);
    const client = c.clientAttribs.get(index); p.memory.writePtr(out, client?.region instanceof NativeRegion ? client.region.address : c.gl.getVertexAttribOffset(index, pname) ?? 0);
  });
  const indices = (c, p, pointer, count, type) => bound(c.gl, GL.ELEMENT_ARRAY_BUFFER_BINDING) ? pointer : new NativeRegion(p.memory, pointer, Math.max(0, count) * (INDEX_BYTES[type] ?? 2));
  entry('glDrawElements', (p, cpu) => {
    const [mode, count, type, pointer] = args(p, cpu, ['I', 'I', 'I', 'P']), c = glFor(r, 'glDrawElements'); if (!c) return; const i = indices(c, p, pointer, count, type);
    typeof i === 'number' ? java('glDrawElements', '(IIII)V')([mode, count, type, i]) : java('glDrawElements', `(III${BUFFER})V`)([mode, count, type, i]);
  });
  entry('glDrawElementsInstanced', (p, cpu) => {
    const [mode, count, type, pointer, instances] = args(p, cpu, ['I', 'I', 'I', 'P', 'I']), c = glFor(r, 'glDrawElementsInstanced'); if (!c) return; const i = indices(c, p, pointer, count, type);
    typeof i === 'number' ? java('glDrawElementsInstanced', '(IIIII)V')([mode, count, type, i, instances]) : java('glDrawElementsInstanced', `(III${BUFFER}I)V`)([mode, count, type, i, instances]);
  });
  entry('glDrawRangeElements', (p, cpu) => {
    const [mode, start, end, count, type, pointer] = args(p, cpu, ['I', 'I', 'I', 'I', 'I', 'P']), c = glFor(r, 'glDrawRangeElements'); if (!c) return; const i = indices(c, p, pointer, count, type);
    typeof i === 'number' ? java('glDrawRangeElements', '(IIIIII)V')([mode, start, end, count, type, i]) : java('glDrawRangeElements', `(IIIII${BUFFER})V`)([mode, start, end, count, type, i]);
  });
  // pixel transfers: from client memory (the size the pixel-store state gives) or at an offset of the bound pixel unpack / pack buffer
  const unpackOrClient = (name, types, sizeOf, viaOffset, viaBuffer) => entry(name, (p, cpu) => {
    const values = args(p, cpu, types), c = glFor(r, name); if (!c) return; const pointer = values.at(-1), head = values.slice(0, -1);
    if (bound(c.gl, GL.PIXEL_UNPACK_BUFFER_BINDING)) return viaOffset(c, head, pointer);
    viaBuffer(head, pointer ? new NativeRegion(p.memory, pointer, sizeOf(c, head)) : null);
  });
  unpackOrClient('glTexImage2D', ['I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'P'], (c, [, , , w, h, , format, type]) => imageBytes(c.gl, true, w, h, 1, format, type),
    (c, head, offset) => c.gl.texImage2D(...head, offset), (head, data) => java('glTexImage2D', `(IIIIIIII${BUFFER})V`)([...head, data]));
  unpackOrClient('glTexSubImage2D', ['I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'P'], (c, [, , , , w, h, format, type]) => imageBytes(c.gl, true, w, h, 1, format, type),
    (c, head, offset) => c.gl.texSubImage2D(...head, offset), (head, data) => java('glTexSubImage2D', `(IIIIIIII${BUFFER})V`)([...head, data]));
  unpackOrClient('glTexImage3D', ['I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'P'], (c, [, , , w, h, d, , format, type]) => imageBytes(c.gl, true, w, h, d, format, type),
    (c, head, offset) => java('glTexImage3D', '(IIIIIIIIII)V')([...head, offset]), (head, data) => java('glTexImage3D', `(IIIIIIIII${BUFFER})V`)([...head, data]));
  unpackOrClient('glTexSubImage3D', ['I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'P'], (c, [, , , , , w, h, d, format, type]) => imageBytes(c.gl, true, w, h, d, format, type),
    (c, head, offset) => java('glTexSubImage3D', '(IIIIIIIIIII)V')([...head, offset]), (head, data) => java('glTexSubImage3D', `(IIIIIIIIII${BUFFER})V`)([...head, data]));
  unpackOrClient('glCompressedTexImage2D', ['I', 'I', 'I', 'I', 'I', 'I', 'I', 'P'], (c, head) => Math.max(0, head[6]),
    (c, head, offset) => c.gl.compressedTexImage2D(...head, offset), (head, data) => java('glCompressedTexImage2D', `(IIIIIII${BUFFER})V`)([...head, data]));
  unpackOrClient('glCompressedTexSubImage2D', ['I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'P'], (c, head) => Math.max(0, head[7]),
    (c, head, offset) => c.gl.compressedTexSubImage2D(...head, offset), (head, data) => java('glCompressedTexSubImage2D', `(IIIIIIII${BUFFER})V`)([...head, data]));
  unpackOrClient('glCompressedTexImage3D', ['I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'P'], (c, head) => Math.max(0, head[7]),
    (c, head, offset) => java('glCompressedTexImage3D', '(IIIIIIIII)V')([...head, offset]), (head, data) => java('glCompressedTexImage3D', `(IIIIIIII${BUFFER})V`)([...head, data]));
  unpackOrClient('glCompressedTexSubImage3D', ['I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'I', 'P'], (c, head) => Math.max(0, head[9]),
    (c, head, offset) => java('glCompressedTexSubImage3D', '(IIIIIIIIIII)V')([...head, offset]), (head, data) => java('glCompressedTexSubImage3D', `(IIIIIIIIII${BUFFER})V`)([...head, data]));
  entry('glReadPixels', (p, cpu) => {
    const [x, y, w, h, format, type, pointer] = args(p, cpu, ['I', 'I', 'I', 'I', 'I', 'I', 'P']), c = glFor(r, 'glReadPixels'); if (!c) return;
    if (bound(c.gl, GL.PIXEL_PACK_BUFFER_BINDING)) return java('glReadPixels', '(IIIIIII)V')([x, y, w, h, format, type, pointer]);
    java('glReadPixels', `(IIIIII${BUFFER})V`)([x, y, w, h, format, type, new NativeRegion(p.memory, pointer, imageBytes(c.gl, false, w, h, 1, format, type))]);
  });
  entry('glGetBooleanv', (p, cpu) => { const [pname, out] = args(p, cpu, ['I', 'P']); java('glGetBooleanv', `(I${INT_BUFFER})V`)([pname, new NativeRegion(p.memory, out, Infinity, 'B')]); });   // GLboolean: one byte each
  entry('glGetString', (p, cpu) => cString(p, java('glGetString', `(I)${STRING}`)(args(p, cpu, ['I']))));
  entry('glGetStringi', (p, cpu) => cString(p, java('glGetStringi', `(II)${STRING}`)(args(p, cpu, ['I', 'I']))));
  // mapped buffer ranges (ES 3.0 2.10.3): the range is a block of the process memory, filled from the buffer (getBufferSubData) unless invalidated, written back on unmap
  const BINDING = { 0x8892: 0x8894, 0x8893: 0x8895, 0x8F36: 0x8F36, 0x8F37: 0x8F37, 0x88EB: 0x88ED, 0x88EC: 0x88EF, 0x8C8E: 0x8C8F, 0x8A11: 0x8A28 };
  const MAP = { READ: 1, WRITE: 2, INVALIDATE_RANGE: 4, INVALIDATE_BUFFER: 8, FLUSH_EXPLICIT: 0x10, UNSYNCHRONIZED: 0x20 };
  const mappedOf = (c, target) => { const pname = BINDING[target]; if (!pname) { raise(c, GL.INVALID_ENUM); return null; } const bound = c.gl.getParameter(pname); if (!bound) { raise(c, GL.INVALID_OPERATION); return null; } const buffer = primaryBuffer(c, bound); c.group.mapped ??= new Map(); return { buffer, mapping: c.group.mapped.get(buffer) ?? null }; };
  entry('glMapBufferRange', (p, cpu) => {
    const [target, offset, length, access] = args(p, cpu, ['I', 'L', 'L', 'I']), c = glFor(r, 'glMapBufferRange'); if (!c) return 0;
    const at = mappedOf(c, target); if (!at) return 0; const gl = c.gl, start = Number(BigInt.asIntN(64, offset)), size = Number(BigInt.asIntN(64, length)), total = Number(gl.getBufferParameter(target, GL.BUFFER_SIZE) ?? 0);
    if (start < 0 || size <= 0 || start + size > total || access & ~0x3f) { raise(c, GL.INVALID_VALUE); return 0; }
    if (at.mapping || !(access & (MAP.READ | MAP.WRITE)) || (access & MAP.READ && access & (MAP.INVALIDATE_RANGE | MAP.INVALIDATE_BUFFER | MAP.UNSYNCHRONIZED)) || (access & MAP.FLUSH_EXPLICIT && !(access & MAP.WRITE))) { raise(c, GL.INVALID_OPERATION); return 0; }
    const ptr = p.malloc(size);
    if (!(access & (MAP.INVALIDATE_RANGE | MAP.INVALIDATE_BUFFER))) { const bytes = new Uint8Array(size); gl.getBufferSubData(target, start, bytes); p.memory.copyIn(ptr, bytes); } else p.memory.fill(ptr, 0, size);
    c.group.mapped.set(at.buffer, { ptr, offset: start, length: size, access, flushed: [] }); return ptr;
  });
  entry('glFlushMappedBufferRange', (p, cpu) => {
    const [target, offset, length] = args(p, cpu, ['I', 'L', 'L']), c = glFor(r, 'glFlushMappedBufferRange'); if (!c) return; const at = mappedOf(c, target); if (!at) return;
    const m = at.mapping, start = Number(BigInt.asIntN(64, offset)), size = Number(BigInt.asIntN(64, length));
    if (!m || !(m.access & MAP.FLUSH_EXPLICIT)) return raise(c, GL.INVALID_OPERATION); if (start < 0 || size < 0 || start + size > m.length) return raise(c, GL.INVALID_VALUE);
    m.flushed.push([start, size]);
  });
  entry('glUnmapBuffer', (p, cpu) => {
    const [target] = args(p, cpu, ['I']), c = glFor(r, 'glUnmapBuffer'); if (!c) return 0; const at = mappedOf(c, target); if (!at) return 0; const m = at.mapping;
    if (!m) { raise(c, GL.INVALID_OPERATION); return 0; }
    if (m.access & MAP.WRITE) for (const [start, size] of m.access & MAP.FLUSH_EXPLICIT ? m.flushed : [[0, m.length]]) if (size) bufferSubData(c, target, m.offset + start, p.memory.bytes(m.ptr + start, size).slice());
    p.free(m.ptr); c.group.mapped.delete(at.buffer); return 1;
  });
  entry('glGetBufferPointerv', (p, cpu) => {
    const [target, pname, out] = args(p, cpu, ['I', 'I', 'P']), c = glFor(r, 'glGetBufferPointerv'); if (!c) return; if (pname !== GL.BUFFER_MAP_POINTER) return raise(c, GL.INVALID_ENUM);
    const at = mappedOf(c, target); if (at) p.memory.writePtr(out, at.mapping?.ptr ?? 0);
  });
  const mapState = (m, pname) => pname === GL.BUFFER_MAPPED ? (m ? 1 : 0) : pname === GL.BUFFER_ACCESS_FLAGS ? m?.access ?? 0 : pname === GL.BUFFER_MAP_LENGTH ? m?.length ?? 0 : m?.offset ?? 0;
  const MAP_PNAMES = new Set([GL.BUFFER_MAPPED, GL.BUFFER_ACCESS_FLAGS, GL.BUFFER_MAP_LENGTH, GL.BUFFER_MAP_OFFSET]);
  for (const [name, signature, long] of [['glGetBufferParameteriv', `(II${INT_BUFFER})V`, false], ['glGetBufferParameteri64v', '(IILjava/nio/LongBuffer;)V', true]]) entry(name, (p, cpu) => {
    const [target, pname, out] = args(p, cpu, ['I', 'I', 'P']);
    if (!MAP_PNAMES.has(pname)) return java(name, signature)([target, pname, region(p, out)]);
    const c = glFor(r, name); if (!c) return; const at = mappedOf(c, target); if (!at) return; const value = mapState(at.mapping, pname);
    if (long) p.memory.write64(out, BigInt(value)); else p.memory.setInt32(out, value);
  });
  // program and shader binaries: the lab lists no binary format (GL_NUM_PROGRAM_BINARY_FORMATS / GL_NUM_SHADER_BINARY_FORMATS are 0), so every format is GL_INVALID_ENUM (ES 3.0 2.12.6)
  const noBinaries = (name, error) => entry(name, (p, cpu) => {
    const c = glFor(r, name); if (!c) return; if (!c.warnedBinary) { c.warnedBinary = true; r.record?.(`GL ${name}: program and shader binaries are not available (no binary formats); the app compiles from source`); }
    if (name === 'glGetProgramBinary') { const [, , lengthPtr] = args(p, cpu, ['I', 'I', 'P']); if (lengthPtr) p.memory.setInt32(lengthPtr, 0); }
    raise(c, error);
  });
  noBinaries('glProgramBinary', GL.INVALID_ENUM); noBinaries('glShaderBinary', GL.INVALID_ENUM); noBinaries('glGetProgramBinary', GL.INVALID_OPERATION);

  // ---- EGL ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const h = v => BigInt.asUintN(64, BigInt(v));   // EGLDisplay / EGLConfig / EGLContext / EGLSurface: the lab's handles as pointers
  const attributes = (p, ptr) => { if (!ptr) return [EGL.NONE]; const out = []; for (let at = Number(ptr); out.length < 1024; at += 8) { const key = p.memory.int32(at); out.push(key); if (key === EGL.NONE) break; out.push(p.memory.int32(at + 4)); } return out; };
  const eglOk = (value = 1) => { setEglError(r, EGL.SUCCESS); return value; }, eglFail = (error, value = 0) => { setEglError(r, error); return value; };
  const out32 = (p, ptr, value) => { if (Number(ptr)) p.memory.setInt32(Number(ptr), value); };
  entry('eglGetError', () => core.error(r));
  entry('eglGetDisplay', (p, cpu) => core.getDisplay(r, cpu.x[0]));
  entry('eglInitialize', (p, cpu) => { const v = core.initialize(r, cpu.x[0]); if (!v) return 0; out32(p, cpu.x[1], v[0]); out32(p, cpu.x[2], v[1]); return 1; });
  entry('eglTerminate', (p, cpu) => core.terminate(r, cpu.x[0]));
  entry('eglQueryString', (p, cpu) => cString(p, core.queryString(r, cpu.x[0], Number(BigInt.asIntN(32, cpu.x[1])))));
  const fillConfigs = (p, list, configs, size, count) => {
    if (!Number(count)) return eglFail(EGL.BAD_PARAMETER);
    const n = Number(configs) ? Math.max(0, Math.min(size, list.length)) : list.length;
    if (Number(configs)) for (let i = 0; i < n; i++) p.memory.write64(Number(configs) + 8 * i, list[i].handle);
    p.memory.setInt32(Number(count), n); return 1;
  };
  entry('eglGetConfigs', (p, cpu) => { const list = core.configs(r, cpu.x[0], null); return list ? fillConfigs(p, list, cpu.x[1], Number(BigInt.asIntN(32, cpu.x[2])), cpu.x[3]) : 0; });
  entry('eglChooseConfig', (p, cpu) => { const list = core.configs(r, cpu.x[0], attributes(p, cpu.x[1])); return list ? fillConfigs(p, list, cpu.x[2], Number(BigInt.asIntN(32, cpu.x[3])), cpu.x[4]) : 0; });
  entry('eglGetConfigAttrib', (p, cpu) => { const v = core.configAttribute(r, cpu.x[0], cpu.x[1], Number(BigInt.asIntN(32, cpu.x[2]))); if (v === null) return 0; out32(p, cpu.x[3], v); return 1; });
  entry('eglCreateWindowSurface', (p, cpu) => {
    const window = windows.get(Number(cpu.x[2])); if (!window) return eglFail(EGL.BAD_NATIVE_WINDOW, 0n);
    const list = attributes(p, cpu.x[3]);
    for (let i = 0; i + 1 < list.length; i += 2) if (!(list[i] === EGL.RENDER_BUFFER && list[i + 1] === EGL.BACK_BUFFER)) return eglFail(EGL.BAD_ATTRIBUTE, 0n);   // the window attributes of EGL 1.4 the lab's surfaces have
    const handle = core.createWindowSurface(r, cpu.x[0], cpu.x[1], window.surface);
    if (handle) { const config = EGL_CONFIGS.find(c => c.handle === h(cpu.x[1])); if (config) window.format = configAttribute(config, EGL.NATIVE_VISUAL_ID); }   // as Android's EGL sets the window's buffer format to the config's visual
    return h(handle);
  });
  entry('eglCreatePbufferSurface', (p, cpu) => h(core.createPbufferSurface(r, cpu.x[0], cpu.x[1], attributes(p, cpu.x[2]))));
  unavailable('eglCreatePixmapSurface', 'pixmap surfaces are not available (no native pixmaps)');
  unavailable('eglCreatePbufferFromClientBuffer', 'client buffers are not available');
  unavailable('eglCopyBuffers', 'native pixmaps are not available');
  entry('eglDestroySurface', (p, cpu) => core.destroySurface(r, cpu.x[0], cpu.x[1]));
  entry('eglQuerySurface', (p, cpu) => { const v = core.querySurface(r, cpu.x[0], cpu.x[1], Number(BigInt.asIntN(32, cpu.x[2]))); if (v === null) return 0; out32(p, cpu.x[3], v); return 1; });
  entry('eglSurfaceAttrib', (p, cpu) => core.surfaceAttrib(r, cpu.x[0], cpu.x[1], Number(BigInt.asIntN(32, cpu.x[2])), Number(BigInt.asIntN(32, cpu.x[3]))));
  entry('eglBindAPI', (p, cpu) => Number(BigInt.asIntN(32, cpu.x[0])) === EGL.OPENGL_ES_API ? eglOk() : eglFail(EGL.BAD_PARAMETER));
  entry('eglQueryAPI', () => EGL.OPENGL_ES_API);
  for (const name of ['eglWaitClient', 'eglWaitGL', 'eglWaitNative']) entry(name, () => eglOk());
  entry('eglReleaseThread', () => { core.makeCurrent(r, core.DISPLAY, 0n, 0n, 0n); return eglOk(); });
  entry('eglBindTexImage', () => eglFail(EGL.BAD_MATCH)); entry('eglReleaseTexImage', () => eglFail(EGL.BAD_MATCH));   // no config is EGL_BIND_TO_TEXTURE_RGB(A)
  entry('eglSwapInterval', (p, cpu) => core.swapInterval(r, cpu.x[0], Number(BigInt.asIntN(32, cpu.x[1]))));
  entry('eglCreateContext', (p, cpu) => h(core.createContext(r, cpu.x[0], cpu.x[1], cpu.x[2], attributes(p, cpu.x[3]))));
  entry('eglDestroyContext', (p, cpu) => core.destroyContext(r, cpu.x[0], cpu.x[1]));
  entry('eglMakeCurrent', (p, cpu) => core.makeCurrent(r, cpu.x[0], cpu.x[1], cpu.x[2], cpu.x[3]));
  entry('eglGetCurrentContext', () => h(core.current(r)?.context ?? 0n));
  entry('eglGetCurrentSurface', (p, cpu) => { const c = core.current(r); return h(c ? (Number(BigInt.asIntN(32, cpu.x[0])) === EGL.READ ? c.read : c.draw) : 0n); });
  entry('eglGetCurrentDisplay', () => h(core.current(r)?.display ?? 0n));
  entry('eglQueryContext', (p, cpu) => { const v = core.queryContext(r, cpu.x[0], cpu.x[1], Number(BigInt.asIntN(32, cpu.x[2]))); if (v === null) return 0; out32(p, cpu.x[3], v); return 1; });
  // eglSwapBuffers: posts the frame (the page draws it in the SurfaceView's box), then a native thread waits for the next display frame; a retried call only finishes the wait
  entry('eglSwapBuffers', (p, cpu) => {
    const threads = p.threads, t = threads.current;
    if (t.eglSwapUntil === undefined) {
      const result = core.swapBuffers(r, cpu.x[0], cpu.x[1]);
      if (!(result instanceof Blocked)) return result;
      if (!threads.canSuspend(cpu)) return 1;   // a native method called from Java cannot suspend the Java thread: the frame is posted, the call returns (as sleep does there)
      t.eglSwapUntil = threads.now() + Math.max(0, result.deadline - (r.platform?.clock?.now?.() ?? 0));
    }
    const until = t.eglSwapUntil, got = threads.wait(cpu, () => threads.now() >= until, { what: 'eglSwapBuffers (the next display frame)', deadline: until });
    if (got === BLOCKED) return BLOCKED;
    t.eglSwapUntil = undefined; return 1;
  });
  entry('eglGetProcAddress', (p, cpu) => { const name = str(p, cpu.x[0]); return name && provided.has(name) ? p.hostEntry(name, lib[name]) : 0; });

  // ---- ANativeWindow (libandroid / libnativewindow) over a SurfaceView's Surface -------------------------------------------------------------------------------------------
  const windows = new Map();   // ANativeWindow* -> { surface (the Java Surface), view (its SurfaceView), refs, format }
  const windowAt = (p, ptr, name) => windows.get(Number(ptr)) ?? (() => { throw new APKError(`ARM64 native code called ${name} with 0x${Number(ptr).toString(16)}, which is not an ANativeWindow ANativeWindow_fromSurface returned (or it was released)`, { kind: 'arm64-native-window', symbol: name }); })();
  const stateOf = window => r.object(window.view).surfaceView;
  const valid = window => !!stateOf(window)?.created;
  lib.ANativeWindow_fromSurface = (p, cpu) => {
    const surface = Number(cpu.x[1]) ? r.jni.valueOf(cpu.x[1]) : null; if (surface === null || surface === undefined || surface === 0) return 0;
    const sink = r.object(surface).surface?.sink; if (!sink) return 0;   // a Surface without a producer (released, or never connected): NULL, as android_view_Surface_getNativeWindow gives
    if (sink.kind !== 'holder') throw new APKError(`ARM64 native code called ANativeWindow_fromSurface with the Surface of ${sink.kind === 'texture' ? 'a SurfaceTexture (TextureView)' : sink.kind === 'reader' ? 'an ImageReader' : `a ${sink.kind}`}: the lab gives native code the window of a SurfaceView's Surface only`, { kind: 'arm64-native-window', symbol: 'ANativeWindow_fromSurface' });
    if (!sink.valid?.()) return 0;
    for (const [ptr, window] of windows) if (window.surface === surface || r.object(window.surface) === r.object(surface)) { window.refs++; return ptr; }   // one ANativeWindow per Surface, as the Surface is the window
    const ptr = p.malloc(16); p.memory.writeU32(ptr, 0x5f776e64 /* '_wnd' */);
    windows.set(ptr, { surface, view: sink.view, refs: 1, format: null }); r.record?.(`ANativeWindow 0x${ptr.toString(16)} of SurfaceView ${r.object(sink.view).id}`); return ptr;
  };
  lib.ANativeWindow_acquire = (p, cpu) => { windowAt(p, cpu.x[0], 'ANativeWindow_acquire').refs++; };
  lib.ANativeWindow_release = (p, cpu) => { const window = windowAt(p, cpu.x[0], 'ANativeWindow_release'); if (--window.refs === 0) { windows.delete(Number(cpu.x[0])); p.free(Number(cpu.x[0])); } };
  lib.ANativeWindow_getWidth = (p, cpu) => { const window = windowAt(p, cpu.x[0], 'ANativeWindow_getWidth'); return valid(window) ? windowSize(r, window.view).width : -ENODEV; };
  lib.ANativeWindow_getHeight = (p, cpu) => { const window = windowAt(p, cpu.x[0], 'ANativeWindow_getHeight'); return valid(window) ? windowSize(r, window.view).height : -ENODEV; };
  lib.ANativeWindow_getFormat = (p, cpu) => {
    const window = windowAt(p, cpu.x[0], 'ANativeWindow_getFormat'); if (!valid(window)) return -ENODEV; if (window.format) return window.format;
    const format = stateOf(window).format; return format === -1 ? PIXEL_FORMAT.RGBX_8888 : format === -2 || format === -3 ? PIXEL_FORMAT.RGBA_8888 : format;   // PixelFormat.OPAQUE / TRANSPARENT / TRANSLUCENT as SurfaceFlinger picks them
  };
  lib.ANativeWindow_setBuffersGeometry = (p, cpu) => {
    const window = windowAt(p, cpu.x[0], 'ANativeWindow_setBuffersGeometry'), [width, height, format] = [1, 2, 3].map(i => Number(BigInt.asIntN(32, cpu.x[i])));
    if (width < 0 || height < 0 || (width === 0) !== (height === 0)) return -EINVAL;
    const state = stateOf(window); if (state) state.bufferGeometry = width ? { width, height } : null; if (format) window.format = format; return 0;
  };
  return lib;
}
