// Entry points of the microG features the lab never performs (docs/MICROG.md section 9). Each one names one microG method, as it exists in the pinned build's DEX, at the point where
// that feature's work would begin: for most, the method whose return value is the feature's result; where the result is produced in a Kotlin coroutine or delivered through a callback
// (no method returns it), the enablement check that sits first on the path and is reached with microG's locks on. com.google.android.gms is built without R8 shrinking, so its method
// names match the source; com.android.vending is optimized by R8 without obfuscation. With the option on, every call of such a method is intercepted on both engines
// (src/method-overrides.js setMethodInterceptor), in the option's packages only. Without a mock the device records one uniform failure per entry point and microG's own body then runs
// (so the app still gets that API's ordinary result from the locked microG; tests/microg-option.test.mjs is unchanged). With a mock the mock's value is returned instead of the body,
// coerced to the method's return type, and the hit is reported. The lab ships no mock of any entry point. Every method below is checked against the built DEX by tests/microg-entry-points.test.mjs.

const GMS = 'com.google.android.gms', VENDING = 'com.android.vending';
const CONTEXT = 'Landroid/content/Context;', CONTINUATION = 'Lkotlin/coroutines/Continuation;', OBJECT = 'Ljava/lang/Object;', BUNDLE = 'Landroid/os/Bundle;', STRING = 'Ljava/lang/String;';

export const MICROG_ENTRY_POINTS = Object.freeze([
  { id: 'checkin', pkg: GMS, label: 'Device registration (check-in)',
    method: { owner: 'Lorg/microg/gms/checkin/CheckinManager;', name: 'checkin', signature: `(${CONTEXT}Z)Lorg/microg/gms/checkin/LastCheckinInfo;` },
    returnType: 'org.microg.gms.checkin.LastCheckinInfo (null = no check-in)',
    note: 'The method that builds the check-in request and returns the LastCheckinInfo of the response. Mock: a LastCheckinInfo (or null).' },
  { id: 'account-token', pkg: GMS, label: 'Google account token (auth)',
    method: { owner: 'Lorg/microg/gms/auth/AuthManager;', name: 'requestAuth', signature: '(Z)Lorg/microg/gms/auth/AuthResponse;' },
    returnType: 'org.microg.gms.auth.AuthResponse (auth field = the token)',
    note: 'The method that returns the AuthResponse of the accounts server. Mock: an AuthResponse (with the auth field filled in).' },
  { id: 'push-registration', pkg: GMS, label: 'Push registration (GCM/FCM token)',
    method: { owner: 'Lorg/microg/gms/gcm/PushRegisterServiceKt;', name: 'ensureCheckinIsUpToDate', signature: `(${CONTEXT}${CONTINUATION})${OBJECT}` },
    returnType: 'kotlin.Unit (coroutine): the check-in verification of the push registration flow',
    valueless: true,
    note: 'The first guard of the push registration reached with the blocks on (throws "Checkin disabled"). The registration itself delivers the token Bundle through a callback, not through a return value; mocking only this check lets the step proceed, it does not produce the token. See the limits note in the docs.' },
  { id: 'safetynet-attest', pkg: GMS, label: 'SafetyNet attestation',
    method: { owner: 'Lorg/microg/gms/safetynet/SafetyNetClientServiceImpl;', name: 'attestWithApiKey', signature: '(Lcom/google/android/gms/safetynet/internal/ISafetyNetCallbacks;[BLjava/lang/String;)V' },
    returnType: 'void: the result would go through ISafetyNetCallbacks.onAttestationResult',
    valueless: true,
    note: 'The method that would answer the attestation (today it calls onAttestationResult with an error Status). It delivers the result through a callback, not a return value; the return mock does not feed it. See the limits note in the docs.' },
  { id: 'play-integrity', pkg: VENDING, label: 'Play Integrity token',
    method: { owner: 'Lcom/google/android/finsky/integrityservice/IntegrityServiceImpl$requestIntegrityToken$1;', name: 'invokeSuspend', signature: `(${OBJECT})${OBJECT}` },
    returnType: 'coroutine (invokeSuspend): the token would go through IIntegrityServiceCallback.onRequestIntegrityToken',
    valueless: true,
    note: 'The body of the requestIntegrityToken coroutine, where the isDeviceAttestationEnabled guard (inlined by R8) refuses and, if released, DroidGuard/the network would produce the token. It is the point reached with the blocks on. The result goes through a callback and the coroutine state machine has no single return value; the return mock does not feed it. See the limits note in the docs.' },
  { id: 'droidguard', pkg: GMS, label: 'DroidGuard (initWithRequest)',
    method: { owner: 'Lorg/microg/gms/droidguard/core/DroidGuardHandleImpl;', name: 'initWithRequest', signature: '(Ljava/lang/String;Lcom/google/android/gms/droidguard/internal/DroidGuardResultsRequest;)Lcom/google/android/gms/droidguard/internal/DroidGuardInitReply;' },
    returnType: 'com.google.android.gms.droidguard.internal.DroidGuardInitReply',
    note: 'The method that would create the DroidGuard handle from the downloaded code and returns the DroidGuardInitReply. The downloaded code is never loaded (codeLoadGuard). Mock: a DroidGuardInitReply.' },
  { id: 'licensing', pkg: VENDING, label: 'Play licensing (checkLicense)',
    method: { owner: 'Lcom/android/vending/licensing/LicensingService$mLicenseService$1;', name: 'checkLicenseCommon', signature: '(Ljava/lang/String;Lcoil/util/-Lifecycles;Lkotlin/coroutines/jvm/internal/ContinuationImpl;)Ljava/lang/Object;' },
    returnType: 'com.android.vending.licensing.LicenseResponse via coroutine (null = off)',
    note: 'The suspend method that does the license check and returns the LicenseResponse. Mock: a LicenseResponse (or null).' },
  { id: 'billing', pkg: VENDING, label: 'Play billing (getBuyIntentExtraParams)',
    method: { owner: 'Lorg/microg/vending/billing/InAppBillingServiceImpl;', name: 'getBuyIntentExtraParams', signature: `(I${STRING}${STRING}${STRING}${STRING}${BUNDLE})${BUNDLE}` },
    returnType: 'android.os.Bundle (RESPONSE_CODE, BUY_INTENT)',
    note: 'The method that would build the purchase intent and returns the Bundle (today BILLING_UNAVAILABLE). Mock: a Bundle.' },
]);

export const microgEntryPointById = id => MICROG_ENTRY_POINTS.find(e => e.id === id) ?? null;
/** The entry point's method as the DEX names it, in smali form. */
export const microgEntryMethodSmali = entry => `${entry.method.owner}->${entry.method.name}${entry.method.signature}`;
