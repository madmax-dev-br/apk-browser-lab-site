// The system programs of /system/bin (vendor/system-programs, scripts/build-system-programs.sh): toybox, mksh (/system/bin/sh) and toolbox, compiled from AOSP's own
// android-13.0.0_r1 sources to WebAssembly, checked against their pinned SHA-256 and compiled once. The process kernel (src/process-kernel.js) instantiates them.
import { APKError } from './apk-error.js?v=d826b7643adc';

const decoder = new TextDecoder();
const fail = (message, kind = 'system-programs') => { throw new APKError(message, { kind }); };
const PROGRAMS = ['toybox', 'mksh', 'toolbox'];

export class SystemProgramsProvider {
  /** `files`: { 'provenance.json', 'toybox.wasm', ... } bytes already at hand (tests), else they are fetched from `baseURL`. */
  constructor({ baseURL = new URL('../vendor/system-programs/', import.meta.url), fetchImpl, files = null } = {}) {
    this.baseURL = new URL(baseURL, import.meta.url); this.fetchImpl = fetchImpl || (url => globalThis.fetch(url)); this.files = files;
  }
  async read(name, maximum) {
    if (this.files?.[name]) return this.files[name];
    const response = await this.fetchImpl(new URL(name, this.baseURL)); if (!response.ok) fail(`system program asset ${name} unavailable (HTTP ${response.status})`);
    const buffer = await response.arrayBuffer(); if (buffer.byteLength > maximum) fail(`system program asset ${name} exceeds its bounded size`); return new Uint8Array(buffer);
  }
  load() { return this.promise ??= this.initialize().catch(error => { this.promise = null; throw error; }); }
  async initialize() {
    const metadata = JSON.parse(decoder.decode(await this.read('provenance.json', 1024 * 1024)));
    if (metadata.schemaVersion !== 1 || !metadata.programs) fail('Unsupported system programs provenance');
    const sha = async bytes => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    const bytes = {}, modules = {};
    await Promise.all(PROGRAMS.map(async name => {
      const entry = metadata.programs[name]; if (!entry) fail(`system programs provenance names no ${name}`);
      const data = await this.read(entry.file, 8 * 1024 * 1024);
      if (data.length !== entry.bytes || await sha(data) !== entry.sha256) fail(`${entry.file} does not match its pinned SHA-256`, 'system-programs-hash-mismatch');
      bytes[name] = data; modules[name] = await WebAssembly.compile(data);
    }));
    const rc = await this.read(metadata.mkshrc.file, 64 * 1024);
    if (await sha(rc) !== metadata.mkshrc.sha256) fail('mkshrc does not match its pinned SHA-256', 'system-programs-hash-mismatch');
    bytes.mkshrc = rc;
    return { modules, bytes, metadata };
  }
}

/** Does the app's code reach Runtime.exec / ProcessBuilder (its DEX references java.lang.Process or ProcessBuilder)? Then the loader loads the programs. */
export const usesProcesses = types => types.some(type => type === 'Ljava/lang/Process;' || type === 'Ljava/lang/ProcessBuilder;' || type === 'Ljava/lang/UNIXProcess;');
