import { APKError } from './apk-error.js?v=5553a52fdbbb';
import { networkOf } from './network-native.js?v=5553a52fdbbb';
import { WEBVIEW_ERRORS, ERROR_PAGE_TITLE } from './webview-host.js?v=5553a52fdbbb';
import { buildCsp } from './webview-bridge.js?v=5553a52fdbbb';
import { assetEntry, mimeForPath, toBase64, ASSET_PREFIX } from './webview-resources.js?v=5553a52fdbbb';

// The Worker's side of the WebView backend (design: docs/APK-REAL-TASKS.md, task 33). A "page" owns the documents: the lab page with one sandboxed iframe per WebView (src/webview-frame.js),
// or the document engine without a browser (src/webview-headless.js, used by the Node flows). This module decides what may be loaded, tells the page what to show (`post`), and
// turns the page's events (`handleEvent`) into the callbacks Android delivers, on the VM main thread, in the order the Android reference device produced them
// (scripts/validation/flows/webview-probe.mjs):
//
//   a load that succeeds   onProgressChanged(10)*, onLoadResource, [the document is parsed] onPageStarted, doUpdateVisitedHistory, onPageCommitVisible, onReceivedTitle,
//                          onProgressChanged(100) twice, onPageFinished
//   a load that fails      onProgressChanged(10)*, onPageStarted, onReceivedError, onPageFinished, onReceivedTitle("Webpage not available"), onProgressChanged(100) twice
//   * only when the WebView was not already loading: a navigation that replaces a document still loading announces no new 10 %, and the replaced document gets no onPageFinished.
//
// A document is "scriptable" when the lab hands its text to the frame itself (loadData, loadDataWithBaseURL, about:blank, assets, documents of the lab's own origin, the app's own
// answer to shouldInterceptRequest): it gets the page bridge (src/webview-bridge.js). A document of another origin is opaque: the browser lets nobody script or intercept it, and
// everything that would need to fails in one explicit way (`opaque` below).

/** Directory of the lab origin a WebView may load from: documents the lab serves for that purpose. Every other lab path is refused (the WebView must not frame the lab itself). */
export const LAB_WEBVIEW_PATH = '/webview/';
const SCHEMES = new Set(['http:', 'https:']);
const WEBVIEW = 'Landroid/webkit/WebView;', STRING = 'Ljava/lang/String;', REQUEST = 'Landroid/webkit/WebResourceRequest;', CALLBACK = 'Landroid/webkit/ValueCallback;', OBJECT = 'Ljava/lang/Object;',
  RESPONSE = 'Landroid/webkit/WebResourceResponse;', URI = 'Landroid/net/Uri;';
const CONSOLE_LEVEL = { log: 'LOG', info: 'LOG', warn: 'WARNING', error: 'ERROR', debug: 'DEBUG' }, LOG_PRIORITY = { LOG: 'I', WARNING: 'W', ERROR: 'E', DEBUG: 'D', TIP: 'I' };
const BLANK_DOCUMENT = '<html><head></head><body></body></html>';
const escapeHtml = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** The document a WebView shows for a main-frame load that failed (Chromium's error page says the same three things: the title, the URL, the net error). */
export const errorDocument = (url, description) => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>${ERROR_PAGE_TITLE}</title><style>body{font-family:sans-serif;margin:24px 16px;color:#202124}h1{font-size:1.4em;font-weight:500}p{color:#5f6368;overflow-wrap:anywhere}</style></head><body><h1>${ERROR_PAGE_TITLE}</h1><p>The webpage at <b>${escapeHtml(url)}</b> could not be loaded because:</p><p>${escapeHtml(String(description).split(' ')[0])}</p></body></html>`;

/** The decision for a main-frame navigation to `text`: { ok: true, url } or { ok: false, code, description } with Android's error codes and Chromium's net error names. */
export function decideNavigation(text, { labOrigin = '', online = true, allowed = () => false, blockNetworkLoads = false } = {}) {
  let url;
  try { url = new URL(text, labOrigin || undefined); } catch { return { ok: false, code: WEBVIEW_ERRORS.BAD_URL, description: 'net::ERR_INVALID_URL' }; }
  if (url.protocol === 'about:') return url.href === 'about:blank' ? { ok: true, url: url.href, blank: true } : { ok: false, code: WEBVIEW_ERRORS.BAD_URL, description: 'net::ERR_INVALID_URL' };
  if (url.protocol === 'data:') return { ok: true, url: url.href };
  if (url.protocol === 'file:') {
    // The reference device reports ERROR_UNKNOWN (-1) for both: an asset that does not exist and a file outside the assets (file access is off since targetSdk 30)
    if (url.href.startsWith(ASSET_PREFIX)) return assetEntry(url.href) ? { ok: true, url: url.href, asset: true } : { ok: false, code: WEBVIEW_ERRORS.UNKNOWN, description: 'net::ERR_FILE_NOT_FOUND' };
    return { ok: false, code: WEBVIEW_ERRORS.UNKNOWN, description: 'net::ERR_ACCESS_DENIED (only file:///android_asset/ is served: the lab has no other files to show a WebView)' };
  }
  if (!SCHEMES.has(url.protocol)) return { ok: false, code: WEBVIEW_ERRORS.UNSUPPORTED_SCHEME, description: `net::ERR_UNKNOWN_URL_SCHEME (${url.protocol})` };
  if (labOrigin && url.origin === labOrigin) {
    return url.pathname.startsWith(LAB_WEBVIEW_PATH) ? { ok: true, url: url.href }
      : { ok: false, code: WEBVIEW_ERRORS.UNSAFE_RESOURCE, description: `net::ERR_BLOCKED_BY_CLIENT (a WebView may load only ${LAB_WEBVIEW_PATH} documents from the lab itself)` };
  }
  if (blockNetworkLoads) return { ok: false, code: WEBVIEW_ERRORS.UNKNOWN, description: 'net::ERR_ACCESS_DENIED (WebSettings.setBlockNetworkLoads)' };
  if (!online) return { ok: false, code: WEBVIEW_ERRORS.CONNECT, description: 'net::ERR_INTERNET_DISCONNECTED', refusal: 'offline' };
  if (!allowed(url.hostname, url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80)) {
    return { ok: false, code: WEBVIEW_ERRORS.HOST_LOOKUP, description: `net::ERR_NAME_NOT_RESOLVED (${url.hostname} is not in the allowed hosts of the virtual device)`, refusal: 'allowlist' };
  }
  return { ok: true, url: url.href };
}

/** The title Chromium gives a document that sets none: its URL as it is displayed (the http scheme is left out, a file is its name). */
export function displayTitle(url) {
  const text = String(url ?? '');
  if (/^http:\/\//i.test(text)) return text.slice(7).replace(/^([^/?#]+)\/$/, '$1');
  if (/^file:/i.test(text)) { const name = text.split(/[?#]/)[0].split('/').filter(Boolean).pop(); return name ? decodeURIComponent(name) : text; }
  return text;
}
/** The origin DOM storage and cookies of a document belong to: scheme://host[:port], "file://" for a file, null for a document with no origin of its own (data:, about:blank). */
export function storageOrigin(url) {
  try { const parsed = new URL(url); if (parsed.protocol === 'file:') return 'file://'; return SCHEMES.has(parsed.protocol) ? parsed.origin : null; } catch { return null; }
}

const isHtml = mime => /^(text\/html|application\/xhtml\+xml)$/i.test(String(mime ?? '').split(';')[0].trim());
const isNull = v => v === null || v === undefined || v === 0;
const STORAGE_LIMIT = 5 * 1024 * 1024;

/** `post(message)` sends a message to the page; `labOrigin` is the page origin (empty when there is none, e.g. tests). */
export function createWebViewBackend({ platform, post, labOrigin = '', timeoutMs = 30000 }) {
  const views = new Map();   // WebView id -> { self }
  const host = () => platform.webView.internals;
  const note = (r, key, line) => { const notes = platform.webViewNotes ??= new Set(); if (!notes.has(key)) { notes.add(key); r.record(line); } };
  const strict = r => r.tolerateMissing === 'off' || r.tolerateMissing === undefined;
  const valuesOf = (r, self) => r.object(host().settingsOf(r, self)).values;
  const policyFor = (r, state) => {
    const network = networkOf(r), settings = state.settings ? r.object(state.settings).values : null;
    return { labOrigin, online: network.online, allowed: (hostname, port) => network.allowed(hostname, port), blockNetworkLoads: !!settings?.get('BlockNetworkLoads') };
  };
  const serial = request => ({ kind: request.kind, url: request.url, baseUrl: request.baseUrl ?? null, data: request.data ?? null, mime: request.mime ?? null, encoding: request.encoding ?? null,
    body: request.body ? Array.from(request.body) : null, headers: Object.fromEntries(request.headers ?? []) });
  /** Will the lab hand this load's text to the frame itself (so the page bridge can be put in front of it)? Loads of other origins are opaque. */
  const scriptable = request => {
    if (request.kind === 'data' || request.kind === 'dataBase') return isHtml(request.mime);
    if (request.kind === 'url' && request.url.startsWith(ASSET_PREFIX)) return true;   // an asset the lab reads out of the APK itself
    if (request.kind === 'url' && labOrigin) { try { return new URL(request.url).origin === labOrigin; } catch { return false; } }
    return false;
  };
  /** The document a main-frame load shows when the lab, not the browser, produced its bytes (an asset, or the app's own answer to shouldInterceptRequest). */
  const documentOf = (url, mime, bytes, encoding) => {
    if (isHtml(mime)) {
      let text; try { text = new TextDecoder(encoding || 'utf-8').decode(bytes); } catch { text = new TextDecoder().decode(bytes); }
      return { kind: 'dataBase', url, displayUrl: url, baseUrl: url, data: text, mime: 'text/html', encoding: null, headers: new Map() };
    }
    return { kind: 'data', url, displayUrl: url, baseUrl: null, data: toBase64(bytes), mime: mime || mimeForPath(url), encoding: 'base64', headers: new Map() };
  };
  const profile = () => { const p = platform.webProfile ??= { origins: new Map(), httpAuth: new Map() }; p.storage ??= new Map(); return p; };
  const cookieManager = r => host().staticCall(r, 'Landroid/webkit/CookieManager;', 'getInstance', [], 'Landroid/webkit/CookieManager;', []);
  /** What the document's own URL is for cookies, storage and relative references. */
  const documentUrl = request => (request.baseUrl && request.baseUrl !== 'about:blank' ? request.baseUrl : request.kind === 'url' || request.kind === 'post' ? request.url : '');
  const bridgeFor = (r, self, state, request, javascript) => {
    const h = host(), values = valuesOf(r, self);
    const network = networkOf(r), base = documentUrl(request), origin = storageOrigin(base);
    let cookies = null;
    if (origin && origin !== 'file://') {
      const manager = cookieManager(r), accept = !!h.call(r, manager, 'Landroid/webkit/CookieManager;', 'acceptCookie', [], 'Z', []);
      const value = h.call(r, manager, 'Landroid/webkit/CookieManager;', 'getCookie', [STRING], STRING, [base]);
      cookies = { accept, value: isNull(value) ? '' : typeof value === 'string' ? value : r.stringCharacters(value) };
    }
    const session = state.sessionStorage ??= new Map();
    const storage = origin && values.get('DomStorageEnabled') ? { local: Object.fromEntries(profile().storage.get(origin) ?? []), session: Object.fromEntries(session.get(origin) ?? []) } : null;
    return {
      csp: buildCsp({
        allowedHosts: network.online ? network.policy.allowedHosts ?? [] : [], labOrigin, labPath: LAB_WEBVIEW_PATH, javascript, blockNetworkLoads: !!values.get('BlockNetworkLoads'),
        blockNetworkImage: !!values.get('BlockNetworkImage'), loadsImages: !!values.get('LoadsImagesAutomatically'), mixedContentMode: values.get('MixedContentMode') ?? 1, pageIsHttps: !base || /^https:/i.test(base) || request.kind === 'url',
      }),
      config: { userAgent: values.get('UserAgentString'), domStorage: !!values.get('DomStorageEnabled'), textZoom: values.get('TextZoom') ?? 100, interfaces: javascript ? h.interfaceDescriptors(r, state) : {},
        resolve: state.bridge.resolve ? { base: state.bridge.resolve.base } : null, storage, cookies },
    };
  };
  const newBridge = (loadId, fields) => ({ loadId, scriptable: false, ready: false, pending: [], evals: new Map(), nextEval: 1, resolve: null, resources: 0, silent: false, committed: false, url: null, origin: null, asks: new Map(), ...fields });
  const viewport = (r, self) => { const values = valuesOf(r, self); return { wide: !!values.get('UseWideViewPort'), overview: !!values.get('LoadWithOverviewMode'), zoom: !!values.get('SupportZoom') && !!values.get('BuiltInZoomControls') }; };
  /** Hands `final` to the page as the document of the current load of this WebView. */
  const show = (r, self, state, final) => {
    const bridge = state.bridge, values = valuesOf(r, self), javascript = !!values.get('JavaScriptEnabled');
    bridge.scriptable = scriptable(final); bridge.javascript = javascript; bridge.documentUrl = documentUrl(final); bridge.origin = storageOrigin(bridge.documentUrl);
    views.set(state.id, { self, state });
    post({ type: 'webview', op: 'load', id: state.id, loadId: bridge.loadId, request: serial(final), javascript, timeoutMs, userAgent: values.get('UserAgentString'), viewport: viewport(r, self),
      resolve: bridge.resolve, bridge: bridge.scriptable ? bridgeFor(r, self, state, final, javascript) : null });
  };
  /** A fresh WebView is on about:blank, a real document scripts can run in: it is created the first time something needs it, and announces nothing (no load was asked for). */
  const ensureDocument = (r, self, state) => {
    const javascript = !!valuesOf(r, self).get('JavaScriptEnabled');
    if (state.bridge && !(state.bridge.blank && state.bridge.javascript !== javascript)) return state.bridge;
    const loadId = state.bridge ? state.bridge.loadId : ++state.loadId;
    if (state.bridge) backend.failPending(r, self, state);
    state.bridge = newBridge(loadId, { silent: true, blank: true });
    show(r, self, state, { kind: 'dataBase', url: 'about:blank', baseUrl: 'about:blank', data: BLANK_DOCUMENT, mime: 'text/html', encoding: null, headers: new Map() });
    return state.bridge;
  };
  const progress = (r, self, state, value) => { state.progress = value; host().chromeCall(r, state, 'onProgressChanged', [WEBVIEW, 'I'], 'V', [self, value]); };
  /** The document of the current load is the WebView's page from here on: onPageStarted, the visited history, the first paint, its title. */
  const commit = (r, self, state, title) => {
    const bridge = state.bridge, h = host(); if (!bridge || bridge.committed || bridge.silent) return;
    bridge.committed = true;
    h.clientCall(r, state, 'onPageStarted', [WEBVIEW, STRING, 'Landroid/graphics/Bitmap;'], 'V', [self, bridge.url, null]);
    h.clientCall(r, state, 'doUpdateVisitedHistory', [WEBVIEW, STRING, 'Z'], 'V', [self, bridge.url, bridge.reload ? 1 : 0]);
    h.clientCall(r, state, 'onPageCommitVisible', [WEBVIEW, STRING], 'V', [self, bridge.url]);
    backend.title(r, self, state, title || displayTitle(state.url), true);
  };
  const finish = (r, self, state) => {
    const bridge = state.bridge, h = host(); if (!bridge || bridge.silent || bridge.finished) return;
    commit(r, self, state, ''); bridge.finished = true;
    progress(r, self, state, 100); progress(r, self, state, 100);
    state.loading = false;
    h.clientCall(r, state, 'onPageFinished', [WEBVIEW, STRING], 'V', [self, bridge.url]);
    platform.requestDraw?.(r, self);
  };
  /** A main-frame load that failed: Android's callbacks (host.failLoad), and the error page as the WebView's document. */
  const fail = (r, self, state, url, code, description, { started = false, shown = url } = {}) => {
    backend.failPending(r, self, state);
    const h = host(); h.failLoad(r, self, state, url, code, description, { started, shown });
    state.bridge = newBridge(state.loadId, { silent: true, url });
    show(r, self, state, { kind: 'dataBase', url, baseUrl: 'about:blank', data: errorDocument(url, description), mime: 'text/html', encoding: null, headers: new Map() });
  };
  /** One explicit way for everything the lab cannot do to a document of another origin: strict mode stops with the named error, the tolerant modes leave a STUB-WEBVIEW line (once per API). */
  const opaque = (r, state, api, what) => {
    const none = !state.bridge?.scriptable && state.bridge?.unscriptable;
    const why = none ?? 'this document is from another origin (loadUrl of a remote page): the browser never lets the lab script or intercept it';
    const message = `android.webkit.WebView.${api}: ${why}${what ? ` (${what})` : ''}`;
    if (strict(r)) throw new APKError(message, { kind: 'webview-cross-origin-script', method: api });
    note(r, `opaque:${api}`, `STUB-WEBVIEW ${api} (${message})`);
  };
  const toBridge = (state, payload) => post({ type: 'webview', op: 'bridge', id: state.id, loadId: state.bridge.loadId, payload: { t: 'call', ...payload } });

  const backend = {
    capabilities: Object.freeze({ frame: true, bridge: true }),
    /** Start a main-frame load (loadUrl, loadData, loadDataWithBaseURL, postUrl, reload, back/forward): refuse it with Android's error, or ask the page to load it. */
    load(r, self, state, request) {
      const h = host(), display = request.displayUrl ?? request.url;
      if (/^javascript:/i.test(request.url ?? '')) { let code = request.url.slice(11); try { code = decodeURIComponent(code); } catch { /* not escaped */ } backend.evaluate(r, self, state, code, null); return; }
      views.set(state.id, { self, state });
      const keep = request.history === 'keep' || !!request.reload;
      /** History: a new entry for a new navigation (also one that fails: the error page is a page), none for reload and back/forward. */
      const record = (shown, original) => { if (!keep) h.pushHistory(state, { url: shown, originalUrl: original ?? shown, title: null, request: { ...request, history: undefined, reload: undefined } }); };
      if (request.kind === 'url' || request.kind === 'post') {
        const decision = decideNavigation(request.url, policyFor(r, state));
        if (!decision.ok) {
          if (decision.refusal) networkOf(r).logRefusal({ api: 'WebView', method: request.kind === 'post' ? 'POST' : 'GET', url: request.url, host: new URL(request.url, labOrigin || undefined).hostname });
          record(display); fail(r, self, state, display, decision.code, decision.description); return;
        }
        request = { ...request, url: decision.url }; if (request.displayUrl === undefined) request.displayUrl = decision.url;
        if (decision.blank) request = { ...request, kind: 'dataBase', baseUrl: 'about:blank', data: BLANK_DOCUMENT, mime: 'text/html', encoding: null, callbackUrl: 'about:blank' };
      } else if (request.kind === 'dataBase' && request.baseUrl !== 'about:blank') {
        try { new URL(request.baseUrl); }   // the base only has to be an absolute URL: nothing is fetched from it
        catch { record(request.baseUrl); fail(r, self, state, request.baseUrl, WEBVIEW_ERRORS.BAD_URL, 'net::ERR_INVALID_URL'); return; }
      }
      // `shown` is what getUrl() answers; `announced` is the URL of the callbacks (they differ for loadDataWithBaseURL: the history URL, and the base URL)
      const shown = request.displayUrl ?? request.url, announced = request.callbackUrl ?? shown, loadId = ++state.loadId, wasLoading = state.loading;
      backend.failPending(r, self, state);   // evaluations queued for the document that is being replaced have no document to run in
      state.loading = true; state.url = shown; state.originalUrl = keep ? state.originalUrl ?? shown : shown; state.title = ''; state.contentHeight = 0; state.scroll = { x: 0, y: 0 };
      state.bridge = newBridge(loadId, { scriptable: scriptable(request), url: announced, reload: !!request.reload });
      record(shown, shown);
      const isAsset = request.kind === 'url' && request.url.startsWith(ASSET_PREFIX), lab = state.bridge.scriptable, intercepts = h.overridesIntercept(r, state);
      h.postMain(r, () => {
        if (state.destroyed || loadId !== state.loadId) return;
        if (!wasLoading) progress(r, self, state, 10); else state.progress = 10;
        h.clientCall(r, state, 'onLoadResource', [WEBVIEW, STRING], 'V', [self, announced]);
        // a document the lab cannot look into is committed as soon as it is asked for: nothing later can be observed but its load event
        if (!state.bridge.scriptable) { commit(r, self, state, ''); if (request.kind === 'url' || request.kind === 'post') note(r, 'opaque:title', 'STUB-WEBVIEW getTitle (a document of another origin cannot be read: its title is reported as its URL, and onReceivedTitle carries that)'); }
      }, [self, state.client, state.chrome]);
      if (request.kind === 'url' && !lab && intercepts) note(r, 'intercept:opaque', 'STUB-WEBVIEW shouldInterceptRequest (this page is from another origin: the browser loads it itself, so the app is not asked about it or its sub-resources; only documents the lab serves are intercepted)');
      const dispatch = final => {
        const bridge = state.bridge; if (bridge.loadId !== loadId) return;
        bridge.scriptable = scriptable(final);
        if (bridge.scriptable && (isAsset || intercepts || final.kind === 'dataBase' && final.baseUrl?.startsWith(ASSET_PREFIX))) bridge.resolve = { base: final.baseUrl && final.baseUrl !== 'about:blank' ? final.baseUrl : final.url };
        show(r, self, state, final);
      };
      if (!isAsset && !(lab && intercepts && request.kind === 'url')) { dispatch(request); return; }
      // The lab produces this main document itself, after the callbacks already queued (Android answers shouldInterceptRequest off the UI thread, later than loadUrl returns).
      h.postMain(r, () => {
        if (state.destroyed || loadId !== state.loadId) return;
        const answered = intercepts ? h.intercept(r, self, state, { url: request.url, method: 'GET', headers: request.headers ?? new Map(), mainFrame: true }) : null;
        if (answered?.failed) { fail(r, self, state, shown, WEBVIEW_ERRORS.IO, `net::ERR_FAILED (${answered.failed})`, { started: state.bridge.committed }); return; }
        if (answered) { if (answered.status >= 400) backend.httpError(r, self, state, request.url, true, answered); dispatch(documentOf(request.url, answered.mime, answered.bytes, answered.encoding)); return; }
        if (!isAsset) { dispatch(request); return; }
        const entry = assetEntry(request.url);
        if (!entry || !r.apkEntries.has(entry)) { fail(r, self, state, shown, WEBVIEW_ERRORS.UNKNOWN, 'net::ERR_FILE_NOT_FOUND', { started: state.bridge.committed }); return; }
        dispatch(documentOf(request.url, mimeForPath(entry), Uint8Array.from(r.apkReader(entry)), null));
      }, [self, state.client, state.chrome]);
    },
    stop(r, self, state) { post({ type: 'webview', op: 'stop', id: state.id }); backend.failPending(r, self, state); if (state.bridge) state.bridge.silent = true; },
    destroy(r, self, state) { post({ type: 'webview', op: 'destroy', id: state.id }); views.delete(state.id); },
    interfaceChanged() { /* an interface added or removed takes effect at the next load, as on Android */ },
    settingChanged() { /* applied at the next load: the sandbox, the policy and the bridge configuration of a document are fixed when it is created */ },
    deliver(r, self, state, callback, value) {
      if (isNull(callback)) return;
      const h = host();
      h.postMain(r, () => h.call(r, callback, CALLBACK, 'onReceiveValue', [OBJECT], 'V', [value]), [callback, self]);
    },
    /**
     * evaluateJavascript / loadUrl("javascript:..."). The script runs in the WebView's document (about:blank before any load) and the callback receives the JSON-encoded result:
     * "null" when the script throws or JavaScript is disabled, as Android answers. A document of another origin can never be scripted: `opaque`, and the callback gets "null".
     */
    evaluate(r, self, state, script, callback) {
      const javascript = !!valuesOf(r, self).get('JavaScriptEnabled');
      if (!javascript) { backend.deliver(r, self, state, callback, 'null'); return; }
      const bridge = ensureDocument(r, self, state);
      if (bridge.scriptable) {
        if (bridge.ready) backend.sendEval(r, self, state, script, callback); else bridge.pending.push({ script, callback });
        return;
      }
      opaque(r, state, 'evaluateJavascript');
      backend.deliver(r, self, state, callback, 'null');
    },
    sendEval(r, self, state, script, callback) {
      const bridge = state.bridge, evalId = bridge.nextEval++;
      if (bridge.evals.size >= 256) { backend.deliver(r, self, state, callback, 'null'); return; }
      bridge.evals.set(evalId, callback);
      post({ type: 'webview', op: 'eval', id: state.id, loadId: bridge.loadId, evalId, script });
    },
    /** A command for the bridge of the current document (scroll, find, a web message); false when the document cannot take it. */
    command(r, self, state, api, payload, { create = false } = {}) {
      const bridge = create ? ensureDocument(r, self, state) : state.bridge;
      if (!bridge) return false;
      if (!bridge.scriptable) { opaque(r, state, api); return false; }
      if (!bridge.javascript) return false;
      toBridge(state, payload); return true;
    },

    /** An event from the page about WebView `event.id` (called outside the VM: everything that touches Java is queued onto the main thread). */
    handleEvent(r, event) {
      const entry = views.get(event.id); if (!entry) return;
      const h = host(), state = h.stateOf(r, entry.self), self = entry.self;
      if (state.destroyed || event.loadId !== state.loadId) return;   // a stale load: the app already started another one
      const bridge = state.bridge, url = bridge?.url ?? state.url, roots = [self, state.client, state.chrome];
      const queue = task => h.postMain(r, () => { if (!state.destroyed && event.loadId === state.loadId && state.bridge === bridge) task(); }, roots);
      const reply = fields => toBridge(state, { name: 'answer', aid: event.aid, ...fields });
      switch (event.event) {
        case 'dom': queue(() => commit(r, self, state, event.title)); break;
        case 'finished': queue(() => finish(r, self, state)); break;
        case 'error':
          queue(() => { if (bridge.silent) return; fail(r, self, state, url, event.code, event.description, { started: bridge.committed, shown: state.url }); });
          break;
        case 'http-error': queue(() => { if (!bridge.silent) backend.httpError(r, self, state, url, true, { status: event.status | 0, reason: String(event.reason ?? ''), mime: String(event.mime ?? 'text/html'), encoding: null }); }); break;
        case 'bridge-failed':   // the document loaded and, after a grace period, its bridge never connected (scripts blocked or removed): not scriptable after all
          queue(() => { if (bridge.scriptable && !bridge.ready) { bridge.scriptable = false; bridge.unscriptable = 'the bridge of this document never connected (its scripts are blocked or it replaced itself)'; backend.failPending(r, self, state); } });
          break;
        case 'bridge-ready':
          queue(() => {
            if (bridge.ready) return;
            bridge.ready = true;
            const pending = bridge.pending; bridge.pending = [];
            for (const item of pending) backend.sendEval(r, self, state, item.script, item.callback);
          });
          break;
        case 'eval-result':
          queue(() => {
            const callback = bridge.evals.get(event.evalId); if (callback === undefined) return;
            bridge.evals.delete(event.evalId);
            if (event.needsBrowser) {   // the document engine without a browser ran into something only a browser has
              const message = `android.webkit.WebView.evaluateJavascript: this host has no browser, and its document engine cannot run this script (${event.needsBrowser})`;
              if (strict(r)) throw new APKError(message, { kind: 'webview-unavailable', method: 'evaluateJavascript' });
              note(r, 'headless:eval', `STUB-WEBVIEW evaluateJavascript (${message})`);
            }
            backend.deliver(r, self, state, callback, event.ok ? event.json : 'null');
          });
          break;
        case 'title': queue(() => { if (!bridge.silent && bridge.committed) backend.title(r, self, state, event.title || displayTitle(state.url)); }); break;
        case 'metrics': queue(() => { state.scroll = { x: event.x | 0, y: event.y | 0 }; state.contentHeight = event.height | 0; state.contentWidth = event.width | 0; state.viewHeight = event.viewHeight | 0; }); break;
        case 'console':
          queue(() => {
            const level = CONSOLE_LEVEL[event.level] ?? 'LOG', message = h.consoleMessage(r, event.text, event.source ?? url ?? '', event.line | 0, level);
            const handled = h.chromeCall(r, state, 'onConsoleMessage', ['Landroid/webkit/ConsoleMessage;'], 'Z', [message]);
            if (!handled) r.record(`LOG ${LOG_PRIORITY[level]} chromium: [${level === 'LOG' ? 'INFO' : level}:CONSOLE(${event.line | 0})] "${event.text}", source: ${event.source ?? url} (${event.line | 0})`);
          });
          break;
        case 'dialog':
          queue(() => {
            // The page does not wait (a sandboxed frame has no modal dialogs and the lab has no synchronous channel into the VM): alert() returned, confirm() answered false and
            // prompt() null before the app is asked. The app is asked all the same, with a JsResult it can settle; what it answers cannot reach the page any more.
            const prompt = event.kind === 'prompt', result = h.jsResult(r, prompt), name = event.kind === 'alert' ? 'onJsAlert' : event.kind === 'confirm' ? 'onJsConfirm' : 'onJsPrompt';
            const handled = prompt ? h.chromeCall(r, state, name, [WEBVIEW, STRING, STRING, STRING, 'Landroid/webkit/JsPromptResult;'], 'Z', [self, state.url, event.text, event.value ?? null, result])
              : h.chromeCall(r, state, name, [WEBVIEW, STRING, STRING, 'Landroid/webkit/JsResult;'], 'Z', [self, state.url, event.text, result]);
            if (!handled) r.record(`LOG I chromium: [${event.kind}] ${event.text}`);   // Android would show its own dialog here; the lab shows the text in the log
            if (event.kind !== 'alert') note(r, 'dialog:' + event.kind, `STUB-WEBVIEW ${name} (window.${event.kind}() cannot block the page until the app answers: the page already got ${event.kind === 'confirm' ? 'false' : 'null'}; the app's answer is not delivered)`);
          });
          break;
        case 'popup': queue(() => backend.popup(r, self, state, event)); break;
        case 'js':
          queue(() => {
            const object = state.interfaces.get(event.name); if (object === undefined || !Array.isArray(event.args)) return;
            const outcome = h.invokeInterface(r, object, String(event.method), event.args);
            if (!outcome.called) r.record(`LOG W chromium: [WARNING:CONSOLE(0)] "Uncaught TypeError: ${event.name}.${event.method} is not a function (no @JavascriptInterface method with ${event.args.length} argument(s))"`);
            else if (outcome.error) r.record(`LOG E chromium: ${event.name}.${event.method} threw ${outcome.error.slice(1, -1).replaceAll('/', '.')}`);
            else if (outcome.result !== 'V') note(r, `return:${event.name}.${event.method}`, `STUB-WEBVIEW addJavascriptInterface (${event.name}.${event.method} returns a value: a sandboxed frame has no synchronous channel into the VM, so the page received undefined)`);
          });
          break;
        case 'navigate': queue(() => backend.navigation(r, self, state, event)); break;
        case 'resource': queue(() => backend.resource(r, self, state, event)); break;
        case 'cookie': queue(() => { const base = bridge.origin && bridge.origin !== 'file://' ? bridge.documentUrl : null; if (base) h.call(r, cookieManager(r), 'Landroid/webkit/CookieManager;', 'setCookie', [STRING, STRING], 'V', [base, String(event.value)]); }); break;
        case 'storage':
          queue(() => {
            if (!bridge.origin || !valuesOf(r, self).get('DomStorageEnabled')) return;
            const areas = event.area === 'session' ? (state.sessionStorage ??= new Map()) : profile().storage, area = areas.get(bridge.origin) ?? areas.set(bridge.origin, new Map()).get(bridge.origin);
            if (event.op === 'clear') area.clear(); else if (event.op === 'remove') area.delete(String(event.key));
            else if (event.op === 'set') { let size = 0; for (const [k, v] of area) size += k.length + v.length; if (size + String(event.key).length + String(event.value).length <= STORAGE_LIMIT) area.set(String(event.key), String(event.value)); }
          });
          break;
        case 'download': queue(() => backend.download(r, self, state, event)); break;
        case 'find': queue(() => { const listener = state.findListener; if (!isNull(listener)) h.call(r, listener, 'Landroid/webkit/WebView$FindListener;', 'onFindResultReceived', ['I', 'I', 'Z'], 'V', [event.active | 0, event.count | 0, 1]); }); break;
        case 'geolocation': queue(() => h.geolocationPrompt(r, self, state, bridge.origin ?? state.url ?? '', (allowed) => { const s = platform.locationSimulation; reply({ allowed, position: allowed && s?.enabled ? { latitude: s.latitude, longitude: s.longitude, accuracy: s.accuracy ?? 5 } : null }); })); break;
        case 'permission':
          queue(() => h.permissionRequest(r, self, state, bridge.origin ?? state.url ?? '', Array.isArray(event.resources) ? event.resources : [], granted => {
            if (granted) note(r, 'permission:granted', 'STUB-WEBVIEW onPermissionRequest (the app granted the camera or microphone to the page, but a sandboxed frame cannot be handed a media stream of the lab: getUserMedia fails with NotReadableError)');
            reply({ granted });
          }));
          break;
        case 'chooser': queue(() => h.fileChooser(r, self, state, { accept: String(event.accept ?? ''), multiple: !!event.multiple, capture: !!event.capture }, files => reply({ files }))); break;
        default: break;
      }
      platform.onExternalActivity?.();
    },
    /** onReceivedHttpError: a response of 400 or more for the main document or a sub-resource the lab answers itself. */
    httpError(r, self, state, url, mainFrame, { status, reason, mime, encoding }) {
      const h = host(), response = r.allocate(RESPONSE);
      r.dispatch({ owner: RESPONSE, name: '<init>', parameters: [STRING, STRING, 'Ljava/io/InputStream;'], result: 'V', signature: `(${STRING}${STRING}Ljava/io/InputStream;)V` }, [response, mime ?? null, encoding ?? null, null], 'direct');
      Object.assign(r.object(response), { status, reason: reason || 'Error' });
      h.clientCall(r, state, 'onReceivedHttpError', [WEBVIEW, REQUEST, RESPONSE], 'V', [self, h.requestObject(r, url, { mainFrame }), response]);
    },
    /**
     * A sub-resource request of a document the lab serves (static references before the frame exists, fetch/XHR/elements afterwards): the app's shouldInterceptRequest answers it, else
     * an android_asset URL is read out of the APK, else nobody intercepted it (the page then lets the browser do it, under the document's CSP). Replies with op 'resource-result'.
     */
    resource(r, self, state, event) {
      const bridge = state.bridge, reply = fields => post({ type: 'webview', op: 'resource-result', id: state.id, loadId: event.loadId, rid: event.rid, ...fields });
      if (!bridge?.resolve || typeof event.url !== 'string' || event.url.length > 8192 || !['GET', 'POST', 'HEAD'].includes(event.method)) { reply({ failed: 'this document does not resolve sub-resources' }); return; }
      if (++bridge.resources > 2000) { reply({ failed: 'too many sub-resource requests for one document' }); return; }
      const h = host();
      h.clientCall(r, state, 'onLoadResource', [WEBVIEW, STRING], 'V', [self, event.url]);
      const answered = h.intercept(r, self, state, { url: event.url, method: event.method, mainFrame: false });
      if (answered?.failed) { reply({ failed: answered.failed }); return; }
      if (answered) { if (answered.status >= 400) backend.httpError(r, self, state, event.url, false, answered); reply({ status: answered.status, reason: answered.reason, mime: answered.mime, encoding: answered.encoding, bytes: answered.bytes }); return; }
      const entry = assetEntry(event.url);
      if (entry) {
        if (!r.apkEntries.has(entry)) { reply({ status: 404, reason: 'Not Found', mime: 'text/plain', encoding: null, bytes: new Uint8Array(0) }); return; }
        reply({ status: 200, reason: 'OK', mime: mimeForPath(entry), encoding: null, bytes: Uint8Array.from(r.apkReader(entry)) }); return;
      }
      reply({ passthrough: true });
    },
    /** onReceivedTitle and getTitle(), also on the current history entry. `force`: the first title of a document is reported even when it equals the previous page's. */
    title(r, self, state, title, force = false) {
      if (!force && state.title === String(title)) return;
      state.title = String(title); const entry = state.history[state.index]; if (entry) entry.title = state.title;
      host().chromeCall(r, state, 'onReceivedTitle', [WEBVIEW, STRING], 'V', [self, state.title]);
    },
    /** Evaluations that will never run (the document went away or never became scriptable) get "null", as Android answers a script that cannot run. */
    failPending(r, self, state) {
      const bridge = state.bridge; if (!bridge) return;
      for (const item of bridge.pending.splice(0)) backend.deliver(r, self, state, item.callback, 'null');
      for (const [id, callback] of [...bridge.evals]) { bridge.evals.delete(id); backend.deliver(r, self, state, callback, 'null'); }
    },
    /**
     * A navigation the document started: the app's shouldOverrideUrlLoading decides (it is asked before the callbacks of a document that is still loading are delivered, as on the
     * reference device); if it does not take it over, it becomes a load of this WebView (policy, history and callbacks as any load).
     */
    navigation(r, self, state, event) {
      const h = host(), post_ = event.method === 'POST', request = h.requestObject(r, event.url, { gesture: !!event.gesture, method: post_ ? 'POST' : 'GET', redirect: !!event.redirect });
      const overridden = h.clientCall(r, state, 'shouldOverrideUrlLoading', [WEBVIEW, REQUEST], 'Z', [self, request]);
      commit(r, self, state, event.title ?? '');
      if (overridden) return;
      if (post_) backend.load(r, self, state, { kind: 'post', url: event.url, body: new TextEncoder().encode(event.body ?? ''), headers: new Map() });
      else backend.load(r, self, state, { kind: 'url', url: event.url, headers: new Map() });
    },
    /**
     * window.open(). Without WebSettings.setSupportMultipleWindows the new document replaces this one (Android loads it in the same WebView). With it, Android asks
     * WebChromeClient.onCreateWindow for a second WebView: the lab has no window to hand back to the script (window.open already returned null), so that is refused by name.
     */
    popup(r, self, state, event) {
      const values = valuesOf(r, self);
      if (!event.gesture && !values.get('JavaScriptCanOpenWindowsAutomatically')) { r.record(`LOG I chromium: [INFO:CONSOLE(0)] "Blocked window.open(${event.url}): no user gesture and WebSettings.getJavaScriptCanOpenWindowsAutomatically() is false"`); return; }
      if (!values.get('SupportMultipleWindows')) { if (event.url && event.url !== 'about:blank') backend.navigation(r, self, state, { url: event.url, method: 'GET', gesture: !!event.gesture, title: state.title }); return; }
      const message = 'android.webkit.WebChromeClient.onCreateWindow: window.open() with WebSettings.setSupportMultipleWindows(true) needs a second WebView connected to the script that opened it; the lab cannot connect two sandboxed frames, so no window is created and window.open() returned null';
      if (strict(r)) throw new APKError(message, { kind: 'webview-unsupported', method: 'onCreateWindow' });
      note(r, 'popup', `STUB-WEBVIEW onCreateWindow (${message})`);
    },
    /** DownloadListener.onDownloadStart for a link with the download attribute or a lab document that is not a page. Without a listener Android does nothing, and says so in its log. */
    download(r, self, state, event) {
      const h = host(), url = String(event.url ?? ''), mime = String(event.mime || mimeForPath(url.split(/[?#]/)[0]) || 'application/octet-stream');
      const disposition = event.disposition ? String(event.disposition) : event.name ? `attachment; filename="${String(event.name).replace(/"/g, '')}"` : '';
      if (event.main) { state.loading = false; state.progress = 100; if (state.bridge) state.bridge.silent = true; }   // the navigation became a download: no page was committed
      if (isNull(state.downloadListener)) { r.record(`LOG W chromium: [WARNING] No DownloadListener is set on this WebView: the download of ${url} is ignored`); return; }
      h.call(r, state.downloadListener, 'Landroid/webkit/DownloadListener;', 'onDownloadStart', [STRING, STRING, STRING, STRING, 'J'], 'V', [url, valuesOf(r, self).get('UserAgentString'), disposition, mime, BigInt(Number.isSafeInteger(event.length) ? event.length : -1)]);
    },
  };
  return backend;
}
