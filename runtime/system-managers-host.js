import { floatBits } from './host-contract.js?v=d8da3b335496';
import { createServiceKit, OBJECT, STRING, LIST } from './service-kit.js?v=d8da3b335496';

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
  const NULL_SERVICES = ['credential'];
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
  }));
  for (const [opString] of OPS) registry.staticField(APPOPS, `OPSTR_${opString.slice(8).toUpperCase()}`, STRING, () => opString);
  const opOf = (r, op) => { const name = requireText(r, op, 'op'); if (!OPS.has(name)) iae(r, `Unknown operation string: ${name}`); return name; };
  const checkPackage = (r, uidValue, packageName) => {
    const name = requireText(r, packageName, 'packageName');
    if (uidValue !== uid() || name !== pkg()) denied(r, `Package ${name} does not belong to ${uidValue}`);
  };
  const modeOf = (r, opString) => { const [permission, kind] = OPS.get(opString); return kind === 'always' ? ALLOWED : kind === 'special' ? DEFAULT : (permission && holds(r, permission)) ? ALLOWED : IGNORED; };
  const mustBeAllowed = (r, mode, opString) => { if (mode === ERRORED) denied(r, `uid ${uid()} does not have ${opString}.`); return mode; };
  for (const name of ['unsafeCheckOp', 'unsafeCheckOpRaw', 'unsafeCheckOpNoThrow', 'unsafeCheckOpRawNoThrow']) def(APPOPS, name, `(${STRING}I${STRING})I`, (r, _m, [, op, id, packageName]) => { const o = opOf(r, op); checkPackage(r, id, packageName); return modeOf(r, o); });
  for (const name of ['checkOp', 'checkOpNoThrow']) def(APPOPS, name, `(${STRING}I${STRING})I`, (r, _m, [, op, id, packageName]) => { const o = opOf(r, op); checkPackage(r, id, packageName); return name === 'checkOp' ? mustBeAllowed(r, modeOf(r, o), o) : modeOf(r, o); });
  for (const name of ['noteOp', 'noteOpNoThrow']) {
    def(APPOPS, name, `(${STRING}I${STRING})I`, (r, _m, [, op, id, packageName]) => { const o = opOf(r, op); checkPackage(r, id, packageName); return name === 'noteOp' ? mustBeAllowed(r, modeOf(r, o), o) : modeOf(r, o); });
    def(APPOPS, name, `(${STRING}I${STRING}${STRING}${STRING})I`, (r, _m, [, op, id, packageName]) => { const o = opOf(r, op); checkPackage(r, id, packageName); return name === 'noteOp' ? mustBeAllowed(r, modeOf(r, o), o) : modeOf(r, o); });
  }
  for (const name of ['noteProxyOp', 'noteProxyOpNoThrow']) def(APPOPS, name, `(${STRING}${STRING}I${STRING}${STRING})I`, (r, _m, [, op, proxiedPackage, proxiedUid]) => { const o = opOf(r, op); checkPackage(r, proxiedUid, proxiedPackage); return name === 'noteProxyOp' ? mustBeAllowed(r, modeOf(r, o), o) : modeOf(r, o); });
  def(APPOPS, 'startOp', `(${STRING}I${STRING}${STRING}${STRING})I`, (r, _m, [, op, id, packageName]) => { const o = opOf(r, op); checkPackage(r, id, packageName); return mustBeAllowed(r, modeOf(r, o), o); });
  def(APPOPS, 'startOpNoThrow', `(${STRING}I${STRING}${STRING}${STRING})I`, (r, _m, [, op, id, packageName]) => { const o = opOf(r, op); checkPackage(r, id, packageName); return modeOf(r, o); });
  def(APPOPS, 'finishOp', `(${STRING}I${STRING}${STRING})V`, (r, _m, [, op, id, packageName]) => { opOf(r, op); checkPackage(r, id, packageName); });
  def(APPOPS, 'finishOp', `(${STRING}I${STRING})V`, (r, _m, [, op, id, packageName]) => { opOf(r, op); checkPackage(r, id, packageName); });
  def(APPOPS, 'checkPackage', `(I${STRING})V`, (r, _m, [, id, packageName]) => checkPackage(r, id, packageName));
  def(APPOPS, 'permissionToOp', `(${STRING})${STRING}`, (r, _m, [permission]) => { const name = requireText(r, permission, 'permission'); for (const [op, [p]] of OPS) if (p === name) return op; return null; }, { static: true });
  def(APPOPS, 'isOpActive', `(${STRING}I${STRING})Z`, (r, _m, [, op]) => { opOf(r, op); return 0; });
  def(APPOPS, 'isOperationActive', `(${STRING}I${STRING})Z`, (r, _m, [, op]) => { opOf(r, op); return 0; });
  def(APPOPS, 'startWatchingMode', `(${STRING}${STRING}Landroid/app/AppOpsManager$OnOpChangedListener;)V`, (r, _m, [, op, packageName, listener]) => { opOf(r, op); if (nullish(listener)) npe(r, 'callback'); void packageName; });
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

  // ---- TextClassificationManager: the manager and the classifier's lifecycle; the request/result classes are not part of the lab framework
  const TEXT_CLASSIFICATION = service('textclassification', 'Landroid/view/textclassifier/TextClassificationManager;'), CLASSIFIER = 'Landroid/view/textclassifier/TextClassifier;';
  const CLASSIFIER_IMPL = 'Landroid/view/textclassifier/TextClassifierImpl;';
  type(CLASSIFIER_IMPL, OBJECT, [CLASSIFIER], { allocatable: true }); type(CLASSIFIER, OBJECT, [], { allocatable: false });
  consts(CLASSIFIER, { WIDGET_TYPE_TEXTVIEW_BASE: 0 });
  strings(CLASSIFIER, { TYPE_UNKNOWN: '', TYPE_OTHER: 'other', TYPE_EMAIL: 'email', TYPE_PHONE: 'phone', TYPE_ADDRESS: 'address', TYPE_URL: 'url', TYPE_DATE: 'date', TYPE_DATE_TIME: 'datetime', TYPE_FLIGHT_NUMBER: 'flight' });
  const classifierState = new WeakMap();
  const classifierOf = r => { if (!classifierState.has(r)) classifierState.set(r, { object: null, destroyed: false, custom: null }); return classifierState.get(r); };
  def(TEXT_CLASSIFICATION, 'getTextClassifier', `()${CLASSIFIER}`, r => { const s = classifierOf(r); return s.custom ?? (s.object ??= r.allocate(CLASSIFIER_IMPL)); });
  def(TEXT_CLASSIFICATION, 'getTextClassifier', `(I)${CLASSIFIER}`, (r, _m, [, kind]) => { if (kind !== 0 && kind !== 1 && kind !== 2) iae(r, `Invalid TextClassifier type: ${kind}`); const s = classifierOf(r); return s.custom ?? (s.object ??= r.allocate(CLASSIFIER_IMPL)); });
  def(TEXT_CLASSIFICATION, 'setTextClassifier', `(${CLASSIFIER})V`, (r, _m, [, classifier]) => { classifierOf(r).custom = nullish(classifier) ? null : classifier; });
  def(CLASSIFIER_IMPL, 'isDestroyed', '()Z', (r) => (classifierOf(r).destroyed ? 1 : 0));
  def(CLASSIFIER_IMPL, 'destroy', '()V', (r) => { classifierOf(r).destroyed = true; });
  def(CLASSIFIER_IMPL, 'getMaxGenerateLinksTextLength', '()I', () => 0);

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
  def(WALLPAPER, 'forgetLoadedWallpaper', '()V', () => {});
  def(WALLPAPER, 'addOnColorsChangedListener', '(Landroid/app/WallpaperManager$OnColorsChangedListener;Landroid/os/Handler;)V', (r, _m, [, listener]) => { if (nullish(listener)) npe(r); });
  def(WALLPAPER, 'removeOnColorsChangedListener', '(Landroid/app/WallpaperManager$OnColorsChangedListener;)V', (r, _m, [, listener]) => { if (nullish(listener)) npe(r); });

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

  // ---- AccountManager: no authenticators, no accounts
  const ACCOUNT_MANAGER = service('account', 'Landroid/accounts/AccountManager;'), AUTHENTICATOR = 'Landroid/accounts/AuthenticatorDescription;';
  strings(ACCOUNT_MANAGER, { KEY_ACCOUNT_NAME: 'authAccount', KEY_ACCOUNT_TYPE: 'accountType', KEY_AUTHTOKEN: 'authtoken', KEY_INTENT: 'intent', KEY_PASSWORD: 'password', KEY_ACCOUNTS: 'accounts', KEY_ERROR_CODE: 'errorCode', KEY_ERROR_MESSAGE: 'errorMessage',
    KEY_ANDROID_PACKAGE_NAME: 'androidPackageName', KEY_ACCOUNT_ACCESS_ID: 'accountAccessId', KEY_CALLER_UID: 'callerUid', KEY_CALLER_PID: 'callerPid', KEY_USERDATA: 'userdata', KEY_BOOLEAN_RESULT: 'booleanResult', KEY_LAST_AUTHENTICATED_TIME: 'lastAuthenticatedTime',
    LOGIN_ACCOUNTS_CHANGED_ACTION: 'android.accounts.LOGIN_ACCOUNTS_CHANGED', ACTION_AUTHENTICATOR_INTENT: 'android.accounts.AccountAuthenticator', AUTHENTICATOR_META_DATA_NAME: 'android.accounts.AccountAuthenticator', AUTHENTICATOR_ATTRIBUTES_NAME: 'account-authenticator' });
  consts(ACCOUNT_MANAGER, { ERROR_CODE_REMOTE_EXCEPTION: 1, ERROR_CODE_NETWORK_ERROR: 3, ERROR_CODE_CANCELED: 4, ERROR_CODE_INVALID_RESPONSE: 5, ERROR_CODE_UNSUPPORTED_OPERATION: 6, ERROR_CODE_BAD_ARGUMENTS: 7, ERROR_CODE_BAD_REQUEST: 8, ERROR_CODE_BAD_AUTHENTICATION: 9,
    ERROR_CODE_USER_RESTRICTED: 100, ERROR_CODE_MANAGEMENT_DISABLED_FOR_ACCOUNT_TYPE: 101, VISIBILITY_UNDEFINED: 0, VISIBILITY_VISIBLE: 1, VISIBILITY_USER_MANAGED_VISIBLE: 2, VISIBILITY_NOT_VISIBLE: 3, VISIBILITY_USER_MANAGED_NOT_VISIBLE: 4 });
  def(ACCOUNT_MANAGER, 'get', `(${CONTEXT_T})Landroid/accounts/AccountManager;`, (r, _m, [context]) => { if (nullish(context)) npe(r, 'context is null'); return call(r, context, CONTEXT_T, 'getSystemService', [STRING], OBJECT, ['account']); }, { static: true });
  def(ACCOUNT_MANAGER, 'getAccounts', `()[${ACCOUNT}`, r => array(r, ACCOUNT, []));
  def(ACCOUNT_MANAGER, 'getAccountsByType', `(${STRING})[${ACCOUNT}`, r => array(r, ACCOUNT, []));
  def(ACCOUNT_MANAGER, 'getAccountsByTypeForPackage', `(${STRING}${STRING})[${ACCOUNT}`, (r, _m, [, , packageName]) => { requireText(r, packageName, 'packageName'); return array(r, ACCOUNT, []); });
  def(ACCOUNT_MANAGER, 'getAuthenticatorTypes', `()[${AUTHENTICATOR}`, r => array(r, AUTHENTICATOR, []));
  const accountType = (r, account) => { if (nullish(account)) npe(r, 'account is null'); return text(r, call(r, account, ACCOUNT, 'toString', [], STRING)); };
  const notManaged = (r, account, verb) => denied(r, `uid ${uid()} cannot ${verb} accounts of type: ${text(r, r.dispatch({ owner: ACCOUNT, name: 'hashCode', parameters: [], result: 'I', signature: '()I' }, [account], 'virtual') === 0 ? '' : accountTypeOf(r, account))}`);
  const accountTypeOf = (r, account) => text(r, r.readInstanceField?.(account, `${ACCOUNT}->type:${STRING}`) ?? r.object(account).fields.get(`${ACCOUNT}->type:${STRING}`));
  def(ACCOUNT_MANAGER, 'addAccountExplicitly', `(${ACCOUNT}${STRING}${BUNDLE})Z`, (r, _m, [, account]) => { accountType(r, account); notManaged(r, account, 'explicitly add'); });
  def(ACCOUNT_MANAGER, 'removeAccountExplicitly', `(${ACCOUNT})Z`, (r, _m, [, account]) => { accountType(r, account); notManaged(r, account, 'explicitly remove'); });
  def(ACCOUNT_MANAGER, 'getPassword', `(${ACCOUNT})${STRING}`, (r, _m, [, account]) => { accountType(r, account); notManaged(r, account, 'get secrets for'); });
  def(ACCOUNT_MANAGER, 'getUserData', `(${ACCOUNT}${STRING})${STRING}`, (r, _m, [, account, key]) => { accountType(r, account); if (nullish(key)) npe(r, 'key is null'); notManaged(r, account, 'get user data for'); });
  def(ACCOUNT_MANAGER, 'setPassword', `(${ACCOUNT}${STRING})V`, (r, _m, [, account]) => { accountType(r, account); notManaged(r, account, 'set secrets for'); });
  def(ACCOUNT_MANAGER, 'setUserData', `(${ACCOUNT}${STRING}${STRING})V`, (r, _m, [, account, key]) => { accountType(r, account); if (nullish(key)) npe(r, 'key is null'); notManaged(r, account, 'set user data for'); });
  def(ACCOUNT_MANAGER, 'peekAuthToken', `(${ACCOUNT}${STRING})${STRING}`, (r, _m, [, account, tokenType]) => { accountType(r, account); if (nullish(tokenType)) npe(r, 'authTokenType is null'); notManaged(r, account, 'get secrets for'); });
  def(ACCOUNT_MANAGER, 'invalidateAuthToken', `(${STRING}${STRING})V`, (r, _m, [, type]) => { if (nullish(type)) npe(r, 'accountType is null'); });
  def(ACCOUNT_MANAGER, 'addOnAccountsUpdatedListener', `(Landroid/accounts/OnAccountsUpdateListener;${HANDLER}Z)V`, (r, _m, [, listener, , immediately]) => {
    if (nullish(listener)) iae(r, 'the listener is null');
    if (immediately === 1) platform.queueTask(() => call(r, listener, 'Landroid/accounts/OnAccountsUpdateListener;', 'onAccountsUpdated', [`[${ACCOUNT}`], 'V', [array(r, ACCOUNT, [])]), 0, [listener]);
  });
  def(ACCOUNT_MANAGER, 'addOnAccountsUpdatedListener', `(Landroid/accounts/OnAccountsUpdateListener;${HANDLER}Z[${STRING})V`, (r, _m, [, listener, , immediately]) => {
    if (nullish(listener)) iae(r, 'the listener is null');
    if (immediately === 1) platform.queueTask(() => call(r, listener, 'Landroid/accounts/OnAccountsUpdateListener;', 'onAccountsUpdated', [`[${ACCOUNT}`], 'V', [array(r, ACCOUNT, [])]), 0, [listener]);
  });
  def(ACCOUNT_MANAGER, 'removeOnAccountsUpdatedListener', '(Landroid/accounts/OnAccountsUpdateListener;)V', (r, _m, [, listener]) => { if (nullish(listener)) iae(r, 'listener is null'); });

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
  def(HEALTH_STATS, 'getDataType', '()I', () => 1);
  def(HEALTH_STATS, 'getStatsKeyCount', '()I', () => 0);
  for (const name of ['hasMeasurement', 'hasMeasurements', 'hasTimer', 'hasTimers', 'hasStats', 'hasKey']) def(HEALTH_STATS, name, '(I)Z', () => 0);
  for (const [name, count] of [['getMeasurementKeyCount', 0], ['getTimerKeyCount', 0], ['getStatsKeyCount', 0]]) def(HEALTH_STATS, name, '()I', () => count);
  def(HEALTH_STATS, 'getMeasurement', '(I)J', (r, _m, [, key]) => r.throwJava('Ljava/lang/IndexOutOfBoundsException;', `Bad key: ${key}`));

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
  const LOCALE = service('locale', 'Landroid/app/LocaleManager;'), appLocales = new WeakMap();
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

  return kit.finish({ nullServices: NULL_SERVICES, getService: (r, name) => (NULL_SERVICES.includes(name) ? null : kit.getService(r, name)) });
}
