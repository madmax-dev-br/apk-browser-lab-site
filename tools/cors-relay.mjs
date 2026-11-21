#!/usr/bin/env node
// Local CORS relay for APK Web Lab: the browser refuses every response whose server does not authorise the lab's origin (CORS), and the servers a real APK talks to never do. The lab
// can send its requests through a relay instead (Controles > Dispositivo > Proxy, `{url}` placeholder; src/network-transport.js openExchange), and this is that relay: it repeats each
// request from this machine, as the device would send it, and answers the page with CORS headers.
//
//   node scripts/cors-relay.mjs [--port 8787] [--origin <lab origin>]... [--config-dir <dir>] [--ca <ca.pem>]...
//   (--ca: CA certificates to trust besides the system's, for a server with an internal CA; the file is read again whenever it changes, no restart needed)
//
// No token (the owner's decision, 2026-11-20): on the default port the lab finds the relay by itself (GET /hello, src/relay-detect.js) and uses it with the Proxy field left empty;
// on another port, put the printed address (http://127.0.0.1:<port>/?url={url}) in the Proxy field. A port given with --port is saved (settings.json in the folder the APK Lab Relay
// desktop app uses: ~/Library/Application Support/apk-lab-relay on macOS, %APPDATA%\apk-lab-relay on Windows, $XDG_CONFIG_HOME or ~/.config/apk-lab-relay elsewhere; --config-dir or
// APKWEB_RELAY_CONFIG_DIR choose another), so the address stays the same from one start to the next. An address from an older relay (http://127.0.0.1:<port>/<token>/?url={url})
// keeps working: a first path segment before the relay's own paths is accepted and ignored. --token and --new-token, from older versions, are accepted and do nothing.
//
// Contract with src/network-transport.js:
//  - the target is the `url` query parameter; headers a browser may not send (Cookie, User-Agent, Origin, Referer ...) arrive as `x-apkweb-<name>` and are sent under their own name;
//  - redirects are followed here (a browser hides redirect responses from the page);
//  - Set-Cookie, which a browser never exposes, comes back as `x-apkweb-set-cookie`: a JSON array of the Set-Cookie values;
//  - a failure to reach the target (unknown host, refused, timed out, bad certificate) is a 502 carrying `x-apkweb-relay-error-code` (the Node error code) and `x-apkweb-relay-error`
//    (its message), which the lab turns into the exception an Android device would throw (UnknownHostException, ConnectException, SSLHandshakeException ...).
//
//  - a client certificate (mTLS): the lab hands the device's client identity for one host -- what the app's KeyManager chose for it, the private key (PKCS#8) and the certificate
//    chain (DER) -- as POST ?url=<https://host[:port]/>&client-identity=1 with {"key": base64, "chain": [base64, ...]} (an empty chain forgets it; ?client-identity=forget-all, which the lab sends before the first request of a session, forgets every one). The relay keeps it in memory only,
//    never writes or logs it, and presents it in the TLS handshakes to that host and port only: the HTTPS requests and the TLS tunnel (/tcp?tls=1). Other hosts never see it.
//    Its answers to those POSTs carry `x-apkweb-relay-features: client-identity`: the lab sends a key only to a relay that says it keeps it (another relay would forward the POST).
//  - a request (or tunnel) that needs the identity carries `client-identity-key=<id of its leaf certificate>` in the relay's query: a relay that holds no identity for that
//    destination (it was restarted: identities live in memory only) answers 502 `APKWEB_RELAY_NO_CLIENT_IDENTITY` instead of reaching the server without the certificate, and the lab
//    hands the identity again and repeats the request (src/network-transport.js openExchange, src/tcp-tunnel.js).
//  - GET /hello from an allowed page answers {"relay":"apk-lab-relay","version","features":[...]}: how the lab tells this relay from any other server on the port.
//  - the parallel channel (/mux, a WebSocket; Device > "Parallel relay channel" in the lab, src/relay-mux.js): many exchanges at once over one connection, multiplexed by id,
//    each answered by the same code as the per-request path (headers restored, redirects, Set-Cookie, error codes, timeouts), with a credit window per exchange so a slow reader
//    never makes either side buffer without bound. Protocol in muxChannel below and in docs/NETWORK.md "Parallel relay channel".
//
// Safety: it listens on 127.0.0.1 only (other machines cannot reach it), and every request must come from one of the allowed origins (the public lab and a local copy by default,
// checked on each request, WebSocket upgrades included), so another site open in the same browser cannot use it. There is no token: a program on this machine can use the relay
// as it could reach the internet by itself. Destinations are not restricted (the owner's decision, 2026-11-16: the relay is meant to be free): the
// internet, this machine and the local network are all reachable. --allow-private, from older versions, is accepted and does nothing. It keeps no cookies and stores nothing but its
// settings (the port): what the app sends passes through and is forgotten.
import http from 'node:http';
import https from 'node:https';
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import net, { isIP } from 'node:net';
import tls from 'node:tls';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
const { createWebViewRelay } = createRequire(import.meta.url)('./relay-webview.cjs');   // WebView documents: the same file as the desktop relay's src/webview.cjs

export const DEFAULT_ORIGINS = ['https://madmax-dev-br.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host', 'content-length', 'expect']);
const FROM_BROWSER = new Set(['origin', 'referer', 'cookie', 'accept-encoding', 'user-agent']);   // the browser's own values (the app's, if it set them, come as x-apkweb-*)
const RESPONSE_DROP = new Set(['transfer-encoding', 'connection', 'keep-alive', 'set-cookie']);   // Content-Encoding stays: the browser decodes the body as it would from the server itself
const MAX_BODY = 32 * 1024 * 1024;
export const NO_IDENTITY_CODE = 'APKWEB_RELAY_NO_CLIENT_IDENTITY', FEATURES = 'client-identity';
export const DEFAULT_PORT = 8787, RELAY_VERSION = '0.5.0', RELAY_NAME = 'apk-lab-relay';   // kept equal to src/relay-detect.js (tests/relay-detect.test.mjs checks it)
const ENDPOINTS = new Set(['hello', 'mux', 'webview', 'tcp']), SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
/**
 * What a path asks for: 'request' (/ with ?url=...), 'hello', 'mux', 'webview', 'tcp', or null. An address from an older relay carried a token as its first segment
 * (/<token>/?url=, /<token>/mux ...): that segment is accepted and ignored, so a Proxy address saved before keeps working.
 */
export function relayRoute(pathname) {
  const parts = String(pathname ?? '').split('/').slice(1);   // '/a/b' -> ['a', 'b']; '/' -> ['']
  if (parts.length === 1) return parts[0] === '' ? 'request' : ENDPOINTS.has(parts[0]) ? parts[0] : SEGMENT.test(parts[0]) ? 'request' : null;
  if (parts.length === 2 && SEGMENT.test(parts[0]) && !ENDPOINTS.has(parts[0])) return parts[1] === '' ? 'request' : ENDPOINTS.has(parts[1]) ? parts[1] : null;
  return null;
}


/**
 * The relay as an http.Server (not listening yet). `origins`: the page origins allowed to use it (a `token` option, from older versions, is ignored). Upstream requests go through node:http(s), not fetch: fetch adds headers of its own (Sec-Fetch-Mode, Accept-Language ...) that the app
 * never sent; here the target sees exactly the app's request.
 */
export function createRelay({ origins = DEFAULT_ORIGINS, timeoutMs = 60000, ca: caOption = null, lookup = null } = {}) {
  const ca = typeof caOption === 'function' ? caOption : () => caOption;   // a function is asked at every connection (caFromFiles: a changed --ca file takes effect without a restart)
  const allowed = new Set(origins.map(origin => origin.replace(/\/$/, '')));
  const identities = new Map();   // 'host:port' -> { key, cert } (PEM) and its id, the device's client identity for that destination, in memory only
  const agents = keepAliveAgents();   // upstream connections kept alive per destination, for the per-request path and the channel alike
  const transport = { agents, ...(lookup ? { lookup: nodeLookup(lookup) } : {}) };   // lookup: the name resolver of the upstream connections (tests answer it locally; Node's dns.lookup otherwise)
  const cors = (origin, res, extra = {}) => { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); for (const [name, value] of Object.entries(extra)) res.setHeader(name, value); };
  const fail = (res, status, message) => { res.statusCode = status; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(message); };
  const server = http.createServer(async (req, res) => {
    if (webview.owns(req)) return webview.serve(req, res);   // a WebView document (http://<label>.localhost:<port>/...): scripts/relay-webview.cjs, docs/NETWORK.md "WebView documents"
    const origin = req.headers.origin ?? '';
    const url = new URL(req.url, 'http://relay.invalid'), route = relayRoute(url.pathname);
    if (route !== 'request' && route !== 'hello') return fail(res, 404, 'unknown path');
    if (!allowed.has(origin)) return fail(res, 403, `origin not allowed: ${origin || '(none)'}; start the relay with --origin ${origin || '<origin>'}`);
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {   // the browser's preflight
      cors(origin, res, { 'Access-Control-Allow-Methods': req.headers['access-control-request-method'], 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '', 'Access-Control-Max-Age': '600', ...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}) });
      res.statusCode = 204; return res.end();
    }
    if (route === 'hello') {   // the lab's detection (src/relay-detect.js): this is the APK Lab Relay, and what it has
      cors(origin, res); res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify({ relay: RELAY_NAME, version: RELAY_VERSION, features: ['client-identity', 'mux', 'webview', 'tcp'] }));
    }
    const target = url.searchParams.get('url');
    let parsed; try { parsed = new URL(target ?? ''); } catch { cors(origin, res); return fail(res, 400, 'missing or invalid url parameter'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { cors(origin, res); return fail(res, 400, `unsupported scheme ${parsed.protocol}`); }
    const features = { 'x-apkweb-relay-features': FEATURES, 'Access-Control-Expose-Headers': 'x-apkweb-relay-features' };   // "this relay keeps client identities" (the lab sends a key to no other)
    if (url.searchParams.get('client-identity') === 'forget-all' && req.method === 'POST') { identities.clear(); cors(origin, res, features); res.statusCode = 204; return res.end(); }   // a new lab session: the identities of the previous one are gone
    if (url.searchParams.get('client-identity') === '1') {
      if (req.method !== 'POST' || parsed.protocol !== 'https:') { cors(origin, res); return fail(res, 400, 'a client identity is POSTed for an https:// destination'); }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) { cors(origin, res); return fail(res, 413, 'client identity over 1 MiB'); } chunks.push(chunk); }
      let identity; try { identity = parseIdentity(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { cors(origin, res); return fail(res, 400, `invalid client identity: ${error.message}`); }
      const where = destination(parsed.hostname, parsed.port || '443');
      if (identity) identities.set(where, identity); else identities.delete(where);
      cors(origin, res, features); res.statusCode = 204; return res.end();
    }
    const relayError = (code, message) => { cors(origin, res, { 'x-apkweb-relay-error-code': code, 'x-apkweb-relay-error': message.replace(/[\r\n]+/g, ' ').slice(0, 300), 'Access-Control-Expose-Headers': 'x-apkweb-relay-error-code, x-apkweb-relay-error' }); fail(res, 502, `${code}: ${message}`); };
    const missing = missingIdentity(identities, url.searchParams, parsed.protocol === 'https:' ? destination(parsed.hostname, parsed.port || '443') : null);
    if (missing) { req.resume(); return relayError(NO_IDENTITY_CODE, missing); }
    const headers = upstreamHeaders(Object.entries(req.headers));
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) { cors(origin, res); return fail(res, 413, 'request body over 32 MiB'); } chunks.push(chunk); }
      body = Buffer.concat(chunks);
    }
    let response;
    try { response = await send(parsed, req.method, headers, body, timeoutMs, 0, identities, ca, transport); }
    catch (error) { return relayError(error?.code ?? 'EFETCH', String(error?.message ?? error)); }
    const exposed = [];
    for (const [name, value] of Object.entries(response.headers)) { const lower = name.toLowerCase(); if (RESPONSE_DROP.has(lower) || lower.startsWith('access-control-')) continue; res.setHeader(name, value); exposed.push(name); }
    const cookies = response.headers['set-cookie'] ?? [];
    if (cookies.length) { res.setHeader('x-apkweb-set-cookie', JSON.stringify(cookies)); exposed.push('x-apkweb-set-cookie'); }
    cors(origin, res, exposed.length ? { 'Access-Control-Expose-Headers': exposed.join(', ') } : {});
    res.statusCode = response.statusCode; res.statusMessage = response.statusMessage || res.statusMessage;
    if (req.method === 'HEAD') { response.resume(); return res.end(); }
    response.on('error', () => res.destroy()).pipe(res);
  });
  const sessions = new Set();   // the open channels, so close() ends them (a WebSocket is not an HTTP request the server would wait for)
  // WebView documents: one hop per request (the frame follows redirects itself, so the lab decides each one), with the relay's resolver, --ca roots and client identities
  const webview = createWebViewRelay({ allowed, timeoutMs, port: () => server.address()?.port ?? 0,
    upstream: (target, method, headers, body, { signal, timeoutMs: ms }) => send(target, method, headers, body, ms ?? timeoutMs, 0, identities, ca, { ...transport, signal, manualRedirects: true }) });
  server.on('upgrade', (req, socket) => {
    const route = relayRoute(new URL(req.url, 'http://relay.invalid').pathname);
    if (route === 'webview') return webview.channel(req, socket);
    if (route === 'mux') return muxChannel({ req, socket, allowed, answer: exchange => relayAnswer({ ...exchange, identities, ca, timeoutMs, transport }), sessions });
    return tunnel({ req, socket, route, allowed, timeoutMs, identities, ca });
  });
  const close = server.close.bind(server);   // an upgraded socket keeps the server open, so close() ends the channels and the kept-alive upstream connections first
  server.close = callback => { webview.close(); for (const socket of sessions) socket.destroy(); for (const agent of Object.values(agents)) agent.destroy(); return close(callback); };
  server.clientIdentityCount = () => identities.size;
  server.channelCount = () => sessions.size;
  server.webviewChannelCount = () => webview.channelCount();
  server.closeChannels = () => { for (const socket of sessions) socket.destroy(); };   // drops every open channel at once (as a relay that stops does)
  return server;
}

/** A resolver given as a callback (dns.lookup's shape) or as a function returning a promise of { address, family } (or a list), in the callback form Node's sockets call. */
function nodeLookup(lookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    let settled = false;
    const done = (error, result) => { if (settled) return; settled = true; if (error) return callback(error); const list = Array.isArray(result) ? result : [result]; if (options?.all) callback(null, list); else callback(null, list[0].address, list[0].family); };
    try { const out = lookup(hostname, options, (error, address, family) => done(error, Array.isArray(address) ? address : { address, family })); if (out && typeof out.then === 'function') out.then(result => done(null, result), error => done(error)); }
    catch (error) { done(error); }
  };
}
/** One keep-alive agent per scheme: Node pools its connections per destination (host:port), so the exchanges to one server reuse their TCP (and TLS) connections. */
function keepAliveAgents() { return { 'http:': new http.Agent({ keepAlive: true }), 'https:': new https.Agent({ keepAlive: true }) }; }

/**
 * The headers the target gets, from the headers the lab sent ([name, value] entries, a value may be an array): the app's own, the ones a browser may not send restored from
 * `x-apkweb-<name>`, none of the browser's (Origin, Referer, Sec-*, its Cookie and User-Agent) and no hop-by-hop header. The same rule for the per-request path and the channel.
 */
function upstreamHeaders(entries) {
  const headers = new Headers();
  for (const [name, value] of entries) {
    const lower = String(name).toLowerCase(), values = Array.isArray(value) ? value : [value];
    if (lower.startsWith('x-apkweb-')) { const original = lower.slice('x-apkweb-'.length); if (original !== 'accept-encoding' && !HOP_BY_HOP.has(original)) for (const v of values) headers.append(original, v); continue; }
    if (HOP_BY_HOP.has(lower) || FROM_BROWSER.has(lower) || lower.startsWith('sec-') || lower.startsWith('access-control-')) continue;
    for (const v of values) headers.append(name, v);
  }
  return headers;
}
/** The target's response headers as the page gets them through the per-request path: hop-by-hop and the target's CORS headers left out, Set-Cookie as x-apkweb-set-cookie (JSON). */
function pageHeaders(response) {
  const out = [];
  for (const [name, value] of Object.entries(response.headers)) { const lower = name.toLowerCase(); if (RESPONSE_DROP.has(lower) || lower.startsWith('access-control-')) continue; for (const v of Array.isArray(value) ? value : [value]) out.push([name, String(v)]); }
  const cookies = response.headers['set-cookie'] ?? [];
  if (cookies.length) out.push(['x-apkweb-set-cookie', JSON.stringify(cookies)]);
  return out;
}

/**
 * One exchange of the channel, decided exactly as the per-request path decides it: `params` is the relay's query (url, client-identity-key), `headers` the lab's headers.
 * -> { local: { status, message } } (the relay's own answer: a bad url, a body over 32 MiB), { error: { code, message } } (the target could not be reached: the per-request path's
 * 502 with x-apkweb-relay-error-code), or { response } (the target's http.IncomingMessage, redirects already followed).
 */
async function relayAnswer({ method, params, headers: entries, body, length = 0, identities, ca, timeoutMs, transport = {}, signal }) {
  const target = params.get('url');
  let parsed; try { parsed = new URL(target ?? ''); } catch { return { local: { status: 400, message: 'missing or invalid url parameter' } }; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { local: { status: 400, message: `unsupported scheme ${parsed.protocol}` } };
  if (params.get('client-identity')) return { local: { status: 400, message: 'a client identity is handed over the per-request path, not the channel' } };
  const missing = missingIdentity(identities, params, parsed.protocol === 'https:' ? destination(parsed.hostname, parsed.port || '443') : null);
  if (missing) return { error: { code: NO_IDENTITY_CODE, message: missing } };
  if (length > MAX_BODY) return { local: { status: 413, message: 'request body over 32 MiB' } };
  try { return { response: await send(parsed, method, upstreamHeaders(entries), method !== 'GET' && method !== 'HEAD' && body?.length ? body : undefined, timeoutMs, 0, identities, ca, { ...transport, signal }) }; }
  catch (error) { return { error: { code: error?.code ?? 'EFETCH', message: String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 300) } }; }
}

// ---- The parallel channel (/mux) --------------------------------------------------------------------------------------------------------------------------------------------
// One WebSocket from the lab carries many exchanges at once, multiplexed by id; each runs here concurrently, through Node's HTTP client (keep-alive agents), decided by relayAnswer.
// Text messages are JSON control messages, binary messages body bytes: [kind u8][id u32 big-endian][bytes] (kind 1: request body, lab -> relay; kind 2: response body, relay -> lab).
//   relay -> lab  {"t":"hello","v":1,"window":262144,"maxBody":33554432,"frame":65536}       the first message: this relay has the channel (an older relay refuses the upgrade)
//   lab -> relay  {"t":"req","id":n,"method","query":"?url=...","headers":[[name,value]...],"length":bytes}   then `length` request body bytes in kind-1 frames (none above maxBody)
//   relay -> lab  {"t":"head","id":n,"status","statusText","headers":[[name,value]...]}       the headers the per-request path gives the page (x-apkweb-set-cookie included)
//   relay -> lab  kind-2 frames, never more than the credit the lab granted: `window` bytes at first, plus every {"t":"credit","id":n,"n":bytes} the lab sends as its reader consumes
//   relay -> lab  {"t":"end","id":n}  |  {"t":"error","id":n,"code","message"}   (before the head: the per-request path's 502 relay error; after it: the body failed)
//   lab -> relay  {"t":"abort","id":n}   the app closed the exchange: the upstream request is destroyed
// A Content-Encoding the browser would have decoded on the per-request path (gzip, deflate, br, zstd) is decoded here, nothing else: the lab gets the bytes the page would have got.
// Nothing is compressed, cached or kept. Backpressure: a full socket (write() false) holds every exchange's body until 'drain'; an exchange out of credit pauses its upstream.
export const MUX_VERSION = 1;
const MUX_WINDOW = 256 * 1024, MUX_FRAME = 64 * 1024, KIND_REQUEST_BODY = 1, KIND_RESPONSE_BODY = 2;
const NULL_BODY = new Set([101, 103, 204, 205, 304]);   // statuses fetch gives no body for
/** A binary WebSocket frame (unmasked, server -> client) holding [kind][id][bytes], written in one buffer. */
function muxFrame(kind, id, bytes) {
  const n = 5 + bytes.length, head = n < 126 ? 2 : n < 65536 ? 4 : 10, out = Buffer.allocUnsafe(head + n);
  out[0] = 0x82; if (n < 126) out[1] = n; else if (n < 65536) { out[1] = 126; out.writeUInt16BE(n, 2); } else { out[1] = 127; out.writeUInt32BE(Math.floor(n / 0x100000000), 2); out.writeUInt32BE(n >>> 0, 6); }
  out[head] = kind; out.writeUInt32BE(id >>> 0, head + 1); bytes.copy(out, head + 5); return out;
}
/** The body as the page would have read it: a Content-Encoding the browser decodes (gzip, x-gzip, deflate zlib or raw, br, zstd) undone; any other (or several) left as it came. */
async function decodedBody(response) {
  const coding = String(response.headers['content-encoding'] ?? '').trim().toLowerCase();
  if (coding === 'gzip' || coding === 'x-gzip') return response.pipe(zlib.createGunzip({ finishFlush: zlib.constants.Z_SYNC_FLUSH }));
  if (coding === 'br') return response.pipe(zlib.createBrotliDecompress());
  if (coding === 'zstd' && typeof zlib.createZstdDecompress === 'function') return response.pipe(zlib.createZstdDecompress());
  if (coding !== 'deflate') return response;
  // "deflate" is zlib-wrapped by the standard, raw by some servers; a browser takes both. The first bytes say which.
  const first = await new Promise(resolve => { const done = value => { response.off('data', onData); response.off('end', onEnd); response.off('error', onEnd); response.pause(); resolve(value); }, onData = chunk => done(chunk), onEnd = () => done(null); response.on('data', onData); response.once('end', onEnd); response.once('error', onEnd); });
  if (!first) return Readable.from([]);
  const wrapped = first.length >= 2 && (first[0] & 0x0f) === 8 && ((first[0] << 8) | first[1]) % 31 === 0;
  const decoder = wrapped ? zlib.createInflate({ finishFlush: zlib.constants.Z_SYNC_FLUSH }) : zlib.createInflateRaw({ finishFlush: zlib.constants.Z_SYNC_FLUSH });
  decoder.write(first);
  if (response.readableEnded) decoder.end(); else response.pipe(decoder);   // a body of one chunk has ended already
  return decoder;
}
/** The channel's upgrade: the same origin rule as the per-request path. `answer(exchange)` decides an exchange (relayAnswer). */
function muxChannel({ req, socket, allowed, answer, sessions, onExchange = () => {} }) {
  const origin = req.headers.origin ?? '';
  const refuse = (status, text, message) => { socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${message}`); };
  if (!allowed.has(origin)) return refuse(403, 'Forbidden', `origin not allowed: ${origin || '(none)'}`);
  const key = req.headers['sec-websocket-key']; if (!key || String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket') return refuse(400, 'Bad Request', 'a WebSocket upgrade is expected');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${createHash('sha1').update(key + WS_GUID).digest('base64')}`, '', ''].join('\r\n'));
  socket.setNoDelay?.(true); sessions?.add(socket);
  const exchanges = new Map(); let blocked = false, closed = false;
  const write = frame => { if (closed || socket.destroyed) return false; if (!socket.write(frame)) blocked = true; return true; };
  const say = value => write(wsFrame(0x1, Buffer.from(JSON.stringify(value))));
  const protocolError = text => { say({ t: 'error', id: 0, code: 'EPROTO', message: text }); closed = true; socket.end(wsFrame(0x8, Buffer.from([1002 >> 8, 1002 & 255]))); };
  const forget = exchange => { exchanges.delete(exchange.id); exchange.done = true; };
  const finish = exchange => { if (exchange.done) return; forget(exchange); say({ t: 'end', id: exchange.id }); onExchange(exchange, null); };
  const failed = (exchange, code, message) => { if (exchange.done) return; forget(exchange); say({ t: 'error', id: exchange.id, code, message: String(message).replace(/[\r\n]+/g, ' ').slice(0, 300) }); onExchange(exchange, code); };
  // sends what the exchange's credit and the socket allow; the upstream is paused while bytes wait, resumed once they left
  const pump = exchange => {
    while (exchange.pending.length && exchange.credit > 0 && !blocked && !exchange.done) {
      const chunk = exchange.pending[0], n = Math.min(chunk.length, exchange.credit, MUX_FRAME);
      write(muxFrame(KIND_RESPONSE_BODY, exchange.id, n === chunk.length ? chunk : chunk.subarray(0, n)));
      exchange.credit -= n; exchange.waiting -= n; if (n === chunk.length) exchange.pending.shift(); else exchange.pending[0] = chunk.subarray(n);
    }
    if (exchange.source && !exchange.done) { if (exchange.waiting > 0) exchange.source.pause(); else exchange.source.resume(); }
    if (exchange.ended && !exchange.pending.length) finish(exchange);
  };
  const start = async exchange => {
    const controller = new AbortController(); exchange.controller = controller;
    const body = exchange.chunks.length ? Buffer.concat(exchange.chunks) : null; exchange.chunks = [];
    const result = await answer({ method: exchange.method, params: exchange.params, headers: exchange.headers, body, length: exchange.length, signal: controller.signal });
    if (exchange.done || closed) { result.response?.destroy(); return; }   // aborted (or the channel closed) while the target was being asked
    if (result.error) return failed(exchange, result.error.code, result.error.message);
    if (result.local) {
      const text = Buffer.from(result.local.message);
      say({ t: 'head', id: exchange.id, status: result.local.status, statusText: http.STATUS_CODES[result.local.status] ?? '', headers: [['content-type', 'text/plain; charset=utf-8'], ['content-length', String(text.length)]] });
      exchange.pending.push(text); exchange.waiting += text.length; exchange.ended = true; return pump(exchange);
    }
    const response = result.response; exchange.status = response.statusCode;
    say({ t: 'head', id: exchange.id, status: response.statusCode, statusText: response.statusMessage || http.STATUS_CODES[response.statusCode] || '', headers: pageHeaders(response) });
    if (exchange.method === 'HEAD' || NULL_BODY.has(response.statusCode)) { response.resume(); return finish(exchange); }
    let source; try { source = await decodedBody(response); } catch (error) { response.destroy(); return failed(exchange, error?.code ?? 'EFETCH', error?.message ?? error); }
    if (exchange.done || closed) { response.destroy(); return; }
    exchange.source = source; exchange.response = response;
    source.on('data', chunk => { exchange.pending.push(chunk); exchange.waiting += chunk.length; pump(exchange); });
    source.on('end', () => { exchange.ended = true; pump(exchange); });
    const broken = error => { if (!exchange.done) { response.destroy(); failed(exchange, error?.code ?? 'ECONNRESET', error?.message ?? 'the target closed the connection'); } };
    source.on('error', broken); if (source !== response) response.on('error', broken);
    response.on('close', () => { if (!response.complete) broken(Object.assign(new Error('the target closed the connection before the end of the body'), { code: 'ECONNRESET' })); });
  };
  const onText = text => {
    let message; try { message = JSON.parse(text); } catch { return protocolError('a control message that is not JSON'); }
    const id = message?.id;
    if (message?.t === 'req') {
      if (!Number.isInteger(id) || id < 1 || id > 0xffffffff || exchanges.has(id)) return protocolError(`req: bad or duplicate id ${id}`);
      const length = Number(message.length) || 0, method = String(message.method ?? 'GET').toUpperCase();
      const exchange = { id, method, params: new URLSearchParams(String(message.query ?? '')), headers: Array.isArray(message.headers) ? message.headers.filter(pair => Array.isArray(pair) && pair.length === 2).map(([n, v]) => [String(n), String(v)]) : [],
        length, chunks: [], received: 0, credit: MUX_WINDOW, pending: [], waiting: 0, ended: false, done: false, source: null, response: null, controller: null, status: null, started: Date.now() };
      exchanges.set(id, exchange);
      if (length <= 0 || length > MAX_BODY) start(exchange);   // over the limit: the lab sends no body, the answer is the per-request path's 413
      return;
    }
    const exchange = exchanges.get(id); if (!exchange) return;   // an exchange that already ended (an abort or a credit crossing its end)
    if (message.t === 'credit') { exchange.credit += Math.max(0, Number(message.n) || 0); pump(exchange); }
    else if (message.t === 'abort') { forget(exchange); exchange.controller?.abort(); exchange.response?.destroy(); exchange.source?.destroy?.(); onExchange(exchange, 'aborted'); }
  };
  const onBinary = payload => {
    if (payload.length < 5 || payload[0] !== KIND_REQUEST_BODY) return protocolError('a binary message that is not a request body');
    const exchange = exchanges.get(payload.readUInt32BE(1)); if (!exchange || exchange.controller) return;   // aborted, or more bytes than announced (ignored once started)
    const bytes = payload.subarray(5); exchange.chunks.push(bytes); exchange.received += bytes.length;
    if (exchange.received >= exchange.length) start(exchange);
  };
  const decode = wsDecoder();
  socket.on('data', chunk => {
    for (const { opcode, payload } of decode(chunk)) {
      if (closed) return;
      if (opcode === 0x1) onText(payload.toString('utf8'));
      else if (opcode === 0x2) onBinary(payload);
      else if (opcode === 0x9) write(wsFrame(0xA, payload));
      else if (opcode === 0x8) { closed = true; if (!socket.destroyed) socket.end(wsFrame(0x8, Buffer.from([1000 >> 8, 1000 & 255]))); }
    }
  });
  socket.on('drain', () => { blocked = false; for (const exchange of [...exchanges.values()]) { pump(exchange); if (blocked) break; } });
  socket.on('error', () => {});
  socket.on('close', () => { closed = true; sessions?.delete(socket); for (const exchange of exchanges.values()) { exchange.done = true; exchange.controller?.abort(); exchange.response?.destroy(); } exchanges.clear(); });
  say({ t: 'hello', v: MUX_VERSION, window: MUX_WINDOW, maxBody: MAX_BODY, frame: MUX_FRAME });
}

// ---- TCP tunnel (/tcp): a TCP stream for a socket of the lab whose conversation is not HTTP/1.1 (HTTP/2 with prior knowledge, as gRPC clients speak; MQTT; a database
// protocol). The page opens a WebSocket here (ws://127.0.0.1:<port>/tcp?host=&port=&tls=0|1&alpn=), the relay connects to the target from this machine and copies the bytes
// both ways. First message (text JSON): {"connected":true,"alpn":...} or {"error":{"code","message"}}; then binary messages are the TCP bytes. tls=1: the relay does the TLS (the lab
// hands the app's plaintext, as its fetch path does) with the ALPN list asked for, and reports the protocol the server chose. Same origin rule as above.
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsFrame(opcode, payload) {
  const n = payload.length, head = n < 126 ? 2 : n < 65536 ? 4 : 10, out = Buffer.alloc(head + n);
  out[0] = 0x80 | opcode; if (n < 126) out[1] = n; else if (n < 65536) { out[1] = 126; out.writeUInt16BE(n, 2); } else { out[1] = 127; out.writeUInt32BE(Math.floor(n / 0x100000000), 2); out.writeUInt32BE(n >>> 0, 6); }
  payload.copy?.(out, head) ?? out.set(payload, head); return out;
}
/** The client frames (masked) of a WebSocket byte stream: push(chunk) -> [{ opcode, payload }] (fragments joined). */
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
/** 'host:port' as the identities are keyed (the host lowercased, IPv6 brackets dropped). */
const destination = (host, port) => `${String(host).toLowerCase().replace(/^\[|\]$/g, '')}:${port}`;
const pem = (label, bytes) => `-----BEGIN ${label}-----\n${bytes.toString('base64').replace(/.{1,64}/g, line => line + '\n')}-----END ${label}-----\n`;
/** The id of an identity, as the lab computes it (src/client-identity.js identityKey): the length and FNV-1a of the leaf certificate's DER. */
export const identityId = leafDer => { let h = 0x811c9dc5; for (const b of leafDer) h = Math.imul(h ^ b, 0x01000193) >>> 0; return `${leafDer.length}:${h.toString(16)}`; };
/**
 * A request that names the identity it needs (client-identity-key) for a destination this relay holds none for: the reason it must not go out, else null. A relay holding another
 * identity for it presents that one (the latest the app chose for the destination), as before.
 */
function missingIdentity(identities, params, where) {
  const wanted = params.get('client-identity-key'); if (!wanted || !where) return null;
  return identities.has(where) ? null : `the relay holds no client certificate for ${where} (it was restarted, or forgot it): the lab hands it again`;
}
/** {key: base64 PKCS#8, chain: [base64 DER]} -> { key, cert } in PEM, checked by node:crypto; null for an empty chain (forget). */
function parseIdentity(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.chain)) throw new Error('expected {"key", "chain": [...]}');
  if (body.chain.length === 0) return null;
  const keyDer = Buffer.from(String(body.key ?? ''), 'base64'), certs = body.chain.map(item => Buffer.from(String(item), 'base64'));
  const key = createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8' });   // throws for anything that is not a PKCS#8 private key
  const leaf = new X509Certificate(certs[0]); if (!leaf.checkPrivateKey(key)) throw new Error('the private key does not match the first certificate of the chain');
  return { key: pem('PRIVATE KEY', keyDer), cert: certs.map(der => pem('CERTIFICATE', der)).join(''), id: identityId(certs[0]) };
}
async function tunnel({ req, socket, route, allowed, timeoutMs, identities, ca = null }) {
  const url = new URL(req.url, 'http://relay.invalid'), origin = req.headers.origin ?? '';
  const refuse = (status, text, message) => { socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${message}`); };
  if (route !== 'tcp') return refuse(404, 'Not Found', 'unknown path');
  if (!allowed.has(origin)) return refuse(403, 'Forbidden', `origin not allowed: ${origin || '(none)'}`);
  const key = req.headers['sec-websocket-key']; if (!key || String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket') return refuse(400, 'Bad Request', 'a WebSocket upgrade is expected');
  const host = url.searchParams.get('host') ?? '', port = Number(url.searchParams.get('port')), secure = url.searchParams.get('tls') === '1', alpn = (url.searchParams.get('alpn') ?? '').split(',').map(p => p.trim()).filter(Boolean);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return refuse(400, 'Bad Request', 'host and port are required');
  const missing = missingIdentity(identities ?? new Map(), url.searchParams, secure ? destination(host, port) : null);
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${createHash('sha1').update(key + WS_GUID).digest('base64')}`, '', ''].join('\r\n'));
  socket.setNoDelay?.(true);
  const say = value => { if (!socket.destroyed) socket.write(wsFrame(0x1, Buffer.from(JSON.stringify(value)))); };
  const closeFrame = code => wsFrame(0x8, Buffer.from([code >> 8, code & 255]));
  const fail = (code, message) => { say({ error: { code, message: String(message).replace(/[\r\n]+/g, ' ').slice(0, 300) } }); socket.end(closeFrame(1011)); };
  socket.on('error', () => {});
  if (missing) return fail(NO_IDENTITY_CODE, missing);
  let connected = false;
  const roots = secure ? trusted(ca) : null;
  const identity = secure ? identities?.get(destination(host, port)) : null;
  const upstream = secure ? tls.connect({ host, port, servername: isIP(host) ? undefined : host, ALPNProtocols: alpn.length ? alpn : undefined, ...(identity ? { key: identity.key, cert: identity.cert } : {}), ...(roots ? { ca: roots } : {}) }) : net.connect({ host, port });
  const timer = setTimeout(() => { if (!connected) { upstream.destroy(); fail('ETIMEDOUT', `connect to ${host}:${port} timed out after ${timeoutMs} ms`); } }, timeoutMs);
  upstream.once(secure ? 'secureConnect' : 'connect', () => { connected = true; clearTimeout(timer); upstream.setNoDelay?.(true); say({ connected: true, alpn: secure ? upstream.alpnProtocol || null : null }); });
  upstream.on('data', chunk => { if (!socket.destroyed) socket.write(wsFrame(0x2, chunk)); });
  upstream.on('error', error => { clearTimeout(timer); if (!connected) fail(error.code ?? 'ECONNREFUSED', error.message); else socket.destroy(); });
  upstream.on('close', () => { clearTimeout(timer); if (connected && !socket.destroyed) socket.end(closeFrame(1000)); });
  const decode = wsDecoder();
  socket.on('data', chunk => {
    for (const { opcode, payload } of decode(chunk)) {
      if (opcode === 0x2 || opcode === 0x1) { if (!upstream.destroyed) upstream.write(payload); }
      else if (opcode === 0x9) socket.write(wsFrame(0xA, payload));
      else if (opcode === 0x8) { upstream.end(); if (!socket.destroyed) socket.end(closeFrame(1000)); }
    }
  });
  socket.on('close', () => { clearTimeout(timer); upstream.destroy(); });
}

/** The roots for an upstream TLS connection: the system's plus the --ca certificates of this moment, or null (the system's, Node's default) without any. */
function trusted(ca) { const extra = typeof ca === 'function' ? ca() : ca; return extra?.length ? [...tls.rootCertificates, ...extra] : null; }

/**
 * --ca files as a function the relay asks at every upstream TLS connection: each file is read again when its modification time or size changed (a renewed internal CA takes effect
 * without restarting the relay); a file that cannot be read keeps its last good content and is reported once. `warn` gets one line per problem (an expired certificate included).
 */
export function caFromFiles(files, { warn = message => console.warn(message), now = () => Date.now() } = {}) {
  const state = new Map();   // path -> { stamp, pem, reported }
  const load = file => {
    const known = state.get(file); let stamp;
    try { const stat = statSync(file); stamp = `${stat.mtimeMs}:${stat.size}`; }
    catch (error) { if (!known?.reported) warn(`--ca ${file}: ${error.message}${known?.pem ? ' (still using the copy read before)' : ''}`); if (known) known.reported = true; else state.set(file, { stamp: null, pem: null, reported: true }); return known?.pem ?? null; }
    if (known && known.stamp === stamp) return known.pem;
    let text; try { text = readFileSync(file, 'utf8'); } catch (error) { warn(`--ca ${file}: ${error.message}`); return known?.pem ?? null; }
    for (const block of text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []) {
      try { const cert = new X509Certificate(block); if (Date.parse(cert.validTo) <= now()) warn(`--ca ${file}: the certificate "${cert.subject.replace(/\n/g, ', ')}" expired on ${cert.validTo}; renew the file (it is read again when it changes)`); } catch { /* not a certificate Node can parse: the TLS handshake says so */ }
    }
    state.set(file, { stamp, pem: text, reported: false }); return text;
  };
  return () => files.map(load).filter(Boolean);
}

// ---- settings kept between starts (the port of the Proxy address), in the folder the APK Lab Relay desktop app uses -------------------------------------------
export function configDir(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.APKWEB_RELAY_CONFIG_DIR) return env.APKWEB_RELAY_CONFIG_DIR;
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'apk-lab-relay');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'apk-lab-relay');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'apk-lab-relay');
}
export function loadSettings(dir) {
  let saved; try { saved = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8')); } catch { return {}; }
  return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
}
/** Writes settings.json (owner-only; a temporary file renamed over it, so a crash never leaves half a file). Other keys (the desktop app's origins) are kept. False if it could not. */
export function saveSettings(dir, settings) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'settings.json'), temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ ...loadSettings(dir), ...settings }, null, 2) + '\n', { mode: 0o600 }); renameSync(temporary, file); return true;
  } catch { return false; }
}
/** The port of this start: --port, else the saved one, else 8787 (the port the lab looks for a relay on). A token saved by an older version is not read. */
export function resolveSettings(saved, { port = null } = {}) {
  return { port: port ?? (Number.isInteger(saved?.port) && saved.port >= 1 && saved.port <= 65535 ? saved.port : DEFAULT_PORT) };
}
/** The address for the lab's Proxy field of a relay on `port`; on DEFAULT_PORT the field stays empty (the lab finds the relay by itself). */
export const proxyAddress = port => `http://127.0.0.1:${port}/?url={url}`;

/** One upstream exchange over node:http(s), following redirects the way fetch does (at most 20; 303, and 301/302 after a POST, continue as GET without a body). */
function send(url, method, headers, body, timeoutMs, hops = 0, identities = null, ca = null, transport = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = {}; headers.forEach((value, name) => { outgoing[name] = name.toLowerCase() === 'cookie' ? value : (outgoing[name] ? `${outgoing[name]}, ${value}` : value); });
    if (body) outgoing['content-length'] = String(body.length);
    const identity = url.protocol === 'https:' ? identities?.get(destination(url.hostname, url.port || '443')) : null;   // only the destination the identity was given for
    const roots = url.protocol === 'https:' ? trusted(ca) : null;   // asked now: a renewed --ca file applies to the next connection
    const agent = transport.agents?.[url.protocol];   // the relay's keep-alive agents; a connection with its own TLS material (a client identity, --ca roots) is not pooled
    const request = (url.protocol === 'https:' ? https : http).request(url, { method, headers: outgoing, timeout: timeoutMs, ...(agent ? { agent } : {}), ...(transport.signal ? { signal: transport.signal } : {}), ...(transport.lookup ? { lookup: transport.lookup } : {}), ...(identity ? { key: identity.key, cert: identity.cert, agent: false } : {}), ...(roots ? { ca: roots, agent: false } : {}) }, response => {
      const status = response.statusCode, location = response.headers.location;
      if (!transport.manualRedirects && [301, 302, 303, 307, 308].includes(status) && location) {
        response.resume();
        if (hops >= 20) return reject(Object.assign(new Error('Too many follow-up requests: 21'), { code: 'EREDIRECT' }));
        const next = new URL(location, url), asGet = status === 303 || ((status === 301 || status === 302) && method === 'POST');
        const nextHeaders = new Headers(headers); if (asGet) { nextHeaders.delete('content-type'); nextHeaders.delete('content-length'); }
        if (next.host !== url.host) { nextHeaders.delete('authorization'); nextHeaders.delete('cookie'); }   // credentials never follow a redirect to another host, as with fetch
        return resolve(send(next, asGet ? 'GET' : method, nextHeaders, asGet ? undefined : body, timeoutMs, hops + 1, identities, ca, transport));
      }
      resolve(response);
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error(`connect to ${url.host} timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end(body);
  });
}

function parseArguments(argv) {
  const options = { port: null, origins: [], configDir: null, ca: [], ignored: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--origin') options.origins.push(argv[++i]);
    else if (arg === '--token') { i++; options.ignored.push(arg); }   // older versions: the relay has no token any more
    else if (arg === '--new-token' || arg === '--rotate-token') options.ignored.push(arg);
    else if (arg === '--config-dir') options.configDir = argv[++i];
    else if (arg === '--ca') options.ca.push(path.resolve(argv[++i]));   // a PEM file of CA certificates to trust besides the system ones (a server with an internal CA); read again when it changes
    else if (arg === '--allow-private') continue;   // older versions refused private destinations; every destination is reachable now
    else if (arg === '--help' || arg === '-h') { console.log('node scripts/cors-relay.mjs [--port 8787] [--origin <lab origin>]... [--config-dir <dir>] [--ca <ca.pem>]...\n  On port 8787 the lab finds the relay by itself (leave Controls > Device > Proxy empty); on another port, put the address it prints there. --port is saved.'); process.exit(0); }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (options.port !== null && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) throw new Error('--port must be 1-65535');
  for (const file of options.ca) readFileSync(file);   // a missing file at start-up is an error (later, a file being rewritten keeps its last good copy)
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseArguments(process.argv.slice(2));
  const dir = options.configDir ?? configDir(), { port } = resolveSettings(loadSettings(dir), options), saved = options.port === null || saveSettings(dir, { port });
  const origins = options.origins.length ? options.origins : DEFAULT_ORIGINS;
  const server = createRelay({ origins, ca: options.ca.length ? caFromFiles(options.ca) : null });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use (another relay?); start with --port <another>` : `Could not start: ${error.message}`); process.exit(1); });
  server.listen(port, '127.0.0.1', () => {
    console.log(`APK Web Lab CORS relay on http://127.0.0.1:${port} (only this machine can reach it)`);
    console.log(`Allowed page origins: ${origins.join(', ')}`);
    console.log('Destinations: any (the internet, this machine and the local network)');
    if (port === DEFAULT_PORT) console.log(`Proxy field (Controls > Device): leave it empty, the lab finds this relay by itself ("Relay found at 127.0.0.1:${port} (automatic)"); as a custom proxy: ${proxyAddress(port)}`);
    else console.log(`Proxy field (Controls > Device): ${proxyAddress(port)}   (the lab looks for a relay on port ${DEFAULT_PORT} only)`);
    if (!saved) console.log(`(the port could not be saved in ${dir}: give --port again at the next start)`);
    if (options.ignored.length) console.log(`${[...new Set(options.ignored)].join(', ')}: ignored, the relay needs no token any more`);
  });
  const stop = () => { server.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
