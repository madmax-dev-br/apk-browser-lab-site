// A View's display raster (Canvas content, background/foreground Drawable layer) is replayed when somebody reads it (the page snapshot, a test), not when the frame
// is drawn: a frame that is replaced by the next one before any snapshot reads it (several Choreographer frames per page snapshot, or a page that is still drawing
// the previous one) is never rasterized. The recorded display list stays in the View's own Canvas until the next draw of that View replaces it, and CanvasProperty
// values / RenderNode properties are read at replay, as the RenderThread reads them when it draws. `runtime.rasterStats.deferred/superseded` count both.
//
// Progressive raster (src/motion-raster.js): the read replays at `r.displayRasterScale` (set by the Worker per snapshot: < 1 while the screen is moving, 1 once it
// is still). A reduced raster that is read again at full density is replayed again from the same recording (`rasterStats.refined/refinedMs`), so a settled screen
// ends at full density; a full raster is kept whatever the scale asked later (it is never worse). `r.displayRasterReducedServed` (an array, only while the Worker
// takes a snapshot) collects the identity of the reduced rasters that went into it (the settle rule compares them between snapshots).
import { bitmapRasterUsable } from './gpu-raster.js?v=07ce22d2e253';
const reducedId = value => value.rasterId ?? value.rasterSerial ?? '?';
// Only when the session ever selected the GPU renderer (r.gpuRaster exists): a content raster made by the other backend, or a GPU raster whose ImageBitmap left the
// Worker and is no longer held by the page, is replayed again from the same recording. CPU-only sessions never reach this check.
const staleBackend = (r, value) => (value.kind === 'bitmap-raster' ? r.contentRasterOptions?.transport !== 'gpu' || !bitmapRasterUsable(r, value) : value.kind === 'rgba-raster' && r.contentRasterOptions?.transport === 'gpu');
/**
 * `make(scale)` replays the View's current recording at `scale` (1 = full density). The property keeps its plain-value behavior: assigning a value (or null) drops
 * the deferred replay. The deferred replay must read only what a record property of the View keeps alive (its own Canvas): no second root is kept here (a duplicate
 * `{ref}` property on the View record broke the page's taps in the browser parity flows, cause not found: keep the record as it was).
 */
export function deferRaster(r, view, prop, make) {
  const stats = r.rasterStats ??= { calls: 0, rasterized: 0, hits: 0, keyMs: 0, replayMs: 0, encodeMs: 0 };
  if (!Object.hasOwn(view, 'deferredRasters')) Object.defineProperty(view, 'deferredRasters', { configurable: true, enumerable: false, value: Object.create(null) });   // not enumerable: a heap walk or a record copy never sees the replays
  const state = view.deferredRasters;
  if (!Object.getOwnPropertyDescriptor(view, prop)?.get) {
    const slot = state[prop] = { make: null, pending: false, value: view[prop] ?? null };
    Object.defineProperty(view, prop, { configurable: true, enumerable: false,
      get() {
        if (slot.make) {
          const wanted = r.displayRasterScale ?? 1, held = slot.value;
          if (slot.pending) { slot.pending = false; slot.value = slot.make(wanted); }
          else if (r.gpuRaster && held && staleBackend(r, held)) { slot.value = slot.make(wanted); stats.rebackend = (stats.rebackend ?? 0) + 1; }   // renderer switched (src/gpu-raster.js) or a GPU bitmap the page no longer holds: the same recording again
          else if (held && (held.scale ?? 1) < wanted) { const t0 = performance.now(); slot.value = slot.make(wanted); stats.refined = (stats.refined ?? 0) + 1; stats.refinedMs = (stats.refinedMs ?? 0) + (performance.now() - t0); }   // the settled screen: the same recording at full density
        }
        const value = slot.value ?? null; if (value && (value.scale ?? 1) < (r.displayRasterSettledScale ?? 1)) r.displayRasterReducedServed?.push(reducedId(value));   // below what the settled screen is drawn at: a refinement is owed
        return value;
      },
      set(value) { slot.make = null; slot.pending = false; slot.value = value; } });
  }
  const slot = state[prop];
  if (slot.pending) stats.superseded = (stats.superseded ?? 0) + 1; stats.deferred = (stats.deferred ?? 0) + 1;
  slot.make = make; slot.pending = true;
}
