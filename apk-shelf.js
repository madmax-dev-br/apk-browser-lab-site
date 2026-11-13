// The device's home screen keeps the APKs a user opened ("apps instalados"): each one dropped or chosen on the page is stored in this browser (IndexedDB, never uploaded) with its
// launcher label and icon, and shows on the launcher next to the others; a tap opens it again without picking the file. Where the browser hands out a file handle (Chrome:
// File System Access, from a drop or from the file picker), the handle is stored too: opening the icon then reads the file again from where it is on disk (a rebuilt APK at the
// same path is the new build), after the browser asks once per session for permission to read it; without the handle, or when the file is gone or the permission refused,
// the copy stored at the last open is used. Browsers never reveal a file's path: the handle is how a page remembers "where the file is".
// One entry per package and file name: two APKs of the same package under different file names (two flavours, two versions kept side by side) are two icons, each keeping its
// own label and icon; a new build saved under the same file name replaces its entry. An APK whose package is not known yet is keyed by its file name alone, and an entry of the
// earlier one-per-package format (keyed by the package alone) is taken over by the same package and file name. DOM-free apart from the IndexedDB backend.

export const SHELF_LIMIT = 24;   // entries kept; the least recently opened go first beyond it

/** The key of a saved APK: its package and its file name (the file name alone while the package is not known). */
export function shelfKey(packageName, name) { return name ? (packageName ? `${packageName}\u0000${name}` : name) : packageName || null; }

/** The shelf over a backend { all(), get(id), put(entry), delete(id) } (async). Entries: { id, name, packageName, label, icon: { bytes, mime } | null, size, addedAt, openedAt,
 *  blob (the APK bytes at the last open), handle (FileSystemFileHandle | null) }. */
export function createApkShelf(backend, { now = () => Date.now() } = {}) {
  const summary = entry => ({ id: entry.id, name: entry.name, packageName: entry.packageName ?? null, label: entry.label ?? null, icon: entry.icon ?? null, size: entry.size ?? 0, addedAt: entry.addedAt, openedAt: entry.openedAt, hasHandle: !!entry.handle });
  return {
    /** Every entry in the order they were first added (the launcher's order: one beside the other, a new app at the end). */
    async list() { return (await backend.all()).sort((a, b) => a.addedAt - b.addedAt || String(a.id).localeCompare(String(b.id))).map(summary); },
    /** Stores an APK that was just opened. `previousId` (the file-name key used before the package was known) is merged into the package's entry. Returns its summary. */
    async save({ id, name, packageName = null, blob, handle = null, previousId = null }) {
      const key = shelfKey(packageName, name) ?? id; if (!key || !blob) throw new Error('An APK shelf entry needs a key and the APK bytes');
      const legacy = packageName ? await backend.get(packageName) : null;   // the one-per-package format: the same app under the same file name is this entry
      if (legacy && legacy.name === name && !previousId) previousId = packageName;
      const old = await backend.get(key) ?? (previousId && previousId !== key ? await backend.get(previousId) : null), time = now();
      const entry = { ...(old ?? {}), id: key, name: name ?? old?.name ?? key, packageName: packageName ?? old?.packageName ?? null, blob, size: blob.size ?? old?.size ?? 0, handle: handle ?? old?.handle ?? null, addedAt: old?.addedAt ?? time, openedAt: time };
      await backend.put(entry); if (previousId && previousId !== key) await backend.delete(previousId);
      const all = await backend.all();
      if (all.length > SHELF_LIMIT) for (const stale of all.sort((a, b) => a.openedAt - b.openedAt).slice(0, all.length - SHELF_LIMIT)) if (stale.id !== key) await backend.delete(stale.id);
      return summary(entry);
    },
    /** The launcher's label and icon of an entry (read from the app's PackageManager once it ran). */
    async describe(id, { label = null, icon = null } = {}) { const entry = await backend.get(id); if (!entry) return null; if (label) entry.label = label; if (icon?.bytes) entry.icon = { bytes: icon.bytes, mime: icon.mime || 'image/png' }; await backend.put(entry); return summary(entry); },
    /** The APK of an entry as a File: from its file handle when the browser lets the page read it now (`ask`: may prompt), else the stored copy. { file, fromDisk } or null. */
    async file(id, { ask = true } = {}) {
      const entry = await backend.get(id); if (!entry) return null;
      if (entry.handle) {
        try {
          let permission = await entry.handle.queryPermission?.({ mode: 'read' }) ?? 'granted';
          if (permission === 'prompt' && ask) permission = await entry.handle.requestPermission?.({ mode: 'read' }) ?? 'denied';
          if (permission === 'granted') { const file = await entry.handle.getFile(); return { file, fromDisk: true }; }
        } catch { /* moved, deleted or refused: the stored copy below */ }
      }
      return entry.blob ? { file: new File([entry.blob], entry.name, { type: 'application/vnd.android.package-archive' }), fromDisk: false } : null;
    },
    async remove(id) { await backend.delete(id); },
  };
}

/** The browser's backend: one IndexedDB object store. Null where IndexedDB is not available (the shelf is then simply absent). */
export function indexedDbShelfBackend({ name = 'apkweb-shelf', idb = globalThis.indexedDB } = {}) {
  if (!idb) return null;
  let opened = null;
  const db = () => opened ??= new Promise((resolve, reject) => { const request = idb.open(name, 1); request.onupgradeneeded = () => request.result.createObjectStore('apps', { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => { opened = null; reject(request.error); }; });
  const run = async (mode, use) => { const store = (await db()).transaction('apps', mode).objectStore('apps'); return new Promise((resolve, reject) => { const request = use(store); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); };
  return { all: () => run('readonly', store => store.getAll()), get: id => run('readonly', store => store.get(id)), put: entry => run('readwrite', store => store.put(entry)), delete: id => run('readwrite', store => store.delete(id)) };
}

/** An in-memory backend (tests, and pages where IndexedDB is refused). */
export function memoryShelfBackend() {
  const map = new Map(), copy = value => value && ({ ...value });
  return { all: async () => [...map.values()].map(copy), get: async id => copy(map.get(id)) ?? undefined, put: async entry => { map.set(entry.id, copy(entry)); }, delete: async id => { map.delete(id); } };
}
