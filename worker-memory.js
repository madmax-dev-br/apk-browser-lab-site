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
  if (!parts) return { short: 'indisponível', detail: 'Memória do Worker: este Worker ainda não reservou memória WebAssembly e o navegador não expõe o heap JS dele.' };
  if (parts.reserved === null) return { short: mib(parts.used), detail: `Heap JS do Worker: ${mib(parts.used)}.` };
  const pieces = [];
  if (parts.core) pieces.push(`núcleo da VM: ${mib(parts.core.meta)} de classes e métodos e ${parts.core.live === null ? 'heap Java ainda sem coleta (o que está em uso nele não é conhecido)' : `${mib(parts.core.live)} de heap Java vivos na última coleta`}, de ${mib(parts.core.reserved)} reservados`);
  if (parts.skia) pieces.push(`Skia ${mib(parts.skia)}`); if (parts.other > 0) pieces.push(`outros módulos ${mib(parts.other)}`);
  // The reserved size is a limit, not a cost: a WebAssembly memory is address space until a page is written, and only written pages take RAM (reserving the core's 2 GiB
  // adds nothing to the process; writing 300 MiB of it adds 300 MiB). So the line leads with what is in use and names the reservation as the ceiling it is.
  return { short: `~${mib(parts.used)} em uso (limite ${mib(parts.reserved)})`,
    detail: `Memória do Worker (${parts.memories} ${parts.memories === 1 ? 'memória WebAssembly' : 'memórias WebAssembly'}): ${pieces.join('; ')}. O limite (${mib(parts.reserved)}) é espaço de endereço reservado, não RAM: só as páginas já escritas ocupam memória, então o uso cresce sob demanda até esse teto${parts.core ? ' (os tamanhos do núcleo são os de Controles › Execução)' : ''}.${parts.heap === null ? ' O heap JavaScript do Worker não é exposto pelo navegador e não entra na soma' + (parts.core ? '.' : '; sem o núcleo em WebAssembly, é nele que ficam os objetos Java.') : ` Heap JS do Worker: ${mib(parts.heap)}.`} "Em uso" é uma estimativa: objetos Java criados depois da última coleta não entram.` };
}
