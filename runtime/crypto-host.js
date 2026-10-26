import { createHostRegistry } from './host-contract.js?v=94afba6d22ec';

// java.security.MessageDigest with synchronous pure-JS MD5, SHA-1, SHA-224/256 and SHA-384/512 (WebCrypto is asynchronous and the VM is synchronous).
// Contract: java.security.MessageDigest (android-13.0.0_r1). Other Security providers (Cipher, Mac, Signature, KeyStore) are not implemented.
const MD = 'Ljava/security/MessageDigest;', STRING = 'Ljava/lang/String;', BYTES = '[B', OBJECT = 'Ljava/lang/Object;';
const rotl = (x, n) => (x << n) | (x >>> (32 - n)), rotr = (x, n) => (x >>> n) | (x << (32 - n));

function md5(data) {
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const bytes = padded(data, 'le'), view = new DataView(bytes.buffer); let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < bytes.length; o += 64) {
    const M = Array.from({ length: 16 }, (_, i) => view.getUint32(o + i * 4, true)); let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g; if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0; A = D; D = C; C = B; B = (B + rotl(F, S[(i >> 4) * 4 + (i % 4)])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new DataView(new ArrayBuffer(16)); [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v >>> 0, true)); return new Uint8Array(out.buffer);
}
function padded(data, endian, block = 64, lengthBytes = 8) {
  const total = Math.ceil((data.length + 1 + lengthBytes) / block) * block, out = new Uint8Array(total); out.set(data); out[data.length] = 0x80;
  const view = new DataView(out.buffer), bits = BigInt(data.length) * 8n;
  if (lengthBytes === 8) { view.setUint32(total - 8, Number(bits >> 32n), endian === 'le' ? false : false); } // overwritten below with the correct endianness
  if (endian === 'le') { view.setUint32(total - 8, Number(bits & 0xffffffffn), true); view.setUint32(total - 4, Number(bits >> 32n), true); }
  else { view.setBigUint64(total - 8, bits, false); if (lengthBytes === 16) { view.setBigUint64(total - 16, 0n, false); view.setBigUint64(total - 8, bits, false); } }
  return out;
}
function sha1(data) {
  const bytes = padded(data, 'be'), view = new DataView(bytes.buffer); let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  for (let o = 0; o < bytes.length; o += 64) {
    const w = new Array(80); for (let i = 0; i < 16; i++) w[i] = view.getUint32(o + i * 4, false); for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) { const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6]; const t = (rotl(a, 5) + f + e + k + w[i]) | 0; e = d; d = c; c = rotl(b, 30); b = a; a = t; }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  const out = new DataView(new ArrayBuffer(20)); [h0, h1, h2, h3, h4].forEach((v, i) => out.setUint32(i * 4, v >>> 0, false)); return new Uint8Array(out.buffer);
}
const K256 = Array.from({ length: 64 }, (_, i) => { let n = 2, count = 0; for (; ; n++) { if ([...Array(n - 2).keys()].every(d => n % (d + 2))) { if (count++ === i) break; } } return Math.floor((Math.cbrt(n) % 1) * 2 ** 32) >>> 0; });
function sha256(data, is224) {
  const H = is224 ? [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4] : [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bytes = padded(data, 'be'), view = new DataView(bytes.buffer);
  for (let o = 0; o < bytes.length; o += 64) {
    const w = new Array(64); for (let i = 0; i < 16; i++) w[i] = view.getUint32(o + i * 4, false);
    for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) { const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0, t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  const out = new DataView(new ArrayBuffer(32)); H.forEach((v, i) => out.setUint32(i * 4, v >>> 0, false)); return new Uint8Array(out.buffer, 0, is224 ? 28 : 32);
}
const K512 = (() => { const primes = []; for (let n = 2; primes.length < 80; n++) if (primes.every(p => n % p)) primes.push(n); const cube = p => { let x = BigInt(Math.floor(Math.cbrt(p) * 2 ** 20)) << 44n; for (let i = 0; i < 80; i++) x = (2n * x + (BigInt(p) << 192n) / (x * x)) / 3n; return x; }; return primes.map(p => BigInt.asUintN(64, cube(p))); })();
const H512 = (() => { const primes = [2, 3, 5, 7, 11, 13, 17, 19]; return primes.map(p => { const scaled = BigInt(p) << 128n; let x = 1n << 70n; for (let i = 0; i < 100; i++) x = (x + scaled / x) / 2n; return BigInt.asUintN(64, x); }); })();
function sha512(data, is384) {
  const H = is384 ? [0xcbbb9d5dc1059ed8n, 0x629a292a367cd507n, 0x9159015a3070dd17n, 0x152fecd8f70e5939n, 0x67332667ffc00b31n, 0x8eb44a8768581511n, 0xdb0c2e0d64f98fa7n, 0x47b5481dbefa4fa4n] : [...H512];
  const M = (1n << 64n) - 1n, rr = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M, bytes = padded(data, 'be', 128, 16), view = new DataView(bytes.buffer);
  for (let o = 0; o < bytes.length; o += 128) {
    const w = new Array(80); for (let i = 0; i < 16; i++) w[i] = view.getBigUint64(o + i * 8, false);
    for (let i = 16; i < 80; i++) { const s0 = rr(w[i - 15], 1) ^ rr(w[i - 15], 8) ^ (w[i - 15] >> 7n), s1 = rr(w[i - 2], 19) ^ rr(w[i - 2], 61) ^ (w[i - 2] >> 6n); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & M; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 80; i++) { const t1 = (h + (rr(e, 14) ^ rr(e, 18) ^ rr(e, 41)) + ((e & f) ^ (~e & M & g)) + K512[i] + w[i]) & M, t2 = ((rr(a, 28) ^ rr(a, 34) ^ rr(a, 39)) + ((a & b) ^ (a & c) ^ (b & c))) & M; h = g; g = f; f = e; e = (d + t1) & M; d = c; c = b; b = a; a = (t1 + t2) & M; }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) & M; });
  }
  const out = new DataView(new ArrayBuffer(64)); H.forEach((v, i) => out.setBigUint64(i * 8, v, false)); return new Uint8Array(out.buffer, 0, is384 ? 48 : 64);
}
export const DIGESTS = { 'MD5': { fn: md5, length: 16 }, 'SHA-1': { fn: sha1, length: 20 }, 'SHA-224': { fn: d => sha256(d, true), length: 28 }, 'SHA-256': { fn: d => sha256(d, false), length: 32 }, 'SHA-384': { fn: d => sha512(d, true), length: 48 }, 'SHA-512': { fn: d => sha512(d, false), length: 64 } };
const ALIASES = { 'SHA': 'SHA-1', 'SHA1': 'SHA-1', 'SHA256': 'SHA-256', 'SHA384': 'SHA-384', 'SHA512': 'SHA-512', 'SHA224': 'SHA-224' };

export function createCryptoHost() {
  const registry = createHostRegistry(), { def, type } = registry;
  type('Ljava/security/GeneralSecurityException;', 'Ljava/lang/Exception;'); type('Ljava/security/NoSuchAlgorithmException;', 'Ljava/security/GeneralSecurityException;');
  type(MD, OBJECT, [], { allocatable: true });
  const st = (r, ref) => r.object(ref).digest ?? r.throwJava('Ljava/lang/IllegalStateException;', 'MessageDigest used before getInstance');
  def(MD, 'getInstance', `(${STRING})${MD}`, (r, _m, [name]) => {
    if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'algorithm == null');
    const requested = r.stringCharacters(name), canonical = Object.keys(DIGESTS).find(k => k.toLowerCase() === (ALIASES[requested.toUpperCase()] ?? requested).toLowerCase());
    if (!canonical) r.throwJava('Ljava/security/NoSuchAlgorithmException;', `${requested} MessageDigest not available`);
    const ref = r.allocate(MD); r.object(ref).digest = { algorithm: canonical, chunks: [], size: 0 }; return ref;
  }, { static: true });
  const feed = (r, self, bytes) => { const d = st(r, self); d.chunks.push(bytes); d.size += bytes.length; };
  const slice = (r, ref, offset, length) => { const a = r.array(ref).elements; if (offset < 0 || length < 0 || offset + length > a.length) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Bad arguments'); return Uint8Array.from(a.slice(offset, offset + length), v => v & 255); };
  def(MD, 'update', '(B)V', (r, _m, [self, b]) => feed(r, self, Uint8Array.of(b & 255)));
  def(MD, 'update', `(${BYTES})V`, (r, _m, [self, a]) => feed(r, self, slice(r, a, 0, r.array(a).elements.length)));
  def(MD, 'update', `(${BYTES}II)V`, (r, _m, [self, a, o, l]) => feed(r, self, slice(r, a, o, l)));
  const finish = (r, self) => { const d = st(r, self), all = new Uint8Array(d.size); let at = 0; for (const c of d.chunks) { all.set(c, at); at += c.length; } d.chunks = []; d.size = 0; const out = DIGESTS[d.algorithm].fn(all), array = r.newArray(BYTES, out.length); r.array(array).elements = Array.from(out, v => (v << 24) >> 24); return array; };
  def(MD, 'digest', `()${BYTES}`, (r, _m, [self]) => finish(r, self));
  def(MD, 'digest', `(${BYTES})${BYTES}`, (r, _m, [self, a]) => { feed(r, self, slice(r, a, 0, r.array(a).elements.length)); return finish(r, self); });
  def(MD, 'reset', '()V', (r, _m, [self]) => { const d = st(r, self); d.chunks = []; d.size = 0; });
  def(MD, 'getAlgorithm', `()${STRING}`, (r, _m, [self]) => st(r, self).algorithm);
  def(MD, 'getDigestLength', '()I', (r, _m, [self]) => DIGESTS[st(r, self).algorithm].length);
  def(MD, 'isEqual', `(${BYTES}${BYTES})Z`, (r, _m, [a, b]) => { if (a === b) return 1; if (a === null || b === null) return 0; const x = r.array(a).elements, y = r.array(b).elements; if (x.length !== y.length) return 0; let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]; return diff === 0 ? 1 : 0; }, { static: true });
  return { ...registry, interfaces: registry.interfacesOf };
}
