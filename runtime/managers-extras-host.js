import { createHostRegistry } from './host-contract.js?v=7cc05078518d';

// The system-manager methods an ordinary app calls that the first host passes left out, for a one-user, unmanaged, unlocked phone without fingerprint hardware or thermal HAL
// (android-13.0.0_r1 UserManager / UserManagerService, KeyguardManager / PhoneWindowManager, PowerManager / ThermalManagerService, FingerprintManager):
//  UserManager     one user (0, "Owner"), no restrictions, MANAGE_USERS operations refused with the platform's text
//  KeyguardManager the keyguard is not showing: KeyguardLock needs DISABLE_KEYGUARD, exitKeyguardSecurely succeeds, requestDismissKeyguard reports an error (nothing to dismiss)
//  (PowerManager moved to the Java system_server: src/java-services-host.js, docs/SERVICES.md)
//  BiometricPrompt (Builder checks, CryptoObject, callbacks; no sensor, so authenticate() reports the service's error), FingerprintManager.authenticate / CryptoObject / AuthenticationCallback: no hardware, so nothing is ever authenticated and no success is reported
const USER = 'Landroid/os/UserManagerImpl;', USER_STATIC = 'Landroid/os/UserManager;', KEYGUARD = 'Landroid/app/KeyguardManagerImpl;', FINGERPRINT = 'Landroid/hardware/fingerprint/FingerprintManagerImpl;';
const HANDLE = 'Landroid/os/UserHandle;', BUNDLE = 'Landroid/os/Bundle;', LIST = 'Ljava/util/List;', STRING = 'Ljava/lang/String;', EXECUTOR = 'Ljava/util/concurrent/Executor;', RUNNABLE = 'Ljava/lang/Runnable;', DELIVERY = 'Lapkweb/bridge/TelephonyDelivery;';
const LOCK = 'Landroid/app/KeyguardManager$KeyguardLock;', EXIT = 'Landroid/app/KeyguardManager$OnKeyguardExitResult;', DISMISS = 'Landroid/app/KeyguardManager$KeyguardDismissCallback;', ACTIVITY = 'Landroid/app/Activity;';
const FP = 'Landroid/hardware/fingerprint/FingerprintManager', FP_CALLBACK = `${FP}$AuthenticationCallback;`, FP_RESULT = `${FP}$AuthenticationResult;`, FP_CRYPTO = `${FP}$CryptoObject;`;
const SIGNAL = 'Landroid/os/CancellationSignal;', HANDLER = 'Landroid/os/Handler;';

export function createManagersExtrasHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  const nullish = value => value === null || value === undefined || value === 0;
  const uid = () => platform.virtualProcess.uid;
  const holds = (r, permission) => !!platform.holdsPermission?.(r, permission);
  const call = (r, receiver, owner, name, parameters = [], result = 'V', values = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...values], 'virtual');
  const denied = (r, text) => r.throwJava('Ljava/lang/SecurityException;', text);
  const emptyBundle = r => platform.bundle(r);
  const userHandle = r => r.dispatch({ owner: HANDLE, name: 'of', parameters: ['I'], result: HANDLE, signature: `(I)${HANDLE}` }, [0], 'static');
  const isUser0 = (r, handle) => !nullish(handle) && r.dispatch({ owner: HANDLE, name: 'getIdentifier', parameters: [], result: 'I', signature: '()I' }, [handle], 'virtual') === 0;
  const callback = (r, target, name, parameters, values) => platform.queueTask(() => { try { call(r, target, r.typeOf(target), name, parameters, 'V', values); } catch (error) { if (!String(error?.message).startsWith('Unsupported API/method')) throw error; } }, 0, [target]);
  const runOn = (r, executor, task, roots = []) => {   // Executor.execute(Runnable) with a platform closure; `roots`: the Java values the closure holds (the collector cannot see into it)
    if (nullish(executor)) { platform.queueTask(task, 0, roots); return; }
    const runnable = r.allocate(DELIVERY); r.object(runnable).task = task; r.object(runnable).held = roots; call(r, executor, EXECUTOR, 'execute', [RUNNABLE], 'V', [runnable]);
  };

  // ---- UserManager
  def(USER_STATIC, 'supportsMultipleUsers', '()Z', () => 1, { static: true }); def(USER_STATIC, 'isHeadlessSystemUserMode', '()Z', () => 0, { static: true });
  def(USER, 'getUserCount', '()I', () => 1); def(USER, 'getUserName', `()${STRING}`, () => 'Owner');
  def(USER, 'getUserProfiles', `()${LIST}`, r => { const list = r.allocate('Ljava/util/ArrayList;'); r.dispatch({ owner: 'Ljava/util/ArrayList;', name: '<init>', parameters: [], result: 'V', signature: '()V' }, [list], 'direct'); call(r, list, 'Ljava/util/ArrayList;', 'add', ['Ljava/lang/Object;'], 'Z', [userHandle(r)]); return list; });
  def(USER, 'getSerialNumberForUser', `(${HANDLE})J`, (r, _m, [, handle]) => (isUser0(r, handle) ? 0n : -1n));
  def(USER, 'getUserForSerialNumber', `(J)${HANDLE}`, (r, _m, [, serial]) => (serial === 0n ? userHandle(r) : null));
  def(USER, 'getUserCreationTime', `(${HANDLE})J`, (r, _m, [, handle]) => { if (!isUser0(r, handle)) denied(r, 'You need MANAGE_USERS permission to: get user creation time'); return 0n; });
  def(USER, 'isUserAGoat', '()Z', () => 0); def(USER, 'isUserForeground', '()Z', () => 1); def(USER, 'isProfile', '()Z', () => 0);
  def(USER, 'isUserRunningOrStopping', `(${HANDLE})Z`, (r, _m, [, handle]) => (isUser0(r, handle) ? 1 : 0)); def(USER, 'isQuietModeEnabled', `(${HANDLE})Z`, () => 0);
  for (const signature of [`(Z${HANDLE})Z`, `(Z${HANDLE}I)Z`]) def(USER, 'requestQuietModeEnabled', signature, r => denied(r, "Can't modify quiet mode, caller is neither foreground default launcher nor has MANAGE_USERS/MODIFY_QUIET_MODE permission"));
  def(USER, 'hasUserRestriction', `(${STRING})Z`, (r, _m, [, key]) => { if (nullish(key)) r.throwJava('Ljava/lang/NullPointerException;', null); return 0; });
  def(USER, 'getUserRestrictions', `()${BUNDLE}`, r => emptyBundle(r));
  def(USER, 'getUserRestrictions', `(${HANDLE})${BUNDLE}`, (r, _m, [, handle]) => { if (!isUser0(r, handle)) denied(r, 'You need INTERACT_ACROSS_USERS_FULL permission to: get user restrictions for other users'); return emptyBundle(r); });
  def(USER, 'setUserRestriction', `(${STRING}Z)V`, r => denied(r, 'You need MANAGE_USERS permission to: set user restriction'));
  def(USER, 'setUserRestrictions', `(${BUNDLE})V`, r => denied(r, 'You need MANAGE_USERS permission to: set user restrictions')); def(USER, 'setUserRestrictions', `(${BUNDLE}${HANDLE})V`, r => denied(r, 'You need MANAGE_USERS permission to: set user restrictions'));
  def(USER, 'getApplicationRestrictions', `(${STRING})${BUNDLE}`, (r, _m, [, name]) => {
    if (nullish(name)) r.throwJava('Ljava/lang/NullPointerException;', null);
    const own = r.stringCharacters(name) === platform.packageName; if (!own) denied(r, `Only system may: get application restrictions for other user/app ${r.stringCharacters(name)}`);
    return emptyBundle(r);
  });
  def(USER, 'setRestrictionsChallenge', `(${STRING})Z`, () => 0);

  // ---- KeyguardManager
  type(LOCK, 'Ljava/lang/Object;', [], { allocatable: true }); type(DISMISS, 'Ljava/lang/Object;', [], { allocatable: true }); type(EXIT, 'Ljava/lang/Object;');
  const requireDisable = (r, what) => { if (!holds(r, 'android.permission.DISABLE_KEYGUARD')) denied(r, `Permission Denial: ${what} requires android.permission.DISABLE_KEYGUARD (uid ${uid()})`); };
  def(KEYGUARD, 'newKeyguardLock', `(${STRING})${LOCK}`, r => r.allocate(LOCK));
  def(LOCK, 'disableKeyguard', '()V', r => requireDisable(r, 'disableKeyguard')); def(LOCK, 'reenableKeyguard', '()V', r => requireDisable(r, 'reenableKeyguard'));
  def(KEYGUARD, 'exitKeyguardSecurely', `(${EXIT})V`, (r, _m, [, result]) => { requireDisable(r, 'exitKeyguardSecurely'); if (!nullish(result)) callback(r, result, 'onKeyguardExitResult', ['Z'], [1]); });
  def(KEYGUARD, 'requestDismissKeyguard', `(${ACTIVITY}${DISMISS})V`, (r, _m, [, activity, dismiss]) => {
    if (nullish(activity)) r.throwJava('Ljava/lang/NullPointerException;', null);
    if (!nullish(dismiss)) callback(r, dismiss, 'onDismissError', [], []);   // PhoneWindowManager.dismissKeyguardLw: the keyguard is not showing, so there is nothing to dismiss
  });
  for (const name of ['onDismissError', 'onDismissSucceeded', 'onDismissCancelled']) def(DISMISS, name, '()V', () => {});
  def(DISMISS, '<init>', '()V', () => {});
  def(KEYGUARD, 'addKeyguardLockedStateListener', `(${EXECUTOR}Landroid/app/KeyguardManager$KeyguardLockedStateListener;)V`, r => denied(r, `Neither user ${uid()} nor current process has android.permission.SUBSCRIBE_TO_KEYGUARD_LOCKED_STATE.`));
  def(KEYGUARD, 'removeKeyguardLockedStateListener', '(Landroid/app/KeyguardManager$KeyguardLockedStateListener;)V', r => denied(r, `Neither user ${uid()} nor current process has android.permission.SUBSCRIBE_TO_KEYGUARD_LOCKED_STATE.`));

  // ---- FingerprintManager: no sensor. authenticate() with a missing callback or an already cancelled signal behaves as the framework does; otherwise nothing happens (no FingerprintService).
  type(FP_CALLBACK, 'Ljava/lang/Object;', [], { allocatable: true }); type(FP_RESULT, 'Ljava/lang/Object;', [], { allocatable: true }); type(FP_CRYPTO, 'Ljava/lang/Object;', [], { allocatable: true });
  def(FP_CALLBACK, '<init>', '()V', () => {});
  for (const signature of ['onAuthenticationError(ILjava/lang/CharSequence;)V', 'onAuthenticationHelp(ILjava/lang/CharSequence;)V', `onAuthenticationSucceeded(${FP_RESULT})V`, 'onAuthenticationFailed()V', 'onUdfpsPointerDown(I)V', 'onUdfpsPointerUp(I)V']) def(FP_CALLBACK, signature.slice(0, signature.indexOf('(')), signature.slice(signature.indexOf('(')), () => {});
  for (const kind of ['Signature', 'Cipher', 'Mac']) {
    const java = { Signature: 'Ljava/security/Signature;', Cipher: 'Ljavax/crypto/Cipher;', Mac: 'Ljavax/crypto/Mac;' }[kind];
    def(FP_CRYPTO, '<init>', `(${java})V`, (r, _m, [self, wrapped]) => { r.object(self).wrapped = { kind, value: wrapped }; });
    def(FP_CRYPTO, `get${kind}`, `()${java}`, (r, _m, [self]) => { const w = r.object(self).wrapped; return w?.kind === kind ? w.value : null; });
  }
  def(FP_RESULT, 'getCryptoObject', `()${FP_CRYPTO}`, (r, _m, [self]) => r.object(self).cryptoObject ?? null);
  def(FINGERPRINT, 'authenticate', `(${FP_CRYPTO}${SIGNAL}I${FP_CALLBACK}${HANDLER})V`, (r, _m, [, crypto, cancel, flags, authCallback]) => {
    if (nullish(authCallback)) r.throwJava('Ljava/lang/IllegalArgumentException;', 'Must supply an authentication callback');
    if (!nullish(cancel) && call(r, cancel, SIGNAL, 'isCanceled', [], 'Z')) return;   // already cancelled: the request is dropped
    void crypto; void flags;
  });

  // ---- android.hardware.biometrics.BiometricPrompt (android-13.0.0_r1): Builder validation, getters, CryptoObject, AuthenticationCallback / AuthenticationResult as in the framework class.
  // The device has no biometric sensor and no secure lock screen, so BiometricService would answer authenticate() with an error through the receiver: BIOMETRIC_ERROR_HW_NOT_PRESENT, or
  // BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL when device credential is allowed (nothing is enrolled). The framework turns it into the platform string and runs the callback on the executor.
  const PROMPT = 'Landroid/hardware/biometrics/BiometricPrompt;', PROMPT_BUILDER = `${PROMPT.slice(0, -1)}$Builder;`, PROMPT_CALLBACK = `${PROMPT.slice(0, -1)}$AuthenticationCallback;`;
  const PROMPT_RESULT = `${PROMPT.slice(0, -1)}$AuthenticationResult;`, PROMPT_CRYPTO = `${PROMPT.slice(0, -1)}$CryptoObject;`, CONTEXT_T = 'Landroid/content/Context;', CHARS_T = 'Ljava/lang/CharSequence;';
  const CLICK = 'Landroid/content/DialogInterface$OnClickListener;', EXEC = 'Ljava/util/concurrent/Executor;', LIST_T = 'Ljava/util/List;';
  type(PROMPT, 'Ljava/lang/Object;', [], { allocatable: true }); type(PROMPT_BUILDER, 'Ljava/lang/Object;', [], { allocatable: true });
  type(PROMPT_CALLBACK, 'Ljava/lang/Object;', [], { allocatable: true }); type(PROMPT_RESULT, 'Ljava/lang/Object;', [], { allocatable: true }); type(PROMPT_CRYPTO, 'Ljava/lang/Object;', [], { allocatable: true });
  for (const [name, value] of Object.entries({ BIOMETRIC_ERROR_HW_UNAVAILABLE: 1, BIOMETRIC_ERROR_UNABLE_TO_PROCESS: 2, BIOMETRIC_ERROR_TIMEOUT: 3, BIOMETRIC_ERROR_NO_SPACE: 4, BIOMETRIC_ERROR_CANCELED: 5, BIOMETRIC_ERROR_LOCKOUT: 7,
    BIOMETRIC_ERROR_VENDOR: 8, BIOMETRIC_ERROR_LOCKOUT_PERMANENT: 9, BIOMETRIC_ERROR_USER_CANCELED: 10, BIOMETRIC_ERROR_NO_BIOMETRICS: 11, BIOMETRIC_ERROR_HW_NOT_PRESENT: 12, BIOMETRIC_ERROR_NEGATIVE_BUTTON: 13,
    BIOMETRIC_ERROR_NO_DEVICE_CREDENTIAL: 14, BIOMETRIC_ACQUIRED_GOOD: 0, BIOMETRIC_ACQUIRED_PARTIAL: 1, BIOMETRIC_ACQUIRED_INSUFFICIENT: 2, BIOMETRIC_ACQUIRED_IMAGER_DIRTY: 3, BIOMETRIC_ACQUIRED_TOO_SLOW: 4,
    BIOMETRIC_ACQUIRED_TOO_FAST: 5, AUTHENTICATION_RESULT_TYPE_DEVICE_CREDENTIAL: 1, AUTHENTICATION_RESULT_TYPE_BIOMETRIC: 2 })) registry.staticField(PROMPT, name, 'I', () => value);
  const info = (r, self) => (r.object(self).promptInfo ??= { title: null, useDefaultTitle: false, subtitle: null, description: null, negative: null, confirmation: true, deviceCredential: false, authenticators: 0, sensorIds: [] });
  const emptyText = (r, value) => nullish(value) || r.stringCharacters(call(r, value, 'Ljava/lang/Object;', 'toString', [], STRING)) === '';
  const iae = (r, message) => r.throwJava('Ljava/lang/IllegalArgumentException;', message);
  def(PROMPT_BUILDER, '<init>', `(${CONTEXT_T})V`, (r, _m, [self, context]) => { r.object(self).context = context; info(r, self); });
  const setter = (name, parameters, apply) => def(PROMPT_BUILDER, name, `(${parameters})${PROMPT_BUILDER}`, (r, _m, [self, ...values]) => { apply(info(r, self), values, r, self); return self; });
  setter('setTitle', CHARS_T, (i, [v]) => { i.title = v; }); setter('setSubtitle', CHARS_T, (i, [v]) => { i.subtitle = v; }); setter('setDescription', CHARS_T, (i, [v]) => { i.description = v; });
  setter('setUseDefaultTitle', '', i => { i.useDefaultTitle = true; });
  setter('setConfirmationRequired', 'Z', (i, [v]) => { i.confirmation = !!v; }); setter('setDeviceCredentialAllowed', 'Z', (i, [v]) => { i.deviceCredential = !!v; });
  setter('setAllowedAuthenticators', 'I', (i, [v]) => { i.authenticators = v; });
  setter('setNegativeButton', `${CHARS_T}${EXEC}${CLICK}`, (i, [text, executor, listener], r, self) => {
    if (emptyText(r, text)) iae(r, 'Text must be set and non-empty'); if (nullish(executor)) iae(r, 'Executor must not be null'); if (nullish(listener)) iae(r, 'Listener must not be null');
    i.negative = text; r.object(self).negativeButton = { executor, listener };
  });
  def(PROMPT_BUILDER, 'build', `()${PROMPT}`, (r, _m, [self]) => {
    const i = info(r, self), credential = i.deviceCredential || (i.authenticators & 0x8000) !== 0;
    if (emptyText(r, i.title) && !i.useDefaultTitle) iae(r, 'Title must be set and non-empty');
    else if (emptyText(r, i.negative) && !credential) iae(r, 'Negative text must be set and non-empty');
    else if (!emptyText(r, i.negative) && credential) iae(r, "Can't have both negative button behavior and device credential enabled");
    const prompt = r.allocate(PROMPT); Object.assign(r.object(prompt), { context: r.object(self).context, promptInfo: { ...i }, negativeButton: r.object(self).negativeButton ?? null }); return prompt;
  });
  const promptInfo = (r, self) => r.object(self).promptInfo;
  def(PROMPT, 'getTitle', `()${CHARS_T}`, (r, _m, [self]) => promptInfo(r, self).title); def(PROMPT, 'shouldUseDefaultTitle', '()Z', (r, _m, [self]) => (promptInfo(r, self).useDefaultTitle ? 1 : 0));
  def(PROMPT, 'getSubtitle', `()${CHARS_T}`, (r, _m, [self]) => promptInfo(r, self).subtitle); def(PROMPT, 'getDescription', `()${CHARS_T}`, (r, _m, [self]) => promptInfo(r, self).description);
  def(PROMPT, 'getNegativeButtonText', `()${CHARS_T}`, (r, _m, [self]) => promptInfo(r, self).negative); def(PROMPT, 'isConfirmationRequired', '()Z', (r, _m, [self]) => (promptInfo(r, self).confirmation ? 1 : 0));
  def(PROMPT, 'getAllowedAuthenticators', '()I', (r, _m, [self]) => promptInfo(r, self).authenticators);
  // CryptoObject / AuthenticationResult / AuthenticationCallback
  for (const kind of ['Signature', 'Cipher', 'Mac']) {
    const java = { Signature: 'Ljava/security/Signature;', Cipher: 'Ljavax/crypto/Cipher;', Mac: 'Ljavax/crypto/Mac;' }[kind];
    def(PROMPT_CRYPTO, '<init>', `(${java})V`, (r, _m, [self, wrapped]) => { if (nullish(wrapped)) r.throwJava('Ljava/lang/NullPointerException;', null); r.object(self).wrapped = { kind, value: wrapped }; });
    def(PROMPT_CRYPTO, `get${kind}`, `()${java}`, (r, _m, [self]) => { const w = r.object(self).wrapped; return w?.kind === kind ? w.value : null; });
  }
  def(PROMPT_RESULT, 'getCryptoObject', `()${PROMPT_CRYPTO}`, (r, _m, [self]) => r.object(self).cryptoObject ?? null); def(PROMPT_RESULT, 'getAuthenticationType', '()I', (r, _m, [self]) => r.object(self).authenticationType ?? 0);
  def(PROMPT_CALLBACK, '<init>', '()V', () => {});
  for (const signature of ['onAuthenticationError(ILjava/lang/CharSequence;)V', 'onAuthenticationHelp(ILjava/lang/CharSequence;)V', `onAuthenticationSucceeded(${PROMPT_RESULT})V`, 'onAuthenticationFailed()V', 'onAuthenticationAcquired(I)V', 'onSystemEvent(I)V']) def(PROMPT_CALLBACK, signature.slice(0, signature.indexOf('(')), signature.slice(signature.indexOf('(')), () => {});
  const ERROR_STRINGS = { 12: 'Biometric hardware unavailable', 14: 'No pin, pattern, or password set' };   // R.string.biometric_error_hw_unavailable / biometric_error_device_not_secured
  const authenticate = (r, self, crypto, cancel, executor, authCallback) => {
    if (nullish(cancel)) iae(r, 'Must supply a cancellation signal'); if (nullish(executor)) iae(r, 'Must supply an executor'); if (nullish(authCallback)) iae(r, 'Must supply a callback');
    if (!holds(r, 'android.permission.USE_BIOMETRIC')) denied(r, 'Must have android.permission.USE_BIOMETRIC permission.');
    if (call(r, cancel, SIGNAL, 'isCanceled', [], 'Z')) return;   // "Authentication already canceled": the request is dropped
    const i = promptInfo(r, self), error = i.deviceCredential || (i.authenticators & 0x8000) !== 0 ? 14 : 12;
    runOn(r, executor, () => call(r, authCallback, PROMPT_CALLBACK, 'onAuthenticationError', ['I', CHARS_T], 'V', [error, ERROR_STRINGS[error]]), [authCallback]);
  };
  def(PROMPT, 'authenticate', `(${SIGNAL}${EXEC}${PROMPT_CALLBACK})V`, (r, _m, [self, cancel, executor, authCallback]) => authenticate(r, self, null, cancel, executor, authCallback));
  def(PROMPT, 'authenticate', `(${PROMPT_CRYPTO}${SIGNAL}${EXEC}${PROMPT_CALLBACK})V`, (r, _m, [self, crypto, cancel, executor, authCallback]) => {
    if (nullish(crypto)) iae(r, 'Must supply a crypto object'); if (nullish(cancel)) iae(r, 'Must supply a cancellation signal'); if (nullish(executor)) iae(r, 'Must supply an executor'); if (nullish(authCallback)) iae(r, 'Must supply a callback');
    const strength = (promptInfo(r, self).authenticators || 0xf) & 0xff; if ((strength & ~0xf) !== 0) iae(r, 'Only Strong biometrics supported with crypto');
    authenticate(r, self, crypto, cancel, executor, authCallback);
  });
  void LIST_T;

  // ---- AccountManager future-based methods (AccountManager.java android-13.0.0_r1): the client-side argument checks, then the request goes to AccountManagerService. This device has no
  // account authenticator, so a request that needs one fails the way the service reports it: the future ends with AuthenticatorException("bind failure") (ERROR_CODE_REMOTE_EXCEPTION),
  // after the call returned. The callback runs on the Handler (the main Looper when null); getResult() on the main Looper before that is the framework's IllegalStateException for
  // targetSdk >= 8. removeAccount needs the caller to be the authenticator (SecurityException); an empty feature list needs no authenticator and yields an empty array.
  const ACCOUNTS = 'Landroid/accounts/AccountManagerImpl;', ACCOUNT = 'Landroid/accounts/Account;', FUTURE = 'Lapkweb/bridge/AccountFuture;', FUTURE_I = 'Landroid/accounts/AccountManagerFuture;';
  const ACCOUNT_CB = 'Landroid/accounts/AccountManagerCallback;', UNITS = 'Ljava/util/concurrent/TimeUnit;';
  type(FUTURE, 'Ljava/lang/Object;', [FUTURE_I], { allocatable: true });
  const isMainThread = r => !r.thread || r.thread === r.scheduler.mainThread();
  const finish = (r, future) => {
    const state = r.object(future);
    if (state.done) return;
    state.done = true;
    if (nullish(state.callback)) return;
    const run = () => call(r, state.callback, ACCOUNT_CB, 'run', [FUTURE_I], 'V', [future]);
    if (nullish(state.handler)) platform.queueTask(run, 0, [future, state.callback]);
    else { const runnable = r.allocate(DELIVERY); r.object(runnable).task = run; call(r, state.handler, 'Landroid/os/Handler;', 'post', [RUNNABLE], 'Z', [runnable]); }
  };
  const newFuture = (r, callback, handler, outcome) => {
    const future = r.allocate(FUTURE); Object.assign(r.object(future), { done: false, cancelled: false, callback, handler, outcome });
    platform.queueTask(() => finish(r, future), 0, [future, callback, handler].filter(ref => !nullish(ref)));
    return future;
  };
  const bindFailure = { error: 'bind failure' };
  const result = (r, future) => {
    const state = r.object(future);
    if (state.cancelled) r.throwJava('Landroid/accounts/OperationCanceledException;', null);
    if (!state.done) {
      if (isMainThread(r) && (platform.targetSdk ?? 34) >= 8) r.throwJava('Ljava/lang/IllegalStateException;', 'calling this from your main thread can lead to deadlock');
      finish(r, future);   // another thread waits for the (immediate) answer of the service
    }
    if (state.outcome.error !== undefined) r.throwJava('Landroid/accounts/AuthenticatorException;', state.outcome.error);
    return state.outcome.value;
  };
  def(FUTURE, 'getResult', '()Ljava/lang/Object;', (r, _m, [self]) => result(r, self));
  def(FUTURE, 'getResult', `(J${UNITS})Ljava/lang/Object;`, (r, _m, [self]) => result(r, self));
  def(FUTURE, 'isDone', '()Z', (r, _m, [self]) => (r.object(self).done ? 1 : 0)); def(FUTURE, 'isCancelled', '()Z', (r, _m, [self]) => (r.object(self).cancelled ? 1 : 0));
  def(FUTURE, 'cancel', '(Z)Z', (r, _m, [self]) => { const state = r.object(self); if (state.done) return 0; state.cancelled = true; finish(r, self); return 1; });
  // [name, parameters, null checks [parameter index, message]..., outcome]; the future's parameters are the last callback and handler
  const CB_H = `${ACCOUNT_CB}${HANDLER}`, S = STRING, B = BUNDLE, SA = `[${STRING}`, boolArray = 'Z';
  const request = [
    ['addAccount', `${S}${S}${SA}${B}${ACTIVITY}${CB_H}`, [[0, 'accountType is null']]],
    ['getAuthToken', `${ACCOUNT}${S}${B}${ACTIVITY}${CB_H}`, [[0, 'account is null'], [1, 'authTokenType is null']]],
    ['getAuthToken', `${ACCOUNT}${S}${B}Z${CB_H}`, [[0, 'account is null'], [1, 'authTokenType is null']]],
    ['getAuthToken', `${ACCOUNT}${S}Z${CB_H}`, [[0, 'account is null'], [1, 'authTokenType is null']]],
    ['getAuthTokenByFeatures', `${S}${S}${SA}${ACTIVITY}${B}${B}${CB_H}`, [[0, 'account type is null'], [1, 'authTokenType is null']]],
    ['confirmCredentials', `${ACCOUNT}${B}${ACTIVITY}${CB_H}`, [[0, 'account is null']]],
    ['updateCredentials', `${ACCOUNT}${S}${B}${ACTIVITY}${CB_H}`, [[0, 'account is null']]],
    ['editProperties', `${S}${ACTIVITY}${CB_H}`, [[0, 'accountType is null']]],
    ['hasFeatures', `${ACCOUNT}${SA}${CB_H}`, [[0, 'account is null'], [1, 'features is null']]],
    ['getAuthTokenLabel', `${S}${S}${CB_H}`, [[0, 'accountType is null'], [1, 'authTokenType is null']]],
    ['isCredentialsUpdateSuggested', `${ACCOUNT}${S}${CB_H}`, [[0, 'account is null']]],
  ];
  const resultFor = { addAccount: B, getAuthToken: B, getAuthTokenByFeatures: B, confirmCredentials: B, updateCredentials: B, editProperties: B, hasFeatures: 'Ljava/lang/Boolean;', getAuthTokenLabel: STRING, isCredentialsUpdateSuggested: 'Ljava/lang/Boolean;' };
  void resultFor;
  for (const [name, parameters, checks] of request) {
    const shape = parameters.match(/\[?L[^;]+;|[ZIJ]/g);
    def(ACCOUNTS, name, `(${parameters})${FUTURE_I}`, (r, _m, [, ...args]) => {
      for (const [index, message] of checks) if (nullish(args[index])) iae(r, message);
      if (name === 'isCredentialsUpdateSuggested' && r.stringCharacters(args[1]) === '') iae(r, 'status token is empty');
      return newFuture(r, args[shape.length - 2], args[shape.length - 1], bindFailure);
    });
  }
  const accountTypeOf = (r, account) => r.stringCharacters(r.object(account).fields.get(`${ACCOUNT}->type:${STRING}`));
  def(ACCOUNTS, 'removeAccount', `(${ACCOUNT}${CB_H})${FUTURE_I}`, (r, _m, [, account, callback, handler]) => {
    if (nullish(account)) iae(r, 'account is null');
    denied(r, `uid ${uid()} cannot remove accounts of type: ${accountTypeOf(r, account)}`);
    return newFuture(r, callback, handler, bindFailure);
  });
  def(ACCOUNTS, 'removeAccount', `(${ACCOUNT}${ACTIVITY}${CB_H})${FUTURE_I}`, (r, _m, [, account, , callback, handler]) => {
    if (nullish(account)) iae(r, 'account is null');
    denied(r, `uid ${uid()} cannot remove accounts of type: ${accountTypeOf(r, account)}`);
    return newFuture(r, callback, handler, bindFailure);
  });
  def(ACCOUNTS, 'getAccountsByTypeAndFeatures', `(${S}${SA}${CB_H})${FUTURE_I}`, (r, _m, [, type, features, callback, handler]) => {
    if (nullish(type)) iae(r, 'type is null');
    const none = nullish(features) || r.array(features).elements.length === 0;
    return newFuture(r, callback, handler, none ? { value: (() => { const a = r.newArray(`[${ACCOUNT}`, 0); return a; })() } : bindFailure);
  });

  // ---- NotificationManager policy surface (NotificationManagerService android-13.0.0_r1): an app has no notification-policy access (Do Not Disturb access is a user grant), so the zen-rule
  // and policy mutators fail with the service's SecurityException; the interruption filter is "all" (zen mode off).
  const NOTIFICATIONS = 'Landroid/app/NotificationManagerImpl;', RULE = 'Landroid/app/AutomaticZenRule;', POLICY = 'Landroid/app/NotificationManager$Policy;', CONDITION = 'Landroid/service/notification/Condition;';
  const policyDenied = r => denied(r, 'Notification policy access denied');
  def(NOTIFICATIONS, 'getCurrentInterruptionFilter', '()I', () => 1); def(NOTIFICATIONS, 'isNotificationPolicyAccessGranted', '()Z', () => 0);
  def(NOTIFICATIONS, 'isNotificationListenerAccessGranted', '(Landroid/content/ComponentName;)Z', () => 0);
  def(NOTIFICATIONS, 'setInterruptionFilter', '(I)V', policyDenied); def(NOTIFICATIONS, 'setNotificationPolicy', `(${POLICY})V`, policyDenied);
  def(NOTIFICATIONS, 'getAutomaticZenRules', '()Ljava/util/Map;', policyDenied); def(NOTIFICATIONS, 'getAutomaticZenRule', `(${STRING})${RULE}`, policyDenied);
  def(NOTIFICATIONS, 'addAutomaticZenRule', `(${RULE})${STRING}`, policyDenied); def(NOTIFICATIONS, 'updateAutomaticZenRule', `(${STRING}${RULE})Z`, policyDenied);
  def(NOTIFICATIONS, 'removeAutomaticZenRule', `(${STRING})Z`, policyDenied); def(NOTIFICATIONS, 'setAutomaticZenRuleState', `(${STRING}${CONDITION})V`, policyDenied);

  // ---- NotificationManager.Policy (NotificationManager.java android-13.0.0_r1) and the queries that need no policy access. The default policy is the one ZenModeConfig derives from the
  // platform's default_zen_mode_config.xml: alarms, media, calls and messages from starred contacts, repeat callers and important conversations allowed; visual effects 157 suppressed.
  type(POLICY, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;'], { allocatable: true });
  const PC = { REMINDERS: 1, EVENTS: 2, MESSAGES: 4, CALLS: 8, REPEAT_CALLERS: 16, ALARMS: 32, MEDIA: 64, SYSTEM: 128, CONVERSATIONS: 256 };
  for (const [name, value] of Object.entries(PC)) registry.staticField(POLICY, `PRIORITY_CATEGORY_${name}`, 'I', () => value);
  for (const [name, value] of Object.entries({ PRIORITY_SENDERS_ANY: 0, PRIORITY_SENDERS_CONTACTS: 1, PRIORITY_SENDERS_STARRED: 2, CONVERSATION_SENDERS_ANYONE: 1, CONVERSATION_SENDERS_IMPORTANT: 2, CONVERSATION_SENDERS_NONE: 3, CONVERSATION_SENDERS_UNSET: -1,
    SUPPRESSED_EFFECTS_UNSET: -1, SUPPRESSED_EFFECT_SCREEN_OFF: 1, SUPPRESSED_EFFECT_SCREEN_ON: 2, SUPPRESSED_EFFECT_FULL_SCREEN_INTENT: 4, SUPPRESSED_EFFECT_LIGHTS: 8, SUPPRESSED_EFFECT_PEEK: 16, SUPPRESSED_EFFECT_STATUS_BAR: 32,
    SUPPRESSED_EFFECT_BADGE: 64, SUPPRESSED_EFFECT_AMBIENT: 128, SUPPRESSED_EFFECT_NOTIFICATION_LIST: 256, STATE_CHANNELS_BYPASSING_DND: 1, STATE_UNSET: -1 })) registry.staticField(POLICY, name, 'I', () => value);
  const ALL_CATEGORIES = [PC.ALARMS, PC.MEDIA, PC.SYSTEM, PC.REMINDERS, PC.EVENTS, PC.MESSAGES, PC.CALLS, PC.REPEAT_CALLERS, PC.CONVERSATIONS], ALL_EFFECTS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
  registry.staticField(POLICY, 'ALL_PRIORITY_CATEGORIES', '[I', r => { const a = r.newArray('[I', ALL_CATEGORIES.length); r.array(a).elements = [...ALL_CATEGORIES]; return a; });
  const policy = (r, ref) => r.object(ref).policy ?? r.throwJava('Ljava/lang/IllegalStateException;', 'Policy used before construction');
  const FIELDS = [['priorityCategories', 'categories'], ['priorityCallSenders', 'callSenders'], ['priorityMessageSenders', 'messageSenders'], ['priorityConversationSenders', 'conversation'], ['suppressedVisualEffects', 'effects'], ['state', 'state']];
  for (const [field] of FIELDS) registry.instanceField(POLICY, field, 'I', { reflect: true });
  const init = (r, self, categories, callSenders, messageSenders, effects, state, conversation) => {
    const p = { categories, callSenders, messageSenders, effects, state, conversation }; r.object(self).policy = p;
    for (const [field, key] of FIELDS) r.storeField(r.object(self).fields, `${POLICY}->${field}:I`, p[key]);
  };
  const makePolicy = (r, ...values) => { const p = r.allocate(POLICY); init(r, p, ...values); return p; };
  def(POLICY, '<init>', '(III)V', (r, _m, [self, c, calls, messages]) => init(r, self, c, calls, messages, -1, -1, -1));
  def(POLICY, '<init>', '(IIII)V', (r, _m, [self, c, calls, messages, effects]) => init(r, self, c, calls, messages, effects, -1, -1));
  def(POLICY, '<init>', '(IIIII)V', (r, _m, [self, c, calls, messages, effects, conversation]) => init(r, self, c, calls, messages, effects, -1, conversation));
  def(POLICY, '<init>', '(IIIIII)V', (r, _m, [self, c, calls, messages, effects, state, conversation]) => init(r, self, c, calls, messages, effects, state, conversation));
  const categoryName = c => ({ 1: 'PRIORITY_CATEGORY_REMINDERS', 2: 'PRIORITY_CATEGORY_EVENTS', 4: 'PRIORITY_CATEGORY_MESSAGES', 8: 'PRIORITY_CATEGORY_CALLS', 16: 'PRIORITY_CATEGORY_REPEAT_CALLERS', 32: 'PRIORITY_CATEGORY_ALARMS', 64: 'PRIORITY_CATEGORY_MEDIA', 128: 'PRIORITY_CATEGORY_SYSTEM', 256: 'PRIORITY_CATEGORY_CONVERSATIONS' })[c] ?? `PRIORITY_CATEGORY_UNKNOWN_${c}`;
  const effectName = e => ({ 4: 'SUPPRESSED_EFFECT_FULL_SCREEN_INTENT', 8: 'SUPPRESSED_EFFECT_LIGHTS', 16: 'SUPPRESSED_EFFECT_PEEK', 32: 'SUPPRESSED_EFFECT_STATUS_BAR', 64: 'SUPPRESSED_EFFECT_BADGE', 128: 'SUPPRESSED_EFFECT_AMBIENT', 256: 'SUPPRESSED_EFFECT_NOTIFICATION_LIST', 1: 'SUPPRESSED_EFFECT_SCREEN_OFF', 2: 'SUPPRESSED_EFFECT_SCREEN_ON', [-1]: 'SUPPRESSED_EFFECTS_UNSET' })[e] ?? `UNKNOWN_${e}`;
  const listBits = (value, all, name, unknown) => { if (value <= 0 && unknown === 'UNKNOWN_') return ''; if (value === 0) return ''; const out = []; for (const bit of all) { if (value & bit) out.push(name(bit)); value &= ~bit; } if (value !== 0) out.push(`${unknown}${value}`); return out.join(','); };
  const categoriesToString = c => listBits(c, ALL_CATEGORIES, categoryName, 'PRIORITY_CATEGORY_UNKNOWN_');
  const effectsToString = e => (e <= 0 ? '' : listBits(e, ALL_EFFECTS, effectName, 'UNKNOWN_'));
  const sendersToString = s => ({ 0: 'PRIORITY_SENDERS_ANY', 1: 'PRIORITY_SENDERS_CONTACTS', 2: 'PRIORITY_SENDERS_STARRED' })[s] ?? `PRIORITY_SENDERS_UNKNOWN_${s}`;
  const conversationToString = s => ({ 1: 'anyone', 2: 'important', 3: 'none', [-1]: 'unset' })[s] ?? `invalidConversationType{${s}}`;
  def(POLICY, 'priorityCategoriesToString', '(I)Ljava/lang/String;', (r, _m, [c]) => categoriesToString(c), { static: true });
  def(POLICY, 'suppressedEffectsToString', '(I)Ljava/lang/String;', (r, _m, [e]) => effectsToString(e), { static: true });
  def(POLICY, 'prioritySendersToString', '(I)Ljava/lang/String;', (r, _m, [s]) => sendersToString(s), { static: true });
  def(POLICY, 'conversationSendersToString', '(I)Ljava/lang/String;', (r, _m, [s]) => conversationToString(s), { static: true });
  def(POLICY, 'getAllSuppressedVisualEffects', '()I', () => 511, { static: true });
  def(POLICY, 'areAllVisualEffectsSuppressed', '(I)Z', (r, _m, [e]) => (ALL_EFFECTS.every(bit => e & bit) ? 1 : 0), { static: true });
  def(POLICY, 'describeContents', '()I', () => 0);
  def(POLICY, 'toString', '()Ljava/lang/String;', (r, _m, [self]) => { const p = policy(r, self); return `NotificationManager.Policy[priorityCategories=${categoriesToString(p.categories)},priorityCallSenders=${sendersToString(p.callSenders)},priorityMessageSenders=${sendersToString(p.messageSenders)},priorityConvSenders=${conversationToString(p.conversation)},suppressedVisualEffects=${effectsToString(p.effects)},areChannelsBypassingDnd=${p.state === -1 ? 'unset' : (p.state & 1) !== 0 ? 'true' : 'false'}]`; });
  const effectsEqual = (a, b) => {
    if (a === b) return true;
    const expand = e => { if (e & 2) e |= 16; if (e & 1) e |= 4 | 8 | 128; return e; };
    if ((a & 2) !== (b & 2)) { const cur = (a & 2) !== 0 ? b : a; if ((cur & 16) === 0) return false; }
    if ((a & 1) !== (b & 1)) { const cur = (a & 1) !== 0 ? b : a; if ((cur & 4) === 0 || (cur & 8) === 0 || (cur & 128) === 0) return false; }
    void expand;
    return (a & ~3) === (b & ~3);
  };
  def(POLICY, 'equals', '(Ljava/lang/Object;)Z', (r, _m, [self, other]) => {
    if (other === self) return 1; if (other === null || other === 0 || !r.object(other).policy) return 0;
    const a = policy(r, self), b = policy(r, other);
    return a.categories === b.categories && a.callSenders === b.callSenders && a.messageSenders === b.messageSenders && effectsEqual(a.effects, b.effects) && a.state === b.state && a.conversation === b.conversation ? 1 : 0;
  });
  def(POLICY, 'hashCode', '()I', (r, _m, [self]) => { const p = policy(r, self); let h = 1; for (const v of [p.categories, p.callSenders, p.messageSenders, p.effects, p.state, p.conversation]) h = (Math.imul(31, h) + v) | 0; return h; });
  const CATEGORY_TESTS = { allowAlarms: PC.ALARMS, allowMedia: PC.MEDIA, allowSystem: PC.SYSTEM, allowRepeatCallers: PC.REPEAT_CALLERS, allowCalls: PC.CALLS, allowConversations: PC.CONVERSATIONS, allowMessages: PC.MESSAGES, allowEvents: PC.EVENTS, allowReminders: PC.REMINDERS };
  for (const [name, bit] of Object.entries(CATEGORY_TESTS)) def(POLICY, name, '()Z', (r, _m, [self]) => ((policy(r, self).categories & bit) !== 0 ? 1 : 0));
  def(POLICY, 'allowCallsFrom', '()I', (r, _m, [self]) => policy(r, self).callSenders); def(POLICY, 'allowMessagesFrom', '()I', (r, _m, [self]) => policy(r, self).messageSenders); def(POLICY, 'allowConversationsFrom', '()I', (r, _m, [self]) => policy(r, self).conversation);
  for (const [name, bit] of Object.entries({ showFullScreenIntents: 4, showLights: 8, showPeeking: 16, showStatusBarIcons: 32, showAmbient: 128, showBadges: 64, showInNotificationList: 256 })) def(POLICY, name, '()Z', (r, _m, [self]) => ((policy(r, self).effects & bit) === 0 ? 1 : 0));
  const defaultPolicy = r => makePolicy(r, PC.CONVERSATIONS | PC.CALLS | PC.MESSAGES | PC.REPEAT_CALLERS | PC.ALARMS | PC.MEDIA, 2, 2, 157, 0, 2);
  def(NOTIFICATIONS, 'getNotificationPolicy', `()${POLICY}`, r => defaultPolicy(r)); def(NOTIFICATIONS, 'getConsolidatedNotificationPolicy', `()${POLICY}`, r => defaultPolicy(r));
  // bubbles and pause state: the default preference is BUBBLE_PREFERENCE_NONE with the feature on; the status-bar icon query is for notification listeners only
  def(NOTIFICATIONS, 'areBubblesAllowed', '()Z', () => 0); def(NOTIFICATIONS, 'areBubblesEnabled', '()Z', () => 1); def(NOTIFICATIONS, 'getBubblePreference', '()I', () => 0);
  def(NOTIFICATIONS, 'areNotificationsPaused', '()Z', () => 0);
  def(NOTIFICATIONS, 'shouldHideSilentStatusBarIcons', '()Z', r => denied(r, 'Only available for notification listeners'));

  // ---- StatusBarNotification (android-13.0.0_r1) for NotificationManager.getActiveNotifications(): the notifications this app posted and has not cancelled, in post order (the service
  // returns only the caller's own). The user is the owner (0); the process id is the virtual process.
  const SBN = 'Landroid/service/notification/StatusBarNotification;', NOTIFICATION = 'Landroid/app/Notification;';
  type(SBN, 'Ljava/lang/Object;', ['Landroid/os/Parcelable;'], { allocatable: true });
  const sbn = (r, ref) => r.object(ref).sbn ?? r.throwJava('Ljava/lang/IllegalStateException;', 'StatusBarNotification used before construction');
  const userHandle0 = r => r.dispatch({ owner: 'Landroid/os/UserHandle;', name: 'of', parameters: ['I'], result: 'Landroid/os/UserHandle;', signature: '(I)Landroid/os/UserHandle;' }, [0], 'static');
  const notificationString = (r, ref, name, result = STRING) => call(r, ref, NOTIFICATION, name, [], result);
  const makeSbn = (r, record, notification) => {
    const o = r.allocate(SBN), pkg = platform.packageName, tag = record.tag, user = userHandle0(r);
    const key = `0|${pkg}|${record.id}|${tag}|${uid()}`;
    const group = notificationString(r, notification, 'getGroup'), sortKey = notificationString(r, notification, 'getSortKey');
    const groupKey = group === null && sortKey === null ? key : `0|${pkg}|${group === null ? `c:${r.stringCharacters(notificationString(r, notification, 'getChannelId'))}` : `g:${r.stringCharacters(group)}`}`;
    r.object(o).sbn = { pkg, id: record.id, tag, uid: uid(), notification, user, time: record.time, key, groupKey, appGroup: group !== null || sortKey !== null };
    return o;
  };
  def(NOTIFICATIONS, 'getActiveNotifications', `()[${SBN}`, r => {
    const list = [...(platform.notificationRecords ?? new Map()).entries()].map(([key, record]) => makeSbn(r, record, platform.notificationPosted.get(key)));
    const array = r.newArray(`[${SBN}`, list.length); r.array(array).elements = list; return array;
  });
  def(SBN, 'getPackageName', `()${STRING}`, (r, _m, [self]) => sbn(r, self).pkg); def(SBN, 'getOpPkg', `()${STRING}`, (r, _m, [self]) => sbn(r, self).pkg);
  def(SBN, 'getId', '()I', (r, _m, [self]) => sbn(r, self).id); def(SBN, 'getTag', `()${STRING}`, (r, _m, [self]) => sbn(r, self).tag); def(SBN, 'getUid', '()I', (r, _m, [self]) => sbn(r, self).uid);
  def(SBN, 'getNotification', `()${NOTIFICATION}`, (r, _m, [self]) => sbn(r, self).notification); def(SBN, 'getUser', '()Landroid/os/UserHandle;', (r, _m, [self]) => sbn(r, self).user);
  def(SBN, 'getUserId', '()I', () => 0); def(SBN, 'getPostTime', '()J', (r, _m, [self]) => sbn(r, self).time);
  def(SBN, 'getKey', `()${STRING}`, (r, _m, [self]) => sbn(r, self).key); def(SBN, 'getGroupKey', `()${STRING}`, (r, _m, [self]) => sbn(r, self).groupKey);
  def(SBN, 'isGroup', '()Z', (r, _m, [self]) => (sbn(r, self).appGroup ? 1 : 0)); def(SBN, 'isAppGroup', '()Z', (r, _m, [self]) => (sbn(r, self).appGroup ? 1 : 0));
  const flags = (r, self) => r.object(sbn(r, self).notification).fields.get(`${NOTIFICATION}->flags:I`) ?? 0;
  def(SBN, 'isOngoing', '()Z', (r, _m, [self]) => ((flags(r, self) & 2) !== 0 ? 1 : 0)); def(SBN, 'isClearable', '()Z', (r, _m, [self]) => ((flags(r, self) & (2 | 32)) === 0 ? 1 : 0));
  def(SBN, 'toString', `()${STRING}`, (r, _m, [self]) => {
    const s = sbn(r, self), text = ref => r.stringCharacters(call(r, ref, 'Ljava/lang/Object;', 'toString', [], STRING));
    return `StatusBarNotification(pkg=${s.pkg} user=${text(s.user)} id=${s.id} tag=${s.tag} key=${s.key}: ${text(s.notification)})`;
  });
  def(SBN, 'describeContents', '()I', () => 0);

  // ---- Legacy GpsStatus (GpsStatus.java / LocationManager.getGpsStatus, android-13.0.0_r1). The virtual device has no GNSS hardware, so LocationManager has no GnssStatus: getGpsStatus returns the
  // given GpsStatus unchanged or a new empty one ("legacy behavior was to always return a GpsStatus instance"), which reports no satellites and no time to first fix.
  const GPS_STATUS = 'Landroid/location/GpsStatus;', GPS_SATELLITE = 'Landroid/location/GpsSatellite;', LOCATION_MANAGER = 'Landroid/location/LocationManagerImpl;';
  type(GPS_STATUS, 'Ljava/lang/Object;', [], { allocatable: true }); type(GPS_SATELLITE, 'Ljava/lang/Object;', [], { allocatable: true });
  for (const [name, value] of Object.entries({ GPS_EVENT_STARTED: 1, GPS_EVENT_STOPPED: 2, GPS_EVENT_FIRST_FIX: 3, GPS_EVENT_SATELLITE_STATUS: 4 })) registry.staticField(GPS_STATUS, name, 'I', () => value);
  def(LOCATION_MANAGER, 'getGpsStatus', `(${GPS_STATUS})${GPS_STATUS}`, (r, _m, [, status]) => (nullish(status) ? r.allocate(GPS_STATUS) : status));
  def(GPS_STATUS, 'getTimeToFirstFix', '()I', () => 0); def(GPS_STATUS, 'getMaxSatellites', '()I', () => 0);
  def(GPS_STATUS, 'getSatellites', '()Ljava/lang/Iterable;', r => r.dispatch({ owner: 'Ljava/util/Collections;', name: 'emptyList', parameters: [], result: 'Ljava/util/List;', signature: '()Ljava/util/List;' }, [], 'static'));
  // GpsSatellite instances exist only inside a GpsStatus with satellites, and this device reports none; the accessors answer the zero state of an unused record
  for (const [name, result] of [['getPrn', 'I'], ['getSnr', 'F'], ['getElevation', 'F'], ['getAzimuth', 'F'], ['hasEphemeris', 'Z'], ['hasAlmanac', 'Z'], ['usedInFix', 'Z']]) def(GPS_SATELLITE, name, `()${result}`, () => 0);
  return { ...registry };
}
