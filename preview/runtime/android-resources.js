// Binary format: AOSP androidfw/ResourceTypes.h. Independent parser; no AndroidX emulation.
// https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/androidfw/include/androidfw/ResourceTypes.h
const NO_INDEX = 0xffffffff;
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
const utf16 = new TextDecoder('utf-16le', { fatal: true });
const MAX_BYTES = 64 * 1024 * 1024;
export class AndroidResourceError extends Error { constructor(message) { super(message); this.name = 'AndroidResourceError'; } }
const fail = (message) => { throw new AndroidResourceError(message); };
class Reader {
  constructor(input) {
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (this.bytes.length > MAX_BYTES) fail('Resource data exceeds 64 MiB parser limit');
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.length = this.bytes.length;
  }
  check(at, length, end = this.length) { if (!Number.isSafeInteger(at) || !Number.isSafeInteger(length) || at < 0 || length < 0 || at + length > end || end > this.length) fail(`Resource data out of bounds at 0x${at.toString(16)}`); }
  u8(at) { this.check(at, 1); return this.view.getUint8(at); }
  u16(at) { this.check(at, 2); return this.view.getUint16(at, true); }
  u32(at) { this.check(at, 4); return this.view.getUint32(at, true); }
  slice(at, count) { this.check(at, count); return this.bytes.subarray(at, at + count); }
  chunk(at, end = this.length) {
    this.check(at, 8, end); const type = this.u16(at), header = this.u16(at + 2), size = this.u32(at + 4);
    if (header < 8 || size < header) fail(`Invalid resource chunk at 0x${at.toString(16)}`);
    this.check(at, size, end); return { at, type, header, size, end: at + size };
  }
}
// Android string pools may encode UTF-16 surrogate pairs as CESU-8.
function decodeAndroidUTF8(bytes) {
  const units = [];
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++]; let cp, count, minimum;
    if (first < 0x80) { units.push(first); continue; }
    if (first >= 0xc0 && first <= 0xdf) { cp = first & 31; count = 1; minimum = 0x80; }
    else if (first >= 0xe0 && first <= 0xef) { cp = first & 15; count = 2; minimum = 0x800; }
    else if (first >= 0xf0 && first <= 0xf4) { cp = first & 7; count = 3; minimum = 0x10000; }
    else fail('Invalid Android UTF-8 leading byte');
    if (i + count > bytes.length) fail('Truncated Android UTF-8 string');
    for (let j = 0; j < count; j++) { const next = bytes[i++]; if ((next & 0xc0) !== 0x80) fail('Invalid Android UTF-8 continuation'); cp = (cp << 6) | (next & 63); }
    if ((cp < minimum && !(first === 0xc0 && cp === 0)) || cp > 0x10ffff) fail('Invalid Android UTF-8 codepoint');
    if (cp > 0xffff) { cp -= 0x10000; units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); }
    else units.push(cp);
  }
  let value = ''; for (let i = 0; i < units.length; i += 8192) value += String.fromCharCode(...units.slice(i, i + 8192));
  return value;
}
function pool(reader, chunk) {
  const { at, header, size, end } = chunk;
  if (chunk.type !== 1 || header < 28) fail('Expected resource string pool');
  const count = reader.u32(at + 8), styles = reader.u32(at + 12), flags = reader.u32(at + 16), start = reader.u32(at + 20), styleStart = reader.u32(at + 24);
  if (count > 250000 || styles > count || header + (count + styles) * 4 > size || start < header + (count + styles) * 4 || start > size) fail('Malformed/excessive resource string pool');
  const stringEnd = styleStart ? at + styleStart : end;
  if (stringEnd < at + start || stringEnd > end) fail('Invalid string pool style offset');
  const strings = []; let total = 0;
  for (let i = 0; i < count; i++) {
    let cursor = at + start + reader.u32(at + header + i * 4);
    const length8 = () => { reader.check(cursor, 1, stringEnd); const value = reader.u8(cursor++); if (!(value & 0x80)) return value; reader.check(cursor, 1, stringEnd); return ((value & 0x7f) << 8) | reader.u8(cursor++); };
    const length16 = () => { reader.check(cursor, 2, stringEnd); const value = reader.u16(cursor); cursor += 2; if (!(value & 0x8000)) return value; reader.check(cursor, 2, stringEnd); const next = reader.u16(cursor); cursor += 2; return (value & 0x7fff) * 65536 + next; };
    let value;
    if (flags & 0x100) {
      const units = length8(), bytes = length8(); reader.check(cursor, bytes + 1, stringEnd);
      if (reader.u8(cursor + bytes) !== 0) fail('Unterminated UTF-8 resource string');
      value = decodeAndroidUTF8(reader.slice(cursor, bytes));
      if (value.length !== units) fail('Resource UTF-8 length mismatch');
    } else {
      const units = length16(); reader.check(cursor, units * 2 + 2, stringEnd);
      if (reader.u16(cursor + units * 2) !== 0) fail('Unterminated UTF-16 resource string');
      value = utf16.decode(reader.slice(cursor, units * 2));
    }
    total += value.length; if (total > 16 * 1024 * 1024) fail('Decoded resource strings exceed limit'); strings.push(value);
  }
  return strings;
}
function stringAt(strings, index, optional = false) {
  if (optional && index === NO_INDEX) return null;
  if (!strings || index >= strings.length) fail(`Invalid resource string index ${index}`);
  return strings[index];
}
function scalar(type, data, strings) {
  const base = { dataType: type, rawData: data };
  if (type === 0) return { ...base, kind: 'null', value: null, empty: data === 1 };
  if (type === 1 || type === 2) return { ...base, kind: type === 1 ? 'reference' : 'attribute', value: data, reference: data };
  if (type === 3) return { ...base, kind: 'string', value: stringAt(strings, data) };
  if (type === 4) { const bits = new DataView(new ArrayBuffer(4)); bits.setUint32(0, data, true); return { ...base, kind: 'float', value: bits.getFloat32(0, true) }; }
  if (type === 5 || type === 6) {
    const radix = [1 / 256, 1 / 32768, 1 / 8388608, 1 / 2147483648][(data >> 4) & 3];
    return { ...base, kind: type === 5 ? 'dimension' : 'fraction', value: (data & 0xffffff00) * radix, unit: (type === 5 ? ['px', 'dp', 'sp', 'pt', 'in', 'mm'] : ['%', '%p'])[data & 15] ?? `unknown-${data & 15}` };
  }
  if (type === 7 || type === 8) return { ...base, kind: 'unresolved', value: null, reference: data, reason: 'Dynamic package reference/attribute requires library ID remapping' };
  if (type === 0x12) return { ...base, kind: 'boolean', value: data !== 0 };
  if (type >= 0x1c && type <= 0x1f) return { ...base, kind: 'color', value: `#${data.toString(16).padStart(8, '0')}` };
  if (type === 0x10 || type === 0x11) return { ...base, kind: 'integer', value: type === 0x10 ? data | 0 : data };
  return { ...base, kind: 'unresolved', value: null, reason: `Unsupported typed resource value 0x${type.toString(16)}` };
}
function readValue(reader, at, end, strings) {
  reader.check(at, 8, end); const size = reader.u16(at);
  if (size < 8) fail('Invalid typed resource value size'); reader.check(at, size, end);
  return scalar(reader.u8(at + 3), reader.u32(at + 4), strings);
}

/** Scalars/strings/references and real binary XML; no theme, drawable, or AndroidX execution. */
export class AndroidResources {
  constructor(arscBytes = null, callbacks = {}) {
    this.options = callbacks; this.sourceCookie = callbacks.sourceCookie ?? 1; this.entries = new Map(); this.names = new Map(); this.packages = []; this.warnings = []; this.strings = [];
    if (arscBytes != null) this.parseTable(arscBytes);
  }
  static fromJSON(data, callbacks = {}) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.entries) || data.entries.length > 100000 || !Array.isArray(data.packages)) fail('Invalid bounded resource JSON dataset');
    const table = new AndroidResources(null, callbacks); table.packages = data.packages.map(({ id, name }) => ({ id, name })); let count = 0;
    for (const pair of data.entries) {
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) || pair[0] <= 0 || pair[0] > 0xffffffff || !Array.isArray(pair[1]) || !pair[1].length) fail('Invalid resource JSON entry');
      if (table.entries.has(pair[0])) fail('Duplicate resource JSON identifier');
      const variants = pair[1].map(value => {
        if (++count > 300000 || !value || value.id !== pair[0] || typeof value.kind !== 'string' || !value.config) fail('Invalid/excessive resource JSON variant');
        if (value.items && (!Array.isArray(value.items) || value.items.length > 65536)) fail('Invalid resource JSON bag');
        const entry = { ...value, sourceCookie: table.sourceCookie };
        if (entry.items) entry.items = entry.items.map(item => ({ ...item, sourceCookie: table.sourceCookie }));
        return entry;
      });
      table.entries.set(pair[0], variants);
      const first = variants[0]; table.names.set(first.fullName, pair[0]); table.names.set(`${first.resourceType}/${first.name}`, pair[0]);
    }
    table.dataset = { source: data.source ?? null, profile: data.profile ?? data.selectedProfile ?? null, entryCount: table.entries.size };
    return table;
  }
  resolveBag(id, visited = new Set()) {
    id = Number(id) >>> 0; if (!id) return new Map();
    if (visited.has(id) || visited.size >= 64) fail(`Cyclic/excessive resource bag inheritance at 0x${id.toString(16)}`);
    const next = new Set(visited); next.add(id);
    let entry = this.resolve(id); while (entry.resolved) entry = entry.resolved;
    if (entry.kind !== 'bag' || !entry.items) fail(`Resource 0x${id.toString(16)} is not a resolved bag: ${entry.reason || entry.kind}`);
    const values = entry.parent ? this.resolveBag(entry.parent, next) : new Map();
    for (const item of entry.items) values.set(item.name >>> 0, { ...item, sourceResourceId: entry.id, sourceCookie: item.sourceCookie ?? entry.sourceCookie ?? this.sourceCookie });
    return values;
  }
  resolveThemeValue(value, theme, { resolveReferences = true } = {}, visited = new Set()) {
    if (value?.resolved) { const original = value; while (value.resolved) value = value.resolved; return { ...this.resolveThemeValue(value, theme, { resolveReferences }, visited), resourceId: original.resourceId || original.reference || original.id, sourceResourceId: original.sourceResourceId }; }
    if (!value) return { kind: 'null', value: null, dataType: 0, rawData: 0 };
    if (visited.size >= 64) fail('Excessive theme resource chain');
    if (value.kind === 'attribute') {
      const id = value.reference >>> 0, token = `attr:${id}`;
      if (visited.has(token)) fail(`Cyclic theme attribute 0x${id.toString(16)}`);
      const next = new Set(visited); next.add(token);
      if (!theme.has(id)) return { ...value, kind: 'unresolved', value: null, reason: `Theme attribute 0x${id.toString(16)} has no declared value` };
      return this.resolveThemeValue(theme.get(id), theme, { resolveReferences }, next);
    }
    if (resolveReferences && value.kind === 'reference') {
      const id = value.reference >>> 0, token = `res:${id}`;
      if (!id) return { ...value, kind: 'null', value: null, dataType: 0, rawData: 0, resourceId: 0 };
      if (visited.has(token)) fail(`Cyclic theme resource 0x${id.toString(16)}`);
      const next = new Set(visited); next.add(token); let resolved = this.resolve(id);
      while (resolved.resolved) resolved = resolved.resolved;
      return { ...this.resolveThemeValue(resolved, theme, { resolveReferences }, next), resourceId: id, sourceResourceId: value.sourceResourceId };
    }
    return { ...value };
  }
  warn(message) { if (!this.warnings.includes(message)) { this.warnings.push(message); this.options.onWarning?.(message); } }
  parseTable(bytes) {
    const r = new Reader(bytes), root = r.chunk(0);
    if (root.type !== 2 || root.header < 12 || root.end !== r.length) fail('Expected complete resources.arsc table');
    const count = r.u32(8); if (count > 255) fail('Resource package count exceeds limit');
    let havePool = false;
    for (let at = root.header; at < root.end;) {
      const c = r.chunk(at, root.end);
      if (c.type === 1) { if (havePool) fail('Duplicate global resource string pool'); this.strings = pool(r, c); havePool = true; }
      else if (c.type === 0x200) { if (!havePool) fail('Package precedes global resource string pool'); this.parsePackage(r, c); }
      else this.warn(`Resource table chunk 0x${c.type.toString(16)} preserved only as unsupported metadata`);
      at = c.end;
    }
    if (this.packages.length !== count) fail('Resource package count mismatch');
    return this;
  }
  parsePackage(r, c) {
    if (c.header < 284) fail('Resource package header is truncated');
    const id = r.u32(c.at + 8), typeOffset = c.header >= 288 ? r.u32(c.at + 284) : 0;
    if (!id || id > 255 || typeOffset > 254) fail('Invalid resource package/type ID');
    let units = 0; while (units < 128 && r.u16(c.at + 12 + units * 2)) units++;
    const name = utf16.decode(r.slice(c.at + 12, units * 2));
    const typeAt = r.u32(c.at + 268), keyAt = r.u32(c.at + 276);
    if (!typeAt || !keyAt || typeAt < c.header || keyAt < c.header) fail('Inherited package string pools are not supported');
    const types = pool(r, r.chunk(c.at + typeAt, c.end)), keys = pool(r, r.chunk(c.at + keyAt, c.end));
    const pkg = { id, name, typeOffset, types, keys }; this.packages.push({ id, name });
    for (let at = c.at + c.header; at < c.end;) {
      const child = r.chunk(at, c.end);
      if (child.type === 0x201) this.parseType(r, child, pkg);
      else if (![1, 0x202].includes(child.type)) this.warn(`Package ${name} has unsupported chunk 0x${child.type.toString(16)}`);
      at = child.end;
    }
  }
  parseType(r, c, pkg) {
    if (c.header < 24) fail('Resource type header is truncated');
    const typeId = r.u8(c.at + 8), flags = r.u8(c.at + 9), count = r.u32(c.at + 12), start = r.u32(c.at + 16), configSize = r.u32(c.at + 20);
    if (!typeId || typeId + pkg.typeOffset > 255 || flags & ~3 || count > 65536 || configSize < 4 || 20 + configSize > c.header || start < c.header || start > c.size) fail('Malformed resource type/configuration');
    const configBytes = r.slice(c.at + 24, configSize - 4);
    const config = { isDefault: configBytes.every((byte) => byte === 0), bytes: Array.from(configBytes) };
    const offsetWidth = flags & 1 ? 4 : flags & 2 ? 2 : 4;
    if (c.header + count * offsetWidth > start) fail('Resource entry offsets overlap entry data');
    const seen = new Set();
    for (let i = 0; i < count; i++) {
      const slot = c.at + c.header + i * offsetWidth;
      const index = flags & 1 ? r.u16(slot) : i;
      const rawOffset = flags & 1 ? r.u16(slot + 2) : flags & 2 ? r.u16(slot) : r.u32(slot);
      if (!(flags & 1) && rawOffset === (flags & 2 ? 0xffff : NO_INDEX)) continue;
      if (seen.has(index)) fail('Duplicate sparse resource entry'); seen.add(index);
      const offset = flags & 3 ? rawOffset * 4 : rawOffset;
      const at = c.at + start + offset; r.check(at, 8, c.end);
      const entryFlags = r.u16(at + 2), compact = !!(entryFlags & 8), entrySize = compact ? 8 : r.u16(at);
      if (entrySize < 8 || (compact && entryFlags & 1)) fail('Invalid resource entry header'); r.check(at, entrySize, c.end);
      const key = compact ? r.u16(at) : r.u32(at + 4);
      const resourceId = ((pkg.id << 24) | ((typeId + pkg.typeOffset) << 16) | index) >>> 0;
      const resourceType = stringAt(pkg.types, typeId - 1), resourceName = stringAt(pkg.keys, key);
      let value;
      if (entryFlags & 1) {
        if (entrySize < 16) fail('Complex resource entry header is truncated');
        const parent = r.u32(at + 8), mapCount = r.u32(at + 12);
        if (mapCount > 65536) fail('Complex resource map exceeds limit'); r.check(at + entrySize, mapCount * 12, c.end);
        const items = [];
        for (let j = 0; j < mapCount; j++) { const mapAt = at + entrySize + j * 12; items.push({ sourceCookie: this.sourceCookie, name: r.u32(mapAt), ...readValue(r, mapAt + 4, c.end, this.strings) }); }
        value = { kind: 'bag', value: null, parent, items, reason: 'Bag retained; theme/style inheritance is not executed' };
      } else value = compact ? scalar(entryFlags >> 8, r.u32(at + 4), this.strings) : readValue(r, at + entrySize, c.end, this.strings);
      const entry = { sourceCookie: this.sourceCookie, id: resourceId, packageName: pkg.name, resourceType, name: resourceName, fullName: `${pkg.name}:${resourceType}/${resourceName}`, config, ...value };
      if (!this.entries.has(resourceId)) { if (this.entries.size >= 250000) fail('Resource entry count exceeds limit'); this.entries.set(resourceId, []); }
      this.entries.get(resourceId).push(entry);
      this.names.set(`${resourceType}/${resourceName}`, resourceId); this.names.set(entry.fullName, resourceId);
    }
  }
  findId(name) { return this.names.get(name) ?? null; }
  selectVariant(id) {
    const variants = this.entries.get(Number(id) >>> 0); if (!variants) return null;
    const selected = typeof this.options.chooseConfiguration === 'function' ? this.options.chooseConfiguration(variants) : variants.find(entry => entry.config.isDefault);
    if (selected != null && !variants.includes(selected)) fail('Resource configuration selector returned a foreign variant');
    return selected ?? null;
  }
  resolve(id, visited = new Set()) {
    id = Number(id) >>> 0;
    if (!id) return { id, kind: 'null', value: null };
    if (visited.has(id) || visited.size >= 64) return { id, kind: 'unresolved', value: null, reason: 'Cyclic/excessive resource reference chain' };
    const variants = this.entries.get(id);
    if (!variants) return this.options.resolveExternal?.(id) ?? { id, kind: 'unresolved', value: null, reason: `Resource 0x${id.toString(16)} is absent (framework/split resources may be required)` };
    const selected = this.selectVariant(id);
    if (!selected || !variants.includes(selected)) return { id, kind: 'unresolved', value: null, reason: typeof this.options.chooseConfiguration === 'function' ? 'No compatible resource variant for the explicit device configuration' : 'No unqualified resource variant; explicit configuration selection required', variants: variants.map((entry) => entry.config) };
    if (selected.kind !== 'reference') return { ...selected };
    const chain = new Set(visited); chain.add(id);
    const resolved = this.resolve(selected.reference, chain);
    return { ...selected, kind: resolved.kind, value: resolved.value, reference: selected.reference, resolved, reason: resolved.reason };
  }
  parseLayout(bytes) {
    const r = new Reader(bytes), root = r.chunk(0);
    if (root.type !== 3 || root.end !== r.length) fail('Expected complete binary Android XML layout');
    let strings = null, resourceMap = [], tree = null, nodes = 0;
    const stack = [], namespaces = [];
    for (let at = root.header; at < root.end;) {
      const c = r.chunk(at, root.end);
      if (c.type === 1) { if (strings) fail('Duplicate XML string pool'); strings = pool(r, c); }
      else if (c.type === 0x180) {
        if ((c.size - c.header) % 4 || resourceMap.length) fail('Malformed/duplicate XML resource map');
        resourceMap = Array.from({ length: (c.size - c.header) / 4 }, (_, i) => r.u32(at + c.header + i * 4));
      } else if (c.type === 0x100 || c.type === 0x101) {
        if (c.header < 16 || c.size < 24) fail('Truncated XML namespace');
        const ns = { prefix: stringAt(strings, r.u32(at + 16), true), uri: stringAt(strings, r.u32(at + 20)) };
        if (c.type === 0x100) namespaces.push(ns);
        else { const last = namespaces.pop(); if (!last || last.uri !== ns.uri || last.prefix !== ns.prefix) fail('Mismatched XML namespace'); }
      } else if (c.type === 0x102) {
        if (c.header < 16 || c.size < 36 || stack.length >= 64 || ++nodes > 4096) fail('Truncated/excessive XML elements');
        const ext = at + c.header;
        const namespace = stringAt(strings, r.u32(ext), true), name = stringAt(strings, r.u32(ext + 4));
        const attrStart = ext + r.u16(ext + 8), width = r.u16(ext + 10), count = r.u16(ext + 12);
        if (width < 20 || count > 4096 || attrStart < ext + 20) fail('Malformed XML attributes'); r.check(attrStart, count * width, c.end);
        const node = { name, namespace, lineNumber: r.u32(at + 8), namespaces: namespaces.map((ns) => ({ ...ns })), attributes: [], children: [], text: '' };
        for (let i = 0; i < count; i++) {
          const pos = attrStart + i * width, nameIndex = r.u32(pos + 4), rawIndex = r.u32(pos + 8);
          const typedValue = readValue(r, pos + 12, pos + width, strings);
          const attribute = { name: stringAt(strings, nameIndex), namespace: stringAt(strings, r.u32(pos), true), resourceId: resourceMap[nameIndex] || null, rawValue: stringAt(strings, rawIndex, true), ...typedValue };
          if (typedValue.kind === 'reference') attribute.resolved = this.resolve(typedValue.reference);
          node.attributes.push(attribute);
        }
        if (stack.length) stack.at(-1).children.push(node);
        else { if (tree) fail('Multiple XML roots'); tree = node; }
        stack.push(node);
      } else if (c.type === 0x103) {
        if (c.header < 16 || c.size < c.header + 8 || !stack.length) fail('Unexpected XML end element');
        const node = stack.pop();
        if (node.name !== stringAt(strings, r.u32(at + c.header + 4)) || node.namespace !== stringAt(strings, r.u32(at + c.header), true)) fail('Mismatched XML end element');
      } else if (c.type === 0x104) {
        if (c.header < 16 || c.size < c.header + 12 || !stack.length) fail('Unexpected XML text');
        stack.at(-1).text += stringAt(strings, r.u32(at + c.header));
      } else fail(`Unsupported binary XML chunk 0x${c.type.toString(16)}`);
      at = c.end;
    }
    if (!strings || !tree || stack.length || namespaces.length) fail('Incomplete binary XML layout');
    return tree;
  }
  getAttribute(node, name, namespace = ANDROID_NS) { return node.attributes.find((attribute) => attribute.name === name && attribute.namespace === namespace) ?? null; }
}
