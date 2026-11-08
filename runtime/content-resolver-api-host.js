import { createHostRegistry } from './host-contract.js?v=cc91314626dd';
import { APKError } from './apk-error.js?v=cc91314626dd';

// android.content.ContentResolver (android-13.0.0_r1 ContentResolver.java) and the default bodies of android.content.ContentProvider for the virtual device. The device has one package, so a
// content authority resolves to a provider this app declares and installed at start (ActivityThread.installContentProviders); the ContentResolver calls it directly on the calling thread, which is what
// a same-process Binder call comes to. An authority nobody owns behaves as ContentResolver does when acquireProvider finds nothing: query / getType answer null, insert / update / delete /
// bulkInsert / call throw IllegalArgumentException("Unknown URL ..."), opening a file throws FileNotFoundException("No content provider: ..."). file:// and android.resource:// URIs open the way
// ContentResolver.openAssetFileDescriptor opens them. The sync API (SyncManager) has no accounts to sync: it answers like a device without any (nothing syncing, master sync on, changes of sync
// settings refused for the missing WRITE_SYNC_SETTINGS permission).
const RESOLVER = 'Landroid/content/ContentResolver;', PROVIDER = 'Landroid/content/ContentProvider;', URI = 'Landroid/net/Uri;', STRING = 'Ljava/lang/String;', STRINGS = '[Ljava/lang/String;', BUNDLE = 'Landroid/os/Bundle;';
const VALUES = 'Landroid/content/ContentValues;', CURSOR = 'Landroid/database/Cursor;', SIGNAL = 'Landroid/os/CancellationSignal;', PFD = 'Landroid/os/ParcelFileDescriptor;', ACCOUNT = 'Landroid/accounts/Account;', OBJECT = 'Ljava/lang/Object;';
const FDESC = 'Ljava/io/FileDescriptor;', INPUT = 'Ljava/io/InputStream;', OUTPUT = 'Ljava/io/OutputStream;', LIST = 'Ljava/util/List;';
const nullish = v => v === null || v === undefined || v === 0;

export function createContentResolverApiHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const npe = (r, message = null) => r.throwJava('Ljava/lang/NullPointerException;', message);
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };
  const uriText = (r, uri) => text(r, call(r, uri, OBJECT, 'toString', [], STRING));
  const authorityOf = (r, uri) => text(r, call(r, uri, URI, 'getAuthority', [], STRING));
  const schemeOf = (r, uri) => text(r, call(r, uri, URI, 'getScheme', [], STRING));
  const providerOf = (r, uri) => { if (nullish(uri)) npe(r, 'uri'); const authority = authorityOf(r, uri); return authority === null ? null : platform.appServices.providerByAuthority(authority); };
  const unknown = (r, uri) => r.throwJava('Ljava/lang/IllegalArgumentException;', `Unknown URL ${uriText(r, uri)}`);
  const noProvider = (r, uri) => r.throwJava('Ljava/io/FileNotFoundException;', `No content provider: ${uriText(r, uri)}`);
  const emptyList = r => callStatic(r, 'Ljava/util/Collections;', 'emptyList', [], LIST);
  const writeSync = r => r.throwJava('Ljava/lang/SecurityException;', `Neither user ${platform.virtualProcess.uid} nor current process has android.permission.WRITE_SYNC_SETTINGS.`);

  // ---- ContentResolver CRUD --------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  def(RESOLVER, 'query', `(${URI}${STRINGS}${STRING}${STRINGS}${STRING})${CURSOR}`, (r, _m, [self, uri, projection, selection, args, sort]) => call(r, self, RESOLVER, 'query', [URI, STRINGS, STRING, STRINGS, STRING, SIGNAL], CURSOR, [uri, projection, selection, args, sort, null]));
  def(RESOLVER, 'query', `(${URI}${STRINGS}${STRING}${STRINGS}${STRING}${SIGNAL})${CURSOR}`, (r, _m, [self, uri, projection, selection, args, sort, signal]) => {
    const bundle = construct(r, BUNDLE, [], []);
    const put = (key, name, value) => { if (!nullish(value)) call(r, bundle, BUNDLE, name, [STRING, name === 'putString' ? STRING : STRINGS], 'V', [key, value]); };
    put('android:query-arg-sql-selection', 'putString', selection); put('android:query-arg-sql-selection-args', 'putStringArray', args); put('android:query-arg-sql-sort-order', 'putString', sort);
    return call(r, self, RESOLVER, 'query', [URI, STRINGS, BUNDLE, SIGNAL], CURSOR, [uri, projection, bundle, signal]);
  });
  def(RESOLVER, 'query', `(${URI}${STRINGS}${BUNDLE}${SIGNAL})${CURSOR}`, (r, _m, [, uri, projection, bundle, signal]) => {
    const provider = providerOf(r, uri); if (provider === null) { r.record(`CONTENT Failed to find provider info for ${authorityOf(r, uri)}`); return null; }
    return call(r, provider, PROVIDER, 'query', [URI, STRINGS, BUNDLE, SIGNAL], CURSOR, [uri, projection, bundle, signal]);
  });
  def(RESOLVER, 'getType', `(${URI})${STRING}`, (r, _m, [, uri]) => { const provider = providerOf(r, uri); return provider === null ? null : call(r, provider, PROVIDER, 'getType', [URI], STRING, [uri]); });
  def(RESOLVER, 'getStreamTypes', `(${URI}${STRING})${STRINGS}`, (r, _m, [, uri, filter]) => { if (nullish(filter)) npe(r, 'mimeTypeFilter'); const p = providerOf(r, uri); return p === null ? null : call(r, p, PROVIDER, 'getStreamTypes', [URI, STRING], STRINGS, [uri, filter]); });
  def(RESOLVER, 'insert', `(${URI}${VALUES})${URI}`, (r, _m, [self, uri, values]) => call(r, self, RESOLVER, 'insert', [URI, VALUES, BUNDLE], URI, [uri, values, null]));
  def(RESOLVER, 'insert', `(${URI}${VALUES}${BUNDLE})${URI}`, (r, _m, [, uri, values, extras]) => { const p = providerOf(r, uri); if (p === null) unknown(r, uri); return call(r, p, PROVIDER, 'insert', [URI, VALUES, BUNDLE], URI, [uri, values, extras]); });
  def(RESOLVER, 'bulkInsert', `(${URI}[${VALUES})I`, (r, _m, [, uri, values]) => { const p = providerOf(r, uri); if (p === null) unknown(r, uri); return call(r, p, PROVIDER, 'bulkInsert', [URI, `[${VALUES}`], 'I', [uri, values]); });
  def(RESOLVER, 'delete', `(${URI}${STRING}${STRINGS})I`, (r, _m, [self, uri, where, args]) => {
    const bundle = construct(r, BUNDLE, [], []); if (!nullish(where)) call(r, bundle, BUNDLE, 'putString', [STRING, STRING], 'V', ['android:query-arg-sql-selection', where]); if (!nullish(args)) call(r, bundle, BUNDLE, 'putStringArray', [STRING, STRINGS], 'V', ['android:query-arg-sql-selection-args', args]);
    return call(r, self, RESOLVER, 'delete', [URI, BUNDLE], 'I', [uri, bundle]);
  });
  def(RESOLVER, 'delete', `(${URI}${BUNDLE})I`, (r, _m, [, uri, extras]) => { const p = providerOf(r, uri); if (p === null) unknown(r, uri); return call(r, p, PROVIDER, 'delete', [URI, BUNDLE], 'I', [uri, extras]); });
  def(RESOLVER, 'update', `(${URI}${VALUES}${STRING}${STRINGS})I`, (r, _m, [self, uri, values, where, args]) => {
    const bundle = construct(r, BUNDLE, [], []); if (!nullish(where)) call(r, bundle, BUNDLE, 'putString', [STRING, STRING], 'V', ['android:query-arg-sql-selection', where]); if (!nullish(args)) call(r, bundle, BUNDLE, 'putStringArray', [STRING, STRINGS], 'V', ['android:query-arg-sql-selection-args', args]);
    return call(r, self, RESOLVER, 'update', [URI, VALUES, BUNDLE], 'I', [uri, values, bundle]);
  });
  def(RESOLVER, 'update', `(${URI}${VALUES}${BUNDLE})I`, (r, _m, [, uri, values, extras]) => { const p = providerOf(r, uri); if (p === null) unknown(r, uri); return call(r, p, PROVIDER, 'update', [URI, VALUES, BUNDLE], 'I', [uri, values, extras]); });
  def(RESOLVER, 'call', `(${URI}${STRING}${STRING}${BUNDLE})${BUNDLE}`, (r, _m, [, uri, method, arg, extras]) => { if (nullish(method)) npe(r, 'method'); const p = providerOf(r, uri); if (p === null) unknown(r, uri); return call(r, p, PROVIDER, 'call', [STRING, STRING, STRING, BUNDLE], BUNDLE, [authorityOf(r, uri), method, arg, extras]); });
  def(RESOLVER, 'call', `(${STRING}${STRING}${STRING}${BUNDLE})${BUNDLE}`, (r, _m, [, authority, method, arg, extras]) => {
    if (nullish(authority)) npe(r, 'authority'); if (nullish(method)) npe(r, 'method');
    const p = platform.appServices.providerByAuthority(text(r, authority)); if (p === null) r.throwJava('Ljava/lang/IllegalArgumentException;', `Unknown authority ${text(r, authority)}`);
    return call(r, p, PROVIDER, 'call', [STRING, STRING, STRING, BUNDLE], BUNDLE, [authority, method, arg, extras]);
  });
  def(RESOLVER, 'canonicalize', `(${URI})${URI}`, (r, _m, [, uri]) => { const p = providerOf(r, uri); return p === null ? null : call(r, p, PROVIDER, 'canonicalize', [URI], URI, [uri]); });
  def(RESOLVER, 'uncanonicalize', `(${URI})${URI}`, (r, _m, [, uri]) => { const p = providerOf(r, uri); return p === null ? uri : call(r, p, PROVIDER, 'uncanonicalize', [URI], URI, [uri]); });
  def(RESOLVER, 'refresh', `(${URI}${BUNDLE}${SIGNAL})Z`, (r, _m, [, uri, extras, signal]) => { const p = providerOf(r, uri); return p === null ? 0 : call(r, p, PROVIDER, 'refresh', [URI, BUNDLE, SIGNAL], 'Z', [uri, extras, signal]); });
  def(RESOLVER, 'notifyChange', `(${URI}Landroid/database/ContentObserver;I)V`, (r, _m, [self, uri, observer, flags]) => call(r, self, RESOLVER, 'notifyChange', [URI, 'Landroid/database/ContentObserver;', 'Z'], 'V', [uri, observer, (flags & 1) !== 0 ? 1 : 0]));   // NOTIFY_SYNC_TO_NETWORK = 1
  def(RESOLVER, 'notifyChange', `(Ljava/util/Collection;Landroid/database/ContentObserver;I)V`, (r, _m, [self, uris, observer, flags]) => {
    if (nullish(uris)) npe(r, 'uris'); const it = call(r, uris, 'Ljava/util/Collection;', 'iterator', [], 'Ljava/util/Iterator;');
    while (call(r, it, 'Ljava/util/Iterator;', 'hasNext', [], 'Z')) call(r, self, RESOLVER, 'notifyChange', [URI, 'Landroid/database/ContentObserver;', 'I'], 'V', [call(r, it, 'Ljava/util/Iterator;', 'next', [], OBJECT), observer, flags]);
  });

  // ---- opening content: file:// and android.resource:// URIs, otherwise the provider's openFile ---------------------------------------------------------------------------------------------------
  const stream = (r, uri, mode, output) => {
    if (nullish(uri)) npe(r, 'uri');
    const scheme = schemeOf(r, uri);
    if (scheme === 'file' || scheme === null) {
      const path = text(r, call(r, uri, URI, 'getPath', [], STRING)); if (path === null) noProvider(r, uri);
      return output ? construct(r, 'Ljava/io/FileOutputStream;', [STRING, 'Z'], [path, mode === 'wa' ? 1 : 0]) : construct(r, 'Ljava/io/FileInputStream;', [STRING], [path]);
    }
    if (scheme === 'android.resource') {
      if (output) r.throwJava('Ljava/io/FileNotFoundException;', `Resource does not support writing: ${uriText(r, uri)}`);
      const resources = call(r, platform.application, 'Landroid/content/Context;', 'getResources', [], 'Landroid/content/res/Resources;'), segments = call(r, uri, URI, 'getPathSegments', [], LIST);
      const last = text(r, call(r, segments, LIST, 'get', ['I'], OBJECT, [call(r, segments, LIST, 'size', [], 'I') - 1]));
      const id = /^\d+$/.test(last) ? Number(last) : call(r, resources, 'Landroid/content/res/Resources;', 'getIdentifier', [STRING, STRING, STRING], 'I', [last, text(r, call(r, segments, LIST, 'get', ['I'], OBJECT, [0])), authorityOf(r, uri)]);
      if (!id) r.throwJava('Ljava/io/FileNotFoundException;', `No resource found for: ${uriText(r, uri)}`);
      return call(r, resources, 'Landroid/content/res/Resources;', 'openRawResource', ['I'], INPUT, [id]);
    }
    const p = providerOf(r, uri); if (p === null) noProvider(r, uri);
    const pfd = call(r, p, PROVIDER, 'openFile', [URI, STRING], PFD, [uri, output ? (mode ?? 'w') : (mode ?? 'r')]);
    if (nullish(pfd)) noProvider(r, uri);
    return construct(r, output ? 'Landroid/os/ParcelFileDescriptor$AutoCloseOutputStream;' : 'Landroid/os/ParcelFileDescriptor$AutoCloseInputStream;', [PFD], [pfd]);
  };
  def(RESOLVER, 'openInputStream', `(${URI})${INPUT}`, (r, _m, [, uri]) => stream(r, uri, 'r', false));
  def(RESOLVER, 'openOutputStream', `(${URI})${OUTPUT}`, (r, _m, [, uri]) => stream(r, uri, 'w', true));
  def(RESOLVER, 'openOutputStream', `(${URI}${STRING})${OUTPUT}`, (r, _m, [, uri, mode]) => stream(r, uri, text(r, mode), true));
  const openFile = (r, uri, mode, signal) => {
    if (nullish(uri)) npe(r, 'uri'); if (nullish(mode)) npe(r, 'mode');
    const scheme = schemeOf(r, uri), modeText = text(r, mode);
    if (scheme === 'file') return callStatic(r, PFD, 'open', ['Ljava/io/File;', 'I'], PFD, [construct(r, 'Ljava/io/File;', [STRING], [text(r, call(r, uri, URI, 'getPath', [], STRING))]), callStatic(r, PFD, 'parseMode', [STRING], 'I', [mode])]);
    const p = providerOf(r, uri); if (p === null) noProvider(r, uri);
    return call(r, p, PROVIDER, 'openFile', [URI, STRING, SIGNAL], PFD, [uri, mode, signal]);
  };
  def(RESOLVER, 'openFileDescriptor', `(${URI}${STRING})${PFD}`, (r, _m, [, uri, mode]) => openFile(r, uri, mode, null));
  def(RESOLVER, 'openFileDescriptor', `(${URI}${STRING}${SIGNAL})${PFD}`, (r, _m, [, uri, mode, signal]) => openFile(r, uri, mode, signal));
  def(RESOLVER, 'openFile', `(${URI}${STRING}${SIGNAL})${PFD}`, (r, _m, [, uri, mode, signal]) => openFile(r, uri, mode, signal));
  // ---- AssetFileDescriptor (android.content.res): a ParcelFileDescriptor plus the (offset, length) of the data inside it. Streams over a sub-range are not modelled (explicit error); a whole-file one is.
  const AFD = 'Landroid/content/res/AssetFileDescriptor;'; registry.type(AFD, OBJECT, ['Landroid/os/Parcelable;', 'Ljava/io/Closeable;'], { allocatable: true });
  const afd = (r, self) => r.object(self).afd ?? r.throwJava('Ljava/lang/IllegalStateException;', 'AssetFileDescriptor used before construction');
  registry.staticField(AFD, 'UNKNOWN_LENGTH', 'J', () => -1n);
  def(AFD, '<init>', `(${PFD}JJ)V`, (r, _m, [self, fd, start, length]) => { r.object(self).afd = { fd, start: BigInt(start), length: BigInt(length), extras: null }; });
  def(AFD, '<init>', `(${PFD}JJ${BUNDLE})V`, (r, _m, [self, fd, start, length, extras]) => { r.object(self).afd = { fd, start: BigInt(start), length: BigInt(length), extras: nullish(extras) ? null : extras }; });
  def(AFD, 'getParcelFileDescriptor', `()${PFD}`, (r, _m, [self]) => afd(r, self).fd);
  def(AFD, 'getFileDescriptor', `()${FDESC}`, (r, _m, [self]) => call(r, afd(r, self).fd, PFD, 'getFileDescriptor', [], FDESC));
  def(AFD, 'getStartOffset', '()J', (r, _m, [self]) => afd(r, self).start); def(AFD, 'getDeclaredLength', '()J', (r, _m, [self]) => afd(r, self).length);
  def(AFD, 'getExtras', `()${BUNDLE}`, (r, _m, [self]) => afd(r, self).extras);
  def(AFD, 'getLength', '()J', (r, _m, [self]) => { const a = afd(r, self); if (a.length >= 0n) return a.length; const size = BigInt(call(r, a.fd, PFD, 'getStatSize', [], 'J')); return size >= 0n ? size : -1n; });
  const wholeFile = (r, self, what) => { const a = afd(r, self); if (a.start !== 0n || a.length !== -1n) unsupported(`AssetFileDescriptor.${what}: a stream over a sub-range (offset ${a.start}, length ${a.length}) of the descriptor is not modelled; whole-file descriptors are`, 'asset-file-range-unsupported'); return a; };
  def(AFD, 'createInputStream', '()Ljava/io/FileInputStream;', (r, _m, [self]) => construct(r, 'Landroid/os/ParcelFileDescriptor$AutoCloseInputStream;', [PFD], [wholeFile(r, self, 'createInputStream').fd]));
  def(AFD, 'createOutputStream', '()Ljava/io/FileOutputStream;', (r, _m, [self]) => construct(r, 'Landroid/os/ParcelFileDescriptor$AutoCloseOutputStream;', [PFD], [wholeFile(r, self, 'createOutputStream').fd]));
  def(AFD, 'close', '()V', (r, _m, [self]) => call(r, afd(r, self).fd, PFD, 'close', [], 'V'));
  def(AFD, 'describeContents', '()I', () => 0);
  def(AFD, 'toString', `()${STRING}`, (r, _m, [self]) => { const a = afd(r, self); return `{AssetFileDescriptor: ${text(r, call(r, a.fd, OBJECT, 'toString', [], STRING))} start=${a.start} len=${a.length}}`; });
  const toAfd = (r, pfd) => nullish(pfd) ? null : construct(r, AFD, [PFD, 'J', 'J'], [pfd, 0n, -1n]);
  const openAsset = (r, uri, mode, signal) => {
    if (nullish(uri)) npe(r, 'uri'); if (nullish(mode)) npe(r, 'mode'); const scheme = schemeOf(r, uri);
    if (scheme === 'android.resource') unsupported('ContentResolver.openAssetFileDescriptor(android.resource://...): raw resources are compressed inside the APK and have no file descriptor here; use openInputStream', 'asset-file-descriptor-unsupported');
    if (scheme === 'file' || scheme === null) return toAfd(r, openFile(r, uri, mode, signal));
    const p = providerOf(r, uri); if (p === null) noProvider(r, uri);
    return call(r, p, PROVIDER, 'openAssetFile', [URI, STRING, SIGNAL], AFD, [uri, mode, signal]);
  };
  def(RESOLVER, 'openAssetFileDescriptor', `(${URI}${STRING})${AFD}`, (r, _m, [, uri, mode]) => openAsset(r, uri, mode, null));
  def(RESOLVER, 'openAssetFileDescriptor', `(${URI}${STRING}${SIGNAL})${AFD}`, (r, _m, [, uri, mode, signal]) => openAsset(r, uri, mode, signal));
  def(RESOLVER, 'openAssetFile', `(${URI}${STRING}${SIGNAL})${AFD}`, (r, _m, [, uri, mode, signal]) => openAsset(r, uri, mode, signal));
  const openTyped = (r, uri, type, opts, signal) => {
    if (nullish(uri)) npe(r, 'uri'); if (nullish(type)) npe(r, 'mimeType'); const scheme = schemeOf(r, uri);
    if (scheme === 'file' || scheme === null) return toAfd(r, openFile(r, uri, 'r', signal));
    const p = providerOf(r, uri); if (p === null) noProvider(r, uri);
    return call(r, p, PROVIDER, 'openTypedAssetFile', [URI, STRING, BUNDLE, SIGNAL], AFD, [uri, type, opts, signal]);
  };
  def(RESOLVER, 'openTypedAssetFileDescriptor', `(${URI}${STRING}${BUNDLE})${AFD}`, (r, _m, [, uri, type, opts]) => openTyped(r, uri, type, opts, null));
  def(RESOLVER, 'openTypedAssetFileDescriptor', `(${URI}${STRING}${BUNDLE}${SIGNAL})${AFD}`, (r, _m, [, uri, type, opts, signal]) => openTyped(r, uri, type, opts, signal));
  def(RESOLVER, 'openTypedAssetFile', `(${URI}${STRING}${BUNDLE}${SIGNAL})${AFD}`, (r, _m, [, uri, type, opts, signal]) => openTyped(r, uri, type, opts, signal));
  // ContentProvider.openAssetFile / openTypedAssetFile default bodies
  def(PROVIDER, 'openAssetFile', `(${URI}${STRING})${AFD}`, (r, _m, [self, uri, mode]) => toAfd(r, call(r, self, PROVIDER, 'openFile', [URI, STRING], PFD, [uri, mode])));
  def(PROVIDER, 'openAssetFile', `(${URI}${STRING}${SIGNAL})${AFD}`, (r, _m, [self, uri, mode]) => call(r, self, PROVIDER, 'openAssetFile', [URI, STRING], AFD, [uri, mode]));
  def(PROVIDER, 'openTypedAssetFile', `(${URI}${STRING}${BUNDLE})${AFD}`, (r, _m, [self, uri, type, opts]) => {
    const wanted = text(r, type); if (wanted === '*/*') return call(r, self, PROVIDER, 'openAssetFile', [URI, STRING], AFD, [uri, 'r']);
    const base = text(r, call(r, self, PROVIDER, 'getType', [URI], STRING, [uri])); const fits = base !== null && (wanted === base || wanted.endsWith('/*') && base.startsWith(wanted.slice(0, -1)));
    if (fits) return call(r, self, PROVIDER, 'openAssetFile', [URI, STRING], AFD, [uri, 'r']);
    r.throwJava('Ljava/io/FileNotFoundException;', `Can't open ${uriText(r, uri)} as type ${wanted}`);
  });
  def(PROVIDER, 'openTypedAssetFile', `(${URI}${STRING}${BUNDLE}${SIGNAL})${AFD}`, (r, _m, [self, uri, type, opts]) => call(r, self, PROVIDER, 'openTypedAssetFile', [URI, STRING, BUNDLE], AFD, [uri, type, opts]));
  // ContentResolver.loadThumbnail lives in image-decoder-host.js (it decodes the asset the provider returns)
  def(RESOLVER, 'getTypeInfo', `(${STRING})Landroid/content/ContentResolver$MimeTypeInfo;`, () => unsupported('ContentResolver.getTypeInfo: MimeTypeInfo (the platform MIME icon/label table) is not part of the lab framework', 'mime-type-info-unsupported'));
  def(RESOLVER, 'applyBatch', `(${STRING}Ljava/util/ArrayList;)[Landroid/content/ContentProviderResult;`, () => unsupported('ContentResolver.applyBatch: ContentProviderOperation / ContentProviderResult are not part of the lab framework', 'content-batch-unsupported'));
  for (const sig of [`(${PROVIDER})${RESOLVER}`, `(Landroid/content/ContentProviderClient;)${RESOLVER}`]) def(RESOLVER, 'wrap', sig, () => unsupported('ContentResolver.wrap is a test seam over a single provider; not modelled', 'content-resolver-wrap-unsupported'), { static: true });

  // ---- persisted URI permissions: the app is the only package, so there are none to take or give back ----------------------------------------------------------------------------------------
  def(RESOLVER, 'takePersistableUriPermission', `(${URI}I)V`, (r, _m, [, uri, flags]) => { if (nullish(uri)) npe(r, 'uri'); if ((flags & 3) === 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Must specify a read or write permission'); r.throwJava('Ljava/lang/SecurityException;', `No persistable permission grants found for URI ${uriText(r, uri)}`); });
  def(RESOLVER, 'releasePersistableUriPermission', `(${URI}I)V`, (r, _m, [, uri]) => { if (nullish(uri)) npe(r, 'uri'); });
  def(RESOLVER, 'getPersistedUriPermissions', `()${LIST}`, r => emptyList(r)); def(RESOLVER, 'getOutgoingPersistedUriPermissions', `()${LIST}`, r => emptyList(r));

  // ---- sync (no accounts) -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const acct = (r, account, authority) => { if (nullish(account) || nullish(authority)) npe(r); };
  def(RESOLVER, 'getMasterSyncAutomatically', '()Z', () => 1);
  def(RESOLVER, 'setMasterSyncAutomatically', '(Z)V', r => writeSync(r));
  def(RESOLVER, 'getSyncAutomatically', `(${ACCOUNT}${STRING})Z`, (r, _m, [, a, b]) => { acct(r, a, b); return 0; });
  def(RESOLVER, 'setSyncAutomatically', `(${ACCOUNT}${STRING}Z)V`, r => writeSync(r));
  def(RESOLVER, 'getIsSyncable', `(${ACCOUNT}${STRING})I`, (r, _m, [, a, b]) => { acct(r, a, b); return -1; });
  def(RESOLVER, 'setIsSyncable', `(${ACCOUNT}${STRING}I)V`, r => writeSync(r));
  def(RESOLVER, 'isSyncActive', `(${ACCOUNT}${STRING})Z`, (r, _m, [, a, b]) => { acct(r, a, b); return 0; }); def(RESOLVER, 'isSyncPending', `(${ACCOUNT}${STRING})Z`, (r, _m, [, a, b]) => { acct(r, a, b); return 0; });
  def(RESOLVER, 'getCurrentSync', '()Landroid/content/SyncInfo;', () => null); def(RESOLVER, 'getCurrentSyncs', `()${LIST}`, r => emptyList(r));
  def(RESOLVER, 'getPeriodicSyncs', `(${ACCOUNT}${STRING})${LIST}`, (r, _m, [, a, b]) => { acct(r, a, b); return emptyList(r); });
  def(RESOLVER, 'addPeriodicSync', `(${ACCOUNT}${STRING}${BUNDLE}J)V`, r => writeSync(r)); def(RESOLVER, 'removePeriodicSync', `(${ACCOUNT}${STRING}${BUNDLE})V`, r => writeSync(r));
  def(RESOLVER, 'getSyncAdapterTypes', '()[Landroid/content/SyncAdapterType;', r => r.newArray('[Landroid/content/SyncAdapterType;', 0));
  def(RESOLVER, 'requestSync', `(${ACCOUNT}${STRING}${BUNDLE})V`, (r, _m, [, a, b]) => { acct(r, a, b); r.record('SYNC requestSync: no sync adapters on the virtual device'); });
  def(RESOLVER, 'requestSync', '(Landroid/content/SyncRequest;)V', () => {}); def(RESOLVER, 'startSync', `(${URI}${BUNDLE})V`, () => {});
  def(RESOLVER, 'cancelSync', `(${ACCOUNT}${STRING})V`, () => {}); def(RESOLVER, 'cancelSync', '(Landroid/content/SyncRequest;)V', () => {}); def(RESOLVER, 'cancelSync', `(${URI})V`, () => {});
  def(RESOLVER, 'addStatusChangeListener', `(ILandroid/content/SyncStatusObserver;)${OBJECT}`, (r, _m, [, , observer]) => { if (nullish(observer)) npe(r, 'observer'); return construct(r, OBJECT, [], []); });
  def(RESOLVER, 'removeStatusChangeListener', `(${OBJECT})V`, () => {});
  def(RESOLVER, 'validateSyncExtrasBundle', `(${BUNDLE})V`, () => {});

  // ---- ContentProvider default bodies (ContentProvider.java): what a provider that does not override a method answers ---------------------------------------------------------------------------
  const arg = (r, bundle, name, key, type) => nullish(bundle) ? null : call(r, bundle, BUNDLE, name, [STRING], type, [key]);
  def(PROVIDER, 'query', `(${URI}${STRINGS}${BUNDLE}${SIGNAL})${CURSOR}`, (r, _m, [self, uri, projection, bundle, signal]) => {
    const sort = arg(r, bundle, 'getString', 'android:query-arg-sql-sort-order', STRING);
    return call(r, self, PROVIDER, 'query', [URI, STRINGS, STRING, STRINGS, STRING, SIGNAL], CURSOR, [uri, projection, arg(r, bundle, 'getString', 'android:query-arg-sql-selection', STRING), arg(r, bundle, 'getStringArray', 'android:query-arg-sql-selection-args', STRINGS), sort, signal]);
  });
  def(PROVIDER, 'query', `(${URI}${STRINGS}${STRING}${STRINGS}${STRING}${SIGNAL})${CURSOR}`, (r, _m, [self, uri, projection, selection, args, sort]) => call(r, self, PROVIDER, 'query', [URI, STRINGS, STRING, STRINGS, STRING], CURSOR, [uri, projection, selection, args, sort]));
  def(PROVIDER, 'insert', `(${URI}${VALUES}${BUNDLE})${URI}`, (r, _m, [self, uri, values]) => call(r, self, PROVIDER, 'insert', [URI, VALUES], URI, [uri, values]));
  def(PROVIDER, 'delete', `(${URI}${BUNDLE})I`, (r, _m, [self, uri, extras]) => call(r, self, PROVIDER, 'delete', [URI, STRING, STRINGS], 'I', [uri, arg(r, extras, 'getString', 'android:query-arg-sql-selection', STRING), arg(r, extras, 'getStringArray', 'android:query-arg-sql-selection-args', STRINGS)]));
  def(PROVIDER, 'update', `(${URI}${VALUES}${BUNDLE})I`, (r, _m, [self, uri, values, extras]) => call(r, self, PROVIDER, 'update', [URI, VALUES, STRING, STRINGS], 'I', [uri, values, arg(r, extras, 'getString', 'android:query-arg-sql-selection', STRING), arg(r, extras, 'getStringArray', 'android:query-arg-sql-selection-args', STRINGS)]));
  def(PROVIDER, 'bulkInsert', `(${URI}[${VALUES})I`, (r, _m, [self, uri, values]) => { let n = 0; for (const v of r.array(values).elements) { call(r, self, PROVIDER, 'insert', [URI, VALUES], URI, [uri, v]); n++; } return n; });
  def(PROVIDER, 'call', `(${STRING}${STRING}${STRING}${BUNDLE})${BUNDLE}`, (r, _m, [self, , method, arg_, extras]) => call(r, self, PROVIDER, 'call', [STRING, STRING, BUNDLE], BUNDLE, [method, arg_, extras]));
  def(PROVIDER, 'call', `(${STRING}${STRING}${BUNDLE})${BUNDLE}`, () => null);
  def(PROVIDER, 'openFile', `(${URI}${STRING})${PFD}`, (r, _m, [, uri]) => r.throwJava('Ljava/io/FileNotFoundException;', `No files supported by provider at ${uriText(r, uri)}`));
  def(PROVIDER, 'openFile', `(${URI}${STRING}${SIGNAL})${PFD}`, (r, _m, [self, uri, mode]) => call(r, self, PROVIDER, 'openFile', [URI, STRING], PFD, [uri, mode]));
  def(PROVIDER, 'getStreamTypes', `(${URI}${STRING})${STRINGS}`, () => null);
  def(PROVIDER, 'canonicalize', `(${URI})${URI}`, () => null); def(PROVIDER, 'uncanonicalize', `(${URI})${URI}`, (r, _m, [, uri]) => uri);
  def(PROVIDER, 'refresh', `(${URI}${BUNDLE}${SIGNAL})Z`, () => 0);
  def(PROVIDER, 'getType', `(${URI})${STRING}`, () => { throw new APKError('ContentProvider.getType is abstract: the provider must implement it', { kind: 'abstract-method' }); });

  // ---- ContentProviderClient: a handle on the provider of one authority (release() / close() once; later calls on a released client throw DeadObject-style IllegalStateException in the framework, here a RuntimeException) ----
  const CLIENT = 'Landroid/content/ContentProviderClient;'; registry.type(CLIENT, OBJECT, ['Ljava/lang/AutoCloseable;'], { allocatable: false });
  const clientOf = (r, self) => { const c = r.object(self).client; if (!c || c.released) r.throwJava('Ljava/lang/IllegalStateException;', 'ContentProviderClient has been released'); return c; };
  const acquire = (r, provider) => { if (provider === null) return null; const o = r.makeObject(CLIENT); r.object(o).client = { provider, released: false }; return o; };
  for (const name of ['acquireContentProviderClient', 'acquireUnstableContentProviderClient']) {
    def(RESOLVER, name, `(${URI})${CLIENT}`, (r, _m, [, uri]) => { if (nullish(uri)) npe(r, 'uri'); return acquire(r, providerOf(r, uri)); });
    def(RESOLVER, name, `(${STRING})${CLIENT}`, (r, _m, [, authority]) => { if (nullish(authority)) npe(r, 'name'); return acquire(r, platform.appServices.providerByAuthority(text(r, authority))); });
  }
  const viaClient = (name, params, result, args = params) => def(CLIENT, name, `(${params.join('')})${result}`, (r, _m, [self, ...values]) => call(r, clientOf(r, self).provider, PROVIDER, name, params, result, values));
  viaClient('query', [URI, STRINGS, STRING, STRINGS, STRING], CURSOR); viaClient('query', [URI, STRINGS, STRING, STRINGS, STRING, SIGNAL], CURSOR); viaClient('query', [URI, STRINGS, BUNDLE, SIGNAL], CURSOR);
  viaClient('getType', [URI], STRING); viaClient('getStreamTypes', [URI, STRING], STRINGS); viaClient('insert', [URI, VALUES], URI); viaClient('insert', [URI, VALUES, BUNDLE], URI);
  viaClient('bulkInsert', [URI, `[${VALUES}`], 'I'); viaClient('delete', [URI, STRING, STRINGS], 'I'); viaClient('delete', [URI, BUNDLE], 'I'); viaClient('update', [URI, VALUES, STRING, STRINGS], 'I'); viaClient('update', [URI, VALUES, BUNDLE], 'I');
  viaClient('canonicalize', [URI], URI); viaClient('uncanonicalize', [URI], URI); viaClient('refresh', [URI, BUNDLE, SIGNAL], 'Z');
  def(CLIENT, 'call', `(${STRING}${STRING}${BUNDLE})${BUNDLE}`, (r, _m, [self, method, arg, extras]) => call(r, clientOf(r, self).provider, PROVIDER, 'call', [STRING, STRING, BUNDLE], BUNDLE, [method, arg, extras]));
  def(CLIENT, 'call', `(${STRING}${STRING}${STRING}${BUNDLE})${BUNDLE}`, (r, _m, [self, authority, method, arg, extras]) => call(r, clientOf(r, self).provider, PROVIDER, 'call', [STRING, STRING, STRING, BUNDLE], BUNDLE, [authority, method, arg, extras]));
  def(CLIENT, 'openFile', `(${URI}${STRING})${PFD}`, (r, _m, [self, uri, mode]) => call(r, clientOf(r, self).provider, PROVIDER, 'openFile', [URI, STRING], PFD, [uri, mode]));
  def(CLIENT, 'openFile', `(${URI}${STRING}${SIGNAL})${PFD}`, (r, _m, [self, uri, mode, signal]) => call(r, clientOf(r, self).provider, PROVIDER, 'openFile', [URI, STRING, SIGNAL], PFD, [uri, mode, signal]));
  def(CLIENT, 'getLocalContentProvider', `()${PROVIDER}`, (r, _m, [self]) => clientOf(r, self).provider);
  def(CLIENT, 'release', '()Z', (r, _m, [self]) => { const c = r.object(self).client; if (!c || c.released) return 0; c.released = true; return 1; });
  def(CLIENT, 'close', '()V', (r, _m, [self]) => { const c = r.object(self).client; if (c) c.released = true; });
  def(CLIENT, 'openAssetFile', `(${URI}${STRING})${AFD}`, (r, _m, [self, uri, mode]) => call(r, clientOf(r, self).provider, PROVIDER, 'openAssetFile', [URI, STRING], AFD, [uri, mode]));
  def(CLIENT, 'openAssetFile', `(${URI}${STRING}${SIGNAL})${AFD}`, (r, _m, [self, uri, mode, signal]) => call(r, clientOf(r, self).provider, PROVIDER, 'openAssetFile', [URI, STRING, SIGNAL], AFD, [uri, mode, signal]));
  def(CLIENT, 'applyBatch', `(Ljava/util/ArrayList;)[Landroid/content/ContentProviderResult;`, () => unsupported('ContentProviderClient.applyBatch: ContentProviderOperation is not part of the lab framework', 'content-batch-unsupported'));
  return registry;
}
