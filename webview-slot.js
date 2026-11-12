// The page side of an android.webkit.WebView: the DOM element device-view.js keeps for a View of kind 'webview'. The VM owns the View (bounds, visibility, z-order among siblings
// come from the device-view tree like any other View); this module owns what is inside the box: the sandboxed iframe the WebView manager attaches (src/webview-frame.js).
// A WebView with no document draws nothing of its own, as on Android (a blank view over its white background, set by device-view.js): what the lab knows about the box
// (no page yet, loading, no browser backend on this host) is kept off the screen, in data attributes of the element. DOM-only, no VM state beyond the node's `webview` payload.

/** Lab diagnostic of the box: 'page' (a document is shown or was loaded), 'loading', 'empty' (nothing was loaded yet), 'no-backend' (this host cannot show documents), '' (no payload). */
export const webViewSlotState = (info, hasFrame) => !info ? '' : hasFrame ? 'page' : info.loading ? 'loading' : info.url ? 'page' : info.backend ? 'empty' : 'no-backend';

/** Brings `element` (a div of class android-webview) to the state described by `info` (the node's `webview` payload: url, loading, progress, backend...). */
export function updateWebViewSlot(element, info, { manager = null } = {}) {
  if (!element._webviewSlot) { element._webviewSlot = true; element.setAttribute('role', 'region'); element.setAttribute('aria-label', 'WebView'); }
  if (info && manager) manager.attach(info.webviewId, element);
  const hasFrame = !!manager?.frames.get(info?.webviewId)?.iframe;
  element.dataset.webviewId = info ? String(info.webviewId) : '';
  element.dataset.webviewState = webViewSlotState(info, hasFrame);
  element.dataset.webviewUrl = info?.url ?? '';
  element.dataset.webviewDocument = info?.document ?? '';   // 'blank', 'scriptable' or 'opaque' (a document of another origin: the lab can show it and nothing else)
  return element;
}
