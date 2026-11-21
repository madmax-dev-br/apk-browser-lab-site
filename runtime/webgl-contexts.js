// The WebGL contexts this Worker holds: the GPU raster's (src/gpu-raster.js) and those behind EGL contexts (src/gles-native.js).
//
// A browser keeps only a few live WebGL contexts per thread and, when one more is created, loses the oldest one (Chrome logs "Too many active WebGL contexts.
// Oldest context will be lost."). In a Chrome Worker the limit is 4 (measured: a fifth context loses the first; contexts lost through WEBGL_lose_context free
// their slot at once, contexts merely dropped keep it until they are garbage collected). The GPU raster's context is created when the app loads, so it is the
// oldest: every context created after the first three others pushed it out. This module counts the contexts the lab holds, so a new one can be refused
// before the browser drops an older one, contexts are released explicitly (loseContext) when their owner is done, and a loss can say why it happened.
// Module state is per Worker (each Worker loads its own copy of the module).
export const WORKER_WEBGL_CONTEXTS = 4;

const live = [];   // { id, owner, label, gl, evictedBy } in creation order (the oldest first, the one the browser drops)
let nextId = 1;

/** Registers a context the lab just created. When the Worker already held the limit, the browser drops the oldest one: that entry is marked with what pushed it out. */
export function trackWebGLContext(owner, label, gl = null) {
  const entry = { id: nextId++, owner, label: String(label ?? owner), gl, evictedBy: null };
  const before = live.filter(other => !other.evictedBy);
  if (before.length >= WORKER_WEBGL_CONTEXTS) before[0].evictedBy = { label: entry.label, live: before.length + 1 };
  live.push(entry); return entry;
}
/** Releases a context: WEBGL_lose_context.loseContext() frees its slot at once (a dropped reference keeps it until GC); the entry leaves the count. */
export function releaseWebGLContext(entry, { lose = true } = {}) {
  if (!entry) return false; const at = live.indexOf(entry); if (at < 0) return false; live.splice(at, 1);
  if (lose) { try { if (!entry.gl?.isContextLost?.()) entry.gl?.getExtension?.('WEBGL_lose_context')?.loseContext(); } catch { /* not exposed: the context goes away with its canvas */ } }
  return true;
}
/** The contexts the lab holds now (copies), oldest first. */
export const liveWebGLContexts = () => live.filter(entry => !entry.evictedBy).map(({ id, owner, label }) => ({ id, owner, label }));
/** How many more contexts can be created before the browser drops one of the lab's. */
export const freeWebGLContexts = () => Math.max(0, WORKER_WEBGL_CONTEXTS - live.filter(entry => !entry.evictedBy).length);
/** Why a context was lost, when the lab knows: pushed out by a newer one over the browser's per-Worker limit; else null (the browser or the GPU dropped it). */
export function lossCause(entry) {
  if (!entry?.evictedBy) return null;
  return `pushed out by a newer WebGL context (${entry.evictedBy.label}): the browser keeps at most ${WORKER_WEBGL_CONTEXTS} WebGL contexts per Worker and drops the oldest`;
}
/** Tests: forget every context. */
export function resetWebGLContexts() { live.length = 0; nextId = 1; }
