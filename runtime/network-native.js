import { APKError } from './apk-error.js?v=59e9e77ad3a2';
import { throwNew } from './java-throw.js?v=59e9e77ad3a2';
import { mapUrl, hostMapServesHost, noteRedirect } from './host-map.js?v=59e9e77ad3a2';
import { matchEndpointMock, mockServesHost, noteMockHit } from './endpoint-mocks.js?v=59e9e77ad3a2';
import { Blocked } from './scheduler.js?v=59e9e77ad3a2';
import { captureBody } from './network-capture.js?v=59e9e77ad3a2';
import { OS_CONSTANTS } from './os-constants-data.js?v=59e9e77ad3a2';
import { openExchange, describeFailure } from './network-transport.js?v=59e9e77ad3a2';
import { WorkerExecutor } from './network-worker-executor.js?v=59e9e77ad3a2';
import { parseNetworkSecurityConfig, cleartextPermittedFor } from './network-security-config.js?v=59e9e77ad3a2';
import { TransportAuthority } from './transport-ca.js?v=59e9e77ad3a2';


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

/** True for "a.b.c.d" and for IPv6 literals. */
export const isIpLiteral = host => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || (host.includes(':') && /^[0-9a-f:.]+$/i.test(host));
const loopbackHost = host => host === 'localhost' || /^127\.\d+\.\d+\.\d+$/.test(host) || host === '::1';

/** One HTTP exchange. */
class Operation {
  constructor(handle, request) {
    this.handle = handle; this.request = request; this.head = null; this.queue = []; this.queued = 0; this.ended = false; this.error = null; this.closed = false;
    this.abortController = typeof AbortController === 'function' ? new AbortController() : null; this.reader = null; this.resume = null; this.consumed = 0; this.executor = 'main'; this.shared = null; this.received = 0; this.log = null;
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
    if (this.derived?.source !== network) this.derived = { source: network, value: { allowedHosts: network?.allowedHosts ?? [], proxyUrl: network?.proxyUrl ?? '', hostMap: network?.hostMap ?? [], fetch: null, redirect: 'auto' } };
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
  get pending() { let n = this.jobs ?? 0; for (const op of this.ops.values()) if (op.executor !== 'mock' && !op.ended && op.error === null && !op.closed) n++; return n; }   // a mocked answer is a timer on the VM clock (delay()), not I/O
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
    this.stats.requests++; this.noteHost(new URL(request.url).hostname);
    const mock = request.mock !== undefined ? request.mock : this.matchMock(request);
    if (this.requestObserver) this.requestObserver(request, mock);   // a background render lists the requests made while it runs (src/render-variant.js)
    if (mock) return this.startMock(op, mock);
    this.stats.bytesOut += request.body?.length ?? 0;
    op.executor = this.executorFor(); const mapped = this.redirectFor(request.url); op.log = this.log?.begin(request, { api: request.api, mapped }) ?? null;
    if (mapped) { op.redirect = { record: noteRedirect(this.runtime, this.redirects, mapped, request), settled: false }; this.stats.redirected = (this.stats.redirected ?? 0) + 1; }
    if (op.executor === 'worker') { try { (this.worker ??= new WorkerExecutor(this)).start(op, request, { proxyUrl: this.policy.proxyUrl, redirect: this.policy.redirect ?? 'auto', hostMap: this.policy.hostMap ?? [] }); } catch (error) { op.error = describeFailure(error, request); this.stats.failures++; this.observe(op); this.signal(); } }
    else this.run(op).catch(error => { op.error ??= describeFailure(error, request, request.timedOut); this.stats.failures++; }).finally(() => { this.observe(op); this.signal(); });
    return op;
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

  async run(op) {
    const { request } = op, policy = this.policy;
    const { head, reader } = await openExchange(request, { fetch: this.fetchFunction(), proxyUrl: policy.proxyUrl, redirect: policy.redirect ?? 'auto', hostMap: policy.hostMap ?? [], signal: op.abortController?.signal, dropped: this.droppedRequestHeaders });
    if (op.closed || op.error !== null) { try { await reader?.cancel(); } catch { /* ignored */ } return; }
    if (head.status >= 300 && head.status < 400) this.stats.redirectsObserved++;
    op.head = head; this.observe(op); this.signal();
    if (!reader) { op.ended = true; return; }
    op.reader = reader;
    for (;;) {
      if (op.closed || op.error !== null) { try { await op.reader.cancel(); } catch { /* ignored */ } return; }
      if (op.queued >= HIGH_WATER) { await new Promise(resolve => { op.resume = resolve; }); continue; }
      let step;
      try { step = await op.reader.read(); } catch (error) { if (op.closed) return; op.error = describeFailure(error, request, request.timedOut); this.stats.failures++; return; }
      if (step.done) { op.ended = true; return; }
      const bytes = step.value instanceof Uint8Array ? step.value : new Uint8Array(step.value);
      for (let at = 0; at < bytes.length; at += CHUNK) { const piece = bytes.subarray(at, at + CHUNK); op.queue.push(piece); op.queued += piece.length; }
      captureBody(op, bytes); this.stats.bytesIn += bytes.length; op.received += bytes.length; this.observe(op);
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
  discard(op) { op.closed = true; this.observe(op); op.abort(); this.ops.delete(op.handle); this.mockWaiting?.delete(op); op.resume?.(); }
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
    return new Blocked({
      ready: () => { net.refresh(op); return op.head !== null || op.error !== null || op.closed; }, deadline: timeoutAt(runtime, budget), reason: `network: ${method} ${parsed.hostname}`, interruptible: false,
      finish: timedOut => {
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
      if (op.queue.length) return net.take(op, target, offset, length);
      if (op.error) { const failure = op.error; net.discard(op); javaFailure(runtime, failure); }
      if (op.ended) return -1;
      return null;
    };
    const now = attempt(); if (now !== null) return now;
    return new Blocked({
      ready: () => { net.refresh(op); return op.queue.length > 0 || op.ended || op.error !== null || op.closed; }, deadline: timeoutAt(runtime, readTimeout), reason: `network read: ${op.request.method}`, interruptible: false, roots: [buffer],
      finish: timedOut => { const value = attempt(); if (value !== null) return value; if (timedOut) throwNew(runtime, 'Ljava/net/SocketTimeoutException;', 'timeout'); throw new APKError('network read woke without data', { kind: BOUNDARY }); },
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
