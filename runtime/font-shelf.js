// Font files kept in the browser between visits, and their SHA-256 worked out off the VM's path.
// A font is read synchronously the first time a text run or a native text engine needs it, which on a page is a synchronous request in the middle of a tap (a 9 MB emoji font on a slow
// link holds the app for seconds) followed by a SHA-256 in JavaScript (about 20 ms per MB). The shelf keeps every font file that was read and passed its check in the Cache API, and the
// next time the page opens they are brought to memory and hashed by WebCrypto while the Worker waits for an APK. Nothing is trusted because it came from here: the reader compares the
// same pinned size and digest, and a copy that does not match is dropped and read again from the server. Without the Cache API or WebCrypto everything works as before. No process.*.
import { DIGESTS } from './crypto-host.js?v=e0932d3cf1f5';
import { knownDigest, noteDigest } from './shared-asset-bytes.js?v=e0932d3cf1f5';

export const SHELF_NAME = 'apk-web-lab-fonts-1', SHELF_BYTES = 24 * 1024 * 1024;
const hex = bytes => [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');

/** SHA-256 of `bytes`, hex: the one worked out ahead, else worked out now. */
export function sha256Hex(bytes) { return knownDigest(bytes) ?? hex(DIGESTS['SHA-256'].fn(bytes)); }
/** Works out the SHA-256 of `bytes` ahead, where WebCrypto exists (a secure context). */
export async function digestAhead(bytes, subtle = globalThis.crypto?.subtle) {
  if (!subtle) return;
  try { noteDigest(bytes, hex(new Uint8Array(await subtle.digest('SHA-256', bytes)))); } catch { /* the reader works it out */ }
}

export class FontShelf {
  constructor({ caches = globalThis.caches, name = SHELF_NAME, budget = SHELF_BYTES, subtle = globalThis.crypto?.subtle } = {}) { this.caches = caches; this.name = name; this.budget = budget; this.subtle = subtle; this.kept = new Set(); this.opened = null; }
  open() { return this.opened ??= Promise.resolve().then(() => this.caches?.open(this.name) ?? null).catch(() => null); }
  /** Brings the kept files under `base` to `sync` (URL -> bytes), digested, up to the budget; a file already there (or asked for meanwhile) is left as it is. */
  async load(sync, base) {
    const cache = await this.open(); if (!cache) return 0;
    let total = 0;
    try {
      for (const request of await cache.keys()) {
        if (!request.url.startsWith(String(base))) continue;
        const response = await cache.match(request); if (!response) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (total + bytes.length > this.budget) continue;
        total += bytes.length; this.kept.add(request.url);
        await digestAhead(bytes, this.subtle);
        if (!sync.has(request.url)) sync.set(request.url, bytes);
      }
    } catch { /* storage refused or cleared meanwhile: the files are read from the server */ }
    return total;
  }
  /** Keeps the checked bytes of `url`, later and off the caller's path. */
  keep(url, bytes) {
    const key = String(url); if (this.kept.has(key) || !this.caches) return;
    this.kept.add(key);
    setTimeout(async () => { try { await (await this.open())?.put(key, new Response(bytes.slice(), { headers: { 'content-type': 'font/ttf', 'content-length': String(bytes.length) } })); } catch { this.kept.delete(key); } }, 1000);
  }
  /** Drops a copy that did not match its pin. */
  async drop(url) { this.kept.delete(String(url)); try { await (await this.open())?.delete(String(url)); } catch { /* nothing kept */ } }
}
