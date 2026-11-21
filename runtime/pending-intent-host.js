import { APKError } from './apk-error.js?v=7233e918dcc9';
import { createHostRegistry } from './host-contract.js?v=7233e918dcc9';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=7233e918dcc9';

// android.app.PendingIntent (android-13.0.0_r1 PendingIntent.java + ActivityManagerService.getIntentSenderLocked): tokens are identified by (kind, package, requestCode, Intent.filterEquals),
// FLAG_NO_CREATE / FLAG_CANCEL_CURRENT / FLAG_UPDATE_CURRENT / FLAG_ONE_SHOT behave as documented, and apps targeting API 31+ must say FLAG_IMMUTABLE or FLAG_MUTABLE.
// send() hands the Intent to the same delivery paths the app itself would use (sendBroadcast / startActivity on the application Context); starting a Service from one is not modelled.
const SENDER = 'Landroid/content/IntentSender;', ON_FINISHED = 'Landroid/app/PendingIntent$OnFinished;', HANDLER = 'Landroid/os/Handler;', PENDING = 'Landroid/app/PendingIntent;', CONTEXT = 'Landroid/content/Context;', INTENT = 'Landroid/content/Intent;', STRING = 'Ljava/lang/String;', BUNDLE = 'Landroid/os/Bundle;';
const FLAG = { ONE_SHOT: 1 << 30, NO_CREATE: 1 << 29, CANCEL_CURRENT: 1 << 28, UPDATE_CURRENT: 1 << 27, IMMUTABLE: 1 << 26, MUTABLE: 1 << 25, ALLOW_UNSAFE_IMPLICIT_INTENT: 1 << 24 };
const KIND = { activity: 2, broadcast: 1, service: 4, foregroundService: 5, result: 100 };

export function createPendingIntentHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(PENDING, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;']); type(SENDER, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;'], { allocatable: true });
  for (const [name, value] of Object.entries({ FLAG_ONE_SHOT: FLAG.ONE_SHOT, FLAG_NO_CREATE: FLAG.NO_CREATE, FLAG_CANCEL_CURRENT: FLAG.CANCEL_CURRENT, FLAG_UPDATE_CURRENT: FLAG.UPDATE_CURRENT, FLAG_IMMUTABLE: FLAG.IMMUTABLE, FLAG_MUTABLE: FLAG.MUTABLE, FLAG_ALLOW_UNSAFE_IMPLICIT_INTENT: FLAG.ALLOW_UNSAFE_IMPLICIT_INTENT })) registry.staticField(PENDING, name, 'I', () => value);
  /** token key -> { object (PendingIntent ref), intent (Intent ref, mutable by UPDATE_CURRENT), flags, canceled, sent } */
  const tokens = gcRoot(new Map());
  const call = (r, owner, name, parameters, result, args, mode = 'virtual') => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, mode);
  const text = (r, value) => value === null || value === 0 || value === undefined ? '' : r.javaString(value);
  /** Intent.filterEquals: action, data, type, identifier, package, component and categories (extras and flags do not take part). */
  const filterKey = (r, intent) => {
    const o = r.object(intent), data = o.data ? text(r, call(r, 'Landroid/net/Uri;', 'toString', [], STRING, [o.data])) : '', component = o.component ? text(r, call(r, 'Landroid/content/ComponentName;', 'flattenToString', [], STRING, [o.component])) : '';
    return JSON.stringify([text(r, o.action), data, text(r, o.mimeType), o.package ? text(r, o.package) : '', component, o.target ?? '', [...(o.categories ?? [])].map(c => text(r, c)).sort()]);
  };
  // The package that creates a PendingIntent owns it (ActivityManagerService.getIntentSenderLocked records the caller's package and uid): its targetSdk decides the mutability rule,
  // it is part of the token's identity, and send() delivers as that package (from its Context), whoever holds the token. Without a companion package (src/package-registry.js) the
  // creator is always the app and the token key is the single-package one.
  const packages = () => platform.packages?.multi ? platform.packages : null;
  const creatorOf = (r, context) => packages() && !(context === null || context === 0) ? packages().contextEntry(r, context) : null;
  const targetSdk = (creator = null) => creator && !creator.main ? packages().targetSdk(creator) : Number(platform.manifest?.usesSdk?.targetSdkVersion ?? platform.manifest?.usesSdk?.minSdkVersion ?? 1);
  function get(kind) {
    return (r, _m, [context, requestCode, intent, flags]) => {
      if (intent === null || intent === 0) r.throwJava('Ljava/lang/NullPointerException;', 'intent');
      flags |= 0;
      const creator = creatorOf(r, context), creatorName = creator ? creator.name : platform.packageName;
      if (targetSdk(creator) >= 31 && !(flags & (FLAG.IMMUTABLE | FLAG.MUTABLE))) r.throwJava('Ljava/lang/IllegalArgumentException;', `${creatorName}: Targeting S+ (version 31 and above) requires that one of FLAG_IMMUTABLE or FLAG_MUTABLE be specified when creating a PendingIntent.\nStrongly consider using FLAG_IMMUTABLE, only use FLAG_MUTABLE if some functionality depends on the PendingIntent being mutable, e.g. if it needs to be used with inline replies or bubbles.`);
      if ((flags & FLAG.IMMUTABLE) && (flags & FLAG.MUTABLE)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Cannot set both FLAG_IMMUTABLE and FLAG_MUTABLE for PendingIntent');
      const key = `${creator && !creator.main ? creator.name + '#' : ''}${kind}|${requestCode}|${filterKey(r, intent)}`, existing = tokens.get(key);
      if (existing && !existing.canceled) {
        if (flags & FLAG.CANCEL_CURRENT) { existing.canceled = true; tokens.delete(key); }
        else {
          if (flags & FLAG.UPDATE_CURRENT) existing.intent = intent;     // the stored Intent takes the new extras (a real one merges them; the whole Intent replaces here, same observable result for extras)
          return existing.object;
        }
      }
      if (flags & FLAG.NO_CREATE) return null;
      const object = r.makeObject(PENDING); r.object(object).tokenKey = key;
      tokens.set(key, { object, intent, flags, canceled: false, kind, creator: creator && !creator.main ? creator : null });
      return object;
    };
  }
  for (const [name, kind] of [['getBroadcast', KIND.broadcast], ['getActivity', KIND.activity], ['getService', KIND.service], ['getForegroundService', KIND.foregroundService]]) def(PENDING, name, `(${CONTEXT}I${INTENT}I)${PENDING}`, get(kind), { static: true });
  // getActivities: the token is identified by the LAST intent (the top-most activity; ActivityManagerService compares requestIntent only), and sending starts all of them (Context.startActivities).
  const getMany = (r, m, [context, requestCode, intents, flags]) => {
    if (intents === null || intents === 0) r.throwJava('Ljava/lang/NullPointerException;', null);
    const all = r.array(intents).elements; if (!all.length) r.throwJava('Ljava/lang/ArrayIndexOutOfBoundsException;', 'length=0; index=-1');
    const result = get(KIND.activity)(r, m, [context, requestCode, all.at(-1), flags]); if (result === null) return null;
    const token = tokens.get(r.object(result).tokenKey); if (token) token.intents = [...all]; return result;
  };
  def(PENDING, 'getActivities', `(${CONTEXT}I[${INTENT}I)${PENDING}`, getMany, { static: true }); def(PENDING, 'getActivities', `(${CONTEXT}I[${INTENT}I${BUNDLE})${PENDING}`, (r, m, args) => getMany(r, m, args.slice(0, 4)), { static: true });
  def(PENDING, 'getActivity', `(${CONTEXT}I${INTENT}I${BUNDLE})${PENDING}`, (r, m, args) => get(KIND.activity)(r, m, args.slice(0, 4)), { static: true });
  // Parcel: PendingIntent.writeToParcel writes the strong binder of its IIntentSender; the VM is one process, so the binder written is the PendingIntent's own token object and
  // reading it back (CREATOR, readPendingIntentOrNullFromParcel) gives the same PendingIntent, as two references to one IIntentSender compare equal on Android.
  const PARCEL = 'Landroid/os/Parcel;', IBINDER = 'Landroid/os/IBinder;', CREATOR = 'Landroid/os/Parcelable$Creator;', PENDING_CREATOR = 'Landroid/app/PendingIntent$1;';
  type(PENDING_CREATOR, 'Ljava/lang/Object;', [CREATOR], { allocatable: true });
  const writePending = (r, pending, out) => call(r, PARCEL, 'writeStrongBinder', [IBINDER], 'V', [out, pending === null || pending === 0 ? null : pending]);
  const readPending = (r, input) => {
    const value = call(r, PARCEL, 'readStrongBinder', [], IBINDER, [input]); if (value === null || value === 0) return null;
    if (!r.isSubtype(r.object(value).type, PENDING)) throw new APKError('PendingIntent from a Parcel: the binder read is not a PendingIntent of this device (a remote IIntentSender needs a Binder driver)', { kind: 'pending-intent-parcel' });
    return value;
  };
  def(PENDING, 'writeToParcel', `(${PARCEL}I)V`, (r, _m, [self, out]) => writePending(r, self, out));
  def(PENDING, 'describeContents', '()I', () => 0);
  def(PENDING, 'writePendingIntentOrNullToParcel', `(${PENDING}${PARCEL})V`, (r, _m, [pending, out]) => writePending(r, pending, out), { static: true });
  def(PENDING, 'readPendingIntentOrNullFromParcel', `(${PARCEL})${PENDING}`, (r, _m, [input]) => readPending(r, input), { static: true });
  def(PENDING_CREATOR, 'createFromParcel', `(${PARCEL})Ljava/lang/Object;`, (r, _m, [, input]) => readPending(r, input));
  def(PENDING_CREATOR, 'newArray', '(I)[Ljava/lang/Object;', (r, _m, [, size]) => r.newArray(`[${PENDING}`, size));
  registry.staticField(PENDING, 'CREATOR', CREATOR, r => r.allocate(PENDING_CREATOR));
  const tokenOf = (r, self) => tokens.get(r.object(self).tokenKey);
  def(PENDING, 'cancel', '()V', (r, _m, [self]) => { const token = tokenOf(r, self); if (token) { token.canceled = true; tokens.delete(r.object(self).tokenKey); } });
  const send = (r, self, code = 0, extra = null) => {
    const token = tokenOf(r, self); if (!token || token.canceled) r.throwJava('Landroid/app/PendingIntent$CanceledException;', null);
    if (token.flags & FLAG.ONE_SHOT) { token.canceled = true; tokens.delete(r.object(self).tokenKey); }
    r.record(`PENDINGINTENT send kind=${token.kind}${token.creator ? ` creator=${token.creator.name}` : ''}`);
    // The Context it is sent from is the creator's (PendingIntentRecord.sendInner runs as the creating uid); the intent sent is the stored one, filled in with the sender's intent
    // (Intent.fillIn with the flags given at creation: none here) unless the token is immutable.
    let context = platform.application;
    if (token.creator) { packages().ensureProcess(r, token.creator); context = packages().application(token.creator); }
    // The sender's fill-in Intent leaves its process (IIntentSender.send parcels it): a package other than the creator hands over a copy read with the creator's class loader
    if (packages() && !(extra === null || extra === 0) && packages().callerEntry(r) !== (token.creator ?? packages().main)) extra = platform.intentCrossCopy(r, extra, packages().loaderOf(r, token.creator ?? packages().main));
    const intentToSend = () => {
      if (extra === null || extra === 0 || (token.flags & FLAG.IMMUTABLE) || token.kind === KIND.result || token.intent === null) return token.intent;
      const copy = r.allocate(INTENT); r.dispatch({ owner: INTENT, name: '<init>', parameters: [INTENT], result: 'V', signature: `(${INTENT})V` }, [copy, token.intent], 'direct');
      call(r, INTENT, 'fillIn', [INTENT, 'I'], 'I', [copy, extra, 0]); return copy;
    };
    if (token.kind === KIND.service || token.kind === KIND.foregroundService) { call(r, CONTEXT, token.kind === KIND.service ? 'startService' : 'startForegroundService', [INTENT], 'Landroid/content/ComponentName;', [context, intentToSend()]); return; }
    if (token.kind === KIND.result) {
      // Activity.createPendingResult: send(code, intent) delivers onActivityResult(requestCode, code, data) to the Activity, once it is resumed (the result queue of its Activity record)
      const frame = platform.allFrames().find(entry => entry.activity.ref === token.activity.ref); if (!frame) throw new APKError('PendingIntent.send(): the Activity that created this result is gone', { kind: 'pending-result-gone' });
      (frame.pendingActivityResults ||= []).push({ requestCode: token.requestCode, resultCode: code | 0, data: extra ?? token.intent ?? null });
      platform.queueTask(() => { if (platform.allFrames().includes(frame)) platform.deliverActivityResults(r, frame); }, 0, [token.activity, token.intent, extra]);
    } else if (token.kind === KIND.broadcast) call(r, CONTEXT, 'sendBroadcast', [INTENT], 'V', [context, intentToSend()]);
    else if (token.kind === KIND.activity && token.intents) { const array = r.newArray(`[${INTENT}`, token.intents.length); r.array(array).elements = [...token.intents]; platform.asSystemLaunch(() => call(r, CONTEXT, 'startActivities', [`[${INTENT}`], 'V', [context, array])); }
    else if (token.kind === KIND.activity) platform.asSystemLaunch(() => call(r, CONTEXT, 'startActivity', [INTENT], 'V', [context, intentToSend()]));
    else throw new APKError(`PendingIntent.send() of kind ${token.kind}: not a kind the virtual device creates`, { kind: 'pending-intent-kind' });
  };
  def(PENDING, 'send', '()V', (r, _m, [self]) => send(r, self));
  def(PENDING, 'send', `(${CONTEXT}I${INTENT})V`, (r, _m, [self, , code, intent]) => send(r, self, code, intent));
  def(PENDING, 'send', '(I)V', (r, _m, [self, code]) => send(r, self, code));
  // send(..., OnFinished, Handler): onSendFinished(pendingIntent, intent, resultCode, resultData, resultExtras) runs on the Handler's thread (the main thread here) once the target was started or the
  // broadcast was delivered; as in PendingIntentRecord.sendInner, an Activity/Service target reports resultCode 0 right after the start, a broadcast reports the code it was sent with. A receiver that changes the
  // ordered result is not reflected (the virtual broadcast queue has no final-receiver stage; see Context.sendOrderedBroadcast).
  const sendWithCallback = (r, self, code, intent, finished) => {
    const token = tokenOf(r, self), kind = token?.kind; send(r, self, code, intent);
    if (finished === null || finished === 0) return;
    const sentIntent = intent ?? token.intent;
    platform.queueTask(() => call(r, ON_FINISHED, 'onSendFinished', [PENDING, INTENT, 'I', STRING, BUNDLE], 'V', [finished, self, sentIntent, kind === KIND.broadcast ? code | 0 : 0, null, null]), 0, [finished, self, sentIntent]);
  };
  def(PENDING, 'send', `(I${ON_FINISHED}${HANDLER})V`, (r, _m, [self, code, finished]) => sendWithCallback(r, self, code, null, finished));
  def(PENDING, 'send', `(${CONTEXT}I${INTENT}${ON_FINISHED}${HANDLER})V`, (r, _m, [self, , code, intent, finished]) => sendWithCallback(r, self, code, intent, finished));
  def(PENDING, 'send', `(${CONTEXT}I${INTENT}${ON_FINISHED}${HANDLER}${STRING})V`, (r, _m, [self, , code, intent, finished]) => sendWithCallback(r, self, code, intent, finished));
  def(PENDING, 'send', `(${CONTEXT}I${INTENT}${ON_FINISHED}${HANDLER}${STRING}${BUNDLE})V`, (r, _m, [self, , code, intent, finished]) => sendWithCallback(r, self, code, intent, finished));
  // IntentSender: the same token seen through its sender interface
  def(PENDING, 'getIntentSender', `()${SENDER}`, (r, _m, [self]) => { const sender = r.allocate(SENDER); r.object(sender).pending = self; return sender; });
  const pendingOf = (r, sender) => r.object(sender).pending;
  def(SENDER, 'sendIntent', `(${CONTEXT}I${INTENT}Landroid/content/IntentSender$OnFinished;${HANDLER})V`, (r, _m, [self, , code, intent]) => { const pending = pendingOf(r, self), token = tokenOf(r, pending); if (!token || token.canceled) r.throwJava('Landroid/content/IntentSender$SendIntentException;', null); send(r, pending, code, intent); });
  const creatorEntry = (r, pending) => tokenOf(r, pending)?.creator ?? null;
  def(SENDER, 'getCreatorPackage', `()${STRING}`, (r, _m, [self]) => creatorEntry(r, pendingOf(r, self))?.name ?? platform.packageName); def(SENDER, 'getTargetPackage', `()${STRING}`, (r, _m, [self]) => creatorEntry(r, pendingOf(r, self))?.name ?? platform.packageName); def(SENDER, 'getCreatorUid', '()I', (r, _m, [self]) => creatorEntry(r, pendingOf(r, self))?.uid ?? platform.virtualProcess.uid);
  def(SENDER, 'hashCode', '()I', (r, _m, [self]) => [...r.object(pendingOf(r, self)).tokenKey].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0));
  def(SENDER, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => other && r.typeOf(other) === SENDER && r.object(pendingOf(r, other)).tokenKey === r.object(pendingOf(r, self)).tokenKey ? 1 : 0);
  def(SENDER, 'describeContents', '()I', () => 0);
  def(PENDING, 'getCreatorPackage', `()${STRING}`, (r, _m, [self]) => creatorEntry(r, self)?.name ?? platform.packageName); def(PENDING, 'getCreatorUid', '()I', (r, _m, [self]) => creatorEntry(r, self)?.uid ?? platform.virtualProcess.uid);
  def(PENDING, 'getTargetPackage', `()${STRING}`, (r, _m, [self]) => creatorEntry(r, self)?.name ?? platform.packageName);
  def(PENDING, 'isImmutable', '()Z', (r, _m, [self]) => (tokenOf(r, self)?.flags ?? 0) & FLAG.IMMUTABLE ? 1 : 0);
  def(PENDING, 'hashCode', '()I', (r, _m, [self]) => [...r.object(self).tokenKey].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0));
  def(PENDING, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => other && r.typeOf(other) === PENDING && r.object(other).tokenKey === r.object(self).tokenKey ? 1 : 0);
  def(PENDING, 'toString', `()${STRING}`, (r, _m, [self]) => `PendingIntent{${r.object(self).tokenKey ? 'live' : 'unknown'}}`);
  /**
   * Activity.startIntentSenderForResult / Context.startIntentSender (ActivityTaskManagerService.startActivityIntentSender -> PendingIntentRecord.sendInner): an Activity token is
   * started as its creator (its uid decides what it may start: a package's own non-exported Activity included) with the calling Activity as the source and result target, so
   * it joins the caller's task and its result comes back to the caller's onActivityResult; the fill-in Intent and flagsMask/flagsValues apply unless the token is immutable.
   * A token of another kind is sent as PendingIntent.send would.
   */
  const startIntentSender = (r, sender, { caller = null, requestCode = -1, fillIn = null, flagsMask = 0, flagsValues = 0, fromActivity = true } = {}) => {
    const pending = pendingOf(r, sender), token = pending ? tokenOf(r, pending) : null;
    if (!pending) throw new APKError('IntentSender start: this IntentSender was not created from a PendingIntent of the virtual device', { kind: 'intent-sender-unsupported' });
    if (!token || token.canceled) r.throwJava('Landroid/content/IntentSender$SendIntentException;', null);
    if (token.kind !== KIND.activity || token.intents) { send(r, pending, 0, fillIn); return; }
    if (token.flags & FLAG.ONE_SHOT) { token.canceled = true; tokens.delete(r.object(pending).tokenKey); }
    const creator = token.creator ?? packages()?.main ?? null;
    if (creator && !creator.main) packages().ensureProcess(r, creator);
    let intent = token.intent;
    if (!(token.flags & FLAG.IMMUTABLE)) {
      if (fillIn !== null && packages() && packages().callerEntry(r) !== (creator ?? packages().main)) fillIn = platform.intentCrossCopy(r, fillIn, packages().loaderOf(r, creator ?? packages().main));
      intent = r.allocate(INTENT); r.dispatch({ owner: INTENT, name: '<init>', parameters: [INTENT], result: 'V', signature: `(${INTENT})V` }, [intent, token.intent], 'direct');
      if (fillIn !== null) call(r, INTENT, 'fillIn', [INTENT, 'I'], 'I', [intent, fillIn, 0]);
      const mask = flagsMask & ~0xc3, values = flagsValues & mask;   // Intent.IMMUTABLE_FLAGS (the URI grant flags) are never changed by the sender
      if (mask) r.object(intent).flags = ((r.object(intent).flags | 0) & ~mask) | values;
    }
    r.record(`PENDINGINTENT startIntentSender kind=${token.kind}${token.creator ? ` creator=${token.creator.name}` : ''} requestCode=${requestCode}`);
    platform.startActivity(r, intent, requestCode >= 0 ? caller : null, requestCode, { fromActivity, caller, callerEntry: creator ?? undefined });
  };
  /** Activity.createPendingResult(requestCode, data, flags): a token that, sent, delivers an activity result to `activity`. */
  const createResult = (r, activity, requestCode, data, flags) => {
    const key = `result|${activity.ref}|${requestCode}`, existing = tokens.get(key); flags |= 0;
    if (existing && !existing.canceled && !(flags & FLAG.CANCEL_CURRENT)) { if (flags & FLAG.UPDATE_CURRENT) existing.intent = data; return existing.object; }
    if (flags & FLAG.NO_CREATE) return null;
    const object = r.makeObject(PENDING); r.object(object).tokenKey = key; tokens.set(key, { object, intent: data, flags, canceled: false, kind: KIND.result, activity, requestCode }); return object;
  };
  return { ...registry, createResult, startIntentSender, [GC_ROOTS](visit) { for (const token of tokens.values()) visit(token); } };
}
