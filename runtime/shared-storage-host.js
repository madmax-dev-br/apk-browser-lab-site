import { createHostRegistry } from './host-contract.js?v=6152edcf6e9b';
import { APKError } from './apk-error.js?v=6152edcf6e9b';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=6152edcf6e9b';
import { allocateFd } from './libcore-io-native.js?v=6152edcf6e9b';
import { ACTION, EXTRA, AUTHORITY, SYSTEM_PICKERS, PICK_IMAGES_MAX_LIMIT, MAX_FILES, MAX_TOTAL_BYTES, QuerySyntaxError, compileSelection, directoryOf, extensionOf, fileRecord, kindOf, parseSortOrder, parseStorageUri,
  pickerCandidates, pickerSpec, readPermissionFor, settleSelection, sortRows, titleOf, uniqueName, uriFor } from './shared-storage.js?v=6152edcf6e9b';

// The VM side of the virtual device's shared storage (src/shared-storage.js): the files the page attached, the system providers an app reads them through and the system pickers.
//
//   Providers (android-13.0.0_r1 MediaProvider, MediaDocumentsProvider, ExternalStorageProvider; host classes behind ContentResolver, which finds them by authority after the app's own):
//     content://media/<volume>/{images,video,audio}/media[/<id>], content://media/<volume>/file[/<id>], .../downloads[/<id>]   MediaStore collections and items
//     content://media/picker/0/com.android.providers.media.photopicker/media/<id>                                              what the photo picker hands out
//     content://com.android.providers.media.documents/document/{image,video,audio}:<id>                                        a media file chosen in the documents picker
//     content://com.android.externalstorage.documents/document/primary:Download/<name>                                         any other file chosen in the documents picker
//   query / getType / openFile (read) and, through ContentResolver's own bodies, openInputStream / openFileDescriptor / openAssetFileDescriptor / openTypedAssetFileDescriptor / loadThumbnail.
//   Access: a collection query lists the files the app's media permission covers (none without it: an empty cursor, as on Android 10+); an item Uri is readable when the permission
//   covers the file or a picker granted the Uri; picker and document Uris only with the grant (SecurityException otherwise). Grants last for the VM (the app process); a persistable grant
//   (ACTION_OPEN_DOCUMENT, the photo picker) can be taken with takePersistableUriPermission and is listed by getPersistedUriPermissions, also for the VM's lifetime only.
//   Writing. An app contributes media the way scoped storage lets it: ContentResolver.insert into a MediaStore collection of the external volume creates an item it owns (no permission
//   needed), which it fills through openFileDescriptor / openOutputStream, publishes with IS_PENDING = 0 (update) and may delete. The files that came from the page stay read-only for
//   apps, and documents are never written: those calls fail with an explicit error naming the call.
//
//   Pickers: an implicit Intent no Activity of the app handles and a system app answers on a device (pickerSpec) opens the page's picker dialog instead of throwing
//   ActivityNotFoundException. The caller is paused (and stopped under the full-screen documents picker and gallery) while the dialog is open; the answer comes back through
//   onActivityResult (RESULT_OK with the Uri in getData() or the Uris in getClipData(), or RESULT_CANCELED) and the Activity resumes. Without a page that shows the dialog (the embedded
//   player, tests that install no handler) the picker is dismissed at once: RESULT_CANCELED, logged.
const RESOLVER = 'Landroid/content/ContentResolver;', PROVIDER = 'Landroid/content/ContentProvider;', URI = 'Landroid/net/Uri;', STRING = 'Ljava/lang/String;', STRINGS = '[Ljava/lang/String;', BUNDLE = 'Landroid/os/Bundle;';
const VALUES = 'Landroid/content/ContentValues;', CURSOR = 'Landroid/database/Cursor;', SIGNAL = 'Landroid/os/CancellationSignal;', PFD = 'Landroid/os/ParcelFileDescriptor;', OBJECT = 'Ljava/lang/Object;', INTENT = 'Landroid/content/Intent;';
const MATRIX = 'Landroid/database/MatrixCursor;', CLIP = 'Landroid/content/ClipData;', CLIP_ITEM = 'Landroid/content/ClipData$Item;', CONTEXT = 'Landroid/content/Context;', BITMAP = 'Landroid/graphics/Bitmap;';
const MEDIA_PROVIDER = 'Lcom/android/providers/media/MediaProvider;', MEDIA_DOCUMENTS = 'Lcom/android/providers/media/MediaDocumentsProvider;', STORAGE_DOCUMENTS = 'Lcom/android/externalstorage/ExternalStorageProvider;';
const URI_PERMISSION = 'Landroid/content/UriPermission;', MEDIASTORE = 'Landroid/provider/MediaStore;';
const PROVIDER_TYPES = { [AUTHORITY.MEDIA]: MEDIA_PROVIDER, [AUTHORITY.MEDIA_DOCUMENTS]: MEDIA_DOCUMENTS, [AUTHORITY.STORAGE_DOCUMENTS]: STORAGE_DOCUMENTS };
const ROOT = '/storage/emulated/0', PICKER_SYNTHETIC = `${ROOT}/.transforms/synthetic/picker/0/com.android.providers.media.photopicker/media`;
const GRANT_READ = 1, GRANT_WRITE = 2, GRANT_PERSISTABLE = 0x40, RESULT_OK = -1, RESULT_CANCELED = 0;
const nullish = v => v === null || v === undefined || v === 0;
const sameRef = (a, b) => !!a && !!b && a.ref === b.ref;
/** java.lang.String.hashCode, for MediaStore's BUCKET_ID (the hash of the lower-cased directory path). */
const javaHash = text => { let h = 0; for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0; return h; };

// MediaStore columns per collection (MediaStore.MediaColumns and the Images / Video / Audio / Files additions the scanner fills for a plain file): name -> kind ('J' long, 'I' int, 'S' text).
const MEDIA_COLUMNS = { _id: 'J', _data: 'S', _display_name: 'S', _size: 'J', mime_type: 'S', title: 'S', date_added: 'J', date_modified: 'J', date_taken: 'J', width: 'I', height: 'I', duration: 'J', relative_path: 'S',
  bucket_display_name: 'S', bucket_id: 'I', volume_name: 'S', owner_package_name: 'S', is_pending: 'I', is_trashed: 'I', is_favorite: 'I', is_download: 'I', is_drm: 'I', orientation: 'I', resolution: 'S', generation_added: 'J', generation_modified: 'J' };
const TABLE_COLUMNS = {
  images: { ...MEDIA_COLUMNS, description: 'S', isprivate: 'I', latitude: 'S', longitude: 'S', mini_thumb_magic: 'I' },
  video: { ...MEDIA_COLUMNS, description: 'S', isprivate: 'I', artist: 'S', album: 'S', bookmark: 'J', category: 'S', language: 'S', tags: 'S', mini_thumb_magic: 'I' },
  audio: { ...MEDIA_COLUMNS, artist: 'S', album: 'S', artist_id: 'J', album_id: 'J', track: 'I', year: 'I', is_music: 'I', is_ringtone: 'I', is_alarm: 'I', is_notification: 'I', is_podcast: 'I', is_audiobook: 'I', bookmark: 'J', composer: 'S' },
  file: { ...MEDIA_COLUMNS, media_type: 'I', parent: 'J', artist: 'S', album: 'S' },
  downloads: { ...MEDIA_COLUMNS, download_uri: 'S', referer_uri: 'S' },
};
const PICKER_COLUMNS = { _data: 'S', mime_type: 'S', datetaken: 'J', date_taken: 'J', _size: 'J', duration: 'J', _display_name: 'S', width: 'I', height: 'I', orientation: 'I' };   // PickerMediaColumns
const DOCUMENT_COLUMNS = { document_id: 'S', mime_type: 'S', _display_name: 'S', last_modified: 'J', flags: 'I', _size: 'J', summary: 'S', icon: 'I' };   // DocumentsContract.Document
const DEFAULT_DOCUMENT_PROJECTION = ['document_id', 'mime_type', '_display_name', 'last_modified', 'flags', '_size'];
const MEDIA_TYPE = { image: 1, audio: 2, video: 3, document: 6 };   // MediaStore.Files.FileColumns.MEDIA_TYPE_*

export function createSharedStorageHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  const files = new Map();        // id -> entry
  const mounted = new Map();      // path -> node this host put into the virtual filesystem
  const grants = new Map();       // Uri text -> { write, persistable, persistedAt }
  const pending = gcRoot(new Map());     // picker request id -> { spec, offered, frame, resultCaller, requestCode, held }
  const providers = gcRoot(new Map());   // authority -> the provider object
  let sequence = 0;

  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const unsupported = (message, kind = 'shared-storage-unsupported') => { throw new APKError(message, { kind }); };
  const uriString = (r, uri) => { if (nullish(uri)) r.throwJava('Ljava/lang/NullPointerException;', 'uri'); return text(r, call(r, uri, OBJECT, 'toString', [], STRING)); };
  const uriOf = (r, value) => callStatic(r, URI, 'parse', [STRING], URI, [value]);
  const targetSdk = () => { const value = Number(platform.manifest?.usesSdk?.targetSdkVersion ?? platform.manifest?.usesSdk?.minSdkVersion ?? 1); return Number.isFinite(value) && value > 0 ? value : 1; };
  const fs = () => platform.javaIo?.fs?.() ?? null;
  const uid = () => platform.virtualProcess?.uid ?? 10000;

  // ---- the files -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** Whether the app's media permission covers the file (MediaStore rows and the File API of another owner's file; never a document). */
  const canSee = entry => { if (entry.owned) return true;   // an app always sees its own contributions
    const permission = readPermissionFor(entry.kind, targetSdk()); return permission !== null && !!platform.grantedPermissions?.has(permission); };
  /** MediaProvider's MimeUtils.resolveMimeType: the type of the extension in libcore's MimeMap, else application/octet-stream. */
  const mimeFromName = (r, name) => {
    const extension = extensionOf(name), MAP = 'Llibcore/content/type/MimeMap;';
    if (extension && r?.classes?.has(MAP)) { const map = callStatic(r, MAP, 'getDefault', [], MAP), found = text(r, call(r, map, MAP, 'guessMimeTypeFromExtension', [STRING], STRING, [extension])); if (found) return found.toLowerCase(); }
    return 'application/octet-stream';
  };
  const syncMounts = () => {
    const vfs = fs(); if (!vfs) return;
    const wanted = new Map(); for (const entry of files.values()) if (canSee(entry)) wanted.set(entry.path, entry.node);
    for (const entry of files.values()) if (entry.pickerPath && grants.has(uriFor('picker', entry))) wanted.set(entry.pickerPath, entry.node);
    for (const [path, node] of [...mounted]) if (wanted.get(path) !== node) { if (vfs.nodes.get(path) === node) vfs.nodes.delete(path); vfs.readOnly.delete(path); mounted.delete(path); }
    for (const [path, node] of wanted) {
      if (mounted.has(path) || vfs.nodes.has(path)) continue;   // a file the app created under the same name stays the app's
      if (!vfs.nodes.has(vfs.parentOf(path)) && vfs.mkdirs(vfs.parentOf(path)) === 'ENOTDIR') continue;
      vfs.nodes.set(path, node); mounted.set(path, node);
      if (![...files.values()].some(entry => entry.owned && entry.node === node)) vfs.readOnly.add(path);   // another owner's file: readable under the media permission, never writable; the app's own contribution is its file
    }
  };
  const describe = entry => ({ id: entry.id, name: entry.name, mime: entry.mime, size: entry.size, modified: entry.modified, width: entry.width, height: entry.height, duration: entry.duration, path: entry.path });
  const dropGrantsOf = entry => { for (const style of ['picker', 'media', 'document']) grants.delete(uriFor(style, entry)); };

  /**
   * The page's files: { replace, remove: [id], files: [{ id, name, mime, size, modified, added, width, height, duration, bytes }] }. `replace` drops everything first. A name already taken
   * gets a " (n)" suffix. Returns the list as the device holds it. Throws RangeError over the limits (nothing is changed then).
   */
  function setFiles(r, payload = {}) {
    const incoming = (payload.files ?? []).map(input => {
      const bytes = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes ?? 0);
      return { record: fileRecord({ ...input, size: bytes.length }), bytes };
    });
    const kept = payload.replace ? [...files.values()].filter(entry => entry.owned) : [...files.values()].filter(entry => entry.owned || !(payload.remove ?? []).includes(entry.id) && !incoming.some(item => item.record.id === entry.id));
    if (kept.length + incoming.length > MAX_FILES) throw new RangeError(`O armazenamento do dispositivo aceita até ${MAX_FILES} arquivos.`);
    if (kept.reduce((sum, entry) => sum + entry.size, 0) + incoming.reduce((sum, item) => sum + item.bytes.length, 0) > MAX_TOTAL_BYTES) throw new RangeError(`O armazenamento do dispositivo aceita até ${MAX_TOTAL_BYTES / 1048576} MiB no total.`);
    for (const entry of [...files.values()]) if (!kept.includes(entry)) { files.delete(entry.id); dropGrantsOf(entry); }
    const now = platform.clock?.wall?.() ?? Date.now();
    for (const { record, bytes } of incoming) {
      const mime = record.mime || mimeFromName(r, record.name), kind = kindOf(mime), directory = directoryOf(kind);
      const taken = new Set([...files.values()].filter(entry => entry.directory === directory).map(entry => entry.name)), name = uniqueName(record.name, taken), path = `${ROOT}/${directory}/${name}`;
      const modified = record.modified || now, added = record.added || now;
      const node = { type: 'file', buf: bytes, size: bytes.length, mtime: modified, mode: 0o660, mounted: true, path };
      files.set(record.id, { ...record, name, mime, kind, directory, path, modified, added, node, pickerPath: kind === 'image' || kind === 'video' ? `${PICKER_SYNTHETIC}/${record.id}${extensionOf(name) ? '.' + extensionOf(name) : ''}` : null });
    }
    syncMounts();
    r?.record?.(`STORAGE shared storage holds ${files.size} attached file(s)`);
    return list();
  }
  const list = () => [...files.values()].filter(entry => !entry.owned).map(describe);
  /** The media the app itself added through MediaStore (not part of the page's list). */
  const contributed = () => [...files.values()].filter(entry => entry.owned).map(describe);

  // ---- Uri permission grants ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  const granted = textUri => grants.has(textUri);
  const grant = (textUri, { write = false, persistable = false } = {}) => { const before = grants.get(textUri); grants.set(textUri, { write: write || !!before?.write, persistable: persistable || !!before?.persistable, persistedAt: before?.persistedAt ?? null }); };
  /** ContentResolver.takePersistableUriPermission: true when a persistable grant covers the Uri and the mode. */
  function takePersistable(textUri, modeFlags) {
    const entry = grants.get(textUri); if (!entry || !entry.persistable || ((modeFlags & GRANT_WRITE) !== 0 && !entry.write)) return false;
    entry.persistedAt ??= platform.clock?.wall?.() ?? Date.now(); entry.persistedModes = (entry.persistedModes ?? 0) | (modeFlags & 3); return true;
  }
  function releasePersistable(textUri, modeFlags) { const entry = grants.get(textUri); if (!entry || entry.persistedAt === null) return false; entry.persistedModes = (entry.persistedModes ?? 0) & ~(modeFlags & 3); if (!entry.persistedModes) entry.persistedAt = null; return true; }
  type(URI_PERMISSION, OBJECT, ['Landroid/os/Parcelable;'], { allocatable: false });
  const permissionOf = (r, self) => r.object(self).uriPermission;
  def(URI_PERMISSION, 'getUri', `()${URI}`, (r, _m, [self]) => uriOf(r, permissionOf(r, self).uri));
  def(URI_PERMISSION, 'isReadPermission', '()Z', (r, _m, [self]) => (permissionOf(r, self).modes & GRANT_READ) !== 0 ? 1 : 0);
  def(URI_PERMISSION, 'isWritePermission', '()Z', (r, _m, [self]) => (permissionOf(r, self).modes & GRANT_WRITE) !== 0 ? 1 : 0);
  def(URI_PERMISSION, 'getPersistedTime', '()J', (r, _m, [self]) => BigInt(permissionOf(r, self).time));
  def(URI_PERMISSION, 'describeContents', '()I', () => 0);
  def(URI_PERMISSION, 'toString', `()${STRING}`, (r, _m, [self]) => { const p = permissionOf(r, self); return `UriPermission {uri=${p.uri}, modeFlags=${p.modes}, persistedTime=${p.time}}`; });
  staticField(URI_PERMISSION, 'INVALID_TIME', 'J', () => -(1n << 63n));
  /** ContentResolver.getPersistedUriPermissions: the UriPermission objects of the grants the app took. */
  function persistedPermissions(r) {
    const out = [];
    for (const [uri, entry] of grants) if (entry.persistedAt !== null) { const o = r.makeObject(URI_PERMISSION); r.object(o).uriPermission = { uri, modes: entry.persistedModes ?? GRANT_READ, time: entry.persistedAt }; out.push(o); }
    return out;
  }

  // ---- providers ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  for (const owner of Object.values(PROVIDER_TYPES)) type(owner, PROVIDER, [], { allocatable: false });
  /** The system provider behind `authority`, or null: ContentResolver asks after the app's own providers. */
  function provider(r, authority) {
    const owner = PROVIDER_TYPES[authority]; if (!owner) return null;
    if (!providers.has(authority)) providers.set(authority, r.makeObject(owner));
    return providers.get(authority);
  }
  const bundleValue = (r, bundle, getter, key, result, fallback = []) => nullish(bundle) ? null : call(r, bundle, BUNDLE, getter, [STRING, ...fallback.map(([kind]) => kind)], result, [key, ...fallback.map(([, value]) => value)]);
  const queryArguments = (r, bundle) => {
    const has = key => !nullish(bundle) && call(r, bundle, 'Landroid/os/BaseBundle;', 'containsKey', [STRING], 'Z', [key]) === 1;
    const strings = key => { const value = bundleValue(r, bundle, 'getStringArray', key, STRINGS); return nullish(value) ? null : r.array(value).elements.map(item => text(r, item)); };
    return { selection: text(r, bundleValue(r, bundle, 'getString', 'android:query-arg-sql-selection', STRING)), selectionArgs: strings('android:query-arg-sql-selection-args'), sort: text(r, bundleValue(r, bundle, 'getString', 'android:query-arg-sql-sort-order', STRING)),
      sortColumns: strings('android:query-arg-sort-columns'), sortDirection: has('android:query-arg-sort-direction') ? bundleValue(r, bundle, 'getInt', 'android:query-arg-sort-direction', 'I') : 0,
      limit: has('android:query-arg-limit') ? bundleValue(r, bundle, 'getInt', 'android:query-arg-limit', 'I') : null, offset: has('android:query-arg-offset') ? bundleValue(r, bundle, 'getInt', 'android:query-arg-offset', 'I') : 0 };
  };
  const cursorOf = (r, columns, kinds, rows) => {
    const names = r.newArray(STRINGS, columns.length); r.array(names).elements = [...columns];
    const cursor = construct(r, MATRIX, [STRINGS], [names]);
    for (const row of rows) {
      const values = columns.map(column => { const value = row[column] ?? null, kind = kinds[column]; if (value === null || kind === undefined) return null; return kind === 'S' ? String(value) : r.boxPrimitive(kind, kind === 'J' ? BigInt(Math.trunc(value)) : value | 0); });
      const array = r.newArray('[Ljava/lang/Object;', values.length); r.array(array).elements = values;
      call(r, cursor, MATRIX, 'addRow', ['[Ljava/lang/Object;'], 'V', [array]);
    }
    return cursor;
  };
  const mediaRow = (entry, table) => {
    const visual = entry.kind === 'image' || entry.kind === 'video', timed = entry.kind === 'video' || entry.kind === 'audio';
    const row = { _id: entry.id, _data: entry.path, _display_name: entry.name, _size: entry.size, mime_type: entry.mime, title: titleOf(entry.name), date_added: Math.floor(entry.added / 1000), date_modified: Math.floor(entry.modified / 1000), date_taken: null,
      width: visual ? entry.width : null, height: visual ? entry.height : null, duration: timed ? entry.duration : null, relative_path: `${entry.directory}/`, bucket_display_name: entry.directory.split('/').at(-1), bucket_id: javaHash(`${ROOT}/${entry.directory}`.toLowerCase()),
      volume_name: 'external_primary', owner_package_name: entry.owned ? platform.packageName ?? null : null, is_pending: entry.pending ? 1 : 0, is_trashed: 0, is_favorite: 0, is_download: topDirectory(entry) === 'Download' ? 1 : 0, is_drm: 0, orientation: entry.kind === 'image' ? 0 : null,
      resolution: visual && entry.width && entry.height ? `${entry.width}×${entry.height}` : null, generation_added: 1, generation_modified: 1 };
    if (table === 'file') Object.assign(row, { media_type: MEDIA_TYPE[entry.kind], parent: 0 });
    if (table === 'audio') Object.assign(row, { artist: '<unknown>', album: entry.directory, is_music: 1, is_ringtone: 0, is_alarm: 0, is_notification: 0, is_podcast: 0, is_audiobook: 0 });
    if (table === 'images' || table === 'video') Object.assign(row, { isprivate: null });
    if (entry.values) for (const [column, value] of Object.entries(entry.values)) if (column in TABLE_COLUMNS[table]) row[column] = value;   // what the owner stored with insert / update (DATE_TAKEN, DESCRIPTION, ...)
    return row;
  };
  const topDirectory = entry => entry.directory.split('/')[0];
  const inTable = (entry, table) => table === 'file' ? true : table === 'downloads' ? topDirectory(entry) === 'Download' : entry.kind === ({ images: 'image', video: 'video', audio: 'audio' })[table];
  const noAccess = (r, textUri) => r.throwJava('Ljava/lang/SecurityException;', `${platform.packageName ?? 'app'} has no access to ${textUri}`);
  const pickerDenied = (r, textUri) => r.throwJava('Ljava/lang/SecurityException;', `Calling uid ( ${uid()} ) does not have permission to access picker uri: ${textUri}`);
  const documentDenied = (r, parsed, textUri, verb) => r.throwJava('Ljava/lang/SecurityException;', `Permission Denial: ${verb} ${PROVIDER_TYPES[parsed.authority].slice(1, -1).replaceAll('/', '.')} uri ${textUri} from pid=${platform.virtualProcess?.pid ?? 1}, uid=${uid()} requires that you obtain access using ACTION_OPEN_DOCUMENT or related APIs`);
  const unknownUri = (what, textUri) => unsupported(`${what}(${textUri}): this Uri of the device's shared storage providers is not modelled (MediaStore collections and items, photo picker Uris and /document/<id> Uris are)`, 'shared-storage-uri-unsupported');
  const entryOfDocument = parsed => parsed.authority === AUTHORITY.MEDIA_DOCUMENTS ? [...files.values()].find(entry => entry.id === parsed.id && entry.kind === parsed.type) ?? null : [...files.values()].find(entry => `${entry.directory}/${entry.name}` === parsed.path && entry.kind === 'document') ?? null;

  function query(r, _m, [, uri, projection, bundle]) {
    const textUri = uriString(r, uri).replace(/[?#].*$/, ''), parsed = parseStorageUri(textUri), wanted = nullish(projection) ? null : r.array(projection).elements.map(item => text(r, item));
    if (!parsed || parsed.kind === 'unknown') unknownUri('ContentResolver.query', textUri);
    const args = queryArguments(r, bundle);
    if (parsed.kind === 'document') {
      if (!granted(textUri)) documentDenied(r, parsed, textUri, 'reading');
      const entry = entryOfDocument(parsed), columns = wanted ?? DEFAULT_DOCUMENT_PROJECTION;
      if (!entry) r.throwJava('Ljava/lang/IllegalArgumentException;', `Missing file for ${parsed.docId}`);   // the file was removed from the device after the grant
      return cursorOf(r, columns, DOCUMENT_COLUMNS, [{ document_id: parsed.docId, mime_type: entry.mime, _display_name: entry.name, last_modified: entry.modified, flags: entry.kind === 'image' ? 1 : 0, _size: entry.size }]);   // FLAG_SUPPORTS_THUMBNAIL
    }
    if (parsed.kind === 'picker') {
      if (!granted(textUri)) pickerDenied(r, textUri);
      const entry = files.get(parsed.id), columns = wanted ?? ['_data', 'mime_type', 'date_taken', '_size', 'duration', '_display_name', 'width', 'height', 'orientation'];
      const rows = entry ? [{ _data: entry.pickerPath, mime_type: entry.mime, datetaken: entry.modified, date_taken: entry.modified, _size: entry.size, duration: entry.kind === 'video' ? entry.duration : null, _display_name: entry.name, width: entry.width, height: entry.height, orientation: 0 }] : [];
      return cursorOf(r, columns, PICKER_COLUMNS, rows);
    }
    // MediaStore collection or item
    const kinds = TABLE_COLUMNS[parsed.table], names = new Set(Object.keys(kinds)), columns = wanted ?? Object.keys(kinds);
    for (const column of columns) if (!names.has(column)) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid column ${column}`);
    let rows = parsed.volume === 'internal' ? [] : [...files.values()].filter(entry => inTable(entry, parsed.table) && (parsed.kind === 'collection' ? canSee(entry) && !entry.pending : entry.id === parsed.id && (canSee(entry) || granted(textUri)))).map(entry => mediaRow(entry, parsed.table));
    const what = `ContentResolver.query(${textUri})`;
    const guard = (label, value, body) => {
      try { return body(); } catch (error) {
        if (!(error instanceof QuerySyntaxError)) throw error;
        if (error.message.startsWith('no such column') || error.message.startsWith('bind argument')) r.throwJava(r.classes?.has('Landroid/database/sqlite/SQLiteException;') ? 'Landroid/database/sqlite/SQLiteException;' : 'Ljava/lang/IllegalArgumentException;', `${error.message} (code 1 SQLITE_ERROR)`);
        return unsupported(`${what}: the ${label} "${value}" is outside the SQL subset the lab's MediaProvider evaluates (${error.message}); comparisons, LIKE, IN, IS NULL, AND / OR / NOT and parentheses are`, 'media-query-unsupported');
      }
    };
    const matches = guard('selection', args.selection, () => compileSelection(args.selection, args.selectionArgs, names));
    rows = rows.filter(matches);
    const order = guard('sort order', args.sort, () => parseSortOrder(args.sort, names));
    if (!order.keys.length && args.sortColumns) { for (const column of args.sortColumns) { if (!names.has(column)) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid column ${column}`); order.keys.push({ column, descending: args.sortDirection === 1 }); } }
    if (!order.keys.length) order.keys.push({ column: '_id', descending: false });
    if (order.limit === null && args.limit !== null) { order.limit = args.limit; order.offset = args.offset; }
    return cursorOf(r, columns, kinds, sortRows(rows, order));
  }
  function getType(r, _m, [, uri]) {
    const textUri = uriString(r, uri).replace(/[?#].*$/, ''), parsed = parseStorageUri(textUri);
    if (!parsed || parsed.kind === 'unknown') unknownUri('ContentResolver.getType', textUri);
    if (parsed.kind === 'document') { const entry = entryOfDocument(parsed); if (!entry) r.throwJava('Ljava/lang/IllegalArgumentException;', `Missing file for ${parsed.docId}`); return entry.mime; }   // DocumentsProvider.getType: no grant is checked on API 33
    if (parsed.kind === 'picker') { if (!granted(textUri)) pickerDenied(r, textUri); return files.get(parsed.id)?.mime ?? null; }
    if (parsed.kind === 'collection') {
      if (parsed.table === 'images') return 'vnd.android.cursor.dir/image'; if (parsed.table === 'video') return 'vnd.android.cursor.dir/video'; if (parsed.table === 'audio') return 'vnd.android.cursor.dir/audio';
      r.throwJava('Ljava/lang/IllegalStateException;', `Unknown URL : ${textUri}`);
    }
    const entry = files.get(parsed.id); if (!entry || !inTable(entry, parsed.table) || parsed.volume === 'internal') r.throwJava('Ljava/lang/IllegalArgumentException;', `No item at ${textUri}`);
    return entry.mime;   // MediaProvider.getType answers for an item with the caller's identity cleared: no permission is needed
  }
  /** The file a content Uri names, after the access checks of a read; throws what the provider throws. */
  function readable(r, textUri, what) {
    const parsed = parseStorageUri(textUri);
    if (!parsed || parsed.kind === 'unknown') unknownUri(what, textUri);
    if (parsed.kind === 'collection') r.throwJava('Ljava/io/FileNotFoundException;', `No item at ${textUri}`);
    if (parsed.kind === 'document') { if (!granted(textUri)) documentDenied(r, parsed, textUri, 'opening'); const entry = entryOfDocument(parsed); if (!entry) r.throwJava('Ljava/io/FileNotFoundException;', `Missing file for ${parsed.docId}`); return entry; }
    if (parsed.kind === 'picker') { if (!granted(textUri)) pickerDenied(r, textUri); const entry = files.get(parsed.id); if (!entry) r.throwJava('Ljava/io/FileNotFoundException;', `File not found due to unavailable volumes: ${textUri}`); return entry; }
    const entry = files.get(parsed.id); if (!entry || !inTable(entry, parsed.table) || parsed.volume === 'internal') r.throwJava('Ljava/io/FileNotFoundException;', `No item at ${textUri}`);
    if (!canSee(entry) && !granted(textUri)) noAccess(r, textUri);
    return entry;
  }
  function openFile(r, _m, [, uri, mode]) {
    if (nullish(mode)) r.throwJava('Ljava/lang/NullPointerException;', 'mode');
    const textUri = uriString(r, uri).replace(/[?#].*$/, ''), modeText = text(r, mode), entry = readable(r, textUri, 'ContentResolver.openFile');
    if (modeText !== 'r') {
      if (!['w', 'wt', 'wa', 'rw', 'rwt'].includes(modeText)) r.throwJava('Ljava/lang/IllegalArgumentException;', `Invalid mode: ${modeText}`);
      if (entry.owned) {   // the app's own item: ParcelFileDescriptor.parseMode -- "w" / "wt" / "rwt" truncate, "wa" appends, "rw" keeps the content
        if (modeText !== 'wa' && modeText !== 'rw') { entry.node.size = 0; }
        entry.node.mtime = entry.modified = platform.clock?.wall?.() ?? Date.now();
        const writable = allocateFd(r, { kind: 'file', node: entry.node, path: entry.path, acc: modeText.startsWith('rw') ? 2 : 1, offset: 0, append: modeText === 'wa', ownerTag: 0n, refs: 0 }, 0, true);
        if (writable < 0) r.throwJava('Ljava/io/FileNotFoundException;', 'open failed: EMFILE (Too many open files)');
        return callStatic(r, PFD, 'adoptFd', ['I'], PFD, [writable]);
      }
      unsupported(`ContentResolver.openFile(${textUri}, "${modeText}"): the virtual device's shared storage is read-only for apps (its files come from the page); only mode "r" is modelled`, 'shared-storage-write-unsupported');
    }
    const number = allocateFd(r, { kind: 'file', node: entry.node, path: entry.path, acc: 0, offset: 0, append: false, ownerTag: 0n, refs: 0 }, 0, true);   // O_RDONLY
    if (number < 0) r.throwJava('Ljava/io/FileNotFoundException;', `open failed: EMFILE (Too many open files)`);
    return callStatic(r, PFD, 'adoptFd', ['I'], PFD, [number]);
  }
  // ---- the app's own media: insert / update / delete (MediaProvider with scoped storage) ------------------------------------------------------------------------------------------------
  const DEFAULT_MIME = { images: 'image/jpeg', video: 'video/mp4', audio: 'audio/mpeg' }, EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/x-wav': 'wav' };
  const ALLOWED_DIRECTORIES = { image: ['DCIM', 'Pictures'], video: ['DCIM', 'Movies', 'Pictures'], audio: ['Alarms', 'Audiobooks', 'Music', 'Notifications', 'Podcasts', 'Ringtones', 'Recordings'], document: ['Download', 'Documents'] };
  let created = 0;
  const valueOf = (r, values, name) => (nullish(values) || !call(r, values, VALUES, 'containsKey', [STRING], 'Z', [name]) ? undefined : text(r, call(r, values, VALUES, 'getAsString', [STRING], STRING, [name])));
  const storedValues = (r, values, table, into = {}) => { for (const [column, kind] of Object.entries(TABLE_COLUMNS[table])) { if (['_id', '_data', '_display_name', '_size', 'mime_type', 'relative_path', 'is_pending', 'volume_name', 'owner_package_name', 'bucket_id', 'bucket_display_name', 'date_added'].includes(column)) continue; const value = valueOf(r, values, column); if (value !== undefined) into[column] = value === null ? null : kind === 'S' ? value : Number(value); } return into; };
  function insert(r, _m, [, uri, values]) {
    const textUri = uriString(r, uri).replace(/[?#].*$/, ''), parsed = parseStorageUri(textUri), what = `ContentResolver.insert(${textUri})`;
    if (!parsed || parsed.kind === 'unknown') unknownUri('ContentResolver.insert', textUri);
    if (parsed.kind !== 'collection' || parsed.authority !== AUTHORITY.MEDIA) unsupported(`${what}: only MediaStore collections take new items (documents are created through ACTION_CREATE_DOCUMENT, which the lab does not model)`, 'shared-storage-write-unsupported');
    if (parsed.volume === 'internal') r.throwJava('Ljava/lang/UnsupportedOperationException;', 'Writing to internal storage is not supported.');
    if (parsed.table === 'file') unsupported(`${what}: inserting into MediaStore.Files is not modelled (use the Images, Video, Audio or Downloads collection)`, 'shared-storage-write-unsupported');
    let name = valueOf(r, values, '_display_name') ?? String(platform.clock?.wall?.() ?? Date.now());
    const mime = (valueOf(r, values, 'mime_type') ?? (extensionOf(name) ? mimeFromName(r, name) : DEFAULT_MIME[parsed.table] ?? 'application/octet-stream')).toLowerCase(), kind = kindOf(mime);
    const wantedKind = ({ images: 'image', video: 'video', audio: 'audio' })[parsed.table];
    if (wantedKind && kind !== wantedKind) r.throwJava('Ljava/lang/IllegalArgumentException;', `MIME type ${mime} cannot be inserted into ${textUri}; expected MIME type under ${wantedKind}/*`);
    if (!extensionOf(name) && EXTENSION[mime]) name = `${name}.${EXTENSION[mime]}`;   // MediaProvider adds the extension of the MIME type to a name without one
    const allowed = parsed.table === 'downloads' ? ['Download'] : ALLOWED_DIRECTORIES[kind], relative = valueOf(r, values, 'relative_path'), directory = relative ? relative.split('/').filter(Boolean).join('/') : parsed.table === 'downloads' ? 'Download' : directoryOf(kind);
    if (!allowed.includes(directory.split('/')[0])) r.throwJava('Ljava/lang/IllegalArgumentException;', `Primary directory ${directory.split('/')[0]} not allowed for ${textUri}; allowed directories are [${allowed.join(', ')}]`);
    name = uniqueName(name.replaceAll('/', '_'), new Set([...files.values()].filter(entry => entry.directory === directory).map(entry => entry.name)));
    const now = platform.clock?.wall?.() ?? Date.now(), id = 1000000 + ++created, path = `${ROOT}/${directory}/${name}`, node = { type: 'file', buf: new Uint8Array(0), size: 0, mtime: now, mode: 0o660, mounted: true, path };
    const pendingValue = valueOf(r, values, 'is_pending');
    const entry = { id, name, mime, kind, directory, path, modified: now, added: now, width: null, height: null, duration: null, node, pickerPath: null, owned: true, pending: pendingValue !== undefined && Number(pendingValue) !== 0, values: storedValues(r, values, parsed.table) };
    Object.defineProperty(entry, 'size', { get: () => node.size, enumerable: true });
    files.set(id, entry); syncMounts(); r.record(`STORAGE the app added ${path} to MediaStore (${mime}${entry.pending ? ', pending' : ''})`);
    return uriOf(r, `${textUri}/${id}`);
  }
  /** The app's own item a write names; a page file, a document or a collection is not writable here (explicit). */
  const ownItem = (r, name, uri) => {
    const textUri = uriString(r, uri).replace(/[?#].*$/, ''), parsed = parseStorageUri(textUri); if (!parsed || parsed.kind === 'unknown') unknownUri(`ContentResolver.${name}`, textUri);
    const entry = parsed.kind === 'item' ? files.get(parsed.id) : null;
    if (parsed.kind === 'item' && (!entry || !inTable(entry, parsed.table))) return { textUri, parsed, entry: null };
    if (!entry?.owned) unsupported(`ContentResolver.${name}(${textUri}): only the media the app itself added through MediaStore can be changed (the files that come from the page are read-only for apps, and collection-wide or document writes are not modelled)`, 'shared-storage-write-unsupported');
    return { textUri, parsed, entry };
  };
  function update(r, _m, [, uri, values]) {
    const { entry, parsed } = ownItem(r, 'update', uri); if (!entry) return 0;
    const pendingValue = valueOf(r, values, 'is_pending'), name = valueOf(r, values, '_display_name');
    if (valueOf(r, values, 'relative_path') !== undefined) unsupported('ContentResolver.update with RELATIVE_PATH (moving a MediaStore item) is not modelled', 'shared-storage-write-unsupported');
    if (pendingValue !== undefined) entry.pending = Number(pendingValue) !== 0;
    if (name) { const vfs = fs(), renamed = uniqueName(name.replaceAll('/', '_'), new Set([...files.values()].filter(other => other !== entry && other.directory === entry.directory).map(other => other.name))); if (vfs?.nodes.get(entry.path) === entry.node) vfs.nodes.delete(entry.path); mounted.delete(entry.path); entry.name = renamed; entry.path = entry.node.path = `${ROOT}/${entry.directory}/${renamed}`; }
    storedValues(r, values, parsed.table, entry.values); entry.modified = platform.clock?.wall?.() ?? Date.now(); syncMounts();
    return 1;
  }
  function remove(r, _m, [, uri]) {
    const { entry } = ownItem(r, 'delete', uri); if (!entry) return 0;
    files.delete(entry.id); dropGrantsOf(entry); syncMounts(); r.record(`STORAGE the app deleted ${entry.path} from MediaStore`); return 1;
  }
  const readOnly = (name, signature) => (r, _m, [, uri]) => unsupported(`ContentResolver.${name}(${nullish(uri) ? 'null' : typeof uri === 'string' ? uri : uriString(r, uri)}): the virtual device's shared storage is read-only for apps (its files come from the page); MediaStore and document writes are not modelled`, 'shared-storage-write-unsupported');
  for (const owner of Object.values(PROVIDER_TYPES)) {
    def(owner, 'query', `(${URI}${STRINGS}${BUNDLE}${SIGNAL})${CURSOR}`, query);
    def(owner, 'getType', `(${URI})${STRING}`, getType);
    def(owner, 'openFile', `(${URI}${STRING})${PFD}`, openFile); def(owner, 'openFile', `(${URI}${STRING}${SIGNAL})${PFD}`, openFile);
    def(owner, 'getStreamTypes', `(${URI}${STRING})${STRINGS}`, (r, _m, [self, uri, filter]) => { const mime = getType(r, null, [self, uri]), wanted = text(r, filter); if (mime === null || !(wanted === '*/*' || wanted === mime || (wanted.endsWith('/*') && mime.startsWith(wanted.slice(0, -1))))) return null; const out = r.newArray(STRINGS, 1); r.array(out).elements = [mime]; return out; });
    def(owner, 'insert', `(${URI}${VALUES}${BUNDLE})${URI}`, insert); def(owner, 'bulkInsert', `(${URI}[${VALUES})I`, readOnly('bulkInsert'));
    def(owner, 'update', `(${URI}${VALUES}${BUNDLE})I`, update); def(owner, 'delete', `(${URI}${BUNDLE})I`, remove);
    def(owner, 'call', `(${STRING}${STRING}${STRING}${BUNDLE})${BUNDLE}`, (r, _m, [, authority, method]) => unsupported(`ContentResolver.call(${text(r, authority)}, "${text(r, method)}"): provider calls of the device's shared storage providers are not modelled`, 'shared-storage-call-unsupported'));
  }
  /** The bytes behind a content Uri of these providers for a host that reads media (MediaMetadataRetriever), after the same access checks; null for another authority. */
  function bytesFor(r, textUri, what) { const clean = String(textUri).replace(/[?#].*$/, ''); if (!parseStorageUri(clean)) return null; const entry = readable(r, clean, what); return entry.node.buf.subarray(0, entry.node.size); }

  // ---- android.provider.MediaStore statics ---------------------------------------------------------------------------------------------------------------------------------------------------
  const VOLUMES = ['external', 'external_primary', 'internal'];
  const volumeUri = (r, volume, tail) => { const name = text(r, volume); if (name === null) r.throwJava('Ljava/lang/NullPointerException;', 'volumeName'); return uriOf(r, `content://media/${name}/${tail}`); };
  for (const [owner, tail] of [['Landroid/provider/MediaStore$Images$Media;', 'images/media'], ['Landroid/provider/MediaStore$Video$Media;', 'video/media'], ['Landroid/provider/MediaStore$Audio$Media;', 'audio/media'], ['Landroid/provider/MediaStore$Files;', 'file'], ['Landroid/provider/MediaStore$Downloads;', 'downloads']]) {
    type(owner, OBJECT, [], { allocatable: false });
    if (tail !== 'file') { staticField(owner, 'EXTERNAL_CONTENT_URI', URI, r => uriOf(r, `content://media/external/${tail}`)); if (tail !== 'downloads') staticField(owner, 'INTERNAL_CONTENT_URI', URI, r => uriOf(r, `content://media/internal/${tail}`)); }
    def(owner, 'getContentUri', `(${STRING})${URI}`, (r, _m, [volume]) => volumeUri(r, volume, tail), { static: true });
    def(owner, 'getContentUri', `(${STRING}J)${URI}`, (r, _m, [volume, id]) => volumeUri(r, volume, `${tail}/${BigInt(id)}`), { static: true });
  }
  type(MEDIASTORE, OBJECT, [], { allocatable: false });
  staticField(MEDIASTORE, 'AUTHORITY_URI', URI, r => uriOf(r, 'content://media'));
  def(MEDIASTORE, 'getPickImagesMaxLimit', '()I', () => PICK_IMAGES_MAX_LIMIT, { static: true });
  def(MEDIASTORE, 'getVolumeName', `(${URI})${STRING}`, (r, _m, [uri]) => { const parsed = parseStorageUri(uriString(r, uri)); if (!parsed || parsed.authority !== AUTHORITY.MEDIA || !VOLUMES.includes(parsed.volume)) r.throwJava('Ljava/lang/IllegalArgumentException;', `Missing volume name: ${uriString(r, uri)}`); return parsed.volume; }, { static: true });
  const stringSet = (r, items) => { const set = construct(r, 'Ljava/util/HashSet;', [], []); for (const item of items) call(r, set, 'Ljava/util/HashSet;', 'add', [OBJECT], 'Z', [item]); return set; };
  def(MEDIASTORE, 'getExternalVolumeNames', `(${CONTEXT})Ljava/util/Set;`, r => stringSet(r, ['external_primary']), { static: true });
  def(MEDIASTORE, 'getRecentExternalVolumeNames', `(${CONTEXT})Ljava/util/Set;`, r => stringSet(r, ['external_primary']), { static: true });
  def(MEDIASTORE, 'getVersion', `(${CONTEXT})${STRING}`, () => '33', { static: true });
  def(MEDIASTORE, 'getVersion', `(${CONTEXT}${STRING})${STRING}`, () => '33', { static: true });
  def(MEDIASTORE, 'getGeneration', `(${CONTEXT}${STRING})J`, () => 1n, { static: true });
  // MediaStore.Images.Media.getBitmap (deprecated in API 29, still what many callers use): BitmapFactory.decodeStream over ContentResolver.openInputStream.
  def('Landroid/provider/MediaStore$Images$Media;', 'getBitmap', `(${RESOLVER}${URI})${BITMAP}`, (r, _m, [resolver, uri]) => {
    const input = call(r, resolver, RESOLVER, 'openInputStream', [URI], 'Ljava/io/InputStream;', [uri]);
    try { return callStatic(r, 'Landroid/graphics/BitmapFactory;', 'decodeStream', ['Ljava/io/InputStream;'], BITMAP, [input]); } finally { call(r, input, 'Ljava/io/InputStream;', 'close', [], 'V'); }
  }, { static: true });

  // ---- system pickers ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const extraOf = (intent, key) => intent.extras?.get?.(key) ?? null;
  /** The picker a (resolved-to-nothing) implicit Intent opens: the spec, null when no system app of the device answers it; throws the explicit error for a picker the lab does not model. */
  function pickerFor(r, intent, fields = platform.intentFields(r, intent)) {
    if (intent.target || intent.component) return null;
    const mimeExtra = extraOf(intent, EXTRA.MIME_TYPES), multiple = extraOf(intent, EXTRA.ALLOW_MULTIPLE), max = extraOf(intent, EXTRA.PICK_IMAGES_MAX);
    const spec = pickerSpec({ action: text(r, fields.action), type: text(r, fields.type), data: fields.data, categories: fields.categories.map(value => text(r, value)), package: text(r, fields.package),
      mimeTypes: mimeExtra && !nullish(mimeExtra.value) && mimeExtra.type === STRINGS ? r.array(mimeExtra.value).elements.map(item => text(r, item)).filter(Boolean) : null,
      allowMultiple: !!multiple && (multiple.value === 1 || multiple.value === true), pickImagesMax: max && typeof max.value === 'number' ? max.value : null });
    if (spec?.unsupported) unsupported(spec.unsupported, 'system-picker-unsupported');
    return spec;
  }
  const frameOfActivity = activity => activity ? platform.allFrames().find(frame => sameRef(frame.activity, activity) && !frame.finished) ?? null : null;
  const front = frame => !!frame && !platform.taskInBackground && platform.tasks.at(-1)?.frames.at(-1) === frame;
  /** Hands the result to the Activity that asked and brings the caller back: onActivityResult before onResume, as ActivityThread delivers a result to a paused or stopped Activity. */
  function deliver(r, request, resultCode, data) {
    const receiver = request.requestCode >= 0 ? frameOfActivity(request.resultCaller) : null;
    if (receiver) (receiver.pendingActivityResults ||= []).push({ requestCode: request.requestCode, resultCode, data });
    const frame = request.frame && platform.allFrames().includes(request.frame) && !request.frame.finished ? request.frame : null;
    const waiting = [...pending.values()].some(other => other.frame === frame);   // another picker of the same Activity is still open
    if (frame && front(frame) && !waiting && frame.lifecycleStage !== 4) platform.resumeFrame(r, frame);
    if (receiver && receiver.lifecycleStage === 4) platform.deliverActivityResults(r, receiver);
    platform.onExternalActivity?.();
  }
  const describeSpec = spec => `${spec.picker} picker [${spec.filters.join(', ')}]${spec.multiple ? ` multiple${spec.max > 0 ? ` (max ${spec.max})` : ''}` : ''}`;
  /** startActivity / startActivityForResult of a picker Intent (called by the platform instead of the Activity starter). Asynchronous like every start. */
  function startPicker(r, intent, spec, resultCaller, requestCode, sourceFrame) {
    const described = platform.describeIntentFields(platform.intentFields(r, intent), intent.flags | 0);
    const request = { id: ++sequence, spec, offered: [], frame: sourceFrame ?? null, resultCaller: resultCaller ?? null, requestCode, held: [resultCaller, sourceFrame?.activity ?? null] };
    // What happens is decided and logged at the call (a line recorded from the event pump's own frames is not kept); the lifecycle and the delivery run as the queued start.
    const shown = !spec.invalid && typeof platform.onSystemPickerRequest === 'function' && platform.systemPickerDialogs !== false;
    r.record(`ACTIVITY ${described} -> system ${describeSpec(spec)}`);
    if (spec.invalid) r.record(`PICKER ${request.id} cancelled by the photo picker: ${spec.invalid} (RESULT_CANCELED)`);
    else if (!shown) r.record(`PICKER ${request.id} dismissed: no page shows the system picker (RESULT_CANCELED)`);
    platform.queueTask(() => {
      if (!shown) { deliver(r, request, RESULT_CANCELED, null); return; }
      const { matching, others } = pickerCandidates(spec, [...files.values()]);
      request.offered = matching.map(entry => entry.id);
      const frame = request.frame && platform.allFrames().includes(request.frame) ? request.frame : null;
      if (frame && front(frame)) { platform.pauseForLaunch(r, frame, true); if (spec.picker !== 'photos' && platform.allFrames().includes(frame)) platform.stopFrame(r, frame); }   // the photo picker is a translucent sheet: the caller is only paused
      pending.set(request.id, request);
      platform.onSystemPickerRequest({ id: request.id, picker: spec.picker, action: spec.action, title: SYSTEM_PICKERS[spec.picker].label, filters: spec.filters, multiple: spec.multiple, max: spec.max, files: matching.map(describe), others, total: files.size });
    }, 0, request.held);
  }
  /** The page's answer: the chosen file ids in order, or null / [] for a dismissal. Unknown ids (a reloaded VM) are ignored. */
  function respondPicker(r, id, selected) {
    const request = pending.get(id); if (!request) return false;
    pending.delete(id);
    const spec = request.spec, chosen = settleSelection(spec, request.offered, selected).map(fileId => files.get(fileId)).filter(Boolean);
    if (!chosen.length) { r.record(`PICKER ${id} cancelled (RESULT_CANCELED)`); deliver(r, request, RESULT_CANCELED, null); return true; }
    const style = spec.picker === 'photos' ? 'picker' : spec.picker === 'gallery' ? 'media' : 'document', uris = chosen.map(entry => uriFor(style, entry));
    for (const uri of uris) grant(uri, { write: spec.writable, persistable: spec.persistable });
    syncMounts();
    const intent = construct(r, INTENT, [], []);
    r.hostRoots.push(intent);
    try {
      // DocumentsUI and the gallery answer one document in getData() and several in getClipData(); the photo picker answers getData() in single mode and getClipData() in multiple mode.
      if (spec.picker === 'photos' ? !spec.multiple : uris.length === 1) call(r, intent, INTENT, 'setData', [URI], INTENT, [uriOf(r, uris[0])]);
      else {
        const mimes = [...new Set(chosen.map(entry => entry.mime))], types = r.newArray(STRINGS, mimes.length); r.array(types).elements = mimes;
        const clip = construct(r, CLIP, ['Ljava/lang/CharSequence;', STRINGS, CLIP_ITEM], [null, types, construct(r, CLIP_ITEM, [URI], [uriOf(r, uris[0])])]);
        r.hostRoots.push(clip);
        try { for (const uri of uris.slice(1)) call(r, clip, CLIP, 'addItem', [CLIP_ITEM], 'V', [construct(r, CLIP_ITEM, [URI], [uriOf(r, uri)])]); call(r, intent, INTENT, 'setClipData', [CLIP], 'V', [clip]); } finally { r.hostRoots.pop(); }
      }
      call(r, intent, INTENT, 'addFlags', ['I'], INTENT, [GRANT_READ | (spec.writable ? GRANT_WRITE : 0) | (spec.persistable ? GRANT_PERSISTABLE : 0)]);
      r.record(`PICKER ${id} result RESULT_OK ${uris.join(' ')}`);
      deliver(r, request, RESULT_OK, intent);
    } finally { r.hostRoots.pop(); }
    return true;
  }

  // ---- PackageManager: the system components that answer these Intents (ResolveInfo of another package) ------------------------------------------------------------------------
  const ITEM = 'Landroid/content/pm/PackageItemInfo;', COMPONENT_INFO = 'Landroid/content/pm/ComponentInfo;', RESOLVE = 'Landroid/content/pm/ResolveInfo;', APPLICATION_INFO = 'Landroid/content/pm/ApplicationInfo;';
  const componentInfo = (r, owner, packageName, className) => {
    const info = r.makeObject(owner), application = r.makeObject(APPLICATION_INFO), put = (target, key, value) => r.storeField(r.object(target).fields, key, value);
    put(application, `${ITEM}->packageName:${STRING}`, packageName); put(application, `${APPLICATION_INFO}->flags:I`, 1); put(application, `${APPLICATION_INFO}->enabled:Z`, 1);   // FLAG_SYSTEM
    put(info, `${ITEM}->name:${STRING}`, className); put(info, `${ITEM}->packageName:${STRING}`, packageName); put(info, `${COMPONENT_INFO}->applicationInfo:${APPLICATION_INFO}`, application);
    put(info, `${COMPONENT_INFO}->enabled:Z`, 1); put(info, `${COMPONENT_INFO}->exported:Z`, 1); put(info, `${COMPONENT_INFO}->processName:${STRING}`, packageName);
    return info;
  };
  const resolveInfo = (r, field, info) => { const resolved = construct(r, RESOLVE, [], []); r.storeField(r.object(resolved).fields, `${RESOLVE}->${field}`, info); r.storeField(r.object(resolved).fields, `${RESOLVE}->isDefault:Z`, 1); return resolved; };
  /** PackageManager.resolveActivity / queryIntentActivities: the ResolveInfo of the system picker that answers `intent`, or null. A picker the lab does not model resolves to nothing here (the start names it). */
  function systemActivity(r, intentRef) {
    let spec; try { spec = pickerFor(r, r.object(intentRef)); } catch (error) { if (error instanceof APKError) return null; throw error; }
    if (!spec) return null;
    const system = SYSTEM_PICKERS[spec.picker];
    return resolveInfo(r, 'activityInfo:Landroid/content/pm/ActivityInfo;', componentInfo(r, 'Landroid/content/pm/ActivityInfo;', system.packageName, system.className));
  }
  /** PackageManager.queryIntentContentProviders(android.content.action.DOCUMENTS_PROVIDER): the device's documents providers (DocumentsContract.isDocumentUri asks). */
  function documentsProviders(r, action) {
    if (action !== 'android.content.action.DOCUMENTS_PROVIDER') return [];
    return [[AUTHORITY.MEDIA_DOCUMENTS, 'com.android.providers.media.module', MEDIA_DOCUMENTS], [AUTHORITY.STORAGE_DOCUMENTS, 'com.android.externalstorage', STORAGE_DOCUMENTS]].map(([authority, packageName, owner]) => {
      const info = componentInfo(r, 'Landroid/content/pm/ProviderInfo;', packageName, owner.slice(1, -1).replaceAll('/', '.'));
      r.storeField(r.object(info).fields, `Landroid/content/pm/ProviderInfo;->authority:${STRING}`, authority); r.storeField(r.object(info).fields, 'Landroid/content/pm/ProviderInfo;->grantUriPermissions:Z', 1);
      return resolveInfo(r, 'providerInfo:Landroid/content/pm/ProviderInfo;', info);
    });
  }

  return { ...registry, setFiles, list, provider, bytesFor, pickerFor, startPicker, respondPicker, pendingIds: () => [...pending.keys()], permissionsChanged: syncMounts, isGranted: granted,
    takePersistable, releasePersistable, persistedPermissions, systemActivity, documentsProviders, contributed,
    /** The ResolveInfo of an Activity of another (system) package, for the hosts that answer Intents the way a system app does (the camera app: src/camera-capture-intent.js). */
    systemResolveInfo: (r, packageName, className) => resolveInfo(r, 'activityInfo:Landroid/content/pm/ActivityInfo;', componentInfo(r, 'Landroid/content/pm/ActivityInfo;', packageName, className)), get fileCount() { return files.size; },
    [GC_ROOTS](visit) { for (const request of pending.values()) visit(request.held); for (const value of providers.values()) visit(value); } };
}
