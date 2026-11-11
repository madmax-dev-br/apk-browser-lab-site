// The natives of dev.apkweb.services.Host (framework-aosp/lab-java-services): the facts about the installed app that the in-process system_server written in Java asks the page for.
// One named key per fact (`Ldev/apkweb/services/Host;-><name><descriptor>`), each a read of platform state; none of them decides a service answer (docs/SERVICES.md, "Fronteira com a web").
const HOST = 'Ldev/apkweb/services/Host;';

export function createServicesNativeBindings() {
  const bindings = new Map(), add = (signature, callback) => bindings.set(`${HOST}->${signature}`, callback);
  add('packageName()Ljava/lang/String;', runtime => runtime.platform.packageName ?? 'unknown');
  add('uid()I', runtime => runtime.platform.virtualProcess?.uid ?? 10000);
  add('targetSdk()I', runtime => Number(runtime.platform.manifest?.usesSdk?.targetSdkVersion ?? 1));
  add('holdsPermission(Ljava/lang/String;)Z', (runtime, [permission]) => (runtime.platform.holdsPermission?.(runtime, runtime.stringCharacters(permission)) ? 1 : 0));
  add('record(Ljava/lang/String;)V', (runtime, [line]) => { runtime.record(runtime.stringCharacters(line)); });
  return bindings;
}
