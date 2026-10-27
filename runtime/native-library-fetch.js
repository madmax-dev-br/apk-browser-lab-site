import { APKError } from './apk-error.js?v=64078a5322f4';
import { buildElfDescriptor } from './native-descriptor.js?v=64078a5322f4';
import { sha256Hex } from './sha256-sync.js?v=64078a5322f4';

// Browser-side provider of the lab's wasm32 native libraries (vendor/native-libs/wasm32, published next to the page by scripts/build-web.mjs).
//
// provenance.json (small) is read up front: it gives every library's soname, DT_NEEDED and pinned SHA-256, which is all the app's SoLoader needs to see
// (the ELF descriptors mounted in the virtual lib directory). The wasm bytes are fetched LAZILY, the first time a library is actually linked -- that is,
// only for the libraries an app's SoLoader / System.loadLibrary asks for and their DT_NEEDED closure -- and checked against the pinned SHA-256 before they
// are compiled. Linking happens inside the running interpreter, which cannot suspend, so the fetch is a synchronous XMLHttpRequest, which Workers allow
// (the VM runs in a Worker, in the page and in the embeddable player alike).
//
// Same interface as NativeLibraryProvider in jni-host.js: { abi, modules: Map(soname -> entry), has, get }.

/** Default synchronous binary GET (Worker XMLHttpRequest). Injectable for tests. */
export function xhrFetchSync(url) {
  const request = new XMLHttpRequest();
  request.open('GET', url, false);
  request.responseType = 'arraybuffer';
  request.send(null);
  if (request.status !== 200) throw new APKError(`Native library fetch failed: ${url} -> HTTP ${request.status}`, { kind: 'native-library-fetch' });
  return new Uint8Array(request.response);
}

export class LazyNativeLibraryProvider {
  constructor({ provenance, baseURL, revision = '', fetchSync = xhrFetchSync, abi = 'wasm32' }) {
    this.abi = abi; this.modules = new Map(); this.fetched = [];
    for (const lib of Object.values(provenance.libraries)) this.modules.set(lib.soname, this.#entry(lib, baseURL, revision, fetchSync));
  }
  /** Reads provenance.json from `baseURL` (async, once) and returns the provider. */
  static async fromURL(baseURL, { revision = '', fetchImpl = globalThis.fetch.bind(globalThis), fetchSync = xhrFetchSync } = {}) {
    const response = await fetchImpl(new URL('provenance.json' + (revision ? `?v=${revision}` : ''), baseURL));
    if (!response.ok) throw new APKError(`Native library provenance not available (${response.status})`, { kind: 'native-library-fetch' });
    return new LazyNativeLibraryProvider({ provenance: await response.json(), baseURL, revision, fetchSync });
  }
  #entry(lib, baseURL, revision, fetchSync) {
    if (!/^[0-9a-f]{64}$/.test(lib.sha256 ?? '')) throw new APKError(`Native library ${lib.soname} needs a pinned SHA-256`);
    const provider = this;
    let bytes = null, module = null;
    const load = () => {
      if (bytes) return;
      const url = new URL(lib.file + (revision ? `?v=${revision}` : ''), baseURL).href, fetched = fetchSync(url), actual = sha256Hex(fetched);
      if (actual !== lib.sha256) throw new APKError(`Native library ${lib.soname} does not match its pinned SHA-256 (expected ${lib.sha256}, got ${actual})`, { kind: 'native-library-hash-mismatch' });
      bytes = fetched; module = new WebAssembly.Module(fetched); provider.fetched.push(lib.soname);
    };
    return {
      soname: lib.soname, abi: this.abi, sha256: lib.sha256, needed: lib.needed, provenance: lib, apkSha256: lib.apkSha256 ?? null, requires: lib.requires ?? null,
      descriptor: buildElfDescriptor({ soname: lib.soname, needed: lib.needed, wasmSha256: lib.sha256 }),
      get bytes() { load(); return bytes; }, get module() { load(); return module; },
    };
  }
  has(soname) { return this.modules.has(soname); }
  get(soname) { return this.modules.get(soname) ?? null; }
}
