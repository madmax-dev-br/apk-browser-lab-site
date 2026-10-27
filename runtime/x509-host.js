import { APKError } from './apk-error.js?v=92e35e57822f';
import { createHostRegistry } from './host-contract.js?v=92e35e57822f';

// X.509 certificates for apps that inspect their own signing certificate or pin a server's: java.security.cert.CertificateFactory ("X.509", DER or PEM input), X509Certificate
// (subject/issuer, serial, validity, algorithms, public key, basic constraints, key usage, encoded form), javax.security.auth.x500.X500Principal (RFC 2253 / RFC 1779 / canonical
// names, DER) and a PublicKey carrying its SubjectPublicKeyInfo. The certificate is parsed from DER (X.690) in JavaScript; signature *verification* and key operations
// (verify(PublicKey), RSA/EC maths) are not implemented and fail explicitly. Contracts: java.security.cert.X509Certificate / X500Principal (android-13.0.0_r1 libcore, Conscrypt).
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', BYTES = '[B', INPUT = 'Ljava/io/InputStream;', DATE = 'Ljava/util/Date;', BIGINT = 'Ljava/math/BigInteger;', PRINCIPAL_IFACE = 'Ljava/security/Principal;';
const FACTORY = 'Ljava/security/cert/CertificateFactory;', CERT = 'Ljava/security/cert/Certificate;', X509 = 'Ljava/security/cert/X509Certificate;', X509_IMPL = 'Lcom/android/org/conscrypt/OpenSSLX509Certificate;', X500 = 'Ljavax/security/auth/x500/X500Principal;';
const PUBLIC_KEY = 'Ljava/security/PublicKey;', PUBLIC_KEY_IMPL = 'Lcom/android/org/conscrypt/OpenSSLRSAPublicKey;', CERT_EXCEPTION = 'Ljava/security/cert/CertificateException;', CERT_EXPIRED = 'Ljava/security/cert/CertificateExpiredException;', CERT_NOT_YET = 'Ljava/security/cert/CertificateNotYetValidException;';
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'x509-unsupported', ...details }); };
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

// ---- DER -------------------------------------------------------------------------------------------------------------------------------------------------
function tlv(bytes, at) {
  if (at + 2 > bytes.length) throw new Error('truncated DER');
  const tag = bytes[at]; let length = bytes[at + 1], header = 2;
  if (length & 0x80) { const n = length & 0x7f; if (n < 1 || n > 4 || at + 2 + n > bytes.length) throw new Error('bad DER length'); length = 0; for (let i = 0; i < n; i++) length = length * 256 + bytes[at + 2 + i]; header += n; }
  if (at + header + length > bytes.length) throw new Error('DER length exceeds input');
  return { tag, start: at, header, length, value: at + header, end: at + header + length };
}
const children = (bytes, node) => { const out = []; for (let at = node.value; at < node.end;) { const c = tlv(bytes, at); out.push(c); at = c.end; } return out; };
const oidOf = (bytes, node) => { const b = bytes.subarray(node.value, node.end), parts = [Math.floor(b[0] / 40), b[0] % 40]; let v = 0; for (let i = 1; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { parts.push(v); v = 0; } } return parts.join('.'); };
const bigOf = (bytes, node) => { let v = 0n; for (let i = node.value; i < node.end; i++) v = (v << 8n) | BigInt(bytes[i]); if (bytes[node.value] & 0x80) v -= 1n << BigInt(8 * (node.end - node.value)); return v; };
const stringOf = (bytes, node) => {
  const b = bytes.subarray(node.value, node.end);
  if (node.tag === 0x1e) return String.fromCharCode(...Array.from({ length: b.length / 2 }, (_x, i) => (b[2 * i] << 8) | b[2 * i + 1]));   // BMPString
  if (node.tag === 0x0c) return new TextDecoder().decode(b);   // UTF8String
  return String.fromCharCode(...b);                              // Printable/IA5/T61/Visible: one byte per character
};
function timeOf(bytes, node) {
  const s = String.fromCharCode(...bytes.subarray(node.value, node.end)); let m;
  if (node.tag === 0x17) { m = /^(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?Z$/.exec(s); if (!m) throw new Error('bad UTCTime'); const yy = +m[1]; return Date.UTC(yy >= 50 ? 1900 + yy : 2000 + yy, +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)); }
  m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?(?:\.\d+)?Z$/.exec(s); if (!m) throw new Error('bad GeneralizedTime'); return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
}
const KEYWORDS = { '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.9': 'STREET', '2.5.4.10': 'O', '2.5.4.11': 'OU', '0.9.2342.19200300.100.1.25': 'DC', '0.9.2342.19200300.100.1.1': 'UID' };
const OIDS = Object.fromEntries(Object.entries(KEYWORDS).map(([oid, k]) => [k, oid])); OIDS.EMAILADDRESS = '1.2.840.113549.1.9.1'; OIDS.SERIALNUMBER = '2.5.4.5'; OIDS.T = '2.5.4.12'; OIDS.GIVENNAME = '2.5.4.42'; OIDS.SURNAME = '2.5.4.4'; OIDS.DNQ = '2.5.4.46';
const SIGNATURE_ALGORITHMS = { '1.2.840.113549.1.1.5': 'SHA1withRSA', '1.2.840.113549.1.1.11': 'SHA256withRSA', '1.2.840.113549.1.1.12': 'SHA384withRSA', '1.2.840.113549.1.1.13': 'SHA512withRSA', '1.2.840.113549.1.1.14': 'SHA224withRSA', '1.2.840.113549.1.1.4': 'MD5withRSA',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS', '1.2.840.10045.4.1': 'SHA1withECDSA', '1.2.840.10045.4.3.1': 'SHA224withECDSA', '1.2.840.10045.4.3.2': 'SHA256withECDSA', '1.2.840.10045.4.3.3': 'SHA384withECDSA', '1.2.840.10045.4.3.4': 'SHA512withECDSA', '1.3.101.112': 'Ed25519' };
const KEY_ALGORITHMS = { '1.2.840.113549.1.1.1': 'RSA', '1.2.840.10045.2.1': 'EC', '1.3.101.112': 'Ed25519', '1.3.101.110': 'X25519', '1.2.840.113549.1.1.10': 'RSASSA-PSS' };

/** Name ::= SEQUENCE OF RelativeDistinguishedName -> [{ oid, value, tag }] per RDN list (outer = RDNs in DER order). */
function parseName(bytes, node) {
  return children(bytes, node).map(rdn => children(bytes, rdn).map(atv => { const [typeNode, valueNode] = children(bytes, atv); return { oid: oidOf(bytes, typeNode), value: stringOf(bytes, valueNode), tag: valueNode.tag, raw: bytes.slice(valueNode.start, valueNode.end) }; }));
}
const escapeValue = (value, mode) => {
  let out = ''; for (let i = 0; i < value.length; i++) { const c = value[i]; out += ',+"\\<>;'.includes(c) || (mode === 'rfc1779' && c === '=') ? '\\' + c : c; }
  if (/^[ #]/.test(out)) out = '\\' + out; if (/ $/.test(out)) out = out.slice(0, -1) + '\\ '; return out;
};
const keyword = oid => KEYWORDS[oid] ?? (oid === '1.2.840.113549.1.9.1' ? 'EMAILADDRESS' : null);
function formatName(rdns, format) {
  const ordered = [...rdns].reverse();   // RFC 2253 and RFC 1779 print the most specific RDN first, i.e. the reverse of the DER order
  const attribute = a => { const k = keyword(a.oid); return k === null ? `${a.oid}=#${hex(a.raw)}` : `${k}=${escapeValue(a.value, format)}`; };
  if (format === 'canonical') return ordered.map(rdn => rdn.map(a => `${keyword(a.oid)?.toLowerCase() ?? a.oid}=${a.value.trim().replace(/\s+/g, ' ').toLowerCase()}`).join('+')).join(',');
  return ordered.map(rdn => rdn.map(attribute).join('+')).join(format === 'rfc1779' ? ', ' : ',');
}
/** DN string (RFC 2253 / 1779) -> RDN list in DER order. */
function parseDN(text) {
  const rdns = []; let current = [], at = 0;
  const readValue = () => { let out = ''; while (at < text.length && !',;+'.includes(text[at])) { if (text[at] === '\\') { at++; out += text[at++] ?? ''; } else out += text[at++]; } return out.trim(); };
  while (at < text.length) {
    const eq = text.indexOf('=', at); if (eq < 0) throw new Error('bad DN'); const key = text.slice(at, eq).trim().toUpperCase(); at = eq + 1;
    const oid = /^\d+(\.\d+)+$/.test(key) ? key : OIDS[key]; if (!oid) throw new Error(`unknown attribute ${key}`);
    const value = readValue(); current.push({ oid, value, tag: /^[A-Za-z0-9 '()+,\-./:=?]*$/.test(value) ? 0x13 : 0x0c });
    const sep = text[at]; at++; if (sep === '+') continue; rdns.unshift(current); current = [];
  }
  if (current.length) rdns.unshift(current);
  return rdns;
}
const encodeLength = n => n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
const der = (tag, ...parts) => { const body = parts.flat(); return [tag, ...encodeLength(body.length), ...body]; };
const encodeOid = oid => { const p = oid.split('.').map(Number), out = [p[0] * 40 + p[1]]; for (const v of p.slice(2)) { const stack = [v & 0x7f]; for (let n = v >> 7; n > 0; n >>= 7) stack.push((n & 0x7f) | 0x80); out.push(...stack.reverse()); } return out; };
function encodeName(rdns) { return der(0x30, rdns.map(rdn => der(0x31, rdn.map(a => { const v = a.raw ? Array.from(a.raw) : der(a.tag, a.tag === 0x0c ? Array.from(new TextEncoder().encode(a.value)) : Array.from(a.value, c => c.charCodeAt(0))); return der(0x30, der(0x06, encodeOid(a.oid)), v); })))); }

export function parseCertificate(bytes) {
  const cert = tlv(bytes, 0); if (cert.tag !== 0x30 || cert.end !== bytes.length) throw new Error('not a DER certificate');
  const [tbs, algorithm, signature] = children(bytes, cert), fields = children(bytes, tbs); let i = 0, version = 1;
  if (fields[i].tag === 0xa0) { version = Number(bigOf(bytes, children(bytes, fields[i])[0])) + 1; i++; }
  const serial = bigOf(bytes, fields[i++]), signatureAlgorithm = oidOf(bytes, children(bytes, fields[i++])[0]), issuer = fields[i++], validity = children(bytes, fields[i++]), subject = fields[i++], spki = fields[i++];
  const extensions = new Map(); const extNode = fields.slice(i).find(f => f.tag === 0xa3);
  if (extNode) for (const e of children(bytes, children(bytes, extNode)[0])) { const parts = children(bytes, e), critical = parts.length === 3 && bytes[parts[1].value] !== 0, valueNode = parts[parts.length - 1]; extensions.set(oidOf(bytes, parts[0]), { critical, value: tlv(bytes, valueNode.value) }); }
  const spkiParts = children(bytes, spki), keyAlgorithm = oidOf(bytes, children(bytes, spkiParts[0])[0]);
  return { bytes, version, serial, signatureAlgorithm, outerAlgorithm: oidOf(bytes, children(bytes, algorithm)[0]), issuer: parseName(bytes, issuer), issuerDer: bytes.slice(issuer.start, issuer.end), subject: parseName(bytes, subject), subjectDer: bytes.slice(subject.start, subject.end),
    notBefore: timeOf(bytes, validity[0]), notAfter: timeOf(bytes, validity[1]), spki: bytes.slice(spki.start, spki.end), keyAlgorithm, extensions, signatureValue: bytes.slice(signature.value + 1, signature.end), tbs: bytes.slice(tbs.start, tbs.end) };
}

export function createX509Host(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const bytesOf = (r, ref) => Uint8Array.from(r.array(ref).elements, v => v & 255);
  const byteArray = (r, bytes) => { const a = r.newArray(BYTES, bytes.length); r.array(a).elements = Array.from(bytes, v => (v << 24) >> 24); return a; };
  type(CERT, OBJECT, ['Ljava/io/Serializable;']); type(X509, CERT); type(X509_IMPL, X509, [], { allocatable: true }); type(FACTORY, OBJECT, [], { allocatable: true });
  type(PRINCIPAL_IFACE, OBJECT); registry.interfaces.set(PRINCIPAL_IFACE, []); type(X500, OBJECT, [PRINCIPAL_IFACE, 'Ljava/io/Serializable;'], { allocatable: true });
  type(PUBLIC_KEY, OBJECT, ['Ljava/security/Key;']); registry.interfaces.set(PUBLIC_KEY, ['Ljava/security/Key;']); type(PUBLIC_KEY_IMPL, OBJECT, [PUBLIC_KEY], { allocatable: true });
  for (const name of [CERT_EXPIRED, CERT_NOT_YET]) type(name, CERT_EXCEPTION);
  const date = (r, ms) => { const d = r.allocate(DATE); r.dispatch({ owner: DATE, name: '<init>', parameters: ['J'], result: 'V', signature: '(J)V' }, [d, BigInt(ms)], 'direct'); return d; };
  const bigInteger = (r, v) => { const ref = r.allocate(BIGINT), negative = v < 0n; let mag = negative ? -v : v, h = mag.toString(16); if (h.length % 2) h = '0' + h; const bytes = Uint8Array.from(h.match(/../g) ?? ['00'], p => parseInt(p, 16)); r.dispatch({ owner: BIGINT, name: '<init>', parameters: ['I', BYTES], result: 'V', signature: `(I${BYTES})V` }, [ref, v === 0n ? 0 : negative ? -1 : 1, byteArray(r, bytes)], 'direct'); return ref; };

  // ---- X500Principal -----------------------------------------------------------------------------------------------------------------------------------
  const principal = (r, rdns) => { const ref = r.allocate(X500); r.object(ref).rdns = rdns; return ref; };
  const rdnsOf = (r, ref) => r.object(ref).rdns ?? r.throwJava('Ljava/lang/IllegalStateException;', 'X500Principal used before construction');
  def(X500, '<init>', `(${STRING})V`, (r, _m, [self, name]) => { if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'name == null'); try { r.object(self).rdns = parseDN(r.stringCharacters(name)); } catch (e) { r.throwJava('Ljava/lang/IllegalArgumentException;', `improperly specified input name: ${r.stringCharacters(name)}`); } });
  def(X500, '<init>', `(${BYTES})V`, (r, _m, [self, encoded]) => { try { const b = bytesOf(r, encoded); r.object(self).rdns = parseName(b, tlv(b, 0)); } catch (e) { r.throwJava('Ljava/lang/IllegalArgumentException;', `improperly specified input name: ${e.message}`); } });
  def(X500, 'getName', `()${STRING}`, (r, _m, [self]) => formatName(rdnsOf(r, self), 'rfc2253'));
  def(X500, 'getName', `(${STRING})${STRING}`, (r, _m, [self, format]) => { const f = r.stringCharacters(format).toUpperCase(); if (!['RFC1779', 'RFC2253', 'CANONICAL'].includes(f)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'invalid format specified'); return formatName(rdnsOf(r, self), f.toLowerCase()); });
  def(X500, 'getEncoded', `()${BYTES}`, (r, _m, [self]) => byteArray(r, encodeName(rdnsOf(r, self))));
  def(X500, 'toString', `()${STRING}`, (r, _m, [self]) => formatName(rdnsOf(r, self), 'rfc1779'));
  def(X500, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => self === other || (other !== null && r.typeOf(other) === X500 && formatName(rdnsOf(r, self), 'canonical') === formatName(rdnsOf(r, other), 'canonical')) ? 1 : 0);
  def(X500, 'hashCode', '()I', (r, _m, [self]) => { let h = 0; for (const c of formatName(rdnsOf(r, self), 'canonical')) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; });

  // ---- PublicKey ---------------------------------------------------------------------------------------------------------------------------------------
  const newKey = (r, c) => { const ref = r.allocate(PUBLIC_KEY_IMPL); Object.assign(r.object(ref), { spki: c.spki, keyAlgorithm: KEY_ALGORITHMS[c.keyAlgorithm] ?? c.keyAlgorithm }); return ref; };
  def(PUBLIC_KEY_IMPL, 'getAlgorithm', `()${STRING}`, (r, _m, [self]) => r.object(self).keyAlgorithm); def(PUBLIC_KEY_IMPL, 'getFormat', `()${STRING}`, () => 'X.509'); def(PUBLIC_KEY_IMPL, 'getEncoded', `()${BYTES}`, (r, _m, [self]) => byteArray(r, r.object(self).spki));
  def(PUBLIC_KEY_IMPL, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => other !== null && r.object(other).spki && hex(r.object(self).spki) === hex(r.object(other).spki) ? 1 : 0);
  def(PUBLIC_KEY_IMPL, 'hashCode', '()I', (r, _m, [self]) => { let h = 1; for (const b of r.object(self).spki) h = (Math.imul(h, 31) + ((b << 24) >> 24)) | 0; return h; });

  // ---- X509Certificate ---------------------------------------------------------------------------------------------------------------------------------
  const certOf = (r, ref) => r.object(ref).cert ?? r.throwJava('Ljava/lang/IllegalStateException;', 'certificate used before construction');
  const newCertificate = (r, bytes) => { let parsed; try { parsed = parseCertificate(bytes); } catch (e) { r.throwJava(CERT_EXCEPTION, `Could not parse certificate: ${e.message}`); } const ref = r.allocate(X509_IMPL); r.object(ref).cert = parsed; return ref; };
  const ALGORITHM_NAMES = oid => SIGNATURE_ALGORITHMS[oid] ?? oid;
  def(X509_IMPL, 'getSubjectX500Principal', `()${X500}`, (r, _m, [self]) => principal(r, certOf(r, self).subject)); def(X509_IMPL, 'getIssuerX500Principal', `()${X500}`, (r, _m, [self]) => principal(r, certOf(r, self).issuer));
  def(X509_IMPL, 'getSubjectDN', `()${PRINCIPAL_IFACE}`, (r, _m, [self]) => principal(r, certOf(r, self).subject)); def(X509_IMPL, 'getIssuerDN', `()${PRINCIPAL_IFACE}`, (r, _m, [self]) => principal(r, certOf(r, self).issuer));
  def(X509_IMPL, 'getSerialNumber', `()${BIGINT}`, (r, _m, [self]) => bigInteger(r, certOf(r, self).serial)); def(X509_IMPL, 'getVersion', '()I', (r, _m, [self]) => certOf(r, self).version);
  def(X509_IMPL, 'getNotBefore', `()${DATE}`, (r, _m, [self]) => date(r, certOf(r, self).notBefore)); def(X509_IMPL, 'getNotAfter', `()${DATE}`, (r, _m, [self]) => date(r, certOf(r, self).notAfter));
  const validity = (r, self, now) => { const c = certOf(r, self); if (now > c.notAfter) r.throwJava(CERT_EXPIRED, `certificate expired on ${new Date(c.notAfter).toISOString()}; current time: ${new Date(now).toISOString()}`); if (now < c.notBefore) r.throwJava(CERT_NOT_YET, `certificate not valid till ${new Date(c.notBefore).toISOString()}; current time: ${new Date(now).toISOString()}`); };
  def(X509_IMPL, 'checkValidity', '()V', (r, _m, [self]) => validity(r, self, platform.clock.wall()));
  def(X509_IMPL, 'checkValidity', `(${DATE})V`, (r, _m, [self, when]) => validity(r, self, Number(call(r, when, DATE, 'getTime', [], 'J'))));
  def(X509_IMPL, 'getSigAlgName', `()${STRING}`, (r, _m, [self]) => ALGORITHM_NAMES(certOf(r, self).signatureAlgorithm)); def(X509_IMPL, 'getSigAlgOID', `()${STRING}`, (r, _m, [self]) => certOf(r, self).signatureAlgorithm);
  def(X509_IMPL, 'getSignature', `()${BYTES}`, (r, _m, [self]) => byteArray(r, certOf(r, self).signatureValue)); def(X509_IMPL, 'getTBSCertificate', `()${BYTES}`, (r, _m, [self]) => byteArray(r, certOf(r, self).tbs));
  def(X509_IMPL, 'getPublicKey', `()${PUBLIC_KEY}`, (r, _m, [self]) => newKey(r, certOf(r, self)));
  def(X509_IMPL, 'getEncoded', `()${BYTES}`, (r, _m, [self]) => byteArray(r, certOf(r, self).bytes)); def(X509_IMPL, 'getType', `()${STRING}`, () => 'X.509');
  def(X509_IMPL, 'getBasicConstraints', '()I', (r, _m, [self]) => {
    const e = certOf(r, self).extensions.get('2.5.29.19'); if (!e) return -1; const b = certOf(r, self).bytes, parts = children(b, e.value);
    const ca = parts.length > 0 && parts[0].tag === 0x01 && b[parts[0].value] !== 0; if (!ca) return -1;
    const lengthNode = parts.find(p => p.tag === 0x02); return lengthNode ? Number(bigOf(b, lengthNode)) : 2147483647;
  });
  def(X509_IMPL, 'getKeyUsage', '()[Z', (r, _m, [self]) => {
    const e = certOf(r, self).extensions.get('2.5.29.15'); if (!e) return null; const b = certOf(r, self).bytes, unused = b[e.value.value], data = b.subarray(e.value.value + 1, e.value.end), n = data.length * 8 - unused;
    const a = r.newArray('[Z', Math.max(9, n)); r.array(a).elements = Array.from({ length: Math.max(9, n) }, (_x, i) => i < n && (data[i >> 3] & (0x80 >> (i & 7))) ? 1 : 0); return a;
  });
  def(X509_IMPL, 'hasUnsupportedCriticalExtension', '()Z', () => 0);
  def(X509_IMPL, 'verify', `(${PUBLIC_KEY})V`, () => fail('X509Certificate.verify: RSA/ECDSA signature verification is not implemented'));
  def(X509_IMPL, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => other !== null && r.object(other).cert && hex(certOf(r, self).bytes) === hex(certOf(r, other).bytes) ? 1 : 0);
  def(X509_IMPL, 'hashCode', '()I', (r, _m, [self]) => { let h = 0; for (const b of certOf(r, self).bytes) h = (Math.imul(h, 31) + ((b << 24) >> 24)) | 0; return h; });
  def(X509_IMPL, 'toString', `()${STRING}`, (r, _m, [self]) => { const c = certOf(r, self); return `[\n[\n  Version: V${c.version}\n  Subject: ${formatName(c.subject, 'rfc1779')}\n  Signature Algorithm: ${ALGORITHM_NAMES(c.signatureAlgorithm)}, OID = ${c.signatureAlgorithm}\n  Key:  ${KEY_ALGORITHMS[c.keyAlgorithm] ?? c.keyAlgorithm}\n  Validity: [From: ${new Date(c.notBefore).toUTCString()},\n               To: ${new Date(c.notAfter).toUTCString()}]\n  Issuer: ${formatName(c.issuer, 'rfc1779')}\n  SerialNumber: [    ${c.serial.toString(16)}]\n]]`; });

  // ---- CertificateFactory ------------------------------------------------------------------------------------------------------------------------------
  def(FACTORY, 'getInstance', `(${STRING})${FACTORY}`, (r, _m, [type_]) => { if (type_ === null) r.throwJava('Ljava/lang/NullPointerException;', 'type == null'); const t = r.stringCharacters(type_); if (t.toUpperCase() !== 'X.509' && t.toUpperCase() !== 'X509') r.throwJava(CERT_EXCEPTION, `Could not find Certificate Factory of type: ${t}`); const f = r.allocate(FACTORY); r.object(f).certType = 'X.509'; return f; }, { static: true });
  for (const providerType of [STRING, 'Ljava/security/Provider;']) def(FACTORY, 'getInstance', `(${STRING}${providerType})${FACTORY}`, (r, _m, [type_]) => r.dispatch({ owner: FACTORY, name: 'getInstance', parameters: [STRING], result: FACTORY, signature: `(${STRING})${FACTORY}` }, [type_], 'static'), { static: true });
  def(FACTORY, 'getType', `()${STRING}`, () => 'X.509');
  const readAll = (r, stream) => { const out = []; for (;;) { const buffer = r.newArray(BYTES, 8192), got = call(r, stream, INPUT, 'read', [BYTES, 'I', 'I'], 'I', [buffer, 0, 8192]); if (got < 0) break; out.push(...r.array(buffer).elements.slice(0, got).map(v => v & 255)); } return Uint8Array.from(out); };
  const decodeAll = (r, input) => {
    const text = new TextDecoder('latin1').decode(input);
    if (text.includes('-----BEGIN')) return [...text.matchAll(/-----BEGIN (?:X509 |TRUSTED )?CERTIFICATE-----([\s\S]*?)-----END (?:X509 |TRUSTED )?CERTIFICATE-----/g)].map(m => Uint8Array.from(atob(m[1].replace(/\s+/g, '')), c => c.charCodeAt(0)));
    const out = []; for (let at = 0; at < input.length;) { const node = tlv(input, at); out.push(input.slice(at, node.end)); at = node.end; } return out;
  };
  def(FACTORY, 'generateCertificate', `(${INPUT})${CERT}`, (r, _m, [, stream]) => { if (stream === null) r.throwJava(CERT_EXCEPTION, 'inStream == null'); let all; try { all = decodeAll(r, readAll(r, stream)); } catch (e) { r.throwJava(CERT_EXCEPTION, `Could not parse certificate: ${e.message}`); } if (!all.length) r.throwJava(CERT_EXCEPTION, 'Could not parse certificate: no certificate data'); return newCertificate(r, all[0]); });
  def(FACTORY, 'generateCertificates', `(${INPUT})Ljava/util/Collection;`, (r, _m, [, stream]) => {
    let all; try { all = decodeAll(r, readAll(r, stream)); } catch (e) { r.throwJava(CERT_EXCEPTION, `Could not parse certificate: ${e.message}`); }
    const list = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct');
    for (const bytes of all) call(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [newCertificate(r, bytes)]); return list;
  });
  return { ...registry, interfaces: registry.interfacesOf };
}
