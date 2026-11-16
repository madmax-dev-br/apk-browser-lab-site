// What a Worker can measure of its own memory. A browser gives a Web Worker no reading of its JavaScript heap: performance.memory exists on the page only, and
// performance.measureUserAgentSpecificMemory needs a cross-origin isolated site. What the Worker can read exactly is every WebAssembly memory it holds, and that is where
// most of the VM's memory is: the core's (the Java heap, the classes and the thread stacks), Skia's, ICU's, SQLite's, the codecs', an app's native libraries compiled to Wasm.
// installWasmMemoryMeter() records each memory as it reaches an instance (WebAssembly.instantiate / instantiateStreaming / new WebAssembly.Instance: its exported memories and
// the ones passed in the imports); wasmMemoryUsage() adds up their current sizes. The records are weak: a memory that is collected leaves the sum. No process.*.

const records = [];   // WeakRef<WebAssembly.Memory>
const seen = new WeakSet();
/** Records one memory (once). Anything that is not a WebAssembly.Memory is ignored. */
export function trackWasmMemory(memory, WA = globalThis.WebAssembly) {
  if (!WA?.Memory || !(memory instanceof WA.Memory) || seen.has(memory)) return false;
  seen.add(memory); records.push(new WeakRef(memory)); return true;
}
function noteImports(imports, WA) {
  if (!imports || typeof imports !== 'object') return;
  for (const namespace of Object.values(imports)) { if (namespace instanceof WA.Memory) trackWasmMemory(namespace, WA); else if (namespace && typeof namespace === 'object') for (const value of Object.values(namespace)) if (value instanceof WA.Memory) trackWasmMemory(value, WA); }
}
function noteInstance(instance, WA) { try { for (const value of Object.values(instance?.exports ?? {})) if (value instanceof WA.Memory) trackWasmMemory(value, WA); } catch { /* an exports object that cannot be listed holds nothing to add */ } }

/** Wraps the three ways an instance is made, once per scope. The wrappers return exactly what the originals return; a failure of the bookkeeping never reaches the caller. */
export function installWasmMemoryMeter(WA = globalThis.WebAssembly) {
  if (!WA || WA.__apkwebMemoryMeter) return false;
  const note = (imports, instance) => { try { noteImports(imports, WA); if (instance) noteInstance(instance, WA); } catch { /* bookkeeping only */ } };
  const instantiate = WA.instantiate, streaming = WA.instantiateStreaming, Instance = WA.Instance;
  WA.instantiate = function (source, imports, ...rest) { note(imports, null); return instantiate.call(WA, source, imports, ...rest).then(result => { note(null, result instanceof Instance ? result : result?.instance); return result; }); };
  if (typeof streaming === 'function') WA.instantiateStreaming = function (source, imports, ...rest) { note(imports, null); return streaming.call(WA, source, imports, ...rest).then(result => { note(null, result?.instance); return result; }); };
  const proxy = new Proxy(Instance, { construct(target, args, newTarget) { const instance = Reflect.construct(target, args, newTarget === proxy ? target : newTarget); note(args[1], instance); return instance; } });
  WA.Instance = proxy;
  Object.defineProperty(WA, '__apkwebMemoryMeter', { value: true, enumerable: false });
  return true;
}
/** The WebAssembly memories alive now: { bytes: the sum of their sizes, memories: how many, largest: the size of the biggest one }. */
export function wasmMemoryUsage() {
  let bytes = 0, memories = 0, largest = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const memory = records[i].deref(); if (!memory) { records.splice(i, 1); continue; }
    let size = 0; try { size = memory.buffer.byteLength; } catch { size = 0; }
    bytes += size; memories++; if (size > largest) largest = size;
  }
  return { bytes, memories, largest };
}
