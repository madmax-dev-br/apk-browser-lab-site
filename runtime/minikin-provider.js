import { APKError } from './apk-error.js?v=e0932d3cf1f5';
import { DIGESTS } from './crypto-host.js?v=e0932d3cf1f5';
import { knownDigest, noteDigest } from './shared-asset-bytes.js?v=e0932d3cf1f5';

// AOSP Minikin (android-13.0.0_r1 frameworks/minikin) with HarfBuzz 3.1.1 and ICU 70.1 in one wasm32 module (vendor/minikin/android-13.0.0_r1/minikin.wasm,
// scripts/wasm/build-minikin.sh). The module is loaded synchronously the first time a text native needs it (a Worker's synchronous read, Node's fs), so an app
// that never lays text out through MeasuredText / LineBreaker pays nothing at load. Every file is checked against the size and SHA-256 of its provenance.
const MAX_WASM = 8 * 1024 * 1024, MAX_DATA = 8 * 1024 * 1024, MAX_META = 256 * 1024;
const fail = message => { throw new APKError('Minikin backend: ' + message, { kind: 'minikin-backend-unavailable' }); };
const hex = bytes => [...DIGESTS['SHA-256'].fn(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
const IMPORTS = new Set(['env.emscripten_notify_memory_growth', 'wasi_snapshot_preview1.fd_close', 'wasi_snapshot_preview1.fd_write', 'wasi_snapshot_preview1.fd_seek', 'wasi_snapshot_preview1.environ_sizes_get', 'wasi_snapshot_preview1.environ_get']);

function checked(bytes, record, name) {
  if (!record || bytes.length !== record.bytes) fail(`${name} size/SHA-256 differs from its provenance`);
  const digest = knownDigest(bytes) ?? hex(bytes); noteDigest(bytes, digest);   // the ICU common data shared with the break iterators was hashed when they checked it
  if (digest !== record.sha256) fail(`${name} size/SHA-256 differs from its provenance`);
  return bytes;
}

/**
 * Loads the module: `readSync(url, limit)` returns the bytes of a URL synchronously. `baseURL` is vendor/minikin/android-13.0.0_r1/, `icuBaseURL` vendor/icu/70.1/
 * (the ICU common data shared with the boundary and converter modules). Returns the raw exports plus small memory helpers.
 */
export function loadMinikin({ readSync, baseURL, icuBaseURL, sharedIcuData = null }) {
  if (typeof readSync !== 'function') fail('needs a synchronous reader (Worker XMLHttpRequest or Node fs)');
  const metadata = JSON.parse(new TextDecoder().decode(readSync(new URL('provenance.json', baseURL), MAX_META)));
  if (metadata.schemaVersion !== 1 || metadata.sourceTag !== 'android-13.0.0_r1' || metadata.artifact !== 'minikin.wasm') fail('unsupported provenance');
  const wasm = checked(readSync(new URL(metadata.artifact, baseURL), MAX_WASM), metadata, 'minikin.wasm');
  const shared = checked(sharedIcuData ?? readSync(new URL('icudt70l.dat', icuBaseURL), MAX_DATA), metadata.icuData?.shared, 'ICU common data');
  const extra = checked(readSync(new URL(metadata.icuData.extra.file, baseURL), MAX_DATA), metadata.icuData.extra, 'Minikin ICU data');
  const module = new WebAssembly.Module(wasm);
  for (const entry of WebAssembly.Module.imports(module)) if (!IMPORTS.has(entry.module + '.' + entry.name)) fail('unexpected import ' + entry.module + '.' + entry.name);
  let api = null;
  // An explicit empty environment and no file descriptors: nothing the module could print reaches anything.
  const instance = new WebAssembly.Instance(module, {
    env: { emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: {
      fd_close: () => 8, fd_seek: () => 8, fd_write: () => 8,
      environ_sizes_get(count, size) { const view = new DataView(api.memory.buffer); view.setUint32(count, 0, true); view.setUint32(size, 0, true); return 0; },
      environ_get: () => 0,
    },
  });
  api = instance.exports; api._initialize();
  const place = bytes => { const pointer = api.mk_malloc(bytes.length + 16); if (!pointer) fail('wasm heap exhausted'); const aligned = (pointer + 15) & ~15; new Uint8Array(api.memory.buffer, aligned, bytes.length).set(bytes); return aligned; };
  // ICU keeps both common-data pointers for the module's lifetime.
  const status = api.mk_initialize(place(shared), place(extra));
  if (status > 0) fail('ICU initialization failed with UErrorCode ' + status);
  return { api, metadata: { ...metadata, source: 'AOSP-Minikin-android-13.0.0_r1/HarfBuzz-3.1.1/ICU-70.1/Wasm', verified: true } };
}
