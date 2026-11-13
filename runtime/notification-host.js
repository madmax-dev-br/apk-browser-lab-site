import { APKError } from './apk-error.js?v=92e21e72be68';
import { createHostRegistry } from './host-contract.js?v=92e21e72be68';

// android.app.Notification, Notification.Builder / Action / BigTextStyle / BigPictureStyle / InboxStyle, NotificationChannel and android.graphics.drawable.Icon (android-13.0.0_r1).
// None of these is in the framework DEX. The Builder is a recorder, exactly as in Notification.java: every setter stores a value and build() writes the public fields of
// Notification (icon, when, flags, contentIntent, priority...) and the standard `extras` Bundle (EXTRA_TITLE, EXTRA_TEXT, ...), which apps and NotificationCompat read back. Rendering is not
// modelled (the virtual device has no status bar; NotificationManager only records posts). Remote views and MediaStyle fail explicitly; bubble metadata is recorded, not shown.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', CHARS = 'Ljava/lang/CharSequence;', CONTEXT = 'Landroid/content/Context;', PENDING = 'Landroid/app/PendingIntent;', BUNDLE = 'Landroid/os/Bundle;', BITMAP = 'Landroid/graphics/Bitmap;', URI = 'Landroid/net/Uri;';
const NOTIFICATION = 'Landroid/app/Notification;', BUILDER = 'Landroid/app/Notification$Builder;', ACTION = 'Landroid/app/Notification$Action;', ACTION_BUILDER = 'Landroid/app/Notification$Action$Builder;', STYLE = 'Landroid/app/Notification$Style;';
const BIG_TEXT = 'Landroid/app/Notification$BigTextStyle;', BIG_PICTURE = 'Landroid/app/Notification$BigPictureStyle;', INBOX = 'Landroid/app/Notification$InboxStyle;', CHANNEL = 'Landroid/app/NotificationChannel;', ICON = 'Landroid/graphics/drawable/Icon;';
const PERSON = 'Landroid/app/Person;', PERSON_BUILDER = 'Landroid/app/Person$Builder;', MESSAGING = 'Landroid/app/Notification$MessagingStyle;', MESSAGE = 'Landroid/app/Notification$MessagingStyle$Message;', CALL = 'Landroid/app/Notification$CallStyle;', REMOTE_INPUT = 'Landroid/app/RemoteInput;';
const EXTRAS = { EXTRA_SELF_DISPLAY_NAME: 'android.selfDisplayName', EXTRA_MESSAGING_PERSON: 'android.messagingUser', EXTRA_CONVERSATION_TITLE: 'android.conversationTitle', EXTRA_MESSAGES: 'android.messages', EXTRA_HISTORIC_MESSAGES: 'android.messages.historic',
  EXTRA_IS_GROUP_CONVERSATION: 'android.isGroupConversation', EXTRA_CALL_TYPE: 'android.callType', EXTRA_CALL_PERSON: 'android.callPerson', EXTRA_CALL_IS_VIDEO: 'android.callIsVideo', EXTRA_VERIFICATION_ICON: 'android.verificationIcon', EXTRA_VERIFICATION_TEXT: 'android.verificationText',
  EXTRA_ANSWER_INTENT: 'android.answerIntent', EXTRA_DECLINE_INTENT: 'android.declineIntent', EXTRA_HANG_UP_INTENT: 'android.hangUpIntent', EXTRA_ANSWER_COLOR: 'android.answerColor', EXTRA_DECLINE_COLOR: 'android.declineColor', EXTRA_TITLE: 'android.title', EXTRA_TITLE_BIG: 'android.title.big', EXTRA_TEXT: 'android.text', EXTRA_SUB_TEXT: 'android.subText', EXTRA_INFO_TEXT: 'android.infoText', EXTRA_SUMMARY_TEXT: 'android.summaryText', EXTRA_BIG_TEXT: 'android.bigText',
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
  for (const owner of [NOTIFICATION, BUILDER, ACTION, ACTION_BUILDER, STYLE, BIG_TEXT, BIG_PICTURE, INBOX, CHANNEL, 'Landroid/app/NotificationChannelGroup;', ICON]) type(owner, OBJECT, [], { allocatable: true });
  for (const style of [BIG_TEXT, BIG_PICTURE, INBOX, MESSAGING, CALL]) type(style, STYLE, [], { allocatable: true });
  for (const owner of [PERSON, PERSON_BUILDER, MESSAGE]) type(owner, OBJECT, [], { allocatable: true });
  registry.interfaces.set(PERSON, ['Landroid/os/Parcelable;']);
  registry.interfaces.set(NOTIFICATION, ['Landroid/os/Parcelable;']); registry.interfaces.set(CHANNEL, ['Landroid/os/Parcelable;']); registry.interfaces.set('Landroid/app/NotificationChannelGroup;', ['Landroid/os/Parcelable;']); registry.interfaces.set(ICON, ['Landroid/os/Parcelable;']);
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
  def(ICON, 'createWithData', '([BII)' + ICON, (r, _m, [data, offset, length]) => { if (data === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Data must not be null.'); return newIcon(r, { type: 3, data, offset, length }); }, { static: true });
  def(ICON, 'createWithContentUri', `(${STRING})${ICON}`, (r, _m, [uri]) => { if (uri === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Uri must not be null.'); return newIcon(r, { type: 4, uri: r.dispatch({ owner: URI, name: 'parse', parameters: [STRING], result: URI, signature: `(${STRING})${URI}` }, [uri], 'static') }); }, { static: true });
  def(ICON, 'createWithAdaptiveBitmapContentUri', `(${URI})${ICON}`, (r, _m, [uri]) => { if (uri === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Uri must not be null.'); return newIcon(r, { type: 6, uri }); }, { static: true });
  def(ICON, 'createWithAdaptiveBitmapContentUri', `(${STRING})${ICON}`, (r, _m, [uri]) => { if (uri === null) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Uri must not be null.'); return newIcon(r, { type: 6, uri: r.dispatch({ owner: URI, name: 'parse', parameters: [STRING], result: URI, signature: `(${STRING})${URI}` }, [uri], 'static') }); }, { static: true });
  def(ICON, 'getUri', `()${URI}`, (r, _m, [self]) => { const s = iconState(r, self); if (s.type !== 4 && s.type !== 6) r.throwJava('Ljava/lang/IllegalStateException;', 'called getUri() on ' + s.type); return s.uri; });
  def(ICON, 'setTintList', `(Landroid/content/res/ColorStateList;)${ICON}`, (r, _m, [self, tint]) => { iconState(r, self).tint = tint; return self; });
  def(ICON, 'setTintMode', `(Landroid/graphics/PorterDuff$Mode;)${ICON}`, (r, _m, [self, mode]) => { iconState(r, self).tintMode = mode; return self; });
  def(ICON, 'getType', '()I', (r, _m, [self]) => iconState(r, self).type);
  def(ICON, 'getResId', '()I', (r, _m, [self]) => { const s = iconState(r, self); if (s.type !== 2) r.throwJava('Ljava/lang/IllegalStateException;', 'called getResId() on ' + s.type); return s.resId; });
  def(ICON, 'getResPackage', `()${STRING}`, (r, _m, [self]) => { const s = iconState(r, self); if (s.type !== 2) r.throwJava('Ljava/lang/IllegalStateException;', 'called getResPackage() on ' + s.type); return s.pkg; });
  def(ICON, 'loadDrawable', `(${CONTEXT})Landroid/graphics/drawable/Drawable;`, (r, _m, [self, context]) => {
    const s = iconState(r, self), BD = 'Landroid/graphics/drawable/BitmapDrawable;';
    if (s.type === 2) { const resources = call(r, context, CONTEXT, 'getResources', [], 'Landroid/content/res/Resources;'); return r.dispatch({ owner: 'Landroid/content/res/Resources;', name: 'getDrawable', parameters: ['I', 'Landroid/content/res/Resources$Theme;'], result: 'Landroid/graphics/drawable/Drawable;', signature: '(ILandroid/content/res/Resources$Theme;)Landroid/graphics/drawable/Drawable;' }, [resources, s.resId, call(r, context, CONTEXT, 'getTheme', [], 'Landroid/content/res/Resources$Theme;')], 'virtual'); }
    if (s.type === 1 || s.type === 5) { const d = r.allocate(BD); r.dispatch({ owner: BD, name: '<init>', parameters: ['Landroid/content/res/Resources;', BITMAP], result: 'V', signature: `(Landroid/content/res/Resources;${BITMAP})V` }, [d, null, s.bitmap], 'direct'); return d; }
    const decodeBitmap = (bitmap) => { const d = r.allocate(BD); r.dispatch({ owner: BD, name: '<init>', parameters: ['Landroid/content/res/Resources;', BITMAP], result: 'V', signature: `(Landroid/content/res/Resources;${BITMAP})V` }, [d, call(r, context, CONTEXT, 'getResources', [], 'Landroid/content/res/Resources;'), bitmap], 'direct'); return d; };
    let drawable = null;
    if (s.type === 3) { const bitmap = r.dispatch({ owner: 'Landroid/graphics/BitmapFactory;', name: 'decodeByteArray', parameters: ['[B', 'I', 'I'], result: BITMAP, signature: `([BII)${BITMAP}` }, r.argumentWords(['[B', 'I', 'I'], [s.data, s.offset, s.length]), 'static'); drawable = bitmap === null ? null : decodeBitmap(bitmap); }
    else if (s.type === 4 || s.type === 6) { const resolver = call(r, context, CONTEXT, 'getContentResolver', [], 'Landroid/content/ContentResolver;'), stream = call(r, resolver, 'Landroid/content/ContentResolver;', 'openInputStream', [URI], 'Ljava/io/InputStream;', [s.uri]); const bitmap = r.dispatch({ owner: 'Landroid/graphics/BitmapFactory;', name: 'decodeStream', parameters: ['Ljava/io/InputStream;'], result: BITMAP, signature: `(Ljava/io/InputStream;)${BITMAP}` }, [stream], 'static'); drawable = bitmap === null ? null : decodeBitmap(bitmap); }
    if (drawable !== null) { if (s.tint) call(r, drawable, 'Landroid/graphics/drawable/Drawable;', 'setTintList', ['Landroid/content/res/ColorStateList;'], 'V', [s.tint]); if (s.tintMode) call(r, drawable, 'Landroid/graphics/drawable/Drawable;', 'setTintMode', ['Landroid/graphics/PorterDuff$Mode;'], 'V', [s.tintMode]); return drawable; }
    if (s.type === 3 || s.type === 4 || s.type === 6) return null;   // undecodable data: the framework returns null as well
    throw new APKError(`Icon.loadDrawable for icon type ${s.type} is not implemented`, { kind: 'unsupported-icon' });
  });

  // ---- NotificationChannel -----------------------------------------------------------------------------------------------------------------------
  const channel = (r, ref) => r.object(ref).channel ?? r.throwJava('Ljava/lang/IllegalStateException;', 'NotificationChannel used before construction');
  def(CHANNEL, '<init>', `(${STRING}${CHARS}I)V`, (r, _m, [self, id, name, importance]) => {
    if (id === null) r.throwJava('Ljava/lang/NullPointerException;', null);
    // NotificationChannel field initialisers (android-13.0.0_r1): ids/names are trimmed to MAX_TEXT_LENGTH (1000), the sound defaults to Settings.System.DEFAULT_NOTIFICATION_URI and the
    // audio attributes to Notification.AUDIO_ATTRIBUTES_DEFAULT (USAGE_NOTIFICATION, CONTENT_TYPE_SONIFICATION), no override of the lock-screen visibility, badges shown.
    r.object(self).channel = { id: text(r, id).slice(0, 1000), name: (name === null || name === 0) ? null : r.javaString(name).slice(0, 1000), importance, description: null, group: null, showBadge: true, lights: false, lightColor: 0, vibration: false, vibrationPattern: null,
      sound: callStaticUri(r, DEFAULT_NOTIFICATION_URI), audio: null, lockscreenVisibility: -1000, bypassDnd: false, canBubble: false, conversationId: null, parentChannelId: null, importantConversation: false };
  });
  const callStaticUri = (r, spec) => r.dispatch({ owner: URI, name: 'parse', parameters: [STRING], result: URI, signature: `(${STRING})${URI}` }, r.argumentWords([STRING], [spec]), 'static');
  const DEFAULT_NOTIFICATION_URI = 'content://settings/system/notification_sound';
  const AUDIO_ATTRIBUTES = 'Landroid/media/AudioAttributes;', AUDIO_BUILDER = 'Landroid/media/AudioAttributes$Builder;';
  const defaultAudioAttributes = r => {   // Notification.AUDIO_ATTRIBUTES_DEFAULT
    const builder = r.allocate(AUDIO_BUILDER); r.dispatch({ owner: AUDIO_BUILDER, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [builder], 'direct');
    for (const [name, value] of [['setUsage', 5], ['setContentType', 4]]) r.dispatch({ owner: AUDIO_BUILDER, name, parameters: ['I'], result: AUDIO_BUILDER, signature: `(I)${AUDIO_BUILDER}` }, [builder, value], 'virtual');
    return r.dispatch({ owner: AUDIO_BUILDER, name: 'build', parameters: [], result: AUDIO_ATTRIBUTES, signature: `()${AUDIO_ATTRIBUTES}` }, [builder], 'virtual');
  };
  def(CHANNEL, 'getAudioAttributes', `()${AUDIO_ATTRIBUTES}`, (r, _m, [self]) => { const c = channel(r, self); return c.audio === undefined || c.audio === 0 ? null : (c.audio ??= defaultAudioAttributes(r)); });
  def(CHANNEL, 'canBubble', '()Z', (r, _m, [self]) => channel(r, self).canBubble ? 1 : 0); def(CHANNEL, 'setAllowBubbles', '(Z)V', (r, _m, [self, v]) => { channel(r, self).canBubble = !!v; });
  def(CHANNEL, 'getConversationId', `()${STRING}`, (r, _m, [self]) => channel(r, self).conversationId); def(CHANNEL, 'getParentChannelId', `()${STRING}`, (r, _m, [self]) => channel(r, self).parentChannelId);
  def(CHANNEL, 'isImportantConversation', '()Z', (r, _m, [self]) => channel(r, self).importantConversation ? 1 : 0);
  def(CHANNEL, 'setConversationId', `(${STRING}${STRING})V`, (r, _m, [self, parent, conversation]) => { const c = channel(r, self); c.parentChannelId = parent; c.conversationId = conversation; });
  def(CHANNEL, 'describeContents', '()I', () => 0);
  def(CHANNEL, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => {
    if (other === null || other === undefined || other === 0) return 0; if (other === self || other.ref === self.ref) return 1;
    const b = r.object(other).channel; if (!b) return 0; const a = channel(r, self);
    const eq = (x, y) => (x === y) || (x && y && typeof x === 'object' && typeof y === 'object' && r.dispatch({ owner: OBJECT, name: 'equals', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [x, y], 'virtual') === 1);
    const same = (x, y) => (x === null || x === 0 || x === undefined) ? (y === null || y === 0 || y === undefined) : (typeof x === 'string' ? x === y : eq(x, y));
    const sound = [a.sound, b.sound], audio = [a.audio ?? null, b.audio ?? null];
    return a.importance === b.importance && a.bypassDnd === b.bypassDnd && a.lockscreenVisibility === b.lockscreenVisibility && a.lights === b.lights && a.lightColor === b.lightColor && a.showBadge === b.showBadge && a.canBubble === b.canBubble && a.vibration === b.vibration
      && same(a.id, b.id) && same(r.javaString ? (a.name === null ? null : r.javaString(a.name)) : a.name, r.javaString ? (b.name === null ? null : r.javaString(b.name)) : b.name) && same(a.description, b.description) && same(sound[0], sound[1]) && same(a.group, b.group)
      && same(audio[0], audio[1]) && JSON.stringify(a.vibrationPattern === null ? null : r.array(a.vibrationPattern).elements.map(String)) === JSON.stringify(b.vibrationPattern === null ? null : r.array(b.vibrationPattern).elements.map(String)) ? 1 : 0;
  });
  def(CHANNEL, 'hashCode', '()I', (r, _m, [self]) => { const c = channel(r, self); let h = 17; for (const part of [c.id, String(c.importance), String(c.lockscreenVisibility), String(c.lightColor), String(c.showBadge), String(c.lights)]) { for (let i = 0; i < (part ?? '').length; i++) h = (Math.imul(h, 31) + part.charCodeAt(i)) | 0; } return h; });
  registry.staticField(CHANNEL, 'DEFAULT_CHANNEL_ID', STRING, () => 'miscellaneous');
  def(CHANNEL, 'getId', `()${STRING}`, (r, _m, [self]) => channel(r, self).id); def(CHANNEL, 'getName', `()${CHARS}`, (r, _m, [self]) => channel(r, self).name); def(CHANNEL, 'setName', `(${CHARS})V`, (r, _m, [self, v]) => { channel(r, self).name = (v === null || v === 0) ? null : r.javaString(v).slice(0, 1000); });
  def(CHANNEL, 'getImportance', '()I', (r, _m, [self]) => channel(r, self).importance); def(CHANNEL, 'setImportance', '(I)V', (r, _m, [self, v]) => { channel(r, self).importance = v; });
  for (const [property, field, code] of [['Description', 'description', STRING], ['Group', 'group', STRING], ['ShowBadge', 'showBadge', 'Z'], ['LightColor', 'lightColor', 'I'], ['LockscreenVisibility', 'lockscreenVisibility', 'I'], ['BypassDnd', 'bypassDnd', 'Z'], ['VibrationPattern', 'vibrationPattern', '[J']]) {
    const read = property === 'ShowBadge' ? 'canShowBadge' : property === 'BypassDnd' ? 'canBypassDnd' : property === 'VibrationPattern' ? 'getVibrationPattern' : `get${property}`;
    def(CHANNEL, `set${property}`, `(${code})V`, (r, _m, [self, v]) => { channel(r, self)[field] = code === 'Z' ? !!v : v; });
    def(CHANNEL, read, `()${code}`, (r, _m, [self]) => { const v = channel(r, self)[field]; return code === 'Z' ? (v ? 1 : 0) : v; });
  }
  def(CHANNEL, 'setDescription', `(${STRING})V`, (r, _m, [self, v]) => { channel(r, self).description = (v === null || v === 0) ? null : r.stringCharacters(v).slice(0, 1000); });   // getTrimmedString
  def(CHANNEL, 'enableLights', '(Z)V', (r, _m, [self, v]) => { channel(r, self).lights = !!v; }); def(CHANNEL, 'shouldShowLights', '()Z', (r, _m, [self]) => channel(r, self).lights ? 1 : 0);
  def(CHANNEL, 'enableVibration', '(Z)V', (r, _m, [self, v]) => { channel(r, self).vibration = !!v; }); def(CHANNEL, 'shouldVibrate', '()Z', (r, _m, [self]) => channel(r, self).vibration ? 1 : 0);
  def(CHANNEL, 'setSound', `(${URI}Landroid/media/AudioAttributes;)V`, (r, _m, [self, uri, audio]) => { const c = channel(r, self); c.sound = uri; c.audio = (audio === null || audio === 0) ? 0 : audio; }); def(CHANNEL, 'getSound', `()${URI}`, (r, _m, [self]) => channel(r, self).sound);

  // ---- NotificationChannelGroup (frameworks/base NotificationChannelGroup.java) -----------------------------------------------------------------------
  const GROUP = 'Landroid/app/NotificationChannelGroup;', LIST = 'Ljava/util/List;';
  const group = (r, ref) => r.object(ref).channelGroup ?? r.throwJava('Ljava/lang/IllegalStateException;', 'NotificationChannelGroup used before construction');
  const trimmed = (r, value) => value === null ? null : r.stringCharacters(value).slice(0, 40);   // getTrimmedString: ids and names are cut to MAX_TEXT_LENGTH (1000) -- ids to 40 chars in Channel/Group
  def(GROUP, '<init>', `(${STRING}${CHARS})V`, (r, _m, [self, id, name]) => { r.object(self).channelGroup = { id: (id === null || id === 0) ? null : r.stringCharacters(id).slice(0, 1000), name: (name === null || name === 0) ? null : r.javaString(name).slice(0, 1000), description: null, blocked: false, channels: null }; });
  def(GROUP, 'getId', `()${STRING}`, (r, _m, [self]) => group(r, self).id); def(GROUP, 'getName', `()${CHARS}`, (r, _m, [self]) => group(r, self).name);
  def(GROUP, 'getDescription', `()${STRING}`, (r, _m, [self]) => group(r, self).description); def(GROUP, 'setDescription', `(${STRING})V`, (r, _m, [self, v]) => { group(r, self).description = v === null ? null : r.stringCharacters(v).slice(0, 1000); });
  def(GROUP, 'isBlocked', '()Z', (r, _m, [self]) => group(r, self).blocked ? 1 : 0);
  def(GROUP, 'getChannels', `()${LIST}`, (r, _m, [self]) => group(r, self).channels ?? r.dispatch({ owner: 'Ljava/util/Collections;', name: 'emptyList', parameters: [], result: LIST, signature: `()${LIST}` }, [], 'static'));
  def(GROUP, 'setChannels', `(${LIST})V`, (r, _m, [self, channels]) => { group(r, self).channels = channels; });
  def(GROUP, 'toString', `()${STRING}`, (r, _m, [self]) => { const g = group(r, self); return `NotificationChannelGroup{mId='${g.id}', mName=${g.name === null ? 'null' : g.name}, mDescription=${g.description === null ? 'null' : '(' + g.description.length + ')'}, mBlocked=${g.blocked}}`; });
  void trimmed;

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
  def(ACTION_BUILDER, 'setAuthenticationRequired', `(Z)${ACTION_BUILDER}`, (r, _m, [self, v]) => { r.object(self).actionBuilder.authenticationRequired = !!v; return self; });   // Notification.Action.Builder (API 31)
  def(ACTION_BUILDER, 'build', `()${ACTION}`, (r, _m, [self]) => {
    const b = r.object(self).actionBuilder, ref = r.allocate(ACTION); r.object(ref).action = { ...b, extras: b.extras ?? platform.bundle(r), remoteInputs: b.remoteInputs ?? [] };
    r.storeField(r.object(ref).fields, ACTION_KEY('icon:I'), b.icon); r.storeField(r.object(ref).fields, ACTION_KEY(`title:${CHARS}`), b.title); r.storeField(r.object(ref).fields, ACTION_KEY(`actionIntent:${PENDING}`), b.intent); return ref;
  });
  def(ACTION, 'getExtras', `()${BUNDLE}`, (r, _m, [self]) => actionState(r, self).extras); def(ACTION, 'getTitle', `()${CHARS}`, (r, _m, [self]) => actionState(r, self).title); def(ACTION, 'getIcon', `()${ICON}`, (r, _m, [self]) => actionState(r, self).iconObject ?? null);
  def(ACTION, 'isAuthenticationRequired', '()Z', (r, _m, [self]) => (actionState(r, self).authenticationRequired ? 1 : 0));
  def(ACTION, 'getAllowGeneratedReplies', '()Z', (r, _m, [self]) => actionState(r, self).allowGenerated ? 1 : 0); def(ACTION, 'getSemanticAction', '()I', (r, _m, [self]) => actionState(r, self).semantic); def(ACTION, 'isContextual', '()Z', (r, _m, [self]) => actionState(r, self).contextual ? 1 : 0);
  def(ACTION, 'getRemoteInputs', '()[Landroid/app/RemoteInput;', (r, _m, [self]) => { const inputs = actionState(r, self).remoteInputs; if (!inputs?.length) return null; const array = r.newArray('[Landroid/app/RemoteInput;', inputs.length); r.array(array).elements = [...inputs]; return array; });
  for (const [name, value] of Object.entries({ SEMANTIC_ACTION_NONE: 0, SEMANTIC_ACTION_REPLY: 1, SEMANTIC_ACTION_MARK_AS_READ: 2, SEMANTIC_ACTION_MARK_AS_UNREAD: 3, SEMANTIC_ACTION_DELETE: 4, SEMANTIC_ACTION_ARCHIVE: 5, SEMANTIC_ACTION_MUTE: 6, SEMANTIC_ACTION_UNMUTE: 7, SEMANTIC_ACTION_THUMBS_UP: 8, SEMANTIC_ACTION_THUMBS_DOWN: 9, SEMANTIC_ACTION_CALL: 10 })) registry.staticField(ACTION, name, 'I', () => value);


  // ---- Person, MessagingStyle (+Message), CallStyle (android-13.0.0_r1) -----------------------------------------------------------------------------------------------------------------------
  const newPerson = (r, state) => { const ref = r.allocate(PERSON); r.object(ref).person = state; return ref; };
  const person = (r, ref) => r.object(ref).person ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Person used before creation');
  const named = (r, name) => name === null ? null : newPerson(r, { name, icon: null, uri: null, key: null, bot: false, important: false });
  const personBuilder = (r, ref) => r.object(ref).personBuilder;
  def(PERSON_BUILDER, '<init>', '()V', (r, _m, [self]) => { r.object(self).personBuilder = { name: null, icon: null, uri: null, key: null, bot: false, important: false }; });
  for (const [name, t, field] of [['setName', CHARS, 'name'], ['setIcon', ICON, 'icon'], ['setUri', STRING, 'uri'], ['setKey', STRING, 'key'], ['setBot', 'Z', 'bot'], ['setImportant', 'Z', 'important']])
    def(PERSON_BUILDER, name, `(${t})${PERSON_BUILDER}`, (r, _m, [self, v]) => { personBuilder(r, self)[field] = t === 'Z' ? !!v : v; return self; });
  def(PERSON_BUILDER, 'build', `()${PERSON}`, (r, _m, [self]) => newPerson(r, { ...personBuilder(r, self) }));
  def(PERSON, 'getName', `()${CHARS}`, (r, _m, [self]) => person(r, self).name); def(PERSON, 'getIcon', `()${ICON}`, (r, _m, [self]) => person(r, self).icon); def(PERSON, 'getUri', `()${STRING}`, (r, _m, [self]) => person(r, self).uri); def(PERSON, 'getKey', `()${STRING}`, (r, _m, [self]) => person(r, self).key);
  def(PERSON, 'isBot', '()Z', (r, _m, [self]) => person(r, self).bot ? 1 : 0); def(PERSON, 'isImportant', '()Z', (r, _m, [self]) => person(r, self).important ? 1 : 0); def(PERSON, 'describeContents', '()I', () => 0);
  def(PERSON, 'toBuilder', `()${PERSON_BUILDER}`, (r, _m, [self]) => { const b = r.allocate(PERSON_BUILDER); r.object(b).personBuilder = { ...person(r, self) }; return b; });
  const sameText = (r, a, b) => (a === null || a === 0) === (b === null || b === 0) && ((a === null || a === 0) || r.stringCharacters(a) === r.stringCharacters(b));
  const samePerson = (r, a, b) => { const x = person(r, a), y = person(r, b); if (x.key !== null || y.key !== null) return x.key !== null && y.key !== null && r.stringCharacters(x.key) === r.stringCharacters(y.key); return sameText(r, x.name, y.name) && sameText(r, x.uri, y.uri) && x.bot === y.bot && x.important === y.important; };   // Person.equals: the key decides when either has one
  def(PERSON, 'equals', `(${OBJECT})Z`, (r, _m, [self, other]) => other !== null && other !== 0 && r.typeOf(other) === PERSON && samePerson(r, self, other) ? 1 : 0);
  def(PERSON, 'hashCode', '()I', (r, _m, [self]) => { const x = person(r, self), str = v => v === null ? 0 : [...r.stringCharacters(v)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0); return x.key !== null ? str(x.key) : (((str(x.name) * 31 + str(x.uri)) | 0) * 31 + (x.bot ? 1231 : 1237)) * 31 + (x.important ? 1231 : 1237) | 0; });
  const newList = (r, items) => { const list = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct'); for (const item of items) r.dispatch({ owner: 'Ljava/util/ArrayList;', name: 'add', parameters: [OBJECT], result: 'Z', signature: `(${OBJECT})Z` }, [list, item], 'virtual'); return list; };
  const targetSdk = r => r.targetSdkVersion ?? Number(r.platform?.manifest?.usesSdk?.targetSdkVersion ?? 1);
  const empty = (r, v) => v === null || v === 0 || r.stringCharacters(v).length === 0;

  const msg = (r, ref) => r.object(ref).message;
  def(MESSAGE, '<init>', `(${CHARS}J${PERSON})V`, (r, _m, [self, text_, time, sender]) => { r.object(self).message = { text: text_, time: BigInt(time), sender, mime: null, uri: null, extras: null }; });
  def(MESSAGE, '<init>', `(${CHARS}J${CHARS})V`, (r, _m, [self, text_, time, sender]) => { r.object(self).message = { text: text_, time: BigInt(time), sender: named(r, sender), mime: null, uri: null, extras: null }; });
  def(MESSAGE, 'setData', `(${STRING}${URI})${MESSAGE}`, (r, _m, [self, mime, uri]) => { Object.assign(msg(r, self), { mime, uri }); return self; });
  def(MESSAGE, 'getText', `()${CHARS}`, (r, _m, [self]) => msg(r, self).text); def(MESSAGE, 'getTimestamp', '()J', (r, _m, [self]) => msg(r, self).time);
  def(MESSAGE, 'getExtras', `()${BUNDLE}`, (r, _m, [self]) => msg(r, self).extras ??= platform.bundle(r));
  def(MESSAGE, 'getSender', `()${CHARS}`, (r, _m, [self]) => { const p = msg(r, self).sender; return p === null ? null : person(r, p).name; }); def(MESSAGE, 'getSenderPerson', `()${PERSON}`, (r, _m, [self]) => msg(r, self).sender);
  def(MESSAGE, 'getDataMimeType', `()${STRING}`, (r, _m, [self]) => msg(r, self).mime); def(MESSAGE, 'getDataUri', `()${URI}`, (r, _m, [self]) => msg(r, self).uri);
  const MAX_MESSAGES = 25;   // MessagingStyle.MAXIMUM_RETAINED_MESSAGES
  const ms = (r, ref) => { const o = style(r, ref); o.messages ??= []; o.historic ??= []; return o; };
  def(MESSAGING, '<init>', `(${PERSON})V`, (r, _m, [self, user]) => { const o = ms(r, self); o.user = user; });
  def(MESSAGING, '<init>', `(${CHARS})V`, (r, _m, [self, name]) => { const o = ms(r, self); o.user = named(r, name); });
  def(MESSAGING, 'getUser', `()${PERSON}`, (r, _m, [self]) => ms(r, self).user); def(MESSAGING, 'getUserDisplayName', `()${CHARS}`, (r, _m, [self]) => { const u = ms(r, self).user; return u === null ? null : person(r, u).name; });
  def(MESSAGING, 'setConversationTitle', `(${CHARS})${MESSAGING}`, (r, _m, [self, title]) => { ms(r, self).title = title; return self; }); def(MESSAGING, 'getConversationTitle', `()${CHARS}`, (r, _m, [self]) => ms(r, self).title ?? null);
  def(MESSAGING, 'setGroupConversation', `(Z)${MESSAGING}`, (r, _m, [self, v]) => { ms(r, self).group = !!v; return self; });
  const isGroup = (r, o) => (o.builder && targetSdk(r) < 28) ? !empty(r, o.title ?? null) : !!o.group;   // before Android P a conversation title implied a group
  def(MESSAGING, 'isGroupConversation', '()Z', (r, _m, [self]) => isGroup(r, ms(r, self)) ? 1 : 0);
  const addTo = (list, m) => { list.push(m); if (list.length > MAX_MESSAGES) list.shift(); };
  def(MESSAGING, 'addMessage', `(${CHARS}J${CHARS})${MESSAGING}`, (r, _m, [self, text_, time, sender]) => { const m = r.allocate(MESSAGE); r.object(m).message = { text: text_, time: BigInt(time), sender: named(r, sender), mime: null, uri: null, extras: null }; addTo(ms(r, self).messages, m); return self; });
  def(MESSAGING, 'addMessage', `(${CHARS}J${PERSON})${MESSAGING}`, (r, _m, [self, text_, time, sender]) => { const m = r.allocate(MESSAGE); r.object(m).message = { text: text_, time: BigInt(time), sender, mime: null, uri: null, extras: null }; addTo(ms(r, self).messages, m); return self; });
  def(MESSAGING, 'addMessage', `(${MESSAGE})${MESSAGING}`, (r, _m, [self, m]) => { addTo(ms(r, self).messages, m); return self; }); def(MESSAGING, 'addHistoricMessage', `(${MESSAGE})${MESSAGING}`, (r, _m, [self, m]) => { addTo(ms(r, self).historic, m); return self; });
  def(MESSAGING, 'getMessages', '()Ljava/util/List;', (r, _m, [self]) => newList(r, ms(r, self).messages)); def(MESSAGING, 'getHistoricMessages', '()Ljava/util/List;', (r, _m, [self]) => newList(r, ms(r, self).historic));
  const messageBundle = (r, m) => {
    const x = msg(r, m), b = platform.bundle(r);
    const put2 = (name, t, key, value) => call(r, b, BUNDLE, name, [STRING, t], 'V', [key, value]);
    put2('putCharSequence', CHARS, 'text', x.text); r.dispatch({ owner: BUNDLE, name: 'putLong', parameters: [STRING, 'J'], result: 'V', signature: `(${STRING}J)V` }, r.argumentWords([STRING, 'J'], ['time', x.time], { receiver: b }), 'virtual');
    if (x.sender !== null) { put2('putCharSequence', CHARS, 'sender', person(r, x.sender).name); put2('putParcelable', 'Landroid/os/Parcelable;', 'sender_person', x.sender); }
    if (x.mime !== null) put2('putString', STRING, 'type', x.mime); if (x.uri !== null) put2('putParcelable', 'Landroid/os/Parcelable;', 'uri', x.uri); if (x.extras !== null) put2('putBundle', BUNDLE, 'extras', x.extras);
    return b;
  };
  const bundleArray = (r, messages) => { const array = r.newArray('[Landroid/os/Parcelable;', messages.length); r.array(array).elements = messages.map(m => messageBundle(r, m)); return array; };
  const latestIncoming = (r, messages) => { for (let i = messages.length - 1; i >= 0; i--) { const sender = msg(r, messages[i]).sender; if (sender !== null && !empty(r, person(r, sender).name)) return messages[i]; } return messages.length ? messages.at(-1) : null; };

  const cs = (r, ref) => style(r, ref);
  const callStyle = (r, type_, who, intents) => {
    if (who === null || who === 0) r.throwJava('Ljava/lang/NullPointerException;', 'person is required');
    for (const [label, value] of Object.entries(intents)) if (value === null || value === 0) r.throwJava('Ljava/lang/NullPointerException;', `${label} is required`);
    const ref = r.allocate(CALL); Object.assign(cs(r, ref), { callType: type_, person: who, isVideo: false, answerColor: null, declineColor: null, verificationIcon: null, verificationText: null, ...intents }); return ref;
  };
  def(CALL, 'forIncomingCall', `(${PERSON}${PENDING}${PENDING})${CALL}`, (r, _m, [who, declineIntent, answerIntent]) => callStyle(r, 1, who, { declineIntent, answerIntent }), { static: true });
  def(CALL, 'forOngoingCall', `(${PERSON}${PENDING})${CALL}`, (r, _m, [who, hangUpIntent]) => callStyle(r, 2, who, { hangUpIntent }), { static: true });
  def(CALL, 'forScreeningCall', `(${PERSON}${PENDING}${PENDING})${CALL}`, (r, _m, [who, hangUpIntent, answerIntent]) => callStyle(r, 3, who, { hangUpIntent, answerIntent }), { static: true });
  def(CALL, 'setIsVideo', `(Z)${CALL}`, (r, _m, [self, v]) => { cs(r, self).isVideo = !!v; return self; }); def(CALL, 'setAnswerButtonColorHint', `(I)${CALL}`, (r, _m, [self, v]) => { cs(r, self).answerColor = v; return self; });
  def(CALL, 'setDeclineButtonColorHint', `(I)${CALL}`, (r, _m, [self, v]) => { cs(r, self).declineColor = v; return self; }); def(CALL, 'setVerificationIcon', `(${ICON})${CALL}`, (r, _m, [self, v]) => { cs(r, self).verificationIcon = v; return self; });
  def(CALL, 'setVerificationText', `(${CHARS})${CALL}`, (r, _m, [self, v]) => { cs(r, self).verificationText = v; return self; });
  for (const [name, value] of Object.entries({ CALL_TYPE_UNKNOWN: 0, CALL_TYPE_INCOMING: 1, CALL_TYPE_ONGOING: 2, CALL_TYPE_SCREENING: 3 })) registry.staticField(CALL, name, 'I', () => value);
  // Action.Builder.addRemoteInput / Action.getRemoteInputs
  def(ACTION_BUILDER, 'addRemoteInput', `(${REMOTE_INPUT})${ACTION_BUILDER}`, (r, _m, [self, input]) => { if (input !== null) (r.object(self).actionBuilder.remoteInputs ??= []).push(input); return self; });

  // ---- Styles: record their text; Builder.setStyle applies them ---------------------------------------------------------------------------------------------
  const style = (r, ref) => r.object(ref).style ??= { lines: [] };
  for (const owner of [BIG_TEXT, BIG_PICTURE, INBOX, MESSAGING, CALL]) {
    if (owner !== MESSAGING && owner !== CALL) def(owner, '<init>', '()V', () => {}); if (owner !== MESSAGING && owner !== CALL) def(owner, '<init>', `(${BUILDER})V`, (r, _m, [self, builder]) => { r.object(builder).builder.style = self; });
    def(owner, 'setBigContentTitle', `(${CHARS})${owner}`, (r, _m, [self, title]) => { style(r, self).bigTitle = title; return self; });
    def(owner, 'setSummaryText', `(${CHARS})${owner}`, (r, _m, [self, summary]) => { style(r, self).summary = summary; return self; });
  }
  def(BIG_TEXT, 'bigText', `(${CHARS})${BIG_TEXT}`, (r, _m, [self, text_]) => { style(r, self).bigText = text_; return self; });
  def(INBOX, 'addLine', `(${CHARS})${INBOX}`, (r, _m, [self, line]) => { if (line !== null) style(r, self).lines.push(line); return self; });
  def(BIG_PICTURE, 'bigPicture', `(${BITMAP})${BIG_PICTURE}`, (r, _m, [self, bitmap]) => { style(r, self).picture = bitmap; return self; });
  def(BIG_PICTURE, 'bigLargeIcon', `(${BITMAP})${BIG_PICTURE}`, (r, _m, [self, bitmap]) => { style(r, self).bigLargeIcon = bitmap; return self; });

  // ---- Notification.BubbleMetadata and its Builder (Notification.java, android-13.0.0_r1): same argument checks, messages and flag bits. The bubble is not shown (the virtual device has no
  // system UI); the metadata is recorded on the Notification and read back through getBubbleMetadata(). Parcel serialisation of the contained PendingIntent / Icon is not modelled.
  const BUBBLE = 'Landroid/app/Notification$BubbleMetadata;', BUBBLE_BUILDER = 'Landroid/app/Notification$BubbleMetadata$Builder;';
  type(BUBBLE, OBJECT, [], { allocatable: true }); type(BUBBLE_BUILDER, OBJECT, [], { allocatable: true }); registry.interfaces.set(BUBBLE, ['Landroid/os/Parcelable;']);
  const FLAG = { AUTO_EXPAND_BUBBLE: 1, SUPPRESS_NOTIFICATION: 2, SUPPRESSABLE_BUBBLE: 4, SUPPRESS_BUBBLE: 8 };
  for (const [name, value] of Object.entries(FLAG)) registry.staticField(BUBBLE, 'FLAG_' + name, 'I', () => value);
  const bubble = (r, ref) => r.object(ref).bubble ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Notification.BubbleMetadata used before construction');
  const bb = (r, ref) => r.object(ref).bubbleBuilder ??= { intent: null, icon: null, height: 0, heightRes: 0, flags: 0, deleteIntent: null, shortcutId: null };
  const NPE = 'Ljava/lang/NullPointerException;', IAE = 'Ljava/lang/IllegalArgumentException;', ISE = 'Ljava/lang/IllegalStateException;', URI_TYPES = [4, 5];
  const warnIcon = (r, icon) => { if (!URI_TYPES.includes(call(r, icon, ICON, 'getType', [], 'I'))) r.dispatch({ owner: 'Landroid/util/Log;', name: 'w', parameters: [STRING, STRING], result: 'I', signature: '(Ljava/lang/String;Ljava/lang/String;)I' }, ['Notification', 'Bubbles work best with icons of TYPE_URI or TYPE_URI_ADAPTIVE_BITMAP. In the future, using an icon of this type will be required.'], 'static'); };
  const isEmpty = (r, v) => v === null || v === 0 || r.stringCharacters(v) === '';
  def(BUBBLE_BUILDER, '<init>', '()V', (r, _m, [self]) => { bb(r, self); });
  def(BUBBLE_BUILDER, '<init>', `(${STRING})V`, (r, _m, [self, id]) => { if (isEmpty(r, id)) r.throwJava(NPE, 'Bubble requires a non-null shortcut id'); bb(r, self).shortcutId = id; });
  def(BUBBLE_BUILDER, '<init>', `(${PENDING}${ICON})V`, (r, _m, [self, intent, icon]) => {
    if (intent === null) r.throwJava(NPE, 'Bubble requires non-null pending intent'); if (icon === null) r.throwJava(NPE, 'Bubbles require non-null icon');
    warnIcon(r, icon); Object.assign(bb(r, self), { intent, icon });
  });
  def(BUBBLE_BUILDER, 'createShortcutBubble', `(${STRING})${BUBBLE_BUILDER}`, (r, _m, [self, id]) => { const b = bb(r, self); if (!isEmpty(r, id)) { b.intent = null; b.icon = null; } b.shortcutId = id; return self; });
  def(BUBBLE_BUILDER, 'createIntentBubble', `(${PENDING}${ICON})${BUBBLE_BUILDER}`, (r, _m, [self, intent, icon]) => {
    if (intent === null) r.throwJava(IAE, 'Bubble requires non-null pending intent'); if (icon === null) r.throwJava(IAE, 'Bubbles require non-null icon');
    warnIcon(r, icon); Object.assign(bb(r, self), { shortcutId: null, intent, icon }); return self;
  });
  def(BUBBLE_BUILDER, 'setIntent', `(${PENDING})${BUBBLE_BUILDER}`, (r, _m, [self, intent]) => {
    const b = bb(r, self); if (b.shortcutId !== null) r.throwJava(ISE, 'Created as a shortcut bubble, cannot set a PendingIntent. Consider using BubbleMetadata.Builder(PendingIntent,Icon) instead.');
    if (intent === null) r.throwJava(NPE, 'Bubble requires non-null pending intent'); b.intent = intent; return self;
  });
  def(BUBBLE_BUILDER, 'setIcon', `(${ICON})${BUBBLE_BUILDER}`, (r, _m, [self, icon]) => {
    const b = bb(r, self); if (b.shortcutId !== null) r.throwJava(ISE, 'Created as a shortcut bubble, cannot set an Icon. Consider using BubbleMetadata.Builder(PendingIntent,Icon) instead.');
    if (icon === null) r.throwJava(NPE, 'Bubbles require non-null icon'); warnIcon(r, icon); b.icon = icon; return self;
  });
  def(BUBBLE_BUILDER, 'setDesiredHeight', `(I)${BUBBLE_BUILDER}`, (r, _m, [self, height]) => { const b = bb(r, self); b.height = Math.max(height, 0); b.heightRes = 0; return self; });
  def(BUBBLE_BUILDER, 'setDesiredHeightResId', `(I)${BUBBLE_BUILDER}`, (r, _m, [self, id]) => { const b = bb(r, self); b.heightRes = id; b.height = 0; return self; });
  const flag = (name, bit) => def(BUBBLE_BUILDER, name, `(Z)${BUBBLE_BUILDER}`, (r, _m, [self, on]) => { const b = bb(r, self); b.flags = on ? b.flags | bit : b.flags & ~bit; return self; });
  flag('setAutoExpandBubble', FLAG.AUTO_EXPAND_BUBBLE); flag('setSuppressNotification', FLAG.SUPPRESS_NOTIFICATION); flag('setSuppressableBubble', FLAG.SUPPRESSABLE_BUBBLE);
  def(BUBBLE_BUILDER, 'setFlag', `(IZ)${BUBBLE_BUILDER}`, (r, _m, [self, mask, on]) => { const b = bb(r, self); b.flags = on ? b.flags | mask : b.flags & ~mask; return self; });
  def(BUBBLE_BUILDER, 'setDeleteIntent', `(${PENDING})${BUBBLE_BUILDER}`, (r, _m, [self, intent]) => { bb(r, self).deleteIntent = intent; return self; });
  def(BUBBLE_BUILDER, 'build', `()${BUBBLE}`, (r, _m, [self]) => {
    const b = bb(r, self);
    if (b.shortcutId === null && b.intent === null) r.throwJava(NPE, 'Must supply pending intent or shortcut to bubble');
    if (b.shortcutId === null && b.icon === null) r.throwJava(NPE, 'Must supply an icon or shortcut for the bubble');
    const data = r.allocate(BUBBLE); r.object(data).bubble = { ...b }; return data;
  });
  const bubbleGetter = (name, result, read) => def(BUBBLE, name, `()${result}`, (r, _m, [self]) => read(bubble(r, self)));
  for (const name of ['getIntent', 'getBubbleIntent']) bubbleGetter(name, PENDING, b => b.intent);
  bubbleGetter('getDeleteIntent', PENDING, b => b.deleteIntent); for (const name of ['getIcon', 'getBubbleIcon']) bubbleGetter(name, ICON, b => b.icon);
  bubbleGetter('getShortcutId', STRING, b => b.shortcutId); bubbleGetter('getDesiredHeight', 'I', b => b.height); bubbleGetter('getDesiredHeightResId', 'I', b => b.heightRes); bubbleGetter('getFlags', 'I', b => b.flags);
  for (const [name, bit] of [['getAutoExpandBubble', 1], ['isNotificationSuppressed', 2], ['isBubbleSuppressable', 4], ['isBubbleSuppressed', 8]]) bubbleGetter(name, 'Z', b => (b.flags & bit) !== 0 ? 1 : 0);
  def(BUBBLE, 'setSuppressNotification', '(Z)V', (r, _m, [self, on]) => { const b = bubble(r, self); b.flags = on ? b.flags | 2 : b.flags & ~2; });
  def(BUBBLE, 'setSuppressBubble', '(Z)V', (r, _m, [self, on]) => { const b = bubble(r, self); b.flags = on ? b.flags | 8 : b.flags & ~8; });
  def(BUBBLE, 'setFlags', '(I)V', (r, _m, [self, flags]) => { bubble(r, self).flags = flags; });
  def(BUBBLE, 'describeContents', '()I', () => 0);
  def(NOTIFICATION, 'getBubbleMetadata', `()${BUBBLE}`, (r, _m, [self]) => meta(r, self).bubbleMetadata ?? null);
  def(NOTIFICATION, 'getLocusId', '()Landroid/content/LocusId;', (r, _m, [self]) => meta(r, self).locusId ?? null);

  // ---- Notification.Builder -----------------------------------------------------------------------------------------------------------------------------
  const builder = (r, ref) => r.object(ref).builder ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Notification.Builder used before construction');
  const fresh = () => ({ when: null, showWhen: null, icon: 0, smallIcon: null, title: null, text: null, subText: null, info: null, number: 0, progress: null, contentIntent: null, deleteIntent: null, fullScreen: null, fullScreenHighPriority: false, ticker: null, largeIcon: null,
    sound: null, vibrate: null, lights: null, defaults: 0, flags: 0, priority: 0, category: null, color: 0, visibility: 0, publicVersion: null, extras: null, actions: [], people: [], style: null, channelId: null, group: null, groupSummary: false, groupAlert: 0, badge: 0, sortKey: null,
    timeoutAfter: 0n, shortcutId: null, chronometer: false, chronometerDown: false, colorized: false, onlyAlertOnce: false, autoCancel: false, ongoing: false, localOnly: false, audioStreamType: -1 });
  def(BUILDER, '<init>', `(${CONTEXT})V`, (r, _m, [self, context]) => { r.object(self).builder = { ...fresh(), context }; });
  def(BUILDER, '<init>', `(${CONTEXT}${STRING})V`, (r, _m, [self, context, channelId]) => { r.object(self).builder = { ...fresh(), context, channelId: text(r, channelId) }; });
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
  setter('setLocusId', 'Landroid/content/LocusId;', (b, [v]) => { b.locusId = v; }); setter('setBubbleMetadata', 'Landroid/app/Notification$BubbleMetadata;', (b, [v]) => { b.bubbleMetadata = v; });
  setter('setStyle', STYLE, (b, [v], r) => { b.style = v; if (v !== null) style(r, v).builder = true; });
  setter('addPerson', PERSON, (b, [v]) => { if (v !== null) b.people.push(v); }); setter('addPerson', STRING, (b, [v], r) => { b.people.push(newPerson(r, { name: null, icon: null, uri: v, key: null, bot: false, important: false })); }); setter('setAllowSystemGeneratedContextualActions', 'Z', () => {}); setter('setForegroundServiceBehavior', 'I', (b, [v]) => { b.foregroundBehavior = v; });
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
      else if (owner === MESSAGING) {
        const user = o.user ?? null;
        if (targetSdk(r) >= 28 && (user === null || person(r, user).name === null)) r.throwJava('Ljava/lang/RuntimeException;', 'User must be valid and have a name.');   // MessagingStyle.validate
        call(r, extras, BUNDLE, 'putString', [STRING, STRING], 'V', [EXTRAS.EXTRA_TEMPLATE, 'android.app.Notification$MessagingStyle']);
        if (user !== null) { putText(EXTRAS.EXTRA_SELF_DISPLAY_NAME, person(r, user).name); call(r, extras, BUNDLE, 'putParcelable', [STRING, 'Landroid/os/Parcelable;'], 'V', [EXTRAS.EXTRA_MESSAGING_PERSON, user]); }
        putText(EXTRAS.EXTRA_CONVERSATION_TITLE, o.title ?? null);
        if (o.messages?.length) call(r, extras, BUNDLE, 'putParcelableArray', [STRING, '[Landroid/os/Parcelable;'], 'V', [EXTRAS.EXTRA_MESSAGES, bundleArray(r, o.messages)]);
        if (o.historic?.length) call(r, extras, BUNDLE, 'putParcelableArray', [STRING, '[Landroid/os/Parcelable;'], 'V', [EXTRAS.EXTRA_HISTORIC_MESSAGES, bundleArray(r, o.historic)]);
        putBool(EXTRAS.EXTRA_IS_GROUP_CONVERSATION, isGroup(r, o));
        // MessagingStyle.fixTitleAndTextExtras: the title is the conversation title, else the latest incoming sender; the text is that message's text
        const latest = latestIncoming(r, o.messages ?? []), lm = latest === null ? null : msg(r, latest);
        const sender = lm === null ? null : (lm.sender === null || empty(r, person(r, lm.sender).name)) ? (user === null ? null : person(r, user).name) : person(r, lm.sender).name;
        const title = !empty(r, o.title ?? null) ? o.title : !empty(r, sender) ? sender : null;
        putText(EXTRAS.EXTRA_TITLE, title); if (lm !== null) putText(EXTRAS.EXTRA_TEXT, lm.text);
      } else if (owner === CALL) {
        call(r, extras, BUNDLE, 'putString', [STRING, STRING], 'V', [EXTRAS.EXTRA_TEMPLATE, 'android.app.Notification$CallStyle']);
        putInt(EXTRAS.EXTRA_CALL_TYPE, o.callType); putBool(EXTRAS.EXTRA_CALL_IS_VIDEO, o.isVideo);
        const parcel = (key, value) => { if (value !== null && value !== undefined) call(r, extras, BUNDLE, 'putParcelable', [STRING, 'Landroid/os/Parcelable;'], 'V', [key, value]); };
        parcel(EXTRAS.EXTRA_CALL_PERSON, o.person); parcel(EXTRAS.EXTRA_VERIFICATION_ICON, o.verificationIcon); putText(EXTRAS.EXTRA_VERIFICATION_TEXT, o.verificationText);
        parcel(EXTRAS.EXTRA_ANSWER_INTENT, o.answerIntent); parcel(EXTRAS.EXTRA_DECLINE_INTENT, o.declineIntent); parcel(EXTRAS.EXTRA_HANG_UP_INTENT, o.hangUpIntent);
        if (o.answerColor !== null) putInt(EXTRAS.EXTRA_ANSWER_COLOR, o.answerColor); if (o.declineColor !== null) putInt(EXTRAS.EXTRA_DECLINE_COLOR, o.declineColor);
      }
      else throw new APKError(`Notification style ${owner} is not implemented`, { kind: 'unsupported-notification' });
    }
    if (b.people.length) call(r, extras, BUNDLE, 'putParcelableArrayList', [STRING, 'Ljava/util/ArrayList;'], 'V', [EXTRAS.EXTRA_PEOPLE_LIST, newList(r, b.people)]);
    if (b.remoteInputHistory) call(r, extras, BUNDLE, 'putCharSequenceArray', [STRING, '[' + CHARS], 'V', [EXTRAS.EXTRA_REMOTE_INPUT_HISTORY, b.remoteInputHistory]);
    if (b.channelId !== null) call(r, extras, BUNDLE, 'putString', [STRING, STRING], 'V', [EXTRAS.EXTRA_CHANNEL_ID, b.channelId]);
    const flags = (b.ongoing ? 2 : 0) | (b.onlyAlertOnce ? 8 : 0) | (b.autoCancel ? 16 : 0) | (b.localOnly ? 256 : 0) | (b.groupSummary ? 512 : 0) | (b.lights ? 1 : 0) | (b.priority > 0 ? 128 : 0) | (b.foregroundBehavior === 1 ? 0 : 0);
    const defaults = b.defaults | 0, lights = b.lights;
    for (const [name, t, value] of [['when', 'J', b.when ?? BigInt(Math.trunc(platform.clock.wall()))], ['icon', 'I', b.icon], ['number', 'I', b.number], ['contentIntent', PENDING, b.contentIntent], ['deleteIntent', PENDING, b.deleteIntent], ['fullScreenIntent', PENDING, b.fullScreen],
      ['tickerText', CHARS, b.ticker], ['largeIcon', BITMAP, b.largeIcon], ['sound', URI, b.sound], ['audioStreamType', 'I', b.audioStreamType], ['vibrate', '[J', b.vibrate], ['ledARGB', 'I', lights?.argb ?? 0], ['ledOnMS', 'I', lights?.on ?? 0], ['ledOffMS', 'I', lights?.off ?? 0],
      ['defaults', 'I', defaults], ['flags', 'I', flags | (defaults & 4 ? 1 : 0)], ['priority', 'I', b.priority], ['category', STRING, b.category], ['color', 'I', b.color], ['visibility', 'I', b.visibility], ['publicVersion', NOTIFICATION, b.publicVersion], ['extras', BUNDLE, extras]]) put(r, n, name, t, value);
    if (b.actions.length) { const actions = r.newArray(`[${ACTION}`, b.actions.length); r.array(actions).elements = [...b.actions]; put(r, n, 'actions', `[${ACTION}`, actions); }
    Object.assign(meta(r, n), { channelId: b.channelId, group: b.group, sortKey: b.sortKey, timeoutAfter: b.timeoutAfter, smallIcon: b.smallIcon, largeIcon: b.largeIconObject ?? null, groupAlert: b.groupAlert, badgeIcon: b.badge, shortcutId: b.shortcutId, settingsText: b.settingsText ?? null, bubbleMetadata: b.bubbleMetadata ?? null, locusId: b.locusId ?? null });
    return n;
  }
  return { ...registry, interfaces: registry.interfacesOf };
}
