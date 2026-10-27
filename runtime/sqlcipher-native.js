import { APKError } from './apk-error.js?v=d50f2f368405';
import { NativeLibraryProvider, BASE_SONAME } from './jni-host.js?v=d50f2f368405';

// SQLCipher for Android: System.loadLibrary("sqlcipher").
//
// Two public artifacts ship a libsqlcipher.so with different Java front ends and JNI surfaces:
//   net.zetetic:sqlcipher-android            net.zetetic.database.*   (current)
//   net.zetetic:android-database-sqlcipher   net.sqlcipher.*          (legacy)
// The lab supplies libsqlcipher as wasm32 modules compiled from SQLCipher's public sources and the official Android JNI glue (scripts/build-sqlcipher.sh,
// vendor/native-libs/wasm32/sqlcipher/index.json). This file is the part that runs in the page/worker:
//   1. detectSqlcipher(program): which artifact the loaded APK's own DEX carries, its version (BuildConfig.VERSION_NAME when the DEX has it) and the
//      `native` method declarations it needs bound;
//   2. selectSqlcipherBuild(detection, index): the lab build whose JNI surface serves that artifact/version, or an explicit UnsatisfiedLinkError message that
//      names the artifact and version needed (it reaches the "Copiar diagnóstico" report);
//   3. SqlcipherProvider.prepare(program): fetches + SHA-256-verifies the chosen module and hands it to the NativeLibraryProvider with its host imports;
//   4. sqlcipherHostImports(): the module's imports: a SQLite VFS over the lab's VirtualFileSystem (so the encrypted database persists in the app data store
//      like every other app file), entropy from crypto.getRandomValues, liblog diagnostics.

const NATIVE = 0x100;
const SQLITE_OPEN_READONLY = 1, SQLITE_OPEN_READWRITE = 2, SQLITE_OPEN_CREATE = 4, SQLITE_OPEN_EXCLUSIVE = 16, SQLITE_OPEN_DELETEONCLOSE = 8;
const decoder = new TextDecoder('utf-8'), encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

export const SQLCIPHER_SONAME = 'libsqlcipher.so';
export const SQLCIPHER_ARTIFACTS = [
  { artifact: 'net.zetetic:sqlcipher-android', prefix: 'Lnet/zetetic/database/', entry: 'Lnet/zetetic/database/sqlcipher/SQLiteConnection;', buildConfig: 'Lnet/zetetic/database/BuildConfig;' },
  { artifact: 'net.zetetic:android-database-sqlcipher', prefix: 'Lnet/sqlcipher/', entry: 'Lnet/sqlcipher/database/SQLiteDatabase;', buildConfig: 'Lnet/sqlcipher/BuildConfig;' },
];

/** BuildConfig.VERSION_NAME as the DEX stores it (a static_values_list string constant), or null when the class or the constant is absent (R8 removes unused BuildConfigs). */
function buildConfigVersion(program, className) {
  const cls = program.classes.get(className); if (!cls?.staticValuesOffset) return null;
  const position = cls.staticFields.findIndex(({ index }) => cls.dex.fields[index].name === 'VERSION_NAME'); if (position < 0) return null;
  const cursor = { p: cls.staticValuesOffset }, count = cls.dex.reader.uleb(cursor); if (position >= count) return null;
  let value = null;
  for (let i = 0; i <= position; i++) value = cls.dex.encodedValue(cursor);
  return typeof value === 'string' ? value : null;
}

/** The SQLCipher artifacts the program's DEX carries (usually zero or one): artifact, version (or null) and its `native` declarations (class, name, descriptor). */
export function detectSqlcipher(program) {
  const found = [];
  for (const spec of SQLCIPHER_ARTIFACTS) {
    if (!program.classes.has(spec.entry)) continue;
    const natives = [];
    for (const [name, cls] of program.classes) {
      if (!name.startsWith(spec.prefix)) continue;
      for (const { method, flags } of cls.methods.values()) if (flags & NATIVE) natives.push(`${name}.${method.name}${method.signature}`);
    }
    natives.sort();
    found.push({ artifact: spec.artifact, version: buildConfigVersion(program, spec.buildConfig), natives });
  }
  return found;
}

const sha256Hex = async text => hex(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text)));
const describeVersions = versions => versions.length === 1 ? versions[0] : `${versions[0]} - ${versions.at(-1)}`;
const subset = (needed, available) => { const set = new Set(available); return needed.every(item => set.has(item)); };

/**
 * Picks the lab build for a detection. `index` is vendor/native-libs/wasm32/sqlcipher/index.json: builds[] (artifact, versions, natives, file, sha256, bytes) and
 * surfaces[] (every published surface of both artifacts, so a missing build can be named precisely).
 * Returns { build } or { unavailable: { message, details } }.
 */
export async function selectSqlcipherBuild(detection, index) {
  const { artifact, version, natives } = detection, builds = index.builds.filter(b => b.artifact === artifact);
  const fingerprint = await sha256Hex(natives.join('\n'));
  const supported = index.builds.map(b => `${b.artifact} ${describeVersions(b.versions)}`).join('; ');
  const unavailable = (needed, why) => ({ unavailable: {
    message: `dlopen failed: library "${SQLCIPHER_SONAME}" needs a lab-built SQLCipher module for ${needed}, which this lab does not ship yet (${why}). Lab builds: ${supported}`,
    details: { kind: 'native-library-unavailable', soname: SQLCIPHER_SONAME, artifact, version, needed, nativeMethods: natives.length, jniSurface: fingerprint.slice(0, 12), supported: index.builds.map(b => ({ artifact: b.artifact, versions: b.versions })) } } });
  if (version !== null) {
    const build = builds.find(b => b.versions.includes(version));
    if (!build) return unavailable(`${artifact} ${version}`, `BuildConfig.VERSION_NAME ${version}; JNI surface ${fingerprint.slice(0, 12)}`);
    if (!subset(natives, build.natives)) return unavailable(`${artifact} ${version}`, `its DEX declares native methods the ${build.id} module does not bind (JNI surface ${fingerprint.slice(0, 12)}, BuildConfig says ${version})`);
    return { build, via: 'BuildConfig.VERSION_NAME' };
  }
  // No version constant in the DEX: the JNI surface decides. Every published surface whose native declarations contain the app's is a candidate.
  const matches = builds.filter(b => natives.length && subset(natives, b.natives));
  if (matches.length === 1) return { build: matches[0], via: 'JNI surface' };
  const published = (index.surfaces ?? []).filter(s => s.artifact === artifact && natives.length && subset(natives, s.natives));
  const needed = published.length ? `${artifact} ${published.map(s => describeVersions(s.versions)).join(' or ')}` : `${artifact} (unrecognised JNI surface)`;
  return unavailable(needed, `no BuildConfig.VERSION_NAME in the DEX; JNI surface ${fingerprint.slice(0, 12)}, ${natives.length} native methods${matches.length > 1 ? ', ambiguous between lab builds' : ''}`);
}

/**
 * Lab catalog of the SQLCipher modules. `prepare(program)` is called by loadAPK before the JNI bridge exists; it returns the NativeLibraryProvider entries to add
 * ({ module, soname, wasm, sha256, hostImports, ... }) or the reason the library cannot be supplied.
 */
export class SqlcipherProvider {
  constructor({ baseURL = new URL('../vendor/native-libs/wasm32/sqlcipher/', import.meta.url), fetchImpl, index } = {}) {
    this.baseURL = new URL(baseURL, import.meta.url); this.fetchImpl = fetchImpl || (url => globalThis.fetch(url)); this.index = index ?? null; this.cache = new Map();
  }
  async read(url, maximum) {
    const response = await this.fetchImpl(url); if (!response.ok) throw new APKError(`SQLCipher asset unavailable (HTTP ${response.status})`, { kind: 'sqlcipher-asset' });
    const buffer = await response.arrayBuffer(); if (buffer.byteLength > maximum) throw new APKError('SQLCipher asset exceeds bounded size', { kind: 'sqlcipher-asset' }); return new Uint8Array(buffer);
  }
  /** libc++_shared.so, the process's base module (libc/libc++/libc++abi). The SQLCipher modules are side modules on it; a caller that already supplies it keeps its own. */
  readBase(index) {
    const base = index.base; if (!base) throw new APKError('SQLCipher module index lacks its base module', { kind: 'sqlcipher-asset' });
    return this.baseCache ??= this.read(new URL(base.file, this.baseURL), 16 * 1024 * 1024).then(wasm => ({ soname: base.soname, wasm, sha256: base.sha256 }));
  }
  async catalog() {
    this.index ??= JSON.parse(decoder.decode(await this.read(new URL('index.json', this.baseURL), 1024 * 1024)));
    if (this.index.schemaVersion !== 1) throw new APKError('Unsupported SQLCipher module index', { kind: 'sqlcipher-asset' });
    return this.index;
  }
  /** { detections, entries, unavailable, notes }: entries become NativeLibraryProvider modules, unavailable maps soname -> explicit UnsatisfiedLinkError details. */
  /** `base` (optional): the caller's NativeLibraryProvider. When it already supplies libc++_shared.so the base module is not fetched here; its SHA-256 must be the one this index records. */
  async prepare(program, { base: callerProvider = null } = {}) {
    const detections = detectSqlcipher(program); if (!detections.length) return null;
    const result = { detections: [], entries: [], unavailable: new Map(), notes: [] };
    try {
      const index = await this.catalog();
      for (const detection of detections) {
        const selection = await selectSqlcipherBuild(detection, index);
        result.detections.push({ ...detection, build: selection.build?.id ?? null });
        if (selection.unavailable) { if (!result.unavailable.has(SQLCIPHER_SONAME) && !result.entries.length) result.unavailable.set(SQLCIPHER_SONAME, selection.unavailable); continue; }
        const { build } = selection;
        let promise = this.cache.get(build.id);
        if (!promise) { promise = this.read(new URL(build.file, this.baseURL), 16 * 1024 * 1024); this.cache.set(build.id, promise); promise.catch(() => this.cache.delete(build.id)); }
        result.entries.push({ soname: SQLCIPHER_SONAME, wasm: await promise, sha256: build.sha256, hostImports: sqlcipherHostImports,
          provenance: { id: build.id, artifact: build.artifact, versions: build.versions, selectedBy: selection.via, detectedVersion: detection.version, upstream: build.upstream } });
        result.unavailable.delete(SQLCIPHER_SONAME);
        const supplied = callerProvider?.get?.(BASE_SONAME);
        if (supplied && index.base && supplied.sha256 !== index.base.sha256) throw new APKError(`the base module ${BASE_SONAME} supplied by the caller (${supplied.sha256}) is not the one this SQLCipher build links against (${index.base.sha256})`, { kind: 'sqlcipher-asset' });
        if (!supplied) result.base ??= { build, promise: this.readBase(index) };
        result.notes.push(`SQLCipher ${detection.artifact} ${detection.version ?? '(version not recorded in the DEX)'} is served by the lab module ${build.id} (${build.bytes} bytes wasm32, chosen by ${selection.via}).`);
      }
    } catch (error) { // the lab's own assets could not be read: still an explicit UnsatisfiedLinkError at loadLibrary, never a silent skip
      result.entries.length = 0;
      result.unavailable.set(SQLCIPHER_SONAME, { message: `dlopen failed: library "${SQLCIPHER_SONAME}": the lab SQLCipher module could not be loaded (${error.message})`, details: { kind: 'native-library-unavailable', soname: SQLCIPHER_SONAME, cause: error.message } });
    }
    if (result.base) result.base = await result.base.promise.catch(error => { result.entries.length = 0; result.unavailable.set(SQLCIPHER_SONAME, { message: `dlopen failed: library "${SQLCIPHER_SONAME}": the lab base module ${BASE_SONAME} could not be loaded (${error.message})`, details: { kind: 'native-library-unavailable', soname: SQLCIPHER_SONAME, cause: error.message } }); return null; });
    if (result.unavailable.size) result.notes.push(result.unavailable.get(SQLCIPHER_SONAME).message);
    return result;
  }
}

/** A NativeLibraryProvider for one APK: the modules of `base` (the caller's provider, if any) plus the SQLCipher module `prepared` selected, or the explicit reason it is missing. */
export async function nativeProviderWithSqlcipher(base, prepared) {
  if (prepared.base && !base?.has(BASE_SONAME)) prepared = { ...prepared, entries: [prepared.base, ...prepared.entries] };
  const provider = new NativeLibraryProvider({ abi: base?.abi ?? 'wasm32' });
  for (const [soname, entry] of base?.modules ?? []) provider.modules.set(soname, entry);
  for (const [soname, reason] of base?.unavailable ?? []) provider.unavailable.set(soname, reason);
  for (const entry of prepared.entries) {
    try { await provider.add(entry); }
    catch (error) { provider.markUnavailable(entry.soname, { message: `dlopen failed: library "${entry.soname}": ${error.message}`, details: { kind: error.details?.kind ?? 'native-library-unavailable', soname: entry.soname } }); }
  }
  for (const [soname, reason] of prepared.unavailable) if (!provider.has(soname)) provider.markUnavailable(soname, reason);
  return provider;
}

// ---- host imports of the wasm module -------------------------------------------------------------------------------------------------------
const LOG_LEVELS = { 2: 'V', 3: 'D', 4: 'I', 5: 'W', 6: 'E', 7: 'F' };
const lockRules = { 1: others => others >= 3, 2: others => others >= 2, 3: others => others >= 3, 4: others => others >= 1 };
const OK = 0, BUSY = 5;

/** The imports of a libsqlcipher module (see scripts/wasm/sqlcipher-host.c): the SQLite VFS over the VirtualFileSystem, entropy, clock, liblog, and the few libc stubs. */
export function sqlcipherHostImports(bridge, soname) {
  const runtime = bridge.runtime, fs = () => bridge.platform.javaIo.fs(), files = new Map();
  let nextHandle = 1, dirty = false;
  const mem = () => bridge.linker.memory; // the process's one linear memory, shared by every library
  const bytes = () => new Uint8Array(mem().buffer), view = () => new DataView(mem().buffer);
  const cstr = pointer => { if (!pointer) return null; const b = bytes(); let end = pointer; while (b[end]) end++; return decoder.decode(b.subarray(pointer, end)); };
  const file = h => files.get(h) ?? (() => { throw new APKError(`${soname} used closed SQLite file handle ${h}`, { kind: 'native-library-import' }); })();
  const group = path => [...files].filter(([, state]) => state.path === path);
  const commitPoint = reason => { if (!dirty) return; dirty = false; bridge.platform.appData?.syncPoint(reason); };
  const setLevel = (state, level) => { state.level = level; };
  const randomFill = (pointer, count) => { // crypto.getRandomValues is the only entropy source; it throws instead of returning weak bytes
    if (!globalThis.crypto?.getRandomValues) throw new APKError('WebCrypto secure randomness is unavailable; SQLCipher cannot fall back to a weak source', { kind: 'secure-random-unavailable' });
    for (let at = 0; at < count; at += 65536) globalThis.crypto.getRandomValues(bytes().subarray(pointer + at, pointer + Math.min(count, at + 65536)));
  };
  const vfs = {
    fs_open(pathPointer, flags, outFlags) {
      let granted = flags, node, name = cstr(pathPointer); const f = fs();
      if (name === null) node = { type: 'file', buf: new Uint8Array(0), size: 0, mtime: Date.now(), mode: 0o600 }; // temporary file: private, never in the filesystem
      else {
        const p = f.canonical(name); node = f.node(p);
        if (node && (flags & SQLITE_OPEN_EXCLUSIVE) && (flags & SQLITE_OPEN_CREATE)) return -14;
        if (node?.type === 'dir') return -526;
        const readOnlyFs = f.isReadOnly(p) || node?.mounted;
        if (!node) {
          if (!(flags & SQLITE_OPEN_CREATE)) return -14;
          const created = f.open(p, { create: true, write: true }); if (typeof created === 'string') return -14; node = created;
        } else if ((flags & SQLITE_OPEN_READWRITE) && readOnlyFs) {
          if (flags & SQLITE_OPEN_EXCLUSIVE) return -14;
          granted = (flags & ~(SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)) | SQLITE_OPEN_READONLY;
        }
        name = p;
      }
      const h = nextHandle++; files.set(h, { path: name, node, readOnly: !(granted & SQLITE_OPEN_READWRITE), deleteOnClose: !!(flags & SQLITE_OPEN_DELETEONCLOSE), level: 0 });
      if (outFlags) view().setInt32(outFlags, granted, true); return h;
    },
    fs_close(h) {
      const state = file(h); setLevel(state, 0); files.delete(h); commitPoint('sqlcipher-close');
      if (state.deleteOnClose && state.path !== null) fs().delete(state.path); return 0;
    },
    fs_read(h, buffer, count, offset) { const state = file(h), got = fs().readAt(state.node, Number(offset), bytes().subarray(buffer, buffer + count), 0, count); return got < 0 ? 0 : got; },
    fs_write(h, buffer, count, offset) {
      const state = file(h); if (state.readOnly) return -1;
      try { fs().writeAt(state.node, Number(offset), bytes().subarray(buffer, buffer + count), 0, count); dirty = true; return 0; } catch (error) { if (error instanceof RangeError) return -2; throw error; }
    },
    fs_truncate(h, size) {
      const state = file(h), target = Number(size); if (state.readOnly) return 1;
      if (target < state.node.size) { state.node.size = target; state.node.mtime = Date.now(); state.node.rev = (state.node.rev ?? 0) + 1; dirty = true; } else if (target > state.node.size) fs().writeAt(state.node, target, new Uint8Array(0), 0, 0);
      return 0;
    },
    fs_size(h) { return BigInt(file(h).node.size); },
    fs_delete(pointer) { const f = fs(), p = cstr(pointer), node = f.node(p); if (!node) return 1; const ok = node.type === 'file' && f.delete(p) === 'ok'; if (ok) dirty = true; return ok ? 0 : 2; },
    fs_access(pointer, flags) { const f = fs(), p = cstr(pointer), node = f.node(p); if (!node) return 0; return flags === 1 && (f.isReadOnly(p) || node.mounted) ? 0 : 1; },
    fs_fullpath(inPointer, capacity, outPointer) {
      const full = encoder.encode(fs().canonical(cstr(inPointer))); if (full.length + 1 > capacity) return 1;
      const b = bytes(); b.set(full, outPointer); b[outPointer + full.length] = 0; return 0;
    },
    fs_lock(h, level) {
      const state = file(h); if (state.path === null) { state.level = level; return OK; }
      let others = 0; for (const [other, s] of group(state.path)) if (other !== h) others = Math.max(others, s.level);
      if (lockRules[level](others)) { if (level === 4) state.level = Math.max(state.level, 3); return BUSY; }
      state.level = level; return OK;
    },
    fs_unlock(h, level) { const state = file(h), wasWriting = state.level >= 2; setLevel(state, level); if (wasWriting && level < 2) commitPoint('sqlcipher-unlock'); return 0; },
    fs_check_reserved(h) { const state = file(h); if (state.path === null) return 0; for (const [other, s] of group(state.path)) if (other !== h && s.level >= 2) return 1; return 0; },
    host_now_ms() { return runtime.clock.wall(); },
    fs_rename(from, to) { // rename(2) of the virtual filesystem (cipher_migrate / sqlcipher_export); returns -errno
      const result = fs().rename(cstr(from), cstr(to)); if (result === 'ok') { dirty = true; commitPoint('sqlcipher-rename'); return 0; }
      return { ENOENT: -2, EACCES: -13, ENOTEMPTY: -39, EINVAL: -22 }[result] ?? -5;
    },
    host_random: randomFill,
    host_log(priority, pointer) { runtime.record(`LOG ${LOG_LEVELS[priority] ?? 'I'} sqlcipher: ${cstr(pointer)}`); },
  };
  return {
    apkweb_sqlcipher: vfs,
  };
}
