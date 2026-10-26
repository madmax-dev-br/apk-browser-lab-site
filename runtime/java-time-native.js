import { APKError } from './apk-error.js?v=32afb2a18437';

// Framework natives behind the original libcore java.time sources compiled into the framework DEX.
//   jdk.internal.misc.VM.getNanoTimeAdjustment(long)  -- Clock.systemUTC(): nanoseconds to add to offsetInSeconds to reach the current wall clock, -1 when the
//                                                        difference does not fit (|diff| > 2^32 s), exactly the JDK contract.
//   java.time.zone.IcuZoneRulesProvider.nativeTzdb()  -- the bytes of vendor/tzdata/tzdb.dat for the lab-authored IcuZoneRulesProvider; the provider
//                                                        (TzdataProvider below) verifies the pinned SHA-256 before the VM can see a byte.
const VM = 'Ljdk/internal/misc/VM;', PROVIDER = 'Ljava/time/zone/IcuZoneRulesProvider;';

export class TzdataProvider {
  constructor({ baseURL = new URL('../vendor/tzdata/', import.meta.url), fetchImpl, bytes, metadata } = {}) {
    this.baseURL = new URL(baseURL, import.meta.url); this.fetchImpl = fetchImpl || (url => globalThis.fetch(url)); this.bytes = bytes; this.metadata = metadata;
  }
  async read(url, maximum) {
    const response = await this.fetchImpl(url); if (!response.ok) throw new APKError(`tz database asset unavailable (HTTP ${response.status})`);
    const buffer = await response.arrayBuffer(); if (buffer.byteLength > maximum) throw new APKError('tz database asset exceeds bounded size'); return new Uint8Array(buffer);
  }
  load() { return this.promise ??= this.initialize().catch(error => { this.promise = null; throw error; }); }
  async initialize() {
    const metadata = this.metadata || JSON.parse(new TextDecoder().decode(await this.read(new URL('provenance.json', this.baseURL), 256 * 1024)));
    if (metadata.schemaVersion !== 1 || !/^[0-9a-f]{64}$/.test(metadata.sha256 ?? '')) throw new APKError('Unsupported tz database provenance');
    const bytes = this.bytes || await this.read(new URL(metadata.file, this.baseURL), 4 * 1024 * 1024);
    const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== metadata.sha256 || bytes.length !== metadata.bytes) throw new APKError('tz database does not match its pinned SHA-256', { kind: 'tzdata-hash-mismatch' });
    return { bytes, metadata: { ...metadata, source: 'AOSP android-13.0.0_r1 tzdata2022a via OpenJDK TzdbZoneRulesCompiler', verified: true } };
  }
}

export function createJavaTimeNativeBindings() {
  const bindings = new Map();
  bindings.set(`${VM}->getNanoTimeAdjustment(J)J`, (runtime, [offsetInSeconds]) => {
    const nowNanos = runtime.clock.wallNanos(), diff = nowNanos - BigInt.asIntN(64, offsetInSeconds) * 1000000000n;
    const seconds = diff / 1000000000n;
    return seconds > 4294967295n || seconds < -4294967295n ? -1n : diff;
  });
  bindings.set(`${PROVIDER}->nativeTzdb()[B`, runtime => {
    const data = runtime.tzdata?.bytes; if (!data) throw new APKError('java.time zone rules need the verified tz database (options.tzdataProvider)', { kind: 'tzdata-missing' });
    runtime.tzdbArray ??= (() => { const array = runtime.newArray('[B', data.length); runtime.array(array).elements = Array.from(data, v => (v << 24) >> 24); return array; })();
    return runtime.tzdbArray;
  });
  return bindings;
}
