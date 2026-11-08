import { HASHERS, Sha256 } from './fast-digests.js?v=57d10730b49f';

// APK checksums as PackageManager.requestChecksums reports them (android-13.0.0_r1 ApkChecksums): the file-level data, with no VM involved.
export const TYPE = { WHOLE_MERKLE_ROOT_4K_SHA256: 1, WHOLE_MD5: 2, WHOLE_SHA1: 4, WHOLE_SHA256: 8, WHOLE_SHA512: 16, PARTIAL_MERKLE_ROOT_1M_SHA256: 32, PARTIAL_MERKLE_ROOT_1M_SHA512: 64 };
export const TYPE_NAMES = Object.fromEntries(Object.entries(TYPE).map(([name, value]) => [value, `TYPE_${name}`]));
export const ALL_TYPES = Object.values(TYPE).reduce((all, value) => all | value, 0);

/** Content digest ids (APK Signature Scheme v2/v3): 1 = chunked SHA-256 and 2 = chunked SHA-512 (1 MiB chunks), the partial Merkle root types; 3 = chunked verity SHA-256 (not a checksum type). */
export const CONTENT_DIGEST = { CHUNKED_SHA256: 1, CHUNKED_SHA512: 2, VERITY_CHUNKED_SHA256: 3 };
const CONTENT_DIGEST_OF_SIGNATURE_ALGORITHM = new Map([[0x0101, 1], [0x0103, 1], [0x0201, 1], [0x0301, 1], [0x0102, 2], [0x0104, 2], [0x0202, 2], [0x0421, 3], [0x0423, 3], [0x0425, 3]]);
const BLOCK = 4096, HASHES_PER_BLOCK = BLOCK / 32;

/**
 * Root hash of the 4K SHA-256 Merkle tree over the whole file (the tree fs-verity and apk-verity build, no salt): data blocks of 4096 bytes (the last one zero-padded) are hashed; the hashes
 * are packed 128 to a zero-padded 4096-byte block, each block is hashed into the next level, until a level is a single block; the root is the SHA-256 of that block (of the data block itself
 * for a file of up to 4096 bytes).
 */
export function merkleRoot4kSha256(bytes) { const steps = merkleSteps(bytes); for (;;) { const next = steps.next(); if (next.done) return next.value; } }

/** The same tree as a generator that yields after every `batch` bytes of hashing, so a host job can interleave with the rest of the VM. */
export function* merkleSteps(bytes, batch = 1 << 20) {
  if (bytes.length === 0) throw new RangeError('A Merkle tree needs at least one byte of data');
  const hash = block => new Sha256().update(block).digest();
  let hashes = [], work = 0;
  for (let at = 0; at < bytes.length; at += BLOCK) {
    let block = bytes.subarray(at, at + BLOCK); if (block.length < BLOCK) { const padded = new Uint8Array(BLOCK); padded.set(block); block = padded; }
    hashes.push(hash(block)); work += BLOCK; if (work >= batch) { work = 0; yield; }
  }
  for (;;) {
    if (hashes.length === 1 && bytes.length <= BLOCK) return hashes[0];
    // pack the hashes 128 to a zero-padded block; a level of a single block ends the tree: its hash is the root
    const blocks = [];
    for (let at = 0; at < hashes.length; at += HASHES_PER_BLOCK) { const block = new Uint8Array(BLOCK); hashes.slice(at, at + HASHES_PER_BLOCK).forEach((h, i) => block.set(h, i * 32)); blocks.push(block); }
    hashes = blocks.map(hash);
    if (blocks.length === 1) return hashes[0];
    yield;
  }
}

/** Whole-file digest by java.security algorithm name, as a generator yielding every `batch` bytes. */
export function* digestSteps(algorithm, bytes, batch = 1 << 20) {
  const hasher = new HASHERS[algorithm]();
  for (let at = 0; at < bytes.length; at += batch) { hasher.update(bytes.subarray(at, Math.min(at + batch, bytes.length))); if (at + batch < bytes.length) yield; }
  return hasher.digest();
}

/**
 * The content digests an APK Signature Scheme v3 (else v2) signing block declares, keyed by content digest id (CONTENT_DIGEST: chunked SHA-256 and SHA-512 are the partial Merkle roots with
 * 1 MiB chunks: PackageManager reports them as read from the signature, it does not recompute them). Empty for an APK without a v2/v3 block.
 */
export function signatureContentDigests(archive) {
  const b = archive.reader, cd = archive.centralDirectoryOffset, digests = new Map();
  if (cd < 32 || String.fromCharCode(...b.slice(cd - 16, 16)) !== 'APK Sig Block 42') return digests;
  const wide = p => Number(b.u32(p)) + Number(b.u32(p + 4)) * 2 ** 32, size = wide(cd - 24), begin = cd - size - 8;
  if (begin < 0 || wide(begin) !== size) return digests;
  const pairs = new Map();
  for (let p = begin + 8; p < cd - 24;) { const length = wide(p); pairs.set(b.u32(p + 8), p + 12); p += 8 + length; }
  const sequence = (from, to) => { const items = []; for (let p = from; p < to;) { const n = b.u32(p); items.push([p + 4, p + 4 + n]); p += 4 + n; } return items; };
  for (const id of [0xf05368c0, 0x7109871a]) {   // v3, then v2: the first scheme with a signer answers
    const signersFrom = pairs.get(id); if (signersFrom === undefined) continue;
    const signersLength = b.u32(signersFrom), signers = sequence(signersFrom + 4, signersFrom + 4 + signersLength);
    if (!signers.length) continue;
    const [signerFrom] = signers[0], signedFrom = signerFrom + 4, digestsLength = b.u32(signedFrom);
    for (const [from] of sequence(signedFrom + 4, signedFrom + 4 + digestsLength)) {   // (signature algorithm id, digest): the signature algorithm names the content digest it signs
      const content = CONTENT_DIGEST_OF_SIGNATURE_ALGORITHM.get(b.u32(from)), length = b.u32(from + 4);
      if (content !== undefined && !digests.has(content)) digests.set(content, b.slice(from + 8, length).slice());
    }
    if (digests.size) return digests;
  }
  return digests;
}
