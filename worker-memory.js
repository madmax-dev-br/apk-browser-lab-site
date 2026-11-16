// The Worker's memory line of the status bar (src/app.js updateMemoryMeter), DOM-free: what the Worker measured of itself (vmHealth.workerWasm, src/wasm-memory-meter.js) as
// a reserved size and an estimate of what is in use. No process.*.
const MIB = 1048576, mib = bytes => `${(bytes / MIB).toFixed(bytes < 10 * MIB ? 1 : 0)} MiB`;

/** The Worker's memory as the page can state it. No browser gives a Web Worker its JavaScript heap (performance.memory exists on the page only), which is why this line used
 *  to say "indisponível" always. What the Worker measures is its WebAssembly memories (src/wasm-memory-meter.js): `reserved` is their size, and the VM core reserves its whole
 *  address range at once, so `used` adds what is known to be in use: the core's metaspace and the Java heap alive at the last collection (objects made since are not in it),
 *  and the other modules' memories, which grow as they are used. -> the parts, in bytes. */
export function workerMemoryParts(health) {
  const wasm = health?.workerWasm, heap = health?.workerHeapBytes, finite = Number.isFinite;
  if (!wasm || !finite(wasm.bytes) || !(wasm.memories > 0)) return finite(heap) ? { reserved: null, used: heap, core: null, skia: 0, other: 0, heap } : null;
  const coreBytes = finite(health.coreMemoryBytes) ? health.coreMemoryBytes : 0, skia = finite(health.skiaHeapBytes) ? Math.min(health.skiaHeapBytes, wasm.bytes) : 0, other = Math.max(0, wasm.bytes - coreBytes - skia);
  const core = coreBytes && health.core ? { reserved: coreBytes, meta: health.core.metaBytes ?? 0, live: finite(health.core.liveBytes) ? health.core.liveBytes : null } : null;
  return { reserved: wasm.bytes, memories: wasm.memories, core, skia, other, heap: finite(heap) ? heap : null, used: (core ? core.meta + (core.live ?? 0) : coreBytes) + skia + other + (finite(heap) ? heap : 0) };
}
/** The status-line text and the tooltip line for those parts. -> { short, detail } */
export function workerMemoryText(health) {
  const parts = workerMemoryParts(health);
  if (!parts) return { short: 'unavailable', detail: 'Worker memory: this Worker has not reserved WebAssembly memory yet and the browser does not expose its JS heap.' };
  if (parts.reserved === null) return { short: mib(parts.used), detail: `Worker JS heap: ${mib(parts.used)}.` };
  const pieces = [];
  if (parts.core) pieces.push(`VM core: ${mib(parts.core.meta)} of classes and methods and ${parts.core.live === null ? 'Java heap with no collection yet (what is in use in it is not known)' : `${mib(parts.core.live)} of live Java heap at the last collection`}, of ${mib(parts.core.reserved)} reserved`);
  if (parts.skia) pieces.push(`Skia ${mib(parts.skia)}`); if (parts.other > 0) pieces.push(`other modules ${mib(parts.other)}`);
  // The reserved size is a limit, not a cost: a WebAssembly memory is address space until a page is written, and only written pages take RAM (reserving the core's 2 GiB
  // adds nothing to the process; writing 300 MiB of it adds 300 MiB). So the line leads with what is in use and names the reservation as the ceiling it is.
  return { short: `~${mib(parts.used)} in use (limit ${mib(parts.reserved)})`,
    detail: `Worker memory (${parts.memories} ${parts.memories === 1 ? 'WebAssembly memory' : 'WebAssembly memories'}): ${pieces.join('; ')}. The limit (${mib(parts.reserved)}) is reserved address space, not RAM: only pages already written take memory, so usage grows on demand up to that ceiling${parts.core ? ' (the core sizes are the ones in Controls › Execution)' : ''}.${parts.heap === null ? ' The Worker JavaScript heap is not exposed by the browser and is not in the sum' + (parts.core ? '.' : '; without the WebAssembly core, the Java objects live in it.') : ` Worker JS heap: ${mib(parts.heap)}.`} "In use" is an estimate: Java objects created after the last collection are not included.` };
}
