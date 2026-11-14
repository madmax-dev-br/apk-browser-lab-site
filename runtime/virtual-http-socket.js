// The virtual HTTP socket: what a java.net.Socket connected to a permitted host is in the browser.
//
// A browser cannot open TCP. A client that speaks HTTP/1.1 by hand over a Socket's streams (an OkHttp-style client, or a plain Socket program) is served the only way the
// platform allows: the descriptor of the socket owns a small HTTP/1.1 *server side* -- the bytes the app writes are parsed as requests (request line, headers, body by
// Content-Length or chunked, `Expect: 100-continue`), each request is performed through the same network path HttpURLConnection uses (policy, NetworkBridge.start / openExchange,
// the Worker's network log with api 'Socket', the optional relay), and the response is serialized back into the bytes the app reads (status line, the headers as received minus the
// hop-by-hop ones the browser hides, Content-Length when the body size is known, else chunked framing, the body as it arrives). Requests are served in order on one socket
// (keep-alive); `Connection: close` ends the conversation after its response.
//
// Anything that is not an HTTP/1.x request line (a TLS ClientHello an app produced itself, SSH, a database protocol, HTTP/2 prior knowledge) fails at the first bytes with an
// explicit error that names them. TLS is *not* done here: SSLSocketFactory.createSocket(socket, host, port, autoClose) marks the socket `https` (src/security-host.js) and fetch does
// the real TLS; the bytes of the conversation stay plain HTTP between the app and this object.
//
// This module is VM-free: the network bridge (`net`) is passed in and the failures are plain JavaScript errors the natives (src/libcore-io-native.js) turn into Java exceptions.

export const HIGH_WATER = 256 * 1024, CHUNK = 64 * 1024, MAX_HEAD = 64 * 1024, MAX_BODY = 128 * 1024 * 1024;
import { websocketRequest, acceptKey, FrameDecoder, encodeFrame, closePayload, OPCODE } from './websocket-bridge.js?v=a104526a388b';
const TUNNEL_PREFIX = 64 * 1024;   // the bytes kept until the first request is recognised: a conversation that is not HTTP/1.1 starts the tunnel with them
const encoder = new TextEncoder();
const latin1 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return text; };
const bytesOf = text => { const out = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255; return out; };
const concat = (a, b) => { if (!a.length) return b; if (!b.length) return a; const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out; };

/** A Java exception the native layer throws: { type: 'Ljava/net/SocketException;', message }. */
export class SocketFailure extends Error { constructor(type, message) { super(message); this.javaType = type; } }
/** The conversation is not HTTP/1.x (or uses a part of it the lab cannot serve): the lab's explicit "unsupported" failure, never a Java exception the app could swallow. */
export class NotServed extends Error { constructor(message) { super(message); this.kind = 'raw-socket-unsupported'; } }

const hex = (bytes, count = 16) => [...bytes.subarray(0, count)].map(b => b.toString(16).padStart(2, '0')).join(' ');
const printable = (bytes, count = 16) => JSON.stringify(String.fromCharCode(...[...bytes.subarray(0, count)].map(b => (b >= 0x20 && b < 0x7f ? b : 0x2e))));
/** What the first bytes of a conversation look like, for the error message. */
export function describeBytes(bytes) {
  let what = '';
  if (bytes[0] === 0x16 && bytes[1] === 0x03) what = ' (a TLS record: the app starts its own TLS handshake; the lab serves TLS only through SSLSocketFactory.createSocket(socket, host, port, autoClose), where the browser\'s fetch does the real TLS)';
  else if (bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === 'SSH-') what = ' (an SSH banner)';
  else if (bytes.length >= 3 && String.fromCharCode(...bytes.subarray(0, 3)) === 'PRI') what = ' (the HTTP/2 connection preface; the lab serves HTTP/1.1 only, so the ALPN protocol it offers is http/1.1)';
  else if (bytes[0] === 0x00 || bytes[0] === 0x03 || bytes[0] === 0x05) what = ' (a binary protocol)';
  return `first bytes ${hex(bytes)} ${printable(bytes)}${what}`;
}

const isToken = b => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a) || b === 0x21 || (b >= 0x23 && b <= 0x27) || b === 0x2a || b === 0x2b || b === 0x2d || b === 0x2e || b === 0x5e || b === 0x5f || b === 0x60 || b === 0x7c || b === 0x7e;
const VERSION = 'HTTP/1.1';
/** Checks the request line bytes seen so far (a prefix is enough): returns the offset of the first byte that cannot belong to `METHOD SP target SP HTTP/1.x`, or -1. */
export function badRequestLineByte(bytes) {
  let phase = 0, methodLength = 0, targetLength = 0, versionAt = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (phase === 0) { if (isToken(b) && ++methodLength <= 32) continue; if (b === 0x20 && methodLength > 0) { phase = 1; continue; } return i; }
    if (phase === 1) { if (b === 0x20 && targetLength > 0) { phase = 2; continue; } if (b <= 0x20 || b === 0x7f || ++targetLength > MAX_HEAD) return i; continue; }
    if (versionAt < VERSION.length) { const wanted = VERSION.charCodeAt(versionAt); if (b === wanted || (versionAt === 7 && b === 0x30)) { versionAt++; continue; } return i; }
    if (versionAt === VERSION.length) { if (b === 0x0d) { versionAt++; continue; } return i; }
    if (b === 0x0a) return -1;                                  // the line is complete
    return i;
  }
  return -1;
}

/** Parses the byte stream the app writes into HTTP/1.1 requests. push() returns events: { type: 'continue' } (answer `100 Continue`) and { type: 'request', ... }. */
export class RequestParser {
  constructor() { this.buffer = new Uint8Array(0); this.mode = 'head'; this.head = null; this.body = []; this.remaining = 0; this.chunkRemaining = -1; this.trailers = false; }
  /** True when no byte of a request is pending (the app may stop writing here). */
  get idle() { return this.mode === 'head' && this.buffer.length === 0; }
  push(bytes) {
    this.buffer = concat(this.buffer, bytes); const events = [];
    for (;;) {
      if (this.mode === 'head') {
        let skip = 0; while (skip + 1 < this.buffer.length && this.buffer[skip] === 0x0d && this.buffer[skip + 1] === 0x0a) skip += 2;   // RFC 9112 2.2: empty lines before a request line are ignored
        if (skip) this.buffer = this.buffer.subarray(skip);
        if (this.buffer.length === 0 || (this.buffer.length === 1 && this.buffer[0] === 0x0d)) return events;
        const bad = badRequestLineByte(this.buffer);
        if (bad >= 0) throw new NotServed(`the bytes written to the socket are not an HTTP/1.1 request line (${describeBytes(this.buffer)})`);
        const end = indexOfHeadEnd(this.buffer);
        if (end < 0) { if (this.buffer.length > MAX_HEAD) throw new NotServed(`HTTP request head over ${MAX_HEAD} bytes without an end (${describeBytes(this.buffer)})`); return events; }
        this.head = parseHead(this.buffer.subarray(0, end)); this.buffer = this.buffer.subarray(end + 4);
        const { transferEncoding, contentLength } = this.head;
        if (transferEncoding) { this.mode = 'chunked'; this.chunkRemaining = -1; this.trailers = false; }
        else if (contentLength > 0) { this.mode = 'length'; this.remaining = contentLength; }
        else { events.push(this.finish()); continue; }
        if (this.head.expectContinue && !(this.mode === 'length' && this.buffer.length >= this.remaining)) events.push({ type: 'continue' });
        continue;
      }
      if (this.mode === 'length') {
        const take = Math.min(this.remaining, this.buffer.length); if (take) { this.body.push(this.buffer.slice(0, take)); this.buffer = this.buffer.subarray(take); this.remaining -= take; }
        if (this.remaining > 0) return events;
        events.push(this.finish()); continue;
      }
      // chunked body: size line, data, CRLF ... 0 size line, trailers, blank line
      if (this.trailers) {
        const at = indexOfCrlf(this.buffer); if (at < 0) return events;
        const empty = at === 0; this.buffer = this.buffer.subarray(at + 2);
        if (empty) { events.push(this.finish()); continue; }
        continue;                                              // a trailer field: ignored (fetch cannot send trailers)
      }
      if (this.chunkRemaining < 0) {
        const at = indexOfCrlf(this.buffer); if (at < 0) { if (this.buffer.length > 1024) throw new NotServed('chunk size line over 1 KiB'); return events; }
        const line = latin1(this.buffer.subarray(0, at)).split(';')[0].trim();
        if (!/^[0-9a-fA-F]{1,8}$/.test(line)) throw new NotServed(`invalid chunk size ${JSON.stringify(line)} in the request body`);
        this.chunkRemaining = parseInt(line, 16); this.buffer = this.buffer.subarray(at + 2);
        if (this.chunkRemaining === 0) { this.trailers = true; this.chunkRemaining = -1; }
        continue;
      }
      if (this.buffer.length < this.chunkRemaining + 2) {
        const take = Math.min(this.chunkRemaining, this.buffer.length); if (take) { this.body.push(this.buffer.slice(0, take)); this.buffer = this.buffer.subarray(take); this.chunkRemaining -= take; }
        return events;
      }
      this.body.push(this.buffer.slice(0, this.chunkRemaining));
      if (this.buffer[this.chunkRemaining] !== 0x0d || this.buffer[this.chunkRemaining + 1] !== 0x0a) throw new NotServed('chunk data is not followed by CRLF in the request body');
      this.buffer = this.buffer.subarray(this.chunkRemaining + 2); this.chunkRemaining = -1;
    }
  }
  finish() {
    const total = this.body.reduce((n, piece) => n + piece.length, 0), body = new Uint8Array(total); let at = 0; for (const piece of this.body) { body.set(piece, at); at += piece.length; }
    if (total > MAX_BODY) throw new NotServed(`request body over ${MAX_BODY} bytes`);
    const { method, target, version, headers, keepAlive } = this.head;
    this.mode = 'head'; this.head = null; this.body = [];
    return { type: 'request', method, target, version, headers, body, keepAlive, hasBody: total > 0 };
  }
}
function indexOfHeadEnd(buffer) { for (let i = 0; i + 3 < buffer.length; i++) if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a && buffer[i + 2] === 0x0d && buffer[i + 3] === 0x0a) return i; return -1; }
function indexOfCrlf(buffer) { for (let i = 0; i + 1 < buffer.length; i++) if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a) return i; return -1; }
function parseHead(bytes) {
  const lines = latin1(bytes).split('\r\n'), match = /^(\S+) (\S+) HTTP\/1\.([01])$/.exec(lines[0]);
  if (!match) throw new NotServed(`not an HTTP/1.x request line (${describeBytes(bytes)})`);
  const headers = [];
  for (const line of lines.slice(1)) {
    if (/^[ \t]/.test(line)) throw new NotServed(`obsolete header line folding is not served (${JSON.stringify(line.slice(0, 40))})`);
    const colon = line.indexOf(':'); if (colon <= 0 || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(line.slice(0, colon))) throw new NotServed(`malformed request header ${JSON.stringify(line.slice(0, 60))}`);
    headers.push([line.slice(0, colon), line.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/g, '')]);
  }
  const all = name => headers.filter(([n]) => n.toLowerCase() === name).map(([, v]) => v);
  const connection = all('connection').join(',').toLowerCase().split(',').map(t => t.trim());
  const version = match[3] === '1' ? '1.1' : '1.0', keepAlive = version === '1.1' ? !connection.includes('close') : connection.includes('keep-alive');
  let transferEncoding = false, contentLength = 0;
  const te = all('transfer-encoding');
  if (te.length) { const codings = te.join(',').toLowerCase().split(',').map(t => t.trim()).filter(Boolean); if (codings[codings.length - 1] !== 'chunked' || codings.length !== 1) throw new NotServed(`request Transfer-Encoding ${JSON.stringify(te.join(','))} is not served (only a single chunked coding)`); transferEncoding = true; }
  const lengths = [...new Set(all('content-length').flatMap(v => v.split(',').map(t => t.trim())))];
  if (lengths.length > 1 || (lengths.length === 1 && !/^\d{1,12}$/.test(lengths[0]))) throw new NotServed(`invalid Content-Length ${JSON.stringify(lengths.join(','))}`);
  if (lengths.length === 1 && !transferEncoding) { contentLength = Number(lengths[0]); if (contentLength > MAX_BODY) throw new NotServed(`request body of ${contentLength} bytes is over the ${MAX_BODY} byte limit`); }
  const expectContinue = all('expect').some(v => v.toLowerCase() === '100-continue') && version === '1.1';
  return { method: match[1], target: match[2], version, headers, keepAlive, transferEncoding, contentLength, expectContinue };
}

export const REASONS = { 200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'Non-Authoritative Information', 204: 'No Content', 205: 'Reset Content', 206: 'Partial Content', 300: 'Multiple Choices', 301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified',
  307: 'Temporary Redirect', 308: 'Permanent Redirect', 400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone',
  411: 'Length Required', 412: 'Precondition Failed', 413: 'Payload Too Large', 414: 'URI Too Long', 415: 'Unsupported Media Type', 416: 'Range Not Satisfiable', 418: "I'm a teapot", 422: 'Unprocessable Content', 429: 'Too Many Requests', 500: 'Internal Server Error', 501: 'Not Implemented',
  502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };
/** Response headers a browser's fetch hides or that describe the transport hop, not the message: dropped from the serialized response. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

/**
 * The status line and headers of the response the app reads. `head` is the transport's { status, reason, headers }. Returns { bytes, framing: 'none' | 'length' | 'chunked', length }.
 * Bodies of HEAD requests and of 1xx / 204 / 304 responses are empty by definition; otherwise Content-Length is kept when the transport reported it, else the body is chunked.
 */
export function serializeResponseHead(request, head, { closing }) {
  const status = head.status, noBody = request.method === 'HEAD' || status === 204 || status === 304 || (status >= 100 && status < 200);
  const lines = [`HTTP/1.1 ${status} ${head.reason || REASONS[status] || ''}`.trimEnd()]; let length = null;
  for (const [name, value] of head.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'content-length') { if (/^\d+$/.test(String(value).trim())) length = Number(value); else continue; }
    lines.push(`${name}: ${String(value).replace(/[\r\n]+/g, ' ')}`);
  }
  const framing = noBody ? 'none' : length !== null ? 'length' : 'chunked';
  if (framing === 'chunked') lines.push('Transfer-Encoding: chunked');
  if (closing) lines.push('Connection: close'); else if (request.version === '1.0') lines.push('Connection: keep-alive');
  return { bytes: encoder.encode(lines.join('\r\n') + '\r\n\r\n'), framing, length, noBody };
}
const chunkFrame = piece => { const head = encoder.encode(piece.length.toString(16) + '\r\n'), out = new Uint8Array(head.length + piece.length + 2); out.set(head, 0); out.set(piece, head.length); out[out.length - 2] = 0x0d; out[out.length - 1] = 0x0a; return out; };
const LAST_CHUNK = encoder.encode('0\r\n\r\n');
export const CONTINUE = encoder.encode('HTTP/1.1 100 Continue\r\n\r\n');

/** The Host header, or the request-target's authority: { host, port|null } (host without brackets). */
function authorityOf(text) {
  const match = /^(?:\[([0-9a-fA-F:.%]+)\]|([^:\/\s]+))(?::(\d{1,5}))?$/.exec(String(text).trim()); if (!match) return null;
  return { host: (match[1] ?? match[2]).toLowerCase(), port: match[3] ? Number(match[3]) : null };
}

/**
 * The URL a request maps to: scheme from the TLS mark (or the HTTPS ports 443 / 8443), authority from the absolute-form target, else the Host header, else the SNI host name
 * the SSL socket carries, else the host the socket connected to; the port is the Host header's, else the port connected to.
 */
export function targetUrl(request, peer, { https, sni }) {
  const absolute = /^(https?):\/\//i.exec(request.target);
  if (absolute) return new URL(request.target);
  if (request.method === 'CONNECT') throw new NotServed(`CONNECT ${request.target}: tunnels (a Socket used as an HTTP proxy connection) are not served; the browser has no TCP to tunnel`);
  if (!request.target.startsWith('/')) throw new NotServed(`request target ${JSON.stringify(request.target.slice(0, 60))} is not an origin-form path (asterisk-form and authority-form are not served)`);
  const scheme = https || peer.port === 443 || peer.port === 8443 ? 'https' : 'http', hostHeader = request.headers.find(([n]) => n.toLowerCase() === 'host');
  const authority = (hostHeader && authorityOf(hostHeader[1])) ?? (sni ? { host: sni.toLowerCase(), port: null } : { host: peer.host, port: null });
  const port = authority.port ?? peer.port, defaultPort = scheme === 'https' ? 443 : 80;
  const host = authority.host.includes(':') ? `[${authority.host}]` : authority.host;
  return new URL(`${scheme}://${host}${port === defaultPort ? '' : ':' + port}${request.target}`);
}

let socketCounter = 0;
/** One socket descriptor's HTTP conversation. */
/** The 101 response the lab sends for a WebSocket the browser opened. */
function switchingProtocols(upgrade, protocol) {
  const lines = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey(upgrade.key)}`];
  if (protocol) lines.push(`Sec-WebSocket-Protocol: ${protocol}`);
  return encoder.encode(lines.join('\r\n') + '\r\n\r\n');
}

export class VirtualHttpSocket {
  /** @param net the NetworkBridge; @param peer { host (policy name), literal (address text), port }; @param clock { now() } */
  constructor({ net, peer, local }) {
    this.net = net; this.peer = peer; this.local = local; this.id = ++socketCounter; this.parser = new RequestParser();
    this.https = false; this.sni = null; this.alpn = 'http/1.1';
    this.requests = []; this.exchange = null; this.out = []; this.outBytes = 0;
    this.eof = false; this.error = null; this.errorDelivered = false; this.closed = false; this.readShut = false; this.writeShut = false; this.served = 0; this.closing = false; this.prefix = new Uint8Array(0); this.raw = null; this.ws = null;
  }
  get label() { return `${this.peer.host}:${this.peer.port}`; }
  /** The browser does the TLS: the socket's requests are https from now on. `host` is the SNI name. */
  markTls(host) { this.https = true; if (host) this.sni = host; }

  // ---- the write side: the app's bytes
  write(bytes) {
    if (this.closed) throw new SocketFailure('Ljava/net/SocketException;', 'Socket closed');
    if (this.writeShut) throw new SocketFailure('Ljava/net/SocketException;', 'Socket output is shutdown');
    if (this.ws) return this.writeFrames(bytes);   // upgraded to a WebSocket: the bytes are frames, not HTTP
    if (this.raw) { this.raw.send(bytes); return this.pumpRaw(); }   // a TCP tunnel through the relay: the bytes go as they are
    if (this.eof && !this.exchange) throw new SocketFailure('Ljava/net/SocketException;', 'sendto failed: EPIPE (Broken pipe)');
    if (this.prefix !== null && this.prefix.length < TUNNEL_PREFIX) this.prefix = concat(this.prefix, bytes);
    let events;
    try { events = this.parser.push(bytes); }
    catch (failure) {
      // Not HTTP/1.1 from the first byte on (HTTP/2 with prior knowledge, a binary protocol): through the relay's TCP tunnel when one is configured, else the explicit failure.
      if (!(failure instanceof NotServed) || this.served || this.exchange || this.requests.length || this.prefix === null || typeof this.net.openTunnel !== 'function') throw failure;
      const session = this.net.openTunnel({ host: this.peer.host, port: this.peer.port, tls: this.https, alpn: this.alpnOffered ?? [] }); if (!session) throw failure;
      this.raw = session; session.send(this.prefix); this.prefix = null; return this.pumpRaw();
    }
    for (const event of events) {
      if (event.type === 'continue') this.append(CONTINUE);
      else { this.requests.push(event); this.prefix = null; }
    }
    this.pump(true);
  }
  shutdown(how, SHUT_RD, SHUT_WR) {
    if (how === SHUT_RD || how === 2) { this.readShut = true; this.out = []; this.outBytes = 0; }
    if (how === SHUT_WR || how === 2) { this.writeShut = true; if (!this.exchange && !this.requests.length) this.eof = true; }
  }
  dispose() {
    if (this.closed) return; this.closed = true; this.ws?.session.dispose(); this.raw?.dispose();
    if (this.exchange) { this.net.discard(this.exchange.op); this.exchange = null; }
    this.requests = []; this.out = []; this.outBytes = 0;
  }

  // ---- the read side
  append(bytes) { if (bytes.length && !this.readShut) { this.out.push(bytes); this.outBytes += bytes.length; } }
  get available() { return this.outBytes; }
  /** A read would not wait: bytes, the end of the conversation, a failure or a closed socket. */
  readable() { this.pump(); return this.outBytes > 0 || this.eof || this.closed || this.readShut || (this.error !== null && !this.errorDelivered); }
  /** Removes and returns up to `length` of the bytes the app has not read yet. */
  take(length) {
    const out = new Uint8Array(Math.min(length, this.outBytes)); let copied = 0;
    while (copied < out.length) {
      const piece = this.out[0], n = Math.min(piece.length, out.length - copied);
      out.set(n === piece.length ? piece : piece.subarray(0, n), copied); copied += n; this.outBytes -= n;
      if (n === piece.length) this.out.shift(); else this.out[0] = piece.subarray(n);
    }
    this.pump();
    return out;
  }
  /** The failure to throw once the bytes before it were read, or null. */
  takeError() {
    if (this.error === null) return null;
    if (this.errorDelivered) return { type: 'Ljava/net/SocketException;', message: 'Connection reset' };
    this.errorDelivered = true; return this.error;
  }

  // ---- driving the exchanges
  /** Moves the conversation forward. A request that cannot start (refused host, not servable) throws when the app's own write caused it (`throwing`), else the failure waits in `error` for the app's next read. */
  pump(throwing = false) {
    if (this.closed) return;
    if (this.ws) return this.pumpWebSocket();
    if (this.raw) return this.pumpRaw();
    for (let guard = 0; guard < 64; guard++) {
      if (!this.exchange) {
        if (this.error !== null || this.eof) return;
        if (!this.requests.length) { if (this.writeShut) this.eof = true; return; }
        try { this.begin(this.requests.shift()); }
        catch (failure) {
          if (throwing) throw failure;
          this.error = failure instanceof SocketFailure ? { type: failure.javaType, message: failure.message } : { notServed: failure }; this.eof = true; this.requests = []; return;
        }
      }
      if (this.ws) return this.pumpWebSocket();   // the request was a WebSocket upgrade: no HTTP exchange from here on
      const ex = this.exchange, op = ex.op, net = this.net;
      net.refresh(op);
      if (!ex.headSent && op.head) {
        const closing = !ex.request.keepAlive; ex.closing = closing;
        const serialized = serializeResponseHead(ex.request, op.head, { closing }); ex.framing = serialized.framing; ex.declared = serialized.length; ex.noBody = serialized.noBody; ex.headSent = true;
        this.append(serialized.bytes);
      }
      if (ex.headSent) {
        while (this.outBytes < HIGH_WATER) {
          const pieces = net.drain(op, CHUNK); if (!pieces.length) break;
          for (const piece of pieces) { ex.delivered += piece.length; if (!ex.noBody) this.append(ex.framing === 'chunked' ? chunkFrame(piece) : piece); }
        }
      }
      net.observe(op);
      if (op.error !== null) {
        const failure = op.error; net.discard(op); this.exchange = null; this.error = failure; this.eof = true;   // bytes already queued are read first, then the failure
        if (ex.headSent && ex.framing === 'chunked') { /* the chunked body stays unterminated: the app sees the failure, not a clean end */ }
        return;
      }
      if (op.ended && op.queue.length === 0 && ex.headSent) {
        if (ex.framing === 'chunked') this.append(LAST_CHUNK);
        else if (ex.framing === 'length' && ex.delivered !== ex.declared) { this.error = { type: 'Ljava/net/SocketException;', message: 'Connection reset' }; this.eof = true; net.discard(op); this.exchange = null; return; }
        net.discard(op); this.exchange = null; this.served++;
        if (ex.closing) { this.eof = true; this.requests = []; return; }
        continue;                                                // the next pipelined request, if any
      }
      if (op.ended && !ex.headSent) { this.error = { type: 'Ljava/io/IOException;', message: 'unexpected end of stream' }; this.eof = true; net.discard(op); this.exchange = null; return; }
      return;
    }
  }
  // ---- a TCP tunnel through the relay (src/tcp-tunnel.js)
  pumpRaw() {
    const session = this.raw;
    while (session.queue.length) { const bytes = session.queue.shift(); session.queued -= bytes.length; this.append(bytes); }
    if (session.error && !session.connected) { this.error = { type: session.error.type, message: session.error.message }; this.eof = true; return; }
    if (session.closed && !session.queue.length) this.eof = true;
  }
  // ---- an upgraded WebSocket (src/websocket-bridge.js)
  pumpWebSocket() {
    const ws = this.ws, session = ws.session;
    if (!ws.switched) {
      if (session.error) { this.error = { type: session.error.type, message: session.error.message }; this.eof = true; return; }
      if (!session.open) return;
      ws.switched = true; this.append(switchingProtocols(ws.upgrade, session.protocol));
    }
    while (session.queue.length) { const frame = session.queue.shift(); session.queued -= frame.length; this.append(frame); }
    if (session.closed && !session.queue.length) this.eof = true;
  }
  writeFrames(bytes) {
    const ws = this.ws, session = ws.session;
    if (!ws.switched) throw new SocketFailure('Ljava/net/SocketException;', 'WebSocket frames written before the server switched protocols');
    let messages;
    try { messages = ws.decoder.push(bytes); }
    catch (error) { session.close(1002, 'protocol error'); throw new NotServed(`a WebSocket conversation the lab cannot serve: ${error.message}`); }
    for (const { opcode, payload } of messages) {
      if (opcode === OPCODE.TEXT || opcode === OPCODE.BINARY) session.send(opcode, payload);
      else if (opcode === OPCODE.PING) this.append(encodeFrame(OPCODE.PONG, payload));   // the lab is the app's peer: it answers the ping (the browser keeps the real connection alive)
      else if (opcode === OPCODE.CLOSE) { const code = payload.length >= 2 ? (payload[0] << 8) | payload[1] : 1005, reason = new TextDecoder().decode(payload.subarray(2)); session.close(code, reason); if (!session.open || session.closed) { this.append(encodeFrame(OPCODE.CLOSE, closePayload(code === 1005 ? 0 : code))); this.eof = true; } }
    }
    this.pumpWebSocket();
  }
  begin(request) {
    const net = this.net;
    const url = targetUrl(request, this.peer, { https: this.https, sni: this.sni });
    const upgrade = websocketRequest(request);
    const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80)), host = url.hostname;
    const headers = request.headers.filter(([name]) => name.toLowerCase() !== 'host');
    const mock = net.matchMock?.({ method: request.method, url: url.href, body: request.body }) ?? null;   // "Mock de endpoints" (src/endpoint-mocks.js): answered by the lab, before the policy
    if (!mock && !(net.permits ? net.permits(url.href, host, port) : net.online && net.allowed(host, port))) {   // a request a "Redirecionar hosts" rule maps is not refused by the allow list
      net.stats.denied++; if (!net.online) net.stats.offlineRejections++;
      net.logRefusal({ api: 'Socket', method: request.method, url: url.href, host, port, headers, bytes: request.body.length });
      throw new SocketFailure('Ljava/net/SocketException;', 'sendto failed: ENETUNREACH (Network is unreachable)');
    }
    if (upgrade) {   // RFC 6455 handshake: the browser's WebSocket stands for the TCP stream (src/websocket-bridge.js); the 101 goes out once it is open
      if (typeof net.openWebSocket !== 'function') throw new NotServed(`a WebSocket upgrade to ${url.href} (this network has no WebSocket)`);
      const session = net.openWebSocket({ url: url.href, headers: request.headers, protocols: upgrade.protocols });
      this.ws = { session, upgrade, decoder: new FrameDecoder(), switched: false, closeQueued: false };
      if (this.requests.length) throw new NotServed('bytes after a WebSocket upgrade request, before the server answered it');
      return;
    }
    net.noteHost(host);
    // redirect: 1 -- a Socket client applies its own redirect rules; where the transport can show 3xx responses (outside a browser) it does, and a browser follows them (it hides them).
    const op = net.start({ method: request.method, url: url.href, headers, body: request.body.length || !['GET', 'HEAD'].includes(request.method) ? request.body : null, redirect: 1, connectTimeout: 0, readTimeout: 0, api: 'Socket', mock });
    this.exchange = { op, request, headSent: false, framing: 'none', declared: null, delivered: 0, noBody: false, closing: false };
  }
}
