// WebSocket over the virtual HTTP socket (src/virtual-http-socket.js, docs/NETWORK.md). A client that speaks WebSocket over a java.net.Socket (OkHttp's WebSocket, the Realtime Database
// client of Firebase, any RFC 6455 client) first sends an HTTP/1.1 `Upgrade: websocket` request, then binary frames. A browser cannot hand the page that TCP stream, but it has a
// WebSocket: the lab opens one to the same URL (ws:// for http, wss:// for a socket the app wrapped in its SSLSocket: the browser does the TLS, as for fetch), answers the app's
// handshake itself with "101 Switching Protocols" once the browser's socket is open (Sec-WebSocket-Accept computed from the app's key, RFC 6455 4.2.2), and from then on translates:
// each message the app sends (its masked frames, fragmented or not) becomes one send() of the browser's socket, each message the browser receives becomes one unmasked frame the
// app reads. Pings the app sends are answered by the lab (the browser keeps the real connection alive with its own pings, which pages never see); a close frame closes the
// browser's socket with the app's code and reason, and the server's close comes back as a close frame. What a browser cannot do fails explicitly: request headers other than the
// subprotocols (a browser WebSocket sends its own), extensions (permessage-deflate is negotiated by the browser with the server, never seen by the app).
// VM-free and DOM-free; no process.*.

export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const OPCODE = { CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xA };
export const MAX_MESSAGE = 64 * 1024 * 1024;
const utf8 = new TextEncoder(), utf8Decode = new TextDecoder('utf-8', { fatal: false });

/** SHA-1 of bytes (synchronous: the handshake answer is made where no promise can be awaited). */
export function sha1(bytes) {
  const words = new Uint32Array(80), length = bytes.length, padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes); padded[length] = 0x80; const view = new DataView(padded.buffer); view.setUint32(padded.length - 4, length * 8 >>> 0); view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 80; i++) { const x = words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16]; words[i] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (b & c) | (~b & d) : i < 40 ? b ^ c ^ d : i < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d, k = i < 20 ? 0x5A827999 : i < 40 ? 0x6ED9EBA1 : i < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
      const t = (((a << 5) | (a >>> 27)) + f + e + k + words[i]) >>> 0; e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20), outView = new DataView(out.buffer); [h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h)); return out;
}
const base64 = bytes => { let text = ''; for (const b of bytes) text += String.fromCharCode(b); return btoa(text); };
/** RFC 6455 4.2.2: the Sec-WebSocket-Accept value for a client's Sec-WebSocket-Key. */
export const acceptKey = key => base64(sha1(utf8.encode(String(key).trim() + WS_GUID)));

/** A frame the lab sends to the app (server to client: never masked). */
export function encodeFrame(opcode, payload, fin = true) {
  const data = payload instanceof Uint8Array ? payload : utf8.encode(String(payload ?? '')), n = data.length;
  const head = n < 126 ? 2 : n < 65536 ? 4 : 10, out = new Uint8Array(head + n), view = new DataView(out.buffer);
  out[0] = (fin ? 0x80 : 0) | opcode;
  if (n < 126) out[1] = n; else if (n < 65536) { out[1] = 126; view.setUint16(2, n); } else { out[1] = 127; view.setUint32(2, Math.floor(n / 0x100000000)); view.setUint32(6, n >>> 0); }
  out.set(data, head); return out;
}
/** A close frame's payload: the code and the UTF-8 reason. */
export function closePayload(code, reason = '') { if (!code) return new Uint8Array(0); const text = utf8.encode(reason).subarray(0, 123), out = new Uint8Array(2 + text.length); out[0] = code >> 8; out[1] = code & 255; out.set(text, 2); return out; }

/** Parses the frames the app writes (client to server: masked, RFC 6455 5.1) into whole messages and control frames. */
export class FrameDecoder {
  constructor() { this.buffer = new Uint8Array(0); this.fragments = null; this.fragmentOpcode = 0; this.fragmentBytes = 0; }
  /** Feeds bytes; returns [{ opcode, payload }] for each complete message (TEXT / BINARY, fragments joined) and control frame (CLOSE / PING / PONG). Throws on a protocol error. */
  push(bytes) {
    const joined = new Uint8Array(this.buffer.length + bytes.length); joined.set(this.buffer); joined.set(bytes, this.buffer.length); this.buffer = joined;
    const out = [];
    for (;;) {
      const b = this.buffer; if (b.length < 2) break;
      const fin = (b[0] & 0x80) !== 0, rsv = b[0] & 0x70, opcode = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0; let length = b[1] & 0x7f, at = 2;
      if (rsv) throw new Error(`WebSocket frame with reserved bits ${rsv >> 4} (an extension the lab does not negotiate)`);
      if (length === 126) { if (b.length < 4) break; length = (b[2] << 8) | b[3]; at = 4; }
      else if (length === 127) { if (b.length < 10) break; const view = new DataView(b.buffer, b.byteOffset); length = view.getUint32(2) * 0x100000000 + view.getUint32(6); at = 10; }
      if (length > MAX_MESSAGE) throw new Error(`WebSocket frame of ${length} bytes is over the lab's ${MAX_MESSAGE}-byte limit`);
      const maskAt = at; if (masked) at += 4; if (b.length < at + length) break;
      const payload = b.slice(at, at + length); if (masked) for (let i = 0; i < length; i++) payload[i] ^= b[maskAt + (i & 3)];
      this.buffer = b.subarray(at + length);
      if (opcode >= 0x8) { if (!fin || length > 125) throw new Error('A fragmented or oversized WebSocket control frame'); out.push({ opcode, payload }); continue; }
      if (opcode === OPCODE.CONTINUATION) { if (!this.fragments) throw new Error('A WebSocket continuation frame without a message to continue'); this.fragments.push(payload); this.fragmentBytes += length; }
      else { if (this.fragments) throw new Error('A new WebSocket message started before the previous one ended'); this.fragments = [payload]; this.fragmentOpcode = opcode; this.fragmentBytes = length; }
      if (this.fragmentBytes > MAX_MESSAGE) throw new Error(`WebSocket message over the lab's ${MAX_MESSAGE}-byte limit`);
      if (fin) {
        const parts = this.fragments, whole = new Uint8Array(this.fragmentBytes); let offset = 0; for (const part of parts) { whole.set(part, offset); offset += part.length; }
        out.push({ opcode: this.fragmentOpcode, payload: whole }); this.fragments = null; this.fragmentBytes = 0;
      }
    }
    return out;
  }
}

/** The headers of an HTTP/1.1 request that asks for a WebSocket upgrade (RFC 6455 4.1), or null. */
export function websocketRequest(request) {
  const get = name => request.headers.find(([key]) => key.toLowerCase() === name)?.[1] ?? null;
  const upgrade = get('upgrade'), connection = get('connection') ?? '';
  if (!upgrade || upgrade.toLowerCase() !== 'websocket' || !/\bupgrade\b/i.test(connection) || request.method !== 'GET') return null;
  const key = get('sec-websocket-key'); if (!key) return null;
  const protocols = (get('sec-websocket-protocol') ?? '').split(',').map(p => p.trim()).filter(Boolean);
  return { key, protocols, extensions: get('sec-websocket-extensions'), version: get('sec-websocket-version') };
}

/**
 * The browser side of one upgraded socket: { open, error, closed, queue (frames for the app), protocol, send(opcode, payload), close(code, reason), dispose() }. `create(url,
 * protocols)` makes the browser's WebSocket (globalThis.WebSocket by default; tests pass their own); `signal()` wakes the VM when something arrived.
 */
export function openWebSocketSession({ url, protocols = [], create = (u, p) => new globalThis.WebSocket(u, p), signal = () => {}, onLog = () => {} }) {
  const session = { open: false, error: null, closed: false, closeSent: false, queue: [], queued: 0, protocol: '', socket: null, messagesIn: 0, messagesOut: 0, bytesIn: 0, bytesOut: 0 };
  const push = bytes => { session.queue.push(bytes); session.queued += bytes.length; signal(); };
  let socket;
  try { socket = create(url, protocols.length ? protocols : undefined); }
  catch (error) { session.error = { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${url}: ${error?.message ?? error}` }; return session; }
  session.socket = socket; socket.binaryType = 'arraybuffer';
  socket.onopen = () => { session.open = true; session.protocol = socket.protocol ?? ''; onLog('open'); signal(); };
  socket.onmessage = event => {
    const data = event.data, bytes = typeof data === 'string' ? utf8.encode(data) : new Uint8Array(data);
    session.messagesIn++; session.bytesIn += bytes.length; push(encodeFrame(typeof data === 'string' ? OPCODE.TEXT : OPCODE.BINARY, bytes));
  };
  socket.onerror = () => { if (!session.open && !session.error) { session.error = { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${url} (the WebSocket handshake did not complete)` }; signal(); } };
  socket.onclose = event => {
    if (!session.open && !session.error) session.error = { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${url} (closed with ${event.code})` };
    else if (session.open && !session.closed) push(encodeFrame(OPCODE.CLOSE, closePayload(event.code === 1005 ? 0 : event.code, event.reason ?? '')));
    session.closed = true; onLog('closed', event.code); signal();
  };
  session.send = (opcode, payload) => {
    if (session.closeSent || session.closed) return;
    session.messagesOut++; session.bytesOut += payload.length;
    socket.send(opcode === OPCODE.TEXT ? utf8Decode.decode(payload) : payload);
  };
  session.close = (code, reason) => { if (session.closeSent) return; session.closeSent = true; try { socket.close(code && code !== 1005 && code !== 1006 ? code : 1000, reason); } catch { try { socket.close(); } catch { /* already closed */ } } };
  session.dispose = () => { session.closed = true; try { if (socket.readyState < 2) socket.close(1001); } catch { /* gone */ } };
  return session;
}
