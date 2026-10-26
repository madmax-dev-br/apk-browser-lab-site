import { APKError } from './apk-error.js?v=38ea11051357';

// Registry for "contract hosts": JS reimplementations of named platform methods, each registered with its exact JVM
// signature. The registry answers the runtime's supports()/invoke()/parent()/reflection queries uniformly so that
// reflective callers (DexGuard-style API hiding) and direct invokes see the same member set.
export function parseSignature(signature) {
  const parameters = [], close = signature.indexOf(')'); let i = 1;
  while (i < close) { const start = i; while (signature[i] === '[') i++; if (signature[i] === 'L') i = signature.indexOf(';', i); i++; parameters.push(signature.slice(start, i)); }
  return { parameters, result: signature.slice(close + 1) };
}
const bits = new DataView(new ArrayBuffer(8));
export const doubleBits = n => { bits.setFloat64(0, n, true); return bits.getBigInt64(0, true); };
export const bitsDouble = n => { bits.setBigInt64(0, BigInt(n), true); return bits.getFloat64(0, true); };
export const floatBits = n => { bits.setFloat32(0, n, true); return bits.getInt32(0, true); };
export const bitsFloat = n => { bits.setInt32(0, n, true); return bits.getFloat32(0, true); };

export function createHostRegistry() {
  const defaultedParents = new Set(), reflectedFields = new Map(), instanceFields = new Map(), methods = new Map(), parents = new Map(), interfaces = new Map(), members = new Map(), fields = new Map(), allocatable = new Set();
  return {
    parents, interfaces,
    /** type(owner, parent, interfaces?, {allocatable}) declares a host class. */
    type(owner, parent = 'Ljava/lang/Object;', ifaces = [], { allocatable: canAllocate = false } = {}) {
      parents.set(owner, parent); defaultedParents.delete(owner); if (ifaces.length) interfaces.set(owner, ifaces); if (canAllocate) allocatable.add(owner);
    },
    /** def(owner, name, signature, fn, {static}) fn(runtime, method, args) -- args[0] is the receiver unless static. */
    def(owner, name, signature, fn, { static: isStatic = false } = {}) {
      methods.set(`${owner}->${name}${signature}`, fn);
      if (!parents.has(owner)) { parents.set(owner, 'Ljava/lang/Object;'); defaultedParents.add(owner); } // implicit: yields to the VM's own hierarchy tables
      const byName = members.get(owner) ?? members.set(owner, new Map()).get(owner);
      (byName.get(name) ?? byName.set(name, []).get(name)).push({ ...parseSignature(signature), signature, static: isStatic });
    },
    /** staticField(owner, name, type, (runtime) => value) -- lazily computed, cached per runtime. */
    staticField(owner, name, type, compute) { fields.set(`${owner}->${name}:${type}`, { compute, cache: new WeakMap() }); if (!parents.has(owner)) parents.set(owner, 'Ljava/lang/Object;'); },
    /** instanceField(owner, name, type): a protected/public instance field of a host class (subclasses in APK code access it through their own class reference). */
    instanceField(owner, name, type, { reflect = false } = {}) { if (reflect) { const byName = reflectedFields.get(owner) ?? reflectedFields.set(owner, new Map()).get(owner); byName.set(name, type); } instanceFields.set(`${name}:${type}`, [...(instanceFields.get(`${name}:${type}`) ?? []), owner]); if (!parents.has(owner)) parents.set(owner, 'Ljava/lang/Object;'); },
    resolveExternalField(runtime, field) {
      const owners = instanceFields.get(`${field.name}:${field.type}`); if (!owners) return null;
      for (let type = field.owner, depth = 0; type && depth < 64; type = runtime.parent(type), depth++) if (owners.includes(type)) return { owner: type, name: field.name, type: field.type };
      return null;
    },
    supports: key => methods.has(key),
    parent: type => defaultedParents.has(type) ? null : parents.get(type) ?? null,
    fallbackParent: type => parents.get(type) ?? null,
    interfacesOf: type => interfaces.get(type) ?? [],
    canAllocate: type => allocatable.has(type),
    readStatic(runtime, field) {
      const entry = fields.get(`${field.owner}->${field.name}:${field.type}`); if (!entry) return null;
      if (!entry.cache.has(runtime)) entry.cache.set(runtime, entry.compute(runtime));
      return { handled: true, value: entry.cache.get(runtime) };
    },
    reflectionDefinition(owner, kind, name, parameters) {
      if (kind === 'field') {
        const type = reflectedFields.get(owner)?.get(name); if (!type) return null;
        return { field: { owner, name, type, key: `${owner}->${name}:${type}` }, flags: 1 };
      }
      const memberName = kind === 'constructor' ? '<init>' : name, candidates = members.get(owner)?.get(memberName); if (!candidates) return null;
      const wanted = (parameters ?? []).join(''), found = candidates.find(c => c.parameters.join('') === wanted); if (!found) return null;
      return { method: { owner, name: memberName, parameters: found.parameters, result: found.result, signature: found.signature, key: `${owner}->${memberName}${found.signature}` }, flags: 1 | (found.static ? 8 : 0) };
    },
    invoke(runtime, method, args) {
      const fn = methods.get(`${method.owner}->${method.name}${method.signature}`);
      if (!fn) throw new APKError(`Unsupported contract-host method ${method.owner}->${method.name}${method.signature}`);
      return fn(runtime, method, args);
    },
  };
}
