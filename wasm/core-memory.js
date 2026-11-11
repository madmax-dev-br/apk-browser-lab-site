// The memory of the WebAssembly core (vmcore/js/host-bridge.js), as the user sizes it in Controles › Execução ("Memória do núcleo Wasm") or with the player's `coreMemory`:
// the collected Java heap, the metaspace (the tables and every linked class's and method's records, code and constants) and how many Java threads may be alive at once (each
// has a record of 1 MiB with its Java stack). The three are regions of one WebAssembly memory of at most 2 GiB, laid out when the APK is opened: a change applies at the
// next load. Memory is address space until it is written, so a region nobody uses costs little; a browser may still refuse a memory it cannot reserve.
// Pure and DOM-free; no process.*.
const MiB = 1024 * 1024;
export const CORE_MEMORY_DEFAULT = Object.freeze({ heapMiB: 512, metaMiB: 512, threads: 1000 });
export const CORE_MEMORY_LIMITS = Object.freeze({ heapMiB: Object.freeze([64, 1536]), metaMiB: Object.freeze([64, 1024]), threads: Object.freeze([16, 1000]), totalMiB: 2048 });
export const CORE_MEMORY_LABELS = Object.freeze({ heapMiB: 'heap', metaMiB: 'metaspace', threads: 'threads' });
const THREAD_SPAN_MIB = 4, GUEST_SPAN_MIB = 1, HEAP_ALIGN_MIB = 32;

/** Any input -> { heapMiB, metaMiB, threads } as integers inside CORE_MEMORY_LIMITS (a missing or unreadable field takes its default). The sum is not checked here: see checkCoreMemory. */
export function sanitizeCoreMemory(input) {
  const out = { ...CORE_MEMORY_DEFAULT }, source = input && typeof input === 'object' ? input : {};
  for (const key of Object.keys(CORE_MEMORY_DEFAULT)) {
    const raw = source[key]; if (raw === undefined || raw === null || raw === '' || typeof raw === 'boolean') continue;
    const number = Number(raw); if (!Number.isFinite(number)) continue;
    const [min, max] = CORE_MEMORY_LIMITS[key]; out[key] = Math.min(max, Math.max(min, Math.round(number)));
  }
  return out;
}
/** Where the heap starts, in MiB: the metaspace, the main thread's record and one record per thread, rounded up. */
const heapStartMiB = memory => Math.ceil((memory.metaMiB + THREAD_SPAN_MIB + memory.threads * GUEST_SPAN_MIB) / HEAP_ALIGN_MIB) * HEAP_ALIGN_MIB;
/** { value (sanitized), totalMiB, error }: `error` (Portuguese) when the three do not fit the 2 GiB the core's memory may have. */
export function checkCoreMemory(input) {
  const value = sanitizeCoreMemory(input), totalMiB = heapStartMiB(value) + value.heapMiB, over = totalMiB - CORE_MEMORY_LIMITS.totalMiB;
  return { value, totalMiB, error: over > 0 ? `heap ${value.heapMiB} MiB + metaspace ${value.metaMiB} MiB + ${value.threads} threads somam ${totalMiB} MiB; o núcleo Wasm tem no máximo ${CORE_MEMORY_LIMITS.totalMiB} MiB: reduza ${over} MiB` : null };
}
/** The settings form: the values when they fit, else the defaults (a stored combination that does not fit is never sent to the VM). */
export const coreMemorySetting = input => { const checked = checkCoreMemory(input); return checked.error ? { ...CORE_MEMORY_DEFAULT } : checked.value; };
export const sameCoreMemory = (a, b) => { const x = sanitizeCoreMemory(a), y = sanitizeCoreMemory(b); return x.heapMiB === y.heapMiB && x.metaMiB === y.metaMiB && x.threads === y.threads; };
/**
 * The memory map (bytes) for a sizing: low memory is the module's data; [META, META_END) the metaspace; the main thread's record (THREAD_SPAN, with the module's native stack);
 * GUEST_COUNT records of GUEST_SPAN for the other Java threads; the collected heap from HEAP to the end of `pages` (64 KiB each). Throws when it does not fit.
 */
export function coreLayout(input = CORE_MEMORY_DEFAULT) {
  const { value, totalMiB, error } = checkCoreMemory(input); if (error) throw new Error(`vmcore: ${error}`);
  const metaEnd = value.metaMiB * MiB, threads = metaEnd, guests = threads + THREAD_SPAN_MIB * MiB;
  return Object.freeze({ META: 1 * MiB, META_END: metaEnd, THREADS: threads, THREAD_SPAN: THREAD_SPAN_MIB * MiB, GUESTS: guests, GUEST_SPAN: GUEST_SPAN_MIB * MiB, GUEST_COUNT: value.threads, HEAP: heapStartMiB(value) * MiB, pages: totalMiB * 16, memory: Object.freeze(value) });
}

/** The message of a load that failed because the core could not start: what happened, and how to open the APK on the JavaScript VM instead (`?engine=js`, player `engine: 'js'`). */
export function coreStartMessage(error) {
  const reason = String(error?.message ?? error).slice(0, 400), hint = "Para abrir com a VM JavaScript: ?engine=js na página (no player, engine: 'js').";
  return reason.includes('?engine=js') ? reason : `O núcleo WebAssembly não iniciou: ${reason}. ${hint}`;
}
