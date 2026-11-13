// The page side of OpenGL ES window surfaces (src/gles-native.js): each eglSwapBuffers of an app sends the surface's picture as an ImageBitmap (transferred, no copy) with the id
// of the SurfaceView it belongs to; device-view.js hands the element of every SurfaceView whose snapshot node carries `glSurface`. The picture is drawn into a canvas that fills
// the View's box (a bitmaprenderer context: the bitmap is handed over, not copied), the latest frame wins, and a frame that arrives before its element is kept until the element
// exists. Nothing runs for an app without GL surfaces. No process.*.

/** doc: the page document. Returns { bind(element, info), frame({ viewId, bitmap, width, height, opaque }), reset(), stats }. */
export function createGlSurfaces({ doc = globalThis.document } = {}) {
  const elements = new Map(), waiting = new Map(), stats = { frames: 0, dropped: 0 };
  function draw(element, frame) {
    const canvas = element._glCanvas; if (!canvas || !frame.bitmap) { frame.bitmap?.close?.(); return; }
    if (canvas.width !== frame.width) canvas.width = frame.width; if (canvas.height !== frame.height) canvas.height = frame.height;
    const context = canvas._bitmapContext ??= canvas.getContext('bitmaprenderer');
    if (context) context.transferFromImageBitmap(frame.bitmap); else frame.bitmap.close?.();
    element.style.backgroundColor = frame.opaque ? '#000' : element.style.backgroundColor;
    stats.frames++;
  }
  return {
    /** The element of a SurfaceView with its node's `glSurface` payload ({ viewId, frames, opaque }), or null when it has no GL surface any more. */
    bind(element, info) {
      if (!info) { element._glCanvas?.remove(); element._glCanvas = null; if (element._glInfo) elements.delete(element._glInfo.viewId); element._glInfo = null; return; }
      let canvas = element._glCanvas;
      if (!canvas) {
        canvas = element._glCanvas = doc.createElement('canvas'); canvas.className = 'android-gl-surface'; canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;image-rendering:auto';
      }
      if (canvas.parentNode !== element) element.prepend(canvas);
      if (!element.style.position) element.style.position = 'relative';
      element.style.overflow = 'hidden'; element.setAttribute('role', 'img'); element.setAttribute('aria-label', 'Superfície OpenGL ES');
      element._glInfo = info; elements.set(info.viewId, element);
      const pending = waiting.get(info.viewId); if (pending) { waiting.delete(info.viewId); draw(element, pending); }
    },
    /** One presented frame from the VM Worker. */
    frame(frame) {
      if (!frame) return; const element = elements.get(frame.viewId);
      if (element?.isConnected !== false && element) return draw(element, frame);
      const previous = waiting.get(frame.viewId); if (previous) { previous.bitmap?.close?.(); stats.dropped++; }
      waiting.set(frame.viewId, frame);
    },
    /** A new APK or VM: no surface is current. */
    reset() { for (const frame of waiting.values()) frame.bitmap?.close?.(); waiting.clear(); elements.clear(); },
    stats,
  };
}
