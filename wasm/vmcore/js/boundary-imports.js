// The "env" imports of core.wasm besides its memory: the boundary probes of boundary.c, the host trampoline's env.bridge(methodId, callAddress, threadAddress) -> status
// (vmcore/host.h; vmcore/js/host-bridge.js answers it when a runtime is attached), and the linker's env.resolve(thread, method, what) -> status (vmcore/js/linker.js; interp.c
// calls it the first time an instruction needs a constant or a method its code). Every instantiation of core.wasm takes this whole object. `bridge` defaults to UNBOUND_NATIVE (35):
// a core without a host attached stops at the first host method as before (the boundary benchmarks pass their own); `resolve` defaults to UNRESOLVED (34): an instance without the
// linker (a Worker, the collector's checks) can run only code whose constants are resolved already. `exception` is env.exception(t, event, object, a, b, c, stack, count)
// (vmcore/exceptions.h; vmcore/js/exceptions.js keeps what it reports); the default ignores it. `field` is env.field(t, object, caller, constant, op, register): a host field's
// iget/iput (vmcore/host.h HOST_FIELD; host-bridge.js answers it); the default stops with UNBOUND_NATIVE.
export const UNRESOLVED = 34, UNBOUND_NATIVE = 35;
export function coreImports(memory, { bridge = () => UNBOUND_NATIVE, nop = () => {}, add3 = (a, b, c) => (a + b + c) | 0, resolve = () => UNRESOLVED, exception = () => {}, field = () => UNBOUND_NATIVE } = {}) {
  return { env: { memory, nop, add3, bridge, resolve, exception, field } };
}
