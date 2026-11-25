// The app's ARM64 native process (docs/ARM64-NATIVE.md): one address space (src/arm64/memory.js), one interpreter (src/arm64/cpu.js), the libraries the app
// loads from its own lib/arm64-v8a/ directory (mapped and relocated by src/arm64/elf.js), and the system libraries Android provides (libc, libm, libdl, liblog,
// libandroid ...) as host functions (src/arm64/libc.js). Layout: the address space is the fixed window ARM64_WINDOW of the 64-bit space (src/unsafe-native.js),
// disjoint from the wasm32 libraries' memory and the lab's other native ranges; libraries and mmap regions grow from 16 MiB into it, the heap is malloc's own region,
// the main thread's stack is 1 MiB with its TLS block (bionic's slots: TLS_SLOT_STACK_GUARD at tp+40) above it. Native threads: src/arm64/threads.js.
import { APKError } from '../apk-error.js?v=803d82a8b127';
import { Arm64Cpu, HOST_BASE, BLOCKED } from './cpu.js?v=803d82a8b127';
import { Arm64Memory } from './memory.js?v=803d82a8b127';
import { parseElf, mapLibrary, relocate, initializers, R } from './elf.js?v=803d82a8b127';
import { NativeThreads } from './threads.js?v=803d82a8b127';
import { ARM64_WINDOW } from '../unsafe-native.js?v=803d82a8b127';
import { APP_PID } from '../virtual-pids.js?v=803d82a8b127';

export const ARM64_BASE = Number(ARM64_WINDOW);
const HOST_STUBS = 65536, STUB_BYTES = 32;   // lab functions with a code stub (2 MiB of the address space); any beyond would be bare HOST_BASE addresses   // the process's lowest address (its first page stays unmapped, as NULL's)

const SYSTEM_LIBRARIES = new Set(['libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so', 'libz.so', 'libjnigraphics.so', 'libEGL.so', 'libGLESv1_CM.so', 'libGLESv2.so', 'libGLESv3.so', 'libOpenSLES.so', 'libmediandk.so', 'libvulkan.so', 'libnativewindow.so', 'libstdc++.so', 'libsync.so', 'libaaudio.so', 'libcamera2ndk.so', 'libbinder_ndk.so', 'libneuralnetworks.so', 'libicu.so', 'libamidi.so']);

export class Arm64Process {
  // `translate`: the translation tier (src/arm64/translate.js) for hot code; false runs every instruction in the interpreter
  // `maxSteps`: the runaway guard of a native call made synchronously from Java (src/arm64/cpu.js runaway): the instructions it may run without returning when nothing else
  // can stop it. Native threads and the parkable native calls of Java threads are preempted instead and never counted against it; a wall-clock limit that watches
  // the run (`watched()`: the operation monitor, src/arm64/glue.js) replaces it. 5e10: libraries that unpack or decompress their own code at startup run several
  // billion in one call (one measured startup: 22e9 over four decompression threads, 5.5e9 each).
  constructor({ readLibrary, host = {}, maxSteps = 5e10, log = () => {}, pid = APP_PID, queueTask = null, progress = undefined, watched = undefined, translate = true, now = undefined } = {}) {
    this.memory = new Arm64Memory(64 * 1024 * 1024, { base: ARM64_BASE, translate });
    this.cpu = new Arm64Cpu(this.memory, { host: (cpu, index) => this.dispatchHost(cpu, index), maxSteps });
    this.cpu.progress = progress;   // (cpu) every 2^20 instructions of any thread (src/arm64/glue.js: the operation monitor's heartbeat)
    this.cpu.watched = watched;   // () => true while a wall-clock limit watches a synchronous native call (src/arm64/glue.js: the operation monitor)
    this.cpu.threadLabel = () => { const t = this.threads?.current; return t ? `native thread ${t.tid}${t.main ? ', the main thread' : t.java ? `, Java thread "${t.name ?? '?'}"` : ''}` : null; };
    this.cpu.describe = address => { if (address >= HOST_BASE) { const name = this.hostNames[Math.floor((address - HOST_BASE) / 16)]; return name ? `the lab's ${name}` : null; } const stub = this.stubIndex(address); if (stub >= 0) return `the lab's ${this.hostNames[stub]} (its stub +0x${((address - this.stubs.base) % STUB_BYTES).toString(16)})`; const lib = this.libraryAt(address); return lib ? `${lib.name}+0x${(address - lib.base).toString(16)}` : null; };
    this.memory.cpu = this.cpu; this.memory.activeCpu = () => this.activeCpu; this.memory.recentCalls = () => { const out = []; for (let i = 1; i <= 8; i++) { const index = this.recentHost[(this.recentAt - i) & 7]; if (index !== null && index !== undefined) out.push(index === 'svc' ? 'svc' : this.hostNames[index]); } return out.reverse(); };   // a fault names the instruction of the thread that is running
    this.readLibrary = readLibrary;   // soname -> Uint8Array of the app's library, or null
    this.log = log;
    this.hostFns = []; this.hostIndex = new Map(); this.hostNames = []; this.recentHost = new Array(8).fill(null); this.recentAt = 0;
    this.libraries = new Map(); this.order = [];
    this.nextMap = ARM64_BASE + 0x01000000;
    this.heap = { free: new Map(), sizes: new Map() };
    this.atexit = []; this.tlsModules = []; this.tlsSize = 0;
    // the main thread: stack and TLS
    this.regions = [];
    const stackSize = 1024 * 1024, stack = this.mapRegion(stackSize + 0x10000, 0x10000, '[stack]');
    this.cpu.sp = stack + stackSize; this.tlsBase = stack + stackSize; this.mainStack = { base: stack, size: stackSize };   // TLS area above the stack top
    this.tp = this.tlsBase + 0x100;   // thread pointer: bionic's TLS slots start here; static TLS blocks follow at tp+16 (variant 1)
    this.memory.write64(this.tp + 40, 0x2b992ddfa23249d6n);   // TLS_SLOT_STACK_GUARD (__stack_chk_guard)
    this.cpu.tpidr = BigInt(this.tp);
    this.errnoAddressMain = this.tlsBase + 0x10; this.pid = pid; this.activeCpu = this.cpu;
    this.hostLibrary = host;   // name -> (process, cpu) => result
    this.threads = new NativeThreads(this, { queueTask, log, ...(now ? { now } : {}) });   // `now`: the monotonic clock of every native wait (the VM clock, src/vm-clock.js)
  }
  /** errno of the native thread that is running */
  get errnoAddress() { return this.threads?.current.errno ?? this.errnoAddressMain; }
  /** A new thread's TLS block at `tp`: the stack guard and every static TLS module's initial image (src/arm64/threads.js). */
  initThreadTls(tp) { this.memory.fill(tp - 0x100, 0, 0xf000); this.memory.write64(tp + 40, this.memory.read64(this.tp + 40)); for (const lib of this.order) if (lib.tls) this.memory.copyIn(tp + lib.tls.offset, lib.tls.image); }
  // ---- address space
  // `name` is what /proc/self/maps calls the mapping (src/arm64/procfs.js): '' for an anonymous one, '[anon:...]' for a named one, null for a library (listed by its segments)
  mapRegion(size, align = 0x1000, name = '', perms = 'rw-p') {
    let at = Math.ceil(this.nextMap / align) * align; const end = at + Math.ceil(size / 0x1000) * 0x1000;
    this.memory.ensure(end + 0x10000); this.nextMap = end;   // the address space only grows: a new region was never written, so it is already zero (and untouched pages stay unbacked)
    if (name !== null) this.noteRegion(at, end, name, perms);
    return at;
  }
  /**
   * mmap's placement of a new mapping: without MAP_FIXED / MAP_FIXED_NOREPLACE a fresh region of the address space (the address argument is a hint, which Linux may ignore too);
   * with them the mapping is at that address, as the kernel places it: the range must be page-aligned and in the process's address space, the pages it covers are replaced
   * (zero-filled, their decoded code dropped, /proc/self/maps updated), and MAP_FIXED_NOREPLACE refuses a range that overlaps a mapping (EEXIST). A runtime that reserves a large
   * PROT_NONE range and commits pieces of it at fixed addresses (a garbage collector's aligned heap segments) gets exactly those addresses. -> the address, or -errno.
   */
  placeMapping(address, length, flags, name = '', perms = 'rw-p') {
    const FIXED = 0x10, FIXED_NOREPLACE = 0x100000, EINVAL = 22, ENOMEM = 12, EEXIST = 17;
    if (!(flags & (FIXED | FIXED_NOREPLACE))) return this.mapRegion(length, 0x1000, name, perms);
    if (address % 0x1000 || length <= 0) return -EINVAL;
    const end = address + Math.ceil(length / 0x1000) * 0x1000;
    if (address < ARM64_BASE + 0x1000 || end > ARM64_BASE + this.memory.maxBytes) return -ENOMEM;
    if (!(flags & FIXED) && this.overlapsMapping(address, end)) return -EEXIST;
    this.memory.ensure(end + 0x10000);
    // a PROT_NONE mapping (a runtime decommitting part of its reservation) is zeroed when mprotect or a later fixed mapping makes it accessible (protectRegion): a decommit
    // of a large range does not touch its pages
    this.unmapRegion(address, end - address);
    if (perms.slice(0, 3) !== '---') { this.memory.zero(address, end - address); if (name !== null) this.noteRegion(address, end, name, perms); }
    else { this.memory.invalidateCode?.(address, end - address); this.regions.push({ start: address, end, name: name ?? '', perms, zeroPending: true }); }
    if (end > this.nextMap) this.nextMap = end;   // the regions handed out later start above it
    return address;
  }
  /** Does any mapping (a library segment or a region) overlap [start, end)? */
  overlapsMapping(start, end) {
    for (const lib of this.order) if (lib.base < end && lib.end > start) return true;
    for (const r of this.regions) if (r.start < end && r.end > start) return true;
    return false;
  }
  /** The anonymous private pages of [start, start + length) read as zero again (MADV_DONTNEED on a private anonymous mapping, as Linux drops them); file pages keep their data. */
  discardPages(start, length) {
    const end = start + Math.ceil(length / 0x1000) * 0x1000;
    for (const r of this.regions) {
      if (r.end <= start || r.start >= end || !r.perms.endsWith('p') || (r.name && !r.name.startsWith('['))) continue;
      if (r.name === '[stack]') continue;
      const from = Math.max(start, r.start), to = Math.min(end, r.end); if (to > from) this.memory.zero(from, to - from);
    }
  }
  /** Records a mapping for /proc/self/maps, page-aligned; one that continues the previous mapping with the same name and protection extends it, as the kernel merges VMAs. */
  noteRegion(start, end, name = '', perms = 'rw-p') {
    start = Math.floor(start / 0x1000) * 0x1000; end = Math.ceil(end / 0x1000) * 0x1000;
    const last = this.regions.at(-1);
    if (last && last.end >= start && last.start <= start && last.name === name && last.perms === perms) { last.end = Math.max(last.end, end); return; }
    this.regions.push({ start, end, name, perms });
  }
  /** Is the page at `address` mapped (a library segment, a region of /proc/self/maps)? */
  isMapped(address) {
    for (const lib of this.order) if (address >= lib.base && address < lib.end) return true;
    for (const r of this.regions) if (address >= r.start && address < r.end) return true;
    return false;
  }
  /** mprotect: the protection of the mappings in the range changes (each split at the range's ends), as /proc/self/maps and /proc/self/statm show it; library segments keep their ELF flags. */
  protectRegion(start, length, prot) {
    start = Math.floor(start / 0x1000) * 0x1000; const end = start + Math.ceil(length / 0x1000) * 0x1000, out = [];
    const rwx = `${prot & 1 ? 'r' : '-'}${prot & 2 ? 'w' : '-'}${prot & 4 ? 'x' : '-'}`, accessible = rwx !== '---';
    for (const r of this.regions) {
      if (r.end <= start || r.start >= end) { out.push(r); continue; }
      if (r.start < start) out.push({ ...r, end: start });
      const piece = { ...r, start: Math.max(r.start, start), end: Math.min(r.end, end), perms: rwx + (r.perms[3] ?? 'p') };
      if (piece.zeroPending && accessible) { this.memory.zero(piece.start, piece.end - piece.start); delete piece.zeroPending; }
      out.push(piece);
      if (r.end > end) out.push({ ...r, start: end });
    }
    this.regions = out;
  }
  /** The page at `address`: null when unmapped, 'none' when its protection is PROT_NONE, 'accessible' otherwise (mincore). */
  pageState(address) {
    for (const lib of this.order) if (address >= lib.base && address < lib.end) return 'accessible';
    let state = null;
    for (const r of this.regions) if (address >= r.start && address < r.end) state = r.perms.slice(0, 3) === '---' ? 'none' : 'accessible';   // the last record of a page wins (a later mapping)
    return state;
  }
  /** munmap: the range leaves /proc/self/maps (the address space itself is never reused). */
  unmapRegion(start, length) {
    const end = start + Math.ceil(length / 0x1000) * 0x1000, out = [];
    for (const r of this.regions) { if (r.end <= start || r.start >= end) { out.push(r); continue; } if (r.start < start) out.push({ ...r, end: start }); if (r.end > end) out.push({ ...r, start: end }); }
    this.regions = out;
  }
  // malloc: size-class free lists over regions taken from the address space; 16-byte aligned, a 16-byte header holds the size
  malloc(size) {
    const need = Math.max(16, Math.ceil(Number(size) / 16) * 16), list = this.heap.free.get(need);
    let block = list?.pop();
    if (block === undefined) { const region = this.mapRegion(need + 16, 16, '[anon:libc_malloc]'); block = region + 16; this.memory.write64(region, BigInt(need)); }
    this.heap.sizes.set(block, need); return block;
  }
  free(ptr) { ptr = Number(ptr); if (!ptr) return; const size = this.heap.sizes.get(ptr); if (size === undefined) throw new APKError(`ARM64 native code: free() of 0x${ptr.toString(16)}, which malloc did not return (or freed twice)`, { kind: 'arm64-heap' }); this.heap.sizes.delete(ptr); (this.heap.free.get(size) ?? this.heap.free.set(size, []).get(size)).push(ptr); }
  usableSize(ptr) { return this.heap.sizes.get(Number(ptr)) ?? 0; }
  allocString(text) { const bytes = new TextEncoder().encode(text), ptr = this.malloc(bytes.length + 1); this.memory.copyIn(ptr, bytes); this.memory.setByte(ptr + bytes.length, 0); return ptr; }
  // ---- host entries
  // A lab function's address is a 32-byte stub of real code in the process memory, as a libc function is code on a device: MOVZ X16, #lo; MOVK X16, #mid, LSL #16;
  // MOVK X16, #hi, LSL #32; BR X16 (X16: the intra-procedure scratch register AAPCS64 gives veneers) to HOST_BASE + 16 * index, then four NOPs. Every instruction is
  // position-independent and there is no literal in it, so a hooking library that overwrites the first 16 or 20 bytes with its own branch and relocates them into a
  // trampoline gets a trampoline that still reaches the lab function (a literal-pool veneer was overwritten together with its literal, and the relocated load read the
  // hook's bytes). Reading the stub gives instructions; patching it redirects the calls.
  hostEntry(name, fn) {
    if (this.hostIndex.has(name)) return this.hostStub(this.hostIndex.get(name));
    const index = this.hostFns.length; this.hostFns.push(fn); this.hostIndex.set(name, index); this.hostNames.push(name);
    return this.hostStub(index);
  }
  hostStub(index) {
    if (index >= HOST_STUBS) return HOST_BASE + 16 * index;
    this.stubs ??= { base: this.mapRegion(STUB_BYTES * HOST_STUBS, 0x1000), written: new Set() };
    const at = this.stubs.base + STUB_BYTES * index, target = HOST_BASE + 16 * index, half = k => Math.floor(target / 2 ** (16 * k)) & 0xffff;
    if (!this.stubs.written.has(index)) {
      this.stubs.written.add(index);
      [0xd2800010 | (half(0) << 5), 0xf2a00010 | (half(1) << 5), 0xf2c00010 | (half(2) << 5), 0xd61f0200, 0xd503201f, 0xd503201f, 0xd503201f, 0xd503201f].forEach((word, i) => this.memory.writeU32(at + 4 * i, word >>> 0));
    }
    return at;
  }
  /** The lab function whose stub holds `address`, or -1. */
  stubIndex(address) { const s = this.stubs; if (!s || address < s.base || address >= s.base + STUB_BYTES * HOST_STUBS) return -1; const index = Math.floor((address - s.base) / STUB_BYTES); return s.written.has(index) ? index : -1; }
  dispatchHost(cpu, index) {
    this.recentHost[this.recentAt++ & 7] = index;   // the last lab functions native code called, for fault reports
    const fn = index === 'svc' ? this.hostLibrary.__svc : this.hostFns[index]; if (!fn) throw new APKError(`ARM64 native code branched to an unknown host entry ${index}`, { kind: 'arm64-host' });
    if (this.threads?.driving && index !== 'svc' && this.threads.leaveToJava(this.hostNames[index])) return BLOCKED;   // src/arm64/threads.js driveJava
    // A call that waits is retried with the registers it was made with: a lab function that moves its arguments (syscall(3) shifts them down one register, openat and
    // __fgets_chk drop one) before it blocks must not leave them moved, or the retry reads its number or pointers from the wrong registers.
    const x = cpu.x, a0 = x[0], a1 = x[1], a2 = x[2], a3 = x[3], a4 = x[4], a5 = x[5], a6 = x[6], a7 = x[7];
    const result = fn(this, cpu);
    if (result === BLOCKED) { x[0] = a0; x[1] = a1; x[2] = a2; x[3] = a3; x[4] = a4; x[5] = a5; x[6] = a6; x[7] = a7; return BLOCKED; }   // the thread waits: the call is retried when it runs again
    if (result === undefined) return;
    if (typeof result === 'object' && result !== null && 'double' in result) { cpu.setD(0, result.double); return; }
    if (typeof result === 'object' && result !== null && 'float' in result) { cpu.setS(0, result.float); return; }
    cpu.x[0] = BigInt.asUintN(64, BigInt(result));
  }
  missingSymbol(name, lib) {
    return this.hostEntry(`missing:${name}`, () => { throw new APKError(`ARM64 native code called ${name} (imported by ${lib.name}): the lab does not provide this function`, { kind: 'arm64-missing-symbol', symbol: name, library: lib.name }); });
  }
  resolve(name, requester) {
    for (const lib of [requester, ...this.order]) { const address = lib?.exports.get(name); if (address !== undefined) return address; }
    const data = this.hostLibrary.__data?.[name];
    if (data) { this.hostData ??= new Map(); if (!this.hostData.has(name)) this.hostData.set(name, data(this)); return this.hostData.get(name); }   // a libc data object, not a function
    const fn = this.hostLibrary[name];
    if (typeof fn === 'function') return this.hostEntry(name, fn);
    return null;
  }
  callResolver(address) { return Number(this.cpu.call(address, [0])); }
  noteTls(name) { this.tlsLibraries = [...(this.tlsLibraries ?? []), name]; }
  tlsRelocation(lib, type, where, symbol, addend) {
    const module = this.tlsModule(lib);
    if (!module) throw new APKError(`${lib.name}: TLS relocation without a PT_TLS segment`, { kind: 'arm64-elf' });
    const offset = BigInt(module.offset) + BigInt(symbol ? symbol.value - lib.base : 0) + addend;   // symbol.value was rebased; TLS symbol values are offsets in the module
    if (type === R.TLS_TPREL64) { this.memory.write64(where, offset); return; }
    if (type === R.TLSDESC) { this.memory.write64(where, BigInt(this.hostEntry('tlsdesc:static', (p, cpu) => p.memory.read64(Number(cpu.x[0]) + 8)))); this.memory.write64(where + 8, offset); return; }
    throw new APKError(`${lib.name}: dynamic TLS relocation type ${type} is not supported (static TLS only)`, { kind: 'arm64-elf' });
  }
  tlsModule(lib) {
    if (lib.tls !== undefined) return lib.tls;
    const segment = lib.elf.segments.find(s => s.type === 7); if (!segment) return (lib.tls = null);
    const align = Math.max(segment.align, 16); this.tlsSize = Math.ceil(this.tlsSize / align) * align;
    const offset = 16 + this.tlsSize; this.tlsSize += segment.memsz;
    if (offset + segment.memsz > 0xe000) throw new APKError(`static TLS exceeds the reserved area (${lib.name})`, { kind: 'arm64-elf' });
    const image = new Uint8Array(segment.memsz); image.set(lib.elf.bytes.subarray(segment.offset, segment.offset + segment.filesz));
    this.memory.copyIn(this.tp + offset, image); for (const t of this.threads?.threads.values() ?? []) if (!t.main) this.memory.copyIn(t.tp + offset, image);
    return (lib.tls = { offset, image });
  }
  // ---- libraries
  /** dlopen: the library and its DT_NEEDED closure (app libraries from the APK, system ones from the host), relocated and initialized once. */
  // `bytes`: the ELF image when the caller has it (dlopen of a path, android_dlopen_ext from a descriptor); otherwise readLibrary finds it by soname
  load(soname, { via = 'dlopen', bytes: given = null } = {}) {
    if (this.libraries.has(soname)) return this.libraries.get(soname);
    // bionic's find_loaded_library_by_soname: a DT_NEEDED or a dlopen by bare name is satisfied by a loaded library whose DT_SONAME it is, whatever file it came from
    // (an app that unpacks a library to <name>.so_<pid> and System.load()s it, then loads others that need <name>.so)
    { const loaded = !soname.includes('/') ? this.order.find(lib => lib.soname === soname) : null; if (loaded) return loaded; }
    if (SYSTEM_LIBRARIES.has(soname)) { const lib = { name: soname, soname, system: true, exports: new Map(), base: 0, end: 0 }; this.libraries.set(soname, lib); return lib; }
    const bytes = given ?? this.readLibrary(soname);
    if (!bytes) throw new APKError(`dlopen failed: library "${soname}" not found`, { kind: 'arm64-dlopen', soname });
    const lib = mapLibrary(this, parseElf(bytes), soname); lib.via = via; lib.path = this.libraryPath?.(soname) ?? soname;   // the file's path, as dladdr / dl_iterate_phdr report it
    this.libraries.set(soname, lib); this.order.push(lib);
    for (const needed of lib.needed) this.load(needed, { via: `DT_NEEDED of ${soname}` });
    relocate(this, lib, name => this.resolve(name, lib));
    this.log(`ARM64 loaded ${soname} at 0x${lib.base.toString(16)} (${bytes.length} bytes${lib.needed.length ? `, needs ${lib.needed.join(' ')}` : ''}${lib.unresolved.length ? `; ${lib.unresolved.length} imports the lab does not provide: ${lib.unresolved.slice(0, 8).join(' ')}${lib.unresolved.length > 8 ? ' ...' : ''}` : ''})`);
    for (const init of initializers(this, lib)) this.call(init, []);
    return lib;
  }
  symbol(lib, name) { return lib.exports.get(name) ?? null; }
  /** Address -> the library that contains it (dladdr, dl_iterate_phdr). */
  libraryAt(address) { return this.order.find(lib => address >= lib.base && address < lib.end) ?? null; }
  /** Calls native code on the thread that is running (the Java thread's native state, or the native thread whose slice made the call). */
  call(address, args = [], options) { return this.activeCpu.call(address, args, options); }
  futex(cpu, address, op, value, timeoutPtr = 0) { return this.threads.futex(cpu, address, op, value, timeoutPtr); }
}
