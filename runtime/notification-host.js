import { APKError } from './apk-error.js?v=00979d36e5ab';
import { createHostRegistry } from './host-contract.js?v=00979d36e5ab';

// android.app.Notification, Notification.Builder / Action / BigTextStyle / BigPictureStyle / InboxStyle, NotificationChannel and android.graphics.drawable.Icon (android-13.0.0_r1).
// None of these is in the framework DEX. The Builder is a recorder, exactly as in Notification.java: every setter stores a value and build() writes the public fields of
// Notification (icon, when, flags, contentIntent, priority...) and the standard `extras` Bundle (EXTRA_TITLE, EXTRA_TEXT, ...), which apps and NotificationCompat read back. Rendering is not
// modelled (the virtual device has no status bar; NotificationManager only records posts). Remote views, MessagingStyle, MediaStyle and bubbles fail explicitly.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', CHARS = 'Ljava/lang/CharSequence;', CONTEXT = 'Landroid/content/Context;', PENDING = 'Landroid/app/PendingIntent;', BUNDLE = 'Landroid/os/Bundle;', BITMAP = 'Landroid/graphics/Bitmap;', URI = 'Landroid/net/Uri;';
const NOTIFICATION = 'Landroid/app/Notification;', BUILDER = 'Landroid/app/Notification$Builder;', ACTION = 'Landroid/app/Notification$Action;', ACTION_BUILDER = 'Landroid/app/Notification$Action$Builder;', STYLE = 'Landroid/app/Notification$Style;';
const BIG_TEXT = 'Landroid/app/Notification$BigTextStyle;', BIG_PICTURE = 'Landroid/app/Notification$BigPictureStyle;', INBOX = 'Landroid/app/Notification$InboxStyle;', CHANNEL = 'Landroid/app/NotificationChannel;', ICON = 'Landroid/graphics/drawable/Icon;';
const EXTRAS = { EXTRA_TITLE: 'android.title', EXTRA_TITLE_BIG: 'android.title.big', EXTRA_TEXT: 'android.text', EXTRA_SUB_TEXT: 'android.subText', EXTRA_INFO_TEXT: 'android.infoText', EXTRA_SUMMARY_TEXT: 'android.summaryText', EXTRA_BIG_TEXT: 'android.bigText',
  EXTRA_TEXT_LINES: 'android.textLines', EXTRA_SMALL_ICON: 'android.icon', EXTRA_LARGE_ICON: 'android.largeIcon', EXTRA_LARGE_ICON_BIG: 'android.largeIcon.big', EXTRA_PICTURE: 'android.picture', EXTRA_PROGRESS: 'android.progress', EXTRA_PROGRESS_MAX: 'android.progressMax',
  EXTRA_PROGRESS_INDETERMINATE: 'android.progressIndeterminate', EXTRA_SHOW_CHRONOMETER: 'android.showChronometer', EXTRA_CHRONOMETER_COUNT_DOWN: 'android.chronometerCountDown', EXTRA_SHOW_WHEN: 'android.showWhen', EXTRA_TEMPLATE: 'android.template',
  EXTRA_BACKGROUND_IMAGE_URI: 'android.backgroundImageUri', EXTRA_PEOPLE_LIST: 'android.people.list', EXTRA_COMPACT_ACTIONS: 'android.compactActions', EXTRA_REMOTE_INPUT_HISTORY: 'android.remoteInputHistory', EXTRA_AUDIO_CONTENTS_URI: 'android.audioContents',
  EXTRA_CHANNEL_ID: 'android.intent.extra.CHANNEL_ID', EXTRA_NOTIFICATION_ID: 'android.intent.extra.NOTIFICATION_ID', EXTRA_NOTIFICATION_TAG: 'android.intent.extra.NOTIFICATION_TAG', EXTRA_SUBSTITUTE_APP_NAME: 'android.substName' };
const CATEGORIES = { CATEGORY_CALL: 'call', CATEGORY_MESSAGE: 'msg', CATEGORY_EMAIL: 'email', CATEGORY_EVENT: 'event', CATEGORY_PROMO: 'promo', CATEGORY_ALARM: 'alarm', CATEGORY_PROGRESS: 'progress', CATEGORY_SOCIAL: 'social', CATEGORY_ERROR: 'err',
  CATEGORY_TRANSPORT: 'transport', CATEGORY_SYSTEM: 'sys', CATEGORY_SERVICE: 'service', CATEGORY_RECOMMENDATION: 'recommendation', CATEGORY_STATUS: 'status', CATEGORY_REMINDER: 'reminder', CATEGORY_NAVIGATION: 'navigation', CATEGORY_WORKOUT: 'workout' };
const FLAGS = { FLAG_SHOW_LIGHTS: 1, FLAG_ONGOING_EVENT: 2, FLAG_INSISTENT: 4, FLAG_ONLY_ALERT_ONCE: 8, FLAG_AUTO_CANCEL: 16, FLAG_NO_CLEAR: 32, FLAG_FOREGROUND_SERVICE: 64, FLAG_HIGH_PRIORITY: 128, FLAG_LOCAL_ONLY: 256, FLAG_GROUP_SUMMARY: 512 };
const INTS = { DEFAULT_ALL: -1, DEFAULT_SOUND: 1, DEFAULT_VIBRATE: 2, DEFAULT_LIGHTS: 4, PRIORITY_DEFAULT: 0, PRIORITY_LOW: -1, PRIORITY_MIN: -2, PRIORITY_HIGH: 1, PRIORITY_MAX: 2, VISIBILITY_PRIVATE: 0, VISIBILITY_PUBLIC: 1, VISIBILITY_SECRET: -1,
  COLOR_DEFAULT: 0, GROUP_ALERT_ALL: 0, GROUP_ALERT_SUMMARY: 1, GROUP_ALERT_CHILDREN: 2, BADGE_ICON_NONE: 0, BADGE_ICON_SMALL: 1, BADGE_ICON_LARGE: 2, STREAM_DEFAULT: -1, FOREGROUND_SERVICE_DEFAULT: 0, FOREGROUND_SERVICE_IMMEDIATE: 1, FOREGROUND_SERVICE_DEFERRED: 2 };
const IMPORTANCE = { IMPORTANCE_UNSPECIFIED: -1000, IMPORTANCE_NONE: 0, IMPORTANCE_MIN: 1, IMPORTANCE_LOW: 2, IMPORTANCE_DEFAULT: 3, IMPORTANCE_HIGH: 4, IMPORTANCE_MAX: 5 };

export function createNotificationHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const text = (r, v) => v === null ? null : r.stringCharacters(v);
  for (const owner of [NOTIFICATION, BUILDER, ACTION, ACTION_BUILDER, STYLE, BIG_TEXT, BIG_PICTURE, INBOX, CHANNEL, ICON]) type(owner, OBJECT, [], { allocatable: true });
  for (const style of [BIG_TEXT, BIG_PICTURE, INBOX]) type(style, STYLE, [], { allocatable: true });
  registry.interfaces.set(NOTIFICATION, ['Landroid/os/Parcelable;']); registry.interfaces.set(CHANNEL, ['Landroid/os/Parcelable;']); registry.interfaces.set(ICON, ['Landroid/os/Parcelable;']);
  for (const [name, value] of Object.entries(EXTRAS)) registry.staticField(NOTIFICATION, name, STRING, () => value);
  for (const [name, value] of Object.entries(CATEGORIES)) registry.staticField(NOTIFICATION, name, STRING, () => value);
  for (const [name, value] of Object.entries(FLAGS)) registry.staticField(NOTIFICATION, name, 'I', () => value);
  for (const [name, value] of Object.entries(INTS)) registry.staticField(NOTIFICATION, name, 'I', () => value);
  for (const [name, value] of Object.entries(IMPORTANCE)) registry.staticField('Landroid/app/NotificationManager;', name, 'I', () => value);
  registry.staticField('Landroid/app/NotificationManager;', 'INTERRUPTION_FILTER_ALL', 'I', () => 1);

  // ---- Icon ------------------------------------------------------------------------------------------------------------------------------------------
  const iconState = (r, ref) => r.object(ref).icon ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Icon used before creation');
  const newIcon = (r, state) => { const ref = r.allocate(ICON); r.object(ref).icon = state; return ref; };
  def(ICON, 'createWithResource', `(${CONTEXT}I)${ICON}`, (r, _m, [context, id]) => { if (context === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Context must not be null.'); return newIcon(r, { type: 2, resId: id, pkg: text(r, call(r, context, CONTEXT, 'getPackageName', [], STRING)) }); }, { static: true });
  def(ICON, 'createWithResource', `(${STRING}I)${ICON}`, (r, _m, [pkg, id]) => { if (pkg === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Resource package name must not be null.'); return newIcon(r, { type: 2, resId: id, pkg: text(r, pkg) }); }, { static: true });
  for (const name of ['createWithBitmap', 'createWithAdaptiveBitmap']) def(ICON, name, `(${BITMAP})${ICON}`, (r, _m, [bitmap]) => { if (bitmap === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Bitmap must not be null.'); return newIcon(r, { type: name === 'createWithBitmap' ? 1 : 5, bitmap }); }, { static: true });
  def(ICON, 'createWithContentUri', `(${URI})${ICON}`, (r, _m, [uri]) => newIcon(r, { type: 4, uri }), { static: true });
  def(ICON, 'getType', '()I', (r, _m, [self]) => iconState(r, self).type);
  def(ICON, 'getResId', '()I', (r, _m, [self]) => { const s = iconState(r, self); if (s.type !== 2) r.throwJava('Ljava/lang/IllegalStateException;', 'called getResId() on ' + s.type); return s.resId; });
  def(ICON, 'getResPackage', `()${STRING}`, (r, _m, [self]) => { const s = iconState(r, self); if (s.type !== 2) r.throwJava('Ljava/lang/IllegalStateException;', 'called getResPackage() on ' + s.type); return s.pkg; });
  def(ICON, 'loadDrawable', `(${CONTEXT})Landroid/graphics/drawable/Drawable;`, (r, _m, [self, context]) => {
    const s = iconState(r, self), BD = 'Landroid/graphics/drawable/BitmapDrawable;';
    if (s.type === 2) { const resources = call(r, context, CONTEXT, 'getResources', [], 'Landroid/content/res/Resources;'); return r.dispatch({ owner: 'Landroid/content/res/Resources;', name: 'getDrawable', parameters: ['I', 'Landroid/content/res/Resources$Theme;'], result: 'Landroid/graphics/drawable/Drawable;', signature: '(ILandroid/content/res/Resources$Theme;)Landroid/graphics/drawable/Drawable;' }, [resources, s.resId, call(r, context, CONTEXT, 'getTheme', [], 'Landroid/content/res/Resources$Theme;')], 'virtual'); }
    if (s.type === 1 || s.type === 5) { const d = r.allocate(BD); r.dispatch({ owner: BD, name: '<init>', parameters: ['Landroid/content/res/Resources;', BITMAP], result: 'V', signature: `(Landroid/content/res/Resources;${BITMAP})V` }, [d, null, s.bitmap], 'direct'); return d; }
    throw new APKError(`Icon.loadDrawable for icon type ${s.type} is not implemented`, { kind: 'unsupported-icon' });
  });

  // ---- NotificationChannel -----------------------------------------------------------------------------------------------------------------------
  const channel = (r, ref) => r.object(ref).channel ?? r.throwJava('Ljava/lang/IllegalStateException;', 'NotificationChannel used before construction');
  def(CHANNEL, '<init>', `(${STRING}${CHARS}I)V`, (r, _m, [self, id, name, importance]) => {
    if (id === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    r.object(self).channel = { id: text(r, id), name: name, importance, description: null, group: null, showBadge: true, lights: false, lightColor: 0, vibration: false, vibrationPattern: null, sound: null, lockscreenVisibility: -1000, bypassDnd: false, canBubble: false };
  });
  def(CHANNEL, 'getId', `()${STRING}`, (r, _m, [self]) => channel(r, self).id); def(CHANNEL, 'getName', `()${CHARS}`, (r, _m, [self]) => channel(r, self).name); def(CHANNEL, 'setName', `(${CHARS})V`, (r, _m, [self, v]) => { channel(r, self).name = v; });
  def(CHANNEL, 'getImportance', '()I', (r, _m, [self]) => channel(r, self).importance); def(CHANNEL, 'setImportance', '(I)V', (r, _m, [self, v]) => { channel(r, self).importance = v; });
  for (const [property, field, code] of [['Description', 'description', STRING], ['Group', 'group', STRING], ['ShowBadge', 'showBadge', 'Z'], ['LightColor', 'lightColor', 'I'], ['LockscreenVisibility', 'lockscreenVisibility', 'I'], ['BypassDnd', 'bypassDnd', 'Z'], ['VibrationPattern', 'vibrationPattern', '[J']]) {
    const read = property === 'ShowBadge' ? 'canShowBadge' : property === 'BypassDnd' ? 'canBypassDnd' : property === 'VibrationPattern' ? 'getVibrationPattern' : `get${property}`;
    def(CHANNEL, `set${property}`, `(${code})V`, (r, _m, [self, v]) => { channel(r, self)[field] = code === 'Z' ? !!v : v; });
    def(CHANNEL, read, `()${code}`, (r, _m, [self]) => { const v = channel(r, self)[field]; return code === 'Z' ? (v ? 1 : 0) : v; });
  }
  def(CHANNEL, 'enableLights', '(Z)V', (r, _m, [self, v]) => { channel(r, self).lights = !!v; }); def(CHANNEL, 'shouldShowLights', '()Z', (r, _m, [self]) => channel(r, self).lights ? 1 : 0);
  def(CHANNEL, 'enableVibration', '(Z)V', (r, _m, [self, v]) => { channel(r, self).vibration = !!v; }); def(CHANNEL, 'shouldVibrate', '()Z', (r, _m, [self]) => channel(r, self).vibration ? 1 : 0);
  def(CHANNEL, 'setSound', `(${URI}Landroid/media/AudioAttributes;)V`, (r, _m, [self, uri]) => { channel(r, self).sound = uri; }); def(CHANNEL, 'getSound', `()${URI}`, (r, _m, [self]) => channel(r, self).sound);

  // ---- Notification, Action ---------------------------------------------------------------------------------------------------------------------------
  const fieldKey = (name, t) => `${NOTIFICATION}->${name}:${t}`;
  const notificationFields = [['when', 'J'], ['icon', 'I'], ['iconLevel', 'I'], ['number', 'I'], ['contentIntent', PENDING], ['deleteIntent', PENDING], ['fullScreenIntent', PENDING], ['tickerText', CHARS], ['largeIcon', BITMAP], ['sound', URI], ['audioStreamType', 'I'],
    ['vibrate', '[J'], ['ledARGB', 'I'], ['ledOnMS', 'I'], ['ledOffMS', 'I'], ['defaults', 'I'], ['flags', 'I'], ['priority', 'I'], ['category', STRING], ['color', 'I'], ['visibility', 'I'], ['publicVersion', NOTIFICATION], ['extras', BUNDLE], ['actions', `[${ACTION}`]];
  for (const [name, t] of notificationFields) registry.instanceField(NOTIFICATION, name, t, { reflect: true });
  const put = (r, ref, name, t, value) => r.storeField(r.object(ref).fields, fieldKey(name, t), value);
  def(NOTIFICATION, '<init>', '()V', (r, _m, [self]) => { put(r, self, 'when', 'J', BigInt(Math.trunc(platform.clock.wall()))); put(r, self, 'priority', 'I', 0); put(r, self, 'visibility', 'I', 0); put(r, self, 'audioStreamType', 'I', -1); put(r, self, 'extras', BUNDLE, platform.bundle(r)); });
  def(NOTIFICATION, '<init>', `(I${CHARS}J)V`, (r, _m, [self, icon, ticker, when]) => { call(r, self, NOTIFICATION, '<init>', [], 'V'); put(r, self, 'icon', 'I', icon); put(r, self, 'tickerText', CHARS, ticker); put(r, self, 'when', 'J', when); });
  const meta = (r, self) => r.object(self).notificationMeta ?? (r.object(self).notificationMeta = { channelId: null, group: null, sortKey: null, timeoutAfter: 0n, smallIcon: null, largeIcon: null, groupAlert: 0, badgeIcon: 0, shortcutId: null, settingsText: null });
  def(NOTIFICATION, 'getChannelId', `()${STRING}`, (r, _m, [self]) => meta(r, self).channelId); def(NOTIFICATION, 'getGroup', `()${STRING}`, (r, _m, [self]) => meta(r, self).group); def(NOTIFICATION, 'getSortKey', `()${STRING}`, (r, _m, [self]) => meta(r, self).sortKey);
  def(NOTIFICATION, 'getTimeoutAfter', '()J', (r, _m, [self]) => meta(r, self).timeoutAfter); def(NOTIFICATION, 'getSmallIcon', `()${ICON}`, (r, _m, [self]) => meta(r, self).smallIcon); def(NOTIFICATION, 'getLargeIcon', `()${ICON}`, (r, _m, [self]) => meta(r, self).largeIcon);
  def(NOTIFICATION, 'getGroupAlertBehavior', '()I', (r, _m, [self]) => meta(r, self).groupAlert); def(NOTIFICATION, 'getBadgeIconType', '()I', (r, _m, [self]) => meta(r, self).badgeIcon); def(NOTIFICATION, 'getShortcutId', `()${STRING}`, (r, _m, [self]) => meta(r, self).shortcutId);
  def(NOTIFICATION, 'toString', `()${STRING}`, (r, _m, [self]) => `Notification(channel=${meta(r, self).channelId} shortcut=${meta(r, self).shortcutId} contentView=null vibrate=null sound=null defaults=0x${(r.object(self).fields.get(fieldKey('defaults', 'I')) ?? 0).toString(16)} flags=0x${(r.object(self).fields.get(fieldKey('flags', 'I')) ?? 0).toString(16)} color=0x00000000 vis=PRIVATE)`);
  def(NOTIFICATION, 'clone', `()${OBJECT}`, (r, _m, [self]) => { const copy = r.allocate(NOTIFICATION); for (const [k, v] of r.object(self).fields) r.storeField(r.object(copy).fields, k, v); r.object(copy).notificationMeta = { ...meta(r, self) }; return copy; });
  def(NOTIFICATION, 'describeContents', '()I', () => 0);
  const ACTION_KEY = name => `${ACTION}->${name}`;
  for (const [name, t] of [['icon', 'I'], ['title', CHARS], ['actionIntent', PENDING]]) registry.instanceField(ACTION, name, t, { reflect: true });
  const actionState = (r, ref) => r.object(ref).action ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Action used before construction');
  def(ACTION_BUILDER, '<init>', `(I${CHARS}${PENDING})V`, (r, _m, [self, icon, title, intent]) => { r.object(self).actionBuilder = { icon, title, intent, extras: null, allowGenerated: true, semantic: 0, contextual: false }; });
  def(ACTION_BUILDER, '<init>', `(${ICON}${CHARS}${PENDING})V`, (r, _m, [self, icon, title, intent]) => { r.object(self).actionBuilder = { icon: 0, iconObject: icon, title, intent, extras: null, allowGenerated: true, semantic: 0, contextual: false }; });
  def(ACTION_BUILDER, 'addExtras', `(${BUNDLE})${ACTION_BUILDER}`, (r, _m, [self, extras]) => { r.object(self).actionBuilder.extras = extras; return self; });
  def(ACTION_BUILDER, 'getExtras', `()${BUNDLE}`, (r, _m, [self]) => r.object(self).actionBuilder.extras ??= platform.bundle(r));
  def(ACTION_BUILDER, 'setAllowGeneratedReplies', `(Z)${ACTION_BUILDER}`, (r, _m, [self, v]) => { r.object(self).actionBuilder.allowGenerated = !!v; return self; });
  def(ACTION_BUILDER, 'setSemanticAction', `(I)${ACTION_BUILDER}`, (r, _m, [self, v]) => { r.object(self).actionBuilder.semantic = v; return self; });
  def(ACTION_BUILDER, 'setContextual', `(Z)${ACTION_BUILDER}`, (r, _m, [self, v]) => { r.object(self).actionBuilder.contextual = !!v; return self; });
  def(ACTION_BUILDER, 'build', `()${ACTION}`, (r, _m, [self]) => {
    const b = r.object(self).actionBuilder, ref = r.allocate(ACTION); r.object(ref).action = { ...b, extras: b.extras ?? platform.bundle(r) };
    r.storeField(r.object(ref).fields, ACTION_KEY('icon:I'), b.icon); r.storeField(r.object(ref).fields, ACTION_KEY(`title:${CHARS}`), b.title); r.storeField(r.object(ref).fields, ACTION_KEY(`actionIntent:${PENDING}`), b.intent); return ref;
  });
  def(ACTION, 'getExtras', `()${BUNDLE}`, (r, _m, [self]) => actionState(r, self).extras); def(ACTION, 'getTitle', `()${CHARS}`, (r, _m, [self]) => actionState(r, self).title); def(ACTION, 'getIcon', `()${ICON}`, (r, _m, [self]) => actionState(r, self).iconObject ?? null);
  def(ACTION, 'getAllowGeneratedReplies', '()Z', (r, _m, [self]) => actionState(r, self).allowGenerated ? 1 : 0); def(ACTION, 'getSemanticAction', '()I', (r, _m, [self]) => actionState(r, self).semantic); def(ACTION, 'isContextual', '()Z', (r, _m, [self]) => actionState(r, self).contextual ? 1 : 0);
  def(ACTION, 'getRemoteInputs', '()[Landroid/app/RemoteInput;', () => null);
  for (const [name, value] of Object.entries({ SEMANTIC_ACTION_NONE: 0, SEMANTIC_ACTION_REPLY: 1, SEMANTIC_ACTION_MARK_AS_READ: 2, SEMANTIC_ACTION_MARK_AS_UNREAD: 3, SEMANTIC_ACTION_DELETE: 4, SEMANTIC_ACTION_ARCHIVE: 5, SEMANTIC_ACTION_MUTE: 6, SEMANTIC_ACTION_UNMUTE: 7, SEMANTIC_ACTION_THUMBS_UP: 8, SEMANTIC_ACTION_THUMBS_DOWN: 9, SEMANTIC_ACTION_CALL: 10 })) registry.staticField(ACTION, name, 'I', () => value);

  // ---- Styles: record their text; Builder.setStyle applies them ---------------------------------------------------------------------------------------------
  const style = (r, ref) => r.object(ref).style ??= { lines: [] };
  for (const owner of [BIG_TEXT, BIG_PICTURE, INBOX]) {
    def(owner, '<init>', '()V', () => {}); def(owner, '<init>', `(${BUILDER})V`, (r, _m, [self, builder]) => { r.object(builder).builder.style = self; });
    def(owner, 'setBigContentTitle', `(${CHARS})${owner}`, (r, _m, [self, title]) => { style(r, self).bigTitle = title; return self; });
    def(owner, 'setSummaryText', `(${CHARS})${owner}`, (r, _m, [self, summary]) => { style(r, self).summary = summary; return self; });
  }
  def(BIG_TEXT, 'bigText', `(${CHARS})${BIG_TEXT}`, (r, _m, [self, text_]) => { style(r, self).bigText = text_; return self; });
  def(INBOX, 'addLine', `(${CHARS})${INBOX}`, (r, _m, [self, line]) => { if (line !== null) style(r, self).lines.push(line); return self; });
  def(BIG_PICTURE, 'bigPicture', `(${BITMAP})${BIG_PICTURE}`, (r, _m, [self, bitmap]) => { style(r, self).picture = bitmap; return self; });
  def(BIG_PICTURE, 'bigLargeIcon', `(${BITMAP})${BIG_PICTURE}`, (r, _m, [self, bitmap]) => { style(r, self).bigLargeIcon = bitmap; return self; });

  // ---- Notification.Builder -----------------------------------------------------------------------------------------------------------------------------
  const builder = (r, ref) => r.object(ref).builder ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Notification.Builder used before construction');
  const fresh = () => ({ when: null, showWhen: null, icon: 0, smallIcon: null, title: null, text: null, subText: null, info: null, number: 0, progress: null, contentIntent: null, deleteIntent: null, fullScreen: null, fullScreenHighPriority: false, ticker: null, largeIcon: null,
    sound: null, vibrate: null, lights: null, defaults: 0, flags: 0, priority: 0, category: null, color: 0, visibility: 0, publicVersion: null, extras: null, actions: [], style: null, channelId: null, group: null, groupSummary: false, groupAlert: 0, badge: 0, sortKey: null,
    timeoutAfter: 0n, shortcutId: null, chronometer: false, chronometerDown: false, colorized: false, onlyAlertOnce: false, autoCancel: false, ongoing: false, localOnly: false, audioStreamType: -1 });
  def(BUILDER, '<init>', `(${CONTEXT})V`, (r, _m, [self]) => { r.object(self).builder = fresh(); });
  def(BUILDER, '<init>', `(${CONTEXT}${STRING})V`, (r, _m, [self, , channelId]) => { r.object(self).builder = { ...fresh(), channelId: text(r, channelId) }; });
  const setter = (name, parameters, apply) => def(BUILDER, name, `(${parameters})${BUILDER}`, (r, _m, [self, ...values]) => { apply(builder(r, self), values, r); return self; });
  setter('setWhen', 'J', (b, [v]) => { b.when = v; }); setter('setShowWhen', 'Z', (b, [v]) => { b.showWhen = !!v; }); setter('setUsesChronometer', 'Z', (b, [v]) => { b.chronometer = !!v; }); setter('setChronometerCountDown', 'Z', (b, [v]) => { b.chronometerDown = !!v; });
  setter('setSmallIcon', 'I', (b, [v]) => { b.icon = v; }); setter('setSmallIcon', 'II', (b, [v]) => { b.icon = v; }); setter('setSmallIcon', ICON, (b, [v]) => { b.smallIcon = v; });
  setter('setContentTitle', CHARS, (b, [v]) => { b.title = v; }); setter('setContentText', CHARS, (b, [v]) => { b.text = v; }); setter('setSubText', CHARS, (b, [v]) => { b.subText = v; }); setter('setContentInfo', CHARS, (b, [v]) => { b.info = v; });
  setter('setNumber', 'I', (b, [v]) => { b.number = v; }); setter('setProgress', 'IIZ', (b, [max, now, indeterminate]) => { b.progress = { max, now, indeterminate: !!indeterminate }; });
  setter('setContentIntent', PENDING, (b, [v]) => { b.contentIntent = v; }); setter('setDeleteIntent', PENDING, (b, [v]) => { b.deleteIntent = v; }); setter('setFullScreenIntent', `${PENDING}Z`, (b, [v, high]) => { b.fullScreen = v; b.fullScreenHighPriority = !!high; });
  setter('setTicker', CHARS, (b, [v]) => { b.ticker = v; }); setter('setTicker', CHARS+'Landroid/widget/RemoteViews;', (b, [v, views]) => { if (views !== null) throw new APKError('Notification.Builder.setTicker: RemoteViews are not implemented', { kind: 'unsupported-notification' }); b.ticker = v; }); setter('setLargeIcon', BITMAP, (b, [v]) => { b.largeIcon = v; }); setter('setLargeIcon', ICON, (b, [v]) => { b.largeIconObject = v; });
  setter('setSound', URI, (b, [v]) => { b.sound = v; }); setter('setSound', `${URI}I`, (b, [v, stream]) => { b.sound = v; b.audioStreamType = stream; }); setter('setSound', `${URI}Landroid/media/AudioAttributes;`, (b, [v]) => { b.sound = v; });
  setter('setVibrate', '[J', (b, [v]) => { b.vibrate = v; }); setter('setLights', 'III', (b, [argb, on, off]) => { b.lights = { argb, on, off }; });
  setter('setOngoing', 'Z', (b, [v]) => { b.ongoing = !!v; }); setter('setOnlyAlertOnce', 'Z', (b, [v]) => { b.onlyAlertOnce = !!v; }); setter('setAutoCancel', 'Z', (b, [v]) => { b.autoCancel = !!v; }); setter('setLocalOnly', 'Z', (b, [v]) => { b.localOnly = !!v; });
  setter('setDefaults', 'I', (b, [v]) => { b.defaults = v; }); setter('setPriority', 'I', (b, [v]) => { b.priority = v; }); setter('setCategory', STRING, (b, [v]) => { b.category = v; }); setter('setSortKey', STRING, (b, [v]) => { b.sortKey = v; });
  setter('setVisibility', 'I', (b, [v]) => { b.visibility = v; }); setter('setPublicVersion', NOTIFICATION, (b, [v]) => { b.publicVersion = v; }); setter('setColor', 'I', (b, [v]) => { b.color = v; }); setter('setColorized', 'Z', (b, [v]) => { b.colorized = !!v; });
  setter('setGroup', STRING, (b, [v]) => { b.group = v; }); setter('setGroupSummary', 'Z', (b, [v]) => { b.groupSummary = !!v; }); setter('setGroupAlertBehavior', 'I', (b, [v]) => { b.groupAlert = v; }); setter('setBadgeIconType', 'I', (b, [v]) => { b.badge = v; });
  setter('setChannelId', STRING, (b, [v]) => { b.channelId = v; }); setter('setTimeoutAfter', 'J', (b, [v]) => { b.timeoutAfter = BigInt(v); }); setter('setShortcutId', STRING, (b, [v]) => { b.shortcutId = v; });
  setter('setRemoteInputHistory', '[' + CHARS, (b, [v]) => { b.remoteInputHistory = v; }); setter('setSettingsText', CHARS, (b, [v]) => { b.settingsText = v; });
  setter('setLocusId', 'Landroid/content/LocusId;', (b, [v]) => { b.locusId = v; }); setter('setBubbleMetadata', 'Landroid/app/Notification$BubbleMetadata;', (b, [v]) => { if (v !== null) throw new APKError('Notification.Builder.setBubbleMetadata: bubbles are not implemented', { kind: 'unsupported-notification' }); });
  setter('setStyle', STYLE, (b, [v]) => { b.style = v; }); setter('setAllowSystemGeneratedContextualActions', 'Z', () => {}); setter('setForegroundServiceBehavior', 'I', (b, [v]) => { b.foregroundBehavior = v; });
  setter('addExtras', BUNDLE, (b, [v], r) => { if (v !== null) { b.extras ??= platform.bundle(r); call(r, b.extras, BUNDLE, 'putAll', [BUNDLE], 'V', [v]); } }); setter('setExtras', BUNDLE, (b, [v]) => { b.extras = v; });
  setter('addAction', `I${CHARS}${PENDING}`, (b, [icon, title, intent], r) => { const a = r.allocate(ACTION_BUILDER); r.object(a).actionBuilder = { icon, title, intent, extras: null, allowGenerated: true, semantic: 0, contextual: false }; b.actions.push(call(r, a, ACTION_BUILDER, 'build', [], ACTION)); });
  setter('addAction', ACTION, (b, [action]) => { if (action !== null) b.actions.push(action); });
  def(BUILDER, 'getExtras', `()${BUNDLE}`, (r, _m, [self]) => builder(r, self).extras ??= platform.bundle(r));
  for (const name of ['setContent', 'setCustomContentView', 'setCustomBigContentView', 'setCustomHeadsUpContentView']) def(BUILDER, name, `(Landroid/widget/RemoteViews;)${BUILDER}`, (_r, _m, [self, views]) => { if (views !== null) throw new APKError(`Notification.Builder.${name}: RemoteViews are not implemented`, { kind: 'unsupported-notification' }); return self; });   // null clears the view, as in the framework
  def(BUILDER, 'build', `()${NOTIFICATION}`, (r, _m, [self]) => buildNotification(r, builder(r, self)));
  def(BUILDER, 'getNotification', `()${NOTIFICATION}`, (r, _m, [self]) => buildNotification(r, builder(r, self)));
  function buildNotification(r, b) {
    const n = r.allocate(NOTIFICATION); call(r, n, NOTIFICATION, '<init>', [], 'V');
    const extras = b.extras ? (() => { const copy = platform.bundle(r); call(r, copy, BUNDLE, 'putAll', [BUNDLE], 'V', [b.extras]); return copy; })() : platform.bundle(r);
    const putText = (key, value) => { if (value !== null) call(r, extras, BUNDLE, 'putCharSequence', [STRING, CHARS], 'V', [key, value]); };
    const putInt = (key, value) => call(r, extras, BUNDLE, 'putInt', [STRING, 'I'], 'V', [key, value]), putBool = (key, value) => call(r, extras, BUNDLE, 'putBoolean', [STRING, 'Z'], 'V', [key, value ? 1 : 0]);
    putText(EXTRAS.EXTRA_TITLE, b.title); putText(EXTRAS.EXTRA_TEXT, b.text); putText(EXTRAS.EXTRA_SUB_TEXT, b.subText); putText(EXTRAS.EXTRA_INFO_TEXT, b.info);
    putInt(EXTRAS.EXTRA_SMALL_ICON, b.icon);
    if (b.progress) { putInt(EXTRAS.EXTRA_PROGRESS, b.progress.now); putInt(EXTRAS.EXTRA_PROGRESS_MAX, b.progress.max); putBool(EXTRAS.EXTRA_PROGRESS_INDETERMINATE, b.progress.indeterminate); }
    if (b.showWhen !== null || b.chronometer) putBool(EXTRAS.EXTRA_SHOW_WHEN, b.showWhen ?? true);
    if (b.chronometer) { putBool(EXTRAS.EXTRA_SHOW_CHRONOMETER, true); putBool(EXTRAS.EXTRA_CHRONOMETER_COUNT_DOWN, b.chronometerDown); }
    if (b.style) {
      const o = r.object(b.style).style ?? { lines: [] }, owner = r.typeOf(b.style);
      putText(EXTRAS.EXTRA_TITLE_BIG, o.bigTitle ?? null); putText(EXTRAS.EXTRA_SUMMARY_TEXT, o.summary ?? null);
      if (owner === BIG_TEXT) { putText(EXTRAS.EXTRA_BIG_TEXT, o.bigText ?? null); call(r, extras, BUNDLE, 'putString', [STRING, STRING], 'V', [EXTRAS.EXTRA_TEMPLATE, 'android.app.Notification$BigTextStyle']); }
      else if (owner === INBOX) { const lines = r.newArray(`[${CHARS}`, o.lines.length); r.array(lines).elements = [...o.lines]; call(r, extras, BUNDLE, 'putCharSequenceArray', [STRING, `[${CHARS}`], 'V', [EXTRAS.EXTRA_TEXT_LINES, lines]); call(r, extras, BUNDLE, 'putString', [STRING, STRING], 'V', [EXTRAS.EXTRA_TEMPLATE, 'android.app.Notification$InboxStyle']); }
      else if (owner === BIG_PICTURE) { if (o.picture) call(r, extras, BUNDLE, 'putParcelable', [STRING, 'Landroid/os/Parcelable;'], 'V', [EXTRAS.EXTRA_PICTURE, o.picture]); call(r, extras, BUNDLE, 'putString', [STRING, STRING], 'V', [EXTRAS.EXTRA_TEMPLATE, 'android.app.Notification$BigPictureStyle']); }
      else throw new APKError(`Notification style ${owner} is not implemented`, { kind: 'unsupported-notification' });
    }
    if (b.remoteInputHistory) call(r, extras, BUNDLE, 'putCharSequenceArray', [STRING, '[' + CHARS], 'V', [EXTRAS.EXTRA_REMOTE_INPUT_HISTORY, b.remoteInputHistory]);
    if (b.channelId !== null) call(r, extras, BUNDLE, 'putString', [STRING, STRING], 'V', [EXTRAS.EXTRA_CHANNEL_ID, b.channelId]);
    const flags = (b.ongoing ? 2 : 0) | (b.onlyAlertOnce ? 8 : 0) | (b.autoCancel ? 16 : 0) | (b.localOnly ? 256 : 0) | (b.groupSummary ? 512 : 0) | (b.lights ? 1 : 0) | (b.priority > 0 ? 128 : 0) | (b.foregroundBehavior === 1 ? 0 : 0);
    const defaults = b.defaults | 0, lights = b.lights;
    for (const [name, t, value] of [['when', 'J', b.when ?? BigInt(Math.trunc(platform.clock.wall()))], ['icon', 'I', b.icon], ['number', 'I', b.number], ['contentIntent', PENDING, b.contentIntent], ['deleteIntent', PENDING, b.deleteIntent], ['fullScreenIntent', PENDING, b.fullScreen],
      ['tickerText', CHARS, b.ticker], ['largeIcon', BITMAP, b.largeIcon], ['sound', URI, b.sound], ['audioStreamType', 'I', b.audioStreamType], ['vibrate', '[J', b.vibrate], ['ledARGB', 'I', lights?.argb ?? 0], ['ledOnMS', 'I', lights?.on ?? 0], ['ledOffMS', 'I', lights?.off ?? 0],
      ['defaults', 'I', defaults], ['flags', 'I', flags | (defaults & 4 ? 1 : 0)], ['priority', 'I', b.priority], ['category', STRING, b.category], ['color', 'I', b.color], ['visibility', 'I', b.visibility], ['publicVersion', NOTIFICATION, b.publicVersion], ['extras', BUNDLE, extras]]) put(r, n, name, t, value);
    if (b.actions.length) { const actions = r.newArray(`[${ACTION}`, b.actions.length); r.array(actions).elements = [...b.actions]; put(r, n, 'actions', `[${ACTION}`, actions); }
    Object.assign(meta(r, n), { channelId: b.channelId, group: b.group, sortKey: b.sortKey, timeoutAfter: b.timeoutAfter, smallIcon: b.smallIcon, largeIcon: b.largeIconObject ?? null, groupAlert: b.groupAlert, badgeIcon: b.badge, shortcutId: b.shortcutId, settingsText: b.settingsText ?? null });
    return n;
  }
  return { ...registry, interfaces: registry.interfacesOf };
}
