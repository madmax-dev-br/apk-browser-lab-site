import { createHostRegistry } from './host-contract.js?v=9b98a94b8ae7';
import { APKError } from './apk-error.js?v=9b98a94b8ae7';
import { VirtualFileSystem, normalizePath } from './virtual-fs.js?v=9b98a94b8ae7';

// The app's virtual filesystem owner and the little java.io glue the platform still needs. java.io itself (File, the byte/char streams, FileDescriptor, RandomAccessFile,
// UnixFileSystem) is the original Android 13 libcore in framework.dex; its syscalls land in src/libcore-io-native.js over the VirtualFileSystem created here.
// What remains as a contract host is java.net.URL (jar:/file: entries only; java.net is not part of the libcore port), plus helpers that build original java.io objects
// from platform code (a File for a path, a ByteArrayInputStream over APK bytes).

const FILE = 'Ljava/io/File;', FIS = 'Ljava/io/FileInputStream;', IS = 'Ljava/io/InputStream;', BAIS = 'Ljava/io/ByteArrayInputStream;', URL = 'Ljava/net/URL;';
const STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;';

export function createJavaIoHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  let vfs = null;
  const fs = () => {
    if (vfs) return vfs;
    vfs = new VirtualFileSystem({ packageName: platform.packageName ?? 'app' });
    if (platform.apkBytes) vfs.mount(`${vfs.codePath}/base.apk`, platform.apkBytes); // the installed package, as PackageManager's sourceDir
    return vfs;
  };
  const text = (runtime, value) => { if (value === null || value === 0) runtime.throwJava('Ljava/lang/NullPointerException;', null); return runtime.stringCharacters(value); };
  /** Constructs an original framework object through one of its constructors, the way `new` does in bytecode. */
  const construct = (runtime, owner, parameters, args) => {
    const reference = runtime.allocate(owner);
    runtime.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, [reference, ...args], 'direct');
    return reference;
  };
  const makeFile = (runtime, path) => construct(runtime, FILE, [STRING], [path]);
  const byteStream = (runtime, bytes) => {
    const array = runtime.newArray('[B', bytes.length); runtime.array(array).elements = Array.from(bytes, v => (v << 24) >> 24);
    return construct(runtime, BAIS, ['[B'], [array]);
  };

  // An APK entry as an InputStream. Small entries are a ByteArrayInputStream; a large one (the 23 MB Hermes bundle of a React Native app) is mounted read-only in the virtual file system
  // under the package's code path and read through the original FileInputStream, chunk by chunk, instead of becoming one giant Java byte[] (AssetInputStream is file-backed too).
  const LARGE_ENTRY = 256 * 1024, BIS_TYPE = 'Ljava/io/BufferedInputStream;';
  const apkEntryStream = (runtime, entry) => {
    const bytes = runtime.apkReader(entry);
    if (bytes.length <= LARGE_ENTRY) return byteStream(runtime, bytes);
    const path = `${fs().codePath}/.entries/${entry}`;
    if (!fs().nodes.has(path)) fs().mount(path, bytes);
    const stream = construct(runtime, FIS, [STRING], [path]);
    return construct(runtime, BIS_TYPE, [IS], [stream]);
  };

  // ---- System.in / out / err: libcore's System.initPhase wiring over the three standard descriptors (src/libcore-io-native.js logs descriptor 1/2 writes the way logd does).
  const SYSTEM = 'Ljava/lang/System;', FD = 'Ljava/io/FileDescriptor;', FOS = 'Ljava/io/FileOutputStream;', BIS = 'Ljava/io/BufferedInputStream;', BOS = 'Ljava/io/BufferedOutputStream;', PS = 'Ljava/io/PrintStream;', OS = 'Ljava/io/OutputStream;';
  const stdio = (runtime, name) => {
    runtime.stdio ??= {};
    if (runtime.stdio[name] !== undefined) return runtime.stdio[name];
    const descriptor = runtime.readStatic({ owner: FD, name, type: FD, key: `${FD}->${name}:${FD}` });
    if (name === 'in') return runtime.stdio.in = construct(runtime, BIS, ['Ljava/io/InputStream;', 'I'], [construct(runtime, FIS, [FD], [descriptor]), 128]);
    return runtime.stdio[name] = construct(runtime, PS, [OS, 'Z'], [construct(runtime, BOS, [OS, 'I'], [construct(runtime, FOS, [FD], [descriptor]), 128]), 1]);
  };
  for (const [name, type] of [['in', 'Ljava/io/InputStream;'], ['out', PS], ['err', PS]])
    def(SYSTEM, `set${name[0].toUpperCase()}${name.slice(1)}`, `(${type})V`, (r, _m, [stream]) => { r.stdio ??= {}; r.stdio[name] = stream; }, { static: true });

  // ---- java.net.URL is the original libcore class (framework.dex); http(s) goes through com.android.okhttp.HttpHandler -> the fetch bridge (src/network-native.js), file: through
  // the original FileURLConnection over the VirtualFileSystem, and jar:file:<base.apk>!/<entry> (how the class loader names APK resources) through a lab handler.
  const entryURL = (r, entry) => construct(r, URL, [STRING], [`jar:file:${fs().codePath}/base.apk!/${entry}`]);

  // ---- android.os.Environment (android-13.0.0_r1 Environment.java): the fixed system directories and the primary external storage of user 0. The virtual device has one
  // emulated, always-mounted shared volume (/storage/emulated/0, also /sdcard through the VFS aliases); there is no removable media.
  const ENVIRONMENT = 'Landroid/os/Environment;', EXTERNAL = '/storage/emulated/0';
  registry.type(ENVIRONMENT, OBJECT);
  for (const [name, value] of Object.entries({ MEDIA_UNKNOWN: 'unknown', MEDIA_REMOVED: 'removed', MEDIA_UNMOUNTED: 'unmounted', MEDIA_CHECKING: 'checking', MEDIA_NOFS: 'nofs', MEDIA_MOUNTED: 'mounted', MEDIA_MOUNTED_READ_ONLY: 'mounted_ro', MEDIA_SHARED: 'shared', MEDIA_BAD_REMOVAL: 'bad_removal', MEDIA_UNMOUNTABLE: 'unmountable',
    DIRECTORY_MUSIC: 'Music', DIRECTORY_PODCASTS: 'Podcasts', DIRECTORY_RINGTONES: 'Ringtones', DIRECTORY_ALARMS: 'Alarms', DIRECTORY_NOTIFICATIONS: 'Notifications', DIRECTORY_PICTURES: 'Pictures', DIRECTORY_MOVIES: 'Movies', DIRECTORY_DOWNLOADS: 'Download', DIRECTORY_DCIM: 'DCIM', DIRECTORY_DOCUMENTS: 'Documents', DIRECTORY_SCREENSHOTS: 'Screenshots', DIRECTORY_AUDIOBOOKS: 'Audiobooks' }))
    registry.staticField(ENVIRONMENT, name, STRING, () => value);
  for (const [name, path] of Object.entries({ getDataDirectory: '/data', getRootDirectory: '/system', getDownloadCacheDirectory: '/data/cache', getExternalStorageDirectory: EXTERNAL, getStorageDirectory: '/storage', getOemDirectory: '/oem', getOdmDirectory: '/odm', getVendorDirectory: '/vendor', getProductDirectory: '/product', getSystemExtDirectory: '/system_ext' }))
    def(ENVIRONMENT, name, `()${FILE}`, r => makeFile(r, path), { static: true });
  def(ENVIRONMENT, 'getExternalStoragePublicDirectory', `(${STRING})${FILE}`, (r, _m, [type]) => makeFile(r, type === null || type === 0 ? EXTERNAL : `${EXTERNAL}/${r.stringCharacters(type)}`), { static: true });
  def(ENVIRONMENT, 'getExternalStorageState', `()${STRING}`, () => 'mounted', { static: true });
  def(ENVIRONMENT, 'getExternalStorageState', `(${FILE})${STRING}`, () => 'mounted', { static: true });
  def(ENVIRONMENT, 'getStorageState', `(${FILE})${STRING}`, () => 'mounted', { static: true });
  for (const name of ['isExternalStorageEmulated', 'isExternalStorageLegacy']) { def(ENVIRONMENT, name, '()Z', () => 1, { static: true }); def(ENVIRONMENT, name, `(${FILE})Z`, () => 1, { static: true }); }
  def(ENVIRONMENT, 'isExternalStorageRemovable', '()Z', () => 0, { static: true }); def(ENVIRONMENT, 'isExternalStorageRemovable', `(${FILE})Z`, () => 0, { static: true });
  def(ENVIRONMENT, 'isExternalStorageManager', '()Z', () => 0, { static: true });   // MANAGE_EXTERNAL_STORAGE is never granted to a sandboxed app
  // ---- android.os.StatFs (statvfs over the VirtualFileSystem): one emulated 8 GiB data volume, 4 KiB blocks, about 70 % free. The numbers are fixed so storage-low logic is
  // deterministic; they are the same for every path that exists (/data, the app dirs, /storage/emulated/0), as on a device with one filesystem for data and shared storage.
  const STATFS = 'Landroid/os/StatFs;', BLOCK = 4096, BLOCKS = 2097152, FREE = 1468006, AVAILABLE = 1468006;
  registry.type(STATFS, OBJECT, [], { allocatable: true });
  const statfsPath = (r, self, path) => {
    const text = r.stringCharacters(path), canonical = fs().canonical(text.startsWith('/') ? text : '/' + text);
    if (!fs().nodes.has(canonical)) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid path: ${text}`);
    r.object(self).statfsPath = canonical;
  };
  def(STATFS, '<init>', `(${STRING})V`, (r, _m, [self, path]) => { if (path === null || path === 0) r.throwJava('Ljava/lang/NullPointerException;', 'path'); statfsPath(r, self, path); });
  def(STATFS, 'restat', `(${STRING})V`, (r, _m, [self, path]) => statfsPath(r, self, path));
  for (const [name, value] of [['BlockSize', BLOCK], ['BlockCount', BLOCKS], ['FreeBlocks', FREE], ['AvailableBlocks', AVAILABLE]]) {
    def(STATFS, `get${name}`, '()I', () => value); def(STATFS, `get${name}Long`, '()J', () => BigInt(value));
  }
  def(STATFS, 'getTotalBytes', '()J', () => BigInt(BLOCK) * BigInt(BLOCKS)); def(STATFS, 'getFreeBytes', '()J', () => BigInt(BLOCK) * BigInt(FREE)); def(STATFS, 'getAvailableBytes', '()J', () => BigInt(BLOCK) * BigInt(AVAILABLE));
  return { ...registry, readStatic: (runtime, field) => field.owner === SYSTEM && ['in', 'out', 'err'].includes(field.name) ? { handled: true, value: stdio(runtime, field.name) } : registry.readStatic(runtime, field), interfaces: registry.interfacesOf, fs, makeFile, apkResourceURL: entryURL, apkResourceStream: (r, entry) => apkEntryStream(r, entry) };
}
