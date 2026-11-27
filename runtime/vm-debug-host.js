import { APKError } from './apk-error.js?v=d20881b83aa7';
import { createHostRegistry } from './host-contract.js?v=d20881b83aa7';
import { RUNTIME_STAT_NAMES, allocCount, resetAllocCount, runtimeStat, runtimeStatsArray, setAllocCounting, ALLOC_KIND } from './runtime-stats.js?v=d20881b83aa7';

// android.os.Debug and the parts of dalvik.system.VMDebug it delegates to (frameworks/base core/java/android/os/Debug.java and libcore dalvik/system/VMDebug.java,
// android-13.0.0_r1). The runtime statistics, allocation counts and collector figures come from the lab's own collector (src/runtime-stats.js); the native heap is the VM's
// native memory (src/unsafe-native.js arena) plus the native bytes hosts register for Java objects (APKRuntime.registerNativeAllocation: bitmap pixels...). No debugger can
// attach to the VM (no JDWP), so it is never connected and debugging is not enabled. What the lab does not keep fails by name, never with a made-up number.
const DEBUG = 'Landroid/os/Debug;', VM_DEBUG = 'Ldalvik/system/VMDebug;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', MAP = 'Ljava/util/Map;', HASH_MAP = 'Ljava/util/HashMap;';
const KIND_ALL_COUNTS = -1, THREAD = 16;

/** The native heap as mallinfo() describes it (android_os_Debug.cpp: usmblks, uordblks, fordblks): what is allocated, the span the allocator holds, and what is free in it. */
export function nativeHeap(runtime) {
  const memory = runtime.nativeMemory, registered = Math.max(0, runtime.nativeBytes ?? 0);
  let arena = 0; if (memory) for (const size of memory.blocks.values()) arena += size;
  const span = memory?.top ?? 0;
  return { allocated: registered + arena, size: registered + span, free: span - arena };
}

export function createVmDebugHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  registry.type(DEBUG, OBJECT); registry.type(VM_DEBUG, OBJECT);
  const fail = message => { throw new APKError(message, { kind: 'unsupported-api' }); };
  const statics = (owner, name, signature, fn) => def(owner, name, signature, fn, { static: true });

  // ---- debugger: ART's VMDebug.isDebuggerConnected is false until a JDWP agent replaces it, isDebuggingEnabled is IsDebuggerConfigured, lastDebuggerActivity is -1 with none.
  for (const owner of [DEBUG, VM_DEBUG]) statics(owner, 'isDebuggerConnected', '()Z', () => 0);
  statics(VM_DEBUG, 'isDebuggingEnabled', '()Z', () => 0);
  statics(VM_DEBUG, 'lastDebuggerActivity', '()J', () => -1n);
  statics(DEBUG, 'waitingForDebugger', '()Z', () => 0);   // mWaiting: only set inside waitForDebugger's loop, which is never entered
  statics(DEBUG, 'waitForDebugger', '()V', () => {});     // Debug.waitForDebugger returns at once when !VMDebug.isDebuggingEnabled()

  // ---- thread CPU time: the VM has one clock and no per-thread CPU accounting; thread time is bounded by (and reported as) the uptime of the VM clock, as SystemClock.currentThreadTimeMillis.
  for (const owner of [DEBUG, VM_DEBUG]) statics(owner, 'threadCpuTimeNanos', '()J', () => BigInt(Math.floor(platform.clock.now() * 1e6)));

  // ---- native heap (Debug.getNativeHeapSize / getNativeHeapAllocatedSize / getNativeHeapFreeSize), in bytes
  statics(DEBUG, 'getNativeHeapSize', '()J', r => BigInt(nativeHeap(r).size));
  statics(DEBUG, 'getNativeHeapAllocatedSize', '()J', r => BigInt(nativeHeap(r).allocated));
  statics(DEBUG, 'getNativeHeapFreeSize', '()J', r => BigInt(nativeHeap(r).free));
  // Binder transaction counters of this process: no Binder driver, no transaction ever went through one.
  statics(DEBUG, 'getBinderSentTransactions', '()I', () => 0); statics(DEBUG, 'getBinderReceivedTransactions', '()I', () => 0);

  // ---- runtime statistics: VMDebug.getRuntimeStat / getRuntimeStats (Debug delegates to them)
  const statId = name => RUNTIME_STAT_NAMES.indexOf(name);
  const getRuntimeStat = (r, name) => {
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'statName == null');
    const id = statId(r.stringCharacters(name)); return id < 0 ? null : runtimeStat(r, id);
  };
  const getRuntimeStats = r => {   // a HashMap of every name in runtimeStatsMap to getRuntimeStatsInternal()[id]
    const values = runtimeStatsArray(r), map = r.allocate(HASH_MAP);
    r.dispatch({ owner: HASH_MAP, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [map], 'direct');
    RUNTIME_STAT_NAMES.forEach((name, id) => r.dispatch({ owner: HASH_MAP, name: 'put', parameters: [OBJECT, OBJECT], result: OBJECT, signature: `(${OBJECT}${OBJECT})${OBJECT}` }, [map, name, values[id]], 'virtual'));
    return map;
  };
  for (const owner of [DEBUG, VM_DEBUG]) {
    statics(owner, 'getRuntimeStat', `(${STRING})${STRING}`, (r, _m, [name]) => getRuntimeStat(r, name));
    statics(owner, 'getRuntimeStats', `()${MAP}`, r => getRuntimeStats(r));
  }
  statics(VM_DEBUG, 'getRuntimeStatInternal', `(I)${STRING}`, (r, _m, [id]) => runtimeStat(r, id));
  statics(VM_DEBUG, 'getRuntimeStatsInternal', `()[${STRING}`, r => { const values = runtimeStatsArray(r), array = r.newArray(`[${STRING}`, values.length); r.array(array).elements = values; return array; });

  // ---- allocation counting: VMDebug.startAllocCounting / stopAllocCounting / getAllocCount / resetAllocCount, and Debug's deprecated wrappers over them
  statics(VM_DEBUG, 'startAllocCounting', '()V', r => setAllocCounting(r, true));
  statics(VM_DEBUG, 'stopAllocCounting', '()V', r => setAllocCounting(r, false));
  statics(VM_DEBUG, 'getAllocCount', '(I)I', (r, _m, [kind]) => allocCount(r, kind, fail));
  statics(VM_DEBUG, 'resetAllocCount', '(I)V', (r, _m, [kinds]) => resetAllocCount(r, kinds));
  statics(DEBUG, 'startAllocCounting', '()V', r => setAllocCounting(r, true));
  statics(DEBUG, 'stopAllocCounting', '()V', r => setAllocCounting(r, false));
  const K = ALLOC_KIND;
  for (const [suffix, kind] of [['GlobalAllocCount', K.ALLOCATED_OBJECTS], ['GlobalAllocSize', K.ALLOCATED_BYTES], ['GlobalFreedCount', K.FREED_OBJECTS], ['GlobalFreedSize', K.FREED_BYTES],
    ['GlobalGcInvocationCount', K.GC_INVOCATIONS], ['GlobalClassInitCount', K.CLASS_INIT_COUNT], ['GlobalClassInitTime', K.CLASS_INIT_TIME],
    ['ThreadAllocCount', K.ALLOCATED_OBJECTS << THREAD], ['ThreadAllocSize', K.ALLOCATED_BYTES << THREAD], ['ThreadGcInvocationCount', K.GC_INVOCATIONS << THREAD]]) {
    statics(DEBUG, `get${suffix}`, '()I', r => allocCount(r, kind, fail));
    statics(DEBUG, `reset${suffix}`, '()V', r => resetAllocCount(r, kind));
  }
  statics(DEBUG, 'resetAllCounts', '()V', r => resetAllocCount(r, KIND_ALL_COUNTS));
  // the "external" allocation counts were removed with Honeycomb's allocation limits: Debug.java answers 0 and resets nothing
  for (const suffix of ['GlobalExternalAllocCount', 'GlobalExternalAllocSize', 'GlobalExternalFreedCount', 'GlobalExternalFreedSize', 'ThreadExternalAllocCount', 'ThreadExternalAllocSize']) {
    statics(DEBUG, `get${suffix}`, '()I', () => 0); statics(DEBUG, `reset${suffix}`, '()V', () => {});
  }

  return { ...registry, interfaces: registry.interfacesOf };
}
