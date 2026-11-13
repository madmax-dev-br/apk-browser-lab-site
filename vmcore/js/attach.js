// The page path of the WebAssembly core: fetches and compiles core.wasm once per Worker and attaches it to a runtime created with engine 'wasm' (host-bridge.js attachWasmEngine).
import { attachWasmEngine } from './host-bridge.js?v=da7619ccc1f1';
import { unsharedCore } from './unshared.js?v=da7619ccc1f1';

let compiled = null;
export async function attachCore(runtime, options = {}) {
  compiled ??= fetch(new URL('../core.wasm?v=da7619ccc1f1', import.meta.url)).then(async response => { if (!response.ok) throw new Error(`vmcore: core.wasm could not be fetched (HTTP ${response.status})`); return WebAssembly.compile(unsharedCore(await response.arrayBuffer())); });   // one Worker, green threads: an unshared memory, whose views the web platform's APIs accept
  return attachWasmEngine(runtime, { module: await compiled, shared: false, ...options });
}
