'use strict';
// WebView documents through the relay (protocol 1). The same file is src/webview.cjs of the APK Lab Relay and scripts/relay-webview.cjs of the lab (keep them identical).
//
// Android's WebView shows any page; a browser page can only frame a page that allows it (X-Frame-Options, CSP frame-ancestors) and can never read or script a page of another
// origin. With the relay, the lab shows a WebView's documents from the relay instead: the iframe's address is http://<label>.localhost:<port>/<path>, where <label> (20 hex
// digits, random) stands for one origin of one WebView of one lab page (its "slot"). The relay fetches the real URL from this computer and answers the frame with it, so:
//  - framing headers and the page's CSP do not apply (they are not passed on); the lab's own CSP and its page bridge (src/webview-bridge.js) are put at the top of the main document;
//  - every request of the document (sub-resources, fetch/XHR, navigations) comes here first and is decided by the lab over the channel below, before anything leaves this computer:
//    the device's network policy, the app's cookies (the lab's CookieManager jar, never the browser's), the app's shouldInterceptRequest, the WebSettings user agent;
//  - Set-Cookie is handed to the lab (the browser never sees it), redirects are answered to the frame with the slot address of their target (the browser follows them, so each hop
//    is decided again and its cookies are stored first), absolute URLs of other origins in HTML and CSS are rewritten to their slots;
//  - the document's synchronous calls (a @JavascriptInterface method, document.cookie, a navigation the app may override) are POSTs to /__apkweb/* on its own slot, answered once
//    the lab answered: that is how a JavaScript interface method returns its value synchronously, as on Android.
//
// The channel: a WebSocket from the lab's Worker to /<token>/webview (the token and Origin rules of the per-request path). JSON text messages:
//   relay -> lab  {"t":"hello","v":1,"suffix":"localhost","port"}                  the first message
//   lab -> relay  {"t":"open","id","view","url"}                                    a slot for url's origin in WebView `view` -> {"t":"opened","id","frameUrl"}
//   relay -> lab  {"t":"slot","view","label","origin"}                              a slot the relay made (rewriting, /__apkweb/go, a redirect)
//   relay -> lab  {"t":"request","rid","view","url","method","nav","dest","user","redirectOf","headers"}  a request of a document -> the lab answers
//   lab -> relay  {"t":"decision","rid","allow","reason","status","upstream","cookie","userAgent","origin","referer","csp","inject","respond":{status,reason,mime,body(base64)}}
//   relay -> lab  {"t":"response","rid","status","reason","headers","setCookie","location"} | {"t":"response","rid","error":{code,message}};  then {"t":"done","rid","bytes"}
//   relay -> lab  {"t":"call","cid","view","kind":"js"|"cookie"|"nav","body"}  -> lab {"t":"result","cid","body"}   (a synchronous call of a document)
//   lab -> relay  {"t":"forget","view"}                                             the WebView was destroyed: its slots are gone
// Safety: the channel needs the token and an allowed Origin; a slot address is a capability (80 random bits) of one channel, gone when the channel closes; requests on a slot carry
// none of the browser's cookies and get none (Set-Cookie never reaches the browser); nothing is stored. The lab decides every request before it leaves this computer.
const http = require('node:http');
const zlib = require('node:zlib');
const { randomBytes, createHash } = require('node:crypto');

const WEBVIEW_VERSION = 1;
const LABEL = /^([a-f0-9]{20})\.localhost(?::(\d{1,5}))?$/i;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_BODY = 32 * 1024 * 1024, MAX_DOCUMENT = 32 * 1024 * 1024;
const ASK_MS = 30000, CALL_MS = 120000, SLOT_WAIT_MS = 3000;
// request headers that are the browser's (or the relay's), never the app's: the lab says what goes out instead (cookie, user agent, origin, referer)
const DROP_REQUEST = new Set(['host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'content-length', 'expect', 'cookie', 'origin', 'referer', 'user-agent', 'accept-encoding', 'priority', 'dnt']);
// response headers that would stop the frame (framing, CSP, isolation), that belong to the server's origin (HSTS, CORS), or that the relay redoes (cookies, length, encoding)
const DROP_RESPONSE = new Set(['set-cookie', 'x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
  'cross-origin-resource-policy', 'strict-transport-security', 'alt-svc', 'report-to', 'nel', 'reporting-endpoints', 'clear-site-data', 'transfer-encoding', 'connection', 'keep-alive', 'location', 'refresh']);

function wsFrame(opcode, payload) {
  const n = payload.length, head = n < 126 ? 2 : n < 65536 ? 4 : 10, out = Buffer.alloc(head + n);
  out[0] = 0x80 | opcode; if (n < 126) out[1] = n; else if (n < 65536) { out[1] = 126; out.writeUInt16BE(n, 2); } else { out[1] = 127; out.writeUInt32BE(Math.floor(n / 0x100000000), 2); out.writeUInt32BE(n >>> 0, 6); }
  Buffer.from(payload).copy(out, head); return out;
}
function wsDecoder() {
  let buffer = Buffer.alloc(0), parts = null, partsOpcode = 0;
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]); const out = [];
    for (;;) {
      if (buffer.length < 2) break;
      const fin = (buffer[0] & 0x80) !== 0, opcode = buffer[0] & 0x0f, masked = (buffer[1] & 0x80) !== 0; let length = buffer[1] & 0x7f, at = 2;
      if (length === 126) { if (buffer.length < 4) break; length = buffer.readUInt16BE(2); at = 4; } else if (length === 127) { if (buffer.length < 10) break; length = buffer.readUInt32BE(2) * 0x100000000 + buffer.readUInt32BE(6); at = 10; }
      const mask = at; if (masked) at += 4; if (buffer.length < at + length) break;
      const payload = Buffer.from(buffer.subarray(at, at + length)); if (masked) for (let i = 0; i < length; i++) payload[i] ^= buffer[mask + (i & 3)];
      buffer = buffer.subarray(at + length);
      if (opcode >= 0x8) { out.push({ opcode, payload }); continue; }
      if (opcode === 0) parts?.push(payload); else { parts = [payload]; partsOpcode = opcode; }
      if (fin && parts) { out.push({ opcode: partsOpcode, payload: Buffer.concat(parts) }); parts = null; }
    }
    return out;
  };
}
/** The body as a browser would read it: gzip, deflate (zlib or raw), br and zstd undone. */
function decode(bytes, coding) {
  const c = String(coding ?? '').trim().toLowerCase();
  if (!c || c === 'identity') return bytes;
  if (c === 'gzip' || c === 'x-gzip') return zlib.gunzipSync(bytes, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
  if (c === 'br') return zlib.brotliDecompressSync(bytes);
  if (c === 'zstd' && typeof zlib.zstdDecompressSync === 'function') return zlib.zstdDecompressSync(bytes);
  if (c === 'deflate') { const wrapped = bytes.length >= 2 && (bytes[0] & 0x0f) === 8 && ((bytes[0] << 8) | bytes[1]) % 31 === 0; return wrapped ? zlib.inflateSync(bytes, { finishFlush: zlib.constants.Z_SYNC_FLUSH }) : zlib.inflateRawSync(bytes, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
  throw Object.assign(new Error(`content-encoding ${c} cannot be decoded`), { code: 'EENCODING' });
}
/** `snippet` as early in `html` (a binary string) as its doctype allows: after <head>, else after <html>, else after the doctype, else first. */
function injectIntoHead(html, snippet) {
  for (const pattern of [/<head(?:\s[^>]*)?>/i, /<html(?:\s[^>]*)?>/i, /<!doctype[^>]*>/i]) { const match = pattern.exec(html); if (match) return html.slice(0, match.index + match[0].length) + snippet + html.slice(match.index + match[0].length); }
  return snippet + html;
}
const ATTRIBUTE = /(\s(?:src|href|action|formaction|poster|data|background|srcset|imagesrcset)\s*=\s*)("([^"]*)"|'([^']*)')/gi;
const CSS_URL = /url\(\s*(["']?)((?:https?:)?\/\/[^"')\s]+)\1\s*\)/gi;
/** Absolute (and protocol-relative) URLs of HTML attributes and CSS url() through `map(url) -> url`; relative ones already resolve against the slot. `text` is a binary string. */
function rewriteMarkup(text, map, { html = true } = {}) {
  let out = text.replace(CSS_URL, (whole, quote, url) => `url(${quote}${map(url)}${quote})`);
  if (html) out = out.replace(ATTRIBUTE, (whole, name, quoted, double, single) => {
    const value = double ?? single, q = double !== undefined ? '"' : "'";
    const mapped = /srcset\s*=\s*$/i.test(name) ? value.split(',').map(part => part.replace(/^(\s*)(\S+)/, (m, space, url) => space + map(url))).join(',') : map(value);
    return `${name}${q}${mapped}${q}`;
  });
  return out;
}

/**
 * The WebView part of a relay. `allowed`: the page origins (Set); `upstream(url, method, headers, body, { signal })` -> Promise<http.IncomingMessage> makes ONE request (no redirect
 * followed); `port()`: the port the relay listens on; `note(item)`: the relay's recent-requests list.
 */
function createWebViewRelay({ token, allowed, upstream, port, note = () => {}, timeoutMs = 60000 }) {
  const labels = new Map();   // label -> { channel, view, origin }
  const channels = new Set();
  const waitingSlots = new Map();   // label -> [resolve] (a frame that asked before the lab's open arrived)
  let nextRid = 1, nextCid = 1;
  const slotBase = label => `http://${label}.localhost:${port()}`;
  const slotFor = (channel, view, origin) => {
    const key = `${view} ${origin}`; let label = channel.slots.get(key);
    if (label) return label;
    label = randomBytes(10).toString('hex'); channel.slots.set(key, label); labels.set(label, { channel, view, origin });
    channel.say({ t: 'slot', view, label, origin });
    for (const resolve of waitingSlots.get(label) ?? []) resolve();
    waitingSlots.delete(label);
    return label;
  };
  /** The slot address of real URL `url` in WebView `view` (absolute http/https only; anything else is returned as it is). */
  const toSlot = (channel, view, url) => {
    let parsed; try { parsed = new URL(url); } catch { return url; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
    return slotBase(slotFor(channel, view, parsed.origin)) + parsed.pathname + parsed.search + parsed.hash;
  };
  const owns = req => LABEL.test(String(req.headers.host ?? ''));
  const findSlot = async label => {
    if (labels.has(label)) return labels.get(label);
    await new Promise(resolve => { const list = waitingSlots.get(label) ?? []; list.push(resolve); waitingSlots.set(label, list); setTimeout(resolve, SLOT_WAIT_MS).unref?.(); });
    return labels.get(label) ?? null;
  };
  const cors = (req, res) => {
    const origin = req.headers.origin; if (!origin) return;
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin');
  };
  const plain = (req, res, status, text) => { if (res.headersSent) { res.destroy(); return; } cors(req, res); res.statusCode = status; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(text); };
  const readBody = async (req, limit = MAX_BODY) => { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('body too large'), { code: 'E2BIG' }); chunks.push(chunk); } return Buffer.concat(chunks); };
  /** Asks the lab and waits for its answer (`kind` 'ask': a request decision; 'call': a synchronous call of the document). */
  const ask = (channel, message, ms) => new Promise(resolve => {
    if (channel.closed) { resolve(null); return; }
    const id = message.t === 'request' ? `r${message.rid}` : `c${message.cid}`, timer = setTimeout(() => { channel.pending.delete(id); resolve(null); }, ms);
    timer.unref?.();
    channel.pending.set(id, value => { clearTimeout(timer); channel.pending.delete(id); resolve(value); });
    channel.say(message);
  });

  async function serve(req, res) {
    const started = Date.now(), host = String(req.headers.host ?? ''), label = LABEL.exec(host)[1].toLowerCase();
    const slot = await findSlot(label);
    if (!slot || slot.channel.closed) return plain(req, res, 404, 'unknown WebView document address (the WebView or its lab page is gone)');
    const { channel, view, origin } = slot, url = new URL(req.url, 'http://relay.invalid');
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {   // the frame is an opaque origin: every fetch of its own is cross-origin for the browser
      cors(req, res);
      res.setHeader('Access-Control-Allow-Methods', req.headers['access-control-request-method']);
      if (req.headers['access-control-request-headers']) res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers']);
      if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.setHeader('Access-Control-Max-Age', '600'); res.statusCode = 204; return res.end();
    }
    if (url.pathname.startsWith('/__apkweb/')) return special(req, res, channel, view, origin, url);
    const real = origin + url.pathname + url.search, nav = req.headers['sec-fetch-mode'] === 'navigate', rid = nextRid++;
    let body; try { body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req); } catch { return plain(req, res, 413, 'request body over 32 MiB'); }
    const redirectOf = channel.redirects.get(real) ?? null; if (redirectOf !== null) channel.redirects.delete(real);
    const decision = await ask(channel, { t: 'request', rid, view, url: real, method: req.method, nav, dest: String(req.headers['sec-fetch-dest'] ?? ''), user: req.headers['sec-fetch-user'] === '?1', redirectOf,
      headers: Object.entries(req.headers).filter(([name]) => !DROP_REQUEST.has(name) && !name.startsWith('sec-')).map(([name, value]) => [name, String(value)]) }, ASK_MS);
    if (!decision || !decision.allow) {
      note({ method: req.method, url: shown(real), status: 0, error: decision?.reason ?? 'refused', ms: Date.now() - started, via: 'webview' });
      if (decision?.status) return plain(req, res, decision.status, decision.reason ?? '');   // the lab cancelled a navigation (204) or answered a status
      return res.destroy();   // refused by the device's policy: the frame sees a network error, as for a host that does not resolve
    }
    if (decision.respond) {   // the app's own answer (shouldInterceptRequest)
      const bytes = Buffer.from(decision.respond.body ?? '', 'base64');
      cors(req, res); res.statusCode = decision.respond.status || 200; res.statusMessage = decision.respond.reason || http.STATUS_CODES[res.statusCode] || '';
      res.setHeader('Content-Type', decision.respond.mime || 'application/octet-stream'); res.setHeader('Cache-Control', 'no-store'); if (decision.csp) res.setHeader('Content-Security-Policy', decision.csp);
      const html = /^text\/html/i.test(decision.respond.mime ?? '') && decision.inject ? Buffer.from(injectIntoHead(bytes.toString('latin1'), decision.inject), 'latin1') : bytes;
      res.setHeader('Content-Length', String(html.length)); channel.say({ t: 'done', rid, bytes: html.length });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) { if (DROP_REQUEST.has(name) || name.startsWith('sec-') || name.startsWith('x-apkweb-')) continue; for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v); }
    if (decision.cookie) headers.set('cookie', decision.cookie);
    if (decision.userAgent) headers.set('user-agent', decision.userAgent);
    if (req.headers.origin && decision.origin) headers.set('origin', decision.origin);
    if (decision.referer) headers.set('referer', decision.referer);
    headers.set('accept-encoding', 'gzip, deflate, br');
    let target; try { target = new URL(decision.upstream || real); } catch { return plain(req, res, 400, 'invalid upstream URL'); }
    const controller = new AbortController(); res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    let response;
    try { response = await upstream(target, req.method, headers, body, { signal: controller.signal, timeoutMs }); }
    catch (error) {
      const code = error?.code ?? 'EFETCH', message = String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 300);
      channel.say({ t: 'response', rid, error: { code, message } });
      note({ method: req.method, url: shown(real), status: 502, error: code, ms: Date.now() - started, via: 'webview' });
      if (nav) return plain(req, res, 502, `${code}: ${message}`);
      return res.destroy();
    }
    const status = response.statusCode, setCookie = response.headers['set-cookie'] ?? [], location = response.headers.location;
    let next = null; if ([301, 302, 303, 307, 308].includes(status) && location) { try { next = new URL(location, real).href; } catch { next = null; } }
    const listed = []; for (const [name, value] of Object.entries(response.headers)) if (name !== 'set-cookie') for (const v of Array.isArray(value) ? value : [value]) listed.push([name, String(v)]);
    channel.say({ t: 'response', rid, status, reason: response.statusMessage ?? '', headers: listed, setCookie, location: next });   // before the frame can follow the redirect: its cookies are stored first
    note({ method: req.method, url: shown(real), status, ms: Date.now() - started, via: 'webview' });
    cors(req, res);
    res.statusCode = status; res.statusMessage = response.statusMessage || http.STATUS_CODES[status] || '';
    const exposed = [];
    for (const [name, value] of Object.entries(response.headers)) { if (DROP_RESPONSE.has(name) || name.startsWith('access-control-')) continue; res.setHeader(name, value); exposed.push(name); }
    if (req.headers.origin && exposed.length) res.setHeader('Access-Control-Expose-Headers', exposed.join(', '));
    if (decision.csp) res.setHeader('Content-Security-Policy', decision.csp);   // the lab's policy for the document and what it loads (src/webview-bridge.js relayCsp)
    res.setHeader('Cache-Control', 'no-store');   // every request must come back here: the lab decides each one (policy, cookies, its log)
    if (next) { channel.redirects.set(next, rid); res.setHeader('Location', toSlot(channel, view, next)); }
    const type = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const markup = type === 'text/html' || type === 'application/xhtml+xml', css = type === 'text/css';
    if (req.method === 'HEAD' || !(markup || css) || status === 204 || status === 304) {
      let bytes = 0; response.on('data', chunk => { bytes += chunk.length; });
      response.on('end', () => channel.say({ t: 'done', rid, bytes })); response.on('error', () => res.destroy());
      return response.pipe(res);
    }
    let raw; try { raw = await readBody(response, MAX_DOCUMENT); } catch (error) { channel.say({ t: 'response', rid, error: { code: error?.code ?? 'ECONNRESET', message: 'the document could not be read' } }); return res.destroy(); }
    let text; try { text = decode(raw, response.headers['content-encoding']).toString('latin1'); } catch (error) { channel.say({ t: 'response', rid, error: { code: error.code ?? 'EENCODING', message: error.message } }); return res.destroy(); }
    const map = value => { const absolute = /^(https?:)?\/\//i.test(value); if (!absolute) return value; try { const parsed = new URL(value, real); return parsed.origin === origin ? value.replace(/^(https?:)?\/\/[^/?#]+/i, slotBase(slotFor(channel, view, origin))) : toSlot(channel, view, parsed.href); } catch { return value; } };
    text = rewriteMarkup(text, map, { html: markup });
    if (markup && decision.inject) text = injectIntoHead(text, decision.inject);
    const out = Buffer.from(text, 'latin1');
    res.removeHeader('content-encoding'); res.setHeader('Content-Length', String(out.length));
    channel.say({ t: 'done', rid, bytes: out.length });
    res.end(out);
  }

  /** /__apkweb/*: the document's synchronous calls, and /__apkweb/go?u=<url> (the slot of a URL a script built for another origin). */
  async function special(req, res, channel, view, origin, url) {
    if (url.pathname === '/__apkweb/go') {
      const target = url.searchParams.get('u') ?? '';
      let parsed; try { parsed = new URL(target); } catch { return plain(req, res, 400, 'invalid u'); }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return plain(req, res, 400, 'only http and https');
      cors(req, res); res.statusCode = 307; res.setHeader('Location', toSlot(channel, view, parsed.href)); res.setHeader('Cache-Control', 'no-store'); return res.end();
    }
    const kind = { '/__apkweb/js': 'js', '/__apkweb/cookie': 'cookie', '/__apkweb/nav': 'nav' }[url.pathname];
    if (!kind || req.method !== 'POST') return plain(req, res, 404, 'unknown');
    let body; try { body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8')); } catch { return plain(req, res, 400, 'a JSON body is expected'); }
    const cid = nextCid++, answer = await ask(channel, { t: 'call', cid, view, kind, origin, body }, CALL_MS);
    cors(req, res); res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(answer ?? { ok: false, error: 'the lab did not answer' }));
  }

  /** The lab's channel (an upgrade of /<token>/webview). */
  function channel(req, socket) {
    const origin = req.headers.origin ?? '';
    const refuse = (status, text, message) => { socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${message}`); };
    if (!allowed.has(origin)) return refuse(403, 'Forbidden', `origin not allowed: ${origin || '(none)'}`);
    const key = req.headers['sec-websocket-key']; if (!key || String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket') return refuse(400, 'Bad Request', 'a WebSocket upgrade is expected');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${createHash('sha1').update(key + WS_GUID).digest('base64')}`, '', ''].join('\r\n'));
    socket.setNoDelay?.(true);
    const state = { closed: false, slots: new Map(), pending: new Map(), redirects: new Map(), socket, say: value => { if (!state.closed && !socket.destroyed) socket.write(wsFrame(0x1, Buffer.from(JSON.stringify(value)))); } };
    channels.add(state);
    const forget = view => { for (const [slotKey, label] of [...state.slots]) if (view === null || slotKey.startsWith(`${view} `)) { state.slots.delete(slotKey); labels.delete(label); } };
    const close = () => { if (state.closed) return; state.closed = true; channels.delete(state); forget(null); for (const resolve of [...state.pending.values()]) resolve(null); state.pending.clear(); };
    const onText = text => {
      let message; try { message = JSON.parse(text); } catch { return; }
      if (message?.t === 'open') {
        let parsed; try { parsed = new URL(String(message.url)); } catch { parsed = null; }
        if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !Number.isSafeInteger(message.view)) { state.say({ t: 'opened', id: message.id, error: 'only http and https documents' }); return; }
        state.say({ t: 'opened', id: message.id, frameUrl: toSlot(state, message.view, parsed.href) });
      } else if (message?.t === 'decision') state.pending.get(`r${message.rid}`)?.(message);
      else if (message?.t === 'result') state.pending.get(`c${message.cid}`)?.(message.body ?? null);
      else if (message?.t === 'forget' && Number.isSafeInteger(message.view)) forget(message.view);
    };
    const decodeFrames = wsDecoder();
    socket.on('data', chunk => {
      for (const { opcode, payload } of decodeFrames(chunk)) {
        if (opcode === 0x1) onText(payload.toString('utf8'));
        else if (opcode === 0x9) socket.write(wsFrame(0xA, payload));
        else if (opcode === 0x8) { close(); if (!socket.destroyed) socket.end(wsFrame(0x8, Buffer.from([1000 >> 8, 1000 & 255]))); }
      }
    });
    socket.on('error', () => {}); socket.on('close', close);
    state.say({ t: 'hello', v: WEBVIEW_VERSION, suffix: 'localhost', port: port() });
  }
  const shown = real => { try { const parsed = new URL(real); return `${parsed.protocol}//${parsed.host}${parsed.pathname}`; } catch { return '(invalid url)'; } };
  return { owns, serve, channel, channelCount: () => channels.size, slotCount: () => labels.size, close: () => { for (const state of [...channels]) state.socket.destroy(); } };
}

module.exports = { WEBVIEW_VERSION, createWebViewRelay, injectIntoHead, rewriteMarkup, decode };
