// An Android App Bundle (.aab) as the APK the device would run: what bundletool's universal APK holds (build-apks --mode=universal), built in the page. The bundle keeps its
// base module under base/ and its compiled XML and resource table in aapt2's protobuf format (Resources.proto and Configuration.proto of aapt2, package aapt.pb, whose field
// numbers are read below); an APK keeps them in the binary formats the platform reads (ResXMLTree, ResTable). So: base/manifest/AndroidManifest.xml and every PROTO_XML file
// the table names become binary XML, base/resources.pb becomes resources.arsc, and base/dex, base/res, base/assets, base/lib and base/root move to the APK's root.
// Only the base module is taken: other modules (feature modules, asset packs) are listed in `notes`, never merged silently. No signature is made: the bundle's own signature
// files (META-INF, the upload key's) are kept as they are. No process.*.
import { APKArchive } from './apk-archive.js?v=e3ff4f2e305f';

const fail = message => { throw Object.assign(new Error(message), { kind: 'aab-unsupported' }); };
const MAX_ENTRY = 256 * 1024 * 1024;

/** Whether the ZIP entries are those of an App Bundle (BundleConfig.pb, or a base module manifest with no root classes.dex). */
export const isAppBundle = names => !names.includes('classes.dex') && (names.includes('BundleConfig.pb') || names.includes('base/manifest/AndroidManifest.xml'));

// ---- protobuf wire format: fields as { number -> [values] } (varint as a Number of its low 32 bits, fixed32 as its 4 bytes, length-delimited as the bytes)
function fields(bytes) {
  const out = new Map(); let at = 0;
  const varint = () => { let low = 0, shift = 0, byte; do { if (at >= bytes.length) fail('Truncated protobuf varint'); byte = bytes[at++]; if (shift < 32) low |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80); return low >>> 0; };
  while (at < bytes.length) {
    const key = varint(), number = key >>> 3, wire = key & 7; let value;
    if (wire === 0) value = varint();
    else if (wire === 2) { const length = varint(); if (at + length > bytes.length) fail('Truncated protobuf field'); value = bytes.subarray(at, at + length); at += length; }
    else if (wire === 5) { value = bytes.subarray(at, at + 4); at += 4; }
    else if (wire === 1) { value = bytes.subarray(at, at + 8); at += 8; }
    else fail(`Unsupported protobuf wire type ${wire}`);
    if (!out.has(number)) out.set(number, []); out.get(number).push(value);
  }
  return out;
}
const decoder = new TextDecoder();
const msg = (f, n) => f.get(n)?.at(-1) ? fields(f.get(n).at(-1)) : null;
const msgs = (f, n) => (f.get(n) ?? []).map(fields);
const str = (f, n) => f.get(n) ? decoder.decode(f.get(n).at(-1)) : '';
const u32 = (f, n) => f.get(n) ? f.get(n).at(-1) >>> 0 : 0;
const has = (f, n) => f.has(n);
const fixed = (f, n) => { const b = f.get(n)?.at(-1); return b ? (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0 : 0; };

// ---- binary writer
class Out {
  constructor() { this.bytes = new Uint8Array(1024); this.length = 0; }
  room(n) { if (this.length + n > this.bytes.length) { let size = this.bytes.length * 2; while (size < this.length + n) size *= 2; const next = new Uint8Array(size); next.set(this.bytes.subarray(0, this.length)); this.bytes = next; } }
  u8(v) { this.room(1); this.bytes[this.length++] = v & 0xff; return this; }
  u16(v) { this.room(2); this.bytes[this.length++] = v & 0xff; this.bytes[this.length++] = (v >>> 8) & 0xff; return this; }
  u32(v) { this.room(4); for (let i = 0; i < 4; i++) this.bytes[this.length++] = (v >>> (8 * i)) & 0xff; return this; }
  put(b) { this.room(b.length); this.bytes.set(b, this.length); this.length += b.length; return this; }
  pad4() { while (this.length % 4) this.u8(0); return this; }
  set32(at, v) { for (let i = 0; i < 4; i++) this.bytes[at + i] = (v >>> (8 * i)) & 0xff; }
  done() { return this.bytes.slice(0, this.length); }
}

// ---- ResStringPool (UTF-16): styled strings first, as styles are indexed like their strings
class StringPool {
  constructor() { this.list = []; this.index = new Map(); this.styles = []; }
  add(text, spans = null) {
    text = String(text);
    if (spans?.length) { const i = this.list.length; this.list.push(text); this.styles[i] = spans; return i; }   // a styled string is its own entry
    const key = text; if (this.index.has(key)) return this.index.get(key); const i = this.list.length; this.list.push(text); this.index.set(key, i); return i;
  }
  /** Moves the styled strings to the front; returns the old -> new index map. */
  order() {
    const styled = [], plain = []; this.list.forEach((_, i) => (this.styles[i] ? styled : plain).push(i));
    const map = new Map([...styled, ...plain].map((old, i) => [old, i]));
    this.list = [...styled, ...plain].map(i => this.list[i]); this.styles = styled.map(i => this.styles[i]); return map;
  }
  write(out, map = null) {
    const start = out.length, n = this.list.length, styles = this.styles.filter(Boolean).length;
    out.u16(0x0001).u16(28).u32(0).u32(n).u32(styles).u32(0).u32(0).u32(0);
    const offsets = out.length; for (let i = 0; i < n + styles; i++) out.u32(0);
    const stringsStart = out.length - start; let at = 0;
    for (let i = 0; i < n; i++) {
      out.set32(offsets + i * 4, at); const text = this.list[i], units = text.length;
      if (units > 0x7fff) { out.u16(0x8000 | (units >>> 16)).u16(units & 0xffff); at += 4; } else { out.u16(units); at += 2; }
      for (let j = 0; j < units; j++) out.u16(text.charCodeAt(j)); out.u16(0); at += units * 2 + 2;
    }
    out.pad4();
    let stylesStart = 0;
    if (styles) {
      stylesStart = out.length - start; let sat = 0;
      for (let i = 0; i < styles; i++) {
        out.set32(offsets + (n + i) * 4, sat);
        for (const span of this.styles[i]) { out.u32(map ? span.name : span.name).u32(span.first).u32(span.last); sat += 12; }
        out.u32(0xffffffff); sat += 4;
      }
      out.u32(0xffffffff).u32(0xffffffff);
    }
    out.set32(start + 4, out.length - start); out.set32(start + 20, stringsStart); out.set32(start + 24, stylesStart);
  }
}

// ---- values: an aapt.pb.Item as a Res_value { dataType, data }
const TYPE = { NULL: 0, REFERENCE: 1, ATTRIBUTE: 2, STRING: 3, FLOAT: 4, DIMENSION: 5, FRACTION: 6, DYNAMIC_REFERENCE: 7, DYNAMIC_ATTRIBUTE: 8, INT_DEC: 0x10, INT_HEX: 0x11, INT_BOOLEAN: 0x12, ARGB8: 0x1c, RGB8: 0x1d, ARGB4: 0x1e, RGB4: 0x1f };
function itemValue(item, pool, spansOf) {
  if (has(item, 1)) { const ref = msg(item, 1), attribute = u32(ref, 1) === 1, dynamic = msg(ref, 5) && u32(msg(ref, 5), 1) === 1; return { type: dynamic ? (attribute ? TYPE.DYNAMIC_ATTRIBUTE : TYPE.DYNAMIC_REFERENCE) : attribute ? TYPE.ATTRIBUTE : TYPE.REFERENCE, data: u32(ref, 2) }; }
  if (has(item, 2)) return { type: TYPE.STRING, data: pool.add(str(msg(item, 2), 1)) };
  if (has(item, 3)) return { type: TYPE.STRING, data: pool.add(str(msg(item, 3), 1)) };
  if (has(item, 4)) { const styled = msg(item, 4); return { type: TYPE.STRING, data: pool.add(str(styled, 1), spansOf(msgs(styled, 2))) }; }
  if (has(item, 5)) return { type: TYPE.STRING, data: pool.add(str(msg(item, 5), 1)) };
  if (has(item, 6)) return { type: TYPE.INT_BOOLEAN, data: 0 };   // an id: aapt2 flattens it as a false boolean
  if (has(item, 7)) {
    const p = msg(item, 7);
    if (has(p, 1)) return { type: TYPE.NULL, data: 0 };   // DATA_NULL_UNDEFINED
    if (has(p, 2)) return { type: TYPE.NULL, data: 1 };   // DATA_NULL_EMPTY
    if (has(p, 3)) return { type: TYPE.FLOAT, data: fixed(p, 3) };
    if (has(p, 13)) return { type: TYPE.DIMENSION, data: u32(p, 13) };
    if (has(p, 14)) return { type: TYPE.FRACTION, data: u32(p, 14) };
    if (has(p, 6)) return { type: TYPE.INT_DEC, data: u32(p, 6) };
    if (has(p, 7)) return { type: TYPE.INT_HEX, data: u32(p, 7) };
    if (has(p, 8)) return { type: TYPE.INT_BOOLEAN, data: u32(p, 8) ? 0xffffffff : 0 };
    if (has(p, 9)) return { type: TYPE.ARGB8, data: u32(p, 9) };
    if (has(p, 10)) return { type: TYPE.RGB8, data: u32(p, 10) };
    if (has(p, 11)) return { type: TYPE.ARGB4, data: u32(p, 11) };
    if (has(p, 12)) return { type: TYPE.RGB4, data: u32(p, 12) };
    if (has(p, 4) || has(p, 5)) fail('A resource value uses the deprecated float dimension/fraction encoding of aapt2\'s format, which this conversion does not read');
    return { type: TYPE.NULL, data: 0 };
  }
  return { type: TYPE.NULL, data: 0 };
}

// ---- ResTable_config (64 bytes) from an aapt.pb.Configuration
function packLocale(text, base) {
  if (!text) return [0, 0];
  if (text.length === 2) return [text.charCodeAt(0), text.charCodeAt(1)];
  const c = [...text].map(ch => (ch.charCodeAt(0) - base.charCodeAt(0)) & 0x7f);
  return [((c[1] << 5) | c[0]) & 0xff, (0x80 | (c[2] << 2) | (c[1] >> 3)) & 0xff];
}
function encodeConfig(config) {
  const b = new Uint8Array(64), w16 = (at, v) => { b[at] = v & 0xff; b[at + 1] = (v >>> 8) & 0xff; }; b[0] = 64;
  if (!config) return b;
  w16(4, u32(config, 1)); w16(6, u32(config, 2));
  const tag = str(config, 3);
  if (tag) {
    const parts = tag.replace(/^b\+/, '').split(/[-+_]/); let language = '', script = '', region = '', variant = '';
    language = parts.shift().toLowerCase();
    for (const part of parts) { if (/^[A-Za-z]{4}$/.test(part) && !script && !region) script = part[0].toUpperCase() + part.slice(1).toLowerCase(); else if (/^([A-Za-z]{2}|\d{3})$/.test(part) && !region) region = part.toUpperCase(); else if (/^r[A-Za-z]{2}$/.test(part) && !region) region = part.slice(1).toUpperCase(); else variant = part; }
    const [l0, l1] = packLocale(language, 'a'), [r0, r1] = packLocale(region, '0'); b[8] = l0; b[9] = l1; b[10] = r0; b[11] = r1;
    for (let i = 0; i < 4 && i < script.length; i++) b[36 + i] = script.charCodeAt(i);
    for (let i = 0; i < 8 && i < variant.length; i++) b[40 + i] = variant.charCodeAt(i);
  }
  b[12] = u32(config, 15); b[13] = u32(config, 19); w16(14, u32(config, 18)); b[16] = u32(config, 21); b[17] = u32(config, 23);
  b[18] = u32(config, 20) | ([0, 0x4, 0x8][u32(config, 22)] ?? 0);   // inputFlags: keysHidden | navHidden (NAVEXPOSED 4, NAVHIDDEN 8)
  w16(20, u32(config, 5)); w16(22, u32(config, 6)); w16(24, u32(config, 24));
  b[28] = u32(config, 10) | ([0, 0x20, 0x10][u32(config, 11)] ?? 0) | ([0, 0x40, 0x80][u32(config, 4)] ?? 0);   // size | long (LONG 0x20, NOTLONG 0x10) | direction (LTR 0x40, RTL 0x80)
  b[29] = u32(config, 16) | ([0, 0x20, 0x10][u32(config, 17)] ?? 0);   // uiMode type | night (NIGHT 0x20, NOTNIGHT 0x10)
  w16(30, u32(config, 9)); w16(32, u32(config, 7)); w16(34, u32(config, 8));
  b[48] = [0, 2, 1][u32(config, 12)] ?? 0;   // screenLayout2 round: ROUND 2, NOTROUND 1
  b[49] = ([0, 2, 1][u32(config, 13)] ?? 0) | ([0, 8, 4][u32(config, 14)] ?? 0);   // colorMode: wide gamut (2 / 1) | hdr (8 / 4)
  if (u32(config, 26)) b[19] = u32(config, 26);   // grammatical gender (API 34)
  return b;
}

// ---- resources.pb -> resources.arsc
const MAP = { ATTR_TYPE: 0x01000000, ATTR_MIN: 0x01000001, ATTR_MAX: 0x01000002, ATTR_OTHER: 0x01000004 };
export function tableToArsc(bytes, notes = []) {
  const table = fields(bytes), packages = msgs(table, 2), pool = new StringPool(), protoFiles = new Map();
  const tagPool = []; const spansOf = list => list.map(span => ({ tag: str(span, 1), first: u32(span, 2), last: u32(span, 3) }));
  if (packages.length !== 1) notes.push(`resources.pb has ${packages.length} packages: only the app package is written`);
  const encoded = [];
  for (const pkg of packages.slice(0, 1)) {
    const id = u32(msg(pkg, 1) ?? new Map(), 1) || 0x7f, name = str(pkg, 2), types = [], keys = new StringPool();
    for (const type of msgs(pkg, 3)) {
      const typeId = u32(msg(type, 1) ?? new Map(), 1), typeName = str(type, 2); if (!typeId) continue;
      if (typeName === 'styleable' || typeName === 'macro') continue;   // not in an APK's table
      const entries = [];
      for (const entry of msgs(type, 3)) {
        const entryId = u32(msg(entry, 1) ?? new Map(), 1), visibility = msg(entry, 3), isPublic = visibility && u32(visibility, 1) === 2, key = keys.add(str(entry, 2));
        for (const cv of msgs(entry, 6)) {
          const config = encodeConfig(msg(cv, 1)), value = msg(cv, 2); if (!value) continue;
          const weak = u32(value, 3) === 1; let body;
          if (has(value, 4)) {
            const item = msg(value, 4); body = { simple: itemValue(item, pool, list => list.length ? spansOf(list) : null) };
            if (has(item, 5)) { const file = msg(item, 5); if (u32(file, 2) === 3) protoFiles.set(str(file, 1), true); }
          } else if (has(value, 5)) {
            const compound = msg(value, 5); let parent = 0; const items = [];
            if (has(compound, 1)) {
              const attr = msg(compound, 1); items.push({ name: MAP.ATTR_TYPE, value: { type: TYPE.INT_DEC, data: u32(attr, 1) } });
              if (has(attr, 2) && (u32(attr, 2) | 0) !== -2147483648) items.push({ name: MAP.ATTR_MIN, value: { type: TYPE.INT_DEC, data: u32(attr, 2) } });
              if (has(attr, 3) && (u32(attr, 3) | 0) !== 2147483647) items.push({ name: MAP.ATTR_MAX, value: { type: TYPE.INT_DEC, data: u32(attr, 3) } });
              for (const symbol of msgs(attr, 4)) items.push({ name: u32(msg(symbol, 3) ?? new Map(), 2), value: { type: u32(symbol, 5) || TYPE.INT_DEC, data: u32(symbol, 4) } });
            } else if (has(compound, 2)) {
              const style = msg(compound, 2); parent = msg(style, 1) ? u32(msg(style, 1), 2) : 0;
              for (const item of msgs(style, 3)) items.push({ name: u32(msg(item, 3) ?? new Map(), 2), value: itemValue(msg(item, 4) ?? new Map(), pool, list => list.length ? spansOf(list) : null) });
              items.sort((a, b) => (a.name >>> 0) - (b.name >>> 0));
            } else if (has(compound, 4)) {
              msgs(msg(compound, 4), 1).forEach((element, i) => items.push({ name: 0x02000000 + i, value: itemValue(msg(element, 3) ?? new Map(), pool, list => list.length ? spansOf(list) : null) }));
            } else if (has(compound, 5)) {
              for (const item of msgs(msg(compound, 5), 1)) items.push({ name: MAP.ATTR_OTHER + [1, 2, 3, 4, 5, 0][u32(item, 3)], value: itemValue(msg(item, 4) ?? new Map(), pool, list => list.length ? spansOf(list) : null) });
              items.sort((a, b) => a.name - b.name);
            } else continue;   // a styleable or a macro: not in an APK's table
            body = { parent, items };
          } else continue;
          entries.push({ entryId, key, isPublic, weak, config, body });
        }
      }
      types.push({ typeId, typeName, entries });
    }
    encoded.push({ id, name, types, keys });
  }
  // span tags join the global pool by name
  for (let i = 0; i < pool.list.length; i++) if (pool.styles[i]) pool.styles[i] = pool.styles[i].map(span => ({ name: span.tag, first: span.first, last: span.last }));
  for (let i = 0; i < pool.list.length; i++) if (pool.styles[i]) for (const span of pool.styles[i]) tagPool.push(span);
  for (const span of tagPool) span.name = pool.add(span.name);
  const remap = pool.order(); for (const style of pool.styles) for (const span of style) span.name = remap.get(span.name);
  const fix = value => value.type === TYPE.STRING ? { ...value, data: remap.get(value.data) } : value;

  const out = new Out(); out.u16(0x0002).u16(12).u32(0).u32(encoded.length);
  pool.write(out);
  for (const pkg of encoded) {
    const start = out.length; out.u16(0x0200).u16(288).u32(0).u32(pkg.id);
    for (let i = 0; i < 128; i++) out.u16(i < pkg.name.length ? pkg.name.charCodeAt(i) : 0);
    const typeStringsAt = out.length; out.u32(0).u32(0); const keyStringsAt = out.length; out.u32(0).u32(0).u32(0);
    const typeNames = new StringPool(), maxType = Math.max(0, ...pkg.types.map(t => t.typeId));
    for (let id = 1; id <= maxType; id++) typeNames.list.push(pkg.types.find(t => t.typeId === id)?.typeName ?? `unused${id}`);
    out.set32(typeStringsAt, out.length - start); typeNames.write(out); out.set32(typeStringsAt + 4, maxType);
    out.set32(keyStringsAt, out.length - start); pkg.keys.write(out); out.set32(keyStringsAt + 4, pkg.keys.list.length);
    for (const type of pkg.types) {
      const count = Math.max(0, ...type.entries.map(e => e.entryId + 1));
      out.u16(0x0202).u16(16).u32(16 + count * 4).u8(type.typeId).u8(0).u16(0).u32(count);
      const flags = new Array(count).fill(0); for (const e of type.entries) if (e.isPublic) flags[e.entryId] |= 0x40000000;
      for (const f of flags) out.u32(f);
      const byConfig = new Map(); for (const e of type.entries) { const key = e.config.join(','); if (!byConfig.has(key)) byConfig.set(key, { config: e.config, entries: [] }); byConfig.get(key).entries.push(e); }
      for (const { config, entries } of byConfig.values()) {
        const chunk = out.length; out.u16(0x0201).u16(84).u32(0).u8(type.typeId).u8(0).u16(0).u32(count).u32(84 + count * 4).put(config);
        const offsetsAt = out.length; for (let i = 0; i < count; i++) out.u32(0xffffffff);
        const dataStart = out.length;
        for (const e of entries.sort((a, b) => a.entryId - b.entryId)) {
          out.set32(offsetsAt + e.entryId * 4, out.length - dataStart);
          const flagsBits = (e.isPublic ? 2 : 0) | (e.weak ? 4 : 0);
          if (e.body.simple) { const v = fix(e.body.simple); out.u16(8).u16(flagsBits).u32(e.key).u16(8).u8(0).u8(v.type).u32(v.data); }
          else { out.u16(16).u16(flagsBits | 1).u32(e.key).u32(e.body.parent).u32(e.body.items.length); for (const item of e.body.items) { const v = fix(item.value); out.u32(item.name).u16(8).u8(0).u8(v.type).u32(v.data); } }
        }
        out.set32(chunk + 4, out.length - chunk);
      }
    }
    out.set32(start + 4, out.length - start);
  }
  out.set32(4, out.length);
  return { arsc: out.done(), protoFiles };
}

// ---- proto XmlNode -> binary XML (ResXMLTree)
const ANDROID_ID = 0x010100d0;
export function xmlToBinary(bytes) {
  const root = fields(bytes), pool = new StringPool(), withIds = [], idKeys = new Map();
  // the attribute names that have a resource id come first, in the order of the resource map
  const collect = node => { const element = msg(node, 1); if (!element) return; for (const a of msgs(element, 4)) { const id = u32(a, 5); if (id) { const key = `${str(a, 2)}\u0000${id}`; if (!idKeys.has(key)) { idKeys.set(key, withIds.length); withIds.push({ name: str(a, 2), id }); } } } for (const child of msgs(element, 5)) collect(child); };
  collect(root);
  for (const { name } of withIds) pool.list.push(name);
  const nameIndex = (name, id) => id ? idKeys.get(`${name}\u0000${id}`) : pool.add(name);
  const nodes = [];
  const walk = node => {
    const line = msg(node, 3) ? u32(msg(node, 3), 1) : 0;
    if (has(node, 2)) { nodes.push({ kind: 'text', line, text: pool.add(str(node, 2)) }); return; }
    const element = msg(node, 1); if (!element) return;
    const namespaces = msgs(element, 1).map(ns => ({ prefix: pool.add(str(ns, 1)), uri: pool.add(str(ns, 2)), line: msg(ns, 3) ? u32(msg(ns, 3), 1) : line }));
    for (const ns of namespaces) nodes.push({ kind: 'ns-start', ...ns });
    const ns = str(element, 2), name = pool.add(str(element, 3));
    const attributes = msgs(element, 4).map(a => {
      const id = u32(a, 5), uri = str(a, 1), item = msg(a, 6), raw = str(a, 3);
      const value = item ? itemValue(item, pool, () => null) : { type: TYPE.STRING, data: pool.add(raw) };
      const keepRaw = !item || value.type === TYPE.STRING;
      return { id, ns: uri ? pool.add(uri) : 0xffffffff, name: nameIndex(str(a, 2), id), nameText: str(a, 2), uri, raw: keepRaw ? pool.add(raw) : 0xffffffff, value };
    });
    // as aapt2's XmlFlattener: the attributes with a resource id first, by id, then the others by name
    attributes.sort((a, b) => (a.id && b.id) ? (a.id >>> 0) - (b.id >>> 0) : a.id ? -1 : b.id ? 1 : a.nameText < b.nameText ? -1 : a.nameText > b.nameText ? 1 : 0);
    nodes.push({ kind: 'start', line, ns: ns ? pool.add(ns) : 0xffffffff, name, attributes });
    for (const child of msgs(element, 5)) walk(child);
    nodes.push({ kind: 'end', line, ns: ns ? pool.add(ns) : 0xffffffff, name });
    for (const n of namespaces.reverse()) nodes.push({ kind: 'ns-end', ...n });
  };
  walk(root);
  const out = new Out(); out.u16(0x0003).u16(8).u32(0);
  pool.write(out);
  out.u16(0x0180).u16(8).u32(8 + withIds.length * 4); for (const { id } of withIds) out.u32(id);
  for (const node of nodes) {
    if (node.kind === 'ns-start' || node.kind === 'ns-end') out.u16(node.kind === 'ns-start' ? 0x0100 : 0x0101).u16(16).u32(24).u32(node.line).u32(0xffffffff).u32(node.prefix).u32(node.uri);
    else if (node.kind === 'text') out.u16(0x0104).u16(16).u32(28).u32(node.line).u32(0xffffffff).u32(node.text).u16(8).u8(0).u8(0).u32(0);
    else if (node.kind === 'end') out.u16(0x0103).u16(16).u32(24).u32(node.line).u32(0xffffffff).u32(node.ns).u32(node.name);
    else {
      const a = node.attributes, index = test => { const i = a.findIndex(test); return i < 0 ? 0 : i + 1; };
      out.u16(0x0102).u16(16).u32(36 + a.length * 20).u32(node.line).u32(0xffffffff).u32(node.ns).u32(node.name).u16(20).u16(20).u16(a.length)
        .u16(index(x => x.id === ANDROID_ID)).u16(index(x => !x.uri && x.nameText === 'class')).u16(index(x => !x.uri && x.nameText === 'style'));
      for (const x of a) out.u32(x.ns).u32(x.name).u32(x.raw).u16(8).u8(0).u8(x.value.type).u32(x.value.data);
    }
  }
  out.set32(4, out.length);
  return out.done();
}

// ---- ZIP (stored entries)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = bytes => { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const encoder = new TextEncoder(), out = new Out(), central = [];
  for (const [name, data] of files) {
    const nameBytes = encoder.encode(name), crc = crc32(data), offset = out.length;
    out.u32(0x04034b50).u16(20).u16(0x0800).u16(0).u16(0).u16(0x21).u32(crc).u32(data.length).u32(data.length).u16(nameBytes.length).u16(0).put(nameBytes).put(data);
    central.push({ nameBytes, crc, size: data.length, offset });
  }
  const cdStart = out.length;
  for (const e of central) out.u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(0).u16(0).u16(0x21).u32(e.crc).u32(e.size).u32(e.size).u16(e.nameBytes.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(e.offset).put(e.nameBytes);
  const cdSize = out.length - cdStart;
  out.u32(0x06054b50).u16(0).u16(0).u16(central.length).u16(central.length).u32(cdSize).u32(cdStart).u16(0);
  return out.done();
}

/**
 * The APK of an App Bundle's base module: { bytes, notes }. `input` is the .aab (ArrayBuffer or Uint8Array). Throws (kind 'aab-unsupported') when it is not a bundle with a base
 * module or its resource data cannot be read.
 */
export function appBundleToApk(input) {
  const archive = new APKArchive(input), names = [...archive.entries.keys()], notes = [];
  if (!isAppBundle(names)) fail('Not an Android App Bundle (no BundleConfig.pb or base/manifest/AndroidManifest.xml)');
  if (!names.includes('base/manifest/AndroidManifest.xml')) fail('The App Bundle has no base module (base/manifest/AndroidManifest.xml)');
  const read = name => archive.extractSync(name, MAX_ENTRY);
  const modules = [...new Set(names.filter(n => /^[^/]+\/manifest\/AndroidManifest\.xml$/.test(n)).map(n => n.split('/')[0]))].filter(m => m !== 'base');
  if (modules.length) notes.push(`only the base module is installed; not included: ${modules.join(', ')} (feature modules or asset packs of the bundle)`);
  const files = new Map();
  let protoFiles = new Map();
  if (names.includes('base/resources.pb')) { const result = tableToArsc(read('base/resources.pb'), notes); files.set('resources.arsc', result.arsc); protoFiles = result.protoFiles; }
  files.set('AndroidManifest.xml', xmlToBinary(read('base/manifest/AndroidManifest.xml')));
  for (const name of names) {
    if (name.endsWith('/')) continue;
    let target = null;
    if (/^base\/dex\/classes\d*\.dex$/.test(name)) target = name.slice('base/dex/'.length);
    else if (/^base\/(res|assets|lib)\//.test(name)) target = name.slice('base/'.length);
    else if (name.startsWith('base/root/')) target = name.slice('base/root/'.length);
    else if (/^META-INF\/[^/]+\.(RSA|DSA|EC|SF|MF)$/i.test(name)) target = name;
    if (!target || files.has(target)) continue;
    const data = read(name);
    files.set(target, protoFiles.has(target) ? xmlToBinary(data) : data);
  }
  if (!files.has('classes.dex')) fail('The base module of the App Bundle has no base/dex/classes.dex');
  return { bytes: zip(files), notes };
}
