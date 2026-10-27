import { gcRoot } from './heap-gc.js?v=64078a5322f4';
import { createHostRegistry } from './host-contract.js?v=64078a5322f4';
import { APKError } from './apk-error.js?v=64078a5322f4';

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
const isNull = v => v === null || v === undefined || v === 0;
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

  // ---- per-WebView state ---------------------------------------------------------------------------------------------------------------------------------------------
  const newState = () => ({ settings: null, client: null, chrome: null, url: null, originalUrl: null, title: null, progress: 0, loading: false, history: [], index: -1, interfaces: new Map(), loadId: 0, destroyed: false, paused: false, id: null });
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
  const requestObject = (r, url, { mainFrame = true, method = 'GET', headers = new Map(), gesture = false, redirect = false } = {}) => {
    const ref = r.makeObject(LAB_REQUEST), o = r.object(ref); o.request = { url, mainFrame, method, headers, gesture, redirect }; return ref;
  };
  const errorObject = (r, code, description) => { const ref = r.makeObject(LAB_ERROR); r.object(ref).error = { code, description }; return ref; };
  const clientCall = (r, state, name, parameters, result, args, owner = CLIENT) => { if (isNull(state.client)) return undefined; return call(r, state.client, owner, name, parameters, result, args); };
  const chromeCall = (r, state, name, parameters, result, args) => { if (isNull(state.chrome)) return undefined; return call(r, state.chrome, CHROME, name, parameters, result, args); };
  /** Android's callbacks for a main-frame load that failed before any content: onPageStarted, onReceivedError, onPageFinished (all on the UI thread, in that order). */
  const failLoad = (r, self, state, url, code, description) => {
    const loadId = ++state.loadId; state.loading = true; state.originalUrl = url; state.url = url;
    postMain(r, () => {
      if (state.destroyed || loadId !== state.loadId) return;
      clientCall(r, state, 'onPageStarted', [WEBVIEW, STRING, BITMAP], 'V', [self, url, null]);
      clientCall(r, state, 'onReceivedError', [WEBVIEW, REQUEST, ERROR], 'V', [self, requestObject(r, url), errorObject(r, code, description)]);
      state.loading = false; state.progress = 100;
      clientCall(r, state, 'onPageFinished', [WEBVIEW, STRING], 'V', [self, url]);
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
    const url = `data:${type}${enc && enc !== 'base64' ? `;charset=${enc}` : ''}${enc === 'base64' ? ';base64' : ''},${body}`;
    navigate(r, self, 'loadData', { kind: 'data', data: body, mime: type, encoding: enc, url, displayUrl: url });
  });
  def(WEBVIEW, 'loadDataWithBaseURL', `(${STRING}${STRING}${STRING}${STRING}${STRING})V`, (r, _m, [self, base, data, mime, encoding, history]) => {
    const baseUrl = isNull(base) ? 'about:blank' : stringArg(r, base, 'baseUrl');
    navigate(r, self, 'loadDataWithBaseURL', { kind: 'dataBase', baseUrl, data: stringArg(r, data, 'data'), mime: isNull(mime) ? 'text/html' : stringArg(r, mime, 'mimeType'), encoding: isNull(encoding) ? null : stringArg(r, encoding, 'encoding'), historyUrl: isNull(history) ? null : stringArg(r, history, 'historyUrl'), url: baseUrl, displayUrl: baseUrl });
  });
  def(WEBVIEW, 'postUrl', `(${STRING}[B)V`, (r, _m, [self, url, body]) => navigate(r, self, 'postUrl', { kind: 'post', url: stringArg(r, url, 'url'), body: isNull(body) ? new Uint8Array(0) : Uint8Array.from(r.array(body).elements, v => v & 255) }));
  def(WEBVIEW, 'reload', '()V', (r, _m, [self]) => { const state = stateOf(r, self); if (state.url === null) return; const entry = state.history[state.index]; navigate(r, self, 'reload', { ...(entry?.request ?? { kind: 'url', url: state.url, headers: new Map() }), reload: true }); });
  def(WEBVIEW, 'stopLoading', '()V', (r, _m, [self]) => { const state = stateOf(r, self); if (!state.loading) return; state.loadId++; state.loading = false; backend()?.stop?.(r, self, state); });

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
  def(WEBVIEW, 'getScale', '()F', () => 1); def(WEBVIEW, 'getFavicon', `()${BITMAP}`, () => null);
  def(WEBVIEW, 'getSettings', `()${SETTINGS}`, (r, _m, [self]) => settingsOf(r, self));
  def(WEBVIEW, 'setWebViewClient', `(${CLIENT})V`, (r, _m, [self, client]) => { stateOf(r, self).client = isNull(client) ? null : client; });
  def(WEBVIEW, 'getWebViewClient', `()${CLIENT}`, (r, _m, [self]) => stateOf(r, self).client);
  def(WEBVIEW, 'setWebChromeClient', `(${CHROME})V`, (r, _m, [self, chrome]) => { stateOf(r, self).chrome = isNull(chrome) ? null : chrome; });
  def(WEBVIEW, 'getWebChromeClient', `()${CHROME}`, (r, _m, [self]) => stateOf(r, self).chrome);
  for (const name of ['onPause', 'onResume']) def(WEBVIEW, name, '()V', (r, _m, [self]) => { stateOf(r, self).paused = name === 'onPause'; });
  for (const name of ['pauseTimers', 'resumeTimers', 'clearCache', 'clearFormData', 'clearSslPreferences', 'freeMemory', 'clearMatches']) def(WEBVIEW, name, name === 'clearCache' ? '(Z)V' : '()V', () => undefined);
  def(WEBVIEW, 'destroy', '()V', (r, _m, [self]) => { const s = stateOf(r, self); s.destroyed = true; s.loadId++; s.loading = false; backend()?.destroy?.(r, self, s); });
  def(WEBVIEW, 'setInitialScale', '(I)V', () => undefined); def(WEBVIEW, 'setVerticalScrollbarOverlay', '(Z)V', () => undefined); def(WEBVIEW, 'setHorizontalScrollbarOverlay', '(Z)V', () => undefined);
  def(WEBVIEW, 'setNetworkAvailable', '(Z)V', () => undefined);
  def(WEBVIEW, 'getHitTestResult', `()${HIT}`, r => { const ref = r.makeObject(HIT); return ref; });
  def(HIT, 'getType', '()I', () => 0); def(HIT, 'getExtra', `()${STRING}`, () => null);
  def(WEBVIEW, 'evaluateJavascript', `(${STRING}${CALLBACK})V`, (r, _m, [self, script, callback]) => {
    const s = stateOf(r, self); stringArg(r, script, 'script');
    if (!backend()?.evaluate) {
      unavailable(r, 'evaluateJavascript');
      if (!isNull(callback)) postMain(r, () => call(r, callback, CALLBACK, 'onReceiveValue', [OBJECT], 'V', [null]), [callback, self]);
      return;
    }
    backend().evaluate(r, self, s, stringArg(r, script, 'script'), callback);
  });
  def(WEBVIEW, 'addJavascriptInterface', `(${OBJECT}${STRING})V`, (r, _m, [self, object, name]) => { if (isNull(object)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'object == null'); stateOf(r, self).interfaces.set(stringArg(r, name, 'name'), object); backend()?.interfaceChanged?.(r, self, stateOf(r, self)); });
  def(WEBVIEW, 'removeJavascriptInterface', `(${STRING})V`, (r, _m, [self, name]) => { stateOf(r, self).interfaces.delete(stringArg(r, name, 'name')); backend()?.interfaceChanged?.(r, self, stateOf(r, self)); });
  def(WEBVIEW, 'getCurrentWebViewPackage', '()Landroid/content/pm/PackageInfo;', () => null, { static: true });

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
  empty(CHROME, 'onPermissionRequest', ['Landroid/webkit/PermissionRequest;']); empty(CHROME, 'onPermissionRequestCanceled', ['Landroid/webkit/PermissionRequest;']);
  empty(CHROME, 'onConsoleMessage', [CONSOLE], 'Z', 0); empty(CHROME, 'onConsoleMessage', [STRING, 'I', STRING]);
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
  for (const name of ['deleteAllData']) def(STORAGE, name, '()V', () => undefined);
  def(STORAGE, 'getOrigins', `(${CALLBACK})V`, () => undefined); def(STORAGE, 'getUsageForOrigin', `(${STRING}${CALLBACK})V`, () => undefined); def(STORAGE, 'getQuotaForOrigin', `(${STRING}${CALLBACK})V`, () => undefined);
  def(STORAGE, 'deleteOrigin', `(${STRING})V`, () => undefined);
  type(JS_INTERFACE, 'Ljava/lang/Object;');

  return {
    ...registry, interfaces: registry.interfacesOf,
    /** The platform's view kind for a WebView (device-view.js renders it as an iframe slot). */
    viewKind: (r, object) => (r.isSubtype(object.type, WEBVIEW) ? 'webview' : null),
    /** Snapshot payload of a WebView node: what the page needs to drive its iframe and what a diagnostic shows. */
    nodeState(r, object) {
      const s = object.webview; if (!s) return null;
      return { webviewId: s.id, url: s.url, loading: s.loading, progress: s.progress, canGoBack: s.index > 0, canGoForward: s.index >= 0 && s.index < s.history.length - 1, javascript: !!s.settings && !!r.object(s.settings).values.get('JavaScriptEnabled'), backend: !!backend() };
    },
    /** For the backend (phase 1): state access and the Android callbacks it triggers. */
    internals: { stateOf, postMain, clientCall, chromeCall, requestObject, errorObject, pushHistory, failLoad, settingsOf, setting, levelValue, uriOf, historyItem, unavailable, staticCall, call },
  };
}
