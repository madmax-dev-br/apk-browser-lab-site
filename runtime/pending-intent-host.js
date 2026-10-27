import { APKError } from './apk-error.js?v=92e35e57822f';
import { createHostRegistry } from './host-contract.js?v=92e35e57822f';
import { gcRoot, GC_ROOTS } from './heap-gc.js?v=92e35e57822f';

// android.app.PendingIntent (android-13.0.0_r1 PendingIntent.java + ActivityManagerService.getIntentSenderLocked): tokens are identified by (kind, package, requestCode, Intent.filterEquals),
// FLAG_NO_CREATE / FLAG_CANCEL_CURRENT / FLAG_UPDATE_CURRENT / FLAG_ONE_SHOT behave as documented, and apps targeting API 31+ must say FLAG_IMMUTABLE or FLAG_MUTABLE.
// send() hands the Intent to the same delivery paths the app itself would use (sendBroadcast / startActivity on the application Context); starting a Service from one is not modelled.
const PENDING = 'Landroid/app/PendingIntent;', CONTEXT = 'Landroid/content/Context;', INTENT = 'Landroid/content/Intent;', STRING = 'Ljava/lang/String;', BUNDLE = 'Landroid/os/Bundle;';
const FLAG = { ONE_SHOT: 1 << 30, NO_CREATE: 1 << 29, CANCEL_CURRENT: 1 << 28, UPDATE_CURRENT: 1 << 27, IMMUTABLE: 1 << 26, MUTABLE: 1 << 25, ALLOW_UNSAFE_IMPLICIT_INTENT: 1 << 24 };
const KIND = { activity: 2, broadcast: 1, service: 4, foregroundService: 5 };

export function createPendingIntentHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  type(PENDING, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;']);
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
  def(PENDING, 'getActivity', `(${CONTEXT}I${INTENT}I${BUNDLE})${PENDING}`, (r, m, args) => get(KIND.activity)(r, m, args.slice(0, 4)), { static: true });
  const tokenOf = (r, self) => tokens.get(r.object(self).tokenKey);
  def(PENDING, 'cancel', '()V', (r, _m, [self]) => { const token = tokenOf(r, self); if (token) { token.canceled = true; tokens.delete(r.object(self).tokenKey); } });
  const send = (r, self, extra) => {
    const token = tokenOf(r, self); if (!token || token.canceled) r.throwJava('Landroid/app/PendingIntent$CanceledException;', null);
    if (token.flags & FLAG.ONE_SHOT) { token.canceled = true; tokens.delete(r.object(self).tokenKey); }
    r.record(`PENDINGINTENT send kind=${token.kind}`);
    const context = platform.application;
    if (token.kind === KIND.broadcast) call(r, CONTEXT, 'sendBroadcast', [INTENT], 'V', [context, token.intent]);
    else if (token.kind === KIND.activity) call(r, CONTEXT, 'startActivity', [INTENT], 'V', [context, token.intent]);
    else throw new APKError('PendingIntent.send() for a Service: starting services from a PendingIntent is not modelled by the virtual device', { kind: 'pending-intent-service-unsupported' });
  };
  def(PENDING, 'send', '()V', (r, _m, [self]) => send(r, self));
  def(PENDING, 'send', `(${CONTEXT}I${INTENT})V`, (r, _m, [self]) => send(r, self));
  def(PENDING, 'send', '(I)V', (r, _m, [self]) => send(r, self));
  def(PENDING, 'getCreatorPackage', `()${STRING}`, () => platform.packageName); def(PENDING, 'getCreatorUid', '()I', () => platform.virtualProcess.uid);
  def(PENDING, 'isImmutable', '()Z', (r, _m, [self]) => (tokenOf(r, self)?.flags ?? 0) & FLAG.IMMUTABLE ? 1 : 0);
  def(PENDING, 'hashCode', '()I', (r, _m, [self]) => [...r.object(self).tokenKey].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0));
  def(PENDING, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => other && r.typeOf(other) === PENDING && r.object(other).tokenKey === r.object(self).tokenKey ? 1 : 0);
  def(PENDING, 'toString', `()${STRING}`, (r, _m, [self]) => `PendingIntent{${r.object(self).tokenKey ? 'live' : 'unknown'}}`);
  return { ...registry, [GC_ROOTS](visit) { for (const token of tokens.values()) visit(token); } };
}
