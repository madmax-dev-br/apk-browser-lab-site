import { setMethodInterceptor } from './method-overrides.js?v=5abc89d1cc06';

// DroidGuard, SafetyNet and Play Integrity on the "com microG" device (CLAUDE.md, docs/MICROG.md section 6).
//
// With the device's attestation settings on (microG's `safetynet_enabled` and `droidguard_enabled`), microG's own code does the work: DroidGuardServiceImpl.getHandle ->
// NetworkHandleProxyFactory.createHandle fetches the DroidGuard VM from Google's androidantiabuse API through the lab's network stack, stores it in
// <dataDir>/app_cache_dg/<vmKey>/the.apk and HandleProxyFactory loads it with a DexClassLoader, then reflects the VM's `init`/`run`/`ss`/`close`. The lab changes none of that:
// the downloaded code is loaded like any dex, and what it does is the VM's own. The VM ships native code; the lab runs native code only as wasm32 libraries rebuilt from
// source (src/native-linker.js), never machine code taken from a downloaded package, so the VM's System.loadLibrary ends with an explicit UnsatisfiedLinkError that names
// the library and the ABI (`droidGuardNativeUnavailable`), recorded as a microG device failure. microG then gives its own answer (its fallback creator, "ERROR : ..."), and
// SafetyNet / Play Integrity report what microG's code makes of it. The lab never produces a token, a verdict or an attestation result itself.
//
// What stays refused is DroidGuard's network mode (microG's `droidguard_mode` = Network, `droidguard_network_server_url`): a remote DroidGuard server answers from ITS device,
// so a token from it would attest another device than this one. microG's RemoteHandleImpl is refused explicitly whatever the settings say.

const GMS = 'com.google.android.gms';
/** The device's ABI (Build.SUPPORTED_ABIS = ro.product.cpu.abilist, src/device-identity.js): the only machine code the lab runs is wasm32 libraries rebuilt from source. */
const DEVICE_ABI = 'wasm32';
/** Where microG keeps the VM it downloads (HandleProxyFactory: Context.getDir("cache_dg") = <dataDir>/app_cache_dg) and loads it with a DexClassLoader. */
const VM_CACHE = /\/app_cache_dg\//;

export const DROIDGUARD_NETWORK_MODE_REFUSAL = "DroidGuard network mode is refused by the virtual device: a remote DroidGuard server answers from its own device, so its result would attest another device than this one";
const NETWORK_MODE_OWNER = 'Lorg/microg/gms/droidguard/core/RemoteHandleImpl;';
const NETWORK_MODE_METHODS = ['<init>', 'init', 'initWithRequest', 'snapshot'];

const note = (microg, failure) => {
  const known = microg.failures.find(item => item.kind === failure.kind && item.library === failure.library && item.api === failure.api);
  if (known) { known.hits = (known.hits ?? 1) + 1; return known; }
  microg.failures.push({ ...failure, hits: 1 }); return null;
};

/** Whether class `owner` was defined by a loader that loaded the DroidGuard VM from microG's cache (marked by `onDexClassLoader`, walking up the parents). */
function isVmCode(runtime, owner) {
  if (!owner) return false;
  for (let loader = runtime.classOwners?.get(owner), depth = 0; loader && depth < 64; depth++) {
    const object = runtime.object(loader);
    if (object.droidGuardVm) return true;
    loader = object.dexLoader?.parent ?? null;
  }
  return false;
}

/**
 * The hook behind System.loadLibrary of code microG downloaded for DroidGuard (called from the device's onNativeLibraryUnavailable): returns the message of the
 * UnsatisfiedLinkError, or undefined when the load is not DroidGuard's. Records the failure once per library (trace and deviceOptions.microg.failures).
 */
export function droidGuardNativeUnavailable(runtime, microg, library) {
  if (!microg) return undefined;
  if (!isVmCode(runtime, runtime.currentMethod?.owner) && !(runtime.captureStack?.() ?? []).some(frame => isVmCode(runtime, frame?.owner))) return undefined;
  const file = `lib${library}.so`;
  const reason = 'the DroidGuard VM needs native code the device cannot run';
  const repeated = note(microg, { kind: 'microg-droidguard-native', api: 'DroidGuard', library: file, abi: DEVICE_ABI, reason: `${reason}: it is ARM machine code in a downloaded package, and the lab runs native code only as ${DEVICE_ABI} libraries rebuilt from source; microG gets the UnsatisfiedLinkError and answers with its own fallback, so SafetyNet and Play Integrity attestation cannot succeed on this device` });
  if (!repeated) runtime.record(`DEVICE microG FAILURE DroidGuard: ${reason} (${file}, ABI ${DEVICE_ABI}); microG's HandleProxy gets the UnsatisfiedLinkError, no attestation result exists`);
  return `dlopen failed: library "${file}" for ABI ${DEVICE_ABI} not found: ${reason} (the lab runs native code only as ${DEVICE_ABI} libraries rebuilt from source, never as machine code taken from a downloaded package)`;
}

/** Marks the loaders microG creates over its DroidGuard cache (`platform.onDexClassLoader`, called by class-loader-host.js) and traces the load. */
export function noteDexClassLoader(runtime, loader, dexPath) {
  if (!VM_CACHE.test(dexPath)) return;
  runtime.object(loader).droidGuardVm = dexPath;
  const size = runtime.platform.javaIo.fs().stat(dexPath.split(':')[0])?.size;
  runtime.record(`DEVICE microG DroidGuard VM code loaded with a DexClassLoader: ${dexPath}${typeof size === 'number' ? ` (${size} bytes)` : ''}`);
}

/** Refuses DroidGuard's network mode: RemoteHandleImpl (the handle microG builds when `droidguard_mode` is Network) throws an explicit SecurityException to its caller. */
export function installDroidGuard(runtime, microg, registry) {
  runtime.platform.onDexClassLoader = (rt, loader, dexPath) => noteDexClassLoader(rt, loader, dexPath);
  const refuse = (rt, entry) => {
    const alias = entry.descriptors?.get(NETWORK_MODE_OWNER), cls = alias && rt.classes.get(alias);
    if (!cls) return;
    for (const candidate of cls.methods.keys()) {
      const name = candidate.slice(0, candidate.indexOf('('));
      if (!NETWORK_MODE_METHODS.includes(name)) continue;
      setMethodInterceptor(rt, `${alias}->${candidate}`, (r) => {
        const failure = { kind: 'microg-droidguard-network-mode', api: 'DroidGuard network mode', reason: DROIDGUARD_NETWORK_MODE_REFUSAL };
        const known = microg.failures.find(item => item.kind === failure.kind);
        if (known) known.hits++; else { microg.failures.push({ ...failure, hits: 1 }); r.record(`DEVICE microG REFUSED DroidGuard network mode: ${DROIDGUARD_NETWORK_MODE_REFUSAL}`); }
        r.throwJava('Ljava/lang/SecurityException;', `DroidGuard: ${DROIDGUARD_NETWORK_MODE_REFUSAL}`);
      });
    }
  };
  for (const entry of registry.companions().filter(e => e.name === GMS && e.deviceOption === 'microg')) if (entry.loader) refuse(runtime, entry);
  const previous = runtime.platform.onPackageCodeDefined;
  runtime.platform.onPackageCodeDefined = (rt, entry) => { previous?.(rt, entry); if (entry.name === GMS && entry.deviceOption === 'microg') refuse(rt, entry); };
}
