import { floatBits } from './host-contract.js?v=230d3f53d504';
import { gcRoot } from './heap-gc.js?v=230d3f53d504';
import { createServiceKit, OBJECT, STRING, LIST } from './service-kit.js?v=230d3f53d504';
import { createAccountStore } from './account-store.js?v=230d3f53d504';

// Software system services of an API 33 phone with no SIM, no accounts, no device admin, no role holders and no usage access (android-13.0.0_r1 sources of each manager and
// of the system service behind it): AppOpsManager, UsageStatsManager, CaptioningManager, TextClassificationManager, RoleManager, DevicePolicyManager, SubscriptionManager,
// CarrierConfigManager, MediaSessionManager, LauncherApps, WallpaperManager, SearchManager, PrintManager, AccountManager, SystemHealthManager, StatusBarManager,
// MediaProjectionManager, LocaleManager, GameManager, RestrictionsManager, DropBoxManager, TextServicesManager, BlobStoreManager, BugreportManager.
// The caller is an ordinary installed app (uid platform.virtualProcess.uid): whatever the services reserve for the system, the platform signature or a privileged holder is
// refused with the SecurityException the service throws, and permission checks go through the same manifest and grant tables PackageManager.checkPermission uses.
const CONTEXT_T = 'Landroid/content/Context;', INTENT = 'Landroid/content/Intent;', COMPONENT = 'Landroid/content/ComponentName;', BUNDLE = 'Landroid/os/Bundle;', PBUNDLE = 'Landroid/os/PersistableBundle;';
const USER_HANDLE = 'Landroid/os/UserHandle;', ACCOUNT = 'Landroid/accounts/Account;', LOCALE_LIST = 'Landroid/os/LocaleList;', CHAR_SEQUENCE = 'Ljava/lang/CharSequence;', HANDLER = 'Landroid/os/Handler;', MAP = 'Ljava/util/Map;';

export function createSystemManagersHost(platform) {
  const kit = createServiceKit(platform), { def, type, service, call, callStatic, text, uid, holds, enforce, construct, emptyList, listOf, array, npe, iae, ise, nullish, registry } = kit;
  const pkg = () => platform.packageName;
  const consts = (owner, values, kind = 'I') => { for (const [name, value] of Object.entries(values)) registry.staticField(owner, name, kind, () => value); };
  const strings = (owner, values) => consts(owner, values, STRING);
  const denied = (r, what) => r.throwJava('Ljava/lang/SecurityException;', what);
  const requireText = (r, value, message) => { if (nullish(value)) npe(r, message); return text(r, value); };
  const empty = (r, name) => { if (!r.classes?.has?.(name)) return r.makeObject(name); return r.allocate(name); };
  const NULL_SERVICES = ['credential', 'wifiaware', 'wifirtt'];   // wifiaware / wifirtt: the device has no such radio features
  service('credential', 'Landroid/credentials/CredentialManager;');   // API 34 service; on this API 33 device Context.getSystemService answers null, like a phone without a credential provider

  // ---- AppOpsManager
  const APPOPS = service('appops', 'Landroid/app/AppOpsManager;');
  const ALLOWED = 0, IGNORED = 1, ERRORED = 2, DEFAULT = 3, FOREGROUND = 4;
  consts(APPOPS, { MODE_ALLOWED: ALLOWED, MODE_IGNORED: IGNORED, MODE_ERRORED: ERRORED, MODE_DEFAULT: DEFAULT, MODE_FOREGROUND: FOREGROUND });
  // op string -> [permission, class]: 'runtime' ops follow the permission grant, 'special' ops are set by the user in Settings (MODE_DEFAULT until then), 'always' ops are always allowed
  const OPS = new Map(Object.entries({
    'android:coarse_location': ['android.permission.ACCESS_COARSE_LOCATION', 'runtime'], 'android:fine_location': ['android.permission.ACCESS_FINE_LOCATION', 'runtime'], 'android:camera': ['android.permission.CAMERA', 'runtime'],
    'android:record_audio': ['android.permission.RECORD_AUDIO', 'runtime'], 'android:read_contacts': ['android.permission.READ_CONTACTS', 'runtime'], 'android:write_contacts': ['android.permission.WRITE_CONTACTS', 'runtime'],
    'android:read_calendar': ['android.permission.READ_CALENDAR', 'runtime'], 'android:write_calendar': ['android.permission.WRITE_CALENDAR', 'runtime'], 'android:call_phone': ['android.permission.CALL_PHONE', 'runtime'],
    'android:read_phone_state': ['android.permission.READ_PHONE_STATE', 'runtime'], 'android:read_external_storage': ['android.permission.READ_EXTERNAL_STORAGE', 'runtime'], 'android:write_external_storage': ['android.permission.WRITE_EXTERNAL_STORAGE', 'runtime'],
    'android:post_notification': ['android.permission.POST_NOTIFICATIONS', 'runtime'], 'android:body_sensors': ['android.permission.BODY_SENSORS', 'runtime'], 'android:send_sms': ['android.permission.SEND_SMS', 'runtime'],
    'android:read_sms': ['android.permission.READ_SMS', 'runtime'], 'android:receive_sms': ['android.permission.RECEIVE_SMS', 'runtime'], 'android:activity_recognition': ['android.permission.ACTIVITY_RECOGNITION', 'runtime'],
    'android:get_accounts': ['android.permission.GET_ACCOUNTS', 'runtime'], 'android:bluetooth_connect': ['android.permission.BLUETOOTH_CONNECT', 'runtime'], 'android:bluetooth_scan': ['android.permission.BLUETOOTH_SCAN', 'runtime'],
    'android:bluetooth_advertise': ['android.permission.BLUETOOTH_ADVERTISE', 'runtime'], 'android:nearby_wifi_devices': ['android.permission.NEARBY_WIFI_DEVICES', 'runtime'], 'android:read_media_images': ['android.permission.READ_MEDIA_IMAGES', 'runtime'],
    'android:read_media_video': ['android.permission.READ_MEDIA_VIDEO', 'runtime'], 'android:read_media_audio': ['android.permission.READ_MEDIA_AUDIO', 'runtime'], 'android:use_biometric': ['android.permission.USE_BIOMETRIC', 'always'],
    'android:use_fingerprint': ['android.permission.USE_FINGERPRINT', 'always'], 'android:vibrate': ['android.permission.VIBRATE', 'always'], 'android:wake_lock': ['android.permission.WAKE_LOCK', 'always'],
    'android:get_usage_stats': ['android.permission.PACKAGE_USAGE_STATS', 'special'], 'android:system_alert_window': ['android.permission.SYSTEM_ALERT_WINDOW', 'special'], 'android:write_settings': ['android.permission.WRITE_SETTINGS', 'special'],
    'android:request_install_packages': ['android.permission.REQUEST_INSTALL_PACKAGES', 'special'], 'android:manage_external_storage': ['android.permission.MANAGE_EXTERNAL_STORAGE', 'special'], 'android:schedule_exact_alarm': ['android.permission.SCHEDULE_EXACT_ALARM', 'special'],
    'android:turn_screen_on': [null, 'special'], 'android:run_in_background': [null, 'always'], 'android:run_any_in_background': [null, 'always'], 'android:access_notifications': [null, 'special'],
    // location monitoring ops: no permission of their own, MODE_ALLOWED by default (AppOpsManager sOpDefaultMode); location providers start them for their clients
    'android:monitor_location': [null, 'always'], 'android:monitor_location_high_power': [null, 'always'],
  }));
  for (const [opString] of OPS) registry.staticField(APPOPS, `OPSTR_${opString.slice(8).toUpperCase()}`, STRING, () => opString);
  const opOf = (r, op) => { const name = requireText(r, op, 'op'); if (!OPS.has(name)) iae(r, `Unknown operation string: ${name}`); return name; };
  // With a companion package installed (src/package-registry.js) the ops are AppOpsService's for every installed package: the uid/package pair must match one package, the mode follows
  // THAT package's grants, and noting or starting an op for another uid (verifyIncomingUid) needs UPDATE_APP_OPS_STATS, which an installed app never holds: a service working for a
  // client (a location provider) uses the proxy variants, whose mode is the proxied package's and the proxy's. Without a companion, the app's own uid/package is the only valid pair.
  const P = () => platform.packages?.multi ? platform.packages : null;
  const callerOf = r => P()?.callerEntry(r) ?? null;
  const holdsFor = (r, entry, permission) => !entry || entry.main ? holds(r, permission) : P().holds(r, entry, permission);
  const checkPackage = (r, uidValue, packageName) => {
    const name = requireText(r, packageName, 'packageName');
    if (!P()) { if (uidValue !== uid() || name !== pkg()) denied(r, `Package ${name} does not belong to ${uidValue}`); return null; }
    const entry = P().byName(name); if (!entry || entry.uid !== uidValue) denied(r, `Package ${name} does not belong to ${uidValue}`);
    return entry;
  };
  const verifyIncomingUid = (r, uidValue) => { const caller = callerOf(r); if (!caller || caller.uid === uidValue) return; if (!holdsFor(r, caller, 'android.permission.UPDATE_APP_OPS_STATS')) denied(r, `uid ${caller.uid} does not have android.permission.UPDATE_APP_OPS_STATS.`); };
  const modeOf = (r, opString, entry = null) => { const [permission, kind] = OPS.get(opString); return kind === 'always' ? ALLOWED : kind === 'special' ? DEFAULT : (permission && holdsFor(r, entry, permission)) ? ALLOWED : IGNORED; };
  const mustBeAllowed = (r, mode, opString, uidValue = uid()) => { if (mode === ERRORED) denied(r, `uid ${uidValue} does not have ${opString}.`); return mode; };
  /** The mode of a proxy op: the proxied package's, unless the proxy itself (the calling package) is not allowed either. */
  const proxyMode = (r, opString, proxied) => { const mode = modeOf(r, opString, proxied), proxy = callerOf(r); return mode === ALLOWED && proxy && proxy !== proxied ? modeOf(r, opString, proxy) : mode; };
  for (const name of ['unsafeCheckOp', 'unsafeCheckOpRaw', 'unsafeCheckOpNoThrow', 'unsafeCheckOpRawNoThrow']) def(APPOPS, name, `(${STRING}I${STRING})I`, (r, _m, [, op, id, packageName]) => { const o = opOf(r, op); return modeOf(r, o, checkPackage(r, id, packageName)); });
  for (const name of ['checkOp', 'checkOpNoThrow']) def(APPOPS, name, `(${STRING}I${STRING})I`, (r, _m, [, op, id, packageName]) => { const o = opOf(r, op), mode = modeOf(r, o, checkPackage(r, id, packageName)); return name === 'checkOp' ? mustBeAllowed(r, mode, o, id) : mode; });
  const note = (r, name, op, id, packageName) => { const o = opOf(r, op); verifyIncomingUid(r, id); const mode = modeOf(r, o, checkPackage(r, id, packageName)); return name === 'noteOp' ? mustBeAllowed(r, mode, o, id) : mode; };
  for (const name of ['noteOp', 'noteOpNoThrow']) {
    def(APPOPS, name, `(${STRING}I${STRING})I`, (r, _m, [, op, id, packageName]) => note(r, name, op, id, packageName));
    def(APPOPS, name, `(${STRING}I${STRING}${STRING}${STRING})I`, (r, _m, [, op, id, packageName]) => note(r, name, op, id, packageName));
  }
  const noteProxy = (r, name, op, proxiedPackage, proxiedUid) => { const o = opOf(r, op), mode = proxyMode(r, o, checkPackage(r, proxiedUid, proxiedPackage)); return name === 'noteProxyOp' ? mustBeAllowed(r, mode, o, proxiedUid) : mode; };
  for (const name of ['noteProxyOp', 'noteProxyOpNoThrow']) {
    def(APPOPS, name, `(${STRING}${STRING}I${STRING}${STRING})I`, (r, _m, [, op, proxiedPackage, proxiedUid]) => noteProxy(r, name, op, proxiedPackage, proxiedUid));
    def(APPOPS, name, `(${STRING}${STRING}I)I`, (r, _m, [, op, proxiedPackage, proxiedUid]) => noteProxy(r, name, op, proxiedPackage, proxiedUid));   // API 29
    // API 23: the proxied app is the caller of the Binder transaction being served (Binder.getCallingUid)
    def(APPOPS, name, `(${STRING}${STRING})I`, (r, _m, [, op, proxiedPackage]) => noteProxy(r, name, op, proxiedPackage, P() ? P().callingIdentity(r).uid : uid()));
  }
  // Active operations (startOp ... finishOp, counted per uid and op) and the watchers of their changes: AppOpsService notifies a watcher of its own uid (the app's) through the watcher's executor.
  const activeCounts = new Map(), activeWatchers = gcRoot([]);
  const ACTIVE_LISTENER = 'Landroid/app/AppOpsManager$OnOpActiveChangedListener;', DELIVERY = 'Landroid/app/AppOpsManager$ActiveChangedDelivery;';
  type(DELIVERY, OBJECT, ['Ljava/lang/Runnable;'], { allocatable: true });
  def(DELIVERY, 'run', '()V', (r, _m, [self]) => {
    const f = r.object(self).fields, get = name => f.get(`${DELIVERY}->${name}`);
    call(r, get('listener'), ACTIVE_LISTENER, 'onOpActiveChanged', [STRING, 'I', STRING, 'Z'], 'V', [get('op'), uid(), pkg(), get('active')]);
  });
  const activeKey = (uidValue, opString) => `${uidValue}:${opString}`;
  const setActive = (r, opString, active, uidValue = uid()) => {
    const key = activeKey(uidValue, opString), before = activeCounts.get(key) ?? 0, after = Math.max(0, before + (active ? 1 : -1)); activeCounts.set(key, after);
    if ((before > 0) === (after > 0) || uidValue !== uid()) return;   // only the transitions inactive <-> active of the app's own uid reach its watchers
    for (const watcher of [...activeWatchers]) {
      if (!watcher.ops.includes(opString)) continue;
      const delivery = r.allocate(DELIVERY), fields = r.object(delivery).fields;
      r.storeField(fields, `${DELIVERY}->listener`, watcher.listener); r.storeField(fields, `${DELIVERY}->op`, opString); r.storeField(fields, `${DELIVERY}->active`, after > 0 ? 1 : 0);
      call(r, watcher.executor, 'Ljava/util/concurrent/Executor;', 'execute', ['Ljava/lang/Runnable;'], 'V', [delivery]);
    }
  };
  const start = (r, name, op, id, packageName) => {
    const o = opOf(r, op); verifyIncomingUid(r, id);
    const entry = checkPackage(r, id, packageName), mode = name === 'startOp' ? mustBeAllowed(r, modeOf(r, o, entry), o, id) : modeOf(r, o, entry);
    if (mode === ALLOWED) setActive(r, o, true, id); return mode;
  };
  for (const name of ['startOp', 'startOpNoThrow']) {
    def(APPOPS, name, `(${STRING}I${STRING}${STRING}${STRING})I`, (r, _m, [, op, id, packageName]) => start(r, name, op, id, packageName));
    def(APPOPS, name, `(${STRING}I${STRING})I`, (r, _m, [, op, id, packageName]) => start(r, name, op, id, packageName));
  }
  // API 31 proxy ops: started and finished for the proxied package by the calling package (a service working for its client)
  for (const name of ['startProxyOp', 'startProxyOpNoThrow']) def(APPOPS, name, `(${STRING}I${STRING}${STRING}${STRING})I`, (r, _m, [, op, proxiedUid, proxiedPackage]) => {
    const o = opOf(r, op), mode = proxyMode(r, o, checkPackage(r, proxiedUid, proxiedPackage)); if (name === 'startProxyOp') mustBeAllowed(r, mode, o, proxiedUid);
    if (mode === ALLOWED) setActive(r, o, true, proxiedUid); return mode;
  });
  const finish = (r, op, id, packageName) => { const o = opOf(r, op); checkPackage(r, id, packageName); if ((activeCounts.get(activeKey(id, o)) ?? 0) > 0) setActive(r, o, false, id); };
  def(APPOPS, 'finishOp', `(${STRING}I${STRING}${STRING})V`, (r, _m, [, op, id, packageName]) => { verifyIncomingUid(r, id); finish(r, op, id, packageName); });
  def(APPOPS, 'finishOp', `(${STRING}I${STRING})V`, (r, _m, [, op, id, packageName]) => { verifyIncomingUid(r, id); finish(r, op, id, packageName); });
  def(APPOPS, 'finishProxyOp', `(${STRING}I${STRING}${STRING})V`, (r, _m, [, op, proxiedUid, proxiedPackage]) => finish(r, op, proxiedUid, proxiedPackage));
  // startWatchingActive(String[] ops, Executor, OnOpActiveChangedListener) (API 29): an app without WATCH_APPOPS watches its own uid only; null arguments and unknown ops fail as AppOpsManager does.
  def(APPOPS, 'startWatchingActive', `([${STRING}Ljava/util/concurrent/Executor;${ACTIVE_LISTENER})V`, (r, _m, [, ops, executor, listener]) => {
    if (nullish(ops)) npe(r); if (nullish(executor)) npe(r); if (nullish(listener)) npe(r);
    const names = r.array(ops).elements.map(op => opOf(r, op)), existing = activeWatchers.findIndex(w => r.object(w.listener).id === r.object(listener).id);
    if (existing >= 0) activeWatchers.splice(existing, 1);
    activeWatchers.push({ ops: names, executor, listener });
  });
  def(APPOPS, 'stopWatchingActive', `(${ACTIVE_LISTENER})V`, (r, _m, [, listener]) => { if (nullish(listener)) npe(r); const at = activeWatchers.findIndex(w => r.object(w.listener).id === r.object(listener).id); if (at >= 0) activeWatchers.splice(at, 1); });
  def(APPOPS, 'checkPackage', `(I${STRING})V`, (r, _m, [, id, packageName]) => { checkPackage(r, id, packageName); });
  def(APPOPS, 'permissionToOp', `(${STRING})${STRING}`, (r, _m, [permission]) => { const name = requireText(r, permission, 'permission'); for (const [op, [p]] of OPS) if (p === name) return op; return null; }, { static: true });
  def(APPOPS, 'isOpActive', `(${STRING}I${STRING})Z`, (r, _m, [, op, id]) => (activeCounts.get(activeKey(id, opOf(r, op))) ?? 0) > 0 ? 1 : 0);
  def(APPOPS, 'isOperationActive', `(${STRING}I${STRING})Z`, (r, _m, [, op, id]) => (activeCounts.get(activeKey(id, opOf(r, op))) ?? 0) > 0 ? 1 : 0);
  def(APPOPS, 'startWatchingMode', `(${STRING}${STRING}Landroid/app/AppOpsManager$OnOpChangedListener;)V`, (r, _m, [, op, packageName, listener]) => { opOf(r, op); if (nullish(listener)) npe(r, 'callback'); void packageName; });
  def(APPOPS, 'startWatchingMode', `(${STRING}${STRING}ILandroid/app/AppOpsManager$OnOpChangedListener;)V`, (r, _m, [, op, packageName, , listener]) => { opOf(r, op); if (nullish(listener)) npe(r, 'callback'); void packageName; });
  def(APPOPS, 'stopWatchingMode', '(Landroid/app/AppOpsManager$OnOpChangedListener;)V', (r, _m, [, listener]) => { if (nullish(listener)) npe(r, 'callback'); });
  for (const name of ['setMode', 'setUidMode']) def(APPOPS, name, `(${STRING}I${STRING}I)V`, (r, _m, [, op]) => { opOf(r, op); enforce(r, 'android.permission.MANAGE_APP_OPS_MODES'); });
  def(APPOPS, 'getPackagesForOps', `([${STRING})${LIST}`, r => enforce(r, 'android.permission.GET_APP_OPS_STATS'));

  // ---- UsageStatsManager: the PACKAGE_USAGE_STATS app op is MODE_DEFAULT, so the service answers with no data
  const USAGE = service('usagestats', 'Landroid/app/usage/UsageStatsManager;'), EVENTS = 'Landroid/app/usage/UsageEvents;', EVENT = 'Landroid/app/usage/UsageEvents$Event;';
  consts(USAGE, { INTERVAL_DAILY: 0, INTERVAL_WEEKLY: 1, INTERVAL_MONTHLY: 2, INTERVAL_YEARLY: 3, INTERVAL_BEST: 4, STANDBY_BUCKET_EXEMPTED: 5, STANDBY_BUCKET_ACTIVE: 10, STANDBY_BUCKET_WORKING_SET: 20, STANDBY_BUCKET_FREQUENT: 30, STANDBY_BUCKET_RARE: 40, STANDBY_BUCKET_RESTRICTED: 45, REASON_MAIN_MASK: 65280 });
  type(EVENTS, OBJECT, [], { allocatable: true }); type(EVENT, OBJECT, [], { allocatable: true });
  def(EVENTS, 'hasNextEvent', '()Z', () => 0);
  def(EVENTS, 'getNextEvent', `(${EVENT})Z`, (r, _m, [, event]) => { if (nullish(event)) npe(r); return 0; });
  def(EVENTS, 'resetToStart', '()V', () => {});
  const usageEvents = r => r.allocate(EVENTS);
  def(USAGE, 'queryUsageStats', '(IJJ)Ljava/util/List;', r => emptyList(r));
  def(USAGE, 'queryConfigurations', '(IJJ)Ljava/util/List;', r => emptyList(r));
  def(USAGE, 'queryEventStats', '(IJJ)Ljava/util/List;', r => emptyList(r));
  def(USAGE, 'queryAndAggregateUsageStats', `(JJ)${MAP}`, r => construct(r, 'Ljava/util/HashMap;'));
  def(USAGE, 'queryEvents', `(JJ)${EVENTS}`, r => usageEvents(r));
  def(USAGE, 'queryEventsForSelf', `(JJ)${EVENTS}`, r => usageEvents(r));
  def(USAGE, 'getAppStandbyBucket', '()I', () => 10);
  def(USAGE, 'isAppInactive', `(${STRING})Z`, (r, _m, [, name]) => { requireText(r, name, 'packageName'); return 0; });
  def(USAGE, 'registerAppUsageObserver', '(I[Ljava/lang/String;JLjava/util/concurrent/TimeUnit;Landroid/app/PendingIntent;)V', r => enforce(r, 'android.permission.PACKAGE_USAGE_STATS'));

  // ---- CaptioningManager: captions off, the default caption style
  const CAPTIONING = service('captioning', 'Landroid/view/accessibility/CaptioningManager;'), CAPTION_STYLE = 'Landroid/view/accessibility/CaptioningManager$CaptionStyle;';
  const CAPTION_LISTENER = 'Landroid/view/accessibility/CaptioningManager$CaptioningChangeListener;';
  type(CAPTION_STYLE, OBJECT, [], { allocatable: true });
  const STYLE_FIELDS = { foregroundColor: -1, backgroundColor: -16777216, edgeType: 0, edgeColor: -16777216, windowColor: 0x00FFFFFF };
  for (const name of Object.keys(STYLE_FIELDS)) registry.instanceField(CAPTION_STYLE, name, 'I');
  const captionStyle = r => { const style = r.allocate(CAPTION_STYLE); for (const [name, value] of Object.entries(STYLE_FIELDS)) r.storeField(r.object(style).fields, `${CAPTION_STYLE}->${name}:I`, value); return style; };
  consts(CAPTION_STYLE, { EDGE_TYPE_NONE: 0, EDGE_TYPE_OUTLINE: 1, EDGE_TYPE_DROP_SHADOW: 2, EDGE_TYPE_RAISED: 3, EDGE_TYPE_DEPRESSED: 4, COLOR_UNSPECIFIED: 0x00FFFFFE, COLOR_NONE_OPAQUE: 0x00FFFFFF });
  registry.staticField(CAPTION_STYLE, 'DEFAULT', CAPTION_STYLE, r => captionStyle(r));
  def(CAPTION_STYLE, 'hasBackgroundColor', '()Z', (r, _m, [self]) => (r.object(self).fields.get(`${CAPTION_STYLE}->backgroundColor:I`) !== 0x00FFFFFE ? 1 : 0));
  def(CAPTION_STYLE, 'hasForegroundColor', '()Z', (r, _m, [self]) => (r.object(self).fields.get(`${CAPTION_STYLE}->foregroundColor:I`) !== 0x00FFFFFE ? 1 : 0));
  def(CAPTION_STYLE, 'hasEdgeType', '()Z', (r, _m, [self]) => (r.object(self).fields.get(`${CAPTION_STYLE}->edgeType:I`) !== 0x00FFFFFE ? 1 : 0));
  def(CAPTION_STYLE, 'hasEdgeColor', '()Z', (r, _m, [self]) => (r.object(self).fields.get(`${CAPTION_STYLE}->edgeColor:I`) !== 0x00FFFFFE ? 1 : 0));
  def(CAPTION_STYLE, 'hasWindowColor', '()Z', (r, _m, [self]) => (r.object(self).fields.get(`${CAPTION_STYLE}->windowColor:I`) !== 0x00FFFFFE ? 1 : 0));
  def(CAPTION_STYLE, 'getTypeface', '()Landroid/graphics/Typeface;', () => null);
  def(CAPTION_STYLE, 'getCustomStyle', `(Landroid/content/ContentResolver;)${CAPTION_STYLE}`, r => captionStyle(r), { static: true });
  def(CAPTIONING, 'isEnabled', '()Z', () => 0);
  def(CAPTIONING, 'getFontScale', '()F', () => floatBits(1));
  def(CAPTIONING, 'getLocale', '()Ljava/util/Locale;', () => null);
  def(CAPTIONING, 'getUserStyle', `()${CAPTION_STYLE}`, r => captionStyle(r));
  def(CAPTIONING, 'isSystemAudioCaptioningEnabled', '()Z', () => 0);
  def(CAPTIONING, 'isSystemAudioCaptioningUiEnabled', '()Z', () => 0);
  def(CAPTIONING, 'addCaptioningChangeListener', `(${CAPTION_LISTENER})V`, (r, _m, [, listener]) => { if (nullish(listener)) npe(r); });
  def(CAPTIONING, 'removeCaptioningChangeListener', `(${CAPTION_LISTENER})V`, (r, _m, [, listener]) => { if (nullish(listener)) npe(r); });

  // ---- TextClassificationManager (android-13.0.0_r1): the manager is a host object; TextClassifier and every request/result/session class are the pinned originals. The lab device has no
  // text-classifier provider (SystemTextClassifier would find no service) and no local classifier ("Local text-classifier not supported"), so the classifier it hands out is TextClassifier.NO_OP.
  // A session is the original TextClassificationSession over the manager's classifier at creation time: independent lifecycle (destroy/isDestroyed), calls on a destroyed session are IllegalStateException.
  const TEXT_CLASSIFICATION = service('textclassification', 'Landroid/view/textclassifier/TextClassificationManager;'), CLASSIFIER = 'Landroid/view/textclassifier/TextClassifier;';
  const TC_CONTEXT = 'Landroid/view/textclassifier/TextClassificationContext;', TC_SESSION = 'Landroid/view/textclassifier/TextClassificationSession;', TC_FACTORY = 'Landroid/view/textclassifier/TextClassificationSessionFactory;';
  const classifierState = new WeakMap();
  const classifierOf = r => { if (!classifierState.has(r)) classifierState.set(r, gcRoot(new Map([['custom', null], ['factory', null]]))); return classifierState.get(r); };
  const noOp = r => r.readStatic({ owner: CLASSIFIER, name: 'NO_OP', type: CLASSIFIER });
  const currentClassifier = r => classifierOf(r).get('custom') ?? noOp(r);
  def(TEXT_CLASSIFICATION, 'getTextClassifier', `()${CLASSIFIER}`, r => currentClassifier(r));
  def(TEXT_CLASSIFICATION, 'getTextClassifier', `(I)${CLASSIFIER}`, r => noOp(r));   // the typed lookup ignores the custom classifier: LOCAL is unsupported and SYSTEM has no service, both answer NO_OP
  def(TEXT_CLASSIFICATION, 'setTextClassifier', `(${CLASSIFIER})V`, (r, _m, [, classifier]) => { classifierOf(r).set('custom', nullish(classifier) ? null : classifier); });
  def(TEXT_CLASSIFICATION, 'setTextClassificationSessionFactory', `(${TC_FACTORY})V`, (r, _m, [, factory]) => { classifierOf(r).set('factory', nullish(factory) ? null : factory); });
  def(TEXT_CLASSIFICATION, 'createTextClassificationSession', `(${TC_CONTEXT})${CLASSIFIER}`, (r, _m, [, context]) => {
    if (nullish(context)) npe(r);
    const factory = classifierOf(r).get('factory');
    const session = factory ? call(r, factory, TC_FACTORY, 'createTextClassificationSession', [TC_CONTEXT], CLASSIFIER, [context]) : construct(r, TC_SESSION, [TC_CONTEXT, CLASSIFIER], [context, currentClassifier(r)]);
    if (nullish(session)) npe(r, 'Session Factory should never return null');
    return session;
  });
  def(TEXT_CLASSIFICATION, 'createTextClassificationSession', `(${TC_CONTEXT}${CLASSIFIER})${CLASSIFIER}`, (r, _m, [, context, classifier]) => {
    if (nullish(context)) npe(r); if (nullish(classifier)) npe(r);
    return construct(r, TC_SESSION, [TC_CONTEXT, CLASSIFIER], [context, classifier]);
  });

  // ---- RoleManager: the lab device has no telephony, so only the roles that need none are available and nobody the app is not holds any role
  const ROLE = service('role', 'Landroid/app/role/RoleManager;');
  const ROLES = { ROLE_ASSISTANT: 'android.app.role.ASSISTANT', ROLE_BROWSER: 'android.app.role.BROWSER', ROLE_CALL_REDIRECTION: 'android.app.role.CALL_REDIRECTION', ROLE_CALL_SCREENING: 'android.app.role.CALL_SCREENING', ROLE_DIALER: 'android.app.role.DIALER', ROLE_EMERGENCY: 'android.app.role.EMERGENCY', ROLE_HOME: 'android.app.role.HOME', ROLE_SMS: 'android.app.role.SMS' };
  strings(ROLE, ROLES); consts(ROLE, { MANAGE_HOLDERS_FLAG_DONT_KILL_APP: 1 });
  const AVAILABLE_ROLES = new Set(['android.app.role.ASSISTANT', 'android.app.role.BROWSER', 'android.app.role.HOME']);
  const roleName = (r, value) => { const name = requireText(r, value, 'roleName'); if (name === '') iae(r, 'roleName cannot be empty'); return name; };
  def(ROLE, 'isRoleAvailable', `(${STRING})Z`, (r, _m, [, role]) => (AVAILABLE_ROLES.has(roleName(r, role)) ? 1 : 0));
  def(ROLE, 'isRoleHeld', `(${STRING})Z`, (r, _m, [, role]) => { roleName(r, role); return 0; });
  def(ROLE, 'createRequestRoleIntent', `(${STRING})${INTENT}`, (r, _m, [, role]) => {
    const name = roleName(r, role), intent = construct(r, INTENT, [STRING], ['android.app.role.action.REQUEST_ROLE']);
    call(r, intent, INTENT, 'setPackage', [STRING], INTENT, ['com.android.permissioncontroller']);
    call(r, intent, INTENT, 'putExtra', [STRING, STRING], INTENT, ['android.app.role.extra.REQUEST_ROLE_NAME', name]);
    return intent;
  });

  // ---- DevicePolicyManager: no device owner, no profile owner, no active admin
  const DPM = service('device_policy', 'Landroid/app/admin/DevicePolicyManager;');
  consts(DPM, { ENCRYPTION_STATUS_UNSUPPORTED: 0, ENCRYPTION_STATUS_INACTIVE: 1, ENCRYPTION_STATUS_ACTIVATING: 2, ENCRYPTION_STATUS_ACTIVE: 3, ENCRYPTION_STATUS_ACTIVE_DEFAULT_KEY: 4, ENCRYPTION_STATUS_ACTIVE_PER_USER: 5,
    PASSWORD_COMPLEXITY_NONE: 0, PASSWORD_COMPLEXITY_LOW: 65536, PASSWORD_COMPLEXITY_MEDIUM: 196608, PASSWORD_COMPLEXITY_HIGH: 327680, KEYGUARD_DISABLE_FEATURES_NONE: 0, KEYGUARD_DISABLE_FEATURES_ALL: 2147483647,
    PASSWORD_QUALITY_UNSPECIFIED: 0, PASSWORD_QUALITY_BIOMETRIC_WEAK: 32768, PASSWORD_QUALITY_SOMETHING: 65536, PASSWORD_QUALITY_NUMERIC: 131072, PASSWORD_QUALITY_NUMERIC_COMPLEX: 196608, PASSWORD_QUALITY_ALPHABETIC: 262144, PASSWORD_QUALITY_ALPHANUMERIC: 327680, PASSWORD_QUALITY_COMPLEX: 393216 });
  strings(DPM, { ACTION_ADD_DEVICE_ADMIN: 'android.app.action.ADD_DEVICE_ADMIN', EXTRA_DEVICE_ADMIN: 'android.app.extra.DEVICE_ADMIN', EXTRA_ADD_EXPLANATION: 'android.app.extra.ADD_EXPLANATION', ACTION_DEVICE_POLICY_MANAGER_STATE_CHANGED: 'android.app.action.DEVICE_POLICY_MANAGER_STATE_CHANGED' });
  const notAdmin = (r, admin) => denied(r, `No active admin {${text(r, call(r, admin, COMPONENT, 'getPackageName', [], STRING))}/${text(r, call(r, admin, COMPONENT, 'getClassName', [], STRING))}}`);
  const adminCheck = (r, admin) => { if (!nullish(admin)) notAdmin(r, admin); };
  def(DPM, 'isAdminActive', `(${COMPONENT})Z`, (r, _m, [, admin]) => { if (nullish(admin)) npe(r); return 0; });
  def(DPM, 'getActiveAdmins', `()${LIST}`, () => null);
  def(DPM, 'isOrganizationOwnedDeviceWithManagedProfile', '()Z', () => 0);
  // getDeviceOwnerComponentOnAnyUser (@SystemApi): DevicePolicyManagerService.getDeviceOwnerComponent(false) checks canManageUsers or MANAGE_PROFILE_AND_DEVICE_OWNERS, which an installed app does not hold
  def(DPM, 'getDeviceOwnerComponentOnAnyUser', '()Landroid/content/ComponentName;', r => r.throwJava('Ljava/lang/SecurityException;', 'Calling identity is not authorized'));   // API 30: no device or profile owner on this device
  def(DPM, 'isDeviceOwnerApp', `(${STRING})Z`, () => 0); def(DPM, 'isProfileOwnerApp', `(${STRING})Z`, () => 0);
  def(DPM, 'isDeviceManaged', '()Z', () => 0); def(DPM, 'isManagedProfile', `(${COMPONENT})Z`, (r, _m, [, admin]) => { adminCheck(r, admin); return 0; });
  def(DPM, 'isUsingUnifiedPassword', `(${COMPONENT})Z`, (r, _m, [, admin]) => { if (nullish(admin)) npe(r); notAdmin(r, admin); });
  def(DPM, 'getProfileOwner', `()${COMPONENT}`, () => null);
  def(DPM, 'getDeviceOwner', `()${STRING}`, () => null);
  def(DPM, 'getStorageEncryptionStatus', '()I', () => 5);
  def(DPM, 'getStorageEncryption', `(${COMPONENT})Z`, (r, _m, [, admin]) => { adminCheck(r, admin); return 0; });
  def(DPM, 'getCameraDisabled', `(${COMPONENT})Z`, (r, _m, [, admin]) => { adminCheck(r, admin); return 0; });
  def(DPM, 'getKeyguardDisabledFeatures', `(${COMPONENT})I`, (r, _m, [, admin]) => { adminCheck(r, admin); return 0; });
  def(DPM, 'getPasswordQuality', `(${COMPONENT})I`, (r, _m, [, admin]) => { adminCheck(r, admin); return 0; });
  def(DPM, 'getPasswordMinimumLength', `(${COMPONENT})I`, (r, _m, [, admin]) => { adminCheck(r, admin); return 0; });
  def(DPM, 'getMaximumTimeToLock', `(${COMPONENT})J`, (r, _m, [, admin]) => { adminCheck(r, admin); return 0n; });
  def(DPM, 'getPasswordComplexity', '()I', r => { enforce(r, 'android.permission.REQUEST_PASSWORD_COMPLEXITY', 'Must have android.permission.REQUEST_PASSWORD_COMPLEXITY permission.'); return 0; });
  def(DPM, 'isActivePasswordSufficient', '()Z', r => { enforce(r, 'android.permission.BIND_DEVICE_ADMIN', 'No active admin owned by uid ' + uid()); return 0; });
  def(DPM, 'isUninstallBlocked', `(${COMPONENT}${STRING})Z`, (r, _m, [, admin, name]) => { adminCheck(r, admin); void name; return 0; });
  def(DPM, 'isApplicationHidden', `(${COMPONENT}${STRING})Z`, (r, _m, [, admin]) => { if (nullish(admin)) npe(r); notAdmin(r, admin); });
  def(DPM, 'getApplicationRestrictions', `(${COMPONENT}${STRING})${BUNDLE}`, (r, _m, [, admin]) => { if (nullish(admin)) npe(r); notAdmin(r, admin); });
  def(DPM, 'getPermittedInputMethods', `(${COMPONENT})${LIST}`, (r, _m, [, admin]) => { adminCheck(r, admin); return null; });
  def(DPM, 'getAccountTypesWithManagementDisabled', `()[${STRING}`, r => r.newArray(`[${STRING}`, 0));
  def(DPM, 'getLockTaskPackages', `(${COMPONENT})[${STRING}`, (r, _m, [, admin]) => { if (nullish(admin)) npe(r); notAdmin(r, admin); });
  def(DPM, 'isLockTaskPermitted', `(${STRING})Z`, () => 0);
  def(DPM, 'lockNow', '()V', r => denied(r, 'No active admin owned by uid ' + uid()));
  def(DPM, 'wipeData', '(I)V', r => denied(r, 'No active admin owned by uid ' + uid()));
  def(DPM, 'resetPassword', `(${STRING}I)Z`, r => denied(r, 'Admin cannot call resetPassword'));
  // Queries whose answer for an app that is no admin follows DevicePolicyManager.java / DevicePolicyManagerService.java (android-13.0.0_r1): no device owner, no profile owner, no system update policy.
  def(DPM, 'getAutoTimeRequired', '()Z', () => 0); def(DPM, 'isLogoutEnabled', '()Z', () => 0); def(DPM, 'isAffiliatedUser', '()Z', () => 0);
  def(DPM, 'getDeviceOwnerLockScreenInfo', `()Ljava/lang/CharSequence;`, () => null); def(DPM, 'getSystemUpdatePolicy', '()Landroid/app/admin/SystemUpdatePolicy;', () => null);
  def(DPM, 'getMinimumRequiredWifiSecurityLevel', '()I', () => 0);   // WIFI_SECURITY_OPEN: no admin sets a floor
  def(DPM, 'isUsbDataSignalingEnabled', '()Z', () => 1);
  def(DPM, 'getWifiSsidPolicy', '()Landroid/net/wifi/WifiSsidPolicy;', r => denied(r, 'SSID policy can only be retrieved by a device owner or a profile owner on an organization-owned device or an app with the QUERY_ADMIN_POLICY permission.'));
  def(DPM, 'getCurrentFailedPasswordAttempts', '()I', r => { if (!platform.holdsPermission?.(r, 'android.permission.ACCESS_KEYGUARD_SECURE_STORAGE')) denied(r, `No active admin owned by uid ${uid()} for policy #1`); return 0; });
  const hasFeature = (r, feature) => call(r, call(r, platform.application, 'Landroid/content/Context;', 'getPackageManager', [], 'Landroid/content/pm/PackageManager;'), 'Landroid/content/pm/PackageManager;', 'hasSystemFeature', [STRING], 'Z', [feature]);
  def(DPM, 'isDeviceIdAttestationSupported', '()Z', r => hasFeature(r, 'android.software.device_id_attestation'));
  def(DPM, 'isUniqueDeviceAttestationSupported', '()Z', r => hasFeature(r, 'android.hardware.device_unique_attestation'));
  def(DPM, 'getParentProfileInstance', `(${COMPONENT})Landroid/app/admin/DevicePolicyManager;`, (r, _m, [, admin]) => { if (nullish(admin)) npe(r); notAdmin(r, admin); });

  // ---- SubscriptionManager / CarrierConfigManager: no telephony feature and no SIM, so there are no subscriptions and the carrier configuration is the default one
  const SUBSCRIPTION = service('telephony_subscription_service', 'Landroid/telephony/SubscriptionManager;');
  consts(SUBSCRIPTION, { INVALID_SUBSCRIPTION_ID: -1, DEFAULT_SUBSCRIPTION_ID: 2147483647, INVALID_SIM_SLOT_INDEX: -1, SIM_PROVISIONED: 0, SUBSCRIPTION_TYPE_LOCAL_SIM: 0, SUBSCRIPTION_TYPE_REMOTE_SIM: 1 });
  strings(SUBSCRIPTION, { ACTION_DEFAULT_SUBSCRIPTION_CHANGED: 'android.telephony.action.DEFAULT_SUBSCRIPTION_CHANGED', ACTION_DEFAULT_SMS_SUBSCRIPTION_CHANGED: 'android.telephony.action.DEFAULT_SMS_SUBSCRIPTION_CHANGED' });
  const phoneState = r => enforce(r, 'android.permission.READ_PHONE_STATE', `getActiveSubscriptionInfoList: Neither user ${uid()} nor current process has android.permission.READ_PHONE_STATE.`);
  def(SUBSCRIPTION, 'getActiveSubscriptionInfoList', `()${LIST}`, r => { phoneState(r); return emptyList(r); });
  def(SUBSCRIPTION, 'getAvailableSubscriptionInfoList', `()${LIST}`, r => { phoneState(r); return emptyList(r); });
  def(SUBSCRIPTION, 'getActiveSubscriptionInfoCount', '()I', r => { phoneState(r); return 0; });
  def(SUBSCRIPTION, 'getActiveSubscriptionInfoCountMax', '()I', () => 0);
  def(SUBSCRIPTION, 'getActiveSubscriptionInfo', '(I)Landroid/telephony/SubscriptionInfo;', r => { phoneState(r); return null; });
  def(SUBSCRIPTION, 'getActiveSubscriptionInfoForSimSlotIndex', '(I)Landroid/telephony/SubscriptionInfo;', (r, _m, [, slot]) => { phoneState(r); if (slot < 0) iae(r, `Invalid slot index: ${slot}`); return null; });
  for (const name of ['getDefaultSubscriptionId', 'getDefaultDataSubscriptionId', 'getDefaultSmsSubscriptionId', 'getDefaultVoiceSubscriptionId', 'getActiveDataSubscriptionId']) def(SUBSCRIPTION, name, '()I', () => -1, { static: true });
  def(SUBSCRIPTION, 'isValidSubscriptionId', '(I)Z', (r, _m, [id]) => (id > -1 ? 1 : 0), { static: true });
  def(SUBSCRIPTION, 'getSlotIndex', '(I)I', () => -1, { static: true });
  def(SUBSCRIPTION, 'isNetworkRoaming', '(I)Z', () => 0);
  // OnSubscriptionsChangedListener (a class the app extends): the constructor binds it to the caller's Looper and onSubscriptionsChanged() is an empty callback the app overrides.
  // This device has no SIM, so the subscription list never changes and the service never calls it.
  const SUB_LISTENER = 'Landroid/telephony/SubscriptionManager$OnSubscriptionsChangedListener;';
  type(SUB_LISTENER, OBJECT, [], { allocatable: true });
  def(SUB_LISTENER, '<init>', '()V', () => {});
  def(SUB_LISTENER, 'onSubscriptionsChanged', '()V', () => {});
  def(SUBSCRIPTION, 'addOnSubscriptionsChangedListener', '(Landroid/telephony/SubscriptionManager$OnSubscriptionsChangedListener;)V', (r, _m, [, listener]) => { if (nullish(listener)) npe(r); });
  def(SUBSCRIPTION, 'removeOnSubscriptionsChangedListener', '(Landroid/telephony/SubscriptionManager$OnSubscriptionsChangedListener;)V', (r, _m, [, listener]) => { if (nullish(listener)) npe(r); });
  const CARRIER = service('carrier_config', 'Landroid/telephony/CarrierConfigManager;');
  strings(CARRIER, { ACTION_CARRIER_CONFIG_CHANGED: 'android.telephony.action.CARRIER_CONFIG_CHANGED', KEY_CARRIER_VOLTE_AVAILABLE_BOOL: 'carrier_volte_available_bool', KEY_CARRIER_WFC_IMS_AVAILABLE_BOOL: 'carrier_wfc_ims_available_bool', KEY_CARRIER_VT_AVAILABLE_BOOL: 'carrier_vt_available_bool',
    KEY_CARRIER_NAME_STRING: 'carrier_name_string', KEY_CARRIER_NAME_OVERRIDE_BOOL: 'carrier_name_override_bool', KEY_SHOW_APN_SETTING_CDMA_BOOL: 'show_apn_setting_cdma_bool', KEY_ALLOW_VIDEO_CALLING_FALLBACK_BOOL: 'allow_video_calling_fallback_bool', KEY_IS_OPPORTUNISTIC_SUBSCRIPTION_BOOL: 'is_opportunistic_subscription_bool' });
  consts(CARRIER, { SIM_ID_NOT_AVAILABLE: -1 });
  def(CARRIER, 'getConfig', `()${PBUNDLE}`, r => { phoneState(r); return construct(r, PBUNDLE); });
  def(CARRIER, 'getConfigForSubId', `(I)${PBUNDLE}`, (r, _m, [, subId]) => { phoneState(r); return subId < 0 ? construct(r, PBUNDLE) : null; });
  def(CARRIER, 'isConfigForIdentifiedCarrier', `(${PBUNDLE})Z`, (r, _m, [, config]) => { if (nullish(config)) npe(r); return 0; }, { static: false });
  def(CARRIER, 'notifyConfigChangedForSubId', '(I)V', r => enforce(r, 'android.permission.MODIFY_PHONE_STATE'));
  def(CARRIER, 'overrideConfig', `(I${PBUNDLE})V`, r => enforce(r, 'android.permission.MODIFY_PHONE_STATE'));

  // ---- MediaSessionManager: controlling other apps' sessions needs MEDIA_CONTENT_CONTROL or an enabled notification listener
  const MEDIA_SESSION = service('media_session', 'Landroid/media/session/MediaSessionManager;');
  const sessionAccess = (r, listener) => {
    if (nullish(listener)) enforce(r, 'android.permission.MEDIA_CONTENT_CONTROL', 'Missing permission to control media.');
    else denied(r, `Notification listener ${text(r, call(r, listener, COMPONENT, 'flattenToShortString', [], STRING))} is not enabled for ${pkg()}`);
  };
  def(MEDIA_SESSION, 'getActiveSessions', `(${COMPONENT})${LIST}`, (r, _m, [, listener]) => { sessionAccess(r, listener); return emptyList(r); });
  def(MEDIA_SESSION, 'addOnActiveSessionsChangedListener', `(Landroid/media/session/MediaSessionManager$OnActiveSessionsChangedListener;${COMPONENT})V`, (r, _m, [, callback, listener]) => { if (nullish(callback)) iae(r, 'listener may not be null'); sessionAccess(r, listener); });
  def(MEDIA_SESSION, 'removeOnActiveSessionsChangedListener', '(Landroid/media/session/MediaSessionManager$OnActiveSessionsChangedListener;)V', (r, _m, [, callback]) => { if (nullish(callback)) iae(r, 'listener may not be null'); });
  def(MEDIA_SESSION, 'getSession2Tokens', `()${LIST}`, r => emptyList(r));
  def(MEDIA_SESSION, 'isTrustedForMediaControl', '(Landroid/media/session/MediaSessionManager$RemoteUserInfo;)Z', (r, _m, [, info]) => { if (nullish(info)) npe(r, 'userInfo may not be null'); return 0; });

  // ---- LauncherApps: this app is the only one on the device that has a launcher entry
  const LAUNCHER = service('launcherapps', 'Landroid/content/pm/LauncherApps;'), ACTIVITY_INFO = 'Landroid/content/pm/LauncherActivityInfo;';
  type(ACTIVITY_INFO, OBJECT, [], { allocatable: true });
  const ownComponent = r => { const name = r.launcherActivity; if (!name) return null; return construct(r, COMPONENT, [STRING, STRING], [pkg(), name]); };
  const ownUser = r => callStatic(r, 'Landroid/os/Process;', 'myUserHandle', [], USER_HANDLE);
  const activityInfo = (r, component) => { const info = r.allocate(ACTIVITY_INFO); r.object(info).launcher = { component, user: ownUser(r) }; return info; };
  const launcherInfo = (r, self) => r.object(self).launcher ?? ise(r, 'LauncherActivityInfo used before construction');
  def(ACTIVITY_INFO, 'getComponentName', `()${COMPONENT}`, (r, _m, [self]) => launcherInfo(r, self).component);
  def(ACTIVITY_INFO, 'getName', `()${STRING}`, (r, _m, [self]) => text(r, call(r, launcherInfo(r, self).component, COMPONENT, 'getClassName', [], STRING)));
  def(ACTIVITY_INFO, 'getUser', `()${USER_HANDLE}`, (r, _m, [self]) => launcherInfo(r, self).user);
  def(ACTIVITY_INFO, 'getApplicationInfo', '()Landroid/content/pm/ApplicationInfo;', r => platform.applicationInfo(r, false));
  def(ACTIVITY_INFO, 'getLabel', `()${CHAR_SEQUENCE}`, r => platform.applicationLabel?.(r) ?? pkg());
  def(ACTIVITY_INFO, 'getFirstInstallTime', '()J', () => 0n);
  const sameUser = (r, user) => nullish(user) || text(r, call(r, user, USER_HANDLE, 'toString', [], STRING)) === text(r, call(r, ownUser(r), USER_HANDLE, 'toString', [], STRING));
  def(LAUNCHER, 'getActivityList', `(${STRING}${USER_HANDLE})${LIST}`, (r, _m, [, packageName, user]) => {
    if (nullish(user)) npe(r, 'user'); if (!sameUser(r, user)) return emptyList(r);
    if (!nullish(packageName) && text(r, packageName) !== pkg()) return emptyList(r);
    const component = ownComponent(r); return component ? listOf(r, [activityInfo(r, component)]) : emptyList(r);
  });
  def(LAUNCHER, 'resolveActivity', `(${INTENT}${USER_HANDLE})${ACTIVITY_INFO}`, (r, _m, [, intent, user]) => {
    if (nullish(user)) npe(r, 'user'); if (nullish(intent)) return null;
    const component = call(r, intent, INTENT, 'getComponent', [], COMPONENT), own = ownComponent(r);
    if (!own || !sameUser(r, user)) return null;
    if (component !== null && text(r, call(r, component, COMPONENT, 'flattenToString', [], STRING)) === text(r, call(r, own, COMPONENT, 'flattenToString', [], STRING))) return activityInfo(r, own);
    const target = call(r, intent, INTENT, 'getPackage', [], STRING);
    return component === null && target !== null && text(r, target) === pkg() ? activityInfo(r, own) : null;
  });
  def(LAUNCHER, 'isPackageEnabled', `(${STRING}${USER_HANDLE})Z`, (r, _m, [, packageName, user]) => { if (nullish(user)) npe(r, 'user'); return sameUser(r, user) && text(r, packageName) === pkg() ? 1 : 0; });
  def(LAUNCHER, 'isActivityEnabled', `(${COMPONENT}${USER_HANDLE})Z`, (r, _m, [, component, user]) => { if (nullish(component)) npe(r, 'component'); if (nullish(user)) npe(r, 'user'); return sameUser(r, user) && text(r, call(r, component, COMPONENT, 'getPackageName', [], STRING)) === pkg() ? 1 : 0; });
  def(LAUNCHER, 'getProfiles', `()${LIST}`, r => listOf(r, [ownUser(r)]));
  def(LAUNCHER, 'hasShortcutHostPermission', '()Z', () => 0);
  def(LAUNCHER, 'getShortcuts', `(Landroid/content/pm/LauncherApps$ShortcutQuery;${USER_HANDLE})${LIST}`, r => denied(r, "Caller can't access shortcut information"));
  def(LAUNCHER, 'registerCallback', '(Landroid/content/pm/LauncherApps$Callback;)V', (r, _m, [, callback]) => { void callback; });
  def(LAUNCHER, 'unregisterCallback', '(Landroid/content/pm/LauncherApps$Callback;)V', (r, _m, [, callback]) => { void callback; });
  def(LAUNCHER, 'getSuspendedPackageLauncherExtras', `(${STRING}${USER_HANDLE})${BUNDLE}`, (r, _m, [, packageName]) => { requireText(r, packageName, 'packageName'); return null; });

  // ---- WallpaperManager: the lab device shows a plain wallpaper of the device size; the colour is that of the default theme background
  const WALLPAPER = service('wallpaper', 'Landroid/app/WallpaperManager;'), COLOR_DRAWABLE = 'Landroid/graphics/drawable/ColorDrawable;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;';
  consts(WALLPAPER, { FLAG_SYSTEM: 1, FLAG_LOCK: 2, COMMAND_TAP_INT: 0 }); strings(WALLPAPER, { ACTION_LIVE_WALLPAPER_CHOOSER: 'android.service.wallpaper.LIVE_WALLPAPER_CHOOSER', ACTION_CROP_AND_SET_WALLPAPER: 'android.service.wallpaper.CROP_AND_SET_WALLPAPER' });
  def(WALLPAPER, 'getInstance', `(${CONTEXT_T})Landroid/app/WallpaperManager;`, (r, _m, [context]) => { if (nullish(context)) npe(r); return call(r, context, CONTEXT_T, 'getSystemService', [STRING], OBJECT, ['wallpaper']); }, { static: true });
  const widthPx = () => platform.device?.widthDp ?? 360, heightPx = () => platform.device?.heightDp ?? 640;
  def(WALLPAPER, 'getDesiredMinimumWidth', '()I', () => widthPx());
  def(WALLPAPER, 'getDesiredMinimumHeight', '()I', () => heightPx());
  def(WALLPAPER, 'isWallpaperSupported', '()Z', () => 1);
  def(WALLPAPER, 'isSetWallpaperAllowed', '()Z', () => 1);
  def(WALLPAPER, 'getWallpaperInfo', '()Landroid/app/WallpaperInfo;', () => null);
  def(WALLPAPER, 'hasResourceWallpaper', '(I)Z', () => 0);
  const plain = r => construct(r, COLOR_DRAWABLE, ['I'], [-14211289]);
  def(WALLPAPER, 'getDrawable', `()${DRAWABLE}`, r => plain(r));
  def(WALLPAPER, 'peekDrawable', `()${DRAWABLE}`, r => plain(r));
  def(WALLPAPER, 'getBuiltInDrawable', `()${DRAWABLE}`, r => plain(r));
  for (const name of ['setBitmap', 'setResource', 'setStream']) {
    const parameters = { setBitmap: ['Landroid/graphics/Bitmap;'], setResource: ['I'], setStream: ['Ljava/io/InputStream;'] }[name];
    def(WALLPAPER, name, `(${parameters.join('')})${name === 'setResource' ? 'I' : 'V'}`, (r, _m, [, value]) => { enforce(r, 'android.permission.SET_WALLPAPER'); if (parameters[0].startsWith('L') && nullish(value)) npe(r); r.throwJava('Ljava/lang/UnsupportedOperationException;', 'The browser VM has no wallpaper surface to draw a new wallpaper on'); });
  }
  def(WALLPAPER, 'clear', '()V', r => enforce(r, 'android.permission.SET_WALLPAPER'));
  // WallpaperManagerService.getWallpaperIdForUser (android-13.0.0_r1): exactly one of FLAG_SYSTEM / FLAG_LOCK; the system wallpaper of the lab device is the first one ever set (id 1, makeWallpaperIdLocked
  // starts at 1); no separate lock-screen wallpaper is set, so FLAG_LOCK answers -1 (the lock screen shows the system one). No permission is needed.
  const wallpaperId = (r, which) => { if (which !== 1 && which !== 2) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Must specify exactly one kind of wallpaper'); return which === 1 ? 1 : -1; };
  def(WALLPAPER, 'getWallpaperId', '(I)I', (r, _m, [, which]) => wallpaperId(r, which | 0));
  def(WALLPAPER, 'getWallpaperIdForUser', '(II)I', (r, _m, [, which]) => wallpaperId(r, which | 0));
  def(WALLPAPER, 'forgetLoadedWallpaper', '()V', () => {});
  def(WALLPAPER, 'addOnColorsChangedListener', '(Landroid/app/WallpaperManager$OnColorsChangedListener;Landroid/os/Handler;)V', (r, _m, [, listener]) => { if (nullish(listener)) npe(r); });
  def(WALLPAPER, 'removeOnColorsChangedListener', '(Landroid/app/WallpaperManager$OnColorsChangedListener;)V', (r, _m, [, listener]) => { if (nullish(listener)) npe(r); });

  // ---- DomainVerificationManager (API 31, Context.DOMAIN_VERIFICATION_SERVICE): a device where nothing was ever verified or selected. The user state of the app's own package lists the hosts of its
  // android:autoVerify web intent filters, each DOMAIN_STATE_NONE, with link handling allowed; other packages are not installed; the verification-agent / user-selection calls are privileged.
  const DOMAIN = service('domain_verification', 'Landroid/content/pm/verify/domain/DomainVerificationManager;'), DOMAIN_STATE = 'Landroid/content/pm/verify/domain/DomainVerificationUserState;', DOMAIN_INFO = 'Landroid/content/pm/verify/domain/DomainVerificationInfo;';
  type(DOMAIN_STATE, 'Ljava/lang/Object;', [], { allocatable: true }); type(DOMAIN_INFO, 'Ljava/lang/Object;', [], { allocatable: true });
  registry.staticField(DOMAIN_STATE, 'DOMAIN_STATE_NONE', 'I', () => 0); registry.staticField(DOMAIN_STATE, 'DOMAIN_STATE_SELECTED', 'I', () => 1); registry.staticField(DOMAIN_STATE, 'DOMAIN_STATE_VERIFIED', 'I', () => 2);
  const packageGone = (r, name) => r.throwJava('Landroid/content/pm/PackageManager$NameNotFoundException;', name);
  const domainState = (r, packageName) => { const o = r.allocate(DOMAIN_STATE), record = r.object(o); record.packageName = packageName; record.hosts = [...(platform.manifest?.autoVerifyHosts ?? [])]; return o; };
  def(DOMAIN, 'getDomainVerificationUserState', `(${STRING})${DOMAIN_STATE}`, (r, _m, [, packageName]) => {
    const name = requireText(r, packageName, 'packageName'); if (name !== pkg()) packageGone(r, name);
    return domainState(r, name);
  });
  const privileged = (r, permission) => { if (!holds(r, permission)) r.throwJava('Ljava/lang/SecurityException;', `Neither user ${uid()} nor current process has ${permission}.`); };
  def(DOMAIN, 'getDomainVerificationInfo', `(${STRING})${DOMAIN_INFO}`, (r, _m, [, packageName]) => { const name = requireText(r, packageName, 'packageName'); privileged(r, 'android.permission.DOMAIN_VERIFICATION_AGENT'); packageGone(r, name); });
  def(DOMAIN, 'getOwnersForDomain', `(${STRING})Ljava/util/List;`, (r, _m, [, domain]) => { requireText(r, domain, 'domain'); privileged(r, 'android.permission.DOMAIN_VERIFICATION_AGENT'); return emptyList(r); });
  def(DOMAIN, 'queryValidVerificationPackageNames', '()Ljava/util/List;', r => { privileged(r, 'android.permission.DOMAIN_VERIFICATION_AGENT'); return emptyList(r); });
  for (const [name, signature, permission] of [['setDomainVerificationStatus', '(Ljava/util/UUID;Ljava/util/Set;I)V', 'android.permission.DOMAIN_VERIFICATION_AGENT'], ['setDomainVerificationUserSelection', '(Ljava/util/UUID;Ljava/util/Set;Z)V', 'android.permission.UPDATE_DOMAIN_VERIFICATION_USER_SELECTION'], ['setDomainVerificationLinkHandlingAllowed', `(${STRING}Z)V`, 'android.permission.UPDATE_DOMAIN_VERIFICATION_USER_SELECTION']]) {
    def(DOMAIN, name, signature, r => { privileged(r, permission); r.throwJava('Ljava/lang/IllegalArgumentException;', 'Unknown domain verification id'); });
  }
  def(DOMAIN_STATE, 'getPackageName', `()${STRING}`, (r, _m, [self]) => r.javaString(r.object(self).packageName));
  def(DOMAIN_STATE, 'isLinkHandlingAllowed', '()Z', () => 1);
  def(DOMAIN_STATE, 'getUser', `()${USER_HANDLE}`, r => callStatic(r, USER_HANDLE, 'of', ['I'], USER_HANDLE, [0]));
  def(DOMAIN_STATE, 'getIdentifier', '()Ljava/util/UUID;', (r, _m, [self]) => {
    const bytes = Array.from(new TextEncoder().encode('domain-verification:' + r.object(self).packageName)), array_ = r.newArray('[B', bytes.length); r.array(array_).elements = bytes.map(b => (b << 24) >> 24);
    return callStatic(r, 'Ljava/util/UUID;', 'nameUUIDFromBytes', ['[B'], 'Ljava/util/UUID;', [array_]);
  });
  def(DOMAIN_STATE, 'getHostToStateMap', '()Ljava/util/Map;', (r, _m, [self]) => {
    const map = construct(r, 'Ljava/util/HashMap;'), none = r.boxPrimitive('I', 0);
    for (const host of r.object(self).hosts) call(r, map, 'Ljava/util/HashMap;', 'put', [OBJECT, OBJECT], OBJECT, [r.javaString(host), none]);
    return callStatic(r, 'Ljava/util/Collections;', 'unmodifiableMap', ['Ljava/util/Map;'], 'Ljava/util/Map;', [map]);
  });
  def(DOMAIN_STATE, 'describeContents', '()I', () => 0);
  def(DOMAIN_STATE, 'writeToParcel', '(Landroid/os/Parcel;I)V', r => r.throwJava('Ljava/lang/UnsupportedOperationException;', 'DomainVerificationUserState is not parceled by the lab'));

  // ---- Services of a phone-shaped device with nothing behind them (API 25-34 additions swept by scripts/service-sweep.mjs). Each answers what the real manager answers when its backing system
  // service has no data: no widget providers, no phone accounts, no work profile, no eUICC, no fs-verity, no performance-hint HAL. Hardware the device lacks (Wi-Fi Aware, Wi-Fi RTT) is a null service.
  const APPWIDGET = service('appwidget', 'Landroid/appwidget/AppWidgetManager;');
  def(APPWIDGET, 'getInstance', `(${CONTEXT_T})Landroid/appwidget/AppWidgetManager;`, (r, _m, [context]) => { if (nullish(context)) npe(r); return call(r, context, CONTEXT_T, 'getSystemService', [STRING], OBJECT, ['appwidget']); }, { static: true });
  for (const name of ['getInstalledProviders', 'getInstalledProvidersForProfile']) def(APPWIDGET, name, name === 'getInstalledProviders' ? '()Ljava/util/List;' : `(${USER_HANDLE})Ljava/util/List;`, r => emptyList(r));
  def(APPWIDGET, 'getInstalledProviders', '(I)Ljava/util/List;', r => emptyList(r));
  def(APPWIDGET, 'getInstalledProvidersForPackage', `(${STRING}${USER_HANDLE})Ljava/util/List;`, (r, _m, [, packageName]) => { requireText(r, packageName, 'packageName'); return emptyList(r); });
  def(APPWIDGET, 'getAppWidgetIds', '(Landroid/content/ComponentName;)[I', (r, _m, [, provider]) => { if (nullish(provider)) npe(r); return array(r, 'I', []); });
  def(APPWIDGET, 'getAppWidgetInfo', '(I)Landroid/appwidget/AppWidgetProviderInfo;', () => null);
  def(APPWIDGET, 'isRequestPinAppWidgetSupported', '()Z', () => 0);
  def(APPWIDGET, 'requestPinAppWidget', '(Landroid/content/ComponentName;Landroid/os/Bundle;Landroid/app/PendingIntent;)Z', () => 0);
  for (const signature of ['([ILandroid/widget/RemoteViews;)V', '(ILandroid/widget/RemoteViews;)V', '(Landroid/content/ComponentName;Landroid/widget/RemoteViews;)V', '([II)V', '(II)V']) def(APPWIDGET, signature.includes('RemoteViews') ? 'updateAppWidget' : 'notifyAppWidgetViewDataChanged', signature, () => {});

  const TELECOM = service('telecom', 'Landroid/telecom/TelecomManager;'), PHONE_STATE = r => { if (!holds(r, 'android.permission.READ_PHONE_STATE') && !holds(r, 'android.permission.READ_PRIVILEGED_PHONE_STATE')) r.throwJava('Ljava/lang/SecurityException;', `Neither user ${uid()} nor current process has android.permission.READ_PHONE_STATE.`); };
  def(TELECOM, 'isInCall', '()Z', r => { PHONE_STATE(r); return 0; });
  def(TELECOM, 'isInManagedCall', '()Z', r => { PHONE_STATE(r); return 0; });
  def(TELECOM, 'getDefaultDialerPackage', `()${STRING}`, () => null);
  def(TELECOM, 'getSystemDialerPackage', `()${STRING}`, () => null);
  // Phone accounts this app registers (TelecomServiceImpl.registerPhoneAccount + PhoneAccountRegistrar): the handle's ConnectionService must be this package's, declared with
  // android:permission="android.permission.BIND_TELECOM_CONNECTION_SERVICE"; a self-managed account needs MANAGE_OWN_CALLS; SIM-subscription, connection-manager and multi-user
  // accounts need MODIFY_PHONE_STATE, which an installed app never holds. A registered account is returned by getPhoneAccount to its owner and, when self-managed, listed by
  // getSelfManagedPhoneAccounts; nothing else changes on the device (no SIM, no calls). Accounts that are not self-managed would also need the user to enable them: they are not call-capable.
  const PHONE_ACCOUNT = 'Landroid/telecom/PhoneAccount;', PHONE_HANDLE = 'Landroid/telecom/PhoneAccountHandle;';
  const phoneAccounts = new WeakMap(), accountsOf = r => phoneAccounts.get(r) ?? phoneAccounts.set(r, gcRoot(new Map())).get(r);
  const handleKey = (r, handle) => { const component = call(r, handle, PHONE_HANDLE, 'getComponentName', [], COMPONENT); return { component, key: `${text(r, call(r, component, COMPONENT, 'flattenToString', [], STRING))}\u0000${text(r, call(r, handle, PHONE_HANDLE, 'getId', [], STRING))}` }; };
  const ownHandle = (r, handle) => {
    if (nullish(handle)) npe(r);
    const { component, key } = handleKey(r, handle), pkg = text(r, call(r, component, COMPONENT, 'getPackageName', [], STRING));
    if (pkg !== platform.packageName) r.throwJava('Ljava/lang/SecurityException;', `PhoneAccountHandle's ComponentName package ${pkg} does not belong to uid ${uid()}`);
    return { component, key };
  };
  def(TELECOM, 'registerPhoneAccount', `(${PHONE_ACCOUNT})V`, (r, _m, [, account]) => {
    if (nullish(account)) npe(r);
    const handle = call(r, account, PHONE_ACCOUNT, 'getAccountHandle', [], PHONE_HANDLE), { component, key } = ownHandle(r, handle);
    const capable = flag => call(r, account, PHONE_ACCOUNT, 'hasCapabilities', ['I'], 'Z', [flag]) !== 0, selfManaged = capable(0x800);
    if (selfManaged && !holds(r, 'android.permission.MANAGE_OWN_CALLS')) r.throwJava('Ljava/lang/SecurityException;', 'Self-managed ConnectionServices require MANAGE_OWN_CALLS permission.');
    if (capable(0x4) || capable(0x1) || capable(0x20)) r.throwJava('Ljava/lang/SecurityException;', 'Caller does not have android.permission.MODIFY_PHONE_STATE.');
    const className = text(r, call(r, component, COMPONENT, 'getClassName', [], STRING));
    const declared = (platform.manifest?.componentDetails ?? []).find(d => d.kind === 'service' && d.name === className);
    if (declared?.permission !== 'android.permission.BIND_TELECOM_CONNECTION_SERVICE') r.throwJava('Ljava/lang/IllegalArgumentException;', 'PhoneAccount connection service requires BIND_TELECOM_CONNECTION_SERVICE permission.');
    accountsOf(r).set(key, { handle, account, selfManaged }); r.record(`TELECOM registerPhoneAccount ${key.replace('\u0000', ' id=')}${selfManaged ? ' (self-managed)' : ''}`);
  });
  def(TELECOM, 'unregisterPhoneAccount', `(${PHONE_HANDLE})V`, (r, _m, [, handle]) => { const { key } = ownHandle(r, handle); accountsOf(r).delete(key); });
  def(TELECOM, 'getSelfManagedPhoneAccounts', '()Ljava/util/List;', r => { PHONE_STATE(r); return listOf(r, [...accountsOf(r).values()].filter(a => a.selfManaged).map(a => a.handle)); });
  for (const name of ['getCallCapablePhoneAccounts', 'getAllPhoneAccounts']) def(TELECOM, name, '()Ljava/util/List;', r => { PHONE_STATE(r); return emptyList(r); });
  def(TELECOM, 'getCallCapablePhoneAccounts', '(Z)Ljava/util/List;', r => { PHONE_STATE(r); return emptyList(r); });
  def(TELECOM, 'getPhoneAccount', '(Landroid/telecom/PhoneAccountHandle;)Landroid/telecom/PhoneAccount;', (r, _m, [, handle]) => { if (nullish(handle)) npe(r); return accountsOf(r).get(handleKey(r, handle).key)?.account ?? null; });
  def(TELECOM, 'getDefaultOutgoingPhoneAccount', `(${STRING})Landroid/telecom/PhoneAccountHandle;`, () => null);
  def(TELECOM, 'getUserSelectedOutgoingPhoneAccount', '()Landroid/telecom/PhoneAccountHandle;', () => null);
  def(TELECOM, 'getSimCallManager', '()Landroid/telecom/PhoneAccountHandle;', () => null);
  def(TELECOM, 'isTtySupported', '()Z', r => { PHONE_STATE(r); return 0; });
  def(TELECOM, 'getCurrentTtyMode', '()I', r => { PHONE_STATE(r); return 0; });
  def(TELECOM, 'isVoiceMailNumber', `(Landroid/telecom/PhoneAccountHandle;${STRING})Z`, r => { PHONE_STATE(r); return 0; });
  def(TELECOM, 'getVoiceMailNumber', `(Landroid/telecom/PhoneAccountHandle;)${STRING}`, r => { PHONE_STATE(r); return null; });
  def(TELECOM, 'isOutgoingCallPermitted', '(Landroid/telecom/PhoneAccountHandle;)Z', () => 0);
  def(TELECOM, 'isIncomingCallPermitted', '(Landroid/telecom/PhoneAccountHandle;)Z', () => 0);

  // android.app.backup.BackupManager on a device without the backup service (ServiceManager.getService("backup") is null): checkServiceBinder() finds no service, so dataChanged()
  // reaches nothing, as BackupManager does there; the call is recorded in the trace. Restore and transport APIs are not modelled and fail by name.
  const BACKUP = 'Landroid/app/backup/BackupManager;';
  type(BACKUP, OBJECT, [], { allocatable: true });
  def(BACKUP, '<init>', '(Landroid/content/Context;)V', (r, _m, [self, context]) => { r.object(self).backupContext = context; });
  def(BACKUP, 'dataChanged', '()V', r => { r.record(`BACKUP dataChanged ${platform.packageName} (no backup service on this device)`); });
  def(BACKUP, 'dataChanged', `(${STRING})V`, (r, _m, [pkg]) => { r.record(`BACKUP dataChanged ${nullish(pkg) ? 'null' : text(r, pkg)} (no backup service on this device)`); }, { static: true });

  // ---- android.media.metrics.MediaMetricsManager (API 31, service "media_metrics") -------------------------------------------------------------------
  // createPlaybackSession / createRecordingSession return a session whose LogSessionId is a fresh id made as MediaMetricsManagerService.getSessionIdInternal does (12 random
  // bytes, URL-safe Base64 without padding or wrap). The events a session reports (PlaybackMetrics, PlaybackStateEvent, PlaybackErrorEvent, NetworkEvent, TrackChangeEvent:
  // original classes) go to the media metrics service of the device, which keeps them on the device; here each one is recorded in the trace and nothing leaves the lab.
  const MEDIA_METRICS = service('media_metrics', 'Landroid/media/metrics/MediaMetricsManager;'), LOG_SESSION_ID = 'Landroid/media/metrics/LogSessionId;';
  const newSessionId = r => {
    const bytes = crypto.getRandomValues(new Uint8Array(12)), id = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    const logId = r.allocate(LOG_SESSION_ID); r.dispatch({ owner: LOG_SESSION_ID, name: '<init>', parameters: [STRING], result: 'V', signature: `(${STRING})V` }, [logId, id], 'direct'); return { id, logId };
  };
  for (const [kind, sessionType, reports] of [['Playback', 'Landroid/media/metrics/PlaybackSession;', ['PlaybackMetrics', 'PlaybackErrorEvent', 'NetworkEvent', 'PlaybackStateEvent', 'TrackChangeEvent']], ['Recording', 'Landroid/media/metrics/RecordingSession;', []]]) {
    type(sessionType, OBJECT, ['Ljava/lang/AutoCloseable;'], { allocatable: true });
    def(MEDIA_METRICS, `create${kind}Session`, `()${sessionType}`, r => { const session = r.allocate(sessionType), { id, logId } = newSessionId(r); Object.assign(r.object(session), { metricsSessionId: logId, metricsId: id, metricsClosed: false }); r.record(`MEDIA_METRICS create${kind}Session ${id}`); return session; });
    def(sessionType, 'getSessionId', `()${LOG_SESSION_ID}`, (r, _m, [self]) => r.object(self).metricsSessionId);
    def(sessionType, 'close', '()V', (r, _m, [self]) => { r.object(self).metricsClosed = true; });
    def(sessionType, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => (other !== null && r.typeOf(other) === sessionType && r.object(other).metricsId === r.object(self).metricsId) ? 1 : 0);
    def(sessionType, 'hashCode', '()I', (r, _m, [self]) => [...r.object(self).metricsId].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0));
    for (const report of reports) def(sessionType, `report${report}`, `(Landroid/media/metrics/${report};)V`, (r, _m, [self, event]) => { if (nullish(event)) npe(r); r.record(`MEDIA_METRICS ${r.object(self).metricsId} report${report} (kept on the device)`); });
  }

  const PERF_HINT = service('performance_hint', 'Landroid/os/PerformanceHintManager;');
  def(PERF_HINT, 'getPreferredUpdateRateNanos', '()J', () => -1n);
  def(PERF_HINT, 'createHintSession', '([IJ)Landroid/os/PerformanceHintManager$Session;', (r, _m, [, tids, target]) => { if (nullish(tids)) npe(r); if (Number(target) <= 0) iae(r, 'Target duration should be positive.'); return null; });   // no hint HAL: no session

  const EUICC = service('euicc', 'Landroid/telephony/euicc/EuiccManager;');
  def(EUICC, 'isEnabled', '()Z', () => 0); def(EUICC, 'getEid', `()${STRING}`, () => null);

  const INTEGRITY = service('file_integrity', 'Landroid/security/FileIntegrityManager;');
  def(INTEGRITY, 'isApkVeritySupported', '()Z', () => 0);
  def(INTEGRITY, 'isAppSourceCertificateTrusted', '(Ljava/security/cert/X509Certificate;)Z', (r, _m, [, certificate]) => { if (nullish(certificate)) npe(r); return 0; });

  const CROSS = service('crossprofileapps', 'Landroid/content/pm/CrossProfileApps;');
  def(CROSS, 'getTargetUserProfiles', '()Ljava/util/List;', r => emptyList(r));
  def(CROSS, 'canInteractAcrossProfiles', '()Z', () => 0);
  def(CROSS, 'canRequestInteractAcrossProfiles', '()Z', () => 0);

  const DIAGNOSTICS = service('connectivity_diagnostics', 'Landroid/net/ConnectivityDiagnosticsManager;');
  def(DIAGNOSTICS, 'registerConnectivityDiagnosticsCallback', '(Landroid/net/NetworkRequest;Ljava/util/concurrent/Executor;Landroid/net/ConnectivityDiagnosticsManager$ConnectivityDiagnosticsCallback;)V', (r, _m, [, request, executor, callback]) => { if (nullish(request) || nullish(executor) || nullish(callback)) npe(r); });
  def(DIAGNOSTICS, 'unregisterConnectivityDiagnosticsCallback', '(Landroid/net/ConnectivityDiagnosticsManager$ConnectivityDiagnosticsCallback;)V', (r, _m, [, callback]) => { if (nullish(callback)) npe(r); });

  // ---- SearchManager: no searchable activities, no global search provider
  const SEARCH = service('search', 'Landroid/app/SearchManager;');
  strings(SEARCH, { QUERY: 'query', USER_QUERY: 'user_query', APP_DATA: 'app_data', ACTION_KEY: 'action_key', EXTRA_SELECT_QUERY: 'select_query', ACTION_MSG: 'action_msg', SUGGEST_COLUMN_TEXT_1: 'suggest_text_1', SUGGEST_COLUMN_TEXT_2: 'suggest_text_2', SUGGEST_COLUMN_INTENT_ACTION: 'suggest_intent_action',
    SUGGEST_COLUMN_INTENT_DATA: 'suggest_intent_data', SUGGEST_COLUMN_INTENT_EXTRA_DATA: 'suggest_intent_extra_data', SUGGEST_COLUMN_QUERY: 'suggest_intent_query', SUGGEST_COLUMN_ICON_1: 'suggest_icon_1', SUGGEST_COLUMN_ICON_2: 'suggest_icon_2', SUGGEST_COLUMN_FORMAT: 'suggest_format', SUGGEST_COLUMN_SHORTCUT_ID: 'suggest_shortcut_id' });
  def(SEARCH, 'getSearchableInfo', `(${COMPONENT})Landroid/app/SearchableInfo;`, (r, _m, [, component]) => { if (nullish(component)) npe(r); return null; });
  def(SEARCH, 'getGlobalSearchActivity', `()${COMPONENT}`, () => null);
  def(SEARCH, 'isVisible', '()Z', () => 0);
  def(SEARCH, 'stopSearch', '()V', () => {});
  def(SEARCH, 'setOnDismissListener', '(Landroid/app/SearchManager$OnDismissListener;)V', () => {});
  def(SEARCH, 'setOnCancelListener', '(Landroid/app/SearchManager$OnCancelListener;)V', () => {});

  // ---- PrintManager: no print service is installed, so a print request cannot start a job
  const PRINT = service('print', 'Landroid/print/PrintManager;');
  strings(PRINT, { PRINT_SPOOLER_PACKAGE_NAME: 'com.android.printspooler' });
  def(PRINT, 'getPrintJobs', `()${LIST}`, r => emptyList(r));
  def(PRINT, 'print', `(${STRING}Landroid/print/PrintDocumentAdapter;Landroid/print/PrintAttributes;)Landroid/print/PrintJob;`, (r, _m, [, name, adapter]) => {
    if (nullish(name)) iae(r, 'printJobName cannot be empty'); if (text(r, name) === '') iae(r, 'printJobName cannot be empty'); if (nullish(adapter)) iae(r, 'documentAdapter cannot be null');
    return null;   // PrintManager.print: "null on failure" -- the print service component is not available
  });

  // ---- AccountManager: the device's accounts and the authenticators its packages declare (src/account-store.js)
  const ACCOUNT_MANAGER = service('account', 'Landroid/accounts/AccountManager;'), AUTHENTICATOR = 'Landroid/accounts/AuthenticatorDescription;';
  strings(ACCOUNT_MANAGER, { KEY_ACCOUNT_NAME: 'authAccount', KEY_ACCOUNT_TYPE: 'accountType', KEY_AUTHTOKEN: 'authtoken', KEY_INTENT: 'intent', KEY_PASSWORD: 'password', KEY_ACCOUNTS: 'accounts', KEY_ERROR_CODE: 'errorCode', KEY_ERROR_MESSAGE: 'errorMessage',
    KEY_ANDROID_PACKAGE_NAME: 'androidPackageName', KEY_ACCOUNT_ACCESS_ID: 'accountAccessId', KEY_CALLER_UID: 'callerUid', KEY_CALLER_PID: 'callerPid', KEY_USERDATA: 'userdata', KEY_BOOLEAN_RESULT: 'booleanResult', KEY_LAST_AUTHENTICATED_TIME: 'lastAuthenticatedTime',
    LOGIN_ACCOUNTS_CHANGED_ACTION: 'android.accounts.LOGIN_ACCOUNTS_CHANGED', ACTION_AUTHENTICATOR_INTENT: 'android.accounts.AccountAuthenticator', AUTHENTICATOR_META_DATA_NAME: 'android.accounts.AccountAuthenticator', AUTHENTICATOR_ATTRIBUTES_NAME: 'account-authenticator' });
  consts(ACCOUNT_MANAGER, { ERROR_CODE_REMOTE_EXCEPTION: 1, ERROR_CODE_NETWORK_ERROR: 3, ERROR_CODE_CANCELED: 4, ERROR_CODE_INVALID_RESPONSE: 5, ERROR_CODE_UNSUPPORTED_OPERATION: 6, ERROR_CODE_BAD_ARGUMENTS: 7, ERROR_CODE_BAD_REQUEST: 8, ERROR_CODE_BAD_AUTHENTICATION: 9,
    ERROR_CODE_USER_RESTRICTED: 100, ERROR_CODE_MANAGEMENT_DISABLED_FOR_ACCOUNT_TYPE: 101, VISIBILITY_UNDEFINED: 0, VISIBILITY_VISIBLE: 1, VISIBILITY_USER_MANAGED_VISIBLE: 2, VISIBILITY_NOT_VISIBLE: 3, VISIBILITY_USER_MANAGED_NOT_VISIBLE: 4 });
  def(ACCOUNT_MANAGER, 'get', `(${CONTEXT_T})Landroid/accounts/AccountManager;`, (r, _m, [context]) => { if (nullish(context)) npe(r, 'context is null'); return call(r, context, CONTEXT_T, 'getSystemService', [STRING], OBJECT, ['account']); }, { static: true });
  const LISTENER = 'Landroid/accounts/OnAccountsUpdateListener;';
  /** The package a call comes from (Binder.getCallingUid of AccountManagerService): a companion's code on the stack (or its transaction) is that companion, else the app. */
  let lastRuntime = null;
  const callerEntry = r => (lastRuntime = r, platform.packages?.multi ? platform.packages.callingIdentity(r).entry : null) ?? platform.packages?.main ?? { name: pkg(), manifest: platform.manifest, main: true };
  const gcListeners = gcRoot(new Set());   // the registered listeners stay alive while registered, as the service holds them
  const accounts = () => platform.accounts ??= createAccountStore({
    packages: () => [{ entry: platform.packages?.main ?? { name: pkg(), manifest: platform.manifest }, environment: () => platform.resources },
      ...(platform.packages?.companions?.() ?? []).map(entry => ({ entry, environment: () => platform.packages.resourcesEnvironment(entry) }))],
    sameSigners: (a, b) => { const registry = platform.packages, x = registry?.byName?.(a), y = registry?.byName?.(b); try { return !!(x && y && registry.sameSigners?.(lastRuntime, x, y)); } catch { return false; } },
    record: line => lastRuntime?.record?.(line) });
  platform.accountStore = accounts;
  const field = (r, account, name) => { const value = r.readInstanceField?.(account, `${ACCOUNT}->${name}:${STRING}`) ?? r.object(account).fields?.get(`${ACCOUNT}->${name}:${STRING}`); return nullish(value) ? null : text(r, value); };
  const accountOf = (r, account) => { if (nullish(account)) iae(r, 'account is null'); return { name: field(r, account, 'name'), type: field(r, account, 'type') }; };
  const newAccount = (r, a) => construct(r, ACCOUNT, [STRING, STRING], [a.name, a.type]);
  const callerOptions = (r, entry) => ({ targetSdk: Number(entry.manifest?.usesSdk?.targetSdkVersion ?? platform.targetSdk ?? 33), getAccounts: entry.main !== false && holds(r, 'android.permission.GET_ACCOUNTS'), privileged: entry.main !== false && holds(r, 'android.permission.GET_ACCOUNTS_PRIVILEGED') });
  const visibleAccounts = (r, type = null, packageName = null) => {
    const entry = packageName ? (platform.packages?.byName?.(packageName) ?? callerEntry(r)) : callerEntry(r);
    return accounts().accounts.filter(a => (type === null || a.type === type) && accounts().visibleTo(a, entry.name, callerOptions(r, entry)));
  };
  /** The authenticator's packages only: "uid N cannot <verb> accounts of type: T", the service's SecurityException. */
  const ownerOnly = (r, a, verb) => { const entry = callerEntry(r); if (!accounts().owns(entry.name, a.type)) denied(r, `uid ${entry.uid ?? uid()} cannot ${verb} accounts of type: ${a.type ?? ''}`); return entry; };
  const changed = r => {   // LOGIN_ACCOUNTS_CHANGED: the registered OnAccountsUpdateListeners hear the accounts they may see, on the main Looper
    for (const { listener, type, owner } of accounts().listeners) {
      platform.queueTask(() => { const list = accounts().accounts.filter(a => (type === null || type.includes(a.type)) && accounts().visibleTo(a, owner.name, callerOptions(r, owner))); call(r, listener, LISTENER, 'onAccountsUpdated', [`[${ACCOUNT}`], 'V', [array(r, ACCOUNT, list.map(a => newAccount(r, a)))]); }, 0, [listener]);
    }
  };
  def(ACCOUNT_MANAGER, 'getAccounts', `()[${ACCOUNT}`, r => array(r, ACCOUNT, visibleAccounts(r).map(a => newAccount(r, a))));
  def(ACCOUNT_MANAGER, 'getAccountsByType', `(${STRING})[${ACCOUNT}`, (r, _m, [, type]) => array(r, ACCOUNT, visibleAccounts(r, nullish(type) ? null : text(r, type)).map(a => newAccount(r, a))));
  def(ACCOUNT_MANAGER, 'getAccountsByTypeForPackage', `(${STRING}${STRING})[${ACCOUNT}`, (r, _m, [, type, packageName]) => { const name = requireText(r, packageName, 'packageName'); return array(r, ACCOUNT, visibleAccounts(r, nullish(type) ? null : text(r, type), name).map(a => newAccount(r, a))); });
  def(ACCOUNT_MANAGER, 'getAuthenticatorTypes', `()[${AUTHENTICATOR}`, r => array(r, AUTHENTICATOR, []));
  const known = (r, a) => accounts().find(a.name, a.type);
  def(ACCOUNT_MANAGER, 'addAccountExplicitly', `(${ACCOUNT}${STRING}${BUNDLE})Z`, (r, _m, [, account, password, extras]) => {
    const a = accountOf(r, account); ownerOnly(r, a, 'explicitly add');
    const data = new Map();
    if (!nullish(extras)) { const keys = call(r, call(r, extras, BUNDLE, 'keySet', [], 'Ljava/util/Set;'), 'Ljava/util/Set;', 'toArray', [], `[${OBJECT}`); for (const key of r.array(keys).elements) { const value = call(r, extras, BUNDLE, 'getString', [STRING], STRING, [key]); data.set(text(r, key), nullish(value) ? null : text(r, value)); } }
    if (!a.name || !a.type || !accounts().add(a.name, a.type, nullish(password) ? null : text(r, password), data)) return 0;
    r.record(`ACCOUNTS added an account of type ${a.type} (authenticator ${accounts().authenticatorFor(a.type)?.packageName})`);
    changed(r); return 1;
  });
  def(ACCOUNT_MANAGER, 'removeAccountExplicitly', `(${ACCOUNT})Z`, (r, _m, [, account]) => { const a = accountOf(r, account); ownerOnly(r, a, 'explicitly remove'); const removed = accounts().remove(a.name, a.type); if (removed) changed(r); return removed ? 1 : 0; });
  def(ACCOUNT_MANAGER, 'getPassword', `(${ACCOUNT})${STRING}`, (r, _m, [, account]) => { const a = accountOf(r, account); ownerOnly(r, a, 'get secrets for'); return known(r, a)?.password ?? null; });
  def(ACCOUNT_MANAGER, 'setPassword', `(${ACCOUNT}${STRING})V`, (r, _m, [, account, password]) => { const a = accountOf(r, account); ownerOnly(r, a, 'set secrets for'); const stored = known(r, a); if (stored) { stored.password = nullish(password) ? null : text(r, password); stored.tokens.clear(); } });
  def(ACCOUNT_MANAGER, 'clearPassword', `(${ACCOUNT})V`, (r, _m, [, account]) => { const a = accountOf(r, account); ownerOnly(r, a, 'clear passwords for'); const stored = known(r, a); if (stored) { stored.password = null; stored.tokens.clear(); } });
  def(ACCOUNT_MANAGER, 'getUserData', `(${ACCOUNT}${STRING})${STRING}`, (r, _m, [, account, key]) => { const a = accountOf(r, account); if (nullish(key)) iae(r, 'key is null'); ownerOnly(r, a, 'get user data for'); return known(r, a)?.userData.get(text(r, key)) ?? null; });
  def(ACCOUNT_MANAGER, 'setUserData', `(${ACCOUNT}${STRING}${STRING})V`, (r, _m, [, account, key, value]) => { const a = accountOf(r, account); if (nullish(key)) iae(r, 'key is null'); ownerOnly(r, a, 'set user data for'); const stored = known(r, a); if (stored) { if (nullish(value)) stored.userData.delete(text(r, key)); else stored.userData.set(text(r, key), text(r, value)); } });
  def(ACCOUNT_MANAGER, 'peekAuthToken', `(${ACCOUNT}${STRING})${STRING}`, (r, _m, [, account, tokenType]) => { const a = accountOf(r, account); if (nullish(tokenType)) iae(r, 'authTokenType is null'); ownerOnly(r, a, 'peek authtokens of'); return known(r, a)?.tokens.get(text(r, tokenType)) ?? null; });
  def(ACCOUNT_MANAGER, 'setAuthToken', `(${ACCOUNT}${STRING}${STRING})V`, (r, _m, [, account, tokenType, token]) => { const a = accountOf(r, account); if (nullish(tokenType)) iae(r, 'authTokenType is null'); ownerOnly(r, a, 'set authtokens for'); const stored = known(r, a); if (stored) { if (nullish(token)) stored.tokens.delete(text(r, tokenType)); else stored.tokens.set(text(r, tokenType), text(r, token)); } });
  def(ACCOUNT_MANAGER, 'invalidateAuthToken', `(${STRING}${STRING})V`, (r, _m, [, type, token]) => {
    if (nullish(type)) iae(r, 'accountType is null');
    if (nullish(token)) return;
    const kind = text(r, type), value = text(r, token);
    for (const stored of accounts().accounts) if (stored.type === kind) for (const [name, cached] of [...stored.tokens]) if (cached === value) stored.tokens.delete(name);
  });
  def(ACCOUNT_MANAGER, 'setAccountVisibility', `(${ACCOUNT}${STRING}I)Z`, (r, _m, [, account, packageName, visibility]) => { const a = accountOf(r, account); const name = requireText(r, packageName, 'packageName'); ownerOnly(r, a, 'set visibility of'); const stored = known(r, a); if (!stored) return 0; stored.visibility.set(name, visibility | 0); changed(r); return 1; });
  def(ACCOUNT_MANAGER, 'getAccountVisibility', `(${ACCOUNT}${STRING})I`, (r, _m, [, account, packageName]) => {
    const a = accountOf(r, account), name = requireText(r, packageName, 'packageName'), entry = callerEntry(r);
    if (entry.name !== name) ownerOnly(r, a, 'get visibility of');
    const stored = known(r, a); if (!stored) return 0;
    if (name.startsWith('android:accounts:')) return stored.visibility.get(name) ?? 0;
    const target = platform.packages?.byName?.(name) ?? entry;
    return accounts().visibleTo(stored, name, callerOptions(r, target)) ? (stored.visibility.get(name) === 2 ? 2 : 1) : (stored.visibility.get(name) === 4 ? 4 : 3);
  });
  def(ACCOUNT_MANAGER, 'addOnAccountsUpdatedListener', `(${LISTENER}${HANDLER}Z)V`, (r, _m, [, listener, , immediately]) => {
    if (nullish(listener)) iae(r, 'the listener is null');
    const owner = callerEntry(r); accounts().listeners.push({ listener, type: null, owner }); gcListeners.add(listener);
    if (immediately === 1) platform.queueTask(() => call(r, listener, LISTENER, 'onAccountsUpdated', [`[${ACCOUNT}`], 'V', [array(r, ACCOUNT, visibleAccounts(r).map(a => newAccount(r, a)))]), 0, [listener]);
  });
  def(ACCOUNT_MANAGER, 'addOnAccountsUpdatedListener', `(${LISTENER}${HANDLER}Z[${STRING})V`, (r, _m, [, listener, , immediately, types]) => {
    if (nullish(listener)) iae(r, 'the listener is null');
    const owner = callerEntry(r), wanted = nullish(types) ? null : r.array(types).elements.map(t => text(r, t));
    accounts().listeners.push({ listener, type: wanted, owner }); gcListeners.add(listener);
    if (immediately === 1) platform.queueTask(() => call(r, listener, LISTENER, 'onAccountsUpdated', [`[${ACCOUNT}`], 'V', [array(r, ACCOUNT, visibleAccounts(r).filter(a => wanted === null || wanted.includes(a.type)).map(a => newAccount(r, a)))]), 0, [listener]);
  });
  def(ACCOUNT_MANAGER, 'removeOnAccountsUpdatedListener', `(${LISTENER})V`, (r, _m, [, listener]) => {
    if (nullish(listener)) iae(r, 'listener is null');
    const list = accounts().listeners, at = list.findIndex(item => item.listener === listener || (item.listener?.ref !== undefined && item.listener?.ref === listener?.ref));
    if (at < 0) { r.record?.('LOG W AccountManager: Listener was not previously added'); return; }
    list.splice(at, 1); gcListeners.delete(listener);
  });

  // ---- SystemHealthManager: a snapshot of this uid only, with no recorded measurements
  const HEALTH = service('systemhealth', 'Landroid/os/health/SystemHealthManager;'), HEALTH_STATS = 'Landroid/os/health/HealthStats;';
  type(HEALTH_STATS, OBJECT, [], { allocatable: true });
  consts(HEALTH_STATS, { TYPE_UID: 1, TYPE_PROCESS: 2, TYPE_PACKAGE: 3, TYPE_PID: 4, TYPE_SERVICE: 5 });
  const snapshot = r => r.allocate(HEALTH_STATS);
  def(HEALTH, 'takeMyUidSnapshot', `()${HEALTH_STATS}`, r => snapshot(r));
  def(HEALTH, 'takeUidSnapshot', `(I)${HEALTH_STATS}`, (r, _m, [, id]) => { if (id !== uid()) enforce(r, 'android.permission.BATTERY_STATS'); return snapshot(r); });
  def(HEALTH, 'takeUidSnapshots', `([I)[${HEALTH_STATS}`, (r, _m, [, ids]) => {
    const wanted = r.array(ids).elements; if (wanted.some(id => id !== uid())) enforce(r, 'android.permission.BATTERY_STATS');
    return array(r, HEALTH_STATS, wanted.map(() => snapshot(r)));
  });
  // The snapshot records no measurement, so every key family is empty and each accessor behaves as android.os.health.HealthStats (AOSP android-13.0.0_r1) does for an
  // absent key: has* false, *KeyCount 0, get* by key throws IndexOutOfBoundsException "Bad <kind> key dataType=<type> key=<key>", *KeyAt indexes an empty array.
  // The data type is HealthKeys.Constants' clazz.getSimpleName() of the uid snapshot's constants.
  const HEALTH_DATA_TYPE = 'UidHealthStats';
  def(HEALTH_STATS, 'getDataType', '()Ljava/lang/String;', r => r.javaString(HEALTH_DATA_TYPE));
  for (const name of ['hasMeasurement', 'hasMeasurements', 'hasTimer', 'hasTimers', 'hasStats']) def(HEALTH_STATS, name, '(I)Z', () => 0);
  for (const name of ['getMeasurementKeyCount', 'getTimerKeyCount', 'getStatsKeyCount', 'getTimersKeyCount', 'getMeasurementsKeyCount']) def(HEALTH_STATS, name, '()I', () => 0);
  for (const name of ['getMeasurementKeyAt', 'getTimerKeyAt', 'getStatsKeyAt', 'getTimersKeyAt', 'getMeasurementsKeyAt']) def(HEALTH_STATS, name, '(I)I', (r, _m, [, index]) => r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', `length=0; index=${index}`));
  const badKey = (kind, key) => r => r.throwJava('Ljava/lang/IndexOutOfBoundsException;', `Bad ${kind} key dataType=${HEALTH_DATA_TYPE} key=${key}`);
  for (const [name, signature, kind] of [['getMeasurement', '(I)J', 'measurement'], ['getTimer', '(I)Landroid/os/health/TimerStat;', 'timer'], ['getTimerCount', '(I)I', 'timer'], ['getTimerTime', '(I)J', 'timer'],
    ['getStats', '(I)Ljava/util/Map;', 'stats'], ['getTimers', '(I)Ljava/util/Map;', 'timers'], ['getMeasurements', '(I)Ljava/util/Map;', 'measurements']]) def(HEALTH_STATS, name, signature, (r, _m, [, key]) => badKey(kind, key)(r));

  // ---- StatusBarManager: the panel can only be opened by holders of EXPAND_STATUS_BAR, and the lab has no shade to expand
  const STATUS_BAR = service('statusbar', 'Landroid/app/StatusBarManager;');
  for (const name of ['expandNotificationsPanel', 'expandSettingsPanel', 'collapsePanels']) def(STATUS_BAR, name, '()V', r => enforce(r, 'android.permission.EXPAND_STATUS_BAR'));
  def(STATUS_BAR, 'disable', '(I)V', r => enforce(r, 'android.permission.STATUS_BAR'));
  consts(STATUS_BAR, { DISABLE_NONE: 0, DISABLE_EXPAND: 65536, DISABLE_NOTIFICATION_ICONS: 131072, DISABLE_NOTIFICATION_ALERTS: 262144, DISABLE_HOME: 2097152, DISABLE_RECENT: 16777216, DISABLE_BACK: 4194304, DISABLE_SEARCH: 33554432 });

  // ---- MediaProjectionManager: screen capture needs the system consent activity, which the lab does not have
  const PROJECTION = service('media_projection', 'Landroid/media/projection/MediaProjectionManager;'), MEDIA_PROJECTION = 'Landroid/media/projection/MediaProjection;';
  def(PROJECTION, 'createScreenCaptureIntent', `()${INTENT}`, r => {
    const intent = construct(r, INTENT); const component = construct(r, COMPONENT, [STRING, STRING], ['com.android.systemui', 'com.android.systemui.media.MediaProjectionPermissionActivity']);
    call(r, intent, INTENT, 'setComponent', [COMPONENT], INTENT, [component]); return intent;
  });
  def(PROJECTION, 'getMediaProjection', `(I${INTENT})${MEDIA_PROJECTION}`, (r, _m, [, resultCode, data]) => { if (nullish(data)) npe(r); void resultCode; return null; });   // no projection token in the result: MediaProjectionManager returns null

  // ---- LocaleManager (per-app languages)
  const LOCALE = service('locale', 'Landroid/app/LocaleManager;'), appLocaleTables = new WeakMap();
  // the LocaleList an app set is kept in a collector root (a WeakMap's values are invisible to the collector and the list is handed out again)
  const appLocales = { get: r => appLocaleTables.get(r)?.get('locales'), set: (r, value) => { (appLocaleTables.get(r) ?? appLocaleTables.set(r, gcRoot(new Map())).get(r)).set('locales', value); } };
  def(LOCALE, 'getApplicationLocales', `()${LOCALE_LIST}`, r => appLocales.get(r) ?? callStatic(r, LOCALE_LIST, 'getEmptyLocaleList', [], LOCALE_LIST));
  def(LOCALE, 'getApplicationLocales', `(${STRING})${LOCALE_LIST}`, (r, _m, [, packageName]) => {
    if (requireText(r, packageName, 'appPackageName') !== pkg()) enforce(r, 'android.permission.READ_APP_SPECIFIC_LOCALES');
    return appLocales.get(r) ?? callStatic(r, LOCALE_LIST, 'getEmptyLocaleList', [], LOCALE_LIST);
  });
  def(LOCALE, 'setApplicationLocales', `(${LOCALE_LIST})V`, (r, _m, [, locales]) => { if (nullish(locales)) npe(r, 'locales can not be null'); appLocales.set(r, locales); });
  def(LOCALE, 'getSystemLocales', `()${LOCALE_LIST}`, r => callStatic(r, LOCALE_LIST, 'getDefault', [], LOCALE_LIST));
  kit.root(visit => { void visit; });

  // ---- GameManager: the app is not a game, so game mode is unsupported
  const GAME = service('game', 'Landroid/app/GameManager;');
  consts(GAME, { GAME_MODE_UNSUPPORTED: 0, GAME_MODE_STANDARD: 1, GAME_MODE_PERFORMANCE: 2, GAME_MODE_BATTERY: 3, GAME_MODE_CUSTOM: 4 });
  def(GAME, 'getGameMode', '()I', () => 0);

  // ---- RestrictionsManager: no restrictions provider and no managed configuration
  const RESTRICTIONS = service('restrictions', 'Landroid/content/RestrictionsManager;');
  strings(RESTRICTIONS, { ACTION_PERMISSION_RESPONSE_RECEIVED: 'android.content.action.PERMISSION_RESPONSE_RECEIVED', ACTION_REQUEST_LOCAL_APPROVAL: 'android.content.action.REQUEST_LOCAL_APPROVAL', EXTRA_PACKAGE_NAME: 'android.content.extra.PACKAGE_NAME', EXTRA_REQUEST_TYPE: 'android.content.extra.REQUEST_TYPE',
    EXTRA_REQUEST_ID: 'android.content.extra.REQUEST_ID', EXTRA_REQUEST_BUNDLE: 'android.content.extra.REQUEST_BUNDLE', EXTRA_RESPONSE_BUNDLE: 'android.content.extra.RESPONSE_BUNDLE', REQUEST_KEY_DATA: 'android.request.data', REQUEST_KEY_DEVICE_NAME: 'android.request.device', REQUEST_KEY_ID: 'android.request.id',
    REQUEST_KEY_MESSAGE: 'android.request.mesg', REQUEST_KEY_NEW_REQUEST: 'android.request.new_request', REQUEST_KEY_APPROVE_LABEL: 'android.request.approve_label', REQUEST_KEY_DENY_LABEL: 'android.request.deny_label', REQUEST_TYPE_APPROVAL: 'android.request.type.approval',
    RESPONSE_KEY_ERROR_CODE: 'android.response.errorcode', RESPONSE_KEY_ERROR_MESSAGE: 'android.response.errormsg', RESPONSE_KEY_RESPONSE_TIMESTAMP: 'android.response.timestamp', RESPONSE_KEY_RESULT: 'android.response.result' });
  consts(RESTRICTIONS, { RESULT_APPROVED: 0, RESULT_DENIED: 1, RESULT_NO_RESPONSE: 2, RESULT_UNKNOWN_REQUEST: 3, RESULT_ERROR: 4, RESULT_ERROR_BAD_REQUEST: 1, RESULT_ERROR_NETWORK: 2, RESULT_ERROR_INTERNAL: 3 });
  def(RESTRICTIONS, 'getApplicationRestrictions', `()${BUNDLE}`, r => construct(r, BUNDLE));
  def(RESTRICTIONS, 'hasRestrictionsProvider', '()Z', () => 0);
  def(RESTRICTIONS, 'getApplicationRestrictionsPerAdmin', `()${LIST}`, r => emptyList(r));
  def(RESTRICTIONS, 'getManifestRestrictions', `(${STRING})${LIST}`, (r, _m, [, packageName]) => {
    const name = requireText(r, packageName, 'packageName');
    if (name !== pkg()) r.throwJava('Ljava/lang/IllegalArgumentException;', `No such package ${name}`);
    const declared = (platform.manifest?.application?.metaData ?? []).some(entry => entry.name === 'android.content.APP_RESTRICTIONS');
    if (declared) r.throwJava('Ljava/lang/UnsupportedOperationException;', 'Manifest restrictions (android.content.APP_RESTRICTIONS) are not parsed by the lab');
    return emptyList(r);
  });
  def(RESTRICTIONS, 'createLocalApprovalIntent', `()${INTENT}`, r => ise(r, 'The restrictions provider is not available'));
  def(RESTRICTIONS, 'requestPermission', `(${STRING}${STRING}${PBUNDLE})V`, (r, _m, [, , id]) => { if (nullish(id)) iae(r, 'requestId cannot be null'); ise(r, 'No restrictions provider is available'); });
  def(RESTRICTIONS, 'notifyPermissionResponse', `(${STRING}${PBUNDLE})V`, (r, _m, [, packageName]) => { requireText(r, packageName, 'packageName'); enforce(r, 'android.permission.MANAGE_USERS'); });

  // ---- DropBoxManager: entries are accepted into a store the app cannot read back
  const DROPBOX = service('dropbox', 'Landroid/os/DropBoxManager;');
  strings(DROPBOX, { ACTION_DROPBOX_ENTRY_ADDED: 'android.intent.action.DROPBOX_ENTRY_ADDED', EXTRA_TAG: 'tag', EXTRA_TIME: 'time' });
  consts(DROPBOX, { IS_EMPTY: 1, IS_TEXT: 2, IS_GZIPPED: 4 });
  const tagOf = (r, tag) => { if (nullish(tag)) npe(r); return text(r, tag); };
  def(DROPBOX, 'addText', `(${STRING}${STRING})V`, (r, _m, [, tag, data]) => { tagOf(r, tag); void data; });
  def(DROPBOX, 'addData', `(${STRING}[BI)V`, (r, _m, [, tag, data]) => { tagOf(r, tag); if (nullish(data)) npe(r, 'data == null'); });
  def(DROPBOX, 'addFile', `(${STRING}Ljava/io/File;I)V`, (r, _m, [, tag, file]) => { tagOf(r, tag); if (nullish(file)) npe(r, 'file == null'); });
  def(DROPBOX, 'isTagEnabled', `(${STRING})Z`, (r, _m, [, tag]) => { tagOf(r, tag); return 1; });
  def(DROPBOX, 'getNextEntry', `(${STRING}J)Landroid/os/DropBoxManager$Entry;`, (r, _m, [, tag]) => { tagOf(r, tag); enforce(r, 'android.permission.READ_LOGS'); return null; });

  // ---- TextServicesManager: no spell checker service is installed
  const TEXT_SERVICES = service('textservices', 'Landroid/view/textservice/TextServicesManager;');
  def(TEXT_SERVICES, 'newSpellCheckerSession', `(${BUNDLE}Ljava/util/Locale;Landroid/view/textservice/SpellCheckerSession$SpellCheckerSessionListener;Z)Landroid/view/textservice/SpellCheckerSession;`, (r, _m, [, , locale, listener]) => {
    if (nullish(listener)) npe(r, 'listener must not be null');
    if (nullish(locale)) iae(r, 'locale must not be null (a spell checker session needs a locale when referToSpellCheckerLanguageSettings is false)') ;
    return null;   // isSpellCheckerEnabled() is false without a spell checker service: "null if the spell checker is disabled"
  });
  def(TEXT_SERVICES, 'isSpellCheckerEnabled', '()Z', () => 0);
  def(TEXT_SERVICES, 'getEnabledSpellCheckerInfos', `()${LIST}`, r => emptyList(r));
  def(TEXT_SERVICES, 'getCurrentSpellCheckerInfo', '()Landroid/view/textservice/SpellCheckerInfo;', () => null);

  // ---- BlobStoreManager: this app has stored no blobs and holds no leases
  const BLOB = service('blob_store', 'Landroid/app/blob/BlobStoreManager;');
  def(BLOB, 'getLeasedBlobs', `()${LIST}`, r => emptyList(r));
  def(BLOB, 'releaseAllLeases', '()V', () => {});

  // ---- BugreportManager: bug reports need the DUMP permission, which only the system and shell hold
  const BUGREPORT = service('bugreport', 'Landroid/os/BugreportManager;');
  def(BUGREPORT, 'startBugreport', '(Landroid/os/ParcelFileDescriptor;Landroid/os/ParcelFileDescriptor;Landroid/os/BugreportParams;Ljava/util/concurrent/Executor;Landroid/os/BugreportManager$BugreportCallback;)V', (r, _m, [, bugreport, , params, executor, callback]) => {
    if (nullish(bugreport) || nullish(params) || nullish(executor) || nullish(callback)) npe(r);
    enforce(r, 'android.permission.DUMP', `Permission Denial: can't start bugreport from pid=${platform.virtualProcess?.pid ?? 0}, uid=${uid()} requires android.permission.DUMP`);
  });
  def(BUGREPORT, 'cancelBugreport', '()V', r => enforce(r, 'android.permission.DUMP'));

  kit.byClass.set('Landroid/net/wifi/aware/WifiAwareManager;', 'wifiaware'); kit.byClass.set('Landroid/net/wifi/rtt/WifiRttManager;', 'wifirtt');
  return kit.finish({ nullServices: NULL_SERVICES, getService: (r, name) => (NULL_SERVICES.includes(name) ? null : kit.getService(r, name)) });
}
