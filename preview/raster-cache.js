// Content-addressed PNG transport between the VM Worker and the page. The VM hands out every raster as a base64 `data:image/png` string; the same
// raster (window background, unchanged Compose content, shadows, nine-patch backgrounds, text rasters) used to be serialized, structured-cloned,
// regex-validated and re-decoded by the browser on every snapshot. Now the first occurrence travels once and later snapshots carry only
// `rasterId`; the page turns each distinct PNG into one Blob URL (decoded once by the browser) and trusts only URLs it created itself.
// Sender and receiver keep the same LRU (count + byte bounded) and must see every snapshot in order, so evictions stay in step.
export const PNG_PREFIX = 'data:image/png;base64,';
const DATA_PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/, LIMIT_ENTRIES = 512, LIMIT_BYTES = 96 * 1024 * 1024, MAX_RASTER = 24 * 1024 * 1024;
const trusted = new Set();
export const isTrustedRasterURL = url => typeof url === 'string' && trusted.has(url);
/** cyrb53 over the whole string, plus the length: stable across Worker and page. */
export function hashRaster(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) { const ch = text.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}-${text.length.toString(36)}`;
}
const rasterObjects = (root, visit) => {
  const stack = [root];
  while (stack.length) {
    const value = stack.pop(); if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) { for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]); continue; }
    if (typeof value.dataURL === 'string' || typeof value.rasterId === 'string') visit(value);
    const keys = Object.keys(value); for (let i = keys.length - 1; i >= 0; i--) { const child = value[keys[i]]; if (child && typeof child === 'object') stack.push(child); }
  }
};
class BoundedLRU {
  constructor(onEvict) { this.map = new Map(); this.bytes = 0; this.onEvict = onEvict; }
  has(id) { return this.map.has(id); }
  get(id) { return this.map.get(id); }
  touch(id, value, size) {
    if (this.map.has(id)) { const entry = this.map.get(id); this.map.delete(id); this.map.set(id, entry); return entry; }
    const entry = { value, size }; this.map.set(id, entry); this.bytes += size;
    while (this.map.size > 1 && (this.map.size > LIMIT_ENTRIES || this.bytes > LIMIT_BYTES)) { const [oldest, old] = this.map.entries().next().value; this.map.delete(oldest); this.bytes -= old.size; this.onEvict?.(old.value); }
    return entry;
  }
  clear() { for (const entry of this.map.values()) this.onEvict?.(entry.value); this.map.clear(); this.bytes = 0; }
}
/** Worker side. intern() mutates a fresh snapshot in place: every raster gets rasterId/rasterSize, repeats lose their dataURL. */
export function createRasterSender() {
  const lru = new BoundedLRU(); const stats = { sent: 0, deduped: 0, bytesSent: 0, bytesSaved: 0 };
  return { stats, reset() { lru.clear(); }, intern(snapshot) {
    rasterObjects(snapshot, value => {
      if (typeof value.dataURL !== 'string') return;
      const text = value.dataURL, id = hashRaster(text); value.rasterId = id; value.rasterSize = text.length;
      if (lru.has(id)) { lru.touch(id); delete value.dataURL; stats.deduped++; stats.bytesSaved += text.length; } else { lru.touch(id, null, text.length); stats.sent++; stats.bytesSent += text.length; }
    });
    return snapshot;
  } };
}
const defaultToURL = base64 => { const binary = atob(base64), bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); };
/** Page side. resolve() replaces every raster's dataURL by a trusted Blob URL (decoded/validated once per distinct PNG). */
export function createRasterReceiver({ toURL = defaultToURL } = {}) {
  const lru = new BoundedLRU(url => { trusted.delete(url); try { URL.revokeObjectURL?.(url); } catch { /* ignore */ } }); const stats = { decoded: 0, reused: 0 };
  return { stats, reset() { lru.clear(); }, resolve(snapshot) {
    rasterObjects(snapshot, value => {
      const id = value.rasterId;
      if (typeof value.dataURL === 'string') {
        const text = value.dataURL;
        if (text.startsWith('blob:') && trusted.has(text)) return;
        if (text.length > MAX_RASTER || !DATA_PNG.test(text)) throw new Error('Raster PNG inválido ou excessivo recebido da VM.');
        const actual = hashRaster(text); if (id !== undefined && id !== actual) throw new Error('Raster PNG com identificador divergente recebido da VM.');
        let entry = lru.has(actual) ? lru.touch(actual) : null;
        if (!entry) { const url = toURL(text.slice(PNG_PREFIX.length)); trusted.add(url); entry = lru.touch(actual, url, text.length); stats.decoded++; } else stats.reused++;
        value.rasterId = actual; value.dataURL = entry.value; return;
      }
      if (typeof id !== 'string' || !lru.has(id)) throw new Error('Cache de rasters dessincronizado com a VM; reabra o APK.');
      value.dataURL = lru.touch(id).value; stats.reused++;
    });
    return snapshot;
  } };
}
