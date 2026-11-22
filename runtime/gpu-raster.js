// Experimental GPU replay of display rasters ("Rendering: GPU (experimental)" in Controles › Execução, player config `renderer: 'gpu'`).
//
// The CPU path (the default) is untouched: with renderer 'cpu' nothing in this module is created and the content rasters keep `{ transport: 'rgba' }`
// (src/skia-canvas-host.js, src/raster-cache.js). With renderer 'gpu' the Worker creates one WebGL context on an OffscreenCanvas with the pinned CanvasKit
// (vendor/canvaskit/0.42.0 is the full npm build: it includes Skia's Ganesh GL backend; there is no WebGPU/Graphite in it) and the content rasters ask for
// `{ transport: 'gpu' }`: the same recorded display list is replayed by the same replay code on a GL surface instead of a CPU surface, and the frame leaves
// the Worker as an ImageBitmap (`OffscreenCanvas.transferToImageBitmap()`, transferred to the page with no copy) that the page draws on the content layer.
//
// Fallback, never a broken screen: no OffscreenCanvas/WebGL in the Worker, a context that cannot be created, a replay or transfer that throws, or
// frames slower than SLOW_FRAME_MS for SLOW_FRAMES frames in a row switch the session to CPU (`fallback(reason)`), which is reported (Logcat warning, the
// Controles status line, vmHealth.renderer, the Resumo) and the failed raster is replayed on the CPU at once. Validation and parity always run on CPU.
// A lost context is not a fallback at once: as the WebGL spec intends, the controller creates a new context (a new engine on a new canvas) up to
// MAX_LOST_RECOVERIES times per session, each recorded in the trace with what was lost and why; the raster that met the loss is replayed on the CPU. Only a loss
// past that, or a new context that cannot be created, switches the session to CPU. The context is counted in src/webgl-contexts.js (the browser keeps at most
// 4 WebGL contexts per Worker and drops the oldest): that is what names the cause of a loss when an OpenGL ES context of the app pushed it out.
//
// View Drawable layers (background/foreground, the layers XML screens spend their raster time on) are replayed on the GPU as well (`{ transport: 'gpu-png' }`)
// and read back as the same PNG the page already shows (a synchronous GPU read-back plus the CPU PNG encode: the replay moves, the encode does not).
// What stays on the CPU even with GPU selected: Bitmap pixel reads (Bitmap.getPixel/compress, typed surfaces) and the other PNG rasters (shadows, nine-patches, text).
import { trackWebGLContext, releaseWebGLContext, freeWebGLContexts, liveWebGLContexts, lossCause, WORKER_WEBGL_CONTEXTS } from './webgl-contexts.js?v=5fccdbc9ed78';
export const RENDERERS = Object.freeze(['cpu', 'gpu']);
export const DEFAULT_RENDERER = 'cpu';   // what a caller that names no renderer gets (the Worker, Node, the servers): nothing of the GPU path is created
/** The renderer of the device settings (the lab page and the player) when none was chosen: the GPU replay, which falls back to CPU by itself where WebGL is not available in the Worker. */
export const DEFAULT_SETTING_RENDERER = 'gpu';
export const sanitizeRendererSetting = value => (value === 'cpu' || value === 'gpu' ? value : DEFAULT_SETTING_RENDERER);
export const sanitizeRenderer = value => (value === 'gpu' ? 'gpu' : DEFAULT_RENDERER);
export const SLOW_FRAME_MS = 250, SLOW_FRAMES = 3, MAX_LOST_RECOVERIES = 2;

/** A GPU raster failure that must switch the session to CPU (as opposed to a replay error the CPU path raises as well). */
export class GpuRasterError extends Error {
  constructor(reason, cause = null, { lost = false } = {}) { super(reason); this.name = 'GpuRasterError'; this.reason = reason; this.lost = lost; if (cause) this.cause = cause; }
}
/** The reason of a lost context, in the words the UI and the trace show. */
export const lostReason = cause => `WebGL context lost (${cause || 'the browser gave no cause: a GPU process reset, a driver error or GPU memory pressure'})`;

/**
 * The WebGL engine: one OffscreenCanvas + WebGL context + Skia GrDirectContext for the whole session. `begin(w, h)` sizes the canvas and returns a Skia
 * surface on its drawing buffer; `finish(surface)` flushes and transfers the drawing buffer as an ImageBitmap. Throws GpuRasterError with a reason the UI shows.
 * `createCanvas` is injectable (tests); the default needs a real OffscreenCanvas with WebGL (a browser Worker).
 */
export function createWebGLRasterEngine(CK, { createCanvas = null } = {}) {
  if (freeWebGLContexts() === 0) throw new GpuRasterError(`no WebGL context left: the browser keeps at most ${WORKER_WEBGL_CONTEXTS} per Worker and the lab holds ${liveWebGLContexts().map(c => c.label).join(', ')}`);
  if (!CK || typeof CK.GetWebGLContext !== 'function' || typeof CK.MakeWebGLContext !== 'function' || typeof CK.MakeOnScreenGLSurface !== 'function' || typeof CK.MakeRenderTarget !== 'function') throw new GpuRasterError('this CanvasKit version has no WebGL backend');
  if (!createCanvas && typeof OffscreenCanvas === 'undefined') throw new GpuRasterError('OffscreenCanvas unavailable in the Worker');
  let canvas;
  try { canvas = createCanvas ? createCanvas(1, 1) : new OffscreenCanvas(1, 1); } catch (error) { throw new GpuRasterError('OffscreenCanvas unavailable in the Worker', error); }
  if (!canvas || typeof canvas.transferToImageBitmap !== 'function') throw new GpuRasterError('OffscreenCanvas without transferToImageBitmap');
  // No preventDefault on the loss: the controller recovers with a new context, so the browser must not restore this one (a restored context would hold a slot).
  let lost = false, lostMessage = '', tracked = null, disposed = false;
  canvas.addEventListener?.('webglcontextlost', event => { lost = true; lostMessage = String(event?.statusMessage ?? '').slice(0, 160); });
  canvas.addEventListener?.('webglcontextrestored', () => { if (disposed) { try { canvas.getContext?.('webgl2')?.getExtension?.('WEBGL_lose_context')?.loseContext(); } catch { /* gone */ } } });
  let handle;
  try { handle = CK.GetWebGLContext(canvas, { antialias: 0, depth: 0, stencil: 8, alpha: 1, premultipliedAlpha: 1, preserveDrawingBuffer: 0 }); } catch (error) { throw new GpuRasterError('WebGL unavailable in the Worker', error); }
  if (!handle || handle < 0) throw new GpuRasterError('WebGL unavailable in the Worker (the context was not created)');
  // The GL context CanvasKit created on the canvas (getContext of the same type returns it); used for the renderer name, the lost check and its release.
  let gl = null; try { gl = canvas.getContext?.('webgl2') ?? null; } catch { gl = null; } if (!gl) { try { gl = canvas.getContext?.('webgl') ?? null; } catch { gl = null; } }
  tracked = trackWebGLContext('gpu-raster', 'the GPU raster (Skia)', gl);
  const gr = CK.MakeWebGLContext(handle); if (!gr) { releaseWebGLContext(tracked); throw new GpuRasterError('Skia did not create the GPU context (GrDirectContext)'); }
  const info = { api: gl && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL', renderer: null };
  try { const ext = gl?.getExtension?.('WEBGL_debug_renderer_info'); if (ext) info.renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '').slice(0, 160) || null; } catch { /* not exposed */ }
  let width = 0, height = 0, frames = 0, screen = null, screenBase = 1;
  /** What was lost and why: the GPU raster's WebGL context, pushed out by a newer one (src/webgl-contexts.js) or dropped by the browser (its status message, if any). */
  const lostError = () => new GpuRasterError(lostReason(lossCause(tracked) ?? (lostMessage ? `the browser said: ${lostMessage}` : null)), null, { lost: true });
  /** The canvas state of a fresh surface: identity matrix, the whole surface as the clip. */
  const pristine = (drawing, w, h) => {
    const m = drawing.getTotalMatrix(), clip = drawing.getDeviceClipBounds();
    return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 && m[4] === 1 && m[5] === 0 && m[6] === 0 && m[7] === 0 && m[8] === 1 && clip[0] === 0 && clip[1] === 0 && clip[2] === w && clip[3] === h;
  };
  const dropScreen = () => { if (screen !== null) { try { screen.delete(); } catch { /* lost context */ } screen = null; } };
  return {
    kind: 'webgl', info,
    isLost() { try { return lost || !!gl?.isContextLost?.(); } catch { return true; } },
    /** `offscreen`: a GPU render target (a texture Skia recycles through its resource cache) for a raster read back on the Worker (Drawable layer PNGs), so those
     *  never resize the canvas whose drawing buffer the content frames are transferred from. */
    begin(w, h, offscreen = false) {
      if (disposed) throw new GpuRasterError('the GPU context was disposed');
      if (this.isLost()) throw lostError();
      if (offscreen) { const target = CK.MakeRenderTarget(gr, w, h); if (!target) throw new GpuRasterError(`Skia did not create the GPU texture (${w}×${h})`); return target; }
      if (w !== width || h !== height) { canvas.width = w; canvas.height = h; width = w; height = h; dropScreen(); }
      // One Skia surface on the drawing buffer (a wrapper of the default framebuffer) while the size stays: making it again every frame queried the GL state
      // (getParameter, synchronous) each time. The replay draws inside a save of its own, so restoring to the base count gives the next frame the fresh surface's
      // identity matrix and open clip; transferToImageBitmap swaps the buffer under the same framebuffer, and every replay clears it first.
      if (screen !== null) {   // a replay that restored past its own saves changed the base state: that surface is not reused
        const drawing = screen.getCanvas(); drawing.restoreToCount(screenBase);
        if (!pristine(drawing, w, h)) dropScreen();
      }
      if (screen === null) {
        screen = CK.MakeOnScreenGLSurface(gr, w, h, CK.ColorSpace.SRGB);
        if (!screen) throw new GpuRasterError(`Skia did not create the GPU surface (${w}×${h})`);
        screenBase = screen.getCanvas().getSaveCount();
      }
      screen.getCanvas().save();
      return screen;
    },
    release(target) { if (target === screen) { try { target.getCanvas().restoreToCount(screenBase); } catch { /* lost context */ } return; } try { target?.delete(); } catch { /* lost context */ } },
    finish(target) {
      target.flush();
      let bitmap;
      try { bitmap = canvas.transferToImageBitmap(); } catch (error) { throw new GpuRasterError('the transfer of the GPU frame failed', error); }
      if (!bitmap || bitmap.width !== width || bitmap.height !== height) { try { bitmap?.close?.(); } catch { /* closing */ } throw new GpuRasterError('the transfer of the GPU frame returned an invalid bitmap'); }
      if (this.isLost()) { try { bitmap.close?.(); } catch { /* closing */ } throw lostError(); }
      frames++; return bitmap;
    },
    /** GPU memory this engine holds: the drawing buffer plus Skia's resource cache (textures, programs). */
    memory() { let cache = null; try { cache = typeof gr._getResourceCacheUsageBytes === 'function' ? gr._getResourceCacheUsageBytes() : null; } catch { cache = null; } return { drawingBufferBytes: width * height * 4, skiaCacheBytes: Number.isFinite(cache) ? cache : null, frames }; },
    dispose() {
      if (disposed) return; disposed = true;
      dropScreen();
      try { if (!lost) gr.releaseResourcesAndAbandonContext?.(); } catch { /* lost context */ }
      try { gr.delete(); } catch { /* lost context */ }
      releaseWebGLContext(tracked);   // loseContext: the slot is free at once (src/webgl-contexts.js)
    },
  };
}

/**
 * The session's renderer: what the user asked (`requested`), what is in use (`active`), the fallback reason. One per Worker runtime (runtime.gpuRaster).
 * `select(mode)` is the live switch: it creates or disposes the engine and drops the other backend's cached rasters (the cache key carries the transport,
 * so a stale entry is never served anyway; dropping them frees the memory). `onFallback(reason)` reports a switch to CPU.
 */
export class GpuRasterController {
  constructor({ CanvasKit, createEngine = CK => createWebGLRasterEngine(CK), onFallback = null, onRecover = null, slowFrameMs = SLOW_FRAME_MS, slowFrames = SLOW_FRAMES } = {}) {
    this.CanvasKit = CanvasKit; this.createEngine = createEngine; this.onFallback = onFallback; this.onRecover = onRecover; this.slowFrameMs = slowFrameMs; this.slowFrames = slowFrames;
    this.requested = 'cpu'; this.active = 'cpu'; this.reason = null; this.engine = null; this.slowRun = 0;
    this.stats = { frames: 0, ms: 0, maxMs: 0, fallbacks: 0, switches: 0, recoveries: 0 }; this.lastLoss = null;
  }
  /** The content-raster options the replay asks for (src/compose-canvas-host.js reads runtime.contentRasterOptions at every replay). */
  get rasterOptions() { return this.active === 'gpu' ? { transport: 'gpu' } : { transport: 'rgba' }; }
  /** View Drawable layers (src/drawable-view-host.js runtime.layerRasterOptions): replayed on the GPU and read back as the same PNG the page already shows; undefined = the CPU path. */
  get layerOptions() { return this.active === 'gpu' ? { transport: 'gpu-png' } : undefined; }
  apply(runtime) { runtime.contentRasterOptions = this.rasterOptions; runtime.layerRasterOptions = this.layerOptions; }
  select(mode, runtime = null) {
    const wanted = sanitizeRenderer(mode), before = this.active;
    this.requested = wanted; this.stats.switches++;
    if (wanted === 'cpu') { this.dispose(); this.active = 'cpu'; this.reason = null; }
    else if (this.active !== 'gpu') {
      this.reason = null; this.slowRun = 0; this.stats.recoveries = 0;   // the user's explicit choice: a new session of the GPU path
      try { this.engine = this.createEngine(this.CanvasKit); this.active = 'gpu'; }
      catch (error) { this.engine = null; this.active = 'cpu'; this.reason = error instanceof GpuRasterError ? error.reason : `failed to start the GPU: ${String(error?.message ?? error).slice(0, 160)}`; this.stats.fallbacks++; this.onFallback?.(this.reason); }
    }
    if (runtime) { this.apply(runtime); if (before !== this.active) dropBackendRasters(runtime, before); }
    return this.status();
  }
  /** Switch the session to CPU for good (until the user selects GPU again): the engine is released and the reason is kept for the UI and the report. */
  fallback(reason, runtime = null) {
    if (this.active !== 'gpu') return;
    this.active = 'cpu'; this.reason = String(reason || 'unknown error').slice(0, 240); this.stats.fallbacks++; this.dispose();
    if (runtime) { this.apply(runtime); dropBackendRasters(runtime, 'gpu'); }
    this.onFallback?.(this.reason);
  }
  /** A GPU raster failed with `error`: a lost context is recovered with a new one (up to MAX_LOST_RECOVERIES per session, `onRecover(text)` says what was lost, why and
   *  that a new context took over); anything else, a loss past the limit or a new context that cannot be created, is a fallback to CPU. Returns true when the GPU stays. */
  failed(error, runtime = null) {
    if (this.active !== 'gpu') return false;
    const reason = error instanceof GpuRasterError ? error.reason : String(error?.message ?? error);
    if (error instanceof GpuRasterError && error.lost) {
      this.lastLoss = reason;
      if (this.stats.recoveries < MAX_LOST_RECOVERIES) {
        this.dispose();
        try {
          this.engine = this.createEngine(this.CanvasKit); this.stats.recoveries++; this.slowRun = 0;
          this.onRecover?.(`${reason}; a new WebGL context took over (recovery ${this.stats.recoveries} of ${MAX_LOST_RECOVERIES})`);
          return true;
        } catch (cause) {
          this.engine = null;
          this.fallback(`${reason}; a new WebGL context could not be created: ${cause instanceof GpuRasterError ? cause.reason : String(cause?.message ?? cause).slice(0, 160)}`, runtime); return false;
        }
      }
      this.fallback(`${reason}; ${MAX_LOST_RECOVERIES} new contexts were lost already`, runtime); return false;
    }
    this.fallback(reason, runtime); return false;
  }
  /** One GPU frame took `ms` (replay + flush + transfer): SLOW_FRAMES frames in a row slower than SLOW_FRAME_MS mean the GPU path is worse than the CPU. */
  noteFrame(ms, runtime = null) {
    this.stats.frames++; this.stats.ms += ms; if (ms > this.stats.maxMs) this.stats.maxMs = ms;
    if (ms > this.slowFrameMs) { if (++this.slowRun >= this.slowFrames) this.fallback(`${this.slowFrames} consecutive frames above ${this.slowFrameMs} ms on the GPU`, runtime); }
    else this.slowRun = 0;
  }
  dispose() { const engine = this.engine; this.engine = null; try { engine?.dispose(); } catch { /* lost context */ } }
  status() {
    const memory = this.engine?.memory?.() ?? null;
    return { requested: this.requested, active: this.active, reason: this.reason, api: this.active === 'gpu' ? this.engine?.info?.api ?? null : null, gpuRenderer: this.engine?.info?.renderer ?? null,
      frames: this.stats.frames, gpuMs: Math.round(this.stats.ms), maxMs: Math.round(this.stats.maxMs), fallbacks: this.stats.fallbacks, recoveries: this.stats.recoveries, lastLoss: this.lastLoss, memory };
  }
}

/** Drops the cached rasters of one backend (raster cache entries whose key carries its transport). */
export function dropBackendRasters(runtime, backend) {
  const cache = runtime.rasterCache; if (!cache) return 0;
  // GPU entries carry "transport":"gpu" or "gpu-png"; CPU content entries "rgba". CPU Drawable-layer PNG entries (no transport) are left: they are the CPU path's own cache.
  const markers = backend === 'gpu' ? ['"transport":"gpu"', '"transport":"gpu-png"'] : ['"transport":"rgba"']; let dropped = 0;
  for (const [key, entry] of cache) {
    const prefixEnd = key.indexOf(']'); if (prefixEnd < 0) continue; const prefix = key.slice(0, prefixEnd);
    if (!markers.some(marker => prefix.includes(marker))) continue;
    cache.delete(key); runtime.rasterCacheBytes = (runtime.rasterCacheBytes ?? 0) - entry.size; dropped++;
  }
  return dropped;
}

/** A GPU raster still usable by its holder: its ImageBitmap was not transferred yet, or the page already holds it (the Worker's sender knows). */
export const bitmapRasterUsable = (runtime, value) => value?.kind === 'bitmap-raster' && ((value.bitmap?.width ?? 0) > 0 || !!runtime.displayRasterHeld?.(value.rasterId));
