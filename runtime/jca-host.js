import { createHostRegistry } from './host-contract.js?v=d50f2f368405';
import { FRAMEWORK_RESOURCES } from './jca-resources.js?v=d50f2f368405';

// Platform boundary of the original java.security / javax.crypto / Conscrypt classes in the framework DEX (framework-aosp/jca-sources.txt):
//   * java.lang.System.logE/logW/logI (libcore hidden logging helpers the Provider framework calls) go to the VM trace like logcat lines;
//   * android.icu.text.Normalizer2, the ICU class behind the original java.text.Normalizer (X500Name canonical names, IDN, Conscrypt hostnames): the four standard forms
//     (NFC, NFD, NFKC, NFKD) over the browser's own Unicode normalization, String.prototype.normalize -- the platform boundary for ICU4J's normalizer;
//   * the platform side of the Keystore 2 client (frameworks/base android.security.keystore2 over the generated AIDL stubs, framework-aosp/generated-keystore2): ServiceManager serves
//     the software Keystore 2 service of framework-aosp/lab-java-jca (dev.apkweb.keystore.LabKeystore, over the software KeyMint on Conscrypt), UserHandle.myUserId, the hidden
//     BiometricManager.getAuthenticatorIds (the virtual device has no enrolled biometric: none), the Intent that resolves the RKP provisioner (the app is not installed), and the lab
//     Host class the service uses (package name, a flush of the app-data store so keys survive a page reload);
//   * the resource files of the framework's own classes (java/security/security.properties, the Android 13 provider list) are served from src/jca-resources.js.
// No algorithm lives here: providers, key factories, signatures and ciphers are the original Java over the BoringSSL wasm module (vendor/native-libs/wasm32/javacrypto).
const STRING = 'Ljava/lang/String;', THROWABLE = 'Ljava/lang/Throwable;', SYSTEM = 'Ljava/lang/System;';
const encoder = new TextEncoder();

export function createJcaHost(platform) {
  const registry = createHostRegistry(), { def } = registry;
  const log = (letter, runtime, message, throwable) => {
    const text = message === null ? 'null' : runtime.stringCharacters(message);
    runtime.record(`LOG ${letter} System: ${text}${throwable ? ` (${runtime.className ? runtime.object(throwable).type : 'throwable'})` : ''}`);
  };
  for (const [name, letter] of [['logE', 'E'], ['logW', 'W'], ['logI', 'I']]) {
    def(SYSTEM, name, `(${STRING})V`, (r, _m, [message]) => log(letter, r, message, null), { static: true });
    def(SYSTEM, name, `(${STRING}${THROWABLE})V`, (r, _m, [message, throwable]) => log(letter, r, message, throwable), { static: true });
  }
  const NORMALIZER2 = 'Landroid/icu/text/Normalizer2;', OBJECT = 'Ljava/lang/Object;', CHAR_SEQUENCE = 'Ljava/lang/CharSequence;';
  registry.type(NORMALIZER2, OBJECT, [], { allocatable: true });
  const text = (r, value) => value === null ? r.throwJava('Ljava/lang/NullPointerException;', null) : r.typeOf(value) === STRING ? r.stringCharacters(value) : r.stringCharacters(r.dispatch({ owner: OBJECT, name: 'toString', parameters: [], result: STRING, signature: `()${STRING}` }, [value], 'virtual'));
  for (const [getter, form] of [['getNFCInstance', 'NFC'], ['getNFDInstance', 'NFD'], ['getNFKCInstance', 'NFKC'], ['getNFKDInstance', 'NFKD']]) {
    def(NORMALIZER2, getter, `()${NORMALIZER2}`, r => { r.normalizers ??= {}; return r.normalizers[form] ??= (() => { const ref = r.allocate(NORMALIZER2); r.object(ref).normalizationForm = form; return ref; })(); }, { static: true });
  }
  def(NORMALIZER2, 'normalize', `(${CHAR_SEQUENCE})${STRING}`, (r, _m, [self, source]) => text(r, source).normalize(r.object(self).normalizationForm));
  def(NORMALIZER2, 'isNormalized', `(${CHAR_SEQUENCE})Z`, (r, _m, [self, source]) => { const t = text(r, source); return t === t.normalize(r.object(self).normalizationForm) ? 1 : 0; });
  const SERVICE_MANAGER = 'Landroid/os/ServiceManager;', IBINDER = 'Landroid/os/IBinder;', KEYSTORE2 = 'android.system.keystore2.IKeystoreService/default';
  const serviceNamed = (r, name) => {
    if (name === null || r.stringCharacters(name) !== KEYSTORE2) return null;
    return r.dispatch({ owner: 'Ldev/apkweb/keystore/LabKeystore;', name: 'service', parameters: [], result: IBINDER, signature: `()${IBINDER}` }, [], 'static');
  };
  registry.type(SERVICE_MANAGER);
  for (const name of ['getService', 'checkService', 'waitForService']) def(SERVICE_MANAGER, name, `(${STRING})${IBINDER}`, (r, _m, [service]) => serviceNamed(r, service), { static: true });
  def(SERVICE_MANAGER, 'isDeclared', `(${STRING})Z`, (r, _m, [service]) => serviceNamed(r, service) === null ? 0 : 1, { static: true });
  def('Landroid/os/UserHandle;', 'myUserId', '()I', () => 0, { static: true });
  def('Landroid/hardware/biometrics/BiometricManager;', 'getAuthenticatorIds', '()[J', r => { const a = r.newArray('[J', 0); return a; });
  def('Landroid/content/Intent;', 'resolveSystemService', '(Landroid/content/pm/PackageManager;I)Landroid/content/ComponentName;', () => null);
  const HOST = 'Ldev/apkweb/keystore/Host;';
  registry.type(HOST);
  def(HOST, 'packageName', `()${STRING}`, () => platform.packageName ?? 'unknown', { static: true });
  def(HOST, 'commit', '()V', () => { platform.appData?.syncPoint?.('keystore'); }, { static: true });
  platform.frameworkResource = entry => { const resource = FRAMEWORK_RESOURCES[entry]; return resource ? encoder.encode(resource.text) : null; };
  return { ...registry, interfaces: registry.interfacesOf };
}
