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
import { isFreedId } from './heap-gc.js?v=59e9e77ad3a2';

export const QUERY_LIMITS = { depth: 2, maxDepth: 6, maxFields: 200, maxFieldsLimit: 2000, maxItems: 20, maxItemsLimit: 500, maxString: 1000, maxStringLimit: 20000, maxNodes: 4000, budgetMs: 25 };
const VIEW_MODEL_STORE = 'Landroidx/lifecycle/ViewModelStore;', VIEW_MODEL = 'Landroidx/lifecycle/ViewModel;';
const FRAGMENT = 'Landroidx/fragment/app/Fragment;', FRAGMENT_MANAGER = 'Landroidx/fragment/app/FragmentManager;', FRAGMENT_CONTROLLER = 'Landroidx/fragment/app/FragmentController;';
const FRAGMENT_HOST = 'Landroidx/fragment/app/FragmentHostCallback;', FRAGMENT_STORE = 'Landroidx/fragment/app/FragmentStore;', FRAGMENT_NON_CONFIG = 'Landroidx/fragment/app/FragmentManagerViewModel;';
const STATE_RECORD = 'Landroidx/compose/runtime/snapshots/StateRecord;', STATE_OBJECT = 'Landroidx/compose/runtime/snapshots/StateObject;', SNAPSHOT_LIST = 'Landroidx/compose/runtime/snapshots/SnapshotStateList;';
const STATE_FLOW = 'Lkotlinx/coroutines/flow/StateFlowImpl;', LIVE_DATA = 'Landroidx/lifecycle/LiveData;', SYMBOL = 'Lkotlinx/coroutines/internal/Symbol;';
const REFERENCE = 'Ljava/lang/ref/Reference;', REFERENT_KEY = 'Ljava/lang/ref/Reference;->referent:Ljava/lang/Object;', THREAD_LOCAL = 'Ljava/lang/ThreadLocal;', LAZY_UNSET = 'Lkotlin/UNINITIALIZED_VALUE;';
const REFERENCE_TYPES = new Set([REFERENCE, 'Ljava/lang/ref/WeakReference;', 'Ljava/lang/ref/SoftReference;', 'Ljava/lang/ref/PhantomReference;']);   // a subclass keeps its own fields; its referent shows as the field `referent`
const LAZY_TYPES = new Set(['Lkotlin/SynchronizedLazyImpl;', 'Lkotlin/SafePublicationLazyImpl;', 'Lkotlin/UnsafeLazyImpl;']);
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
const COMPOSE_COLOR = 'Landroidx/compose/ui/graphics/Color;';
/** A Compose Color (a value class over a packed ULong): sRGB colors keep ARGB in the high 32 bits (color space id 0 in the low 6 bits) -> { argb: '#AARRGGBB' }. */
export function composeColor(packed) {
  if (packed === undefined || packed === null) return null;
  let bits; try { bits = BigInt.asUintN(64, BigInt(packed)); } catch { return null; }
  if ((bits & 0x3fn) !== 0n) return { packed: String(BigInt.asIntN(64, bits)), colorSpace: Number(bits & 0x3fn) };
  return { argb: '#' + Number(bits >> 32n).toString(16).padStart(8, '0').toUpperCase() };
}
const popCount = n => { let v = Number(n) >>> 0, c = 0; while (v) { v &= v - 1; c++; } return c; };
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
    for (const field of list) { known.add(field.key); out.push({ ...field, value: rec.fields?.has(field.key) ? rec.fields.get(field.key) : field.key === REFERENT_KEY && rec.referent !== undefined ? rec.referent : undefined }); }
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
    // Compose's persistent hash map (kotlinx.collections.immutable, repackaged by androidx.compose.runtime): a CHAMP trie; the map of CompositionLocals of a composition is one
    if (/\/immutableMap\/PersistentHashMap;$|\/PersistentCompositionLocalHashMap;$/.test(type) || (fieldValue(rec, 'node') !== undefined && isRef(fieldValue(rec, 'node')) && /\/immutableMap\/TrieNode;$/.test(record(fieldValue(rec, 'node').ref)?.type ?? ''))) {
      const entries = [], size = intField(rec, 'size'), stack = [refOf(fieldValue(rec, 'node'))];
      for (let guard = 0; stack.length && entries.length < limit && guard < 20000; guard++) {
        const ref = stack.pop(), node = ref && record(ref.ref); if (!node) continue;
        const buffer = cellsOf(fieldValue(node, 'buffer')) ?? [], dataMap = intField(node, 'dataMap'), nodeMap = intField(node, 'nodeMap');
        const pairs = dataMap === 0 && nodeMap === 0 ? buffer.length / 2 : popCount(dataMap);   // a collision node holds only key / value pairs
        for (let i = 0; i < pairs && entries.length < limit; i++) entries.push([buffer[2 * i], buffer[2 * i + 1]]);
        for (let i = buffer.length - 1; i >= 2 * pairs; i--) if (isRef(buffer[i])) stack.push(buffer[i]);
      }
      return { size: size || entries.length, entries };
    }
    if (/\/immutableMap\/PersistentOrderedMap;$/.test(type)) {   // insertion order is kept in LinkedValue wrappers of an inner PersistentHashMap
      const inner = refOf(fieldValue(rec, 'hashMap')), innerRec = inner && record(inner.ref), map = innerRec ? mapEntries(innerRec, limit, depthGuard + 1) : null; if (!map) return null;
      return { size: map.size, entries: map.entries.map(([key, value]) => { const linked = isRef(value) ? record(value.ref) : null; return [key, linked && /\/LinkedValue;$/.test(linked.type) ? fieldValue(linked, 'value') : value]; }) };
    }
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
    if (REFERENCE_TYPES.has(type)) {   // java.lang.ref.Weak/Soft/PhantomReference: the referent (host slot or the libcore field), null once cleared
      const value = rec.referent !== undefined ? rec.referent : rec.fields?.get?.(REFERENT_KEY);
      return { kind: 'Reference', value: value ?? null, valueType: OBJECT, extra: { cleared: value === undefined || value === null } };
    }
    if (LAZY_TYPES.has(type)) {   // Kotlin `by lazy`: the computed value, or not computed yet (the UNINITIALIZED_VALUE marker); reading never computes it
      const entry = field(rec, '_value'); if (!entry) return null;
      const inner = isRef(entry.value) ? record(entry.value.ref) : null, unset = inner?.type === LAZY_UNSET;
      return { kind: 'Lazy', value: unset ? null : entry.value, valueType: OBJECT, extra: { initialized: !unset } };
    }
    if (rec.threadLocalValues instanceof Map || subtype(type, THREAD_LOCAL)) {   // java.lang.ThreadLocal: the value of the first thread that set one (the main thread for state the UI reads)
      const values = rec.threadLocalValues instanceof Map ? [...rec.threadLocalValues.values()] : [];
      return { kind: 'ThreadLocal', value: values[0] ?? null, valueType: OBJECT, extra: { threads: values.length } };
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
    if (rec.type === COMPOSE_COLOR) { const color = composeColor(fieldValue(rec, 'value')); if (color) return { ...base, $kind: 'color', ...color }; }
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
  const rec = liveRecord(runtime, handle);
  return walkPath(reader, { value: { ref: rec.id ?? parseHandle(runtime, handle) }, type: rec.type }, path);
}
/** A path as segments: 'a.b.0' splits on dots; an array keeps each item whole (a map key that has dots: ['_instances', 'a.b.C::_root_', 'value']). */
export function pathSegments(path) {
  const segments = Array.isArray(path) ? path.map(part => String(part ?? '')).filter(part => part.length) : String(path ?? '').split('.').map(part => part.trim()).filter(Boolean);
  if (segments.length > 32) throw new PluginQueryError('bad-path', 'Caminho longo demais (máximo 32 partes).');
  if (segments.some(part => part.length > 500)) throw new PluginQueryError('bad-path', 'Parte do caminho longa demais (máximo 500 caracteres).');
  return segments;
}
function walkPath(reader, start, path) {
  let { value, type } = start; const segments = pathSegments(path), label = Array.isArray(path) ? JSON.stringify(path).slice(0, 200) : String(path);
  for (const segment of segments) {
    let next;
    for (let guard = 0; guard < 5; guard++) {   // a field / index / key of the value, its size, or else look through a holder (StateFlow, LiveData, MutableState, atomic) to its current value
      next = step(reader, value, segment) ?? sizeOf(reader, value, segment); if (next !== undefined) break;
      const current = reader.isRef(value) ? reader.record(value.ref) : null, held = current && reader.holder(current); if (!held) break;
      if (segment === 'value' || segment === 'get' || segment === 'get()') { next = { value: held.value, type: held.valueType }; break; }   // 'x.value' / 'ref.get': the holder's current value itself (StateFlow.value, Reference.get(), Lazy.value)
      value = held.value; type = held.valueType;
    }
    if (next === undefined) throw new PluginQueryError('bad-path', `Campo não encontrado: "${segment}" em ${label}`);
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

// ---- static fields, classes, instances and referrers -----------------------------------------------------------------------------------------------------------------
// The roots a screen-level query does not reach: state kept in a static field (a Kotlin `object`, a companion, a singleton holder, a dependency-injection container kept
// globally) and objects that no ViewModel holds. Still read-only: a class that was never initialized is reported as such and never initialized by a query (its <clinit>
// would run app code); the heap scans are bounded by a time budget and resume from a cursor, so a large heap costs several short queries, never a long pause of the VM.
export const SCAN_LIMITS = { limit: 50, maxLimit: 500, budgetMs: 40, maxBudgetMs: 200, classLimit: 100, maxClassLimit: 1000 };
/** 'a.b.C', 'a.b.C$Inner', 'a/b/C' or 'La/b/C;' -> the descriptor 'La/b/C;'. */
export function classDescriptor(name) {
  const text = String(name ?? '').trim();
  if (!text || text.length > 400) throw new PluginQueryError('bad-class', 'Nome de classe inválido.');
  if (text.startsWith('[')) throw new PluginQueryError('bad-class', 'Use o nome de uma classe, não de um array.');
  return text.startsWith('L') && text.endsWith(';') ? text : `L${text.replaceAll('.', '/')};`;
}
// Engine 'wasm': the classes' state, the statics of DEX classes and the heap are the core's (vmcore/js/host-bridge.js "inspection"); the JavaScript VM's tables hold none of it.
const coreOf = runtime => runtime.engine === 'wasm' && runtime.wasm ? runtime.wasm : null;
const classStatus = (runtime, type) => { const core = coreOf(runtime); return core ? core.classStatus(type) : runtime.initialized?.get?.(type)?.status ?? 'not-initialized'; };
/** The value of a static field without initializing its class, or undefined when it has none. */
const staticValue = (runtime, field) => { const core = coreOf(runtime); if (core) { const value = core.peekStatic(field); if (value !== undefined) return value; } return runtime.staticFields.has(field.key) ? runtime.staticFields.get(field.key) : undefined; };
/** [key, value] of the statics that may hold an object: the core's reference statics, and the JavaScript VM's table (all of them there; the host-modelled ones on the core). */
function* staticEntries(runtime) { const core = coreOf(runtime); if (core) yield* core.referenceStatics(); yield* runtime.staticFields ?? []; }
function classRecord(runtime, type) {
  let cls = null; try { cls = runtime.classes?.get?.(type) ?? null; } catch { cls = null; }
  if (!cls) throw new PluginQueryError('no-class', `Classe não encontrada nos DEX do app: ${dotted(type)}`);
  return cls;
}
function staticDeclarations(cls) {
  const out = []; for (const entry of cls.staticFields ?? []) { try { const field = cls.dex.field(entry.index); out.push({ key: field.key, owner: field.owner, name: field.name, type: field.type }); } catch { /* unreadable declaration */ } }
  return out;
}
/** The static fields a class declares, read as JSON. A class not initialized yet answers status 'not-initialized' and no values (a query never runs <clinit>). */
export function readStatics(runtime, reader, className, options = {}) {
  const type = classDescriptor(className), cls = classRecord(runtime, type), status = classStatus(runtime, type), declared = staticDeclarations(cls);
  const out = { className: dotted(type), status, fields: {} };
  if (status !== 'initialized' && status !== 'initializing') { out.note = 'classe ainda não inicializada pelo app: os campos estáticos não existem ainda (uma consulta nunca roda o <clinit>)'; out.declared = declared.map(field => ({ name: field.name, type: typeName(field.type) })); return out; }
  const o = { depth: 1, ...options };
  for (const field of declared) {
    const value = staticValue(runtime, field); if (value === undefined) { out.fields[field.name] = null; continue; }
    const result = reader.view(value, field.type, o);
    out.fields[field.name] = result.value; if (result.truncated) out.$truncated = true;
  }
  return out;
}
/** The raw value at `path` from a static field: the first segment is the field's name (declared by the class or one of its superclasses), the rest walks as in resolvePath. */
export function resolveStaticPath(runtime, reader, className, path) {
  const type = classDescriptor(className), segments = pathSegments(path); classRecord(runtime, type);
  if (!segments.length) throw new PluginQueryError('bad-path', 'Informe o campo estático: lab.staticField(classe, "campo.caminho").');
  const [name, ...rest] = segments;
  for (let owner = type, guard = 0; owner && guard < 64; guard++) {
    let cls = null; try { cls = runtime.classes?.get?.(owner) ?? null; } catch { cls = null; }
    const field = cls ? staticDeclarations(cls).find(item => item.name === name || item.name === `${name}$delegate` || item.name === `_${name}`) : null;
    if (field) {
      const status = classStatus(runtime, field.owner);
      if (status !== 'initialized' && status !== 'initializing') throw new PluginQueryError('not-initialized', `${dotted(field.owner)} ainda não foi inicializada pelo app: o campo estático ${name} não existe ainda (uma consulta nunca roda o <clinit>)`);
      return walkPath(reader, { value: staticValue(runtime, field) ?? null, type: field.type }, rest);
    }
    try { owner = runtime.parent(owner); } catch { owner = null; }
    if (owner === OBJECT) break;
  }
  throw new PluginQueryError('bad-path', `Campo estático não encontrado: ${name} em ${dotted(type)}`);
}
/** Classes of the app's DEX files whose name matches `match` (a case-insensitive part of the name, or '/regex/flags'): [{ className, status, staticFields }]. */
export function listClasses(runtime, { match = '', limit, initialized = false } = {}) {
  const text = String(match ?? '').trim(); if (!text) throw new PluginQueryError('bad-args', 'Informe parte do nome da classe: lab.classes("Container").');
  let test; const regex = /^\/(.+)\/([a-z]*)$/.exec(text);
  if (regex) { let pattern; try { pattern = new RegExp(regex[1], regex[2].replace(/[gy]/g, '')); } catch (error) { throw new PluginQueryError('bad-args', `Expressão regular inválida: ${error.message}`); } test = name => pattern.test(name); }
  else { const needle = text.toLowerCase(); test = name => name.toLowerCase().includes(needle); }
  const max = boundedInt(limit, SCAN_LIMITS.classLimit, SCAN_LIMITS.maxClassLimit, 1), items = []; let matched = 0;
  for (const type of runtime.classes?.keys?.() ?? []) {
    const name = dotted(type); if (!test(name)) continue;
    const status = classStatus(runtime, type); if (initialized && status !== 'initialized') continue;
    matched++; if (items.length >= max) continue;
    let statics = null; if (status === 'initialized') { try { statics = runtime.classes.get(type)?.staticFields?.length ?? 0; } catch { statics = null; } }
    items.push({ className: name, status, staticFields: statics });
  }
  return { items, matched, ...(matched > items.length ? { $more: matched - items.length } : {}) };
}
const boundedInt = (value, fallback, max, min = 0) => { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback; };
/** Walks the heap records from id `after` (exclusive) for at most `budgetMs`; `visit(record, id)` returns false to stop. -> { scanned, next (cursor) | null when the heap ended } */
function scanHeap(runtime, { after = 0, budgetMs, now }, visit, wanted = null) {
  const core = coreOf(runtime);
  if (core) {   // the core's heap in address order (the cursor is an address); `wanted(type)` spares a record for the objects the caller would skip anyway
    const limit = now() + budgetMs; let count = 0;
    const next = core.walkHeap(Math.max(0, Math.floor(Number(after) || 0)), (address, type) => {
      count++; if (wanted !== null && !wanted(type)) return (count & 4095) !== 0 || now() <= limit;
      const rec = core.recordAt(address); if (visit(rec, rec.id) === false) return false;
      return (count & 255) !== 0 || now() <= limit;
    });
    return { scanned: count, next };
  }
  const heap = runtime.heap, deadline = now() + budgetMs, start = Math.max(0, Math.floor(Number(after) || 0)) + 1; let scanned = 0;
  if (!heap?.chunks) throw new PluginQueryError('failed', 'Heap da VM indisponível para varredura.');
  const shift = 12, size = 1 << shift;
  for (let ci = start >>> shift; ci < heap.chunks.length; ci++) {
    const chunk = heap.chunks[ci]; if (chunk === undefined) continue;
    for (let i = ci === start >>> shift ? start & (size - 1) : 0; i < chunk.length; i++) {
      const rec = chunk[i]; if (rec === undefined || rec.freed === true) continue;
      const id = ci * size + i; scanned++;
      if (visit(rec, id) === false) return { scanned, next: id };
      if ((scanned & 1023) === 0 && now() > deadline) return { scanned, next: id };
    }
  }
  return { scanned, next: null };
}
/** Live objects of a class (and its subclasses / implementors unless `subclasses: false`): { items: [{ handle, className }], scanned, next, done }. Pass `after: next` to go on. */
export function findInstances(runtime, reader, className, { subclasses = true, limit, after = 0, budgetMs } = {}, now = () => performance.now()) {
  const type = classDescriptor(className), max = boundedInt(limit, SCAN_LIMITS.limit, SCAN_LIMITS.maxLimit, 1), budget = boundedInt(budgetMs, SCAN_LIMITS.budgetMs, SCAN_LIMITS.maxBudgetMs, 1);
  const verdicts = new Map(), items = [];
  const matches = recType => { let hit = verdicts.get(recType); if (hit === undefined) { hit = recType === type || (subclasses !== false && reader.subtype(recType, type)); verdicts.set(recType, hit); } return hit; };
  const result = scanHeap(runtime, { after, budgetMs: budget, now }, (rec, id) => {
    if (typeof rec.type !== 'string' || !matches(rec.type)) return true;
    items.push({ handle: handleOf(runtime, rec.id ?? id), className: dotted(rec.type) });
    return items.length < max;
  }, matches);
  return { items, scanned: result.scanned, next: result.next, done: result.next === null };
}
/** Who holds the object of `handle`: static fields (first page only) and heap objects whose fields, array cells or host slots point to it.
 * { items: [{ kind: 'static', className, field } | { kind: 'object', handle, className, via }], scanned, next, done } */
export function findReferrers(runtime, reader, handle, { limit, after = 0, budgetMs } = {}, now = () => performance.now()) {
  const target = liveRecord(runtime, handle), id = target.id ?? parseHandle(runtime, handle), max = boundedInt(limit, SCAN_LIMITS.limit, SCAN_LIMITS.maxLimit, 1), budget = boundedInt(budgetMs, SCAN_LIMITS.budgetMs, SCAN_LIMITS.maxBudgetMs, 1);
  const items = [], points = value => value !== null && typeof value === 'object' && value.ref === id;
  if (!(Number(after) > 0)) for (const [key, value] of staticEntries(runtime)) { if (items.length >= max) break; if (points(value)) { const { owner, name } = parseKey(key); items.push({ kind: 'static', className: dotted(owner), field: name }); } }
  const via = rec => {
    if (rec.fields) for (const [key, value] of rec.fields) if (points(value)) return key.includes('->') ? parseKey(key).name : key;
    if (rec.cells !== undefined) { const cells = rec.cells; if (!ArrayBuffer.isView(cells)) for (let i = 0; i < cells.length; i++) if (points(cells[i])) return `[${i}]`; }
    for (const key of Object.keys(rec)) {   // host slots (a reference's referent, a ThreadLocal's values, host-backed state)
      if (key === 'fields' || key === 'cells' || key === 'type' || key === 'id') continue;
      const value = rec[key]; if (points(value)) return key;
      if (value instanceof Map) { for (const item of value.values()) if (points(item)) return key; }
      else if (Array.isArray(value) && value.length <= 4096) { for (const item of value) if (points(item)) return key; }
    }
    return null;
  };
  const result = scanHeap(runtime, { after, budgetMs: budget, now }, (rec, recId) => {
    if (recId === id) return true;
    const path = via(rec); if (path === null) return true;
    items.push({ kind: 'object', handle: handleOf(runtime, rec.id ?? recId), className: dotted(rec.type), via: path });
    return items.length < max;
  });
  return { items, scanned: result.scanned, next: result.next, done: result.next === null };
}

// ---- CompositionLocals of one component ---------------------------------------------------------------------------------------------------------------------------------
// Every LayoutNode keeps the CompositionLocal map that was current where it was emitted (LayoutNode.compositionLocalMap, set by ComposeUiNode.SetResolvedCompositionLocals):
// what LocalX.current answers for that component. Read from the fields like any query (no Composer, no method call). A Local is named by the static field that declares it
// (top-level vals compile to static fields: LocalContentColor in ContentColorKt); a minified app shows its renamed field. Values: StaticValueHolder.value,
// DynamicValueHolder.state (a MutableState: its current value), ComputedValueHolder (a lambda run by the composition: not computed here, reported as such).
function staticNames(runtime) {
  const core = coreOf(runtime), size = (runtime.staticFields?.size ?? 0) + (core ? core.linker.classList.length * 65536 : 0), cached = runtime.pluginStaticNames;   // on the core the cache follows the classes laid out
  if (cached && cached.size === size) return cached.map;
  const map = new Map();
  for (const [key, value] of staticEntries(runtime)) if (isRef(value) && !map.has(value.ref)) { const { owner, name } = parseKey(key); map.set(value.ref, { name, declaredIn: dotted(owner) }); }
  runtime.pluginStaticNames = { size, map };
  return map;
}
/** The name of a CompositionLocal key: the static field that declares it (a top-level val, an object or companion property), else the instance field that holds it
 * (a Local kept in a class or an object instance), found by a short heap scan once per key; a minified app shows its renamed names. */
function localName(runtime, reader, keyRef) {
  const statics = staticNames(runtime).get(keyRef.ref); if (statics) return statics;
  const cache = runtime.pluginLocalNames ??= new Map(); if (cache.has(keyRef.ref)) return cache.get(keyRef.ref);
  let found = null;
  try {
    scanHeap(runtime, { after: 0, budgetMs: 30, now: () => performance.now() }, rec => {
      if (!rec.fields || rec.cells !== undefined) return true;
      for (const [key, value] of rec.fields) if (isRef(value) && value.ref === keyRef.ref && key.includes('->')) { const parsed = parseKey(key); if (/Local|local/.test(parsed.name) || !/\$|^this/.test(parsed.name)) { found = { name: parsed.name.replace(/\$delegate$/, ''), declaredIn: dotted(parsed.owner), holder: 'instance' }; return false; } }
      return true;
    });
  } catch { found = null; }
  if (cache.size < 5000) cache.set(keyRef.ref, found);
  return found;
}
/** One provided Local: { kind, raw, rawType, note } from its value holder. */
function unwrapLocal(reader, holderRef) {
  const holder = isRef(holderRef) ? reader.record(holderRef.ref) : null, htype = holder?.type ?? '';
  if (/ComputedValueHolder;$/.test(htype)) return { kind: 'computed', raw: null, rawType: OBJECT, note: 'calculado pela composição a partir de outros Locals (compositionLocalWithComputedDefaultOf): não é avaliado aqui' };
  if (/DynamicValueHolder;$/.test(htype)) { const state = reader.fieldValue(holder, 'state'), held = isRef(state) ? reader.holder(reader.record(state.ref)) : null; return { kind: 'dynamic', raw: held ? held.value : state, rawType: held?.valueType ?? OBJECT }; }
  if (/StaticValueHolder;$/.test(htype) || (holder && reader.field(holder, 'value') && !reader.holder(holder))) { const entry = reader.field(holder, 'value'); return { kind: 'static', raw: entry?.value ?? null, rawType: entry?.type ?? OBJECT }; }
  if (holder && reader.holder(holder)) { const held = reader.holder(holder); return { kind: 'state', raw: held.value, rawType: held.valueType }; }   // older Compose: the map holds a State
  return { kind: 'value', raw: holderRef, rawType: OBJECT };
}
/** `only`: names (exact or part, any case), 'Classe.campo', or a part of the value's class — so a Local is found also when its name is not the one expected. */
const localMatcher = only => {
  const wanted = (Array.isArray(only) ? only : only ? [only] : []).map(item => String(item).toLowerCase()).filter(Boolean);
  return wanted.length ? item => wanted.some(w => item.name.toLowerCase() === w || item.name.toLowerCase().includes(w) || `${item.declaredIn ?? ''}.${item.name}`.toLowerCase().includes(w) || String(item.valueType ?? '').toLowerCase().includes(w)) : () => true;
};
function compositionLocalMapOf(runtime, reader, rec) {
  const field = reader.field(rec, 'compositionLocalMap')?.value ?? null;
  if (isRef(field)) return field;
  if (reader.mapEntries(rec, 0)) return { ref: rec.id };
  return null;
}
export function readCompositionLocals(runtime, reader, handle, { options = {}, only = null } = {}) {
  if (!handle) throw new PluginQueryError('bad-handle', 'Sem handle: use o handle de um nó de lab.composeTree() (um nó da árvore de semântica, usada quando o LayoutNode não é legível, não tem handle).');
  const rec = liveRecord(runtime, handle), mapRef = compositionLocalMapOf(runtime, reader, rec);
  if (!mapRef) throw new PluginQueryError('bad-args', `${typeName(rec.type)} não tem CompositionLocalMap: passe o handle de um nó do Compose (lab.composeTree().owners[i].nodes[j].handle)`);
  const map = reader.record(mapRef.ref), decoded = map ? reader.mapEntries(map, 1000) : null;
  if (!decoded) throw new PluginQueryError('failed', `CompositionLocalMap ilegível (${map ? typeName(map.type) : 'coletado'})`);
  const view = { depth: 1, ...options }, matches = localMatcher(only), locals = [], values = {};
  for (const [key, holderRef] of decoded.entries) {
    const keyRec = isRef(key) ? reader.record(key.ref) : null, known = isRef(key) ? localName(runtime, reader, key) : null;
    const name = known?.name ?? `${typeName(keyRec?.type ?? 'Ljava/lang/Object;').split('.').pop()}#${key?.ref ?? '?'}`;
    const { kind, raw, rawType, note } = unwrapLocal(reader, holderRef), valueType = reader.typeOfValue(raw) ? typeName(reader.typeOfValue(raw)) : null;
    const probe = { name, declaredIn: known?.declaredIn ?? null, valueType }; if (!matches(probe)) continue;
    const result = kind === 'computed' ? { value: null } : reader.view(raw, rawType, view);
    const item = { ...probe, kind, value: result.value, key: isRef(key) ? handleOf(runtime, key.ref) : null, ...(known?.holder === 'instance' ? { declaredAs: 'campo de instância' } : {}), ...(note ? { note } : {}), ...(result.truncated ? { $truncated: true } : {}) };
    locals.push(item); if (!(name in values)) values[name] = item.value;
  }
  locals.sort((a, b) => a.name.localeCompare(b.name));
  return { handle: handleOf(runtime, rec.id ?? parseHandle(runtime, handle)), count: locals.length, total: decoded.size, locals, values };
}
/** Where a Local is provided on the screen: every LayoutNode's map is read (siblings share one map, read once) and the matching Locals are grouped by provided value.
 * { matches: [{ name, declaredIn, kind, valueType, value, nodes, node }], scannedNodes, maps, done }: `node` is the handle of one component that sees that value. */
export function findCompositionLocal(runtime, reader, match, { options = {}, limit, budgetMs } = {}, now = () => performance.now()) {
  const text = Array.isArray(match) ? match : String(match ?? '').trim(); if (!text || (Array.isArray(text) && !text.length)) throw new PluginQueryError('bad-args', 'Informe o nome do Local (ou parte dele, ou a classe do valor): lab.findCompositionLocal("LocalTema").');
  const matches = localMatcher(text), max = boundedInt(limit, 50, 500, 1), budget = boundedInt(budgetMs, 150, 400, 10), seenMaps = new Map(), groups = new Map(), view = { depth: 1, ...options };
  let nodes = 0;
  const result = scanHeap(runtime, { after: 0, budgetMs: budget, now }, (rec, id) => {
    if (rec.type !== 'Landroidx/compose/ui/node/LayoutNode;') return true;
    const mapRef = compositionLocalMapOf(runtime, reader, rec); if (!mapRef) return true; nodes++;
    let found = seenMaps.get(mapRef.ref);
    if (found === undefined) {
      found = []; const decoded = reader.mapEntries(reader.record(mapRef.ref) ?? {}, 1000);
      for (const [key, holderRef] of decoded?.entries ?? []) {
        if (!isRef(key)) continue; const known = localName(runtime, reader, key), keyRec = reader.record(key.ref);
        const name = known?.name ?? `${typeName(keyRec?.type ?? 'Ljava/lang/Object;').split('.').pop()}#${key.ref}`, local = unwrapLocal(reader, holderRef), valueType = reader.typeOfValue(local.raw) ? typeName(reader.typeOfValue(local.raw)) : null;
        if (!matches({ name, declaredIn: known?.declaredIn ?? null, valueType })) continue;
        const viewed = local.kind === 'computed' ? { value: null } : reader.view(local.raw, local.rawType, view);
        const sig = JSON.stringify(viewed.value, (field, value) => field === '$handle' ? undefined : value);   // the same value provided by different providers is one group
        found.push({ key, name, declaredIn: known?.declaredIn ?? null, valueType, local, value: viewed.value, sig });
      }
      seenMaps.set(mapRef.ref, found);
    }
    for (const item of found) {
      const group = `${item.key.ref}:${item.sig}`;
      let entry = groups.get(group); if (!entry) { if (groups.size >= max) continue; entry = { item, nodes: 0, node: handleOf(runtime, rec.id ?? id) }; groups.set(group, entry); }
      entry.nodes++;
    }
    return true;
  });
  const out = [...groups.values()].map(({ item, nodes: count, node }) => ({ name: item.name, declaredIn: item.declaredIn, kind: item.local.kind, valueType: item.valueType, value: item.value, nodes: count, node, key: handleOf(runtime, item.key.ref), ...(item.local.note ? { note: item.local.note } : {}) }));
  out.sort((a, b) => a.name.localeCompare(b.name) || b.nodes - a.nodes);
  return { matches: out, scannedNodes: nodes, maps: seenMaps.size, done: result.next === null, ...(result.next !== null ? { note: `varredura parou no limite de ${budget} ms: aumente budgetMs` } : {}) };
}

/** composeTree({ locals: ['LocalX', ...] }): each node of the tree gets `locals: { LocalX: value }`, what LocalX.current answers in that composable, so components can be
 * told apart by a Local. Siblings share one map: each map is decoded once. Locals not provided on the way to a node are absent (they have their default there). */
export function attachCompositionLocals(runtime, tree, only, { options = {} } = {}) {
  const reader = createHeapReader(runtime), matches = localMatcher(only), view = { depth: 1, ...options }, byMap = new Map(); let nodes = 0;
  for (const owner of tree?.owners ?? []) for (const node of owner.nodes ?? []) {
    if (!node.handle) continue;
    let rec; try { rec = liveRecord(runtime, node.handle); } catch { continue; }
    const mapRef = compositionLocalMapOf(runtime, reader, rec); if (!mapRef) continue;
    let values = byMap.get(mapRef.ref);
    if (!values) {
      values = {}; const decoded = reader.mapEntries(reader.record(mapRef.ref) ?? {}, 1000);
      for (const [key, holderRef] of decoded?.entries ?? []) {
        if (!isRef(key)) continue; const known = localName(runtime, reader, key), keyRec = reader.record(key.ref);
        const name = known?.name ?? `${typeName(keyRec?.type ?? 'Ljava/lang/Object;').split('.').pop()}#${key.ref}`, local = unwrapLocal(reader, holderRef), valueType = reader.typeOfValue(local.raw) ? typeName(reader.typeOfValue(local.raw)) : null;
        if (!matches({ name, declaredIn: known?.declaredIn ?? null, valueType }) || name in values) continue;
        values[name] = local.kind === 'computed' ? { $computed: true } : reader.view(local.raw, local.rawType, view).value;
      }
      byMap.set(mapRef.ref, values);
    }
    node.locals = values; nodes++;
  }
  tree.localsRequested = Array.isArray(only) ? only : [only]; tree.localsMaps = byMap.size; tree.localsNodes = nodes;
  return tree;
}

/** Compose layout tree of src/compose-inspector.js reduced to what a plugin needs (no thumbnails, no modifiers list). */
export function compactComposeTree(inspection, { maxNodes = 2000, handle = null } = {}) {
  if (!inspection) return { owners: [], totalNodes: 0, truncated: false, notes: [] };
  let budget = maxNodes, truncated = !!inspection.truncated;
  const owners = (inspection.owners ?? []).map(owner => {
    const nodes = []; for (const node of owner.nodes ?? []) { if (budget <= 0) { truncated = true; break; } budget--;
      const s = node.semantics; nodes.push({ id: node.id, handle: handle && Number.isSafeInteger(node.ref) ? handle(node.ref) : null, semanticsId: node.semanticsId ?? null, measurePolicy: node.measurePolicy ?? null, modifiers: (node.modifiers ?? []).slice(0, 40).map(m => ({ label: m.label, className: m.className })), zIndex: node.zIndex ?? 0, childCount: node.childCount ?? 0, parentId: node.parentId, depth: node.depth, name: node.name, nameSource: node.nameSource, bounds: node.boundsInWindow ?? node.visibleBounds ?? null, placed: node.placed,
        texts: s?.texts ?? [], editableText: s?.editableText ?? null, contentDescriptions: s?.contentDescriptions ?? [], role: s?.role ?? null, testTag: s?.testTag ?? null, actions: s?.actions ?? [], focused: !!s?.focused, enabled: s ? s.enabled !== false : true, selected: s?.selected ?? null, toggleState: s?.toggleState ?? null }); }
    return { ownerViewId: owner.ownerViewId, window: owner.window, width: owner.width, height: owner.height, source: owner.source ?? 'layout-nodes', nodes };
  });
  return { owners, totalNodes: inspection.totalNodes ?? 0, truncated, density: inspection.density ?? null, notes: inspection.notes ?? [] };
}

/** One plugin query: { query: 'viewModels' | 'fragments' | 'activity' | 'inspect' | 'field' | 'statics' | 'staticField' | 'classes' | 'instances' | 'referrers', args } -> JSON value. Throws PluginQueryError. `composeTree` is served by the Worker. */
export function runPluginQuery(runtime, query, args = {}) {
  if (!runtime) throw new PluginQueryError('no-apk', 'Nenhum APK em execução.');
  const reader = createHeapReader(runtime);
  switch (query) {
    case 'resourceIds': {   // names of the APK's resource table <-> ids ({ names: ['id/titulo'], ids: [0x7f0a0012] }): how a plugin names a View by its android:id
      const table = runtime.resources?.table ?? null, ids = {}, names = {};
      for (const name of (Array.isArray(args.names) ? args.names : []).slice(0, 64)) { const key = String(name).slice(0, 200); ids[key] = table?.findId?.(key) ?? null; }
      for (const id of (Array.isArray(args.ids) ? args.ids : []).slice(0, 256)) { const n = Number(id) >>> 0; names[n] = table?.entries?.get?.(n)?.[0]?.fullName ?? null; }
      return { ids, names };
    }
    case 'viewModels': return listViewModels(runtime, reader);
    case 'fragments': return readFragments(runtime, reader);
    case 'activity': { const rec = runtime.activity && reader.record(runtime.activity.ref); return rec ? { handle: handleOf(runtime, rec.id ?? runtime.activity.ref), className: dotted(rec.type) } : null; }
    case 'inspect': { const rec = liveRecord(runtime, args.handle); const result = reader.view({ ref: rec.id ?? parseHandle(runtime, args.handle) }, rec.type, args.options ?? {}); if (result.truncated && result.value && typeof result.value === 'object') result.value.$truncated = true; return result.value; }
    case 'field': { const target = resolvePath(runtime, reader, args.handle, args.path); const result = reader.view(target.value, target.type, { depth: 1, ...(args.options ?? {}) }); if (result.truncated && result.value && typeof result.value === 'object') result.value.$truncated = true; return result.value; }
    case 'statics': return readStatics(runtime, reader, args.className, args.options ?? {});
    case 'staticField': { const target = resolveStaticPath(runtime, reader, args.className, args.path); const result = reader.view(target.value, target.type, { depth: 1, ...(args.options ?? {}) }); if (result.truncated && result.value && typeof result.value === 'object') result.value.$truncated = true; return result.value; }
    case 'classes': return listClasses(runtime, args);
    case 'instances': return findInstances(runtime, reader, args.className, args);
    case 'referrers': return findReferrers(runtime, reader, args.handle, args);
    case 'compositionLocals': return readCompositionLocals(runtime, reader, args.handle, { options: args.options ?? {}, only: args.only ?? null });
    case 'findCompositionLocal': return findCompositionLocal(runtime, reader, args.match, { options: args.options ?? {}, limit: args.limit, budgetMs: args.budgetMs });
    default: throw new PluginQueryError('bad-query', `Consulta desconhecida: ${String(query).slice(0, 40)}`);
  }
}
