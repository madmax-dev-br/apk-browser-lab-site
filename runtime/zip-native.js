import { APKError } from './apk-error.js?v=cfd2299f1410';
import { throwNew } from './java-throw.js?v=cfd2299f1410';
import { readNativeBytes } from './unsafe-native.js?v=cfd2299f1410';

// Natives of java.util.zip behind the original libcore classes (android-13.0.0_r1):
//   Inflater / Deflater / CRC32 / Adler32  -- Android's external/zlib compiled to WebAssembly (vendor/zlib); the wrappers follow ojluni Inflater.c, Deflater.c, CRC32.c, Adler32.c
//   ZipFile                                 -- libcore's ojluni zip_util.c compiled to the same module; the wrappers below follow ZipFile.c. File access goes through the
//                                              app's virtual filesystem (a descriptor table owned by this engine).
const INFLATER = 'Ljava/util/zip/Inflater;', DEFLATER = 'Ljava/util/zip/Deflater;', CRC32 = 'Ljava/util/zip/CRC32;', ADLER32 = 'Ljava/util/zip/Adler32;', ZIPFILE = 'Ljava/util/zip/ZipFile;';
const Z_OK = 0, Z_STREAM_END = 1, Z_NEED_DICT = 2, Z_STREAM_ERROR = -2, Z_DATA_ERROR = -3, Z_MEM_ERROR = -4, Z_BUF_ERROR = -5, Z_VERSION_ERROR = -6;
const OPEN_FLAG_READ = 1;
const decoder = new TextDecoder('utf-8'), encoder = new TextEncoder();
const fail = (message, kind = 'zip-native-boundary') => { throw new APKError(message, { kind, backend: 'android13-zlib+zip_util/Wasm' }); };

export class ZlibProvider {
  constructor({ baseURL = new URL('../vendor/zlib/', import.meta.url), fetchImpl, wasmBytes, metadata } = {}) {
    this.baseURL = new URL(baseURL, import.meta.url); this.fetchImpl = fetchImpl || (url => globalThis.fetch(url)); this.wasmBytes = wasmBytes; this.metadata = metadata;
  }
  async read(url, maximum) {
    const response = await this.fetchImpl(url); if (!response.ok) fail(`zlib asset unavailable (HTTP ${response.status})`);
    const buffer = await response.arrayBuffer(); if (buffer.byteLength > maximum) fail('zlib asset exceeds bounded size'); return new Uint8Array(buffer);
  }
  load() { return this.promise ??= this.initialize().catch(error => { this.promise = null; throw error; }); }
  async initialize() {
    const metadata = this.metadata || JSON.parse(decoder.decode(await this.read(new URL('provenance.json', this.baseURL), 256 * 1024)));
    if (metadata.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(metadata.sha256 ?? '')) fail('Unsupported zlib provenance');
    const bytes = this.wasmBytes || await this.read(new URL(metadata.file, this.baseURL), 4 * 1024 * 1024);
    const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== metadata.sha256 || bytes.length !== metadata.bytes) fail('zlib Wasm does not match its pinned SHA-256', 'zlib-hash-mismatch');
    return { module: await WebAssembly.compile(bytes), metadata: { ...metadata, source: 'android-13.0.0_r1 external/zlib + libcore zip_util.c / Wasm', verified: true } };
  }
}

class ZlibEngine {
  constructor({ module }, runtime) {
    this.runtime = runtime; this.fds = new Map(); this.nextFd = 3;
    const self = this, memory = () => new Uint8Array(this.x.memory.buffer);
    const fileOf = fd => this.fds.get(fd);
    const imports = {
      apkweb_zip: {
        fd_close(fd) { self.fds.delete(fd); return 0; },
        fd_size(fd) { const file = fileOf(fd); if (globalThis.process?.env?.APKWEB_DEBUG_ZIP) console.error('fd_size', fd, file?.node?.size); return file ? BigInt(file.node.size) : -1n; },
        fd_pread(fd, buffer, count, offset) {
          const file = fileOf(fd); if (globalThis.process?.env?.APKWEB_DEBUG_ZIP) console.error('fd_pread', fd, buffer, count, offset); if (!file) return -9; // EBADF
          const got = self.runtime.platform.javaIo.fs().readAt(file.node, Number(offset), memory().subarray(buffer, buffer + count), 0, count); return got < 0 ? 0 : got;
        },
      },
      wasi_snapshot_preview1: { fd_pread: () => 52, fd_close: () => 0, fd_write: () => 52, fd_seek: () => 52 },
      env: { emscripten_notify_memory_growth() {} },
    };
    for (const entry of WebAssembly.Module.imports(module)) if (!imports[entry.module]?.[entry.name]) fail(`zlib Wasm imports unsupported host function ${entry.module}.${entry.name}`);
    this.x = new WebAssembly.Instance(module, imports).exports; this.x._initialize?.();
  }
  bytes() { return new Uint8Array(this.x.memory.buffer); }
  view() { return new DataView(this.x.memory.buffer); }
  alloc(size) { const pointer = this.x.malloc(Math.max(1, size)); if (!pointer) throw new APKError('zlib Wasm heap exhausted', { kind: 'zlib-oom' }); return pointer; }
  cstr(pointer) { if (!pointer) return null; const bytes = this.bytes(); let end = pointer; while (bytes[end]) end++; return decoder.decode(bytes.subarray(pointer, end)); }
  /** Copies elements [offset, offset+count) of a Java byte[] into Wasm memory (returns the pointer; caller frees). */
  upload(array, offset, count) {
    const elements = array.elements, pointer = this.alloc(count), view = this.bytes();
    for (let i = 0; i < count; i++) view[pointer + i] = elements[offset + i] & 0xff; return pointer;
  }
  download(pointer, array, offset, count) { const view = this.bytes(), elements = array.elements; for (let i = 0; i < count; i++) elements[offset + i] = (view[pointer + i] << 24) >> 24; }
}

const engines = new WeakMap();
function engineFor(runtime) {
  let engine = engines.get(runtime); if (engine) return engine;
  if (!runtime.zlibBackend?.module) fail('java.util.zip needs the verified zlib Wasm backend (options.zlibProvider)', 'zlib-backend-missing');
  engine = new ZlibEngine(runtime.zlibBackend, runtime); engines.set(runtime, engine); runtime.zlibMetadata = runtime.zlibBackend.metadata; return engine;
}
const stream = (runtime, handle) => { const pointer = Number(handle); if (!pointer) runtime.throwJava('Ljava/lang/IllegalStateException;', 'zlib stream is closed'); return pointer; };

export function createZipNativeBindings() {
  const bindings = new Map(), add = (owner, signature, callback) => bindings.set(`${owner}->${signature}`, callback);
  const field = (runtime, owner, name, type) => `${owner}->${name}:${type}`;

  // ---- Inflater.c
  add(INFLATER, 'init(Z)J', (runtime, [nowrap]) => {
    const e = engineFor(runtime), strm = e.x.zl_new(); if (!strm) throwNew(runtime, 'Ljava/lang/OutOfMemoryError;');
    const ret = e.x.zl_inflate_init(strm, nowrap ? 1 : 0);
    if (ret === Z_OK) return BigInt(strm);
    const message = e.cstr(e.x.zl_msg(strm)); e.x.zl_free(strm);
    if (ret === Z_MEM_ERROR) throwNew(runtime, 'Ljava/lang/OutOfMemoryError;');
    throwNew(runtime, 'Ljava/lang/InternalError;', message ?? (ret === Z_VERSION_ERROR ? 'zlib returned Z_VERSION_ERROR: compile time and runtime zlib implementations differ' : ret === Z_STREAM_ERROR ? 'inflateInit2 returned Z_STREAM_ERROR' : 'unknown error initializing zlib library'));
  });
  add(INFLATER, 'setDictionary(J[BII)V', (runtime, [handle, array, off, len]) => {
    const e = engineFor(runtime), strm = stream(runtime, handle), buffer = e.upload(runtime.array(array), off, len), res = e.x.zl_inflate_set_dictionary(strm, buffer, len); e.x.free(buffer);
    if (res === Z_OK) return;
    const message = e.cstr(e.x.zl_msg(strm));
    throwNew(runtime, res === Z_STREAM_ERROR || res === Z_DATA_ERROR ? 'Ljava/lang/IllegalArgumentException;' : 'Ljava/lang/InternalError;', message);
  });
  add(INFLATER, 'inflateBytes(J[BII)I', (runtime, [self, handle, output, off, len]) => {
    const e = engineFor(runtime), strm = stream(runtime, handle), fields = runtime.object(self).fields, key = name => field(runtime, INFLATER, name, name === 'buf' ? '[B' : name === 'needDict' || name === 'finished' ? 'Z' : 'I');
    const inputArray = runtime.array(fields.get(key('buf'))), thisOff = fields.get(key('off')) | 0, thisLen = fields.get(key('len')) | 0;
    const target = runtime.array(output), inPtr = e.upload(inputArray, thisOff, thisLen), outPtr = e.alloc(len);
    const ret = e.x.zl_inflate(strm, inPtr, thisLen, outPtr, len), availIn = e.x.zl_avail_in(strm), availOut = e.x.zl_avail_out(strm);
    e.download(outPtr, target, off, len - availOut); e.x.free(inPtr); e.x.free(outPtr);
    const consumed = () => { runtime.storeField(fields, key('off'), thisOff + thisLen - availIn); runtime.storeField(fields, key('len'), availIn); };
    switch (ret) {
      case Z_STREAM_END: runtime.storeField(fields, key('finished'), 1); // falls through
      case Z_OK: consumed(); return len - availOut;
      case Z_NEED_DICT: runtime.storeField(fields, key('needDict'), 1); consumed(); return 0;
      case Z_BUF_ERROR: return 0;
      case Z_DATA_ERROR: throwNew(runtime, 'Ljava/util/zip/DataFormatException;', e.cstr(e.x.zl_msg(strm)));
      case Z_MEM_ERROR: throwNew(runtime, 'Ljava/lang/OutOfMemoryError;');
      default: throwNew(runtime, 'Ljava/lang/InternalError;', e.cstr(e.x.zl_msg(strm)));
    }
  });
  add(INFLATER, 'getAdler(J)I', (runtime, [handle]) => { const e = engineFor(runtime); return e.x.zl_adler(stream(runtime, handle)) | 0; });
  add(INFLATER, 'reset(J)V', (runtime, [handle]) => { const e = engineFor(runtime); if (e.x.zl_inflate_reset(stream(runtime, handle)) !== Z_OK) throwNew(runtime, 'Ljava/lang/InternalError;'); });
  add(INFLATER, 'end(J)V', (runtime, [handle]) => { const e = engineFor(runtime), strm = stream(runtime, handle); if (e.x.zl_inflate_end(strm) === Z_STREAM_ERROR) throwNew(runtime, 'Ljava/lang/InternalError;'); else e.x.zl_free(strm); });

  // ---- Deflater.c
  add(DEFLATER, 'init(IIZ)J', (runtime, [level, strategy, nowrap]) => {
    const e = engineFor(runtime), strm = e.x.zl_new(); if (!strm) throwNew(runtime, 'Ljava/lang/OutOfMemoryError;');
    const ret = e.x.zl_deflate_init(strm, level, strategy, nowrap ? 1 : 0);
    if (ret === Z_OK) return BigInt(strm);
    const message = e.cstr(e.x.zl_msg(strm)); e.x.zl_free(strm);
    if (ret === Z_MEM_ERROR) throwNew(runtime, 'Ljava/lang/OutOfMemoryError;');
    if (ret === Z_STREAM_ERROR) throwNew(runtime, 'Ljava/lang/IllegalArgumentException;');
    throwNew(runtime, 'Ljava/lang/InternalError;', message ?? (ret === Z_VERSION_ERROR ? 'zlib returned Z_VERSION_ERROR: compile time and runtime zlib implementations differ' : 'unknown error initializing zlib library'));
  });
  add(DEFLATER, 'setDictionary(J[BII)V', (runtime, [handle, array, off, len]) => {
    const e = engineFor(runtime), strm = stream(runtime, handle), buffer = e.upload(runtime.array(array), off, len), res = e.x.zl_deflate_set_dictionary(strm, buffer, len); e.x.free(buffer);
    if (res === Z_OK) return;
    throwNew(runtime, res === Z_STREAM_ERROR ? 'Ljava/lang/IllegalArgumentException;' : 'Ljava/lang/InternalError;', res === Z_STREAM_ERROR ? null : e.cstr(e.x.zl_msg(strm)));
  });
  add(DEFLATER, 'deflateBytes(J[BIII)I', (runtime, [self, handle, output, off, len, flush]) => {
    const e = engineFor(runtime), strm = stream(runtime, handle), fields = runtime.object(self).fields, key = (name, type) => field(runtime, DEFLATER, name, type);
    const inputArray = runtime.array(fields.get(key('buf', '[B'))), thisOff = fields.get(key('off', 'I')) | 0, thisLen = fields.get(key('len', 'I')) | 0, target = runtime.array(output);
    const inPtr = e.upload(inputArray, thisOff, thisLen), outPtr = e.alloc(len); let res, availIn, availOut;
    const done = () => { availIn = e.x.zl_avail_in(strm); availOut = e.x.zl_avail_out(strm); e.download(outPtr, target, off, len - availOut); e.x.free(inPtr); e.x.free(outPtr); };
    const consumed = () => { runtime.storeField(fields, key('off', 'I'), thisOff + thisLen - availIn); runtime.storeField(fields, key('len', 'I'), availIn); };
    if (fields.get(key('setParams', 'Z'))) {
      res = e.x.zl_deflate_params(strm, inPtr, thisLen, outPtr, len, fields.get(key('level', 'I')) | 0, fields.get(key('strategy', 'I')) | 0); done();
      if (res === Z_OK) { runtime.storeField(fields, key('setParams', 'Z'), 0); consumed(); return len - availOut; }
      if (res === Z_BUF_ERROR) { runtime.storeField(fields, key('setParams', 'Z'), 0); return 0; }
      throwNew(runtime, 'Ljava/lang/InternalError;', e.cstr(e.x.zl_msg(strm)));
    }
    const finish = fields.get(key('finish', 'Z')) ? 4 : flush; // Z_FINISH
    res = e.x.zl_deflate(strm, inPtr, thisLen, outPtr, len, finish); done();
    switch (res) {
      case Z_STREAM_END: runtime.storeField(fields, key('finished', 'Z'), 1); // falls through
      case Z_OK: consumed(); return len - availOut;
      case Z_BUF_ERROR: return 0;
      default: throwNew(runtime, 'Ljava/lang/InternalError;', e.cstr(e.x.zl_msg(strm)));
    }
  });
  add(DEFLATER, 'getAdler(J)I', (runtime, [handle]) => { const e = engineFor(runtime); return e.x.zl_adler(stream(runtime, handle)) | 0; });
  add(DEFLATER, 'reset(J)V', (runtime, [handle]) => { const e = engineFor(runtime); if (e.x.zl_deflate_reset(stream(runtime, handle)) !== Z_OK) throwNew(runtime, 'Ljava/lang/InternalError;'); });
  add(DEFLATER, 'end(J)V', (runtime, [handle]) => { const e = engineFor(runtime), strm = stream(runtime, handle); if (e.x.zl_deflate_end(strm) === Z_STREAM_ERROR) throwNew(runtime, 'Ljava/lang/InternalError;'); else e.x.zl_free(strm); });

  // ---- CRC32.c / Adler32.c
  for (const [owner, name, call] of [[CRC32, 'crc', 'zl_crc32'], [ADLER32, 'adler', 'zl_adler32']]) {
    add(owner, 'update(II)I', (runtime, [value, b]) => { const e = engineFor(runtime), p = e.alloc(1); e.bytes()[p] = b & 0xff; const r = e.x[call](value >>> 0, p, 1); e.x.free(p); return r | 0; });
    add(owner, 'updateBytes(I[BII)I', (runtime, [value, array, off, len]) => { const e = engineFor(runtime), p = e.upload(runtime.array(array), off, len), r = e.x[call](value >>> 0, p, len); e.x.free(p); return r | 0; });
    add(owner, 'updateByteBuffer(IJII)I', (runtime, [value, address, off, len]) => {
      const e = engineFor(runtime), data = readNativeBytes(runtime, BigInt(address) + BigInt(off), len), p = e.alloc(len); e.bytes().set(data, p); const r = e.x[call](value >>> 0, p, len); e.x.free(p); return r | 0;
    });
  }

  // ---- ZipFile.c over zip_util.c
  const zipError = (runtime, message) => throwNew(runtime, 'Ljava/util/zip/ZipException;', message);
  const withPath = (e, text, fn) => { const bytes = encoder.encode(text), p = e.alloc(bytes.length + 2); e.bytes().set(bytes, p); e.bytes()[p + bytes.length] = 0; try { return fn(p); } finally { e.x.free(p); } };
  add(ZIPFILE, 'initIDs()V', () => {});
  add(ZIPFILE, 'open(Ljava/lang/String;IJZ)J', (runtime, [name, mode, lastModified, usemmap]) => {
    const e = engineFor(runtime), path = runtime.stringCharacters(name), fs = runtime.platform.javaIo.fs(), msgSlot = e.alloc(4);
    try {
      e.view().setUint32(msgSlot, 0, true);
      let zip = withPath(e, path, p => e.x.zp_get_from_cache(p, msgSlot, BigInt.asIntN(64, lastModified)));
      let message = e.view().getUint32(msgSlot, true);
      if (!zip && !message) {
        if (!(mode & OPEN_FLAG_READ)) fail('ZipFile.open: only OPEN_READ is supported');
        const node = fs.node(path);
        if (!node) throwNew(runtime, 'Ljava/io/FileNotFoundException;', `${path} (No such file or directory)`);
        if (node.type === 'dir') throwNew(runtime, 'Ljava/io/FileNotFoundException;', `${path} (Is a directory)`);
        const fd = e.nextFd++; e.fds.set(fd, { node, path });
        zip = withPath(e, path, p => e.x.zp_put_in_cache(p, fd, msgSlot, BigInt.asIntN(64, lastModified), usemmap ? 1 : 0));
        message = e.view().getUint32(msgSlot, true);
      }
      if (zip) return BigInt(zip);
      if (message) { const text = e.cstr(message); e.x.zp_free_message(message); zipError(runtime, text); }
      zipError(runtime, 'error in opening zip file');
    } finally { e.x.free(msgSlot); }
  });
  add(ZIPFILE, 'getTotal(J)I', (runtime, [zip]) => engineFor(runtime).x.zp_total(Number(zip)));
  add(ZIPFILE, 'startsWithLOC(J)Z', (runtime, [zip]) => engineFor(runtime).x.zp_locsig(Number(zip)) ? 1 : 0);
  add(ZIPFILE, 'close(J)V', (runtime, [zip]) => { engineFor(runtime).x.zp_close(Number(zip)); });
  add(ZIPFILE, 'getFileDescriptor(J)I', (runtime, [zip]) => engineFor(runtime).x.zp_zfd(Number(zip)));
  add(ZIPFILE, 'getEntry(J[BZ)J', (runtime, [zip, name, addSlash]) => {
    const e = engineFor(runtime), source = runtime.array(name).elements, length = source.length, p = e.alloc(length + 2);
    for (let i = 0; i < length; i++) e.bytes()[p + i] = source[i] & 0xff; e.bytes()[p + length] = 0;
    try { return BigInt(e.x.zp_get_entry(Number(zip), p, length, addSlash ? 1 : 0)); } finally { e.x.free(p); }
  });
  add(ZIPFILE, 'freeEntry(JJ)V', (runtime, [zip, entry]) => { engineFor(runtime).x.zp_free_entry(Number(zip), Number(entry)); });
  add(ZIPFILE, 'getNextEntry(JI)J', (runtime, [zip, n]) => BigInt(engineFor(runtime).x.zp_next_entry(Number(zip), n)));
  add(ZIPFILE, 'getEntryMethod(J)I', (runtime, [entry]) => engineFor(runtime).x.zp_entry_csize(Number(entry)) !== 0n ? 8 : 0);
  add(ZIPFILE, 'getEntryFlag(J)I', (runtime, [entry]) => engineFor(runtime).x.zp_entry_flag(Number(entry)));
  add(ZIPFILE, 'getEntryCSize(J)J', (runtime, [entry]) => { const x = engineFor(runtime).x, c = x.zp_entry_csize(Number(entry)); return c !== 0n ? c : x.zp_entry_size(Number(entry)); });
  add(ZIPFILE, 'getEntrySize(J)J', (runtime, [entry]) => engineFor(runtime).x.zp_entry_size(Number(entry)));
  add(ZIPFILE, 'getEntryTime(J)J', (runtime, [entry]) => BigInt.asUintN(32, engineFor(runtime).x.zp_entry_time(Number(entry))));
  add(ZIPFILE, 'getEntryCrc(J)J', (runtime, [entry]) => BigInt(engineFor(runtime).x.zp_entry_crc(Number(entry)) >>> 0));
  const byteArray = (runtime, bytes) => { const array = runtime.newArray('[B', bytes.length); runtime.array(array).elements = Array.from(bytes, v => (v << 24) >> 24); return array; };
  add(ZIPFILE, 'getCommentBytes(J)[B', (runtime, [zip]) => {
    const e = engineFor(runtime), comment = e.x.zp_comment(Number(zip)); if (!comment) return null;
    return byteArray(runtime, e.bytes().slice(comment, comment + e.x.zp_comment_length(Number(zip))));
  });
  add(ZIPFILE, 'getEntryBytes(JI)[B', (runtime, [entry, type]) => {
    const e = engineFor(runtime), ze = Number(entry);
    if (type === 0) { const name = e.x.zp_entry_name(ze), length = e.x.zp_entry_nlen(ze); return name && length ? byteArray(runtime, e.bytes().slice(name, name + length)) : null; }
    if (type === 1) { const extra = e.x.zp_entry_extra(ze); if (!extra) return null; const length = e.bytes()[extra] | (e.bytes()[extra + 1] << 8); return length > 0 ? byteArray(runtime, e.bytes().slice(extra + 2, extra + 2 + length)) : null; }
    const comment = e.x.zp_entry_comment(ze); if (!comment) return null; let end = comment; while (e.bytes()[end]) end++; return end > comment ? byteArray(runtime, e.bytes().slice(comment, end)) : null;
  });
  add(ZIPFILE, 'read(JJJ[BII)I', (runtime, [zip, entry, pos, bytes, off, len]) => {
    const e = engineFor(runtime), target = runtime.array(bytes), length = target.elements.length;
    if (off < 0 || len < 0 || off + len > length) throwNew(runtime, 'Ljava/lang/ArrayIndexOutOfBoundsException;', `len: ${len}, off: ${off} are not valid for array sized ${length}\n`);
    const p = e.alloc(len), result = e.x.zp_read(Number(zip), Number(entry), BigInt.asIntN(64, pos), p, len);
    if (result > 0) e.download(p, target, off, result); e.x.free(p);
    if (result === -1) {
      const message = e.cstr(e.x.zp_msg(Number(zip)));
      if (message) zipError(runtime, message); else throwNew(runtime, 'Ljava/io/IOException;', 'errno: 5, error: Error reading ZIP file\n');
    }
    return result;
  });
  add(ZIPFILE, 'getZipMessage(J)Ljava/lang/String;', (runtime, [zip]) => { const e = engineFor(runtime); return e.cstr(e.x.zp_msg(Number(zip))); });
  return bindings;
}
