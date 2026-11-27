// The device's TLS client identity (mTLS) for the hosts the device settings name (network.clientCertHosts). What the identity is, is the app's: at the handshake of a TLS socket to one of
// those hosts the lab asks the KeyManager of the app's SSLContext, as Conscrypt does when a server sends a CertificateRequest (X509KeyManager.chooseClientAlias, then getPrivateKey and
// getCertificateChain; src/tls-socket-host.js). The browser cannot present a client certificate, so the identity goes to the APK Lab Relay (apk-lab-relay's src/relay.cjs, its
// token-protected channel), only for that destination; the relay keeps it in memory and presents it to that host and port, on the HTTPS path and on the TLS tunnel.
// The private key is the app's own: a key it loaded (PKCS12/BKS: PrivateKey.getEncoded is its PKCS#8) or a key in the AndroidKeyStore, whose material the lab's software KeyMint
// holds (framework-aosp/lab-java-jca/dev/apkweb/keystore, its "LKS1" database in the virtual filesystem). No process.*.

/** 'host:port' of a destination as the relay keys identities (host lowercased, IPv6 brackets dropped, the default port of https filled in). */
export const destination = (host, port = 443) => `${String(host).toLowerCase().replace(/^\[|\]$/g, '')}:${Number(port) || 443}`;
export const destinationOfUrl = url => { try { const u = new URL(url); return u.protocol === 'https:' ? destination(u.hostname, u.port || 443) : null; } catch { return null; } };

/** True when `host`/`port` is one of the configured client-certificate hosts: `host` (any port) or `host:port`; `*.example.com` matches subdomains. */
export function clientCertHostMatches(rules, host, port) {
  const name = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  for (const raw of rules ?? []) {
    const rule = String(raw).trim().toLowerCase(); if (!rule) continue;
    const withPort = /^\[(.+)\]:(\d+)$/.exec(rule) ?? /^([^:]+):(\d+)$/.exec(rule);   // [v6]:port or name:port; anything else is a host (an IPv6 literal without brackets has no port)
    const ruleHost = (withPort ? withPort[1] : rule).replace(/^\[|\]$/g, ''), rulePort = withPort ? Number(withPort[2]) : null;
    if (rulePort !== null && rulePort !== Number(port)) continue;
    if (ruleHost === name || (ruleHost.startsWith('*.') && name.endsWith(ruleHost.slice(1)))) return true;
  }
  return false;
}

/**
 * The entries of the lab KeyMint's database file (KeyDatabase.save: "LKS1", nextId, count, then per entry id, uid, alias (modified UTF-8), algorithm, keySize, origin, material,
 * certificate, chain (int length + bytes, -1 = null), created, modified, and its KeyParameters). -> [{ id, uid, alias, algorithm, material, certificate, chain }]; [] when absent or unreadable.
 */
export function parseLabKeystore(bytes) {
  if (!bytes || bytes.length < 16) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let at = 0;
  const int = () => { const v = view.getInt32(at); at += 4; return v; }, long = () => { at += 8; }, blob = () => { const n = int(); if (n < 0) return null; const out = bytes.slice(at, at + n); at += n; return out; };
  const utf = () => { const n = view.getUint16(at); at += 2; const out = new TextDecoder().decode(bytes.subarray(at, at + n)); at += n; return out; };   // modified UTF-8: identical to UTF-8 for aliases without NUL or supplementary characters
  try {
    if (int() !== 0x4c4b5331) return [];
    long(); const count = int(), entries = [];
    for (let i = 0; i < count; i++) {
      const high = int(), id = high * 2 ** 32 + (int() >>> 0), uid = int(), alias = utf(), algorithm = int(); int(); int();
      const material = blob(), certificate = blob(), chain = blob(); long(); long();
      for (let n = int(), j = 0; j < n; j++) {   // KeyParameters: tag, kind, value by kind (KeyParameterValue: 10 boolValue, 12 longInteger, 13 dateTime, 14 blob, else an int)
        int(); const kind = int();
        if (kind === 10) at += 1; else if (kind === 12 || kind === 13) at += 8; else if (kind === 14) blob(); else at += 4;
      }
      entries.push({ id, uid, alias, algorithm, material, certificate, chain });
    }
    return entries;
  } catch { return []; }
}

/**
 * The line under the mTLS field: { state: 'off' | 'on' | 'ok' | 'warn' | 'error', label, text }.
 * `hosts` the configured client-certificate hosts, `auto` the automatic mode (the app's own certificate for any host, when the app built its SSLContext with a KeyManager),
 * `proxyUrl` the proxy in use, `entries` what the running device did (NetworkBridge.clientIdentitySummary, from vmHealth; null without an app), `now` the clock (ms).
 */
export function clientIdentityStatus({ hosts = [], auto = false, proxyUrl = '', entries = null, now = Date.now() } = {}) {
  if (!hosts.length && !auto) return { state: 'off', label: 'Off', text: 'mTLS off: no client certificate host is listed and the automatic mode is off.' };
  const scope = [auto ? 'automatic (the certificate the app itself sets up)' : null, hosts.length ? `for ${hosts.join(', ')}` : null].filter(Boolean).join(' and ');
  if (!proxyUrl) return { state: 'warn', label: 'On, not working', text: `mTLS on, ${scope}, but no relay is the Proxy: the browser cannot present a client certificate by itself.` };
  const seen = entries ?? [];
  if (!seen.length) return { state: 'on', label: auto && !hosts.length ? 'Automatic' : 'On, waiting', text: `mTLS on, ${scope}. Nothing used it yet: it works once the app opens a TLS connection with its client certificate.` };
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const validity = entry => entry.notAfter === null || entry.notAfter === undefined ? '' : entry.notAfter <= now ? `, EXPIRED on ${day(entry.notAfter)}` : `, valid until ${day(entry.notAfter)}`;
  const expired = entry => entry.notAfter !== null && entry.notAfter !== undefined && entry.notAfter <= now;
  const describe = entry => {
    const who = `${entry.alias ? `alias "${entry.alias}"` : 'the app'}${entry.subject ? ` (CN=${entry.subject}${validity(entry)})` : validity(entry) ? ` (${validity(entry).slice(2)})` : ''}`, found = entry.auto ? ' [found by itself]' : '';
    if (entry.state === 'presented') return `${entry.dest}${found}: ${who} presented (${entry.uses} request${entry.uses === 1 ? '' : 's'})${entry.without ? `; other connections to it offered none (${entry.without})` : ''}`;
    if (entry.state === 'pending') return `${entry.dest}${found}: ${who}, handing to the relay`;
    if (entry.state === 'none') return `${entry.dest}: the app offered no certificate (${entry.detail})`;
    return `${entry.dest}${found}: ${who} NOT presented (${entry.detail})`;
  };
  const text = seen.map(describe).join('; ');
  if (seen.some(entry => entry.state === 'failed' || entry.state === 'no-relay')) return { state: 'error', label: 'On, failing', text: `mTLS: ${text}.` };
  if (seen.some(entry => expired(entry))) return { state: 'warn', label: 'Certificate expired', text: `mTLS: ${text}. The server refuses an expired certificate: the app has to renew it (as on a phone).` };
  if (seen.some(entry => entry.state === 'presented')) return { state: 'ok', label: seen.every(entry => entry.auto || entry.state !== 'presented') ? 'Automatic, working' : 'On, working', text: `mTLS working: ${text}.` };
  if (seen.every(entry => entry.state === 'none')) return { state: 'warn', label: 'On, no certificate', text: `mTLS on: ${text}.` };
  return { state: 'on', label: 'On, connecting', text: `mTLS: ${text}.` };
}

const base64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
/** A short fingerprint of an identity (the leaf certificate's bytes), to register each identity once. */
export const identityKey = identity => { const leaf = identity.chain[0]; let h = 0x811c9dc5; for (const b of leaf) h = Math.imul(h ^ b, 0x01000193) >>> 0; return `${leaf.length}:${h.toString(16)}`; };

/** The relay's answer when a request names an identity (client-identity-key) the relay does not hold for its destination: it was restarted (identities live in its memory only). */
export const NO_IDENTITY_CODE = 'APKWEB_RELAY_NO_CLIENT_IDENTITY';
/** The relay URL for `target` (the proxy's {url} placeholder, or appended), plus `extra` query parameters for the relay itself. */
export function relayUrl(proxyUrl, target, extra = {}) {
  let url = proxyUrl.includes('{url}') ? proxyUrl.replace('{url}', encodeURIComponent(target)) : proxyUrl + encodeURIComponent(target);
  for (const [name, value] of Object.entries(extra)) url += `${url.includes('?') ? '&' : '?'}${name}=${encodeURIComponent(value)}`;
  return url;
}
/** True when a relay's answer says it keeps client identities (apk-lab-relay's src/relay.cjs `x-apkweb-relay-features`); any other server would forward the POST to the destination. */
const keepsIdentities = response => response.status === 204 && /(^|[\s,])client-identity([\s,]|$)/.test(response.headers?.get?.('x-apkweb-relay-features') ?? '');

/**
 * Tells the relay to forget every client identity (a new session: what a previous one handed over must not reach a host this session does not list). Resolves { supported, reason }:
 * supported when the relay answered as one that keeps identities; otherwise no identity may be sent to it (reason says why). Never rejects.
 */
export async function forgetClientIdentities({ proxyUrl, fetch: fetchFunction = globalThis.fetch }) {
  let response;
  try { response = await fetchFunction(relayUrl(proxyUrl, 'https://client-identity.invalid/', { 'client-identity': 'forget-all' }), { method: 'POST', body: '', headers: [['content-type', 'text/plain']], credentials: 'omit', cache: 'no-store' }); }
  catch (error) { return { supported: false, reason: `the relay did not answer (${String(error?.message ?? error).slice(0, 120)}): is it running?` }; }
  try { await response.body?.cancel?.(); } catch { /* ignored */ }
  return keepsIdentities(response) ? { supported: true, reason: null } : { supported: false, reason: `the Proxy is not a relay that keeps client certificates (answer ${response.status}): use the APK Lab Relay (github.com/madmax-dev-br/apk-lab-relay); the key was not sent` };
}
/** POSTs the identity for `dest` to the relay (its token-protected channel). Resolves when the relay stored it; rejects with the relay's answer otherwise. */
export async function registerClientIdentity({ proxyUrl, fetch: fetchFunction = globalThis.fetch, dest, identity }) {
  const target = `https://${dest.replace(/:443$/, '')}/`;
  const body = JSON.stringify(identity ? { key: base64(identity.key), chain: identity.chain.map(base64) } : { chain: [] });
  const response = await fetchFunction(relayUrl(proxyUrl, target, { 'client-identity': '1' }), { method: 'POST', body, headers: [['content-type', 'text/plain']], credentials: 'omit', cache: 'no-store' });
  if (response.status !== 204) { const text = await response.text().catch(() => ''); throw new Error(`the relay did not accept the client identity for ${dest}: ${response.status} ${text.slice(0, 200)}`); }
}
