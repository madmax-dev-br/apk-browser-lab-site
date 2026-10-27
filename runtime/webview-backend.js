import { APKError } from './apk-error.js?v=d50f2f368405';
import { networkOf } from './network-native.js?v=d50f2f368405';
import { WEBVIEW_ERRORS } from './webview-host.js?v=d50f2f368405';
import { buildCsp } from './webview-bridge.js?v=d50f2f368405';

// The Worker's side of the WebView backend (design: docs/APK-REAL-TASKS.md, task 33). The page owns the iframes (src/webview-frame.js); this module decides what may be loaded,
// tells the page what to load (`post`), and turns the page's events (`handleEvent`) into the callbacks Android would deliver, on the VM main thread, in Android's order.
//
// Phase 1: loadUrl / loadData / loadDataWithBaseURL / postUrl, the network policy, host history, onPageStarted / onProgressChanged (0 and 100) / onPageFinished / onReceivedError.
// Phase 2: a "scriptable" document (loadData, loadDataWithBaseURL, documents of the lab's own origin: text the lab hands to the frame itself) gets the page bridge
// (src/webview-bridge.js): evaluateJavascript, @JavascriptInterface calls (void), console messages, titles, alert, shouldOverrideUrlLoading for navigations the document starts.
// A document of another origin stays opaque: the browser lets nobody script it, and everything that would need to fails explicitly (`evaluate`).

/** Directory of the lab origin a WebView may load from: documents the lab serves for that purpose. Every other lab path is refused (the WebView must not frame the lab itself). */
export const LAB_WEBVIEW_PATH = '/webview/';
const SCHEMES = new Set(['http:', 'https:']);
const WEBVIEW = 'Landroid/webkit/WebView;', STRING = 'Ljava/lang/String;', REQUEST = 'Landroid/webkit/WebResourceRequest;', CALLBACK = 'Landroid/webkit/ValueCallback;';
const CONSOLE_LEVEL = { log: 'LOG', info: 'LOG', warn: 'WARNING', error: 'ERROR', debug: 'DEBUG' }, LOG_PRIORITY = { LOG: 'I', WARNING: 'W', ERROR: 'E', DEBUG: 'D', TIP: 'I' };

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

const isHtml = mime => /^(text\/html|application\/xhtml\+xml)$/i.test(String(mime ?? '').split(';')[0].trim());
const isNull = v => v === null || v === undefined || v === 0;

/** `post(message)` sends a message to the page; `labOrigin` is the page origin (empty when there is none, e.g. tests). */
export function createWebViewBackend({ platform, post, labOrigin = '', timeoutMs = 30000 }) {
  const views = new Map();   // WebView id -> { self }
  const host = () => platform.webView.internals;
  const note = (r, key, line) => { const notes = platform.webViewNotes ??= new Set(); if (!notes.has(key)) { notes.add(key); r.record(line); } };
  const policyFor = (r, state) => {
    const network = networkOf(r), settings = state.settings ? r.object(state.settings).values : null;
    return { labOrigin, online: network.online, allowed: (hostname, port) => network.allowed(hostname, port), blockNetworkLoads: !!settings?.get('BlockNetworkLoads') };
  };
  const serial = request => ({ kind: request.kind, url: request.url, baseUrl: request.baseUrl ?? null, data: request.data ?? null, mime: request.mime ?? null, encoding: request.encoding ?? null,
    body: request.body ? Array.from(request.body) : null, headers: Object.fromEntries(request.headers ?? []) });
  /** Will the lab hand this load's text to the frame itself (so the page bridge can be put in front of it)? Loads of other origins are opaque. */
  const scriptable = request => {
    if (request.kind === 'data' || request.kind === 'dataBase') return isHtml(request.mime);
    if (request.kind === 'url' && labOrigin) { try { return new URL(request.url).origin === labOrigin; } catch { return false; } }
    return false;
  };
  const bridgeFor = (r, self, state, request, javascript) => {
    const h = host(), values = r.object(h.settingsOf(r, self)).values;
    const network = networkOf(r), base = request.baseUrl && request.baseUrl !== 'about:blank' ? request.baseUrl : (request.kind === 'url' ? request.url : '');
    return {
      csp: buildCsp({
        allowedHosts: network.online ? network.policy.allowedHosts ?? [] : [], labOrigin, labPath: LAB_WEBVIEW_PATH, javascript, blockNetworkLoads: !!values.get('BlockNetworkLoads'),
        blockNetworkImage: !!values.get('BlockNetworkImage'), loadsImages: !!values.get('LoadsImagesAutomatically'), mixedContentMode: values.get('MixedContentMode') ?? 1, pageIsHttps: !base || /^https:/i.test(base) || request.kind === 'url',
      }),
      config: { userAgent: values.get('UserAgentString'), domStorage: !!values.get('DomStorageEnabled'), textZoom: values.get('TextZoom') ?? 100, interfaces: javascript ? h.interfaceDescriptors(r, state) : {} },
    };
  };

  const backend = {
    capabilities: Object.freeze({ frame: true, bridge: true }),
    /** Start a main-frame load (loadUrl, loadData, loadDataWithBaseURL, postUrl, reload, back/forward): refuse it with Android's error, or ask the page to load it. */
    load(r, self, state, request) {
      const h = host(), display = request.displayUrl ?? request.url;
      if (/^javascript:/i.test(request.url ?? '')) { let code = request.url.slice(11); try { code = decodeURIComponent(code); } catch { /* not escaped */ } backend.evaluate(r, self, state, code, null); return; }
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
      views.set(state.id, { self, state });
      const failPending = state.bridge?.pending ?? [];   // evaluations queued for the document that is being replaced have no document to run in
      for (const pending of failPending) backend.deliver(r, self, state, pending.callback, null);
      state.bridge = { loadId, scriptable: scriptable(request), ready: false, pending: [], evals: new Map(), nextEval: 1, calls: new Map() };
      if (request.history !== 'keep' && !request.reload) h.pushHistory(state, { url: shown, originalUrl: shown, title: null, request: { ...request, history: undefined } });
      h.postMain(r, () => {
        if (state.destroyed || loadId !== state.loadId) return;
        h.clientCall(r, state, 'onPageStarted', [WEBVIEW, STRING, 'Landroid/graphics/Bitmap;'], 'V', [self, shown, null]);
        h.chromeCall(r, state, 'onProgressChanged', [WEBVIEW, 'I'], 'V', [self, 0]);
      }, [self, state.client, state.chrome]);
      const settings = h.settingsOf(r, self), values = r.object(settings).values, javascript = !!values.get('JavaScriptEnabled');
      post({ type: 'webview', op: 'load', id: state.id, loadId, request: serial(request), javascript, timeoutMs, userAgent: values.get('UserAgentString'),
        bridge: state.bridge.scriptable ? bridgeFor(r, self, state, request, javascript) : null });
    },
    stop(r, self, state) { post({ type: 'webview', op: 'stop', id: state.id }); },
    destroy(r, self, state) { post({ type: 'webview', op: 'destroy', id: state.id }); views.delete(state.id); },
    interfaceChanged() { /* an interface added or removed takes effect at the next load, as on Android */ },
    settingChanged() { /* applied at the next load: the sandbox, the policy and the bridge configuration of a document are fixed when it is created */ },
    deliver(r, self, state, callback, value) {
      if (isNull(callback)) return;
      const h = host();
      h.postMain(r, () => h.call(r, callback, CALLBACK, 'onReceiveValue', ['Ljava/lang/Object;'], 'V', [value]), [callback, self]);
    },
    /**
     * evaluateJavascript / loadUrl("javascript:..."). On a scriptable document the script runs in it and the callback receives the JSON-encoded result (Java null when the script
     * throws, as on Android). With JavaScript disabled Android gives null; a document of another origin can never be scripted, so strict mode stops with the explicit error and
     * the tolerant modes give the callback null and leave a STUB-WEBVIEW line.
     */
    evaluate(r, self, state, script, callback) {
      const bridge = state.bridge, javascript = state.settings ? !!r.object(state.settings).values.get('JavaScriptEnabled') : false;
      if (!javascript) { backend.deliver(r, self, state, callback, null); return; }
      if (bridge?.scriptable) {
        if (bridge.ready) backend.sendEval(r, self, state, script, callback); else bridge.pending.push({ script, callback });
        return;
      }
      const why = !bridge ? 'no document is loaded in this WebView, so there is nothing to script'
        : 'this document is from another origin (loadUrl of a remote page): the browser never lets the lab script it';
      const message = `android.webkit.WebView.evaluateJavascript: ${why}`;
      if (r.tolerateMissing === 'off' || r.tolerateMissing === undefined) throw new APKError(message, { kind: !bridge ? 'webview-no-document' : 'webview-cross-origin-script', method: 'evaluateJavascript' });
      note(r, 'evaluate:' + (bridge ? 'opaque' : 'none'), `STUB-WEBVIEW evaluateJavascript (${message})`);
      backend.deliver(r, self, state, callback, null);
    },
    sendEval(r, self, state, script, callback) {
      const bridge = state.bridge, evalId = bridge.nextEval++;
      if (bridge.evals.size >= 256) { backend.deliver(r, self, state, callback, null); return; }
      bridge.evals.set(evalId, callback);
      post({ type: 'webview', op: 'eval', id: state.id, loadId: bridge.loadId, evalId, script });
    },

    /** An event from the page about WebView `event.id` (called outside the VM: everything that touches Java is queued onto the main thread). */
    handleEvent(r, event) {
      const entry = views.get(event.id); if (!entry) return;
      const h = host(), state = h.stateOf(r, entry.self), self = entry.self;
      if (state.destroyed || event.loadId !== state.loadId) return;   // a stale load: the app already started another one
      const url = state.url, bridge = state.bridge, roots = [self, state.client, state.chrome];
      const queue = task => h.postMain(r, () => { if (!state.destroyed && event.loadId === state.loadId) task(); }, roots);
      switch (event.event) {
        case 'finished':
          queue(() => {
            state.loading = false; state.progress = 100;
            h.chromeCall(r, state, 'onProgressChanged', [WEBVIEW, 'I'], 'V', [self, 100]);
            h.clientCall(r, state, 'onPageFinished', [WEBVIEW, STRING], 'V', [self, url]);
            platform.requestDraw?.(r, self);
          });
          break;
        case 'error':
          queue(() => {
            state.loading = false; state.progress = 100; backend.failPending(r, self, state);
            h.clientCall(r, state, 'onReceivedError', [WEBVIEW, REQUEST, 'Landroid/webkit/WebResourceError;'], 'V', [self, h.requestObject(r, url), h.errorObject(r, event.code, event.description)]);
            h.chromeCall(r, state, 'onProgressChanged', [WEBVIEW, 'I'], 'V', [self, 100]);
            h.clientCall(r, state, 'onPageFinished', [WEBVIEW, STRING], 'V', [self, url]);
            platform.requestDraw?.(r, self);
          });
          break;
        case 'bridge-failed':   // the document loaded and, after a grace period, its bridge never connected (scripts blocked or removed): opaque after all
          queue(() => { if (bridge && bridge.scriptable && !bridge.ready) { bridge.scriptable = false; backend.failPending(r, self, state); } });
          break;
        case 'bridge-ready':
          queue(() => {
            if (!bridge || bridge.ready) return;
            bridge.ready = true;
            if (event.title && !state.title) backend.title(r, self, state, event.title);
            const pending = bridge.pending; bridge.pending = [];
            for (const item of pending) backend.sendEval(r, self, state, item.script, item.callback);
          });
          break;
        case 'eval-result':
          queue(() => {
            const callback = bridge?.evals.get(event.evalId); if (callback === undefined) return;
            bridge.evals.delete(event.evalId); backend.deliver(r, self, state, callback, event.ok ? event.json : null);
          });
          break;
        case 'title': queue(() => backend.title(r, self, state, event.title)); break;
        case 'console':
          queue(() => {
            const level = CONSOLE_LEVEL[event.level] ?? 'LOG', message = h.consoleMessage(r, event.text, event.source ?? url ?? '', event.line | 0, level);
            const handled = h.chromeCall(r, state, 'onConsoleMessage', ['Landroid/webkit/ConsoleMessage;'], 'Z', [message]);
            if (!handled) r.record(`LOG ${LOG_PRIORITY[level]} chromium: [${level === 'LOG' ? 'INFO' : level}:CONSOLE(${event.line | 0})] "${event.text}", source: ${event.source ?? url} (${event.line | 0})`);
          });
          break;
        case 'dialog':
          queue(() => {
            if (event.kind === 'alert') {
              const result = h.jsResult(r), handled = h.chromeCall(r, state, 'onJsAlert', [WEBVIEW, STRING, STRING, 'Landroid/webkit/JsResult;'], 'Z', [self, url, event.text, result]);
              if (!handled) r.record(`LOG I chromium: [alert] ${event.text}`);
            } else note(r, 'dialog:' + event.kind, `STUB-WEBVIEW ${event.kind === 'confirm' ? 'onJsConfirm' : 'onJsPrompt'} (window.${event.kind}() blocks the page until the app answers; that needs the synchronous bridge of phase 3, so the page got ${event.kind === 'confirm' ? 'false' : 'null'} and the app was not asked)`);
          });
          break;
        case 'popup':
          queue(() => note(r, 'popup', 'STUB-WEBVIEW onCreateWindow (window.open() from a WebView document: the sandbox has no allow-popups and the lab opens no second WebView; the call returned null)'));
          break;
        case 'js':
          queue(() => {
            const object = state.interfaces.get(event.name); if (object === undefined || !Array.isArray(event.args)) return;
            const outcome = h.invokeInterface(r, object, String(event.method), event.args);
            if (!outcome.called) r.record(`LOG W chromium: [WARNING:CONSOLE(0)] "Uncaught TypeError: ${event.name}.${event.method} is not a function (no @JavascriptInterface method with ${event.args.length} argument(s))"`);
            else if (outcome.error) r.record(`LOG E chromium: ${event.name}.${event.method} threw ${outcome.error.slice(1, -1).replaceAll('/', '.')}`);
            else if (outcome.result !== 'V') note(r, `return:${event.name}.${event.method}`, `STUB-WEBVIEW addJavascriptInterface (${event.name}.${event.method} returns a value; the synchronous bridge that hands it to the page arrives in phase 3, so the page received undefined)`);
          });
          break;
        case 'navigate': queue(() => backend.navigation(r, self, state, event)); break;
        default: break;
      }
      platform.onExternalActivity?.();
    },
    title(r, self, state, title) {
      if (state.title === String(title)) return;
      state.title = String(title);
      host().chromeCall(r, state, 'onReceivedTitle', [WEBVIEW, STRING], 'V', [self, state.title]);
    },
    /** Evaluations that will never run (the document went away or never became scriptable) get Java null, as Android answers a script that cannot run. */
    failPending(r, self, state) {
      const bridge = state.bridge; if (!bridge) return;
      for (const item of bridge.pending.splice(0)) backend.deliver(r, self, state, item.callback, null);
      for (const [id, callback] of [...bridge.evals]) { bridge.evals.delete(id); backend.deliver(r, self, state, callback, null); }
    },
    /** A navigation the document started: the app's shouldOverrideUrlLoading decides; if it does not take it over, it becomes a load of this WebView (policy, history and callbacks as any load). */
    navigation(r, self, state, event) {
      const h = host(), post_ = event.method === 'POST', request = h.requestObject(r, event.url, { gesture: !!event.gesture, method: post_ ? 'POST' : 'GET' });
      const overridden = h.clientCall(r, state, 'shouldOverrideUrlLoading', [WEBVIEW, REQUEST], 'Z', [self, request]);
      if (overridden) return;
      if (post_) backend.load(r, self, state, { kind: 'post', url: event.url, body: new TextEncoder().encode(event.body ?? ''), headers: new Map() });
      else backend.load(r, self, state, { kind: 'url', url: event.url, headers: new Map() });
    },
  };
  return backend;
}
