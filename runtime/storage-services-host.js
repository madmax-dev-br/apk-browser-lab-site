import { floatBits } from './host-contract.js?v=d8da3b335496';
import { createServiceKit, OBJECT, STRING, LIST } from './service-kit.js?v=d8da3b335496';
import { networkOf } from './network-native.js?v=d8da3b335496';

// Storage-related system services over the app's virtual filesystem and the lab's network bridge (android-13.0.0_r1 StorageManager, StorageStatsManager, DownloadManager,
// NetworkStatsManager). The device has one 8 GiB volume (the numbers StatFs reports); downloads are real HTTP(S) exchanges made through the network bridge under the device's
// network policy, written into the virtual filesystem, and reported through the Downloads provider's cursor columns, status codes and ACTION_DOWNLOAD_COMPLETE.
const FILE = 'Ljava/io/File;', UUID = 'Ljava/util/UUID;', URI = 'Landroid/net/Uri;', INTENT = 'Landroid/content/Intent;', CURSOR = 'Landroid/database/Cursor;', CONTEXT_T = 'Landroid/content/Context;';
const BLOCK = 4096, TOTAL = 2097152 * BLOCK, FREE = 1468006 * BLOCK;   // src/java-io-host.js StatFs numbers
const UUID_DEFAULT = '41217664-9172-527a-b3d5-edabb50a7d69';

export function createStorageServicesHost(platform) {
  const kit = createServiceKit(platform), { def, type, service, call, callStatic, text, enforce, construct, listOf, emptyList, device, npe, iae, ise, nullish, registry } = kit;
  const fs = () => platform.javaIo.fs();
  const pkg = () => platform.packageName;
  const javaFile = (r, path) => construct(r, FILE, [STRING], [path]);
  const pathOf = (r, file) => text(r, call(r, file, FILE, 'getAbsolutePath', [], STRING));
  const underStorage = path => path === '/storage/emulated' || path.startsWith('/storage/emulated/') || path === '/sdcard' || path.startsWith('/sdcard/');

  // ---- StorageManager / StorageVolume
  const STORAGE = service('storage', 'Landroid/os/storage/StorageManager;'), VOLUME = 'Landroid/os/storage/StorageVolume;';
  type(VOLUME, OBJECT, [], { allocatable: true });
  const primaryVolume = r => { const cache = platform.primaryVolume ??= new WeakMap(); if (!cache.has(r)) { const v = r.allocate(VOLUME); r.object(v).volume = { path: '/storage/emulated/0' }; cache.set(r, v); } return cache.get(r); };
  registry.staticField(STORAGE, 'UUID_DEFAULT', UUID, r => callStatic(r, UUID, 'fromString', [STRING], UUID, [UUID_DEFAULT]));
  registry.staticField(STORAGE, 'UUID_PRIMARY_PHYSICAL', UUID, r => callStatic(r, UUID, 'fromString', [STRING], UUID, ['0f95a519-dae7-4abf-9c0c-5e5e3ab6c0d2']));
  def(STORAGE, 'getStorageVolumes', `()${LIST}`, r => listOf(r, [primaryVolume(r)]));
  def(STORAGE, 'getPrimaryStorageVolume', `()${VOLUME}`, r => primaryVolume(r));
  def(STORAGE, 'getRecentStorageVolumes', `()${LIST}`, r => listOf(r, [primaryVolume(r)]));
  def(STORAGE, 'getStorageVolume', `(${FILE})${VOLUME}`, (r, _m, [, file]) => { if (nullish(file)) npe(r); const p = fs().canonical(pathOf(r, file)); return underStorage(p) ? primaryVolume(r) : null; });
  def(STORAGE, 'getStorageVolume', `(${URI})${VOLUME}`, () => null);
  def(STORAGE, 'getUuidForPath', `(${FILE})${UUID}`, (r, _m, [, file]) => {
    if (nullish(file)) npe(r); const p = fs().canonical(pathOf(r, file));
    if (p === '/data' || p.startsWith('/data/') || underStorage(p)) return callStatic(r, UUID, 'fromString', [STRING], UUID, [UUID_DEFAULT]);
    r.throwJava('Ljava/io/FileNotFoundException;', `Failed to find a storage device for ${text(r, call(r, file, FILE, 'toString', [], STRING))}`);
  });
  def(STORAGE, 'getAllocatableBytes', `(${UUID})J`, (r, _m, [, uuid]) => { if (nullish(uuid)) npe(r); return BigInt(FREE); });
  def(STORAGE, 'allocateBytes', `(${UUID}J)V`, (r, _m, [, uuid, bytes]) => { if (nullish(uuid)) npe(r); if (bytes < 0n) iae(r, 'bytes must not be negative'); if (bytes > BigInt(FREE)) r.throwJava('Ljava/io/IOException;', `Failed to allocate ${bytes} bytes`); });
  def(STORAGE, 'getCacheQuotaBytes', `(${UUID})J`, (r, _m, [, uuid]) => { if (nullish(uuid)) npe(r); return BigInt(Math.floor(TOTAL * 0.1)); });
  def(STORAGE, 'getCacheSizeBytes', `(${UUID})J`, (r, _m, [, uuid]) => { if (nullish(uuid)) npe(r); return BigInt(cacheBytes()); });
  def(STORAGE, 'isCheckpointSupported', '()Z', () => 0);
  def(STORAGE, 'isAllocationSupported', '(Ljava/io/FileDescriptor;)Z', () => 0);
  def(STORAGE, 'isObbMounted', `(${STRING})Z`, (r, _m, [, path]) => { if (nullish(path)) npe(r, 'rawPath cannot be null'); return 0; });
  def(STORAGE, 'getMountedObbPath', `(${STRING})${STRING}`, (r, _m, [, path]) => { if (nullish(path)) npe(r, 'rawPath cannot be null'); return null; });
  def(STORAGE, 'unmountObb', `(${STRING}ZLandroid/os/storage/OnObbStateChangeListener;)Z`, (r, _m, [, path]) => { if (nullish(path)) npe(r, 'rawPath cannot be null'); return 0; });
  def(STORAGE, 'getProxyFileDescriptorMountPointId', '()I', () => 0);
  def(STORAGE, 'registerStorageVolumeCallback', '(Ljava/util/concurrent/Executor;Landroid/os/storage/StorageManager$StorageVolumeCallback;)V', (r, _m, [, executor, callback]) => { if (nullish(executor) || nullish(callback)) npe(r); });
  def(STORAGE, 'unregisterStorageVolumeCallback', '(Landroid/os/storage/StorageManager$StorageVolumeCallback;)V', (r, _m, [, callback]) => { if (nullish(callback)) npe(r); });
  const volume = (r, self) => r.object(self).volume ?? npe(r, 'StorageVolume used before construction');
  def(VOLUME, 'getState', `()${STRING}`, () => 'mounted');
  def(VOLUME, 'isPrimary', '()Z', () => 1); def(VOLUME, 'isEmulated', '()Z', () => 1); def(VOLUME, 'isRemovable', '()Z', () => 0);
  def(VOLUME, 'getUuid', `()${STRING}`, () => null);
  def(VOLUME, 'getMediaStoreVolumeName', `()${STRING}`, () => 'external_primary');
  def(VOLUME, 'getDirectory', `()${FILE}`, (r, _m, [self]) => javaFile(r, volume(r, self).path));
  def(VOLUME, 'getDescription', `(${CONTEXT_T})${STRING}`, () => 'Internal shared storage');
  def(VOLUME, 'toString', `()${STRING}`, () => 'StorageVolume: Internal shared storage (primary) mounted');
  const sizeUnder = prefix => { let total = 0; for (const [path, node] of fs().nodes) if ((path === prefix || path.startsWith(prefix + '/')) && node.type === 'file') total += node.size; return total; };
  const dataDir = () => `/data/user/0/${pkg()}`;
  const cacheBytes = () => sizeUnder(`${dataDir()}/cache`);

  // ---- StorageStatsManager: figures of the one volume and of this app's package (code = the installed APK, data = everything under the app's data directory, cache)
  const STORAGE_STATS_MANAGER = service('storagestats', 'Landroid/app/usage/StorageStatsManager;'), STORAGE_STATS = 'Landroid/app/usage/StorageStats;', USER_HANDLE = 'Landroid/os/UserHandle;';
  const checkVolume = (r, uuid) => { if (nullish(uuid)) npe(r, 'uuid'); };
  def(STORAGE_STATS_MANAGER, 'getTotalBytes', `(${UUID})J`, (r, _m, [, uuid]) => { checkVolume(r, uuid); return BigInt(TOTAL); });
  def(STORAGE_STATS_MANAGER, 'getTotalBytes', `(${STRING})J`, (r, _m, [, uuid]) => { checkVolume(r, uuid); return BigInt(TOTAL); });
  def(STORAGE_STATS_MANAGER, 'getFreeBytes', `(${UUID})J`, (r, _m, [, uuid]) => { checkVolume(r, uuid); return BigInt(FREE); });
  def(STORAGE_STATS_MANAGER, 'getFreeBytes', `(${STRING})J`, (r, _m, [, uuid]) => { checkVolume(r, uuid); return BigInt(FREE); });
  const ownStats = r => {
    const stats = construct(r, STORAGE_STATS), fields = r.object(stats).fields, put = (name, value) => r.storeField(fields, `${STORAGE_STATS}->${name}:J`, BigInt(value));
    put('codeBytes', platform.apkBytes?.length ?? 0); put('dataBytes', sizeUnder(dataDir())); put('cacheBytes', cacheBytes()); put('externalCacheBytes', sizeUnder(`/storage/emulated/0/Android/data/${pkg()}/cache`));
    return stats;
  };
  const NOT_OWN = r => r.throwJava('Ljava/lang/SecurityException;', `Neither user ${kit.uid()} nor current process has android.permission.PACKAGE_USAGE_STATS.`);
  def(STORAGE_STATS_MANAGER, 'queryStatsForPackage', `(${UUID}${STRING}${USER_HANDLE})${STORAGE_STATS}`, (r, _m, [, uuid, name]) => {
    checkVolume(r, uuid); if (nullish(name)) npe(r, 'packageName');
    if (text(r, name) !== pkg()) { enforce(r, 'android.permission.PACKAGE_USAGE_STATS'); r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', text(r, name)); }
    return ownStats(r);
  });
  def(STORAGE_STATS_MANAGER, 'queryStatsForUid', `(${UUID}I)${STORAGE_STATS}`, (r, _m, [, uuid, uid]) => { checkVolume(r, uuid); if (uid !== kit.uid()) NOT_OWN(r); return ownStats(r); });
  def(STORAGE_STATS_MANAGER, 'queryStatsForUser', `(${UUID}${USER_HANDLE})${STORAGE_STATS}`, r => NOT_OWN(r));
  def(STORAGE_STATS_MANAGER, 'queryExternalStatsForUser', `(${UUID}${USER_HANDLE})Landroid/app/usage/ExternalStorageStats;`, r => NOT_OWN(r));

  // ---- NetworkStatsManager: the usage-stats app op is never granted to an installed app
  const NETSTATS = service('netstats', 'Landroid/app/usage/NetworkStatsManager;');
  const deniedStats = r => r.throwJava('Ljava/lang/SecurityException;', `Package ${pkg()} does not have the PACKAGE_USAGE_STATS app op`);
  for (const signature of ['(ILjava/lang/String;JJ)Landroid/app/usage/NetworkStats$Bucket;', '(ILjava/lang/String;JJ)Landroid/app/usage/NetworkStats;', '(ILjava/lang/String;JJI)Landroid/app/usage/NetworkStats;', '(ILjava/lang/String;JJI)Landroid/app/usage/NetworkStats$Bucket;']) {
    for (const name of ['querySummaryForDevice', 'querySummaryForUser', 'querySummary', 'queryDetailsForUid', 'queryDetails']) def(NETSTATS, name, signature, r => deniedStats(r));
  }
  def(NETSTATS, 'registerUsageCallback', '(ILjava/lang/String;JLandroid/app/usage/NetworkStatsManager$UsageCallback;)V', r => deniedStats(r));
  def(NETSTATS, 'unregisterUsageCallback', '(Landroid/app/usage/NetworkStatsManager$UsageCallback;)V', (r, _m, [, callback]) => { if (nullish(callback)) npe(r); });

  // ---- DownloadManager
  const DOWNLOAD = service('download', 'Landroid/app/DownloadManager;'), REQUEST = 'Landroid/app/DownloadManager$Request;', QUERY = 'Landroid/app/DownloadManager$Query;';
  type(REQUEST, OBJECT, [], { allocatable: true }); type(QUERY, OBJECT, [], { allocatable: true });
  const STATUS = { PENDING: 1, RUNNING: 2, PAUSED: 4, SUCCESSFUL: 8, FAILED: 16 };
  const PAUSED_WAITING_FOR_NETWORK = 3, ERROR_HTTP_DATA_ERROR = 1004, ERROR_UNHANDLED_HTTP_CODE = 1002, ERROR_TOO_MANY_REDIRECTS = 1005, ERROR_FILE_ERROR = 1001, ERROR_FILE_ALREADY_EXISTS = 1009;
  const COLUMNS = ['_id', 'local_filename', 'title', 'description', 'uri', 'media_type', 'total_size', 'local_uri', 'reason', 'status', 'last_modified_timestamp', 'bytes_so_far', 'allow_write', 'media_provider_uri', 'mediaprovider_uri'];
  for (const [name, value] of Object.entries({ COLUMN_ID: '_id', COLUMN_TITLE: 'title', COLUMN_DESCRIPTION: 'description', COLUMN_URI: 'uri', COLUMN_MEDIA_TYPE: 'media_type', COLUMN_TOTAL_SIZE_BYTES: 'total_size', COLUMN_LOCAL_URI: 'local_uri', COLUMN_LOCAL_FILENAME: 'local_filename',
    COLUMN_STATUS: 'status', COLUMN_REASON: 'reason', COLUMN_BYTES_DOWNLOADED_SO_FAR: 'bytes_so_far', COLUMN_LAST_MODIFIED_TIMESTAMP: 'last_modified_timestamp', ACTION_DOWNLOAD_COMPLETE: 'android.intent.action.DOWNLOAD_COMPLETE',
    ACTION_NOTIFICATION_CLICKED: 'android.intent.action.DOWNLOAD_NOTIFICATION_CLICKED', ACTION_VIEW_DOWNLOADS: 'android.intent.action.VIEW_DOWNLOADS', EXTRA_DOWNLOAD_ID: 'extra_download_id', EXTRA_NOTIFICATION_CLICK_DOWNLOAD_IDS: 'extra_click_download_ids' })) registry.staticField(DOWNLOAD, name, STRING, () => value);
  const jobs = new Map(); let nextId = 1;
  kit.root(visit => { for (const job of jobs.values()) visit(job.context); });
  const uriText = (r, uri) => text(r, call(r, uri, URI, 'toString', [], STRING));
  const parseUri = (r, value) => callStatic(r, URI, 'parse', [STRING], URI, [value]);
  const request = (r, self) => r.object(self).download ?? npe(r, 'DownloadManager.Request used before construction');
  def(REQUEST, '<init>', `(${URI})V`, (r, _m, [self, uri]) => {
    if (nullish(uri)) iae(r, 'uri cannot be null');
    const scheme = call(r, uri, URI, 'getScheme', [], STRING), s = scheme === null ? null : text(r, scheme);
    if (s === null || !(s.toLowerCase() === 'http' || s.toLowerCase() === 'https')) iae(r, `Can only download HTTP/HTTPS URIs: ${uriText(r, uri)}`);
    r.object(self).download = { uri: uriText(r, uri), headers: [], title: null, description: null, mime: null, destination: null, notification: 0, visible: true, overMetered: true, overRoaming: true, networkTypes: ~0 };
  });
  def(REQUEST, 'setTitle', `(Ljava/lang/CharSequence;)${REQUEST}`, (r, _m, [self, title]) => { request(r, self).title = nullish(title) ? null : r.javaString(title); return self; });
  def(REQUEST, 'setDescription', `(Ljava/lang/CharSequence;)${REQUEST}`, (r, _m, [self, description]) => { request(r, self).description = nullish(description) ? null : r.javaString(description); return self; });
  def(REQUEST, 'setMimeType', `(${STRING})${REQUEST}`, (r, _m, [self, mime]) => { request(r, self).mime = nullish(mime) ? null : text(r, mime); return self; });
  def(REQUEST, 'addRequestHeader', `(${STRING}${STRING})${REQUEST}`, (r, _m, [self, header, value]) => {
    if (nullish(header)) npe(r, 'header cannot be null'); const h = text(r, header); if (h.includes(':')) iae(r, "header may not contain ':'");
    request(r, self).headers.push([h, nullish(value) ? '' : text(r, value)]); return self;
  });
  def(REQUEST, 'setDestinationUri', `(${URI})${REQUEST}`, (r, _m, [self, uri]) => {
    const scheme = call(r, uri, URI, 'getScheme', [], STRING);
    if (scheme === null || text(r, scheme) !== 'file') iae(r, `Not a file URI: ${uriText(r, uri)}`);
    request(r, self).destination = text(r, call(r, uri, URI, 'getPath', [], STRING)); return self;
  });
  def(REQUEST, 'setDestinationInExternalFilesDir', `(${CONTEXT_T}${STRING}${STRING})${REQUEST}`, (r, _m, [self, , dirType, subPath]) => {
    if (nullish(subPath)) iae(r, 'subPath cannot be null'); const dir = nullish(dirType) ? '' : `/${text(r, dirType)}`;
    request(r, self).destination = `/storage/emulated/0/Android/data/${pkg()}/files${dir}/${text(r, subPath).replace(/^\/+/, '')}`; return self;
  });
  def(REQUEST, 'setDestinationInExternalPublicDir', `(${STRING}${STRING})${REQUEST}`, (r, _m, [self, dirType, subPath]) => {
    if (nullish(dirType) || nullish(subPath)) iae(r, 'dirType and subPath cannot be null'); const dir = text(r, dirType), sub = text(r, subPath).replace(/^\/+/, '');
    if (dir.includes('/')) iae(r, `Invalid directory type: ${dir}`);
    request(r, self).destination = `/storage/emulated/0/${dir}/${sub}`; return self;
  });
  def(REQUEST, 'setNotificationVisibility', `(I)${REQUEST}`, (r, _m, [self, visibility]) => { request(r, self).notification = visibility; return self; });
  def(REQUEST, 'setAllowedNetworkTypes', `(I)${REQUEST}`, (r, _m, [self, types]) => { request(r, self).networkTypes = types; return self; });
  def(REQUEST, 'setAllowedOverRoaming', `(Z)${REQUEST}`, (r, _m, [self, allow]) => { request(r, self).overRoaming = allow === 1; return self; });
  def(REQUEST, 'setAllowedOverMetered', `(Z)${REQUEST}`, (r, _m, [self, allow]) => { request(r, self).overMetered = allow === 1; return self; });
  def(REQUEST, 'setVisibleInDownloadsUi', `(Z)${REQUEST}`, (r, _m, [self, visible]) => { request(r, self).visible = visible === 1; return self; });
  def(REQUEST, 'setRequiresCharging', `(Z)${REQUEST}`, (r, _m, [self]) => self); def(REQUEST, 'setRequiresDeviceIdle', `(Z)${REQUEST}`, (r, _m, [self]) => self);
  def(REQUEST, 'allowScanningByMediaScanner', `()V`, () => {});
  def(REQUEST, 'setShowRunningNotification', `(Z)${REQUEST}`, (r, _m, [self]) => self);

  const filenameFrom = (url, disposition) => {
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? ''); if (match) return decodeURIComponent(match[1]);
    const path = new URL(url).pathname.split('/').filter(Boolean).pop(); return path ? decodeURIComponent(path) : 'downloadfile';
  };
  const mimeFor = name => ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain', json: 'application/json', zip: 'application/zip', html: 'text/html', csv: 'text/csv', apk: 'application/vnd.android.package-archive' })[name.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
  const touch = (r, job) => { job.modified = Math.floor(r.clock.wall?.() ?? 0); };
  const complete = (r, job) => {
    const intent = construct(r, INTENT, [STRING], ['android.intent.action.DOWNLOAD_COMPLETE']);
    call(r, intent, INTENT, 'putExtra', [STRING, 'J'], INTENT, ['extra_download_id', BigInt(job.id)]);
    call(r, job.context, CONTEXT_T, 'sendBroadcast', [INTENT], 'V', [intent]);
  };
  const fail = (r, job, reason) => { job.status = STATUS.FAILED; job.reason = reason; touch(r, job); if (job.op) { networkOf(r).discard(job.op); job.op = null; } };
  const begin = (r, job, url, hops = 0) => {
    if (hops > 5) return fail(r, job, ERROR_TOO_MANY_REDIRECTS);
    const net = networkOf(r), target = new URL(url), port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
    if (!net.online) { job.status = STATUS.PAUSED; job.reason = PAUSED_WAITING_FOR_NETWORK; touch(r, job); return false; }
    if (!net.allowed(target.hostname, port)) { net.stats.denied++; return fail(r, job, ERROR_HTTP_DATA_ERROR); }
    job.status = STATUS.RUNNING; job.reason = 0; job.hops = hops;
    job.op = net.start({ method: 'GET', url, headers: job.request.headers.map(([n, v]) => [n, v]), body: null, redirect: 1, connectTimeout: 20000, readTimeout: 20000 });
    return true;
  };
  const step = (r, job) => {
    const net = networkOf(r);
    if (job.status === STATUS.PAUSED) { if (net.online) begin(r, job, job.url); }
    else if (job.status === STATUS.RUNNING) {
      const op = job.op; net.refresh(op);
      if (op.error) return fail(r, job, ERROR_HTTP_DATA_ERROR);
      if (op.head && !job.headed) {
        const status = op.head.status;
        if (status >= 300 && status < 400) {
          const location = op.head.headers.find(([name]) => name.toLowerCase() === 'location')?.[1]; net.discard(op); job.op = null;
          if (!location) return fail(r, job, ERROR_HTTP_DATA_ERROR);
          job.url = new URL(location, job.url).href; begin(r, job, job.url, (job.hops ?? 0) + 1); return;
        }
        if (status !== 200) return fail(r, job, status >= 400 ? status : ERROR_UNHANDLED_HTTP_CODE);
        const headers = new Map(op.head.headers.map(([name, value]) => [name.toLowerCase(), value]));
        job.total = headers.has('content-length') ? Number(headers.get('content-length')) : -1;
        job.name = job.request.destination?.split('/').pop() ?? filenameFrom(job.url, headers.get('content-disposition'));
        job.mime = job.request.mime ?? headers.get('content-type')?.split(';')[0].trim() ?? mimeFor(job.name);
        job.path = job.request.destination ?? `/storage/emulated/0/Download/${job.name}`;
        const parent = job.path.slice(0, job.path.lastIndexOf('/'));
        if (fs().nodes.has(fs().canonical(job.path)) && !job.request.destination) { const dot = job.name.lastIndexOf('.'); let n = 1, candidate; do { candidate = `${dot > 0 ? job.name.slice(0, dot) : job.name}-${n++}${dot > 0 ? job.name.slice(dot) : ''}`; } while (fs().nodes.has(fs().canonical(`${parent}/${candidate}`))); job.path = `${parent}/${candidate}`; }
        else if (fs().nodes.has(fs().canonical(job.path))) return fail(r, job, ERROR_FILE_ALREADY_EXISTS);
        const made = fs().mkdirs(parent); if (made !== 'ok' && made !== 'EEXIST') return fail(r, job, ERROR_FILE_ERROR);
        const node = fs().open(job.path, { create: true, truncate: true, write: true }); if (typeof node === 'string') return fail(r, job, ERROR_FILE_ERROR);
        job.node = node; job.headed = true; job.written = 0; touch(r, job);
      }
      if (job.headed) {
        const chunk = new Int8Array(65536);
        for (;;) {
          const n = net.take(op, chunk, 0, chunk.length); if (!n) break;
          fs().writeAt(job.node, job.written, new Uint8Array(chunk.buffer, 0, n), 0, n); job.written += n; touch(r, job);
        }
        if (op.ended && !op.queue.length) { net.discard(op); job.op = null; job.status = STATUS.SUCCESSFUL; job.total = job.written; touch(r, job); complete(r, job); }
      }
    }
  };
  const pump = (r, job) => {
    if (job.status === STATUS.SUCCESSFUL || job.status === STATUS.FAILED) return;
    step(r, job);
    if (job.status !== STATUS.SUCCESSFUL && job.status !== STATUS.FAILED) platform.queueTask(() => pump(r, job), 20, [job.context]);
  };
  def(DOWNLOAD, 'enqueue', `(${REQUEST})J`, (r, _m, [, req]) => {
    if (nullish(req)) npe(r, 'request'); enforce(r, 'android.permission.INTERNET');
    const data = request(r, req), job = { id: nextId++, request: data, url: data.uri, status: STATUS.PENDING, reason: 0, total: -1, written: 0, path: null, mime: data.mime, name: null, modified: 0, context: platform.application ?? r.activity };
    jobs.set(job.id, job); touch(r, job);
    if (begin(r, job, job.url) !== false || job.status === STATUS.PAUSED) pump(r, job);
    return BigInt(job.id);
  });
  def(QUERY, '<init>', '()V', (r, _m, [self]) => { r.object(self).query = { ids: null, status: null, orderBy: '_id', ascending: false }; });
  const query = (r, self) => r.object(self).query ?? npe(r, 'DownloadManager.Query used before construction');
  def(QUERY, 'setFilterById', `([J)${QUERY}`, (r, _m, [self, ids]) => { query(r, self).ids = ids === null ? null : r.array(ids).elements.map(v => Number(v)); return self; });
  def(QUERY, 'setFilterByStatus', `(I)${QUERY}`, (r, _m, [self, status]) => { query(r, self).status = status; return self; });
  def(QUERY, 'orderBy', `(${STRING}I)${QUERY}`, (r, _m, [self, column, direction]) => {
    if (direction !== 1 && direction !== 2) iae(r, `Invalid direction: ${direction}`); const c = text(r, column);
    if (c !== 'last_modified_timestamp' && c !== 'total_size') iae(r, `Cannot order by ${c}`);
    Object.assign(query(r, self), { orderBy: c, ascending: direction === 1 }); return self;
  });
  const boxed = (r, kind, value) => r.boxPrimitive(kind, kind === 'J' ? BigInt(value) : value);
  def(DOWNLOAD, 'query', `(${QUERY})${CURSOR}`, (r, _m, [, q]) => {
    if (nullish(q)) npe(r, 'query');
    for (const job of jobs.values()) pump(r, job);
    const filter = query(r, q), wanted = [...jobs.values()].filter(job => (filter.ids === null || filter.ids.includes(job.id)) && (filter.status === null || (filter.status & job.status) !== 0));
    wanted.sort((a, b) => filter.orderBy === '_id' ? b.id - a.id : ((filter.orderBy === 'total_size' ? a.total - b.total : a.modified - b.modified) * (filter.ascending ? 1 : -1)));
    const cursor = construct(r, 'Landroid/database/MatrixCursor;', ['[Ljava/lang/String;'], [kit.stringArray(r, COLUMNS)]);
    for (const job of wanted) {
      const local = job.status === STATUS.SUCCESSFUL ? `file://${job.path}` : null;
      const values = [boxed(r, 'J', job.id), job.status === STATUS.SUCCESSFUL ? job.path : null, job.request.title, job.request.description, job.url, job.mime, boxed(r, 'J', job.total), local, boxed(r, 'I', job.reason), boxed(r, 'I', job.status), boxed(r, 'J', job.modified), boxed(r, 'J', job.written), boxed(r, 'I', job.status === STATUS.SUCCESSFUL ? 1 : 0), null, null];
      const row = r.newArray('[Ljava/lang/Object;', values.length); r.array(row).elements = values.map(v => (typeof v === 'string' ? v : v));
      call(r, cursor, 'Landroid/database/MatrixCursor;', 'addRow', ['[Ljava/lang/Object;'], 'V', [row]);
    }
    return cursor;
  });
  def(DOWNLOAD, 'remove', '([J)I', (r, _m, [, ids]) => {
    if (nullish(ids) || r.array(ids).elements.length === 0) iae(r, 'input param \'ids\' can\'t be null');
    let removed = 0;
    for (const raw of r.array(ids).elements) {
      const job = jobs.get(Number(raw)); if (!job) continue;
      if (job.op) { networkOf(r).discard(job.op); job.op = null; }
      if (job.path) fs().delete(job.path);
      jobs.delete(job.id); removed++;
    }
    return removed;
  });
  const jobFor = (r, id) => { for (const job of jobs.values()) pump(r, job); return jobs.get(Number(id)); };
  def(DOWNLOAD, 'getUriForDownloadedFile', `(J)${URI}`, (r, _m, [, id]) => { const job = jobFor(r, id); return job?.status === STATUS.SUCCESSFUL ? parseUri(r, `content://downloads/all_downloads/${job.id}`) : null; });
  def(DOWNLOAD, 'getMimeTypeForDownloadedFile', `(J)${STRING}`, (r, _m, [, id]) => { const job = jobFor(r, id); return job?.status === STATUS.SUCCESSFUL ? job.mime : null; });
  def(DOWNLOAD, 'openDownloadedFile', '(J)Landroid/os/ParcelFileDescriptor;', (r, _m, [, id]) => { const job = jobFor(r, id); if (!job) r.throwJava('Ljava/io/FileNotFoundException;', `No file found for download ${id}`); r.throwJava('Ljava/lang/UnsupportedOperationException;', 'ParcelFileDescriptor over the Downloads provider is not available in the browser VM'); });
  def(DOWNLOAD, 'getMaxBytesOverMobile', `(${CONTEXT_T})Ljava/lang/Long;`, () => null, { static: true });
  def(DOWNLOAD, 'getRecommendedMaxBytesOverMobile', `(${CONTEXT_T})Ljava/lang/Long;`, () => null, { static: true });
  void emptyList; void device; void ise; void floatBits;
  return kit.finish({ downloads: jobs });
}
