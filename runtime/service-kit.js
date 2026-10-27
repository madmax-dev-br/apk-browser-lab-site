import { createHostRegistry } from './host-contract.js?v=9b98a94b8ae7';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=9b98a94b8ae7';

// Shared plumbing of the system-service hosts (hardware-services-host.js, device-services-host.js, system-managers-host.js): a host contract registry plus the Context service
// table -- each service has a Context.*_SERVICE name and a manager class; the manager object is a host object created once per runtime. Behaviour follows what an API 33 phone
// without the hardware or account in question answers (android-13.0.0_r1), and stays consistent with PackageManager.hasSystemFeature (platform.systemFeatures).
export const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', LIST = 'Ljava/util/List;', CONTEXT = 'Landroid/content/Context;';

/** The features the virtual device advertises. Hardware that is absent from this set is absent from every service that models it. */
export const DEVICE_FEATURES = Object.freeze(['android.hardware.wifi']);

export function createServiceKit(platform) {
  const registry = createHostRegistry(), { type } = registry, rawDef = registry.def, rawStaticField = registry.staticField, classOf = new Map();
  // Statics and constants belong to the manager class a service hands out, not to the host implementation type behind the instance.
  const def = (owner, name, signature, fn, options) => rawDef(options?.static ? (classOf.get(owner) ?? owner) : owner, name, signature, fn, options);
  const staticField = (owner, name, kind, compute) => rawStaticField(classOf.get(owner) ?? owner, name, kind, compute);
  registry.def = def; registry.staticField = staticField;
  const services = new Map(), byClass = new Map(), objects = new WeakMap(), roots = [];
  const service = (name, classType, hostType = classType.replace(/;$/, '') + 'Impl;') => {
    services.set(name, hostType); classOf.set(hostType, classType); byClass.set(classType, name); type(classType, OBJECT, [], { allocatable: false }); type(hostType, classType, [], { allocatable: true }); return hostType;
  };
  const getService = (r, name) => {
    const hostType = services.get(name); if (!hostType) return null;
    const cache = objects.get(r) ?? objects.set(r, gcRoot(new Map())).get(r);
    if (!cache.has(name)) cache.set(name, r.allocate(hostType));
    return cache.get(name);
  };
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const text = (r, v) => v === null || v === undefined || v === 0 ? null : r.stringCharacters(v);   // bytecode passes a null reference as 0
  const uid = () => platform.virtualProcess?.uid ?? 10000;
  const holds = (r, permission) => platform.holdsPermission?.(r, permission) ?? false;
  /** Context.enforceCallingOrSelfPermission: SecurityException with the framework's message. */
  const enforce = (r, permission, message = null) => {
    if (!holds(r, permission)) r.throwJava('Ljava/lang/SecurityException;', message ?? `Neither user ${uid()} nor current process has ${permission}.`);
  };
  const hasFeature = name => platform.systemFeatures.has(name);
  const construct = (r, owner, parameters = [], args = []) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const emptyList = r => construct(r, 'Ljava/util/ArrayList;');
  const listOf = (r, items) => { const list = emptyList(r); for (const item of items) call(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [item]); return list; };
  const stringArray = (r, items) => { const a = r.newArray('[Ljava/lang/String;', items.length); r.array(a).elements = items; return a; };
  const intArray = (r, items) => { const a = r.newArray('[I', items.length); r.array(a).elements = items; return a; };
  const array = (r, componentType, items) => { const a = r.newArray(`[${componentType}`, items.length); r.array(a).elements = items; return a; };
  const device = () => platform.device ?? {};
  const npe = (r, message = null) => r.throwJava('Ljava/lang/NullPointerException;', message);
  const iae = (r, message) => r.throwJava('Ljava/lang/IllegalArgumentException;', message);
  const ise = (r, message) => r.throwJava('Ljava/lang/IllegalStateException;', message);
  const nullish = value => value === null || value === undefined || value === 0;
  /** The host object that finishes the registry: the platform's contract-host surface plus service lookup. */
  const finish = (extra = {}) => ({ ...registry, getService, serviceNameForClass: classType => byClass.get(classType) ?? null, serviceNames: () => [...services.keys()], [GC_ROOTS](visit) { for (const root of roots) root(visit); }, ...extra });
  const root = fn => roots.push(fn);
  return { registry, def, type, service, getService, call, callStatic, text, uid, holds, enforce, hasFeature, construct, emptyList, listOf, stringArray, intArray, array, device, npe, iae, ise, nullish, finish, root, services, byClass };
}
