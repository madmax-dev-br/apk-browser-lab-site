// Load image: what one open of an APK computed that depends only on the APK's bytes, kept in the browser's storage and used by the next open of the same APK (in the spirit of
// ART's app image, docs/PERFORMANCE-STRATEGY.md "Step 1: link image: what was done"). The APK itself is never modified, copied or repackaged: the image is a cache derived from
// the untouched file, and a load with it hands the loader exactly the bytes it would have produced without it. Off by default (the device setting "Load image").
//
// What it holds, and why only that (measured on the stress app and example-mega, docs/PERFORMANCE-STRATEGY.md):
//  - the expanded bytes of the APK's deflated entries the last run read: every classes*.dex, the manifest, the compiled XML the load prepared and the small entries the launch
//    read (assets, raw resources; resources.arsc is stored, not deflated, in current APKs). Expanding and CRC-checking them is the only part of the load that depends only on
//    the APK and costs more than reading it back: the DEX files expand in parallel helper Workers, and the load waits for the largest one (43 MB on example-mega).
//  - not the parsed tables: the DEX model is lazy (constructing it for 24 files and 54 000 classes is ~33 ms) and the resource table and XML trees deserialize no faster than
//    they parse (6 MB resources.arsc: 47 ms from a structured clone against 59 ms parsed; 1500 XML trees: 11 against 11 ms); not the core's metaspace: it holds heap
//    references (interned strings, Class objects of static values) and its addresses follow the order in which the run laid classes out, so restoring or replaying it changes
//    allocation order, which a faithful run must not.
//
// Identity and safety. An image is found by a fingerprint of the APK's central directory and used only when, all of them checked before any of its entries is used:
//  - its format and the lab build's revision are the current ones (a rebuilt lab invalidates every image);
//  - the APK's size is the image's, and so is its source hash: SHA-256 over the APK's central directory and the stored (compressed) data of every entry the image holds, read
//    from the APK being opened. Equal source bytes expand to equal bytes, so this is exactly the part of the APK the image stands for; the rest of the APK is read from the file
//    itself as always (hashing all of it would cost ~0.5 ms per MB);
//  - a package installed with its splits (an APK set, or a base APK with split APKs: src/apk-loader.js installSplits) is one image over all of them: the fingerprint and the
//    source hash take every file's length and central directory in the order they were installed (which decides the classesN.dex names a split's code gets), the header
//    records each split's name and size, and its entries are the names the load reads (a split's DEX files under their installed names). The base alone, the base with other
//    splits or the same splits in another order are other packages, with images of their own;
//  - each kept entry is still in the APK's central directory with the same size, compressed size, method and CRC-32, and each stored file has the length and the checksum
//    written with it (src/zip-entry.js ContentSum; the bytes were checked against the entries' CRC-32 when the image was written);
//  - the header itself has the checksum written with it.
// Any mismatch, a missing or unreadable file, or storage the browser refuses, leaves the load on its normal path and the status says which check failed; a damaged or stale
// image is removed and written again after the launch. Nothing is used partially: either every entry of the image is verified and offered, or none is.
//
// What the image does not depend on, and does not hold: the framework profiles the load chooses (they are chosen again from the APK's own code and resources at every open,
// which the image hands over unchanged), the device options (microG, ARM64 native code: the app's libraries are entries of the APK like any other), and the companion
// packages of the device (microG's): they are APKs of their own, read from their own files as without an image, and the status names them.
//
// Opening runs alongside the load (src/apk-loader.js): after the header, the helper Workers read the files (sync access handles) and checksum them, and hash the pieces of
// the source hash, while this thread parses the manifest and the stored resources.arsc; a deflated entry waits for the verdict. Without helpers (Node) all of it runs here.
// Writing happens after a launch, in slices that wait for a quiet Worker (no input, no frame), off the load's path: each DEX file's CRC-32 against the central directory and
// its checksum, the files, the source hash, then the header last (an image without its header does not exist). Memory: the DEX bytes are written from the buffers the DEX
// model already holds; other entries are expanded again one at a time; hashes read 4 MiB pieces. Nothing is held twice.
//
// Layout of one image (a directory named by the fingerprint): one file per DEX file (named as the entry), `other` (the other entries, each 8-aligned), and `header.json`
// ("<checksum>\n<json>": format, lab revision, APK size, its splits' names and sizes, fingerprint and source hash, per file its size and checksum, per entry its name, file,
// offset, size, compressed size, CRC-32). Storage goes through a backend (opfsImageBackend in the browser Worker, memoryImageBackend in tests): list, read, writer, remove, estimate.
import { crc32, ContentSum, contentSum } from './zip-entry.js?v=28012a33f717';
export { ContentSum, contentSum };

export const IMAGE_FORMAT = 3;   // 3: the header records the splits installed with the base (2 had the base APK alone)
export const IMAGE_ROOT = 'apkweb-load-images';
export const IMAGE_LIMITS = Object.freeze({ maxImages: 4, maxOtherEntryBytes: 4 * 1024 * 1024, maxOtherBytes: 48 * 1024 * 1024, sliceBytes: 4 * 1024 * 1024, sliceMs: 8, quotaMargin: 64 * 1024 * 1024 });
const HASH_PIECE = 4 * 1024 * 1024, HEADER = 'header.json', DEX = /^classes\d*\.dex$/;
const utf8 = new TextEncoder(), utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
const now = () => performance.now();
const align8 = n => (n + 7) & ~7;

/** SHA-256 over the length and the SHA-256 of each 4 MiB piece of every one of `parts` (byte views, in order). A few pieces in flight: nothing large is copied at once (Web Crypto
 *  copies its input). `between()` is awaited after each piece. `digest(piece)` (a Promise of the piece's SHA-256 as an ArrayBuffer) computes the pieces elsewhere: the helper
 *  Workers (src/zip-inflate-pool.js digest), `inFlight` of them at a time; the result is the same wherever the pieces are hashed. */
export async function treeHash(parts, { subtle = globalThis.crypto?.subtle, between = null, digest = null, inFlight: most = 4 } = {}) {
  if (typeof subtle?.digest !== 'function') throw new Error('Web Crypto SHA-256 is unavailable');
  const pieceDigest = digest ?? (piece => subtle.digest('SHA-256', piece));
  const pieces = [];
  for (const part of parts) { pieces.push(part.length); for (let at = 0; at < part.length; at += HASH_PIECE) pieces.push(part.subarray(at, Math.min(part.length, at + HASH_PIECE))); }
  const out = new Uint8Array(40 * pieces.length), view = new DataView(out.buffer), inFlight = new Set();
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (typeof piece === 'number') { view.setFloat64(40 * i, piece, true); continue; }   // a part's length, before its pieces
    const job = pieceDigest(piece).then(d => { out.set(new Uint8Array(d), 40 * i + 8); inFlight.delete(job); });
    inFlight.add(job);
    if (inFlight.size >= most) await Promise.race(inFlight);
    if (between) await between();
  }
  await Promise.all(inFlight);
  return hex(await subtle.digest('SHA-256', out));
}
/** The APK files a load reads: the base and every split installed with it (src/apk-loader.js installSplits: archive.splits), in the order they were installed. */
export const packageFiles = archive => [archive, ...(archive.splits ?? []).map(split => split.archive)];
/** Each file's central directory with the end record (a few hundred KiB at most each). */
const directories = archive => packageFiles(archive).map(file => file.reader.bytes.subarray(file.centralDirectoryOffset));
/** The splits as the header records them: [{ name, bytes }] in installation order. */
const splitsOf = archive => (archive.splits ?? []).map(split => ({ name: split.name, bytes: split.archive.reader.length }));
/** The image's source hash: every file's central directory with the end record, then the stored data of each of `names` (in that order, read from the file that holds the entry:
 *  a split's entries from the split), as the APK being opened holds them. */
export function imageSourceHash(archive, names, options) {
  return treeHash([...directories(archive), ...names.map(name => archive.payload(name).compressed)], options);
}
/** Where an APK's image is stored: SHA-256 of each file's length and central directory with the end record (the base, then its splits in order). The source hash decides. */
export async function apkFingerprint(archive, { subtle = globalThis.crypto?.subtle } = {}) {
  const files = packageFiles(archive), tails = directories(archive), data = new Uint8Array(tails.reduce((sum, tail) => sum + 8 + tail.length, 0)), view = new DataView(data.buffer);
  let at = 0; for (let i = 0; i < files.length; i++) { view.setFloat64(at, files[i].reader.length, true); data.set(tails[i], at + 8); at += 8 + tails[i].length; }
  return hex(await subtle.digest('SHA-256', data));
}

/**
 * Routes the reads of `archive` (an APKArchive, after installSplits: its view of the base and the splits) through the load image of this load. Installed only when the setting is
 * on; without it the archive is untouched. A deflated entry read with extract / extractSync / inspectSync / readEntrySync, after the same checks the archive makes (the entry,
 * its limit, its local header), is taken from the image when one is open and holds it (archive.image, set once every check passed), else read as always; an async extract waits
 * for the image's verdict first (archive.imageReady), unless `{ waitImage: false }`. While an image is to be written (archive.reads, a Set), the names of the deflated entries
 * read are noted. prefetch() leaves out the entries the image holds. The view's names are the image's: a split's entries are covered as the base's are.
 */
export function routeImageReads(archive) {
  if (archive.imageRouted) return archive;
  const extract = archive.extract.bind(archive), readSync = archive.readEntrySync.bind(archive), prefetch = archive.prefetch.bind(archive);
  // a deflated entry within its limit (anything else goes to the archive as it is, with its own checks and messages)
  const offered = (name, limit) => { const e = archive.entries.get(name); return e?.method === 8 && Number.isSafeInteger(limit) && limit >= 0 && e.size <= limit ? e : null; };
  archive.readEntrySync = (name, limit) => {
    const e = offered(name, limit);
    if (e && archive.image) { archive.payload(name); const bytes = archive.image.take(name); if (bytes) return bytes; }   // payload(): a malformed local entry fails as without an image
    const data = readSync(name, limit); if (e) archive.reads?.add(name); return data;
  };
  archive.extractSync = archive.inspectSync = (name, limit) => archive.readEntrySync(name, limit);   // both are readEntrySync in every APKArchive (and in each split)
  archive.extract = async (name, limit, { waitImage = true } = {}) => {
    const e = offered(name, limit);
    if (e && (archive.image || archive.imageReady)) {
      archive.payload(name);
      if (archive.imageReady && waitImage) await archive.imageReady;   // the verdict first (`waitImage: false`: expanded now if the image is not open yet)
      const bytes = archive.image?.take(name); if (bytes) return bytes;
    }
    const data = await extract(name, limit); if (e) archive.reads?.add(name); return data;
  };
  archive.prefetch = (names, limit, pool) => prefetch(names.filter(name => !archive.image?.has(name)), limit, pool);
  archive.image = null; archive.reads = null; archive.imageReady = null; archive.imageRouted = true;
  return archive;
}

// ---- storage backends
const isMissing = error => error?.name === 'NotFoundError' || error?.name === 'TypeMismatchError';
export const isQuotaError = error => error?.name === 'QuotaExceededError' || /quota/i.test(String(error?.message ?? ''));
const isLocked = error => error?.name === 'NoModificationAllowedError' || error?.name === 'InvalidStateError';

/** The origin private file system (navigator.storage.getDirectory) under IMAGE_ROOT, one directory per image. Reads through File snapshots (asynchronous); a dedicated Worker
 *  writes through sync access handles, elsewhere writable streams. Null when the browser has no such storage. */
export function opfsImageBackend({ storage = globalThis.navigator?.storage } = {}) {
  if (typeof storage?.getDirectory !== 'function') return null;
  let root = null;
  const top = () => root ??= storage.getDirectory().then(r => r.getDirectoryHandle(IMAGE_ROOT, { create: true })).catch(error => { root = null; throw error; });
  const dir = async (name, create = false) => { try { return await (await top()).getDirectoryHandle(name, { create }); } catch (error) { if (isMissing(error)) return null; throw error; } };
  return {
    kind: 'origin private file system',
    helperReadable: IMAGE_ROOT,   // the helper Workers (same origin) read the image's files themselves: readImageFileHere

    async list() { const out = []; for await (const [name, handle] of (await top()).entries()) if (handle.kind === 'directory') out.push(name); return out; },
    /** The whole file, or with `ranges` ([[at, length], ...]) one buffer of its own per range; null when the file is absent. A range past the end gives a shorter buffer. */
    async read(name, file, ranges = null) {
      const d = await dir(name); if (!d) return null;
      let handle; try { handle = await d.getFileHandle(file); } catch (error) { if (isMissing(error)) return null; throw error; }
      // File reads (not a sync access handle): the browser reads off this thread, which meanwhile parses the resources (a sync read of 60 MB held the thread ~23 ms)
      const snapshot = await handle.getFile();
      if (!ranges) return new Uint8Array(await snapshot.arrayBuffer());
      return Promise.all(ranges.map(async ([at, length]) => new Uint8Array(await snapshot.slice(at, at + length).arrayBuffer())));
    },
    /** A writer of one file: write(bytes) appends, close() flushes. */
    async writer(name, file) {
      const handle = await (await dir(name, true)).getFileHandle(file, { create: true });
      if (typeof handle.createSyncAccessHandle === 'function') {
        const access = await handle.createSyncAccessHandle(); access.truncate(0); let at = 0;
        return { write(bytes) { const n = access.write(bytes, { at }); if (n !== bytes.length) throw new DOMException(`short write of ${file}`, 'QuotaExceededError'); at += n; }, async close() { try { access.flush(); } finally { access.close(); } }, abort() { try { access.close(); } catch { /* closed */ } } };
      }
      const stream = await handle.createWritable();
      return { write: bytes => stream.write(bytes), close: () => stream.close(), abort: () => stream.abort().catch(() => {}) };
    },
    async remove(name) { try { await (await top()).removeEntry(name, { recursive: true }); } catch (error) { if (!isMissing(error)) throw error; } },
    async estimate() { return typeof storage.estimate === 'function' ? storage.estimate() : null; },
  };
}

/** Reads one file of an image in a helper Worker (src/zip-inflate-worker.js): `root`/`dir`/`file` of the origin private file system, through a sync access handle where the
 *  browser offers one (a dedicated Worker: the fastest read, and this thread has nothing else to do), else through a File. Throws NotFoundError when it is absent. */
export async function readImageFileHere({ root, dir, file, storage = globalThis.navigator?.storage }) {
  if (typeof storage?.getDirectory !== 'function') throw new Error('no origin private file system in this helper');
  const handle = await (await (await (await storage.getDirectory()).getDirectoryHandle(root)).getDirectoryHandle(dir)).getFileHandle(file);
  if (typeof handle.createSyncAccessHandle === 'function') {
    const access = await handle.createSyncAccessHandle();
    try { const out = new Uint8Array(access.getSize()), read = access.read(out, { at: 0 }); if (read !== out.length) throw new Error(`short read of ${file}: ${read} of ${out.length} bytes`); return out; }
    finally { access.close(); }
  }
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

/** In-memory backend (tests, Node): the same contract; `quota` (bytes) makes writes beyond it fail as the browser's quota does; `fail` names operations that throw. */
export function memoryImageBackend({ quota = Infinity, fail = {} } = {}) {
  const dirs = new Map(); const used = () => { let n = 0; for (const files of dirs.values()) for (const bytes of files.values()) n += bytes.length; return n; };
  const check = op => { if (fail[op]) throw Object.assign(new Error(`${op} failed (test)`), { name: fail[op] === true ? 'Error' : fail[op] }); };
  return {
    kind: 'memory', dirs,
    async list() { check('list'); return [...dirs.keys()]; },
    async read(name, file, ranges = null) { check('read'); const bytes = dirs.get(name)?.get(file); if (!bytes) return null; return ranges ? ranges.map(([at, length]) => bytes.slice(at, at + length)) : bytes.slice(); },
    async writer(name, file) {
      check('write'); const files = dirs.get(name) ?? dirs.set(name, new Map()).get(name), parts = []; files.set(file, new Uint8Array(0)); let length = 0;
      return {
        write(bytes) { if (used() + length + bytes.length > quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); parts.push(bytes.slice()); length += bytes.length; },
        async close() { const out = new Uint8Array(length); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } files.set(file, out); },
        abort() {},
      };
    },
    async remove(name) { check('remove'); dirs.delete(name); },
    async estimate() { return Number.isFinite(quota) ? { usage: used(), quota } : null; },
  };
}

// ---- the session of one load
const describe = error => String(error?.message ?? error).slice(0, 160);
const refusal = message => Object.assign(new Error(message), { refusal: true });
/**
 * Opens the image of `archive` (an APKArchive over the APK's bytes) for one load, before anything is expanded. `config`: { backend, revision, pool?, limits?, subtle? }; `pool`
 * (src/zip-inflate-pool.js) checks the DEX files' checksums in its helper Workers, in parallel, instead of this thread.
 * Returns a LoadImage: `active` when every check passed (the archive then takes the image's entries instead of expanding them), its `status` says what happened either way.
 */
export async function openLoadImage(archive, config = {}) {
  const image = new LoadImage(archive, config); await image.open(); return image;
}
/** The same open, returned as soon as its reads are in flight (or it ended early: no image, refused, unavailable): `{ image, opened }`, `opened` resolving with the image when
 *  every check is done. The loader then parses what needs no image (the manifest, the stored resources.arsc) while the browser reads the files and the helpers check them. */
export async function beginLoadImage(archive, config = {}) {
  const image = new LoadImage(archive, config), opened = image.open().catch(error => image.fail(error)).then(() => image);   // never rejects: a failure is the image's status
  await image.issued; return { image, opened };
}

export class LoadImage {
  constructor(archive, { backend = null, revision = null, pool = null, limits = {}, subtle = globalThis.crypto?.subtle } = {}) {
    this.archive = archive; this.backend = backend; this.revision = revision; this.pool = pool; this.limits = { ...IMAGE_LIMITS, ...limits }; this.subtle = subtle;
    this.entries = new Map(); this.active = false; this.fingerprint = null; this.dexFiles = null; this.writing = null; this.removeStale = false;
    this.status = { state: 'off', reason: null, kind: backend?.kind ?? null };
    this.issued = new Promise(resolve => { this.markIssued = resolve; });   // resolved once the open's reads are in flight, or the open ended (beginLoadImage)
  }
  /** Is entry `name` offered by the image (DEX prefetch skips it). */
  has(name) { return this.active && this.entries.has(name); }
  /** The expanded bytes of entry `name` (checked at open against the APK's entry and the stored checksum), or null: a DEX file's own buffer once, other entries as a copy each time. */
  take(name) {
    if (!this.active) return null; const entry = this.entries.get(name); if (!entry) return null;
    this.status.taken = (this.status.taken ?? 0) + 1;
    if (entry.own) { this.entries.delete(name); return entry.bytes; }
    return entry.bytes.slice();
  }
  /** After the launch: the image's buffers are dropped and the archive expands as without an image. */
  release() { this.entries.clear(); if (this.archive.image === this) this.archive.image = null; this.active = false; if (this.status.state === 'used') this.status.released = true; }

  refuse(reason, { remove = true } = {}) { this.status = { ...this.status, state: 'refused', reason }; this.removeStale = remove; this.entries.clear(); this.active = false; }
  /** An open that failed outside its checks: the load goes on without the image, the status says why. */
  fail(error) { this.entries.clear(); this.active = false; if (this.archive.image === this) this.archive.image = null; this.status = { ...this.status, state: 'unavailable', reason: `the image could not be opened: ${describe(error)}` }; this.markIssued(); }
  async open() { try { await this.openImage(); } finally { this.markIssued(); } }
  async openImage() {
    const started = now(), archive = this.archive;
    if (!this.backend) { this.status = { state: 'unavailable', reason: 'the browser offers no origin private file system to this Worker', kind: null }; return; }
    if (!this.revision) { this.status = { state: 'off', reason: 'this lab build has no revision (a source checkout): an image could not be told stale', kind: this.backend.kind }; return; }
    if (typeof this.subtle?.digest !== 'function') { this.status = { state: 'unavailable', reason: 'Web Crypto SHA-256 is unavailable', kind: this.backend.kind }; return; }
    this.status = { state: 'absent', reason: null, kind: this.backend.kind };
    try {
      const steps = {}, step = name => { steps[name] = Math.round(now() - started); };   // where the time of an open went (the status keeps it)
      this.fingerprint = await apkFingerprint(archive, { subtle: this.subtle }); step('fingerprint');
      const text = await this.backend.read(this.fingerprint, HEADER); step('header');
      if (!text) { this.status.reason = 'no image of this APK yet: it is written after the launch'; return; }
      const header = this.parseHeader(text); if (!header) return;
      // every entry is still the APK's (central directory), and the source hash says its stored data is too: started now, it runs while the files are read and checked
      for (const entry of header.entries) {
        const zip = archive.entries.get(entry.name);
        if (!zip || zip.method !== 8 || zip.size !== entry.size || zip.compressed !== entry.compressed || zip.crc !== entry.crc) return this.refuse(`the APK's entry ${entry.name} is not the one the image holds`);
      }
      // the source hash: its pieces hashed in the helper Workers when there are some (a copy of each 4 MiB piece of the stored data goes there), so that this thread is free for the
      // resources and the hash is not held back by them (on this thread it finished last, ~110 ms into the large example's load)
      const helpers = !!(this.pool?.readImageFile && this.backend.helperReadable && this.pool.start?.()?.available); steps.readIn = helpers ? 'helpers' : 'this thread';
      const hashing = imageSourceHash(archive, header.entries.map(entry => entry.name), { subtle: this.subtle, ...(helpers ? { digest: piece => this.pool.digest(piece), inFlight: 64 } : {}) });
      hashing.then(() => step('source hashed'), () => {});
      // the files: each DEX file in a file of its own, the other entries together in `other`; every entry inside a file the header describes
      const files = header.files, names = Object.keys(files);
      for (const entry of header.entries) {
        const file = Object.hasOwn(files, entry.file) ? files[entry.file] : null;
        if (!file || !(Number.isSafeInteger(entry.at) && entry.at >= 0 && entry.at + entry.size <= file.size)) return this.refuse(`the image header does not place ${entry.name} in one of its files`);
      }
      // read and checked in the helper Workers when there are some (each file read there from the origin private file system and its checksum taken, then transferred here: this
      // thread meanwhile parses the resources), else read here (asynchronously) and checked here. One checksum per file: the loop is then optimized (1500 small calls of it on this
      // thread ran unoptimized, ~110 ms for 2 MB of compiled XML on the large example).
      const readOne = name => helpers
        ? this.pool.readImageFile({ root: this.backend.helperReadable, dir: this.fingerprint, file: name, size: files[name].size }).then(r => { steps.helperMs = Math.max(steps.helperMs ?? 0, Math.round(r.ms ?? 0)); return r; }, error => { throw Object.assign(new Error(describe(error)), { name: /NotFound/.test(String(error?.message)) ? 'NotFoundError' : 'HelperError' }); })
        : this.backend.read(this.fingerprint, name).then(bytes => bytes && { bytes, sum: contentSum(bytes) });
      const reading = Promise.allSettled(names.map(readOne));
      this.markIssued();
      const results = await reading; step('read and checked');
      const checked = new Map();
      for (let i = 0; i < names.length; i++) {
        const name = names[i], result = results[i], want = files[name];
        if (result.status === 'rejected') {
          if (result.reason?.name === 'NotFoundError') return this.refuse(`the image's file ${name} is missing`);
          if (result.reason?.name === 'HelperError') return this.refuse(`the image could not be read in a helper (${describe(result.reason)})`, { remove: false });
          throw result.reason;
        }
        const got = result.value;
        if (!got) return this.refuse(`the image's file ${name} is missing`);
        if (got.bytes.length !== want.size) return this.refuse(`the image's file ${name} has ${got.bytes.length} bytes, its header says ${want.size}`);
        if (got.sum !== want.sum) return this.refuse(`the checksum of the image's file ${name} does not match (damaged storage)`);
        checked.set(name, got.bytes);
      }
      const offered = new Map();
      for (const entry of header.entries) {
        const bytes = checked.get(entry.file), whole = entry.at === 0 && entry.size === bytes.length;
        offered.set(entry.name, { bytes: whole ? bytes : bytes.subarray(entry.at, entry.at + entry.size), own: whole && DEX.test(entry.name) });   // a DEX file's own buffer goes to the DEX model as it is
      }
      let source; try { source = await hashing; } catch (error) { return this.refuse(`the image could not be checked (source hash: ${describe(error)})`, { remove: false }); } step('source hash');
      if (source !== header.source) return this.refuse('the APK\'s stored data for the image\'s entries differs from the image\'s (its source hash)');
      this.entries = offered; this.active = true; archive.image = this;
      let bytes = 0, dex = 0; for (const [name, entry] of offered) { bytes += entry.bytes.length; if (DEX.test(name)) dex++; }
      this.status = { state: 'used', reason: null, kind: this.backend.kind, entries: offered.size, dex, bytes, splits: header.apk.splits.length, createdAt: header.createdAt, ms: Math.round(now() - started), steps };
    } catch (error) {
      this.entries.clear(); this.active = false;
      this.status = { state: isLocked(error) ? 'refused' : 'unavailable', reason: isLocked(error) ? 'the image is being written by another tab' : `storage error: ${describe(error)}`, kind: this.backend.kind };
    } finally { this.status.ms ??= Math.round(now() - started); }
  }
  parseHeader(bytes) {
    let header;
    try {
      const text = utf8Decoder.decode(bytes), cut = text.indexOf('\n'), sum = text.slice(0, cut), body = text.slice(cut + 1);
      if (cut < 0 || contentSum(utf8.encode(body)) !== sum) { this.refuse('the image header\'s checksum does not match (damaged or partly written)'); return null; }
      header = JSON.parse(body);
    } catch { this.refuse('the image header is unreadable'); return null; }
    if (header?.format !== IMAGE_FORMAT) { this.refuse(`the image's format ${header?.format} is not this lab's ${IMAGE_FORMAT}`); return null; }
    if (header.lab !== this.revision) { this.refuse(`the image was written by lab build ${header.lab}, this is ${this.revision}`); return null; }
    if (header.apk?.bytes !== this.archive.reader.length || header.apk?.fingerprint !== this.fingerprint) { this.refuse('the APK\'s size or central directory differs from the image\'s'); return null; }
    // the splits installed with the base: the same ones, in the same order, of the same sizes (the fingerprint covers them too; this names what differs)
    const splits = splitsOf(this.archive), recorded = Array.isArray(header.apk.splits) ? header.apk.splits : null;
    if (!recorded || recorded.length !== splits.length || recorded.some((split, i) => split?.name !== splits[i].name || split?.bytes !== splits[i].bytes)) { this.refuse(`the image was written for ${recorded?.length ? `the splits ${recorded.map(split => split?.name).join(', ')}` : 'the base APK alone'}, this load installs ${splits.length ? `the splits ${splits.map(split => split.name).join(', ')}` : 'the base APK alone'}`); return null; }
    if (!Array.isArray(header.entries) || !header.entries.length || typeof header.source !== 'string') { this.refuse('the image lists no entries'); return null; }
    const files = header.files, fileName = /^[A-Za-z0-9._-]{1,64}$/;
    if (!files || typeof files !== 'object' || Array.isArray(files) || !Object.entries(files).every(([name, file]) => fileName.test(name) && name !== HEADER && Number.isSafeInteger(file?.size) && file.size >= 0 && typeof file.sum === 'string')) { this.refuse('the image header does not describe its files'); return null; }
    return header;
  }

  /**
   * Writes the image of this APK after a launch (not when this load used one). `dexFiles`: [{ filename, dex }] of the APK (their bytes as the loader extracted them), `reads`: the
   * other entry names the run read. `waitQuiet()` is awaited between slices; `cancelled()` (the APK was closed) stops the write and removes what it wrote. Resolves with the status;
   * never throws.
   */
  async write({ dexFiles = this.dexFiles ?? [], reads = this.archive.reads, waitQuiet = async () => {}, cancelled = () => false } = {}) {
    if (this.writing) return this.writing;
    return this.writing = this.writeImage({ dexFiles, reads, waitQuiet, cancelled });
  }
  async writeImage({ dexFiles, reads, waitQuiet, cancelled }) {
    const archive = this.archive, limits = this.limits;
    if (!this.backend || !this.revision || !this.fingerprint || this.status.state === 'used' || this.status.state === 'unavailable' || this.status.state === 'off') return this.status;
    if (this.status.state === 'refused' && !this.removeStale) return this.status;   // in use elsewhere, or not checkable now: left as it is
    archive.reads = null;   // what was read until now is what the image keeps
    const started = now(); let busy = 0;
    const stop = () => { if (cancelled()) throw refusal('the APK was closed before its image was written'); };
    // steps run back to back until a slice has taken limits.sliceMs, then the next one waits for a quiet Worker
    let sliceStart = -Infinity;
    const slice = async work => { if (now() - sliceStart >= limits.sliceMs) { await waitQuiet(); stop(); sliceStart = now(); } const at = now(); try { return await work(); } finally { busy += now() - at; } };
    const written = { state: 'writing', since: Date.now() }; this.status.write = written;
    let created = false;
    try {
      // what goes in: every DEX file as the DEX model holds it, then the other deflated entries the run read (bounded)
      const dex = [], other = []; let otherBytes = 0;
      for (const { filename, dex: file } of dexFiles) {
        const zip = archive.entries.get(filename), bytes = file?.reader?.bytes;
        if (!zip || zip.method !== 8 || !(bytes instanceof Uint8Array) || bytes.length !== zip.size) throw refusal(`${filename} is not held as the APK's entry`);
        dex.push({ name: filename, zip, bytes });
      }
      for (const name of [...(reads ?? [])].sort()) {
        const zip = archive.entries.get(name);
        if (!zip || zip.method !== 8 || DEX.test(name) || zip.size > limits.maxOtherEntryBytes || otherBytes + zip.size > limits.maxOtherBytes) continue;
        other.push({ name, zip }); otherBytes += zip.size;
      }
      const total = dex.reduce((sum, item) => sum + item.zip.size, 0) + otherBytes;
      await slice(async () => {   // room: older images go first, then the quota
        const others = (await this.backend.list()).filter(name => name !== this.fingerprint), dated = [];
        for (const name of others) { let createdAt = 0; try { const text = utf8Decoder.decode((await this.backend.read(name, HEADER)) ?? new Uint8Array()); createdAt = Number(JSON.parse(text.slice(text.indexOf('\n') + 1)).createdAt) || 0; } catch { /* unreadable: oldest */ } dated.push({ name, createdAt }); }
        dated.sort((x, y) => x.createdAt - y.createdAt);
        while (dated.length >= limits.maxImages) await this.backend.remove(dated.shift().name);
        await this.backend.remove(this.fingerprint);
        const estimate = await this.backend.estimate?.().catch(() => null);
        while (estimate && Number.isFinite(estimate.quota) && estimate.quota - estimate.usage < total + limits.quotaMargin && dated.length) { await this.backend.remove(dated.shift().name); Object.assign(estimate, await this.backend.estimate()); }
        if (estimate && Number.isFinite(estimate.quota) && estimate.quota - estimate.usage < total + limits.quotaMargin) throw new DOMException(`the image needs ${Math.round(total / 1048576)} MiB and the browser grants ${Math.max(0, Math.round((estimate.quota - estimate.usage) / 1048576))} MiB more`, 'QuotaExceededError');
      });
      created = true;
      const entries = [];
      const files = {};
      for (const item of dex) { // each DEX file in a file of its own (read back into a buffer of its own), checked against the APK's CRC-32 as it is written
        const writer = await slice(() => this.backend.writer(this.fingerprint, item.name)), sum = new ContentSum(); let crc = 0;
        try {
          for (let from = 0; from < item.bytes.length; from += limits.sliceBytes) await slice(async () => { const piece = item.bytes.subarray(from, Math.min(item.bytes.length, from + limits.sliceBytes)); crc = crc32(piece, crc); sum.update(piece); await writer.write(piece); });
          if (crc !== item.zip.crc) throw refusal(`${item.name} no longer matches the APK's CRC-32`);
          await slice(() => writer.close());
        } catch (error) { writer.abort?.(); throw error; }
        files[item.name] = { size: item.bytes.length, sum: sum.hex() };
        entries.push({ name: item.name, file: item.name, at: 0, size: item.zip.size, compressed: item.zip.compressed, crc: item.zip.crc });
      }
      if (other.length) { // the other entries, expanded again (and CRC-checked there) one at a time, into one file with one checksum
        const writer = await slice(() => this.backend.writer(this.fingerprint, 'other')); let at = 0; const sum = new ContentSum();
        const put = async bytes => { sum.update(bytes); await writer.write(bytes); at += bytes.length; };
        try {
          for (const item of other) await slice(async () => {
            let bytes; try { bytes = archive.readEntrySync(item.name, item.zip.size); } catch { return; }   // an entry that cannot be read is simply not kept
            entries.push({ name: item.name, file: 'other', at, size: bytes.length, compressed: item.zip.compressed, crc: item.zip.crc });
            // each entry padded to 8 bytes in one piece: every piece the checksum is fed is then a multiple of 4, so it equals the checksum of the whole file read back
            if (bytes.length & 7) { const padded = new Uint8Array(align8(bytes.length)); padded.set(bytes); bytes = padded; }
            await put(bytes);
          });
          await slice(() => writer.close());
        } catch (error) { writer.abort?.(); throw error; }
        if (entries.some(entry => entry.file === 'other')) files.other = { size: at, sum: sum.hex() };
      }
      const source = await imageSourceHash(archive, entries.map(entry => entry.name), { subtle: this.subtle, between: async () => { if (now() - sliceStart >= limits.sliceMs) { await waitQuiet(); stop(); sliceStart = now(); } } });
      const body = JSON.stringify({ format: IMAGE_FORMAT, lab: this.revision, apk: { bytes: archive.reader.length, fingerprint: this.fingerprint, splits: splitsOf(archive) }, source, createdAt: Date.now(), files, entries });
      await slice(async () => { const writer = await this.backend.writer(this.fingerprint, HEADER); await writer.write(utf8.encode(`${contentSum(utf8.encode(body))}\n${body}`)); await writer.close(); });   // last: the image exists from here
      const bytes = entries.reduce((sum, e) => sum + e.size, 0);
      Object.assign(written, { state: 'written', entries: entries.length, dex: entries.filter(e => DEX.test(e.name)).length, splits: splitsOf(archive).length, bytes, cpuMs: Math.round(busy), wallMs: Math.round(now() - started) });
    } catch (error) {
      if (created) await this.backend.remove(this.fingerprint).catch(() => {});   // a partial image is removed: never one without all its entries
      Object.assign(written, { state: 'refused', reason: isQuotaError(error) ? `storage quota: ${describe(error)}` : error?.refusal ? describe(error) : `storage error: ${describe(error)}`, cpuMs: Math.round(busy), wallMs: Math.round(now() - started) });
    }
    return this.status;
  }
}

/** One line for the diagnostics summary: whether this load used an image, why not, and what was written after the launch. */
export function loadImageText(status) {
  if (!status) return '';
  const MiB = bytes => `${Math.round(bytes / 1048576)} MiB`;
  let line;
  const of = splits => splits ? ` of the APK and its ${splits === 1 ? 'split' : `${splits} splits`}` : '';
  if (status.state === 'used') line = `Load image: used (${status.dex} DEX files and ${status.entries - status.dex} other entries${of(status.splits)}, ${MiB(status.bytes)}, read and checked in ${status.ms} ms; nothing of them expanded again)`;
  else if (status.state === 'absent') line = `Load image: none for this APK yet${status.reason ? ` (${status.reason})` : ''}`;
  else if (status.state === 'refused') line = `Load image: refused, the APK was loaded without it: ${status.reason}`;
  else if (status.state === 'unavailable') line = `Load image: unavailable (${status.reason})`;
  else line = `Load image: off${status.reason ? ` (${status.reason})` : ''}`;
  const w = status.write;
  if (w?.state === 'written') line += `; written after the launch: ${w.dex} DEX files and ${w.entries - w.dex} other entries${of(w.splits)}, ${MiB(w.bytes)}, ${w.cpuMs} ms of Worker time over ${(w.wallMs / 1000).toFixed(1)} s`;
  else if (w?.state === 'refused') line += `; not written: ${w.reason}`;
  else if (w?.state === 'writing') line += '; being written';
  if (status.companions?.length && status.state !== 'off') line += `; not in it: the device's companion packages ${status.companions.join(', ')} (read from their own APKs)`;
  return line;
}
