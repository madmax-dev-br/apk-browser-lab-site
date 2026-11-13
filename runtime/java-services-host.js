import { createServiceKit, OBJECT, STRING, CONTEXT } from './service-kit.js?v=5553a52fdbbb';

// The web side of the in-process system_server (docs/SERVICES.md). The services themselves are Java in framework.dex (framework-aosp/lab-java-services: the registry
// dev.apkweb.services.LabServiceManager and one class per service over the original generated AIDL Stub); the managers apps get from Context.getSystemService are the ORIGINAL
// framework classes (PowerManager, AlarmManager, ...). What stays JavaScript is only the boundary:
//   * android.os.ServiceManager is a host class, the servicemanager process of the virtual device: its static getService / checkService / waitForService / getServiceOrThrow /
//     isDeclared / listServices read the Java registry (the original class would need BinderInternal.getContextObject, the kernel's handle 0, and IServiceManager from
//     frameworks/native; the registry is that handle);
//   * Context.getSystemService(name) for the names in LabSystemServices.NAMES builds the manager by calling the Java factory LabSystemServices.manager(Context, name), the
//     SystemServiceRegistry equivalent, once per VM;
//   * the facts about the installed app the services need are natives of dev.apkweb.services.Host (src/services-native.js).
const SERVICE_MANAGER = 'Landroid/os/ServiceManager;', IBINDER = 'Landroid/os/IBinder;', LAB_REGISTRY = 'Ldev/apkweb/services/LabServiceManager;', LAB_SERVICES = 'Ldev/apkweb/services/LabSystemServices;';
const NOT_FOUND = 'Landroid/os/ServiceManager$ServiceNotFoundException;';

/** The Context.*_SERVICE names and manager classes the Java factory serves; tests/java-services.test.mjs checks this table against LabSystemServices.NAMES / CLASSES. */
export const JAVA_MANAGERS = Object.freeze([
  ['power', 'Landroid/os/PowerManager;'],
  ['alarm', 'Landroid/app/AlarmManager;'],
  ['deviceidle', 'Landroid/os/DeviceIdleManager;'],
  ['power_exemption', 'Landroid/os/PowerExemptionManager;'],
]);

export function createJavaServicesHost(platform) {
  const kit = createServiceKit(platform), { registry, def, callStatic, construct, text, finish } = kit;
  const registryCall = (r, name, parameters, result, args = []) => callStatic(r, LAB_REGISTRY, name, parameters, result, args);

  // ---- android.os.ServiceManager: the lab's servicemanager (hidden API an app, or an original framework class, reaches by name)
  registry.type(SERVICE_MANAGER);
  for (const name of ['getService', 'checkService', 'waitForService']) def(SERVICE_MANAGER, name, `(${STRING})${IBINDER}`, (r, _m, [service]) => registryCall(r, 'getService', [STRING], IBINDER, [text(r, service)]), { static: true });
  def(SERVICE_MANAGER, 'getServiceOrThrow', `(${STRING})${IBINDER}`, (r, _m, [service]) => {
    const binder = registryCall(r, 'getService', [STRING], IBINDER, [text(r, service)]);
    if (binder !== null) return binder;
    const error = construct(r, NOT_FOUND, [STRING], [text(r, service)]);   // the original constructor writes "No service published for: <name>"
    r.throwJavaReference(error, `No service published for: ${text(r, service)}`);
  }, { static: true });
  def(SERVICE_MANAGER, 'isDeclared', `(${STRING})Z`, (r, _m, [service]) => registryCall(r, 'isDeclared', [STRING], 'Z', [text(r, service)]), { static: true });
  def(SERVICE_MANAGER, 'listServices', `()[${STRING}`, r => registryCall(r, 'listServices', [], `[${STRING}`), { static: true });

  // ---- the managers: built by the Java factory around the registry's binder, one per VM and name
  for (const [name, classType] of JAVA_MANAGERS) {
    kit.classService(name, classType, r => {
      const context = platform.application ?? r.application ?? null;
      const manager = callStatic(r, LAB_SERVICES, 'manager', [CONTEXT, STRING], OBJECT, [context, name]);
      if (manager === null) throw new Error(`LabSystemServices.manager answered null for the registered service ${name}`);
      return manager;
    });
  }
  return finish({ interfaces: registry.interfacesOf });
}
