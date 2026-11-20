import { APKError } from './apk-error.js?v=d5fbbbba7c85';
import { buildElfDescriptor } from './native-descriptor.js?v=d5fbbbba7c85';
import { sha256Hex } from './sha256-sync.js?v=d5fbbbba7c85';
import { withVariants } from './native-provider-variants.js?v=d5fbbbba7c85';

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

/** The asynchronous way to the same verified module, for a library known to be linked soon (prefetch): fetch, SHA-256 by Web Crypto, compile off the interpreter's path. */
export async function fetchVerifiedModule(url, sha256, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new APKError(`Native library fetch failed: ${url} -> HTTP ${response.status}`, { kind: 'native-library-fetch' });
  const bytes = new Uint8Array(await response.arrayBuffer()), actual = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (actual !== sha256) throw new APKError(`Native library at ${url} does not match its pinned SHA-256 (expected ${sha256}, got ${actual})`, { kind: 'native-library-hash-mismatch' });
  return { bytes, module: await WebAssembly.compile(bytes) };
}

/** Gives `entry` a non-enumerable prefetch(): the asynchronous load of fetchVerifiedModule, whose result the synchronous load at link time takes if it is there by then. A prefetch
 *  that fails is forgotten: the link then loads synchronously and reports the failure itself. `adopt({ bytes, module })` stores a result unless the entry was loaded meanwhile. */
export function definePrefetch(entry, url, sha256, adopt) {
  let ahead = null;
  Object.defineProperty(entry, 'prefetch', { enumerable: false, value: () => ahead ??= fetchVerifiedModule(url(), sha256).then(adopt, () => { ahead = null; }) });
}

export class LazyNativeLibraryProvider {
  /** `releases`: the provenance of the React Native libraries of the other releases the lab builds ({ provenance, baseURL }: vendor/native-libs/wasm32/rn/<version>/),
   *  added before the default release's, as variants of the same sonames (src/native-provider-variants.js hands each app the build of its release). */
  constructor({ provenance, baseURL, revision = '', fetchSync = xhrFetchSync, abi = 'wasm32', releases = [] }) {
    this.abi = abi; this.modules = new Map(); this.fetched = [];
    for (const release of [...releases, { provenance, baseURL }]) {
      for (const lib of Object.values(release.provenance.libraries)) this.modules.set(lib.soname, withVariants(this.modules.get(lib.soname), this.#entry(lib, release.baseURL, revision, fetchSync)));
    }
  }
  /** Reads provenance.json from `baseURL` (async, once), and the provenance.json of every React Native release it lists (reactNativeReleases, each checked against
   *  the SHA-256 recorded there), and returns the provider. */
  static async fromURL(baseURL, { revision = '', fetchImpl = globalThis.fetch.bind(globalThis), fetchSync = xhrFetchSync } = {}) {
    const response = await fetchImpl(new URL('provenance.json' + (revision ? `?v=${revision}` : ''), baseURL));
    if (!response.ok) throw new APKError(`Native library provenance not available (${response.status})`, { kind: 'native-library-fetch' });
    const provenance = await response.json();
    const releases = await Promise.all((provenance.reactNativeReleases ?? []).map(async release => {
      const url = new URL(release.provenance + (revision ? `?v=${revision}` : ''), baseURL), answer = await fetchImpl(url);
      if (!answer.ok) throw new APKError(`Native library provenance of React Native ${release.version} not available (${answer.status})`, { kind: 'native-library-fetch' });
      const bytes = new Uint8Array(await answer.arrayBuffer()), actual = sha256Hex(bytes);
      if (actual !== release.sha256) throw new APKError(`${release.provenance} does not match the SHA-256 provenance.json pins for React Native ${release.version} (expected ${release.sha256}, got ${actual})`, { kind: 'native-library-hash-mismatch' });
      return { provenance: JSON.parse(new TextDecoder().decode(bytes)), baseURL: new URL(release.provenance.replace(/provenance\.json$/, ''), baseURL) };
    }));
    return new LazyNativeLibraryProvider({ provenance, baseURL, revision, fetchSync, releases });
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
    const entry = {
      soname: lib.soname, abi: this.abi, sha256: lib.sha256, needed: lib.needed, provenance: lib, apkSha256: lib.apkSha256 ?? null, requires: lib.requires ?? null,
      descriptor: buildElfDescriptor({ soname: lib.soname, needed: lib.needed, wasmSha256: lib.sha256 }),
    };
    // Non-enumerable: the lazy fetch must only happen when a library is linked, never because something walked the entry's properties (the garbage collector's root scan did: it fetched,
    // hashed and compiled every wasm module on the first collection, ~0.5 s in the browser Worker and the memory of all of them).
    Object.defineProperty(entry, 'bytes', { get() { load(); return bytes; }, enumerable: false });
    Object.defineProperty(entry, 'module', { get() { load(); return module; }, enumerable: false });
    definePrefetch(entry, () => new URL(lib.file + (revision ? `?v=${revision}` : ''), baseURL).href, lib.sha256, ready => { if (!bytes) { bytes = ready.bytes; module = ready.module; provider.fetched.push(lib.soname); } });
    return entry;
  }
  has(soname) { return this.modules.has(soname); }
  get(soname) { return this.modules.get(soname) ?? null; }
}
