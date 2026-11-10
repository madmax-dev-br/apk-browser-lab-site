import { createHostRegistry } from './host-contract.js?v=fc0742f95a72';
import { APKError } from './apk-error.js?v=fc0742f95a72';

// android.content.pm.PackageManager public API (API 33) that the package model of app-services-host does not answer yet, ported from android-13.0.0_r1 PackageManager.java /
// ApplicationPackageManager.java for a device with this app and the system packages of that model. Flag-holder overloads (ComponentInfoFlags / PackageInfoFlags / ResolveInfoFlags) forward to the
// int forms; calls that need a privileged caller (changing another package's state, preferred activities, installer names, permissions of the platform) refuse with the SecurityException the
// framework gives an ordinary app; things the virtual device has none of (instant apps, modules, suspended packages, instrumentation, package properties) answer empty. What would need a
// framework class the lab does not carry (PackageInstaller, InstallSourceInfo, checksums, Property) says so explicitly.
const PM = 'Landroid/content/pm/PackageManager;', STRING = 'Ljava/lang/String;', STRINGS = '[Ljava/lang/String;', COMPONENT = 'Landroid/content/ComponentName;', INTENT = 'Landroid/content/Intent;', LIST = 'Ljava/util/List;';
const OBJECT = 'Ljava/lang/Object;', DRAWABLE = 'Landroid/graphics/drawable/Drawable;', APP_INFO = 'Landroid/content/pm/ApplicationInfo;', ACTIVITY_INFO = 'Landroid/content/pm/ActivityInfo;', SERVICE_INFO = 'Landroid/content/pm/ServiceInfo;';
const PROVIDER_INFO = 'Landroid/content/pm/ProviderInfo;', PACKAGE_INFO = 'Landroid/content/pm/PackageInfo;', RESOLVE_INFO = 'Landroid/content/pm/ResolveInfo;', RESOURCES = 'Landroid/content/res/Resources;', CONFIG = 'Landroid/content/res/Configuration;';
const COMPONENT_FLAGS = 'Landroid/content/pm/PackageManager$ComponentInfoFlags;', PACKAGE_FLAGS = 'Landroid/content/pm/PackageManager$PackageInfoFlags;', RESOLVE_FLAGS = 'Landroid/content/pm/PackageManager$ResolveInfoFlags;', VERSIONED = 'Landroid/content/pm/VersionedPackage;';
const NOT_FOUND = 'Landroid/content/pm/PackageManager$NameNotFoundException;', SECURITY = 'Ljava/lang/SecurityException;';
const SIGNATURE_MATCH = 0, SIGNATURE_NO_MATCH = -3, SIGNATURE_UNKNOWN_PACKAGE = -4;
const nullish = v => v === null || v === undefined || v === 0;
const SHARED_LIBRARIES = ['android.ext.shared', 'android.hidl.base-V1.0-java', 'android.hidl.manager-V1.0-java', 'android.test.base', 'android.test.mock', 'android.test.runner', 'com.android.future.usb.accessory', 'com.android.location.provider', 'com.android.media.remotedisplay', 'com.android.mediadrm.signer', 'javax.obex', 'org.apache.http.legacy'];

export function createPackageManagerApiHost(platform) {
  const registry = createHostRegistry(), { def, type } = registry;
  // PackageManager.NameNotFoundException is an application-constructible checked exception (AndroidException subclass)
  type(NOT_FOUND, 'Landroid/util/AndroidException;', [], { allocatable: true });
  def(NOT_FOUND, '<init>', '()V', () => {}); def(NOT_FOUND, '<init>', '(Ljava/lang/String;)V', (r, _m, [self, message]) => { r.object(self).message = message; });
  const call = (r, receiver, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, [receiver, ...args], 'virtual');
  const callStatic = (r, owner, name, parameters, result, args = []) => r.dispatch({ owner, name, parameters, result, signature: `(${parameters.join('')})${result}` }, args, 'static');
  const construct = (r, owner, parameters, args) => { const o = r.allocate(owner); r.dispatch({ owner, name: '<init>', parameters, result: 'V', signature: `(${parameters.join('')})V` }, [o, ...args], 'direct'); return o; };
  const text = (r, v) => nullish(v) ? null : typeof v === 'string' ? v : r.stringCharacters(v);
  const npe = (r, m = null) => r.throwJava('Ljava/lang/NullPointerException;', m);
  const notFound = (r, name) => r.throwJava(NOT_FOUND, name);
  const security = (r, what) => r.throwJava(SECURITY, `Neither user ${platform.virtualProcess.uid} nor current process has ${what}.`);
  const unsupported = (message, kind) => { throw new APKError(message, { kind }); };
  const own = () => platform.packageName;
  const emptyList = r => callStatic(r, 'Ljava/util/Collections;', 'emptyList', [], LIST);
  const known = (r, name) => { if (nullish(name)) npe(r, 'packageName'); const n = text(r, name); platform.appServices.findPackage(r, n); return n; };
  const flagValue = (r, holder) => { if (nullish(holder)) npe(r, 'flags'); return Number(BigInt.asIntN(32, call(r, holder, COMPONENT_FLAGS, 'getValue', [], 'J'))); };
  const strings = (r, values) => { const array = r.newArray(STRINGS, values.length); r.array(array).elements = values; return array; };
  type(COMPONENT_FLAGS, OBJECT, [], { allocatable: true });
  def(COMPONENT_FLAGS, 'of', `(J)${COMPONENT_FLAGS}`, (r, _m, [value]) => { const holder = r.makeObject(COMPONENT_FLAGS); r.object(holder).flagsValue = BigInt(value); return holder; }, { static: true });
  def(COMPONENT_FLAGS, 'getValue', '()J', (r, _m, [self]) => r.object(self).flagsValue ?? 0n);

  // ---- flag-holder forwards --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  for (const [name, result] of [['getActivityInfo', ACTIVITY_INFO], ['getServiceInfo', SERVICE_INFO], ['getReceiverInfo', ACTIVITY_INFO], ['getProviderInfo', PROVIDER_INFO]]) {
    def(PM, name, `(${COMPONENT}${COMPONENT_FLAGS})${result}`, (r, _m, [self, component, holder]) => call(r, self, PM, name, [COMPONENT, 'I'], result, [component, flagValue(r, holder)]));
  }
  def(PM, 'resolveContentProvider', `(${STRING}${COMPONENT_FLAGS})${PROVIDER_INFO}`, (r, _m, [self, authority, holder]) => call(r, self, PM, 'resolveContentProvider', [STRING, 'I'], PROVIDER_INFO, [authority, flagValue(r, holder)]));
  def(PM, 'resolveActivity', `(${INTENT}${RESOLVE_FLAGS})${RESOLVE_INFO}`, (r, _m, [self, intent, holder]) => call(r, self, PM, 'resolveActivity', [INTENT, 'I'], RESOLVE_INFO, [intent, flagValue(r, holder)]));
  def(PM, 'resolveService', `(${INTENT}${RESOLVE_FLAGS})${RESOLVE_INFO}`, (r, _m, [self, intent, holder]) => call(r, self, PM, 'resolveService', [INTENT, 'I'], RESOLVE_INFO, [intent, flagValue(r, holder)]));
  def(PM, 'queryIntentContentProviders', `(${INTENT}${RESOLVE_FLAGS})${LIST}`, (r, _m, [self, intent, holder]) => call(r, self, PM, 'queryIntentContentProviders', [INTENT, 'I'], LIST, [intent, flagValue(r, holder)]));
  def(PM, 'getPackageInfo', `(${VERSIONED}I)${PACKAGE_INFO}`, (r, _m, [self, versioned, flags]) => { if (nullish(versioned)) npe(r, 'versionedPackage'); return call(r, self, PM, 'getPackageInfo', [STRING, 'I'], PACKAGE_INFO, [call(r, versioned, VERSIONED, 'getPackageName', [], STRING), flags]); });
  def(PM, 'getPackageInfo', `(${VERSIONED}${PACKAGE_FLAGS})${PACKAGE_INFO}`, (r, _m, [self, versioned, holder]) => call(r, self, PM, 'getPackageInfo', [VERSIONED, 'I'], PACKAGE_INFO, [versioned, Number(BigInt.asIntN(32, call(r, holder, PACKAGE_FLAGS, 'getValue', [], 'J')))]));
  def(PM, 'queryIntentActivityOptions', `(${COMPONENT}[${INTENT}${INTENT}I)${LIST}`, (r, _m, [self, , , intent, flags]) => call(r, self, PM, 'queryIntentActivities', [INTENT, 'I'], LIST, [intent, flags]));
  def(PM, 'queryIntentActivityOptions', `(${COMPONENT}${LIST}${INTENT}${RESOLVE_FLAGS})${LIST}`, (r, _m, [self, , , intent, holder]) => call(r, self, PM, 'queryIntentActivities', [INTENT, RESOLVE_FLAGS], LIST, [intent, holder]));
  def(PM, 'getSharedLibraries', `(I)${LIST}`, r => emptyList(r)); def(PM, 'getSharedLibraries', `(${PACKAGE_FLAGS})${LIST}`, r => emptyList(r));
  def(PM, 'getSystemSharedLibraryNames', `()${STRINGS}`, r => strings(r, SHARED_LIBRARIES));
  def(PM, 'getSystemAvailableFeatures', '()[Landroid/content/pm/FeatureInfo;', r => {
    const FEATURE = 'Landroid/content/pm/FeatureInfo;', names = [...platform.systemFeatures].sort(), array = r.newArray(`[${FEATURE}`, names.length);
    r.array(array).elements = names.map(name => { const info = r.makeObject(FEATURE); r.storeField(r.object(info).fields, `${FEATURE}->name:${STRING}`, name); return info; }); return array;
  });

  // ---- launch intents, resources, icons --------------------------------------------------------------------------------------------------------------------------------------------------------------
  def(PM, 'getLaunchIntentForPackage', `(${STRING})${INTENT}`, (r, _m, [, name]) => {
    if (nullish(name)) npe(r, 'packageName'); const n = text(r, name); if (n !== own()) return null;   // the only package with a launcher Activity is this app
    const launcher = (platform.manifest?.activities ?? []).find(a => a.launcher); if (!launcher) return null;
    const intent = construct(r, INTENT, [STRING], ['android.intent.action.MAIN']);
    call(r, intent, INTENT, 'addCategory', [STRING], INTENT, ['android.intent.category.LAUNCHER']); call(r, intent, INTENT, 'setPackage', [STRING], INTENT, [n]);
    call(r, intent, INTENT, 'setFlags', ['I'], INTENT, [0x10000000]); call(r, intent, INTENT, 'setClassName', [STRING, STRING], INTENT, [n, launcher.name]); return intent;
  });
  def(PM, 'getLeanbackLaunchIntentForPackage', `(${STRING})${INTENT}`, (r, _m, [, name]) => { if (nullish(name)) npe(r, 'packageName'); return null; });   // no Leanback launcher on a phone
  def(PM, 'getLaunchIntentSenderForPackage', `(${STRING})Landroid/content/IntentSender;`, () => unsupported('PackageManager.getLaunchIntentSenderForPackage: IntentSender is not part of the lab framework', 'intent-sender-unsupported'));
  const resourcesOf = (r, name) => { if (text(r, name) !== own()) notFound(r, text(r, name)); return call(r, platform.application, 'Landroid/content/Context;', 'getResources', [], RESOURCES); };
  def(PM, 'getResourcesForApplication', `(${STRING})${RESOURCES}`, (r, _m, [, name]) => { if (nullish(name)) npe(r); return resourcesOf(r, name); });
  def(PM, 'getResourcesForApplication', `(${APP_INFO})${RESOURCES}`, (r, _m, [, info]) => { if (nullish(info)) npe(r); return resourcesOf(r, r.object(info).fields.get(`Landroid/content/pm/PackageItemInfo;->packageName:${STRING}`)); });
  def(PM, 'getResourcesForApplication', `(${APP_INFO}${CONFIG})${RESOURCES}`, (r, _m, [self, info]) => call(r, self, PM, 'getResourcesForApplication', [APP_INFO], RESOURCES, [info]));
  def(PM, 'getResourcesForActivity', `(${COMPONENT})${RESOURCES}`, (r, _m, [, component]) => resourcesOf(r, call(r, component, COMPONENT, 'getPackageName', [], STRING)));
  const iconOf = (r, resId) => resId ? call(r, resourcesOf(r, own()), RESOURCES, 'getDrawable', ['I', 'Landroid/content/res/Resources$Theme;'], DRAWABLE, [resId, null]) : null;
  const defaultIcon = r => call(r, callStatic(r, RESOURCES, 'getSystem', [], RESOURCES), RESOURCES, 'getDrawable', ['I', 'Landroid/content/res/Resources$Theme;'], DRAWABLE, [0x01080093, null]);   // android.R.drawable.sym_def_app_icon
  const appIcon = (r, name, kind) => { const n = known(r, name); if (n !== own()) return defaultIcon(r); const icon = platform.manifest?.application?.[kind]; return typeof icon === 'number' && icon ? iconOf(r, icon) : defaultIcon(r); };
  for (const [name, kind] of [['getApplicationIcon', 'icon'], ['getApplicationLogo', 'logo'], ['getApplicationBanner', 'banner']]) {
    def(PM, name, `(${STRING})${DRAWABLE}`, (r, _m, [, pkg]) => kind === 'icon' ? appIcon(r, pkg, kind) : (known(r, pkg), kind === 'logo' && typeof platform.manifest?.application?.logo === 'number' ? iconOf(r, platform.manifest.application.logo) : null));
    def(PM, name, `(${APP_INFO})${DRAWABLE}`, (r, _m, [self, info]) => call(r, self, PM, name, [STRING], DRAWABLE, [r.object(info).fields.get(`Landroid/content/pm/PackageItemInfo;->packageName:${STRING}`)]));
  }
  const activityIcon = (r, component, kind) => {
    const n = text(r, call(r, component, COMPONENT, 'getPackageName', [], STRING)); if (n !== own()) notFound(r, n);
    const cls = text(r, call(r, component, COMPONENT, 'getClassName', [], STRING)), declaration = (platform.manifest?.activities ?? []).find(a => a.name === cls); if (!declaration) notFound(r, `${n}/${cls}`);
    const resId = declaration[kind] ?? platform.manifest?.application?.[kind]; return typeof resId === 'number' && resId ? iconOf(r, resId) : kind === 'icon' ? defaultIcon(r) : null;
  };
  const intentComponent = (r, self, intent) => { const resolved = call(r, intent, INTENT, 'getComponent', [], COMPONENT); if (!nullish(resolved)) return resolved; const info = call(r, self, PM, 'resolveActivity', [INTENT, 'I'], RESOLVE_INFO, [intent, 0]); if (nullish(info)) notFound(r, text(r, call(r, intent, OBJECT, 'toString', [], STRING))); const ai = r.object(info).fields.get(`${RESOLVE_INFO}->activityInfo:${ACTIVITY_INFO}`); return construct(r, COMPONENT, [STRING, STRING], [own(), text(r, r.object(ai).fields.get(`${ACTIVITY_INFO}->name:${STRING}`))]); };
  for (const [name, kind] of [['getActivityIcon', 'icon'], ['getActivityLogo', 'logo'], ['getActivityBanner', 'banner']]) {
    def(PM, name, `(${COMPONENT})${DRAWABLE}`, (r, _m, [, component]) => activityIcon(r, component, kind));
    def(PM, name, `(${INTENT})${DRAWABLE}`, (r, _m, [self, intent]) => activityIcon(r, intentComponent(r, self, intent), kind));
  }
  def(PM, 'getDefaultActivityIcon', `()${DRAWABLE}`, r => defaultIcon(r));
  def(PM, 'isDefaultApplicationIcon', `(${DRAWABLE})Z`, (r, _m, [, drawable]) => { if (nullish(drawable)) return 0; const id = r.object(drawable).fields.get('Landroid/graphics/drawable/Drawable;->mSourceResId:I'); return id === 0x01080093 ? 1 : 0; });
  def(PM, 'getDrawable', `(${STRING}I${APP_INFO})${DRAWABLE}`, (r, _m, [, pkg, resId]) => { if (text(r, pkg) !== own()) notFound(r, text(r, pkg)); return resId ? iconOf(r, resId) : null; });
  def(PM, 'getText', `(${STRING}I${APP_INFO})Ljava/lang/CharSequence;`, (r, _m, [, pkg, resId]) => { if (text(r, pkg) !== own()) return null; return resId ? call(r, resourcesOf(r, pkg), RESOURCES, 'getText', ['I'], 'Ljava/lang/CharSequence;', [resId]) : null; });
  def(PM, 'getXml', `(${STRING}I${APP_INFO})Landroid/content/res/XmlResourceParser;`, (r, _m, [, pkg, resId]) => { if (text(r, pkg) !== own()) return null; return resId ? call(r, resourcesOf(r, pkg), RESOURCES, 'getXml', ['I'], 'Landroid/content/res/XmlResourceParser;', [resId]) : null; });
  // ---- PackageItemInfo / ComponentInfo / ResolveInfo label and icon loading (android-13.0.0_r1 PackageItemInfo.loadLabel / loadIcon / loadXmlMetaData, ComponentInfo.getIconResource, ResolveInfo.loadLabel / loadIcon) ----
  // The lab's component infos carry name, package and the application info; a component without its own label or icon shares the application's (what the framework's package parser records).
  const ITEM = 'Landroid/content/pm/PackageItemInfo;', COMPONENT_INFO = 'Landroid/content/pm/ComponentInfo;', CHARS = 'Ljava/lang/CharSequence;', BUNDLE = 'Landroid/os/Bundle;';
  const itemFields = (r, self) => r.object(self).fields;
  const appInfoOf = (r, self) => itemFields(r, self).get(`${COMPONENT_INFO}->applicationInfo:${APP_INFO}`) ?? null;
  const itemLabel = (r, self, pm) => {
    const fields = itemFields(r, self), literal = fields.get(`${ITEM}->nonLocalizedLabel:${CHARS}`) ?? null, res = fields.get(`${ITEM}->labelRes:I`) ?? 0;
    if (!nullish(literal)) return literal;
    if (res) { const label = call(r, pm, PM, 'getText', [STRING, 'I', APP_INFO], CHARS, [fields.get(`${ITEM}->packageName:${STRING}`), res, appInfoOf(r, self)]); if (!nullish(label)) return label; }
    const app = appInfoOf(r, self); if (!nullish(app)) return call(r, app, APP_INFO, 'loadLabel', [PM], CHARS, [pm]);
    return fields.get(`${ITEM}->name:${STRING}`) ?? fields.get(`${ITEM}->packageName:${STRING}`);
  };
  def(ITEM, 'loadLabel', `(${PM})${CHARS}`, (r, _m, [self, pm]) => { if (nullish(pm)) npe(r); return itemLabel(r, self, pm); });
  const iconResource = (r, self) => { const own = itemFields(r, self).get(`${ITEM}->icon:I`) ?? 0; if (own) return own; const icon = platform.manifest?.application?.icon; return typeof icon === 'number' ? icon : 0; };
  def(COMPONENT_INFO, 'getIconResource', '()I', (r, _m, [self]) => iconResource(r, self));
  def(ITEM, 'loadIcon', `(${PM})${DRAWABLE}`, (r, _m, [self, pm]) => { if (nullish(pm)) npe(r); const id = iconResource(r, self); return id ? iconOf(r, id) : defaultIcon(r); });
  def(ITEM, 'loadXmlMetaData', `(${PM}${STRING})Landroid/content/res/XmlResourceParser;`, (r, _m, [self, pm, name]) => {
    const meta = itemFields(r, self).get(`${ITEM}->metaData:${BUNDLE}`) ?? null; if (nullish(meta) || nullish(name)) return null;
    if (!call(r, meta, BUNDLE, 'containsKey', [STRING], 'Z', [name])) return null;
    const id = call(r, meta, BUNDLE, 'getInt', [STRING, 'I'], 'I', [name, 0]); if (!id) return null;
    return call(r, pm, PM, 'getXml', [STRING, 'I', APP_INFO], 'Landroid/content/res/XmlResourceParser;', [itemFields(r, self).get(`${ITEM}->packageName:${STRING}`), id, appInfoOf(r, self)]);
  });
  const componentOf = (r, self) => { const f = itemFields(r, self); return f.get(`${RESOLVE_INFO}->activityInfo:${ACTIVITY_INFO}`) ?? f.get(`${RESOLVE_INFO}->serviceInfo:${SERVICE_INFO}`) ?? f.get(`${RESOLVE_INFO}->providerInfo:${PROVIDER_INFO}`) ?? null; };
  def(RESOLVE_INFO, 'loadLabel', `(${PM})${CHARS}`, (r, _m, [self, pm]) => {
    const literal = itemFields(r, self).get(`${RESOLVE_INFO}->nonLocalizedLabel:${CHARS}`) ?? null; if (!nullish(literal)) return literal;
    const info = componentOf(r, self); if (nullish(info)) return null;
    const label = itemLabel(r, info, pm); return nullish(label) ? null : r.stringCharacters(call(r, label, OBJECT, 'toString', [], STRING)).trim();
  });
  def(RESOLVE_INFO, 'loadIcon', `(${PM})${DRAWABLE}`, (r, _m, [self, pm]) => { const info = componentOf(r, self); if (nullish(info)) return defaultIcon(r); const id = iconResource(r, info); return id ? iconOf(r, id) : defaultIcon(r); });
  def(RESOLVE_INFO, 'getIconResource', '()I', (r, _m, [self]) => { const own = itemFields(r, self).get(`${RESOLVE_INFO}->icon:I`) ?? 0; if (own) return own; const info = componentOf(r, self); return nullish(info) ? 0 : iconResource(r, info); });
  def(PM, 'getUserBadgedIcon', `(${DRAWABLE}Landroid/os/UserHandle;)${DRAWABLE}`, (r, _m, [, icon]) => icon);   // single user: no work badge
  def(PM, 'getUserBadgedDrawableForDensity', `(${DRAWABLE}Landroid/os/UserHandle;Landroid/graphics/Rect;I)${DRAWABLE}`, (r, _m, [, drawable]) => drawable);
  def(PM, 'getUserBadgedLabel', `(Ljava/lang/CharSequence;Landroid/os/UserHandle;)Ljava/lang/CharSequence;`, (r, _m, [, label]) => label);

  // ---- package state and signatures ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  def(PM, 'getApplicationEnabledSetting', `(${STRING})I`, (r, _m, [, name]) => { if (nullish(name)) npe(r); try { known(r, name); } catch (error) { if (error?.name !== 'JavaException') throw error; r.throwJava('Ljava/lang/IllegalArgumentException;', `Unknown package: ${text(r, name)}`); } return 0; });   // COMPONENT_ENABLED_STATE_DEFAULT
  def(PM, 'setApplicationEnabledSetting', `(${STRING}II)V`, r => security(r, 'android.permission.CHANGE_COMPONENT_ENABLED_STATE'));
  def(PM, 'setComponentEnabledSettings', `(${LIST})V`, r => security(r, 'android.permission.CHANGE_COMPONENT_ENABLED_STATE'));
  def(PM, 'getTargetSdkVersion', `(${STRING})I`, (r, _m, [, name]) => { const n = known(r, name); return n === own() ? Number(platform.manifest?.usesSdk?.targetSdkVersion ?? 1) : 33; });
  def(PM, 'isPackageSuspended', '()Z', () => 0); def(PM, 'isPackageSuspended', `(${STRING})Z`, (r, _m, [, name]) => { known(r, name); return 0; });
  def(PM, 'getSuspendedPackageAppExtras', '()Landroid/os/Bundle;', () => null);
  def(PM, 'isSafeMode', '()Z', () => 0); def(PM, 'isDeviceUpgrading', '()Z', () => 0); def(PM, 'canRequestPackageInstalls', '()Z', () => 0);
  def(PM, 'canPackageQuery', `(${STRING}${STRING})Z`, (r, _m, [, a, b]) => { known(r, a); known(r, b); return 1; });
  def(PM, 'getSyntheticAppDetailsActivityEnabled', `(${STRING})Z`, (r, _m, [, name]) => { known(r, name); return 0; });
  def(PM, 'canonicalToCurrentPackageNames', `(${STRINGS})${STRINGS}`, (r, _m, [, names]) => names); def(PM, 'currentToCanonicalPackageNames', `(${STRINGS})${STRINGS}`, (r, _m, [, names]) => names);
  const certificate = r => (r.apkSigningCertificates?.() ?? [])[0] ?? null;
  const sameSigner = (r, a, b) => a === b ? SIGNATURE_MATCH : SIGNATURE_NO_MATCH;
  def(PM, 'checkSignatures', `(${STRING}${STRING})I`, (r, _m, [, a, b]) => { if (nullish(a) || nullish(b)) npe(r); const names = platform.appServices.packageNames(r), x = text(r, a), y = text(r, b); return !names.includes(x) || !names.includes(y) ? SIGNATURE_UNKNOWN_PACKAGE : sameSigner(r, x, y); });
  def(PM, 'checkSignatures', '(II)I', (r, _m, [, a, b]) => a === b ? SIGNATURE_MATCH : SIGNATURE_NO_MATCH);
  const sha256 = async () => null; void sha256;
  def(PM, 'hasSigningCertificate', `(${STRING}[BI)Z`, (r, _m, [, name, cert, type]) => {
    if (nullish(name) || nullish(cert)) npe(r); if (text(r, name) !== own()) { known(r, name); return 0; }
    const der = certificate(r); if (!der) return 0; const given = Uint8Array.from(r.array(cert).elements, v => v & 255);
    if (type === 0) return given.length === der.length && given.every((v, i) => v === der[i]) ? 1 : 0;   // CERT_INPUT_RAW_X509
    return callStatic(r, 'Ljava/util/Arrays;', 'equals', ['[B', '[B'], 'Z', [cert, callStatic(r, 'Ljava/security/MessageDigest;', 'getInstance', [STRING], 'Ljava/security/MessageDigest;', ['SHA-256']) && digestOf(r, der)]);   // CERT_INPUT_SHA256
  });
  const digestOf = (r, der) => { const md = callStatic(r, 'Ljava/security/MessageDigest;', 'getInstance', [STRING], 'Ljava/security/MessageDigest;', ['SHA-256']), bytes = r.newArray('[B', der.length); r.array(bytes).elements = Array.from(der, v => (v << 24) >> 24); return call(r, md, 'Ljava/security/MessageDigest;', 'digest', ['[B'], '[B', [bytes]); };
  def(PM, 'hasSigningCertificate', '(I[BI)Z', (r, _m, [, uid, cert, type]) => { if (nullish(cert)) npe(r); return uid === platform.virtualProcess.uid ? call(r, platform.application, 'Landroid/content/Context;', 'getPackageManager', [], PM) && callHas(r, cert, type) : 0; });
  const callHas = (r, cert, type) => call(r, call(r, platform.application, 'Landroid/content/Context;', 'getPackageManager', [], PM), PM, 'hasSigningCertificate', [STRING, '[B', 'I'], 'Z', [own(), cert, type]);
  def(PM, 'getPackageGids', `(${STRING})[I`, (r, _m, [self, name]) => call(r, self, PM, 'getPackageGids', [STRING, 'I'], '[I', [name, 0]));
  def(PM, 'getPackageGids', `(${STRING}${PACKAGE_FLAGS})[I`, (r, _m, [self, name]) => call(r, self, PM, 'getPackageGids', [STRING, 'I'], '[I', [name, 0]));
  def(PM, 'getPackageGids', `(${STRING}I)[I`, (r, _m, [, name]) => { const n = known(r, name), gids = n === own() && platform.holdsPermission(r, 'android.permission.INTERNET') ? [3003] : [], array = r.newArray('[I', gids.length); r.array(array).elements = gids; return array; });   // AID_INET
  def(PM, 'getPackageArchiveInfo', `(${STRING}I)${PACKAGE_INFO}`, (r, _m, [self, path, flags]) => { if (nullish(path)) npe(r); return text(r, path) === `${platform.javaIo.fs().codePath}/base.apk` ? call(r, self, PM, 'getPackageInfo', [STRING, 'I'], PACKAGE_INFO, [own(), flags]) : null; });   // the app's own APK; an unreadable or foreign file gives null as a failed parse does
  def(PM, 'getPackageArchiveInfo', `(${STRING}${PACKAGE_FLAGS})${PACKAGE_INFO}`, (r, _m, [self, path, holder]) => call(r, self, PM, 'getPackageArchiveInfo', [STRING, 'I'], PACKAGE_INFO, [path, Number(BigInt.asIntN(32, call(r, holder, PACKAGE_FLAGS, 'getValue', [], 'J')))]));
  // PackageManager.getPackageInstaller(): the process's PackageInstaller for this user. The device has no sessions (nothing is being installed or staged), so every listing is empty and a session id
  // is unknown: getSessionInfo answers null and openSession/abandonSession refuse with the framework's SecurityException for a session the caller does not own. Creating, committing or uninstalling
  // needs PackageInstaller.SessionParams/SessionInfo-backed sessions and the installer service, which the lab does not carry.
  const INSTALLER = 'Landroid/content/pm/PackageInstaller;', SESSION_CALLBACK = 'Landroid/content/pm/PackageInstaller$SessionCallback;';
  type(INSTALLER, OBJECT, [], { allocatable: true });
  def(PM, 'getPackageInstaller', `()${INSTALLER}`, r => { platform.packageInstaller ??= r.allocate(INSTALLER); return platform.packageInstaller; });
  for (const name of ['getAllSessions', 'getMySessions', 'getStagedSessions']) def(INSTALLER, name, `()${LIST}`, r => emptyList(r));
  def(INSTALLER, 'getSessionInfo', '(I)Landroid/content/pm/PackageInstaller$SessionInfo;', () => null);
  def(INSTALLER, 'getActiveStagedSession', '()Landroid/content/pm/PackageInstaller$SessionInfo;', () => null);
  def(INSTALLER, 'getActiveStagedSessions', `()${LIST}`, r => emptyList(r));
  def(INSTALLER, 'registerSessionCallback', `(${SESSION_CALLBACK})V`, (r, _m, [, callback]) => { if (nullish(callback)) npe(r); });
  def(INSTALLER, 'registerSessionCallback', `(${SESSION_CALLBACK}Landroid/os/Handler;)V`, (r, _m, [, callback]) => { if (nullish(callback)) npe(r); });
  def(INSTALLER, 'unregisterSessionCallback', `(${SESSION_CALLBACK})V`, (r, _m, [, callback]) => { if (nullish(callback)) npe(r); });
  def(INSTALLER, 'abandonSession', '(I)V', (r, _m, [, id]) => r.throwJava(SECURITY, `Caller has no access to session ${id}`));
  def(INSTALLER, 'openSession', '(I)Landroid/content/pm/PackageInstaller$Session;', (r, _m, [, id]) => r.throwJava(SECURITY, `Caller has no access to session ${id}`));
  // PackageManager.getInstallSourceInfo(String): InstallSourceInfo is the original class. The loaded APK was side-loaded into the lab, so no installer, initiating or originating package exists
  // (and with no initiating package there is no initiating signing info); an unknown package is a NameNotFoundException, exactly as ApplicationPackageManager turns the service's null.
  def(PM, 'getInstallSourceInfo', `(${STRING})Landroid/content/pm/InstallSourceInfo;`, (r, _m, [, name]) => { known(r, name); return construct(r, 'Landroid/content/pm/InstallSourceInfo;', [STRING, 'Landroid/content/pm/SigningInfo;', STRING, STRING], [null, null, null, null]); });
  def(PM, 'getChangedPackages', '(I)Landroid/content/pm/ChangedPackages;', () => null);
  def(PM, 'getInstalledModules', `(I)${LIST}`, r => emptyList(r)); def(PM, 'getModuleInfo', `(${STRING}I)Landroid/content/pm/ModuleInfo;`, (r, _m, [, name]) => notFound(r, text(r, name)));
  def(PM, 'queryInstrumentation', `(${STRING}I)${LIST}`, r => emptyList(r)); def(PM, 'getInstrumentationInfo', `(${COMPONENT}I)Landroid/content/pm/InstrumentationInfo;`, (r, _m, [, component]) => notFound(r, text(r, call(r, component, OBJECT, 'toString', [], STRING))));
  for (const name of ['queryActivityProperty', 'queryApplicationProperty', 'queryProviderProperty', 'queryReceiverProperty', 'queryServiceProperty']) def(PM, name, `(${STRING})${LIST}`, (r, _m, [, property]) => { if (nullish(property)) npe(r); return emptyList(r); });   // manifest <property> elements are not parsed: none declared
  def(PM, 'getProperty', `(${STRING}${STRING})Landroid/content/pm/PackageManager$Property;`, (r, _m, [, , pkg]) => notFound(r, `Property not found: ${text(r, pkg)}`));
  def(PM, 'getProperty', `(${STRING}${COMPONENT})Landroid/content/pm/PackageManager$Property;`, (r, _m, [, name]) => notFound(r, `Property not found: ${text(r, name)}`));
  def(PM, 'getMimeGroup', `(${STRING})Ljava/util/Set;`, (r, _m, [, group]) => { if (nullish(group)) npe(r); return callStatic(r, 'Ljava/util/Collections;', 'emptySet', [], 'Ljava/util/Set;'); });
  def(PM, 'setMimeGroup', `(${STRING}Ljava/util/Set;)V`, (r, _m, [, group]) => { if (nullish(group)) npe(r); r.throwJava('Ljava/lang/IllegalArgumentException;', `Unknown MIME group ${text(r, group)}`); });
  def(PM, 'queryContentProviders', `(${STRING}I${COMPONENT_FLAGS})${LIST}`, (r, _m, [self, processName, uid, holder]) => call(r, self, PM, 'queryContentProviders', [STRING, 'I', 'I'], LIST, [processName, uid, flagValue(r, holder)]));
  def(PM, 'queryContentProviders', `(${STRING}II)${LIST}`, (r, _m, [self, processName, uid, flags]) => {
    const list = construct(r, 'Ljava/util/ArrayList;', [], []);
    for (const detail of platform.manifest?.providerDetails ?? []) {
      if (!nullish(processName) && text(r, processName) !== (detail.process || own())) continue;
      call(r, list, 'Ljava/util/ArrayList;', 'add', [OBJECT], 'Z', [call(r, self, PM, 'getProviderInfo', [COMPONENT, 'I'], PROVIDER_INFO, [construct(r, COMPONENT, [STRING, STRING], [own(), detail.name]), flags])]);
    }
    return list;
  });

  // ---- permissions and privileged state: what an ordinary app gets -----------------------------------------------------------------------------------------------------------------------------
  def(PM, 'getAllPermissionGroups', `(I)${LIST}`, r => emptyList(r)); def(PM, 'queryPermissionsByGroup', `(${STRING}I)${LIST}`, r => emptyList(r));
  def(PM, 'getPermissionGroupInfo', `(${STRING}I)Landroid/content/pm/PermissionGroupInfo;`, (r, _m, [, name]) => notFound(r, text(r, name)));
  def(PM, 'getPermissionInfo', `(${STRING}I)Landroid/content/pm/PermissionInfo;`, (r, _m, [, name]) => notFound(r, text(r, name)));   // PermissionInfo table is not part of the lab framework
  def(PM, 'isPermissionRevokedByPolicy', `(${STRING}${STRING})Z`, (r, _m, [, permission, name]) => { if (nullish(permission) || nullish(name)) npe(r); return 0; });
  def(PM, 'getBackgroundPermissionOptionLabel', '()Ljava/lang/CharSequence;', () => 'Allow all the time');
  def(PM, 'addPermission', '(Landroid/content/pm/PermissionInfo;)Z', r => security(r, 'android.permission.GRANT_RUNTIME_PERMISSIONS')); def(PM, 'addPermissionAsync', '(Landroid/content/pm/PermissionInfo;)Z', r => security(r, 'android.permission.GRANT_RUNTIME_PERMISSIONS'));
  def(PM, 'removePermission', `(${STRING})V`, r => security(r, 'android.permission.GRANT_RUNTIME_PERMISSIONS'));
  for (const name of ['getWhitelistedRestrictedPermissions']) def(PM, name, `(${STRING}I)Ljava/util/Set;`, r => security(r, 'android.permission.WHITELIST_RESTRICTED_PERMISSIONS'));
  for (const name of ['addWhitelistedRestrictedPermission', 'removeWhitelistedRestrictedPermission']) def(PM, name, `(${STRING}${STRING}I)Z`, r => security(r, 'android.permission.WHITELIST_RESTRICTED_PERMISSIONS'));
  def(PM, 'isAutoRevokeWhitelisted', '()Z', () => 0); def(PM, 'isAutoRevokeWhitelisted', `(${STRING})Z`, r => security(r, 'android.permission.WHITELIST_AUTO_REVOKE_PERMISSIONS')); def(PM, 'setAutoRevokeWhitelisted', `(${STRING}Z)Z`, r => security(r, 'android.permission.WHITELIST_AUTO_REVOKE_PERMISSIONS'));
  def(PM, 'getGroupOfPlatformPermission', `(${STRING}Ljava/util/concurrent/Executor;Ljava/util/function/Consumer;)V`, () => unsupported('PackageManager.getGroupOfPlatformPermission: the platform permission-group table is not part of the lab', 'permission-groups-unsupported'));
  def(PM, 'getPlatformPermissionsForGroup', `(${STRING}Ljava/util/concurrent/Executor;Ljava/util/function/Consumer;)V`, () => unsupported('PackageManager.getPlatformPermissionsForGroup: the platform permission-group table is not part of the lab', 'permission-groups-unsupported'));
  def(PM, 'addPackageToPreferred', `(${STRING})V`, () => {}); def(PM, 'removePackageFromPreferred', `(${STRING})V`, () => {});   // deprecated no-ops since API 15
  def(PM, 'getPreferredPackages', `(I)${LIST}`, r => emptyList(r)); def(PM, 'getPreferredActivities', `(${LIST}${LIST}${STRING})I`, () => 0);
  def(PM, 'addPreferredActivity', `(Landroid/content/IntentFilter;I[${COMPONENT}${COMPONENT})V`, r => security(r, 'android.permission.SET_PREFERRED_APPLICATIONS')); def(PM, 'clearPackagePreferredActivities', `(${STRING})V`, () => {});
  def(PM, 'setInstallerPackageName', `(${STRING}${STRING})V`, r => security(r, 'android.permission.INSTALL_PACKAGES')); def(PM, 'setApplicationCategoryHint', `(${STRING}I)V`, () => {});
  def(PM, 'extendVerificationTimeout', '(IIJ)V', r => security(r, 'android.permission.PACKAGE_VERIFICATION_AGENT')); def(PM, 'verifyPendingInstall', '(II)V', r => security(r, 'android.permission.PACKAGE_VERIFICATION_AGENT'));
  def(PM, 'getInstantAppCookie', '()[B', r => r.newArray('[B', 0)); def(PM, 'getInstantAppCookieMaxBytes', '()I', () => 16384); def(PM, 'clearInstantAppCookie', '()V', () => {}); def(PM, 'updateInstantAppCookie', '([B)V', () => {});
  return registry;
}
