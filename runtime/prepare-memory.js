// "Prepare from the last run" (device setting, on by default; docs/FIRST-TAP-WARMUP.md section 7.2): the list of what one run of an APK laid out and linked (src/prepare-ahead.js
// firstUseProfile) is kept in the browser's storage, and the next open of the same APK prepares it in the Worker's quiet moments (src/prepare-ahead.js PrepareAhead: no class is
// initialized, no constant resolved, no Java code run). ART keeps the same kind of list per app between runs (the profile of the classes and methods a run used, from which it
// prepares the next start); here it only moves linker work the app would do in its first taps to idle time before them.
//
// Identity: the list is found by the APK's fingerprint (src/load-image.js apkFingerprint: SHA-256 of each file's length and central directory, which names every entry with its
// CRC-32) and the lab build's revision; a list of another build is not used. A class or method the list names that this APK does not have is skipped by PrepareAhead, so a list
// that does not fit only costs its own quiet time. Only the names are stored (class descriptors and method name + signature), never app data.
// Bounds: at most PREPARE_LIST_LIMITS.maxLists lists (the oldest goes first), and each list is cut at maxClasses / maxMethods; PrepareAhead itself stops at half of the metaspace.
// DOM-free, no process.*.

export const PREPARE_LIST_FORMAT = 1;
export const PREPARE_LIST_LIMITS = Object.freeze({ maxLists: 8, maxClasses: 40000, maxMethods: 160000 });

export const prepareListKey = (fingerprint, revision) => `${revision ?? 'dev'}|${fingerprint}`;

/** A firstUseProfile() cut to the limits (the order is the order the run laid classes out, so the first ones are kept); methods that name a class cut away are dropped. */
export function boundedProfile(profile, limits = PREPARE_LIST_LIMITS) {
  if (!profile || !Array.isArray(profile.classes) || !Array.isArray(profile.methods)) return null;
  const classes = profile.classes.slice(0, limits.maxClasses), methods = [];
  for (const entry of profile.methods) { if (methods.length >= limits.maxMethods) break; if (Array.isArray(entry) && entry[0] < classes.length && typeof entry[1] === 'string') methods.push(entry); }
  return { classes, methods };
}

/** A stored record is used only when it is of this format, of this key, and well formed. */
export function usableRecord(record, key) {
  return !!record && record.format === PREPARE_LIST_FORMAT && record.key === key && Array.isArray(record.profile?.classes) && Array.isArray(record.profile?.methods) ? record : null;
}

/** IndexedDB store `lists` (key -> { format, key, savedAt, classes, methods, profile }). */
export function indexedDbPrepareBackend({ indexedDB = globalThis.indexedDB, name = 'apkweb-prepare-lists' } = {}) {
  if (!indexedDB) throw new Error('IndexedDB is not available');
  let opening = null;
  const wrap = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed')); });
  const open = () => opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains('lists')) db.createObjectStore('lists'); };
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    request.onerror = () => { opening = null; reject(request.error ?? new Error('IndexedDB open failed')); };
    request.onblocked = () => { opening = null; reject(new Error('IndexedDB open blocked')); };
  });
  const store = async mode => (await open()).transaction('lists', mode).objectStore('lists');
  return {
    kind: 'indexeddb',
    async get(key) { return (await wrap((await store('readonly')).get(key))) ?? null; },
    async put(key, record) { await wrap((await store('readwrite')).put(record, key)); },
    async remove(key) { await wrap((await store('readwrite')).delete(key)); },
    async all() { return await wrap((await store('readonly')).getAll()); },
  };
}

export function memoryPrepareBackend() {
  const lists = new Map();
  return { kind: 'memory', lists, async get(key) { const r = lists.get(key); return r ? structuredClone(r) : null; }, async put(key, record) { lists.set(key, structuredClone(record)); },
    async remove(key) { lists.delete(key); }, async all() { return [...lists.values()].map(r => structuredClone(r)); } };
}

export function defaultPrepareBackend() { try { return globalThis.indexedDB ? indexedDbPrepareBackend() : null; } catch { return null; } }

/** The kept list of `key`, or null (none, another format, or storage the browser refuses). */
export async function readPrepareList(backend, key) {
  try { return usableRecord(await backend?.get(key), key)?.profile ?? null; } catch { return null; }
}

/** Keeps `profile` as the list of `key` and removes the oldest lists past the limit. Returns the record written, or null when nothing was written. */
export async function writePrepareList(backend, key, profile, { now = Date.now(), limits = PREPARE_LIST_LIMITS } = {}) {
  const bounded = boundedProfile(profile, limits); if (!backend || !bounded || !bounded.classes.length) return null;
  const record = { format: PREPARE_LIST_FORMAT, key, savedAt: now, classes: bounded.classes.length, methods: bounded.methods.length, profile: bounded };
  try {
    await backend.put(key, record);
    const all = (await backend.all()).filter(r => r?.key && r.key !== key).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    for (const old of all.slice(Math.max(0, limits.maxLists - 1))) await backend.remove(old.key);
    return record;
  } catch { return null; }
}
