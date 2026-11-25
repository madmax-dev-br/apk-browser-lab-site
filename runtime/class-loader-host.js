import { unsignedBytes } from './java-arrays.js?v=a737601fbbdf';
import { APKError } from './apk-error.js?v=a737601fbbdf';
import { APKArchive } from './apk-loader.js?v=a737601fbbdf';
import { DexFile, LOADER_ALIAS } from './apk-runtime.js?v=a737601fbbdf';
import { createHostRegistry } from './host-contract.js?v=a737601fbbdf';
import { normalizePath } from './virtual-fs.js?v=a737601fbbdf';

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
  const HOST_LOADERS = new Set([LOADER, BASE, IN_MEMORY, DEX_CLASS_LOADER, PATH]);
  /** Whether loader `ref` is of a ClassLoader subclass (code of a package) that overrides loadClass, so its delegation is its own code's. */
  const overridesLoadClass = (runtime, ref) => {
    for (let type = runtime.object(ref)?.type, depth = 0; type && !HOST_LOADERS.has(type) && depth < 32; depth++) {
      const cls = runtime.classes.get(type); if (!cls) return false;
      if (cls.methods.has(`loadClass(${STRING}Z)${CLASS}`) || cls.methods.has(`loadClass(${STRING})${CLASS}`)) return true;
      type = cls.superclass;
    }
    return false;
  };
  // A type reference is renamed with its array dimensions kept ([Lfoo/Bar; follows Lfoo/Bar;).
  const renamer = rename => t => { const at = t.lastIndexOf('[') + 1; if (at === 0) return rename.get(t) ?? t; const mapped = rename.get(t.slice(at)); return mapped === undefined ? t : t.slice(0, at) + mapped; };
  /**
   * Defines one DEX file into `owner`. `isolated` (a companion package's loader, createPackageLoader below) follows a separate path: every class of the package that the boot
   * layer does not define is defined under the loader's alias (Lfoo/Bar$$ldrN;), and every type reference of the DEX to such a class, or to a class only another package
   * defines, is renamed to that alias too. The package's code therefore binds to its own copies whatever the app ships, a reference to a class only the app has fails as
   * NoClassDefFoundError (as in a separate process), and the app's code never sees a class of the companion.
   */
  const defineDex = (runtime, owner, bytes, label, { isolated = false, packageClasses = null, parsed = null, decision = null } = {}) => {
    const st = stateOf(runtime, owner), parse = rename => {
      try { return new DexFile(bytes, { filename: label, maxBytes: MAX_DEX, ...(rename ? { typeRename: renamer(rename) } : {}) }); }
      catch (error) { throw new APKError(`Invalid DEX payload (${label}): ${error.message}`, { kind: 'invalid-dynamic-dex' }); }
    };
    let dex = parsed ?? parse(null);
    const names = [...dex.classes.keys()];
    if (isolated) {
      const boot = runtime.dex.bootClasses, rename = new Map(), skip = new Set(); let shadowed = 0, hidden = 0;
      for (const t of dex.types) {
        const component = t.slice(t.lastIndexOf('[') + 1);
        if (component[0] !== 'L' || rename.has(component) || boot?.has(component)) continue;
        if ((packageClasses.has(component) || runtime.dex.classes.has(component)) && runtime.deviceProvidesClass(component)) continue;   // a platform class the hosts implement: the device's, like the boot layer's
        if (packageClasses.has(component)) rename.set(component, component.slice(0, -1) + ALIAS_SUFFIX(st.id));
        else if (runtime.dex.classes.has(component)) { rename.set(component, component.slice(0, -1) + ALIAS_SUFFIX(st.id)); hidden++; }
      }
      for (const name of names) { if (boot?.has(name) || runtime.deviceProvidesClass(name)) { skip.add(name); shadowed++; } else if (st.own.has(name)) skip.add(rename.get(name)); }   // parent-first; an earlier DEX file of the package wins
      dex = parse(rename); dex.definingLoader = owner;
      const added = runtime.dex.addDynamicFile(dex, label, { skip });
      for (const key of added) { st.own.set(key.replace(LOADER_ALIAS, ';'), key); runtime.classOwners.set(key, owner); }
      runtime.record(`DEXLOADER ${label}: ${added.length} classes of package ${st.packageEntry?.name ?? '?'} defined by loader #${st.id} (${shadowed} shadowed by the boot layer, ${hidden} references to classes only another package defines are not visible)`);
      return { label, classes: names };
    }
    const own = decision ?? decide(runtime, owner, names), rename = own.rename, skip = new Set();
    for (const name of names) {
      if (own.visible.has(name)) skip.add(own.visible.get(name));
      else if (st.own.has(name)) skip.add(rename.get(name) ?? name);   // an earlier DEX file of this loader defined it: the first one wins
    }
    if (rename.size) dex = parse(rename);
    dex.definingLoader = owner;
    const added = runtime.dex.addDynamicFile(dex, label, { skip });
    for (const key of added) { const plain = key.replace(LOADER_ALIAS, ';'); st.own.set(plain, key); runtime.classOwners.set(key, owner); if (!runtime.dynamicPlain.has(plain)) runtime.dynamicPlain.set(plain, key); }
    const aliased = names.filter(n => own.aliased.has(n)).length, shadowed = names.filter(n => own.visible.has(n)).length;
    runtime.record(`DEXLOADER ${label}: ${added.length} classes defined by loader #${st.id} (${aliased} redefined under alias, ${shadowed} shadowed by a parent)`);
    return { label, classes: names };
  };
  /**
   * What loader `owner` does with each class name of the DEX files it is given (all of them, so a reference from one DEX file to a class another DEX file of the same loader
   * defines is renamed like that class): a name visible through the parent chain binds to the parent's class (parent-first), a name defined elsewhere but not visible is defined
   * again under the loader's alias, anything else is defined as it is.
   */
  const decide = (runtime, owner, names) => {
    const st = stateOf(runtime, owner), chain = chainOf(runtime, owner), ancestors = chain.slice(1).reverse(); // root-first
    const app = runtime.applicationClassLoader ??= createApplicationLoader(runtime), hasApp = chain.some(c => c.ref.ref === app.ref);
    // A parent that is a ClassLoader subclass with its own loadClass (a filtering loader of a package's code) decides itself what it delegates: a class its parents define is
    // visible to this loader only if that loadClass returns it (libcore ClassLoader.loadClass asks the parent first). Asked only for the names a parent defines, once, here.
    const customAt = chain.slice(1).findIndex(c => overridesLoadClass(runtime, c.ref)), custom = customAt < 0 ? null : chain[customAt + 1];
    const throughCustom = (name, found) => {
      if (!custom) return found;
      try { const cls = runtime.dispatch({ owner: LOADER, name: 'loadClass', parameters: [STRING, 'Z'], result: CLASS, signature: `(${STRING}Z)${CLASS}` }, [custom.ref, name.slice(1, -1).replaceAll('/', '.'), 0], 'virtual'); return cls ? runtime.object(cls).classType ?? found : null; }
      catch (error) { if (error?.value && runtime.isSubtype(runtime.typeOf(error.value), 'Ljava/lang/ClassNotFoundException;')) return null; throw error; }
    };
    const rename = new Map(), visible = new Map(), aliased = new Set();
    for (const name of names) {
      if (visible.has(name) || aliased.has(name)) continue;
      let found = null;
      if (runtime.deviceProvidesClass(name)) found = name;   // the boot layer's classes and the platform classes the hosts implement: parent-first
      else { for (const ancestor of ancestors) if (ancestor.st.own.has(name)) { found = custom && chain.indexOf(ancestor) > customAt ? throughCustom(name, ancestor.st.own.get(name)) : ancestor.st.own.get(name); break; } }
      if (found === null && st.own.has(name)) found = st.own.get(name);
      if (found === null && hasApp && runtime.classes.has(name) && !runtime.classOwners.has(name)) found = throughCustom(name, name);
      if (found !== null) { visible.set(name, found); if (found !== name) rename.set(name, found); }
      else if (runtime.classes.has(name)) { rename.set(name, name.slice(0, -1) + ALIAS_SUFFIX(st.id)); aliased.add(name); }
    }
    return { rename, visible, aliased };
  };
  /** Class lookup for a requesting loader: returns the VM table type, the unchanged name (base class / unknown), or false when the class is not visible. */
  const isolatedRoot = (runtime, loader) => { const chain = chainOf(runtime, loader); return chain.find(c => c.st.packageEntry)?.st ?? null; };
  const mapType = (runtime, loader, plain) => {
    if (loader && loader !== 'boot' && typeof loader === 'object') {   // the system class loader (and a loader under it): the boot layer only
      const root = chainOf(runtime, loader).at(-1)?.st;
      if (root?.bootOnly) { for (const { st } of chainOf(runtime, loader).reverse()) if (st.own.has(plain)) return st.own.get(plain); return runtime.deviceProvidesClass(plain) ? plain : false; }
    }
    if (loader && loader !== 'boot' && runtime.platform?.packages?.multi) {   // a companion package's loader chain: its own classes and the boot layer, nothing of another package
      const root = isolatedRoot(runtime, loader);
      if (root) { for (const { st } of chainOf(runtime, loader).reverse()) if (st.own.has(plain)) return st.own.get(plain); return runtime.dex.bootClasses?.has(plain) || !runtime.dex.classes.has(plain) && !runtime.classOwners.has(plain) ? plain : false; }
    }
    if (!runtime.classOwners.size || !runtime.classOwners.has(plain)) return plain; // boot/APK classes (parent-first) and names no dynamic loader defines
    if (loader === 'boot') return runtime.bootDefined?.get(plain) ?? false; // classes defined into the boot loader (DexFile.loadClass(name, null)) are its only dynamic ones
    const app = runtime.applicationClassLoader;
    if (!loader && app) loader = app; // code outside any run-time-loaded DEX runs in the app loader
    const chain = chainOf(runtime, loader).reverse();
    for (const { st } of chain) if (st.own.has(plain)) return st.own.get(plain);
    if (!loader || (app && loader.ref === app.ref)) return runtime.dynamicPlain.get(plain) ?? false; // lenient for the app loader (dexElements merges are not tracked)
    return false;
  };
  // ART opens a DEX file once per process (OatFileManager): every class loader over the same unchanged file maps the same bytes and loads only the classes it is asked for.
  // The lab keeps the extracted classes*.dex of a file per virtual-fs node, so another loader over one APK (microG creates one PathClassLoader over its base.apk per Dynamite
  // module, besides the package's own loader) shares them instead of inflating them again, and the aggregate DEX limit counts them once (DexProgram.addDynamicFile).
  const dexBytesOfFile = new WeakMap();
  const sharedDexBytes = (node, name, extract) => {
    if (!node) return extract();
    const stamp = `${node.size}:${node.mtime}:${node.rev ?? 0}`; let slot = dexBytesOfFile.get(node);
    if (!slot || slot.stamp !== stamp || slot.buf !== node.buf) dexBytesOfFile.set(node, slot = { stamp, buf: node.buf, entries: new Map() });   // rewritten: opened again
    let bytes = slot.entries.get(name); if (!bytes) slot.entries.set(name, bytes = extract());
    return bytes;
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
      // every DEX file of the archive first, so the loader decides over all their classes at once (multidex references cross files)
      const node = platform.javaIo.fs().node(normalized), files = names.map(name => { const data = sharedDexBytes(node, name, () => archive.extractSync(name, MAX_DEX)), label = `${normalized}!${name}`; try { return { data, label, parsed: new DexFile(data, { filename: label, maxBytes: MAX_DEX }) }; } catch (error) { throw new APKError(`Invalid DEX payload (${label}): ${error.message}`, { kind: 'invalid-dynamic-dex' }); } });
      const decision = decide(runtime, owner, files.flatMap(f => [...f.parsed.classes.keys()]));
      for (const file of files) unit.push(defineDex(runtime, owner, file.data, file.label, { parsed: file.parsed, decision }));
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
    if (runtime.arm64) runtime.arm64.mount();
    const appLibs = [...(runtime.arm64 ? [`${platform.javaIo.fs().codePath}/lib/arm64`] : []), `${platform.javaIo.fs().codePath}/lib/wasm32`], systemLibs = (runtime.javaProperties.get('java.library.path') ?? '').split(':').filter(Boolean);
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
    if (object.byteArray) return runtime.bytesOf(object.byteArray, object.bufferPosition, object.bufferLimit).slice();   // runtimes without the framework DEX use the host ByteBuffer
    const fields = object.fields, array = runtime.array(fields.get('Ljava/nio/ByteBuffer;->hb:[B')), offset = fields.get('Ljava/nio/ByteBuffer;->offset:I') | 0;
    const position = fields.get('Ljava/nio/Buffer;->position:I') | 0, limit = fields.get('Ljava/nio/Buffer;->limit:I') | 0;
    return unsignedBytes(array.cells, offset + position, offset + limit).slice();
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
    platform.onDexClassLoader?.(r, self, r.stringCharacters(dexPath));   // a device option may observe code loaded at run time (src/microg-droidguard.js: the DroidGuard VM)
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
  // ClassLoader.getResources (parent, then DexPathList.findResources over the APK): when no APK entry has that name, Android
  // returns an empty enumeration, which is what ServiceLoader-style lookups (e.g. kotlinx FastServiceLoader) rely on.
  // A present entry is returned as the jar:file:<base.apk>!/<entry> URL (the lab jar: handler opens the APK's bytes).
  // ClassLoader.getResourceAsStream: the APK entry's bytes (what the PathClassLoader's DexPathList finds in base.apk), else null.
  def(LOADER, 'getResourceAsStream', `(${STRING})Ljava/io/InputStream;`, (r, _m, [_self, name]) => {
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'name == null');
    const entry = r.stringCharacters(name).replace(/^\/+/, '');
    if (!r.apkEntries?.has(entry)) return null;
    const array = r.arrayOf('[B', r.apkReader(entry));
    const stream = r.allocate('Ljava/io/ByteArrayInputStream;'); r.dispatch({ owner: 'Ljava/io/ByteArrayInputStream;', name: '<init>', parameters: ['[B'], result: 'V', signature: '([B)V' }, [stream, array], 'direct'); return stream;
  });
  def(LOADER, 'getResource', `(${STRING})Ljava/net/URL;`, (r, _m, [_self, name]) => {   // the first APK entry with that name as a jar: URL, else null
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'name == null');
    const entry = r.stringCharacters(name).replace(/^\/+/, '');
    return r.apkEntries?.has(entry) ? platform.javaIo.apkResourceURL(r, entry) : null;
  });
  def(LOADER, 'getResources', `(${STRING})Ljava/util/Enumeration;`, (r, _m, [_self, name]) => {
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'name == null');
    const entry = r.stringCharacters(name).replace(/^\/+/, '');
    if (r.apkEntries?.has(entry)) {   // DexPathList.findResources: a jar:file:<base.apk>!/<entry> URL per matching element (one APK here), through the lab jar: handler
      const list = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct');
      r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: ['Ljava/lang/Object;'], result: 'Z', signature: '(Ljava/lang/Object;)Z' }, [list, platform.javaIo.apkResourceURL(r, entry)], 'virtual');
      return r.dispatch({ owner: 'Ljava/util/Collections;', name: 'enumeration', parameters: ['Ljava/util/Collection;'], result: 'Ljava/util/Enumeration;', signature: '(Ljava/util/Collection;)Ljava/util/Enumeration;' }, [list], 'static');
    }
    return r.dispatch({ owner: 'Ljava/util/Collections;', name: 'emptyEnumeration', parameters: [], result: 'Ljava/util/Enumeration;', signature: '()Ljava/util/Enumeration;' }, [], 'static');
  });
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
    if (r.arm64) r.arm64.mount();
    const file = 'lib' + r.stringCharacters(name) + '.so', dirs = [...(r.arm64 ? [`${platform.javaIo.fs().codePath}/lib/arm64`] : []), `${platform.javaIo.fs().codePath}/lib/wasm32`, ...(r.javaProperties.get('java.library.path') ?? '').split(':').filter(Boolean)];
    for (const dir of dirs) if (platform.javaIo.fs().stat(`${dir}/${file}`)?.type === 'file') { r.record(`CLASSLOADER findLibrary(${r.stringCharacters(name)}) -> ${dir}/${file}`); return `${dir}/${file}`; }
    r.record(`CLASSLOADER findLibrary(${r.stringCharacters(name)}) -> null: ${file} is not in ${dirs[0]} or the system library directories (no wasm32 build)`);
    return null;
  });
  def(LOADER, 'findClass', `(${STRING})${CLASS}`, (r, _m, [_self, name]) => r.throwJava('Ljava/lang/ClassNotFoundException;', r.stringCharacters(name)));
  def(LOADER, 'findLoadedClass', `(${STRING})${CLASS}`, (r, _m, [self, name]) => { const plain = 'L' + r.stringCharacters(name).replaceAll('.', '/') + ';', own = stateOf(r, self)?.own.get(plain); return own ? r.classObject(own) : null; });
  def(LOADER, 'getSystemClassLoader', `()${LOADER}`, (r) => systemLoader(r), { static: true });
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

  /**
   * The PathClassLoader of a companion package (docs/MULTI-PACKAGE.md): ART builds it from the package's base.apk with the boot class loader as its parent, so the package's code
   * sees the framework and its own classes only. Its DEX files are defined in order (the first definition of a name wins, as DexPathList searches them).
   */
  function createPackageLoader(runtime, entry) {
    const ref = runtime.allocate(PATH), base = `${entry.codePath}/base.apk`;
    const st = newState(runtime, ref, null, base); st.packageEntry = entry;
    runtime.record(`CLASSLOADER #${st.id} PathClassLoader of package ${entry.name} parent=null(boot)`);
    // Each DEX file is read once for its class list and type table, then once more with the type table renamed (DexFile decodes ids on demand, so both reads are cheap).
    const node = platform.javaIo.fs().node(base), dexes = entry.dexFiles.map(name => { const bytes = sharedDexBytes(node, name, () => entry.reader(name)); try { return { name, bytes, parsed: new DexFile(bytes, { filename: `${base}!${name}`, maxBytes: MAX_DEX }) }; } catch (error) { throw new APKError(`Invalid DEX in package ${entry.name} (${name}): ${error.message}`, { kind: 'invalid-dynamic-dex' }); } });
    const packageClasses = new Set(); for (const { parsed } of dexes) for (const type of parsed.classes.keys()) packageClasses.add(type);
    const units = [];
    for (const { name, bytes, parsed } of dexes) units.push(defineDex(runtime, ref, bytes, `${base}!${name}`, { isolated: true, packageClasses, parsed }));
    for (const [plain, key] of st.own) entry.descriptors.set(plain, key);
    makePathList(runtime, ref, { units });
    return ref;
  }
  /**
   * ClassLoader.getSystemClassLoader() (libcore ClassLoader.createSystemClassLoader): a PathClassLoader over java.class.path (".", nothing) whose parent is the boot class loader, so
   * it finds the boot layer's classes only, never an installed package's (an app's own classes are found through its PathClassLoader, Class.getClassLoader()).
   */
  function systemLoader(runtime) {
    if (runtime.systemClassLoader) return runtime.systemClassLoader;
    const app = runtime.applicationClassLoader ??= createApplicationLoader(runtime), ref = runtime.allocate(PATH);
    runtime.systemClassLoader = ref; newState(runtime, ref, stateOf(runtime, app).parent, '.'); stateOf(runtime, ref).bootOnly = true;
    makePathList(runtime, ref, { units: [] });
    return ref;
  }
  /** The app's PathClassLoader (ART creates it from the installed base.apk): Class.getClassLoader() of the app's classes returns it. */
  function createApplicationLoader(runtime) {
    const ref = runtime.allocate(PATH), base = `${platform.javaIo.fs().codePath}/base.apk`;
    runtime.applicationClassLoader = ref; // state first: loaders created while building the path list may name it as their parent
    newState(runtime, ref, runtime.makeObject(LOADER), base); stateOf(runtime, ref).id = 0;
    makePathList(runtime, ref, { units: [{ label: base, classes: [] }] });
    return ref;
  }
  return { ...registry, interfaces: registry.interfacesOf, createApplicationLoader, createPackageLoader, systemLoader, mapType };
}
