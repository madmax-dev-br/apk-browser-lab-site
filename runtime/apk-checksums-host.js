import { APKError } from './apk-error.js?v=2378988610d3';
import { createHostRegistry } from './host-contract.js?v=2378988610d3';
import { CONTENT_DIGEST, TYPE, TYPE_NAMES, digestSteps, merkleSteps, signatureContentDigests } from './apk-checksums.js?v=2378988610d3';

// PackageManager.requestChecksums (API 31+) with android.content.pm.Checksum / ApkChecksum, as ApplicationPackageManager and PackageManagerService/ApkChecksums (android-13.0.0_r1) answer for an app that
// was side-loaded (no installer: no installer-provided checksums, so the trusted-installer part is empty):
//   - whole-file MD5 / SHA-1 / SHA-256 / SHA-512 are computed over the loaded base APK by host-native streaming digests (src/fast-digests.js), in slices that do not block the VM;
//   - the 4K Merkle root is the fs-verity/apk-verity tree root over the whole file (apk-checksums.js);
//   - the partial 1 MiB Merkle roots are the APK Signature Scheme v3/v2 content digests read from the signing block (absent for an APK without a v2/v3 signature, as on a device);
//   - the listener runs on a "Binder:<pid>_N" thread, as the framework delivers it from the package manager service; split APKs: none are installed.
const OBJECT = 'Ljava/lang/Object;', STRING = 'Ljava/lang/String;', LIST = 'Ljava/util/List;', PM = 'Landroid/content/pm/PackageManager;', CHECKSUM = 'Landroid/content/pm/Checksum;', APK_CHECKSUM = 'Landroid/content/pm/ApkChecksum;';
const LISTENER = 'Landroid/content/pm/PackageManager$OnChecksumsReadyListener;', DELIVERY = 'Landroid/content/pm/ApplicationPackageManager$ChecksumDelivery;', PARCEL = 'Landroid/os/Parcel;', CREATOR = 'Landroid/os/Parcelable$Creator;', PARCELABLE = 'Landroid/os/Parcelable;';
const CERTIFICATE = 'Ljava/security/cert/Certificate;';
const WHOLE = [[TYPE.WHOLE_MD5, 'MD5'], [TYPE.WHOLE_SHA1, 'SHA-1'], [TYPE.WHOLE_SHA256, 'SHA-256'], [TYPE.WHOLE_SHA512, 'SHA-512']];

export function createApkChecksumsHost(platform) {
  const registry = createHostRegistry(), { def, type, staticField } = registry;
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args, { receiver }), 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, r.argumentWords(parameters, args), 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, r.argumentWords(parameters, args, { receiver: o }), 'direct'); return o; };
  const nullish = v => v === null || v === undefined || v === 0;
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const npe = (r, message = null) => r.throwJava('Ljava/lang/NullPointerException;', message);
  const put = (r, self, owner, name, ftype, value) => r.storeField(r.object(self).fields, `${owner}->${name}:${ftype}`, value);
  const get = (r, self, owner, name, ftype) => r.object(self).fields.get(`${owner}->${name}:${ftype}`) ?? null;

  // ---- Checksum / ApkChecksum value classes ---------------------------------------------------------------------------------------------------
  type(CHECKSUM, OBJECT, [PARCELABLE], { allocatable: true }); type(APK_CHECKSUM, OBJECT, [PARCELABLE], { allocatable: true }); type(LISTENER, OBJECT, []);
  registry.interfaces.set(LISTENER, []);
  const TYPE_LIST = Object.entries(TYPE_NAMES).map(([value, name]) => `${name}(${value})`).join(', ');
  def(CHECKSUM, '<init>', '(I[B)V', (r, _m, [self, checksumType, value]) => {
    if (nullish(value)) npe(r, 'value');
    if (!Object.hasOwn(TYPE_NAMES, checksumType)) r.throwJava('Ljava/lang/IllegalArgumentException;', `type was ${checksumType} but must be one of: ${TYPE_LIST}`);
    put(r, self, CHECKSUM, 'mType', 'I', checksumType); put(r, self, CHECKSUM, 'mValue', '[B', value);
  });
  def(CHECKSUM, 'getType', '()I', (r, _m, [self]) => get(r, self, CHECKSUM, 'mType', 'I'));
  def(CHECKSUM, 'getValue', '()[B', (r, _m, [self]) => get(r, self, CHECKSUM, 'mValue', '[B'));
  def(CHECKSUM, 'describeContents', '()I', () => 0);
  def(APK_CHECKSUM, 'getSplitName', `()${STRING}`, (r, _m, [self]) => get(r, self, APK_CHECKSUM, 'mSplitName', STRING));
  def(APK_CHECKSUM, 'getType', '()I', (r, _m, [self]) => call(r, get(r, self, APK_CHECKSUM, 'mChecksum', CHECKSUM), CHECKSUM, 'getType', [], 'I'));
  def(APK_CHECKSUM, 'getValue', '()[B', (r, _m, [self]) => call(r, get(r, self, APK_CHECKSUM, 'mChecksum', CHECKSUM), CHECKSUM, 'getValue', [], '[B'));
  def(APK_CHECKSUM, 'getInstallerPackageName', `()${STRING}`, (r, _m, [self]) => get(r, self, APK_CHECKSUM, 'mInstallerPackageName', STRING));
  def(APK_CHECKSUM, 'getInstallerCertificate', `()${CERTIFICATE}`, (r, _m, [self]) => get(r, self, APK_CHECKSUM, 'mInstallerCertificate', CERTIFICATE));   // null: no installer certificate (a side-loaded app has no installer-provided checksums)
  def(APK_CHECKSUM, 'describeContents', '()I', () => 0);
  def(APK_CHECKSUM, 'toString', `()${STRING}`, () => { throw new APKError('ApkChecksum.toString: its text is generated framework code that the lab does not carry; use getSplitName/getType/getValue', { kind: 'apk-checksum-tostring-unsupported' }); });
  const makeApkChecksum = (r, splitName, checksumType, bytes) => {
    const value = r.arrayOf('[B', bytes);
    const checksum = construct(r, CHECKSUM, ['I', '[B'], [checksumType, value]), apk = r.allocate(APK_CHECKSUM);
    put(r, apk, APK_CHECKSUM, 'mSplitName', STRING, splitName); put(r, apk, APK_CHECKSUM, 'mChecksum', CHECKSUM, checksum); put(r, apk, APK_CHECKSUM, 'mInstallerPackageName', STRING, null); put(r, apk, APK_CHECKSUM, 'mInstallerCertificate', CERTIFICATE, null);
    return apk;
  };
  // Parcel: Checksum = type + value; ApkChecksum = split name, checksum, installer package name (the installer certificate is always null here).
  const CHECKSUM_CREATOR = 'Landroid/content/pm/Checksum$1;', APK_CHECKSUM_CREATOR = 'Landroid/content/pm/ApkChecksum$1;';
  type(CHECKSUM_CREATOR, OBJECT, [CREATOR], { allocatable: true }); type(APK_CHECKSUM_CREATOR, OBJECT, [CREATOR], { allocatable: true });
  const parcelCall = (r, parcel, name, parameters, result, args = []) => call(r, parcel, PARCEL, name, parameters, result, args);
  def(CHECKSUM, 'writeToParcel', `(${PARCEL}I)V`, (r, _m, [self, parcel]) => { parcelCall(r, parcel, 'writeInt', ['I'], 'V', [get(r, self, CHECKSUM, 'mType', 'I')]); parcelCall(r, parcel, 'writeByteArray', ['[B'], 'V', [get(r, self, CHECKSUM, 'mValue', '[B')]); });
  def(CHECKSUM_CREATOR, 'createFromParcel', `(${PARCEL})${OBJECT}`, (r, _m, [, parcel]) => { const t = parcelCall(r, parcel, 'readInt', [], 'I'), value = parcelCall(r, parcel, 'createByteArray', [], '[B'); return construct(r, CHECKSUM, ['I', '[B'], [t, value]); });
  def(CHECKSUM_CREATOR, 'newArray', `(I)[${OBJECT}`, (r, _m, [, size]) => r.newArray(`[${CHECKSUM}`, size));
  staticField(CHECKSUM, 'CREATOR', CREATOR, r => r.allocate(CHECKSUM_CREATOR));
  def(APK_CHECKSUM, 'writeToParcel', `(${PARCEL}I)V`, (r, _m, [self, parcel]) => {
    parcelCall(r, parcel, 'writeString', [STRING], 'V', [get(r, self, APK_CHECKSUM, 'mSplitName', STRING)]); call(r, get(r, self, APK_CHECKSUM, 'mChecksum', CHECKSUM), CHECKSUM, 'writeToParcel', [PARCEL, 'I'], 'V', [parcel, 0]);
    parcelCall(r, parcel, 'writeString', [STRING], 'V', [get(r, self, APK_CHECKSUM, 'mInstallerPackageName', STRING)]);
  });
  def(APK_CHECKSUM_CREATOR, 'createFromParcel', `(${PARCEL})${OBJECT}`, (r, _m, [, parcel]) => {
    const apk = r.allocate(APK_CHECKSUM), split = parcelCall(r, parcel, 'readString', [], STRING), t = parcelCall(r, parcel, 'readInt', [], 'I'), value = parcelCall(r, parcel, 'createByteArray', [], '[B');
    put(r, apk, APK_CHECKSUM, 'mSplitName', STRING, split); put(r, apk, APK_CHECKSUM, 'mChecksum', CHECKSUM, construct(r, CHECKSUM, ['I', '[B'], [t, value]));
    put(r, apk, APK_CHECKSUM, 'mInstallerPackageName', STRING, parcelCall(r, parcel, 'readString', [], STRING)); put(r, apk, APK_CHECKSUM, 'mInstallerCertificate', CERTIFICATE, null); return apk;
  });
  def(APK_CHECKSUM_CREATOR, 'newArray', `(I)[${OBJECT}`, (r, _m, [, size]) => r.newArray(`[${APK_CHECKSUM}`, size));
  staticField(APK_CHECKSUM, 'CREATOR', CREATOR, r => r.allocate(APK_CHECKSUM_CREATOR));

  // ---- PackageManager.TRUST_ALL / TRUST_NONE: the identity of the list says which (ApplicationPackageManager compares with ==) ---------------------
  const trustLists = new WeakMap();
  const trust = (r, which) => { const table = trustLists.get(r) ?? trustLists.set(r, {}).get(r); if (!table[which]) { const list = which === 'ALL' ? callStatic(r, 'Ljava/util/Collections;', 'singletonList', [OBJECT], LIST, [null]) : callStatic(r, 'Ljava/util/Collections;', 'emptyList', [], LIST); table[which] = list; } return table[which]; };
  staticField(PM, 'TRUST_ALL', LIST, r => trust(r, 'ALL')); staticField(PM, 'TRUST_NONE', LIST, r => trust(r, 'NONE'));

  // ---- the work -----------------------------------------------------------------------------------------------------------------------------------
  // The checksums are computed by host-native code (src/fast-digests.js: streaming MD5/SHA-1/SHA-256/SHA-512 on the raw bytes; the 4K Merkle tree), in slices of about 1 MiB queued as host tasks, so
  // the main thread and every other VM thread keep running while they are computed. Results are cached per loaded APK and type. When they are ready a "Binder:<pid>_N" thread delivers them to the
  // listener: only that thread runs app code for the delivery, and the requesting call itself returns immediately.
  const cache = new WeakMap();   // bytes -> Map(type -> Uint8Array | null)
  const SIGNATURE_BACKED = new Map([[TYPE.PARTIAL_MERKLE_ROOT_1M_SHA256, CONTENT_DIGEST.CHUNKED_SHA256], [TYPE.PARTIAL_MERKLE_ROOT_1M_SHA512, CONTENT_DIGEST.CHUNKED_SHA512]]);
  /** Generator that fills `known` (Map type -> bytes | null) for the required types, yielding between slices. */
  function* computeSteps(source, required, known) {
    const { bytes, archive } = source;
    for (const wanted of Object.values(TYPE).sort((a, b) => a - b)) {
      if (!(required & wanted) || known.has(wanted)) continue;
      if (wanted === TYPE.WHOLE_MERKLE_ROOT_4K_SHA256) known.set(wanted, yield* merkleSteps(bytes));
      else if (SIGNATURE_BACKED.has(wanted)) known.set(wanted, signatureContentDigests(archive).get(SIGNATURE_BACKED.get(wanted)) ?? null);   // absent when the APK is not signed with that digest
      else known.set(wanted, yield* digestSteps(WHOLE.find(([t]) => t === wanted)[1], bytes));
    }
  }
  const SLICE_MS = 12;
  const runJob = (r, steps, finished, roots) => {
    const slice = () => {
      const started = performance.now();
      for (;;) { const next = steps.next(); if (next.done) { finished(); return; } if (performance.now() - started >= SLICE_MS) break; }
      platform.queueTask(slice, 0, roots);
    };
    platform.queueTask(slice, 0, roots);
  };

  // The delivery runs as a Runnable on a new "Binder:<pid>_N" thread: it turns the computed values into ApkChecksum objects and calls the listener with the List<ApkChecksum>.
  type(DELIVERY, OBJECT, ['Ljava/lang/Runnable;'], { allocatable: true });
  def(DELIVERY, 'run', '()V', (r, _m, [self]) => {
    const listener = get(r, self, DELIVERY, 'listener', LISTENER), results = r.object(self).checksums, list = construct(r, 'Ljava/util/ArrayList;', [], []);
    for (const [checksumType, value] of results) call(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [makeApkChecksum(r, null, checksumType, value)]);
    call(r, listener, LISTENER, 'onChecksumsReady', [LIST], 'V', [list]);
  });
  let binderThreads = 0;
  const deliver = (r, listener, results) => {
    const delivery = r.allocate(DELIVERY); put(r, delivery, DELIVERY, 'listener', LISTENER, listener); r.object(delivery).checksums = results;
    const thread = construct(r, 'Ljava/lang/Thread;', ['Ljava/lang/Runnable;', STRING], [delivery, `Binder:${platform.virtualProcess.pid}_${++binderThreads}`]);
    call(r, thread, 'Ljava/lang/Thread;', 'start', [], 'V');
  };
  def(PM, 'requestChecksums', `(${STRING}ZI${LIST}${LISTENER})V`, (r, _m, [, packageName, , required, trustedInstallers, listener]) => {
    if (nullish(packageName)) npe(r); if (nullish(listener)) npe(r); if (nullish(trustedInstallers)) npe(r);
    // ApplicationPackageManager.requestChecksums: TRUST_ALL / TRUST_NONE by identity, any other list must be non-empty; certificates are encoded (getEncoded) before the request is made.
    if (trustedInstallers !== trust(r, 'ALL') && trustedInstallers !== trust(r, 'NONE')) {
      if (call(r, trustedInstallers, LIST, 'isEmpty', [], 'Z')) r.throwJava('Ljava/lang/IllegalArgumentException;', 'trustedInstallers has to be one of TRUST_ALL/TRUST_NONE or a non-empty list of certificates.');
      const size = call(r, trustedInstallers, LIST, 'size', [], 'I');
      for (let i = 0; i < size; i++) { const certificate = call(r, trustedInstallers, LIST, 'get', ['I'], OBJECT, [i]); if (!nullish(certificate)) call(r, certificate, CERTIFICATE, 'getEncoded', [], '[B'); }
    }
    const name = text(r, packageName), entry = platform.appServices.findPackage(r, name);   // NameNotFoundException(packageName) for an unknown package
    if (entry.system) throw new APKError(`PackageManager.requestChecksums: the APK of the system package ${name} is not part of the lab, its checksums cannot be computed`, { kind: 'checksums-system-package-unsupported' });
    const source = r.apkFileSource?.(); if (!source) throw new APKError('PackageManager.requestChecksums: the loaded APK bytes are not available to this runtime', { kind: 'checksums-apk-unavailable' });
    const known = cache.get(source.bytes) ?? cache.set(source.bytes, new Map()).get(source.bytes), wanted = required | 0;
    const answer = () => deliver(r, listener, [...known].filter(([t, v]) => (wanted & t) && v).sort((a, b) => a[0] - b[0]));
    runJob(r, computeSteps(source, wanted, known), () => answer(), [listener]);   // already cached: the first slice finishes at once
  });
  return registry;
}
