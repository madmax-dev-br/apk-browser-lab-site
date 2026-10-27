import { APKError, APKRuntime, BinaryReader, DexFile, DexProgram, dottedName } from './apk-runtime.js?v=d50f2f368405';
import { detectReactNativeVersion, detectHermesBytecodeVersion } from './rn-version.js?v=d50f2f368405';
import { inspectELF } from './native-inspector.js?v=d50f2f368405';
import { inflateRaw } from './inflate.js?v=d50f2f368405';
import { resolveDevice } from './device-profile.js?v=d50f2f368405';
import { resourceProfileFor } from './device-configuration.js?v=d50f2f368405';
import { JniBridge } from './jni-host.js?v=d50f2f368405';
import { getDefaultJavacryptoProvider } from './javacrypto-native.js?v=d50f2f368405';
import { nativeProviderWithSqlcipher } from './sqlcipher-native.js?v=d50f2f368405';
import { AndroidResources } from './android-resources.js?v=d50f2f368405';
import { AndroidPlatform } from './android-platform.js?v=d50f2f368405';
import { FrameworkProvider } from './framework-provider.js?v=d50f2f368405';

const fail = message => { throw new APKError(message); };
const utf8 = new TextDecoder('utf-8', { fatal: true });
const MAX_APK = 1024 * 1024 * 1024;
const MAX_DEX = 64 * 1024 * 1024;
// Android sets no combined DEX limit. Parsed DEX takes about 5x its size in JS heap
// (22 MB of DEX -> ~115 MB), so this keeps the parse within a desktop tab's heap.
export const MAX_DEX_TOTAL = 768 * 1024 * 1024;
// ART has no fixed multidex count; this only bounds memory for hostile archives.
const MAX_DEX_FILES = 1024;
// The ZIP end record counts entries in 16 bits; this accepts every non-ZIP64 APK.
const MAX_ZIP_ENTRIES = 65535;
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0, n = bytes.length; i < n; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function frameworkBytesHash(files) {
  if (!globalThis.crypto?.subtle) fail('Source profile framework compatibility verification requires Web Crypto');
  const chunks = files.map(file => (file.dex ?? file).reader?.bytes);
  if (chunks.some(bytes => !(bytes instanceof Uint8Array))) fail('Source profile base framework has no verifiable DEX bytes');
  const size = chunks.reduce((total, bytes) => total + bytes.length, 0);
  if (size > 128 * 1024 * 1024) fail('Source profile base framework exceeds 128 MiB');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** Central-directory ZIP reader. Entries are expanded on demand with explicit bounds. */
export class APKArchive {
  constructor(input) {
    const b = this.reader = new BinaryReader(input);
    if (b.length < 22 || b.length > MAX_APK) fail('Invalid APK size: expected a ZIP from 22 bytes to 1 GiB');
    let end = -1;
    for (let p = b.length - 22; p >= Math.max(0, b.length - 65557); p--)
      if (b.u32(p) === 0x06054b50 && p + 22 + b.u16(p + 20) === b.length) { end = p; break; }
    if (end < 0) fail('Invalid APK: ZIP central directory not found');
    const count = b.u16(end + 10), directorySize = b.u32(end + 12), start = b.u32(end + 16);
    if (b.u16(end + 4) || b.u16(end + 6) || b.u16(end + 8) !== count || !count || count > MAX_ZIP_ENTRIES || start + directorySize > end)
      fail('Unsupported APK ZIP layout: ZIP64, multiple volumes or excessive entries');
    this.entries = new Map(); this.centralDirectoryOffset = start;
    let p = start, filenameBytes = 0;
    for (let i = 0; i < count; i++) {
      if (b.u32(p) !== 0x02014b50) fail('Malformed APK central directory entry');
      const flags = b.u16(p + 8), method = b.u16(p + 10), crc = b.u32(p + 16), compressed = b.u32(p + 20), size = b.u32(p + 24);
      const nameSize = b.u16(p + 28), extra = b.u16(p + 30), comment = b.u16(p + 32), offset = b.u32(p + 42);
      filenameBytes += nameSize;
      if (!nameSize || nameSize > 4096 || filenameBytes > 8 * 1024 * 1024) fail('APK ZIP filenames exceed bounds');
      const name = utf8.decode(b.slice(p + 46, nameSize));
      if (this.entries.has(name)) fail(`Duplicate APK ZIP entry: ${name}`);
      if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) fail('ZIP64 APK entries are unsupported');
      this.entries.set(name, { name, flags, method, crc, compressed, size, offset });
      p += 46 + nameSize + extra + comment;
      if (p > start + directorySize || p > end) fail('Malformed APK central directory size');
    }
    if (p !== start + directorySize) fail('Malformed APK central directory length');
    this.directoryStart = start;
  }
  payload(name) {
    const e = this.entries.get(name), b = this.reader;
    if (!e) fail(`APK is missing ${name}`);
    if (e.flags & 1) fail(`Encrypted APK entry is unsupported: ${name}`);
    if (![0, 8].includes(e.method)) fail(`Unsupported ZIP compression ${e.method}: ${name}`);
    if (b.u32(e.offset) !== 0x04034b50 || b.u16(e.offset + 8) !== e.method || (b.u16(e.offset + 6) & 1))
      fail(`Malformed APK local entry: ${name}`);
    const nameSize = b.u16(e.offset + 26), extra = b.u16(e.offset + 28);
    if (utf8.decode(b.slice(e.offset + 30, nameSize)) !== name) fail(`APK local filename mismatch: ${name}`);
    const start = e.offset + 30 + nameSize + extra;
    if (start + e.compressed > this.directoryStart) fail(`APK entry overlaps central directory: ${name}`);
    return { entry: e, compressed: b.slice(start, e.compressed) };
  }
  /** Synchronous variant for the run-time VM (Class.getResource, AssetManager.open): same bounds and CRC checks as extract(). */
  extractSync(name, limit) {
    const e = this.entries.get(name);
    if (!e) fail(`APK is missing ${name}`);
    if (!Number.isSafeInteger(limit) || limit < 0) fail('APK extraction requires a nonnegative byte limit');
    if (e.size > limit) fail(`${name} exceeds ${Math.round(limit / 1024 / 1024)} MiB limit`);
    const { compressed } = this.payload(name);
    let data;
    if (e.method === 0) data = compressed.slice();
    else { try { data = inflateRaw(compressed, e.size); } catch (error) { fail(`Unable to decompress ${name}: ${error.message}`); } }
    if (data.length !== e.size || crc32(data) !== e.crc) fail(`APK entry size/CRC mismatch: ${name}`);
    return data;
  }
  async extract(name, limit) {
    const e = this.entries.get(name);
    if (!Number.isSafeInteger(limit) || limit < 0) fail('APK extraction requires a nonnegative byte limit');
    if (e?.size > limit) fail(`${name} exceeds ${Math.round(limit / 1024 / 1024)} MiB limit`);
    const { compressed } = this.payload(name);
    let data;
    if (e.method === 0) data = compressed.slice();
    else {
      if (typeof DecompressionStream !== 'function') fail('This browser requires DecompressionStream with deflate-raw support');
      let decompressor;
      try { decompressor = new DecompressionStream('deflate-raw'); }
      catch { fail('This browser does not support local ZIP deflate-raw decompression; use a recent Chromium browser'); }
      const stream = new ReadableStream({ start(controller) { controller.enqueue(compressed); controller.close(); } });
      const reader = stream.pipeThrough(decompressor).getReader(), chunks = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > e.size || length > limit) { await reader.cancel(); fail(`ZIP expansion exceeds declared size/limit: ${name}`); }
          chunks.push(value);
        }
      } catch (error) { fail(`Unable to decompress ${name}: ${error.message ?? error}`); }
      data = new Uint8Array(length);
      let p = 0;
      for (const chunk of chunks) { data.set(chunk, p); p += chunk.length; }
    }
    if (data.length !== e.size || crc32(data) !== e.crc) fail(`APK entry size/CRC mismatch: ${name}`);
    return data;
  }
  /** Header-only probe: bounded output, deliberately does not claim full-entry CRC validation. */
  async extractPrefix(name, limit = 64) {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 65536) fail('APK prefix probe limit must be 0–65536 bytes');
    const { entry, compressed } = this.payload(name);
    if (entry.method === 0) return compressed.subarray(0, Math.min(limit, entry.size));
    if (typeof DecompressionStream !== 'function') fail('Header probe requires deflate-raw decompression');
    let cursor = 0;
    const stream = new ReadableStream({ pull(controller) {
      if (cursor >= compressed.length) { controller.close(); return; }
      const end = Math.min(cursor + 1024, compressed.length);
      controller.enqueue(compressed.subarray(cursor, end)); cursor = end;
    } });
    const reader = stream.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const result = new Uint8Array(Math.min(limit, entry.size));
    let length = 0;
    try {
      while (length < result.length) {
        const { value, done } = await reader.read();
        if (done) break;
        const amount = Math.min(value.length, result.length - length);
        result.set(value.subarray(0, amount), length); length += amount;
      }
    } finally { await reader.cancel(); }
    return result.subarray(0, length);
  }
}

/** Reads binary Android XML launcher declarations; no Android process or remote service. */
// AOSP frameworks/base/core/res/res/values/public-final.xml (api 1-34) ids for the AndroidManifest attributes this loader reads.
// Production bundles blank the attribute-name strings; Android's XmlBlock then resolves them from the RES_XML_RESOURCE_MAP chunk.
const MANIFEST_ATTRIBUTE_IDS = new Map(Object.entries({ theme: 0x01010000, label: 0x01010001, icon: 0x01010002, name: 0x01010003, permission: 0x01010006, enabled: 0x0101000e, exported: 0x01010010, process: 0x01010011, authorities: 0x01010018, initOrder: 0x0101001a, multiprocess: 0x01010013, grantUriPermissions: 0x0101001b, launchMode: 0x0101001d, screenOrientation: 0x0101001e, configChanges: 0x0101001f, value: 0x01010024, resource: 0x01010025, targetActivity: 0x01010202, minSdkVersion: 0x0101020c, versionCode: 0x0101021b, versionName: 0x0101021c, windowSoftInputMode: 0x0101022b, targetSdkVersion: 0x01010270, maxSdkVersion: 0x01010271, allowBackup: 0x01010280, parentActivityName: 0x010103a7, appComponentFactory: 0x0101057a, extractNativeLibs: 0x010104ea, usesCleartextTraffic: 0x010104ec, enableOnBackInvokedCallback: 0x0101066c, networkSecurityConfig: 0x01010527, foregroundServiceType: 0x01010599 }).map(([name, id]) => [id, name]));
export function parseManifest(data) {
  const b = new BinaryReader(data);
  let resourceMap = null;
  if (b.length < 8 || b.u16(0) !== 0x0003 || b.u16(2) < 8 || b.u32(4) !== b.length) fail('Unsupported/malformed binary AndroidManifest.xml');
  let strings = null, packageName = null, applicationName = null;
  const activities = [], services = [], providers = [], receivers = [], providerDetails = [], componentDetails = [], stack = [];
  let application = {}, usesSdk = {}, manifestAttrs = {};
  const usesPermissions = [], declaredPermissions = [];   // <uses-permission>/<uses-permission-sdk-23> names and the app's own <permission> declarations
  const str = i => { if (!strings || i >= strings.length) fail('Invalid AXML string reference'); return strings[i]; };
  const resolveName = name => name.startsWith('.') ? packageName + name : name.includes('.') ? name : `${packageName}.${name}`;
  for (let p = b.u16(2); p < b.length;) {
    const type = b.u16(p), header = b.u16(p + 2), size = b.u32(p + 4);
    if (header < 8 || size < header) fail('Malformed AXML chunk');
    b.check(p, size);
    if (type === 0x0001) {
      if (header < 28 || strings) fail('Malformed/duplicate AXML string pool');
      const count = b.u32(p + 8), flags = b.u32(p + 16), start = b.u32(p + 20);
      if (count > 200000 || header + count * 4 > size) fail('AXML string pool exceeds limit');
      strings = []; let total = 0;
      for (let i = 0; i < count; i++) {
        let at = p + start + b.u32(p + header + i * 4);
        const length8 = () => { const a = b.u8(at++); return a & 128 ? ((a & 127) << 8) | b.u8(at++) : a; };
        const length16 = () => { const a = b.u16(at); at += 2; if (!(a & 0x8000)) return a; const z = b.u16(at); at += 2; return (a & 0x7fff) * 65536 + z; };
        let value;
        if (flags & 0x100) {
          length8(); const length = length8();
          if (at + length + 1 > p + size || b.u8(at + length) !== 0) fail('Malformed AXML UTF-8 string');
          value = utf8.decode(b.slice(at, length));
        } else {
          const length = length16();
          if (length > 1000000 || at + length * 2 + 2 > p + size || b.u16(at + length * 2) !== 0) fail('Malformed AXML UTF-16 string');
          value = '';
          for (let j = 0; j < length; j += 8192) {
            const units = Array.from({ length: Math.min(8192, length - j) }, (_, k) => b.u16(at + (j + k) * 2));
            value += String.fromCharCode(...units);
          }
        }
        total += value.length;
        if (total > 4000000) fail('AXML strings exceed limit');
        strings.push(value);
      }
    } else if (type === 0x0180) {
      if (resourceMap || size % 4 || size < header) fail('Malformed/duplicate AXML resource map');
      resourceMap = []; for (let at = p + header; at < p + size; at += 4) resourceMap.push(b.u32(at));
    } else if (type === 0x0102) {
      if (header < 16 || size < 36 || stack.length >= 64) fail('Malformed/excessive AXML element');
      const name = str(b.u32(p + 20)), attributeStart = p + 16 + b.u16(p + 24), width = b.u16(p + 26), count = b.u16(p + 28);
      if (width < 20 || attributeStart + count * width > p + size) fail('Malformed AXML attributes');
      const attrs = Object.create(null), attrTypes = Object.create(null);
      for (let i = 0; i < count; i++) {
        const at = attributeStart + i * width, nameIndex = b.u32(at + 4), key = str(nameIndex) || MANIFEST_ATTRIBUTE_IDS.get(resourceMap?.[nameIndex]) || str(nameIndex), raw = b.u32(at + 8), valueType = b.u8(at + 15), value = b.u32(at + 16);
        attrs[key] = raw !== 0xffffffff ? str(raw) : valueType === 3 ? str(value) : value; attrTypes[key] = valueType;
      }
      const node = { name };
      if (name === 'manifest') { packageName = attrs.package; manifestAttrs = { versionCode: attrs.versionCode, versionName: attrs.versionName, installLocation: attrs.installLocation }; }
      if (name === 'application') { application = { ...attrs }; if (typeof attrs.name === 'string') { applicationName = resolveName(attrs.name); application.name = applicationName; } }
      if (name === 'uses-sdk') usesSdk = { ...attrs };
      if ((name === 'uses-permission' || name === 'uses-permission-sdk-23') && typeof attrs.name === 'string') usesPermissions.push({ name: attrs.name, maxSdkVersion: attrs.maxSdkVersion ?? null });
      if (name === 'permission' && typeof attrs.name === 'string') declaredPermissions.push({ name: attrs.name, protectionLevel: attrs.protectionLevel ?? 0 });
      const components = { service: services, provider: providers, receiver: receivers };
      if (components[name] && typeof attrs.name === 'string') components[name].push(resolveName(attrs.name));
      if (components[name] || name === 'application') node.component = name === 'application' ? { metaData: (application.metaData ??= []) } : { metaData: [] };
      if (components[name] && typeof attrs.name === 'string') { const detail = { kind: name, name: resolveName(attrs.name), authorities: attrs.authorities ?? null, exported: attrs.exported, enabled: attrs.enabled, process: attrs.process ?? null, initOrder: attrs.initOrder ?? 0, multiprocess: attrs.multiprocess, directBootAware: attrs.directBootAware, grantUriPermissions: attrs.grantUriPermissions, permission: attrs.permission ?? null, foregroundServiceType: attrs.foregroundServiceType ?? 0, metaData: node.component.metaData, order: componentDetails.length }; node.component.detail = detail; componentDetails.push(detail); if (name === 'provider') providerDetails.push(detail); }
      if (name === 'action' && typeof attrs.name === 'string') { const owner = [...stack].reverse().find(n => n.component)?.component; if (owner?.detail) (owner.detail.actions ??= []).push(attrs.name); }
      if (name === 'meta-data') { const owner = [...stack].reverse().find(n => n.component)?.component; if (owner && typeof attrs.name === 'string') owner.metaData.push({ name: attrs.name, value: attrs.value, valueType: attrTypes.value, resource: attrs.resource }); }
      if (name === 'activity' || name === 'activity-alias') {
        const rawName = name === 'activity-alias' ? attrs.targetActivity : attrs.name;
        if (typeof packageName !== 'string' || typeof rawName !== 'string') fail('Manifest activity/package name is missing');
        node.activity = { ...attrs, name: resolveName(rawName), launcher: false };
        if (typeof attrs.parentActivityName === 'string') node.activity.parentActivityName = resolveName(attrs.parentActivityName);
        activities.push(node.activity);
      }
      const owner = [...stack].reverse().find(n => n.activity)?.activity;
      if (name === 'intent-filter' && owner) node.filter = { activity: owner, main: false, launcher: false };
      const filter = [...stack].reverse().find(n => n.filter)?.filter;
      if (name === 'action' && filter && attrs.name === 'android.intent.action.MAIN') filter.main = true;
      if (name === 'category' && filter && attrs.name === 'android.intent.category.LAUNCHER') filter.launcher = true;
      stack.push(node);
    } else if (type === 0x0103) {
      if (size < 24 || !stack.length) fail('Malformed AXML closing element');
      const node = stack.pop();
      if (node.name !== str(b.u32(p + 20))) fail('Mismatched AXML closing element');
      if (node.filter?.main && node.filter.launcher) node.filter.activity.launcher = true;
    }
    p += size;
  }
  if (!strings || stack.length || typeof packageName !== 'string') fail('Incomplete AndroidManifest.xml');
  const deduplicated = new Map();
  for (const a of activities) {
    if (deduplicated.has(a.name)) deduplicated.get(a.name).launcher ||= a.launcher;
    else deduplicated.set(a.name, { ...a, descriptor: `L${a.name.replaceAll('.', '/')};` });
  }
  const launchers = [...deduplicated.values()].filter(a => a.launcher);
  return { packageName, applicationName, application, usesSdk, usesPermissions, declaredPermissions, activities: [...deduplicated.values()], services, providers, receivers, providerDetails, componentDetails, manifestAttrs,
    componentCounts: { activities: deduplicated.size, services: services.length, providers: providers.length, receivers: receivers.length },
    launcherActivity: launchers.length === 1 ? launchers[0].name : null };
}

async function prepareResources(archive, names, options, report, yieldControl, warnings) {
  const frameworkTable = options.frameworkResources ?? null;
  let layoutFiles = names.filter(name => /^res\/layout(?:-[^/]+)?\/[^/]+\.xml$/.test(name)).sort();
  const arsc = archive.entries.get('resources.arsc');
  const summary = { present: !!arsc, tableBytes: arsc?.size ?? 0, tableParsed: false, entries: 0,
    layoutFiles: layoutFiles.length, parsedLayouts: 0, skippedLayouts: layoutFiles.length,
    parsedLayoutBytes: 0, inspectionComplete: false, errors: [], omittedErrors: 0 };
  if (options.resources === false || (!arsc && !frameworkTable)) {
    if (options.resources === false && arsc) summary.errors.push('Resource parsing disabled by caller.');
    return { environment: null, summary };
  }
  const layouts = new Map(), layoutErrors = new Map();
  const note = message => {
    if (summary.errors.length < 128) summary.errors.push(message);
    else summary.omittedErrors++;
  };
  const callbacks = { onWarning: note, chooseConfiguration: options.resourceConfiguration?.chooseConfiguration,
    resolveExternal: id => ((Number(id) >>> 24) === 1 ? frameworkTable?.resolve(id) : null) };
  let table = new AndroidResources(null, callbacks);
  await report('resources', 0, layoutFiles.length + 1, 'resources.arsc', arsc ? 'Reading Android resource table' : 'Using supplied framework resource table');
  try {
    if (arsc) { table = new AndroidResources(await archive.extract('resources.arsc', 64 * 1024 * 1024), callbacks); summary.tableParsed = true; summary.entries = table.entries.size; }
    // Resource shrinkers/obfuscators may rename res/layout files to arbitrary ZIP
    // paths. The compiled resource type, not the filename, identifies layouts.
    const referenced = new Set(layoutFiles);
    for (const variants of table.entries.values()) for (const entry of variants) {
      if (entry.resourceType === 'layout' && entry.kind === 'string' && typeof entry.value === 'string') {
        if (archive.entries.has(entry.value)) referenced.add(entry.value);
        else note(`Layout resource ${entry.fullName} points to absent ${entry.value}`);
      }
    }
    layoutFiles = [...referenced].sort(); summary.layoutFiles = layoutFiles.length;
  } catch (error) { note(`resources.arsc: ${error.message}`); }
  await report('resources', 1, layoutFiles.length + 1, 'resources.arsc', 'Android resource table inspected');
  await yieldControl();
  for (let i = 0; i < layoutFiles.length; i++) {
    const path = layoutFiles[i], size = archive.entries.get(path).size;
    let reason = null;
    if (i >= 1024) reason = 'layout count exceeds 1024-file limit';
    else if (size > 1024 * 1024) reason = 'layout exceeds 1 MiB limit';
    else if (summary.parsedLayoutBytes + size > 16 * 1024 * 1024) reason = 'layout bytes exceed combined 16 MiB limit';
    if (!reason) {
      summary.parsedLayoutBytes += size;
      try { layouts.set(path, table.parseLayout(await archive.extract(path, 1024 * 1024))); }
      catch (error) { reason = error.message; }
    }
    if (reason) { layoutErrors.set(path, reason); note(`${path}: ${reason}`); }
    if (i % 8 === 7 || i === layoutFiles.length - 1) {
      await report('resources', i + 2, layoutFiles.length + 1, path, `Prepared ${layouts.size} XML layouts`);
      await yieldControl();
    }
  }
  summary.parsedLayouts = layouts.size; summary.skippedLayouts = layoutFiles.length - layouts.size;
  const xmlTrees = new Map(layouts), xmlErrors = new Map(layoutErrors), candidates = new Set(layoutFiles);
  const xmlTypes = new Set(['navigation', 'drawable', 'color', 'animator', 'anim', 'xml', 'menu', 'transition', 'font', 'mipmap']);
  const alwaysXML = new Set(['navigation', 'color', 'animator', 'anim', 'xml', 'menu', 'transition']);
  for (const variants of table.entries.values()) for (const entry of variants) {
    if (xmlTypes.has(entry.resourceType) && entry.kind === 'string' && typeof entry.value === 'string' &&
      (entry.value.endsWith('.xml') || alwaysXML.has(entry.resourceType)) && archive.entries.has(entry.value)) candidates.add(entry.value);
  }
  const xmlFiles = [...candidates].sort();
  summary.xml = { files: xmlFiles.length, parsed: xmlTrees.size, skipped: 0, bytes: summary.parsedLayoutBytes };
  for (let i = 0; i < xmlFiles.length; i++) {
    const path = xmlFiles[i]; if (xmlTrees.has(path) || xmlErrors.has(path)) continue;
    const size = archive.entries.get(path).size;
    let reason = i >= 4096 ? 'XML count exceeds 4096-file limit' : size > 1024 * 1024 ? 'XML exceeds 1 MiB limit' : summary.xml.bytes + size > 16 * 1024 * 1024 ? 'XML bytes exceed combined 16 MiB limit' : null;
    if (!reason) {
      summary.xml.bytes += size;
      try { xmlTrees.set(path, table.parseLayout(await archive.extract(path, 1024 * 1024))); }
      catch (error) { reason = error.message; }
    }
    if (reason) { xmlErrors.set(path, reason); note(`${path}: ${reason}`); }
    if (i % 16 === 15) { await report('resources-xml', i + 1, xmlFiles.length, path, `Prepared ${xmlTrees.size} compiled XML resources`); await yieldControl(); }
  }
  summary.xml.parsed = xmlTrees.size; summary.xml.skipped = xmlFiles.length - xmlTrees.size;
  summary.inspectionComplete = summary.tableParsed && !summary.skippedLayouts && !summary.errors.length;
  if (summary.errors.length) warnings.push(`Resource inspection: ${summary.errors.slice(0, 4).join('; ')}${summary.errors.length > 4 || summary.omittedErrors ? '; additional details in resourceSummary.errors' : ''}`);
  const resolveXML = (id, layoutOnly = false) => {
    const resource = table.resolve(id); let leaf = resource;
    while (leaf.resolved) leaf = leaf.resolved;
    const path = resource.value;
    if (resource.kind !== 'string' || typeof path !== 'string') throw new APKError(
      `XML resource 0x${(Number(id) >>> 0).toString(16)} cannot be resolved: ${resource.reason ?? resource.kind}`, { kind: 'resource-unsupported', resourceId: Number(id) >>> 0 });
    if (frameworkTable && leaf.sourceCookie === frameworkTable.sourceCookie && leaf.sourceCookie !== table.sourceCookie) {
      if (options.frameworkGetXml) return options.frameworkGetXml(leaf.id);
      throw new APKError(`Framework XML ${path} is not prepared in the framework resource dataset`, { kind: 'framework-xml-unavailable', resourceId: Number(id) >>> 0, path });
    }
    const trees = layoutOnly ? layouts : xmlTrees, errors = layoutOnly ? layoutErrors : xmlErrors;
    if (!trees.has(path)) throw new APKError(`${layoutOnly ? 'Layout' : 'XML'} ${path} is not prepared: ${errors.get(path) ?? 'not found in APK compiled XML resources'}`, { kind: 'resource-unsupported', resourceId: Number(id) >>> 0, path });
    const tree = trees.get(path); nameFrameworkAttributes(tree, id => frameworkTable?.entries?.get(id >>> 0)?.[0]?.name ?? null);
    return tree;
  };
  const environment = { table, layouts, xmlTrees, frameworkTable, frameworkXml: typeof options.frameworkGetXml === 'function',
    resolve: id => table.resolve(id),
    resolveBag: id => table.resolveBag(id),
    getAttribute: (node, name) => table.getAttribute(node, name),
    getLayout: id => resolveXML(id, true),
    getXml: id => resolveXML(id, false) };
  return { environment, summary };
}

/**
 * The APK's signer certificates (DER), as PackageManager reports them: APK Signature Scheme v3, else v2 (the "APK Sig Block 42"
 * right before the central directory), else the v1 JAR signature's PKCS#7 block. Signatures are not verified here (the lab installs
 * the file it was given); only the certificates are read. Returns [] for an unsigned APK.
 */
export function apkSigningCertificates(archive) {
  const b = archive.reader, cd = archive.centralDirectoryOffset;
  const ascii = (p, n) => String.fromCharCode(...b.slice(p, n));
  if (cd >= 32 && ascii(cd - 16, 16) === 'APK Sig Block 42') {
    const size = Number(b.u32(cd - 24)) + Number(b.u32(cd - 20)) * 2 ** 32, begin = cd - size - 8;
    if (begin >= 0 && Number(b.u32(begin)) + Number(b.u32(begin + 4)) * 2 ** 32 === size) {
      const pairs = new Map();
      for (let p = begin + 8; p < cd - 24;) { const length = Number(b.u32(p)) + Number(b.u32(p + 4)) * 2 ** 32; pairs.set(b.u32(p + 8), [p + 12, p + 8 + length]); p += 8 + length; }
      const sequence = (from, to) => { const items = []; for (let p = from; p < to;) { const n = b.u32(p); items.push([p + 4, p + 4 + n]); p += 4 + n; } return items; };
      for (const id of [0xf05368c0, 0x7109871a]) {           // v3, then v2
        const range = pairs.get(id); if (!range) continue;
        const [signersFrom] = range, signersLength = b.u32(signersFrom), certificates = [];
        for (const [signerFrom] of sequence(signersFrom + 4, signersFrom + 4 + signersLength)) {
          const signedLength = b.u32(signerFrom), signedFrom = signerFrom + 4;
          const digestsLength = b.u32(signedFrom), certsAt = signedFrom + 4 + digestsLength, certsLength = b.u32(certsAt);
          for (const [from, to] of sequence(certsAt + 4, certsAt + 4 + certsLength)) certificates.push(b.slice(from, to - from).slice());
          if (certsAt + 4 + certsLength > signedFrom + signedLength) throw new APKError('Malformed APK signing block');
        }
        if (certificates.length) return certificates;
      }
    }
  }
  const pkcs7 = [...archive.entries.keys()].find(name => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(name));
  if (!pkcs7) return [];
  // DER walk: ContentInfo SEQ { OID, [0] { SignedData SEQ { version, digestAlgorithms, contentInfo, [0] IMPLICIT certificates... } } }
  const der = archive.extractSync(pkcs7, 1024 * 1024), node = p => { let length = der[p + 1], header = 2; if (length & 0x80) { const n = length & 0x7f; length = 0; for (let i = 0; i < n; i++) length = length * 256 + der[p + 2 + i]; header = 2 + n; } return { tag: der[p], start: p, body: p + header, end: p + header + length }; };
  const children = parent => { const out = []; for (let p = parent.body; p < parent.end;) { const child = node(p); out.push(child); p = child.end; } return out; };
  const signedData = children(children(children(node(0))[1])[0]), certificateSet = signedData.find(child => child.tag === 0xa0);
  return certificateSet ? children(certificateSet).map(cert => der.slice(cert.start, cert.end)) : [];
}

/**
 * Local APK loading, with per-DEX indices preserved by DexProgram.
 * onProgress receives {phase,message,completed,total,filename?}; yieldControl can
 * supply a scheduler. Native metadata is always listed, ELF expansion is opt-in.
 */
/**
 * Compiled XML may carry framework attributes only by resource id (aapt2 resource optimisation drops the attribute-name string and the android namespace of attributes the
 * framework resource map identifies): the name and namespace Android resolves through the resource map are filled in once per tree, so android:id, android:layout_width... are
 * recognised wherever the tree is read (inflater, AttributeSet).
 */
const ANDROID_NAMESPACE = 'http://schemas.android.com/apk/res/android';
export function nameFrameworkAttributes(node, nameOf) {
  if (!node || node.attributeNamesFilled) return;
  Object.defineProperty(node, 'attributeNamesFilled', { value: true, enumerable: false });
  for (const attribute of node.attributes ?? []) {
    if (!attribute.name && attribute.resourceId && (attribute.resourceId >>> 24) === 1) { const name = nameOf(attribute.resourceId); if (name) { attribute.name = name; if (!attribute.namespace) attribute.namespace = ANDROID_NAMESPACE; } }
  }
  for (const child of node.children ?? []) nameFrameworkAttributes(child, nameOf);
}
export async function loadAPK(arrayBuffer, options = {}) {
  if (!(arrayBuffer instanceof ArrayBuffer) && !(arrayBuffer instanceof Uint8Array)) fail('loadAPK requires an APK ArrayBuffer');
  const archive = new APKArchive(arrayBuffer), names = [...archive.entries.keys()];
  if (!archive.entries.has('classes.dex')) fail('APK has no root classes.dex');
  // Same discovery as ART's DexFileLoader: classes.dex, then classes2.dex, classes3.dex, ... up to the first gap.
  const dexFiles = ['classes.dex'];
  for (let index = 2; archive.entries.has(`classes${index}.dex`); index++) {
    if (dexFiles.length >= MAX_DEX_FILES) fail(`APK exceeds ${MAX_DEX_FILES} root DEX files`);
    dexFiles.push(`classes${index}.dex`);
  }
  if (dexFiles.length > MAX_DEX_FILES) fail(`APK exceeds ${MAX_DEX_FILES} root DEX files`);
  let totalDexBytes = 0;
  for (const name of dexFiles) {
    const size = archive.entries.get(name).size;
    if (size > MAX_DEX) fail(`${name} exceeds 64 MiB DEX limit (${size} bytes)`);
    totalDexBytes += size;
    if (totalDexBytes > MAX_DEX_TOTAL) fail(`APK DEX files exceed the combined ${MAX_DEX_TOTAL / 1048576} MiB limit: parsing them needs about 5x that in browser memory`);
  }
  const report = async (phase, completed, total, filename, message) => {
    if (options.onProgress) await options.onProgress({ phase, completed, total, ...(filename ? { filename } : {}), message });
  };
  const yieldControl = options.yieldControl ?? (() => new Promise(resolve => setTimeout(resolve, 0)));
  const nativeLibraries = names.filter(name => name.endsWith('.so')).sort();
  const nativeLibraryDetails = nativeLibraries.map(path => {
    const entry = archive.entries.get(path), match = /^lib\/([^/]+)\/([^/]+)$/.exec(path);
    return { path, abi: match?.[1] ?? 'unclassified', basename: path.slice(path.lastIndexOf('/') + 1),
      bytes: entry.size, compressedBytes: entry.compressed, elfInspection: 'not-requested' };
  });
  const nativeByABI = Object.create(null);
  for (const library of nativeLibraryDetails) {
    const group = nativeByABI[library.abi] ??= { abi: library.abi, files: 0, bytes: 0, libraries: [] };
    group.files++; group.bytes += library.bytes; group.libraries.push(library.basename);
  }
  const nativeSummary = { files: nativeLibraries.length, uniqueLibraries: new Set(nativeLibraryDetails.map(l => l.basename)).size,
    abiCount: Object.keys(nativeByABI).length, bytes: nativeLibraryDetails.reduce((sum, l) => sum + l.bytes, 0),
    executableInBrowser: false, executionRequired: 'determined-at-use' };
  const unsupportedFeatures = [], warnings = [];
  const embeddedFrameworks = [], bundles = [];
  let manifest = { packageName: null, applicationName: null, activities: [], services: [], providers: [], receivers: [], launcherActivity: null };
  await report('manifest', 0, 1, 'AndroidManifest.xml', 'Reading Android manifest');
  if (archive.entries.has('AndroidManifest.xml')) {
    try { manifest = parseManifest(await archive.extract('AndroidManifest.xml', 2 * 1024 * 1024)); }
    catch (error) { warnings.push(`Manifest launcher detection unavailable: ${error.message}`); }
  } else warnings.push('AndroidManifest.xml is absent; choose an Activity or use the sole DEX Activity');
  await report('manifest', 1, 1, 'AndroidManifest.xml', 'Android manifest read');
  const files = [], dexSummaries = [];
  for (let i = 0; i < dexFiles.length; i++) {
    const filename = dexFiles[i];
    await report('dex', i, dexFiles.length, filename, `Reading ${filename}`);
    const data = await archive.extract(filename, MAX_DEX), dex = new DexFile(data, { filename, maxBytes: MAX_DEX });
    files.push({ filename, dex });
    dexSummaries.push({ filename, bytes: data.length, classes: dex.classes.size, methods: dex.methods.length,
      fields: dex.fields.length, strings: dex.strings.length });
    await report('dex', i + 1, dexFiles.length, filename, `Parsed ${filename}: ${dex.classes.size} classes`);
    await yieldControl();
  }
  let framework = null;
  const provider = options.frameworkProvider ?? (options.frameworkDex ? new FrameworkProvider({ bytes: options.frameworkDex,
    properties: options.frameworkProperties, metadata: options.frameworkMetadata, expectedSha256: options.frameworkSha256,
    nativeBindings: options.frameworkNativeBindings }) : null);
  if (provider) {
    framework = typeof provider === 'function' ? await provider({ onProgress: options.onProgress }) : await provider.load({ onProgress: options.onProgress });
    if (!framework?.files || !(framework.nativeBindings instanceof Map)) fail('Invalid framework provider result');
    await yieldControl();
  }
  const apkClasses=new Map();for(const file of files)for(const [name,definition]of file.dex.classes)apkClasses.set(name,definition);
  const appCompatActivity=manifest.activities.some(activity=>{
    let type=activity.name.startsWith('L')?activity.name:'L'+activity.name.replaceAll('.','/')+';',seen=new Set();
    while(type){if(type==='Landroidx/appcompat/app/AppCompatActivity;')return true;if(seen.has(type)||seen.size>=128)fail('Invalid/excessive Activity superclass chain');seen.add(type);type=apkClasses.get(type)?.superclass;}return false;
  });
  const usesWindowSurfaces=files.some(file=>file.dex.types.some(type=>['Landroid/app/Dialog;','Landroid/view/WindowManager;'].includes(type)));
  const usesConfiguration=files.some(file=>file.dex.types.includes('Landroid/content/res/Configuration;'));
  const baseFrameworkFiles = framework ? [...framework.files] : []; let verifiedBaseFrameworkHash = null;
  const profiles=[
    {name:'layouts',explicit:options.enableLayoutProfile,automatic:appCompatActivity||usesWindowSurfaces,reason:appCompatActivity?'manifest-Activity-inherits-AppCompatActivity':'APK-references-Dialog-or-WindowManager'},
    {name:'configuration',explicit:options.enableConfigurationProfile,automatic:usesConfiguration,reason:'APK-references-android.content.res.Configuration'},
  ];
  for(const selection of profiles){
    const requested=selection.explicit===true||(selection.explicit!==false&&selection.automatic);if(!requested)continue;
    const source=options.frameworkProfileProviders?.[selection.name];
    if(!source){if(selection.explicit===true)fail(`Source ${selection.name} profile was explicitly requested but no provider was supplied`);continue;}
    if(!framework)fail('A source framework profile requires a base framework provider');
    const profile=typeof source==='function'?await source({onProgress:options.onProgress}):await source.load({onProgress:options.onProgress});
    if(!profile?.files||!(profile.nativeBindings instanceof Map))fail(`Invalid source ${selection.name} profile provider result`);
    const requiredBaseHash = profile.metadata?.requiresDefaultFrameworkSha256;
    if (requiredBaseHash !== undefined) {
      if (typeof requiredBaseHash !== 'string' || !/^[0-9a-f]{64}$/i.test(requiredBaseHash)) fail(`Source ${selection.name} profile declares an invalid base framework SHA-256`);
      verifiedBaseFrameworkHash ??= await frameworkBytesHash(baseFrameworkFiles);
      if (requiredBaseHash.toLowerCase() !== verifiedBaseFrameworkHash) fail(`Source ${selection.name} profile requires base framework SHA-256 ${requiredBaseHash}; actual DEX bytes are ${verifiedBaseFrameworkHash}`);
    }
    const bindings=new Map(framework.nativeBindings);for(const [key,binding]of profile.nativeBindings)if(!bindings.has(key))bindings.set(key,binding);
    framework={...framework,files:[...framework.files,...profile.files],nativeBindings:bindings,metadata:{...framework.metadata,
      baseClasses:framework.metadata.baseClasses??framework.metadata.classes,baseBytes:framework.metadata.baseBytes??framework.metadata.bytes,baseSha256:framework.metadata.baseSha256??framework.metadata.sha256,nativeBoundaries:[...bindings.keys()],
      methods:(framework.metadata.methods??0)+(profile.metadata?.methods??0),profiles:[...(framework.metadata.profiles??[]),{...profile.metadata,name:selection.name,reason:selection.explicit===true?'explicitly-requested':selection.reason,tracePaths:profile.files.map(file=>file.filename)}]}};
    await yieldControl();
  }
  const program = new DexProgram(files, { bootFiles: framework?.files ?? [] });
  const transformFields = ['TranslationX', 'TranslationY', 'ScaleX', 'ScaleY', 'Rotation', 'PivotX', 'PivotY', 'X', 'Y'];
  const transformSignatures = new Set(['getMatrix()Landroid/graphics/Matrix;', 'getInverseMatrix()Landroid/graphics/Matrix;',
    'hasIdentityMatrix()Z', 'isPivotSet()Z', 'resetPivot()V', ...transformFields.flatMap(field => [`get${field}()F`, `set${field}(F)V`])]);
  const viewOwner = owner => {
    const seen = new Set();
    while (owner && !seen.has(owner) && seen.size < 128) {
      if (owner === 'Landroid/view/View;') return true;
      seen.add(owner); const definition = program.resolvedClasses.get(owner);
      if (!definition && /^Landroid\/(?:view\/(?:ViewGroup|ViewStub|SurfaceView|TextureView)|webkit\/WebView|widget\/[^;$]+);$/.test(owner)) return true;
      owner = definition?.superclass;
    }
    return false;
  };
  // Only APK method references participate. The boot layer contains Matrix for
  // every app, and would otherwise turn this lazy backend into an eager load.
  const usesViewTransforms = program.methods.some(method => transformSignatures.has(method.name + method.signature) && viewOwner(method.owner));
  const needsSkia=program.types.some(type=>/^Landroid\/graphics\//.test(type)||type==='Landroid/view/View$MeasureSpec;')||
    usesViewTransforms || program.methods.some(method=>method.name==='onMeasure'&&method.signature==='(II)V')&&program.types.some(type=>['Landroid/widget/TextView;','Landroid/widget/Button;'].includes(type));
  let skia=options.skiaBackend??null;
  if(!skia&&options.skiaProvider&&(needsSkia||options.forceSkia===true)){const source=options.skiaProvider;skia=typeof source==='function'?await source({onProgress:options.onProgress}):await source.load({onProgress:options.onProgress});}
  if(skia&&(typeof skia.createHost!=='function'||typeof skia.rasterizeCanvas!=='function'))fail('Invalid official Skia provider result');
  let frameworkResources = null;
  if (options.frameworkResourceProvider) {
    const source = options.frameworkResourceProvider;
    frameworkResources = typeof source === 'function' ? await source({ onProgress: options.onProgress }) : await source.load({ onProgress: options.onProgress });
  } else if (options.frameworkResources) frameworkResources = options.frameworkResources.table
    ? options.frameworkResources : { table: options.frameworkResources, metadata: options.frameworkResourceMetadata ?? {} };
  if (frameworkResources && (typeof frameworkResources.table?.resolve !== 'function' || typeof frameworkResources.table?.resolveBag !== 'function')) fail('Invalid framework resource provider result');
  let resourceConfiguration=options.resourceConfiguration??null;
  if(options.resourceConfigProvider){const source=options.resourceConfigProvider;resourceConfiguration=typeof source==='function'?await source({onProgress:options.onProgress}):await source.load({onProgress:options.onProgress});}
  if(resourceConfiguration&&typeof resourceConfiguration.chooseConfiguration!=='function')fail('Invalid original resource configuration provider result');
  if(resourceConfiguration?.reconfigure&&options.device){const device=resolveDevice(options.device);resourceConfiguration.reconfigure(resourceProfileFor(device,{left:0,right:0,top:device.statusBarHeightDp??24,bottom:device.navigation==='buttons'?48:24}));}
  if(resourceConfiguration&&frameworkResources)frameworkResources.table.options.chooseConfiguration=resourceConfiguration.chooseConfiguration;
  const resources = await prepareResources(archive, names, { ...options, frameworkResources: frameworkResources?.table,
    frameworkGetXml: frameworkResources?.getXml,resourceConfiguration }, report, yieldControl, warnings);
  let icuBreakBackend=options.icuBreakBackend??null;
  if(!icuBreakBackend&&options.icuBreakProvider&&program.types.some(type=>['Ljava/text/BreakIterator;','Landroid/icu/text/BreakIterator;','Ljava/util/regex/Pattern;','Ljava/util/regex/Matcher;'].includes(type)||type.startsWith('Landroid/database/')||type.startsWith('Ljava/time/')||type.startsWith('Ljava/math/'))){ // android.database.sqlite's own SQLiteDatabaseConfiguration compiles a java.util.regex.Pattern
    const provider=options.icuBreakProvider;icuBreakBackend=typeof provider==='function'?await provider():await provider.load();
    if(typeof icuBreakBackend?.breaks!=='function')fail('Invalid original ICU break-analysis provider');
  }
  // Android 13 SQLite (Wasm) for the framework's SQLiteConnection/CursorWindow natives; loaded only when the app references android.database.*.
  let sqliteBackend=options.sqliteBackend??null;
  if(!sqliteBackend&&options.sqliteProvider&&program.types.some(type=>type.startsWith('Landroid/database/'))){
    const provider=options.sqliteProvider;sqliteBackend=typeof provider==='function'?await provider():await provider.load();
    if(!sqliteBackend?.module)fail('Invalid Android SQLite provider');
  }
  // SQLCipher: System.loadLibrary("sqlcipher") is served by the lab wasm32 module that matches the artifact/version the APK's own DEX ships, or fails with an
  // UnsatisfiedLinkError that names the artifact and version still to be built (src/sqlcipher-native.js). Nothing is ever taken from the APK's native libraries.
  let nativeLibraryProvider=options.nativeLibraryProvider??null;
  if(options.sqlcipherProvider){
    const sqlcipher=await options.sqlcipherProvider.prepare(program, { base: nativeLibraryProvider });
    if(sqlcipher){nativeLibraryProvider=await nativeProviderWithSqlcipher(nativeLibraryProvider,sqlcipher);warnings.push(...sqlcipher.notes);}
  }
  // Conscrypt's native layer (libjavacrypto/libssl/libcrypto, built from AOSP's own sources) belongs to the platform: every app's JNI bridge can link it; the bytes are fetched only when a class loads the library.
  {const javacrypto=options.javacryptoProvider??getDefaultJavacryptoProvider();if(javacrypto)nativeLibraryProvider=javacrypto.compose(nativeLibraryProvider);}
  // IANA tz database (AOSP tzdata2022a compiled to java.time ZoneRules) for the original java.time sources; loaded when the app can reach java.time.
  let tzdata=options.tzdata??null;
  if(!tzdata&&options.tzdataProvider&&program.types.some(type=>type.startsWith('Ljava/time/')||['Ljava/util/Date;','Ljava/util/TimeZone;','Ljava/util/GregorianCalendar;'].includes(type))){
    const provider=options.tzdataProvider;tzdata=typeof provider==='function'?await provider():await provider.load();
    if(!tzdata?.bytes)fail('Invalid tz database provider');
  }
  // zlib + zip_util (Wasm) for the original java.util.zip classes; loaded when the app can reach them.
  let zlibBackend=options.zlibBackend??null;
  if(!zlibBackend&&options.zlibProvider&&program.types.some(type=>type.startsWith('Ljava/util/zip/')||type.startsWith('Ljava/util/jar/'))){
    const provider=options.zlibProvider;zlibBackend=typeof provider==='function'?await provider():await provider.load();
    if(!zlibBackend?.module)fail('Invalid zlib provider');
  }
  // ICU4C converters (Wasm) behind the original java.nio.charset coders (CharsetDecoderICU/EncoderICU); needed by anything that encodes/decodes through a Charset object.
  let icuConverterBackend=options.icuConverterBackend??null;
  if(!icuConverterBackend&&options.icuConverterProvider&&program.types.some(type=>type.startsWith('Ljava/nio/charset/')||type.startsWith('Ljava/util/zip/')||/^Ljava\/io\/(InputStreamReader|OutputStreamWriter|PrintStream|PrintWriter|FileReader|FileWriter|LineNumberReader|StreamTokenizer);/.test(type))){
    const provider=options.icuConverterProvider;icuConverterBackend=typeof provider==='function'?await provider():await provider.load();
    if(!icuConverterBackend?.module)fail('Invalid ICU converter provider');
  }
  // PackageManagerService: an APK that needs a newer platform than the device's SDK_INT cannot be installed.
  const deviceSdk = options.apiLevel ?? 33, minSdk = Number(manifest.usesSdk?.minSdkVersion ?? 1);
  if (Number.isFinite(minSdk) && minSdk > deviceSdk) throw new APKError(`INSTALL_FAILED_OLDER_SDK: Requires newer sdk version #${minSdk} (current version is #${deviceSdk})`, { kind: 'install-failed-older-sdk', minSdkVersion: minSdk, deviceSdk });
  const runtime = new APKRuntime(program, { apkEntries: new Set(names), apkReader: name => archive.extractSync(name, 256 * 1024 * 1024), launcherActivity: manifest.launcherActivity, unsupportedFeatures,
    maxInstructionsPerEvent: options.maxInstructionsPerEvent,
    maxCallDepth: options.maxCallDepth,
    maxHeapObjects: options.maxHeapObjects, apiLevel: deviceSdk, tolerateMissingVoid: !!options.tolerateMissingVoid, tolerateMissing: options.tolerateMissing ?? (options.tolerateMissingVoid ? 'void' : 'off'),
    icuBreakBackend,sqliteBackend,tzdata,zlibBackend,icuConverterBackend,
    nativeLibraries: nativeLibraryDetails, resources: resources.environment, nativeBindings: framework?.nativeBindings, skia,
    platform: new AndroidPlatform({ device: options.device, resources: resources.environment,
      applicationName: manifest.applicationName, packageName: manifest.packageName, manifest, apkBytes: arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer) }) });
  // Canvas raster cache (src/skia-canvas-host.js): on by default; `rasterCache: false` switches it off for A/B comparison, `rasterCacheVerify: true` re-rasters every hit and fails on a difference.
  runtime.rasterCacheDisabled = options.rasterCache === false; runtime.rasterCacheVerify = options.rasterCacheVerify === true;
  runtime.platform.resourceSelector = resourceConfiguration ?? null; // live device changes re-select resources through the same original ResTable_config matcher
  if (nativeLibraryProvider && [...nativeLibraryProvider.modules.values()].some(entry => entry.apkSha256)) {
    // libraries scoped to one APK (its own generated native code) are offered only to that APK: compared by the SHA-256 of the file
    runtime.apkSha256 = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer)))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  if (nativeLibraryProvider) {   // open-source androidx libraries are served by artifact version: META-INF/androidx.<group>_<artifact>.version holds just the version string
    runtime.androidxVersions = Object.create(null);
    for (const name of archive.entries.keys()) {
      const m = /^META-INF\/(androidx\.[\w.-]+?)\.version$/.exec(name); if (!m) continue;
      try { const text = new TextDecoder().decode(archive.extractSync(name, 256)).trim(); if (/^[\w.+-]{1,40}$/.test(text)) runtime.androidxVersions[m[1]] = text; } catch { /* unreadable entry: that artifact stays unidentified */ }
    }
  }
  if (nativeLibraryProvider) { // the lab's React Native libraries are built for one RN version: record the app's (from its DEX) and Hermes bytecode version (from its bundle) for the provider's gate
    runtime.reactNativeVersion = detectReactNativeVersion(runtime); runtime.hermesBytecodeVersion = await detectHermesBytecodeVersion(archive);
  }
  if (nativeLibraryProvider) runtime.jni = new JniBridge(runtime, nativeLibraryProvider, runtime.platform);
  if (!manifest.activities.length) manifest.activities = runtime.activities().map(type => ({ name: dottedName(type), descriptor: type, launcher: false }));
  const kotlin = program.types.some(t => t.startsWith('Lkotlin/'));
  const compose = program.types.some(t => t.startsWith('Landroidx/compose/') || t.startsWith('Lorg/jetbrains/compose/'));
  if (compose) warnings.push('Compose references detected. Actual execution still depends on the Android/Compose APIs reached by DEX; source-compiled Compose Web is separate.');
  if (kotlin) warnings.push('Kotlin bytecode is preserved. Packaged library methods execute through DEX when their instructions are supported.');
  if (nativeLibraries.length) warnings.push(`${nativeSummary.files} native files (${nativeSummary.uniqueLibraries} library names, ${nativeSummary.abiCount} ABIs) are packaged. Their presence does not block DEX; required JNI/ELF execution fails specifically when reached.`);
  if (program.types.some(t => t.startsWith('Lcom/facebook/react/')) || nativeLibraryDetails.some(l => /reactnative|react_native|react_nativemodule/.test(l.basename))) embeddedFrameworks.push('React Native');
  if (nativeLibraryDetails.some(l => /hermes/i.test(l.basename))) embeddedFrameworks.push('Hermes');
  if (archive.entries.has('assets/index.android.bundle')) {
    const path = 'assets/index.android.bundle', entry = archive.entries.get(path);
    const bundle = { path, bytes: entry.size, format: 'unknown', headerOnly: true, executed: false };
    try {
      const header = await archive.extractPrefix(path, 16);
      if (header.length >= 12 && new DataView(header.buffer, header.byteOffset, header.byteLength).getBigUint64(0, true) === 0x1f1903c103bc1fc6n) {
        bundle.format = 'Hermes bytecode'; bundle.bytecodeVersion = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(8, true);
        if (!embeddedFrameworks.includes('Hermes')) embeddedFrameworks.push('Hermes');
        if (!embeddedFrameworks.includes('React Native')) embeddedFrameworks.push('React Native');
      }
    } catch (error) { bundle.inspectionError = error.message; }
    bundles.push(bundle);
  }
  const dependencyOwners = [...new Set(program.methods.map(m => m.owner).filter(t => !program.classes.has(t)))];
  const inventory = { ...manifest, classes: program.classes.size, classNames: [...program.classes.keys()].map(dottedName),
    framework: framework ? { ...framework.metadata, ...program.frameworkSummary } : { enabled: false, classes: 0, dexFiles: [], policy: 'no-boot-layer' },
    frameworkResources: frameworkResources ? { ...frameworkResources.metadata, enabled: true, entries: frameworkResources.table.entries?.size ?? null, packages: frameworkResources.table.packages } : { enabled: false, entries: 0 },
    resourceConfiguration: resourceConfiguration ? {...resourceConfiguration.metadata,enabled:true,stats:resourceConfiguration.stats?.()??null} : {enabled:false},
    skia:skia?{...skia.metadata,enabled:true}:{enabled:false,reason:needsSkia?'provider-not-supplied':'no-APK-graphics-references'},
    methods: program.methods.length, strings: program.strings.length, inspectionComplete: true,
    dexFiles, dexSummaries, totalDexBytes, nativeLibraries, nativeLibraryDetails, nativeByABI, nativeSummary,
    resourceSummary: resources.summary,
    kotlin, compose, embeddedFrameworks, bundles, dependencies: dependencyOwners.map(dottedName),
    unsupportedFeatures, warnings, nativeInspection: { requested: false, inspected: 0, skipped: nativeLibraries.length, bytes: 0 } };

  /** Lazy ELF metadata inspection. Accept exact archive paths; never resolves or calls JNI. */
  const inspectNativeLibraries = async (paths = nativeLibraries, limits = {}) => {
    const requested = typeof paths === 'string' ? [paths] : paths;
    if (!Array.isArray(requested) || requested.some(p => typeof p !== 'string' || !nativeLibraries.includes(p))) fail('Native inspection requires existing .so archive paths');
    const selected = [...new Set(requested)];
    const limit = (name, fallback, maximum) => {
      const value = limits[name] ?? fallback;
      if (!Number.isSafeInteger(value) || value < 0) fail('Native inspection limits must be nonnegative safe integers');
      return Math.min(value, maximum);
    };
    const maxFiles = limit('maxFiles', 32, 128);
    const maxBytes = limit('maxBytes', 32 * 1024 * 1024, 64 * 1024 * 1024);
    const maxTotalBytes = limit('maxTotalBytes', 64 * 1024 * 1024, 128 * 1024 * 1024);
    let count = 0, total = 0;
    for (const library of nativeLibraryDetails.filter(l => selected.includes(l.path))) {
      if (count >= maxFiles || library.bytes > maxBytes || total + library.bytes > maxTotalBytes) {
        library.elfInspection = 'skipped-limit'; continue;
      }
      await report('native', count, Math.min(selected.length, maxFiles), library.path, `Inspecting ELF metadata: ${library.path}`);
      count++; total += library.bytes;
      try { library.elf = inspectELF(await archive.extract(library.path, maxBytes), { ...limits, maxBytes }); library.elfInspection = 'complete'; }
      catch (error) { library.elfInspection = 'error'; library.elfError = error.message; }
      await yieldControl();
    }
    inventory.nativeInspection = { requested: true, inspected: count, skipped: selected.length - count, bytes: total };
    await report('native', count, Math.min(selected.length, maxFiles), undefined, 'ELF metadata inspection finished');
    return nativeLibraryDetails.filter(l => selected.includes(l.path));
  };
  if (options.inspectNative) await inspectNativeLibraries(options.inspectNative === true ? nativeLibraries : options.inspectNative, options.nativeInspectionLimits);
  await report('complete', dexFiles.length, dexFiles.length, undefined, `Loaded ${dexFiles.length} DEX files and ${program.classes.size} classes`);
  let signingCertificates;   // read on first PackageManager request: the APK's signer certificates
  runtime.apkSigningCertificates = () => signingCertificates ??= apkSigningCertificates(archive);
  return { runtime, inventory, inspectNativeLibraries, archive };
}
