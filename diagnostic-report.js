// The plain-text failure report shared by the lab page (app.js) and the embeddable player (player/frame-controller.js): cause line, innermost frames,
// every stubbed API and the last log lines, short enough to paste into a chat. DOM-free.
const FRAME_PREFIX = /^(?:L[^\n]+? \[[^\]\n]+\] at PC 0x[\da-f]+: )+/i;
/** The error text without the leading "Lclass;->method [dex] at PC 0x..: " chain the VM prepends while unwinding. */
export const causeOf = raw => String(raw ?? '').replace(FRAME_PREFIX, '');
/** The stub list a run produced: the Worker's `stubs` ("key xN") or, failing that, the STUB-* lines still present in the trace. */
export const stubsOf = error => (error?.stubs?.length ? error.stubs : [...new Set((error?.trace ?? []).filter(line => /^STUB-/.test(line)))]);
/**
 * buildDiagnosticReport({ error, product, packageName, tolerateMissing, build }) -> { cause, text }
 * `error` is the Worker error (message, trace, stubs) or any Error. `stubs` overrides the error's own list (the player passes the live snapshot lists).
 */
export function buildDiagnosticReport({ error, product = 'APK Browser Lab', packageName = 'APK', tolerateMissing = 'off', build = '', stubs = null }) {
  const raw = error?.message || String(error), cause = causeOf(raw);
  const frames = [...raw.matchAll(/(L[^\s:]+?;->[^\s]+?) \[([^\]]+)\] at PC (0x[\da-f]+)/gi)].map(([, frame, dex, pc]) => `  ${frame} [${dex}] @${pc}`);
  const trace = error?.trace ?? [], list = stubs ?? stubsOf(error);
  const text = [
    `${product}${build ? ' ' + build : ''} · ${packageName} · modo tolerante: ${tolerateMissing}`,
    `Erro: ${cause}`,
    frames.length ? `Pilha (mais interna por último):\n${frames.slice(-12).join('\n')}` : '',
    list.length ? `APIs com stub (${list.length}):\n${list.slice(0, 60).join('\n')}` : '',
    trace.length ? `Últimas linhas do log:\n${trace.filter(line => !/^STUB-/.test(line)).slice(-15).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  return { cause, text };
}
