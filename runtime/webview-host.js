import { gcRoot } from './heap-gc.js?v=79ac9440027a';
import { createHostRegistry, floatBits, doubleBits } from './host-contract.js?v=79ac9440027a';
import { isInterfaceName } from './webview-bridge.js?v=79ac9440027a';
import { APKError } from './apk-error.js?v=79ac9440027a';

// android.webkit.WebView and its public companions for the browser VM (design: docs/APK-REAL-TASKS.md, task 33).
//
// The WebView is a real View of the VM (measure, layout, visibility, background come from the platform's View model; its superclass chain is the declared
// WebView -> AbsoluteLayout -> ViewGroup). Its content is NOT rendered by the VM: the page shows an iframe at the View's bounds (src/device-view.js, kind
// 'webview') and the Worker talks to it through a backend (`platform.webViewBackend`, installed by the Worker when a page is attached). Without a backend (Node probes,
// a Worker without a page) every load fails explicitly: APKError `webview-unavailable`, or, in the tolerant modes, an STUB-WEBVIEW trace line plus the Android callbacks
// a failed load produces (onPageStarted, onReceivedError(ERROR_CONNECT), onPageFinished).
//
// Implemented here: the constructors and the WebView/WebSettings/WebViewClient/WebChromeClient/WebResource*/ConsoleMessage/JsResult surface, WebSettings state with
// Android 13 defaults (gated by targetSdk where Android gates them), the history stack of host-initiated navigations, WebStorage, callbacks posted to the main Looper.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', CONTEXT = 'Landroid/content/Context;', ATTRS = 'Landroid/util/AttributeSet;', BITMAP = 'Landroid/graphics/Bitmap;',
  VIEW = 'Landroid/view/View;', VIEW_GROUP = 'Landroid/view/ViewGroup;', ABSOLUTE = 'Landroid/widget/AbsoluteLayout;', MAP = 'Ljava/util/Map;', INPUT_STREAM = 'Ljava/io/InputStream;', ENUM = 'Ljava/lang/Enum;';
export const WEBVIEW = 'Landroid/webkit/WebView;', SETTINGS = 'Landroid/webkit/WebSettings;', CLIENT = 'Landroid/webkit/WebViewClient;', CHROME = 'Landroid/webkit/WebChromeClient;',
  REQUEST = 'Landroid/webkit/WebResourceRequest;', ERROR = 'Landroid/webkit/WebResourceError;', RESPONSE = 'Landroid/webkit/WebResourceResponse;', CONSOLE = 'Landroid/webkit/ConsoleMessage;',
  LEVEL = 'Landroid/webkit/ConsoleMessage$MessageLevel;', JS_RESULT = 'Landroid/webkit/JsResult;', JS_PROMPT = 'Landroid/webkit/JsPromptResult;', STORAGE = 'Landroid/webkit/WebStorage;',
  CALLBACK = 'Landroid/webkit/ValueCallback;', LIST = 'Landroid/webkit/WebBackForwardList;', ITEM = 'Landroid/webkit/WebHistoryItem;', JS_INTERFACE = 'Landroid/webkit/JavascriptInterface;',
  HIT = 'Landroid/webkit/WebView$HitTestResult;', LAB_REQUEST = 'Llab/webkit/LabResourceRequest;', LAB_ERROR = 'Llab/webkit/LabResourceError;',
  LAB_LIST = 'Llab/webkit/LabBackForwardList;', LAB_ITEM = 'Llab/webkit/LabHistoryItem;', LAB_RESULT = 'Llab/webkit/LabJsResult;';
/** WebViewProviderFactoryBoundaryInterface.getSupportedFeatures(): support-library feature strings this WebView implements. None yet (a listed feature must work). */
export const LAB_PROVIDER_FEATURES = Object.freeze([]);
const isNull = v => v === null || v === undefined || v === 0;
/** The title of Chromium's error page: what onReceivedTitle and getTitle() report after a main-frame load failed. */
export const ERROR_PAGE_TITLE = 'Webpage not available';
/** WebViewClient.ERROR_* (android-13.0.0_r1). */
export const WEBVIEW_ERRORS = Object.freeze({ UNKNOWN: -1, HOST_LOOKUP: -2, UNSUPPORTED_AUTH_SCHEME: -3, AUTHENTICATION: -4, PROXY_AUTHENTICATION: -5, CONNECT: -6, IO: -7, TIMEOUT: -8, REDIRECT_LOOP: -9, UNSUPPORTED_SCHEME: -10, FAILED_SSL_HANDSHAKE: -11, BAD_URL: -12, FILE: -13, FILE_NOT_FOUND: -14, TOO_MANY_REQUESTS: -15, UNSAFE_RESOURCE: -16 });

/** WebSettings accessors: [property, boolean|int|string, default | (ctx) => default]. Defaults are android-13.0.0_r1 (chromium AwSettings / WebSettings docs); `targetSdk` gates the ones Android gates. */
const SETTINGS_TABLE = [
  ['JavaScriptEnabled', 'Z', false], ['DomStorageEnabled', 'Z', false], ['DatabaseEnabled', 'Z', false], ['AppCacheEnabled', 'Z', false],
  ['AllowFileAccess', 'Z', c => c.targetSdk < 30], ['AllowContentAccess', 'Z', true], ['AllowFileAccessFromFileURLs', 'Z', c => c.targetSdk < 16], ['AllowUniversalAccessFromFileURLs', 'Z', c => c.targetSdk < 16],
  ['BlockNetworkImage', 'Z', false], ['BlockNetworkLoads', 'Z', c => !c.hasInternet], ['LoadsImagesAutomatically', 'Z', true], ['MediaPlaybackRequiresUserGesture', 'Z', true],
  ['SupportZoom', 'Z', true], ['BuiltInZoomControls', 'Z', false], ['DisplayZoomControls', 'Z', true], ['UseWideViewPort', 'Z', false], ['LoadWithOverviewMode', 'Z', false],
  ['JavaScriptCanOpenWindowsAutomatically', 'Z', false], ['SupportMultipleWindows', 'Z', false], ['GeolocationEnabled', 'Z', true], ['SaveFormData', 'Z', true], ['SafeBrowsingEnabled', 'Z', true],
  ['OffscreenPreRaster', 'Z', false], ['AlgorithmicDarkeningAllowed', 'Z', false], ['NeedInitialFocus', 'Z', true], ['EnableSmoothTransition', 'Z', false], ['LightTouchEnabled', 'Z', false],
  ['TextZoom', 'I', 100], ['MinimumFontSize', 'I', 8], ['MinimumLogicalFontSize', 'I', 8], ['DefaultFontSize', 'I', 16], ['DefaultFixedFontSize', 'I', 13], ['CacheMode', 'I', -1],
  ['MixedContentMode', 'I', c => (c.targetSdk >= 21 ? 1 : 0)], ['ForceDark', 'I', 1], ['DisabledActionModeMenuItems', 'I', 0],
  ['StandardFontFamily', STRING, 'sans-serif'], ['FixedFontFamily', STRING, 'monospace'], ['SansSerifFontFamily', STRING, 'sans-serif'], ['SerifFontFamily', STRING, 'serif'],
  ['CursiveFontFamily', STRING, 'cursive'], ['FantasyFontFamily', STRING, 'fantasy'], ['DefaultTextEncodingName', STRING, 'UTF-8'], ['UserAgentString', STRING, c => c.userAgent],
];
const GETTER_PREFIX = { JavaScriptEnabled: 'get', DomStorageEnabled: 'get', DatabaseEnabled: 'get', AppCacheEnabled: 'get', AllowFileAccess: 'get', AllowContentAccess: 'get', AllowFileAccessFromFileURLs: 'get',
  AllowUniversalAccessFromFileURLs: 'get', BlockNetworkImage: 'get', BlockNetworkLoads: 'get', LoadsImagesAutomatically: 'get', MediaPlaybackRequiresUserGesture: 'get', SupportZoom: 'supports',
  BuiltInZoomControls: 'get', DisplayZoomControls: 'get', UseWideViewPort: 'get', LoadWithOverviewMode: 'get', JavaScriptCanOpenWindowsAutomatically: 'get', SupportMultipleWindows: 'supports',
  GeolocationEnabled: 'get', SaveFormData: 'get', SafeBrowsingEnabled: 'get', OffscreenPreRaster: 'get', AlgorithmicDarkeningAllowed: 'isAlgorithmicDarkeningAllowed', NeedInitialFocus: 'get', EnableSmoothTransition: 'get', LightTouchEnabled: 'get' };

export function createWebViewHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(WEBVIEW, ABSOLUTE, [], { allocatable: true });
  for (const t of [SETTINGS, CLIENT, CHROME, RESPONSE, CONSOLE, STORAGE, LAB_REQUEST, LAB_ERROR, LAB_LIST, LAB_ITEM, LAB_RESULT, HIT]) type(t, OBJECT, [], { allocatable: true });
  type(ERROR, OBJECT, [], { allocatable: true }); type(LEVEL, ENUM); type(JS_RESULT, OBJECT, [], { allocatable: true }); type(JS_PROMPT, JS_RESULT, [], { allocatable: true });
  type(REQUEST, OBJECT); type(LIST, OBJECT); type(ITEM, OBJECT);
  registry.interfaces.set(LAB_REQUEST, [REQUEST]); registry.interfaces.set(LAB_LIST, []);
  registry.parents.set(LAB_ERROR, ERROR); registry.parents.set(LAB_LIST, LIST); registry.parents.set(LAB_ITEM, ITEM);

  const unavailableOnce = gcRoot(new Set());
  const backend = () => platform.webViewBackend ?? null;
  const call = (r, receiver, owner, name, parameters, result, args) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const staticCall = (r, owner, name, parameters, result, args) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'static');

  // ---- main-Looper tasks: callbacks reach the app on the UI thread, after the call that caused them returns (as Android posts them) --------------------------------------
  /** Runs `task` on the VM's main thread after the current call returns (the platform event queue); `roots` keep the Java objects it uses alive until then. */
  const postMain = (r, task, roots = []) => platform.queueTask(task, 0, roots.filter(ref => !isNull(ref)));

  // ---- GeolocationPermissions / WebViewDatabase: the WebView profile's stored decisions, kept for the VM's lifetime (the data directory is the VM file system, no disk) ---------------
  // Origins are normalised to scheme://host[:port] like the Chromium profile does; a string that is no origin is ignored by allow/clear and reads as "not allowed". Results reach the
  // callbacks on the main Looper after the call returns.
  const GEO = 'Landroid/webkit/GeolocationPermissions;', WV_DATABASE = 'Landroid/webkit/WebViewDatabase;', SET_T = 'Ljava/util/Set;';
  type(GEO, OBJECT, [], { allocatable: true }); type(WV_DATABASE, OBJECT, [], { allocatable: true });
  const geo = gcRoot({ instance: null, database: null }), profile = platform.webProfile ??= { origins: new Map(), httpAuth: new Map() };
  const originOf = (r, value) => { if (isNull(value)) return null; try { const url = new URL(r.stringCharacters(value)); return url.origin === 'null' ? null : url.origin; } catch { return null; } };
  def(GEO, 'getInstance', `()${GEO}`, r => geo.instance ??= r.allocate(GEO), { static: true });
  def(GEO, 'allow', `(${STRING})V`, (r, _m, [, origin]) => { const key = originOf(r, origin); if (key) profile.origins.set(key, true); });
  def(GEO, 'clear', `(${STRING})V`, (r, _m, [, origin]) => { const key = originOf(r, origin); if (key) profile.origins.delete(key); });
  def(GEO, 'clearAll', '()V', () => { profile.origins.clear(); });
  def(GEO, 'getAllowed', `(${STRING}${CALLBACK})V`, (r, _m, [, origin, callback]) => {
    if (isNull(callback)) r.throwJava('Ljava/lang/NullPointerException;', 'Callback is null');
    const allowed = profile.origins.get(originOf(r, origin)) === true;
    postMain(r, () => call(r, callback, CALLBACK, 'onReceiveValue', [OBJECT], 'V', [staticCall(r, 'Ljava/lang/Boolean;', 'valueOf', ['Z'], 'Ljava/lang/Boolean;', [allowed ? 1 : 0])]), [callback]);
  });
  def(GEO, 'getOrigins', `(${CALLBACK})V`, (r, _m, [, callback]) => {
    if (isNull(callback)) r.throwJava('Ljava/lang/NullPointerException;', 'Callback is null');
    const origins = [...profile.origins.keys()];
    postMain(r, () => { const set = r.allocate('Ljava/util/HashSet;'); call(r, set, 'Ljava/util/HashSet;', '<init>', [], 'V', []); for (const o of origins) call(r, set, SET_T, 'add', [OBJECT], 'Z', [o]); call(r, callback, CALLBACK, 'onReceiveValue', [OBJECT], 'V', [set]); }, [callback]);
  });
  const authKey = (r, host, realm) => `${r.stringCharacters(host)}\u0000${r.stringCharacters(realm)}`;
  def(WEBVIEW, 'setHttpAuthUsernamePassword', `(${STRING}${STRING}${STRING}${STRING})V`, (r, _m, [, host, realm, user, pass]) => { if (isNull(host) || isNull(realm)) return; profile.httpAuth.set(authKey(r, host, realm), [r.stringCharacters(user), r.stringCharacters(pass)]); });
  def(WEBVIEW, 'getHttpAuthUsernamePassword', `(${STRING}${STRING})[${STRING}`, (r, _m, [, host, realm]) => {
    const pair = isNull(host) || isNull(realm) ? undefined : profile.httpAuth.get(authKey(r, host, realm)); if (!pair) return null;
    const a = r.newArray(`[${STRING}`, 2); r.array(a).elements = [...pair]; return a;
  });
  def(WV_DATABASE, 'getInstance', `(${CONTEXT})${WV_DATABASE}`, (r, _m, [context]) => { if (isNull(context)) r.throwJava('Ljava/lang/NullPointerException;', null); return geo.database ??= r.allocate(WV_DATABASE); }, { static: true });
  def(WV_DATABASE, 'hasUsernamePassword', '()Z', () => 0); def(WV_DATABASE, 'clearUsernamePassword', '()V', () => undefined);   // saved form passwords were removed from WebView in API 26 (always empty)
  def(WV_DATABASE, 'hasHttpAuthUsernamePassword', '()Z', () => (profile.httpAuth.size > 0 ? 1 : 0)); def(WV_DATABASE, 'clearHttpAuthUsernamePassword', '()V', () => { profile.httpAuth.clear(); });
  def(WV_DATABASE, 'hasFormData', '()Z', () => 0); def(WV_DATABASE, 'clearFormData', '()V', () => undefined);   // autofill form data is not stored by the WebView profile of this device

  // ---- per-WebView state ---------------------------------------------------------------------------------------------------------------------------------------------
  const newState = () => ({ settings: null, client: null, chrome: null, url: null, originalUrl: null, title: '', progress: 100, loading: false, scroll: { x: 0, y: 0 }, contentHeight: 0, findListener: null, nextFind: 1, history: [], index: -1, interfaces: new Map(), loadId: 0, destroyed: false, paused: false, id: null });
  const stateOf = (r, self) => { const o = r.object(self); if (!o.webview) r.throwJava('Ljava/lang/IllegalStateException;', 'WebView used before its constructor ran'); return o.webview; };
  let nextId = 1;
  const settingsContext = (r) => ({ targetSdk: platform.targetSdk ?? 34, hasInternet: platform.hasPermission?.('android.permission.INTERNET') ?? true,
    userAgent: `Mozilla/5.0 (Linux; Android ${platform.device?.release ?? '13'}; ${platform.device?.model ?? 'Android SDK built for x86_64'} Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36` });
  const settingsOf = (r, self) => {
    const state = stateOf(r, self);
    if (!state.settings) { const ref = r.allocate(SETTINGS), o = r.object(ref), context = settingsContext(r); o.values = new Map(SETTINGS_TABLE.map(([name, , value]) => [name, typeof value === 'function' ? value(context) : value])); o.owner = self; state.settings = ref; }
    return state.settings;
  };
  const setting = (r, ref, name) => r.object(ref).values.get(name);

  // ---- constructors ----------------------------------------------------------------------------------------------------------------------------------------------------
  const init = (parameters) => (r, _m, args) => {
    const [self] = args, o = r.object(self);
    r.dispatch({ owner: VIEW_GROUP, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, [self, ...args.slice(1, 1 + parameters.length)], 'direct');   // View state, context, attributes
    o.webview = newState(); o.webview.id = nextId++;
    o.background = '#ffffffff';   // a WebView paints its page; before one loads it is the default white
    o.clickable ??= false;
  };
  def(WEBVIEW, '<init>', `(${CONTEXT})V`, init([CONTEXT]));
  def(WEBVIEW, '<init>', `(${CONTEXT}${ATTRS})V`, init([CONTEXT, ATTRS]));
  def(WEBVIEW, '<init>', `(${CONTEXT}${ATTRS}I)V`, init([CONTEXT, ATTRS, 'I']));
  def(WEBVIEW, '<init>', `(${CONTEXT}${ATTRS}II)V`, init([CONTEXT, ATTRS, 'I', 'I']));
  def(WEBVIEW, '<init>', `(${CONTEXT}${ATTRS}IZ)V`, (r, m, args) => init([CONTEXT, ATTRS, 'I'])(r, m, args.slice(0, 4)));

  // ---- the load pipeline -----------------------------------------------------------------------------------------------------------------------------------------------
  const unavailable = (r, what) => {
    const message = `android.webkit.WebView.${what} needs a browser backend (an iframe in the page); this host (a Node probe, or a Worker with no page attached) has none`;
    if (r.tolerateMissing === 'off' || r.tolerateMissing === undefined) throw new APKError(message, { kind: 'webview-unavailable', method: what });
    if (!unavailableOnce.has(what)) { unavailableOnce.add(what); r.record(`STUB-WEBVIEW ${what} (${message})`); }
  };
  /** An API the lab's WebView does not implement: strict mode stops with the named error, the tolerant modes record it once. */
  const unsupported = (r, what, why) => {
    const message = `android.webkit.WebView.${what} is not supported by the lab's WebView: ${why}`;
    if (r.tolerateMissing === 'off' || r.tolerateMissing === undefined) throw new APKError(message, { kind: 'webview-unsupported', method: what });
    if (!unavailableOnce.has(what)) { unavailableOnce.add(what); r.record(`STUB-WEBVIEW ${what} (${message})`); }
  };
  const requestObject = (r, url, { mainFrame = true, method = 'GET', headers = new Map(), gesture = false, redirect = false } = {}) => {
    const ref = r.makeObject(LAB_REQUEST), o = r.object(ref); o.request = { url, mainFrame, method, headers, gesture, redirect }; return ref;
  };
  const errorObject = (r, code, description) => { const ref = r.makeObject(LAB_ERROR); r.object(ref).error = { code, description }; return ref; };
  const clientCall = (r, state, name, parameters, result, args, owner = CLIENT) => { if (isNull(state.client)) return undefined; return call(r, state.client, owner, name, parameters, result, args); };
  const chromeCall = (r, state, name, parameters, result, args) => { if (isNull(state.chrome)) return undefined; return call(r, state.chrome, CHROME, name, parameters, result, args); };
  // ---- shouldInterceptRequest (phase 3): the app's WebViewClient answers requests of documents the lab serves itself ----------------------------------------------------------
  const INTERCEPT_SIGNATURES = [`shouldInterceptRequest(${WEBVIEW}${REQUEST})${RESPONSE}`, `shouldInterceptRequest(${WEBVIEW}${STRING})${RESPONSE}`];
  /** Does the app's WebViewClient (a class of its own) override shouldInterceptRequest? Only then are requests routed to the VM at all. */
  const overridesIntercept = (r, state) => {
    if (isNull(state.client)) return false;
    for (let owner = r.typeOf(state.client), guard = 0; owner && owner !== CLIENT && guard < 64; owner = r.parent(owner), guard++) {
      const methods = r.classes.get(owner)?.methods; if (methods && INTERCEPT_SIGNATURES.some(signature => methods.has(signature))) return true;
    }
    return false;
  };
  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  const readResponseBytes = (r, stream, limit = MAX_RESPONSE_BYTES) => {
    const chunks = []; let total = 0;
    try {
      for (;;) {
        const buffer = r.newArray('[B', 16384), got = call(r, stream, INPUT_STREAM, 'read', ['[B', 'I', 'I'], 'I', [buffer, 0, 16384]);
        if (got < 0) break;
        total += got; if (total > limit) return { tooLarge: true };
        chunks.push(r.bytesOf(buffer, 0, got).slice());
      }
    } finally { try { call(r, stream, INPUT_STREAM, 'close', [], 'V', []); } catch { /* a stream that cannot close */ } }
    const bytes = new Uint8Array(total); let at = 0; for (const c of chunks) { bytes.set(c, at); at += c.length; }
    return { bytes };
  };
  /**
   * Asks the app's WebViewClient to answer a request of a document the lab serves. null: not overridden or the app returned null (nobody intercepted it); otherwise
   * { status, reason, mime, encoding, bytes } (the response headers of a WebResourceResponse are not carried: the page builds its own response headers), or { failed: description }.
   */
  const intercept = (r, self, state, { url, method = 'GET', headers = new Map(), mainFrame = false, gesture = false }) => {
    if (!overridesIntercept(r, state)) return null;
    const request = requestObject(r, url, { mainFrame, method, headers, gesture });
    const response = clientCall(r, state, 'shouldInterceptRequest', [WEBVIEW, REQUEST], RESPONSE, [self, request]);
    if (isNull(response)) return null;
    const o = r.object(response), chars = v => (isNull(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v));
    let bytes = new Uint8Array(0);
    if (!isNull(o.data)) { const read = readResponseBytes(r, o.data); if (read.tooLarge) return { failed: `the response is larger than ${MAX_RESPONSE_BYTES} bytes` }; bytes = read.bytes; }
    return { status: Number.isSafeInteger(o.status) ? o.status : 200, reason: chars(o.reason) ?? 'OK', mime: chars(o.mime) ?? 'text/plain', encoding: chars(o.encoding), bytes };
  };

  /**
   * Android's callbacks for a main-frame load that failed, in the order of the reference device: onProgressChanged(10) (`announce`: unless the WebView was already loading),
   * onPageStarted (unless the document had `started`), onReceivedError, onPageFinished, onReceivedTitle of the error page, onProgressChanged(100) twice. All on the UI thread.
   */
  const failLoad = (r, self, state, url, code, description, { announce = !state.loading, started = false, shown = url } = {}) => {
    const loadId = ++state.loadId; state.loading = true; state.originalUrl = shown; state.url = shown;
    postMain(r, () => {
      if (state.destroyed || loadId !== state.loadId) return;
      const progress = value => { state.progress = value; chromeCall(r, state, 'onProgressChanged', [WEBVIEW, 'I'], 'V', [self, value]); };
      if (announce) progress(10);
      if (!started) clientCall(r, state, 'onPageStarted', [WEBVIEW, STRING, BITMAP], 'V', [self, url, null]);
      clientCall(r, state, 'onReceivedError', [WEBVIEW, REQUEST, ERROR], 'V', [self, requestObject(r, url), errorObject(r, code, description)]);
      state.loading = false;
      clientCall(r, state, 'onPageFinished', [WEBVIEW, STRING], 'V', [self, url]);
      state.title = ERROR_PAGE_TITLE; const entry = state.history[state.index]; if (entry) entry.title = ERROR_PAGE_TITLE;
      chromeCall(r, state, 'onReceivedTitle', [WEBVIEW, STRING], 'V', [self, ERROR_PAGE_TITLE]);
      progress(100); progress(100);
      platform.requestDraw?.(r, self);
    }, [self, state.client, state.chrome]);
  };
  const navigate = (r, self, what, request) => {
    const state = stateOf(r, self);
    if (state.destroyed) r.throwJava('Ljava/lang/IllegalStateException;', 'WebView.destroy() called; it must not be used again');
    const target = request.displayUrl ?? request.url;
    if (!backend()) {
      unavailable(r, what);
      failLoad(r, self, state, target, WEBVIEW_ERRORS.CONNECT, 'net::ERR_CONNECTION_FAILED (the lab has no browser backend for this WebView)');
      return;
    }
    backend().load?.(r, self, state, request);
  };
  const pushHistory = (state, entry) => { state.history.length = state.index + 1; state.history.push(entry); state.index = state.history.length - 1; };

  const stringArg = (r, v, name) => { if (isNull(v)) r.throwJava('Ljava/lang/NullPointerException;', `${name} == null`); return typeof v === 'string' ? v : r.stringCharacters(v); };
  const headersOf = (r, map) => {
    const out = new Map(); if (isNull(map)) return out;
    const entries = call(r, call(r, map, MAP, 'entrySet', [], 'Ljava/util/Set;', []), 'Ljava/util/Set;', 'toArray', [], '[Ljava/lang/Object;', []);
    for (const entry of r.array(entries).elements) { const k = call(r, entry, 'Ljava/util/Map$Entry;', 'getKey', [], OBJECT, []), v = call(r, entry, 'Ljava/util/Map$Entry;', 'getValue', [], OBJECT, []); out.set(stringArg(r, k, 'header name'), stringArg(r, v, 'header value')); }
    return out;
  };
  def(WEBVIEW, 'loadUrl', `(${STRING})V`, (r, _m, [self, url]) => { const text = stringArg(r, url, 'url'); navigate(r, self, 'loadUrl', { kind: 'url', url: text, headers: new Map() }); });
  def(WEBVIEW, 'loadUrl', `(${STRING}${MAP})V`, (r, _m, [self, url, headers]) => { const text = stringArg(r, url, 'url'); navigate(r, self, 'loadUrl', { kind: 'url', url: text, headers: headersOf(r, headers) }); });
  def(WEBVIEW, 'loadData', `(${STRING}${STRING}${STRING})V`, (r, _m, [self, data, mime, encoding]) => {
    const body = stringArg(r, data, 'data'), type = isNull(mime) ? 'text/html' : stringArg(r, mime, 'mimeType'), enc = isNull(encoding) ? null : stringArg(r, encoding, 'encoding');
    // Android turns loadData into a data: URL, which is also what getUrl() reports
    const url = `data:${type}${enc === 'base64' ? ';base64' : ''},${body}`;
    navigate(r, self, 'loadData', { kind: 'data', data: body, mime: type, encoding: enc, url, displayUrl: url });
  });
  def(WEBVIEW, 'loadDataWithBaseURL', `(${STRING}${STRING}${STRING}${STRING}${STRING})V`, (r, _m, [self, base, data, mime, encoding, history]) => {
    const baseUrl = isNull(base) ? 'about:blank' : stringArg(r, base, 'baseUrl');
    navigate(r, self, 'loadDataWithBaseURL', { kind: 'dataBase', baseUrl, data: stringArg(r, data, 'data'), mime: isNull(mime) ? 'text/html' : stringArg(r, mime, 'mimeType'), encoding: isNull(encoding) ? null : stringArg(r, encoding, 'encoding'), historyUrl: isNull(history) ? null : stringArg(r, history, 'historyUrl'), url: baseUrl, callbackUrl: baseUrl, displayUrl: isNull(history) ? 'about:blank' : stringArg(r, history, 'historyUrl') });   // getUrl() is the history URL (about:blank without one); the callbacks carry the base URL
  });
  def(WEBVIEW, 'postUrl', `(${STRING}[B)V`, (r, _m, [self, url, body]) => navigate(r, self, 'postUrl', { kind: 'post', url: stringArg(r, url, 'url'), body: isNull(body) ? new Uint8Array(0) : Uint8Array.from(r.array(body).elements, v => v & 255) }));
  def(WEBVIEW, 'reload', '()V', (r, _m, [self]) => { const state = stateOf(r, self); if (state.url === null) return; const entry = state.history[state.index]; navigate(r, self, 'reload', { ...(entry?.request ?? { kind: 'url', url: state.url, headers: new Map() }), reload: true }); });
  def(WEBVIEW, 'stopLoading', '()V', (r, _m, [self]) => { const state = stateOf(r, self); if (!state.loading) return; state.loadId++; state.loading = false; state.progress = 100; backend()?.stop?.(r, self, state); });

  // ---- history (host-initiated navigations; the iframe's own history is not readable across origins) ---------------------------------------------------------------------------------
  def(WEBVIEW, 'canGoBack', '()Z', (r, _m, [self]) => stateOf(r, self).index > 0 ? 1 : 0);
  def(WEBVIEW, 'canGoForward', '()Z', (r, _m, [self]) => { const s = stateOf(r, self); return s.index >= 0 && s.index < s.history.length - 1 ? 1 : 0; });
  def(WEBVIEW, 'canGoBackOrForward', '(I)Z', (r, _m, [self, steps]) => { const s = stateOf(r, self), i = s.index + steps; return i >= 0 && i < s.history.length ? 1 : 0; });
  const goBy = (r, self, steps) => { const s = stateOf(r, self), i = s.index + steps; if (i < 0 || i >= s.history.length) return; s.index = i; const entry = s.history[i]; navigate(r, self, 'goBackOrForward', { ...entry.request, history: 'keep' }); };
  def(WEBVIEW, 'goBack', '()V', (r, _m, [self]) => goBy(r, self, -1)); def(WEBVIEW, 'goForward', '()V', (r, _m, [self]) => goBy(r, self, 1));
  def(WEBVIEW, 'goBackOrForward', '(I)V', (r, _m, [self, steps]) => goBy(r, self, steps));
  def(WEBVIEW, 'clearHistory', '()V', (r, _m, [self]) => { const s = stateOf(r, self), keep = s.history[s.index]; s.history = keep ? [keep] : []; s.index = keep ? 0 : -1; });
  const historyItem = (r, entry) => { const ref = r.makeObject(LAB_ITEM); r.object(ref).entry = entry; return ref; };
  def(LAB_ITEM, 'getUrl', `()${STRING}`, (r, _m, [self]) => r.object(self).entry.url); def(LAB_ITEM, 'getOriginalUrl', `()${STRING}`, (r, _m, [self]) => r.object(self).entry.originalUrl ?? r.object(self).entry.url);
  def(LAB_ITEM, 'getTitle', `()${STRING}`, (r, _m, [self]) => r.object(self).entry.title ?? null); def(LAB_ITEM, 'getFavicon', `()${BITMAP}`, () => null);
  def(WEBVIEW, 'copyBackForwardList', `()${LIST}`, (r, _m, [self]) => { const ref = r.makeObject(LAB_LIST), s = stateOf(r, self); r.object(ref).list = { entries: s.history.slice(), index: s.index }; return ref; });
  def(LAB_LIST, 'getSize', '()I', (r, _m, [self]) => r.object(self).list.entries.length); def(LAB_LIST, 'getCurrentIndex', '()I', (r, _m, [self]) => r.object(self).list.index);
  def(LAB_LIST, 'getCurrentItem', `()${ITEM}`, (r, _m, [self]) => { const { entries, index } = r.object(self).list; return entries[index] ? historyItem(r, entries[index]) : null; });
  def(LAB_LIST, 'getItemAtIndex', `(I)${ITEM}`, (r, _m, [self, i]) => { const { entries } = r.object(self).list; return entries[i] ? historyItem(r, entries[i]) : null; });

  // ---- state queries ---------------------------------------------------------------------------------------------------------------------------------------------------
  def(WEBVIEW, 'getUrl', `()${STRING}`, (r, _m, [self]) => stateOf(r, self).url); def(WEBVIEW, 'getOriginalUrl', `()${STRING}`, (r, _m, [self]) => stateOf(r, self).originalUrl);
  def(WEBVIEW, 'getTitle', `()${STRING}`, (r, _m, [self]) => stateOf(r, self).title);
  def(WEBVIEW, 'getProgress', '()I', (r, _m, [self]) => stateOf(r, self).progress);
  def(WEBVIEW, 'getContentHeight', '()I', (r, _m, [self]) => stateOf(r, self).contentHeight ?? 0);
  // ---- scrolling: the document scrolls inside its frame; the position and the content size are what its bridge last reported (CSS pixels are dp) ---------------------------------
  def(WEBVIEW, 'getScrollX', '()I', (r, _m, [self]) => stateOf(r, self).scroll?.x ?? 0); def(WEBVIEW, 'getScrollY', '()I', (r, _m, [self]) => stateOf(r, self).scroll?.y ?? 0);
  const scrollCommand = (r, self, api, name, x, y) => { const s = stateOf(r, self); if (!backend()?.command || !s.bridge) return false; return backend().command(r, self, s, api, { name, x, y }); };
  def(WEBVIEW, 'scrollTo', '(II)V', (r, _m, [self, x, y]) => { scrollCommand(r, self, 'scrollTo', 'scrollTo', x, y); });
  def(WEBVIEW, 'scrollBy', '(II)V', (r, _m, [self, x, y]) => { scrollCommand(r, self, 'scrollBy', 'scrollBy', x, y); });
  // pageUp/pageDown answer whether the page can move (from the last reported position) and scroll by the height of the view, or to the edge
  const page = (r, self, down, edge) => {
    const s = stateOf(r, self), view = s.viewHeight ?? 0, max = Math.max(0, (s.contentHeight ?? 0) - view), y = s.scroll?.y ?? 0;
    if (down ? y >= max : y <= 0) return 0;
    const target = edge ? (down ? max : 0) : Math.max(0, Math.min(max, y + (down ? view : -view)));
    return scrollCommand(r, self, down ? 'pageDown' : 'pageUp', 'scrollTo', s.scroll?.x ?? 0, target) ? 1 : 0;
  };
  def(WEBVIEW, 'pageUp', '(Z)Z', (r, _m, [self, top]) => page(r, self, false, !!top)); def(WEBVIEW, 'pageDown', '(Z)Z', (r, _m, [self, bottom]) => page(r, self, true, !!bottom));
  // ---- find in page ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const FIND_LISTENER = 'Landroid/webkit/WebView$FindListener;';
  def(WEBVIEW, 'setFindListener', `(${FIND_LISTENER})V`, (r, _m, [self, listener]) => { stateOf(r, self).findListener = isNull(listener) ? null : listener; });
  def(WEBVIEW, 'findAllAsync', `(${STRING})V`, (r, _m, [self, text]) => { const s = stateOf(r, self); if (backend()?.command && s.bridge) backend().command(r, self, s, 'findAllAsync', { name: 'find', fid: s.nextFind++, text: isNull(text) ? '' : stringArg(r, text, 'find') }); });
  def(WEBVIEW, 'findNext', '(Z)V', (r, _m, [self, forward]) => { const s = stateOf(r, self); if (backend()?.command && s.bridge) backend().command(r, self, s, 'findNext', { name: 'findNext', fid: s.nextFind++, forward: !!forward }); });
  def(WEBVIEW, 'clearMatches', '()V', (r, _m, [self]) => { const s = stateOf(r, self); if (backend()?.command && s.bridge?.scriptable) backend().command(r, self, s, 'clearMatches', { name: 'clearMatches' }); });
  // ---- web messages: postWebMessage delivers a MessageEvent to the document's window; message ports are not connected (createWebMessageChannel fails by name) --------------------------
  const WEB_MESSAGE = 'Landroid/webkit/WebMessage;';
  def(WEBVIEW, 'postWebMessage', `(${WEB_MESSAGE}Landroid/net/Uri;)V`, (r, _m, [self, message, target]) => {
    if (isNull(message)) r.throwJava('Ljava/lang/NullPointerException;', 'message == null');
    const s = stateOf(r, self), data = call(r, message, WEB_MESSAGE, 'getData', [], STRING, []), ports = call(r, message, WEB_MESSAGE, 'getPorts', [], '[Landroid/webkit/WebMessagePort;', []);
    if (!isNull(ports) && r.array(ports).elements.length) unsupported(r, 'postWebMessage', 'a WebMessage that transfers WebMessagePorts: the lab does not connect message ports to the document');
    if (!backend()?.command) { unavailable(r, 'postWebMessage'); return; }
    const origin = isNull(target) ? '*' : r.stringCharacters(call(r, target, 'Landroid/net/Uri;', 'toString', [], STRING, []));
    if (origin !== '*' && origin !== '' && s.bridge?.origin && (() => { try { return new URL(origin).origin !== s.bridge.origin; } catch { return true; } })()) return;   // the target origin does not match the document: dropped, as in Chromium
    backend().command(r, self, s, 'postWebMessage', { name: 'message', data: isNull(data) ? '' : typeof data === 'string' ? data : r.stringCharacters(data) }, { create: true });
  });
  def(WEBVIEW, 'createWebMessageChannel', '()[Landroid/webkit/WebMessagePort;', (r) => { unsupported(r, 'createWebMessageChannel', 'the lab does not connect WebMessagePorts to a document; WebView.postWebMessage with a string works'); return null; });
  // ---- saveState / restoreState: the back/forward list as a byte[] under Chromium's key (the documents themselves are loaded again, as Android does) -------------------------------------
  const BUNDLE = 'Landroid/os/Bundle;', STATE_KEY = 'WEBVIEW_CHROMIUM_STATE';
  def(WEBVIEW, 'saveState', `(${BUNDLE})${LIST}`, (r, _m, [self, bundle]) => {
    if (isNull(bundle)) r.throwJava('Ljava/lang/NullPointerException;', 'outState == null');
    const s = stateOf(r, self); if (!s.history.length) return null;
    const entries = s.history.map(e => ({ url: e.url, originalUrl: e.originalUrl, title: e.title, request: { ...e.request, headers: [...(e.request.headers ?? [])], body: e.request.body ? Array.from(e.request.body) : null } }));
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, index: s.index, entries })), array = r.newArray('[B', bytes.length);
    r.bytesOf(array, 0, bytes.length).set(bytes);
    call(r, bundle, BUNDLE, 'putByteArray', [STRING, '[B'], 'V', [STATE_KEY, array]);
    return call(r, self, WEBVIEW, 'copyBackForwardList', [], LIST, []);
  });
  def(WEBVIEW, 'restoreState', `(${BUNDLE})${LIST}`, (r, _m, [self, bundle]) => {
    if (isNull(bundle)) r.throwJava('Ljava/lang/NullPointerException;', 'inState == null');
    const array = call(r, bundle, BUNDLE, 'getByteArray', [STRING], '[B', [STATE_KEY]); if (isNull(array)) return null;
    let saved; try { saved = JSON.parse(new TextDecoder().decode(r.bytesOf(array, 0, r.array(array).elements.length))); } catch { return null; }
    if (saved?.version !== 1 || !Array.isArray(saved.entries) || !saved.entries.length) return null;
    const s = stateOf(r, self);
    s.history = saved.entries.map(e => ({ url: e.url, originalUrl: e.originalUrl, title: e.title, request: { ...e.request, headers: new Map(e.request.headers ?? []), body: e.request.body ? Uint8Array.from(e.request.body) : undefined } }));
    s.index = Math.max(0, Math.min(s.history.length - 1, saved.index | 0));
    navigate(r, self, 'restoreState', { ...s.history[s.index].request, history: 'keep' });
    return call(r, self, WEBVIEW, 'copyBackForwardList', [], LIST, []);
  });
  // ---- what the lab cannot do, said by name ------------------------------------------------------------------------------------------------------------------------------------------
  def(WEBVIEW, 'capturePicture', '()Landroid/graphics/Picture;', (r) => { unsupported(r, 'capturePicture', 'the document is drawn by the browser inside a sandboxed frame whose pixels the page cannot read'); return null; });
  def(WEBVIEW, 'zoomIn', '()Z', () => 0); def(WEBVIEW, 'zoomOut', '()Z', () => 0); def(WEBVIEW, 'canZoomIn', '()Z', () => 0); def(WEBVIEW, 'canZoomOut', '()Z', () => 0);   // the page scale is fixed at 1: there is nothing to zoom to
  def(WEBVIEW, 'zoomBy', '(F)V', () => undefined);
  // setWebContentsDebuggingEnabled is the process-wide flag of src/content-extras-host.js; the frame is always inspectable with the browser's own developer tools
  def(WEBVIEW, 'getScale', '()F', () => 1); def(WEBVIEW, 'getFavicon', `()${BITMAP}`, () => null);
  def(WEBVIEW, 'getSettings', `()${SETTINGS}`, (r, _m, [self]) => settingsOf(r, self));
  def(WEBVIEW, 'setWebViewClient', `(${CLIENT})V`, (r, _m, [self, client]) => { stateOf(r, self).client = isNull(client) ? null : client; });
  def(WEBVIEW, 'getWebViewClient', `()${CLIENT}`, (r, _m, [self]) => stateOf(r, self).client);
  def(WEBVIEW, 'setWebChromeClient', `(${CHROME})V`, (r, _m, [self, chrome]) => { stateOf(r, self).chrome = isNull(chrome) ? null : chrome; });
  def(WEBVIEW, 'getWebChromeClient', `()${CHROME}`, (r, _m, [self]) => stateOf(r, self).chrome);
  // The listener is kept; the lab's WebView never starts a download (its frame is sandboxed without downloads), so onDownloadStart is never called.
  def(WEBVIEW, 'setDownloadListener', '(Landroid/webkit/DownloadListener;)V', (r, _m, [self, listener]) => { stateOf(r, self).downloadListener = isNull(listener) ? null : listener; });
  for (const name of ['onPause', 'onResume']) def(WEBVIEW, name, '()V', (r, _m, [self]) => { stateOf(r, self).paused = name === 'onPause'; });
  for (const name of ['pauseTimers', 'resumeTimers', 'clearCache', 'clearFormData', 'clearSslPreferences', 'freeMemory']) def(WEBVIEW, name, name === 'clearCache' ? '(Z)V' : '()V', () => undefined);
  def(WEBVIEW, 'destroy', '()V', (r, _m, [self]) => { const s = stateOf(r, self); s.destroyed = true; s.loadId++; s.loading = false; backend()?.destroy?.(r, self, s); });
  def(WEBVIEW, 'setInitialScale', '(I)V', () => undefined); def(WEBVIEW, 'setVerticalScrollbarOverlay', '(Z)V', () => undefined); def(WEBVIEW, 'setHorizontalScrollbarOverlay', '(Z)V', () => undefined);
  def(WEBVIEW, 'setNetworkAvailable', '(Z)V', () => undefined);
  def(WEBVIEW, 'getHitTestResult', `()${HIT}`, r => { const ref = r.makeObject(HIT); return ref; });
  def(HIT, 'getType', '()I', () => 0); def(HIT, 'getExtra', `()${STRING}`, () => null);
  def(WEBVIEW, 'evaluateJavascript', `(${STRING}${CALLBACK})V`, (r, _m, [self, script, callback]) => {
    const s = stateOf(r, self); stringArg(r, script, 'script');
    if (!backend()?.evaluate) {
      unavailable(r, 'evaluateJavascript');
      if (!isNull(callback)) postMain(r, () => call(r, callback, CALLBACK, 'onReceiveValue', [OBJECT], 'V', ['null']), [callback, self]);
      return;
    }
    backend().evaluate(r, self, s, stringArg(r, script, 'script'), callback);
  });
  def(WEBVIEW, 'addJavascriptInterface', `(${OBJECT}${STRING})V`, (r, _m, [self, object, name]) => { if (isNull(object)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'object == null'); stateOf(r, self).interfaces.set(stringArg(r, name, 'name'), object); backend()?.interfaceChanged?.(r, self, stateOf(r, self)); });
  def(WEBVIEW, 'removeJavascriptInterface', `(${STRING})V`, (r, _m, [self, name]) => { stateOf(r, self).interfaces.delete(stringArg(r, name, 'name')); backend()?.interfaceChanged?.(r, self, stateOf(r, self)); });
  def(WEBVIEW, 'getCurrentWebViewPackage', '()Landroid/content/pm/PackageInfo;', () => null, { static: true });   // no WebView provider package is installed: AOSP answers null in that case

  // ---- the WebView provider's class loader and its support-library glue (WebView.getWebViewClassLoader, API 28) -----------------------------------------------------------
  // In AOSP the loader belongs to the installed WebView provider package; androidx.webkit loads org.chromium.support_lib_glue.SupportLibReflectionUtil from it by reflection, calls
  // its static createWebViewProviderFactory() and wraps the returned InvocationHandler in a java.lang.reflect.Proxy of WebViewProviderFactoryBoundaryInterface (an interface that
  // ships in the app's own APK, so the Proxy is built by the app against its class loader; the handler below only sees Method objects and plain values).
  // The lab's provider answers getSupportedFeatures() with LAB_PROVIDER_FEATURES, the support-library features whose WebView-side behavior this WebView implements (none: the
  // platform-level features, e.g. SAFE_BROWSING_ENABLE or FORCE_DARK, are decided by androidx.webkit from the framework API the WebView has). Every other factory method fails with a
  // named error (or, in the tolerant modes, is recorded as a STUB-WEBVIEW line and answers null).
  const GLUE = 'Lorg/chromium/support_lib_glue/SupportLibReflectionUtil;', FACTORY_HANDLER = 'Llab/webkit/LabProviderFactoryHandler;', INVOCATION_HANDLER = 'Ljava/lang/reflect/InvocationHandler;',
    REFLECT_METHOD = 'Ljava/lang/reflect/Method;', PATH_CLASS_LOADER = 'Ldalvik/system/PathClassLoader;', BOUNDARY = 'org.chromium.support_lib_boundary.WebViewProviderFactoryBoundaryInterface';
  type(GLUE, OBJECT, [], { allocatable: true }); type(FACTORY_HANDLER, OBJECT, [INVOCATION_HANDLER], { allocatable: true });
  const provider = gcRoot({ loader: null, factory: null });
  def(WEBVIEW, 'getWebViewClassLoader', '()Ljava/lang/ClassLoader;', (r) => {
    if (isNull(provider.loader)) {   // a PathClassLoader of the boot loader with no dex path: the provider's classes are lab host classes, visible by name through it
      const ref = r.allocate(PATH_CLASS_LOADER); r.dispatch({ owner: PATH_CLASS_LOADER, name: '<init>', parameters: [STRING, 'Ljava/lang/ClassLoader;'], result: 'V', signature: `(${STRING}Ljava/lang/ClassLoader;)V` }, [ref, '', null], 'direct');
      provider.loader = ref;
    }
    return provider.loader;
  }, { static: true });
  def(GLUE, 'createWebViewProviderFactory', `()${INVOCATION_HANDLER}`, (r) => provider.factory ??= r.allocate(FACTORY_HANDLER), { static: true });
  const boxBoolean = (r, v) => staticCall(r, 'Ljava/lang/Boolean;', 'valueOf', ['Z'], 'Ljava/lang/Boolean;', [v ? 1 : 0]);
  def(FACTORY_HANDLER, 'invoke', `(${OBJECT}${REFLECT_METHOD}[${OBJECT})${OBJECT}`, (r, _m, [self, proxy, method, args]) => {
    const name = r.stringCharacters(call(r, method, REFLECT_METHOD, 'getName', [], STRING, []));
    if (name === 'getSupportedFeatures') {
      const array = r.newArray(`[${STRING}`, LAB_PROVIDER_FEATURES.length); r.array(array).elements = [...LAB_PROVIDER_FEATURES]; return array;
    }
    if (name === 'hashCode') return r.javaHash(proxy);
    if (name === 'equals') return boxBoolean(r, !isNull(args) && r.array(args).elements[0] === proxy);
    if (name === 'toString') return `lab-webview-provider-factory@${(r.javaHash(proxy) >>> 0).toString(16)}`;
    const message = `${BOUNDARY}.${name}() is not implemented by the lab's WebView provider (only getSupportedFeatures() is); the support-library feature behind it is not supported`;
    if (r.tolerateMissing === 'off' || r.tolerateMissing === undefined) throw new APKError(message, { kind: 'webview-provider-unsupported', method: name });
    if (!unavailableOnce.has(`provider.${name}`)) { unavailableOnce.add(`provider.${name}`); r.record(`STUB-WEBVIEW provider.${name} (${message})`); }
    return null;
  });

  // ---- WebSettings -----------------------------------------------------------------------------------------------------------------------------------------------------
  for (const [name, kind] of SETTINGS_TABLE) {
    const prefix = GETTER_PREFIX[name] ?? 'get', getter = prefix === 'get' || prefix === 'supports' ? `${prefix}${name}` : prefix, valueType = kind;
    def(SETTINGS, getter, `()${valueType}`, (r, _m, [self]) => { const v = r.object(self).values.get(name); return valueType === 'Z' ? (v ? 1 : 0) : v; });
    def(SETTINGS, `set${name}`, `(${valueType})V`, (r, _m, [self, value]) => {
      const o = r.object(self); const next = valueType === 'Z' ? !!value : value;
      if (valueType === STRING && name !== 'UserAgentString' && isNull(next)) r.throwJava('Ljava/lang/NullPointerException;', `${name} == null`);
      if (name === 'UserAgentString' && (isNull(next) || next === '')) { o.values.set(name, settingsContext(r).userAgent); }   // null/empty restores the default, as Android does
      else o.values.set(name, valueType === STRING && typeof next !== 'string' ? r.stringCharacters(next) : next);
      backend()?.settingChanged?.(r, o.owner, stateOf(r, o.owner), name, o.values.get(name));
    });
  }
  def(SETTINGS, 'getUserAgentString', `()${STRING}`, (r, _m, [self]) => r.object(self).values.get('UserAgentString'));
  def(SETTINGS, 'setAppCachePath', `(${STRING})V`, () => undefined); def(SETTINGS, 'setAppCacheMaxSize', '(J)V', () => undefined); def(SETTINGS, 'setGeolocationDatabasePath', `(${STRING})V`, () => undefined);
  def(SETTINGS, 'setDefaultZoom', '(Ljava/lang/Object;)V', () => undefined);
  // Deprecated settings Android itself ignores: passwords are not saved since API 18 (getSavePassword() is false) and the database path is managed by the WebView since API 19 (getDatabasePath() is "").
  def(SETTINGS, 'setSavePassword', '(Z)V', () => undefined); def(SETTINGS, 'getSavePassword', '()Z', () => 0);
  def(SETTINGS, 'setDatabasePath', `(${STRING})V`, () => undefined); def(SETTINGS, 'getDatabasePath', `()${STRING}`, () => '');
  def(SETTINGS, 'getDefaultUserAgent', `(${CONTEXT})${STRING}`, r => settingsContext(r).userAgent, { static: true });

  // ---- WebViewClient / WebChromeClient defaults (what a client that overrides nothing does) ------------------------------------------------------------------------------------
  const empty = (owner, name, parameters, result = 'V', value = undefined) => def(owner, name, `(${parameters.join('')})${result}`, () => value);
  type(CLIENT, OBJECT, [], { allocatable: true }); def(CLIENT, '<init>', '()V', () => undefined);
  empty(CLIENT, 'onPageStarted', [WEBVIEW, STRING, BITMAP]); empty(CLIENT, 'onPageFinished', [WEBVIEW, STRING]); empty(CLIENT, 'onLoadResource', [WEBVIEW, STRING]); empty(CLIENT, 'onPageCommitVisible', [WEBVIEW, STRING]);
  empty(CLIENT, 'onTooManyRedirects', [WEBVIEW, 'Landroid/os/Message;', 'Landroid/os/Message;']); empty(CLIENT, 'onFormResubmission', [WEBVIEW, 'Landroid/os/Message;', 'Landroid/os/Message;']);
  empty(CLIENT, 'doUpdateVisitedHistory', [WEBVIEW, STRING, 'Z']); empty(CLIENT, 'onScaleChanged', [WEBVIEW, 'F', 'F']); empty(CLIENT, 'onReceivedLoginRequest', [WEBVIEW, STRING, STRING, STRING]);
  empty(CLIENT, 'onReceivedHttpError', [WEBVIEW, REQUEST, RESPONSE]); empty(CLIENT, 'onReceivedClientCertRequest', [WEBVIEW, 'Landroid/webkit/ClientCertRequest;']);
  empty(CLIENT, 'onReceivedHttpAuthRequest', [WEBVIEW, 'Landroid/webkit/HttpAuthHandler;', STRING, STRING]);
  def(CLIENT, 'onReceivedSslError', `(${WEBVIEW}Landroid/webkit/SslErrorHandler;Landroid/net/http/SslError;)V`, (r, _m, [, , handler]) => { if (!isNull(handler)) call(r, handler, 'Landroid/webkit/SslErrorHandler;', 'cancel', [], 'V', []); });
  empty(CLIENT, 'shouldOverrideKeyEvent', [WEBVIEW, 'Landroid/view/KeyEvent;'], 'Z', 0); empty(CLIENT, 'onUnhandledKeyEvent', [WEBVIEW, 'Landroid/view/KeyEvent;']);
  empty(CLIENT, 'onRenderProcessGone', [WEBVIEW, 'Landroid/webkit/RenderProcessGoneDetail;'], 'Z', 0); empty(CLIENT, 'onSafeBrowsingHit', [WEBVIEW, REQUEST, 'I', 'Landroid/webkit/SafeBrowsingResponse;']);
  empty(CLIENT, 'shouldInterceptRequest', [WEBVIEW, STRING], RESPONSE, null);
  const urlString = (r, request) => r.object(request).request?.url ?? null;
  def(CLIENT, 'shouldInterceptRequest', `(${WEBVIEW}${REQUEST})${RESPONSE}`, (r, _m, [self, view, request]) => call(r, self, CLIENT, 'shouldInterceptRequest', [WEBVIEW, STRING], RESPONSE, [view, urlString(r, request)]));
  def(CLIENT, 'shouldOverrideUrlLoading', `(${WEBVIEW}${STRING})Z`, () => 0);
  def(CLIENT, 'shouldOverrideUrlLoading', `(${WEBVIEW}${REQUEST})Z`, (r, _m, [self, view, request]) => call(r, self, CLIENT, 'shouldOverrideUrlLoading', [WEBVIEW, STRING], 'Z', [view, urlString(r, request)]));
  def(CLIENT, 'onReceivedError', `(${WEBVIEW}I${STRING}${STRING})V`, () => undefined);
  def(CLIENT, 'onReceivedError', `(${WEBVIEW}${REQUEST}${ERROR})V`, (r, _m, [self, view, request, error]) => { if (r.object(request).request?.mainFrame) call(r, self, CLIENT, 'onReceivedError', [WEBVIEW, 'I', STRING, STRING], 'V', [view, r.object(error).error.code, r.object(error).error.description, urlString(r, request)]); });
  type(CHROME, OBJECT, [], { allocatable: true }); def(CHROME, '<init>', '()V', () => undefined);
  empty(CHROME, 'onProgressChanged', [WEBVIEW, 'I']); empty(CHROME, 'onReceivedTitle', [WEBVIEW, STRING]); empty(CHROME, 'onReceivedIcon', [WEBVIEW, BITMAP]); empty(CHROME, 'onReceivedTouchIconUrl', [WEBVIEW, STRING, 'Z']);
  empty(CHROME, 'onShowCustomView', [VIEW, 'Landroid/webkit/WebChromeClient$CustomViewCallback;']); empty(CHROME, 'onHideCustomView', []); empty(CHROME, 'onRequestFocus', [WEBVIEW]); empty(CHROME, 'onCloseWindow', [WEBVIEW]);
  empty(CHROME, 'onCreateWindow', [WEBVIEW, 'Z', 'Z', 'Landroid/os/Message;'], 'Z', 0);
  for (const name of ['onJsAlert', 'onJsConfirm', 'onJsBeforeUnload']) empty(CHROME, name, [WEBVIEW, STRING, STRING, JS_RESULT], 'Z', 0);
  empty(CHROME, 'onJsPrompt', [WEBVIEW, STRING, STRING, STRING, JS_PROMPT], 'Z', 0);
  empty(CHROME, 'onGeolocationPermissionsShowPrompt', [STRING, 'Landroid/webkit/GeolocationPermissions$Callback;']); empty(CHROME, 'onGeolocationPermissionsHidePrompt', []);
  def(CHROME, 'onPermissionRequest', '(Landroid/webkit/PermissionRequest;)V', (r, _m, [, request]) => { if (!isNull(request)) call(r, request, 'Landroid/webkit/PermissionRequest;', 'deny', [], 'V', []); });   // AOSP: a client that does not override it denies
  empty(CHROME,'onPermissionRequestCanceled', ['Landroid/webkit/PermissionRequest;']);
  def(CHROME, 'onConsoleMessage', `(${CONSOLE})Z`, (r, _m, [self, message]) => { const o = r.object(message); call(r, self, CHROME, 'onConsoleMessage', [STRING, 'I', STRING], 'V', [o.message, o.line, o.source]); return 0; });   // AOSP: the old overload, then "not handled"
  empty(CHROME, 'onConsoleMessage', [STRING, 'I', STRING]);
  empty(CHROME, 'getDefaultVideoPoster', [], BITMAP, null); empty(CHROME, 'getVideoLoadingProgressView', [], VIEW, null);
  empty(CHROME, 'getVisitedHistory', [CALLBACK]); empty(CHROME, 'onShowFileChooser', [WEBVIEW, CALLBACK, 'Landroid/webkit/WebChromeClient$FileChooserParams;'], 'Z', 0);

  // ---- WebResourceRequest / Error / Response / ConsoleMessage / JsResult / WebStorage ---------------------------------------------------------------------------------------------
  const uriOf = (r, text) => staticCall(r, 'Landroid/net/Uri;', 'parse', [STRING], 'Landroid/net/Uri;', [text]);
  def(LAB_REQUEST, 'getUrl', '()Landroid/net/Uri;', (r, _m, [self]) => uriOf(r, r.object(self).request.url));
  def(LAB_REQUEST, 'isForMainFrame', '()Z', (r, _m, [self]) => r.object(self).request.mainFrame ? 1 : 0);
  def(LAB_REQUEST, 'isRedirect', '()Z', (r, _m, [self]) => r.object(self).request.redirect ? 1 : 0);
  def(LAB_REQUEST, 'hasGesture', '()Z', (r, _m, [self]) => r.object(self).request.gesture ? 1 : 0);
  def(LAB_REQUEST, 'getMethod', `()${STRING}`, (r, _m, [self]) => r.object(self).request.method);
  def(LAB_REQUEST, 'getRequestHeaders', `()${MAP}`, (r, _m, [self]) => {
    const map = r.allocate('Ljava/util/HashMap;'); r.dispatch({ owner: 'Ljava/util/HashMap;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [map], 'direct');
    for (const [k, v] of r.object(self).request.headers) call(r, map, MAP, 'put', [OBJECT, OBJECT], OBJECT, [k, v]);
    return map;
  });
  def(LAB_ERROR, 'getErrorCode', '()I', (r, _m, [self]) => r.object(self).error.code); def(LAB_ERROR, 'getDescription', '()Ljava/lang/CharSequence;', (r, _m, [self]) => r.object(self).error.description);
  def(RESPONSE, '<init>', `(${STRING}${STRING}${INPUT_STREAM})V`, (r, _m, [self, mime, encoding, data]) => { Object.assign(r.object(self), { mime, encoding, data, status: 200, reason: 'OK', headers: null }); });
  def(RESPONSE, '<init>', `(${STRING}${STRING}I${STRING}${MAP}${INPUT_STREAM})V`, (r, _m, [self, mime, encoding, status, reason, headers, data]) => { Object.assign(r.object(self), { mime, encoding, data, status, reason, headers }); });
  for (const [name, field, sig] of [['getMimeType', 'mime', STRING], ['getEncoding', 'encoding', STRING], ['getData', 'data', INPUT_STREAM], ['getStatusCode', 'status', 'I'], ['getReasonPhrase', 'reason', STRING], ['getResponseHeaders', 'headers', MAP]]) def(RESPONSE, name, `()${sig}`, (r, _m, [self]) => r.object(self)[field] ?? null);
  for (const [name, field] of [['setMimeType', 'mime'], ['setEncoding', 'encoding'], ['setData', 'data'], ['setResponseHeaders', 'headers']]) def(RESPONSE, name, `(${name === 'setData' ? INPUT_STREAM : name === 'setResponseHeaders' ? MAP : STRING})V`, (r, _m, [self, value]) => { r.object(self)[field] = value; });
  def(RESPONSE, 'setStatusCodeAndReasonPhrase', `(I${STRING})V`, (r, _m, [self, status, reason]) => { Object.assign(r.object(self), { status, reason }); });
  const LEVELS = ['TIP', 'LOG', 'WARNING', 'ERROR', 'DEBUG'];
  const levelValue = (r, name) => { const table = levelValues.get(r) ?? levelValues.set(r, gcRoot(new Map())).get(r); if (!table.has(name)) { const ref = r.makeObject(LEVEL), o = r.object(ref); o.enumName = name; o.enumOrdinal = LEVELS.indexOf(name); table.set(name, ref); } return table.get(name); };
  const levelValues = new WeakMap();
  for (const name of LEVELS) registry.staticField(LEVEL, name, LEVEL, r => levelValue(r, name));
  def(LEVEL, 'values', `()[${LEVEL}`, r => { const a = r.newArray(`[${LEVEL}`, LEVELS.length); r.array(a).elements = LEVELS.map(n => levelValue(r, n)); return a; }, { static: true });
  def(CONSOLE, '<init>', `(${STRING}${STRING}I${LEVEL})V`, (r, _m, [self, message, source, line, level]) => { Object.assign(r.object(self), { message, source, line, level }); });
  for (const [name, field, sig] of [['message', 'message', STRING], ['sourceId', 'source', STRING], ['lineNumber', 'line', 'I'], ['messageLevel', 'level', LEVEL]]) def(CONSOLE, name, `()${sig}`, (r, _m, [self]) => r.object(self)[field] ?? null);
  def(JS_RESULT, 'confirm', '()V', (r, _m, [self]) => { const o = r.object(self); o.settled = true; o.value = true; o.onResult?.(true, null); });
  def(JS_RESULT, 'cancel', '()V', (r, _m, [self]) => { const o = r.object(self); o.settled = true; o.value = false; o.onResult?.(false, null); });
  def(JS_PROMPT, 'confirm', `(${STRING})V`, (r, _m, [self, text]) => { const o = r.object(self); o.settled = true; o.value = true; o.onResult?.(true, isNull(text) ? null : r.stringCharacters(text)); });
  const storage = gcRoot({ instance: null });
  def(STORAGE, 'getInstance', `()${STORAGE}`, r => storage.instance ??= r.allocate(STORAGE), { static: true });
  // WebStorage: the DOM storage (localStorage) the profile keeps per origin for documents the lab serves (src/webview-backend.js). Answers reach the callbacks on the main Looper.
  const domStorage = () => profile.storage ??= new Map();
  const usage = origin => { let size = 0; for (const [k, v] of domStorage().get(origin) ?? []) size += 2 * (k.length + v.length); return size; };
  const boxLong = (r, v) => staticCall(r, 'Ljava/lang/Long;', 'valueOf', ['J'], 'Ljava/lang/Long;', [BigInt(v)]);
  const answer = (r, callback, make) => { if (!isNull(callback)) postMain(r, () => call(r, callback, CALLBACK, 'onReceiveValue', [OBJECT], 'V', [make()]), [callback]); };
  def(STORAGE, 'deleteAllData', '()V', () => { domStorage().clear(); });
  def(STORAGE, 'deleteOrigin', `(${STRING})V`, (r, _m, [, origin]) => { const key = originOf(r, origin); if (key) domStorage().delete(key); });
  def(STORAGE, 'getUsageForOrigin', `(${STRING}${CALLBACK})V`, (r, _m, [, origin, callback]) => { const key = originOf(r, origin); answer(r, callback, () => boxLong(r, key ? usage(key) : 0)); });
  def(STORAGE, 'getQuotaForOrigin', `(${STRING}${CALLBACK})V`, (r, _m, [, , callback]) => { answer(r, callback, () => boxLong(r, 5 * 1024 * 1024 * 2)); });
  const ORIGIN_T = 'Landroid/webkit/WebStorage$Origin;'; type(ORIGIN_T, OBJECT, [], { allocatable: true });
  def(ORIGIN_T, 'getOrigin', `()${STRING}`, (r, _m, [self]) => r.object(self).origin); def(ORIGIN_T, 'getUsage', '()J', (r, _m, [self]) => BigInt(usage(r.object(self).origin))); def(ORIGIN_T, 'getQuota', '()J', () => BigInt(5 * 1024 * 1024 * 2));
  def(STORAGE, 'getOrigins', `(${CALLBACK})V`, (r, _m, [, callback]) => {
    answer(r, callback, () => {
      const map = r.allocate('Ljava/util/HashMap;'); r.dispatch({ owner: 'Ljava/util/HashMap;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [map], 'direct');
      for (const origin of domStorage().keys()) { const ref = r.makeObject(ORIGIN_T); r.object(ref).origin = origin; call(r, map, MAP, 'put', [OBJECT, OBJECT], OBJECT, [origin, ref]); }
      return map;
    });
  });
  type(JS_INTERFACE, 'Ljava/lang/Object;');

  // ---- @JavascriptInterface objects (phase 2: the bridge calls them asynchronously; return values wait for the synchronous bridge of phase 3) -----------------------------------
  /** The public instance methods of `object` that a page may call: annotated with @JavascriptInterface (every public method below targetSdk 17, as Android). */
  const interfaceMethods = (r, object) => {
    const out = [], seen = new Set(), annotatedOnly = (platform.targetSdk ?? 34) >= 17;
    for (let type = r.object(object).type; type && type !== OBJECT && r.classes.has(type); type = r.parent(type)) {
      for (const [key, def] of r.classes.get(type).methods) {
        if (seen.has(key) || (def.flags & 0x1) === 0 || (def.flags & 0x8) !== 0 || def.method.name === '<init>' || def.method.name === '<clinit>') continue;
        seen.add(key);
        const annotated = def.method.dex ? def.method.dex.memberAnnotations({ method: def.method }).some(a => a.type === JS_INTERFACE) : false;
        if (annotated || !annotatedOnly) out.push(def.method);
      }
    }
    return out;
  };
  /** { name: [method names] } for the interfaces registered on a WebView: what the page bridge defines on `window`. */
  const interfaceDescriptors = (r, state) => {
    const out = {};
    for (const [name, object] of state.interfaces) if (isInterfaceName(name)) out[name] = [...new Set(interfaceMethods(r, object).map(m => m.name))].sort();
    return out;
  };
  // Chromium's Java bridge (gin_java_bridge: CoerceJavaScript*ToJavaValue). It does not follow LiveConnect where that would guess: a number becomes a boolean false, a string
  // becomes the number 0, undefined becomes the String "undefined" (null stays null) and so does any object; numbers saturate into int and long and are then narrowed.
  const wired = value => (value !== null && typeof value === 'object' ? (value.u ? 'undefined' : Array.isArray(value.a) ? 'array' : 'object') : value === null ? 'null' : typeof value);
  const toInt = number => (Number.isNaN(number) ? 0 : Math.max(-2147483648, Math.min(2147483647, Math.trunc(number))));
  const numberText = number => (Number.isInteger(number) ? String(number) : Number.isFinite(number) ? String(Number(number.toPrecision(6))) : Number.isNaN(number) ? 'NaN' : number > 0 ? 'Inf' : '-Inf');
  const coerce = (r, type, value) => {
    const kind = wired(value);
    switch (type) {
      case 'Z': return value === true ? 1 : 0;
      case 'B': return kind === 'number' ? (toInt(value) << 24) >> 24 : 0;
      case 'S': return kind === 'number' ? (toInt(value) << 16) >> 16 : 0;
      case 'I': return kind === 'number' ? toInt(value) : 0;
      case 'C': return kind === 'number' && Number.isInteger(value) ? value & 0xffff : 0;
      case 'J': return kind === 'number' && !Number.isNaN(value) ? BigInt.asIntN(64, BigInt(Math.trunc(Math.max(-9223372036854775808, Math.min(9223372036854775807, value))))) : 0n;
      case 'F': return floatBits(kind === 'number' ? value : 0);
      case 'D': return doubleBits(kind === 'number' ? value : 0);
      case STRING:   // a String parameter takes the text of any value; null stays null; undefined, objects and arrays are "undefined" (Chromium, not LiveConnect's toString)
        if (kind === 'string') return value; if (kind === 'null') return null;
        return kind === 'number' ? numberText(value) : kind === 'boolean' ? String(value) : 'undefined';
      default: {
        if (kind !== 'array' || type[0] !== '[' || !(/^\[[ZBSIJFDC]$/.test(type) || type === `[${STRING}`)) return null;   // a Java object or an array of them cannot be made from a JavaScript value
        const element = type.slice(1), array = r.newArray(type, value.a.length), converted = value.a.map(item => coerce(r, element, item));
        r.array(array).elements = element === 'F' ? converted : element === 'D' ? converted.map(bits => BigInt.asIntN(64, typeof bits === 'bigint' ? bits : BigInt(bits))) : converted;
        return array;
      }
    }
  };
  /**
   * Calls `name(args)` of the interface `object` the way the bridge does: by name and argument count among the annotated public methods, arguments converted to the parameter
   * types (numbers truncated, booleans, strings; objects become null). Returns { called, result } (result is the Java return type's descriptor), never throws into the VM:
   * a Java exception is reported to the caller as { error }.
   */
  const invokeInterface = (r, object, method, args) => {
    const candidates = interfaceMethods(r, object).filter(m => m.name === method && m.parameters.length === args.length);
    if (!candidates.length) return { called: false };
    const target = candidates[0];
    try { r.dispatch(target, r.argumentWords(target.parameters, target.parameters.map((p, i) => coerce(r, p, args[i])), { receiver: object }), 'virtual'); }
    catch (error) { if (error?.name === 'JavaException') return { called: true, result: target.result, error: r.object(error.value).type }; throw error; }
    return { called: true, result: target.result };
  };
  const consoleMessage = (r, text, source, line, name) => {
    const ref = r.allocate(CONSOLE);
    r.dispatch({ owner: CONSOLE, name: '<init>', parameters: [STRING, STRING, 'I', LEVEL], result: 'V', signature: `(${STRING}${STRING}I${LEVEL})V` }, [ref, text, source, line, levelValue(r, name)], 'direct');
    return ref;
  };
  const jsResult = (r, prompt = false) => { const ref = r.allocate(prompt ? JS_PROMPT : JS_RESULT); return ref; };

  // ---- requests of a document that only the app can answer (the page bridge reports them; `done` carries the app's answer back) -----------------------------------------------------
  const GEO_CALLBACK = 'Landroid/webkit/GeolocationPermissions$Callback;', LAB_GEO_CALLBACK = 'Llab/webkit/LabGeolocationCallback;', PERMISSION = 'Landroid/webkit/PermissionRequest;', LAB_PERMISSION = 'Llab/webkit/LabPermissionRequest;',
    CHOOSER = 'Landroid/webkit/WebChromeClient$FileChooserParams;', LAB_CHOOSER = 'Llab/webkit/LabFileChooserParams;', LAB_CALLBACK = 'Llab/webkit/LabValueCallback;', INTENT = 'Landroid/content/Intent;', URI_T = 'Landroid/net/Uri;';
  type(GEO_CALLBACK, OBJECT); type(LAB_GEO_CALLBACK, OBJECT, [GEO_CALLBACK], { allocatable: true }); type(PERMISSION, OBJECT); type(LAB_PERMISSION, PERMISSION, [], { allocatable: true });
  type(CHOOSER, OBJECT); type(LAB_CHOOSER, CHOOSER, [], { allocatable: true }); type(LAB_CALLBACK, OBJECT, [CALLBACK], { allocatable: true });
  const settle = (r, ref, ...values) => { const o = r.object(ref); if (o.settled) return; o.settled = true; o.done?.(...values); };
  /** navigator.geolocation: a stored decision of GeolocationPermissions answers at once; otherwise WebChromeClient.onGeolocationPermissionsShowPrompt decides (a client that never invokes the callback leaves the page waiting, as on Android). */
  const geolocationPrompt = (r, self, state, origin, done) => {
    if (!settingsOf(r, self) || !setting(r, state.settings, 'GeolocationEnabled')) { done(false); return; }
    if (profile.origins.has(origin)) { done(profile.origins.get(origin) === true); return; }
    const ref = r.makeObject(LAB_GEO_CALLBACK); r.object(ref).done = (allow, retain) => { if (retain) profile.origins.set(origin, !!allow); done(!!allow); };
    chromeCall(r, state, 'onGeolocationPermissionsShowPrompt', [STRING, GEO_CALLBACK], 'V', [origin, ref]);
  };
  def(LAB_GEO_CALLBACK, 'invoke', `(${STRING}ZZ)V`, (r, _m, [self, , allow, retain]) => settle(r, self, !!allow, !!retain));
  /** getUserMedia: WebChromeClient.onPermissionRequest decides; a client that does not override it denies (AOSP's default calls request.deny()). */
  const RESOURCES = { video: 'android.webkit.resource.VIDEO_CAPTURE', audio: 'android.webkit.resource.AUDIO_CAPTURE' };
  const permissionRequest = (r, self, state, origin, kinds, done) => {
    const ref = r.makeObject(LAB_PERMISSION), o = r.object(ref); o.origin = origin; o.resources = kinds.filter(kind => RESOURCES[kind]).map(kind => RESOURCES[kind]); o.done = done;
    if (isNull(state.chrome)) { settle(r, ref, false); return; }
    chromeCall(r, state, 'onPermissionRequest', [PERMISSION], 'V', [ref]);
  };
  for (const [name, value] of [['RESOURCE_VIDEO_CAPTURE', RESOURCES.video], ['RESOURCE_AUDIO_CAPTURE', RESOURCES.audio], ['RESOURCE_PROTECTED_MEDIA_ID', 'android.webkit.resource.PROTECTED_MEDIA_ID'], ['RESOURCE_MIDI_SYSEX', 'android.webkit.resource.MIDI_SYSEX']]) registry.staticField(PERMISSION, name, STRING, () => value);
  def(PERMISSION, '<init>', '()V', () => undefined);
  def(LAB_PERMISSION, 'getOrigin', `()${URI_T}`, (r, _m, [self]) => uriOf(r, r.object(self).origin));
  def(LAB_PERMISSION, 'getResources', `()[${STRING}`, (r, _m, [self]) => { const list = r.object(self).resources, a = r.newArray(`[${STRING}`, list.length); r.array(a).elements = [...list]; return a; });
  def(LAB_PERMISSION, 'grant', `([${STRING})V`, (r, _m, [self, resources]) => settle(r, self, !isNull(resources) && r.array(resources).elements.length > 0));
  def(LAB_PERMISSION, 'deny', '()V', (r, _m, [self]) => settle(r, self, false));
  /**
   * <input type=file>: WebChromeClient.onShowFileChooser picks. The app answers the ValueCallback with content Uris (usually from the device's document picker); their bytes are read
   * through the app's ContentResolver and handed to the input. A client that returns false, or answers null, selects nothing.
   */
  const MAX_CHOSEN_BYTES = 16 * 1024 * 1024;
  const fileChooser = (r, self, state, { accept, multiple, capture }, done) => {
    const params = r.makeObject(LAB_CHOOSER); Object.assign(r.object(params), { accept: accept.split(',').map(t => t.trim()).filter(Boolean), multiple, capture });
    const callback = r.makeObject(LAB_CALLBACK);
    r.object(callback).done = uris => {
      const files = [];
      if (!isNull(uris)) {
        const context = call(r, self, VIEW, 'getContext', [], CONTEXT, []), resolver = call(r, context, CONTEXT, 'getContentResolver', [], 'Landroid/content/ContentResolver;', []);
        for (const uri of r.array(uris).elements.slice(0, multiple ? 32 : 1)) {
          if (isNull(uri)) continue;
          const stream = call(r, resolver, 'Landroid/content/ContentResolver;', 'openInputStream', [URI_T], INPUT_STREAM, [uri]); if (isNull(stream)) continue;
          const read = readResponseBytes(r, stream, MAX_CHOSEN_BYTES); if (read.tooLarge) { r.record(`LOG W chromium: a chosen file is larger than ${MAX_CHOSEN_BYTES} bytes and was not handed to the page`); continue; }
          const type = call(r, resolver, 'Landroid/content/ContentResolver;', 'getType', [URI_T], STRING, [uri]), name = call(r, uri, URI_T, 'getLastPathSegment', [], STRING, []);
          const text = v => (isNull(v) ? '' : typeof v === 'string' ? v : r.stringCharacters(v));
          files.push({ name: text(name).split('/').pop() || 'file', type: text(type), bytes: read.bytes });
        }
      }
      done(files);
    };
    const handled = chromeCall(r, state, 'onShowFileChooser', [WEBVIEW, CALLBACK, CHOOSER], 'Z', [self, callback, params]);
    if (!handled) settle(r, callback, null);
  };
  def(LAB_CALLBACK, 'onReceiveValue', `(${OBJECT})V`, (r, _m, [self, value]) => settle(r, self, value));
  for (const [name, value] of [['MODE_OPEN', 0], ['MODE_OPEN_MULTIPLE', 1], ['MODE_OPEN_FOLDER', 2], ['MODE_SAVE', 3]]) registry.staticField(CHOOSER, name, 'I', () => value);
  def(CHOOSER, '<init>', '()V', () => undefined);
  def(LAB_CHOOSER, 'getMode', '()I', (r, _m, [self]) => (r.object(self).multiple ? 1 : 0));
  def(LAB_CHOOSER, 'getAcceptTypes', `()[${STRING}`, (r, _m, [self]) => { const list = r.object(self).accept, a = r.newArray(`[${STRING}`, list.length); r.array(a).elements = [...list]; return a; });
  def(LAB_CHOOSER, 'isCaptureEnabled', '()Z', (r, _m, [self]) => (r.object(self).capture ? 1 : 0));
  def(LAB_CHOOSER, 'getTitle', '()Ljava/lang/CharSequence;', () => null); def(LAB_CHOOSER, 'getFilenameHint', `()${STRING}`, () => null);
  // Chromium's FileChooserParams.createIntent: ACTION_GET_CONTENT, openable, the first accepted type (or */*), every accepted type as EXTRA_MIME_TYPES, EXTRA_ALLOW_MULTIPLE
  def(LAB_CHOOSER, 'createIntent', `()${INTENT}`, (r, _m, [self]) => {
    const o = r.object(self), intent = r.allocate(INTENT), mimes = o.accept.filter(t => t.includes('/'));
    r.dispatch({ owner: INTENT, name: '<init>', parameters: [STRING], result: 'V', signature: `(${STRING})V` }, [intent, 'android.intent.action.GET_CONTENT'], 'direct');
    call(r, intent, INTENT, 'addCategory', [STRING], INTENT, ['android.intent.category.OPENABLE']); call(r, intent, INTENT, 'setType', [STRING], INTENT, [mimes[0] ?? '*/*']);
    if (mimes.length > 1) { const a = r.newArray(`[${STRING}`, mimes.length); r.array(a).elements = [...mimes]; call(r, intent, INTENT, 'putExtra', [STRING, `[${STRING}`], INTENT, ['android.intent.extra.MIME_TYPES', a]); }
    if (o.multiple) call(r, intent, INTENT, 'putExtra', [STRING, 'Z'], INTENT, ['android.intent.extra.ALLOW_MULTIPLE', 1]);
    return intent;
  });
  // FileChooserParams.parseResult (AOSP): RESULT_OK with data -> the Uri of the Intent, or every Uri of its ClipData
  def(CHOOSER, 'parseResult', `(I${INTENT})[${URI_T}`, (r, _m, [resultCode, intent]) => {
    if (resultCode !== -1 || isNull(intent)) return null;
    const uris = [], data = call(r, intent, INTENT, 'getData', [], URI_T, []), clip = call(r, intent, INTENT, 'getClipData', [], 'Landroid/content/ClipData;', []);
    if (!isNull(data)) uris.push(data);
    else if (!isNull(clip)) { const count = call(r, clip, 'Landroid/content/ClipData;', 'getItemCount', [], 'I', []); for (let i = 0; i < count; i++) { const uri = call(r, call(r, clip, 'Landroid/content/ClipData;', 'getItemAt', ['I'], 'Landroid/content/ClipData$Item;', [i]), 'Landroid/content/ClipData$Item;', 'getUri', [], URI_T, []); if (!isNull(uri)) uris.push(uri); } }
    if (!uris.length) return null;
    const a = r.newArray(`[${URI_T}`, uris.length); r.array(a).elements = uris; return a;
  }, { static: true });

  return {
    ...registry, interfaces: registry.interfacesOf,
    /** The platform's view kind for a WebView (device-view.js renders it as an iframe slot). */
    viewKind: (r, object) => (r.isSubtype(object.type, WEBVIEW) ? 'webview' : null),
    /** Snapshot payload of a WebView node: what the page needs to drive its iframe and what a diagnostic shows. */
    nodeState(r, object) {
      const s = object.webview; if (!s) return null;
      return { webviewId: s.id, url: s.url, loading: s.loading, progress: s.progress, canGoBack: s.index > 0, canGoForward: s.index >= 0 && s.index < s.history.length - 1, javascript: !!s.settings && !!r.object(s.settings).values.get('JavaScriptEnabled'), backend: !!backend(),
        document: !s.bridge || s.bridge.blank ? 'blank' : s.bridge.scriptable ? 'scriptable' : 'opaque' };
    },
    /** For the backend (phase 1): state access and the Android callbacks it triggers. */
    internals: { geolocationPrompt, permissionRequest, fileChooser, unsupported, interfaceDescriptors, interfaceMethods, invokeInterface, consoleMessage, jsResult, stateOf, postMain, clientCall, chromeCall, requestObject, errorObject, pushHistory, failLoad, settingsOf, setting, levelValue, uriOf, historyItem, unavailable, staticCall, call, overridesIntercept, intercept },
  };
}
