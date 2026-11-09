/**
 * Shaped field storage of Java objects (docs/INTERACTION-PERFORMANCE.md item 4, docs/MEMORY-ON-DEMAND.md front B).
 *
 * Every instantiated class has a Shape: the keys ("Lowner;->name:Type") of its instance fields, inherited ones first (the superclass's shape is a prefix of every subclass's), so a
 * declared field has the same slot index in every class that inherits it. An ObjectRecord keeps its field values in `slots` (a plain Array, one entry per key of its shape; `undefined`
 * means "never stored", read as the type's default value, exactly as an absent Map entry was), and keys outside its shape (host code storing a field of a host-modelled class the
 * DEX does not declare) in `fieldExtra`, a Map created on first use.
 *
 * `record.fields` is a Map-compatible facade over both (get/set/has/delete/clear/size/keys/values/entries/forEach/iteration), so host code that reads or writes fields by key works
 * unchanged. The interpreter, the compiled code and the collector use the slots directly; the slot of a field reference is resolved once per call site (interpreter.js fieldSiteAt).
 *
 * Reference stores into fields go through: the interpreter's iput family (interpreter.js), the compiled iput (baseline-compiler.js), APKRuntime.storeSlot (a first store into a slot)
 * and APKRuntime.storeField / FieldMap.set (host code, reflection, Unsafe, atomic updaters). A write barrier belongs on those paths.
 */
export const REFERENT_KEY = 'Ljava/lang/ref/Reference;->referent:Ljava/lang/Object;';
/** The slots of a shape without fields (shared: nothing is ever stored in them). */
export const EMPTY_SLOTS = Object.freeze([]);

export class Shape {
  /** `parent`: the superclass's shape (null for a root); `own`: the keys of the instance fields the class itself declares, in declaration order. */
  constructor(parent, own) {
    const keys = parent === null ? own.slice() : parent.keys.concat(own);
    this.keys = keys; this.size = keys.length;
    this.index = parent === null ? new Map() : new Map(parent.index);
    for (let i = parent === null ? 0 : parent.size; i < keys.length; i++) if (!this.index.has(keys[i])) this.index.set(keys[i], i);
    this.template = keys.length === 0 ? EMPTY_SLOTS : new Array(keys.length).fill(undefined);
    const referent = this.index.get(REFERENT_KEY); this.referentSlot = referent === undefined ? -1 : referent;
  }
  /** The slot of `key`, or -1 when the key is not a field of this shape. */
  slotOf(key) { const slot = this.index.get(key); return slot === undefined ? -1 : slot; }
}
export const EMPTY_SHAPE = new Shape(null, []);

/** The record of a Java object (not an array: ArrayRecord). Its own properties are the id, the class, the field storage and whatever host state a host attaches. */
export class ObjectRecord {
  constructor(id, type, shape) {
    this.id = id; this.type = type; this.fieldShape = shape; this.slots = shape.size === 0 ? EMPTY_SLOTS : shape.template.slice(); this.fieldExtra = null;
  }
  /** The fields as a Map-compatible view (a new small facade per read; host code only). */
  get fields() { return new FieldMap(this); }
  /** Replaces every field with the entries of `entries` (a Map or an iterable of [key, value]). */
  set fields(entries) {
    const shape = this.fieldShape; this.slots = shape.size === 0 ? EMPTY_SLOTS : shape.template.slice(); this.fieldExtra = null;
    if (entries != null) { const view = new FieldMap(this); for (const [key, value] of entries) view.set(key, value); }
  }
}

// The View host state every record used to carry as own properties (docs/MEMORY-ON-DEMAND.md front C): defaults on the prototype (non-enumerable, so the collector's walk of a record
// never sees them), an own property once a host writes one. `children` is an Array created on first read or write, so a host can push into it as before.
for (const [name, value] of [['text', ''], ['orientation', 0], ['textSize', 20], ['listener', null]]) Object.defineProperty(ObjectRecord.prototype, name, { value, writable: true, enumerable: false, configurable: true });
const ownChildren = (record, value) => { Object.defineProperty(record, 'children', { value, writable: true, enumerable: true, configurable: true }); return value; };
Object.defineProperty(ObjectRecord.prototype, 'children', { get() { return ownChildren(this, []); }, set(value) { ownChildren(this, value); }, enumerable: false, configurable: true });

/** Number of stored fields of a record (the field-storage budget counts these, as it counted Map entries). */
export function storedFieldCount(record) {
  const slots = record.slots;
  if (slots === undefined) return record.fields?.size ?? 0;
  let n = 0; for (let i = 0; i < slots.length; i++) if (slots[i] !== undefined) n++;
  const extra = record.fieldExtra; return extra == null ? n : n + extra.size;
}

/** Map-compatible view of an ObjectRecord's fields. Iteration lists the stored slots in layout order (inherited fields first), then the extra keys in insertion order. */
export class FieldMap {
  constructor(record) { this.record = record; }
  get size() { return storedFieldCount(this.record); }
  get(key) {
    const r = this.record, slot = r.fieldShape.index.get(key);
    if (slot !== undefined) return r.slots[slot];
    const extra = r.fieldExtra; return extra === null ? undefined : extra.get(key);
  }
  has(key) {
    const r = this.record, slot = r.fieldShape.index.get(key);
    if (slot !== undefined) return r.slots[slot] !== undefined;
    const extra = r.fieldExtra; return extra !== null && extra.has(key);
  }
  set(key, value) {
    const r = this.record, slot = r.fieldShape.index.get(key);
    if (slot !== undefined) r.slots[slot] = value; else (r.fieldExtra ??= new Map()).set(key, value);
    return this;
  }
  delete(key) {
    const r = this.record, slot = r.fieldShape.index.get(key);
    if (slot !== undefined) { const had = r.slots[slot] !== undefined; r.slots[slot] = undefined; return had; }
    const extra = r.fieldExtra; return extra !== null && extra.delete(key);
  }
  clear() { const r = this.record; if (r.slots.length) r.slots.fill(undefined); r.fieldExtra = null; }
  *entries() {
    const r = this.record, keys = r.fieldShape.keys, slots = r.slots;
    for (let i = 0; i < keys.length; i++) { const value = slots[i]; if (value !== undefined) yield [keys[i], value]; }
    if (r.fieldExtra !== null) yield* r.fieldExtra.entries();
  }
  *keys() { for (const [key] of this.entries()) yield key; }
  *values() { for (const [, value] of this.entries()) yield value; }
  forEach(callback, thisArg) { for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this); }
  [Symbol.iterator]() { return this.entries(); }
  get [Symbol.toStringTag]() { return 'Map'; }
}
