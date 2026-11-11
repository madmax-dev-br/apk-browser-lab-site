// The page path of the WebAssembly core: fetches and compiles core.wasm once per Worker and attaches it to a runtime created with engine 'wasm' (host-bridge.js attachWasmEngine).
import { attachWasmEngine } from './host-bridge.js?v=37ef911634a5';

let compiled = null;
export async function attachCore(runtime, options = {}) {
  compiled ??= fetch(new URL('../core.wasm?v=37ef911634a5', import.meta.url)).then(async response => { if (!response.ok) throw new Error(`vmcore: core.wasm could not be fetched (HTTP ${response.status})`); return WebAssembly.compile(await response.arrayBuffer()); });
  return attachWasmEngine(runtime, { module: await compiled, ...options });
}
