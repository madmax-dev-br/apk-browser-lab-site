import { APKError } from './apk-error.js?v=2bb44ccf6413';
import { throwNew } from './java-throw.js?v=2bb44ccf6413';

// com.android.icu.charset.NativeConverter converter natives (open/close/decode/encode/reset/callbacks) over the unmodified ICU4C 70.1 ucnv implementation compiled to
// WebAssembly (vendor/icu/70.1/icu-converter.wasm, scripts/build-icu-converter.sh). The wrapper code follows external/icu android-13.0.0_r1
// com_android_icu_charset_NativeConverter.cpp; the error -> exception mapping below is IcuUtilities.cpp maybeThrowIcuException. Charset *name lookup* (charsetForName,
// contains, getAvailableCharsetNames) stays in charset-native.js (curated ICU name data). Only converters that are algorithmic or backed by the vendored common data open.
const NATIVE_CONVERTER = 'Lcom/android/icu/charset/NativeConverter;';
const decoder = new TextDecoder('utf-8'), encoder = new TextEncoder();
const U_ILLEGAL_ARGUMENT_ERROR = 1, U_INDEX_OUTOFBOUNDS_ERROR = 8, U_BUFFER_OVERFLOW_ERROR = 15, U_UNSUPPORTED_ERROR = 16, U_FORMAT_INEXACT_ERROR = 27;
const fail = (message, kind = 'icu-converter-boundary') => { throw new APKError(message, { kind, backend: 'ICU4C70.1-ucnv/Wasm' }); };

export class IcuConverterProvider {
  constructor({ baseURL = new URL('../vendor/icu/70.1/', import.meta.url), fetchImpl, wasmBytes, dataBytes, metadata } = {}) {
    this.baseURL = new URL(baseURL, import.meta.url); this.fetchImpl = fetchImpl || (url => globalThis.fetch(url)); this.wasmBytes = wasmBytes; this.dataBytes = dataBytes; this.metadata = metadata;
  }
  async read(url, maximum) {
    const response = await this.fetchImpl(url); if (!response.ok) fail(`ICU converter asset unavailable (HTTP ${response.status})`);
    const buffer = await response.arrayBuffer(); if (buffer.byteLength > maximum) fail('ICU converter asset exceeds bounded size'); return new Uint8Array(buffer);
  }
  load() { return this.promise ??= this.initialize().catch(error => { this.promise = null; throw error; }); }
  async initialize() {
    const sha = async bytes => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    const metadata = this.metadata || JSON.parse(decoder.decode(await this.read(new URL('converter-provenance.json', this.baseURL), 256 * 1024)));
    if (metadata.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(metadata.wasm?.sha256 ?? '') || !/^[0-9a-f]{64}$/.test(metadata.data?.sha256 ?? '')) fail('Unsupported ICU converter provenance');
    const [wasm, data] = await Promise.all([this.wasmBytes || this.read(new URL(metadata.wasm.file, this.baseURL), 4 * 1024 * 1024), this.dataBytes || this.read(new URL(metadata.data.file, this.baseURL), 16 * 1024 * 1024)]);
    if (await sha(wasm) !== metadata.wasm.sha256 || await sha(data) !== metadata.data.sha256) fail('ICU converter assets do not match their pinned SHA-256', 'icu-converter-hash-mismatch');
    return { module: await WebAssembly.compile(wasm), data, metadata: { ...metadata, source: 'original-ICU4C70.1-ucnv/Wasm', verified: true } };
  }
}

class Converters {
  constructor(backend) {
    const imports = { wasi_snapshot_preview1: { environ_sizes_get: (count, size) => { const v = new DataView(this.x.memory.buffer); v.setUint32(count, 0, true); v.setUint32(size, 0, true); return 0; }, environ_get: () => 0 }, env: { emscripten_notify_memory_growth() {} } };
    for (const entry of WebAssembly.Module.imports(backend.module)) if (!imports[entry.module]?.[entry.name]) fail(`ICU converter Wasm imports unsupported host function ${entry.module}.${entry.name}`);
    this.x = new WebAssembly.Instance(backend.module, imports).exports; this.x._initialize?.();
    const data = backend.data, aligned = this.x.malloc(data.length + 15); if (!aligned) fail('ICU converter heap exhausted');
    const pointer = (aligned + 15) & ~15; this.bytes().set(data, pointer);
    const status = this.x.icu_cnv_initialize(pointer); if (status > 0) fail(`ICU converter initialization ${this.cstr(this.x.icu_cnv_error_name(status))}`);
  }
  bytes() { return new Uint8Array(this.x.memory.buffer); }
  view() { return new DataView(this.x.memory.buffer); }
  alloc(size) { const pointer = this.x.malloc(Math.max(1, size)); if (!pointer) fail('ICU converter heap exhausted'); return pointer; }
  cstr(pointer) { const bytes = this.bytes(); let end = pointer; while (bytes[end]) end++; return decoder.decode(bytes.subarray(pointer, end)); }
}
const instances = new WeakMap();
function converters(runtime) {
  let instance = instances.get(runtime); if (instance) return instance;
  if (!runtime.icuConverterBackend?.module) fail('Charset converters need the verified ICU converter Wasm backend (options.icuConverterProvider)', 'icu-converter-backend-missing');
  instance = new Converters(runtime.icuConverterBackend); instances.set(runtime, instance); return instance;
}
/** IcuUtilities.cpp maybeThrowIcuException */
function maybeThrowIcu(runtime, c, functionName, error) {
  if (error <= 0) return;
  const type = error === U_ILLEGAL_ARGUMENT_ERROR ? 'Ljava/lang/IllegalArgumentException;' : error === U_INDEX_OUTOFBOUNDS_ERROR || error === U_BUFFER_OVERFLOW_ERROR ? 'Ljava/lang/ArrayIndexOutOfBoundsException;'
    : error === U_UNSUPPORTED_ERROR ? 'Ljava/lang/UnsupportedOperationException;' : error === U_FORMAT_INEXACT_ERROR ? 'Ljava/lang/ArithmeticException;' : 'Ljava/lang/RuntimeException;';
  throwNew(runtime, type, `${functionName} failed: ${c.cstr(c.x.icu_cnv_error_name(error))}`);
}
const floatBits = value => { const view = new DataView(new ArrayBuffer(4)); view.setFloat32(0, value); return view.getInt32(0); };
const handleOf = (runtime, handle) => { const pointer = Number(handle); if (!pointer) maybeThrowIcu(runtime, converters(runtime), 'toUConverter', U_ILLEGAL_ARGUMENT_ERROR); return pointer; };

export function closeConverterHandle(runtime, handle) { const pointer = Number(handle); if (pointer) converters(runtime).x.icu_cnv_close(pointer); }

export function createIcuConverterNativeBindings() {
  const bindings = new Map(), add = (signature, callback) => bindings.set(`${NATIVE_CONVERTER}->${signature}`, callback);
  add('openConverter(Ljava/lang/String;)J', (runtime, [name]) => {
    const c = converters(runtime); if (name === null || name === 0) maybeThrowIcu(runtime, c, 'openConverter', U_ILLEGAL_ARGUMENT_ERROR);
    const text = encoder.encode(runtime.stringCharacters(name)), namePointer = c.alloc(text.length + 1), slot = c.alloc(4);
    c.bytes().set(text, namePointer); c.bytes()[namePointer + text.length] = 0;
    const handle = c.x.icu_cnv_open(namePointer, slot), status = c.view().getInt32(slot, true); c.x.free(namePointer); c.x.free(slot);
    maybeThrowIcu(runtime, c, 'ucnv_open', status); if (!handle) maybeThrowIcu(runtime, c, 'openConverter', U_ILLEGAL_ARGUMENT_ERROR);
    return BigInt(handle);
  });
  add('closeConverter(J)V', (runtime, [handle]) => { const pointer = Number(handle); if (pointer) converters(runtime).x.icu_cnv_close(pointer); });
  add('resetByteToChar(J)V', (runtime, [handle]) => { const pointer = Number(handle); if (pointer) converters(runtime).x.icu_cnv_reset_to_unicode(pointer); });
  add('resetCharToByte(J)V', (runtime, [handle]) => { const pointer = Number(handle); if (pointer) converters(runtime).x.icu_cnv_reset_from_unicode(pointer); });
  add('getMaxBytesPerChar(J)I', (runtime, [handle]) => converters(runtime).x.icu_cnv_max_char_size(Number(handle)));
  add('getAveBytesPerChar(J)F', (runtime, [handle]) => { const x = converters(runtime).x, pointer = Number(handle); return pointer ? floatBits((x.icu_cnv_max_char_size(pointer) + x.icu_cnv_min_char_size(pointer)) / 2.0) : floatBits(-1); });
  add('getAveCharsPerByte(J)F', (runtime, [handle]) => floatBits(1 / Math.fround(converters(runtime).x.icu_cnv_max_char_size(Number(handle)))));
  add('getSubstitutionBytes(J)[B', (runtime, [handle]) => {
    const pointer = Number(handle); if (!pointer) return null;
    const c = converters(runtime), out = c.alloc(32), length = c.x.icu_cnv_subst_chars(pointer, out), bytes = length < 0 ? new Uint8Array(0) : c.bytes().slice(out, out + length); c.x.free(out);
    const array = runtime.newArray('[B', bytes.length); runtime.array(array).elements = Array.from(bytes, v => (v << 24) >> 24); return array;
  });
  // decode: NativeConverter_decode; data[0..2] = input offset / output offset / invalid byte count
  add('decode(J[BI[CI[IZ)I', (runtime, [handle, input, inEnd, output, outEnd, data, flush]) => {
    const c = converters(runtime), pointer = handleOf(runtime, handle), source = runtime.array(input), target = runtime.array(output), state = runtime.array(data).elements;
    const sourcePtr = c.alloc(inEnd), targetPtr = c.alloc(outEnd * 2), dataPtr = c.alloc(12), flag = c.alloc(4);
    const view = c.bytes(); for (let i = 0; i < inEnd; i++) view[sourcePtr + i] = source.elements[i] & 0xff;
    const dv = c.view(); for (let i = 0; i < 3; i++) dv.setInt32(dataPtr + i * 4, state[i] | 0, true);
    const startOutput = state[1] | 0, error = c.x.icu_cnv_decode(pointer, sourcePtr, inEnd, targetPtr, outEnd, dataPtr, flush ? 1 : 0, flag);
    const dv2 = c.view(); for (let i = 0; i < 3; i++) state[i] = dv2.getInt32(dataPtr + i * 4, true);
    for (let i = 0; i < state[1]; i++) target.elements[startOutput + i] = dv2.getUint16(targetPtr + (startOutput + i) * 2, true);
    const mustThrow = dv2.getInt32(flag, true); for (const p of [sourcePtr, targetPtr, dataPtr, flag]) c.x.free(p);
    if (mustThrow) maybeThrowIcu(runtime, c, 'ucnv_toUnicode', error);
    return error;
  });
  // encode: NativeConverter_encode; data[0..2] = input offset / output offset / invalid char count
  add('encode(J[CI[BI[IZ)I', (runtime, [handle, input, inEnd, output, outEnd, data, flush]) => {
    const c = converters(runtime), pointer = handleOf(runtime, handle), source = runtime.array(input), target = runtime.array(output), state = runtime.array(data).elements;
    const sourcePtr = c.alloc(inEnd * 2), targetPtr = c.alloc(outEnd), dataPtr = c.alloc(12), flag = c.alloc(4);
    const dv = c.view(); for (let i = 0; i < inEnd; i++) dv.setUint16(sourcePtr + i * 2, source.elements[i] & 0xffff, true);
    for (let i = 0; i < 3; i++) dv.setInt32(dataPtr + i * 4, state[i] | 0, true);
    const startOutput = state[1] | 0, error = c.x.icu_cnv_encode(pointer, sourcePtr, inEnd, targetPtr, outEnd, dataPtr, flush ? 1 : 0, flag);
    const dv2 = c.view(), bytes = c.bytes(); for (let i = 0; i < 3; i++) state[i] = dv2.getInt32(dataPtr + i * 4, true);
    for (let i = startOutput; i < state[1]; i++) target.elements[i] = (bytes[targetPtr + i] << 24) >> 24;
    const mustThrow = dv2.getInt32(flag, true); for (const p of [sourcePtr, targetPtr, dataPtr, flag]) c.x.free(p);
    if (mustThrow) maybeThrowIcu(runtime, c, 'ucnv_fromUnicode', error);
    return error;
  });
  add('setCallbackDecode(JIILjava/lang/String;)V', (runtime, [handle, malformed, unmappable, replacement]) => {
    const c = converters(runtime), pointer = Number(handle); if (!pointer) return maybeThrowIcu(runtime, c, 'toConverter', U_ILLEGAL_ARGUMENT_ERROR);
    const text = runtime.stringCharacters(replacement), buffer = c.alloc(text.length * 2 + 2), dv = c.view();
    for (let i = 0; i < text.length; i++) dv.setUint16(buffer + i * 2, text.charCodeAt(i), true);
    const error = c.x.icu_cnv_set_callback_decode(pointer, malformed, unmappable, buffer, text.length); c.x.free(buffer);
    maybeThrowIcu(runtime, c, error === U_ILLEGAL_ARGUMENT_ERROR ? 'replacement' : 'ucnv_setToUCallBack', error);
  });
  add('setCallbackEncode(JII[B)V', (runtime, [handle, malformed, unmappable, replacement]) => {
    const c = converters(runtime), pointer = Number(handle); if (!pointer) return maybeThrowIcu(runtime, c, 'toUConverter', U_ILLEGAL_ARGUMENT_ERROR);
    const elements = runtime.array(replacement).elements, buffer = c.alloc(elements.length); for (let i = 0; i < elements.length; i++) c.bytes()[buffer + i] = elements[i] & 0xff;
    const error = c.x.icu_cnv_set_callback_encode(pointer, malformed, unmappable, buffer, elements.length); c.x.free(buffer);
    maybeThrowIcu(runtime, c, error === U_ILLEGAL_ARGUMENT_ERROR ? 'replacementBytes' : 'ucnv_setFromUCallBack', error);
  });
  return bindings;
}
