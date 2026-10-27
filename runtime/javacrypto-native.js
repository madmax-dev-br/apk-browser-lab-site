import { APKError } from './apk-error.js?v=d50f2f368405';
import { NativeLibraryProvider, BASE_SONAME } from './jni-host.js?v=d50f2f368405';
import { buildElfDescriptor } from './native-descriptor.js?v=d50f2f368405';
import { sha256Hex } from './sha256-sync.js?v=d50f2f368405';
import { xhrFetchSync } from './native-library-fetch.js?v=d50f2f368405';

// The native half of Android's public-key / TLS stack: System.loadLibrary("javacrypto") from the original Conscrypt classes in the framework DEX
// (com.android.org.conscrypt.NativeCryptoJni) is served by the lab's wasm32 modules libjavacrypto.so, libssl.so and libcrypto.so, built from AOSP's own
// external/conscrypt and external/boringssl at android-13.0.0_r1 (scripts/build-javacrypto.sh, vendor/native-libs/wasm32/javacrypto/provenance.json).
// They are not an app's libraries: they belong to the platform, so every app's JNI bridge gets them, and the bytes are fetched (and SHA-256 verified) only when
// a class actually loads the library. The one platform hook of the modules is their entropy source: crypto.getRandomValues, through apkweb_javacrypto.random_fill.

/** The imports libcrypto.so asks the host for: entropy (crypto.getRandomValues; it throws instead of returning weak bytes). */
export function javacryptoHostImports(bridge) {
  const memory = () => bridge.linker.memory;
  return {
    apkweb_javacrypto: {
      random_fill(pointer, length) {
        if (!globalThis.crypto?.getRandomValues) throw new APKError('WebCrypto secure randomness is unavailable; BoringSSL cannot fall back to a weak source', { kind: 'secure-random-unavailable' });
        for (let at = 0; at < length; at += 65536) globalThis.crypto.getRandomValues(new Uint8Array(memory().buffer, pointer + at, Math.min(65536, length - at)));
      },
    },
  };
}

/**
 * Lab catalog of the javacrypto modules. `provenance` is vendor/native-libs/wasm32/javacrypto/provenance.json, `fetchSync(url)` a synchronous byte GET (the VM cannot suspend while linking),
 * `baseURL` the directory of that file; the base libc++_shared.so and liblog.so (shared by every lab library) are one level up.
 */
export class JavacryptoProvider {
  constructor({ provenance, baseURL, fetchSync, revision = '' }) {
    if (provenance?.schemaVersion !== 1) throw new APKError('Unsupported javacrypto provenance', { kind: 'javacrypto-asset' });
    this.provenance = provenance; this.baseURL = baseURL; this.fetchSync = fetchSync; this.revision = revision; this.fetched = [];
  }
  /** Reads <nativeLibsURL>/javacrypto/provenance.json (async, once); the module bytes are fetched synchronously and lazily, when the interpreter links them. */
  static async fromURL(nativeLibsURL, { revision = '', fetchImpl = globalThis.fetch.bind(globalThis), fetchSync = xhrFetchSync } = {}) {
    const baseURL = new URL('javacrypto/', nativeLibsURL), response = await fetchImpl(new URL('provenance.json' + (revision ? `?v=${revision}` : ''), baseURL));
    if (!response.ok) throw new APKError(`javacrypto provenance not available (${response.status})`, { kind: 'javacrypto-asset' });
    return new JavacryptoProvider({ provenance: await response.json(), baseURL, fetchSync, revision });
  }
  #entry(lib, url) {
    if (!/^[0-9a-f]{64}$/.test(lib.sha256 ?? '')) throw new APKError(`Native library ${lib.soname} needs a pinned SHA-256`);
    const self = this; let bytes = null, module = null;
    const load = () => {
      if (bytes) return;
      const href = new URL(url + (self.revision ? `?v=${self.revision}` : ''), self.baseURL).href, fetched = self.fetchSync(href), actual = sha256Hex(fetched);
      if (actual !== lib.sha256) throw new APKError(`Native library ${lib.soname} does not match its pinned SHA-256 (expected ${lib.sha256}, got ${actual})`, { kind: 'native-library-hash-mismatch' });
      bytes = fetched; module = new WebAssembly.Module(fetched); self.fetched.push(lib.soname);
    };
    return {
      soname: lib.soname, abi: 'wasm32', sha256: lib.sha256, needed: lib.needed, provenance: lib, apkSha256: null, requires: null, platform: true,   // system libraries: not mounted in the app's lib directory
      hostImports: lib.soname === 'libcrypto.so' ? javacryptoHostImports : null,
      descriptor: buildElfDescriptor({ soname: lib.soname, needed: lib.needed, wasmSha256: lib.sha256 }),
      get bytes() { load(); return bytes; }, get module() { load(); return module; },
    };
  }
  /** A NativeLibraryProvider holding `base`'s modules plus the javacrypto trio (and libc++_shared.so / liblog.so unless `base` already has them). */
  compose(base = null) {
    const provider = new NativeLibraryProvider({ abi: base?.abi ?? 'wasm32' });
    for (const [soname, entry] of base?.modules ?? []) provider.modules.set(soname, entry);
    for (const [soname, reason] of base?.unavailable ?? []) provider.unavailable.set(soname, reason);
    for (const lib of Object.values(this.provenance.libraries)) {
      if (provider.modules.has(lib.soname)) { if (lib.shared && provider.modules.get(lib.soname).sha256 !== lib.sha256) throw new APKError(`the ${lib.soname} supplied by the caller is not the one the javacrypto modules link against`, { kind: 'javacrypto-asset' }); continue; }
      provider.modules.set(lib.soname, this.#entry(lib, lib.file));
    }
    return provider;
  }
}

let defaultProvider = null;
/** A page-wide default for loadAPK (the Worker passes its own): the Node test setup (tests/setup-javacrypto.mjs) registers the provider that reads the modules from disk. */
export const setDefaultJavacryptoProvider = provider => { defaultProvider = provider; };
export const getDefaultJavacryptoProvider = () => defaultProvider;

export { BASE_SONAME };
