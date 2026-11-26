import { APKError } from './apk-error.js?v=858dc45125cc';
import { gcRoot } from './heap-gc.js?v=858dc45125cc';

// The broadcast queue of the virtual device (ActivityManagerService.broadcastIntentLocked + BroadcastQueue, android-13.0.0_r1), for every installed package (the app and the
// companion packages of src/package-registry.js):
//  * resolution: the receivers registered at run time (Context.registerReceiver: the IntentFilter copied at registration, as the Binder call parcels it) and the receivers the
//    manifests declare (their <intent-filter> actions and categories); an Intent with a component goes to that manifest receiver only, one with a package to that package's
//    receivers only; FLAG_RECEIVER_REGISTERED_ONLY skips the manifests; an implicit broadcast reaches no manifest receiver of a package that targets API 26+ unless it carries
//    FLAG_RECEIVER_INCLUDE_BACKGROUND (the background-execution limit, BroadcastQueue "Background execution not allowed");
//  * permissions: the permission a receiver requires (registerReceiver's broadcastPermission, android:permission) must be held by the sender, the receiverPermission(s) of
//    sendBroadcast by the receiving package; a receiver registered with RECEIVER_NOT_EXPORTED, or a manifest receiver that is not exported, only hears its own uid; a denial is
//    the "Permission Denial" line ActivityManager logs, never an error to the sender;
//  * delivery: each receiver runs on the main thread of its package's process (started first for a manifest receiver, which is instantiated by its package's class loader and
//    told onReceive(Application context, Intent)); an Intent that crosses to another package is parcelled and read back with the receiving package's class loader
//    (Intent.writeToParcel / readFromParcel, src/intent-api-host.js), so its extras are that package's own classes;
//  * order: the registered receivers of a normal broadcast run independently, its manifest receivers one after the other; an ordered broadcast runs every receiver one after the
//    other by priority (registered first at equal priority), carrying its result code/data/extras, until one aborts; the sender's result receiver runs last with the final result;
//  * BroadcastReceiver.goAsync / PendingResult: a receiver may keep its broadcast open past onReceive and finish it later from any thread; the next receiver of a serial
//    delivery waits for that finish (or for the broadcast timeout, 10 s for a foreground broadcast and 60 s otherwise, after which the queue moves on as ActivityManager does).
// The system's own broadcasts (configuration, locale, battery, connectivity: device-state-host.js) keep going to registered receivers only.
const INTENT = 'Landroid/content/Intent;', RECEIVER = 'Landroid/content/BroadcastReceiver;', CONTEXT = 'Landroid/content/Context;', FILTER = 'Landroid/content/IntentFilter;', BUNDLE = 'Landroid/os/Bundle;', STRING = 'Ljava/lang/String;', OBJECT = 'Ljava/lang/Object;';
export const PENDING_RESULT = 'Landroid/content/BroadcastReceiver$PendingResult;';
const FLAG = { RECEIVER_REGISTERED_ONLY: 0x40000000, RECEIVER_FOREGROUND: 0x10000000, RECEIVER_INCLUDE_BACKGROUND: 0x01000000, RECEIVER_EXCLUDE_BACKGROUND: 0x00800000 };
const RECEIVER_NOT_EXPORTED = 4;
const nullish = v => v === null || v === undefined || v === 0;

export function installBroadcastQueue({ platform, def, type, filterOf }) {
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], 'virtual');
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const packages = () => platform.packages?.multi ? platform.packages : null;
  const P = () => platform.packages;
  const registrations = gcRoot([]);     // { receiver, filter (snapshot IntentFilter), actions, context, entry, permission, exported, priority }
  const pending = gcRoot(new Set());    // the PendingResult objects of deliveries in progress (goAsync keeps them past onReceive)

  // ---- registration ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** A copy of `filter` (the IntentFilter a registration keeps, as the Binder call to ActivityManager parcels it): later changes of the app's object do not change the registration. */
  const snapshot = (r, filter) => {
    const copy = r.makeObject(FILTER), state = filterOf(r, filter), clone = value => Array.isArray(value) ? value.map(item => item && typeof item === 'object' && !item.ref ? { ...item } : item) : value;
    r.object(copy).intentFilter = Object.fromEntries(Object.entries(state).map(([key, value]) => [key, clone(value)]));
    return copy;
  };
  const register = (r, context, receiver, filter, { permission = null, flags = 0 } = {}) => {
    const entry = packages() ? packages().contextEntry(r, context) : null, copy = snapshot(r, filter);
    const record = { receiver, filter: copy, actions: filterOf(r, copy).actions, context, entry, permission: nullish(permission) ? null : text(r, permission), exported: !(flags & RECEIVER_NOT_EXPORTED), priority: filterOf(r, copy).priority ?? 0 };
    registrations.push(record);
    return record;
  };
  const unregister = (r, receiver) => {
    const at = registrations.findIndex(entry => entry.receiver.ref === receiver?.ref);
    if (at < 0) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Receiver not registered: ' + r.typeOf(receiver));
    for (let i = registrations.length - 1; i >= 0; i--) if (registrations[i].receiver.ref === receiver.ref) registrations.splice(i, 1);
  };

  // ---- resolution ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const intentFields = (r, intent) => {
    const o = r.object(intent), component = call(r, intent, INTENT, 'getComponent', [], 'Landroid/content/ComponentName;');
    return { action: text(r, o.action), package: text(r, o.package), flags: o.flags | 0, categories: (o.categories ?? []).map(c => text(r, c)), data: o.data ?? null, type: text(r, o.mimeType),
      component: nullish(component) ? null : { packageName: text(r, r.object(component).packageName), className: text(r, r.object(component).className) } };
  };
  const entryName = entry => entry ? entry.name : platform.packageName;
  const entryUid = entry => entry ? entry.uid : platform.virtualProcess.uid;
  const sameUid = (a, b) => entryUid(a) === entryUid(b);
  const holds = (r, entry, permission) => entry && !entry.main ? P().holds(r, entry, permission) : platform.holdsPermission(r, permission);
  const allEntries = () => packages() ? packages().entries() : [null];
  const manifestOf = entry => entry ? entry.manifest : platform.manifest;
  const targetSdkOf = entry => entry && !entry.main ? P().targetSdk(entry) : Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1);
  const isFalse = value => value === false || value === 0 || value === 'false';
  const isTrue = value => value === true || value === -1 || value === 0xffffffff || value === 'true' || (Number.isInteger(value) && value !== 0);
  const exportedReceiver = (entry, detail) => detail.exported !== undefined && detail.exported !== null ? isTrue(detail.exported) : (detail.actions?.length ?? 0) > 0;
  const describe = (r, intent) => { const f = intentFields(r, intent), parts = []; if (f.action) parts.push(`act=${f.action}`); if (f.categories.length) parts.push(`cat=[${f.categories.join(',')}]`); if (f.package) parts.push(`pkg=${f.package}`); if (f.component) parts.push(`cmp=${f.component.packageName}/${f.component.className}`); if (f.flags) parts.push(`flg=0x${(f.flags >>> 0).toString(16)}`); return `Intent { ${parts.join(' ')} }`; };
  const deny = (r, message) => r.record(`LOG W BroadcastQueue: ${message}`);
  /** The filters of a manifest component: its <intent-filter> records (actions, categories), or one made of its actions for a manifest parsed without them. */
  const manifestFilters = detail => detail.filters?.length ? detail.filters : (detail.actions?.length ? [{ actions: detail.actions, categories: [], data: [], priority: 0 }] : []);
  const manifestMatch = (f, filter) => (!f.action || filter.actions.includes(f.action)) && f.categories.every(c => filter.categories.includes(c)) && (filter.data?.length ? f.data !== null || f.type !== null : f.data === null && f.type === null);

  /** The receivers of a broadcast, in delivery order, with the checks of broadcastIntentLocked / BroadcastQueue.skipReceiverLocked. `sender`: the sending package (null: the system). */
  const resolve = (r, intent, sender, { receiverPermissions = [], ordered = false }) => {
    const f = intentFields(r, intent), system = sender === undefined, registered = [], manifest = [];
    const allowedTo = (r, entry, required, label) => {
      if (required && !system && !holds(r, sender, required)) { deny(r, `Permission Denial: broadcasting ${describe(r, intent)} from ${entryName(sender)} (uid=${entryUid(sender)}) requires ${required} due to receiver ${label}`); return false; }
      for (const permission of receiverPermissions) if (!holds(r, entry, permission)) { deny(r, `Permission Denial: receiving ${describe(r, intent)} to ${label} requires ${permission} due to sender ${system ? 'android' : entryName(sender)} (uid ${system ? 1000 : entryUid(sender)})`); return false; }
      return true;
    };
    if (!f.component) for (const record of registrations) {
      if (f.package && entryName(record.entry) !== f.package) continue;
      if (call(r, record.filter, FILTER, 'match', ['Landroid/content/ContentResolver;', INTENT, 'Z', STRING], 'I', [null, intent, 0, 'BroadcastQueue']) < 0) continue;
      const label = `${entryName(record.entry)}/${r.typeOf(record.receiver).slice(1, -1).replaceAll('/', '.').replace(/\$\$ldr\d+$/, '')}`;
      if (!record.exported && !system && !sameUid(sender, record.entry)) { deny(r, `Permission Denial: receiving ${describe(r, intent)} to ${label}: the receiver is not exported (RECEIVER_NOT_EXPORTED) and the sender is uid ${entryUid(sender)}`); continue; }
      if (!allowedTo(r, record.entry, record.permission, label)) continue;
      registered.push({ kind: 'registered', record, entry: record.entry, priority: record.priority });
    }
    if (!(f.flags & FLAG.RECEIVER_REGISTERED_ONLY)) for (const entry of allEntries()) {
      const name = entryName(entry);
      if (f.package && name !== f.package) continue;
      if (f.component && f.component.packageName !== name) continue;
      for (const detail of (manifestOf(entry)?.componentDetails ?? []).filter(d => d.kind === 'receiver' && !isFalse(d.enabled))) {
        if (f.component && f.component.className !== detail.name) continue;
        const filter = f.component ? null : manifestFilters(detail).find(candidate => manifestMatch(f, candidate));
        if (!f.component && !filter) continue;
        const label = `${name}/${detail.name}`;
        if (!f.component && !f.package && targetSdkOf(entry) >= 26 && !(f.flags & FLAG.RECEIVER_INCLUDE_BACKGROUND)) { deny(r, `Background execution not allowed: receiving ${describe(r, intent)} to ${label}`); continue; }
        if (!system && !sameUid(sender, entry) && !exportedReceiver(entry, detail)) { deny(r, `Permission Denial: broadcasting ${describe(r, intent)} from ${entryName(sender)} (uid=${entryUid(sender)}) is not exported from uid ${entryUid(entry)} due to receiver ${label}`); continue; }
        if (!allowedTo(r, entry, detail.permission, label)) continue;
        manifest.push({ kind: 'manifest', entry, detail, priority: filter?.priority ?? 0 });
      }
    }
    if (!ordered) return { parallel: registered, serial: manifest };
    const byPriority = (a, b) => b.priority - a.priority;   // Array.prototype.sort is stable: registered receivers stay ahead of manifest ones of the same priority
    return { parallel: [], serial: [...registered, ...manifest].sort(byPriority) };
  };

  // ---- delivery --------------------------------------------------------------------------------------------------------------------------------------------------------------------
  type(PENDING_RESULT, OBJECT, [], { allocatable: true });
  const resultOf = (r, ref) => r.object(ref).broadcastResult ?? r.throwJava('Ljava/lang/IllegalStateException;', 'PendingResult used before construction');
  const makePendingResult = (r, broadcast, delivery, done) => {
    const ref = r.makeObject(PENDING_RESULT);
    r.object(ref).broadcastResult = { broadcast, delivery, done, finished: false, ordered: broadcast.ordered, initialSticky: false };
    pending.add(ref); return ref;
  };
  const finish = (r, ref) => {
    const state = resultOf(r, ref);
    if (state.finished) r.throwJava('Ljava/lang/IllegalStateException;', 'Broadcast already finished');
    state.finished = true; pending.delete(ref);
    if (state.timer) state.timer.cancelled = true;
    state.done();
  };
  /** The Intent a receiver of package `entry` gets: the sender's own object within one package, a parcelled copy for another package (its class loader reads the extras). */
  const intentFor = (r, broadcast, entry, component = null) => {
    let intent = broadcast.intent;
    if (packages() && entryName(entry) !== broadcast.senderName) intent = platform.intentCrossCopy(r, intent, P().loaderOf(r, entry ?? P().main));
    if (component) {   // BroadcastQueue sets the receiver's component on the Intent a manifest receiver gets
      if (intent === broadcast.intent) { const copy = r.allocate(INTENT); r.dispatch({ owner: INTENT, name: '<init>', parameters: [INTENT], result: 'V', signature: `(${INTENT})V` }, [copy, intent], 'direct'); intent = copy; }
      const name = r.allocate('Landroid/content/ComponentName;'); r.dispatch({ owner: 'Landroid/content/ComponentName;', name: '<init>', parameters: [STRING, STRING], result: 'V', signature: `(${STRING}${STRING})V` }, [name, component.packageName, component.className], 'direct');
      call(r, intent, INTENT, 'setComponent', ['Landroid/content/ComponentName;'], INTENT, [name]);
    }
    return intent;
  };
  /** A manifest receiver: its package's process, a new instance of its class, the Application of that package as Context. */
  const manifestReceiver = (r, delivery) => {
    const entry = delivery.entry;
    if (entry && !entry.main) {
      P().ensureProcess(r, entry);
      const type = P().typeIn(r, entry, delivery.detail.name);
      if (!type) throw new APKError(`Unable to instantiate receiver ${entry.name}/${delivery.detail.name}: the class is not in the package`, { kind: 'package-receiver-class' });
      const ref = r.allocate(type); r.dispatch({ owner: type, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [ref], 'direct');
      return { ref, context: P().application(entry) };
    }
    const type = `L${delivery.detail.name.replaceAll('.', '/')};`;
    if (!r.classes.has(type)) throw new APKError(`Unable to instantiate receiver ${platform.packageName}/${delivery.detail.name}: the class is not in the APK`, { kind: 'receiver-class' });
    const ref = r.allocate(type); r.dispatch({ owner: type, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [ref], 'direct');
    return { ref, context: platform.application };
  };
  /** One receiver's turn: onReceive with a PendingResult attached; unless goAsync took it, the broadcast is finished for this receiver when onReceive returns. */
  const deliverOne = (r, broadcast, delivery, done) => {
    const target = delivery.kind === 'registered' ? { ref: delivery.record.receiver, context: delivery.record.context } : manifestReceiver(r, delivery);
    const intent = intentFor(r, broadcast, delivery.entry, delivery.kind === 'manifest' ? { packageName: entryName(delivery.entry), className: delivery.detail.name } : null);
    const result = makePendingResult(r, broadcast, delivery, done), o = r.object(target.ref), state = resultOf(r, result);
    o.pendingResult = result;
    if (!broadcast.ordered && delivery.kind === 'manifest') {   // a serial delivery that never finishes holds the queue only until the broadcast timeout
      const timer = state.timer = { cancelled: false };
      platform.queueTask(() => { if (timer.cancelled || state.finished) return; r.record(`LOG W BroadcastQueue: Timeout of broadcast ${describe(r, intent)} - receiver=${entryName(delivery.entry)}/${delivery.detail.name}`); state.finished = true; pending.delete(result); done(); }, broadcast.timeoutMs, [result]);
    }
    r.record(`BROADCAST deliver ${describe(r, intent)} -> ${delivery.kind === 'manifest' ? `${entryName(delivery.entry)}/${delivery.detail.name}` : `${entryName(delivery.entry)} registered receiver`}${broadcast.ordered ? ' (ordered)' : ''}`);
    try { call(r, target.ref, RECEIVER, 'onReceive', [CONTEXT, INTENT], 'V', [target.context, intent]); }
    finally { if (o.pendingResult && o.pendingResult.ref === result.ref) { o.pendingResult = null; if (!state.finished) finish(r, result); } }
  };
  /** Runs `deliveries` one after the other (each after the previous finished), then `after`. Result fields travel in broadcast.result. */
  const serial = (r, broadcast, deliveries, after) => {
    let index = 0;
    const next = () => {
      if (broadcast.result.aborted || index >= deliveries.length) { after?.(); return; }
      const delivery = deliveries[index++];
      platform.queueTask(() => deliverOne(r, broadcast, delivery, next), 0, [broadcast.intent]);
    };
    next();
  };
  /**
   * Context.sendBroadcast and its variants. `context`: the sender's Context (its package is the sender), or null for the system. `options`: receiverPermissions (each must be held
   * by a receiving package), ordered, resultReceiver / initialCode / initialData / initialExtras (sendOrderedBroadcast), resultContext (the Context the result receiver runs with).
   */
  const send = (r, context, intent, options = {}) => {
    if (nullish(intent)) r.throwJava('Ljava/lang/NullPointerException;', null);
    const system = context === null, sender = system ? undefined : packages() ? packages().contextEntry(r, context) : null;
    const ordered = options.ordered === true, f = intentFields(r, intent);
    const broadcast = { intent, ordered, senderName: system ? 'android' : entryName(sender), result: { code: options.initialCode ?? -1, data: options.initialData ?? null, extras: options.initialExtras ?? null, aborted: false }, timeoutMs: (f.flags & FLAG.RECEIVER_FOREGROUND) ? 10000 : 60000 };
    const { parallel, serial: chain } = resolve(r, intent, sender, { receiverPermissions: (options.receiverPermissions ?? []).filter(p => !nullish(p)).map(p => text(r, p)), ordered });
    r.record(`BROADCAST ${ordered ? 'ordered ' : ''}${describe(r, intent)} from ${broadcast.senderName}: ${parallel.length} registered, ${chain.length} ${ordered ? 'in order' : 'manifest'}`);
    for (const delivery of parallel) platform.queueTask(() => { if (registrations.includes(delivery.record)) deliverOne(r, broadcast, delivery, () => {}); }, 0, [delivery.record.receiver, intent]);
    const finalReceiver = nullish(options.resultReceiver) ? null : options.resultReceiver;
    serial(r, broadcast, chain, finalReceiver ? () => platform.queueTask(() => {
      const result = makePendingResult(r, { ...broadcast, ordered: false }, null, () => {}), o = r.object(finalReceiver);
      o.pendingResult = result; o.finalResultHint = true;
      try { call(r, finalReceiver, RECEIVER, 'onReceive', [CONTEXT, INTENT], 'V', [options.resultContext ?? context ?? platform.application, intent]); }
      finally { o.finalResultHint = false; if (o.pendingResult && o.pendingResult.ref === result.ref) { o.pendingResult = null; if (!resultOf(r, result).finished) finish(r, result); } }
    }, 0, [finalReceiver, intent]) : null);
  };

  // ---- BroadcastReceiver and PendingResult (android-13.0.0_r1 BroadcastReceiver.java) ------------------------------------------------------------------------------------------------
  type(RECEIVER, OBJECT, [], { allocatable: true });
  // BroadcastReceiver.onReceive is abstract: a call that names the base class dispatches on the receiver's own class, and only a receiver without the method ends here (as ART answers)
  def(RECEIVER, 'onReceive', `(${CONTEXT}${INTENT})V`, r => r.throwJava('Ljava/lang/AbstractMethodError;', 'abstract method "void android.content.BroadcastReceiver.onReceive(android.content.Context, android.content.Intent)"'));
  def(RECEIVER, '<init>', '()V', () => {});
  const current = (r, self) => r.object(self).pendingResult ?? null;
  /** BroadcastReceiver.checkSynchronousHint: a result call outside an ordered (or initial sticky) delivery is logged, not refused. */
  const checkSynchronousHint = (r, self) => {
    const p = current(r, self); if (!p) r.throwJava('Ljava/lang/IllegalStateException;', 'Call while result is not pending');
    const state = resultOf(r, p); if (state.ordered || state.initialSticky || r.object(self).finalResultHint) return state;
    r.record('LOG E BroadcastReceiver: BroadcastReceiver trying to return result during a non-ordered broadcast'); return state;
  };
  const resultState = state => state.broadcast.result;
  def(RECEIVER, 'getResultCode', '()I', (r, _m, [self]) => { const p = current(r, self); return p ? resultState(resultOf(r, p)).code | 0 : 0; });
  def(RECEIVER, 'getResultData', `()${STRING}`, (r, _m, [self]) => { const p = current(r, self); return p ? resultState(resultOf(r, p)).data : null; });
  def(RECEIVER, 'getResultExtras', `(Z)${BUNDLE}`, (r, _m, [self, makeMap]) => {
    const p = current(r, self); if (!p) return null; const result = resultState(resultOf(r, p));
    if (nullish(result.extras) && makeMap) { result.extras = r.makeObject(BUNDLE); r.object(result.extras).extras = new Map(); }
    return result.extras ?? null;
  });
  def(RECEIVER, 'setResultCode', '(I)V', (r, _m, [self, code]) => { resultState(checkSynchronousHint(r, self)).code = code | 0; });
  def(RECEIVER, 'setResultData', `(${STRING})V`, (r, _m, [self, data]) => { resultState(checkSynchronousHint(r, self)).data = data; });
  def(RECEIVER, 'setResultExtras', `(${BUNDLE})V`, (r, _m, [self, extras]) => { resultState(checkSynchronousHint(r, self)).extras = extras; });
  def(RECEIVER, 'setResult', `(I${STRING}${BUNDLE})V`, (r, _m, [self, code, data, extras]) => { const result = resultState(checkSynchronousHint(r, self)); result.code = code | 0; result.data = data; result.extras = extras; });
  def(RECEIVER, 'getAbortBroadcast', '()Z', (r, _m, [self]) => { const p = current(r, self); return p && resultState(resultOf(r, p)).aborted ? 1 : 0; });
  def(RECEIVER, 'abortBroadcast', '()V', (r, _m, [self]) => { const state = checkSynchronousHint(r, self); if (state.ordered) resultState(state).aborted = true; });
  def(RECEIVER, 'clearAbortBroadcast', '()V', (r, _m, [self]) => { const p = current(r, self); if (p) resultState(resultOf(r, p)).aborted = false; });
  def(RECEIVER, 'isOrderedBroadcast', '()Z', (r, _m, [self]) => { const p = current(r, self); return p && resultOf(r, p).ordered ? 1 : 0; });
  def(RECEIVER, 'isInitialStickyBroadcast', '()Z', (r, _m, [self]) => r.object(self).initialSticky ? 1 : 0);
  def(RECEIVER, 'setOrderedHint', '(Z)V', () => {});
  def(RECEIVER, 'setDebugUnregister', '(Z)V', (r, _m, [self, value]) => { r.object(self).debugUnregister = !!value; });
  def(RECEIVER, 'getDebugUnregister', '()Z', (r, _m, [self]) => r.object(self).debugUnregister ? 1 : 0);
  // goAsync: the receiver takes its PendingResult; the broadcast stays open for it until PendingResult.finish
  def(RECEIVER, 'goAsync', `()${PENDING_RESULT}`, (r, _m, [self]) => { const p = current(r, self); r.object(self).pendingResult = null; return p; });
  def(RECEIVER, 'getPendingResult', `()${PENDING_RESULT}`, (r, _m, [self]) => current(r, self));
  def(RECEIVER, 'setPendingResult', `(${PENDING_RESULT})V`, (r, _m, [self, p]) => { r.object(self).pendingResult = nullish(p) ? null : p; });
  def(RECEIVER, 'peekService', `(${CONTEXT}${INTENT})Landroid/os/IBinder;`, () => null);   // ActivityManager.peekService: no service of another process is running bound for peeking
  def(PENDING_RESULT, 'getResultCode', '()I', (r, _m, [self]) => resultState(resultOf(r, self)).code | 0);
  def(PENDING_RESULT, 'getResultData', `()${STRING}`, (r, _m, [self]) => resultState(resultOf(r, self)).data);
  def(PENDING_RESULT, 'getResultExtras', `(Z)${BUNDLE}`, (r, _m, [self, makeMap]) => { const result = resultState(resultOf(r, self)); if (nullish(result.extras) && makeMap) { result.extras = r.makeObject(BUNDLE); r.object(result.extras).extras = new Map(); } return result.extras ?? null; });
  def(PENDING_RESULT, 'setResultCode', '(I)V', (r, _m, [self, code]) => { resultState(resultOf(r, self)).code = code | 0; });
  def(PENDING_RESULT, 'setResultData', `(${STRING})V`, (r, _m, [self, data]) => { resultState(resultOf(r, self)).data = data; });
  def(PENDING_RESULT, 'setResultExtras', `(${BUNDLE})V`, (r, _m, [self, extras]) => { resultState(resultOf(r, self)).extras = extras; });
  def(PENDING_RESULT, 'setResult', `(I${STRING}${BUNDLE})V`, (r, _m, [self, code, data, extras]) => { const result = resultState(resultOf(r, self)); result.code = code | 0; result.data = data; result.extras = extras; });
  def(PENDING_RESULT, 'getAbortBroadcast', '()Z', (r, _m, [self]) => resultState(resultOf(r, self)).aborted ? 1 : 0);
  def(PENDING_RESULT, 'abortBroadcast', '()V', (r, _m, [self]) => { const state = resultOf(r, self); if (state.ordered) resultState(state).aborted = true; });
  def(PENDING_RESULT, 'clearAbortBroadcast', '()V', (r, _m, [self]) => { resultState(resultOf(r, self)).aborted = false; });
  // finish() may come from any thread (the work goAsync moved off the main thread); the next receiver then runs on the main thread, as AMS schedules it
  def(PENDING_RESULT, 'finish', '()V', (r, _m, [self]) => finish(r, self));

  return { register, unregister, send, registrations, pendingResults: pending, FLAG };
}
