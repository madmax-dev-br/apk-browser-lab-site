// The JNI side of the ARM64 native process (docs/ARM64-NATIVE.md): the JNIEnv and JavaVM structures in the process memory, with 64-bit function pointers to host
// entries that run the JNI bridge's own handlers (src/jni-host.js JniBridge.handlersFor: the same JNI semantics as for the lab's WebAssembly libraries), and the
// library objects the bridge binds native methods to (Java_ export names and RegisterNatives). Arguments follow AAPCS64: integers and pointers in X0-X7, float and
// double in V0-V7, the rest on the stack; "..." arguments of Call<Type>Method continue in the same registers, a va_list is AAPCS64's structure.
import { APKError } from '../apk-error.js?v=88e579518234';
import { Blocked } from '../scheduler.js?v=88e579518234';
import { JNI_FUNCTIONS } from '../jni-function-table.js?v=88e579518234';
import { variadic, vaList } from './libc.js?v=88e579518234';
import { registerArm64Memory } from '../unsafe-native.js?v=88e579518234';
import { utf8 } from './text.js?v=88e579518234';

const JNI_OK = 0, JNI_EVERSION = -3, VERSIONS = new Set([0x10001, 0x10002, 0x10004, 0x10006, 0x10008]);
// JNI parameters that are 32-bit integers (jint, jsize, jboolean, jbyte, jchar, jshort) rather than pointers or references: on AAPCS64 only their low 32 bits are defined
const INT32 = new Map(Object.entries({ PushLocalFrame: [1], EnsureLocalCapacity: [1], NewObjectArray: [1], GetObjectArrayElement: [2], SetObjectArrayElement: [2], RegisterNatives: [3], NewString: [2], GetStringRegion: [2, 3], GetStringUTFRegion: [2, 3], ToReflectedMethod: [3], ToReflectedField: [3], ReleasePrimitiveArrayCritical: [3] }));
for (const type of ['Boolean', 'Byte', 'Char', 'Short', 'Int', 'Long', 'Float', 'Double']) {
  INT32.set(`New${type}Array`, [1]); INT32.set(`Release${type}ArrayElements`, [3]); INT32.set(`Get${type}ArrayRegion`, [2, 3]); INT32.set(`Set${type}ArrayRegion`, [2, 3]);
  if (['Boolean', 'Byte', 'Char', 'Short', 'Int'].includes(type)) { INT32.set(`Set${type}Field`, [3]); INT32.set(`SetStatic${type}Field`, [3]); }
}
const VARIADIC = /^(Call(Nonvirtual|Static)?\w+Method|NewObject)$/, VA_LIST = /^(Call(Nonvirtual|Static)?\w+MethodV|NewObjectV)$/;

export function attachArm64Jni(process, bridge) {
  const mem = process.memory, tokens = new Map(); let nextToken = 1;
  const recentJni = new Array(16).fill(null); let recentAt = 0;
  const recentCalls = () => { const out = []; for (let i = 1; i <= 16; i++) { const n = recentJni[(recentAt - i) & 15]; if (n) out.push(n); } return out.reverse(); };
  const lib = {
    abi: 'arm64-v8a', pointerSize: 8, process, allocations: new Map(), exports: new Proxy({}, { get: (_t, name) => { for (const l of process.order) { const address = l.exports.get(name); if (address !== undefined) { const fn = () => { throw new APKError('ARM64 native functions are called through callNative', { kind: 'internal' }); }; fn.address = address; return fn; } } return undefined; } }),
    memory: mem, addressBase: mem.base,   // the bridge's handlers index the buffer at address - addressBase (the process runs at its window of the address space, src/unsafe-native.js)
    malloc: size => process.malloc(size), free: ptr => process.free(ptr),
    writePtr: (address, value) => mem.writePtr(address, value),
    /** the argument values of a "..." or va_list call: `ptr` is the token the env entry made for this call */
    vaArgs(parameters, ptr) {
      const reader = tokens.get(ptr); if (!reader) throw new APKError(`ARM64 JNI: unknown argument list 0x${Number(ptr).toString(16)}`, { kind: 'internal' });
      return parameters.map(type => type === 'D' || type === 'F' ? reader.double() : type === 'J' ? BigInt.asIntN(64, reader.int()) : type.startsWith('L') || type.startsWith('[') ? Number(reader.int()) : Number(BigInt.asIntN(32, reader.int())));
    },
    nativeMethods(methods, count) {   // JNINativeMethod { const char* name; const char* signature; void* fnPtr; } (24 bytes)
      const out = [], decode = address => utf8.decode(mem.cString(address));
      for (let i = 0; i < count; i++) { const at = methods + 24 * i; out.push({ name: decode(mem.readPtr(at)), signature: decode(mem.readPtr(at + 8)), address: mem.readPtr(at + 16) }); }
      return out;
    },
    /** Calls the native function of `binding` with the bridge's argument values (env, receiver/class, then the Java parameters) per AAPCS64; returns the raw result the bridge converts. */
    callNative(binding, method, values) {
      const address = binding.address ?? binding.fn?.address, gp = [], fp = [];
      values.forEach((value, i) => {
        const type = i < 2 ? 'L' : method.parameters[i - 2];
        if (type === 'F') fp.push({ kind: 'float', value }); else if (type === 'D') fp.push({ kind: 'double', value }); else gp.push(typeof value === 'bigint' ? value : BigInt(Math.trunc(value)));
      });
      if (fp.length > 8) throw new APKError('ARM64 JNI: more than 8 floating-point arguments (stack-passed FP arguments are not implemented)', { kind: 'arm64-unsupported' });
      const result = method.result, rt = bridge.runtime;
      const convert = raw => {
        if (raw instanceof Blocked) return raw;
        if (result === 'J') return BigInt.asIntN(64, raw);
        if (result === 'D' || result === 'F') return raw;
        if (result === 'V') return undefined;
        if (result.startsWith('L') || result.startsWith('[')) return Number(raw);
        return Number(BigInt.asIntN(32, raw));
      };
      // a Java thread whose native code waits (a condition, a mutex, a sleep, a join) parks like a Java wait: the VM's Blocked, its deadline on the VM clock, resumed by the scheduler
      const park = ({ ready, delayMs, what, resume }) => new Blocked({ ready, deadline: Number.isFinite(delayMs) ? (rt.platform?.clock?.now?.() ?? performance.now()) + Math.max(0, delayMs) : Infinity, reason: `ARM64 native wait: ${what}`, finish: () => convert(resume()) });
      const parkable = rt.thread && rt.thread !== rt.scheduler?.main ? park : null;   // the main thread's native calls stay synchronous (its events and the page's requests wait for them)
      return convert(process.threads.callFromJava(rt.thread, address, gp, { floats: fp, returns: result === 'D' ? 'd' : result === 'F' ? 's' : 'x' }, parkable));   // as the calling Java thread's native thread
    },
  };
  const handlers = bridge.handlersFor(lib);
  // JNIEnv: functions table of 8-byte pointers to host entries
  const slots = JNI_FUNCTIONS.length, table = process.malloc(8 * slots), envPtr = process.malloc(16), vmTable = process.malloc(8 * 8), vmPtr = process.malloc(16);
  JNI_FUNCTIONS.forEach(([name, params, result], index) => {
    if (name === 'reserved') { mem.writePtr(table + 8 * index, 0); return; }
    const handler = handlers[name], ints = INT32.get(name) ?? [];
    const entry = process.hostEntry(`jni:${name}`, (p, cpu) => {
      recentJni[recentAt++ & 15] = name;   // the last JNI functions native code called, for exception reports
      if (!handler) throw new APKError(`ARM64 native code called JNI ${name}, which the JNI bridge does not implement`, { kind: 'jni-unsupported', function: name });
      const args = []; let gpi = 0, fpi = 0;
      const variadicCall = VARIADIC.test(name), vaListCall = VA_LIST.test(name), fixed = variadicCall || vaListCall ? params.length - 1 : params.length;
      for (let i = 0; i < fixed; i++) {
        const t = params[i];
        if (t === 'f32') args.push(cpu.getS(fpi++)); else if (t === 'f64') args.push(cpu.getD(fpi++));
        else if (t === 'i64') args.push(BigInt.asIntN(64, cpu.x[gpi++]));
        else { const raw = cpu.x[gpi++]; args.push(ints.includes(i) ? Number(BigInt.asIntN(32, raw)) : Number(raw)); }
      }
      const run = () => bridge.guardJni(name, () => handler(...args), lib);   // a Java exception from a callback is the pending exception; the native code continues, as on ART
      if (variadicCall || vaListCall) { const token = 0x7d0000000000 + nextToken++; tokens.set(token, variadicCall ? variadic(cpu, gpi, fpi) : vaList(mem, Number(cpu.x[gpi]))); args.push(token); try { return wrap(result, run()); } finally { tokens.delete(token); } }
      return wrap(result, run());
    });
    mem.writePtr(table + 8 * index, entry);
  });
  function wrap(result, value) {
    if (result === null) return undefined;
    if (value === undefined) return result === 'f32' ? { float: 0 } : result === 'f64' ? { double: 0 } : 0n;   // a function that ended with a pending exception returns 0 / null
    if (result === 'f32') return { float: value }; if (result === 'f64') return { double: value };
    return typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)));
  }
  mem.writePtr(envPtr, table);
  // JavaVM: JNIInvokeInterface { reserved0..2, DestroyJavaVM, AttachCurrentThread, DetachCurrentThread, GetEnv, AttachCurrentThreadAsDaemon }
  const vmFns = [null, null, null, () => 0, (p, cpu) => { if (cpu.x[1]) mem.writePtr(Number(cpu.x[1]), envPtr); return JNI_OK; }, () => JNI_OK,
    (p, cpu) => { const version = Number(BigInt.asIntN(32, cpu.x[2])); if (!VERSIONS.has(version)) { mem.writePtr(Number(cpu.x[1]), 0); return BigInt.asUintN(64, BigInt(JNI_EVERSION)); } mem.writePtr(Number(cpu.x[1]), envPtr); return JNI_OK; },
    (p, cpu) => { if (cpu.x[1]) mem.writePtr(Number(cpu.x[1]), envPtr); return JNI_OK; }];
  vmFns.forEach((fn, i) => mem.writePtr(vmTable + 8 * i, fn ? process.hostEntry(`jnivm:${i}`, fn) : 0));
  mem.writePtr(vmPtr, vmTable);
  Object.assign(lib, { envPtr, vmPtr, recentCalls, caller: () => process.activeCpu.where(Number(process.activeCpu.x[30])) });
  registerArm64Memory(bridge.runtime, mem);   // Java resolves the process's addresses (a jlong pointer, a direct ByteBuffer) against this memory
  return lib;
}
