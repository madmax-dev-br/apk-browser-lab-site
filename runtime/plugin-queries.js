// Read-only queries of the page's plugins (src/plugin-host.js, docs/PLUGINS.md), answered in the VM Worker between two VM events. Everything here READS the heap records
// that the interpreter keeps (`runtime.heap`, each record's `fields` map keyed "Lowner;->name:Type", array `cells`, boxed `boxed`, String `stringValue`) and the class
// declarations of the DEX files; it never dispatches a Java method, never allocates a VM object, never initializes a class and never writes a field. So a query cannot create
// state the app would see (a lazily created ViewModelStore, a SavedStateHandle, a flow collector), cannot run app or library code and cannot touch a protected native
// (src/protected-native.js): it sees what the objects already hold, exactly as a heap dump would. It runs in the Worker: no DOM, no process.*.
//
// Handles. An object is named by an opaque handle "h<id>" (the record id). Holding a handle is not a root: the collector frees the object when the app drops it, ids are never
// reused (runtime.nextId only grows), and a freed id answers the error code 'collected' ("objeto coletado"). Nothing is kept between queries.
//
// What the reader knows about the libraries it walks (all through their own fields, found by type when a field name differs between versions):
//   androidx.activity ComponentActivity: the ViewModelStore field (`_viewModelStore` / `mViewModelStore`); androidx.lifecycle ViewModelStore: its Map; androidx.fragment
//   FragmentActivity -> FragmentController -> FragmentHostCallback -> FragmentManager -> FragmentStore.mAdded (the fragments on the screen), FragmentManager.mNonConfig
//   (FragmentManagerViewModel.mViewModelStores by Fragment.mWho), Fragment.mChildFragmentManager; any ViewModel whose Map field holds ViewModelStores (Navigation's per
//   destination stores). Values: libcore collections and maps (ArrayList, Arrays$ArrayList, LinkedList, ArrayDeque, HashMap / LinkedHashMap / HashSet, TreeMap,
//   ConcurrentHashMap, the Collections wrappers), androidx ArrayMap / SimpleArrayMap, Kotlin's empty collections and ArrayDeque, Compose's persistent vectors, and the
//   observable holders shown as their current value: kotlinx StateFlowImpl (`_state`), androidx LiveData (`mData`, `mVersion`), Compose snapshot state (the newest valid
//   StateRecord of `next`: SnapshotMutableState, the Int/Long/Float/Double states, SnapshotStateList), and the java.util.concurrent atomics.
import { isFreedId } from './heap-gc.js?v=96c9de77f557';

export const QUERY_LIMITS = { depth: 2, maxDepth: 6, maxFields: 200, maxFieldsLimit: 2000, maxItems: 20, maxItemsLimit: 500, maxString: 1000, maxStringLimit: 20000, maxNodes: 4000, budgetMs: 25 };
const VIEW_MODEL_STORE = 'Landroidx/lifecycle/ViewModelStore;', VIEW_MODEL = 'Landroidx/lifecycle/ViewModel;';
const FRAGMENT = 'Landroidx/fragment/app/Fragment;', FRAGMENT_MANAGER = 'Landroidx/fragment/app/FragmentManager;', FRAGMENT_CONTROLLER = 'Landroidx/fragment/app/FragmentController;';
const FRAGMENT_HOST = 'Landroidx/fragment/app/FragmentHostCallback;', FRAGMENT_STORE = 'Landroidx/fragment/app/FragmentStore;', FRAGMENT_NON_CONFIG = 'Landroidx/fragment/app/FragmentManagerViewModel;';
const STATE_RECORD = 'Landroidx/compose/runtime/snapshots/StateRecord;', STATE_OBJECT = 'Landroidx/compose/runtime/snapshots/StateObject;', SNAPSHOT_LIST = 'Landroidx/compose/runtime/snapshots/SnapshotStateList;';
const STATE_FLOW = 'Lkotlinx/coroutines/flow/StateFlowImpl;', LIVE_DATA = 'Landroidx/lifecycle/LiveData;', SYMBOL = 'Lkotlinx/coroutines/internal/Symbol;';
const MAP = 'Ljava/util/Map;', COLLECTION = 'Ljava/util/Collection;', OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', ENUM = 'Ljava/lang/Enum;';

/** A query failure the plugin sees as `error.code` (src/plugin-runtime.js turns it into an Error). */
export class PluginQueryError extends Error { constructor(code, message) { super(message); this.name = 'PluginQueryError'; this.code = code; } }
// A handle carries the epoch of its VM: ids restart in every new VM, so a handle kept across an APK reload must not name an unrelated object of the new one.
const epochs = new WeakMap();
export const handleEpoch = runtime => { let epoch = epochs.get(runtime); if (!epoch) { epoch = (Math.floor(Math.random() * 0x7fffffff) || 1).toString(36); epochs.set(runtime, epoch); } return epoch; };
export const handleOf = (runtime, id) => `h${id}.${handleEpoch(runtime)}`;
export function parseHandle(runtime, handle) {
  const match = /^h([1-9]\d{0,15})\.([0-9a-z]{1,8})$/.exec(String(handle ?? '')); if (!match) throw new PluginQueryError('bad-handle', `Handle inválido: ${String(handle).slice(0, 40)}`);
  if (match[2] !== handleEpoch(runtime)) throw new PluginQueryError('collected', `objeto coletado: ${String(handle)} é de uma execução anterior da VM`);
  return Number(match[1]);
}
export const dotted = type => String(type ?? '').replace(/^L|;$/g, '').replaceAll('/', '.');
/** 'Ljava/util/HashMap$Node;' -> 'java.util.HashMap$Node', '[I' -> 'int[]', '[Ljava/lang/String;' -> 'java.lang.String[]'. */
export function typeName(type) {
  let t = String(type ?? ''), dims = 0; while (t[dims] === '[') dims++;
  const base = t.slice(dims), primitive = { Z: 'boolean', B: 'byte', C: 'char', S: 'short', I: 'int', J: 'long', F: 'float', D: 'double', V: 'void' }[base];
  return (primitive ?? dotted(base)) + '[]'.repeat(dims);
}
const floats = new DataView(new ArrayBuffer(8));
const decodeFloat = bits => { floats.setInt32(0, Number(bits) | 0, true); return floats.getFloat32(0, true); };
const decodeDouble = bits => { floats.setBigInt64(0, BigInt.asIntN(64, BigInt(bits)), true); return floats.getFloat64(0, true); };
const longValue = value => { const big = BigInt.asIntN(64, BigInt(value ?? 0)); return big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : String(big); };
const jsonNumber = n => Number.isFinite(n) ? n : String(n);   // NaN / Infinity are not JSON
/** A field value of declared primitive type `type` -> its JSON value. */
export function primitiveValue(type, value) {
  switch (type) {
    case 'Z': return !!value;
    case 'B': case 'S': case 'I': return Number(value ?? 0) | 0;
    case 'C': return String.fromCharCode(Number(value ?? 0) & 0xffff);
    case 'F': return jsonNumber(decodeFloat(value ?? 0));
    case 'D': return jsonNumber(decodeDouble(value ?? 0n));
    case 'J': return longValue(value);
    default: return null;
  }
}
const isRef = value => value !== null && typeof value === 'object' && typeof value.ref === 'number';
const parseKey = key => { const arrow = key.indexOf('->'), colon = key.indexOf(':', arrow + 2); return { owner: key.slice(0, arrow), name: key.slice(arrow + 2, colon), type: key.slice(colon + 1) }; };

/** The reader over one runtime. `deadline` (performance.now() ms) bounds a whole query; past it the values not read yet are marked `$truncated`. */
export function createHeapReader(runtime, { now = () => performance.now() } = {}) {
  const declaredCache = runtime.pluginFieldCache ??= new Map();   // type -> the instance fields it declares and inherits (most derived first); immutable class data
  const record = id => runtime.heap.get(id);
  const typeOfValue = value => typeof value === 'string' ? STRING : isRef(value) ? record(value.ref)?.type ?? null : null;
  const subtype = (type, ancestor) => { if (!type) return false; try { return type === ancestor || runtime.isSubtype(type, ancestor); } catch { return false; } };
  function declared(type) {
    let list = declaredCache.get(type); if (list) return list;
    list = []; const seen = new Set(); let owner = type;
    for (let guard = 0; owner && guard < 64 && !seen.has(owner); guard++) {
      seen.add(owner); let cls = null; try { cls = runtime.classes?.get?.(owner) ?? null; } catch { cls = null; }
      if (cls?.fields && cls.dex) for (const entry of cls.fields) { try { const field = cls.dex.field(entry.index); list.push({ key: field.key, owner: field.owner, name: field.name, type: field.type }); } catch { /* unreadable declaration */ } }
      try { owner = runtime.parent(owner); } catch { owner = null; }
      if (owner === OBJECT) break;
    }
    if (declaredCache.size < 20000) declaredCache.set(type, list);
    return list;
  }
  /** The instance fields of a record: declared ones (with their default when never written) and any other key the host stored. [{ key, owner, name, type, value }] */
  function fields(rec) {
    if (!rec || rec.cells !== undefined) return [];
    const list = declared(rec.type), out = [], known = new Set();
    for (const field of list) { known.add(field.key); out.push({ ...field, value: rec.fields?.has(field.key) ? rec.fields.get(field.key) : undefined }); }
    if (rec.fields) for (const [key, value] of rec.fields) if (!known.has(key) && key.includes('->')) out.push({ key, ...parseKey(key), value });
    return out;
  }
  const field = (rec, name) => fields(rec).find(entry => entry.name === name) ?? null;
  const fieldValue = (rec, name) => { const entry = field(rec, name); return entry ? entry.value : undefined; };
  const refOf = value => isRef(value) ? value : null;
  /** The first field whose declared type is `type` (or a subtype), or whose value is an instance of it. */
  function fieldOfType(rec, type, { not = null } = {}) {
    for (const entry of fields(rec)) {
      const value = refOf(entry.value); if (!value || (not && value.ref === not)) continue;
      if (entry.type === type || subtype(entry.type, type) || subtype(record(value.ref)?.type, type)) return value;
    }
    return null;
  }
  const stringOf = value => {
    if (typeof value === 'string') return value;
    const rec = isRef(value) ? record(value.ref) : null; if (!rec) return null;
    if (rec.type === STRING) return typeof rec.stringValue === 'string' ? rec.stringValue : null;
    if (rec.builder !== undefined && (rec.type === 'Ljava/lang/StringBuilder;' || rec.type === 'Ljava/lang/StringBuffer;')) return String(rec.builder);
    return null;
  };
  const intField = (rec, name) => { const value = fieldValue(rec, name); return value === undefined || value === null ? 0 : Number(value) | 0; };
  const cellsOf = value => { const rec = isRef(value) ? record(value.ref) : null; return rec?.cells !== undefined ? rec.cells : null; };
  const firstFieldOfArray = rec => { for (const entry of fields(rec)) if (entry.type.startsWith('[') && cellsOf(entry.value)) return cellsOf(entry.value); return null; };

  // ---- collections and maps, through the libcore / library fields -------------------------------------------------------------------------------------------------
  /** { kind: 'list' | 'set', size, items (at most `limit` raw values) } or null when the object is not a collection the reader knows. */
  function sequence(rec, limit, depthGuard = 0) {
    const type = rec.type, take = (items, size) => ({ size, items: items.slice(0, limit) });
    if (depthGuard > 8) return null;
    if (type === 'Ljava/util/ArrayList;' || type === 'Ljava/util/Vector;' || type === 'Ljava/util/Stack;') { const cells = cellsOf(fieldValue(rec, 'elementData')) ?? [], size = intField(rec, type === 'Ljava/util/ArrayList;' ? 'size' : 'elementCount'); return { kind: 'list', ...take(Array.from(cells.slice(0, Math.min(size, limit))), size) }; }
    if (type === 'Ljava/util/Arrays$ArrayList;') { const cells = cellsOf(fieldValue(rec, 'a')) ?? []; return { kind: 'list', ...take(Array.from(cells.slice(0, limit)), cells.length) }; }
    if (type === 'Ljava/util/Collections$SingletonList;' || type === 'Ljava/util/Collections$SingletonSet;') return { kind: type.endsWith('Set;') ? 'set' : 'list', size: 1, items: [fieldValue(rec, 'element')] };
    if (/^Ljava\/util\/Collections\$Empty(List|Set);$|^Lkotlin\/collections\/Empty(List|Set);$/.test(type)) return { kind: type.includes('Set') ? 'set' : 'list', size: 0, items: [] };
    if (/^Ljava\/util\/Collections\$(Unmodifiable|Synchronized|Checked)(Random)?(Access)?(List|Collection|Set|SortedSet|NavigableSet)?;$/.test(type)) { const inner = refOf(fieldValue(rec, 'c')); const innerRec = inner && record(inner.ref); return innerRec ? sequence(innerRec, limit, depthGuard + 1) : null; }
    if (type === 'Ljava/util/LinkedList;') {
      const items = [], size = intField(rec, 'size'); let node = refOf(fieldValue(rec, 'first'));
      for (let guard = 0; node && items.length < limit && guard < 100000; guard++) { const n = record(node.ref); if (!n) break; items.push(fieldValue(n, 'item')); node = refOf(fieldValue(n, 'next')); }
      return { kind: 'list', size, items };
    }
    if (type === 'Ljava/util/ArrayDeque;') {
      const cells = cellsOf(fieldValue(rec, 'elements')) ?? [], head = intField(rec, 'head'), tail = intField(rec, 'tail'), n = cells.length, size = n ? (tail - head + n) % n : 0, items = [];
      for (let i = 0; i < Math.min(size, limit); i++) items.push(cells[(head + i) % n]);
      return { kind: 'list', size, items };
    }
    if (type === 'Lkotlin/collections/ArrayDeque;') {
      const cells = cellsOf(fieldValue(rec, 'elementData')) ?? [], head = intField(rec, 'head'), size = intField(rec, 'size'), n = cells.length, items = [];
      for (let i = 0; n && i < Math.min(size, limit); i++) items.push(cells[(head + i) % n]);
      return { kind: 'list', size, items };
    }
    if (type === 'Ljava/util/concurrent/CopyOnWriteArrayList;' || type === 'Ljava/util/concurrent/CopyOnWriteArraySet;') {
      if (type.endsWith('Set;')) { const inner = refOf(fieldValue(rec, 'al')); const innerRec = inner && record(inner.ref); const result = innerRec ? sequence(innerRec, limit, depthGuard + 1) : null; return result ? { ...result, kind: 'set' } : null; }
      const cells = firstFieldOfArray(rec) ?? []; return { kind: 'list', ...take(Array.from(cells.slice(0, limit)), cells.length) };
    }
    if (subtype(type, 'Ljava/util/HashSet;') || type === 'Ljava/util/TreeSet;') {
      const inner = refOf(fieldValue(rec, 'map') ?? fieldValue(rec, 'm')); const innerRec = inner && record(inner.ref); const result = innerRec ? mapEntries(innerRec, limit, depthGuard + 1) : null;
      return result ? { kind: 'set', size: result.size, items: result.entries.map(([key]) => key) } : null;
    }
    if (type.startsWith('Landroidx/compose/runtime/external/kotlinx/collections/immutable/implementations/immutableList/')) {
      if (type.endsWith('/SmallPersistentVector;')) { const cells = cellsOf(fieldValue(rec, 'buffer')) ?? []; return { kind: 'list', ...take(Array.from(cells.slice(0, limit)), cells.length) }; }
      if (type.endsWith('/PersistentVector;')) {
        const size = intField(rec, 'size'), shift = intField(rec, 'rootShift'), tail = cellsOf(fieldValue(rec, 'tail')) ?? [], items = [], rootSize = size - tail.length;
        const walk = (node, level) => { const cells = cellsOf(node) ?? []; for (const cell of cells) { if (items.length >= Math.min(limit, rootSize)) return; if (level > 0) walk(cell, level - 5); else items.push(cell); } };
        walk(fieldValue(rec, 'root'), shift); for (const cell of tail) { if (items.length >= limit) break; items.push(cell); }
        return { kind: 'list', size, items: items.slice(0, limit) };
      }
    }
    if (type === SNAPSHOT_LIST || subtype(type, SNAPSHOT_LIST)) {
      const current = newestRecord(rec); const list = current ? refOf(fieldValue(current, 'list')) : null; const listRec = list && record(list.ref);
      return listRec ? sequence(listRec, limit, depthGuard + 1) : { kind: 'list', size: 0, items: [] };
    }
    return null;
  }
  /** { size, entries: [[key, value], ...] (at most `limit`) } or null when the object is not a map the reader knows. */
  function mapEntries(rec, limit, depthGuard = 0) {
    const type = rec.type; if (depthGuard > 8) return null;
    if (type === 'Ljava/util/HashMap;' || type === 'Ljava/util/LinkedHashMap;' || subtype(type, 'Ljava/util/HashMap;')) {
      const size = intField(rec, 'size'), entries = [], linked = subtype(type, 'Ljava/util/LinkedHashMap;');
      if (linked) { let node = refOf(fieldValue(rec, 'head')); for (let guard = 0; node && entries.length < limit && guard < 100000; guard++) { const n = record(node.ref); if (!n) break; entries.push([fieldValue(n, 'key'), fieldValue(n, 'value')]); node = refOf(fieldValue(n, 'after')); } }
      else {
        const table = cellsOf(fieldValue(rec, 'table')) ?? [];
        for (const head of table) { let node = refOf(head); for (let guard = 0; node && entries.length < limit && guard < 100000; guard++) { const n = record(node.ref); if (!n) break; if (n.type === 'Ljava/util/HashMap$TreeNode;' && guard === 0) { /* a treeified bin keeps `next` order too */ } entries.push([fieldValue(n, 'key'), fieldValue(n, 'value')]); node = refOf(fieldValue(n, 'next')); } if (entries.length >= limit) break; }
      }
      return { size, entries };
    }
    if (type === 'Ljava/util/concurrent/ConcurrentHashMap;') {
      const table = cellsOf(fieldValue(rec, 'table')) ?? [], entries = []; let size = 0;
      const base = fieldValue(rec, 'baseCount'); size = Number(base ?? 0);
      for (const head of table) { let node = refOf(head); for (let guard = 0; node && entries.length < limit && guard < 100000; guard++) { const n = record(node.ref); if (!n) break; const key = fieldValue(n, 'key'); if (key !== undefined && key !== null && key !== 0) entries.push([key, fieldValue(n, 'val')]); node = refOf(fieldValue(n, 'next')); } if (entries.length >= limit) break; }
      return { size: Math.max(size, entries.length), entries };
    }
    if (type === 'Ljava/util/TreeMap;') {
      const size = intField(rec, 'size'), entries = [], stack = []; let node = refOf(fieldValue(rec, 'root'));
      for (let guard = 0; (node || stack.length) && entries.length < limit && guard < 200000; guard++) {
        if (node) { const n = record(node.ref); if (!n) break; stack.push(n); node = refOf(fieldValue(n, 'left')); continue; }
        const n = stack.pop(); entries.push([fieldValue(n, 'key'), fieldValue(n, 'value')]); node = refOf(fieldValue(n, 'right'));
      }
      return { size, entries };
    }
    if (/^Ljava\/util\/Collections\$(Unmodifiable|Synchronized|Checked)(Sorted|Navigable)?Map;$/.test(type)) { const inner = refOf(fieldValue(rec, 'm')); const innerRec = inner && record(inner.ref); return innerRec ? mapEntries(innerRec, limit, depthGuard + 1) : null; }
    if (type === 'Ljava/util/Collections$EmptyMap;' || type === 'Lkotlin/collections/EmptyMap;') return { size: 0, entries: [] };
    if (type === 'Ljava/util/Collections$SingletonMap;') return { size: 1, entries: [[fieldValue(rec, 'k'), fieldValue(rec, 'v')]] };
    if (subtype(type, 'Landroidx/collection/SimpleArrayMap;') || subtype(type, 'Landroid/util/ArrayMap;')) {
      let array = null, size = 0;
      for (const entry of fields(rec)) { if (entry.type === '[Ljava/lang/Object;' && !array) array = cellsOf(entry.value); if (entry.type === 'I' && /^m?[sS]ize$/.test(entry.name)) size = Number(entry.value ?? 0) | 0; }
      const entries = []; for (let i = 0; array && i < Math.min(size, limit); i++) entries.push([array[i * 2], array[i * 2 + 1]]);
      return { size, entries };
    }
    return null;
  }
  /** Compose snapshot state: the newest valid record of the StateRecord chain that starts at the object's first StateRecord field. */
  function newestRecord(rec) {
    let head = null; for (const entry of fields(rec)) { const value = refOf(entry.value); if (value && (subtype(entry.type, STATE_RECORD) || subtype(record(value.ref)?.type, STATE_RECORD))) { head = value; break; } }
    let best = null, bestId = -1n;
    for (let node = head, guard = 0; node && guard < 64; guard++) {
      const n = record(node.ref); if (!n) break;
      const idEntry = field(n, 'snapshotId'), id = idEntry?.value === undefined || idEntry?.value === null ? 0n : BigInt(idEntry.value);
      if (id !== 0n && id > bestId) { best = n; bestId = id; }   // 0 is Compose's INVALID_SNAPSHOT: a record free for reuse
      node = refOf(fieldValue(n, 'next'));
    }
    return best;
  }
  /** An observable holder -> { kind, value (raw), valueType, extra }, or null. */
  function holder(rec) {
    const type = rec.type;
    if (subtype(type, STATE_FLOW)) {
      const entry = fields(rec).find(item => item.name === '_state' || item.name.startsWith('_state$')); if (!entry) return null;
      let value = entry.value; const inner = isRef(value) ? record(value.ref) : null;
      if (inner?.type === SYMBOL) value = null;   // kotlinx's NULL symbol stands for a null value
      return { kind: 'StateFlow', value, valueType: entry.type };
    }
    if (subtype(type, LIVE_DATA)) {
      const data = field(rec, 'mData'); if (!data) return null;
      const inner = isRef(data.value) ? record(data.value.ref) : null, unset = inner?.type === OBJECT;   // LiveData.NOT_SET is a plain java.lang.Object
      return { kind: 'LiveData', value: unset ? null : data.value, valueType: data.type, extra: { version: intField(rec, 'mVersion'), set: !unset } };
    }
    if (subtype(type, STATE_OBJECT) && !subtype(type, SNAPSHOT_LIST) && !type.includes('SnapshotStateMap')) {
      const current = newestRecord(rec); if (!current) return null;
      const entry = field(current, 'value'); if (!entry) return null;
      return { kind: 'MutableState', value: entry.value, valueType: entry.type };
    }
    if (/^Ljava\/util\/concurrent\/atomic\/Atomic(Integer|Long|Boolean|Reference);$/.test(type) || rec.atomicValue !== undefined) {
      const entry = field(rec, 'value'), prim = { 'Ljava/util/concurrent/atomic/AtomicInteger;': 'I', 'Ljava/util/concurrent/atomic/AtomicLong;': 'J', 'Ljava/util/concurrent/atomic/AtomicBoolean;': 'I' }[type];
      const raw = rec.atomicValue !== undefined ? rec.atomicValue : entry?.value;
      return { kind: 'Atomic', value: raw, valueType: entry?.type ?? prim ?? (typeof raw === 'object' ? OBJECT : 'I'), boolean: type.endsWith('AtomicBoolean;') };
    }
    return null;
  }

  // ---- the JSON view ---------------------------------------------------------------------------------------------------------------------------------------------
  /** Reads `value` (declared type `type`) as JSON with the given limits: see docs/PLUGINS.md "Valores". */
  function view(value, type, options = {}) {
    const o = limits(options), state = { fields: 0, nodes: 0, truncated: false, deadline: now() + o.budgetMs, expanded: new Set() };
    const result = describe(value, type, o.depth, o, state);
    return { value: result, truncated: state.truncated, nodes: state.nodes };
  }
  function describe(value, type, depth, o, state) {
    if (++state.nodes > o.maxNodes || (state.nodes % 64 === 0 && now() > state.deadline)) { state.truncated = true; return { $truncated: true }; }
    if (type && type.length === 1) return primitiveValue(type, value);
    if (value === undefined || value === null || value === 0) return null;
    if (typeof value === 'string') return clip(value, o.maxString);
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return typeof value === 'bigint' ? longValue(value) : value;
    if (!isRef(value)) return null;
    const rec = record(value.ref);
    if (!rec) return { $handle: handleOf(runtime, value.ref), $collected: true };
    const base = { $type: typeName(rec.type), $handle: handleOf(runtime, rec.id ?? value.ref) };
    if (rec.type === STRING) return clip(stringOf(value) ?? '', o.maxString);
    if (rec.boxed !== undefined) {
      const prim = rec.primitiveType ?? { 'Ljava/lang/Integer;': 'I', 'Ljava/lang/Long;': 'J', 'Ljava/lang/Short;': 'S', 'Ljava/lang/Byte;': 'B', 'Ljava/lang/Character;': 'C', 'Ljava/lang/Boolean;': 'Z', 'Ljava/lang/Float;': 'F', 'Ljava/lang/Double;': 'D' }[rec.type];
      return prim ? primitiveValue(prim, rec.boxed) : rec.boxed;
    }
    const boxed = boxedField(rec); if (boxed !== undefined) return boxed;
    if (rec.builder !== undefined && (rec.type === 'Ljava/lang/StringBuilder;' || rec.type === 'Ljava/lang/StringBuffer;')) return clip(String(rec.builder), o.maxString);
    if (rec.cells !== undefined) {
      const element = rec.type.slice(1), cells = rec.cells, count = Math.min(cells.length, o.maxItems), items = [];
      for (let i = 0; i < count; i++) items.push(describe(element.length === 1 ? cells[i] : cells[i], element, depth, o, state));
      return { ...base, $kind: 'array', size: cells.length, items, ...(cells.length > count ? { $more: cells.length - count } : {}) };
    }
    const enumName = enumNameOf(rec); if (enumName !== null) return { ...base, $kind: 'enum', name: enumName };
    const held = holder(rec);
    if (held) {
      const out = { ...base, $kind: held.kind, value: held.boolean ? !!Number(held.value ?? 0) : describe(held.value, held.valueType, depth, o, state) };
      if (held.extra) Object.assign(out, held.extra);
      return out;
    }
    const seq = sequence(rec, o.maxItems);
    if (seq) { const items = seq.items.map(item => describe(item, OBJECT, depth, o, state)); return { ...base, $kind: seq.kind, size: seq.size, items, ...(seq.size > items.length ? { $more: seq.size - items.length } : {}) }; }
    const map = mapEntries(rec, o.maxItems);
    if (map) { const entries = map.entries.map(([key, item]) => [describe(key, OBJECT, Math.min(depth, 1), o, state), describe(item, OBJECT, depth, o, state)]); return { ...base, $kind: 'map', size: map.size, entries, ...(map.size > entries.length ? { $more: map.size - entries.length } : {}) }; }
    if (depth <= 0) return base;
    if (state.expanded.has(rec.id ?? value.ref)) return { ...base, $seen: true };
    state.expanded.add(rec.id ?? value.ref);
    const out = { ...base, fields: {} }, list = fields(rec), names = new Map();
    for (const entry of list) names.set(entry.name, (names.get(entry.name) ?? 0) + 1);
    let shown = 0;
    for (const entry of list) {
      if (state.fields >= o.maxFields) { out.$more = list.length - shown; state.truncated = true; break; }
      const name = names.get(entry.name) > 1 && entry.owner !== rec.type ? `${typeName(entry.owner).split('.').pop()}.${entry.name}` : entry.name;
      state.fields++; shown++;
      out.fields[name] = describe(entry.value, entry.type, depth - 1, o, state);
    }
    return out;
  }
  function boxedField(rec) {
    const prim = { 'Ljava/lang/Integer;': 'I', 'Ljava/lang/Long;': 'J', 'Ljava/lang/Short;': 'S', 'Ljava/lang/Byte;': 'B', 'Ljava/lang/Character;': 'C', 'Ljava/lang/Boolean;': 'Z', 'Ljava/lang/Float;': 'F', 'Ljava/lang/Double;': 'D' }[rec.type];
    if (!prim) return undefined;
    const entry = field(rec, 'value'); return entry ? primitiveValue(prim, entry.value) : undefined;
  }
  function enumNameOf(rec) {
    if (rec.enumName !== undefined && rec.enumName !== null) { const name = stringOf(rec.enumName); if (name !== null) return name; }
    if (!subtype(rec.type, ENUM)) return null;
    const name = rec.fields?.get('Ljava/lang/Enum;->name:Ljava/lang/String;'); return name === undefined ? null : stringOf(name);
  }
  const clip = (text, max) => text.length > max ? text.slice(0, max) + `… (+${text.length - max})` : text;
  return { record, fields, field, fieldValue, fieldOfType, stringOf, sequence, mapEntries, holder, newestRecord, view, describe, typeOfValue, subtype, isRef };
}
export function limits(options = {}) {
  const bounded = (value, fallback, max, min = 0) => { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback; };
  return { depth: bounded(options.depth, QUERY_LIMITS.depth, QUERY_LIMITS.maxDepth), maxFields: bounded(options.maxFields, QUERY_LIMITS.maxFields, QUERY_LIMITS.maxFieldsLimit, 1),
    maxItems: bounded(options.maxItems, QUERY_LIMITS.maxItems, QUERY_LIMITS.maxItemsLimit), maxString: bounded(options.maxString, QUERY_LIMITS.maxString, QUERY_LIMITS.maxStringLimit, 16),
    maxNodes: QUERY_LIMITS.maxNodes, budgetMs: bounded(options.budgetMs, QUERY_LIMITS.budgetMs, 100, 1) };
}

function liveRecord(runtime, handle) {
  const id = parseHandle(runtime, handle), rec = runtime.heap.get(id);
  if (rec) return rec;
  if (isFreedId(runtime, id)) throw new PluginQueryError('collected', `objeto coletado: ${handle} foi liberado pelo coletor de lixo da VM (o app não o referencia mais)`);
  throw new PluginQueryError('bad-handle', `Handle desconhecido: ${handle}`);
}

/** The fragments on the screen (androidx.fragment): [{ handle, className, who, tag, id, hidden, state, children: [...] }], read from FragmentStore.mAdded. */
export function readFragments(runtime, reader = createHeapReader(runtime), { maxFragments = 64 } = {}) {
  const activity = runtime.activity && reader.record(runtime.activity.ref); if (!activity) return [];
  const manager = rootFragmentManager(reader, activity); const out = []; let count = 0;
  const walk = (fm, depth) => {
    const list = []; if (!fm || depth > 8) return list;
    const store = reader.record(reader.fieldOfType(fm, FRAGMENT_STORE)?.ref ?? 0), added = store && reader.record(reader.isRef(reader.fieldValue(store, 'mAdded')) ? reader.fieldValue(store, 'mAdded').ref : 0);
    const items = added ? reader.sequence(added, maxFragments)?.items ?? [] : [];
    for (const item of items) {
      if (!reader.isRef(item) || count >= maxFragments) continue; const fragment = reader.record(item.ref); if (!fragment || !reader.subtype(fragment.type, FRAGMENT)) continue; count++;
      const child = reader.fieldValue(fragment, 'mChildFragmentManager');
      list.push({ handle: handleOf(runtime, fragment.id ?? item.ref), className: dotted(fragment.type), who: reader.stringOf(reader.fieldValue(fragment, 'mWho')), tag: reader.stringOf(reader.fieldValue(fragment, 'mTag')),
        id: Number(reader.fieldValue(fragment, 'mFragmentId') ?? 0) | 0, hidden: !!reader.fieldValue(fragment, 'mHidden'), state: Number(reader.fieldValue(fragment, 'mState') ?? 0) | 0,
        children: reader.isRef(child) ? walk(reader.record(child.ref), depth + 1) : [] });
    }
    return list;
  };
  out.push(...walk(manager, 0));
  return out;
}
function rootFragmentManager(reader, activity) {
  const controller = reader.record(reader.fieldOfType(activity, FRAGMENT_CONTROLLER)?.ref ?? 0); if (!controller) return null;
  const host = reader.record(reader.fieldOfType(controller, FRAGMENT_HOST)?.ref ?? 0); if (!host) return null;
  return reader.record(reader.fieldOfType(host, FRAGMENT_MANAGER)?.ref ?? 0) ?? null;
}

/**
 * The ViewModels of the active screen, in this order: the Activity's ViewModelStore, the stores of the fragments on the screen (FragmentManagerViewModel.mViewModelStores by
 * the fragment's mWho, children after their parent), then the stores a ViewModel holds in a Map (Navigation's NavControllerViewModel keeps one per back-stack entry).
 * [{ handle, className, key, library, owner: { kind: 'activity' | 'fragment' | 'navigation' | 'store', label, className?, handle?, key? } }]
 */
export function listViewModels(runtime, reader = createHeapReader(runtime), { maxViewModels = 128 } = {}) {
  const activity = runtime.activity && reader.record(runtime.activity.ref); if (!activity) return [];
  const out = [], seenStores = new Set(), seenModels = new Set(), nested = [];
  const addStore = (storeRef, owner) => {
    const store = storeRef && reader.record(storeRef.ref); if (!store || seenStores.has(store.id ?? storeRef.ref)) return; seenStores.add(store.id ?? storeRef.ref);
    const mapRef = reader.fieldOfType(store, MAP); const map = mapRef && reader.record(mapRef.ref); if (!map) return;
    const entries = reader.mapEntries(map, maxViewModels)?.entries ?? [];
    for (const [key, value] of entries) {
      if (!reader.isRef(value) || out.length >= maxViewModels) continue; const model = reader.record(value.ref); if (!model || seenModels.has(model.id ?? value.ref)) continue; seenModels.add(model.id ?? value.ref);
      const className = dotted(model.type);
      out.push({ handle: handleOf(runtime, model.id ?? value.ref), className, key: reader.stringOf(key), library: /^androidx?\./.test(className), owner });
      nested.push(model);
    }
  };
  addStore(reader.fieldOfType(activity, VIEW_MODEL_STORE), { kind: 'activity', label: `Activity ${dotted(activity.type).split('.').pop()}`, className: dotted(activity.type), handle: handleOf(runtime, activity.id ?? runtime.activity.ref) });
  // fragments: the store of each fragment on the screen, from the FragmentManagerViewModel of its manager
  const manager = rootFragmentManager(reader, activity);
  const walk = (fm, depth) => {
    if (!fm || depth > 8) return;
    const nonConfig = reader.record(reader.fieldOfType(fm, FRAGMENT_NON_CONFIG)?.ref ?? 0), storesRef = nonConfig && reader.fieldValue(nonConfig, 'mViewModelStores');
    const stores = new Map(); if (reader.isRef(storesRef)) for (const [key, value] of reader.mapEntries(reader.record(storesRef.ref), 256)?.entries ?? []) stores.set(reader.stringOf(key), value);
    const store = reader.record(reader.fieldOfType(fm, FRAGMENT_STORE)?.ref ?? 0), addedRef = store && reader.fieldValue(store, 'mAdded');
    for (const item of reader.isRef(addedRef) ? reader.sequence(reader.record(addedRef.ref), 64)?.items ?? [] : []) {
      const fragment = reader.isRef(item) && reader.record(item.ref); if (!fragment) continue;
      const who = reader.stringOf(reader.fieldValue(fragment, 'mWho')), storeRef = who !== null ? stores.get(who) : null;
      if (reader.isRef(storeRef)) addStore(storeRef, { kind: 'fragment', label: `Fragment ${dotted(fragment.type).split('.').pop()}`, className: dotted(fragment.type), handle: handleOf(runtime, fragment.id ?? item.ref), key: who });
      const child = reader.fieldValue(fragment, 'mChildFragmentManager'); if (reader.isRef(child)) walk(reader.record(child.ref), depth + 1);
    }
  };
  walk(manager, 0);
  // stores held by a ViewModel (a Map whose values are ViewModelStores): Navigation's back-stack entries, a fragment manager's stores not on the screen are skipped
  for (let i = 0; i < nested.length && out.length < maxViewModels; i++) {
    const model = nested[i]; if (reader.subtype(model.type, FRAGMENT_NON_CONFIG)) continue;
    for (const entry of reader.fields(model)) {
      if (!reader.isRef(entry.value)) continue; const map = reader.record(entry.value.ref); if (!map || !reader.subtype(map.type, MAP)) continue;
      for (const [key, value] of reader.mapEntries(map, 64)?.entries ?? []) {
        if (!reader.isRef(value) || !reader.subtype(reader.record(value.ref)?.type, VIEW_MODEL_STORE)) continue;
        const navigation = /navigation/i.test(model.type), name = reader.stringOf(key);
        addStore(value, { kind: navigation ? 'navigation' : 'store', label: navigation ? `Navegação ${String(name ?? '').slice(0, 8)}` : `${dotted(model.type).split('.').pop()} ${String(name ?? '').slice(0, 24)}`, className: dotted(model.type), handle: handleOf(runtime, model.id), key: name });
      }
    }
  }
  return out;
}

/** Resolves `path` ('a.b.0.c'; '' = the object itself) from the object of `handle`: field names (a Kotlin delegate `x$delegate` answers to `x`), list / array indexes,
 * map keys, and observable holders are looked through when the segment is not one of their own fields. -> { value, type } (raw) */
export function resolvePath(runtime, reader, handle, path) {
  const rec = liveRecord(runtime, handle); let value = { ref: rec.id ?? parseHandle(runtime, handle) }, type = rec.type;
  const segments = String(path ?? '').split('.').map(part => part.trim()).filter(Boolean);
  if (segments.length > 32) throw new PluginQueryError('bad-path', 'Caminho longo demais (máximo 32 partes).');
  for (const segment of segments) {
    let next;
    for (let guard = 0; guard < 5; guard++) {   // a field / index / key of the value, its size, or else look through a holder (StateFlow, LiveData, MutableState, atomic) to its current value
      next = step(reader, value, segment) ?? sizeOf(reader, value, segment); if (next !== undefined) break;
      const current = reader.isRef(value) ? reader.record(value.ref) : null, held = current && reader.holder(current); if (!held) break;
      if (segment === 'value') { next = { value: held.value, type: held.valueType }; break; }   // 'x.value': the holder's current value itself
      value = held.value; type = held.valueType;
    }
    if (next === undefined) throw new PluginQueryError('bad-path', `Campo não encontrado: "${segment}" em ${String(path)}`);
    ({ value, type } = next);
  }
  return { value, type };
}
function sizeOf(reader, value, segment) {
  if ((segment !== 'size' && segment !== 'length') || !reader.isRef(value)) return undefined;
  const rec = reader.record(value.ref); if (!rec) return undefined;
  const sized = rec.cells !== undefined ? { size: rec.cells.length } : reader.sequence(rec, 0) ?? reader.mapEntries(rec, 0);
  return sized ? { value: sized.size, type: 'I' } : undefined;
}
function step(reader, value, segment) {
  if (!reader.isRef(value)) return undefined;
  const rec = reader.record(value.ref); if (!rec) throw new PluginQueryError('collected', 'objeto coletado durante a leitura do caminho');
  if (rec.cells !== undefined) { const index = Number(segment); if (!Number.isInteger(index) || index < 0 || index >= rec.cells.length) return undefined; return { value: rec.cells[index], type: rec.type.slice(1) }; }
  const fields = reader.fields(rec), exact = fields.find(entry => entry.name === segment) ?? fields.find(entry => entry.name === `${segment}$delegate`) ?? fields.find(entry => entry.name === `_${segment}`);
  if (exact) return { value: exact.value, type: exact.type };
  if (/^\d+$/.test(segment)) { const seq = reader.sequence(rec, Number(segment) + 1); if (seq && Number(segment) < seq.items.length) return { value: seq.items[Number(segment)], type: OBJECT }; }
  const map = reader.mapEntries(rec, 500);
  if (map) { const hit = map.entries.find(([key]) => { const text = reader.stringOf(key); return text !== null ? text === segment : reader.isRef(key) ? false : String(key) === segment; }); if (hit) return { value: hit[1], type: OBJECT }; }
  return undefined;
}

/** Compose layout tree of src/compose-inspector.js reduced to what a plugin needs (no thumbnails, no modifiers list). */
export function compactComposeTree(inspection, { maxNodes = 2000 } = {}) {
  if (!inspection) return { owners: [], totalNodes: 0, truncated: false, notes: [] };
  let budget = maxNodes, truncated = !!inspection.truncated;
  const owners = (inspection.owners ?? []).map(owner => {
    const nodes = []; for (const node of owner.nodes ?? []) { if (budget <= 0) { truncated = true; break; } budget--;
      const s = node.semantics; nodes.push({ id: node.id, semanticsId: node.semanticsId ?? null, measurePolicy: node.measurePolicy ?? null, modifiers: (node.modifiers ?? []).slice(0, 40).map(m => ({ label: m.label, className: m.className })), zIndex: node.zIndex ?? 0, childCount: node.childCount ?? 0, parentId: node.parentId, depth: node.depth, name: node.name, nameSource: node.nameSource, bounds: node.boundsInWindow ?? node.visibleBounds ?? null, placed: node.placed,
        texts: s?.texts ?? [], editableText: s?.editableText ?? null, contentDescriptions: s?.contentDescriptions ?? [], role: s?.role ?? null, testTag: s?.testTag ?? null, actions: s?.actions ?? [], focused: !!s?.focused, enabled: s ? s.enabled !== false : true, selected: s?.selected ?? null, toggleState: s?.toggleState ?? null }); }
    return { ownerViewId: owner.ownerViewId, window: owner.window, width: owner.width, height: owner.height, nodes };
  });
  return { owners, totalNodes: inspection.totalNodes ?? 0, truncated, density: inspection.density ?? null, notes: inspection.notes ?? [] };
}

/** One plugin query: { query: 'viewModels' | 'fragments' | 'activity' | 'inspect' | 'field', args } -> JSON value. Throws PluginQueryError. `composeTree` is served by the Worker. */
export function runPluginQuery(runtime, query, args = {}) {
  if (!runtime) throw new PluginQueryError('no-apk', 'Nenhum APK em execução.');
  const reader = createHeapReader(runtime);
  switch (query) {
    case 'viewModels': return listViewModels(runtime, reader);
    case 'fragments': return readFragments(runtime, reader);
    case 'activity': { const rec = runtime.activity && reader.record(runtime.activity.ref); return rec ? { handle: handleOf(runtime, rec.id ?? runtime.activity.ref), className: dotted(rec.type) } : null; }
    case 'inspect': { const rec = liveRecord(runtime, args.handle); const result = reader.view({ ref: rec.id ?? parseHandle(runtime, args.handle) }, rec.type, args.options ?? {}); if (result.truncated && result.value && typeof result.value === 'object') result.value.$truncated = true; return result.value; }
    case 'field': { const target = resolvePath(runtime, reader, args.handle, args.path); const result = reader.view(target.value, target.type, { depth: 1, ...(args.options ?? {}) }); if (result.truncated && result.value && typeof result.value === 'object') result.value.$truncated = true; return result.value; }
    default: throw new PluginQueryError('bad-query', `Consulta desconhecida: ${String(query).slice(0, 40)}`);
  }
}
