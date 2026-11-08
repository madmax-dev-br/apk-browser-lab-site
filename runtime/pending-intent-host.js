import { APKError } from './apk-error.js?v=9796aad5420d';
import { createHostRegistry } from './host-contract.js?v=9796aad5420d';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=9796aad5420d';

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
  const targetSdk = () => Number(platform.manifest?.usesSdk?.targetSdkVersion ?? platform.manifest?.usesSdk?.minSdkVersion ?? 1);
  function get(kind) {
    return (r, _m, [context, requestCode, intent, flags]) => {
      if (intent === null || intent === 0) r.throwJava('Ljava/lang/NullPointerException;', 'intent');
      flags |= 0;
      if (targetSdk() >= 31 && !(flags & (FLAG.IMMUTABLE | FLAG.MUTABLE))) r.throwJava('Ljava/lang/IllegalArgumentException;', `${platform.packageName}: Targeting S+ (version 31 and above) requires that one of FLAG_IMMUTABLE or FLAG_MUTABLE be specified when creating a PendingIntent.\nStrongly consider using FLAG_IMMUTABLE, only use FLAG_MUTABLE if some functionality depends on the PendingIntent being mutable, e.g. if it needs to be used with inline replies or bubbles.`);
      if ((flags & FLAG.IMMUTABLE) && (flags & FLAG.MUTABLE)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Cannot set both FLAG_IMMUTABLE and FLAG_MUTABLE for PendingIntent');
      const key = `${kind}|${requestCode}|${filterKey(r, intent)}`, existing = tokens.get(key);
      if (existing && !existing.canceled) {
        if (flags & FLAG.CANCEL_CURRENT) { existing.canceled = true; tokens.delete(key); }
        else {
          if (flags & FLAG.UPDATE_CURRENT) existing.intent = intent;     // the stored Intent takes the new extras (a real one merges them; the whole Intent replaces here, same observable result for extras)
          return existing.object;
        }
      }
      if (flags & FLAG.NO_CREATE) return null;
      const object = r.makeObject(PENDING); r.object(object).tokenKey = key;
      tokens.set(key, { object, intent, flags, canceled: false, kind });
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
  const tokenOf = (r, self) => tokens.get(r.object(self).tokenKey);
  def(PENDING, 'cancel', '()V', (r, _m, [self]) => { const token = tokenOf(r, self); if (token) { token.canceled = true; tokens.delete(r.object(self).tokenKey); } });
  const send = (r, self, code = 0, extra = null) => {
    const token = tokenOf(r, self); if (!token || token.canceled) r.throwJava('Landroid/app/PendingIntent$CanceledException;', null);
    if (token.flags & FLAG.ONE_SHOT) { token.canceled = true; tokens.delete(r.object(self).tokenKey); }
    r.record(`PENDINGINTENT send kind=${token.kind}`);
    const context = platform.application;
    if (token.kind === KIND.result) {
      // Activity.createPendingResult: send(code, intent) delivers onActivityResult(requestCode, code, data) to the Activity, once it is resumed (the result queue of its Activity record)
      const frame = platform.allFrames().find(entry => entry.activity.ref === token.activity.ref); if (!frame) throw new APKError('PendingIntent.send(): the Activity that created this result is gone', { kind: 'pending-result-gone' });
      (frame.pendingActivityResults ||= []).push({ requestCode: token.requestCode, resultCode: code | 0, data: extra ?? token.intent ?? null });
      platform.queueTask(() => { if (platform.allFrames().includes(frame)) platform.deliverActivityResults(r, frame); }, 0, [token.activity, token.intent, extra]);
    } else if (token.kind === KIND.broadcast) call(r, CONTEXT, 'sendBroadcast', [INTENT], 'V', [context, token.intent]);
    else if (token.kind === KIND.activity && token.intents) { const array = r.newArray(`[${INTENT}`, token.intents.length); r.array(array).elements = [...token.intents]; platform.asSystemLaunch(() => call(r, CONTEXT, 'startActivities', [`[${INTENT}`], 'V', [context, array])); }
    else if (token.kind === KIND.activity) platform.asSystemLaunch(() => call(r, CONTEXT, 'startActivity', [INTENT], 'V', [context, token.intent]));
    else throw new APKError('PendingIntent.send() for a Service: starting services from a PendingIntent is not modelled by the virtual device', { kind: 'pending-intent-service-unsupported' });
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
  def(SENDER, 'getCreatorPackage', `()${STRING}`, () => platform.packageName); def(SENDER, 'getTargetPackage', `()${STRING}`, () => platform.packageName); def(SENDER, 'getCreatorUid', '()I', () => platform.virtualProcess.uid);
  def(SENDER, 'hashCode', '()I', (r, _m, [self]) => [...r.object(pendingOf(r, self)).tokenKey].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0));
  def(SENDER, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => other && r.typeOf(other) === SENDER && r.object(pendingOf(r, other)).tokenKey === r.object(pendingOf(r, self)).tokenKey ? 1 : 0);
  def(SENDER, 'describeContents', '()I', () => 0);
  def(PENDING, 'getCreatorPackage', `()${STRING}`, () => platform.packageName); def(PENDING, 'getCreatorUid', '()I', () => platform.virtualProcess.uid);
  def(PENDING, 'isImmutable', '()Z', (r, _m, [self]) => (tokenOf(r, self)?.flags ?? 0) & FLAG.IMMUTABLE ? 1 : 0);
  def(PENDING, 'hashCode', '()I', (r, _m, [self]) => [...r.object(self).tokenKey].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0));
  def(PENDING, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => other && r.typeOf(other) === PENDING && r.object(other).tokenKey === r.object(self).tokenKey ? 1 : 0);
  def(PENDING, 'toString', `()${STRING}`, (r, _m, [self]) => `PendingIntent{${r.object(self).tokenKey ? 'live' : 'unknown'}}`);
  /** Activity.createPendingResult(requestCode, data, flags): a token that, sent, delivers an activity result to `activity`. */
  const createResult = (r, activity, requestCode, data, flags) => {
    const key = `result|${activity.ref}|${requestCode}`, existing = tokens.get(key); flags |= 0;
    if (existing && !existing.canceled && !(flags & FLAG.CANCEL_CURRENT)) { if (flags & FLAG.UPDATE_CURRENT) existing.intent = data; return existing.object; }
    if (flags & FLAG.NO_CREATE) return null;
    const object = r.makeObject(PENDING); r.object(object).tokenKey = key; tokens.set(key, { object, intent: data, flags, canceled: false, kind: KIND.result, activity, requestCode }); return object;
  };
  return { ...registry, createResult, [GC_ROOTS](visit) { for (const token of tokens.values()) visit(token); } };
}
