// The runtime statistics of dalvik.system.VMDebug (android.os.Debug delegates to it) as ART 13 computes them (art/runtime/native/dalvik_system_VMDebug.cc, runtime/gc/heap.cc,
// runtime/runtime.cc and libartbase/base/histogram-inl.h, android-13.0.0_r1), over the lab's own collector counters: the JavaScript VM's (src/heap-gc.js gcStats) or the
// WebAssembly core's (vmcore/js/host-bridge.js heapCounters). Nothing here is estimated: a figure the lab does not keep is reported as absent (see heapCounters).
//
// Blocking collections: ART counts a collection as blocking when a mutator thread waited for it or ran it itself (Heap::WaitForGcToCompleteLocked), and not when the heap task
// daemon ran it concurrently while the app kept running. The lab has no concurrent collector: every collection stops the world on the thread that asked for it (an allocation, a
// safepoint, a host call), so every collection is a blocking one and the blocking count and time equal the totals.
// Time waiting for GC (art.gc.total-time-waiting-for-gc, nanoseconds): the time threads spent waiting for a collection that another thread was running; with no concurrent
// collector no thread ever waits for one, so it stays 0.

/** VMDebug.runtimeStatsMap (libcore android-13.0.0_r1): the stat names, by VMDebugRuntimeStatId. */
export const RUNTIME_STAT_NAMES = Object.freeze(['art.gc.gc-count', 'art.gc.gc-time', 'art.gc.bytes-allocated', 'art.gc.bytes-freed', 'art.gc.blocking-gc-count', 'art.gc.blocking-gc-time',
  'art.gc.gc-count-rate-histogram', 'art.gc.blocking-gc-count-rate-histogram', 'art.gc.objects-allocated', 'art.gc.total-time-waiting-for-gc', 'art.gc.pre-oome-gc-count']);
/** VMDebug_getRuntimeStatsInternal fills the first eight ids only: in Android 13 getRuntimeStats() maps the last three names to null (getRuntimeStat answers them). */
export const RUNTIME_STATS_IN_MAP = 8;

// Heap: kGcCountRateHistogramWindowDuration (10 s), kGcCountRateHistogramMaxNumMissedWindows, kGcCountRateMaxBucketCount; Histogram: kMinBuckets, initial bucket width 1.
const WINDOW_MS = 10000, MAX_MISSED_WINDOWS = 100, MAX_BUCKETS = 200, MIN_BUCKETS = 8;

/** art::Histogram<uint64_t>(name, 1, 200): a linear histogram that doubles its bucket width (merging pairs) when it would pass 200 buckets. */
class RateHistogram {
  constructor() { this.width = 1; this.frequency = new Array(MIN_BUCKETS).fill(0); this.max = this.width * MIN_BUCKETS; this.samples = 0; }
  add(value) {
    if (value >= this.max) this.grow((Math.floor((value + 1) / this.width) + 1) * this.width);
    this.samples++; this.frequency[Math.floor(value / this.width)]++;
  }
  grow(newMax) {
    while (this.max < newMax) {
      if (this.frequency.length === MAX_BUCKETS) {
        this.width *= 2; const limit = this.frequency.length / 2;
        for (let i = 0; i < limit; i++) this.frequency[i] = this.frequency[2 * i] + this.frequency[2 * i + 1];
        this.frequency.length = limit;
      }
      this.max += this.width; this.frequency.push(0);
    }
  }
  /** Heap::DumpGcCountRateHistogram: "" with no sample, else Histogram::DumpBins: "start:count" for every non-empty bucket, comma-separated. */
  dump() { return this.samples === 0 ? '' : this.frequency.flatMap((n, i) => n ? [`${i * this.width}:${n}`] : []).join(','); }
}

const states = new WeakMap();
const clockOf = runtime => runtime.clock ?? runtime.platform?.clock ?? null;
const nowMs = runtime => { const clock = clockOf(runtime); return clock ? (clock.peek ?? clock.now).call(clock) : performance.now(); };
function state(runtime) {
  let s = states.get(runtime);
  if (!s) {
    // last_update_time_gc_count_rate_histograms_ starts at the window the heap was created in: the first time the runtime's statistics are touched (its first collection or query)
    s = { gcRate: new RateHistogram(), blockingRate: new RateHistogram(), lastUpdate: Math.floor(nowMs(runtime) / WINDOW_MS) * WINDOW_MS, gcLastWindow: 0, blockingLastWindow: 0,
      maxBytesSoFar: 0, alloc: { enabled: false, base: null, acc: new Map() } };
    states.set(runtime, s);
  }
  return s;
}

/** Heap::FinishGC + UpdateGcCountRateHistograms for one finished collection (APKRuntime.nativeCollected calls it for both engines). Every lab collection is blocking (see the header). */
export function recordCollection(runtime) {
  const s = state(runtime), blocking = true;
  s.gcLastWindow++; if (blocking) s.blockingLastWindow++;
  const now = nowMs(runtime), since = now - s.lastUpdate;
  if (since >= WINDOW_MS) {
    const windows = Math.min(Math.floor(since / WINDOW_MS), MAX_MISSED_WINDOWS);
    s.gcRate.add(s.gcLastWindow - 1);   // the current run is excluded
    s.blockingRate.add(blocking ? s.blockingLastWindow - 1 : s.blockingLastWindow);
    for (let i = 0; i < windows - 1; i++) { s.gcRate.add(0); s.blockingRate.add(0); }
    s.lastUpdate = Math.floor(now / WINDOW_MS) * WINDOW_MS; s.gcLastWindow = 1; s.blockingLastWindow = blocking ? 1 : 0;
  }
}

/**
 * The lab's heap counters, per engine. null = the engine does not keep that figure:
 *  - the JavaScript VM counts records, not bytes (its heap is JavaScript objects), so the byte counters are absent there;
 *  - collections, their time, the records on the heap and the records freed are exact in both engines.
 * preOomeCollections: ART's last collection before an OutOfMemoryError, which also clears SoftReferences (Heap::AllocateInternalWithGc). The JavaScript VM has it (APKRuntime
 * emergencyCollect, gcEmergency.ran); the WebAssembly core's collector has no such collection (an allocation that still finds no room after an ordinary collection throws), so none
 * ever ran there: 0.
 */
export function heapCounters(runtime) {
  if (runtime.engine === 'wasm' && runtime.wasm) {
    const c = runtime.wasm.heapCounters(); c.preOomeCollections = 0; return c;   // objectsNow is computed when read (a walk of the core's start bitmap)
  }
  const g = runtime.gcStats ?? {};
  return { collections: g.collections ?? 0, gcMs: g.totalMs ?? 0, bytesFreed: null, bytesNow: null, objectsNow: Number(runtime.heap?.size ?? 0), objectsFreed: g.freed ?? 0, preOomeCollections: runtime.gcEmergency?.ran ?? 0 };
}

/** Heap::GetBytesAllocatedEver: freed ever + allocated now, never smaller than an earlier answer (ART keeps max_bytes_so_far). */
function bytesAllocatedEver(runtime, counters) {
  if (counters.bytesFreed === null) return null;
  const s = state(runtime); s.maxBytesSoFar = Math.max(s.maxBytesSoFar, counters.bytesFreed + counters.bytesNow); return s.maxBytesSoFar;
}
const decimal = value => value === null ? null : String(Math.floor(value));

/** VMDebug_getRuntimeStatInternal(id): the stat's value as a string (std::to_string; times are NsToMs), or null for an id out of range or a figure the engine does not keep. */
export function runtimeStat(runtime, id) {
  const c = heapCounters(runtime), s = state(runtime);
  switch (id) {
    case 0: return decimal(c.collections);   // Heap::GetGcCount
    case 1: return decimal(c.gcMs);          // NsToMs(Heap::GetGcTime())
    case 2: return decimal(bytesAllocatedEver(runtime, c));
    case 3: return decimal(c.bytesFreed);    // Heap::GetBytesFreedEver
    case 4: return decimal(c.collections);   // blocking: every collection (see the header)
    case 5: return decimal(c.gcMs);
    case 6: return s.gcRate.dump();
    case 7: return s.blockingRate.dump();
    case 8: return decimal(c.objectsNow);    // Heap::GetObjectsAllocated: the objects on the heap now (live and not yet collected)
    case 9: return '0';                      // Heap::GetTotalTimeWaitingForGC (ns): no thread waits for another's collection (see the header)
    case 10: return decimal(c.preOomeCollections);
    default: return null;
  }
}
/** VMDebug_getRuntimeStatsInternal: a String[11] with ids 0-7 filled and 8-10 null, as Android 13 builds it. */
export const runtimeStatsArray = runtime => RUNTIME_STAT_NAMES.map((_name, id) => id < RUNTIME_STATS_IN_MAP ? runtimeStat(runtime, id) : null);

// ---- allocation counting (VMDebug.startAllocCounting / getAllocCount / resetAllocCount; ART Runtime::SetStatsEnabled, GetStat, ResetStats, RuntimeStats) ----
// ART adds to RuntimeStats while counting is on (allocations in the allocation entry points, frees in Heap::RecordFree, collections for allocation in CollectGarbageInternal);
// here each global kind is the change of the matching lab counter while counting was on. The per-thread kinds (KIND_THREAD_*) and the class-initialization kinds have no lab
// counter and fail by name; the EXT kinds are 0 in ART itself ("backward compatibility").
export const ALLOC_KIND = Object.freeze({ ALLOCATED_OBJECTS: 1, ALLOCATED_BYTES: 2, FREED_OBJECTS: 4, FREED_BYTES: 8, GC_INVOCATIONS: 16, CLASS_INIT_COUNT: 32, CLASS_INIT_TIME: 64 });
const COUNTED_KINDS = [1, 2, 4, 8, 16], EXT_KINDS = new Set([1 << 12, 1 << 13, 1 << 14, 1 << 15]);
const KIND_NAMES = { 1: 'ALLOCATED_OBJECTS', 2: 'ALLOCATED_BYTES', 4: 'FREED_OBJECTS', 8: 'FREED_BYTES', 16: 'GC_INVOCATIONS', 32: 'CLASS_INIT_COUNT', 64: 'CLASS_INIT_TIME' };
function allocCounter(runtime, kind, c = heapCounters(runtime)) {
  switch (kind) {
    case 1: return c.objectsFreed + c.objectsNow;   // objects allocated ever: freed ever + on the heap now
    case 2: return bytesAllocatedEver(runtime, c);
    case 4: return c.objectsFreed;
    case 8: return c.bytesFreed;
    // gc_for_alloc_count: ART counts the collections caused by an allocation. Every lab collection is paced by allocation (the core's trigger, the JavaScript VM's safepoint and
    // emergency collections; System.gc() is only a hint that the next allocation-paced collection honours), so all of them count.
    case 16: return c.collections;
    default: return null;
  }
}
const snapshot = runtime => { const c = heapCounters(runtime); return new Map(COUNTED_KINDS.map(kind => [kind, allocCounter(runtime, kind, c)])); };

/** Runtime::SetStatsEnabled: turning counting on clears every count (even when it was already on). */
export function setAllocCounting(runtime, enabled) {
  const a = state(runtime).alloc;
  if (enabled) { a.acc = new Map(); a.base = snapshot(runtime); a.enabled = true; return; }
  if (a.enabled) { const now = snapshot(runtime); for (const kind of COUNTED_KINDS) a.acc.set(kind, add(a.acc.get(kind) ?? 0, delta(now.get(kind), a.base.get(kind)))); }
  a.enabled = false;
}
const delta = (now, base) => now === null || base === null ? null : now - base;
const add = (a, b) => a === null || b === null ? null : a + b;
/** Runtime::ResetStats(kinds): the global counts of the low 16 bits start again from zero; the per-thread ones (high bits) are not kept, so there is nothing to clear. */
export function resetAllocCount(runtime, kinds) {
  const a = state(runtime).alloc, now = a.enabled ? snapshot(runtime) : null;
  for (const kind of COUNTED_KINDS) if (kinds & kind) { a.acc.set(kind, 0); if (now) a.base.set(kind, now.get(kind)); }
}
/** VMDebug_getAllocCount(kind): static_cast<jint>(Runtime::GetStat(kind)). */
export function allocCount(runtime, kind, fail) {
  kind |= 0;
  const perThread = kind >= (1 << 16) || kind < 0, local = perThread ? kind >>> 16 : kind;   // Runtime::GetStat: kinds from bit 16 up are the current thread's
  if (EXT_KINDS.has(local)) return 0;
  if (perThread && KIND_NAMES[local]) return fail(`VMDebug.getAllocCount(KIND_THREAD_${KIND_NAMES[local]}): per-thread allocation counts are not kept by the lab's VM`);
  if (kind === 32 || kind === 64) return fail(`VMDebug.getAllocCount(KIND_GLOBAL_${KIND_NAMES[kind]}): class-initialization counts are not kept by the lab's VM`);
  if (!COUNTED_KINDS.includes(kind)) return fail(`VMDebug.getAllocCount(${kind}): unknown statistic (ART aborts on it: Runtime::GetStat)`);
  const a = state(runtime).alloc, stored = a.acc.get(kind) ?? 0, running = a.enabled ? delta(allocCounter(runtime, kind), a.base.get(kind)) : 0, value = add(stored, running);
  if (value === null) return fail(`VMDebug.getAllocCount(KIND_GLOBAL_${KIND_NAMES[kind]}): the ${runtime.engine === 'wasm' ? 'WebAssembly core' : 'JavaScript VM'} does not count heap bytes`);
  return Number(BigInt.asIntN(32, BigInt(Math.floor(value))));
}
