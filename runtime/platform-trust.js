// The platform's default X509TrustManager (what TrustManagerFactory.getInstance("PKIX").init((KeyStore) null) gives an app on Android 7+): the network security config's
// RootTrustManager (android.security.net.config, android-13.0.0_r1) over Conscrypt's TrustManagerImpl (pinned original in the framework DEX). The trust decision is the original
// Java: TrustManagerImpl builds and validates the path (CertPathValidator PKIX over BoringSSL) to an anchor of
//   * the KeyStore "AndroidCAStore" (Conscrypt's TrustedCertificateKeyStoreSpi over TrustedCertificateStore: the AOSP android-13.0.0_r1 system CA set in
//     /system/etc/security/cacerts, src/ca-certificates-data.js, and the user CAs in /data/misc/keychain/cacerts-added), filtered to what the app's network security config
//     trusts for that host (system, user, @raw certificates, debug-overrides of a debuggable app; the default is system only from targetSdk 24, system + user below);
//   * or, after init(keyStore) with an app's own KeyStore, exactly that KeyStore's certificates.
// NetworkSecurityTrustManager's pin check (<pin-set>, SHA-256 of the SubjectPublicKeyInfo of a certificate of the verified chain, unless expired or the anchor overrides pins)
// runs on the verified chain. Nothing here accepts a chain the original classes reject.
// One addition, the lab's own: a chain made of certificates the lab transport CA issued (src/transport-ca.js: an SSLSocket over a virtual HTTP socket, whose real TLS the browser
// did and validated) is accepted for servers, as before. A native TLS stack (BoringSSL in an app's .so through the raw TCP tunnel) presents the server's real chain, which only
// the path above can accept.
import { trustPolicy } from './network-native.js?v=803d82a8b127';
import { Sha256 } from './fast-digests.js?v=803d82a8b127';

const STRING = 'Ljava/lang/String;', X509 = 'Ljava/security/cert/X509Certificate;', CERT = 'Ljava/security/cert/Certificate;', KEYSTORE = 'Ljava/security/KeyStore;', LIST = 'Ljava/util/List;';
const TMI_IMPL = 'Lcom/android/org/conscrypt/TrustManagerImpl;', CERT_FACTORY = 'Ljava/security/cert/CertificateFactory;', OBJECT = 'Ljava/lang/Object;';
const CA_STORE = 'AndroidCAStore';
export const DOMAIN_NEEDS_HOST = 'Domain specific configurations require that hostname aware checkServerTrusted(X509Certificate[], String, String) is used';
export const PIN_FAILED = 'Pin verification failed';

const call = (r, owner, name, parameters, result, args, mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, mode === 'static' ? r.argumentWords(parameters, args, {}) : r.argumentWords(parameters, args.slice(1), { receiver: args[0] }), mode);
const construct = (r, owner, parameters, args) => { const self = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: self }), 'direct'); return self; };
const byteArray = (r, bytes) => { const a = r.newArray('[B', bytes.length); r.object(a).elements = Array.from(bytes, v => (v << 24) >> 24); return a; };
const bytesOf = (r, ref) => Uint8Array.from(r.object(ref).elements, v => v & 255);
const keep = (r, ref) => { (r.hostStaticValues ??= []).push(ref); return ref; };
const isNull = v => v === null || v === undefined || v === 0;
const base64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const sha256 = bytes => { const h = new Sha256(); h.update(bytes); return h.digest(); };

/** Per runtime: the loaded AndroidCAStore, its aliases, and one TrustManagerImpl per distinct anchor set. */
const stateOf = r => r.platformTrust ??= { caStore: null, aliases: null, managers: new Map(), certs: new Map() };
function caStore(r) {
  const s = stateOf(r);
  if (!s.caStore) {
    const ks = call(r, KEYSTORE, 'getInstance', [STRING], KEYSTORE, [CA_STORE], 'static');
    call(r, KEYSTORE, 'load', ['Ljava/security/KeyStore$LoadStoreParameter;'], 'V', [ks, null]);
    s.caStore = keep(r, ks);
  }
  return s.caStore;
}
/** The aliases of AndroidCAStore ("system:<hash>.<n>" not deleted, "user:<hash>.<n>"), listed once per runtime like TrustedCertificateStore.aliases(). */
function caAliases(r) {
  const s = stateOf(r);
  if (!s.aliases) {
    const e = call(r, KEYSTORE, 'aliases', [], 'Ljava/util/Enumeration;', [caStore(r)]), out = [];
    while (call(r, 'Ljava/util/Enumeration;', 'hasMoreElements', [], 'Z', [e])) out.push(r.stringCharacters(call(r, 'Ljava/util/Enumeration;', 'nextElement', [], OBJECT, [e])));
    s.aliases = out;
  }
  return s.aliases;
}
/** The certificates of an @raw (or any resource) file: PEM or DER, one or several (CertificateFactory.generateCertificates, as ResourceCertificateSource does). */
function resourceCertificates(r, resource) {
  const s = stateOf(r); if (s.certs.has(resource.resource)) return s.certs.get(resource.resource);
  const entry = r.resources?.table?.resolve(resource.resource);
  if (!entry || entry.kind !== 'string' || typeof entry.value !== 'string') r.throwJava('Ljava/lang/RuntimeException;', `Failed to load trust anchors from id 0x${resource.resource.toString(16)}: not a file of the package`);
  const factory = call(r, CERT_FACTORY, 'getInstance', [STRING], CERT_FACTORY, ['X.509'], 'static');
  const stream = construct(r, 'Ljava/io/ByteArrayInputStream;', ['[B'], [byteArray(r, r.apkReader(entry.value))]);
  const collection = call(r, CERT_FACTORY, 'generateCertificates', ['Ljava/io/InputStream;'], 'Ljava/util/Collection;', [factory, stream]);
  const list = [...r.array(call(r, 'Ljava/util/Collection;', 'toArray', [], '[Ljava/lang/Object;', [collection])).elements].map(c => keep(r, c));
  s.certs.set(resource.resource, list); return list;
}
/** The TrustManagerImpl for an anchor set of the network security config (cached by its sources). */
function managerFor(r, anchors) {
  const key = JSON.stringify(anchors.map(a => a.source)), s = stateOf(r);
  if (s.managers.has(key)) return s.managers.get(key);
  const system = anchors.some(a => a.source === 'system'), user = anchors.some(a => a.source === 'user'), resources = anchors.filter(a => typeof a.source === 'object');
  const aliases = caAliases(r), hasUser = aliases.some(a => a.startsWith('user:'));
  let keyStore;
  if (system && (user || !hasUser) && resources.length === 0) keyStore = caStore(r);   // exactly the AndroidCAStore: TrustManagerImpl loads its anchors lazily
  else {
    keyStore = call(r, KEYSTORE, 'getInstance', [STRING], KEYSTORE, [call(r, KEYSTORE, 'getDefaultType', [], STRING, [], 'static')], 'static');
    call(r, KEYSTORE, 'load', ['Ljava/security/KeyStore$LoadStoreParameter;'], 'V', [keyStore, null]);
    const put = (alias, cert) => call(r, KEYSTORE, 'setCertificateEntry', [STRING, CERT], 'V', [keyStore, alias, cert]);
    for (const alias of aliases) if ((system && alias.startsWith('system:')) || (user && alias.startsWith('user:'))) put(alias, call(r, KEYSTORE, 'getCertificate', [STRING], CERT, [caStore(r), alias]));
    resources.forEach((a, i) => resourceCertificates(r, a.source).forEach((cert, j) => put(`resource:${i}:${j}`, cert)));
  }
  const manager = keep(r, construct(r, TMI_IMPL, [KEYSTORE], [keyStore]));
  s.managers.set(key, manager); return manager;
}
const derOf = (r, cert) => bytesOf(r, call(r, CERT, 'getEncoded', [], '[B', [cert]));
const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
/** True when `cert` is in AndroidCAStore under `prefix` (TrustedCertificateStore.getCertificateAlias: the stored certificate equal to it). */
function storedAs(r, cert, prefix) {
  const alias = call(r, KEYSTORE, 'getCertificateAlias', [CERT], STRING, [caStore(r), cert]);
  return !isNull(alias) && r.stringCharacters(alias).startsWith(prefix);
}
/** NetworkSecurityTrustManager.checkPins: a <pin-set> that applies and has not expired needs one certificate of the verified chain to match, unless its anchor overrides pins. */
function checkPins(r, policy, verified) {
  const pins = policy.pins; if (!pins || pins.pins.length === 0) return;
  if (pins.expiration !== null && pins.expiration < Date.now()) return;
  const chain = []; for (let i = 0, n = call(r, LIST, 'size', [], 'I', [verified]); i < n; i++) chain.push(call(r, LIST, 'get', ['I'], OBJECT, [verified, i]));
  const root = chain[chain.length - 1];
  if (root !== undefined) for (const anchor of policy.anchors.filter(a => a.overridePins)) {
    if (anchor.source === 'system' || anchor.source === 'user') { if (storedAs(r, root, `${anchor.source}:`)) return; }
    else { const der = derOf(r, root); if (resourceCertificates(r, anchor.source).some(cert => sameBytes(derOf(r, cert), der))) return; }
  }
  const wanted = new Set(pins.pins);
  for (const cert of chain) {
    const key = call(r, CERT, 'getPublicKey', [], 'Ljava/security/PublicKey;', [cert]);
    if (wanted.has(base64(sha256(bytesOf(r, call(r, 'Ljava/security/Key;', 'getEncoded', [], '[B', [key])))))) return;
  }
  r.throwJava('Ljava/security/cert/CertificateException;', PIN_FAILED);
}

/**
 * TrustManagerFactory.init(keyStore) with an app's own KeyStore: the TrustManagerImpl over it, built at once (its anchors are the KeyStore's certificates at init time, as
 * RootTrustManagerFactorySpi's KeyStoreCertificateSource on Android). The caller keeps it reachable (a field of the LabTrustManager).
 */
export const keyStoreManager = (r, keyStore) => construct(r, TMI_IMPL, [KEYSTORE], [keyStore]);

/**
 * The platform trust of one LabTrustManager: `fixed` is its keyStoreManager (null: the network security config, whose TrustManagerImpls are built on first use per anchor
 * set and kept per runtime). Returns the operations the host methods call; every rejection is the CertificateException the original classes throw.
 */
export function platformTrust(r, fixed) {
  const own = !isNull(fixed);
  const policyFor = host => own ? null : trustPolicy(r, host);
  const managerOf = host => own ? fixed : managerFor(r, policyFor(host).anchors);
  return {
    /** checkServerTrusted(chain, authType, host) -> the verified chain (java.util.List). */
    server(chain, authType, host) {
      if (own) return call(r, TMI_IMPL, 'checkServerTrusted', [`[${X509}`, STRING, STRING], LIST, [fixed, chain, authType, host]);
      const policy = policyFor(host), verified = call(r, TMI_IMPL, 'checkServerTrusted', [`[${X509}`, STRING, STRING], LIST, [managerFor(r, policy.anchors), chain, authType, host]);
      checkPins(r, policy, verified); return verified;
    },
    /** checkServerTrusted(chain, authType) without a host: the base config, refused when the config has domain-specific configurations (RootTrustManager). */
    serverWithoutHost(chain, authType) {
      if (!own && policyFor(null).hasDomainConfigs) r.throwJava('Ljava/security/cert/CertificateException;', DOMAIN_NEEDS_HOST);
      call(r, TMI_IMPL, 'checkServerTrusted', [`[${X509}`, STRING], 'V', [managerOf(null), chain, authType]);
    },
    client(chain, authType) { call(r, TMI_IMPL, 'checkClientTrusted', [`[${X509}`, STRING], 'V', [managerOf(null), chain, authType]); },
    acceptedIssuers() { return [...r.array(call(r, TMI_IMPL, 'getAcceptedIssuers', [], `[${X509}`, [managerOf(null)])).elements]; },
    /** X509TrustManagerExtensions.isUserAddedCertificate: the certificate is one of the user CAs (TrustedCertificateStore). */
    isUserAdded(cert) { return storedAs(r, cert, 'user:'); },
    /** X509TrustManagerExtensions.isSameTrustConfiguration(hostA, hostB). */
    sameConfiguration(a, b) { if (own) return true; const pa = policyFor(a), pb = policyFor(b); return JSON.stringify([pa.anchors, pa.pins]) === JSON.stringify([pb.anchors, pb.pins]); },
  };
}
