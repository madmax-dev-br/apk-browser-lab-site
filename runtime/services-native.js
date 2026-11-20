// The natives of dev.apkweb.services.Host (framework-aosp/lab-java-services): the facts about the installed app that the in-process system_server written in Java asks the page for.
// One named key per fact (`Ldev/apkweb/services/Host;-><name><descriptor>`), each a read of platform state; none of them decides a service answer (docs/SERVICES.md, "Fronteira com a web").
const HOST = 'Ldev/apkweb/services/Host;';

export function createServicesNativeBindings() {
  const bindings = new Map(), add = (signature, callback) => bindings.set(`${HOST}->${signature}`, callback);
  // With a second package installed (src/package-registry.js), the facts are those of the package whose code made the call (a companion's own AlarmManager call is judged by its
  // targetSdk and its permissions, as AlarmManagerService judges the calling uid); with the app alone, the app's.
  const companion = runtime => { const P = runtime.platform.packages; if (!P?.multi) return null; const entry = P.callerEntry(runtime); return entry && !entry.main ? entry : null; };
  add('packageName()Ljava/lang/String;', runtime => companion(runtime)?.name ?? runtime.platform.packageName ?? 'unknown');
  add('uid()I', runtime => companion(runtime)?.uid ?? runtime.platform.virtualProcess?.uid ?? 10000);
  add('targetSdk()I', runtime => { const entry = companion(runtime); return entry ? runtime.platform.packages.targetSdk(entry) : Number(runtime.platform.manifest?.usesSdk?.targetSdkVersion ?? 1); });
  add('holdsPermission(Ljava/lang/String;)Z', (runtime, [permission]) => { const entry = companion(runtime), name = runtime.stringCharacters(permission); return (entry ? runtime.platform.packages.holds(runtime, entry, name) : runtime.platform.holdsPermission?.(runtime, name)) ? 1 : 0; });
  add('record(Ljava/lang/String;)V', (runtime, [line]) => { runtime.record(runtime.stringCharacters(line)); });
  return bindings;
}
