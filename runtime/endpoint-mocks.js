// "Mock de endpoints" (Controles): a debugging tool. The tester lists N mocked endpoints; a request of the app that matches one (the first enabled one in list order) is answered by the
// lab with the configured response and never leaves the device -- before the allow list, the offline state, "Redirecionar hosts" and the relay. The answer goes through the same
// operation the network bridge fills for a real exchange (src/network-native.js NetworkBridge.start / refresh: head, body pieces, end), so HttpURLConnection, OkHttp over a
// java.net.Socket (src/virtual-http-socket.js) and DownloadManager see it exactly like a server's: redirects, cookies (Set-Cookie), 4xx error streams, timeouts against the delay.
// Never silent: every hit is counted, the first one per mock writes a Logcat warning, the network log marks the entry with the mock, and the Resumo lists the active mocks.
// DOM-free and no process.*: shared by the page (validation, storage, export) and the Worker (matching, responses).
//
// Mock (stored per package, exported as JSON):
//   { id, enabled, name, method ('ANY' | GET | POST | PUT | PATCH | DELETE | HEAD | OPTIONS), url (pattern), query ('ignore' | 'exact'), bodyContains,
//     status, reason, headers [{ name, value }], body (text), bodyBase64 (a file's bytes, instead of body) | null, bodyFile (its name), delayMs }
// URL pattern: "http(s)://host[:port]/path[?query]" or a host-less "/path[?query]" (any scheme, host and port). A host label may be "*" (one label: "*.exemplo.com"); a path segment
// "*" is exactly one segment, "*" inside a segment is any text without "/", and "**" is any number of segments. Without a port the pattern takes any port.
// Query "exact": the request has exactly the pattern's parameters (any order; a value "*" takes any value); "ignore": the query is not looked at.
import { inflateRaw } from './inflate.js?v=6a95347ec7c1';
import { REASONS } from './virtual-http-socket.js?v=6a95347ec7c1';

export const MOCK_METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const MAX_MOCKS = 50, MAX_BODY_BYTES = 4 * 1024 * 1024, MAX_DELAY_MS = 600000, MAX_HEADERS = 64;
export const STORAGE_PREFIX = 'apkweb-endpoint-mocks-v1:';
export const EXPORT_FORMAT = 'apkweb-endpoint-mocks';
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HOST_PATTERN = /^(\*|[a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.(\*|[a-z0-9]([a-z0-9-]*[a-z0-9])?))*$/i, IPV6 = /^\[[0-9a-f:.]+\]$/i;
const encoder = new TextEncoder();
const decodeUtf8 = bytes => new TextDecoder('utf-8', { fatal: false }).decode(bytes);
const safeDecode = text => { try { return decodeURIComponent(text); } catch { return text; } };
const escapeRe = text => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

let counter = 0;
export function newMockId() {
  try { if (typeof globalThis.crypto?.randomUUID === 'function') return 'm-' + globalThis.crypto.randomUUID().slice(0, 13); } catch { /* no crypto: fall through */ }
  return `m-${Date.now().toString(36)}-${(++counter).toString(36)}`;
}

/** A new mock as the "Adicionar" dialog starts it: any method, 200, Content-Type application/json. */
export function defaultMock() {
  return { id: newMockId(), enabled: true, name: '', method: 'ANY', url: '', query: 'ignore', bodyContains: '', status: 200, reason: '', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '', bodyBase64: null, bodyFile: '', delayMs: 0 };
}

function headerRows(value) {
  if (Array.isArray(value)) return value.slice(0, MAX_HEADERS * 2).map(item => Array.isArray(item) ? { name: String(item[0] ?? ''), value: String(item[1] ?? '') } : { name: String(item?.name ?? ''), value: String(item?.value ?? '') });
  if (value && typeof value === 'object') return Object.entries(value).slice(0, MAX_HEADERS * 2).map(([name, v]) => ({ name, value: String(v ?? '') }));
  return [];
}
/** Stored, imported or typed data in the mock shape. Never throws; what cannot be used stays as typed so validateMock names it (nothing is dropped silently). */
export function normalizeMock(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}, text = (v, max) => String(v ?? '').slice(0, max);
  return {
    id: typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : newMockId(),
    enabled: r.enabled !== false, name: text(r.name, 120), method: text(r.method ?? 'ANY', 20).trim().toUpperCase() || 'ANY', url: text(r.url, 4000).trim(),
    query: r.query === 'exact' ? 'exact' : r.query === undefined || r.query === 'ignore' ? 'ignore' : text(r.query, 20), bodyContains: text(r.bodyContains, 2000),
    status: r.status ?? 200, reason: text(r.reason, 200), headers: headerRows(r.headers),
    body: text(r.body, MAX_BODY_BYTES + 1), bodyBase64: typeof r.bodyBase64 === 'string' && r.bodyBase64 ? r.bodyBase64.slice(0, Math.ceil(MAX_BODY_BYTES * 4 / 3) + 8) : null, bodyFile: text(r.bodyFile, 200),
    delayMs: r.delayMs ?? 0,
  };
}

/** The URL pattern: { scheme|null, host|null, port|null, path, query|null, hostRe, pathRe } or { error } (in Portuguese, for the dialog). */
export function parsePattern(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'Informe a URL ou o caminho (ex.: https://api.exemplo.com/v1/* ou /v1/usuarios/*).' };
  if (/\s/.test(raw)) return { error: 'A URL não pode ter espaços.' };
  if (raw.includes('#')) return { error: 'A URL não pode ter fragmento (#): ele não vai na requisição.' };
  let scheme = null, host = null, port = null, rest = raw;
  const full = /^([a-z][a-z0-9+.-]*):\/\/([^/?]*)(.*)$/i.exec(raw);
  if (full) {
    scheme = full[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return { error: 'Use http:// ou https:// (ou um caminho começando com / para qualquer host).' };
    const authority = /^(\[[^\]]+\]|[^:@]+)(?::(\d{1,5}))?$/.exec(full[2]);
    if (!authority) return { error: 'Host inválido: use nome, *.dominio, IP ou host:porta.' };
    host = authority[1].toLowerCase(); port = authority[2] === undefined ? null : Number(authority[2]);
    if (!(HOST_PATTERN.test(host) || IPV6.test(host))) return { error: 'Host inválido: use nome, *.dominio, IP ou host:porta.' };
    if (port !== null && (port < 1 || port > 65535)) return { error: 'Porta inválida: use um número de 1 a 65535.' };
    rest = full[3];
  } else if (!raw.startsWith('/')) return { error: 'Comece com http://, https:// ou / (caminho em qualquer host).' };
  const mark = rest.indexOf('?'), path = (mark >= 0 ? rest.slice(0, mark) : rest) || '/', query = mark >= 0 ? rest.slice(mark + 1) : null;
  if (!path.startsWith('/')) return { error: 'O caminho deve começar com /.' };
  const segments = safeDecode(path).split('/').slice(1);
  if (segments.some(segment => segment.includes('**') && segment !== '**')) return { error: '"**" deve ocupar um segmento inteiro (ex.: /v1/**/detalhe).' };
  let pathSource = '';
  for (const segment of segments) pathSource += segment === '**' ? '(?:/[^/]*)*' : '/' + (segment === '*' ? '[^/]+' : escapeRe(segment).replaceAll('*', '[^/]*'));
  const hostRe = host && !IPV6.test(host) ? new RegExp('^' + host.split('.').map(label => label === '*' ? '[^.]+' : escapeRe(label)).join('\\.') + '$') : null;
  return { scheme, host, port, path, query, hostRe, pathRe: new RegExp('^' + (pathSource || '/') + '$') };
}

const queryList = text => { const out = []; for (const [name, value] of new URLSearchParams(text)) out.push([name, value]); return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)); };
/** "exact" query mode: the same parameters, any order; a pattern value "*" takes any value. */
export function sameQuery(patternQuery, requestQuery) {
  const want = queryList(patternQuery ?? ''), have = queryList(requestQuery ?? '');
  if (want.length !== have.length) return false;
  const pool = [...have];
  for (const [name, value] of want) { const at = pool.findIndex(([n, v]) => n === name && (value === '*' || v === value)); if (at < 0) return false; pool.splice(at, 1); }
  return true;
}

/** The gzip member's decompressed bytes, or throws (a mock that says Content-Encoding: gzip must carry real gzip). */
export function gunzip(bytes) {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) throw new Error('não começa com o cabeçalho gzip');
  const flags = bytes[3]; let at = 10;
  if (flags & 4) at += 2 + (bytes[at] | (bytes[at + 1] << 8));
  if (flags & 8) { while (at < bytes.length && bytes[at] !== 0) at++; at++; }
  if (flags & 16) { while (at < bytes.length && bytes[at] !== 0) at++; at++; }
  if (flags & 2) at += 2;
  const end = bytes.length - 8, size = (bytes[end + 4] | (bytes[end + 5] << 8) | (bytes[end + 6] << 16) | (bytes[end + 7] << 24)) >>> 0;
  if (at > end || size > 64 * 1024 * 1024) throw new Error('cabeçalho gzip inválido');
  const out = inflateRaw(bytes.subarray(at, end), size);
  return out.length === size ? out : out.subarray(0, size);
}

function base64Bytes(text) {
  if (typeof globalThis.atob !== 'function') throw new Error('base64 indisponível');
  const binary = globalThis.atob(text), out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
export function bytesToBase64(bytes) {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return globalThis.btoa(binary);
}

/**
 * Checks one mock. Returns { errors: [{ field, message }], warnings: [{ field, message }], compiled } where compiled (null when there are errors) is what the Worker matches with:
 * { method, pattern, query, bodyContains, response: { status, reason, headers [[name, value]], body Uint8Array, delayMs } }.
 */
export function validateMock(input) {
  const mock = normalizeMock(input), errors = [], warnings = [], error = (field, message) => errors.push({ field, message }), warn = (field, message) => warnings.push({ field, message });
  if (!MOCK_METHODS.includes(mock.method)) error('method', `Método inválido: use ${MOCK_METHODS.join(', ')}.`);
  const pattern = parsePattern(mock.url); if (pattern.error) error('url', pattern.error);
  if (mock.query !== 'ignore' && mock.query !== 'exact') error('query', 'Modo da query inválido: use "ignorar" ou "exata".');
  if (!pattern.error && mock.query === 'ignore' && pattern.query) warn('query', 'A URL tem query, mas o modo é "ignorar": ela não é comparada.');
  const statusText = String(mock.status).trim(), status = /^\d{3}$/.test(statusText) ? Number(statusText) : NaN;
  if (!(status >= 200 && status <= 599)) error('status', 'Status inválido: use um número de 200 a 599.');
  if (/[\r\n]/.test(mock.reason)) error('reason', 'A mensagem do status não pode ter quebra de linha.');
  const headers = [];
  for (const [index, row] of mock.headers.entries()) {
    const name = row.name.trim(), value = row.value.trim();
    if (!name && !value) continue;
    if (!TOKEN.test(name)) { error(`header-${index}`, `Cabeçalho ${index + 1}: nome inválido${name ? ` "${name.slice(0, 40)}"` : ' (vazio)'}.`); continue; }
    if (/[\r\n\0]/.test(value)) { error(`header-${index}`, `Cabeçalho ${name}: o valor não pode ter quebra de linha.`); continue; }
    headers.push([name, value]);
  }
  if (headers.length > MAX_HEADERS) error('headers', `No máximo ${MAX_HEADERS} cabeçalhos.`);
  const header = name => headers.filter(([n]) => n.toLowerCase() === name).map(([, v]) => v);
  let body = new Uint8Array(0);
  if (mock.bodyBase64) { try { body = base64Bytes(mock.bodyBase64); } catch { error('body', 'O arquivo do corpo não pôde ser lido (base64 inválido).'); } }
  else body = encoder.encode(mock.body);
  if (body.length > MAX_BODY_BYTES) error('body', `O corpo passa de ${MAX_BODY_BYTES / 1048576} MiB.`);
  const contentType = header('content-type')[0] ?? '';
  if (/json/i.test(contentType) && !mock.bodyBase64 && mock.body.trim()) { try { JSON.parse(mock.body); } catch (e) { warn('body', `O corpo não é JSON válido (Content-Type ${contentType}): ${String(e?.message ?? e).slice(0, 120)}. Ele será enviado assim mesmo.`); } }
  if ((status === 204 || status === 304) && body.length) warn('body', `Respostas ${status} não têm corpo: o corpo configurado não é enviado.`);
  const encodings = header('content-encoding').join(',').split(',').map(v => v.trim().toLowerCase()).filter(v => v && v !== 'identity');
  let delivered = body, decoded = false;
  if (encodings.length) {
    if (encodings.length !== 1 || !['gzip', 'x-gzip'].includes(encodings[0])) error('headers', `Content-Encoding "${header('content-encoding').join(', ')}" não é suportado no mock: use gzip (com um corpo gzip de verdade, carregado de arquivo) ou nenhum.`);
    else { try { delivered = gunzip(body); decoded = true; } catch (e) { error('body', `Content-Encoding: gzip, mas o corpo não é gzip válido (${e?.message ?? e}). Carregue um arquivo .gz ou remova o cabeçalho.`); } }
  }
  const lengths = header('content-length');
  if (lengths.length > 1) error('headers', 'Content-Length repetido.');
  else if (lengths.length === 1 && (!/^\d+$/.test(lengths[0]) || Number(lengths[0]) !== body.length)) error('headers', `Content-Length (${lengths[0]}) difere do tamanho do corpo (${body.length} bytes). Remova o cabeçalho para que o lab o calcule.`);
  const delayText = String(mock.delayMs ?? 0).trim(), delayMs = delayText === '' ? 0 : /^\d+$/.test(delayText) ? Number(delayText) : NaN;
  if (!(delayMs >= 0 && delayMs <= MAX_DELAY_MS)) error('delayMs', `Atraso inválido: use de 0 a ${MAX_DELAY_MS} ms.`);
  if (errors.length) return { errors, warnings, compiled: null, mock };
  // What the app receives: like the transport (src/network-transport.js), a body the transport decoded loses Content-Encoding and Content-Length; otherwise the lab states the length.
  let out = decoded ? headers.filter(([name]) => !['content-encoding', 'content-length'].includes(name.toLowerCase())) : headers.slice();
  if (!decoded && !lengths.length && status !== 204 && status !== 304) out = [...out, ['Content-Length', String(body.length)]];
  return {
    errors, warnings, mock,
    compiled: { method: mock.method, pattern, query: mock.query, bodyContains: mock.bodyContains, response: { status, reason: mock.reason.trim() || REASONS[status] || '', headers: out, body: status === 204 || status === 304 ? new Uint8Array(0) : delivered, delayMs } },
  };
}

/** Does the compiled mock match the request { method, url, body: Uint8Array|null }? */
export function mockMatches(compiled, request) {
  if (compiled.method !== 'ANY' && compiled.method !== String(request.method ?? '').toUpperCase()) return false;
  let url; try { url = new URL(request.url); } catch { return false; }
  const pattern = compiled.pattern;
  if (pattern.scheme && url.protocol !== pattern.scheme + ':') return false;
  if (pattern.host) {
    if (pattern.hostRe ? !pattern.hostRe.test(url.hostname.toLowerCase()) : url.hostname.toLowerCase() !== pattern.host) return false;
    if (pattern.port !== null && pattern.port !== Number(url.port || (url.protocol === 'https:' ? 443 : 80))) return false;
  }
  if (!pattern.pathRe.test(safeDecode(url.pathname))) return false;
  if (compiled.query === 'exact' && !sameQuery(pattern.query ?? '', url.search.slice(1))) return false;
  if (compiled.bodyContains) { const body = request.body; if (!body?.length || !decodeUtf8(body).includes(compiled.bodyContains)) return false; }
  return true;
}
/** The first record (in list order) of `records` [{ compiled, ... }] whose mock matches, or null. */
export function matchEndpointMock(records, request) {
  for (const record of records ?? []) if (record.compiled && mockMatches(record.compiled, request)) return record;
  return null;
}
/**
 * Could a mock answer requests for `host`(:port)? A name lookup or a socket connect for such a host must succeed for the request to reach the mock (the lab resolves it to its
 * synthetic address; nothing leaves the device). A host-less pattern serves every host, unless `hostless` is false (loopback connects keep the device's own interface).
 */
export function mockServesHost(records, host, port = null, { hostless = true } = {}) {
  const name = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  for (const record of records ?? []) {
    const pattern = record.compiled?.pattern; if (!pattern) continue;
    if (!pattern.host) { if (hostless) return true; continue; }
    const hostOk = pattern.hostRe ? pattern.hostRe.test(name) : pattern.host.replace(/^\[|\]$/g, '') === name;
    if (hostOk && (pattern.port === null || port === null || pattern.port === Number(port))) return true;
  }
  return false;
}

/** The label a mock is shown with (network log, Resumo, Logcat): its name, else "METHOD url". */
export const mockLabel = mock => (String(mock?.name ?? '').trim() || `${mock?.method ?? 'ANY'} ${mock?.url ?? ''}`).slice(0, 160);

// ---- the running VM (Worker) -------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Replaces the mocks of the running VM. `list`: mocks as stored. Answers one status per mock: { id, state: 'active' | 'disabled' | 'invalid', hits, error? }. Counts survive a re-apply
 * of the same mock id (editing a mock keeps its count).
 */
export function applyEndpointMocks(runtime, list) {
  const platform = runtime.platform, previous = platform.endpointMocksAll ?? new Map(), all = new Map(), active = [], statuses = [];
  for (const raw of (Array.isArray(list) ? list : []).slice(0, MAX_MOCKS)) {
    const { errors, compiled, mock } = validateMock(raw);
    const record = previous.get(mock.id) ?? all.get(mock.id) ?? { id: mock.id, hits: 0, warned: false };
    Object.assign(record, { label: mockLabel(mock), method: mock.method, url: mock.url, status: compiled?.response.status ?? null, compiled, enabled: mock.enabled && !errors.length });
    all.set(mock.id, record);
    if (errors.length) { statuses.push({ id: mock.id, state: 'invalid', hits: record.hits, error: errors.map(e => e.message).join(' ') }); continue; }
    if (!mock.enabled) { statuses.push({ id: mock.id, state: 'disabled', hits: record.hits }); continue; }
    active.push(record); statuses.push({ id: mock.id, state: 'active', hits: record.hits });
  }
  platform.endpointMocksAll = all;
  platform.endpointMocks = active.length ? active : null;   // null: the network path pays one property test and nothing else
  return statuses;
}

/** A request a mock answers: counted (the network log has every one), and the first hit of each mock is a Logcat warning. */
export function noteMockHit(runtime, record, request) {
  const hits = ++record.hits, status = record.compiled?.response.status;
  if (hits === 1 || !record.warned) { record.warned = true; runtime.record?.(`LOG W APKWebLab: endpoint mockado: ${request.method} ${request.url} -> ${status}`); }
}

/** The mocks with their counts (snapshot for the section's hit counts). */
export function describeEndpointMocks(runtime) {
  return [...(runtime.platform?.endpointMocksAll?.values() ?? [])].map(record => ({ id: record.id, label: record.label, hits: record.hits, active: !!record.enabled && !!runtime.platform.endpointMocks?.includes(record) }));
}

/** Lines for the Resumo / report, or null when no mock is active. */
export function endpointMockSummaryLines(runtime) {
  const active = runtime.platform?.endpointMocks; if (!active?.length) return null;
  const hits = active.reduce((sum, record) => sum + record.hits, 0);
  const lines = [`Mocks de endpoint ATIVOS: ${active.length} (${hits} ${hits === 1 ? 'requisição respondida' : 'requisições respondidas'} pelo lab; essas requisições não foram à rede)`];
  for (const record of active.slice(0, 8)) lines.push(`  ${record.label} -> ${record.status} (${record.hits} ${record.hits === 1 ? 'resposta' : 'respostas'})`);
  if (active.length > 8) lines.push(`  … e mais ${active.length - 8}`);
  return lines;
}

// ---- storage and export (page) ----------------------------------------------------------------------------------------------------------------------------------------------------

/** The stored mocks of a package; [] when there are none or storage is unavailable. `storage` defaults to localStorage (every access guarded). */
export function loadMocks(pkg, storage = undefined) {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    const list = JSON.parse(store?.getItem(STORAGE_PREFIX + pkg) ?? '[]');
    return Array.isArray(list) ? list.slice(0, MAX_MOCKS).map(normalizeMock) : [];
  } catch { return []; }
}
/** Saves the mocks of a package; false when storage is unavailable or full (the list then lasts for this page only). */
export function saveMocks(pkg, mocks, storage = undefined) {
  try { const store = storage === undefined ? globalThis.localStorage : storage; if (!store) return false; store.setItem(STORAGE_PREFIX + pkg, JSON.stringify(mocks.map(normalizeMock))); return true; } catch { return false; }
}
/** The JSON "Exportar" downloads. */
export function exportMocks(mocks, packageName = '') {
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, packageName, mocks: mocks.map(normalizeMock) }, null, 2);
}
/** Parses an exported file (or a bare array of mocks). Returns { mocks, error? }; imported mocks get fresh ids so they never collide with the current list. */
export function importMocks(text) {
  let data; try { data = JSON.parse(String(text)); } catch (e) { return { mocks: [], error: `O arquivo não é JSON válido: ${String(e?.message ?? e).slice(0, 120)}` }; }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray(data.mocks) ? data.mocks : null;
  if (!list) return { mocks: [], error: `O arquivo não tem uma lista de mocks (esperado {"format":"${EXPORT_FORMAT}","mocks":[...]}).` };
  return { mocks: list.slice(0, MAX_MOCKS).map(item => ({ ...normalizeMock(item), id: newMockId() })), ...(list.length > MAX_MOCKS ? { error: `Só os primeiros ${MAX_MOCKS} mocks foram importados.` } : {}) };
}
