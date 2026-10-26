const TYPES = { character: 0, word: 1, line: 2, sentence: 3 };
const MAX_TEXT = 65536, MAX_WASM = 4 * 1024 * 1024, MAX_DATA = 8 * 1024 * 1024;
const fail = message => { throw new Error(`ICU boundary backend: ${message}`); };
const bytes = value => value instanceof Uint8Array ? value : new Uint8Array(value);
async function digest(value) {
  if (!globalThis.crypto?.subtle) fail('SHA-256 verification requires Web Crypto');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function checked(value, record, maximum, name) {
  const data = bytes(value);
  if (!record || data.byteLength !== record.bytes || data.byteLength > maximum || !/^[a-f0-9]{64}$/.test(record.sha256 || '') || await digest(data) !== record.sha256) fail(`invalid ${name} size/digest`);
  return data;
}
function createRegexSessionFactory(api, allocate, errorName) {
  let sequence = 0, totalHandles = 0;
  const check = () => {
    const code = api.icu_regex_status(); if (code <= 0) return;
    const error = new Error(`Original ICU regex: ${errorName(code)}`); error.name = 'ICURegexError';
    error.code = code; error.icuErrorName = errorName(code); error.offset = api.icu_regex_error_offset(); error.line = api.icu_regex_error_line(); throw error;
  };
  const native = (name, ...args) => { const result = api[name](...args); check(); return result; };
  const limit = message => { const error = new Error(`ICU regex bounded backend: ${message}`); error.name = 'ICURegexLimitError'; throw error; };
  const utf16 = (value, maximum) => {
    if (typeof value !== 'string' || value.length > maximum) limit(`string exceeds ${maximum} UTF-16 units`);
    const pointer = allocate((value.length + 1) * 2), view = new DataView(api.memory.buffer);
    for (let i = 0; i < value.length; i++) view.setUint16(pointer + i * 2, value.charCodeAt(i), true);
    view.setUint16(pointer + value.length * 2, 0, true); return pointer;
  };
  return function createRegexSession() {
    if (typeof api.icu_regex_compile !== 'function') fail('original regex module is unavailable');
    const handles = new Map(); let disposed = false;
    const get = (token, kind) => {
      if (disposed) throw new Error('ICU regex session is disposed');
      const value = handles.get(token); if (!value || kind && value.kind !== kind) throw new Error('Invalid/stale ICU regex handle'); return value;
    };
    const remember = (pointer, kind) => {
      if (!pointer) limit('native allocation returned null');
      if (disposed || handles.size >= 256 || totalHandles >= 1024 || sequence >= 0x7fffffff) { api.icu_regex_close(pointer); limit('active regex handle limit exceeded'); }
      const token = ++sequence; handles.set(token, { pointer, kind, input: 0, length: 0 }); totalHandles++; return token;
    };
    const close = token => { const value = get(token); api.icu_regex_close(value.pointer); if (value.input) api.free(value.input); handles.delete(token); totalHandles--; };
    const groupCount = token => native('icu_regex_group_count', get(token).pointer);
    const offsets = token => {
      const value = get(token, 'matcher'), groups = groupCount(token) + 1;
      if (groups > 1025) limit('capture group limit exceeded');
      const pointer = allocate(groups * 2 * 4);
      try { const count = native('icu_regex_groups', value.pointer, pointer, groups * 2); return Array.from({ length: count }, (_, index) => new DataView(api.memory.buffer).getInt32(pointer + index * 4, true)); }
      finally { api.free(pointer); }
    };
    const match = (name, token, ...args) => { const found = !!native(name, get(token, 'matcher').pointer, ...args); return { matched: found, offsets: found ? offsets(token) : null }; };
    return {
      compile(pattern, flags = 0) {
        if (!Number.isInteger(flags) || flags < 0 || flags > 0xffffffff) throw new TypeError('ICU regex flags must be uint32');
        const text = utf16(pattern, 16384); let pointer;
        try { pointer = native('icu_regex_compile', text, pattern.length, flags); } finally { api.free(text); }
        const token = remember(pointer, 'pattern');
        try { if (groupCount(token) > 1024) limit('capture group limit exceeded'); } catch (error) { close(token); throw error; }
        return token;
      },
      openMatcher(pattern) { return remember(native('icu_regex_clone', get(pattern, 'pattern').pointer), 'matcher'); },
      setInput(token, text, start = 0, end = text?.length) {
        const value = get(token, 'matcher');
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text?.length) throw new RangeError('Invalid ICU regex input region');
        const input = utf16(text, MAX_TEXT);
        try { native('icu_regex_input', value.pointer, input, text.length, start, end); }
        catch (error) { api.free(input); close(token); throw error; }
        if (value.input) api.free(value.input); value.input = input; value.length = text.length;
      },
      find(token, start) { const value = get(token, 'matcher'); if (!Number.isInteger(start) || start < 0 || start > value.length) throw new RangeError('Invalid ICU regex find index'); return match('icu_regex_find', token, start); },
      findNext: token => match('icu_regex_find_next', token),
      matches: token => match('icu_regex_matches', token),
      lookingAt: token => match('icu_regex_looking_at', token),
      groupCount,
      matchedGroupIndex(token, name) {
        const pointer = utf16(name, 256);
        try { return native('icu_regex_named_group', get(token, 'pattern').pointer, pointer, name.length); }
        catch (error) { if (error.icuErrorName === 'U_REGEX_INVALID_CAPTURE_GROUP_NAME') return -1; throw error; }
        finally { api.free(pointer); }
      },
      hitEnd: token => !!native('icu_regex_hit_end', get(token, 'matcher').pointer),
      requireEnd: token => !!native('icu_regex_require_end', get(token, 'matcher').pointer),
      useAnchoringBounds(token, value) { native('icu_regex_anchoring', get(token, 'matcher').pointer, value ? 1 : 0); },
      useTransparentBounds(token, value) { native('icu_regex_transparent', get(token, 'matcher').pointer, value ? 1 : 0); },
      close,
      dispose() { if (disposed) return; for (const token of [...handles.keys()]) close(token); disposed = true; },
      getState: () => ({ activeHandles: handles.size, disposed }),
    };
  };
}

/** Original ICU4C boundary rules/algorithms, with a bounded UTF-16 Web ABI.
 * This is neither Intl.Segmenter nor a word/line heuristic. The Wasm module
 * receives an explicit empty process environment, never the host OS locale.
 */
export class IcuBreakProvider {
  constructor({ baseURL = new URL('../vendor/icu/70.1/', import.meta.url), provenanceURL, fetchImpl, wasmBytes, dataBytes, metadata } = {}) {
    this.baseURL = new URL(baseURL, import.meta.url); this.revision = new URL(import.meta.url).search;
    this.provenanceURL = provenanceURL || new URL('provenance.json' + this.revision, this.baseURL);
    this.fetchImpl = fetchImpl || (url => globalThis.fetch(url)); this.wasmBytes = wasmBytes; this.dataBytes = dataBytes; this.metadata = metadata;
  }
  async read(url, maximum) {
    const response = await this.fetchImpl(url);
    if (!response.ok) fail(`asset unavailable (HTTP ${response.status})`);
    if (Number(response.headers?.get('Content-Length')) > maximum) fail('asset exceeds bounded size');
    const buffer = await response.arrayBuffer(); if (buffer.byteLength > maximum) fail('asset exceeds bounded size'); return new Uint8Array(buffer);
  }
  load() { return this.promise ??= this.initialize().catch(error => { this.promise = null; throw error; }); }
  async initialize() {
    const metadata = this.metadata || JSON.parse(new TextDecoder().decode(await this.read(this.provenanceURL, 256 * 1024)));
    if (metadata.schemaVersion !== 1 || metadata.upstream?.version !== '70.1' || metadata.limits?.utf16Units !== MAX_TEXT || metadata.limits?.memoryBytes !== 64 * 1024 * 1024) fail('unsupported provenance/limits');
    for (const record of [metadata.wasm, metadata.data]) if (!record || !/^[A-Za-z0-9._-]+$/.test(record.file)) fail('invalid asset filename');
    const [wasm, data] = await Promise.all([
      checked(this.wasmBytes || await this.read(new URL(metadata.wasm.file + this.revision, this.baseURL), MAX_WASM), metadata.wasm, MAX_WASM, 'Wasm'),
      checked(this.dataBytes || await this.read(new URL(metadata.data.file + this.revision, this.baseURL), MAX_DATA), metadata.data, MAX_DATA, 'rule data'),
    ]);
    const module = await WebAssembly.compile(wasm), imports = WebAssembly.Module.imports(module);
    if (imports.length !== 2 || imports.some(value => value.module !== 'wasi_snapshot_preview1' || value.kind !== 'function' || !['environ_sizes_get', 'environ_get'].includes(value.name))) fail('unexpected Wasm imports');
    let api;
    const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: {
      environ_sizes_get(count, size) { const memory = new DataView(api.memory.buffer); memory.setUint32(count, 0, true); memory.setUint32(size, 0, true); return 0; },
      environ_get() { return 0; },
    } });
    api = instance.exports; api._initialize();
    if (api.memory.buffer.byteLength !== metadata.limits.memoryBytes) fail('unexpected Wasm memory size');
    const allocate = size => { const result = api.malloc(size); if (!result) fail('bounded Wasm heap exhausted'); return result; };
    // Common-data pointers live for the backend lifetime, including ICU caches.
    const allocation = allocate(data.length + 15), dataPointer = (allocation + 15) & ~15;
    new Uint8Array(api.memory.buffer, dataPointer, data.length).set(data);
    const errorName = code => { const pointer = api.icu_error_name(code), raw = new Uint8Array(api.memory.buffer, pointer, 128), end = raw.indexOf(0); return new TextDecoder().decode(raw.subarray(0, end < 0 ? raw.length : end)); };
    const status = api.icu_initialize(dataPointer); if (status > 0) fail(`initialization ${errorName(status)}`);
    const locales = new Set();
    const backend = {
      createRegexSession: createRegexSessionFactory(api, allocate, errorName),
      metadata: { ...metadata, source: 'original-ICU4C70.1/Wasm', memoryBytes: api.memory.buffer.byteLength, verified: true },
      breaks(text, locale = 'en_US', type = 'line') {
        if (typeof text !== 'string' || text.length > MAX_TEXT) fail('text exceeds 65536 UTF-16 units');
        if (!Object.hasOwn(TYPES, type)) fail('unsupported boundary type');
        if (typeof locale !== 'string' || !/^[A-Za-z0-9_@=;.-]{1,80}$/.test(locale)) fail('invalid explicit locale');
        if (!locales.has(locale) && locales.size >= 256) fail('distinct locale limit exceeded'); locales.add(locale);
        const pointers = [];
        const alloc = size => { const pointer = allocate(size); pointers.push(pointer); return pointer; };
        try {
          const input = alloc((text.length + 1) * 2), language = alloc(locale.length + 1), output = alloc((text.length + 1) * 4), view = new DataView(api.memory.buffer);
          for (let i = 0; i < text.length; i++) view.setUint16(input + i * 2, text.charCodeAt(i), true); view.setUint16(input + text.length * 2, 0, true);
          new Uint8Array(api.memory.buffer, language, locale.length + 1).set(new TextEncoder().encode(locale + '\0'));
          const count = api.icu_boundaries(input, text.length, language, TYPES[type], output, text.length + 1);
          if (count < 0) fail(errorName(-count));
          if (count < 1 || count > text.length + 1) fail('invalid original iterator result count');
          const result = Array.from({ length: count }, (_, index) => view.getInt32(output + index * 4, true));
          if (result[0] !== 0 || result.at(-1) !== text.length || result.some((value, index) => value < 0 || value > text.length || index > 0 && value <= result[index - 1])) fail('invalid original iterator UTF-16 offsets');
          return result;
        } finally { for (const pointer of pointers) api.free(pointer); }
      },
    };
    return backend;
  }
}
export { IcuBreakProvider as ICUBreakProvider };
