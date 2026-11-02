import { createHostRegistry } from './host-contract.js?v=93b5ba602b8e';

// The system-manager methods an ordinary app calls that the first host passes left out, for a one-user, unmanaged, unlocked phone without fingerprint hardware or thermal HAL
// (android-13.0.0_r1 UserManager / UserManagerService, KeyguardManager / PhoneWindowManager, PowerManager / ThermalManagerService, FingerprintManager):
//  UserManager     one user (0, "Owner"), no restrictions, MANAGE_USERS operations refused with the platform's text
//  KeyguardManager the keyguard is not showing: KeyguardLock needs DISABLE_KEYGUARD, exitKeyguardSecurely succeeds, requestDismissKeyguard reports an error (nothing to dismiss)
//  PowerManager    thermal listeners hear the current status (NONE), no headroom (NaN), no standby / idle modes, reboot() needs the REBOOT permission
//  BiometricPrompt (Builder checks, CryptoObject, callbacks; no sensor, so authenticate() reports the service's error), FingerprintManager.authenticate / CryptoObject / AuthenticationCallback: no hardware, so nothing is ever authenticated and no success is reported
const USER = 'Landroid/os/UserManagerImpl;', USER_STATIC = 'Landroid/os/UserManager;', KEYGUARD = 'Landroid/app/KeyguardManagerImpl;', POWER = 'Landroid/os/PowerManagerImpl;', FINGERPRINT = 'Landroid/hardware/fingerprint/FingerprintManagerImpl;';
const HANDLE = 'Landroid/os/UserHandle;', BUNDLE = 'Landroid/os/Bundle;', LIST = 'Ljava/util/List;', STRING = 'Ljava/lang/String;', EXECUTOR = 'Ljava/util/concurrent/Executor;', RUNNABLE = 'Ljava/lang/Runnable;', DELIVERY = 'Lapkweb/bridge/TelephonyDelivery;';
const LOCK = 'Landroid/app/KeyguardManager$KeyguardLock;', EXIT = 'Landroid/app/KeyguardManager$OnKeyguardExitResult;', DISMISS = 'Landroid/app/KeyguardManager$KeyguardDismissCallback;', ACTIVITY = 'Landroid/app/Activity;';
const THERMAL = 'Landroid/os/PowerManager$OnThermalStatusChangedListener;';
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
  const runOn = (r, executor, task) => {   // Executor.execute(Runnable) with a platform closure
    if (nullish(executor)) { platform.queueTask(task, 0, []); return; }
    const runnable = r.allocate(DELIVERY); r.object(runnable).task = task; call(r, executor, EXECUTOR, 'execute', [RUNNABLE], 'V', [runnable]);
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

  // ---- PowerManager
  const thermal = platform.thermalListeners ??= [];
  const notifyThermal = (r, listener, executor) => runOn(r, executor, () => { if (thermal.some(entry => entry.listener.ref === listener.ref)) call(r, listener, r.typeOf(listener), 'onThermalStatusChanged', ['I'], 'V', [0]); });   // THERMAL_STATUS_NONE
  for (const signature of [`(${THERMAL})V`, `(${EXECUTOR}${THERMAL})V`]) def(POWER, 'addThermalStatusListener', signature, (r, _m, args) => {
    const listener = args.at(-1), executor = args.length > 2 ? args[1] : null;
    if (nullish(listener)) r.throwJava('Ljava/lang/NullPointerException;', null);
    if (thermal.some(entry => entry.listener.ref === listener.ref)) return;   // a listener registered twice is not registered again
    thermal.push({ listener, executor }); notifyThermal(r, listener, executor);
  });
  def(POWER, 'removeThermalStatusListener', `(${THERMAL})V`, (r, _m, [, listener]) => { const at = thermal.findIndex(entry => entry.listener.ref === listener?.ref); if (at >= 0) thermal.splice(at, 1); });
  def(POWER, 'getThermalHeadroom', '(I)F', () => 0x7fc00000 | 0);   // Float.NaN: this device has no thermal HAL
  def(POWER, 'getLocationPowerSaveMode', '()I', () => 0);   // LOCATION_MODE_NO_CHANGE
  for (const name of ['isLowPowerStandbyEnabled', 'isDeviceLightIdleMode', 'isBatteryDischargePredictionPersonalized']) def(POWER, name, '()Z', () => 0);
  def(POWER, 'isRebootingUserspaceSupported', '()Z', () => 0, { static: true }); def(POWER, 'getBatteryDischargePrediction', '()Ljava/time/Duration;', () => null);
  def(POWER, 'reboot', `(${STRING})V`, r => denied(r, `Neither user ${uid()} nor current process has android.permission.REBOOT.`));

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
    runOn(r, executor, () => call(r, authCallback, PROMPT_CALLBACK, 'onAuthenticationError', ['I', CHARS_T], 'V', [error, ERROR_STRINGS[error]]));
  };
  def(PROMPT, 'authenticate', `(${SIGNAL}${EXEC}${PROMPT_CALLBACK})V`, (r, _m, [self, cancel, executor, authCallback]) => authenticate(r, self, null, cancel, executor, authCallback));
  def(PROMPT, 'authenticate', `(${PROMPT_CRYPTO}${SIGNAL}${EXEC}${PROMPT_CALLBACK})V`, (r, _m, [self, crypto, cancel, executor, authCallback]) => {
    if (nullish(crypto)) iae(r, 'Must supply a crypto object'); if (nullish(cancel)) iae(r, 'Must supply a cancellation signal'); if (nullish(executor)) iae(r, 'Must supply an executor'); if (nullish(authCallback)) iae(r, 'Must supply a callback');
    const strength = (promptInfo(r, self).authenticators || 0xf) & 0xff; if ((strength & ~0xf) !== 0) iae(r, 'Only Strong biometrics supported with crypto');
    authenticate(r, self, crypto, cancel, executor, authCallback);
  });
  void LIST_T;
  return { ...registry };
}
