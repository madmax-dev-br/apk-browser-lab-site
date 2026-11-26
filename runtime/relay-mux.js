// The relay's parallel channel (docs/NETWORK.md "Parallel relay channel"; Device > "Parallel relay channel", on by default since 2026-11-20). Without it every exchange through the APK Lab Relay is
// its own browser fetch to the relay's one origin: a CORS preflight for most of them (the x-apkweb-* headers, a JSON Content-Type; the preflight cache is per URL and every target
// URL differs), and at most about 6 at a time (the browser's HTTP/1.1 connections per origin), whatever the app runs in parallel. With it one WebSocket from this realm to the relay's
// /mux endpoint carries every exchange at once, multiplexed by id; the relay runs them concurrently with its own HTTP client. VM-free; no process.*.
//
// What the app sees does not change: openExchange (src/network-transport.js) builds the same relay query and the same headers as for the per-request path, the relay decides the
// exchange with the same code (scripts/cors-relay.mjs relayAnswer) and returns the headers the page would have got, and `fetch()` below hands openExchange a response object of the
// same shape a browser's fetch gives (a Headers, a body reader), so the rest of openExchange (Set-Cookie, Content-Encoding, relay error codes) is the per-request path's own code.
//
// Wire protocol, version 1 (the relay's side is muxChannel in scripts/cors-relay.mjs). Text messages are JSON control messages; binary messages are body bytes:
// [kind u8][id u32 big-endian][bytes], kind 1 the request body (lab -> relay), kind 2 the response body (relay -> lab).
//   relay -> lab  {"t":"hello","v":1,"window":262144,"maxBody":33554432,"frame":65536}   first message; a relay without the channel refuses the upgrade, so it never comes
//   lab -> relay  {"t":"req","id":n,"method":"GET","query":"?url=...","headers":[[name,value]...],"length":bytes}, then `length` body bytes in kind-1 frames (none above maxBody)
//   relay -> lab  {"t":"head","id":n,"status":200,"statusText":"OK","headers":[[name,value]...]}, kind-2 frames, {"t":"end","id":n}
//   relay -> lab  {"t":"error","id":n,"code":"ECONNREFUSED","message":"..."}   before the head the per-request path's 502 relay error (x-apkweb-relay-error-code); after it the body failed
//   lab -> relay  {"t":"credit","id":n,"n":bytes}   flow control: the relay sends at most `window` body bytes ahead of what the app's reader consumed
//   lab -> relay  {"t":"abort","id":n}   the app closed the exchange (Socket.close, HttpURLConnection.disconnect): the relay destroys the upstream request
//
// Availability: the first exchange opens the channel and waits for the hello. No hello (an older relay, a relay that is not running, a proxy that is not the relay) means the
// per-request path, for that exchange and for the next ones until `retryMs` later; the app's request never fails because the channel is missing. Exchanges in flight when an open
// channel drops fail as a dropped connection does (ECONNRESET: java.net.SocketException "Connection reset"); the next exchange opens a new channel.
import { tunnelEndpoint } from './tcp-tunnel.js?v=4a7b2c308dd9';

export const MUX_VERSION = 1, MUX_WINDOW = 256 * 1024, MUX_FRAME = 64 * 1024;
const KIND_REQUEST_BODY = 1, KIND_RESPONSE_BODY = 2;
const SEND_HIGH_WATER = 1024 * 1024;   // request body bytes queued in the WebSocket (bufferedAmount) before this side waits for them to leave
const NULL_BODY = new Set([101, 103, 204, 205, 304]);   // fetch gives these statuses (and HEAD) a null body

/** The channel's endpoint for a device network: an explicit policy.muxUrl, or derived from an APK Lab Relay proxy URL (tcp-tunnel.js tunnelEndpoint). Null when none. */
export function muxEndpoint(policy) {
  if (policy?.muxUrl) return String(policy.muxUrl);
  const tcp = tunnelEndpoint({ proxyUrl: policy?.proxyUrl });
  return tcp ? tcp.replace(/\/tcp$/, '/mux') : null;
}
/** host:port of an endpoint, for the trace and the page (an older relay's token stays out of both). */
export const endpointHost = endpoint => { try { return new URL(endpoint).host; } catch { return String(endpoint ?? ''); } };

const abortError = signal => signal?.reason ?? (typeof DOMException === 'function' ? new DOMException('The operation was aborted.', 'AbortError') : Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
const dropError = reason => Object.assign(new Error(`the relay channel closed: ${reason}`), { code: 'ECONNRESET' });
const later = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A channel that is not there (the setting is on, but the Proxy is not the relay): every exchange takes the per-request path, with `reason` in the trace and the network log. */
export const unavailableChannel = reason => ({ ready: () => false, fetch: () => null, reason, close() {} });

/** The body of one exchange, as openExchange reads a fetch body: read() -> { done, value }, cancel(). Consuming bytes grants the relay that much credit again. */
class ChannelBodyReader {
  constructor(channel, exchange) { this.channel = channel; this.exchange = exchange; this.queue = []; this.waiter = null; this.done = false; this.error = null; this.consumed = 0; this.credited = 0; }
  push(bytes) { if (this.done || this.error) return; if (this.waiter) { const waiter = this.waiter; this.waiter = null; this.taken(bytes.length); waiter.resolve({ done: false, value: bytes }); } else this.queue.push(bytes); }
  finish() { this.done = true; if (this.waiter) { const waiter = this.waiter; this.waiter = null; waiter.resolve({ done: true, value: undefined }); } }
  fail(error) { if (this.done) return; this.error = error; if (this.waiter && !this.queue.length) { const waiter = this.waiter; this.waiter = null; waiter.reject(error); } }
  read() {
    if (this.queue.length) { const value = this.queue.shift(); this.taken(value.length); return Promise.resolve({ done: false, value }); }   // bytes that arrived before a failure are read first
    if (this.error) return Promise.reject(this.error);
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject }; });
  }
  taken(n) {
    this.consumed += n; const owed = this.consumed - this.credited;
    if (!this.done && owed >= this.channel.creditStep) { this.credited = this.consumed; this.channel.control({ t: 'credit', id: this.exchange.id, n: owed }); }
  }
  cancel() {
    if (!this.done && !this.error) { this.done = true; this.queue = []; this.channel.cancel(this.exchange); }
    if (this.waiter) { const waiter = this.waiter; this.waiter = null; waiter.resolve({ done: true, value: undefined }); }
    return Promise.resolve();
  }
  releaseLock() {}
}

export class RelayMux {
  /**
   * `endpoint` ws(s)://host:port/mux; `create(url)` makes this realm's WebSocket (null: none, so the channel is unavailable); `onEvent(kind, detail)` hears 'open', 'unavailable'
   * ({ reason }) and 'dropped' ({ reason, inFlight }).
   */
  constructor({ endpoint, create = url => new globalThis.WebSocket(url), onEvent = () => {}, retryMs = 15000, helloTimeoutMs = 3000, now = () => Date.now() }) {
    Object.assign(this, { endpoint, create, onEvent, retryMs, helloTimeoutMs, now });
    this.state = 'idle'; this.socket = null; this.hello = null; this.opening = null; this.retryAt = 0; this.reason = null; this.exchanges = new Map(); this.nextId = 1;
    this.creditStep = MUX_WINDOW / 4; this.stats = { exchanges: 0, opened: 0, drops: 0 };
  }
  get open() { return this.state === 'open'; }
  /** true when exchanges can go over the channel now; false (or a promise of it, the first time) when they take the per-request path. */
  ready() {
    if (this.state === 'open') return true;
    if (this.state === 'connecting') return this.opening;
    if (this.state === 'closed' || this.now() < this.retryAt) return false;
    return this.connect();
  }
  connect() {
    this.state = 'connecting';
    this.opening = new Promise(resolve => {
      let socket = null, settled = false, timer = null;
      const fail = reason => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (this.state === 'connecting') this.state = 'idle';
        this.reason = reason; this.retryAt = this.now() + this.retryMs; this.opening = null;
        try { socket?.close(); } catch { /* never opened */ }
        this.onEvent('unavailable', { reason }); resolve(false);
      };
      if (typeof this.create !== 'function') { fail('this realm has no WebSocket'); return; }
      try { socket = this.create(this.endpoint); } catch (error) { fail(`the channel could not be opened (${error?.message ?? error})`); return; }
      socket.binaryType = 'arraybuffer';
      timer = setTimeout(() => fail('the relay did not greet the channel (a proxy or relay without it?)'), this.helloTimeoutMs);
      socket.onmessage = event => {
        if (settled) { if (this.socket === socket) this.onMessage(event.data); return; }
        let hello = null; if (typeof event.data === 'string') { try { hello = JSON.parse(event.data); } catch { /* not ours */ } }
        if (hello?.t !== 'hello' || hello.v !== MUX_VERSION) { fail(`the relay answered with another channel protocol (${typeof event.data === 'string' ? event.data.slice(0, 80) : 'binary'})`); return; }
        if (this.state === 'closed') { fail('closed'); return; }
        settled = true; clearTimeout(timer);
        this.socket = socket; this.hello = hello; this.state = 'open'; this.reason = null; this.opening = null; this.stats.opened++;
        this.creditStep = Math.max(1, Math.floor((hello.window ?? MUX_WINDOW) / 4));
        this.onEvent('open', { window: hello.window ?? MUX_WINDOW, version: hello.v }); resolve(true);
      };
      socket.onerror = () => { if (!settled) fail('the relay refused the channel or is not running (a relay without it is older than APK Lab Relay 0.4.0)'); };
      socket.onclose = event => { if (!settled) fail(`the relay closed the channel before greeting it (code ${event?.code ?? '?'})`); else if (this.socket === socket) this.dropped(`code ${event?.code ?? '?'}${event?.reason ? ` ${event.reason}` : ''}`); };
    });
    return this.opening;
  }
  /** An open channel that closed: what was in flight fails as a dropped connection; the next exchange opens a new channel. */
  dropped(reason) {
    const inFlight = this.exchanges.size; this.socket = null; this.hello = null; this.stats.drops++;
    if (this.state !== 'closed') this.state = 'idle';
    this.reason = `the channel dropped (${reason})`; this.retryAt = 0;
    const error = dropError(reason);
    for (const exchange of this.exchanges.values()) this.settle(exchange, error);
    this.exchanges.clear();
    this.onEvent('dropped', { reason, inFlight });
  }
  /** Fails an exchange: its fetch promise before the head, its body after. */
  settle(exchange, error) { exchange.closed = true; if (exchange.reader) exchange.reader.fail(error); else exchange.reject(error); }
  control(message) { try { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message)); } catch { /* closing: its close event fails what is in flight */ } }
  /** The app closed the exchange: the relay drops the upstream request. */
  cancel(exchange) { if (exchange.closed) return; exchange.closed = true; this.exchanges.delete(exchange.id); this.control({ t: 'abort', id: exchange.id }); this.closeIfRetired(); }

  /**
   * The exchange over the channel, in fetch's terms: `target` the relay URL the per-request path would fetch (only its query is sent), `init` openExchange's fetch init. Resolves a
   * response object ({ status, statusText, headers: Headers, body: { getReader, cancel } | null, type, redirected, url }) once the head arrived; rejects as fetch rejects (AbortError,
   * or an error with a code: the channel dropped). Returns null without sending anything when the channel is not open (the caller takes the per-request path).
   */
  fetch(target, init = {}) {
    if (this.state !== 'open' || this.socket?.readyState !== 1) return null;
    const signal = init.signal ?? null; if (signal?.aborted) return Promise.reject(abortError(signal));
    let query; try { query = new URL(target).search; } catch { return null; }
    const body = init.body == null ? null : init.body instanceof Uint8Array ? init.body : typeof init.body === 'string' ? new TextEncoder().encode(init.body) : new Uint8Array(init.body);
    const method = String(init.method ?? 'GET').toUpperCase(), length = method === 'GET' || method === 'HEAD' ? 0 : body?.length ?? 0;
    const id = this.nextId; this.nextId = this.nextId >= 0xffffffff ? 1 : this.nextId + 1;
    const exchange = { id, method, target, reader: null, closed: false, resolve: null, reject: null };
    const promise = new Promise((resolve, reject) => { exchange.resolve = resolve; exchange.reject = reject; });
    this.exchanges.set(id, exchange); this.stats.exchanges++;
    const headers = Array.isArray(init.headers) ? init.headers.map(([name, value]) => [String(name), String(value)]) : [...new Headers(init.headers ?? [])];
    this.control({ t: 'req', id, method, query, headers, length });
    if (length && length <= (this.hello?.maxBody ?? Infinity)) this.sendBody(exchange, body);   // over the relay's limit no byte is sent: the relay answers 413 as its per-request path does
    if (signal) {
      const onAbort = () => { if (exchange.closed) return; const error = abortError(signal); this.cancel(exchange); if (exchange.reader) exchange.reader.fail(error); else exchange.reject(error); };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(() => {}, () => {}).finally(() => { if (!exchange.reader) signal.removeEventListener('abort', onAbort); });
    }
    return promise;
  }
  /** The request body in frames of `frame` bytes, waiting while the WebSocket holds more than SEND_HIGH_WATER unsent bytes (backpressure from bufferedAmount). */
  async sendBody(exchange, body) {
    const frame = this.hello?.frame ?? MUX_FRAME, socket = this.socket;
    for (let at = 0; at < body.length; at += frame) {
      while (socket.readyState === 1 && socket.bufferedAmount > SEND_HIGH_WATER && !exchange.closed) await later(4);
      if (exchange.closed || socket.readyState !== 1 || this.socket !== socket) return;
      const piece = body.subarray(at, Math.min(body.length, at + frame)), message = new Uint8Array(5 + piece.length);
      message[0] = KIND_REQUEST_BODY; new DataView(message.buffer).setUint32(1, exchange.id); message.set(piece, 5);
      try { socket.send(message); } catch { return; }
    }
  }
  onMessage(data) {
    if (typeof data !== 'string') {
      const bytes = new Uint8Array(data); if (bytes.length < 5 || bytes[0] !== KIND_RESPONSE_BODY) return;
      const id = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1), exchange = this.exchanges.get(id);
      if (exchange?.reader && !exchange.closed) exchange.reader.push(bytes.subarray(5));
      return;
    }
    let message; try { message = JSON.parse(data); } catch { return; }
    const exchange = this.exchanges.get(message?.id);
    if (!exchange) return;
    if (message.t === 'head') {
      const headers = new Headers();
      for (const pair of message.headers ?? []) { try { headers.append(pair[0], pair[1]); } catch { /* a name or value this realm refuses: a browser's fetch would not have exposed it either */ } }
      const hasBody = exchange.method !== 'HEAD' && !NULL_BODY.has(message.status);
      if (hasBody) exchange.reader = new ChannelBodyReader(this, exchange);
      const reader = exchange.reader;
      exchange.resolve({ type: 'default', status: message.status, statusText: String(message.statusText ?? ''), headers, redirected: false, url: exchange.target, channel: 'mux',
        body: reader ? { getReader: () => reader, cancel: () => reader.cancel() } : null });
    } else if (message.t === 'end') {
      this.exchanges.delete(exchange.id); exchange.closed = true; exchange.reader?.finish(); this.closeIfRetired();
    } else if (message.t === 'error') {
      this.exchanges.delete(exchange.id); exchange.closed = true; this.closeIfRetired();
      if (exchange.reader) exchange.reader.fail(Object.assign(new Error(message.message ?? message.code), { code: message.code ?? null }));
      // before the head: the relay error the per-request path answers as a 502 with x-apkweb-relay-error-code, so openExchange maps (and renews a client identity) exactly as there
      else exchange.resolve({ type: 'default', status: 502, statusText: 'Bad Gateway', headers: new Headers([['x-apkweb-relay-error-code', String(message.code ?? 'EFETCH')], ['x-apkweb-relay-error', String(message.message ?? '').replace(/[\r\n]+/g, ' ').slice(0, 300)]]), redirected: false, url: exchange.target, channel: 'mux', body: null });
    }
  }
  /** The setting turned off, or another relay: nothing new goes over this channel; what is in flight finishes, then the WebSocket closes. */
  retire() { if (this.state === 'closed') return; this.state = 'closed'; this.closeIfRetired(); }
  closeIfRetired() {
    if (this.state !== 'closed' || this.exchanges.size || !this.socket) return;
    const socket = this.socket; this.socket = null; this.hello = null;
    try { socket.close(1000); } catch { /* closed */ }
  }
  /** Ends the channel now: nothing new goes over it; what is in flight fails as on a drop. */
  close() {
    const socket = this.socket; this.state = 'closed'; this.socket = null; this.hello = null;
    const error = dropError('closed by the lab');
    for (const exchange of this.exchanges.values()) this.settle(exchange, error);
    this.exchanges.clear();
    try { socket?.close(1000); } catch { /* closed */ }
  }
}
