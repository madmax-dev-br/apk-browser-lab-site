// The handle table (docs/WASM-CORE-PLANO.md, decision 3): inside the core a reference is an address; an object gets an id only when it crosses into JavaScript, and hosts keep
// holding `{ ref: id }` as they do today. Ids are never reused (a host that kept a stale id gets a miss, never another object); `{ ref }` objects are cached per id so a crossing
// allocates nothing after the first one; `release(address)` is what the collector's sweep calls for a dead object (one call per freed address that has an id).
//
// An address that is freed and later reused by a new object is a different object: it gets a fresh id, because release() forgot the old pairing.

/**
 * A Map-like table keyed by id (a positive integer, never reused): chunks of 4096 slots, a chunk dropped when its last entry goes, as the JavaScript VM's own heap is indexed by
 * id. A lookup is two array loads instead of a hash lookup -- the hot path of every host call that touches a record (its address, its facade) by id.
 */
const CHUNK_SHIFT = 12, CHUNK_MASK = (1 << CHUNK_SHIFT) - 1;
export class IdTable {
  constructor() { this.chunks = []; this.live = []; this.size = 0; }
  get(id) { const chunk = this.chunks[id >>> CHUNK_SHIFT]; return chunk === undefined ? undefined : chunk[id & CHUNK_MASK]; }
  has(id) { return this.get(id) !== undefined; }
  set(id, value) {
    const ci = id >>> CHUNK_SHIFT; let chunk = this.chunks[ci];
    if (chunk === undefined) { while (this.chunks.length < ci) { this.chunks.push(undefined); this.live.push(0); } chunk = this.chunks[ci] = new Array(1 << CHUNK_SHIFT).fill(undefined); this.live[ci] = 0; }
    if (chunk[id & CHUNK_MASK] === undefined) { this.size++; this.live[ci]++; }
    chunk[id & CHUNK_MASK] = value; return this;
  }
  delete(id) {
    const ci = id >>> CHUNK_SHIFT, chunk = this.chunks[ci]; if (chunk === undefined || chunk[id & CHUNK_MASK] === undefined) return false;
    chunk[id & CHUNK_MASK] = undefined; this.size--; if (--this.live[ci] === 0) this.chunks[ci] = undefined;
    return true;
  }
  *entries() { for (let ci = 0; ci < this.chunks.length; ci++) { const chunk = this.chunks[ci]; if (chunk !== undefined) for (let i = 0; i < chunk.length; i++) if (chunk[i] !== undefined) yield [(ci << CHUNK_SHIFT) | i, chunk[i]]; } }
  *keys() { for (const [id] of this.entries()) yield id; }
  *values() { for (const [, value] of this.entries()) yield value; }
  [Symbol.iterator]() { return this.entries(); }
}

export class HandleTable {
  constructor() {
    this.nextId = 1;                  // 0 is never an id
    this.idByAddress = new Map();     // address -> id
    this.addressById = new IdTable(); // id -> address (absent once released)
    this.handleByAddress = new Map(); // address -> the one frozen { ref: id } handed out for it (one lookup on the hot path)
    this.released = 0;
  }
  /** The id of the object at `address`, allocating one on its first crossing. 0 (null) has no id. */
  idOf(address) {
    if (address === 0) return 0;
    let id = this.idByAddress.get(address);
    if (id === undefined) { id = this.nextId++; this.idByAddress.set(address, id); this.addressById.set(id, address); }
    return id;
  }
  /** The `{ ref: id }` object for the object at `address` (the same object every time), or null for address 0. */
  handleOf(address) {
    if (address === 0) return null;
    let handle = this.handleByAddress.get(address);
    if (handle === undefined) { handle = Object.freeze({ ref: this.idOf(address) }); this.handleByAddress.set(address, handle); }
    return handle;
  }
  /** The address behind an id, or 0 when the id was never issued or was released. */
  addressOf(id) { return this.addressById.get(id) ?? 0; }
  /** The address behind a handle (`{ ref }`) or a bare id; null and 0 are address 0. A released or unknown id throws: a stale host reference is a bug to report, not an object to guess. */
  resolve(handle) {
    if (handle === null || handle === 0 || handle === undefined) return 0;
    const id = typeof handle === 'object' ? handle.ref : handle, address = this.addressById.get(id);
    if (address === undefined) throw new Error(`vmcore handle table: ${id < this.nextId ? 'the object of reference ' + id + ' was freed' : 'no object has reference ' + id}`);
    return address;
  }
  /** True when `address` currently has an id. */
  has(address) { return this.idByAddress.has(address); }
  /** The object at `address` was freed: forget its id (never reissued) and its handle. Returns the id it had, or 0. */
  release(address) {
    const id = this.idByAddress.get(address);
    if (id === undefined) return 0;
    this.idByAddress.delete(address); this.addressById.delete(id); this.handleByAddress.delete(address); this.released++;
    return id;
  }
  /** Ids currently live. */
  get size() { return this.addressById.size; }
}
