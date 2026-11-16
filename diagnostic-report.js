// The plain-text failure report shared by the lab page (app.js) and the embeddable player (player/frame-controller.js): cause line, innermost frames,
// every stubbed API and the last log lines, short enough to paste into a chat. DOM-free.
const FRAME_PREFIX = /^(?:L[^\n]+? \[[^\]\n]+\] at PC 0x[\da-f]+: )+/i;
/** The error text without the leading "Lclass;->method [dex] at PC 0x..: " chain the VM prepends while unwinding. */
export const causeOf = raw => String(raw ?? '').replace(FRAME_PREFIX, '');
/** The stub list a run produced: the Worker's `stubs` ("key xN") or, failing that, the STUB-* lines still present in the trace. */
export const stubsOf = error => (error?.stubs?.length ? error.stubs : [...new Set((error?.trace ?? []).filter(line => /^STUB-/.test(line)))]);
/**
 * buildDiagnosticReport({ error, product, packageName, tolerateMissing, build }) -> { cause, text }
 * `apiGaps` is the already formatted static API-gap section (src/api-gap-scan.js formatApiGapReport), appended last. `error` is the Worker error (message, trace, stubs) or any Error. `stubs` overrides the error's own list (the player passes the live snapshot lists).
 */
export function buildDiagnosticReport({ error, product = 'APK Browser Lab', packageName = 'APK', tolerateMissing = 'off', build = '', stubs = null, apiGaps = null, methodOverrides = 0, ignoredActivities = 0, endpointMocks = 0, hostRedirects = [] }) {
  const raw = error?.message || String(error), cause = causeOf(raw);
  const frames = [...raw.matchAll(/(L[^\s:]+?;->[^\s]+?) \[([^\]]+)\] at PC (0x[\da-f]+)/gi)].map(([, frame, dex, pc]) => `  ${frame} [${dex}] @${pc}`);
  const trace = error?.trace ?? [], list = stubs ?? stubsOf(error);
  const libStubs = list.filter(line => /^STUB-LIB /.test(line)).length;
  const consequence = libStubs && !/UnsatisfiedLink|native|JNI|\.so\b/i.test(cause)
    ? `Warning: tolerant mode replaced ${libStubs} native librar${libStubs > 1 ? 'ies' : 'y'} (STUB-LIB) and this error does not mention native code: the failure may be a consequence of the replaced libraries listed below (their results are empty).` : '';
  const text = [
    `${product}${build ? ' ' + build : ''} · ${packageName} · tolerant mode: ${tolerateMissing}${methodOverrides > 0 ? ` · METHOD RETURNS REPLACED (${methodOverrides} methods: their original code did not run)` : ''}${ignoredActivities > 0 ? ` · IGNORED ACTIVITIES ACTIVE (${ignoredActivities}: their launches did not happen)` : ''}${endpointMocks > 0 ? ` · ENDPOINT MOCKS ACTIVE (${endpointMocks}: the matching requests are answered by the lab, with no network)` : ''}${hostRedirects?.length ? ` · HOSTS REDIRECTED (${hostRedirects.length}: ${hostRedirects.slice(0, 4).join('; ')}${hostRedirects.length > 4 ? '; …' : ''})` : ''}`,
    error?.details?.jsStack ? `Internal error: ${String(error.details.jsStack).split('\n')[0]}` : '',
    `Error: ${cause}`,
    error?.summary ? error.summary : '',
    error?.details?.heartbeatText ? error.details.heartbeatText : '',
    error?.details?.jsStack ? `Internal VM error (JavaScript) -- location:\n${error.details.jsStack}${error.details.vmContext ? `\nContext: operation ${error.details.vmContext.operation ?? '?'}, thread ${error.details.vmContext.thread ?? '?'}, host call: ${error.details.vmContext.hostCall ?? 'none'}, Java stack: ${(error.details.vmContext.stack ?? []).join(' < ') || 'empty'}` : ''}` : '',
    error?.uncaught ? error.uncaught : '',
    error?.details?.heap?.text ? error.details.heap.text : '',
    frames.length ? `Stack (innermost last):\n${frames.slice(-12).join('\n')}` : '',
    error?.details?.profile?.text ? error.details.profile.text : '',
    consequence,
    list.length ? `Stubbed APIs (${list.length}):\n${list.slice(0, 60).join('\n')}` : '',
    trace.length ? `Last log lines:\n${trace.filter(line => !/^STUB-/.test(line)).slice(-15).join('\n')}` : '',
    apiGaps || '',
  ].filter(Boolean).join('\n\n');
  return { cause, text };
}
