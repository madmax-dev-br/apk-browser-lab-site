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
  return BRIDGE.replace('__CONFIG__', () => jsonForScript(config));
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

const BRIDGE = `(function () {
  'use strict';
  var C = __CONFIG__, port = null, queue = [], consoleCount = 0, calls = 0, helloTries = 0;
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
    title();
  });
  function json(value) { if (value === undefined) return 'null'; try { var s = JSON.stringify(value); return s === undefined ? 'null' : s; } catch (e) { return 'null'; } }
  function onCommand(event) {
    var data = event.data;
    if (!data || data.t !== 'eval') return;
    try { var value = (0, eval)(String(data.script)); post({ t: 'eval-result', evalId: data.evalId, ok: true, json: limit(json(value), 1048576) }); }
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
  var lastTitle = '';
  function title() { var t = document.title || ''; if (t !== lastTitle) { lastTitle = t; post({ t: 'title', title: limit(t, 1024) }); } }
  document.addEventListener('DOMContentLoaded', title);
  try { new MutationObserver(title).observe(document, { childList: true, subtree: true, characterData: true }); } catch (e) { /* no observer */ }
  /* dialogs: no allow-modals in the sandbox, so alert is reported and does not block; confirm and prompt need the synchronous bridge */
  window.alert = function (message) { post({ t: 'dialog', kind: 'alert', text: limit(message === undefined ? '' : message, 4096) }); };
  window.confirm = function (message) { post({ t: 'dialog', kind: 'confirm', text: limit(message === undefined ? '' : message, 4096) }); return false; };
  window.prompt = function (message) { post({ t: 'dialog', kind: 'prompt', text: limit(message === undefined ? '' : message, 4096) }); return null; };
  window.open = function (url) { post({ t: 'popup', url: limit(url === undefined ? '' : url, 8192) }); return null; };
  /* @JavascriptInterface objects */
  var names = C.interfaces || {};
  Object.keys(names).forEach(function (name) {
    if (!/^[A-Za-z_$][\\w$]{0,63}$/.test(name) || name === '__proto__' || name === 'constructor') return;
    var object = {};
    (names[name] || []).forEach(function (method) {
      Object.defineProperty(object, method, { enumerable: true, value: function () {
        if (++calls > 5000) return undefined;
        post({ t: 'js', name: name, method: method, args: Array.prototype.slice.call(arguments, 0, 32).map(function (a) { return a === null || a === undefined || typeof a === 'object' || typeof a === 'function' ? null : typeof a === 'symbol' ? null : a; }) });
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
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try { var value = C.domStorage ? memoryStorage() : null; Object.defineProperty(window, name, { get: function () { return value; }, configurable: true }); } catch (e) { /* not definable */ }
  });
  if (C.userAgent) { try { Object.defineProperty(navigator, 'userAgent', { get: function () { return C.userAgent; }, configurable: true }); Object.defineProperty(navigator, 'appVersion', { get: function () { return C.userAgent.replace(/^Mozilla\\//, ''); }, configurable: true }); } catch (e) { /* not definable */ } }
  /* navigations the document starts are the app's to allow: shouldOverrideUrlLoading */
  function absolute(url) { try { return new URL(url, document.baseURI).href; } catch (e) { return null; } }
  function navigate(url, method, body, gesture) { post({ t: 'navigate', url: limit(url, 8192), method: method, body: body === null ? null : limit(body, 65536), gesture: !!gesture }); }
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor || anchor.hasAttribute('download')) return;
    var href = anchor.getAttribute('href');
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
  hello();
})();`;
