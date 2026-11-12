import data from './framework-constants-data.js?v=aad0dc0a4b80';

// Compile-time constants of the SDK classes (public static final primitives and Strings), as the platform's own class files carry them: the values reflection reads on Android
// (Class.getFields / getField / Field.get over android.Manifest$permission, android.os.Build$VERSION_CODES, Context.*_SERVICE, Settings.*, the framework R classes, ...). The table is
// generated from the SDK jar (scripts/build-framework-constants.py), constants only and limited to what exists at API 33. Classes with a body in the VM never come here.
const FLOAT = new DataView(new ArrayBuffer(8));
const table = data.classes, index = new Map();
const entryOf = type => table[type.slice(1, -1)], rowsOf = type => entryOf(type)?.[0];
/** The constant fields of `type` (a class descriptor), in declaration order: [{ name, type, flags }], or null when the SDK class has none. */
export function constantFields(type) {
  if (typeof type !== 'string' || type[0] !== 'L') return null;
  const rows = rowsOf(type); if (!rows) return null;
  return rows.map(([name, descriptor, , flags]) => ({ name, type: descriptor, flags }));
}
/** The declaration { name, type, flags } of a field the SDK class `type` has at API 33 that is not a compile-time constant (Build.MODEL, ...), or null; it declares a public or protected field `name` at API 33 that is not a compile-time constant (Build.MODEL, ...): reflection finds it but the lab has no value for it. */
export function nonConstantField(type, name) { const row = typeof type === 'string' && type[0] === 'L' ? entryOf(type)?.[1].find(entry => entry[0] === name) : null; return row ? { name, type: row[1], flags: row[2] } : null; }
/** True when `type` is an SDK class this table knows completely (every public field of it is either a constant or listed as non-constant). */
export function knownClass(type) { return typeof type === 'string' && type[0] === 'L' && !!entryOf(type); }
/** One constant: { name, type, flags, value } with the value in the VM's representation (floats as int bits, long and double as BigInt, boolean as 0/1), or null. */
export function constantField(type, name) {
  if (typeof type !== 'string' || type[0] !== 'L') return null;
  const key = type + '\0' + name; if (index.has(key)) return index.get(key);
  const rows = rowsOf(type); let found = null;
  if (rows) { const row = rows.find(entry => entry[0] === name); if (row) found = { name, type: row[1], flags: row[3], value: toValue(row[1], row[2]) }; }
  index.set(key, found); return found;
}
function toValue(descriptor, raw) {
  switch (descriptor) {
    case 'J': return BigInt(raw);
    case 'F': FLOAT.setFloat32(0, raw === 'NaN' ? NaN : raw === 'Infinity' ? Infinity : raw === '-Infinity' ? -Infinity : raw, true); return FLOAT.getInt32(0, true);
    case 'D': FLOAT.setFloat64(0, raw === 'NaN' ? NaN : raw === 'Infinity' ? Infinity : raw === '-Infinity' ? -Infinity : raw, true); return FLOAT.getBigInt64(0, true);
    default: return raw;   // String, int, short, byte, char and boolean (0 / 1) constants are stored as the VM holds them
  }
}
