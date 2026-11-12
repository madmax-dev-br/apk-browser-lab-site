// The page bridge of a scriptable WebView document (design: docs/APK-REAL-TASKS.md, task 33, phase 2): the Content-Security-Policy and the script that the page injects at the top of
// every document the lab hands to a frame itself (loadData, loadDataWithBaseURL, documents of the lab's own origin). Pure functions over strings: the Worker builds the policy and the
// configuration from WebSettings and the device's network policy, the page injects them (src/webview-frame.js).
//
// What the injected script does inside the frame (an opaque origin: `sandbox` never has allow-same-origin):
//   * connects to the page over a MessageChannel it receives after a `hello` (window.parent is the only peer; the page checks `event.source`),
//   * evaluates scripts the app sends (evaluateJavascript) and answers with the JSON-encoded result, as Android does,
//   * exposes the app's @JavascriptInterface objects as window[name].method(...) (fire and forget: the synchronous return value is phase 3),
//   * reports console output, document.title changes, alert(), and navigations the document starts (link clicks, form submits, scripted location changes),
//   * applies the WebSettings the browser cannot: DOM storage on/off, the user agent string, text zoom.

/** Names that may become window globals: identifiers only (a document must not receive `__proto__`, `constructor`, ...). */
export const isInterfaceName = name => typeof name === 'string' && /^[A-Za-z_$][\w$]{0,63}$/.test(name) && !['__proto__', 'constructor', 'prototype', 'window', 'document', 'top', 'parent', 'self', 'location', 'eval'].includes(name);

const sourceOfHost = (entry, schemes) => {
  const text = String(entry).trim().toLowerCase();
  if (!text) return [];
  if (text === '*') return ['*'];
  if (!/^(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/.test(text)) return [];   // anything that is not a plain host[:port] or *.suffix never reaches a policy
  return schemes.map(scheme => `${scheme}//${text}`);
};

/**
 * The Content-Security-Policy of a scriptable document. Network access is exactly the device's allowed hosts (and the lab's /webview/ documents); nothing else, however the page asks.
 * options: { allowedHosts, labOrigin, labPath, javascript, blockNetworkLoads, blockNetworkImage, loadsImages, mixedContentMode, pageIsHttps, online }
 */
export function buildCsp({ allowedHosts = [], labOrigin = '', labPath = '/webview/', javascript = true, blockNetworkLoads = false, blockNetworkImage = false, loadsImages = true, mixedContentMode = 1, pageIsHttps = true } = {}) {
  const schemes = mixedContentMode === 0 || !pageIsHttps ? ['http:', 'https:'] : ['https:'];   // MIXED_CONTENT_NEVER_ALLOW / COMPATIBILITY keep an https page on https
  const hosts = blockNetworkLoads ? [] : [...new Set(allowedHosts.flatMap(entry => sourceOfHost(entry, schemes)))];
  const lab = labOrigin ? [`${labOrigin}${labPath}`] : [];
  const fetchSources = [...hosts, ...lab];
  const images = !loadsImages ? [`'none'`] : ['data:', 'blob:', ...(blockNetworkImage ? lab : fetchSources)];
  const directives = [
    `default-src 'none'`,
    `script-src ${javascript ? [`'unsafe-inline'`, `'unsafe-eval'`, ...fetchSources].join(' ') : `'none'`}`,
    `style-src 'unsafe-inline' ${fetchSources.join(' ')}`.trim(),
    `img-src ${images.join(' ')}`,
    `font-src data: ${fetchSources.join(' ')}`.trim(),
    `media-src data: blob: ${fetchSources.join(' ')}`.trim(),
    `connect-src ${fetchSources.length ? fetchSources.join(' ') : `'none'`}`,
    `frame-src ${fetchSources.length ? fetchSources.join(' ') : `'none'`}`,
    `form-action ${fetchSources.length ? fetchSources.join(' ') : `'none'`}`,
    `object-src 'none'`, `worker-src 'none'`,
  ];
  return directives.join('; ');
}

const escapeAttribute = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/** `</script>` and `<!--` cannot appear inside an inline script: JSON is emitted with `<` escaped. */
const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');

/** The inline script. `config`: { loadId, userAgent, domStorage, textZoom, interfaces: { name: [method...] } } (all values data, never code). */
export function bridgeScript(config) {
  return BRIDGE.replace('__ENCODE__', () => ENCODE_SOURCE).replace('__CONFIG__', () => jsonForScript(config));
}

/** Inserts `snippet` as early as the document allows without disturbing its doctype: right after <head>, else after <html>, else after the doctype, else first. */
export function injectIntoHead(html, snippet) {
  const text = String(html);
  for (const pattern of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i]) {
    const match = pattern.exec(text);
    if (match) return text.slice(0, match.index + match[0].length) + snippet + text.slice(match.index + match[0].length);
  }
  return snippet + text;
}

/** The markup the page puts at the top of a scriptable document: CSP, then (when JavaScript is on) the bridge, then the settings styles. */
export function bridgeMarkup({ csp, config, javascript }) {
  const zoom = Number(config?.textZoom);
  const style = Number.isFinite(zoom) && zoom > 0 && zoom !== 100 ? `<style>html{-webkit-text-size-adjust:${zoom}%;text-size-adjust:${zoom}%;font-size:${zoom}%}</style>` : '';
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">${javascript ? `<script>${bridgeScript(config)}</script>` : ''}${style}`;
}

/**
 * How Android encodes the result of evaluateJavascript (Chromium: V8ValueConverter into a base::Value, then base::JSONWriter), as the source of a function `(value) => string`:
 * undefined, functions, symbols, BigInt and non-finite numbers have no value ("null" at the top level and inside arrays, the property is left out of an object); toJSON is not
 * called, so a Date, a RegExp, a Map, an Error or a DOM node is the object of its own enumerable properties (usually {}); a value met again while it is being converted (a cycle)
 * is null; nesting stops at 100 levels; "<" is written as \\u003C and control characters as \\u00XX.
 */
export const ENCODE_SOURCE = `function (value) {
  var seen = [], HEX = '0123456789ABCDEF';
  function str(s) {
    var out = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 34) out += '\\\\"'; else if (c === 92) out += '\\\\\\\\'; else if (c === 8) out += '\\\\b'; else if (c === 12) out += '\\\\f'; else if (c === 10) out += '\\\\n'; else if (c === 13) out += '\\\\r'; else if (c === 9) out += '\\\\t';
      else if (c < 32 || c === 60 || c === 0x2028 || c === 0x2029) out += '\\\\u' + HEX[c >> 12 & 15] + HEX[c >> 8 & 15] + HEX[c >> 4 & 15] + HEX[c & 15];
      else if (c >= 0xd800 && c <= 0xdfff) { var n = s.charCodeAt(i + 1); if (c <= 0xdbff && n >= 0xdc00 && n <= 0xdfff) { out += s.charAt(i) + s.charAt(i + 1); i++; } else out += String.fromCharCode(0xfffd); }
      else out += s.charAt(i);
    }
    return out + '"';
  }
  function conv(v, depth) {
    if (v === null) return 'null';
    var t = typeof v;
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'number') return isFinite(v) ? String(v) : undefined;
    if (t === 'string') return str(v);
    if (t !== 'object') return undefined;
    if (depth > 100) return undefined;
    if (seen.indexOf(v) >= 0) return 'null';
    seen.push(v);
    var parts = [], i, child;
    try {
      if (Array.isArray(v)) { for (i = 0; i < v.length; i++) { child = conv(v[i], depth + 1); parts.push(child === undefined ? 'null' : child); } return '[' + parts.join(',') + ']'; }
      var keys = Object.keys(v);
      for (i = 0; i < keys.length; i++) { child = conv(v[keys[i]], depth + 1); if (child !== undefined) parts.push(str(keys[i]) + ':' + child); }
      return '{' + parts.join(',') + '}';
    } catch (e) { return undefined; } finally { seen.pop(); }
  }
  var out = conv(value, 0);
  return out === undefined ? 'null' : out;
}`;
/** The encoder as a function (the document engine without a browser and the tests use it; the bridge carries its source). */
export const encodeResult = new Function('return ' + ENCODE_SOURCE)();

const BRIDGE = `(function () {
  'use strict';
  var C = __CONFIG__, encode = __ENCODE__, port = null, queue = [], consoleCount = 0, calls = 0, helloTries = 0, waiting = {}, R = C.resolve || null;
  function post(message) { if (port) { try { port.postMessage(message); } catch (e) { /* the page is gone */ } } else if (queue.length < 500) queue.push(message); }
  function text(value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message || String(value);
    try { var s = JSON.stringify(value); return s === undefined ? String(value) : s; } catch (e) { return String(value); }
  }
  function limit(s, n) { s = String(s); return s.length > n ? s.slice(0, n) : s; }
  function hello() {
    if (port || helloTries++ > 5) return;
    try { parent.postMessage({ apkwebBridge: 'hello', loadId: C.loadId }, '*'); } catch (e) { /* no parent */ }
    setTimeout(hello, 150 * helloTries);
  }
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (port || event.source !== parent || !data || data.apkwebBridge !== 'port' || data.loadId !== C.loadId || !event.ports || !event.ports[0]) return;
    port = event.ports[0]; port.onmessage = onCommand;
    post({ t: 'ready' });
    var pending = queue; queue = []; pending.forEach(post);
  });
  var commands = {};
  function onCommand(event) {
    var data = event.data;
    if (data && data.t === 'resource-result') { var waiter = waiting[data.rid]; if (waiter) { delete waiting[data.rid]; waiter(data); } return; }
    if (data && data.t === 'call' && typeof data.name === 'string' && Object.prototype.hasOwnProperty.call(commands, data.name)) { try { commands[data.name](data); } catch (e) { /* a command the document made impossible */ } return; }
    if (!data || data.t !== 'eval') return;
    try { var value = (0, eval)(String(data.script)); post({ t: 'eval-result', evalId: data.evalId, ok: true, json: limit(encode(value), 1048576) }); }
    catch (error) { post({ t: 'eval-result', evalId: data.evalId, ok: false, json: null }); }
  }
  /* console: Chromium's levels, mirrored to the app's WebChromeClient */
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      if (consoleCount++ < 1000) { try { post({ t: 'console', level: level, text: limit(Array.prototype.map.call(arguments, text).join(' '), 4096), source: location.href, line: 0 }); } catch (e) { /* never break the page for logging */ } }
      return original && original.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (event) { if (consoleCount++ < 1000) post({ t: 'console', level: 'error', text: limit('Uncaught ' + (event.message || 'error'), 4096), source: String(event.filename || location.href), line: event.lineno | 0 }); });
  window.addEventListener('unhandledrejection', function (event) { if (consoleCount++ < 1000) post({ t: 'console', level: 'error', text: limit('Uncaught (in promise) ' + text(event.reason), 4096), source: location.href, line: 0 }); });
  /* title */
  /* The document is "committed" for the app once it is parsed and its DOMContentLoaded listeners ran: a navigation it starts from there reaches the app first, as on Android
     (shouldOverrideUrlLoading is asked before the Looper delivers onPageStarted of a document that navigates away while it loads). Titles are reported from then on. */
  var lastTitle = null, dom = false;
  function title() { if (!dom) return; var t = document.title || ''; if (t !== lastTitle) { lastTitle = t; post({ t: 'title', title: limit(t, 1024) }); } }
  function domReady() { if (dom) return; dom = true; lastTitle = document.title || ''; post({ t: 'dom', title: limit(lastTitle, 1024) }); metrics(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(domReady, 0); }); else setTimeout(domReady, 0);
  try { new MutationObserver(title).observe(document, { childList: true, subtree: true, characterData: true }); } catch (e) { /* no observer */ }
  /* scroll position and content size (WebView.getScrollX/Y, getContentHeight), in CSS pixels = dp */
  var lastMetrics = '', metricsTimer = null;
  function metrics() {
    metricsTimer = null; if (!dom) return;
    var e = document.documentElement || {}, b = document.body || {};
    var m = { t: 'metrics', x: Math.round(window.scrollX || 0), y: Math.round(window.scrollY || 0), width: Math.max(e.scrollWidth || 0, b.scrollWidth || 0), height: Math.max(e.scrollHeight || 0, b.scrollHeight || 0), viewWidth: window.innerWidth || 0, viewHeight: window.innerHeight || 0 };
    var key = JSON.stringify(m); if (key !== lastMetrics) { lastMetrics = key; post(m); }
  }
  function metricsSoon() { if (metricsTimer === null) metricsTimer = setTimeout(metrics, 50); }
  window.addEventListener('scroll', metricsSoon, true); window.addEventListener('resize', metricsSoon); window.addEventListener('load', metricsSoon);
  commands.scrollTo = function (d) { window.scrollTo(Number(d.x) || 0, Number(d.y) || 0); metrics(); };
  commands.scrollBy = function (d) { window.scrollBy(Number(d.x) || 0, Number(d.y) || 0); metrics(); };
  /* WebView.postWebMessage: a MessageEvent on the window, with the origin of the app's side empty as on Android */
  commands.message = function (d) { window.dispatchEvent(new MessageEvent('message', { data: String(d.data), origin: '' })); };
  /* WebView.findAllAsync / findNext / clearMatches: the matches of the document's text, highlighted where the browser has the CSS Custom Highlight API */
  var found = [], active = -1;
  function paint() {
    try {
      if (!window.CSS || !CSS.highlights || typeof Highlight !== 'function') return;
      CSS.highlights.delete('apkweb-find'); CSS.highlights.delete('apkweb-find-active');
      if (!found.length) return;
      CSS.highlights.set('apkweb-find', new (Function.prototype.bind.apply(Highlight, [null].concat(found)))());
      if (found[active]) { CSS.highlights.set('apkweb-find-active', new Highlight(found[active])); var el = found[active].startContainer.parentElement; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
    } catch (e) { /* highlighting is cosmetic */ }
  }
  commands.find = function (d) {
    found = []; active = -1;
    var needle = String(d.text || '').toLowerCase();
    if (needle && document.body) {
      var walker = document.createTreeWalker(document.body, 4), node;
      while ((node = walker.nextNode()) && found.length < 1000) {
        var parent = node.parentElement; if (parent && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.tagName)) continue;
        var hay = node.nodeValue.toLowerCase(), at = hay.indexOf(needle);
        while (at >= 0 && found.length < 1000) { var range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + needle.length); found.push(range); at = hay.indexOf(needle, at + needle.length); }
      }
      if (found.length) active = 0;
    }
    paint(); post({ t: 'find', fid: d.fid | 0, active: Math.max(active, 0), count: found.length });
  };
  commands.findNext = function (d) { if (found.length) { active = (active + (d.forward === false ? found.length - 1 : 1)) % found.length; paint(); } post({ t: 'find', fid: d.fid | 0, active: Math.max(active, 0), count: found.length }); };
  commands.clearMatches = function () { found = []; active = -1; paint(); };
  try { var findStyle = document.createElement('style'); findStyle.textContent = '::highlight(apkweb-find){background:#ffff00;color:#000}::highlight(apkweb-find-active){background:#ff9632;color:#000}'; (document.head || document.documentElement).appendChild(findStyle); } catch (e) { /* no style */ }
  /* dialogs: no allow-modals in the sandbox, so alert is reported and does not block; confirm and prompt need the synchronous bridge */
  window.alert = function (message) { post({ t: 'dialog', kind: 'alert', text: limit(message === undefined ? '' : message, 4096) }); };
  window.confirm = function (message) { post({ t: 'dialog', kind: 'confirm', text: limit(message === undefined ? '' : message, 4096) }); return false; };
  window.prompt = function (message, value) { post({ t: 'dialog', kind: 'prompt', text: limit(message === undefined ? '' : message, 4096), value: limit(value === undefined ? '' : value, 4096) }); return null; };
  window.open = function (url) { var u = url === undefined || url === '' ? 'about:blank' : absolute(url) || String(url); post({ t: 'popup', url: limit(u, 8192), gesture: !!(navigator.userActivation && navigator.userActivation.isActive) }); return null; };
  /* @JavascriptInterface objects. An argument travels as Android's Java bridge sees it: a string, a number, a boolean, null, undefined ({ u: 1 }), an array of those ({ a: [...] }),
     or some other object ({ o: 1 }: Java receives null, or "undefined" for a String parameter). */
  function wire(a) {
    if (a === null) return null;
    var t = typeof a;
    if (t === 'string') return limit(a, 65536);
    if (t === 'number' || t === 'boolean') return a;
    if (t === 'undefined') return { u: 1 };
    if (Array.isArray(a)) return { a: Array.prototype.slice.call(a, 0, 4096).map(function (v) { return v === null ? null : typeof v === 'string' ? limit(v, 65536) : typeof v === 'number' || typeof v === 'boolean' ? v : typeof v === 'undefined' ? { u: 1 } : { o: 1 }; }) };
    return { o: 1 };
  }
  var names = C.interfaces || {};
  Object.keys(names).forEach(function (name) {
    if (!/^[A-Za-z_$][\\w$]{0,63}$/.test(name) || name === '__proto__' || name === 'constructor') return;
    var object = {};
    (names[name] || []).forEach(function (method) {
      Object.defineProperty(object, method, { enumerable: true, value: function () {
        if (++calls > 5000) return undefined;
        post({ t: 'js', name: name, method: method, args: Array.prototype.slice.call(arguments, 0, 32).map(wire) });
        return undefined;
      } });
    });
    try { Object.defineProperty(window, name, { value: object, configurable: true, writable: false, enumerable: false }); } catch (e) { /* a name the document already owns */ }
  });
  /* DOM storage: off means null (as in Android), on means an in-memory Storage (an opaque origin has no persistent one) */
  function memoryStorage() {
    var data = Object.create(null), api = {
      getItem: function (k) { k = String(k); return k in data ? data[k] : null; }, setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; }, clear: function () { data = Object.create(null); }, key: function (i) { return Object.keys(data)[i] === undefined ? null : Object.keys(data)[i]; }
    };
    Object.defineProperty(api, 'length', { get: function () { return Object.keys(data).length; } });
    return api;
  }
  /* DOM storage belongs to the origin of the document's URL, kept by the lab's WebView profile (the frame itself is an opaque origin with no storage): the values arrive with
     the document and every change is reported. A document with no origin of its own (loadData, about:blank) has none, and reading the property throws as in Chromium. */
  var S = C.storage || null;
  function profileStorage(area, initial) {
    var data = Object.create(null), k;
    for (k in initial) if (Object.prototype.hasOwnProperty.call(initial, k)) data[k] = String(initial[k]);
    var api = {
      getItem: function (key) { key = String(key); return key in data ? data[key] : null; },
      setItem: function (key, value) { key = String(key); value = String(value); data[key] = value; post({ t: 'storage', area: area, op: 'set', key: limit(key, 4096), value: limit(value, 1048576) }); },
      removeItem: function (key) { key = String(key); if (key in data) { delete data[key]; post({ t: 'storage', area: area, op: 'remove', key: limit(key, 4096) }); } },
      clear: function () { data = Object.create(null); post({ t: 'storage', area: area, op: 'clear' }); }, key: function (i) { var keys = Object.keys(data); return keys[i] === undefined ? null : keys[i]; }
    };
    Object.defineProperty(api, 'length', { get: function () { return Object.keys(data).length; } });
    return api;
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try {
      var area = name === 'localStorage' ? 'local' : 'session', value = !C.domStorage ? null : S ? profileStorage(area, S[area] || {}) : undefined;
      Object.defineProperty(window, name, { configurable: true, get: function () {
        if (value === undefined) throw new DOMException("Failed to read the '" + name + "' property from 'Window': Storage is disabled inside 'data:' URLs.", 'SecurityError');
        return value;
      } });
    } catch (e) { /* not definable */ }
  });
  /* document.cookie: the cookies of the lab's CookieManager for the document's URL (not the browser's jar, which an opaque origin cannot use); assignments go to the CookieManager */
  if (C.cookies) (function () {
    var jar = Object.create(null);
    String(C.cookies.value || '').split(/;\\s*/).forEach(function (pair) { var at = pair.indexOf('='); if (pair) jar[at < 0 ? '' : pair.slice(0, at)] = at < 0 ? pair : pair.slice(at + 1); });
    try {
      Object.defineProperty(document, 'cookie', { configurable: true,
        get: function () { return Object.keys(jar).map(function (name) { return name === '' ? jar[name] : name + '=' + jar[name]; }).join('; '); },
        set: function (text) {
          text = String(text); if (!C.cookies.accept) return;
          var parts = text.split(';'), first = parts[0].trim(), at = first.indexOf('='), name = at < 0 ? '' : first.slice(0, at).trim(), value = at < 0 ? first : first.slice(at + 1).trim(), gone = false;
          for (var i = 1; i < parts.length; i++) {
            var attribute = parts[i].trim().toLowerCase();
            if (/^max-age=/.test(attribute) && Number(attribute.slice(8)) <= 0) gone = true;
            if (/^expires=/.test(attribute)) { var when = Date.parse(parts[i].trim().slice(8)); if (!isNaN(when) && when <= Date.now()) gone = true; }
            if (attribute === 'httponly') return;   // a script cannot set an HttpOnly cookie
          }
          if (gone) delete jar[name]; else jar[name] = value;
          post({ t: 'cookie', value: limit(text, 4096) });
        } });
    } catch (e) { /* not definable */ }
  })();
  /* what a sandboxed frame is never given by the browser reaches the app instead: WebChromeClient decides */
  var asks = {}, nextAsk = 0;
  function ask2(message, done) { var id = ++nextAsk; asks[id] = done; message.aid = id; post(message); }
  commands.answer = function (d) { var done = asks[d.aid]; if (done) { delete asks[d.aid]; done(d); } };
  try {
    var geo = {
      getCurrentPosition: function (ok, fail) {
        ask2({ t: 'geolocation' }, function (d) {
          if (d.allowed && d.position) { if (typeof ok === 'function') ok({ coords: { latitude: d.position.latitude, longitude: d.position.longitude, accuracy: d.position.accuracy, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() }); }
          else if (typeof fail === 'function') fail({ code: d.allowed ? 2 : 1, message: d.allowed ? 'Position unavailable' : 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
        });
      },
      watchPosition: function (ok, fail) { geo.getCurrentPosition(ok, fail); return ++nextAsk; }, clearWatch: function () {}
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, get: function () { return geo; } });
  } catch (e) { /* not definable */ }
  try {
    var media = { getUserMedia: function (constraints) {
      return new Promise(function (resolve, reject) {
        var resources = []; if (constraints && constraints.video) resources.push('video'); if (constraints && constraints.audio) resources.push('audio');
        if (!resources.length) { reject(new TypeError("Failed to execute 'getUserMedia' on 'MediaDevices': At least one of audio and video must be requested")); return; }
        ask2({ t: 'permission', resources: resources }, function (d) { reject(new DOMException(d.granted ? 'Could not start video source' : 'Permission denied', d.granted ? 'NotReadableError' : 'NotAllowedError')); });
      });
    }, enumerateDevices: function () { return Promise.resolve([]); }, addEventListener: function () {}, removeEventListener: function () {} };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, get: function () { return media; } });
  } catch (e) { /* not definable */ }
  /* <input type=file>: WebChromeClient.onShowFileChooser picks; the files come back as bytes */
  document.addEventListener('click', function (event) {
    var input = event.target && event.target.closest ? event.target.closest('input[type=file]') : null;
    if (!input && event.target && event.target.closest) { var label = event.target.closest('label'); var control = label && (label.control || label.querySelector('input[type=file]')); if (control && control.type === 'file') input = control; }
    if (!input || input.tagName !== 'INPUT' || String(input.type).toLowerCase() !== 'file' || input.disabled || event.defaultPrevented) return;
    event.preventDefault();
    ask2({ t: 'chooser', accept: limit(input.getAttribute('accept') || '', 1024), multiple: !!input.multiple, capture: input.hasAttribute('capture') }, function (d) {
      if (!Array.isArray(d.files) || !d.files.length || typeof DataTransfer !== 'function') return;
      try {
        var transfer = new DataTransfer();
        d.files.forEach(function (f) { transfer.items.add(new File([f.bytes], String(f.name || 'file'), { type: String(f.type || '') })); });
        input.files = transfer.files;
        input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) { /* the files could not be set */ }
    });
  }, true);
  if (C.userAgent) { try { Object.defineProperty(navigator, 'userAgent', { get: function () { return C.userAgent; }, configurable: true }); Object.defineProperty(navigator, 'appVersion', { get: function () { return C.userAgent.replace(/^Mozilla\\//, ''); }, configurable: true }); } catch (e) { /* not definable */ } }
  /* navigations the document starts are the app's to allow: shouldOverrideUrlLoading */
  function absolute(url) { try { return new URL(url, (R && R.base) || document.baseURI).href; } catch (e) { return null; } }
  function navigate(url, method, body, gesture) { post({ t: 'navigate', url: limit(url, 8192), method: method, body: body === null ? null : limit(body, 65536), gesture: !!gesture, title: limit(document.title || '', 1024) }); }
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href');
    if (anchor.hasAttribute('download')) {   // a download is the app's DownloadListener's to take (the sandbox has no allow-downloads)
      var target = href ? absolute(href) : null; if (!target) return;
      event.preventDefault(); post({ t: 'download', url: limit(target, 8192), name: limit(anchor.getAttribute('download') || '', 512) }); return;
    }
    if (!href || href.charAt(0) === '#' || /^javascript:/i.test(href)) return;
    var url = absolute(href); if (!url) return;
    event.preventDefault(); navigate(url, 'GET', null, event.isTrusted === true);
  }, true);
  document.addEventListener('submit', function (event) {
    if (event.defaultPrevented) return;
    var form = event.target, submitter = event.submitter;
    var method = String((submitter && submitter.getAttribute('formmethod')) || form.getAttribute('method') || 'GET').toUpperCase();
    var encoding = String((submitter && submitter.getAttribute('formenctype')) || form.getAttribute('enctype') || 'application/x-www-form-urlencoded').toLowerCase();
    if (encoding !== 'application/x-www-form-urlencoded' || (method !== 'GET' && method !== 'POST')) return;   // multipart and dialog forms are not representable: the frame submits them itself
    var data = new FormData(form), pairs = new URLSearchParams();
    var ok = true; data.forEach(function (value, key) { if (typeof value !== 'string') ok = false; else pairs.append(key, value); });
    if (!ok) return;
    var target = absolute((submitter && submitter.getAttribute('formaction')) || form.getAttribute('action') || document.baseURI); if (!target) return;
    event.preventDefault();
    if (method === 'GET') { var u = new URL(target); u.search = pairs.toString(); navigate(u.href, 'GET', null, true); } else navigate(target, 'POST', pairs.toString(), true);
  }, true);
  try {
    if (window.navigation && window.navigation.addEventListener) window.navigation.addEventListener('navigate', function (event) {
      if (!event.cancelable || event.hashChange || event.downloadRequest !== null || event.destination.sameDocument || event.navigationType === 'reload' || event.navigationType === 'traverse') return;
      var url = event.destination.url; if (!url || /^(javascript|about):/i.test(url)) return;
      event.preventDefault(); navigate(url, event.formData ? 'POST' : 'GET', null, event.userInitiated);
    });
  } catch (e) { /* no Navigation API: clicks and submits above still work */ }
  /* sub-resources (phase 3): when the document comes from the APK or the app intercepts requests, the lab answers them instead of the network */
  if (R) (function () {
    var nextRid = 0, local = /^(data|blob|about|javascript):/i, srcState = new WeakMap(), xhrState = new WeakMap();
    function resolveUrl(u) { try { return new URL(String(u), R.base || document.baseURI).href; } catch (e) { return null; } }
    function ask(url, method) {
      return new Promise(function (resolve, reject) {
        var id = ++nextRid; if (id > 5000) { reject(new TypeError('Failed to fetch')); return; }
        waiting[id] = resolve; post({ t: 'resource', rid: id, url: limit(url, 8192), method: method });
        setTimeout(function () { if (waiting[id]) { delete waiting[id]; reject(new TypeError('Failed to fetch')); } }, 30000);
      });
    }
    function mimeOf(res) { return String(res.mime || 'application/octet-stream') + (res.encoding && !/charset/i.test(res.mime || '') ? '; charset=' + res.encoding : ''); }
    function textOf(res) { try { return new TextDecoder(res.encoding || 'utf-8').decode(res.bytes); } catch (e) { return new TextDecoder().decode(res.bytes); } }
    function dataUrl(res) { var s = '', b = res.bytes; for (var i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return 'data:' + String(res.mime || 'application/octet-stream').split(';')[0] + ';base64,' + btoa(s); }
    var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    if (nativeFetch) window.fetch = function (input, init) {
      try {
        var isRequest = typeof Request !== 'undefined' && input instanceof Request, url = resolveUrl(isRequest ? input.url : input);
        var method = String((init && init.method) || (isRequest && input.method) || 'GET').toUpperCase();
        if (!url || local.test(url)) return nativeFetch(input, init);
        return ask(url, method).then(function (res) {
          if (res.passthrough) return nativeFetch(isRequest ? input : url, init);
          if (res.failed) throw new TypeError('Failed to fetch');
          var status = res.status >= 200 && res.status <= 599 ? res.status : 502, empty = status === 204 || status === 205 || status === 304 || method === 'HEAD';
          var response = new Response(empty ? null : res.bytes, { status: status, statusText: res.reason || '', headers: { 'content-type': mimeOf(res) } });
          try { Object.defineProperty(response, 'url', { value: url }); } catch (e) { /* read-only in this engine */ }
          return response;
        });
      } catch (e) { return Promise.reject(e); }
    };
    var XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (XP) {
      var nativeOpen = XP.open, nativeSend = XP.send;
      var finish = function (x, state, res) {
        var type = x.responseType || '', ok = !res.failed, status = ok ? res.status : 0, headers = ok ? 'content-type: ' + mimeOf(res) + '\\r\\n' : '', value = null;
        try { if (ok) value = type === 'arraybuffer' ? res.bytes.buffer.slice(0) : type === 'blob' ? new Blob([res.bytes], { type: res.mime }) : type === 'json' ? JSON.parse(textOf(res)) : textOf(res); } catch (e) { value = null; }
        var def = function (name, v) { try { Object.defineProperty(x, name, { configurable: true, get: function () { return v; } }); } catch (e) { /* not definable */ } };
        def('readyState', 4); def('status', status); def('statusText', ok ? (res.reason || '') : ''); def('responseURL', ok ? state.url : ''); def('response', value);
        def('responseText', type === '' || type === 'text' ? (ok ? value : '') : ''); def('responseXML', null);
        x.getResponseHeader = function (name) { return ok && String(name).toLowerCase() === 'content-type' ? mimeOf(res) : null; };
        x.getAllResponseHeaders = function () { return headers; };
        var fire = function (name) { try { x.dispatchEvent(typeof ProgressEvent === 'function' ? new ProgressEvent(name) : new Event(name)); } catch (e) { /* no events */ } };
        fire('readystatechange'); fire(ok ? 'load' : 'error'); fire('loadend');
      };
      XP.open = function (method, url, async) {
        var abs = resolveUrl(url), args = Array.prototype.slice.call(arguments);
        if (abs && arguments.length > 1) args[1] = abs;
        xhrState.set(this, abs && !local.test(abs) && async !== false ? { method: String(method).toUpperCase(), url: abs } : null);
        return nativeOpen.apply(this, args);
      };
      XP.send = function (body) {
        var x = this, state = xhrState.get(x);
        if (!state) return nativeSend.apply(x, arguments);
        ask(state.url, state.method).then(function (res) {
          if (res.passthrough) { nativeSend.call(x, body); return; }
          finish(x, state, res);
        }, function () { finish(x, state, { failed: true }); });
      };
    }
    /* elements that load a URL: the answer replaces the URL before the browser can fetch it */
    var nativeSetAttribute = window.Element && window.Element.prototype.setAttribute;
    function commit(element, prop, value) { if (nativeSetAttribute) nativeSetAttribute.call(element, prop, value); }
    function setResolved(element, prop, kind, value) {
      var url = resolveUrl(value);
      if (!url || local.test(String(value))) { srcState.delete(element); commit(element, prop, value); return; }
      var token = {}; srcState.set(element, { prop: prop, url: url, token: token });
      ask(url, 'GET').then(function (res) {
        var current = srcState.get(element); if (!current || current.token !== token) return;
        var event = function (name) { try { element.dispatchEvent(new Event(name)); } catch (e) { /* no events */ } };
        if (res.passthrough || res.failed) { commit(element, prop, url); return; }
        if (kind === 'script') { element.text = textOf(res); event('load'); }
        else if (kind === 'style') { var style = document.createElement('style'); style.textContent = textOf(res); if (element.parentNode) element.parentNode.insertBefore(style, element.nextSibling); else (document.head || document.documentElement).appendChild(style); event('load'); }
        else commit(element, prop, dataUrl(res));
      }, function () { commit(element, prop, url); });
    }
    function guard(name, prop, kind) {
      var proto = window[name] && window[name].prototype, descriptor = proto && Object.getOwnPropertyDescriptor(proto, prop);
      if (!descriptor || !descriptor.set) return;
      Object.defineProperty(proto, prop, { configurable: true, enumerable: descriptor.enumerable,
        get: function () { var known = srcState.get(this); return known && known.prop === prop ? known.url : descriptor.get.call(this); },
        set: function (value) { setResolved(this, prop, kind, value); } });
    }
    guard('HTMLImageElement', 'src', 'media'); guard('HTMLSourceElement', 'src', 'media'); guard('HTMLMediaElement', 'src', 'media'); guard('HTMLTrackElement', 'src', 'media');
    guard('HTMLScriptElement', 'src', 'script'); guard('HTMLLinkElement', 'href', 'style');
    var tagKinds = { IMG: ['src', 'media'], SOURCE: ['src', 'media'], AUDIO: ['src', 'media'], VIDEO: ['src', 'media'], TRACK: ['src', 'media'], SCRIPT: ['src', 'script'], LINK: ['href', 'style'] };
    if (window.Element && nativeSetAttribute) window.Element.prototype.setAttribute = function (name, value) {
      var entry = tagKinds[this.tagName], lower = String(name).toLowerCase();
      if (entry && entry[0] === lower && (lower !== 'href' || /stylesheet/i.test(this.getAttribute('rel') || ''))) { setResolved(this, lower, entry[1], value); return; }
      return nativeSetAttribute.apply(this, arguments);
    };
    /* markup inserted by script (innerHTML, insertAdjacentHTML) is parsed by the browser, which starts its loads at once; the answer replaces them afterwards */
    try {
      new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes || [], function (node) {
            if (!node || node.nodeType !== 1) return;
            var all = [node].concat(Array.prototype.slice.call(node.querySelectorAll ? node.querySelectorAll('img[src],source[src],audio[src],video[src],track[src],link[rel~=stylesheet][href]') : []));
            all.forEach(function (element) {
              var entry = tagKinds[element.tagName]; if (!entry || srcState.has(element) || element.tagName === 'SCRIPT') return;
              var value = element.getAttribute(entry[0]); if (!value || local.test(value)) return;
              setResolved(element, entry[0], entry[1], value);
            });
          });
        });
      }).observe(document, { childList: true, subtree: true });
    } catch (e) { /* no observer */ }
  })();
  hello();
})();`;
