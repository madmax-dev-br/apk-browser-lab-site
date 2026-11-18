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
/**
 * The memory readout of the status bar as one total and its details (src/app.js updateMemoryMeter, the hover panel). `pageBytes`: the page's JS heap where the browser gives
 * it (performance.memory, Chrome), else null. The total adds what is in use: the Worker's measured memory (workerMemoryParts.used) and the page's heap. The Java heap's estimate is
 * a part of the Worker's figure, never added to it. -> { text, total, ratio, limited, level, rows: [{ label, value, sub?, indent? }], notes: [string] }
 */
export function memorySummary(health, pageBytes = null) {
  const finite = Number.isFinite, parts = workerMemoryParts(health), page = finite(pageBytes) && pageBytes > 0 ? pageBytes : null;
  // the WebAssembly core counts no objects against a fixed budget (its limit is Number.MAX_SAFE_INTEGER): the Java heap is bounded by the core's memory instead
  const live = finite(health?.liveObjects) ? health.liveObjects : null, limit = health?.limit && health.limit < 2 ** 40 ? health.limit : null, ratio = live !== null && limit ? Math.min(1, live / limit) : 0;
  const pct = ratio < 0.1 ? (ratio * 100).toFixed(1) : String(Math.round(ratio * 100)), estimate = live !== null ? live * (health.bytesPerObject || 1600) : null;
  const total = (parts?.used ?? 0) + (page ?? 0), count = value => value >= 10000 ? `${Math.round(value / 1000)}k` : String(value);
  const rows = [];
  rows.push({ label: 'Total in use', value: total > 0 ? `~${mib(total)}` : 'unavailable', sub: [parts ? 'Worker' : null, page ? 'page' : null].filter(Boolean).join(' + ') || null });
  if (parts) {
    rows.push({ label: 'Worker', value: `~${mib(parts.used)}`, sub: parts.reserved !== null ? `limit ${mib(parts.reserved)} reserved` : 'JS heap' });
    if (parts.core) {
      rows.push({ indent: true, label: 'Classes and methods', value: mib(parts.core.meta) });
      rows.push({ indent: true, label: 'Live Java heap', value: parts.core.live === null ? 'not known yet' : mib(parts.core.live), sub: parts.core.live === null ? 'no collection yet' : 'at the last collection' });
    }
    if (parts.skia) rows.push({ indent: true, label: 'Skia', value: mib(parts.skia) });
    if (parts.other > 0) rows.push({ indent: true, label: 'Other modules', value: mib(parts.other) });
    if (parts.heap !== null && parts.reserved !== null) rows.push({ indent: true, label: 'JS heap', value: mib(parts.heap) });
  } else rows.push({ label: 'Worker', value: 'unavailable', sub: 'nothing measured yet' });
  rows.push({ label: 'Page', value: page ? mib(page) : 'unavailable', sub: page ? 'JS heap' : 'this browser does not report it' });
  if (live !== null) rows.push({ label: 'Java objects', value: limit ? `${count(live)} of ${count(limit)}` : count(live), sub: `${limit ? `${pct} % of the limit` : 'no fixed object limit (bounded by the core\'s memory)'}${estimate !== null ? ` · ~${mib(estimate)} estimated` : ''}` });
  const threads = health?.threads;
  if (threads && finite(threads.alive)) rows.push({ label: 'Threads', value: String(threads.alive), sub: [`${threads.runnable} runnable · ${threads.waiting} waiting`, ...(threads.families ?? []).filter(family => family.count > 1).map(family => `${family.name} ×${family.count}`)].join(' · ') });
  if (finite(health?.collections)) rows.push({ label: 'Collections', value: String(health.collections), sub: `${count(health.freedObjects ?? 0)} objects freed · ${Math.round(health.gcMs ?? 0)} ms` });
  const notes = [`${limit ? 'Above the Java object limit' : 'When the core\'s memory is full'} the VM throws java.lang.OutOfMemoryError. The Java heap estimate is part of the Worker figure, not added to it.`];
  if (parts?.reserved) notes.push('The Worker limit is reserved address space, not RAM: only pages already written take memory.');
  if (health?.oomCount) notes.push(`OutOfMemoryError already thrown ${health.oomCount} time(s).`);
  return { text: total > 0 ? `Memory ~${mib(total)}` : 'Memory', total, ratio, limited: limit !== null, level: ratio >= 0.9 ? 'high' : ratio >= 0.7 ? 'warn' : 'ok', rows, notes };
}
