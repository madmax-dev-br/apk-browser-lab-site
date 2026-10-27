// Persistence of an app's private data across page reloads, the way app data survives a process restart on a phone.
//
// What is persisted: the app's own directories in the VirtualFileSystem (src/virtual-fs.js) -- and its keys of the Android Keystore under /data/misc/keystore/user_0/<pkg> -- the credential-protected data dir /data/user/0/<pkg> (shared_prefs, databases,
// files, cache, ...), the device-protected /data/user_de/0/<pkg>, and the app-specific external dir /storage/emulated/0/Android/data/<pkg>. `code_cache` is not persisted
// (ART recreates it). The installed APK, /system and the shared external storage are never stored.
//
// Keyed by package name AND the SHA-256 of the APK's signing certificate(s): a different app that reuses the package name (a different signer) starts with empty storage,
// as Android refuses to install it over the first one. Stored per file with a manifest, in one backend transaction per flush (so a reload sees the manifest and the files
// of the same flush, never a mix).
//
// When it is written (Android semantics: what the app committed before the process died is there on the next start; uncommitted data may be lost):
//   * synchronously started (not debounced) at: Activity onPause/onStop (onStop first finishes the pending SharedPreferences.apply() writes, as QueuedWork.waitToFinish does),
//     SharedPreferences.Editor.commit(), a SQLite transaction commit / statement outside a transaction / connection close, and page hide (visibilitychange/pagehide);
//   * debounced (default 1.5 s after the last change seen) for everything else, including SharedPreferences.apply() and plain file writes.
//   A flush stores the filesystem as it is at that instant. A SQLite file caught in the middle of a transaction is stored with its journal/WAL exactly as a crash would leave it,
//   and SQLite recovers (rolls back) on the next open. The write itself is asynchronous (IndexedDB); the transaction is issued immediately.
// Limits: a per-app cap (default 64 MiB of file bytes). A flush that would exceed it is refused as a whole (the last good stored state stays) and reported via status().
//
// Backends share one small interface so Node tests run the same code over memory: { load(key), commit(key, {manifest, put, remove}), clear(key), manifest(key), list() }.

export const MANIFEST_VERSION = 1;
export const DEFAULT_LIMIT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_DEBOUNCE_MS = 1500;
const EXCLUDED_NAMES = new Set(['code_cache']);

// + the app's keys of the Android Keystore (the software Keystore 2 service keeps them in /data/misc/keystore, which keystore2's own database survives a reboot in, like the app data)
export const dataRoots = packageName => [`/data/user/0/${packageName}`, `/data/user_de/0/${packageName}`, `/storage/emulated/0/Android/data/${packageName}`, `/data/misc/keystore/user_0/${packageName}`];

const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
/** Storage key of an app: package name + SHA-256 over its signing certificates (DER), or `unsigned`. */
export async function appKeyFor(packageName, certificates = []) {
  if (!certificates.length) return { key: `${packageName}|unsigned`, certSha256: 'unsigned' };
  const parts = certificates.map(cert => Uint8Array.from(cert)), total = parts.reduce((sum, part) => sum + part.length + 4, 0), joined = new Uint8Array(total);
  let at = 0; for (const part of parts) { new DataView(joined.buffer).setUint32(at, part.length); joined.set(part, at + 4); at += part.length + 4; }
  const certSha256 = hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', joined)));
  return { key: `${packageName}|${certSha256}`, certSha256 };
}

// ---------------------------------------------------------------- backends
export function createMemoryBackend() {
  const manifests = new Map(), files = new Map();   // key -> manifest; `${key}\0${path}` -> Uint8Array
  return {
    kind: 'memory', manifests, files,
    async manifest(key) { const m = manifests.get(key); return m ? structuredClone(m) : null; },
    async load(key) {
      const manifest = manifests.get(key); if (!manifest) return null;
      const out = new Map(); for (const path of Object.keys(manifest.files)) { const bytes = files.get(`${key}\0${path}`); if (bytes) out.set(path, bytes.slice()); }
      return { manifest: structuredClone(manifest), files: out };
    },
    async commit(key, { manifest, put = [], remove = [] }) {
      for (const { path, bytes } of put) files.set(`${key}\0${path}`, bytes.slice());
      for (const path of remove) files.delete(`${key}\0${path}`);
      manifests.set(key, structuredClone(manifest));
    },
    async clear(key) { const m = manifests.get(key); if (m) for (const path of Object.keys(m.files)) files.delete(`${key}\0${path}`); manifests.delete(key); },
    async list() { return [...manifests.values()].map(m => structuredClone(m)); },
  };
}

/** IndexedDB backend: object stores `manifests` (key -> manifest) and `files` (`key\0path` -> ArrayBuffer). One readwrite transaction over both per flush. */
export function createIndexedDbBackend({ indexedDB = globalThis.indexedDB, name = 'apkweb-app-data' } = {}) {
  if (!indexedDB) throw new Error('IndexedDB is not available');
  let opening = null;
  const wrap = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed')); });
  const open = () => opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => { const db = request.result; for (const store of ['manifests', 'files']) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store); };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    request.onerror = () => { opening = null; reject(request.error ?? new Error('IndexedDB open failed')); };
    request.onblocked = () => { opening = null; reject(new Error('IndexedDB open blocked')); };
  });
  const done = transaction => new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed')); transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')); });
  const toBytes = value => value instanceof Uint8Array ? value : new Uint8Array(value);
  return {
    kind: 'indexeddb',
    async manifest(key) { const db = await open(); return (await wrap(db.transaction('manifests', 'readonly').objectStore('manifests').get(key))) ?? null; },
    async load(key) {
      const db = await open(), manifest = await wrap(db.transaction('manifests', 'readonly').objectStore('manifests').get(key)); if (!manifest) return null;
      const store = db.transaction('files', 'readonly').objectStore('files'), out = new Map();
      await Promise.all(Object.keys(manifest.files).map(async path => { const value = await wrap(store.get(`${key}\0${path}`)); if (value) out.set(path, toBytes(value)); }));
      return { manifest, files: out };
    },
    async commit(key, { manifest, put = [], remove = [] }) {
      const db = await open(), transaction = db.transaction(['manifests', 'files'], 'readwrite'), files = transaction.objectStore('files'), finished = done(transaction);
      for (const { path, bytes } of put) files.put(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), `${key}\0${path}`);
      for (const path of remove) files.delete(`${key}\0${path}`);
      transaction.objectStore('manifests').put(manifest, key); await finished;
    },
    async clear(key) {
      const db = await open(), manifest = await wrap(db.transaction('manifests', 'readonly').objectStore('manifests').get(key)); if (!manifest) return;
      const transaction = db.transaction(['manifests', 'files'], 'readwrite'), files = transaction.objectStore('files'), finished = done(transaction);
      for (const path of Object.keys(manifest.files)) files.delete(`${key}\0${path}`);
      transaction.objectStore('manifests').delete(key); await finished;
    },
    async list() { const db = await open(); return await wrap(db.transaction('manifests', 'readonly').objectStore('manifests').getAll()); },
  };
}

/** The best backend this environment has (IndexedDB), or null. OPFS is not used: IndexedDB gives the atomic multi-file commit the manifest relies on. */
export function defaultBackend() { try { return globalThis.indexedDB ? createIndexedDbBackend() : null; } catch { return null; } }

// ---------------------------------------------------------------- persistence of one app
export class AppDataPersistence {
  constructor({ backend, key, certSha256 = 'unsigned', packageName, fs, limitBytes = DEFAULT_LIMIT_BYTES, debounceMs = DEFAULT_DEBOUNCE_MS, now = () => Date.now(), record = () => {}, onStatus = null, timers = null }) {
    this.backend = backend; this.key = key; this.certSha256 = certSha256; this.packageName = packageName; this.fs = fs; this.limitBytes = limitBytes; this.debounceMs = debounceMs;
    this.now = now; this.record = record; this.onStatus = onStatus; this.setTimer = timers?.set ?? ((fn, ms) => setTimeout(fn, ms)); this.clearTimer = timers?.clear ?? (handle => clearTimeout(handle));
    this.persisted = new Map();   // path -> fingerprint of the file as last handed to the backend
    this.persistedDirs = new Set();
    this.timer = null; this.inflight = null; this.again = false; this.detached = false; this.restored = false;
    this.state = { enabled: true, bytes: 0, files: 0, limitBytes, lastFlushAt: null, lastReason: null, overLimit: false, error: null, restoredFiles: 0, flushes: 0 };
    this.queuedWork = new Set();   // SharedPreferences.apply() disk writes not yet performed (QueuedWork)
  }
  inScope(path) {
    for (const root of dataRoots(this.packageName)) if (path === root || path.startsWith(root + '/')) {
      for (const part of path.slice(root.length).split('/')) if (EXCLUDED_NAMES.has(part)) return false;
      return true;
    }
    return false;
  }
  status() { return { ...this.state, key: this.key, packageName: this.packageName, certSha256: this.certSha256, backend: this.backend.kind }; }
  emit() { try { this.onStatus?.(this.status()); } catch { /* the page may be gone */ } }
  /** Loads the stored data into the VFS. Must run before the app executes any code (Application.onCreate). */
  async restore() {
    if (this.restored) return this.status(); this.restored = true;
    const stored = await this.backend.load(this.key); if (!stored) return this.status();
    const { manifest, files } = stored;
    if (manifest.version !== MANIFEST_VERSION || manifest.packageName !== this.packageName || manifest.certSha256 !== this.certSha256) { this.record('APPDATA stored data ignored (incompatible manifest)'); return this.status(); }
    const dirs = Object.entries(manifest.dirs ?? {}).sort((a, b) => a[0].length - b[0].length);
    for (const [path, meta] of dirs) {
      if (!this.inScope(path)) continue;
      if (!this.fs.node(path)) { this.fs.mkdirs(path); const node = this.fs.nodes.get(this.fs.canonical(path)); if (node) { node.mtime = meta.mtime; node.mode = meta.mode; } }
      this.persistedDirs.add(path);
    }
    let restored = 0;
    for (const [path, meta] of Object.entries(manifest.files)) {
      const bytes = files.get(path); if (!bytes || !this.inScope(path)) { this.record(`APPDATA ${path}: missing in storage, skipped`); continue; }
      this.fs.mkdirs(this.fs.parentOf(path));
      const node = this.fs.open(path, { create: true, truncate: true, write: true }); if (typeof node === 'string') { this.record(`APPDATA ${path}: cannot restore (${node})`); continue; }
      this.fs.writeAt(node, 0, bytes, 0, bytes.length); node.mtime = meta.mtime; node.mode = meta.mode; restored++;
      this.persisted.set(path, this.fingerprint(node));
    }
    this.state.restoredFiles = restored; this.state.files = restored; this.state.bytes = manifest.bytes ?? 0;
    this.record(`APPDATA restored ${restored} file(s), ${this.state.bytes} bytes for ${this.packageName}`);
    this.emit(); return this.status();
  }
  fingerprint(node) { return `${node.size}:${node.mtime}:${node.rev ?? 0}`; }
  /** Current in-scope entries of the VFS. */
  scan() {
    const files = new Map(), dirs = new Map();
    for (const [path, node] of this.fs.nodes) {
      if (node.mounted || !this.inScope(path)) continue;
      if (node.type === 'file') files.set(path, node); else if (node.type === 'dir') dirs.set(path, node);
    }
    return { files, dirs };
  }
  /** Debounced: called after every VM operation / event; arms a timer when the filesystem changed since the last flush. */
  touch() {
    if (this.detached || this.timer !== null) return;
    this.timer = this.setTimer(() => { this.timer = null; this.syncPoint('debounce'); }, this.debounceMs);
  }
  /** Immediate: starts the write now (if anything changed). Returns a promise for that write, which callers may ignore. */
  syncPoint(reason = 'sync') {
    if (this.detached) return Promise.resolve();
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    return this.flush(reason);
  }
  /** QueuedWork.waitToFinish: perform the SharedPreferences.apply() writes that have not run yet. */
  /** (each queued write removes itself from the set when it runs) */
  finishQueuedWork() { for (const work of [...this.queuedWork]) { try { work(); } catch (error) { this.record(`APPDATA queued work failed: ${error?.message ?? error}`); } } }
  flush(reason = 'flush') {
    if (this.detached) return Promise.resolve();
    if (this.inflight) { this.again = true; this.lastRequestedReason = reason; return this.inflight; }
    this.inflight = this.run(reason).finally(() => {
      this.inflight = null;
      if (this.again && !this.detached) { this.again = false; this.flush(this.lastRequestedReason ?? reason); }
    });
    return this.inflight;
  }
  /** Resolves when no write is in flight or queued. */
  async idle() { while (this.inflight) await this.inflight; }
  async run(reason) {
    const { files, dirs } = this.scan(), put = [], remove = [], manifest = { version: MANIFEST_VERSION, packageName: this.packageName, certSha256: this.certSha256, updatedAt: this.now(), bytes: 0, files: {}, dirs: {} };
    let changed = false;
    for (const [path, node] of files) {
      manifest.files[path] = { size: node.size, mtime: node.mtime, mode: node.mode }; manifest.bytes += node.size;
      if (this.persisted.get(path) !== this.fingerprint(node)) changed = true;
    }
    for (const path of this.persisted.keys()) if (!files.has(path)) { remove.push(path); changed = true; }
    for (const [path, node] of dirs) { manifest.dirs[path] = { mtime: node.mtime, mode: node.mode }; if (!this.persistedDirs.has(path)) changed = true; }
    for (const path of this.persistedDirs) if (!dirs.has(path)) changed = true;
    this.state.bytes = manifest.bytes; this.state.files = files.size;
    if (!changed) return;
    if (manifest.bytes > this.limitBytes) {   // refuse the whole flush: the last stored state stays consistent
      if (!this.state.overLimit) this.record(`APPDATA over the ${this.limitBytes}-byte cap (${manifest.bytes} bytes): not stored`);
      this.state.overLimit = true; this.emit(); return;
    }
    this.state.overLimit = false;
    const next = new Map(); for (const [path, node] of files) { const fp = this.fingerprint(node); next.set(path, fp); if (this.persisted.get(path) !== fp) put.push({ path, bytes: node.buf.slice(0, node.size) }); }
    const before = this.persisted, beforeDirs = this.persistedDirs; this.persisted = next; this.persistedDirs = new Set(dirs.keys());
    try {
      await this.backend.commit(this.key, { manifest, put, remove });
      this.state.flushes++; this.state.lastFlushAt = manifest.updatedAt; this.state.lastReason = reason; this.state.error = null;
    } catch (error) {
      this.persisted = new Map(); this.persistedDirs = new Set(); void before; void beforeDirs;   // unknown backend state: the next flush rewrites everything
      this.state.error = String(error?.message ?? error); this.record(`APPDATA write failed (${reason}): ${this.state.error}`);
    }
    this.emit();
  }
  /** Settings > Apps > Clear storage: forget the stored data and stop persisting this process (the running app is expected to be restarted). */
  async clear() {
    this.detached = true; if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    while (this.inflight) await this.inflight.catch(() => {});
    await this.backend.clear(this.key); this.persisted = new Map(); this.persistedDirs = new Set(); this.queuedWork.clear();
    this.state.bytes = 0; this.state.files = 0; this.state.overLimit = false; this.state.cleared = true; this.emit(); return this.status();
  }
  /** Final orderly flush when the runtime is replaced (a reload/restart of the app inside the page). */
  async close() { if (this.detached) return; this.finishQueuedWork(); await this.syncPoint('close'); await this.idle(); this.detached = true; }
}

/**
 * Wires persistence into a freshly loaded runtime (before launch): restores the stored data into its VFS and installs `platform.appData`, the object the platform hooks call.
 * With `clear: true` the stored data is wiped first. With `keep: false` nothing is read or written (the platform hooks find `appData` unset), but the status still reports the key and what is stored.
 */
export async function attachAppData(runtime, { backend = defaultBackend(), keep = true, limitBytes = DEFAULT_LIMIT_BYTES, debounceMs = DEFAULT_DEBOUNCE_MS, onStatus = null, timers = null, clear = false } = {}) {
  const platform = runtime.platform, packageName = platform.packageName;
  if (!packageName || !backend) return { persistence: null, status: { enabled: false, reason: !backend ? 'no-backend' : 'no-package', bytes: 0, files: 0, limitBytes } };
  const { key, certSha256 } = await appKeyFor(packageName, (runtime.apkSigningCertificates?.() ?? []));
  if (clear) await backend.clear(key);   // `clear-data`: start from empty storage
  if (!keep) { const stored = await backend.manifest(key).catch(() => null); return { persistence: null, key, status: { enabled: false, reason: 'disabled', key, packageName, certSha256, bytes: stored?.bytes ?? 0, files: Object.keys(stored?.files ?? {}).length, limitBytes } }; }
  const persistence = new AppDataPersistence({ backend, key, certSha256, packageName, fs: platform.javaIo.fs(), limitBytes, debounceMs, now: () => runtime.clock?.wall?.() ?? Date.now(), record: line => runtime.record(line), onStatus, timers });
  await persistence.restore();
  platform.appData = persistence;
  return { persistence, key, status: persistence.status() };
}
