// "Dados do app": the running app's SharedPreferences and SQLite databases, read and edited from the page (Controles › Dados do app) and from MCP (lab_app_data).
// Nothing is reached around the app's own stack:
//  - SharedPreferences: every file of the app's shared_prefs directory, read through Context.getSharedPreferences(name) (the instance the app itself holds, so a value the app
//    put but has not written yet is what is shown) and edited through its Editor: putX / remove, then commit(). The in-memory map, the XML file and the app's own
//    OnSharedPreferenceChangeListeners see the change exactly as if the app had made it.
//  - SQLite: every database file of the app's databases directory, opened by the framework's SQLiteDatabase.openDatabase as a second connection (what `adb shell sqlite3` is on
//    a device): queries with rawQuery and a Cursor, changes with execSQL. The app's open connections see a change at their next transaction; observers the app keeps on its own
//    connection (Room's InvalidationTracker) are not told, as on a device.
// Runs inside the Worker between VM events (a request, like a click). DOM-free, no process.*.

const STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;', CONTEXT = 'Landroid/content/Context;', PREFS = 'Landroid/content/SharedPreferences;', EDITOR = 'Landroid/content/SharedPreferences$Editor;';
const STATEMENT = 'Landroid/database/sqlite/SQLiteStatement;', PROGRAM = 'Landroid/database/sqlite/SQLiteProgram;', DB = 'Landroid/database/sqlite/SQLiteDatabase;', CURSOR = 'Landroid/database/Cursor;', FACTORY = 'Landroid/database/sqlite/SQLiteDatabase$CursorFactory;';
const OPEN_READWRITE = 0, OPEN_READONLY = 1, FIELD_NULL = 0, FIELD_INTEGER = 1, FIELD_FLOAT = 2, FIELD_STRING = 3, FIELD_BLOB = 4;
export const PREF_TYPES = ['string', 'int', 'long', 'float', 'boolean', 'set'];
export const MAX_ROWS = 500, MAX_CELL_CHARS = 20000;
const CODES = { s: 'string', i: 'int', j: 'long', f: 'float', z: 'boolean', set: 'set' };

const fail = message => { throw Object.assign(new Error(message), { kind: 'app-data' }); };
const sig = (parameters, result) => `(${parameters.join('')})${result}`;
const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: sig(parameters, result) }, r.argumentWords(parameters, args, { receiver }), 'virtual');
const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: sig(parameters, result) }, r.argumentWords(parameters, args), 'static');
const text = (r, value) => (value === null || value === undefined ? null : typeof value === 'string' ? value : r.stringCharacters(value));
const quote = name => `"${String(name).replaceAll('"', '""')}"`;

/** The message of a Java exception thrown into host code (its class and getMessage()), or the error's own. */
function messageOf(r, error) {
  const thrown = error?.value ?? error?.javaException ?? null;
  if (thrown && typeof thrown === 'object' && thrown.ref !== undefined) {
    let message = null; try { message = text(r, call(r, thrown, 'Ljava/lang/Throwable;', 'getMessage', [], STRING)); } catch { /* none */ }
    return `${r.typeOf(thrown).slice(1, -1).replaceAll('/', '.')}${message ? `: ${message}` : ''}`;
  }
  return String(error?.message ?? error);
}

export function createAppStorage(runtime) {
  const r = runtime, platform = r.platform;
  const pkg = () => platform.packageName ?? fail('Nenhum app carregado');
  const fs = () => platform.javaIo.fs();
  const dataDir = () => `/data/user/0/${pkg()}`;
  const app = () => platform.application ?? fail('O app ainda não foi iniciado: abra o app para ver os dados dele');
  const guarded = fn => { try { return fn(); } catch (error) { if (error?.kind === 'app-data') throw error; fail(messageOf(r, error)); } };

  // ---- SharedPreferences
  const prefsNames = () => (fs().list(`${dataDir()}/shared_prefs`) ?? []).filter(name => name.endsWith('.xml')).map(name => name.slice(0, -4)).sort();
  const prefsOf = name => call(r, app(), CONTEXT, 'getSharedPreferences', [STRING, 'I'], PREFS, [String(name), 0]);
  const entryOut = (key, entry) => ({ key, type: CODES[entry.t], value: entry.t === 'j' ? String(entry.v) : entry.t === 'set' ? [...entry.v] : entry.v });
  function readPrefs(name) {
    const ref = prefsOf(name), state = r.object(ref).prefs;   // the SharedPreferencesImpl of src/app-services-host.js: its in-memory map is what getAll() answers
    if (!state) fail(`SharedPreferences ${name}: implementação inesperada`);
    return [...state.map].map(([key, entry]) => entryOut(key, entry)).sort((a, b) => a.key.localeCompare(b.key));
  }
  function javaSet(values) {
    const set = r.allocate('Ljava/util/HashSet;'); r.dispatch({ owner: 'Ljava/util/HashSet;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [set], 'direct');
    for (const value of values) call(r, set, 'Ljava/util/HashSet;', 'add', [OBJECT], 'Z', [String(value)]);
    return set;
  }
  /** The value of `type` for the Editor's putX: checked and converted like the page typed it. */
  function prefValue(type, value) {
    if (type === 'string') return String(value ?? '');
    if (type === 'boolean') { if (value === true || value === 'true') return 1; if (value === false || value === 'false') return 0; fail('Um boolean é true ou false'); }
    if (type === 'int') { const n = Number(value); if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) fail('Um int é um inteiro de 32 bits'); return n; }
    if (type === 'long') { let n; try { n = BigInt(String(value).trim()); } catch { fail('Um long é um inteiro de 64 bits'); } if (n < -(2n ** 63n) || n >= 2n ** 63n) fail('Um long é um inteiro de 64 bits'); return n; }
    if (type === 'float') { const n = Number(value); if (!Number.isFinite(n) && !['NaN', 'Infinity', '-Infinity'].includes(String(value))) fail('Um float é um número'); const bits = new DataView(new ArrayBuffer(4)); bits.setFloat32(0, n); return bits.getInt32(0); }
    if (type === 'set') { const list = Array.isArray(value) ? value : String(value ?? '').split('\n').filter(line => line !== ''); return javaSet(list.map(String)); }
    fail(`Tipo de preferência desconhecido: ${type} (use ${PREF_TYPES.join(', ')})`);
  }
  const PUT = { string: ['putString', STRING], int: ['putInt', 'I'], long: ['putLong', 'J'], float: ['putFloat', 'F'], boolean: ['putBoolean', 'Z'], set: ['putStringSet', 'Ljava/util/Set;'] };
  /** One Editor, the changes in order, commit(): { committed }. changes: [{ key, type, value } | { key, remove: true }] or { clear: true }. */
  function editPrefs(name, changes) {
    if (!/^[^/\0]{1,200}$/.test(String(name))) fail('Nome de SharedPreferences inválido');
    const editor = call(r, prefsOf(name), PREFS, 'edit', [], EDITOR);
    for (const change of changes) {
      if (change.clear) { call(r, editor, EDITOR, 'clear', [], EDITOR); continue; }
      const key = String(change.key ?? ''); if (!key) fail('A chave não pode ser vazia');
      if (change.remove) { call(r, editor, EDITOR, 'remove', [STRING], EDITOR, [key]); continue; }
      const [method, kind] = PUT[change.type] ?? fail(`Tipo de preferência desconhecido: ${change.type} (use ${PREF_TYPES.join(', ')})`);
      call(r, editor, EDITOR, method, [STRING, kind], EDITOR, [key, prefValue(change.type, change.value)]);
    }
    return { committed: !!call(r, editor, EDITOR, 'commit', [], 'Z') };
  }

  // ---- SQLite
  const DB_SUFFIXES = ['-journal', '-wal', '-shm', '-mj'];
  const dbNames = () => (fs().list(`${dataDir()}/databases`) ?? []).filter(name => !DB_SUFFIXES.some(suffix => name.endsWith(suffix)) && fs().stat(`${dataDir()}/databases/${name}`)?.type !== 'dir').sort();
  const dbPath = name => { if (!dbNames().includes(String(name))) fail(`Banco ${name} não existe em databases/ (há: ${dbNames().join(', ') || 'nenhum'})`); return `${dataDir()}/databases/${name}`; };
  function withDb(name, readOnly, use) {
    const db = callStatic(r, DB, 'openDatabase', [STRING, FACTORY, 'I'], DB, [dbPath(name), null, readOnly ? OPEN_READONLY : OPEN_READWRITE]);
    try { return use(db); } finally { try { call(r, db, DB, 'close', [], 'V'); } catch { /* already closed */ } }
  }
  function boxed(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return r.boxPrimitive('J', value ? 1n : 0n);
    if (typeof value === 'number') return Number.isInteger(value) ? r.boxPrimitive('J', BigInt(value)) : r.boxPrimitive('D', (() => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, value); return v.getBigInt64(0); })());
    if (typeof value === 'bigint') return r.boxPrimitive('J', value);
    return String(value);
  }
  function stringArray(values) { const array = r.newArray(`[${STRING}`, values.length); r.array(array).elements = values.map(v => (v === null || v === undefined ? null : String(v))); return array; }
  /** SQLiteProgram.bindX at a 1-based index, by the JavaScript type of the value (a { long } object is a 64-bit integer, a { hex } object a blob). */
  function bind(compiled, index, value) {
    if (value === null || value === undefined) return call(r, compiled, PROGRAM, 'bindNull', ['I'], 'V', [index]);
    if (typeof value === 'boolean') return call(r, compiled, PROGRAM, 'bindLong', ['I', 'J'], 'V', [index, value ? 1n : 0n]);
    if (typeof value === 'bigint' || (typeof value === 'object' && value.long !== undefined)) return call(r, compiled, PROGRAM, 'bindLong', ['I', 'J'], 'V', [index, BigInt.asIntN(64, BigInt(typeof value === 'bigint' ? value : value.long))]);
    if (typeof value === 'number') return Number.isInteger(value) ? call(r, compiled, PROGRAM, 'bindLong', ['I', 'J'], 'V', [index, BigInt(value)]) : call(r, compiled, PROGRAM, 'bindDouble', ['I', 'D'], 'V', [index, (() => { const v = new DataView(new ArrayBuffer(8)); v.setFloat64(0, value); return v.getBigInt64(0); })()]);
    if (typeof value === 'object' && typeof value.hex === 'string') { const hex = value.hex.replace(/\s+/g, ''); if (!/^([0-9a-f]{2})*$/i.test(hex)) fail('Um blob é escrito em hexadecimal'); const bytes = r.newArray('[B', hex.length / 2); r.array(bytes).elements = Array.from({ length: hex.length / 2 }, (_, k) => (parseInt(hex.slice(2 * k, 2 * k + 2), 16) << 24) >> 24); return call(r, compiled, PROGRAM, 'bindBlob', ['I', '[B'], 'V', [index, bytes]); }
    return call(r, compiled, PROGRAM, 'bindString', ['I', STRING], 'V', [index, String(value)]);
  }
  function objectArray(values) { const array = r.newArray(`[${OBJECT}`, values.length); r.array(array).elements = values.map(boxed); return array; }
  const doubleOf = bits => { const v = new DataView(new ArrayBuffer(8)); v.setBigInt64(0, BigInt.asIntN(64, BigInt(bits))); return v.getFloat64(0); };
  function readCursor(cursor, limit) {
    try {
      const columns = r.array(call(r, cursor, CURSOR, 'getColumnNames', [], `[${STRING}`)).elements.map(value => text(r, value)), rows = []; let more = false;
      while (call(r, cursor, CURSOR, 'moveToNext', [], 'Z')) {
        if (rows.length >= limit) { more = true; break; }
        rows.push(columns.map((_, i) => {
          const type = call(r, cursor, CURSOR, 'getType', ['I'], 'I', [i]);
          if (type === FIELD_NULL) return null;
          if (type === FIELD_INTEGER) { const v = BigInt.asIntN(64, BigInt(call(r, cursor, CURSOR, 'getLong', ['I'], 'J', [i]))); return Number.isSafeInteger(Number(v)) ? Number(v) : { long: String(v) }; }
          if (type === FIELD_FLOAT) return doubleOf(call(r, cursor, CURSOR, 'getDouble', ['I'], 'D', [i]));
          if (type === FIELD_BLOB) { const bytes = r.array(call(r, cursor, CURSOR, 'getBlob', ['I'], '[B', [i])).elements; return { blob: bytes.length, hex: bytes.slice(0, 64).map(b => (b & 255).toString(16).padStart(2, '0')).join('') }; }
          const value = text(r, call(r, cursor, CURSOR, 'getString', ['I'], STRING, [i])) ?? ''; return value.length > MAX_CELL_CHARS ? value.slice(0, MAX_CELL_CHARS) + '…' : value;
        }));
      }
      return { columns, rows, more };
    } finally { call(r, cursor, CURSOR, 'close', [], 'V'); }
  }
  const READS = /^\s*(select|pragma|with|explain|values)\b/i;
  /** One SQL statement with `?` parameters: rows for a query (at most `limit`), the changed row count otherwise. */
  function runSql(name, sql, params = [], { limit = 200 } = {}) {
    const statement = String(sql ?? '').trim(); if (!statement) fail('Escreva um comando SQL');
    limit = Math.max(1, Math.min(MAX_ROWS, Number(limit) || 200));
    return withDb(name, false, db => {
      if (READS.test(statement)) return { kind: 'rows', ...readCursor(call(r, db, DB, 'rawQuery', [STRING, `[${STRING}`], CURSOR, [statement, stringArray(params)]), limit) };
      // SQLiteStatement on the database's primary connection: executeInsert / executeUpdateDelete answer for the statement itself (a later "SELECT changes()" may run on
      // another connection of the pool), execute() for the rest (CREATE, DROP, PRAGMA with a value ...)
      const compiled = call(r, db, DB, 'compileStatement', [STRING], STATEMENT, [statement]);
      try {
        params.forEach((value, i) => bind(compiled, i + 1, value));
        if (/^\s*insert\b/i.test(statement)) { const rowid = BigInt.asIntN(64, BigInt(call(r, compiled, STATEMENT, 'executeInsert', [], 'J'))); return { kind: 'changes', changes: rowid >= 0n ? 1 : 0, rowid: Number(rowid) }; }
        if (/^\s*(update|delete|replace)\b/i.test(statement)) return { kind: 'changes', changes: call(r, compiled, STATEMENT, 'executeUpdateDelete', [], 'I') };
        call(r, compiled, STATEMENT, 'execute', [], 'V'); return { kind: 'changes', changes: null };
      } finally { call(r, compiled, STATEMENT, 'close', [], 'V'); }
    });
  }
  function describeDb(name) {
    return withDb(name, true, db => {
      const tables = readCursor(call(r, db, DB, 'rawQuery', [STRING, `[${STRING}`], CURSOR, ["SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name", stringArray([])]), MAX_ROWS).rows;
      return tables.map(([table, type]) => {
        const columns = readCursor(call(r, db, DB, 'rawQuery', [STRING, `[${STRING}`], CURSOR, [`PRAGMA table_info(${quote(table)})`, stringArray([])]), 1000).rows.map(row => ({ name: row[1], type: row[2], notNull: !!row[3], primaryKey: !!row[5] }));
        let rows = null; try { rows = readCursor(call(r, db, DB, 'rawQuery', [STRING, `[${STRING}`], CURSOR, [`SELECT count(*) FROM ${quote(table)}`, stringArray([])]), 1).rows[0]?.[0] ?? 0; } catch { rows = null; }
        let rowid = false; if (type === 'table') { try { readCursor(call(r, db, DB, 'rawQuery', [STRING, `[${STRING}`], CURSOR, [`SELECT rowid FROM ${quote(table)} LIMIT 0`, stringArray([])]), 1); rowid = true; } catch { rowid = false; } }   // WITHOUT ROWID tables: edited by primary key
        return { name: table, type, rows, columns, rowid };
      });
    });
  }
  /** A page of a table: rowid (when it has one) and every column. */
  function tableRows(name, table, { offset = 0, limit = 100 } = {}) {
    const info = describeDb(name).find(t => t.name === table) ?? fail(`Tabela ${table} não existe em ${name}`);
    const select = `SELECT ${info.rowid ? 'rowid AS "rowid", ' : ''}* FROM ${quote(table)} LIMIT ${Math.max(1, Math.min(MAX_ROWS, Number(limit) || 100))} OFFSET ${Math.max(0, Number(offset) || 0)}`;
    return { table: info, ...runSql(name, select, [], { limit }) };
  }
  /** One cell, one row added or one row removed, by rowid (or by primary key for a WITHOUT ROWID table): parameters, never values pasted into the SQL. */
  function editRow(name, table, { rowid = null, key = null, set = null, insert = null, remove = false }) {
    const info = describeDb(name).find(t => t.name === table && t.type === 'table') ?? fail(`Tabela ${table} não existe em ${name}`);
    const columns = new Set(info.columns.map(c => c.name)), checkColumns = object => { for (const column of Object.keys(object)) if (!columns.has(column)) fail(`A tabela ${table} não tem a coluna ${column}`); };
    const where = () => {
      if (info.rowid && rowid !== null && rowid !== undefined) return [' WHERE rowid = ?', [typeof rowid === 'object' ? BigInt(rowid.long) : rowid]];
      const keys = info.columns.filter(c => c.primaryKey); if (!keys.length || !key) fail('Diga qual linha: rowid, ou a chave primária em key');
      checkColumns(key); return [` WHERE ${keys.map(c => `${quote(c.name)} = ?`).join(' AND ')}`, keys.map(c => key[c.name])];
    };
    if (insert) { checkColumns(insert); const names = Object.keys(insert); return runSql(name, names.length ? `INSERT INTO ${quote(table)} (${names.map(quote).join(', ')}) VALUES (${names.map(() => '?').join(', ')})` : `INSERT INTO ${quote(table)} DEFAULT VALUES`, names.map(n => insert[n])); }
    if (remove) { const [clause, args] = where(); return runSql(name, `DELETE FROM ${quote(table)}${clause}`, args); }
    if (set) { checkColumns(set); const names = Object.keys(set); if (!names.length) fail('Nada para mudar'); const [clause, args] = where(); return runSql(name, `UPDATE ${quote(table)} SET ${names.map(n => `${quote(n)} = ?`).join(', ')}${clause}`, [...names.map(n => set[n]), ...args]); }
    fail('Diga o que fazer: set, insert ou remove');
  }

  return {
    /** Everything at a glance: each SharedPreferences file with its entries, each database with its tables. */
    overview() {
      return guarded(() => ({
        packageName: pkg(),
        prefs: prefsNames().map(name => { try { const entries = readPrefs(name); return { name, entries }; } catch (error) { return { name, error: messageOf(r, error), entries: [] }; } }),
        databases: dbNames().map(name => { const size = fs().stat(`${dataDir()}/databases/${name}`)?.size ?? null; try { return { name, size, tables: describeDb(name) }; } catch (error) { return { name, size, error: messageOf(r, error), tables: [] }; } }),
      }));
    },
    prefs: name => guarded(() => ({ name, entries: readPrefs(name) })),
    editPrefs: (name, changes) => guarded(() => ({ ...editPrefs(name, Array.isArray(changes) ? changes : [changes]), name, entries: readPrefs(name) })),
    tableRows: (name, table, options) => guarded(() => tableRows(name, table, options)),
    sql: (name, sql, params, options) => guarded(() => runSql(name, sql, params, options)),
    editRow: (name, table, change) => guarded(() => editRow(name, table, change)),
  };
}
