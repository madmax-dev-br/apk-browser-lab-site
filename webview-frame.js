// The page's side of android.webkit.WebView (design: docs/APK-REAL-TASKS.md, task 33): one sandboxed iframe per WebView, inside the DOM element that device-view.js keeps for the
// View, so the View's bounds, clipping, visibility and z-order among sibling Views (and below dialog windows) are the DOM's own. The Worker's backend (webview-backend.js)
// decides what may load and sends `load`/`stop`/`destroy`; this manager creates the iframe and reports what the browser lets it observe: that the frame loaded, or that it did not
// within the time limit. It never reads the frame (another origin cannot be read) and never grants it anything of the lab: see FRAME_SANDBOX / FRAME_ATTRIBUTES.
//
// Isolation: `sandbox` never carries allow-same-origin, allow-top-navigation, allow-popups, allow-modals, allow-downloads or allow-pointer-lock, so even a document of the lab's
// own origin or a srcdoc is an opaque origin that cannot touch the lab's DOM, Worker or storage. Scripts run only when the app enabled JavaScript. The frame gets no
// permissions policy features (`allow=""`), no referrer, and no ambient credentials where the browser supports `credentialless`.

import { bridgeMarkup, injectIntoHead } from './webview-bridge.js?v=d50f2f368405';

export const FRAME_SANDBOX = Object.freeze({ scripts: 'allow-scripts', forms: 'allow-forms' });
export const FRAME_ATTRIBUTES = Object.freeze({ allow: '', referrerpolicy: 'no-referrer', loading: 'eager', 'aria-label': 'WebView' });
const GRACE_MS = 1500;
const FORBIDDEN_TOKENS = ['allow-same-origin', 'allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-modals', 'allow-downloads', 'allow-pointer-lock', 'allow-presentation', 'allow-orientation-lock', 'allow-storage-access-by-user-activation'];

/** The `sandbox` value for a frame; JavaScript only when the app's WebSettings enabled it. */
export function sandboxFor({ javascript }) { return [javascript ? FRAME_SANDBOX.scripts : null, FRAME_SANDBOX.forms].filter(Boolean).join(' '); }
export const sandboxIsSafe = value => String(value).split(/\s+/).every(token => !FORBIDDEN_TOKENS.includes(token));

const escapeAttribute = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const decodeBody = (data, encoding) => {
  if (encoding === 'base64') { const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0)); return new TextDecoder().decode(bytes); }
  try { return decodeURIComponent(data); } catch { return data; }   // loadData's content is URL-escaped; text that is not valid escaping is taken as it is
};
const isHtml = mime => /^(text\/html|application\/xhtml\+xml)$/i.test(String(mime).split(';')[0].trim());

/** What the iframe is given for a Worker `load` request: { srcdoc } or { src } or { form: { action, fields } }, or { error } when the request cannot be expressed in a browser. */
export function frameSource(request, { labOrigin = '' } = {}) {
  const url = request.url ?? '';
  if (request.kind === 'url') return { src: url };
  if (request.kind === 'post') {
    let params; try { params = new URLSearchParams(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(request.body ?? []))); } catch { params = null; }   // a form body is text
    if (!params) return { error: { code: -1, description: 'net::ERR_INVALID_ARGUMENT (the postUrl body is not application/x-www-form-urlencoded text, which is all a browser can post into a frame)' } };
    return { form: { action: url, fields: [...params.entries()] } };
  }
  const text = request.kind === 'data' ? decodeBody(request.data, request.encoding) : request.data;
  if (!isHtml(request.mime)) {
    if (request.mime && /^text\//i.test(request.mime)) return { srcdoc: `<!doctype html><meta charset="utf-8"><pre style="white-space:pre-wrap;margin:0">${text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</pre>` };
    const base64 = request.encoding === 'base64' && request.kind === 'data' ? request.data : btoa(unescape(encodeURIComponent(text)));
    return { src: `data:${request.mime};base64,${base64}` };
  }
  // loadDataWithBaseURL: relative references resolve against the base URL; the lab's own origin is never a base (the document would otherwise ask the lab for its resources)
  let base = null;
  if (request.kind === 'dataBase' && request.baseUrl && request.baseUrl !== 'about:blank') {
    try { const parsed = new URL(request.baseUrl); if (/^https?:$/.test(parsed.protocol) && parsed.origin !== labOrigin) base = parsed.href; } catch { /* not a URL: no base */ }
  }
  return { srcdoc: withBase(text, base) };
}
/** `html` with a <base href> for `base` unless the document sets its own. */
export function withBase(html, base) {
  if (!base || /<base[\s>]/i.test(html)) return html;
  const tag = `<base href="${escapeAttribute(base)}">`;
  return /<head[\s>]/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${tag}`) : `${tag}${html}`;
}

/**
 * createWebViewManager({ send, labOrigin }) -> { attach, handle, sweep, reset, frames }
 *   send(event)      posts { type: 'webview-event', id, loadId, event: 'finished' | 'error', ... } to the Worker
 *   attach(id, el)   the DOM element of WebView `id` (called on every render of the node)
 *   handle(message)  a Worker message (op: 'load' | 'stop' | 'destroy')
 *   sweep(liveIds)   destroys the frames of WebViews that left the snapshot
 */
export function createWebViewManager({ send, labOrigin = globalThis.location?.origin ?? '', document: doc = globalThis.document, timers = globalThis, fetch: fetchImpl = globalThis.fetch?.bind(globalThis), win = globalThis, MessageChannel: Channel = globalThis.MessageChannel } = {}) {
  const frames = new Map();   // id -> { id, element, iframe, form, loadId, timer }
  const slots = new Map();    // id -> element
  const queued = new Map();   // id -> messages that arrived before the element existed
  const supportsCredentialless = () => { try { return 'credentialless' in (doc.createElement('iframe')); } catch { return false; } };

  const dispose = frame => {
    if (!frame) return;
    timers.clearTimeout(frame.timer); frame.timer = null;
    timers.clearTimeout(frame.grace); frame.grace = null;
    try { frame.port?.close?.(); } catch { /* already closed */ }
    frame.port = null; frame.bridge = null; frame.counts = null;
    frame.iframe?.remove?.(); frame.form?.remove?.(); frame.iframe = null; frame.form = null;
  };
  const fail = (frame, code, description) => { timers.clearTimeout(frame.timer); frame.timer = null; send({ type: 'webview-event', id: frame.id, loadId: frame.loadId, event: 'error', code, description }); };

  function load(id, message) {
    const element = slots.get(id);
    if (!element) { (queued.get(id) ?? queued.set(id, []).get(id)).push(message); return; }
    let frame = frames.get(id);
    if (!frame) frames.set(id, frame = { id, element, iframe: null, form: null, loadId: 0, timer: null });
    dispose(frame); frame.element = element; frame.loadId = message.loadId;
    const source = frameSource(message.request, { labOrigin });
    if (source.error) { fail(frame, source.error.code, source.error.description); return; }
    // A document of the lab's own origin is fetched here and handed to the frame as srcdoc with a <base>: the frame stays an opaque origin, the lab serves it once, and
    // (phase 2) the page bridge can be put in front of it. Anything that is not HTML is framed by URL.
    if (source.src && labOrigin && sameOrigin(source.src, labOrigin) && fetchImpl) {
      frame.timer = timers.setTimeout(() => { if (frame.loadId === message.loadId) fail(frame, -8, 'net::ERR_TIMED_OUT (the lab document did not arrive)'); }, message.timeoutMs ?? 30000);
      const url = source.src, loadId = message.loadId;
      Promise.resolve().then(() => fetchImpl(url, { credentials: 'omit', cache: 'no-store', redirect: 'error' })).then(async response => {
        if (frame.loadId !== loadId) return;
        if (!response.ok) { fail(frame, response.status === 404 ? -14 : -1, `net::ERR_HTTP_RESPONSE_CODE_FAILURE (${response.status})`); return; }
        const html = /html/i.test(response.headers.get('content-type') ?? '') ? await response.text() : null;
        if (frame.loadId !== loadId) return;
        timers.clearTimeout(frame.timer); frame.timer = null;
        attachFrame(frame, id, message, html === null ? { src: url } : { srcdoc: withBase(html, url) });
      }).catch(() => { if (frame.loadId === loadId) fail(frame, -7, 'net::ERR_FAILED (the lab document could not be fetched)'); });
      return;
    }
    attachFrame(frame, id, message, source);
  }
  const sameOrigin = (url, origin) => { try { return new URL(url, origin).origin === origin; } catch { return false; } };
  function attachFrame(frame, id, message, source) {
    const element = frame.element;
    const iframe = doc.createElement('iframe'), sandbox = sandboxFor({ javascript: message.javascript });
    if (!sandboxIsSafe(sandbox)) throw new Error(`Unsafe WebView sandbox: ${sandbox}`);   // an internal invariant: sandboxFor can never produce one
    iframe.setAttribute('sandbox', sandbox);
    for (const [name, value] of Object.entries(FRAME_ATTRIBUTES)) iframe.setAttribute(name, value);
    if (supportsCredentialless()) iframe.setAttribute('credentialless', '');
    iframe.className = 'android-webview-frame'; iframe.title = 'WebView';
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff';
    iframe.addEventListener('load', () => {
      if (frame.iframe !== iframe || frame.loadId !== message.loadId) return;
      timers.clearTimeout(frame.timer); frame.timer = null;
      send({ type: 'webview-event', id, loadId: message.loadId, event: 'finished' });
      // a document that was given a bridge connects to it while it loads, usually before the load event: if it has not by now, give it a moment, then say it never will
      if (frame.bridge && !frame.port) frame.grace = timers.setTimeout(() => { if (frame.iframe === iframe && !frame.port) send({ type: 'webview-event', id, loadId: message.loadId, event: 'bridge-failed' }); }, GRACE_MS);
    });
    if (message.bridge) listen();
    frame.iframe = iframe; frame.bridge = null; frame.counts = { console: 0, js: 0, dialog: 0, navigate: 0, title: 0, popup: 0 };
    if ('srcdoc' in source) {
      let document_ = source.srcdoc;
      // a document the lab hands to the frame itself gets the page bridge and the network policy in front of it (src/webview-bridge.js); an opaque one cannot
      if (message.bridge) { frame.bridge = message.javascript ? { ...message.bridge, loadId: message.loadId } : null; document_ = injectIntoHead(document_, bridgeMarkup({ csp: message.bridge.csp, config: { ...message.bridge.config, loadId: message.loadId }, javascript: !!message.javascript })); }
      iframe.setAttribute('srcdoc', document_);
    } else if ('src' in source) iframe.setAttribute('src', source.src);
    element.append(iframe);
    if (source.form) {   // postUrl: a form posted into the frame (the body of a POST cannot be set on an iframe's src)
      const form = doc.createElement('form');
      form.method = 'POST'; form.action = source.form.action; form.target = `apkweb-webview-${id}-${message.loadId}`; form.enctype = 'application/x-www-form-urlencoded'; form.hidden = true;
      iframe.setAttribute('name', form.target);
      for (const [name, value] of source.form.fields) { const input = doc.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input); }
      element.append(form); frame.form = form; form.submit();
    }
    frame.timer = timers.setTimeout(() => { if (frame.loadId === message.loadId && frame.iframe === iframe) fail(frame, -8, 'net::ERR_TIMED_OUT (no load event from the WebView frame)'); }, message.timeoutMs ?? 30000);
  }

  // ---- the page bridge: a frame says hello, the page answers with one end of a MessageChannel, everything after that travels over the port ------------------------------------------
  const str = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  const LIMITS = { console: 1000, js: 5000, dialog: 100, navigate: 200, title: 200, popup: 20 };
  const count = (frame, kind) => (frame.counts[kind] = (frame.counts[kind] ?? 0) + 1) <= LIMITS[kind];
  /** What a frame may say, validated and bounded: anything else is dropped. The Worker validates again; nothing here is trusted because it came through a port. */
  function forward(frame, data) {
    if (!data || typeof data !== 'object' || frame.port === null) return;
    const base = { type: 'webview-event', id: frame.id, loadId: frame.loadId };
    switch (data.t) {
      case 'ready': send({ ...base, event: 'bridge-ready', title: str(data.title, 1024) }); break;
      case 'console': if (count(frame, 'console') && ['log', 'info', 'warn', 'error', 'debug'].includes(data.level)) send({ ...base, event: 'console', level: data.level, text: str(data.text, 4096), source: str(data.source, 2048), line: Number.isSafeInteger(data.line) && data.line >= 0 ? data.line : 0 }); break;
      case 'title': if (count(frame, 'title')) send({ ...base, event: 'title', title: str(data.title, 1024) }); break;
      case 'dialog': if (count(frame, 'dialog') && ['alert', 'confirm', 'prompt'].includes(data.kind)) send({ ...base, event: 'dialog', kind: data.kind, text: str(data.text, 4096) }); break;
      case 'popup': if (count(frame, 'popup')) send({ ...base, event: 'popup', url: str(data.url, 8192) }); break;
      case 'js': {
        if (!count(frame, 'js') || typeof data.name !== 'string' || typeof data.method !== 'string' || !Array.isArray(data.args) || data.args.length > 32) break;
        const args = data.args.map(value => (typeof value === 'string' ? value.slice(0, 4096) : typeof value === 'number' || typeof value === 'boolean' ? value : null));
        send({ ...base, event: 'js', name: data.name.slice(0, 64), method: data.method.slice(0, 128), args });
        break;
      }
      case 'navigate': if (count(frame, 'navigate') && typeof data.url === 'string' && data.url.length <= 8192 && (data.method === 'GET' || data.method === 'POST')) send({ ...base, event: 'navigate', url: data.url, method: data.method, body: data.method === 'POST' ? str(data.body, 65536) : null, gesture: data.gesture === true }); break;
      case 'eval-result': if (Number.isSafeInteger(data.evalId) && typeof data.ok === 'boolean') send({ ...base, event: 'eval-result', evalId: data.evalId, ok: data.ok, json: data.ok ? str(data.json, 1048576) : null }); break;
      default: break;
    }
  }
  function onWindowMessage(event) {
    const data = event.data;
    if (!data || data.apkwebBridge !== 'hello') return;
    for (const frame of frames.values()) {
      // only the current document of a frame whose load carried a bridge, once: source, load id and state must all match
      if (!frame.iframe || !frame.bridge || frame.port || event.source !== frame.iframe.contentWindow || data.loadId !== frame.loadId) continue;
      const channel = new Channel();
      frame.port = channel.port1; channel.port1.onmessage = e => forward(frame, e.data);
      event.source.postMessage({ apkwebBridge: 'port', loadId: frame.loadId }, '*', [channel.port2]);
      return;
    }
  }
  let listening = false;   // the window listener exists only while a document with a bridge may say hello
  const listen = () => { if (!listening) { listening = true; win.addEventListener?.('message', onWindowMessage); } };
  function evaluate(message) {
    const frame = frames.get(message.id);
    if (!frame || !frame.port || frame.loadId !== message.loadId || typeof message.script !== 'string' || !Number.isSafeInteger(message.evalId)) {
      send({ type: 'webview-event', id: message.id, loadId: message.loadId, event: 'eval-result', evalId: message.evalId, ok: false, json: null }); return;
    }
    frame.port.postMessage({ t: 'eval', evalId: message.evalId, script: message.script });
  }
  return {
    frames,
    attach(id, element) {
      slots.set(id, element);
      const frame = frames.get(id);
      if (frame && frame.element !== element) { frame.element = element; if (frame.iframe) element.append(frame.iframe); if (frame.form) element.append(frame.form); }
      const pending = queued.get(id); if (pending) { queued.delete(id); for (const message of pending) this.handle(message); }
    },
    handle(message) {
      if (!message || message.type !== 'webview' || !Number.isSafeInteger(message.id)) return;
      if (message.op === 'load') load(message.id, message);
      else if (message.op === 'eval') evaluate(message);
      else if (message.op === 'stop') { const frame = frames.get(message.id); if (frame) { dispose(frame); frame.loadId = -1; } queued.delete(message.id); }
      else if (message.op === 'destroy') { dispose(frames.get(message.id)); frames.delete(message.id); queued.delete(message.id); slots.delete(message.id); }
    },
    sweep(liveIds) {
      for (const id of [...slots.keys()]) if (!liveIds.has(id)) slots.delete(id);
    },
    reset() { for (const frame of frames.values()) dispose(frame); frames.clear(); slots.clear(); queued.clear(); },
    /** Stops listening to the window (the manager is replaced when a new VM is bound). */
    close() { if (listening) { listening = false; win.removeEventListener?.('message', onWindowMessage); } for (const frame of frames.values()) dispose(frame); frames.clear(); slots.clear(); queued.clear(); },
  };
}

/** The ids of the WebView nodes in a snapshot (Activity window and window surfaces). */
export function webViewIds(views, out = new Set()) {
  for (const view of views ?? []) { if (view?.kind === 'webview' && Number.isSafeInteger(view.webview?.webviewId)) out.add(view.webview.webviewId); webViewIds(view?.children, out); }
  return out;
}
