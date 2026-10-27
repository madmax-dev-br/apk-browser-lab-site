import { APKError, DexFile } from './apk-runtime.js?v=87d26d81015e';
import { createVectorNativeBindings } from './vector-native.js?v=87d26d81015e';
import { createMatrixNativeBindings } from './matrix-native.js?v=87d26d81015e';
import { createCharsetNativeBindings } from './charset-native.js?v=87d26d81015e';
import { createSqliteNativeBindings } from './sqlite-native.js?v=87d26d81015e';
import { createJavaTimeNativeBindings } from './java-time-native.js?v=87d26d81015e';
import { createMathNativeBindings } from './math-native.js?v=87d26d81015e';
import { createUnsafeNativeBindings } from './unsafe-native.js?v=87d26d81015e';
import { createZipNativeBindings } from './zip-native.js?v=87d26d81015e';
import { createLibcoreIoNativeBindings } from './libcore-io-native.js?v=87d26d81015e';
import { createNetworkNativeBindings } from './network-native.js?v=87d26d81015e';
import { createParcelNativeBindings } from './parcel-native.js?v=87d26d81015e';
import { createInputNativeBindings } from './input-native.js?v=87d26d81015e';
import { createViewHiddenNativeBindings } from './view-hidden-native.js?v=87d26d81015e';
import { createRegionNativeBindings } from './region-native.js?v=87d26d81015e';
import { createRenderThreadAnimators } from './rt-animators.js?v=87d26d81015e';
import { createIcuConverterNativeBindings } from './icu-converter-native.js?v=87d26d81015e';
import { createTextLayoutNativeBindings } from './text-layout-native.js?v=87d26d81015e';
import { createColorFilterNativeBindings } from './color-filter-native.js?v=87d26d81015e';
import { createRenderNodeNativeBindings } from './rendernode-native.js?v=87d26d81015e';
import { createAnimatedVectorNativeBindings } from './animated-vector-native.js?v=87d26d81015e';
import { createRegexNativeBindings } from './regex-native.js?v=87d26d81015e';

const MAX_FRAMEWORK_BYTES = 64 * 1024 * 1024;
const NATIVE_GET_INT = 'Landroid/os/SystemProperties;->native_get_int(Ljava/lang/String;I)I';

/** Explicit VM system properties. These describe the web device model, never host telemetry. */
export function createFrameworkNativeBindings({ properties = {}, onBoundary = null } = {}) {
  const state = properties instanceof Map ? new Map(properties) : new Map(Object.entries({ 'ro.sf.lcd_density': '160', 'build.version.extensions.r': '3', 'build.version.extensions.s': '3', 'build.version.extensions.t': '3', ...properties }))   /* SDK extension levels of an android-13 device */;
  const bindings = new Map([[NATIVE_GET_INT, (runtime, args, method) => {
    const [key, fallback] = args;
    if (typeof key !== 'string' || !Number.isInteger(fallback)) throw new APKError('Invalid SystemProperties native_get_int arguments');
    const text = state.has(key) ? String(state.get(key)).trim() : null;
    let value = fallback | 0;
    if (text !== null && /^[+-]?(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(text)) {
      const negative = text.startsWith('-'), unsigned = text.replace(/^[+-]/, '');
      const number = Number(unsigned) * (negative ? -1 : 1);
      if (Number.isSafeInteger(number) && number >= -2147483648 && number <= 2147483647) value = number | 0;
    }
    onBoundary?.({ key: method.key, property: key, value, source: 'explicit-web-device-properties' });
    runtime.record(`PROPERTY ${key}=${value} [web-device-model]`);
    return value;
  }]]);
  bindings.set('Landroid/os/SystemProperties;->native_get_boolean(Ljava/lang/String;Z)Z',(runtime,[key,fallback],method)=>{
    if(typeof key!=='string'||![0,1].includes(fallback))throw new APKError('Invalid SystemProperties native_get_boolean arguments');
    const value=state.has(key)?String(state.get(key)):null;
    // Android13 system/libbase/parsebool.cpp: exact, case-sensitive spellings.
    const result=['1','y','yes','on','true'].includes(value)?1:['0','n','no','off','false'].includes(value)?0:fallback;
    onBoundary?.({key:method.key,property:key,value:result,source:'explicit-web-device-properties'});
    runtime.record(`PROPERTY ${key}=${!!result} [web-device-model]`);return result;
  });
  // SystemProperties.get(key[, default]) -> property_get: the stored value, else the default ("" without one).
  for (const [signature, hasDefault] of [['native_get(Ljava/lang/String;)Ljava/lang/String;', false], ['native_get(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;', true]]) bindings.set(`Landroid/os/SystemProperties;->${signature}`, (runtime, args, method) => {
    const key = args[0]; if (typeof key !== 'string') throw new APKError('Invalid SystemProperties native_get arguments');
    const found = state.has(key), value = found ? String(state.get(key)) : hasDefault ? args[1] : '';
    onBoundary?.({ key: method.key, property: key, value, source: 'explicit-web-device-properties' }); runtime.record(`PROPERTY ${key}=${found ? value : '<unset>'} [web-device-model]`); return value;
  });
  for (const name of ['newUnpaddedArray', 'newNonMovableArray']) bindings.set(
    `Ldalvik/system/VMRuntime;->${name}(Ljava/lang/Class;I)Ljava/lang/Object;`, (runtime, args) => {
      runtime.object(args[0]); const component = runtime.object(args[1]).classType;
      if (!component || component === 'V') runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'Invalid array component type');
      const value = runtime.newArray('[' + component, args[2]);
      runtime.object(value).nonMovable = name === 'newNonMovableArray';
      return value;
    });
  bindings.set('Ldalvik/system/VMRuntime;->addressOf(Ljava/lang/Object;)J', (runtime, args) => {
    runtime.object(args[0]); const value = args[1];
    if (value === null || value === 0) return 0n;
    const object = runtime.object(value);
    if (!object.type.startsWith('[')) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'not an array');
    if (!/^\[[ZBCSIJFD]$/.test(object.type)) runtime.throwJava('Ljava/lang/IllegalArgumentException;', 'not a primitive array');
    if (!object.nonMovable) runtime.throwJava('Ljava/lang/RuntimeException;', 'Trying to get address of movable array object');
    return runtime.nativeArrayHandle(value);
  });
  const referenceField='Ljava/lang/ref/Reference;->referent:Ljava/lang/Object;';
  for(const [name,signature]of [['getReferent','()Ljava/lang/Object;'],['refersTo0','(Ljava/lang/Object;)Z'],['clearReferent','()V']])bindings.set(`Ljava/lang/ref/Reference;->${name}${signature}`,(runtime,args)=>{
    const object=runtime.object(args[0]),referent=object.fields.get(referenceField)??null;
    if(name==='getReferent')return referent;
    if(name==='clearReferent'){runtime.storeField(object.fields,referenceField,null);return;}
    return referent===args[1]||(referent?.ref!==undefined&&referent.ref===args[1]?.ref)?1:0;
  });
  bindings.set('Ldalvik/system/VMRuntime;->setTargetSdkVersionNative(I)V',(runtime,args,method)=>{
    runtime.object(args[0]);const target=args[1];if(!Number.isInteger(target)||target<1)throw new APKError('Invalid VM target SDK bootstrap');
    runtime.targetSdkVersion=target;runtime.record(`TARGET_SDK ${target} [actual APK manifest / virtual ART compatibility profile]`);
    onBoundary?.({key:method.key,value:target,source:'actual-apk-target-sdk'});
  });
  // The web device has no atrace/kernel tracing session. Original Trace.java
  // decides whether to emit each section/counter from this explicit tag mask.
  // Emission and enablement natives remain unbound rather than reporting success.
  bindings.set('Landroid/os/Trace;->nativeGetEnabledTags()J', runtime => {
    runtime.record('TRACE enabled tags=0 [web-device profiling disabled]'); return 0n;
  });
  for (const [key] of createRenderThreadAnimators(null).bindings) bindings.set(key, (runtime, args) => runtime.platform.rtAnimators.table.get(key)(runtime, args));   // RenderNodeAnimator / native interpolators: the engine is per platform
  for (const [key, binding] of [...createVectorNativeBindings(), ...createMatrixNativeBindings(), ...createCharsetNativeBindings(), ...createTextLayoutNativeBindings(), ...createColorFilterNativeBindings(), ...createRenderNodeNativeBindings(), ...createRegexNativeBindings(), ...createNetworkNativeBindings(), ...createParcelNativeBindings(), ...createInputNativeBindings(), ...createViewHiddenNativeBindings(), ...createRegionNativeBindings(), ...createAnimatedVectorNativeBindings(), ...createSqliteNativeBindings(), ...createJavaTimeNativeBindings(), ...createMathNativeBindings(), ...createUnsafeNativeBindings(), ...createZipNativeBindings(), ...createLibcoreIoNativeBindings(), ...createIcuConverterNativeBindings()]) bindings.set(key, binding);
  return bindings;
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) return null;
  const copy = bytes.slice();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function responseBytes(response, limit, label) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (declared > limit) throw new APKError(`${label} exceeds size limit`);
  if (!response.body?.getReader) { const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.length > limit) throw new APKError(`${label} exceeds size limit`); return bytes; }
  const reader = response.body.getReader(), chunks = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw new APKError(`${label} exceeds size limit`); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Loads a source-compiled AOSP DEX layer as code, not a generated list of framework shims. */
export class FrameworkProvider {
  constructor({ bytes = null, url = new URL('../framework-aosp/framework.dex', import.meta.url), filename = 'framework-aosp/framework.dex', metadata = {}, provenanceURL = null,
    expectedSha256 = null, properties = {}, fetchImpl = globalThis.fetch, nativeBindings = null, onBoundary = null } = {}) {
    this.bytes = bytes; this.url = url;this.filename=filename; this.metadata = metadata; this.provenanceURL = provenanceURL; this.expectedSha256 = expectedSha256;
    // WorkerGlobalScope.fetch is a WebIDL method: preserve its global receiver rather
    // than accidentally invoking the extracted function with this provider as `this`.
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl.bind(globalThis) : fetchImpl;
    this.nativeBindings = createFrameworkNativeBindings({ properties, onBoundary });
    if (nativeBindings) for (const [key, binding] of nativeBindings instanceof Map ? nativeBindings : Object.entries(nativeBindings)) {
      if (typeof binding !== 'function') throw new APKError(`Framework native binding is not callable: ${key}`);
      this.nativeBindings.set(key, binding);
    }
    this.pending = null;
  }
  async load({ onProgress = null } = {}) {
    if (!this.pending) this.pending = this.loadOnce(onProgress).catch(error => { this.pending = null; throw error; });
    return this.pending;
  }
  async loadOnce(onProgress) {
    await onProgress?.({ phase: 'framework', completed: 0, total: 1, message: 'Loading source-compiled AOSP framework DEX' });
    let sourceMetadata = this.metadata;
    if (this.provenanceURL) {
      if (typeof this.fetchImpl !== 'function') throw new APKError('Framework provenance requires a static asset fetch or injected metadata');
      const response = await this.fetchImpl(this.provenanceURL);
      if (!response.ok) throw new APKError(`AOSP provenance asset could not be loaded (${response.status})`);
      sourceMetadata = { ...JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await responseBytes(response, 1024 * 1024, 'AOSP provenance'))), ...this.metadata };
    }
    let bytes;
    if (this.bytes) bytes = this.bytes instanceof Uint8Array ? this.bytes : new Uint8Array(this.bytes);
    else {
      if (typeof this.fetchImpl !== 'function') throw new APKError('AOSP framework requires injected bytes or a local static asset URL');
      const response = await this.fetchImpl(this.url);
      if (!response.ok) throw new APKError(`AOSP framework asset could not be loaded (${response.status}): ${this.url}`);
      bytes = await responseBytes(response, MAX_FRAMEWORK_BYTES, 'AOSP framework asset');
    }
    if (bytes.byteLength > MAX_FRAMEWORK_BYTES) throw new APKError('AOSP framework DEX exceeds 64 MiB limit');
    const hash = await sha256(bytes);
    const expectedSha256 = this.expectedSha256 ?? sourceMetadata.sha256 ?? null;
    if (expectedSha256 && !hash) throw new APKError('SHA-256 verification requires Web Crypto for the AOSP framework');
    if (expectedSha256 && hash !== expectedSha256.toLowerCase()) throw new APKError('AOSP framework SHA-256 mismatch');
    const filename = this.filename, dex = new DexFile(bytes, { filename, maxBytes: MAX_FRAMEWORK_BYTES });
    const metadata = { ...sourceMetadata, enabled: true, filename, bytes: bytes.byteLength, sha256: hash, virtualAndroidApiLevel: sourceMetadata.virtualAndroidApiLevel ?? 28,
      classes: dex.classes.size, methods: dex.methods.length, nativeBoundaries: [...this.nativeBindings.keys()],
      source: 'source-compiled-AOSP', policy: 'curated-boot-parent-first' };
    await onProgress?.({ phase: 'framework', completed: 1, total: 1, message: `AOSP DEX ready: ${dex.classes.size} framework classes` });
    return { files: [{ filename, dex }], nativeBindings: this.nativeBindings, metadata };
  }
}
