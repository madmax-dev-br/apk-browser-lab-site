import { APKError } from './apk-error.js?v=f6a6624dec7c';
import { Blocked } from './scheduler.js?v=f6a6624dec7c';
import { JavaException } from './apk-runtime.js?v=f6a6624dec7c';
import { networkOf } from './network-native.js?v=f6a6624dec7c';
import { httpSocketOf } from './libcore-io-native.js?v=f6a6624dec7c';
import { clientCertHostMatches, destination, parseLabKeystore } from './client-identity.js?v=f6a6624dec7c';

// SSLSocket over the virtual HTTP socket (src/virtual-http-socket.js): the TLS surface of a Conscrypt-shaped client socket, WITHOUT any encryption in the VM.
//
// The browser's fetch does the real TLS. SSLSocketFactory.createSocket(socket, host, port, autoClose) (and the other overloads) of the lab's factory return a Conscrypt-shaped
// SSLSocket (a subclass of the platform's original com.android.org.conscrypt.OpenSSLSocketImpl, so the original delegation, listener and ALPN hook code runs) whose handshake only
//   * marks the underlying virtual socket https (the requests it carries are fetched over https, SNI = the host),
//   * obtains the lab transport certificate chain for the host (src/transport-ca.js: a per-session CA and a per-host leaf, real X509Certificate objects through the platform's
//     CertificateFactory) and lets the app's TrustManager judge it (X509TrustManager.checkServerTrusted), so a pinning or strict app fails with its own exception,
//   * answers getSession() with TLSv1.3 and a TLS 1.3 cipher suite, the host as peer host, the lab chain as peer certificates, and the ALPN protocol http/1.1 (the virtual socket
//     speaks HTTP/1.1 only; a client that offered ALPN without http/1.1 fails explicitly).
// The protocol and cipher suite describe the lab <-> app leg nominally; the browser negotiated the real ones with the real server and does not report them. The chain is the lab's,
// never the server's (docs/NETWORK.md).
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', SOCKET = 'Ljava/net/Socket;', INET = 'Ljava/net/InetAddress;';
const SSL_SOCKET = 'Ljavax/net/ssl/SSLSocket;', SSL_SESSION = 'Ljavax/net/ssl/SSLSession;', SSL_PARAMETERS = 'Ljavax/net/ssl/SSLParameters;', HCL = 'Ljavax/net/ssl/HandshakeCompletedListener;', HCE = 'Ljavax/net/ssl/HandshakeCompletedEvent;';
const OSI = 'Lcom/android/org/conscrypt/OpenSSLSocketImpl;', ACS = 'Lcom/android/org/conscrypt/AbstractConscryptSocket;', LAB = 'Ldev/apkweb/net/LabSslSocket;', SESSION = 'Ldev/apkweb/net/LabSslSession;';
const X509 = 'Ljava/security/cert/X509Certificate;', CERT = 'Ljava/security/cert/Certificate;', CERT_FACTORY = 'Ljava/security/cert/CertificateFactory;', X509TM = 'Ljavax/net/ssl/X509TrustManager;';
export const TRUST_KEY = 'Ldev/apkweb/net/LabSslSocketFactory;->trustManagers:[Ljavax/net/ssl/TrustManager;';
export const KEYS_KEY = 'Ldev/apkweb/net/LabSslSocketFactory;->keyManagers:[Ljavax/net/ssl/KeyManager;';   // the KeyManagers of SSLContext.init: the client identity (clientIdentity below)
const SESSION_KEY = `${LAB}->session:${SSL_SESSION}`, CHAIN_KEY = `${SESSION}->chain:[${CERT}`;
export const TLS_13_SUITE = 'TLS_AES_128_GCM_SHA256', TLS_12_SUITE = 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256', ALPN = 'http/1.1';
const message = (error, fallback = '') => String(error?.message ?? fallback);

export function installTlsSockets({ def, type, registry }, { defaults, array }) {
  const { DEFAULT_SUITES, SUPPORTED_SUITES, DEFAULT_PROTOCOLS, SUPPORTED_PROTOCOLS } = defaults;
  type(SSL_SOCKET, SOCKET); type(HCL); registry.interfaces.set(HCL, []);
  type(HCE, 'Ljava/util/EventObject;', [], { allocatable: true }); type(SESSION, OBJECT, [SSL_SESSION], { allocatable: true });
  type(LAB, OSI, [], { allocatable: true });

  // ---- javax.net.ssl.SSLSocket: the platform's DEX has no copy; the class is the Socket constructors Conscrypt's subclasses call (the SSL API itself is on the lab socket below)
  for (const parameters of [[], [STRING, 'I'], [INET, 'I'], [STRING, 'I', INET, 'I'], [INET, 'I', INET, 'I']]) {
    const signature = `(${parameters.join('')})V`;
    def(SSL_SOCKET, '<init>', signature, (r, _m, args) => { r.dispatch({ owner: SOCKET, name: '<init>', parameters, result: 'V', signature }, args, 'direct'); });
  }

  // ---- helpers
  const javaThrow = (r, className, text) => r.throwJava(className, text);
  const construct = (r, owner, parameters, args) => {
    const self = r.allocate(owner);
    r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: self }), 'direct');
    return self;
  };
  /** call(r, owner, name, parameters, result, [receiver, ...args] | [...args], mode): a dispatch with the receiver (mode 'virtual' / 'direct') leading the argument list. */
  const call = (r, owner, name, parameters, result, args, mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, mode === 'static' ? r.argumentWords(parameters, args, {}) : r.argumentWords(parameters, args.slice(1), { receiver: args[0] }), mode);
  const byteArray = (r, bytes) => { const a = r.newArray('[B', bytes.length); r.object(a).elements = Array.from(bytes, v => (v << 24) >> 24); return a; };
  const bytesOf = (r, ref) => Uint8Array.from(r.object(ref).elements, v => v & 255);
  const text = (r, value) => (value === null || value === undefined || value === 0 ? null : typeof value === 'string' ? value : r.stringCharacters(value));
  const state = (r, self) => r.object(self).tls ??= { protocols: [...DEFAULT_PROTOCOLS], suites: [...DEFAULT_SUITES], clientMode: true, needAuth: false, wantAuth: false, sessionCreation: true, applicationProtocols: [], handshaken: false, certHost: null, useTickets: true };
  const authorityOf = r => networkOf(r).authority;

  /** The lab chain of `host`, or a Blocked that re-runs the calling method once the (asynchronous, WebCrypto) generation is done. */
  const chainFor = (r, host, what) => {
    const authority = authorityOf(r), entry = authority.entry(host); if (entry) return entry;
    const failure = authority.failure(host); if (failure) javaThrow(r, 'Ljavax/net/ssl/SSLException;', `The lab transport certificate for ${host} cannot be generated (${message(failure)}); ${what}`);
    authority.prepare(host).catch(() => {});
    return new Blocked({ ready: () => authority.entry(host) !== null || authority.failure(host) !== null, retry: true, interruptible: false, reason: `lab transport certificate for ${host}` });
  };
  /** X509Certificate objects (the platform's CertificateFactory parses the DER) for a chain entry, created once per host and kept alive as host roots. */
  const certificatesOf = (r, entry) => {
    if (entry.javaChain) return entry.javaChain;
    const factory = call(r, CERT_FACTORY, 'getInstance', [STRING], CERT_FACTORY, ['X.509'], 'static'), chain = [];
    for (const der of [entry.leafDer, entry.caDer]) {
      const stream = construct(r, 'Ljava/io/ByteArrayInputStream;', ['[B'], [byteArray(r, der)]);
      chain.push(call(r, CERT_FACTORY, 'generateCertificate', ['Ljava/io/InputStream;'], CERT, [factory, stream]));
    }
    (r.hostStaticValues ??= []).push(...chain); entry.javaChain = chain; return chain;
  };
  const certificateArray = (r, elementType, certificates) => { const a = r.newArray(`[${elementType}`, certificates.length); r.object(a).elements = [...certificates]; return a; };

  // ---- the session
  const makeSession = (r, tls, host, port, entry) => {
    const session = r.allocate(SESSION), chain = certificatesOf(r, entry);
    Object.assign(r.object(session), { lab: { host, port, protocol: tls.protocols.includes('TLSv1.3') ? 'TLSv1.3' : 'TLSv1.2', created: Number(r.clock.wall()), id: crypto.getRandomValues(new Uint8Array(32)) } });
    r.storeField(r.object(session).fields, CHAIN_KEY, certificateArray(r, CERT, chain));
    return session;
  };
  const lab = (r, self) => r.object(self).lab;
  const suiteOf = protocol => (protocol === 'TLSv1.3' ? TLS_13_SUITE : TLS_12_SUITE);
  def(SESSION, 'getId', '()[B', (r, _m, [self]) => byteArray(r, lab(r, self).id));
  def(SESSION, 'getSessionContext', '()Ljavax/net/ssl/SSLSessionContext;', () => null);
  def(SESSION, 'getCreationTime', '()J', (r, _m, [self]) => BigInt(lab(r, self).created));
  def(SESSION, 'getLastAccessedTime', '()J', (r, _m, [self]) => BigInt(lab(r, self).created));
  def(SESSION, 'invalidate', '()V', (r, _m, [self]) => { lab(r, self).invalid = true; });
  def(SESSION, 'isValid', '()Z', (r, _m, [self]) => (lab(r, self).invalid ? 0 : 1));
  def(SESSION, 'putValue', `(${STRING}${OBJECT})V`, (r, _m, [self, name, value]) => { if (name === null || value === null) javaThrow(r, 'Ljava/lang/IllegalArgumentException;', 'name == null || value == null'); const key = `${SESSION}->value:${text(r, name)}`; r.storeField(r.object(self).fields, key, value); (lab(r, self).names ??= new Set()).add(text(r, name)); });
  def(SESSION, 'getValue', `(${STRING})${OBJECT}`, (r, _m, [self, name]) => { if (name === null) javaThrow(r, 'Ljava/lang/IllegalArgumentException;', 'name == null'); return r.object(self).fields.get(`${SESSION}->value:${text(r, name)}`) ?? null; });
  def(SESSION, 'removeValue', `(${STRING})V`, (r, _m, [self, name]) => { r.object(self).fields.delete(`${SESSION}->value:${text(r, name)}`); lab(r, self).names?.delete(text(r, name)); });
  def(SESSION, 'getValueNames', `()[${STRING}`, (r, _m, [self]) => array(r, STRING, [...(lab(r, self).names ?? [])]));
  def(SESSION, 'getPeerCertificates', `()[${CERT}`, (r, _m, [self]) => { const chain = r.object(self).fields.get(CHAIN_KEY); return certificateArray(r, CERT, r.object(chain).elements); });
  def(SESSION, 'getLocalCertificates', `()[${CERT}`, () => null);
  def(SESSION, 'getPeerCertificateChain', '()[Ljavax/security/cert/X509Certificate;', (r, _m, [self]) => {
    const chain = r.object(r.object(self).fields.get(CHAIN_KEY)).elements, out = chain.map(cert => call(r, 'Ljavax/security/cert/X509Certificate;', 'getInstance', ['[B'], 'Ljavax/security/cert/X509Certificate;', [call(r, CERT, 'getEncoded', [], '[B', [cert])], 'static'));
    return certificateArray(r, 'Ljavax/security/cert/X509Certificate;', out);
  });
  def(SESSION, 'getPeerPrincipal', '()Ljava/security/Principal;', (r, _m, [self]) => call(r, X509, 'getSubjectX500Principal', [], 'Ljavax/security/auth/x500/X500Principal;', [r.object(r.object(self).fields.get(CHAIN_KEY)).elements[0]]));
  def(SESSION, 'getLocalPrincipal', '()Ljava/security/Principal;', () => null);
  def(SESSION, 'getCipherSuite', `()${STRING}`, (r, _m, [self]) => suiteOf(lab(r, self).protocol));
  def(SESSION, 'getProtocol', `()${STRING}`, (r, _m, [self]) => lab(r, self).protocol);
  def(SESSION, 'getPeerHost', `()${STRING}`, (r, _m, [self]) => lab(r, self).host);
  def(SESSION, 'getPeerPort', '()I', (r, _m, [self]) => lab(r, self).port);
  def(SESSION, 'getPacketBufferSize', '()I', () => 16709);
  def(SESSION, 'getApplicationBufferSize', '()I', () => 16384);

  // ---- HandshakeCompletedEvent
  def(HCE, '<init>', `(${SSL_SOCKET}${SSL_SESSION})V`, (r, _m, [self, socket, session]) => {
    if (socket === null) javaThrow(r, 'Ljava/lang/IllegalArgumentException;', 'null source');
    r.dispatch({ owner: 'Ljava/util/EventObject;', name: '<init>', parameters: [OBJECT], result: 'V', signature: `(${OBJECT})V` }, [self, socket], 'direct');
    r.storeField(r.object(self).fields, `${HCE}->session:${SSL_SESSION}`, session);
  });
  const eventSession = (r, self) => r.object(self).fields.get(`${HCE}->session:${SSL_SESSION}`);
  def(HCE, 'getSession', `()${SSL_SESSION}`, (r, _m, [self]) => eventSession(r, self));
  def(HCE, 'getSocket', `()${SSL_SOCKET}`, (r, _m, [self]) => call(r, 'Ljava/util/EventObject;', 'getSource', [], OBJECT, [self]));
  def(HCE, 'getCipherSuite', `()${STRING}`, (r, _m, [self]) => call(r, SSL_SESSION, 'getCipherSuite', [], STRING, [eventSession(r, self)]));
  def(HCE, 'getLocalCertificates', `()[${CERT}`, () => null);
  def(HCE, 'getPeerCertificates', `()[${CERT}`, (r, _m, [self]) => call(r, SSL_SESSION, 'getPeerCertificates', [], `[${CERT}`, [eventSession(r, self)]));
  def(HCE, 'getPeerPrincipal', '()Ljava/security/Principal;', (r, _m, [self]) => call(r, SSL_SESSION, 'getPeerPrincipal', [], 'Ljava/security/Principal;', [eventSession(r, self)]));
  def(HCE, 'getLocalPrincipal', '()Ljava/security/Principal;', () => null);

  // ---- android.net.ssl.SSLSockets (API 29): what OkHttp's Android 10+ adapter asks first -- is this a platform (Conscrypt) socket, and may it use session tickets
  const SSL_SOCKETS = 'Landroid/net/ssl/SSLSockets;';
  type(SSL_SOCKETS);
  const conscrypt = (r, socket) => { if (socket === null) javaThrow(r, 'Ljava/lang/NullPointerException;', 'socket'); return r.isSubtype(r.object(socket).type, ACS); };
  def(SSL_SOCKETS, 'isSupportedSocket', `(${SSL_SOCKET})Z`, (r, _m, [socket]) => (conscrypt(r, socket) ? 1 : 0), { static: true });
  def(SSL_SOCKETS, 'setUseSessionTickets', `(${SSL_SOCKET}Z)V`, (r, _m, [socket, on]) => { if (!conscrypt(r, socket)) javaThrow(r, 'Ljava/lang/IllegalArgumentException;', 'Socket not supported'); state(r, socket).useTickets = !!on; }, { static: true });

  // ---- the handshake
  const rawSocketOf = (r, self) => r.object(self).fields.get(`${ACS}->socket:${SOCKET}`);
  const hostText = (r, self) => text(r, call(r, ACS, 'getHostname', [], STRING, [self], 'direct'));
  /** The name the certificate is for: the SNI/peer host name, else the name the connected address was resolved from, else the address. */
  const certHostOf = (r, self) => {
    const tls = state(r, self); if (tls.certHost) return tls.certHost;
    const named = hostText(r, self); if (named) return named.toLowerCase();
    const raw = rawSocketOf(r, self), target = raw === self || !raw ? self : raw, address = call(r, SOCKET, 'getInetAddress', [], INET, [target]);
    if (address === null) javaThrow(r, 'Ljava/net/SocketException;', 'Socket is not connected');
    const literal = text(r, call(r, INET, 'getHostAddress', [], STRING, [address])); return (networkOf(r).resolvedName(literal) ?? literal).toLowerCase();
  };
  const handshakeFailure = (r, textMessage, cause = null) => {
    const exception = construct(r, 'Ljavax/net/ssl/SSLHandshakeException;', [STRING], [textMessage]);
    if (cause) call(r, 'Ljava/lang/Throwable;', 'initCause', ['Ljava/lang/Throwable;'], 'Ljava/lang/Throwable;', [exception, cause]);
    r.throwJavaReference(exception, textMessage);
  };
  /** The app's TrustManagers judge the lab chain (X509TrustManager.checkServerTrusted); a rejection is the handshake's failure, with their exception as the cause. */
  const trustCheck = (r, self, chain) => {
    const managers = r.object(self).fields.get(TRUST_KEY);
    if (managers === null || managers === undefined || managers === 0) return;                               // SSLContext.init(null, null, null): the platform default, which accepts the lab chain by construction
    const x509 = r.object(managers).elements.find(manager => manager !== null && r.isSubtype(r.object(manager).type, X509TM));
    if (!x509) return;
    try { call(r, X509TM, 'checkServerTrusted', [`[${X509}`, STRING], 'V', [x509, certificateArray(r, X509, chain), 'ECDHE_ECDSA']); }
    catch (error) { if (error instanceof JavaException) handshakeFailure(r, 'Chain validation failed', error.value); throw error; }
  };
  /**
   * The client certificate (mTLS) for a host the device settings name (network.clientCertHosts): what Conscrypt asks the app's X509KeyManager when the server sends a
   * CertificateRequest -- chooseClientAlias(key types, issuers, socket), then getPrivateKey and getCertificateChain of that alias. The browser does the real TLS and cannot present it,
   * so the identity goes to the relay for this destination only (network-native.js useClientIdentity). Hosts that are not listed never consult the KeyManager here.
   */
  const X509KM = 'Ljavax/net/ssl/X509KeyManager;', PRINCIPAL = 'Ljava/security/Principal;', PRIVATE_KEY = 'Ljava/security/PrivateKey;';
  /**
   * Why a KeyManager chose nothing, when it is the platform's (KeyManagerFactory over a KeyStore: Conscrypt's KeyManagerImpl, which copies the KeyStore's private-key entries at
   * KeyManagerFactory.init): how many it holds and their key algorithms. An app's own X509KeyManager is named by its class. '' when nothing can be said.
   */
  const KMI = 'Lcom/android/org/conscrypt/KeyManagerImpl;';
  const keyManagerContents = (r, manager) => {
    try {
      const type = r.object(manager).type;
      if (type !== KMI) return `; the KeyManager is the app's own ${type.slice(1, -1).replace(/\//g, '.')}`;
      const hash = r.object(manager).fields.get(`${KMI}->hash:Ljava/util/HashMap;`);
      if (hash === null || hash === undefined || hash === 0) return '';
      const entries = call(r, 'Ljava/util/Map;', 'values', [], 'Ljava/util/Collection;', [hash]), list = call(r, 'Ljava/util/Collection;', 'toArray', [], '[Ljava/lang/Object;', [entries]);
      const algorithms = r.object(list).elements.map(entry => {
        const chain = call(r, 'Ljava/security/KeyStore$PrivateKeyEntry;', 'getCertificateChain', [], `[${CERT}`, [entry]), leaf = r.object(chain).elements[0];
        return text(r, call(r, 'Ljava/security/Key;', 'getAlgorithm', [], STRING, [call(r, CERT, 'getPublicKey', [], 'Ljava/security/PublicKey;', [leaf])]));
      });
      if (!algorithms.length) return '; it holds no private-key entry: the KeyStore given to KeyManagerFactory.init had none at that moment (a failed KeyStore.load, or a key added after init, leaves it empty, as on a device)';
      return `; it holds ${algorithms.length} private-key entr${algorithms.length === 1 ? 'y' : 'ies'} (${algorithms.join(', ')}), none matching the key types EC, RSA`;
    } catch (error) { if (error instanceof JavaException) return ''; throw error; }
  };
  /** { id, alias } of an AndroidKeyStore key (android.security.keystore2.AndroidKeyStoreKey: mKeyId and its user descriptor's alias), or null for any other key. */
  const AKS_KEY = 'Landroid/security/keystore2/AndroidKeyStoreKey;';
  const androidKeyStoreKey = (r, key) => {
    try {
      const object = r.object(key); if (!r.isSubtype(object.type, AKS_KEY)) return null;
      const id = object.fields.get(`${AKS_KEY}->mKeyId:J`), descriptor = object.fields.get(`${AKS_KEY}->mDescriptor:Landroid/system/keystore2/KeyDescriptor;`);
      const alias = descriptor ? r.object(descriptor).fields.get('Landroid/system/keystore2/KeyDescriptor;->alias:Ljava/lang/String;') : null;
      return { id: id === undefined || id === null ? undefined : Number(id), alias: alias === null || alias === undefined || alias === 0 ? null : text(r, alias) };
    } catch { return null; }
  };
  const clientIdentity = (r, self, host, port) => {
    const network = networkOf(r); if (!clientCertHostMatches(network.policy?.clientCertHosts, host, port)) return;
    const where = destination(host, port), note = text => { network.clientIdentityNotes ??= new Set(); const key = `${where} ${text}`; if (!network.clientIdentityNotes.has(key)) { network.clientIdentityNotes.add(key); r.record(`NET tls client certificate for ${where}: ${text}`); } network.noteClientIdentity?.(where, { state: 'none', detail: text.replace(/^none offered: /, '') }); };
    const managers = r.object(self).fields.get(KEYS_KEY);
    const manager = managers === null || managers === undefined || managers === 0 ? null : r.object(managers).elements.find(item => item !== null && item !== 0 && r.isSubtype(r.object(item).type, X509KM));
    if (!manager) {
      const none = managers === null || managers === 0 || managers === undefined;
      return note(`none offered: ${state(r, self).defaultFactory ? 'this socket comes from the default SSLContext (SSLContext.getDefault, SSLSocketFactory.getDefault or HttpsURLConnection\'s default factory), which has no KeyManager unless the app made its own context the default with SSLContext.setDefault' : none ? 'the SSLContext of this socket was initialized with null KeyManagers (SSLContext.init(null, ...))' : 'none of the KeyManagers of this socket\'s SSLContext is an X509KeyManager'}; a device offers no certificate either`);
    }
    const alias = call(r, X509KM, 'chooseClientAlias', [`[${STRING}`, `[${PRINCIPAL}`, SOCKET], STRING, [manager, array(r, STRING, ['EC', 'RSA']), null, self]);
    if (alias === null || alias === 0) return note(`none offered: the app's KeyManager chose no alias (chooseClientAlias returned null)${keyManagerContents(r, manager)}`);
    const name = text(r, alias), key = call(r, X509KM, 'getPrivateKey', [STRING], PRIVATE_KEY, [manager, alias]), certs = call(r, X509KM, 'getCertificateChain', [STRING], `[${X509}`, [manager, alias]);
    const chain = certs === null || certs === 0 ? [] : r.object(certs).elements.filter(item => item !== null && item !== 0).map(cert => r.bytesOf(call(r, CERT, 'getEncoded', [], '[B', [cert])));
    if (key === null || key === 0 || !chain.length) return note(`none offered: alias "${name}" has ${key === null || key === 0 ? 'no private key' : 'no certificate chain'} (the app must have registered its certificate first)`);
    const encoded = call(r, 'Ljava/security/Key;', 'getEncoded', [], '[B', [key]);
    let material = encoded === null || encoded === 0 ? null : r.bytesOf(encoded);
    if (!material) {   // an AndroidKeyStore key (getEncoded is null on the device too): the lab's software KeyMint holds its PKCS#8 material
      let bytes = null; try { bytes = r.platform.javaIo.fs().bytes(`/data/misc/keystore/user_0/${r.platform.packageName}/keystore.db`); } catch { /* no filesystem */ }
      // the key's own record: an AndroidKeyStoreKey knows its key id and the alias it was loaded under, which need not be the name the app's KeyManager answers with
      const entries = parseLabKeystore(bytes).filter(entry => entry.material?.length), own = androidKeyStoreKey(r, key);
      material = (own?.id !== undefined && entries.find(entry => entry.id === own.id)) || (own?.alias && entries.find(entry => entry.alias === own.alias)) || entries.find(entry => entry.alias === name);
      material = material?.material ?? null;
    }
    if (!material) return note(`none offered: the private key of alias "${name}" is neither a PKCS#8 key nor an AndroidKeyStore key of this device`);
    network.useClientIdentity(where, { key: material, chain }, name);
  };
  const runHandshake = (r, self) => {
    const tls = state(r, self);
    if (tls.handshaken) return null;
    const raw = rawSocketOf(r, self), target = !raw || raw === self ? self : raw;
    if (call(r, SOCKET, 'isClosed', [], 'Z', [self])) javaThrow(r, 'Ljava/net/SocketException;', 'Socket is closed');
    if (!call(r, SOCKET, 'isConnected', [], 'Z', [self])) javaThrow(r, 'Ljava/net/SocketException;', 'Socket is not connected');
    if (!tls.clientMode) handshakeFailure(r, 'The lab SSLSocket is a TLS client only: server mode needs inbound TCP, which a browser does not have');
    if (!tls.protocols.some(protocol => protocol === 'TLSv1.3' || protocol === 'TLSv1.2')) handshakeFailure(r, `No appropriate protocol (protocol is disabled or cipher suites are inappropriate): the browser negotiates TLS 1.2 or 1.3, enabled: ${tls.protocols.join(',') || 'none'}`);
    if (tls.applicationProtocols.length && !tls.applicationProtocols.includes(ALPN)) handshakeFailure(r, `Failed to negotiate an application protocol: the lab serves ${ALPN} only, the client offered ${tls.applicationProtocols.join(',')}`);
    const virtual = httpSocketOf(r, target);
    if (!virtual) javaThrow(r, 'Ljava/net/SocketException;', 'TLS needs a connected socket served by the lab (a java.net.Socket connected to a host the device network policy permits); this socket is not one');
    const host = certHostOf(r, self), entry = chainFor(r, host, 'TLS sockets need WebCrypto (ECDSA P-256) in the page'); if (entry instanceof Blocked) return entry;
    const chain = certificatesOf(r, entry);
    trustCheck(r, self, chain);
    const peerPort = Number(call(r, SOCKET, 'getPort', [], 'I', [self])); clientIdentity(r, self, host, peerPort > 0 ? peerPort : 443);
    virtual.markTls(host);
    if (!entry.traced) { entry.traced = true; r.record(`NET tls: lab transport certificate for ${host} (issued by the APK Web Lab transport CA, SAN ${host}, valid until ${new Date(entry.notAfter).toISOString()}); not the server's certificate: the browser performs the real TLS`); }
    const port = Number(call(r, SOCKET, 'getPort', [], 'I', [self]));
    const session = makeSession(r, tls, host, port > 0 ? port : (networkOf(r).peerPort ?? 443), entry);
    tls.handshaken = true; r.storeField(r.object(self).fields, SESSION_KEY, session);
    call(r, ACS, 'notifyHandshakeCompletedListeners', [], 'V', [self], 'direct');
    return null;
  };
  def(LAB, 'startHandshake', '()V', (r, _m, [self]) => runHandshake(r, self) ?? undefined);
  def(LAB, 'getSession', `()${SSL_SESSION}`, (r, _m, [self]) => { const waiting = runHandshake(r, self); if (waiting) return waiting; return r.object(self).fields.get(SESSION_KEY); });
  def(LAB, 'getActiveSession', `()${SSL_SESSION}`, (r, _m, [self]) => r.object(self).fields.get(SESSION_KEY) ?? null);
  def(LAB, 'getHandshakeSession', `()${SSL_SESSION}`, () => null);
  def(LAB, 'getApplicationProtocol', `()${STRING}`, (r, _m, [self]) => (state(r, self).handshaken ? ALPN : null));
  def(LAB, 'getHandshakeApplicationProtocol', `()${STRING}`, () => null);
  def(LAB, 'setApplicationProtocols', `([${STRING})V`, (r, _m, [self, protocols]) => { if (protocols === null) javaThrow(r, 'Ljava/lang/IllegalArgumentException;', 'protocols == null'); state(r, self).applicationProtocols = r.object(protocols).elements.map(item => text(r, item)); });
  def(LAB, 'getApplicationProtocols', `()[${STRING}`, (r, _m, [self]) => array(r, STRING, state(r, self).applicationProtocols));
  def(LAB, 'setUseSessionTickets', '(Z)V', (r, _m, [self, on]) => { state(r, self).useTickets = !!on; });
  const unsupported = what => (r) => javaThrow(r, 'Ljava/lang/UnsupportedOperationException;', `${what} is not available: the lab SSLSocket does no TLS itself (the browser's fetch does)`);
  def(LAB, 'setApplicationProtocolSelector', '(Lcom/android/org/conscrypt/ApplicationProtocolSelectorAdapter;)V', unsupported('SSLSocket.setHandshakeApplicationProtocolSelector'));
  def(LAB, 'setApplicationProtocolSelector', '(Lcom/android/org/conscrypt/ApplicationProtocolSelector;)V', unsupported('ApplicationProtocolSelector'));
  def(LAB, 'setChannelIdEnabled', '(Z)V', unsupported('Channel ID'));
  def(LAB, 'getChannelId', '()[B', unsupported('Channel ID'));
  def(LAB, 'setChannelIdPrivateKey', '(Ljava/security/PrivateKey;)V', unsupported('Channel ID'));
  def(LAB, 'getTlsUnique', '()[B', unsupported('tls-unique channel binding'));
  def(LAB, 'exportKeyingMaterial', `(${STRING}[BI)[B`, unsupported('exportKeyingMaterial'));

  // ---- configuration
  const checked = (r, values, supported, what, create) => {
    if (values === null) javaThrow(r, 'Ljava/lang/IllegalArgumentException;', `${what} == null`);
    const items = r.object(values).elements.map(item => text(r, item));
    for (const item of items) if (item === null) javaThrow(r, 'Ljava/lang/IllegalArgumentException;', `${what} contains null`); else if (!supported.includes(item)) javaThrow(r, 'Ljava/lang/IllegalArgumentException;', create(item));
    return items;
  };
  def(LAB, 'getSupportedCipherSuites', `()[${STRING}`, r => array(r, STRING, SUPPORTED_SUITES));
  def(LAB, 'getEnabledCipherSuites', `()[${STRING}`, (r, _m, [self]) => array(r, STRING, state(r, self).suites));
  def(LAB, 'setEnabledCipherSuites', `([${STRING})V`, (r, _m, [self, suites]) => { state(r, self).suites = checked(r, suites, SUPPORTED_SUITES, 'cipherSuites', item => `Invalid cipher suite: ${item}`); });
  def(LAB, 'getSupportedProtocols', `()[${STRING}`, r => array(r, STRING, SUPPORTED_PROTOCOLS));
  def(LAB, 'getEnabledProtocols', `()[${STRING}`, (r, _m, [self]) => array(r, STRING, state(r, self).protocols));
  def(LAB, 'setEnabledProtocols', `([${STRING})V`, (r, _m, [self, protocols]) => { state(r, self).protocols = checked(r, protocols, SUPPORTED_PROTOCOLS, 'protocols', item => `Protocol ${item} is not supported.`); });
  def(LAB, 'setUseClientMode', '(Z)V', (r, _m, [self, on]) => { const tls = state(r, self); if (tls.handshaken) javaThrow(r, 'Ljava/lang/IllegalArgumentException;', 'Cannot change mode after handshake.'); tls.clientMode = !!on; });
  def(LAB, 'getUseClientMode', '()Z', (r, _m, [self]) => (state(r, self).clientMode ? 1 : 0));
  def(LAB, 'setNeedClientAuth', '(Z)V', (r, _m, [self, on]) => { const tls = state(r, self); tls.needAuth = !!on; tls.wantAuth = false; });
  def(LAB, 'getNeedClientAuth', '()Z', (r, _m, [self]) => (state(r, self).needAuth ? 1 : 0));
  def(LAB, 'setWantClientAuth', '(Z)V', (r, _m, [self, on]) => { const tls = state(r, self); tls.wantAuth = !!on; tls.needAuth = false; });
  def(LAB, 'getWantClientAuth', '()Z', (r, _m, [self]) => (state(r, self).wantAuth ? 1 : 0));
  def(LAB, 'setEnableSessionCreation', '(Z)V', (r, _m, [self, on]) => { state(r, self).sessionCreation = !!on; });
  def(LAB, 'getEnableSessionCreation', '()Z', (r, _m, [self]) => (state(r, self).sessionCreation ? 1 : 0));
  def(LAB, 'getSSLParameters', `()${SSL_PARAMETERS}`, (r, _m, [self]) => {
    const tls = state(r, self), parameters = construct(r, SSL_PARAMETERS, [`[${STRING}`, `[${STRING}`], [array(r, STRING, tls.suites), array(r, STRING, tls.protocols)]);
    call(r, SSL_PARAMETERS, 'setApplicationProtocols', [`[${STRING}`], 'V', [parameters, array(r, STRING, tls.applicationProtocols)]);
    call(r, SSL_PARAMETERS, 'setNeedClientAuth', ['Z'], 'V', [parameters, tls.needAuth ? 1 : 0]); call(r, SSL_PARAMETERS, 'setWantClientAuth', ['Z'], 'V', [parameters, tls.wantAuth ? 1 : 0]);
    const name = hostText(r, self);
    if (name && !/^[\d.]+$/.test(name) && !name.includes(':')) { const list = call(r, 'Ljava/util/Collections;', 'singletonList', [OBJECT], 'Ljava/util/List;', [construct(r, 'Ljavax/net/ssl/SNIHostName;', [STRING], [name])], 'static'); call(r, SSL_PARAMETERS, 'setServerNames', ['Ljava/util/List;'], 'V', [parameters, list]); }
    return parameters;
  });
  def(LAB, 'setSSLParameters', `(${SSL_PARAMETERS})V`, (r, _m, [self, parameters]) => {
    if (parameters === null) javaThrow(r, 'Ljava/lang/NullPointerException;', 'p == null');
    const tls = state(r, self), strings = (name) => { const value = call(r, SSL_PARAMETERS, name, [], `[${STRING}`, [parameters]); return value === null ? null : r.object(value).elements.map(item => text(r, item)); };
    const suites = strings('getCipherSuites'), protocols = strings('getProtocols'), applicationProtocols = strings('getApplicationProtocols');
    if (suites) tls.suites = checked(r, array(r, STRING, suites), SUPPORTED_SUITES, 'cipherSuites', item => `Invalid cipher suite: ${item}`);
    if (protocols) tls.protocols = checked(r, array(r, STRING, protocols), SUPPORTED_PROTOCOLS, 'protocols', item => `Protocol ${item} is not supported.`);
    if (applicationProtocols) tls.applicationProtocols = applicationProtocols;
    if (call(r, SSL_PARAMETERS, 'getNeedClientAuth', [], 'Z', [parameters])) { tls.needAuth = true; tls.wantAuth = false; } else if (call(r, SSL_PARAMETERS, 'getWantClientAuth', [], 'Z', [parameters])) { tls.wantAuth = true; tls.needAuth = false; } else { tls.needAuth = false; tls.wantAuth = false; }
    const names = call(r, SSL_PARAMETERS, 'getServerNames', [], 'Ljava/util/List;', [parameters]);
    if (names !== null) {
      const size = Number(call(r, 'Ljava/util/List;', 'size', [], 'I', [names]));
      for (let i = 0; i < size; i++) { const item = call(r, 'Ljava/util/List;', 'get', ['I'], OBJECT, [names, i]); if (r.isSubtype(r.object(item).type, 'Ljavax/net/ssl/SNIHostName;')) { call(r, ACS, 'setHostname', [STRING], 'V', [self, call(r, 'Ljavax/net/ssl/SNIHostName;', 'getAsciiName', [], STRING, [item])], 'direct'); break; } }
    }
  });
  // close(): a wrapper closes the raw socket when autoClose says so (Conscrypt's own rule); a socket that is its own transport closes itself
  def(LAB, 'close', '()V', (r, _m, [self]) => {
    const raw = rawSocketOf(r, self);
    if (!raw || raw === self) call(r, SOCKET, 'close', [], 'V', [self], 'direct'); else call(r, ACS, 'close', [], 'V', [self], 'direct');
    return undefined;
  });

  // ---- construction (the factory in src/security-host.js calls these)
  /** Creates the lab socket through one of OpenSSLSocketImpl's constructors, then prepares its certificate chain (Blocked until WebCrypto produced it). */
  const make = (r, factory, parameters, args, host) => {
    const authority = authorityOf(r);
    if (!authority.available) javaThrow(r, 'Ljavax/net/ssl/SSLException;', 'The lab transport CA cannot be generated: WebCrypto SubtleCrypto is not available in this page (TLS sockets need ECDSA P-256 signing)');
    if (host) { const waiting = chainFor(r, host.toLowerCase(), 'TLS sockets need WebCrypto (ECDSA P-256) in the page'); if (waiting instanceof Blocked) return waiting; }
    const self = r.allocate(LAB);
    r.dispatch({ owner: OSI, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: self }), 'direct');
    const tls = state(r, self); tls.certHost = host ? host.toLowerCase() : null;
    r.storeField(r.object(self).fields, TRUST_KEY, r.object(factory).fields.get(TRUST_KEY) ?? null);
    r.storeField(r.object(self).fields, KEYS_KEY, r.object(factory).fields.get(KEYS_KEY) ?? null); tls.defaultFactory = r.object(factory).labDefault === true;
    const raw = rawSocketOf(r, self); httpSocketOf(r, !raw || raw === self ? self : raw)?.markTls(host);   // a TLS socket's requests are https from the start; startHandshake() confirms it
    return self;
  };
  return {
    wrap: (r, factory, socket, host, port, autoClose) => make(r, factory, [SOCKET, STRING, 'I', 'Z'], [socket, host, port, autoClose], host === null ? null : text(r, host)),
    connected: (r, factory, parameters, args, host) => make(r, factory, parameters, args, host),
    unconnected: (r, factory) => make(r, factory, [], [], null),
    /** The CA certificate object (Blocked until the authority started; null when WebCrypto is missing). */
    authorityCertificate(r) {
      const authority = authorityOf(r); if (!authority.available) return null;
      if (!authority.ca) { authority.start().catch(() => {}); if (authority.starting && !authority.startFailed) return new Blocked({ ready: () => !!authority.ca || authority.startFailed, retry: true, interruptible: false, reason: 'lab transport CA' }); return null; }
      if (authority.caJava) return authority.caJava;
      const factory = call(r, CERT_FACTORY, 'getInstance', [STRING], CERT_FACTORY, ['X.509'], 'static'), stream = construct(r, 'Ljava/io/ByteArrayInputStream;', ['[B'], [byteArray(r, authority.ca.der)]);
      authority.caJava = call(r, CERT_FACTORY, 'generateCertificate', ['Ljava/io/InputStream;'], CERT, [factory, stream]); (r.hostStaticValues ??= []).push(authority.caJava); return authority.caJava;
    },
    /** True when the chain (X509Certificate[]) is made of certificates the lab authority issued. */
    isLabChain: (r, chain) => authorityOf(r).isLabChain(r.object(chain).elements.map(cert => bytesOf(r, call(r, CERT, 'getEncoded', [], '[B', [cert])))),
  };
}
