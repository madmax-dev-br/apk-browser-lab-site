import { APKError } from './apk-error.js?v=00979d36e5ab';
import { createHostRegistry } from './host-contract.js?v=00979d36e5ab';
import { DIGESTS } from './crypto-host.js?v=00979d36e5ab';

// javax.crypto (Cipher, Mac, KeyGenerator, SecretKeyFactory, the key/parameter specs) and the Android Keystore surface (KeyStore "AndroidKeyStore", KeyGenParameterSpec, KeyProperties),
// in synchronous pure JavaScript (the VM is synchronous, WebCrypto is not). Algorithms: AES (128/192/256) in ECB, CBC, CTR and GCM with PKCS5/PKCS7 or no padding, HMAC over
// MD5/SHA-1/SHA-2, PBKDF2WithHmac*. Keys of the Android Keystore live in the VM (software-backed: the app sees opaque keys that cannot be extracted, as on a device without
// StrongBox, and the key material never reaches app memory). Not implemented, and refused explicitly: RSA/EC ciphers, signatures and key pairs, ChaCha20, DES.
// (Tink's pure-Java AES-SIV/CMAC need only AES/ECB and AES/CTR, which are here.)
// Contracts: javax.crypto.Cipher / Mac / KeyGenerator / SecretKeyFactory (android-13.0.0_r1 libcore + Conscrypt behaviour: random IV on encryption, AEADBadTagException,
// GCM key+IV reuse refused), android.security.keystore.KeyGenParameterSpec / KeyProperties.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', BYTES = '[B', CHARS = '[C';
const KEY = 'Ljava/security/Key;', SECRET_KEY = 'Ljavax/crypto/SecretKey;', SPEC = 'Ljava/security/spec/AlgorithmParameterSpec;', KEY_SPEC = 'Ljava/security/spec/KeySpec;', SECURE_RANDOM = 'Ljava/security/SecureRandom;';
const CIPHER = 'Ljavax/crypto/Cipher;', MAC = 'Ljavax/crypto/Mac;', KEY_GENERATOR = 'Ljavax/crypto/KeyGenerator;', SECRET_KEY_FACTORY = 'Ljavax/crypto/SecretKeyFactory;';
const SECRET_KEY_SPEC = 'Ljavax/crypto/spec/SecretKeySpec;', IV_SPEC = 'Ljavax/crypto/spec/IvParameterSpec;', GCM_SPEC = 'Ljavax/crypto/spec/GCMParameterSpec;', PBE_SPEC = 'Ljavax/crypto/spec/PBEKeySpec;';
const ANDROID_KEY = 'Landroid/security/keystore/AndroidKeyStoreSecretKey;', KEY_PROPERTIES = 'Landroid/security/keystore/KeyProperties;', GEN_SPEC = 'Landroid/security/keystore/KeyGenParameterSpec;', GEN_BUILDER = 'Landroid/security/keystore/KeyGenParameterSpec$Builder;';
const AEAD_BAD_TAG = 'Ljavax/crypto/AEADBadTagException;', BAD_PADDING = 'Ljavax/crypto/BadPaddingException;', BLOCK_SIZE_EXCEPTION = 'Ljavax/crypto/IllegalBlockSizeException;', NO_ALGORITHM = 'Ljava/security/NoSuchAlgorithmException;', NO_PADDING = 'Ljavax/crypto/NoSuchPaddingException;';
const PROVIDER = 'Ljava/security/Provider;', INVALID_KEY = 'Ljava/security/InvalidKeyException;', INVALID_PARAMETER = 'Ljava/security/InvalidAlgorithmParameterException;';
const fail = (message, details = {}) => { throw new APKError(message, { kind: 'jce-unsupported', ...details }); };

// ---- AES ------------------------------------------------------------------------------------------------------------------------------------------------
const SBOX = new Uint8Array(256), INV_SBOX = new Uint8Array(256);
(() => {
  const rotl8 = (x, n) => ((x << n) | (x >> (8 - n))) & 255; let p = 1, q = 1;
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x11b : 0)) & 255; q ^= q << 1; q ^= q << 2; q ^= q << 4; q = (q ^ (q & 0x80 ? 0x09 : 0)) & 255;
    SBOX[p] = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 255;
  } while (p !== 1);
  SBOX[0] = 0x63; for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
})();
const xtime = x => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 255;
const gmul = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xtime(a); b >>= 1; } return r; };
function expandKey(key) {
  if (![16, 24, 32].includes(key.length)) throw new Error('bad AES key length');
  const nk = key.length / 4, rounds = nk + 6, w = new Uint8Array(16 * (rounds + 1)); w.set(key); let rcon = 1;
  for (let i = nk; i < 4 * (rounds + 1); i++) {
    let t = w.slice((i - 1) * 4, i * 4);
    if (i % nk === 0) { t = Uint8Array.of(SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]); rcon = xtime(rcon); } else if (nk > 6 && i % nk === 4) t = t.map(b => SBOX[b]);
    for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - nk) * 4 + j] ^ t[j];
  }
  return { w, rounds };
}
function encryptBlock({ w, rounds }, input) {
  const s = Uint8Array.from(input); const addKey = r => { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; };
  addKey(0);
  for (let round = 1; round <= rounds; round++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    const t = Uint8Array.from(s); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[c * 4 + r] = t[((c + r) % 4) * 4 + r];   // ShiftRows
    if (round < rounds) for (let c = 0; c < 4; c++) { const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3]; s[c * 4] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3; s[c * 4 + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3; s[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3); s[c * 4 + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3); }
    addKey(round);
  }
  return s;
}
function decryptBlock({ w, rounds }, input) {
  const s = Uint8Array.from(input); const addKey = r => { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; };
  addKey(rounds);
  for (let round = rounds - 1; round >= 0; round--) {
    const t = Uint8Array.from(s); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) s[((c + r) % 4) * 4 + r] = t[c * 4 + r];   // InvShiftRows
    for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
    addKey(round);
    if (round > 0) for (let c = 0; c < 4; c++) { const a0 = s[c * 4], a1 = s[c * 4 + 1], a2 = s[c * 4 + 2], a3 = s[c * 4 + 3]; s[c * 4] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9); s[c * 4 + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13); s[c * 4 + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11); s[c * 4 + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14); }
  }
  return s;
}
const xor = (a, b) => Uint8Array.from(a, (v, i) => v ^ b[i]);
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
const inc32 = block => { const out = Uint8Array.from(block); for (let i = 15; i >= 12; i--) { out[i] = (out[i] + 1) & 255; if (out[i]) break; } return out; };
const incBlock = block => { const out = Uint8Array.from(block); for (let i = 15; i >= 0; i--) { out[i] = (out[i] + 1) & 255; if (out[i]) break; } return out; };
// GCM (NIST SP 800-38D): GHASH over GF(2^128) with BigInt blocks.
const toBig = bytes => { let v = 0n; for (const b of bytes) v = (v << 8n) | BigInt(b); return v; };
const fromBig = v => Uint8Array.from({ length: 16 }, (_x, i) => Number((v >> BigInt(120 - 8 * i)) & 0xffn));
const R = 0xe1n << 120n;
function gfMul(x, y) { let z = 0n, v = y; for (let i = 127; i >= 0; i--) { if ((x >> BigInt(i)) & 1n) z ^= v; v = v & 1n ? (v >> 1n) ^ R : v >> 1n; } return z; }
function ghash(h, aad, data) {
  const H = toBig(h); let y = 0n;
  const feed = bytes => { for (let at = 0; at < bytes.length; at += 16) { const block = new Uint8Array(16); block.set(bytes.subarray(at, Math.min(at + 16, bytes.length))); y = gfMul(y ^ toBig(block), H); } };
  feed(aad); feed(data);
  const lengths = new Uint8Array(16), view = new DataView(lengths.buffer); view.setBigUint64(0, BigInt(aad.length) * 8n); view.setBigUint64(8, BigInt(data.length) * 8n);
  y = gfMul(y ^ toBig(lengths), H); return fromBig(y);
}
function gcm(key, iv, aad, input, tagBytes, encrypt) {
  const h = encryptBlock(key, new Uint8Array(16)), j0 = iv.length === 12 ? concat(iv, Uint8Array.of(0, 0, 0, 1)) : ghash(h, new Uint8Array(0), iv);
  const ctr = (data) => { const out = new Uint8Array(data.length); let counter = inc32(j0); for (let at = 0; at < data.length; at += 16) { const stream = encryptBlock(key, counter); for (let i = 0; i < 16 && at + i < data.length; i++) out[at + i] = data[at + i] ^ stream[i]; counter = inc32(counter); } return out; };
  if (encrypt) { const ct = ctr(input), tag = xor(encryptBlock(key, j0), ghash(h, aad, ct)).subarray(0, tagBytes); return { output: concat(ct, tag) }; }
  if (input.length < tagBytes) return { error: 'short' };
  const ct = input.subarray(0, input.length - tagBytes), tag = input.subarray(input.length - tagBytes), expected = xor(encryptBlock(key, j0), ghash(h, aad, ct)).subarray(0, tagBytes);
  let diff = 0; for (let i = 0; i < tagBytes; i++) diff |= tag[i] ^ expected[i];
  return diff ? { error: 'tag' } : { output: ctr(ct) };
}
// ---- HMAC / PBKDF2 --------------------------------------------------------------------------------------------------------------------------------------
const HMACS = { HmacMD5: ['MD5', 64], HmacSHA1: ['SHA-1', 64], HmacSHA224: ['SHA-224', 64], HmacSHA256: ['SHA-256', 64], HmacSHA384: ['SHA-384', 128], HmacSHA512: ['SHA-512', 128] };
export function hmac(algorithm, key, data) {
  const [digest, block] = HMACS[algorithm], fn = DIGESTS[digest].fn;
  let k = key.length > block ? fn(key) : key; const padded = new Uint8Array(block); padded.set(k);
  const inner = fn(concat(padded.map(b => b ^ 0x36), data)); return fn(concat(padded.map(b => b ^ 0x5c), inner));
}
export function pbkdf2(algorithm, password, salt, iterations, keyBytes) {
  const [digest] = HMACS[algorithm], hLen = DIGESTS[digest].length, blocks = Math.ceil(keyBytes / hLen), out = new Uint8Array(blocks * hLen);
  for (let i = 1; i <= blocks; i++) {
    let u = hmac(algorithm, password, concat(salt, Uint8Array.of(i >>> 24, (i >>> 16) & 255, (i >>> 8) & 255, i & 255))), t = Uint8Array.from(u);
    for (let n = 1; n < iterations; n++) { u = hmac(algorithm, password, u); for (let j = 0; j < t.length; j++) t[j] ^= u[j]; }
    out.set(t, (i - 1) * hLen);
  }
  return out.slice(0, keyBytes);
}
const randomBytes = n => { if (!globalThis.crypto?.getRandomValues) fail('WebCrypto secure randomness is unavailable'); const out = new Uint8Array(n); for (let at = 0; at < n; at += 65536) globalThis.crypto.getRandomValues(out.subarray(at, Math.min(n, at + 65536))); return out; };

const PURPOSES = { ENCRYPT: 1, DECRYPT: 2, SIGN: 4, VERIFY: 8, WRAP_KEY: 32, AGREE_KEY: 64, ATTEST_KEY: 128 };
const KEY_PROPERTY_STRINGS = {
  KEY_ALGORITHM_AES: 'AES', KEY_ALGORITHM_EC: 'EC', KEY_ALGORITHM_RSA: 'RSA', KEY_ALGORITHM_HMAC_SHA1: 'HmacSHA1', KEY_ALGORITHM_HMAC_SHA224: 'HmacSHA224', KEY_ALGORITHM_HMAC_SHA256: 'HmacSHA256', KEY_ALGORITHM_HMAC_SHA384: 'HmacSHA384', KEY_ALGORITHM_HMAC_SHA512: 'HmacSHA512',
  BLOCK_MODE_ECB: 'ECB', BLOCK_MODE_CBC: 'CBC', BLOCK_MODE_CTR: 'CTR', BLOCK_MODE_GCM: 'GCM', ENCRYPTION_PADDING_NONE: 'NoPadding', ENCRYPTION_PADDING_PKCS7: 'PKCS7Padding', ENCRYPTION_PADDING_RSA_PKCS1: 'PKCS1Padding', ENCRYPTION_PADDING_RSA_OAEP: 'OAEPPadding',
  SIGNATURE_PADDING_RSA_PKCS1: 'PKCS1', SIGNATURE_PADDING_RSA_PSS: 'PSS', DIGEST_NONE: 'NONE', DIGEST_MD5: 'MD5', DIGEST_SHA1: 'SHA-1', DIGEST_SHA224: 'SHA-224', DIGEST_SHA256: 'SHA-256', DIGEST_SHA384: 'SHA-384', DIGEST_SHA512: 'SHA-512',
};

export function createJceHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const array = (r, element, items) => { const a = r.newArray(`[${element}`, items.length); r.array(a).elements = items; return a; };
  const byteArray = (r, bytes) => { const a = r.newArray(BYTES, bytes.length); r.array(a).elements = Array.from(bytes, v => (v << 24) >> 24); return a; };
  const bytesOf = (r, ref, offset = 0, length = null) => { if (ref === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Null input buffer'); const e = r.array(ref).elements, n = length ?? e.length - offset; if (offset < 0 || n < 0 || offset + n > e.length) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Bad arguments'); return Uint8Array.from(e.slice(offset, offset + n), v => v & 255); };
  const text = (r, v) => v === null ? null : r.stringCharacters(v);
  for (const iface of [KEY, SPEC, KEY_SPEC]) { type(iface, OBJECT); registry.interfaces.set(iface, []); }
  type(SECRET_KEY, OBJECT, [KEY]); registry.interfaces.set(SECRET_KEY, [KEY]);
  type(AEAD_BAD_TAG, BAD_PADDING); def(AEAD_BAD_TAG, '<init>', `(${STRING})V`, (r, _m, [self, message]) => { r.object(self).message = message; }); def(AEAD_BAD_TAG, '<init>', '()V', () => {});

  // ---- key and parameter specs ----------------------------------------------------------------------------------------------------------------------
  type(SECRET_KEY_SPEC, OBJECT, [SECRET_KEY, KEY_SPEC], { allocatable: true }); registry.interfaces.set(SECRET_KEY_SPEC, [SECRET_KEY, KEY_SPEC]);
  const newKey = (r, bytes, algorithm) => { const ref = r.allocate(SECRET_KEY_SPEC); Object.assign(r.object(ref), { keyBytes: Uint8Array.from(bytes), keyAlgorithm: algorithm }); return ref; };
  def(SECRET_KEY_SPEC, '<init>', `(${BYTES}${STRING})V`, (r, _m, [self, key, algorithm]) => { if (key === null || algorithm === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Missing argument'); const b = bytesOf(r, key); if (!b.length) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Empty key'); Object.assign(r.object(self), { keyBytes: b, keyAlgorithm: text(r, algorithm) }); });
  def(SECRET_KEY_SPEC, '<init>', `(${BYTES}II${STRING})V`, (r, _m, [self, key, offset, length, algorithm]) => { if (key === null || algorithm === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Missing argument'); if (r.array(key).elements.length === 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Empty key'); const b = bytesOf(r, key, offset, length); Object.assign(r.object(self), { keyBytes: b, keyAlgorithm: text(r, algorithm) }); });
  def(SECRET_KEY_SPEC, 'getEncoded', `()${BYTES}`, (r, _m, [self]) => byteArray(r, r.object(self).keyBytes));
  def(SECRET_KEY_SPEC, 'getAlgorithm', `()${STRING}`, (r, _m, [self]) => r.object(self).keyAlgorithm);
  def(SECRET_KEY_SPEC, 'getFormat', `()${STRING}`, () => 'RAW');
  def(SECRET_KEY_SPEC, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => { if (self === other) return 1; if (other === null || r.typeOf(other) !== SECRET_KEY_SPEC) return 0; const a = r.object(self), b = r.object(other); return a.keyAlgorithm.toLowerCase() === b.keyAlgorithm.toLowerCase() && a.keyBytes.length === b.keyBytes.length && a.keyBytes.every((v, i) => v === b.keyBytes[i]) ? 1 : 0; });
  def(SECRET_KEY_SPEC, 'hashCode', '()I', (r, _m, [self]) => { const o = r.object(self); let h = 0; o.keyBytes.forEach((b, i) => { h += ((b << 24) >> 24) * (i + 1); }); const s = o.keyAlgorithm.toLowerCase(); let sh = 0; for (const c of s) sh = (Math.imul(sh, 31) + c.charCodeAt(0)) | 0; return (h ^ sh) | 0; });
  type(IV_SPEC, OBJECT, [SPEC], { allocatable: true }); registry.interfaces.set(IV_SPEC, [SPEC]);
  def(IV_SPEC, '<init>', `(${BYTES})V`, (r, _m, [self, iv]) => { if (iv === null) r.throwJava('Ljava/lang/NullPointerException;', 'iv == null'); r.object(self).iv = bytesOf(r, iv); });
  def(IV_SPEC, '<init>', `(${BYTES}II)V`, (r, _m, [self, iv, o, l]) => { if (iv === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'IV missing'); r.object(self).iv = bytesOf(r, iv, o, l); });
  def(IV_SPEC, 'getIV', `()${BYTES}`, (r, _m, [self]) => byteArray(r, r.object(self).iv));
  type(GCM_SPEC, OBJECT, [SPEC], { allocatable: true }); registry.interfaces.set(GCM_SPEC, [SPEC]);
  def(GCM_SPEC, '<init>', `(I${BYTES})V`, (r, _m, [self, tLen, iv]) => { if (tLen < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Length argument is negative'); if (iv === null) r.throwJava('Ljava/lang/NullPointerException;', 'src == null'); Object.assign(r.object(self), { tLen, iv: bytesOf(r, iv) }); });
  def(GCM_SPEC, '<init>', `(I${BYTES}II)V`, (r, _m, [self, tLen, iv, o, l]) => { Object.assign(r.object(self), { tLen, iv: bytesOf(r, iv, o, l) }); });
  def(GCM_SPEC, 'getTLen', '()I', (r, _m, [self]) => r.object(self).tLen); def(GCM_SPEC, 'getIV', `()${BYTES}`, (r, _m, [self]) => byteArray(r, r.object(self).iv));
  type(PBE_SPEC, OBJECT, [KEY_SPEC], { allocatable: true }); registry.interfaces.set(PBE_SPEC, [KEY_SPEC]);
  def(PBE_SPEC, '<init>', `(${CHARS})V`, (r, _m, [self, password]) => { Object.assign(r.object(self), { password: password === null ? [] : [...r.array(password).elements], salt: null, iterations: 0, keyLength: 0 }); });
  def(PBE_SPEC, '<init>', `(${CHARS}${BYTES}I)V`, (r, _m, [self, password, salt, iterations]) => { if (salt === null) r.throwJava('Ljava/lang/NullPointerException;', 'the salt parameter must be non-null'); if (iterations <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'invalid iterationCount value'); Object.assign(r.object(self), { password: password === null ? [] : [...r.array(password).elements], salt: bytesOf(r, salt), iterations, keyLength: 0 }); });
  def(PBE_SPEC, '<init>', `(${CHARS}${BYTES}II)V`, (r, _m, [self, password, salt, iterations, keyLength]) => { if (salt === null) r.throwJava('Ljava/lang/NullPointerException;', 'the salt parameter must be non-null'); if (iterations <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'invalid iterationCount value'); if (keyLength <= 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'invalid keyLength value'); Object.assign(r.object(self), { password: password === null ? [] : [...r.array(password).elements], salt: bytesOf(r, salt), iterations, keyLength }); });
  def(PBE_SPEC, 'getPassword', `()${CHARS}`, (r, _m, [self]) => { const p = r.object(self).password; if (p === null) r.throwJava('Ljava/lang/IllegalStateException;', 'password has been cleared'); const a = r.newArray(CHARS, p.length); r.array(a).elements = [...p]; return a; });
  def(PBE_SPEC, 'getSalt', `()${BYTES}`, (r, _m, [self]) => { const s = r.object(self).salt; return s === null ? null : byteArray(r, s); });
  def(PBE_SPEC, 'getIterationCount', '()I', (r, _m, [self]) => r.object(self).iterations); def(PBE_SPEC, 'getKeyLength', '()I', (r, _m, [self]) => r.object(self).keyLength);
  def(PBE_SPEC, 'clearPassword', '()V', (r, _m, [self]) => { r.object(self).password = null; });

  // ---- Android Keystore keys and the shared (per runtime) AndroidKeyStore entries -----------------------------------------------------------------------
  type(ANDROID_KEY, OBJECT, [SECRET_KEY], { allocatable: true }); registry.interfaces.set(ANDROID_KEY, [SECRET_KEY]);
  const entries = r => r.androidKeyStoreEntries ??= new Map();
  const androidKey = (r, alias, algorithm) => { const ref = r.allocate(ANDROID_KEY); Object.assign(r.object(ref), { alias, keyAlgorithm: algorithm }); return ref; };
  def(ANDROID_KEY, 'getAlgorithm', `()${STRING}`, (r, _m, [self]) => r.object(self).keyAlgorithm); def(ANDROID_KEY, 'getEncoded', `()${BYTES}`, () => null); def(ANDROID_KEY, 'getFormat', `()${STRING}`, () => null);
  /** The key bytes behind any SecretKey object (null for a key this host does not know). */
  const material = (r, key) => {
    if (key === null) return null; const o = r.object(key);
    if (o.keyBytes) return { bytes: o.keyBytes, algorithm: o.keyAlgorithm, spec: null };
    if (o.alias !== undefined && o.type === ANDROID_KEY) { const e = entries(r).get(o.alias); return e ? { bytes: e.bytes, algorithm: e.algorithm, spec: e.spec } : null; }
    return null;
  };
  type(KEY_PROPERTIES, OBJECT);
  for (const [name, value] of Object.entries(PURPOSES)) registry.staticField(KEY_PROPERTIES, 'PURPOSE_' + name, 'I', () => value);
  for (const [name, value] of Object.entries(KEY_PROPERTY_STRINGS)) registry.staticField(KEY_PROPERTIES, name, STRING, () => value);
  for (const [name, value] of Object.entries({ ORIGIN_GENERATED: 1, ORIGIN_IMPORTED: 2, ORIGIN_UNKNOWN: 4, AUTH_BIOMETRIC_STRONG: 1, AUTH_DEVICE_CREDENTIAL: 2, SECURITY_LEVEL_UNKNOWN: -2, SECURITY_LEVEL_UNKNOWN_SECURE: -1, SECURITY_LEVEL_SOFTWARE: 0, SECURITY_LEVEL_TRUSTED_ENVIRONMENT: 1, SECURITY_LEVEL_STRONGBOX: 2 })) registry.staticField(KEY_PROPERTIES, name, 'I', () => value);
  // KeyGenParameterSpec(.Builder): a value object; every setter returns the builder.
  type(GEN_SPEC, OBJECT, [SPEC], { allocatable: true }); registry.interfaces.set(GEN_SPEC, [SPEC]); type(GEN_BUILDER, OBJECT, [], { allocatable: true });
  const specOf = (r, ref) => r.object(ref).spec;
  def(GEN_BUILDER, '<init>', `(${STRING}I)V`, (r, _m, [self, alias, purposes]) => { if (alias === null) r.throwJava('Ljava/lang/NullPointerException;', 'keystoreAlias == null'); if (text(r, alias) === '') r.throwJava('Ljava/lang/IllegalArgumentException;', 'keystoreAlias must not be empty'); r.object(self).spec = { alias: text(r, alias), purposes, blockModes: [], paddings: [], digests: [], signaturePaddings: [], keySize: -1, randomized: true, userAuth: false, strongBox: false, invalidatedByBiometric: true, authValiditySeconds: -1, unlockedDeviceRequired: false }; });
  const stringsOf = (r, ref) => ref === null ? [] : r.array(ref).elements.map(v => text(r, v));
  for (const [name, field] of [['setBlockModes', 'blockModes'], ['setEncryptionPaddings', 'paddings'], ['setDigests', 'digests'], ['setSignaturePaddings', 'signaturePaddings']]) def(GEN_BUILDER, name, `([${STRING})${GEN_BUILDER}`, (r, _m, [self, values]) => { specOf(r, self)[field] = stringsOf(r, values); return self; });
  def(GEN_BUILDER, 'setKeySize', `(I)${GEN_BUILDER}`, (r, _m, [self, size]) => { if (size < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'keySize < 0'); specOf(r, self).keySize = size; return self; });
  for (const [name, field] of [['setRandomizedEncryptionRequired', 'randomized'], ['setUserAuthenticationRequired', 'userAuth'], ['setIsStrongBoxBacked', 'strongBox'], ['setInvalidatedByBiometricEnrollment', 'invalidatedByBiometric'], ['setUnlockedDeviceRequired', 'unlockedDeviceRequired']]) def(GEN_BUILDER, name, `(Z)${GEN_BUILDER}`, (r, _m, [self, value]) => { specOf(r, self)[field] = !!value; return self; });
  def(GEN_BUILDER, 'setUserAuthenticationValidityDurationSeconds', `(I)${GEN_BUILDER}`, (r, _m, [self, seconds]) => { specOf(r, self).authValiditySeconds = seconds; return self; });
  def(GEN_BUILDER, 'setUserAuthenticationParameters', `(II)${GEN_BUILDER}`, (r, _m, [self, seconds]) => { specOf(r, self).authValiditySeconds = seconds; return self; });
  def(GEN_BUILDER, 'build', `()${GEN_SPEC}`, (r, _m, [self]) => { const ref = r.allocate(GEN_SPEC); r.object(ref).spec = { ...specOf(r, self) }; return ref; });
  for (const [name, result, pick] of [['getKeystoreAlias', STRING, s => s.alias], ['getPurposes', 'I', s => s.purposes], ['getKeySize', 'I', s => s.keySize], ['isRandomizedEncryptionRequired', 'Z', s => s.randomized ? 1 : 0], ['isUserAuthenticationRequired', 'Z', s => s.userAuth ? 1 : 0], ['isStrongBoxBacked', 'Z', s => s.strongBox ? 1 : 0], ['isInvalidatedByBiometricEnrollment', 'Z', s => s.invalidatedByBiometric ? 1 : 0], ['getUserAuthenticationValidityDurationSeconds', 'I', s => s.authValiditySeconds]])
    def(GEN_SPEC, name, `()${result}`, (r, _m, [self]) => pick(specOf(r, self)));
  for (const [name, field] of [['getBlockModes', 'blockModes'], ['getEncryptionPaddings', 'paddings'], ['getDigests', 'digests'], ['getSignaturePaddings', 'signaturePaddings']]) def(GEN_SPEC, name, `()[${STRING}`, (r, _m, [self]) => array(r, STRING, [...specOf(r, self)[field]]));

  // ---- KeyGenerator ---------------------------------------------------------------------------------------------------------------------------------
  type(KEY_GENERATOR, OBJECT, [], { allocatable: true });
  const KEYGEN_ALGORITHMS = { AES: 128, HmacSHA1: 160, HmacSHA224: 224, HmacSHA256: 256, HmacSHA384: 384, HmacSHA512: 512 };   // default key sizes in bits
  const newGenerator = (r, name, provider) => {
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'algorithm == null');
    const wanted = text(r, name), canonical = Object.keys(KEYGEN_ALGORITHMS).find(k => k.toLowerCase() === wanted.toLowerCase()); if (!canonical) r.throwJava(NO_ALGORITHM, `${wanted} KeyGenerator not available`);
    const providerName = provider === null ? null : text(r, provider);
    if (providerName !== null && !['AndroidKeyStore', 'AndroidOpenSSL', 'BC'].includes(providerName)) r.throwJava('Ljava/security/NoSuchProviderException;', `no such provider: ${providerName}`);
    const ref = r.allocate(KEY_GENERATOR); Object.assign(r.object(ref), { algorithm: canonical, size: KEYGEN_ALGORITHMS[canonical], keystore: providerName === 'AndroidKeyStore', spec: null }); return ref;
  };
  def(KEY_GENERATOR, 'getInstance', `(${STRING})${KEY_GENERATOR}`, (r, _m, [name]) => newGenerator(r, name, null), { static: true });
  def(KEY_GENERATOR, 'getInstance', `(${STRING}${STRING})${KEY_GENERATOR}`, (r, _m, [name, provider]) => newGenerator(r, name, provider), { static: true });
  def(KEY_GENERATOR, 'getInstance', `(${STRING}${PROVIDER})${KEY_GENERATOR}`, (r, _m, [name]) => newGenerator(r, name, null), { static: true });
  def(KEY_GENERATOR, 'getAlgorithm', `()${STRING}`, (r, _m, [self]) => r.object(self).algorithm);
  const initSize = (r, self, size) => { const g = r.object(self); if (g.keystore) r.throwJava('Ljava/security/InvalidParameterException;', 'Cannot initialize an AndroidKeyStore KeyGenerator with a key size; use KeyGenParameterSpec'); if (g.algorithm === 'AES' && ![128, 192, 256].includes(size)) r.throwJava('Ljava/security/InvalidParameterException;', 'Wrong keysize: must be equal to 128, 192 or 256'); if (size <= 0 || size % 8) r.throwJava('Ljava/security/InvalidParameterException;', 'Key size must be a positive multiple of 8'); g.size = size; };
  def(KEY_GENERATOR, 'init', '(I)V', (r, _m, [self, size]) => initSize(r, self, size));
  def(KEY_GENERATOR, 'init', `(I${SECURE_RANDOM})V`, (r, _m, [self, size]) => initSize(r, self, size));
  const initSpec = (r, self, spec) => {
    const g = r.object(self);
    if (spec === null || r.typeOf(spec) !== GEN_SPEC) r.throwJava(INVALID_PARAMETER, g.keystore ? 'Unsupported params: ' + (spec === null ? 'null' : r.typeOf(spec)) : 'Cannot initialize this KeyGenerator with parameters');
    if (!g.keystore) r.throwJava(INVALID_PARAMETER, 'Cannot initialize this KeyGenerator with parameters');
    const s = { ...specOf(r, spec) }; if (s.keySize < 0) s.keySize = g.algorithm === 'AES' ? 256 : g.size;
    if (g.algorithm === 'AES' && ![128, 192, 256].includes(s.keySize)) r.throwJava(INVALID_PARAMETER, 'Unsupported key size: ' + s.keySize + '. Supported: 128, 192, 256');
    g.spec = s;
  };
  def(KEY_GENERATOR, 'init', `(${SPEC})V`, (r, _m, [self, spec]) => initSpec(r, self, spec));
  def(KEY_GENERATOR, 'init', `(${SPEC}${SECURE_RANDOM})V`, (r, _m, [self, spec]) => initSpec(r, self, spec));
  def(KEY_GENERATOR, 'generateKey', `()${SECRET_KEY}`, (r, _m, [self]) => {
    const g = r.object(self), bytes = randomBytes((g.spec?.keySize ?? g.size) / 8);
    if (!g.keystore) return newKey(r, bytes, g.algorithm);
    if (!g.spec) r.throwJava('Ljava/lang/IllegalStateException;', 'Not initialized');
    entries(r).set(g.spec.alias, { kind: 'key', alias: g.spec.alias, algorithm: g.algorithm, bytes, spec: g.spec, created: platform.clock?.now?.() ?? 0 });
    r.record(`KEYSTORE generated ${g.algorithm}-${bytes.length * 8} key "${g.spec.alias}" (software-backed, non-extractable)`);
    return androidKey(r, g.spec.alias, g.algorithm);
  });
  // KeyStore (AndroidKeyStore) hooks used by security-host.js: the entries of the shared store.
  registry.androidKeyStore = { entries, androidKey, materialOf: material };

  // ---- SecretKeyFactory (PBKDF2) ---------------------------------------------------------------------------------------------------------------------
  type(SECRET_KEY_FACTORY, OBJECT, [], { allocatable: true });
  const PBKDF2 = { 'PBKDF2WITHHMACSHA1': 'HmacSHA1', 'PBKDF2WITHHMACSHA224': 'HmacSHA224', 'PBKDF2WITHHMACSHA256': 'HmacSHA256', 'PBKDF2WITHHMACSHA384': 'HmacSHA384', 'PBKDF2WITHHMACSHA512': 'HmacSHA512' };
  def(SECRET_KEY_FACTORY, 'getInstance', `(${STRING})${SECRET_KEY_FACTORY}`, (r, _m, [name]) => {
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'algorithm == null'); const wanted = text(r, name);
    if (!PBKDF2[wanted.toUpperCase()]) { if (/^(AES|DES|DESede)$/i.test(wanted)) fail(`SecretKeyFactory ${wanted} is not implemented`); r.throwJava(NO_ALGORITHM, `${wanted} SecretKeyFactory not available`); }
    const ref = r.allocate(SECRET_KEY_FACTORY); Object.assign(r.object(ref), { algorithm: wanted, hmac: PBKDF2[wanted.toUpperCase()] }); return ref;
  }, { static: true });
  for (const providerType of [STRING, PROVIDER]) def(SECRET_KEY_FACTORY, 'getInstance', `(${STRING}${providerType})${SECRET_KEY_FACTORY}`, (r, m, [name]) => r.dispatch({ owner: SECRET_KEY_FACTORY, name: 'getInstance', parameters: [STRING], result: SECRET_KEY_FACTORY, signature: `(${STRING})${SECRET_KEY_FACTORY}` }, [name], 'static'), { static: true });
  def(SECRET_KEY_FACTORY, 'getAlgorithm', `()${STRING}`, (r, _m, [self]) => r.object(self).algorithm);
  def(SECRET_KEY_FACTORY, 'generateSecret', `(${KEY_SPEC})${SECRET_KEY}`, (r, _m, [self, spec]) => {
    const f = r.object(self); if (spec === null || r.typeOf(spec) !== PBE_SPEC) r.throwJava('Ljava/security/spec/InvalidKeySpecException;', 'Invalid key spec');
    const s = r.object(spec); if (!s.salt || !s.iterations || !s.keyLength) r.throwJava('Ljava/security/spec/InvalidKeySpecException;', 'Salt not found'); if (s.password === null) r.throwJava('Ljava/lang/IllegalStateException;', 'password has been cleared');
    const password = new TextEncoder().encode(String.fromCharCode(...s.password));
    return newKey(r, pbkdf2(f.hmac, password, s.salt, s.iterations, s.keyLength / 8), f.algorithm);
  });

  const MESSAGE_DIGEST = 'Ljava/security/MessageDigest;';
  for (const providerType of [STRING, PROVIDER]) def(MESSAGE_DIGEST, 'getInstance', `(${STRING}${providerType})${MESSAGE_DIGEST}`, (r, _m, [name]) => r.dispatch({ owner: MESSAGE_DIGEST, name: 'getInstance', parameters: [STRING], result: MESSAGE_DIGEST, signature: `(${STRING})${MESSAGE_DIGEST}` }, [name], 'static'), { static: true });

  // ---- Mac ------------------------------------------------------------------------------------------------------------------------------------------
  type(MAC, OBJECT, [], { allocatable: true });
  def(MAC, 'getInstance', `(${STRING})${MAC}`, (r, _m, [name]) => {
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'algorithm == null'); const wanted = text(r, name), canonical = Object.keys(HMACS).find(k => k.toLowerCase() === wanted.toLowerCase());
    if (!canonical) r.throwJava(NO_ALGORITHM, `No provider found for ${wanted}`);
    const ref = r.allocate(MAC); Object.assign(r.object(ref), { algorithm: canonical, key: null, chunks: [] }); return ref;
  }, { static: true });
  for (const providerType of [STRING, PROVIDER]) def(MAC, 'getInstance', `(${STRING}${providerType})${MAC}`, (r, _m, [name]) => r.dispatch({ owner: MAC, name: 'getInstance', parameters: [STRING], result: MAC, signature: `(${STRING})${MAC}` }, [name], 'static'), { static: true });
  const mac = (r, ref) => r.object(ref);
  const macKey = (r, self, key) => { const m = material(r, key); if (m === null) r.throwJava(INVALID_KEY, 'Only SecretKeySpec or Android Keystore keys are supported'); if (m.spec && !(m.spec.purposes & (PURPOSES.SIGN | PURPOSES.VERIFY))) r.throwJava(INVALID_KEY, 'Key not authorized for HMAC'); mac(r, self).key = m.bytes; mac(r, self).chunks = []; };
  def(MAC, 'init', `(${KEY})V`, (r, _m, [self, key]) => macKey(r, self, key));
  def(MAC, 'init', `(${KEY}${SPEC})V`, (r, _m, [self, key]) => macKey(r, self, key));
  const macState = (r, self) => { const m = mac(r, self); if (!m.key) r.throwJava('Ljava/lang/IllegalStateException;', 'MAC not initialized'); return m; };
  def(MAC, 'update', '(B)V', (r, _m, [self, b]) => macState(r, self).chunks.push(Uint8Array.of(b & 255)));
  def(MAC, 'update', `(${BYTES})V`, (r, _m, [self, a]) => { if (a !== null) macState(r, self).chunks.push(bytesOf(r, a)); });
  def(MAC, 'update', `(${BYTES}II)V`, (r, _m, [self, a, o, l]) => { if (a !== null) macState(r, self).chunks.push(bytesOf(r, a, o, l)); });
  const finishMac = (r, self) => { const m = macState(r, self), out = hmac(m.algorithm, m.key, concat(...m.chunks)); m.chunks = []; return byteArray(r, out); };
  def(MAC, 'doFinal', `()${BYTES}`, (r, _m, [self]) => finishMac(r, self));
  def(MAC, 'doFinal', `(${BYTES})${BYTES}`, (r, _m, [self, a]) => { macState(r, self).chunks.push(bytesOf(r, a)); return finishMac(r, self); });
  def(MAC, 'reset', '()V', (r, _m, [self]) => { mac(r, self).chunks = []; });
  def(MAC, 'getMacLength', '()I', (r, _m, [self]) => DIGESTS[HMACS[mac(r, self).algorithm][0]].length);
  def(MAC, 'getAlgorithm', `()${STRING}`, (r, _m, [self]) => mac(r, self).algorithm);

  // ---- Cipher ---------------------------------------------------------------------------------------------------------------------------------------
  type(CIPHER, OBJECT, [], { allocatable: true });
  for (const [name, value] of [['ENCRYPT_MODE', 1], ['DECRYPT_MODE', 2], ['WRAP_MODE', 3], ['UNWRAP_MODE', 4]]) registry.staticField(CIPHER, name, 'I', () => value);
  def(CIPHER, 'getInstance', `(${STRING})${CIPHER}`, (r, _m, [name]) => newCipher(r, name, null), { static: true });
  def(CIPHER, 'getInstance', `(${STRING}${STRING})${CIPHER}`, (r, _m, [name, provider]) => newCipher(r, name, provider), { static: true });
  def(CIPHER, 'getInstance', `(${STRING}${PROVIDER})${CIPHER}`, (r, _m, [name]) => newCipher(r, name, null), { static: true });
  function newCipher(r, name, provider) {
    if (name === null) r.throwJava(NO_ALGORITHM, 'Null transformation'); const transformation = text(r, name), parts = transformation.split('/');
    if (provider !== null && !['AndroidKeyStoreBCWorkaround', 'AndroidOpenSSL', 'BC', 'AndroidKeyStore'].includes(text(r, provider))) r.throwJava('Ljava/security/NoSuchProviderException;', `no such provider: ${text(r, provider)}`);
    if (!parts.length || parts.length === 2 || parts.length > 3 || parts[0].toUpperCase() !== 'AES') {
      if (/^(RSA|EC|ChaCha20|DES|DESede|Blowfish|ARC4)/i.test(parts[0])) fail(`Cipher ${transformation} is not implemented (only AES is)`, { transformation });
      r.throwJava(NO_ALGORITHM, `No provider found for ${transformation}`);
    }
    const mode = (parts[1] ?? 'ECB').toUpperCase(), padding = (parts[2] ?? 'PKCS5Padding').toUpperCase();
    if (!['ECB', 'CBC', 'CTR', 'GCM'].includes(mode)) r.throwJava(NO_ALGORITHM, `No provider found for ${transformation}`);
    if (!['NOPADDING', 'PKCS5PADDING', 'PKCS7PADDING'].includes(padding)) r.throwJava(NO_PADDING, `Unsupported padding ${parts[2]}`);
    if ((mode === 'CTR' || mode === 'GCM') && padding !== 'NOPADDING') r.throwJava(NO_PADDING, `Unsupported padding ${parts[2]}`);
    const ref = r.allocate(CIPHER); Object.assign(r.object(ref), { transformation, mode, padding, opmode: 0, key: null, iv: null, buffer: [], aad: [], tagBytes: 16, expanded: null, counter: null, stream: null, streamAt: 16, used: false, ivRandom: false }); return ref;
  }
  const cs = (r, self) => r.object(self);
  const checkState = (r, c) => { if (!c.opmode) r.throwJava('Ljava/lang/IllegalStateException;', 'Cipher not initialized'); };
  function init(r, self, opmode, key, spec) {
    const c = cs(r, self); if (![1, 2, 3, 4].includes(opmode)) r.throwJava('Ljava/security/InvalidParameterException;', 'Invalid operation mode');
    const m = material(r, key); if (m === null) r.throwJava(INVALID_KEY, key === null ? 'key == null' : `Unsupported key: ${r.typeOf(key)}`);
    if (m.algorithm.toUpperCase() !== 'AES' || ![16, 24, 32].includes(m.bytes.length)) r.throwJava(INVALID_KEY, m.algorithm.toUpperCase() !== 'AES' ? `Unsupported key algorithm: ${m.algorithm}` : `Unsupported key size: ${m.bytes.length} bytes`);
    const encrypting = opmode === 1 || opmode === 3;
    if (m.spec) {   // an Android Keystore key: purposes, block mode and padding are enforced as the keystore daemon does
      if (!(m.spec.purposes & (encrypting ? PURPOSES.ENCRYPT : PURPOSES.DECRYPT))) r.throwJava(INVALID_KEY, `Key not authorized for ${encrypting ? 'encryption' : 'decryption'}`);
      if (!m.spec.blockModes.some(b => b.toUpperCase() === c.mode)) r.throwJava(INVALID_KEY, 'Incompatible block mode');
      const paddingName = c.padding === 'NOPADDING' ? 'NOPADDING' : 'PKCS7PADDING';
      if (!m.spec.paddings.some(p => p.toUpperCase() === paddingName)) r.throwJava(INVALID_KEY, 'Incompatible padding mode');
    }
    let iv = null, tagBytes = 16;
    if (spec !== null) {
      const t = r.typeOf(spec);
      if (t === IV_SPEC) { if (c.mode === 'GCM') r.throwJava(INVALID_PARAMETER, 'Unsupported parameters: IvParameterSpec; GCMParameterSpec is required for AES/GCM'); if (c.mode === 'ECB') r.throwJava(INVALID_PARAMETER, 'IV not used in ECB mode'); iv = r.object(spec).iv; }
      else if (t === GCM_SPEC) { if (c.mode !== 'GCM') r.throwJava(INVALID_PARAMETER, 'GCMParameterSpec may only be used with GCM'); const g = r.object(spec); if (![96, 104, 112, 120, 128].includes(g.tLen)) r.throwJava(INVALID_PARAMETER, `Unsupported tag length: ${g.tLen} bits`); iv = g.iv; tagBytes = g.tLen / 8; }
      else r.throwJava(INVALID_PARAMETER, `Unsupported parameter: ${t}`);
      if (m.spec && encrypting && m.spec.randomized) r.throwJava(INVALID_PARAMETER, 'Caller-provided IV not permitted');
    }
    if (c.mode !== 'ECB') {
      const length = c.mode === 'GCM' ? 12 : 16;
      if (iv === null) { if (!encrypting) r.throwJava(INVALID_KEY, 'IV required when decrypting. Use IvParameterSpec or AlgorithmParameters to provide it.'); iv = randomBytes(length); c.ivRandom = true; } else c.ivRandom = false;
      if (c.mode === 'GCM' ? iv.length === 0 : iv.length !== 16) r.throwJava(INVALID_PARAMETER, c.mode === 'GCM' ? 'IV is empty' : `Expected IV length of 16 but was ${iv.length}`);
    }
    Object.assign(c, { opmode, key: m.bytes, expanded: expandKey(m.bytes), iv, tagBytes, buffer: [], aad: [], used: false, streamAt: 16, stream: null, counter: iv && c.mode === 'CTR' ? Uint8Array.from(iv) : null, chain: iv && c.mode === 'CBC' ? Uint8Array.from(iv) : null });
  }
  def(CIPHER, 'init', `(I${KEY})V`, (r, _m, [self, op, key]) => init(r, self, op, key, null));
  def(CIPHER, 'init', `(I${KEY}${SECURE_RANDOM})V`, (r, _m, [self, op, key]) => init(r, self, op, key, null));
  def(CIPHER, 'init', `(I${KEY}${SPEC})V`, (r, _m, [self, op, key, spec]) => init(r, self, op, key, spec));
  def(CIPHER, 'init', `(I${KEY}${SPEC}${SECURE_RANDOM})V`, (r, _m, [self, op, key, spec]) => init(r, self, op, key, spec));
  def(CIPHER, 'getIV', `()${BYTES}`, (r, _m, [self]) => { const c = cs(r, self); return c.iv && c.mode !== 'ECB' ? byteArray(r, c.iv) : null; });
  def(CIPHER, 'getAlgorithm', `()${STRING}`, (r, _m, [self]) => cs(r, self).transformation);
  def(CIPHER, 'getBlockSize', '()I', () => 16);
  def(CIPHER, 'getOutputSize', '(I)I', (r, _m, [self, n]) => { const c = cs(r, self); checkState(r, c); const total = c.buffer.length + n; if (c.mode === 'GCM') return c.opmode === 1 ? total + c.tagBytes : Math.max(0, total - c.tagBytes); if (c.padding === 'NOPADDING' || c.mode === 'CTR') return total; return c.opmode === 1 ? (Math.floor(total / 16) + 1) * 16 : total; });
  def(CIPHER, 'updateAAD', `(${BYTES})V`, (r, _m, [self, a]) => { const c = cs(r, self); checkState(r, c); if (c.mode !== 'GCM') r.throwJava('Ljava/lang/IllegalStateException;', 'AAD is only supported in GCM mode'); c.aad.push(...bytesOf(r, a)); });
  def(CIPHER, 'updateAAD', `(${BYTES}II)V`, (r, _m, [self, a, o, l]) => { const c = cs(r, self); checkState(r, c); if (c.mode !== 'GCM') r.throwJava('Ljava/lang/IllegalStateException;', 'AAD is only supported in GCM mode'); c.aad.push(...bytesOf(r, a, o, l)); });

  /** Processes the buffered input: full blocks for update (ECB/CBC/CTR), everything for doFinal. */
  function process(r, c, input, last) {
    const encrypting = c.opmode === 1 || c.opmode === 3;
    if (c.mode === 'GCM') {
      c.buffer.push(...input); if (!last) return new Uint8Array(0);
      if (encrypting && c.used) r.throwJava('Ljava/lang/IllegalStateException;', 'Cannot re-use same key and IV for multiple encryptions');
      const result = gcm(c.expanded, c.iv, Uint8Array.from(c.aad), Uint8Array.from(c.buffer), c.tagBytes, encrypting); c.buffer = []; c.aad = [];
      if (encrypting) { c.used = true; return result.output; }
      if (result.error) r.throwJava(AEAD_BAD_TAG, result.error === 'short' ? 'Input too short - need tag' : 'error:1e000065:Cipher functions:OPENSSL_internal:BAD_DECRYPT');
      return result.output;
    }
    if (c.mode === 'CTR') {
      const out = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) { if (c.streamAt === 16) { c.stream = encryptBlock(c.expanded, c.counter); c.counter = incBlock(c.counter); c.streamAt = 0; } out[i] = input[i] ^ c.stream[c.streamAt++]; }
      return out;
    }
    c.buffer.push(...input);
    const data = Uint8Array.from(c.buffer), padded = c.padding !== 'NOPADDING';
    let keep = 0;
    if (!last) keep = data.length % 16 === 0 ? (padded && !encrypting ? 16 : 0) : data.length % 16;   // when decrypting with padding the last full block is held back for the final unpadding
    else if (!padded && data.length % 16) r.throwJava(BLOCK_SIZE_EXCEPTION, 'error:1c80006b:Provider routines::wrong final block length');
    else if (!encrypting && padded && (data.length === 0 || data.length % 16)) r.throwJava(BLOCK_SIZE_EXCEPTION, 'error:1e00007b:Cipher functions:OPENSSL_internal:WRONG_FINAL_BLOCK_LENGTH');
    let body = last ? data : data.subarray(0, data.length - keep); c.buffer = last ? [] : [...data.subarray(data.length - keep)];
    if (last && encrypting && padded) { const pad = 16 - (body.length % 16); body = concat(body, new Uint8Array(pad).fill(pad)); }
    const out = new Uint8Array(body.length);
    for (let at = 0; at < body.length; at += 16) {
      const block = body.subarray(at, at + 16);
      if (c.mode === 'ECB') out.set(encrypting ? encryptBlock(c.expanded, block) : decryptBlock(c.expanded, block), at);
      else if (encrypting) { const ct = encryptBlock(c.expanded, xor(block, c.chain)); c.chain = ct; out.set(ct, at); }
      else { out.set(xor(decryptBlock(c.expanded, block), c.chain), at); c.chain = Uint8Array.from(block); }
    }
    if (last && !encrypting && padded) {
      const pad = out[out.length - 1];
      if (pad < 1 || pad > 16 || pad > out.length || out.subarray(out.length - pad).some(b => b !== pad)) r.throwJava(BAD_PADDING, 'error:1e000064:Cipher functions:OPENSSL_internal:BAD_DECRYPT');
      return out.slice(0, out.length - pad);
    }
    return out;
  }
  const afterFinal = c => { c.buffer = []; if (c.mode === 'CBC') c.chain = Uint8Array.from(c.iv); if (c.mode === 'CTR') { c.counter = Uint8Array.from(c.iv); c.streamAt = 16; } };
  def(CIPHER, 'update', `(${BYTES})${BYTES}`, (r, _m, [self, a]) => { const c = cs(r, self); checkState(r, c); if (a === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Null input buffer'); const input = bytesOf(r, a); if (!input.length) return null; return byteArray(r, process(r, c, input, false)); });
  def(CIPHER, 'update', `(${BYTES}II)${BYTES}`, (r, _m, [self, a, o, l]) => { const c = cs(r, self); checkState(r, c); const input = bytesOf(r, a, o, l); if (!input.length) return null; return byteArray(r, process(r, c, input, false)); });
  def(CIPHER, 'doFinal', `()${BYTES}`, (r, _m, [self]) => { const c = cs(r, self); checkState(r, c); try { return byteArray(r, process(r, c, new Uint8Array(0), true)); } finally { afterFinal(c); } });
  def(CIPHER, 'doFinal', `(${BYTES})${BYTES}`, (r, _m, [self, a]) => { const c = cs(r, self); checkState(r, c); if (a === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Null input buffer'); try { return byteArray(r, process(r, c, bytesOf(r, a), true)); } finally { afterFinal(c); } });
  def(CIPHER, 'doFinal', `(${BYTES}II)${BYTES}`, (r, _m, [self, a, o, l]) => { const c = cs(r, self); checkState(r, c); try { return byteArray(r, process(r, c, bytesOf(r, a, o, l), true)); } finally { afterFinal(c); } });
  // Output-buffer variants: the result is written at outputOffset and its length returned (ShortBufferException when it does not fit).
  const intoBuffer = (r, produce, outRef, outOffset) => {
    if (outRef === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Null output buffer'); const target = r.array(outRef).elements;
    const result = produce(); if (outOffset < 0 || outOffset + result.length > target.length) r.throwJava('Ljavax/crypto/ShortBufferException;', `Output buffer too short: ${target.length - outOffset} bytes given, ${result.length} bytes needed`);
    result.forEach((v, i) => { target[outOffset + i] = (v << 24) >> 24; }); return result.length;
  };
  const running = (r, self) => { const c = cs(r, self); checkState(r, c); return c; };
  def(CIPHER, 'update', `(${BYTES}II${BYTES})I`, (r, _m, [self, a, o, l, out]) => { const c = running(r, self); return intoBuffer(r, () => process(r, c, bytesOf(r, a, o, l), false), out, 0); });
  def(CIPHER, 'update', `(${BYTES}II${BYTES}I)I`, (r, _m, [self, a, o, l, out, outOffset]) => { const c = running(r, self); return intoBuffer(r, () => process(r, c, bytesOf(r, a, o, l), false), out, outOffset); });
  def(CIPHER, 'doFinal', `(${BYTES}I)I`, (r, _m, [self, out, outOffset]) => { const c = running(r, self); try { return intoBuffer(r, () => process(r, c, new Uint8Array(0), true), out, outOffset); } finally { afterFinal(c); } });
  def(CIPHER, 'doFinal', `(${BYTES}II${BYTES})I`, (r, _m, [self, a, o, l, out]) => { const c = running(r, self); try { return intoBuffer(r, () => process(r, c, bytesOf(r, a, o, l), true), out, 0); } finally { afterFinal(c); } });
  def(CIPHER, 'doFinal', `(${BYTES}II${BYTES}I)I`, (r, _m, [self, a, o, l, out, outOffset]) => { const c = running(r, self); try { return intoBuffer(r, () => process(r, c, bytesOf(r, a, o, l), true), out, outOffset); } finally { afterFinal(c); } });
  return { ...registry, interfaces: registry.interfacesOf };
}
/** Exposed for the known-answer tests (tests/jce-crypto.test.mjs). */
export const aesPrimitives = { expandKey, encryptBlock, decryptBlock, gcm, randomBytes };
