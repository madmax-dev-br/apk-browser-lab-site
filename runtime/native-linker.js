import { APKError } from './apk-error.js?v=f1c4bcc7c53e';
import { parseWasm, WASM_SYMBOL_BINDING_WEAK } from './wasm-dylink.js?v=f1c4bcc7c53e';
import { hostFunction, indirectStub } from './wasm-host-function.js?v=f1c4bcc7c53e';

// The lab's dynamic linker for wasm32 native libraries: one linear memory, one function table, one stack pointer and one C++ exception tag per
// process, shared by every library -- the same arrangement Android's linker gives a process, which is what lets libreactnative, libfbjni, libjsi
// and Hermes pass C++ objects, vtables, RTTI, exceptions and jsi::Runtime pointers to each other.
//
// Libraries are relocatable modules in the WebAssembly dynamic-linking convention (tool-conventions/DynamicLinking.md: a "dylink.0" section,
// imports env.memory / env.__indirect_function_table / env.__stack_pointer / env.__memory_base / env.__table_base, GOT.mem.* and GOT.func.*
// globals), produced by wasm-ld -shared (Emscripten -sSIDE_MODULE=1 for the libraries, -sMAIN_MODULE=1 for the base). This loader is lab code, it does not
// use Emscripten's JavaScript runtime.
//
// Resolution mirrors ELF: a library's undefined symbols are looked up in the libraries of its DT_NEEDED closure (breadth first, in link order),
// then in the base libc/libc++ module, and finally in the library's own exports (so weak/inline definitions of a library are used only when no
// dependency already provides the symbol -- one canonical typeinfo/vtable per type across libraries). Function symbols bind lazily: a function
// nobody provides at load time gets a call_indirect stub that is filled from the library's own export after instantiation, or else fails
// explicitly when called (like RTLD_LAZY). Data symbols and function *addresses* bind at load: a non-weak symbol nobody defines makes the load
// fail with "cannot locate symbol".
//
// Initialisation order per library: dependencies first, then __wasm_apply_data_relocs, then __wasm_call_ctors (_initialize for the reactor base).

const PAGE = 65536;
const align = (n, a) => Math.ceil(n / a) * a;

export class LinkError extends APKError {
  constructor(message, details = {}) { super(message, { kind: 'native-link', ...details }); this.name = 'LinkError'; }
}

export class NativeLinker {
  /**
   * @param {object} options
   * @param {(module: string, name: string, library: string) => Function|undefined} [options.hostImport] host functions for imports no library defines (syscalls, WASI)
   * @param {string} [options.base] soname of the base module that provides libc/libc++ (loaded first, defines malloc)
   * @param {number} [options.stackBytes] size of the single native stack
   * @param {number} [options.initialPages] [options.maxPages] linear-memory limits in 64 KiB pages
   */
  constructor({ hostImport = () => undefined, base = 'libc++_shared.so', stackBytes = 8 << 20, initialPages = 512, maxPages = 32768 } = {}) {
    this.hostImport = hostImport; this.baseSoname = base; this.stackBytes = stackBytes;
    this.memory = new WebAssembly.Memory({ initial: initialPages, maximum: maxPages });
    this.table = new WebAssembly.Table({ element: 'anyfunc', initial: 1 }); // slot 0 stays null
    this.stackPointer = new WebAssembly.Global({ value: 'i32', mutable: true }, 0);
    this.tags = { __cpp_exception: new WebAssembly.Tag({ parameters: ['i32'] }), __c_longjmp: new WebAssembly.Tag({ parameters: ['i32'] }) };
    this.registry = new Map();  // soname -> { module, dylink, bytes } | { alias }
    this.libraries = new Map(); // soname -> loaded Library (insertion order = load order)
    this.loading = new Set();
    this.functionIndex = new Map(); // wasm function object -> table index (canonical function pointers)
    this.linkerSymbols = new Map(); // symbols the linker itself defines (__heap_base, __stack_high, __stack_low)
    this.stackBase = 4096; this.stackTop = this.stackBase + this.stackBytes; this.nextStatic = align(this.stackTop, 64);
    this.malloc = null; this.free = null;
  }

  /** Makes a library available under `soname`. `wasm` is the module (compiled) and `bytes` its binary (for the dylink.0 section). */
  register(soname, { module = null, bytes = null, needed = null, load = null }) {
    // Lazy form: `load()` returns { module, bytes } the first time the library is actually linked (the browser fetches the module then); `needed` is
    // the DT_NEEDED the provenance records, checked against the module's own dylink.0 when it arrives.
    const entry = { soname, module, parsed: null, needed, load };
    if (!load) this.#realize(entry, { module, bytes });
    this.registry.set(soname, entry);
  }
  #realize(entry, loaded = null) {
    if (entry.parsed) return;
    const { module, bytes } = loaded ?? entry.load();
    const parsed = parseWasm(bytes);
    if (!parsed.dylink) throw new LinkError(`${entry.soname} is not a relocatable module (no dylink.0 section)`, { soname: entry.soname });
    if (entry.needed && JSON.stringify(entry.needed) !== JSON.stringify(parsed.dylink.needed)) throw new LinkError(`${entry.soname}: DT_NEEDED ${JSON.stringify(parsed.dylink.needed)} differs from the provenance ${JSON.stringify(entry.needed)}`, { soname: entry.soname });
    entry.module = module; entry.parsed = parsed;
  }
  /** `alias` resolves to `target` (libc.so, libm.so, libdl.so and libstdc++.so are all provided by the one base module). */
  registerAlias(alias, target) { this.registry.set(alias, { alias: target }); }
  has(soname) { return this.registry.has(soname); }
  canonical(soname) { let entry = this.registry.get(soname), guard = 0; while (entry?.alias && guard++ < 8) { soname = entry.alias; entry = this.registry.get(soname); } return entry ? soname : null; }
  /** Libraries (by canonical soname) the given soname needs, from its dylink.0 DT_NEEDED list. */
  neededOf(soname) { const canonical = this.canonical(soname), entry = canonical && this.registry.get(canonical); return entry ? (entry.needed ?? entry.parsed.dylink.needed) : []; }

  view() { return new DataView(this.memory.buffer); }
  bytes() { return new Uint8Array(this.memory.buffer); }

  // ---- loading ---------------------------------------------------------------------------------------------------------------------------
  /** dlopen: loads `soname` and its DT_NEEDED closure (once each) and returns the Library. Throws LinkError when something cannot be resolved. */
  load(soname) {
    const canonical = this.canonical(soname);
    if (!canonical) throw new LinkError(`library "${soname}" not found`, { soname });
    if (this.libraries.has(canonical)) return this.libraries.get(canonical);
    if (canonical !== this.baseSoname && !this.libraries.has(this.baseSoname)) this.load(this.baseSoname);
    if (this.loading.has(canonical)) throw new LinkError(`circular DT_NEEDED dependency involving ${canonical}`, { soname: canonical });
    this.loading.add(canonical);
    try {
      const entry = this.registry.get(canonical), deps = [];
      this.#realize(entry);
      for (const need of entry.parsed.dylink.needed) { const dep = this.canonical(need); if (!dep) throw new LinkError(`library "${need}" needed by "${canonical}" not found`, { soname: canonical, needed: need }); deps.push(this.load(dep)); }
      return this.#link(entry, deps);
    } finally { this.loading.delete(canonical); }
  }

  #scopeOf(deps) {
    // breadth-first DT_NEEDED closure, in link order, then the base (the global group)
    const scope = [], seen = new Set(), queue = [...deps];
    while (queue.length) { const lib = queue.shift(); if (seen.has(lib)) continue; seen.add(lib); scope.push(lib); queue.push(...lib.deps); }
    const base = this.libraries.get(this.baseSoname); if (base && !seen.has(base)) scope.push(base);
    return scope;
  }

  #allocateData(entry, isBase) {
    const { memorySize, memoryAlign, tableSize, tableAlign } = entry.parsed.dylink, alignment = 2 ** memoryAlign;
    let memoryBase;
    if (isBase) { memoryBase = align(this.nextStatic, alignment); this.nextStatic = align(memoryBase + memorySize, 16); }
    else {
      const raw = this.malloc(memorySize + alignment); memoryBase = align(raw, alignment); // never freed: there is no dlclose
      this.bytes().fill(0, memoryBase, memoryBase + memorySize);
    }
    const tableAlignment = 2 ** tableAlign, tableBase = align(this.table.length, tableAlignment);
    if (tableSize) this.table.grow(tableBase + tableSize - this.table.length);
    return { memoryBase, tableBase };
  }

  #link(entry, deps) {
    const { soname, module, parsed } = entry, isBase = soname === this.baseSoname;
    if (!isBase && !this.malloc) throw new LinkError('the base module did not export malloc', { soname });
    const lib = { soname, deps, scope: this.#scopeOf(deps), symbols: new Map(), instance: null, exports: null, memoryBase: 0, tableBase: 0, jniDone: false, via: null, parsed };
    const { memoryBase, tableBase } = this.#allocateData(entry, isBase);
    Object.assign(lib, { memoryBase, tableBase });
    if (isBase) for (const [name, address] of [['__heap_base', align(this.nextStatic, 16)], ['__stack_high', this.stackTop], ['__stack_low', this.stackBase]]) this.linkerSymbols.set(name, { kind: 'data', address });
    const gotPending = []; // GOT globals to be satisfied from the library's own exports once it is instantiated
    const stubs = []; // function imports to be satisfied from the library's own exports once it is instantiated
    const imports = {};
    const put = (mod, name, value) => { (imports[mod] ??= {})[name] = value; };
    const weak = (mod, name) => ((parsed.dylink.importInfo.get(`${mod}.${name}`) ?? 0) & WASM_SYMBOL_BINDING_WEAK) !== 0;
    for (const { module: mod, name, kind } of WebAssembly.Module.imports(module)) {
      if (mod === 'env') {
        if (name === 'memory') { put(mod, name, this.memory); continue; }
        if (name === '__indirect_function_table') { put(mod, name, this.table); continue; }
        if (name === '__stack_pointer') { put(mod, name, this.stackPointer); continue; }
        if (name === '__memory_base') { put(mod, name, new WebAssembly.Global({ value: 'i32', mutable: false }, memoryBase)); continue; }
        if (name === '__table_base') { put(mod, name, new WebAssembly.Global({ value: 'i32', mutable: false }, tableBase)); continue; }
        if (kind === 'tag') { const tag = this.tags[name]; if (!tag) throw new LinkError(`${soname} imports unknown exception tag env.${name}`, { soname }); put(mod, name, tag); continue; }
        if (kind === 'function') { put(mod, name, this.#bindFunction(lib, name, parsed.imports.find(i => i.module === 'env' && i.name === name)?.type, stubs)); continue; }
        throw new LinkError(`${soname} imports env.${name} (${kind}), which the linker does not provide`, { soname });
      }
      if (mod === 'GOT.mem' || mod === 'GOT.func') {
        const global = new WebAssembly.Global({ value: 'i32', mutable: true }, 0);
        let found = mod === 'GOT.mem' ? this.#findData(lib.scope, name) : this.#findFunctionAddress(lib.scope, name);
        if (found === undefined && mod === 'GOT.func') { const host = this.hostImport('GOT.func', name, soname); if (host) found = this.#tableIndex(host); } // a host function whose address is taken: must be a real wasm function
        if (found !== undefined) global.value = found; else gotPending.push({ global, name, data: mod === 'GOT.mem', weak: weak(mod, name) });
        put(mod, name, global); continue;
      }
      if (kind === 'function') { // e.g. wasi_snapshot_preview1: host functions only; a missing one fails when called
        const fn = this.hostImport(mod, name, soname), type = parsed.imports.find(i => i.module === mod && i.name === name)?.type;
        put(mod, name, fn ?? hostFunction(type.params, type.results[0] ?? null, () => { throw new APKError(`${soname} called unsupported host import ${mod}.${name}`, { kind: 'native-library-import', symbol: name }); })); continue;
      }
      throw new LinkError(`${soname} imports ${mod}.${name} (${kind}), which the linker does not provide`, { soname });
    }
    let instance;
    try { instance = new WebAssembly.Instance(module, imports); }
    catch (error) { throw new LinkError(`${soname}: ${error.message}`, { soname, cause: error.message }); }
    lib.instance = instance; lib.exports = instance.exports;
    for (const [name, value] of Object.entries(instance.exports)) {
      if (typeof value === 'function') lib.symbols.set(name, { kind: 'function', fn: value });
      else if (value instanceof WebAssembly.Global) lib.symbols.set(name, { kind: 'data', address: value.value + memoryBase });
    }
    // canonical function pointers: remember which table slots hold which function
    for (let i = tableBase; i < tableBase + parsed.dylink.tableSize; i++) { const fn = this.table.get(i); if (fn && !this.functionIndex.has(fn)) this.functionIndex.set(fn, i); }
    for (const stub of stubs) {
      const own = lib.symbols.get(stub.name);
      const fn = own?.kind === 'function' ? own.fn : hostFunction(stub.type.params, stub.type.results[0] ?? null, () => { throw new APKError(`${soname}: undefined native symbol ${stub.name} (cannot locate symbol: no loaded library defines it)`, { kind: 'native-library-import', symbol: stub.name }); });
      this.table.set(stub.slot, fn); if (own && !this.functionIndex.has(fn)) this.functionIndex.set(fn, stub.slot);
    }
    // GOT entries for symbols nobody else defines: the library's own exports, else weak null, else the load fails like a missing symbol does on Android
    for (const pending of gotPending) {
      const own = lib.symbols.get(pending.name);
      if (own && pending.data && own.kind === 'data') pending.global.value = own.address;
      else if (own && !pending.data && own.kind === 'function') pending.global.value = this.#tableIndex(own.fn);
      else if (!pending.weak) throw new LinkError(`dlopen failed: cannot locate symbol "${pending.name}" referenced by "${soname}"`, { soname, symbol: pending.name });
    }
    if (isBase) {
      this.malloc = lib.exports.malloc; this.free = lib.exports.free;
    }
    this.libraries.set(soname, lib);
    try {
      if (isBase) this.stackPointer.value = this.stackTop;
      lib.exports.__wasm_apply_data_relocs?.();
      lib.exports.__wasm_call_ctors?.();
      if (isBase) { lib.exports._initialize?.(); lib.exports.emscripten_stack_set_limits?.(this.stackTop, this.stackBase); }
    } catch (error) { this.libraries.delete(soname); throw error; }
    return lib;
  }

  /** Function imports: a loaded dependency's export when there is one, else a host import, else a stub filled after instantiation (own export) or failing when called. */
  #bindFunction(lib, name, type, stubs) {
    for (const dep of lib.scope) { const s = dep.symbols.get(name); if (s?.kind === 'function') return s.fn; }
    const host = this.hostImport('env', name, lib.soname); if (host) return host;
    const slot = this.table.length; this.table.grow(1);
    stubs.push({ name, slot, type });
    return indirectStub(this.table, type.params, type.results[0] ?? null, slot);
  }
  #lookupIn(scope, name) { for (const dep of scope) { const s = dep.symbols.get(name); if (s) return s; } return this.linkerSymbols.get(name); }
  #findData(scope, name) { const s = this.#lookupIn(scope, name); return s?.kind === 'data' ? s.address : undefined; }
  #findFunctionAddress(scope, name) { const s = this.#lookupIn(scope, name); return s?.kind === 'function' ? this.#tableIndex(s.fn) : undefined; }
  #tableIndex(fn) {
    let index = this.functionIndex.get(fn);
    if (index === undefined) { index = this.table.length; this.table.grow(1); this.table.set(index, fn); this.functionIndex.set(fn, index); }
    return index;
  }
  /** Table index for a wasm function (canonical across libraries). Host functions must be real wasm functions (see hostFunction in jni-host). */
  tableIndex(fn) { return this.#tableIndex(fn); }

  // ---- symbol access ---------------------------------------------------------------------------------------------------------------------
  /** dlsym(handle, name) over one library and its dependency closure. */
  symbol(soname, name) {
    const lib = this.libraries.get(this.canonical(soname) ?? soname); if (!lib) return undefined;
    return this.#lookupIn([lib, ...lib.scope], name);
  }
  /** dlsym(RTLD_DEFAULT, name): every loaded library, in load order. */
  symbolGlobal(name) { for (const lib of this.libraries.values()) { const s = lib.symbols.get(name); if (s) return s; } return this.linkerSymbols.get(name); }
}

export const MEMORY_PAGE = PAGE;
