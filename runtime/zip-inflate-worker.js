// Helper Worker of src/zip-inflate-pool.js: expands one deflated APK entry at a time (the same inflateEntry and crc32 as APKArchive, src/zip-entry.js) and sends the bytes back
// transferred, with their CRC-32. It checks nothing itself: the VM Worker compares size and CRC with the entry's central-directory record and, on any error here, expands the
// entry again on its own thread, so every failure has the message it always had.
import { crc32, inflateEntry, warmCrc32 } from './zip-entry.js?v=a104526a388b';

// Started with the page, idle until an APK arrives: crc32 is run over scratch bytes in three rounds 100 ms apart, so V8's optimized code is ready (and installed) when the first
// entry comes: cold, crc32 of a 17 MB DEX took 21 ms in a fresh helper; after one round still 21 ms on the next call (the optimized code was not ready yet); after the rounds 8-9 ms.
(async () => { for (let round = 0; round < 3; round++) { warmCrc32(); await new Promise(resolve => setTimeout(resolve, 100)); } })();
self.onmessage = async ({ data }) => {
  const { id, compressed, name, size, limit } = data ?? {};
  try {
    const bytes = await inflateEntry(new Uint8Array(compressed), { name, size, limit });
    self.postMessage({ id, bytes, crc: crc32(bytes) }, [bytes.buffer]);
  } catch (error) { self.postMessage({ id, error: String(error?.message ?? error) }); }
};
