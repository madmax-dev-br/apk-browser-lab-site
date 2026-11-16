// "Redirecionar hosts" (Controles): a list of from -> to rules that sends the app's requests for one host to another, like an /etc/hosts entry that may also change the port and the scheme.
// The app never sees the change: its URL, its Host-dependent logic and cookies keep the original host; only the exchange the browser makes goes to the target. A request a rule
// redirects is not refused by the allow list (the rule names where it may go), but the offline state still applies (a redirected request still uses the network, unlike a mock).
// Never silent: every redirected request is counted per rule (responses and failures), the first one per rule writes a Logcat warning, the network log marks the entry, and the
// Resumo lists the active rules. DOM-free and no process.*: used by the page, the Worker and the network worker.
//   from: "host", "*.suffix" (any subdomain), optionally ":port" (only that port), optionally "http://" / "https://" (only that scheme); a trailing "/" or "/*" is ignored
//   to:   "host", "host:port", or "http://host[:port]" / "https://host[:port]" (also changes the scheme). Without a scheme a loopback target (localhost, *.localhost, 127.0.0.0/8,
//         [::1]) is http (a local development server), any other target keeps the app's scheme.
const MAX_RULES = 50;
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const IPV6 = /^\[[0-9a-f:.]+\]$/i;

/** localhost, *.localhost, 127.0.0.0/8 and [::1]: a server on the machine that runs the browser. */
export const isLoopbackHost = host => { const name = String(host ?? '').toLowerCase(); return name === 'localhost' || name.endsWith('.localhost') || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name) || name === '[::1]' || name === '::1'; };

function splitHostPort(text) {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(text);
  if (!match) return null;
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { host: match[1].toLowerCase(), port };
}
/** "scheme://rest/" -> { scheme | null, rest } with a trailing "/" or "/*" dropped; `path` when something after the host remains. */
function splitScheme(text) {
  let scheme = null, rest = text;
  const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(text);
  if (match) { scheme = match[1].toLowerCase(); rest = match[2]; }
  rest = rest.replace(/\/\*?$/, '');
  return { scheme, rest, path: rest.includes('/') };
}

/** The key a rule's hit counts are kept under (Worker) and looked up with (panel): its text, trimmed, the source in lower case. */
export const ruleKey = rule => `${String(rule?.from ?? '').trim().toLowerCase()} -> ${String(rule?.to ?? '').trim()}`;

/** One rule from the panel: { from, to, enabled } with `error` when it cannot be used (the reason, for the panel). */
export function parseRule(rule) {
  const from = String(rule?.from ?? '').trim(), to = String(rule?.to ?? '').trim(), enabled = rule?.enabled !== false;
  if (!from && !to) return { from, to, enabled, empty: true };
  const left = splitScheme(from.toLowerCase());
  if (left.scheme && left.scheme !== 'http' && left.scheme !== 'https') return { from, to, enabled, error: `Invalid source: the scheme ${left.scheme}:// is not HTTP; use http://, https:// or just the host.` };
  if (left.path) return { from, to, enabled, error: 'A source with a path is not supported: use just the host (e.g. https://api.example.com, api.example.com:8443 or *.example.com); the request path is kept.' };
  const source = splitHostPort(left.rest);
  if (!source || !(HOST.test(source.host) || IPV6.test(source.host))) return { from, to, enabled, error: 'Invalid source: use a host, *.domain, host:port or https://host.' };
  source.scheme = left.scheme;
  if (!to) return { from, to, enabled, error: 'The target is missing: host, host:port or http://host:port.' };
  const right = splitScheme(to);
  if (right.scheme && right.scheme !== 'http' && right.scheme !== 'https') return { from, to, enabled, error: `Invalid target: the scheme ${right.scheme}:// is not HTTP; use http:// or https://.` };
  if (right.path) return { from, to, enabled, error: 'Invalid target: only a host, host:port or http(s)://host:port (no path).' };
  const target = splitHostPort(right.rest);
  if (!target || target.host.startsWith('*.') || !(HOST.test(target.host) || IPV6.test(target.host))) return { from, to, enabled, error: 'Invalid target: use a host, host:port or http(s)://host:port.' };
  // A target without a scheme: loopback is a local development server (plain http); anything else keeps the app's scheme.
  const scheme = right.scheme ?? (isLoopbackHost(target.host) ? 'http' : null);
  return { from, to, enabled, source, target: { ...target, scheme, schemeDefaulted: !right.scheme && scheme !== null } };
}

/** The effective URL shape of a parsed rule, for the panel and the Resumo: "https://api.exemplo.com/* → http://localhost:8080/*". */
export function describeRule(parsed) {
  if (!parsed?.source || !parsed?.target) return '';
  const { source, target } = parsed;
  const left = `${source.scheme ?? 'http(s)'}://${source.host}${source.port !== null ? ':' + source.port : ''}/*`;
  const keepsPort = target.port === null && (target.scheme === null || (target.schemeDefaulted && source.scheme !== 'https'));
  const port = target.port !== null ? ':' + target.port : keepsPort && source.port !== null && (target.scheme === null || source.scheme === target.scheme) ? ':' + source.port : '';
  const right = `${target.scheme ?? (source.scheme ?? 'http(s)')}://${target.host}${port}/*`;
  const notes = [];
  if (target.scheme === null && source.scheme === null) notes.push('same scheme as the app');
  if (keepsPort && (source.port === null || (target.schemeDefaulted && source.scheme === null))) notes.push(target.schemeDefaulted ? 'the app port when it is http' : 'same port as the app');
  return `${left} → ${right}${notes.length ? ` (${notes.join(', ')})` : ''}`;
}

/** The rules as stored in the device settings: at most 50, each { from, to, enabled } (strings trimmed). Invalid rules are kept so the panel can show them, and ignored by mapUrl. */
export function sanitizeHostMap(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_RULES).map(rule => ({ from: String(rule?.from ?? '').trim().slice(0, 260), to: String(rule?.to ?? '').trim().slice(0, 300), enabled: rule?.enabled !== false }));
}

const matches = (source, host, port, scheme = null) => {
  if (source.scheme && scheme && source.scheme !== scheme) return false;
  if (source.port !== null && port !== null && source.port !== Number(port)) return false;
  const name = String(host).toLowerCase(), wanted = source.host.replace(/^\[|\]$/g, ''), plain = name.replace(/^\[|\]$/g, '');
  if (source.host.startsWith('*.')) { const suffix = source.host.slice(1); return plain.endsWith(suffix) && plain.length > suffix.length; }
  return plain === wanted;
};
/** The enabled, valid rules of `rules`, parsed (cached per array and re-parsed when its text changes). */
const parsedCache = new WeakMap();
function activeRules(rules) {
  if (!Array.isArray(rules) || !rules.length) return [];
  const signature = rules.map(raw => `${raw?.enabled !== false}\u0000${raw?.from ?? ''}\u0000${raw?.to ?? ''}`).join('\n'), cached = parsedCache.get(rules);
  if (cached?.signature === signature) return cached.list;
  const list = rules.filter(raw => raw?.enabled !== false).map(raw => ({ raw, parsed: parseRule(raw) })).filter(({ parsed }) => !parsed.error && !parsed.empty);
  parsedCache.set(rules, { signature, list }); return list;
}

/** The URL the exchange goes to for `url` under `rules`: { url, rule ("from → to" as typed), shape (describeRule), key (ruleKey) } for the first enabled rule that matches, or null. */
export function mapUrl(url, rules) {
  const list = activeRules(rules); if (!list.length) return null;
  let parsed; try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase(), scheme = parsed.protocol.replace(/:$/, ''), port = parsed.port ? Number(parsed.port) : scheme === 'https' ? 443 : 80;
  if (scheme !== 'http' && scheme !== 'https') return null;
  for (const { raw, parsed: rule } of list) {
    if (!matches(rule.source, host, port, scheme)) continue;
    const next = new URL(parsed.href), target = rule.target, changesScheme = target.scheme !== null && target.scheme !== scheme;
    if (target.scheme) next.protocol = target.scheme + ':';
    next.hostname = target.host;
    // No port in the target: the app's port when the scheme stays (an explicit scheme takes its default port), else the new scheme's default.
    next.port = target.port !== null ? String(target.port) : (target.scheme && !target.schemeDefaulted) || changesScheme ? '' : parsed.port;
    return { url: next.href, rule: `${rule.from} → ${rule.to}`, shape: describeRule(rule), key: ruleKey(raw) };
  }
  return null;
}

/**
 * Could a rule redirect requests for `host`(:port)? A name lookup or a socket connect does not know the scheme yet, so a scheme-only rule counts for both; the exchange itself is
 * checked again with mapUrl (a request the rule does not map meets the allow list there).
 */
export function hostMapServesHost(rules, host, port = null) {
  for (const { parsed } of activeRules(rules)) if (matches(parsed.source, host, port)) return true;
  return false;
}

// ---- the running VM (Worker): counts, Logcat, Resumo ------------------------------------------------------------------------------------------------------------------------------

/** A request a rule redirected: counted under the rule; the first one per rule writes a Logcat warning. Returns the rule's record. */
export function noteRedirect(runtime, table, mapped, request) {
  let record = table.get(mapped.key);
  if (!record) { record = { key: mapped.key, rule: mapped.rule, shape: mapped.shape, hits: 0, responses: 0, failures: 0, closed: 0, lastFailure: null }; table.set(mapped.key, record); }
  if (++record.hits === 1) runtime.record?.(`LOG W APKWebLab: host redirecionado: ${request.method} ${request.url} -> ${mapped.url}`);
  return record;
}
/** The live counts the page shows in the "Redirecionar hosts" rows: [{ key, hits, responses, failures, closed, lastFailure }]. */
export function describeRedirects(table) {
  return [...(table?.values() ?? [])].map(({ key, hits, responses, failures, closed, lastFailure }) => ({ key, hits, responses, failures, closed, lastFailure }));
}
/** Lines for the Resumo / report, or null when no rule is active. `rules`: the device's host map; `table`: the Worker's counts. */
export function hostMapSummaryLines(rules, table) {
  const active = activeRules(rules); if (!active.length) return null;
  const counts = active.map(({ raw, parsed }) => ({ shape: describeRule(parsed), record: table?.get(ruleKey(raw)) ?? null }));
  const hits = counts.reduce((sum, { record }) => sum + (record?.hits ?? 0), 0);
  const lines = [`Hosts REDIRECTED: ${active.length} ${active.length === 1 ? 'active rule' : 'active rules'} (${hits} ${hits === 1 ? 'request went' : 'requests went'} to another target; the app saw the original URL)`];
  for (const { shape, record } of counts.slice(0, 8)) lines.push(`  ${shape}: ${hitText(record)}`);
  if (counts.length > 8) lines.push(`  … and ${counts.length - 8} more`);
  return lines;
}
/** "3 responses · 1 failure" (or "no request"). */
export function hitText(record) {
  const responses = record?.responses ?? 0, failures = record?.failures ?? 0, pending = Math.max(0, (record?.hits ?? 0) - responses - failures - (record?.closed ?? 0));
  const parts = [`${responses} ${responses === 1 ? 'response' : 'responses'}`];
  if (failures) parts.push(`${failures} ${failures === 1 ? 'failure' : 'failures'}`);
  if (pending) parts.push(`${pending} in progress`);
  return parts.join(' · ');
}
