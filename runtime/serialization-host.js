import { gcRoot } from './heap-gc.js?v=7fd72513c4ea';
import { APKError } from './apk-error.js?v=7fd72513c4ea';
import { createHostRegistry, floatBits } from './host-contract.js?v=7fd72513c4ea';
import { DIGESTS } from './crypto-host.js?v=7fd72513c4ea';

// java.io.ObjectOutputStream / ObjectInputStream: the Java Object Serialization Stream Protocol (JDK 8 ObjectStreamConstants, protocol version 5) for the types a VM app
// serializes through Parcel.writeSerializable, Bundle/Intent extras, WorkManager's Data, caches and Externalizable models: String, boxed primitives, primitive and reference
// arrays, enums, Class literals, java.util.ArrayList / LinkedList / HashMap / LinkedHashMap / HashSet / LinkedHashSet and any app class that implements Serializable (default
// field serialization in ObjectStreamClass order, private writeObject/readObject, writeReplace/readResolve, Externalizable). Another platform class fails with an explicit
// error rather than writing a stream a real JVM could not read back.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', OOS = 'Ljava/io/ObjectOutputStream;', OIS = 'Ljava/io/ObjectInputStream;', OUTPUT = 'Ljava/io/OutputStream;', INPUT = 'Ljava/io/InputStream;';
const SERIALIZABLE = 'Ljava/io/Serializable;', EXTERNALIZABLE = 'Ljava/io/Externalizable;', OBJECT_OUTPUT = 'Ljava/io/ObjectOutput;', OBJECT_INPUT = 'Ljava/io/ObjectInput;', DATA_OUTPUT = 'Ljava/io/DataOutput;', DATA_INPUT = 'Ljava/io/DataInput;', CONSTANTS = 'Ljava/io/ObjectStreamConstants;';
const TC = { NULL: 0x70, REFERENCE: 0x71, CLASSDESC: 0x72, OBJECT: 0x73, STRING: 0x74, ARRAY: 0x75, CLASS: 0x76, BLOCKDATA: 0x77, ENDBLOCKDATA: 0x78, RESET: 0x79, BLOCKDATALONG: 0x7a, EXCEPTION: 0x7b, LONGSTRING: 0x7c, PROXYCLASSDESC: 0x7d, ENUM: 0x7e };
const SC = { WRITE_METHOD: 0x01, SERIALIZABLE: 0x02, EXTERNALIZABLE: 0x04, BLOCK_DATA: 0x08, ENUM: 0x10 };
const BASE_HANDLE = 0x7e0000, MAGIC = 0xaced, VERSION = 5, BLOCK_MAX = 1024;
const ENUM = 'Ljava/lang/Enum;', NUMBER = 'Ljava/lang/Number;', NUMBER_SUID = -8742448824652078965n;
const BOX = {   // java.lang boxes: [serialVersionUID, primitive field type]
  'Ljava/lang/Boolean;': [-3665804199014368530n, 'Z'], 'Ljava/lang/Byte;': [-7183698231559129828n, 'B'], 'Ljava/lang/Short;': [7515723908773894738n, 'S'], 'Ljava/lang/Character;': [3786198910865385080n, 'C'],
  'Ljava/lang/Integer;': [1360826667806852920n, 'I'], 'Ljava/lang/Long;': [4290774380558885855n, 'J'], 'Ljava/lang/Float;': [-2671257302660747028n, 'F'], 'Ljava/lang/Double;': [-9172774392245257468n, 'D'],
};
// Collections: serialVersionUID, non-transient fields, whether the class has its own writeObject, and the parent class whose writeObject writes the content.
const COLLECTIONS = {
  'Ljava/util/ArrayList;': { suid: 8683452581122892189n, fields: [['size', 'I']], kind: 'list', own: true },
  'Ljava/util/LinkedList;': { suid: 876323262645176354n, fields: [], kind: 'linked', own: true },
  'Ljava/util/HashMap;': { suid: 362498820763181265n, fields: [['loadFactor', 'F'], ['threshold', 'I']], kind: 'map', own: true },
  'Ljava/util/LinkedHashMap;': { suid: 3801124242820219131n, fields: [['accessOrder', 'Z']], kind: 'map', own: false, parent: 'Ljava/util/HashMap;' },
  'Ljava/util/HashSet;': { suid: -5024744406713321676n, fields: [], kind: 'set', own: true },
  'Ljava/util/LinkedHashSet;': { suid: -2851667679971038690n, fields: [], kind: 'set', own: false, parent: 'Ljava/util/HashSet;' },
};
const defaultValue = type => type === 'J' || type === 'D' ? 0n : type.length === 1 ? 0 : null;
const dotted = type => type.slice(1, -1).replaceAll('/', '.');
const byteOf = v => (v << 24) >> 24;
const isPrimitive = type => type.length === 1;

// ---- Java modified UTF-8 --------------------------------------------------------------------------------------------------------------------------
function encodeUTF(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 1 && c <= 0x7f) out.push(c); else if (c <= 0x7ff) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return out;
}
function decodeUTF(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length;) {
    const a = bytes[i++];
    if (a < 0x80) text += String.fromCharCode(a);
    else if ((a >> 5) === 6) text += String.fromCharCode(((a & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if ((a >> 4) === 14) { text += String.fromCharCode(((a & 0x0f) << 12) | ((bytes[i] & 0x3f) << 6) | (bytes[i + 1] & 0x3f)); i += 2; }
    else throw new Error('Malformed input');
  }
  return text;
}
const int2 = n => [(n >>> 8) & 255, n & 255], int4 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const long8 = v => { const b = BigInt.asUintN(64, BigInt(v)); return Array.from({ length: 8 }, (_x, i) => Number((b >> BigInt(56 - 8 * i)) & 0xffn)); };
/** Big-endian bytes of one primitive value in register representation (long/double are BigInt bits, float is int bits). */
const primitiveBytes = (code, v) => code === 'J' || code === 'D' ? long8(v) : code === 'F' || code === 'I' ? int4(v | 0) : code === 'S' || code === 'C' ? int2(v & 0xffff) : [code === 'Z' ? (v ? 1 : 0) : v & 255];
const primitiveSize = code => code === 'J' || code === 'D' ? 8 : code === 'F' || code === 'I' ? 4 : code === 'S' || code === 'C' ? 2 : 1;
function primitiveValue(code, b) {
  const u = b.reduce((n, x) => n * 256 + x, 0);
  switch (code) {
    case 'Z': return b[0] ? 1 : 0; case 'B': return byteOf(b[0]); case 'S': return (u << 16) >> 16; case 'C': return u; case 'I': case 'F': return u | 0;
    default: { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return BigInt.asIntN(64, v); }
  }
}

export function createSerializationHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  for (const [iface, parents] of [[SERIALIZABLE, []], [EXTERNALIZABLE, [SERIALIZABLE]], [DATA_OUTPUT, []], [DATA_INPUT, []], [OBJECT_OUTPUT, [DATA_OUTPUT]], [OBJECT_INPUT, [DATA_INPUT]], [CONSTANTS, []]]) { type(iface, OBJECT, parents); registry.interfaces.set(iface, parents); }
  type(OOS, OUTPUT, [OBJECT_OUTPUT, CONSTANTS], { allocatable: true }); type(OIS, INPUT, [OBJECT_INPUT, CONSTANTS], { allocatable: true });
  const OBJECT_STREAM = 'Ljava/io/ObjectStreamException;', NOT_SERIALIZABLE = 'Ljava/io/NotSerializableException;', CORRUPTED = 'Ljava/io/StreamCorruptedException;', INVALID_CLASS = 'Ljava/io/InvalidClassException;', OPTIONAL_DATA = 'Ljava/io/OptionalDataException;', NOT_ACTIVE = 'Ljava/io/NotActiveException;';
  type(OBJECT_STREAM, 'Ljava/io/IOException;'); for (const name of [NOT_SERIALIZABLE, CORRUPTED, INVALID_CLASS, OPTIONAL_DATA, NOT_ACTIVE]) type(name, OBJECT_STREAM);
  for (const name of [OBJECT_STREAM, NOT_SERIALIZABLE, CORRUPTED, INVALID_CLASS, NOT_ACTIVE]) { def(name, '<init>', `(${STRING})V`, (r, _m, [self, message]) => { r.object(self).message = message; }); def(name, '<init>', '()V', () => {}); }

  const vcall = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const isSerializable = (r, t) => r.isSubtype(t, SERIALIZABLE);
  const byteArray = (r, bytes) => { const a = r.newArray('[B', bytes.length); r.array(a).elements = Array.from(bytes, byteOf); return a; };
  const unsupported = (t, why) => new APKError(`Serialization of ${t.startsWith('[') ? t : dotted(t)} is not implemented${why ? ` (${why})` : ''}`, { kind: 'unsupported-serialization', type: t });

  // ---- ObjectStreamClass: what the stream says about a class ---------------------------------------------------------------------------------------
  const descriptors = new WeakMap();
  const dexInstanceFields = (r, t) => { const cls = r.classes.get(t); return cls ? cls.fields.map(item => ({ ...cls.dex.fields[item.index], flags: item.flags })) : []; };
  const explicitSuid = (r, t) => {
    const cls = r.classes.get(t);
    for (const item of cls.staticFields) { const f = cls.dex.fields[item.index]; if (f.name === 'serialVersionUID' && f.type === 'J') { r.initialize(t); return BigInt.asIntN(64, BigInt(r.readStatic(f))); } }
    return null;
  };
  /** The JVM's default serialVersionUID (Object Serialization Specification 4.6): SHA-1 over class name, modifiers, interfaces, non-private members and <clinit>. Arrays: name + 0x411. */
  const defaultSuid = (r, t) => {
    const out = [], utf = s => { const b = encodeUTF(s); out.push(...int2(b.length), ...b); }, int = n => out.push(...int4(n));
    if (t.startsWith('[')) { utf(t.replaceAll('/', '.')); int(0x411); }
    else {
      const cls = r.classes.get(t); utf(dotted(t)); int(cls.flags & (0x1 | 0x10 | 0x200 | 0x400));
      for (const name of [...(cls.interfaces ?? [])].map(dotted).sort()) utf(name);
      const fields = dexInstanceFields(r, t).concat(cls.staticFields.map(item => ({ ...cls.dex.fields[item.index], flags: item.flags })));
      for (const f of fields.filter(f => !((f.flags & 0x2) && (f.flags & (0x8 | 0x80)))).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) { utf(f.name); int(f.flags & 0xdf); utf(f.type.replaceAll('/', '.')); }
      const methods = [...cls.methods.values()], jsig = m => m.method.signature.replaceAll('/', '.'), mask = m => m.flags & (0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x100 | 0x400 | 0x800);
      if (methods.some(m => m.method.name === '<clinit>')) { utf('<clinit>'); int(8); utf('()V'); }
      for (const m of methods.filter(m => m.method.name === '<init>' && !(m.flags & 0x2)).sort((a, b) => jsig(a) < jsig(b) ? -1 : 1)) { utf('<init>'); int(mask(m)); utf(jsig(m)); }
      for (const m of methods.filter(m => !m.method.name.startsWith('<') && !(m.flags & 0x2)).sort((a, b) => a.method.name !== b.method.name ? (a.method.name < b.method.name ? -1 : 1) : jsig(a) < jsig(b) ? -1 : 1)) { utf(m.method.name); int(mask(m)); utf(jsig(m)); }
    }
    const digest = DIGESTS['SHA-1'].fn(new Uint8Array(out)); let hash = 0n; for (let i = 7; i >= 0; i--) hash = (hash << 8n) | BigInt(digest[i]); return BigInt.asIntN(64, hash);
  };
  const hook = (r, t, name, signature) => r.classes.get(t)?.methods.get(name + signature);
  const inheritedHook = (r, t, name, signature) => { for (let c = t; c && c !== OBJECT; c = r.parent(c)) { const m = hook(r, c, name, signature); if (m && !(m.flags & 0x2) && (c === t || !(m.flags & 0x2))) return m; } return null; };
  const classFlags = (r, t) => r.classes.get(t)?.flags ?? 0;
  const isEnumClass = (r, t) => !!(classFlags(r, t) & 0x4000) && r.parent(t) === ENUM;
  /** The serialization descriptor of a class (cached): flags, fields in stream order, nearest serializable superclass. */
  function describe(r, t) {
    const table = descriptors.get(r) ?? descriptors.set(r, gcRoot(new Map())).get(r); if (table.has(t)) return table.get(t);
    const d = { type: t, name: t.startsWith('[') ? t.replaceAll('/', '.') : dotted(t), fields: [], superType: null }; table.set(t, d);
    if (t.startsWith('[')) return Object.assign(d, { suid: defaultSuid(r, t), flags: SC.SERIALIZABLE, array: true });
    if (BOX[t]) { const [suid, prim] = BOX[t]; return Object.assign(d, { suid, flags: SC.SERIALIZABLE, fields: [{ name: 'value', type: prim, code: prim }], superType: prim === 'Z' || prim === 'C' ? null : NUMBER, box: prim }); }
    if (t === NUMBER) return Object.assign(d, { suid: NUMBER_SUID, flags: SC.SERIALIZABLE });
    if (t === ENUM) return Object.assign(d, { suid: 0n, flags: SC.SERIALIZABLE | SC.ENUM, enumBase: true });
    if (COLLECTIONS[t]) { const c = COLLECTIONS[t]; return Object.assign(d, { suid: c.suid, flags: SC.SERIALIZABLE | (c.own ? SC.WRITE_METHOD : 0), fields: c.fields.map(([name, code]) => ({ name, type: code, code })), superType: c.parent ?? null, collection: c }); }
    const cls = r.classes.get(t);
    if (!cls) throw unsupported(t, 'a platform class without a stream layout');
    const enumeration = isEnumClass(r, t), external = r.isSubtype(t, EXTERNALIZABLE);
    const declared = enumeration ? [] : dexInstanceFields(r, t).filter(f => !(f.flags & 0x80)).map(f => ({ name: f.name, type: f.type, code: f.type[0] === 'L' || f.type[0] === '[' ? f.type[0] : f.type, field: f }));
    declared.sort((a, b) => (isPrimitive(a.type) ? 0 : 1) - (isPrimitive(b.type) ? 0 : 1) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    let superType = null;
    if (enumeration) superType = ENUM; else for (let p = r.parent(t); p && p !== OBJECT; p = r.parent(p)) if (isSerializable(r, p)) { superType = p; break; }
    Object.assign(d, { suid: enumeration ? 0n : explicitSuid(r, t) ?? defaultSuid(r, t), fields: declared, superType, enum: enumeration, external,
      writeObject: !!hook(r, t, 'writeObject', `(${OOS})V`), readObject: !!hook(r, t, 'readObject', `(${OIS})V`) });
    d.flags = enumeration ? SC.SERIALIZABLE | SC.ENUM : external ? SC.EXTERNALIZABLE | SC.BLOCK_DATA : SC.SERIALIZABLE | (d.writeObject ? SC.WRITE_METHOD : 0);
    return d;
  }
  const chainOf = (r, d) => { const chain = []; for (let c = d; c; c = c.superType ? describe(r, c.superType) : null) chain.unshift(c); return chain; };

  // ============================================================ ObjectOutputStream ============================================================
  const outState = (r, ref) => r.object(ref).oos ?? r.throwJava('Ljava/io/IOException;', 'ObjectOutputStream used before construction');
  /** Block-data mode: primitive writes are buffered in `block` and framed as TC_BLOCKDATA records; otherwise bytes go straight to the stream buffer. */
  const flushBlock = s => {
    const n = s.block.length; if (!n) return;
    s.pending.push(...(n <= 255 ? [TC.BLOCKDATA, n] : [TC.BLOCKDATALONG, ...int4(n)]), ...s.block); s.block = [];
  };
  const setBlockMode = (s, mode) => { if (s.blockMode === mode) return; flushBlock(s); s.blockMode = mode; };
  const emit = (s, bytes) => { if (s.blockMode) { for (const b of bytes) { s.block.push(b & 255); if (s.block.length >= BLOCK_MAX) flushBlock(s); } } else for (const b of bytes) s.pending.push(b & 255); };
  const raw = (s, bytes) => { for (const b of bytes) s.pending.push(b & 255); };
  const drain = (r, s) => {
    flushBlock(s); if (!s.pending.length) return;
    const bytes = s.pending; s.pending = []; vcall(r, s.sink, OUTPUT, 'write', ['[B', 'I', 'I'], 'V', [byteArray(r, bytes), 0, bytes.length]);
  };
  def(OOS, '<init>', `(${OUTPUT})V`, (r, _m, [self, sink]) => {
    if (sink === null) r.throwJava('Ljava/lang/NullPointerException;', 'out == null');
    const s = r.object(self).oos = { self, sink, blockMode: false, block: [], pending: [], handles: new Map(), nextHandle: 0, depth: 0, current: null, replacing: new Set() };
    raw(s, [...int2(MAGIC), ...int2(VERSION)]); drain(r, s); s.blockMode = true;   // writeStreamHeader, then setBlockDataMode(true)
  });
  const primitives = [['writeInt', 'I', v => int4(v | 0)], ['writeShort', 'I', v => int2(v & 0xffff)], ['writeChar', 'I', v => int2(v & 0xffff)], ['writeByte', 'I', v => [v & 255]], ['writeBoolean', 'Z', v => [v ? 1 : 0]],
    ['writeLong', 'J', long8], ['writeFloat', 'F', v => int4(v | 0)], ['writeDouble', 'D', long8], ['write', 'I', v => [v & 255]]];
  for (const [name, code, bytes] of primitives) def(OOS, name, `(${code})V`, (r, _m, [self, v]) => emit(outState(r, self), bytes(v)));
  def(OOS, 'write', '([B)V', (r, _m, [self, a]) => emit(outState(r, self), r.array(a).elements));
  def(OOS, 'write', '([BII)V', (r, _m, [self, a, o, l]) => { const e = r.array(a).elements; if (o < 0 || l < 0 || o + l > e.length) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', null); emit(outState(r, self), e.slice(o, o + l)); });
  def(OOS, 'writeBytes', `(${STRING})V`, (r, _m, [self, text]) => emit(outState(r, self), [...r.stringCharacters(text)].map(c => c.charCodeAt(0) & 255)));
  def(OOS, 'writeChars', `(${STRING})V`, (r, _m, [self, text]) => emit(outState(r, self), [...r.stringCharacters(text)].flatMap(c => int2(c.charCodeAt(0)))));
  def(OOS, 'writeUTF', `(${STRING})V`, (r, _m, [self, text]) => { const b = encodeUTF(r.stringCharacters(text)); if (b.length > 65535) r.throwJava('Ljava/io/UTFDataFormatException;', null); emit(outState(r, self), [...int2(b.length), ...b]); });
  def(OOS, 'flush', '()V', (r, _m, [self]) => { const s = outState(r, self); drain(r, s); vcall(r, s.sink, OUTPUT, 'flush', [], 'V'); });
  def(OOS, 'close', '()V', (r, _m, [self]) => { const s = outState(r, self); drain(r, s); vcall(r, s.sink, OUTPUT, 'close', [], 'V'); });
  def(OOS, 'reset', '()V', (r, _m, [self]) => { const s = outState(r, self); if (s.depth) r.throwJava('Ljava/io/IOException;', 'stream active'); flushBlock(s); raw(s, [TC.RESET]); s.handles.clear(); s.nextHandle = 0; drain(r, s); });
  def(OOS, 'defaultWriteObject', '()V', (r, _m, [self]) => { const s = outState(r, self); if (!s.current) r.throwJava(NOT_ACTIVE, 'not in call to writeObject'); setBlockMode(s, false); writeFields(r, s, s.current.ref, s.current.desc); setBlockMode(s, true); });
  def(OOS, 'writeObject', `(${OBJECT})V`, (r, _m, [self, value]) => topLevelWrite(r, outState(r, self), value));
  def(OOS, 'writeUnshared', `(${OBJECT})V`, (r, _m, [self, value]) => topLevelWrite(r, outState(r, self), value, true));
  function topLevelWrite(r, s, value, unshared = false) {
    const outer = s.blockMode; setBlockMode(s, false); s.depth++;
    try { writeObject0(r, s, value, unshared); } finally { s.depth--; setBlockMode(s, outer); if (!s.depth) drain(r, s); }
  }
  const handleKey = value => typeof value === 'object' && value !== null ? 'ref:' + value.ref : null;
  const share = (s, key) => { if (key !== null) s.handles.set(key, s.nextHandle); return BASE_HANDLE + s.nextHandle++; };
  const reference = (s, key) => { if (key !== null && s.handles.has(key)) { raw(s, [TC.REFERENCE, ...int4(BASE_HANDLE + s.handles.get(key))]); return true; } return false; };
  function writeString(s, text, key) {
    if (reference(s, key)) return; share(s, key);
    const b = encodeUTF(text); raw(s, b.length <= 65535 ? [TC.STRING, ...int2(b.length), ...b] : [TC.LONGSTRING, ...long8(b.length), ...b]);
  }
  function writeClassDesc(r, s, d) {
    if (d === null) { raw(s, [TC.NULL]); return; }
    if (reference(s, 'desc:' + d.type)) return;
    raw(s, [TC.CLASSDESC]); const name = encodeUTF(d.name); raw(s, [...int2(name.length), ...name, ...long8(d.suid)]);
    share(s, 'desc:' + d.type);
    raw(s, [d.flags, ...int2(d.fields.length)]);
    for (const f of d.fields) {
      raw(s, [f.code.charCodeAt(0)]); const n = encodeUTF(f.name); raw(s, [...int2(n.length), ...n]);
      if (!isPrimitive(f.type)) writeString(s, f.type, 'str:' + f.type);
    }
    raw(s, [TC.ENDBLOCKDATA]);
    writeClassDesc(r, s, d.superType ? describe(r, d.superType) : null);
  }
  const mapSize = (r, ref) => vcall(r, ref, 'Ljava/util/Map;', 'size', [], 'I');
  const collectionSize = (r, ref) => vcall(r, ref, 'Ljava/util/Collection;', 'size', [], 'I');
  const iterate = (r, collection, fn) => { const it = vcall(r, collection, 'Ljava/util/Collection;', 'iterator', [], 'Ljava/util/Iterator;'); while (vcall(r, it, 'Ljava/util/Iterator;', 'hasNext', [], 'Z')) fn(vcall(r, it, 'Ljava/util/Iterator;', 'next', [], OBJECT)); };
  const capacityFor = size => { let cap = 16; while (cap * 0.75 < size) cap *= 2; return cap; };
  function fieldValue(r, ref, d, f) {
    const o = r.object(ref);
    if (d.box) return o.boxed;
    if (d.collection) {
      const isMap = d.collection.kind === 'map';
      switch (f.name) {
        case 'size': return collectionSize(r, ref);
        case 'loadFactor': return floatBits(0.75);
        case 'threshold': return Math.floor(capacityFor(isMap ? mapSize(r, ref) : collectionSize(r, ref)) * 0.75);
        case 'accessOrder': return o.accessOrder ? 1 : 0;
        default: return 0;
      }
    }
    return o.fields.has(f.field.key) ? o.fields.get(f.field.key) : defaultValue(f.type);
  }
  /** defaultWriteFields: primitive field data, then the object fields, in ObjectStreamClass order. */
  function writeFields(r, s, ref, d) {
    const values = d.fields.map(f => fieldValue(r, ref, d, f));
    d.fields.forEach((f, i) => { if (isPrimitive(f.type)) raw(s, primitiveBytes(f.code, values[i])); });
    d.fields.forEach((f, i) => { if (!isPrimitive(f.type)) writeObject0(r, s, values[i], false); });
  }
  const writeBlockObject = (r, s, value) => { setBlockMode(s, false); try { writeObject0(r, s, value, false); } finally { setBlockMode(s, true); } };
  function writeCollectionContent(r, s, ref, level) {
    const c = level.collection;
    if (!c || !c.own) return;
    setBlockMode(s, true);
    if (c.kind === 'list' || c.kind === 'linked') { emit(s, int4(collectionSize(r, ref))); iterate(r, ref, e => writeBlockObject(r, s, e)); }
    else if (c.kind === 'map') {
      const size = mapSize(r, ref); emit(s, int4(capacityFor(size))); emit(s, int4(size));
      iterate(r, vcall(r, ref, 'Ljava/util/Map;', 'entrySet', [], 'Ljava/util/Set;'), entry => { writeBlockObject(r, s, vcall(r, entry, 'Ljava/util/Map$Entry;', 'getKey', [], OBJECT)); writeBlockObject(r, s, vcall(r, entry, 'Ljava/util/Map$Entry;', 'getValue', [], OBJECT)); });
    } else { const size = collectionSize(r, ref); emit(s, int4(capacityFor(size))); emit(s, int4(floatBits(0.75))); emit(s, int4(size)); iterate(r, ref, e => writeBlockObject(r, s, e)); }
    flushBlock(s); setBlockMode(s, false); raw(s, [TC.ENDBLOCKDATA]);
  }
  function writeClassData(r, s, ref, d) {
    for (const level of chainOf(r, d)) {
      if (level.external) {
        setBlockMode(s, true); vcall(r, ref, EXTERNALIZABLE, 'writeExternal', [OBJECT_OUTPUT], 'V', [s.self]); flushBlock(s); setBlockMode(s, false); raw(s, [TC.ENDBLOCKDATA]); continue;
      }
      const previous = s.current; s.current = { ref, desc: level };
      try {
        if (level.writeObject) {
          setBlockMode(s, true);
          r.dispatch({ owner: level.type, name: 'writeObject', parameters: [OOS], result: 'V', signature: `(${OOS})V` }, [ref, s.self], 'direct');
          flushBlock(s); setBlockMode(s, false); raw(s, [TC.ENDBLOCKDATA]);
        } else { setBlockMode(s, false); writeFields(r, s, ref, level); writeCollectionContent(r, s, ref, level); }
      } finally { s.current = previous; }
    }
  }
  function writeObject0(r, s, value, unshared) {
    for (;;) {
      if (value === null || value === 0) { raw(s, [TC.NULL]); return; }
      const isString = typeof value === 'string' || r.typeOf(value) === STRING;
      if (isString) { const text = r.stringCharacters(value); if (unshared) { share(s, null); const b = encodeUTF(text); raw(s, [TC.STRING, ...int2(b.length), ...b]); } else writeString(s, text, 'str:' + text); return; }
      const key = handleKey(value);
      if (!unshared && reference(s, key)) return;
      const o = r.object(value), t = o.type;
      if (o.classType !== undefined) { raw(s, [TC.CLASS]); writeClassDesc(r, s, describe(r, o.classType)); share(s, key); return; }
      const replace = t.startsWith('[') || BOX[t] || COLLECTIONS[t] ? null : inheritedHook(r, t, 'writeReplace', `()${OBJECT}`);
      if (replace && !s.replacing.has(key)) {
        s.replacing.add(key);
        const replacement = r.dispatch({ owner: replace.method.owner, name: 'writeReplace', parameters: [], result: OBJECT, signature: `()${OBJECT}` }, [value], 'virtual');
        if (replacement !== value && !(replacement && replacement.ref === value.ref)) { value = replacement; continue; }
      }
      if (t.startsWith('[')) { writeArray(r, s, value, o, key); return; }
      if (BOX[t]) { raw(s, [TC.OBJECT]); writeClassDesc(r, s, describe(r, t)); share(s, key); raw(s, primitiveBytes(BOX[t][1], o.boxed)); return; }
      const enumType = isEnumClass(r, t) ? t : isEnumClass(r, r.parent(t)) ? r.parent(t) : null;
      if (enumType) {
        raw(s, [TC.ENUM]); writeClassDesc(r, s, describe(r, enumType)); share(s, key); const name = r.stringCharacters(o.enumName); writeString(s, name, 'str:' + name); return;
      }
      if (!isSerializable(r, t) && !COLLECTIONS[t]) r.throwJava(NOT_SERIALIZABLE, dotted(t));
      const d = describe(r, t);
      raw(s, [TC.OBJECT]); writeClassDesc(r, s, d); share(s, key);
      writeClassData(r, s, value, d); return;
    }
  }
  function writeArray(r, s, ref, o, key) {
    raw(s, [TC.ARRAY]); writeClassDesc(r, s, describe(r, o.type)); share(s, key);
    raw(s, int4(o.elements.length));
    const code = o.type[1];
    if (code === 'L' || code === '[') for (const e of o.elements) writeObject0(r, s, e, false);
    else for (const v of o.elements) raw(s, primitiveBytes(code, v));
  }

  // ============================================================ ObjectInputStream ============================================================
  const inState = (r, ref) => r.object(ref).ois ?? r.throwJava('Ljava/io/IOException;', 'ObjectInputStream used before construction');
  const eof = r => r.throwJava('Ljava/io/EOFException;', null);
  /** Reads exactly n bytes from the source (no read-ahead beyond one peeked byte, as java.io.PeekInputStream). */
  function sourceBytes(r, s, n) {
    const out = [];
    if (s.peeked !== -1 && n > 0) { out.push(s.peeked); s.peeked = -1; }
    while (out.length < n) {
      const want = n - out.length, array = r.newArray('[B', want), got = vcall(r, s.source, INPUT, 'read', ['[B', 'I', 'I'], 'I', [array, 0, want]);
      if (got < 0) eof(r);
      const e = r.array(array).elements; for (let i = 0; i < got; i++) out.push(e[i] & 255);
    }
    return out;
  }
  const peekByte = (r, s) => { if (s.peeked === -1) { const v = vcall(r, s.source, INPUT, 'read', [], 'I'); if (v < 0) return -1; s.peeked = v; } return s.peeked; };
  const rawByte = (r, s) => sourceBytes(r, s, 1)[0];
  const rawInt = (r, s) => primitiveValue('I', sourceBytes(r, s, 4));
  /** Refills the block-data window: reads the next TC_BLOCKDATA header; false at the end of the custom data (an object tag or TC_ENDBLOCKDATA follows). */
  function refill(r, s) {
    while (s.blockLeft === 0) {
      if (s.blockEnd) return false;
      const tag = peekByte(r, s);
      if (tag === -1) { s.blockEnd = true; return false; }
      if (tag === TC.BLOCKDATA) { s.peeked = -1; s.blockLeft = rawByte(r, s); }
      else if (tag === TC.BLOCKDATALONG) { s.peeked = -1; s.blockLeft = rawInt(r, s); }
      else if (tag === TC.RESET) { s.peeked = -1; s.handles = []; }
      else { s.blockEnd = true; return false; }
    }
    return true;
  }
  function dataBytes(r, s, n) {
    if (!s.blockMode) return sourceBytes(r, s, n);
    const out = [];
    while (out.length < n) { if (!refill(r, s)) eof(r); const take = Math.min(s.blockLeft, n - out.length); out.push(...sourceBytes(r, s, take)); s.blockLeft -= take; }
    return out;
  }
  const setReadBlockMode = (r, s, mode) => {
    if (s.blockMode === mode) return;
    if (mode) { s.blockLeft = 0; s.blockEnd = false; } else if (s.blockLeft > 0) r.throwJava(OPTIONAL_DATA, null);
    s.blockMode = mode;
  };
  def(OIS, '<init>', `(${INPUT})V`, (r, _m, [self, source]) => {
    if (source === null) r.throwJava('Ljava/lang/NullPointerException;', 'in == null');
    const s = r.object(self).ois = { self, source, peeked: -1, blockMode: false, blockLeft: 0, blockEnd: false, handles: [], depth: 0, current: null, descs: [] };
    const magic = primitiveValue('I', sourceBytes(r, s, 4)) >>> 0;
    if (magic >>> 16 !== MAGIC || (magic & 0xffff) !== VERSION) r.throwJava(CORRUPTED, `invalid stream header: ${magic.toString(16).toUpperCase().padStart(8, '0')}`);
    s.blockMode = true;
  });
  for (const [name, code, result] of [['readInt', 'I', 'I'], ['readShort', 'S', 'S'], ['readChar', 'C', 'C'], ['readByte', 'B', 'B'], ['readBoolean', 'Z', 'Z'], ['readLong', 'J', 'J'], ['readFloat', 'F', 'F'], ['readDouble', 'D', 'D']])
    def(OIS, name, `()${result}`, (r, _m, [self]) => primitiveValue(code, dataBytes(r, inState(r, self), primitiveSize(code))));
  def(OIS, 'readUnsignedByte', '()I', (r, _m, [self]) => dataBytes(r, inState(r, self), 1)[0]);
  def(OIS, 'readUnsignedShort', '()I', (r, _m, [self]) => primitiveValue('C', dataBytes(r, inState(r, self), 2)));
  def(OIS, 'readUTF', `()${STRING}`, (r, _m, [self]) => { const s = inState(r, self), n = primitiveValue('C', dataBytes(r, s, 2)); return decodeUTF(dataBytes(r, s, n)); });
  def(OIS, 'readFully', '([B)V', (r, _m, [self, a]) => { const e = r.array(a).elements; e.splice(0, e.length, ...dataBytes(r, inState(r, self), e.length).map(byteOf)); });
  def(OIS, 'readFully', '([BII)V', (r, _m, [self, a, o, l]) => { const e = r.array(a).elements; if (o < 0 || l < 0 || o + l > e.length) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', null); dataBytes(r, inState(r, self), l).forEach((b, i) => { e[o + i] = byteOf(b); }); });
  const readSome = (r, self, a, o, l) => {
    const s = inState(r, self), e = r.array(a).elements; if (l === 0) return 0;
    if (o < 0 || l < 0 || o + l > e.length) r.throwJava('Ljava/lang/IndexOutOfBoundsException;', null);
    if (s.blockMode) { if (!refill(r, s)) return -1; const n = Math.min(l, s.blockLeft); sourceBytes(r, s, n).forEach((b, i) => { e[o + i] = byteOf(b); }); s.blockLeft -= n; return n; }
    if (s.peeked !== -1) { e[o] = byteOf(s.peeked); s.peeked = -1; return 1; }
    const buffer = r.newArray('[B', l), got = vcall(r, s.source, INPUT, 'read', ['[B', 'I', 'I'], 'I', [buffer, 0, l]);
    if (got > 0) r.array(buffer).elements.slice(0, got).forEach((b, i) => { e[o + i] = b; });
    return got;
  };
  def(OIS, 'read', '()I', (r, _m, [self]) => { const s = inState(r, self); if (s.blockMode) { if (!refill(r, s)) return -1; s.blockLeft--; return rawByte(r, s); } const v = peekByte(r, s); s.peeked = -1; return v; });
  def(OIS, 'read', '([B)I', (r, _m, [self, a]) => readSome(r, self, a, 0, r.array(a).elements.length));
  def(OIS, 'read', '([BII)I', (r, _m, [self, a, o, l]) => readSome(r, self, a, o, l));
  def(OIS, 'available', '()I', (r, _m, [self]) => { const s = inState(r, self); return s.blockMode ? (refill(r, s) ? s.blockLeft : 0) : 0; });
  def(OIS, 'skipBytes', '(I)I', (r, _m, [self, n]) => { const s = inState(r, self); let skipped = 0; while (skipped < n) { if (s.blockMode && !refill(r, s)) break; const take = s.blockMode ? Math.min(s.blockLeft, n - skipped) : n - skipped; try { dataBytes(r, s, take); } catch { break; } skipped += take; } return skipped; });
  def(OIS, 'close', '()V', (r, _m, [self]) => { vcall(r, inState(r, self).source, INPUT, 'close', [], 'V'); });
  def(OIS, 'readObject', `()${OBJECT}`, (r, _m, [self]) => topLevelRead(r, inState(r, self), false));
  def(OIS, 'readUnshared', `()${OBJECT}`, (r, _m, [self]) => topLevelRead(r, inState(r, self), true));
  def(OIS, 'defaultReadObject', '()V', (r, _m, [self]) => {
    const s = inState(r, self); if (!s.current) r.throwJava(NOT_ACTIVE, 'not in call to readObject');
    setReadBlockMode(r, s, false); readFields(r, s, s.current.ref, s.current.slot); setReadBlockMode(r, s, true);
  });
  function topLevelRead(r, s, unshared) {
    const outer = s.blockMode; setReadBlockMode(r, s, false); s.depth++;
    try { return readObject0(r, s, unshared); } finally { s.depth--; setReadBlockMode(r, s, outer); }
  }
  function readUTFRaw(r, s) { const n = primitiveValue('C', sourceBytes(r, s, 2)); return decodeUTF(sourceBytes(r, s, n)); }
  function readLongUTFRaw(r, s) { const n = Number(primitiveValue('J', sourceBytes(r, s, 8))); return decodeUTF(sourceBytes(r, s, n)); }
  const resolveType = (r, name) => {
    const t = name.startsWith('[') ? name.replaceAll('.', '/') : `L${name.replaceAll('.', '/')};`;
    if (t.startsWith('[')) return t;
    if (r.classes.has(t) || BOX[t] || COLLECTIONS[t] || t === NUMBER || t === ENUM) return t;
    r.throwJava('Ljava/lang/ClassNotFoundException;', name);
  };
  /** TC_CLASSDESC / TC_NULL / TC_REFERENCE -> { name, suid, flags, fields, superDesc, type }. */
  function readClassDesc(r, s) {
    const tag = rawByte(r, s);
    if (tag === TC.NULL) return null;
    if (tag === TC.REFERENCE) return handleAt(r, s, rawInt(r, s));
    if (tag === TC.PROXYCLASSDESC) throw unsupported('java.lang.reflect.Proxy', 'proxy class descriptors');
    if (tag !== TC.CLASSDESC) r.throwJava(CORRUPTED, `invalid type code: ${tag.toString(16).toUpperCase().padStart(2, '0')}`);
    const d = { name: readUTFRaw(r, s), suid: primitiveValue('J', sourceBytes(r, s, 8)), fields: [], superDesc: null, type: null };
    s.handles.push(d);
    d.flags = rawByte(r, s);
    const count = primitiveValue('C', sourceBytes(r, s, 2));
    for (let i = 0; i < count; i++) {
      const code = String.fromCharCode(rawByte(r, s)), name = readUTFRaw(r, s);
      let fieldType = code;
      if (code === 'L' || code === '[') { const signature = readObject0(r, s, false); fieldType = typeof signature === 'string' ? signature : r.stringCharacters(signature); }
      d.fields.push({ name, code, type: fieldType });
    }
    for (let tagSkip = rawByte(r, s); tagSkip !== TC.ENDBLOCKDATA; tagSkip = rawByte(r, s)) { s.peeked = tagSkip; readObject0(r, s, false); }   // class annotations
    d.superDesc = readClassDesc(r, s);
    try { d.type = resolveType(r, d.name); } catch (error) { d.unresolved = error; }
    if (d.type && !d.type.startsWith('[')) {
      const local = describe(r, d.type);
      if (local.suid !== d.suid && !local.enum && !local.enumBase) r.throwJava(INVALID_CLASS, `${d.name}; local class incompatible: stream classdesc serialVersionUID = ${d.suid}, local class serialVersionUID = ${local.suid}`);
    }
    return d;
  }
  const handleAt = (r, s, handle) => {
    const index = handle - BASE_HANDLE; if (index < 0 || index >= s.handles.length) r.throwJava(CORRUPTED, `invalid handle value: ${handle.toString(16).toUpperCase().padStart(8, '0')}`);
    return s.handles[index];
  };
  function assignHandle(s, value) { const index = s.handles.length; s.handles.push(value); return index; }
  function readObject0(r, s, unshared) {
    const tag = peekByte(r, s);
    if (tag === -1) eof(r);
    s.peeked = -1;
    switch (tag) {
      case TC.NULL: return null;
      case TC.REFERENCE: { const v = handleAt(r, s, rawInt(r, s)); return v; }
      case TC.STRING: { const text = readUTFRaw(r, s); assignHandle(s, text); return text; }
      case TC.LONGSTRING: { const text = readLongUTFRaw(r, s); assignHandle(s, text); return text; }
      case TC.CLASS: { const d = readClassDesc(r, s); if (!d.type) throw d.unresolved; const ref = r.classObject(d.type); assignHandle(s, ref); return ref; }
      case TC.ARRAY: return readArray(r, s);
      case TC.ENUM: return readEnum(r, s);
      case TC.OBJECT: return readOrdinaryObject(r, s);
      case TC.RESET: s.handles = []; return readObject0(r, s, unshared);
      case TC.BLOCKDATA: case TC.BLOCKDATALONG: case TC.ENDBLOCKDATA: s.peeked = tag; r.throwJava(OPTIONAL_DATA, null); break;   // primitive data (or the end of it) where an object was expected
      case TC.EXCEPTION: throw unsupported('a TC_EXCEPTION record', 'exception objects written after a failed writeObject');
      default: r.throwJava(CORRUPTED, `invalid type code: ${tag.toString(16).toUpperCase().padStart(2, '0')}`);
    }
  }
  function readArray(r, s) {
    const d = readClassDesc(r, s); if (!d.type) throw d.unresolved;
    const length = rawInt(r, s); if (length < 0) r.throwJava('Ljava/lang/NegativeArraySizeException;', `${length}`);
    const ref = r.newArray(d.type, length); assignHandle(s, ref);
    const code = d.type[1], elements = r.array(ref).elements;
    for (let i = 0; i < length; i++) elements[i] = code === 'L' || code === '[' ? readObject0(r, s, false) : primitiveValue(code, sourceBytes(r, s, primitiveSize(code)));
    return ref;
  }
  function readEnum(r, s) {
    const d = readClassDesc(r, s); if (!d.type) throw d.unresolved;
    const index = assignHandle(s, null), name = readObject0(r, s, false);
    const value = r.dispatch({ owner: ENUM, name: 'valueOf', parameters: ['Ljava/lang/Class;', STRING], result: ENUM, signature: `(Ljava/lang/Class;${STRING})${ENUM}` }, [r.classObject(d.type), name], 'static');
    s.handles[index] = value; return value;
  }
  /** Maps the stream's descriptor chain onto the local class chain; the instance is built the way ObjectStreamClass.newInstance does (first non-serializable superclass constructor). */
  function readOrdinaryObject(r, s) {
    const desc = readClassDesc(r, s); if (!desc.type) throw desc.unresolved;
    const t = desc.type, handleIndex = s.handles.length;
    if (BOX[t]) { s.handles.push(null); const [, prim] = BOX[t]; for (let d = desc; d; d = d.superDesc) for (const f of d.fields) if (f.name === 'value') { const v = primitiveValue(prim, sourceBytes(r, s, primitiveSize(prim))); const ref = r.boxPrimitive(prim, v); s.handles[handleIndex] = ref; return ref; } throw new APKError(`Malformed ${desc.name} stream`); }
    let ref;
    if (COLLECTIONS[t]) { ref = r.allocate(t); r.dispatch({ owner: t, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [ref], 'direct'); }
    else {
      if (!isSerializable(r, t) && !desc.flags) r.throwJava(INVALID_CLASS, `${desc.name}; class invalid for deserialization`);
      ref = r.allocate(t);
      let base = t; while (base && base !== OBJECT && isSerializable(r, base)) base = r.parent(base);
      if (base && base !== OBJECT) { const ctor = hook(r, base, '<init>', '()V'); if (!ctor || (ctor.flags & 0x2)) r.throwJava(INVALID_CLASS, `${desc.name}; no valid constructor`); r.dispatch({ owner: base, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [ref], 'direct'); }
    }
    s.handles.push(ref);
    const chain = []; for (let d = desc; d; d = d.superDesc) chain.unshift(d);
    for (const slot of chain) {
      const external = (slot.flags & SC.EXTERNALIZABLE) !== 0;
      if (external) { setReadBlockMode(r, s, true); vcall(r, ref, EXTERNALIZABLE, 'readExternal', [OBJECT_INPUT], 'V', [s.self]); skipCustomData(r, s); setReadBlockMode(r, s, false); continue; }
      const local = slot.type ? describe(r, slot.type) : null, previous = s.current; s.current = { ref, slot };
      try {
        if (local?.readObject && (slot.flags & SC.SERIALIZABLE)) {
          setReadBlockMode(r, s, true);
          r.dispatch({ owner: slot.type, name: 'readObject', parameters: [OIS], result: 'V', signature: `(${OIS})V` }, [ref, s.self], 'direct');
          skipCustomData(r, s); setReadBlockMode(r, s, false);
        } else {
          setReadBlockMode(r, s, false); readFields(r, s, ref, slot);
          if (local?.collection) readCollectionContent(r, s, ref, local, slot);
          else if (slot.flags & SC.WRITE_METHOD) { setReadBlockMode(r, s, true); skipCustomData(r, s); setReadBlockMode(r, s, false); }
        }
      } finally { s.current = previous; }
    }
    const resolve = inheritedHook(r, t, 'readResolve', `()${OBJECT}`);
    if (resolve) { const resolved = r.dispatch({ owner: resolve.method.owner, name: 'readResolve', parameters: [], result: OBJECT, signature: `()${OBJECT}` }, [ref], 'virtual'); s.handles[handleIndex] = resolved; return resolved; }
    return ref;
  }
  /** defaultReadFields: values for the stream's fields of one class level, stored into the matching local fields (unknown ones are read and kept in slot.values). */
  function readFields(r, s, ref, slot) {
    const local = slot.type ? describe(r, slot.type) : null, o = r.object(ref);
    slot.values = {};
    const assign = (f, v) => {
      slot.values[f.name] = v;
      const target = local?.fields.find(x => x.name === f.name);
      if (!target?.field) return;
      if (isPrimitive(f.type) !== isPrimitive(target.type) || (isPrimitive(f.type) && f.type !== target.type)) r.throwJava(INVALID_CLASS, `${slot.name}; incompatible types for field ${f.name}`);
      r.storeField(o.fields, target.field.key, v);
    };
    for (const f of slot.fields.filter(f => isPrimitive(f.type))) assign(f, primitiveValue(f.code, sourceBytes(r, s, primitiveSize(f.code))));
    for (const f of slot.fields.filter(f => !isPrimitive(f.type))) assign(f, readObject0(r, s, false));
  }
  function skipCustomData(r, s) {
    for (;;) {
      if (s.blockMode) { if (s.blockLeft > 0) { sourceBytes(r, s, s.blockLeft); s.blockLeft = 0; } if (refill(r, s)) continue; }
      const tag = peekByte(r, s);
      if (tag === TC.ENDBLOCKDATA) { s.peeked = -1; s.blockEnd = false; return; }
      if (tag === -1) eof(r);
      const was = s.blockMode; s.blockMode = false;
      try { readObject0(r, s, false); } finally { s.blockMode = was; if (was) { s.blockEnd = false; s.blockLeft = 0; } }
    }
  }
  /** The custom data of java.util collections (ArrayList/LinkedList/HashMap/HashSet.readObject) after their default fields. */
  function readCollectionContent(r, s, ref, local, slot) {
    const c = local.collection;
    if (!c.own) { if (slot.values.accessOrder) r.object(ref).accessOrder = true; return; }
    setReadBlockMode(r, s, true);
    const readInt = () => primitiveValue('I', dataBytes(r, s, 4)), element = () => { setReadBlockMode(r, s, false); try { return readObject0(r, s, false); } finally { setReadBlockMode(r, s, true); } };
    const add = value => vcall(r, ref, 'Ljava/util/Collection;', 'add', [OBJECT], 'Z', [value]);
    if (c.kind === 'list') { readInt(); for (let i = 0, n = slot.values.size; i < n; i++) add(element()); }
    else if (c.kind === 'linked') { for (let i = 0, n = readInt(); i < n; i++) add(element()); }
    else if (c.kind === 'map') { readInt(); for (let i = 0, n = readInt(); i < n; i++) { const key = element(), value = element(); vcall(r, ref, 'Ljava/util/Map;', 'put', [OBJECT, OBJECT], OBJECT, [key, value]); } }
    else { readInt(); readInt(); for (let i = 0, n = readInt(); i < n; i++) add(element()); }
    skipCustomData(r, s); setReadBlockMode(r, s, false);
  }
  return { ...registry, interfaces: registry.interfacesOf };
}
