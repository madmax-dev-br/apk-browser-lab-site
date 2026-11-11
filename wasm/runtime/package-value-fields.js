/**
 * Public instance fields of the android.content.pm value classes, declared by the AOSP class that owns them (android-13.0.0_r1 frameworks/base/core/java/android/content/pm).
 * An app reads them with iget, and the compiler names the declaring class in the reference (PackageItemInfo->metaData for an ApplicationInfo receiver), so every host
 * instance is stored under the declaring class and the host type chain must follow the AOSP superclass chain.
 */
const S = 'Ljava/lang/String;', SA = '[Ljava/lang/String;', CS = 'Ljava/lang/CharSequence;', BUNDLE = 'Landroid/os/Bundle;', PM = 'Landroid/content/pm/';
const APP = `${PM}ApplicationInfo;`;

export const PACKAGE_VALUE_FIELDS = {
  [`${PM}PackageItemInfo;`]: [['name', S], ['packageName', S], ['labelRes', 'I'], ['nonLocalizedLabel', CS], ['icon', 'I'], ['banner', 'I'], ['logo', 'I'], ['metaData', BUNDLE], ['showUserIcon', 'I']],
  [`${PM}ComponentInfo;`]: [['applicationInfo', APP], ['processName', S], ['splitName', S], ['descriptionRes', 'I'], ['enabled', 'Z'], ['exported', 'Z'], ['directBootAware', 'Z'], ['attributionTags', SA]],
  [APP]: [['taskAffinity', S], ['permission', S], ['processName', S], ['className', S], ['descriptionRes', 'I'], ['theme', 'I'], ['manageSpaceActivityName', S], ['backupAgentName', S], ['uiOptions', 'I'], ['flags', 'I'], ['privateFlags', 'I'], ['privateFlagsExt', 'I'],
    ['requiresSmallestWidthDp', 'I'], ['compatibleWidthLimitDp', 'I'], ['largestWidthLimitDp', 'I'], ['scanSourceDir', S], ['scanPublicSourceDir', S], ['sourceDir', S], ['publicSourceDir', S], ['splitNames', SA], ['splitSourceDirs', SA], ['splitPublicSourceDirs', SA],
    ['nativeLibraryDir', S], ['secondaryNativeLibraryDir', S], ['nativeLibraryRootDir', S], ['nativeLibraryRootRequiresIsa', 'Z'], ['primaryCpuAbi', S], ['secondaryCpuAbi', S], ['resourceDirs', SA], ['seInfo', S], ['seInfoUser', S], ['sharedLibraryFiles', SA],
    ['dataDir', S], ['deviceProtectedDataDir', S], ['credentialProtectedDataDir', S], ['uid', 'I'], ['minSdkVersion', 'I'], ['targetSdkVersion', 'I'], ['longVersionCode', 'J'], ['versionCode', 'I'], ['enabled', 'Z'], ['enabledSetting', 'I'],
    ['networkSecurityConfigRes', 'I'], ['category', 'I'], ['fullBackupContent', 'I'], ['appComponentFactory', S], ['classLoaderName', S], ['compileSdkVersion', 'I'], ['compileSdkVersionCodename', S], ['zygotePreloadName', S], ['gwpAsanMode', 'I'], ['memtagMode', 'I'],
    ['nativeHeapZeroInitialized', 'I'], ['hiddenUntilInstalled', 'Z'], ['crossProfile', 'Z'], ['targetSandboxVersion', 'I'], ['volumeUuid', S], ['storageUuid', 'Ljava/util/UUID;'], ['splitClassLoaderNames', SA]],
  [`${PM}ActivityInfo;`]: [['theme', 'I'], ['launchMode', 'I'], ['documentLaunchMode', 'I'], ['permission', S], ['taskAffinity', S], ['targetActivity', S], ['launchToken', S], ['flags', 'I'], ['screenOrientation', 'I'], ['configChanges', 'I'], ['softInputMode', 'I'], ['uiOptions', 'I'],
    ['parentActivityName', S], ['maxRecents', 'I'], ['lockTaskLaunchMode', 'I'], ['colorMode', 'I'], ['persistableMode', 'I'], ['requestedVrComponent', S], ['rotationAnimation', 'I'], ['preferMinimalPostProcessing', 'Z'], ['windowLayout', `${PM}ActivityInfo$WindowLayout;`], ['resizeMode', 'I'], ['maxAspectRatio', 'F'], ['minAspectRatio', 'F'], ['privateFlags', 'I']],
  [`${PM}ServiceInfo;`]: [['permission', S], ['flags', 'I'], ['mForegroundServiceType', 'I']],
  [`${PM}ProviderInfo;`]: [['authority', S], ['readPermission', S], ['writePermission', S], ['grantUriPermissions', 'Z'], ['forceUriPermissions', 'Z'], ['multiprocess', 'Z'], ['initOrder', 'I'], ['flags', 'I'], ['isSyncable', 'Z'], ['uriPermissionPatterns', '[Landroid/os/PatternMatcher;'], ['pathPermissions', '[Landroid/content/pm/PathPermission;']],
  [`${PM}InstrumentationInfo;`]: [['targetPackage', S], ['targetProcesses', S], ['sourceDir', S], ['publicSourceDir', S], ['splitNames', SA], ['splitSourceDirs', SA], ['splitPublicSourceDirs', SA], ['dataDir', S], ['deviceProtectedDataDir', S], ['credentialProtectedDataDir', S], ['primaryCpuAbi', S], ['secondaryCpuAbi', S], ['nativeLibraryDir', S], ['secondaryNativeLibraryDir', S], ['handleProfiling', 'Z'], ['functionalTest', 'Z']],
  [`${PM}PermissionInfo;`]: [['protectionLevel', 'I'], ['flags', 'I'], ['group', S], ['descriptionRes', 'I'], ['backgroundPermission', S], ['nonLocalizedDescription', CS]],
  [`${PM}PermissionGroupInfo;`]: [['descriptionRes', 'I'], ['nonLocalizedDescription', CS], ['flags', 'I'], ['priority', 'I']],
  [`${PM}FeatureInfo;`]: [['name', S], ['reqGlEsVersion', 'I'], ['flags', 'I'], ['version', 'I']],
  [`${PM}ConfigurationInfo;`]: [['reqTouchScreen', 'I'], ['reqKeyboardType', 'I'], ['reqNavigation', 'I'], ['reqInputFeatures', 'I'], ['reqGlEsVersion', 'I']],
  [`${PM}PackageInfo;`]: [['packageName', S], ['splitNames', SA], ['versionCode', 'I'], ['versionCodeMajor', 'I'], ['versionName', S], ['baseRevisionCode', 'I'], ['splitRevisionCodes', '[I'], ['sharedUserId', S], ['sharedUserLabel', 'I'], ['applicationInfo', APP], ['firstInstallTime', 'J'], ['lastUpdateTime', 'J'], ['gids', '[I'],
    ['activities', '[Landroid/content/pm/ActivityInfo;'], ['receivers', '[Landroid/content/pm/ActivityInfo;'], ['services', '[Landroid/content/pm/ServiceInfo;'], ['providers', '[Landroid/content/pm/ProviderInfo;'], ['instrumentation', '[Landroid/content/pm/InstrumentationInfo;'], ['permissions', '[Landroid/content/pm/PermissionInfo;'],
    ['requestedPermissions', SA], ['requestedPermissionsFlags', '[I'], ['signatures', '[Landroid/content/pm/Signature;'], ['configPreferences', '[Landroid/content/pm/ConfigurationInfo;'], ['reqFeatures', '[Landroid/content/pm/FeatureInfo;'], ['featureGroups', '[Landroid/content/pm/FeatureGroupInfo;'], ['installLocation', 'I'], ['isStub', 'Z'], ['coreApp', 'Z'], ['requiredForAllUsers', 'Z'], ['restrictedAccountType', S], ['requiredAccountType', S], ['overlayTarget', S], ['overlayCategory', S], ['overlayPriority', 'I'], ['mOverlayIsStatic', 'Z'], ['compileSdkVersion', 'I'], ['compileSdkVersionCodename', S], ['isApex', 'Z'], ['signingInfo', `${PM}SigningInfo;`]],
  [`${PM}ResolveInfo;`]: [['activityInfo', `${PM}ActivityInfo;`], ['serviceInfo', `${PM}ServiceInfo;`], ['providerInfo', `${PM}ProviderInfo;`], ['filter', 'Landroid/content/IntentFilter;'], ['priority', 'I'], ['preferredOrder', 'I'], ['match', 'I'], ['specificIndex', 'I'], ['isDefault', 'Z'], ['labelRes', 'I'], ['nonLocalizedLabel', CS], ['icon', 'I'], ['resolvePackageName', S], ['targetUserId', 'I'], ['noResourceId', 'Z'], ['iconResourceId', 'I'], ['system', 'Z'], ['isInstantAppAvailable', 'Z']],
};

/** AOSP superclass of each value class, so that the host type chain reaches the declaring class of an inherited field. */
export const PACKAGE_VALUE_PARENTS = {
  [APP]: `${PM}PackageItemInfo;`, [`${PM}ComponentInfo;`]: `${PM}PackageItemInfo;`, [`${PM}ActivityInfo;`]: `${PM}ComponentInfo;`, [`${PM}ServiceInfo;`]: `${PM}ComponentInfo;`, [`${PM}ProviderInfo;`]: `${PM}ComponentInfo;`,
  [`${PM}InstrumentationInfo;`]: `${PM}PackageItemInfo;`, [`${PM}PermissionInfo;`]: `${PM}PackageItemInfo;`, [`${PM}PermissionGroupInfo;`]: `${PM}PackageItemInfo;`,
};

export function registerPackageValueFields(registry) {
  for (const [owner, fields] of Object.entries(PACKAGE_VALUE_FIELDS)) for (const [name, type] of fields) registry.instanceField(owner, name, type, { reflect: true });
}
