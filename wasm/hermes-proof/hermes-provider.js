import { HERMES_PROOF_ASSETS } from './asset-hashes.js';

const MAX_INPUT = 32 * 1024 * 1024;
const bytesOf = value => value instanceof Uint8Array ? value : new Uint8Array(value);
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');

/** Standalone engine experiment. No Java, Android, native-module or network bridge. */
export class HermesProofProvider {
  constructor({ baseURL = new URL('./', import.meta.url), fetchImpl = globalThis.fetch?.bind(globalThis), factory = null } = {}) {
    this.baseURL = baseURL; this.fetchImpl = fetchImpl; this.factory = factory;
  }
  async verifiedAsset(name) {
    const expected = HERMES_PROOF_ASSETS[name];
    if (!expected) throw new Error(`Unknown Hermes proof asset: ${name}`);
    const url = new URL(name, this.baseURL);
    if (!url.search && new URL(import.meta.url).search) url.search = new URL(import.meta.url).search;
    const response = await this.fetchImpl(url.href, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Hermes proof asset HTTP ${response.status}: ${name}`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > expected.bytes) throw new Error(`Hermes proof asset size mismatch: ${name}`);
    const chunks = [], reader = response.body?.getReader(); let size = 0;
    if (!reader) throw new Error('Bounded streaming fetch is required for Hermes assets');
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length;
        if (size > expected.bytes) throw new Error(`Hermes proof asset exceeds size bound: ${name}`);
        chunks.push(part.value);
      }
    } catch (error) { await reader.cancel(); throw error; }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (bytes.length !== expected.bytes || await sha256(bytes) !== expected.sha256)
      throw new Error(`Hermes proof asset SHA-256/size mismatch: ${name}`);
    return bytes;
  }
  async load() {
    const [glue, wasm] = await Promise.all([this.verifiedAsset('vendor/hermes.js'), this.verifiedAsset('vendor/hermes.wasm')]);
    if (!this.factory) {
      if (typeof globalThis.importScripts !== 'function') throw new Error('Hermes proof must initialize in its dedicated classic Worker');
      const url = URL.createObjectURL(new Blob([glue], { type: 'text/javascript' }));
      try { globalThis.importScripts(url); this.factory = globalThis.HermesWasm; }
      finally { URL.revokeObjectURL(url); }
    }
    if (typeof this.factory !== 'function') throw new Error('Official Hermes factory is unavailable');
    const output = [], errors = [];
    const append = (target, line) => { if (target.length < 32) target.push(String(line).slice(0, 1200)); };
    const wasmURL = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' })); let module;
    try {
      module = await this.factory({ noInitialRun: true, wasmBinary: wasm,
        // Emscripten also requests a location before consuming wasmBinary.
        // Its only fallback points to these same verified bytes.
        locateFile: name => { if (name !== 'hermes.wasm') throw new Error('Unexpected Hermes asset request'); return wasmURL; },
        print: line => append(output, line), printErr: line => append(errors, line) });
    } finally { URL.revokeObjectURL(wasmURL); }
    let used = false;
    return {
      metadata: { engine: 'official-Hermes', tag: 'v0.13.0', commit: '4b3bf912cc0f705b51b71ce1a5b8bd79b93a451b',
        bytecodeVersion: 96, wasmSha256: HERMES_PROOF_ASSETS['vendor/hermes.wasm'].sha256,
        hostFilesystemMounted: false, applicationNativeModulesInstalled: false, networkingInstalled: false },
      runBytecode(input) {
        if (used) throw new Error('Create a fresh Hermes VM for each proof execution');
        const bytes = bytesOf(input);
        if (bytes.length < 128 || bytes.length > MAX_INPUT) throw new Error('Hermes proof input must be 128 bytes to 32 MiB');
        const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (header.getBigUint64(0, true) !== 0x1f1903c103bc1fc6n || header.getUint32(8, true) !== 96)
          throw new Error('This engine proof requires genuine Hermes bytecode version 96');
        used = true; module.FS.writeFile('/input.hbc', bytes);
        let exit;
        try { exit = module.callMain(['/input.hbc']); }
        finally { module.FS.unlink('/input.hbc'); }
        return { exit, output: [...output], errors: [...errors], bytecodeVersion: 96, inputPersisted: false };
      },
    };
  }
}
