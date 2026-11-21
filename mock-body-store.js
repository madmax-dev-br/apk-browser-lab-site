// Large endpoint-mock bodies (src/endpoint-mocks.js) live in IndexedDB, not in localStorage: localStorage holds about 5 MB per site in all, and a write that does not fit fails
// whole (the list would last for the page only). The list itself stays in localStorage; a mock whose body is larger than INLINE_BODY_CHARS is stored there with an empty body
// and bodyRef: true, and its body under "<package>\0<mock id>" in the database below. Every access is guarded: without IndexedDB the bodies stay inline (and a full storage is
// reported by the panel, never silent).

export const INLINE_BODY_CHARS = 32 * 1024, DB_NAME = 'apkweb-mock-bodies', STORE = 'bodies';
const keyOf = (pkg, id) => `${pkg}\u0000${id}`;
const isLarge = (mock, limit) => (mock.body?.length ?? 0) > limit || (mock.bodyBase64?.length ?? 0) > limit;

/** The list as localStorage keeps it (large bodies replaced by a reference) and the bodies that go to IndexedDB: { stored, large: [{ id, body, bodyBase64 }] }. */
export function splitForStorage(mocks, limit = INLINE_BODY_CHARS) {
  const stored = [], large = [];
  for (const mock of mocks) {
    if (isLarge(mock, limit)) { large.push({ id: mock.id, body: mock.body ?? '', bodyBase64: mock.bodyBase64 ?? null }); stored.push({ ...mock, body: '', bodyBase64: null, bodyRef: true }); }
    else stored.push({ ...mock, bodyRef: false });
  }
  return { stored, large };
}

function request(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed')); }); }

/** The body database, or null when the browser has none. { get(pkg, id), put(pkg, id, value), keep(pkg, ids): deletes this package's other bodies }. */
export function createBodyStore(factory = globalThis.indexedDB) {
  if (!factory?.open) return null;
  let opening = null;
  const open = () => opening ??= new Promise((resolve, reject) => {
    let req; try { req = factory.open(DB_NAME, 1); } catch (error) { reject(error); return; }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => { opening = null; reject(req.error ?? new Error('IndexedDB unavailable')); };
  });
  const tx = async (mode, body) => { const db = await open(), t = db.transaction(STORE, mode), done = new Promise((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted')); }); const result = await body(t.objectStore(STORE)); await done; return result; };
  return {
    get: (pkg, id) => tx('readonly', store => request(store.get(keyOf(pkg, id)))),
    put: (pkg, id, value) => tx('readwrite', store => request(store.put({ body: value.body ?? '', bodyBase64: value.bodyBase64 ?? null }, keyOf(pkg, id)))),
    keep: (pkg, ids) => tx('readwrite', async store => {
      const wanted = new Set(ids.map(id => keyOf(pkg, id))), keys = await request(store.getAllKeys());
      for (const key of keys) if (String(key).startsWith(`${pkg}\u0000`) && !wanted.has(key)) store.delete(key);
    }),
  };
}
