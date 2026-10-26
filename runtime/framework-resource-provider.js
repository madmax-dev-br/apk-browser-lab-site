import { FrameworkXmlProvider } from './framework-xml-provider.js?v=5baf5691b052';
import { AndroidResources } from './android-resources.js?v=5baf5691b052';

const MAX_DATA_BYTES = 64 * 1024 * 1024;
const utf8 = new TextDecoder('utf-8', { fatal: true });
async function boundedBytes(response, limit, label) {
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
  if (Number(response.headers?.get('content-length')) > limit) throw new Error(`${label} exceeds ${limit} bytes`);
  if (!response.body?.getReader) { const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > limit) throw new Error(`${label} exceeds limit`); return bytes; }
  const reader = response.body.getReader(), chunks = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > limit) { await reader.cancel(); throw new Error(`${label} exceeds limit`); } chunks.push(value); }
  const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; } return bytes;
}
async function digest(bytes) { if (!globalThis.crypto?.subtle) throw new Error('Framework resource integrity requires Web Crypto'); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join(''); }

/** A licensed, partial resource data profile. It contains no SDK class stubs or image assets. */
export class FrameworkResourceProvider {
  constructor({ data = null, metadata = null, url = null, provenanceURL = null, xmlIndexURL = null, xmlDataURL = null, xmlProvider = null, ninePatchURL = undefined, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.data = data; this.metadata = metadata; this.url = url; this.provenanceURL = provenanceURL; this.fetch = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : fetchImpl; this.pending = null; this.ninePatchURL = ninePatchURL !== undefined ? ninePatchURL : url ? (() => { try { return new URL('framework-ninepatch.json.gz', url instanceof URL ? url : new URL(String(url), globalThis.location?.href)); } catch { return null; } })() : null; this.xmlIndexURL = xmlIndexURL; this.xmlDataURL = xmlDataURL; this.xmlProvider = xmlProvider;
  }
  load({ onProgress } = {}) { return this.pending ??= this.loadOnce(onProgress); }
  async loadOnce(onProgress) {
    onProgress?.({ phase: 'framework-resources', completed: 0, total: 1, message: 'Reading original framework resource data' });
    let data = this.data, metadata = this.metadata || {}, sha256 = null;
    if (!data) {
      if (!this.url || !this.provenanceURL || typeof this.fetch !== 'function') throw new Error('Framework resources need injected data or local asset and provenance URLs');
      metadata = JSON.parse(utf8.decode(await boundedBytes(await this.fetch(this.provenanceURL), 1024 * 1024, 'Framework resource provenance')));
      const compressed = await boundedBytes(await this.fetch(this.url), 16 * 1024 * 1024, 'Framework resource data');
      let bytes = compressed;
      if (String(this.url).split('?')[0].endsWith('.gz') && compressed[0] === 0x1f && compressed[1] === 0x8b) {
        if (typeof DecompressionStream !== 'function') throw new Error('Framework resource profile requires gzip DecompressionStream');
        bytes = await boundedBytes(new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))), MAX_DATA_BYTES, 'Expanded framework resource data');
      }
      sha256 = await digest(bytes);
      if (sha256 !== metadata.sha256) throw new Error('Original framework resource JSON SHA-256 mismatch');
      data = JSON.parse(utf8.decode(bytes));
    }
    const table = AndroidResources.fromJSON(data, { sourceCookie: 2 });
    const result = { table, metadata: { ...metadata, enabled: true, selectedUniqueResourceIds: table.entries.size, sha256: sha256 || null, integrity: sha256 ? 'verified-SHA-256' : 'injected-object', executable: false, selectedProfile: 'unqualified-original-variants-only' } };
    let xmlProvider = typeof this.xmlProvider === 'function' ? this.xmlProvider(table) : this.xmlProvider;
    if (!xmlProvider && this.xmlIndexURL && this.xmlDataURL) xmlProvider = new FrameworkXmlProvider({ table, indexURL: this.xmlIndexURL, dataURL: this.xmlDataURL, sourceArscSha256: metadata.sourceArscSha256 || null, fetchImpl: this.fetch });
    if (xmlProvider) { if (!xmlProvider.table) xmlProvider.table = table; const xml = await xmlProvider.load(); result.getXml = xml.getXml; result.metadata.xml = xml.metadata; }
    // Optional compiled framework 9-patch PNGs (mdpi); absence is explicit: a 9-patch resource that needs them fails with its resource id.
    if (this.ninePatchURL && typeof this.fetch === 'function') {
      try {
        const compressed = await boundedBytes(await this.fetch(this.ninePatchURL), 4 * 1024 * 1024, 'Framework 9-patch data');
        const bytes = compressed[0] === 0x1f && compressed[1] === 0x8b ? await boundedBytes(new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))), 16 * 1024 * 1024, 'Expanded framework 9-patch data') : compressed;
        const parsed = JSON.parse(utf8.decode(bytes)); if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries) || parsed.density !== 160) throw new Error('Invalid framework 9-patch data');
        table.ninePatch = new Map(parsed.entries.map(entry => { const binary = atob(entry.data), data = Uint8Array.from(binary, c => c.charCodeAt(0)); return [entry.id >>> 0, { name: entry.name, path: entry.path, bytes: data }]; }));
        result.metadata.ninePatch = { entries: table.ninePatch.size, density: 160 };
      } catch (error) { result.metadata.ninePatch = { entries: 0, error: String(error.message || error) }; }
    }
    onProgress?.({ phase: 'framework-resources', completed: 1, total: 1, message: `Framework data ready: ${table.entries.size} original IDs` });
    return result;
  }
}
