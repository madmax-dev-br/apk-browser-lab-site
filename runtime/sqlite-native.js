import { APKError } from './apk-error.js?v=0c9f1b0d2456';
import { JavaException } from './apk-runtime.js?v=0c9f1b0d2456';
import { bitsDouble, doubleBits } from './host-contract.js?v=0c9f1b0d2456';

// Host bindings for the framework's SQLite natives.
//
// The Java side (android.database.*, android.database.sqlite.* of Android 13) is the original AOSP source compiled into the framework DEX.
// Its `native` methods are implemented here with the semantics of frameworks/base/core/jni/android_database_{SQLiteConnection,CursorWindow,
// SQLiteGlobal,SQLiteDebug,SQLiteCommon}.cpp over libs/androidfw/CursorWindow.cpp:
//   * SQLite is Android 13's own amalgamation + android/sqlite3_android.cpp compiled to Wasm (scripts/build-sqlite.sh, vendor/sqlite);
//   * database files live in the app's VirtualFileSystem through the Wasm VFS imports below, WAL-index memory is in-process;
//   * error codes map to the SQLite*Exception subclasses exactly like throw_sqlite3_exception;
//   * CursorWindow is a byte-exact port of androidfw::CursorWindow (16-byte slots growing down from the end, payload growing up, 16 KiB inline
//     window inflating to the requested size), so paging/"row too big" behaviour matches.
// Not provided (explicit failure, never emulated): Parcel (de)serialisation of a CursorWindow and nativeExecuteForBlobFileDescriptor (no
// ashmem/Binder in the browser), ICU collations (the lab ICU bundle has no collation data: a comparison through LOCALIZED/PHONEBOOK/UNICODE
// raises an APKError), and SQLite's trace/profile logging (no logcat).

const CONNECTION = 'Landroid/database/sqlite/SQLiteConnection;', WINDOW = 'Landroid/database/CursorWindow;', GLOBAL = 'Landroid/database/sqlite/SQLiteGlobal;', DEBUG = 'Landroid/database/sqlite/SQLiteDebug;';
const STRING = 'Ljava/lang/String;', BYTES = '[B';
const OK = 0, BUSY = 5, SQLITE_ROW = 100, SQLITE_DONE = 101, SQLITE_LOCKED = 6, SQLITE_TOOBIG = 18, SQLITE_TRANSIENT = -1;
const T_INTEGER = 1, T_FLOAT = 2, T_TEXT = 3, T_BLOB = 4, T_NULL = 5;
const OPEN_READONLY = 0x1, CREATE_IF_NECESSARY = 0x10000000;
const SQLITE_OPEN_READONLY = 1, SQLITE_OPEN_READWRITE = 2, SQLITE_OPEN_CREATE = 4, SQLITE_OPEN_DELETEONCLOSE = 8, SQLITE_OPEN_EXCLUSIVE = 16;
const BUSY_TIMEOUT_MS = 2500, SOFT_HEAP_LIMIT = 8 * 1024 * 1024;

// frameworks/base/core/jni/android_database_SQLiteCommon.cpp
const ERROR_NAMES = new Map(Object.entries({ 4: 'SQLITE_ABORT', 23: 'SQLITE_AUTH', 5: 'SQLITE_BUSY', 14: 'SQLITE_CANTOPEN', 19: 'SQLITE_CONSTRAINT', 11: 'SQLITE_CORRUPT', 101: 'SQLITE_DONE', 16: 'SQLITE_EMPTY', 1: 'SQLITE_ERROR',
  24: 'SQLITE_FORMAT', 13: 'SQLITE_FULL', 2: 'SQLITE_INTERNAL', 9: 'SQLITE_INTERRUPT', 10: 'SQLITE_IOERR', 6: 'SQLITE_LOCKED', 20: 'SQLITE_MISMATCH', 21: 'SQLITE_MISUSE', 22: 'SQLITE_NOLFS', 7: 'SQLITE_NOMEM',
  26: 'SQLITE_NOTADB', 12: 'SQLITE_NOTFOUND', 27: 'SQLITE_NOTICE', 0: 'SQLITE_OK', 3: 'SQLITE_PERM', 15: 'SQLITE_PROTOCOL', 25: 'SQLITE_RANGE', 8: 'SQLITE_READONLY', 100: 'SQLITE_ROW', 17: 'SQLITE_SCHEMA',
  18: 'SQLITE_TOOBIG', 28: 'SQLITE_WARNING', 516: 'SQLITE_ABORT_ROLLBACK', 261: 'SQLITE_BUSY_RECOVERY', 517: 'SQLITE_BUSY_SNAPSHOT', 1038: 'SQLITE_CANTOPEN_CONVPATH', 782: 'SQLITE_CANTOPEN_FULLPATH',
  526: 'SQLITE_CANTOPEN_ISDIR', 270: 'SQLITE_CANTOPEN_NOTEMPDIR', 275: 'SQLITE_CONSTRAINT_CHECK', 531: 'SQLITE_CONSTRAINT_COMMITHOOK', 787: 'SQLITE_CONSTRAINT_FOREIGNKEY', 1043: 'SQLITE_CONSTRAINT_FUNCTION',
  1299: 'SQLITE_CONSTRAINT_NOTNULL', 1555: 'SQLITE_CONSTRAINT_PRIMARYKEY', 2579: 'SQLITE_CONSTRAINT_ROWID', 1811: 'SQLITE_CONSTRAINT_TRIGGER', 2067: 'SQLITE_CONSTRAINT_UNIQUE', 2323: 'SQLITE_CONSTRAINT_VTAB',
  267: 'SQLITE_CORRUPT_VTAB', 3338: 'SQLITE_IOERR_ACCESS', 2826: 'SQLITE_IOERR_BLOCKED', 3594: 'SQLITE_IOERR_CHECKRESERVEDLOCK', 4106: 'SQLITE_IOERR_CLOSE', 6666: 'SQLITE_IOERR_CONVPATH', 2570: 'SQLITE_IOERR_DELETE',
  5898: 'SQLITE_IOERR_DELETE_NOENT', 4362: 'SQLITE_IOERR_DIR_CLOSE', 1290: 'SQLITE_IOERR_DIR_FSYNC', 1802: 'SQLITE_IOERR_FSTAT', 1034: 'SQLITE_IOERR_FSYNC', 6410: 'SQLITE_IOERR_GETTEMPPATH', 3850: 'SQLITE_IOERR_LOCK',
  6154: 'SQLITE_IOERR_MMAP', 3082: 'SQLITE_IOERR_NOMEM', 2314: 'SQLITE_IOERR_RDLOCK', 266: 'SQLITE_IOERR_READ', 5642: 'SQLITE_IOERR_SEEK', 5130: 'SQLITE_IOERR_SHMLOCK', 5386: 'SQLITE_IOERR_SHMMAP', 4618: 'SQLITE_IOERR_SHMOPEN',
  4874: 'SQLITE_IOERR_SHMSIZE', 522: 'SQLITE_IOERR_SHORT_READ', 1546: 'SQLITE_IOERR_TRUNCATE', 2058: 'SQLITE_IOERR_UNLOCK', 778: 'SQLITE_IOERR_WRITE', 262: 'SQLITE_LOCKED_SHAREDCACHE', 539: 'SQLITE_NOTICE_RECOVER_ROLLBACK',
  283: 'SQLITE_NOTICE_RECOVER_WAL', 256: 'SQLITE_OK_LOAD_PERMANENTLY', 520: 'SQLITE_READONLY_CANTLOCK', 1032: 'SQLITE_READONLY_DBMOVED', 264: 'SQLITE_READONLY_RECOVERY', 776: 'SQLITE_READONLY_ROLLBACK', 284: 'SQLITE_WARNING_AUTOINDEX',
}).map(([code, name]) => [Number(code), name]));
const EXCEPTIONS = new Map([[10, 'SQLiteDiskIOException'], [11, 'SQLiteDatabaseCorruptException'], [26, 'SQLiteDatabaseCorruptException'], [19, 'SQLiteConstraintException'], [4, 'SQLiteAbortException'], [101, 'SQLiteDoneException'],
  [13, 'SQLiteFullException'], [21, 'SQLiteMisuseException'], [3, 'SQLiteAccessPermException'], [5, 'SQLiteDatabaseLockedException'], [6, 'SQLiteTableLockedException'], [8, 'SQLiteReadOnlyDatabaseException'],
  [14, 'SQLiteCantOpenDatabaseException'], [18, 'SQLiteBlobTooBigException'], [25, 'SQLiteBindOrColumnIndexOutOfRangeException'], [7, 'SQLiteOutOfMemoryException'], [20, 'SQLiteDatatypeMismatchException']]);

const decoder = new TextDecoder('utf-8'), encoder = new TextEncoder(), utf16 = new TextDecoder('utf-16le');
const fail = (message, kind = 'sqlite-native-boundary') => { throw new APKError(message, { kind, backend: 'android13-sqlite3.32.2/Wasm' }); };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// androidfw::CursorWindow
const K_INLINE_SIZE = 16384, SLOT_SHIFT = 4, SLOT_SIZE = 16;
const STATUS_OK = 0, NO_MEMORY = -12, INVALID_OPERATION = -38, BAD_VALUE = -22;
export const FIELD_NULL = 0, FIELD_INTEGER = 1, FIELD_FLOAT = 2, FIELD_STRING = 3, FIELD_BLOB = 4;

export class AndroidCursorWindow {
  constructor(name, inflatedSize) {
    this.name = name; this.size = Math.min(K_INLINE_SIZE, inflatedSize); this.inflatedSize = inflatedSize;
    this.data = new Uint8Array(this.size); this.view = new DataView(this.data.buffer);
    this.allocOffset = 0; this.slotsOffset = this.size; this.numRows = 0; this.numColumns = 0; this.clear();
  }
  clear() { this.allocOffset = 0; this.slotsOffset = this.size; this.numRows = 0; this.numColumns = 0; return STATUS_OK; }
  freeSpace() { return this.slotsOffset - this.allocOffset; }
  maybeInflate() {
    if (this.size === this.inflatedSize) return INVALID_OPERATION;
    const slotsSize = this.size - this.slotsOffset, newSlotsOffset = this.inflatedSize - slotsSize, grown = new Uint8Array(this.inflatedSize);
    grown.set(this.data.subarray(0, this.allocOffset), 0); grown.set(this.data.subarray(this.slotsOffset, this.size), newSlotsOffset);
    this.data = grown; this.view = new DataView(grown.buffer); this.size = this.inflatedSize; this.slotsOffset = newSlotsOffset; return STATUS_OK;
  }
  setNumColumns(columns) {
    if ((this.numColumns > 0 || this.numRows > 0) && this.numColumns !== columns) return INVALID_OPERATION;
    this.numColumns = columns >>> 0; return STATUS_OK;
  }
  allocRow() {
    const size = this.numColumns * SLOT_SIZE; let newOffset = this.slotsOffset - size;
    if (newOffset < this.allocOffset) { this.maybeInflate(); newOffset = this.slotsOffset - size; if (newOffset < this.allocOffset) return NO_MEMORY; }
    this.data.fill(0, newOffset, newOffset + size); this.slotsOffset = newOffset; this.numRows++; return STATUS_OK;
  }
  freeLastRow() {
    const size = this.numColumns * SLOT_SIZE, newOffset = this.slotsOffset + size; if (newOffset > this.size) return NO_MEMORY;
    this.slotsOffset = newOffset; this.numRows--; return STATUS_OK;
  }
  alloc(size) {
    const aligned = (size + 3) & ~3; let newOffset = this.allocOffset + aligned;
    if (newOffset > this.slotsOffset) { this.maybeInflate(); newOffset = this.allocOffset + aligned; if (newOffset > this.slotsOffset) return { status: NO_MEMORY }; }
    const offset = this.allocOffset; this.allocOffset = newOffset; return { status: STATUS_OK, offset };
  }
  /** Byte position of the 16-byte slot, or -1 for a row/column outside the window (androidfw logs and returns NULL). */
  slot(row, column) {
    row >>>= 0; column >>>= 0;
    const position = (this.size - SLOT_SIZE) - (((row * this.numColumns) + column) * SLOT_SIZE);
    return position < this.slotsOffset || position > this.size - SLOT_SIZE || column >= this.numColumns ? -1 : position;
  }
  putBlobOrString(row, column, bytes, type) {
    if (this.slot(row, column) < 0) return BAD_VALUE;
    const allocation = this.alloc(bytes.length); if (allocation.status) return NO_MEMORY;
    this.data.set(bytes, allocation.offset);
    const slot = this.slot(row, column); // alloc() may have inflated the window and moved the slot directory: re-fetch like androidfw
    this.view.setInt32(slot, type, true); this.view.setUint32(slot + 4, allocation.offset, true); this.view.setUint32(slot + 8, bytes.length, true); return STATUS_OK;
  }
  putBlob(row, column, bytes) { return this.putBlobOrString(row, column, bytes, FIELD_BLOB); }
  putString(row, column, bytesIncludingNull) { return this.putBlobOrString(row, column, bytesIncludingNull, FIELD_STRING); }
  putLong(row, column, value) { const slot = this.slot(row, column); if (slot < 0) return BAD_VALUE; this.view.setInt32(slot, FIELD_INTEGER, true); this.view.setBigInt64(slot + 4, BigInt.asIntN(64, value), true); return STATUS_OK; }
  putDouble(row, column, value) { const slot = this.slot(row, column); if (slot < 0) return BAD_VALUE; this.view.setInt32(slot, FIELD_FLOAT, true); this.view.setFloat64(slot + 4, value, true); return STATUS_OK; }
  putNull(row, column) { const slot = this.slot(row, column); if (slot < 0) return BAD_VALUE; this.view.setInt32(slot, FIELD_NULL, true); this.view.setUint32(slot + 4, 0, true); this.view.setUint32(slot + 8, 0, true); return STATUS_OK; }
  type(slot) { return this.view.getInt32(slot, true); }
  long(slot) { return this.view.getBigInt64(slot + 4, true); }
  double(slot) { return this.view.getFloat64(slot + 4, true); }
  /** getFieldSlotValueString/Blob: the payload bytes, or null when offsetToPtr rejects the (offset, size) pair. */
  payload(slot) {
    const offset = this.view.getUint32(slot + 4, true), size = this.view.getUint32(slot + 8, true);
    return offset > this.size || offset + size > this.size ? null : this.data.subarray(offset, offset + size);
  }
}

/** JNI GetStringUTFChars encoding: modified UTF-8 (NUL as C0 80, supplementary characters as two 3-byte surrogate sequences). */
function modifiedUtf8(text) {
  let ascii = true; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c === 0 || c > 0x7f) { ascii = false; break; } }
  if (ascii) return encoder.encode(text);
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c !== 0 && c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Wasm engine
export class SqliteProvider {
  constructor({ baseURL = new URL('../vendor/sqlite/', import.meta.url), fetchImpl, wasmBytes, metadata } = {}) {
    this.baseURL = new URL(baseURL, import.meta.url); this.fetchImpl = fetchImpl || (url => globalThis.fetch(url)); this.wasmBytes = wasmBytes; this.metadata = metadata;
  }
  async read(url, maximum) {
    const response = await this.fetchImpl(url); if (!response.ok) fail(`SQLite asset unavailable (HTTP ${response.status})`);
    const buffer = await response.arrayBuffer(); if (buffer.byteLength > maximum) fail('SQLite asset exceeds bounded size'); return new Uint8Array(buffer);
  }
  load() { return this.promise ??= this.initialize().catch(error => { this.promise = null; throw error; }); }
  async initialize() {
    const metadata = this.metadata || JSON.parse(decoder.decode(await this.read(new URL('provenance.json', this.baseURL), 256 * 1024)));
    if (metadata.schemaVersion !== 1 || metadata.sqliteVersion !== '3.32.2' || !/^[0-9a-f]{64}$/.test(metadata.sha256 ?? '')) fail('Unsupported SQLite provenance');
    const bytes = this.wasmBytes || await this.read(new URL(metadata.file, this.baseURL), 8 * 1024 * 1024);
    const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== metadata.sha256 || bytes.length !== metadata.bytes) fail('SQLite Wasm does not match its pinned SHA-256', 'sqlite-hash-mismatch');
    return { module: await WebAssembly.compile(bytes), metadata: { ...metadata, source: 'android-13.0.0_r1 external/sqlite/Wasm', verified: true } };
  }
}

const lockRules = {
  // level -> predicate over the highest level any other handle holds on the same file (unix VFS semantics, single process)
  1: others => others >= 3, 2: others => others >= 2, 3: others => others >= 3, 4: others => others >= 1,
};

class SqliteEngine {
  constructor({ module, metadata }, runtime) {
    this.runtime = runtime; this.metadata = metadata; this.files = new Map(); this.nextHandle = 1; this.locks = new Map(); this.functions = new Map(); this.nextFunction = 1;
    this.aggregates = new Map(); this.pending = null; this.diagnostics = []; this.statements = 0; this.stringCache = null;
    const fs = () => runtime.platform.javaIo.fs(), self = this;
    const memory = () => new Uint8Array(this.x.memory.buffer), view = () => new DataView(this.x.memory.buffer);
    const path = pointer => pointer ? this.cstr(pointer) : null;
    const handle = h => this.files.get(h) ?? fail(`SQLite VFS used closed file handle ${h}`);
    const imports = {
      apkweb_sqlite: {
        fs_open(pathPointer, flags, outFlags) {
          let granted = flags, node, name = path(pathPointer);
          const files = fs();
          if (name === null) node = { type: 'file', buf: new Uint8Array(0), size: 0, mtime: Date.now(), mode: 0o600 };
          else {
            const p = files.canonical(name); node = files.node(p);
            if (node && (flags & SQLITE_OPEN_EXCLUSIVE) && (flags & SQLITE_OPEN_CREATE)) return -14;
            if (node?.type === 'dir') return -526;
            let readOnlyFs = files.isReadOnly(p) || node?.mounted;
            if (!node) {
              if (!(flags & SQLITE_OPEN_CREATE)) return -14;
              const created = files.open(p, { create: true, write: true }); if (typeof created === 'string') return -14; node = created;
            } else if ((flags & SQLITE_OPEN_READWRITE) && readOnlyFs) {
              if (flags & SQLITE_OPEN_EXCLUSIVE) return -14;
              granted = (flags & ~(SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)) | SQLITE_OPEN_READONLY; // unix VFS falls back to read-only
            }
            name = p;
          }
          const h = self.nextHandle++; self.files.set(h, { path: name, node, readOnly: !(granted & SQLITE_OPEN_READWRITE), deleteOnClose: !!(flags & SQLITE_OPEN_DELETEONCLOSE), level: 0 });
          if (outFlags) view().setInt32(outFlags, granted, true); return h;
        },
        fs_close(h) {
          const file = handle(h); self.setLevel(h, file, 0); self.files.delete(h); self.commitPoint('sqlite-close');
          if (file.deleteOnClose && file.path !== null) fs().delete(file.path); return 0;
        },
        fs_read(h, buffer, count, offset) {
          const file = handle(h), target = memory().subarray(buffer, buffer + count), got = fs().readAt(file.node, Number(offset), target, 0, count); return got < 0 ? 0 : got;
        },
        fs_write(h, buffer, count, offset) {
          const file = handle(h); if (file.readOnly) return -1;
          try { fs().writeAt(file.node, Number(offset), memory().subarray(buffer, buffer + count), 0, count); self.dirty = true; return 0; } catch (error) { if (error instanceof RangeError) return -2; throw error; }
        },
        fs_truncate(h, size) {
          const file = handle(h), target = Number(size); if (file.readOnly) return 1;
          if (target < file.node.size) { file.node.size = target; file.node.mtime = Date.now(); file.node.rev = (file.node.rev ?? 0) + 1; self.dirty = true; } else if (target > file.node.size) fs().writeAt(file.node, target, new Uint8Array(0), 0, 0); return 0;
        },
        fs_size(h) { return BigInt(handle(h).node.size); },
        fs_delete(pointer) { const files = fs(), p = path(pointer), node = files.node(p); if (!node) return 1; return node.type === 'file' && files.delete(p) === 'ok' ? 0 : 2; },
        fs_access(pointer, flags) {
          const files = fs(), p = path(pointer), node = files.node(p); if (!node) return 0;
          return flags === 1 && (files.isReadOnly(p) || node.mounted) ? 0 : 1;
        },
        fs_fullpath(inPointer, capacity, outPointer) {
          const full = encoder.encode(fs().canonical(path(inPointer))); if (full.length + 1 > capacity) return 1;
          const bytes = memory(); bytes.set(full, outPointer); bytes[outPointer + full.length] = 0; return 0;
        },
        fs_lock(h, level) { const file = handle(h); return self.lock(h, file, level); },
        fs_unlock(h, level) { const file = handle(h), wasWriting = file.level >= 2; self.setLevel(h, file, level); if (wasWriting && level < 2) self.commitPoint('sqlite-unlock'); return 0; },
        fs_check_reserved(h) { const file = handle(h); if (file.path === null) return 0; for (const [other, state] of self.fileGroup(file.path)) if (other !== h && state.level >= 2) return 1; return 0; },
        host_now_ms() { return runtime.clock.wall(); },
        host_random(buffer, count) { globalThis.crypto.getRandomValues(memory().subarray(buffer, buffer + count)); },
        host_log(code, pointer) { if (self.diagnostics.length < 200) self.diagnostics.push({ code, message: self.cstr(pointer) }); },
        host_unavailable_collation(which) {
          self.pending ??= { kind: 'sqlite-icu-collation-unavailable', collation: ['', 'LOCALIZED', 'PHONEBOOK', 'UNICODE'][which] };
        },
        fn_scalar(fn, context, argc, argv) { self.callScalar(fn, context, argv); },
        fn_step(fn, context, argc, argv) { self.callStep(fn, context, argv); },
        fn_final(fn, context) { self.callFinal(context); },
        fn_destroy(fn) { self.functions.delete(fn); },
      },
      wasi_snapshot_preview1: {
        environ_sizes_get(count, size) { const v = view(); v.setUint32(count, 0, true); v.setUint32(size, 0, true); return 0; },
        environ_get() { return 0; }, fd_close() { return 0; },
      },
      env: { emscripten_notify_memory_growth() {} },
    };
    for (const entry of WebAssembly.Module.imports(module)) if (!imports[entry.module]?.[entry.name]) fail(`SQLite Wasm imports unsupported host function ${entry.module}.${entry.name}`);
    this.x = new WebAssembly.Instance(module, imports).exports; this.x._initialize?.();
    const rc = this.x.apkweb_sqlite_initialize(); if (rc !== OK) fail(`sqlite3_initialize failed (${rc})`);
    this.scratch = this.x.malloc(64);
  }
  // ---- memory helpers
  bytes() { return new Uint8Array(this.x.memory.buffer); }
  view() { return new DataView(this.x.memory.buffer); }
  cstr(pointer) {
    if (!pointer) return null; const bytes = this.bytes(); let end = pointer; while (bytes[end]) end++; return decoder.decode(bytes.subarray(pointer, end));
  }
  allocBytes(data, terminator = 0) {
    const pointer = this.x.malloc(data.length + terminator + 1); if (!pointer) fail('SQLite Wasm heap exhausted');
    const bytes = this.bytes(); bytes.set(data, pointer); bytes.fill(0, pointer + data.length, pointer + data.length + terminator + 1); return pointer;
  }
  allocString(text) { return this.allocBytes(encoder.encode(text)); }
  allocUtf16(text) {
    const pointer = this.x.malloc(text.length * 2 + 2); if (!pointer) fail('SQLite Wasm heap exhausted');
    const v = this.view(); for (let i = 0; i < text.length; i++) v.setUint16(pointer + i * 2, text.charCodeAt(i), true); v.setUint16(pointer + text.length * 2, 0, true); return pointer;
  }
  readUtf16(pointer, units) { return units === 0 ? '' : utf16.decode(this.bytes().subarray(pointer, pointer + units * 2)); }
  // ---- file locks (unix VFS lock ladder for connections of this process)
  fileGroup(path) { return [...this.files].filter(([, state]) => state.path === path); }
  lock(h, file, level) {
    if (file.path === null) { file.level = level; return OK; }
    let others = 0; for (const [other, state] of this.fileGroup(file.path)) if (other !== h) others = Math.max(others, state.level);
    if (lockRules[level](others)) { if (level === 4) file.level = Math.max(file.level, 3); return BUSY; }
    file.level = level; return OK;
  }
  setLevel(_h, file, level) { file.level = level; }
  /** A write transaction ended (or a connection/file closed): lets app-data persistence store what SQLite just committed. Only acts when files were written since the last point. */
  commitPoint(reason) { if (!this.dirty) return; this.dirty = false; this.runtime.platform.appData?.syncPoint(reason); }
  /** An error the host raised from inside a Wasm callback (e.g. an ICU collation this lab cannot provide); surfaced after the SQLite call returns. */
  takePending() {
    const pending = this.pending; if (!pending) return;
    this.pending = null;
    fail(`SQLite collation ${pending.collation} needs ICU collation data, which the lab ICU bundle does not contain`, pending.kind);
  }
  // ---- custom functions (SQLiteDatabase.setCustomScalarFunction/setCustomAggregateFunction)
  registerFunction(object, kind) { const id = this.nextFunction++; this.functions.set(id, { object, kind }); return id; }
  stringArg(value) { const pointer = this.x.sqlite3_value_text(value); return pointer ? this.cstr(pointer) : null; }
  setTextResult(context, text) {
    const pointer = this.allocString(text); this.x.sqlite3_result_text(context, pointer, -1, SQLITE_TRANSIENT); this.x.free(pointer);
  }
  setErrorResult(context, message) { const pointer = this.allocString(message); this.x.sqlite3_result_error(context, pointer, -1); this.x.free(pointer); }
  invoke(owner, signature, parameters, object, args, context, failureMessage) {
    try {
      return { value: this.runtime.dispatch({ owner, name: 'apply', parameters, result: 'Ljava/lang/Object;', signature }, [object, ...args], 'virtual') };
    } catch (error) {
      if (!(error instanceof JavaException)) throw error;
      this.diagnostics.push({ code: 1, message: failureMessage }); this.setErrorResult(context, failureMessage); return null;
    }
  }
  callScalar(fn, context, argv) {
    const { object } = this.functions.get(fn), arg = this.stringArg(this.view().getUint32(argv, true));
    const result = this.invoke('Ljava/util/function/UnaryOperator;', '(Ljava/lang/Object;)Ljava/lang/Object;', ['Ljava/lang/Object;'], object, [arg], context, 'Exception thrown by custom scalar function');
    if (!result) return;
    if (result.value === null || result.value === 0) this.x.sqlite3_result_null(context); else this.setTextResult(context, this.runtime.stringCharacters(result.value));
  }
  callStep(fn, context, argv) {
    const slot = this.x.sqlite3_aggregate_context(context, 4); if (!slot) return;
    const arg = this.stringArg(this.view().getUint32(argv, true)), state = this.aggregates.get(slot) ?? null;
    if (state === null) { this.aggregates.set(slot, arg); return; }
    const { object } = this.functions.get(fn);
    const result = this.invoke('Ljava/util/function/BinaryOperator;', '(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;', ['Ljava/lang/Object;', 'Ljava/lang/Object;'], object, [state, arg], context, 'Exception thrown by custom aggregate function');
    if (!result) return;
    this.aggregates.set(slot, result.value === null || result.value === 0 ? null : this.runtime.stringCharacters(result.value));
  }
  callFinal(context) {
    const slot = this.x.sqlite3_aggregate_context(context, 0); if (!slot) return;
    const state = this.aggregates.get(slot) ?? null; this.aggregates.delete(slot);
    if (state === null) this.x.sqlite3_result_null(context); else this.setTextResult(context, state);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// framework natives
const states = new WeakMap();
function stateFor(r) {
  let state = states.get(r); if (state) return state;
  const backend = r.sqliteBackend; if (!backend?.module) fail('SQLite requires the verified Android 13 SQLite Wasm backend (options.sqliteProvider)', 'sqlite-backend-missing');
  state = { engine: new SqliteEngine(backend, r), connections: new Map(), windows: new Map(), nextWindow: 1n }; states.set(r, state); r.sqliteMetadata = backend.metadata; return state;
}

function newException(r, type, message) {
  if (type.startsWith('Ljava/')) r.throwJava(type, message);
  const reference = r.allocate(type);
  r.dispatch({ owner: type, name: '<init>', parameters: [STRING], result: 'V', signature: `(${STRING})V` }, [reference, message], 'direct');
  r.throwJavaReference(reference, message);
}
/** android_database_SQLiteCommon.cpp throw_sqlite3_exception(env, errcode, sqlite3Message, message). */
function throwSqlite(r, errcode, sqlite3Message, message) {
  const code = errcode & 0xff;
  const simple = EXCEPTIONS.get(code);
  const type = code === 9 ? 'Landroid/os/OperationCanceledException;' : `Landroid/database/sqlite/${simple ?? 'SQLiteException'};`;
  if (code === 101) sqlite3Message = null; // SQLiteDoneException: the SQLite message is irrelevant
  if (sqlite3Message !== null && sqlite3Message !== undefined) {
    let full = `${sqlite3Message} (code ${ERROR_NAMES.has(errcode) ? `${errcode} ${ERROR_NAMES.get(errcode)}` : errcode})`;
    if (message !== null && message !== undefined) full += `: ${message}`;
    newException(r, type, full);
  } else newException(r, type, message ?? null);
}
const throwHandle = (r, engine, db, message = null) => throwSqlite(r, engine.x.sqlite3_extended_errcode(db), engine.cstr(engine.x.sqlite3_errmsg(db)), message);
const throwPlain = (r, message) => throwSqlite(r, 0, 'unknown error', message);

const connectionOf = (r, handle) => { const connection = stateFor(r).connections.get(handle); if (!connection) fail('Invalid or closed SQLiteConnection native pointer'); return connection; };
const windowOf = (r, handle) => { const window = stateFor(r).windows.get(handle); if (!window) fail('Invalid or disposed CursorWindow native pointer'); return window; };
const stmtPointer = handle => Number(BigInt.asUintN(32, handle));

export function createSqliteNativeBindings() {
  const bindings = new Map(), add = (owner, signature, callback) => bindings.set(`${owner}->${signature}`, callback);
  const checked = (r, connection) => { connection.engine.takePending(); return connection; };

  // ---- SQLiteGlobal / SQLiteDebug
  add(GLOBAL, 'nativeReleaseMemory()I', r => stateFor(r).engine.x.sqlite3_release_memory(SOFT_HEAP_LIMIT));
  add(DEBUG, 'nativeGetPagerStats(Landroid/database/sqlite/SQLiteDebug$PagerStats;)V', (r, [stats]) => {
    const { engine } = stateFor(r), s = engine.scratch, fields = r.object(stats).fields, key = name => `Landroid/database/sqlite/SQLiteDebug$PagerStats;->${name}:I`, read = at => engine.view().getInt32(s + at, true);
    engine.x.sqlite3_status(0, s, s + 4, 0); const used = read(0);                  // SQLITE_STATUS_MEMORY_USED
    engine.x.sqlite3_status(5, s, s + 4, 0); const largest = read(4);               // SQLITE_STATUS_MALLOC_SIZE (high water)
    engine.x.sqlite3_status(2, s, s + 4, 0); const overflow = read(0);              // SQLITE_STATUS_PAGECACHE_OVERFLOW
    r.storeField(fields, key('memoryUsed'), used); r.storeField(fields, key('pageCacheOverflow'), overflow); r.storeField(fields, key('largestMemAlloc'), largest);
  });

  // ---- SQLiteConnection
  add(CONNECTION, `nativeOpen(${STRING}I${STRING}ZZII)J`, (r, [pathValue, openFlags, labelValue, enableTrace, enableProfile, lookasideSize, lookasideCount]) => {
    const { engine, connections } = stateFor(r), x = engine.x;
    const sqliteFlags = openFlags & CREATE_IF_NECESSARY ? SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE : openFlags & OPEN_READONLY ? SQLITE_OPEN_READONLY : SQLITE_OPEN_READWRITE;
    const path = r.stringCharacters(pathValue), label = r.stringCharacters(labelValue), pathPointer = engine.allocBytes(modifiedUtf8(path)), out = engine.scratch;
    const err = x.sqlite3_open_v2(pathPointer, out, sqliteFlags, 0); x.free(pathPointer);
    const db = engine.view().getUint32(out, true);
    if (err !== OK) { if (db) x.sqlite3_close(db); throwSqlite(r, err, 'unknown error', 'Could not open database'); }
    const closeAndThrow = message => { try { throwHandle(r, engine, db, message); } finally { x.sqlite3_close(db); } };
    if (lookasideSize >= 0 && lookasideCount >= 0 && x.apkweb_set_lookaside(db, lookasideSize, lookasideCount) !== OK) closeAndThrow('Cannot set lookaside');
    if ((sqliteFlags & SQLITE_OPEN_READWRITE) && x.sqlite3_db_readonly(db, 0)) closeAndThrow('Could not open the database in read/write mode.');
    if (x.sqlite3_busy_timeout(db, BUSY_TIMEOUT_MS) !== OK) closeAndThrow('Could not set busy timeout');
    if (x.register_android_functions(db, 0) !== OK || x.apkweb_register_unavailable_collation(db, 3) !== OK) closeAndThrow('Could not register Android SQL functions.');
    // sqlite3_trace/sqlite3_profile only log to logcat; the lab has none, so enableTrace/enableProfile have no observable effect.
    const flag = x.malloc(4); engine.view().setInt32(flag, 0, true);
    const handle = BigInt(db); connections.set(handle, { engine, db, flag, openFlags, path, label, enableTrace: !!enableTrace, enableProfile: !!enableProfile });
    return handle;
  });
  add(CONNECTION, 'nativeClose(J)V', (r, [handle]) => {
    if (!handle) return; const connection = connectionOf(r, handle), { engine, db } = connection;
    const err = engine.x.sqlite3_close(db); if (err !== OK) throwHandle(r, engine, db, 'Count not close db.');
    engine.x.free(connection.flag); stateFor(r).connections.delete(handle);
  });
  add(CONNECTION, `nativeRegisterCustomScalarFunction(JLjava/lang/String;Ljava/util/function/UnaryOperator;)V`, (r, [handle, name, object]) => {
    const { engine, db } = connectionOf(r, handle), id = engine.registerFunction(object, 'scalar'), pointer = engine.allocString(r.stringCharacters(name));
    const err = engine.x.apkweb_create_scalar(db, pointer, id); engine.x.free(pointer); if (err !== OK) { engine.functions.delete(id); throwHandle(r, engine, db); }
  });
  add(CONNECTION, `nativeRegisterCustomAggregateFunction(JLjava/lang/String;Ljava/util/function/BinaryOperator;)V`, (r, [handle, name, object]) => {
    const { engine, db } = connectionOf(r, handle), id = engine.registerFunction(object, 'aggregate'), pointer = engine.allocString(r.stringCharacters(name));
    const err = engine.x.apkweb_create_aggregate(db, pointer, id); engine.x.free(pointer); if (err !== OK) { engine.functions.delete(id); throwHandle(r, engine, db); }
  });
  add(CONNECTION, `nativeRegisterLocalizedCollators(J${STRING})V`, (r, [handle, locale]) => {
    // register_localized_collators() installs ICU collators named LOCALIZED and PHONEBOOK. Without ICU collation data they are registered as
    // collations whose comparison raises an explicit host failure; they are not approximated by another ordering.
    const { engine, db } = connectionOf(r, handle); r.stringCharacters(locale);
    for (const which of [1, 2]) { const err = engine.x.apkweb_register_unavailable_collation(db, which); if (err !== OK) throwHandle(r, engine, db); }
    r.record('SQLITE localized collators registered as explicit-failure stand-ins [no ICU collation data in the lab bundle]');
  });
  add(CONNECTION, `nativePrepareStatement(J${STRING})J`, (r, [handle, sqlValue]) => {
    const connection = connectionOf(r, handle), { engine, db } = connection, sql = r.stringCharacters(sqlValue), sqlPointer = engine.allocUtf16(sql), out = engine.scratch;
    const err = engine.x.sqlite3_prepare16_v2(db, sqlPointer, sql.length * 2, out, 0); engine.x.free(sqlPointer);
    checked(r, connection);
    if (err !== OK) throwHandle(r, engine, db, `, while compiling: ${sql}`);
    const handleOut = BigInt(engine.view().getUint32(out, true)); (connection.sqls ??= new Map()).set(Number(handleOut), sql); return handleOut;
  });
  const statement = (r, [handle, statementHandle]) => ({ connection: connectionOf(r, handle), stmt: stmtPointer(statementHandle) });
  add(CONNECTION, 'nativeFinalizeStatement(JJ)V', (r, args) => { const { connection, stmt } = statement(r, args); connection.engine.x.sqlite3_finalize(stmt); connection.sqls?.delete(stmt); });
  add(CONNECTION, 'nativeGetParameterCount(JJ)I', (r, args) => { const { connection, stmt } = statement(r, args); return connection.engine.x.sqlite3_bind_parameter_count(stmt); });
  add(CONNECTION, 'nativeIsReadOnly(JJ)Z', (r, args) => { const { connection, stmt } = statement(r, args); return connection.engine.x.sqlite3_stmt_readonly(stmt) !== 0 ? 1 : 0; });
  add(CONNECTION, 'nativeGetColumnCount(JJ)I', (r, args) => { const { connection, stmt } = statement(r, args); return connection.engine.x.sqlite3_column_count(stmt); });
  add(CONNECTION, `nativeGetColumnName(JJI)${STRING}`, (r, args) => {
    const { connection, stmt } = statement(r, args), { engine } = connection, pointer = engine.x.sqlite3_column_name16(stmt, args[2]); if (!pointer) return null;
    const bytes = engine.bytes(); let end = pointer; while (bytes[end] || bytes[end + 1]) end += 2; return engine.readUtf16(pointer, (end - pointer) / 2);
  });
  const bind = (r, args, call) => { const { connection, stmt } = statement(r, args); if (call(connection.engine, stmt) !== OK) throwHandle(r, connection.engine, connection.db); };
  add(CONNECTION, 'nativeBindNull(JJI)V', (r, args) => bind(r, args, (e, s) => e.x.sqlite3_bind_null(s, args[2])));
  add(CONNECTION, 'nativeBindLong(JJIJ)V', (r, args) => bind(r, args, (e, s) => e.x.sqlite3_bind_int64(s, args[2], BigInt.asIntN(64, args[3]))));
  add(CONNECTION, 'nativeBindDouble(JJID)V', (r, args) => bind(r, args, (e, s) => e.x.sqlite3_bind_double(s, args[2], bitsDouble(args[3]))));
  add(CONNECTION, `nativeBindString(JJI${STRING})V`, (r, args) => bind(r, args, (e, s) => {
    const text = r.stringCharacters(args[3]), pointer = e.allocUtf16(text); try { return e.x.sqlite3_bind_text16(s, args[2], pointer, text.length * 2, SQLITE_TRANSIENT); } finally { e.x.free(pointer); }
  }));
  add(CONNECTION, `nativeBindBlob(JJI${BYTES})V`, (r, args) => bind(r, args, (e, s) => {
    const elements = r.array(args[3]).elements, data = Uint8Array.from(elements, v => v & 0xff), pointer = e.allocBytes(data);
    try { return e.x.sqlite3_bind_blob(s, args[2], pointer, data.length, SQLITE_TRANSIENT); } finally { e.x.free(pointer); }
  }));
  add(CONNECTION, 'nativeResetStatementAndClearBindings(JJ)V', (r, args) => {
    const { connection, stmt } = statement(r, args), { engine } = connection;
    let err = engine.x.sqlite3_reset(stmt); if (err === OK) err = engine.x.sqlite3_clear_bindings(stmt); if (err !== OK) throwHandle(r, engine, connection.db);
  });
  const executeNonQuery = (r, connection, stmt, isPragma) => {
    const { engine } = connection; let rc = engine.x.sqlite3_step(stmt);
    if (isPragma) while (rc === SQLITE_ROW) rc = engine.x.sqlite3_step(stmt);
    checked(r, connection);
    if (rc === SQLITE_ROW) throwPlain(r, 'Queries can be performed using SQLiteDatabase query or rawQuery methods only.');
    else if (rc !== SQLITE_DONE) throwHandle(r, engine, connection.db);
    // App-data persistence: a statement outside a transaction (or the COMMIT/END/ROLLBACK that closes one) has committed, also in WAL mode where no db-file lock changes.
    const sql = connection.sqls?.get(stmt) ?? '';
    if (/^\s*(BEGIN|SAVEPOINT)\b/i.test(sql)) connection.inTransaction = true;
    else if (/^\s*(COMMIT|END|ROLLBACK(?!\s+(TRANSACTION\s+)?TO\b)|RELEASE)\b/i.test(sql)) { connection.inTransaction = false; engine.commitPoint('sqlite-commit'); }
    else if (!connection.inTransaction) engine.commitPoint('sqlite-statement');
    return rc;
  };
  add(CONNECTION, 'nativeExecute(JJZ)V', (r, args) => { const { connection, stmt } = statement(r, args); executeNonQuery(r, connection, stmt, !!args[2]); });
  add(CONNECTION, 'nativeExecuteForChangedRowCount(JJ)I', (r, args) => { const { connection, stmt } = statement(r, args); return executeNonQuery(r, connection, stmt, false) === SQLITE_DONE ? connection.engine.x.sqlite3_changes(connection.db) : -1; });
  add(CONNECTION, 'nativeExecuteForLastInsertedRowId(JJ)J', (r, args) => {
    const { connection, stmt } = statement(r, args), { engine } = connection;
    return executeNonQuery(r, connection, stmt, false) === SQLITE_DONE && engine.x.sqlite3_changes(connection.db) > 0 ? engine.x.sqlite3_last_insert_rowid(connection.db) : -1n;
  });
  const executeOneRow = (r, connection, stmt) => {
    const rc = connection.engine.x.sqlite3_step(stmt); checked(r, connection); if (rc !== SQLITE_ROW) throwHandle(r, connection.engine, connection.db); return rc;
  };
  add(CONNECTION, 'nativeExecuteForLong(JJ)J', (r, args) => {
    const { connection, stmt } = statement(r, args); executeOneRow(r, connection, stmt);
    return connection.engine.x.sqlite3_column_count(stmt) >= 1 ? connection.engine.x.sqlite3_column_int64(stmt, 0) : -1n;
  });
  add(CONNECTION, `nativeExecuteForString(JJ)${STRING}`, (r, args) => {
    const { connection, stmt } = statement(r, args), { engine } = connection; executeOneRow(r, connection, stmt);
    if (engine.x.sqlite3_column_count(stmt) < 1) return null;
    const pointer = engine.x.sqlite3_column_text16(stmt, 0); return pointer ? engine.readUtf16(pointer, engine.x.sqlite3_column_bytes16(stmt, 0) / 2) : null;
  });
  // android_database_SQLiteConnection.cpp copyRow / nativeExecuteForCursorWindow
  const CPR_OK = 0, CPR_FULL = 1, CPR_ERROR = 2;
  const copyRow = (r, connection, window, stmt, columns, startPos, addedRows) => {
    const { engine } = connection, x = engine.x;
    if (window.allocRow()) return CPR_FULL;
    let result = CPR_OK;
    for (let i = 0; i < columns; i++) {
      const type = x.sqlite3_column_type(stmt, i); let status;
      if (type === T_TEXT) {
        const pointer = x.sqlite3_column_text(stmt, i), length = x.sqlite3_column_bytes(stmt, i), data = new Uint8Array(length + 1);
        data.set(engine.bytes().subarray(pointer, pointer + length)); status = window.putString(addedRows, i, data);
      } else if (type === T_INTEGER) status = window.putLong(addedRows, i, x.sqlite3_column_int64(stmt, i));
      else if (type === T_FLOAT) status = window.putDouble(addedRows, i, x.sqlite3_column_double(stmt, i));
      else if (type === T_BLOB) {
        const pointer = x.sqlite3_column_blob(stmt, i), length = x.sqlite3_column_bytes(stmt, i); status = window.putBlob(addedRows, i, length ? engine.bytes().slice(pointer, pointer + length) : new Uint8Array(0));
      } else if (type === T_NULL) status = window.putNull(addedRows, i);
      else { throwPlain(r, 'Unknown column type when filling window'); }
      if (status) { result = CPR_FULL; break; }
    }
    if (result !== CPR_OK) window.freeLastRow();
    return result;
  };
  add(CONNECTION, 'nativeExecuteForCursorWindow(JJJIIZ)J', (r, [connectionHandle, statementHandle, windowHandle, startPosition, requiredPos, countAllRows]) => {
    const connection = connectionOf(r, connectionHandle), { engine } = connection, stmt = stmtPointer(statementHandle), window = windowOf(r, windowHandle);
    let startPos = startPosition, status = window.clear();
    if (status) throwHandle(r, engine, connection.db, `Failed to clear the cursor window, status=${status}`);
    const columns = engine.x.sqlite3_column_count(stmt); status = window.setNumColumns(columns);
    if (status) throwHandle(r, engine, connection.db, `Failed to set the cursor window column count to ${columns}, status=${status}`);
    let retryCount = 0, totalRows = 0, addedRows = 0, windowFull = false, error = null;
    while (!error && (!windowFull || countAllRows)) {
      const err = engine.x.sqlite3_step(stmt);
      if (err === SQLITE_ROW) {
        retryCount = 0; totalRows += 1;
        if (startPos >= totalRows || windowFull) continue;
        let cpr = copyRow(r, connection, window, stmt, columns, startPos, addedRows);
        if (cpr === CPR_FULL && addedRows && startPos + addedRows <= requiredPos) {
          // The window filled before the row that was really wanted: clear it and start filling again from here.
          window.clear(); window.setNumColumns(columns); startPos += addedRows; addedRows = 0; cpr = copyRow(r, connection, window, stmt, columns, startPos, addedRows);
        }
        if (cpr === CPR_OK) addedRows += 1; else if (cpr === CPR_FULL) windowFull = true; else error = true;
      } else if (err === SQLITE_DONE) break;
      else if (err === SQLITE_LOCKED || err === BUSY) {
        if (retryCount > 50) { engine.x.sqlite3_reset(stmt); throwHandle(r, engine, connection.db, 'retrycount exceeded'); }
        retryCount++; // usleep(1000): the cooperative VM cannot let another thread run, so retries only matter for host callbacks
      } else { engine.x.sqlite3_reset(stmt); checked(r, connection); throwHandle(r, engine, connection.db); }
    }
    engine.x.sqlite3_reset(stmt); checked(r, connection);
    if (totalRows > 0 && addedRows === 0) throwSqlite(r, SQLITE_TOOBIG, 'unknown error', `Row too big to fit into CursorWindow requiredPos=${requiredPos}, totalRows=${totalRows}`);
    return (BigInt(startPos) << 32n) | BigInt(totalRows);
  });
  add(CONNECTION, 'nativeGetDbLookaside(J)I', (r, [handle]) => {
    const { engine, db } = connectionOf(r, handle), s = engine.scratch; let current = -1;
    if (engine.x.sqlite3_db_status(db, 0, s, s + 4, 0) === OK) current = engine.view().getInt32(s, true); return current;
  });
  add(CONNECTION, 'nativeCancel(J)V', (r, [handle]) => { const { engine, flag } = connectionOf(r, handle); engine.view().setInt32(flag, 1, true); });
  add(CONNECTION, 'nativeResetCancel(JZ)V', (r, [handle, cancelable]) => { const { engine, db, flag } = connectionOf(r, handle); engine.view().setInt32(flag, 0, true); engine.x.apkweb_set_cancelable(db, flag, cancelable ? 1 : 0); });

  // ---- CursorWindow
  const rowCol = (r, row, column) => newException(r, 'Ljava/lang/IllegalStateException;', `Couldn't read row ${row}, col ${column} from CursorWindow.  Make sure the Cursor is initialized correctly before accessing data from it.`);
  const unknownType = (r, type) => newException(r, 'Ljava/lang/IllegalStateException;', `UNKNOWN type ${type}`);
  add(WINDOW, `nativeCreate(${STRING}I)J`, (r, [name, size]) => {
    const state = stateFor(r), label = r.stringCharacters(name);
    if (size < 0) newException(r, 'Landroid/database/CursorWindowAllocationException;', `Could not allocate CursorWindow '${label}' of size ${size} due to error ${INVALID_OPERATION}.`);
    const handle = state.nextWindow++; state.windows.set(handle, new AndroidCursorWindow(label, size)); return handle;
  });
  add(WINDOW, 'nativeDispose(J)V', (r, [handle]) => { if (handle) stateFor(r).windows.delete(handle); });
  add(WINDOW, `nativeGetName(J)${STRING}`, (r, [handle]) => windowOf(r, handle).name);
  add(WINDOW, 'nativeClear(J)V', (r, [handle]) => { windowOf(r, handle).clear(); });
  add(WINDOW, 'nativeGetNumRows(J)I', (r, [handle]) => windowOf(r, handle).numRows);
  add(WINDOW, 'nativeSetNumColumns(JI)Z', (r, [handle, columns]) => windowOf(r, handle).setNumColumns(columns) === STATUS_OK ? 1 : 0);
  add(WINDOW, 'nativeAllocRow(J)Z', (r, [handle]) => windowOf(r, handle).allocRow() === STATUS_OK ? 1 : 0);
  add(WINDOW, 'nativeFreeLastRow(J)V', (r, [handle]) => { windowOf(r, handle).freeLastRow(); });
  add(WINDOW, 'nativeGetType(JII)I', (r, [handle, row, column]) => { const w = windowOf(r, handle), slot = w.slot(row, column); return slot < 0 ? FIELD_NULL : w.type(slot); });
    add(WINDOW, `nativeGetBlob(JII)${BYTES}`, (r, [handle, row, column]) => {
    const w = windowOf(r, handle), slot = w.slot(row, column); if (slot < 0) rowCol(r, row, column);
    const type = w.type(slot);
    if (type === FIELD_BLOB || type === FIELD_STRING) {
      const payload = w.payload(slot); if (!payload) throwPlain(r, 'Native could not read blob slot');
      const array = r.newArray(BYTES, payload.length); r.array(array).elements = Array.from(payload, v => (v << 24) >> 24); return array;
    }
    if (type === FIELD_INTEGER) throwPlain(r, 'INTEGER data in nativeGetBlob ');
    if (type === FIELD_FLOAT) throwPlain(r, 'FLOAT data in nativeGetBlob ');
    if (type === FIELD_NULL) return null; unknownType(r, type);
  });
  // Number -> text for FIELD_FLOAT is C's printf("%g"); implemented in cFormatG below.
  add(WINDOW, `nativeGetString(JII)${STRING}`, (r, [handle, row, column]) => {
    const w = windowOf(r, handle), slot = w.slot(row, column); if (slot < 0) rowCol(r, row, column);
    const type = w.type(slot);
    if (type === FIELD_STRING) {
      const payload = w.payload(slot); if (!payload) throwPlain(r, 'Native could not read string slot');
      return payload.length <= 1 ? '' : decoder.decode(payload.subarray(0, payload.length - 1));
    }
    if (type === FIELD_INTEGER) return w.long(slot).toString();
    if (type === FIELD_FLOAT) return cFormatG(w.double(slot));
    if (type === FIELD_NULL) return null;
    if (type === FIELD_BLOB) throwPlain(r, 'Unable to convert BLOB to string'); unknownType(r, type);
  });
  add(WINDOW, 'nativeCopyStringToBuffer(JIILandroid/database/CharArrayBuffer;)V', (r, [handle, row, column, buffer]) => {
    const w = windowOf(r, handle), slot = w.slot(row, column); if (slot < 0) rowCol(r, row, column);
    const type = w.type(slot); let value = null;
    if (type === FIELD_STRING) { const payload = w.payload(slot); value = payload && payload.length > 1 ? decoder.decode(payload.subarray(0, payload.length - 1)) : ''; }
    else if (type === FIELD_INTEGER) value = w.long(slot).toString();
    else if (type === FIELD_FLOAT) value = cFormatG(w.double(slot));
    else if (type === FIELD_NULL) value = '';
    else if (type === FIELD_BLOB) throwPlain(r, 'Unable to convert BLOB to string'); else unknownType(r, type);
    const fields = r.object(buffer).fields, dataKey = 'Landroid/database/CharArrayBuffer;->data:[C', sizeKey = 'Landroid/database/CharArrayBuffer;->sizeCopied:I';
    let data = fields.get(dataKey) ?? null;
    if (data === null || data === 0 || (value.length && r.array(data).elements.length < value.length)) {
      data = r.newArray('[C', Math.max(value.length, 64)); r.storeField(fields, dataKey, data);
    }
    const elements = r.array(data).elements; for (let i = 0; i < value.length; i++) elements[i] = value.charCodeAt(i);
    r.storeField(fields, sizeKey, value.length);
  });
  add(WINDOW, 'nativeGetLong(JII)J', (r, [handle, row, column]) => {
    const w = windowOf(r, handle), slot = w.slot(row, column); if (slot < 0) rowCol(r, row, column);
    const type = w.type(slot);
    if (type === FIELD_INTEGER) return w.long(slot);
    if (type === FIELD_STRING) { const payload = w.payload(slot); return payload && payload.length > 1 ? cStrtoll(decoder.decode(payload.subarray(0, payload.length - 1))) : 0n; }
    if (type === FIELD_FLOAT) return doubleToLong(w.double(slot));
    if (type === FIELD_NULL) return 0n;
    if (type === FIELD_BLOB) throwPlain(r, 'Unable to convert BLOB to long'); unknownType(r, type);
  });
  add(WINDOW, 'nativeGetDouble(JII)D', (r, [handle, row, column]) => {
    const w = windowOf(r, handle), slot = w.slot(row, column); if (slot < 0) rowCol(r, row, column);
    const type = w.type(slot);
    if (type === FIELD_FLOAT) return doubleBits(w.double(slot));
    if (type === FIELD_STRING) { const payload = w.payload(slot); return doubleBits(payload && payload.length > 1 ? cStrtod(decoder.decode(payload.subarray(0, payload.length - 1))) : 0); }
    if (type === FIELD_INTEGER) return doubleBits(Number(w.long(slot)));
    if (type === FIELD_NULL) return doubleBits(0);
    if (type === FIELD_BLOB) throwPlain(r, 'Unable to convert BLOB to double'); unknownType(r, type);
  });
  add(WINDOW, `nativePutBlob(J${BYTES}II)Z`, (r, [handle, value, row, column]) => windowOf(r, handle).putBlob(row, column, Uint8Array.from(r.array(value).elements, v => v & 0xff)) === STATUS_OK ? 1 : 0);
  add(WINDOW, `nativePutString(J${STRING}II)Z`, (r, [handle, value, row, column]) => {
    const encoded = modifiedUtf8(r.stringCharacters(value)), bytes = new Uint8Array(encoded.length + 1); bytes.set(encoded);
    return windowOf(r, handle).putString(row, column, bytes) === STATUS_OK ? 1 : 0;
  });
  add(WINDOW, 'nativePutLong(JJII)Z', (r, [handle, value, row, column]) => windowOf(r, handle).putLong(row, column, value) === STATUS_OK ? 1 : 0);
  add(WINDOW, 'nativePutDouble(JDII)Z', (r, [handle, value, row, column]) => windowOf(r, handle).putDouble(row, column, bitsDouble(value)) === STATUS_OK ? 1 : 0);
  add(WINDOW, 'nativePutNull(JII)Z', (r, [handle, row, column]) => windowOf(r, handle).putNull(row, column) === STATUS_OK ? 1 : 0);
  return bindings;
}

// ---- C library number conversions used by CursorWindow's type coercions
const doubleToLong = value => Number.isNaN(value) ? 0n : value >= 2 ** 63 ? (1n << 63n) - 1n : value <= -(2 ** 63) ? -(1n << 63n) : BigInt(Math.trunc(value));
/** strtoll(s, NULL, 0): leading blanks, sign, 0x/0 prefixes, saturating, stops at the first invalid character. */
function cStrtoll(text) {
  const m = /^[ \t\n\v\f\r]*([+-]?)(0[xX](?=[0-9a-fA-F])[0-9a-fA-F]+|0[0-7]*|[1-9][0-9]*)/.exec(text); if (!m) return 0n;
  const digits = m[2]; let value = digits.startsWith('0x') || digits.startsWith('0X') ? BigInt(digits) : digits.length > 1 && digits.startsWith('0') ? BigInt('0o' + digits.slice(1)) : BigInt(digits);
  if (m[1] === '-') value = -value;
  const max = (1n << 63n) - 1n, min = -(1n << 63n); return value > max ? max : value < min ? min : value;
}
/** strtod(s, NULL): the longest valid decimal/hex-free floating prefix. */
function cStrtod(text) {
  const m = /^[ \t\n\v\f\r]*([+-]?(?:inf(?:inity)?|nan|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?))/i.exec(text); if (!m) return 0;
  const body = m[1].toLowerCase(); if (body.includes('inf')) return body.startsWith('-') ? -Infinity : Infinity; if (body.includes('nan')) return NaN; return Number(body);
}
/** printf("%g", value) with the default precision of 6. */
export function cFormatG(value) {
  if (Number.isNaN(value)) return 'nan'; if (!Number.isFinite(value)) return value < 0 ? '-inf' : 'inf'; if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  const exponent = Number(value.toExponential(5).split('e')[1]);
  if (exponent < -4 || exponent >= 6) {
    const [mantissa, exp] = value.toExponential(5).split('e'); const trimmed = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa, n = Number(exp);
    return `${trimmed}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  const fixed = value.toFixed(Math.max(0, 5 - exponent)); return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
