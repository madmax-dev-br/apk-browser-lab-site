// "Tela cheia": the preview stage becomes a fixed layer over the page (dim + backdrop blur) and the device is fitted to the viewport.
// Only the CSS scale of the device changes (device-view.js fitDevice): the VM keeps its size and density, the canvases keep their backing size,
// and nothing is moved in the DOM (WebView iframes would reload), so the permission dialog, the layout-bounds canvas and WebView frames, which live
// inside the device, follow it. Pointer coordinates are already converted with the element's rendered/offset size ratio, so taps land at any scale.
// The browser Fullscreen API is not used: it is unavailable in some embeds, and the in-page layer works everywhere.

/** Largest CSS scale of the device in fullscreen (the lab's preview caps it at 0.7). */
export const FULLSCREEN_MAX_SCALE = 4;

/**
 * @param stage        the preview stage (contains the device)
 * @param openButton   "Tela cheia" button
 * @param closeButton  close button inside the stage (shown only in fullscreen)
 * @param deviceState  shared device state; maxScale / stagePadding are read by fitDevice
 * @param refit        () -> refit the device to the stage
 */
export function createDeviceFullscreen({ stage, openButton, closeButton, deviceState, refit, doc = globalThis.document }) {
  let saved = null, spacer = null;
  const isOpen = () => saved !== null;
  function open() {
    if (isOpen() || !stage) return;
    saved = { maxScale: deviceState.maxScale, stagePadding: deviceState.stagePadding, focus: doc.activeElement };
    spacer = doc.createElement('div'); spacer.className = 'preview-stage-spacer'; spacer.style.height = `${stage.offsetHeight}px`; stage.before(spacer);   // the page behind keeps its layout
    stage.classList.add('device-fullscreen'); doc.documentElement.classList.add('has-device-fullscreen');
    stage.setAttribute('role', 'dialog'); stage.setAttribute('aria-modal', 'true'); stage.setAttribute('aria-label', 'Dispositivo em tela cheia');
    deviceState.maxScale = FULLSCREEN_MAX_SCALE; deviceState.stagePadding = 16;   // the device takes the viewport: 8px of air on each side horizontally, 4px vertically
    if (closeButton) closeButton.hidden = false; openButton?.setAttribute('aria-pressed', 'true');
    refit(); closeButton?.focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen()) return;
    const { maxScale, stagePadding, focus } = saved; saved = null;
    if (maxScale === undefined) delete deviceState.maxScale; else deviceState.maxScale = maxScale;
    if (stagePadding === undefined) delete deviceState.stagePadding; else deviceState.stagePadding = stagePadding;
    stage.classList.remove('device-fullscreen'); doc.documentElement.classList.remove('has-device-fullscreen');
    stage.removeAttribute('role'); stage.removeAttribute('aria-modal'); stage.removeAttribute('aria-label');
    spacer?.remove(); spacer = null;
    if (closeButton) closeButton.hidden = true; openButton?.setAttribute('aria-pressed', 'false');
    refit(); (focus && doc.contains(focus) ? focus : openButton)?.focus?.({ preventScroll: true });
  }
  openButton?.addEventListener('click', () => (isOpen() ? close() : open()));
  closeButton?.addEventListener('click', event => { event.stopPropagation(); close(); });
  // a click on the backdrop itself (not on the device or anything inside the stage) closes
  stage?.addEventListener('click', event => { if (isOpen() && event.target === stage) close(); });
  // Esc closes unless something inside already handled it (a dialog of the app, an input method)
  doc.addEventListener('keydown', event => { if (isOpen() && event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close(); } });
  return { open, close, isOpen };
}
