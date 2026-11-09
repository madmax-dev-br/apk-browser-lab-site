// "Redirecionar hosts" (Controles): a list of from -> to rules that sends the app's requests for one host to another, like an /etc/hosts entry that may also change the port and the scheme.
// The app never sees the change: its URL, its Host-dependent logic, cookies and the network policy (allow list) all keep the original host; only the exchange the browser makes goes to the
// target. The network log shows both. DOM-free and no process.*: used by the page, the Worker and the network worker.
//   from: "host", "*.suffix" (any subdomain), optionally ":port" (only that port)
//   to:   "host", "host:port", or "http://host[:port]" / "https://host[:port]" (also changes the scheme)
const MAX_RULES = 50;
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const IPV6 = /^\[[0-9a-f:.]+\]$/i;

function splitHostPort(text) {
  const match = /^(\[[^\]]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(text);
  if (!match) return null;
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { host: match[1].toLowerCase(), port };
}

/** One rule from the panel: { from, to, enabled } with `error` when it cannot be used (the reason, in Portuguese, for the panel). */
export function parseRule(rule) {
  const from = String(rule?.from ?? '').trim(), to = String(rule?.to ?? '').trim(), enabled = rule?.enabled !== false;
  if (!from && !to) return { from, to, enabled, empty: true };
  const source = splitHostPort(from.toLowerCase());
  if (!source || !(HOST.test(source.host) || IPV6.test(source.host))) return { from, to, enabled, error: 'Origem inválida: use host, *.dominio ou host:porta.' };
  let scheme = null, rest = to;
  const schemeMatch = /^(https?):\/\/(.*)$/i.exec(to);
  if (schemeMatch) { scheme = schemeMatch[1].toLowerCase(); rest = schemeMatch[2].replace(/\/+$/, ''); }
  if (rest.includes('/')) return { from, to, enabled, error: 'Destino inválido: só host, host:porta ou http(s)://host:porta (sem caminho).' };
  const target = splitHostPort(rest);
  if (!target || target.host.startsWith('*.') || !(HOST.test(target.host) || IPV6.test(target.host))) return { from, to, enabled, error: 'Destino inválido: use host, host:porta ou http(s)://host:porta.' };
  return { from, to, enabled, source, target: { ...target, scheme } };
}

/** The rules as stored in the device settings: at most 50, each { from, to, enabled } (strings trimmed). Invalid rules are kept so the panel can show them, and ignored by mapUrl. */
export function sanitizeHostMap(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_RULES).map(rule => ({ from: String(rule?.from ?? '').trim().slice(0, 260), to: String(rule?.to ?? '').trim().slice(0, 300), enabled: rule?.enabled !== false }));
}

const matches = (source, host, port) => {
  if (source.port !== null && source.port !== port) return false;
  if (source.host.startsWith('*.')) { const suffix = source.host.slice(1); return host.endsWith(suffix) && host.length > suffix.length; }
  return host === source.host;
};

/** The URL the exchange goes to for `url` under `rules`: { url, rule } for the first enabled rule that matches, or null (the original URL is used). */
export function mapUrl(url, rules) {
  if (!Array.isArray(rules) || !rules.length) return null;
  let parsed; try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase(), port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  for (const raw of rules) {
    if (raw?.enabled === false) continue;
    const rule = parseRule(raw); if (rule.error || rule.empty) continue;
    if (!matches(rule.source, host, port)) continue;
    const next = new URL(parsed.href);
    if (rule.target.scheme) next.protocol = rule.target.scheme + ':';
    next.hostname = rule.target.host;
    next.port = rule.target.port !== null ? String(rule.target.port) : (rule.target.scheme ? '' : parsed.port);
    return { url: next.href, rule: `${rule.from} → ${rule.to}` };
  }
  return null;
}
