import { APKError } from './apk-error.js?v=0c9f1b0d2456';
import { throwNew } from './java-throw.js?v=0c9f1b0d2456';
import { Blocked } from './scheduler.js?v=0c9f1b0d2456';
import { OS_CONSTANTS } from './os-constants-data.js?v=0c9f1b0d2456';
import { openExchange, describeFailure } from './network-transport.js?v=0c9f1b0d2456';
import { WorkerExecutor } from './network-worker-executor.js?v=0c9f1b0d2456';
import { parseNetworkSecurityConfig, cleartextPermittedFor } from './network-security-config.js?v=0c9f1b0d2456';

// The web device's network: the boundary between the original java.net classes in framework.dex and the browser's fetch.
//
//  * Name resolution is libcore.io.Linux.android_getaddrinfo (bound here): the device network policy answers it, so the original InetAddress, URL and HttpURLConnection
//    code sees the same failures an Android device gives (UnknownHostException "Unable to resolve host", SecurityException without INTERNET, ConnectException ENETUNREACH).
//  * HTTP exchanges are dev.apkweb.net.NetBridge natives. A call that has to wait parks the calling Java thread in the scheduler (Blocked) while an asynchronous fetch
//    runs; no SharedArrayBuffer and no cross-origin isolation are needed. A frame that cannot suspend (a nested host run) is reported explicitly by the scheduler.
//  * Policy: offline device => every lookup fails and every connect is ENETUNREACH; otherwise only hosts in the allowlist (platform.networkPolicy.allowedHosts) are
//    reachable. The default allowlist is empty, i.e. the device is effectively offline. Raw sockets are never opened.
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
    this.abortController = typeof AbortController === 'function' ? new AbortController() : null; this.reader = null; this.resume = null; this.consumed = 0; this.executor = 'main'; this.shared = null;
  }
  abort() { try { this.abortController?.abort(); } catch { /* already finished */ } try { this.reader?.cancel()?.catch?.(() => {}); } catch { /* ignored */ } this.onAbort?.(); }
}

export class NetworkBridge {
  constructor(runtime) {
    this.runtime = runtime; this.ops = new Map(); this.nextHandle = 1; this.activity = false; this.waiters = new Set();
    this.stats = { requests: 0, denied: 0, offlineRejections: 0, bytesIn: 0, bytesOut: 0, failures: 0, hosts: new Set(), redirectsObserved: 0 };
    this.droppedRequestHeaders = new Set();
    runtime.platform.addExternalSource?.({ delay: () => this.delay(), drained: () => this.drained(), pending: () => this.pending });
  }
  get platform() { return this.runtime.platform; }
  /** The effective policy: an explicit platform.networkPolicy (probes and tests) or the one in the device settings (Dispositivo panel, player config). */
  get policy() {
    if (this.platform.networkPolicy) return this.platform.networkPolicy;
    const network = this.platform.device?.network;
    if (this.derived?.source !== network) this.derived = { source: network, value: { allowedHosts: network?.allowedHosts ?? [], proxyUrl: network?.proxyUrl ?? '', fetch: null, redirect: 'auto' } };
    return this.derived.value;
  }
  get online() { return (this.platform.device?.connectivity ?? 'online') !== 'offline'; }
  get pending() { let n = 0; for (const op of this.ops.values()) if (!op.ended && op.error === null && !op.closed) n++; return n; }

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
  noteHost(host) { this.stats.hosts.add(String(host).toLowerCase()); }

  /** Called when the page changes the device connectivity: exchanges in flight fail like a dropped link. */
  connectivityChanged() {
    if (this.online) return;
    for (const op of this.ops.values()) if (!op.ended && op.error === null) { op.error = { type: 'Ljava/net/SocketException;', message: 'Software caused connection abort' }; op.abort(); }
    this.signal();
  }
  signal() { this.activity = true; this.platform.onExternalActivity?.(); for (const resolve of [...this.waiters]) resolve(); }
  /** Resolves on the next network activity (tests and drivers that pump the VM themselves). */
  whenActivity(timeoutMs = 2000) { return new Promise(resolve => { const done = () => { clearTimeout(timer); this.waiters.delete(done); resolve(); }; const timer = setTimeout(done, timeoutMs); this.waiters.add(done); }); }
  /** Delay (ms) until the VM has something to do because of the network: 0 when an exchange made progress since the last drain. */
  delay() { return this.activity ? 0 : null; }
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
  start(request, reserved = null) {
    const op = reserved ?? new Operation(this.nextHandle++, request); op.request = request; this.ops.set(op.handle, op);
    this.stats.requests++; this.noteHost(new URL(request.url).hostname); this.stats.bytesOut += request.body?.length ?? 0;
    op.executor = this.executorFor();
    if (op.executor === 'worker') { try { (this.worker ??= new WorkerExecutor(this)).start(op, request, { proxyUrl: this.policy.proxyUrl, redirect: this.policy.redirect ?? 'auto' }); } catch (error) { op.error = describeFailure(error, request); this.stats.failures++; this.signal(); } }
    else this.run(op).catch(error => { op.error ??= describeFailure(error, request, request.timedOut); this.stats.failures++; }).finally(() => this.signal());
    return op;
  }
  /** Moves what a worker exchange has produced into the operation (head, body bytes, end, failure); true if anything changed. */
  refresh(op) { return op.executor === 'worker' && !op.closed ? this.worker.poll(op) : false; }

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
    const { head, reader } = await openExchange(request, { fetch: this.fetchFunction(), proxyUrl: policy.proxyUrl, redirect: policy.redirect ?? 'auto', signal: op.abortController?.signal, dropped: this.droppedRequestHeaders });
    if (op.closed || op.error !== null) { try { await reader?.cancel(); } catch { /* ignored */ } return; }
    if (head.status >= 300 && head.status < 400) this.stats.redirectsObserved++;
    op.head = head; this.signal();
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
      this.stats.bytesIn += bytes.length;
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
  discard(op) { op.closed = true; op.abort(); this.ops.delete(op.handle); op.resume?.(); }
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
 * the real name when it fetches; raw sockets are never opened, so the address is only an identity. */
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
    if (!net.allowed(host)) { net.stats.denied++; if (!net.online) net.stats.offlineRejections++; gai('android_getaddrinfo', C.EAI_NODATA); }
    const addresses = loopbackHost(host) ? [inetAddress(runtime, null, [127, 0, 0, 1])] : [inetAddress(runtime, null, syntheticAddress(host))];
    return refArray(runtime, '[' + INET, addresses);
  });

  // ---- NetBridge
  add(NET, 'reserve()I', runtime => { const net = networkOf(runtime), op = new Operation(net.nextHandle++, null); net.ops.set(op.handle, op); return op.handle; });
  add(NET, `open(I${STRING}${STRING}[${STRING}[BIII)I`, (runtime, [ticket, method, urlText, headerArray, bodyArray, redirect, connectTimeout, readTimeout]) => {
    const net = networkOf(runtime), url = text(runtime, urlText), parsed = new URL(url), port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    net.noteHost(parsed.hostname);
    const shown = isIpLiteral(parsed.hostname) ? `/${parsed.hostname.replace(/^\[|\]$/g, '')}` : `${parsed.hostname}/${syntheticAddress(parsed.hostname).join('.')}`;
    const refuse = () => { net.stats.denied++; if (!net.online) net.stats.offlineRejections++; throwNew(runtime, 'Ljava/net/ConnectException;', `failed to connect to ${shown} (port ${port}) from /:: (port 0)${connectTimeout > 0 ? ` after ${connectTimeout}ms` : ''}: connect failed: ENETUNREACH (Network is unreachable)`); };
    if (!net.online || !(net.allowed(parsed.hostname, port))) refuse();
    const names = runtime.object(headerArray).elements, headers = [];
    for (let i = 0; i + 1 < names.length; i += 2) headers.push([text(runtime, names[i]), text(runtime, names[i + 1])]);
    const body = (bodyArray === null || bodyArray === 0) ? null : Uint8Array.from(runtime.object(bodyArray).elements, v => v & 255);
    const reserved = net.ops.get(ticket);
    if (!reserved || reserved.closed) throwNew(runtime, 'Ljava/net/SocketException;', 'Socket closed');
    const op = net.start({ method: text(runtime, method), url, headers, body, redirect, connectTimeout, readTimeout }, reserved);
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
  add(NET, `cleartextPermitted(${STRING})Z`, (runtime, [host]) => {
    // NetworkSecurityPolicy: a network_security_config (base-config / domain-config) wins; otherwise android:usesCleartextTraffic; otherwise cleartext is allowed only for
    // apps targeting API 27 and lower. The decision is keyed off the APK's targetSdkVersion like ApplicationInfo.targetSdkVersion in the framework.
    const manifest = runtime.platform.manifest ?? {}, target = Number(manifest.usesSdk?.targetSdkVersion ?? manifest.usesSdk?.minSdkVersion ?? 1), declared = manifest.application?.usesCleartextTraffic;
    const byAttribute = declared !== undefined && declared !== null ? !(declared === false || declared === 'false' || Number(declared) === 0) : target < 28;
    const config = networkSecurityConfigOf(runtime, byAttribute);
    return (config ? cleartextPermittedFor(config, text(runtime, host)) : byAttribute) ? 1 : 0;
  });
  add(NET, 'available(I)I', (runtime, [handle]) => opOf(runtime, handle).queued);
  add(NET, 'close(I)V', (runtime, [handle]) => { const net = networkOf(runtime), op = net.ops.get(handle); if (op) { net.discard(op); net.signal(); } });
  return bindings;
}
