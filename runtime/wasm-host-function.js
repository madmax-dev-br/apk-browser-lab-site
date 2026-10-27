const WASM_TYPE = { i32: 0x7f, i64: 0x7e, f32: 0x7d, f64: 0x7c };
const LEB = n => { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };

const wrapperModules = new Map();
/** A real wasm function that forwards to `fn`, usable as a table entry (the same technique Emscripten's addFunction uses). */
export function hostFunction(params, result, fn) {
  const key = params.join(',') + '>' + (result ?? '');
  let module = wrapperModules.get(key);
  if (!module) {
    const type = [0x60, ...LEB(params.length), ...params.map(p => WASM_TYPE[p]), ...LEB(result ? 1 : 0), ...(result ? [WASM_TYPE[result]] : [])];
    const section = (id, payload) => [id, ...LEB(payload.length), ...payload];
    const bytes = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, [1, ...type]), ...section(2, [1, 1, 0x65, 1, 0x66, 0, 0]), ...section(7, [1, 1, 0x66, 0, 0])];
    module = new WebAssembly.Module(Uint8Array.from(bytes)); wrapperModules.set(key, module);
  }
  return new WebAssembly.Instance(module, { e: { f: fn } }).exports.f;
}

const stubModules = new Map();
/**
 * A wasm function of the given signature that calls whatever function sits in `table[slot]` (call_indirect). Dynamic linking uses it for
 * function imports that resolve only after the importing module has been instantiated (a library's own exported definition, which no dependency
 * provides first): the slot is filled afterwards, and the call stays wasm-to-wasm instead of bouncing through JavaScript.
 */
export function indirectStub(table, params, result, slot) {
  const key = params.join(',') + '>' + (result ?? '');
  let module = stubModules.get(key);
  if (!module) {
    const type = [0x60, ...LEB(params.length), ...params.map(p => WASM_TYPE[p]), ...LEB(result ? 1 : 0), ...(result ? [WASM_TYPE[result]] : [])];
    const section = (id, payload) => [id, ...LEB(payload.length), ...payload];
    const imports = [2, 1, 0x65, 1, 0x74, 0x01, 0x70, 0, 0, 1, 0x65, 1, 0x73, 0x03, 0x7f, 0x00]; // env.t table (funcref, min 0), env.s immutable i32 global
    const code = [0, ...params.flatMap((_, i) => [0x20, ...LEB(i)]), 0x23, 0, 0x11, 0, 0, 0x0b]; // local.get* ; global.get $slot ; call_indirect type0 table0
    const bytes = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, [1, ...type]), ...section(2, imports), ...section(3, [1, 0]), ...section(7, [1, 1, 0x66, 0, 0]), ...section(10, [1, ...LEB(code.length), ...code])];
    module = new WebAssembly.Module(Uint8Array.from(bytes)); stubModules.set(key, module);
  }
  return new WebAssembly.Instance(module, { e: { t: table, s: new WebAssembly.Global({ value: 'i32', mutable: false }, slot) } }).exports.f;
}
