// Streaming MD5 / SHA-1 / SHA-256 / SHA-512 over raw bytes with 32-bit integer arithmetic (no BigInt, no per-byte interpreter work): the host-native digests for large inputs such as a whole APK.
// Each hasher takes update(Uint8Array) any number of times and digest() once. Browser Workers and Node run the same code (no process.*, no node:crypto).

class BlockHasher {
  constructor(blockSize, lengthBytes, bigEndian) {
    this.blockSize = blockSize; this.lengthBytes = lengthBytes; this.bigEndian = bigEndian;
    this.buffer = new Uint8Array(blockSize); this.filled = 0; this.total = 0;
  }
  update(bytes) {
    this.total += bytes.length;
    let at = 0;
    if (this.filled > 0) {
      const take = Math.min(this.blockSize - this.filled, bytes.length); this.buffer.set(bytes.subarray(0, take), this.filled); this.filled += take; at = take;
      if (this.filled < this.blockSize) return this;
      this.block(this.buffer, 0); this.filled = 0;
    }
    for (; at + this.blockSize <= bytes.length; at += this.blockSize) this.block(bytes, at);
    if (at < bytes.length) { this.buffer.set(bytes.subarray(at), 0); this.filled = bytes.length - at; }
    return this;
  }
  finish() {
    const total = this.total, padded = new Uint8Array(this.filled + 1 + ((this.blockSize - this.lengthBytes - this.filled - 1) % this.blockSize + this.blockSize) % this.blockSize + this.lengthBytes);
    padded.set(this.buffer.subarray(0, this.filled)); padded[this.filled] = 0x80;
    const bits = BigInt(total) * 8n, view = new DataView(padded.buffer), end = padded.length;
    if (this.bigEndian) view.setBigUint64(end - 8, bits, false); else view.setBigUint64(end - 8, bits, true);
    const saved = this.total; this.filled = 0; this.update(padded); this.total = saved;
  }
}

const rotl = (x, n) => (x << n) | (x >>> (32 - n)), rotr = (x, n) => (x >>> n) | (x << (32 - n));

const MD5_K = new Int32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
export class Md5 extends BlockHasher {
  constructor() { super(64, 8, false); this.h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]); this.w = new Int32Array(16); }
  block(bytes, at) {
    const w = this.w; for (let i = 0; i < 16; i++) w[i] = bytes[at + i * 4] | (bytes[at + i * 4 + 1] << 8) | (bytes[at + i * 4 + 2] << 16) | (bytes[at + i * 4 + 3] << 24);
    let [a, b, c, d] = this.h;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; } else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; } else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const next = (b + rotl((a + f + MD5_K[i] + w[g]) | 0, MD5_S[i])) | 0; a = d; d = c; c = b; b = next;
    }
    this.h[0] += a; this.h[1] += b; this.h[2] += c; this.h[3] += d;
  }
  digest() { this.finish(); const out = new Uint8Array(16), view = new DataView(out.buffer); this.h.forEach((v, i) => view.setInt32(i * 4, v, true)); return out; }
}

export class Sha1 extends BlockHasher {
  constructor() { super(64, 8, true); this.h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476, 0xc3d2e1f0 | 0]); this.w = new Int32Array(80); }
  block(bytes, at) {
    const w = this.w; for (let i = 0; i < 16; i++) w[i] = (bytes[at + i * 4] << 24) | (bytes[at + i * 4 + 1] << 16) | (bytes[at + i * 4 + 2] << 8) | bytes[at + i * 4 + 3];
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = this.h;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; } else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; } else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc | 0; } else { f = b ^ c ^ d; k = 0xca62c1d6 | 0; }
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0; e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    this.h[0] += a; this.h[1] += b; this.h[2] += c; this.h[3] += d; this.h[4] += e;
  }
  digest() { this.finish(); const out = new Uint8Array(20), view = new DataView(out.buffer); this.h.forEach((v, i) => view.setInt32(i * 4, v, false)); return out; }
}

const SHA256_K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export class Sha256 extends BlockHasher {
  constructor() { super(64, 8, true); this.h = new Int32Array([0x6a09e667, 0xbb67ae85 | 0, 0x3c6ef372, 0xa54ff53a | 0, 0x510e527f, 0x9b05688c | 0, 0x1f83d9ab, 0x5be0cd19]); this.w = new Int32Array(64); }
  block(bytes, at) {
    const w = this.w, h = this.h; for (let i = 0; i < 16; i++) w[i] = (bytes[at + i * 4] << 24) | (bytes[at + i * 4 + 1] << 16) | (bytes[at + i * 4 + 2] << 8) | bytes[at + i * 4 + 3];
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0; }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) | 0, t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  digest() { this.finish(); const out = new Uint8Array(32), view = new DataView(out.buffer); this.h.forEach((v, i) => view.setInt32(i * 4, v, false)); return out; }
}

// SHA-512: 64-bit words as (hi, lo) pairs of 32-bit integers.
const SHA512_K = ['428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc', '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118', 'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2', '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
  'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65', '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5', '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4', 'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
  '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df', '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b', 'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30', 'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
  '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8', '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3', '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec', '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
  'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178', '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b', '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c', '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817'];
const K512 = new Int32Array(160); SHA512_K.forEach((hex, i) => { K512[i * 2] = parseInt(hex.slice(0, 8), 16) | 0; K512[i * 2 + 1] = parseInt(hex.slice(8), 16) | 0; });
export class Sha512 extends BlockHasher {
  constructor() {
    super(128, 16, true);
    this.h = new Int32Array(['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'].flatMap(hex => [parseInt(hex.slice(0, 8), 16) | 0, parseInt(hex.slice(8), 16) | 0]));
    this.w = new Int32Array(160);
  }
  block(bytes, at) {
    const w = this.w, H = this.h;
    for (let i = 0; i < 32; i++) w[i] = (bytes[at + i * 4] << 24) | (bytes[at + i * 4 + 1] << 16) | (bytes[at + i * 4 + 2] << 8) | bytes[at + i * 4 + 3];
    for (let i = 16; i < 80; i++) {
      const x1h = w[(i - 15) * 2], x1l = w[(i - 15) * 2 + 1], x2h = w[(i - 2) * 2], x2l = w[(i - 2) * 2 + 1];
      const s0h = ((x1h >>> 1) | (x1l << 31)) ^ ((x1h >>> 8) | (x1l << 24)) ^ (x1h >>> 7), s0l = ((x1l >>> 1) | (x1h << 31)) ^ ((x1l >>> 8) | (x1h << 24)) ^ ((x1l >>> 7) | (x1h << 25));
      const s1h = ((x2h >>> 19) | (x2l << 13)) ^ ((x2l >>> 29) | (x2h << 3)) ^ (x2h >>> 6), s1l = ((x2l >>> 19) | (x2h << 13)) ^ ((x2h >>> 29) | (x2l << 3)) ^ ((x2l >>> 6) | (x2h << 26));
      const lo = (w[(i - 16) * 2 + 1] >>> 0) + (s0l >>> 0) + (w[(i - 7) * 2 + 1] >>> 0) + (s1l >>> 0);
      w[i * 2 + 1] = lo | 0; w[i * 2] = (w[(i - 16) * 2] + s0h + w[(i - 7) * 2] + s1h + Math.floor(lo / 4294967296)) | 0;
    }
    let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7], eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
    for (let i = 0; i < 80; i++) {
      const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23)), S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
      const l1 = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[i * 2 + 1] >>> 0) + (w[i * 2 + 1] >>> 0), t1l = l1 | 0, t1h = (hh + S1h + chh + K512[i * 2] + w[i * 2] + Math.floor(l1 / 4294967296)) | 0;
      const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25)), S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const l2 = (S0l >>> 0) + (mjl >>> 0), t2l = l2 | 0, t2h = (S0h + mjh + Math.floor(l2 / 4294967296)) | 0;
      hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
      const l3 = (dl >>> 0) + (t1l >>> 0); el = l3 | 0; eh = (dh + t1h + Math.floor(l3 / 4294967296)) | 0;
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
      const l4 = (t1l >>> 0) + (t2l >>> 0); al = l4 | 0; ah = (t1h + t2h + Math.floor(l4 / 4294967296)) | 0;
    }
    const add = (index, high, low) => { const lo = (H[index + 1] >>> 0) + (low >>> 0); H[index + 1] = lo | 0; H[index] = (H[index] + high + Math.floor(lo / 4294967296)) | 0; };
    add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl); add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
  }
  digest() { this.finish(); const out = new Uint8Array(64), view = new DataView(out.buffer); this.h.forEach((v, i) => view.setInt32(i * 4, v, false)); return out; }
}

export const HASHERS = { 'MD5': Md5, 'SHA-1': Sha1, 'SHA-256': Sha256, 'SHA-512': Sha512 };
