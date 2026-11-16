/**
 * Libraries scoped to one APK (an app's own generated native code, e.g. libappmodules.so) may exist for several APKs under the same soname: the newest entry stays in the
 * provider's map and carries the others in `variants`. `providerForApk` then hands a JniBridge the variant built for the app being run (matched by the APK's SHA-256).
 */
export function withVariants(previous, entry) {
  if (!entry.apkSha256 || !previous?.apkSha256 || previous.apkSha256 === entry.apkSha256) return entry;
  entry.variants = [previous, ...(previous.variants ?? [])];
  return entry;
}
export function providerForApk(provider, apkSha256) {
  if (![...provider.modules.values()].some(entry => entry.variants)) return provider;
  const view = Object.create(provider); view.modules = new Map(provider.modules);
  for (const [soname, entry] of provider.modules) {
    if (!entry.variants || entry.apkSha256 === apkSha256) continue;
    const match = entry.variants.find(variant => variant.apkSha256 === apkSha256);
    view.modules.set(soname, match ?? entry);   // no variant for this APK: the newest entry, which #provides then refuses for a different APK
  }
  return view;
}
