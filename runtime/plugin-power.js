// "Plugin power" (Controls > Plugins): how much of the VM thread's time page plugins may use to read the running app, and how tightly the page paces their queries. Three levels,
// kept in localStorage, sent to the VM Worker with every plugin query (so a reloaded Worker is never behind) and by `plugin-power` for an immediate change; applied live, no reload.
// Pure data and decisions (no DOM, no Worker): the Worker's serving logic (src/apk-worker.js, `planPluginServe`), the page broker (src/plugin-host.js) and the plugin runtime read the
// numbers from here, and tests run them with a fake clock.
//
// What does not change at any level: a query never runs during an operation or a VM event (`busy`), it is read-only, it runs alone in its own task, and it never runs inside the input
// quiet window after the page's last pointer/operation (the window can be shortened at Max, never removed). The levels only move the budget, the pacing and the page size.

export const POWER_LEVELS = Object.freeze(['normal', 'high', 'max']);
export const DEFAULT_POWER = 'normal';
export const POWER_STORAGE_KEY = 'apkweb.plugin-power.v1';

/** Every number a level sets. Worker: msPerSecond (query time per second), inputQuietMs (no query this long after input/operation), retryMs (poll while busy), waitMs (then 'busy'),
 * queueMax, scanBudgetMs / scanLimit (default page of a heap scan: lab.instances / lab.referrers / lab.findCompositionLocal), batchBudgetMs (time one lab.batch task may take).
 * Page: vmGapMs (pause between two VM queries), composeTreeMs (one composeTree per plugin this often), watchMinMs (shortest lab.watch interval). */
export const POWER = Object.freeze({
  normal: Object.freeze({ label: 'Normal', msPerSecond: 40, inputQuietMs: 120, retryMs: 16, waitMs: 6000, queueMax: 64, scanBudgetMs: 40, scanLimit: 50, batchBudgetMs: 25, vmGapMs: 25, composeTreeMs: 1000, watchMinMs: 250 }),
  high: Object.freeze({ label: 'High', msPerSecond: 250, inputQuietMs: 120, retryMs: 8, waitMs: 15000, queueMax: 128, scanBudgetMs: 50, scanLimit: 100, batchBudgetMs: 30, vmGapMs: 5, composeTreeMs: 500, watchMinMs: 100 }),
  max: Object.freeze({ label: 'Max', msPerSecond: 600, inputQuietMs: 60, retryMs: 4, waitMs: 30000, queueMax: 256, scanBudgetMs: 60, scanLimit: 200, batchBudgetMs: 40, vmGapMs: 0, composeTreeMs: 250, watchMinMs: 50 }),
});
export const POWER_NOTES = Object.freeze({
  normal: 'Default: about 4 % of the VM thread, one query at a time.',
  high: 'About 25 % of the VM thread for plugin reads, short pauses between queries.',
  max: 'Up to 60 % of the VM thread for plugin reads. Input still waits for at most one query.',
});

/** A stored or received value -> 'normal' | 'high' | 'max' (anything else is the default). */
export const sanitizePower = value => { const text = String(value ?? '').toLowerCase(); return POWER_LEVELS.includes(text) ? text : DEFAULT_POWER; };
export const powerParams = level => POWER[sanitizePower(level)];

export function loadPower(storage = undefined) {
  try { const store = storage === undefined ? globalThis.localStorage : storage; return sanitizePower(store?.getItem(POWER_STORAGE_KEY)); } catch { return DEFAULT_POWER; }
}
export function savePower(level, storage = undefined) {
  try { const store = storage === undefined ? globalThis.localStorage : storage; if (!store) return false; store.setItem(POWER_STORAGE_KEY, sanitizePower(level)); return true; } catch { return false; }
}

/**
 * One step of the Worker's plugin-query server, as a pure function of the clock and the state.
 * state: { now, queuedAt (when the first job was queued), windowAt, windowMs (query time spent in the current one-second window), lastInputAt (last pointer or operation), busy }
 * -> { action: 'reject' } (waited longer than waitMs: answers 'busy') | { action: 'defer', delay, windowAt, windowMs } (try again in `delay` ms) | { action: 'serve', windowAt, windowMs }
 */
export function planPluginServe(state, params) {
  const { now, queuedAt, busy } = state; let { windowAt, windowMs } = state;
  if (now - queuedAt > params.waitMs) return { action: 'reject', windowAt, windowMs };
  if (now - windowAt >= 1000) { windowAt = now; windowMs = 0; }
  const quietLeft = params.inputQuietMs - (now - state.lastInputAt), spent = windowMs >= params.msPerSecond;
  if (busy || quietLeft > 0 || spent) return { action: 'defer', delay: busy ? params.retryMs : Math.max(params.retryMs, quietLeft, spent ? windowAt + 1000 - now : 0), windowAt, windowMs };
  return { action: 'serve', windowAt, windowMs };
}

/** Scan defaults of a level for the heap-scan queries (instances, referrers, findCompositionLocal): a plugin's own `budgetMs` / `limit` always wins. */
export function withScanDefaults(query, args, params) {
  if (query !== 'instances' && query !== 'referrers' && query !== 'findCompositionLocal') return args;
  const out = { ...args };
  if (out.budgetMs === undefined || out.budgetMs === null) out.budgetMs = query === 'findCompositionLocal' ? Math.max(150, params.scanBudgetMs) : params.scanBudgetMs;
  if ((out.limit === undefined || out.limit === null) && query !== 'findCompositionLocal') out.limit = params.scanLimit;
  return out;
}

/** The queries lab.batch may carry: read-only, one task each. Heap scans (paged by the plugin runtime) and composeTree (rate-limited, large) are not in it. */
export const BATCH_QUERIES = Object.freeze(['activity', 'viewModels', 'fragments', 'inspect', 'field', 'statics', 'staticField', 'classes', 'compositionLocals', 'methods', 'resourceIds']);
export const BATCH_MAX = 50;
