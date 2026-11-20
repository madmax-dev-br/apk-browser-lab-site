// System.loadLibrary / System.load for the app's own arm64-v8a libraries (docs/ARM64-NATIVE.md): when the ARM64 interpreter option is on and the APK (with its
// splits) has lib/arm64-v8a/<name>, the library is loaded into the app's ARM64 native process (src/arm64/process.js), its JNI_OnLoad runs, and its native methods
// bind through the JNI bridge (src/jni-host.js) like the lab's WebAssembly libraries. A library the APK does not have keeps the genuine UnsatisfiedLinkError.
import { JniBridge, NativeLibraryProvider } from '../jni-host.js?v=bcd37ec74124';
import { Arm64Process } from './process.js?v=bcd37ec74124';
import { createLibc } from './libc.js?v=bcd37ec74124';
import { attachArm64Jni } from './jni.js?v=bcd37ec74124';
import { BUILD_PROPS, buildProperty } from '../build-properties.js?v=bcd37ec74124';

const VERSIONS = new Set([0x10001, 0x10002, 0x10004, 0x10006, 0x10008]);
export const ARM64_LIB_DIR = 'lib/arm64-v8a/';

export function createArm64Native(runtime) {
  let process = null, lib = null;
  const entries = runtime.apkEntries ?? new Set();
  const written = new Map();   // libraries System.load'ed from a file the app wrote (an unpacked or downloaded .so), by soname
  const has = soname => entries.has(ARM64_LIB_DIR + soname) || written.has(soname);
  const fileElf = path => { try { const fs = runtime.platform?.javaIo?.fs?.(), bytes = fs?.bytes?.(path); return bytes && bytes.length > 64 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46 && bytes[18] === 183 ? bytes : null; } catch { return null; } };
  const ensure = () => {
    if (process) return process;
    // the device's system properties: the table Java's SystemProperties reads (src/framework-provider.js), so native and Java code see the same device
    const table = () => runtime.nativeBindings?.systemProperties ?? null;
    const properties = Object.assign(name => {
      const t = table(); if (t?.has(name)) { const value = String(t.get(name)); runtime.record(`PROPERTY ${name}=${value} [native]`); return value; }
      try { const value = buildProperty(runtime, name); if (value !== null) { runtime.record(`PROPERTY ${name}=${value} [native, from Build]`); return value; } } catch { /* Build not readable yet */ }
      try { return runtime.platform?.systemProperty?.(name) ?? null; } catch { return null; }
    }, { names: () => [...new Set([...(table()?.keys() ?? []), ...BUILD_PROPS.map(([name]) => name)])] });
    process = new Arm64Process({
      readLibrary: soname => written.get(soname) ?? (entries.has(ARM64_LIB_DIR + soname) ? runtime.apkReader(ARM64_LIB_DIR + soname) : null),
      host: createLibc({ runtime, properties, fs: () => runtime.platform?.javaIo?.fs?.() ?? null, clock: () => runtime.platform?.clock?.now?.() ?? Date.now(),
        assets: { read: name => entries.has('assets/' + name) ? runtime.apkReader('assets/' + name) : null, list: dir => [...new Set([...entries].filter(e => e.startsWith(`assets/${dir ? dir + '/' : ''}`) && !e.slice(`assets/${dir ? dir + '/' : ''}`.length).includes('/')).map(e => e.slice(e.lastIndexOf('/') + 1)))] } }),
      log: line => runtime.record(line),
      pid: runtime.platform?.virtualProcess?.pid ?? 4321,
      queueTask: runtime.platform?.queueTask ? (fn, delay) => runtime.platform.queueTask(fn, delay, []) : null,
    });
    process.threads.javaThreadName = () => runtime.thread?.name ?? 'main';
    process.threads.javaMain = () => runtime.scheduler?.main ?? null;
    runtime.nativeOwnsFd = fd => !!process.hostLibrary.__ownsFd?.(fd);   // a descriptor native code created and handed to Java (a pipe, socket or file of the ARM64 process)   // names the Java thread in native wait reports (every Java thread calls native code as the process's main thread)
    runtime.jni ??= new JniBridge(runtime, new NativeLibraryProvider(), runtime.platform);
    lib = attachArm64Jni(process, runtime.jni);
    runtime.jni.libraries.set('<arm64-v8a>', lib);
    return process;
  };
  let mounted = false;
  runtime.record?.('DEVICE ARM64 native code: on (the app\'s arm64-v8a libraries run in the lab\'s interpreter, src/arm64/)');
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
    /** System.loadLibrary(name) (`kind` 'loadLibrary') or System.load(path): true when the APK has the library and it loaded; false leaves the genuine failure. */
    load(kind, text) {
      const soname = kind === 'load' ? text.slice(text.lastIndexOf('/') + 1) : `lib${text}.so`;
      if (kind === 'load' && !entries.has(ARM64_LIB_DIR + soname) && !written.has(soname)) { const bytes = fileElf(text); if (bytes) written.set(soname, bytes); }   // an AArch64 ELF file at that path
      if (!has(soname)) return false;
      const proc = ensure(), already = proc.libraries.has(soname);
      let loaded;
      try { loaded = proc.load(soname, { via: kind === 'load' ? 'System.load' : 'System.loadLibrary' }); }
      catch (error) { if (error?.details?.kind === 'arm64-dlopen') runtime.throwJava('Ljava/lang/UnsatisfiedLinkError;', `dlopen failed: ${error.message}`); throw error; }
      if (already) return true;
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
