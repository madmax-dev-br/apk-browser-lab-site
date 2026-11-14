// The page path of the WebAssembly core: fetches and compiles core.wasm once per Worker and attaches it to a runtime created with engine 'wasm' (host-bridge.js attachWasmEngine).
import { attachWasmEngine } from './host-bridge.js?v=d8fff06341bc';
import { unsharedCore } from './unshared.js?v=d8fff06341bc';

let compiled = null;
const compile = () => compiled ??= fetch(new URL('../core.wasm?v=d8fff06341bc', import.meta.url)).then(async response => { if (!response.ok) throw new Error(`vmcore: core.wasm could not be fetched (HTTP ${response.status})`); return WebAssembly.compile(unsharedCore(await response.arrayBuffer())); });   // one Worker, green threads: an unshared memory, whose views the web platform's APIs accept
/** Fetches and compiles core.wasm ahead of the load (the Worker's warming, while the user picks an APK). A failure here is forgotten: attachCore fetches again and reports it. */
export function prepareCore() { return compile().then(() => true, () => { compiled = null; return false; }); }
export async function attachCore(runtime, options = {}) {
  return attachWasmEngine(runtime, { module: await compile(), shared: false, ...options });
}
