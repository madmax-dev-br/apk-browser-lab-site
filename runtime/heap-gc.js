// Mark-and-sweep reclamation of the VM heap (runtime.heap), run at quiescent points between host requests and, under heap pressure, at the scheduler's thread-switch safepoints
// inside one long scheduling run (runtime.safepointCollect): there no host native is in flight, so every live Java value is in a thread's frames or in the rooted tables below.
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
const SKIP_PROPS = new Set(['heap', 'dex', 'classes', 'resolvedClasses', 'resolveCache', 'hostMethodRefs', 'subtypeMemo', 'ancestorSets', 'methodEvidence', 'nativeBindings', 'apkEntries', 'traceRing', 'trace', 'scheduler', 'resources', 'gcStats', 'gcSkips', 'allocationSamples', 'nativeArrays', 'nativeRanges']);   // nativeArrays/nativeRanges pin an array's address only while the array lives (pruned after marking)   // gcStats keeps past nextId values: counters that look like object ids and would pin whatever object had that id
const NUMERIC_ARRAY_LIMIT = 256;

function tombstone(id, type) {
  const base = { id, type, freed: true };
  // Every use is also logged: a catch block in VM or host code may swallow the thrown error, but the audit run still fails on the log.
  const log = message => { const list = (globalThis.__gcAuditViolations ??= []); if (list.length < 200) list.push({ message, stack: new Error().stack.split('\n').slice(3, 9).join(' | ') }); return message; };
  return new Proxy(base, { get(target, key) { if (key in target || typeof key === 'symbol') return target[key]; throw new Error(log(`GC audit: freed object #${id} (${type}) was used (${String(key)})`)); }, set() { throw new Error(log(`GC audit: freed object #${id} (${type}) was written`)); } });
}

/** Tests that keep Java references in JavaScript locals across event boundaries pin them (they are roots), like a static field would. */
export const pin = (runtime, value) => { (runtime.gcPins ??= new Set()).add(value); return value; };
/**
 * Models "the test holds what it created or was handed": pins every object the test allocates itself (makeObject/allocate called outside any Java dispatch) and every
 * reference a top-level dispatch returns. Everything the VM creates on its own stays collectible, so the audit still covers app and platform state.
 */
export function pinAll(runtime) {
  const make = runtime.makeObject.bind(runtime), dispatch = runtime.dispatch.bind(runtime);
  runtime.makeObject = type => { const value = make(type); if (!runtime.depth && !runtime.pinSuspended) pin(runtime, value); return value; };
  runtime.dispatch = (...args) => { const top = !runtime.depth; const value = dispatch(...args); if (top && value !== null && typeof value === 'object' && typeof value.ref === 'number') pin(runtime, value); return value; };
  return runtime;
}

/** True when `id` once named a heap object that has since been collected (a stale id from the page, a pending event...). */
export function isFreedId(runtime, id) { return Number.isSafeInteger(id) && id > 0 && id < runtime.nextId && runtime.heap.list[id] === undefined; }

function quiescent(runtime, safepoint = false) {
  if (runtime.depth !== 0) return 'dispatch-in-flight';
  if (runtime.nestedRuns > (safepoint ? 1 : 0)) return 'nested-run';   // a safepoint is inside the one scheduling run that owns the JavaScript stack
  if (runtime.initDepth) return 'class-initializer-running';
  const scheduler = runtime.scheduler;
  if (scheduler) { if (scheduler.waitingNested?.size) return 'host-wait-in-flight'; for (const thread of scheduler.threads) if (thread.nestedDepth > 0 || thread.nestedBlock) return 'host-wait-in-flight'; }   // Scheduler.resolveNested: a host call (a native, a class initializer) is parked on the JS stack and may hold raw ids
  if (!safepoint && runtime.thread?.frames?.length) return 'main-thread-running';   // at a safepoint every frame is a root through the scheduler
  return null;
}

/** Why a safepoint collection could not run right now (null = it could): the same checks collectGarbage makes, for diagnostics (heartbeats). */
export function gcBlockReason(runtime) { return quiescent(runtime, true) ?? (unannotatedTask(runtime) ? 'unannotated-task' : null); }

function unannotatedTask(runtime) {
  const queue = runtime.platform?.eventQueue; if (!Array.isArray(queue)) return false;
  return queue.some(event => event.platformTask && !('roots' in event));
}

/**
 * Registers a Map whose keys are Java object ids and whose values are host-side companions of those objects (a LayoutInflater per Context, ...). The map is not a root: a value stays
 * alive only while its key object is alive through something else, and the entry is removed when the key dies. Without this a finished Activity's view tree is retained for ever by
 * the companion that refers back to it.
 */
export function ephemeronMap(runtime, map) { (runtime.ephemeronMaps ??= new Set()).add(map); return map; }

/** The marking machinery shared by the collector and the heap census: `scan` follows plain JavaScript data, `drain` closes over the heap records reached so far. */
const REFERENT_KEY = 'Ljava/lang/ref/Reference;->referent:Ljava/lang/Object;', QUEUE_KEY = 'Ljava/lang/ref/Reference;->queue:Ljava/lang/ref/ReferenceQueue;';
export function createMarker(runtime) {
  const heap = runtime.heap, weakIds = [], weakTypes = new Map(), weakMaps = [], traced = new WeakSet();
  /** java.lang.ref.WeakReference and its subclasses (WeakHashMap entries, ThreadLocal map entries ...): the referent does not keep its object alive. SoftReference and PhantomReference stay strong. */
  const isWeak = type => { let weak = weakTypes.get(type); if (weak === undefined) { try { weak = type === 'Ljava/lang/ref/WeakReference;' || runtime.isSubtype(type, 'Ljava/lang/ref/WeakReference;'); } catch { weak = false; } weakTypes.set(type, weak); } return weak; };
  const limit = runtime.nextId, marked = new Uint8Array(limit), worklist = [];
  const visited = new WeakSet(), stack = [];
  // The big tables are skipped by identity, not only by property name: a back-reference (jni.runtime, platform.runtime) reaches the runtime object from another root and would otherwise walk
  // its resolveCache (millions of entries) and the other skipped tables on every collection.
  const skip = new WeakSet([heap, runtime.dex, runtime.classes, runtime.resources, runtime.platform?.resources, runtime.scheduler, ...(runtime.ephemeronMaps ?? [])].filter(Boolean));   // ephemeron maps are not roots (see ephemeronMap)
  for (const name of SKIP_PROPS) { const table = runtime[name]; if (table !== null && typeof table === 'object') skip.add(table); }
  const violations = [];
  const markId = (id, strict = false) => {
    if (!(id > 0 && id < limit) || marked[id]) return; const record = heap.list[id]; if (record === undefined) return;
    if (record.freed === true) { if (strict && violations.length < 20) violations.push(id); return; }   // a real {ref} to an object collected earlier: a root the collector did not see
    marked[id] = 1; worklist.push(id); count++;
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
  let count = 0;
  const drain = (cap = Infinity) => {
  while (worklist.length && count < cap) {
    const record = heap.list[worklist.pop()], weak = isWeak(record.type);
    if (weak) weakIds.push(record.id);
    for (const key of Object.keys(record)) {
      const item = record[key];
      if (weak && key === 'fields' && item instanceof Map) { for (const [fieldKey, fieldValue] of item) { if (fieldKey === REFERENT_KEY) continue; if (fieldValue !== null && typeof fieldValue === 'object') stack.push(fieldValue); } continue; }
      if (key === 'map' && item instanceof Map && record.type === 'Ljava/util/WeakHashMap;') { weakMaps.push(record); continue; }   // WeakHashMap: keys are weak, a value is live only while its key is (see ephemerons)
      if (key === 'elements') { if (Array.isArray(item) && /^\[(L|\[)/.test(record.type)) for (let i = 0; i < item.length; i++) { const element = item[i]; if (element !== null && typeof element === 'object') stack.push(element); } else if (Array.isArray(item) && typeof item[0] === 'object') scan(item); }
      else if (item !== null && typeof item === 'object') stack.push(item);
      else if (typeof item === 'number' && idLike(key, item)) markId(item);
    }
    scan();
  }
  };
  /** Ephemeron closure: a value of an ephemeron map is live only if its key (an object id) is live through something else. Runs to a fixed point. */
  const ephemerons = () => {
    for (let progress = true; progress;) {
      progress = false;
      for (const map of runtime.ephemeronMaps ?? []) for (const [key, value] of map) { if (typeof key === 'number' && marked[key] && value !== null && typeof value === 'object') { const before = count; scan(value); drain(); if (count !== before) progress = true; } }
      for (const record of weakMaps) for (const entry of record.map.values()) {
        if (traced.has(entry)) continue; const key = entry.key;
        if (!(key && typeof key.ref === 'number') || marked[key.ref]) { traced.add(entry); const before = count; scan(entry.key); scan(entry.value); drain(); if (count !== before) progress = true; }
      }
    }
  };
  return { limit, marked, markId, scan, drain, ephemerons, violations, stack, idLike, weakIds, weakMaps, traced, count: () => count };
}

/**
 * Collects unreachable objects. Returns { collected, reason?, before, after, freed, ms, markMs }.
 * options: { audit, extraRoots: () => iterable of values | values[], reason, requireQuiescence = true }
 */
export function collectGarbage(runtime, { audit = globalThis.process?.env?.APKWEB_GC_AUDIT === '1', extraRoots = null, reason = 'manual', safepoint = false } = {}) {
  const started = performance.now(), heap = runtime.heap, before = heap.size;
  const blocked = quiescent(runtime, safepoint) ?? (unannotatedTask(runtime) ? 'unannotated-task' : null);
  if (blocked) { const skips = (runtime.gcSkips ??= {}); skips[blocked] = (skips[blocked] ?? 0) + 1; return { collected: false, reason: blocked, before, after: before, freed: 0, ms: 0 }; }
  const { limit, marked, markId, scan, drain, ephemerons, violations, idLike, weakIds, weakMaps, traced } = createMarker(runtime);
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
  drain(); ephemerons();
  for (const map of runtime.ephemeronMaps ?? []) for (const key of [...map.keys()]) if (typeof key === 'number' && !marked[key]) map.delete(key);   // the key died: so does the entry
  for (const record of weakMaps) for (const entry of [...record.map.values()]) {   // WeakHashMap entries whose key died are expunged (without a modCount change, as in Java)
    if (traced.has(entry)) continue;
    if (!record.map.delete(entry.serial)) continue; runtime.reserveCollection(-1);
    const bucket = record.mapBuckets?.get(entry.hash); if (bucket) record.mapBuckets.set(entry.hash, bucket.filter(serial => serial !== entry.serial));
    if (record.tailSerial === entry.serial) { record.tailSerial = null; for (const serial of record.map.keys()) record.tailSerial = serial; }
  }
  if (runtime.nativeArrays?.size) {   // an array's native address is valid only while the array is alive
    for (const [handle, value] of [...runtime.nativeArrays]) if (value && !marked[value.ref]) runtime.nativeArrays.delete(handle);
    runtime.nativeRanges = runtime.nativeRanges.filter(range => range.value && marked[range.value.ref]);
  }
  const markMs = performance.now() - t0;
  if (violations.length && audit) throw new Error(`GC audit: live structures reference already-collected objects #${[...new Set(violations)].map(id => `${id} ${heap.list[id]?.type}`).join(', #')} (a Java value held outside the collector's roots, e.g. captured by a host closure)`);
  // Weak references: a referent nothing else keeps alive is cleared (Reference.get() answers null from now on) and its reference is queued on its ReferenceQueue after the collection.
  const cleared = [];
  for (const id of weakIds) {
    const record = heap.list[id], referent = record.fields.get(REFERENT_KEY);
    if (referent && typeof referent.ref === 'number' && !marked[referent.ref]) { record.fields.set(REFERENT_KEY, null); if (record.fields.get(QUEUE_KEY)) cleared.push({ ref: id }); }
  }
  // Sweep.
  let freed = 0;
  for (let id = 1; id < limit; id++) {
    const record = heap.list[id];
    if (record === undefined || marked[id] || record.freed === true) continue;
    if (globalThis.process?.env?.APKWEB_GC_MARK_ONLY === '1') { freed++; continue; }
    if (typeof record.onFree === 'function') { try { record.onFree(); } catch { /* the native resource is already gone */ } }   // NativeAllocationRegistry cleaners: native handles die with the Java object that owns them
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
  // Minimum allocation between two collections: a collection scans the whole live set, so a live set that stays above the threshold (gcNextAt is capped at 85% of the limit) must not be
  // re-scanned at every safepoint. A collection that freed little (< 10% of the heap) quadruples the wait.
  const minAlloc = Math.max(1024, Math.floor(runtime.maxHeapObjects / 32));
  runtime.gcMinAlloc = freed < before * 0.1 ? minAlloc * 4 : minAlloc;
  if (cleared.length && runtime.platform?.queueTask) {
    runtime.platform.queueTask(() => { for (const reference of cleared) { try { runtime.dispatch({ owner: 'Ljava/lang/ref/Reference;', name: 'enqueue', parameters: [], result: 'Z', signature: '()Z' }, [reference], 'virtual'); } catch { /* the queue is gone with its owner */ } } }, 0, cleared);
  }
  runtime.allocationSamples = null; runtime.gcPressure = false; runtime.gcLastNextId = runtime.nextId; runtime.fieldSlots = fieldSlots; runtime.arrayCells = arrayCells; runtime.collectionCells = collectionCells;
  runtime.gcStats = { collections: (runtime.gcStats?.collections ?? 0) + 1, freed: (runtime.gcStats?.freed ?? 0) + freed, lastLive: heap.size, peakLiveAfterGc: Math.max(runtime.gcStats?.peakLiveAfterGc ?? 0, heap.size), lastReason: reason, totalMs: (runtime.gcStats?.totalMs ?? 0) + (performance.now() - started), recent: [...(runtime.gcStats?.recent ?? []).slice(-15), { at: Math.round(started), ms: Math.round(performance.now() - started), markMs: Math.round(markMs), before, after: heap.size, nextId: runtime.nextId, reason }] };
  return { collected: true, reason, before, after: heap.size, freed, ms: Math.round(performance.now() - started), markMs: Math.round(markMs) };
}

/** True when a pressure-driven collection (thread-switch safepoint, event boundary) may run now: enough was allocated since the last one, and the heap passed the threshold or a native resource asked for it. */
export function collectionDue(runtime, threshold = Math.floor(runtime.maxHeapObjects * 0.5)) {
  const wait = Math.min(runtime.gcMinAlloc ?? 0, Math.max(64, (runtime.maxHeapObjects - runtime.heap.size) >> 1)), allocated = runtime.nextId - (runtime.gcLastNextId ?? 0);   // never wait past half the remaining headroom
  if (runtime.gcPressure) return allocated >= Math.min(wait, Math.max(1024, wait >> 2));   // a native resource count asked for it (regex handles are capped at 16384): wait less, but not for every quantum
  return allocated >= wait && runtime.heap.size >= Math.max(threshold, runtime.gcNextAt ?? 0);
}

/** Collects when the live heap passed `threshold` (default 40% of the limit) or in audit mode (every call). */
export function maybeCollect(runtime, options = {}) {
  const audit = options.audit ?? globalThis.process?.env?.APKWEB_GC_AUDIT === '1';
  if (!audit && !runtime.gcEnabled) return { collected: false, reason: 'disabled', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };   // opt-in until the audit suites are clean
  const threshold = options.threshold ?? Math.floor(runtime.maxHeapObjects * 0.5);
  // Audit mode collects after every event that allocated at least APKWEB_GC_AUDIT_MIN (default 200) objects: a collection scans the whole live graph (~100 ms), and an event that allocates fewer
  // objects cannot have dropped a root; skipping them keeps full-suite audits to minutes instead of hours.
  if (audit && runtime.nextId - (runtime.gcLastNextId ?? 0) < Number(globalThis.process?.env?.APKWEB_GC_AUDIT_MIN ?? 200)) return { collected: false, reason: 'audit-small-event', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };
  if (!audit && !runtime.gcPressure && runtime.gcLastNextId === runtime.nextId) return { collected: false, reason: 'nothing-allocated', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };   // no allocation since the last collection: nothing new can be garbage
  // Hysteresis: after a collection the next one waits until the heap grew by 25% of the limit (a heap that is legitimately large must not be re-scanned on every event).
  if (!audit && !collectionDue(runtime, threshold)) return { collected: false, reason: 'below-threshold', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };
  return collectGarbage(runtime, { ...options, audit, reason: audit ? 'audit' : 'threshold' });
}

// ---- Heap census: what was alive when the VM ran out of objects --------------------------------------------------------------------------------------------------------------------
/** Rough host-memory cost of one heap record (JavaScript object + its field Map / element array / collection storage). Calibrated against measured heap growth (docs/MEMORY.md). */
export function estimateRecordBytes(record) {
  let bytes = 150 + (record.fields?.size ?? 0) * 56;
  if (record.elements) bytes += 16 + record.elements.length * 8;
  bytes += ((record.list?.length ?? 0) + (record.set?.length ?? 0)) * 24 + (record.map?.size ?? 0) * 72;
  if (typeof record.text === 'string') bytes += record.text.length * 2;
  return bytes;
}
const typeLabel = type => String(type ?? '?').replace(/^L|;$/g, '').replaceAll('/', '.');
const familyOf = key => { const text = String(key), owner = text.slice(1, text.indexOf('->')), parts = owner.split('/'); return parts.length > 3 ? parts.slice(0, 3).join('.') : parts.join('.').replace(/;$/, ''); };

/**
 * Read-only mark of the whole VM that attributes every live object to the first root group that reaches it, plus a class census and the allocation sites sampled since the last
 * collection. Nothing is freed. Returns { live, garbage, estimatedBytes, topClasses, roots, garbageClasses, allocationSites, gc, text }; `text` is the section of the diagnostic report.
 */
export function heapCensus(runtime, { topClasses = 20, topRoots = 10 } = {}) {
  const heap = runtime.heap, marker = createMarker(runtime), { marked, scan, drain, markId, idLike } = marker, groups = [], REACH_CAP = 25000;
  // Root groups: thread stacks, static fields by class family, the runtime's own tables, every host of the platform, registered host containers.
  const defs = [], scheduler = runtime.scheduler;
  if (scheduler?.threads) scheduler.threads.forEach((thread, index) => defs.push({ name: `pilha da thread ${index}${thread.name ? ` (${thread.name})` : ''}`, visit: sc => { const view = Object.create(scheduler); view.threads = [thread]; scheduler.enumerateRoots.call(view, item => sc(item)); } }));
  const families = new Map();
  for (const [key, value] of runtime.staticFields ?? []) { const family = familyOf(key); (families.get(family) ?? families.set(family, []).get(family)).push(value); }
  for (const [family, values] of families) defs.push({ name: `campos estáticos de ${family}`, visit: sc => { for (const value of values) if (value !== null && typeof value === 'object') sc(value); } });
  const ids = [];   // id-named integers of the runtime / platform objects (e.g. activity ids)
  for (const key of Object.keys(runtime)) {
    if (SKIP_PROPS.has(key) || key === 'staticFields' || key === 'scheduler') continue;
    const item = runtime[key];
    if (key === 'platform' && item && typeof item === 'object') {
      for (const name of Object.keys(item)) { const part = item[name]; if (part !== null && typeof part === 'object') defs.push({ name: `plataforma.${name}`, visit: sc => sc(part) }); else if (typeof part === 'number' && idLike(name, part)) ids.push(part); }
      continue;
    }
    if (item !== null && typeof item === 'object') defs.push({ name: `runtime.${key}`, visit: sc => sc(item) }); else if (typeof item === 'number' && idLike(key, item)) ids.push(item);
  }
  let trackedCount = 0; defs.push({ name: 'contêineres de hosts (gcRoot)', visit: sc => { for (const weak of tracked) { const container = weak.deref(); if (container !== undefined) { trackedCount++; sc(container); } } } });
  // Pass 1: how far each group reaches on its own (capped), so that structures shared by many groups are attributed to the group that reaches the most, not to whichever came first.
  for (const def of defs) { const own = createMarker(runtime); def.visit(own.scan); own.drain(REACH_CAP); def.reach = own.count(); }
  for (const id of ids) markId(id);
  // Pass 2: exclusive attribution, smallest reach first.
  for (const def of [...defs].sort((x, y) => x.reach - y.reach)) { const before = marker.count(); def.visit(scan); drain(); const gained = marker.count() - before; if (gained > 0) groups.push({ name: def.name, objects: gained, reachAlone: def.reach >= REACH_CAP ? `${REACH_CAP}+` : def.reach }); }
  drain(); marker.ephemerons();
  const counts = new Map(), garbageCounts = new Map(); let live = 0, garbage = 0, estimatedBytes = 0;
  for (let id = 1; id < marker.limit; id++) {
    const record = heap.list[id]; if (record === undefined || record.freed === true) continue;
    if (marked[id]) { live++; const entry = counts.get(record.type) ?? counts.set(record.type, { count: 0, bytes: 0 }).get(record.type), bytes = estimateRecordBytes(record); entry.count++; entry.bytes += bytes; estimatedBytes += bytes; }
    else { garbage++; garbageCounts.set(record.type, (garbageCounts.get(record.type) ?? 0) + 1); }
  }
  const classes = [...counts].map(([type, { count, bytes }]) => ({ type, count, bytes })).sort((a, b) => b.count - a.count).slice(0, topClasses);
  const roots = groups.sort((a, b) => b.objects - a.objects).slice(0, topRoots);
  const garbageClasses = [...garbageCounts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  const allocationSites = [...(runtime.allocationSamples ?? [])].map(([site, samples]) => ({ site, samples })).sort((a, b) => b.samples - a.samples).slice(0, 8);
  const gc = { enabled: !!runtime.gcEnabled, ...(runtime.gcStats ?? {}), skips: { ...(runtime.gcSkips ?? {}) } };
  const mib = bytes => (bytes / 1048576).toFixed(1);
  const lines = [`Censo do heap da VM: ${live} objetos vivos (~${mib(estimatedBytes)} MiB estimados) de um limite de ${runtime.maxHeapObjects}; ${garbage} inalcançáveis ainda não coletados; ${runtime.fieldSlots ?? 0} campos, ${runtime.arrayCells ?? 0} células de array, ${runtime.collectionCells ?? 0} células de coleção.`,
    `Coletor: ${gc.enabled ? 'ligado' : 'DESLIGADO'}; ${gc.collections ?? 0} coletas, ${gc.freed ?? 0} liberados no total, última coleta (${gc.lastReason ?? 'nenhuma'}) deixou ${gc.lastLive ?? '?'} vivos${Object.keys(gc.skips).length ? `; coletas recusadas: ${Object.entries(gc.skips).map(([why, n]) => `${why} x${n}`).join(', ')}` : ''}.`,
    'Classes com mais objetos vivos:', ...classes.map(c => `  ${c.count} x ${typeLabel(c.type)} (~${mib(c.bytes)} MiB)`),
    'Raízes que mantêm os objetos vivos (objetos exclusivos de cada grupo, do menor alcance ao maior):', ...roots.map(g => `  ${g.objects} objetos via ${g.name} (sozinha alcança ${g.reachAlone})`)];
  if (garbageClasses.length) lines.push('Inalcançáveis ainda não coletados:', ...garbageClasses.map(c => `  ${c.count} x ${typeLabel(c.type)}`));
  if (allocationSites.length) lines.push('Métodos que mais alocaram desde a última coleta (amostra):', ...allocationSites.map(s => `  ${s.samples} amostras em ${s.site}`));
  return { live, garbage, estimatedBytes, limit: runtime.maxHeapObjects, topClasses: classes, roots, garbageClasses, allocationSites, gc, trackedContainers: trackedCount, text: lines.join('\n') };
}
