// The page side of an android.webkit.WebView: the DOM element device-view.js keeps for a View of kind 'webview'. The VM owns the View (bounds, visibility, z-order among siblings
// come from the device-view tree like any other View); this module owns what is inside the box. Phase 0: a placeholder that says what the box is and what it was asked to load.
// Phase 1 adds the sandboxed iframe (src/webview-frame.js). DOM-only, no VM state beyond the node's `webview` payload.

/** Brings `element` (a div of class android-webview) to the state described by `info` (the node's `webview` payload: url, loading, progress, backend...). */
export function updateWebViewSlot(element, info, { manager = null } = {}) {
  let placeholder = element._placeholder;
  if (!placeholder) {
    placeholder = element._placeholder = document.createElement('div');
    placeholder.className = 'android-webview-placeholder'; placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:12px/1.3 sans-serif;color:#6b7280;pointer-events:none;overflow:hidden;text-align:center;padding:8px;box-sizing:border-box';
    element._label = document.createElement('div'); element._label.style.fontWeight = '600';
    element._detail = document.createElement('div'); element._detail.style.cssText = 'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    placeholder.append(element._label, element._detail);
    element.append(placeholder);
    element.setAttribute('role', 'region'); element.setAttribute('aria-label', 'WebView');
  }
  if (info && manager) manager.attach(info.webviewId, element);
  const hasFrame = !!manager?.frames.get(info?.webviewId)?.iframe;
  placeholder.style.display = hasFrame ? 'none' : 'flex';
  element._label.textContent = 'WebView';
  element._detail.textContent = !info ? '' : info.loading ? `carregando ${info.url ?? ''}` : info.url ? info.url : info.backend ? 'sem página' : 'sem navegador neste host';
  element.dataset.webviewId = info ? String(info.webviewId) : '';
  return element;
}
