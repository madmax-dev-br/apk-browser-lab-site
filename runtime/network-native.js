import { APKError } from './apk-error.js?v=aaf505bc5b3f';
import { throwNew } from './java-throw.js?v=aaf505bc5b3f';
import { mapUrl, hostMapServesHost, noteRedirect } from './host-map.js?v=aaf505bc5b3f';
import { matchEndpointMock, mockServesHost, noteMockHit } from './endpoint-mocks.js?v=aaf505bc5b3f';
import { Blocked } from './scheduler.js?v=aaf505bc5b3f';
import { captureBody } from './network-capture.js?v=aaf505bc5b3f';
import { OS_CONSTANTS } from './os-constants-data.js?v=aaf505bc5b3f';
import { openExchange, describeFailure } from './network-transport.js?v=aaf505bc5b3f';
import { WorkerExecutor } from './network-worker-executor.js?v=aaf505bc5b3f';
import { parseNetworkSecurityConfig, cleartextPermittedFor } from './network-security-config.js?v=aaf505bc5b3f';
import { TransportAuthority } from './transport-ca.js?v=aaf505bc5b3f';
import { openWebSocketSession } from './websocket-bridge.js?v=aaf505bc5b3f';
import { tunnelEndpoint, openTunnelSession } from './tcp-tunnel.js?v=aaf505bc5b3f';
import { RelayMux, muxEndpoint, endpointHost, unavailableChannel } from './relay-mux.js?v=aaf505bc5b3f';
import { destination, destinationOfUrl, identityKey, registerClientIdentity, forgetClientIdentities } from './client-identity.js?v=aaf505bc5b3f';
import { ExchangeTrace, NetTrace } from './net-trace.js?v=aaf505bc5b3f';


// The web device's network: the boundary between the original java.net classes in framework.dex and the browser's fetch.
//
//  * Name resolution is libcore.io.Linux.android_getaddrinfo (bound here): the device network policy answers it, so the original InetAddress, URL and HttpURLConnection
//    code sees the same failures an Android device gives (UnknownHostException "Unable to resolve host", SecurityException without INTERNET, ConnectException ENETUNREACH).
//  * HTTP exchanges are dev.apkweb.net.NetBridge natives. A call that has to wait parks the calling Java thread in the scheduler (Blocked) while an asynchronous fetch
//    runs; no SharedArrayBuffer and no cross-origin isolation are needed. A frame that cannot suspend (a nested host run) is reported explicitly by the scheduler.
//  * "Mock de endpoints" (src/endpoint-mocks.js): start() is the single entry of every HTTP exchange (HttpURLConnection through NetBridge.open, the virtual HTTP socket of a
//    java.net.Socket / OkHttp, DownloadManager). A request a mock matches is answered here, before the policy below and before any executor: the operation gets the configured head and
//    body (after the configured delay on the VM clock) and never reaches fetch. The callers ask matchMock() before applying the policy, and the resolver and Socket.connect let a
//    host a mock serves through (mockServesHost), so the request can reach the mock without the host being in the allow list.
//  * "Redirecionar hosts" (src/host-map.js): a request an enabled rule maps is not refused by the allow list (the rule names where it goes), the resolver and Socket.connect let a
//    host a rule serves through (redirectServesHost), and start() counts it per rule (responses / failures), with a Logcat warning at the first one. Offline still refuses it.
//  * Policy: offline device => every lookup fails and every connect is ENETUNREACH; otherwise only hosts in the allowlist (platform.networkPolicy.allowedHosts) are
//    reachable. The default allowlist is empty, i.e. the device is effectively offline. TCP is never opened: a java.net.Socket connected to a permitted host is a virtual HTTP socket
//    (src/virtual-http-socket.js) whose requests are exchanges of this bridge, and an SSLSocket over it presents the lab transport CA's chain (src/tls-socket-host.js, docs/NETWORK.md).
const NET = 'Ldev/apkweb/net/NetBridge;', LINUX = 'Llibcore/io/Linux;', STRING = 'Ljava/lang/String;', INET = 'Ljava/net/InetAddress;', GAI = 'Landroid/system/GaiException;', ERRNO = 'Landroid/system/ErrnoException;';
const C = OS_CONSTANTS, BOUNDARY = 'network-boundary';
const HIGH_WATER = 256 * 1024, CHUNK = 64 * 1024;
const NOT_A_RELAY = 'the Proxy is not an APK Lab Relay address (http://127.0.0.1:<port>/<token>/?url={url}), so it has no channel to open';

/** True for "a.b.c.d" and for IPv6 literals. */
/** The host of the proxy a request goes through (Dispositivo › Proxy: a relay URL with {url}, or a prefix), for the network log; null without one. */
const proxyHost = proxyUrl => { if (!proxyUrl) return null; try { return new URL(String(proxyUrl).replace('{url}', 'x')).host; } catch { return null; } };
export const isIpLiteral = host => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || (host.includes(':') && /^[0-9a-f:.]+$/i.test(host));
const loopbackHost = host => host === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(host) || host === '::1';

/** One HTTP exchange. */
class Operation {
  constructor(handle, request) {
    this.handle = handle; this.request = request; this.head = null; this.queue = []; this.queued = 0; this.ended = false; this.error = null; this.closed = false;
    this.abortController = typeof AbortController === 'function' ? new AbortController() : null; this.reader = null; this.resume = null; this.consumed = 0; this.executor = 'main'; this.shared = null; this.received = 0; this.log = null;
    this.trace = null;   // its timeline (src/net-trace.js), from start()
  }
  abort() { try { this.abortController?.abort(); } catch { /* already finished */ } try { this.reader?.cancel()?.catch?.(() => {}); } catch { /* ignored */ } this.onAbort?.(); }
}

export class NetworkBridge {
  constructor(runtime) {
    this.runtime = runtime; this.ops = new Map(); this.nextHandle = 1; this.activity = false; this.waiters = new Set();
    this.stats = { requests: 0, denied: 0, offlineRejections: 0, bytesIn: 0, bytesOut: 0, failures: 0, hosts: new Set(), redirectsObserved: 0, loopbackConnects: 0, loopbackRefused: 0 };
    this.droppedRequestHeaders = new Set();
    runtime.platform.addExternalSource?.({ delay: () => this.delay(), drained: () => this.drained(), pending: () => this.pending });
  }
  get platform() { return this.runtime.platform; }
  /** The effective policy: an explicit platform.networkPolicy (probes and tests) or the one in the device settings (Dispositivo panel, player config). */
  get policy() {
    if (this.platform.networkPolicy) return this.platform.networkPolicy;
    const network = this.platform.device?.network;
    if (this.derived?.source !== network) this.derived = { source: network, value: { allowedHosts: network?.allowedHosts ?? [], proxyUrl: network?.proxyUrl ?? '', hostMap: network?.hostMap ?? [], clientCertHosts: network?.clientCertHosts ?? [], relayChannel: network?.relayChannel === true, fetch: null, redirect: 'auto' } };
    return this.derived.value;
  }
  /** The Worker's network log (src/netlog.js), or null (tests, hosts that attach none). */
  get log() { return this.runtime.netLog ?? null; }
  /** Reports a request the policy refused (allowlist, or the device being offline) to the network log; the caller still counts and fails it. */
  logRefusal(info) { this.log?.refuse({ ...info, offline: !this.online }); }
  /** Syncs the operation's log entry with what the exchange has produced so far. */
  observe(op) { if (op.redirect) this.settleRedirect(op); if (op.log) this.log?.observe(op.log, op); }
  /** A redirected exchange that got its head counts as a response of its rule, one that failed before it as a failure (once per exchange). */
  settleRedirect(op) {
    const state = op.redirect; if (state.settled) return;
    if (op.head) { state.settled = true; state.record.responses++; }
    else if (op.error) { state.settled = true; state.record.failures++; state.record.lastFailure = String(op.error.message ?? op.error.type ?? '').slice(0, 300); }
    else if (op.closed) { state.settled = true; state.record.closed++; }   // the app closed it before anything came back
  }
  get online() { return (this.platform.device?.connectivity ?? 'online') !== 'offline'; }
  /** The timelines of the finished exchanges (src/net-trace.js): a measurement aid. */
  get trace() { return this.traces ??= new NetTrace(); }
  get pending() { let n = this.jobs ?? 0; for (const op of this.ops.values()) if (op.executor !== 'mock' && !op.ended && op.error === null && !op.closed) n++; return n; }   // a mocked answer is a timer on the VM clock (delay()), not I/O
  /** Exchanges whose progress reaches the VM only through this realm's event loop (its own fetch, not the network worker's shared memory), and asynchronous host jobs: what a
   *  pump that never returns to the event loop holds back (src/apk-worker.js ioYieldMs). */
  get pendingInRealm() { let n = this.jobs ?? 0; for (const op of this.ops.values()) if (op.executor === 'main' && !op.ended && op.error === null && !op.closed) n++; return n; }
  /** Asynchronous host work the VM may have to wait for (WebCrypto certificate signing): counted as pending so the scheduler waits for the event loop instead of reporting a deadlock. */
  track(promise) { this.jobs = (this.jobs ?? 0) + 1; const done = () => { this.jobs--; this.signal(); }; promise.then(done, done); return promise; }
  /** The session's lab transport CA (src/transport-ca.js): the certificates SSLSockets over virtual HTTP sockets present. */
  get authority() { return this.transportAuthority ??= new TransportAuthority({ now: () => this.platform.clock.wall(), track: promise => this.track(promise) }); }

  /** Is `host`(:port) reachable under the allowlist? Entries: "host", "*.suffix", "host:port", "*". Loopback needs an explicit entry too. */
  allowed(host, port = null) {
    if (!this.online) return false;
    const lower = String(host).toLowerCase();
    for (const raw of this.policy.allowedHosts ?? []) {
      const entry = String(raw).toLowerCase(); let name = entry, entryPort = null;
      const colon = entry.lastIndexOf(':'); if (colon > 0 && !entry.includes('::') && /^\d+$/.test(entry.slice(colon + 1))) { name = entry.slice(0, colon); entryPort = Number(entry.slice(colon + 1)); }
      if (entryPort !== null && port !== null && entryPort !== Number(port)) continue;
      if (name === '*' || name === lower || (name.startsWith('*.') && lower.endsWith(name.slice(1)) && lower.length > name.length - 1)) return true;
    }
    return false;
  }
  /** "Redirecionar hosts": where the exchange for `url` goes ({ url, rule, shape, key }), or null. */
  redirectFor(url) { return mapUrl(url, this.policy.hostMap); }
  /** Could a redirect rule serve `host`(:port)? (the scheme is not known at a lookup or a connect). Offline: no. */
  redirectServesHost(host, port = null) { return this.online && hostMapServesHost(this.policy.hostMap, host, port); }
  /** May an exchange for `url` (host, port) go out: online and either allowed or redirected by a rule. */
  permits(url, host, port) { return this.online && (this.allowed(host, port) || !!this.redirectFor(url)); }
  /** The per-rule counts of "Redirecionar hosts" (key -> { hits, responses, failures, lastFailure }). */
  get redirects() { return this.redirectTable ??= new Map(); }
  noteHost(host) { this.stats.hosts.add(String(host).toLowerCase()); }
  /** The resolver's table: the address text a lookup returned -> the name that was looked up (a Socket connects to the address; the policy and the HTTP Host live in the name). Bounded. */
  rememberResolved(address, host) { const table = this.resolved ??= new Map(); table.delete(address); table.set(address, host); if (table.size > 256) table.delete(table.keys().next().value); }
  resolvedName(address) { return this.resolved?.get(address) ?? null; }

  /** Called when the page changes the device connectivity: exchanges in flight fail like a dropped link. */
  connectivityChanged() {
    if (this.online) return;
    for (const op of this.ops.values()) if (op.executor !== 'mock' && !op.ended && op.error === null) { op.error = { type: 'Ljava/net/SocketException;', message: 'Software caused connection abort' }; op.abort(); this.observe(op); }
    this.signal();
  }
  signal() { this.activity = true; this.platform.onExternalActivity?.(); for (const resolve of [...this.waiters]) resolve(); }
  /** Resolves on the next network activity (tests and drivers that pump the VM themselves). */
  whenActivity(timeoutMs = 2000) { return new Promise(resolve => { const done = () => { clearTimeout(timer); this.waiters.delete(done); resolve(); }; const timer = setTimeout(done, timeoutMs); this.waiters.add(done); }); }
  /** Delay (ms) until the VM has something to do because of the network: 0 when an exchange made progress since the last drain. */
  delay() {
    if (this.activity) return 0;
    if (!this.mockWaiting?.size) return null;
    let best = null; const now = this.platform.clock.now();
    for (const op of this.mockWaiting) { const ms = Math.max(0, op.mock.readyAt - now); if (best === null || ms < best) best = ms; }
    return best;
  }
  drained() { this.activity = false; }

  fetchFunction() {
    const fn = this.policy.fetch ?? globalThis.fetch;
    if (typeof fn !== 'function') throw new APKError('fetch is not available in this environment', { kind: BOUNDARY });
    return fn.bind(globalThis);
  }

  /** Which executor carries an exchange: an injected fetch (tests, probes) stays in this realm; otherwise the network worker when the environment has one (synchronous waits
   * become possible), else this realm's fetch. policy.executor can force 'main' or 'worker'. */
  executorFor() {
    const policy = this.policy;
    if (policy.fetch || policy.executor === 'main') return 'main';
    if (WorkerExecutor.available()) return 'worker';
    if (policy.executor === 'worker') throw new APKError('The synchronous network worker needs worker_threads (Node) or a cross-origin isolated page (SharedArrayBuffer + Workers)', { kind: BOUNDARY });
    return 'main';
  }
  /** The active mock (src/endpoint-mocks.js) that answers `request` { method, url, body }, or null. Asked before the policy: a mocked request is never refused. */
  matchMock(request) { const mocks = this.platform.endpointMocks; return mocks ? matchEndpointMock(mocks, request) : null; }
  /** Can a mock answer requests for this host (name lookups and Socket.connect let it through)? */
  mockServesHost(host, port = null, options) { const mocks = this.platform.endpointMocks; return mocks ? mockServesHost(mocks, host, port, options) : false; }
  /** request.mock: the caller's matchMock() answer (null = checked, none); when absent the request is matched here. */
  start(request, reserved = null) {
    const op = reserved ?? new Operation(this.nextHandle++, request); op.request = request; this.ops.set(op.handle, op);
    op.trace = new ExchangeTrace(request.api ?? 'java.net', request.url, this.runtime.thread?.name ?? null);
    this.stats.requests++; this.noteHost(new URL(request.url).hostname);
    const mock = request.mock !== undefined ? request.mock : this.matchMock(request);
    if (this.requestObserver) this.requestObserver(request, mock);   // a background render lists the requests made while it runs (src/render-variant.js)
    if (mock) return this.startMock(op, mock);
    this.stats.bytesOut += request.body?.length ?? 0;
    op.executor = this.executorFor(); const mapped = this.redirectFor(request.url); op.log = this.log?.begin(request, { api: request.api, mapped, proxy: proxyHost(this.policy.proxyUrl), channel: this.relayChannelOn() ? 'pending' : null }) ?? null;
    if (mapped) { op.redirect = { record: noteRedirect(this.runtime, this.redirects, mapped, request), settled: false }; this.stats.redirected = (this.stats.redirected ?? 0) + 1; }
    if (op.executor === 'worker') { try { const worker = (this.worker ??= new WorkerExecutor(this)), start = () => worker.start(op, request, { proxyUrl: this.policy.proxyUrl, redirect: this.policy.redirect ?? 'auto', hostMap: this.policy.hostMap ?? [], clientIdentity: this.clientIdentityFor(request.url), relayChannel: this.relayChannelSpec() }); const identity = this.clientIdentityJob(request.url); if (identity) { const dest = destinationOfUrl(this.redirectFor(request.url)?.url ?? request.url); identity.then(() => this.noteClientIdentityUse(dest), () => {}); } if (identity) identity.then(start, start); else start(); } catch (error) { op.error = describeFailure(error, request); this.stats.failures++; this.observe(op); this.signal(); } }
    else this.run(op).catch(error => { this.noteChannelOf(op, error); op.error ??= describeFailure(error, request, request.timedOut); this.stats.failures++; }).finally(() => { this.observe(op); this.signal(); });
    return op;
  }

  // ---- the relay's parallel channel (src/relay-mux.js; Device > "Parallel relay channel", off by default) ------------------------------------------------------------------------
  /** Is the channel asked for: the setting on and a proxy set (the channel only exists for exchanges through the relay). */
  relayChannelOn() { const policy = this.policy; return policy.relayChannel === true && !!policy.proxyUrl; }
  /** What the network worker needs to open the channel in its own realm: { endpoint, headers } (headers: tests in Node, which add the page's Origin), { unavailable } or null. */
  relayChannelSpec() {
    if (!this.relayChannelOn()) return null;
    const endpoint = muxEndpoint(this.policy); this.noteChannelSetting(endpoint);
    return endpoint ? { endpoint, ...(this.policy.muxHeaders ? { headers: { ...this.policy.muxHeaders } } : {}) } : { unavailable: NOT_A_RELAY };
  }
  /** The channel for exchanges in this realm, or null when the setting is off. One per relay endpoint; a changed Proxy (or the setting off) retires the previous one (what is in flight on it finishes). */
  relayChannel() {
    if (!this.relayChannelOn()) { if (this.mux) { this.mux.retire(); this.mux = null; } return null; }   // turned off: what is in flight on it finishes, nothing new goes over it
    const endpoint = muxEndpoint(this.policy); this.noteChannelSetting(endpoint);
    if (!endpoint) return (this.muxUnavailable ??= unavailableChannel(NOT_A_RELAY));
    if (this.mux?.endpoint !== endpoint) {
      this.mux?.retire();
      const Socket = this.policy.WebSocket ?? globalThis.WebSocket;
      this.mux = new RelayMux({ endpoint, create: Socket ? url => new Socket(url) : null, onEvent: (kind, detail) => this.noteRelayChannel(kind, detail, endpoint) });
    }
    return this.mux;
  }
  /** The trace says once per relay that the setting is on (and how exchanges go without the channel). */
  noteChannelSetting(endpoint) {
    const key = endpoint ?? '(none)'; if (this.channelNoted === key) return; this.channelNoted = key;
    this.runtime?.record?.(endpoint ? `NET relay channel: on (Device > Parallel relay channel); the exchanges through the relay at ${endpointHost(endpoint)} share one WebSocket (/<token>/mux); while it is not open they go as separate requests`
      : `NET relay channel: on, but NOT used: ${NOT_A_RELAY}; every exchange goes as a separate request`);
  }
  /** A state change of a channel (this realm's or the network worker's): open, unavailable (an older relay, none running), dropped. Said in the trace once per change. */
  noteRelayChannel(kind, detail = {}, endpoint = '') {
    const where = endpointHost(endpoint), stats = this.stats.relayChannel ??= { opened: 0, drops: 0, unavailable: 0, exchanges: 0, fallbacks: 0, state: 'connecting' };
    if (kind === 'open') { stats.opened++; stats.state = 'open'; this.channelLastNote = null; this.runtime?.record?.(`NET relay channel open: ${where}, protocol ${detail.version ?? 1}, window ${Math.round((detail.window ?? 0) / 1024)} KiB per exchange`); }
    else if (kind === 'unavailable') { stats.unavailable++; stats.state = 'unavailable'; const text = `NET relay channel NOT available at ${where}: ${detail.reason}; exchanges go as separate requests (the channel is tried again in a few seconds)`; if (this.channelLastNote !== text) { this.channelLastNote = text; this.runtime?.record?.(text); } }
    else if (kind === 'dropped') { stats.drops++; stats.state = 'dropped'; this.channelLastNote = null; this.runtime?.record?.(`NET relay channel dropped at ${where} (${detail.reason}): ${detail.inFlight ?? 0} exchange(s) in flight failed as a dropped connection (Connection reset); the next exchange opens it again`); }
  }
  /** Which path an exchange took (head.relayChannel / error.relayChannel, see openExchange), onto the operation and its log entry; counted. */
  noteChannelOf(op, carrier) {
    const channel = carrier?.relayChannel ?? null; if (!channel || op.relayChannel) return;
    op.relayChannel = channel; op.relayChannelNote = carrier.relayChannelNote ?? null;
    const stats = this.stats.relayChannel ??= { opened: 0, drops: 0, unavailable: 0, exchanges: 0, fallbacks: 0, state: 'connecting' };
    if (channel === 'mux') stats.exchanges++; else stats.fallbacks++;
  }
  /**
   * A WebSocket the app asked for over a virtual HTTP socket (src/websocket-bridge.js): the browser's WebSocket to the same URL (ws:// for http, wss:// for https), after the
   * "Redirecionar hosts" rules. Not an exchange of `ops` (an open WebSocket is not a pending request: the screen may be ready while it stays open); its arrivals wake the VM
   * through signal(). The network log gets one entry: 101 when it opened, then the messages and bytes both ways, and how it ended.
   */
  openWebSocket({ url, headers = [], protocols = [] }) {
    const mapped = this.redirectFor(url), target = new URL(mapped?.url ?? url); target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    const Socket = this.policy.WebSocket ?? globalThis.WebSocket;
    const entry = this.log?.begin({ method: 'GET', url, headers, body: null }, { api: 'WebSocket', mapped }) ?? null, record = { head: null, error: null, ended: false, closed: false, received: 0 };
    this.stats.requests++; this.noteHost(new URL(url).hostname);
    if (mapped) { const counted = noteRedirect(this.runtime, this.redirects, mapped, { method: 'GET', url }); counted.responses++; }   // counted as a response of its rule (a WebSocket has no HTTP response the rule could settle later)
    const session = openWebSocketSession({ url: target.href, protocols, create: Socket ? (u, p) => new Socket(u, p) : () => { throw new Error('this realm has no WebSocket'); }, signal: () => this.signal(),
      onLog: (what, code) => {
        if (what === 'open') record.head = { status: 101, reason: 'Switching Protocols', headers: [['upgrade', 'websocket'], ['connection', 'Upgrade']] };
        if (what === 'closed') { record.received = session.bytesIn; if (session.error) record.error = session.error; else record.ended = true; }
        this.log?.observe(entry, record);
      } });
    if (session.error) { record.error = session.error; this.log?.observe(entry, record); }
    session.logEntry = entry; session.record = record; return session;
  }
  /**
   * A TCP stream through the APK Lab Relay (src/tcp-tunnel.js) for a socket whose conversation is not HTTP/1.1, or null when no relay is configured (the socket then fails
   * explicitly, as without this). "Redirecionar hosts" rules apply to host:port. Like a WebSocket it is not a pending request; the network log has one CONNECT entry.
   */
  openTunnel({ host, port, tls = false, alpn = [] }) {
    const endpoint = tunnelEndpoint(this.policy); if (!endpoint) return null;
    const original = `${tls ? 'https' : 'http'}://${host}:${port}/`, mapped = this.redirectFor(original), target = new URL(mapped?.url ?? original);
    const targetPort = Number(target.port || (target.protocol === 'https:' ? 443 : 80)), Socket = this.policy.WebSocket ?? globalThis.WebSocket;
    const entry = this.log?.begin({ method: 'CONNECT', url: `tcp://${host}:${port}`, headers: [], body: null }, { api: 'Tunnel', mapped }) ?? null, record = { head: null, error: null, ended: false, closed: false, received: 0 };
    this.stats.requests++; this.noteHost(host);
    if (mapped) { const counted = noteRedirect(this.runtime, this.redirects, mapped, { method: 'CONNECT', url: original }); counted.responses++; }
    const dest = tls ? destination(target.hostname, targetPort) : null, held = dest ? this.clientIdentities?.get(dest) : null, identity = held?.identity && held.proxyUrl === (this.policy.proxyUrl ?? '') ? held : null;
    const session = openTunnelSession({ endpoint, host: target.hostname, port: targetPort, tls, alpn, create: Socket ? url => new Socket(url) : () => { throw new Error('this realm has no WebSocket'); },
      ready: identity?.job ?? null, clientIdentityKey: identity?.key ?? null,   // the client certificate this TLS tunnel needs: at the relay first, and handed again if the relay restarted
      reregister: identity ? () => registerClientIdentity({ proxyUrl: identity.proxyUrl, fetch: this.fetchFunction(), dest, identity: identity.identity }).then(() => this.noteClientIdentityRenewed(dest)) : null,
      signal: () => {
        if (session?.connected && !record.head) { record.head = { status: 200, reason: 'Connected (relay tunnel)', headers: session.alpn ? [['alpn', session.alpn]] : [] }; this.log?.observe(entry, record); }
        if (session?.error && !record.error) { record.error = session.error; this.log?.observe(entry, record); }
        if (session?.closed && !record.ended && !record.error) { record.received = session.bytesIn; record.ended = true; this.log?.observe(entry, record); }
        this.signal();
      } });
    if (session.error) { record.error = session.error; this.log?.observe(entry, record); }
    return session;
  }
  /** A request a mock answers: the operation is filled by deliverMock() once the mock's delay has passed on the VM clock; no executor, no fetch. */
  startMock(op, record) {
    const request = op.request, response = record.compiled.response;
    op.executor = 'mock'; this.stats.mocked = (this.stats.mocked ?? 0) + 1;
    op.log = this.log?.begin(request, { api: request.api, mock: { id: record.id, label: record.label } }) ?? null;
    noteMockHit(this.runtime, record, request);
    op.mock = { readyAt: this.platform.clock.now() + response.delayMs, response, delivered: false };
    (this.mockWaiting ??= new Set()).add(op);
    if (!this.deliverMock(op)) this.signal();   // a delay: the scheduler wakes at readyAt (delay())
    return op;
  }
  /** The mock's head, then its body and the end, the way a real exchange fills the operation (HEAD requests get no body, like fetch). True when it was delivered now. */
  deliverMock(op) {
    const state = op.mock;
    if (!state || state.delivered) return false;
    if (op.closed || op.error !== null) { state.delivered = true; this.mockWaiting.delete(op); return false; }
    if (this.platform.clock.now() < state.readyAt) return false;
    state.delivered = true; this.mockWaiting.delete(op);
    const { response } = state, body = op.request.method === 'HEAD' ? null : response.body;
    op.head = { version: 'HTTP/1.1', status: response.status, reason: response.reason, url: op.request.url, headers: response.headers.map(([name, value]) => [name, value]) };
    if (response.status >= 300 && response.status < 400) this.stats.redirectsObserved++;
    if (body?.length) { captureBody(op, body); for (let at = 0; at < body.length; at += CHUNK) { const piece = body.slice(at, at + CHUNK); op.queue.push(piece); op.queued += piece.length; op.received += piece.length; } }
    op.ended = true; this.observe(op); this.activity = true;
    return true;
  }
  /** Moves what a worker exchange has produced into the operation (head, body bytes, end, failure); true if anything changed. */
  refresh(op) { if (op.executor === 'mock') return this.deliverMock(op); if (op.executor !== 'worker' || op.closed) return false; const changed = this.worker.poll(op); this.observe(op); return changed; }

  /**
   * Called when a run loop sits on the JavaScript stack of host code and has nothing runnable: block for real until a worker exchange makes progress (Atomics.wait on the
   * worker's signal word). Returns false when no pending exchange can progress without the event loop (then the scheduler reports it).
   */
  syncWait(scheduler) {
    const waiting = [...this.ops.values()].filter(op => op.executor === 'worker' && !op.ended && op.error === null && !op.closed);
    if (!waiting.length || !this.worker) return false;
    if (waiting.length < this.pending) return false;                 // an in-realm exchange also pending: only the event loop could advance it
    const now = this.platform.clock.now(), earliest = scheduler.wake(), next = Math.min(earliest === Infinity ? 1000 : Math.max(0, earliest - now), 1000);
    const seen = this.worker.mark();                                 // taken BEFORE looking, so progress made while we look makes the wait below return at once
    let progressed = false; for (const op of waiting) progressed = this.refresh(op) || progressed;
    if (!progressed) this.worker.wait(Math.max(1, next), seen);
    for (const op of waiting) this.refresh(op);
    return true;
  }

  /**
   * The app's client identity for a destination (src/tls-socket-host.js clientIdentity, at the handshake of a socket to a configured client-certificate host): handed to the relay once
   * per identity, over its token-protected channel, for that destination only (the "Redirecionar hosts" target when a rule maps it). Without a relay the browser cannot present it:
   * the server sees no client certificate, as it would from a device whose app offered none, and the trace says why.
   */
  useClientIdentity(dest, identity, alias) {
    const mapped = this.redirectFor(`https://${dest}/`), target = mapped ? destinationOfUrl(mapped.url) ?? dest : dest, proxyUrl = this.policy.proxyUrl ?? '', key = identityKey(identity);
    this.clientIdentities ??= new Map(); const current = this.clientIdentities.get(target);
    if (current && current.key === key && current.proxyUrl === proxyUrl) return;   // handed over already (its outcome is in clientIdentityStatus)
    const record = text => this.runtime?.record?.(`NET tls client certificate for ${target}: ${text}`);
    if (!proxyUrl) { this.clientIdentities.set(target, { key, proxyUrl, job: null }); this.noteClientIdentity(target, { state: 'no-relay', alias, detail: 'the browser cannot present a client certificate: set the relay as the Proxy' }); record(`alias "${alias}" (${identity.chain.length} certificate(s)) NOT presented: a browser cannot present a client certificate; set the relay as the Proxy (Controls > Device)`); return; }
    const reset = this.relayReset(proxyUrl);
    this.noteClientIdentity(target, { state: 'pending', alias, detail: 'handing the certificate to the relay' });
    // the key goes only to a relay that said it keeps identities (another proxy would forward the POST to the destination); a relay that did not answer is asked again next time
    const job = reset.job.then(answer => { if (!answer?.supported) { if (this.identityReset === reset) this.identityReset = null; throw new Error(answer?.reason ?? 'the relay did not answer'); } return registerClientIdentity({ proxyUrl, fetch: this.fetchFunction(), dest: target, identity }); })
      .then(() => { this.noteClientIdentity(target, { state: 'presented', alias, detail: `${identity.chain.length} certificate(s) at the relay` }); record(`alias "${alias}" (${identity.chain.length} certificate(s)) handed to the relay, presented in the TLS handshakes to this destination only`); },
        error => { const detail = String(error?.message ?? error).slice(0, 200); this.noteClientIdentity(target, { state: 'failed', alias, detail }); record(`alias "${alias}" NOT presented: ${detail}`); this.clientIdentities.delete(target); });
    this.clientIdentities.set(target, { key, proxyUrl, job, identity });
  }
  /** The session's "forget every identity" request to this relay (once per relay address; again after a relay that did not answer). Its job resolves { supported, reason }. */
  relayReset(proxyUrl) {
    if (this.identityReset?.proxyUrl !== proxyUrl) this.identityReset = { proxyUrl, job: forgetClientIdentities({ proxyUrl, fetch: this.fetchFunction() }) };
    return this.identityReset;
  }
  /** The client identity the relay holds for a request's destination, for openExchange to name (client-identity-key) and hand again if the relay restarted; null when none. */
  clientIdentityFor(url) {
    const mapped = this.redirectFor(url), dest = destinationOfUrl(mapped?.url ?? url), entry = dest ? this.clientIdentities?.get(dest) : null;
    return entry?.identity && entry.proxyUrl && entry.proxyUrl === (this.policy.proxyUrl ?? '') ? { dest, key: entry.key, identity: entry.identity } : null;
  }
  /** The relay had lost the identity (it was restarted) and was handed it again: said in the trace; the page's line stays "presented". */
  noteClientIdentityRenewed(dest) {
    this.runtime?.record?.(`NET tls client certificate for ${dest}: the relay no longer held it (restarted); handed to it again and the request repeated`);
  }
  /** What the page shows under the mTLS field: per destination, the last outcome (presented, failed, no relay, none offered by the app) and how many requests to it went out after the relay had it. */
  noteClientIdentity(dest, { state, alias = null, detail = '' }) {
    this.clientIdentityStatus ??= new Map(); const previous = this.clientIdentityStatus.get(dest);
    // a connection that offers no certificate (another SSLContext of the app, the default one) does not hide that another connection to the same host presented one
    if (state === 'none' && (previous?.state === 'presented' || previous?.state === 'pending' || previous?.state === 'no-relay')) { previous.without = detail; return; }
    this.clientIdentityStatus.set(dest, { dest, state, alias, detail, uses: state === 'presented' && previous?.state === 'presented' ? previous.uses : 0, without: state === 'none' ? null : previous?.without ?? (previous?.state === 'none' ? previous.detail : null) });
  }
  noteClientIdentityUse(dest) { const entry = this.clientIdentityStatus?.get(dest); if (entry?.state === 'presented') entry.uses++; }
  /** -> [{ dest, state, alias, detail, uses }] for vmHealth. */
  clientIdentitySummary() { return this.clientIdentityStatus ? [...this.clientIdentityStatus.values()].map(entry => ({ ...entry })) : []; }
  /** Only the registration of this destination's own client identity (the synchronous bridge blocks the thread: it must not wait for the session's relay reset, a browser-loop promise). */
  clientIdentityJob(url) { const mapped = this.redirectFor(url), dest = destinationOfUrl(mapped?.url ?? url); return dest ? this.clientIdentities?.get(dest)?.job ?? null : null; }
  /** The registration of the client identity a request's destination waits for, or null. */
  clientIdentityReady(url) {
    // the first request of a session through a relay first clears the identities a previous session handed over (a relay that is not the lab's ignores the request: errors are dropped)
    const proxyUrl = this.policy.proxyUrl ?? ''; if (proxyUrl) this.relayReset(proxyUrl);
    const mapped = this.redirectFor(url), dest = destinationOfUrl(mapped?.url ?? url), own = dest ? this.clientIdentities?.get(dest)?.job ?? null : null, reset = proxyUrl ? this.identityReset.job : null;
    return own && reset ? Promise.all([reset, own]) : own ?? reset;
  }

  async run(op) {
    const { request } = op, policy = this.policy;
    const identity = this.clientIdentityReady(request.url); if (identity) await identity;   // the relay has the client identity before the request that needs it
    { const dest = destinationOfUrl(this.redirectFor(request.url)?.url ?? request.url); if (dest && this.clientIdentities?.get(dest)?.job) this.noteClientIdentityUse(dest); }
    const { head, reader } = await openExchange(request, { fetch: this.fetchFunction(), proxyUrl: policy.proxyUrl, redirect: policy.redirect ?? 'auto', hostMap: policy.hostMap ?? [], signal: op.abortController?.signal, dropped: this.droppedRequestHeaders, clientIdentity: this.clientIdentityFor(request.url), mux: this.relayChannel() });
    if (head.clientIdentityRenewed) { delete head.clientIdentityRenewed; this.noteClientIdentityRenewed(destinationOfUrl(this.redirectFor(request.url)?.url ?? request.url)); }
    if (head.relayChannel) { this.noteChannelOf(op, head); delete head.relayChannel; delete head.relayChannelNote; }
    if (op.closed || op.error !== null) { try { await reader?.cancel(); } catch { /* ignored */ } return; }
    if (head.status >= 300 && head.status < 400) this.stats.redirectsObserved++;
    op.head = head; op.trace?.arrived('head'); this.observe(op); this.signal();
    if (!reader) { op.ended = true; op.trace?.arrived('end'); return; }
    op.reader = reader;
    for (;;) {
      if (op.closed || op.error !== null) { try { await op.reader.cancel(); } catch { /* ignored */ } return; }
      if (op.queued >= HIGH_WATER) { await new Promise(resolve => { op.resume = resolve; }); continue; }
      let step;
      try { step = await op.reader.read(); } catch (error) { if (op.closed) return; op.error = describeFailure(error, request, request.timedOut); this.stats.failures++; return; }
      if (step.done) { op.ended = true; op.trace?.arrived('end'); return; }
      const bytes = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value);
      for (let at = 0; at < bytes.length; at += CHUNK) { const piece = bytes.subarray(at, at + CHUNK); op.queue.push(piece); op.queued += piece.length; }
      captureBody(op, bytes); this.stats.bytesIn += bytes.length; op.received += bytes.length; op.trace?.arrived('piece', bytes.length); this.observe(op);
      this.signal();
    }
  }

  take(op, target, offset, length) {
    let copied = 0;
    while (copied < length && op.queue.length) {
      const piece = op.queue[0], n = Math.min(piece.length, length - copied);
      for (let i = 0; i < n; i++) target[offset + copied + i] = (piece[i] << 24) >> 24;
      copied += n; op.queued -= n;
      if (n === piece.length) op.queue.shift(); else op.queue[0] = piece.subarray(n);
    }
    if (copied && op.resume) { const resume = op.resume; op.resume = null; resume(); }
    return copied;
  }
  /** Hands out up to `limit` bytes of the received response body as pieces (the virtual HTTP socket serializes them itself), and wakes a reader paused by the high-water mark. */
  drain(op, limit) {
    const pieces = []; let taken = 0;
    while (op.queue.length && taken < limit) { const piece = op.queue.shift(); pieces.push(piece); taken += piece.length; op.queued -= piece.length; }
    if (pieces.length && op.resume) { const resume = op.resume; op.resume = null; resume(); }
    return pieces;
  }
  discard(op) { op.closed = true; this.observe(op); op.abort(); this.ops.delete(op.handle); this.mockWaiting?.delete(op); op.resume?.(); if (op.trace && !op.trace.socket) this.trace.finish(op.trace); }
}

/** The parsed res/xml network security config of the app (cached per manifest), or null when the manifest names none. A config that cannot be read fails explicitly. */
function networkSecurityConfigOf(runtime, defaultCleartext) {
  const application = runtime.platform.manifest?.application, id = application?.networkSecurityConfig;
  if (!id) return null;
  const cache = runtime.networkSecurityConfig ??= { id: null, config: null };
  if (cache.id === id && cache.defaultCleartext === defaultCleartext) return cache.config;
  const table = runtime.resources?.table, entry = table?.resolve(id);
  if (!entry || entry.kind !== 'string' || typeof entry.value !== 'string') throw new APKError(`android:networkSecurityConfig 0x${Number(id).toString(16)} does not name an XML file in the package`, { kind: BOUNDARY });
  const config = parseNetworkSecurityConfig(table.parseLayout(runtime.apkReader(entry.value)), defaultCleartext);
  Object.assign(cache, { id, defaultCleartext, config }); return config;
}
export const networkOf = runtime => runtime.network ??= new NetworkBridge(runtime);
/** The size in bytes of an exchange's answer: its declared Content-Length, else what has arrived (the scheduler's I/O boost serves the smallest first). */
const answerSize = op => { const declared = Number(op.head?.headers?.find?.(([name]) => String(name).toLowerCase() === 'content-length')?.[1]); return Math.max(Number.isFinite(declared) ? declared : 0, op.received ?? 0); };

function javaFailure(runtime, failure) { throwNew(runtime, failure.type, failure.message); }
const refArray = (runtime, type, values) => { const array = runtime.newArray(type, values.length); runtime.object(array).elements = values; return array; };
const stringArray = (runtime, values) => refArray(runtime, '[Ljava/lang/String;', values);

/** Constructs a Java object through a constructor (wide arguments packed the way bytecode passes them). */
function construct(runtime, owner, parameters, args) {
  const reference = runtime.allocate(owner);
  runtime.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, runtime.argumentWords(parameters, args, { receiver: reference }), 'direct');
  return reference;
}
function callStatic(runtime, owner, name, parameters, result, args) {
  return runtime.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, runtime.argumentWords(parameters, args, {}), 'static');
}
function inetAddress(runtime, host, bytes) {
  const array = runtime.newArray('[B', bytes.length); runtime.object(array).elements = bytes.map(v => (v << 24) >> 24);
  return callStatic(runtime, INET, 'getByAddress', [STRING, '[B'], INET, [host, array]);
}
const parseV4 = text => { const parts = text.split('.').map(Number); return parts.length === 4 && parts.every(n => n >= 0 && n < 256) ? parts : null; };
function parseV6(text) {
  let host = text.replace(/^\[|\]$/g, '').split('%')[0];
  const dot = host.lastIndexOf('.'); if (dot >= 0) { const v4 = parseV4(host.slice(host.lastIndexOf(':') + 1)); if (!v4) return null; host = host.slice(0, host.lastIndexOf(':') + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16); }
  const halves = host.split('::'); if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [], tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const groups = [...head, ...Array(halves.length === 2 ? 8 - head.length - tail.length : 0).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.flatMap(g => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255]);
}
/** Documented stand-in for DNS: an allowed host name resolves to a stable address in 198.18.0.0/15 (RFC 2544 benchmarking space, never routable). The browser resolves
 * the real name when it fetches; TCP is never opened, so the address is only an identity (a Socket that connects to it is mapped back to the name: NetworkBridge.resolvedName). */
export function syntheticAddress(host) {
  let hash = 0x811c9dc5; for (const ch of String(host).toLowerCase()) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return [198, 18 + ((hash >>> 16) & 1), (hash >>> 8) & 255, (hash & 255) || 1];
}

export function createNetworkNativeBindings() {
  const bindings = new Map(), add = (owner, signature, callback) => bindings.set(`${owner}->${signature}`, callback);
  const text = (runtime, value) => runtime.stringCharacters(value);
  const opOf = (runtime, handle) => { const op = networkOf(runtime).ops.get(handle); if (!op) throwNew(runtime, 'Ljava/net/SocketException;', 'Socket closed'); return op; };
  const timeoutAt = (runtime, ms) => ms > 0 ? runtime.platform.clock.now() + ms : Infinity;

  // ---- jar:file:<base.apk>!/<entry> URLs (the class loader's names for APK resources): the entry's bytes from the installed package
  add('Ldev/apkweb/net/ApkEntries;', 'open(Ljava/lang/String;Ljava/lang/String;)Ljava/io/InputStream;', (runtime, [archive, entry]) => {
    const path = text(runtime, archive), name = text(runtime, entry);
    if (!runtime.apkCodePath(path) || !runtime.apkEntries.has(name)) throwNew(runtime, 'Ljava/io/FileNotFoundException;', `JAR entry ${name} not found in ${path}`);
    return runtime.platform.javaIo.apkResourceStream(runtime, name);
  });

  // ---- libcore.io.Linux.gai_strerror: bionic's messages for the getaddrinfo error codes
  const GAI_MESSAGES = { [C.EAI_AGAIN]: 'Temporary failure in name resolution', [C.EAI_BADFLAGS]: 'Invalid value for ai_flags', [C.EAI_FAIL]: 'Non-recoverable failure in name resolution', [C.EAI_FAMILY]: 'ai_family not supported', [C.EAI_MEMORY]: 'Memory allocation failure', [C.EAI_NODATA]: 'No address associated with hostname', [C.EAI_NONAME]: 'Name or service not known', [C.EAI_SERVICE]: 'Servname not supported for ai_socktype', [C.EAI_SOCKTYPE]: 'ai_socktype not supported', [C.EAI_SYSTEM]: 'System error', [C.EAI_OVERFLOW]: 'Argument buffer overflow' };
  add(LINUX, `gai_strerror(I)${STRING}`, (runtime, [, code]) => GAI_MESSAGES[code] ?? 'Unknown error');

  // ---- libcore.io.Linux.android_getaddrinfo: the device's resolver
  add(LINUX, `android_getaddrinfo(${STRING}Landroid/system/StructAddrinfo;I)[${INET}`, (runtime, [, node, hints]) => {
    const net = networkOf(runtime), host = text(runtime, node);
    const flags = hints ? Number(runtime.object(hints).fields.get('Landroid/system/StructAddrinfo;->ai_flags:I') ?? 0) : 0;
    const gai = (name, code, cause = null) => { const reference = cause ? construct(runtime, GAI, [STRING, 'I', 'Ljava/lang/Throwable;'], [name, code, cause]) : construct(runtime, GAI, [STRING, 'I'], [name, code]); runtime.throwJavaReference(reference, name); };
    if (!runtime.platform.holdsPermission?.(runtime, 'android.permission.INTERNET')) {
      // bionic's getaddrinfo fails with EACCES when the process lacks INTERNET (netd refuses the socket); libcore turns that into the SecurityException below.
      const errno = construct(runtime, ERRNO, [STRING, 'I'], ['android_getaddrinfo', C.EACCES]);
      gai('android_getaddrinfo', C.EAI_NODATA, errno);
    }
    net.noteHost(host);
    if ((flags & C.AI_NUMERICHOST) && !isIpLiteral(host)) gai('android_getaddrinfo', C.EAI_NONAME);   // libcore's parseNumericAddress: only literals qualify, no lookup
    if (isIpLiteral(host)) {
      const bytes = host.includes(':') ? parseV6(host) : parseV4(host);
      if (!bytes) gai('android_getaddrinfo', C.EAI_NONAME);
      return refArray(runtime, '[' + INET, [inetAddress(runtime, null, bytes)]);   // libcore leaves the host name unset here; Inet6AddressImpl names the results of a name lookup itself
    }
    if (!loopbackHost(host) && !net.allowed(host) && !net.mockServesHost(host) && !net.redirectServesHost(host)) { net.stats.denied++; if (!net.online) net.stats.offlineRejections++; net.logRefusal({ api: 'DNS', kind: 'dns', method: 'LOOKUP', url: `dns://${host}`, host }); gai('android_getaddrinfo', C.EAI_NODATA); }
    const bytes = loopbackHost(host) ? [127, 0, 0, 1] : syntheticAddress(host); net.rememberResolved(bytes.join('.'), host);
    const addresses = [inetAddress(runtime, null, bytes)];
    return refArray(runtime, '[' + INET, addresses);
  });

  // ---- NetBridge
  add(NET, 'reserve()I', runtime => { const net = networkOf(runtime), op = new Operation(net.nextHandle++, null); net.ops.set(op.handle, op); return op.handle; });
  add(NET, `open(I${STRING}${STRING}[${STRING}[BIII)I`, (runtime, [ticket, method, urlText, headerArray, bodyArray, redirect, connectTimeout, readTimeout]) => {
    const namedHeaders = () => { const list = runtime.object(headerArray).elements, out = []; for (let i = 0; i + 1 < list.length; i += 2) out.push([text(runtime, list[i]), text(runtime, list[i + 1])]); return out; };
    const net = networkOf(runtime), url = text(runtime, urlText), parsed = new URL(url), port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    net.noteHost(parsed.hostname);
    const shown = isIpLiteral(parsed.hostname) ? `/${parsed.hostname.replace(/^\[|\]$/g, '')}` : `${parsed.hostname}/${(loopbackHost(parsed.hostname) ? [127, 0, 0, 1] : syntheticAddress(parsed.hostname)).join('.')}`;
    const names = runtime.object(headerArray).elements, headers = [];
    for (let i = 0; i + 1 < names.length; i += 2) headers.push([text(runtime, names[i]), text(runtime, names[i + 1])]);
    const body = (bodyArray === null || bodyArray === 0) ? null : Uint8Array.from(runtime.object(bodyArray).elements, v => v & 255);
    const mock = net.matchMock({ method: text(runtime, method), url, body });   // "Mock de endpoints": answered by the lab, before the policy
    const refuse = () => { net.stats.denied++; if (!net.online) net.stats.offlineRejections++; net.logRefusal({ method: text(runtime, method), url, host: parsed.hostname, port, headers: namedHeaders(), bytes: bodyArray ? runtime.object(bodyArray).elements.length : 0 }); throwNew(runtime, 'Ljava/net/ConnectException;', `failed to connect to ${shown} (port ${port}) from /:: (port 0)${connectTimeout > 0 ? ` after ${connectTimeout}ms` : ''}: connect failed: ENETUNREACH (Network is unreachable)`); };
    if (!mock && !net.permits(url, parsed.hostname, port)) refuse();   // a request a "Redirecionar hosts" rule maps goes where the rule says, whatever the allow list
    const reserved = net.ops.get(ticket);
    if (!reserved || reserved.closed) throwNew(runtime, 'Ljava/net/SocketException;', 'Socket closed');
    const op = net.start({ method: text(runtime, method), url, headers, body, redirect, connectTimeout, readTimeout, mock }, reserved);
    const budget = connectTimeout > 0 && readTimeout > 0 ? connectTimeout + readTimeout : connectTimeout > 0 ? connectTimeout : readTimeout;
    op.trace?.park();
    return new Blocked({
      ready: () => { net.refresh(op); const ready = op.head !== null || op.error !== null || op.closed; if (ready) op.trace?.ready(); return ready; }, deadline: timeoutAt(runtime, budget), reason: `network: ${method} ${parsed.hostname}`, interruptible: false, io: () => answerSize(op),
      finish: timedOut => {
        if (op.trace) { op.trace.resume(); op.trace.headTaken ||= performance.now(); }
        if (op.closed) throwNew(runtime, 'Ljava/net/SocketException;', 'Socket closed');
        if (op.error) { net.discard(op); javaFailure(runtime, op.error); }
        if (timedOut && op.head === null) {
          op.request.timedOut = true; net.discard(op);
          throwNew(runtime, 'Ljava/net/SocketTimeoutException;', connectTimeout > 0 && readTimeout <= 0 ? `failed to connect to ${parsed.hostname} (port ${port}) after ${connectTimeout}ms` : 'timeout');
        }
        return op.handle;
      },
    });
  });
  add(NET, `head(I)[${STRING}`, (runtime, [handle]) => {
    const op = opOf(runtime, handle), head = op.head; if (!head) throwNew(runtime, 'Ljava/lang/IllegalStateException;', 'response head not available');
    return stringArray(runtime, [head.version, String(head.status), head.reason, head.url, ...head.headers.flat()]);
  });
  add(NET, 'read(I[BIII)I', (runtime, [handle, buffer, offset, length, readTimeout]) => {
    const net = networkOf(runtime), op = opOf(runtime, handle), target = runtime.object(buffer).elements;
    if (offset < 0 || length < 0 || offset > target.length - length) runtime.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=${target.length}; regionStart=${offset}; regionLength=${length}`);
    const attempt = () => {
      net.refresh(op);
      if (op.closed) throwNew(runtime, 'Ljava/net/SocketException;', 'Socket closed');
      if (op.queue.length) { const taken = net.take(op, target, offset, length); if (op.trace && op.ended && !op.queue.length) op.trace.bodyTaken ||= performance.now(); return taken; }
      if (op.error) { const failure = op.error; net.discard(op); javaFailure(runtime, failure); }
      if (op.ended) { if (op.trace) op.trace.bodyTaken ||= performance.now(); return -1; }
      return null;
    };
    op.trace?.read();
    const now = attempt(); if (now !== null) return now;
    op.trace?.park();
    return new Blocked({
      ready: () => { net.refresh(op); const ready = op.queue.length > 0 || op.ended || op.error !== null || op.closed; if (ready) op.trace?.ready(); return ready; }, deadline: timeoutAt(runtime, readTimeout), reason: `network read: ${op.request.method}`, interruptible: false, roots: [buffer], io: () => answerSize(op),
      finish: timedOut => { op.trace?.resume(); const value = attempt(); if (value !== null) return value; if (timedOut) throwNew(runtime, 'Ljava/net/SocketTimeoutException;', 'timeout'); throw new APKError('network read woke without data', { kind: BOUNDARY }); },
    });
  });
  add(NET, `cleartextPermitted(${STRING})Z`, (runtime, [host]) => cleartextPermitted(runtime, text(runtime, host)) ? 1 : 0);
  add(NET, 'available(I)I', (runtime, [handle]) => opOf(runtime, handle).queued);
  add(NET, 'close(I)V', (runtime, [handle]) => { const net = networkOf(runtime), op = net.ops.get(handle); if (op) { net.discard(op); net.signal(); } });
  return bindings;
}

/** NetworkSecurityPolicy.isCleartextTrafficPermitted([host]): a network_security_config (base-config / domain-config) wins; otherwise android:usesCleartextTraffic; otherwise cleartext is allowed only for
 * apps targeting API 27 and lower. The decision is keyed off the APK's targetSdkVersion like ApplicationInfo.targetSdkVersion in the framework. Without a host it answers for the base configuration. */
export function cleartextPermitted(runtime, host = null) {
  const manifest = runtime.platform.manifest ?? {}, target = Number(manifest.usesSdk?.targetSdkVersion ?? manifest.usesSdk?.minSdkVersion ?? 1), declared = manifest.application?.usesCleartextTraffic;
  const byAttribute = declared !== undefined && declared !== null ? !(declared === false || declared === 'false' || Number(declared) === 0) : target < 28;
  const config = networkSecurityConfigOf(runtime, byAttribute);
  return config ? (host === null ? config.base : cleartextPermittedFor(config, host)) : byAttribute;
}
