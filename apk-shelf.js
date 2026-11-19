// The device's home screen keeps the APKs a user opened ("apps instalados"): each one dropped or chosen on the page is stored in this browser (IndexedDB, never uploaded) with its
// launcher label and icon, and shows on the launcher next to the others; a tap opens it again without picking the file. Where the browser hands out a file handle (Chrome:
// File System Access, from a drop or from the file picker), the handle is stored too: opening the icon then reads the file again from where it is on disk (a rebuilt APK at the
// same path is the new build), after the browser asks once per session for permission to read it; without the handle, or when the file is gone or the permission refused,
// the copy stored at the last open is used. Browsers never reveal a file's path: the handle is how a page remembers "where the file is".
// One entry per package and file name: two APKs of the same package under different file names (two flavours, two versions kept side by side) are two icons, each keeping its
// own label and icon; a new build saved under the same file name replaces its entry. An APK whose package is not known yet is keyed by its file name alone, and an entry of the
// earlier one-per-package format (keyed by the package alone) is taken over by the same package and file name. DOM-free apart from the IndexedDB backend.
// What is stored is the APK itself (never anything made from it by a build of the lab), so a new build of the site opens the same bytes. Before a copy is opened it is checked
// (readable, a whole ZIP): a stored copy the browser can no longer read is reported as such, the entry keeps its icon marked, and choosing the file again replaces the copy.

export const SHELF_LIMIT = 24;   // entries kept; the least recently opened go first beyond it

/** The key of a saved APK: its package and its file name (the file name alone while the package is not known). */
export function shelfKey(packageName, name) { return name ? (packageName ? `${packageName}\u0000${name}` : name) : packageName || null; }

/** An entry's id as text an agent or a log can carry (the key's separator is U+0000): "package/file.apk"; a key without a package is unchanged. Neither part can hold a "/". */
export function printableShelfId(id) { return String(id ?? '').replace('\u0000', '/'); }

/**
 * The installed app a selector names, among list()'s summaries: { id } (the entry's key or its printable form), { packageName }, or { name } (the launcher label or the file
 * name, with or without ".apk", case-insensitive). Throws when nothing or more than one app matches, naming what is installed (code 'not-found' | 'ambiguous' | 'bad-args').
 */
export function resolveShelfApp(items, { id = null, packageName = null, name = null } = {}) {
  const list = Array.isArray(items) ? items : [], lower = value => String(value ?? '').trim().toLowerCase(), error = (code, message) => Object.assign(new Error(message), { code });
  const show = item => `${printableShelfId(item.id)}${item.label ? ` (${item.label})` : ''}`, installed = list.length ? `Installed: ${list.map(show).join(', ')}.` : 'No app is installed: use adb install.';
  let found, what;
  if (id) { found = list.filter(item => item.id === id || printableShelfId(item.id) === id); what = `id "${printableShelfId(id)}"`; }
  else if (packageName) { found = list.filter(item => item.packageName === packageName); what = `package "${packageName}"`; }
  else if (name) { const wanted = lower(name); found = list.filter(item => lower(item.label) === wanted || lower(item.name) === wanted || lower(item.name) === `${wanted}.apk`); what = `name "${name}"`; }
  else throw error('bad-args', 'Say which app: id, package or name.');
  if (!found.length) throw error('not-found', `No installed app with ${what}. ${installed}`);
  if (found.length > 1) throw error('ambiguous', `More than one installed app with ${what}: pass the id (${found.map(show).join(', ')}).`);
  return found[0];
}

/** A saved app whose APK cannot be used any more (src/apk-shelf.js file()): `code` says which way, `shelfId` names the entry; the page offers to choose the file again. */
export class ShelfFileError extends Error {
  constructor(code, message, shelfId) { super(message); this.name = 'ShelfFileError'; this.code = code; this.shelfId = shelfId; this.reimport = true; }
}

/**
 * Whether a Blob/File can be used as an APK now: its bytes can be read (a stored copy whose data the browser lost, or a file changed after it was picked, fails to read) and it
 * is a ZIP that starts with a local header and has its end-of-central-directory record in the last 64 KiB (a file cut short while a build rewrites it has none). Reads only
 * the first 4 bytes and the tail. -> { ok: true } | { ok: false, readable, reason }.
 */
export async function checkApkBytes(blob) {
  const size = Number(blob?.size ?? 0);
  if (!blob || typeof blob.slice !== 'function') return { ok: false, readable: false, reason: 'is missing' };
  if (size < 22) return { ok: false, readable: true, reason: `is not an APK (${size} bytes)` };
  let head, tail;
  try {
    head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    const from = Math.max(0, size - (0xffff + 22)); tail = new Uint8Array(await blob.slice(from, size).arrayBuffer());
  } catch (error) { return { ok: false, readable: false, reason: `can no longer be read (${error?.name && error.name !== 'Error' ? `${error.name}: ` : ''}${error?.message || error})` }; }
  if (!(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return { ok: false, readable: true, reason: 'is not an APK (no ZIP header)' };
  for (let at = tail.length - 22; at >= 0; at--) if (tail[at] === 0x50 && tail[at + 1] === 0x4b && tail[at + 2] === 0x05 && tail[at + 3] === 0x06) return { ok: true };
  return { ok: false, readable: true, reason: 'is not a complete APK (the end of the ZIP is missing: cut short, or still being written)' };
}

/** The shelf over a backend { all(), get(id), put(entry), delete(id) } (async). Entries: { id, name, packageName, label, icon: { bytes, mime } | null, size, addedAt, openedAt,
 *  blob (the APK bytes at the last open), handle (FileSystemFileHandle | null) }. */
export function createApkShelf(backend, { now = () => Date.now() } = {}) {
  // Saving an APK and recording its label and icon are each a read, then a write, of the same entry, and the page starts them independently (the icon arrives from the VM
  // while the APK is still being saved): they run one at a time, so neither writes back an entry read before the other finished (an icon recorded and then lost).
  let queue = Promise.resolve();
  const serial = task => { const run = queue.then(task, task); queue = run.catch(() => {}); return run; };
  const summary = entry => ({ id: entry.id, name: entry.name, packageName: entry.packageName ?? null, label: entry.label ?? null, icon: entry.icon ?? null, size: entry.size ?? 0, addedAt: entry.addedAt, openedAt: entry.openedAt, hasHandle: !!entry.handle, problem: entry.problem ?? null });
  const saveNow = async ({ id, name, packageName = null, blob, handle = null, previousId = null }) => {
    const key = shelfKey(packageName, name) ?? id; if (!key || !blob) throw new Error('An APK shelf entry needs a key and the APK bytes');
    const legacy = packageName ? await backend.get(packageName) : null;   // the one-per-package format: the same app under the same file name is this entry
    if (legacy && legacy.name === name && !previousId) previousId = packageName;
    const old = await backend.get(key) ?? (previousId && previousId !== key ? await backend.get(previousId) : null), time = now();
    const entry = { ...(old ?? {}), id: key, name: name ?? old?.name ?? key, packageName: packageName ?? old?.packageName ?? null, blob, size: blob.size ?? old?.size ?? 0, handle: handle ?? old?.handle ?? null, addedAt: old?.addedAt ?? time, openedAt: time, problem: null };   // a new copy: the mark of an unusable one goes
    await backend.put(entry); if (previousId && previousId !== key) await backend.delete(previousId);
    const all = await backend.all();
    if (all.length > SHELF_LIMIT) for (const stale of all.sort((a, b) => a.openedAt - b.openedAt).slice(0, all.length - SHELF_LIMIT)) if (stale.id !== key) await backend.delete(stale.id);
    return summary(entry);
  };
  const describeNow = async (id, { label = null, icon = null, activities = null } = {}) => { const entry = await backend.get(id); if (!entry) return null; if (label) entry.label = label; if (icon?.bytes) entry.icon = { bytes: icon.bytes, mime: icon.mime || 'image/png' }; if (Array.isArray(activities)) entry.activities = activities; await backend.put(entry); return summary(entry); };
  return {
    /** Every entry in the order they were first added (the launcher's order: one beside the other, a new app at the end). */
    async list() { return (await backend.all()).sort((a, b) => a.addedAt - b.addedAt || String(a.id).localeCompare(String(b.id))).map(summary); },
    /** Stores an APK that was just opened. `previousId` (the file-name key used before the package was known) is merged into the package's entry. Returns its summary. */
    save(options) { return serial(() => saveNow(options)); },
    /** What each installed app's manifest answers Intents with: [{ id, packageName, openedAt, activities: [{ name, enabled, filters }] | null }] (null: saved before this was kept;
     *  opening the app once records it). The page resolves a deep link over these to find the app that handles it (src/intent-resolver.js). */
    async manifests() { return (await backend.all()).map(entry => ({ id: entry.id, packageName: entry.packageName ?? null, openedAt: entry.openedAt ?? 0, activities: Array.isArray(entry.activities) ? entry.activities : null })); },
    /** The launcher's label and icon of an entry (read from the app's PackageManager once it ran), and the Activities with intent filters of its manifest (`activities`). */
    describe(id, details) { return serial(() => describeNow(id, details)); },
    /**
     * The APK of an entry as a File: from its file handle when the browser lets the page read it now (`ask`: may prompt) and the file there is a whole ZIP, else the stored copy.
     * { file, fromDisk, note } (note: why the file on disk was not used, or null), or null when there is no such entry. Both copies are checked before they are handed out: their
     * bytes can be read and they are a ZIP with its end record (a file being rewritten by a build, a copy the browser lost or a stored file that is not an APK fails here, not
     * deep in the loader). When neither copy can be used it throws a ShelfFileError (code 'stored-copy-unreadable' | 'stored-copy-invalid' | 'stored-copy-missing') that
     * says so and that the APK has to be chosen again; the entry is marked (`problem`) so the launcher shows it, and the next save of that app clears the mark.
     */
    async file(id, { ask = true } = {}) {
      const entry = await backend.get(id); if (!entry) return null;
      let note = null;
      if (entry.handle) {
        try {
          let permission = await entry.handle.queryPermission?.({ mode: 'read' }) ?? 'granted';
          if (permission === 'prompt' && ask) permission = await entry.handle.requestPermission?.({ mode: 'read' }) ?? 'denied';
          if (permission === 'granted') {
            const file = await entry.handle.getFile(), check = await checkApkBytes(file);
            if (check.ok) return { file, fromDisk: true, note: null };
            note = `the file on disk ${check.reason}`;
          } else note = 'the browser did not allow reading the file on disk';
        } catch (error) { note = `the file on disk could not be read (${error?.name || error?.message || error})`; }   // moved, deleted or refused: the stored copy below
      }
      const fail = async (code, reason) => {
        const message = `The copy of ${entry.label || entry.name} stored in this browser ${reason}${note ? `, and ${note}` : ''}. Choose the APK file again to reinstall it (its app data is kept).`;
        await serial(async () => { const now = await backend.get(id); if (now) { now.problem = { code, message }; await backend.put(now); } }).catch(() => {});
        throw new ShelfFileError(code, message, id);
      };
      if (!entry.blob) return fail('stored-copy-missing', 'is missing');
      const check = await checkApkBytes(entry.blob);
      if (!check.ok) return fail(check.readable ? 'stored-copy-invalid' : 'stored-copy-unreadable', check.reason);
      return { file: new File([entry.blob], entry.name, { type: 'application/vnd.android.package-archive' }), fromDisk: false, note };
    },
    remove(id) { return serial(() => backend.delete(id)); },
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
