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
import { BUCKET } from './time-breakdown.js?v=3f91c6782bdb';
export const GC_ROOTS = Symbol.for('apkweb.gc.roots');

// Containers created inside host factories (closure state the collector cannot reach through object properties) register themselves here.
const tracked = new Set();
/** Register a Map/Set/Array that holds Java values (`{ ref }`) in host closure state; returns it unchanged. Weakly held: a container no host references is dropped. */
export function gcRoot(container) { tracked.add(new WeakRef(container)); return container; }

const ID_KEY = /(^id$|Id$|Ids$|^ids$|^ref$|Ref$|Refs$|^view$|View$|^target$|Target$|^receiver$|Receiver$|^owner$|Owner$|^activity$|Activity$|^object$|Object$|^handle$)/;
const SKIP_PROPS = new Set(['heap', 'dex', 'classes', 'resolvedClasses', 'resolveCache', 'hostMethodRefs', 'subtypeMemo', 'ancestorSets', 'methodEvidence', 'nativeBindings', 'apkEntries', 'traceRing', 'trace', 'scheduler', 'resources', 'gcStats', 'gcSkips', 'allocationSamples', 'nativeArrays', 'nativeRanges', 'profile', 'monitor', 'gcPhases', 'hostAllocs']);   // nativeArrays/nativeRanges pin an array's address only while the array lives (pruned after marking)   // gcStats keeps past nextId values: counters that look like object ids and would pin whatever object had that id
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
export function isFreedId(runtime, id) { return Number.isSafeInteger(id) && id > 0 && id < runtime.nextId && runtime.heap.get(id) === undefined; }

function quiescent(runtime, safepoint = false) {
  // A safepoint (the interpreter's run loop at a quantum boundary or a thread switch) is collectable even inside nested runs, host waits and class initializers: every Java frame is a root, and what
  // JavaScript code up the stack may still hold is protected by `runtime.hostAllocs` (everything host code allocated, and every result handed back to it, since the last fully quiescent
  // collection) -- see collectGarbage. Event boundaries keep the strict check.
  if (safepoint) return null;
  if (runtime.depth > 0) return 'dispatch-in-flight';   // gcSafeDepth: the outermost dispatch of a known entry point (launch, a pumped event) whose JavaScript callers hold only rooted values
  if (runtime.nestedRuns > 0) return 'nested-run';   // a safepoint is inside the one scheduling run that owns the JavaScript stack
  if (runtime.initDepth && !safepoint) return 'class-initializer-running';   // at a safepoint the <clinit> frames are on a thread stack (roots); the initialization bookkeeping lives in rooted runtime tables
  const scheduler = runtime.scheduler;
  if (scheduler) { if (scheduler.waitingNested?.size) return 'host-wait-in-flight'; { const allowed = safepoint ? (runtime.gcSafeDepth ?? 0) : 0; for (const thread of scheduler.threads) if (thread.nestedDepth > allowed || thread.nestedBlock) return 'host-wait-in-flight'; } }   // Scheduler.resolveNested: a host call (a native, a class initializer) is parked on the JS stack and may hold raw ids
  if (!safepoint && runtime.thread?.frames?.length) return 'main-thread-running';   // at a safepoint every frame is a root through the scheduler
  return null;
}

/** Why a safepoint collection could not run right now (null = it could): the same checks collectGarbage makes, for diagnostics (heartbeats). */
export function gcBlockReason(runtime) { return quiescent(runtime, true) ?? (unannotatedTask(runtime) ? 'unannotated-task' : null); }

/** Host tasks are annotated when queued (explicitly, or conservatively by PlatformTask enqueueing -- see AndroidPlatform.queueTask), so none blocks a collection; kept for the audit counters. */
function unannotatedTask(runtime) { return false; }

/**
 * Registers a Map whose keys are Java object ids and whose values are host-side companions of those objects (a LayoutInflater per Context, ...). The map is not a root: a value stays
 * alive only while its key object is alive through something else, and the entry is removed when the key dies. Without this a finished Activity's view tree is retained for ever by
 * the companion that refers back to it.
 */
export function ephemeronMap(runtime, map) { (runtime.ephemeronMaps ??= new Set()).add(map); return map; }

/** The marking machinery shared by the collector and the heap census: `scan` follows plain JavaScript data, `drain` closes over the heap records reached so far. */
const REFERENT_KEY = 'Ljava/lang/ref/Reference;->referent:Ljava/lang/Object;', QUEUE_KEY = 'Ljava/lang/ref/Reference;->queue:Ljava/lang/ref/ReferenceQueue;';
const weakTypeCaches = new WeakMap();   // per runtime: type -> is a WeakReference subclass (class hierarchies do not change after load)
const weakTypeCache = runtime => weakTypeCaches.get(runtime) ?? weakTypeCaches.set(runtime, new Map()).get(runtime);
/**
 * Big host tables of pure data (resource entries, string tables, per-class indexes) are most of the JS nodes of a large app and hold no Java reference. A container of more than
 * FLAT_CONTAINER_MIN entries is skipped when a sample of its leading entries is all primitives or "flat records": plain objects whose every property is a non-null string, number,
 * boolean or bigint and none of whose names look like an id (a property that is a string today does not become a reference tomorrow). A container that holds references, nulls or
 * nested objects in its sample is walked in full. `markNoJavaRefs(object)` declares an object (and everything under it) reference-free explicitly.
 */
/** Instances of these classes are code and metadata (DEX files, programs, compiled functions, frames, threads): never Java references, never walked. */
const SKIP_CONSTRUCTORS = new Set(['DexFile', 'DexProgram', 'CompiledFunction', 'Frame', 'VMThread', 'ClassDefinition']);
const FLAT_CONTAINER_MIN = 2048, FLAT_SAMPLE = 48;
const noRefs = new WeakSet();
export function markNoJavaRefs(object) { if (object !== null && typeof object === 'object') noRefs.add(object); return object; }
function flatRecord(value, depth, limit) {
  if (value === null) return false;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'bigint') return true;
  if (kind !== 'object' || depth > 3 || value instanceof Map || value instanceof Set) return false;
  if (ArrayBuffer.isView(value)) return true;   // typed arrays hold numbers only
  if (Array.isArray(value)) { if (value.length === 0) return false; const n = Math.min(value.length, 8); for (let i = 0; i < n; i++) if (!flatRecord(value[i], depth + 1, limit)) return false; return true; }
  if (typeof value.ref === 'number' || value[GC_ROOTS] !== undefined) return false;
  let keys = 0;
  for (const key in value) { keys++; const item = value[key], t = typeof item; if (t === 'number') { if (item > 0 && item < limit && ID_KEY.test(key)) return false; } else if (t === 'object') { if (!flatRecord(item, depth + 1, limit)) return false; } else if (!(t === 'string' || t === 'boolean' || t === 'bigint')) return false; }
  return keys > 0;   // an empty object may be filled with references later
}
function flatSample(iterable, limit) {
  let seen = 0;
  for (const item of iterable) { if (!flatRecord(item, 0, limit)) return false; if (++seen >= FLAT_SAMPLE) break; }
  return seen > 0;
}
const ELEMENT_WIDTH = { Z: 1, B: 1, C: 2, S: 2, I: 4, F: 4, J: 8, D: 8 };
const refArrayTypes = new Map();
const refArrayType = type => { let v = refArrayTypes.get(type); if (v === undefined) { v = type.charCodeAt(0) === 91 && (type.charCodeAt(1) === 76 || type.charCodeAt(1) === 91); refArrayTypes.set(type, v); } return v; };
/** The big immutable tables and back-references that are never walked as roots (see SKIP_PROPS). */
function buildSkip(runtime) {
  const skip = new WeakSet([runtime.heap, runtime.dex, runtime.classes, runtime.resources, runtime.platform?.resources, runtime.scheduler, ...(runtime.ephemeronMaps ?? [])].filter(Boolean));   // ephemeron maps are not roots
  for (const name of SKIP_PROPS) { const table = runtime[name]; if (table !== null && typeof table === 'object') skip.add(table); }
  return skip;
}
export function createMarker(runtime, { full = false } = {}) {
  const heap = runtime.heap, weakIds = [], weakTypes = weakTypeCache(runtime), weakMaps = [], traced = new WeakSet();
  /** java.lang.ref.WeakReference and its subclasses (WeakHashMap entries, ThreadLocal map entries ...): the referent does not keep its object alive. SoftReference and PhantomReference stay strong. */
  const isWeak = type => { let weak = weakTypes.get(type); if (weak === undefined) { weak = false; if (type.charCodeAt(0) === 76) try { for (let at = type, depth = 0; at && depth < 64; at = runtime.parent(at), depth++) if (at === 'Ljava/lang/ref/WeakReference;') { weak = true; break; } } catch { weak = false; } /* walks the superclass chain: runtime.isSubtype would memoize every type the collector meets */ weakTypes.set(type, weak); } return weak; };
  const limit = runtime.nextId, worklist = []; let nodes = 0, pruned = 0;
  // Mark bits per 4096-id chunk, allocated only for the chunks that hold records and reused across collections.
  const markChunks = full ? [] : (runtime.gcMarkChunks ??= []);
  for (let ci = 0; ci < markChunks.length; ci++) if (markChunks[ci] !== undefined && heap.chunks[ci] === undefined) markChunks[ci] = undefined;
  for (let ci = 0; ci < heap.chunks.length; ci++) if (heap.chunks[ci] !== undefined) { if (markChunks[ci] === undefined) markChunks[ci] = new Uint8Array(4096); else markChunks[ci].fill(0); }
  const isMarked = id => { const chunk = markChunks[id >>> 12]; return chunk !== undefined && chunk[id & 4095] !== 0; };
  let category = 4; const setCategory = value => { category = value; };
  const setMarked = id => { markChunks[id >>> 12][id & 4095] = category; };
  const marked = { has: isMarked };
  const visited = new WeakSet(), stack = [];
  // The big tables are skipped by identity, not only by property name: a back-reference (jni.runtime, platform.runtime) reaches the runtime object from another root and would otherwise walk
  // its resolveCache (millions of entries) and the other skipped tables on every collection.
  const skip = buildSkip(runtime);
  // Threads and their frames are roots only through the scheduler's structural enumeration (registers, results, continuations): a back-reference from the runtime or the platform must never lead the
  // generic walk into a frame's program, method record or DEX tables (millions of nodes in a large app).
  if (!full) for (const thread of [runtime.thread, ...(runtime.scheduler?.threads ?? [])]) if (thread !== null && typeof thread === 'object') { skip.add(thread); if (Array.isArray(thread.frames)) { skip.add(thread.frames); for (const frame of thread.frames) if (frame !== null && typeof frame === 'object') skip.add(frame); } }
  const violations = [];
  const markId = (id, strict = false) => {
    if (!(id > 0 && id < limit) || isMarked(id)) return; const record = heap.get(id); if (record === undefined) return;
    if (record.freed === true) { if (strict && violations.length < 20) violations.push(id); return; }   // a real {ref} to an object collected earlier: a root the collector did not see
    setMarked(id); worklist.push(id); count++;
  };
  const idLike = (key, value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < limit && ID_KEY.test(key);
  /** Iterative scan of plain JavaScript data; pointers are `{ ref }` objects and id-named integers. */
  const scan = start => {
    if (start !== undefined) stack.push(start);
    while (stack.length) {
      const value = stack.pop();
      if (value === null || typeof value !== 'object') continue;
      if (value.freed === true) continue;   // a collected record (or its audit tombstone) held by a JavaScript structure: nothing to follow
      if (typeof value.ref === 'number' && Number.isSafeInteger(value.ref) && Object.keys(value).length === 1) { markId(value.ref, true); continue; }
      if (visited.has(value) || skip.has(value) || (!full && noRefs.has(value))) continue;
      if (full && value.constructor?.name === 'Frame') { visited.add(value); nodes++; for (const key of Object.keys(value)) if (key !== 'prog' && key !== 'code' && key !== 'method') stack.push(value[key]); continue; }   // audit: every field of a frame except its code and decoded caches (which never hold roots)
      if (!full) { const ctor = value.constructor; if (ctor !== Object && ctor !== Array && ctor !== Map && ctor !== undefined && SKIP_CONSTRUCTORS.has(ctor.name)) { skip.add(value); continue; } } visited.add(value); nodes++;
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) continue;
      if (Array.isArray(value)) {
        if (value.length > NUMERIC_ARRAY_LIMIT && typeof value[0] === 'number') continue;   // primitive data (int[] elements, offsets), never a ref list
        if (!full && value.length > FLAT_CONTAINER_MIN && flatSample(value, limit)) { pruned++; continue; }
        for (let i = 0; i < value.length; i++) { const item = value[i]; if (item !== null && typeof item === 'object') stack.push(item); }
        continue;
      }
      if (!full && value instanceof Map && value.size > FLAT_CONTAINER_MIN && flatSample(value.values(), limit) && flatSample(value.keys(), limit)) { pruned++; continue; }
      if (!full && value instanceof Set && value.size > FLAT_CONTAINER_MIN && flatSample(value.values(), limit)) { pruned++; continue; }
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
  let sincePulse = 0;
  const drain = (cap = Infinity) => {
  while (worklist.length && count < cap) {
    if (++sincePulse >= 2048) { sincePulse = 0; runtime.monitor?.pulse(`coleta de lixo (marcando ${count} objetos)`); }
    const record = heap.get(worklist.pop()), weak = isWeak(record.type);
    if (weak) weakIds.push(record.id);
    for (const key in record) {
      const item = record[key];
      if (weak && key === 'fields' && item instanceof Map) { for (const [fieldKey, fieldValue] of item) { if (fieldKey === REFERENT_KEY) continue; if (fieldValue !== null && typeof fieldValue === 'object') stack.push(fieldValue); } continue; }
      if (key === 'map' && item instanceof Map && record.type === 'Ljava/util/WeakHashMap;') { weakMaps.push(record); continue; }   // WeakHashMap: keys are weak, a value is live only while its key is (see ephemerons)
      if (key === 'elements') { if (Array.isArray(item) && refArrayType(record.type)) for (let i = 0; i < item.length; i++) { const element = item[i]; if (element !== null && typeof element === 'object') stack.push(element); } else if (Array.isArray(item) && typeof item[0] === 'object') scan(item); }
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
      for (const map of runtime.ephemeronMaps ?? []) for (const [key, value] of map) { if (typeof key === 'number' && isMarked(key) && value !== null && typeof value === 'object') { const before = count; scan(value); drain(); if (count !== before) progress = true; } }
      for (const record of weakMaps) for (const entry of record.map.values()) {
        if (traced.has(entry)) continue; const key = entry.key;
        if (!(key && typeof key.ref === 'number') || isMarked(key.ref)) { traced.add(entry); const before = count; scan(entry.key); scan(entry.value); drain(); if (count !== before) progress = true; }
      }
    }
  };
  return { limit, marked, markedHas: isMarked, setCategory, markId, scan, drain, ephemerons, violations, stack, idLike, weakIds, weakMaps, traced, count: () => count, nodes: () => nodes, pruned: () => pruned, visited };
}

/**
 * Collects unreachable objects. Returns { collected, reason?, before, after, freed, ms, markMs }.
 * options: { audit, extraRoots: () => iterable of values | values[], reason, requireQuiescence = true }
 */
export function collectGarbage(runtime, options = {}) {
  const tbPrevious = runtime.tb?.enter(BUCKET.GC);
  try { return collectGarbageTimed(runtime, options); } finally { runtime.tb?.leave(tbPrevious); }
}
function collectGarbageTimed(runtime, options) {
  const saved = runtime.hostCall, started = performance.now(); runtime.hostCall = 'coleta de lixo';   // the page must see "garbage collection" (with progress pulses), never a stale host call, while the VM is busy here
  try { return collectGarbageNow(runtime, options); } finally {
    runtime.hostCall = saved ?? null;
    const spent = performance.now() - started;
    if (runtime.gcPhases?.[0] && runtime.gcPhases[0].at >= started - 1) {   // a collection happened: pace the next one and keep its time out of the mutator's watchdogs
      runtime.gcLastEnd = performance.now(); runtime.gcLastMs = spent; runtime.gcTotalMs = (runtime.gcTotalMs ?? 0) + spent;
      const op = runtime.monitor?.op; if (op) { op.gcMs = (op.gcMs ?? 0) + spent; op.gcCount = (op.gcCount ?? 0) + 1; op.start += spent; }
      if (runtime.eventWallStart > 0) runtime.eventWallStart += spent;
    }
  }
}
function collectGarbageNow(runtime, { audit = globalThis.process?.env?.APKWEB_GC_AUDIT === '1', extraRoots = null, reason = 'manual', safepoint = false } = {}) {
  const started = performance.now(), heap = runtime.heap, before = heap.size;
  const blocked = quiescent(runtime, safepoint) ?? (unannotatedTask(runtime) ? 'unannotated-task' : null);
  if (blocked) { const skips = (runtime.gcSkips ??= {}); skips[blocked] = (skips[blocked] ?? 0) + 1; return { collected: false, reason: blocked, before, after: before, freed: 0, ms: 0 }; }
  const { limit, markedHas, setCategory, markId, scan, drain, ephemerons, violations, idLike, weakIds, weakMaps, traced, nodes, count, pruned, visited } = createMarker(runtime);
  const t0 = performance.now(); let worstRoot = { key: '-', ms: 0, nodes: 0 };
  // Runtime and platform: everything but the heap itself and the large immutable tables. Each root is timed and counted on its own; a root that turned out heavy (>50k JS nodes) is split into
  // its properties on the following collections (iterative deepening), so the report names the structure by path (platform.x.y).
  const heavy = runtime.gcHeavyPaths ??= new Set(), rows = [], plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set) && !ArrayBuffer.isView(value);
  const scanRoot = (value, path, depth) => {
    if (heavy.has(path) && depth < 5 && plain(value) && typeof value[GC_ROOTS] !== 'function') {
      visited.add(value);   // so that a back-reference to this object from one of its parts does not attribute the whole object to that part
      for (const key of Object.keys(value)) { const item = value[key]; if (item !== null && typeof item === 'object') scanRoot(item, `${path}.${key}`, depth + 1); else if (typeof item === 'number' && idLike(key, item)) markId(item); }
      return;
    }
    const at = performance.now(), nodes0 = nodes(); scan(value); const ms = performance.now() - at, n = nodes() - nodes0;
    if (n > 50000) heavy.add(path);
    if (ms > 1 || n > 1000) rows.push({ key: path, ms, nodes: n, kind: value?.constructor?.name ?? '?', size: value instanceof Map || value instanceof Set ? value.size : Array.isArray(value) ? value.length : undefined });
  };
  // Owner categories: roots are scanned and closed in a fixed order and every object keeps the category of the first group that reaches it (a dominator-lite attribution: where is the mass).
  const categories = new Map(); let counted = 0;
  const closeCategory = (id, name) => { drain(); const now = count(); if (now > counted) { const entry = categories.get(id) ?? categories.set(id, { id, name, n: 0 }).get(id); entry.n += now - counted; counted = now; } };
  setCategory(1); if (runtime.staticFields && typeof runtime.staticFields === 'object') scanRoot(runtime.staticFields, 'staticFields', 0); closeCategory(1, 'campos estáticos das classes');
  { const threads = runtime.scheduler?.threads ?? [];
    threads.forEach((thread, index) => { const id = 10 + Math.min(index, 200); setCategory(id); const view = Object.create(runtime.scheduler); view.threads = [thread]; runtime.scheduler.enumerateRoots.call(view, item => scan(item)); closeCategory(id, `thread ${thread.name ?? index}`); });
    for (const extra of [runtime.thread]) if (extra && Array.isArray(extra.frames) && runtime.scheduler && !threads.includes(extra)) { setCategory(5); const view = Object.create(runtime.scheduler); view.threads = [extra]; runtime.scheduler.enumerateRoots.call(view, item => scan(item)); closeCategory(5, 'thread em execução aninhada'); }
  }
  setCategory(2); for (const queue of [runtime.platform?.eventQueue]) if (queue) scan(queue); closeCategory(2, 'filas de Handler / eventos do host');
  // Host code up the JavaScript stack (a native that called back into Java, a class initializer, a nested wait) may hold values no Java frame references: what host code allocated and every result
  // handed back to it since the last fully quiescent collection stay alive. Outside a safepoint nothing is in flight and the set is dropped.
  setCategory(3);
  const stackQuiet = runtime.depth === 0 && runtime.nestedRuns <= 1 && !runtime.initDepth && !runtime.scheduler?.waitingNested?.size && !runtime.scheduler?.threads.some(thread => thread.nestedDepth > 0 || thread.nestedBlock);
  if (!safepoint || stackQuiet) runtime.hostAllocs.length = 0; else for (const id of runtime.hostAllocs) markId(id);
  graceRoots(runtime, markId);   // the last host allocations of finished calls (see APKRuntime.releaseHostAllocs)
  for (const weak of tracked) { const container = weak.deref(); if (container === undefined) tracked.delete(weak); else scan(container); }
  if (extraRoots) { const values = typeof extraRoots === 'function' ? extraRoots() : extraRoots; for (const item of values ?? []) scan(item); }
  closeCategory(3, 'raízes do host (alocações do host, contêineres, tarefas)');
  setCategory(4);
  for (const key of Object.keys(runtime)) {
    if (SKIP_PROPS.has(key) || key === 'staticFields') continue;
    const item = runtime[key];
    if (item !== null && typeof item === 'object') scanRoot(item, key, 0); else if (typeof item === 'number' && idLike(key, item)) markId(item);
  }
  closeCategory(4, 'tabelas da plataforma e do runtime');
  for (const row of rows) if (row.ms > worstRoot.ms) worstRoot = row;
  const topBy = field => [...rows].sort((a, b) => b[field] - a[field]).slice(0, 5).map(row => ({ key: row.key, ms: Math.round(row.ms), nodes: row.nodes, kind: row.kind, size: row.size }));
  runtime.gcTopRoots = { byNodes: topBy('nodes'), byMs: topBy('ms') };
  const rootsMs = performance.now() - t0, tRoots = performance.now();
  // Heap closure: scan each reachable record's own state.
  const tDrain = performance.now(); drain(); ephemerons();
  for (const map of runtime.ephemeronMaps ?? []) for (const key of [...map.keys()]) if (typeof key === 'number' && !markedHas(key)) map.delete(key);   // the key died: so does the entry
  for (const record of weakMaps) for (const entry of [...record.map.values()]) {   // WeakHashMap entries whose key died are expunged (without a modCount change, as in Java)
    if (traced.has(entry)) continue;
    if (!record.map.delete(entry.serial)) continue; runtime.reserveCollection(-1);
    const bucket = record.mapBuckets?.get(entry.hash); if (bucket) record.mapBuckets.set(entry.hash, bucket.filter(serial => serial !== entry.serial));
    if (record.tailSerial === entry.serial) { record.tailSerial = null; for (const serial of record.map.keys()) record.tailSerial = serial; }
  }
  if (runtime.nativeArrays?.size) {   // an array's native address is valid only while the array is alive
    for (const [handle, value] of [...runtime.nativeArrays]) if (value && !markedHas(value.ref)) runtime.nativeArrays.delete(handle);
    runtime.nativeRanges = runtime.nativeRanges.filter(range => range.value && markedHas(range.value.ref));
  }
  const markMs = performance.now() - t0;
  if (violations.length && audit) throw new Error(`GC audit: live structures reference already-collected objects #${[...new Set(violations)].map(id => `${id} ${heap.get(id)?.type}`).join(', #')} (a Java value held outside the collector's roots, e.g. captured by a host closure)`);
  if (audit && heap.size <= 250000) auditAgainstFullWalk(runtime, { markedHas, extraRoots });
  // Weak references: a referent nothing else keeps alive is cleared (Reference.get() answers null from now on) and its reference is queued on its ReferenceQueue after the collection.
  const cleared = [];
  for (const id of weakIds) {
    const record = heap.get(id), referent = record.fields.get(REFERENT_KEY);
    if (referent && typeof referent.ref === 'number' && !markedHas(referent.ref)) { record.fields.set(REFERENT_KEY, null); if (record.fields.get(QUEUE_KEY)) cleared.push({ ref: id }); }
  }
  // Sweep (only the blocks of ids that hold records).
  const tSweep = performance.now(); let freed = 0; const freedIds = [], freedTypes = [];
  for (const ci of heap.usedChunks()) {
    const chunk = heap.chunks[ci], base = ci << 12;
    for (let slot = 0; slot < 4096; slot++) {
      const record = chunk[slot]; if (record === undefined) continue;
      const id = base + slot;
      if (id === 0 || markedHas(id) || record.freed === true) continue;
      if (globalThis.process?.env?.APKWEB_GC_MARK_ONLY === '1') { freed++; continue; }
      freedIds.push(id); freedTypes.push(record.type);
      if (typeof record.onFree === 'function') { try { record.onFree(); } catch { /* the native resource is already gone */ } }   // NativeAllocationRegistry cleaners: native handles die with the Java object that owned them
      if (audit) { chunk[slot] = tombstone(id, record.type); heap.size--; } else heap.release(id);
      freed++;
      if (runtime.monitors?.has(id)) runtime.monitors.delete(id);
    }
  }
  // Budgets count live storage only.
  const survivors = new Map(), markBytes = runtime.gcMarkChunks;
  const tRebuild = performance.now(); let fieldSlots = runtime.staticFields?.size ?? 0, arrayCells = 0, collectionCells = 0;
  for (const ci of heap.usedChunks()) {
    const records = heap.chunks[ci];
    for (let slot = 0; slot < 4096; slot++) {
      const record = records[slot]; if (record === undefined || record.freed === true) continue;
      fieldSlots += record.fields?.size ?? 0; if (record.elements) arrayCells += record.elements.length;
      { const type = record.type; let entry = survivors.get(type); if (entry === undefined) { const own = runtime.classes.get(type); survivors.set(type, entry = { n: 0, bytes: 0, cats: new Uint32Array(256), dex: own ? (runtime.dex.bootDexes?.has(own.dex) ? 'framework' : (own.dex?.filename ?? 'app')) : 'host' }); }
        entry.cats[markBytes[ci][slot]]++; entry.n++; entry.bytes += 48 + (record.fields?.size ?? 0) * 8 + (record.elements ? record.elements.length * (record.type.length === 2 ? ELEMENT_WIDTH[record.type[1]] ?? 8 : 8) : 0) + (typeof record.value === 'string' ? record.value.length * 2 : 0) + ((record.list?.length ?? 0) + (record.set?.length ?? 0)) * 8 + (record.map?.size ?? 0) * 48; }
      collectionCells += (record.list?.length ?? 0) + (record.set?.length ?? 0) + (record.map?.size ?? 0);
    }
  }
  const phases = { reason, before, after: heap.size, rootsMs: Math.round(rootsMs), schedulerRootsMs: Math.round(tDrain - tRoots), markMs: Math.round(tSweep - tDrain), sweepMs: Math.round(tRebuild - tSweep), rebuildMs: Math.round(performance.now() - tRebuild), nodes: nodes(), marked: count(), worstRoot: { key: worstRoot.key, ms: Math.round(worstRoot.ms), nodes: worstRoot.nodes }, idRange: limit, blocksInUse: heap.usedChunks().length, pruned: pruned(), topByNodes: runtime.gcTopRoots.byNodes, topByMs: runtime.gcTopRoots.byMs, at: Math.round(performance.now()) };
  const name = type => String(type).replace(/^L|;$/g, '').replaceAll('/', '.');
  const top = field => [...survivors].sort((a, b) => b[1][field] - a[1][field]).slice(0, 12).map(([type, v]) => ({ type: name(type), n: v.n, bytes: v.bytes }));
  phases.survivorsByCount = top('n'); phases.survivorsByBytes = top('bytes');
  { const list = [...categories.values()].sort((a, b) => b.n - a.n), biggest = list[0];
    const topClassIn = id => { let best = null; for (const [type, v] of survivors) if (!best || v.cats[id] > best.n) best = { type: name(type), n: v.cats[id] }; return best; };
    phases.categories = list.slice(0, 8).map(c => ({ name: c.name, n: c.n, ...(c === biggest ? { topClass: topClassIn(c.id) } : {}) }));
    const byDex = new Map(); for (const v of survivors.values()) byDex.set(v.dex, (byDex.get(v.dex) ?? 0) + v.n);
    phases.byDex = [...byDex].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([dex, n]) => ({ dex, n })); }
  { const samples = [...(runtime.allocationSamples ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([site]) => site); phases.allocated = { count: Math.max(0, limit - (runtime.gcLastNextId ?? 0)), sites: samples }; }
  {   // the ids freed by the last collections (sorted, with their class), so that a use of a collected object is diagnosed as such (see APKRuntime.object)
    const ring = runtime.gcFreedRing ??= [], kinds = [...new Set(freedTypes)], index = new Map(kinds.map((type, i) => [type, i]));
    const order = Array.from(freedIds.keys()).sort((a, b) => freedIds[a] - freedIds[b]);
    ring.unshift({ collection: (runtime.gcStats?.collections ?? 0) + 1, ids: Int32Array.from(order, i => freedIds[i]), types: Uint16Array.from(order, i => index.get(freedTypes[i])), kinds }); ring.length = Math.min(ring.length, 3);
  }
  runtime.gcPhases = [phases, ...(runtime.gcPhases ?? [])].slice(0, 3);
  if (runtime.headroomBase) { runtime.maxHeapObjects = runtime.headroomBase; runtime.headroomBase = 0; }   // the OOM headroom (APKRuntime.oomHeadroom) lasts until this collection
  // A collection that frees little of a nearly full heap: the live set is a leak, not garbage. Find out who keeps the most numerous class alive (bounded; at most once per 20 s).
  if (freed < before * 0.05 && heap.size > runtime.maxHeapObjects * 0.6 && performance.now() - (runtime.gcRetentionAt ?? -1e9) > 20000) {
    runtime.gcRetentionAt = performance.now();
    try { runtime.gcRetention = retentionPaths(runtime); } catch (error) { runtime.gcRetention = { type: null, paths: [], error: String(error?.message ?? error) }; }
    runtime.gcRetentionAt = performance.now();
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
/** The first collection waits until the live heap passes this share of the object limit (then the hysteresis below applies). With the memory-budget limit (hundreds of thousands of objects) half the limit is
 *  already ~500 MiB of host memory, so garbage must be collected earlier: a quarter of the limit. */
export const GC_START_FRACTION = 0.25;
export function collectionDue(runtime, threshold = Math.floor(runtime.maxHeapObjects * GC_START_FRACTION)) {
  const wait = Math.min(runtime.gcMinAlloc ?? 0, Math.max(64, (runtime.maxHeapObjects - runtime.heap.size) >> 1)), allocated = runtime.nextId - (runtime.gcLastNextId ?? 0);   // never wait past half the remaining headroom
  // Pacing: a collection that took T ms is followed by at least 8 T ms of mutator time (<= ~11% GC overhead), unless the heap is nearly full (above 85% of the limit: collect, the report warns).
  if (runtime.gcLastEnd && (runtime.gcLastMs ?? 0) >= 20 && runtime.heap.size < runtime.maxHeapObjects * 0.85 && performance.now() - runtime.gcLastEnd < 8 * runtime.gcLastMs) return false;   // collections under 20 ms are cheap enough to run whenever they are due
  if (runtime.gcPressure) return allocated >= Math.min(wait, Math.max(1024, wait >> 2));   // a native resource count asked for it (regex handles are capped at 16384): wait less, but not for every quantum
  return allocated >= wait && runtime.heap.size >= Math.max(threshold, runtime.gcNextAt ?? 0);
}

/** Collects when the live heap passed `threshold` (default 40% of the limit) or in audit mode (every call). */
export function maybeCollect(runtime, options = {}) {
  const audit = options.audit ?? globalThis.process?.env?.APKWEB_GC_AUDIT === '1';
  if (!audit && !runtime.gcEnabled) return { collected: false, reason: 'disabled', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };   // opt-in until the audit suites are clean
  const threshold = options.threshold ?? Math.floor(runtime.maxHeapObjects * GC_START_FRACTION);
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
  const heap = runtime.heap, marker = createMarker(runtime), { markedHas, scan, drain, markId, idLike } = marker, groups = [], REACH_CAP = 25000;
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
  for (const ci of heap.usedChunks()) for (let slot = 0; slot < 4096; slot++) {
    const record = heap.chunks[ci][slot]; const id = (ci << 12) + slot; if (record === undefined || id === 0 || record.freed === true) continue;
    if (markedHas(id)) { live++; const entry = counts.get(record.type) ?? counts.set(record.type, { count: 0, bytes: 0 }).get(record.type), bytes = estimateRecordBytes(record); entry.count++; entry.bytes += bytes; estimatedBytes += bytes; }
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

/** Which of the last collections freed object `id`: { collection, type } or null (binary search in the sorted ring). */
export function freedBy(runtime, id) {
  for (const entry of runtime.gcFreedRing ?? []) {
    let low = 0, high = entry.ids.length - 1;
    while (low <= high) { const mid = (low + high) >> 1, value = entry.ids[mid]; if (value === id) return { collection: entry.collection, type: entry.kinds[entry.types[mid]] }; if (value < id) low = mid + 1; else high = mid - 1; }
  }
  return null;
}

/**
 * Why is an object alive? A breadth-first walk from the roots (runtime tables, statics, thread frames) over the same edges the collector follows, remembering for each node the node it was
 * reached from and the field/index name, until `samples` objects of class `type` (default: the most numerous survivor class of the last collection) are found. Bounded in time and nodes:
 * a diagnostic for the report, run when a collection frees little of a nearly full heap. Returns { type, paths: ['thread worker-2 frame Foo.bar -> field mCallbacks -> ArrayList.list[3] -> Foo', ...] }.
 */
export function retentionPaths(runtime, { type = null, samples = 3, budgetMs = 1500, maxNodes = 5_000_000 } = {}) {
  const heap = runtime.heap, limit = runtime.nextId, started = performance.now(), skip = buildSkip(runtime);
  const wanted = type ?? (runtime.gcPhases?.[0]?.survivorsByCount?.[0] ? 'L' + runtime.gcPhases[0].survivorsByCount[0].type.replaceAll('.', '/') + ';' : null);
  if (!wanted) return { type: null, paths: [], visited: 0 };
  const parent = new Map(), queue = [], found = [], short = t => String(t).replace(/^L|;$/g, '').split('/').pop();
  const visit = (node, from, label) => { if (parent.has(node)) return; parent.set(node, [from, label]); queue.push(node); };
  const idNode = id => (id > 0 && id < limit && heap.get(id) !== undefined && heap.get(id).freed !== true) ? id : null;
  const fieldName = key => { const at = key.indexOf('->'), colon = key.indexOf(':', at); return at >= 0 ? key.slice(at + 2, colon > 0 ? colon : undefined) : key; };
  const edge = (from, value, label) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      if (typeof value.ref === 'number' && Object.keys(value).length === 1) { const id = idNode(value.ref); if (id !== null) visit(id, from, label); return; }
      if (skip.has(value) || noRefs.has(value) || ArrayBuffer.isView(value) || value instanceof WeakMap || value instanceof WeakSet || value instanceof Promise) return;
      visit(value, from, label);
    }
  };
  // roots
  for (const key of Object.keys(runtime)) { if (SKIP_PROPS.has(key)) continue; const item = runtime[key]; if (item !== null && typeof item === 'object' && !skip.has(item)) edge(null, item, `runtime.${key}`); }
  for (const thread of runtime.scheduler?.threads ?? []) {
    const label = `thread ${thread.name}`;
    edge(null, thread.javaObject, `${label} (objeto)`); edge(null, thread.target, `${label} (target)`); edge(null, thread.lastOutcome, `${label} (resultado)`); edge(null, thread.blocked?.roots, `${label} (bloqueada)`);
    (thread.frames ?? []).forEach((frame, index) => {
      const m = frame.method, where = `${label} frame ${index} ${m ? short(m.owner) + '.' + m.name : '?'}`;
      if (frame.cont) { edge(null, frame.cont.args, where + ' (continuação)'); edge(null, frame.cont.roots, where + ' (continuação)'); return; }
      if (Array.isArray(frame.regs)) frame.regs.forEach((value, r) => edge(null, value, `${where} v${r}`)); edge(null, frame.result, where + ' (resultado)'); edge(null, frame.pendingException, where + ' (exceção)');
    });
  }
  for (const weak of tracked) { const container = weak.deref(); if (container !== undefined) edge(null, container, 'raiz de host'); }
  let visited = 0;
  for (let head = 0; head < queue.length && found.length < samples; head++) {
    if ((++visited & 4095) === 0 && (performance.now() - started > budgetMs || visited > maxNodes)) break;
    const node = queue[head];
    if (typeof node === 'number') {
      const record = heap.get(node);
      if (record.type === wanted) { found.push(node); if (found.length >= samples) break; }
      for (const key of Object.keys(record)) {
        const item = record[key];
        if (key === 'fields' && item instanceof Map) { for (const [k, v] of item) edge(node, v, fieldName(k)); continue; }
        if (key === 'elements' && Array.isArray(item) && refArrayType(record.type)) { for (let i = 0; i < item.length; i++) edge(node, item[i], `[${i}]`); continue; }
        if ((key === 'list' || key === 'set') && Array.isArray(item)) { for (let i = 0; i < item.length; i++) edge(node, item[i], `${key}[${i}]`); continue; }
        if (key === 'map' && item instanceof Map) { for (const v of item.values()) edge(node, v?.value ?? v, 'map'); for (const v of item.values()) edge(node, v?.key, 'map-key'); continue; }
        if (item !== null && typeof item === 'object') edge(node, item, key);
      }
    } else if (Array.isArray(node)) { if (node.length > NUMERIC_ARRAY_LIMIT && typeof node[0] === 'number') continue; for (let i = 0; i < node.length; i++) edge(node, node[i], `[${i}]`); }
    else if (node instanceof Map) { if (node.size > FLAT_CONTAINER_MIN && flatSample(node.values(), limit)) continue; for (const [k, v] of node) { edge(node, v, typeof k === 'string' ? `[${k.length > 60 ? k.slice(0, 60) + '…' : k}]` : 'map'); if (k !== null && typeof k === 'object') edge(node, k, 'chave'); } }
    else if (node instanceof Set) { if (node.size > FLAT_CONTAINER_MIN && flatSample(node.values(), limit)) continue; for (const v of node) edge(node, v, 'set'); }
    else { if (typeof node[GC_ROOTS] === 'function') node[GC_ROOTS](item => edge(node, item, 'raiz')); for (const key of Object.keys(node)) edge(node, node[key], key); }
  }
  const describe = node => {
    const steps = []; for (let at = node, guard = 0; at !== null && at !== undefined && guard < 200; guard++) { const link = parent.get(at); if (!link) break; const [from, label] = link; steps.push({ label, node: at }); at = from; }
    steps.reverse();
    const parts = steps.map(({ label, node: n }) => typeof n === 'number' ? `${label} (${short(heap.get(n).type)})` : label);
    return parts.length > 14 ? [...parts.slice(0, 5), '…', ...parts.slice(-8)].join(' → ') : parts.join(' → ');
  };
  return { type: wanted, paths: found.map(describe), visited, ms: Math.round(performance.now() - started), truncated: found.length < samples };
}

/**
 * Audit mode: the collector's root pruning (structural frames, flat-table skipping, class skips) must not change what is alive. A second, fully conservative mark (no pruning of any kind,
 * every thread and frame walked generically) runs on small heaps and every object it reaches must also be marked by the real collection.
 */
function auditAgainstFullWalk(runtime, { markedHas, extraRoots }) {
  const full = createMarker(runtime, { full: true }), { scan, drain, ephemerons, markId } = full;
  for (const key of Object.keys(runtime)) { if (SKIP_PROPS.has(key)) continue; const item = runtime[key]; if (item !== null && typeof item === 'object') scan(item); }
  runtime.scheduler?.enumerateRoots?.(item => scan(item));
  if (runtime.thread) scan(runtime.thread);
  for (const id of runtime.hostAllocs ?? []) markId(id);
  graceRoots(runtime, markId);
  for (const weak of tracked) { const container = weak.deref(); if (container !== undefined) scan(container); }
  if (extraRoots) { const values = typeof extraRoots === 'function' ? extraRoots() : extraRoots; for (const item of values ?? []) scan(item); }
  drain(); ephemerons();
  const missed = [];
  for (const ci of runtime.heap.usedChunks()) for (let slot = 0; slot < 4096; slot++) { const record = runtime.heap.chunks[ci][slot], id = (ci << 12) + slot; if (record === undefined || id === 0 || record.freed === true) continue; if (full.markedHas(id) && !markedHas(id)) missed.push(`${id} ${record.type}`); }
  if (missed.length) {   // where does the full walk find the first one? (breadth-first over threads, frames and the runtime tables, generic)
    const target = Number(missed[0].split(' ')[0]), parent = new Map(), queue = [], skipped = buildSkip(runtime); let found = null;
    const push = (child, from, label) => { if (child !== null && typeof child === 'object' && !parent.has(child) && !skipped.has(child) && !(child.id !== undefined && child.type !== undefined && child.fields !== undefined) && child !== runtime.heap && !Array.isArray(child.chunks)) { parent.set(child, [from, label]); queue.push(child); } };
    for (const key of Object.keys(runtime)) if (!SKIP_PROPS.has(key)) push(runtime[key], null, `runtime.${key}`);
    for (const thread of runtime.scheduler?.threads ?? []) push(thread, null, `thread ${thread.name}`);
    for (let head = 0; head < queue.length && !found && head < 3_000_000; head++) {
      const node = queue[head]; if (ArrayBuffer.isView(node) || node instanceof WeakMap || node instanceof WeakSet || node.freed === true) continue;
      if (typeof node.ref === 'number' && node.ref === target && Object.keys(node).length === 1) { found = node; break; }
      if (node instanceof Map) { for (const [k, v] of node) { push(v, node, `[${String(k).slice(0, 40)}]`); push(k, node, 'key'); } }
      else if (node instanceof Set || Array.isArray(node)) { let i = 0; for (const v of node) push(v, node, `[${i++}]`); }
      else for (const key of Object.keys(node)) push(node[key], node, key);
    }
    let path = ''; for (let at = found, guard = 0; at && parent.get(at) && guard < 400; guard++) { const [from, label] = parent.get(at); path = label + (path ? ' → ' + path : ''); at = from; }
    throw new Error(`GC audit: the pruned root scan lost ${missed.length} object(s) a full conservative walk reaches: #${missed.slice(0, 12).join(', #')}; first reached through ${path || '?'}`);
  }
  if (missed.length) throw new Error(`GC audit: the pruned root scan lost ${missed.length} object(s) a full conservative walk reaches: #${missed.slice(0, 12).join(', #')}`);
}

/** The ring of host allocations of finished calls: the most recent maxHeapObjects/32 (at most 8192) of them are roots. */
function graceRoots(runtime, markId) {
  const ring = runtime.hostGrace; if (!ring) return;
  const count = Math.min(8192, runtime.maxHeapObjects >> 5, runtime.hostGraceAt);
  for (let i = 1; i <= count; i++) { const id = ring[(runtime.hostGraceAt - i) & 8191]; if (id > 0) markId(id); }
}
