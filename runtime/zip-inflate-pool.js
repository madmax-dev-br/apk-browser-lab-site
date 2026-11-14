// Helper Workers that expand an APK's deflated DEX files in parallel (src/zip-inflate-worker.js). One VM Worker thread expanding and checking the DEX files one after another
// spent about 80 ms on the heavy example's 24 MB of DEX (deflate-raw ~40 ms, CRC-32 ~30 ms cold), and it grows with the app; spread over helpers the wait is the largest file's.
//
// The pool only computes: APKArchive (src/apk-loader.js) asks it ahead (prefetch), and extract() still compares size and CRC with the central directory and, when a helper
// failed in any way (an error, a crash, no helper left), expands the entry on its own thread, so results and error messages are those of the sequential path.
// The VM Worker starts the pool when the page opens (src/apk-worker.js warmAssets): the helpers load their two modules and warm crc32 while the user picks an APK.

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
  settle(helper, data) {
    const job = helper.jobs.get(data?.id); if (!job) return;
    helper.jobs.delete(data.id); helper.queuedBytes -= job.bytes;
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
