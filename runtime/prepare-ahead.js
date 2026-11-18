// Prepare ahead (docs/FIRST-TAP-WARMUP.md): the first-time work of the WebAssembly core's linker that never runs Java code, done in the Worker's quiet moments instead of inside the
// first tap that needs it. Two halves:
//   firstUseProfile(runtime)   what this run has used so far: the DEX classes the linker laid out, in the order it did, and the methods whose code it linked (by class and
//                              name + signature). It is what a later run of the same APK can prepare (ART keeps the same kind of list: the classes and methods of a profile,
//                              from which it builds the app image whose classes are loaded when the app starts).
//   PrepareAhead               lays those classes out (vmcore/js/linker.js classOf: fields, method records, vtable, itable; the superclass and the interfaces come with it) and
//                              copies those methods' code (linkCode), in slices bounded by a deadline.
// What it does NOT do, on purpose: it never initializes a class (<clinit> runs when the app's code first uses the class, in the app's order, on the app's thread, as before),
// never resolves a constant (a constant is resolved when its instruction first runs, so a link error is still thrown at that instruction and a class defined later by another
// DEX is still seen) and never runs Java code. One thing of a layout does reach the Java heap: a String initial value of a static field is the interned record of its text,
// made by the core when the class is laid out (vmcore/js/linker.js intern), ahead or not; it is the record const-string of the same text gives, so its identity is what it
// would have been. A class or method the profile names that this APK does not have is skipped. A layout that fails stops the preparation for good, and the class stays failed
// in the linker (classOf throws the same error again): the app's own first use reports it, as it would have. Preparation also stops for good once the metaspace is
// `metaShare` full (half, by default) or the heap has less than `heapReserve` bytes of room: what the app itself uses later must never find either exhausted by classes
// prepared for nothing, and a layout must not fail ahead for want of room the app would have had after a collection. Only the WebAssembly core has a linker: on the
// JavaScript engine both halves answer null / do nothing.
// DOM-free, no process.*.

/** { classes: [descriptor...], methods: [[classIndex, 'name(signature)'], ...] } of what the core's linker has prepared so far, or null without the core. */
export function firstUseProfile(runtime) {
  const linker = runtime?.wasm?.linker; if (!linker) return null;
  const classes = [], index = new Map(), methods = [];
  for (const info of linker.classList) if (info.cls && info.type[0] === 'L') { index.set(info, classes.length); classes.push(info.type); }   // classes with DEX code; arrays and host classes come with their users
  for (const mi of linker.methodList) { if (!mi.pool || !mi.def?.code) continue; const at = index.get(mi.owner); if (at !== undefined && mi.owner.methods.get(mi.nameSig) === mi) methods.push([at, mi.nameSig]); }
  return { classes, methods };
}

export class PrepareAhead {
  /** `profile`: a firstUseProfile() of an earlier run of the same APK; `metaShare`: the share of the metaspace above which nothing more is prepared; `heapReserve`: the room in bytes the heap must have. */
  constructor(runtime, profile, { metaShare = 0.5, heapReserve = 8 << 20 } = {}) {
    this.metaShare = metaShare; this.heapReserve = heapReserve;
    this.linker = runtime?.wasm?.linker ?? null; this.runtime = runtime;
    this.classes = Array.isArray(profile?.classes) ? profile.classes : []; this.methods = Array.isArray(profile?.methods) ? profile.methods : [];
    this.classAt = 0; this.methodAt = 0;
    this.stats = { classes: 0, classesKnown: 0, classesSkipped: 0, classesFailed: 0, methods: 0, methodsSkipped: 0, slices: 0, ms: 0, metaBytes: 0, done: this.linker === null, stopped: null };
  }
  get done() { return this.stats.done; }
  /** Prepares until `deadline` (performance.now() ms) or the end of the profile; returns true when the profile is exhausted. */
  step(deadline) {
    const linker = this.linker, stats = this.stats; if (linker === null || stats.done) return true;
    const memory = this.runtime.wasm.memoryInfo();
    if (memory.metaBytes >= this.metaShare * memory.metaCapacity) { stats.done = true; stats.stopped = `metaspace ${Math.round(100 * memory.metaBytes / memory.metaCapacity)}% full`; return true; }
    if (memory.heapRoom < this.heapReserve) { stats.done = true; stats.stopped = `heap room ${Math.round(memory.heapRoom / 1024)} KiB`; return true; }
    const started = performance.now(), top = linker.top, savedError = linker.error, savedThread = linker.thread; stats.slices++;
    try {
      for (; this.classAt < this.classes.length; this.classAt++) {
        if ((this.classAt & 7) === 0 && performance.now() >= deadline) return false;
        const type = this.classes[this.classAt];
        if (typeof type !== 'string' || type[0] !== 'L') { stats.classesSkipped++; continue; }
        if (linker.classes.has(type)) { stats.classesKnown++; continue; }
        if (!this.runtime.classes.has(type)) { stats.classesSkipped++; continue; }   // not a class of this APK's DEX files (another build): nothing to prepare
        // a failed layout stays failed in the linker: the app's own first use reports the same error. Nothing more is prepared after one (it may be the room running out).
        try { linker.classOf(type); stats.classes++; } catch (error) { stats.classesFailed++; stats.done = true; stats.stopped = `layout of ${type} failed: ${String(error?.message ?? error).slice(0, 200)}`; return true; }
      }
      for (; this.methodAt < this.methods.length; this.methodAt++) {
        if ((this.methodAt & 15) === 0 && performance.now() >= deadline) return false;
        const entry = this.methods[this.methodAt], info = Array.isArray(entry) ? linker.classes.get(this.classes[entry[0]]) : undefined, mi = info?.methods?.get(entry[1]);
        if (!mi?.def?.code || mi.pool || info.failed !== null) { stats.methodsSkipped++; continue; }
        try { linker.linkCode(mi); if (mi.pool) stats.methods++; else stats.methodsSkipped++; } catch { stats.methodsSkipped++; }   // an unlinked method stays unlinked: its first call links it again and reports
      }
      stats.done = true; return true;
    } finally { linker.error = savedError; linker.thread = savedThread; stats.ms += performance.now() - started; stats.metaBytes += linker.top - top; }
  }
}
