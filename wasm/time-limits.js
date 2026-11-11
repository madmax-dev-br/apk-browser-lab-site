// "Tempo máximo por evento" (Controles > Execução): how long the VM lets one event and one operation run before it ends them with the diagnostic report. The automatic choice keeps the
// defaults (25 s per event, 20 s per operation); a longer choice lets a slow start-up with hundreds of threads finish (the VM runs app code many times slower than a device). Every cap grows
// with it: the per-event watchdog, the operation budget and the two caps of a main-thread event that does not return to its Looper. No choice removes the limit: a real endless loop must
// still end with a report. DOM-free and no process.*: used by the page and the Worker.
export const EVENT_SECONDS_STEPS = [60, 120, 300];
export const DEFAULT_EVENT_WALL_MS = 25000, DEFAULT_OPERATION_MS = 20000, DEFAULT_MAIN_EVENT_CAP_MS = 120000, DEFAULT_HARD_CAP_MS = 180000;

/** The limits for a choice in seconds (0 or anything outside the steps: the defaults). */
export function timeLimitsFor(seconds) {
  const s = EVENT_SECONDS_STEPS.includes(Number(seconds)) ? Number(seconds) * 1000 : 0;
  if (!s) return { eventWallMs: DEFAULT_EVENT_WALL_MS, operationMs: DEFAULT_OPERATION_MS, mainEventCapMs: DEFAULT_MAIN_EVENT_CAP_MS, hardCapMs: DEFAULT_HARD_CAP_MS, seconds: 0 };
  return { eventWallMs: s, operationMs: s, mainEventCapMs: Math.max(DEFAULT_MAIN_EVENT_CAP_MS, s), hardCapMs: Math.max(DEFAULT_HARD_CAP_MS, s + 60000), seconds: s / 1000 };
}

/** Applies the limits to a runtime and its operation monitor (between two events; takes effect at the next budget check). */
export function applyTimeLimits(runtime, seconds) {
  const limits = timeLimitsFor(seconds);
  runtime.maxEventWallMs = limits.eventWallMs;
  const monitor = runtime.monitor;
  if (monitor) { if (monitor.budgetMs > 0 || monitor.active) monitor.budgetMs = limits.operationMs; monitor.mainEventCapMs = limits.mainEventCapMs; monitor.hardCapMs = limits.hardCapMs; }
  return limits;
}
