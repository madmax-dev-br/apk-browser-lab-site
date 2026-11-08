// The VM's memory policy: how many Java objects (and how much array / collection storage) a run may hold, derived from a memory budget instead of one fixed number.
//
// Measured cost of a live VM object, all-in (the record itself plus the host structures it drags along: view trees, text layouts, resource caches, class state), on the example
// apps in node (docs/MEMORY.md): 1.3-2.3 KiB per object, ~1.6 KiB typical; the framework, resources and Skia cost another ~110 MiB before the first object. The object limit is
// therefore  budget / BYTES_PER_OBJECT  with a budget that follows navigator.deviceMemory (GiB, capped at 8 by the browser): desktop-class machines get ~670k objects, a 4 GiB phone
// ~335k (a little above the former fixed 262144), 2 GiB ~167k, 1 GiB ~84k. Outside a browser (node, tests) the former 262144 stays the default so runs are reproducible.
export const BYTES_PER_OBJECT = 1600, MIB = 1048576, DEFAULT_OBJECTS = 262144, MIN_OBJECTS = 65536, MAX_OBJECTS = 2097152;

/** { maxHeapObjects, budgetMiB, ... } for a device. `deviceMemory` is navigator.deviceMemory (GiB) or null/undefined when unknown. */
export function memoryBudget({ deviceMemory = null, override = null } = {}) {
  let budgetMiB, source;
  if (override !== null && override !== undefined) { budgetMiB = Math.max(1, Math.floor(override)); source = 'configured'; }
  else if (Number.isFinite(deviceMemory) && deviceMemory > 0) { budgetMiB = Math.min(1024, Math.max(96, Math.round(deviceMemory * 128))); source = `navigator.deviceMemory=${deviceMemory}`; }
  else { budgetMiB = Math.floor(DEFAULT_OBJECTS * BYTES_PER_OBJECT / MIB); source = 'default'; }
  const maxHeapObjects = Math.min(MAX_OBJECTS, Math.max(MIN_OBJECTS, Math.floor(budgetMiB * MIB / BYTES_PER_OBJECT)));
  return { maxHeapObjects, budgetMiB, source, bytesPerObject: BYTES_PER_OBJECT };
}

/** The "Memória da VM" choices of the page, in MiB of Java heap budget; 0 = automatic (the device-memory rule above). The object limit of a step is memoryBudget({ override }), so the
 *  field-slot / array-cell / collection-cell budgets of the VM scale with it as for any other limit; steps above the VM's ceiling (MAX_OBJECTS) are clamped to it. */
export const MEMORY_STEPS_MIB = Object.freeze([512, 1024, 2048, 3072, 4096]);
export const isMemoryStep = value => value === 0 || MEMORY_STEPS_MIB.includes(value);

/** The limit the Worker passes to the VM: an explicit page option wins, then a chosen `memoryMiB` step (anything outside the list is ignored), then the device-memory budget. */
export function heapLimitFor(options = {}, scope = globalThis) {
  if (Number.isInteger(options.maxHeapObjects)) return options.maxHeapObjects;
  if (MEMORY_STEPS_MIB.includes(options.memoryMiB)) return memoryBudget({ override: options.memoryMiB }).maxHeapObjects;
  return memoryBudget({ deviceMemory: scope.navigator?.deviceMemory ?? null }).maxHeapObjects;
}
