// DOM-free, no process.*.
// An error whose message says nothing ("null", "undefined", empty: a Java exception without a detail message, a value thrown that is not an Error) is named instead, so the report
// never reads "VM ERROR: null": the Java exception's class (as Android prints Throwable.toString), or the JS error's name, where the VM was (thread, Java frames, host call) and
// the first lines of the JS stack.
export const EMPTY_MESSAGE = /^(?:(?:L[^\n]+? \[[^\]\n]+\] at PC 0x[\da-f]+: )*)(?:null|undefined|\[object Object\]|)\s*$/i;
export function nameSilentError(error, runtime = null) {
  const message = error?.message ?? (error === null || error === undefined || typeof error !== 'object' ? String(error) : '');
  if (!EMPTY_MESSAGE.test(String(message ?? ''))) return error;
  const prefix = String(message ?? '').replace(/(?:null|undefined|\[object Object\])\s*$/i, ''), context = (() => { try { return runtime?.monitor?.context?.() ?? null; } catch { return null; } })();
  let type = null; try { if (error?.value && runtime?.typeOf) type = String(runtime.typeOf(error.value)).replace(/^L/, '').replace(/;$/, '').replaceAll('/', '.'); } catch { type = null; }
  const where = context ? ` in ${context.operation ?? 'an operation'} on thread ${context.thread ?? '?'}${context.stack?.length ? ` at ${context.stack.slice(0, 4).join(' ← ')}` : ''}${context.hostCall ? ` (host call ${context.hostCall})` : ''}` : '';
  const what = type ? `${type} (no detail message)` : `${error?.name && error.name !== 'Error' ? error.name : error === null || error === undefined || typeof error !== 'object' ? `A thrown ${error === null ? 'null' : typeof error}` : 'An error'} with no message`;
  const named = Object.assign(new Error(`${prefix}${what}${where}`), { name: error?.name || 'Error', details: { ...(error?.details ?? {}), kind: error?.details?.kind ?? 'error-without-message', labStack: String(error?.stack ?? new Error().stack ?? '').split('\n').slice(0, 13).join('\n'), vmContext: context } });
  if (error?.stack) named.stack = error.stack;
  return named;
}
