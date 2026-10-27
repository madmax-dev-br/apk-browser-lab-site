import { createHostRegistry, doubleBits, bitsDouble } from './host-contract.js?v=6ef17e472569';
import { APKError } from './apk-error.js?v=6ef17e472569';

// java.security.Security / Provider and java.net.IDN for libraries that probe the platform at launch (OkHttp's Platform.get(), Conscrypt checks, host name
// normalisation). Contracts: java.security.Security, java.security.Provider (android-13.0.0_r1 libcore) and java.net.IDN (ToASCII/ToUnicode of RFC 3490).
// The provider list is the one an Android 13 device reports; only the names/versions are modelled, no algorithm is claimed through them.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', PROVIDER = 'Ljava/security/Provider;', SECURITY = 'Ljava/security/Security;', IDN = 'Ljava/net/IDN;';
const PROVIDERS = [['AndroidNSSP', 1.0, 'Android Network Security Policy Provider'], ['AndroidOpenSSL', 1.0, 'Android\'s OpenSSL-backed security provider'], ['CertPathProvider', 1.0, 'Android Certificate Path Provider'],
  ['AndroidKeyStoreBCWorkaround', 1.0, 'Android KeyStore security provider to work around Bouncy Castle'], ['BC', 1.68, 'BouncyCastle Security Provider v1.68'], ['HarmonyJSSE', 1.0, 'Harmony JSSE Provider'], ['AndroidKeyStore', 1.0, 'Android KeyStore security provider']];

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
  type(PROVIDER, 'Ljava/lang/Object;', [], { allocatable: true }); type(SECURITY); type(IDN);
  const make = (r, [name, version, info]) => { const ref = r.allocate(PROVIDER); Object.assign(r.object(ref), { providerName: name, providerVersion: version, providerInfo: info }); return ref; };
  def(SECURITY, 'getProviders', `()[${PROVIDER}`, r => { r.providers ??= PROVIDERS.map(p => make(r, p)); const array = r.newArray(`[${PROVIDER}`, r.providers.length); r.array(array).elements = [...r.providers]; return array; }, { static: true });
  def(SECURITY, 'getProvider', `(${STRING})${PROVIDER}`, (r, _m, [name]) => { const wanted = r.stringCharacters(name); r.providers ??= PROVIDERS.map(p => make(r, p)); return r.providers.find(p => r.object(p).providerName === wanted) ?? null; }, { static: true });
  def(PROVIDER, 'getName', `()${STRING}`, (r, _m, [self]) => r.object(self).providerName);
  def(PROVIDER, 'getVersion', '()D', (r, _m, [self]) => doubleBits(r.object(self).providerVersion));
  def(PROVIDER, 'getInfo', `()${STRING}`, (r, _m, [self]) => r.object(self).providerInfo);
  def(PROVIDER, 'toString', `()${STRING}`, (r, _m, [self]) => `${r.object(self).providerName} version ${r.object(self).providerVersion}`);
  const idn = (name, fn) => { for (const sig of [`(${STRING}I)${STRING}`, `(${STRING})${STRING}`]) def(IDN, name, sig, (r, _m, [input, flags = 0]) => {
    if (input === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    try { return fn(r.stringCharacters(input), flags); } catch (e) { if (e.idn) r.throwJava('Ljava/lang/IllegalArgumentException;', e.message); throw e; } }, { static: true }); };
  idn('toASCII', (s, flags) => toASCII(s, { allowUnassigned: !!(flags & 1), useSTD3: !!(flags & 2) }));
  idn('toUnicode', s => toUnicode(s));
  // ---- providers added by the app (Conscrypt.install, BouncyCastle) and Security properties --------------------------------------------------
  const providers = r => r.providers ??= PROVIDERS.map(p => make(r, p)), nameOf = (r, p) => r.object(p).providerName;
  def(PROVIDER, '<init>', `(${STRING}D${STRING})V`, (r, _m, [self, name, version, info]) => { Object.assign(r.object(self), { providerName: r.stringCharacters(name), providerVersion: bitsDouble(version), providerInfo: info === null ? null : r.stringCharacters(info) }); });
  def(SECURITY, 'addProvider', `(${PROVIDER})I`, (r, _m, [p]) => { const list = providers(r); if (list.some(q => nameOf(r, q) === nameOf(r, p))) return -1; list.push(p); return list.length; }, { static: true });
  def(SECURITY, 'insertProviderAt', `(${PROVIDER}I)I`, (r, _m, [p, position]) => { const list = providers(r); if (list.some(q => nameOf(r, q) === nameOf(r, p))) return -1; const at = Math.min(Math.max(position - 1, 0), list.length); list.splice(at, 0, p); return at + 1; }, { static: true });
  def(SECURITY, 'removeProvider', `(${STRING})V`, (r, _m, [name]) => { const list = providers(r), i = list.findIndex(q => nameOf(r, q) === r.stringCharacters(name)); if (i >= 0) list.splice(i, 1); }, { static: true });
  const securityProperties = { 'keystore.type': 'bks', 'ssl.KeyManagerFactory.algorithm': 'PKIX', 'ssl.TrustManagerFactory.algorithm': 'PKIX', 'securerandom.source': 'file:/dev/urandom', 'networkaddress.cache.ttl': '-1' };
  def(SECURITY, 'getProperty', `(${STRING})${STRING}`, (r, _m, [key]) => { if (key === null) r.throwJava('Ljava/lang/NullPointerException;', 'key == null'); return (r.securityProperties ?? securityProperties)[r.stringCharacters(key)] ?? null; }, { static: true });
  def(SECURITY, 'setProperty', `(${STRING}${STRING})V`, (r, _m, [key, value]) => { r.securityProperties ??= { ...securityProperties }; r.securityProperties[r.stringCharacters(key)] = r.stringCharacters(value); }, { static: true });

  // ---- TLS surface: javax.net.ssl / java.security.KeyStore / Conscrypt (com.android.org.conscrypt) as an Android 9+ app sees them ------------------------
  // OkHttp's Platform.get() reflects on Conscrypt's OpenSSLSocketImpl and builds a TrustManagerFactory/SSLContext when the client is created. The device trust
  // store (AndroidCAStore) is not available here, so the default TrustManager has no trust anchors and, like Conscrypt's TrustManagerImpl, rejects every chain
  // with "Trust anchor for certification path not found." (fail closed). TLS itself is never done in the VM: network access goes through the lab's fetch bridge.
  const TM = 'Ljavax/net/ssl/TrustManager;', KM = 'Ljavax/net/ssl/KeyManager;', X509TM = 'Ljavax/net/ssl/X509TrustManager;', TMF = 'Ljavax/net/ssl/TrustManagerFactory;', KMF = 'Ljavax/net/ssl/KeyManagerFactory;';
  const SSL_CONTEXT = 'Ljavax/net/ssl/SSLContext;', SSL_SOCKET_FACTORY = 'Ljavax/net/ssl/SSLSocketFactory;', SSL_SOCKET = 'Ljavax/net/ssl/SSLSocket;', KEYSTORE = 'Ljava/security/KeyStore;', SECURE_RANDOM = 'Ljava/security/SecureRandom;';
  const X509 = 'Ljava/security/cert/X509Certificate;', CERT = 'Ljava/security/cert/Certificate;', LIST = 'Ljava/util/List;', INPUT_STREAM = 'Ljava/io/InputStream;', CHARS = '[C', BYTES = '[B';
  const CONSCRYPT = 'Lcom/android/org/conscrypt/', TMI = CONSCRYPT + 'TrustManagerImpl;', OSSI = CONSCRYPT + 'OpenSSLSocketImpl;', OSFI = CONSCRYPT + 'OpenSSLSocketFactoryImpl;', SPI = CONSCRYPT + 'SSLParametersImpl;', EXT = 'Landroid/net/http/X509TrustManagerExtensions;';
  const NO_ANCHOR = 'java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.';
  type(TM); type(KM); type(X509TM, OBJECT, [TM]); registry.interfaces.set(TM, []); registry.interfaces.set(KM, []); registry.interfaces.set(X509TM, [TM]);
  type(TMI, OBJECT, [X509TM], { allocatable: true }); type(TMF, OBJECT, [], { allocatable: true }); type(KMF, OBJECT, [], { allocatable: true });
  type(SSL_CONTEXT, OBJECT, [], { allocatable: true }); type(OSFI, SSL_SOCKET_FACTORY, [], { allocatable: true }); type(OSSI, SSL_SOCKET); type(SPI, OBJECT); type(EXT, OBJECT, [], { allocatable: true });
  type(KEYSTORE, OBJECT, [], { allocatable: true });
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
  def(OSSI, 'setUseSessionTickets', '(Z)V', () => {}); def(OSSI, 'setHostname', `(${STRING})V`, () => {}); def(OSSI, 'getAlpnSelectedProtocol', `()${BYTES}`, () => null); def(OSSI, 'setAlpnProtocols', `(${BYTES})V`, () => {});
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

  // java.security.KeyStore: an in-memory store ("AndroidCAStore" is the empty system store; AndroidKeyStore is not backed by hardware here).
  const STORE_TYPES = ['BKS', 'PKCS12', 'AndroidCAStore', 'AndroidKeyStore', 'BCPKCS12', 'PKCS12-DEF'];
  const store = (r, self) => { const o = r.object(self); if (!o.keystore?.loaded) r.throwJava('Ljava/security/KeyStoreException;', 'Uninitialized keystore'); return o.keystore; };
  def(KEYSTORE, 'getDefaultType', `()${STRING}`, () => 'BKS', { static: true });
  def(KEYSTORE, 'getInstance', `(${STRING})${KEYSTORE}`, (r, _m, [name]) => {
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'type == null');
    const wanted = r.stringCharacters(name), canonical = STORE_TYPES.find(t => t.toLowerCase() === wanted.toLowerCase());
    if (!canonical) r.throwJava('Ljava/security/KeyStoreException;', `${wanted} KeyStore not available`);
    // "AndroidKeyStore" is the VM's software keystore (jce-host.js): every instance sees the same entries, as on a device.
    const android = canonical === 'AndroidKeyStore', ref = r.allocate(KEYSTORE); r.object(ref).keystore = { type: canonical, loaded: false, android, entries: android ? platform.jce.androidKeyStore.entries(r) : new Map() }; return ref;
  }, { static: true });
  def(KEYSTORE, 'getType', `()${STRING}`, (r, _m, [self]) => r.object(self).keystore.type);
  def(KEYSTORE, 'load', `(${INPUT_STREAM}${CHARS})V`, (r, _m, [self, stream]) => {
    if (stream !== null) throw new APKError(`KeyStore.load: reading ${r.object(self).keystore.type} key store files is not implemented`, { kind: 'unsupported-keystore-format' });
    r.object(self).keystore.loaded = true;
  });
  def(KEYSTORE, 'load', '(Ljava/security/KeyStore$LoadStoreParameter;)V', (r, _m, [self, parameter]) => {   // KeyStoreSpi.engineLoad(LoadStoreParameter): null initializes an empty store; a parameter object carries a file/password this VM does not read
    if (parameter !== null && !r.object(self).keystore.android) throw new APKError('KeyStore.load(LoadStoreParameter) with a parameter is not implemented', { kind: 'unsupported-keystore-format' });
    r.object(self).keystore.loaded = true;
  });
  def(KEYSTORE, 'size', '()I', (r, _m, [self]) => store(r, self).entries.size);
  def(KEYSTORE, 'containsAlias', `(${STRING})Z`, (r, _m, [self, alias]) => store(r, self).entries.has(r.stringCharacters(alias)) ? 1 : 0);
  def(KEYSTORE, 'isCertificateEntry', `(${STRING})Z`, (r, _m, [self, alias]) => store(r, self).entries.get(r.stringCharacters(alias))?.kind === 'cert' ? 1 : 0);
  def(KEYSTORE, 'isKeyEntry', `(${STRING})Z`, (r, _m, [self, alias]) => store(r, self).entries.get(r.stringCharacters(alias))?.kind === 'key' ? 1 : 0);
  def(KEYSTORE, 'getCertificate', `(${STRING})${CERT}`, (r, _m, [self, alias]) => { const e = store(r, self).entries.get(r.stringCharacters(alias)); return e?.cert ?? null; });
  def(KEYSTORE, 'setCertificateEntry', `(${STRING}${CERT})V`, (r, _m, [self, alias, cert]) => { store(r, self).entries.set(r.stringCharacters(alias), { kind: 'cert', cert }); });
  const CHAR_ARRAY = '[C', KEY = 'Ljava/security/Key;';
  def(KEYSTORE, 'getKey', `(${STRING}${CHAR_ARRAY})${KEY}`, (r, _m, [self, alias]) => {
    const s = store(r, self), e = s.entries.get(r.stringCharacters(alias)); if (!e || e.kind !== 'key') return null;
    return s.android ? platform.jce.androidKeyStore.androidKey(r, e.alias, e.algorithm) : e.key;
  });
  def(KEYSTORE, 'setKeyEntry', `(${STRING}${KEY}${CHAR_ARRAY}[${CERT})V`, (r, _m, [self, alias, key]) => {
    const s = store(r, self); if (s.android) throw new APKError('KeyStore.setKeyEntry on AndroidKeyStore (importing keys) is not implemented; generate keys with KeyGenerator and KeyGenParameterSpec', { kind: 'unsupported-keystore-import' });
    if (key === null) r.throwJava('Ljava/lang/NullPointerException;', 'key == null'); s.entries.set(r.stringCharacters(alias), { kind: 'key', key, alias: r.stringCharacters(alias) });
  });
  def(KEYSTORE, 'getCreationDate', `(${STRING})Ljava/util/Date;`, (r, _m, [self, alias]) => {
    const e = store(r, self).entries.get(r.stringCharacters(alias)); if (!e) return null;
    const date = r.allocate('Ljava/util/Date;'); r.dispatch({ owner: 'Ljava/util/Date;', name: '<init>', parameters: ['J'], result: 'V', signature: '(J)V' }, [date, BigInt(Math.trunc(e.created ?? 0))], 'direct'); return date;
  });
  def(KEYSTORE, 'deleteEntry', `(${STRING})V`, (r, _m, [self, alias]) => { store(r, self).entries.delete(r.stringCharacters(alias)); });
  def(KEYSTORE, 'aliases', '()Ljava/util/Enumeration;', (r, _m, [self]) => {
    const list = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct');
    for (const alias of store(r, self).entries.keys()) r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: ['Ljava/lang/Object;'], result: 'Z', signature: '(Ljava/lang/Object;)Z' }, [list, alias], 'virtual');
    return r.dispatch({ owner: 'Ljava/util/Collections;', name: 'enumeration', parameters: ['Ljava/util/Collection;'], result: 'Ljava/util/Enumeration;', signature: '(Ljava/util/Collection;)Ljava/util/Enumeration;' }, [list], 'static');
  });
  return { ...registry, interfaces: registry.interfacesOf };
}
