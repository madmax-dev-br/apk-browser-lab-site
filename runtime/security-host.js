import { createHostRegistry, doubleBits, bitsDouble } from './host-contract.js?v=d50f2f368405';
import { APKError } from './apk-error.js?v=d50f2f368405';

// java.net.IDN and the javax.net.ssl surface (TrustManagerFactory, KeyManagerFactory, SSLContext) for libraries that probe the platform at launch (OkHttp's Platform.get(),
// host name normalisation). java.security.Security / Provider / KeyStore and the providers (Conscrypt, the Android Keystore) are the original libcore and Conscrypt
// classes in the framework DEX (framework-aosp/jca-sources.txt), not modelled here. Contracts: java.net.IDN (ToASCII/ToUnicode of RFC 3490).
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', IDN = 'Ljava/net/IDN;';

// RFC 3492 Punycode (bootstring) encoder/decoder.
const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 128;
const adapt = (delta, points, first) => { delta = first ? Math.floor(delta / DAMP) : delta >> 1; delta += Math.floor(delta / points); let k = 0; for (; delta > ((BASE - TMIN) * TMAX) >> 1; k += BASE) delta = Math.floor(delta / (BASE - TMIN)); return k + Math.floor((BASE - TMIN + 1) * delta / (delta + SKEW)); };
const digit = d => String.fromCharCode(d + (d < 26 ? 97 : 22));
export function punycodeEncode(input) {
  const cps = Array.from(input, c => c.codePointAt(0)); let out = cps.filter(c => c < 128).map(c => String.fromCharCode(c)).join(''), h = out.length; const b = h; if (b) out += '-';
  let n = INITIAL_N, delta = 0, bias = INITIAL_BIAS;
  while (h < cps.length) {
    const m = Math.min(...cps.filter(c => c >= n)); delta += (m - n) * (h + 1); n = m;
    for (const c of cps) {
      if (c < n) delta++;
      if (c === n) { let q = delta; for (let k = BASE; ; k += BASE) { const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias; if (q < t) break; out += digit(t + (q - t) % (BASE - t)); q = Math.floor((q - t) / (BASE - t)); } out += digit(q); bias = adapt(delta, h + 1, h === b); delta = 0; h++; }
    }
    delta++; n++;
  }
  return out;
}
export function punycodeDecode(input) {
  const basic = input.lastIndexOf('-'), out = basic > 0 ? Array.from(input.slice(0, basic), c => c.codePointAt(0)) : []; let n = INITIAL_N, i = 0, bias = INITIAL_BIAS;
  for (let at = basic > 0 ? basic + 1 : 0; at < input.length;) {
    const old = i; let w = 1;
    for (let k = BASE; ; k += BASE) {
      const c = input.charCodeAt(at++), d = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : BASE; if (d >= BASE) throw new Error('bad punycode');
      i += d * w; const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias; if (d < t) break; w *= BASE - t;
    }
    bias = adapt(i - old, out.length + 1, old === 0); n += Math.floor(i / (out.length + 1)); i %= out.length + 1; out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}
const DOTS = /[.。．｡]/;
const isAscii = s => /^[\x00-\x7f]*$/.test(s);
// Nameprep (RFC 3491) is NFKC plus case folding; labels that are already ASCII skip it (RFC 3490 step 2), as ICU does.
const nameprep = s => s.normalize('NFKC').toLowerCase();
export function toASCII(host, { allowUnassigned = false, useSTD3 = false } = {}) {
  const parts = host.split(DOTS), ends = /[。．｡]$/.test(host);
  const labels = parts.map((label, index) => {
    if (!isAscii(label)) label = nameprep(label);
    if (!isAscii(label)) label = 'xn--' + punycodeEncode(label);
    if (label.length > 63) throw Object.assign(new Error('The label in the input is too long'), { idn: true });
    if (useSTD3 && /[^A-Za-z0-9-]/.test(label) ) throw Object.assign(new Error('Contains non-LDH ASCII characters'), { idn: true });
    return label;
  });
  return labels.join('.');
}
export function toUnicode(host) {
  return host.split(DOTS).map(label => /^xn--/i.test(label) ? (() => { try { return punycodeDecode(label.slice(4)); } catch { return label; } })() : label).join('.');
}

export function createSecurityHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(IDN);
  const idn = (name, fn) => { for (const sig of [`(${STRING}I)${STRING}`, `(${STRING})${STRING}`]) def(IDN, name, sig, (r, _m, [input, flags = 0]) => {
    if (input === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    try { return fn(r.stringCharacters(input), flags); } catch (e) { if (e.idn) r.throwJava('Ljava/lang/IllegalArgumentException;', e.message); throw e; } }, { static: true }); };
  idn('toASCII', (s, flags) => toASCII(s, { allowUnassigned: !!(flags & 1), useSTD3: !!(flags & 2) }));
  idn('toUnicode', s => toUnicode(s));

  // ---- TLS surface: javax.net.ssl / java.security.KeyStore / Conscrypt (com.android.org.conscrypt) as an Android 9+ app sees them ------------------------
  // OkHttp's Platform.get() reflects on Conscrypt's OpenSSLSocketImpl and builds a TrustManagerFactory/SSLContext when the client is created. The device trust
  // store (AndroidCAStore) is not available here, so the default TrustManager has no trust anchors and, like Conscrypt's TrustManagerImpl, rejects every chain
  // with "Trust anchor for certification path not found." (fail closed). TLS itself is never done in the VM: network access goes through the lab's fetch bridge.
  const TM = 'Ljavax/net/ssl/TrustManager;', KM = 'Ljavax/net/ssl/KeyManager;', X509TM = 'Ljavax/net/ssl/X509TrustManager;', TMF = 'Ljavax/net/ssl/TrustManagerFactory;', KMF = 'Ljavax/net/ssl/KeyManagerFactory;';
  const SSL_CONTEXT = 'Ljavax/net/ssl/SSLContext;', SSL_SOCKET_FACTORY = 'Ljavax/net/ssl/SSLSocketFactory;', SSL_SOCKET = 'Ljavax/net/ssl/SSLSocket;', KEYSTORE = 'Ljava/security/KeyStore;', SECURE_RANDOM = 'Ljava/security/SecureRandom;';
  const X509 = 'Ljava/security/cert/X509Certificate;', CERT = 'Ljava/security/cert/Certificate;', LIST = 'Ljava/util/List;', INPUT_STREAM = 'Ljava/io/InputStream;', CHARS = '[C', BYTES = '[B';
  const LAB = 'Ldev/apkweb/net/', TMI = LAB + 'LabTrustManager;', OSFI = LAB + 'LabSslSocketFactory;', EXT = 'Landroid/net/http/X509TrustManagerExtensions;';
  const NO_ANCHOR = 'java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.';
  type(TM); type(KM); type(X509TM, OBJECT, [TM]); registry.interfaces.set(TM, []); registry.interfaces.set(KM, []); registry.interfaces.set(X509TM, [TM]);
  type(TMI, OBJECT, [X509TM], { allocatable: true }); type(TMF, OBJECT, [], { allocatable: true }); type(KMF, OBJECT, [], { allocatable: true });
  type(SSL_CONTEXT, OBJECT, [], { allocatable: true }); type(OSFI, SSL_SOCKET_FACTORY, [], { allocatable: true }); type(EXT, OBJECT, [], { allocatable: true });
  const array = (r, element, items) => { const a = r.newArray(`[${element}`, items.length); r.array(a).elements = items; return a; };
  const algorithm = (r, name, accepted, what) => { if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'algorithm == null'); const wanted = r.stringCharacters(name); if (!accepted.some(a => a.toLowerCase() === wanted.toLowerCase())) r.throwJava('Ljava/security/NoSuchAlgorithmException;', `${wanted} ${what} not available`); return wanted; };

  // Conscrypt's TrustManagerImpl: X509TrustManager with no anchors.
  def(TMI, 'getAcceptedIssuers', `()[${X509}`, r => array(r, X509, []));
  const checkChain = (r, chain) => { if (chain === null || r.array(chain).elements.length === 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'null or zero-length certificate chain'); r.throwJava('Ljava/security/cert/CertificateException;', NO_ANCHOR); };
  def(TMI, 'checkServerTrusted', `([${X509}${STRING})V`, (r, _m, [, chain]) => checkChain(r, chain));
  def(TMI, 'checkClientTrusted', `([${X509}${STRING})V`, (r, _m, [, chain]) => checkChain(r, chain));
  def(TMI, 'checkServerTrusted', `([${X509}${STRING}${STRING})${LIST}`, (r, _m, [, chain]) => checkChain(r, chain));
  def(EXT, '<init>', `(${X509TM})V`, (r, _m, [self, manager]) => { if (manager === null) r.throwJava('Ljava/lang/NullPointerException;', null); r.object(self).delegate = manager; });
  def(EXT, 'checkServerTrusted', `([${X509}${STRING}${STRING})${LIST}`, (r, _m, [, chain]) => checkChain(r, chain));
  def(EXT, 'isUserAddedCertificate', `(${X509})Z`, () => 0);
  def(EXT, 'isSameTrustConfiguration', `(${STRING}${STRING})Z`, () => 1);

  // Conscrypt socket classes: only the reflective surface OkHttp inspects at start-up; sockets cannot be created (see the header comment).
  const noSockets = r => r.throwJava('Ljava/net/SocketException;', 'TLS sockets are not available in the browser lab (HTTP goes through the fetch bridge)');
  for (const parameters of ['', 'Ljava/net/Socket;Ljava/lang/String;IZ', 'Ljava/lang/String;I', 'Ljava/net/InetAddress;I']) def(OSFI, 'createSocket', `(${parameters})${'Ljava/net/Socket;'}`, noSockets);
  // Conscrypt (android-13): the cipher suites a client socket enables by default, and the extra legacy ones it can be asked to enable.
  const DEFAULT_SUITES = ['TLS_AES_128_GCM_SHA256', 'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256', 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256', 'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384', 'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
    'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256', 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384', 'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256', 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
    'TLS_RSA_WITH_AES_128_GCM_SHA256', 'TLS_RSA_WITH_AES_256_GCM_SHA384', 'TLS_RSA_WITH_AES_128_CBC_SHA', 'TLS_RSA_WITH_AES_256_CBC_SHA'];
  const SUPPORTED_SUITES = [...DEFAULT_SUITES, 'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA', 'TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA', 'TLS_RSA_WITH_3DES_EDE_CBC_SHA', 'TLS_EMPTY_RENEGOTIATION_INFO_SCSV'];
  const DEFAULT_PROTOCOLS = ['TLSv1.3', 'TLSv1.2'], SUPPORTED_PROTOCOLS = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
  def(OSFI, 'getDefaultCipherSuites', '()[Ljava/lang/String;', r => array(r, STRING, DEFAULT_SUITES));
  def(OSFI, 'getSupportedCipherSuites', '()[Ljava/lang/String;', r => array(r, STRING, SUPPORTED_SUITES));
  // SSLContext.getDefaultSSLParameters / getSupportedSSLParameters (SSLContextSpi -> the socket factory's defaults): a real javax.net.ssl.SSLParameters of the cipher suites and protocols.
  const SSL_PARAMETERS = 'Ljavax/net/ssl/SSLParameters;';
  const parameters = (r, suites, protocols) => { const ref = r.allocate(SSL_PARAMETERS); r.dispatch({ owner: SSL_PARAMETERS, name: '<init>', parameters: [`[${STRING}`, `[${STRING}`], result: 'V', signature: `([${STRING}[${STRING})V` }, [ref, array(r, STRING, suites), array(r, STRING, protocols)], 'direct'); return ref; };
  def(SSL_CONTEXT, 'getDefaultSSLParameters', `()${SSL_PARAMETERS}`, (r, _m, [self]) => { if (!r.object(self).factory) r.throwJava('Ljava/lang/IllegalStateException;', 'SSLContext is not initialized'); return parameters(r, DEFAULT_SUITES, DEFAULT_PROTOCOLS); });
  def(SSL_CONTEXT, 'getSupportedSSLParameters', `()${SSL_PARAMETERS}`, (r, _m, [self]) => { if (!r.object(self).factory) r.throwJava('Ljava/lang/IllegalStateException;', 'SSLContext is not initialized'); return parameters(r, SUPPORTED_SUITES, SUPPORTED_PROTOCOLS); });

  // TrustManagerFactory / KeyManagerFactory (algorithms PKIX and X509 on Android).
  def(TMF, 'getDefaultAlgorithm', `()${STRING}`, () => 'PKIX', { static: true });
  def(TMF, 'getInstance', `(${STRING})${TMF}`, (r, _m, [name]) => { const ref = r.allocate(TMF); r.object(ref).algorithm = algorithm(r, name, ['PKIX', 'X509'], 'TrustManagerFactory'); return ref; }, { static: true });
  def(TMF, 'getAlgorithm', `()${STRING}`, (r, _m, [self]) => r.object(self).algorithm);
  def(TMF, 'init', `(${KEYSTORE})V`, (r, _m, [self]) => { r.object(self).managers = [r.allocate(TMI)]; });
  def(TMF, 'getTrustManagers', `()[${TM}`, (r, _m, [self]) => { const o = r.object(self); if (!o.managers) r.throwJava('Ljava/lang/IllegalStateException;', 'TrustManagerFactory is not initialized'); return array(r, TM, [...o.managers]); });
  def(KMF, 'getDefaultAlgorithm', `()${STRING}`, () => 'PKIX', { static: true });
  def(KMF, 'getInstance', `(${STRING})${KMF}`, (r, _m, [name]) => { const ref = r.allocate(KMF); r.object(ref).algorithm = algorithm(r, name, ['PKIX', 'X509'], 'KeyManagerFactory'); return ref; }, { static: true });
  def(KMF, 'getAlgorithm', `()${STRING}`, (r, _m, [self]) => r.object(self).algorithm);
  def(KMF, 'init', `(${KEYSTORE}${CHARS})V`, (r, _m, [self]) => { r.object(self).ready = true; });
  def(KMF, 'getKeyManagers', `()[${KM}`, (r, _m, [self]) => { if (!r.object(self).ready) r.throwJava('Ljava/lang/IllegalStateException;', 'KeyManagerFactory is not initialized'); return array(r, KM, []); });

  // SSLContext: the socket factory is Conscrypt's OpenSSLSocketFactoryImpl.
  const PROTOCOLS = ['TLS', 'TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3', 'SSL', 'SSLv3', 'Default'];
  def(SSL_CONTEXT, 'getInstance', `(${STRING})${SSL_CONTEXT}`, (r, _m, [name]) => { const ref = r.allocate(SSL_CONTEXT); r.object(ref).protocol = algorithm(r, name, PROTOCOLS, 'SSLContext'); return ref; }, { static: true });
  def(SSL_CONTEXT, 'getDefault', `()${SSL_CONTEXT}`, r => { const ref = r.allocate(SSL_CONTEXT); Object.assign(r.object(ref), { protocol: 'Default', factory: r.allocate(OSFI) }); return ref; }, { static: true });
  def(SSL_CONTEXT, 'getProtocol', `()${STRING}`, (r, _m, [self]) => r.object(self).protocol);
  def(SSL_CONTEXT, 'init', `([${KM}[${TM}${SECURE_RANDOM})V`, (r, _m, [self, , trust]) => { const o = r.object(self); o.trustManagers = (trust === null || trust === 0 || trust === undefined) ? null : [...r.array(trust).elements]; o.factory = r.allocate(OSFI); });
  def(SSL_CONTEXT, 'getSocketFactory', `()${SSL_SOCKET_FACTORY}`, (r, _m, [self]) => r.object(self).factory ?? r.throwJava('Ljava/lang/IllegalStateException;', 'SSLContext is not initialized'));

  return { ...registry, interfaces: registry.interfacesOf };
}
