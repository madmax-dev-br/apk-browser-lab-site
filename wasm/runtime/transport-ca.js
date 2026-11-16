// The lab transport CA: the certificates an SSLSocket over a virtual HTTP socket presents.
//
// The browser does the real TLS (fetch); the bytes between an app's SSLSocket and the virtual HTTP socket (src/virtual-http-socket.js) are plain HTTP. An SSLSocket must still hand
// the app a session with a peer certificate chain, because TLS clients verify host names against the *peer certificate's subject alternative names* (OkHttp's OkHostnameVerifier,
// HttpsURLConnection's default verifier, certificate pinners). This is exactly what a debugging proxy does: the lab generates, per session, a certificate authority
// ("APK Web Lab transport CA", ECDSA P-256, WebCrypto SubtleCrypto) and per host a leaf certificate signed by it (SAN = the host, 90 days). The chain is the lab's, never the server's: it
// says nothing about the real server's certificate (the browser validated that one), an app that pins certificates or installs a TrustManager that rejects the lab CA fails with its own
// exception, as it would behind a proxy, and the lab's default TrustManager accepts this CA only (a chain made of certificates this authority issued).
//
// The DER is hand-encoded here (a minimal ASN.1 writer); parsing is left to the platform's CertificateFactory (BoringSSL), so the certificates the app sees are real X509Certificate objects.
// No VM state in this module: it is driven through promises, which src/security-host.js waits on through the scheduler.
const encoder = new TextEncoder();
const concat = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const lengthBytes = n => n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 255] : [0x83, n >> 16, (n >> 8) & 255, n & 255];
const tlv = (tag, ...parts) => { const body = concat(parts); return concat([Uint8Array.of(tag), Uint8Array.from(lengthBytes(body.length)), body]); };

/** A minimal DER encoder: just the types an X.509 certificate with extensions uses. */
export const der = {
  seq: (...parts) => tlv(0x30, ...parts), set: (...parts) => tlv(0x31, ...parts),
  /** [n] EXPLICIT / constructed context-specific. */
  explicit: (n, ...parts) => tlv(0xa0 | n, ...parts),
  /** [n] IMPLICIT primitive context-specific (a GeneralName). */
  implicit: (n, bytes) => tlv(0x80 | n, bytes),
  octets: bytes => tlv(0x04, bytes), bool: value => tlv(0x01, Uint8Array.of(value ? 0xff : 0x00)),
  bits: (bytes, unused = 0) => tlv(0x03, Uint8Array.of(unused), bytes),
  utf8: text => tlv(0x0c, encoder.encode(text)),
  null: () => Uint8Array.of(0x05, 0x00),
  /** A non-negative INTEGER from big-endian bytes (leading zeros trimmed, a zero byte added when the high bit is set) or a small number. */
  int(value) {
    let bytes = typeof value === 'number' ? Uint8Array.from(value === 0 ? [0] : value.toString(16).padStart(Math.ceil(value.toString(16).length / 2) * 2, '0').match(/../g).map(h => parseInt(h, 16))) : Uint8Array.from(value);
    let start = 0; while (start < bytes.length - 1 && bytes[start] === 0) start++;
    bytes = bytes.subarray(start);
    return tlv(0x02, bytes[0] & 0x80 ? concat([Uint8Array.of(0), bytes]) : bytes);
  },
  oid(text) {
    const parts = text.split('.').map(Number), out = [parts[0] * 40 + parts[1]];
    for (const part of parts.slice(2)) { const stack = [part & 0x7f]; for (let rest = part >>> 7; rest > 0; rest >>>= 7) stack.push((rest & 0x7f) | 0x80); out.push(...stack.reverse()); }
    return tlv(0x06, Uint8Array.from(out));
  },
  /** UTCTime (years 1950-2049) or GeneralizedTime, as RFC 5280 4.1.2.5 requires. */
  time(ms) {
    const d = new Date(ms), pad = (n, w = 2) => String(n).padStart(w, '0'), year = d.getUTCFullYear(), rest = `${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    return year < 2050 ? tlv(0x17, encoder.encode(`${pad(year % 100)}${rest}`)) : tlv(0x18, encoder.encode(`${pad(year, 4)}${rest}`));
  },
};
const OID = { cn: '2.5.4.3', org: '2.5.4.10', ecdsaSha256: '1.2.840.10045.4.3.2', basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', extKeyUsage: '2.5.29.37', san: '2.5.29.17', ski: '2.5.29.14', aki: '2.5.29.35', serverAuth: '1.3.6.1.5.5.7.3.1' };
const name = (cn, org = 'APK Web Lab') => der.seq(der.set(der.seq(der.oid(OID.org), der.utf8(org))), der.set(der.seq(der.oid(OID.cn), der.utf8(cn))));
const extension = (oid, critical, value) => der.seq(der.oid(oid), ...(critical ? [der.bool(true)] : []), der.octets(value));
/** WebCrypto's ECDSA signature is r || s; X.509 wants DER ECDSA-Sig-Value. */
const derSignature = raw => { const half = raw.length / 2; return der.seq(der.int(raw.subarray(0, half)), der.int(raw.subarray(half))); };
const ipBytes = host => {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) { const parts = host.split('.').map(Number); return parts.every(n => n < 256) ? Uint8Array.from(parts) : null; }
  if (!host.includes(':')) return null;
  const halves = host.replace(/^\[|\]$/g, '').split('::'); if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [], tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [], zeros = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(0, zeros)).fill('0'), ...tail]; if (groups.length !== 8 || groups.some(g => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
  return Uint8Array.from(groups.flatMap(g => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255]));
};

export const CA_COMMON_NAME = 'APK Web Lab transport CA';
export const DAY = 24 * 60 * 60 * 1000;
export const LEAF_VALIDITY_MS = 90 * DAY, CA_VALIDITY_MS = 365 * DAY;
const hexOf = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

/**
 * One authority per session. `prepare(host)` resolves the host's chain once (cached); `entry(host)` is the synchronous answer once it did. `isLabChain(ders)` is the default trust
 * decision: every certificate in the chain was issued by this authority (the leaf byte for byte, the issuer byte for byte the CA).
 */
export class TransportAuthority {
  constructor({ subtle = globalThis.crypto?.subtle, random = bytes => globalThis.crypto.getRandomValues(bytes), now = () => Date.now(), track = promise => promise } = {}) {
    this.subtle = subtle; this.random = random; this.now = now; this.track = track;
    this.ca = null; this.leafKey = null; this.leaves = new Map(); this.issued = new Set(); this.starting = null; this.startFailed = false; this.jobs = new Map(); this.failures = new Map();
  }
  get available() { return !!this.subtle; }
  /** The CA certificate (DER) once started. */
  get caDer() { return this.ca?.der ?? null; }
  entry(host) { return this.leaves.get(String(host).toLowerCase()) ?? null; }
  /** Starts (once) the CA and leaf key generation; resolves when the authority can sign. */
  start() {
    if (!this.subtle) return Promise.reject(Object.assign(new Error('WebCrypto SubtleCrypto is not available: the lab transport CA cannot be generated'), { kind: 'webcrypto-unavailable' }));
    this.starting ??= this.track((async () => {
      const algorithm = { name: 'ECDSA', namedCurve: 'P-256' }, sign = { name: 'ECDSA', hash: 'SHA-256' };
      const caKeys = await this.subtle.generateKey(algorithm, true, ['sign', 'verify']), leafKeys = await this.subtle.generateKey(algorithm, true, ['sign', 'verify']);
      const caSpki = new Uint8Array(await this.subtle.exportKey('spki', caKeys.publicKey)), caKeyId = new Uint8Array(await this.subtle.digest('SHA-1', caSpki));
      const notBefore = Math.floor(this.now() / 1000) * 1000, notAfter = notBefore + CA_VALIDITY_MS, subject = name(CA_COMMON_NAME);
      const tbs = der.seq(der.explicit(0, der.int(2)), der.int(this.serial()), der.seq(der.oid(OID.ecdsaSha256)), subject, der.seq(der.time(notBefore), der.time(notAfter)), subject, caSpki,
        der.explicit(3, der.seq(
          extension(OID.basicConstraints, true, der.seq(der.bool(true))), extension(OID.keyUsage, true, der.bits(Uint8Array.of(0x06), 1)), extension(OID.ski, false, der.octets(caKeyId)))));
      const signature = derSignature(new Uint8Array(await this.subtle.sign(sign, caKeys.privateKey, tbs)));
      const caDer = der.seq(tbs, der.seq(der.oid(OID.ecdsaSha256)), der.bits(signature));
      this.ca = { der: caDer, subject, keyId: caKeyId, privateKey: caKeys.privateKey, notBefore, notAfter };
      const leafSpki = new Uint8Array(await this.subtle.exportKey('spki', leafKeys.publicKey));
      this.leafKey = { spki: leafSpki, keyId: new Uint8Array(await this.subtle.digest('SHA-1', leafSpki)) };
      this.issued.add(hexOf(caDer));
      return this.ca;
    })());
    this.starting.catch(error => { this.startFailed = true; this.startError = error; });
    return this.starting;
  }
  /** The error that stopped the chain of `host` (or the authority's start), or null. */
  failure(host) { return this.failures.get(String(host).toLowerCase()) ?? (this.startFailed ? this.startError ?? new Error('the authority could not start') : null); }
  serial() { const bytes = new Uint8Array(16); this.random(bytes); bytes[0] &= 0x7f; if (bytes[0] === 0) bytes[0] = 1; return bytes; }
  /** The chain presented for `host`: { host, leafDer, caDer, notBefore, notAfter }. */
  prepare(hostName) {
    const host = String(hostName).toLowerCase(), have = this.leaves.get(host); if (have) return Promise.resolve(have);
    this.failures.delete(host);
    let job = this.jobs.get(host);
    if (!job) {
      job = this.track((async () => {
        await this.start();
        const ip = ipBytes(host), generalName = ip ? der.implicit(7, ip) : der.implicit(2, encoder.encode(host));
        const notBefore = Math.floor(this.now() / 1000) * 1000, notAfter = Math.min(notBefore + LEAF_VALIDITY_MS, this.ca.notAfter);
        const tbs = der.seq(der.explicit(0, der.int(2)), der.int(this.serial()), der.seq(der.oid(OID.ecdsaSha256)), this.ca.subject, der.seq(der.time(notBefore), der.time(notAfter)), name(host.length > 64 ? host.slice(0, 64) : host), this.leafKey.spki,
          der.explicit(3, der.seq(
            extension(OID.basicConstraints, true, der.seq()), extension(OID.keyUsage, true, der.bits(Uint8Array.of(0x80), 7)), extension(OID.extKeyUsage, false, der.seq(der.oid(OID.serverAuth))),
            extension(OID.san, false, der.seq(generalName)), extension(OID.ski, false, der.octets(this.leafKey.keyId)), extension(OID.aki, false, der.seq(der.implicit(0, this.ca.keyId))))));
        const signature = derSignature(new Uint8Array(await this.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.ca.privateKey, tbs)));
        const leafDer = der.seq(tbs, der.seq(der.oid(OID.ecdsaSha256)), der.bits(signature));
        const entry = { host, leafDer, caDer: this.ca.der, notBefore, notAfter }; this.leaves.set(host, entry); this.issued.add(hexOf(leafDer)); this.jobs.delete(host);
        return entry;
      })());
      job.catch(error => { this.jobs.delete(host); this.failures.set(host, error); });
      this.jobs.set(host, job);
    }
    return job;
  }
  /** True when every certificate of the chain (DER byte arrays, leaf first) is one this authority issued (the leaf, and the CA that signed it). */
  isLabChain(ders) { return ders.length > 0 && !!this.ca && ders.every(item => this.issued.has(hexOf(item))); }
}
