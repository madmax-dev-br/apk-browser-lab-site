// The prepared file of an APK (.apklab): made once from the APK, opened in its place so loading skips the work every APK load repeats. It is a ZIP whose
// entries are all STORED (no compression): `apklab.json` (what it was made from) and every entry of the APK under `apk/`, byte for byte as the APK's own
// decompressed content. Nothing of the app is changed: the same DEX, resources, assets and native libraries, only already decompressed and already
// checked (each entry's CRC-32 was verified against the APK when the file was made, so loading does not compute it again). The loader
// (src/apk-loader.js APKArchive) recognises the layout by itself, so the page, the embedded player and the backends accept it like an APK.
// DOM-free; no process.*.
import { APKArchive } from './apk-loader.js?v=fe7b63165e52';

export const PREPARED_FORMAT = 'apk-web-lab-prepared', PREPARED_VERSION = 1, PREPARED_PREFIX = 'apk/', PREPARED_DESCRIPTOR = 'apklab.json';
export const PREPARED_EXTENSION = '.apklab';
const MAX_PREPARED_BYTES = 0xfffffffe;   // ZIP32: every size and offset must fit 32 bits

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (let i = 0, n = bytes.length; i < n; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** The file name of the prepared file of `apkName` ('app.apk' -> 'app.apklab'). */
export const preparedName = apkName => `${String(apkName || 'app').replace(/\.(apk|apklab)$/i, '')}${PREPARED_EXTENSION}`;

/** A STORED ZIP of [{ name, bytes, crc }] (local headers, data, central directory, end record). */
function writeStoredZip(files) {
  const encoder = new TextEncoder(), names = files.map(file => encoder.encode(file.name));
  let size = 22; for (let i = 0; i < files.length; i++) size += 30 + names[i].length + files[i].bytes.length + 46 + names[i].length;
  if (size > MAX_PREPARED_BYTES || files.length > 65535) throw new Error('O arquivo preparado passaria de 4 GiB ou de 65535 entradas (limite do formato ZIP).');
  const out = new Uint8Array(size), view = new DataView(out.buffer), offsets = []; let p = 0;
  const u16 = value => { view.setUint16(p, value, true); p += 2; }, u32 = value => { view.setUint32(p, value >>> 0, true); p += 4; };
  for (let i = 0; i < files.length; i++) {
    const { bytes, crc } = files[i]; offsets.push(p);
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(0); u16(0x21); u32(crc); u32(bytes.length); u32(bytes.length); u16(names[i].length); u16(0);   // UTF-8 names, STORED, a fixed DOS date
    out.set(names[i], p); p += names[i].length; out.set(bytes, p); p += bytes.length;
  }
  const directory = p;
  for (let i = 0; i < files.length; i++) {
    const { bytes, crc } = files[i];
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(0); u16(0x21); u32(crc); u32(bytes.length); u32(bytes.length); u16(names[i].length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(offsets[i]);
    out.set(names[i], p); p += names[i].length;
  }
  const directorySize = p - directory;
  u32(0x06054b50); u16(0); u16(0); u16(files.length); u16(files.length); u32(directorySize); u32(directory); u16(0);
  return out;
}

/**
 * Makes the prepared file of an APK. apkBytes: the APK (ArrayBuffer or Uint8Array). info: { name, packageName, runtimeRevision } for the descriptor.
 * Returns { bytes: Uint8Array, descriptor }. Every APK entry is decompressed and its CRC-32 checked against the APK (a damaged APK is refused here).
 */
export async function buildPreparedFile(apkBytes, { name = null, packageName = null, runtimeRevision = null, now = () => new Date() } = {}, onProgress = null) {
  const bytes = apkBytes instanceof Uint8Array ? apkBytes : new Uint8Array(apkBytes);
  const archive = new APKArchive(bytes);
  if (archive.prepared) throw new Error('Este arquivo já é um arquivo preparado (.apklab).');
  if (!archive.entries.has('classes.dex')) throw new Error('Não é um APK com código (sem classes.dex).');
  const names = [...archive.entries.keys()].filter(entry => !entry.endsWith('/')), files = [];
  for (let i = 0; i < names.length; i++) {
    const data = await archive.extract(names[i], 1024 * 1024 * 1024);   // decompresses and checks size and CRC-32 against the APK's own record
    files.push({ name: PREPARED_PREFIX + names[i], bytes: data, crc: archive.entries.get(names[i]).crc });
    if (onProgress && (i % 64 === 0 || i === names.length - 1)) await onProgress({ completed: i + 1, total: names.length, filename: names[i] });
  }
  const descriptor = { format: PREPARED_FORMAT, version: PREPARED_VERSION, source: { name, bytes: bytes.length, sha256: await sha256Hex(bytes), packageName }, entries: names.length,
    uncompressedBytes: files.reduce((sum, file) => sum + file.bytes.length, 0), createdAt: now().toISOString(), runtimeRevision, crcVerified: true };
  const json = new TextEncoder().encode(JSON.stringify(descriptor, null, 2));
  return { bytes: writeStoredZip([{ name: PREPARED_DESCRIPTOR, bytes: json, crc: crc32(json) }, ...files]), descriptor };
}
