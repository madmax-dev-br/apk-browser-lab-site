#!/usr/bin/env node
// Local CORS relay for APK Web Lab: the browser refuses every response whose server does not authorise the lab's origin (CORS), and the servers a real APK talks to never do. The lab
// can send its requests through a relay instead (Controles > Dispositivo > Proxy, `{url}` placeholder; src/network-transport.js openExchange), and this is that relay: it repeats each
// request from this machine, as the device would send it, and answers the page with CORS headers.
//
//   node scripts/cors-relay.mjs [--port 8787] [--origin <lab origin>]... [--token <token>] [--new-token] [--config-dir <dir>] [--ca <ca.pem>]...
//   (--ca: CA certificates to trust besides the system's, for a server with an internal CA; the file is read again whenever it changes, no restart needed)
//
// The token and the port are saved (settings.json in the folder the APK Lab Relay desktop app uses: ~/Library/Application Support/apk-lab-relay on macOS, %APPDATA%\apk-lab-relay
// on Windows, $XDG_CONFIG_HOME or ~/.config/apk-lab-relay elsewhere; --config-dir or APKWEB_RELAY_CONFIG_DIR choose another), so the Proxy address stays the same from one start to
// the next and the page does not have to be given it again. --new-token makes (and saves) a new one: the old address stops working at once. --token <text> uses and saves that one.
//
// Then put the printed "Proxy" URL in the lab's Proxy field. Contract with src/network-transport.js:
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
//  - a request with a token the relay does not have (an address from before --new-token) from an allowed page answers 404 `APKWEB_RELAY_TOKEN`, which the lab reports as such.
//
// Safety: it listens on 127.0.0.1 only; every request must carry the random token printed at start-up in its path, and must come from one of the allowed origins (the public lab and a
// local copy by default), so another site open in the same browser cannot use it. Destinations are not restricted (the owner's decision, 2026-11-16: the relay is meant to be free): the
// internet, this machine and the local network are all reachable. --allow-private, from older versions, is accepted and does nothing. It keeps no cookies and stores nothing but its
// settings (token, port): what the app sends passes through and is forgotten.
import http from 'node:http';
import https from 'node:https';
import { randomBytes, createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import net, { isIP } from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, statSync, renameSync } from 'node:fs';

export const DEFAULT_ORIGINS = ['https://madmax-dev-br.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host', 'content-length', 'expect']);
const FROM_BROWSER = new Set(['origin', 'referer', 'cookie', 'accept-encoding', 'user-agent']);   // the browser's own values (the app's, if it set them, come as x-apkweb-*)
const RESPONSE_DROP = new Set(['transfer-encoding', 'connection', 'keep-alive', 'set-cookie']);   // Content-Encoding stays: the browser decodes the body as it would from the server itself
const MAX_BODY = 32 * 1024 * 1024;
export const NO_IDENTITY_CODE = 'APKWEB_RELAY_NO_CLIENT_IDENTITY', TOKEN_CODE = 'APKWEB_RELAY_TOKEN', FEATURES = 'client-identity';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;


/**
 * The relay as an http.Server (not listening yet). `token`: the path segment every request must carry; `origins`: the page origins allowed to use it; Upstream requests go through node:http(s), not fetch: fetch adds headers of its own (Sec-Fetch-Mode, Accept-Language ...) that the app
 * never sent; here the target sees exactly the app's request.
 */
export function createRelay({ token, origins = DEFAULT_ORIGINS, timeoutMs = 60000, ca: caOption = null } = {}) {
  if (!token) throw new Error('createRelay needs a token');
  const ca = typeof caOption === 'function' ? caOption : () => caOption;   // a function is asked at every connection (caFromFiles: a changed --ca file takes effect without a restart)
  const allowed = new Set(origins.map(origin => origin.replace(/\/$/, '')));
  const identities = new Map();   // 'host:port' -> { key, cert } (PEM) and its id, the device's client identity for that destination, in memory only
  const cors = (origin, res, extra = {}) => { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); for (const [name, value] of Object.entries(extra)) res.setHeader(name, value); };
  const fail = (res, status, message) => { res.statusCode = status; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(message); };
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin ?? '';
    const url = new URL(req.url, 'http://relay.invalid');
    if (url.pathname !== `/${token}/` && url.pathname !== `/${token}`) {
      // an allowed page with another token (an address from before --new-token): say so, readable by the page (CORS) and with a code the lab reports; the token is never echoed
      if (!allowed.has(origin) || !/^\/[A-Za-z0-9_-]{8,128}\/?$/.test(url.pathname)) return fail(res, 404, 'unknown path');
      cors(origin, res, { 'x-apkweb-relay-error-code': TOKEN_CODE, 'x-apkweb-relay-error': 'the relay has another token: copy the Proxy address it printed at start-up', 'Access-Control-Expose-Headers': 'x-apkweb-relay-error-code, x-apkweb-relay-error' });
      if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) { res.setHeader('Access-Control-Allow-Methods', req.headers['access-control-request-method']); res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? ''); if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true'); res.statusCode = 204; return res.end(); }
      return fail(res, 404, 'unknown path');
    }
    if (!allowed.has(origin)) return fail(res, 403, `origin not allowed: ${origin || '(none)'}; start the relay with --origin ${origin || '<origin>'}`);
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {   // the browser's preflight
      cors(origin, res, { 'Access-Control-Allow-Methods': req.headers['access-control-request-method'], 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '', 'Access-Control-Max-Age': '600', ...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}) });
      res.statusCode = 204; return res.end();
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
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      const lower = name.toLowerCase(), values = Array.isArray(value) ? value : [value];
      if (lower.startsWith('x-apkweb-')) { const original = lower.slice('x-apkweb-'.length); if (original !== 'accept-encoding' && !HOP_BY_HOP.has(original)) for (const v of values) headers.append(original, v); continue; }
      if (HOP_BY_HOP.has(lower) || FROM_BROWSER.has(lower) || lower.startsWith('sec-') || lower.startsWith('access-control-')) continue;
      for (const v of values) headers.append(name, v);
    }
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) { cors(origin, res); return fail(res, 413, 'request body over 32 MiB'); } chunks.push(chunk); }
      body = Buffer.concat(chunks);
    }
    let response;
    try { response = await send(parsed, req.method, headers, body, timeoutMs, 0, identities, ca); }
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
  server.on('upgrade', (req, socket) => tunnel({ req, socket, token, allowed, timeoutMs, identities, ca }));
  server.clientIdentityCount = () => identities.size;
  return server;
}

// ---- TCP tunnel (/<token>/tcp): a TCP stream for a socket of the lab whose conversation is not HTTP/1.1 (HTTP/2 with prior knowledge, as gRPC clients speak; MQTT; a database
// protocol). The page opens a WebSocket here (ws://127.0.0.1:<port>/<token>/tcp?host=&port=&tls=0|1&alpn=), the relay connects to the target from this machine and copies the bytes
// both ways. First message (text JSON): {"connected":true,"alpn":...} or {"error":{"code","message"}}; then binary messages are the TCP bytes. tls=1: the relay does the TLS (the lab
// hands the app's plaintext, as its fetch path does) with the ALPN list asked for, and reports the protocol the server chose. Same origin, token and private-address rules as above.
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
async function tunnel({ req, socket, token, allowed, timeoutMs, identities, ca = null }) {
  const url = new URL(req.url, 'http://relay.invalid'), origin = req.headers.origin ?? '';
  const refuse = (status, text, message) => { socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${message}`); };
  if (url.pathname !== `/${token}/tcp`) return refuse(404, 'Not Found', 'unknown path');
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

// ---- settings kept between starts (the token and the port: the Proxy address), in the folder the APK Lab Relay desktop app uses -------------------------------------------
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
/** The token and port of this start: --token / --port, else the saved ones, else a new random token and 8787. `newToken` (--new-token) replaces the saved token. */
export function resolveSettings(saved, { token = null, port = null, newToken = false } = {}) {
  const kept = typeof saved.token === 'string' && TOKEN_PATTERN.test(saved.token) ? saved.token : null;
  return { token: token ?? (newToken || !kept ? randomBytes(12).toString('hex') : kept), port: port ?? (Number.isInteger(saved.port) && saved.port >= 1 && saved.port <= 65535 ? saved.port : 8787), fresh: !token && (newToken || !kept) };
}

/** One upstream exchange over node:http(s), following redirects the way fetch does (at most 20; 303, and 301/302 after a POST, continue as GET without a body). */
function send(url, method, headers, body, timeoutMs, hops = 0, identities = null, ca = null) {
  return new Promise((resolve, reject) => {
    const outgoing = {}; headers.forEach((value, name) => { outgoing[name] = name.toLowerCase() === 'cookie' ? value : (outgoing[name] ? `${outgoing[name]}, ${value}` : value); });
    if (body) outgoing['content-length'] = String(body.length);
    const identity = url.protocol === 'https:' ? identities?.get(destination(url.hostname, url.port || '443')) : null;   // only the destination the identity was given for
    const roots = url.protocol === 'https:' ? trusted(ca) : null;   // asked now: a renewed --ca file applies to the next connection
    const request = (url.protocol === 'https:' ? https : http).request(url, { method, headers: outgoing, timeout: timeoutMs, ...(identity ? { key: identity.key, cert: identity.cert, agent: false } : {}), ...(roots ? { ca: roots, agent: false } : {}) }, response => {
      const status = response.statusCode, location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume();
        if (hops >= 20) return reject(Object.assign(new Error('Too many follow-up requests: 21'), { code: 'EREDIRECT' }));
        const next = new URL(location, url), asGet = status === 303 || ((status === 301 || status === 302) && method === 'POST');
        const nextHeaders = new Headers(headers); if (asGet) { nextHeaders.delete('content-type'); nextHeaders.delete('content-length'); }
        if (next.host !== url.host) { nextHeaders.delete('authorization'); nextHeaders.delete('cookie'); }   // credentials never follow a redirect to another host, as with fetch
        return resolve(send(next, asGet ? 'GET' : method, nextHeaders, asGet ? undefined : body, timeoutMs, hops + 1, identities, ca));
      }
      resolve(response);
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error(`connect to ${url.host} timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end(body);
  });
}

function parseArguments(argv) {
  const options = { port: null, origins: [], token: null, newToken: false, configDir: null, ca: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--origin') options.origins.push(argv[++i]);
    else if (arg === '--token') options.token = argv[++i];
    else if (arg === '--new-token' || arg === '--rotate-token') options.newToken = true;
    else if (arg === '--config-dir') options.configDir = argv[++i];
    else if (arg === '--ca') options.ca.push(path.resolve(argv[++i]));   // a PEM file of CA certificates to trust besides the system ones (a server with an internal CA); read again when it changes
    else if (arg === '--allow-private') continue;   // older versions refused private destinations; every destination is reachable now
    else if (arg === '--help' || arg === '-h') { console.log('node scripts/cors-relay.mjs [--port 8787] [--origin <lab origin>]... [--token <token>] [--new-token] [--config-dir <dir>] [--ca <ca.pem>]...\n  The token and the port are saved, so the Proxy address stays the same; --new-token makes a new one.'); process.exit(0); }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (options.port !== null && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) throw new Error('--port must be 1-65535');
  if (options.token !== null && !TOKEN_PATTERN.test(options.token ?? '')) throw new Error('--token: 8 to 128 letters, digits, _ or -');
  for (const file of options.ca) readFileSync(file);   // a missing file at start-up is an error (later, a file being rewritten keeps its last good copy)
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseArguments(process.argv.slice(2));
  const dir = options.configDir ?? configDir(), settings = resolveSettings(loadSettings(dir), options), saved = saveSettings(dir, { token: settings.token, port: settings.port });
  const { token, port } = settings, origins = options.origins.length ? options.origins : DEFAULT_ORIGINS;
  const server = createRelay({ token, origins, ca: options.ca.length ? caFromFiles(options.ca) : null });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use (another relay?); start with --port <another>` : `Could not start: ${error.message}`); process.exit(1); });
  server.listen(port, '127.0.0.1', () => {
    console.log(`APK Web Lab CORS relay on http://127.0.0.1:${port} (only this machine can reach it)`);
    console.log(`Allowed page origins: ${origins.join(', ')}`);
    console.log('Destinations: any (the internet, this machine and the local network)');
    console.log(`Proxy field (Controls > Device): http://127.0.0.1:${port}/${token}/?url={url}`);
    console.log(!saved ? `(the settings could not be saved in ${dir}: the address changes at the next start)` : settings.fresh ? 'A new address: paste it in the Proxy field once; it is saved and stays the same at the next starts (--new-token makes another).' : 'The same address as before (saved; --new-token makes another).');
  });
  const stop = () => { server.close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
