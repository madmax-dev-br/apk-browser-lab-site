import { APKError } from './apk-error.js?v=0e6d4aa783cd';
import { APKArchive } from './apk-loader.js?v=0e6d4aa783cd';
import { DexFile, LOADER_ALIAS } from './apk-runtime.js?v=0e6d4aa783cd';
import { createHostRegistry } from './host-contract.js?v=0e6d4aa783cd';
import { normalizePath } from './virtual-fs.js?v=0e6d4aa783cd';

// dalvik.system.{BaseDexClassLoader, InMemoryDexClassLoader, DexClassLoader, PathClassLoader, DexFile}: code that is only available at run time
// (decrypted payloads, downloaded plugins). The DEX bytes are parsed by the same DexFile reader as APK classes and joined to the single VM class
// table via DexProgram.addDynamicFile. Class identity is (defining loader, name) as in ART:
//  * delegation is parent-first (boot layer -> app PathClassLoader -> custom loaders); a class already visible through the parent chain is NOT
//    redefined, the child's copy is dropped and its references bind to the parent's class;
//  * a class whose name exists elsewhere but is not visible through the chain (the same DEX image in two unrelated loaders, a DexFile) is
//    defined again under an alias descriptor (Lfoo/Bar$$ldrN;) by re-reading the DEX with its type table renamed, so the copy has its own Class
//    object, statics, init state and every type reference inside the DEX binds to the loader's own copies; Class.getName() hides the alias;
//  * Class.forName / loadClass resolve through the requesting loader (the caller's defining loader unless given).
// Known limits: code in the app loader sees run-time-loaded classes leniently (ART merges dexElements reflectively; that merge is not tracked), and
// odex/oat compilation does not exist. The optimized-directory argument is validated like ART does but nothing is compiled into it.
const BASE = 'Ldalvik/system/BaseDexClassLoader;', IN_MEMORY = 'Ldalvik/system/InMemoryDexClassLoader;', DEX_CLASS_LOADER = 'Ldalvik/system/DexClassLoader;', PATH = 'Ldalvik/system/PathClassLoader;';
const DEX_FILE = 'Ldalvik/system/DexFile;', LOADER = 'Ljava/lang/ClassLoader;', STRING = 'Ljava/lang/String;', BYTE_BUFFER = 'Ljava/nio/ByteBuffer;', CLASS = 'Ljava/lang/Class;';
const MAX_DEX = 64 * 1024 * 1024;

export function createClassLoaderHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(LOADER, 'Ljava/lang/Object;', [], { allocatable: true });
  type(BASE, LOADER, [], { allocatable: true });
  for (const owner of [IN_MEMORY, DEX_CLASS_LOADER, PATH]) type(owner, BASE, [], { allocatable: true });
  type(DEX_FILE, 'Ljava/lang/Object;', ['Ljava/io/Closeable;'], { allocatable: true });
  let counter = 0;

  const state = (runtime, ref) => { const s = runtime.object(ref).dexLoader; if (!s) runtime.throwJava('Ljava/lang/IllegalStateException;', 'class loader used before construction'); return s; };
  const newState = (runtime, self, parent, label) => { const st = { parent: parent ?? null, label, id: ++counter, own: new Map() }; runtime.object(self).dexLoader = st; return st; };
  const stateOf = (runtime, ref) => (ref && typeof ref === 'object') ? runtime.object(ref).dexLoader ?? null : null;
  /** Loader chain nearest-first: [loader, parent, ...] as {ref, st}; stops at a host ClassLoader that has no state (the boot loader). */
  const chainOf = (runtime, loader) => { const out = []; for (let x = loader, depth = 0; x && depth < 64; depth++) { const st = stateOf(runtime, x); if (!st) break; out.push({ ref: x, st }); x = st.parent; } return out; };
  const ALIAS_SUFFIX = (id) => `$$ldr${id};`;
  const defineDex = (runtime, owner, bytes, label) => {
    const st = stateOf(runtime, owner), parse = rename => {
      try { return new DexFile(bytes, { filename: label, maxBytes: MAX_DEX, ...(rename ? { typeRename: t => rename.get(t) ?? t } : {}) }); }
      catch (error) { throw new APKError(`Invalid DEX payload (${label}): ${error.message}`, { kind: 'invalid-dynamic-dex' }); }
    };
    let dex = parse(null);
    const names = [...dex.classes.keys()], chain = chainOf(runtime, owner), ancestors = chain.slice(1).reverse(); // root-first
    const app = runtime.applicationClassLoader ??= createApplicationLoader(runtime), hasApp = chain.some(c => c.ref.ref === app.ref);
    const rename = new Map(), skip = new Set(), aliased = [], shadowed = [];
    for (const name of names) {
      let visible = null;
      if (runtime.dex.bootClasses?.has(name)) visible = name;
      else { for (const ancestor of ancestors) if (ancestor.st.own.has(name)) { visible = ancestor.st.own.get(name); break; } }
      if (visible === null && st.own.has(name)) visible = st.own.get(name);
      if (visible === null && hasApp && runtime.classes.has(name) && !runtime.classOwners.has(name)) visible = name;
      if (visible !== null) { skip.add(visible); if (visible !== name) rename.set(name, visible); shadowed.push(name); }
      else if (runtime.classes.has(name)) { const alias = name.slice(0, -1) + ALIAS_SUFFIX(st.id); rename.set(name, alias); aliased.push(name); }
    }
    if (rename.size) dex = parse(rename);
    dex.definingLoader = owner;
    const added = runtime.dex.addDynamicFile(dex, label, { skip });
    for (const key of added) { const plain = key.replace(LOADER_ALIAS, ';'); st.own.set(plain, key); runtime.classOwners.set(key, owner); if (!runtime.dynamicPlain.has(plain)) runtime.dynamicPlain.set(plain, key); }
    runtime.record(`DEXLOADER ${label}: ${added.length} classes defined by loader #${st.id} (${aliased.length} redefined under alias, ${shadowed.length} shadowed by a parent)`);
    return { label, classes: names };
  };
  /** Class lookup for a requesting loader: returns the VM table type, the unchanged name (base class / unknown), or false when the class is not visible. */
  const mapType = (runtime, loader, plain) => {
    if (!runtime.classOwners.size || !runtime.classOwners.has(plain)) return plain; // boot/APK classes (parent-first) and names no dynamic loader defines
    if (loader === 'boot') return runtime.bootDefined?.get(plain) ?? false; // classes defined into the boot loader (DexFile.loadClass(name, null)) are its only dynamic ones
    const app = runtime.applicationClassLoader;
    if (!loader && app) loader = app; // code outside any run-time-loaded DEX runs in the app loader
    const chain = chainOf(runtime, loader).reverse();
    for (const { st } of chain) if (st.own.has(plain)) return st.own.get(plain);
    if (!loader || (app && loader.ref === app.ref)) return runtime.dynamicPlain.get(plain) ?? false; // lenient for the app loader (dexElements merges are not tracked)
    return false;
  };
  const bytesOfPath = (runtime, path) => {
    const fs = platform.javaIo.fs(), node = fs.node(path);
    if (!node || node.type !== 'file') runtime.throwJava('Ljava/io/FileNotFoundException;', `${path} (No such file or directory)`);
    return node.buf.subarray(0, node.size);
  };
  /** Loads a path that is either a raw DEX or a ZIP/APK/JAR with classes*.dex entries into `owner`. The installed base.apk is the app loader's own code. */
  const loadPath = (runtime, owner, path) => {
    const normalized = platform.javaIo.fs().canonical(normalizePath(path));
    if (normalized === `${platform.javaIo.fs().codePath}/base.apk`) return { label: normalized, classes: [], installed: true };
    const bytes = bytesOfPath(runtime, normalized), unit = [];
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const archive = new APKArchive(bytes), names = [...archive.entries.keys()].filter(n => /^classes\d*\.dex$/.test(n)).sort();
      if (!names.length) runtime.throwJava('Ljava/lang/ClassNotFoundException;', `No classes.dex in ${normalized}`);
      for (const name of names) unit.push(defineDex(runtime, owner, archive.extractSync(name, MAX_DEX), `${normalized}!${name}`));
    } else unit.push(defineDex(runtime, owner, bytes, normalized));
    return { label: normalized, classes: unit.flatMap(u => u.classes) };
  };
  // BaseDexClassLoader.pathList (DexPathList) with its Element[] dexElements: the structure multidex-style code patches reflectively.
  const PATH_LIST = 'Ldalvik/system/DexPathList;', ELEMENT = 'Ldalvik/system/DexPathList$Element;', ELEMENTS = `[${ELEMENT}`;
  type(PATH_LIST, 'Ljava/lang/Object;', [], { allocatable: true }); type(ELEMENT, 'Ljava/lang/Object;', [], { allocatable: true });
  registry.instanceField(BASE, 'pathList', PATH_LIST, { reflect: true });
  registry.instanceField(PATH_LIST, 'dexElements', ELEMENTS, { reflect: true });
  registry.instanceField(PATH_LIST, 'definingContext', LOADER, { reflect: true });
  registry.instanceField(ELEMENT, 'dexFile', DEX_FILE, { reflect: true });
  registry.instanceField(ELEMENT, 'path', 'Ljava/io/File;', { reflect: true });
  const LIST = 'Ljava/util/List;', NATIVE_ELEMENT = 'Ldalvik/system/DexPathList$NativeLibraryElement;', NATIVE_ELEMENTS = `[${NATIVE_ELEMENT}`;
  type(NATIVE_ELEMENT, 'Ljava/lang/Object;', [], { allocatable: true });
  registry.instanceField(PATH_LIST, 'nativeLibraryDirectories', LIST, { reflect: true });
  registry.instanceField(PATH_LIST, 'systemNativeLibraryDirectories', LIST, { reflect: true });
  registry.instanceField(PATH_LIST, 'nativeLibraryPathElements', NATIVE_ELEMENTS, { reflect: true });
  registry.instanceField(PATH_LIST, 'dexElementsSuppressedExceptions', 'Ljava/util/ArrayList;', { reflect: true });
  registry.instanceField(NATIVE_ELEMENT, 'path', 'Ljava/io/File;', { reflect: true });
  const fileList = (runtime, paths) => {
    const list = runtime.allocate('Ljava/util/ArrayList;');
    runtime.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct');
    for (const path of paths) runtime.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: ['Ljava/lang/Object;'], result: 'Z', signature: '(Ljava/lang/Object;)Z' }, [list, platform.javaIo.makeFile(runtime, path)], 'virtual');
    return list;
  };
  const makePathList = (runtime, loader, info) => {
    const list = runtime.allocate(PATH_LIST), elements = info.units.map(unit => {
      const element = runtime.allocate(ELEMENT), dexFile = runtime.allocate(DEX_FILE);
      runtime.object(dexFile).dexFile = { name: unit.label, classes: unit.classes, closed: false, loader };
      runtime.storeField(runtime.object(element).fields, `${ELEMENT}->dexFile:${DEX_FILE}`, dexFile); return element;
    }), array = runtime.newArray(ELEMENTS, elements.length);
    runtime.array(array).elements = elements;
    runtime.storeField(runtime.object(list).fields, `${PATH_LIST}->dexElements:${ELEMENTS}`, array);
    runtime.storeField(runtime.object(list).fields, `${PATH_LIST}->definingContext:${LOADER}`, loader);
    // Native library search path (ART: app lib dir, then the system dirs from java.library.path). The VM has no loadable ELF for these directories.
    const appLibs = [`${platform.javaIo.fs().codePath}/lib/wasm32`], systemLibs = (runtime.javaProperties.get('java.library.path') ?? '').split(':').filter(Boolean);
    runtime.storeField(runtime.object(list).fields, `${PATH_LIST}->nativeLibraryDirectories:${LIST}`, fileList(runtime, appLibs));
    runtime.storeField(runtime.object(list).fields, `${PATH_LIST}->systemNativeLibraryDirectories:${LIST}`, fileList(runtime, systemLibs));
    const natives = [...appLibs, ...systemLibs].map(path => { const element = runtime.allocate(NATIVE_ELEMENT); runtime.storeField(runtime.object(element).fields, `${NATIVE_ELEMENT}->path:Ljava/io/File;`, platform.javaIo.makeFile(runtime, path)); return element; });
    const nativeArray = runtime.newArray(NATIVE_ELEMENTS, natives.length); runtime.array(nativeArray).elements = natives;
    runtime.storeField(runtime.object(list).fields, `${PATH_LIST}->nativeLibraryPathElements:${NATIVE_ELEMENTS}`, nativeArray);
    runtime.storeField(runtime.object(loader).fields, `${BASE}->pathList:${PATH_LIST}`, list);
  };
  const bufferBytes = (runtime, ref) => {
    if (ref === null) runtime.throwJava('Ljava/lang/NullPointerException;', 'dexBuffer == null');
    // The original java.nio.ByteBuffer (libcore): heap and direct buffers both expose their bytes as hb[offset + position, offset + limit) on Android.
    const object = runtime.object(ref);
    if (object.byteArray) return Uint8Array.from(runtime.array(object.byteArray).elements.slice(object.bufferPosition, object.bufferLimit), v => v & 255);   // runtimes without the framework DEX use the host ByteBuffer
    const fields = object.fields, array = runtime.array(fields.get('Ljava/nio/ByteBuffer;->hb:[B')), offset = fields.get('Ljava/nio/ByteBuffer;->offset:I') | 0;
    const position = fields.get('Ljava/nio/Buffer;->position:I') | 0, limit = fields.get('Ljava/nio/Buffer;->limit:I') | 0;
    return Uint8Array.from(array.elements.slice(offset + position, offset + limit), v => v & 255);
  };
  /** Builds the loader state first (so its id names alias descriptors), defines the units, then publishes pathList. */
  const construct = (runtime, self, parent, label, define) => {
    newState(runtime, self, parent, label);
    runtime.record(`CLASSLOADER #${stateOf(runtime, self).id} ${runtime.object(self).type.slice(14, -1)} parent=${parent === null ? 'null(boot)' : stateOf(runtime, parent) ? '#' + stateOf(runtime, parent).id : runtime.object(parent).type}`);
    const units = define();
    stateOf(runtime, self).label = units.map(u => u.label).join(':') || label;
    makePathList(runtime, self, { units });
  };
  def(IN_MEMORY, '<init>', `(${BYTE_BUFFER}${LOADER})V`, (r, _m, [self, buffer, parent]) => construct(r, self, parent, 'memory-dex', () => [defineDex(r, self, bufferBytes(r, buffer), `memory-dex-${counter}`)]));
  def(IN_MEMORY, '<init>', `(${BYTE_BUFFER}${STRING}${LOADER})V`, (r, _m, [self, buffer, _library, parent]) => construct(r, self, parent, 'memory-dex', () => [defineDex(r, self, bufferBytes(r, buffer), `memory-dex-${counter}`)]));
  def(IN_MEMORY, '<init>', `([${BYTE_BUFFER}${LOADER})V`, (r, _m, [self, buffers, parent]) => construct(r, self, parent, 'memory-dex', () => r.array(buffers).elements.map((b, i) => defineDex(r, self, bufferBytes(r, b), `memory-dex-${counter}-${i}`))));
  const pathUnits = (r, self, dexPath) => r.stringCharacters(dexPath).split(':').filter(Boolean).map(p => loadPath(r, self, p));
  def(DEX_CLASS_LOADER, '<init>', `(${STRING}${STRING}${STRING}${LOADER})V`, (r, _m, [self, dexPath, optimized, _library, parent]) => {
    if (dexPath === null) r.throwJava('Ljava/lang/NullPointerException;', 'dexPath == null');
    if (optimized !== null) { const st = platform.javaIo.fs().stat(r.stringCharacters(optimized)); if (!st || st.type !== 'dir') r.throwJava('Ljava/lang/IllegalArgumentException;', `optimizedDirectory not a directory: ${r.stringCharacters(optimized)}`); }
    construct(r, self, parent, 'dex', () => pathUnits(r, self, dexPath));
  });
  def(PATH, '<init>', `(${STRING}${LOADER})V`, (r, _m, [self, dexPath, parent]) => { if (dexPath === null) r.throwJava('Ljava/lang/NullPointerException;', 'dexPath == null'); construct(r, self, parent, 'path', () => pathUnits(r, self, dexPath)); });
  def(PATH, '<init>', `(${STRING}${STRING}${LOADER})V`, (r, _m, [self, dexPath, _library, parent]) => construct(r, self, parent, 'path', () => pathUnits(r, self, dexPath)));
  // java.lang.ClassLoader as a base class for loaders defined by APK code (custom delegation). ART forbids defineClass on dex classes, so only
  // delegation (parent first, then findClass) exists: libcore ClassLoader.loadClass(String, boolean).
  const classLoaderState = (runtime, ref) => runtime.object(ref).dexLoader ?? null;
  const virtualCall = (runtime, receiver, name, parameters, result, args) => runtime.dispatch({ owner: LOADER, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  def(LOADER, '<init>', '()V', (r, _m, [self]) => { newState(r, self, r.applicationClassLoader ??= createApplicationLoader(r), 'custom'); });
  def(LOADER, '<init>', `(${LOADER})V`, (r, _m, [self, parent]) => { newState(r, self, parent, 'custom'); });
  def(LOADER, 'getParent', `()${LOADER}`, (r, _m, [self]) => classLoaderState(r, self)?.parent ?? null);
  def(LOADER, 'loadClass', `(${STRING})${CLASS}`, (r, _m, [self, name]) => virtualCall(r, self, 'loadClass', [STRING, 'Z'], CLASS, [name, 0]));
  def(LOADER, 'loadClass', `(${STRING}Z)${CLASS}`, (r, _m, [self, name]) => {
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const s = classLoaderState(r, self);
    try { return s?.parent ? virtualCall(r, s.parent, 'loadClass', [STRING], CLASS, [name]) : r.resolveClass(r.stringCharacters(name), false, self); }
    catch (error) {
      if (!(error?.value && r.isSubtype(r.typeOf(error.value), 'Ljava/lang/ClassNotFoundException;'))) throw error;
      return virtualCall(r, self, 'findClass', [STRING], CLASS, [name]);
    }
  });
  // BaseDexClassLoader.findLibrary: first file lib<name>.so in the app then system library directories of the virtual filesystem (null when absent).
  def(LOADER, 'findLibrary', `(${STRING})${STRING}`, (r, _m, [self, name]) => {
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    const file = 'lib' + r.stringCharacters(name) + '.so', dirs = [`${platform.javaIo.fs().codePath}/lib/wasm32`, ...(r.javaProperties.get('java.library.path') ?? '').split(':').filter(Boolean)];
    for (const dir of dirs) if (platform.javaIo.fs().stat(`${dir}/${file}`)?.type === 'file') { r.record(`CLASSLOADER findLibrary(${r.stringCharacters(name)}) -> ${dir}/${file}`); return `${dir}/${file}`; }
    r.record(`CLASSLOADER findLibrary(${r.stringCharacters(name)}) -> null: ${file} is not in ${dirs[0]} or the system library directories (no wasm32 build)`);
    return null;
  });
  def(LOADER, 'findClass', `(${STRING})${CLASS}`, (r, _m, [_self, name]) => r.throwJava('Ljava/lang/ClassNotFoundException;', r.stringCharacters(name)));
  def(LOADER, 'findLoadedClass', `(${STRING})${CLASS}`, (r, _m, [self, name]) => { const plain = 'L' + r.stringCharacters(name).replaceAll('.', '/') + ';', own = stateOf(r, self)?.own.get(plain); return own ? r.classObject(own) : null; });
  def(LOADER, 'getSystemClassLoader', `()${LOADER}`, (r) => r.applicationClassLoader ??= createApplicationLoader(r), { static: true });
  def(BASE, 'getParent', `()${LOADER}`, (r, _m, [self]) => state(r, self).parent);
  def(BASE, 'toString', `()${STRING}`, (r, _m, [self]) => `dalvik.system.${r.object(self).type.slice(r.object(self).type.lastIndexOf('/') + 1, -1)}[DexPathList[[${state(r, self).label}]]]`);
  // ClassLoader.loadClass on a dex loader: its own classes first, then the parent chain (the shared table makes parent lookups global).
  def(BASE, 'loadClass', `(${STRING})${CLASS}`, (r, _m, [self, name]) => { state(r, self); return r.resolveClass(r.stringCharacters(name), false, self); });
  def(BASE, 'findClass', `(${STRING})${CLASS}`, (r, _m, [self, name]) => {
    const s = state(r, self), n = r.stringCharacters(name);
    const own = s.own.get('L' + n.replaceAll('.', '/') + ';');
    if (!own) r.throwJava('Ljava/lang/ClassNotFoundException;', `Didn't find class "${n}" on path: DexPathList[[${s.label}]]`);
    return r.classObject(own);
  });

  // dalvik.system.DexFile
  // A DexFile is its own namespace (parent: boot): classes defined here are only reachable through DexFile.loadClass or a loader that wraps it.
  const openDexFile = (r, self, path) => { newState(r, self, null, path); const info = loadPath(r, self, path); r.object(self).dexFile = { name: path, classes: info.classes, closed: false, loader: self }; };
  def(DEX_FILE, '<init>', `(${STRING})V`, (r, _m, [self, path]) => openDexFile(r, self, r.stringCharacters(path)));
  def(DEX_FILE, '<init>', '(Ljava/io/File;)V', (r, _m, [self, file]) => openDexFile(r, self, r.stringCharacters(r.dispatch({ owner: 'Ljava/io/File;', name: 'getPath', parameters: [], result: STRING, signature: '()' + STRING }, [file], 'virtual'))));
  def(DEX_FILE, 'loadDex', `(${STRING}${STRING}I)${DEX_FILE}`, (r, _m, [source, _out, _flags]) => { const ref = r.allocate(DEX_FILE); openDexFile(r, ref, r.stringCharacters(source)); return ref; }, { static: true });
  const dexFile = (r, self) => { const d = r.object(self).dexFile; if (!d || d.closed) r.throwJava('Ljava/lang/IllegalStateException;', 'Attempt to use a closed DexFile'); return d; };
  def(DEX_FILE, 'getName', `()${STRING}`, (r, _m, [self]) => dexFile(r, self).name);
  def(DEX_FILE, 'close', '()V', (r, _m, [self]) => { const d = r.object(self).dexFile; if (d) d.closed = true; });
  def(DEX_FILE, 'loadClass', `(${STRING}${LOADER})${CLASS}`, (r, _m, [self, name, loader]) => {
    // ART defines the class in the ClassLoader given here; that loader is what Class.getClassLoader() reports.
    const d = dexFile(r, self), n = r.stringCharacters(name), own = stateOf(r, d.loader)?.own.get('L' + n.replaceAll('.', '/') + ';');
    if (!own) return null;
    r.record(`CLASSLOADER DexFile.loadClass(${n}) into ${loader === null ? 'boot' : stateOf(r, loader) ? 'loader #' + stateOf(r, loader).id : r.object(loader).type}`);
    const plain = 'L' + n.replaceAll('.', '/') + ';', target = stateOf(r, loader);
    r.classes.get(own).dex.definingLoader = loader ?? 'boot'; // code of classes defined through DexFile.loadClass resolves names through the loader that defined it
    if (loader === null) { const boot = r.bootDefined ??= new Map(); if (boot.has(plain)) return r.classObject(boot.get(plain)); boot.set(plain, own); }
    if (target) { // DexFile.loadClass defines the class in `loader`: a later loader.loadClass(name) finds this very class (ART duplicate definitions return the loaded class)
      if (target.own.has(plain)) return r.classObject(target.own.get(plain));
      target.own.set(plain, own);
    }
    (r.dexFileLoaders ??= new Map()).set(own, loader ?? null);
    return r.classObject(own);
  });
  def(DEX_FILE, 'entries', '()Ljava/util/Enumeration;', (r, _m, [self]) => {
    const d = dexFile(r, self), ref = r.allocate('Ljava/util/Collections$ArrayEnumeration;');
    r.object(ref).enumeration = { index: 0, items: d.classes.map(c => c.replace(LOADER_ALIAS, ';').slice(1, -1).replaceAll('/', '.')) }; return ref;
  });
  def(DEX_FILE, 'isDexOptNeeded', `(${STRING})Z`, () => 0, { static: true });

  /** The app's PathClassLoader (ART creates it from the installed base.apk): Class.getClassLoader() and ClassLoader.getSystemClassLoader() return it. */
  function createApplicationLoader(runtime) {
    const ref = runtime.allocate(PATH), base = `${platform.javaIo.fs().codePath}/base.apk`;
    runtime.applicationClassLoader = ref; // state first: loaders created while building the path list may name it as their parent
    newState(runtime, ref, runtime.makeObject(LOADER), base); stateOf(runtime, ref).id = 0;
    makePathList(runtime, ref, { units: [{ label: base, classes: [] }] });
    return ref;
  }
  return { ...registry, interfaces: registry.interfacesOf, createApplicationLoader, mapType };
}
