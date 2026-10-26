// Mark-and-sweep reclamation of the VM heap (runtime.heap), run only at quiescent points between host requests.
//
// Why: Java objects live in runtime.heap and are never freed otherwise; a few dozen UI interactions (Compose recomposition, layout, semantics snapshots) exhaust the
// 262,144-object limit. Ids are never reused, so a stale id can only be *absent*, never the wrong object.
//
// Roots (everything that can hold a Java value while no Java frame of the *current* event is running):
//  - the green-thread scheduler (Scheduler.enumerateRoots): every thread object, frame register, return value, pending exception, host continuation argument and the `roots`
//    a parked Blocked declares;
//  - the runtime's own tables (static fields, Class objects, boxes, monitors, native array handles, activity/root/looper/loader singletons, ...), the Android platform and
//    every host it owns (frames, event queue, fragment managers, registered receivers/callbacks, view/window/input/Compose host state, JNI tables, ...), found by a
//    reflective walk of plain JavaScript data (Objects, Arrays, Maps, Sets): any `{ ref: <heap id> }` is a pointer, and so is an integer stored under a property whose name
//    says it is an object id (id, viewId, ownerViewId, target, receiver, ...). The walk is conservative, so it can keep garbage alive but never frees a reachable object;
//  - callers' `extraRoots` (the Compose semantics driver keeps node references between snapshots; the page-facing Worker owns it);
//  - anything declaring `[GC_ROOTS](visit)`.
// JavaScript closures cannot be inspected. A native that captures a Java value in a closure that outlives the current event (platform.queueTask callbacks, Blocked.finish,
// Invoke.then) must declare it: `queueTask(fn, delay, roots)`, `Blocked({ roots })`, Invoke args. A queued platform task *without* a roots declaration makes the collector skip
// (reason "unannotated-task") rather than risk freeing a captured object; audit mode reports it so the call site can be annotated.
//
// java.lang.ref.WeakReference/SoftReference referents are held strongly, finalizers are never run (documented limit: nothing is cleared before the object becomes
// unreachable from everything else, which is what ART guarantees for soft references anyway; WeakHashMap and Compose's weak sets therefore never lose an entry early).
//
// Audit mode (APKWEB_GC_AUDIT=1, or collectGarbage(..., { audit: true })) replaces every freed record by a tombstone whose properties throw, so a root that was missed fails
// loudly at its first use instead of corrupting state.
export const GC_ROOTS = Symbol.for('apkweb.gc.roots');

// Containers created inside host factories (closure state the collector cannot reach through object properties) register themselves here.
const tracked = new Set();
/** Register a Map/Set/Array that holds Java values (`{ ref }`) in host closure state; returns it unchanged. Weakly held: a container no host references is dropped. */
export function gcRoot(container) { tracked.add(new WeakRef(container)); return container; }

const ID_KEY = /(^id$|Id$|Ids$|^ids$|^ref$|Ref$|Refs$|^view$|View$|^target$|Target$|^receiver$|Receiver$|^owner$|Owner$|^activity$|Activity$|^object$|Object$|^handle$)/;
const SKIP_PROPS = new Set(['heap', 'dex', 'classes', 'resolvedClasses', 'resolveCache', 'subtypeMemo', 'ancestorSets', 'methodEvidence', 'nativeBindings', 'apkEntries', 'traceRing', 'trace', 'scheduler', 'resources']);
const NUMERIC_ARRAY_LIMIT = 256;

function tombstone(id, type) {
  const base = { id, type, freed: true };
  // Every use is also logged: a catch block in VM or host code may swallow the thrown error, but the audit run still fails on the log.
  const log = message => { const list = (globalThis.__gcAuditViolations ??= []); if (list.length < 200) list.push({ message, stack: new Error().stack.split('\n').slice(3, 9).join(' | ') }); return message; };
  return new Proxy(base, { get(target, key) { if (key in target || typeof key === 'symbol') return target[key]; throw new Error(log(`GC audit: freed object #${id} (${type}) was used (${String(key)})`)); }, set() { throw new Error(log(`GC audit: freed object #${id} (${type}) was written`)); } });
}

/** True when `id` once named a heap object that has since been collected (a stale id from the page, a pending event...). */
export function isFreedId(runtime, id) { return Number.isSafeInteger(id) && id > 0 && id < runtime.nextId && runtime.heap.list[id] === undefined; }

function quiescent(runtime) {
  if (runtime.depth !== 0) return 'dispatch-in-flight';
  if (runtime.nestedRuns) return 'nested-run';
  if (runtime.initDepth) return 'class-initializer-running';
  const scheduler = runtime.scheduler;
  if (scheduler) for (const thread of scheduler.threads) if (thread.nestedDepth > 0) return 'host-wait-in-flight';
  if (runtime.thread?.frames?.length) return 'main-thread-running';
  return null;
}

function unannotatedTask(runtime) {
  const queue = runtime.platform?.eventQueue; if (!Array.isArray(queue)) return false;
  return queue.some(event => event.platformTask && !('roots' in event));
}

/**
 * Collects unreachable objects. Returns { collected, reason?, before, after, freed, ms, markMs }.
 * options: { audit, extraRoots: () => iterable of values | values[], reason, requireQuiescence = true }
 */
export function collectGarbage(runtime, { audit = globalThis.process?.env?.APKWEB_GC_AUDIT === '1', extraRoots = null, reason = 'manual' } = {}) {
  const started = performance.now(), heap = runtime.heap, before = heap.size;
  const blocked = quiescent(runtime) ?? (unannotatedTask(runtime) ? 'unannotated-task' : null);
  if (blocked) { const skips = (runtime.gcSkips ??= {}); skips[blocked] = (skips[blocked] ?? 0) + 1; return { collected: false, reason: blocked, before, after: before, freed: 0, ms: 0 }; }
  const limit = runtime.nextId, marked = new Uint8Array(limit), worklist = [];
  const visited = new WeakSet(), stack = [];
  const skip = new WeakSet([heap, runtime.dex, runtime.classes, runtime.resources, runtime.platform?.resources, runtime.scheduler].filter(Boolean));
  const violations = [];
  const markId = (id, strict = false) => {
    if (!(id > 0 && id < limit) || marked[id]) return; const record = heap.list[id]; if (record === undefined) return;
    if (record.freed === true) { if (strict && violations.length < 20) violations.push(id); return; }   // a real {ref} to an object collected earlier: a root the collector did not see
    marked[id] = 1; worklist.push(id);
  };
  const idLike = (key, value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < limit && ID_KEY.test(key);
  /** Iterative scan of plain JavaScript data; pointers are `{ ref }` objects and id-named integers. */
  const scan = start => {
    if (start !== undefined) stack.push(start);
    while (stack.length) {
      const value = stack.pop();
      if (value === null || typeof value !== 'object') continue;
      if (typeof value.ref === 'number' && Number.isSafeInteger(value.ref) && Object.keys(value).length === 1) { markId(value.ref, true); continue; }
      if (visited.has(value) || skip.has(value)) continue; visited.add(value);
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) continue;
      if (Array.isArray(value)) {
        if (value.length > NUMERIC_ARRAY_LIMIT && typeof value[0] === 'number') continue;   // primitive data (int[] elements, offsets), never a ref list
        for (let i = 0; i < value.length; i++) { const item = value[i]; if (item !== null && typeof item === 'object') stack.push(item); }
        continue;
      }
      if (value instanceof Map) { for (const [key, item] of value) { if (key !== null && typeof key === 'object') stack.push(key); if (item !== null && typeof item === 'object') stack.push(item); } continue; }
      if (value instanceof Set) { for (const item of value) if (item !== null && typeof item === 'object') stack.push(item); continue; }
      if (typeof value[GC_ROOTS] === 'function') value[GC_ROOTS](item => { if (item !== null && typeof item === 'object') stack.push(item); });
      for (const key of Object.keys(value)) {
        const item = value[key];
        if (item !== null && typeof item === 'object') stack.push(item);
        else if (typeof item === 'number' && idLike(key, item)) markId(item);
      }
    }
  };
  const t0 = performance.now();
  // Runtime and platform: everything but the heap itself and the large immutable tables.
  for (const key of Object.keys(runtime)) {
    if (SKIP_PROPS.has(key)) continue;
    const item = runtime[key];
    if (item !== null && typeof item === 'object') scan(item); else if (typeof item === 'number' && idLike(key, item)) markId(item);
  }
  runtime.scheduler?.enumerateRoots?.(item => scan(item));
  for (const weak of tracked) { const container = weak.deref(); if (container === undefined) tracked.delete(weak); else scan(container); }
  if (extraRoots) { const values = typeof extraRoots === 'function' ? extraRoots() : extraRoots; for (const item of values ?? []) scan(item); }
  // Heap closure: scan each reachable record's own state.
  while (worklist.length) {
    const record = heap.list[worklist.pop()];
    for (const key of Object.keys(record)) {
      const item = record[key];
      if (key === 'elements') { if (Array.isArray(item) && /^\[(L|\[)/.test(record.type)) for (let i = 0; i < item.length; i++) { const element = item[i]; if (element !== null && typeof element === 'object') stack.push(element); } else if (Array.isArray(item) && typeof item[0] === 'object') scan(item); }
      else if (item !== null && typeof item === 'object') stack.push(item);
      else if (typeof item === 'number' && idLike(key, item)) markId(item);
    }
    scan();
  }
  const markMs = performance.now() - t0;
  if (violations.length && audit) throw new Error(`GC audit: live structures reference already-collected objects #${[...new Set(violations)].map(id => `${id} ${heap.list[id]?.type}`).join(', #')} (a Java value held outside the collector's roots, e.g. captured by a host closure)`);
  // Sweep.
  let freed = 0;
  for (let id = 1; id < limit; id++) {
    const record = heap.list[id];
    if (record === undefined || marked[id] || record.freed === true) continue;
    if (globalThis.process?.env?.APKWEB_GC_MARK_ONLY === '1') { freed++; continue; }
    heap.list[id] = audit ? tombstone(id, record.type) : undefined; heap.size--; freed++;
    if (runtime.monitors?.has(id)) runtime.monitors.delete(id);
  }
  // Budgets count live storage only.
  let fieldSlots = runtime.staticFields?.size ?? 0, arrayCells = 0, collectionCells = 0;
  for (let id = 1; id < limit; id++) {
    const record = heap.list[id]; if (record === undefined || record.freed === true) continue;
    fieldSlots += record.fields?.size ?? 0; if (record.elements) arrayCells += record.elements.length;
    collectionCells += (record.list?.length ?? 0) + (record.set?.length ?? 0) + (record.map?.size ?? 0);
  }
  runtime.gcNextAt = Math.min(Math.floor(runtime.maxHeapObjects * 0.85), heap.size + Math.floor(runtime.maxHeapObjects * 0.25));
  runtime.gcLastNextId = runtime.nextId; runtime.fieldSlots = fieldSlots; runtime.arrayCells = arrayCells; runtime.collectionCells = collectionCells;
  runtime.gcStats = { collections: (runtime.gcStats?.collections ?? 0) + 1, freed: (runtime.gcStats?.freed ?? 0) + freed, lastLive: heap.size, peakLiveAfterGc: Math.max(runtime.gcStats?.peakLiveAfterGc ?? 0, heap.size), lastReason: reason };
  return { collected: true, reason, before, after: heap.size, freed, ms: Math.round(performance.now() - started), markMs: Math.round(markMs) };
}

/** Collects when the live heap passed `threshold` (default 40% of the limit) or in audit mode (every call). */
export function maybeCollect(runtime, options = {}) {
  const audit = options.audit ?? globalThis.process?.env?.APKWEB_GC_AUDIT === '1';
  if (!audit && !runtime.gcEnabled) return { collected: false, reason: 'disabled', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };   // opt-in until the audit suites are clean
  const threshold = options.threshold ?? Math.floor(runtime.maxHeapObjects * 0.5);
  if (!audit && runtime.gcLastNextId === runtime.nextId) return { collected: false, reason: 'nothing-allocated', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };   // no allocation since the last collection: nothing new can be garbage
  // Hysteresis: after a collection the next one waits until the heap grew by 25% of the limit (a heap that is legitimately large must not be re-scanned on every event).
  if (!audit && runtime.heap.size < Math.max(threshold, runtime.gcNextAt ?? 0)) return { collected: false, reason: 'below-threshold', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };
  return collectGarbage(runtime, { ...options, audit, reason: audit ? 'audit' : 'threshold' });
}
