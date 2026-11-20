import { createHostRegistry } from './host-contract.js?v=d5fbbbba7c85';
import { Blocked } from './scheduler.js?v=d5fbbbba7c85';
import { gcRoot } from './heap-gc.js?v=d5fbbbba7c85';

// AccountManager's requests that go through an account authenticator (android.accounts.AccountManager / AccountManagerService, android-13.0.0_r1): addAccount, getAuthToken,
// getAuthTokenByFeatures, confirmCredentials, updateCredentials, editProperties, hasFeatures, getAccountsByTypeAndFeatures, removeAccount, isCredentialsUpdateSuggested and
// getAuthTokenLabel. The client side is AccountManager's AmsTask / Future2Task (an AccountManagerFuture whose callback runs on the given Handler, or the main Looper); the service side
// is AccountManagerService's Session, run here as the system (uid 1000):
//  * the authenticator is the service of the package that declares the account type (src/account-store.js: its android.accounts.AccountAuthenticator intent filter and meta-data);
//    the system binds it as system_server does (exported or not, src/app-services-host.js bindServiceAsSystem), and calls it through the original IAccountAuthenticator Proxy
//    (framework-aosp/profiles/accounts) over system_server's reference to the binder (system-services-host.js SystemBinderRef): a oneway transaction, served on a Binder thread
//    of the authenticator's process with the system's identity, so the original Transport's checkBinderPermission finds ACCOUNT_MANAGER;
//  * the authenticator answers through the session's IAccountAuthenticatorResponse (this file's AccountSession: a Binder of the system, so a package reaches it through the
//    generated Proxy, also oneway): onResult / onRequestContinued / onError, possibly much later from an Activity of its own that got the response in an Intent (KEY_INTENT);
//  * Session.onResult as the service does it: a KEY_INTENT must open an Activity of the authenticator's package (or one signed alike: checkKeyIntent); with an Activity of the
//    caller (expectActivityLaunch) the session stays open for the real answer and the caller's Activity starts the Intent (AmsTask.Response.onResult); an error code in the result
//    is delivered as an error; stripAuthTokenFromResult; getAuthToken saves a non-custom token, asks getAuthTokenLabel instead when the caller may not use the account.
// What the virtual device does not have fails by name: the system's own account screens (GrantCredentialsPermissionActivity, the account chooser) and an implicit KEY_INTENT.
const ACCOUNTS = 'Landroid/accounts/AccountManagerImpl;', ACCOUNT = 'Landroid/accounts/Account;', FUTURE = 'Lapkweb/bridge/AccountFuture;', FUTURE_I = 'Landroid/accounts/AccountManagerFuture;';
const ACCOUNT_CB = 'Landroid/accounts/AccountManagerCallback;', UNITS = 'Ljava/util/concurrent/TimeUnit;', SESSION = 'Lapkweb/bridge/AccountSession;', RESPONSE_I = 'Landroid/accounts/IAccountAuthenticatorResponse;';
const AUTH_STUB = 'Landroid/accounts/IAccountAuthenticator$Stub;', AUTH_I = 'Landroid/accounts/IAccountAuthenticator;', BINDER = 'Landroid/os/Binder;', IBINDER = 'Landroid/os/IBinder;', PARCEL = 'Landroid/os/Parcel;';
const BUNDLE = 'Landroid/os/Bundle;', STRING = 'Ljava/lang/String;', INTENT = 'Landroid/content/Intent;', ACTIVITY = 'Landroid/app/Activity;', HANDLER = 'Landroid/os/Handler;', OBJECT = 'Ljava/lang/Object;';
const COMPONENT = 'Landroid/content/ComponentName;', RUNNABLE = 'Ljava/lang/Runnable;', DELIVERY = 'Lapkweb/bridge/TelephonyDelivery;', PARCELABLE = 'Landroid/os/Parcelable;';
const RESPONSE_DESCRIPTOR = 'android.accounts.IAccountAuthenticatorResponse', ACTION_AUTHENTICATOR_INTENT = 'android.accounts.AccountAuthenticator';
const K = Object.freeze({ INTENT: 'intent', AUTHTOKEN: 'authtoken', NAME: 'authAccount', TYPE: 'accountType', BOOLEAN: 'booleanResult', ERROR_CODE: 'errorCode', ERROR_MESSAGE: 'errorMessage', PACKAGE: 'androidPackageName',
  CALLER_UID: 'callerUid', CALLER_PID: 'callerPid', NOTIFY: 'notifyOnAuthFailure', LABEL: 'authTokenLabelKey', LAST_AUTHENTICATED: 'lastAuthenticatedTime', ACCOUNTS: 'accounts', EXPIRY: 'android.accounts.expiry', ACCESS_ID: 'accountAccessId' });
const E = Object.freeze({ REMOTE: 1, NETWORK: 3, CANCELED: 4, INVALID_RESPONSE: 5, UNSUPPORTED: 6, BAD_ARGUMENTS: 7, USER_RESTRICTED: 100, MANAGEMENT_DISABLED: 101 });
const GRANT_FLAGS = 0x1 | 0x2 | 0x40 | 0x80;   // FLAG_GRANT_READ/WRITE_URI_PERMISSION, FLAG_GRANT_PERSISTABLE_URI_PERMISSION, FLAG_GRANT_PREFIX_URI_PERMISSION: checkKeyIntent drops them
const NEW_TASK = 0x10000000;

export function createAccountSessionsHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const nullish = value => value === null || value === undefined || value === 0;
  // a long or double argument takes two registers (Runtime.argumentWords) when the callee is bytecode
  const words = (r, parameters, values, receiver) => (parameters.some(p => p === 'J' || p === 'D') ? r.argumentWords(parameters, values, receiver === undefined ? {} : { receiver }) : receiver === undefined ? values : [receiver, ...values]);
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, words(r, parameters, values, receiver), 'virtual');
  const callStatic = (r, owner, name, parameters, result, values) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, words(r, parameters, values), 'static');
  const construct = (r, owner, parameters = [], values = []) => { const ref = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, [ref, ...values], 'direct'); return ref; };
  const text = (r, value) => (nullish(value) ? null : typeof value === 'string' ? value : r.stringCharacters(value));
  const iae = (r, message) => r.throwJava('Ljava/lang/IllegalArgumentException;', message);
  const denied = (r, message) => r.throwJava('Ljava/lang/SecurityException;', message);
  const ams = () => platform.accountManagerService;
  const store = () => platform.accountStore?.() ?? null;
  const packages = () => platform.packages;
  const appEntry = () => packages()?.main ?? { name: platform.packageName, uid: platform.virtualProcess.uid, pid: platform.virtualProcess.pid, main: true, manifest: platform.manifest };
  /** The process that calls AccountManagerService (Binder.getCallingUid there). */
  const callerOf = r => ams()?.callerEntry(r) ?? appEntry();
  const entryNamed = name => (name === appEntry().name ? appEntry() : packages()?.byName?.(name) ?? null);
  const record = (r, line) => r.record?.(`ACCOUNTS ${line}`);

  // ---- Bundle / Intent / Account helpers ----------------------------------------------------------------------------------------------------------------------------------------------
  const bundle = r => platform.bundle(r);
  const getString = (r, b, key) => text(r, call(r, b, BUNDLE, 'getString', [STRING], STRING, [key]));
  const putString = (r, b, key, value) => call(r, b, BUNDLE, 'putString', [STRING, STRING], 'V', [key, value]);
  const putInt = (r, b, key, value) => call(r, b, BUNDLE, 'putInt', [STRING, 'I'], 'V', [key, value]);
  const putLong = (r, b, key, value) => call(r, b, BUNDLE, 'putLong', [STRING, 'J'], 'V', [key, BigInt(value)]);
  const putBoolean = (r, b, key, value) => call(r, b, BUNDLE, 'putBoolean', [STRING, 'Z'], 'V', [key, value ? 1 : 0]);
  const getBoolean = (r, b, key, fallback = false) => call(r, b, BUNDLE, 'getBoolean', [STRING, 'Z'], 'Z', [key, fallback ? 1 : 0]) === 1;
  const getInt = (r, b, key, fallback) => call(r, b, BUNDLE, 'getInt', [STRING, 'I'], 'I', [key, fallback]);
  const getLong = (r, b, key, fallback = 0n) => call(r, b, BUNDLE, 'getLong', [STRING, 'J'], 'J', [key, BigInt(fallback)]);
  const has = (r, b, key) => call(r, b, BUNDLE, 'containsKey', [STRING], 'Z', [key]) === 1;
  const remove = (r, b, key) => call(r, b, BUNDLE, 'remove', [STRING], 'V', [key]);
  const getParcelable = (r, b, key) => { const value = call(r, b, BUNDLE, 'getParcelable', [STRING], PARCELABLE, [key]); return nullish(value) ? null : value; };
  const copyBundle = (r, source) => { const out = bundle(r); if (!nullish(source)) call(r, out, BUNDLE, 'putAll', [BUNDLE], 'V', [source]); return out; };
  const accountField = (r, account, name) => { const value = r.readInstanceField?.(account, `${ACCOUNT}->${name}:${STRING}`) ?? r.object(account).fields?.get(`${ACCOUNT}->${name}:${STRING}`); return text(r, value); };
  const accountOf = (r, account) => ({ name: accountField(r, account, 'name'), type: accountField(r, account, 'type') });
  const newAccount = (r, a) => construct(r, ACCOUNT, [STRING, STRING], [a.name, a.type]);
  const strings = (r, array) => (nullish(array) ? null : r.array(array).elements.map(value => text(r, value)));

  // ---- the client: AccountManagerFuture (AmsTask / Future2Task) ------------------------------------------------------------------------------------------------------------------
  type(FUTURE, OBJECT, [FUTURE_I], { allocatable: true });
  const held = gcRoot(new Set());   // the Java values a pending request holds (its future, callback, handler, Activity, the session's binder): roots until it ends
  const hold = refs => { for (const ref of refs) if (!nullish(ref)) held.add(ref); };
  const release = refs => { for (const ref of refs) if (!nullish(ref)) held.delete(ref); };
  const isMainThread = r => !r.thread || r.thread === r.scheduler.mainThread();
  const deliverCallback = (r, future) => {
    const state = r.object(future); release([state.activity]);
    if (nullish(state.callback)) { release([future, state.handler]); return; }
    const run = () => { try { call(r, state.callback, ACCOUNT_CB, 'run', [FUTURE_I], 'V', [future]); } finally { release([future, state.callback, state.handler]); } };
    if (nullish(state.handler)) platform.queueTask(run, 0, [future, state.callback]);
    else { const runnable = r.allocate(DELIVERY); r.object(runnable).task = run; r.object(runnable).held = [future, state.callback]; call(r, state.handler, HANDLER, 'post', [RUNNABLE], 'Z', [runnable]); }
  };
  /** A pending AccountManagerFuture; `convert(bundle)` turns the service's answer into the future's value (Future2Task.bundleToResult), throwing an AuthenticatorException-shaped error. */
  const newFuture = (r, { callback = null, handler = null, activity = null, convert = (_r, b) => b } = {}) => {
    const future = r.allocate(FUTURE);
    Object.assign(r.object(future), { done: false, cancelled: false, callback, handler, activity, convert, value: null, error: null });
    hold([future, callback, handler, activity]);
    return future;
  };
  const settle = (r, future, outcome) => {
    const state = r.object(future); if (state.done) return;
    if (outcome.cancelled) state.cancelled = true;
    else if (outcome.error) state.error = outcome.error;
    else { try { state.value = state.convert(r, outcome.value); } catch (error) { if (error?.accountError) state.error = error.accountError; else throw error; } }
    state.done = true; deliverCallback(r, future);
  };
  /** AmsTask.Response.onError: a cancellation (or a restriction) cancels the future; every other code is convertErrorToException. */
  const errorOutcome = (code, message) => (code === E.CANCELED || code === E.USER_RESTRICTED || code === E.MANAGEMENT_DISABLED ? { cancelled: true }
    : { error: code === E.NETWORK ? { type: 'Ljava/io/IOException;', message } : code === E.UNSUPPORTED ? { type: 'Ljava/lang/UnsupportedOperationException;', message, wrapped: true }
      : code === E.BAD_ARGUMENTS ? { type: 'Ljava/lang/IllegalArgumentException;', message } : { type: 'Landroid/accounts/AuthenticatorException;', message } });
  const noResult = message => Object.assign(new Error(message), { accountError: { type: 'Landroid/accounts/AuthenticatorException;', message } });
  /** AmsTask.internalGetResult: the stored outcome, rethrown as AccountManager does (an UnsupportedOperationException arrives wrapped in an AuthenticatorException). */
  const report = (r, future) => {
    const state = r.object(future);
    if (state.cancelled) r.throwJava('Landroid/accounts/OperationCanceledException;', null);
    if (state.error) {
      if (state.error.wrapped) { const cause = construct(r, state.error.type, [STRING], [state.error.message]); const wrapper = construct(r, 'Landroid/accounts/AuthenticatorException;', ['Ljava/lang/Throwable;'], [cause]); r.throwJavaReference(wrapper, r.object(wrapper).message ?? null); }
      r.throwJava(state.error.type, state.error.message ?? null);
    }
    return state.value;
  };
  const getResult = (r, self, timeoutMs = Infinity) => {
    const state = r.object(self);
    if (state.done || state.cancelled) return report(r, self);
    if (isMainThread(r) && (platform.targetSdk ?? 34) >= 8) r.throwJava('Ljava/lang/IllegalStateException;', 'calling this from your main thread can lead to deadlock');
    return new Blocked({ reason: 'AccountManagerFuture.getResult', ready: () => state.done, deadline: timeoutMs === Infinity ? Infinity : platform.clock.now() + timeoutMs, roots: [self],
      finish: () => { if (!state.done) { state.cancelled = true; settle(r, self, { cancelled: true }); } return report(r, self); } });
  };
  def(FUTURE, 'getResult', `()${OBJECT}`, (r, _m, [self]) => getResult(r, self));
  def(FUTURE, 'getResult', `(J${UNITS})${OBJECT}`, (r, _m, [self, amount, unit]) => getResult(r, self, Math.max(0, Number(call(r, unit, UNITS, 'toMillis', ['J'], 'J', [amount])))));
  def(FUTURE, 'isDone', '()Z', (r, _m, [self]) => (r.object(self).done ? 1 : 0)); def(FUTURE, 'isCancelled', '()Z', (r, _m, [self]) => (r.object(self).cancelled ? 1 : 0));
  def(FUTURE, 'cancel', '(Z)Z', (r, _m, [self]) => { const state = r.object(self); if (state.done) return 0; settle(r, self, { cancelled: true }); state.session?.abandon?.(r); return 1; });
  /** The service answered the client (IAccountManagerResponse in the caller's process): a KEY_INTENT with the caller's Activity is started by that Activity and the future waits on. */
  const clientResult = (r, future, result) => platform.queueTask(() => {
    const state = r.object(future); if (state.done) return;
    if (nullish(result)) { settle(r, future, errorOutcome(E.INVALID_RESPONSE, 'null bundle returned')); return; }
    const intent = getParcelable(r, result, K.INTENT);
    if (intent && !nullish(state.activity)) { record(r, `the caller's Activity starts the authenticator's Intent (${intentTarget(r, intent) ?? 'implicit'})`); call(r, state.activity, ACTIVITY, 'startActivity', [INTENT], 'V', [intent]); return; }
    settle(r, future, { value: result });
  }, 0, [future, result]);
  const clientError = (r, future, code, message) => platform.queueTask(() => settle(r, future, errorOutcome(code, message)), 0, [future]);
  const booleanResult = (r, b) => { if (!has(r, b, K.BOOLEAN)) throw noResult('no result in response'); return callStatic(r, 'Ljava/lang/Boolean;', 'valueOf', ['Z'], 'Ljava/lang/Boolean;', [getBoolean(r, b, K.BOOLEAN) ? 1 : 0]); };
  const accountsResult = (r, b) => {
    const parcelables = call(r, b, BUNDLE, 'getParcelableArray', [STRING], `[${PARCELABLE}`, [K.ACCOUNTS]); if (nullish(parcelables)) throw noResult('no result in response');
    const items = r.array(parcelables).elements, out = r.newArray(`[${ACCOUNT}`, items.length); r.array(out).elements = [...items]; return out;
  };

  // ---- the service: AccountManagerService.Session -------------------------------------------------------------------------------------------------------------------------------
  type(SESSION, BINDER, [RESPONSE_I], { allocatable: true });
  const sessions = new Map(); let nextSession = 0;
  const sessionOf = (r, self) => sessions.get(r.object(self).sessionNumber) ?? null;
  def(SESSION, 'asBinder', `()${IBINDER}`, (r, _m, [self]) => self);
  def(SESSION, 'onResult', `(${BUNDLE})V`, (r, _m, [self, result]) => { sessionOf(r, self)?.onResult(r, result); });
  def(SESSION, 'onRequestContinued', '()V', (r, _m, [self]) => { const s = sessionOf(r, self); if (s) s.continued++; });
  def(SESSION, 'onError', `(I${STRING})V`, (r, _m, [self, code, message]) => { sessionOf(r, self)?.onError(r, code, text(r, message)); });
  // IAccountAuthenticatorResponse.Stub.onTransact, for a package that reaches the session through the generated Proxy (FIRST_CALL_TRANSACTION order of the .aidl: onResult 1,
  // onRequestContinued 2, onError 3; typed objects are an int presence flag then the Parcelable)
  def(SESSION, 'onTransact', `(I${PARCEL}${PARCEL}I)Z`, (r, _m, [self, code, data, reply]) => {
    if (code === 0x5f4e5446) { call(r, reply, PARCEL, 'writeString', [STRING], 'V', [RESPONSE_DESCRIPTOR]); return 1; }
    if (code < 1 || code > 3) return 0;
    call(r, data, PARCEL, 'enforceInterface', [STRING], 'V', [RESPONSE_DESCRIPTOR]);
    const s = sessionOf(r, self);
    if (code === 1) {
      const present = call(r, data, PARCEL, 'readInt', [], 'I') !== 0;
      const creator = r.readStatic({ owner: BUNDLE, name: 'CREATOR', type: 'Landroid/os/Parcelable$Creator;' });
      const result = present ? call(r, creator, 'Landroid/os/Parcelable$Creator;', 'createFromParcel', [PARCEL], OBJECT, [data]) : null;
      s?.onResult(r, result);
    } else if (code === 2) { if (s) s.continued++; }
    else { const errorCode = call(r, data, PARCEL, 'readInt', [], 'I'), message = text(r, call(r, data, PARCEL, 'readString', [], STRING)); s?.onError(r, errorCode, message); }
    return 1;
  });
  const intentTarget = (r, intent) => {
    const component = call(r, intent, INTENT, 'getComponent', [], COMPONENT);
    if (!nullish(component)) return `${text(r, call(r, component, COMPONENT, 'getPackageName', [], STRING))}/${text(r, call(r, component, COMPONENT, 'getClassName', [], STRING))}`;
    const target = r.object(intent).target; if (target) return `${appEntry().name}/${String(target).slice(1, -1).replaceAll('/', '.')}`;
    return null;
  };
  /**
   * checkKeyIntent: the Intent an authenticator hands back must open an Activity of a package that shares its signature (its own); the URI grant flags are dropped. An implicit Intent
   * is not resolved by this device's AccountManagerService: refused, with the reason recorded.
   */
  const checkKeyIntent = (r, s, intent) => {
    call(r, intent, INTENT, 'setFlags', ['I'], INTENT, [call(r, intent, INTENT, 'getFlags', [], 'I') & ~GRANT_FLAGS]);
    const target = intentTarget(r, intent);
    if (!target) { record(r, `${s.what}: the authenticator ${s.auth.packageName} returned an implicit KEY_INTENT, which this device's AccountManagerService does not resolve: refused`); return false; }
    const targetPackage = target.slice(0, target.indexOf('/'));
    const same = targetPackage === s.auth.packageName || store()?.owns(targetPackage, s.accountType);
    if (!same) record(r, `${s.what}: KEY_INTENT resolved to an Activity (${target}) in a package that does not share a signature with the supplying authenticator (${s.accountType}): refused`);
    return same;
  };
  /**
   * A Session: binds the authenticator of `accountType` as the system, runs `run(r, authenticator, session)` once connected (an IAccountAuthenticator Proxy call), and answers the
   * client through `respond`: { result(r, bundle), error(r, code, message) } (an AccountManagerFuture's, or the Device panel's). Options as AccountManagerService's constructor:
   * expectActivityLaunch, stripAuthTokenFromResult, accountName, authDetailsRequired, updateLastAuthenticatedTime; `onResult(r, bundle, base)` overrides the answer (getAuthToken).
   */
  const startSession = (r, { accountType, respond, run, what, expectActivityLaunch = false, stripAuthTokenFromResult = false, accountName = null, authDetailsRequired = false, updateLastAuthenticatedTime = false, onResult = null }) => {
    const number = ++nextSession, s = { number, accountType, respond, what, expectActivityLaunch, stripAuthTokenFromResult, accountName, authDetailsRequired, updateLastAuthenticatedTime,
      results: 0, continued: 0, errors: 0, open: true, auth: store()?.authenticatorFor(accountType) ?? null, unbind: null, ref: null };
    sessions.set(number, s);
    const close = rt => { if (!s.open) return; s.open = false; sessions.delete(number); release([s.ref]); s.unbind?.(); void rt; };
    s.abandon = rt => close(rt);
    const responseAndClose = rt => { const out = s.open ? s.respond : null; close(rt); return out; };
    s.onError = (rt, code, message) => { s.errors++; const out = responseAndClose(rt); if (out) { record(rt, `${s.what}: error ${code} ${message ?? ''}`.trim()); out.error(rt, code, message); } };
    const base = (rt, result) => {
      s.results++;
      let intent = null;
      if (!nullish(result)) {
        const confirmed = getBoolean(rt, result, K.BOOLEAN), named = has(rt, result, K.NAME) && has(rt, result, K.TYPE);
        const needUpdate = s.updateLastAuthenticatedTime && (confirmed || named);
        if (needUpdate || s.authDetailsRequired) {
          const present = !!(s.accountName && store()?.find(s.accountName, s.accountType));
          if (needUpdate && present) lastAuthenticated.set(`${s.accountType}\n${s.accountName}`, platform.clock.wall?.() ?? Date.now());
          if (s.authDetailsRequired) putLong(rt, result, K.LAST_AUTHENTICATED, present ? lastAuthenticated.get(`${s.accountType}\n${s.accountName}`) ?? -1 : -1);
        }
        intent = getParcelable(rt, result, K.INTENT);
        if (intent && !checkKeyIntent(rt, s, intent)) { s.onError(rt, E.INVALID_RESPONSE, 'invalid intent in bundle returned'); return; }
      }
      const out = s.expectActivityLaunch && !nullish(result) && has(rt, result, K.INTENT) ? (s.open ? s.respond : null) : responseAndClose(rt);
      if (!out) return;
      if (nullish(result)) { out.error(rt, E.INVALID_RESPONSE, 'null bundle returned'); return; }
      if (s.stripAuthTokenFromResult) remove(rt, result, K.AUTHTOKEN);
      const code = getInt(rt, result, K.ERROR_CODE, -1);
      if (code > 0 && !intent) { record(rt, `${s.what}: the authenticator answered error ${code}`); out.error(rt, code, getString(rt, result, K.ERROR_MESSAGE)); }
      else { record(rt, `${s.what}: answered by ${s.auth.packageName}${intent ? ` with an Intent to ${intentTarget(rt, intent)}` : ''}`); out.result(rt, result); }
    };
    s.onResult = (rt, result) => (onResult ? onResult(rt, result, value => base(rt, value), s) : base(rt, result));
    if (!s.auth) { record(r, `${what}: no authenticator for type ${accountType}`); platform.queueTask(() => s.onError(r, E.REMOTE, 'bind failure'), 0, []); return s; }
    const entry = entryNamed(s.auth.packageName);
    if (!entry) { platform.queueTask(() => s.onError(r, E.REMOTE, 'bind failure'), 0, []); return s; }
    // the session's binder: the system's own (a package reaches it through the generated Proxy)
    const ref = s.ref = r.allocate(SESSION); r.dispatch({ owner: BINDER, name: '<init>', parameters: [], result: 'V', signature: '()V' }, [ref], 'direct');
    call(r, ref, BINDER, 'attachInterface', ['Landroid/os/IInterface;', STRING], 'V', [ref, RESPONSE_DESCRIPTOR]);
    Object.assign(r.object(ref), { sessionNumber: number }); if (packages()?.system) r.object(ref).binderPackage = packages().system;
    hold([ref]);
    const intent = construct(r, INTENT, [STRING], [ACTION_AUTHENTICATOR_INTENT]);
    call(r, intent, INTENT, 'setComponent', [COMPONENT], INTENT, [construct(r, COMPONENT, [STRING, STRING], [entry.name, s.auth.service])]);
    record(r, `${what}: binding the authenticator ${entry.name}/${s.auth.service} as the system`);
    s.unbind = platform.bindServiceAsSystem?.(r, entry, s.auth.service, intent, binder => {
      if (!s.open) return;
      if (nullish(binder)) { s.onError(r, E.REMOTE, 'bind failure'); return; }
      const authenticator = callStatic(r, AUTH_STUB, 'asInterface', [IBINDER], AUTH_I, [platform.systemBinderRef(r, binder)]);
      try { run(r, authenticator, s); }
      catch (error) { if (error?.name === 'JavaException' && r.isSubtype(r.typeOf(error.value), 'Landroid/os/RemoteException;')) s.onError(r, E.REMOTE, 'remote exception'); else throw error; }
    }) ?? null;
    if (!s.unbind) { record(r, `${what}: ${entry.name} has no service ${s.auth.service}`); platform.queueTask(() => s.onError(r, E.REMOTE, 'bind failure'), 0, []); }
    return s;
  };
  const lastAuthenticated = new Map();
  const tokenCache = new Map();   // AccountManagerService's TokenCache: custom tokens an authenticator returned with KEY_CUSTOM_TOKEN_EXPIRY, per account, token type and caller package
  const futureClient = future => ({ result: (r, value) => clientResult(r, future, value), error: (r, code, message) => clientError(r, future, code, message) });
  const authCall = (r, authenticator, name, parameters, values) => call(r, authenticator, AUTH_I, name, parameters, 'V', values);
  const RESP = RESPONSE_I, ACC = ACCOUNT;

  // ---- AccountManager's requests -----------------------------------------------------------------------------------------------------------------------------------------------
  const withPackage = (r, options) => { const out = copyBundle(r, options); putString(r, out, K.PACKAGE, callerOf(r).name); return out; };
  const typeOfAccount = (r, account) => accountOf(r, account).type;
  /** addAccount: AMS puts the caller's uid/pid in the options; the authenticator usually answers a KEY_INTENT to its login Activity. */
  const addAccount = (r, { accountType, authTokenType, features, options, activity, respond, caller }) => {
    putInt(r, options, K.CALLER_UID, caller.uid ?? platform.virtualProcess.uid); putInt(r, options, K.CALLER_PID, caller.pid ?? platform.virtualProcess.pid);
    return startSession(r, { accountType, respond, what: `addAccount ${accountType} for ${caller.name}`, expectActivityLaunch: !nullish(activity), stripAuthTokenFromResult: true, updateLastAuthenticatedTime: true,
      run: (rt, authenticator, s) => authCall(rt, authenticator, 'addAccount', [RESP, STRING, STRING, `[${STRING}`, BUNDLE], [s.ref, accountType, authTokenType, features, options]) });
  };
  def(ACCOUNTS, 'addAccount', `(${STRING}${STRING}[${STRING}${BUNDLE}${ACTIVITY}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, type, authTokenType, features, options, activity, callback, handler]) => {
    if (nullish(type)) iae(r, 'accountType is null');
    const future = newFuture(r, { callback, handler, activity });
    const caller = callerOf(r), optionsIn = withPackage(r, options);
    addAccount(r, { accountType: text(r, type), authTokenType, features, options: optionsIn, activity, respond: futureClient(future), caller });
    return future;
  });
  /** permissionIsGranted: the system, the authenticator's own packages (or signed alike), or an explicit grant (none on this device: the grant screen is the system's). */
  const permitted = (caller, type) => caller.systemServer === true || !!store()?.owns(caller.name, type);
  const getAuthToken = (r, { account, authTokenType, options, activity, notify, respond, caller }) => {
    const a = accountOf(r, account), auth = store()?.authenticatorFor(a.type) ?? null, customTokens = auth?.customTokens === true, granted = customTokens || permitted(caller, a.type);
    const callerPkg = getString(r, options, K.PACKAGE);
    if (callerPkg !== caller.name) denied(r, `Uid ${caller.uid} is attempting to illegally masquerade as package ${callerPkg}!`);
    putInt(r, options, K.CALLER_UID, caller.uid ?? platform.virtualProcess.uid); putInt(r, options, K.CALLER_PID, caller.pid ?? platform.virtualProcess.pid);
    if (notify) putBoolean(r, options, K.NOTIFY, true);
    const answer = (token, expiry = null) => { const b = bundle(r); putString(r, b, K.AUTHTOKEN, token); if (expiry !== null) putLong(r, b, K.EXPIRY, expiry); putString(r, b, K.NAME, a.name); putString(r, b, K.TYPE, a.type); respond.result(r, b); };
    if (!customTokens && granted) { const stored = store()?.find(a.name, a.type)?.tokens.get(text(r, authTokenType)); if (stored) { record(r, `getAuthToken ${a.type} for ${caller.name}: the stored token`); answer(stored); return; } }
    const cacheKey = `${a.type}\n${a.name}\n${text(r, authTokenType)}\n${callerPkg}`, cached = customTokens ? tokenCache.get(cacheKey) : null;
    if (cached && cached.expiry > (platform.clock.wall?.() ?? Date.now())) { record(r, `getAuthToken ${a.type} for ${caller.name}: the cached custom token`); answer(cached.token, cached.expiry); return; }
    startSession(r, { accountType: a.type, respond, what: `getAuthToken ${a.type} for ${caller.name}`, expectActivityLaunch: !nullish(activity), accountName: a.name,
      run: (rt, authenticator, s) => granted ? authCall(rt, authenticator, 'getAuthToken', [RESP, ACC, STRING, BUNDLE], [s.ref, account, authTokenType, options]) : authCall(rt, authenticator, 'getAuthTokenLabel', [RESP, STRING], [s.ref, authTokenType]),
      onResult: (rt, result, base, s) => {
        if (!nullish(result)) {
          if (has(rt, result, K.LABEL)) {
            record(rt, `getAuthToken ${a.type} for ${caller.name}: the user would have to allow ${caller.name} to use the account in the system screen GrantCredentialsPermissionActivity, which the virtual device does not have`);
            s.onError(rt, E.REMOTE, `${caller.name} is not allowed to use accounts of type ${a.type}: the system's account access screen (GrantCredentialsPermissionActivity) is not on this device`); return;
          }
          const token = getString(rt, result, K.AUTHTOKEN);
          if (token !== null) {
            const name = getString(rt, result, K.NAME), kind = getString(rt, result, K.TYPE);
            if (!name || !kind) { s.onError(rt, E.INVALID_RESPONSE, 'the type and name should not be empty'); return; }
            if (!customTokens) { const stored = store()?.find(name, kind); if (stored) { stored.tokens.set(text(rt, authTokenType), token); store().saved?.(kind); } }
            const expiry = Number(getLong(rt, result, K.EXPIRY, 0n));
            if (customTokens && expiry > (platform.clock.wall?.() ?? Date.now())) tokenCache.set(cacheKey, { token, expiry });
          }
          if (getParcelable(rt, result, K.INTENT) && notify && !customTokens) record(rt, `getAuthToken ${a.type} for ${caller.name}: the authenticator asks for the user (a notification on a phone); the Intent is in the result`);
        }
        base(result);
      } });
  };
  const authTokenRequest = (r, account, authTokenType, options, activity, notify, callback, handler) => {
    if (nullish(account)) iae(r, 'account is null'); if (nullish(authTokenType)) iae(r, 'authTokenType is null');
    const future = newFuture(r, { callback, handler, activity }), caller = callerOf(r);
    getAuthToken(r, { account, authTokenType, options: withPackage(r, options), activity, notify, respond: futureClient(future), caller });
    return future;
  };
  def(ACCOUNTS, 'getAuthToken', `(${ACCOUNT}${STRING}${BUNDLE}${ACTIVITY}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, account, tokenType, options, activity, callback, handler]) => authTokenRequest(r, account, tokenType, options, activity, false, callback, handler));
  def(ACCOUNTS, 'getAuthToken', `(${ACCOUNT}${STRING}${BUNDLE}Z${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, account, tokenType, options, notify, callback, handler]) => authTokenRequest(r, account, tokenType, options, null, notify === 1, callback, handler));
  def(ACCOUNTS, 'getAuthToken', `(${ACCOUNT}${STRING}Z${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, account, tokenType, notify, callback, handler]) => authTokenRequest(r, account, tokenType, null, null, notify === 1, callback, handler));
  def(ACCOUNTS, 'confirmCredentials', `(${ACCOUNT}${BUNDLE}${ACTIVITY}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, account, options, activity, callback, handler]) => {
    if (nullish(account)) iae(r, 'account is null');
    const future = newFuture(r, { callback, handler, activity }), a = accountOf(r, account), caller = callerOf(r);
    startSession(r, { accountType: a.type, respond: futureClient(future), what: `confirmCredentials ${a.type} for ${caller.name}`, expectActivityLaunch: !nullish(activity), stripAuthTokenFromResult: true, accountName: a.name, authDetailsRequired: true, updateLastAuthenticatedTime: true,
      run: (rt, authenticator, s) => authCall(rt, authenticator, 'confirmCredentials', [RESP, ACC, BUNDLE], [s.ref, account, nullish(options) ? null : options]) });
    return future;
  });
  def(ACCOUNTS, 'updateCredentials', `(${ACCOUNT}${STRING}${BUNDLE}${ACTIVITY}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, account, tokenType, options, activity, callback, handler]) => {
    if (nullish(account)) iae(r, 'account is null');
    const future = newFuture(r, { callback, handler, activity }), a = accountOf(r, account), caller = callerOf(r);
    startSession(r, { accountType: a.type, respond: futureClient(future), what: `updateCredentials ${a.type} for ${caller.name}`, expectActivityLaunch: !nullish(activity), stripAuthTokenFromResult: true, accountName: a.name, updateLastAuthenticatedTime: true,
      run: (rt, authenticator, s) => authCall(rt, authenticator, 'updateCredentials', [RESP, ACC, STRING, BUNDLE], [s.ref, account, tokenType, nullish(options) ? null : options]) });
    return future;
  });
  def(ACCOUNTS, 'editProperties', `(${STRING}${ACTIVITY}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, type, activity, callback, handler]) => {
    if (nullish(type)) iae(r, 'accountType is null');
    const accountType = text(r, type), caller = callerOf(r);
    if (!permitted(caller, accountType)) denied(r, `uid ${caller.uid} cannot edit authenticator properites for account type: ${accountType}`);
    const future = newFuture(r, { callback, handler, activity });
    startSession(r, { accountType, respond: futureClient(future), what: `editProperties ${accountType} for ${caller.name}`, expectActivityLaunch: !nullish(activity), stripAuthTokenFromResult: true,
      run: (rt, authenticator, s) => authCall(rt, authenticator, 'editProperties', [RESP, STRING], [s.ref, accountType]) });
    return future;
  });
  /** checkReadAccountsPermitted / getTypesVisibleToCaller: every type an installed authenticator declares (the accounts themselves are then filtered by their visibility). */
  const canRead = (_r, _caller, type) => !!store()?.authenticatorFor(type);
  def(ACCOUNTS, 'hasFeatures', `(${ACCOUNT}[${STRING}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, account, features, callback, handler]) => {
    if (nullish(account)) iae(r, 'account is null'); if (nullish(features)) iae(r, 'features is null');
    const a = accountOf(r, account), caller = callerOf(r);
    if (!canRead(r, caller, a.type)) denied(r, `caller uid ${caller.uid} cannot access ${a.type} accounts`);
    const future = newFuture(r, { callback, handler, convert: booleanResult });
    startSession(r, { accountType: a.type, respond: futureClient(future), what: `hasFeatures ${a.type} for ${caller.name}`, stripAuthTokenFromResult: true, accountName: a.name,
      run: (rt, authenticator, s) => authCall(rt, authenticator, 'hasFeatures', [RESP, ACC, `[${STRING}`], [s.ref, account, features]),
      onResult: (rt, result, base, s) => {   // TestFeaturesSession: only the boolean goes back
        if (nullish(result)) { s.onError(rt, E.INVALID_RESPONSE, 'null bundle'); return; }
        const out = bundle(rt); putBoolean(rt, out, K.BOOLEAN, getBoolean(rt, result, K.BOOLEAN)); base(out);
      } });
    return future;
  });
  /** GetAccountsByTypeAndFeatureSession: hasFeatures for each account of the type, one after the other over one binding; the caller gets those it can see. */
  const accountsWithFeatures = (r, { type, features, caller, done, fail }) => {
    const candidates = (store()?.accounts ?? []).filter(a => a.type === type).map(a => ({ ...a })), matched = [];
    let index = 0;
    startSession(r, { accountType: type, respond: { result: () => {}, error: (rt, code, message) => fail(rt, code, message) }, what: `getAccountsByTypeAndFeatures ${type} for ${caller.name}`,
      run: (rt, authenticator, s) => {
        const next = rt2 => {
          if (index >= candidates.length) { s.abandon(rt2); const visible = new Set((ams()?.visibleAccounts(rt2, type, caller) ?? []).map(a => a.name)); done(rt2, matched.filter(a => visible.has(a.name))); return; }
          authCall(rt2, authenticator, 'hasFeatures', [RESP, ACC, `[${STRING}`], [s.ref, newAccount(rt2, candidates[index]), features]);
        };
        s.next = next; next(rt);
      },
      onResult: (rt, result, _base, s) => {
        if (nullish(result)) { s.onError(rt, E.INVALID_RESPONSE, 'null bundle'); return; }
        if (getBoolean(rt, result, K.BOOLEAN)) matched.push(candidates[index]);
        index++; s.next(rt);
      } });
  };
  const accountsBundle = (r, list) => { const b = bundle(r), array = r.newArray(`[${PARCELABLE}`, list.length); r.array(array).elements = list.map(a => newAccount(r, a)); call(r, b, BUNDLE, 'putParcelableArray', [STRING, `[${PARCELABLE}`], 'V', [K.ACCOUNTS, array]); return b; };
  def(ACCOUNTS, 'getAccountsByTypeAndFeatures', `(${STRING}[${STRING}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, type, features, callback, handler]) => {
    if (nullish(type)) iae(r, 'type is null');
    const accountType = text(r, type), caller = callerOf(r), future = newFuture(r, { callback, handler, convert: accountsResult }), respond = futureClient(future);
    const wanted = strings(r, features) ?? [];
    if (!canRead(r, caller, accountType)) { respond.result(r, accountsBundle(r, [])); return future; }
    if (!wanted.length) { respond.result(r, accountsBundle(r, ams()?.visibleAccounts(r, accountType, caller) ?? [])); return future; }
    accountsWithFeatures(r, { type: accountType, features, caller, done: (rt, list) => respond.result(rt, accountsBundle(rt, list)), fail: (rt, code, message) => respond.error(rt, code, message) });
    return future;
  });
  def(ACCOUNTS, 'getAuthTokenLabel', `(${STRING}${STRING}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, type, tokenType]) => {
    if (nullish(type)) iae(r, 'accountType is null'); if (nullish(tokenType)) iae(r, 'authTokenType is null');
    denied(r, 'can only call from system');
  });
  def(ACCOUNTS, 'isCredentialsUpdateSuggested', `(${ACCOUNT}${STRING}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, account, statusToken, callback, handler]) => {
    if (nullish(account)) iae(r, 'account is null'); if (nullish(statusToken) || text(r, statusToken) === '') iae(r, 'status token is empty');
    const a = accountOf(r, account), caller = callerOf(r), future = newFuture(r, { callback, handler, convert: booleanResult });
    startSession(r, { accountType: a.type, respond: futureClient(future), what: `isCredentialsUpdateSuggested ${a.type} for ${caller.name}`, accountName: a.name,
      run: (rt, authenticator, s) => authCall(rt, authenticator, 'isCredentialsUpdateSuggested', [RESP, ACC, STRING], [s.ref, account, statusToken]),
      onResult: (rt, result, base, s) => {
        if (nullish(result)) { s.onError(rt, E.INVALID_RESPONSE, 'null bundle'); return; }
        if (has(rt, result, K.ERROR_CODE)) { s.onError(rt, getInt(rt, result, K.ERROR_CODE, 0), getString(rt, result, K.ERROR_MESSAGE)); return; }
        if (!has(rt, result, K.BOOLEAN)) { s.onError(rt, E.INVALID_RESPONSE, 'no result in response'); return; }
        const out = bundle(rt); putBoolean(rt, out, K.BOOLEAN, getBoolean(rt, result, K.BOOLEAN)); base(out);
      } });
    return future;
  });
  /** removeAccount: only the authenticator's packages (or the system); RemoveAccountSession asks getAccountRemovalAllowed and removes the account when it says so. */
  const removeAccount = (r, account, activity, callback, handler, convert) => {
    if (nullish(account)) iae(r, 'account is null');
    const a = accountOf(r, account), caller = callerOf(r);
    if (!permitted(caller, a.type)) denied(r, `uid ${caller.uid} cannot remove accounts of type: ${a.type}`);
    const future = newFuture(r, { callback, handler, activity, convert });
    startSession(r, { accountType: a.type, respond: futureClient(future), what: `removeAccount ${a.type} for ${caller.name}`, expectActivityLaunch: !nullish(activity), stripAuthTokenFromResult: true, accountName: a.name,
      run: (rt, authenticator, s) => authCall(rt, authenticator, 'getAccountRemovalAllowed', [RESP, ACC], [s.ref, account]),
      onResult: (rt, result, base) => {
        if (!nullish(result) && has(rt, result, K.BOOLEAN) && !has(rt, result, K.INTENT)) {
          const allowed = getBoolean(rt, result, K.BOOLEAN);
          if (allowed && store()?.remove(a.name, a.type)) { store().saved?.(a.type); ams()?.changed(rt); record(rt, `removed an account of type ${a.type}`); }
          const out = bundle(rt); putBoolean(rt, out, K.BOOLEAN, allowed); base(out); return;
        }
        base(result);
      } });
    return future;
  };
  def(ACCOUNTS, 'removeAccount', `(${ACCOUNT}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, account, callback, handler]) => removeAccount(r, account, null, callback, handler, booleanResult));
  def(ACCOUNTS, 'removeAccount', `(${ACCOUNT}${ACTIVITY}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, account, activity, callback, handler]) => removeAccount(r, account, activity, callback, handler, (_r, b) => b));
  /** GetAuthTokenByTypeAndFeaturesTask: no account -> addAccount with the Activity (then its token), or an empty answer; one -> getAuthToken; several -> the system's chooser. */
  def(ACCOUNTS, 'getAuthTokenByFeatures', `(${STRING}${STRING}[${STRING}${ACTIVITY}${BUNDLE}${BUNDLE}${ACCOUNT_CB}${HANDLER})${FUTURE_I}`, (r, _m, [, type, tokenType, features, activity, addOptions, tokenOptions, callback, handler]) => {
    if (nullish(type)) iae(r, 'account type is null'); if (nullish(tokenType)) iae(r, 'authTokenType is null');
    const accountType = text(r, type), caller = callerOf(r), future = newFuture(r, { callback, handler, activity }), respond = futureClient(future);
    const forAccount = (rt, a) => getAuthToken(rt, { account: newAccount(rt, a), authTokenType: tokenType, options: withPackage(rt, tokenOptions), activity, notify: false, respond, caller });
    const choose = (rt, list) => {
      if (list.length === 1) { forAccount(rt, list[0]); return; }
      if (list.length > 1) { record(rt, `getAuthTokenByFeatures ${accountType} for ${caller.name}: ${list.length} accounts; choosing one needs the system's account chooser (ChooseAccountActivity), which the virtual device does not have`); respond.error(rt, E.REMOTE, `choosing among ${list.length} accounts of type ${accountType} needs the system's account chooser, which is not on this device`); return; }
      if (nullish(activity)) { const b = bundle(rt); putString(rt, b, K.NAME, null); putString(rt, b, K.TYPE, null); putString(rt, b, K.AUTHTOKEN, null); respond.result(rt, b); return; }
      const options = withPackage(rt, addOptions);
      addAccount(rt, { accountType, authTokenType: tokenType, features, options, activity, caller, respond: { error: respond.error, result: (rt2, result) => platform.queueTask(() => {
        const intent = getParcelable(rt2, result, K.INTENT);
        if (intent) { call(rt2, activity, ACTIVITY, 'startActivity', [INTENT], 'V', [intent]); return; }
        const name = getString(rt2, result, K.NAME), kind = getString(rt2, result, K.TYPE);
        if (!name || !kind) { settle(rt2, future, { error: { type: 'Landroid/accounts/AuthenticatorException;', message: 'account not in result' } }); return; }
        forAccount(rt2, { name, type: kind });
      }, 0, [result, activity]) } });
    };
    const wanted = strings(r, features) ?? [];
    if (!wanted.length) platform.queueTask(() => choose(r, ams()?.visibleAccounts(r, accountType, caller) ?? []), 0, [future]);
    else accountsWithFeatures(r, { type: accountType, features, caller, done: choose, fail: respond.error });
    return future;
  });

  /**
   * Settings > Accounts > Add account, done by the device (the Device panel): AccountManagerService.addAccount as the system, the authenticator's KEY_INTENT started in a new task
   * (AddAccountSettings), and the answer its Activity finally sends reported to `onDone({ ok, accountName, accountType, error })`. Returns false when no package authenticates the type.
   */
  platform.addAccountFromSettings = (r, accountType, onDone = () => {}) => {
    const auth = store()?.authenticatorFor(accountType); if (!auth) return false;
    const system = packages()?.system ?? { name: 'android', uid: 1000, pid: 900, systemServer: true };
    const options = bundle(r);
    addAccount(r, { accountType, authTokenType: null, features: null, options, activity: { settings: true }, caller: system, respond: {
      result: (rt, result) => platform.queueTask(() => {
        const intent = getParcelable(rt, result, K.INTENT);
        if (intent) { call(rt, intent, INTENT, 'addFlags', ['I'], INTENT, [NEW_TASK]); record(rt, `Add account ${accountType} (Device panel): starting ${intentTarget(rt, intent)}`); platform.startFromSystem(rt, intent); return; }
        const name = getString(rt, result, K.NAME);
        record(rt, `Add account ${accountType} (Device panel): ${name ? 'an account was added' : 'finished without an account'}`);
        onDone({ ok: !!name, accountName: name, accountType: getString(rt, result, K.TYPE) ?? accountType });
      }, 0, [result]),
      error: (rt, code, message) => { record(rt, `Add account ${accountType} (Device panel): ${code === E.CANCELED ? 'canceled' : `error ${code} ${message ?? ''}`.trim()}`); onDone({ ok: false, accountType, error: code === E.CANCELED ? 'canceled' : message ?? `error ${code}` }); },
    } });
    return true;
  };
  return { ...registry };
}
