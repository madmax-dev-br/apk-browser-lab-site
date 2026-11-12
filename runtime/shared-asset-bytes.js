// One download for a file that several providers read: vendor/icu/70.1/icudt70l.dat (3.4 MB) is the common data of both the break iterators (src/icu-break-provider.js) and the
// charset converters (src/icu-converter-native.js). Fetched once per Worker under one URL (the revision query included, so the HTTP cache keeps one entry too); the bytes are shared
// read-only: each provider checks them against its own pinned record and copies them into its own WebAssembly memory. A failed read is forgotten, so the next caller tries again.
const pending = new Map();

/** The bytes of `url`, read with `read(url)` the first time and shared by every later caller in this Worker. */
export function sharedAssetBytes(url, read) {
  const key = String(url);
  let bytes = pending.get(key);
  if (!bytes) { bytes = read(url).catch(error => { pending.delete(key); throw error; }); pending.set(key, bytes); }
  return bytes;
}
