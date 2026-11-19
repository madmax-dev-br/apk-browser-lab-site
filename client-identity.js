// The device's TLS client identity (mTLS) for the hosts the device settings name (network.clientCertHosts). What the identity is, is the app's: at the handshake of a TLS socket to one of
// those hosts the lab asks the KeyManager of the app's SSLContext, as Conscrypt does when a server sends a CertificateRequest (X509KeyManager.chooseClientAlias, then getPrivateKey and
// getCertificateChain; src/tls-socket-host.js). The browser cannot present a client certificate, so the identity goes to the APK Lab Relay (scripts/cors-relay.mjs, its
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
 * `hosts` the configured client-certificate hosts, `proxyUrl` the proxy in use, `entries` what the running device did (NetworkBridge.clientIdentitySummary, from vmHealth; null without an app).
 */
export function clientIdentityStatus({ hosts = [], proxyUrl = '', entries = null } = {}) {
  if (!hosts.length) return { state: 'off', label: 'Off', text: 'mTLS off: no client certificate host is listed.' };
  const list = hosts.join(', ');
  if (!proxyUrl) return { state: 'warn', label: 'On, not working', text: `mTLS on for ${list}, but no relay is set as the Proxy: the browser cannot present a client certificate by itself.` };
  const seen = entries ?? [];
  if (!seen.length) return { state: 'on', label: 'On, waiting', text: `mTLS on for ${list}. Nothing used it yet: it works once the app opens a TLS connection to one of these hosts.` };
  const describe = entry => {
    const who = entry.alias ? `alias "${entry.alias}"` : 'the app';
    if (entry.state === 'presented') return `${entry.dest}: ${who} presented (${entry.uses} request${entry.uses === 1 ? '' : 's'})${entry.without ? `; other connections to it offered none (${entry.without})` : ''}`;
    if (entry.state === 'pending') return `${entry.dest}: ${who}, handing to the relay`;
    if (entry.state === 'none') return `${entry.dest}: the app offered no certificate (${entry.detail})`;
    return `${entry.dest}: ${who} NOT presented (${entry.detail})`;
  };
  const text = seen.map(describe).join('; ');
  if (seen.some(entry => entry.state === 'failed' || entry.state === 'no-relay')) return { state: 'error', label: 'On, failing', text: `mTLS: ${text}.` };
  if (seen.some(entry => entry.state === 'presented')) return { state: 'ok', label: 'On, working', text: `mTLS working: ${text}.` };
  if (seen.every(entry => entry.state === 'none')) return { state: 'warn', label: 'On, no certificate', text: `mTLS on: ${text}.` };
  return { state: 'on', label: 'On, connecting', text: `mTLS: ${text}.` };
}

const base64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(text); };
/** A short fingerprint of an identity (the leaf certificate's bytes), to register each identity once. */
export const identityKey = identity => { const leaf = identity.chain[0]; let h = 0x811c9dc5; for (const b of leaf) h = Math.imul(h ^ b, 0x01000193) >>> 0; return `${leaf.length}:${h.toString(16)}`; };

/** Tells the relay to forget every client identity (a new session: what a previous one handed over must not reach a host this session does not list). Errors are the caller's to ignore. */
export async function forgetClientIdentities({ proxyUrl, fetch: fetchFunction = globalThis.fetch }) {
  const probe = 'https://client-identity.invalid/', url = (proxyUrl.includes('{url}') ? proxyUrl.replace('{url}', encodeURIComponent(probe)) : proxyUrl + encodeURIComponent(probe)) + '&client-identity=forget-all';
  const response = await fetchFunction(url, { method: 'POST', body: '', headers: [['content-type', 'text/plain']], credentials: 'omit', cache: 'no-store' });
  await response.body?.cancel?.();
}
/** POSTs the identity for `dest` to the relay (its token-protected channel). Resolves when the relay stored it; rejects with the relay's answer otherwise. */
export async function registerClientIdentity({ proxyUrl, fetch: fetchFunction = globalThis.fetch, dest, identity }) {
  const target = `https://${dest.replace(/:443$/, '')}/`;
  const url = (proxyUrl.includes('{url}') ? proxyUrl.replace('{url}', encodeURIComponent(target)) : proxyUrl + encodeURIComponent(target)) + '&client-identity=1';
  const body = JSON.stringify(identity ? { key: base64(identity.key), chain: identity.chain.map(base64) } : { chain: [] });
  const response = await fetchFunction(url, { method: 'POST', body, headers: [['content-type', 'text/plain']], credentials: 'omit', cache: 'no-store' });
  if (response.status !== 204) { const text = await response.text().catch(() => ''); throw new Error(`the relay did not accept the client identity for ${dest}: ${response.status} ${text.slice(0, 200)}`); }
}
