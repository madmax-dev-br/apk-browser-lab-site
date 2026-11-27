// "Blocked calls" (Controls › Network): a debugging tool that saves resources. The tester lists rules; a network call of the app that a rule matches is never made: the lab does not fetch,
// does not use the relay and does not wait, and fails it at once with what Android gives for a connection that cannot be made (a java.io.IOException the real code path of a refused
// connection raises: ConnectException "ENETUNREACH" for an HTTP exchange, the name lookup failing with UnknownHostException for a host). It is a rule the user chose: never silent. Every
// blocked call is counted, marked in the network log ("blocked by you", with the rule that matched), written to the trace, and the Resumo lists the active rules.
// The lab ships no rule and never suggests one. A rule is checked first of all (before mocks, plugin routes, the allow list, Redirect hosts and the relay).
// DOM-free and no process.*: shared by the page (validation, storage) and the Worker (matching, counts).
//
// Rule (stored per package, like the endpoint mocks next to it):
//   { id, enabled, scope: 'endpoint' | 'host', name, method, url, query, host }
//   scope 'endpoint': method ('ANY' | GET | POST ...) + url, the same pattern as an endpoint mock ("https://api.example.test/v1/*" or "/v1/*", * and ** segments) and query ('ignore' | 'exact').
//   scope 'host': host as "api.example.test", "*.example.test" (one label) or "api.example.test:8443"; every method, scheme, path and query. Without a port, any port.
import { parsePattern, mockMatches, MOCK_METHODS, HOST_PATTERN, IPV6 } from './endpoint-mocks.js?v=df19921e3eea';

export const BLOCK_SCOPES = ['endpoint', 'host'];
export const MAX_BLOCKS = 50;
export const STORAGE_PREFIX = 'apkweb-blocked-calls-v1:';
export const BLOCKED_OUTCOME = 'blocked-by-user';
const escapeRe = text => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

let counter = 0;
export function newBlockId() {
  try { if (typeof globalThis.crypto?.randomUUID === 'function') return 'b-' + globalThis.crypto.randomUUID().slice(0, 13); } catch { /* no crypto: fall through */ }
  return `b-${Date.now().toString(36)}-${(++counter).toString(36)}`;
}

/** A new, empty rule of a scope (the page's form starts from it). */
export function defaultBlock(scope = 'endpoint') { return { id: newBlockId(), enabled: true, scope, name: '', method: 'ANY', url: '', query: 'ignore', host: '' }; }

/** Stored, imported or typed data in the rule shape. Never throws; what cannot be used stays as typed so validateBlock names it (nothing is dropped silently). */
export function normalizeBlock(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}, text = (v, max) => String(v ?? '').slice(0, max);
  return {
    id: typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : newBlockId(), enabled: r.enabled !== false,
    scope: text(r.scope ?? 'endpoint', 20).trim().toLowerCase(), name: text(r.name, 120),
    method: text(r.method ?? 'ANY', 20).trim().toUpperCase() || 'ANY', url: text(r.url, 4000).trim(),
    query: r.query === 'exact' ? 'exact' : r.query === undefined || r.query === 'ignore' ? 'ignore' : text(r.query, 20), host: text(r.host, 300).trim(),
  };
}

/** A host as typed (a name, *.suffix, host:port, or a URL whose host is taken) -> { host, port, hostRe } or { error }. */
export function parseHostRule(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'Enter the host (e.g. api.example.com, *.example.com or api.example.com:8443).' };
  if (/\s/.test(raw)) return { error: 'The host cannot contain spaces.' };
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(\[[^\]]+\]|[^/?#:@]+)(?::(\d{1,5}))?(?:[/?#].*)?$/i.exec(raw);
  if (!match) return { error: 'Invalid host: use a name, *.domain, an IP or host:port.' };
  const host = match[1].toLowerCase(), port = match[2] === undefined ? null : Number(match[2]);
  if (!(HOST_PATTERN.test(host) || IPV6.test(host))) return { error: 'Invalid host: use a name, *.domain, an IP or host:port.' };
  if (port !== null && (port < 1 || port > 65535)) return { error: 'Invalid port: use a number from 1 to 65535.' };
  const hostRe = host.includes('*') && !IPV6.test(host) ? new RegExp('^' + host.split('.').map(label => label === '*' ? '[^.]+' : escapeRe(label)).join('\\.') + '$') : null;
  return { host, port, hostRe };
}

/** Checks one rule: { errors: [{ field, message }], compiled, block }. compiled (null with errors) is what the Worker matches with. */
export function validateBlock(input) {
  const block = normalizeBlock(input), errors = [], error = (field, message) => errors.push({ field, message });
  if (!BLOCK_SCOPES.includes(block.scope)) error('scope', 'Invalid scope: use "endpoint" or "host".');
  let compiled = null;
  if (block.scope === 'endpoint') {
    if (!MOCK_METHODS.includes(block.method)) error('method', `Invalid method: use ${MOCK_METHODS.join(', ')}.`);
    const pattern = parsePattern(block.url); if (pattern.error) error('url', pattern.error);
    if (block.query !== 'ignore' && block.query !== 'exact') error('query', 'Invalid query mode: use "ignore" or "exact".');
    if (!errors.length) compiled = { scope: 'endpoint', method: block.method, pattern, query: block.query, bodyContains: '' };
  } else if (block.scope === 'host') {
    const parsed = parseHostRule(block.host); if (parsed.error) error('host', parsed.error);
    else compiled = { scope: 'host', host: parsed.host, port: parsed.port, hostRe: parsed.hostRe };
  }
  return { errors, compiled: errors.length ? null : compiled, block };
}

/** The label a rule is shown with (network log, Resumo, trace): its name, else "METHOD url" or "host". */
export const blockLabel = block => (String(block?.name ?? '').trim() || (block?.scope === 'host' ? `host ${block.host ?? ''}` : `${block?.method ?? 'ANY'} ${block?.url ?? ''}`)).slice(0, 160);

const portOf = url => Number(url.port || (url.protocol === 'https:' ? 443 : url.protocol === 'http:' ? 80 : 0));
function hostMatches(compiled, hostname, port) {
  const name = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!(compiled.hostRe ? compiled.hostRe.test(name) : compiled.host.replace(/^\[|\]$/g, '') === name)) return false;
  return compiled.port === null || (port !== null && compiled.port === Number(port));
}
/** Does the compiled rule match the request { method, url }? (a host rule: the URL's host, and port when the rule names one) */
export function blockMatches(compiled, request) {
  let url; try { url = new URL(request.url); } catch { return false; }
  if (compiled.scope === 'host') return hostMatches(compiled, url.hostname, portOf(url));
  return mockMatches(compiled, request);
}
/** The first record (in list order) of `records` [{ compiled }] that matches the request, or null. */
export function matchBlockedCall(records, request) {
  for (const record of records ?? []) if (record.compiled && blockMatches(record.compiled, request)) return record;
  return null;
}
/** The first host rule that stops `host`(:port): at a name lookup the port is unknown (null), so only a rule without a port applies. */
export function blockedHost(records, host, port = null) {
  for (const record of records ?? []) {
    const compiled = record.compiled; if (!compiled || compiled.scope !== 'host') continue;
    if (port === null ? compiled.port === null && hostMatches(compiled, host, null) : hostMatches(compiled, host, port)) return record;
  }
  return null;
}

// ---- the running VM (Worker) -------------------------------------------------------------------------------------------------------------------------------------------------------

/** Replaces the rules of the running VM. Answers one status per rule: { id, state: 'active' | 'disabled' | 'invalid', hits, error? }. Counts survive a re-apply of the same id. */
export function applyBlockedCalls(runtime, list) {
  const platform = runtime.platform, previous = platform.blockedCallsAll ?? new Map(), all = new Map(), active = [], statuses = [];
  for (const raw of (Array.isArray(list) ? list : []).slice(0, MAX_BLOCKS)) {
    const { errors, compiled, block } = validateBlock(raw);
    const record = previous.get(block.id) ?? all.get(block.id) ?? { id: block.id, hits: 0, noted: 0 };
    Object.assign(record, { label: blockLabel(block), scope: block.scope, method: block.method, target: block.scope === 'host' ? block.host : block.url, compiled, enabled: block.enabled && !errors.length });
    all.set(block.id, record);
    if (errors.length) { statuses.push({ id: block.id, state: 'invalid', hits: record.hits, error: errors.map(e => e.message).join(' ') }); continue; }
    if (!block.enabled) { statuses.push({ id: block.id, state: 'disabled', hits: record.hits }); continue; }
    active.push(record); statuses.push({ id: block.id, state: 'active', hits: record.hits });
  }
  platform.blockedCallsAll = all;
  platform.blockedCalls = active.length ? active : null;   // null: the network path pays one property test and nothing else
  const said = `NET blocked calls: ${active.length} active${active.length ? ` (${active.map(r => r.label).join('; ').slice(0, 400)})` : ''}`;   // every change of what is stopped is in the trace (once per change)
  if (said !== (platform.blockedCallsSaid ?? 'NET blocked calls: 0 active')) runtime.record?.(said);
  platform.blockedCallsSaid = said;
  return statuses;
}

/** A call a rule stopped: counted (the network log has every one) and written to the trace at the first one, then at every power of ten. */
export function noteBlockHit(runtime, record, request) {
  const hits = ++record.hits;
  if (hits === 1 || (hits >= 10 && /^10*$/.test(String(hits)))) runtime.record?.(`NET blocked by you (${record.label}): ${request.method} ${request.url} fails at once like a connection that cannot be made; nothing was sent${hits > 1 ? ` (${hits} calls so far)` : ''}`);
}

/** The rules with their counts (snapshot for the section's hit counts). */
export function describeBlockedCalls(runtime) {
  return [...(runtime.platform?.blockedCallsAll?.values() ?? [])].map(record => ({ id: record.id, label: record.label, hits: record.hits, active: !!record.enabled && !!runtime.platform.blockedCalls?.includes(record) }));
}

/** Lines for the Resumo / report, or null when no rule is active. */
export function blockedCallSummaryLines(runtime) {
  const active = runtime.platform?.blockedCalls; if (!active?.length) return null;
  const hits = active.reduce((sum, record) => sum + record.hits, 0);
  const lines = [`Blocked calls ACTIVE: ${active.length} rule${active.length === 1 ? '' : 's'} (${hits} ${hits === 1 ? 'call' : 'calls'} failed at once by your choice; those calls were not made)`];
  for (const record of active.slice(0, 8)) lines.push(`  ${record.label} (${record.scope}${record.scope === 'host' ? '' : `, ${record.method}`}): ${record.hits} ${record.hits === 1 ? 'call' : 'calls'}`);
  if (active.length > 8) lines.push(`  … and ${active.length - 8} more`);
  return lines;
}

// ---- storage (page) --------------------------------------------------------------------------------------------------------------------------------------------------------------

/** The stored rules of a package; [] when there are none or storage is unavailable. */
export function loadBlocks(pkg, storage = undefined) {
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    const list = JSON.parse(store?.getItem(STORAGE_PREFIX + pkg) ?? '[]');
    return Array.isArray(list) ? list.slice(0, MAX_BLOCKS).map(normalizeBlock) : [];
  } catch { return []; }
}
/** Saves the rules of a package; false when storage is unavailable or full (the list then lasts for this page only). */
export function saveBlocks(pkg, blocks, storage = undefined) {
  try { const store = storage === undefined ? globalThis.localStorage : storage; if (!store) return false; store.setItem(STORAGE_PREFIX + pkg, JSON.stringify(blocks.map(normalizeBlock))); return true; } catch { return false; }
}

/** The rule "ignore this endpoint" / "ignore this host" of a network log entry ({ method, scheme, host, port, path }): { scope, method, url | host }. */
export function blockRuleOf(scope, entry) {
  const hostPort = `${String(entry.host ?? '')}${entry.port && ![80, 443].includes(Number(entry.port)) ? ':' + entry.port : ''}`;
  if (scope === 'host') return { scope: 'host', host: hostPort };
  const scheme = entry.scheme === 'http' || entry.scheme === 'https' ? entry.scheme : 'https';
  return { scope: 'endpoint', method: String(entry.method ?? 'ANY').toUpperCase(), url: `${scheme}://${hostPort}${String(entry.path ?? '/').split('?')[0] || '/'}`, query: 'ignore' };
}
/** Is a rule of the list already the same (scope + method + url, or scope + host)? -> its index or -1. */
export function findBlock(blocks, rule) {
  const wanted = normalizeBlock(rule);
  return blocks.findIndex(block => block.scope === wanted.scope && (wanted.scope === 'host' ? block.host.toLowerCase() === wanted.host.toLowerCase() : block.method === wanted.method && block.url === wanted.url && block.query === wanted.query));
}
