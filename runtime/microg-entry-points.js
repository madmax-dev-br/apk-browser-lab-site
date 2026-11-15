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
  { id: 'checkin', pkg: GMS, label: 'Registro do dispositivo (check-in)',
    method: { owner: 'Lorg/microg/gms/checkin/CheckinManager;', name: 'checkin', signature: `(${CONTEXT}Z)Lorg/microg/gms/checkin/LastCheckinInfo;` },
    returnType: 'org.microg.gms.checkin.LastCheckinInfo (null = nenhum check-in)',
    note: 'O método que monta o pedido de check-in e devolve o LastCheckinInfo da resposta. Mock: um LastCheckinInfo (ou null).' },
  { id: 'account-token', pkg: GMS, label: 'Token de conta Google (auth)',
    method: { owner: 'Lorg/microg/gms/auth/AuthManager;', name: 'requestAuth', signature: '(Z)Lorg/microg/gms/auth/AuthResponse;' },
    returnType: 'org.microg.gms.auth.AuthResponse (campo auth = o token)',
    note: 'O método que devolve a AuthResponse do servidor de contas. Mock: uma AuthResponse (com o campo auth preenchido).' },
  { id: 'push-registration', pkg: GMS, label: 'Registro de push (token GCM/FCM)',
    method: { owner: 'Lorg/microg/gms/gcm/PushRegisterServiceKt;', name: 'ensureCheckinIsUpToDate', signature: `(${CONTEXT}${CONTINUATION})${OBJECT}` },
    returnType: 'kotlin.Unit (corrotina): a verificação de check-in do fluxo de registro de push',
    valueless: true,
    note: 'A primeira trava do registro de push alcançada com os bloqueios ligados (lança "Checkin disabled"). O registro em si entrega o Bundle do token por um callback, não por retorno; mockar só esta verificação libera a etapa, não produz o token. Ver a nota de limite nos docs.' },
  { id: 'safetynet-attest', pkg: GMS, label: 'Atestação SafetyNet',
    method: { owner: 'Lorg/microg/gms/safetynet/SafetyNetClientServiceImpl;', name: 'attestWithApiKey', signature: '(Lcom/google/android/gms/safetynet/internal/ISafetyNetCallbacks;[BLjava/lang/String;)V' },
    returnType: 'void: o resultado iria por ISafetyNetCallbacks.onAttestationResult',
    valueless: true,
    note: 'O método que responderia a atestação (hoje chama onAttestationResult com um Status de erro). Entrega o resultado por callback, não por retorno; o mock de retorno não o alimenta. Ver a nota de limite nos docs.' },
  { id: 'play-integrity', pkg: VENDING, label: 'Token do Play Integrity',
    method: { owner: 'Lcom/google/android/finsky/integrityservice/IntegrityServiceImpl$requestIntegrityToken$1;', name: 'invokeSuspend', signature: `(${OBJECT})${OBJECT}` },
    returnType: 'corrotina (invokeSuspend): o token iria por IIntegrityServiceCallback.onRequestIntegrityToken',
    valueless: true,
    note: 'O corpo da corrotina requestIntegrityToken, onde a trava isDeviceAttestationEnabled (incorporada pelo R8) recusa e, se liberada, o DroidGuard/rede produziria o token. É o ponto alcançado com os bloqueios ligados. O resultado vai por callback e a máquina de estados da corrotina não tem um valor de retorno único; o mock de retorno não o alimenta. Ver a nota de limite nos docs.' },
  { id: 'droidguard', pkg: GMS, label: 'DroidGuard (initWithRequest)',
    method: { owner: 'Lorg/microg/gms/droidguard/core/DroidGuardHandleImpl;', name: 'initWithRequest', signature: '(Ljava/lang/String;Lcom/google/android/gms/droidguard/internal/DroidGuardResultsRequest;)Lcom/google/android/gms/droidguard/internal/DroidGuardInitReply;' },
    returnType: 'com.google.android.gms.droidguard.internal.DroidGuardInitReply',
    note: 'O método que criaria o handle do DroidGuard a partir do código baixado e devolve o DroidGuardInitReply. O código baixado nunca é carregado (codeLoadGuard). Mock: um DroidGuardInitReply.' },
  { id: 'licensing', pkg: VENDING, label: 'Licenciamento Play (checkLicense)',
    method: { owner: 'Lcom/android/vending/licensing/LicensingService$mLicenseService$1;', name: 'checkLicenseCommon', signature: '(Ljava/lang/String;Lcoil/util/-Lifecycles;Lkotlin/coroutines/jvm/internal/ContinuationImpl;)Ljava/lang/Object;' },
    returnType: 'com.android.vending.licensing.LicenseResponse via corrotina (null = desligado)',
    note: 'O método suspenso que faz a verificação de licença e devolve a LicenseResponse. Mock: uma LicenseResponse (ou null).' },
  { id: 'billing', pkg: VENDING, label: 'Faturamento Play (getBuyIntentExtraParams)',
    method: { owner: 'Lorg/microg/vending/billing/InAppBillingServiceImpl;', name: 'getBuyIntentExtraParams', signature: `(I${STRING}${STRING}${STRING}${STRING}${BUNDLE})${BUNDLE}` },
    returnType: 'android.os.Bundle (RESPONSE_CODE, BUY_INTENT)',
    note: 'O método que montaria a intent de compra e devolve o Bundle (hoje BILLING_UNAVAILABLE). Mock: um Bundle.' },
]);

export const microgEntryPointById = id => MICROG_ENTRY_POINTS.find(e => e.id === id) ?? null;
/** The entry point's method as the DEX names it, in smali form. */
export const microgEntryMethodSmali = entry => `${entry.method.owner}->${entry.method.name}${entry.method.signature}`;
