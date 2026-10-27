import { APKError } from './apk-error.js?v=64078a5322f4';
import { networkOf } from './network-native.js?v=64078a5322f4';
import { WEBVIEW_ERRORS } from './webview-host.js?v=64078a5322f4';

// The Worker's side of the WebView backend (design: docs/APK-REAL-TASKS.md, task 33). The page owns the iframes (src/webview-frame.js); this module decides what may be loaded,
// tells the page what to load (`post`), and turns the page's events (`handleEvent`) into the callbacks Android would deliver, on the VM main thread, in Android's order.
//
// Phase 1 scope: loadUrl / loadData / loadDataWithBaseURL / postUrl, the network policy, host history, onPageStarted / onProgressChanged (0 and 100 only) / onPageFinished /
// onReceivedError for the errors the lab itself causes (policy, offline, timeout). Everything the browser keeps from the lab (scripting a cross-origin frame, in-frame
// navigation, titles, console) is phase 2 or impossible, and fails explicitly: see `evaluate`.

/** Directory of the lab origin a WebView may load from: documents the lab serves for that purpose. Every other lab path is refused (the WebView must not frame the lab itself). */
export const LAB_WEBVIEW_PATH = '/webview/';
const SCHEMES = new Set(['http:', 'https:']);

/** The decision for a main-frame navigation to `text`: { ok: true, url } or { ok: false, code, description } with Android's error codes and Chromium's net error names. */
export function decideNavigation(text, { labOrigin = '', online = true, allowed = () => false, blockNetworkLoads = false } = {}) {
  let url;
  try { url = new URL(text, labOrigin || undefined); } catch { return { ok: false, code: WEBVIEW_ERRORS.BAD_URL, description: 'net::ERR_INVALID_URL' }; }
  if (url.protocol === 'about:') return url.href === 'about:blank' ? { ok: true, url: url.href } : { ok: false, code: WEBVIEW_ERRORS.BAD_URL, description: 'net::ERR_INVALID_URL' };
  if (url.protocol === 'data:') return { ok: true, url: url.href };
  if (url.protocol === 'file:') return { ok: false, code: WEBVIEW_ERRORS.UNSUPPORTED_SCHEME, description: 'net::ERR_UNKNOWN_URL_SCHEME (file: URLs, including file:///android_asset/, need the asset server of a later phase)' };
  if (!SCHEMES.has(url.protocol)) return { ok: false, code: WEBVIEW_ERRORS.UNSUPPORTED_SCHEME, description: `net::ERR_UNKNOWN_URL_SCHEME (${url.protocol})` };
  if (labOrigin && url.origin === labOrigin) {
    return url.pathname.startsWith(LAB_WEBVIEW_PATH) ? { ok: true, url: url.href }
      : { ok: false, code: WEBVIEW_ERRORS.UNSAFE_RESOURCE, description: `net::ERR_BLOCKED_BY_CLIENT (a WebView may load only ${LAB_WEBVIEW_PATH} documents from the lab itself)` };
  }
  if (blockNetworkLoads) return { ok: false, code: WEBVIEW_ERRORS.UNKNOWN, description: 'net::ERR_ACCESS_DENIED (WebSettings.setBlockNetworkLoads)' };
  if (!online) return { ok: false, code: WEBVIEW_ERRORS.CONNECT, description: 'net::ERR_INTERNET_DISCONNECTED' };
  if (!allowed(url.hostname, url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80)) {
    return { ok: false, code: WEBVIEW_ERRORS.HOST_LOOKUP, description: `net::ERR_NAME_NOT_RESOLVED (${url.hostname} is not in the allowed hosts of the virtual device)` };
  }
  return { ok: true, url: url.href };
}

/** `post(message)` sends a message to the page; `labOrigin` is the page origin (empty when there is none, e.g. tests). */
export function createWebViewBackend({ platform, post, labOrigin = '', timeoutMs = 30000 }) {
  const views = new Map();   // WebView id -> { self }
  const host = () => platform.webView.internals;
  const policyFor = (r, state) => {
    const network = networkOf(r), settings = state.settings ? r.object(state.settings).values : null;
    return { labOrigin, online: network.online, allowed: (hostname, port) => network.allowed(hostname, port), blockNetworkLoads: !!settings?.get('BlockNetworkLoads') };
  };
  const serial = request => ({ kind: request.kind, url: request.url, baseUrl: request.baseUrl ?? null, data: request.data ?? null, mime: request.mime ?? null, encoding: request.encoding ?? null,
    body: request.body ? Array.from(request.body) : null, headers: Object.fromEntries(request.headers ?? []) });

  const backend = {
    capabilities: Object.freeze({ frame: true, bridge: false }),
    /** Start a main-frame load (loadUrl, loadData, loadDataWithBaseURL, postUrl, reload, back/forward): refuse it with Android's error, or ask the page to load it. */
    load(r, self, state, request) {
      const h = host(), display = request.displayUrl ?? request.url;
      if (/^javascript:/i.test(request.url ?? '')) { backend.evaluate(r, self, state, request.url.slice(11), null); return; }
      if (request.kind === 'url' || request.kind === 'post') {
        const decision = decideNavigation(request.url, policyFor(r, state));
        if (!decision.ok) { h.failLoad(r, self, state, display, decision.code, decision.description); return; }
        request = { ...request, url: decision.url }; if (request.displayUrl === undefined) request.displayUrl = decision.url;
      } else if (request.kind === 'dataBase' && request.baseUrl !== 'about:blank') {
        try { new URL(request.baseUrl); }   // the base only has to be an absolute URL: nothing is fetched from it
        catch { h.failLoad(r, self, state, display, WEBVIEW_ERRORS.BAD_URL, 'net::ERR_INVALID_URL'); return; }
      }
      const shown = request.displayUrl ?? request.url, loadId = ++state.loadId;
      state.loading = true; state.progress = 0; state.url = shown; state.originalUrl = request.reload || request.history === 'keep' ? state.originalUrl ?? shown : shown; state.title = null;
      views.set(state.id, { self });
      if (request.history !== 'keep' && !request.reload) h.pushHistory(state, { url: shown, originalUrl: shown, title: null, request: { ...request, history: undefined } });
      if (state.interfaces.size && !backend.capabilities.bridge) {
        const note = 'addJavascriptInterface registered, but the page bridge that exposes it arrives in phase 2: the interface is not visible to the page';
        if (!platform.webViewNotes?.has(note)) { (platform.webViewNotes ??= new Set()).add(note); r.record(`STUB-WEBVIEW addJavascriptInterface (${note})`); }
      }
      h.postMain(r, () => {
        if (state.destroyed || loadId !== state.loadId) return;
        h.clientCall(r, state, 'onPageStarted', ['Landroid/webkit/WebView;', 'Ljava/lang/String;', 'Landroid/graphics/Bitmap;'], 'V', [self, shown, null]);
        h.chromeCall(r, state, 'onProgressChanged', ['Landroid/webkit/WebView;', 'I'], 'V', [self, 0]);
      }, [self, state.client, state.chrome]);
      const settings = h.settingsOf(r, self), values = r.object(settings).values;
      post({ type: 'webview', op: 'load', id: state.id, loadId, request: serial(request), javascript: !!values.get('JavaScriptEnabled'), timeoutMs, userAgent: values.get('UserAgentString') });
    },
    stop(r, self, state) { post({ type: 'webview', op: 'stop', id: state.id }); },
    destroy(r, self, state) { post({ type: 'webview', op: 'destroy', id: state.id }); views.delete(state.id); },
    interfaceChanged() { /* phase 2 */ },
    settingChanged() { /* applied at the next load: the sandbox of an iframe is fixed when it is created */ },
    /**
     * evaluateJavascript / loadUrl("javascript:..."). Phase 1 has no page bridge, so no document is scriptable: strict mode stops with the explicit error, tolerant modes give the
     * callback null (what Android gives when the script fails) and leave a STUB-WEBVIEW line.
     */
    evaluate(r, self, state, script, callback) {
      const h = host(), message = 'evaluateJavascript needs the page bridge that scripts a WebView document; this build has none yet (phase 2), and a document of another origin can never be scripted';
      if (r.tolerateMissing === 'off' || r.tolerateMissing === undefined) throw new APKError(`android.webkit.WebView.${message}`, { kind: 'webview-unavailable', method: 'evaluateJavascript' });
      if (!platform.webViewNotes?.has('evaluate')) { (platform.webViewNotes ??= new Set()).add('evaluate'); r.record(`STUB-WEBVIEW evaluateJavascript (${message})`); }
      if (callback !== null && callback !== undefined && callback !== 0) h.postMain(r, () => h.call(r, callback, 'Landroid/webkit/ValueCallback;', 'onReceiveValue', ['Ljava/lang/Object;'], 'V', [null]), [callback, self]);
    },
    /** An event from the page about WebView `event.id` (called outside the VM: everything that touches Java is queued onto the main thread). */
    handleEvent(r, event) {
      const entry = views.get(event.id); if (!entry) return;
      const h = host(), state = h.stateOf(r, entry.self), self = entry.self;
      if (state.destroyed || event.loadId !== state.loadId) return;   // a stale load: the app already started another one
      const url = state.url;
      if (event.event === 'finished') {
        h.postMain(r, () => {
          if (state.destroyed || event.loadId !== state.loadId) return;
          state.loading = false; state.progress = 100;
          h.chromeCall(r, state, 'onProgressChanged', ['Landroid/webkit/WebView;', 'I'], 'V', [self, 100]);
          h.clientCall(r, state, 'onPageFinished', ['Landroid/webkit/WebView;', 'Ljava/lang/String;'], 'V', [self, url]);
          platform.requestDraw?.(r, self);
        }, [self, state.client, state.chrome]);
      } else if (event.event === 'error') {
        h.postMain(r, () => {
          if (state.destroyed || event.loadId !== state.loadId) return;
          state.loading = false; state.progress = 100;
          h.clientCall(r, state, 'onReceivedError', ['Landroid/webkit/WebView;', 'Landroid/webkit/WebResourceRequest;', 'Landroid/webkit/WebResourceError;'], 'V', [self, h.requestObject(r, url), h.errorObject(r, event.code, event.description)]);
          h.chromeCall(r, state, 'onProgressChanged', ['Landroid/webkit/WebView;', 'I'], 'V', [self, 100]);
          h.clientCall(r, state, 'onPageFinished', ['Landroid/webkit/WebView;', 'Ljava/lang/String;'], 'V', [self, url]);
          platform.requestDraw?.(r, self);
        }, [self, state.client, state.chrome]);
      }
      platform.onExternalActivity?.();
    },
  };
  return backend;
}
