// The app's network requests, as the lab page shows and saves them. The network layer (src/network-native.js and the callers that refuse a host) reports every HTTP exchange,
// name lookup and raw connect attempt here; this module keeps the latest entries in the Worker and posts them to the page in batches. It runs in the Worker: no DOM, no process.*.
// Bodies are never logged, only their sizes. Header values are kept as the app sent them (the user is debugging their own app) and live in memory only: nothing is persisted.
//
// Entry (one exchange / lookup / connect attempt; it is created when the request starts and updated in place until it ends):
//   { seq, uptime (VM ms), wall (epoch ms), tid, thread, api ('java.net' | 'DownloadManager' | 'WebView' | 'Socket' | 'DNS'), kind ('http' | 'dns' | 'socket'),
//     method, url, scheme, host, port, path, requestHeaders [[name, value]], requestBytes,
//     outcome, complete (the exchange has ended),
//     status (null until a response head), reason, responseHeaders [[name, value]], contentType, responseBytes, finalUrl (a redirect the transport followed) or null, redirects (followed by the transport),
//     closedEarly (the app closed the response before reading all of it), durationMs (null until it ends), failure { type, message } or null, refusedHost (host the allowlist refused) or null,
//     mappedUrl / mappedRule ("Redirecionar hosts"), mockId / mockLabel (answered by a "Mock de endpoints" entry, never sent) }
//   outcome: 'pending' (no head yet) | 'response' (a status arrived) | 'refused-by-allowlist' | 'offline' | 'unknown-host' | 'timeout' | 'aborted' | 'error' | 'unsupported'
//            | 'connected' (a loopback connection; kind 'loopback': the device's own interface, never refused by policy; a loopback connect nobody listens for ends 'error' with ECONNREFUSED)
// Wire format (Worker -> page):  { type: 'netlog', reset?: true, rows: [entry, ...] (new and changed entries, by seq), dropped, total }
//   dropped = entries the Worker has discarded because its buffer was full; total = entries created since the reset.

export const MAX_ENTRIES = 5000;
export const FLUSH_MS = 100;
export const OUTCOMES = ['pending', 'response', 'refused-by-allowlist', 'offline', 'unknown-host', 'timeout', 'aborted', 'error', 'unsupported', 'connected'];

const DEFAULT_PORTS = { 'http:': 80, 'https:': 443 };
/** URL text -> { scheme, host, port, path } (path keeps the query); text that is not an absolute URL leaves the parts empty. */
export function splitUrl(text) {
  try {
    const u = new URL(text), port = u.port ? Number(u.port) : (DEFAULT_PORTS[u.protocol] ?? null);
    return { scheme: u.protocol.replace(/:$/, ''), host: u.hostname.replace(/^\[|\]$/g, ''), port, path: `${u.pathname}${u.search}` };
  } catch { return { scheme: '', host: '', port: null, path: String(text ?? '') }; }
}

/** A failure the network layer produced ({ type: 'Ljava/net/...;', message }) -> the outcome it means. */
export function outcomeOfFailure(failure) {
  const type = failure?.type ?? '', message = failure?.message ?? '';
  if (type === 'Ljava/net/SocketTimeoutException;') return 'timeout';
  if (type === 'Ljava/net/UnknownHostException;') return 'unknown-host';
  if (type === 'Ljava/net/SocketException;' && /^(Socket closed|Software caused connection abort)$/.test(message)) return 'aborted';
  return 'error';
}

const headerValue = (headers, name) => { for (const [n, v] of headers ?? []) if (String(n).toLowerCase() === name) return String(v); return null; };
const pairs = headers => (headers ?? []).map(([n, v]) => [String(n), String(v)]);
const rounded = ms => Math.round(ms * 1000) / 1000;

/**
 * @param post     (message) => void   delivers a batch to the page (self.postMessage in the Worker)
 * @param clock    { now(): VM uptime ms, wall(): epoch ms }
 * @param identity () => ({ tid, thread })   the running Java thread
 */
const TEXT_TYPE = /json|text\/|xml|javascript|x-www-form-urlencoded|graphql/i;
export function createNetlog({ post = () => {}, clock = { now: () => 0, wall: () => Date.now() }, identity = () => ({ tid: 0, thread: 'main' }), maxEntries = MAX_ENTRIES, flushMs = FLUSH_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id) } = {}) {
  let buffer = [], pending = new Set(), dropped = 0, total = 0, seq = 0, timer = null, reset = true;
  const send = () => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (!pending.size && !reset) return;
    const first = buffer.length ? buffer[0].seq : seq, rows = [...pending].filter(entry => entry.seq >= first).sort((a, b) => a.seq - b.seq).map(entry => structuredCloneEntry(entry));
    const message = { type: 'netlog', rows, dropped, total }; if (reset) message.reset = true;
    pending = new Set(); reset = false; post(message);
  };
  const trim = () => { if (buffer.length > maxEntries) { dropped += buffer.length - maxEntries; buffer = buffer.slice(buffer.length - maxEntries); } };
  const touch = entry => { pending.add(entry); if (timer === null) timer = setTimer(send, flushMs); return entry; };
  const create = fields => {
    const who = identity(), url = String(fields.url ?? ''), parts = splitUrl(url);
    const entry = { seq: seq++, uptime: rounded(clock.now()), wall: Math.floor(clock.wall()), tid: Number(who.tid ?? 0), thread: who.thread ?? 'main', api: fields.api ?? 'java.net', kind: fields.kind ?? 'http',
      method: String(fields.method ?? 'GET'), url, scheme: fields.scheme ?? parts.scheme, host: fields.host ?? parts.host, port: fields.port ?? parts.port, path: fields.path ?? parts.path,
      requestHeaders: pairs(fields.headers), requestBytes: fields.bytes ?? 0, outcome: 'pending', complete: false, status: null, reason: '', responseHeaders: [], contentType: null, responseBytes: 0,
      finalUrl: null, redirects: 0, closedEarly: false, durationMs: null, failure: null, refusedHost: null, mappedUrl: fields.mappedUrl ?? null, mappedRule: fields.mappedRule ?? null,   // mappedUrl: where "Redirecionar hosts" sent it (src/host-map.js)
      mockId: fields.mockId ?? null, mockLabel: fields.mockLabel ?? null };   // the "Mock de endpoints" entry that answered it in the lab (src/endpoint-mocks.js); it never went to the network
    buffer.push(entry); total++;
    if (buffer.length > maxEntries + 256) trim();   // amortized: trim in chunks, never per entry
    return touch(entry);
  };
  const end = (entry, outcome, failure = null, op = null) => {
    if (entry.complete) return entry;
    if (op?.capture?.length && TEXT_TYPE.test(entry.contentType ?? '')) {   // a text body (JSON, text, XML, form) for "Criar mock"; a binary body is left out
      try { entry.responseBody = new TextDecoder('utf-8', { fatal: false }).decode(op.capture); entry.responseBodyTruncated = !!op.captureTruncated; } catch { entry.responseBody = null; }
    }
    entry.outcome = outcome; entry.complete = true; entry.failure = failure; entry.durationMs = Math.max(0, rounded(clock.now() - entry.uptime)); return touch(entry);
  };
  const api = {
    /** A request that started: `request` is the network layer's { method, url, headers, body }. Returns the entry (kept by the caller to update it). */
    begin(request, { api: via = 'java.net', mapped = null, mock = null } = {}) { return create({ api: via, method: request.method, url: request.url, headers: request.headers, bytes: request.body?.length ?? 0, mappedUrl: mock ? null : mapped?.url ?? null, mappedRule: mock ? null : mapped?.rule ?? null, mockId: mock?.id ?? null, mockLabel: mock?.label ?? null }); },
    /** A request the policy refused before anything left the device: outcome 'offline' when the device is offline, else 'refused-by-allowlist' (with the host). */
    refuse({ api: via = 'java.net', kind = 'http', method = 'GET', url, host, port = null, headers = [], bytes = 0, offline = false }) {
      const entry = create({ api: via, kind, method, url, host, port, headers, bytes }); entry.refusedHost = offline ? null : (host ?? entry.host);
      return end(entry, offline ? 'offline' : 'refused-by-allowlist');
    },
    /** A request that cannot be carried out here (a socket conversation that is not HTTP/1.1): the failure is explicit, never a faked success. */
    unsupported({ api: via = 'Socket', kind = 'socket', method = 'CONNECT', url, host, port = null, message }) {
      return end(create({ api: via, kind, method, url, host, port }), 'unsupported', { type: 'unsupported', message: String(message) });
    },
    /** A TCP connect to the device's own loopback interface (127.0.0.0/8, ::1): kind 'loopback', outcome 'connected', or 'error' (ECONNREFUSED) when no socket of the app listens. Policy never applies. */
    loopback({ api: via = 'Socket', method = 'CONNECT', url, host, port = null, refused = false }) {
      const entry = create({ api: via, kind: 'loopback', method, url, host, port });
      return refused ? end(entry, 'error', { type: 'errno', message: 'ECONNREFUSED (Connection refused)' }) : end(entry, 'connected');
    },
    /** Syncs an entry with the state of the network layer's operation: { head, ended, error, closed, received, request: { timedOut } }. Idempotent; call it whenever the operation moves. */
    observe(entry, op) {
      if (!entry || entry.complete) return;
      let changed = false;
      if (op.head && entry.status === null) {
        const head = op.head; entry.status = head.status; entry.reason = String(head.reason ?? ''); entry.responseHeaders = pairs(head.headers); entry.contentType = headerValue(head.headers, 'content-type');
        if (head.url && head.url !== entry.url) { entry.finalUrl = head.url; entry.redirects = 1; }
        entry.outcome = 'response'; changed = true;
      }
      if ((op.received ?? 0) !== entry.responseBytes) { entry.responseBytes = op.received ?? 0; changed = true; }
      if (op.error) { end(entry, entry.status !== null ? 'error' : outcomeOfFailure(op.error), { type: String(op.error.type ?? ''), message: String(op.error.message ?? '') }); return; }
      if (op.ended) { end(entry, 'response', null, op); return; }
      if (op.closed) {
        if (entry.status !== null) { entry.closedEarly = true; end(entry, 'response', null, op); }
        else end(entry, op.request?.timedOut ? 'timeout' : 'aborted', op.request?.timedOut ? { type: 'Ljava/net/SocketTimeoutException;', message: 'timeout' } : { type: 'Ljava/net/SocketException;', message: 'Socket closed' });
        return;
      }
      if (changed) touch(entry);
    },
    /** Posts what is pending now (called at the end of a drained event batch / operation). */
    flush: send,
    /** The buffered entries (at most maxEntries) with the counters. */
    snapshot() { trim(); return { rows: buffer.map(structuredCloneEntry), dropped, total }; },
    /** Forgets everything and tells the page to do the same (a new APK / a restart). */
    clear() { buffer = []; pending = new Set(); dropped = 0; total = 0; seq = 0; reset = true; send(); },
    get size() { trim(); return buffer.length; },
    get dropped() { trim(); return dropped; },
    /** Routes the runtime's network reports here (runtime.netLog). */
    attach(runtime) {
      identity = () => { const t = runtime.thread ?? runtime.scheduler?.mainThread?.(); return { tid: Number(t?.id ?? 0), thread: t?.name ?? 'main' }; };
      clock = runtime.clock ?? clock;
      runtime.netLog = this;
      return this;
    },
  };
  return api;
}

function structuredCloneEntry(entry) {
  return { ...entry, requestHeaders: entry.requestHeaders.map(h => [...h]), responseHeaders: entry.responseHeaders.map(h => [...h]), failure: entry.failure ? { ...entry.failure } : null };
}
