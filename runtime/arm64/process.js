// The app's ARM64 native process (docs/ARM64-NATIVE.md): one address space (src/arm64/memory.js), one interpreter (src/arm64/cpu.js), the libraries the app
// loads from its own lib/arm64-v8a/ directory (mapped and relocated by src/arm64/elf.js), and the system libraries Android provides (libc, libm, libdl, liblog,
// libandroid ...) as host functions (src/arm64/libc.js). Layout: libraries and mmap regions grow from 0x01000000, the heap is malloc's own region, the main
// thread's stack is 1 MiB with its TLS block (bionic's slots: TLS_SLOT_STACK_GUARD at tp+40) above it. Native threads: src/arm64/threads.js.
import { APKError } from '../apk-error.js?v=c2aef97d559f';
import { Arm64Cpu, HOST_BASE, BLOCKED } from './cpu.js?v=c2aef97d559f';
import { Arm64Memory } from './memory.js?v=c2aef97d559f';
import { parseElf, mapLibrary, relocate, initializers, R } from './elf.js?v=c2aef97d559f';
import { NativeThreads } from './threads.js?v=c2aef97d559f';

const SYSTEM_LIBRARIES = new Set(['libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so', 'libz.so', 'libjnigraphics.so', 'libEGL.so', 'libGLESv1_CM.so', 'libGLESv2.so', 'libGLESv3.so', 'libOpenSLES.so', 'libmediandk.so', 'libvulkan.so', 'libnativewindow.so', 'libstdc++.so', 'libsync.so', 'libaaudio.so', 'libcamera2ndk.so', 'libbinder_ndk.so', 'libneuralnetworks.so', 'libicu.so', 'libamidi.so']);

export class Arm64Process {
  constructor({ readLibrary, host = {}, maxSteps = 4e9, log = () => {}, pid = 4321, queueTask = null } = {}) {
    this.memory = new Arm64Memory(64 * 1024 * 1024);
    this.cpu = new Arm64Cpu(this.memory, { host: (cpu, index) => this.dispatchHost(cpu, index), maxSteps });
    this.cpu.describe = address => { if (address >= HOST_BASE) { const name = this.hostNames[Math.floor((address - HOST_BASE) / 16)]; return name ? `the lab's ${name}` : null; } const lib = this.libraryAt(address); return lib ? `${lib.name}+0x${(address - lib.base).toString(16)}` : null; };
    this.memory.cpu = this.cpu; this.memory.activeCpu = () => this.activeCpu; this.memory.recentCalls = () => { const out = []; for (let i = 1; i <= 8; i++) { const index = this.recentHost[(this.recentAt - i) & 7]; if (index !== null && index !== undefined) out.push(index === 'svc' ? 'svc' : this.hostNames[index]); } return out.reverse(); };   // a fault names the instruction of the thread that is running
    this.readLibrary = readLibrary;   // soname -> Uint8Array of the app's library, or null
    this.log = log;
    this.hostFns = []; this.hostIndex = new Map(); this.hostNames = []; this.recentHost = new Array(8).fill(null); this.recentAt = 0;
    this.libraries = new Map(); this.order = [];
    this.nextMap = 0x01000000;
    this.heap = { free: new Map(), sizes: new Map() };
    this.atexit = []; this.tlsModules = []; this.tlsSize = 0;
    // the main thread: stack and TLS
    const stackSize = 1024 * 1024, stack = this.mapRegion(stackSize + 0x10000, 0x10000);
    this.cpu.sp = stack + stackSize; this.tlsBase = stack + stackSize;   // TLS area above the stack top
    this.tp = this.tlsBase + 0x100;   // thread pointer: bionic's TLS slots start here; static TLS blocks follow at tp+16 (variant 1)
    this.memory.write64(this.tp + 40, 0x2b992ddfa23249d6n);   // TLS_SLOT_STACK_GUARD (__stack_chk_guard)
    this.cpu.tpidr = BigInt(this.tp);
    this.errnoAddressMain = this.tlsBase + 0x10; this.pid = pid; this.activeCpu = this.cpu;
    this.hostLibrary = host;   // name -> (process, cpu) => result
    this.threads = new NativeThreads(this, { queueTask, log });
  }
  /** errno of the native thread that is running */
  get errnoAddress() { return this.threads?.current.errno ?? this.errnoAddressMain; }
  /** A new thread's TLS block at `tp`: the stack guard and every static TLS module's initial image (src/arm64/threads.js). */
  initThreadTls(tp) { this.memory.fill(tp - 0x100, 0, 0xf000); this.memory.write64(tp + 40, this.memory.read64(this.tp + 40)); for (const lib of this.order) if (lib.tls) this.memory.copyIn(tp + lib.tls.offset, lib.tls.image); }
  // ---- address space
  mapRegion(size, align = 0x1000) {
    let at = Math.ceil(this.nextMap / align) * align; const end = at + Math.ceil(size / 0x1000) * 0x1000;
    this.memory.ensure(end + 0x10000); this.nextMap = end;   // the address space only grows: a new region was never written, so it is already zero (and untouched pages stay unbacked)
    return at;
  }
  // malloc: size-class free lists over regions taken from the address space; 16-byte aligned, a 16-byte header holds the size
  malloc(size) {
    const need = Math.max(16, Math.ceil(Number(size) / 16) * 16), list = this.heap.free.get(need);
    let block = list?.pop();
    if (block === undefined) { const region = this.mapRegion(need + 16, 16); block = region + 16; this.memory.write64(region, BigInt(need)); }
    this.heap.sizes.set(block, need); return block;
  }
  free(ptr) { ptr = Number(ptr); if (!ptr) return; const size = this.heap.sizes.get(ptr); if (size === undefined) throw new APKError(`ARM64 native code: free() of 0x${ptr.toString(16)}, which malloc did not return (or freed twice)`, { kind: 'arm64-heap' }); this.heap.sizes.delete(ptr); (this.heap.free.get(size) ?? this.heap.free.set(size, []).get(size)).push(ptr); }
  usableSize(ptr) { return this.heap.sizes.get(Number(ptr)) ?? 0; }
  allocString(text) { const bytes = new TextEncoder().encode(text), ptr = this.malloc(bytes.length + 1); this.memory.copyIn(ptr, bytes); this.memory.u8[ptr + bytes.length] = 0; return ptr; }
  // ---- host entries
  hostEntry(name, fn) {
    if (this.hostIndex.has(name)) return HOST_BASE + 16 * this.hostIndex.get(name);
    const index = this.hostFns.length; this.hostFns.push(fn); this.hostIndex.set(name, index); this.hostNames.push(name);
    return HOST_BASE + 16 * index;
  }
  dispatchHost(cpu, index) {
    this.recentHost[this.recentAt++ & 7] = index;   // the last lab functions native code called, for fault reports
    const fn = index === 'svc' ? this.hostLibrary.__svc : this.hostFns[index]; if (!fn) throw new APKError(`ARM64 native code branched to an unknown host entry ${index}`, { kind: 'arm64-host' });
    const result = fn(this, cpu);
    if (result === BLOCKED) return BLOCKED;   // the thread waits: the call is retried when it runs again
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
  load(soname, { via = 'dlopen' } = {}) {
    if (this.libraries.has(soname)) return this.libraries.get(soname);
    if (SYSTEM_LIBRARIES.has(soname)) { const lib = { name: soname, soname, system: true, exports: new Map(), base: 0, end: 0 }; this.libraries.set(soname, lib); return lib; }
    const bytes = this.readLibrary(soname);
    if (!bytes) throw new APKError(`dlopen failed: library "${soname}" not found`, { kind: 'arm64-dlopen', soname });
    const lib = mapLibrary(this, parseElf(bytes), soname); lib.via = via;
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
