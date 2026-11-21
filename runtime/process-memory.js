// The app process's memory as the kernel's per-mapping accounting (smaps) describes it, from what the lab really holds, and the figures every reader derives from it:
// /proc/self/status (Vm* and Rss* lines), /proc/self/statm, /proc/self/smaps_rollup (src/procfs.js) and Debug.MemoryInfo (Debug.getMemoryInfo, ActivityManager.getProcessMemoryInfo,
// src/app-services-host.js). One list of mappings, so they all agree.
//
// The mappings:
//  - the ARM64 native process's, when there is one (src/arm64/procfs.js vmas): each library's PT_LOAD segments, the thread stacks, the malloc heap, ART's LinearAlloc and DEX
//    mappings, mmap regions, by the names /proc/self/maps shows;
//  - the VM's own, which have no ARM64 address: the Java heap ("[anon:dalvik-main space]", the bytes the collector counts: the WebAssembly core's heap bytes, or the JavaScript
//    VM's records at 64 bytes each) and the VM's native memory ("[anon:libc_malloc]": Unsafe / direct-buffer arena and the native bytes hosts register, src/vm-debug-host.js).
// Each page of a mapping the process can access counts as resident and private to the process (the lab backs the whole range, and no other process shares it), so Pss = Rss;
// an inaccessible reservation (---p) is not resident. Pages of a writable mapping are dirty, those of a read-only file mapping clean. Nothing is swapped. There is no memtrack
// HAL, so the graphics categories are 0, as on a device without one.
// The device's memory (ActivityManager.getMemoryInfo, /proc/meminfo, sysinfo) is DEVICE_MEMORY_BYTES, the RAM MemoryInfo.totalMem has always reported, and what this one app
// process does not hold of it (the device runs no other process, kernel, page cache or swap of its own). The process's CPU time (/proc/self/stat utime,
// Process.getElapsedCpuTime) is the Worker's busy time (the time breakdown without idle, src/time-breakdown.js), never more than the process's uptime.
import { nativeHeap } from './vm-debug-host.js?v=d6bc8426c03e';
import { BUCKET, BUCKET_COUNT } from './time-breakdown.js?v=d6bc8426c03e';

export const PAGE = 4096;
const kb = bytes => Math.floor(bytes / 1024);
const pages = bytes => Math.ceil(bytes / PAGE) * PAGE;

/** The Java heap in bytes, as the VM's collector counts it. */
export function javaHeapBytes(r) { return r.engine === 'wasm' && r.wasm ? r.wasm.heapCounters().bytesNow : (r.heap?.size ?? 0) * 64; }

/** The VM's own mappings (they have no ARM64 address). */
export function vmMappings(r) {
  const out = [], java = javaHeapBytes(r), native = nativeHeap(r).allocated;
  if (java > 0) out.push({ name: '[anon:dalvik-main space]', size: pages(java), perms: 'rw-p' });
  if (native > 0) out.push({ name: '[anon:libc_malloc]', size: pages(native), perms: 'rw-p' });
  return out;
}

// android_os_Debug.cpp (android-13.0.0_r1) heaps: the exclusive heaps, then the sub-heaps of dalvik and dalvik-other, ART and DEX
export const HEAP = { UNKNOWN: 0, DALVIK: 1, NATIVE: 2, DALVIK_OTHER: 3, STACK: 4, CURSOR: 5, ASHMEM: 6, GL_DEV: 7, UNKNOWN_DEV: 8, SO: 9, JAR: 10, APK: 11, TTF: 12, DEX: 13, OAT: 14, ART: 15,
  UNKNOWN_MAP: 16, GRAPHICS: 17, GL: 18, OTHER_MEMTRACK: 19, DALVIK_NORMAL: 20, DALVIK_LARGE: 21, DALVIK_ZYGOTE: 22, DALVIK_NON_MOVING: 23, DALVIK_OTHER_LINEARALLOC: 24,
  DALVIK_OTHER_ACCOUNTING: 25, DALVIK_OTHER_ZYGOTE_CODE_CACHE: 26, DALVIK_OTHER_APP_CODE_CACHE: 27, DALVIK_OTHER_COMPILER_METADATA: 28, DALVIK_OTHER_INDIRECT_REFERENCE_TABLE: 29,
  DEX_BOOT_VDEX: 30, DEX_APP_DEX: 31, DEX_APP_VDEX: 32, ART_APP: 33, ART_BOOT: 34 };
export const NUM_HEAP = 35, NUM_CORE_HEAP = 3, NUM_EXCLUSIVE_HEAP = 20;
const FIELDS = ['pss', 'swappablePss', 'rss', 'privateDirty', 'sharedDirty', 'privateClean', 'sharedClean', 'swappedOut', 'swappedOutPss'];

/** load_maps' classification of one mapping by its name: [heap, sub-heap or -1, swappable]. */
export function classify(name) {
  const is = prefix => name.startsWith(prefix), ends = suffix => name.endsWith(suffix);
  const boot = name.startsWith('/system') || name.startsWith('/apex');
  if (is('[heap]') || is('[anon:libc_malloc]') || is('[anon:scudo:') || is('[anon:GWP-ASan')) return [HEAP.NATIVE, -1, false];
  if (is('[anon:stack_and_tls:') || is('[stack')) return [HEAP.STACK, -1, false];
  if (ends('.so')) return [HEAP.SO, -1, true];
  if (ends('.jar')) return [HEAP.JAR, -1, true];
  if (ends('.apk')) return [HEAP.APK, -1, true];
  if (ends('.ttf')) return [HEAP.TTF, -1, true];
  if (ends('.odex') || (name.length > 4 && name.includes('.dex'))) return [HEAP.DEX, HEAP.DEX_APP_DEX, true];
  if (ends('.vdex')) return [HEAP.DEX, boot || name.includes('/boot') ? HEAP.DEX_BOOT_VDEX : HEAP.DEX_APP_VDEX, true];
  if (ends('.oat')) return [HEAP.OAT, -1, true];
  if (ends('.art') || ends('.art]')) return [HEAP.ART, boot || name.includes('/boot') ? HEAP.ART_BOOT : HEAP.ART_APP, true];
  if (is('/dev/')) {
    if (is('/dev/kgsl-3d0')) return [HEAP.GL_DEV, -1, false];
    if (is('/dev/ashmem/CursorWindow')) return [HEAP.CURSOR, -1, false];
    if (is('/dev/ashmem/jit-zygote-cache')) return [HEAP.DALVIK_OTHER, HEAP.DALVIK_OTHER_ZYGOTE_CODE_CACHE, false];
    if (is('/dev/ashmem')) return [HEAP.ASHMEM, -1, false];
    return [HEAP.UNKNOWN_DEV, -1, false];
  }
  if (is('/memfd:jit-cache')) return [HEAP.DALVIK_OTHER, HEAP.DALVIK_OTHER_APP_CODE_CACHE, false];
  if (is('/memfd:jit-zygote-cache')) return [HEAP.DALVIK_OTHER, HEAP.DALVIK_OTHER_ZYGOTE_CODE_CACHE, false];
  if (is('[anon:')) {
    if (!is('[anon:dalvik-')) return [HEAP.UNKNOWN, -1, false];
    if (is('[anon:dalvik-LinearAlloc')) return [HEAP.DALVIK_OTHER, HEAP.DALVIK_OTHER_LINEARALLOC, false];
    if (is('[anon:dalvik-alloc space') || is('[anon:dalvik-main space')) return [HEAP.DALVIK, HEAP.DALVIK_NORMAL, true];
    if (is('[anon:dalvik-large object space') || is('[anon:dalvik-free list large object space')) return [HEAP.DALVIK, HEAP.DALVIK_LARGE, true];
    if (is('[anon:dalvik-non moving space')) return [HEAP.DALVIK, HEAP.DALVIK_NON_MOVING, false];
    if (is('[anon:dalvik-zygote space')) return [HEAP.DALVIK, HEAP.DALVIK_ZYGOTE, true];
    if (is('[anon:dalvik-indirect ref')) return [HEAP.DALVIK_OTHER, HEAP.DALVIK_OTHER_INDIRECT_REFERENCE_TABLE, false];
    if (is('[anon:dalvik-jit-code-cache') || is('[anon:dalvik-data-code-cache')) return [HEAP.DALVIK_OTHER, HEAP.DALVIK_OTHER_APP_CODE_CACHE, false];
    if (is('[anon:dalvik-CompilerMetadata')) return [HEAP.DALVIK_OTHER, HEAP.DALVIK_OTHER_COMPILER_METADATA, false];
    return [HEAP.DALVIK_OTHER, HEAP.DALVIK_OTHER_ACCOUNTING, false];
  }
  return name ? [HEAP.UNKNOWN_MAP, -1, false] : [HEAP.UNKNOWN, -1, false];
}

/** One mapping's smaps figures in kB. */
export function vmaFigures({ size, perms, name }) {
  const resident = perms.startsWith('---') ? 0 : kb(size), file = name.startsWith('/'), dirty = perms[1] === 'w' || !file;
  return { size: kb(size), rss: resident, pss: resident, privateDirty: dirty ? resident : 0, privateClean: dirty ? 0 : resident, sharedDirty: 0, sharedClean: 0, anonymous: file ? 0 : resident, file, swap: 0 };
}

/** All the mappings: the native process's and the VM's. */
export function processMappings(r, native = null) { return [...(native?.() ?? []), ...(r ? vmMappings(r) : [])]; }

/** /proc/self/smaps_rollup totals and the status / statm figures, in kB. */
export function rollup(mappings) {
  const t = { size: 0, rss: 0, pss: 0, pssAnon: 0, pssFile: 0, privateDirty: 0, privateClean: 0, sharedDirty: 0, sharedClean: 0, anonymous: 0, rssFile: 0, data: 0, stack: 0, exe: 0, lib: 0 };
  for (const m of mappings) {
    const f = vmaFigures(m); t.size += f.size; t.rss += f.rss; t.pss += f.pss; t.privateDirty += f.privateDirty; t.privateClean += f.privateClean; t.anonymous += f.anonymous;
    if (f.file) { t.pssFile += f.pss; t.rssFile += f.rss; } else t.pssAnon += f.pss;
    if (m.name.startsWith('[anon:stack_and_tls:') || m.name.startsWith('[stack')) t.stack += f.size;
    else if (!f.file && m.perms[1] === 'w') t.data += f.size;   // VmData: private writable mappings that are not stacks
    if (f.file && m.perms[2] === 'x') { if (m.name.endsWith('.so')) t.lib += f.size; else t.exe += f.size; }
  }
  return t;
}

export function smapsRollupText(mappings, firstAddress = 0, lastAddress = 0) {
  const t = rollup(mappings), line = (name, value) => `${(name + ':').padEnd(16)}${String(value).padStart(8)} kB`;
  const head = `${firstAddress.toString(16).padStart(8, '0')}-${lastAddress.toString(16).padStart(8, '0')} ---p 00000000 00:00 0`.padEnd(73) + '[rollup]';
  return [head, line('Rss', t.rss), line('Pss', t.pss), line('Pss_Anon', t.pssAnon), line('Pss_File', t.pssFile), line('Pss_Shmem', 0), line('Shared_Clean', 0), line('Shared_Dirty', 0),
    line('Private_Clean', t.privateClean), line('Private_Dirty', t.privateDirty), line('Referenced', t.rss), line('Anonymous', t.anonymous), line('LazyFree', 0), line('AnonHugePages', 0),
    line('ShmemPmdMapped', 0), line('FilePmdMapped', 0), line('Shared_Hugetlb', 0), line('Private_Hugetlb', 0), line('Swap', 0), line('SwapPss', 0), line('Locked', 0), ''].join('\n');
}

/** The memory lines of /proc/<pid>/status (fs/proc/task_mmu.c task_mem), in kB; the peak figures are what the process holds now (the lab keeps no history). */
export function statusMemoryLines(mappings) {
  const t = rollup(mappings), line = (name, value) => `${name}:\t${String(value).padStart(8)} kB`;
  return [line('VmPeak', t.size), line('VmSize', t.size), line('VmLck', 0), line('VmPin', 0), line('VmHWM', t.rss), line('VmRSS', t.rss), line('RssAnon', t.anonymous), line('RssFile', t.rssFile),
    line('RssShmem', 0), line('VmData', t.data), line('VmStk', t.stack), line('VmExe', t.exe), line('VmLib', t.lib), line('VmPTE', Math.ceil(t.size / 512)), line('VmSwap', 0)];
}

/** /proc/<pid>/statm (fs/proc/array.c proc_pid_statm): size resident shared text lib data dt, in pages; shared = the file-backed resident pages, lib and dt are 0 on Linux 2.6+. */
export function statmText(mappings) {
  const t = rollup(mappings), p = value => Math.floor(value * 1024 / PAGE);
  return `${p(t.size)} ${p(t.rss)} ${p(t.rssFile)} ${p(t.exe)} 0 ${p(t.data + t.stack)} 0\n`;
}

/** The figures android_os_Debug.cpp's load_maps sums per heap, in kB: stats[NUM_HEAP] of { pss, swappablePss, rss, privateDirty, ... }, with the exclusive heaps beyond the
 *  core three added to HEAP_UNKNOWN (the "other" figures), as getDirtyPagesPid does. */
export function debugHeapStats(mappings) {
  const stats = Array.from({ length: NUM_HEAP }, () => Object.fromEntries(FIELDS.map(f => [f, 0])));
  const add = (heap, f, swappablePss) => { const s = stats[heap]; s.pss += f.pss; s.swappablePss += swappablePss; s.rss += f.rss; s.privateDirty += f.privateDirty; s.sharedDirty += f.sharedDirty; s.privateClean += f.privateClean; s.sharedClean += f.sharedClean; };
  for (const m of mappings) {
    const [heap, sub, swappable] = classify(m.name), f = vmaFigures(m);
    const swappablePss = swappable && f.pss > 0 ? f.privateClean : 0;   // sharing_proportion * shared_clean + private_clean, with nothing shared
    add(heap, f, swappablePss); if (sub >= 0) add(sub, f, swappablePss);
  }
  for (let i = NUM_CORE_HEAP; i < NUM_EXCLUSIVE_HEAP; i++) for (const name of FIELDS) stats[HEAP.UNKNOWN][name] += stats[i][name];
  return stats;
}
export const MEMORY_INFO_FIELDS = FIELDS;

// ---- the process's pages, the device's memory, the process's CPU time
export const PAGE_SIZE = PAGE;
export const DEVICE_MEMORY_BYTES = 4 * 1024 * 1024 * 1024;
export const LOW_MEMORY_THRESHOLD_BYTES = 200 * 1024 * 1024;   // ActivityManager.MemoryInfo.threshold
/** Every mapping of the runtime's process: through its /proc model when it has one (the native process's mappings with the VM's), else the VM's alone. */
export function runtimeMappings(runtime) {
  const procfs = runtime?.platform?.javaIo?.fs?.()?.procfs;
  if (!procfs?.memoryMappings) return processMappings(runtime);
  procfs.attachRuntime?.(runtime); return procfs.memoryMappings();
}
/** The process's memory in pages, statm's figures: { size, resident, shared, text, data }. */
export function processMemory(runtime, mappings = runtimeMappings(runtime)) {
  const [size, resident, shared, text, , data] = statmText(mappings).trim().split(' ').map(Number);
  return { size, resident, shared, text, data };
}
/** The device's memory in bytes: { total, available, threshold, low } (MemoryInfo totalMem / availMem / threshold / lowMemory, /proc/meminfo MemTotal / MemAvailable, sysinfo). */
export function deviceMemory(runtime) {
  const used = runtime ? processMemory(runtime).resident * PAGE : 0, available = Math.max(0, DEVICE_MEMORY_BYTES - used);
  return { total: DEVICE_MEMORY_BYTES, available, threshold: LOW_MEMORY_THRESHOLD_BYTES, low: available <= LOW_MEMORY_THRESHOLD_BYTES };
}
/** Milliseconds since the device booted (the VM clock: SystemClock.elapsedRealtime). */
export function bootUptimeMs(platform) { return platform?.clock ? Math.max(0, platform.clock.now()) : 0; }
/** Milliseconds the process has run since it started (the VM clock since Process.getStartElapsedRealtime). */
export function processUptimeMs(platform) { return Math.max(0, bootUptimeMs(platform) - (platform?.processStartMs ?? 0)); }
/** The process's CPU time in milliseconds: the Worker's busy time (the time breakdown without idle), at most the process's uptime (one processor's worth). */
export function processCpuMs(runtime) {
  const tb = runtime?.tb, uptime = processUptimeMs(runtime?.platform);
  if (!tb?.cumulative) return uptime;
  const ms = tb.cumulative(new Float64Array(BUCKET_COUNT)); let busy = 0;
  for (let b = 0; b < BUCKET_COUNT; b++) if (b !== BUCKET.IDLE) busy += ms[b];
  return Math.min(busy, uptime);
}
