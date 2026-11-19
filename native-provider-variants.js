/**
 * One soname may exist in several builds: libraries scoped to one APK (an app's own generated native code, e.g. libappmodules.so, matched by the APK's SHA-256) and
 * libraries built from one React Native release (libreactnative, libjsi, libfbjni, Hermes, ...: `requires.reactNative` in the provenance, one build per release of
 * scripts/wasm/rn-versions.json). The newest entry stays in the provider's map and carries the others in `variants`; `providerForApk` then hands a JniBridge the
 * variant built for the app being run. An app no variant fits gets the newest entry, which the bridge then refuses explicitly (a library scoped to another APK, or
 * the React Native version gate of src/jni-host.js naming the release to build), never a build of another release in its place.
 */
const release = entry => entry?.requires?.reactNative ?? null;
/** Two builds of one soname that an app tells apart: scoped to different APKs, or built from different React Native releases. */
const distinct = (a, b) => !!((a.apkSha256 && b.apkSha256 && a.apkSha256 !== b.apkSha256) || (release(a) && release(b) && release(a) !== release(b)));
export function withVariants(previous, entry) {
  if (!previous) return entry;
  // the same APK / the same release replaces its own entry; the builds for other APKs / releases stay reachable
  const others = [previous, ...(previous.variants ?? [])].filter(variant => distinct(variant, entry));
  if (others.length) entry.variants = others.map(variant => { if (!variant.variants) return variant; const plain = Object.create(Object.getPrototypeOf(variant), Object.getOwnPropertyDescriptors(variant)); delete plain.variants; return plain; });
  return entry;
}
/** The provider as the app with this APK SHA-256 and this React Native release (formatVersion of the version read from its DEX, or null) sees it. */
export function providerForApk(provider, apkSha256, reactNative = null) {
  if (![...provider.modules.values()].some(entry => entry.variants)) return provider;
  const view = Object.create(provider); view.modules = new Map(provider.modules);
  const fits = entry => (!entry.apkSha256 || entry.apkSha256 === apkSha256) && (!release(entry) || release(entry) === reactNative);
  for (const [soname, entry] of provider.modules) {
    if (!entry.variants || fits(entry)) continue;
    view.modules.set(soname, entry.variants.find(fits) ?? entry);   // no variant for this app: the newest entry, which the bridge then refuses (other APK, or the version gate)
  }
  return view;
}
