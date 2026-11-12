// What `runtime.object(ref)` returns for an object that lives in linear memory (docs/WASM-CORE-PLANO.md, decision 2). Hosts keep using records as they do today --
// `record.type`, `record.fields.get/set/has(key)`, `record.cells`, arbitrary own properties -- and the facade reads and writes the memory through a per-class layout descriptor.
//
// Value model at the boundary (the same as src/object-shapes.js and src/apk-runtime.js hold in registers and slots):
//   int, boolean (0/1), byte (sign-extended), short (sign-extended), char (unsigned 16 bits)   JavaScript numbers
//   long                                                                                       BigInt (signed 64 bits)
//   float                                                                                      the IEEE-754 bit pattern as an int number (floatNumber/floatBits convert)
//   double                                                                                     the IEEE-754 bit pattern as a BigInt (doubleNumber/doubleBits convert)
//   reference                                                                                  `{ ref: id }` (a handle of the table, cached per id) or null
//   a reference to a java.lang.String                                                          a JavaScript string (decision 4: StringCache below converts and caches)
//
// Differences from ObjectRecord/FieldMap, by construction: memory has no "never stored" state, so every field of the layout always exists -- `has(key)` is true for each layout key,
// `get(key)` answers the type's default (0, 0n, null) before a store, and iteration, `size` and `clear()` cover the whole layout. Keys outside the layout live in an extra Map on the
// facade, as `fieldExtra` does today. Host state hung on the record (any own property) lives on the facade object itself, the JavaScript companion of the memory record: the facade is
// cached per id, so the same properties are seen across reads, and it is dropped when the object is freed (RecordSpace.release).
import { cellsClassOf, NO_FIELDS } from '../../runtime/java-arrays.js?v=999f1f5703aa';
import { HandleTable, IdTable } from './handles.js?v=999f1f5703aa';
import { stringText, writeStringUnits } from './strings.js?v=999f1f5703aa';

// Field kinds: the descriptor letters of a field type (Z B S C I J F D), L for a reference.
const KIND = { Z: 0, B: 1, S: 2, C: 3, I: 4, F: 5, J: 6, D: 7, L: 8 };
const KIND_LETTER = ['Z', 'B', 'S', 'C', 'I', 'F', 'J', 'D', 'L'];
const ELEMENT_SHIFT = { Z: 0, B: 0, S: 1, C: 1, I: 2, F: 2, J: 3, D: 3, L: 2 };
const ARRAY_LENGTH = 8, ARRAY_DATA = 16;
const fail = message => { throw new Error(`vmcore record facade: ${message}`); };

/** The kind letter of a field type descriptor ('I' -> 'I', 'Ljava/lang/String;' -> 'L', '[I' -> 'L'). */
export const kindOfType = type => type[0] === 'L' || type[0] === '[' ? 'L' : type[0];

/** Layout of one class: `fields` is the list of { key, offset, type } (type: a JVM descriptor, or just the kind letter); an array class has no fields and a `type` of '[X'. */
class ClassLayout {
  constructor(type, fields) {
    this.type = type; this.fields = []; this.index = new Map();
    for (const { key, offset, type: fieldType } of fields) {
      const kind = kindOfType(fieldType), code = KIND[kind];
      if (code === undefined) fail(`field ${key} has the unsupported type ${fieldType}`);
      if (kind === 'J' || kind === 'D' ? offset % 8 : offset % (1 << ELEMENT_SHIFT[kind])) fail(`field ${key} is misaligned at offset ${offset}`);
      const descriptor = { key, offset, kind: code, letter: kind };
      this.fields.push(descriptor); this.index.set(key, descriptor);
    }
    this.element = type[0] === '[' ? type[1] === '[' ? 'L' : type[1] : null;   // an array class: the element kind letter
    this.onCreate = null;   // optional (facade) => void: host state every record of this class carries from its first facade on (the engine's java.lang.Class objects: classType)
    this.facadeClass = null;   // optional ObjectFacade subclass for the records of this class (the engine's box classes: `boxed` over the payload)
  }
}

/**
 * Java strings at the boundary (vmcore/js/strings.js, vmcore/strings.h): a String record decodes to a JavaScript string and a JavaScript string encodes to a new String record, and
 * both directions are cached per record address, since strings are immutable. An address is reused by the next record once its String is freed, so a cache entry must die with
 * its record: every record that enters the cache is exported to the collector (`exportRecord`, gc_export), whose sweep reports it freed, and RecordSpace.release forgets it.
 * Encoding allocates with `allocate(length)` (vm_string_new: header and length written; 0 = no room) and writes the units; the text -> address side lets a host that hands the
 * same text back again reuse the record (the JavaScript VM cannot tell two equal strings apart either), and dies with the record too. `decode(space, address)` reads the units
 * (stringText: the real layout). Until `bind` is called (by whoever instantiated the core) only decoding works, without exports.
 */
export class StringCache {
  constructor(space, decode = stringText) {
    this.space = space; this.decode = decode; this.cache = new Map(); this.byText = new Map(); this.hits = 0; this.misses = 0; this.encoded = 0;
    this.classAddress = 0; this.allocate = null; this.exportRecord = null;
  }
  /** `classAddress`: the String Class record (a number, or a function answering it once the linker laid it out); `allocate(length)` -> address; `exportRecord(address)`. */
  bind({ classAddress = 0, allocate = null, exportRecord = null } = {}) { this.classAddressOf = typeof classAddress === 'function' ? classAddress : () => classAddress; this.allocate = allocate; this.exportRecord = exportRecord; return this; }
  /** Is the record at `address` a String (its class word is the String class). */
  isString(address) {
    if (address === 0) return false;
    const klass = this.classAddress || (this.classAddress = this.classAddressOf?.() ?? 0);
    return klass !== 0 && this.space.fresh().u32[address >>> 2] === klass;
  }
  get(address) {
    if (address === 0) return null;
    const hit = this.cache.get(address);
    if (hit !== undefined) { this.hits++; return hit; }
    this.misses++; const text = this.decode(this.space.fresh(), address); this.cache.set(address, text);
    if (this.exportRecord !== null) this.exportRecord(address);
    return text;
  }
  /** The address of a String record holding `text`: a cached one, else a new record (exported). Throws when the heap has no room. */
  encode(text) {
    if (text === null || text === undefined) return 0;
    const known = this.byText.get(text); if (known !== undefined) { this.hits++; return known; }
    if (this.allocate === null) throw new Error('vmcore string boundary: no allocator bound (StringCache.bind)');
    if (!this.classAddress && !(this.classAddress = this.classAddressOf?.() ?? 0)) throw new Error('vmcore string boundary: the String class is not laid out');   // the record's class word is written by the allocator
    const address = this.allocate(text.length) >>> 0;
    if (address === 0) throw new Error(`vmcore string boundary: no room on the heap for a string of ${text.length} units`);
    writeStringUnits(this.space.fresh(), address, text);
    this.encoded++; this.cache.set(address, text); this.byText.set(text, address);
    if (this.exportRecord !== null) this.exportRecord(address);
    return address;
  }
  /** A NEW String record holding `text` (never a cached one: a constructed String is a new object, `new String(s) != s`), cached by address. Throws when the heap has no room. */
  encodeNew(text) {
    if (this.allocate === null) throw new Error('vmcore string boundary: no allocator bound (StringCache.bind)');
    if (!this.classAddress && !(this.classAddress = this.classAddressOf?.() ?? 0)) throw new Error('vmcore string boundary: the String class is not laid out');
    const address = this.allocate(text.length) >>> 0;
    if (address === 0) throw new Error(`vmcore string boundary: no room on the heap for a string of ${text.length} units`);
    writeStringUnits(this.space.fresh(), address, text);
    this.encoded++; this.cache.set(address, text);
    if (this.exportRecord !== null) this.exportRecord(address);
    return address;
  }
  release(address) {
    const text = this.cache.get(address);
    if (text !== undefined) { this.cache.delete(address); if (this.byText.get(text) === address) this.byText.delete(text); }
  }
}
export class RecordSpace {
  /** `memory`: the WebAssembly.Memory of the core; `autoRebind`: detect growth on every access (see fresh()); `handles`: the table shared with whoever else turns addresses into ids; `onReferenceStore(objectAddress, targetAddress)`: called after every
   *  reference store the host makes (the collector's write barrier / remembered set belongs there). */
  constructor(memory, { handles = new HandleTable(), onReferenceStore = null, autoRebind = false } = {}) {
    this.autoRebind = autoRebind; this.memory = memory; this.handles = handles; this.onReferenceStore = onReferenceStore;
    this.layouts = new Map();      // Class record address -> ClassLayout
    this.facades = new IdTable();  // id -> facade (ephemeral companions)
    this.strings = new StringCache(this);
    this.buffer = null; this.rebind();
  }
  /** Re-creates the typed-array views after the memory grew. Call it from whatever grows the memory, or construct the space with `autoRebind: true`. */
  rebind() {
    const buffer = this.buffer = this.memory.buffer;
    this.i8 = new Int8Array(buffer); this.u8 = new Uint8Array(buffer); this.i16 = new Int16Array(buffer); this.u16 = new Uint16Array(buffer);
    this.i32 = new Int32Array(buffer); this.u32 = new Uint32Array(buffer); this.i64 = new BigInt64Array(buffer);
  }
  /** Declares the layout of the class whose Class record is at `classAddress`. */
  registerClass(classAddress, { type, fields = [] }) {
    const layout = new ClassLayout(type, fields); this.layouts.set(classAddress, layout); return layout;
  }
  /** The facade of the object at `address` (null for 0). The same object for the same address while the object lives. */
  objectAt(address) {
    if (address === 0) return null;
    this.fresh();
    const id = this.handles.idOf(address);
    let facade = this.facades.get(id);
    if (facade === undefined) {
      const klass = this.u32[address >> 2], layout = this.layouts.get(klass);
      if (layout === undefined) fail(`the object at ${address} has class record ${klass}, which has no registered layout`);
      facade = layout.element !== null ? new ArrayFacade(this, id, address, layout) : layout.facadeClass !== null ? new layout.facadeClass(this, id, address, layout) : new ObjectFacade(this, id, address, layout);
      this.facades.set(id, facade);
      if (layout.onCreate !== null) layout.onCreate(facade);
    }
    return facade;
  }
  /** The facade of the object with id `id` (it has one already, or its address gets one), or undefined for an id that names no live object. */
  objectById(id) {
    const known = this.facades.get(id); if (known !== undefined) return known;
    const address = this.handles.addressById.get(id); return address === undefined ? undefined : this.objectAt(address);
  }
  /** `runtime.object(ref)`: the facade of the object a `{ ref }` handle (or a bare id) names. */
  object(ref) { return this.objectAt(this.handles.resolve(ref)); }
  /** The handle for the object at `address`. */
  handleOf(address) { return this.handles.handleOf(address); }
  /** A reference word as the hosts see it: null, a JavaScript string for a String record (decision 4), a `{ ref }` handle otherwise. */
  refValue(address) { return address === 0 ? null : this.strings.isString(address) ? this.strings.get(address) : this.handles.handleOf(address); }
  /** The reference word of a host value: 0 for null, a String record for a JavaScript string (encoded, cached), the address behind a handle otherwise. */
  refWord(value) { return typeof value === 'string' ? this.strings.encode(value) : this.handles.resolve(value); }
  /** The object at `address` was freed: its id, handle and facade (with every host property on it) go away. */
  release(address) {
    this.strings.release(address); const id = this.handles.release(address);
    if (id !== 0) {
      const facade = this.facades.get(id);   // a host's native resource dies with the Java object that owned it (NativeAllocationRegistry cleaners: record.onFree, as src/heap-gc.js runs them)
      if (facade !== undefined && typeof facade.onFree === 'function') { try { facade.onFree(); } catch { /* the native resource is already gone */ } }
      this.facades.delete(id);
    }
    return id;
  }

  read(address, code) {
    switch (code) {
      case 0: return this.u8[address] === 0 ? 0 : 1;
      case 1: return this.i8[address];
      case 2: return this.i16[address >> 1];
      case 3: return this.u16[address >> 1];
      case 4: case 5: return this.i32[address >> 2];
      case 6: case 7: return this.i64[address >> 3];
      default: return this.refValue(this.u32[address >> 2]);
    }
  }
  write(owner, address, code, value) {
    switch (code) {
      case 0: this.u8[address] = value ? 1 : 0; return;
      case 1: this.i8[address] = value; return;
      case 2: this.i16[address >> 1] = value; return;
      case 3: this.u16[address >> 1] = value; return;
      case 4: case 5:
        if (typeof value !== 'number') fail(`an ${KIND_LETTER[code] === 'F' ? 'float' : 'int'} field takes a number (its value or bit pattern), not ${typeof value}`);
        this.i32[address >> 2] = value; return;
      case 6: case 7:
        if (typeof value === 'number' && Number.isInteger(value)) value = BigInt(value);
        else if (typeof value !== 'bigint') fail(`a ${code === 6 ? 'long' : 'double'} field takes a BigInt (its value or bit pattern), not ${typeof value}`);
        this.i64[address >> 3] = value; return;
      default: {
        const target = this.refWord(value);
        this.u32[address >> 2] = target;
        if (this.onReferenceStore !== null) this.onReferenceStore(owner, target);
      }
    }
  }
  /** The space with its views current. With `autoRebind` it compares the memory's buffer on every access (about 7 ns in V8, more than the access itself); without it, whoever grows the
   *  memory (the heap-grow import of the core) calls rebind(). */
  fresh() { if (this.autoRebind && this.buffer !== this.memory.buffer) this.rebind(); return this; }
}

/** `record.fields` of a facade: the Map interface over the layout's memory and the extra keys. */
export class FacadeFieldMap {
  constructor(record) { this.record = record; }
  get size() { const r = this.record; return r.layout.fields.length + (r.fieldExtra === null ? 0 : r.fieldExtra.size); }
  get(key) {
    const r = this.record, f = r.layout.index.get(key);
    if (f !== undefined) return r.space.fresh().read(r.address + f.offset, f.kind);
    const extra = r.fieldExtra; return extra === null ? undefined : extra.get(key);
  }
  has(key) { const r = this.record; return r.layout.index.has(key) || (r.fieldExtra !== null && r.fieldExtra.has(key)); }
  set(key, value) {
    const r = this.record, f = r.layout.index.get(key);
    if (f !== undefined) r.space.fresh().write(r.address, r.address + f.offset, f.kind, value); else (r.fieldExtra ??= new Map()).set(key, value);
    return this;
  }
  /** A layout key goes back to its default (memory cannot be absent); returns whether the key existed. */
  delete(key) {
    const r = this.record, f = r.layout.index.get(key);
    if (f !== undefined) { r.space.fresh().write(r.address, r.address + f.offset, f.kind, f.kind === 8 ? null : f.kind === 6 || f.kind === 7 ? 0n : 0); return true; }
    const extra = r.fieldExtra; return extra !== null && extra.delete(key);
  }
  clear() { for (const f of this.record.layout.fields) this.delete(f.key); this.record.fieldExtra = null; }
  *entries() {
    const r = this.record, space = r.space;
    for (const f of r.layout.fields) yield [f.key, space.fresh().read(r.address + f.offset, f.kind)];
    if (r.fieldExtra !== null) yield* r.fieldExtra.entries();
  }
  *keys() { for (const [key] of this.entries()) yield key; }
  *values() { for (const [, value] of this.entries()) yield value; }
  forEach(callback, thisArg) { for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this); }
  [Symbol.iterator]() { return this.entries(); }
  get [Symbol.toStringTag]() { return 'Map'; }
}

/** An object (not an array) in linear memory. Own properties a host adds stay on this object. */
// The facade's own machinery (space, address, layout, the extra-field map, the cached FacadeFieldMap) is held in private fields behind prototype accessors: invisible to every
// enumeration (the collector's companion walk, for-in, Object.keys), as non-enumerable properties were, but a facade is made as fast as a plain object (Object.defineProperties
// cost about half a microsecond per facade, and every record a host touches the first time gets one: each boxed Integer, each StringBuilder).
export class ObjectFacade {
  #space; #address; #layout; #fieldExtra = null; #fieldMap = null;
  constructor(space, id, address, layout) {
    this.#space = space; this.#address = address; this.#layout = layout;
    this.id = id; this.type = layout.type;
  }
  get space() { return this.#space; }
  get address() { return this.#address; }
  get layout() { return this.#layout; }
  get fieldExtra() { return this.#fieldExtra; }
  set fieldExtra(map) { this.#fieldExtra = map; }
  get fieldMap() { return this.#fieldMap; }
  set fieldMap(map) { this.#fieldMap = map; }
  get fields() { return this.fieldMap ??= new FacadeFieldMap(this); }
  /** Replaces every field with the entries of `entries` (a Map or an iterable of [key, value]). */
  set fields(entries) {
    const view = this.fields; view.clear();
    if (entries != null) for (const [key, value] of entries) view.set(key, value);
  }
}

// The host state the JavaScript VM's ObjectRecord carries by default (src/object-shapes.js: defaults on the prototype, an own property once a host writes one; `children` an Array
// made on first read or write), so hosts that read a View record's `text` or push into its `children` find the same on a facade.
const ownChildren = (record, value) => { Object.defineProperty(record, 'children', { value, writable: true, enumerable: true, configurable: true }); return value; };
Object.defineProperty(ObjectFacade.prototype, 'children', { get() { return ownChildren(this, []); }, set(value) { ownChildren(this, value); }, enumerable: false, configurable: true });
for (const [name, value] of [['text', ''], ['orientation', 0], ['textSize', 20], ['listener', null]]) Object.defineProperty(ObjectFacade.prototype, name, { value, writable: true, enumerable: false, configurable: true });

// Reference arrays: an array-like over the memory. Indexing, length, iteration and the generic Array methods work; map/filter/slice answer plain Arrays (as typed arrays do).
class RefCells {}
for (const name of ['forEach', 'map', 'filter', 'some', 'every', 'reduce', 'reduceRight', 'find', 'findIndex', 'findLast', 'findLastIndex', 'indexOf', 'lastIndexOf', 'includes', 'join', 'slice', 'at', 'entries', 'keys', 'values', Symbol.iterator, 'fill'])
  Object.defineProperty(RefCells.prototype, name, { value: Array.prototype[name], writable: true, configurable: true, enumerable: false });
const SPACE = Symbol('space'), ADDRESS = Symbol('address');
const isIndex = key => typeof key === 'string' && key.length > 0 && key.length < 11 && key.charCodeAt(0) >= 48 && key.charCodeAt(0) <= 57 && String(+key) === key;
const refLength = target => target[SPACE].fresh().u32[(target[ADDRESS] + ARRAY_LENGTH) >> 2];
const refCellsHandler = {
  get(target, key, receiver) {
    if (typeof key === 'string') {
      const c = key.charCodeAt(0);
      if (c >= 48 && c <= 57) { if (!isIndex(key)) return undefined; const i = +key; return i < refLength(target) ? target[SPACE].read(target[ADDRESS] + ARRAY_DATA + 4 * i, 8) : undefined; }
      if (key === 'length') return refLength(target);
    }
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    if (isIndex(key)) {
      const i = +key, n = refLength(target); if (i >= n) fail(`a Java array has a fixed length: index ${i} of ${n} elements`);
      target[SPACE].write(target[ADDRESS], target[ADDRESS] + ARRAY_DATA + 4 * i, 8, value); return true;
    }
    if (key === 'length') fail('a Java array has a fixed length');
    return Reflect.set(target, key, value, receiver);
  },
  has(target, key) { return key === 'length' || (isIndex(key) ? +key < refLength(target) : Reflect.has(target, key)); },
  ownKeys(target) { const keys = []; for (let i = refLength(target); i-- > 0;) keys.unshift(String(i)); keys.push('length'); return keys.concat(Reflect.ownKeys(target)); },
  getOwnPropertyDescriptor(target, key) {
    if (isIndex(key)) { const i = +key; return i < refLength(target) ? { value: target[SPACE].read(target[ADDRESS] + ARRAY_DATA + 4 * i, 8), writable: true, enumerable: true, configurable: true } : undefined; }
    if (key === 'length') return { value: refLength(target), writable: true, enumerable: false, configurable: true };
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
  defineProperty() { fail('a Java array has fixed elements: defineProperty is not available'); },
  deleteProperty(target, key) { if (isIndex(key) || key === 'length') fail('a Java array has fixed elements: delete is not available'); return Reflect.deleteProperty(target, key); },
};
export function referenceCells(space, address) {
  const target = new RefCells(); Object.defineProperty(target, SPACE, { value: space }); Object.defineProperty(target, ADDRESS, { value: address });
  return new Proxy(target, refCellsHandler);
}

/** An array in linear memory. `cells` is a typed-array view (the lab's ByteCells ... LongCells classes) for a primitive array, a reference array-like otherwise. */
export class ArrayFacade {
  #space; #address; #layout; #view = null;   // private, as ObjectFacade's
  constructor(space, id, address, layout) {
    this.#space = space; this.#address = address; this.#layout = layout;
    this.id = id; this.type = layout.type; this.fields = NO_FIELDS;
  }
  get space() { return this.#space; }
  get address() { return this.#address; }
  get layout() { return this.#layout; }
  get view() { return this.#view; }
  set view(cells) { this.#view = cells; }
  get length() { return this.space.fresh().u32[(this.address + ARRAY_LENGTH) >> 2]; }
  get cells() {
    let view = this.view; const space = this.space;
    if (view === null) {
      const klass = cellsClassOf(this.type);
      view = this.view = klass === null ? referenceCells(space, this.address) : new klass(space.fresh().buffer, this.address + ARRAY_DATA, this.length);
    } else if (view.buffer !== undefined && view.buffer !== space.fresh().buffer) {   // the memory grew: a typed-array view is bound to the old buffer
      view = this.view = new (cellsClassOf(this.type))(space.buffer, this.address + ARRAY_DATA, this.length);
    }
    return view;
  }
  get elements() { return this.cells; }
  /** Copies `values` into the array; its length cannot change. */
  set elements(values) {
    const cells = this.cells, n = this.length;
    if (values.length !== n) fail(`a Java array has a fixed length: ${n} elements cannot take ${values.length}`);
    for (let i = 0; i < n; i++) cells[i] = values[i];
  }
}
