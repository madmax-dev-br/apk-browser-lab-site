// The memory of the WebAssembly core (vmcore/js/host-bridge.js), as the user sets it in Controles › Execução ("Memória do núcleo Wasm") or with the player's `coreMemory`.
// One WebAssembly memory of at most 2 GiB holds the metaspace (the tables and every linked class's and method's records, code and constants), the Java threads' records (1 MiB
// each, with the thread's Java stack) and the collected Java heap. Two modes, chosen when the APK is opened (a change applies at the next load):
//  - 'dynamic' (the default): the heap starts small and GROWS as the app keeps more alive, and the threads' records are taken as threads start; the two share everything above
//    the metaspace up to the 2 GiB, with no line between them. Only `metaMiB` is a size the user sets; there is no heap or thread number to tune.
//  - 'fixed': the three sizes are the user's, each region with its own ceiling: [metaspace | thread records | heap].
// In both modes the WebAssembly memory itself is created at its full size when the APK is opened: memory is address space until it is written, so the part nobody uses costs
// little RAM. It is not grown later (memory.grow) on purpose: the page runs the core over an unshared memory (vmcore/js/unshared.js: web APIs refuse views of a shared one), and
// growing an unshared memory detaches its buffer, which silently kills every view of a Java array that host code holds at that moment.
// Pure and DOM-free; no process.*.
const MiB = 1024 * 1024;
const SIZES = Object.freeze({ heapMiB: 512, metaMiB: 512, threads: 1000 });
export const CORE_MEMORY_MODES = Object.freeze(['dynamic', 'fixed']);
export const CORE_MEMORY_DEFAULT = Object.freeze({ mode: 'dynamic', ...SIZES });
export const CORE_MEMORY_LIMITS = Object.freeze({ heapMiB: Object.freeze([64, 1536]), metaMiB: Object.freeze([64, 1024]), threads: Object.freeze([16, 1000]), totalMiB: 2048 });
export const CORE_MEMORY_LABELS = Object.freeze({ heapMiB: 'heap', metaMiB: 'metaspace', threads: 'threads' });
const THREAD_SPAN_MIB = 4, GUEST_SPAN_MIB = 1, HEAP_ALIGN_MIB = 32;
/** Dynamic mode: the heap the memory starts with (MiB), before the first growth. */
export const CORE_FIRST_HEAP_MIB = 64;

/**
 * Any input -> { mode, heapMiB, metaMiB, threads } with the sizes as integers inside CORE_MEMORY_LIMITS (a missing or unreadable field takes its default). The sum is not
 * checked here: see checkCoreMemory. An input without `mode` (a setting stored before the modes existed, a player config that only gives sizes) is 'fixed' when it asks for a
 * heap or a thread count other than the defaults, the two sizes the dynamic mode would ignore, and 'dynamic' otherwise.
 */
export function sanitizeCoreMemory(input) {
  const out = { mode: 'dynamic', ...SIZES }, source = input && typeof input === 'object' ? input : {};
  for (const key of Object.keys(SIZES)) {
    const raw = source[key]; if (raw === undefined || raw === null || raw === '' || typeof raw === 'boolean') continue;
    const number = Number(raw); if (!Number.isFinite(number)) continue;
    const [min, max] = CORE_MEMORY_LIMITS[key]; out[key] = Math.min(max, Math.max(min, Math.round(number)));
  }
  out.mode = CORE_MEMORY_MODES.includes(source.mode) ? source.mode : out.heapMiB !== SIZES.heapMiB || out.threads !== SIZES.threads ? 'fixed' : 'dynamic';
  return out;
}
/** Fixed mode: where the heap starts, in MiB: the metaspace, the main thread's record and one record per thread, rounded up. */
const heapStartMiB = memory => Math.ceil((memory.metaMiB + THREAD_SPAN_MIB + memory.threads * GUEST_SPAN_MIB) / HEAP_ALIGN_MIB) * HEAP_ALIGN_MIB;
/** Dynamic mode: where the shared area of heap and thread records starts, in MiB: the metaspace and the main thread's record, rounded up. */
const arenaStartMiB = memory => Math.ceil((memory.metaMiB + THREAD_SPAN_MIB) / HEAP_ALIGN_MIB) * HEAP_ALIGN_MIB;
/** Dynamic mode: how much of the memory is in use when the core starts, in MiB: up to the shared area, the collector's tables for all of it (under 5 % of the area) and the first heap. */
const firstMiB = memory => { const start = arenaStartMiB(memory); return start + Math.ceil((CORE_MEMORY_LIMITS.totalMiB - start) / 20) + CORE_FIRST_HEAP_MIB; };
/**
 * { value (sanitized), totalMiB, firstMiB, areaMiB, error }: `areaMiB` is what heap and threads share in dynamic mode (0 in fixed); `totalMiB` is the size of the memory (dynamic: the 2 GiB), `firstMiB` how much of it is laid out at the start (fixed: all of it);
 * `error` (Portuguese) when the three sizes of the fixed mode do not fit the 2 GiB.
 */
export function checkCoreMemory(input) {
  const value = sanitizeCoreMemory(input);
  if (value.mode === 'dynamic') return { value, totalMiB: CORE_MEMORY_LIMITS.totalMiB, firstMiB: firstMiB(value), areaMiB: CORE_MEMORY_LIMITS.totalMiB - arenaStartMiB(value), error: null };
  const totalMiB = heapStartMiB(value) + value.heapMiB, over = totalMiB - CORE_MEMORY_LIMITS.totalMiB;
  return { value, totalMiB, firstMiB: totalMiB, areaMiB: 0, error: over > 0 ? `heap ${value.heapMiB} MiB + metaspace ${value.metaMiB} MiB + ${value.threads} threads somam ${totalMiB} MiB; o núcleo Wasm tem no máximo ${CORE_MEMORY_LIMITS.totalMiB} MiB: reduza ${over} MiB` : null };
}
/** The settings form: the values when they fit, else the defaults (a stored combination that does not fit is never sent to the VM). */
export const coreMemorySetting = input => { const checked = checkCoreMemory(input); return checked.error ? { ...CORE_MEMORY_DEFAULT } : checked.value; };
/** Whether two settings lay the memory out the same way (in dynamic mode the heap and thread sizes are not used, so they do not count). */
export const sameCoreMemory = (a, b) => { const x = sanitizeCoreMemory(a), y = sanitizeCoreMemory(b); return x.mode === y.mode && x.metaMiB === y.metaMiB && (x.mode === 'dynamic' || (x.heapMiB === y.heapMiB && x.threads === y.threads)); };
/**
 * The memory map (bytes) for a setting: low memory is the module's data; [META, META_END) the metaspace; the main thread's record (THREAD_SPAN, with the module's native stack).
 * Fixed: GUEST_COUNT records of GUEST_SPAN for the other Java threads at GUESTS, then the collected heap from HEAP to the end of `pages` (64 KiB each).
 * Dynamic (`dynamic: true`): the shared area is from HEAP to the end of `pages`; the heap starts as what is under `firstPages` and grows from there, and the other threads'
 * records are taken from the area as threads start (GUESTS is 0; GUEST_COUNT is the most the core has ids for).
 * Throws when the sizes do not fit.
 */
export function coreLayout(input = CORE_MEMORY_DEFAULT) {
  const { value, totalMiB, firstMiB: first, error } = checkCoreMemory(input); if (error) throw new Error(`vmcore: ${error}`);
  const metaEnd = value.metaMiB * MiB, threads = metaEnd, guests = threads + THREAD_SPAN_MIB * MiB, dynamic = value.mode === 'dynamic';
  return Object.freeze({ META: 1 * MiB, META_END: metaEnd, THREADS: threads, THREAD_SPAN: THREAD_SPAN_MIB * MiB, GUESTS: dynamic ? 0 : guests, GUEST_SPAN: GUEST_SPAN_MIB * MiB, GUEST_COUNT: dynamic ? CORE_MEMORY_LIMITS.threads[1] : value.threads,
    HEAP: (dynamic ? arenaStartMiB(value) : heapStartMiB(value)) * MiB, pages: totalMiB * 16, firstPages: first * 16, dynamic, memory: Object.freeze(value) });
}

/** The message of a load that failed because the core could not start: what happened, and how to open the APK on the JavaScript VM instead (`?engine=js`, player `engine: 'js'`). */
export function coreStartMessage(error) {
  const reason = String(error?.message ?? error).slice(0, 400), hint = "Para abrir com a VM JavaScript: ?engine=js na página (no player, engine: 'js').";
  return reason.includes('?engine=js') ? reason : `O núcleo WebAssembly não iniciou: ${reason}. ${hint}`;
}
