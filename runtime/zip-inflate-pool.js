// Helper Workers that expand an APK's deflated DEX files in parallel (src/zip-inflate-worker.js). One VM Worker thread expanding and checking the DEX files one after another
// spent about 80 ms on the heavy example's 24 MB of DEX (deflate-raw ~40 ms, CRC-32 ~30 ms cold), and it grows with the app; spread over helpers the wait is the largest file's.
//
// The pool only computes: APKArchive (src/apk-loader.js) asks it ahead (prefetch), and extract() still compares size and CRC with the central directory and, when a helper
// failed in any way (an error, a crash, no helper left), expands the entry on its own thread, so results and error messages are those of the sequential path.
// The VM Worker starts the pool when the page opens (src/apk-worker.js warmAssets): the helpers load their two modules and warm crc32 while the user picks an APK.

import { crc32Combine } from './zip-entry.js?v=df19921e3eea';

/** `create()` makes one helper: an object with postMessage(message, transfer), terminate(), and the onmessage / onerror properties of a Worker. */
export class InflatePool {
  constructor({ size = 2, create }) {
    if (typeof create !== 'function') throw new TypeError('InflatePool needs a create() for its helpers');
    this.size = Math.max(1, Math.min(8, size | 0)); this.create = create; this.helpers = null; this.nextId = 1; this.stats = { jobs: 0, bytes: 0, failed: 0, crashed: 0 };
  }
  /** A pool of module Workers on src/zip-inflate-worker.js, sized by the machine's cores (the VM Worker keeps one); null where Workers or DecompressionStream are missing. */
  static forBrowser({ size = null, url = null } = {}) {
    if (typeof Worker !== 'function' || typeof DecompressionStream !== 'function') return null;
    const cores = Number(globalThis.navigator?.hardwareConcurrency) || 2, workerURL = url ?? new URL(`./zip-inflate-worker.js${new URL(import.meta.url).search}`, import.meta.url);
    return new InflatePool({ size: size ?? Math.max(1, Math.min(4, cores - 1)), create: () => new Worker(workerURL, { type: 'module', name: 'apk-zip-inflate' }) });
  }
  /** Starts the helpers (idempotent). A helper that cannot be created is left out; with none, inflate() rejects and the caller expands on its own thread. */
  start() {
    if (this.helpers) return this;
    this.helpers = [];
    for (let i = 0; i < this.size; i++) {
      let worker; try { worker = this.create(); } catch { continue; }
      const helper = { worker, jobs: new Map(), queuedBytes: 0 };
      worker.onmessage = ({ data }) => this.settle(helper, data);
      worker.onerror = event => { event?.preventDefault?.(); this.crash(helper, new Error(`APK inflate helper failed: ${event?.message ?? 'error'}`)); };
      this.helpers.push(helper);
    }
    return this;
  }
  get available() { return (this.helpers?.length ?? 0) > 0; }
  /** Expands one entry in the least loaded helper: resolves { bytes, crc } (bytes transferred back), rejects on any helper error. `compressed` is copied, never detached. */
  inflate({ compressed, name, size, limit }) {
    this.start();
    if (!this.helpers.length) return Promise.reject(new Error('no APK inflate helper'));
    const helper = this.helpers.reduce((best, h) => h.queuedBytes < best.queuedBytes ? h : best), id = this.nextId++, copy = compressed.slice();
    return new Promise((resolve, reject) => {
      helper.jobs.set(id, { resolve, reject, bytes: compressed.length }); helper.queuedBytes += compressed.length; this.stats.jobs++; this.stats.bytes += compressed.length;
      try { helper.worker.postMessage({ id, compressed: copy.buffer, name, size, limit }, [copy.buffer]); }
      catch (error) { this.crash(helper, error); }
    });
  }
  /** One file of a load image (src/load-image.js): read in the least loaded helper from the origin private file system (`root`/`dir`/`file`) and its checksum taken there
   *  (src/zip-entry.js contentSum); resolves `{ bytes, sum, ms }` with the bytes transferred here, rejects on any helper error (the caller then does without the image).
   *  `size`: the expected length, for the choice of helper. */
  readImageFile({ root, dir, file, size = 0 }) {
    this.start();
    if (!this.helpers.length) return Promise.reject(new Error('no APK inflate helper'));
    const helper = this.helpers.reduce((best, h) => h.queuedBytes < best.queuedBytes ? h : best), id = this.nextId++;
    return new Promise((resolve, reject) => {
      helper.jobs.set(id, { resolve, reject, bytes: size, image: true }); helper.queuedBytes += size;
      try { helper.worker.postMessage({ id, op: 'image-file', root, dir, file }); }
      catch (error) { this.crash(helper, error); }
    });
  }
  /** The WebCrypto digest `algorithm` (SHA-256 unless named: SHA-1, SHA-256, SHA-384, SHA-512) of `bytes` (a view; copied, never detached) in the least loaded helper: resolves
   *  the digest as an ArrayBuffer (the load image's source hash, src/load-image.js; PackageManager.requestChecksums, src/apk-checksums-host.js). */
  digest(bytes, algorithm = 'SHA-256') {
    this.start();
    if (!this.helpers.length) return Promise.reject(new Error('no APK inflate helper'));
    const helper = this.helpers.reduce((best, h) => h.queuedBytes < best.queuedBytes ? h : best), id = this.nextId++, copy = bytes.slice();
    return new Promise((resolve, reject) => {
      helper.jobs.set(id, { resolve, reject, bytes: bytes.length, digest: true }); helper.queuedBytes += bytes.length;
      try { helper.worker.postMessage({ id, op: 'sha256', algorithm, bytes: copy }, [copy.buffer]); }
      catch (error) { this.crash(helper, error); }
    });
  }
  /** CRC-32 of `bytes` (a view; never detached), in pieces of at least `piece` bytes spread over the helpers, each on its own copy, joined in order (src/zip-entry.js
   *  crc32Combine): resolves the CRC, rejects on any helper error (the caller then takes it on its own thread). */
  crc32(bytes, { piece = 8 << 20 } = {}) {
    this.start();
    if (!this.helpers.length) return Promise.reject(new Error('no APK inflate helper'));
    const count = Math.max(1, Math.min(this.helpers.length, Math.ceil(bytes.length / piece))), size = Math.ceil(bytes.length / count), parts = [];
    for (let at = 0; at < bytes.length || !parts.length; at += size) {
      const view = bytes.subarray(at, Math.min(bytes.length, at + size)), helper = this.helpers.reduce((best, h) => h.queuedBytes < best.queuedBytes ? h : best), id = this.nextId++, copy = view.slice();
      parts.push(new Promise((resolve, reject) => {
        helper.jobs.set(id, { resolve: crc => resolve([crc, view.length]), reject, bytes: view.length, crc: true }); helper.queuedBytes += view.length;
        try { helper.worker.postMessage({ id, op: 'crc32', bytes: copy }, [copy.buffer]); }
        catch (error) { this.crash(helper, error); }
      }));
      if (!bytes.length) break;
    }
    return Promise.all(parts).then(done => done.reduce((crc, [part, length], index) => index ? crc32Combine(crc, part, length) : part, 0));
  }
  settle(helper, data) {
    const job = helper.jobs.get(data?.id); if (!job) return;
    helper.jobs.delete(data.id); helper.queuedBytes -= job.bytes;
    if (job.crc) { if (Number.isInteger(data.crc)) job.resolve(data.crc >>> 0); else job.reject(new Error(String(data?.error ?? 'APK helper gave no CRC'))); return; }
    if (job.digest) { if (data.digest instanceof ArrayBuffer) job.resolve(data.digest); else job.reject(new Error(String(data?.error ?? 'APK helper gave no digest'))); return; }
    if (job.image) { if (data.bytes instanceof Uint8Array && typeof data.sum === 'string') job.resolve({ bytes: data.bytes, sum: data.sum, ms: data.ms }); else job.reject(new Error(String(data?.error ?? 'APK helper gave no image file'))); return; }
    if (data.bytes instanceof Uint8Array && Number.isInteger(data.crc)) job.resolve({ bytes: data.bytes, crc: data.crc >>> 0 });
    else { this.stats.failed++; job.reject(new Error(String(data?.error ?? 'APK inflate helper gave no result'))); }
  }
  /** A helper that failed outright: its jobs are rejected (their callers expand on their own thread) and it takes no more work. */
  crash(helper, error) {
    const at = this.helpers?.indexOf(helper) ?? -1; if (at >= 0) this.helpers.splice(at, 1);
    this.stats.crashed++; for (const job of helper.jobs.values()) job.reject(error); helper.jobs.clear(); helper.queuedBytes = 0;
    try { helper.worker.terminate(); } catch { /* already gone */ }
  }
  dispose() { const error = new Error('APK inflate pool disposed'); for (const helper of this.helpers ?? []) { for (const job of helper.jobs.values()) job.reject(error); helper.jobs.clear(); try { helper.worker.terminate(); } catch { /* already gone */ } } this.helpers = []; }
}
