// The host side of core.wasm (docs/WASM-CORE-PLANO.md, phase 3: decisions 1, 2, 3, 5 and 7): a real APKRuntime keeps its class model, bridges, native bindings, contract hosts and
// platform, while the Java heap, the frames and the interpreter are the core's. `attachWasmEngine(runtime, options)` turns a freshly loaded runtime (engine 'wasm', nothing run yet)
// into that: the runtime's entry points below are replaced on the instance, so the 134 host files keep calling runtime.object(ref), makeObject, dispatch... unchanged.
//
// ---- Values at the boundary (vmcore/js/record-facade.js has the full model). Inside the core a reference is an address; a host sees `{ ref: id }` (the handle table: an id per
// record that crossed, never reused), a JavaScript string for a String record (decision 4: copied, cached per record), numbers for int/float bits, BigInt for long/double bits.
// runtime.object(ref) answers the record facade: `type`, `fields` (the Map interface over the class layout in memory), `cells` (typed views or a reference array-like over the
// array's memory) and every property a host hangs on it, kept on the facade itself -- the record's JavaScript companion (cached per id, dropped when the record dies).
//
// ---- The call path (vmcore/host.h). invoke-* of a host method calls env.bridge(methodId, call, thread) = bridge() below: it decodes the argument words by the call site's own
// DEX method reference into the values the JavaScript interpreter would hold in its registers, and calls runtime.dispatch(reference, words, mode, callerOwner, true) -- the
// JavaScript interpreter's own slow path, so the oracle's routing (resolveInvoke: SHIM bridges, DIRECT_BRIDGES, nativeBindings, contract hosts, lab helpers, interface
// defaults, tolerant stubs) decides who serves the call. Its outcome:
//   a value             encoded by the reference's result type into Thread.result: OK.
//   a JavaException     the exception record's address into Thread.result: HOST_THROW, thrown by the invoke in the core (catchable there, the invoke counted once).
//   a PendingCall       a DEX body (a lab helper; a DEX method a host-dispatch record selected): HOST_FRAME with its Method, pushed as an ordinary frame with the invoke's own
//                       argument words (the JavaScript interpreter pushes a frame too). If dispatch changed the arguments, the body is a host step (below).
//   an Invoke           a host step that calls Java and continues (Thread.run of a target, Method.invoke, an executor's task), a Blocked (a wait), or a PendingCall with
//   a Blocked           arguments of its own: the run stops with HOST_BLOCKED, its frames kept, and the thread takes the step on its own record (vmcore/js/core-threads.js
//                       pump: the callee's frames above the stopped ones, its value or exception to then()/onError(), a wait parking the thread for the JavaScript VM's
//                       scheduler) until the step answers a value or an exception, which completes the invoke (resume_host). Nothing nests a run on the JavaScript stack, as
//                       in the JavaScript interpreter (its continuation frames): the thread can wait, yield and be resumed anywhere in the step, whatever the other threads do.
//   any other error     (an APKError: an unsupported API, a VM limit) the run stops with HOST_FAILED naming the method; the error is rethrown to whoever started the run, as the
//                       JavaScript VM lets it escape.
// Natives bound by the oracle's routing (bindNative; natives.js BRIDGE_NATIVES): when dispatch selects a bridge whose body has a C native with its semantics (the box natives
// over the payload a box record carries, AtomicInteger.get/compareAndSet, Object.getClass), the host record the call went through becomes that native, where no later call
// through the record can be routed elsewhere. A native that cannot answer from memory defers to this trampoline (natives.h NATIVE_DEFER). Those calls are no longer host calls:
// the time breakdown, the trace ring and the operation monitor do not see them, as they do not see the natives bound by key.
// A host that calls back into Java -- runtime.execute(method, code, args), which dispatch() calls for a DEX body -- runs the method in the core with run_nested: a base frame
// above the caller's frames on the same Java stack, the same Thread and counters; an exception that leaves it becomes a JavaException in the host (and, if the host lets it
// go, a HOST_THROW back into the core). The caller's Thread state (frame, pc, depth, stackTop, throwing, status, detail, result) is saved here and put back afterwards.
//
// ---- The collector (gc.h; decision 5). A collection runs (a) when a run stops with OUT_OF_MEMORY (the core's allocation found a collection due) -- also inside a nested run, with
// host calls in flight below it -- and (b) when a host allocation finds no room (or before every host allocation with `stressHost`): the core is then suspended inside env.bridge
// or env.resolve with its stack published, which is a safepoint (the collector never moves a record; no C code holds a heap address that is not also in a register).
// Roots: the thread's Java stack (the core scans it), the linker's metaspace ranges (reference statics, the intern table), and from JavaScript: (1) every id the runtime's own
// root walk finds (src/heap-gc.js scanHostRoots: static tables, the scheduler's threads and continuations, Handler queues, platform and host tables, gcRoot containers -- the
// JavaScript VM's roots, reused), (2) the pins: every record whose handle was produced while host code holds it in JavaScript locals the walk cannot see. A handle made while a
// bridge call is in flight is pinned until that call returns (the call's pins are dropped at its return: what the host kept by then is in a rooted table, a field of a live
// record, or its result, which the core holds); a handle made by top-level host code (tests, a host driving the runtime outside any run) stays pinned until unpinTopLevel().
// Companions are ephemerons: every record with an id is exported (gc_export); marking reports the exported records it reached, their companions (the facade's own
// properties and out-of-layout fields) are scanned with the same walker and what they hold is marked, to a fixed point; records that die are reported by the sweep and their
// id, handle, facade and cached string are dropped.
//
// ---- Redirected runtime entry points (instance properties over APKRuntime.prototype; everything else the hosts call is the prototype's and reaches these):
//   object, vmObject           a handle -> the record facade (null -> NullPointerException, a stale or unknown id -> APKError, as the JavaScript VM's vmObject)
//   heap                       { get(id), has(id), size } over the handle table (`size`: records with a live id)
//   nextId                     the handle table's next id (the collector's id-likeness limit; never assigned here)
//   makeObject, newArray       records allocated on the core's heap (a class laid out by the linker on first use), pinned; newArray copies `cells` when given
//   initialize                 class initialization in the core (a nested run that only runs the <clinit> chain); classes without DEX code need none
//   execute                    a DEX method from host code: a nested run in the core
//   readStatic, writeStatic    statics a DEX class declares live in the core's metaspace; host-modelled statics stay in runtime.staticFields (JavaScript)
//   captureStack               the core's frames (stack_walk) as the method objects the JavaScript VM records, for Throwable constructors and throwJava
// The prototype's allocate, typeOf, array, vmArray, elementsOf, arrayOf, bytesOf, storeField, throwJava, stringCharacters, javaString, javaHash, javaEquals, classObject,
// dispatch, bridge, argumentWords, hostArguments and every host reach the heap only through those.
//
//   classObject                the core's java.lang.Class object of a type (classes.h: the one const-class and Object.getClass give); its facade carries `classType`
//
// ---- Threads (vmcore/js/core-threads.js): every Java thread a core Thread record of its own, green, driven by the JavaScript VM's Scheduler; this.t is the current thread's.
// Not done here: real threads (Workers); JNI natives in the same memory; a stack trace of an exception created in a nested run stops at the nested run's base frame.

import { Linker, CLASS, METHOD, STATUS } from './linker.js?v=1ac1d0f0dc1e';
import { CORE_NATIVES, NATIVE_COUNT, BRIDGE_NATIVES, BOX_CLASSES, BOX_LETTERS } from './natives.js?v=1ac1d0f0dc1e';
import { RecordSpace, ObjectFacade, ArrayFacade } from './record-facade.js?v=1ac1d0f0dc1e';
import { HandleTable } from './handles.js?v=1ac1d0f0dc1e';
import { Exceptions } from './exceptions.js?v=1ac1d0f0dc1e';
import { coreImports } from './boundary-imports.js?v=1ac1d0f0dc1e';
import { installHostLinking, methodReference } from './host-linking.js?v=1ac1d0f0dc1e';
import { scanHostRoots } from '../../runtime/heap-gc.js?v=1ac1d0f0dc1e';
import { APKError, JavaException, LOOPER_PLUMBING } from '../../runtime/apk-runtime.js?v=1ac1d0f0dc1e';
import { BUCKET } from '../../runtime/time-breakdown.js?v=1ac1d0f0dc1e';
import { PendingCall, Invoke } from '../../runtime/interpreter.js?v=1ac1d0f0dc1e';
import { Blocked } from '../../runtime/scheduler.js?v=1ac1d0f0dc1e';
import { CoreThreads, CORE_STATUS } from './core-threads.js?v=1ac1d0f0dc1e';
import { coreLayout, CORE_MEMORY_DEFAULT } from '../../runtime/core-memory.js?v=1ac1d0f0dc1e';

const MiB = 1 << 20;
/** Memory map (bytes): low memory is the module's data; metaspace; the Thread records with their Java and native stacks; the collected heap. */
// THREADS: the main thread's record (its Java stack, and the one native stack of the module at the top of its span); GUESTS: the records of the other Java threads (a Java stack each).
// Sized for a large app (hundreds of thousands of methods, hundreds of threads), not for the lab's examples: the memory is address space until it is written, so a region nobody uses costs nothing.
// Metaspace 511 MiB (the tables of LINKER_LIMITS and every linked method's code and constants), the main thread's record, a record for each of the other threads the core has
// ids for (core-threads.js MAX_LIVE_THREADS: none is taken from metaspace, which an app with hundreds of live threads would exhaust a MiB at a time), then the collected heap.
// The sizes are the caller's (attachWasmEngine `memory`: { heapMiB, metaMiB, threads }, src/core-memory.js; the lab's Controles › Execução); LAYOUT is the map of the defaults.
export const LAYOUT = coreLayout(CORE_MEMORY_DEFAULT);
export const DEFAULT_PAGES = LAYOUT.pages;   // 2 GiB of memory (the most this module's memory may have): a collected heap of 512 MiB above LAYOUT.HEAP
export const LINKER_LIMITS = Object.freeze({ maxMethods: 1 << 21, maxClasses: 1 << 18, maxStrings: 1 << 20 });
export const THREAD = Object.freeze({ vm: 0, stackBase: 4, stackEnd: 8, status: 12, detail: 16, interrupt: 20, ringIndex: 24, steps: 32, maxSteps: 40, result: 48, calls: 56, peakDepth: 64,
  tlabTop: 68, tlabEnd: 72, stackTop: 2128, frame: 2132, pc: 2136, depth: 2140, throwing: 2144, maxDepth: 2148, args: 2304, javaStack: 4096, javaStackBytes: 2 * MiB });
const GC = Object.freeze({ base: 4, end: 8, startBits: 12, threadCap: 44, rootCap: 56, roots: 52, rootCount: 60, reports: 76, reportCap: 80, reportCount: 84, reportOverflow: 88, freed: 92, freedCap: 96, freedCount: 100,
  trigger: 116, collectRequested: 120, collections: 124, liveObjects: 128, liveBytes: 132, freedObjects: 136, marked: 152, badRefs: 168, stress: 436, threadsState: 440, slowPaths: 444, SIZE: 448 });
const HOST_CALL = Object.freeze({ op: 0, caller: 4, constant: 8, count: 12, args: 16 });
export const Status = Object.freeze({ OK: 0, BUDGET: 1, OUT_OF_MEMORY: 5, UNSUPPORTED: 6, UNRESOLVED: 34, UNBOUND_NATIVE: 35, UNCAUGHT: 48, HOST_STOPPED: 64, HOST_FAILED: 65, HOST_BLOCKED: 66, THREAD_BLOCKED: 80, YIELDED: 81,
  HOST_THROW: 0x7fff0110, HOST_FRAME: 0x7fff0111 });
export const STATUS_NAMES = Object.freeze({ ...STATUS, 64: 'host step not supported', 65: 'host failed', 66: 'host wait', 80: 'thread blocked', 81: 'yielded' });
const METHOD_KIND_UNBOUND = 0x7fff0003;
const TIME_SAMPLE = 16;   // one bridged call in 16 per bridge reads the clock (bridgeBody)
const wordCount = parameters => parameters.reduce((n, type) => n + (type === 'J' || type === 'D' ? 2 : 1), 0);
const VM_GC = 24, STRING = 'Ljava/lang/String;', CLASS_TYPE = 'Ljava/lang/Class;', CLASS_OBJECT_CLASS = 8, INITIALIZED = 2;
const MODE = op => op === 0x71 || op === 0x77 ? 'static' : op === 0x6f || op === 0x75 ? 'super' : op === 0x70 || op === 0x76 ? 'direct' : 'virtual';
const isNull = value => value === null || value === undefined || value === 0;
const kindOf = type => type === 'J' || type === 'D' ? 'W' : type[0] === 'L' || type[0] === '[' ? 'L' : type;

/** A run of the core stopped for a reason that is not a Java exception: what the engine throws to the code that started the run (and what a host up the stack sees). */
export class CoreStop extends APKError {
  constructor(status, detail, message, cause = null) { super(message, { kind: 'vmcore-stop', status, detail }); this.name = 'CoreStop'; this.status = status; this.detail = detail; this.cause = cause; }
}

/**
 * Attaches core.wasm to `runtime` (an APKRuntime created with engine 'wasm' that has run nothing yet). `module`: the compiled core.wasm (WebAssembly.Module). `pages`: memory
 * in 64 KiB pages (the heap is everything above the layout's HEAP; default: what `memory` asks). `memory`: { heapMiB, metaMiB, threads } (src/core-memory.js), the defaults when absent. `stress`: a collection before every allocation of the core; `stressHost`: one before every host allocation too.
 * `shared`: false for an unshared memory (one Worker, green threads: the page; `module` is then compiled from unsharedCore's bytes).
 * `trigger`: a fixed pacing threshold in bytes. `maxDepth`: Thread.maxDepth. Returns the engine (also runtime.wasm, not enumerable).
 */
export async function attachWasmEngine(runtime, { module, shared = true, memory = null, pages = null, stress = false, stressHost = false, trigger, maxDepth = (runtime.maxCallDepth ?? 2048) - 1, natives = CORE_NATIVES } = {}) {   // maxDepth: the JavaScript VM's maxCallDepth counts the frames below the call it refuses
  if (runtime.engine !== 'wasm') throw new Error(`vmcore: attachWasmEngine needs a runtime created with engine 'wasm' (this one has '${runtime.engine}')`);
  if (runtime.wasm) throw new Error('vmcore: a core is attached to this runtime already');
  if (runtime.heap.size !== 0) throw new Error(`vmcore: the runtime already has ${runtime.heap.size} objects on the JavaScript heap; attach the core before anything runs`);
  const engine = new WasmEngine(runtime, { shared, memory, pages, stress, stressHost, trigger, maxDepth, natives });
  await engine.instantiate(module);
  return engine;
}

export class WasmEngine {
  constructor(runtime, { shared = true, memory = null, pages = null, stress, stressHost, trigger, maxDepth, natives }) {
    this.runtime = runtime; this.stressHost = stressHost; this.fixedTrigger = trigger;
    const layout = this.layout = coreLayout(memory ?? CORE_MEMORY_DEFAULT), LAYOUT = layout; pages ??= layout.pages;
    try { this.memory = new WebAssembly.Memory({ initial: Math.min(pages, 2048), maximum: 32768, shared }); if (pages > 2048) this.memory.grow(pages - 2048); }
    catch (error) { throw new APKError(`vmcore: o navegador recusou ${Math.round(pages / 16)} MiB de memória para o núcleo Wasm (${String(error?.message ?? error).slice(0, 120)}); reduza heap, metaspace ou threads em Controles › Execução`, { kind: 'vmcore-memory' }); }   // `shared: false` needs the module of vmcore/js/unshared.js; the memory only grows here, before any view of it exists
    this.pages = pages; this.maxDepth = maxDepth; this.stress = stress;
    if (pages * 65536 <= LAYOUT.HEAP + 16 * MiB) throw new Error(`vmcore: ${pages} pages leave no heap above the ${LAYOUT.HEAP / MiB} MiB of metaspace and thread records`);
    this.linker = new Linker(runtime, { memory: this.memory, metaStart: LAYOUT.META, metaEnd: LAYOUT.META_END, natives, ...LINKER_LIMITS });
    this.exceptions = new Exceptions(this.linker);
    this.WIDE_HIGH = runtime.argumentWords(['J'], [0n])[1];   // the JavaScript VM's marker of a long/double's second register
    this.pins = []; this.pendingHost = []; this.patched = []; this.patchEpoch = 0; this.usedBridge = null; this.hostDepth = 0; this.sites = new Map(); this.methodInfos = new WeakMap(); this.lastError = null; this.stopReason = null; this.fieldSites = new Map(); this.parked = null;
    this.stats = { bridged: 0, frames: 0, steps: 0, nested: 0, collections: 0, hostCollections: 0, markMs: 0, sweepMs: 0, companionScans: 0, pinsAtCollection: 0, rootIds: 0 };
    installHostLinking(this.linker, runtime, { staticValue: (reference, slot) => this.writeValue(slot, reference.type, runtime.readStatic(reference)) });
  }

  async instantiate(module) {
    const { linker, exceptions, memory } = this;
    // the linker's work (a method's code copied and its constants resolved the first time they are used) is first-time work: timed as the JavaScript VM times its method decoding
    const tbLink = this.runtime.tb, resolve = (t, method, what) => { const previous = tbLink.enter(BUCKET.DECODE); try { return linker.imports.resolve(t, method, what); } finally { tbLink.leave(previous); } };
    const imports = coreImports(memory, { resolve, exception: (...a) => this.exceptionEvent(...a), bridge: (m, c, t) => this.bridge(m >>> 0, c >>> 0, t >>> 0),
      field: (t, object, caller, constant, op, reg) => this.hostField(t >>> 0, object >>> 0, caller >>> 0, constant >>> 0, op >>> 0, reg >>> 0) });
    const { exports } = await WebAssembly.instantiate(module, imports);
    this.x = exports;
    if (exports.vm_native_count() !== NATIVE_COUNT) throw new Error(`vmcore: core.wasm has ${exports.vm_native_count()} natives, vmcore/js/natives.js lists ${NATIVE_COUNT}`);
    const LAYOUT = this.layout; this.mainRecord = LAYOUT.THREADS;
    exports.__stack_pointer.value = this.mainRecord + LAYOUT.THREAD_SPAN;
    linker.bindCore(exports, this.mainRecord);
    // the collected heap
    const h = this.h = linker.alloc(GC.SIZE);
    this.w32(h + GC.threadCap, 1024); this.w32(h + GC.rootCap, 1 << 19); this.w32(h + GC.reportCap, 1 << 16); this.w32(h + GC.freedCap, 1 << 14);
    if (!exports.gc_init(h, LAYOUT.HEAP, this.pages * 65536)) throw new Error('vmcore: gc_init refused the region');
    this.w32(h + GC.stress, this.stress ? 1 : 0); if (this.fixedTrigger !== undefined) this.w32(h + GC.trigger, this.fixedTrigger);
    else this.w32(h + GC.trigger, Math.min(this.r32(h + GC.trigger), 64 * MiB));   // the first collection after 64 MiB allocated, not after half of a large heap: the hosts' handle and native tables are only trimmed by collections (gc.c paces the later ones by what survived)
    this.w32(linker.vm + VM_GC, h);
    this.initRecord(this.mainRecord, this.mainRecord + THREAD.javaStack, this.mainRecord + THREAD.javaStack + THREAD.javaStackBytes);
    // threads (vmcore/js/core-threads.js): ThreadsState, the main thread's record attached, the scheduler driving the core's threads
    this.threads = new CoreThreads(this, { main: this.mainRecord, guestBase: LAYOUT.GUESTS, guestSpan: LAYOUT.GUEST_SPAN, guestCount: LAYOUT.GUEST_COUNT, javaStack: THREAD.javaStack });
    this.threads.setup();
    this.stackScratch = linker.alloc(8 * 1024);
    // handles: every record that gets an id is exported (the sweep reports its death); every handle made while host code runs is pinned (see the header)
    const engine = this, handles = this.handles = new HandleTable();
    const idOf = handles.idOf.bind(handles), handleOf = handles.handleOf.bind(handles);
    handles.idOf = address => { const known = handles.idByAddress.get(address); if (known !== undefined || address === 0) return known ?? 0; const id = idOf(address); exports.gc_export(h, address); return id; };
    handles.handleOf = address => { if (address !== 0) engine.pins.push(address); return handleOf(address); };
    const space = this.space = new RecordSpace(memory, { handles, autoRebind: false });
    space.layouts = new LazyLayouts(this);
    space.strings.bind({ classAddress: () => linker.stringClassAddress, allocate: length => this.allocString(length), exportRecord: address => exports.gc_export(h, address) });
    exceptions.decodeString = address => address === 0 ? null : space.strings.get(address);
    this.redirect();
    Object.defineProperty(this.runtime, 'wasm', { value: this, enumerable: false, configurable: true });
    return this;
  }

  /** The current Java thread's core Thread record (the scheduler's running thread; the main thread's before any runs). */
  get t() { const thread = this.runtime.thread; return thread !== null && thread !== undefined && thread.core !== undefined ? thread.core.t : this.mainRecord; }
  get argsOffset() { return THREAD.args; }
  /** A Thread record at `t` with its Java stack [stackBase, stackEnd), registered with the collector. */
  initRecord(t, stackBase, stackEnd) {
    new Uint8Array(this.memory.buffer, t, THREAD.args).fill(0);
    this.w32(t + THREAD.vm, this.linker.vm); this.w32(t + THREAD.stackBase, stackBase); this.w32(t + THREAD.stackEnd, stackEnd);
    this.w32(t + THREAD.stackTop, 0); this.w32(t + THREAD.maxDepth, this.maxDepth); this.view.setBigUint64(t + THREAD.maxSteps, 1n << 60n, true);
    if (!this.x.gc_register_thread(this.h, t)) throw new Error('vmcore: the collector\'s thread table is full');
  }
  /** A record whose thread ended goes back to its empty state (registered, its tid kept). */
  resetRecord(t) {
    for (const field of ['frame', 'pc', 'depth', 'throwing', 'status', 'detail']) this.w32(t + THREAD[field], 0);
    this.w32(t + THREAD.stackTop, 0); this.view.setBigUint64(t + THREAD.result, 0n, true);
    this.view.setBigUint64(t + THREAD.steps, 0n, true); this.view.setBigUint64(t + THREAD.calls, 0n, true);
  }

  // ---- memory
  // The memory never grows after the constructor (its pages are fixed: the heap is everything above LAYOUT.HEAP), so the views are made once: reading a shared memory's `buffer` costs
  // more than the access (about 10 % of a bridged call when it was checked on every access).
  get u32() { if (this.u32view === undefined) { this.u32view = new Uint32Array(this.memory.buffer); this.dv = new DataView(this.memory.buffer); } return this.u32view; }
  get view() { void this.u32; return this.dv; }
  w32(at, value) { this.u32[at >>> 2] = value >>> 0; }
  r32(at) { return this.u32[at >>> 2]; }
  get steps() { return Number(this.view.getBigUint64(this.t + THREAD.steps, true)); }
  /** Instructions and calls of every thread's record. */
  get totals() { return this.threads.totals(); }
  get calls() { return Number(this.view.getBigUint64(this.t + THREAD.calls, true)); }

  // ---- values
  /** A reference word as hosts see it (null, a JavaScript string, a pinned `{ ref }`). */
  refValue(address) { return this.space.refValue(address); }
  /** The reference word of a host value (a JavaScript string becomes a String record). */
  refWord(value) {
    if (isNull(value)) return 0;
    if (typeof value === 'string') return this.space.strings.encode(value);
    if (typeof value === 'object' && typeof value.ref === 'number') { const address = this.handles.addressById.get(value.ref); if (address !== undefined) return address; }
    return this.handles.resolve(value);   // throws the handle table's own message for a freed or unknown id
  }
  /** Writes `value` (the JavaScript VM's form for `type`) into memory at `at`. */
  writeValue(at, type, value) {
    const kind = kindOf(type);
    if (kind === 'W') { this.view.setBigUint64(at, BigInt.asUintN(64, BigInt(value ?? 0n)), true); return; }
    this.w32(at, kind === 'L' ? this.refWord(value) : value === true ? 1 : value === false || value === undefined || value === null ? 0 : Number(value) | 0);
  }
  /** The JavaScript VM's form of a register value of `type` from the 64-bit word `raw` (a BigInt). */
  valueOf(type, raw) {
    if (type === 'V') return undefined;
    const kind = kindOf(type);
    if (kind === 'W') return BigInt.asIntN(64, raw);
    const low = Number(raw & 0xffffffffn);
    return kind === 'L' ? this.refValue(low) : low | 0;
  }

  // ---- allocation (host side)
  alloc(bytes) {
    if (this.stressHost) this.collect('host-stress');
    let at = this.x.gc_alloc(this.h, this.t, bytes) >>> 0;
    if (!at) { this.collect('host-allocation'); at = this.x.gc_alloc(this.h, this.t, bytes) >>> 0; }
    if (!at) this.runtime.throwJava('Ljava/lang/OutOfMemoryError;', `Failed to allocate ${bytes} bytes: the core's heap is full after a collection`);
    return at;
  }
  /** APKRuntime.boxPrimitive of a box kind other than Boolean (natives.h BOX_*), through vm_box: the cached box in the cache's range, a new one otherwise. */
  box(kind, value) {
    this.linker.classOf(BOX_CLASSES[kind]);   // its Class record is in the host state once laid out
    let lo, hi = 0;
    if (kind === 5 || kind === 7) { const bits = BigInt.asUintN(64, BigInt(value)); lo = Number(bits & 0xffffffffn); hi = Number(bits >> 32n); } else lo = Number(value) | 0;
    if (this.stressHost) this.collect('host-stress');
    let at = this.x.vm_box(this.t, kind, lo >>> 0, hi >>> 0) >>> 0;
    if (!at) { this.collect('host-allocation'); at = this.x.vm_box(this.t, kind, lo >>> 0, hi >>> 0) >>> 0; }
    if (!at) this.runtime.throwJava('Ljava/lang/OutOfMemoryError;', `Failed to allocate a ${BOX_CLASSES[kind]}: the core's heap is full after a collection`);
    return this.handles.handleOf(at);
  }
  allocString(length) {
    if (this.stressHost) this.collect('host-stress');
    let at = this.x.vm_string_new(this.t, length) >>> 0;
    if (!at) { this.collect('host-allocation'); at = this.x.vm_string_new(this.t, length) >>> 0; }
    return at;
  }

  // ---- the runtime's entry points (see the header)
  redirect() {
    const engine = this, rt = this.runtime, space = this.space, handles = this.handles, linker = this.linker, proto = Object.getPrototypeOf(rt);
    const facade = value => {
      if (value !== null && typeof value === 'object') { const f = space.objectById(value.ref); if (f !== undefined) return f; }
      if (isNull(value)) rt.throwJava('Ljava/lang/NullPointerException;', 'null object reference');
      const id = typeof value === 'object' ? value.ref : value;
      throw new APKError(typeof id === 'number' && id > 0 && id < handles.nextId ? `Use of a collected object: #${id} was freed by the core's collector (a root the collector did not see)` : `Null or invalid object reference: ${JSON.stringify(value)}`, { kind: 'invalid-object-reference', ref: id });
    };
    rt.object = facade; rt.vmObject = facade;
    rt.heap = { get: id => space.objectById(id), has: id => handles.addressById.has(id), get size() { return handles.size; },
      set() { throw new APKError('vmcore: the heap of the WebAssembly core is not written by id'); }, chunks: [], usedChunks: () => [] };
    Object.defineProperty(rt, 'nextId', { get: () => handles.nextId, set: () => { throw new APKError('vmcore: ids are the handle table\'s'); }, enumerable: false, configurable: true });
    rt.maxHeapObjects = rt.maxFieldSlots = rt.maxArrayCells = rt.maxCollectionCells = Number.MAX_SAFE_INTEGER;   // the JavaScript VM's budgets count its own records; the core's limit is its memory in bytes (an allocation that still fails after a collection is the OutOfMemoryError)
    rt.gcOldBound = 0; rt.gcEnabled = false;   // the JavaScript collector (heap-gc.js) has no heap to collect: the core's collector runs (collect below)
    rt.makeObject = type => {
      if (type.charCodeAt(0) === 91) return rt.newArray(type, 0);
      let info = linker.classOf(type);
      if (type === STRING) throw new APKError('vmcore: a java.lang.String record is made from its text (the string boundary), not by makeObject');
      if (info.isInterface) info = linker.interfaceRecordClass(type);   // an annotation instance: a record typed as its interface (linker.js interfaceRecordClass)
      const at = engine.alloc(engine.r32(info.address + CLASS.instanceSize)); engine.w32(at, info.address);
      return handles.handleOf(at);
    };
    rt.newArray = (type, length, cells = null) => {
      length = Number(length) | 0;
      if (length < 0) rt.throwJava('Ljava/lang/NegativeArraySizeException;', `negative array length ${length}`);
      if (!type.startsWith('[')) throw new APKError('Invalid/excessive array allocation');
      if (length > 16777216) rt.outOfMemory(`Array of ${length} elements exceeds the array size limit`);
      const info = linker.classOf(type), width = (engine.r32(info.address + CLASS.flags) >>> 8) & 255;
      const at = engine.alloc(16 + length * width); engine.w32(at, info.address); engine.w32(at + 8, length);
      const handle = handles.handleOf(at);
      if (cells !== null) space.objectAt(at).elements = cells;   // copied: the record's elements are its memory
      return handle;
    };
    // java.lang.Class objects are the core's (classes.h: one per class, const-class and Object.getClass give it), so a host's classObject(type) answers the same record; its facade
    // carries `classType` (what the JavaScript VM's Class objects carry), set from the record's Class word when the facade is made (LazyLayouts).
    rt.classObject = type => {
      const info = linker.classOf(type), slot = linker.classObjectTable + 4 * info.id;
      let at = engine.r32(slot);
      if (!at) {
        if (engine.stressHost) engine.collect('host-stress');
        at = engine.x.vm_class_object(engine.t, info.address) >>> 0;
        if (!at) { engine.collect('host-allocation'); at = engine.x.vm_class_object(engine.t, info.address) >>> 0; }
        if (!at) rt.throwJava('Ljava/lang/OutOfMemoryError;', `Failed to allocate the Class object of ${type}: the core's heap is full after a collection`);
      }
      return handles.handleOf(at);
    };
    // The breakdown's per-key and per-thread host counts of unsampled bridged calls (bridgeBody) are added before anything reads or resets them, or switches the thread.
    const tb = rt.tb;
    for (const name of ['snapshot', 'reset', 'thread']) { const original = tb[name]; tb[name] = function (...a) { if (engine.pendingHost.length) engine.flushHostCounts(); return original.apply(this, a); }; }
    // Boxes are records with a payload (natives.h): boxPrimitive goes through the core's own (vm_box), with the cache the box natives use. Boolean keeps the JavaScript VM's
    // path (its two constants are host-modelled statics).
    const boxPrimitive = proto.boxPrimitive;
    rt.boxPrimitive = (type, value) => { const kind = type.length === 1 ? BOX_LETTERS.indexOf(type) : -1; return kind > 0 ? engine.box(kind, value) : boxPrimitive.call(rt, type, value); };
    // the time breakdown's buckets as the JavaScript VM charges them: Java run from host code is interpreter time (APKRuntime.execute), class initialization its own
    rt.initialize = type => { const previous = tb.enter(BUCKET.INIT); try { return engine.initialize(type); } finally { tb.leave(previous); } };
    rt.execute = (method, code, args) => { const previous = tb.enter(BUCKET.INTERP); try { return engine.execute(method, args); } finally { tb.leave(previous); } };
    rt.readStatic = reference => engine.readStatic(reference, proto.readStatic);
    rt.writeStatic = (reference, value) => engine.writeStatic(reference, value, proto.writeStatic);
    rt.captureStack = () => engine.captureStack();
    // Object.clone (the JavaScript VM's bridge copies the record object; here the record is memory): a copy of the record's memory and of its companion
    const bridgeCore = proto.bridgeCore;
    rt.bridgeCore = function (method, words, mode, knownKey, resolution) {
      if (method.name === 'clone' && method.owner === 'Ljava/lang/Object;' && words.length === 1 && mode !== 'static') return engine.cloneObject(words[0]);
      return bridgeCore.call(this, method, words, mode, knownKey, resolution);
    };
  }
  /**
   * Object.clone of a record (APKRuntime's bridge): an array gets a new array with the same elements; a Cloneable object a new record of its class with every field of its memory
   * copied (the header's lock word is the new record's own) and its companion -- the properties hosts hang on it, its out-of-layout fields, its `children` -- copied as the
   * JavaScript VM's Object.assign copies them. Not Cloneable: CloneNotSupportedException.
   */
  cloneObject(value) {
    const rt = this.runtime, original = rt.object(value), from = original.address, u8 = new Uint8Array(this.memory.buffer);
    let copy;
    if (original instanceof ArrayFacade) {
      const n = original.length, width = (this.r32(this.r32(from) + CLASS.flags) >>> 8) & 255;
      copy = rt.newArray(original.type, n); const to = this.handles.addressById.get(copy.ref);
      u8.copyWithin(to + 16, from + 16, from + 16 + n * width); this.dirty(to, 16 + n * width);
      return copy;
    }
    if (!rt.isSubtype(original.type, 'Ljava/lang/Cloneable;')) rt.throwJava('Ljava/lang/CloneNotSupportedException;', original.type);
    copy = rt.makeObject(original.type);
    const to = this.handles.addressById.get(copy.ref), size = this.r32(this.r32(from) + CLASS.instanceSize);
    u8.copyWithin(to + 8, from + 8, from + size); this.dirty(to, size);
    const target = rt.object(copy);
    for (const key of Object.keys(original)) if (key !== 'id' && key !== 'type') target[key] = original[key];
    if (original.fieldExtra) target.fieldExtra = new Map(original.fieldExtra);
    if (Object.hasOwn(original, 'children')) target.children = [...original.children];
    return copy;
  }
  /** The card-table bytes of [address, address + bytes) (gc.h: what a reference store into a record marks). */
  dirty(address, bytes) {
    const base = this.r32(this.h + GC.base), cards = this.r32(this.h + 432), u8 = new Uint8Array(this.memory.buffer);
    for (let c = (address - base) >> 9, last = (address + bytes - 1 - base) >> 9; c <= last; c++) u8[cards + c] = 1;
  }

  /** The laid-out method of a DEX method object (a definition's `method`, or a method reference), or null. */
  methodInfo(method) {
    let mi = this.methodInfos.get(method);
    if (mi === undefined) {
      const info = this.linker.classOf(method.owner);
      mi = info.methods.get(method.name + method.signature) ?? null;
      this.methodInfos.set(method, mi);
    }
    return mi;
  }

  /** APKRuntime.initialize in the core: a class with DEX code is initialized by a nested run whose entry is a static `return-void` of its own (the <clinit> chain runs above it). */
  initialize(type) {
    if (!this.runtime.classes.has(type)) return;
    const info = this.linker.classOf(type);
    if (this.r32(info.address + CLASS.initState) === INITIALIZED) return;
    this.initMethod ??= this.linker.rawMethod(Uint16Array.of(0x000e), { registers: 0 });
    this.runNested(this.initMethod, [], 'V', info.address, 1);
  }

  /** APKRuntime.execute in the core: `args` are the JavaScript VM's argument words (WIDE_HIGH after each long/double). */
  execute(method, args) {
    const mi = this.methodInfo(method);
    if (!mi) throw new APKError(`vmcore: ${method.owner}->${method.name}${method.signature} is not a method the core's linker knows`);
    return this.runNested(mi.id, this.wordsOf(args), method.result ?? method.signature.slice(method.signature.indexOf(')') + 1));
  }
  /** The argument words of the JavaScript VM's argument registers (WIDE_HIGH after each long/double). */
  wordsOf(args) {
    const words = [];
    for (const value of args) {
      if (value === this.WIDE_HIGH) continue;
      if (typeof value === 'bigint') { const bits = BigInt.asUintN(64, value); words.push(Number(bits & 0xffffffffn), Number(bits >> 32n)); }
      else if (value === null || value === undefined) words.push(0);
      else if (typeof value === 'object' || typeof value === 'string') words.push(this.refWord(value));
      else words.push(value === true ? 1 : value === false ? 0 : Number(value) >>> 0);
    }
    return words;
  }

  /**
   * Runs method `id` (VM.methods) with argument words `words` in a nested run (or a first run, when no frame is live), collecting and resuming while it stops with OUT_OF_MEMORY,
   * and gives the JavaScript VM's value of `result`. A Java exception that leaves it is thrown as a JavaException; any other stop as a CoreStop (or the host's own error).
   */
  runNested(id, words, result, initClass = 0, uncount = 0) {
    // the JavaScript VM's runNested (interpreter.js): the main thread runs host events; the process's main Looper exists before the first Java code; the running thread's own
    // wait, if it is parked below this run (main-Looper messages served while it waits), is kept aside, and the run gets a record of its own meanwhile (CoreThreads.borrow)
    const rt = this.runtime, sched = rt.scheduler;
    if (rt.nestedRuns === 0) { rt.thread = sched.mainThread(); rt.platform?.looperHost?.autoStart(rt); }
    if (rt.nestedRuns >= rt.maxNestedRuns) rt.throwJava('Ljava/lang/StackOverflowError;', 'native re-entry depth exceeded');
    const owner = rt.thread ?? sched.mainThread();
    const parked = owner.blocked !== null || owner.coreWait ? { blocked: owner.blocked, state: owner.state, timedOut: owner.timedOut, coreWait: owner.coreWait } : null;
    const giveBack = parked !== null ? this.threads.borrow(owner) : null;
    if (parked !== null) { owner.blocked = null; owner.state = 'runnable'; owner.coreWait = null; }
    if (++rt.nestedRuns === 1) sched.beginEvent(rt);
    owner.nestedDepth++;
    try { return this.runOn(owner, id, words, result, initClass, uncount, parked); }
    finally {
      owner.nestedDepth--; rt.nestedRuns--; rt.thread = owner;
      if (giveBack !== null) giveBack();
      if (parked !== null) { owner.blocked = parked.blocked; owner.state = parked.state; owner.timedOut = parked.timedOut; owner.coreWait = parked.coreWait; }
      if (rt.nestedRuns === 0 && owner === sched.main) rt.platform?.looperHost?.hostEventRan(rt);
    }
  }
  runOn(owner, id, words, result, initClass, uncount, parked) {
    const x = this.x, t = this.t, u32 = this.u32, view = this.view;
    if (words.length > 440) throw new APKError(`vmcore: ${words.length} argument words`);
    const saved = { frame: u32[(t + THREAD.frame) >> 2], pc: u32[(t + THREAD.pc) >> 2], depth: u32[(t + THREAD.depth) >> 2], stackTop: u32[(t + THREAD.stackTop) >> 2],
      throwing: u32[(t + THREAD.throwing) >> 2], status: u32[(t + THREAD.status) >> 2], detail: u32[(t + THREAD.detail) >> 2], result: view.getBigUint64(t + THREAD.result, true) };
    words.forEach((w, i) => { u32[((t + THREAD.args) >> 2) + i] = w >>> 0; });
    this.stats.nested++;
    let status, raw, detail;
    const steps = owner.core.steps, base = steps.length; steps.push({ kind: 'own', parked });   // the base of this run among the thread's host steps (CoreThreads.pump)
    try {
      status = this.threads.finish(owner, x.run_nested(t, id, t + THREAD.args, initClass) >>> 0);   // collections, waits and other threads until the run is over
      raw = this.view.getBigUint64(t + THREAD.result, true); detail = this.r32(t + THREAD.detail);
    } finally {
      steps.length = base;
      const v = this.view, w = this.u32;
      w[(t + THREAD.frame) >> 2] = saved.frame; w[(t + THREAD.pc) >> 2] = saved.pc; w[(t + THREAD.depth) >> 2] = saved.depth; w[(t + THREAD.stackTop) >> 2] = saved.stackTop;
      w[(t + THREAD.throwing) >> 2] = saved.throwing; w[(t + THREAD.status) >> 2] = saved.status; w[(t + THREAD.detail) >> 2] = saved.detail; v.setBigUint64(t + THREAD.result, saved.result, true);
    }
    if (status === Status.OK) { if (uncount) this.view.setBigUint64(t + THREAD.steps, BigInt(this.steps - uncount), true); return this.valueOf(result, raw); }
    if (status === Status.UNCAUGHT) {
      const address = Number(raw & 0xffffffffn), handle = this.refValue(address);
      throw new JavaException(handle, this.messageOf(address));
    }
    throw this.stopError(status, detail);
  }

  /** The error a run that stopped with `status` throws to whoever started it: the host's own error for HOST_FAILED, a CoreStop otherwise. */
  stopError(status, detail) {
    const key = status === Status.UNSUPPORTED ? `opcode 0x${detail.toString(16)}` : status === Status.UNRESOLVED ? `constant ${detail}` : this.linker.methodList[detail]?.key ?? String(detail);
    if (status === Status.HOST_FAILED && this.lastError) { const error = this.lastError; this.lastError = null; return error; }
    if (status === Status.HOST_STOPPED) return new CoreStop(status, detail, `vmcore: a host step the core does not take yet, at ${key}: ${this.stopReason ?? '?'}`);
    return new CoreStop(status, detail, `vmcore: the run stopped with ${STATUS_NAMES[status] ?? status} (${key})${this.linker.error ? `: ${this.linker.error}` : ''}; last calls: ${this.lastCalls(8).join(' <- ')}`);
  }
  /** The last `n` methods the thread called (its trace ring, Thread.ring), newest first. */
  lastCalls(n) {
    const t = this.t, index = this.r32(t + THREAD.ringIndex), out = [];
    for (let i = 1; i <= n && i <= index; i++) out.push(this.linker.methodList[this.r32(t + 80 + 4 * ((index - i) & 511))]?.key ?? '?');
    return out;
  }

  // ---- env.bridge (vmcore/host.h)
  /** The call site: the caller's resolved constant names the DEX method reference the JavaScript interpreter's site.target is. */
  siteOf(caller, constant, op) {
    const key = caller * 65536 + constant; let site = this.sites.get(key);
    if (site === undefined) {
      const mi = this.linker.methodsAt.get(caller), entry = mi?.pool?.[constant];
      if (!entry) throw new APKError(`vmcore: no call site at method ${mi?.key ?? caller} constant ${constant}`);
      const reference = mi.def.method.dex.method(entry.index), mode = MODE(op);
      site = { reference, mode, callerOwner: mi.owner.type, kinds: reference.parameters.map(kindOf), result: reference.result, isStatic: mode === 'static', key: `${reference.owner}->${reference.name}${reference.signature}`,
        bridge: null, bridgeEpoch: -1, bridgeType: null, bridgePoly: null, stringInit: reference.owner === STRING && reference.name === '<init>',
        plumbing: LOOPER_PLUMBING.test(mi.owner.type) };   // the caller is Looper/MessageQueue/Handler plumbing: its bridged calls leave no trace entry (APKRuntime.record)
      this.sites.set(key, site);
    }
    return site;
  }
  /** The JavaScript interpreter's argument registers of a call: the receiver, then each parameter (a long or double followed by WIDE_HIGH). */
  decodeArguments(site, at, count) {
    const u32 = this.u32, out = []; let w = at >>> 2;
    if (!site.isStatic) out.push(this.refValue(u32[w++]));
    for (const kind of site.kinds) {
      if (kind === 'W') { out.push(BigInt.asIntN(64, (BigInt(u32[w + 1]) << 32n) | BigInt(u32[w]))); out.push(this.WIDE_HIGH); w += 2; }
      else if (kind === 'L') out.push(this.refValue(u32[w++]));
      else out.push(u32[w++] | 0);
    }
    if (w - (at >>> 2) !== count) throw new APKError(`vmcore: the call of ${site.key} has ${count} argument words, its reference ${w - (at >>> 2)}`);
    return out;
  }
  bridge(methodId, call, t) {
    const u32 = this.u32, op = u32[(call + HOST_CALL.op) >> 2], caller = u32[(call + HOST_CALL.caller) >> 2], constant = u32[(call + HOST_CALL.constant) >> 2];
    const count = u32[(call + HOST_CALL.count) >> 2], at = u32[(call + HOST_CALL.args) >> 2];
    const mark = this.pins.length; this.hostDepth++; this.stats.bridged++;
    try {
      const site = this.siteOf(caller, constant, op), args = this.decodeArguments(site, at, count);
      if (site.stringInit) return this.constructString(site, args, t);
      this.usedBridge = null;
      let outcome = this.call(site, args);
      if (this.usedBridge !== null) { const used = this.usedBridge; this.usedBridge = null; if (used.vmNative !== 0) this.bindNative(methodId, site, args, used); }
      if (outcome instanceof PendingCall) {
        const mi = this.methodInfo(outcome.method);
        if (mi && (outcome.args === args || sameWords(outcome.args, args))) { this.stats.frames++; this.w32(t + THREAD.detail, mi.address); return Status.HOST_FRAME; }
      }
      // a host step (a wait, a call into Java with a continuation): the run stops here and the thread takes the step where it can park and resume (CoreThreads.pump)
      // A wait that asks for the call again (Blocked.retry: a read with nothing to read yet, an accept, a certificate chain still being made) has no value of its own: once it is
      // ready the host method runs again with the same arguments, as the JavaScript interpreter runs the invoke again (interpreter.js: f.pc = outcome.retry ? start : ...).
      if (outcome instanceof Blocked && outcome.retry) { const again = () => { const next = this.call(site, args); if (next instanceof Blocked && next.retry) next.coreRetry = again; return next; }; outcome.coreRetry = again; }
      if (outcome instanceof PendingCall || outcome instanceof Invoke || outcome instanceof Blocked) { this.parked = { step: outcome, result: site.result }; return Status.HOST_BLOCKED; }
      this.writeValue(t + THREAD.result, site.result, outcome);
      if (kindOf(site.result) !== 'W') this.w32(t + THREAD.result + 4, 0);
      return Status.OK;
    } catch (error) {
      return this.failed(error, t);
    } finally {
      if (this.pins.length !== mark) this.pins.length = mark;
      this.hostDepth--;
      if (this.patched.length !== 0 && (this.runtime.dex.dynamicFiles?.length ?? 0) !== this.patchEpoch) this.unbindNatives();
    }
  }
  /**
   * A String constructor the core has no C native for (INVOKE_STRING_INIT with a host method, classes.h): the JavaScript VM's constructor bridge runs on a scratch record standing
   * for the uninitialized String (it keeps the text it builds on the record, `stringValue`), and the answer is a NEW String record of that text in Thread.result, which the
   * interpreter stores over every register that held the uninitialized one. The call is the one bridged call the JavaScript VM makes; its exceptions are the bridge's.
   */
  constructString(site, args, t) {
    const scratch = this.runtime.makeObject('Ljava/lang/Object;');
    args[0] = scratch;
    const outcome = this.call(site, args);
    if (outcome instanceof PendingCall || outcome instanceof Invoke || outcome instanceof Blocked) throw new APKError(`vmcore: the String constructor ${site.key} answered a host step (a wait or a call into Java), which a String constructor cannot take`);
    const text = this.runtime.object(scratch).stringValue;
    if (typeof text !== 'string') throw new APKError(`vmcore: the String constructor ${site.key} built no text`);
    const address = this.space.strings.encodeNew(text);
    this.view.setBigUint64(t + THREAD.result, BigInt(address), true);
    return Status.OK;
  }
  /**
   * What the JavaScript interpreter's call site does with a call that is not a DEX callee it cached (interpreter.js, the invoke slow path): a site whose resolution was a bridge
   * remembers it (per receiver class for a virtual site; annotation and reflection proxies always dispatch) and calls APKRuntime.bridge directly the next times, with the same
   * bookkeeping (profile, monitor, trace, the host-allocation scope); otherwise APKRuntime.dispatch decides and the site learns the bridge it chose (runtime.lastBridge).
   */
  call(site, args) {
    const rt = this.runtime;
    let bridge = site.bridge, bridged = false;
    if (bridge !== null && site.bridgeEpoch === rt.resolveEpoch) {
      if (site.isStatic || site.mode === 'direct' || site.mode === 'super') bridged = true;
      else {
        const receiver = args[0];
        if (typeof receiver === 'string') bridged = site.bridgeType === STRING;
        else if (receiver !== null) {
          const record = this.space.objectById(receiver.ref);
          if (record !== undefined && record.annotationValues === undefined && record.proxyHandler === undefined) {
            if (record.type === site.bridgeType) bridged = true;
            else { const poly = site.bridgePoly; if (poly !== null) { const entry = poly.get(record.type); if (entry !== undefined) { bridge = entry; bridged = true; } } }
          }
        }
      }
    }
    if (bridged) {
      if (rt.profile.active) rt.profile.host(bridge.key);
      const monitor = rt.monitor; if (monitor.sink === null) rt.hostCall = bridge.key; else monitor.hostEnter(bridge.key, bridge);   // OperationMonitor.hostEnter without a sink
      if (!site.plumbing) {   // APKRuntime.record(bridge.text), as the interpreter's bridged path inlines it past the ring's fixed head
        const ring = rt.traceRing;
        if (ring == null || ring.head.length < 128 || rt.traceMuted) rt.record(bridge.text);
        else if (ring.length === 384) { ring.tail[ring.start] = bridge.text; ring.start = ring.start === 383 ? 0 : ring.start + 1; rt.traceDropped = (rt.traceDropped ?? 0) + 1; }
        else ring.tail[(ring.start + ring.length++) % 384] = bridge.text;
      }
      this.usedBridge = bridge;
      const hostMark = rt.hostAllocs.length, outcome = this.bridgeBody(rt, bridge, args, site.mode); rt.hostCall = null;
      if (rt.hostAllocs.length > hostMark && !(outcome instanceof Blocked || outcome instanceof Invoke)) rt.releaseHostAllocs(hostMark);
      return outcome;
    }
    rt.lastBridge = null; const depthBefore = rt.depth;
    const outcome = rt.dispatch(site.reference, args, site.mode, site.callerOwner, true);
    if (rt.lastBridge !== null && rt.lastBridgeDepth === depthBefore + 1) {
      const receiver = args[0], record = !site.isStatic && site.mode === 'virtual' && typeof receiver !== 'string' ? rt.vmObject(receiver) : null;
      if (record === null || (record.annotationValues === undefined && record.proxyHandler === undefined)) {
        const type = site.mode === 'virtual' ? (record === null ? STRING : record.type) : null;
        this.usedBridge = rt.lastBridge;
        if (site.bridge === null || site.bridgeEpoch !== rt.resolveEpoch) { site.bridge = rt.lastBridge; site.bridgeEpoch = rt.resolveEpoch; site.bridgeType = type; site.bridgePoly = null; }
        else if (site.mode === 'virtual' && type !== site.bridgeType) { const poly = site.bridgePoly ??= new Map(); if (poly.size < 64) poly.set(type, rt.lastBridge); }
      }
    }
    rt.lastBridge = null;
    return outcome;
  }
  /**
   * APKRuntime.bridge(bridge.selected, args, mode, bridge.key, bridge) -- the direct body of a pure java.lang bridge (DIRECT_BRIDGES) or bridgeCore -- with its time accounting
   * (src/time-breakdown.js) kept equal in what it counts and sampled in what it times: every call counts one host-bucket entry, one call of its key and one host call of the
   * thread, exactly; one call in TIME_SAMPLE of each bridge reads the clock around the body, and its host time stands for the TIME_SAMPLE calls (charged to the host bucket and to
   * the key, and taken off the bucket the unsampled ones ran in), instead of two clock reads per call. A bridge seen running Java inside (a nested run) is timed on every call
   * from then on: extrapolating one call of it would multiply the Java it ran. The key and thread counts of the unsampled calls are added on the sampled
   * one (and whenever the breakdown is read: flushHostCounts).
   */
  bridgeBody(rt, bridge, args, mode) {
    const tb = rt.tb;
    if (bridge.vmNests === true) {   // a bridge that runs Java inside (a callback, a traversal): every call timed, the Java it runs charged where APKRuntime.execute charges it
      const previous = tb.enter(BUCKET.HOST), startedAt = tb.last;
      try { return this.runBridge(rt, bridge, args, mode); }
      finally { tb.leave(previous); tb.hostCall(bridge.key, tb.last - startedAt); }
    }
    const sample = bridge.vmSample = (bridge.vmSample ?? 0) + 1, nested = this.stats.nested;
    if (sample < TIME_SAMPLE) {
      tb.counts[BUCKET.HOST]++;
      bridge.vmPending = (bridge.vmPending ?? 0) + 1;
      if (bridge.vmListed !== true) { bridge.vmListed = true; this.pendingHost.push(bridge); }
      try { return this.runBridge(rt, bridge, args, mode); } finally { if (this.stats.nested !== nested) bridge.vmNests = true; }
    }
    bridge.vmSample = 0;
    const previous = tb.enter(BUCKET.HOST), startedAt = tb.last, hostBefore = tb.ms[BUCKET.HOST];
    try { return this.runBridge(rt, bridge, args, mode); }
    finally {
      tb.leave(previous);
      const ms = tb.last - startedAt;
      if (this.stats.nested === nested) {   // a leaf call: its time stands for the TIME_SAMPLE calls of this bridge since the last sample
        const others = (TIME_SAMPLE - 1) * (tb.ms[BUCKET.HOST] - hostBefore);
        tb.ms[BUCKET.HOST] += others; tb.ms[previous] -= others; if (previous === BUCKET.INTERP) tb.acc.ms -= others;
        tb.hostCall(bridge.key, TIME_SAMPLE * ms);
      } else { bridge.vmNests = true; tb.hostCall(bridge.key, ms); }
      if (bridge.vmPending > 0) this.flushHost(tb, bridge);
    }
  }
  runBridge(rt, bridge, args, mode) {
    if (rt.fastCallPaths !== false) {
      let direct = bridge.direct; if (direct === undefined) direct = bridge.direct = rt.directBridge(bridge.key);
      if (direct !== null && args.length === (bridge.wordCount ??= wordCount(bridge.selected.parameters) + (mode === 'static' ? 0 : 1))) return direct(rt, args);
    }
    return rt.bridgeCore(bridge.selected, args, mode, bridge.key, bridge);
  }
  /** Adds the pending (unsampled) calls of `bridge` to the breakdown's key and thread counts, as TimeBreakdown.hostCall would have one by one. */
  flushHost(tb, bridge) {
    const n = bridge.vmPending; bridge.vmPending = 0; if (!n) return;
    let entry = tb.host.get(bridge.key);
    if (entry === undefined) { if (tb.host.size < 4000) tb.host.set(bridge.key, entry = { n: 0, ms: 0 }); }
    if (entry !== undefined) entry.n += n;
    const acc = tb.acc; acc.calls += n; acc.hosts.set(bridge.key, (acc.hosts.get(bridge.key) ?? 0) + n);
  }
  flushHostCounts() { const tb = this.runtime.tb; for (const bridge of this.pendingHost) { this.flushHost(tb, bridge); bridge.vmListed = false; } this.pendingHost.length = 0; }
  /**
   * Binds the C native of the bridge the JavaScript VM just selected for host record `methodId` (natives.js BRIDGE_NATIVES): the record's kind becomes the native, so the next
   * calls through it run in C. Only where the routing cannot select another bridge for a later call through the same record: a static call (its resolution does not depend on
   * a receiver), or a virtual call through a host-dispatch record of a vtable slot or of a final class's method whose receiver is of that record's class, and only for receivers
   * that are not annotation or reflection proxies. Loading DEX code (a new resolution epoch) unbinds them all.
   */
  bindNative(methodId, site, args, bridge) {
    let entry = bridge.vmNative; if (entry === undefined) entry = bridge.vmNative = BRIDGE_NATIVES.get(bridge.key) ?? 0;
    if (entry === 0) return;
    const mi = this.linker.methodList[methodId]; if (mi === undefined || mi.kind !== METHOD_KIND_UNBOUND || mi.def) return;
    if (site.isStatic) { if (mi.hostDispatch || !(mi.flags & 1)) return; }
    else {
      if (site.mode !== 'virtual' || !mi.hostDispatch || mi.flags & 32) return;   // no interface record: its receivers are of any class
      const receiver = args[0]; if (receiver === null || typeof receiver !== 'object') return;
      const address = this.handles.addressById.get(receiver.ref), record = this.space.objectById(receiver.ref);
      if (address === undefined || record === undefined || record.annotationValues !== undefined || record.proxyHandler !== undefined) return;
      if (!entry.anyReceiver && !(this.r32(address) === mi.owner.address && mi.owner.boxKind !== undefined)) return;   // a final box class's own record
    }
    mi.kind = entry.id; this.w32(mi.address + METHOD.kind, entry.id); this.patched.push(mi);
    this.patchEpoch = this.runtime.dex.dynamicFiles?.length ?? 0;
  }
  /** The bound natives go back to the trampoline (the routing may answer differently now). */
  unbindNatives() { for (const mi of this.patched) { mi.kind = METHOD_KIND_UNBOUND; this.w32(mi.address + METHOD.kind, METHOD_KIND_UNBOUND); } this.patched.length = 0; }
  /** A host's error as env.bridge's status: a Java exception is thrown in the core; a stop of an inner run keeps its status; anything else stops the run (HOST_FAILED). */
  failed(error, t) {
    if (error instanceof JavaException || error?.name === 'JavaException') {
      const address = this.refWord(error.value);
      if (address) { this.view.setBigUint64(t + THREAD.result, BigInt(address), true); return Status.HOST_THROW; }
    }
    if (error instanceof CoreStop && error.status === Status.HOST_STOPPED) return Status.HOST_STOPPED;
    this.lastError = error; return Status.HOST_FAILED;
  }
  /** The host step the last env.bridge stopped its run with (HOST_BLOCKED), and the call site's result type. */
  takeParked() { const parked = this.parked; this.parked = null; if (!parked) throw new APKError('vmcore: a run stopped with HOST_BLOCKED and no wait was recorded'); return parked; }
  /**
   * env.field (vmcore/host.h HOST_FIELD): iget/iput of a field the JavaScript VM keeps in the record's `fields` map (a field of a class its hosts model), by the key its
   * resolveField gives, with the default value of the field's type when it was never written, and the instruction's own conversions (interpreter.js, the iget and iput families).
   */
  hostField(t, object, caller, constant, op, reg) {
    try {
      const key = caller * 65536 + constant; let site = this.fieldSites.get(key);
      if (site === undefined) {
        const mi = this.linker.methodsAt.get(caller), entry = mi?.pool?.[constant]; if (!entry) throw new APKError(`vmcore: no field site at method ${mi?.key ?? caller} constant ${constant}`);
        const reference = mi.def.method.dex.field(entry.index), field = this.runtime.resolveField(reference);
        site = { key: field.key, type: reference.type };
        this.fieldSites.set(key, site);
      }
      const fields = this.space.objectAt(object).fields, kind = kindOf(site.type), u32 = this.u32, at = reg >>> 2;
      if (op <= 0x58) {
        let v = fields.get(site.key);
        const variant = op - 0x52;
        if (variant === 1) { this.view.setBigUint64(reg, BigInt.asUintN(64, BigInt(v ?? 0n)), true); return Status.OK; }
        if (variant === 2 || kind === 'L') { u32[at] = this.refWord(v ?? null); return Status.OK; }
        const n = v === true ? 1 : v === false || v === undefined || v === null ? 0 : Number(v) | 0;
        u32[at] = (variant === 3 ? n & 1 : variant === 4 ? (n << 24) >> 24 : variant === 5 ? n & 65535 : variant === 6 ? (n << 16) >> 16 : n) >>> 0;
        return Status.OK;
      }
      const variant = op - 0x59;
      let value;
      if (variant === 1) value = BigInt.asIntN(64, (BigInt(u32[at + 1]) << 32n) | BigInt(u32[at]));
      else if (variant === 2) value = this.refValue(u32[at]);
      else { const v = u32[at] | 0; value = variant === 3 ? v & 1 : variant === 4 ? (v << 24) >> 24 : variant === 5 ? v & 65535 : variant === 6 ? (v << 16) >> 16 : v; }
      fields.set(site.key, value);
      return Status.OK;
    } catch (error) { return this.failed(error, t); }
  }

  // ---- statics
  readStatic(reference, fallback) {
    const field = this.dexStatic(reference);
    if (!field) return fallback.call(this.runtime, reference);
    this.initialize(field.owner.type);
    const kind = kindOf(field.type), view = this.view;
    if (kind === 'W') return view.getBigInt64(field.address, true);
    const word = view.getInt32(field.address, true);
    return kind === 'L' ? this.refValue(word >>> 0) : word;
  }
  writeStatic(reference, value, fallback) {
    const field = this.dexStatic(reference);
    if (!field) return fallback.call(this.runtime, reference, value);
    this.initialize(field.owner.type);
    this.writeValue(field.address, field.type, value);
  }
  dexStatic(reference) {
    if (!this.runtime.classes.has(reference.owner)) return null;
    try { const field = this.linker.resolveField(reference); return field.static && field.owner.cls ? field : null; } catch { return null; }
  }

  // ---- exceptions
  /** env.exception: the core's own exceptions get the JavaScript VM's message and stack on their companion, where Throwable's host methods read them. */
  exceptionEvent(t, event, object, a, b, c, stack, count) {
    this.exceptions.imports.exception(t, event, object, a, b, c, stack, count);
    const record = this.exceptions.records.get(object >>> 0); if (!record) return;
    const f = this.space.objectAt(object >>> 0);
    if (f.message === undefined) f.message = record.message;
    f.stack = record.stack.map(entry => this.linker.methodList[entry.method]?.def?.method ?? { owner: this.linker.methodList[entry.method]?.owner.type, name: this.linker.methodList[entry.method]?.name });
    if (record.cause) f.cause = this.refValue(record.cause);
  }
  messageOf(address) { const f = this.space.objectAt(address); return typeof f.message === 'string' ? f.message : this.exceptions.records.get(address)?.message ?? null; }
  /** What is known of exception record `address`: its class and message. */
  describe(address) { return address ? { type: this.linker.describe(this.r32(address)), message: this.messageOf(address) } : null; }
  captureStack() {
    const n = this.x.stack_walk(this.t, this.stackScratch, 1024) >>> 0, out = [], u32 = this.u32; let leading = true;
    for (let i = 0; i < n; i++) {
      const mi = this.linker.methodList[u32[(this.stackScratch >> 2) + 2 * i]]; if (!mi) continue;
      const method = mi.def?.method ?? { owner: mi.owner.type, name: mi.name, signature: mi.nameSig.slice(mi.name.length) };
      if (leading && method.name === '<init>' && this.runtime.isSubtype(method.owner, 'Ljava/lang/Throwable;')) continue;
      leading = false; out.push(method);
    }
    return out;
  }

  // ---- the collector (see the header)
  collect(reason = 'manual') {
    const tb = this.runtime.tb, previous = tb.enter(BUCKET.GC);
    try { return this.collectNow(reason); } finally { tb.leave(previous); }
  }
  collectNow(reason) {
    const x = this.x, h = this.h, linker = this.linker, handles = this.handles, space = this.space, t0 = performance.now();
    const addresses = new Set(), visit = id => { const address = handles.addressById.get(id); if (address !== undefined) addresses.add(address); };
    let phase = 'roots';
    const scanner = scanHostRoots(this.runtime, id => { if (phase === 'roots') visit(id); else { const address = handles.addressById.get(id); if (address !== undefined) x.gc_mark_root(h, address); } });
    for (const address of this.pins) addresses.add(address);
    this.stats.pinsAtCollection = Math.max(this.stats.pinsAtCollection, this.pins.length); this.stats.rootIds = addresses.size;
    const ranges = linker.rootRanges(), cap = this.r32(h + GC.rootCap), at = this.r32(h + GC.roots) >>> 2, u32 = this.u32;
    if (ranges.length > cap) throw new APKError(`vmcore: ${ranges.length} metaspace root ranges, the root buffer holds ${cap}`);
    let n = 0; for (const [address, words] of ranges) { u32[at + 2 * n] = address; u32[at + 2 * n + 1] = words; n++; }
    const singles = [...addresses]; let next = 0;
    while (n < cap && next < singles.length) { u32[at + 2 * n] = singles[next++]; u32[at + 2 * n + 1] = 0; n++; }
    this.w32(h + GC.rootCount, n);
    x.gc_begin(h);
    for (; next < singles.length; next++) x.gc_mark_root(h, singles[next]);
    x.gc_drain(h);
    // ephemerons: the companions of the exported records marked so far, and the values of the runtime's ephemeron maps (heap-gc.js ephemeronMap: an entry lives while the
    // record its key names is live through something else), to a fixed point
    phase = 'companions';
    const ephemeronMaps = this.runtime.ephemeronMaps ?? new Set(), scannedValues = new Set();
    const ephemerons = () => {
      let progress = false;
      for (const map of ephemeronMaps) for (const [key, value] of map) {
        if (typeof key !== 'number' || value === null || typeof value !== 'object' || scannedValues.has(value)) continue;
        const address = handles.addressById.get(key); if (address === undefined || !x.gc_is_marked(h, address)) continue;
        scannedValues.add(value); scanner.scan(value); progress = true;
      }
      if (progress) x.gc_drain(h);
      return progress;
    };
    for (;;) {
      const count = this.r32(h + GC.reportCount), overflow = this.r32(h + GC.reportOverflow);
      if (!count && !overflow) { if (ephemerons()) continue; break; }
      const reports = this.r32(h + GC.reports) >>> 2, marked = [];
      if (overflow) { for (const address of handles.idByAddress.keys()) if (x.gc_is_marked(h, address)) marked.push(address); }
      else for (let i = 0; i < count; i++) marked.push(this.u32[reports + i]);
      x.gc_reports_clear(h);
      for (const address of marked) {
        const id = handles.idByAddress.get(address), f = id === undefined ? undefined : space.facades.get(id);
        if (f === undefined) continue;
        this.stats.companionScans++; scanner.scan(f); if (f.fieldExtra) scanner.scan(f.fieldExtra);
      }
      x.gc_drain(h);
    }
    const t1 = performance.now();
    x.gc_weak(h);
    const release = () => { const freed = this.r32(h + GC.freed) >>> 2, count = this.r32(h + GC.freedCount); for (let i = 0; i < count; i++) { const address = this.u32[freed + i]; space.release(address); this.exceptions.records.delete(address); } };
    while (x.gc_sweep(h)) { release(); x.gc_freed_clear(h); }
    release(); x.gc_freed_clear(h);
    for (const map of ephemeronMaps) for (const key of [...map.keys()]) if (typeof key === 'number' && !handles.addressById.has(key)) map.delete(key);   // the key died: so does the entry
    if (this.fixedTrigger !== undefined) this.w32(h + GC.trigger, this.fixedTrigger);
    const t2 = performance.now();
    this.stats.collections++; if (reason !== 'run') this.stats.hostCollections++; this.stats.markMs += t1 - t0; this.stats.sweepMs += t2 - t1;
    this.lastCollection = { reason, live: this.r32(h + GC.liveObjects), freed: this.r32(h + GC.freedObjects), badRefs: this.r32(h + GC.badRefs), roots: addresses.size, markMs: t1 - t0, sweepMs: t2 - t1 };
    return this.lastCollection;
  }
  // ---- inspection (src/plugin-queries.js): what the JavaScript VM's tables answer for a read-only query -- the state of a class, a static without running <clinit>, every reference
  //      static, and a walk of the heap -- read from the core's memory. Nothing here runs bytecode or initializes a class.
  /** 'initialized' | 'initializing' | 'not-initialized': a class the core has not laid out yet was never used, so it is not initialized. */
  classStatus(type) {
    const info = this.linker.classes.get(type); if (info === undefined || !info.address) return 'not-initialized';
    const state = this.r32(info.address + CLASS.initState); return state === INITIALIZED ? 'initialized' : state === 0 ? 'not-initialized' : 'initializing';
  }
  /** The value of a static a DEX class declares, as hosts see values ({ ref }, number, BigInt), without initializing anything; undefined when the class has no storage yet or the field is host-modelled. */
  peekStatic(reference) {
    const info = this.linker.classes.get(reference.owner), field = info?.statics?.get(reference.name + ':' + reference.type); if (!field) return undefined;
    const kind = kindOf(field.type), view = this.view; if (kind === 'W') return view.getBigInt64(field.address, true);
    const word = view.getInt32(field.address, true); return kind === 'L' ? this.refValue(word >>> 0) : word;
  }
  /** [key, { ref }] of every reference static of the laid-out DEX classes that holds an object. */
  *referenceStatics() {
    for (const info of this.linker.classList) {
      if (!info.statics || !info.cls) continue;
      for (const field of info.statics.values()) { if (kindOf(field.type) !== 'L') continue; const word = this.view.getUint32(field.address, true); if (word !== 0) yield [field.key, this.refValue(word)]; }
    }
  }
  /**
   * Walks the objects of the heap in address order from `after` (exclusive; 0 = the start): visit(address, type) -> false to stop. Returns the address it stopped at, or null at
   * the end. Like a scan of the JavaScript VM's heap it also meets objects that are unreachable and not collected yet. The start bitmap (gc.h: one bit per 8 bytes) says where
   * objects begin; a word whose class record is not one the linker laid out is not an object a host can see (a filler of a retired allocation buffer).
   */
  walkHeap(after, visit) {
    const x = this.x, h = this.h, u32 = this.u32; x.gc_retire_buffers(h);
    const base = this.r32(h + GC.base), end = this.r32(h + GC.end), bits = this.r32(h + GC.startBits) >>> 2, granules = (end - base) >>> 3;
    let types = this.classTypes; if (types === undefined || this.classTypesFor !== this.linker.classList.length) { types = this.classTypes = new Map(); for (const info of this.linker.classList) types.set(info.address, info.type); this.classTypesFor = this.linker.classList.length; }
    const first = after >= base && after < end ? ((after - base) >>> 3) + 1 : 0;
    for (let w = first >>> 5, words = (granules + 31) >>> 5; w < words; w++) {
      let word = u32[bits + w]; if (word === 0) continue;
      if (w === first >>> 5) word &= (0xffffffff << (first & 31)) >>> 0;
      while (word !== 0) {
        const low = word & -word, bit = 31 - Math.clz32(low); word = (word & ~low) >>> 0;
        const address = base + (((w << 5) + bit) << 3), type = types.get(u32[address >>> 2]); if (type === undefined) continue;
        if (visit(address, type) === false) return address;
      }
    }
    return null;
  }
  /** The record (facade) of the object at `address`, as runtime.object() gives it. */
  recordAt(address) { return this.space.objectAt(address); }
  /** The core's heap for reports: its size in bytes, what the last collection left alive, how many collections ran, and how many objects the hosts hold a handle of. */
  memoryInfo() { const h = this.h, LAYOUT = this.layout; return { threadCapacity: LAYOUT.GUEST_COUNT, metaBytes: this.linker.top - LAYOUT.META, metaCapacity: LAYOUT.META_END - LAYOUT.META, classes: this.linker.classList.length, methods: this.linker.methodList.length, threadRecords: this.threads?.nextGuest ?? 0, threadRecordsFree: this.threads?.free.length ?? 0, heapBytes: this.r32(h + GC.end) - this.r32(h + GC.base), liveBytes: this.stats.collections ? this.r32(h + GC.liveBytes) : null, liveObjects: this.stats.collections ? this.r32(h + GC.liveObjects) : null, collections: this.stats.collections, handles: Number(this.runtime.heap?.size ?? 0) }; }
  /** Drops the pins of top-level host code (between top-level calls of a test or a driver that keeps nothing in JavaScript locals). */
  unpinTopLevel() { if (this.hostDepth === 0) this.pins.length = 0; }
  /** 0, or the number of the first broken heap invariant (gc_verify). */
  verify() { this.x.gc_retire_buffers(this.h); return this.x.gc_verify(this.h); }
}

const sameWords = (a, b) => a.length === b.length && a.every((v, i) => v === b[i] || (v !== null && b[i] !== null && typeof v === 'object' && typeof b[i] === 'object' && v.ref === b[i].ref));

/**
 * The facade of a box record (natives.h: the value at +8 and a state word): `boxed` reads and writes the payload, so what a host stores the box natives read and what a native
 * made a host reads. A value the payload cannot hold as the JavaScript VM holds it (not an int for a narrow kind, not a 64-bit BigInt for long and double) stays on the facade
 * (state 2: the natives defer to the bridge). `primitiveType` is the box's kind letter once it has a value, unless a host set it.
 */
const boxFacades = new Map();
function boxFacade(letter, property = 'boxed') {
  const key = letter + property; let facade = boxFacades.get(key); if (facade !== undefined) return facade;
  const wide = letter === 'J' || letter === 'D', stateAt = wide ? 16 : 12;
  facade = class BoxFacade extends ObjectFacade {
    #fallback = undefined; #primitiveType = undefined;
    #read() {
      const space = this.space, at = this.address, state = space.u32[(at + stateAt) >> 2];
      return state === 1 ? (wide ? space.i64[(at + 8) >> 3] : space.i32[(at + 8) >> 2]) : state === 2 ? this.#fallback : undefined;
    }
    #write(value) {
      const space = this.space, at = this.address;
      if (value === undefined) { space.u32[(at + stateAt) >> 2] = 0; this.#fallback = undefined; return; }
      if (wide ? typeof value === 'bigint' && BigInt.asIntN(64, value) === value : typeof value === 'number' && (value | 0) === value && !Object.is(value, -0)) {
        if (wide) space.i64[(at + 8) >> 3] = value; else space.i32[(at + 8) >> 2] = value;
        space.u32[(at + stateAt) >> 2] = 1; this.#fallback = undefined;
      } else { this.#fallback = value; space.u32[(at + stateAt) >> 2] = 2; }
    }
    static {   // the payload under the host's own name (`boxed`, `atomicValue`); a box's `primitiveType` is its kind letter once it has a value, unless a host set it
      Object.defineProperty(this.prototype, property, { get() { return this.#read(); }, set(value) { this.#write(value); }, configurable: true });
      if (property === 'boxed') Object.defineProperty(this.prototype, 'primitiveType', {
        get() { return this.#primitiveType !== undefined ? this.#primitiveType : this.space.u32[(this.address + stateAt) >> 2] !== 0 ? letter : undefined; },
        set(value) { this.#primitiveType = value; }, configurable: true });
    }
  };
  boxFacades.set(key, facade); return facade;
}

/** Class layouts for the record facades, made from the linker's records on first use (a Map whose get() lays the layout out). */
class LazyLayouts extends Map {
  constructor(engine) { super(); this.engine = engine; this.byAddress = new Map(); }
  get(address) {
    const known = super.get(address); if (known !== undefined) return known;
    const linker = this.engine.linker;
    if (this.byAddress.size !== linker.classList.length) for (const info of linker.classList) this.byAddress.set(info.address, info);
    const info = this.byAddress.get(address); if (info === undefined) return undefined;
    const fields = [];
    for (let c = info; c; c = c.superInfo) if (!c.isInterface) for (const field of c.fields.values()) fields.push({ key: field.key, offset: field.offset, type: field.type });
    const layout = this.engine.space.registerClass(address, { type: info.facadeType ?? info.type, fields });
    if (info.type === CLASS_TYPE) layout.onCreate = facade => { facade.classType = this.typeAt(this.engine.r32(facade.address + CLASS_OBJECT_CLASS)); };
    if (info.boxKind !== undefined) layout.facadeClass = boxFacade(BOX_LETTERS[info.boxKind]);
    else if (info.memoryProperty === 'atomicValue') layout.facadeClass = boxFacade('I', 'atomicValue');
    return layout;
  }
  /** The descriptor of the class whose Class record is at `address`. */
  typeAt(address) {
    const linker = this.engine.linker;
    if (this.byAddress.size !== linker.classList.length) for (const info of linker.classList) this.byAddress.set(info.address, info);
    return this.byAddress.get(address)?.type;
  }
}
