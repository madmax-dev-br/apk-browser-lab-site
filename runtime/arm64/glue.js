// System.loadLibrary / System.load for the app's own arm64-v8a libraries (docs/ARM64-NATIVE.md): when the ARM64 interpreter option is on and the APK (with its
// splits) has lib/arm64-v8a/<name>, the library is loaded into the app's ARM64 native process (src/arm64/process.js), its JNI_OnLoad runs, and its native methods
// bind through the JNI bridge (src/jni-host.js) like the lab's WebAssembly libraries. A library the APK does not have keeps the genuine UnsatisfiedLinkError.
import { JniBridge, NativeLibraryProvider } from '../jni-host.js?v=7233a7b1ab13';
import { Arm64Process } from './process.js?v=7233a7b1ab13';
import { tierSupported } from './translate.js?v=7233a7b1ab13';
import { createLibc } from './libc.js?v=7233a7b1ab13';
import { attachArm64Jni } from './jni.js?v=7233a7b1ab13';
import { ArtView } from './art-runtime.js?v=7233a7b1ab13';
import { registerNativeHeap, ARM64_WINDOW, ARM64_WINDOW_LIMIT } from '../unsafe-native.js?v=7233a7b1ab13';
import { installDirectBuffers } from '../direct-buffers.js?v=7233a7b1ab13';
import { APP_PID } from '../virtual-pids.js?v=7233a7b1ab13';
import { deviceProperty, devicePropertyNames } from '../device-identity.js?v=7233a7b1ab13';
import { BUCKET, inBucket } from '../time-breakdown.js?v=7233a7b1ab13';

const VERSIONS = new Set([0x10001, 0x10002, 0x10004, 0x10006, 0x10008]);
export const ARM64_LIB_DIR = 'lib/arm64-v8a/';

export function createArm64Native(runtime, { translate = true } = {}) {
  let process = null, lib = null;
  const entries = runtime.apkEntries ?? new Set();
  const javaLoaded = new Set();   // the libraries Java loaded (System.load / loadLibrary): their JNI_OnLoad ran
  const written = new Map(), writtenPaths = new Map();   // libraries System.load'ed from a file the app wrote (an unpacked or downloaded .so), by soname, and their paths
  const has = soname => entries.has(ARM64_LIB_DIR + soname) || written.has(soname);
  const isAarch64Elf = bytes => bytes.length > 64 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46 && bytes[18] === 183;
  const fileElf = path => { try { const fs = runtime.platform?.javaIo?.fs?.(), bytes = fs?.bytes?.(path); return bytes && isAarch64Elf(bytes) ? bytes : null; } catch { return null; } };
  const ensure = () => {
    if (process) return process;
    // the device's system properties: the table Java's SystemProperties reads (src/framework-provider.js, with the device identity of src/device-identity.js), so native and
    // Java code see the same device
    const properties = Object.assign(name => {
      const value = deviceProperty(runtime, name); if (value !== null) runtime.record(`PROPERTY ${name}=${value} [native]`); return value;
    }, { names: () => devicePropertyNames(runtime) });
    process = new Arm64Process({
      readLibrary: soname => written.get(soname) ?? (entries.has(ARM64_LIB_DIR + soname) ? runtime.apkReader(ARM64_LIB_DIR + soname) : null),
      // CLOCK_REALTIME (time, gettimeofday): the VM clock's wall time (milliseconds since the epoch); CLOCK_MONOTONIC and every native wait: the VM clock (`now` below)
      host: createLibc({ runtime, properties, fs: () => runtime.platform?.javaIo?.fs?.() ?? null, clock: () => runtime.platform?.clock?.wall?.() ?? Date.now(),
        assets: { read: name => entries.has('assets/' + name) ? runtime.apkReader('assets/' + name) : null, list: dir => [...new Set([...entries].filter(e => e.startsWith(`assets/${dir ? dir + '/' : ''}`) && !e.slice(`assets/${dir ? dir + '/' : ''}`.length).includes('/')).map(e => e.slice(e.lastIndexOf('/') + 1)))] } }),
      log: line => runtime.record(line),
      pid: runtime.platform?.virtualProcess?.pid ?? APP_PID, translate,
      progress: cpu => runtime.monitor?.nativeProgress?.(() => `ARM64 native code at ${cpu.where(cpu.pc)}`, { synchronous: (cpu.nested ?? 0) > 0 }),   // a long native run keeps the page's heartbeat alive, naming where it is
      watched: () => runtime.monitor?.watchesSynchronousNative?.() === true,   // a wall-clock limit watches a synchronous native call: the runaway guard stands aside (src/arm64/cpu.js)
      // the native threads' deadlines and timers read the VM clock, as Java's waits do: when the scheduler skips the clock to the next deadline (every thread waits), native
      // timeouts and sleeps move with it (on performance.now() they waited in real time while Java's time ran ahead, and the pump polled them all along)
      ...(runtime.platform?.clock ? { now: () => runtime.platform.clock.now() } : {}),
      queueTask: runtime.platform?.queueTask ? (fn, delay) => runtime.platform.queueTask(() => inBucket(runtime.tb, BUCKET.NATIVE, fn), delay, []) : null,   // the native threads' slices: the breakdown's native bucket
    });
    process.threads.javaThreadName = () => runtime.thread?.name ?? 'main';
    process.threads.javaMain = () => runtime.scheduler?.main ?? null;
    process.hostLibrary.__procfs?.attach(process);
    // the process's heap is the app's native memory: Unsafe.allocateMemory, ByteBuffer.allocateDirect and FileChannel.map take it from here (src/unsafe-native.js), so native code
    // and Java read and write one memory at one address
    registerNativeHeap(runtime, { kind: 'arm64', malloc: bytes => process.malloc(bytes), free: address => process.free(address), map: (bytes, name) => process.mapRegion(bytes, 0x1000, name),
      unmap: (address, bytes) => process.unmapRegion(address, bytes), owns: address => address >= Number(ARM64_WINDOW) && address < Number(ARM64_WINDOW_LIMIT) });   // the app's /proc (src/procfs.js) now has this process's maps, mem, threads and descriptors, for Java and native code alike
    runtime.nativeOwnsFd = fd => !!process.hostLibrary.__ownsFd?.(fd);   // a descriptor native code created and handed to Java (a pipe, socket or file of the ARM64 process)   // names the Java thread in native wait reports (every Java thread calls native code as the process's main thread)
    runtime.jni ??= new JniBridge(runtime, new NativeLibraryProvider(), runtime.platform);
    lib = attachArm64Jni(process, runtime.jni);
    // ART's records in the process (src/arm64/art-runtime.js): libart.so's image, ArtMethod / ArtField arrays, the DEX files; jmethodIDs and jfieldIDs are their addresses
    const debuggable = runtime.platform?.manifest?.application?.debuggable, art = new ArtView({ process, runtime, bridge: runtime.jni, debuggable: debuggable === true || debuggable === 'true' || (Number.isInteger(debuggable) && debuggable !== 0) });
    lib.art = art; lib.jniIds = art.jniIds;
    process.memory.explainAddress = address => art.explain(address);   // a fault near an ART structure says which one
    const classInitialized = runtime.onClassInitialized; runtime.onClassInitialized = type => { classInitialized?.(type); art.classInitialized(type); };
    // where the libraries are, as bionic's dladdr / dl_iterate_phdr report them: the app's native library directory, or the file System.load named
    const fs = runtime.platform?.javaIo?.fs?.();
    process.libraryPath = soname => writtenPaths.get(soname) ?? (fs ? `${fs.codePath}/lib/arm64/${soname}` : soname);
    runtime.jni.libraries.set('<arm64-v8a>', lib);
    return process;
  };
  let mounted = false;
  const hasArm64Libraries = [...entries].some(name => name.startsWith(ARM64_LIB_DIR) && name.endsWith('.so'));
  if (hasArm64Libraries) installDirectBuffers(runtime);   // allocateDirect: in the native process's memory (src/direct-buffers.js)
  runtime.record?.(`DEVICE ARM64 native code: on (the app's arm64-v8a libraries run in the lab's interpreter, src/arm64/; translation of hot code to WebAssembly ${translate ? (tierSupported() ? 'on' : 'unavailable in this engine') : 'off'}, src/arm64/translate.js)`);
  return {
    abi: 'arm64-v8a',
    has,
    /** The APK's arm64-v8a libraries as files of the app's native library directory (<codePath>/lib/arm64), where the package manager extracts them on a device. */
    mount() {
      if (mounted) return; const fs = runtime.platform?.javaIo?.fs?.(); if (!fs) return; mounted = true;
      const dir = `${fs.codePath}/lib/arm64`; fs.mkdirs(dir);
      for (const name of entries) if (name.startsWith(ARM64_LIB_DIR) && name.endsWith('.so')) fs.mount(`${dir}/${name.slice(ARM64_LIB_DIR.length)}`, runtime.apkReader(name));
      fs.readOnly?.add?.(`${fs.codePath}/lib`);
    },
    get process() { return process; },
    /** The native process, started now if the app has arm64-v8a libraries (Executable.artMethod is an address in it); null when it has none. */
    startProcess() { return process ?? (hasArm64Libraries ? ensure() : null); },
    /** System.loadLibrary(name) (`kind` 'loadLibrary') or System.load(path): true when the APK has the library and it loaded; false leaves the genuine failure. */
    load(kind, text, unlinked = null) {   // `unlinked`: the bytes of a file opened then unlinked, loaded through its /proc/self/fd link
      const soname = kind === 'load' ? text.slice(text.lastIndexOf('/') + 1) : `lib${text}.so`;
      if (kind === 'load' && !entries.has(ARM64_LIB_DIR + soname) && !written.has(soname)) { const bytes = unlinked && isAarch64Elf(unlinked) ? unlinked : fileElf(text); if (bytes) { written.set(soname, bytes); writtenPaths.set(soname, text); } }   // an AArch64 ELF file at that path
      if (!has(soname)) return false;
      // ART's JavaVMExt::LoadNativeLibrary: JNI_OnLoad runs the first time Java loads a library, also when the dynamic linker already loaded it as another library's DT_NEEDED
      // (dlopen then returns that handle): fbjni's JNI_OnLoad registers its own natives when Java loads "fbjni" after libreactnative pulled it in
      const proc = ensure(), already = javaLoaded.has(soname);
      let loaded;
      try { loaded = proc.load(soname, { via: kind === 'load' ? 'System.load' : 'System.loadLibrary' }); }
      catch (error) { if (error?.details?.kind === 'arm64-dlopen') runtime.throwJava('Ljava/lang/UnsatisfiedLinkError;', `dlopen failed: ${error.message}`); throw error; }
      if (already) return true;
      javaLoaded.add(soname);
      const onLoad = loaded.exports.get('JNI_OnLoad');
      runtime.record(`JNI loaded ${soname} (arm64-v8a, interpreted${onLoad ? ', JNI_OnLoad' : ''})`);
      if (onLoad) {
        const version = runtime.jni.enterNative(() => Number(BigInt.asIntN(32, proc.threads.asJavaThread(runtime.thread, () => proc.call(onLoad, [lib.vmPtr, 0])))));
        if (!VERSIONS.has(version)) runtime.throwJava('Ljava/lang/UnsatisfiedLinkError;', `JNI_ERR returned from JNI_OnLoad in "${soname}" (version 0x${(version >>> 0).toString(16)})`);
      }
      return true;
    },
  };
}
