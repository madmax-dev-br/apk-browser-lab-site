// Mark-and-sweep reclamation of the VM heap (runtime.heap), run at quiescent points between host requests and, under heap pressure, at the safepoints of one long scheduling run
// (runtime.safepointCollect: thread switches and the quantum boundaries of interpreted and compiled code, reached at once when an allocation finds a collection due): there no host native
// is in flight on the running thread, so every live Java value is in a thread's frames, in the rooted tables below, or in the host-allocation set that protects what host code further out holds.
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
// java.lang.ref references, as ART treats them (finalizers are never run):
//  - WeakReference (and subclasses): the referent never keeps its object alive; once a collection finds it otherwise unreachable the referent is cleared and the reference is enqueued on its ReferenceQueue.
//  - SoftReference (and subclasses): strongly reachable in a normal collection (a cache is only emptied when the heap needs it). A collection run under pressure (`clearSoft`: the emergency collection at an
//    allocation site, a heap at or above NEAR_LIMIT of the object limit, a collection that follows one which freed less than 5% of a half-full heap, see softPolicy) does not trace through soft
//    references: objects reachable only softly die, their references are cleared and enqueued. ART does the same (it clears softly reachable objects before throwing OutOfMemoryError and when the
//    heap nears its target); libraries bound their caches with it.
//  - PhantomReference (and subclasses): get() never returns the referent and the marker never traces through it. When the referent is otherwise unreachable the reference is cleared and enqueued.
//    ART enqueues phantom references after finalization; the lab runs no finalizers, so a phantom is enqueued in the same collection that finds its referent unreachable.
//
// Collections outside motion (deferral): a collection that becomes due only through the normal pacing (the threshold and gcMinAlloc rules of collectionDue) while the main thread is in motion --
// a Choreographer frame running or pending, input delivered in the last GC_INPUT_SETTLE_MS, the main Looper with due work (AndroidPlatform.mainThreadMotion) -- waits for the first idle moment
// of the main thread (MessageQueue.next about to block with no frame pending: the tail of AndroidPlatform.drainEvents), so a 50-95 ms pause does not land inside an animation. The wait has a
// ceiling: the collection runs anyway, in motion, once the heap grew by GC_DEFER_MARGIN of the limit past the point where it became due (bounded by half the room left below NEAR_LIMIT) or after
// GC_DEFER_MAX_MS of host time, whichever comes first. The safety rules are never deferred: NEAR_LIMIT, the array-cell pressure, gcPressure (a native resource, System.gc, the OOM headroom), the
// emergency collection at an allocation site, and the soft-reference policy apply as before; audit and stress collections ignore the pacing altogether. gcStats.recent names the outcome: 'idle'
// (deferred, ran at the idle moment), 'forced' (deferred, the ceiling ran it in motion; `deferral.forcedBy` says which), 'threshold' / 'safepoint' (not deferred) and every entry records `motion`,
// the main thread's state when it ran (null = idle). gcStats.deferrals counts the episodes.
//
// Audit mode (APKWEB_GC_AUDIT=1, or collectGarbage(..., { audit: true })) replaces every freed record by a tombstone whose properties throw, so a root that was missed fails
// loudly at its first use instead of corrupting state.
//
// Young generation (docs/INTERACTION-PERFORMANCE.md item 2; runtime.gcGenerational, on by default; APKWEB_GC_GENERATIONS=0 turns it off in Node tools). A heap with a large long-lived set and
// short-lived frame garbage paid a whole-heap mark for every collection; a minor collection marks only the young objects.
//  - Ids are allocated in order and never reused, so a generation is an id range: ids below runtime.gcOldBound are old, ids in [gcOldBound, gcAgeBound) survived one minor collection (aged), the
//    rest are new. A major collection (everything above) promotes every survivor. A minor collection (collectMinor) treats every old id as marked and never traces it; aged survivors become old
//    (an object is promoted after surviving two minor collections, so what the current frame or a host call still holds is not tenured at once), new survivors become aged.
//  - Old records that may point to young ones are traced again by every minor collection: (1) the remembered set (gcRemList): the write barrier of every reference store into an old record --
//    the interpreter's iput-object and aput-object, the compiled ones (baseline-compiler.js BARRIER), APKRuntime.storeSlot / storeField and FieldMap.set (object-shapes.js) -- adds the record;
//    each minor collection recomputes the set exactly from what the traced records still point to; (2) the touched list (gcTouchList): every old record APKRuntime.object()/array() handed to host
//    code, which writes into records without a barrier (array cells, System.arraycopy, slots, its own host properties); a collection with host code in flight keeps the list, a quiescent point
//    (maybeCollect between events) moves it into the remembered set for one more rescan; the VM's own reads go through vmObject/vmArray and touch nothing; (3) the host-stateful records
//    (gcHostful): old records with a property of their own outside fields and cells that holds or may come to hold a reference (host state a host may write through a record it cached), rebuilt by
//    every major collection and extended by every minor one. Statics, threads, host tables and the other roots are scanned in full by every collection (statics need no barrier).
//  - java.lang.ref: a minor collection clears and enqueues the weak and phantom references (young ones, and old ones the remembered set brings back: an old reference whose referent slot holds a
//    young object stays remembered) whose young referent it did not mark; an old referent is cleared only by a major collection. Soft references are strong in a minor collection: only a
//    pressured major collection clears them. Ephemerons, native-address pruning, tombstones (the freed-id ring marks minor entries), onFree cleaners and monitors work the same over the young
//    range. The storage budgets drop by what a minor collection freed; a major collection recounts them.
//  - Pacing (collectionKind): a major collection when collectionDue asks for one -- with generations its threshold is measured on the old generation (the heap right after the last collection),
//    not on young garbage; the safety rules and the deferral in motion are unchanged -- else a minor one when the young generation is full (nurserySize: GC_NURSERY_FRACTION of the limit,
//    adapted to the share that survives, up to a quarter of the limit, never more than half the room left below 85%). A minor collection runs in motion while recent ones were short
//    (GC_MINOR_MOTION_MS); a slow one waits for the idle moment until another base-sized young generation was allocated. The first collection of a runtime, the emergency and soft-clearing ones
//    and collectGarbage() without `generation: 'minor'` are major.
//  - Audit: a minor collection in audit mode is cross-checked against a full conservative mark (anything it reaches must survive); audit and stress collections alternate three minor collections
//    and a major one. What remains unchecked by construction: host code that keeps the record of an old object without host state in a JavaScript closure (a rooted host structure is traced) and
//    later writes a young reference into its cells or slots directly, without object(), FieldMap or storeField; the tombstone diagnosis names a minor collection for such a case.
import { BUCKET } from './time-breakdown.js?v=97c59117b00c';
import { cellBytes } from './java-arrays.js?v=97c59117b00c';
import { storedFieldCount } from './object-shapes.js?v=97c59117b00c';
export const GC_ROOTS = Symbol.for('apkweb.gc.roots');

// Containers created inside host factories (closure state the collector cannot reach through object properties) register themselves here.
const tracked = new Set();
/** Register a Map/Set/Array that holds Java values (`{ ref }`) in host closure state; returns it unchanged. Weakly held: a container no host references is dropped. */
export function gcRoot(container) { tracked.add(new WeakRef(container)); return container; }

const ID_KEY = /(^id$|Id$|Ids$|^ids$|^ref$|Ref$|Refs$|^view$|View$|^target$|Target$|^receiver$|Receiver$|^owner$|Owner$|^activity$|Activity$|^object$|Object$|^handle$)/;
const SKIP_PROPS = new Set(['heap', 'dex', 'classes', 'resolvedClasses', 'resolveCache', 'hostMethodRefs', 'subtypeMemo', 'ancestorSets', 'methodEvidence', 'nativeBindings', 'apkEntries', 'traceRing', 'trace', 'scheduler', 'resources', 'gcStats', 'gcSkips', 'gcDeferral', 'gcDeferralStats', 'allocationSamples', 'nativeArrays', 'nativeRanges', 'profile', 'monitor', 'gcPhases', 'hostAllocs', 'allProgs', 'methodOverrides', 'methodOverridesAll', 'shapeMemo', 'gcRemList', 'gcRemBits', 'gcTouchList', 'gcTouchBits', 'gcHostful', 'gcHostBits', 'gcMinorStats', 'gcMinorPhases']);   // nativeArrays/nativeRanges pin an array's address only while the array lives (pruned after marking)   // gcStats keeps past nextId values: counters that look like object ids and would pin whatever object had that id
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

/** True while a direct activation (interpreter.js, "Direct form") is on a thread stack: its registers are JavaScript locals the collector cannot see. Its ghost frame says so. */
export function directFrames(runtime) {
  for (const thread of runtime.scheduler?.threads ?? []) { const frames = thread.frames; for (let i = frames.length - 1; i >= 0; i--) if (frames[i].busy === true) return true; }
  return false;
}
function quiescent(runtime, safepoint = false) {
  if ((runtime.t2Compiled ?? 0) > 0 && directFrames(runtime)) { runtime.q = 0; runtime.dlimit = 0; return 'direct-frames'; }   // the next poll of the direct code rebuilds its frames; the collection runs then
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
const REF_NONE = 0, REF_WEAK = 1, REF_SOFT = 2, REF_PHANTOM = 3;
const REF_SUPERS = new Map([['Ljava/lang/ref/WeakReference;', REF_WEAK], ['Ljava/lang/ref/SoftReference;', REF_SOFT], ['Ljava/lang/ref/PhantomReference;', REF_PHANTOM]]);
const weakTypeCaches = new WeakMap();   // per runtime: type -> kind of java.lang.ref.Reference it is (class hierarchies do not change after load)
const weakTypeCache = runtime => weakTypeCaches.get(runtime) ?? weakTypeCaches.set(runtime, new Map()).get(runtime);
/**
 * Big host tables of pure data (resource entries, string tables, per-class indexes) are most of the JS nodes of a large app and hold no Java reference. A container of more than
 * FLAT_CONTAINER_MIN entries is skipped when a sample of its leading entries is all primitives or "flat records": plain objects whose every property is a non-null string, number,
 * boolean or bigint and none of whose names look like an id (a property that is a string today does not become a reference tomorrow). A container that holds references, nulls or
 * nested objects in its sample is walked in full. `markNoJavaRefs(object)` declares an object (and everything under it) reference-free explicitly.
 */
/** Instances of these classes are code and metadata (DEX files, programs, compiled functions, frames, threads): never Java references, never walked. */
const SKIP_CONSTRUCTORS = new Set(['DexFile', 'DexProgram', 'DexClassTable', 'ClassTable', 'CompiledFunction', 'Frame', 'ClassDefinition', 'Shape']);   // not VMThread: the threads the scheduler runs are skipped by identity above (enumerateRoots covers them), but the host record of a Thread that was created and not started yet (a ThreadFactory's product before start()) holds its Runnable target, group and handler only there
const FLAT_CONTAINER_MIN = 2048, FLAT_SAMPLE = 48;
const TOMBSTONE_COLLECTIONS = 64, TOMBSTONE_IDS = 3000000;
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
/** Array-cell weights per element type (the budget approximates the Java-visible heap, not the host cost of a JS array element): byte/boolean 1/8 cell, char/short 1/4, int/float 1/2, long/double and references 1. */
const CELL_WEIGHT = { Z: 0.125, B: 0.125, C: 0.25, S: 0.25, I: 0.5, F: 0.5 };
/** The one place that turns an array into budget cells: ceil(length * weight of the element type), at least 1 for a non-empty array, 0 for an empty one. `type` is the array descriptor ('[B', '[[I', '[Ljava/lang/String;'). */
export function cellsOf(type, length) {
  if (length <= 0) return 0;
  const cells = Math.ceil(length * (type.length === 2 ? CELL_WEIGHT[type[1]] ?? 1 : 1));   // all weights are powers of two: exact in floating point
  return cells < 1 ? 1 : cells;
}
const refArrayTypes = new Map();
const refArrayType = type => { let v = refArrayTypes.get(type); if (v === undefined) { v = type.charCodeAt(0) === 91 && (type.charCodeAt(1) === 76 || type.charCodeAt(1) === 91); refArrayTypes.set(type, v); } return v; };
/** The big immutable tables and back-references that are never walked as roots (see SKIP_PROPS). */
function buildSkip(runtime) {
  const skip = new WeakSet([runtime.heap, runtime.dex, runtime.classes, runtime.resources, runtime.platform?.resources, runtime.scheduler, ...(runtime.ephemeronMaps ?? [])].filter(Boolean));   // ephemeron maps are not roots
  for (const name of SKIP_PROPS) { const table = runtime[name]; if (table !== null && typeof table === 'object') skip.add(table); }
  return skip;
}
/**
 * options: `full` (audit: no pruning, private marks), `clearSoft` (a pressured collection: SoftReference referents are not traced, see the header), `privateMarks` (marks that survive another
 * marker being created: the shared per-runtime chunks are zeroed by every marker), `epoch` (private 32-bit marks, `reset()` starts a new empty mark set without touching the chunks: used to measure
 * the reach of many roots one after the other), `order` (record the ids in the order they are marked: `marker.order`).
 */
export function createMarker(runtime, { full = false, clearSoft = false, privateMarks = false, epoch = false, order = false, minorBound = 0, promoteBound = Infinity, visitId = null } = {}) {
  // `visitId` (another engine's heap: vmcore/js/host-bridge.js): no marks here; the scan reports each object id it finds to visitId(id) and the caller marks, so the root walk below is shared.
  const heap = runtime.heap, weakIds = [], softIds = [], phantomIds = [], weakTypes = weakTypeCache(runtime), markOrder = order ? [] : null;
  // A minor collection (`minorBound` > 0): every id below the bound is old and counts as marked (it is never traced from here: old records that may point to young ones are rescanned
  // explicitly, see `rescan`), so the marks, the worklist and the sweep cover the young ids only. `promoteBound`: the ids below it are old after this collection (Infinity: every survivor);
  // `rememberIds` collects the traced records below it that hold a reference at or above it (the next remembered set), `hostfulIds` the newly old ones with host state of their own.
  const bound = minorBound > 0 ? minorBound : 0, boundChunk = bound >>> 12, promote = promoteBound, hostfulIds = [], rememberIds = [];
  /** The kind of java.lang.ref.Reference a heap type is: WeakReference (WeakHashMap entries, ThreadLocal map entries ...) and PhantomReference never keep the referent alive; SoftReference does unless `clearSoft`. */
  const refKind = type => { let kind = weakTypes.get(type); if (kind === undefined) { kind = REF_NONE; if (type.charCodeAt(0) === 76) try { for (let at = type, depth = 0; at && depth < 64; at = runtime.parent(at), depth++) { const found = REF_SUPERS.get(at); if (found !== undefined) { kind = found; break; } } } catch { kind = REF_NONE; } /* walks the superclass chain: runtime.isSubtype would memoize every type the collector meets */ weakTypes.set(type, kind); } return kind; };
  const limit = runtime.nextId, worklist = []; let nodes = 0, pruned = 0;
  // Mark bits per 4096-id chunk, allocated only for the chunks that hold records and reused across collections.
  const markChunks = full || privateMarks || epoch || visitId !== null ? [] : (runtime.gcMarkChunks ??= []);
  for (let ci = 0; ci < markChunks.length; ci++) if (markChunks[ci] !== undefined && heap.chunks[ci] === undefined) markChunks[ci] = undefined;
  if (visitId === null) for (let ci = boundChunk; ci < heap.chunks.length; ci++) if (heap.chunks[ci] !== undefined) { if (markChunks[ci] === undefined) markChunks[ci] = epoch ? new Uint32Array(4096) : new Uint8Array(4096); else markChunks[ci].fill(0); }
  let epochValue = 1;
  const isMarked = epoch ? (id => { const chunk = markChunks[id >>> 12]; return chunk !== undefined && chunk[id & 4095] === epochValue; })
    : bound > 0 ? (id => { if (id < bound) return true; const chunk = markChunks[id >>> 12]; return chunk !== undefined && chunk[id & 4095] !== 0; })
    : (id => { const chunk = markChunks[id >>> 12]; return chunk !== undefined && chunk[id & 4095] !== 0; });
  let category = 4; const setCategory = value => { category = value; };
  const setMarked = epoch ? (id => { markChunks[id >>> 12][id & 4095] = epochValue; }) : (id => { markChunks[id >>> 12][id & 4095] = category; });
  const marked = { has: isMarked };
  let visited = new WeakSet(); const stack = [];
  // The big tables are skipped by identity, not only by property name: a back-reference (jni.runtime, platform.runtime) reaches the runtime object from another root and would otherwise walk
  // its resolveCache (millions of entries) and the other skipped tables on every collection.
  const skip = buildSkip(runtime);
  // Threads and their frames are roots only through the scheduler's structural enumeration (registers, results, continuations): a back-reference from the runtime or the platform must never lead the
  // generic walk into a frame's program, method record or DEX tables (millions of nodes in a large app).
  if (!full) for (const thread of [runtime.thread, ...(runtime.scheduler?.threads ?? [])]) if (thread !== null && typeof thread === 'object') { skip.add(thread); if (Array.isArray(thread.frames)) { skip.add(thread.frames); for (const frame of thread.frames) if (frame !== null && typeof frame === 'object') skip.add(frame); } }
  const violations = [];
  const markId = visitId !== null ? (id => { if (id > 0 && id < limit) visitId(id); }) : (id, strict = false) => {
    if (!(id > 0 && id < limit) || isMarked(id)) return; const record = heap.get(id); if (record === undefined) return;
    if (record.freed === true) { if (strict && violations.length < 20) violations.push(id); return; }   // a real {ref} to an object collected earlier: a root the collector did not see
    setMarked(id); worklist.push(id); count++; if (markOrder !== null) markOrder.push(id);
  };
  const idLike = (key, value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value < limit && key !== 'gcLastNextId' && ID_KEY.test(key);   // gcLastNextId is the collector's own counter (the id the first object after the last collection got), not a reference: matching /Id$/ kept that one object, possibly a huge array, alive through every collection
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
    const record = heap.get(worklist.pop()), kind = refKind(record.type), weak = kind !== REF_NONE && (kind !== REF_SOFT || clearSoft);   // `weak`: this reference does not keep its referent alive in this mark
    if (kind === REF_WEAK) weakIds.push(record.id); else if (kind === REF_SOFT) { if (clearSoft) softIds.push(record.id); } else if (kind === REF_PHANTOM) phantomIds.push(record.id);
    let host = false;   // host state of the record's own (a property outside the field and element storage that holds or may come to hold a reference): rescanned by every minor collection
    const old = record.id < promote && promote !== Infinity; let young = false;   // old after this collection: does it still point into the young generation (then it is remembered)?
    for (const key in record) {
      const item = record[key];
      if (key === 'slots') {   // the instance fields (src/object-shapes.js); a weak/soft/phantom reference skips its referent slot (still remembered: a minor collection must see it to clear it)
        const skipSlot = weak ? record.fieldShape.referentSlot : -1;
        for (let i = 0; i < item.length; i++) { const value = item[i]; if (value !== null && typeof value === 'object') { if (i !== skipSlot) stack.push(value); if (old && !(value.ref < promote)) young = true; } }
        continue;
      }
      if (key === 'fieldShape' || key === 'id' || key === 'type') continue;   // layout metadata, the record's own id and class name: no references
      if (weak && key === 'referent') { host = true; continue; }   // a host-side referent kept outside the field table
      if (weak && (key === 'fieldExtra' || key === 'fields') && item instanceof Map) { for (const [fieldKey, fieldValue] of item) { if (fieldKey === REFERENT_KEY) continue; if (fieldValue !== null && typeof fieldValue === 'object') stack.push(fieldValue); } continue; }
      if (key === 'cells') { if (refArrayType(record.type)) { if (Array.isArray(item)) for (let i = 0; i < item.length; i++) { const element = item[i]; if (element !== null && typeof element === 'object') { stack.push(element); if (old && !(element.ref < promote)) young = true; } } else { scan(item); if (old) young = true; } } }   // a primitive array's typed storage holds no references
      else if (key === 'fieldExtra' || key === 'fields') { if (item !== null && typeof item === 'object') { stack.push(item); if (old && key === 'fieldExtra') young = true; } }   // the fields outside the shape (a Map: remembered conservatively), an array's NO_FIELDS
      else {
        if (item !== null && typeof item === 'object') { stack.push(item); host = true; }
        else if (typeof item === 'number') { if (idLike(key, item)) { markId(item); host = true; } }
        else if (item === null || item === undefined || typeof item === 'function') host = true;   // may be replaced by a reference later
      }
    }
    if (host) { if (record.id < promote) hostfulIds.push(record.id); } else if (young) rememberIds.push(record.id);   // a host-stateful old record is rescanned by every minor collection anyway
    scan();
  }
  };
  /** Ephemeron closure: a value of an ephemeron map is live only if its key (an object id) is live through something else. Runs to a fixed point. */
  const ephemerons = () => {
    for (let progress = true; progress;) {
      progress = false;
      for (const map of runtime.ephemeronMaps ?? []) for (const [key, value] of map) { if (typeof key === 'number' && isMarked(key) && value !== null && typeof value === 'object') { const before = count; scan(value); drain(); if (count !== before) progress = true; } }
    }
  };
  /** Epoch markers only: forget every mark, the worklist and the visited JavaScript objects (the next root starts from an empty mark set). */
  const reset = () => { epochValue++; worklist.length = 0; stack.length = 0; count = 0; visited = new WeakSet(); };
  /** Minor collections: queue an old record (a remembered or host-stateful one) to be traced again; old records are never marked. */
  const rescan = id => { const record = heap.get(id); if (record !== undefined && record.freed !== true) worklist.push(id); };
  return { limit, bound, rescan, hostfulIds, rememberIds, marked, markedHas: isMarked, setCategory, markId, scan, drain, ephemerons, violations, stack, idLike, weakIds, softIds, phantomIds, reset, order: markOrder, count: () => count, nodes: () => nodes, pruned: () => pruned, get visited() { return visited; } };
}

/**
 * The JavaScript side's roots for another engine's collector (the WebAssembly core: vmcore/js/host-bridge.js), read-only: every object id that the root sources of markRoots below
 * hold -- static fields, the scheduler's threads, the Handler/event queues, the host allocations in flight and their grace ring, the gcRoot containers, `extraRoots`, and the
 * runtime's and the platform's own tables -- is reported to visitId(id) (repeats included; the caller dedupes). Nothing is marked or freed here. Returns the scanner, whose
 * `scan(value)` the caller reuses for values it finds later (the companions of the records it marks: the ephemeron fixpoint).
 */
export function scanHostRoots(runtime, visitId, { extraRoots = null } = {}) {
  const marker = createMarker(runtime, { visitId }), { scan, markId, idLike } = marker;
  if (runtime.staticFields && typeof runtime.staticFields === 'object') scan(runtime.staticFields);
  const threads = runtime.scheduler?.threads ?? [];
  if (runtime.scheduler) for (const thread of [...threads, ...(runtime.thread && !threads.includes(runtime.thread) && Array.isArray(runtime.thread.frames) ? [runtime.thread] : [])]) { const view = Object.create(runtime.scheduler); view.threads = [thread]; runtime.scheduler.enumerateRoots.call(view, item => scan(item)); }
  for (const queue of [runtime.platform?.looperHost?.pendingEvents?.()]) if (queue) scan([...queue]);
  for (const id of runtime.hostAllocs ?? []) markId(id);
  graceRoots(runtime, markId);
  for (const weak of tracked) { const container = weak.deref(); if (container === undefined) tracked.delete(weak); else scan(container); }
  if (extraRoots) { const values = typeof extraRoots === 'function' ? extraRoots() : extraRoots; for (const item of values ?? []) scan(item); }
  for (const key of Object.keys(runtime)) {
    if (SKIP_PROPS.has(key) || key === 'staticFields') continue;
    const item = runtime[key];
    if (item !== null && typeof item === 'object') scan(item); else if (typeof item === 'number' && idLike(key, item)) markId(item);
  }
  return marker;
}

/**
 * Marks from every root (see the header) with `marker` and closes over the heap. In a minor collection (marker.bound > 0) the old records of the remembered set and the host-stateful ones are
 * traced again first. Returns { t0, categories, worstRoot, quiet }: `quiet` is true when nothing host-side was in flight, so the host-allocation set was dropped.
 */
function markRoots(runtime, marker, { safepoint, emergency, extraRoots, report }) {
  const t0 = performance.now(); let worstRoot = { key: '-', ms: 0, nodes: 0 };
  const { setCategory, markId, scan, drain, idLike, nodes, count, visited } = marker;
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
  if (marker.bound > 0) { setCategory(6); for (const id of runtime.gcRemList) marker.rescan(id); for (const id of runtime.gcTouchList) marker.rescan(id); for (const id of runtime.gcHostful) marker.rescan(id); closeCategory(6, 'objetos antigos relidos (conjunto lembrado, estado de host)'); }
  setCategory(1); if (runtime.staticFields && typeof runtime.staticFields === 'object') scanRoot(runtime.staticFields, 'staticFields', 0); closeCategory(1, 'campos estáticos das classes');
  { const threads = runtime.scheduler?.threads ?? [];
    threads.forEach((thread, index) => { const id = 10 + Math.min(index, 200); setCategory(id); const view = Object.create(runtime.scheduler); view.threads = [thread]; runtime.scheduler.enumerateRoots.call(view, item => scan(item)); closeCategory(id, `thread ${thread.name ?? index}`); });
    for (const extra of [runtime.thread]) if (extra && Array.isArray(extra.frames) && runtime.scheduler && !threads.includes(extra)) { setCategory(5); const view = Object.create(runtime.scheduler); view.threads = [extra]; runtime.scheduler.enumerateRoots.call(view, item => scan(item)); closeCategory(5, 'thread em execução aninhada'); }
  }
  setCategory(2); for (const queue of [runtime.platform?.looperHost?.pendingEvents?.()]) if (queue) scan([...queue]); closeCategory(2, 'filas de Handler / eventos do host');
  // Host code up the JavaScript stack (a native that called back into Java, a class initializer, a nested wait) may hold values no Java frame references: what host code allocated and every result
  // handed back to it since the last fully quiescent collection stay alive. Outside a safepoint nothing is in flight and the set is dropped.
  setCategory(3);
  const stackQuiet = runtime.depth === 0 && runtime.nestedRuns <= 1 && !runtime.initDepth && !runtime.scheduler?.waitingNested?.size && !runtime.scheduler?.threads.some(thread => thread.nestedDepth > 0 || thread.nestedBlock);
  // An emergency collection (APKRuntime.emergencyCollect) runs inside an allocation: host code of the allocating thread may be mid-way through a native holding what it allocated, so hostAllocs is never dropped there.
  const quiet = !safepoint || (stackQuiet && !emergency);
  if (quiet) runtime.hostAllocs.length = 0; else for (const id of runtime.hostAllocs) markId(id);
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
  if (report) runtime.gcTopRoots = { byNodes: topBy('nodes'), byMs: topBy('ms') };
  return { t0, categories, worstRoot, quiet };
}

/**
 * Collects unreachable objects. Returns { collected, reason?, before, after, freed, ms, markMs }.
 * options: { audit, extraRoots: () => iterable of values | values[], reason, requireQuiescence = true }
 */
export function collectGarbage(runtime, options = {}) {
  if (runtime.engine === 'wasm') return collectCore(runtime, options);
  const tbPrevious = runtime.tb?.enter(BUCKET.GC);
  try { return collectGarbageTimed(runtime, options); } finally { runtime.tb?.leave(tbPrevious); }
}
// engine 'wasm': the Java heap is the core's (vmcore), and so is the collector; this module only lends it the host root walk (scanHostRoots). A collection asked for here runs there.
function collectCore(runtime, options) {
  const engine = runtime.wasm, size = () => Number(runtime.heap?.size ?? 0);
  if (!engine) return { collected: false, reason: 'no-core', before: size(), after: size(), freed: 0, ms: 0 };
  const before = size(), started = performance.now(); engine.collect(options.reason ?? 'host');
  const ms = performance.now() - started, after = size();
  return { collected: true, reason: options.reason ?? 'host', before, after, freed: Math.max(0, before - after), ms, markMs: ms };
}
function collectGarbageTimed(runtime, options) {
  const saved = runtime.hostCall, started = performance.now(); runtime.hostCall = 'coleta de lixo';   // the page must see "garbage collection" (with progress pulses), never a stale host call, while the VM is busy here
  try { return collectGarbageNow(runtime, options); } finally {
    runtime.hostCall = saved ?? null;
    const spent = performance.now() - started, major = runtime.gcPhases?.[0] && runtime.gcPhases[0].at >= started - 1, minor = (runtime.gcMinorStats?.recent.at(-1)?.at ?? -Infinity) >= started - 1;
    if (major || minor) {   // a collection happened: pace the next one (a major collection) and keep its time out of the mutator's watchdogs
      if (major) { runtime.gcLastEnd = performance.now(); runtime.gcLastMs = spent; }
      runtime.gcTotalMs = (runtime.gcTotalMs ?? 0) + spent;
      const op = runtime.monitor?.op; if (op) { op.gcMs = (op.gcMs ?? 0) + spent; op.gcCount = (op.gcCount ?? 0) + 1; op.start += spent; }
      if (runtime.eventWallStart > 0) runtime.eventWallStart += spent;
    }
  }
}
function collectGarbageNow(runtime, { audit = globalThis.process?.env?.APKWEB_GC_AUDIT === '1', extraRoots = null, reason = 'manual', safepoint = false, emergency = false, clearSoft = undefined, generation = 'major' } = {}) {
  const started = performance.now(), heap = runtime.heap, before = heap.size;
  const blocked = quiescent(runtime, safepoint) ?? (unannotatedTask(runtime) ? 'unannotated-task' : null);
  if (blocked) { const skips = (runtime.gcSkips ??= {}); skips[blocked] = (skips[blocked] ?? 0) + 1; return { collected: false, reason: blocked, before, after: before, freed: 0, ms: 0 }; }
  if (generation === 'minor' && runtime.gcGenerational !== false && !emergency && clearSoft !== true) return collectMinor(runtime, { audit, extraRoots, reason, safepoint, started, before });
  // The main thread's state as this collection starts (null = idle) and the deferral episode it closes, if one was pending: a paced collection becomes 'idle' or 'forced' (see the header).
  const motion = runtime.platform?.mainThreadMotion?.() ?? null, closed = closeDeferral(runtime, reason, motion, started), deferral = closed.deferral; reason = closed.reason;
  const policy = clearSoft === false ? null : clearSoft === true ? 'forced' : softPolicy(runtime, { reason, emergency }), softMode = policy !== null;   // pressured collection: soft references are cleared (see the header)
  const marker = createMarker(runtime, { clearSoft: softMode }), { limit, markedHas, drain, ephemerons, violations, weakIds, softIds, phantomIds, nodes, count, pruned } = marker;
  const { t0, categories, worstRoot, quiet } = markRoots(runtime, marker, { safepoint, emergency, extraRoots, report: true });
  const rootsMs = performance.now() - t0, tRoots = performance.now();
  // Heap closure: scan each reachable record's own state.
  const tDrain = performance.now(); drain(); ephemerons();
  pruneAfterMark(runtime, markedHas);
  const markMs = performance.now() - t0;
  if (violations.length && audit) throw new Error(`GC audit: live structures reference already-collected objects #${[...new Set(violations)].map(id => `${id} ${heap.get(id)?.type}`).join(', #')} (a Java value held outside the collector's roots, e.g. captured by a host closure)`);
  if (audit && heap.size <= 250000) auditAgainstFullWalk(runtime, { markedHas, extraRoots, clearSoft: softMode });
  // Weak references, phantom references and (in a pressured collection) soft references: a referent nothing else keeps alive is cleared (Reference.get() answers null from now on) and its reference
  // is queued on its ReferenceQueue after the collection. Soft references whose referent something else keeps alive are left alone.
  const cleared = [], clearUnmarked = ids => clearReferences(heap, ids, markedHas, cleared);
  const weakCleared = clearUnmarked(weakIds), phantomCleared = clearUnmarked(phantomIds), softCleared = softMode ? clearUnmarked(softIds) : 0;
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
  const tRebuild = performance.now(); let fieldSlots = runtime.staticFields?.size ?? 0, arrayCells = 0, arrayBytes = 0, collectionCells = 0;
  for (const ci of heap.usedChunks()) {
    const records = heap.chunks[ci];
    for (let slot = 0; slot < 4096; slot++) {
      const record = records[slot]; if (record === undefined || record.freed === true) continue;
      const stored = storedFieldCount(record); fieldSlots += stored; if (record.cells !== undefined) { arrayCells += cellsOf(record.type, record.cells.length); arrayBytes += cellBytes(record.cells); }
      { const type = record.type; let entry = survivors.get(type); if (entry === undefined) { const own = runtime.classes.get(type); survivors.set(type, entry = { n: 0, bytes: 0, cats: new Uint32Array(256), dex: own ? (runtime.dex.bootDexes?.has(own.dex) ? 'framework' : (own.dex?.filename ?? 'app')) : 'host' }); }
        entry.cats[markBytes[ci][slot]]++; entry.n++; entry.bytes += 48 + stored * 8 + (record.cells !== undefined ? cellBytes(record.cells) : 0) + (typeof record.value === 'string' ? record.value.length * 2 : 0) + ((record.list?.length ?? 0) + (record.set?.length ?? 0)) * 8 + (record.map?.size ?? 0) * 48; }
      collectionCells += (record.list?.length ?? 0) + (record.set?.length ?? 0) + (record.map?.size ?? 0);
    }
  }
  const phases = { reason, motion, deferral, before, after: heap.size, rootsMs: Math.round(rootsMs), schedulerRootsMs: Math.round(tDrain - tRoots), markMs: Math.round(tSweep - tDrain), sweepMs: Math.round(tRebuild - tSweep), rebuildMs: Math.round(performance.now() - tRebuild), nodes: nodes(), marked: count(), worstRoot: { key: worstRoot.key, ms: Math.round(worstRoot.ms), nodes: worstRoot.nodes }, idRange: limit, blocksInUse: heap.usedChunks().length, pruned: pruned(), topByNodes: runtime.gcTopRoots.byNodes, topByMs: runtime.gcTopRoots.byMs, at: Math.round(performance.now()) };
  const name = type => String(type).replace(/^L|;$/g, '').replaceAll('/', '.');
  const top = field => [...survivors].sort((a, b) => b[1][field] - a[1][field]).slice(0, 12).map(([type, v]) => ({ type: name(type), n: v.n, bytes: v.bytes }));
  phases.survivorsByCount = top('n'); phases.survivorsByBytes = top('bytes');
  { const list = [...categories.values()].sort((a, b) => b.n - a.n), biggest = list[0];
    const topClassIn = id => { let best = null; for (const [type, v] of survivors) if (!best || v.cats[id] > best.n) best = { type: name(type), n: v.cats[id] }; return best; };
    phases.categories = list.slice(0, 8).map(c => ({ name: c.name, n: c.n, ...(c === biggest ? { topClass: topClassIn(c.id) } : {}) }));
    const byDex = new Map(); for (const v of survivors.values()) byDex.set(v.dex, (byDex.get(v.dex) ?? 0) + v.n);
    phases.byDex = [...byDex].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([dex, n]) => ({ dex, n })); }
  { const samples = [...(runtime.allocationSamples ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([site]) => site); phases.allocated = { count: Math.max(0, limit - (runtime.gcLastNextId ?? 0)), sites: samples }; }
  recordFreed(runtime, freedIds, freedTypes, { collection: (runtime.gcStats?.collections ?? 0) + 1 });
  phases.soft = { policy, cleared: softCleared, softReferences: softIds.length, weakCleared, phantomCleared };
  if (softMode) runtime.gcSoftLast = { collection: (runtime.gcStats?.collections ?? 0) + 1, policy, cleared: softCleared, softReferences: softIds.length, freed: before - heap.size };   // what the report's OOM line quotes
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
  // The x4 is bounded: never above a quarter of the limit nor a quarter of the room still left, so a heap that is filling up is never allowed to run to the limit between two collections.
  runtime.gcMinAlloc = Math.min(freed < before * 0.1 ? minAlloc * 4 : minAlloc, Math.max(1024, Math.floor(Math.min(runtime.maxHeapObjects * 0.25, (runtime.maxHeapObjects - heap.size) / 4))));
  // The cleared references are enqueued after the collection by a main-looper task (ART's ReferenceQueueDaemon also enqueues asynchronously). The task is deferred to the next pump: posting its
  // Message now would allocate while the collector is finishing (a WeakHashMap whose keys died clears its WeakReference entries in almost every collection of a real app).
  enqueueCleared(runtime, cleared);
  promote(runtime, marker, quiet, runtime.nextId, runtime.nextId);   // generations: every survivor is old now
  runtime.gcOldSize = heap.size;
  runtime.gcMinorMs ??= (performance.now() - started) / 2;   // before any minor collection, its pause is guessed at half this one's (minorDue's motion rule): a small heap whose minor collection would cost close to a major one does not run it in motion
  runtime.allocationSamples = null; runtime.gcPressure = false; runtime.gcCellPressure = false; runtime.gcLastNextId = runtime.nextId; runtime.fieldSlots = fieldSlots; runtime.arrayCells = arrayCells; runtime.arrayBytes = arrayBytes; runtime.collectionCells = collectionCells;
  runtime.gcStats = { collections: (runtime.gcStats?.collections ?? 0) + 1, majors: (runtime.gcStats?.majors ?? 0) + 1, minors: runtime.gcMinorStats?.collections ?? 0, freed: (runtime.gcStats?.freed ?? 0) + freed, lastLive: heap.size, peakLiveAfterGc: Math.max(runtime.gcStats?.peakLiveAfterGc ?? 0, heap.size), lastReason: reason, softCleared: (runtime.gcStats?.softCleared ?? 0) + softCleared, softCollections: (runtime.gcStats?.softCollections ?? 0) + (softMode ? 1 : 0), weakCleared: (runtime.gcStats?.weakCleared ?? 0) + weakCleared, phantomCleared: (runtime.gcStats?.phantomCleared ?? 0) + phantomCleared, totalMs: (runtime.gcStats?.totalMs ?? 0) + (performance.now() - started), deferrals: runtime.gcDeferralStats ?? null, recent: [...(runtime.gcStats?.recent ?? []).slice(-15), { kind: 'major', at: Math.round(started), ms: Math.round(performance.now() - started), markMs: Math.round(markMs), before, after: heap.size, nextId: runtime.nextId, reason, motion, ...(deferral ? { deferral } : {}), ...(softMode ? { soft: policy, softCleared } : {}) }] };
  return { collected: true, reason, before, after: heap.size, freed, ms: Math.round(performance.now() - started), markMs: Math.round(markMs), softPolicy: policy, softCleared };
}

/**
 * Minor collection (see the header, "Young generation"): marks from the roots, the remembered set and the host-stateful old records, treating every old id as live; frees the unreachable young
 * records; promotes the survivors. Weak and phantom references (young ones, and old ones the remembered set brings back) whose young referent died are cleared and enqueued as in a major
 * collection; soft references are strong here (only a pressured major collection clears them). The budgets drop by what the freed records held (a major collection recounts them).
 */
function collectMinor(runtime, { audit, extraRoots, reason, safepoint, started, before }) {
  const heap = runtime.heap, bound = runtime.gcOldBound, aged = Math.max(bound, runtime.gcAgeBound ?? 0), young = runtime.nextId - bound, motion = runtime.platform?.mainThreadMotion?.() ?? null;
  const remembered = runtime.gcRemList.length, touched = runtime.gcTouchList.length, hostful = runtime.gcHostful.length;
  // Survivors below `aged` survived the previous minor collection too: they become old now; the younger ones survive once and stay young until the next one.
  const marker = createMarker(runtime, { minorBound: bound, promoteBound: aged }), { markedHas, drain, ephemerons, violations, weakIds, phantomIds, nodes, count } = marker;
  const { t0, quiet } = markRoots(runtime, marker, { safepoint, emergency: false, extraRoots, report: false });
  drain(); ephemerons();
  pruneAfterMark(runtime, markedHas);
  const markMs = performance.now() - t0;
  if (violations.length && audit) throw new Error(`GC audit: live structures reference already-collected objects #${[...new Set(violations)].map(id => `${id} ${heap.get(id)?.type}`).join(', #')} (a Java value held outside the collector's roots, e.g. captured by a host closure)`);
  // Audit: what a full conservative mark reaches must not be freed here (old ids count as marked, so this checks the young ones: a missed barrier or remembered record fails here).
  if (audit && heap.size <= 250000) auditAgainstFullWalk(runtime, { markedHas, extraRoots, clearSoft: false, minor: true });
  const cleared = [], weakCleared = clearReferences(heap, weakIds, markedHas, cleared), phantomCleared = clearReferences(heap, phantomIds, markedHas, cleared);
  const tSweep = performance.now(), firstChunk = bound >>> 12, freedIds = [], freedTypes = [];
  let freed = 0, fresh = 0, fieldSlots = 0, arrayCells = 0, arrayBytes = 0, collectionCells = 0;   // fresh: survivors allocated since the last collection
  for (const ci of heap.usedChunks()) {
    if (ci < firstChunk) continue;
    const chunk = heap.chunks[ci], base = ci << 12;
    for (let slot = 0; slot < 4096; slot++) {
      const record = chunk[slot]; if (record === undefined) continue;
      const id = base + slot;
      if (id < bound || id === 0 || record.freed === true) continue;
      if (markedHas(id)) { if (id >= aged) fresh++; continue; }
      freedIds.push(id); freedTypes.push(record.type);
      fieldSlots += storedFieldCount(record); if (record.cells !== undefined) { arrayCells += cellsOf(record.type, record.cells.length); arrayBytes += cellBytes(record.cells); }
      collectionCells += (record.list?.length ?? 0) + (record.set?.length ?? 0) + (record.map?.size ?? 0);
      if (typeof record.onFree === 'function') { try { record.onFree(); } catch { /* the native resource is already gone */ } }
      if (audit) { chunk[slot] = tombstone(id, record.type); heap.size--; } else heap.release(id);
      freed++;
      if (runtime.monitors?.has(id)) runtime.monitors.delete(id);
    }
  }
  runtime.fieldSlots = Math.max(0, (runtime.fieldSlots ?? 0) - fieldSlots); runtime.arrayCells = Math.max(0, (runtime.arrayCells ?? 0) - arrayCells);
  runtime.arrayBytes = Math.max(0, (runtime.arrayBytes ?? 0) - arrayBytes); runtime.collectionCells = Math.max(0, (runtime.collectionCells ?? 0) - collectionCells);
  const stats = runtime.gcMinorStats ??= { collections: 0, freed: 0, promoted: 0, totalMs: 0, maxMs: 0, recent: [] };
  recordFreed(runtime, freedIds, freedTypes, { collection: (runtime.gcStats?.collections ?? 0) + 1, minor: true });
  enqueueCleared(runtime, cleared);
  const nextAged = runtime.nextId, allocated = nextAged - aged; promote(runtime, marker, quiet, aged, nextAged);
  adaptNursery(runtime, allocated > 0 ? fresh / allocated : 0);
  runtime.gcOldSize = heap.size;
  const ms = performance.now() - started, survivors = count();
  runtime.gcMinorMs = runtime.gcMinorMs === undefined ? ms : (runtime.gcMinorMs + ms) / 2;   // recent pause, for the motion rule of minorDue
  stats.collections++; stats.freed += freed; stats.promoted += survivors; stats.totalMs += ms; stats.maxMs = Math.max(stats.maxMs, ms); stats.weakCleared = (stats.weakCleared ?? 0) + weakCleared; stats.phantomCleared = (stats.phantomCleared ?? 0) + phantomCleared;
  const entry = { at: Math.round(started), ms: Math.round(ms * 10) / 10, markMs: Math.round(markMs * 10) / 10, sweepMs: Math.round((performance.now() - tSweep) * 10) / 10, before, after: heap.size, young, allocated, survivors, fresh, nursery: nurserySize(runtime), remembered, touched, hostful, nodes: nodes(), reason, motion };
  stats.recent.push(entry); if (stats.recent.length > 16) stats.recent.shift();
  // gcStats counts every collection, minor ones included (`majors` the major ones); its recent list marks them kind 'minor'.
  const g = runtime.gcStats ?? {};
  runtime.gcStats = { ...g, collections: (g.collections ?? 0) + 1, majors: g.majors ?? 0, minors: stats.collections, freed: (g.freed ?? 0) + freed, lastLive: heap.size, peakLiveAfterGc: Math.max(g.peakLiveAfterGc ?? 0, heap.size), lastReason: reason, weakCleared: (g.weakCleared ?? 0) + weakCleared, phantomCleared: (g.phantomCleared ?? 0) + phantomCleared, totalMs: (g.totalMs ?? 0) + ms, deferrals: runtime.gcDeferralStats ?? null, recent: [...(g.recent ?? []).slice(-15), { kind: 'minor', at: entry.at, ms: Math.round(ms), markMs: Math.round(markMs), before, after: heap.size, nextId: runtime.nextId, reason, motion }] };
  return { collected: true, minor: true, reason, before, after: heap.size, freed, survivors, ms: Math.round(ms), markMs: Math.round(markMs) };
}
/** After marking: ephemeron entries whose key died go, and so do the native addresses of dead arrays. */
function pruneAfterMark(runtime, markedHas) {
  for (const map of runtime.ephemeronMaps ?? []) for (const key of [...map.keys()]) if (typeof key === 'number' && !markedHas(key)) map.delete(key);   // the key died: so does the entry
  if (runtime.nativeArrays?.size) {   // an array's native address is valid only while the array is alive
    for (const [handle, value] of [...runtime.nativeArrays]) if (value && !markedHas(value.ref)) runtime.nativeArrays.delete(handle);
    runtime.nativeRanges = runtime.nativeRanges.filter(range => range.value && markedHas(range.value.ref));
  }
}

/** Clears the referent of every reference of `ids` whose referent is not marked; the ones registered with a queue go into `cleared` (enqueued after the collection). Returns how many were cleared. */
function clearReferences(heap, ids, markedHas, cleared) {
  let n = 0;
  for (const id of ids) {
    const record = heap.get(id), referent = record.fields.get(REFERENT_KEY);
    if (referent && typeof referent.ref === 'number' && !markedHas(referent.ref)) { record.fields.set(REFERENT_KEY, null); n++; if (record.fields.get(QUEUE_KEY)) cleared.push({ ref: id }); }
  }
  return n;
}
/** The cleared references are enqueued after the collection by a main-looper task (ART's ReferenceQueueDaemon also enqueues asynchronously). The task is deferred to the next pump: posting its
 *  Message now would allocate while the collector is finishing (a WeakHashMap whose keys died clears its WeakReference entries in almost every collection of a real app). */
function enqueueCleared(runtime, cleared) {
  if (!cleared.length || !runtime.platform?.queueTask) return;
  runtime.platform.queueTask(() => { for (const reference of cleared) { try { runtime.dispatch({ owner: 'Ljava/lang/ref/Reference;', name: 'enqueue', parameters: [], result: 'Z', signature: '()Z' }, [reference], 'virtual'); } catch { /* the queue is gone with its owner */ } } }, 0, cleared, { deferred: true });
}
/**
 * The ids freed by the last collections (sorted, with their class), so that a use of a collected object is diagnosed as such (see APKRuntime.object). Kept for the last TOMBSTONE_COLLECTIONS
 * collections or TOMBSTONE_IDS freed ids, whichever is reached first (6 bytes per freed object): a Java value that host code held unseen by the collector is typically used many collections after
 * it was freed, and the diagnosis needs the class of what was freed and the collection that freed it. `label`: { collection } for a major collection, { collection, minor } for a minor one
 * (`collection` is then the number of major collections before it).
 */
function recordFreed(runtime, freedIds, freedTypes, label) {
  if (!freedIds.length && label.minor !== undefined) return;   // an empty minor collection leaves no entry (minor collections are frequent)
  const ring = runtime.gcFreedRing ??= [], kinds = [...new Set(freedTypes)], index = new Map(kinds.map((type, i) => [type, i]));
  ring.unshift({ ...label, ids: Int32Array.from(freedIds), types: Uint16Array.from(freedTypes, type => index.get(type)), kinds });   // the sweeps walk the ids in ascending order: already sorted for freedBy's binary search
  let kept = 0, total = 0; for (const entry of ring) { total += entry.ids.length; if (kept > 0 && (kept >= TOMBSTONE_COLLECTIONS || total > TOMBSTONE_IDS)) break; kept++; } ring.length = kept;
}
/**
 * The generation bookkeeping after a collection. `oldBound`: the ids below it are old from now on (a major collection: every survivor; a minor one: the survivors that had already survived the
 * previous minor collection); `agedBound`: the ids in [oldBound, agedBound) survived once and stay young. The remembered set becomes the traced records below oldBound that still point at or
 * above it (marker.rememberIds: every remembered, touched and newly promoted record was traced, so this is exact). The touched records stay in their list while host code is in flight
 * (`quiet` false: a native up the stack may still write into a record it obtained before the collection); otherwise the list is emptied. The host-stateful records below oldBound join the list
 * every minor collection rescans (a major collection rebuilds it from scratch).
 */
function promote(runtime, marker, quiet, oldBound, agedBound) {
  if (runtime.gcGenerational === false) { runtime.gcOldBound = 0; runtime.gcAgeBound = 0; runtime.gcRemList = []; runtime.gcRemBits = []; runtime.gcTouchList = []; runtime.gcTouchBits = []; runtime.gcHostful = []; runtime.gcHostBits = []; return; }
  const major = marker.bound === 0, list = [], bits = [];
  for (const id of marker.rememberIds) if (id < oldBound) addId(list, bits, id);
  runtime.gcRemList = list; runtime.gcRemBits = bits;
  if (quiet) { runtime.gcTouchList = []; runtime.gcTouchBits = []; } else if (major) runtime.gcTouchList = runtime.gcTouchList.filter(id => runtime.heap.get(id) !== undefined);
  if (major) { runtime.gcHostful = []; runtime.gcHostBits = []; }
  for (const id of marker.hostfulIds) if (id < oldBound) addId(runtime.gcHostful, runtime.gcHostBits ??= [], id);
  runtime.gcOldBound = oldBound; runtime.gcAgeBound = agedBound;
}
/** Adds `id` to a list with a membership bitmap (Uint8Array per 4096-id chunk) unless it is in it already. */
function addId(list, bits, id) { const ci = id >>> 12, chunk = bits[ci] ?? (bits[ci] = new Uint8Array(4096)), i = id & 4095; if (chunk[i] === 0) { chunk[i] = 1; list.push(id); } }
/** A quiescent point (no host code in flight): the records host code obtained so far can no longer be written by a native that is still running, so they move from the touched list to the
 *  remembered set, rescanned once more by the next minor collection (which keeps only those that still point into the young generation). */
export function settleTouches(runtime) {
  const touched = runtime.gcTouchList; if (!touched?.length) return;
  for (const id of touched) addId(runtime.gcRemList, runtime.gcRemBits, id);
  runtime.gcTouchList = []; runtime.gcTouchBits = [];
}

/** A collection that follows one which freed less than this share of the heap clears soft references (when the heap is at least SOFT_LOW_YIELD_FILL full: a small app that is simply all live keeps its caches). */
export const SOFT_LOW_YIELD = 0.05, SOFT_LOW_YIELD_FILL = 0.5;
/**
 * Why this collection clears soft references (null: it does not), the way ART's heap policy does under pressure. In order: 'emergency' (the collection at an allocation site that is about to fail, or
 * the last one before an OutOfMemoryError: APKRuntime.emergencyCollect), 'near-limit' (the live heap is at or above NEAR_LIMIT of the object limit), 'low-yield' (the previous collection freed less
 * than SOFT_LOW_YIELD of its heap and the heap is at least SOFT_LOW_YIELD_FILL of the limit: the live set keeps growing, so caches must give way).
 */
export function softPolicy(runtime, { reason = 'manual', emergency = false } = {}) {
  if (emergency || reason === 'emergency') return 'emergency';
  const size = runtime.heap.size, limit = runtime.headroomBase || runtime.maxHeapObjects;   // the OOM headroom is not capacity
  if (size >= limit * NEAR_LIMIT) return 'near-limit';
  const last = runtime.gcPhases?.[0];
  if (last && last.before > 0 && (last.before - last.after) < last.before * SOFT_LOW_YIELD && size >= limit * SOFT_LOW_YIELD_FILL) return 'low-yield';
  return null;
}

/** True when a pressure-driven collection (thread-switch safepoint, event boundary) may run now: enough was allocated since the last one, and the heap passed the threshold or a native resource asked for it. */
/** The first collection waits until the live heap passes this share of the object limit (then the hysteresis below applies). With the memory-budget limit (hundreds of thousands of objects) half the limit is
 *  already ~500 MiB of host memory, so garbage must be collected earlier: a quarter of the limit. */
export const GC_START_FRACTION = 0.25;
export const NEAR_LIMIT = 0.9;
export function collectionDue(runtime, threshold = Math.floor(runtime.maxHeapObjects * GC_START_FRACTION)) {
  const wait = Math.min(runtime.gcMinAlloc ?? 0, Math.max(64, (runtime.maxHeapObjects - runtime.heap.size) >> 1)), allocated = runtime.nextId - (runtime.gcLastNextId ?? 0);   // never wait past half the remaining headroom
  // Near the limit (>= 90%, which includes the OOM headroom): pacing, gcMinAlloc and gcNextAt are ignored; the only guard against re-scanning a genuinely live heap at every safepoint is a small allocation floor.
  if (runtime.heap.size >= runtime.maxHeapObjects * NEAR_LIMIT) return allocated >= Math.max(64, Math.min(256, (runtime.maxHeapObjects - runtime.heap.size) >> 2));
  if (runtime.gcCellPressure && runtime.arrayCells > runtime.maxArrayCells * 0.75) return true;   // three quarters of the array-cell budget: big arrays are few objects, so neither the object-count wait nor the pacing below may hold the collection back
  // Pacing: a collection that took T ms is followed by at least 8 T ms of mutator time (<= ~11% GC overhead), unless the heap is nearly full (above 85% of the limit: collect, the report warns).
  if (runtime.gcLastEnd && (runtime.gcLastMs ?? 0) >= 20 && runtime.heap.size < runtime.maxHeapObjects * 0.85 && performance.now() - runtime.gcLastEnd < 8 * runtime.gcLastMs) return false;   // collections under 20 ms are cheap enough to run whenever they are due
  if (runtime.gcCellPressure) return true;   // half of the array-cell budget is in use (newArray)
  if (runtime.gcPressure) return allocated >= Math.min(wait, Math.max(1024, wait >> 2));   // a native resource count asked for it (regex handles are capped at 16384): wait less, but not for every quantum
  // Generations: what a major collection is for is the old generation's growth (the heap right after the last collection, every survivor promoted); young garbage is the minor collections' business.
  const live = runtime.gcOldBound > 0 && runtime.gcGenerational !== false ? (runtime.gcOldSize ?? runtime.heap.size) : runtime.heap.size;
  if (!(allocated >= wait && live >= Math.max(threshold, runtime.gcNextAt ?? 0))) return false;
  return !deferred(runtime);   // due by the normal pacing alone: it may wait for the main thread's idle moment (see the header)
}

/** Young generation size: a minor collection is due once this share of the object limit was allocated since the last collection (at least GC_NURSERY_MIN objects; runtime.gcNursery overrides it). */
export const GC_NURSERY_FRACTION = 1 / 16, GC_NURSERY_MIN = 4096;
const baseNursery = runtime => Math.max(GC_NURSERY_MIN, Math.floor((runtime.headroomBase || runtime.maxHeapObjects) * GC_NURSERY_FRACTION));
/** The young generation's size now: the adapted size (or runtime.gcNursery), never more than half the room left below 85% of the limit, so a minor collection comes before the heap nears it. */
export const nurserySize = runtime => {
  const size = runtime.gcNursery ?? runtime.gcNurseryNow ?? baseNursery(runtime), limit = runtime.headroomBase || runtime.maxHeapObjects;
  return Math.min(size, Math.max(GC_NURSERY_MIN, Math.floor((limit * 0.85 - (runtime.gcOldSize ?? runtime.heap.size)) / 2)));
};
/** Survival rates that resize the young generation (see adaptNursery). */
export const NURSERY_GROW_SURVIVAL = 0.3, NURSERY_SHRINK_SURVIVAL = 0.1;
/**
 * The young generation adapts to the share of it that survives a minor collection: a minor collection costs about what it marks, so when more than NURSERY_GROW_SURVIVAL of what was allocated
 * since the last one is still alive (objects that live a few frames: recomposition state, a screen being built) the next one waits for 1.5x as many allocations (up to a quarter of the limit),
 * letting more of them die first; below NURSERY_SHRINK_SURVIVAL it shrinks back towards the base size (shorter pauses).
 */
function adaptNursery(runtime, survival) {
  const base = baseNursery(runtime), current = runtime.gcNurseryNow ?? base, cap = Math.max(base, Math.floor((runtime.headroomBase || runtime.maxHeapObjects) / 4));
  runtime.gcNurseryNow = survival > NURSERY_GROW_SURVIVAL ? Math.min(cap, Math.floor(current * 1.5)) : survival < NURSERY_SHRINK_SURVIVAL ? Math.max(base, Math.floor(current / 1.5)) : current;
}
/** A minor collection runs while the main thread is in motion only if the recent ones were at most this long (an exponential average of their pauses); a longer one waits for the idle moment. */
export const GC_MINOR_MOTION_MS = 12;
/**
 * True when a minor collection is due: generations are on, the heap passed the first-collection threshold (as for a major one) and the young generation is full (allocations since the last
 * collection: the aged survivors of the last one do not count). In motion (AndroidPlatform.mainThreadMotion) a minor collection runs at once when they have been short (GC_MINOR_MOTION_MS: what
 * a heap with a big long-lived set and short-lived frame garbage gets); when they have been long (a heap whose young objects live for several frames survives them, so they mark nearly as much as
 * they free) it waits for the main thread's idle moment, as a major collection does, until another base-sized young generation (GC_NURSERY_FRACTION of the limit) was allocated.
 */
export function minorDue(runtime, threshold = Math.floor(runtime.maxHeapObjects * GC_START_FRACTION)) {
  if (runtime.gcGenerational === false || runtime.gcOldBound === 0 || runtime.heap.size < threshold) return false;   // the first collection is a major one: it establishes the old generation
  const allocated = runtime.nextId - Math.max(runtime.gcOldBound, runtime.gcAgeBound), nursery = nurserySize(runtime);
  if (allocated < nursery) return false;
  if (allocated < nursery + Math.min(nursery, baseNursery(runtime)) && (runtime.gcMinorMs ?? 0) > GC_MINOR_MOTION_MS && (runtime.platform?.mainThreadMotion?.() ?? null) !== null) { runtime.gcMinorHeld = (runtime.gcMinorHeld ?? 0) + 1; return false; }
  return true;
}
/** Which collection the pacing asks for now: 'major' (collectionDue: the old generation grew past its threshold, or a safety rule), else 'minor' (minorDue), else null. A major collection held
 *  back in motion (deferred) lets a minor one run meanwhile. */
export function collectionKind(runtime, threshold = Math.floor(runtime.maxHeapObjects * GC_START_FRACTION)) {
  if (collectionDue(runtime, threshold)) return 'major';
  return minorDue(runtime, threshold) ? 'minor' : null;
}
/** Audit and stress collections (every event / every safepoint) alternate: three minor collections, then a major one, so both kinds are exercised and cross-checked. */
export function auditGeneration(runtime) {
  if (runtime.gcGenerational === false) return 'major';
  runtime.gcAuditTurn = ((runtime.gcAuditTurn ?? 0) + 1) & 3;
  return runtime.gcAuditTurn === 0 || runtime.gcOldBound === 0 ? 'major' : 'minor';
}

/**
 * Deferral ceilings, chosen on the two example flows (scripts/validation/bench-gc-motion.mjs, Node, 2026-11-08): a motion window (frames pending back to back) lasts a median 172-195 ms, p90
 * 330-383 ms, at most 635-863 ms of host time in the Compose flow (63 / 83 / 121 ms in the XML one) and allocates a median 4950, p90 17676, at most 22695 objects (36-63 objects per host ms).
 * GC_DEFER_MAX_MS = 500 ms lets more than nine windows in ten finish before the collector runs. GC_DEFER_MARGIN = 5% of the limit (13107 objects at the default 262144) covers 84% of whole windows
 * (more of the part left once a collection is due, mid-window) and bounds how far a wait can raise the peak heap: a 10% margin let the Compose flow's peak grow 15% (145 k -> 167 k), 5% held it to
 * 8-12% (157-162 k over two runs; 6 of 8 collections at idle, 2 forced by the heap ceiling). Whichever ceiling the app reaches first ends the wait. A runtime may override both (runtime.gcDeferMaxMs, runtime.gcDeferMargin: tests).
 */
export const GC_DEFER_MAX_MS = 500, GC_DEFER_MARGIN = 0.05;
/**
 * True when a collection that is due by the normal pacing must wait: the main thread is in motion (runtime.platform.mainThreadMotion() names why) and the deferral's ceilings are not reached.
 * The first held check opens the episode (runtime.gcDeferral: when, at which heap size and allocation count, its ceilings); later checks count against it. An idle check does not close it --
 * the collection that follows does (collectGarbage), so its reason can say 'idle'. A runtime without a platform (unit tests of the pacing) never defers.
 */
function deferred(runtime) {
  const motion = runtime.platform?.mainThreadMotion?.() ?? null;
  const state = runtime.gcDeferral;
  if (motion === null) return false;
  const now = performance.now();
  if (!state) {
    const limit = runtime.headroomBase || runtime.maxHeapObjects, size = runtime.heap.size, margin = runtime.gcDeferMargin ?? GC_DEFER_MARGIN;
    const room = Math.max(0, Math.floor(Math.min(limit * margin, (limit * NEAR_LIMIT - size) / 2)));   // never past half the room left below NEAR_LIMIT
    runtime.gcDeferral = { since: now, heap: size, allocatedAt: runtime.nextId, ceiling: size + room, until: now + (runtime.gcDeferMaxMs ?? GC_DEFER_MAX_MS), held: 1, reasons: { [motion]: 1 }, forcedBy: null };
    return true;
  }
  state.held++; state.reasons[motion] = (state.reasons[motion] ?? 0) + 1;
  if (runtime.heap.size >= state.ceiling) { state.forcedBy = 'heap'; return false; }
  if (now >= state.until) { state.forcedBy = 'time'; return false; }
  return true;
}
/** Closes the deferral episode (if any) for the collection that is running now: the outcome for its reason and gcStats.recent entry, and the running totals (gcStats.deferrals). */
function closeDeferral(runtime, reason, motion, now) {
  const state = runtime.gcDeferral; if (!state) return { reason, deferral: undefined };
  runtime.gcDeferral = null;
  const paced = reason === 'threshold' || reason === 'safepoint';
  if (paced && motion !== null && state.forcedBy === null) state.forcedBy = runtime.heap.size >= (runtime.headroomBase || runtime.maxHeapObjects) * NEAR_LIMIT ? 'near-limit' : runtime.gcCellPressure ? 'cell-pressure' : runtime.gcPressure ? 'pressure' : 'unknown';   // a safety rule ran it, not the ceiling
  const outcome = paced ? (motion === null ? 'idle' : 'forced') : reason;
  const deferral = { ms: Math.round(now - state.since), allocated: runtime.nextId - state.allocatedAt, grown: runtime.heap.size - state.heap, held: state.held, reasons: state.reasons, forcedBy: outcome === 'forced' ? state.forcedBy : null };
  const totals = runtime.gcDeferralStats ??= { episodes: 0, idle: 0, forced: 0, forcedBy: {}, absorbed: 0, maxMs: 0, totalMs: 0, maxAllocated: 0 };
  totals.episodes++; totals.totalMs += deferral.ms; totals.maxMs = Math.max(totals.maxMs, deferral.ms); totals.maxAllocated = Math.max(totals.maxAllocated, deferral.allocated);
  if (outcome === 'idle') totals.idle++; else if (outcome === 'forced') { totals.forced++; totals.forcedBy[deferral.forcedBy] = (totals.forcedBy[deferral.forcedBy] ?? 0) + 1; } else totals.absorbed++;   // an emergency, audit, stress or manual collection ran while a deferral was pending
  return { reason: outcome, deferral };
}

/** Collects when the live heap passed `threshold` (default 40% of the limit) or in audit mode (every call). */
export function maybeCollect(runtime, options = {}) {
  if (runtime.engine === 'wasm') return { collected: false, reason: 'core-paced', before: 0, after: 0, freed: 0, ms: 0 };   // the core paces its own collections by allocated bytes (vmcore/gc.c)
  const audit = options.audit ?? globalThis.process?.env?.APKWEB_GC_AUDIT === '1';
  // Between host events nothing host-side is in flight, so the host-allocation set (what host code allocated or was handed since the last quiescent point) stops being a root here even when no
  // collection is due -- a quiescent collection drops it the same way. The safepoint collections inside the next event must keep the set alive; left to grow across events (a driver reading the
  // semantics tree between steps hands thousands of entries to host code), they would retain an ever larger part of the heap and free almost nothing, while the quiescent collection that would
  // have dropped the set never comes due because the safepoint ones ran first.
  if (quiescent(runtime) === null) { if (runtime.hostAllocs && runtime.hostAllocs.length > 0) runtime.hostAllocs.length = 0; settleTouches(runtime); }
  if (!audit && !runtime.gcEnabled) return { collected: false, reason: 'disabled', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };   // opt-in until the audit suites are clean
  const threshold = options.threshold ?? Math.floor(runtime.maxHeapObjects * GC_START_FRACTION);
  // Audit mode collects after every event that allocated at least APKWEB_GC_AUDIT_MIN (default 200) objects: a collection scans the whole live graph (~100 ms), and an event that allocates fewer
  // objects cannot have dropped a root; skipping them keeps full-suite audits to minutes instead of hours.
  if (audit && runtime.nextId - Math.max(runtime.gcLastNextId ?? 0, runtime.gcOldBound ?? 0) < Number(globalThis.process?.env?.APKWEB_GC_AUDIT_MIN ?? 200)) return { collected: false, reason: 'audit-small-event', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };
  if (!audit && !runtime.gcPressure && runtime.gcLastNextId === runtime.nextId) return { collected: false, reason: 'nothing-allocated', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };   // no allocation since the last collection: nothing new can be garbage
  // Hysteresis: after a collection the next one waits until the heap grew by 25% of the limit (a heap that is legitimately large must not be re-scanned on every event).
  const generation = audit ? auditGeneration(runtime) : collectionKind(runtime, threshold);
  if (!generation) return { collected: false, reason: runtime.gcDeferral ? 'deferred-in-motion' : 'below-threshold', before: runtime.heap.size, after: runtime.heap.size, freed: 0, ms: 0 };   // a held collection says so (see collectionDue / deferred)
  return collectGarbage(runtime, { ...options, audit, reason: audit ? 'audit' : 'threshold', generation });
}

// ---- Heap census: what was alive when the VM ran out of objects --------------------------------------------------------------------------------------------------------------------
/** Rough host-memory cost of one heap record (JavaScript object + its field Map / element array / collection storage). Calibrated against measured heap growth (docs/MEMORY.md). */
export function estimateRecordBytes(record) {
  let bytes = record.slots !== undefined ? 120 + record.slots.length * 8 + (record.fieldExtra?.size ?? 0) * 56 : 150 + (record.fields?.size ?? 0) * 56;   // a shaped record: the object, its slot array, the extra Map's entries
  if (record.cells !== undefined) bytes += 16 + cellBytes(record.cells);   // exact for a primitive array's typed storage
  bytes += ((record.list?.length ?? 0) + (record.set?.length ?? 0)) * 24 + (record.map?.size ?? 0) * 72;
  if (typeof record.text === 'string') bytes += record.text.length * 2;
  return bytes;
}
const typeLabel = type => String(type ?? '?').replace(/^L|;$/g, '').replaceAll('/', '.');

const BIG_ARRAY_CELLS = 1000000, ARRAY_CANDIDATES = 40;
/** The largest arrays of the heap (live or not yet collected), by cells: the candidates the census classifies. Cheap: one pass over the records, a bounded sorted list. */
function candidateArrays(heap) {
  const best = [];
  for (const ci of heap.usedChunks()) for (let slot = 0; slot < 4096; slot++) {
    const record = heap.chunks[ci][slot]; if (record === undefined || record.freed === true || record.cells === undefined) continue;
    const length = record.cells.length; if (length < 1000) continue;
    const cells = cellsOf(record.type, length);
    if (best.length >= ARRAY_CANDIDATES && cells <= best[best.length - 1].cells) continue;
    best.push({ id: (ci << 12) + slot, type: record.type, length, cells, root: undefined }); best.sort((a, b) => b.cells - a.cells); if (best.length > ARRAY_CANDIDATES) best.pop();
  }
  return best;
}
/** Which arrays hold the array-cell budget: the 10 largest live arrays (element type, length, cells, first root group that reaches each), the cells held by live and by unreachable-not-yet-collected arrays over 1 M cells. */
function arrayCensus(runtime, heap, markedHas, candidates) {
  let liveCells = 0, garbageCells = 0, liveBig = 0, liveBigCells = 0, garbageBig = 0, garbageBigCells = 0;
  for (const ci of heap.usedChunks()) for (let slot = 0; slot < 4096; slot++) {
    const record = heap.chunks[ci][slot], id = (ci << 12) + slot; if (record === undefined || id === 0 || record.freed === true || record.cells === undefined) continue;
    const cells = cellsOf(record.type, record.cells.length), live = markedHas(id);
    if (live) { liveCells += cells; if (cells > BIG_ARRAY_CELLS) { liveBig++; liveBigCells += cells; } } else { garbageCells += cells; if (cells > BIG_ARRAY_CELLS) { garbageBig++; garbageBigCells += cells; } }
  }
  const row = c => ({ type: typeLabel(c.type), length: c.length, cells: c.cells, root: c.root ?? null });
  const liveTop = candidates.filter(c => c.root !== undefined).slice(0, 10).map(row), garbageTop = candidates.filter(c => c.root === undefined).slice(0, 5).map(c => ({ ...row(c), root: null }));
  const summary = { cellsInUse: runtime.arrayCells ?? 0, maxCells: runtime.maxArrayCells ?? 0, liveCells, garbageCells, liveOver1M: { arrays: liveBig, cells: liveBigCells }, garbageOver1M: { arrays: garbageBig, cells: garbageBigCells }, liveTop, garbageTop };
  const fmt = c => `${c.type} length ${c.length} elements (${c.cells} weighted cells) via ${c.root ?? 'nenhuma raiz (inalcançável)'}`;
  const lines = [`Células de array (ponderadas pela largura do elemento: byte 1/8, char 1/4, int 1/2, long e referência 1): ${summary.cellsInUse} contadas de ${summary.maxCells}; vivas ${liveCells}, inalcançáveis ainda não coletadas ${garbageCells}; arrays acima de 1 M de células: ${liveBig} vivos com ${liveBigCells} células, ${garbageBig} inalcançáveis com ${garbageBigCells}.`];
  if (liveTop.length) lines.push('Maiores arrays vivos (por células; primeira raiz que alcança):', ...liveTop.map(c => `  ${fmt(c)}`));
  if (garbageTop.length) lines.push('Maiores arrays inalcançáveis ainda não coletados:', ...garbageTop.map(c => `  ${fmt(c)}`));
  return { summary, lines };
}
const familyOf = key => { const text = String(key), owner = text.slice(1, text.indexOf('->')), parts = owner.split('/'); return parts.length > 3 ? parts.slice(0, 3).join('.') : parts.join('.').replace(/;$/, ''); };

const fieldLabel = key => { const text = String(key), at = text.indexOf('->'), colon = text.indexOf(':', at); return at < 0 ? { owner: text, field: '' } : { owner: typeLabel(text.slice(0, at)), field: text.slice(at + 2, colon > 0 ? colon : undefined) }; };
/**
 * Which static fields keep the heap alive. Static fields are the first root group of a collection (category 1 of the report's "quem mantém vivo"); this splits that group by field: the fields that hold
 * an object are ordered by how much they reach on their own (smallest first, measured with caps of 48, 2048 and 131072 objects so that the many tiny fields cost almost nothing) and marked in that
 * order, so that every object is attributed to the smallest field that reaches it and structure shared with a big singleton does not turn that singleton into the culprit. Read-only, bounded by `budgetMs`
 * for the reach estimate (fields not measured in time count as "at least the last cap"). Returns { total, bytes, fields: [{ owner, field, objects, bytes, classes }], classes: [{ type, n, bytes }], ms, truncated }:
 * the TOP `topFields` fields by retained objects with their three most numerous classes, and the TOP `topClasses` classes among everything the static fields retain. Computed on OutOfMemoryError and by heapCensus.
 */
export function staticRetention(runtime, { topFields = 12, topClasses = 12, budgetMs = 1500, reachCaps = [48, 2048, 131072] } = {}) {
  const started = performance.now(), heap = runtime.heap, entries = [];
  for (const [key, value] of runtime.staticFields ?? []) if (value !== null && typeof value === 'object') entries.push({ key, value, reach: 0 });
  let truncated = false;
  if (entries.length > 1) {
    const probe = createMarker(runtime, { epoch: true });
    let pending = entries, measured = 0;
    tiers: for (const cap of reachCaps) {
      const next = [];
      for (const entry of pending) {
        if ((++measured & 63) === 0 && performance.now() - started > budgetMs) { truncated = true; for (const rest of pending) if (rest.reach < cap) rest.reach = cap; break tiers; }
        probe.reset(); probe.scan(entry.value); probe.drain(cap); entry.reach = probe.count();
        if (entry.reach >= cap) next.push(entry);
      }
      pending = next; if (!pending.length) break;
    }
    entries.sort((a, b) => a.reach - b.reach);
  }
  const own = createMarker(runtime, { privateMarks: true, order: true }), rows = [];
  for (const entry of entries) {
    const before = own.count(), from = own.order.length;
    own.scan(entry.value); own.drain();
    const gained = own.count() - before; if (gained > 0) rows.push({ key: entry.key, objects: gained, from, to: own.order.length });
  }
  const classCounts = new Map(); let bytes = 0;
  const countRange = (from, to, into) => { for (let i = from; i < to; i++) { const record = heap.get(own.order[i]); if (record === undefined) continue; const b = estimateRecordBytes(record), entry = into.get(record.type) ?? into.set(record.type, { n: 0, bytes: 0 }).get(record.type); entry.n++; entry.bytes += b; } };
  countRange(0, own.order.length, classCounts); for (const entry of classCounts.values()) bytes += entry.bytes;
  const top = rows.sort((a, b) => b.objects - a.objects).slice(0, topFields).map(row => {
    const classes = new Map(); countRange(row.from, row.to, classes);
    let rowBytes = 0; for (const entry of classes.values()) rowBytes += entry.bytes;
    return { ...fieldLabel(row.key), objects: row.objects, bytes: rowBytes, classes: [...classes].sort((a, b) => b[1].n - a[1].n).slice(0, 3).map(([type, v]) => ({ type: typeLabel(type), n: v.n })) };
  });
  const classes = [...classCounts].sort((a, b) => b[1].n - a[1].n).slice(0, topClasses).map(([type, v]) => ({ type: typeLabel(type), n: v.n, bytes: v.bytes }));
  return { total: own.order.length, bytes, staticFields: entries.length, fields: top, classes, ms: Math.round(performance.now() - started), truncated };
}
/** The report lines of a staticRetention result (Portuguese, like the rest of the report): fields first, then classes. */
export function staticRetentionLines(retention, { indent = '' } = {}) {
  if (!retention?.fields?.length) return [];
  const mib = bytes => (bytes / 1048576).toFixed(1), kib = bytes => bytes >= 1048576 ? `${mib(bytes)} MiB` : `${Math.round(bytes / 1024)} KiB`;
  return [`${indent}retidos por campo estático (${retention.total} objetos, ~${kib(retention.bytes)}, ${retention.staticFields} campos com objeto${retention.truncated ? '; alcance medido parcialmente' : ''}):`,
    ...retention.fields.map(f => `${indent}  ${f.objects} objetos (~${kib(f.bytes)}) via ${f.owner}${f.field ? '.' + f.field : ''}: ${f.classes.map(c => `${c.n} ${c.type}`).join(', ')}`),
    `${indent}classes mais numerosas entre os retidos por campos estáticos: ${retention.classes.map(c => `${c.n} ${c.type}`).join(', ')}`];
}

/**
 * Read-only mark of the whole VM that attributes every live object to the first root group that reaches it, plus a class census and the allocation sites sampled since the last
 * collection. Nothing is freed. Returns { live, garbage, estimatedBytes, topClasses, roots, garbageClasses, allocationSites, gc, text }; `text` is the section of the diagnostic report.
 */
export function heapCensus(runtime, { topClasses = 20, topRoots = 10 } = {}) {
  const heap = runtime.heap, marker = createMarker(runtime, { privateMarks: true }), { markedHas, scan, drain, markId, idLike } = marker, groups = [], REACH_CAP = 25000;   // private marks: the per-group markers below zero the shared ones
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
  const bigArrays = candidateArrays(heap); const attribute = name => { for (const c of bigArrays) if (c.root === undefined && markedHas(c.id)) c.root = name; };
  attribute('ids de objetos do runtime/plataforma');
  // Pass 2: exclusive attribution, smallest reach first.
  for (const def of [...defs].sort((x, y) => x.reach - y.reach)) { const before = marker.count(); def.visit(scan); drain(); attribute(def.name); const gained = marker.count() - before; if (gained > 0) groups.push({ name: def.name, objects: gained, reachAlone: def.reach >= REACH_CAP ? `${REACH_CAP}+` : def.reach }); }
  drain(); marker.ephemerons();
  drain(); attribute('(demais raízes)');
  const arrays = arrayCensus(runtime, heap, markedHas, bigArrays);
  const counts = new Map(), garbageCounts = new Map(); let live = 0, garbage = 0, estimatedBytes = 0, arrayBytes = 0;
  for (const ci of heap.usedChunks()) for (let slot = 0; slot < 4096; slot++) {
    const record = heap.chunks[ci][slot]; const id = (ci << 12) + slot; if (record === undefined || id === 0 || record.freed === true) continue;
    if (markedHas(id)) { live++; const entry = counts.get(record.type) ?? counts.set(record.type, { count: 0, bytes: 0 }).get(record.type), bytes = estimateRecordBytes(record); entry.count++; entry.bytes += bytes; estimatedBytes += bytes; if (record.cells !== undefined) arrayBytes += cellBytes(record.cells); }
    else { garbage++; garbageCounts.set(record.type, (garbageCounts.get(record.type) ?? 0) + 1); }
  }
  const classes = [...counts].map(([type, { count, bytes }]) => ({ type, count, bytes })).sort((a, b) => b.count - a.count).slice(0, topClasses);
  const roots = groups.sort((a, b) => b.objects - a.objects).slice(0, topRoots);
  const garbageClasses = [...garbageCounts].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  const allocationSites = [...(runtime.allocationSamples ?? [])].map(([site, samples]) => ({ site, samples })).sort((a, b) => b.samples - a.samples).slice(0, 8);
  const gc = { enabled: !!runtime.gcEnabled, ...(runtime.gcStats ?? {}), skips: { ...(runtime.gcSkips ?? {}) } };
  let retention = null; try { retention = staticRetention(runtime); } catch (error) { retention = { error: String(error?.message ?? error), fields: [], classes: [] }; }
  runtime.gcStaticRetention = retention;   // the report prints it (report-summary.js)
  const mib = bytes => (bytes / 1048576).toFixed(1);
  const lines = [`Censo do heap da VM: ${live} objetos vivos (~${mib(estimatedBytes)} MiB estimados) de um limite de ${runtime.maxHeapObjects}; ${garbage} inalcançáveis ainda não coletados; ${runtime.fieldSlots ?? 0} campos, ${runtime.arrayCells ?? 0} células de array ponderadas (${mib(arrayBytes)} MiB de armazenamento exato: tipado para arrays primitivos), ${runtime.collectionCells ?? 0} células de coleção.`,
    `Coletor: ${gc.enabled ? 'ligado' : 'DESLIGADO'}; ${gc.collections ?? 0} coletas, ${gc.freed ?? 0} liberados no total, última coleta (${gc.lastReason ?? 'nenhuma'}) deixou ${gc.lastLive ?? '?'} vivos${Object.keys(gc.skips).length ? `; coletas recusadas: ${Object.entries(gc.skips).map(([why, n]) => `${why} x${n}`).join(', ')}` : ''}.`,
    'Classes com mais objetos vivos:', ...classes.map(c => `  ${c.count} x ${typeLabel(c.type)} (~${mib(c.bytes)} MiB)`),
    'Raízes que mantêm os objetos vivos (objetos exclusivos de cada grupo, do menor alcance ao maior):', ...roots.map(g => `  ${g.objects} objetos via ${g.name} (sozinha alcança ${g.reachAlone})`)];
  lines.push(...arrays.lines);
  lines.push(...staticRetentionLines(retention));
  if (gc.softCleared || runtime.gcSoftLast) lines.push(`Referências suaves: ${gc.softCleared ?? 0} limpas em ${gc.softCollections ?? 0} coletas sob pressão${runtime.gcSoftLast ? `; a última (política ${runtime.gcSoftLast.policy}) limpou ${runtime.gcSoftLast.cleared} de ${runtime.gcSoftLast.softReferences} e liberou ${runtime.gcSoftLast.freed} objetos` : ''}.`);
  if (garbageClasses.length) lines.push('Inalcançáveis ainda não coletados:', ...garbageClasses.map(c => `  ${c.count} x ${typeLabel(c.type)}`));
  if (allocationSites.length) lines.push('Métodos que mais alocaram desde a última coleta (amostra):', ...allocationSites.map(s => `  ${s.samples} amostras em ${s.site}`));
  return { live, garbage, estimatedBytes, arrays: arrays.summary, limit: runtime.maxHeapObjects, topClasses: classes, roots, staticRetention: retention, garbageClasses, allocationSites, gc, trackedContainers: trackedCount, text: lines.join('\n') };
}

/** Which of the last collections freed object `id`: { collection, type } or null (binary search in the sorted ring). */
export function freedBy(runtime, id) {
  for (const entry of runtime.gcFreedRing ?? []) {
    let low = 0, high = entry.ids.length - 1;
    while (low <= high) { const mid = (low + high) >> 1, value = entry.ids[mid]; if (value === id) return { collection: entry.collection, type: entry.kinds[entry.types[mid]], ...(entry.minor !== undefined ? { minor: entry.minor } : {}) }; if (value < id) low = mid + 1; else high = mid - 1; }
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
        if (key === 'slots') { const keys = record.fieldShape.keys; for (let i = 0; i < item.length; i++) if (item[i] !== undefined) edge(node, item[i], fieldName(keys[i])); continue; }
        if (key === 'fieldShape') continue;
        if (key === 'fieldExtra' && item instanceof Map) { for (const [k, v] of item) edge(node, v, fieldName(k)); continue; }
        if (key === 'cells') { if (Array.isArray(item) && refArrayType(record.type)) for (let i = 0; i < item.length; i++) edge(node, item[i], `[${i}]`); continue; }
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
function auditAgainstFullWalk(runtime, { markedHas, extraRoots, clearSoft = false, minor = false }) {
  const full = createMarker(runtime, { full: true, clearSoft }), { scan, drain, ephemerons, markId } = full;
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
      if (!(node instanceof Map) && !(node instanceof Set) && !Array.isArray(node) && Object.keys(node).some(key => node[key] === target && typeof node[key] === 'number')) { found = node; break; }   // an id-named number field
      if (node instanceof Map) { for (const [k, v] of node) { push(v, node, `[${String(k).slice(0, 40)}]`); push(k, node, 'key'); } }
      else if (node instanceof Set || Array.isArray(node)) { let i = 0; for (const v of node) push(v, node, `[${i++}]`); }
      else for (const key of Object.keys(node)) push(node[key], node, key);
    }
    let path = ''; for (let at = found, guard = 0; at && parent.get(at) && guard < 400; guard++) { const [from, label] = parent.get(at); path = label + (path ? ' → ' + path : ''); at = from; }
    throw new Error(`GC audit: ${minor ? 'a minor collection (old ids live, remembered set and host-stateful records rescanned)' : 'the pruned root scan'} lost ${missed.length} object(s) a full conservative walk reaches: #${missed.slice(0, 12).join(', #')}; first reached through ${path || '?'}; ${missed.length ? `ids ${missed.slice(0, 12).map(m => { const id = Number(m.split(' ')[0]); return `${id}${id >= full.limit ? '>' : '<'}limit ${full.limit}`; }).join(' ')}` : ''}`);
  }
  if (missed.length) throw new Error(`GC audit: the pruned root scan lost ${missed.length} object(s) a full conservative walk reaches: #${missed.slice(0, 12).join(', #')}`);
}

/** The ring of host allocations of finished calls: the most recent maxHeapObjects/32 (at most 8192) of them are roots. */
function graceRoots(runtime, markId) {
  const ring = runtime.hostGrace; if (!ring) return;
  const count = Math.min(8192, runtime.maxHeapObjects >> 5, runtime.hostGraceAt);
  for (let i = 1; i <= count; i++) { const id = ring[(runtime.hostGraceAt - i) & 8191]; if (id > 0) markId(id); }
}
