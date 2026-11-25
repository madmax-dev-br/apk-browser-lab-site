// Network routes of plugins (lab.route, docs/PLUGINS.md "Network routes"): a debugging tool, like the endpoint mocks (src/endpoint-mocks.js) but decided by the plugin's code at
// the moment of the request. A request of the app that a route's filter matches waits, in the network bridge (src/network-native.js startRoute), for the plugin that owns the
// route to answer what to do with it:
//   continue { url, method, headers, body }  the exchange goes on, unchanged or with the request the plugin changed (a proxy that only observes, or rewrites);
//   fulfill  { status, reason, headers, body }  the plugin's response, delivered like a mock's (it never reaches the network);
//   fetch                                      the lab makes the real exchange and hands the whole response to the plugin, which then fulfills (the response changed) or continues;
//   abort    { error }                         the exchange fails like a dropped connection (connection | reset | timeout | an IOException with the plugin's message).
// Never silent: every routed request is counted per route, the first one writes a Logcat warning, the network log marks the entry with the route, the Resumo lists the active
// routes and the page shows them as plugin network routes. A route is the plugin's: it goes away when the plugin stops, and a request it holds then goes on unchanged.
// A route whose plugin does not answer within ROUTE_TIMEOUT_MS also goes on unchanged, said in the trace. With no route the network path pays one property test.
// The filter uses the endpoint mocks' URL pattern ("https://host/path/**", a host-less "/path", "*" labels and segments); without a url it takes every request.
// DOM-free and no process.*: runs in the VM's Worker.
import { validateMock, matchEndpointMock, MOCK_METHODS } from './endpoint-mocks.js?v=8411deb8def1';
import { REASONS } from './virtual-http-socket.js?v=8411deb8def1';

export const MAX_ROUTES = 50, ROUTE_TIMEOUT_MS = 30000, MAX_ROUTED_BODY_BYTES = 32 * 1024 * 1024;
const ID = /^[\w.-]{1,80}$/;

/** A route's filter as the plugin gave it -> { compiled, error }. `url` empty or absent takes every request ("/**" on any host). */
export function compileRouteFilter(filter = {}) {
  const f = filter && typeof filter === 'object' ? filter : {};
  const method = String(f.method ?? 'ANY').trim().toUpperCase() || 'ANY';
  if (!MOCK_METHODS.includes(method)) return { error: `Invalid method "${method.slice(0, 20)}": use ${MOCK_METHODS.join(', ')}.` };
  const url = String(f.url ?? '').trim() || '/**';
  const { errors, mock } = validateMock({ method, url, query: f.query === 'exact' ? 'exact' : 'ignore', bodyContains: f.bodyContains ?? '', status: 200, headers: [], body: '' }, { checkBody: false });
  const wrong = errors.filter(e => ['method', 'url', 'query'].includes(e.field));
  if (wrong.length) return { error: wrong.map(e => e.message).join(' ') };
  const { compiled } = validateMock(mock);   // the pattern compiled the way mocks compile it (the response part is unused)
  return { compiled: { method: compiled.method, pattern: compiled.pattern, query: compiled.query, bodyContains: compiled.bodyContains }, url, method };
}

/** The label a route is shown with (network log, Logcat, Resumo). */
export const routeLabel = record => `plugin ${record.ownerName || record.owner}: ${record.name || `${record.method} ${record.url}`}`.slice(0, 160);

/**
 * Replaces the routes of the running VM. `list`: [{ id, owner, ownerName, name, filter }]. Answers one status per route: { id, state: 'active' | 'invalid', hits, error? }.
 * Counts survive a re-apply of the same id. Requests held by a route that is gone go on unchanged (the bridge's dropRoutes).
 */
export function applyNetworkRoutes(runtime, list) {
  const platform = runtime.platform, previous = platform.netRoutesAll ?? new Map(), all = new Map(), active = [], statuses = [];
  for (const raw of (Array.isArray(list) ? list : []).slice(0, MAX_ROUTES)) {
    const id = String(raw?.id ?? ''); if (!ID.test(id)) { statuses.push({ id, state: 'invalid', hits: 0, error: 'Invalid route id.' }); continue; }
    const { compiled, error, url, method } = compileRouteFilter(raw.filter);
    const record = previous.get(id) ?? { id, hits: 0, warned: false, route: true };
    Object.assign(record, { owner: String(raw.owner ?? ''), ownerName: String(raw.ownerName ?? '').slice(0, 80), name: String(raw.name ?? '').slice(0, 120), url: url ?? '', method: method ?? 'ANY', compiled: compiled ?? null, enabled: !error });
    record.label = routeLabel(record);
    all.set(id, record);
    if (error) { statuses.push({ id, state: 'invalid', hits: record.hits, error }); continue; }
    active.push(record); statuses.push({ id, state: 'active', hits: record.hits });
  }
  platform.netRoutesAll = all;
  platform.netRoutes = active.length ? active : null;   // null: the network path pays one property test and nothing else
  runtime.network?.dropRoutes?.(record => !active.includes(record));
  return statuses;
}

/** The active route (in list order) that takes `request` { method, url, body }, or null. */
export function matchNetworkRoute(runtime, request) {
  const routes = runtime.platform?.netRoutes; return routes ? matchEndpointMock(routes, request) : null;
}

/** A request a route takes: counted, and the first one of each route is a Logcat warning. */
export function noteRouteHit(runtime, record, request) {
  const hits = ++record.hits;
  if (hits === 1 || !record.warned) { record.warned = true; runtime.record?.(`LOG W APKWebLab: plugin network route: ${request.method} ${request.url} held for ${record.label}`); }
}

/** The routes with their counts (snapshot, for the page). */
export function describeNetworkRoutes(runtime) {
  return [...(runtime.platform?.netRoutesAll?.values() ?? [])].map(record => ({ id: record.id, owner: record.owner, ownerName: record.ownerName, label: record.label, method: record.method, url: record.url, hits: record.hits, active: !!runtime.platform.netRoutes?.includes(record) }));
}

/** Lines for the Resumo / report, or null when no route is active. */
export function networkRouteSummaryLines(runtime) {
  const active = runtime.platform?.netRoutes; if (!active?.length) return null;
  const hits = active.reduce((sum, record) => sum + record.hits, 0);
  const lines = [`Plugin network routes ACTIVE: ${active.length} (${hits} ${hits === 1 ? 'request' : 'requests'} held for a plugin, which could change the request or the response)`];
  for (const record of active.slice(0, 8)) lines.push(`  ${record.label} (${record.hits} ${record.hits === 1 ? 'request' : 'requests'})`);
  if (active.length > 8) lines.push(`  … and ${active.length - 8} more`);
  return lines;
}

const encoder = new TextEncoder();
/** Headers as the plugin gives them ({ name: value }, [[name, value]] or [{ name, value }]) -> [[name, value]]; throws on a name or value a request cannot carry. */
export function headerPairs(value, what = 'headers') {
  const rows = Array.isArray(value) ? value.map(item => Array.isArray(item) ? [item[0], item[1]] : [item?.name, item?.value]) : value && typeof value === 'object' ? Object.entries(value) : [];
  const out = [];
  for (const [rawName, rawValue] of rows.slice(0, 200)) {
    if (rawValue === undefined || rawValue === null) continue;
    const name = String(rawName ?? '').trim(), text = String(rawValue);
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw new Error(`${what}: invalid header name "${name.slice(0, 40)}"`);
    if (/[\r\n\0]/.test(text)) throw new Error(`${what}: the value of ${name} cannot contain a line break`);
    out.push([name, text]);
  }
  return out;
}
/** A body as the plugin gives it (string, Uint8Array / ArrayBuffer, or an object = JSON) -> Uint8Array, or null for undefined / null. */
export function bodyBytes(value, what = 'body') {
  if (value === undefined || value === null) return null;
  let bytes;
  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else if (typeof value === 'string') bytes = encoder.encode(value);
  else bytes = encoder.encode(JSON.stringify(value));
  if (bytes.length > MAX_ROUTED_BODY_BYTES) throw new Error(`${what} is larger than ${MAX_ROUTED_BODY_BYTES / 1048576} MiB`);
  return bytes;
}

/** The request a 'continue' decision names: the original with the plugin's url, method, headers or body. Throws a message for the plugin on a value that cannot go out. */
export function continuedRequest(original, change = {}) {
  const c = change && typeof change === 'object' ? change : {};
  const out = { ...original };
  if (c.url !== undefined && c.url !== null) { let url; try { url = new URL(String(c.url)); } catch { throw new Error(`continue: invalid url "${String(c.url).slice(0, 120)}"`); } if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('continue: the url must be http:// or https://'); url.hash = ''; out.url = url.href; }
  if (c.method !== undefined && c.method !== null) { const method = String(c.method).toUpperCase(); if (!/^[A-Z]{1,16}$/.test(method)) throw new Error(`continue: invalid method "${method.slice(0, 20)}"`); out.method = method; }
  if (c.headers !== undefined && c.headers !== null) out.headers = headerPairs(c.headers, 'continue headers');
  if (c.body !== undefined) out.body = bodyBytes(c.body, 'continue body');
  const changed = ['url', 'method', 'headers', 'body'].filter(key => c[key] !== undefined && (key === 'body' || c[key] !== null));
  return { request: out, changed };
}

/** The response a 'fulfill' decision names, in the mock's compiled shape { status, reason, headers, body, delayMs }. Content-Length is the lab's (the body given is what the app reads). */
export function fulfilledResponse(fields = {}, method = 'GET') {
  const f = fields && typeof fields === 'object' ? fields : {};
  const headers = headerPairs(f.headers ?? {}, 'fulfill headers').filter(([name]) => !['content-length', 'content-encoding', 'transfer-encoding'].includes(name.toLowerCase()));
  const body = bodyBytes(f.body, 'fulfill body') ?? new Uint8Array(0);
  if ((f.body !== undefined && f.body !== null && typeof f.body === 'object' && !(f.body instanceof Uint8Array) && !ArrayBuffer.isView(f.body) && !(f.body instanceof ArrayBuffer)) && !headers.some(([name]) => name.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/json; charset=utf-8']);
  const status = f.status === undefined ? 200 : Number(f.status);
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error(`fulfill: invalid status ${String(f.status).slice(0, 20)} (use 100 to 599)`);
  const reason = String(f.reason ?? '').trim(); if (/[\r\n]/.test(reason)) throw new Error('fulfill: the reason cannot contain a line break');
  const delayMs = f.delayMs === undefined ? 0 : Number(f.delayMs);
  if (!(Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 600000)) throw new Error('fulfill: delayMs must be 0 to 600000');
  const empty = status === 204 || status === 304 || (status >= 100 && status < 200);
  if (!empty) headers.push(['Content-Length', String(body.length)]);
  return { status, reason: reason || REASONS[status] || '', headers, body: empty || method === 'HEAD' ? new Uint8Array(0) : body, delayMs };
}

/** The failure an 'abort' decision names, as the bridge's op.error { type, message }. */
export function abortFailure(error, request) {
  let host = ''; try { host = new URL(request.url).hostname; } catch { /* left empty */ }
  switch (String(error ?? 'connection')) {
    case 'connection': return { type: 'Ljava/net/ConnectException;', message: `failed to connect to ${host}: connection refused (plugin network route)` };
    case 'reset': return { type: 'Ljava/net/SocketException;', message: 'Connection reset' };
    case 'timeout': return { type: 'Ljava/net/SocketTimeoutException;', message: 'timeout' };
    case 'unknown-host': return { type: 'Ljava/net/UnknownHostException;', message: `Unable to resolve host "${host}": No address associated with hostname` };
    default: return { type: 'Ljava/io/IOException;', message: String(error).slice(0, 300) };
  }
}
