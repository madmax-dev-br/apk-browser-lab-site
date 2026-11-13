#!/usr/bin/env node
// Local CORS relay for APK Web Lab: the browser refuses every response whose server does not authorise the lab's origin (CORS), and the servers a real APK talks to never do. The lab
// can send its requests through a relay instead (Controles > Dispositivo > Proxy, `{url}` placeholder; src/network-transport.js openExchange), and this is that relay: it repeats each
// request from this machine, as the device would send it, and answers the page with CORS headers.
//
//   node scripts/cors-relay.mjs [--port 8787] [--origin <lab origin>]... [--token <token>] [--allow-private]
//
// Then put the printed "Proxy" URL in the lab's Proxy field. Contract with src/network-transport.js:
//  - the target is the `url` query parameter; headers a browser may not send (Cookie, User-Agent, Origin, Referer ...) arrive as `x-apkweb-<name>` and are sent under their own name;
//  - redirects are followed here (a browser hides redirect responses from the page);
//  - Set-Cookie, which a browser never exposes, comes back as `x-apkweb-set-cookie`: a JSON array of the Set-Cookie values;
//  - a failure to reach the target (unknown host, refused, timed out, bad certificate) is a 502 carrying `x-apkweb-relay-error-code` (the Node error code) and `x-apkweb-relay-error`
//    (its message), which the lab turns into the exception an Android device would throw (UnknownHostException, ConnectException, SSLHandshakeException ...).
//
// Safety: it listens on 127.0.0.1 only; every request must carry the random token printed at start-up in its path, and must come from one of the allowed origins (the public lab and a
// local copy by default), so another site open in the same browser cannot use it. Targets on this machine or the local network (loopback, private, link-local addresses) are refused unless
// --allow-private is given. It keeps no cookies and stores nothing: what the app sends passes through and is forgotten.
import http from 'node:http';
import https from 'node:https';
import { randomBytes, createHash } from 'node:crypto';
import net, { isIP } from 'node:net';
import tls from 'node:tls';
import { lookup as dnsLookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_ORIGINS = ['https://madmax-dev-br.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host', 'content-length', 'expect']);
const FROM_BROWSER = new Set(['origin', 'referer', 'cookie', 'accept-encoding', 'user-agent']);   // the browser's own values (the app's, if it set them, come as x-apkweb-*)
const RESPONSE_DROP = new Set(['transfer-encoding', 'connection', 'keep-alive', 'set-cookie']);   // Content-Encoding stays: the browser decodes the body as it would from the server itself
const MAX_BODY = 32 * 1024 * 1024;

/** True for addresses on this machine or the local network: loopback, RFC 1918, link-local, CGNAT, unique-local IPv6, unspecified. */
export function privateAddress(address) {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (kind === 6) {
    const v = address.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v); if (mapped) return privateAddress(mapped[1]);
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  return false;
}

/**
 * The relay as an http.Server (not listening yet). `token`: the path segment every request must carry; `origins`: the page origins allowed to use it; `allowPrivate`: also relay to
 * private addresses; `lookup`: injectable for tests. Upstream requests go through node:http(s), not fetch: fetch adds headers of its own (Sec-Fetch-Mode, Accept-Language ...) that the app
 * never sent; here the target sees exactly the app's request.
 */
export function createRelay({ token, origins = DEFAULT_ORIGINS, allowPrivate = false, lookup = dnsLookup, timeoutMs = 60000 } = {}) {
  if (!token) throw new Error('createRelay needs a token');
  const allowed = new Set(origins.map(origin => origin.replace(/\/$/, '')));
  const cors = (origin, res, extra = {}) => { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); for (const [name, value] of Object.entries(extra)) res.setHeader(name, value); };
  const fail = (res, status, message) => { res.statusCode = status; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.end(message); };
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin ?? '';
    const url = new URL(req.url, 'http://relay.invalid');
    if (url.pathname !== `/${token}/` && url.pathname !== `/${token}`) return fail(res, 404, 'unknown path');
    if (!allowed.has(origin)) return fail(res, 403, `origin not allowed: ${origin || '(none)'}; start the relay with --origin ${origin || '<origin>'}`);
    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {   // the browser's preflight
      cors(origin, res, { 'Access-Control-Allow-Methods': req.headers['access-control-request-method'], 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '', 'Access-Control-Max-Age': '600', ...(req.headers['access-control-request-private-network'] ? { 'Access-Control-Allow-Private-Network': 'true' } : {}) });
      res.statusCode = 204; return res.end();
    }
    const target = url.searchParams.get('url');
    let parsed; try { parsed = new URL(target ?? ''); } catch { cors(origin, res); return fail(res, 400, 'missing or invalid url parameter'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { cors(origin, res); return fail(res, 400, `unsupported scheme ${parsed.protocol}`); }
    const relayError = (code, message) => { cors(origin, res, { 'x-apkweb-relay-error-code': code, 'x-apkweb-relay-error': message.replace(/[\r\n]+/g, ' ').slice(0, 300), 'Access-Control-Expose-Headers': 'x-apkweb-relay-error-code, x-apkweb-relay-error' }); fail(res, 502, `${code}: ${message}`); };
    if (!allowPrivate) {
      const host = parsed.hostname.replace(/^\[|\]$/g, '');
      let addresses;
      try { addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }); } catch (error) { return relayError(error.code ?? 'ENOTFOUND', error.message ?? String(error)); }
      if (addresses.some(entry => privateAddress(entry.address))) {   // named in the relay-error headers too, so the lab reports it as a connect failure instead of handing the app a 403
        const message = `${host} is on this machine or the local network; start the relay with --allow-private to reach it`;
        cors(origin, res, { 'x-apkweb-relay-error-code': 'APKWEB_RELAY_PRIVATE', 'x-apkweb-relay-error': message, 'Access-Control-Expose-Headers': 'x-apkweb-relay-error-code, x-apkweb-relay-error' }); return fail(res, 403, message);
      }
    }
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
    try { response = await send(parsed, req.method, headers, body, timeoutMs); }
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
  server.on('upgrade', (req, socket) => tunnel({ req, socket, token, allowed, allowPrivate, lookup, timeoutMs }));
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
async function tunnel({ req, socket, token, allowed, allowPrivate, lookup, timeoutMs }) {
  const url = new URL(req.url, 'http://relay.invalid'), origin = req.headers.origin ?? '';
  const refuse = (status, text, message) => { socket.end(`HTTP/1.1 ${status} ${text}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${message}`); };
  if (url.pathname !== `/${token}/tcp`) return refuse(404, 'Not Found', 'unknown path');
  if (!allowed.has(origin)) return refuse(403, 'Forbidden', `origin not allowed: ${origin || '(none)'}`);
  const key = req.headers['sec-websocket-key']; if (!key || String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket') return refuse(400, 'Bad Request', 'a WebSocket upgrade is expected');
  const host = url.searchParams.get('host') ?? '', port = Number(url.searchParams.get('port')), secure = url.searchParams.get('tls') === '1', alpn = (url.searchParams.get('alpn') ?? '').split(',').map(p => p.trim()).filter(Boolean);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return refuse(400, 'Bad Request', 'host and port are required');
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${createHash('sha1').update(key + WS_GUID).digest('base64')}`, '', ''].join('\r\n'));
  socket.setNoDelay?.(true);
  const say = value => { if (!socket.destroyed) socket.write(wsFrame(0x1, Buffer.from(JSON.stringify(value)))); };
  const closeFrame = code => wsFrame(0x8, Buffer.from([code >> 8, code & 255]));
  const fail = (code, message) => { say({ error: { code, message: String(message).replace(/[\r\n]+/g, ' ').slice(0, 300) } }); socket.end(closeFrame(1011)); };
  socket.on('error', () => {});
  if (!allowPrivate) {
    const name = host.replace(/^\[|\]$/g, '');
    let addresses; try { addresses = isIP(name) ? [{ address: name }] : await lookup(name, { all: true }); } catch (error) { return fail(error.code ?? 'ENOTFOUND', error.message ?? String(error)); }
    if (addresses.some(entry => privateAddress(entry.address))) return fail('APKWEB_RELAY_PRIVATE', `${name} is on this machine or the local network; start the relay with --allow-private to reach it`);
  }
  let connected = false;
  const upstream = secure ? tls.connect({ host, port, servername: isIP(host) ? undefined : host, ALPNProtocols: alpn.length ? alpn : undefined }) : net.connect({ host, port });
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

/** One upstream exchange over node:http(s), following redirects the way fetch does (at most 20; 303, and 301/302 after a POST, continue as GET without a body). */
function send(url, method, headers, body, timeoutMs, hops = 0) {
  return new Promise((resolve, reject) => {
    const outgoing = {}; headers.forEach((value, name) => { outgoing[name] = name.toLowerCase() === 'cookie' ? value : (outgoing[name] ? `${outgoing[name]}, ${value}` : value); });
    if (body) outgoing['content-length'] = String(body.length);
    const request = (url.protocol === 'https:' ? https : http).request(url, { method, headers: outgoing, timeout: timeoutMs }, response => {
      const status = response.statusCode, location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        response.resume();
        if (hops >= 20) return reject(Object.assign(new Error('Too many follow-up requests: 21'), { code: 'EREDIRECT' }));
        const next = new URL(location, url), asGet = status === 303 || ((status === 301 || status === 302) && method === 'POST');
        const nextHeaders = new Headers(headers); if (asGet) { nextHeaders.delete('content-type'); nextHeaders.delete('content-length'); }
        if (next.host !== url.host) { nextHeaders.delete('authorization'); nextHeaders.delete('cookie'); }   // credentials never follow a redirect to another host, as with fetch
        return resolve(send(next, asGet ? 'GET' : method, nextHeaders, asGet ? undefined : body, timeoutMs, hops + 1));
      }
      resolve(response);
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error(`connect to ${url.host} timed out after ${timeoutMs} ms`), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end(body);
  });
}

function parseArguments(argv) {
  const options = { port: 8787, origins: [], token: null, allowPrivate: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--origin') options.origins.push(argv[++i]);
    else if (arg === '--token') options.token = argv[++i];
    else if (arg === '--allow-private') options.allowPrivate = true;
    else if (arg === '--help' || arg === '-h') { console.log('node scripts/cors-relay.mjs [--port 8787] [--origin <lab origin>]... [--token <token>] [--allow-private]'); process.exit(0); }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be 1-65535');
  return options;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseArguments(process.argv.slice(2));
  const token = options.token ?? randomBytes(12).toString('hex'), origins = options.origins.length ? options.origins : DEFAULT_ORIGINS;
  const server = createRelay({ token, origins, allowPrivate: options.allowPrivate });
  server.listen(options.port, '127.0.0.1', () => {
    console.log(`APK Web Lab CORS relay on http://127.0.0.1:${options.port} (only this machine can reach it)`);
    console.log(`Allowed page origins: ${origins.join(', ')}`);
    console.log(`Proxy field (Controles > Dispositivo): http://127.0.0.1:${options.port}/${token}/?url={url}`);
  });
}
