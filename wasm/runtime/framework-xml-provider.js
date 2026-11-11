const MAX_COMPRESSED = 4 * 1024 * 1024, MAX_EXPANDED = 16 * 1024 * 1024;
const fail = message => { throw new Error(`Framework XML: ${message}`); };
const sha256 = async bytes => {
  if (!globalThis.crypto?.subtle) fail('integrity requires Web Crypto');
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
};
async function bounded(response, limit) {
  if (!response.ok) fail(`HTTP ${response.status}`);
  if (Number(response.headers?.get('content-length')) > limit) fail('declared size exceeds profile limit');
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit) fail('size exceeds profile limit');
    return bytes;
  }
  const reader = response.body.getReader(), chunks = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    total += value.length;
    if (total > limit) { await reader.cancel(); fail('expanded size exceeds profile limit'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Original compiled framework AXML bytes, loaded once and parsed on demand. */
export class FrameworkXmlProvider {
  constructor({ table, indexURL, dataURL, sourceArscSha256 = null, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.table = table; this.indexURL = indexURL; this.dataURL = dataURL;
    this.sourceArscSha256 = sourceArscSha256;
    this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : fetchImpl;
    this.pending = null;
  }
  load() { return this.pending ??= this.loadOnce(); }
  async loadOnce() {
    if (!this.table?.resolve || !this.table?.parseLayout || !this.indexURL || !this.dataURL || !this.fetch) fail('resource table and asset URLs are required');
    const index = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await bounded(await this.fetch(this.indexURL), 2 * 1024 * 1024)));
    if (index.schemaVersion !== 1 || index.compression !== 'gzip' || !Array.isArray(index.entries) || index.entryCount !== index.entries.length || index.entries.length > 8192) fail('invalid index');
    if (this.sourceArscSha256 && this.sourceArscSha256 !== index.sourceArscSha256) fail('resource table source differs from XML source');
    if (!Number.isSafeInteger(index.expandedBytes) || index.expandedBytes < 8 || index.expandedBytes > MAX_EXPANDED) fail('invalid expanded size');
    const entries = new Map(); let expectedOffset = 0;
    for (const entry of index.entries) {
      if (typeof entry.path !== 'string' || !/^res\/(?:[a-zA-Z0-9_.$-]+\/)*[a-zA-Z0-9_.$-]+\.xml$/.test(entry.path) || entry.path.split('/').includes('..') || entries.has(entry.path)) fail('invalid or duplicate entry path');
      if (entry.offset !== expectedOffset || !Number.isSafeInteger(entry.length) || entry.length < 8 || entry.length > 1024 * 1024) fail('overlapping, truncated or excessive entry');
      expectedOffset += entry.length;
      if (expectedOffset > index.expandedBytes) fail('entry exceeds package extent');
      entries.set(entry.path, entry);
    }
    if (expectedOffset !== index.expandedBytes) fail('index extent differs from package');
    const compressed = await bounded(await this.fetch(this.dataURL), MAX_COMPRESSED);
    // Static hosts may decode content-encoding themselves. Expanded bytes are verified either way.
    let bytes = compressed;
    if (compressed[0] === 0x1f && compressed[1] === 0x8b) {
      if (compressed.length !== index.compressedBytes || await sha256(compressed) !== index.compressedSha256) fail('compressed SHA-256 mismatch');
      if (typeof DecompressionStream !== 'function') fail('gzip DecompressionStream is unavailable');
      bytes = await bounded(new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))), MAX_EXPANDED);
    }
    if (bytes.length !== index.expandedBytes || await sha256(bytes) !== index.expandedSha256) fail('expanded SHA-256 mismatch');
    const cache = new Map();
    const getXml = id => {
      if (!Number.isInteger(id) || (id >>> 24) !== 1) fail('only framework package IDs are accepted');
      const value = this.table.resolve(id), path = value.value, entry = entries.get(path);
      if (!entry) fail(`resource 0x${(id >>> 0).toString(16)} has no XML in the selected profile`);
      if (!cache.has(path)) cache.set(path, this.table.parseLayout(bytes.subarray(entry.offset, entry.offset + entry.length)));
      return cache.get(path);
    };
    return { getXml, metadata: { enabled: true, entryCount: entries.size, expandedBytes: bytes.length, compressedBytes: index.compressedBytes, sha256: index.expandedSha256, sourceArscSha256: index.sourceArscSha256, integrity: 'verified-SHA-256', selection: index.selection, executable: false } };
  }
}
