const SIZE = 64, LIMIT = 1024 * 1024;
const fail = message => { throw new Error(`AOSP resource configuration: ${message}`); };
export const WEB_DEVICE_CONFIGURATION = Object.freeze({ sdkVersion: 28, density: 160, widthDp: 411, heightDp: 840, smallestWidthDp: 411, orientation: 1, uiMode: 0x11, screenLayout: 0x62, language: 'en', region: 'US', touchscreen: 3, keyboard: 1, navigation: 1, inputFlags: 0x0b, screenLayout2: 1, colorMode: 5 });
const sha256 = async bytes => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
async function readBounded(fetchImpl, url) {
  const response = await fetchImpl(url); if (!response.ok) fail(`HTTP ${response.status}`);
  if (Number(response.headers?.get('content-length')) > LIMIT) fail('asset exceeds 1 MiB');
  const chunks = [], reader = response.body.getReader(); let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > LIMIT) { await reader.cancel(); fail('asset exceeds 1 MiB'); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
function requestedBytes(profile) {
  const bytes = new Uint8Array(SIZE), data = new DataView(bytes.buffer);
  const integer = (key, max) => { const value = profile[key]; if (!Number.isInteger(value) || value < 0 || value > max) fail(`invalid device ${key}`); return value; };
  data.setUint32(0, SIZE, true);
  for (const [offset, key] of [[12, 'orientation'], [13, 'touchscreen'], [16, 'keyboard'], [17, 'navigation'], [18, 'inputFlags'], [28, 'screenLayout'], [29, 'uiMode'], [48, 'screenLayout2'], [49, 'colorMode']]) bytes[offset] = integer(key, 255);
  for (const [offset, key] of [[14, 'density'], [24, 'sdkVersion'], [30, 'smallestWidthDp'], [32, 'widthDp'], [34, 'heightDp']]) data.setUint16(offset, integer(key, 65535), true);
  if (!profile.density || !profile.sdkVersion) fail('device density and SDK must be positive');
  const width = Math.round(profile.widthDp * profile.density / 160), height = Math.round(profile.heightDp * profile.density / 160);
  if (width > 65535 || height > 65535) fail('device pixel dimensions exceed configuration range');
  data.setUint16(20, width, true); data.setUint16(22, height, true);
  // The app currently exposes this explicit en-US device profile, not browser locale telemetry.
  if (!/^[a-z]{2}$/.test(profile.language) || !/^[A-Z]{2}$/.test(profile.region)) fail('device locale requires two-letter language/region');
  bytes[8] = profile.language.charCodeAt(0); bytes[9] = profile.language.charCodeAt(1); bytes[10] = profile.region.charCodeAt(0); bytes[11] = profile.region.charCodeAt(1);
  return bytes;
}

/** Runs original AOSP C++ match/isBetterThan in a standalone Wasm module with zero imports. */
export class ResourceConfigProvider {
  constructor({ bytes = null, metadata = null, url = null, provenanceURL = null, profile = {}, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    this.bytes = bytes; this.metadata = metadata; this.url = url; this.provenanceURL = provenanceURL;
    this.profile = Object.freeze({ ...WEB_DEVICE_CONFIGURATION, ...profile }); this.fetch = fetchImpl?.bind(globalThis); this.pending = null;
  }
  load() { return this.pending ??= this.loadOnce(); }
  async loadOnce() {
    let metadata = this.metadata, bytes = this.bytes;
    if (!metadata && this.provenanceURL) metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(this.fetch, this.provenanceURL)));
    if (!bytes && this.url) bytes = await readBounded(this.fetch, this.url);
    bytes = bytes instanceof Uint8Array ? bytes : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : null;
    if (!bytes || bytes.length > LIMIT || !metadata?.sha256) fail('verified Wasm bytes and provenance are required');
    if (await sha256(bytes) !== metadata.sha256) fail('Wasm SHA-256 mismatch');
    const module = await WebAssembly.compile(bytes);
    if (WebAssembly.Module.imports(module).length) fail('resource selector must have zero OS/host imports');
    const instance = await WebAssembly.instantiate(module), api = instance.exports;
    api._initialize(); if (api.config_size() !== SIZE) fail('unexpected ResTable_config ABI');
    const pointer = api.config_buffer(), slots = new Uint8Array(api.memory.buffer, pointer, SIZE * 3); let requested = requestedBytes(this.profile), profile = this.profile;
    const configurations = new WeakMap(); let selections = new WeakMap(), comparisons = 0, generation = 0;
    const pack = config => {
      if (configurations.has(config)) return configurations.get(config);
      const input = config.bytes;
      if (!Array.isArray(input) || input.length > 252 || input.some(value => !Number.isInteger(value) || value < 0 || value > 255)) fail('malformed compiled resource configuration');
      if (input.slice(SIZE - 4).some(Boolean)) fail('qualifiers newer than the selected original AOSP ABI are unsupported');
      const value = new Uint8Array(SIZE); new DataView(value.buffer).setUint32(0, SIZE, true); value.set(input.slice(0, SIZE - 4), 4);
      if ([19, 50, 51, 61, 62, 63].some(offset => value[offset]) || value[52] > 1) fail('nonzero reserved/new qualifier or malformed boolean in original AOSP ABI');
      configurations.set(config, value); return value;
    };
    const chooseConfiguration = variants => {
      if (!Array.isArray(variants) || variants.length > 65536) fail('invalid variant count');
      if (selections.has(variants)) return selections.get(variants);
      let selected = null;
      slots.fill(0); slots.set(requested, SIZE * 2);
      for (const candidate of variants) {
        slots.set(pack(candidate.config), 0); api.config_prepare(); comparisons++;
        if (api.config_match() && (!selected || api.config_better())) { selected = candidate; slots.copyWithin(SIZE, 0, SIZE); }
      }
      selections.set(variants, selected); return selected;
    };
    // Live device changes (locale, night mode, size, orientation...): the same original AOSP match/isBetterThan run against the new requested ResTable_config.
    const reconfigure = next => { const merged = Object.freeze({ ...WEB_DEVICE_CONFIGURATION, ...next }); requested = requestedBytes(merged); profile = merged; selections = new WeakMap(); generation++; return merged; };
    return { chooseConfiguration, reconfigure, profile: () => profile, generation: () => generation, metadata: { ...metadata, enabled: true, integrity: 'verified-SHA-256', execution: 'original-AOSP-C++/WebAssembly', profile: this.profile }, stats: () => ({ comparisons }) };
  }
}
